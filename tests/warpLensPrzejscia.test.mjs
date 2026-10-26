// Soczewka świata — przejścia i przylot po recenzji etapu „M-mapa” (2026-10-26): cel na tle (perspektywa i paralaksa
// w kadrze przylotu, zbieżność na skali prawdziwego obrazu), podłoga celu po zatrzymaniu (kamera bez K1), przerwane
// ładowanie i wyjście bez rampy (stan minimalny osi β), wyjście w trakcie kopu, stożek przy zanurzaniu, ciało gotowe
// w trakcie skoku, decyzja wejścia w kadrze skoku, zbieżność w czasie (60 / 240 Hz), kieszeń przy pierścieniu, kotwica;
// mapa O1 (DECYZJE-2 O1-2): ciało startu z dokiem w kadrze wylatuje dołem kadru i znika (P4 w ładowaniu, kopie i locie).
// node --test tests/warpLensPrzejscia.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_LENS_DEFAULTS, WORLD_LENS_MODE, WarpWorldLens, newLensBody, lensDiscInFrame, WARP_WORLD_LENS,
  resetWarpWorldLens, setWarpLensAnchor, warpLensQ, warpLensFrame, newWarpLensFrame
} from '../src/3d/warp/worldLens.js';
import {
  WARP_ARRIVAL_FRAME, warpArrivalZoom, warpArrivalScale, warpArrivalCapZoom, warpPerspScale, warpArrivalSoftMin,
  warpViewEdgePx
} from '../src/render/warpArrivalFrame.js';
import {
  WARP_LENS_PHASE, warpLensBeta, warpLensKickBeta, warpLensHudBeta, createWarpLensTrack, stepWarpLensTrack,
  warpLensExitBeta
} from '../src/render/warpLensPhase.js';
import { CAMERA_RIG_DEFAULTS } from '../src/game/cameraRig.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const FOCAL = 540 / Math.tan(17.5 * Math.PI / 180);
const perspFlat = (zoom, depth) => FOCAL / (FOCAL / zoom + depth);   // planet3d.assets.js: focal / (camZ − z)
const baseCtx = (extra = {}) => ({
  beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, roll: 0, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189,
  anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, exitHalt: 1.33, exitSlow: 0.7,
  arriving: null, targetHold: 0, focal: FOCAL, ...extra
});

test('kadr przylotu celu na tle: brzeg PRAWDZIWEGO obrazu (perspektywa wokół środka kadru) na fill drogi statek → krawędź; nieosiągalny — zoomMax; skala obrazu po miękkim minimum z kadrem skoku', () => {
  const fill = WARP_ARRIVAL_FRAME.fill;
  for (const [edge, ce] of [[729, 540], [600, 540], [960, 960]]) {
    for (const depth of [50000, 60000]) {
      const k = depth / FOCAL;
      for (const gap of [20000, 40000, 2e5]) {
        const z = warpArrivalZoom(edge, gap, fill, k, ce);
        if (z >= WARP_ARRIVAL_FRAME.zoomMax) continue;
        // Statek za środkiem kadru o ys = edge − ce (kurs w górę); obraz tła: środek ys · m − D · fl, m = fl / z.
        const fl = warpPerspScale(z, k);
        assert.ok(near(fl, perspFlat(z, depth), 1e-12 * fl), 'skala perspektywy = planet3d');
        const ys = edge - ce;
        const r = 16650;
        const nearEdgeY = ys * (fl / z) - gap * fl;      // (D − r) · fl od środka obrazu
        assert.ok(near(ys - nearEdgeY, fill * edge, 1e-6), `brzeg obrazu ${(ys - nearEdgeY).toFixed(3)} px (krawędź ${edge}, gap ${gap})`);
        assert.ok(r > 0);
      }
    }
  }
  // Płaszczyzna gry — dawny wzór; tło bliżej niż k · (ce − (1 − fill) · edge) — żaden zoom (kamera stanie na kadrze skoku).
  assert.equal(warpArrivalZoom(729, 20000, fill, 0, 540), 729 * fill / 20000);
  assert.equal(warpArrivalZoom(729, 5000, fill, 50000 / FOCAL, 540), WARP_ARRIVAL_FRAME.zoomMax);
  const cap = 0.2133;
  const zc = warpArrivalCapZoom(WARP_ARRIVAL_FRAME.zoomMax, cap);
  assert.ok(zc < cap && zc > cap * 0.9, 'miękkie minimum z kadrem skoku (kamera)');
  assert.ok(near(Math.log(zc), Math.log(cap) + warpArrivalSoftMin(Math.log(WARP_ARRIVAL_FRAME.zoomMax / cap)), 1e-12));
  assert.ok(near(warpArrivalScale(729, 5000, fill, 50000 / FOCAL, 540, cap), perspFlat(zc, 50000), 1e-12), 'z_v = skala obrazu przy zoomie kamery');
  assert.equal(warpArrivalScale(729, 20000), warpArrivalZoom(729, 20000), 'płaszczyzna bez kadru skoku — dokładnie kadr przylotu');
});

// Przylot do celu na tle (Saturn, z = −50 000): kamera jak cameraRig po integracji (warpArrivalZoom z depthK, miękkie
// minimum z kadrem skoku, sprężyna log ω 3 / 9 1/s).
function bgArrival({ camera = 'perspektywa', zoomRef = 0.2133, floorCam = 0, stopAt = 6.33 } = {}) {
  const lens = new WarpWorldLens();
  const ctx = baseCtx({ zoom: 0.1173, zoomRef });
  const sat = Object.assign(newLensBody('saturn', 'planet'), { x: 0, y: 0, r: 16650, z: -50000, rExt: 16650 * 1.77, ready: true });
  const k = 50000 / FOCAL;
  ctx.exitAge = 0;
  let prev = null;
  let worstShrink = 0;
  let worstMove = 0;
  let worstGrow = 0;
  let rel = -1;
  let shrinkHold = 0;
  for (let i = 0; i < 700; i++) {
    const age = ctx.exitAge;
    const gap = age < 1.33 ? 84000 - 80000 * age / 1.33 : Math.max(2600, 4000 - (age - 1.33) * 300);
    ctx.arriving = age >= 1.33 && age < stopAt;
    sat.y = -(gap + sat.r);
    sat.flat = perspFlat(ctx.zoom, 50000);
    lens.update([sat], 1, ctx, sat);
    const o = sat.out;
    if (prev && lensDiscInFrame(o.x, o.y, o.size, 1920, 1080)) {
      const sh = (prev.size - o.size) / prev.size;
      worstShrink = Math.max(worstShrink, sh);
      if (ctx.targetHold >= 1) shrinkHold = Math.max(shrinkHold, sh);
      worstGrow = Math.max(worstGrow, o.size - prev.size);
      worstMove = Math.max(worstMove, Math.hypot(o.x - prev.x, o.y - prev.y));
    }
    if (rel < 0 && ctx.targetHold < 1) rel = age;
    prev = { x: o.x, y: o.y, size: o.size };
    const edge = warpViewEdgePx(0, -1, 960, 540, ctx.shipSx, ctx.shipSy);
    let goal;
    if (camera === 'perspektywa') goal = warpArrivalCapZoom(warpArrivalZoom(edge, gap, WARP_ARRIVAL_FRAME.fill, k, 540), zoomRef);
    else goal = warpArrivalCapZoom(warpArrivalZoom(edge, gap, WARP_ARRIVAL_FRAME.fill), zoomRef);   // kamera dziś (płaszczyzna)
    if (floorCam > 0) goal = Math.max(goal, floorCam);
    const lg = Math.log(goal);
    const om = lg > Math.log(ctx.zoom) ? 9 : 3;
    ctx.zoom = Math.exp(Math.log(ctx.zoom) + (lg - Math.log(ctx.zoom)) * (1 - Math.exp(-om * ctx.dt)));
    ctx.exitAge += ctx.dt;
  }
  return { lens, ctx, sat, worstShrink, shrinkHold, worstMove, worstGrow, rel };
}

test('cel NA TLE (recenzja ust. 1): z_v w perspektywie celu — kamera kadru przylotu zbiega, puszczenie bez malenia (Saturn: dawniej 461 → 295 px)', () => {
  const R = bgArrival();
  assert.ok(R.rel > 1.33 && R.rel < 6.33, `puszczenie po rampie przez zbieżność kamery, przed zatrzymaniem (${R.rel.toFixed(2)} s)`);
  assert.ok(R.shrinkHold < 1e-9, `cel nie maleje w trzymaniu (${(R.shrinkHold * 100).toFixed(3)}%/kl.)`);
  assert.ok(R.worstShrink < 0.005, `puszczenie — maleje ≤ 0,5%/kl. (${(R.worstShrink * 100).toFixed(2)}%)`);
  assert.ok(R.worstMove < 60 && R.worstGrow < 50, `bez skoków (${R.worstMove.toFixed(1)} px, Δr ${R.worstGrow.toFixed(1)} px)`);
  assert.equal(R.ctx.targetHold, 0);
  assert.ok(near(R.sat.out.size, R.sat.r * R.sat.flat, 1e-9), 'po puszczeniu prawdziwy obraz');
  // Kamera dziś (kadr przylotu w płaszczyźnie gry): cel i tak nie maleje ponad 2%/kl. (P4 / C5).
  const D = bgArrival({ camera: 'plaszczyzna' });
  assert.ok(D.worstShrink < 0.02, `kamera dziś — maleje ≤ 2%/kl. (${(D.worstShrink * 100).toFixed(2)}%)`);
});

test('podłoga celu po zatrzymaniu (recenzja ust. 4): kamera przybliża ponad podgląd (bez K1 — powrót do zoomu gracza) — cel jedzie z prawdziwym obrazem, puszczenie przez zbieżność, bez zamrożenia i skoku', () => {
  const lens = new WarpWorldLens();
  const ctx = baseCtx({ zoom: 0.03 });
  const jup = Object.assign(newLensBody('jupiter', 'planet'), { x: 0, y: -(20000 + 48000), r: 48000, ready: true });
  ctx.exitAge = 1.4;   // po rampie (tHalt 1,33)
  let prev = null;
  let worstJump = 0;
  let worstShrink = 0;
  let rel = -1;
  for (let i = 0; i < 400; i++) {
    // kamera: kadr przylotu (0,0273) do 2,5 s, potem powrót do zoomu gracza 0,17 w 1,4 s (easeOut³ — rig dziś)
    const a = ctx.exitAge;
    const u = Math.min(1, Math.max(0, (a - 2.5) / 1.4));
    const e = 1 - (1 - u) ** 3;
    ctx.zoom = Math.exp(Math.log(0.0273) + e * Math.log(0.17 / 0.0273));
    jup.flat = ctx.zoom;
    ctx.arriving = a < 2.4;
    lens.update([jup], 1, ctx, jup);
    const o = jup.out;
    if (prev) {
      worstJump = Math.max(worstJump, Math.abs(o.size - prev.size) / Math.max(1, prev.size) - Math.abs(Math.log(ctx.zoom / prev.zoom)));
      worstShrink = Math.max(worstShrink, (prev.size - o.size) / prev.size);
    }
    if (rel < 0 && ctx.targetHold < 1) rel = a;
    prev = { size: o.size, zoom: ctx.zoom };
    ctx.exitAge += ctx.dt;
  }
  assert.ok(rel > 0 && rel < 2.4 + WORLD_LENS_DEFAULTS.arrivalStopGrace + 1, `puszczenie przez zbieżność (podłoga), nie po zatrzymaniu + zapas (${rel.toFixed(2)} s)`);
  assert.ok(worstShrink < 0.02, `bez malenia > 2%/kl. (${(worstShrink * 100).toFixed(2)}%)`);
  assert.ok(worstJump < 0.06, `promień zmienia się z kamerą, bez skoku (${(worstJump * 100).toFixed(2)}% ponad zoom)`);
  assert.ok(near(jup.out.size, jup.r * jup.flat, 1e-9), 'koniec — prawdziwy obraz');
});

test('oś β: przerwane ładowanie opada w abortTime s; wyjście bez rampy idzie frontem (wirtualna rampa); wyjście w kopie — β z chwili wyjścia; HUD tak samo (recenzja ust. 2, 10)', () => {
  const P = WARP_LENS_PHASE;
  // Przerwanie: ładowanie do 60%, potem idle bez wyjścia.
  const tr = createWarpLensTrack();
  let clock = 0;
  let prevB = 0;
  let maxStep = 0;
  for (let i = 0; i <= 30; i++) {
    const s = { state: 'charging', charge: i / 50, exitAge: -1 };
    prevB = stepWarpLensTrack(tr, s, clock);
    clock += 1 / 60;
  }
  const b0 = prevB;
  assert.ok(b0 > 0.4, `β ładowania ${b0.toFixed(3)}`);
  let last = b0;
  for (let i = 0; i < 40; i++) {
    const s = { state: 'idle', exitAge: -1 };
    const b = stepWarpLensTrack(tr, s, clock);
    if (i === 0) assert.ok(near(s.abortBeta, b0, 1e-12) && s.abortAge === 0, 'stan minimalny: abortAge / abortBeta');
    maxStep = Math.max(maxStep, last - b);
    assert.ok(b <= last + 1e-12, 'opada');
    assert.ok(near(b, warpLensBeta(s), 1e-15), 'worker liczy to samo z pól migawki');
    last = b;
    clock += 1 / 60;
  }
  assert.equal(last, 0);
  assert.ok(maxStep < b0 * 0.1, `bez spadku w jednej klatce (max ${maxStep.toFixed(3)}/kl.)`);
  // Wyjście bez rampy (exitWarp({ abrupt })): active → idle bez exitAge — wiek wirtualnej rampy, front, β wyjścia.
  const t2 = createWarpLensTrack();
  stepWarpLensTrack(t2, { state: 'active', kickAge: 3 }, 10);
  const s1 = { state: 'idle', exitAge: -1 };
  assert.equal(stepWarpLensTrack(t2, s1, 10 + 1 / 60), 1);
  assert.ok(s1.exitAge === 0 && s1.exitSlow === P.exitSlow && s1.exitBeta === 1, 'wirtualna rampa od tej klatki');
  const s2 = { state: 'idle', exitAge: -1 };
  stepWarpLensTrack(t2, s2, 10 + 0.5);
  assert.ok(near(s2.exitAge, 0.5 - 1 / 60, 1e-12));
  const s3 = { state: 'idle', exitAge: -1 };
  assert.equal(stepWarpLensTrack(t2, s3, 10 + 5), 0, 'po froncie i ogonie — koniec');
  assert.ok(!(s3.exitAge >= 0));
  // Wyjście w trakcie kopu: β z chwili wyjścia (z kickAge albo exitBeta), stałe przez wyjście; zwykła rampa.
  const kb = warpLensKickBeta(0.2);
  assert.ok(kb < 1);
  assert.ok(near(warpLensBeta({ state: 'idle', exitAge: 0.3, kickAge: 0.5, exitSlow: 0.7 }), kb, 1e-15), 'β kopu w chwili wyjścia');
  assert.equal(warpLensBeta({ state: 'idle', exitAge: 0.3, exitSlow: 0.7 }), 1, 'bez kickAge — 1');
  const t3 = createWarpLensTrack();
  stepWarpLensTrack(t3, { state: 'active', kickAge: 0.2 }, 0.2);
  const se = { state: 'idle', exitAge: 0, exitSlow: 0.7 };
  stepWarpLensTrack(t3, se, 0.2 + 1 / 60);
  assert.ok(near(se.exitBeta, kb, 1e-15) && near(warpLensExitBeta(se), kb, 1e-15), 'stan minimalny: exitBeta przy wyjściu');
  // HUD: przerwanie i wyjście w kopie z tą samą osią.
  assert.ok(near(warpLensHudBeta({ state: 'idle', exitAge: -1, abortAge: 0.1, abortBeta: 0.6 }), warpLensBeta({ state: 'idle', abortAge: 0.1, abortBeta: 0.6 }), 1e-15));
  assert.ok(warpLensHudBeta({ state: 'idle', exitAge: 0, exitBeta: 0.95, exitSlow: 0.7 }, 0, 0.1) <= 0.95 + 1e-12);
});

test('wyjście w trakcie kopu (β wyjścia < 1): tryby z wejścia zostają — w klatce wyjścia żadne ciało nie przeskakuje', () => {
  const run = (exitBeta) => {
    const lens = new WarpWorldLens();
    const ctx = baseCtx({ zoom: 0.2, shipSy: 0, anchorSx: 0, anchorSy: 0 });
    // Luna tuż za trawersem (O1: obraz soczewki bliski prawdziwemu — ruch), Mars daleko przed dziobem (wynurzenie)
    const luna = Object.assign(newLensBody('luna', 'moon'), { x: 60000, y: 20000, r: 9000, flat: 0.1173, ready: true });
    const mars = Object.assign(newLensBody('mars', 'planet'), { x: 30000, y: -1e6, r: 30000, flat: 0.2, ready: true });
    const list = [luna, mars];
    for (let i = 0; i <= 20; i++) { ctx.beta = 0.9 * i / 20; lens.update(list, 2, ctx, null); }
    ctx.beta = exitBeta;
    lens.update(list, 2, ctx, null);
    const before = list.map((b) => ({ x: b.out.x, y: b.out.y, size: b.out.size, entry: b.entry }));
    ctx.exitAge = 0;
    lens.update(list, 2, ctx, null);
    return list.map((b, i) => ({ id: b.id, d: Math.hypot(b.out.x - before[i].x, b.out.y - before[i].y), ds: Math.abs(b.out.size - before[i].size), was: before[i].entry, now: b.entry }));
  };
  const kick = run(warpLensKickBeta(0.15));
  for (const r of kick) {
    assert.equal(r.now, r.was, `${r.id}: tryb z wejścia`);
    assert.ok(r.d < 1e-9 && r.ds < 1e-9, `${r.id}: bez przeskoku (${r.d.toFixed(3)} px)`);
  }
  assert.equal(kick[0].was, WORLD_LENS_MODE.MOVE, 'Luna — ruch (bliski obraz)');
});

test('stożek za celem przy zanurzaniu (recenzja ust. 3): ciało ukryte w stożku nie wynurza się przy wyjściu ani w ładowaniu (β 0,9)', () => {
  const lens = new WarpWorldLens();
  const ctx = baseCtx();
  const tgt = Object.assign(newLensBody('mars', 'planet'), { x: 0, y: -300000, r: 30000, flat: 0.1173, ready: true });
  const a = 900000;
  const ang = 8 * Math.PI / 180;
  const jup = Object.assign(newLensBody('jupiter', 'planet'), { x: Math.sin(ang) * a, y: -Math.cos(ang) * a, r: 48000, flat: 0.1173, ready: true });
  const list = [tgt, jup];
  for (let i = 0; i <= 40; i++) { ctx.beta = 0.9 * i / 40; lens.update(list, 2, ctx, tgt); }
  assert.ok(jup.out.size < 1e-9, `ładowanie (β 0,9): ${jup.out.size}`);
  ctx.beta = 1;
  lens.update(list, 2, ctx, tgt);
  assert.equal(jup.entry, WORLD_LENS_MODE.FAR);
  ctx.exitAge = 0;
  let max = 0;
  for (let i = 0; i < 70; i++) {
    lens.update(list, 2, ctx, tgt);
    if (lensDiscInFrame(jup.out.x, jup.out.y, jup.out.size, 1920, 1080)) max = Math.max(max, jup.out.size);
    ctx.exitAge += ctx.dt;
  }
  assert.ok(max < 1e-9, `wyjście: w kadrze najwyżej ${max} px (dawniej ~9,6 px)`);
});

test('ciało gotowe w trakcie skoku (recenzja ust. 12): wynurza się w miejscu w lateTime s, nie pojawia się w pełnym rozmiarze', () => {
  const P = WORLD_LENS_DEFAULTS;
  const mk = () => Object.assign(newLensBody('ceres', 'small'), { x: -150000, y: -600000, r: 4000, flat: 0.1173, ready: true });
  const mars = Object.assign(newLensBody('mars', 'planet'), { x: 75000, y: -400000, r: 30000, flat: 0.1173, ready: true });
  const ref = new WarpWorldLens();
  const lens = new WarpWorldLens();
  const ctxR = baseCtx();
  const ctx = baseCtx();
  const cR = mk();
  const c = mk();
  for (let i = 0; i <= 20; i++) { ctxR.beta = ctx.beta = 0.9 * i / 20; ref.update([mars, cR], 2, ctxR, null); lens.update([mars], 1, ctx, null); }
  ctxR.beta = ctx.beta = 1;
  for (let i = 0; i < 30; i++) { ref.update([mars, cR], 2, ctxR, null); lens.update([mars], 1, ctx, null); }
  const sizes = [];
  for (let i = 0; i < 40; i++) {
    ref.update([mars, cR], 2, ctxR, null);
    lens.update([mars, c], 2, ctx, null);
    sizes.push(c.out.size);
  }
  assert.ok(sizes[0] < 0.05 * cR.out.size, `pierwsza klatka ${sizes[0].toFixed(2)} z ${cR.out.size.toFixed(2)} px`);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1] - 1e-12, 'rośnie');
  assert.ok(near(c.out.size, cR.out.size, 1e-9) && near(c.out.x, cR.out.x, 1e-9), `po ${P.lateTime} s — jak ciało obecne od początku`);
  assert.equal(c.entry, WORLD_LENS_MODE.FAR, 'wynurzenie w miejscu');
});

test('decyzja wejścia w kadrze skoku (recenzja ust. 13): prawdziwy obraz tuż za kadrem, w kadrze po oddaleniu ładowania — ruch (nie gaśnie przy emerge0)', () => {
  const run = (zoomJump) => {
    const lens = new WarpWorldLens();
    const ctx = baseCtx({ zoom: 0.5, shipSy: 0, anchorSx: 0, anchorSy: 0, beta: 0.01, zoomJump });
    // Brzeg ciała 2500 j. od statku: przy zoomie 0,5 — 1250 px (za krawędzią 960 px), przy zoomie skoku 0,25 — 625 px.
    const b = Object.assign(newLensBody('luna', 'moon'), { x: 3000, y: 0, r: 500, flat: 0.5, ready: true });
    lens.update([b], 1, ctx, null);
    return b.entry;
  };
  assert.equal(run(NaN), WORLD_LENS_MODE.FAR, 'bez zoomJump — bieżący kadr (obraz daleki od soczewki — wynurzenie)');
  assert.equal(run(0.25), WORLD_LENS_MODE.MOVE, 'w kadrze skoku — ruch');
});

test('zbieżność kamery w czasie gry (recenzja ust. 8): to samo puszczenie przy 60 i 240 Hz', () => {
  const run = (hz) => {
    const lens = new WarpWorldLens();
    const ctx = baseCtx({ dt: 1 / hz });
    const jup = Object.assign(newLensBody('jupiter', 'planet'), { x: 0, y: -68000, r: 48000, ready: true });
    ctx.exitAge = 1.33;
    ctx.zoom = 0.05;
    for (let i = 0; i < hz * 3; i++) {
      jup.flat = ctx.zoom;
      lens.update([jup], 1, ctx, jup);
      if (ctx.targetHold < 1) return ctx.exitAge;
      ctx.zoom = Math.exp(Math.log(ctx.zoom) + (Math.log(lens._tg.qT) - Math.log(ctx.zoom)) * (1 - Math.exp(-6 / hz)));
      ctx.exitAge += ctx.dt;
    }
    return -1;
  };
  const a = run(60);
  const b = run(240);
  assert.ok(a > 1.33 && b > 1.33, `${a} / ${b}`);
  assert.ok(Math.abs(a - b) <= 1 / 60 + 1e-9, `60 Hz ${a.toFixed(3)} s, 240 Hz ${b.toFixed(3)} s`);
});

test('kieszeń przy pierścieniu (statek wchodzi w promień z ringiem): skala ograniczona prawdziwym obrazem, ciągła przy d = rExt', () => {
  const lens = new WarpWorldLens();
  const ctx = baseCtx({ zoom: 0.1 });
  const sat = Object.assign(newLensBody('saturn', 'planet'), { x: 0, y: 0, r: 16650, z: -50000, rExt: 16650 * 1.77, ready: true });
  sat.flat = perspFlat(0.1, 50000);
  let prev = 0;
  let worst = 0;
  for (let d = 1.3 * sat.rExt; d > 0.9 * sat.rExt; d -= 20) {
    sat.y = -d;
    lens.update([sat], 1, ctx, null);
    const q = sat.out.q;
    assert.ok(Number.isFinite(q) && q <= sat.flat * 1.1, `skala ${q} ≤ prawdziwa (d ${d})`);
    if (prev) worst = Math.max(worst, Math.abs(Math.log(q / prev)));
    prev = q;
  }
  assert.ok(worst < 0.02, `ciągle (max skok skali ${(worst * 100).toFixed(2)}% na 20 j.)`);
  // Zwykły przelot — kieszeń dalej działa (test kieszeni w warpLensMapC.test.mjs).
  const F = warpLensFrame(0, -1, 960, 540, 0, 189, WORLD_LENS_DEFAULTS, newWarpLensFrame());
  assert.ok(warpLensQ(0, -2e5, 1, 0.1, F, {}).q > 0);
});

test('stan klatki: reset zeruje wszystkie pola sterownika; kotwica z px CSS × skala bufora (recenzja ust. 6, 9); demo „Nurt” ma lensScaleLag', () => {
  const L = WARP_WORLD_LENS;
  Object.assign(L, { active: true, beta: 1, anchorSx: 5, anchorSy: 6, exitSlow: 0.9, exitHalt: 1.2, arriving: true, arrivalFill: 0.6, zoomRef: 0.2, zoomJump: 0.1, exitAge: 2, targetHold: 1, origin: {}, driveSpeed: 250000 });
  resetWarpWorldLens();
  assert.ok(Number.isNaN(L.anchorSx) && Number.isNaN(L.anchorSy) && Number.isNaN(L.arrivalFill) && Number.isNaN(L.zoomRef) && Number.isNaN(L.zoomJump));
  assert.ok(Number.isNaN(L.driveSpeed), 'napęd (skala mapy O1) — brak');
  assert.ok(L.exitSlow === 0 && L.exitHalt === 0 && L.arriving === null && L.exitAge === -1 && L.targetHold === 0 && L.origin === null && L.active === false);
  setWarpLensAnchor(L, 12, -189, 1.5);
  assert.ok(L.anchorSx === 18 && L.anchorSy === -283.5, 'px bufora = px CSS × bufW / viewW');
  setWarpLensAnchor(L, NaN, 3, 1.5);
  assert.ok(Number.isNaN(L.anchorSx) && Number.isNaN(L.anchorSy), 'brak — statek');
  setWarpLensAnchor(L, 1, 2, 0);
  assert.ok(Number.isNaN(L.anchorSx), 'bez skali — statek');
  resetWarpWorldLens();
  assert.ok(Number.isFinite(WORLD_LENS_DEFAULTS.lensScaleLag) && WORLD_LENS_DEFAULTS.lensScaleLag > 0);
});

// Start z ciałem za rufą w kadrze (DECYZJE-2 O1-2): statek przy doku ciała (dok w kadrze — zasięg rzeczy przypiętych
// wymusza RUCH), ładowanie 0,8 s (β 0 → 0,9, kamera oddala się do kadru skoku), kop 0,45 s, wejście w prędkość jak
// w symulatorze (smoothstep 0,9 s, sprężyna 6/s). Ciało ma wylecieć DOLNĄ krawędzią kadru, nie wrócić, za płaszczyzną
// kamery mieć promień 0; w kadrze ≤ 60 px ruchu i ≤ 50 px promienia na klatkę (P4) — przy 1080p i 1440p.
function startRun({ dist, r, z = 0, vmax, H = 1080, W = Math.round(H * 16 / 9), attach = true, lat = 0, drive = NaN }) {
  const DT = 1 / 60;
  const sPx = H / 1080;
  const focal = (H * 0.5) / Math.tan(17.5 * Math.PI / 180);
  const zoomRef = 0.2133 * W / 1920;   // gra: defaultShipZoom(W, …) — zoom z SZEROKOŚCI kadru (32:9 — × 2 względem wysokości)
  const zoomJump = zoomRef * CAMERA_RIG_DEFAULTS.warpZoomOut;
  const sm = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const lens = new WarpWorldLens();
  const b = Object.assign(newLensBody('start', z ? 'planet' : 'small'), { x: lat, y: dist, r, z, ready: true, gate: 1 });
  const ctx = baseCtx({ W, H, zoomRef, zoomJump, focal, shipSy: 0, anchorSy: 0 });
  let s = 0;
  let v = 0;
  let prog = 0;
  let prev = null;
  const R = { worstMove: 0, worstSize: 0, first: NaN, last: null, next: null, back: 0, finalSize: NaN, sPx, W, H, entry: 0 };
  for (let t = -0.8; t < 3; t += DT) {
    const charging = t < 0;
    ctx.beta = charging ? warpLensBeta({ state: 'charging', charge: (t + 0.8) / 0.8 }) : warpLensBeta({ state: 'active', kickAge: t });
    if (!charging) {
      prog = Math.min(1, prog + DT / 0.9);
      v += (vmax * sm(prog) - v) * Math.min(1, 6 * DT);
      s += v * DT;
    }
    const zoom = charging ? Math.exp(Math.log(zoomRef) + sm((t + 0.8) / 0.8) * Math.log(zoomJump / zoomRef)) : zoomJump;
    const ay = 189 * sPx * (charging ? sm((t + 0.8) / 0.8) : 1);
    Object.assign(ctx, { zoom, shipY: -s, shipSy: ay, anchorSy: ay, hullHalfLen: 900 * zoom, hullHalfWid: 403 * zoom, camZ: focal / zoom, driveSpeed: drive });
    b.flat = z ? focal / (focal / zoom - z) : zoom;
    if (attach) b.attachR = dist + 3000;
    b.ready = true;
    lens.update([b], 1, ctx, null);
    const o = { x: b.out.x, y: b.out.y, size: b.out.size };
    o.drawn = o.size >= 1.5 && lensDiscInFrame(o.x, o.y, o.size, W, H);
    if (o.drawn && Number.isNaN(R.first)) R.first = t;
    if (prev && prev.drawn && o.drawn) {
      R.worstMove = Math.max(R.worstMove, Math.hypot(o.x - prev.x, o.y - prev.y) / sPx);
      R.worstSize = Math.max(R.worstSize, Math.abs(o.size - prev.size) / sPx);
    }
    if (prev && prev.drawn && !o.drawn) R.next = o;
    if (prev && !prev.drawn && o.drawn && R.last) R.back++;
    if (o.drawn) R.last = { ...o, t };
    prev = o;
  }
  R.finalSize = b.out.size;
  R.entry = b.entry;
  return R;
}

// Kadry: 16:9 (1080p, 1440p) i 32:9 (5120 × 1440 — recenzja O1 ust. 1; zoom gry z szerokości, więc prawdziwy obraz ciała
// startu jest 2 × większy względem wysokości: wchodzi w kadr później w ładowaniu). „Ceres 6 tys. j.” (1,3 tys. j. nad
// powierzchnią, bliżej niż stacja) przy 32:9 — poza testem: Δr 50,6 / 56,4 px/kl. przy Mk II / III w ŁADOWANIU, tak samo
// z aspectMax 0 i bez — przejście z prawdziwego obrazu (kamera), nie mapa.
test('start z ciałem za rufą w kadrze (DECYZJE-2 O1-2): ciało startu wylatuje DOLNĄ krawędzią kadru i znika — bez osobliwości i mignięć, P4 w ładowaniu, kopie i locie (Mk I–III, 1080p / 1440p / 32:9)', () => {
  const cases = [
    { name: 'Ceres przy stacji (dok)', dist: 8019, r: 4717 },
    { name: 'Ceres 6 tys. j. (dok)', dist: 6000, r: 4717, no329: true },
    { name: 'skała 3 tys. j. z boku', dist: 3000, r: 800, lat: 2000, attach: false },
    { name: 'planeta tła 20 tys. j. (dok)', dist: 20000, r: 12600, z: -50000 }
  ];
  for (const c of cases) {
    for (const vmax of [100000, 175000, 250000]) {
      for (const [W, H] of [[1920, 1080], [2560, 1440], [5120, 1440]]) {
        if (c.no329 && W / H > 2) continue;
        const R = startRun({ ...c, vmax, H, W, drive: vmax });
        const tag = `${c.name}, ${vmax / 1000} tys. j/s, ${W}×${H}`;
        assert.ok(R.first <= (W / H > 2 ? -0.2 : -0.5), `${tag}: w kadrze od ładowania (${R.first})`);
        assert.equal(R.entry, WORLD_LENS_MODE.MOVE, `${tag}: ruch (dok / prawdziwy obraz w kadrze)`);
        assert.ok(R.worstMove <= 60 && R.worstSize <= 50, `${tag}: P4 ${R.worstMove.toFixed(1)} px, Δr ${R.worstSize.toFixed(1)} px na klatkę (1080p)`);
        assert.ok(R.last && R.next && R.next.y > R.last.y && R.next.y - R.next.size > R.H / 2 - 1e-6, `${tag}: wylot dolną krawędzią`);
        assert.equal(R.back, 0, `${tag}: nie wraca do kadru`);
        assert.equal(R.finalSize, 0, `${tag}: za płaszczyzną kamery promień 0`);
      }
    }
  }
});
