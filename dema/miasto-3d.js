// Demo MIASTA 3D na grzbiecie drednota (docs/OPIS-miasto-3d.md). NIC nie jest wpięte do gry ani do kreatora.
//
// Drednot Terra Novy z pliku (src/game/hullDesign/warships/dreadnought.js — ciągła skorupa z odsłoniętym środkiem wzdłuż
// osi; demo go nie przerabia) wypieka kompozytor kreatora i rysuje skóra kadłuba z gry (hexShips3D, oświetlenie v2) na
// Core3D; mostki i reaktory — modele gry w gniazdach. W odsłoniętym środku stoi miasto: układ płytki + masyw
// (src/game/hullDesign/hullDesignCity.js, w workerze dema/miasto-3d.worker.js), bryły i światła — src/3d/hullCity3D/.
//
// Serwowanie: `npm run dev` → /dema/miasto-3d.html
//   ?widok=caly|row|blisko|ukos|nisko|rufa   ?wariant=A|B|C   ?ziarno=N   ?zgory=punkty|poswiata   ?kamera=plaska
//   Widoki z góry (1–3) domyślnie kamerą PERSPEKTYWY znad okrętu — tą samą co pass FG gry (cameraPersp: 35°, wysokość
//   (h / 2) / tg(17,5°) / zoom, prosto w dół; ściany i okna widać ku brzegom kadru); „płaska” — kamera ortho passa gry.
//   ?katalog=1 — KATALOG BUDYNKÓW: wszystkie rodziny generatora wieżowców w czterech wielkościach na jasnej płycie
//   ?clean=1 (bez panelu)   ?test=1 (klatki z __miasto.runFrames — scripts/webgpu/miasto-3d-zrzuty.mjs)
import * as THREE from 'three/webgpu';
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { HullSurface } from '../src/3d/hullSurface.js';
import { HullLighting } from '../src/3d/hullLighting.js';
import { HullComposer, hullComposerTexPerUnit } from '../src/3d/hullDesign/hullComposer.js';
import { buildHullDecalAtlas } from '../src/3d/hullDesign/hullDecalAtlas.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { SimClock } from '../src/game/simClock.js';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { createHullDesignBuildClient } from '../src/game/hullDesign/hullDesignBuildClient.js';
import { isBridgeSocket } from '../src/game/hullDesign/hullDesignSchema.js';
import { HD_CITY_VARIANTS, packHullCity } from '../src/game/hullDesign/hullDesignCity.js';
import { buildTower } from '../src/game/hullDesign/hullDesignTowers.js';
import { bridgeLevel } from '../src/data/bridgeLevels.js';
import { attachBeamBridges } from '../src/game/shipBridgeBeams.js';
import { createReactor3D } from '../src/3d/reactor3D.js';
import { Bridge3D } from '../src/3d/bridge3D.js';
import { createHullCity3D, HULL_CITY3D_TUNE } from '../src/3d/hullCity3D/hullCity3D.js';
import { createBackdrop } from './rdzen-webgpu/tlo.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const KATALOG = params.get('katalog') === '1';
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
// Stan
const S = {
  view: 'gra',                                   // 'gra' — z góry (ortho jak w grze), 'ukos' — kamera 3D (free3d)
  cam: { x: -400, y: 0, zoom: 0.2 },
  orbit: { tx: -700, ty: 0, dist: 2600, yaw: -2.45, pitch: 0.36 },
  city: { variant: params.get('wariant') || 'A', seed: Number(params.get('ziarno') || 1), density: 1, height: 1, lights: 1 },
  cityOn: true, lightsOn: true, info: false,
  topGlow: params.get('zgory') === 'poswiata',
  persp: params.get('kamera') !== 'plaska',      // widoki z góry: perspektywa jak pass FG gry (true) albo ortho (false)   // światła z góry: punkty (false) albo miękka poświata kanionów (true)
  sunAz: 25,
  frame: 0, cpuMs: 0, frameMs: 16, syncPipes: 0, syncNames: [],
  gen: null, building: false, pendingCity: false
};
window.camera = { get x() { return S.cam.x; }, get y() { return S.cam.y; }, get zoom() { return S.cam.zoom; }, shakeMag: 0, shakeDur: 0, addShake() {} };
const SUN_DIST = 60000;
function placeSun() {
  const a = S.sunAz * Math.PI / 180;
  window.SUN = { x: S.cam.x + Math.cos(a) * SUN_DIST, y: Math.sin(a) * SUN_DIST, r: 823 };
}
placeSun();
if (!Array.isArray(window.wrecks)) window.wrecks = [];

// ---------------------------------------------------------------------------
// Render: Core3D + skóra kadłubów
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth, H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: '../assets/reflections/lacquer-sky.png' };
initHexShips3D({ canvas: glCanvas });
window.Core3D = Core3D;

let composer = null;
let backdrop = null;
let city3D = null;
const builder = createHullDesignBuildClient();
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
const renderList = [];
const ship = { entity: null, field: null };

function makeCanvas(w, h, data) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (data) g.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}
/** Mapa powierzchni z kompozytora wprost do HullSurface (jak demo kreatora). */
function provideSurface(image, data, w, h) {
  HullSurface.acquireUniform(image);
  const entry = HullSurface._entries.get(image);
  const i = HullSurface._pending.indexOf(entry);
  if (i >= 0) HullSurface._pending.splice(i, 1);
  entry.state = 'baking';
  HullSurface._finish(entry, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, 0);
}
const nextTask = () => new Promise((ok) => setTimeout(ok, 0));

async function buildShip() {
  const design = hullDesignPreset('dreadnought');
  const T = window.__miasto.startup;
  let t = performance.now();
  const res = await builder.build(design, { fast: false, full: true });
  T.budowa = Math.round(performance.now() - t); t = performance.now();
  const field = res.field;
  const atlas = buildHullDecalAtlas(field.expanded.decals);
  composer.setDesign(field, atlas, { texPerUnit: hullComposerTexPerUnit(field.image.w, field.image.h), glowToAlbedo: true });
  const bake = await composer.bake({ emission: false });
  T.wypiek = Math.round(performance.now() - t); t = performance.now();
  const im = field.image;
  const physicsCanvas = makeCanvas(res.physics.width, res.physics.height, res.physics.data);
  await nextTask();
  const visual = makeCanvas(bake.width, bake.height, bake.albedo);
  await nextTask();
  provideSurface(visual, bake.surface, bake.width, bake.height);
  const e = {
    id: 'drednot_miasto', x: im.cx, y: im.cy, vx: 0, vy: 0, angle: 0, angVel: 0,
    mass: Math.max(5000, res.cells * 400), hp: 1e6, maxHp: 1e6,
    type: 'cruiser', isPirate: false, shipFrame: 'kreator', isCapitalShip: true, faction: 'terra',
    __hardpointScaleX: 1, __hardpointScaleY: 1, __hardpointScale: 1,
    __label: field.expanded.design.name, displayName: field.expanded.design.name, visual: { spriteScale: 1 },
    editorLights: { ...res.mounts.lights, autoFlood: false }
  };
  HullBodies.createHull(e, physicsCanvas, { visualImage: visual, hullProfileId: 'terran_battleship' });
  if (!e.beamHull) throw new Error('createHull bez kadłuba');
  ship.entity = e;
  ship.field = field;
  T.kadlub = Math.round(performance.now() - t);
  reactorCoresFrom(field);
  bridgesAttach(field);
}

// ---------------------------------------------------------------------------
// Reaktory i mostki w gniazdach (modele gry — skala i kontekst dla miasta; wzór: demo kreatora)
let reactor3D = null;
const reactorCores = [];
const reactorOpts = { origin: { x: 0, y: 0 }, view: null, zoom: 1 };
function reactorInit() {
  reactor3D = createReactor3D({
    scene: Core3D.scene,
    frameOf: (core, out) => {
      out.x = core.wx; out.y = core.wy; out.R = core.gridR; out.cs = 0;
      out.axX = core.gridR; out.axY = 0; out.ayX = 0; out.ayY = core.gridR;
      return out;
    },
    hostReady: (h) => !!h && h === ship.entity
  });
  Core3D.warmup.add({ name: 'model reaktora (reactor3D)', objects: () => reactor3D.warmupMeshes(), layer: 0, phase: 'loading' });
}
function reactorCoresFrom(field) {
  reactorCores.length = 0;
  for (const m of field.expanded.modules) {
    if (m.type !== 'reactor' || m.v !== 2) continue;
    reactorCores.push({
      uid: `miasto_core_${reactorCores.length}`, host: ship.entity, state: 'nominal', integrity: 1, invalid: null,
      wx: m.x, wy: m.y, gridR: m.r, color: [0.22, 0.72, 1.0],
      model: { housingR: m.r, housing: true, kind: 'terran', tier: null }, deadCount: 0, elsewhereCount: 0, aliveCount: 0
    });
  }
}
const bridgeList = [];
const bridgeOpts = { nowSec: 0, dt: 1 / 60, zoom: 1, cull: null, camera: null };
function bridgesInit() {
  Bridge3D.attach(Core3D.scene);
  Core3D.warmup.add({ name: 'mostki 3D (bridge3D)', objects: () => Bridge3D.warmupMeshes(), layer: 0, phase: 'loading' });
  // okna i lampy mostków leżą na warstwie FG (2) — rozgrzewka kamerą tego passa (inaczej pipeline w klatce przy zbliżeniu)
  Core3D.warmup.add({ name: 'mostki 3D: okna (FG)', objects: () => Bridge3D.warmupMeshes().filter((m) => m.layers.isEnabled(2)), layer: 2, phase: 'loading' });
}
function bridgesAttach(field) {
  const e = ship.entity;
  const im = field.image;
  const zones = [];
  for (const m of field.expanded.modules) {
    if (!isBridgeSocket(m)) continue;
    zones.push({ id: `mostek_${zones.length}`, label: `Mostek ${bridgeLevel(m.lv).roman}`, x: m.x - im.cx, y: m.y - im.cy, w: m.w * 2, h: m.h * 2, rot: (m.rot || 0) * 180 / Math.PI, level: m.lv });
  }
  const hull = e.beamHull;
  attachBeamBridges(e, zones, { scaleX: 1, scaleY: 1, pngWidth: hull.srcWidth, pngHeight: hull.srcHeight, hullKey: 'kreator' });
}

// ---------------------------------------------------------------------------
// MIASTO: worker generatora → partia brył i świateł
const cityWorker = new Worker(new URL('./miasto-3d.worker.js', import.meta.url), { type: 'module' });
let cityReq = 0;
const cityWaiters = new Map();
cityWorker.onmessage = (e) => {
  const w = cityWaiters.get(e.data.id);
  cityWaiters.delete(e.data.id);
  if (w) w(e.data);
};
function cityInit() {
  city3D = createHullCity3D({ scene: Core3D.scene });
  Core3D.warmup.add({ name: 'miasto 3D (hullCity3D)', objects: () => city3D.warmupMeshes(), layer: 0, phase: 'loading' });
  window.__miasto.city3D = city3D;
}
async function buildCity(first = false) {
  if (KATALOG) { buildCatalog(); return; }
  if (S.building) { S.pendingCity = true; return; }
  S.building = true;
  const id = ++cityReq;
  const msg = { id, opts: { variant: S.city.variant, seed: S.city.seed, density: S.city.density, height: S.city.height, lights: 1 } };
  if (first) {
    const f = ship.field;
    msg.field = { expanded: f.expanded, grid: f.grid, levels: f.levels, bounds: f.bounds, band: f.band, pipeNet: f.pipeNet, image: f.image };
  }
  const t = performance.now();
  const r = await new Promise((ok) => { cityWaiters.set(id, ok); cityWorker.postMessage(msg); });
  S.building = false;
  if (r.error) reportError(r.error);
  else {
    const t1 = performance.now();
    city3D.setCity(r.city);
    city3D.setPose(0, 0, 0);
    S.gen = { boardMs: r.boardMs, cityMs: r.cityMs, totalMs: Math.round(performance.now() - t), uploadMs: Math.round(performance.now() - t1), ...r.city.stats, nBuildings: r.city.nBuildings, ok: r.city.ok, reason: r.city.reason };
    S.cityData = r.city;
  }
  if (S.pendingCity) { S.pendingCity = false; buildCity(false); }
}

// ---------------------------------------------------------------------------
// KATALOG BUDYNKÓW (?katalog=1): rodziny generatora wieżowców (wiersze) × cztery wielkości (kolumny) na jasnej płycie
// (zamiast kadłuba — płyta pisze głębię, więc cień miasta kładzie się na niej jak na pancerzu).
const CAT_FAMILIES = ['slab', 'stepped', 'twin', 'wedge', 'hall', 'spire'];
const CAT_LABELS = { slab: 'płyta-blok', stepped: 'wieża z uskokami', twin: 'bliźniacze wieże', wedge: 'klin tarasów', hall: 'hala', spire: 'iglica' };
const CAT_SIZES = [[18, 12, 28], [30, 20, 58], [48, 30, 105], [24, 24, 170]];
const CAT_PITCH = [150, 120];
const catalog = { labels: [], ground: null, w: 0, h: 0 };
function buildCatalog() {
  const towers = [];
  catalog.labels.length = 0;
  CAT_FAMILIES.forEach((fam, r) => {
    CAT_SIZES.forEach(([hw, hh, H], c) => {
      const x = (c - (CAT_SIZES.length - 1) / 2) * CAT_PITCH[0], y = (r - (CAT_FAMILIES.length - 1) / 2) * CAT_PITCH[1];
      const t = buildTower({ x, y, hw, hh, H, family: fam, seed: S.city.seed * 97 + r * 13 + c, face: [0, 1] });
      towers.push({ tower: t, flags: 0 });
      if (c === 0) catalog.labels.push({ x: x - CAT_PITCH[0] * 0.5 + 6, y: y - CAT_PITCH[1] * 0.42, text: CAT_LABELS[fam] });
    });
  });
  catalog.w = CAT_SIZES.length * CAT_PITCH[0];
  catalog.h = CAT_FAMILIES.length * CAT_PITCH[1];
  const pk = packHullCity(towers, { hmCell: 1 });
  city3D.setCity(pk);
  city3D.setPose(0, 0, 0);
  S.cityData = pk;
  S.gen = { ok: true, nBuildings: towers.length, cityMs: 0, boardMs: 0, uploadMs: 0 };
}
function catalogGround() {
  const g = new THREE.PlaneGeometry(catalog.w + 200, catalog.h + 200);
  const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.5, 0.5, 0.49) });
  m.name = 'miasto-katalog:plyta';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'miasto-katalog:plyta';
  mesh.renderOrder = 10;
  mesh.position.z = -0.05;
  Core3D.scene.add(mesh);
  catalog.ground = mesh;
  Core3D.warmup.add({ name: 'miasto: płyta katalogu', objects: () => [mesh], layer: 0, phase: 'loading' });
}
function drawCatalogLabels() {
  if (!KATALOG || S.view !== 'gra' || document.body.classList.contains('clean') && !S.labels) return;
  ctx2d.save();
  ctx2d.font = '600 13px "Segoe UI", system-ui, sans-serif';
  ctx2d.fillStyle = '#1b2228';
  for (const l of catalog.labels) ctx2d.fillText(l.text, (l.x - S.cam.x) * S.cam.zoom + W / 2, (l.y - S.cam.y) * S.cam.zoom + H / 2);
  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Kamera: z góry (ortho jak w grze) albo z ukosa (free3d, orbita)
const _eye = new THREE.Vector3(), _tgt = new THREE.Vector3(), _up = new THREE.Vector3(0, 0, 1), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const freeCam = { x: 0, y: 0, zoom: 1, mode: 'free3d', position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 38, near: 4, far: 400000 };
// Kamera perspektywy z góry = Core3D.cameraPersp passa FG gry (FLAT_PERSP_FOV 35°, nad punktem kamery na wysokości
// (h / 2) / tg(fov / 2) / zoom — płaszczyzna z = 0 w tej samej skali co ortho), podana jako free3d, żeby w demie całą
// scenę (kadłub, mostki, reaktory, miasto) rysowała ta sama kamera.
const FLAT_FOV = 35;
const topCam = { x: 0, y: 0, zoom: 1, mode: 'free3d', position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: FLAT_FOV, near: 10, far: 400000 };
const _upY = new THREE.Vector3(0, 1, 0);
function cameraForFrame() {
  if (S.view !== 'ukos' && !S.persp) return { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom };
  if (S.view !== 'ukos') {
    const c = S.cam;
    const h = (H / 2) / Math.tan(FLAT_FOV * Math.PI / 360) / c.zoom;
    _eye.set(c.x, -c.y, h);
    _tgt.set(c.x, -c.y, 0);
    _m.lookAt(_eye, _tgt, _upY);
    _q.setFromRotationMatrix(_m);
    topCam.position.x = _eye.x; topCam.position.y = _eye.y; topCam.position.z = _eye.z;
    topCam.quaternion.x = _q.x; topCam.quaternion.y = _q.y; topCam.quaternion.z = _q.z; topCam.quaternion.w = _q.w;
    topCam.x = c.x; topCam.y = c.y; topCam.zoom = c.zoom;
    // głębia: wszystko leży między dnem a ~400 j. nad płaszczyzną — bliska płaszczyzna wysoko (precyzja)
    topCam.near = Math.max(10, h - 4000);
    topCam.far = h + 60000;
    return topCam;
  }
  const o = S.orbit;
  const cp = Math.cos(o.pitch);
  _tgt.set(o.tx, -o.ty, 0);
  _eye.set(o.tx + o.dist * cp * Math.cos(o.yaw), -o.ty + o.dist * cp * Math.sin(o.yaw), o.dist * Math.sin(o.pitch));
  _m.lookAt(_eye, _tgt, _up);
  _q.setFromRotationMatrix(_m);
  freeCam.position.x = _eye.x; freeCam.position.y = _eye.y; freeCam.position.z = _eye.z;
  freeCam.quaternion.x = _q.x; freeCam.quaternion.y = _q.y; freeCam.quaternion.z = _q.z; freeCam.quaternion.w = _q.w;
  freeCam.x = o.tx; freeCam.y = o.ty;
  freeCam.zoom = Math.max(0.02, H / (2 * o.dist * Math.tan(freeCam.fov * Math.PI / 360)));
  return freeCam;
}
const VIEWS = {
  caly: () => { S.view = 'gra'; S.cam = { x: -150, y: 0, zoom: Math.min(W * 0.9 / 8000, H * 0.9 / 3816) }; },
  row: () => { S.view = 'gra'; S.cam = { x: -450, y: -60, zoom: W / 3600 }; },
  blisko: () => { S.view = 'gra'; S.cam = { x: 60, y: -170, zoom: W / 1200 }; },
  // ujęcie jak kadr odniesienia: nisko z boku-rufy, wzdłuż grzbietu ku dziobowi
  ukos: () => { S.view = 'ukos'; S.orbit = { tx: -350, ty: 60, dist: 2300, yaw: -2.62, pitch: 0.33 }; },
  nisko: () => { S.view = 'ukos'; S.orbit = { tx: -150, ty: 0, dist: 1500, yaw: Math.PI + 0.22, pitch: 0.2 }; },
  rufa: () => { S.view = 'ukos'; S.orbit = { tx: -900, ty: 0, dist: 2100, yaw: 0.55, pitch: 0.42 }; }
};
const CATALOG_VIEWS = {
  caly: () => { S.view = 'gra'; S.cam = { x: 0, y: 0, zoom: Math.min(W * 0.94 / catalog.w, H * 0.94 / catalog.h) }; },
  ukos: () => { S.view = 'ukos'; S.orbit = { tx: 0, ty: 30, dist: 1050, yaw: -1.95, pitch: 0.5 }; },
  nisko: () => { S.view = 'ukos'; S.orbit = { tx: 0, ty: 0, dist: 820, yaw: -1.6, pitch: 0.28 }; }
};
function setView(name) {
  if (KATALOG && typeof name === 'string' && CATALOG_VIEWS[name]) { CATALOG_VIEWS[name](); S.viewName = name; placeSun(); return; }
  if (typeof name === 'object' && name) {
    if (name.orbit) { S.view = 'ukos'; Object.assign(S.orbit, name.orbit); } else { S.view = 'gra'; Object.assign(S.cam, name); }
  } else if (VIEWS[name]) { VIEWS[name](); S.viewName = name; }
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === S.viewName);
  placeSun();
}

// ---------------------------------------------------------------------------
// Klatka
const PHYS_DT = 1 / 60;
function frame() {
  const t0 = performance.now();
  S.frame++;
  renderList.length = 0;
  if (ship.entity) renderList.push(ship.entity);
  SimClock.advance(PHYS_DT);
  HullBodies.step(PHYS_DT, renderList);
  render();
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
}
function render() {
  Core3D.beginPlanetLayerFrame?.();
  SimClock.beginRender(1, PHYS_DT, true);
  const cam = cameraForFrame();
  if (S.view === 'ukos') {
    cullInfo.x = cam.x; cullInfo.y = cam.y; cullInfo.drawHalfW = cullInfo.drawHalfH = 2e4; cullInfo.halfW = cullInfo.halfH = 6e4;
  } else if (S.persp) {
    // perspektywa z góry: płaszczyzna w kadrze jak w ortho, bryły nad nią wychodzą ku brzegom — kadr z zapasem
    cullInfo.x = cam.x; cullInfo.y = cam.y;
    cullInfo.drawHalfW = W * 0.6 / cam.zoom + 900; cullInfo.drawHalfH = H * 0.6 / cam.zoom + 900;
    cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  } else {
    cullInfo.x = cam.x; cullInfo.y = cam.y;
    cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
    cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  }
  backdrop.sync(cam, W, H);
  updateHexShips3D(cam, renderList, cullInfo);
  if (city3D) {
    HULL_CITY3D_TUNE.lights = S.lightsOn ? S.city.lights : 0;
    HULL_CITY3D_TUNE.topGlow = S.topGlow ? 1 : 0;
    city3D.setSun(window.SUN.x, window.SUN.y);
    city3D.update(S.cityOn && S.cityData ? 1 : 0, { topView: S.view !== 'ukos' && S.persp ? 1 : 0 });
  }
  if (reactor3D) {
    reactorOpts.origin.x = cam.x; reactorOpts.origin.y = cam.y; reactorOpts.view = cullInfo; reactorOpts.zoom = cam.zoom;
    reactor3D.sync(reactorCores, 0, PHYS_DT, reactorOpts);
  }
  bridgeList.length = 0;
  if (ship.entity?.bridgeState) bridgeList.push(ship.entity);
  bridgeOpts.nowSec = S.frame * PHYS_DT; bridgeOpts.zoom = cam.zoom; bridgeOpts.cull = cullInfo; bridgeOpts.camera = cam;
  Bridge3D.update(bridgeList, bridgeOpts);
  drawHexShips3D(ctx2d, W, H);
  drawCatalogLabels();
  if (S.info) updateInfo();
}
function updateInfo() {
  const g = S.gen || {};
  const st = city3D?.stats || {};
  const gpu = Core3D.gpuFrameMs;
  $('info').textContent = [
    `miasto ${g.ok ? '' : `(brak: ${g.reason || '…'})`}  wariant ${S.city.variant}  ziarno ${S.city.seed}`,
    `bryły ${st.boxes ?? 0}  budynki ${g.nBuildings ?? 0}  światła ${st.lights ?? 0}  szczyt ${st.top ?? 0} j.`,
    `generator ${g.cityMs ?? '–'} ms (płytka ${g.boardMs ?? '–'} ms), wysyłka ${g.uploadMs ?? '–'} ms`,
    `pamięć GPU ${(st.gpuBytes / 1048576 || 0).toFixed(1)} MB  mapa wysokości ${st.heightTexels ?? 0} tekseli`,
    `klatka ${S.frameMs.toFixed(1)} ms  CPU ${S.cpuMs.toFixed(1)} ms  GPU ${gpu ? gpu.toFixed(2) : '–'} ms  pipeline sync ${S.syncPipes}`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Wejście
let drag = null;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => {
  canvas2d.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey };
  canvas2d.classList.add('drag');
});
canvas2d.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (S.view === 'gra') {
    S.cam.x -= dx / S.cam.zoom; S.cam.y -= dy / S.cam.zoom;
  } else if (drag.b === 2 || drag.shift) {
    const o = S.orbit, k = o.dist / H * 1.2;
    const fx = -Math.cos(o.yaw), fy = -Math.sin(o.yaw);   // w przód (scena)
    const rx = -fy, ry = fx;
    o.tx -= (rx * dx - fx * dy) * k;
    o.ty += (ry * dx - fy * dy) * k;
  } else {
    S.orbit.yaw -= dx * 0.005;
    S.orbit.pitch = Math.max(0.05, Math.min(1.45, S.orbit.pitch + dy * 0.004));
  }
  S.viewName = null;
});
const endDrag = () => { drag = null; canvas2d.classList.remove('drag'); };
canvas2d.addEventListener('pointerup', endDrag);
canvas2d.addEventListener('pointercancel', endDrag);
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = Math.exp(-e.deltaY * 0.0012);
  if (S.view === 'gra') {
    const wx = S.cam.x + (e.clientX - W / 2) / S.cam.zoom, wy = S.cam.y + (e.clientY - H / 2) / S.cam.zoom;
    S.cam.zoom = Math.max(0.03, Math.min(12, S.cam.zoom * k));
    S.cam.x = wx - (e.clientX - W / 2) / S.cam.zoom; S.cam.y = wy - (e.clientY - H / 2) / S.cam.zoom;
  } else {
    S.orbit.dist = Math.max(60, Math.min(20000, S.orbit.dist / k));
  }
  S.viewName = null;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
  const v = { 1: 'caly', 2: 'row', 3: 'blisko', 4: 'ukos', 5: 'nisko', 6: 'rufa' }[e.key];
  if (v) setView(v);
  else if (e.key === 'm' || e.key === 'M') toggleCity();
  else if (e.key === 'l' || e.key === 'L') toggleLights();
  else if (e.key === 'g' || e.key === 'G') setTopGlow(!S.topGlow);
  else if (e.key === 'p' || e.key === 'P') setPersp(!S.persp);
  else if (e.key === 'i' || e.key === 'I') { S.info = !S.info; $('info').style.display = S.info ? 'block' : 'none'; }
});
function toggleCity(on = !S.cityOn) { S.cityOn = on; $('cityOn').classList.toggle('on', on); }
function toggleLights(on = !S.lightsOn) { S.lightsOn = on; $('lightsOn').classList.toggle('on', on); }
function setPersp(on) {
  S.persp = !!on;
  $('camPersp').classList.toggle('on', S.persp);
  $('camFlat').classList.toggle('on', !S.persp);
  return true;
}
function setTopGlow(on) {
  S.topGlow = !!on;
  $('topDots').classList.toggle('on', !S.topGlow);
  $('topGlow').classList.toggle('on', S.topGlow);
  return true;
}

function bindPanel() {
  const sel = $('variant');
  for (const [k, v] of Object.entries(HD_CITY_VARIANTS)) sel.add(new Option(v.label, k));
  sel.value = S.city.variant;
  sel.onchange = () => { S.city.variant = sel.value; buildCity(); };
  $('seed').value = S.city.seed;
  $('seed').onchange = () => { S.city.seed = Math.round(Number($('seed').value) || 0); buildCity(); };
  $('seedNext').onclick = () => { S.city.seed++; $('seed').value = S.city.seed; buildCity(); };
  const range = (id, get, set, fmt, rebuild) => {
    const el = $(id), out = $(`${id}O`);
    el.value = get();
    out.textContent = fmt(get());
    el.oninput = () => { set(Number(el.value)); out.textContent = fmt(Number(el.value)); };
    if (rebuild) el.onchange = () => buildCity();
  };
  const f2 = (v) => v.toFixed(2);
  range('density', () => S.city.density, (v) => { S.city.density = v; }, f2, true);
  range('height', () => S.city.height, (v) => { S.city.height = v; }, f2, true);
  range('lights', () => S.city.lights, (v) => { S.city.lights = v; }, f2, false);
  range('sun', () => S.sunAz, (v) => { S.sunAz = v; placeSun(); }, (v) => `${v}°`, false);
  range('elev', () => HULL_CITY3D_TUNE.shadowElevDeg, (v) => { HULL_CITY3D_TUNE.shadowElevDeg = v; }, (v) => `${v}°`, false);
  $('cityOn').onclick = () => toggleCity();
  $('lightsOn').onclick = () => toggleLights();
  $('camPersp').onclick = () => setPersp(true);
  $('camFlat').onclick = () => setPersp(false);
  setPersp(S.persp);
  $('topDots').onclick = () => setTopGlow(false);
  $('topGlow').onclick = () => setTopGlow(true);
  setTopGlow(S.topGlow);
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('fold').onclick = () => { $('panel').classList.toggle('min'); $('fold').textContent = $('panel').classList.contains('min') ? '+' : '–'; };
}

function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__miastoHook) return;
  pu.__miastoHook = true;
  const orig = pu.createRenderPipeline;
  pu.createRenderPipeline = function (ro, promises) {
    if (!promises) {
      S.syncPipes++;
      if (S.syncNames.length < 16) S.syncNames.push(`${ro?.material?.name || ro?.material?.type} @ ${ro?.object?.name || ro?.object?.type}`);
    }
    return orig.call(this, ro, promises);
  };
}

addEventListener('resize', () => {
  W = innerWidth; H = innerHeight;
  canvas2d.width = W; canvas2d.height = H;
  glCanvas.width = W; glCanvas.height = H;
  resizeHexShips3D(W, H);
  if (S.viewName) setView(S.viewName);
});

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  S.frameMs = S.frameMs * 0.9 + dt * 1000 * 0.1;
  if (!TEST) frame();
  requestAnimationFrame(loop);
}

// Haki narzędzi (scripts/webgpu/miasto-3d-zrzuty.mjs)
window.__miasto = {
  ready: false, error: null, startup: {}, S,
  setView, setCity: async (o) => { Object.assign(S.city, o); await buildCity(); while (S.building || S.pendingCity) await new Promise((r) => setTimeout(r, 30)); return S.gen; },
  setSun(az, elev) { if (az != null) S.sunAz = az; if (elev != null) HULL_CITY3D_TUNE.shadowElevDeg = elev; placeSun(); return true; },
  toggleCity, toggleLights, setTopGlow, setPersp, showLabels(on) { S.labels = !!on; return true; },
  async runFrames(n = 1) {
    for (let i = 0; i < n; i++) {
      // pułapka 44: rysunek tylko po rAF — symulacja co klatkę, obraz ostatniej
      frame();
      await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  stats() { return { gen: S.gen, city: city3D?.stats, syncPipes: S.syncPipes, syncNames: S.syncNames.slice(), gpuMs: Core3D.gpuFrameMs, cpuMs: S.cpuMs, startup: this.startup, view: S.view, cam: S.cam, orbit: S.orbit, drawCalls: Core3D.lastFrameRenderInfo?.total?.drawCalls ?? null }; },
  tune: HULL_CITY3D_TUNE
};

(async () => {
  try {
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__miasto.error = 'webgpu';
      return;
    }
    const T0 = performance.now(), T = window.__miasto.startup;
    resizeHexShips3D(W, H);
    HullLighting.setModel?.('pbr');
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    backdrop = createBackdrop(Core3D);
    composer = new HullComposer(Core3D.renderer);
    reactorInit();
    bridgesInit();
    cityInit();
    await composer.prewarm();
    T.kompozytor = Math.round(performance.now() - T0);
    $('loading').textContent = KATALOG ? 'Katalog wieżowców…' : 'Wypiek drednota…';
    bindPanel();
    if (KATALOG) {
      buildCatalog();
      catalogGround();
      setView(params.get('widok') || 'caly');
    } else {
      setView(params.get('widok') || 'caly');
      await buildShip();
      $('loading').textContent = 'Miasto (worker)…';
      await buildCity(true);
      $('loading').textContent = 'Rozgrzewka pipeline\'ów…';
    }
    T.miasto = Math.round(performance.now() - T0);
    await Core3D.warmup.flush?.({ timeoutMs: 8000 });
    city3D.afterWarmup();
    for (let k = 0; k < 6; k++) frame();
    await HullSurface.whenIdle(4000);
    hookPipelines();
    T.gotowe = Math.round(performance.now() - T0);
    $('loading').style.display = 'none';
    document.body.classList.remove('loading');
    window.__miasto.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
    window.__miasto.error = String(err);
  }
})();
