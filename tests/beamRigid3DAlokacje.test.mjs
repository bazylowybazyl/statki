// KLASTRY SZTYWNE bez alokacji w kroku (src/game/beamRigid3D.js; zasada 7). Osobny plik = osobny proces: w jednym procesie
// z testami par klaster × ciało belek i HullBodies te same miejsca kodu widzą też ciała belek (wiele map V8) i pomiar
// pokazywał 37–58 KB / 60 kroków, w czystym procesie — 0 (pomiar 2026-11-04). AGENT: sprawdzić w grze (E4 / E7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildClusterDesc, createRigidConfig, rigidCollide, rigidAfterStep } from '../src/game/beamRigid3D.js';
import { plateFieldPass } from '../src/game/beamPlateField3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { HULL_BODY_CONFIG as C } from '../src/game/hullBodies.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

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

// Moduł klastrów bez alokacji: przebiegi rigidCollide / rigidAfterStep jak w update (pętle silnika update / integrate mają
// własne, starsze alokacje — iteratory for…of, liczniki czasu — mierzy je kto inny), ruch ciał całkowany ręcznie.
// Gorąca ścieżka stosu: pary klaster × klaster, teren, sen, budżet. Próg 8192 B / 60 kroków obejmuje narzut pomiaru
// (pusta funkcja: ~2,3 KB — getHeapSpaceStatistics). AGENT: para klaster × ciało belek i przebieg pola płyty mają
// jeszcze resztkowe alokacje w stanie ustalonym (pomiar 2026-11-04, recenzja E2: ~1 liczba / wywołanie płyty, ~3 / krok
// pary ze stykiem — zapis liczby w pole obiektu, źródła nie znaleziono; dawniej płyta ~10 KB / 60 kroków ponad narzut,
// usunięte z ruchliwości i impulsów w miejscu) — testy niżej pilnują, żeby nie wróciły do dawnego poziomu.
test('klastry bez alokacji w kroku (stan ustalony JIT): pary klaster × klaster, teren, sen', async () => {
  gameConfig();
  D.addTerrain(flatTerrain());
  const bodies = [];
  for (let i = 0; i < 24; i++) {
    bodies.push(D.createRigidBody(boxDesc(), { position: { x: (i % 4) * 150, y: Math.floor(i / 4) % 3 * 150, z: 60 + Math.floor(i / 12) * 400 + (i % 3) * 30 },
      quaternion: { x: 0.04 * (i % 5), y: 0, z: 0.03 * (i % 3), w: 1 }, gravity: { x: 0, y: 0, z: -400 } }));
  }
  const all = [...bodies];
  D.rigidConfig.sleepTicks120 = 100000;    // stos żywy przez cały pomiar
  const dt = 1 / 60;
  for (let k = 0; k < 120; k++) { D.integrate(dt, bodies); D.update(dt, all); }
  const tick = () => {
    D._tick++;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      b.vel.z -= 400 * dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      D._refreshRot(b);
    }
    rigidCollide(D, all, dt, 0);
    rigidCollide(D, all, dt, 1);
    rigidAfterStep(D, dt);
  };
  for (let k = 0; k < 200; k++) tick();
  assert.ok(D.rigidPerf.contacts > 0 && D.rigidPerf.pairs > 0, 'stos w styku');
  const best = await untilSteady(() => allocatedBytes(tick, 60), (b) => b <= 8192, { warm: () => { for (let k = 0; k < 30; k++) tick(); } });
  assert.ok(best <= 8192, `alokacje na 60 kroków: ${best} B`);
});

test('pole płyty bez alokacji w kroku (stan ustalony JIT): klaster leży na płycie (obie iteracje)', async () => {
  gameConfig();
  D.addPlateField({ origin: { x: -900, y: -900, z: 0 }, cell: 45, nu: 40, nv: 40, thickness: 90, capacity: 1e12, massPerCell: 2e4 });
  D.rigidConfig.sleepTicks120 = 100000;
  const dt = 1 / 60;
  const b = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 160 }, gravity: { x: 0, y: 0, z: -400 } });
  const bodies = [b];
  for (let k = 0; k < 120; k++) { D.integrate(dt, bodies); D.update(dt, bodies); }
  const tick = () => {
    D._tick++;
    b.vel.z -= 400 * dt; b.pos.z += b.vel.z * dt;
    D._refreshRot(b);
    plateFieldPass(D, bodies, dt, true);
    plateFieldPass(D, bodies, dt, false);
  };
  for (let k = 0; k < 600; k++) tick();
  assert.ok(D.platePerf.contacts > 0, 'klaster w styku z płytą');
  const best = await untilSteady(() => allocatedBytes(tick, 60), (x) => x <= 8192, { warm: () => { for (let k = 0; k < 300; k++) tick(); } });
  assert.ok(best <= 8192, `alokacje na 60 kroków: ${best} B`);
});

test('para klaster × ciało belek bez alokacji w kroku (stan ustalony JIT): klaster leży na zakotwiczonej bryle', async () => {
  gameConfig();
  D.rigidConfig.sleepTicks120 = 100000;
  const cells = [], n = 10, nz = 3, cs = 30;
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const edge = ix === 0 || iy === 0 || iz === 0 || ix === n - 1 || iy === n - 1 || iz === nz - 1;
    cells.push({ ix, iy, iz, x: (ix + 0.5) * cs, y: (iy + 0.5) * cs, z: (iz + 0.5) * cs, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  const st = buildBeamStructure({ cells, nx: n, ny: n, nz, cellSize: cs, origin: { x: 0, y: 0, z: 0 } }, { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
  const slab = D.createBody(st, { planar: false, anchored: true, position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < slab.nodeStore.count; i++) slab.nodeStore.invMass[i] = 0;
  const dt = 1 / 60;
  const top = D.createRigidBody(boxDesc(), { position: { x: 0, y: 0, z: 100 }, gravity: { x: 0, y: 0, z: -400 } });
  const all = [slab, top];
  for (let k = 0; k < 120; k++) { D.integrate(dt, [top]); D.update(dt, all); }
  const tick = () => {
    D._tick++;
    top.vel.z -= 400 * dt; top.pos.z += top.vel.z * dt;
    D._refreshRot(top); D._refreshRot(slab);
    rigidCollide(D, all, dt, 0); rigidCollide(D, all, dt, 1); rigidAfterStep(D, dt);
  };
  for (let k = 0; k < 600; k++) tick();
  assert.ok(D.rigidPerf.contacts > 0 && D.rigidPerf.beamPairs > 0, 'klaster w styku z bryłą');
  const best = await untilSteady(() => allocatedBytes(tick, 60), (x) => x <= 8192, { warm: () => { for (let k = 0; k < 300; k++) tick(); } });
  assert.ok(best <= 8192, `alokacje na 60 kroków: ${best} B`);
});

// OSTATNI w pliku: HullBodies.init przestawia silnik (konfiguracja i haki gry). Front zgniotu prowadzi wyspę co krok
// (collapsePreStep → driveCluster), więc samo prowadzenie nie alokuje: poza, prędkości, grawitacja wył. / liczba g.
test('HullBodies.driveCluster bez alokacji (stan ustalony JIT): front prowadzi klaster co krok', async () => {
  globalThis.window = globalThis.window || {};
  const { HullBodies } = await import('../src/game/hullBodies.js');
  HullBodies.ready = false;
  HullBodies.init();
  const e = { name: 'front', isWreck: true };
  assert.ok(HullBodies.createCluster(e, boxDesc(), { position: { x: 0, y: 0, z: 1000 }, gravity: { x: 0, y: 0, z: -400 } }));
  const POS = { x: 0.5, y: -0.5, z: 1000.5 }, VEL = { x: 0.5, y: 0.5, z: -30.5 }, W = { x: 0.01, y: 0.02, z: 0.5 };
  const OFF = { gravity: false }, G80 = { gravity: 80 };
  let k = 0;
  const tick = () => {
    k++;
    POS.z = 1000.5 - (k & 255) * 0.5;
    HullBodies.driveCluster(e, POS, VEL, W, (k & 1) === 1 ? OFF : G80);
  };
  for (let i = 0; i < 2000; i++) tick();
  assert.equal(e.beamHull.body.pos.z, POS.z);
  // 600 wywołań: jedna liczba pakowana na wywołanie (16 B) to ~9,6 KB ponad narzut pomiaru ~2,3 KB (pomiar 2026-11-04:
  // 2,5 KB / 600; nowy obiekt pozy na wywołanie — 60 KB)
  const best = await untilSteady(() => allocatedBytes(tick, 600), (x) => x <= 8192, { warm: () => { for (let i = 0; i < 600; i++) tick(); } });
  assert.ok(best <= 8192, `alokacje na 600 wywołań: ${best} B`);
});
