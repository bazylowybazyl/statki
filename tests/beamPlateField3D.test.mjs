// POLE PŁYTY w silniku belek (src/game/beamPlateField3D.js; docs/PLAN-zawalenia-budowli-3d.md § 3.5 p. 5, § 4.2 p. 3):
// styk sprężysty poniżej nośności (siła do haka, bez ubytku), przebicie ponad nośnością (ubytek grubości, utrata komórek,
// zjedzona masa przejmuje prędkość), BILANS PĘDU w każdym kroku, reakcja na CAŁE ciało bryły belek (węzły nieruszone,
// solver nie budzony), przelot przez cienką płytę w jednym kroku (CCD), determinizm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { buildClusterDesc, createRigidConfig } from '../src/game/beamRigid3D.js';
import { createPlateField, plateThicknessAt } from '../src/game/beamPlateField3D.js';
import { HULL_BODY_CONFIG as C } from '../src/game/hullBodies.js';

function gameConfig() {
  const cfg = createBeamConfig(15);
  Object.assign(cfg, { planar: true, localSolver: true, activeMotionThreshold: 6, activeSettleFrames: 4,
    crushStrength: C.crushStrength, contactV2: true, pinYieldMul: C.pinYieldMul, pinBreakCells: C.pinBreakCells,
    crushTravelMul: C.crushTravelMul, friction: C.friction, globalBreakMul: C.globalBreakMul, maxContacts: C.maxContacts,
    crushRestSpeed3D: C.crushRestSpeed3D });
  D.init(cfg);
  D.splitQueue.length = 0;
  D.terrains.length = 0;
  D.plateFields.length = 0;
  D.rigidConfig = createRigidConfig();
  D.onRigidContact = null; D.onRigidPair = null; D.rigidPairFilter = null;
  D.pairFilter = null; D.onContact = null; D.onWreck = null; D.onNodeDebris = null;
  return cfg;
}

const boxDesc = (mass = 1.44e5) => buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 100, hy: 100, hz: 50, mass, id: 3 }], { spacing: 50 });

// płyta 1800 × 1800 j. (komórka 45), wierzch na z = thickness
function plate(opts = {}) {
  return D.addPlateField({ origin: { x: -900, y: -900, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, cell: 45, nu: 40, nv: 40,
    thickness: 90, capacity: 1e6, massPerCell: 2e4, ...opts });
}

// wieża (walec) z komórek — bryła belek 3D
function tower(r, h, cs) {
  const cells = [], n = Math.ceil(r / cs) * 2 + 1, c0 = (n - 1) / 2;
  const solid = new Set();
  for (let k = 0; k < h; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - c0) * cs, y = (j - c0) * cs;
    if (x * x + y * y <= r * r) solid.add(i + n * (j + n * k));
  }
  const solidMask = new Uint8Array(n * n * h);
  for (const key of solid) solidMask[key] = 1;
  for (const key of solid) {
    const i = key % n, j = Math.floor(key / n) % n, k = Math.floor(key / (n * n));
    const edge = i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === h - 1 ||
      !solid.has(i + 1 + n * (j + n * k)) || !solid.has(i - 1 + n * (j + n * k)) || !solid.has(i + n * (j + 1 + n * k)) || !solid.has(i + n * (j - 1 + n * k));
    cells.push({ ix: i, iy: j, iz: k, x: (i + 0.5) * cs, y: (j + 0.5) * cs, z: (k + 0.5) * cs, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  const st = buildBeamStructure({ cells, solidMask, nx: n, ny: n, nz: h, cellSize: cs, origin: { x: 0, y: 0, z: 0 } }, { bulkheadEvery: 0 });
  return D.createBody(st, { planar: false, massMultiplier: (1.19 * cs * cs * st.nodeStore.count) / st.mass });
}

const momentum = (b) => [b.mass * b.vel.x, b.mass * b.vel.y, b.mass * b.vel.z];

test('opis pola: osie ortonormalne, maska, grubość u8, odczyt grubości w punkcie', () => {
  gameConfig();
  const F = createPlateField({ origin: { x: 0, y: 0, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0.2, y: 1, z: 0 }, cell: 45, nu: 10, nv: 10,
    thickness: 90, maxThickness: 180, mask: (iu, iv) => iu !== 3 });
  assert.ok(Math.abs(F.ux * F.vx + F.uy * F.vy + F.uz * F.vz) < 1e-12, 'v ⊥ u');
  assert.ok(Math.abs(F.nz - 1) < 1e-12, 'n = u × v');
  const t0 = Math.round(90 / (180 / 255));
  assert.equal(F.thick[0], t0);
  assert.equal(F.thick[3], 0, 'komórka spoza maski = otwór');
  assert.equal(F.alive, 90);
  assert.ok(Math.abs(plateThicknessAt(F, 10, 10, 0) - t0 * 180 / 255) < 1e-9);
  assert.equal(plateThicknessAt(F, -5, 10, 0), -1);
});

test('styk sprężysty poniżej nośności: klaster leży na płycie, grubość bez zmian, siła ≈ ciężar do haka', () => {
  gameConfig();
  let force = 0, calls = 0;
  const F = plate({ capacity: 1e9, onContact: (f, b, info) => { force = info.force; calls++; } });
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 200 }, gravity: { x: 0, y: 0, z: -400 } });
  const t0 = F.thick.slice();
  for (let k = 0; k < 240; k++) { D.integrate(1 / 60, [b]); D.update(1 / 60, [b]); }
  assert.deepEqual(F.thick, t0, 'płyta cała');
  assert.ok(Math.abs(b.pos.z - (90 + 50)) < 3, `klaster na wierzchu: ${b.pos.z}`);
  assert.ok(calls > 0);
  // w spoczynku impuls na krok ≈ m · g · dt (siła = ciężar); klaster mógł już zasnąć — wtedy siła z ostatniego styku
  assert.ok(Math.abs(force - 1.44e5 * 400) / (1.44e5 * 400) < 0.3, `siła ${force}`);
});

test('przebicie: ponad nośnością grubość maleje, komórki giną, zjedzona masa przejmuje prędkość — bilans pędu w każdym kroku', () => {
  gameConfig();
  const lost = [];
  const F = plate({ capacity: 2e3, massPerCell: 3e3, onCellLost: (f, c, x, y, z, vx, vy, vz, m) => lost.push({ c, vz, m }) });
  const b = D.createRigidBody(boxDesc(), { position: { x: 20, y: -10, z: 160 }, velocity: { x: 50, y: 0, z: -900 },
    quaternion: { x: 0.05, y: 0.02, z: 0, w: 1 } });
  const dt = 1 / 60;
  let eaten = 0, worst = 0, crushSteps = 0;
  for (let k = 0; k < 40; k++) {
    // ruch bez tłumienia integrate (bilans liczymy na samym kroku kolizji)
    b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
    const p0 = momentum(b);
    D.update(dt, [b]);
    const p1 = momentum(b), st = F.stats;
    // Δp ciała = impuls podpory płyty − pęd zjedzonej masy
    const ex = p1[0] - p0[0] - (st.jx - st.px), ey = p1[1] - p0[1] - (st.jy - st.py), ez = p1[2] - p0[2] - (st.jz - st.pz);
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez) / (Math.abs(p0[2]) + 1);
    if (err > worst) worst = err;
    eaten += st.eaten;
    if (st.crushing) crushSteps++;
  }
  assert.ok(worst < 1e-9, `bilans pędu: największy błąd względny ${worst}`);
  assert.ok(crushSteps > 0 && eaten > 0, 'płyta przebita');
  assert.ok(lost.length > 0, 'komórki zginęły');
  assert.ok(lost.every((e) => e.vz < 0 && e.m === 3e3), 'zjedzona masa leci w dół (z klastrem)');
  assert.ok(F.alive < 1600 - lost.length + 1);
  assert.ok(b.pos.z < 0, `klaster przeszedł przez płytę: z ${b.pos.z}`);
  assert.ok(b.vel.z > -900, 'stracił pęd na przebiciu');
});

test('reakcja na CAŁE ciało bryły belek: węzły wieży nieruszone, solver nie budzony, otwór w płycie', () => {
  gameConfig();
  const F = plate({ capacity: 1e3, massPerCell: 2e3 });
  const t = tower(150, 20, 30);
  t.pos.x = 0; t.pos.y = 0; t.pos.z = 90 + 320; t.vel.z = -900;
  const s = t.nodeStore;
  const x0 = s.x.slice(0, s.count), z0 = s.z.slice(0, s.count);
  const dt = 1 / 60;
  let worst = 0;
  for (let k = 0; k < 30; k++) {
    t.pos.x += t.vel.x * dt; t.pos.y += t.vel.y * dt; t.pos.z += t.vel.z * dt;
    const p0 = momentum(t);
    D.update(dt, [t]);
    const p1 = momentum(t), st = F.stats;
    const ez = p1[2] - p0[2] - (st.jz - st.pz);
    worst = Math.max(worst, Math.abs(ez) / Math.abs(p0[2]));
  }
  assert.ok(worst < 1e-9, `bilans pędu wieży: ${worst}`);
  let moved = 0;
  for (let i = 0; i < s.count; i++) if (s.x[i] !== x0[i] || s.z[i] !== z0[i]) moved++;
  assert.equal(moved, 0, 'płyta nie rusza węzłów');
  assert.ok(!t._region || t._region.list.length === 0, 'solver lokalny nie ma obszaru');
  assert.ok(F.alive < 1600, `otwór: żywych ${F.alive}`);
  assert.ok(t.vel.z > -900, 'wieża straciła pęd');
  // otwór ≈ przekrój wieży (r 150 j. → ~35 komórek po 45 j.)
  const hole = 1600 - F.alive;
  assert.ok(hole >= 20 && hole <= 80, `komórek otworu ${hole}`);
});

test('nośność trzyma wieżę: bez ubytku, styk sprężysty', () => {
  gameConfig();
  const F = plate({ capacity: 1e12 });
  const t = tower(150, 10, 30);
  t.pos.z = 90 + 170; t.vel.z = -300;
  t.gravity = { x: 0, y: 0, z: -400 };
  const t0 = F.thick.slice();
  for (let k = 0; k < 120; k++) { D.integrate(1 / 60, [t]); D.update(1 / 60, [t]); }
  assert.deepEqual(F.thick, t0);
  assert.ok(t.pos.z > 90, `wieża na płycie: ${t.pos.z}`);
});

test('CCD: szybki klaster nie przelatuje przez cienką płytę (10 j.) przy nośności nie do przebicia', () => {
  gameConfig();
  const F = plate({ thickness: 10, maxThickness: 10, capacity: 1e12 });
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 300 }, velocity: { x: 0, y: 0, z: -3000 } });
  for (let k = 0; k < 20; k++) { D.integrate(1 / 60, [b]); D.update(1 / 60, [b]); }
  assert.ok(b.pos.z > 10, `klaster nad płytą: z ${b.pos.z}`);
  assert.equal(F.alive, 1600);
});

test('determinizm: to samo przebicie daje te same grubości', () => {
  const run = () => {
    gameConfig();
    const F = plate({ capacity: 2e3, massPerCell: 3e3 });
    const b = D.createRigidBody(boxDesc(), { position: { x: 33, y: -21, z: 160 }, velocity: { x: 80, y: 30, z: -900 }, quaternion: { x: 0.1, y: 0.07, z: 0.02, w: 1 } });
    for (let k = 0; k < 40; k++) { D.integrate(1 / 60, [b]); D.update(1 / 60, [b]); }
    return Buffer.from(F.thick).toString('base64') + b.pos.z;
  };
  assert.equal(run(), run());
});

test('próg zależny od utrzymania (wzór E1, D8): hold 1 — płyta trzyma, hold 0 — przebicie', async () => {
  const { plateCapacity } = await import('../src/game/beamPlateField3D.js');
  const run = (hold) => {
    gameConfig();
    const F = plate({ capacityHeld: 1e9, capacityFree: 2e3, massPerCell: 3e3, hold });
    assert.equal(plateCapacity(F), 2e3 + hold * (1e9 - 2e3));
    const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 160 }, velocity: { x: 0, y: 0, z: -900 } });
    for (let k = 0; k < 30; k++) { D.integrate(1 / 60, [b]); D.update(1 / 60, [b]); }
    return { alive: F.alive, z: b.pos.z };
  };
  const held = run(1), free = run(0);
  assert.equal(held.alive, 1600, 'utrzymanie 1: płyta cała');
  assert.ok(held.z > 90, 'klaster na płycie');
  assert.ok(free.alive < 1600 && free.z < 0, `utrzymanie 0: przebicie (żywych ${free.alive}, z ${free.z})`);
});

test('hak grafu z pola płyty: każdy klaster dostaje SWÓJ impuls (dwa klastry na jednym polu), blok = numer w grafie', () => {
  // dawniej hak dostawał liczniki całego pola z tego kroku — drugi klaster 2 × swój impuls (recenzja E2, zgł. 6/11)
  gameConfig();
  plate({ capacity: 1e9 });
  const G = { x: 0, y: 0, z: -400 };
  const a = D.createRigidBody(boxDesc(), { position: { x: -400, y: 0, z: 90 + 50 + 30 }, gravity: G });
  const b = D.createRigidBody(boxDesc(), { position: { x: 400, y: 0, z: 90 + 50 + 30 }, gravity: G });
  const bodies = [a, b];
  D.rigidConfig.sleepTicks120 = 100000;
  for (let k = 0; k < 90; k++) { D.integrate(1 / 60, bodies); D.update(1 / 60, bodies); }
  const got = new Map(), blk = new Map();
  D.onRigidContact = (body, block, jx, jy, jz) => { got.set(body, (got.get(body) || 0) + jz); blk.set(body, block); };
  D.integrate(1 / 60, bodies); D.update(1 / 60, bodies);
  const w = a.mass * 400 / 60;
  assert.ok(Math.abs(got.get(a) - w) < 0.15 * w, `A: ${got.get(a)} ≈ ciężar · dt ${w}`);
  assert.ok(Math.abs(got.get(b) - w) < 0.15 * w, `B: ${got.get(b)} ≈ ciężar · dt ${w} (nie suma A + B)`);
  assert.equal(blk.get(a), 3, 'id bloku z opisu');
});
