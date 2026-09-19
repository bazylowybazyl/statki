import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DestructorSystem, DESTRUCTOR_CONFIG } from '../src/game/destructor.js';
import { DestructorGpuSoftBody } from '../src/game/destructorGpuSoftBody.js';

const gpuJs = readFileSync(new URL('../src/game/destructorGpuSoftBody.js', import.meta.url), 'utf8');

// `_gpuForceAwakeFrames` ustawia collideEntities (16) i distributeStructuralDamage
// (30), a wygaszał go WYŁĄCZNIE DestructorGpuSoftBody._isEntityHot — kod, który nie
// startuje bez WebGPU, zaczynał pętlę zawsze od indeksu 0 i przerywał po 2–3
// dispatchach. Wszystko poza jego zasięgiem zostawało „forced awake" na zawsze:
// siatka nigdy nie zasypiała, a w dispatcherze forcedAwake omija cooldown i
// backpressure, więc te same pierwsze encje listy dożywotnio brały cały budżet GPU.

function makeShard() {
  return {
    active: true,
    isDebris: false,
    deformation: { x: 0, y: 0 },
    targetDeformation: { x: 0, y: 0 },
    __velX: 0,
    __velY: 0,
    __collVelX: 0,
    __collVelY: 0,
    __meshIndex: 0,
    hp: 80,
    maxHp: 80
  };
}

function makeEntity(shardCount, extra = {}) {
  const shards = [];
  for (let i = 0; i < shardCount; i++) {
    const s = makeShard();
    s.__meshIndex = i;
    shards.push(s);
  }
  return {
    hexGrid: {
      shards,
      isSleeping: false,
      sleepFrames: 0,
      wakeHoldFrames: 0,
      visualDirtyAll: false,
      visualDirtyStart: -1,
      visualDirtyEnd: -1
    },
    ...extra
  };
}

test('destruktor wygasza _gpuForceAwakeFrames sam, bez udziału solvera GPU', () => {
  const e = makeEntity(4);
  e._gpuForceAwakeFrames = 3;

  for (let i = 0; i < 3; i++) DestructorSystem.updateVisualDeformation([e], 1 / 60);
  assert.equal(e._gpuForceAwakeFrames, 0, 'flaga musi zejść do zera bez WebGPU');

  // I nie może zejść poniżej zera przy dalszych klatkach.
  DestructorSystem.updateVisualDeformation([e], 1 / 60);
  assert.equal(e._gpuForceAwakeFrames, 0);
});

test('wygaszanie obejmuje też encje kruche, pomijane przez dispatcher', () => {
  // collideEntities ustawia flagę na OBU ciałach, także na asteroidzie, a
  // dispatcher wychodzi na `destructionMaterial === 'brittle'`.
  const e = makeEntity(4, { destructionMaterial: 'brittle' });
  e._gpuForceAwakeFrames = 2;

  DestructorSystem.updateVisualDeformation([e], 1 / 60);
  assert.equal(e._gpuForceAwakeFrames, 1, 'dekrement musi stać PRZED gałęzią brittle');
  DestructorSystem.updateVisualDeformation([e], 1 / 60);
  assert.equal(e._gpuForceAwakeFrames, 0);
});

test('_isEntityHot już nie modyfikuje flagi', () => {
  assert.doesNotMatch(
    gpuJs,
    /_gpuForceAwakeFrames--/,
    'solver GPU nie może być właścicielem wygaszania'
  );
  const e = makeEntity(4);
  e._gpuForceAwakeFrames = 5;
  assert.equal(DestructorGpuSoftBody._isEntityHot(e, 16, 0.06), true);
  assert.equal(e._gpuForceAwakeFrames, 5, '_isEntityHot to czysty odczyt');
});

test('budżet dispatchu krąży po liście zamiast wracać do indeksu 0', () => {
  const minShards = Math.max(16, Number(DESTRUCTOR_CONFIG.gpuSoftBodyMinShards) || 64);
  const entities = [];
  for (let i = 0; i < 5; i++) {
    const e = makeEntity(minShards);
    e.__name = i;
    e._gpuForceAwakeFrames = 999; // zawsze „gorące", żeby mierzyć sam wybór encji
    entities.push(e);
  }

  const gpu = DestructorGpuSoftBody;
  const saved = {
    ready: gpu.ready,
    active: gpu.active,
    dispatch: gpu._dispatch,
    ensureState: gpu._ensureEntityState,
    cursor: gpu._dispatchCursor,
    tickId: gpu._tickId
  };

  const served = [];
  try {
    gpu.ready = true;
    gpu.active = true;
    gpu._dispatchCursor = 0;
    gpu._tickId = 0;
    gpu._resultsQueue.length = 0;
    // Bez WebGPU nie ma buforów — podmieniamy oba dotknięcia urządzenia.
    gpu._ensureEntityState = (entity) => (entity.__fakeState ||= { isComputing: false, dispatchCooldown: 0, idleFrames: 0 });
    gpu._dispatch = (entity) => { served.push(entity.__name); };

    for (let frame = 0; frame < 3; frame++) {
      gpu.tick(entities, { ...DESTRUCTOR_CONFIG, gpuSoftBodyDispatchPerTick: 2 }, 1 / 60);
    }
  } finally {
    gpu.ready = saved.ready;
    gpu.active = saved.active;
    gpu._dispatch = saved.dispatch;
    gpu._ensureEntityState = saved.ensureState;
    gpu._dispatchCursor = saved.cursor;
    gpu._tickId = saved.tickId;
    gpu._resultsQueue.length = 0;
  }

  assert.equal(served.length, 6, '2 dispatche na klatkę × 3 klatki');
  // Stara pętla dała [0,1, 0,1, 0,1] — encje 2..4 nie policzyłyby się nigdy.
  assert.deepEqual(served, [0, 1, 2, 3, 4, 0], 'kursor musi obejść listę w kółko');
  assert.equal(new Set(served).size, 5, 'każda encja obsłużona w ≤ ceil(N/2) klatkach');
});
