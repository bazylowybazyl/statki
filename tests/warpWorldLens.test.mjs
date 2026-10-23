// Soczewka świata w skoku gracza (2026-10-07, src/3d/warp/worldLens.js — demo „Nurt”): planety i księżyce
// w kadrze skoku, cel przy krawędzi, przejście β do prawdziwego widoku, bramka ringu; wpięcie w grę.
// node --test tests/warpWorldLens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_LENS_DEFAULTS, mapWorldLens, warpLensScale, warpDepthScale, flybyTurn, viewEdgeDistance,
  WarpWorldLens, WARP_WORLD_LENS, newLensBody, resetWarpWorldLens, WARP_RING_LENS, warpRingLensSlot
} from '../src/3d/warp/worldLens.js';
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

test('mapowanie: β = 0 — prawdziwy widok; cel daleko przed dziobem — przy krawędzi kadru, wystaje połową', () => {
  const o = { zoom: 0.1, flatScale: 0.1, beta: 0, velAngle: -Math.PI / 2, lensScale: 0.006 };
  const flat = mapWorldLens(3000, -50000, 30000, o, {});
  assert.ok(near(flat.x, 300) && near(flat.y, -5000) && near(flat.size, 3000));
  // Cel przed dziobem (kurs w górę ekranu), statek na środku kadru 1920 × 1080; strojenie jak WarpWorldLens.
  const P = WORLD_LENS_DEFAULTS;
  const h = {
    ...o, beta: 1, hold: 1, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 0, gapPx: P.edgeGap, hullHalfLen: 100,
    hullHalfWid: 40, holdSize: P.holdSize, holdPeek: P.holdPeek, holdSoft: P.holdSoft
  };
  const r = 48000;
  // Dalej niż okno celu (450 tys. j. od brzegu) — czeka za krawędzią kadru.
  assert.ok(mapWorldLens(0, -1e6, r, h, {}).gap > 540);
  const d = r + 300000;
  const m = mapWorldLens(0, -d, r, h, {});
  const sh = r * P.sizeK / (d + P.sizeD0) * P.holdSize;
  assert.ok(near(m.size, sh, 1e-6), 'wielkość przy krawędzi');
  assert.ok(Math.abs(m.gap - (540 - 2 * sh * P.holdPeek)) < 30, 'połowa tarczy wystaje zza krawędzi (odstęp ' + m.gap + ')');
  assert.ok(m.gap < 540 && m.gap + 2 * m.size > 540, 'tarcza przecina krawędź kadru');
  assert.ok(near(m.x, 0, 1e-6) && m.y < 0);
  assert.equal(viewEdgeDistance(0, -1, 960, 540, 0, 0), 540);
});

test('przelot z daleka (2026-10-23, „przelot jak dotarcie do celu — planeta się po prostu pojawia”): punkt zbiegu, powolny wzrost, trawers jak dawniej, za rufą bez zmian', () => {
  const P = WORLD_LENS_DEFAULTS;
  const S = 0.002;
  // Kurs w górę ekranu, statek 150 px pod środkiem kadru 1600 × 900 — do krawędzi przed dziobem 600 px.
  const o = { zoom: 0.1, flatScale: 0.1, beta: 1, velAngle: -Math.PI / 2, lensScale: S, viewHalfW: 800, viewHalfH: 450,
    shipSx: 0, shipSy: 150, sizeDepth: P.sizeDepth };
  const E = 600 * P.approachEdge;
  const A0 = E / S;
  const r = 30000;
  const lat = 75000;
  const at = (along, approach = 1, beta = 1, l = lat) => mapWorldLens(l, -along, r, { ...o, approach, beta }, {});
  // Daleko przed dziobem: w kadrze przy punkcie zbiegu, mała; bez perspektywy (dawniej) — setki px za krawędzią.
  const far = at(1e6);
  assert.ok(far.y < 0 && -far.y < E && -far.y > 0.75 * E, `punkt zbiegu (${far.y})`);
  assert.ok(far.size < r * S * 0.25, `mała z daleka (${far.size})`);
  assert.ok(-at(1e6, 0).y > 600 * 2, 'dawniej: daleko za krawędzią kadru');
  // Rośnie powoli i monotonicznie w miarę zbliżania; trawers — dokładnie dawny obraz (ciągłość), za rufą bez zmian.
  let prev = 0;
  for (const a of [1e6, 6e5, 3e5, 1.5e5, 6e4, 2e4, 5e3]) {
    const m = at(a);
    assert.ok(m.size > prev, `rośnie (${a})`);
    prev = m.size;
  }
  const k = A0 / (3e5 + A0);
  assert.ok(near(at(3e5).size, r * S * k, 1e-9) && near(at(3e5).x, lat * S * k, 1e-9), 'położenie i wielkość × k');
  const abeam = at(1), abeamOld = at(1, 0);
  assert.ok(Math.abs(abeam.x - abeamOld.x) < 1e-3 && Math.abs(abeam.size - abeamOld.size) < 1e-3, 'trawers bez zmian');
  const behind = at(-50000), behindOld = at(-50000, 0);
  assert.ok(near(behind.x, behindOld.x) && near(behind.y, behindOld.y) && near(behind.size, behindOld.size), 'za rufą bez zmian');
  // Wejście w soczewkę przed dziobem: wyrasta w miejscu perspektywy (wielkość × β), nie wjeżdża zza kadru.
  const half = at(6e5, 1, 0.5), full = at(6e5, 1, 1);
  assert.ok(near(half.x, full.x, 1e-6) && near(half.y, full.y, 1e-6) && near(half.size, full.size * 0.5, 1e-6));
  // Ciało daleko od kursu (w kadrze nie przeleci) — bez perspektywy; cel (trzymanie przy krawędzi) — bez perspektywy.
  const wide = 2e6;
  assert.ok(near(at(6e5, 1, 1, wide).x, at(6e5, 0, 1, wide).x), 'daleko w bok — dawny obraz');
  const tgt = { ...o, hold: 1, approach: 1, gapPx: P.edgeGap, holdSize: P.holdSize, holdPeek: P.holdPeek, holdSoft: P.holdSoft };
  assert.deepEqual(mapWorldLens(0, -6e5, r, tgt, {}), mapWorldLens(0, -6e5, r, { ...tgt, approach: 0 }, {}));
  // Sterownik: mijane ciała z perspektywą, cel bez.
  const src = read('src/3d/warp/worldLens.js');
  assert.match(src, /o\.approach = isTarget \? 0 : 1;\s*mapWorldLens\(dx, dy, b\.r, o, m\);/);
});

function rig() {
  const lens = new WarpWorldLens();
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

test('widok ciał: księżyce celu krążą wokół jego obrazu w jego skali; mijana planeta obraca się z β', () => {
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
  assert.ok(near(io.out.x, io.x * 0.06, 1e-6));
});

test('bramka ringu: ciało z prawdziwym ringiem w kadrze zostaje na swoim miejscu (β ciała = β · gate)', () => {
  const { lens, ctx, jup, mars, list } = rig();
  mars.gate = 0;
  lens.update(list, 3, ctx, jup);
  assert.equal(mars.out.beta, 0);
  assert.ok(near(mars.out.x, mars.x * mars.flat) && near(mars.out.size, mars.r * mars.flat));
  mars.gate = 0.5;
  lens.update(list, 3, ctx, jup);
  assert.ok(near(mars.out.beta, 0.5));
  // Cel z bramką ciągnie swoje księżyce (ten sam udział soczewki).
  jup.gate = 0;
  lens.update(list, 3, ctx, jup);
  assert.equal(list[1].out.beta, 0);
});

test('przylot (2026-10-19): po wyjściu cel trzyma się krawędzi, póki prawdziwy obraz go nie dogoni — bez skoków, cały czas w kadrze', () => {
  const { lens, ctx, jup, list } = rig();
  // β wyjścia już opadło (rampa skończona), statek dolatuje z pędem i zwalnia (krok ∝ odległość, ~5 s jak ślizg).
  Object.assign(ctx, { beta: 0, exitAge: 2, exitHalt: 1.35, dt: 1 / 60 });
  let prev = null;
  let worst = 0;
  let first = true;
  for (let d = 300000; d >= 49000; d -= Math.max(150, d * 0.006)) {
    ctx.shipX = jup.x - d;
    ctx.camX = ctx.shipX;
    ctx.exitAge += ctx.dt;
    lens.update(list, 3, ctx, jup);
    const o = jup.out;
    if (first) {
      assert.ok(ctx.targetHold > 0.99, 'daleko: cel trzymany');
      assert.ok(o.x - o.size < 480 && o.x + o.size > 480, 'tarcza celu na krawędzi kadru (wystaje)');
      first = false;
    }
    // Bliski brzeg tarczy (to, co widać przy krawędzi kadru) — cały czas w kadrze.
    const near = o.x - o.size;
    assert.ok(near < 480, `cel w kadrze (d ${d.toFixed(0)}: brzeg ${near.toFixed(0)} px)`);
    const realNear = (d - jup.r) * jup.flat;
    if (prev) {
      // Brzeg nie jedzie szybciej niż brzeg prawdziwego obrazu (dawniej β z czasu rampy przenosił cel za kadr
      // w ~0,6 s); tarcza przy dogonieniu rośnie z obrazu soczewki do prawdziwej wokół tego brzegu — bez cofania.
      worst = Math.max(worst, Math.abs(near - prev.near) - Math.abs(realNear - prev.realNear));
      assert.ok(o.size >= prev.size - 1e-6, `tarcza nie maleje przy dolocie (${prev.size.toFixed(1)} → ${o.size.toFixed(1)})`);
    }
    prev = { near, size: o.size, realNear };
  }
  assert.ok(worst < 3, `brzeg celu szybszy od prawdziwego o ${worst.toFixed(1)} px na klatkę`);
  assert.ok(ctx.targetHold < 0.05 && jup.out.beta < 0.05, 'dogonił — prawie prawdziwy widok');
  assert.ok(ctx.exitAge < ctx.exitHalt + WORLD_LENS_DEFAULTS.arrivalHoldMax, 'dolot krótszy niż limit trzymania');
});

test('przylot: statek stanął, zanim prawdziwy obraz dogonił cel — puszczenie w 0,8 s po zatrzymaniu, płynnie; w skoku bez trzymania', () => {
  const { lens, ctx, jup, list } = rig();
  Object.assign(ctx, { beta: 0, exitAge: 0.5, exitHalt: 1.35, dt: 1 / 60 });
  ctx.shipX = jup.x - 300000;
  ctx.camX = ctx.shipX;
  const holds = [];
  for (let i = 0; i < 150; i++) {
    ctx.exitAge += ctx.dt;
    lens.update(list, 3, ctx, jup);
    holds.push(ctx.targetHold);
  }
  assert.ok(holds[40] > 0.99, 'do zatrzymania (rampa) trzyma');
  for (let i = 1; i < holds.length; i++) assert.ok(holds[i] <= holds[i - 1] + 1e-12, 'puszczenie bez nawrotów');
  assert.equal(ctx.targetHold, 0, 'puszczony');
  assert.ok(near(jup.out.x, (jup.x - ctx.shipX) * jup.flat, 1e-6), 'prawdziwe miejsce');
  // Cięcie (teleport na start nowej podróży w trakcie trzymania): koniec trzymania w tej samej klatce.
  const C = rig();
  Object.assign(C.ctx, { beta: 0, exitAge: 0.5, exitHalt: 1.35, dt: 1 / 60 });
  C.ctx.shipX = C.jup.x - 300000;
  for (let i = 0; i < 10; i++) { C.ctx.exitAge += C.ctx.dt; C.ctx.shipX += 2000; C.lens.update(C.list, 3, C.ctx, C.jup); }
  assert.ok(C.ctx.targetHold > 0.99);
  C.ctx.shipX = C.jup.x - 5e6;
  C.ctx.exitAge += C.ctx.dt;
  C.lens.update(C.list, 3, C.ctx, C.jup);
  assert.equal(C.ctx.targetHold, 0, 'teleport — bez ducha celu przy krawędzi');
  // Skok (bez wyjścia): bez trzymania — zwykłe β.
  const R = rig();
  R.ctx.beta = 0;
  R.lens.update(R.list, 3, R.ctx, R.jup);
  assert.equal(R.ctx.targetHold, 0);
  assert.equal(R.jup.out.beta, 0);
});

test('wejście w soczewkę (2026-10-08): planeta startu z boku nie wskakuje pod statek; przed dziobem wlatuje; przejście niewidoczne', () => {
  const lens = new WarpWorldLens();
  const ctx = {
    active: true, beta: 1, speed: 220000, velAngle: 0, zoom: 0.06, W: 960, H: 540, focal: 800, camZ: 13333,
    camX: 0, camY: 0, shipX: 0, shipY: 0, shipSx: 0, shipSy: 0, hullHalfLen: 50, hullHalfWid: 20, dt: 0, target: null
  };
  // Ziemia z boku statku (70 tys. j.): prawdziwy obraz daleko za kadrem, w soczewce tuż pod statkiem.
  const earth = newLensBody('earth');
  Object.assign(earth, { x: 0, y: 70000, r: 37800, flat: 0.06, ready: true });
  // Księżyc przed dziobem (60 tys. j. przed, 30 tys. w bok) — obraz w soczewce w kadrze.
  const moon = newLensBody('moon');
  Object.assign(moon, { x: 60000, y: -30000, r: 9000, flat: 0.06, ready: true });
  const list = [earth, moon];
  lens.update(list, 2, ctx, null);
  assert.equal(earth.entry, -1, 'Ziemia czeka na prawdziwym miejscu');
  assert.equal(earth.out.beta, 0);
  assert.ok(near(earth.out.x, earth.x * 0.06) && near(earth.out.y, earth.y * 0.06), 'prawdziwy obraz (poza kadrem)');
  assert.equal(moon.entry, 1, 'ciało przed dziobem wlatuje od strony lotu');
  assert.equal(moon.out.beta, 1);
  // Statek odleciał: obraz Ziemi w soczewce wyszedł z kadru — przejście niewidoczne, dalej w soczewce.
  ctx.shipX = 600000;
  lens.update(list, 2, ctx, null);
  assert.equal(earth.entry, 1);
  assert.equal(earth.out.beta, 1);
  assert.ok(Math.abs(earth.out.x) - earth.out.size > 480, 'w soczewce, poza kadrem');
  // Nowy skok (reset soczewki): ocena od nowa.
  lens.reset();
  ctx.shipX = 0;
  lens.update(list, 2, ctx, null);
  assert.equal(earth.entry, -1);
  // Prawdziwy obraz w kadrze (statek tuż przy planecie bez ringu) — przejście ciągłe, od razu w soczewce.
  const venus = newLensBody('venus');
  Object.assign(venus, { x: 0, y: 3000, r: 2500, flat: 0.06, ready: true });
  lens.update([venus], 1, ctx, null);
  assert.equal(venus.entry, 1);
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
  assert.match(ring, /if \(!!e\.lensLayers !== lensOn\) \{\s*e\.lensLayers = lensOn;\s*ring\.setLayers\(lensOn \? HALO_GAME\.lensLayers : HALO_GAME\.layers\);/);
  // Klucz slotu = klucz wpisu ringu (id planety z mapy układu).
  assert.match(planets, /warpRingLensSlot\(this\.data\?\.id \|\| this\.name\)/);
});
