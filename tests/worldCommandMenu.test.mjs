import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNormalCommandMenuItems,
  buildRtsCommandMenuItems,
  createApproachCommand,
  createOrbitCommand,
  createMoveCommand,
  computeFormationTargets,
  computeRtsCameraPanDelta,
  computeCommandMenuOpenAnimation,
  computeAttackAutopilotState,
  hitTestCommandMenu
} from '../src/game/worldCommandMenu.js';

test('normal target menu includes attack and keeps target entity commands live', () => {
  const target = { x: 100, y: 200, radius: 50 };
  assert.deepEqual(buildNormalCommandMenuItems({ targetEntity: target }).map((i) => i.action), [
    'attack', 'approach', 'orbit', 'jump', 'cruise', 'scan'
  ]);
  assert.equal(createApproachCommand({ point: { x: 0, y: 0 }, targetEntity: target }).targetEntity, target);
  assert.equal(createOrbitCommand({ point: { x: 0, y: 0 }, targetEntity: target }).targetEntity, target);
});

test('normal empty-space menu omits attack', () => {
  assert.deepEqual(buildNormalCommandMenuItems({ targetEntity: null }).map((i) => i.action), [
    'approach', 'orbit', 'jump', 'cruise', 'scan'
  ]);
});

test('rts menu labels move formation only for multi selection', () => {
  assert.equal(buildRtsCommandMenuItems({ selectedCount: 1 })[0].label, 'MOVE');
  assert.equal(buildRtsCommandMenuItems({ selectedCount: 3 })[0].label, 'MOVE FORMATION');
});

test('move command stores faceAngle', () => {
  const cmd = createMoveCommand({ point: { x: 10, y: 20 }, faceAngle: Math.PI / 3 });
  assert.equal(cmd.type, 'move');
  assert.equal(cmd.target.x, 10);
  assert.equal(cmd.faceAngle, Math.PI / 3);
});

test('formation targets are stable and centered', () => {
  const units = [{ id: 'b', radius: 20 }, { id: 'a', radius: 20 }];
  const targets = computeFormationTargets(units, { x: 100, y: 50 }, 0);
  assert.equal(targets.size, 2);
  assert.ok(Math.abs(targets.get(units[0]).y - 50) > 1);
  assert.ok(Math.abs(targets.get(units[1]).y - 50) > 1);
});

test('menu hit testing returns the expected action', () => {
  const menu = { x: 20, y: 40, width: 180, itemHeight: 26, items: [{ action: 'move' }, { action: 'hold' }] };
  assert.equal(hitTestCommandMenu(menu, 30, 45)?.action, 'move');
  assert.equal(hitTestCommandMenu(menu, 30, 72)?.action, 'hold');
  assert.equal(hitTestCommandMenu(menu, 5, 72), null);
});

test('RTS camera pan uses WASD and normalizes diagonal movement', () => {
  const delta = computeRtsCameraPanDelta({ w: true, d: true }, { speed: 1200, zoom: 2, dt: 0.5 });
  const expected = (1200 / 2) * 0.5 / Math.SQRT2;
  assert.ok(Math.abs(delta.x - expected) < 1e-9);
  assert.ok(Math.abs(delta.y + expected) < 1e-9);
});

test('RTS camera pan still accepts arrow keys', () => {
  const delta = computeRtsCameraPanDelta({ arrowleft: true, arrowdown: true }, { speed: 900, zoom: 1.5, dt: 1 });
  const expected = (900 / 1.5) / Math.SQRT2;
  assert.ok(Math.abs(delta.x + expected) < 1e-9);
  assert.ok(Math.abs(delta.y - expected) < 1e-9);
});

test('command menu open animation clamps to a finished radar-style reveal', () => {
  assert.deepEqual(computeCommandMenuOpenAnimation({ elapsed: -1 }), { alpha: 0, scaleY: 0.02, reveal: 0 });
  const finished = computeCommandMenuOpenAnimation({ elapsed: 1, duration: 0.24 });
  assert.equal(finished.alpha, 1);
  assert.equal(finished.scaleY, 1);
  assert.equal(finished.reveal, 1);
});

test('attack autopilot approaches before weapon range and orbits inside range', () => {
  const far = computeAttackAutopilotState({
    distance: 2600,
    weaponRanges: [1800, 900],
    targetRadius: 120
  });
  assert.equal(far.commandType, 'approach');
  assert.equal(far.inWeaponRange, false);
  assert.ok(far.approachArrival < 1800);

  const close = computeAttackAutopilotState({
    distance: 1500,
    weaponRanges: [1800, 900],
    targetRadius: 120
  });
  assert.equal(close.commandType, 'orbit');
  assert.equal(close.inWeaponRange, true);
  assert.ok(close.orbitRadius <= 1800);
});

test('attack autopilot reports no range when the ship has no usable weapons', () => {
  const state = computeAttackAutopilotState({ distance: 500, weaponRanges: [0, NaN] });
  assert.equal(state.hasWeaponRange, false);
  assert.equal(state.commandType, null);
});
