// Demo nowego pola asteroid (dema/asteroidy.html).
//
// Prawdziwe Core3D gry: tło (mgławica, gwiazdy) z planet3d.assets, kadłub
// Atlasa przez hexShips3D, pas przez src/3d/asteroidBelt3D.js — te same
// moduły wejdą do gry. Kolejność klatki jak w grze: updatePlanets3D →
// pas (skały + mgła) → updateHexShips3D → drawHexShips3D (Core3D: bloom,
// ACES) → nakładka 2D (podpisy galerii).
//
// Sterowanie z konsoli / headless: window.__demo (setScene, setZoom, step).

import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, prewarmHexShipVisual, setHexShipWorldLights } from '../src/3d/hexShips3D.js';
import { initHexBody, setHexShips3DActive } from '../src/game/destructor.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { buildSystemMap } from '../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { AsteroidBeltField, BELT_BAND } from '../src/game/asteroidBeltField.js';
import { ROCK_TYPES, ROCK_TYPE_INDEX, ROCK_TYPE_LABELS_PL, ROCK_FAMILIES, SHAPE_VARIANTS } from '../src/game/asteroidRockKinds.js';
import { GIANT_PRESETS, GIANT_PRESET_IDS, buildGiantPlan } from '../src/game/asteroidGiants.js';
import { GiantBuilder } from '../src/game/asteroidGiantBuilder.js';
import { GiantRock3D } from '../src/3d/rocks/giantRock3D.js';
import { FIELD_SHIP_LIGHTS } from '../src/3d/fieldLights3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { AsteroidBelt3D } from '../src/3d/asteroidBelt3D.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import '../src/3d/planet3d.assets.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import carrierUrl from '../src/assets/ships/terrancarrier.png';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// Galeria typów: wypełniacz, potem rudy od pospolitych do rzadkich, na końcu
// skała energetyczna (burze: pioruny między takimi skałami).
const GALLERY_TYPES = ['rock', 'iron', 'silicon', 'copper', 'titan', 'ice', 'crystal', 'uran', 'energy'];
const ZOOM_MIN = 0.035;
const ZOOM_MAX = 3.2;

// ---------------------------------------------------------------------------
// Świat jak w grze: słońce w środku świata, skala AU z mapy układu.

const SUN = { x: 6000000, y: 6000000, r: 823, r3D: 399 };
window.SUN = SUN;
window.warp = { state: 'idle', charge: 0, chargeTime: 1, dir: { x: 1, y: 0 } };
const { planets: ALL_PLANETS, auInWorldUnits: AU } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
  planetScale: 3,
  sunRadius: SUN.r,
  angleFor: (def) => ({ jupiter: 250, saturn: 60, mars: 120, earth: 330 }[def.id] ?? 0) * Math.PI / 180
});
for (const p of ALL_PLANETS) {
  p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
  p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
}
const JUPITER = ALL_PLANETS.find((p) => p.id === 'jupiter');

// ---------------------------------------------------------------------------
// Stan

const S = {
  scene: 'gallery',
  cam: { x: 0, y: 0, zoom: 0.22 },
  targetZoom: 0.22,
  // Płynny przelot kamery galerii do celu (zbliżenie na typ / rodzinę).
  camGoal: null,
  ship: { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0 },
  showShip: true,
  keys: new Set(),
  time: 0,
  frame: 0,
  fps: 60,
  dragging: null,
  speed: 1400,
  hideUi: false,
  typeRocks: [],
  shapeRocks: [],
  galleryCells: [],
  shapeCells: [],
  focus: -1,
  ready: false
};

const glCanvas = $('webgl-layer');
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth;
let H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  canvas2d.width = W; canvas2d.height = H;
  glCanvas.width = W; glCanvas.height = H;
  Core3D.resize(W, H);
}
canvas2d.width = W; canvas2d.height = H;
glCanvas.width = W; glCanvas.height = H;

initHexShips3D({ canvas: glCanvas });
setHexShips3DActive(true);
window.Core3D = Core3D;
window.initPlanets3D([JUPITER], SUN);
addEventListener('resize', resize);

const field = new AsteroidBeltField({ planets: ALL_PLANETS, sunX: SUN.x, sunY: SUN.y, auToWorld: AU });
let belt = null;
let typeSet = null;
let shapeSet = null;
let atlas = null;
// Eskorta: lotniskowiec Terran w szyku przy lewej burcie Atlasa — światła
// jednego okrętu (reflektory otoczenia, czerwień lamp) padają na drugi.
let escort = null;
const ESCORT_OFFSET = Object.freeze({ along: -300, side: -1250 });

// ---------------------------------------------------------------------------
// Miejsca scen (deterministycznie z pola)

function findSpot(rAu0, rAu1, want, accept = null) {
  let best = null;
  for (let i = 0; i < 6000; i++) {
    const a = (i / 6000) * Math.PI * 2;
    for (let k = 0; k < 6; k++) {
      const rAu = rAu0 + (rAu1 - rAu0) * (k + 0.5) / 6;
      const x = SUN.x + Math.cos(a) * rAu * AU;
      const y = SUN.y + Math.sin(a) * rAu * AU;
      const m = field.sampleMacro(x, y);
      let score = want === 'core' ? m.density : (m.weight > 0.99 ? -m.cluster : -9);
      if (accept && !accept(x, y)) score -= 9;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

// Atlas nie może stać na dużej skale gry: najbliższe miejsce przy punkcie bez
// skał ≥ 300 j. pod kadłubem (drobnicę gra rozepchnie). W rdzeniu pola wolnego
// koła o średnicy Atlasa nie ma w ogóle (~100 skał w promieniu 2,7 tys. j.).
function freeSpotNear(spot, clearR = 950) {
  const test = (x, y) => {
    let hit = false;
    field.forEachRockInRect(BELT_BAND.PLAY, x - clearR - 1400, y - clearR - 1400, x + clearR + 1400, y + clearR + 1400, 300, (r) => {
      if (!hit && Math.hypot(r.x - x, r.y - y) < r.r * 1.35 + clearR) hit = true;
    });
    return !hit;
  };
  for (let ring = 0; ring < 40; ring++) {
    const n = Math.max(1, ring * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = spot.x + Math.cos(a) * ring * 700;
      const y = spot.y + Math.sin(a) * ring * 700;
      if (test(x, y)) return { x, y };
    }
  }
  return spot;
}

const CORE = findSpot(37.5, 45.5, 'core');
// Przelot: start po stronie słońca, lot RADIALNIE od słońca przez rdzeń —
// wejście jasne, w głąb ciemniej (słońce przesłaniane przez pole).
const FLIGHT = (() => {
  const dx = CORE.x - SUN.x;
  const dy = CORE.y - SUN.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return { x: CORE.x - ux * 90000, y: CORE.y - uy * 90000, angle: Math.atan2(uy, ux), ux, uy };
})();

const SPOTS = {
  gallery: { x: SUN.x + 20 * AU, y: SUN.y - 0.3 * AU },
  shapes: { x: SUN.x + 20 * AU, y: SUN.y - 0.3 * AU + 9000 },
  // Olbrzymy w pustej przestrzeni (poza pasami), w pełnym słońcu.
  giants: { x: SUN.x + 23 * AU, y: SUN.y + 1.5 * AU },
  field: freeSpotNear(CORE),
  deep: null,   // najciemniejszy punkt linii przelotu — po zbudowaniu pasa (start)
  sparse: null, // rzadki pas w pełnym słońcu — po policzeniu cienia pól (start)
  storm: null,  // najsilniejsza burza energetyczna w mroku pola — po policzeniu cienia (start)
  kuiper: freeSpotNear(findSpot(126, 139, 'core'))
};
field.clearCache();

// ---------------------------------------------------------------------------
// Olbrzymy (asteroidGiants.js): siatki SDF liczone w workerach zaraz po
// starcie (w tle, gdy ogląda się galerie), render GiantRock3D po pieczeniu
// światła. W rzędzie wzdłuż x, w pustej przestrzeni w pełnym słońcu.

const GIANT_GAP = 16000;
const CAVE_SHIP_LIGHTS = Object.freeze({
  spot: Object.freeze({ ...FIELD_SHIP_LIGHTS.spot, tiltDeg: 14 }),
  omni: Object.freeze({ ...FIELD_SHIP_LIGHTS.omni, rangeMul: 3.2, maxRange: 6500, intensity: 0.8, scatter: 0.05 })
});
// Scena olbrzymów pozwala oddalić bardziej niż gra (0,035): Wrzeciono ma 62 tys. j.
const ZOOM_MIN_GIANTS = 0.012;
const GIANTS = (() => {
  const list = GIANT_PRESET_IDS.map((id) => ({ id, preset: GIANT_PRESETS[id], giant: null, view: null, progress: 0, error: null }));
  const widths = list.map((g) => g.preset.half[0] * 2);
  const total = widths.reduce((a, b) => a + b, 0) + GIANT_GAP * (list.length - 1);
  let x = SPOTS.giants.x - total / 2;
  list.forEach((g, i) => {
    g.x = x + widths[i] / 2;
    g.y = SPOTS.giants.y;
    x += widths[i] + GIANT_GAP;
  });
  return list;
})();
for (const g of GIANTS) { g.seed = 1; g.where = 'gallery'; }

// Olbrzym W POLU: Labirynt (inne ziarno) na obrzeżu gęstego pola, obok linii
// przelotu. Pole nie stawia skał gry w jego obrysie (field.setExclusions);
// tło pod płaszczyzną zostaje, olbrzym je zasłania.
const FIELD_GIANTS = (() => {
  const px = -FLIGHT.uy;
  const py = FLIGHT.ux;
  const id = 'warren';
  const x = FLIGHT.x + FLIGHT.ux * 52000 + px * 26000;
  const y = FLIGHT.y + FLIGHT.uy * 52000 + py * 26000;
  return [{ id, preset: GIANT_PRESETS[id], seed: 2, x, y, giant: null, view: null, progress: 0, error: null, where: 'field' }];
})();
const ALL_GIANTS = [...GIANTS, ...FIELD_GIANTS];
field.setExclusions(FIELD_GIANTS.map((g) => {
  const [hx, hy] = buildGiantPlan(g.id, g.seed).half;
  return { x: g.x, y: g.y, rx: hx + 600, ry: hy + 600 };
}));
let giantBuilder = null;

/** Olbrzym widoczny w scenie? Galeria olbrzymów osobno, olbrzym pola w scenach lotu. */
function giantVisibleIn(g, scene) {
  if (g.where === 'gallery') return scene === 'giants';
  return !GALLERY_SCENES.has(scene) && scene !== 'giants';
}

function startGiants() {
  giantBuilder = new GiantBuilder();
  // Najpierw olbrzym pola (scena „Olbrzym w polu”), potem galeria.
  for (const g of [...FIELD_GIANTS, ...GIANTS]) {
    const { giant, promise } = giantBuilder.build(g.id, g.seed, g.x, g.y, { onProgress: (p) => { g.progress = p; } });
    g.giant = giant;
    promise.then(() => {
      g.view = new GiantRock3D({ scene: Core3D.scene, renderer: Core3D.renderer, giant, noise: belt.noiseTarget.texture, sun: SUN, sunElevDeg: belt.light.sunElevDeg });
      g.view.setVisible(giantVisibleIn(g, S.scene));
      g.progress = 1;
    }).catch((err) => {
      g.error = err;
      reportError(`Olbrzym ${g.id}: ${err.stack || err}`);
    });
  }
}

/** Trasa olbrzyma w świecie gry (punkty [x, y]). */
function giantRoute(g) {
  const r = g.giant?.plan.routes[0];
  return r ? r.pts.map(([x, y]) => ({ x: g.x + x, y: g.y + y })) : [];
}

function giantFitZoom(g) {
  const [hx, hy] = g.preset.half;
  return Math.max(ZOOM_MIN_GIANTS, Math.min(ZOOM_MAX, Math.min(W / (hx * 2.35), H / (hy * 2.35))));
}

/** Statek przed wlotem trasy olbrzyma, dziobem do środka. */
function parkShipAtGiant(g) {
  const route = giantRoute(g);
  const ship = S.ship;
  ship.vx = 0; ship.vy = 0; ship.angVel = 0;
  if (route.length >= 2) {
    ship.x = route[0].x;
    ship.y = route[0].y;
    ship.angle = Math.atan2(route[1].y - route[0].y, route[1].x - route[0].x);
  } else {
    ship.x = g.x - g.preset.half[0] - 6000;
    ship.y = g.y;
    ship.angle = 0;
  }
}

/** Przelot trasą olbrzyma (autopilot; W/S/A/D przejmuje stery). */
function flyGiant(i) {
  const g = GIANTS[i];
  if (!g) return;
  if (S.scene !== 'giants') setScene('giants');
  parkShipAtGiant(g);
  S.focus = i;
  S.camGoal = null;
  S.cam.x = S.ship.x;
  S.cam.y = S.ship.y;
  S.targetZoom = 0.3;
  S.autopilot = { route: giantRoute(g), i: 1 };
  updateFocusButtons();
}

// Kolizja Atlasa z przekrojem z = 0 olbrzymów: koła wzdłuż osi kadłuba.
const _hit = { depth: 0, nx: 0, ny: 0 };
function collideShipWithGiants() {
  const ship = S.ship;
  const L = atlas?.__hullLength || 1800;
  const R = (atlas?.h || 800) * 0.46;
  const fx = Math.cos(ship.angle);
  const fy = Math.sin(ship.angle);
  for (const g of ALL_GIANTS) {
    if (!giantVisibleIn(g, S.scene)) continue;
    const giant = g.giant;
    if (!giant?.ready || !giant.containsWorld(ship.x, ship.y, L)) continue;
    for (let k = -2; k <= 2; k++) {
      const off = k * (L * 0.5 - R) / 2;
      const hit = giant.collideCircle(ship.x + fx * off, ship.y + fy * off, R, _hit);
      if (!hit) continue;
      ship.x += hit.nx * hit.depth;
      ship.y += hit.ny * hit.depth;
      const vn = ship.vx * hit.nx + ship.vy * hit.ny;
      if (vn < 0) {
        ship.vx -= vn * hit.nx * 1.3;
        ship.vy -= vn * hit.ny * 1.3;
      }
    }
  }
}

// Burza: w komórkach burz pasa głównego miejsce z największym skupiskiem
// skał energetycznych warstwy gry, w mroku pola (pioruny są tam jedynym
// światłem obok reflektorów); Atlas tuż obok, dziobem w skupisko.
function findStormSpot() {
  const cands = [];
  for (let i = 0; i < 2400; i++) {
    const a = (i / 2400) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const rAu = 37.5 + 8 * (k + 0.5) / 5;
      const x = SUN.x + Math.cos(a) * rAu * AU;
      const y = SUN.y + Math.sin(a) * rAu * AU;
      const st = field.stormAt(x, y);
      if (st > 0.7) cands.push({ x, y, st: st * (1.2 - belt.sunTransmittance(x, y)) });
    }
  }
  cands.sort((p, q) => q.st - p.st);
  let best = null;
  for (const c of cands.slice(0, 40)) {
    // Skały energetyczne w kadrze zoomu ~0,4 wokół punktu.
    let n = 0;
    field.forEachRockInRect(BELT_BAND.PLAY, c.x - 2200, c.y - 1300, c.x + 2200, c.y + 1300, 120, (r) => { if (r.type === ROCK_TYPE_INDEX.energy) n++; });
    const score = n * c.st;
    if (!best || score > best.score) best = { x: c.x, y: c.y, score, n };
  }
  if (!best) return null;
  const spot = freeSpotNear(best, 900);
  spot.angle = Math.atan2(best.y - spot.y, best.x - spot.x) || 0;
  spot.energyRocks = best.n;
  return spot;
}

function findDeepSpot() {
  let best = null;
  for (let d = 0; d <= 240000; d += 3000) {
    const x = FLIGHT.x + FLIGHT.ux * d;
    const y = FLIGHT.y + FLIGHT.uy * d;
    const T = belt.sunTransmittance(x, y);
    if (!best || T < best.T) best = { x, y, T, d };
  }
  return freeSpotNear(best);
}

// Orientacja pokazowa: najdłuższa oś kształtu (z mapy odczytu banku) leży
// w płaszczyźnie kadru pod kątem `angle`, obrót wokół osi prawie pionowej —
// owal i podwójna nie mogą patrzeć w kamerę czubkiem (wyglądałyby na kulę).
// mode 'long': długa oś w kadrze; 'crater': największy krater do kamery
// (pochylony, żeby wał rzucał cień); 'disc': płaska oś dysku ukośnie do kamery.
function showcaseOrientation(shape, angle, mode = 'long') {
  const bank = belt.bank;
  let dir;
  let target;
  if (mode === 'crater' && bank.params[shape]?.craters?.length) {
    const c = bank.params[shape].craters[0];
    dir = { x: c[0], y: c[1], z: c[2] };
    target = { x: Math.sin(0.55) * Math.cos(angle), y: Math.sin(0.55) * Math.sin(angle), z: Math.cos(0.55) };
  } else if (mode === 'disc') {
    dir = { x: 0, y: 0, z: 1 };
    target = { x: Math.sin(1.0) * Math.cos(angle), y: Math.sin(1.0) * Math.sin(angle), z: Math.cos(1.0) };
  } else {
    const a = bank.longAxis;
    dir = { x: a[shape * 3], y: a[shape * 3 + 1], z: a[shape * 3 + 2] };
    target = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
  }
  // Kwaternion obracający dir na target.
  const cx = dir.y * target.z - dir.z * target.y;
  const cy = dir.z * target.x - dir.x * target.z;
  const cz = dir.x * target.y - dir.y * target.x;
  const dot = dir.x * target.x + dir.y * target.y + dir.z * target.z;
  let q = [cx, cy, cz, 1 + dot];
  if (1 + dot < 1e-6) q = [0, 0, 1, 0];
  const n = Math.hypot(...q);
  return { qx: q[0] / n, qy: q[1] / n, qz: q[2] / n, qw: q[3] / n };
}

function galleryRock(o) {
  const orient = showcaseOrientation(o.shape, o.angle ?? 0.3, o.mode);
  // Oś obrotu prawie pionowa (lekko pochylona): skała pokazuje boki, a długa
  // oś zostaje w kadrze.
  const tilt = o.tilt ?? 0.35;
  const ax = Math.sin(tilt) * 0.6;
  const ay = Math.sin(tilt) * 0.8;
  const az = Math.cos(tilt);
  return {
    x: o.x, y: o.y, z: 0, r: o.d * 0.5, d: o.d,
    shape: o.shape, type: o.type,
    ...orient,
    ax, ay, az, spin: o.spin ?? 0.12,
    phase: o.phase ?? 0,
    sx: o.sx ?? 1, sy: o.sy ?? 0.95, sz: o.sz ?? 0.9,
    seed: o.seed ?? 0.37,
    label: o.label || null,
    sub: o.sub || null
  };
}

// Kształt dobrany do typu (jak w polu) — każdy typ w swojej ulubionej rodzinie.
const TYPE_SHOWCASE_FAMILY = { rock: 'cratered', iron: 'oval', silicon: 'rubble', copper: 'angular', titan: 'shard', ice: 'binary', crystal: 'angular', uran: 'potato', energy: 'ridged' };

function buildTypeGallery() {
  const rocks = [];
  const g = SPOTS.gallery;
  const COLS = 5;
  const cellW = 2100;
  const cellH = 2200;
  S.galleryCells = [];
  GALLERY_TYPES.forEach((typeId, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    // Niepełny ostatni rząd wyśrodkowany.
    const inRow = Math.min(COLS, GALLERY_TYPES.length - row * COLS);
    const cx = g.x + (col - (inRow - 1) / 2) * cellW;
    const cy = g.y + (row - 0.5) * cellH;
    const type = ROCK_TYPE_INDEX[typeId];
    const famIndex = ROCK_FAMILIES.findIndex((f) => f.id === TYPE_SHOWCASE_FAMILY[typeId]);
    const fam = Math.max(0, famIndex);
    const sizes = [
      { d: 1150, dx: -260, dy: 60, v: 0 },
      { d: 430, dx: 620, dy: -420, v: 1 },
      { d: 200, dx: 640, dy: 330, v: 2 },
      { d: 110, dx: 380, dy: 640, v: 3 }
    ];
    sizes.forEach((s, k) => {
      const famId = ROCK_FAMILIES[fam].id;
      rocks.push(galleryRock({
        x: cx + s.dx, y: cy + s.dy, d: s.d,
        shape: fam * SHAPE_VARIANTS + ((s.v + i) % SHAPE_VARIANTS),
        mode: famId === 'bowl' ? 'crater' : (famId === 'disc' ? 'disc' : 'long'),
        type,
        angle: 0.4 + k * 0.9 + i * 0.3,
        spin: 0.08 + k * 0.05,
        phase: i * 1.7 + k,
        seed: ((i * 7 + k * 3 + 1) * 0.0731) % 1,
        label: k === 0 ? ROCK_TYPE_LABELS_PL[typeId] : null
      }));
    });
    S.galleryCells.push({ x: cx - 100, y: cy + 60, zoom: 0.62, label: ROCK_TYPE_LABELS_PL[typeId] });
  });
  S.typeRocks = rocks;
  typeSet.set(rocks);
}

function buildShapeGallery() {
  const rocks = [];
  const g = SPOTS.shapes;
  const COLS = 5;
  const cellW = 2000;
  const cellH = 1900;
  S.shapeCells = [];
  ROCK_FAMILIES.forEach((fam, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = g.x + (col - (COLS - 1) / 2) * cellW;
    const cy = g.y + (row - 0.5) * cellH;
    // Główny wariant duży, trzy pozostałe mniejsze w kolumnie obok.
    const mode = fam.id === 'bowl' ? 'crater' : (fam.id === 'disc' ? 'disc' : 'long');
    rocks.push(galleryRock({
      x: cx - 250, y: cy, d: 1100, shape: i * SHAPE_VARIANTS, type: ROCK_TYPE_INDEX.rock, mode,
      angle: 0.35, spin: 0.16, phase: i, seed: (i * 0.137) % 1, label: fam.label
    }));
    for (let v = 1; v < SHAPE_VARIANTS; v++) {
      rocks.push(galleryRock({
        x: cx + 620, y: cy + (v - 2) * 520, d: 420, shape: i * SHAPE_VARIANTS + v, type: ROCK_TYPE_INDEX.rock, mode,
        angle: 0.2 + v, spin: 0.2, phase: i + v, seed: ((i * 5 + v) * 0.173) % 1
      }));
    }
    S.shapeCells.push({ x: cx + 100, y: cy, zoom: 0.62, label: fam.label });
  });
  S.shapeRocks = rocks;
  shapeSet.set(rocks);
}

const SCENES = ['gallery', 'shapes', 'giants', 'giantField', 'field', 'flight', 'deep', 'sparse', 'kuiper', 'storm'];
const GALLERY_SCENES = new Set(['gallery', 'shapes']);
// Eskorta nie leci pod stropy olbrzymów (tunele są na jeden okręt).
const ESCORT_OFF_SCENES = new Set(['gallery', 'shapes', 'giants', 'giantField']);

function galleryOverviewZoom(name) {
  // Cała galeria w kadrze (10 500 × 4400 j. typów, 10 000 × 3800 kształtów).
  return name === 'shapes' ? Math.min(W / 10400, H / 4300) : Math.min(W / 10900, H / 4700);
}

function setScene(name) {
  S.scene = name;
  S.focus = -1;
  S.camGoal = null;
  S.camHold = null;
  S.autopilot = null;
  for (const b of document.querySelectorAll('[data-scene]')) b.classList.toggle('on', b.dataset.scene === name);
  const spot = SPOTS[name] || SPOTS.field;
  const ship = S.ship;
  ship.vx = 0; ship.vy = 0; ship.angVel = 0;
  if (GALLERY_SCENES.has(name)) {
    S.cam.x = spot.x; S.cam.y = spot.y;
    S.cam.zoom = S.targetZoom = galleryOverviewZoom(name);
  } else if (name === 'giantField') {
    // Olbrzym w polu: Atlas przed wlotem tunelu, dookoła gęste pole.
    const g = FIELD_GIANTS[0];
    parkShipAtGiant(g);
    S.cam.x = S.ship.x; S.cam.y = S.ship.y;
    S.cam.zoom = S.targetZoom = 0.3;
  } else if (name === 'giants') {
    // Start: Pustka (jaskinia na flotę) w kadrze, Atlas przed jej wlotem.
    const g = GIANTS.find((x) => x.id === 'hollow') || GIANTS[0];
    S.focus = GIANTS.indexOf(g);
    parkShipAtGiant(g);
    S.cam.x = g.x; S.cam.y = g.y;
    S.cam.zoom = S.targetZoom = giantFitZoom(g);
    S.camGoal = { x: g.x, y: g.y };
  } else if (name === 'flight') {
    // Start po stronie słońca, lot radialnie od słońca przez rdzeń pola.
    ship.angle = FLIGHT.angle;
    ship.x = FLIGHT.x;
    ship.y = FLIGHT.y;
    S.cam.x = ship.x; S.cam.y = ship.y;
    S.cam.zoom = S.targetZoom = 0.45;
  } else {
    ship.x = spot.x; ship.y = spot.y;
    // W głębi pola dziób od słońca (reflektory świecą w mrok).
    ship.angle = name === 'deep' ? FLIGHT.angle : (name === 'storm' ? (spot.angle ?? 0) : -0.4);
    S.cam.x = ship.x; S.cam.y = ship.y;
    S.cam.zoom = S.targetZoom = name === 'deep' ? 0.6 : (name === 'storm' ? 0.4 : 1.0);
  }
  // Transmitancja wokół sceny liczona od razu (sektory, ~30 ms) — nie w trakcie lotu.
  belt?.sunOcclusion.prefetch(S.cam.x, S.cam.y, 200000);
  typeSet?.setVisible(name === 'gallery');
  shapeSet?.setVisible(name === 'shapes');
  for (const g of ALL_GIANTS) g.view?.setVisible(giantVisibleIn(g, name));
  updateFocusButtons();
}

/** Scena olbrzymów: kamera na olbrzyma i (przelatuje), statek przed jego wlotem. */
function focusGiant(i) {
  const n = GIANTS.length;
  const idx = ((i % n) + n) % n;
  const g = GIANTS[idx];
  S.focus = idx;
  S.autopilot = null;
  parkShipAtGiant(g);
  S.camGoal = { x: g.x, y: g.y };
  S.targetZoom = giantFitZoom(g);
  updateFocusButtons();
}

/** Zbliżenie galerii na kafel i (−1 = cała galeria). */
function focusGallery(i) {
  const cells = S.scene === 'shapes' ? S.shapeCells : S.galleryCells;
  if (!GALLERY_SCENES.has(S.scene) || !cells.length) return;
  const n = cells.length;
  S.focus = i < -1 ? n - 1 : (i >= n ? -1 : i);
  if (S.focus < 0) {
    const spot = SPOTS[S.scene];
    S.camGoal = { x: spot.x, y: spot.y };
    S.targetZoom = galleryOverviewZoom(S.scene);
  } else {
    const c = cells[S.focus];
    S.camGoal = { x: c.x, y: c.y };
    S.targetZoom = Math.min(ZOOM_MAX, c.zoom * Math.min(W / 1600, H / 900));
  }
  updateFocusButtons();
}

function updateFocusButtons() {
  const box = $('focus');
  if (!box) return;
  if (S.scene === 'giants') {
    // Olbrzymy: „pokaż” (kamera na bryłę) i „▶ przelot” (autopilot trasą) dla każdego.
    box.style.display = '';
    if (box.dataset.scene !== 'giants') {
      box.dataset.scene = 'giants';
      box.innerHTML = '';
      GIANTS.forEach((g, i) => {
        const show = document.createElement('button');
        show.textContent = g.preset.label;
        show.title = g.preset.desc;
        show.dataset.focus = String(i);
        show.addEventListener('click', () => focusGiant(i));
        const fly = document.createElement('button');
        fly.textContent = '▶ przelot';
        fly.title = `Autopilot trasą: ${g.preset.label} (W/S/A/D przejmuje stery)`;
        fly.dataset.fly = String(i);
        fly.addEventListener('click', () => flyGiant(i));
        box.append(show, fly);
      });
    }
    for (const b of box.querySelectorAll('button')) {
      const i = Number(b.dataset.focus ?? b.dataset.fly);
      b.classList.toggle('on', i === S.focus && (b.dataset.fly ? !!S.autopilot : !S.autopilot));
    }
    return;
  }
  const cells = S.scene === 'shapes' ? S.shapeCells : (S.scene === 'gallery' ? S.galleryCells : []);
  box.style.display = cells.length ? '' : 'none';
  if (box.dataset.scene !== S.scene || box.childElementCount !== cells.length + 1) {
    box.dataset.scene = S.scene;
    box.innerHTML = '';
    const all = document.createElement('button');
    all.textContent = 'całość';
    all.dataset.focus = '-1';
    box.appendChild(all);
    cells.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.dataset.focus = String(i);
      box.appendChild(b);
    });
    for (const b of box.querySelectorAll('button')) b.addEventListener('click', () => focusGallery(Number(b.dataset.focus)));
  }
  for (const b of box.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.focus) === S.focus);
}

// ---------------------------------------------------------------------------
// Atlas (sprite → kadłub heksowy jak w warp-demo; tylko do skali i światła)

async function loadAtlas() {
  const img = new Image();
  img.src = atlasUrl;
  await img.decode();
  const size = getHullRenderSize('atlas', img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.w; canvas.height = size.h;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const e = { isPlayer: true, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    hull: { val: 12000, max: 12000 }, shield: { val: 0, max: 1 }, mass: 800000, visual: { spriteScale: 1 }, w: size.w, h: size.h,
    // Światła z edytora (20 pozycyjnych + 2 reflektory na dziobie) — te same
    // znaczniki oświetlają kadłub w hexShips3D i dają reflektory pola.
    // Znaczniki są w pikselach PNG, kadłub w grze ma size.w j. długości.
    editorLights: ATLAS_EDITOR_DEFAULTS.lights,
    __hardpointScale: size.w / img.naturalWidth };
  initHexBody(e, canvas);
  if (!e.hexGrid) throw new Error('Atlas: initHexBody bez siatki');
  e.hexGrid.visualImage = img;
  e.hexGrid.meshDirty = true;
  e.hexGrid.meshDirtyAll = true;
  e.hexGrid.textureDirty = true;
  e.hexGrid.gpuTextureNeedsUpdate = true;
  prewarmHexShipVisual(img);
  e.__hullLength = size.w;
  return e;
}

/** Lotniskowiec Terran jak NPC w grze: sprite gry, światła z domyślnego układu edytora. */
async function loadEscort() {
  const img = new Image();
  img.src = carrierUrl;
  await img.decode();
  const size = getHullRenderSize('terran_carrier', img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.w; canvas.height = size.h;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
  const e = { id: 'escort', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    hull: { val: 6000, max: 6000 }, shield: { val: 0, max: 1 }, mass: 300000, visual: { spriteScale: 1 }, w: size.w, h: size.h,
    editorLights: SHIP_EDITOR_DEFAULTS.ships?.terran_carrier?.lights || null,
    __hardpointScale: size.w / img.naturalWidth };
  initHexBody(e, canvas);
  if (!e.hexGrid) throw new Error('Eskorta: initHexBody bez siatki');
  e.hexGrid.visualImage = img;
  e.hexGrid.meshDirty = true;
  e.hexGrid.meshDirtyAll = true;
  e.hexGrid.textureDirty = true;
  e.hexGrid.gpuTextureNeedsUpdate = true;
  prewarmHexShipVisual(img);
  e.__hullLength = size.w;
  return e;
}

// ---------------------------------------------------------------------------
// Wejście

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
  // 1–9 = pierwsze dziewięć scen, 0 = dziesiąta (burza).
  const sceneIdx = k === '0' ? 9 : (k.length === 1 && k >= '1' && k <= '9' ? Number(k) - 1 : -1);
  if (sceneIdx >= 0 && sceneIdx < SCENES.length) setScene(SCENES[sceneIdx]);
  if (GALLERY_SCENES.has(S.scene) && (k === 'arrowright' || k === 'arrowleft')) {
    e.preventDefault();
    focusGallery(S.focus + (k === 'arrowright' ? 1 : -1));
  }
  if (S.scene === 'giants' && (k === 'arrowright' || k === 'arrowleft')) {
    e.preventDefault();
    focusGiant(S.focus + (k === 'arrowright' ? 1 : -1));
  }
  if (S.scene === 'giants' && k === 'enter') flyGiant(Math.max(0, S.focus));
  if (S.scene === 'giantField' && k === 'enter') {
    parkShipAtGiant(FIELD_GIANTS[0]);
    S.autopilot = { route: giantRoute(FIELD_GIANTS[0]), i: 1 };
  }
  // Sterowanie ręczne przejmuje autopilota i kamerę.
  if ((S.scene === 'giants' || S.scene === 'giantField') && 'wsadqe'.includes(k) && k.length === 1) {
    if (S.autopilot) { S.autopilot = null; updateFocusButtons(); }
    S.camGoal = null;
  }
  if (k === 'l') { const c = $('t-lights'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
  if (k === 'z') S.targetZoom = 1;
  if (k === 'x') S.targetZoom = ZOOM_MIN;
  if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
  if (k === 'm') { const c = $('t-dust'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zMin = S.scene === 'giants' ? ZOOM_MIN_GIANTS : ZOOM_MIN;
  S.targetZoom = Math.min(ZOOM_MAX, Math.max(zMin, S.targetZoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });
canvas2d.addEventListener('pointerdown', (e) => {
  S.dragging = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, moved: false };
  canvas2d.setPointerCapture(e.pointerId);
});
canvas2d.addEventListener('pointermove', (e) => {
  if (!S.dragging || !(GALLERY_SCENES.has(S.scene) || S.scene === 'giants')) return;
  if (Math.hypot(e.clientX - S.dragging.x, e.clientY - S.dragging.y) > 4) S.dragging.moved = true;
  if (!S.dragging.moved) return;
  S.cam.x = S.dragging.cx - (e.clientX - S.dragging.x) / S.cam.zoom;
  S.cam.y = S.dragging.cy - (e.clientY - S.dragging.y) / S.cam.zoom;
  // Galerie: kamera zostaje; olbrzymy: kamera stoi w przeciągniętym miejscu (nie wraca do statku).
  S.camGoal = S.scene === 'giants' ? { x: S.cam.x, y: S.cam.y } : null;
});
canvas2d.addEventListener('pointerup', (e) => {
  // Klik (bez przeciągnięcia) w galerii = zbliżenie na najbliższy kafel.
  if (S.dragging && !S.dragging.moved && GALLERY_SCENES.has(S.scene)) {
    const wx = S.cam.x + (e.clientX - W * 0.5) / S.cam.zoom;
    const wy = S.cam.y + (e.clientY - H * 0.5) / S.cam.zoom;
    const cells = S.scene === 'shapes' ? S.shapeCells : S.galleryCells;
    let best = -1;
    let bd = Infinity;
    cells.forEach((c, i) => { const d = Math.hypot(c.x - wx, c.y - wy); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 1400) focusGallery(best === S.focus ? -1 : best);
  }
  S.dragging = null;
});

for (const b of document.querySelectorAll('[data-scene]')) b.addEventListener('click', () => setScene(b.dataset.scene));

function bindRange(id, outId, fmt, apply) {
  const el = $(id);
  const out = $(outId);
  const run = () => { const v = Number(el.value); out.textContent = fmt(v); apply(v); };
  el.addEventListener('input', run);
  run();
}
const f2 = (v) => v.toFixed(2).replace('.', ',');
function bindControls() {
  const toggle = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  toggle('t-play', (v) => belt.setBandVisible(BELT_BAND.PLAY, v));
  toggle('t-rubble', (v) => belt.setBandVisible(BELT_BAND.RUBBLE, v));
  toggle('t-mid', (v) => belt.setBandVisible(BELT_BAND.MID, v));
  toggle('t-deep', (v) => belt.setBandVisible(BELT_BAND.DEEP, v));
  toggle('t-dust', (v) => belt.dust.setVisible(v));
  toggle('t-ship', (v) => { S.showShip = v; });
  toggle('t-detail', (v) => belt.setUniform('uDetail', v ? 1 : 0));
  toggle('t-veins', (v) => belt.setUniform('uVeins', v ? 1 : 0));
  toggle('t-lod', (v) => belt.setUniform('uDebugLod', v ? 1 : 0));
  toggle('t-bloom', (v) => { if (typeof Core3D.setPerfToggles === 'function') Core3D.setPerfToggles({ bloom: v }); });
  bindRange('s-elev', 'o-elev', (v) => `${v}°`, (v) => belt.setLight({ sunElevDeg: v }));
  bindRange('s-sun', 'o-sun', f2, (v) => belt.setLight({ sunIntensity: v }));
  bindRange('s-amb', 'o-amb', f2, (v) => belt.setLight({
    ambientTop: [0.16 * v, 0.18 * v, 0.22 * v], ambientBounce: [0.10 * v, 0.085 * v, 0.07 * v]
  }));
  bindRange('s-lunar', 'o-lunar', f2, (v) => belt.setLight({ lunar: v }));
  let densTimer = null;
  bindRange('s-dens', 'o-dens', (v) => `×${f2(v)}`, (v) => {
    clearTimeout(densTimer);
    densTimer = setTimeout(() => {
      belt.setDensityScale(v);
      // Nowa gęstość = nowy cień pól: od razu cały, w tle (nie sektorami w locie).
      if (!belt.sunOcclusion.memoryBytes) belt.sunOcclusion.precomputeAll();
    }, 120);
  });
  bindRange('s-fog', 'o-fog', f2, (v) => { belt.dust.look.density = v; belt.dust.applyLook(); });
  bindRange('s-fogb', 'o-fogb', f2, (v) => { belt.dust.look.brightness = v; belt.dust.applyLook(); });
  bindRange('s-fogs', 'o-fogs', f2, (v) => { belt.dust.look.shadow = v; belt.dust.applyLook(); });
  bindRange('s-specks', 'o-specks', f2, (v) => { belt.dust.look.specks = v; });
  bindRange('s-speed', 'o-speed', (v) => `${v}`, (v) => { S.speed = v; });
  // Mechanika pola: przesłanianie słońca, zasłona tła, światła statku.
  toggle('t-lights', (v) => { belt.lights.enabled = v; });
  toggle('t-veil', (v) => { belt.dust.veilEnabled = v; });
  toggle('t-rocklights', (v) => { belt.rockLightsEnabled = v; });
  toggle('t-floods', (v) => { belt.lights.floodsEnabled = v; });
  toggle('t-navglow', (v) => { belt.lights.navEnabled = v; });
  toggle('t-escort', (v) => { S.showEscort = v; });
  toggle('t-storm', (v) => { belt.storm.setVisible(v); belt.dust.stormGlow = v ? 0.12 : 0; });
  let occTimer = null;
  let occFirst = true;
  bindRange('s-occ', 'o-occ', (v) => `×${f2(v)}`, (v) => {
    if (occFirst) { occFirst = false; return; } // start: cień już policzony
    clearTimeout(occTimer);
    occTimer = setTimeout(() => {
      belt.setOcclusionStrength(v);
      belt.sunOcclusion.precomputeAll();       // w tle, oddaje wątek
    }, 150);
  });
  bindRange('s-light', 'o-light', f2, (v) => { belt.lights.strength = v; });
  bindRange('s-beam', 'o-beam', f2, (v) => { belt.lights.beamStrength = v; });
}

// ---------------------------------------------------------------------------
// Pętla

function stepAutopilot(dt) {
  const ship = S.ship;
  const ap = S.autopilot;
  const pts = ap.route;
  while (ap.i < pts.length - 1 && Math.hypot(pts[ap.i].x - ship.x, pts[ap.i].y - ship.y) < 1400) ap.i++;
  const tgt = pts[ap.i];
  const want = Math.atan2(tgt.y - ship.y, tgt.x - ship.x);
  let da = want - ship.angle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  ship.angle += Math.max(-1.2 * dt, Math.min(1.2 * dt, da * Math.min(1, dt * 4)));
  const speed = Math.min(S.speed, 1600);
  const k = 1 - Math.exp(-2.5 * dt);
  ship.vx += (Math.cos(ship.angle) * speed - ship.vx) * k;
  ship.vy += (Math.sin(ship.angle) * speed - ship.vy) * k;
  if (ap.i >= pts.length - 1 && Math.hypot(tgt.x - ship.x, tgt.y - ship.y) < 1500) {
    S.autopilot = null;
    ship.vx *= 0.3; ship.vy *= 0.3;
    updateFocusButtons();
  }
}

function stepShip(dt) {
  const ship = S.ship;
  if (GALLERY_SCENES.has(S.scene)) return;
  if (S.scene === 'flight') {
    ship.vx = Math.cos(ship.angle) * S.speed;
    ship.vy = Math.sin(ship.angle) * S.speed;
  } else if (S.autopilot) {
    stepAutopilot(dt);
  } else {
    const k = S.keys;
    const boost = k.has('shift') ? 3 : 1;
    const accel = 900 * boost;
    if (k.has('w')) { ship.vx += Math.cos(ship.angle) * accel * dt; ship.vy += Math.sin(ship.angle) * accel * dt; }
    if (k.has('s')) { ship.vx -= Math.cos(ship.angle) * accel * 0.6 * dt; ship.vy -= Math.sin(ship.angle) * accel * 0.6 * dt; }
    if (k.has('q')) { ship.vx += Math.sin(ship.angle) * accel * 0.5 * dt; ship.vy -= Math.cos(ship.angle) * accel * 0.5 * dt; }
    if (k.has('e')) { ship.vx -= Math.sin(ship.angle) * accel * 0.5 * dt; ship.vy += Math.cos(ship.angle) * accel * 0.5 * dt; }
    const turn = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    ship.angVel += (turn * 0.9 - ship.angVel) * (1 - Math.exp(-4 * dt));
    ship.angle += ship.angVel * dt;
    const sp = Math.hypot(ship.vx, ship.vy);
    const cap = S.speed * boost;
    if (sp > cap) { ship.vx *= cap / sp; ship.vy *= cap / sp; }
    const drag = Math.exp(-0.35 * dt);
    ship.vx *= drag; ship.vy *= drag;
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  collideShipWithGiants();
}

function stepCamera(dt) {
  const lz = Math.log(S.cam.zoom);
  const lt = Math.log(S.targetZoom);
  S.cam.zoom = Math.exp(lz + (lt - lz) * (1 - Math.exp(-9 * dt)));
  if (GALLERY_SCENES.has(S.scene) || (S.scene === 'giants' && S.camGoal)) {
    if (S.camGoal) {
      const k = 1 - Math.exp(-6 * dt);
      S.cam.x += (S.camGoal.x - S.cam.x) * k;
      S.cam.y += (S.camGoal.y - S.cam.y) * k;
    }
  } else if (S.camHold) {
    // Kamera trzymana na punkcie (__demo.lookAt — zrzuty, zbliżenia).
    S.cam.x = S.camHold.x; S.cam.y = S.camHold.y;
  } else {
    // Z eskortą kamera celuje w środek szyku (oba okręty w kadrze).
    let tx = S.ship.x;
    let ty = S.ship.y;
    if (escort && S.showEscort && !ESCORT_OFF_SCENES.has(S.scene)) {
      const c = Math.cos(S.ship.angle);
      const s = Math.sin(S.ship.angle);
      tx += (c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side) * 0.5;
      ty += (s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side) * 0.5;
    }
    const k = 1 - Math.exp(-8 * dt);
    S.cam.x += (tx - S.cam.x) * k;
    S.cam.y += (ty - S.cam.y) * k;
    if (S.scene === 'flight') { S.cam.x = tx; S.cam.y = ty; }
  }
}

const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const giantFrame = { cam: null, viewW: 0, viewH: 0, dt: 0, light: null };
const renderList = [];
let lastT = performance.now();
let beltMs = 0;

function frame(nowMs, forcedDt = null) {
  const realDt = forcedDt ?? Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  S.frame++;
  S.fps = S.fps * 0.95 + (realDt > 0 ? 1 / realDt : 60) * 0.05;
  S.time += realDt;
  stepShip(realDt);
  stepCamera(realDt);
  const cam = S.cam;
  window.updatePlanets3D?.(Math.max(realDt, 1e-4), cam);
  renderList.length = 0;
  if (atlas && S.showShip && !GALLERY_SCENES.has(S.scene)) {
    atlas.x = atlas.pos.x = S.ship.x;
    atlas.y = atlas.pos.y = S.ship.y;
    atlas.angle = S.ship.angle;
    renderList.push(atlas);
    if (escort && S.showEscort && !ESCORT_OFF_SCENES.has(S.scene)) {
      // Szyk: przy lewej burcie, lekko z tyłu, ten sam kurs.
      const c = Math.cos(S.ship.angle);
      const s = Math.sin(S.ship.angle);
      escort.x = escort.pos.x = S.ship.x + c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side;
      escort.y = escort.pos.y = S.ship.y + s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side;
      escort.angle = S.ship.angle;
      renderList.push(escort);
    }
  }
  // Światła statków w polu (reflektory dalekie, otoczenia, dookoła, czerwień
  // lamp pozycyjnych) — przed aktualizacją pasa, który wpisuje je do uniformów.
  belt.lights.begin(cam, S.time);
  // Pod stropem olbrzyma (tunel, jaskinia): reflektory pochylone w dół do dna
  // i szersze światło dookoła — inaczej dno 1–1,5 tys. j. niżej zostaje czarne.
  const underRoof = ALL_GIANTS.some((g) => g.view && g.view.mesh.visible && g.view.cut.open > 0.3);
  for (const e of renderList) belt.lights.addShip(e, e.__hullLength, underRoof ? CAVE_SHIP_LIGHTS : undefined);
  const t0 = performance.now();
  const f = belt.update({ cam, viewW: W, viewH: H, time: S.time, dt: realDt, sunX: SUN.x, sunY: SUN.y });
  if (typeSet && S.scene === 'gallery') typeSet.update(f);
  if (shapeSet && S.scene === 'shapes') shapeSet.update(f);
  if (!GALLERY_SCENES.has(S.scene)) {
    // Przekrój wokół Atlasa pod stropem (tunel, jaskinia, nawis kanionu).
    const focus = atlas && S.showShip ? { x: S.ship.x, y: S.ship.y, len: atlas.__hullLength } : null;
    giantFrame.cam = cam; giantFrame.viewW = W; giantFrame.viewH = H; giantFrame.dt = realDt; giantFrame.light = belt.light;
    for (const g of ALL_GIANTS) if (g.view?.mesh.visible) g.view.update(giantFrame, focus);
  }
  beltMs = beltMs * 0.9 + (performance.now() - t0) * 0.1;
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 2000; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 2000;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  // Błyski burzy padają też na pancerze (rozlew w pętli lamp kadłuba).
  setHexShipWorldLights(belt.storm.enabled ? belt.storm.flashes : null);
  updateHexShips3D(cam, renderList, cullInfo);
  // Pule efektów gry (iskry burzy): w grze aktualizuje je Weapon3DSystem, tu
  // demo — po zsynchronizowaniu kamery tej klatki, przed renderem.
  Fx3D.update(realDt);
  drawHexShips3D(ctx2d, W, H);
  drawOverlay(cam);
  updateHud();
}

function drawOverlay(cam) {
  if (S.hideUi) return;
  if (S.scene === 'giants') {
    // Podpisy olbrzymów (nad bryłą) i postęp budowy, dopóki siatka się liczy.
    ctx2d.save();
    ctx2d.font = '600 14px ui-monospace, Consolas, monospace';
    ctx2d.textAlign = 'center';
    for (const g of GIANTS) {
      const x = (g.x - cam.x) * cam.zoom + W * 0.5;
      const y = (g.y - g.preset.half[1] * 1.05 - cam.y) * cam.zoom + H * 0.5 - 10;
      if (x < -300 || x > W + 300 || y < -40 || y > H + 40) continue;
      ctx2d.fillStyle = 'rgba(200,225,240,0.88)';
      const state = g.view ? '' : (g.error ? ' — błąd' : ` — liczę ${Math.round(g.progress * 100)}%`);
      ctx2d.fillText(`${g.preset.label}${state}`, x, y);
    }
    ctx2d.restore();
    return;
  }
  if (!GALLERY_SCENES.has(S.scene)) return;
  ctx2d.save();
  ctx2d.font = `600 ${Math.round(Math.min(18, Math.max(12, 12 + cam.zoom * 6)))}px ui-monospace, Consolas, monospace`;
  ctx2d.textAlign = 'center';
  for (const r of (S.scene === 'shapes' ? S.shapeRocks : S.typeRocks)) {
    if (!r.label) continue;
    const x = (r.x - cam.x) * cam.zoom + W * 0.5;
    const y = (r.y - cam.y) * cam.zoom + H * 0.5 - r.r * 1.3 * cam.zoom - 12;
    ctx2d.fillStyle = 'rgba(200,225,240,0.88)';
    ctx2d.fillText(r.label, x, y);
  }
  ctx2d.restore();
}

function fmt(n) { return Math.round(n).toLocaleString('pl-PL'); }

function updateHud() {
  if (S.frame % 6) return;
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const st = belt.stats;
  const m = field.sampleMacro(S.cam.x, S.cam.y);
  const dx = S.cam.x - SUN.x;
  const dy = S.cam.y - SUN.y;
  const lods = belt.layers[BELT_BAND.PLAY]?.stats.lods.map((l) => (l < 0 ? '·' : l)).join('') || '';
  const lines = [];
  lines.push(`<b>ASTEROIDY 3D</b>  ${S.fps.toFixed(0)} FPS · draw calle ${r.calls || 0} · trójkąty ${fmt(r.triangles || 0)}`);
  lines.push(`scena: ${S.scene} · zoom ${S.cam.zoom.toFixed(3).replace('.', ',')} · ${(Math.hypot(dx, dy) / AU).toFixed(2).replace('.', ',')} AU od Słońca`);
  lines.push(`pas: waga ${m.weight.toFixed(2)} · pole ${m.cluster.toFixed(2)} · ${(m.density * 1920 * 1080).toFixed(2).replace('.', ',')} skał gry/ekran@1`);
  lines.push(`w kadrze: gra ${fmt(st.drawn[0])} · gruz ${fmt(st.drawn[1])} · środek ${fmt(st.drawn[2])} · głębia ${fmt(st.drawn[3])} · ${fmt(st.tris / 1000)} tys. trójkątów skał`);
  lines.push(`wczytane ${fmt(st.instances[0] + st.instances[1] + st.instances[2] + st.instances[3])} · komórki ${fmt(st.cells)} · w kolejce ${st.pending} · LOD gry [${lods}]`);
  lines.push(`pas.update ${beltMs.toFixed(2).replace('.', ',')} ms · pieczenie ${belt.bakeMs.toFixed(0)} ms (${belt.bank.count} kształtów)`);
  const Tship = belt.sunTransmittance(S.ship.x, S.ship.y);
  const occ = belt.sunOcclusion.stats;
  const stm = belt.storm;
  if (stm.intensity > 0.01 || stm.stats.strikes) lines.push(`burza ${(stm.intensity * 100).toFixed(0)}% · skały energetyczne ${stm.stats.rocks} · pioruny ${stm.stats.strikes} · błyski w chmurach ${stm.stats.sheets} · łącznie ${stm.sim.stats.strikes}`);
  lines.push(`słońce przy statku ${(Tship * 100).toFixed(0)}% · zasłona tła ${(belt.dust.veilUniforms.uVeil.value * 100).toFixed(0)}% · światła ${belt.lights.stats.lights}/${belt.lights.stats.requested} · smugi ${belt.lights.stats.beams}`);
  lines.push(`cień pól: ${occ.sectorsBuilt} sektorów, ${(occ.buildMs / 1000).toFixed(1).replace('.', ',')} s, ${(belt.sunOcclusion.memoryBytes / 1048576).toFixed(1).replace('.', ',')} MB · mapa ${belt.fieldMap.builds}× (${belt.fieldMap.buildMs.toFixed(1)} ms)`);
  if (S.scene === 'giants' || S.scene === 'giantField') {
    const g = S.scene === 'giantField' ? FIELD_GIANTS[0] : (GIANTS[S.focus] || GIANTS[0]);
    const ready = GIANTS.filter((x) => x.view).length;
    const cutOpen = g.view ? Math.round(g.view.cut.open * 100) : 0;
    lines.push(`olbrzymy: ${ready}/${GIANTS.length} gotowe · ${g.preset.label}: ${g.preset.desc}`);
    if (g.giant) lines.push(`siatka ${g.giant.dims.nx}×${g.giant.dims.ny}×${g.giant.dims.nz} (${g.preset.voxel} j.) · ${g.giant.buildMs ? (g.giant.buildMs / 1000).toFixed(1).replace('.', ',') + ' s w workerach' : '…'} · światło ${g.view ? g.view.bakeMs.toFixed(0) + ' ms' : '…'} · przekrój ${cutOpen}%${S.autopilot ? ' · AUTOPILOT' : ''}`);
  }
  if (!GALLERY_SCENES.has(S.scene)) lines.push(`Atlas: ${fmt(Math.hypot(S.ship.vx, S.ship.vy))} j/s · W/S/A/D/Q/E, Shift · L światła`);
  $('hud').innerHTML = lines.join('\n');
}

function loop(nowMs) {
  try { frame(nowMs); } catch (err) { reportError(err.stack || String(err)); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  // Pieczenie po pierwszej ramce (napis „ładowanie” zdąży się pokazać).
  await new Promise((r) => setTimeout(r, 30));
  belt = new AsteroidBelt3D({ scene: Core3D.scene, renderer: Core3D.renderer, field });
  typeSet = belt.createRockSet({ name: 'galleryTypes', capacity: 64 });
  shapeSet = belt.createRockSet({ name: 'galleryShapes', capacity: 64 });
  buildTypeGallery();
  buildShapeGallery();
  // Olbrzymy liczą się w workerach w tle (galerie są od razu).
  startGiants();
  // Cień pól liczony RAZ dla całego układu (jak na ekranie ładowania gry) —
  // w locie żadnego dociągania sektorów.
  await belt.sunOcclusion.precomputeAll({
    onProgress: (p) => { $('loading').textContent = `Liczenie cienia pól asteroid… ${Math.round(p * 100)}%`; }
  });
  bindControls();
  try { atlas = await loadAtlas(); } catch (err) { reportError(`Atlas: ${err.message}`); }
  try { escort = await loadEscort(); } catch (err) { reportError(`Eskorta: ${err.message}`); }
  SPOTS.deep = findDeepSpot();
  // Rzadki pas w pełnym słońcu: ~10% rzadkiego pasa leży w cieniu pól bliżej
  // słońca (fizycznie poprawne), a ta scena ma pokazać zwykły, jasny pas.
  SPOTS.sparse = freeSpotNear(findSpot(38.5, 44.5, 'sparse', (x, y) => belt.sunTransmittance(x, y) > 0.9));
  SPOTS.storm = findStormSpot();
  field.clearCache();
  const initial = params.get('scene');
  setScene(SCENES.includes(initial) ? initial : 'gallery');
  if (params.has('zoom')) S.cam.zoom = S.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(params.get('zoom')) || 1));
  $('loading').style.display = 'none';
  S.ready = true;
  window.__demo = {
    S, belt, field, SPOTS, FLIGHT, AU,
    setScene,
    focusGallery,
    GIANTS, FIELD_GIANTS, focusGiant, flyGiant,
    ships: () => ({ atlas, escort }),
    // Kamera na punkcie (null = z powrotem za statkiem / szykiem).
    lookAt: (x, y, zoom) => { S.camHold = Number.isFinite(x) ? { x, y } : null; if (zoom) S.cam.zoom = S.targetZoom = zoom; },
    setZoom: (z) => { S.cam.zoom = S.targetZoom = z; },
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(performance.now(), dt); },
    stats: () => ({
      ...belt.stats,
      calls: Core3D.lastFrameRenderInfo?.total?.calls ?? null,
      fps: S.fps,
      Tship: +belt.sunTransmittance(S.ship.x, S.ship.y).toFixed(3),
      Tcam: +belt.sunTAtCamera.toFixed(3),
      veil: +belt.dust.veilUniforms.uVeil.value.toFixed(3),
      cluster: +field.sampleMacro(S.ship.x, S.ship.y).cluster.toFixed(3),
      lights: belt.lights.stats.lights,
      beams: belt.lights.stats.beams,
      maskOn: Core3D.sunOcclusionField ? 1 : 0
    })
  };
  requestAnimationFrame(loop);
}

start().catch((err) => reportError(err.stack || String(err)));
