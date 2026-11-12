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
  WARP_SPARKS, WARP_SPARK_STYLES, parseWarpSparks, setWarpSparks, warpSparksOn, sparkPositionCpu, sparksArrivalTrail,
  warpSparkStyle, arcOffset, flickerK
} from '../src/3d/warp/sparkRecipes.js';
import { WarpSparks, SPARK_STRIDE, SPARK_CAP, SPARK_RENDER_ORDER, SPARK_Z, sparksPerRecord } from '../src/3d/warp/sparks.js';
import { WarpFrame, WARP_FRAME_CAPS } from '../src/3d/warp/frame.js';
import { GLOW_RENDER_ORDER } from '../src/3d/warp/sprites.js';
import { planWarpArrivalFx, planWarpDepartureFx, warpArrivalFxState, warpDepartureFxState } from '../src/3d/warp/arrivals.js';
import { WARP_SW } from '../src/3d/warp/warpSW.js';

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

test('styl frakcji: piraci — czerwień, migotanie, łuk nici, szerszy snop, grubsze iskry; Terra Nova — czysto (z osi)', () => {
  const pir = arrival({ pirate: true });
  const tn = arrival({ pirate: false, palette: 'terran' });
  assert.equal(warpSparkStyle(pir), WARP_SPARK_STYLES.pirate);
  assert.equal(warpSparkStyle(tn), WARP_SPARK_STYLES.clean);
  assert.equal(warpSparkStyle({ faction: 'pirate' }), WARP_SPARK_STYLES.pirate);
  assert.equal(warpSparkStyle(null), WARP_SPARK_STYLES.clean);
  const P = WARP_SPARK_STYLES.pirate;
  assert.ok(P.front[0] > 0.9 && P.front[1] < 0.2 && P.front[2] < 0.2, 'piraci — czerwień');
  const C = WARP_SPARK_STYLES.clean;
  assert.ok(C.front[2] > C.front[0], 'Terra Nova — turkus');
  // ta sama chwila, ten sam układ rekordów — inny charakter
  const recs = (a, t) => {
    const f = step(a, t, true);
    return Array.from({ length: f.sparks.count }, (_, i) => ({ ...f.sparks.items[i], c0: [...f.sparks.items[i].c0], c1: [...f.sparks.items[i].c1] }));
  };
  const th = (pir.t0 + pir.tAppear) * 0.5;
  const hp = recs(pir, th).find((r) => r.mode === 1);
  const hc = recs(tn, th).find((r) => r.mode === 1);
  assert.ok(hp && hc, 'nić zwiastuna w obu');
  assert.ok(hp.arcAmp > 0 && hp.arcRate > 0 && hp.flicker > 0, 'piraci — łuk nici i migotanie');
  assert.equal(hc.arcAmp, 0);
  assert.equal(hc.flicker, 0, 'Terra Nova — bez migotania');
  assert.ok(hp.W > hc.W && hp.size > hc.size, 'piraci — szersza nić, grubsze iskry');
  assert.ok(hp.c1[0] > hp.c1[2] && hc.c1[2] > hc.c1[0], 'barwy nici');
  const tb = pir.tBrake + 0.05;
  const bp = recs(pir, tb).find((r) => r.mode === 0 && r.dist === 0);
  const bc = recs(tn, tn.tBrake + 0.05).find((r) => r.mode === 0 && r.dist === 0);
  assert.ok(bp && bc && bp.cone > bc.cone && bp.ring > bc.ring, 'piraci — szerszy, poszarpany snop');
  // łuk: prosta nić bez przesunięcia; piraci — zygzak ograniczony amplitudą, gaśnie przy punkcie, przeskakuje w czasie
  assert.equal(arcOffset(hc, 500, 0.3), 0);
  let maxZ = 0;
  for (let d = 0; d < hp.dist; d += hp.arcWave / 7) maxZ = Math.max(maxZ, Math.abs(arcOffset(hp, d, 0.3)));
  assert.ok(maxZ > hp.arcAmp * 0.5 && maxZ <= hp.arcAmp + 1e-9, `amplituda łuku ${maxZ}`);
  assert.ok(Math.abs(arcOffset(hp, 0, 0.3)) < 1e-9, 'w punkcie zbierania łuk zbiega do osi');
  const d0 = hp.arcWave * 3.3;
  assert.notEqual(arcOffset(hp, d0, 0.30), arcOffset(hp, d0, 0.30 + 1 / hp.arcRate), 'kształt przeskakuje');
  assert.equal(arcOffset(hp, d0, 0.30), arcOffset(hp, d0, 0.30 + 0.2 / hp.arcRate * 0.1), 'między przeskokami stoi');
  // migotanie: Terra Nova 1, piraci w [1 − flicker, 1]
  const h = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  assert.equal(flickerK(hc, h, 0.5), 1);
  let lo = 1;
  for (let t = 0; t < 1; t += 0.01) lo = Math.min(lo, flickerK(hp, h, t));
  assert.ok(lo < 0.7 && lo >= 1 - hp.flicker - 1e-9, `migotanie ${lo}`);
  // wygląd „jak w Gwiezdnych Wojnach”: smuga i kadłub ze światła w barwie frakcji
  const swAt = (ax) => {
    const f = new WarpFrame();
    const t = ax.tAppear + ax.coast * 0.6;
    warpArrivalFxState(ax, t, f, 0, 0, pose(ax, t), ax, WARP_SW, true);
    return { s: f.streaks.items[0], hull: ax.hull, n: f.streaks.count };
  };
  const sp = swAt(pir);
  const sc = swAt(tn);
  assert.ok(sp.n === 1 && sc.n === 1, 'smuga za rufą');
  assert.ok(sp.s.r > sp.s.b * 3, 'piraci — czerwona smuga');
  assert.ok(sc.s.b > sc.s.r, 'Terra Nova — biało-błękitna smuga');
  assert.ok(sp.hull.seamRGB[0] > sp.hull.seamRGB[2] * 3, 'piraci — kadłub ze światła czerwony');
  // odlot piratów — ten sam styl
  const d = planWarpDepartureFx({ x: 0, y: 0, angle: 0.3, hullLength: 360, hullWidth: 140, startTime: 0, palette: 'crimson', pirate: true });
  assert.equal(warpSparkStyle(d), WARP_SPARK_STYLES.pirate);
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
  // preset: niski < średni < wysoki, 768…2560 (delikatniej — user 2026-11-08)
  const lo = sparksPerRecord(400000);
  const mid = sparksPerRecord(700000);
  const hi = sparksPerRecord(1000000);
  assert.ok(lo >= 768 && lo < mid && mid < hi && hi <= 2560, `${lo} ${mid} ${hi}`);
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
