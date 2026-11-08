// Drobiny przylotów i odlotów NPC (src/3d/warp/sparkRecipes.js + sparks.js, 2026-11-08 — decyzja użytkownika: drobiny
// „niewrażliwe”, więcej, każdy okręt ma swoje): receptury rekordów w fazach przylotu i odlotu (nić zwiastuna, ślad wlotu,
// snop hamowania; punkt zbierania, ślad rozpędu, wystrzał w punkcie skoku), przylot NPC bez przegródek ośrodka (ośrodek
// śpi), dawny wygląd z `?warpDrobiny=0`, lustro CPU toru (narodziny za rufą w chwili przejścia, tor zależy tylko od
// rekordu), mgła wojny, odcinanie do kadru, liczba drobin z presetu, WGSL zbudowany w Node (limity, bez NaN-owych
// operacji) i strażnik szwu (bez Math.random, window, DOM).
// node --test tests/warpSparks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WARP_SPARKS, parseWarpSparks, setWarpSparks, warpSparksOn, sparkPositionCpu, sparksArrivalTrail
} from '../src/3d/warp/sparkRecipes.js';
import { WarpSparks, SPARK_STRIDE, SPARK_CAP, SPARK_RENDER_ORDER, SPARK_Z, sparksPerRecord } from '../src/3d/warp/sparks.js';
import { WarpFrame, WARP_FRAME_CAPS } from '../src/3d/warp/frame.js';
import { GLOW_RENDER_ORDER } from '../src/3d/warp/sprites.js';
import { planWarpArrivalFx, planWarpDepartureFx, warpArrivalFxState, warpDepartureFxState } from '../src/3d/warp/arrivals.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

function arrival(o = {}) {
  return planWarpArrivalFx({ x: 1000, y: -400, angle: 0.4, hullLength: 192, hullWidth: 80, startTime: 0, palette: 'magenta', pirate: true, ...o });
}
function pose(a, t) {
  // poza okrętu z osi (drive): w wlocie stała prędkość, potem zatrzymanie w (x, y)
  const tau = t - a.tAppear;
  const along = Math.min(a.v0 * Math.max(0, tau), a.rushDist);
  const sp = t < a.tBrake ? a.v0 : 0;
  return { x: a.x0 + a.dirX * along, y: a.y0 + a.dirY * along, angle: a.angle, vx: a.dirX * sp, vy: a.dirY * sp, visible: true };
}
function step(a, t, sparks, frame = new WarpFrame()) {
  frame.reset();
  warpArrivalFxState(a, t, frame, 0, 0, t >= a.tAppear ? pose(a, t) : null, a, null, sparks);
  return frame;
}

test('przylot z drobinami: nić zwiastuna, ślad wlotu i snop hamowania — bez przegródek ośrodka', () => {
  const a = arrival();
  const seen = { herald: 0, trail: 0, brake: 0 };
  for (let t = 0; t <= a.tEnd; t += 1 / 60) {
    const f = step(a, t, true);
    assert.equal(f.bubbles.length, 0, `t=${t.toFixed(2)}: ośrodek nie dostaje przegródek (nic go nie budzi)`);
    for (let i = 0; i < f.sparks.count; i++) {
      const r = f.sparks.items[i];
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.age) && Number.isFinite(r.gain), 'rekord skończony');
      assert.ok(r.reach > 0, 'zasięg do odcinania');
      if (r.mode === 1) seen.herald++;
      else if (r.dist > 0) seen.trail++;
      else seen.brake++;
    }
    assert.ok(f.sparks.count <= 3, 'najwyżej 3 rekordy na okręt');
  }
  assert.ok(seen.herald > 0, 'nić zwiastuna');
  assert.ok(seen.trail > 0, 'ślad wlotu');
  assert.ok(seen.brake > 0, 'snop hamowania');
});

test('dawny wygląd (`?warpDrobiny=0`): przegródki ośrodka, bez drobin; przełącznik z adresu', () => {
  const a = arrival();
  let bubbles = 0;
  for (let t = 0; t <= a.tStop + 0.3; t += 1 / 60) {
    const f = step(a, t, false);
    bubbles += f.bubbles.length;
    assert.equal(f.sparks.count, 0);
  }
  assert.ok(bubbles > 0);
  assert.equal(parseWarpSparks(''), true, 'domyślnie drobiny');
  assert.equal(parseWarpSparks('?dev=1&warpDrobiny=0'), false);
  assert.equal(parseWarpSparks('?warpDrobiny=1'), true);
  setWarpSparks(false);
  assert.equal(warpSparksOn('?warpDrobiny=1'), false, 'wymuszenie');
  setWarpSparks(null);
  assert.equal(warpSparksOn('?warpDrobiny=0'), false);
  assert.equal(warpSparksOn(''), true);
});

test('odlot z drobinami: punkt zbierania w ładowaniu, ślad rozpędu, wystrzał w punkcie skoku — bez przegródek', () => {
  const d = planWarpDepartureFx({ x: 0, y: 0, angle: -1.1, hullLength: 360, hullWidth: 140, startTime: 0, palette: 'terran' });
  const seen = { gather: 0, wake: 0, gone: 0 };
  const f = new WarpFrame();
  for (let t = 0; t <= d.tEnd; t += 1 / 60) {
    f.reset();
    const ship = t < d.tGone ? { x: d.x, y: d.y, angle: d.angle, vx: 0, vy: 0, visible: true } : null;
    warpDepartureFxState(d, t, f, 0, 0, ship, d, null, true);
    assert.equal(f.bubbles.length, 0, 'bez przegródek ośrodka');
    for (let i = 0; i < f.sparks.count; i++) {
      const r = f.sparks.items[i];
      if (r.mode === 1) seen.gather++;
      else if (r.dist > 0) { seen.wake++; assert.ok(Math.abs(r.p - 1 / 3) < 1e-9, 'rozpęd ∝ t³'); }
      else seen.gone++;
    }
  }
  assert.ok(seen.gather > 0 && seen.wake > 0 && seen.gone > 0, JSON.stringify(seen));
  // drobiny odlotu gasną przed końcem osi (rekord rejestru znika w tEnd)
  const T = WARP_SPARKS;
  assert.ok(T.goneLife[1] + 0.04 <= d.tEnd - d.tGone, 'wystrzał przed końcem osi');
});

test('mgła wojny: ukryta encja bez drobin, częściowo widoczna — jasność × widoczność', () => {
  const a = arrival();
  const t = a.tBrake + 0.05;
  const f = new WarpFrame();
  const full = (vis) => {
    f.reset();
    a.swVis = vis;
    warpArrivalFxState(a, t, f, 0, 0, pose(a, t), a, null, true);
    let g = 0;
    for (let i = 0; i < f.sparks.count; i++) g += f.sparks.items[i].gain;
    return { n: f.sparks.count, g };
  };
  const one = full(1);
  assert.ok(one.n >= 2);
  assert.equal(full(0).n, 0, 'ukryta — nic');
  const half = full(0.5);
  assert.ok(Math.abs(half.g - one.g * 0.5) < 1e-9, 'połowa widoczności — połowa jasności');
  a.swVis = 1;
});

test('lustro toru: drobina śladu rodzi się za rufą w chwili przejścia okrętu; tor zależy tylko od rekordu', () => {
  const a = arrival();
  const f = new WarpFrame();
  const V = a.v0;
  const dist = a.v0 * a.coast;
  const t = a.tAppear + a.coast * 0.8;
  const r = sparksArrivalTrail(f, a, t, a.x0, a.y0, V, dist, dist, 1, 0, 0, 5);
  assert.ok(r);
  let born = 0;
  for (let n = 0; n < 200; n++) {
    const h = Array.from({ length: 8 }, (_, k) => ((n * 8 + k) * 0.6180339887) % 1);
    const along = r.dist * Math.pow(h[0], r.shape);
    const tb = r.T * (along / r.dist) + h[1] * r.jit;
    // w chwili narodzin: punkt za rufą okrętu (środek okrętu w tej chwili − back), rozsiany w poprzek ±W
    const p0 = sparkPositionCpu(r, h, tb + 1e-9);
    const ship = pose(a, a.tAppear + tb - h[1] * r.jit);
    const dx = p0.x - (ship.x - a.dirX * r.back);
    const dy = p0.y - (ship.y - a.dirY * r.back);
    const alongErr = dx * a.dirX + dy * a.dirY;
    const across = -dx * a.dirY + dy * a.dirX;
    assert.ok(Math.abs(alongErr) < 1e-3 + V * h[1] * r.jit + 1e-6, `drobina ${n}: wzdłuż ${alongErr}`);
    assert.ok(Math.abs(across) <= r.W + 1e-6, `drobina ${n}: w poprzek ${across}`);
    if (sparkPositionCpu(r, h, r.age).alive) born++;
    // ta sama drobina, ten sam wiek → to samo miejsce (bez stanu: nic jej nie popycha)
    const q1 = sparkPositionCpu(r, h, r.age);
    const q2 = sparkPositionCpu({ ...r }, h, r.age);
    assert.equal(q1.x, q2.x);
    assert.equal(q1.y, q2.y);
  }
  assert.ok(born > 20, `żyje część drobin (${born})`);
  // opór: drobina zwalnia, droga ograniczona v · τ
  const h = [0.5, 0, 0.99, 0.5, 0.9, 0.5, 0.9, 1];
  const a1 = sparkPositionCpu(r, h, r.T * Math.pow(0.5, r.shape) + 0.3);
  const a2 = sparkPositionCpu(r, h, r.T * Math.pow(0.5, r.shape) + 0.9);
  const a3 = sparkPositionCpu(r, h, r.T * Math.pow(0.5, r.shape) + 50);
  const d12 = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  const d23 = Math.hypot(a3.x - a2.x, a3.y - a2.y);
  assert.ok(d23 < r.v1 * r.drag + V * r.carry * r.drag, 'droga ograniczona');
  assert.ok(Number.isFinite(d12));
});

test('pula klatki i siatka: odcinanie do kadru, liczba instancji = rekordy × K, jasność z gęstości', () => {
  assert.equal(WARP_FRAME_CAPS.sparks, SPARK_CAP);
  const f = new WarpFrame();
  for (let i = 0; i < SPARK_CAP + 5; i++) {
    const r = f.addSparks();
    if (i < SPARK_CAP) assert.ok(r); else assert.equal(r, null, 'pełna pula');
    if (!r) continue;
    r.gain = 1; r.reach = 100; r.x = i < 10 ? 0 : 1e6; r.y = 0;
  }
  const sp = new WarpSparks();
  sp.setPerRecord(2048);
  sp.commit(f, 0, 0, 0.2, 5000, 3000);
  assert.equal(sp.count, 10, 'rekordy poza kadrem odcięte');
  assert.equal(sp.geo.instanceCount, 10 * 2048);
  assert.equal(sp.mesh.visible, true);
  // pakowanie: y w górę (scena)
  const A = sp.slots.array;
  assert.equal(A.length, SPARK_CAP * SPARK_STRIDE);
  f.reset();
  sp.commit(f, 0, 0, 0.2, 5000, 3000);
  assert.equal(sp.mesh.visible, false, 'bez rekordów — schowana');
  assert.equal(sp.geo.instanceCount, 0);
  // preset: niski < średni < wysoki, 1024…4096
  const lo = sparksPerRecord(400000);
  const mid = sparksPerRecord(700000);
  const hi = sparksPerRecord(1000000);
  assert.ok(lo >= 1024 && lo < mid && mid < hi && hi <= 4096, `${lo} ${mid} ${hi}`);
  sp.setPerRecord(4096);
  assert.ok(sp.U.kGain.value < 1, 'więcej drobin — każda ciemniejsza');
  // kolejność: przed błyskami warpa
  assert.ok(SPARK_RENDER_ORDER < GLOW_RENDER_ORDER);
  assert.equal(sp.mesh.layers.mask, 1, 'warstwa 0 (pass gry)');
});

// ── WGSL w Node (bez GPU) ──────────────────────────────────────────────────────────────────────────────────────────

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('WGSL: jeden blok rekordów, w limitach, bez log / atan; pow tylko z haszu i ułamka drogi (≥ 0); stały kod', () => {
  const sp = new WarpSparks();
  const w = buildMesh(sp.mesh);
  for (const s of [w.vertex, w.fragment]) {
    assert.ok((s.match(/var<uniform>/g) || []).length <= 12, 'bufory uniformów');
    assert.doesNotMatch(s, /\blog\(|\blog2\(|\batan2?\(|inverseSqrt\(/);
  }
  assert.match(w.vertex, /warpSparkSlots/, 'blok rekordów ze stałą nazwą');
  assert.ok((w.vertex.match(/@location\( ?\d+ ?\) [A-Za-z_]+ : /g) || []).length <= 8, 'wejścia wierzchołków');
  // ten sam graf w drugim egzemplarzu → ten sam kod (jeden pipeline)
  const w2 = buildMesh(new WarpSparks().mesh);
  assert.equal(w2.vertex, w.vertex);
  assert.equal(w2.fragment, w.fragment);
  const mat = sp.material;
  assert.equal(mat.forceSinglePass, true);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.depthTest, true, 'pod kadłubami — test głębi');
  assert.ok(SPARK_Z < 0, 'pod płaszczyzną kadłubów');
  assert.equal(mat.blendSrc, THREE.OneFactor);
  assert.equal(mat.blendDst, THREE.OneFactor);
  assert.equal(mat.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(mat.blendDstAlpha, THREE.OneFactor);
  assert.equal(sp.mesh.frustumCulled, false);
});

test('szew renderu: moduły drobin bez Math.random, window, DOM i importów src/game', () => {
  for (const p of ['src/3d/warp/sparks.js', 'src/3d/warp/sparkRecipes.js']) {
    const c = code(p);
    assert.doesNotMatch(c, /Math\.random/, `${p}: losowość z haszu`);
    assert.doesNotMatch(c, /\bwindow\b|\bdocument\b/, `${p}: bez window / DOM`);
    assert.doesNotMatch(c, /from '\.\.\/\.\.\/game\//, `${p}: bez importów gry`);
  }
  // sterownik: drobiny rejestrowane w rozgrzewce, przekazywane do wyglądu przylotów i odlotów
  const n = code('src/3d/warp/warpNurt.js');
  assert.match(n, /warmup\?\.add\(\{ name: 'warp: drobiny przylotu'[^}]*variant: WARIANT_INSTANCJI/);
  assert.match(n, /warpArrivalFxState\([^)]*, sparks\)/);
  assert.match(n, /warpDepartureFxState\([^)]*, sparks\)/);
});
