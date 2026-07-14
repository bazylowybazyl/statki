import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIVE_MODES,
  applyDriveSpeedGovernor,
  createDriveTransmission,
  setDriveMode,
  shiftDriveUp,
  updateDriveTransmission
} from '../src/game/flight/driveTransmission.js';

test('drive modes expose the requested speed envelopes', () => {
  assert.equal(DRIVE_MODES.maneuver.gears.at(-1).maxSpeed, 2000);
  assert.equal(DRIVE_MODES.combat.gears.at(-1).maxSpeed, 5000);
  assert.equal(DRIVE_MODES.travel.gears.at(-1).maxSpeed, 20000);
  assert.ok(DRIVE_MODES.travel.gears.length > 5);
});

test('well-timed manual upshift gives a temporary boost', () => {
  const drive = createDriveTransmission({ mode: 'travel' });
  const result = shiftDriveUp(drive, drive.speedLimit * 0.92);
  assert.equal(result, 'perfect');
  assert.equal(drive.gear, 2);
  assert.ok(drive.shiftBoostMultiplier > 1.5);
  for (let i = 0; i < 60; i++) updateDriveTransmission(drive, 2300, 1, 1 / 60);
  assert.equal(drive.shiftBoostMultiplier, 1);
});

test('automatic travel mode shifts without manual input', () => {
  const drive = createDriveTransmission({ mode: 'travel', auto: true });
  updateDriveTransmission(drive, drive.speedLimit * 0.91, 1, 0.016);
  assert.equal(drive.gear, 2);
  assert.equal(drive.lastShiftQuality, 'auto');
});

test('mode change selects a travel gear suitable for current speed', () => {
  const drive = createDriveTransmission({ mode: 'combat' });
  setDriveMode(drive, 'travel', 6200);
  assert.equal(drive.mode, 'travel');
  assert.ok(drive.speedLimit >= 6200);
});

test('speed governor approaches the active limit without a hard mode-change snap', () => {
  const drive = createDriveTransmission({ mode: 'maneuver' });
  const velocity = { x: 6000, y: 0 };
  const afterOneFrame = applyDriveSpeedGovernor(drive, velocity, 1 / 60);
  assert.ok(afterOneFrame < 6000);
  assert.ok(afterOneFrame > drive.speedLimit);
  for (let i = 0; i < 180; i++) applyDriveSpeedGovernor(drive, velocity, 1 / 60);
  assert.ok(Math.hypot(velocity.x, velocity.y) <= drive.speedLimit + 1e-6);
});
