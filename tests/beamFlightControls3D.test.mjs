import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3, PerspectiveCamera } from 'three';
import { applyFlightControls, readFlightInput } from '../src/game/beamFlightControls3D.js';
import { BeamFlightCamera3D } from '../src/3d/beamFlightCamera3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { makeBoxTriangles, voxelizeTriangles } from '../src/game/voxelBody3D.js';

const idle = () => readFlightInput({}, 0, 0, {});
const body = () => ({ pos: new Vector3(), vel: new Vector3(), angVel: new Vector3(), quat: new Quaternion() });
function run(b, input, seconds, hz = 120, assist = true) {
  D.init(createBeamConfig(1));
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    applyFlightControls(b, input, 1 / hz, 70, assist);
    D.integrate(1 / hz, [b]);
  }
}
const nose = b => new Vector3(1, 0, 0).applyQuaternion(b.quat);

test('W follows a rotated ship nose; local strafing and lift also follow its attitude', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 2.1);
  for (const [key, axis] of [['KeyW', new Vector3(1, 0, 0)], ['KeyC', new Vector3(0, 0, 1)], ['Space', new Vector3(0, 1, 0)]]) {
    const b = body(); b.quat.copy(q);
    run(b, readFlightInput({ [key]: true }, 0, 0, {}), 0.2);
    assert.ok(b.vel.length() > 10);
    assert.ok(b.vel.clone().normalize().distanceTo(axis.applyQuaternion(q)) < 1e-10);
  }
});

test('A/D yaw, arrows pitch and Q/E roll with the expected signs, then rotation settles', () => {
  for (const [key, axis, sign] of [['KeyA', 'y', 1], ['KeyD', 'y', -1], ['ArrowUp', 'z', 1], ['ArrowDown', 'z', -1], ['KeyQ', 'x', -1], ['KeyE', 'x', 1]]) {
    const b = body();
    run(b, readFlightInput({ [key]: true }, 0, 0, {}), 0.5);
    assert.ok(b.quat[axis] * sign > 0.08, key);
    run(b, idle(), 0.6);
    assert.ok(b.angVel.length() < 1e-8, `${key} should stop rotating after release`);
  }
});

test('a banked ship pitches and yaws around its own axes, including through vertical flight', () => {
  const b = body();
  b.quat.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  run(b, readFlightInput({ ArrowUp: true }, 0, 0, {}), 1);
  assert.ok(nose(b).z > 0.5);
  assert.ok(Math.abs(nose(b).y) < 1e-8);
  run(b, readFlightInput({ ArrowUp: true, KeyW: true, KeyE: true }, 0, 0, {}), 12);
  assert.ok(Number.isFinite(b.pos.length()));
  assert.ok(Math.abs(b.quat.length() - 1) < 1e-10);
});

test('X brakes the whole velocity vector without reversing; S brakes into reverse', () => {
  const b = body(); b.vel.set(100, 50, -30);
  run(b, { ...idle(), brake: true }, 0.2);
  assert.ok(b.vel.x > 0 && b.vel.y > 0 && b.vel.z < 0);
  run(b, { ...idle(), brake: true }, 2);
  assert.equal(b.vel.length(), 0);
  b.vel.x = 30;
  run(b, readFlightInput({ KeyS: true }, 0, 0, {}), 2);
  assert.ok(b.vel.x < -40 && b.vel.x >= -60);
});

test('boost increases forward speed; releasing W coasts and drift assist can be disabled', () => {
  const normal = body(), boosted = body();
  run(normal, readFlightInput({ KeyW: true }, 0, 0, {}), 5);
  run(boosted, readFlightInput({ KeyW: true, ShiftLeft: true }, 0, 0, {}), 5);
  assert.ok(boosted.vel.length() > normal.vel.length() * 1.8);
  run(normal, idle(), 0.2);
  assert.ok(normal.vel.x > 100, 'release must not act as a full brake');
  const assisted = body(), drifting = body();
  assisted.vel.z = drifting.vel.z = 50;
  run(assisted, idle(), 1);
  run(drifting, idle(), 1, 120, false);
  assert.ok(assisted.vel.z < 5 && drifting.vel.z > 40);
});

test('held input produces consistent flight at 60 and 120 physics steps per second', () => {
  const a = body(), b = body();
  const input = readFlightInput({ KeyW: true, KeyA: true, ArrowUp: true }, 0, 0, {});
  run(a, input, 2, 60); run(b, input, 2, 120);
  assert.ok(a.pos.distanceTo(b.pos) < 2);
  assert.ok(nose(a).distanceTo(nose(b)) < 0.02);
});

test('controller does not erase collision impulses in one tick or move static/dead bodies', () => {
  const b = body(); b.vel.set(-400, 100, -100); b.angVel.set(4, 2, -3);
  const beforeV = b.vel.clone(), beforeW = b.angVel.clone();
  applyFlightControls(b, idle(), 1 / 120);
  assert.ok(b.vel.distanceTo(beforeV) < 1);
  assert.ok(b.angVel.distanceTo(beforeW) < 0.05);
  for (const flag of ['dead', 'static']) {
    const disabled = body(); disabled[flag] = true;
    applyFlightControls(disabled, readFlightInput({ KeyW: true, KeyA: true }, 0, 0, {}), 1);
    assert.equal(disabled.vel.length() + disabled.angVel.length(), 0);
  }
});

test('rigid flight leaves a sleeping deformation solver asleep while updating the body pose', () => {
  D.init(createBeamConfig(1));
  const b = D.createBody(buildBeamStructure(voxelizeTriangles(makeBoxTriangles(8, 3, 3), null, { cellSize: 1, shellLayers: 0 })));
  b.isSleeping = true; b.wakeHold = 0;
  const input = readFlightInput({ KeyW: true, KeyA: true }, 0, 0, {});
  const positions = b.nodes.map(n => [n.x, n.y, n.z]);
  for (let i = 0; i < 120; i++) {
    applyFlightControls(b, input, 1 / 120);
    D.integrate(1 / 120, [b]); D.update(1 / 120, [b]);
  }
  assert.ok(Math.hypot(b.pos.x, b.pos.y, b.pos.z) > 20);
  assert.equal(b.isSleeping, true);
  assert.deepEqual(b.nodes.map(n => [n.x, n.y, n.z]), positions);
});

test('mouse stick and keyboard combine without exceeding turn limits or sticking on release', () => {
  const input = {};
  assert.equal(readFlightInput({ KeyA: true, KeyW: true, KeyS: true }, 0.7, -0.5, input), input);
  assert.equal(input.yaw, 1); assert.equal(input.throttle, 0); assert.equal(input.pitch, -0.5);
  readFlightInput({}, 0, 0, input);
  assert.deepEqual(input, idle());
});

test('chase camera follows translated and rolled ships, keeps framing after damage and clamps zoom', () => {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 12000);
  const chase = new BeamFlightCamera3D(camera), b = body();
  b.quat.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  chase.update(b, 25, 0);
  const oldPosition = camera.position.clone();
  assert.ok(camera.up.distanceTo(new Vector3(0, 0, 1)) < 1e-10);
  assert.ok(new Vector3().subVectors(camera.position, b.pos).dot(nose(b)) < 0);
  b.pos.set(500, -80, 200); b.radius = 2;
  chase.update(b, 25, 1 / 60);
  assert.ok(camera.position.distanceTo(oldPosition.add(b.pos)) < 1e-10);
  camera.updateMatrixWorld();
  const projected = b.pos.clone().project(camera);
  assert.ok(Math.abs(projected.x) < 0.01 && Math.abs(projected.y) < 0.5);
  chase.dolly(-100000); assert.equal(chase.zoom, 0.55);
  chase.dolly(100000); assert.equal(chase.zoom, 3);
});
