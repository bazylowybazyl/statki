import test from 'node:test';
import assert from 'node:assert/strict';

import { BeamNodeStore, BeamLinkStore, NODE_STORE_FIELDS, BEAM_STORE_FIELDS,
  nodeViews, beamViews, packBeamStructure } from '../src/game/beamStore3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';

test('magazyny tworzą dokładnie pola z list (z nich korzystają widoki i clone)', () => {
  const s = new BeamNodeStore(4), l = new BeamLinkStore(3);
  for (const [f, T] of Object.entries(NODE_STORE_FIELDS)) {
    assert.ok(s[f] instanceof T, `węzeł.${f}`);
    assert.equal(s[f].length, 4, `węzeł.${f}`);
  }
  for (const [f, T] of Object.entries(BEAM_STORE_FIELDS)) {
    assert.ok(l[f] instanceof T, `belka.${f}`);
    assert.equal(l[f].length, 3, `belka.${f}`);
  }
  // Pole spoza list nie trafi do clone() ani do widoków — trzeba je dopisać do listy.
  const extraNode = Object.keys(s).filter(k => !(k in NODE_STORE_FIELDS) && !['count', 'adjStart', 'adj'].includes(k));
  const extraBeam = Object.keys(l).filter(k => !(k in BEAM_STORE_FIELDS) && k !== 'count');
  assert.deepEqual(extraNode, []);
  assert.deepEqual(extraBeam, []);
  assert.ok(s.hashNext.every(v => v === -1), 'pusty łańcuch hasha to −1, nie 0 (0 to pierwszy węzeł)');
});

test('widoki czytają i piszą magazyn, także dawnymi nazwami pól; clone jest niezależny', () => {
  const s = new BeamNodeStore(2), l = new BeamLinkStore(1);
  const [n0, n1] = nodeViews(s), [e] = beamViews(l);
  n1.x = 3.5; n1.active = true; n1._act = 1; n1._crushDepth = 0.25;
  assert.equal(s.x[1], 3.5);
  assert.equal(s.active[1], 1);
  assert.equal(s.act[1], 1);
  assert.equal(s.crushDepth[1], 0.25);
  assert.equal(n1.active, true);
  assert.equal(n0.active, false);
  assert.equal(n1.id, 1);
  e.break = 0.4; e.broken = true; e._stamp = 7;
  assert.equal(l.brk[0], 0.4);
  assert.equal(l.broken[0], 1);
  assert.equal(l.stamp[0], 7);
  const c = s.clone();
  c.x[1] = -1;
  assert.equal(s.x[1], 3.5, 'kopia nie dzieli tablic z oryginałem');
  assert.equal(c.active[1], 1);
  assert.equal(l.clone().brk[0], 0.4);
});

test('pakowanie: te same liczby co obiekty, listy belek węzła w kolejności belek (a, potem b)', () => {
  const node = (i) => ({ ix: i, iy: 0, iz: 0, x: i, y: 0.5, z: 0, ox: i, oy: 0.5, oz: 0, px: i, py: 0.5, pz: 0,
    vx: 0, vy: 0, vz: 0, mass: 2 + i, invMass: 1 / (2 + i), hp: 10, maxHp: 10, coverage: 0.5,
    r: 0.1, g: 0.2, b: 0.3, depth: 0, beamCount: 2, localBeamCount: 2, platingCount: 2, active: true, surface: i !== 1 });
  const beam = (a, b, type) => ({ a, b, rest: 1, restBase: 1, stiffness: 0.9, deform: 0.05, break: 0.3,
    strain: 0, fatigue: 0, type, broken: false, restBridge: a === 2 });
  const packed = packBeamStructure([node(0), node(1), node(2)], [beam(0, 1, 0), beam(1, 2, 1), beam(2, 0, 2)]);
  const s = packed.nodeStore, l = packed.beamStore;
  assert.equal(s.mass[2], 4);
  assert.equal(s.surface[1], 0);
  assert.equal(l.restBridge[2], 1);
  assert.equal(l.type[1], 1);
  const list = (i) => Array.from(s.adj.subarray(s.adjStart[i], s.adjStart[i + 1]));
  assert.deepEqual([list(0), list(1), list(2)], [[0, 2], [0, 1], [1, 2]]);
  assert.deepEqual(Array.from(packed.nodes[1].beams), [0, 1], 'widok węzła zwraca swoją listę belek');
});

test('konstrukcja z wokseli: kratownica wskazuje widoki magazynu, bez obiektów węzłów obok', () => {
  const vox = voxelizeTriangles(makeBoxTriangles(3, 2, 2), null, { cellSize: 0.5, shellLayers: 0 });
  const st = buildBeamStructure(vox, {});
  assert.equal(st.nodes.length, st.nodeStore.count);
  assert.equal(st.beams.length, st.beamStore.count);
  for (const view of st.lattice.values()) assert.equal(view, st.nodes[view.id]);
  let pairs = 0;
  for (let i = 0; i < st.beamStore.count; i++) {
    const a = st.beamStore.a[i], b = st.beamStore.b[i];
    assert.ok(Array.from(st.nodes[a].beams).includes(i) && Array.from(st.nodes[b].beams).includes(i));
    pairs++;
  }
  assert.ok(pairs > 0);
});
