// Ciała zakotwiczone silnika belek (docs/PLAN-zniszczenia-swiata-3d.md § 4.2): createBody(…, { anchored: true }) +
// pinBeamNodes — tak stoją budowle gry (src/game/worldBodies.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorBeams3D as D, createBeamConfig, pinBeamNodes } from '../src/game/destructorBeams3D.js';
import { makeBoxTriangles, voxelizeTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';

const DT = 1 / 120;

function structure(x = 6, y = 6, z = 6, cellSize = 1) {
  return buildBeamStructure(voxelizeTriangles(makeBoxTriangles(x, y, z), null, { cellSize, shellLayers: 0 }));
}

test('ciało zakotwiczone: stoi, kotwice trzymają, ściana gnie się pod taranem', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 10, 10), { position: { x: 20 }, anchored: true });
  const pins = pinBeamNodes(wall, (x, y) => y < -4);
  assert.ok(pins > 0);
  const s = wall.nodeStore;
  const pinned = [];
  for (let i = 0; i < s.count; i++) if (s.invMass[i] === 0) pinned.push([i, s.x[i], s.y[i], s.z[i]]);
  const ram = D.createBody(structure(3, 3, 3), { position: { x: 12 }, velocity: { x: 60 } });
  const bodies = [wall, ram];
  for (let k = 0; k < 120; k++) { D.integrate(DT, bodies); D.update(DT, bodies); }
  assert.deepEqual([wall.pos.x, wall.pos.y, wall.pos.z], [20, 0, 0], 'ciało zakotwiczone nie przesuwa się jako całość');
  assert.deepEqual([wall.vel.x, wall.vel.y, wall.vel.z], [0, 0, 0]);
  for (const [i, x, y, z] of pinned) {
    if (!s.active[i]) continue;
    assert.deepEqual([s.x[i], s.y[i], s.z[i]], [x, y, z], 'kotwica nie ustępuje');
  }
  let maxDisp = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    maxDisp = Math.max(maxDisp, Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i], s.z[i] - s.oz[i]));
  }
  assert.ok(maxDisp > 0.05, `ściana ma się wgnieść (maks. przemieszczenie ${maxDisp})`);
  assert.ok(ram.vel.x < 60, 'taranujący traci prędkość');
});

test('ciało zakotwiczone: wyspa bez kotwicy odpada jako swobodny wrak, zakotwiczona zostaje', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 10, 10), { position: { x: 20 }, anchored: true });
  pinBeamNodes(wall, (x, y) => y < -4);
  const s = wall.nodeStore, e = wall.beamStore;
  let cut = 0;
  for (let bi = 0; bi < e.count; bi++) {
    if ((s.oy[e.a[bi]] > 0) !== (s.oy[e.b[bi]] > 0) && !e.broken[bi]) { e.broken[bi] = 1; cut++; }
  }
  wall.liveBeams -= cut;
  wall.structureDirty = true;
  const bodies = [wall];
  D.splitQueue = [wall];
  D.processSplits(bodies);
  assert.equal(bodies.length, 2);
  const wreck = bodies[1];
  assert.equal(wall.anchored, true, 'dolna (z kotwicami) część zostaje zakotwiczona');
  assert.equal(wreck.anchored, false);
  assert.ok(wreck.invMass > 0, 'górna część jest swobodna');
  let pinnedInWreck = 0;
  for (let i = 0; i < wreck.nodeStore.count; i++) if (wreck.nodeStore.invMass[i] === 0) pinnedInWreck++;
  assert.equal(pinnedInWreck, 0);
  wreck.vel.x = 5;
  for (let k = 0; k < 30; k++) { D.integrate(DT, bodies); D.update(DT, bodies); }
  assert.ok(wreck.pos.x > 20.5, 'odłam leci');
  assert.equal(wall.pos.x, 20);
});

test('ciało zakotwiczone bez kotwic (zniszczona kotwica) staje się swobodne', () => {
  D.init(createBeamConfig(1)); D.onDebris = null;
  const wall = D.createBody(structure(2, 4, 4), { position: { x: 20 }, anchored: true });
  pinBeamNodes(wall, (x, y) => y < -1);
  const s = wall.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.invMass[i] === 0) D.destroyNode(wall, i);
  D.splitQueue = [wall];
  D.processSplits([wall]);
  assert.equal(wall.anchored, false);
  assert.ok(wall.invMass > 0);
});
