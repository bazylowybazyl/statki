// Soczewka świata w skoku gracza (2026-10-07, src/3d/warp/worldLens.js — demo „Nurt”): planety i księżyce
// w kadrze skoku, cel przy krawędzi, przejście β do prawdziwego widoku, bramka ringu; wpięcie w grę.
// node --test tests/warpWorldLens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_LENS_DEFAULTS, mapWorldLens, warpLensScale, warpDepthScale, flybyTurn, viewEdgeDistance,
  WarpWorldLens, WARP_WORLD_LENS, newLensBody, resetWarpWorldLens
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
  assert.match(nurt, /const beta = hasPlayer && o\.lensAllowed !== false \? p\.lensBeta\(t\) : 0;/);
  const planets = read('src/3d/planet3d.assets.js');
  assert.match(planets, /const lensOn = WARP_WORLD_LENS\.active === true;[\s\S]*ent\.update\(dt, cam, lensOn\)[\s\S]*if \(lensOn\) applyWarpWorldLens\(\);/);
  // Księżyc w soczewce stoi przy statku — bez cienia na kadłub; po soczewce cień wraca.
  assert.match(planets, /_lensPlace\(\) \{[\s\S]*?this\.mesh\.castShadow = false;/);
  assert.match(planets, /_lensRestore\(\) \{[\s\S]*?this\.mesh\.castShadow = true;/);
  // Rulon gnie siatki sam; soczewka tylko powiększa ciało w lejku i sprawdza kadr po rulonie.
  assert.match(planets, /size \*= rulonBoostCpu\(vx, vy\);[\s\S]*rulonForwardCpu\(vx, vy, _lensRul\);/);
  const html = read('index.html');
  assert.match(html, /planPlayerWarp\(dirX, dirY\);/);
  assert.match(html, /warp\.flybyFactor = playerWarpFlybyFactor\(\);\s*const maxWarpSpeed = \(warp\.cruise \|\| warp\.speed\) \* zoneWarpMul \* warp\.flybyFactor;/);
  assert.match(html, /o\.lensAllowed = !splitScreenMode && !View3D\.active;/);
});
