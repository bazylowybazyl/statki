// Ringi-archetypy (Z6, 2026-09-27): Mars = ECUMENE, Jowisz = BUDOWA (ring w budowie — tests/haloRingBudowa.test.mjs).
// Plany (czysta matematyka, bez GPU): ląd, zabudowa, kopuły,
// konstrukcja, bryły portu; port gry (płyty doków, tranzyty) wolny od
// zabudowy; płaszczyzna gry przecina tylko płytę kolizji.
// node --test tests/haloRingArch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haloRingLayoutFor } from '../src/game/haloRingPlanets.js';
import { PORT_PAD_H } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_PORT } from '../src/3d/haloRing/haloRingConfig.js';
import { archBeamMatrix, archDockBox, archMatrix } from '../src/3d/haloRing/arch/archFrame.js';
import { buildArchPortBodies } from '../src/3d/haloRing/arch/archPort.js';
import {
  ECU_DISTRICTS,
  ECU_DOME_PLANS,
  buildEcumeneDomes,
  buildEcumeneInstances,
  buildEcumeneStructure,
  createEcumenePlan
} from '../src/3d/haloRing/arch/ecumenePlan.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lights = () => ({ n: 0, pos: [], add(x, y, z) { this.n++; this.pos.push(x, y, z); } });
const mars = haloRingLayoutFor({ id: 'mars' });
const jupiter = haloRingLayoutFor({ id: 'jupiter' });

// środki instancji partii (ArchBatch.m: macierz 16, przesunięcie w 12–14)
function* centers(batch) {
  for (let i = 0; i < batch.count; i++) {
    const o = i * 16;
    yield [batch.m[o + 12], batch.m[o + 13], batch.m[o + 14], i];
  }
}
const allFinite = (batch) => batch.m.every(Number.isFinite) && batch.c.every(Number.isFinite) && batch.a.every(Number.isFinite);

test('rama archetypu: prawoskrętna, góra od planety, belka od p0 do p1', () => {
  const m = new Array(16);
  archMatrix(1000, 0, 5, 20, 2, 3, 4, 0, m);
  assert.deepEqual([m[12], m[13], m[14]], [1020, 0, 5]);
  assert.deepEqual([m[0], m[1]].map((v) => Math.round(v * 1000) / 1000), [-0, 2]);   // styczna
  assert.deepEqual([m[4], m[5]].map((v) => Math.round(v)), [3, 0]);                   // góra = +r
  assert.equal(m[10], -4);                                                          // −oś
  // prawoskrętność: (X × Y) · Z > 0
  const X = [m[0], m[1], m[2]];
  const Y = [m[4], m[5], m[6]];
  const Z = [m[8], m[9], m[10]];
  const cr = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  assert.ok(cr[0] * Z[0] + cr[1] * Z[1] + cr[2] * Z[2] > 0);
  archBeamMatrix({ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 40 }, 2, m);
  assert.deepEqual([m[4], m[5], m[6]].map((v) => Math.round(v)), [0, 30, 40]);
  archDockBox(0, 1000, 10, 50, -5, 4, 6, 8, m);
  assert.deepEqual([m[12], m[13], m[14]], [1050, 10, -5]);
  assert.equal(m[6], 8);
});

test('ECUMENE: ląd z dema (morze PELAGIC, jeziora, kwartały), wszystko skończone', () => {
  const plan = createEcumenePlan(mars);
  // ring mniejszy niż ziemski (2026-10-21): wstęga 3 200, podłoga 2 780, kadłub 600 — mapa dzielnic dema przycięta
  assert.equal(plan.W, 2780);
  assert.equal(plan.section.KH, 600 / 1600);
  assert.ok(plan.stretch > 1 && plan.stretch < 2);
  // PELAGIC (id 9): środek dzielnicy to morze; HELIX (id 0): plac w centrum
  assert.ok(plan.waterField(plan.LEN * 0.5, 0, 9) < 0);
  assert.equal(plan.districtType(plan.LEN * 0.48, -30 * 3, 0), 7);
  // arterie: w demie z = ±850 × 3, na węższej wstędze tyle samo od krawędzi podłogi
  assert.equal(plan.zArt, plan.HW - 200 * 3);
  assert.equal(plan.districtType(plan.LEN * 0.3, plan.zArt, 4), 6);
  const inst = buildEcumeneInstances(plan);
  assert.ok(inst.stats.buildings > 600, `budynki ${inst.stats.buildings}`);
  assert.ok(inst.stats.trees > 4000, `drzewa ${inst.stats.trees}`);
  // zabudowa dzielnic tylko na podłodze
  for (const B of inst.per) for (const b of [B.box, B.cyl, B.tree]) for (const [, , z] of centers(b)) assert.ok(Math.abs(z) < plan.HW, `bryła poza podłogą z = ${z}`);
  for (const B of inst.per) for (const b of [B.box, B.cyl, B.tree]) assert.ok(allFinite(b));
  const L = lights();
  const domes = buildEcumeneDomes(plan, inst.per, L);
  // kopuły dema: te na porcie przesunięte wzdłuż dzielnicy; na węższej wstędze dwie w dzielnicach kompleksów portu
  // (ELYSIUM, UTOPIA) nie mają miejsca obok płyt — reszta stoi
  assert.ok(domes.length >= ECU_DOME_PLANS.length - 2, `kopuły ${domes.length}`);
  for (const d of domes) {
    assert.equal(plan.portClass(d.theta, d.z, d.r), 0, `${d.name} pod dokiem`);
    assert.ok(Math.abs(d.z) + d.r < plan.HW, `${d.name} na podłodze`);
    assert.ok(Number.isFinite(d.s) && Number.isFinite(d.t) && d.h > 0, 'pola presetów dema');
  }
  assert.equal(ECU_DISTRICTS.length, 12);
});

test('ECUMENE: port gry wolny — płyty płaskie, bez zabudowy i drzew; teren kolizji', () => {
  const plan = createEcumenePlan(mars);
  const inst = buildEcumeneInstances(plan);
  let onPad = 0;
  for (const B of inst.per) {
    for (const b of [B.box, B.tree]) {
      for (const [x, y, z] of centers(b)) {
        const th = Math.atan2(y, x);
        if (plan.portClass(th, z) === 2) onPad++;
      }
    }
  }
  assert.equal(onPad, 0, 'bryły na płytach doków');
  // płyty: płasko na PORT_PAD_H, poza nimi teren z dema (wzgórza ≤ ~200)
  let maxH = 0;
  for (let i = 0; i < 4000; i++) {
    const th = (i / 4000) * Math.PI * 2;
    const h = plan.heightAt(th, 0);
    if (plan.portClass(th, 0) === 2) assert.equal(h, PORT_PAD_H);
    maxH = Math.max(maxH, h);
  }
  assert.ok(maxH < 300, `teren na z = 0 do ${maxH}`);
});

test('ECUMENE: konstrukcja — żebra co segment, radiatory na skrzydłach, FG po stronie +z', () => {
  const plan = createEcumenePlan(mars);
  const st = buildEcumeneStructure(plan);
  assert.equal(st.ribs % 12, 0);
  assert.ok(st.ribs > 384, 'gęstość dema na dłuższym obwodzie');
  assert.ok(st.radiators >= 48);
  assert.ok(allFinite(st.bg) && allFinite(st.fg));
  for (const [, , z] of centers(st.fg)) assert.ok(z > mars.z.topIn - 1, 'FG tylko nad płaszczyzną gry');
  // żebra pod podłogą nie przecinają płaszczyzny gry w tranzytach
  for (const [x, y, z] of centers(st.bg)) {
    const th = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    if (Math.abs(z) < 1 && r < plan.R - 1000) assert.notEqual(plan.portClass(th, 0, 40), 2, 'żebro w tranzycie');
  }
});

test('bryły portu: 8 zatok (za krawędzią ringu, na pylonach z płyty portu) i 4 tranzyty w stylu dema', () => {
  for (const [L, dress] of [[mars, 'ecumene'], [jupiter, 'budowa']]) {
    const p = buildArchPortBodies(L, L.planetProfile.port, dress);
    assert.ok(p.solid.count > 8 * 40 + 4 * 20, `${dress}: brył ${p.solid.count}`);
    assert.ok(allFinite(p.solid));
    for (const [x, y] of centers(p.solid)) {
      const r = Math.hypot(x, y);
      // od kadłuba (tranzyty) do wylotu zatoki stojącej dockGap za krawędzią ścian
      assert.ok(r > L.radii.back - 400 && r < L.radii.rim + HALO_PORT.dockGap + HALO_PORT.bayDepth + 300, `${dress}: bryła na r = ${r.toFixed(0)}`);
    }
    assert.ok(p.lights.length > 100);
  }
});

test('shadery archetypów (TSL, zadanie 10): bez GLSL, precyzja (modelViewMatrix), ziarno kwantowane, bez udawanego ruchu', () => {
  // dawne archGLSL.js zastąpione archTSL.js (odpowiedniki TSL dawnych reguł; WGSL — tests/haloRingK7ArchTSL.test.mjs)
  const files = ['archTSL.js', 'archMaterials.js', 'ecumene.js', 'budowa.js', 'budowaPlan.js', 'archRing.js'];
  // kod bez komentarzy (komentarze opisują dawne nazwy GLSL, np. gl_PointSize)
  const src = files.map((f) => read(`src/3d/haloRing/arch/${f}`).replace(/\/\/.*$/gm, '')).join('\n');
  assert.doesNotMatch(src, /\/\* glsl \*\/|new THREE\.ShaderMaterial|gl_FragColor|gl_Position|gl_PointSize|from '\.\.\/haloRingGLSL\.js'|from '\.\/archGLSL\.js'/, 'bez GLSL');
  // pozycje przez modelViewMatrix (three składa go w double; ring przy planecie miliony j. od zera) — nie
  // modelWorldMatrix · pozycja we float32
  assert.doesNotMatch(src, /modelWorldMatrix\.mul\(/, 'pozycje świata we float32');
  const lib = read('src/3d/haloRing/arch/archTSL.js');
  assert.ok((lib.match(/cameraProjectionMatrix\.mul\(modelViewMatrix\.mul\(/g) || []).length >= 4, 'wierzchołki przez modelViewMatrix');
  // ziarno instancji kwantowane (szum okien z interpolacji „stałego” atrybutu): floor(vInst.y · 1000 + 0,5)
  assert.match(lib, /const seedI = floor\(mad\(vInst\.y, 1000\.0, 0\.5\)\)/);
  // partie instancji bez THREE.InstancedMesh (uuid w kluczu programu = NodeBuilder na partię), światła bez THREE.Points
  // (punkt WebGPU ma 1 px)
  assert.doesNotMatch(src, /new THREE\.InstancedMesh\(|new THREE\.Points\(/);
});

test('gra: klej tworzy ring-archetyp dla Marsa i Jowisza, Ziemia zostaje na silniku Halo', () => {
  const src = read('src/3d/haloRing/haloRingGame.js');
  assert.match(src, /import \{ createArchRing \} from '\.\/arch\/archRing\.js'/);
  assert.match(src, /archetype === 'halo' \? createHaloRing : createArchRing/);
  const arch = read('src/3d/haloRing/arch/archRing.js');
  for (const api of ['update(dt, view)', 'setSun(azimuth, elevation)', 'setCutaway(index, cut)', 'setLayers(map = {})', 'terrainHeightAt(x, y, z)', 'get k7Halls()', 'dispose()']) {
    assert.ok(arch.includes(api), `archRing: ${api}`);
  }
  // jedyny renderer = Core3D (AGENTS.md)
  assert.doesNotMatch(arch + read('src/3d/haloRing/arch/ecumene.js') + read('src/3d/haloRing/arch/budowa.js'), /new THREE\.WebGLRenderer/);
});
