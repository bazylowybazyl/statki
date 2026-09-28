// Demo „Destruktor 2D — fizyka na GPU”: klej strony (UI, sterowanie, kamera, pętla klatki,
// scenariusze, porównanie z silnikiem CPU). Fizyka: gpuWorld.js + gpuShaders.js, render: render.js.
import { createBeamConfig } from '../../src/game/destructorBeams3D.js';
import { PLANAR_FLIGHT_DEFAULTS, readPlanarFlightInput } from '../../src/game/beamFlightControls2D.js';
import { getHullRenderSize } from '../../src/data/ships.js';
import { buildSpriteHullGpu } from './build.js';
import { GpuBeamWorld } from './gpuWorld.js';
import { BeamRenderer } from './render.js';
import { BODY_FLOATS, COUNTER } from './gpuShaders.js';

// Korzeń repo z adresu modułu. Nie `new URL(\`../../${p}\`, import.meta.url)`: Vite zamienia taki
// szablon na import globem i obraz przestaje się dekodować.
const ROOT = import.meta.url.replace(/dema\/destruktor2d-webgpu\/main\.js.*$/, '');
const asset = (path) => ROOT + path;
const HULLS = {
  atlas: { src: asset('assets/capital_ship_rect_v1.png') },
  pirate_battleship: { src: asset('src/assets/ships/piratebattleship.png') },
  terran_battleship: { src: asset('src/assets/ships/terranbattleship.png') },
  terran_carrier: { src: asset('src/assets/ships/terrancarrier.png') },
  pirate_destroyer: { src: asset('src/assets/ships/piratedestroyer.png') },
  terran_destroyer: { src: asset('src/assets/ships/terrandestroyer.png') },
  pirate_frigate: { src: asset('src/assets/ships/piratefrigate.png') },
  terran_frigate: { src: asset('src/assets/ships/terranfrigate.png') },
  long_haul_freighter: { src: asset('assets/long_haul_freighter.png') }
};
// Skład floty jak scripts/bench-belki-flota.mjs (duża bitwa z audytu, bez myśliwców).
const FLEET = [['atlas', 2], ['terran_carrier', 4], ['terran_battleship', 5], ['pirate_battleship', 5],
  ['terran_destroyer', 10], ['pirate_destroyer', 10], ['terran_frigate', 15], ['pirate_frigate', 15], ['long_haul_freighter', 6]];
const ATLAS_MASS = 800000;
const DUMMY_TINT = [1.0, 0.8, 0.74];
const DUMMY_GAP = 420;
const FIXED_DT = 1 / 120;
const DEMO_FLIGHT = Object.freeze({ ...PLANAR_FLIGHT_DEFAULTS, boostSpeed: 40000, boostAccel: 20000 });
const WALL_THICK = 1200, WALL_HEIGHT = 4800;
const URL_OPTS = new URLSearchParams(location.search);
const SUBSTEP_TRAVEL_15 = Number(URL_OPTS.get('substep')) || 8;   // j. na podkrok przy siatce 15 j. (demo CPU: 8)
const MAX_SUBSTEPS = Number(URL_OPTS.get('maxsub')) || 50;
const SUBSTEP_BUDGET = Number(URL_OPTS.get('budget')) || 240;      // podkroków na klatkę, potem symulacja zwalnia
const LASER_RATE = 18, MISSILE_RATE = 1.5;
// Kadłuby do tylu belek rozwiązuje jedna grupa robocza (kernel gsGroup); ?gs=0 wymusza dispatch na kolor.
// Pomiar A/B: remis ±15% zależnie od sceny (narzut dispatchy nie jest wąskim gardłem) — domyślnie dispatch na kolor.
const GS_GROUP_LIMIT = URL_OPTS.has('gs') ? Number(URL_OPTS.get('gs')) : 0;

const el = (id) => document.getElementById(id);
const val = (id) => Number(el(id).value);
const canvas = el('view');
const toastEl = el('toast');
let toastTimer = 0;
function toast(msg, holdMs = 2600) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, holdMs);
}
function fatal(msg) {
  const f = el('fatal');
  f.textContent = msg;
  f.style.display = 'flex';
  window.__gpu2d = { error: msg };
}

// ============================== WebGPU ==============================
let device, world, renderer;
async function initGpu() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome/Edge z WebGPU na localhost.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Brak adaptera WebGPU.');
  const want = {
    maxStorageBuffersPerShaderStage: 16, maxComputeWorkgroupStorageSize: 32768,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize,
    maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupSizeX: 1024
  };
  const requiredLimits = {};
  for (const [k, v] of Object.entries(want)) if (adapter.limits[k] >= v) requiredLimits[k] = v;
  if ((requiredLimits.maxStorageBuffersPerShaderStage || 0) < 16) throw new Error('Adapter ma mniej niż 16 buforów storage na etap shadera.');
  const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  device = await adapter.requestDevice({ requiredLimits, requiredFeatures: features });
  device.lost.then((info) => fatal(`Urządzenie WebGPU utracone: ${info.message}`));
  device.addEventListener?.('uncapturederror', (e) => console.error('[gpu2d] WebGPU:', e.error?.message || e.error));
  world = new GpuBeamWorld(device, { timestamps: features.length > 0, gsGroupSize: Number(URL_OPTS.get('gsSize')) || 1024 });
  renderer = new BeamRenderer(device, canvas);
  await Promise.all([world.init(), renderer.init()]);
  window.__gpu2d.adapter = adapter.info ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description || ''}`.trim() : '?';
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
}
window.addEventListener('resize', resize);

// ============================== KADŁUBY ==============================
const hullCache = new Map();
const structureCache = new Map();
async function loadHull(id) {
  if (hullCache.has(id)) return hullCache.get(id);
  const img = new Image();
  img.src = HULLS[id].src;
  await img.decode();
  // Siatkę próbkujemy w rozmiarze z gry (jak demo CPU i initHexBody), rysujemy oryginał.
  const size = getHullRenderSize(id, img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = size.w; c.height = size.h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size.w, size.h);
  const hull = { id, img, w: size.w, h: size.h, imageData: g.getImageData(0, 0, size.w, size.h) };
  hullCache.set(id, hull);
  return hull;
}

function hullStructure(hull, cellSize, frames, bulkheads) {
  const cellsAlong = Math.max(4, Math.round(hull.w / cellSize));
  const key = `${hull.id}|${cellsAlong}|${frames}|${bulkheads}`;
  let s = structureCache.get(key);
  if (!s) {
    s = buildSpriteHullGpu(hull.imageData, { key: hull.id, textureSource: hull.img, worldLength: hull.w, cellsAlong,
      frameStride: frames, bulkheadEvery: bulkheads });
    structureCache.set(key, s);
  }
  return s;
}

let wallTexture = null;
function wallStructure(cellSize) {
  const key = `wall|${cellSize}`;
  let s = structureCache.get(key);
  if (s) return s;
  if (!wallTexture) {
    wallTexture = document.createElement('canvas');
    wallTexture.width = 128; wallTexture.height = 512;
    const g = wallTexture.getContext('2d');
    g.fillStyle = '#1c1f24'; g.fillRect(0, 0, 128, 512);
    g.fillStyle = '#d9a820';
    for (let y = -128; y < 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y + 128); g.lineTo(128, y + 160); g.lineTo(0, y + 32); g.fill(); }
    g.fillStyle = '#4a525d'; g.fillRect(20, 0, 88, 512);
  }
  const w = Math.max(4, Math.round(WALL_THICK / cellSize)), h = Math.max(4, Math.round(WALL_HEIGHT / cellSize));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 110; data[i * 4 + 1] = 118; data[i * 4 + 2] = 130; data[i * 4 + 3] = 255; }
  s = buildSpriteHullGpu({ width: w, height: h, data }, { key: 'wall', textureSource: wallTexture, worldLength: w * cellSize,
    cellsAlong: w, frameStride: 0, bulkheadEvery: 0, nodesOnly: true });
  structureCache.set(key, s);
  return s;
}

function localBounds(h) {
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (let i = 0; i < h.nodeCount; i++) {
    mnX = Math.min(mnX, h.ox[i]); mxX = Math.max(mxX, h.ox[i]);
    mnY = Math.min(mnY, h.oy[i]); mxY = Math.max(mxY, h.oy[i]);
  }
  return [(mnX + mxX) / 2, (mnY + mxY) / 2, 0, (mxX - mnX) / 2, (mxY - mnY) / 2, 0];
}

// ============================== SCENA ==============================
let cellSize = 15;
let sceneKind = 'ram';
let ready = false;
let sceneInfo = null;           // { atlas: 0, dummy: 1 | -1, wall: k | -1, names }
let simTime = 0, accumulator = 0, paused = false, timeScale = 1, slowMo = false;
let contactTime = 0, lastFireTime = -1e9;
const weaponTimers = { laser: 0, missile: 0, barrel: 0 };
const pendingFire = [];

function makeConfig() {
  const c = createBeamConfig(cellSize);
  c.planar = true;
  c.maxContacts = 384;
  c.localSolver = false;
  c.crushStrength = val('sl-yield');
  c.globalStiffnessMul = val('sl-stiff');
  c.globalBreakMul = val('sl-break');
  c.plasticRate = val('sl-plastic');
  c.solverIterations = val('sl-iters');
  c.crushTransfer = val('sl-crush');
  // żar blachy: tylko wygląd (fizyka go nie czyta); demo CPU ma 0, gra 1
  c.heatGain = el('cb-heat').checked ? 1 : 0;
  return c;
}

function applySliders() {
  if (!world?.scene) return;
  world.updateConfig({
    crushStrength: val('sl-yield'), globalStiffnessMul: val('sl-stiff'), globalBreakMul: val('sl-break'),
    plasticRate: val('sl-plastic'), solverIterations: val('sl-iters'), crushTransfer: val('sl-crush')
  });
}

/**
 * Buduje opis sceny (te same pozycje co demo CPU) i wysyła na GPU.
 * opts.ramSpeed > 0: Atlas startuje w kursie na kukłę z tą prędkością (T).
 */
async function resetScene(opts = {}) {
  ready = false;
  const t0 = performance.now();
  cellSize = 1800 / Number(opts.res ?? val('opt-res'));
  sceneKind = opts.scene ?? el('opt-scene').value;
  const frames = Number(opts.frames ?? val('opt-frame')), bulkheads = Number(opts.bulkheads ?? val('opt-bulkhead'));
  const bodies = [];
  const looks = [];
  const info = { atlas: 0, dummy: -1, wall: -1, names: [] };
  const atlasHull = await loadHull('atlas');
  const atlasS = hullStructure(atlasHull, cellSize, frames, bulkheads);
  const density = ATLAS_MASS / atlasS.totalMass;
  const push = (hull, s, extra, look) => {
    bodies.push({ hull: s, massMultiplier: density, x: 0, y: 0, angle: 0, vx: 0, vy: 0, w: 0, ...extra });
    looks.push({ key: look?.key || hull.id, image: look?.image || hull.img, tint: look?.tint || null });
    info.names.push(extra.name || hull.id);
    return bodies.length - 1;
  };
  if (sceneKind === 'ram') {
    const dummyId = opts.dummy ?? el('opt-dummy').value;
    const ab = localBounds(atlasS);
    push(atlasHull, atlasS, { name: 'Atlas' });
    let frontX = ab[0] + ab[3];
    if (dummyId !== 'none') {
      const dh = await loadHull(dummyId);
      const ds = hullStructure(dh, cellSize, frames, bulkheads);
      const pose = Number(opts.pose ?? val('opt-pose')) * Math.PI / 180;
      const db = localBounds(ds);
      const c = Math.cos(pose), s = Math.sin(pose);
      const reachX = Math.abs(c) * db[3] + Math.abs(s) * db[4];
      const centerX = c * db[0] - s * db[1], centerY = s * db[0] + c * db[1];
      const x = ab[0] + ab[3] + DUMMY_GAP + reachX - centerX;
      info.dummy = push(dh, ds, { name: 'kukła', x, y: -centerY, angle: pose,
        massMultiplier: density * Number(opts.mass ?? val('opt-mass')) },
      { key: dh.id, image: dh.img, tint: dummyId === 'atlas' ? DUMMY_TINT : null });
      frontX = x + centerX + reachX;
    }
    const wallDist = Number(opts.wall ?? val('opt-wall'));
    if (wallDist > 0) {
      const ws = wallStructure(cellSize);
      const wb = localBounds(ws);
      info.wall = bodies.length;
      bodies.push({ hull: ws, massMultiplier: 1, static: true, name: 'ściana',
        x: Math.max(ab[0] + ab[3] + wallDist, frontX + DUMMY_GAP) + wb[3] - wb[0], y: -wb[1], angle: 0, vx: 0, vy: 0, w: 0 });
      looks.push({ key: 'wall', image: wallTexture, tint: null });
      info.names.push('ściana');
    }
    if (opts.ramSpeed > 0) {
      const target = info.dummy >= 0 ? bodies[info.dummy] : info.wall >= 0 ? bodies[info.wall] : null;
      const heading = target ? Math.atan2(target.y, target.x) : 0;
      bodies[0].angle = heading;
      bodies[0].vx = Math.cos(heading) * opts.ramSpeed;
      bodies[0].vy = Math.sin(heading) * opts.ramSpeed;
      bodies[0].wakeHold = 60;
    }
  } else {
    // Flota: siatka 9 kolumn co 4200 j., kurs i prędkość z tego samego ziarna co benchmark CPU.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let slot = 0;
    for (const [id, count] of FLEET) {
      const hull = await loadHull(id);
      const s = hullStructure(hull, cellSize, frames, bulkheads);
      for (let i = 0; i < count; i++, slot++) {
        const heading = rnd() * Math.PI * 2, speed = 150 + rnd() * 250;
        push(hull, s, { name: `${id}#${i}`, x: (slot % 9) * 4200, y: Math.floor(slot / 9) * 4200, angle: heading,
          vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed });
      }
    }
    if (sceneKind === 'fleet-ram') {
      const pairs = Number(opts.pairs ?? 6);
      for (let p = 0; p < pairs; p++) {
        const id = p % 2 ? 'pirate_battleship' : 'terran_battleship';
        const hull = await loadHull(id);
        const s = hullStructure(hull, cellSize, frames, bulkheads);
        push(hull, s, { name: `taran${p}a`, x: -20000, y: p * 3000, vx: 900 });
        push(hull, s, { name: `taran${p}b`, x: -19100, y: p * 3000, angle: Math.PI / 2 });
      }
    }
    info.dummy = 1;
  }
  const buildMs = performance.now() - t0;
  const cfg = makeConfig();
  const origin = { x: bodies[0].x, y: bodies[0].y };
  world.setScene({ cfg, bodies, origin, gsGroupLimit: opts.gsGroupLimit ?? GS_GROUP_LIMIT });
  await renderer.setScene(world, looks);
  sceneInfo = info;
  simTime = 0;
  accumulator = 0;
  contactTime = 0;
  lastFireTime = -1e9;
  pendingFire.length = 0;
  weaponTimers.laser = weaponTimers.missile = 0;
  for (const code in keys) keys[code] = false;
  weaponInput.laser = weaponInput.missile = false;
  camOffset.x = camOffset.y = 0;
  if (followMode === 'free') { camFree.x = bodies[0].x; camFree.y = bodies[0].y; }
  if (sceneKind !== 'ram' && viewHeight < 9000) viewHeight = 16000;
  lastBuildMs = buildMs;
  lastSceneStats = { nodes: world.nodeCount, beams: world.beamCount, colors: world.colors, bodies: bodies.length };
  ready = true;
  return lastSceneStats;
}
let lastBuildMs = 0;
let lastSceneStats = null;

// Pokazy: gotowe ujęcia tego, co daje GPU (widoczne od razu, bez szukania ustawień).
const SHOWS = {
  fine: { label: 'Taran Atlas–Atlas 800 j./s w siatce 3,75 j.', res: 480, apply: () => ram({ res: 480, speed: 800, follow: 'pair', height: 3600 }) },
  fleet: { label: 'Flota 84 kadłubów, 6 par taranów', apply: async () => {
    el('opt-scene').value = 'fleet-ram';
    await resetScene({ scene: 'fleet-ram', res: 120, pairs: 6 });
    setFollow('free'); el('opt-follow').value = 'free';
    camFree.x = -19300; camFree.y = 7500; viewHeight = 17500;
  } },
  strain: { label: 'Naprężenia belek, taran 1600 j./s, tempo ×0,2', apply: async () => {
    await ram({ res: 120, speed: 1600, follow: 'pair', height: 3000 });
    el('cb-strain').checked = true; renderer.show.strain = true;
    slowMo = true; timeScale = 0.2;
  } },
  wall: { label: 'Ściana przy 20 000 j./s (podkroki co 8 j.)', apply: async () => {
    el('opt-dummy').value = 'none'; el('opt-wall').value = '3000';
    await ram({ res: 120, speed: 20000, follow: 'free', height: 9000 });
    camFree.x = 2600; camFree.y = 0;
  } }
};
async function runShow(key) {
  const show = SHOWS[key];
  slowMo = false; timeScale = val('sl-time');
  el('cb-strain').checked = false; renderer.show.strain = false;
  if (show.res) el('opt-res').value = String(show.res);
  await show.apply();
  toast(show.label, 2600);
}
for (const [key, id] of [['fine', 'show-fine'], ['fleet', 'show-fleet'], ['strain', 'show-strain'], ['wall', 'show-wall']]) {
  el(id).addEventListener('click', () => { runShow(key).catch(fail); canvas.focus({ preventScroll: true }); });
}

function ram(o = {}) {
  const speed = o.speed ?? val('sl-speed');
  el('opt-scene').value = 'ram';
  if (o.res) el('opt-res').value = String(o.res);
  return resetScene({ ramSpeed: speed, scene: 'ram', res: o.res }).then(() => {
    paused = false;
    if (o.follow) { setFollow(o.follow); el('opt-follow').value = o.follow; }
    if (o.height) viewHeight = o.height;
    const dummyId = el('opt-dummy').value;
    const what = dummyId !== 'none' ? `${el('opt-dummy').selectedOptions[0].textContent.toLowerCase()}, ${el('opt-pose').selectedOptions[0].textContent}` : 'ściana';
    toast(`Taran ${speed} j./s — ${what}`, 2200);
  });
}

// ============================== WEJŚCIE ==============================
const keys = Object.create(null);
const flightInput = {};
const weaponInput = { laser: false, missile: false };
let followMode = 'atlas';
let viewHeight = 4200;
const camOffset = { x: 0, y: 0 };
const camFree = { x: 600, y: 0 };

function triggers(dt, laser, missile) {
  weaponTimers.laser = Math.max(-dt, weaponTimers.laser - dt);
  weaponTimers.missile = Math.max(-dt, weaponTimers.missile - dt);
  const fire = (kind) => {
    pendingFire.push({ kind, owner: sceneInfo?.atlas ?? 0, damage: val('sl-dmg'), blastCells: val('sl-radius'),
      side: (weaponTimers.barrel++ % 2) ? 1 : -1 });
    lastFireTime = simTime;
  };
  if (laser && weaponTimers.laser <= 1e-8) { fire(0); weaponTimers.laser += 1 / LASER_RATE; }
  if (missile && weaponTimers.missile <= 1e-8) { fire(1); weaponTimers.missile += 1 / MISSILE_RATE; }
}

const FLIGHT_KEY = /^(Key[WASDQEX]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/;
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (FLIGHT_KEY.test(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyT') ram().catch(fail);
  const showKey = { Digit1: 'fine', Digit2: 'fleet', Digit3: 'strain', Digit4: 'wall' }[e.code];
  if (showKey) runShow(showKey).catch(fail);
  if (e.code === 'KeyR') resetScene().catch(fail);
  if (e.code === 'KeyP') { paused = !paused; accumulator = 0; toast(paused ? 'PAUZA (P)' : 'WZNOWIONO', 1200); }
  if (e.code === 'KeyZ') {
    slowMo = !slowMo;
    timeScale = slowMo ? 0.2 : val('sl-time');
    toast(slowMo ? 'Zwolnione tempo ×0,2 (Z)' : `Tempo ×${timeScale}`, 1200);
  }
  if (e.code === 'KeyV') {
    const modes = ['atlas', 'dummy', 'pair', 'free'];
    setFollow(modes[(modes.indexOf(followMode) + 1) % modes.length]);
    el('opt-follow').value = followMode;
    toast(`Kamera: ${el('opt-follow').selectedOptions[0].textContent}`, 1200);
  }
  if (e.code === 'KeyB') toggleCheckbox('cb-beams');
  if (e.code === 'KeyG') toggleCheckbox('cb-strain');
  if (e.code === 'KeyK') toggleCheckbox('cb-skin');
  if (e.code === 'KeyN') { world.requestRepair(0.4); toast('Naprawa konstrukcji…', 1200); }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
function clearInput() {
  for (const code in keys) keys[code] = false;
  weaponInput.laser = weaponInput.missile = false;
}
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
window.addEventListener('contextmenu', (e) => e.preventDefault());

let panning = null;
canvas.addEventListener('mousedown', (e) => {
  canvas.focus({ preventScroll: true });
  if (e.button === 1) {
    e.preventDefault();
    const c = world?.state?.camera;
    if (followMode !== 'free' && c) { camFree.x = c.x; camFree.y = c.y; }
    panning = { x: e.clientX, y: e.clientY };
    setFollow('free');
    el('opt-follow').value = 'free';
    return;
  }
  if (!ready || paused) return;
  if (e.button === 0) weaponInput.laser = true;
  if (e.button === 2) weaponInput.missile = true;
  // krótkie kliknięcie strzela raz, także między krokami fizyki
  triggers(0, e.button === 0, e.button === 2);
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) weaponInput.laser = false;
  if (e.button === 2) weaponInput.missile = false;
  if (e.button === 1) panning = null;
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  const unitsPerPx = viewHeight / canvas.clientHeight;
  camFree.x -= (e.clientX - panning.x) * unitsPerPx;
  camFree.y += (e.clientY - panning.y) * unitsPerPx;
  panning.x = e.clientX; panning.y = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
  viewHeight = Math.max(120, Math.min(90000, viewHeight * Math.exp(delta * 0.001)));
}, { passive: false });

function setFollow(mode) {
  // Zmiana celu kamery bez skoku: przesunięcie = dotychczasowy środek − nowy cel, gaśnie sprężyną.
  const st = world?.state;
  const center = st?.camera;
  followMode = mode;
  if (!st || !center) return;
  const target = cameraTarget(st);
  if (target) { camOffset.x = center.x - target.x; camOffset.y = center.y - target.y; }
}

function cameraTarget(st) {
  const b = st.bodies;
  const live = (i) => i >= 0 && b[i] && !b[i].dead;
  const a = sceneInfo?.atlas ?? 0, d = sceneInfo?.dummy ?? -1;
  if (followMode === 'atlas' && live(a)) return { x: b[a].x, y: b[a].y };
  if (followMode === 'dummy' && live(d)) return { x: b[d].x, y: b[d].y };
  if (followMode === 'pair' && live(a) && live(d)) return { x: (b[a].x + b[d].x) / 2, y: (b[a].y + b[d].y) / 2 };
  return null;
}

function cameraPlan(dt) {
  const a = sceneInfo?.atlas ?? 0, d = sceneInfo?.dummy ?? -1;
  const st = world.state;
  const dead = (i) => i < 0 || (st && st.bodies[i]?.dead);
  const k = Math.exp(-dt * 6);
  camOffset.x *= k; camOffset.y *= k;
  if (followMode === 'atlas' && !dead(a)) return { mode: 1, a, offsetX: camOffset.x, offsetY: camOffset.y };
  if (followMode === 'dummy' && !dead(d)) return { mode: 1, a: d, offsetX: camOffset.x, offsetY: camOffset.y };
  if (followMode === 'pair' && !dead(a) && !dead(d)) return { mode: 2, a, b: d, offsetX: camOffset.x, offsetY: camOffset.y };
  if (followMode !== 'free' && st?.camera) { camFree.x = st.camera.x; camFree.y = st.camera.y; }
  return { mode: 0, freeX: camFree.x, freeY: camFree.y };
}

// ============================== UI ==============================
function bindSlider(id, outId, onChange, format = (v) => v) {
  const input = el(id), out = el(outId);
  const show = () => { out.textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { show(); onChange(Number(input.value)); });
  show();
}
const kFormat = (v) => v === 0 ? 'dawne' : `${Math.round(v / 1000)}k`;
bindSlider('sl-yield', 'o-yield', applySliders, kFormat);
for (const id of ['stiff', 'break', 'plastic', 'iters', 'crush']) bindSlider(`sl-${id}`, `o-${id}`, applySliders);
bindSlider('sl-speed', 'o-speed', () => {});
bindSlider('sl-dmg', 'o-dmg', () => {});
bindSlider('sl-radius', 'o-radius', () => {});
bindSlider('sl-time', 'o-time', (v) => { timeScale = v; slowMo = false; });
for (const id of ['opt-scene', 'opt-dummy', 'opt-pose', 'opt-mass', 'opt-wall', 'opt-res', 'opt-frame', 'opt-bulkhead']) {
  el(id).addEventListener('change', () => { resetScene().catch(fail); canvas.focus({ preventScroll: true }); });
}
el('btn-reset').addEventListener('click', () => resetScene().catch(fail));
el('cb-heat').addEventListener('change', (e) => world?.scene && world.updateConfig({ heatGain: e.target.checked ? 1 : 0 }));
el('btn-ram').addEventListener('click', () => { ram().catch(fail); canvas.focus({ preventScroll: true }); });
el('opt-follow').addEventListener('change', (e) => setFollow(e.target.value));
const toggles = [['cb-skin', 'skin', 'Sprite'], ['cb-beams', 'beams', 'Podgląd belek'], ['cb-strain', 'strain', 'Naprężenia belek'],
  ['cb-nodes', 'nodes', 'Podgląd węzłów']];
for (const [id, prop, label] of toggles) {
  el(id).addEventListener('change', (e) => {
    renderer.show[prop] = e.target.checked;
    toast(`${label}: ${e.target.checked ? 'ON' : 'OFF'}`, 1200);
  });
}
function toggleCheckbox(id) {
  const cb = el(id);
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change'));
}
for (const [button, panel] of [['btn-settings', 'panel-left'], ['btn-telemetry', 'panel-stats']]) {
  el(button).addEventListener('click', () => {
    const p = el(panel);
    if (window.innerWidth <= 1000) {
      const open = !p.classList.contains('open');
      el('panel-left').classList.remove('open');
      el('panel-stats').classList.remove('open');
      p.classList.toggle('open', open);
    } else p.classList.toggle('folded');
  });
}
function fail(err) {
  console.error('[gpu2d]', err);
  toast(`Błąd: ${err.message}`, 6000);
}

// ============================== PĘTLA ==============================
let lastFrame = performance.now();
let fpsFrames = 0, fpsLast = performance.now(), fpsValue = 0;
let frameSimMs = 0, frameWallMs = 0;
const gpuAvg = { phys: 0, physStepped: 0, render: 0, encode: 0, steps: 0, substeps: 0, dispatches: 0, n: 0, contacts: 0, pairs: 0, crush: 0 };
let lastSeq = -1;

function maxSpeedLagged() {
  const st = world.state;
  if (!st) return 0;
  let m = 0;
  for (const b of st.bodies) if (b.used && !b.dead && !b.isStatic) m = Math.max(m, Math.hypot(b.vx, b.vy));
  return m;
}

function buildSteps(dt) {
  const steps = [];
  if (!ready || paused) return steps;
  accumulator += dt * timeScale;
  const travel = SUBSTEP_TRAVEL_15 * cellSize / 15;
  // prędkość z odczytu sprzed 1–3 klatek + zapas na przyspieszenie dopalacza
  const boosting = keys.ShiftLeft || keys.ShiftRight;
  const speed = maxSpeedLagged() + (boosting ? DEMO_FLIGHT.boostAccel * 0.05 : 0);
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(speed * FIXED_DT / travel)));
  let budget = SUBSTEP_BUDGET;
  while (accumulator >= FIXED_DT && steps.length < 6 && budget >= substeps) {
    readPlanarFlightInput(keys, flightInput);
    if (flightInput.boost && flightInput.throttle === 0) flightInput.throttle = 1;
    triggers(FIXED_DT, weaponInput.laser, weaponInput.missile);
    steps.push({ substeps, input: { ...flightInput, assist: el('cb-assist').checked }, fire: pendingFire.splice(0, 4) });
    accumulator -= FIXED_DT;
    simTime += FIXED_DT;
    budget -= substeps;
  }
  if (accumulator >= FIXED_DT) accumulator = 0;   // za ciężko: symulacja zwalnia zamiast zamrażać kartę
  return steps;
}

let loopRunning = true;   // pomiary zatrzymują pętlę: inaczej klatki renderu nadpisują stan i czasy GPU
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.1) dt = 0.1;
  if (!ready || !loopRunning) return;
  const steps = buildSteps(dt);
  frameSimMs += steps.length * FIXED_DT * 1000;
  frameWallMs += dt * 1000;
  const plan = {
    steps, dt: FIXED_DT, weaponsActive: simTime - lastFireTime < 6.6, flight: DEMO_FLIGHT, controlBody: sceneInfo.atlas,
    weaponParams: { laserSpeed: 3600, missileSpeed: 1100, convergence: 2600 }, camera: cameraPlan(dt)
  };
  const enc = world.encodeFrame(plan);
  renderer.encode(enc, { viewHeight, time: world.simTime }, { querySet: world.querySet });
  world.encodeReadback(enc);
  device.queue.submit([enc.finish()]);
  world.afterSubmit();
  trackContact(steps.length);
  // Czasy GPU i liczniki z odczytów (każdy odczyt raz): fizyka na krok = suma czasów / suma kroków
  // tych samych klatek; kontakty i zgniot — maksimum w oknie telemetrii.
  const st = world.state;
  if (st && st.seq !== lastSeq) {
    lastSeq = st.seq;
    if (Number.isFinite(st.gpuPhysicsMs)) {
      gpuAvg.phys += st.gpuPhysicsMs; gpuAvg.render += st.gpuRenderMs || 0; gpuAvg.n++;
      if (st.steps > 0) { gpuAvg.physStepped += st.gpuPhysicsMs; gpuAvg.steps += st.steps; gpuAvg.substeps += st.substeps; gpuAvg.dispatches = Math.max(gpuAvg.dispatches, st.dispatches); }
    }
    gpuAvg.contacts = Math.max(gpuAvg.contacts, st.counters[COUNTER.contacts]);
    gpuAvg.pairs = Math.max(gpuAvg.pairs, st.counters[COUNTER.pairs]);
    gpuAvg.crush = Math.max(gpuAvg.crush, st.counters[COUNTER.crushNodes]);
  }
  gpuAvg.encode += world.stats.encodeMs;
  fpsFrames++;
  if (now - fpsLast > 500) {
    fpsValue = Math.round(fpsFrames * 1000 / (now - fpsLast));
    updateStats(fpsFrames);
    fpsFrames = 0;
    fpsLast = now;
    frameSimMs = frameWallMs = 0;
    for (const k in gpuAvg) gpuAvg[k] = 0;
  }
}

let lastContacts = 0;
let lastContactSeq = -1;
function trackContact() {
  const st = world.state;
  if (!st || st.seq === lastContactSeq) return;
  lastContactSeq = st.seq;
  if (st.steps > 0) lastContacts = st.counters[COUNTER.contacts];
  if (st.steps > 0 && lastContacts > 0 && closingSpeed() > 3 * cellSize) contactTime += st.steps * FIXED_DT;
}

function speedOf(i) {
  const b = world.state?.bodies[i];
  return b && !b.dead ? Math.hypot(b.vx, b.vy) : 0;
}

function closingSpeed() {
  const st = world.state;
  if (!st || !sceneInfo || sceneKind !== 'ram') return NaN;
  const a = st.bodies[sceneInfo.atlas];
  const t = sceneInfo.dummy >= 0 && !st.bodies[sceneInfo.dummy]?.dead ? st.bodies[sceneInfo.dummy] : sceneInfo.wall >= 0 ? st.bodies[sceneInfo.wall] : null;
  if (!a || a.dead || !t) return NaN;
  if (t.isStatic) return a.vx;
  const dx = t.x - a.x, dy = t.y - a.y, len = Math.hypot(dx, dy) || 1;
  return ((a.vx - t.vx) * dx + (a.vy - t.vy) * dy) / len;
}

function updateStats(frames) {
  const set = (id, v) => { el(id).textContent = v; };
  const st = world.state;
  const s = world.stats;
  set('st-fps', paused ? 'PAUZA' : String(fpsValue));
  const atlasDead = st?.bodies[sceneInfo.atlas]?.dead;
  set('st-state', !ready ? 'BUDOWA…' : paused ? 'PAUZA (P)' : atlasDead ? 'ATLAS ZNISZCZONY — R' : lastContacts > 0 ? 'STYK' : slowMo ? 'ZWOLNIONE ×0,2' : 'LOT');
  if (gpuAvg.n > 0) {
    set('st-gpu-phys', `${(gpuAvg.phys / gpuAvg.n).toFixed(3)} ms`);
    set('st-gpu-step', gpuAvg.steps > 0 ? `${(gpuAvg.physStepped / gpuAvg.steps).toFixed(3)} ms` : '—');
    set('st-gpu-render', `${(gpuAvg.render / gpuAvg.n).toFixed(3)} ms`);
  } else {
    set('st-gpu-phys', world.timestamps ? '…' : 'brak timestamp-query');
  }
  set('st-encode', `${(gpuAvg.encode / Math.max(1, frames)).toFixed(3)} ms`);
  set('st-dispatch', gpuAvg.dispatches ? `${gpuAvg.dispatches} (maks.)` : String(s.dispatches));
  set('st-substeps', gpuAvg.steps ? `${gpuAvg.steps} × ${(gpuAvg.substeps / gpuAvg.steps).toFixed(1)} / 0,5 s` : '0');
  set('st-sim-rate', frameWallMs > 0 ? `${(frameSimMs / frameWallMs * 100).toFixed(0)}%` : '—');
  if (st) {
    set('st-contacts', `${gpuAvg.contacts} / ${gpuAvg.pairs}`);
    set('st-crush', String(gpuAvg.crush));
    set('st-speed', `${speedOf(sceneInfo.atlas).toFixed(0)} j./s`);
    set('st-dummy-speed', sceneInfo.dummy >= 0 ? `${speedOf(sceneInfo.dummy).toFixed(0)} j./s` : '—');
    const closing = closingSpeed();
    set('st-closing', Number.isFinite(closing) ? `${closing.toFixed(0)} j./s` : '—');
    set('st-atlas-nodes', `${st.bodies[sceneInfo.atlas]?.activeNodes ?? '—'}`);
    set('st-dummy-nodes', sceneInfo.dummy >= 0 ? `${st.bodies[sceneInfo.dummy]?.activeNodes ?? '—'}` : '—');
    const live = st.bodies.filter((b) => b.used && !b.dead);
    set('st-bodies', `${live.length} / ${live.filter((b) => b.isWreck).length}`);
    let nodes = 0;
    for (const b of live) nodes += b.activeNodes;
    set('st-lattice', `${nodes} / ${Math.max(0, world.beamCount - st.counters[COUNTER.beamsBroken])}`);
    set('st-broken', String(st.counters[COUNTER.beamsBroken]));
    set('st-debris', String(st.counters[COUNTER.nodesKilled]));
    set('st-hits', `${st.counters[COUNTER.laserHits]} / ${st.counters[COUNTER.missileHits]}`);
  }
  set('st-contact-time', `${contactTime.toFixed(2)} s`);
  set('st-colors', `${world.colors} × ${val('sl-iters')} iter.`);
  if (lastSceneStats) set('st-build', `${lastBuildMs.toFixed(0)} ms (${lastSceneStats.nodes} węzłów)`);
}

// ============================== POMIARY (scripts/bench-belki-gpu.mjs) ==============================

/** Kroki fizyki bez renderu, po jednym kroku na polecenie (jak gra przy 120 Hz), z czasem GPU każdego. */
async function benchSteps(count, { substeps = null, input = null, fireEvery = 0, fireKind = 0, batch = 1 } = {}) {
  // batch kroków na jedno polecenie (2 = gra 60 kl./s przy fizyce 120 Hz); czas GPU przebiegu / batch
  const times = [];
  const encode = [];
  for (let k = 0; k < count; k += batch) {
    const steps = [];
    const travel = SUBSTEP_TRAVEL_15 * cellSize / 15;
    const n = substeps || Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(maxSpeedLagged() * FIXED_DT / travel)));
    for (let b = 0; b < batch && k + b < count; b++) {
      const kk = k + b;
      const fire = fireEvery > 0 && kk % fireEvery === 0
        ? [{ kind: fireKind, owner: sceneInfo.atlas, damage: val('sl-dmg'), blastCells: val('sl-radius'), side: kk % 2 ? 1 : -1 }] : [];
      if (fire.length) lastFireTime = simTime;
      steps.push({ substeps: n, input, fire });
      simTime += FIXED_DT;
    }
    const plan = { steps, dt: FIXED_DT, weaponsActive: simTime - lastFireTime < 6.6,
      flight: DEMO_FLIGHT, controlBody: sceneInfo.atlas, weaponParams: { laserSpeed: 3600, missileSpeed: 1100, convergence: 2600 } };
    const enc = world.encodeFrame(plan);
    world.encodeReadback(enc);
    device.queue.submit([enc.finish()]);
    world.afterSubmit();
    await device.queue.onSubmittedWorkDone();
    await world.lastMap;
    encode.push(world.stats.encodeMs / steps.length);
    if (world.state && Number.isFinite(world.state.gpuPhysicsMs)) {
      times.push({ ms: world.state.gpuPhysicsMs / steps.length, substeps: n, tick: world.state.tick, dispatches: world.stats.dispatches });
    }
  }
  await new Promise((r) => setTimeout(r, 30));
  return { times, encode };
}

async function readSummary() {
  const raw = await world.readAll(['bodies', 'counters', 'posVel', 'restMass', 'nodeInfo']);
  const f = new Float32Array(raw.bodies), u = new Uint32Array(raw.bodies);
  const c = new Uint32Array(raw.counters);
  const bodies = [];
  for (let i = 0; i < world.bodyCount; i++) {
    const b = i * BODY_FLOATS;
    bodies.push({ x: f[b] + f[b + 2], y: f[b + 1] + f[b + 3], vx: f[b + 4], vy: f[b + 5], angle: f[b + 6], w: f[b + 7],
      mass: f[b + 8], active: u[b + 30], flags: u[b + 32], wreck: !!(u[b + 32] & 32), dead: !!(u[b + 32] & 4) });
  }
  // przemieszczenie węzłów względem spoczynku (odkształcenie trwałe + sprężyste), na ciało
  const pv = new Float32Array(raw.posVel), rm = new Float32Array(raw.restMass), ni = new Uint32Array(raw.nodeInfo);
  const sum = new Float64Array(bodies.length), max = new Float64Array(bodies.length), cnt = new Uint32Array(bodies.length);
  let nan = 0;
  for (let i = 0; i < world.nodeCount; i++) {
    if (!(ni[i * 4] & 1) || (ni[i * 4] & 16)) continue;
    const bi = ni[i * 4 + 1];
    const dx = pv[i * 4] - rm[i * 4], dy = pv[i * 4 + 1] - rm[i * 4 + 1];
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) { nan++; continue; }
    const dd = Math.hypot(dx, dy);
    sum[bi] += dd; max[bi] = Math.max(max[bi], dd); cnt[bi]++;
  }
  bodies.forEach((b, i) => { b.dispMean = sum[i] / Math.max(1, cnt[i]); b.dispMax = max[i]; });
  return { bodies, counters: Array.from(c), nan };
}

window.__gpu2d = {
  get world() { return world; },
  get renderer() { return renderer; },
  get device() { return device; },
  get sceneInfo() { return sceneInfo; },
  get ready() { return ready; },
  reset: (opts) => resetScene(opts),
  benchSteps, readSummary,
  setPaused(v) { paused = !!v; accumulator = 0; },
  setLoop(v) { loopRunning = !!v; lastFrame = performance.now(); },
  /** Jedna klatka renderu na żądanie (zrzuty przy zatrzymanej pętli). */
  async renderOnce() {
    const enc = world.encodeFrame({ steps: [], dt: FIXED_DT, weaponsActive: false, flight: DEMO_FLIGHT, controlBody: sceneInfo.atlas,
      weaponParams: {}, camera: cameraPlan(0) });
    renderer.encode(enc, { viewHeight, time: world.simTime }, { querySet: world.querySet });
    world.encodeReadback(enc);
    device.queue.submit([enc.finish()]);
    world.afterSubmit();
    await device.queue.onSubmittedWorkDone();
    await world.lastMap;
  },
  setView(x, y, height, mode = 'free') { camFree.x = x; camFree.y = y; viewHeight = height; followMode = mode; camOffset.x = camOffset.y = 0; },
  setShow(opts) { Object.assign(renderer.show, opts); },
  /** Wejście ze skryptu: { laser, missile, keys: { KeyW: true, … } } */
  setInput(o = {}) {
    if ('laser' in o) weaponInput.laser = !!o.laser;
    if ('missile' in o) weaponInput.missile = !!o.missile;
    if (o.keys) for (const [k, v] of Object.entries(o.keys)) keys[k] = !!v;
  },
  get stats() { return world.stats; },
  setSlider(id, v) { el(id).value = v; el(id).dispatchEvent(new Event('input')); },
  hullStructure, loadHull, runShow
};

(async () => {
  resize();
  try {
    await initGpu();
  } catch (err) {
    fatal(`WebGPU niedostępne:\n${err.message}`);
    return;
  }
  toast('Ładowanie sprite\'ów Atlasa i kukły…', 2000);
  try {
    await resetScene();
    toast('W — lot, T — taran, LPM/PPM — broń, G — naprężenia belek', 3200);
  } catch (err) { fail(err); }
  window.__gpu2d.started = true;
  frame();
})();
