import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { makeBoxTriangles, voxelizeTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { BeamWeapons3D, traceBeamShot, LASER, MISSILE, BLAST_DURATION } from '../src/game/beamWeapons3D.js';
import { createCrashBodies } from '../src/game/beamCrashScene3D.js';
import { createBeamFighterModel } from '../src/3d/beamFighter3D.js';
import { buildModelBeamStructure, disposeModelResources } from '../src/3d/beamModel3D.js';
import { BeamWeaponsVisual3D } from '../src/3d/beamWeaponsVisual3D.js';
import { BeamFlightCamera3D } from '../src/3d/beamFlightCamera3D.js';

function structure(x = 6, y = 6, z = 6) {
  return buildBeamStructure(voxelizeTriangles(makeBoxTriangles(x, y, z), null, { cellSize: 1, shellLayers: 0 }));
}
function setup() {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const owner = D.createBody(structure(4, 2, 2));
  return { owner, weapons: new BeamWeapons3D(D) };
}

test('swept collision finds the nearest rotated body, ignores the shooter and does not tunnel', () => {
  const { owner } = setup();
  const near = D.createBody(structure(1, 6, 6), { position: { x: 20 } });
  const far = D.createBody(structure(), { position: { x: 45 } });
  const hit = {};
  assert.equal(traceBeamShot(D, [owner, far, near], owner, 0, 0, 0, 1, 0, 0, 80, hit), true);
  assert.equal(hit.body, near); assert.ok(hit.t > 18 && hit.t < 22);
  assert.equal(traceBeamShot(D, [near], owner, 0, 12, 0, 1, 0, 0, 80, hit), false);
  near.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4); near._rotTick = -1;
  assert.equal(traceBeamShot(D, [near], owner, 0, 0, 0, 1, 0, 0, 80, hit), true);
  const n = near.nodes[hit.nodeIndex];
  const expected = new THREE.Vector3(n.x, n.y, n.z).applyQuaternion(near.quat).add(near.pos);
  assert.ok(expected.distanceTo(new THREE.Vector3(hit.cx, hit.cy, hit.cz)) < 1e-8);
});

test('one long projectile step impacts a thin wall once, with actual node and beam damage', () => {
  const { owner, weapons } = setup();
  const wall = D.createBody(structure(1, 8, 8), { position: { x: 30 } });
  const health = wall.nodes.reduce((sum, n) => sum + n.hp, 0);
  weapons.fire(LASER, owner, 900);
  weapons.update(0.2, [owner, wall]);
  assert.equal(weapons.stats.laserHits, 1);
  assert.ok(wall.nodes.reduce((sum, n) => sum + n.hp, 0) < health);
  assert.ok(wall.liveBeams < wall.beams.length);
  weapons.update(1, [owner, wall]);
  assert.equal(weapons.stats.laserHits, 1);
  assert.equal(weapons.stats.active, 0);
});

test('rockets have travel time and damage multiple sections inside the blast radius', () => {
  const { owner, weapons } = setup();
  const target = D.createBody(structure(), { position: { x: 30 } });
  const neighbor = D.createBody(structure(2, 2, 2), { position: { x: 27, y: 4 } });
  const remote = D.createBody(structure(), { position: { x: 80 } });
  const counts = [target, neighbor, remote].map(b => b.activeNodes);
  weapons.fire(MISSILE, owner, 450, 8);
  weapons.update(0.05, [owner, target, neighbor, remote]);
  assert.equal(weapons.stats.hits, 0); assert.equal(weapons.stats.active, 1);
  weapons.update(0.4, [owner, target, neighbor, remote]);
  assert.equal(weapons.stats.missileHits, 1);
  assert.equal(target.activeNodes, counts[0], 'detonation starts pressure instead of instantly replacing the damaged mesh');
  assert.ok(weapons.blasts.some(b => b.active));
  weapons.update(BLAST_DURATION, [owner, target, neighbor, remote]);
  assert.ok(target.activeNodes < counts[0]); assert.ok(neighbor.activeNodes < counts[1]);
  assert.equal(remote.activeNodes, counts[2]); assert.equal(owner.activeNodes, owner.nodes.length);
});

test('rocket pressure bends the lattice before tearing it across several physics steps', () => {
  const { owner, weapons } = setup();
  const target = D.createBody(structure(), { position: { x: 30 }, noSplit: true });
  const remote = D.createBody(structure(), { position: { x: 80 } });
  const bodies = [owner, target, remote];
  const initial = target.nodes.map(n => [n.x, n.y, n.z, n.hp]);
  const farHealth = remote.nodes.map(n => n.hp);
  weapons.fire(MISSILE, owner, 450, 4);
  weapons.update(0.4, bodies);
  assert.equal(weapons.stats.missileHits, 1);
  assert.deepEqual(target.nodes.map(n => [n.x, n.y, n.z, n.hp]), initial);

  const dt = 1 / 120;
  weapons.update(dt, bodies);
  assert.equal(target.activeNodes, initial.length, 'the first pressure step must not instantly tear the target');
  assert.deepEqual(target.nodes.map(n => [n.x, n.y, n.z]), initial.map(n => n.slice(0, 3)));
  assert.ok(target.nodes.some(n => Math.hypot(n.vx, n.vy, n.vz) > 0), 'pressure first changes velocity');
  D.integrate(dt, bodies); D.update(dt, bodies);
  assert.ok(target.nodes.some((n, i) => Math.hypot(n.x - initial[i][0], n.y - initial[i][1], n.z - initial[i][2]) > 0));

  const states = new Set();
  for (let i = 0; i < 40; i++) {
    D.integrate(dt, bodies); weapons.update(dt, bodies); D.update(dt, bodies);
    states.add(`${target.activeNodes}:${target.liveBeams}`);
  }
  assert.ok(states.size >= 3, `expected progressive tearing, got ${states.size} topology states`);
  assert.ok(target.activeNodes < initial.length);
  assert.deepEqual(remote.nodes.map(n => n.hp), farHealth, 'remote structure must remain intact');
  assert.ok(weapons.blasts.every(b => !b.active));
});

test('blast dose is independent of update frequency and pausing freezes the pressure', () => {
  const results = [];
  for (const hz of [30, 60, 120, 240]) {
    const { owner, weapons } = setup();
    const target = D.createBody(structure(), { position: { x: 30 } });
    weapons.fire(MISSILE, owner, 20, 4);
    weapons.update(0.4, [target]);
    assert.equal(weapons.stats.missileHits, 1);
    const before = target.nodes.map(n => n.hp);
    weapons.update(0, [target]);
    assert.deepEqual(target.nodes.map(n => n.hp), before);
    assert.equal(weapons.blasts.find(b => b.active).age, 0);
    // Hold geometry fixed to isolate total damage/impulse from solver motion.
    for (let i = 0; i < Math.ceil(BLAST_DURATION * hz); i++) weapons.update(1 / hz, [target]);
    assert.ok(weapons.blasts.every(b => !b.active));
    results.push(target.nodes.flatMap(n => [n.hp, n.vx, n.vy, n.vz]));
  }
  for (const result of results.slice(1)) for (let i = 0; i < result.length; i++) {
    assert.ok(Math.abs(result[i] - results[0][i]) < 1e-9, 'changing physics frequency must not multiply the blast dose');
  }
});

test('remaining pressure reaches new fragments and reset cancels an unfinished blast', () => {
  const { owner, weapons } = setup();
  const target = D.createBody(structure(), { position: { x: 30 } });
  weapons.fire(MISSILE, owner, 20, 8); weapons.update(0.4, [target]);
  weapons.update(0.04, [target]);
  const fragment = D.createBody(structure(2, 2, 2), { position: { x: 27, y: 3 } });
  const health = fragment.nodes.map(n => n.hp);
  weapons.update(0.04, [target, fragment]);
  assert.ok(fragment.nodes.some((n, i) => n.hp < health[i]));
  weapons.reset();
  const afterReset = [target, fragment].flatMap(b => b.nodes.map(n => n.hp));
  weapons.update(1, [target, fragment]);
  assert.deepEqual([target, fragment].flatMap(b => b.nodes.map(n => n.hp)), afterReset);
});

test('18 Hz laser and 1.5 Hz rockets respect cooldowns, pool limits, reset and dead owners', () => {
  for (const hz of [60, 120]) {
    const { owner, weapons } = setup();
    for (let i = 0; i < hz * 10; i++) { weapons.triggers(1 / hz, owner, true, true); weapons.update(1 / hz, []); }
    assert.ok(Math.abs(weapons.stats.lasers - 180) <= 1, `${hz} Hz: ${weapons.stats.lasers}`);
    assert.ok(Math.abs(weapons.stats.missiles - 15) <= 1);
    const count = weapons.stats.lasers;
    for (let i = 0; i < hz; i++) weapons.triggers(1 / hz, owner, false, false);
    assert.equal(weapons.stats.lasers, count);
    const before = weapons.projectiles.find(p => p.active)?.age;
    weapons.update(0, []);
    assert.equal(weapons.projectiles.find(p => p.active)?.age, before);
    weapons.reset(); assert.equal(weapons.stats.hits + weapons.stats.lasers + weapons.stats.active, 0);
    assert.ok(weapons.projectiles.every(p => !p.active && p.owner === null));
    assert.ok(weapons.blasts.every(b => !b.active && b.owner === null));
    owner.dead = true; assert.equal(weapons.fire(LASER, owner), false);
  }
  const { owner } = setup(), tiny = new BeamWeapons3D(D, 2);
  assert.equal(tiny.fire(LASER, owner), true); assert.equal(tiny.fire(MISSILE, owner), true);
  assert.equal(tiny.fire(LASER, owner), false);
  tiny.update(7, []); assert.equal(tiny.stats.active, 0); assert.equal(tiny.fire(LASER, owner), true);
});

test('muzzle and projectile velocity follow the rotated ship and inherit its drift', () => {
  const { owner, weapons } = setup();
  owner.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  owner._rotTick = -1; owner.vel.y = 12;
  weapons.fire(LASER, owner);
  const p = weapons.projectiles[0];
  assert.ok(p.z < -2); assert.ok(p.vz < -619); assert.equal(p.vy, 12);
});

test('fighter uses normal destructible masses and the GLB skin path; classic crash mode stays anchored', () => {
  setup(); const root = createBeamFighterModel();
  try {
    const fighter = buildModelBeamStructure(root, { targetSize: 14.4, cellSize: 0.8, forwardAxis: '+x' });
    assert.ok(fighter.nodes.length > 50 && fighter.nodes.length < 1500);
    assert.ok(fighter.skin.parts.length > 0);
    const [station, ship] = createCrashBodies(D, structure(12, 8, 8), fighter, { combat: true });
    assert.equal(station.static, false); assert.equal(station.noSplit, false);
    assert.equal(ship.mass, fighter.mass);
    const [anchored] = createCrashBodies(D, structure(), fighter);
    assert.equal(anchored.static, true); assert.equal(anchored.noSplit, true);
  } finally { disposeModelResources(root); }
});

test('projectile visuals reuse four meshes and reset removes every effect', () => {
  const { owner, weapons } = setup(), scene = new THREE.Scene();
  const view = new BeamWeaponsVisual3D(scene, weapons);
  try {
    weapons.fire(LASER, owner); weapons.fire(MISSILE, owner); weapons.update(0.01, []); view.sync();
    assert.equal(scene.children.length, 4); assert.equal(view.lasers.count, 1); assert.equal(view.rockets.count, 1);
    const buffer = view.lasers.instanceMatrix.array;
    view.sync(); assert.equal(view.lasers.instanceMatrix.array, buffer);
    weapons.reset(); view.sync(); assert.ok(view.meshes.every(m => !m.visible && m.count === 0));
  } finally { view.dispose(scene); }
  assert.equal(scene.children.length, 0);
});

test('combat camera centers the gun sight while keeping the fighter below it after a roll', () => {
  const { owner } = setup();
  owner.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.1);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 12000);
  const chase = new BeamFlightCamera3D(camera); chase.aimDistance = 450;
  chase.update(owner, 8, 0); camera.updateMatrixWorld();
  const sight = new THREE.Vector3(450, 0, 0).applyQuaternion(owner.quat).add(owner.pos).project(camera);
  const ship = new THREE.Vector3().copy(owner.pos).project(camera);
  assert.ok(Math.abs(sight.x) < 1e-9 && Math.abs(sight.y) < 1e-9);
  assert.ok(ship.y < -0.1 && ship.y > -0.6);
});
