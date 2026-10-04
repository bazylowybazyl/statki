import test from 'node:test';
import assert from 'node:assert/strict';

// Przebicia pocisków przez kadłuby belkowe (src/game/projectileMechanics.js, zadanie 18-A;
// decyzje docs/webgpu/PROJEKT-BRONI.md §2.3, §5 p. 2, 7): Mjolnir przechodzi przez wszystko
// bez utraty energii (≤ 10 kadłubów), Valkyrie ma 260 j. materiału i hamuje, N-ty kadłub
// zatrzymuje pocisk, krater wyjścia = 0,5 × obrażeń po rozliczeniu, zakleszczenie = krater
// 0,5 × energii niesionej w kadłubie. Przepływ jak w 18-B: tests/helpers/hullFlight.mjs.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const M = await import('../src/game/projectileMechanics.js');
const { createShot, flyShot, ledgerFor } = await import('./helpers/hullFlight.mjs');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const LONG = plate(400, 200);
const THIN = plate(160, 80);
const THICK = plate(600, 300);
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, ...extra });
const MJOLNIR = MASTER_WEAPONS.siege_railgun;
const VALKYRIE = MASTER_WEAPONS.special_valkyrie_railgun;

function hullsAt(image, points) {
  return points.map(([x, y]) => { const e = npcAt(x, y); HullBodies.createHull(e, image); return e; });
}
const releaseAll = (list) => { for (const e of list) HullBodies.release(e); for (const w of window.wrecks) HullBodies.release(w); window.wrecks.length = 0; };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('dane: Mjolnir bez limitu materiału i hamowania, Valkyrie 260 j. i 0,35; limit kadłubów = penetration', () => {
  assert.equal(M.penetrationDepthOf(MJOLNIR), Infinity);
  assert.equal(MJOLNIR.penSpeedLoss, 0);
  assert.equal(M.penetrationLimitOf(MJOLNIR), 10);
  assert.equal(M.penetrationDepthOf(VALKYRIE), 260);
  assert.equal(VALKYRIE.penSpeedLoss, 0.35);
  assert.equal(M.penetrationLimitOf(VALKYRIE), 3);
  // Reszta arsenału nie przebija kadłubów (dzisiejsze `penetration` Tempesta, Heliosa, Yamato
  // działało tylko na cele bez kadłuba — projectileTrajectory.js).
  // Warianty rozmiarowe Valkyrie (broń special mniejszych klas): płytszy budżet materiału, to samo hamowanie.
  for (const [id, depth, limit] of [['special_valkyrie_s', 60, 2], ['special_valkyrie_m', 140, 3]]) {
    const def = MASTER_WEAPONS[id];
    assert.equal(M.penetrationDepthOf(def), depth, id);
    assert.equal(def.penSpeedLoss, VALKYRIE.penSpeedLoss, id);
    assert.equal(M.penetrationLimitOf(def), limit, id);
    assert.equal(M.hasHullMechanics(def), true, id);
  }
  const piercing = new Set(['siege_railgun', 'special_valkyrie_railgun', 'special_valkyrie_s', 'special_valkyrie_m']);
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (piercing.has(id)) continue;
    assert.equal(M.penetrationDepthOf(def), 0, `${id} nie przebija`);
  }
});

test('Mjolnir: pełne obrażenia w każdym kadłubie w linii, krater wyjścia 0,5 ×, rzaz co 22 j.', () => {
  const hulls = hullsAt(LONG, [[0, 0], [700, 0], [1400, 0]]);
  try {
    const before = hulls.map((e) => e.beamHull.body.activeNodes);
    const ledger = new Map();
    const b = createShot(MJOLNIR, -2000, 10, 1, 0, 7);
    const log = flyShot(b, MJOLNIR, hulls, { ledger });
    assert.deepEqual(log.map((l) => l.type), ['enter', 'exit', 'enter', 'exit', 'enter', 'exit']);
    for (const e of hulls) {
      const rec = ledgerFor(ledger, e);
      assert.equal(rec.hp, 2500, 'pełne 2500 HP w każdym kadłubie');
      assert.equal(rec.entries, 1); assert.equal(rec.exits, 1);
      // Droga w płycie ~400 j. → ~18 znaków rzazu.
      assert.ok(rec.kerfs >= 16 && rec.kerfs <= 19, `rzaz co 22 j.: ${rec.kerfs}`);
      assert.ok(rec.killed >= 8, `krater wejścia i wyjścia zabijają węzły: ${rec.killed}`);
    }
    for (const ex of log.filter((l) => l.type === 'exit')) {
      assert.equal(ex.damage, 2500, 'bez utraty energii');
      assert.equal(ex.crater, 1250, 'krater wyjścia = 0,5 × obrażeń');
      assert.ok(ex.killed > 0, 'krater wyjścia zabija węzły (sufit HP)');
    }
    near(Math.hypot(b.vx, b.vy), MJOLNIR.baseSpeed, 1e-9, 'Mjolnir nie hamuje');
    assert.equal(b.pen.count, 3);
    assert.ok(hulls.every((e, k) => e.beamHull.body.activeNodes < before[k]));
  } finally { releaseAll(hulls); }
});

test('Mjolnir: N-ty kadłub (penetration = 10) zatrzymuje pocisk — jedenasty nietknięty', () => {
  const hulls = hullsAt(THIN, Array.from({ length: 11 }, (_, k) => [k * 400, 0]));
  try {
    const ledger = new Map();
    const b = createShot(MJOLNIR, -1000, 3, 1, 0, 3);
    const log = flyShot(b, MJOLNIR, hulls, { ledger });
    const hitHulls = hulls.filter((e) => ledgerFor(ledger, e).hp > 0);
    assert.equal(hitHulls.length, 10, 'obrażenia w 10 kadłubach');
    assert.equal(log.at(-1).type, 'hit', 'dziesiąty kadłub zatrzymuje');
    assert.equal(log.at(-1).entity, hulls[9]);
    assert.equal(ledgerFor(ledger, hulls[10]).hp, 0);
    assert.equal(b.dead, true);
  } finally { releaseAll(hulls); }
});

test('Valkyrie: cienkie kadłuby na wylot z malejącą energią, trzeci zatrzymuje; energia = dmg0·(v/v0)²·(left/260)', () => {
  const hulls = hullsAt(THIN, [[0, 0], [0, 400], [0, 800]]);
  try {
    const ledger = new Map();
    const b = createShot(VALKYRIE, 5, -2000, 0, 1, 9);
    const log = flyShot(b, VALKYRIE, hulls, { ledger });
    assert.deepEqual(log.map((l) => l.type), ['enter', 'exit', 'enter', 'exit', 'hit']);
    const [, exit1, , exit2, stop] = log;
    // Płyta 80 px (siatka ~87 j.) + zasięg sondy: ~90 j. materiału na kadłub.
    assert.ok(exit1.damage < 500 && exit1.damage > 250, `po pierwszym kadłubie: ${exit1.damage}`);
    assert.ok(exit2.damage < exit1.damage && exit2.damage > 60, `po drugim: ${exit2.damage}`);
    assert.equal(stop.damage, exit2.damage, 'trzeci kadłub dostaje rozliczone obrażenia');
    assert.equal(exit1.crater, exit1.damage * 0.5);
    // Wzór rozliczenia na stanie pocisku po drugim wyjściu.
    const speed = Math.hypot(b.vx, b.vy);
    near(exit2.damage, 500 * (speed / 15000) ** 2 * (b.pen.left / 260), 1e-9, 'dmg0 · (v/v0)² · (left/penDepth)');
    near(speed, 15000 * Math.exp(-0.35 * 6 * (260 - b.pen.left) / 15000), 15, 'hamowanie w materiale');
    assert.deepEqual(hulls.map((e) => ledgerFor(ledger, e).entries), [1, 1, 1]);
  } finally { releaseAll(hulls); }
});

test('Valkyrie: w grubym kadłubie grzęźnie po 260 j. materiału — krater zakleszczenia 0,5 × energii', () => {
  const [e] = hullsAt(THICK, [[0, 0]]);
  try {
    const ledger = new Map();
    const b = createShot(VALKYRIE, -2000, 10, 1, 0, 11);
    const log = flyShot(b, VALKYRIE, [e], { ledger });
    assert.deepEqual(log.map((l) => l.type), ['enter', 'stuck']);
    const [enter, stuck] = log;
    near(stuck.x - enter.x, 260, e.beamHull.body.cellSize, 'zakleszczenie po budżecie materiału');
    assert.equal(b.pen.left, 0);
    assert.equal(b.dead, true);
    const k = Math.hypot(b.vx, b.vy) / 15000;
    near(stuck.crater, 0.5 * 500 * k * k, 1e-9, 'krater zakleszczenia');
    assert.equal(ledgerFor(ledger, e).hp, 500, 'HP tylko przy wejściu');
  } finally { releaseAll([e]); }
});

test('dwa ramiona jednego kadłuba (wklęsła sylwetka): dwie dziury, HP raz, bez liczenia do limitu', () => {
  // Płyta 400 × 200 ze szczeliną x ∈ (150, 250) px od góry do y = 170 px: ramiona połączone u dołu.
  const w = 400, h = 200, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 150 && x < 250 && y < 170) continue;
      const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 150; data[o + 3] = 255;
    }
  }
  const [e] = hullsAt({ width: w, height: h, data }, [[0, 0]]);
  try {
    const ledger = new Map();
    const b = createShot(MJOLNIR, -2000, -40, 1, 0, 13);
    const log = flyShot(b, MJOLNIR, [e], { ledger });
    assert.deepEqual(log.map((l) => l.type), ['enter', 'exit', 'enter', 'exit']);
    assert.deepEqual(log.filter((l) => l.type === 'enter').map((l) => l.repeat), [false, true]);
    const rec = ledgerFor(ledger, e);
    assert.equal(rec.hp, 2500, 'HP raz na kadłub i pocisk');
    assert.equal(rec.exits, 2, 'dwa kratery wyjścia');
    assert.equal(b.pen.count, 1, 'drugie ramię nie liczy się do limitu penetration');
    const k = M.entryDamage(b, MJOLNIR, M.HIT_PENETRATE);
    assert.deepEqual({ ...k }, { hp: 0, crater: 1 });
    assert.deepEqual({ ...M.entryDamage({}, MASTER_WEAPONS.vulcan_minigun, M.HIT_RICOCHET) }, { hp: 0.3, crater: 0.3 });
    assert.deepEqual({ ...M.entryDamage({}, MASTER_WEAPONS.vulcan_minigun, M.HIT_STOP) }, { hp: 1, crater: 1 });
  } finally { releaseAll([e]); }
});

test('pocisk w materiale, gdy statek ginie (convertToWreck): leci dalej przez wrak', () => {
  const [e] = hullsAt(LONG, [[0, 0]]);
  try {
    const b = createShot(MJOLNIR, -2000, 10, 1, 0, 5);
    const n = HullBodies.surfaceNormal(e, -205, 10, 1, 0);
    assert.equal(M.resolveHullHit(b, MJOLNIR, n, { x: 25000, y: 0 }, n.node, e, -205, 10), M.HIT_PENETRATE);
    assert.equal(b.pen.entity, e);
    assert.ok(M.isInsideHull(b));
    assert.equal(M.skipsHull(b, e), true, 'pętla kandydatów pomija kadłub, w którym pocisk jest');
    const wreck = HullBodies.convertToWreck(e);
    assert.equal(M.skipsHull(b, wreck), true, 'to samo ciało pod encją wraku');
    b.x = -205 + 25000 / 120; b.y = 10;
    const pass = M.stepInsideHull(b, MJOLNIR);
    assert.equal(pass.event, M.PASS_INSIDE);
    assert.equal(pass.entity, wreck, 'krok liczony w kadłubie wraku');
    b.x += 25000 / 120;
    const out = M.stepInsideHull(b, MJOLNIR);
    assert.equal(out.event, M.PASS_EXIT);
    near(out.x, 205, 12, 'wyjście przy dziobie (brzeg płyty 200 + zasięg sondy)');
    assert.equal(out.craterDamage, 1250);
    assert.equal(M.skipsHull(b, wreck), true, 'w kroku wyjścia kadłub dalej pominięty');
    assert.equal(M.stepInsideHull(b, MJOLNIR).event, M.PASS_NONE);
    assert.equal(M.skipsHull(b, wreck), false, 'następny krok: kadłub znów trafialny');
  } finally { releaseAll([e]); }
});

test('bez Math.random, deterministycznie: ten sam lot = te same zdarzenia', () => {
  const run = () => {
    const hulls = hullsAt(THIN, [[0, 0], [0, 400], [0, 800]]);
    try {
      const b = createShot(VALKYRIE, 5, -2000, 0.02, 1, 21);
      const events = [];
      const random = Math.random;
      // Mechanika nie losuje; krater (HullBodies.impact) losuje odrzut odłamków jak dotąd —
      // na czas lotu stały generator, żeby porównać dwa przebiegi.
      let seed = 1;
      Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      try {
        for (const l of flyShot(b, VALKYRIE, hulls)) events.push([l.type, l.x, l.y, l.damage ?? 0, l.crater ?? 0, l.killed ?? 0]);
      } finally { Math.random = random; }
      return events;
    } finally { releaseAll(hulls); }
  };
  assert.deepEqual(run(), run());

  const [e] = hullsAt(THICK, [[0, 0]]);
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w mechanice'); };
  try {
    const b = createShot(VALKYRIE, -2000, 10, 1, 0, 1);
    const n = HullBodies.surfaceNormal(e, -302, 10, 1, 0);
    assert.equal(M.resolveHullHit(b, VALKYRIE, n, { x: b.vx, y: b.vy }, n.node, e, -302, 10), M.HIT_PENETRATE);
    for (let k = 0; k < 4 && b.pen.body; k++) { b.x += b.vx / 120; M.stepInsideHull(b, VALKYRIE); }
  } finally { Math.random = random; releaseAll([e]); }
});

test('bronie bez penDepth: trafienie w kadłub kończy lot jak dziś', () => {
  const [e] = hullsAt(LONG, [[0, 0]]);
  try {
    for (const id of ['railgun_mk2', 'tempest_ion_l', 'helios_lance_l', 'special_yamato_cannon', 'heavy_autocannon_l']) {
      const def = MASTER_WEAPONS[id];
      const b = createShot(def, -2000, 10, 1, 0, 4);
      assert.equal(M.resolveHullHit(b, def, { nx: -1, ny: 0 }, { x: b.vx, y: b.vy }, 3, e, -205, 10), M.HIT_STOP, id);
      assert.equal(b.pen, null);
    }
  } finally { releaseAll([e]); }
});
