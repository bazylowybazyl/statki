import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBeamBounds, worldBeamBounds, beamBoundsOverlap } from '../src/game/beamBounds3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';

function makeBody(y = 0) {
  return D.createBody(buildBeamStructure(voxelizeTriangles(makeBoxTriangles(12, 1, 1), null,
    { cellSize: 0.5, shellLayers: 0 })), { position: { x: 0, y, z: 0 } });
}

test('rotated AABBs enclose every deformed node and reject no pair with an actual node contact', () => {
  D.init(createBeamConfig(0.5));
  const A = makeBody(), B = makeBody();
  const padding = (A.cellSize + B.cellSize) * D.config.nodeRadius / D.config.cellSize;
  for (let step = 1; step <= 32; step++) {
    for (const [i, b] of [A, B].entries()) {
      const angle = step * 0.23 + i * 0.9, sin = Math.sin(angle / 2);
      Object.assign(b.quat, { x: sin / Math.sqrt(3), y: sin / Math.sqrt(3), z: sin / Math.sqrt(3), w: Math.cos(angle / 2) });
      for (const n of b.nodes) { n.x = n.ox + Math.sin(n.id + step) * 2; n.y = n.oy + Math.cos(n.id + step) * 3; }
      b._rotTick = -1;
      D._refreshRot(b);
      updateBeamBounds(b);
      const bounds = worldBeamBounds(b, D._tick), m = b._rot;
      for (const n of b.nodes) {
        const xyz = [n.x, n.y, n.z];
        for (let axis = 0; axis < 3; axis++) {
          const r = axis * 3;
          const value = m[r] * xyz[0] + m[r + 1] * xyz[1] + m[r + 2] * xyz[2];
          assert.ok(Math.abs(value - bounds[axis]) <= bounds[axis + 3] + 1e-10);
        }
      }
    }
    // Align chosen nodes after changing position within the SAME physics step.
    const a = A.nodes[step], b = B.nodes[step * 2], ma = A._rot, mb = B._rot;
    for (const [axis, key] of ['x', 'y', 'z'].entries()) {
      const r = axis * 3;
      B.pos[key] = A.pos[key] + ma[r] * a.x + ma[r + 1] * a.y + ma[r + 2] * a.z
        - mb[r] * b.x - mb[r + 1] * b.y - mb[r + 2] * b.z;
    }
    assert.equal(beamBoundsOverlap(A, B, padding, D._tick), true, 'a real contact must survive broad phase');
    B.pos.y += 100;
    assert.equal(beamBoundsOverlap(A, B, padding, D._tick), false, 'separation must use current positions');
  }
});

test('broad phase skips disjoint thin bodies inside overlapping spheres but admits them after moving into contact', () => {
  D.init(createBeamConfig(0.5));
  const A = makeBody(), B = makeBody(5);
  assert.ok(A.radius + B.radius > 5);
  D.update(1 / 120, [A, B]);
  assert.equal(D.perf.broadphasePairs, 2);
  assert.equal(D.perf.aabbRejected, 2);
  assert.equal(D.perf.narrowphasePairs, 0);
  B.pos.y = 0.8;
  D.update(1 / 120, [A, B]);
  assert.ok(D.perf.narrowphasePairs > 0 && D.perf.contacts > 0);
});
