import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeamShips3D as R } from '../src/3d/beamShips3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { extractSkinParts, extractTrianglesFromObject3D, voxelizeTriangles } from '../src/game/voxelBody3D.js';
import { selectSkinChunk } from '../src/3d/beamSkinChunks3D.js';
import { buildModelBeamStructure, disposeModelResources } from '../src/3d/beamModel3D.js';
import { createCrashBodies } from '../src/game/beamCrashScene3D.js';
import { loadStationModel, buildCrashStructures } from './helpers/beamCrashScene.mjs';

test('split skins stay attached to their nodes and large dents fit the deformation field', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 3), new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const triangles = extractTrianglesFromObject3D(mesh);
  const structure = buildBeamStructure(voxelizeTriangles(triangles.positions, triangles.colors,
    { cellSize: 0.5, shellLayers: 2 }), { skinParts: extractSkinParts(mesh), bulkheadEvery: 0 });
  D.init(createBeamConfig(0.5));
  const body = D.createBody(structure, { position: { x: 10, y: 2, z: -3 } });
  const bodies = [body];
  const before = new Map(body.nodes.map(n => [n, new THREE.Vector3(n.x + body.pos.x, n.y + body.pos.y, n.z + body.pos.z)]));
  for (const beam of body.beams) {
    if ((body.nodes[beam.a].ox > 0) !== (body.nodes[beam.b].ox > 0)) beam.broken = true;
  }
  body.structureDirty = true;
  D.splitQueue.push(body);
  D.processSplits(bodies);
  assert.equal(bodies.length, 2);
  R.init(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera();
  try {
    for (const ffd of [false, true]) {
      R.ffdEnabled = ffd;
      R.sync(bodies, camera, 0);
      for (const part of bodies) {
        const skin = R.bodyData.get(part).skin;
        const offset = skin.materials[0].uniforms.uBodyOffset.value;
        for (const n of part.nodes) {
          const originalLocal = new THREE.Vector3(
            part.skinLatticeMin.x + (n.ix + 0.5) * part.cellSize,
            part.skinLatticeMin.y + (n.iy + 0.5) * part.cellSize,
            part.skinLatticeMin.z + (n.iz + 0.5) * part.cellSize);
          const rendered = originalLocal.add(offset).add(new THREE.Vector3(part.pos.x, part.pos.y, part.pos.z));
          assert.ok(rendered.distanceTo(before.get(n)) < 1e-6);
        }
      }
    }
    const node = body.nodes[0];
    node.x = node.ox + 20;
    body.meshDirty = true;
    R.sync(bodies, camera, 0);
    const skin = R.bodyData.get(body).skin;
    const texel = (node.ix + node.iy * skin.dims.x + node.iz * skin.dims.x * skin.dims.y) * 4;
    const decoded = (skin.data[texel] - 128) / 127 * skin.deformScale;
    assert.ok(Math.abs(decoded - 20) < 0.2, `large dent clipped: ${decoded}`);
  } finally {
    R.sync([], camera, 0);
    R.disposeSkinAssets(structure.skin);
    R.debris.dispose(R.scene);
    R.debris = null;
    R.ffdEnabled = true;
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('chunk selection keeps a large triangle crossing a live cell without a vertex there', () => {
  const occupancy = new Uint8Array(25).fill(1);
  const skin = { dims: { x: 5, y: 5, z: 1 }, occupancy,
    parts: [{ indices: new Uint32Array([0, 1, 2]), cellUV: new Float32Array([0.1, 0.1, 0.5, 0.9, 0.1, 0.5, 0.1, 0.9, 0.5]) }] };
  assert.equal(selectSkinChunk(skin, 0, [{ ix: 1, iy: 1, iz: 0, active: true }]).count, 3);
  assert.equal(selectSkinChunk(skin, 0, [{ ix: 4, iy: 4, iz: 0, active: true }]).count, 0);
  assert.equal(selectSkinChunk(skin, 0, [{ ix: 1, iy: 1, iz: 0, active: false }]).count, 0);
});

test('actual GLB fragments draw local triangles, reuse buffers during movement and release only their own geometry', async () => {
  const model = await loadStationModel();
  const cellSize = 120 / 44;
  const station = buildModelBeamStructure(model, { targetSize: 120, cellSize });
  const ship = buildCrashStructures(extractTrianglesFromObject3D(model)).ship;
  D.init(createBeamConfig(cellSize));
  D.config.globalBreakMul = 0.6;
  const bodies = createCrashBodies(D, station, ship, { heavyShip: true });
  R.init(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera();
  R.beamsEnabled = false;
  R.nodesEnabled = false;
  try {
    R.sync(bodies, camera, 0);
    assert.equal(R.stats.skinTriangles, station.skin.triangleCount);
    assert.equal(R.bodyData.get(bodies[0]).beamLines, null);
    assert.equal(R.bodyData.get(bodies[0]).nodeMesh, null);
    bodies[1].vel.x = -300;
    let peakTriangles = 0;
    for (let i = 0; i < 360; i++) {
      D.integrate(1 / 120, bodies);
      D.update(1 / 120, bodies);
      R.sync(bodies, camera, i / 120);
      peakTriangles = Math.max(peakTriangles, R.stats.skinTriangles);
    }
    const fragments = bodies.filter(b => b.isWreck && b.skin);
    assert.ok(fragments.length >= 4);
    assert.ok(peakTriangles < station.skin.triangleCount * 1.6, `full GLB duplicated for fragments: ${peakTriangles}`);
    assert.ok(R.stats.skinTriangles < station.skin.triangleCount * 1.25);
    for (const b of fragments) {
      const skin = R.bodyData.get(b).skin;
      assert.ok(skin.triangleCount < station.skin.triangleCount * 0.7);
      const indices = skin.meshes.map(m => m.geometry.index);
      b.meshDirty = true;
      R.sync(bodies, camera, 4);
      assert.ok(skin.meshes.every((m, i) => m.geometry.index === indices[i]));
    }
    // Utrata jednego odłamu nie może unieważniać wspólnych atrybutów modelu.
    const gp = station.skin._gpu[0].geometry;
    const sourcePosition = gp.attributes.position;
    let sharedDisposals = 0;
    gp.addEventListener('dispose', () => sharedDisposals++);
    fragments[0].dead = true;
    R.sync(bodies, camera, 4);
    assert.equal(sharedDisposals, 0);
    assert.equal(gp.attributes.position, sourcePosition);
  } finally {
    R.dispose();
    R.disposeSkinAssets(station.skin);
    disposeModelResources(model);
  }
});
