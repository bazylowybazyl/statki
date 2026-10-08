// Planista roju („wieża portu”, src/game/swarm/swarmPlanner.js) na wykonawcy CPU
// (src/game/swarm/swarmExecCpu.js — lustro maszyny stanów kernela kSteer, bez unikania):
// wszystkie scenariusze dema do końca w obu trybach, bez błędów stosów, poziomów i komórek
// (kontener z miejsca k chwytu ląduje dokładnie w komórce z księgi — kontrola z pozy), z opóźnionym
// odczytem stanu (GPU oddaje stan 1–3 klatki później); wieża SMART mądrzejsza od naiwnej;
// jeden kontener, chwyty różnej wielkości na wspólnym placu.
// node --test tests/swarmPlanner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSwarmScenario, SWARM_SCENARIO_ORDER } from '../src/game/swarm/swarmScenarios.js';
import { createSwarmPlanner, swarmClosestYaw } from '../src/game/swarm/swarmPlanner.js';
import { createSwarmExecCpu } from '../src/game/swarm/swarmExecCpu.js';
import { SWARM_TASK, SWARM_TASK_RING, swarmEntryLevel, SWARM_ENTRY_LEVELS, swarmColumnCounts } from '../src/game/swarm/swarmPort.js';
import { swarmDroneClass } from '../src/data/swarmDrones.js';

function run(id, mode, { lag = 0, count = 256, limit = 1600, onTask = null } = {}) {
  const sc = buildSwarmScenario(id, { count });
  const planner = createSwarmPlanner(sc.port, sc.drones, { mode });
  const ex = createSwarmExecCpu(sc.port, sc.drones);
  const dt = 1 / 30;
  const hist = [];
  // Zapisy zadań: numer zadania w pierścieniu nie może nadpisać wykonywanego.
  const ring = new Map();
  let overwrite = 0;
  const writer = (d, s, rec) => {
    const slot = d * SWARM_TASK_RING + (s % SWARM_TASK_RING);
    const prev = ring.get(slot);
    if (prev !== undefined && prev >= s) overwrite++;
    ring.set(slot, s);
    if (onTask) onTask(sc, d, rec);
    ex.writeTask(d, s, rec);
  };
  let t = 0;
  let stall = 0;
  let lastDone = -1;
  while (t < limit) {
    hist.push(Float32Array.from(ex.status));
    if (hist.length > 4) hist.shift();
    const k = Math.min(hist.length - 1, lag ? 1 + (Math.floor(t * 30) % lag) : 0);
    planner.update(t, hist[hist.length - 1 - k], writer);
    ex.step(dt);
    t += dt;
    if (planner.isDone() && ex.check().parked === sc.drones.length) break;
    if (planner.stats.done !== lastDone) { lastDone = planner.stats.done; stall = 0; } else stall += dt;
    if (stall > 120) break;
  }
  return { sc, planner, check: ex.check(), t, overwrite };
}

for (const id of SWARM_SCENARIO_ORDER) {
  test(`scenariusz ${id}: obie wieże do końca, stosy, poziomy i komórki zgodne, opóźniony odczyt stanu`, () => {
    for (const mode of ['smart', 'naive']) {
      const r = run(id, mode, { lag: 3 });
      const st = r.planner.stats;
      assert.equal(st.done, st.total, `${id}/${mode}: przeniesione ${st.done}/${st.total}`);
      assert.equal(r.check.stackErrors, 0, `${id}/${mode}: błędy stosów`);
      assert.equal(r.check.levelErrors, 0, `${id}/${mode}: błędy poziomów`);
      assert.equal(r.check.cellErrors, 0, `${id}/${mode}: kontener w innej komórce niż w księdze`);
      assert.equal(r.check.overlapErrors, 0, `${id}/${mode}: dwa drony w jednej kolumnie`);
      assert.equal(r.check.parked, r.sc.drones.length, `${id}/${mode}: wszystkie drony w gniazdach`);
      assert.equal(r.overwrite, 0, `${id}/${mode}: nadpisanie wykonywanego zadania w pierścieniu`);
      // Księga wieży = położenie kontenerów u wykonawcy (komórka i poziom).
      let mismatch = 0;
      for (const [u, p] of r.check.positions) {
        if (r.planner.unitCol[u] !== p.col || r.planner.unitLevel[u] !== p.level || r.planner.unitCell[u] !== p.cell) mismatch++;
      }
      assert.equal(mismatch, 0, `${id}/${mode}: księga ≠ wykonawca (${mismatch} kontenerów)`);
      assert.deepEqual([...r.check.counts], [...r.planner.counts], `${id}/${mode}: liczniki kolumn`);
    }
  });
}

test('chwyt płaski: S 1, M 2, L 4, Capital 8 kontenerów — dron nie bierze więcej niż jego chwyt', () => {
  const most = new Map();
  run('port', 'smart', {
    onTask: (sc, d, rec) => {
      const cls = sc.drones[d].classId;
      const n = rec[SWARM_TASK.IDS * 4];
      most.set(cls, Math.max(most.get(cls) || 0, n));
      assert.ok(n >= 1 && n <= swarmDroneClass(cls).pack.nx * swarmDroneClass(cls).pack.ny, `${cls}: chwyt ${n}`);
    }
  });
  assert.equal(most.get('C'), 8, 'Capital: pełny chwyt 4 × 2');
  assert.equal(most.get('L'), 4, 'L: pełny chwyt 2 × 2');
  assert.equal(most.get('M'), 2, 'M: dwa kontenery burta w burtę');
  assert.equal(most.get('S'), 1);
});

test('wspólny plac C: Capital odkłada wagon, L / M / S biorą z tego samego placu do swoich statków', () => {
  const sc = buildSwarmScenario('port', { count: 256 });
  const plC = sc.port.grids.find((g) => g.owner === 'plac-C').index;
  const fromC = new Map();
  const toC = new Map();
  run('port', 'smart', {
    onTask: (s, d, rec) => {
      const cls = s.drones[d].classId;
      const pick = rec[SWARM_TASK.IDS * 4 + 2] | 0;
      const drop = rec[SWARM_TASK.IDS * 4 + 3] | 0;
      if (s.port.columns[pick].grid === plC) fromC.set(cls, (fromC.get(cls) || 0) + 1);
      if (s.port.columns[drop].grid === plC) toC.set(cls, (toC.get(cls) || 0) + 1);
    }
  });
  assert.ok((toC.get('C') || 0) > 0, 'Capital odkłada na plac C');
  for (const cls of ['L', 'M', 'S']) assert.ok((fromC.get(cls) || 0) > 0, `${cls} bierze z placu C`);
});

test('wieża SMART: mniej pustych przelotów i szybciej niż naiwna (wymiana, rój), wyważenie Atlasa', () => {
  for (const id of ['wymiana', 'roj']) {
    const s = run(id, 'smart');
    const n = run(id, 'naive');
    const share = (r) => r.planner.stats.emptyDist / (r.planner.stats.emptyDist + r.planner.stats.loadedDist);
    assert.ok(share(s) < share(n) - 0.05, `${id}: puste przeloty ${(share(s) * 100).toFixed(1)}% vs ${(share(n) * 100).toFixed(1)}%`);
    assert.ok(s.planner.stats.endTime <= n.planner.stats.endTime, `${id}: czas ${s.planner.stats.endTime.toFixed(0)} vs ${n.planner.stats.endTime.toFixed(0)} s`);
  }
  const a = run('atlas', 'smart');
  assert.ok(a.planner.stats.maxTrim < 0.1, `wyważenie Atlasa ${a.planner.stats.maxTrim.toFixed(3)}`);
  // Przeładunek statek → statek wprost, bez placu.
  const p = run('przeladunek', 'smart');
  assert.ok(p.planner.stats.direct > 0);
});

test('kurs chwytu: kurs kolumny albo +π — bliższy kursowi drona (obrót ≤ 90°)', () => {
  for (const [col, ref] of [[0, 0.3], [0, 2.5], [Math.PI / 2, -1.2], [-3, 3]]) {
    const r = swarmClosestYaw(col, ref);
    let d = r.yaw - ref;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    assert.ok(Math.abs(d) <= Math.PI / 2 + 1e-9, `kolumna ${col}, dron ${ref}: obrót ${d}`);
    let e = r.yaw - col - (r.flip ? Math.PI : 0);
    e -= Math.PI * 2 * Math.round(e / (Math.PI * 2));
    assert.ok(Math.abs(e) < 1e-9);
  }
});

test('zadanie dla GPU: pasmo podejścia nad dwoma poziomami wejścia, wejścia w szachownicę, liczniki kolumn', () => {
  const sc = buildSwarmScenario('wymiana', { count: 96 });
  for (const g of sc.port.grids) {
    assert.ok(Math.abs(g.ceilZ - (g.entry0 + SWARM_ENTRY_LEVELS * g.dEntry)) < 1e-6, `${g.kind}/${g.owner}: pasmo nad wejściami`);
    for (const ci of g.columns) assert.ok(sc.port.columns[ci].entryZ < g.ceilZ - g.dEntry * 0.5);
  }
  // Sąsiednie kolumny siatki mają różne poziomy wejścia (zejścia nie dzielą wysokości).
  assert.notEqual(swarmEntryLevel(0, 0), swarmEntryLevel(1, 0));
  assert.notEqual(swarmEntryLevel(0, 0), swarmEntryLevel(0, 1));
  const counts = swarmColumnCounts(sc.port);
  const planner = createSwarmPlanner(sc.port, sc.drones, { mode: 'smart' });
  const recs = [];
  planner.update(0, new Float32Array(sc.drones.length * 4), (d, s, rec) => recs.push(Float32Array.from(rec)));
  assert.ok(recs.length > 0);
  for (const r of recs) {
    const ceilPick = r[SWARM_TASK.CEIL * 4];
    const entryPick = r[SWARM_TASK.ALT * 4];
    assert.ok(ceilPick > entryPick, 'pasmo podejścia nad wejściem kolumny źródła');
    assert.equal(r[SWARM_TASK.IDS * 4 + 1] >= 0, true, 'numer zadania');
    // Pierwsze zadanie na kolumnie: licznik przed chwytem = kontenery w kolumnie na starcie.
    const pick = r[SWARM_TASK.IDS * 4 + 2] | 0;
    assert.equal(r[SWARM_TASK.LEVELS * 4], counts[pick]);
    const n = r[SWARM_TASK.IDS * 4];
    let listed = 0;
    for (let k = 0; k < 8; k++) if (r[SWARM_TASK.UNITS_A * 4 + k] >= 0) listed++;
    assert.equal(listed, n, 'kontenery chwytu w rekordzie');
  }
});
