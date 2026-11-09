// Demo bazy na wiązanych wokselach (prośby użytkownika 2026-11-09): skóra z gry na demie (obraz.js, opcja `skora`; dema/woksele-zawalenia/skoraDema.js)
// i Atlas w płaszczyźnie gry do taranowania (solver.js, flaga `statek`; dema/woksele-zawalenia/atlas.js). Bez GPU: WGSL z Node, pole obrysu, układ wypieku.
// Gra bez zmian: bez flag kernele, materiały i lista kroku jak dotąd (porównanie bajt w bajt z HEAD przy wdrożeniu; tu strażnik, że flagi nie ruszają reszty).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createWokseleSolver, STATEK_SDF } from '../src/3d/woksele/solver.js';
import { createWokseleObraz } from '../src/3d/woksele/obraz.js';
import { scenaB1 } from '../src/3d/woksele/scenaBazy.js';
import { poleZMaski } from '../dema/woksele-zawalenia/atlas.js';
import { ukladSkory } from '../dema/woksele-zawalenia/skoraDema.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const camera = new THREE.PerspectiveCamera(32, 1, 20, 700000);
const wgsl = (k) => { const b = renderer.backend.createNodeBuilder(k, renderer); b.build(); return b.computeShader; };
const shadery = (o, mesh) => {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.scene = o.scene; b.camera = camera; b.material = mesh.material; b.lightsNode = renderer.lighting.getNode(o.scene);
  b.build();
  return { v: b.vertexShader, f: b.fragmentShader };
};
/** Zmienne nodeVar odczytane przed pierwszym zapisem (pułapka 39), jak w wokseleObrazWgsl.test.mjs. */
function nieprzypisane(kod) {
  const zle = [];
  for (const nazwa of new Set([...kod.matchAll(/var (nodeVar\d+)\b/g)].map((m) => m[1]))) {
    const zapis = kod.search(new RegExp(`\\b${nazwa}\\s*(\\.[xyzw]+\\s*)?=[^=]`));
    const odczyt = kod.search(new RegExp(`(?<!var )\\b${nazwa}\\b(?!\\s*(\\.[xyzw]+\\s*)?=[^=])`));
    if (odczyt >= 0 && (zapis < 0 || odczyt < zapis)) zle.push(nazwa);
  }
  return zle;
}

test('statek: bez flagi solver bez kerneli kadłuba i z tą samą listą kroku; z flagą kadłub po kI w każdym podkroku, kF i kI bez zmian', () => {
  const bez = createWokseleSolver(), z = createWokseleSolver({ statek: true });
  assert.equal(bez.statek, null);
  assert.equal(bez.kernele.kStatek, undefined);
  assert.ok(!bez.sekwencja.some(([n]) => n.startsWith('kStatek')));
  assert.equal(typeof z.statek.ustaw, 'function');
  const nazwy = z.sekwencja.map(([n]) => n);
  const ileI = nazwy.filter((n) => n === 'kI').length;
  assert.equal(nazwy.filter((n) => n === 'kStatek').length, ileI, 'kadłub w każdym podkroku');
  nazwy.forEach((n, k) => { if (n === 'kI') { assert.equal(nazwy[k + 1], 'kStatekTakt'); assert.equal(nazwy[k + 2], 'kStatek'); } });
  assert.deepEqual(nazwy.filter((n) => !n.startsWith('kStatek')), bez.sekwencja.map(([n]) => n));
  assert.equal(wgsl(z.kernele.kF), wgsl(bez.kernele.kF));
  assert.equal(wgsl(z.kernele.kI), wgsl(bez.kernele.kI));
});

test('statek: kernel kadłuba czyta pole obrysu próbką z poziomem, sumuje pęd atomikami, mieści się w 8 buforach storage, bez nieprzypisanych zmiennych', () => {
  const s = createWokseleSolver({ statek: true });
  const kod = wgsl(s.kernele.kStatek);
  assert.match(kod, /textureSampleLevel/);
  assert.match(kod, /atomicAdd/);
  assert.match(kod, /atomicLoad/, 'licznik podkroków');
  assert.ok((kod.match(/var<storage/g) || []).length <= 8);
  assert.doesNotMatch(kod, /Infinity|NaN/);
  assert.deepEqual(nieprzypisane(kod), []);
  for (const k of ['kStatekTakt', 'kStatekZeruj']) {
    const t = wgsl(s.kernele[k]);
    assert.doesNotMatch(t, /atomic</, `${k} pisze licznik bez atomików (osobny węzeł bufora)`);
  }
  assert.deepEqual([STATEK_SDF.szer, STATEK_SDF.wys], [256, 128]);
});

test('pole obrysu kadłuba: ujemne wewnątrz, dodatnie na zewnątrz, granica w pół drogi między komórkami, odległość w jednostkach przy różnych odstępach osi', () => {
  const W = 64, H = 32, hx = 640, hy = 160; // komórka 20 × 10 j.
  const m = new Uint8Array(W * H);
  // Prostokąt komórek i 16…47, j 8…23: w j. lx −320…320, ly −80…80.
  for (let j = 8; j < 24; j++) for (let i = 16; i < 48; i++) m[j * W + i] = 1;
  const p = poleZMaski(m, W, H, hx, hy);
  const at = (i, j) => p[j * W + i];
  // Środek prostokąta: najbliższa granica w y (80 j.). Komórka (32, 16) ma środek ly = 5 → do granicy 75.
  assert.ok(at(32, 16) < 0);
  assert.ok(Math.abs(-at(32, 16) - 75) <= 7.5, `środek ${at(32, 16)}`);
  // Komórki przy granicy: wewnątrz −pół odstępu, na zewnątrz +pół odstępu (± uśrednione pół komórki).
  assert.ok(at(32, 23) < 0 && at(32, 23) > -10);
  assert.ok(at(32, 24) > 0 && at(32, 24) < 10);
  // Daleko w x: 10 komórek (200 j.) za prostokątem.
  assert.ok(Math.abs(at(57, 16) - 190) <= 10, `za rufą ${at(57, 16)}`);
  // Narożnik: odległość euklidesowa, nie suma osi.
  const naroz = at(52, 28); // środek komórki (52, 28): lx 410, ly 125; narożnik prostokąta (320, 80): Δ (90, 45) → 100,6
  assert.ok(Math.abs(naroz - 100.6) <= 10, `narożnik ${naroz}`);
});

test('skóra w demie: obraz ze skórą ma cele wypieku, materiał brył i kawałków czyta skórę, kawałki biorą ścianę w spoczynku z pochodnych; bez opcji jak dotąd', () => {
  const zwykly = createWokseleObraz({ solver: createWokseleSolver({ ciagliwe: true }), camera, kawalki: true });
  assert.equal(zwykly.rtSkora, null);
  const o = createWokseleObraz({ solver: createWokseleSolver({ ciagliwe: true }), camera, kawalki: true, skora: true });
  assert.ok(o.rtSkora && o.rtSkoraCien);
  // Demo bez maski słońca gry: model światła Lamberta bez podmiany (gra: applySunShadowToBuiltinMaterial).
  assert.equal(o.mesh.material.setupLightingModel, THREE.MeshLambertNodeMaterial.prototype.setupLightingModel);
  const b = shadery(o, o.mesh);
  assert.match(b.f, /uWokSkora/);
  assert.match(b.v, /vWokS\b/);
  assert.deepEqual(nieprzypisane(b.v), [], 'wierzchołek brył');
  const k = shadery(o, o.kawalki.mesh);
  assert.match(k.v, /vWokKawS/);
  assert.match(k.f, /uWokSkora/);
  assert.match(k.f, /dpdx|dpdy/, 'ściana w spoczynku z pochodnych pozycji');
  assert.doesNotMatch(k.f, /vWokS\b/, 'kawałki nie czytają varyingów brył');
  assert.deepEqual(nieprzypisane(k.v), [], 'wierzchołek kawałków');
  const g = shadery(o, o.meshGruz);
  assert.match(g.v, /uWokSkoraMin/, 'gruz w barwie skóry');
});

test('skóra w demie: wypiek na kwadracie wokół węzłów z zapasem, wysokość z węzłów; B1R zgłasza brak bębna i koła z grubszą szyją', () => {
  const w = { n: 3, pos: new Float32Array([-1000, -200, -600, 3000, 400, 100, 500, 2200, 1500]) };
  const u = ukladSkory(w);
  assert.equal(u.w, u.h);
  assert.equal(u.w, 4000 + 1000);
  assert.deepEqual(u.srodek, [1000, 1000]);
  assert.equal(u.x0, 1000 - 2500);
  assert.equal(u.gora, 1500 + 1500);
  assert.equal(u.zakres, 3000 - (-600 - 300));
  const demo = scenaB1({ mocSzyi: 3, giecieSzyi: 1, bezBebna: true, szyjaR: 200, szyjaWnetrze: 1, stoi: true });
  assert.equal(demo.miasto.bezBebna, true);
  assert.equal(demo.miasto.kola[0], 200);
  const gra = scenaB1({});
  assert.equal(gra.miasto.bezBebna, false);
  assert.equal(gra.miasto.kola.length, 12);
});
