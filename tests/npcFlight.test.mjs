import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyNpcFlightVector,
  executeNpcFlightCommand,
  syncNpcFlightState
} from '../src/game/flight/npcFlight.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';

function editorDegToForward(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

function makeAtlasThrusterNpc(overrides = {}) {
  const mainThrusters = (ATLAS_EDITOR_DEFAULTS.engines?.main || []).map(engine => ({
    offset: { x: engine.x, y: engine.y },
    forward: editorDegToForward(engine.deg),
    baseDeg: engine.deg,
    nozzleDeg: engine.deg,
    mount: engine.mount,
    gimbalMinDeg: engine.gimbalMinDeg,
    gimbalMaxDeg: engine.gimbalMaxDeg
  }));
  const torqueThrusters = (ATLAS_EDITOR_DEFAULTS.engines?.side || []).map(engine => ({
    offset: { x: engine.x, y: engine.y },
    forward: editorDegToForward(engine.deg),
    baseDeg: engine.deg,
    nozzleDeg: engine.deg,
    mount: engine.mount,
    gimbalMinDeg: engine.gimbalMinDeg,
    gimbalMaxDeg: engine.gimbalMaxDeg,
    side: String(engine.mount || '').endsWith('_left') ? 'left' : 'right'
  }));
  const npc = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    angVel: 0,
    w: 3000,
    h: 1875,
    mass: 200000,
    radius: 500,
    visual: { mainThrusters, torqueThrusters },
    ...overrides
  };
  npc.inertia = (1 / 12) * npc.mass * ((npc.w * npc.w) + (npc.h * npc.h));
  return npc;
}

test('npc hardpoint layout exposes main thrusters for physical flight', () => {
  const runtime = createNpcHardpointRuntime({
    defaultShips: SHIP_EDITOR_DEFAULTS.ships
  });
  runtime.refreshCache(true);
  const npc = { type: 'destroyer', visual: {}, engines: {} };

  assert.equal(runtime.applyLayoutToNpc(npc), true);
  assert.ok(Array.isArray(npc.visual.mainThrusters));
  assert.ok(npc.visual.mainThrusters.length > 0);
  assert.ok(Array.isArray(npc.visual.torqueThrusters));
  assert.ok(npc.visual.torqueThrusters.length > 0);
});

test('npc editor layout exposes bridge markers for critical integrity checks', () => {
  const runtime = createNpcHardpointRuntime({
    defaultShips: {
      destroyer: {
        hardpoints: [],
        cores: [{ id: 'core_a', x: 0, y: 0 }],
        bridges: [{ id: 'bridge_a', x: 40, y: -12 }],
        engines: { main: [], side: [] }
      }
    }
  });
  runtime.refreshCache(true);
  const npc = { type: 'destroyer', visual: {}, engines: {} };

  assert.equal(runtime.applyLayoutToNpc(npc), true);
  assert.deepEqual(npc.editorCores, [{ id: 'core_a', x: 0, y: 0, type: 'core' }]);
  assert.deepEqual(npc.editorBridges, [{ id: 'bridge_a', x: 40, y: -12, type: 'bridge' }]);
});

test('npc approach command uses player autopilot and physical thrusters', () => {
  const npc = makeAtlasThrusterNpc();

  const result = executeNpcFlightCommand(npc, {
    type: 'approach',
    target: { x: 6000, y: 0 },
    arrival: 180
  }, 1 / 60);

  assert.equal(result.handled, true);
  assert.equal(result.usedThrusters, true);
  assert.ok(npc.thrusterInput.main > 0.5);
  assert.ok(npc.vx > 0);
  assert.ok(npc.x > 0);
  assert.equal(npc.vel.x, npc.vx);
  assert.equal(npc.pos.x, npc.x);
});

test('npc vector autopilot applies the same thruster force path as player input', () => {
  const npc = makeAtlasThrusterNpc();
  syncNpcFlightState(npc);

  const result = applyNpcFlightVector(npc, {
    thrustNorm: 1,
    strafeNorm: 0,
    desiredAngle: 0
  }, 1 / 60);

  assert.equal(result.usedThrusters, true);
  assert.ok(npc.thrusterInput.main > 0.5);
  assert.ok(npc.vx > 0);
  assert.ok(npc.x > 0);
});

test('npc ram command keeps physical thrust and fires the forward impulse', () => {
  const npc = makeAtlasThrusterNpc({
    x: 5400,
    pos: { x: 5400, y: 0 },
    vx: 1200,
    vel: { x: 1200, y: 0 },
    angle: 0
  });
  const cmd = {
    type: 'ram',
    target: { x: 6000, y: 0 },
    targetEntity: { x: 6000, y: 0, radius: 260 },
    arrival: 620,
    ramImpulse: 3200
  };

  const result = executeNpcFlightCommand(npc, cmd, 1 / 60);

  assert.equal(result.handled, true);
  assert.equal(result.usedThrusters, true);
  assert.equal(cmd.ramImpulseDone, true);
  assert.ok(npc.thrusterInput.main > 0.6);
  assert.ok(npc.vx > 3000, 'ram impulse should add a large forward velocity burst');
});
