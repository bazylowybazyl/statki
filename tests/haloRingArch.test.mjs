// Ringi-archetypy (Z6, 2026-09-27): Mars = ECUMENE, Jowisz = ring Fable.
// Plany z dem (czysta matematyka, bez GPU): ląd, zabudowa, kopuły,
// konstrukcja, bryły portu; port gry (płyty doków, tranzyty) wolny od
// zabudowy; płaszczyzna gry przecina tylko płytę kolizji.
// node --test tests/haloRingArch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haloRingLayoutFor } from '../src/game/haloRingPlanets.js';
import { PORT_PAD_H } from '../src/3d/haloRing/haloRingRoofPlan.js';
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
import { FZ, buildFableCity, buildFableDomes, buildFableStructure, createFablePlan } from '../src/3d/haloRing/arch/fablePlan.js';

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
  assert.equal(plan.W, 6300);
  assert.ok(plan.stretch > 1 && plan.stretch < 2);
  // PELAGIC (id 9): środek dzielnicy to morze; HELIX (id 0): plac w centrum
  assert.ok(plan.waterField(plan.LEN * 0.5, 0, 9) < 0);
  assert.equal(plan.districtType(plan.LEN * 0.48, -30 * 3, 0), 7);
  // arterie z = ±850 × 3
  assert.equal(plan.districtType(plan.LEN * 0.3, 850 * 3, 4), 6);
  const inst = buildEcumeneInstances(plan);
  assert.ok(inst.stats.buildings > 3000, `budynki ${inst.stats.buildings}`);
  assert.ok(inst.stats.trees > 15000, `drzewa ${inst.stats.trees}`);
  for (const B of inst.per) for (const b of [B.box, B.cyl, B.tree]) assert.ok(allFinite(b));
  const L = lights();
  const domes = buildEcumeneDomes(plan, inst.per, L);
  // wszystkie 12 kopuł dema: te na porcie przesunięte wzdłuż dzielnicy albo za płyty
  assert.equal(domes.length, ECU_DOME_PLANS.length, `kopuły ${domes.length}`);
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

test('Fable: strefy dema (12 układów × 2), zabudowa per komórka, port wolny', () => {
  const plan = createFablePlan(jupiter);
  assert.equal(plan.W, 5400);
  assert.equal(plan.N, 24);
  const zm = plan.bakeZoneMap(1024, 64);
  const types = new Set();
  for (let i = 0; i < zm.length; i += 4) types.add((zm[i] - 8) / 16);
  for (const t of [FZ.WATER, FZ.PARK, FZ.FOREST, FZ.FARM, FZ.RESIDENTIAL, FZ.CITY, FZ.CORE, FZ.INDUSTRIAL, FZ.PORT, FZ.TECH, FZ.PAD]) {
    assert.ok(types.has(t), `strefa ${t}`);
  }
  const city = buildFableCity(plan);
  assert.ok(city.stats.buildings > 20000, `budynki ${city.stats.buildings}`);
  assert.ok(city.stats.trees > 50000, `drzewa ${city.stats.trees}`);
  let onPad = 0;
  for (const B of city.per) {
    assert.ok(allFinite(B.box) && allFinite(B.tree));
    for (const b of [B.box, B.tree]) for (const [x, y, z] of centers(b)) if (plan.portClass(Math.atan2(y, x), z) === 2) onPad++;
  }
  assert.equal(onPad, 0, 'bryły na płytach doków');
  assert.ok(plan.domes.length >= 10);
  for (const d of plan.domes) assert.equal(plan.portClass(d.theta, d.u, d.r), 0);
  const L = lights();
  const domes = buildFableDomes(plan, city.per, L);
  assert.equal(domes.length, plan.domes.length);
  assert.ok(L.n > 100);
});

test('Fable: konstrukcja jedną partią na stronę; kadłub z żebrami mieści się w płycie kolizji', () => {
  const plan = createFablePlan(jupiter);
  const L = lights();
  const st = buildFableStructure(plan, L);
  assert.equal(st.bg.struct, st.bg.all);
  assert.ok(st.bg.all.count > 5000 && st.fg.all.count > 500);
  assert.ok(allFinite(st.bg.all) && allFinite(st.fg.all));
  // w płaszczyźnie gry (|z| małe) pod podłogą: nic głębiej niż płyta kolizji
  const hull = jupiter.radii.floorMid - jupiter.radii.back;
  for (const [x, y, z] of centers(st.bg.all)) {
    if (Math.abs(z) > 60) continue;
    const r = Math.hypot(x, y);
    assert.ok(r > plan.R - hull - 5, `bryła pod płytą na z≈0: h = ${(r - plan.R).toFixed(0)}`);
  }
  for (const [, , z] of centers(st.fg.all)) assert.ok(z > jupiter.z.topIn - 1);
  assert.ok(L.n > 3000, 'światła pozycyjne');
});

test('bryły portu: 8 zatok i 4 tranzyty w stylu dema, przy podłodze', () => {
  for (const [L, dress] of [[mars, 'ecumene'], [jupiter, 'fable']]) {
    const p = buildArchPortBodies(L, L.planetProfile.port, dress);
    assert.ok(p.solid.count > 8 * 40 + 4 * 20, `${dress}: brył ${p.solid.count}`);
    assert.ok(allFinite(p.solid));
    for (const [x, y] of centers(p.solid)) {
      const r = Math.hypot(x, y);
      assert.ok(r > L.radii.back - 400 && r < L.radii.floorMid + 4500, `${dress}: bryła na r = ${r.toFixed(0)}`);
    }
    assert.ok(p.lights.length > 100);
  }
});

test('shadery archetypów: pułapki ANGLE, precyzja (modelViewMatrix), bez udawanego ruchu', () => {
  const glsl = read('src/3d/haloRing/arch/archGLSL.js') + read('src/3d/haloRing/arch/ecumene.js') + read('src/3d/haloRing/arch/fable.js');
  assert.doesNotMatch(glsl, /\bflat\b\s*[=;,)]/, 'słowo zarezerwowane flat');
  assert.doesNotMatch(glsl, /modelMatrix\s*\*\s*vec4/, 'pozycje świata we float32 (ring przy planecie miliony j. od zera)');
  // ziarno instancji kwantowane (szum okien z interpolacji „stałego” atrybutu)
  assert.match(read('src/3d/haloRing/arch/archGLSL.js'), /floor\(vInst\.y \* 1000\.0 \+ 0\.5\)/);
  // ring nie udaje życia: bez smug ruchu aut i impulsów maglevu dema
  assert.doesNotMatch(read('src/3d/haloRing/arch/fable.js'), /traffic1|traffic2|uTime \* 2\.2/);
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
  assert.doesNotMatch(arch + read('src/3d/haloRing/arch/ecumene.js') + read('src/3d/haloRing/arch/fable.js'), /new THREE\.WebGLRenderer/);
});
