import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeamShips3D as R } from '../src/3d/beamShips3D.js';
import { buildModelBeamStructure } from '../src/3d/beamModel3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { prepareSkinSurface } from '../src/3d/beamSkinSurface3D.js';

function fixture() {
  const model = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 3), new THREE.MeshStandardMaterial());
  const structure = buildModelBeamStructure(model, { targetSize: 8, cellSize: 0.5, shellLayers: 2, bulkheadEvery: 4 });
  D.init(createBeamConfig(0.5));
  const body = D.createBody(structure), camera = new THREE.PerspectiveCamera();
  R.init(new THREE.Scene()); R.interiorsEnabled = true;
  return { body, structure, camera, model };
}
function cleanup(f) { R.dispose(); R.disposeSkinAssets(f.structure.skin); f.model.geometry.dispose(); f.model.material.dispose(); }
function cut(body) {
  let broken = 0;
  for (const beam of body.beams) if ((body.nodes[beam.a].ox < 0) !== (body.nodes[beam.b].ox < 0)) {
    beam.broken = true; broken++;
  }
  body.liveBeams -= broken;
  body.meshDirty = true;
}

test('large imported polygons are subdivided locally without changing area, normals, UVs or bounds', () => {
  const f = fixture();
  try {
    prepareSkinSurface(f.structure.skin);
    const skin = f.structure.skin;
    assert.ok(skin.triangleCount > 12);
    let area = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const part of skin.parts) for (let t = 0; t < part.indices.length; t += 3) {
      a.fromArray(part.positions, part.indices[t] * 3); b.fromArray(part.positions, part.indices[t + 1] * 3); c.fromArray(part.positions, part.indices[t + 2] * 3);
      assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) <= 0.625001);
      area += b.sub(a).cross(c.sub(a)).length() * 0.5;
    }
    assert.ok(Math.abs(area - 114) < 1e-6);
    for (const part of skin.parts) {
      assert.ok(part.uvs.every(v => v >= 0 && v <= 1));
      for (let i = 0; i < part.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...part.normals.subarray(i, i + 3)) - 1) < 1e-6);
    }
    const prepared = skin._surface;
    prepareSkinSurface(skin);
    assert.equal(skin._surface, prepared);
  } finally { cleanup(f); }
});

test('breaking supports tears the skin before any node dies or body splits and creates thin metal rims', () => {
  const f = fixture();
  try {
    R.sync([f.body], f.camera, 0);
    const sd = R.bodyData.get(f.body).skin, initial = sd.triangleCount, nodes = f.body.activeNodes;
    assert.equal(sd.rims, null);
    assert.equal(sd.materials[0].uniforms.uFfd.value, 0, 'intact models must skip deformation texture sampling');
    cut(f.body);
    R.sync([f.body], f.camera, 0);
    assert.equal(f.body.activeNodes, nodes);
    assert.ok(sd.triangleCount < initial && sd.triangleCount > initial * 0.5);
    assert.ok(sd.rims.count > 0 && sd.rims.mesh.geometry.drawRange.count === sd.rims.count);
    assert.ok(sd.rims.positions.subarray(0, sd.rims.count * 3).every(Number.isFinite));
    assert.ok(sd.rims.insets.some(v => Math.abs(v) > 0.01 && Math.abs(v) < 0.1));
    const cells = new Map(f.body.nodes.map(n => [n.ix + n.iy * sd.dims.x + n.iz * sd.dims.x * sd.dims.y, n]));
    for (let pi = 0; pi < sd.surface.parts.length; pi++) {
      const groups = f.body.skin._surface[pi].groups, part = sd.surface.parts[pi];
      for (let g = 0; g < groups.length; g++) if (part.visible[g]) {
        const side = new Set(groups[g].anchors.map(id => cells.get(id).ox < 0));
        assert.equal(side.size, 1, 'a visible patch may not bridge the disconnected halves');
      }
    }
    assert.ok(sd.ribs.mesh.count > 0);
    assert.equal(sd.ribs.mesh.count, sd.ribs.members.filter(i => !f.body.beams[i].broken).length);
  } finally { cleanup(f); }
});

test('movement reuses surface buffers; repair restores topology and removes torn rims', () => {
  const f = fixture();
  try {
    R.sync([f.body], f.camera, 0); cut(f.body); R.sync([f.body], f.camera, 0);
    const sd = R.bodyData.get(f.body).skin;
    const index = sd.meshes[0].geometry.index, rim = sd.rims.mesh.geometry.attributes.position, linkVersion = sd.linksTexture.version;
    f.body.nodes[0].x += 0.3; f.body.meshDirty = true;
    R.sync([f.body], f.camera, 1);
    assert.equal(sd.materials[0].uniforms.uFfd.value, 1, 'a dent must enable deformation again');
    assert.equal(sd.meshes[0].geometry.index, index);
    assert.equal(sd.rims.mesh.geometry.attributes.position, rim);
    assert.equal(sd.linksTexture.version, linkVersion);
    for (const beam of f.body.beams) beam.broken = false;
    f.body.liveBeams = f.body.beams.length; f.body.meshDirty = true;
    R.sync([f.body], f.camera, 2);
    assert.equal(sd.triangleCount, f.structure.skin.triangleCount);
    assert.equal(sd.rims.count, 0);
    assert.equal(sd.rims.mesh.visible, false);
  } finally { cleanup(f); }
});

test('split fragments never duplicate a skin triangle and retain only their live anchors', () => {
  const f = fixture(), bodies = [f.body];
  try {
    R.sync(bodies, f.camera, 0); cut(f.body);
    f.body.structureDirty = true; D.splitQueue.push(f.body); D.processSplits(bodies);
    assert.equal(bodies.length, 2);
    R.sync(bodies, f.camera, 0);
    const triangles = new Set();
    for (const body of bodies) {
      const sd = R.bodyData.get(body).skin;
      for (let pi = 0; pi < sd.meshes.length; pi++) {
        const geometry = sd.meshes[pi].geometry, indices = geometry.index.array;
        assert.equal(indices.length, geometry.drawRange.count, 'a new fragment must allocate only its own indices');
        for (let i = 0; i < geometry.drawRange.count; i += 3) {
          const key = `${pi}:${indices[i]},${indices[i + 1]},${indices[i + 2]}`;
          assert.ok(!triangles.has(key), 'the same triangle was drawn by both fragments');
          triangles.add(key);
        }
      }
      for (let pi = 0; pi < sd.surface.parts.length; pi++) {
        const groups = body.skin._surface[pi].groups, visible = sd.surface.parts[pi].visible;
        for (let g = 0; g < groups.length; g++) if (visible[g]) {
          assert.ok(groups[g].anchors.every(id => sd.surface.alive[id]));
        }
      }
    }
  } finally { cleanup(f); }
});
