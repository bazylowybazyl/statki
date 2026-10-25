// Soczewka świata w skoku gracza (src/3d/warp/worldLens.js — „podniesiony świat”, mapa C, DECYZJE M / P / T 2026-10-25):
// mapa, przelot, cel i przylot, przejścia (ruch / wynurzenie), bramka ringu; wpięcie w grę. Matematyka mapy: warpLensMapC.test.mjs.
// node --test tests/warpWorldLens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_LENS_DEFAULTS, WORLD_LENS_MODE, mapWorldLens, warpLensScale, warpDepthScale, flybyTurn, viewEdgeDistance,
  WarpWorldLens, WARP_WORLD_LENS, newLensBody, resetWarpWorldLens, WARP_RING_LENS, warpRingLensSlot
} from '../src/3d/warp/worldLens.js';
import { WARP_ARRIVAL_FRAME, warpArrivalZoom } from '../src/render/warpArrivalFrame.js';
import * as demoLens from '../dema/warp-webgpu/worldLens.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('jedno źródło matematyki: demo bierze czyste funkcje soczewki z gry', () => {
  assert.equal(demoLens.mapWorldLens, mapWorldLens);
  assert.equal(demoLens.warpLensScale, warpLensScale);
  assert.equal(demoLens.flybyTurn, flybyTurn);
  assert.equal(demoLens.WORLD_LENS_DEFAULTS, WORLD_LENS_DEFAULTS);
});

test('skala soczewki: z nominalnej prędkości, od prędkości odniesienia stała, z sufitem × zoom', () => {
  const P = WORLD_LENS_DEFAULTS;
  assert.ok(near(warpLensScale(260000, 540), 540 / P.framingDist));
  assert.ok(near(warpLensScale(P.zoomRefSpeed, 540), 540 / P.framingDist));
  assert.ok(near(warpLensScale(P.zoomRefSpeed / 2, 540), 540 / (P.framingDist / 2)), 'wolniejszy skok — ciaśniejszy kadr');
  assert.equal(warpLensScale(1000, 540, P, 0.01), 0.01);
  assert.equal(warpDepthScale(0, 30000), 1);
  assert.ok(warpDepthScale(300000, 30000) < 0.11);
  assert.equal(warpDepthScale(-300000, 30000), warpDepthScale(300000, 30000));
});

// Kadr 1920 × 1080, kurs w górę ekranu, kotwica (nominalne miejsce statku) 189 px pod środkiem: do krawędzi przed
// dziobem 729 px, za rufą 351 px, w bok 960 px (projekt C § 1).
const FRAME_1080 = Object.freeze({ zoom: 0.1173, flatScale: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189 });

test('mapa C (mapWorldLens, DECYZJE M1–M2): β = 0 — prawdziwy widok; β = 1 — namiar prawdziwy, pas boczny w kadrze, punkt zbiegu przed dziobem', () => {
  const real = mapWorldLens(3000, -50000, 30000, { zoom: 0.1, flatScale: 0.1, beta: 0, velAngle: -Math.PI / 2 }, {});
  assert.ok(near(real.x, 300, 1e-12) && near(real.y, -5000, 1e-12) && near(real.size, 3000, 1e-12));
  const P = WORLD_LENS_DEFAULTS;
  const o = FRAME_1080;
  // Mars mijany w trawersie 75 tys. j. w lewo: promień r · W / √(l² + B²), cały w kadrze (sędzia 2: w_s 0,8).
  const mars = mapWorldLens(-75000, 0, 30000, o, {});
  const W = P.ws * 960;
  assert.ok(near(mars.size, 30000 * W / Math.sqrt(75000 * 75000 + P.B * P.B), 1e-9));
  assert.ok(mars.size >= 250, `Mars w trawersie ${mars.size.toFixed(0)} px (BRIEF C2: ≥ 250 przy 1080p)`);
  assert.ok(-mars.x + mars.size < 960, 'dalszy brzeg Marsa w kadrze');
  assert.ok(near(mars.y, 0, 1e-9) && mars.x < 0, 'trawers po właściwej stronie');
  // Daleko przed dziobem: mała, przy punkcie zbiegu E_f = h_f · 729 px; wielkość ≈ r · E_f / a.
  const Ef = P.hf * 729;
  const far = mapWorldLens(0, -2e6, 48000, o, {});
  assert.ok(far.y < 0 && -far.y < Ef && -far.y > 0.95 * Ef, `punkt zbiegu (${far.y.toFixed(1)})`);
  assert.ok(Math.abs(far.size - 48000 * Ef / 2e6) / far.size < 0.05 && far.size <= 20, `Jowisz z 2 mln j.: ${far.size.toFixed(1)} px`);
  // Namiar prawdziwy, odstęp brzegu q · (d − r) > 0 (tarcza nie zachodzi na statek).
  for (const [dx, dy, r] of [[50000, -300000, 30000], [-400000, 100000, 16650], [120000, 260000, 9000], [0, 40000, 37800]]) {
    const m = mapWorldLens(dx, dy, r, o, {});
    assert.ok(near(Math.atan2(m.y, m.x), Math.atan2(dy, dx), 1e-12), 'namiar');
    assert.ok(m.gap > 0 && near(m.gap, m.q * (Math.hypot(dx, dy) - r), 1e-6), 'odstęp');
  }
  assert.equal(viewEdgeDistance(0, -1, 960, 540, 0, 189), 729);
});

test('przelot (mapa C, BRIEF C2–C4): rośnie do trawersu, maleje za rufą i wyjeżdża dolną krawędzią (punkt zbiegu za rufą poza kadrem); przed dziobem prosta do punktu zbiegu, trawers bez załamania', () => {
  const o = FRAME_1080;
  const at = (a) => mapWorldLens(-75000, -a, 30000, o, {});
  let prev = 0;
  for (const a of [2e6, 1e6, 5e5, 2.5e5, 1e5, 4e4, 1e4, 0]) {
    const m = at(a);
    assert.ok(m.size > prev, `rośnie (${a})`);
    prev = m.size;
  }
  for (const a of [-1e4, -4e4, -1e5, -2.5e5, -5e5, -1e6]) {
    const m = at(a);
    assert.ok(m.size < prev, `maleje za rufą (${a})`);
    prev = m.size;
  }
  // Za rufą: punkt zbiegu h_b · 351 px > 351 px — daleki obraz cały pod dolną krawędzią (bez parkowania w kadrze).
  const back = at(-2e6);
  assert.ok(back.y - back.size > 351 && back.y < WORLD_LENS_DEFAULTS.hb * 351 + 1e-6, `za rufą: ${back.y.toFixed(0)} px, r ${back.size.toFixed(1)}`);
  // Przed dziobem (daleko od trawersu) obrazy ciała o stałym l leżą na prostej przez punkt zbiegu (0, −E_f).
  const vy = -WORLD_LENS_DEFAULTS.hf * 729;
  const pts = [3e5, 6e5, 1.2e6].map(at);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[0];
    const q = pts[i];
    const cr = (p.x * (q.y - vy) - (p.y - vy) * q.x) / (Math.hypot(p.x, p.y - vy) * Math.hypot(q.x, q.y - vy));
    assert.ok(Math.abs(cr) < 0.02, `prosta do punktu zbiegu (sin ${cr.toFixed(4)})`);
  }
  // Trawers: nachylenie toru dY/da ciągłe (zaokrąglenie ε), wielkość ciągła przy zmianie punktu zbiegu przód / tył.
  const e = 0.5;
  const sA = (at(e).y - at(0).y) / e;
  const sB = (at(0).y - at(-e).y) / e;
  assert.ok(Math.abs(sA - sB) <= 1e-3 * Math.abs(sA), `nachylenie w trawersie ${sA} / ${sB}`);
  assert.ok(Math.abs(at(1e-3).size - at(-1e-3).size) < 1e-6);
});

test('ring w soczewce (przegląd 2026-10-23): warstwy tła tylko przy przesuniętym obrazie, próg px bramkuje rysowanie i budowę', () => {
  const ring = read('src/3d/haloRing/haloRingGame.js');
  // Planeta czekająca na prawdziwym miejscu (bramka, wejście −1, puszczony przylot) ma lens.on, ale real = 1 — ring
  // prawdziwy, FG (dachy hal K-7, górna ściana) nad statkami w halach.
  assert.match(ring, /const lensBg = lensOn && \(Number\(lens\.real\) \|\| 0\) < HALO_GAME\.lensBgReal;/);
  assert.match(ring, /if \(!!e\.lensLayers !== lensBg\) \{\s*e\.lensLayers = lensBg;\s*ring\.setLayers\(lensBg \? HALO_GAME\.lensLayers : HALO_GAME\.layers\);/);
  // Mały obraz ringu w soczewce — ani rysunek, ani budowa ringu-archetypu w tle.
  assert.match(ring, /const lensSmall = lensOn && L\.radii\.max \* ks \* zoom < HALO_GAME\.lensMinPx;/);
  assert.match(ring, /\(lensOn && lens\.vis && !lensSmall\)\)\) this\._ensureRing\(e\);/);
  assert.match(ring, /&& !lensSmall;/);
});

function rig() {
  // minPx 0 — sprawdzane są proporcje (mały księżyc nie gaśnie przy progu kropki).
  const lens = new WarpWorldLens({ minPx: 0 });
  const ctx = {
    active: true, beta: 1, speed: 220000, velAngle: 0, zoom: 0.06, W: 960, H: 540, focal: 800, camZ: 13333,
    camX: 0, camY: 0, shipX: 0, shipY: 0, shipSx: 0, shipSy: 0, hullHalfLen: 50, hullHalfWid: 20, dt: 0, target: null
  };
  const jup = newLensBody('jupiter');
  Object.assign(jup, { x: 900000, y: 0, r: 48000, flat: 0.06, ready: true });
  const io = newLensBody('io');
  Object.assign(io, { x: 900000, y: 86000, r: 2400, flat: 0.06, ready: true, parent: jup });
  const mars = newLensBody('mars');
  Object.assign(mars, { x: 300000, y: 70000, r: 30000, flat: 0.06, ready: true });
  return { lens, ctx, jup, io, mars, list: [jup, io, mars] };
}

test('widok ciał: księżyce celu krążą wokół jego obrazu w jego skali; mijana planeta obraca się z β; β = 0 — prawdziwy widok', () => {
  const { lens, ctx, jup, io, mars, list } = rig();
  lens.update(list, 3, ctx, jup);
  assert.equal(jup.out.isTarget, true);
  const k = jup.out.size / jup.r;
  assert.ok(near(io.out.x - jup.out.x, (io.x - jup.x) * k, 1e-6) && near(io.out.y - jup.out.y, (io.y - jup.y) * k, 1e-6));
  assert.ok(near(io.out.size, io.r * k, 1e-6));
  assert.ok(mars.out.angle > 0.1, 'przelot obraca bryłę (wirtualna kamera nad statkiem)');
  ctx.beta = 0;
  lens.update(list, 3, ctx, jup);
  assert.ok(near(mars.out.x, mars.x * 0.06) && near(mars.out.y, mars.y * 0.06) && mars.out.angle === 0, 'β = 0 — prawdziwy widok');
  assert.ok(near(jup.out.x, jup.x * 0.06, 1e-6) && near(io.out.x, io.x * 0.06, 1e-6) && near(io.out.y, io.y * 0.06, 1e-6));
});

test('bramka ringu: ciało z prawdziwym ringiem w kadrze zostaje na swoim miejscu (β ciała = β · gate, ruchem — ring w slocie prawdziwy)', () => {
  const { lens, ctx, jup, mars, list } = rig();
  mars.gate = 0;
  lens.update(list, 3, ctx, jup);
  assert.equal(mars.out.beta, 0);
  assert.equal(mars.entry, WORLD_LENS_MODE.MOVE, 'bramka zamknięta — ruch (prawdziwy obraz dokładnie)');
  assert.ok(near(mars.out.x, mars.x * mars.flat) && near(mars.out.size, mars.r * mars.flat));
  // Otwarcie bramki (ring wyszedł za kadr) — tryb od nowa: daleki Mars wynurza się w miejscu soczewki.
  mars.gate = 0.5;
  lens.update(list, 3, ctx, jup);
  assert.ok(near(mars.out.beta, 0.5));
  assert.equal(mars.entry, WORLD_LENS_MODE.FAR);
  // Cel z bramką ciągnie swoje księżyce (ten sam udział soczewki).
  jup.gate = 0;
  lens.update(list, 3, ctx, jup);
  assert.equal(list[1].out.beta, 0);
});

// Przylot: statek (0, 0) leci w górę ekranu ku celowi (0, −d); kadr 1920 × 1080, kotwica 189 px pod środkiem.
function arrivalRig() {
  const lens = new WarpWorldLens();
  const ctx = {
    beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, roll: 0, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189,
    anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, exitHalt: 1.33, exitSlow: 0.7,
    arriving: null, targetHold: 0
  };
  const jup = newLensBody('jupiter', 'planet');
  Object.assign(jup, { x: 0, y: 0, r: 48000, flat: ctx.zoom, ready: true });
  const io = newLensBody('io', 'moon');
  Object.assign(io, { x: 60000, y: 0, r: 2400, flat: ctx.zoom, ready: true, parent: jup });
  const place = (gap) => { jup.y = -(gap + jup.r); io.y = jup.y; };
  return { lens, ctx, jup, io, list: [jup, io], place };
}

test('cel w locie (DECYZJE T1): z daleka kropka przy punkcie zbiegu, skala = miękkie maksimum (mapa, podgląd kadru przylotu); bliski brzeg nie niżej niż kadr przylotu, z bliska skala → z_v', () => {
  const { lens, ctx, jup, list, place } = arrivalRig();
  const edge = 729;
  let prev = 0;
  for (const gap of [2e6, 1e6, 3e5, 1e5, 4e4, 2e4]) {
    place(gap);
    lens.update(list, 2, ctx, jup);
    const zv = warpArrivalZoom(edge, gap, WARP_ARRIVAL_FRAME.fill);
    const q = jup.out.q;
    assert.ok(q >= zv * (1 - 1e-12), `skala celu ≥ z_v (${gap})`);
    assert.ok(jup.out.size > prev, `cel rośnie w miarę zbliżania (${gap})`);
    prev = jup.out.size;
    const nearEdge = 189 - (jup.out.y + jup.out.size);   // bliski brzeg tarczy od kotwicy wzdłuż kursu [px]
    assert.ok(nearEdge >= WARP_ARRIVAL_FRAME.fill * edge - 1e-6 && nearEdge < edge, `bliski brzeg w kadrze przed dziobem (${nearEdge.toFixed(0)} px)`);
    if (gap >= 2e6) assert.ok(jup.out.size < 20, `z daleka kropka (${jup.out.size.toFixed(1)} px)`);
    if (gap <= 2e4) assert.ok(Math.abs(q / zv - 1) < 0.01, `z bliska skala = podgląd kadru przylotu (${(q / zv).toFixed(4)})`);
  }
  assert.equal(ctx.targetHold, 0, 'w skoku bez trzymania');
});

test('przylot (DECYZJE T2): cel rośnie razem z hamowaniem; trzymany, aż zoom kamery zbiegnie z q_T (3 klatki po rampie), potem puszczenie w 0,6 s bez skoku; księżyc jedzie skalą celu', () => {
  const { lens, ctx, jup, io, list, place } = arrivalRig();
  ctx.exitAge = 0;
  let prev = null;
  let worstMove = 0;
  let worstSize = 0;
  let releasedAt = -1;
  const holds = [];
  for (let i = 0; i < 300; i++) {
    // rampa 1,33 s: 84 → 20 tys. j., potem ślizg 5 s: 20 → 15 tys. j.
    const gap = ctx.exitAge < 1.33 ? 84000 - (64000 * ctx.exitAge) / 1.33 : 20000 - Math.min(5000, (ctx.exitAge - 1.33) * 1000);
    ctx.arriving = ctx.exitAge >= 1.33 && ctx.exitAge < 6.33;
    place(gap);
    jup.flat = io.flat = ctx.zoom;
    lens.update(list, 2, ctx, jup);
    holds.push(ctx.targetHold);
    const o = jup.out;
    if (prev) {
      worstMove = Math.max(worstMove, Math.hypot(o.x - prev.x, o.y - prev.y));
      worstSize = Math.max(worstSize, Math.abs(o.size - prev.size));
      assert.ok(o.size >= prev.size - 1e-6, `cel nie maleje przy dolocie (${ctx.exitAge.toFixed(2)} s)`);
    }
    if (releasedAt < 0 && ctx.targetHold < 1) releasedAt = ctx.exitAge;
    // Księżyc celu wokół obrazu celu w skali celu (cel w soczewce — jego skala położeń).
    if (o.beta >= 1) assert.ok(near(io.out.x - o.x, (io.x - jup.x) * o.q, 1e-6) && near(io.out.size, io.r * o.q, 1e-6), 'księżyc w skali celu');
    // Kamera kadru przylotu jak rig (cameraRig.js): własny cel — warpArrivalZoom od statku (nie q_T soczewki), sprężyna
    // logarytmu ω 3/s przy odsuwaniu, 9/s przy dosuwaniu.
    const camGoal = Math.log(warpArrivalZoom(729, gap, WARP_ARRIVAL_FRAME.fill));
    const om = camGoal > Math.log(ctx.zoom) ? 9 : 3;
    ctx.zoom = Math.exp(Math.log(ctx.zoom) + (camGoal - Math.log(ctx.zoom)) * (1 - Math.exp(-om * ctx.dt)));
    prev = { x: o.x, y: o.y, size: o.size };
    ctx.exitAge += ctx.dt;
  }
  assert.ok(releasedAt >= 1.33 && releasedAt < 1.33 + 1, `puszczenie po rampie, gdy kamera zbiegła — przed końcem ślizgu (${releasedAt.toFixed(2)} s)`);
  for (let i = 1; i < holds.length; i++) assert.ok(holds[i] <= holds[i - 1] + 1e-12, 'puszczenie bez nawrotów');
  assert.equal(ctx.targetHold, 0, 'puszczony');
  assert.ok(worstMove < 60 && worstSize < 50, `bez skoków (ruch ${worstMove.toFixed(1)} px, promień ${worstSize.toFixed(1)} px na klatkę)`);
  assert.ok(near(jup.out.y, 189 + jup.y * jup.flat, 1e-6) && near(jup.out.size, jup.r * jup.flat, 1e-9), 'prawdziwy obraz');
});

test('przylot: kamera nie zbiega (zostaje dalej niż podgląd) — puszczenie po zatrzymaniu (koniec ślizgu) + zapas; bez pola `arriving` — po czasie ślizgu; cięcie — od razu', () => {
  const run = (arrivingFn) => {
    const { lens, ctx, jup, list, place } = arrivalRig();
    ctx.zoom = 0.01;   // kamera oddalona ponad kadr przylotu (q_T ≈ 0,027): prawdziwy obraz mniejszy — podłoga nie działa
    ctx.exitAge = 0;
    let rel = -1;
    for (let i = 0; i < 900 && rel < 0; i++) {
      place(Math.max(20000, 84000 - ctx.exitAge * 48000));
      jup.flat = ctx.zoom;
      ctx.arriving = arrivingFn(ctx.exitAge);
      lens.update(list, 1, ctx, jup);
      if (ctx.targetHold < 1) rel = ctx.exitAge;
      ctx.exitAge += ctx.dt;
    }
    return rel;
  };
  const P = WORLD_LENS_DEFAULTS;
  const stop = 1.33 + 5;
  const r1 = run((age) => age >= 1.33 && age < stop);
  assert.ok(Math.abs(r1 - (stop + P.arrivalStopGrace)) < 0.04, `zatrzymanie + zapas (${r1.toFixed(2)} s)`);
  const r2 = run(() => null);
  assert.ok(Math.abs(r2 - (1.33 + P.arrivalSlideFallback + P.arrivalStopGrace)) < 0.04, `bez pola — czas ślizgu (${r2.toFixed(2)} s)`);
  // Cięcie (teleport w trakcie trzymania): koniec trzymania w tej samej klatce.
  const C = arrivalRig();
  C.ctx.exitAge = 0.5;
  C.place(200000);
  C.lens.update(C.list, 2, C.ctx, C.jup);
  assert.ok(C.ctx.targetHold > 0.99);
  C.ctx.exitAge += C.ctx.dt;
  C.place(5e6);
  C.lens.update(C.list, 2, C.ctx, C.jup);
  assert.equal(C.ctx.targetHold, 0, 'teleport — bez ducha celu');
  assert.ok(near(C.jup.out.size, C.jup.r * C.jup.flat, 1e-9));
});

test('wejście (DECYZJE P2, reguła 10-08): dalekie i duże bliskie ciała wynurzają się w miejscu soczewki — bez wjazdu pod statek; obraz bliski prawdziwemu — ruchem, β → 0 dokładnie; tryb raz na przejście', () => {
  const lens = new WarpWorldLens();
  const ctx = {
    beta: 1, velAngle: -Math.PI / 2, zoom: 0.2, W: 1920, H: 1080, roll: 0, shipX: 0, shipY: 0, shipSx: 0, shipSy: 0,
    hullHalfLen: 180, hullHalfWid: 80, dt: 1 / 60, exitAge: -1
  };
  // Planeta startu z ringiem tuż za rufą (prawdziwy obraz daleko za kadrem, w soczewce duża pod statkiem).
  const earth = newLensBody('earth', 'planet');
  Object.assign(earth, { x: 0, y: 57750, r: 37800, rExt: 46250, flat: 0.2, ready: true });
  // Mars daleko przed dziobem; Luna z boku blisko (obraz soczewki bliski prawdziwemu); Wenus z prawdziwym obrazem w kadrze.
  const mars = newLensBody('mars', 'planet');
  Object.assign(mars, { x: 30000, y: -1e6, r: 30000, flat: 0.2, ready: true });
  const luna = newLensBody('luna', 'moon');
  Object.assign(luna, { x: 60000, y: 0, r: 9000, flat: 0.1173, ready: true });
  const venus = newLensBody('venus', 'planet');
  Object.assign(venus, { x: 0, y: -3000, r: 1500, flat: 0.06, ready: true });
  const list = [earth, mars, luna, venus];
  lens.update(list, 4, ctx, null);
  const full = list.map((b) => ({ x: b.out.x, y: b.out.y, size: b.out.size }));
  lens.reset();
  ctx.beta = 0.05;
  lens.update(list, 4, ctx, null);
  assert.equal(earth.entry, WORLD_LENS_MODE.FAR, 'planeta startu wynurza się (nie wjeżdża pod statek)');
  assert.equal(mars.entry, WORLD_LENS_MODE.FAR);
  assert.equal(luna.entry, WORLD_LENS_MODE.MOVE, 'bliski obraz — ruchem');
  assert.equal(venus.entry, WORLD_LENS_MODE.MOVE, 'prawdziwy obraz w kadrze — ruchem');
  // Przed wynurzeniem (β ≤ emerge0) — dokładnie prawdziwy obraz (poza kadrem); potem w miejscu obrazu soczewki
  // (× 1 + 0,06 · (1 − β)), promień × smoothstep(0,1; 0,8; β) — nie wjeżdża przez kadr.
  for (const b of [earth, mars]) {
    assert.ok(near(b.out.x, b.x * b.flat, 1e-9) && near(b.out.y, b.y * b.flat, 1e-9) && near(b.out.size, b.r * b.flat, 1e-9), `${b.id}: β 0,05 — prawdziwy obraz`);
  }
  ctx.beta = 0.3;
  lens.update(list, 4, ctx, null);
  const t7 = 2 / 7;                       // smoothstep(0,1; 0,8; 0,3)
  const em = t7 * t7 * (3 - 2 * t7);
  for (const [i, b] of [[0, earth], [1, mars]]) {
    const f = full[i];
    assert.ok(near(b.out.x, f.x * (1 + 0.06 * 0.7), 1e-6) && near(b.out.y, f.y * (1 + 0.06 * 0.7), 1e-6), `${b.id}: w miejscu soczewki`);
    assert.ok(near(b.out.size, f.size * em, 1e-6), `${b.id}: promień wynurzenia ${b.out.size.toFixed(1)} / ${(f.size * em).toFixed(1)}`);
  }
  // Tryb ustalony, gdy przejście ruszyło (β ≥ 0,02): późniejsza zmiana skali nie zmienia trybu.
  ctx.beta = 0.5;
  lens.update(list, 4, ctx, null);
  luna.flat = 2;
  lens.update(list, 4, ctx, null);
  assert.equal(luna.entry, WORLD_LENS_MODE.MOVE);
  luna.flat = 0.1173;
  // Ruch: β → 0 dokładnie prawdziwy obraz; namiar prawdziwy przy każdym β.
  ctx.beta = 0;
  lens.update(list, 4, ctx, null);
  assert.ok(near(luna.out.x, luna.x * luna.flat, 1e-9) && near(venus.out.y, venus.y * venus.flat, 1e-9));
  for (const beta of [0.2, 0.6, 0.95]) {
    ctx.beta = beta;
    lens.update(list, 4, ctx, null);
    assert.ok(near(Math.atan2(luna.out.y, luna.out.x), Math.atan2(luna.y, luna.x), 1e-12), 'namiar Luny');
  }
  // Nowy skok (reset) — ocena od nowa.
  lens.reset();
  ctx.beta = 0.01;
  luna.flat = 2;
  lens.update(list, 4, ctx, null);
  assert.equal(luna.entry, WORLD_LENS_MODE.FAR, 'nowa decyzja po resecie');
});

test('stan klatki: reset wyłącza soczewkę', () => {
  WARP_WORLD_LENS.active = true;
  WARP_WORLD_LENS.beta = 0.7;
  WARP_WORLD_LENS.target = {};
  resetWarpWorldLens();
  assert.equal(WARP_WORLD_LENS.active, false);
  assert.equal(WARP_WORLD_LENS.beta, 0);
  assert.equal(WARP_WORLD_LENS.target, null);
});

test('wpięcie: sterownik warpa pisze stan, planety rozstawia soczewka, gra planuje skok i zwalnia przy ciałach', () => {
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.match(nurt, /this\._commitWorldLens\(o, t, dt, camX, camY, zoom, view, hasPlayer\);/);
  assert.match(nurt, /if \(!this\.initialized \|\| !this\.enabled\) \{ resetWarpWorldLens\(\); return; \}/);
  assert.match(nurt, /const lensOk = hasPlayer && o\.lensAllowed !== false;\s*const beta = lensOk \? p\.lensBeta\(t\) : 0;/);
  // Przylot: soczewka żyje po wyjściu, póki trzyma cel przy krawędzi (targetHold), choć β już opadło.
  assert.match(nurt, /if \(!\(beta > 0\.0005\) && !\(arriving && L\.targetHold > 0\.0005\)\) \{ resetWarpWorldLens\(\); return; \}/);
  assert.match(nurt, /L\.exitAge = arriving \? exitAge : -1;/);
  const planets = read('src/3d/planet3d.assets.js');
  assert.match(planets, /const lensOn = WARP_WORLD_LENS\.active === true;[\s\S]*ent\.update\(dt, cam, lensOn\)[\s\S]*if \(lensOn\) applyWarpWorldLens\(\);/);
  // Bramka ringu raz otwarta w skoku zostaje otwarta (2026-10-19: przelot obok ringu i dolot do celu wyrywały planetę).
  assert.match(planets, /if \(b\.gateOpenSession === _warpLens\.session\) gate = 1;[\s\S]*?if \(b\.gate >= 0\.999\) \{ b\.gate = 1; b\.gateOpenSession = _warpLens\.session; \}/);
  // Księżyc w soczewce stoi przy statku — bez cienia na kadłub; po soczewce cień wraca.
  assert.match(planets, /_lensPlace\(\) \{[\s\S]*?this\.mesh\.castShadow = false;/);
  assert.match(planets, /_lensRestore\(\) \{[\s\S]*?this\.mesh\.castShadow = true;/);
  // Rulon gnie siatki sam; soczewka tylko powiększa ciało w lejku i sprawdza kadr po rulonie.
  assert.match(planets, /size \*= rulonBoostCpu\(vx, vy\);[\s\S]*rulonForwardCpu\(vx, vy, _lensRul\);/);
  const html = read('index.html');
  assert.match(html, /planPlayerWarp\(dirX, dirY\);/);
  assert.match(html, /warp\.flybyFactor = playerWarpFlybyFactor\(\);\s*const maxWarpSpeed = \(warp\.cruise \|\| warp\.speed\) \* zoneWarpMul \* warp\.flybyFactor;/);
  assert.match(html, /o\.lensAllowed = !splitScreenMode && !View3D\.active;/);
  // Cel: ustawienie tarczy przy przylocie zamrożone, po skoku własna orientacja planety (bez obrotu przy końcu soczewki).
  assert.match(planets, /if \(!\(L\.exitAge >= 0\) \|\| !this\._lensWasTarget\) \{/);
  assert.match(planets, /_lensRestore\(\) \{[\s\S]*?this\._lensFace\.copy\(this\._lensFaceNow\);[\s\S]*?this\._orient\(null, this\._lensFace\);/);
  assert.match(planets, /this\._spin\(dt\);\s*\/\/[^\n]*\n\s*this\._orient\(null, this\._lensFace\);/);
});

test('cel bez obrotu przelotu (2026-10-19: „przy wejściu planeta się obraca”): cel i jego księżyce — kąt 0 przy każdym β; mijana planeta się obraca', () => {
  const { lens, ctx, jup, io, mars, list } = rig();
  for (const beta of [1, 0.5, 0.1]) {
    ctx.beta = beta;
    lens.update(list, 3, ctx, jup);
    assert.equal(jup.out.angle, 0, `cel bez obrotu (β ${beta})`);
    assert.equal(io.out.angle, 0, `księżyc celu bez obrotu (β ${beta})`);
  }
  ctx.beta = 1;
  lens.update(list, 3, ctx, jup);
  assert.ok(mars.out.angle > 0.1, 'mijana planeta — obrót przelotu');
});

test('ring w soczewce (2026-10-19, „a co z ringami”): slot raz na planetę, planety go piszą, ring jedzie z obrazem planety', () => {
  const s = warpRingLensSlot('test-ring');
  assert.equal(warpRingLensSlot('test-ring'), s, 'ten sam rekord (bez alokacji na klatkę)');
  assert.equal(WARP_RING_LENS['test-ring'], s);
  assert.deepEqual(Object.keys(s).sort(), ['k', 'on', 'q', 'real', 'turned', 'vis', 'x', 'y']);
  assert.equal(s.on, false, 'poza soczewką ring na prawdziwym miejscu');
  delete WARP_RING_LENS['test-ring'];
  // Planeta z ringiem w soczewce: środek obrazu, skala obrazu do prawdziwej, udział prawdziwego widoku, obrót przelotu.
  const planets = read('src/3d/planet3d.assets.js');
  assert.match(planets, /const rl = this\._ringLens;\s*rl\.on = true;\s*rl\.x = lwx;\s*rl\.y = lwy;\s*rl\.k = Math\.max\(1e-6, fit\.size \* k\) \/ Math\.max\(1e-6, b\.r\);\s*rl\.real = real;\s*rl\.vis = !fit\.off;\s*rl\.turned = turned;/);
  assert.match(planets, /if \(this\._ringLens\) this\._ringLens\.on = false;/);
  // Obraz ringu: grupa w obrazie planety, skala, obrót przelotu przed kątem portu; cień ringu × udział prawdziwego widoku.
  const ring = read('src/3d/haloRing/haloRingGame.js');
  assert.match(ring, /const lens = WARP_RING_LENS\[e\.key\];\s*const lensOn = !!\(lens && lens\.on\);/);
  assert.match(ring, /ring\.group\.position\.set\(ox, -oy, 0\);\s*ring\.group\.scale\.setScalar\(ks\);/);
  assert.match(ring, /if \(lensOn && lens\.turned && lens\.q\) ring\.group\.quaternion\.copy\(lens\.q\)\.multiply\(_qRot\);\s*else ring\.group\.quaternion\.copy\(_qRot\);/);
  assert.match(ring, /const shadowK = lensOn \? Math\.max\(0, Math\.min\(1, Number\(lens\.real\) \|\| 0\)\) : 1;/);
  // Ring w soczewce = tło jak planeta (2026-10-23, „planeta przebija się przez statek”): części FG (górna ściana,
  // moduły) na warstwie tła — pass FG rysuje się po kadłubach; po soczewce zwykłe warstwy (FG nad statkiem w hali).
  assert.match(ring, /lensLayers: Object\.freeze\(\{ default: 1, fg: 1 \}\)/);
  // Ring w soczewce dopiero od `lensMinPx` na ekranie (mijana planeta jest w kadrze od początku skoku — ring kosztuje
  // ~3 ms CPU i ~50 rysunków także jako kreska wokół kilkupikselowej tarczy).
  // Klucz slotu = klucz wpisu ringu (id planety z mapy układu).
  assert.match(planets, /warpRingLensSlot\(this\.data\?\.id \|\| this\.name\)/);
});
