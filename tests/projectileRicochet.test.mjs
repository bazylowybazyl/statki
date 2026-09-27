import test from 'node:test';
import assert from 'node:assert/strict';

// Rykoszety działek (src/game/projectileMechanics.js, zadanie 18-A; decyzja
// docs/webgpu/PROJEKT-BRONI.md §5 p. 1): Vulcan i Gatling przy kącie padania ponad ~65° od
// normalnej (kierunek·normalna ≥ −0,42) z szansą 0,6 — rozstrzyga hash numeru pocisku
// i węzła, nie Math.random; kadłub dostaje 0,3 obrażeń, pocisk znika, smugowiec odbity
// jest kosmetyczny (ten sam hash).
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const M = await import('../src/game/projectileMechanics.js');
const { createShot, flyShot, ledgerFor } = await import('./helpers/hullFlight.mjs');

const VULCAN = MASTER_WEAPONS.vulcan_minigun;
const GATLING = MASTER_WEAPONS.gatling_s;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

// Pocisk lecący pod kątem `deg` od normalnej (0 = prosto w burtę) na burtę z normalną (0, −1).
function shotAt(serial, deg) {
  const a = deg * Math.PI / 180;
  return { b: { serial, vx: Math.sin(a) * 4000, vy: Math.cos(a) * 4000, damage: 4 }, normal: { nx: 0, ny: -1 } };
}

test('dane: rykoszet mają tylko Vulcan i Gatling (cosMax 0,42, szansa 0,6, kadłub × 0,3)', () => {
  for (const def of [VULCAN, GATLING]) {
    assert.deepEqual(def.ricochet, { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 });
    assert.equal(M.ricochetDamageFactor(def), 0.3);
  }
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (def === VULCAN || def === GATLING) continue;
    assert.equal(def.ricochet, undefined, `${id} bez rykoszetu`);
    assert.equal(M.ricochetDamageFactor(def), 1);
  }
});

test('hash01: deterministyczny, w [0, 1), równomierny; sól i węzeł dają inne wartości', () => {
  assert.equal(M.hash01(123, 45), M.hash01(123, 45));
  assert.notEqual(M.hash01(123, 45), M.hash01(124, 45));
  assert.notEqual(M.hash01(123, 45), M.hash01(123, 46));
  assert.notEqual(M.hash01(123, 45, 0), M.hash01(123, 45, 1));
  const buckets = new Array(10).fill(0);
  const N = 20000;
  let sum = 0;
  for (let s = 1; s <= N; s++) {
    const h = M.hash01(s, (s * 7) % 300);
    assert.ok(h >= 0 && h < 1);
    sum += h;
    buckets[Math.floor(h * 10)]++;
  }
  near(sum / N, 0.5, 0.01, 'średnia');
  for (const c of buckets) near(c / N, 0.1, 0.012, 'kubełek 10%');
  // Numer pocisku z licznika modułu.
  M.resetProjectileSerial();
  assert.equal(M.nextProjectileSerial(), 1);
  assert.equal(M.nextProjectileSerial(), 2);
  M.resetProjectileSerial();
});

test('decyzja: prosto i stromo nigdy, płasko ~60% pocisków; granica cosMax; ta sama sytuacja — ten sam wynik', () => {
  const rate = (deg, def = VULCAN) => {
    let n = 0;
    for (let s = 1; s <= 5000; s++) {
      const { b, normal } = shotAt(s, deg);
      if (M.resolveHullHit(b, def, normal, null, s % 97) === M.HIT_RICOCHET) n++;
    }
    return n / 5000;
  };
  assert.equal(rate(0), 0, 'prosto w burtę');
  assert.equal(rate(60), 0, '60° od normalnej: dn = −0,5 < −0,42');
  // acos(0,42) = 65,17°: tuż przed — nigdy, tuż za — z szansą 0,6.
  assert.equal(rate(65), 0);
  near(rate(65.5), 0.6, 0.03, '65,5°');
  near(rate(80), 0.6, 0.03, 'płasko 80°');
  near(rate(80, GATLING), 0.6, 0.03, 'Gatling');
  assert.equal(rate(80, MASTER_WEAPONS.heavy_autocannon), 0, 'broń bez rykoszetu');
  // Powtarzalność pojedynczej sytuacji i niezależność od Math.random.
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w decyzji'); };
  try {
    for (let s = 1; s < 200; s++) {
      const { b, normal } = shotAt(s, 78);
      const first = M.resolveHullHit(b, VULCAN, normal, null, 12);
      assert.equal(M.resolveHullHit(b, VULCAN, normal, null, 12), first);
      assert.equal(first === M.HIT_RICOCHET, M.hash01(s, 12) <= 0.6);
    }
  } finally { Math.random = random; }
});

test('prędkość względem kadłuba decyduje o kącie (pocisk niesie ruch strzelca)', () => {
  // Pocisk leci prosto w burtę w świecie, ale kadłub pędzi wzdłuż burty: względem niego płasko.
  const b = { serial: 5, vx: 0, vy: 4000, damage: 4 };
  const normal = { nx: 0, ny: -1 };
  let hits = 0;
  for (let s = 1; s <= 1000; s++) {
    b.serial = s;
    if (M.resolveHullHit(b, VULCAN, normal, { x: -12000, y: 4000 }, 3) === M.HIT_RICOCHET) hits++;
  }
  assert.ok(hits > 500, `względem kadłuba 72° → rykoszety (${hits}/1000)`);
  assert.equal(M.resolveHullHit(b, VULCAN, normal, { x: 0, y: 4000 }, 3), M.HIT_STOP, 'bez ruchu kadłuba — prosto');
});

test('obraz rykoszetu: odbicie od burty z rozrzutem ±0,15 rad, prędkość × 0,35–0,6, życie 0,2–0,45 s', () => {
  for (let s = 1; s <= 300; s++) {
    const { b, normal } = shotAt(s, 75);
    const r = { ...M.ricochetBounce(b, normal, null, 8) };
    assert.deepEqual({ ...M.ricochetBounce(b, normal, null, 8) }, r, 'ten sam hash — ten sam obraz');
    near(Math.hypot(r.dirX, r.dirY), 1, 1e-12, 'kierunek jednostkowy');
    // Lustro wektora (sin 75°, cos 75°) względem normalnej (0, −1): (sin 75°, −cos 75°).
    const mirror = Math.atan2(-Math.cos(75 * Math.PI / 180), Math.sin(75 * Math.PI / 180));
    const d = Math.atan2(r.dirY, r.dirX) - mirror;
    assert.ok(Math.abs(d) <= 0.15 + 1e-12, `rozrzut ${d}`);
    assert.ok(r.dirY < 0, 'odbity smugowiec leci od burty');
    assert.ok(r.speedFactor >= 0.35 && r.speedFactor <= 0.6);
    assert.ok(r.life >= 0.2 && r.life <= 0.45);
  }
});

test('na kadłubie: salwa po burcie pod kątem — część rykoszetuje z 0,3 obrażeń, prosto w burtę nic', () => {
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0.3, angVel: 0, mass: 5000 };
  HullBodies.createHull(e, plate(600, 200));
  try {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    const world = (lx, ly) => [lx * c - ly * s, lx * s + ly * c];
    const dirW = (dx, dy) => [dx * c - dy * s, dx * s + dy * c];
    const fire = (deg, serial0, count) => {
      const ledger = new Map();
      let ric = 0, hits = 0;
      const a = deg * Math.PI / 180;
      for (let k = 0; k < count; k++) {
        // Burta dolna (normalna lokalnie +y); strzały z dołu w pas x ∈ (−200, 200).
        const lx = -200 + (400 * k) / count;
        const [x0, y0] = world(lx - Math.sin(a) * 900, 100 + Math.cos(a) * 900);
        const [dx, dy] = dirW(Math.sin(a), -Math.cos(a));
        const b = createShot(VULCAN, x0, y0, dx, dy, serial0 + k);
        for (const l of flyShot(b, VULCAN, [e], { ledger })) {
          if (l.type === 'ricochet') { ric++; near(l.damage, 4 * 0.3, 1e-12, 'kadłub dostaje 0,3'); }
          if (l.type === 'hit') hits++;
        }
      }
      return { ric, hits, hp: ledgerFor(ledger, e).hp };
    };
    const straight = fire(0, 1, 200);
    assert.equal(straight.ric, 0);
    assert.equal(straight.hits, 200);
    assert.equal(straight.hp, 800);
    const glancing = fire(78, 5000, 400);
    assert.equal(glancing.ric + glancing.hits, 400, 'każdy strzał kończy się na kadłubie');
    near(glancing.ric / 400, 0.6, 0.08, 'rykoszety na płaskim kącie');
    near(glancing.hp, glancing.hits * 4 + glancing.ric * 1.2, 1e-9, 'suma obrażeń HP');
  } finally { HullBodies.release(e); }
});
