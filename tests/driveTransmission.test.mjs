import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIVE_RPM_MAX,
  DRIVE_MODES,
  TRAVEL_SHIFT_RPM,
  applyDriveSpeedGovernor,
  createDriveTransmission,
  setDriveMode,
  setDriveHullClass,
  shiftDriveUp,
  updateDriveTransmission
} from '../src/game/flight/driveTransmission.js';

function settleTravelRpm(drive, targetRpm, frames = 180) {
  const targetRatio = targetRpm / DRIVE_RPM_MAX;
  const speed = drive.speedLimit * Math.max(0, targetRatio - 0.22);
  for (let i = 0; i < frames; i++) updateDriveTransmission(drive, speed, 1, 1 / 60);
  return speed;
}

test('drive modes expose the requested speed envelopes', () => {
  assert.equal(DRIVE_MODES.maneuver.gears.at(-1).maxSpeed, 400);
  assert.equal(DRIVE_MODES.combat.gears.at(-1).maxSpeed, 3000);
  assert.equal(DRIVE_MODES.travel.gears.at(-1).maxSpeed, 20000);
  assert.ok(DRIVE_MODES.travel.gears.length > 5);
});

test('hull classes scale speed and handling from nimble frigates to heavy capitals', () => {
  const hulls = ['frigate', 'destroyer', 'battleship', 'carrier', 'atlas'];
  const combat = hulls.map(hullClass => createDriveTransmission({ mode: 'combat', hullClass }));
  const maneuver = hulls.map(hullClass => createDriveTransmission({ mode: 'maneuver', hullClass }));

  assert.deepEqual(combat.map(drive => drive.modeMaxSpeed), [4800, 4200, 3600, 3000, 3000]);
  assert.deepEqual(maneuver.map(drive => drive.modeMaxSpeed), [900, 700, 520, 400, 400]);
  assert.ok(combat[0].mainForceScale > combat[1].mainForceScale);
  assert.ok(combat[1].mainForceScale > combat[2].mainForceScale);
  assert.ok(combat[2].mainForceScale > combat[3].mainForceScale);
  assert.ok(combat[3].mainForceScale > combat[4].mainForceScale);

  setDriveHullClass(combat[0], 'atlas');
  assert.equal(combat[0].hullClass, 'supercapital');
  assert.equal(combat[0].modeMaxSpeed, 3000);
});

test('well-timed manual upshift gives a temporary boost', () => {
  const drive = createDriveTransmission({ mode: 'travel' });
  const shiftSpeed = settleTravelRpm(drive, TRAVEL_SHIFT_RPM.ideal);
  const result = shiftDriveUp(drive, shiftSpeed);
  assert.equal(result, 'perfect');
  assert.equal(drive.gear, 2);
  assert.ok(drive.shiftBoostMultiplier > 1.5);
  for (let i = 0; i < 60; i++) updateDriveTransmission(drive, 2300, 1, 1 / 60);
  assert.equal(drive.shiftBoostMultiplier, 1);
});

test('engine rpm spools ahead of speed and unlocks stronger thrust near maximum rpm', () => {
  const drive = createDriveTransmission({ mode: 'combat', hullClass: 'battleship' });
  const coldForce = drive.mainForceScale;

  for (let i = 0; i < 45; i++) updateDriveTransmission(drive, 0, 1, 1 / 60);
  assert.ok(drive.rpm > 0.3);
  assert.ok(drive.rpm > drive.speedRpm);
  assert.ok(drive.mainForceScale > coldForce);

  for (let i = 0; i < 60; i++) updateDriveTransmission(drive, drive.speedLimit * 0.78, 1, 1 / 60);
  assert.ok(drive.rpm > 0.96);
  assert.ok(drive.spoolForceMultiplier > 1.1);
});

test('travel upshift lowers rpm smoothly instead of snapping the gauge', () => {
  const drive = createDriveTransmission({ mode: 'travel' });
  const shiftSpeed = settleTravelRpm(drive, TRAVEL_SHIFT_RPM.ideal);
  const rpmBeforeShift = drive.rpm;

  assert.equal(shiftDriveUp(drive, shiftSpeed), 'perfect');
  assert.equal(drive.rpm, rpmBeforeShift);
  assert.ok(drive.rpmTarget < drive.rpm);

  updateDriveTransmission(drive, shiftSpeed, 1, 1 / 60);
  assert.ok(drive.rpm < rpmBeforeShift);
  assert.ok(drive.rpm > drive.rpmTarget);
});

test('travel shift light is green near 6500 rpm and red above 6700 before shifting', () => {
  const ideal = createDriveTransmission({ mode: 'travel' });
  const idealSpeed = settleTravelRpm(ideal, TRAVEL_SHIFT_RPM.ideal);
  assert.equal(ideal.shiftSerial, 0);
  assert.ok(ideal.shiftCueIntensity > 0.98);
  assert.ok(ideal.shiftCueDanger < 0.05);
  assert.equal(shiftDriveUp(ideal, idealSpeed), 'perfect');

  for (let i = 0; i < 60; i++) updateDriveTransmission(ideal, idealSpeed, 1, 1 / 60);
  assert.ok(ideal.shiftCueIntensity < 0.05);

  const late = createDriveTransmission({ mode: 'travel' });
  const lateSpeed = settleTravelRpm(late, 6900);
  assert.equal(late.shiftSerial, 0);
  assert.ok(late.shiftCueIntensity > 0.98);
  assert.ok(late.shiftCueDanger > 0.98);
  assert.equal(shiftDriveUp(late, lateSpeed), 'late');

  const early = createDriveTransmission({ mode: 'travel' });
  assert.equal(shiftDriveUp(early, 0), 'early');
  assert.equal(early.shiftCueIntensity, 0);
  assert.equal(early.shiftCueDanger, 0);
});

test('automatic travel mode shifts without manual input', () => {
  const drive = createDriveTransmission({ mode: 'travel', auto: true });
  for (let i = 0; i < 90 && drive.gear === 1; i++) {
    updateDriveTransmission(drive, drive.speedLimit * 0.6, 1, 1 / 60);
  }
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
  // Supercapital zachowuje pęd i potrzebuje kilku sekund na zejście do limitu.
  for (let i = 0; i < 300; i++) applyDriveSpeedGovernor(drive, velocity, 1 / 60);
  assert.ok(Math.hypot(velocity.x, velocity.y) <= drive.speedLimit + 1e-6);
});
