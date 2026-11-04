// KLASTRY SZTYWNE w silniku belek (src/game/beamRigid3D.js; docs/PLAN-zawalenia-budowli-3d.md § 3.3, § 3.5, etap E2):
// opis klastra z bloków, masa i tensor, grawitacja i studnia z vmax, styk z terenem (normalna raz na ciało), stos i sen,
// para klaster × klaster (pęd), klaster × ciało płaskie (taran, R11 — bez przenikania przy dużej prędkości), klaster ×
// bryła belek, hak grafu, lustro encji (HullBodies.createCluster), zamrożenie, determinizm, 60/120 Hz, bez alokacji,
// a przede wszystkim: ciała belek liczą się BIT W BIT, gdy w kroku są klastry (rozdział par tylko w update()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { buildClusterDesc, clusterMassProperties, createRigidConfig } from '../src/game/beamRigid3D.js';
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

const BOX = { x: 0, y: 0, z: 0, hx: 100, hy: 100, hz: 50, mass: 1.44e5, id: 7 };
const boxDesc = () => buildClusterDesc([BOX], { spacing: 50 });

function flatTerrain(R = 20000) {
  return { cx: 0, cy: 0, cz: -R, R, rMax: R + 1, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
    radius() { return R; } };
}

function slab(nx, ny, cs, nz = 1) {
  const cells = [];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const edge = ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1 || iz === 0 || iz === nz - 1;
    cells.push({ ix, iy, iz, x: (ix + 0.5) * cs, y: (iy + 0.5) * cs, z: (iz + 0.5) * cs, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  return buildBeamStructure({ cells, nx, ny, nz, cellSize: cs, origin: { x: 0, y: 0, z: 0 } },
    { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
}

function beamBody(st, opts, density = 1.19) {
  return D.createBody(st, { ...opts, massMultiplier: (density * st.cellSize ** 2 * st.nodeStore.count) / st.mass });
}

function step(bodies, dt, n, each = null) {
  for (let k = 0; k < n; k++) {
    D.integrate(dt, bodies.filter((b) => !b.planar && !b.dead));
    D.update(dt, bodies);
    if (each) each(k);
  }
}

function hashBodies(bodies) {
  const h = createHash('sha256');
  for (const b of bodies) {
    h.update(new Float64Array([b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w,
      b.angVel.x, b.angVel.y, b.angVel.z, b.activeNodes]));
    if (b.nodeStore) {
      const s = b.nodeStore;
      h.update(new Uint8Array(s.x.buffer, 0, s.count * 8)); h.update(new Uint8Array(s.y.buffer, 0, s.count * 8));
      h.update(new Uint8Array(s.hp.buffer, 0, s.count * 8));
    }
  }
  return h.digest('hex');
}

test('opis klastra: siatka punktów na powierzchni bloku (kule wewnątrz bryły), sufit punktów na blok', () => {
  const d = boxDesc();
  assert.equal(d.pointCount, 32, '4 × 4 × 2 punkty jak bryła sceptyka (200 × 200 × 100, co 50 j.)');
  for (let k = 0; k < d.pointCount; k++) {
    const x = d.points[k * 4], y = d.points[k * 4 + 1], z = d.points[k * 4 + 2], r = d.points[k * 4 + 3];
    assert.ok(Math.abs(x) + r <= 100 + 1e-9 && Math.abs(y) + r <= 100 + 1e-9 && Math.abs(z) + r <= 50 + 1e-9, 'kula w bryle');
    assert.equal(d.pointBlock[k], 0);
  }
  // R11: promień ≥ ½ przekątnej oczka − promień węzła 15 j. (8,25): węzeł nie przejdzie między czterema punktami
  const r = d.points[3], gap = 140 / 3;
  assert.ok(gap / Math.SQRT2 < r + 8.25, `oczko ${gap.toFixed(1)} j., promień ${r}`);
  const big = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 400, hy: 300, hz: 200, mass: 1, id: 0 }], { spacing: 50, maxPoints: 32 });
  assert.ok(big.pointCount <= 32 && big.pointCount >= 8, `duży blok: ${big.pointCount} punktów`);
});

test('masa, środek masy i tensor z bloków (Steiner)', () => {
  const one = clusterMassProperties(boxDesc());
  assert.equal(one.mass, 1.44e5);
  assert.deepEqual(one.com, [0, 0, 0]);
  assert.ok(Math.abs(one.inertia[0] - 1.44e5 * (100 * 100 + 50 * 50) / 3) < 1e-6);
  assert.ok(Math.abs(one.inertia[8] - 1.44e5 * (100 * 100 + 100 * 100) / 3) < 1e-6);
  const two = clusterMassProperties(buildClusterDesc([{ ...BOX, x: -200, mass: 1 }, { ...BOX, x: 200, mass: 3 }]));
  assert.equal(two.mass, 4);
  assert.ok(Math.abs(two.com[0] - 100) < 1e-12, 'środek masy bliżej cięższego bloku');
  // Iyy: blok + m·dx² (dx = −300 i +100)
  const iyy = (100 * 100 + 50 * 50) / 3 * 4 + 1 * 300 * 300 + 3 * 100 * 100;
  assert.ok(Math.abs(two.inertia[4] - iyy) < 1e-6, `Iyy ${two.inertia[4]} ≈ ${iyy}`);
});

test('grawitacja i studnia z vmax działają na klaster jak na bryłę belek (ta sama ścieżka integrate)', () => {
  gameConfig();
  const dt = 1 / 60;
  const free = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 5000 }, gravity: { x: 0, y: 0, z: -400 } });
  const well = { x: 0, y: 0, z: -100000, g: 900, r0: 0, vmax: 1000 };
  const wellBody = D.createRigidBody(boxDesc(), { position: { x: 5000, y: 0, z: 5000 }, gravityWell: well });
  step([free, wellBody], dt, 120);
  assert.ok(Math.abs(free.vel.z - (-400 * 2)) / 400 < 0.05, `vz ${free.vel.z}`);
  const vin = Math.sqrt(wellBody.vel.x ** 2 + wellBody.vel.y ** 2 + wellBody.vel.z ** 2);
  assert.ok(vin <= 1000 + 1e-6 && vin > 900, `sufit studni: ${vin}`);
});

test('klaster ląduje na terenie, leży na swojej wysokości i zasypia (koszt 0 w spoczynku)', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const dt = 1 / 60;
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 400 }, gravity: { x: 0, y: 0, z: -400 } });
  step([b], dt, 240);
  assert.ok(Math.abs(b.pos.z - 50) < 2, `wysokość środka ${b.pos.z}`);
  assert.equal(b.isSleeping, true, 'zasnął');
  const z = b.pos.z;
  step([b], dt, 60);
  assert.equal(b.pos.z, z, 'śpiący nie jest całkowany');
  assert.equal(D.rigidPerf.awake, 0);
  assert.equal(D.rigidPerf.terrainReads, 0, 'śpiący nie czyta terenu');
});

// Kształt klastra to suma kul punktów (oczko ~47 j., promień 30): klocek przesunięty o pół oczka siada w „dołki” między
// kulami dolnego — do ~10 j. niżej niż prostopadłościan (tolerancja niżej).
test('stos dwóch klastrów: górny leży na dolnym bez przenikania, oba zasypiają', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const dt = 1 / 60;
  const a = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 60 }, gravity: { x: 0, y: 0, z: -400 } });
  const b = D.createRigidBody(boxDesc(), { position: { x: 40, y: -30, z: 300 }, gravity: { x: 0, y: 0, z: -400 } });
  step([a, b], dt, 360);
  assert.ok(Math.abs(a.pos.z - 50) < 3, `dolny ${a.pos.z}`);
  assert.ok(Math.abs(b.pos.z - 150) < 12, `górny ${b.pos.z}`);
  assert.ok(a.isSleeping && b.isSleeping, 'stos śpi');
});

test('para klaster × klaster zachowuje pęd (impulsy równe i przeciwne, bez grawitacji)', () => {
  gameConfig();
  const dt = 1 / 60;
  const a = D.createRigidBody(boxDesc(), { position: { x: -400, y: 10, z: 0 }, velocity: { x: 600, y: 0, z: 0 } });
  const desc2 = buildClusterDesc([{ ...BOX, mass: 3e5 }, { x: 0, y: 0, z: 120, hx: 50, hy: 50, hz: 70, mass: 5e4, id: 1 }]);
  const b = D.createRigidBody(desc2, { position: { x: 400, y: -20, z: 30 }, velocity: { x: -200, y: 0, z: 0 },
    quaternion: { x: 0.1, y: 0.2, z: 0, w: 1 } });
  const p0x = a.mass * a.vel.x + b.mass * b.vel.x;
  let touched = 0;
  for (let k = 0; k < 120; k++) {
    // bez całkowania tłumienia (integrate tłumi prędkość) — sam krok kolizji
    a.pos.x += a.vel.x * dt; a.pos.y += a.vel.y * dt; a.pos.z += a.vel.z * dt;
    b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
    D.update(dt, [a, b]);
    touched += D.rigidPerf.contacts;
  }
  assert.ok(touched > 0, 'zderzyły się');
  const px = a.mass * a.vel.x + b.mass * b.vel.x, py = a.mass * a.vel.y + b.mass * b.vel.y, pz = a.mass * a.vel.z + b.mass * b.vel.z;
  assert.ok(Math.abs(px - p0x) <= 1e-9 * Math.abs(p0x), `pęd x ${px} wobec ${p0x}`);
  assert.ok(Math.abs(py) <= 1e-9 * Math.abs(p0x) && Math.abs(pz) <= 1e-9 * Math.abs(p0x), `pęd y ${py}, z ${pz}`);
  assert.ok(a.vel.x < 600 && b.vel.x > -200, 'wymiana pędu');
});

test('BIT W BIT: ciała belek liczą się tak samo, gdy w kroku są klastry (rozdział par tylko w update)', () => {
  const scene = (withRigid) => {
    gameConfig();
    D.addTerrain(flatTerrain());
    const a = beamBody(slab(20, 8, 15), { planar: true, position: { x: 0, y: 0, z: 0 }, velocity: { x: 500, y: 0, z: 0 } });
    const b = beamBody(slab(20, 8, 15), { planar: true, position: { x: 450, y: 40, z: 0 } });
    a.colZ0 = b.colZ0 = -70; a.colZ1 = b.colZ1 = 70;
    const s3 = beamBody(slab(4, 4, 30, 4), { planar: false, position: { x: -2000, y: 0, z: 300 }, gravity: { x: 0, y: 0, z: -400 } });
    const bodies = [a, s3, b];
    // klastry daleko od ciał belek (inny kąt sceny) — w liście między nimi, z parami i terenem
    if (withRigid) {
      bodies.splice(1, 0, D.createRigidBody(boxDesc(), { position: { x: 8000, y: 0, z: 200 }, gravity: { x: 0, y: 0, z: -400 } }));
      bodies.push(D.createRigidBody(boxDesc(), { position: { x: 8050, y: 30, z: 450 }, gravity: { x: 0, y: 0, z: -400 } }));
    }
    step(bodies, 1 / 60, 180);
    return hashBodies(bodies.filter((x) => !x.rigid));
  };
  const plain = scene(false);
  const mixed = scene(true);
  assert.equal(mixed, plain);
});

test('taran: klaster wbija się w zakotwiczoną ścianę płaską — węzły ściany się gniotą, klaster hamuje', () => {
  gameConfig();
  const dt = 1 / 60;
  const wall = beamBody(slab(30, 6, 15), { planar: true, anchored: true, position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < wall.nodeStore.count; i += 4) wall.nodeStore.invMass[i] = 0;
  wall.colZ0 = -70; wall.colZ1 = 70;
  const hp0 = wall.nodeStore.hp.slice();
  const r = D.createRigidBody(boxDesc(), { position: { x: 220, y: 400, z: 0 }, velocity: { x: 0, y: -1500, z: 0 } });
  let crushes = 0, pairs = 0;
  step([wall, r], dt, 30, () => { crushes += D.rigidPerf.crushes; pairs += D.rigidPerf.beamNarrow; });
  assert.ok(pairs > 0, 'styk klaster × ściana');
  assert.ok(crushes > 0, 'granica plastyczności przekroczona — zgniot');
  let moved = 0;
  const s = wall.nodeStore;
  for (let i = 0; i < s.count; i++) if (!s.active[i] || Math.abs(s.y[i] - s.oy[i]) > 1 || s.hp[i] < hp0[i]) moved++;
  assert.ok(moved > 0, 'ściana wgnieciona');
  assert.ok(r.vel.y > -1500, `klaster hamuje: vy ${r.vel.y}`);
});

test('R11: klaster do 9000 j/s nie przenika przez cienką ścianę (1 komórka 15 j.) — CCD punktów (bez CCD przelatuje)', () => {
  // Kontrola: przy 3000 / 6000 j/s droga w kroku (50 / 100 j.) mieści się w oknie wykrycia dyskretnego (ściana + 2 zasięgi
  // styku + punkty boków bryły) — dopiero 9000 j/s (150 j. na krok) przelatuje bez CCD, więc test sprawdza CCD tam, gdzie
  // bez niego jest przelot (recenzja E2, zgł. 7). Dwa kształty: blok 200 × 200 × 100 i cienka płyta 200 × 16 × 100.
  const shapes = [{ name: 'blok', desc: () => boxDesc() },
    { name: 'płyta', desc: () => buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 100, hy: 8, hz: 50, mass: 2e4, id: 0 }], { spacing: 50 }) }];
  const run = (desc, v, ccd) => {
    gameConfig();
    D.rigidConfig.ccd = ccd;
    // ściana 600 j. pod całym klastrem (x 100–300): uderzenie w koniec ściany obraca klaster i zsuwa go obok — to nie przenikanie
    const wall = beamBody(slab(40, 1, 15), { planar: true, anchored: true, position: { x: 200, y: 0, z: 0 } }, 50);
    for (let i = 0; i < wall.nodeStore.count; i++) wall.nodeStore.invMass[i] = 0;
    wall.collisionArmor = 1e6;
    wall.colZ0 = -70; wall.colZ1 = 70;
    const r = D.createRigidBody(desc, { position: { x: 200, y: 600, z: 0 }, velocity: { x: 0, y: -v, z: 0 } });
    step([wall, r], 1 / 60, 40);
    return r.pos.y;
  };
  for (const sh of shapes) {
    assert.ok(run(sh.desc(), 9000, false) < 0, `${sh.name}: kontrola — bez CCD 9000 j/s przelatuje`);
    for (const v of [3000, 6000, 9000]) {
      const y = run(sh.desc(), v, true);
      assert.ok(y > 0, `${sh.name} ${v} j/s z CCD: klaster po stronie wejścia (y ${y.toFixed(1)})`);
    }
  }
});

test('klaster na bryle belek 3D: impuls na całą bryłę, klaster leży na niej', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const dt = 1 / 60;
  const solid = beamBody(slab(8, 8, 30, 3), { planar: false, position: { x: 0, y: 0, z: 60 }, gravity: { x: 0, y: 0, z: -400 } });
  const r = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 300 }, gravity: { x: 0, y: 0, z: -400 } });
  let pairs = 0;
  step([solid, r], dt, 300, () => { pairs += D.rigidPerf.beamNarrow; });
  assert.ok(pairs > 0, 'styk klaster × bryła');
  const top = solid.pos.z + solid._boundsMinMax[5];
  // spód klastra (kule) na kulach węzłów wierzchu bryły (promień węzła 16,5 przy komórce 30)
  assert.ok(r.pos.z - 50 > top - 5 && r.pos.z - 50 < top + 30, `klaster na bryle: spód ${r.pos.z - 50}, wierzch bryły ${top}`);
  assert.ok(Math.abs(r.pos.x) < 60 && Math.abs(r.pos.y) < 60, 'nie zsunął się');
});

test('przegub ciało–świat (zawias, addJoint) trzyma punkt klastra przy przewracaniu i pęka przy przechyle', () => {
  gameConfig();
  const dt = 1 / 60;
  // wysoki klaster (słup 3 bloków) z zawiasem u podstawy; kopnięcie obrotu ku +x
  const desc = buildClusterDesc([{ x: 0, y: 0, z: 100, hx: 60, hy: 60, hz: 100, mass: 1e5, id: 0 },
    { x: 0, y: 0, z: 300, hx: 60, hy: 60, hz: 100, mass: 1e5, id: 1 }, { x: 0, y: 0, z: 500, hx: 60, hy: 60, hz: 100, mass: 1e5, id: 2 }]);
  const b = D.createRigidBody(desc, { origin: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: -400 } });
  const j = D.addJoint(b, 0, 0, 0, { breakTilt: 1.0 });
  b.angVel.y = 0.3;
  let held = 0;
  for (let k = 0; k < 600 && !j.broken; k++) {
    D.integrate(dt, [b]); D.update(dt, [b]);
    // punkt przegubu w świecie: pos + R·(lokalny)
    const m = D._refreshRot(b);
    const wx = b.pos.x + m[0] * j.lx + m[1] * j.ly + m[2] * j.lz, wz = b.pos.z + m[6] * j.lx + m[7] * j.ly + m[8] * j.lz;
    held = Math.max(held, Math.sqrt(wx * wx + wz * wz));
  }
  assert.ok(j.broken, 'zawias pękł po przechyle');
  assert.ok(held < 15, `punkt zawiasu trzymany (odchyłka ≤ ${held.toFixed(1)} j.)`);
});

test('hak grafu onRigidContact: blok najgłębszego punktu i impuls oddany klastrowi', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const calls = [];
  D.onRigidContact = (body, blk, jx, jy, jz, x, y, z) => { calls.push({ body, blk, jz, z }); };
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 200 }, gravity: { x: 0, y: 0, z: -400 } });
  step([b], 1 / 60, 60);
  assert.ok(calls.length > 0);
  assert.equal(calls[0].body, b);
  assert.equal(calls[0].blk, 7, 'numer bloku W GRAFIE (id z opisu bloków), nie indeks w opisie');
  assert.ok(calls[0].jz > 0, 'impuls w górę (teren pcha klaster)');
});

test('zamrożenie: nieruchoma podpora (bez całkowania i snu), odmrożenie przywraca ruch', () => {
  gameConfig();
  const dt = 1 / 60;
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 500 }, gravity: { x: 0, y: 0, z: -400 } });
  assert.equal(D.freezeBody(b), 32);
  step([b], dt, 30);
  assert.equal(b.pos.z, 500);
  assert.equal(D.rigidPerf.frozen, 1);
  // klaster spada na zamrożony i leży na nim
  const top = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 700 }, gravity: { x: 0, y: 0, z: -400 } });
  step([b, top], dt, 240);
  assert.ok(Math.abs(top.pos.z - 600) < 4, `na zamrożonym: ${top.pos.z}`);
  D.unfreezeRigid(b);
  step([b, top], dt, 20);
  assert.ok(b.pos.z < 500, 'odmrożony spada');
});

test('determinizm i 60 / 120 Hz: ten sam stos daje ten sam wynik; przy 120 Hz leży tak samo i zasypia', () => {
  const run = (hz) => {
    gameConfig();
    D.addTerrain(flatTerrain());
    const bodies = [];
    for (let i = 0; i < 6; i++) {
      bodies.push(D.createRigidBody(boxDesc(), { position: { x: (i % 3) * 90, y: (i % 2) * 60, z: 100 + i * 180 },
        quaternion: { x: 0.05 * i, y: 0.03 * (i % 2), z: 0, w: 1 }, gravity: { x: 0, y: 0, z: -400 } }));
    }
    step(bodies, 1 / hz, Math.round(8 * hz));
    return { hash: hashBodies(bodies), sleeping: bodies.filter((b) => b.isSleeping).length, zs: bodies.map((b) => b.pos.z) };
  };
  const a = run(60), b = run(60);
  assert.equal(a.hash, b.hash);
  const c = run(120);
  assert.equal(a.sleeping, 6, '60 Hz: stos śpi');
  assert.equal(c.sleeping, 6, '120 Hz: stos śpi');
  const lowA = Math.min(...a.zs), lowC = Math.min(...c.zs);
  assert.ok(Math.abs(lowA - lowC) < 6, `dolny klaster ${lowA} / ${lowC}`);
});

test('budżet aktywnych: nadmiar wolnych podpartych zasypia od najlżejszego', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  D.rigidConfig.maxActive = 3;
  D.rigidConfig.sleepTicks120 = 100000;    // bez zwykłego snu — tylko budżet
  const bodies = [];
  for (let i = 0; i < 6; i++) {
    const desc = buildClusterDesc([{ ...BOX, mass: 1e5 + i * 1e4 }]);
    bodies.push(D.createRigidBody(desc, { position: { x: i * 400, y: 0, z: 52 }, gravity: { x: 0, y: 0, z: -400 } }));
  }
  step(bodies, 1 / 60, 30);
  assert.equal(D.rigidPerf.awake, 3);
  assert.deepEqual(bodies.map((b) => b.isSleeping), [true, true, true, false, false, false], 'najlżejsze śpią');
});

test('HullBodies.createCluster: encja-lustro jak wrak bryły, limit klastrów, broń klaster mija, zamrożenie', async () => {
  globalThis.window = globalThis.window || {};
  const { HullBodies } = await import('../src/game/hullBodies.js');
  HullBodies.init();
  HullBodies.engine.terrains.length = 0;
  const e = { name: 'klaster', isWreck: true };
  const hull = HullBodies.createCluster(e, boxDesc(), { position: { x: 1000, y: -2000, z: 300 },
    quaternion: { x: 0, y: 0, z: Math.sin(0.3), w: Math.cos(0.3) }, gravity: { x: 0, y: 0, z: -400 } });
  assert.ok(hull && hull.rigid === true && e.beamHull === hull);
  assert.equal(e.solid3D, true); assert.equal(e.rigidCluster, true);
  assert.equal(e.x, 1000); assert.equal(e.y, 2000); assert.equal(e.z, 300);
  assert.ok(Math.abs(e.angle - (-0.6)) < 1e-9, `kąt gry ${e.angle}`);
  HullBodies.step(1 / 60, [e]);
  assert.ok(e.vz < 0, 'lustro prędkości');
  assert.equal(HullBodies.sweep(e, 900, 2000, 1100, 2000, 5), null);
  assert.equal(HullBodies.impact(e, 1000, 2000, 50), false);
  assert.equal(HullBodies.convertToWreck(e), null);
  assert.equal(HullBodies.cellAlive(e, 0, 0), false, 'klaster bez siatki komórek (repairRig pyta o komórki)');
  assert.equal(HullBodies.freezeCluster(e), true);
  const z = e.z;
  HullBodies.step(1 / 60, [e]);
  assert.equal(e.z, z, 'zamrożony stoi');
  const max = HullBodies.config.maxClusters;
  HullBodies.config.maxClusters = HullBodies.clusterCount();
  assert.equal(HullBodies.createCluster({ name: 'nadmiar' }, boxDesc(), { position: { x: 0, y: 0, z: 0 } }), null, 'limit osobny od maxWrecks');
  HullBodies.config.maxClusters = max;
  HullBodies.release(e);
  assert.equal(hull.body.dead, true);
});


// ============================ RECENZJA E2 (runda poprawek) ============================

test('opis klastra: długi blok ma ≥ 2 rzędy punktów w środkowym wymiarze (nie wałek z kul), kule nie przerastają dwóch wymiarów', () => {
  const d = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 600, hy: 60, hz: 40, mass: 2e5, id: 0 }], { spacing: 50, maxPoints: 64 });
  const ys = new Set();
  for (let k = 0; k < d.pointCount; k++) ys.add(Math.round(d.points[k * 4 + 1]));
  assert.ok(ys.size >= 2, `rzędy w poprzek (y): ${[...ys]}`);
  for (let k = 0; k < d.pointCount; k++) {
    const r = d.points[k * 4 + 3];
    assert.ok(Math.abs(d.points[k * 4 + 1]) + r <= 60 + 1e-9, 'kula w szerokości bloku');
    assert.ok(Math.abs(d.points[k * 4 + 2]) + r <= 40 + 1e-9, 'kula w grubości bloku');
  }
});

test('leżący długi klaster (1200 × 120 × 80, 1200 × 200 × 200) zasypia na płaskim terenie w ≤ 5 s', () => {
  for (const [hx, hy, hz] of [[600, 60, 40], [600, 100, 100]]) {
    gameConfig();
    D.addTerrain(flatTerrain());
    const desc = buildClusterDesc([{ x: 0, y: 0, z: 0, hx, hy, hz, mass: 2e5, id: 0 }], { spacing: 50, maxPoints: 64 });
    const b = D.createRigidBody(desc, { position: { x: 0, y: 0, z: hz + 200 }, gravity: { x: 0, y: 0, z: -400 } });
    let slept = -1;
    step([b], 1 / 60, 300, (k) => { if (slept < 0 && b.isSleeping) slept = k; });
    assert.ok(slept >= 0, `${2 * hx} × ${2 * hy} × ${2 * hz}: zasnął (sleepFrames ${b.sleepFrames})`);
    assert.ok(Math.abs(b.pos.z - hz) < 3, `leży na swojej wysokości: ${b.pos.z.toFixed(1)}`);
  }
});

test('dwa tereny w zasięgu: pamięć terenu jest na teren — klaster leży na bliższym, drugi go nie wyrzuca', () => {
  const run = (two) => {
    gameConfig();
    D.addTerrain(flatTerrain());
    if (two) D.addTerrain({ cx: 0, cy: 0, cz: -5000, R: 3000, rMax: 6000, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null, radius() { return 3000; } });
    const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 300 }, gravity: { x: 0, y: 0, z: -400 } });
    step([b], 1 / 60, 240);
    return b;
  };
  const a = run(false), b = run(true);
  assert.ok(Math.abs(b.pos.z - a.pos.z) < 0.5 && b.pos.z < 60, `z z drugim terenem ${b.pos.z.toFixed(2)} (jeden: ${a.pos.z.toFixed(2)})`);
  assert.ok(b.isSleeping, 'śpi');
});

test('teren z garbem pod długim klastrem: punkty nad płaszczyzną styczną nie wchodzą w zbocze', () => {
  for (const bump of [100, 200]) {
    gameConfig();
    const RT = 20000;
    const sm = (x) => { const t = Math.max(0, Math.min(1, (x - 150) / 300)); return t * t * (3 - 2 * t); };
    D.addTerrain({ cx: 0, cy: 0, cz: -RT, R: RT, rMax: RT + bump + 1, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
      radius(ux) { return RT + bump * sm(ux * RT); } });
    const desc = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 600, hy: 60, hz: 40, mass: 2e5, id: 0 }], { spacing: 50, maxPoints: 64 });
    const b = D.createRigidBody(desc, { position: { x: 0, y: 0, z: 400 }, gravity: { x: 0, y: 0, z: -400 } });
    let worst = 0;
    step([b], 1 / 60, 400, (k) => {
      if (k < 200) return;
      const g = b.rg, m = D._refreshRot(b);
      for (let i = 0; i < g.n; i++) {
        const px = b.pos.x + m[0] * g.lx[i] + m[1] * g.ly[i] + m[2] * g.lz[i];
        const pz = b.pos.z + m[6] * g.lx[i] + m[7] * g.ly[i] + m[8] * g.lz[i];
        worst = Math.max(worst, bump * sm(px) - (pz - g.r[i]));
      }
    });
    // dawniej 15,5 / 104,5 j. (punkty pominięte nad płaszczyzną styczną pod środkiem)
    assert.ok(worst < 12, `garb ${bump}: największe przenikanie punktu ${worst.toFixed(1)} j.`);
  }
});

test('pchanie śpiącego: statek wolniejszy niż wakeSpeed przesuwa uśpiony klaster (tarcie podparcia przekroczone)', () => {
  for (const vPush of [12, 20]) {
    gameConfig();
    const RT = 20000;
    D.addTerrain({ cx: 0, cy: 0, cz: -RT, R: RT, rMax: RT + 1, friction: 0, armorMul: 3, restAngDamp: 2, onContact: null, radius() { return RT - 50; } });
    const r = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: -400 }, friction: 0 });
    step([r], 1 / 60, 240);
    assert.ok(r.isSleeping, 'klaster śpi przed pchaniem');
    const ship = beamBody(slab(20, 8, 15), { planar: true, position: { x: -275, y: -60, z: 0 } });
    ship.colZ0 = -70; ship.colZ1 = 70;
    const x0 = r.pos.x;
    for (let k = 0; k < 240; k++) {
      ship.vel.x = vPush; ship.vel.y = 0; ship.angVel.z = 0;
      ship.pos.x += ship.vel.x / 60;
      D.integrate(1 / 60, [r]); D.update(1 / 60, [r, ship]);
    }
    // dawniej 0 j. (śpiący = ściana o masie ∞ poniżej wakeSpeed 30 j/s; statek stał w miejscu)
    assert.ok(r.pos.x - x0 > 1.5 * vPush, `${vPush} j/s: klaster przesunięty o ${(r.pos.x - x0).toFixed(1)} j.`);
  }
});

test('pchanie śpiącego: leżący stos nie budzi podpory (impuls pionowy, tarcie ≤ μ · docisk)', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const lo = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 50 }, gravity: { x: 0, y: 0, z: -400 } });
  const hi = D.createRigidBody(boxDesc(), { position: { x: 10, y: 0, z: 152 }, gravity: { x: 0, y: 0, z: -400 } });
  let both = -1, wokeAfter = 0;
  step([lo, hi], 1 / 60, 480, (k) => {
    if (both < 0 && lo.isSleeping && hi.isSleeping) both = k;
    else if (both >= 0 && !(lo.isSleeping && hi.isSleeping)) wokeAfter++;
  });
  assert.ok(both >= 0, 'stos zasypia');
  assert.equal(wokeAfter, 0, 'i zostaje uśpiony');
});

test('utrata podpory: śpiący klaster spada, gdy podpora (klaster, bryła belek, komórki płyty) znika', () => {
  const G = { x: 0, y: 0, z: -400 };
  // (a) dolny klaster znika (release / rozpad)
  {
    gameConfig();
    D.addTerrain(flatTerrain());
    const lo = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 50 }, gravity: G });
    const hi = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 152 }, gravity: G });
    step([lo, hi], 1 / 60, 400);
    assert.ok(hi.isSleeping, '(a) górny śpi na dolnym');
    lo.dead = true;
    step([lo, hi], 1 / 60, 120);
    assert.ok(hi.pos.z < 60, `(a) górny spadł na teren: z ${hi.pos.z.toFixed(1)}`);
  }
  // (b) zakotwiczona bryła belek ginie (dead) albo znika z listy kroku (encja zwolniona)
  for (const mode of ['dead', 'poza listą']) {
    gameConfig();
    const st = slab(10, 10, 30, 3);
    const base = D.createBody(st, { planar: false, anchored: true, position: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < base.nodeStore.count; i++) base.nodeStore.invMass[i] = 0;
    let zt = -Infinity; for (let i = 0; i < base.nodeStore.count; i++) zt = Math.max(zt, base.nodeStore.z[i]);
    const top = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: zt + 75 }, gravity: G });
    step([base, top], 1 / 60, 200);
    assert.ok(top.isSleeping, `(b ${mode}) klaster śpi na bryle`);
    const z0 = top.pos.z;
    if (mode === 'dead') base.dead = true;
    step(mode === 'dead' ? [base, top] : [top], 1 / 60, 60);
    assert.ok(top.pos.z < z0 - 50, `(b ${mode}) spada: z ${z0.toFixed(1)} → ${top.pos.z.toFixed(1)}`);
  }
  // (c) komórki pola płyty pod nim giną — także zmiana grubości z zewnątrz bez wersji pola (sprawdzanie co supportPeriod)
  for (const bump of [true, false]) {
    gameConfig();
    const F = D.addPlateField({ origin: { x: -900, y: -900, z: 0 }, cell: 45, nu: 40, nv: 40, thickness: 90, capacity: 1e12, massPerCell: 1e3 });
    const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 200 }, gravity: G });
    step([b], 1 / 60, 300);
    assert.ok(b.isSleeping, '(c) śpi na płycie');
    F.thick.fill(0);
    if (bump) F.version++;
    step([b], 1 / 60, 60);
    assert.ok(b.pos.z < 0, `(c ${bump ? 'wersja' : 'z zewnątrz'}) spadł przez otwór: z ${b.pos.z.toFixed(1)}`);
  }
});

test('utrata podpory: zamrożony klaster odmarza, gdy jego podpora zginie', () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const lo = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 50 }, gravity: { x: 0, y: 0, z: -400 } });
  const hi = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 152 }, gravity: { x: 0, y: 0, z: -400 } });
  step([lo, hi], 1 / 60, 400);
  D.freezeBody(hi);
  lo.dead = true;
  step([lo, hi], 1 / 60, 120);
  assert.equal(hi.anchored, false, 'odmrożony');
  assert.ok(hi.pos.z < 60, `spadł: z ${hi.pos.z.toFixed(1)}`);
});
