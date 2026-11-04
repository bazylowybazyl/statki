// Zegar ściany w obszarze zawaleń (reguła zawalenia-budowli, „Zasady obszaru” → zegar ściany): szpieg w procesie
// (jak scripts/wolny-zegar.mjs) liczy odczyty performance.now() / Date.now() i przesuwa czas przy każdym odczycie.
// (1) przy D.rigidPerf.timing = D.platePerf.timing = false graf nośny, klastry i pole płyty nie czytają zegara ani razu
//     (w grze performance.now() i zapis liczb w liczniki kosztowały);
// (2) przy timing = true i zegarze przesuwanym o 10 ms przy każdym odczycie wynik jest bit w bit ten sam (zegar nie
//     steruje fizyką, tylko licznikami narzędzi).
// Kroki klastrów i płyty BEZ D.update: silnik belek czyta zegar bezwarunkowo (destructorBeams3D.js — D.perf w update
// i solveSoftBody, `clock` żaru), więc pętla woła przebiegi modułów jak update: integrate, rigidCollide × 2 (+ pole
// płyty po każdej iteracji), rigidAfterStep (wzór tests/beamRigid3DAlokacje.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as SG from '../src/game/structureGraph.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildClusterDesc, createRigidConfig, rigidCollide, rigidAfterStep } from '../src/game/beamRigid3D.js';
import { plateFieldPass } from '../src/game/beamPlateField3D.js';
import { HULL_BODY_CONFIG as C } from '../src/game/hullBodies.js';

const SHIFT_MS = 10;

// Szpieg zegara na czas `fn`: liczba odczytów, każdy odczyt przesuwa czas o `shift` ms.
function spyClock(shift, fn) {
  const perf = globalThis.performance;
  const ownNow = Object.prototype.hasOwnProperty.call(perf, 'now');
  const perfNow = perf.now, dateNow = Date.now;
  let reads = 0, off = 0;
  perf.now = () => { reads++; off += shift; return perfNow.call(perf) + off; };
  Date.now = () => { reads++; off += shift; return dateNow() + Math.floor(off); };
  try {
    fn();
  } finally {
    if (ownNow) perf.now = perfNow; else delete perf.now;
    Date.now = dateNow;
  }
  return reads;
}

const f64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

// ── graf nośny: podcięcie W-1 (kratery w pasie broni), wyspa swobodna liczona structureSolveIsland ──
const HR = SG.buildHighriseArchetype({ seed: 5 });

function graphScene() {
  const S = SG.createStructure(HR, { id: 2 });
  const rnd = SG.structureRng(11), hz = 120, dt = 1 / hz, every = Math.round(0.2 * hz);
  const h = createHash('sha256');
  const out = { island: -1, solveCalls: 0, solved: -1, steps: 0 };
  const take = () => { if (S.evCount > 0) h.update(f64(S.ev.subarray(0, S.evCount * SG.STRUCT_EV_STRIDE))); };
  const run = () => {
    for (let s = 0; s < 30 * hz; s++) {
      if (s % every === 0 && out.island < 0) { const y = (rnd() * 2 - 1) * 200, z = (rnd() * 2 - 1) * 70; SG.structureDamageSphere(S, 190, y, z, 110, 0.18); }
      SG.stepStructure(S, dt, s);
      take();
      out.steps++;
      if (out.island < 0) {
        for (let j = 0; j < S.evCount; j++) {
          const o = j * SG.STRUCT_EV_STRIDE;
          if (S.ev[o] === SG.STRUCT_EV.ISLAND && S.ev[o + 13] > 0.3 * HR.totalMass) { out.island = S.ev[o + 2]; break; }
        }
        if (out.island >= 0) {
          // uderzenie rogiem oderwanej wyspy (jak lądowanie) — wyspa swobodna łamie się z odciążeniem bezwładnościowym
          const b = SG.structureNearestBlock(S, 190, 0, 600, out.island);
          if (b >= 0) SG.structureAddImpulse(S, b, -4e6, 0, -4e6);
        }
      } else if (out.solved < 0) {
        out.solved = SG.structureSolveIsland(S, out.island);
        out.solveCalls++;
        take();
      } else break;
    }
  };
  const snapshot = () => {
    h.update(f64(S.health)); h.update(f64(S.alive)); h.update(f64(S.ux)); h.update(f64(S.uy)); h.update(f64(S.uz));
    return { hash: h.digest('hex'), ...out };
  };
  return { run, snapshot };
}

// ── klastry i pole płyty: stos 24 klastrów na terenie, klaster spada na płytę (zjada grubość) ──
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
}

const BOX = { x: 0, y: 0, z: 0, hx: 100, hy: 100, hz: 50, mass: 1.44e5, id: 7 };
const flatTerrain = (R = 20000) => ({ cx: 0, cy: 0, cz: -R, R, rMax: R + 1, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
  radius() { return R; } });

function rigidScene(kind) {
  gameConfig();
  const desc = buildClusterDesc([BOX], { spacing: 50 });
  const bodies = [];
  let field = null;
  if (kind === 'stos') {
    D.addTerrain(flatTerrain());
    // dwie warstwy po 12 (górna przesunięta o pół oczka) — pary, teren, sen i podpory w 4 s
    for (let i = 0; i < 24; i++) {
      const top = i >= 12, k = i % 12;
      bodies.push(D.createRigidBody(desc, { position: { x: (k % 4) * 230 + (top ? 60 : 0), y: Math.floor(k / 4) * 230 + (top ? 40 : 0), z: top ? 200 : 60 },
        quaternion: { x: 0.02 * (i % 3), y: 0, z: 0.03 * (i % 3), w: 1 }, gravity: { x: 0, y: 0, z: -400 } }));
    }
  } else {
    field = D.addPlateField({ origin: { x: -540, y: -540, z: 0 }, cell: 45, nu: 24, nv: 24, thickness: 90, capacity: 2e3, massPerCell: 2e4 });
    bodies.push(D.createRigidBody(desc, { position: { x: 0, y: 0, z: 400 }, velocity: { x: 0, y: 0, z: -900 }, gravity: { x: 0, y: 0, z: -400 } }));
    bodies.push(D.createRigidBody(desc, { position: { x: 260, y: 120, z: 160 }, quaternion: { x: 0.05, y: 0, z: 0, w: 1 }, gravity: { x: 0, y: 0, z: -400 } }));
  }
  const dt = 1 / 60;
  const free = bodies.slice();
  const stats = { contacts: 0, pairs: 0, sleeping: 0, plateContacts: 0, eaten: 0 };
  const step = () => {
    D._tick++;
    D.integrate(dt, free);
    for (let i = 0; i < bodies.length; i++) D._refreshRot(bodies[i]);
    for (let it = 0; it < 2; it++) {
      rigidCollide(D, bodies, dt, it);
      if (field) plateFieldPass(D, bodies, dt, it === 0);
    }
    rigidAfterStep(D, dt);
    stats.contacts += D.rigidPerf.contacts; stats.pairs += D.rigidPerf.pairs;
    if (field) { stats.plateContacts += D.platePerf.contacts; stats.eaten += field.stats.eaten; }   // stats pola — z kroku
  };
  const run = () => { for (let k = 0; k < 240; k++) step(); };
  const snapshot = () => {
    const h = createHash('sha256');
    for (const b of bodies) {
      h.update(f64(new Float64Array([b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w,
        b.angVel.x, b.angVel.y, b.angVel.z, b.isSleeping ? 1 : 0, b.anchored ? 1 : 0])));
      if (b.isSleeping) stats.sleeping++;
    }
    if (field) {
      h.update(field.thick);
      h.update(f64(new Float64Array([field.version, field.stats.jx, field.stats.jy, field.stats.jz, field.stats.px, field.stats.py, field.stats.pz, field.stats.eaten, field.stats.lost])));
    }
    return { hash: h.digest('hex'), ...stats, version: field ? field.version : 0 };
  };
  return { run, snapshot };
}

// Przebieg sceny przy danym `timing`: odczyty zegara tylko w krokach (budowa sceny poza szpiegiem).
function measure(make, timing) {
  D.rigidPerf.timing = timing; D.platePerf.timing = timing;
  try {
    const sc = make();
    const reads = spyClock(timing ? SHIFT_MS : 0, sc.run);
    return { reads, ...sc.snapshot() };
  } finally {
    D.rigidPerf.timing = false; D.platePerf.timing = false;
  }
}

test('graf nośny: podcięcie W-1 i wyspa swobodna bez odczytu zegara; zegar przesuwany nie zmienia zdarzeń ani stanu', () => {
  const off = measure(graphScene, false), on = measure(graphScene, true);
  assert.ok(off.island >= 0 && off.solveCalls > 0, `scena dochodzi do wyspy i structureSolveIsland: ${JSON.stringify(off)}`);
  assert.equal(off.reads, 0, 'structureGraph.js czyta zegar');
  assert.equal(on.reads, 0, 'structureGraph.js czyta zegar (timing nie dotyczy grafu)');
  assert.equal(on.hash, off.hash, 'zdarzenia S.ev i bufory health / alive / u bit w bit');
  assert.equal(on.steps, off.steps); assert.equal(on.solved, off.solved);
});

for (const kind of ['stos', 'plyta']) {
  test(`klastry${kind === 'plyta' ? ' i pole płyty' : ''} (${kind}): timing false — 0 odczytów zegara; timing true i zegar przesuwany — wynik bit w bit`, () => {
    const off = measure(() => rigidScene(kind), false), on = measure(() => rigidScene(kind), true);
    if (kind === 'stos') assert.ok(off.contacts > 0 && off.pairs > 0 && off.sleeping > 0, `pary klastrów, teren i sen: ${JSON.stringify(off)}`);
    else assert.ok(off.plateContacts > 0 && off.eaten > 0 && off.version > 0, `klaster zjada grubość płyty: ${JSON.stringify(off)}`);
    assert.equal(off.reads, 0, `przy timing false moduły klastrów / płyty czytają zegar ${off.reads}×`);
    assert.ok(on.reads > 0, 'przy timing true liczniki czasu czytają zegar (szpieg działa)');
    assert.equal(on.hash, off.hash, 'pozy, prędkości, sen i grubości płyty bit w bit');
  });
}
