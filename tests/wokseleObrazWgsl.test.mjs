// WGSL obrazu wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2.2, § 4.1), budowany w Node bez GPU: limit buforów storage, dostęp i osłona uN.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createWokseleSolver } from '../src/3d/woksele/solver.js';
import { createWokseleObraz } from '../src/3d/woksele/obraz.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const wgsl = (k) => {
  const b = renderer.backend.createNodeBuilder(k, renderer);
  b.build();
  return b.computeShader;
};

const solver = createWokseleSolver();
const camera = new THREE.PerspectiveCamera(32, 1, 20, 700000);
const obraz = createWokseleObraz({ solver, camera });

test('kObraz i kGruz: najwyżej 8 buforów storage (§ 2.2), kObraz czyta solver tylko do odczytu', () => {
  const kod = wgsl(obraz.kernele.kObraz);
  const ile = (kod.match(/var<storage/g) || []).length;
  assert.ok(ile <= 8, `kObraz ma ${ile} buforów storage`);
  assert.match(kod, /var<storage, read> \w*[wW]okWez/);
  assert.match(kod, /var<storage, read> \w*[wW]okMaska/);
  assert.match(kod, /var<storage, read> \w*[wW]okWiaz/);
  assert.match(kod, /atomicAdd/);
  assert.ok((wgsl(obraz.kernele.kGruz).match(/var<storage/g) || []).length <= 8);
});

test('kObraz: osłona uN i limit wzrostu dObraz są w kodzie, bez literału NaN ani Infinity', () => {
  const kod = wgsl(obraz.kernele.kObraz);
  assert.match(kod, /uLimD/);
  assert.doesNotMatch(kod, /Infinity|NaN/);
});

// ── P4: pył, błysk, żar ──
/** Wszystkie zmienne przypisane przed użyciem: nazwa nodeVar z pierwszego odczytu nie może poprzedzać pierwszego zapisu (pułapka 39). */
function nieprzypisane(kod) {
  const zle = [];
  for (const nazwa of new Set([...kod.matchAll(/var (nodeVar\d+)\b/g)].map((m) => m[1]))) {
    const zapis = kod.search(new RegExp(`\b${nazwa}\s*(\.[xyzw]+\s*)?=[^=]`));
    const odczyt = kod.search(new RegExp(`(?<!var )\b${nazwa}\b(?!\s*(\.[xyzw]+\s*)?=[^=])`));
    if (odczyt >= 0 && (zapis < 0 || odczyt < zapis)) zle.push(nazwa);
  }
  return zle;
}

test('kernele pyłu i przyczyny: najwyżej 8 buforów storage (§ 2.2), kCzysc, kKrater i kKraterCel także po zapisach żaru i błysku', () => {
  for (const nazwa of ['kPylEmisja', 'kPrzyczyna', 'kPylKrok']) {
    const kod = wgsl(obraz.kernele[nazwa]);
    const ile = (kod.match(/var<storage/g) || []).length;
    assert.ok(ile <= 8, `${nazwa} ma ${ile} buforów storage`);
    assert.doesNotMatch(kod, /Infinity|NaN/);
    assert.deepEqual(nieprzypisane(kod), [], nazwa);
  }
  const krater = wgsl(solver.kernele.kKrater);
  assert.ok((krater.match(/var<storage/g) || []).length <= 8);
  const czysc = wgsl(solver.kernele.kCzysc);
  assert.ok((czysc.match(/var<storage/g) || []).length <= 8);
  assert.match(czysc, /wokZar/);
  const cel = wgsl(solver.kernele.kKraterCel);
  assert.ok((cel.match(/var<storage/g) || []).length <= 8);
  assert.match(cel, /wokBlysk/);
});

test('kPylEmisja: warunek kontaktu i dysku zależy od uniformów, nie od gałęzi w budowie, a próżnia nie potrzebuje drugiego pipeline\'u', () => {
  const kod = wgsl(obraz.kernele.kPylEmisja);
  assert.match(kod, /uPylKont/);
  assert.match(kod, /uPylDysk/);
  assert.match(kod, /uPylPod/);
  assert.match(kod, /var<storage, read> \w*[wW]okLista/);
  assert.match(kod, /atomicAdd/);
});

test('materiał pyłu: jeden pipeline z mieszaniem (1, 1 − a), cel bez głębi, wierzchołek bez nieprzypisanych zmiennych, czyta bufory tylko do odczytu', () => {
  const m = obraz.pyl.mesh.material;
  assert.equal(m.blending, THREE.CustomBlending);
  assert.equal(m.blendSrc, THREE.OneFactor);
  assert.equal(m.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(m.depthWrite, false);
  assert.equal(m.depthTest, false);
  assert.equal(obraz.pyl.rt.depthBuffer, false);
  assert.equal(obraz.pyl.rt.samples, 0);
  const b = renderer.backend.createNodeBuilder(obraz.pyl.mesh, renderer);
  b.scene = obraz.pyl.scena;
  b.camera = camera;
  b.material = m;
  b.build();
  assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8);
  assert.doesNotMatch(b.vertexShader, /var<storage, read_write>/);
  assert.deepEqual(nieprzypisane(b.vertexShader), [], 'wierzchołek');
  assert.deepEqual(nieprzypisane(b.fragmentShader), [], 'fragment');
  assert.match(b.vertexShader, /uPylSufit/);
});

test('materiał brył czyta żar tylko do odczytu', () => {
  const b = renderer.backend.createNodeBuilder(obraz.mesh, renderer);
  b.scene = obraz.scene;
  b.camera = camera;
  b.material = obraz.mesh.material;
  b.lightsNode = renderer.lighting.getNode(obraz.scene);
  b.build();
  assert.match(b.vertexShader, /var<storage, read> \w*[wW]okZar/);
  assert.match(b.fragmentShader, /vWokE/);
  assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8);
});

// ── LOD obrazu, plan LOD, metoda G ──
test('LOD: sloty i cień to uniformy jednego grafu, wierzchołek bez nieprzypisanych zmiennych', () => {
  const b = renderer.backend.createNodeBuilder(obraz.mesh, renderer);
  b.scene = obraz.scene;
  b.camera = camera;
  b.material = obraz.mesh.material;
  b.lightsNode = renderer.lighting.getNode(obraz.scene);
  b.build();
  assert.match(b.vertexShader, /uObrSloty/);
  assert.deepEqual(nieprzypisane(b.vertexShader), [], 'wierzchołek');
  assert.equal(obraz.mesh.material.positionNode === obraz.mesh.material.castShadowPositionNode, false);
});

test('LOD: liczniki instancji rysunku i cienia, haki passa cienia, cień 0 wyłącza rzucanie, powrót do 7', () => {
  const g = obraz.mesh.geometry;
  obraz.pelnyObraz(true); // n = 0 w tym teście, więc m = 2
  assert.equal(g.instanceCount, 14);
  obraz.ustawLod({ sloty: 2, cien: 1 });
  assert.equal(g.instanceCount, 4);
  assert.equal(obraz.mesh.castShadow, true);
  obraz.mesh.onBeforeShadow();
  assert.equal(g.instanceCount, 2);
  obraz.mesh.onAfterShadow();
  assert.equal(g.instanceCount, 4);
  obraz.ustawLod({ sloty: 1, cien: 0 });
  assert.equal(g.instanceCount, 2);
  assert.equal(obraz.mesh.castShadow, false);
  obraz.ustawLod({ sloty: 7, cien: 7 });
  assert.equal(g.instanceCount, 14);
  assert.equal(obraz.mesh.castShadow, true);
  obraz.pelnyObraz(false);
  assert.equal(g.instanceCount, 2);
});

test('pył: sufit kwadów przez uniform i licznik, błyski zawsze za pierścieniem, domyślnie pełna pula', () => {
  const { uniformy } = obraz.pyl;
  const g = obraz.pyl.mesh.geometry;
  const pelna = g.instanceCount;
  obraz.pyl.wczytaj({ n: 0, gruntZ: 0 }, { kwady: 6000, rozmiar: 1.5, sufitPx: 90, lodDuze: [24, 42] });
  assert.equal(g.instanceCount, pelna - (16000 - 6000));
  assert.equal(uniformy.uRt.value, 38 * 1.5);
  assert.equal(uniformy.uSufit.value, 90);
  assert.equal(uniformy.uLodA.value, 24);
  obraz.pyl.wczytaj({ n: 0, gruntZ: 0 });
  assert.equal(g.instanceCount, pelna);
  assert.equal(uniformy.uRt.value, 38);
  assert.equal(uniformy.uSufit.value, 150);
});

test('kamera cienia: stałe S1–S5 bez zmian, duża scena z rozmiaru', () => {
  const c = obraz.sun.shadow.camera;
  obraz.ustawCien([0, 0, 500], 1700);
  assert.equal(c.far, 16000);
  assert.equal(obraz.sun.shadow.bias, -0.0006);
  assert.equal(obraz.sun.shadow.normalBias, 2);
  const pos = new Float32Array(6);
  pos.set([-20000, -15000, 0, 20000, 15000, 300]);
  const R = obraz.ustawCienZSceny({ n: 2, pos });
  assert.ok(R > 30000 && c.right === R && c.far >= 2 * R + 2 * R);
  assert.ok(obraz.sun.shadow.normalBias > 2);
  assert.ok(obraz.sun.position.distanceTo(obraz.sun.target.position) >= 2 * R - 1);
  obraz.ustawCien([0, 0, 500], 1700);
  assert.equal(c.far, 16000);
  assert.equal(obraz.sun.shadow.bias, -0.0006);
});

// ── Gra: obrót gruzu (uwaga użytkownika 2026-11-07: gruz w locie „wiruje jak szalony”) ──
test('gra: kGruz liczy obrót drobin w osobnym buforze, materiał gruzu czyta go tylko do odczytu; demo bez bufora obrotu', () => {
  const g = createWokseleObraz({ solver: createWokseleSolver(), camera, wGrze: true });
  const kod = wgsl(g.kernele.kGruz);
  assert.match(kod, /var<storage, read_write> \w*[wW]okKatGruzu/);
  assert.ok((kod.match(/var<storage/g) || []).length <= 8);
  assert.doesNotMatch(kod, /Infinity|NaN/);
  assert.deepEqual(nieprzypisane(kod), [], 'kGruz');
  const ob = wgsl(g.kernele.kObraz);
  assert.ok((ob.match(/var<storage/g) || []).length <= 8, 'kObraz w grze');
  assert.deepEqual(nieprzypisane(ob), [], 'kObraz');
  assert.doesNotMatch(wgsl(obraz.kernele.kGruz), /[wW]okKatGruzu/, 'demo bez bufora obrotu');
  const b = renderer.backend.createNodeBuilder(g.meshGruz, renderer);
  b.scene = g.scene;
  b.camera = camera;
  b.material = g.meshGruz.material;
  b.lightsNode = renderer.lighting.getNode(g.scene);
  b.build();
  assert.match(b.vertexShader, /var<storage, read> \w*[wW]okKatGruzu/);
  assert.doesNotMatch(b.vertexShader, /var<storage, read_write>/);
  assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8);
  assert.deepEqual(nieprzypisane(b.vertexShader), [], 'wierzchołek gruzu');
});
