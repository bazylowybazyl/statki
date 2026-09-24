// Solver sprężyn GPU liczy w CZASIE GRY, nie w klatkach renderu. Kernel całkuje
// `def += vel` na iterację bez dt, a dispatch szedł raz na klatkę: przy 144 FPS
// 2,4× więcej kroków na sekundę gry niż przy 60, więc te same trafienia wgniatały
// kadłub szybciej (i heksy szybciej wypadały z okien sond trafień).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorSystem, DESTRUCTOR_CONFIG } from '../src/game/destructor.js';
import { DestructorGpuSoftBody as gpu } from '../src/game/destructorGpuSoftBody.js';

function makeEntity(shardCount) {
  const shards = [];
  for (let i = 0; i < shardCount; i++) {
    shards.push({
      active: true, isDebris: false,
      deformation: { x: 0, y: 0 }, targetDeformation: { x: 0, y: 0 },
      __velX: 0, __velY: 0, __collVelX: 0, __collVelY: 0, __meshIndex: i, hp: 80, maxHp: 80
    });
  }
  return {
    hexGrid: { shards, isSleeping: false, sleepFrames: 0, wakeHoldFrames: 0, visualDirtyAll: false, visualDirtyStart: -1, visualDirtyEnd: -1 },
    // zawsze „gorące”: mierzymy sam zegar dispatchera
    _gpuForceAwakeFrames: 1e9
  };
}

// Bez WebGPU: podmieniamy oba dotknięcia urządzenia, jak w gpuSoftBodyFairness.
function runFrames(frameDts, config = {}) {
  const minShards = Math.max(16, Number(DESTRUCTOR_CONFIG.gpuSoftBodyMinShards) || 64);
  const entity = makeEntity(minShards);
  const saved = {
    ready: gpu.ready, active: gpu.active, dispatch: gpu._dispatch, ensureState: gpu._ensureEntityState,
    cursor: gpu._dispatchCursor, tickId: gpu._tickId, acc: gpu._solverAcc
  };
  const steps = [];
  try {
    gpu.ready = true;
    gpu.active = true;
    gpu._dispatchCursor = 0;
    gpu._tickId = 0;
    gpu._solverAcc = 0;
    gpu._resultsQueue.length = 0;
    gpu._ensureEntityState = (e) => (e.__fakeState ||= { isComputing: false, dispatchCooldown: 0, idleFrames: 0 });
    gpu._dispatch = (_e, _state, k, damping) => { steps.push({ k, damping }); };
    const cfg = { ...DESTRUCTOR_CONFIG, gpuSoftBodyDispatchPerTick: 1, ...config };
    for (const dt of frameDts) gpu.tick([entity], cfg, dt);
  } finally {
    gpu.ready = saved.ready;
    gpu.active = saved.active;
    gpu._dispatch = saved.dispatch;
    gpu._ensureEntityState = saved.ensureState;
    gpu._dispatchCursor = saved.cursor;
    gpu._tickId = saved.tickId;
    gpu._solverAcc = saved.acc;
    gpu._resultsQueue.length = 0;
  }
  return steps;
}

const frames = (fps, seconds = 1) => new Array(Math.round(fps * seconds)).fill(1 / fps);
const kAt = (step) => 1 - Math.exp(-(Number(DESTRUCTOR_CONFIG.softBodyTension) || 0.15) * step * 120);

test('solver steps follow game time instead of the render frame rate', () => {
  assert.equal(DESTRUCTOR_CONFIG.gpuSoftBodyHz, 60);
  for (const fps of [60, 75, 100, 144, 240]) {
    const n = runFrames(frames(fps, 2)).length;
    assert.ok(Math.abs(n - 120) <= 1, `${fps} FPS: ${n} solver steps in 2 s of game time`);
  }
  // Wolniej niż zegar solvera: krok na klatkę, jak dotąd.
  assert.equal(runFrames(frames(30, 2)).length, 60);
});

test('every solver step integrates the same game time at any frame rate', () => {
  const at60 = runFrames(frames(60));
  const at144 = runFrames(frames(144));
  for (const s of [...at60, ...at144]) assert.ok(Math.abs(s.k - kAt(1 / 60)) < 1e-12);
  assert.ok(Math.abs(at60[0].damping - at144[0].damping) < 1e-12);
  // ≤ 60 FPS: krok = klatka, czyli dokładnie dawny dispatcher.
  for (const s of runFrames(frames(30))) assert.ok(Math.abs(s.k - kAt(1 / 30)) < 1e-12);
});

test('jittery ~60 FPS frames never skip a solver step', () => {
  const dts = [];
  for (let i = 0; i < 120; i++) dts.push(i % 2 ? 0.0171 : 0.0162);
  assert.equal(runFrames(dts).length, 120);
});

test('gpuSoftBodyHz = 0 restores the per-frame dispatch for comparisons', () => {
  assert.equal(runFrames(frames(144), { gpuSoftBodyHz: 0 }).length, 144);
});

test('the force-awake window lasts the same game time at any frame rate', () => {
  for (const fps of [60, 144]) {
    const e = makeEntity(4);
    e._gpuForceAwakeFrames = 30; // „30 klatek” = 0,5 s przy 60 FPS
    let n = 0;
    while (e._gpuForceAwakeFrames > 0 && n < 1000) {
      DestructorSystem.updateVisualDeformation([e], 1 / fps);
      n++;
    }
    assert.ok(Math.abs(n / fps - 0.5) <= 1 / fps + 1e-9, `${fps} FPS: ${n} frames = ${(n / fps).toFixed(3)} s`);
  }
});
