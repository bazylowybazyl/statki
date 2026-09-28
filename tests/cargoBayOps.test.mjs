// Przeładunek dronami ładownia ↔ plac (zadanie 26): bezstanowy stan w czasie, zachowanie
// modułów, trasy dronów (ruch poziomy tylko na przelocie, wejście do ładowni po starcie
// okna, powrót do gniazda). Czysta logika, bez GPU. node --test tests/cargoBayOps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { cargoBayGeometry, cargoBayDoorTimeline } from '../src/data/cargoBays.js';
import {
  BAY_CARRIED,
  BAY_CARRIED_STRIDE,
  BAY_DRONE,
  BAY_DRONE_STRIDE,
  BAY_MODE,
  BAY_PHASE,
  bayOrderCellsNear,
  bayTrackPose,
  bayTransferState,
  bayWorldSlots,
  bayYardCells,
  createBayTransferState,
  planBayTransfer
} from '../src/game/cargoBayOps.js';

// Scena jak w demie: Atlas w (0, 0) kursem 0, plac stacji 700 j. „w dół ekranu gry” (+y gry
// = −y sceny), gniazda dronów przy placu.
function scene(mode, count = 24, drones = 6) {
  const geo = cargoBayGeometry('atlas', 'grzbiet');
  const pose = { x: 0, y: 0, angle: 0 };
  const slots = bayWorldSlots(geo, pose, 0);
  const unit = { L: geo.module.L, W: geo.module.W, H: geo.module.H };
  const cells = bayOrderCellsNear(bayYardCells(0, -700, 0, 0, 12, 6, unit, 6), 0, 0);
  const nests = [];
  for (let i = 0; i < 6; i++) nests.push({ x: -250 + i * 100, y: -540, z: 0 });
  const T = cargoBayDoorTimeline(geo);
  const plan = planBayTransfer({
    seed: 7, mode, unit, slots, cells, count, nests, drones, start: T.total + 0.3, obstacleTop: 8
  });
  return { geo, plan, slots, cells, T };
}

test('plan is deterministic: the same context gives the same tracks and job times', () => {
  const a = scene(BAY_MODE.LOAD).plan;
  const b = scene(BAY_MODE.LOAD).plan;
  assert.equal(a.tracks.length, b.tracks.length);
  for (let i = 0; i < a.tracks.length; i++) assert.deepEqual(Array.from(a.tracks[i].kf), Array.from(b.tracks[i].kf));
  assert.deepEqual(Array.from(a.tLock), Array.from(b.tLock));
  assert.deepEqual(Array.from(a.tRelease), Array.from(b.tRelease));
});

for (const mode of [BAY_MODE.LOAD, BAY_MODE.UNLOAD]) {
  test(`${mode}: modules are conserved at every instant; start and end states are the full store`, () => {
    const { plan } = scene(mode);
    const st = createBayTransferState(plan);
    assert.ok(plan.end > plan.start);
    const N = plan.N;
    for (let t = plan.start - 1; t <= plan.end + 1; t += 0.05) {
      bayTransferState(plan, t, st);
      assert.equal(st.inBay + st.onYard + st.carriedCount, N, `t = ${t.toFixed(2)}: ${st.inBay} + ${st.onYard} + ${st.carriedCount}`);
    }
    bayTransferState(plan, plan.start - 0.5, st);
    assert.equal(mode === BAY_MODE.LOAD ? st.onYard : st.inBay, N);
    assert.equal(st.droneCount, 0);
    bayTransferState(plan, plan.end + 0.5, st);
    assert.equal(mode === BAY_MODE.LOAD ? st.inBay : st.onYard, N);
    assert.equal(st.droneCount, 0, 'drony wróciły do gniazd');
    assert.ok(st.done);
    // Załadunek zapełnia pierwsze sloty kolejności (od rufy).
    if (mode === BAY_MODE.LOAD) for (let j = 0; j < N; j++) assert.equal(st.slotHas[j], 1);
  });
}

test('each job: lock before release, the carried module hangs under the drone hook', () => {
  const { plan } = scene(BAY_MODE.LOAD);
  const st = createBayTransferState(plan);
  for (let j = 0; j < plan.N; j++) {
    assert.ok(plan.tLock[j] < plan.tRelease[j], `zadanie ${j}`);
    const mid = (plan.tLock[j] + plan.tRelease[j]) / 2;
    bayTransferState(plan, mid, st);
    let found = false;
    for (let k = 0; k < st.carriedCount; k++) {
      const c = k * BAY_CARRIED_STRIDE;
      if (st.carried[c + BAY_CARRIED.JOB] !== j) continue;
      found = true;
      for (let d = 0; d < st.droneCount; d++) {
        const o = d * BAY_DRONE_STRIDE;
        if (st.drones[o + BAY_DRONE.CARRY] !== j) continue;
        assert.ok(Math.abs(st.drones[o + BAY_DRONE.Z] - plan.unit.H - st.carried[c + BAY_CARRIED.Z]) < 1e-3);
        assert.ok(Math.abs(st.drones[o + BAY_DRONE.X] - st.carried[c + BAY_CARRIED.X]) < 1e-3);
      }
    }
    assert.ok(found, `zadanie ${j}: moduł nie wisi pod dronem w połowie kursu`);
  }
});

test('drones move horizontally only at cruise altitude and never enter the bay before the window', () => {
  for (const mode of [BAY_MODE.LOAD, BAY_MODE.UNLOAD]) {
    const { plan, T } = scene(mode);
    assert.ok(plan.start >= T.total, 'okno po otwarciu wrót');
    assert.ok(plan.bayFirstEntry >= plan.start);
    assert.ok(plan.bayClearAt <= plan.end);
    for (const tr of plan.tracks) {
      const kf = tr.kf;
      const S = 9;
      for (let i = 0; i + 1 < tr.count; i++) {
        const dx = kf[(i + 1) * S + 1] - kf[i * S + 1];
        const dy = kf[(i + 1) * S + 2] - kf[i * S + 2];
        if (Math.hypot(dx, dy) < 1e-6) continue;
        assert.ok(Math.abs(kf[i * S + 3] - tr.cruise) < 1e-6 && Math.abs(kf[(i + 1) * S + 3] - tr.cruise) < 1e-6,
          `${mode} dron ${tr.drone}: ruch poziomy poza wysokością przelotu (klatka ${i})`);
      }
      // Przelot nad kadłubem, stosem skrzydeł i modułem pod hakiem.
      assert.ok(tr.cruise >= 8 + plan.unit.H);
      // Dron w ładowni (pole BAY ≥ 0) tylko w oknie.
      for (let t = plan.start - 2; t < plan.end + 2; t += 0.1) {
        const p = bayTrackPose(tr, t, {});
        if (p.visible && p.bay >= 0) assert.ok(t >= plan.start);
      }
    }
  }
});

test('work is split into contiguous stretches along the bay: drones do not cross in the hold', () => {
  const { plan, slots } = scene(BAY_MODE.LOAD, 30, 5);
  const spans = plan.tracks.map((tr) => {
    const xs = tr.jobs.map((j) => slots[j].x);
    return [Math.min(...xs), Math.max(...xs)];
  }).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < spans.length; k++) assert.ok(spans[k][0] >= spans[k - 1][1] - 1e-6, JSON.stringify(spans));
  // Każdy dron ma zadania, suma = N, drony startują po kolei.
  assert.equal(plan.tracks.reduce((s, tr) => s + tr.jobs.length, 0), plan.N);
  for (let k = 1; k < plan.tracks.length; k++) assert.ok(plan.tracks[k].kf[0] > plan.tracks[k - 1].kf[0]);
  // Drony ukryte w gniazdach na początku i końcu (płaszczyzna cięcia na pokładzie).
  const first = bayTrackPose(plan.tracks[0], plan.tracks[0].kf[0] + 0.01, {});
  assert.equal(first.phase, BAY_PHASE.LAUNCH);
  assert.ok(first.clip > -1e8 && first.z < first.clip);
});

test('an empty transfer plans no drones and a count above the stores is clamped', () => {
  const geo = cargoBayGeometry('terran_frigate', 'grzbiet');
  const slots = bayWorldSlots(geo, { x: 0, y: 0, angle: 0 }, 0);
  const unit = { L: geo.module.L, W: geo.module.W, H: geo.module.H };
  const cells = bayYardCells(0, -200, 0, 0, 2, 2, unit);
  const none = planBayTransfer({ mode: BAY_MODE.LOAD, unit, slots, cells, count: 0, drones: 3 });
  assert.equal(none.D, 0);
  assert.equal(none.tracks.length, 0);
  const many = planBayTransfer({ mode: BAY_MODE.LOAD, unit, slots, cells, count: 99, drones: 3 });
  assert.equal(many.N, Math.min(slots.length, cells.length));
  assert.ok(many.D <= many.N);
});
