// Spalanie odłamków bazy w atmosferze (demo wokseli, src/3d/woksele/atmosfera.js): wzorzec CPU modelu ma dawać to, o co prosił użytkownik 2026-11-09:
// małe spalają się całe, największe dolatują, Mars pali dużo słabiej niż Ziemia, ale widocznie (żar), Hidalgo bez atmosfery nie pali nic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANETY_ATM, planetaZAdresu, gestosc, strumienCiepla, temperaturaRownowagi, symulujSpadek } from '../src/3d/woksele/atmosfera.js';

const { ziemia, mars, hidalgo } = PLANETY_ATM;

test('gęstość: ρ0 przy gruncie, e⁻¹ na skali wysokości', () => {
  assert.equal(gestosc(ziemia.atmosfera, 0), 1.225);
  assert.ok(Math.abs(gestosc(ziemia.atmosfera, 8500) / 1.225 - Math.exp(-1)) < 1e-12);
  assert.ok(gestosc(mars.atmosfera, 0) < gestosc(ziemia.atmosfera, 0) / 50);
});

test('strumień ciepła ∝ ρ·v³, temperatura rośnie z nim', () => {
  assert.ok(Math.abs(strumienCiepla(1, 2000) / strumienCiepla(1, 1000) - 8) < 1e-9);
  assert.ok(temperaturaRownowagi(1e7) > temperaturaRownowagi(1e6));
  assert.equal(temperaturaRownowagi(0), 250);
});

test('adres: nieznana planeta to Hidalgo', () => {
  assert.equal(planetaZAdresu('ZIEMIA'), ziemia);
  assert.equal(planetaZAdresu('mars'), mars);
  assert.equal(planetaZAdresu('wenus'), hidalgo);
  assert.equal(planetaZAdresu(null), hidalgo);
});

test('Ziemia: gruz i pojedyncze węzły spalają się w locie, wielka bryła doleciuje', () => {
  for (const [gruby, maly] of [[3, true], [8, true], [20, true], [40, false], [80, false]]) {
    const r = symulujSpadek({ planeta: ziemia, gruby, maly });
    assert.ok(!r.doleciał && r.hSpalony > 1000, `gruby ${gruby}: ${JSON.stringify(r)}`);
    assert.ok(r.Tmax > 3000, `gruby ${gruby}: żar ${r.Tmax}`);
  }
  const duza = symulujSpadek({ planeta: ziemia, gruby: 800 });
  assert.ok(duza.doleciał && duza.ulamek > 0.5 && duza.ulamek < 0.95, JSON.stringify(duza));
  assert.ok(duza.vUderzenia > 5000, 'wielka bryła prawie nie hamuje');
});

test('Mars: wszystko doleciuje, ze stratą najwyżej kilku procent, ale żarzy się (T > 2000 K)', () => {
  for (const [gruby, maly] of [[3, true], [40, false], [400, false]]) {
    const r = symulujSpadek({ planeta: mars, gruby, maly });
    assert.ok(r.doleciał, `gruby ${gruby}`);
    assert.ok(r.ulamek > 0.8, `gruby ${gruby}: ${r.ulamek}`);
    assert.ok(r.Tmax > 2000, `gruby ${gruby}: żar ${r.Tmax}`);
    const z = symulujSpadek({ planeta: ziemia, gruby, maly });
    assert.ok((r.Tmax / z.Tmax) ** 4 < 0.15, `Mars grzeje dużo słabiej (strumień ciepła ∝ T⁴): ${r.Tmax} / ${z.Tmax}`);
  }
});

test('Ziemia: spadek dłuższy niż na Hidalgo w grze (40 km), a żar dopiero w górnej atmosferze', () => {
  const r = symulujSpadek({ planeta: ziemia, gruby: 800 });
  assert.ok(ziemia.wysBazy > 2 * 40000);
  assert.ok(r.hZar < 100000 && r.hZar > 60000, `pierwszy żar ${r.hZar}`);
});

// ── Obraz i kernele w WGSL z Node (bez GPU) ──
import * as THREE from 'three/webgpu';
import { createWokseleSolver } from '../src/3d/woksele/solver.js';
import { createWokseleObraz } from '../src/3d/woksele/obraz.js';
import { createSpalanie, CAP_SMUG } from '../src/3d/woksele/spalanie.js';
import { createPowierzchniaAtm } from '../dema/woksele-zawalenia/powierzchniaAtm.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const camera = new THREE.PerspectiveCamera(32, 1, 20, 4e6);

function nieprzypisane(kod) {
  const zle = [];
  for (const nazwa of new Set([...kod.matchAll(/var (nodeVar\d+)\b/g)].map((m) => m[1]))) {
    const zapis = kod.search(new RegExp(`\b${nazwa}\s*(\.[xyzw]+\s*)?=[^=]`));
    const odczyt = kod.search(new RegExp(`(?<!var )\b${nazwa}\b(?!\s*(\.[xyzw]+\s*)?=[^=])`));
    if (odczyt >= 0 && (zapis < 0 || odczyt < zapis)) zle.push(nazwa);
  }
  return zle;
}
function zbudujSiatke(mesh, scena) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.scene = scena;
  b.camera = camera;
  b.material = mesh.material;
  b.lightsNode = renderer.lighting.getNode(scena);
  b.build();
  return b;
}
const kodKernela = (k) => { const b = renderer.backend.createNodeBuilder(k, renderer); b.build(); return b.computeShader; };

test('obraz bez haka spalania: WGSL brył i kawałków bez zmian (hak tylko w JS)', () => {
  const s = createWokseleSolver({ ciagliwe: true });
  const a = createWokseleObraz({ solver: s, camera, kawalki: true });
  const b = createWokseleObraz({ solver: s, camera, kawalki: true, spalanie: null });
  for (const [x, y, sc] of [[a.mesh, b.mesh, a.scene], [a.kawalki.mesh, b.kawalki.mesh, a.scene]]) {
    const kx = zbudujSiatke(x, sc), ky = zbudujSiatke(y, sc);
    assert.equal(kx.vertexShader, ky.vertexShader);
    assert.doesNotMatch(kx.vertexShader, /uSpMoc|wokSpal/);
  }
});

test('spalanie: kernele i siatki budują się, najwyżej 8 buforów storage, wierzchołki tylko do odczytu, bez nieprzypisanych zmiennych', () => {
  const s = createWokseleSolver({ ciagliwe: true, par: undefined });
  const sp = createSpalanie({ solver: s, planeta: ziemia });
  const o = createWokseleObraz({ solver: s, camera, kawalki: true, spalanie: sp.hak });
  sp.polacz(o);
  const pow = createPowierzchniaAtm({ planeta: ziemia, obraz: o, spalanie: sp });
  for (const k of [sp.kernele.kSpal, sp.kernele.kSpalG]) {
    const kod = kodKernela(k);
    assert.ok((kod.match(/var<storage/g) || []).length <= 8, kod.match(/var<storage[^;]*/g)?.join('\n'));
  }
  for (const mesh of [o.mesh, o.kawalki.mesh, ...sp.siatki(), pow.mesh]) {
    const b = zbudujSiatke(mesh, o.scene);
    assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8, mesh.name);
    assert.doesNotMatch(b.vertexShader, /var<storage, read_write>/, mesh.name);
    assert.deepEqual(nieprzypisane(b.vertexShader), [], `${mesh.name}: wierzchołek`);
    assert.deepEqual(nieprzypisane(b.fragmentShader), [], `${mesh.name}: fragment`);
  }
  // Hak w obrazie: żar i kurczenie z wZar (bez nowego bufora storage w wierzchołku brył i kawałków).
  const zHakiem = zbudujSiatke(o.kawalki.mesh, o.scene).vertexShader;
  const bez = zbudujSiatke(createWokseleObraz({ solver: s, camera, kawalki: true }).kawalki.mesh, o.scene).vertexShader;
  assert.notEqual(zHakiem, bez);
  assert.equal((zHakiem.match(/var<storage/g) || []).length, (bez.match(/var<storage/g) || []).length);
  assert.ok(CAP_SMUG >= 65536);
});
