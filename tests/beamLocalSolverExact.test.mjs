import test from 'node:test';
import assert from 'node:assert/strict';

// Solver lokalny silnika belek po optymalizacji 2026-10-07 (scalone przebiegi obszaru A ∪ F, belek i pierścienia,
// predykcja przy dopisaniu węzła, kernele 2D płaskiego ciała, pamięć wag więzów, lista F z zapisu): wynik bit w bit
// jak dawny kod (tests/helpers/beamLocalSolverReference.mjs) — kanoniczny stan po każdym kroku w scenach płaskich
// (trafienia, krater wymuszony, kopnięcie rakiety, taran z rozpadem), 3D i w płaszczyźnie z wieloma warstwami z.
import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { beamSolverScratch, prepareBeamConstraints, projectBeamConstraints, projectBeamConstraints2D } from '../src/game/beamConstraintSolver3D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';
import { setPlanarHeading } from '../src/game/beamFlightControls2D.js';
import { referenceSolveLocal, referencePrepareBeamConstraints, referenceProjectBeamConstraints } from './helpers/beamLocalSolverReference.mjs';

// Płyta 2D ze sprite'a z wcięciem — przy taranie pęka na wraki (jak tests/beamSplitInPlace).
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
const PLATE = notchedPlate();
const BOX = buildBeamStructure(voxelizeTriangles(makeBoxTriangles(4, 2, 3, 0.05, 0.05, 0.05), null, { cellSize: 0.5, shellLayers: 0 }),
  { cellMassBase: 10, frameStride: 1, bulkheadEvery: 8 });

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function canonicalHash(bodies) {
  let h = 0x811c9dc5;
  const mixU = (v) => { h ^= v >>> 0; h = Math.imul(h, 0x01000193) >>> 0; };
  const mix = (v) => { f64[0] = v; mixU(u32[0]); mixU(u32[1]); };
  for (const b of bodies) {
    if (b.dead) { mixU(0xdead); continue; }
    for (const v of [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w,
      b.angVel.x, b.angVel.y, b.angVel.z, b.mass, b.activeNodes, b.liveBeams, b.isWreck ? 1 : 0, b.isSleeping ? 1 : 0, b._maxDisp]) mix(v);
    const s = b.nodeStore, e = b.beamStore, rank = new Int32Array(s.count).fill(-1);
    let r = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      rank[i] = r++;
      for (const v of [s.x[i], s.y[i], s.z[i], s.vx[i], s.vy[i], s.vz[i], s.hp[i], s.ox[i], s.oy[i], s.oz[i], s.act[i], s.quiet[i]]) mix(v);
    }
    for (let k = 0; k < e.count; k++) {
      const a = e.a[k], c = e.b[k];
      if (!s.active[a] || !s.active[c]) continue;
      mixU(rank[a]); mixU(rank[c]); mix(e.broken[k]); mix(e.rest[k]); mix(e.fatigue[k]); mix(e.strain[k]);
    }
    const reg = b._region;
    if (reg) { mixU(reg.list.length); for (const i of reg.list) mixU(rank[i]); mixU(reg.frontierCount); mixU(reg.constraintCount); }
  }
  return h.toString(16);
}

// Ta sama scena dwa razy: wzorcowym solverem (dawny kod) i bieżącym; Math.random z ziarnem (krater z budżetu losuje odrzut).
function compare(scene, steps) {
  const runs = [];
  const random = Math.random, real = D._solveLocal;
  try {
    for (const solver of [referenceSolveLocal, real]) {
      let seed = 0x2545F491;
      Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      D._solveLocal = solver;
      const { bodies, perStep } = scene();
      const hashes = [];
      for (let i = 0; i < steps; i++) {
        perStep(i, bodies);
        D.integrate(1 / 120, bodies);
        D.update(1 / 120, bodies);
        for (let j = bodies.length - 1; j >= 0; j--) if (bodies[j].dead || bodies[j].activeNodes <= 0) bodies.splice(j, 1);
        hashes.push(`${i}:${bodies.length}:${canonicalHash(bodies)}`);
      }
      runs.push({ hashes, solved: D.perf.beamsBroken, bodies: bodies.length });
    }
  } finally {
    Math.random = random;
    D._solveLocal = real;
  }
  const [ref, cur] = runs;
  for (let i = 0; i < steps; i++) assert.equal(cur.hashes[i], ref.hashes[i], `krok ${i}`);
  return ref;
}

function gameConfig(cs, extra = {}) {
  const cfg = createBeamConfig(cs);
  Object.assign(cfg, { planar: true, localSolver: true, crushStrength: 300000, globalBreakMul: 0.6, maxContacts: 384, heatGain: 1 }, extra);
  D.init(cfg);
  D.onDebris = null;
  let t = 0;
  D.clock = () => (t += 1 / 240);
  return cfg;
}

function hitAt(body, i, damage, dir, opts) {
  const m = D._refreshRot(body), s = body.nodeStore;
  const wx = body.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
  const wy = body.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
  const wz = body.pos.z + m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i];
  return D.applyImpact(body, wx, wy, wz, damage, dir, opts);
}

function liveNode(body, k) {
  const s = body.nodeStore;
  let alive = 0;
  for (let i = 0; i < s.count; i++) if (s.active[i]) alive++;
  let pick = k % Math.max(1, alive);
  for (let i = 0; i < s.count; i++) if (s.active[i] && pick-- === 0) return i;
  return -1;
}

test('płaska scena (płaszczyzna gry, z = 0): trafienia, krater wymuszony, rakieta, taran z rozpadem — bit w bit', () => {
  const ref = compare(() => {
    gameConfig(PLATE.cellSize);
    const a = D.createBody(cloneBeamStructure(PLATE), { position: { x: 5e6, y: -3e6, z: 0 } });
    const b = D.createBody(cloneBeamStructure(PLATE), { position: { x: 5e6 + 360, y: -3e6, z: 0 } });
    setPlanarHeading(b, Math.PI / 2);
    const c = D.createBody(cloneBeamStructure(PLATE), { position: { x: 5e6, y: -3e6 + 2000, z: 0 } });
    setPlanarHeading(c, 0.7);
    a.vel.x = 900;
    const cs = PLATE.cellSize;
    return { bodies: [a, b, c], perStep(i, bodies) {
      const t = bodies.find((x) => x === c && !x.dead);
      if (!t) return;
      // ostrzał trzeciej płyty: krater z budżetu, wymuszony, kopnięcie ciśnieniem (rakieta), pchnięcie pozycji
      if (i % 7 === 0) hitAt(t, liveNode(t, i * 37), 300 + (i % 5) * 200, { x: Math.cos(i), y: Math.sin(i), z: 0 },
        { radius: cs * 2.5, hpBudget: 400 + i, damageFraction: 1 });
      if (i % 23 === 5) hitAt(t, liveNode(t, i * 91), 2500, { x: 1, y: 0.3, z: 0 }, { radius: cs * 3, hpBudget: 0, killRadius: cs * 1.6 });
      if (i % 31 === 11) hitAt(t, liveNode(t, i * 13), 900, { x: 0, y: -1, z: 0 }, { radius: cs * 3, breakRadius: cs * 2.1, impulseTime: 0.12 });
      if (i % 17 === 3) hitAt(t, liveNode(t, i * 7), 450, { x: -1, y: 0, z: 0 }, { radius: cs * 3, breakRadius: cs * 1.2 });
    } };
  }, 420);
  assert.ok(ref.solved > 50 && ref.bodies > 3, `scena musi łamać belki i dzielić ciała (zerwane ${ref.solved}, ciał ${ref.bodies})`);
});

test('scena 3D (bez płaszczyzny): trafienia i zderzenie brył — bit w bit', () => {
  compare(() => {
    const cfg = createBeamConfig(0.5);
    Object.assign(cfg, { localSolver: true, globalBreakMul: 0.6, maxContacts: 256 });
    D.init(cfg);
    D.onDebris = null;
    const a = D.createBody(cloneBeamStructure(BOX), { position: { x: 0, y: 0, z: 0 } });
    const b = D.createBody(cloneBeamStructure(BOX), { position: { x: 4.2, y: 0.4, z: 0.3 }, velocity: { x: -60, y: 0, z: 0 },
      quaternion: { x: 0.1, y: 0.2, z: 0, w: Math.sqrt(1 - 0.05) } });
    return { bodies: [a, b], perStep(i, bodies) {
      if (i % 9 === 2 && !a.dead) hitAt(a, liveNode(a, i * 11), 350, { x: 0.3, y: -0.5, z: 0.8 }, { radius: 1.2, breakRadius: 0.6 });
      if (i % 13 === 6 && !a.dead) hitAt(a, liveNode(a, i * 29), 600, { x: 0, y: 0, z: -1 }, { radius: 1.4, hpBudget: 500, damageFraction: 1 });
    } };
  }, 300);
});

test('płaszczyzna gry z kilkoma warstwami z (bryła wokseli): ścieżka 3D w trybie planar — bit w bit', () => {
  compare(() => {
    gameConfig(0.5);
    const a = D.createBody(cloneBeamStructure(BOX), { position: { x: 0, y: 0, z: 0 } });
    const b = D.createBody(cloneBeamStructure(BOX), { position: { x: 4.3, y: 0.5, z: 0 }, velocity: { x: -80, y: 0, z: 0 } });
    return { bodies: [a, b], perStep(i) {
      if (i % 8 === 1 && !a.dead) hitAt(a, liveNode(a, i * 17), 500, { x: 1, y: 0.2, z: 0 }, { radius: 1.2, hpBudget: 600, damageFraction: 1 });
    } };
  }, 240);
});

// Pomiar belek i rzutowanie na losowych danych: zerwane belki, wyrwane mocowania, sztywność zmieniona bronią
// (także 0), węzły o wadze 0 (pierścień). Płaskie dane: kernel 2D = 3D z dz ≡ 0.
test('prepareBeamConstraints (pamięć wag, flat) i projectBeamConstraints2D = dawne funkcje bit w bit', () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cfg = createBeamConfig(PLATE.cellSize);
  Object.assign(cfg, { globalBreakMul: 0.6 });
  for (let trial = 0; trial < 24; trial++) {
    const flat = trial % 2 === 0;
    const body = D.createBody(cloneBeamStructure(trial % 3 === 2 ? BOX : PLATE), {});
    const s = body.nodeStore, e = body.beamStore;
    const scratch = beamSolverScratch(body);
    const amp = s.count ? body.cellSize * (0.05 + rnd() * 0.6) : 0;
    const z0 = flat ? (trial % 4 === 0 ? 0 : 3.25) : 0;
    for (let i = 0; i < s.count; i++) {
      scratch.positions[i * 3] = s.x[i] + (rnd() - 0.5) * amp;
      scratch.positions[i * 3 + 1] = s.y[i] + (rnd() - 0.5) * amp;
      scratch.positions[i * 3 + 2] = flat ? z0 : s.z[i] + (rnd() - 0.5) * amp;
      scratch.weights[i] = rnd() < 0.15 ? 0 : s.invMass[i];
      scratch.active[i] = 1;
      scratch.mountFailed[i] = rnd() < 0.05 ? 1 : 0;
    }
    for (let k = 0; k < e.count; k++) {
      if (rnd() < 0.05) e.broken[k] = 1;
      if (rnd() < 0.1) e.stiffness[k] = rnd() < 0.3 ? 0 : rnd() * 1.4;   // broń cieplna: miękka, zerowa, > 1
      if (rnd() < 0.2) e.fatigue[k] = rnd() * 0.9;
      if (rnd() < 0.1) e.rest[k] *= 0.9 + rnd() * 0.2;
    }
    const list = rnd() < 0.5 ? null : Int32Array.from({ length: e.count }, (_, k) => k).filter(() => rnd() < 0.7);
    const listCount = list ? list.length : 0;
    const ss = trial % 5 === 0 ? 4 : 1;   // krok 1/60 s: inny mianownik wagi
    const run = (prep, proj, flatArg) => {
      const bs = e.clone();
      const sc = { ...scratch, positions: scratch.positions.slice(), weights: scratch.weights.slice(), active: scratch.active.slice(),
        mountFailed: scratch.mountFailed.slice(), a: scratch.a.slice(), b: scratch.b.slice(), rest: scratch.rest.slice(), factor: scratch.factor.slice() };
      const broken = prep(sc, bs, list, listCount, cfg, 1 / 120, 0.55, ss, flatArg);
      const solved = proj(sc, sc.count, 3);
      return { broken, solved, deformed: sc.deformed, count: sc.count, a: sc.a.slice(0, sc.count), b: sc.b.slice(0, sc.count),
        rest: sc.rest.slice(0, sc.count), factor: sc.factor.slice(0, sc.count), p: sc.positions,
        beams: [bs.broken, bs.rest, bs.strain, bs.fatigue] };
    };
    const ref = run(referencePrepareBeamConstraints, referenceProjectBeamConstraints);
    const cur = run(prepareBeamConstraints, flat ? projectBeamConstraints2D : projectBeamConstraints, flat);
    assert.equal(cur.broken, ref.broken, `próba ${trial}: zerwane`);
    assert.equal(cur.deformed, ref.deformed, `próba ${trial}: plastyczność`);
    assert.equal(cur.count, ref.count);
    assert.equal(cur.solved, ref.solved);
    assert.deepEqual(cur.a, ref.a); assert.deepEqual(cur.b, ref.b);
    assert.deepEqual(new Uint32Array(cur.rest.buffer.slice(0)), new Uint32Array(ref.rest.buffer.slice(0)), `próba ${trial}: długości więzów`);
    assert.deepEqual(new Uint32Array(cur.factor.buffer.slice(0)), new Uint32Array(ref.factor.buffer.slice(0)), `próba ${trial}: wagi więzów`);
    for (let q = 0; q < 4; q++) assert.deepEqual(cur.beams[q], ref.beams[q], `próba ${trial}: pole belek ${q}`);
    // Położenia po rzutowaniu bit w bit (x, y; z płaskiego ciała 2D nie rusza, 3D dodaje ±0 — to samo z).
    for (let i = 0; i < ref.p.length; i++) {
      if (flat && i % 3 === 2) { assert.equal(cur.p[i], ref.p[i]); continue; }
      assert.ok(Object.is(cur.p[i], ref.p[i]), `próba ${trial}: położenie ${i}: ${cur.p[i]} ≠ ${ref.p[i]}`);
    }
  }
});
