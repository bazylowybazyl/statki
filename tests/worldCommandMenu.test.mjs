import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNormalCommandMenuItems,
  buildRtsCommandMenuItems,
  createApproachCommand,
  createOrbitCommand,
  createMoveCommand,
  computeFormationTargets,
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
