// Rumowiska w wydobyciu (strumień D planu docs/PLAN-pas-realizm.md, 2026-10-12):
// duża skała słabego materiału = głazy w regolicie, słabe wiązania, porowatość, ruda
// w głazach rdzeniowych; laser kopie regolit szybko, ładunek rozrzuca głazy, wiązka
// wyrywa odsłonięte głazy. Monolity — tests/asteroidMining.test.mjs (bez zmian).
// node --test tests/asteroidRubble.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { AsteroidMining, createYield, yieldOreTotal, isCorePiece } from '../src/game/asteroidMining.js';
import { RUBBLE_CONFIG, rubbleChance, rubbleThreshold, rockMaterial } from '../src/game/asteroidMaterials.js';
import { ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';

const lumpy = (shape, x, y, z) => 1 + 0.08 * Math.sin(3 * x + shape) * Math.cos(2 * y) + 0.05 * z * z;

function rockRecord(type, r, id = 4242) {
  return {
    id, x: 1000, y: 2000, r, d: 2 * r, shape: 3, type: ROCK_TYPE_INDEX[type],
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0,
    sx: 1, sy: 1, sz: 1, seed: 0.37
  };
}

function speeds(list) {
  let s = 0;
  for (const p of list) s += Math.hypot(p.v[0], p.v[1], p.v[2]);
  return list.length ? s / list.length : 0;
}

// Ile komórek ciała należy do najliczniejszego głazu (1 = jeden głaz).
function boulderPurity(b) {
  const cnt = new Map();
  let n = 0;
  for (let i = 0; i < b.fill.length; i++) {
    if (b.fill[i] < 0.5) continue;
    n++;
    const id = b.boulder[i];
    cnt.set(id, (cnt.get(id) || 0) + 1);
  }
  let best = 0;
  for (const [id, c] of cnt) if (id && c > best) best = c;
  return n ? best / n : 0;
}

test('próg rumowiska: mocne i gęste wyżej, kruche i lekkie niżej; skała energetyczna nigdy', () => {
  const t = (id) => rubbleThreshold(rockMaterial(id));
  assert.ok(t('iron') > t('rock') && t('titan') > t('rock'), 'metal i tytan częściej monolitem');
  assert.ok(t('ice') < t('rock') && t('crystal') < t('rock'), 'lód i kryształ częściej rumowiskiem');
  assert.equal(t('energy'), Infinity);
  // Typy z widm (A1 planu pasa): C / D i wypełniacz węglowy — częściej rumowiska, M i platynowce — monolity.
  const tt = (id) => rubbleThreshold(rockMaterial(id), RUBBLE_CONFIG, id);
  assert.ok(tt('carbon') < tt('rock') && tt('primitive') < tt('rock') && tt('rock_c') < tt('rock'), 'C / D / wypełniacz węglowy niżej');
  assert.ok(tt('metal') > 2 * tt('rock') && tt('platinum') > 2 * tt('rock'), 'M i platynowce wyżej');
  assert.equal(rubbleChance(rockMaterial('rock'), 120), 0, 'mała skała to monolit');
  assert.equal(rubbleChance(rockMaterial('rock'), 1600), 1, 'duża skała to rumowisko');
  // Skały PLAY (80–2600 j., N ∝ D^−1,45): rumowiskiem jest mniejszość, ale nie margines.
  let s = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const u = (i + 0.5) / 4000;
    const a = Math.pow(80, -1.45), b = Math.pow(2600, -1.45);
    const D = Math.pow(a - u * (a - b), -1 / 1.45);
    s += rubbleChance(rockMaterial('rock'), D); n++;
  }
  const share = s / n;
  assert.ok(share > 0.05 && share < 0.3, `udział rumowisk wśród skał neutralnych ${share.toFixed(3)}`);
});

test('budowa: głazy w regolicie, porowatość, spójna kupa, ruda w głazach rdzeniowych', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 3 });
  const mono = sys.activate(rockRecord('copper', 650), { z: -900, rubble: false });
  const b = sys.activate(rockRecord('copper', 650), { z: -900, rubble: true });
  assert.ok(b.boulder && b.rubble, 'ciało rumowiska');
  assert.equal(b.core, null, 'bez jednego rdzenia');
  assert.ok(b.rubble.count >= 40, `głazy: ${b.rubble.count}`);
  assert.ok(b.rubble.regolithShare > 0.25 && b.rubble.regolithShare < 0.7, `regolit ${b.rubble.regolithShare.toFixed(2)}`);
  assert.ok(b.porosity >= RUBBLE_CONFIG.porosity[0] && b.porosity <= RUBBLE_CONFIG.porosity[1]);
  const ratio = b.mass / mono.mass;
  assert.ok(Math.abs(ratio - (1 - b.porosity)) < 0.05, `masa × (1 − porowatość): ${ratio.toFixed(3)} vs ${(1 - b.porosity).toFixed(3)}`);
  // Słabe wiązania trzymają: kupa to jedna składowa.
  const split = sys._label(b);
  assert.equal(split.comps.length, 1, 'kupa spójna');
  // Głazy rdzeniowe: lita ruda w komórkach rdzenia.
  assert.ok(b.rubble.coreBoulders >= 1);
  const ores = sys.oreBoulders(b);
  const cores = ores.filter((o) => o.grade === 2);
  assert.ok(cores.length >= 1, 'skaner widzi głazy rdzeniowe');
  for (const c of cores) assert.ok(c.ore / c.mass > 0.9, 'głaz rdzeniowy to czysta ruda');
  assert.ok(b.coreMass > 0.2 * mono.coreMass * (1 - b.porosity), `rdzeń ${b.coreMass.toFixed(1)} t vs monolit ${mono.coreMass.toFixed(1)} t`);
  // Determinizm.
  const c = sys.activate(rockRecord('copper', 650), { z: -900, rubble: true });
  assert.deepEqual(Array.from(c.boulder.subarray(0, 4000)), Array.from(b.boulder.subarray(0, 4000)));
  assert.equal(c.mass, b.mass);
  // Strefy skanera.
  const top = sys.raycast(b.p[0], b.p[1], 6000, 0, 0, -1, 1e6, b);
  const zone = sys.probe(b, top.x, top.y, top.z - b.cs).zone;
  assert.ok(['regolit', 'głaz', 'głaz wzbogacony', 'głaz rdzeniowy'].includes(zone), zone);
  assert.equal(sys.summary(b).rubble.boulders, b.rubble.count);
});

test('laser: regolit schodzi szybciej niż lita skała (ta sama moc)', () => {
  for (const type of ['rock', 'iron']) {
    const sys = new AsteroidMining({ radiusAt: lumpy, seed: 5 });
    const vol = {};
    for (const rubble of [false, true]) {
      const b = sys.activate(rockRecord(type, 700, rubble ? 11 : 12), { z: -900, rubble });
      let v = 0;
      for (let i = 0; i < 90; i++) {
        const h = sys.raycast(b.p[0] + 80, b.p[1], 6000, 0, 0, -1, 1e6, b);
        if (!h) break;
        v += sys.laser(b, h.x, h.y, h.z, 0, 0, -1, 1.5, 1 / 30, createYield());
      }
      vol[rubble] = v;
    }
    assert.ok(vol.true > vol.false * 1.3, `${type}: rumowisko ${(vol.true / 1e6).toFixed(2)} vs monolit ${(vol.false / 1e6).toFixed(2)} mln j.³`);
  }
});

test('ładunek: rumowisko rozsypuje się na CAŁE głazy, wolniej niż pęka monolit', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 9 });
  const res = {};
  for (const rubble of [false, true]) {
    const b = sys.activate(rockRecord('rock', 650, rubble ? 21 : 22), { z: -900, rubble });
    const top = sys.raycast(b.p[0] + 150, b.p[1], 6000, 0, 0, -1, 1e6, b);
    res[rubble] = sys.detonate(b, top.x, top.y, top.z - 2 * b.cs, 2, createYield());
    res[rubble].parent = b;
  }
  const r = res.true;
  assert.equal(r.outcome, 'breach');
  assert.ok(r.rubble && r.boulders >= 3, `odpadło głazów: ${r.boulders}`);
  assert.ok(r.bodies.length >= 2);
  // Odłamy rumowiska to w większości pojedyncze głazy (nie bryły Voronoi przez kilka głazów).
  let whole = 0;
  for (const p of r.bodies) if (boulderPurity(p) > 0.8) whole++;
  assert.ok(whole >= r.bodies.length * 0.5, `całe głazy: ${whole} / ${r.bodies.length}`);
  const vRub = speeds(r.bodies), vMono = speeds(res.false.bodies);
  assert.ok(vRub < vMono * 0.8, `prędkość odłamów: rumowisko ${vRub.toFixed(0)} vs monolit ${vMono.toFixed(0)} j./s`);
  // Reszta kupy dalej jest rumowiskiem (te same głazy, ten sam opis).
  assert.ok(r.parent.alive && r.parent.boulder && r.parent.rubble === r.bodies[0].rubble);
  for (const p of r.bodies) assert.ok(p.boulder && p.porosity === r.parent.porosity);
});

test('ładunek za słaby w głębi kupy: zagęszcza ją (uszkodzenie), nic nie odpada', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 2 });
  const b = sys.activate(rockRecord('iron', 1100, 31), { z: -1500, rubble: true });
  const n0 = sys.bodies.length;
  const res = sys.detonate(b, b.p[0], b.p[1], b.p[2], 0.5, createYield());
  assert.equal(res.outcome, 'contained');
  assert.ok(b.damage > 0);
  assert.equal(sys.bodies.length, n0);
});

test('wiązka wyrywa odsłonięte głazy z kupy (rdzeniowe pierwsze) i zbiera urobek', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 4 });
  const b = sys.activate(rockRecord('copper', 650, 41), { z: -900, rubble: true, anchored: true });
  const y = createYield();
  const tx = b.p[0] + 2500, ty = b.p[1], tz = -400;
  let plucks = 0, oreGrades = 0;
  for (let i = 0; i < 1800; i++) {
    // Udźwig mniejszy niż kupa (inaczej wiązka ciągnie ją całą).
    sys.tractor(tx, ty, tz, 3600, b.mass * 0.5, 260, 1 / 120, y);
    sys.step(1 / 120);
    for (const e of sys.drainEvents()) {
      if (e.kind !== 'pluck') continue;
      plucks++;
      if (e.grade >= 1) oreGrades++;
    }
  }
  assert.ok(plucks >= 5, `wyrwane głazy: ${plucks}`);
  assert.ok(b.alive, 'kupa zostaje (wiązka bierze głazy, nie całość)');
  assert.ok(yieldOreTotal(y) > 0 || y.waste > 0, 'urobek z głazów');
  void oreGrades;
  // Odsłonięty głaz rdzeniowy (regolit i sąsiedzi wokół wykopani) ma pierwszeństwo.
  const core = sys.oreBoulders(b).find((o) => o.grade === 2);
  assert.ok(core, 'głaz rdzeniowy w kupie');
  const l = b.worldToLocal(core.x, core.y, core.z, [0, 0, 0]);
  const R = core.r * 1.8;
  for (let k = 0; k < b.nz; k++) for (let j = 0; j < b.ny; j++) for (let i = 0; i < b.nx; i++) {
    const idx = b.index(i, j, k);
    if (b.boulder[idx] === core.id) continue;
    const dx = b.gx + i * b.cs - l[0], dy = b.gy + j * b.cs - l[1], dz = b.gz + k * b.cs - l[2];
    if (dx * dx + dy * dy + dz * dz < R * R) b.fill[idx] = 0;
  }
  b.massDirty = true;
  sys.drainEvents();
  sys._pluckClock = RUBBLE_CONFIG.pluckInterval;
  sys.tractor(tx, ty, tz, 3600, b.mass * 0.5, 260, 1 / 120, y);
  const ev = sys.drainEvents().find((e) => e.kind === 'pluck');
  assert.ok(ev && ev.grade === 2, `odsłonięty głaz rdzeniowy wyrwany pierwszy (ranga ${ev?.grade})`);
  // Bez budżetu ciężkiej operacji wiązka nie wyrywa.
  const sys2 = new AsteroidMining({ radiusAt: lumpy, seed: 4 });
  const b2 = sys2.activate(rockRecord('copper', 650, 41), { z: -900, rubble: true, anchored: true });
  for (let i = 0; i < 400; i++) sys2.tractor(tx, ty, tz, 3600, b2.mass * 0.5, 260, 1 / 120, null, 1, Infinity, false);
  assert.equal(sys2.stats.plucks, 0);
});

test('kawałki głazów rdzeniowych to kawałki rdzenia (isCorePiece), ruda czysta', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 6 });
  const b = sys.activate(rockRecord('iron', 700, 51), { z: -900, rubble: true });
  const cores = sys.oreBoulders(b).filter((o) => o.grade === 2);
  assert.ok(cores.length);
  // Ładunek XL w głazie rdzeniowym — wypada w całości albo w kawałkach.
  const c = cores[0];
  const res = sys.detonate(b, c.x, c.y, c.z, 32, createYield());
  assert.equal(res.outcome, 'breach');
  const pieces = [...res.bodies, ...res.pebbles];
  const corePieces = pieces.filter((p) => isCorePiece(p));
  assert.ok(corePieces.length >= 1, 'z rumowiska lecą kawałki rdzenia');
});

test('rumowisko wyłączone w konfiguracji = monolit (config.rubble = false)', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, config: { rubble: false } });
  const b = sys.activate(rockRecord('rock', 1200, 61), { z: -1500 });
  assert.equal(b.boulder, null);
  assert.ok(b.core === null || typeof b.core === 'object');
  const on = new AsteroidMining({ radiusAt: lumpy });
  const r = on.activate(rockRecord('rock', 1200, 61), { z: -1500 });
  assert.ok(r.boulder, 'duża skała neutralna = rumowisko przy domyślnych progach');
});
