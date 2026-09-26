import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';
import { setPlanarHeading } from '../src/game/beamFlightControls2D.js';

// Płyta 2D ze sprite'a z wcięciem (jak w taranach dema) — przy 1500 j./s pęka na kilka wraków.
function notchedPlate(cells = 40, rows = 16, world = 400) {
  const w = cells * 4, h = rows * 4, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > w * 0.7 && Math.abs(y - h / 2) < h * 0.2) continue;
      const o = (y * w + x) * 4;
      data[o] = 120 + (x % 50); data[o + 1] = 130; data[o + 2] = 140 + (y % 30); data[o + 3] = 255;
    }
  }
  return buildSpriteBeamStructure({ width: w, height: h, data }, { worldLength: world, cellsAlong: cells, bulkheadEvery: 8 });
}

function step(bodies, count) {
  for (let i = 0; i < count; i++) {
    D.integrate(1 / 120, bodies);
    D.update(1 / 120, bodies);
    for (let j = bodies.length - 1; j >= 0; j--) if (bodies[j].dead || bodies[j].activeNodes <= 0) bodies.splice(j, 1);
  }
}

// Stan fizyki niezależny od dziur w magazynach i od numeracji: żywe węzły po kolei,
// belki o obu końcach żywych (końce jako rangi). FNV po bitach float64.
function canonicalHash(bodies) {
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  let h = 0x811c9dc5;
  const mixU = (v) => { h ^= v >>> 0; h = Math.imul(h, 0x01000193) >>> 0; };
  const mix = (v) => { f64[0] = v; mixU(u32[0]); mixU(u32[1]); };
  for (const b of bodies) {
    if (b.dead) continue;
    for (const v of [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w,
      b.angVel.x, b.angVel.y, b.angVel.z, b.mass, b.activeNodes, b.liveBeams, b.isWreck ? 1 : 0]) mix(v);
    const s = b.nodeStore, e = b.beamStore, rank = new Int32Array(s.count).fill(-1);
    let r = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      rank[i] = r++;
      for (const v of [s.x[i], s.y[i], s.z[i], s.vx[i], s.vy[i], s.vz[i], s.hp[i], s.ox[i], s.oy[i], s.oz[i], s.beamCount[i]]) mix(v);
    }
    for (let k = 0; k < e.count; k++) {
      const a = e.a[k], c = e.b[k];
      if (!s.active[a] || !s.active[c]) continue;
      mixU(rank[a]); mixU(rank[c]); mix(e.broken[k]); mix(e.rest[k]); mix(e.fatigue[k]);
    }
  }
  return h.toString(16);
}

const summary = (bodies) => bodies.map(b => `${b.activeNodes}/${b.liveBeams}${b.isWreck ? 'w' : ''}`).join(' ');
const holes = (bodies) => bodies.some(b => b.nodeStore.count > b.activeNodes);

// Ile przebudów kadłuba poszło w miejscu (reszta = zagęszczenie).
function countInPlace(run) {
  D.warmUp();   // rozgrzewka z pierwszego init() też rozcina płyty — nie może wpaść w licznik
  const original = D._retireOutsideGroup;
  let calls = 0;
  D._retireOutsideGroup = function (...args) { calls++; return original.apply(this, args); };
  try {
    const bodies = run();
    return { bodies, calls };
  } finally {
    D._retireOutsideGroup = original;
  }
}

function ram2d(compactBelow) {
  const s = notchedPlate();
  const cfg = createBeamConfig(s.cellSize);
  Object.assign(cfg, { planar: true, localSolver: true, crushStrength: 300000, globalBreakMul: 0.6, maxContacts: 384, compactBelow });
  D.init(cfg); D.onDebris = null;
  const a = D.createBody(cloneBeamStructure(s), {});
  const b = D.createBody(cloneBeamStructure(s), { position: { x: 360, y: 20, z: 0 } });
  setPlanarHeading(b, Math.PI / 2);
  a.vel.x = 1500;
  const bodies = [a, b];
  step(bodies, 300);
  return bodies;
}

test('rozpad w miejscu ≡ zagęszczenie: taran płyt 2D z solverem lokalnym, ten sam stan przy każdym progu', () => {
  const runAlways = countInPlace(() => ram2d(1)), runNever = countInPlace(() => ram2d(0));
  const always = runAlways.bodies, never = runNever.bodies, inPlace = ram2d(0.5);
  assert.ok(always.length > 2, `taran nie rozbił płyt: ${summary(always)}`);
  assert.equal(runAlways.calls, 0, 'przy progu 1 kadłub zawsze się zagęszcza');
  assert.ok(runNever.calls > 0, 'bez zagęszczania nie było rozpadu w miejscu — test nic nie sprawdza');
  assert.ok(holes(never));
  const reference = canonicalHash(always);
  assert.equal(summary(inPlace), summary(always));
  assert.equal(canonicalHash(inPlace), reference, 'rozpad w miejscu rozjechał się z zagęszczeniem');
  assert.equal(summary(never), summary(always));
  assert.equal(canonicalHash(never), reference, 'kadłub z dziurami rozjechał się z zagęszczeniem');
});

test('rozpad w miejscu ≡ zagęszczenie: bryła 3D, pełny solver, dwa kolejne cięcia', () => {
  const structure = buildBeamStructure(voxelizeTriangles(makeBoxTriangles(8, 3, 3, 0.05, 0.05, 0.05), null,
    { cellSize: 0.5, shellLayers: 2 }), { cellMassBase: 10, bulkheadEvery: 0 });
  const run = (compactBelow) => {
    const cfg = createBeamConfig(0.5);
    cfg.compactBelow = compactBelow;
    D.init(cfg); D.onDebris = null;
    const body = D.createBody(cloneBeamStructure(structure), { velocity: { x: 0.4, y: 0.2, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0.3 } });
    const bodies = [body];
    for (const cutX of [1.2, -1.7]) {
      // Cięcie w kadłubie po jego bieżącym układzie (po pierwszym rozpadzie środek się przesunął).
      const s = body.nodeStore, e = body.beamStore;
      let cut = 0;
      for (let k = 0; k < e.count; k++) {
        if (e.broken[k] || !s.active[e.a[k]] || !s.active[e.b[k]]) continue;
        if ((s.ox[e.a[k]] > cutX) !== (s.ox[e.b[k]] > cutX)) { e.broken[k] = 1; cut++; }
      }
      body.liveBeams -= cut;
      body.structureDirty = true;
      D.splitQueue.push(body);
      D.processSplits(bodies);
      step(bodies, 40);
    }
    return bodies;
  };
  const always = run(1), inPlace = run(0.5), never = run(0);
  assert.ok(always.length >= 3, `oczekiwano dwóch wraków: ${summary(always)}`);
  assert.ok(holes(never));
  assert.equal(canonicalHash(inPlace), canonicalHash(always));
  assert.equal(canonicalHash(never), canonicalHash(always));
});

test('obrys po zgniotach i trafieniach zawiera każdy węzeł (zachowawczy, bez przeliczania całości)', () => {
  const s = notchedPlate();
  const cfg = createBeamConfig(s.cellSize);
  Object.assign(cfg, { planar: true, localSolver: true, crushStrength: 300000, globalBreakMul: 0.6, maxContacts: 384 });
  D.init(cfg); D.onDebris = null;
  const a = D.createBody(cloneBeamStructure(s), {});
  const b = D.createBody(cloneBeamStructure(s), { position: { x: 360, y: 20, z: 0 } });
  setPlanarHeading(b, Math.PI / 2);
  a.vel.x = 1200;
  const bodies = [a, b];
  let checked = 0, loose = 0;
  for (let i = 0; i < 160; i++) {
    step(bodies, 1);
    if (i % 20 === 5) D.applyImpact(bodies[0], bodies[0].pos.x, bodies[0].pos.y, 0, 400, { x: 1, y: 0.3, z: 0 });
    for (const body of bodies) {
      const st = body.nodeStore, mm = body._boundsMinMax;
      let r2 = 0;
      for (let k = 0; k < st.count; k++) {
        if (!st.active[k]) continue;
        const x = st.x[k], y = st.y[k], z = st.z[k];
        assert.ok(x >= mm[0] && x <= mm[3] && y >= mm[1] && y <= mm[4] && z >= mm[2] && z <= mm[5],
          `węzeł poza obrysem (krok ${i})`);
        r2 = Math.max(r2, x * x + y * y + z * z);
        checked++;
      }
      assert.ok(body.radius >= Math.sqrt(r2) + body.cellSize - 1e-9, `promień za mały (krok ${i})`);
      if (body.radius > Math.sqrt(r2) + body.cellSize + 1e-9) loose++;
    }
  }
  assert.ok(checked > 0);
  assert.ok(loose > 0, 'obrys nigdy nie był zachowawczy — czy zgniot w ogóle go nie przeliczał?');
});

test('rozgrzewka rozpadów przywraca stan systemu', () => {
  const cfg = createBeamConfig(2);
  D.init(cfg);
  const debris = () => {};
  D.onDebris = debris;
  D.perf.beamsBroken = 7;
  const queue = D.splitQueue;
  const probe = D.createBody(notchedPlate(8, 4, 80), {});
  D._warmedUp = false;
  D.warmUp(4);
  assert.equal(D.config, cfg);
  assert.equal(D.onDebris, debris);
  assert.equal(D.splitQueue, queue);
  assert.equal(D.perf.beamsBroken, 7);
  const next = D.createBody(notchedPlate(8, 4, 80), {});
  assert.equal(next.id, probe.id + 1, 'rozgrzewka przesunęła numerację ciał');
  D.onDebris = null;
});
