// Rozgrzewka JIT klastrów sztywnych i pól płyt (D.warmUpRigid ← HullBodies.warmUpClusters; reguła zawalenia-budowli,
// „Klastry sztywne i pole płyty”) nie zostawia śladu w stanie silnika: listy, haki, liczniki, znaczniki, konfiguracja
// i numeracja ciał wracają, haki gry nie są wołane, a scena kontrolna (ciała belek płaskie i bryła 3D + klastry, jak
// „BIT W BIT” w tests/beamRigid3D.test.mjs) z rozgrzewką W ŚRODKU przebiegu daje ten sam hasz co bez niej (2× przed
// — powtarzalność sceny, 1× z rozgrzewką). Hasz bez id ciał (numeracja jest globalna). Osobny plik = osobny proces:
// rozgrzewka idzie raz na proces (`_rigidWarmedUp`), więc kolejność przebiegów w tym pliku jest częścią testu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { buildClusterDesc, createRigidConfig } from '../src/game/beamRigid3D.js';
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
  return cfg;
}

const BOX = { x: 0, y: 0, z: 0, hx: 100, hy: 100, hz: 50, mass: 1.44e5, id: 7 };
const boxDesc = () => buildClusterDesc([BOX], { spacing: 50 });
const flatTerrain = (R = 20000) => ({ cx: 0, cy: 0, cz: -R, R, rMax: R + 1, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
  radius() { return R; } });

function slab(nx, ny, cs, nz = 1) {
  const cells = [];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const edge = ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1 || iz === 0 || iz === nz - 1;
    cells.push({ ix, iy, iz, x: (ix + 0.5) * cs, y: (iy + 0.5) * cs, z: (iz + 0.5) * cs, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  return buildBeamStructure({ cells, nx, ny, nz, cellSize: cs, origin: { x: 0, y: 0, z: 0 } },
    { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
}
const beamBody = (st, opts, density = 1.19) => D.createBody(st, { ...opts, massMultiplier: (density * st.cellSize ** 2 * st.nodeStore.count) / st.mass });

function step(bodies, dt, n) {
  for (let k = 0; k < n; k++) {
    D.integrate(dt, bodies.filter((b) => !b.planar && !b.dead));
    D.update(dt, bodies);
  }
}

function hashBodies(bodies) {
  const h = createHash('sha256');
  for (const b of bodies) {
    h.update(new Uint8Array(new Float64Array([b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w,
      b.angVel.x, b.angVel.y, b.angVel.z, b.activeNodes, b.isSleeping ? 1 : 0]).buffer));
    if (b.nodeStore) {
      const s = b.nodeStore;
      h.update(new Uint8Array(s.x.buffer, 0, s.count * 8)); h.update(new Uint8Array(s.y.buffer, 0, s.count * 8));
      h.update(new Uint8Array(s.z.buffer, 0, s.count * 8)); h.update(new Uint8Array(s.hp.buffer, 0, s.count * 8));
    }
  }
  return h.digest('hex');
}

// Haki gry jako liczniki bez skutków (true z filtrów = „para co krok”, jak brak filtra) — rozgrzewka ma je odpiąć.
const HOOKS = ['pairFilter', 'onContact', 'onWreck', 'onNodeDebris', 'onDebris', 'onRigidContact', 'onRigidPair', 'rigidPairFilter'];
function installHooks(calls) {
  for (const k of HOOKS) {
    calls[k] = 0;
    D[k] = (k === 'pairFilter' || k === 'rigidPairFilter') ? () => { calls[k]++; return true; } : () => { calls[k]++; };
  }
}

// Stan systemu, który rozgrzewka ma oddać: te same obiekty (===) i te same wartości.
function systemState() {
  const refs = { config: D.config, splitQueue: D.splitQueue, terrains: D.terrains, plateFields: D.plateFields,
    rigidConfig: D.rigidConfig, perf: D.perf, rigidPerf: D.rigidPerf, platePerf: D.platePerf };
  for (const k of HOOKS) refs[k] = D[k];
  const values = { tick: D._tick, island: D._islandStamp, contact: D._contactStamp, region: D._regionStamp, front: D._frontGen,
    lastCraterReach: D.lastCraterReach, perf: { ...D.perf }, rigidPerf: { ...D.rigidPerf }, platePerf: { ...D.platePerf },
    rigidConfig: { ...D.rigidConfig }, splitQueue: [...D.splitQueue], terrains: [...D.terrains], plateFields: [...D.plateFields] };
  return { refs, values };
}

const PHASE1 = 60, PHASE2 = 120;

// Scena kontrolna: dwa płaskie kadłuby w zderzeniu, spadająca bryła 3D, dwa klastry na terenie, pole płyty z dala.
// `mid` — wołane między fazami (rozgrzewka w środku przebiegu, przy żywych ciałach i niezerowych licznikach).
function controlScene(mid = null) {
  gameConfig();
  const calls = {};
  installHooks(calls);
  D.addTerrain(flatTerrain());
  D.addPlateField({ origin: { x: -30000, y: -30000, z: 0 }, cell: 45, nu: 8, nv: 8, thickness: 90, capacity: 1e3, massPerCell: 100 });
  const a = beamBody(slab(20, 8, 15), { planar: true, position: { x: 0, y: 0, z: 0 }, velocity: { x: 500, y: 0, z: 0 } });
  const b = beamBody(slab(20, 8, 15), { planar: true, position: { x: 450, y: 40, z: 0 } });
  a.colZ0 = b.colZ0 = -70; a.colZ1 = b.colZ1 = 70;
  const s3 = beamBody(slab(4, 4, 30, 4), { planar: false, position: { x: -2000, y: 0, z: 300 }, gravity: { x: 0, y: 0, z: -400 } });
  const r1 = D.createRigidBody(boxDesc(), { position: { x: 3000, y: 0, z: -140 }, gravity: { x: 0, y: 0, z: -400 } });
  const r2 = D.createRigidBody(boxDesc(), { position: { x: 3050, y: 30, z: 120 }, gravity: { x: 0, y: 0, z: -400 } });
  const bodies = [a, r1, s3, b, r2];
  step(bodies, 1 / 60, PHASE1);
  const midOut = mid ? mid({ bodies, calls }) : null;
  step(bodies, 1 / 60, PHASE2);
  return { hash: hashBodies(bodies), calls: { ...calls }, maxId: Math.max(...bodies.map((x) => x.id)), midOut };
}

test('rozgrzewka klastrów w środku przebiegu: stan systemu wraca, haki nie są wołane, scena bit w bit, numeracja ciał ciągła', () => {
  // (1) scena jest powtarzalna bez rozgrzewki
  const s1 = controlScene(), s2 = controlScene();
  assert.equal(s2.hash, s1.hash, 'scena kontrolna powtarzalna (2× przed rozgrzewką)');
  assert.ok(s1.calls.pairFilter > 0 && s1.calls.onRigidContact > 0, `haki w scenie: ${JSON.stringify(s1.calls)}`);
  assert.equal(D._rigidWarmedUp, false, 'rozgrzewka jeszcze nie szła w tym procesie');

  // (2) ta sama scena z rozgrzewką między fazami
  const create = D.createRigidBody;
  let created = 0;
  const s3 = controlScene(({ calls }) => {
    // ślad w listach: wpis w kolejce rozpadów (rozgrzewka podmienia listę na czas sceny, nie może jej przetworzyć)
    const sentinel = { sentinel: true };
    D.splitQueue.push(sentinel);
    const before = systemState();
    const callsBefore = { ...calls };
    D.createRigidBody = function (...args) { created++; return create.apply(this, args); };
    try {
      D.warmUpRigid();
    } finally {
      D.createRigidBody = create;
    }
    const after = systemState();
    for (const k of Object.keys(before.refs)) assert.equal(after.refs[k], before.refs[k], `${k}: ten sam obiekt po rozgrzewce`);
    assert.deepEqual(after.values, before.values, 'liczniki, znaczniki, konfiguracja i zawartość list bez zmian');
    assert.deepEqual({ ...calls }, callsBefore, 'haki gry nie wołane w rozgrzewce');
    assert.equal(D.splitQueue.pop(), sentinel, 'kolejka rozpadów nietknięta');
    return { created };
  });
  assert.ok(s3.midOut.created >= 16, `rozgrzewka przeszła scenę (klastrów: ${s3.midOut.created})`);
  assert.equal(D._rigidWarmedUp, true);
  assert.equal(s3.hash, s1.hash, 'scena z rozgrzewką w środku = bez niej (pozy, prędkości, węzły, HP)');

  // (3) numeracja ciał: następne id = ostatnie sprzed rozgrzewki + 1 (rozgrzewka oddała NEXT_BODY_ID)
  const y = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 0 } });
  assert.equal(y.id, s3.maxId + 1, `id po rozgrzewce ${y.id}, ostatnie przed ${s3.maxId}`);

  // (4) drugie wołanie nic nie robi: bez sceny, bez zmian stanu i numeracji
  const before = systemState();
  let again = 0;
  D.createRigidBody = function (...args) { again++; return create.apply(this, args); };
  try {
    D.warmUpRigid();
  } finally {
    D.createRigidBody = create;
  }
  assert.equal(again, 0, 'druga rozgrzewka nie buduje sceny');
  const after = systemState();
  for (const k of Object.keys(before.refs)) assert.equal(after.refs[k], before.refs[k], `${k} (drugie wołanie)`);
  assert.deepEqual(after.values, before.values);
  const z = D.createBody(slab(2, 2, 15), { planar: true, position: { x: 0, y: 0, z: 0 } });
  assert.equal(z.id, y.id + 1, 'numeracja ciał ciągła także dla ciał belek');
});
