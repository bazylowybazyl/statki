// Demo WARPA „PĘD” (2026-10-19) — porównanie stylów skoku Atlasa na PRAWDZIWYCH modułach gry. User: „przekombinowałem
// z zawijanym efektem warp — myślę, czy nie wrócić do soczewki, czy zrobić po prostu dużą prędkość”. Wszystko jak w grze:
// Core3D (WebGPU, TSL, bloom, ACES), planety, mgławica i gwiazdy (planet3d.assets.js: initPlanets3D / updatePlanets3D,
// soczewka świata), warp „Nurt” (src/3d/warp — WarpNurt: ośrodek, bańka, smugi gwiazd, fale, plazma z dysz), kadłub
// Atlasa na belkach (HullBodies + hexShips3D), kamera z rigu gry (cameraRig.js: kop, oddalenie, wyprzedzenie) i automat
// skoku jak w index.html (ładowanie 0,8 s, prędkość przelotowa z planWarpCruise, zwolnienie przy ciałach, rampa wyjścia).
// Styl skoku = warpDrive.js: setWarpStyle (w grze: ?warp=rulon|ped|akcent|soczewka, ?rulon=0):
//   1 RULON (dziś w grze) · 2 PĘD — sama prędkość · 3 PĘD + AKCENTY — soczewka tylko na przejściach · 4 SOCZEWKA bańki.
// Wyjście: Z PĘDEM (rampa hamuje do k × prędkość bojowa Atlasa i statek leci dalej; createWarpExitRamp — vEnd) albo do
// zatrzymania (dziś w grze). Po otwarciu od razu: podróż Ziemia → Jowisz (przelot obok Marsa) w pętli.
//
// Serwowanie: `npm run dev` → /dema/warp-ped.html   ?styl=rulon|ped|akcent|soczewka   ?trasa=jowisz|mars   ?ped=0|1..6
//   ?clean=1 (bez paneli)   ?test=1 (klatki tylko z __warpPed.runFrames — harness zrzutów: scripts/webgpu/warp-ped-demo.mjs)
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { WarpNurt } from '../src/3d/warp/warpNurt.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import '../src/3d/planet3d.assets.js';
import { SimClock } from '../src/game/simClock.js';
import {
  planWarpCruise, warpFlybyFactor, createWarpExitRamp, sampleWarpExitRamp, warpExitRampDistance,
  setWarpStyle, warpStyle, warpRulonEnabled, WARP_EXIT, WARP_STYLES
} from '../src/game/warpDrive.js';
import {
  createCameraRig, createCameraRigTune, stepCameraRig, stepCameraRigWarp, stepCameraRigRoll, noteCameraRigWarp,
  defaultShipZoom, cameraShakeAmplitudePx, sampleCameraShakePx, CAMERA_WARP_ROLL_MODES
} from '../src/game/cameraRig.js';
import { rolledHalfExtents } from '../src/3d/viewRoll.js';
import { buildSystemMap } from '../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { DEFAULT_PLANET_SCALE } from '../src/config/constants.js';
import { SHIP_FLIGHT_SPECS } from '../src/data/shipFlightSpecs.js';
import { World, loadHullAssets } from './mostki-webgpu/swiat.js';
// Reszta świata jak w grze (2026-10-19, user: „a co z resztą świata? asteroidy, ringi”): ringi „Halo” Ziemi, Marsa
// i Jowisza (świat ringów gry + obraz HaloRingGame) i pas asteroid (świat pasa gry + obraz AsteroidBelt).
import { HaloRingWorld } from '../src/game/haloRingWorld.js';
import { HaloRingGame } from '../src/3d/haloRing/haloRingGame.js';
import { computeHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createBeltWorld } from '../src/game/beltWorld.js';
import { createAsteroidBelt } from '../src/3d/asteroids/asteroidBelt.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
if (params.get('clean') === '1') document.body.classList.add('clean');
const $ = (id) => document.getElementById(id);
function reportError(text) {
  const el = $('errors');
  el.style.display = 'block';
  el.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Stałe

const PHYS_DT = 1 / 120;
const ATLAS = SHIP_FLIGHT_SPECS.atlas;          // gracz kalibruje się do tej tabeli: bojowa 500 j/s, hamowanie 200 j/s²
const WARP_SPEED = 260000;                      // index.html: jedna prędkość warpa (swobodny skok)
const STYLE_INFO = {
  rulon: { k: 'RULON', d: 'dziś w grze — świat zwija się w walec i lejek do statku' },
  ped: { k: 'PĘD', d: 'sama prędkość — nic się nie gnie: smugi, ośrodek, planety mijają' },
  akcent: { k: 'PĘD + AKCENTY', d: 'soczewka tylko na przejściach: naciąg przed dziobem → pęknięcie → sprężenie przy wyjściu' },
  soczewka: { k: 'SOCZEWKA BAŃKI', d: 'przestrzeń gnie się wokół statku przez cały skok (kadłub nietknięty)' }
};
// Układ planet: kurs Ziemia → Jowisz idzie W POPRZEK kierunku do Słońca (start nad terminatorem Ziemi, tarcze
// planet z terminatorem, cień kadłuba w bok od kursu, nie wzdłuż niego), Mars stoi na tym kursie z boku dalszego
// od Słońca (`MARS_LATERAL`) — przelot w soczewce świata ze zwolnieniem „grawitacją” (jak w demie „Nurt”) i oświetloną
// stroną do statku. Reszta planet daleko od trasy.
const EARTH_ANGLE = -0.62;
const JUPITER_ANGLE = EARTH_ANGLE + 1.2;
const MARS_LATERAL = 75000;     // [j.] Mars od kursu Ziemia → Jowisz
const OTHER_ANGLES = { mercury: 2.3, venus: 2.0, saturn: 2.9, uranus: -2.5, neptune: -1.6 };
const ROUTES = {
  jowisz: { from: 'earth', to: 'jupiter', label: 'Ziemia → Jowisz' },
  mars: { from: 'earth', to: 'mars', label: 'Ziemia → Mars' }
};
const START_GAP = 9000;    // [j.] start nad brzegiem planety startu (rufą do niej)
const STOP_GAP = 2600;     // [j.] gdzie statek kończy (po ślizgu z pędem) przed brzegiem celu — tarcza w kadrze
const HOLD_START = 1.6;    // [s] postój przed ładowaniem
const HOLD_END = 2.6;      // [s] po wyjściu (ślizg + chwila), potem pętla

// ---------------------------------------------------------------------------
// Stan

const S = {
  paused: false, timeScale: 1, acc: 0, frame: 0, time: 0, frameMs: 16, cpuMs: 0,
  style: WARP_STYLES.includes(params.get('styl')) ? params.get('styl') : 'akcent',
  momentum: params.get('ped') !== '0',
  dropK: Math.max(1, Math.min(6, Number(params.get('ped')) || 3)),
  route: ROUTES[params.get('trasa')] ? params.get('trasa') : 'jowisz',
  // Kamera w skoku (K): obrót kadru kursem w górę / w prawo / bez obrotu (cameraRig.js: stepCameraRigRoll).
  camRoll: CAMERA_WARP_ROLL_MODES.includes(params.get('kamera')) ? params.get('kamera') : 'up',
  // Zoom w skoku (Z): stały — kadr skoku liczony od domyślnego zoomu statku, nie od zoomu gracza (stepCameraRigWarp:
  // zoomRef); 'gracz' — oddalenie × zoom gracza (dawniej).
  warpZoom: params.get('zoomSkoku') === 'gracz' ? 'gracz' : 'staly',
  // Lot swobodny (F): W/S ciąg, A/D obrót, Shift dopalacz, CapsLock / 9 — warp (jak w grze: przełącznik).
  free: false,
  keys: { w: false, s: false, a: false, d: false, shift: false }
};
setWarpStyle(S.style);

// Automat warpa — pola jak `warp` gry (index.html): czytają je WarpNurt, dysze (engineVfxSystem) i rig kamery.
const warp = {
  state: 'idle', charge: 0, chargeTime: 0.8, speed: WARP_SPEED, cruise: WARP_SPEED,
  flybyFactor: 1, originBody: null, targetBody: null, tripPlan: null, gear: 1,
  dir: { x: 1, y: 0 }, entryProgress: 0, entryDuration: 0.9, entryBaseSpeed: 0, chargeAngle: NaN, exitRamp: null,
  isBusy() { return this.state !== 'idle' || !!(this.exitRamp && this.exitRamp.active); }
};
window.warp = warp;

const trip = {
  phase: 'start', t: 0, startX: 0, startY: 0, endX: 0, endY: 0, limbX: 0, limbY: 0, dirX: 1, dirY: 0, angle: 0, from: null, to: null,
  jumpT: 0, exitT: 0, stopT: 0, glideFrom: 0, maxSpeed: 0, cruise: 0, planTime: 0, flyMin: 1
};
const flyBodies = [];      // { planet, x, y, r } — ciała zwolnienia (bez startu i celu)
let nFly = 0;
const _rampSample = { speed: 0, phase: 'done', tb: 0 };

// Słońce jak w grze (index.html: SUN — środek świata 12 mln j.).
const SUN = {
  x: 6_000_000, y: 6_000_000, r: 823, r3D: 399,
  color: { core: '#ffe88a', mid: '#ffbe3b', rim: '#ff8c1a' },
  corona: { rays: 72, jitter: 0.35, length: 0.85, pulse: 0.22, haze: 2.8 },
  seed: 93731
};
window.SUN = SUN;

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D

const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth, H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: 'assets/reflections/lacquer-sky.png' };   // <base href="/">
initHexShips3D({ canvas: glCanvas });
window.Core3D = Core3D;

let world = null;
let atlas = null;
let planets = [];
let haloWorld = null;      // świat ringów gry (kolidery, automat K-7, zegar świateł hal)
let haloRings = null;      // obraz ringów (HaloRingGame)
let beltWorld = null;      // świat pasa gry (pole, cień pól, olbrzymy)
let asteroidBelt = null;   // obraz pasa (AsteroidBelt — kroki Core3D.fx)
// Statek dla ringów (obrys w hubie hal K-7) i pasa — pola jak `ship` gry (pos, angle, w, h).
const shipView = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, w: 0, h: 0, dead: false };
const _beltFocus = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
const renderList = [];

// Kamera: rig gry (kop i oddalenie warpa w czasie gry, wyprzedzenie lotu) + zoom gracza (kółko).
const camTune = createCameraRigTune();
const rig = createCameraRig();
let zoomBase = 0.2;
const cam = { x: 0, y: 0, zoom: 0.2 };            // bez wstrząsu (planety, ośrodek)
const camShake = { x: 0, y: 0, zoom: 0.2 };       // z wstrząsem (kadłuby)
const shake = { mag: 0, dur: 0, t: 0 };
window.camera = {
  x: 0, y: 0, zoom: 0.2, targetZoom: 0.2, minZoom: 0.02, maxZoom: 3.2, mode: 'ship',
  addShake(mag, dur) { addShake(mag, dur); }
};
function addShake(mag, dur) {
  // jak requestCameraShake: nie słabszy od bieżącego
  const now = shake.dur > 0 ? shake.mag * Math.max(0, 1 - shake.t / shake.dur) : 0;
  if (mag >= now) { shake.mag = mag; shake.dur = Math.max(0.05, dur); shake.t = 0; }
}
const warpCamIn = { dt: 0, state: 'idle', charge: 0, dirX: 1, dirY: 0, enabled: true, suspend: false, exitAge: -1, exitSlow: 0.7, exitHalt: 1.35, rulon: true };
const rigIn = {
  dt: 0, viewW: 1, viewH: 1, mouseX: 0, mouseY: 0, lookEnabled: false, mode: 'never',
  velX: 0, velY: 0, maxSpeed: ATLAS.maxSpeed, holdDt: 0, insetTop: 0, insetBottom: 0, lookScale: 1, biasX: 0, biasY: 0
};
const rollIn = { dt: 0, state: 'idle', dirX: 1, dirY: 0, exitAge: -1, exitHalt: 0, enabled: true, mode: 'up' };
const _rollHalf = { hw: 0, hh: 0 };
const _shakeOut = { x: 0, y: 0 };
const pose = { x: 0, y: 0, angle: 0 };

// ---------------------------------------------------------------------------
// Świat: planety z mapy układu gry (te same odległości i promienie), Atlas na belkach

function bodyRadius(p) {
  // index.html: warpBodyRadius — planety z ringiem „Halo” mają tarczę ringu, reszta × 4,5 (planet3d.assets.js).
  return RING_PLANET_WORLD_RADII[p.id] || (Number(p.r) || 100) * 4.5;
}
// Zasięg ciała, przed którym staje statek: zewnętrzna krawędź ringu „Halo” (ring jest w grze przeszkodą — statek nie
// staje w nim), inaczej tarcza.
function bodyStopRadius(p) {
  return RING_PLANET_WORLD_RADII[p.id] ? Math.max(bodyRadius(p), computeHaloRingLayout(p).outerRadius) : bodyRadius(p);
}
function planetById(id) { return planets.find((p) => p.id === id) || null; }

// Kąt orbity Marsa: punkt kursu Ziemia → Jowisz na promieniu orbity Marsa, przesunięty o MARS_LATERAL w bok
// dalszy od Słońca.
function marsAngle(rE, rM, rJ) {
  const ex = rE * Math.cos(EARTH_ANGLE), ey = rE * Math.sin(EARTH_ANGLE);
  const jx = rJ * Math.cos(JUPITER_ANGLE), jy = rJ * Math.sin(JUPITER_ANGLE);
  const dx = jx - ex, dy = jy - ey;
  // |E + t·D| = rM → a t² + b t + c = 0 (pierwiastek dalszy, 0 < t < 1)
  const a = dx * dx + dy * dy;
  const b = 2 * (ex * dx + ey * dy);
  const c = ex * ex + ey * ey - rM * rM;
  const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  const px = ex + dx * t, py = ey + dy * t;
  const len = Math.sqrt(a);
  let nx = -dy / len, ny = dx / len;
  if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }   // bok dalszy od Słońca
  return Math.atan2(py + ny * MARS_LATERAL, px + nx * MARS_LATERAL);
}

function buildPlanets() {
  const belt = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
  const opts = { planetScale: DEFAULT_PLANET_SCALE, sunRadius: SUN.r };
  // Dwa przebiegi: promienie orbit (mapa odpycha planety od siebie), potem kąty z geometrii kursu.
  const radii = {};
  for (const p of buildSystemMap(belt, { ...opts, angleFor: () => 0 }).planets) radii[p.id] = p.orbitRadius;
  const angles = {
    ...OTHER_ANGLES, earth: EARTH_ANGLE, jupiter: JUPITER_ANGLE,
    mars: marsAngle(radii.earth, radii.mars, radii.jupiter)
  };
  const { planets: list, auInWorldUnits } = buildSystemMap(belt, { ...opts, angleFor: (def) => angles[def.id] ?? 0 });
  // Skala AU świata (pas asteroid liczy pasma w AU mapy — jak gra: window.WORLD_UNITS_PER_AU).
  window.WORLD_UNITS_PER_AU = auInWorldUnits;
  window.AU_IN_WORLD_UNITS = auInWorldUnits;
  for (const p of list) {
    if (p.baseR == null) p.baseR = p.r;
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
    p.label = p.name.charAt(0).toUpperCase() + p.name.slice(1);
  }
  return list;
}

function hullLength() {
  const h = atlas?.beamHull;
  return h ? Math.max(h.srcWidth, h.srcHeight) * h.scale : 1800;
}

// ---------------------------------------------------------------------------
// Podróż: start nad brzegiem planety startu → ładowanie → skok → wyjście (rampa) → ślizg → pętla

function setupTrip() {
  const R = ROUTES[S.route];
  const from = planetById(R.from);
  const to = planetById(R.to);
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  dx /= d; dy /= d;
  // Start i koniec przed ringiem planety (ring „Halo” — przeszkoda w grze), inaczej przed tarczą.
  const rF = bodyStopRadius(from);
  const rT = bodyStopRadius(to);
  trip.from = from;
  trip.to = to;
  trip.startX = from.x + dx * (rF + START_GAP);
  trip.startY = from.y + dy * (rF + START_GAP);
  trip.limbX = to.x - dx * rT;
  trip.limbY = to.y - dy * rT;
  trip.dirX = dx;
  trip.dirY = dy;
  updateTripEnd();
  trip.angle = Math.atan2(dy, dx);
  nFly = 0;
  for (const p of planets) {
    if (p === from || p === to) continue;
    let b = flyBodies[nFly];
    if (!b) { b = { planet: null, x: 0, y: 0, r: 1 }; flyBodies[nFly] = b; }
    b.planet = p; b.x = p.x; b.y = p.y; b.r = bodyRadius(p);
    nFly++;
  }
  restartTrip();
}

// Koniec rampy wyjścia: przed brzegiem celu o STOP_GAP i o drogę ślizgu z pędem (vEnd → bojowa z hamowaniem `decel`),
// żeby statek stanął przy tarczy w kadrze w obu trybach wyjścia.
function updateTripEnd() {
  const vEnd = S.momentum ? S.dropK * ATLAS.maxSpeed : 0;
  const glide = vEnd > ATLAS.maxSpeed ? (vEnd * vEnd - ATLAS.maxSpeed * ATLAS.maxSpeed) / (2 * ATLAS.decel) : 0;
  trip.endX = trip.limbX - trip.dirX * (STOP_GAP + glide);
  trip.endY = trip.limbY - trip.dirY * (STOP_GAP + glide);
}

function restartTrip() {
  atlas.x = trip.startX;
  atlas.y = trip.startY;
  atlas.vx = 0; atlas.vy = 0;
  atlas.angle = trip.angle;
  atlas.angVel = 0;
  warp.state = 'idle';
  warp.charge = 0;
  warp.chargeAngle = NaN;
  warp.entryProgress = 0;
  warp.exitRamp = null;
  warp.flybyFactor = 1;
  warp.cruise = WARP_SPEED;
  warp.originBody = trip.from;
  warp.targetBody = trip.to;
  warp.dir.x = Math.cos(trip.angle);
  warp.dir.y = Math.sin(trip.angle);
  trip.phase = 'start';
  trip.t = 0;
  trip.maxSpeed = 0;
  trip.flyMin = 1;
  // kamera od razu przy statku (teleport — ośrodek warpa sam zaczyna od nowa po skoku kamery), kadr osiami świata
  rig.offsetX = 0; rig.offsetY = 0;
  rig.roll = 0; rig.rollVel = 0;
  cam.x = atlas.x; cam.y = atlas.y;
}

function engageWarp() {
  const e = atlas;
  const angle = Number.isFinite(warp.chargeAngle) ? warp.chargeAngle : e.angle;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  warp.dir.x = dirX;
  warp.dir.y = dirY;
  if (S.free) {
    // Swobodny skok (gra: WARP_SPEED, bez celu soczewki) — zwolnienie przy każdym ciele poza najbliższym (start).
    let origin = null;
    let best = 100000;
    for (const p of planets) {
      const d = Math.hypot(p.x - e.x, p.y - e.y) - bodyRadius(p);
      if (d < best) { best = d; origin = p; }
    }
    nFly = 0;
    for (const p of planets) {
      if (p === origin) continue;
      let b = flyBodies[nFly];
      if (!b) { b = { planet: null, x: 0, y: 0, r: 1 }; flyBodies[nFly] = b; }
      b.planet = p; b.x = p.x; b.y = p.y; b.r = bodyRadius(p);
      nFly++;
    }
    warp.originBody = origin;
    warp.targetBody = null;
    warp.cruise = WARP_SPEED;
    warp.tripPlan = null;
    warp.flybyFactor = 1;
    warp.state = 'active';
    warp.entryProgress = 0;
    warp.entryBaseSpeed = Math.hypot(e.vx, e.vy);
    e.angVel = 0;
    trip.cruise = WARP_SPEED;
    trip.planTime = 0;
    trip.jumpT = S.time;
    noteCameraRigWarp(rig, 'kick');
    return;
  }
  // index.html: planPlayerWarp — prędkość przelotowa z planu (czas podróży jak w demie „Nurt”), ciała zwolnienia.
  const dist = (trip.endX - e.x) * dirX + (trip.endY - e.y) * dirY;
  const bodies = [];
  for (let i = 0; i < nFly; i++) {
    const b = flyBodies[i];
    const ox = b.x - e.x;
    const oy = b.y - e.y;
    bodies.push({ along: ox * dirX + oy * dirY, lateral: oy * dirX - ox * dirY, r: b.r });
  }
  const v0 = Math.hypot(e.vx, e.vy);
  const plan = planWarpCruise({ dist, v0, hullLength: hullLength(), bodies, zone: null, entry: warp.entryDuration, lag: 6, dt: 1 / 30 });
  warp.cruise = plan.speed;
  warp.tripPlan = { dist: Math.round(dist), speed: Math.round(plan.speed), time: +plan.time.toFixed(2) };
  warp.flybyFactor = 1;
  warp.state = 'active';
  warp.entryProgress = 0;
  warp.entryBaseSpeed = v0;
  e.angVel = 0;
  trip.cruise = plan.speed;
  trip.planTime = plan.time;
  trip.jumpT = S.time;
  noteCameraRigWarp(rig, 'kick');
}

function exitWarp() {
  const speed = Math.hypot(atlas.vx, atlas.vy);
  const vEnd = S.momentum ? S.dropK * ATLAS.maxSpeed : 0;
  warp.exitRamp = createWarpExitRamp({ v0: speed, hullLength: hullLength(), dirX: warp.dir.x, dirY: warp.dir.y, vEnd });
  warp.state = 'idle';
  warp.chargeAngle = NaN;
  warp.entryProgress = 0;
  trip.exitT = S.time;
}

const smooth01 = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

// Lot swobodny (F): obrót, ciąg i hamowanie z tabeli lotu Atlasa (shipFlightSpecs.js), Shift — dopalacz (limit
// `boostSpeed`, governor w physicsStep). Kąt całkuje World.step z `angVel`.
function freeFlight(e, dt) {
  const K = S.keys;
  const turnRate = ATLAS.turnRate * Math.PI / 180;
  const turnStep = ATLAS.turnAccel * Math.PI / 180 * dt;
  const want = ((K.d ? 1 : 0) - (K.a ? 1 : 0)) * turnRate;
  const dw = want - (e.angVel || 0);
  e.angVel = (e.angVel || 0) + Math.max(-turnStep, Math.min(turnStep, dw));
  const c = Math.cos(e.angle);
  const s = Math.sin(e.angle);
  if (K.w) {
    const a = ATLAS.accel * (K.shift ? 2 : 1) * dt;
    e.vx += c * a;
    e.vy += s * a;
  }
  if (K.s) {
    const v = Math.hypot(e.vx, e.vy);
    if (v > 0) { const nv = Math.max(0, v - ATLAS.decel * dt); e.vx *= nv / v; e.vy *= nv / v; }
  }
  const throttle = K.w ? (K.shift ? 1 : 0.85) : 0.3;
  for (const t of e.visual?.mainThrusters || []) t.__throttle = throttle;
}

// Warp w locie swobodnym: CapsLock / 9 jak w grze (przełącznik) — ładowanie w kierunku dziobu, drugi raz — wyjście.
function toggleFreeWarp() {
  if (!S.free) return;
  if (warp.state === 'active') { exitWarp(); return; }
  if (warp.state === 'charging') { warp.state = 'idle'; warp.charge = 0; warp.chargeAngle = NaN; return; }
  if (warp.exitRamp && warp.exitRamp.active) return;
  warp.state = 'charging';
  warp.charge = 0;
  warp.chargeAngle = NaN;
  atlas.angVel = 0;
}

function setFree(on) {
  S.free = !!on;
  if (S.free) {
    trip.phase = 'wolny';
    trip.t = 0;
  } else {
    setupTrip();
  }
  syncPanel();
}

// Krok fizyki 120 Hz: automat warpa (jak physicsStep gry), fazy podróży, ruch encji i silnik belek (World.step).
function physicsStep(dt) {
  S.time += dt;
  trip.t += dt;
  const e = atlas;
  if (warp.state === 'charging') {
    if (!Number.isFinite(warp.chargeAngle)) warp.chargeAngle = e.angle;
    warp.dir.x = Math.cos(warp.chargeAngle);
    warp.dir.y = Math.sin(warp.chargeAngle);
    if (warp.charge < warp.chargeTime) warp.charge += dt;
    if (warp.charge >= warp.chargeTime) engageWarp();
  } else if (warp.state === 'active') {
    warp.entryProgress = Math.min(1, warp.entryProgress + dt / Math.max(0.001, warp.entryDuration));
    const ease = smooth01(warp.entryProgress);
    warp.flybyFactor = warpFlybyFactor(e.x, e.y, warp.dir.x, warp.dir.y, flyBodies, nFly);
    trip.flyMin = Math.min(trip.flyMin, warp.flybyFactor);
    const maxV = (warp.cruise || warp.speed) * warp.flybyFactor;
    const startV = Math.min(warp.entryBaseSpeed, maxV);
    const target = startV + (maxV - startV) * ease;
    const k = Math.min(1, 6 * dt);
    e.vx += (warp.dir.x * target - e.vx) * k;
    e.vy += (warp.dir.y * target - e.vy) * k;
    // TRAVEL TO: wyjście, gdy do końca odcinka zostaje droga rampy wyjścia (lot swobodny — klawiszem).
    if (!S.free) {
      updateTripEnd();   // tryb wyjścia (pęd / zatrzymanie) przełączany w locie
      const rem = (trip.endX - e.x) * warp.dir.x + (trip.endY - e.y) * warp.dir.y;
      const v = Math.hypot(e.vx, e.vy);
      const vEnd = S.momentum ? S.dropK * ATLAS.maxSpeed : 0;
      if (rem <= warpExitRampDistance(v, hullLength(), vEnd)) exitWarp();
    }
  } else if (warp.exitRamp && warp.exitRamp.active) {
    const r = warp.exitRamp;
    const wasBrake = r.age >= r.tBrake;
    r.age += dt;
    const s = sampleWarpExitRamp(r, r.age, _rampSample);
    if (!wasBrake && r.age >= r.tBrake) noteCameraRigWarp(rig, 'exit');
    e.vx = r.dirX * s.speed;
    e.vy = r.dirY * s.speed;
    if (s.phase === 'done') {
      r.active = false;
      trip.stopT = S.time;
      trip.glideFrom = s.speed;
    }
  } else {
    // Zwykły lot: lot swobodny (ciąg i obrót z tabeli lotu Atlasa), nadmiar ponad limit zbiera hamowanie
    // (governor modelu lotu: `decel`) — także po wyjściu z pędem.
    if (S.free) freeFlight(e, dt);
    const limit = S.free && S.keys.shift ? ATLAS.boostSpeed : ATLAS.maxSpeed;
    const v = Math.hypot(e.vx, e.vy);
    if (v > limit) {
      const nv = Math.max(limit, v - ATLAS.decel * dt);
      e.vx *= nv / v;
      e.vy *= nv / v;
    }
  }
  trip.maxSpeed = Math.max(trip.maxSpeed, Math.hypot(e.vx, e.vy));

  // Fazy podróży (pętla).
  if (S.free) {
    // bez pętli
  } else if (trip.phase === 'start' && trip.t >= HOLD_START) {
    trip.phase = 'skok';
    warp.state = 'charging';
    warp.charge = 0;
    warp.chargeAngle = NaN;
  } else if (trip.phase === 'skok' && warp.state === 'idle' && warp.exitRamp && !warp.exitRamp.active) {
    trip.phase = 'po';
    trip.t = 0;
  } else if (trip.phase === 'po' && trip.t >= HOLD_END + (S.momentum ? 2.5 : 0)) {
    restartTrip();
  }
  world.step(dt);
}

// ---------------------------------------------------------------------------
// Kamera (jak updateCameraWarpKick + rig gry) i klatka

function stepCamera(realDt, gameDt) {
  // Rampa wyjścia: wiek po zatrzymaniu rośnie zegarem gry (kamera dogania statek — WARP_EXIT.settle).
  const ramp = warp.exitRamp;
  let exitAge = -1;
  let exitSlow = 0.7;
  let exitHalt = 1.35;
  if (ramp) {
    if (!ramp.active) ramp.age += gameDt;
    if (ramp.age < ramp.tHalt + WARP_EXIT.settle + 0.3) {
      exitAge = ramp.age;
      exitSlow = ramp.tSlowEnd;
      exitHalt = ramp.tHalt;
    } else if (!ramp.active) {
      warp.exitRamp = null;
    }
  }
  // Ślizg z pędem po rampie wyjścia (statek szybszy niż jego zwykły lot, bez dopalacza): kamera skoku trzyma kadr
  // i kurs do końca dolotu (stepCameraRigWarp / stepCameraRigRoll: arriving).
  const arriving = trip.exitT > trip.jumpT && warp.state === 'idle' && !(ramp && ramp.active) && !S.keys.shift
    && S.time - trip.exitT < 20 && Math.hypot(atlas.vx, atlas.vy) > ATLAS.maxSpeed + 1;
  // Obrót kadru w skoku (cameraRig.js: stepCameraRigRoll): kurs w górę ekranu od ładowania do chwili po zatrzymaniu.
  const r0 = rollIn;
  r0.arriving = arriving;
  r0.dt = gameDt;
  r0.state = warp.state;
  r0.dirX = warp.dir.x;
  r0.dirY = warp.dir.y;
  r0.exitAge = exitAge;
  r0.exitHalt = exitHalt;
  r0.mode = S.camRoll;
  stepCameraRigRoll(rig, r0, camTune);
  const roll = rig.roll;
  const rc = Math.cos(roll);
  const rs = Math.sin(roll);
  // Kop i wyprzedzenie riga liczą się w osiach EKRANU: kurs i prędkość obrócone o −roll (viewRoll.js).
  const w = warpCamIn;
  w.dt = gameDt;
  w.state = warp.state;
  w.charge = warp.chargeTime > 0 ? warp.charge / warp.chargeTime : 0;
  if (warp.dir.x || warp.dir.y) {
    w.dirX = rc * warp.dir.x + rs * warp.dir.y;
    w.dirY = -rs * warp.dir.x + rc * warp.dir.y;
  }
  w.rulon = warpRulonEnabled('');
  w.exitAge = exitAge;
  w.exitSlow = exitSlow;
  w.exitHalt = exitHalt;
  // Ujednolicony kadr skoku: oddalenie od domyślnego zoomu statku (ten sam kadr przy każdym zoomie gracza).
  w.zoomRef = S.warpZoom === 'staly' ? defaultShipZoom(W, hullLength(), camTune) : 0;
  w.zoomBase = zoomBase;
  w.arriving = arriving;
  // Kadr przylotu: odległość statku od bliskiego brzegu tarczy celu (bodyRadius — jak gra: tarcza ringu albo r × 4,5);
  // lot swobodny — bez celu.
  const tgt = warp.targetBody;
  w.arrivalDist = tgt ? Math.max(0, Math.hypot(tgt.x - atlas.x, tgt.y - atlas.y) - bodyRadius(tgt)) : -1;
  w.viewW = W;
  w.viewH = H;
  stepCameraRigWarp(rig, w, camTune);
  const zoom = zoomBase * Math.exp(rig.warpZoomLog);
  const ri = rigIn;
  ri.dt = realDt;
  ri.holdDt = gameDt;
  ri.viewW = W; ri.viewH = H;
  ri.mouseX = W * 0.5; ri.mouseY = H * 0.5;
  ri.velX = rc * atlas.vx + rs * atlas.vy;
  ri.velY = -rs * atlas.vx + rc * atlas.vy;
  stepCameraRig(rig, ri, camTune);
  pose.x = atlas.x; pose.y = atlas.y; pose.angle = atlas.angle;
  window.__interpShipPose = pose;
  // Offset riga [px ekranu] → świat: R(roll).
  const ox = rig.offsetX / zoom;
  const oy = rig.offsetY / zoom;
  cam.x = pose.x + rc * ox - rs * oy;
  cam.y = pose.y + rs * ox + rc * oy;
  cam.zoom = zoom;
  cam.roll = roll;
  // wstrząs: camera.addShake (WarpNurt.onShake) + drżenie ładowania (rig.warpShakePx) — px ekranu → świat
  if (shake.dur > 0) { shake.t += realDt; if (shake.t >= shake.dur) shake.dur = 0; }
  const mag = shake.dur > 0 ? shake.mag * (1 - shake.t / shake.dur) : 0;
  const amp = cameraShakeAmplitudePx(mag, 0, camTune, rig.warpShakePx);
  sampleCameraShakePx(amp, S.time + S.frame * 0.0001, camTune, _shakeOut);
  camShake.x = cam.x + (rc * _shakeOut.x - rs * _shakeOut.y) / zoom;
  camShake.y = cam.y + (rs * _shakeOut.x + rc * _shakeOut.y) / zoom;
  camShake.zoom = zoom;
  camShake.roll = roll;
  const c = window.camera;
  c.x = cam.x; c.y = cam.y; c.zoom = zoom; c.targetZoom = zoomBase; c.roll = roll;
}

const nurtFrame = { dt: 0, cam, camShake, camFollow: true, ship: null, warp, trafficTime: 0, lensAllowed: true };

let lastNow = 0;
function frame(realDt) {
  const t0 = performance.now();
  S.frame++;
  const gameDt = S.paused ? 0 : realDt * S.timeScale;
  S.acc += gameDt;
  let steps = 0;
  while (S.acc >= PHYS_DT && steps < 24) {
    physicsStep(PHYS_DT);
    S.acc -= PHYS_DT;
    steps++;
  }
  if (steps >= 24) S.acc = 0;
  render(realDt, gameDt);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
}

function syncShipView() {
  shipView.pos.x = atlas.x;
  shipView.pos.y = atlas.y;
  shipView.vel.x = atlas.vx;
  shipView.vel.y = atlas.vy;
  shipView.angle = atlas.angle;
  shipView.h = hullLength();
  shipView.w = shipView.h * 0.36;
}

function render(realDt, gameDt) {
  stepCamera(realDt, gameDt);
  SimClock.beginRender(1, PHYS_DT, S.paused || gameDt <= 0);
  // Kolejność jak render() gry: warp „Nurt” (pisze soczewkę świata) → planety → kadłuby → obraz na kanwę 2D.
  nurtFrame.dt = gameDt;
  nurtFrame.ship = atlas;
  nurtFrame.trafficTime = S.time;
  WarpNurt.update(nurtFrame);
  window.updatePlanets3D(gameDt, cam);
  // Reszta świata jak render() gry: świat ringów (zegar świateł hal, automat K-7) → obraz ringów (kamera TEJ klatki ze
  // wstrząsem — ring liczy pozycje względem kamery) → świat pasa (olbrzymy przy kamerze i statku) → wejście klatki pasa.
  syncShipView();
  if (haloWorld) haloWorld.frame({ nowMs: performance.now(), gameDt, ship: shipView, sun: SUN });
  if (haloRings) haloRings.update(realDt, camShake, { sun: SUN, ship: shipView, gameDt, quality: 'high', splitScreen: false });
  if (beltWorld) {
    _beltFocus[0].x = camShake.x; _beltFocus[0].y = camShake.y;
    _beltFocus[1].x = atlas.x; _beltFocus[1].y = atlas.y;
    beltWorld.frame(realDt, S.paused, _beltFocus);
    if (asteroidBelt) asteroidBelt.prepareFrame(beltWorld.time, beltWorld.frameDt, atlas, null, null);
  }
  cullInfo.x = camShake.x; cullInfo.y = camShake.y;
  // Obrócony kadr — pudło osi świata obejmujące go (viewRoll.js).
  const ch = rolledHalfExtents(W * 0.5 / camShake.zoom, H * 0.5 / camShake.zoom, camShake.roll || 0, _rollHalf);
  cullInfo.drawHalfW = ch.hw + 900;
  cullInfo.drawHalfH = ch.hh + 900;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  renderList.length = 0;
  for (const e of world.entities()) renderList.push(e);
  updateHexShips3D(camShake, renderList, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  updateHud();
}

// ---------------------------------------------------------------------------
// HUD i panel

function phaseLabel() {
  if (warp.state === 'charging') return 'ŁADOWANIE';
  if (S.free && warp.state === 'idle' && !(warp.exitRamp && warp.exitRamp.active)) {
    return Math.hypot(atlas.vx, atlas.vy) > ATLAS.maxSpeed + 1 && !S.keys.shift ? 'LOT SWOBODNY · ślizg z pędem' : 'LOT SWOBODNY';
  }
  if (warp.state === 'active') return warp.flybyFactor < 0.6 ? 'SKOK · przelot obok ciała (zwolnienie)' : 'SKOK';
  const r = warp.exitRamp;
  if (r && r.active) return r.age < r.tSlowEnd ? 'WYJŚCIE · zwolnienie' : (r.age < r.tBrake ? 'WYJŚCIE · wlot' : 'WYJŚCIE · hamowanie');
  if (trip.phase === 'po') return Math.hypot(atlas.vx, atlas.vy) > ATLAS.maxSpeed + 1 ? 'PO WYJŚCIU · ślizg z pędem' : 'PO WYJŚCIU';
  return 'POSTÓJ';
}

let hudAcc = 0;
function updateHud() {
  if (++hudAcc % 6) return;
  const v = Math.hypot(atlas.vx, atlas.vy);
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const st = WarpNurt.stats || {};
  const lines = [];
  lines.push(`<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(2)} ms · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(2)} ms · draw ${info.drawCalls ?? info.calls ?? 0}${S.paused ? ' · <span class="warn">PAUZA</span>' : ''}${S.timeScale !== 1 ? ` · czas ×${S.timeScale}` : ''}`);
  lines.push(`faza       ${phaseLabel()}`);
  lines.push(`prędkość   ${v >= 10000 ? `${(v / 1000).toFixed(1)} tys.` : v.toFixed(0)} j/s${warp.state === 'active' ? `  (przelot ${(warp.cruise / 1000).toFixed(0)} tys. × ${warp.flybyFactor.toFixed(2)})` : ''}`);
  lines.push(S.free
    ? 'trasa      lot swobodny — W/S ciąg, A/D obrót, Shift dopalacz, CapsLock / 9 warp'
    : `trasa      ${ROUTES[S.route].label} · plan ${trip.planTime.toFixed(1)} s · do celu ${(Math.hypot(trip.endX - atlas.x, trip.endY - atlas.y) / 1000).toFixed(1)} km`);
  lines.push(`wyjście    ${S.momentum ? `<span class="good">z pędem ${S.dropK}× (${(S.dropK * ATLAS.maxSpeed).toFixed(0)} j/s)</span>` : 'do zatrzymania'}`);
  lines.push(`kamera     ${CAM_ROLL_LABELS[S.camRoll]} · obrót ${Math.round(rig.roll * 180 / Math.PI)}° · zoom ${cam.zoom.toFixed(3)} (${S.warpZoom === 'staly' ? 'w skoku stały' : 'w skoku × zoom gracza'})`);
  lines.push(`ośrodek    ${st.awake ? 'aktywny' : 'śpi'} · fale ${st.waves ?? 0} · bańki ${st.bubbles ?? 0}`);
  $('hud').innerHTML = lines.join('\n');
}

function syncPanel() {
  for (const b of document.querySelectorAll('#styles button')) b.classList.toggle('on', b.dataset.styl === S.style);
  for (const b of document.querySelectorAll('#routes button')) b.classList.toggle('on', !S.free && b.dataset.trasa === S.route);
  $('btn-free').classList.toggle('on', S.free);
  $('btn-ped').classList.toggle('on', S.momentum);
  $('btn-stop').classList.toggle('on', !S.momentum);
  for (const b of document.querySelectorAll('#camroll button')) b.classList.toggle('on', b.dataset.roll === S.camRoll);
  for (const b of document.querySelectorAll('#warpzoom button')) b.classList.toggle('on', b.dataset.zoom === S.warpZoom);
  $('btn-pause').classList.toggle('on', S.paused);
  $('btn-slow').classList.toggle('on', S.timeScale !== 1);
  $('pedK').value = String(S.dropK);
  $('pedK-v').textContent = `${S.dropK}×`;
  const info = STYLE_INFO[S.style];
  $('styl-k').textContent = info.k;
  $('styl-d').textContent = info.d;
}

function setStyle(style) {
  if (!WARP_STYLES.includes(style)) return false;
  S.style = style;
  setWarpStyle(style);
  syncPanel();
  return true;
}
function setMomentum(on) { S.momentum = !!on; syncPanel(); }
const CAM_ROLL_LABELS = { up: 'w skoku kursem w górę', right: 'w skoku kursem w prawo', off: 'bez obrotu' };
function setCamRoll(mode) {
  if (!CAMERA_WARP_ROLL_MODES.includes(mode)) return false;
  S.camRoll = mode;
  syncPanel();
  return true;
}
function setWarpZoom(mode) {
  if (mode !== 'staly' && mode !== 'gracz') return false;
  S.warpZoom = mode;
  syncPanel();
  return true;
}
function setRoute(key) {
  if (!ROUTES[key]) return false;
  S.route = key;
  S.free = false;
  setupTrip();
  syncPanel();
  return true;
}

const ACTIONS = {
  style1: () => setStyle('rulon'), style2: () => setStyle('ped'), style3: () => setStyle('akcent'), style4: () => setStyle('soczewka'),
  momentum: () => setMomentum(!S.momentum),
  camRoll: () => setCamRoll(CAMERA_WARP_ROLL_MODES[(CAMERA_WARP_ROLL_MODES.indexOf(S.camRoll) + 1) % CAMERA_WARP_ROLL_MODES.length]),
  warpZoom: () => setWarpZoom(S.warpZoom === 'staly' ? 'gracz' : 'staly'),
  jowisz: () => setRoute('jowisz'), mars: () => setRoute('mars'),
  free: () => setFree(!S.free),
  warp: () => toggleFreeWarp(),
  jump: () => { if (S.free) setFree(false); else restartTrip(); },
  pause: () => { S.paused = !S.paused; syncPanel(); },
  slow: () => { S.timeScale = S.timeScale === 1 ? 0.25 : 1; syncPanel(); },
  clean: () => document.body.classList.toggle('clean')
};

function bindPanel() {
  for (const b of document.querySelectorAll('#styles button')) b.addEventListener('click', () => setStyle(b.dataset.styl));
  for (const b of document.querySelectorAll('#routes button')) b.addEventListener('click', () => setRoute(b.dataset.trasa));
  for (const b of document.querySelectorAll('#camroll button')) b.addEventListener('click', () => setCamRoll(b.dataset.roll));
  for (const b of document.querySelectorAll('#warpzoom button')) b.addEventListener('click', () => setWarpZoom(b.dataset.zoom));
  $('btn-ped').addEventListener('click', () => setMomentum(true));
  $('btn-stop').addEventListener('click', () => setMomentum(false));
  $('pedK').addEventListener('input', (e) => { S.dropK = Number(e.target.value) || 3; S.momentum = true; syncPanel(); });
  $('btn-jump').addEventListener('click', ACTIONS.jump);
  $('btn-free').addEventListener('click', ACTIONS.free);
  $('btn-pause').addEventListener('click', ACTIONS.pause);
  $('btn-slow').addEventListener('click', ACTIONS.slow);
  $('btn-clean').addEventListener('click', ACTIONS.clean);
  syncPanel();
}

function bindInput() {
  const held = (e, down) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 's' || k === 'a' || k === 'd') { S.keys[k] = down; return true; }
    if (k === 'shift') { S.keys.shift = down; return true; }
    return false;
  };
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (S.free && held(e, true)) { e.preventDefault(); return; }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    const map = {
      1: 'style1', 2: 'style2', 3: 'style3', 4: 'style4', p: 'momentum', k: 'camRoll', z: 'warpZoom', j: 'jowisz', m: 'mars', f: 'free',
      capslock: 'warp', 9: 'warp', ' ': 'jump', escape: 'pause', t: 'slow', h: 'clean'
    };
    const a = map[k];
    if (a) { e.preventDefault(); ACTIONS[a](); }
  });
  addEventListener('keyup', (e) => { held(e, false); });
  addEventListener('blur', () => { for (const k in S.keys) S.keys[k] = false; });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBase = Math.max(0.02, Math.min(1.2, zoomBase * Math.exp(-e.deltaY * 0.0012)));
  }, { passive: false });
  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    canvas2d.width = W; canvas2d.height = H;
    glCanvas.width = W; glCanvas.height = H;
    Core3D.resize(W, H);
    resizeHexShips3D?.(W, H);
  });
}

// ---------------------------------------------------------------------------
// Pętla, API harnessu, start

function loop(now) {
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
  lastNow = now;
  S.frameMs = S.frameMs * 0.9 + dt * 1000 * 0.1;
  frame(dt);
  if (!TEST) requestAnimationFrame(loop);
}

window.__warpPed = {
  ready: false, S, warp, trip,
  get atlas() { return atlas; },
  setStyle, setMomentum, setRoute, setFree, setCamRoll, setWarpZoom, toggleFreeWarp, restart: () => restartTrip(), act: (k) => ACTIONS[k]?.(),
  get roll() { return rig.roll; },
  /** Lot swobodny z harnessu: klawisze trzymane (w, s, a, d, shift). */
  keys(state) { Object.assign(S.keys, state || {}); return { ...S.keys }; },
  setZoom(z) { zoomBase = z; return zoomBase; },
  /** n klatek po 1/fps s (harness: zegar w pełni z tego wywołania). */
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if ((i % 8) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  /** Klatki aż do spełnienia warunku (funkcja stanu demo) albo limitu; zwraca liczbę klatek. */
  async until(cond, max = 3000, fps = 60) {
    for (let i = 0; i < max; i++) {
      if (cond(this)) return i;
      frame(1 / fps);
      if ((i % 8) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return -1;
  },
  stats() {
    return {
      style: warpStyle(''), phase: phaseLabel(), time: +S.time.toFixed(2), v: Math.round(Math.hypot(atlas.vx, atlas.vy)),
      cruise: Math.round(warp.cruise), planTime: +trip.planTime.toFixed(2), flyMin: +trip.flyMin.toFixed(3),
      maxSpeed: Math.round(trip.maxSpeed), toEnd: Math.round(Math.hypot(trip.endX - atlas.x, trip.endY - atlas.y)),
      zoom: +cam.zoom.toFixed(4), warpNurt: { ...(WarpNurt.stats || {}) }, gpuMs: +(Number(Core3D.gpuFrameMs) || 0).toFixed(3),
      warmup: Core3D.warmup?.stats ? { flush: Core3D.warmup.stats.flush } : null
    };
  }
};

(async () => {
  try {
    await loadHullAssets(['atlas']);
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__warpPed.error = 'webgpu';
      return;
    }
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    planets = buildPlanets();
    window.planets = planets;
    window.initPlanets3D(planets, SUN);
    // Ringi „Halo” i pas asteroid jak w grze (index.html: initHaloRings, start świata, startGame): kolidery i pole od
    // razu, cień pól i start GPU pasa; ringi budowane z góry (w grze — gdy kadr zbliży się do planety; w skoku planeta
    // mija kadr w kilka s, a ring-archetyp buduje się ~2–3 s).
    haloWorld = new HaloRingWorld({ planets });
    haloRings = new HaloRingGame({ world: haloWorld, quality: 'high' });
    window.__haloRings = haloRings;
    beltWorld = createBeltWorld({ planets, sun: SUN, auToWorld: window.WORLD_UNITS_PER_AU });
    beltWorld.familyPeaks();
    asteroidBelt = createAsteroidBelt({ world: beltWorld });
    window.__beltWorld = beltWorld;
    window.__asteroidBelt = asteroidBelt;
    await beltWorld.precompute(() => {});
    await Core3D.warmup.run('pas asteroid: start GPU (asteroidBelt)', () => asteroidBelt.initGpu());
    const rings = ['earth', 'mars', 'jupiter'].map((k) => haloRings.showcaseRing(k)).filter(Boolean);
    let ringsReady = false;
    Promise.all(rings.map((r) => Promise.resolve(r.ready))).then(() => { ringsReady = true; }, () => { ringsReady = true; });
    for (let i = 0; i < 900 && !ringsReady; i++) {
      haloRings.update(0, cam, { sun: SUN, ship: null, gameDt: 0, quality: 'high', splitScreen: false });
      await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    WarpNurt.init();
    WarpNurt.onShake = (mag, dur) => addShake(mag, dur);
    world = new World();
    atlas = world.add('atlas', { x: 0, y: 0, angle: 0, throttle: 0.6 });
    window.ship = atlas;
    zoomBase = defaultShipZoom(W, hullLength(), camTune);
    setupTrip();
    bindPanel();
    bindInput();
    // Pierwsza klatka zgłasza planety i kadłub (rozgrzewka widzi to, co rysuje gra), potem dokończenie kolejki.
    frame(1 / 60);
    await Core3D.warmup.flush?.({ timeoutMs: 8000 });
    $('loading').style.display = 'none';
    window.__warpPed.ready = true;
    if (!TEST) requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
