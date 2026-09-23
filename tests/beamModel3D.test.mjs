import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModelBeamStructure, disposeModelResources } from '../src/3d/beamModel3D.js';
import { createCrashBodies, CRASH_BREAK_MULTIPLIER } from '../src/game/beamCrashScene3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { loadStationModel, loadGlbModel } from './helpers/beamCrashScene.mjs';

function skinBounds(s) {
  const bounds = new THREE.Box3();
  for (const part of s.skin.parts) for (let i = 0; i < part.positions.length; i += 3) {
    bounds.expandByPoint(new THREE.Vector3(part.positions[i], part.positions[i + 1], part.positions[i + 2]));
  }
  return bounds.getSize(new THREE.Vector3());
}

test('GLB hierarchy transforms, materials and source geometry survive repeat imports and sizing', () => {
  const root = new THREE.Group();
  root.position.set(30, -14, 11);
  root.scale.set(2, 3, 4);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 8), new THREE.MeshBasicMaterial({ color: 'red' }));
  mesh.position.set(5, 1, -3);
  root.add(mesh);
  const before = JSON.stringify(root.toJSON());
  try {
    for (const forwardAxis of ['auto', '+z', '-z', '+y', '-y', '+x', '-x']) {
      for (const targetSize of [12, 24, 12]) {
        const s = buildModelBeamStructure(root, { targetSize, cellSize: targetSize / 20, forwardAxis });
        const bounds = skinBounds(s);
        assert.ok(Math.abs(Math.max(bounds.x, bounds.y, bounds.z) - targetSize) < 1e-4);
        if (['auto', '+z', '-z'].includes(forwardAxis)) assert.ok(bounds.x > bounds.y && bounds.x > bounds.z);
        assert.equal(s.skin.parts[0].material, mesh.material);
        assert.equal(s.skin.unbound, 0);
        assert.ok(s.mass > 0 && s.beams.length > 0);
      }
    }
    assert.equal(JSON.stringify(root.toJSON()), before, 'normalization must not compound or overwrite GLB transforms');
    assert.throws(() => buildModelBeamStructure(new THREE.Group(), { targetSize: 12, cellSize: 1 }), /geometrii/);
  } finally { disposeModelResources(root); }
});

test('two different actual GLBs work as ship and station, reset and swap roles', async () => {
  const stationModel = await loadStationModel();
  const shipModel = await loadStationModel('mars-station.glb');
  try {
    const station = buildModelBeamStructure(stationModel, { targetSize: 120, cellSize: 120 / 34 });
    const ship = buildModelBeamStructure(shipModel, { targetSize: 60, cellSize: 120 / 34 * 0.9, forwardAxis: 'auto' });
    assert.ok(ship.skin.triangleCount > 100 && station.skin.triangleCount > 100);
    for (const heavyShip of [false, true]) {
      D.init(createBeamConfig(120 / 34));
      D.config.globalBreakMul = 0.6;
      const bodies = createCrashBodies(D, station, ship, { heavyShip });
      bodies[1].vel.x = -300;
      let contacts = 0;
      for (let i = 0; i < 360; i++) {
        D.integrate(1 / 120, bodies);
        D.update(1 / 120, bodies);
        contacts += D.perf.contacts;
      }
      assert.ok(contacts > 0 && D.perf.beamsBroken > 0, 'imported ship must take part in physics and destruction');
      for (const body of bodies) {
        assert.ok(body.skin === station.skin || body.skin === ship.skin);
        assert.ok(body.nodes.every(n => Number.isFinite(n.x + n.y + n.z)));
      }
      const reset = createCrashBodies(D, station, ship, { heavyShip });
      assert.equal(reset[1].skin, ship.skin);
      assert.equal(reset[1].activeNodes, ship.nodes.length);
      assert.ok(reset[1].beams.every(b => !b.broken));
    }
  } finally { disposeModelResources(stationModel); disposeModelResources(shipModel); }
});

test('root Venator asset faces forward, retains its geometry and crumples against the default station', async () => {
  const model = await loadGlbModel(new URL('../venator.glb', import.meta.url));
  const stationModel = await loadStationModel();
  try {
    const cellSize = 120 / 44;
    const ship = buildModelBeamStructure(model, { targetSize: 50.4, cellSize: cellSize * 0.9, forwardAxis: 'auto' });
    const station = buildModelBeamStructure(stationModel, { targetSize: 120, cellSize });
    assert.equal(ship.skin.triangleCount, 774712, 'use the real Venator without silently reducing detail');
    const bounds = skinBounds(ship);
    assert.ok(Math.abs(bounds.x - 50.4) < 1e-3 && bounds.x > bounds.y && bounds.x > bounds.z);
    const tips = [new THREE.Box3(), new THREE.Box3()];
    for (const part of ship.skin.parts) for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i] + ship.com.x;
      if (Math.abs(x) > 50.4 * 0.35) tips[x > 0 ? 1 : 0].expandByPoint(new THREE.Vector3(x, part.positions[i + 1], part.positions[i + 2]));
    }
    assert.ok(tips[1].getSize(new THREE.Vector3()).z < tips[0].getSize(new THREE.Vector3()).z, '+X must be the narrow nose');
    D.init(createBeamConfig(cellSize));
    D.config.globalBreakMul = CRASH_BREAK_MULTIPLIER;
    const bodies = createCrashBodies(D, station, ship);
    bodies[1].vel.x = -300;
    for (let i = 0; i < 240; i++) { D.integrate(1 / 120, bodies); D.update(1 / 120, bodies); }
    assert.ok(bodies[1].activeNodes < ship.nodes.length);
    assert.ok(bodies.some(b => b.isWreck));
    assert.equal(bodies[0].activeNodes, station.nodes.length);
    assert.equal(bodies[0].pos.x, 0);
    for (const b of bodies) assert.ok(b.skin === station.skin || b.skin === ship.skin);
  } finally { disposeModelResources(model); disposeModelResources(stationModel); }
});
