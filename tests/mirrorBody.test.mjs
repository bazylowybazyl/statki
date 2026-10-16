// RW-11a: replika ciała belek w lustrze renderu (src/render/mirrorBody.js) — równoważność z dzisiejszym protokołem brudu.
// Dwa światy z tymi samymi zmianami ciała: A — dziś (render czyta ciało gry i zeruje jego flagi, gdy rysuje),
// B — lustro (pakujący przekazuje zmiany i zeruje flagi gry, render czyta replikę i zeruje JEJ flagi, gdy rysuje).
// W każdej rysowanej klatce oba widzą ten sam zbiór brudnych węzłów, dirtyAll, meshDirty i te same dane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { MirrorBody, applyBodyPage, describeBodyTopology } from '../src/render/mirrorBody.js';
import { BODY } from '../src/render/snapshotLayout.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBody(n) {
  const f = () => new Float64Array(n), i = () => new Int32Array(n), u = () => new Uint8Array(n);
  const s = {
    count: n, shapeVersion: 0, x: f(), y: f(), z: f(), ox: f(), oy: f(), oz: f(), heat: f(), heatStamp: f(),
    ix: i(), iy: i(), iz: i(), active: u().fill(1), patch: u(), skinDirty: u(),
    adjStart: new Int32Array(n + 1), adj: new Int32Array(0)
  };
  for (let k = 0; k < n; k++) { s.ix[k] = k % 10; s.iy[k] = (k / 10) | 0; s.x[k] = s.ox[k] = k * 15; s.y[k] = s.oy[k] = -k * 3; }
  const m = n * 2;
  const e = { count: m, a: new Int32Array(m), b: new Int32Array(m), rest: new Float64Array(m).fill(15), restBase: new Float64Array(m).fill(15), broken: new Uint8Array(m), type: new Uint8Array(m) };
  for (let k = 0; k < m; k++) { e.a[k] = k % n; e.b[k] = (k + 1) % n; }
  const region = { store: s, dirty: new Int32Array(n), dirtyCount: 0, dirtyAll: false, drift: 0 };
  const body = { nodeStore: s, beamStore: e, _region: region, activeNodes: n, meshDirty: true, isSleeping: false, planar: true,
    cellSize: 15, latticeMin: { x: 0, y: 0, z: 0 }, _boundsMinMax: new Float64Array(6), _maxDisp: 0, dead: false };
  return body;
}

function markDirty(body, i) {
  const s = body.nodeStore, r = body._region;
  if (!s.skinDirty[i]) { s.skinDirty[i] = 1; r.dirty[r.dirtyCount++] = i; }
  body.meshDirty = true;
}

// zmiana gry — ta sama w obu światach (decyzje z jednego ciągu losowań)
function mutate(bodies, rnd) {
  const ops = [];
  const nOps = Math.floor(rnd() * 6);
  for (let q = 0; q < nOps; q++) {
    const kind = rnd();
    const i = Math.floor(rnd() * 60);
    const dx = rnd() * 4 - 2, h = rnd();
    ops.push([kind, i, dx, h]);
  }
  for (const body of bodies) {
    const s = body.nodeStore, e = body.beamStore;
    for (const [kind, i, dx, h] of ops) {
      if (kind < 0.6) { s.x[i] += dx; s.heat[i] = h; s.heatStamp[i] = i * 7; markDirty(body, i); }
      else if (kind < 0.7) { s.active[i] = 0; e.broken[i] = 1; body.activeNodes--; markDirty(body, i); }
      else if (kind < 0.8) { body._region.dirtyAll = true; body.meshDirty = true; for (let k = 0; k < s.count; k++) s.y[k] += 0.5; }
      else if (kind < 0.85) {   // shiftBodyOrigin
        for (let k = 0; k < s.count; k++) { s.ox[k] -= 1; s.x[k] -= 1; }
        s.shapeVersion++; body._region.dirtyAll = true; body.meshDirty = true;
      }
    }
  }
}

// „render rysuje ciało”: zapis stanu widzianego przez skórę i wyzerowanie flag (clearHullSkinDirty + meshDirty)
function drawAndClear(body) {
  const s = body.nodeStore, r = body._region;
  const seen = {
    meshDirty: body.meshDirty, dirtyAll: r.dirtyAll,
    // przy dirtyAll render przepisuje całą skórę i listy nie czyta (updateBeamSkinGeometry)
    dirty: r.dirtyAll ? null : Array.from(r.dirty.subarray(0, r.dirtyCount)).sort((a, b) => a - b),
    x: Array.from(s.x), y: Array.from(s.y), ox: Array.from(s.ox), heat: Array.from(s.heat), active: Array.from(s.active),
    broken: Array.from(body.beamStore.broken), activeNodes: body.activeNodes
  };
  if (r.dirtyAll) { s.skinDirty.fill(0); r.dirtyAll = false; }
  else for (let k = 0; k < r.dirtyCount; k++) s.skinDirty[r.dirty[k]] = 0;
  r.dirtyCount = 0;
  body.meshDirty = false;
  return seen;
}

test('replika ciała: ten sam brud i te same dane co ciało gry w każdej rysowanej klatce (1500 klatek)', () => {
  const A = makeBody(60), B = makeBody(60);
  const entB = { x: 0, y: 0, angle: 0, beamHull: { body: B, srcWidth: 100, srcHeight: 100, scale: 1, pivot: { x: 0, y: 0 } } };
  const packer = new SnapshotPacker({ shared: false });
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship: entB, npcs: [], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, consumeDirty: true });
  const mirror = new MirrorBody(0, 1);
  const rnd = rng(42);
  let drawn = 0, mismatches = 0;
  for (let k = 0; k < 1500; k++) {
    mutate([A, B], rnd);
    const draw = rnd() < 0.6;
    frame.lastConsumed = packer.k;
    packer.begin(frame);
    const v = packer.view;
    const bs = packer.ids.bodies.peek(B);
    const storeVer = v.bodyI32[bs * BODY.stride.i32 + BODY.I32.STORE_VER];
    if (mirror.storeVer !== storeVer) mirror.setTopology(describeBodyTopology(B), storeVer);
    assert.ok(applyBodyPage(mirror, v, bs));
    packer.finish(frame);
    if (draw) {
      drawn++;
      const a = drawAndClear(A), b = drawAndClear(mirror);
      try { assert.deepEqual(b, a); } catch (err) { mismatches++; if (mismatches < 3) throw err; }
    }
  }
  assert.ok(drawn > 800);
  assert.equal(mismatches, 0);
});
