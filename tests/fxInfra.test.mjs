// Infrastruktura efektów GPU (zadanie 12-A, src/3d/fx/): generator warstwy efektów,
// światła efektów bez alokacji, nośnik w paczkach (lustro CPU wzoru), początek pul GPU
// przy kamerze i zegary względem epoki, pakowanie źródeł zniekształceń, szumy.
// Grafy TSL budowane do WGSL w Node (WebGPURenderer bez init, atrapa kanwy).
// node --test tests/fxInfra.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import * as THREE from 'three/webgpu';
import { Fn, vec2, vec4, float, uv, screenUV, texture, instancedArray } from 'three/tsl';
import { FxRandom, fxRandom, FX_RANDOM_SEED } from '../src/3d/fx/fxRandom.js';
import { FxLights, FX_FLASH_CAP } from '../src/3d/fx/fxLights.js';
import { LightGrid, LIGHT_FLOATS } from '../src/3d/fx/lightGrid.js';
import {
  CARRIER_FLOATS, writeCarrierPacket, clearCarrierPacket, carrierPositionCpu, dragPathCpu, fxCarrierOffset, fxCarriedPosition
} from '../src/3d/fx/carrier.js';
import { FxPoolOrigin, createShiftKernel, applyShiftCpu, FX_REBASE_DIST, FX_EPOCH_SPAN } from '../src/3d/fx/gpuPoolOrigin.js';
import {
  DistortionField, distortionOffset, distortionOffsetCpu, sampleDistorted, DISTORT, DISTORT_CAP, DISTORT_HEADER, DISTORT_STRIDE
} from '../src/3d/fx/distortion.js';
import { bakeTile2D, bakeCloud2D, bakeNoise3D, bakeCurl3D, createTile2DTexture, createCurl3DTexture, fxNoise } from '../src/3d/fx/noise.js';
import { ActiveCarrier } from '../src/game/carrierVelocity.js';
import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../src/game/simClock.js';

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildFragment(material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
function buildCompute(node) {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}

// Przyrost zajętości young generation V8 w pętli (bez GC w trakcie — przy ujemnym
// przyroście próba jest powtarzana). Liczy bajty obiektów zaalokowanych przez `fn`.
const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
function allocatedBytes(fn, n) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn(i);
    const delta = newSpaceUsed() - before;
    if (delta >= 0) return delta;
  }
  return Infinity;
}

// --- fxRandom ---------------------------------------------------------------------

// mulberry32 z harnessu (scripts/webgpu/harness-strona.js) — wzorzec bit w bit.
function harnessMulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('fxRandom: mulberry32 bit w bit jak harness, deterministyczny po ziarnie, stan do odtworzenia', () => {
  for (const seed of [0, 1, 12345, FX_RANDOM_SEED, 0xffffffff]) {
    const r = new FxRandom(seed);
    const h = harnessMulberry(seed);
    for (let i = 0; i < 2000; i++) assert.equal(r.next(), h());
  }
  const a = new FxRandom(99);
  const b = new FxRandom(99);
  const seqA = Array.from({ length: 50 }, () => a.next());
  assert.deepEqual(Array.from({ length: 50 }, () => b.next()), seqA);
  a.seed(99);
  assert.deepEqual(Array.from({ length: 50 }, () => a.next()), seqA, 'seed() od nowa');
  const st = a.state;
  const x = a.next();
  a.state = st;
  assert.equal(a.next(), x, 'stan odtwarza ciąg');
  assert.equal(new FxRandom().next(), new FxRandom(FX_RANDOM_SEED).next(), 'domyślne ziarno');
});

test('fxRandom: zakresy range / int / uint32 / round (średnia = n) i bez Math.random', () => {
  const r = new FxRandom(7);
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random w warstwie efektów'); };
  try {
    let sumRound = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.range(-3, 5);
      assert.ok(v >= -3 && v < 5);
      const k = r.int(7);
      assert.ok(Number.isInteger(k) && k >= 0 && k < 7);
      const u = r.uint32();
      assert.ok(Number.isInteger(u) && u >= 0 && u < 4294967296);
      const s = r.sign();
      assert.ok(s === 1 || s === -1);
      sumRound += r.round(2.3);
    }
    close(sumRound / 20000, 2.3, 0.02, 'zaokrąglenie losowe nie gubi ułamka');
    assert.equal(r.round(-1), 0);
    assert.equal(r.round(NaN), 0);
    // Światła efektów też nie sięgają po Math.random (faza migotania z fxRandom).
    const L = new FxLights({ random: r, clock: { now: () => 0 }, carrier: null });
    L.flash(0, 0, 1, 1, 1, 2, 100, 0.5, 2, 0.8);
    L.commit({ addWorld: () => 0 }, 1.5);
  } finally {
    Math.random = orig;
  }
  assert.ok(fxRandom instanceof FxRandom);
});

// --- fxLights ---------------------------------------------------------------------

function recordingGrid() {
  return {
    calls: [],
    addWorld(x, y, z, range, r, g, b, scatter) { this.calls.push({ x, y, z, range, r, g, b, scatter }); return this.calls.length - 1; }
  };
}

test('fxLights: błysk z krzywą zaniku (1 − u)^decay i rozrostem; wygasa po życiu; punkt żyje jedną klatkę', () => {
  const L = new FxLights({ random: new FxRandom(1), clock: { now: () => 0 }, carrier: null });
  assert.ok(L.flash(100, 200, 1, 0.5, 0.25, 4, 300, 0.2, 2, 0, 30, 0.5) >= 0);
  assert.ok(L.point(-50, 60, 1, 1, 1, 2, 120, 25));
  let g = recordingGrid();
  L.commit(g, 0);
  assert.equal(g.calls.length, 2);
  assert.deepEqual(g.calls[0], { x: 100, y: 200, z: 30, range: 300, r: 4, g: 2, b: 1, scatter: Math.fround(0.6) });
  assert.equal(g.calls[1].x, -50); assert.equal(g.calls[1].r, 2); assert.equal(g.calls[1].range, 120);
  L.update(0.1);                                  // u = 0,5
  g = recordingGrid();
  L.commit(g, 0);
  assert.equal(g.calls.length, 1, 'punkt tylko na jedną klatkę');
  close(g.calls[0].r, 4 * 0.25, 1e-6, 'moc × (1 − u)²');
  close(g.calls[0].range, 300 * 1.25, 1e-3, 'zasięg × (1 + grow·u)');
  L.update(0.11);
  assert.equal(L.count, 0, 'wygasł');
  // pula: FX_FLASH_CAP błysków, potem −1
  for (let i = 0; i < FX_FLASH_CAP; i++) assert.ok(L.flash(0, 0, 1, 1, 1, 1, 10, 1) >= 0);
  assert.equal(L.flash(0, 0, 1, 1, 1, 1, 10, 1), -1);
  L.clear();
  assert.equal(L.count, 0);
});

test('fxLights: błysk jedzie z nośnikiem (ActiveCarrier + SimClock) — nie zostaje za pędzącym okrętem', () => {
  SimClock.reset();
  const L = new FxLights({ random: new FxRandom(2) });
  ActiveCarrier.set({ vx: 10000, vy: -2000, t0: 0, clock: CLOCK_SIM });
  L.flash(500, 500, 1, 1, 1, 5, 200, 0.6);
  ActiveCarrier.clear();
  L.flash(500, 500, 1, 1, 1, 5, 200, 0.6);        // bez nośnika — stoi w świecie
  try {
    SimClock.advance(0.3);
    SimClock.beginRender(1, 0.3);
    const g = recordingGrid();
    L.commit(g, 0.3);
    close(g.calls[0].x, 500 + 3000, 1e-6, 'x + v·(T − t0)');
    close(g.calls[0].y, 500 - 600, 1e-6);
    assert.equal(g.calls[1].x, 500);
    // Zegar renderu dla encji interpolowanych (gracz).
    const R = new FxLights({ random: new FxRandom(3) });
    ActiveCarrier.set({ vx: 100, vy: 0, t0: 0.1, clock: CLOCK_RENDER });
    R.flash(0, 0, 1, 1, 1, 1, 50, 1);
    ActiveCarrier.clear();
    SimClock.beginRender(0.5, 0.2);                // render = sim − 0,1
    close(R.flashX(0), 100 * (SimClock.render - 0.1), 1e-9);
  } finally {
    ActiveCarrier.clear();
    SimClock.reset();
  }
});

test('fxLights: kadr (setView) odrzuca światła poza ekranem; siatka dostaje współrzędne lokalne', () => {
  const L = new FxLights({ random: new FxRandom(4), clock: { now: () => 0 }, carrier: null });
  L.setView(6_000_000 - 1000, -500, 6_000_000 + 1000, 500);
  assert.equal(L.flash(6_000_000 + 5000, 0, 1, 1, 1, 1, 200, 1), -1);
  assert.equal(L.point(6_000_000 - 3000, 0, 1, 1, 1, 1, 200), false);
  assert.ok(L.flash(6_000_000 + 1100, 0, 1, 1, 1, 1, 200, 1) >= 0, 'koło zasięgu dotyka kadru');
  assert.equal(L.stats.rejected, 2);
  const grid = new LightGrid();
  grid.begin(6_000_000, 0);
  L.commit(grid, 0);
  assert.equal(grid.count, 1);
  assert.equal(grid.lights[0], 1100, 'x lokalne (double na CPU)');
  assert.equal(grid.lights[LIGHT_FLOATS * 0 + 7], Math.fround(0.6));
});

test('fxLights: bez alokacji — tysiące klatek błysków, punktów, starzenia i commit', () => {
  const clock = { now: () => 0.25 };
  const carrier = { vx: 100, vy: 5, t0: 0, clock: 0 };
  const L = new FxLights({ random: new FxRandom(5), clock, carrier });
  L.setView(-5000, -5000, 5000, 5000);
  const sink = { n: 0, addWorld() { this.n++; return 0; } };
  const frame = (i) => {
    for (let k = 0; k < 8; k++) L.flash(k * 10, i % 100, 1, 0.5, 0.2, 3, 200, 0.2, 2, 0.3, 30, 0.1);
    for (let k = 0; k < 16; k++) L.point(k, -k, 1, 1, 1, 2, 100, 40);
    L.update(0.016);
    L.commit(sink, 0.5);
  };
  const empty = () => {};
  for (let i = 0; i < 30000; i++) { frame(i); empty(i); }   // rozgrzewka JIT
  const base = allocatedBytes(empty, 5000);
  const used = allocatedBytes(frame, 5000);
  assert.ok(used - base < 4096, `fxLights zaalokował ${used - base} B na 5000 klatek`);
  // kontrola metody: styl dema (obiekt światła i opcji na błysk) alokuje wyraźnie
  const demoList = [];
  const demoFrame = (i) => {
    for (let k = 0; k < 8; k++) demoList.push({ x: k, y: i, opts: { decay: 2, z: 30 } });
    if (demoList.length > 64) demoList.length = 0;
  };
  for (let i = 0; i < 2000; i++) demoFrame(i);
  assert.ok(allocatedBytes(demoFrame, 500) > 64 * 1024, 'pomiar wykrywa alokacje');
});

// --- nośnik ------------------------------------------------------------------------

test('nośnik: pola paczki z ActiveCarrier (scena: −vy, t0 względem epoki, zegar) jak Fx3D', () => {
  const P = new Float32Array(CARRIER_FLOATS * 2);
  writeCarrierPacket(P, 0, 3600, { vx: 1200, vy: 300, t0: 3610.5, clock: CLOCK_RENDER });
  assert.deepEqual(Array.from(P.subarray(0, 4)), [1200, -300, 10.5, CLOCK_RENDER]);
  writeCarrierPacket(P, 4, 3600, { vx: 0, vy: 0, t0: 9999, clock: CLOCK_RENDER });
  assert.deepEqual(Array.from(P.subarray(4, 8)), [0, -0, 0, CLOCK_SIM], 'bez prędkości: bez dużej liczby t0');
  ActiveCarrier.set({ vx: 5, vy: 6, t0: 100, clock: CLOCK_SIM });
  writeCarrierPacket(P, 0, 90);
  ActiveCarrier.clear();
  assert.deepEqual(Array.from(P.subarray(0, 4)), [5, -6, 10, CLOCK_SIM]);
  clearCarrierPacket(P, 0);
  assert.deepEqual(Array.from(P.subarray(0, 4)), [0, 0, 0, CLOCK_SIM]);
});

test('nośnik (lustro wzoru): dym z lufy okrętu 10 000 j/s zachowuje się względem okrętu jak w spoczynku', () => {
  // Okręt leci w +x świata; cząstka rodzi się w t0 z prędkością własną 300 j/s w bok
  // (scena +y) i oporem 1,15. Pozycja względem okrętu = sam ruch własny.
  const P = new Float32Array(4);
  writeCarrierPacket(P, 0, 0, { vx: 10000, vy: 0, t0: 2, clock: CLOCK_SIM });
  const out = { x: 0, y: 0 };
  for (const age of [0, 0.1, 0.5, 2]) {
    carrierPositionCpu(out, 0, 0, 0, 300, 1.15, age, P, 0, 2 + age, 2 + age);
    close(out.x - 10000 * age, 0, 1e-6, 'wzdłuż lotu: z okrętem');
    close(out.y, 300 * dragPathCpu(1.15, age), 1e-6, 'w bok: tylko ruch własny z oporem');
  }
  // Opór nie hamuje nośnika (dawny błąd pul dema: v = d·speed + vel i tłumienie całego v).
  carrierPositionCpu(out, 0, 0, 0, 0, 5, 3, P, 0, 5, 5);
  close(out.x, 30000, 1e-6);
  assert.ok(dragPathCpu(0, 2) === 2 && dragPathCpu(1e-6, 2) === 2, 'bez oporu — droga = t');
});

test('nośnik + początek + epoka: precyzja float32 przy 6 mln j. i godzinach gry (< 0,01 j.)', () => {
  const f = Math.fround;
  const tHours = 7.5 * 3600;                       // czas gry po 7,5 h
  const ship = { x: 6_123_456.3, y: -2_987_654.7, vx: 8000, vy: -3000 };
  const origin = new FxPoolOrigin();
  // Żywa pula trzyma początek i epoki (bez rejestracji przestawiałyby się co klatkę).
  origin.register({ isLive: () => true });
  // kamera przy okręcie (scena: x, −y)
  origin.update(ship.x, -ship.y, 100, tHours, tHours);
  const P = new Float32Array(4);
  writeCarrierPacket(P, 0, origin.simEpoch, { vx: ship.vx, vy: ship.vy, t0: tHours, clock: CLOCK_SIM });
  const p0x = f(origin.toLocalX(ship.x));
  const p0y = f(origin.toLocalY(ship.y));
  for (const dt of [0.016, 0.5, 1.7]) {
    const T = tHours + dt;
    origin.update(ship.x, -ship.y, 100 + dt, T, T);
    // GPU: float32 na każdym kroku (czasy uniformów i pola paczki są float32).
    const e = f(f(origin.timeSim.value) - P[2]);
    const gx = f(p0x + f(P[0] * e));
    const gy = f(p0y + f(P[1] * e));
    // Prawda (double): pozycja sceny − początek.
    const tx = ship.x + ship.vx * dt - origin.x;
    const ty = -(ship.y + ship.vy * dt) - origin.y;
    close(gx, tx, 0.01, 'x lokalne');
    close(gy, ty, 0.01, 'y lokalne');
  }
  // Bez początku i epoki float32 gubi ~0,5 j. i milisekundy czasu.
  assert.ok(Math.abs(f(ship.x) - ship.x) > 0.1);
  assert.ok(Math.abs(f(tHours + 0.016) - (tHours + 0.016)) > 1e-4);
});

test('nośnik TSL: fxCarrierOffset / fxDragPath jako czyste funkcje WGSL (uniformy parametrami)', () => {
  const origin = new FxPoolOrigin({ name: 'tstOrigin' });
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const p = fxCarriedPosition(vec2(uv().x, uv().y), vec2(3, 4), float(1.2), float(0.5), vec4(1, 2, 3, 1), origin.timeSim, origin.timeRender);
    return vec4(p.add(fxCarrierOffset(vec4(0, 1, 0, 0), origin.timeSim, origin.timeRender)), 0, 1);
  })();
  const frag = buildFragment(mat);
  const body = frag.match(/fn fxCarrierOffset[\s\S]*?\n}/)?.[0] || '';
  assert.match(body, /fn fxCarrierOffset \( carrier : vec4<f32>, timeSim : f32, timeRender : f32 \) -> vec2<f32>/);
  assert.match(body, /carrier\.w > 0\.5/);
  assert.match(body, /carrier\.xy \* vec2<f32>\( \( nodeVar0 - carrier\.z \) \)/);
  assert.doesNotMatch(body, /render\.|object\./, 'bez uniformów z domknięcia');
  assert.match(frag, /fn fxDragPath \( drag : f32, age : f32 \) -> f32/);
  assert.match(frag, /fxCarrierOffset\( vec4<f32>\( 1\.0, 2\.0, 3\.0, 1\.0 \), render\.tstOriginTimeSim, render\.tstOriginTimeRender \)/);
});

// --- początek pul GPU i epoki --------------------------------------------------------

test('FxPoolOrigin: bez żywych pul idzie za kamerą za darmo; żywe trzymają początek do 20 tys. j.', () => {
  const o = new FxPoolOrigin();
  let live = false;
  const calls = [];
  const kernel = { count: 4096 };
  o.register({ shiftNode: kernel, isLive: () => live, onRebase: (...a) => calls.push(a) });
  assert.equal(o.update(1000.4, -2000.6, 10.7, 50.2, 50.1), false, 'pierwsza klatka kotwiczy');
  assert.deepEqual([o.x, o.y, o.fxEpoch, o.simEpoch], [1000, -2001, 10, 50]);
  close(o.timeFx.value, 0.7, 1e-6); close(o.timeSim.value, 0.2, 1e-6); close(o.timeRender.value, 0.1, 1e-6);
  // pusto: przestawienie bez kerneli
  assert.equal(o.update(5000, -2001, 11, 51, 51), true);
  assert.equal(o.x, 5000);
  assert.equal(o.pending, false);
  assert.equal(o.moves, 1);
  assert.equal(calls.length, 1, 'onRebase i tak (dane CPU puli)');
  assert.deepEqual(calls[0], [1000 - 5000, 0, 10 - 11, 50 - 51]);
  // żywe: trzyma do rebaseDist
  live = true;
  assert.equal(o.update(5000 + 15000, -2001, 11.5, 51.5, 51.5), false);
  assert.equal(o.x, 5000);
  assert.equal(o.update(5000 + FX_REBASE_DIST + 1.6, -2001, 12, 52, 52), true);
  assert.equal(o.x, 5000 + FX_REBASE_DIST + 2, 'całkowity przeskok');
  assert.equal(o.dx, -(FX_REBASE_DIST + 2));
  assert.equal(o.dFx, 0, 'epoki bez zmian');
  assert.deepEqual(o.shift.value.toArray(), [o.dx, 0, 0, 0]);
  assert.equal(o.pending, true);
  assert.equal(o.rebases, 1);
  const dispatched = [];
  const fakeRenderer = { compute: (node, n) => dispatched.push([node, n]) };
  assert.equal(o.dispatch(fakeRenderer), 1);
  assert.deepEqual(dispatched, [[kernel, 4096]]);
  assert.equal(o.dispatch(fakeRenderer), 0, 'raz');
  // epoka: po FX_EPOCH_SPAN przy żywych pulach
  assert.equal(o.update(o.x, -2001, 11 + FX_EPOCH_SPAN + 0.5, 60, 60), true);
  assert.equal(o.fxEpoch, 11 + FX_EPOCH_SPAN);
  assert.equal(o.dFx, 11 - (11 + FX_EPOCH_SPAN));
  close(o.timeFx.value, 0.5, 1e-6);
  // cofnięty zegar (reset gry) też przestawia epokę
  assert.equal(o.update(o.x, -2001, 3, 60, 60), true);
  assert.equal(o.fxEpoch, 3);
});

test('FxPoolOrigin: dwa przeskoki przed dispatch() sumują przesunięcie (dane GPU nie gubią pierwszego)', () => {
  const o = new FxPoolOrigin();
  const kernel = { count: 16 };
  o.register({ shiftNode: kernel, isLive: () => true });
  o.update(0, 0, 0, 0, 0);
  o.update(30_000, 0, 1, 1, 1);
  o.update(30_000, 45_000, 2, 2, 2);
  assert.deepEqual(o.shift.value.toArray(), [-30_000, -45_000, 0, 0]);
  const calls = [];
  assert.equal(o.dispatch({ compute: (n, c) => calls.push(c) }), 1);
  assert.deepEqual(calls, [16]);
  o.update(90_000, 45_000, 3, 3, 3);
  assert.deepEqual(o.shift.value.toArray(), [-60_000, 0, 0, 0], 'po dispatch() od zera');
});

test('FxPoolOrigin + kernel przesunięcia: żywe dane zostają w miejscu świata i czasu', () => {
  const o = new FxPoolOrigin();
  const spec = { capacity: 64, stride: 3, pos: [[0, 'xy']], fxTime: [[0, 'w']], simTime: [[2, 'z']] };
  const data = new Float64Array(spec.capacity * spec.stride * 4);
  o.register({ isLive: () => true, onRebase: (dx, dy, dFx, dSim) => applyShiftCpu(data, spec, dx, dy, dFx, dSim) });
  o.update(6_000_000, 2_000_000, 1000, 5000, 5000);
  // cząstki: pozycje świata (scena) i czasy narodzin / nośnika
  const worldX = []; const worldY = []; const born = []; const t0 = [];
  for (let i = 0; i < spec.capacity; i++) {
    worldX.push(6_000_000 + i * 37.5 - 900); worldY.push(2_000_000 - i * 11.25);
    born.push(1000 - i * 0.01); t0.push(5000 - i * 0.02);
    const b = i * spec.stride * 4;
    data[b] = worldX[i] - o.x; data[b + 1] = worldY[i] - o.y; data[b + 3] = born[i] - o.fxEpoch;
    data[b + 2 * 4 + 2] = t0[i] - o.simEpoch;
  }
  o.update(6_000_000 + 35_000.3, 2_000_000 - 21_000.8, 1000 + FX_EPOCH_SPAN + 3.25, 5000 + FX_EPOCH_SPAN + 9.5, 5000 + FX_EPOCH_SPAN + 9.4);
  assert.ok(o.rebases === 1 && o.dx !== 0 && o.dy !== 0 && o.dFx !== 0 && o.dSim !== 0);
  for (let i = 0; i < spec.capacity; i++) {
    const b = i * spec.stride * 4;
    close(data[b] + o.x, worldX[i], 1e-9, 'x świata');
    close(data[b + 1] + o.y, worldY[i], 1e-9, 'y świata');
    close(data[b + 3] + o.fxEpoch, born[i], 1e-9, 'narodziny');
    close(data[b + 8 + 2] + o.simEpoch, t0[i], 1e-9, 't0 nośnika');
  }
  // przesunięcia całkowite → dokładne także we float32
  for (const d of [o.dx, o.dy, o.dFx, o.dSim]) assert.ok(Number.isInteger(d) && Math.fround(d) === d);
});

test('createShiftKernel: WGSL kernela przesunięcia (strażnik zakresu, delta z uniformu) i błędy układu', () => {
  const o = new FxPoolOrigin({ name: 'tstShift' });
  const buf = instancedArray(1000 * 3, 'vec4');
  const k = createShiftKernel(o, { buffer: buf, capacity: 1000, stride: 3, pos: [[0, 'xy'], [1, 'zw']], fxTime: [[0, 'w']], simTime: [[2, 'z']] });
  assert.equal(k.count, 1000);
  const cs = buildCompute(k);
  assert.match(cs, /if \( \( instanceIndex >= 1000u \) \)/);
  assert.match(cs, /vec4<f32>\( render\.tstShiftShift\.x, render\.tstShiftShift\.y, 0\.0, render\.tstShiftShift\.z \)/);
  assert.match(cs, /vec4<f32>\( 0\.0, 0\.0, render\.tstShiftShift\.x, render\.tstShiftShift\.y \)/);
  assert.match(cs, /vec4<f32>\( 0\.0, 0\.0, render\.tstShiftShift\.w, 0\.0 \)/);
  assert.throws(() => createShiftKernel(o, { buffer: buf, capacity: 10, stride: 1, pos: [[0, 'xy']], fxTime: [[0, 'x']] }), /dwa razy/);
  assert.throws(() => createShiftKernel(o, { buffer: buf, capacity: 10, stride: 1, pos: [[1, 'xy']] }), /poza krokiem/);
});

// --- zniekształcenia -----------------------------------------------------------------

test('zniekształcenia: pakowanie do JEDNEGO bloku — piksele względem środka (y w górę), promienie × zoom', () => {
  const F = new DistortionField();
  assert.equal(F.array.length, DISTORT_HEADER + DISTORT_STRIDE * DISTORT_CAP);
  F.begin();
  assert.ok(F.shock(6_000_100, -2_000_050, 400, 60, 12));
  assert.ok(F.implode(6_000_000, -2_000_000, 300, 20));
  assert.ok(F.heat(5_999_900, -1_999_950, 150, 3, 1, 0, 2.5, 0, 7));
  assert.equal(F.add(DISTORT.SHOCK, 0, 0, 100, 10, 0.01), false, 'za słabe');
  assert.equal(F.add(DISTORT.SHOCK, NaN, 0, 100, 10, 5), false, 'NaN');
  const n = F.commit(6_000_000, -2_000_000, 0.5, 1920, 1080, 12.5);
  assert.equal(n, 3);
  const A = F.array;
  assert.deepEqual(A[0].toArray(), [3, 12.5, 1, 0]);
  assert.deepEqual(A[1].toArray(), [1920, 1080, 0.5, 0]);
  const s0 = DISTORT_HEADER;
  assert.deepEqual(A[s0].toArray(), [50, 25, 200, 30], 'x, y [px, y w górę], R, szer.');
  assert.deepEqual(A[s0 + 1].toArray().slice(0, 3), [12, DISTORT.SHOCK, Math.fround(0.35)]);
  close(A[s0 + 1].w, (400 + 3.2 * 60) * 0.5, 1e-9, 'zasięg fali');
  const s2 = DISTORT_HEADER + 2 * DISTORT_STRIDE;
  assert.deepEqual(A[s2 + 2].toArray(), [1, 0, 2.5, 1], 'kierunek (scena), wydłużenie, skala wzoru (domyślnie 1)');
  // czas zawinięty (600 s)
  F.begin(); F.shock(6_000_000, -2_000_000, 100, 10, 5);
  F.commit(6_000_000, -2_000_000, 1, 800, 600, 1234.5);
  close(A[0].y, 34.5, 1e-9);
});

test('zniekształcenia: odrzucanie poza kadrem i wybór najsilniejszych ponad limit', () => {
  const F = new DistortionField({ cap: 4 });
  F.begin();
  F.shock(100_000, 0, 50, 10, 30);                  // daleko poza kadrem
  for (let i = 0; i < 8; i++) F.heat(i * 20, 0, 40, 1 + i);
  const n = F.commit(0, 0, 1, 800, 600, 0);
  assert.equal(n, 4);
  assert.equal(F.stats.culled, 1);
  assert.equal(F.stats.dropped, 4);
  const picked = [0, 1, 2, 3].map((k) => F.array[DISTORT_HEADER + k * DISTORT_STRIDE + 1].x);
  assert.deepEqual(picked, [8, 7, 6, 5], 'najsilniejsze');
});

test('zniekształcenia (lustro CPU): profil fali antysymetryczny wokół frontu, implozja do środka, wyłącznik', () => {
  const F = new DistortionField();
  F.begin();
  F.shock(0, 0, 200, 40, 10, 0.4);
  F.commit(0, 0, 1, 1000, 1000, 0);
  const at = (px, py) => distortionOffsetCpu(F, px, py, { x: 0, y: 0, dx: 0, dy: 0 });
  // piksel na osi +x ekranu: q = (px − 500, 500 − py)
  const out = at(500 + 200 + 0.71 * 40, 500);
  close(out.x, 10 * 2.33 * 0.71 * Math.exp(-0.71 * 0.71), 1e-6, 'maksimum ≈ siła');
  close(out.y, 0, 1e-9);
  close(out.dx, out.x * Math.fround(0.4), 1e-9, 'część z dyspersją');
  const inner = at(500 + 200 - 0.71 * 40, 500);
  close(inner.x, -out.x, 1e-6, 'antysymetria');
  assert.equal(at(500, 500 - 200).y, 0, 'na froncie zero');
  close(at(500, 500 - 200 - 30).y, -at(500, 500 - 200 + 30).y, 1e-6);
  F.begin(); F.implode(0, 0, 300, 20);
  F.commit(0, 0, 1, 1000, 1000, 0);
  assert.ok(at(500 + 150, 500).x > 0, 'implozja: próbkowanie od środka (przesunięcie na zewnątrz)');
  F.on = 0;
  F.commit(0, 0, 1, 1000, 1000, 0);
  assert.equal(at(500 + 150, 500).x, 0);
  F.on = 1;
  F.begin();
  assert.ok(F.shock(0, 0, 0, 50, 8), 'fala tuż po wybuchu: front w środku (R = 0), jak demo');
  F.commit(0, 0, 1, 1000, 1000, 0);
  assert.ok(Math.abs(at(500 + 35, 500).x) > 1);
});

test('zniekształcenia (lustro CPU): gorące powietrze bez kierunku zakotwiczone w świecie — kamera go nie przesuwa', () => {
  const F = new DistortionField();
  const worldPoint = { x: 6_000_030, y: -1_000_020 };
  const sample = (camX, camY, zoom) => {
    F.begin();
    F.heat(6_000_000, -1_000_000, 120, 4);
    F.commit(camX, camY, zoom, 1600, 900, 3.7);
    const px = 800 + (worldPoint.x - camX) * zoom;
    const py = 450 + (worldPoint.y - camY) * zoom;
    return distortionOffsetCpu(F, px, py);
  };
  const a = { ...sample(6_000_000, -1_000_000, 1) };
  const b = { ...sample(6_000_210, -999_870, 1) };
  close(a.x, b.x, 1e-6); close(a.y, b.y, 1e-6);
  assert.ok(Math.hypot(a.x, a.y) > 0.1, 'jest przesunięcie');
  // z kierunkiem: maska wydłużona w dół strumienia
  F.begin();
  F.heat(0, 0, 100, 4, 1, 0, 3, 0, 1);
  F.commit(0, 0, 1, 1000, 1000, 0);
  const down = distortionOffsetCpu(F, 500 + 250, 500);
  const up = distortionOffsetCpu(F, 500 - 250, 500);
  assert.ok(Math.hypot(down.x, down.y) > 0 || Math.hypot(up.x, up.y) === 0);
  assert.equal(Math.hypot(up.x, up.y), 0, 'pod prąd poza maską');
});

test('zniekształcenia TSL: jeden bufor uniformów w passie, pętla po źródłach, próbkowanie z dyspersją', () => {
  const F = new DistortionField({ name: 'tstDistort' });
  const tex = texture(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const off = distortionOffset(F.node, screenUV);
    return vec4(sampleDistorted(tex, screenUV, off), 1.0);
  })();
  const frag = buildFragment(mat);
  assert.equal((frag.match(/var<uniform> tstDistort\b/g) || []).length, 1);
  assert.ok((frag.match(/var<uniform>/g) || []).length <= 2, 'limit 12 buforów uniform na etap');
  assert.match(frag, /for \( var distortItem : i32 = 0; distortItem < i32\( nodeVar\d+\.x \)/);
  assert.equal((frag.match(/texture(Sample|Load)\(/g) || []).length, 3, 'r / g / b osobno (dyspersja)');
  assert.doesNotMatch(frag, /pow\(/, 'bez pow (ujemna podstawa → NaN)');
});

// --- szumy ---------------------------------------------------------------------------

function fnv(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

test('szumy: dane bit w bit jak w demach (dema/bronie-webgpu/noise.js, dema/rakiety-webgpu/noiseTex.js)', () => {
  // Sumy z danych równych demom (sprawdzone porównaniem z modułami dem, 2026-09-27).
  assert.equal(fnv(bakeTile2D(256)), 'a2e365bc');
  assert.equal(fnv(bakeCloud2D(256)), '292bf725');
  assert.equal(fnv(bakeNoise3D(64)), 'd5308ab2');
  assert.equal(fnv(bakeCurl3D(64)), '411bbae2');
});

test('szumy: kafelkowe (brzeg jak wnętrze), zakresy, tekstury i jedna wspólna instancja', () => {
  const N = 64;
  const tile = bakeTile2D(N);
  // skok przez szew (x = N − 1 → 0) nie większy niż typowy skok sąsiadów
  let inner = 0; let seam = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N - 1; x++) inner = Math.max(inner, Math.abs(tile[(y * N + x) * 4] - tile[(y * N + x + 1) * 4]));
    seam = Math.max(seam, Math.abs(tile[(y * N + N - 1) * 4] - tile[(y * N) * 4]));
  }
  assert.ok(seam <= inner * 1.5 + 2, `szew ${seam} vs wnętrze ${inner}`);
  const curl = bakeCurl3D(16);
  let rms = 0;
  for (let i = 0; i < 16 ** 3; i++) rms += curl[i * 4] ** 2 + curl[i * 4 + 1] ** 2;
  close(Math.sqrt(rms / 16 ** 3), 1, 1e-3, 'pole wirowe znormalizowane (RMS 1)');
  const t2 = createTile2DTexture(32);
  assert.equal(t2.wrapS, THREE.RepeatWrapping);
  assert.equal(t2.colorSpace, THREE.NoColorSpace);
  const c3 = createCurl3DTexture(8);
  assert.equal(c3.type, THREE.HalfFloatType);
  assert.equal(c3.wrapR, THREE.RepeatWrapping);
  assert.equal(fxNoise.tile2D(), fxNoise.tile2D(), 'wspólna instancja');
  fxNoise.dispose();
});
