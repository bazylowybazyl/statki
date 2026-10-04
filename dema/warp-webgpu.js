// dema/warp-webgpu.js — demo WebGPU: warp „Nurt” (propozycja 2).
//
// Bańki warpa nie rysujemy. Przestrzeń ma ośrodek — miliony drobin materii
// międzyplanetarnej liczonych na GPU (warp-webgpu/medium.js) — i bańkę widać
// po tym, co z nim robi: przed dziobem ściska go (turkus), za rufą rozrzedza
// (pomarańczowy warkocz), po bokach strugi opływają talię.
//
// Iteracja 2 (uwagi usera 2026-09-27): wracają planety (soczewka świata
// z propozycji 1 — prawdziwe odległości, przeloty, cel przy krawędzi); skok
// dostaje „kopa” (statek wyrywa się do przodu, gwiazdy strzelają w smugi);
// wyjście jest gwałtowne jak w Star Wars (smugi wracają do punktów, cel
// wskakuje pod statek); przed dziobem nie ma już kopuły drobin; okręty NPC
// przylatują i odlatują TUNELEM (prosta nić → szczelina → okręt wypada),
// jak w propozycji 1 — bez pustych baniek.
//
// Stos renderu (jak Core3D, na WebGPURenderer + TSL): pass nieba (mgławica
// gry), pass planet i gwiazd (ortho w pikselach — pozycje z soczewki), pass
// ośrodka (perspektywa — głębia = paralaksa), pass gry (kadłuby, szczeliny,
// blaski; ortho), potem przezroczyste fale, zgięcie tła, bloom z
// bloomConfig.js i ACES gry.
//
// Serwowanie: `npm run dev` → /dema/warp-webgpu.html
//   ?scene=trip|arrival|fleet|ambush|free  ?from=earth&to=jupiter  ?t=8.5  ?pause=1
//   ?particles=1500000  ?hull=supercapital|carrier|battleship|pirate_battleship  ?shot=1
//   ?rulon=1 — siła zwinięcia rulonu (rulon.js; 0 = płasko, klawisz U)
// Konsola: window.__demo (scene, seek, pause, stepFrames, state, setParticles).

import * as THREE from 'three/webgpu';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import supercapUrl from '../src/assets/ships/terransupercapital.png';
import carrierUrl from '../src/assets/ships/terrancarrier.png';
import battleshipUrl from '../src/assets/ships/terranbattleship.png';
import destroyerUrl from '../src/assets/ships/terrandestroyer.png';
import frigateUrl from '../src/assets/ships/terranfrigate.png';
import pirateBattleshipUrl from '../src/assets/ships/piratebattleship.png';
import pirateDestroyerUrl from '../src/assets/ships/piratedestroyer.png';
import pirateFrigateUrl from '../src/assets/ships/piratefrigate.png';
import { WarpMedium, BUBBLE_CAP, MEDIUM_DEFAULTS } from './warp-webgpu/medium.js';
import { WarpStars } from './warp-webgpu/stars.js';
import { WarpSky } from './warp-webgpu/sky.js';
import { HullType, syncHullInstance } from './warp-webgpu/hulls.js';
import { GlowSprites, GLOW_ROUND, GLOW_STREAK, GLOW_LINE } from './warp-webgpu/glow.js';
import { RiftSprites } from './warp-webgpu/rift.js';
import { PlanetSet } from './warp-webgpu/planets.js';
import { WorldLensView } from './warp-webgpu/worldLens.js';
import { buildSolarSystem, TRIP_IDS, PLANET_LABELS, SUN } from './warp-webgpu/solar.js';
import { WarpPost } from './warp-webgpu/post.js';
import { setRulon, rulonForwardCpu, rulonBoostCpu, RULON, RULON_TUNE } from './warp-webgpu/rulon.js';
import {
  STEP, BUBBLE_SHAPE, createTripScene, createArrivalScene, createFleetScene, createAmbushScene, createFreeScene
} from './warp-webgpu/scenes.js';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

const FOV_DEG = 35;
// Kierunek do słońca w scenie (y w górę) — światło na kadłubach z góry, lekko z boku.
const SUN_DIR = new THREE.Vector3(0.42, 0.38, 0.82).normalize();
const SCENES = ['trip', 'arrival', 'fleet', 'ambush', 'free'];
const SHIPS = SHIP_EDITOR_DEFAULTS.ships;
const HULLS = {
  atlas: { profile: 'atlas', editorKey: 'atlas', url: atlasUrl, editor: ATLAS_EDITOR_DEFAULTS },
  supercapital: { profile: 'terran_supercapital', editorKey: 'terran_supercapital', url: supercapUrl, editor: SHIPS.terran_supercapital },
  carrier: { profile: 'terran_carrier', editorKey: 'terran_carrier', url: carrierUrl, editor: SHIPS.terran_carrier },
  battleship: { profile: 'terran_battleship', editorKey: 'battleship', url: battleshipUrl, editor: SHIPS.battleship },
  destroyer: { profile: 'terran_destroyer', editorKey: 'destroyer', url: destroyerUrl, editor: SHIPS.destroyer },
  frigate: { profile: 'terran_frigate', editorKey: 'frigate', url: frigateUrl, editor: SHIPS.frigate },
  pirate_battleship: { profile: 'pirate_battleship', editorKey: 'pirate_battleship', url: pirateBattleshipUrl, editor: SHIPS.pirate_battleship },
  pirate_destroyer: { profile: 'pirate_destroyer', editorKey: 'pirate_destroyer', url: pirateDestroyerUrl, editor: SHIPS.pirate_destroyer },
  pirate_frigate: { profile: 'pirate_frigate', editorKey: 'pirate_frigate', url: pirateFrigateUrl, editor: SHIPS.pirate_frigate }
};

// ---------------------------------------------------------------------------
// Stan

const tripFrom = TRIP_IDS.includes(params.get('from')) ? params.get('from') : 'earth';
const tripTo = TRIP_IDS.includes(params.get('to')) && params.get('to') !== tripFrom ? params.get('to') : (tripFrom === 'jupiter' ? 'earth' : 'jupiter');
const sceneParam = params.get('scene') === 'jump' ? 'trip' : params.get('scene');
const S = {
  sceneName: SCENES.includes(sceneParam) ? sceneParam : 'trip',
  scene: null,
  t: 0,
  simT: 0,
  paused: params.get('pause') === '1',
  slow: false,
  anchor: { x: 0, y: 0 },
  anchorVel: { x: 0, y: 0 },
  keys: new Set(),
  count: Math.max(250000, Math.min(2000000, Number(params.get('particles')) || 1500000)),
  bright: 1,
  streamGain: 1,
  lensGain: 1,
  rulonGain: Number.isFinite(Number(params.get('rulon'))) && params.get('rulon') !== null ? Number(params.get('rulon')) : 1,
  toggles: { medium: true, stars: true, lens: true, waves: true, bloom: true, glow: true, planets: true, rulon: true },
  arrivalHull: HULLS[params.get('hull')] && params.get('hull') !== 'atlas' ? params.get('hull') : 'supercapital',
  trip: { from: tripFrom, to: tripTo },
  userZoom: 1,
  starCam: { x: 0, y: 0, lx: NaN, ly: NaN },
  frame: 0,
  fps: 60,
  cpuMs: 0,
  simMs: 0,
  gpuRenderMs: 0,
  gpuComputeMs: 0,
  steps: 0,
  hideUi: false,
  ready: false,
  busy: false,
  trackTimestamp: false
};

let W = innerWidth;
let H = innerHeight;

// ---------------------------------------------------------------------------
// Renderer, sceny, kamery

let renderer = null;
let post = null;
const skyScene = new THREE.Scene();
const planetScene = new THREE.Scene();
const medScene = new THREE.Scene();
const fgScene = new THREE.Scene();
const fgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 80000);
const bgCam = new THREE.PerspectiveCamera(FOV_DEG, 1, 10, 600000);
const planetCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4e6);
let medium = null;
let stars = null;
let sky = null;
let glow = null;
let rifts = null;
let planets = null;
const lensView = new WorldLensView();
const system = buildSolarSystem();
const types = {};
let atlasInst = null;
const npcCache = new Map();
const allInstances = [];

function focalPx() {
  return (H * 0.5) / Math.tan((FOV_DEG * Math.PI / 180) * 0.5);
}

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome/Edge z WebGPU i kontekst bezpieczny (localhost).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU (requestAdapter zwrócił null).');
  const requiredLimits = {};
  const want = { maxInterStageShaderVariables: 28, maxStorageBuffersPerShaderStage: 10, maxTextureDimension2D: 8192, maxSampledTexturesPerShaderStage: 24 };
  for (const [k, v] of Object.entries(want)) if (adapter.limits[k] >= v) requiredLimits[k] = v;
  renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, trackTimestamp: true, requiredLimits });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  S.trackTimestamp = !!renderer.backend.trackTimestamp;
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie WebGL — demo wymaga WebGPU.');
  }
}

async function loadHulls() {
  await Promise.all(Object.entries(HULLS).map(async ([id, def]) => {
    types[id] = await HullType.load({ id, ...def });
  }));
  atlasInst = types.atlas.createInstance(fgScene, 'atlas');
  allInstances.push(atlasInst);
}

/** Okręt NPC przypisany do miejsca w scenie (jeden na klucz i typ). */
function npcInstance(slot, typeKey) {
  const key = `${slot}:${typeKey}`;
  let inst = npcCache.get(key);
  if (!inst) {
    inst = types[typeKey].createInstance(fgScene, key);
    npcCache.set(key, inst);
    allInstances.push(inst);
  }
  return inst;
}

/** Pule okrętów flot (sceny 3 i 4). */
function makeFleetPools() {
  const pools = new Map();
  return {
    take(typeKey) {
      if (!types[typeKey]) return null;
      let list = pools.get(typeKey);
      if (!list) pools.set(typeKey, (list = []));
      let item = list.find((x) => !x.used);
      if (!item) {
        if (list.length >= 8) return null;
        item = { inst: types[typeKey].createInstance(fgScene, `fleet:${typeKey}:${list.length}`), used: false };
        allInstances.push(item.inst);
        list.push(item);
      }
      item.used = true;
      return item.inst;
    },
    release(inst) {
      for (const list of pools.values()) for (const item of list) if (item.inst === inst) item.used = false;
    }
  };
}
let fleetPools = null;

const ctx = {
  get atlas() { return atlasInst; },
  get viewW() { return W; },
  get viewH() { return H; },
  focal: focalPx,
  system,
  get trip() { return S.trip; },
  npc: npcInstance,
  arrivalHull: () => S.arrivalHull,
  fleetPools: () => (fleetPools ||= makeFleetPools())
};

function createScene(name) {
  if (name === 'arrival') return createArrivalScene(ctx);
  if (name === 'fleet') return createFleetScene(ctx);
  if (name === 'ambush') return createAmbushScene(ctx);
  if (name === 'free') return createFreeScene(ctx);
  return createTripScene(ctx);
}

// ---------------------------------------------------------------------------
// Przegródki baniek (stałe indeksy przez cały czas życia przegródki)

const slotBubble = new Array(BUBBLE_CAP).fill(null);
const slotFreedAt = new Array(BUBBLE_CAP).fill(-1e9);
const slotOf = new Map();
const packed = Array.from({ length: BUBBLE_CAP }, () => ({}));
const packedList = new Array(BUBBLE_CAP).fill(null);
let slotStamp = 0;

function clearSlots() {
  slotBubble.fill(null);
  slotFreedAt.fill(-1e9);
  slotOf.clear();
}

function syncSlots(list, t) {
  slotStamp++;
  for (const b of list) {
    let k = slotOf.get(b);
    if (k === undefined) {
      k = -1;
      for (let i = 0; i < BUBBLE_CAP; i++) {
        if (!slotBubble[i] && t - slotFreedAt[i] > 0.05) { k = i; break; }
      }
      if (k < 0) continue;
      slotBubble[k] = b;
      slotOf.set(b, k);
    }
    b._stamp = slotStamp;
  }
  for (let i = 0; i < BUBBLE_CAP; i++) {
    const b = slotBubble[i];
    if (b && b._stamp !== slotStamp) {
      slotOf.delete(b);
      slotBubble[i] = null;
      slotFreedAt[i] = t;
    }
  }
}

const seamPacked = Array.from({ length: 8 }, () => ({}));
const seamList = [];

// ---------------------------------------------------------------------------
// Symulacja (stały krok) i czas sceny

function simStep(F, t0, t1) {
  const ax = F.cam.x;
  const ay = F.cam.y;
  const shiftX = ax - S.anchor.x;
  const shiftY = -(ay - S.anchor.y);
  S.anchorVel.x = (ax - S.anchor.x) / STEP;
  S.anchorVel.y = (ay - S.anchor.y) / STEP;
  S.anchor.x = ax;
  S.anchor.y = ay;
  syncSlots(F.bubbles, t1);
  for (let k = 0; k < BUBBLE_CAP; k++) {
    const b = slotBubble[k];
    if (!b) { packedList[k] = null; continue; }
    const p = packed[k];
    p.x = b.x - ax;
    p.y = -(b.y - ay);
    p.dx = Math.cos(b.angle);
    p.dy = -Math.sin(b.angle);
    p.R = b.R;
    p.asp = b.asp;
    p.A = b.A;
    p.front = b.front;
    p.vx = b.vx;
    p.vy = -b.vy;
    p.strain = b.strain;
    p.turb = b.turb;
    p.pullR = b.pullR;
    p.pullGain = b.pullGain;
    p.release = b.releaseT > t0 && b.releaseT <= t1;
    p.jetSpeed = b.jetSpeed;
    p.heraldLen = b.heraldLen;
    p.heraldGain = b.heraldGain;
    p.excite = b.excite;
    p.rear = b.rearT > t0 && b.rearT <= t1;
    packedList[k] = p;
  }
  medium.setBubbles(packedList);
  seamList.length = 0;
  for (let k = 0; k < Math.min(8, F.seams.length); k++) {
    const s = F.seams[k];
    const p = seamPacked[k];
    p.x = s.x - ax;
    p.y = -(s.y - ay);
    p.dx = Math.cos(s.angle);
    p.dy = -Math.sin(s.angle);
    p.halfLen = s.halfLen;
    p.halfWidth = s.halfWidth;
    p.push = s.push;
    p.flow = s.flow;
    seamList.push(p);
  }
  medium.setSeams(seamList);
  medium.setCloudOrigin(ax, -ay);
  medium.setFade(F.mediumFade || 0);
  if (S.toggles.medium) medium.step(STEP, t1, shiftX, shiftY);
  S.steps++;
}

function loopIfNeeded() {
  const L = S.scene.frame.loopLen;
  if (!L || S.simT < L) return 0;
  const o = S.scene.loopOrigin();
  S.scene.reset(o.x, o.y);
  S.simT -= L;
  S.t -= L;
  return L;
}

/** Posuwa czas sceny o dt: kroki symulacji do chwili docelowej. */
function advance(dt, maxSteps = 48) {
  let target = S.t + dt;
  let steps = 0;
  while (S.simT + STEP <= target + 1e-9) {
    if (steps >= maxSteps) { S.simT = target - STEP * 0.5; break; }
    const t0 = S.simT;
    const t1 = t0 + STEP;
    S.scene.tick?.(t1, STEP, S.keys);
    const F = S.scene.stateAt(t1);
    simStep(F, t0, t1);
    S.simT = t1;
    steps++;
    const wrapped = loopIfNeeded();
    if (wrapped) {
      target -= wrapped;
      // Pętla z twardym cięciem (np. podróż wraca na start): ośrodek od nowa.
      if (S.sceneName === 'trip') {
        const F0 = S.scene.stateAt(S.simT);
        S.anchor.x = F0.cam.x;
        S.anchor.y = F0.cam.y;
        clearSlots();
        medium.setCount(S.count, 1);
        lensView.reset();
        S.starCam = { x: F0.cam.x, y: F0.cam.y, lx: F0.cam.x, ly: F0.cam.y };
      }
    }
  }
  S.t = Math.max(target, S.simT);
}

function restartScene() {
  S.t = 0;
  S.simT = 0;
  clearSlots();
  S.scene.reset(0, 0);
  const F = S.scene.stateAt(0);
  S.anchor.x = F.cam.x;
  S.anchor.y = F.cam.y;
  S.anchorVel.x = 0;
  S.anchorVel.y = 0;
  medium.setBoxes(S.scene.minZoom, W, H, focalPx());
  medium.setCount(S.count, 1);
  lensView.reset();
  // Obrót tarcz (tylko wygląd): start z Ziemi — przy krawędzi pod statkiem
  // nocna Europa; cel — przy brzegu przed dziobem pasy równikowe (w orientacji
  // gry statek staje nad szarym biegunem). Saturn bez obrotu (pierścień).
  for (const b of system.bodies) planets.orient(b.id, null);
  const trip = S.scene.trip;
  if (trip) {
    if (trip.fromId === 'earth') planets.orient('earth', { dirX: trip.ux, dirY: -trip.uy, lat: 50, lon: 12, inset: 9 });
    if (trip.toId !== 'saturn') planets.orient(trip.toId, { dirX: -trip.ux, dirY: trip.uy, lat: -14, lon: 40, inset: 16 });
  }
  S.starCam = { x: F.cam.x, y: F.cam.y, lx: F.cam.x, ly: F.cam.y };
  updateMarkers();
  const L = S.scene.frame.loopLen;
  const scrub = $('scrub');
  scrub.disabled = !L;
  scrub.max = String(L || 1);
}

function setScene(name) {
  if (!SCENES.includes(name)) return;
  for (const inst of allInstances) { inst.mesh.visible = false; inst.smear.visible = false; }
  S.sceneName = name;
  S.scene = createScene(name);
  S.userZoom = 1;
  restartScene();
  document.querySelectorAll('.scenes button').forEach((b) => b.classList.toggle('on', b.dataset.scene === name));
}

/** Przewinięcie: ośrodek liczony od początku sceny (symulacja na GPU). */
function seek(t) {
  S.busy = true;
  // Bez znaczników czasu GPU przy przewijaniu: tysiące kroków przepełniłyby
  // pulę zapytań (2048) przed najbliższym odczytem.
  const backend = renderer.backend;
  backend.trackTimestamp = false;
  try {
    restartScene();
    advance(Math.max(0, t), 1e9);
  } finally {
    backend.trackTimestamp = S.trackTimestamp && !gpuPending;
    S.busy = false;
  }
}

// ---------------------------------------------------------------------------
// Render

const _waves = [];
const _lens = [];
const _seamLens = [];
const _np = { x: 0, y: 0 };
const _seam = [0, 0, 0];
const _lensCtx = { ship: null, velAngle: 0, speed: 0, zoom: 1, W: 1, H: 1, shipSx: 0, shipSy: 0, beta: 0, bodyZoom: 1, target: null, hullHalfLen: 0, hullHalfWid: 0, dt: 0, sun: SUN, persp: { focal: 1, camZ: 1 } };
let lastRealT = 0;
const _rulonOut = { x: 0, y: 0, g: 1, vis: 1 };
const _rulonMap = { map: (x, y) => rulonForwardCpu(x, y, _rulonOut), boost: rulonBoostCpu };

function shakeOffset(amp, t) {
  return {
    x: amp * (Math.sin(t * 37.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4),
    y: amp * (Math.sin(t * 31.7 + 0.4) * 0.6 + Math.sin(t * 19.3 + 2.9) * 0.4)
  };
}

function seamColor(type, out) {
  const p = type.palette;
  for (let i = 0; i < 3; i++) out[i] = (p.core[i] * 0.7 + p.body[i] * 0.3) * 6.0;
  return out;
}

function render(frameDt) {
  const F = S.scene.stateAt(S.t);
  const userZoom = (S.sceneName === 'arrival' || S.sceneName === 'fleet' || S.sceneName === 'ambush') ? S.userZoom : 1;
  const zoom = F.cam.zoom * userZoom;
  const lag = Math.max(0, S.t - S.simT);
  const sh = shakeOffset(F.shake, S.t);
  const ax = F.cam.x;
  const ay = F.cam.y;

  // Kamery (scena względem kotwicy; wstrząs = przesunięcie kamery w px).
  const hw = W * 0.5 / zoom;
  const hh = H * 0.5 / zoom;
  const cxs = sh.x / zoom;
  const cys = sh.y / zoom;
  fgCam.left = -hw; fgCam.right = hw; fgCam.top = hh; fgCam.bottom = -hh;
  fgCam.position.set(cxs, cys, 30000);
  fgCam.near = 1;
  fgCam.far = 60000;
  fgCam.updateProjectionMatrix();
  fgCam.updateMatrixWorld(true);
  const camZ = focalPx() / zoom;
  bgCam.aspect = W / H;
  bgCam.fov = FOV_DEG;
  bgCam.near = Math.max(5, camZ * 0.02);
  bgCam.far = camZ + 400000;
  bgCam.position.set(cxs, cys, camZ);
  bgCam.updateProjectionMatrix();
  bgCam.updateMatrixWorld(true);
  // Pass planet: ortho w pikselach ekranu (środek kadru = 0, y w górę).
  planetCam.left = -W * 0.5; planetCam.right = W * 0.5; planetCam.top = H * 0.5; planetCam.bottom = -H * 0.5;
  planetCam.position.set(sh.x, sh.y, 2e6);
  planetCam.near = 1;
  planetCam.far = 4e6;
  planetCam.updateProjectionMatrix();
  planetCam.updateMatrixWorld(true);

  // Rulon (rulon.js): oś = kurs skoku przez statek, w px od środka kadru (y w górę).
  // Kieszeń lejka = bańka gracza (pół-wymiary w px): bańka zostaje płaska, świat zawija się na nią.
  const heroType = F.ships[0]?.inst.type;
  const bubbleRpx = (heroType ? heroType.length * BUBBLE_SHAPE.radiusK : 1000) * zoom;
  setRulon({
    bend: S.toggles.rulon ? (F.rulon || 0) : 0,
    field: S.toggles.rulon ? (F.rulonField || 0) : 0,
    strength: S.rulonGain,
    hx: Math.cos(F.stars.angle), hy: -Math.sin(F.stars.angle),
    shipX: (F.stars.refX - ax) * zoom - sh.x, shipY: -(F.stars.refY - ay) * zoom - sh.y,
    bubbleW: bubbleRpx, bubbleL: bubbleRpx * BUBBLE_SHAPE.asp,
    W, H, F: focalPx()
  });

  // Niebo i gwiazdy.
  sky.update(ax, -ay, W, H);
  const sc = S.starCam;
  if (!Number.isFinite(sc.lx)) { sc.x = ax; sc.y = ay; sc.lx = ax; sc.ly = ay; }
  let dx = ax - sc.lx;
  let dy = ay - sc.ly;
  sc.lx = ax;
  sc.ly = ay;
  const capStep = (F.stars.speedCap || 14000) * Math.max(frameDt, 1e-4);
  const dl = Math.hypot(dx, dy);
  if (dl > capStep) { dx *= capStep / dl; dy *= capStep / dl; }
  sc.x += dx;
  sc.y += dy;
  const su = stars.u;
  su.cam.value.set(sc.x, -sc.y);
  su.zoomComp.value = Math.max(1, 0.065 / zoom);
  su.zoom.value = zoom;
  su.shakePx.value.set(sh.x, sh.y);
  su.viewHalfPx.value.set(W * 0.5, H * 0.5);
  su.heading.value.set(Math.cos(F.stars.angle), -Math.sin(F.stars.angle));
  su.stretch.value = F.stars.stretch;
  su.frontOn.value = F.stars.frontOn;
  su.frontPx.value = F.stars.frontS * zoom;
  su.shipPx.value.set((F.stars.refX - ax) * zoom, -(F.stars.refY - ay) * zoom);
  su.warpTint.value = F.stars.warpTint;
  su.time.value = S.t;
  stars.mesh.visible = S.toggles.stars;

  // Planety (soczewka świata) — statek względem środka kadru w px (y w dół);
  // wstrząs dokłada kamera passa planet.
  const world = F.world;
  if (world && S.toggles.planets) {
    const hero = F.ships[0];
    const c = _lensCtx;
    c.ship = world.ship;
    c.velAngle = world.heading;
    c.speed = world.speed;
    c.zoom = zoom;
    c.W = W;
    c.H = H;
    c.shipSx = hero ? (hero.x - ax) * zoom : 0;
    c.shipSy = hero ? (hero.y - ay) * zoom : 0;
    c.beta = world.beta;
    c.bodyZoom = world.bodyZoom;
    c.target = world.target;
    c.hullHalfLen = hero ? hero.inst.type.length * zoom * 0.5 : 0;
    c.hullHalfWid = hero ? hero.inst.type.h * zoom * 0.5 : 0;
    c.dt = frameDt;
    c.persp.focal = focalPx();
    c.persp.camZ = camZ;
    const view = lensView.update(system.at(world.time), c);
    planets.apply(view, W, H, S.t, true, _rulonMap);
  } else {
    planets.hideAll();
  }

  // Ośrodek.
  medium.U.bright.value = S.bright;
  medium.U.streamGlow.value = MEDIUM_DEFAULTS.streamGlow * S.streamGain;
  medium.setView({
    camVelX: S.anchorVel.x, camVelY: -S.anchorVel.y, lag, viewW: W, viewH: H, zoom, camZ, time: S.t, warpVis: F.warpVis
  });
  medium.setVisible(S.toggles.medium);

  // Kadłuby (z odsłanianiem, szwem, żarem i smugą).
  for (const inst of allInstances) { inst.mesh.visible = false; inst.smear.visible = false; }
  for (const ship of F.ships) syncHullInstance(ship.inst, ship, ax, ay, SUN_DIR, seamColor(ship.inst.type, _seam));

  // Szczeliny tuneli.
  rifts.begin();
  for (const r of F.rifts) {
    // Brzeg cienki (~1–2 px) — jedyny element szczeliny nad progiem bloomu.
    const edge = Math.max(1.2 / zoom, r.halfWidth * 0.07);
    rifts.add(r.x - ax, -(r.y - ay), Math.cos(r.angle), -Math.sin(r.angle), r.halfLen, r.halfWidth, edge,
      scaled(r.core, 2.6), scaled(r.body, 1.0), r.k, r.dirty, r.seed, 1.8, r.fill);
  }
  rifts.commit(S.t);

  // Blaski: dysze MAIN, plazma WARP, szew poza sylwetką, błyski.
  glow.begin();
  if (S.toggles.glow) {
    for (const ship of F.ships) addShipGlows(ship, ax, ay, zoom);
    for (const f of F.flashes) {
      const col = f.pal ? (f.raw ? f.pal.core : f.pal.glow) : [0.55, 0.85, 1.0];
      const k = f.k * (f.raw ? 1.6 : 4.0);
      glow.add(f.x - ax, -(f.y - ay), 8, f.size, col[0] * k, col[1] * k, col[2] * k, GLOW_ROUND);
    }
    for (const g of F.glares) {
      const col = g.pal.core;
      const thick = Math.max(1.6 / zoom, g.len * 0.004);
      const k = 3.2 * g.k;
      glow.add(g.x - ax, -(g.y - ay), 9, thick, col[0] * k, col[1] * k, col[2] * k, GLOW_LINE, Math.cos(g.angle), -Math.sin(g.angle), g.len / thick, 0.5);
    }
  }
  glow.commit();

  // Fale, soczewka bańki i szczeliny (piksele ekranu, y w dół).
  _waves.length = 0;
  if (S.toggles.waves) {
    for (const w of F.waves) {
      if (!(w.amp > 0.05)) continue;
      _waves.push({
        x: W * 0.5 + (w.x - ax) * zoom - sh.x,
        y: H * 0.5 + (w.y - ay) * zoom + sh.y,
        r: (w.rFixed ?? w.r) * zoom,
        w: Math.max(6, w.width * zoom),
        amp: w.amp
      });
    }
  }
  post.setWaves(_waves);
  _lens.length = 0;
  for (const b of F.bubbles) {
    if (!(b.A > 0.03) || !(b.lensAmp > 0)) continue;
    _lens.push({
      x: W * 0.5 + (b.x - ax) * zoom - sh.x,
      y: H * 0.5 + (b.y - ay) * zoom + sh.y,
      ax: Math.cos(b.angle), ay: Math.sin(b.angle),
      a: b.R * b.asp * zoom, b: b.R * zoom,
      amp: b.lensAmp * S.lensGain, front: b.front
    });
  }
  post.setLens(_lens);
  _seamLens.length = 0;
  for (const s of F.seamLens) {
    _seamLens.push({
      x: W * 0.5 + (s.x - ax) * zoom - sh.x,
      y: H * 0.5 + (s.y - ay) * zoom + sh.y,
      ax: Math.cos(s.angle), ay: Math.sin(s.angle),
      halfLen: s.halfLen * zoom, band: Math.max(4, s.band * zoom), amp: s.amp * S.lensGain
    });
  }
  post.setSeams(_seamLens);
  post.u.viewPx.value.set(W, H);
  post.u.lensOn.value = S.toggles.lens ? 1 : 0;
  post.bloomOn.value = S.toggles.bloom ? 1 : 0;
  post.render();
  S.lastFrame = F;
}

function scaled(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function addShipGlows(ship, ax, ay, zoom) {
  const type = ship.inst.type;
  const c = Math.cos(ship.angle);
  const s = Math.sin(ship.angle);
  const hx = c;           // kurs w scenie (y w górę)
  const hy = -s;
  const R = type.nozzleRadius;
  const pal = type.palette;
  const plasma = ship.plasma || 0;
  const thrust = ship.thrust || 0;
  if (ship.visible) {
    for (const n of type.nozzles) {
      // Dysza schowana w tunelu (odsłanianie / znikanie) — bez blasku.
      if (ship.revealMode && (n.x - ship.revealLine) * ship.revealMode < 0) continue;
      _np.x = ship.x + n.x * c - n.y * s;
      _np.y = ship.y + n.x * s + n.y * c;
      const sx = _np.x - ax;
      const sy = -(_np.y - ay);
      const km = thrust * (1 - plasma);
      if (km > 0.01) glow.add(sx, sy, 4, R * 2.0, 0.35 * km, 0.62 * km, 1.1 * km, GLOW_ROUND);
      if (plasma > 0.01) {
        const kc = 2.6 * plasma;
        glow.add(sx, sy, 5, R * (2.0 + plasma), pal.core[0] * kc, pal.core[1] * kc, pal.core[2] * kc, GLOW_ROUND);
        const len = R * (6 + 18 * plasma);
        const kb = 0.85 * plasma;
        glow.add(sx - hx * len * 0.45, sy - hy * len * 0.45, 3, R * 1.5, pal.body[0] * kb, pal.body[1] * kb, pal.body[2] * kb, GLOW_STREAK, hx, hy, len / (R * 1.5));
        const ko = 0.18 * plasma;
        glow.add(sx - hx * R * 2, sy - hy * R * 2, 2, R * 6, pal.outer[0] * ko, pal.outer[1] * ko, pal.outer[2] * ko, GLOW_ROUND);
      }
    }
  }
  // Szew poza sylwetką: cienka linia w poprzek kursu (tylko gdy front na kadłubie).
  if (ship.seam > 0 && Number.isFinite(ship.seamLine)) {
    const px = ship.x + c * ship.seamLine;
    const py = ship.y + s * ship.seamLine;
    const len = type.h * 1.12;
    const thick = Math.max(1.8 / zoom, type.h * 0.003);
    const col = seamColor(type, _seam);
    const k = 0.2 * ship.seam;
    glow.add(px - ax, -(py - ay), 6, thick, col[0] * k, col[1] * k, col[2] * k, GLOW_LINE, -hy, hx, len / thick, 0.35);
  }
}

// ---------------------------------------------------------------------------
// Pętla

function frame(nowMs) {
  requestAnimationFrame(frame);
  if (!S.ready || S.busy) return;
  const realDt = Math.min(0.1, Math.max(0, (nowMs - (lastRealT || nowMs)) / 1000));
  lastRealT = nowMs;
  S.frame++;
  if (realDt > 0) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  const t0 = performance.now();
  const dt = S.paused ? 0 : realDt * (S.slow ? 0.25 : 1);
  S.steps = 0;
  advance(dt);
  const t1 = performance.now();
  render(dt);
  const t2 = performance.now();
  S.simMs = S.simMs * 0.9 + (t1 - t0) * 0.1;
  S.cpuMs = S.cpuMs * 0.9 + (t2 - t0) * 0.1;
  if (S.frame % 4 === 0) resolveGpuTimes();
  if (S.frame % 6 === 0) updateHud();
}

let gpuPending = false;
let gpuPendingFrames = 0;
function resolveGpuTimes() {
  const backend = renderer?.backend;
  if (!backend) return;
  if (gpuPending) {
    // Odczyt czeka na zaległą kolejkę GPU (np. po przewinięciu osi): bez nowych
    // zapytań, dopóki nie wróci — inaczej pula 2048 zapytań się przepełnia.
    if (++gpuPendingFrames > 12) backend.trackTimestamp = false;
    return;
  }
  if (!backend.trackTimestamp) return;
  gpuPending = true;
  gpuPendingFrames = 0;
  Promise.all([
    renderer.resolveTimestampsAsync('render').catch(() => null),
    renderer.resolveTimestampsAsync('compute').catch(() => null)
  ]).then(([r, c]) => {
    if (typeof r === 'number') S.gpuRenderMs = S.gpuRenderMs * 0.8 + r * 0.2;
    if (typeof c === 'number') S.gpuComputeMs = S.gpuComputeMs * 0.8 + c * 0.2;
  }).finally(() => {
    gpuPending = false;
    backend.trackTimestamp = S.trackTimestamp;
  });
}

function fmt(n, d = 1) {
  return Number(n).toFixed(d).replace('.', ',');
}

function updateHud() {
  const F = S.lastFrame;
  if (!F) return;
  const L = S.scene.frame.loopLen;
  const trip = S.sceneName === 'trip' ? `${PLANET_LABELS[S.trip.from]} → ${PLANET_LABELS[S.trip.to]}` : '';
  $('hud').innerHTML = [
    `<b>WARP „NURT” · WebGPU</b>   scena: <b>${S.sceneName}</b>${trip ? `   ${trip}` : ''}${S.paused ? '   <b>PAUZA</b>' : ''}${S.slow ? '   ×0,25' : ''}`,
    `faza: <b>${F.phase}</b>`,
    `czas: ${fmt(S.t, 2)} s${L ? ` / ${fmt(L, 1)} s` : ''}   zoom ${fmt(F.cam.zoom, 3)}`,
    F.trueSpeed > 1000 ? `prędkość: ${Math.round(F.trueSpeed).toLocaleString('pl-PL')} j/s   przepływ ośrodka: ${Math.round(F.speedLabel).toLocaleString('pl-PL')} j/s` : ''
  ].filter(Boolean).join('\n');
  $('stats').innerHTML = [
    `FPS <b>${fmt(S.fps, 0)}</b>   CPU ${fmt(S.cpuMs, 2)} ms (symulacja ${fmt(S.simMs, 2)})`,
    `GPU render ${fmt(S.gpuRenderMs, 2)} ms   compute ${fmt(S.gpuComputeMs, 2)} ms`,
    `drobiny ${S.count.toLocaleString('pl-PL')}   przegródki ${F.bubbles.length}   tunele ${F.rifts.length}`,
    `kroki/klatkę ${S.steps}   draw calle ${renderer.info.render.drawCalls}`
  ].join('\n');
  const scrub = $('scrub');
  if (L && document.activeElement !== scrub) {
    scrub.value = String(S.t);
    $('scrub-out').textContent = `${fmt(S.t, 1)} s`;
  }
}

function updateMarkers() {
  const box = $('markers');
  box.innerHTML = '';
  for (const m of S.scene.markers || []) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.title = `Przewiń do ${fmt(m.t, 1)} s`;
    b.addEventListener('click', () => seek(Math.max(0, m.t - 0.2)));
    box.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Wejście i panel

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer?.setSize(W, H);
  if (medium && S.scene) medium.setBoxes(S.scene.minZoom, W, H, focalPx());
}
addEventListener('resize', resize);

function fillTripSelects() {
  for (const [id, key] of [['trip-from', 'from'], ['trip-to', 'to']]) {
    const sel = $(id);
    sel.innerHTML = TRIP_IDS.map((p) => `<option value="${p}">${PLANET_LABELS[p]}</option>`).join('');
    sel.value = S.trip[key];
    sel.addEventListener('change', () => {
      S.trip[key] = sel.value;
      if (S.trip.from === S.trip.to) {
        const other = key === 'from' ? 'to' : 'from';
        S.trip[other] = TRIP_IDS.find((p) => p !== sel.value);
        $(other === 'to' ? 'trip-to' : 'trip-from').value = S.trip[other];
      }
      setScene('trip');
    });
  }
}

function bindUi() {
  document.querySelectorAll('.scenes button').forEach((b) => b.addEventListener('click', () => setScene(b.dataset.scene)));
  $('b-replay').addEventListener('click', () => restartScene());
  $('b-pause').addEventListener('click', () => { S.paused = !S.paused; $('b-pause').classList.toggle('on', S.paused); });
  $('b-slow').addEventListener('click', () => { S.slow = !S.slow; $('b-slow').classList.toggle('on', S.slow); });
  let scrubTimer = 0;
  $('scrub').addEventListener('input', (e) => {
    const t = Number(e.target.value);
    $('scrub-out').textContent = `${fmt(t, 1)} s`;
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => seek(t), 120);
  });
  const slider = (id, out, fmtFn, apply) => {
    const el = $(id);
    const upd = () => { $(out).textContent = fmtFn(Number(el.value)); apply(Number(el.value)); };
    el.addEventListener('input', upd);
    upd();
  };
  $('s-count').value = String(S.count);
  slider('s-count', 'o-count', (v) => `${fmt(v / 1e6, 2)} mln`, (v) => {
    if (!S.ready || v === S.count) return;
    S.count = v;
    restartScene();
  });
  slider('s-bright', 'o-bright', (v) => fmt(v, 2), (v) => { S.bright = v; });
  slider('s-stream', 'o-stream', (v) => fmt(v, 2), (v) => { S.streamGain = v; });
  slider('s-lens', 'o-lens', (v) => fmt(v, 2), (v) => { S.lensGain = v; });
  $('s-rulon').value = String(S.rulonGain);
  slider('s-rulon', 'o-rulon', (v) => fmt(v, 2), (v) => { S.rulonGain = v; });
  slider('s-pinch', 'o-pinch', (v) => fmt(v, 2), (v) => { RULON.pinch.value = v; });
  slider('s-edge', 'o-edge', (v) => fmt(v, 2), (v) => { RULON.edge.value = v; });
  slider('s-suck', 'o-suck', (v) => fmt(v, 2), (v) => { RULON.suck.value = v; });
  slider('s-spit', 'o-spit', (v) => fmt(v, 2), (v) => { RULON.spit.value = v; });
  slider('s-throat', 'o-throat', (v) => fmt(v, 2), (v) => { RULON_TUNE.throatH = v; });
  slider('s-boost', 'o-boost', (v) => fmt(v, 2), (v) => { RULON_TUNE.boost = v; });
  slider('s-medw', 'o-medw', (v) => fmt(v, 2), (v) => { RULON.medW.value = v; });
  slider('s-pocket', 'o-pocket', (v) => fmt(v, 2), (v) => { RULON_TUNE.pocket = v; });
  fillTripSelects();
  $('arrival-hull').value = S.arrivalHull;
  $('arrival-hull').addEventListener('change', (e) => {
    S.arrivalHull = e.target.value;
    if (S.sceneName === 'arrival') restartScene();
  });
  const toggle = (id, key) => {
    const el = $(id);
    el.checked = S.toggles[key];
    el.addEventListener('change', () => { S.toggles[key] = el.checked; });
  };
  toggle('t-medium', 'medium');
  toggle('t-stars', 'stars');
  toggle('t-planets', 'planets');
  toggle('t-lens', 'lens');
  toggle('t-waves', 'waves');
  toggle('t-bloom', 'bloom');
  toggle('t-glow', 'glow');
  toggle('t-rulon', 'rulon');

  const setToggle = (key, id) => { S.toggles[key] = !S.toggles[key]; $(id).checked = S.toggles[key]; };
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (S.sceneName === 'free') {
      if (k === 'e') S.scene.gearUp(S.t);
      if (k === 'q') S.scene.gearDown(S.t);
      if (['shift', 'control', 'w', 'a', 's', 'd', 'c'].includes(k)) e.preventDefault();
    }
    if (k >= '1' && k <= '5') setScene(SCENES[Number(k) - 1]);
    else if (k === 'r') restartScene();
    else if (k === ' ') { e.preventDefault(); S.paused = !S.paused; $('b-pause').classList.toggle('on', S.paused); }
    else if (k === 'x') { S.slow = !S.slow; $('b-slow').classList.toggle('on', S.slow); }
    else if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
    else if (k === 'm') setToggle('medium', 't-medium');
    else if (k === 'l') setToggle('lens', 't-lens');
    else if (k === 'b') setToggle('bloom', 't-bloom');
    else if (k === 'p') setToggle('planets', 't-planets');
    else if (k === 'u') setToggle('rulon', 't-rulon');
  });
  addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => S.keys.clear());
  const canvas = renderer.domElement;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.userZoom = Math.max(0.4, Math.min(3.5, S.userZoom * Math.exp(-e.deltaY * 0.0012)));
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || S.sceneName !== 'fleet' || !S.lastFrame) return;
    const F = S.lastFrame;
    const zoom = F.cam.zoom * S.userZoom;
    const wx = F.cam.x + (e.clientX - W * 0.5) / zoom;
    const wy = F.cam.y + (e.clientY - H * 0.5) / zoom;
    S.scene.call(S.t, wx, wy);
  });
}

// ---------------------------------------------------------------------------
// Start

async function main() {
  await initRenderer();
  await loadHulls();
  sky = new WarpSky(skyScene);
  stars = new WarpStars(planetScene);
  planets = new PlanetSet(planetScene, system.bodies);
  medium = new WarpMedium({ renderer, scene: medScene });
  rifts = new RiftSprites({ scene: fgScene });
  glow = new GlowSprites({ scene: fgScene, capacity: 1024 });
  post = new WarpPost({ renderer, skyScene, planetScene, medScene, fgScene, bgCam, planetCam, fgCam });
  bindUi();
  setScene(S.sceneName);
  const t0 = Number(params.get('t'));
  if (t0 > 0) seek(t0);
  $('loading').style.display = 'none';
  S.ready = true;
  window.__demo.ready = true;
}

window.__demo = {
  ready: false,
  scene: (name) => setScene(name === 'jump' ? 'trip' : name),
  seek: (t) => seek(t),
  pause: (v = true) => { S.paused = !!v; $('b-pause')?.classList.toggle('on', S.paused); },
  /** n klatek po dt (czas sceny) — do zrzutów klatka po klatce. */
  stepFrames: (n = 1, dt = 1 / 60) => {
    const backend = renderer.backend;
    backend.trackTimestamp = false;
    try { for (let i = 0; i < n; i++) advance(dt, 1e9); } finally { backend.trackTimestamp = S.trackTimestamp && !gpuPending; }
  },
  setParticles: (n) => { S.count = n; restartScene(); },
  setTrip: (from, to) => { S.trip.from = from; S.trip.to = to; setScene('trip'); },
  state: () => ({
    scene: S.sceneName, t: S.t, simT: S.simT, fps: S.fps, cpuMs: S.cpuMs, gpuRenderMs: S.gpuRenderMs,
    gpuComputeMs: S.gpuComputeMs, count: S.count, phase: S.lastFrame?.phase, bubbles: S.lastFrame?.bubbles.length,
    rifts: S.lastFrame?.rifts.length, drawCalls: renderer?.info.render.drawCalls,
    T: S.scene?.T, markers: S.scene?.markers, loopLen: S.scene?.frame.loopLen
  }),
  /** Ciała w soczewce w ostatniej klatce: id, środek [px od środka kadru], promień [px]. */
  // Rulon ostatniej klatki: płaski punkt [px od środka, y w górę] → ekran.
  rulonMap: (x, y) => ({ ...rulonForwardCpu(x, y) }),
  // Tarcze narysowane w ostatniej klatce (po rulonie): px od środka (y w górę), promień.
  planetsDrawn: () => [...planets.items].filter(([, it]) => it.group.visible)
    .map(([id, it]) => ({ id, x: Math.round(it.group.position.x), y: Math.round(it.group.position.y), size: +it.group.scale.x.toFixed(1) })),
  lens: () => lensView.out.map((v) => ({ id: v.body.id, x: Math.round(v.x), y: Math.round(v.y), size: Math.round(v.size), target: v.isTarget })),
  S,
  get renderer() { return renderer; },
  get medium() { return medium; }
};

requestAnimationFrame(frame);
main().catch((err) => {
  $('loading').textContent = `Błąd: ${err.message}`;
  reportError(err.stack || String(err));
});
