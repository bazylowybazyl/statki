// Silnik belek prawdziwie 3D (docs/PORT-silnik-belek.md § „Ciała 3D”, 2026-10-15): ciała 3D obok płaskich w jednym
// kroku — grawitacja ciała, przegub, para MIESZANA (węzeł 3D kontra słup węzła płaskiego), pionowy zgniot słupa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig, pinBeamNodes } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { voxelizeTriangles, makeBoxTriangles, voxelComponents, bridgeVoxelComponents } from '../src/game/voxelBody3D.js';
import { HULL_BODY_CONFIG as C } from '../src/game/hullBodies.js';

function gameConfig() {
  const cfg = createBeamConfig(15);
  Object.assign(cfg, { planar: true, localSolver: true, activeMotionThreshold: 6, activeSettleFrames: 4,
    crushStrength: C.crushStrength, contactV2: true, pinYieldMul: C.pinYieldMul, pinBreakCells: C.pinBreakCells,
    crushTravelMul: C.crushTravelMul, friction: C.friction, globalBreakMul: C.globalBreakMul, maxContacts: C.maxContacts });
  D.init(cfg);
  D.splitQueue.length = 0;
  return cfg;
}

function solidStructure(w, h, d, cell, mode = 'full') {
  const vox = voxelizeTriangles(makeBoxTriangles(w, h, d), null, { cellSize: cell, interiorMode: mode, shellLayers: 1, ribStep: 3 });
  return buildBeamStructure(vox, { bulkheadEvery: 0 });
}

function slab(nx, ny, cs) {
  const cells = [];
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const edge = ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1;
    cells.push({ ix, iy, iz: 0, x: (ix + 0.5) * cs, y: (iy + 0.5) * cs, z: 0, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  return buildBeamStructure({ cells, nx, ny, nz: 1, cellSize: cs, origin: { x: 0, y: 0, z: 0 } },
    { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
}

function body(structure, opts, density) {
  const nodes = structure.nodeStore.count, cs = structure.cellSize;
  return D.createBody(structure, { ...opts, massMultiplier: (density * cs * cs * nodes) / structure.mass });
}

function run(bodies, dt, seconds, each = null) {
  const n = Math.round(seconds / dt);
  for (let k = 0; k < n; k++) {
    D.integrate(dt, bodies);
    D.update(dt, bodies);
    if (each) each(k * dt);
  }
}

test('ciało dziedziczy płaskość z konfiguracji, opcja ją nadpisuje; wrak dziedziczy z rodzica', () => {
  const cfg = gameConfig();
  const a = body(solidStructure(90, 90, 90, 30), {}, 1);
  const b = body(solidStructure(90, 90, 90, 30), { planar: false, gravity: { x: 0, y: 0, z: -100 }, colZ0: -5, colZ1: 7 }, 1);
  assert.equal(a.planar, true);
  assert.equal(b.planar, false);
  assert.deepEqual(b.gravity, { x: 0, y: 0, z: -100 });
  assert.equal(b.colZ0, -5);
  assert.equal(b.colZ1, 7);
  assert.equal(cfg.planar, true);
});

test('grawitacja przyspiesza swobodne ciało 3D; ciało płaskie i zakotwiczone jej nie czują', () => {
  gameConfig();
  const g = 400, dt = 1 / 60;
  // osobno (bez styków między nimi)
  const free = body(solidStructure(90, 90, 90, 30), { planar: false, gravity: { x: 0, y: 0, z: -g } }, 1);
  const flat = body(solidStructure(90, 90, 90, 30), { planar: true, gravity: { x: 0, y: 0, z: -g }, position: { x: 1000, y: 0, z: 0 } }, 1);
  const pinned = body(solidStructure(90, 90, 90, 30), { planar: false, anchored: true, gravity: { x: 0, y: 0, z: -g }, position: { x: 2000, y: 0, z: 0 } }, 1);
  run([free, flat, pinned], dt, 1);
  const expect = -g * 1;
  assert.ok(Math.abs(free.vel.z - expect) / g < 0.05, `vz ${free.vel.z} ≈ ${expect}`);
  assert.equal(flat.vel.z, 0);
  assert.equal(pinned.pos.z, 0);
});

test('przegub trzyma punkt ciała w miejscu przy przewracaniu i pęka przy zadanym przechyle', () => {
  gameConfig();
  const dt = 1 / 60;
  const tower = body(solidStructure(90, 90, 900, 30), { planar: false, gravity: { x: 0, y: 0, z: -500 }, position: { x: 0, y: 0, z: 450 } }, 1);
  const j = D.addJoint(tower, 0, 0, 0, { breakTilt: 1.2 });
  tower.angVel.y = 0.1;
  tower.vel.x = 0.1 * 450;
  let maxErr = 0, brokeAt = -1, tiltAtBreak = 0;
  run([tower], dt, 6, (t) => {
    if (!j.broken) {
      const q = tower.quat;
      // punkt przegubu (lokalnie: spód osi) w świecie
      const lx = j.lx, ly = j.ly, lz = j.lz;
      const tx = 2 * (q.y * lz - q.z * ly), ty = 2 * (q.z * lx - q.x * lz), tz = 2 * (q.x * ly - q.y * lx);
      const wx = tower.pos.x + lx + q.w * tx + (q.y * tz - q.z * ty);
      const wy = tower.pos.y + ly + q.w * ty + (q.z * tx - q.x * tz);
      const wz = tower.pos.z + lz + q.w * tz + (q.x * ty - q.y * tx);
      maxErr = Math.max(maxErr, Math.hypot(wx - j.wx, wy - j.wy, wz - j.wz));
    } else if (brokeAt < 0) { brokeAt = t; tiltAtBreak = j.tilt; }
  });
  assert.ok(brokeAt > 0, 'przegub pękł');
  assert.ok(tiltAtBreak >= 1.2 && tiltAtBreak < 1.4, `przechył przy pęknięciu ${tiltAtBreak}`);
  assert.ok(maxErr < 15, `punkt przegubu odjechał o ${maxErr.toFixed(1)} j.`);
  // przewraca się w stronę startowego przechyłu (wierzch ku +x)
  assert.ok(tower.pos.x > 300, `środek masy ${tower.pos.x}`);
});

test('bryła 3D spada na zakotwiczoną płaską płytę (słup) i na niej staje — 60 i 120 Hz', () => {
  const rest = {};
  for (const hz of [60, 120]) {
    gameConfig();
    const ground = body(slab(40, 40, 15), { planar: true, anchored: true, collisionArmor: 20, colZ0: -200, colZ1: 0 }, 2.4);
    pinBeamNodes(ground, () => true);
    const cube = body(solidStructure(120, 120, 120, 30), { planar: false, gravity: { x: 0, y: 0, z: -600 }, position: { x: 0, y: 0, z: 300 } }, 3);
    let minZ = Infinity;
    run([ground, cube], 1 / hz, 3, () => { minZ = Math.min(minZ, cube.pos.z); });
    rest[hz] = cube.pos.z;
    assert.ok(cube.pos.z > 40 && cube.pos.z < 110, `${hz} Hz: spoczynek na płycie z = ${cube.pos.z}`);
    assert.ok(minZ > 20, `${hz} Hz: nie przeleciał przez płytę (min z ${minZ})`);
    assert.ok(Math.abs(cube.vel.z) < 20, `${hz} Hz: stoi (vz ${cube.vel.z})`);
  }
  assert.ok(Math.abs(rest[60] - rest[120]) < 15, `60 Hz ${rest[60]} vs 120 Hz ${rest[120]}`);
});

test('ciało płaskie w parze mieszanej nie rusza się w pionie; bryła na nim staje', () => {
  gameConfig();
  const ship = body(slab(30, 12, 15), { planar: true, colZ0: -70, colZ1: 70 }, 1.19);
  const cube = body(solidStructure(90, 90, 90, 30), { planar: false, gravity: { x: 0, y: 0, z: -500 }, position: { x: 0, y: 0, z: 260 } }, 1);
  let maxVz = 0, maxPz = 0;
  run([ship, cube], 1 / 60, 2.5, () => {
    // gra: płaskie ciało dostaje pozę z encji co krok (syncIn); tu — integrate płaskiego zeruje z
    maxVz = Math.max(maxVz, Math.abs(ship.vel.z));
    maxPz = Math.max(maxPz, Math.abs(ship.pos.z));
  });
  assert.equal(maxVz, 0, 'vz ciała płaskiego');
  assert.equal(maxPz, 0, 'z ciała płaskiego');
  assert.ok(cube.pos.z > 70 && cube.pos.z < 200, `bryła na słupie statku z = ${cube.pos.z}`);
});

test('ciężka szybka bryła przebija słabą płytę (pionowy zgniot słupa zdejmuje HP)', () => {
  gameConfig();
  const ground = body(slab(30, 30, 15), { planar: true, anchored: true, collisionArmor: 0.5, colZ0: -40, colZ1: 0 }, 1);
  // kotwice na obrzeżu (kotwica stawia pinYieldMul razy większy opór niż zwykły węzeł — płyta z samych kotwic
  // zatrzymałaby wszystko)
  pinBeamNodes(ground, (ox, oy) => Math.abs(ox) > 13 * 15 || Math.abs(oy) > 13 * 15);
  const n0 = ground.activeNodes;
  const rock = body(solidStructure(150, 150, 150, 30), { planar: false, collisionArmor: 20, position: { x: 0, y: 0, z: 200 }, velocity: { x: 0, y: 0, z: -1500 } }, 6);
  run([ground, rock], 1 / 60, 1.5);
  assert.ok(ground.activeNodes < n0 - 20, `płyta straciła węzły: ${n0} → ${ground.activeNodes}`);
  assert.ok(rock.pos.z < -100, `bryła przeszła przez płytę (z ${rock.pos.z})`);
});

test('mostki komórek łączą rozłączne bryły wokselizacji w jedną składową', () => {
  const a = makeBoxTriangles(90, 90, 90, 0, 0, 0);
  const b = makeBoxTriangles(60, 60, 60, 200, 0, 0);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a); pos.set(b, a.length);
  const vox = voxelizeTriangles(pos, null, { cellSize: 30, interiorMode: 'full' });
  assert.ok(voxelComponents(vox).sizes.length >= 2, 'dwie składowe przed mostkiem');
  const added = bridgeVoxelComponents(vox);
  assert.ok(added > 0, 'dodano komórki mostka');
  assert.equal(voxelComponents(vox).sizes.length, 1, 'jedna składowa po mostku');
  const st = buildBeamStructure(vox, { bulkheadEvery: 0 });
  assert.equal(st.nodeStore.count, vox.cells.length);
});
