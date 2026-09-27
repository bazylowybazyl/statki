// dema/asteroidy-webgpu.js — demo WebGPU: gęste pole asteroid, fizyczny pył,
// setki świateł.
//
// Scena „5 · Gęste pole (Main Belt)” z dema/asteroidy.html (to samo miejsce,
// te same skały z AsteroidBeltField) na WebGPURenderer + TSL:
//   • skały gry (pasmo PLAY) w passie gry (kamera ortho, dokładnie na swoich
//     pozycjach), skały tła (RUBBLE / MID / DEEP) w passie tła (kamera persp.
//     z paralaksą) — jak Core3D w grze; passy składane: gra + tło · (1 − alfa);
//   • materiał skał w TSL (rockMaterial.js) z własnym modelem światła, przez
//     który idą słońce i WSZYSTKIE światła siatki (lights.js);
//   • fizyczny pył: compute (dust.js);
//   • post: bloom (BloomNode) i tone mapping ACES gry, wyjście sRGB.
//
// Precyzja: świat leży przy ~6,4 mln j. Wszystko, co trafia na GPU (skały,
// kadłuby, światła, pył, kamery), jest względem lokalnego początku sceny przy
// kamerze liczonego na CPU w double; po odjeździe kamery o > 20 tys. j.
// początek przeskakuje, a dane są przesuwane (pył — compute, bez skoku).
//
// Konsola: window.__demo (setZoom, step, explode, setParticles, setLights, stats).

import * as THREE from 'three/webgpu';
import { pass, float, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import carrierUrl from '../src/assets/ships/terrancarrier.png';
import { SUN, field, FIELD_SPOT, BELT_BAND, sunTransmittance, AU } from './asteroidy-webgpu/world.js';
import { RockShapeBankGPU } from './asteroidy-webgpu/rockBank.js';
import { createRockNoiseVolume } from './asteroidy-webgpu/rockNoise.js';
import { createRockShared, RockNodeMaterial, ROCK_LIGHT_DEFAULTS } from './asteroidy-webgpu/rockMaterial.js';
import { RockLayer } from './asteroidy-webgpu/rockLayers.js';
import { LightGrid, GridLighting, addShipLights, LIGHT_CAP } from './asteroidy-webgpu/lights.js';
import { DemoHull } from './asteroidy-webgpu/ship.js';
import { GlowSprites } from './asteroidy-webgpu/glowSprites.js';
import { Sky } from './asteroidy-webgpu/sky.js';
import { acesGame } from './asteroidy-webgpu/tslCommon.js';

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

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3.2;
const FOV_DEG = 35;
const REBASE_DIST = 20000;
// Szyk eskorty: przy lewej burcie Atlasa, lekko z tyłu (jak w demie WebGL).
const ESCORT_OFFSET = Object.freeze({ along: -300, side: -1250 });

// ---------------------------------------------------------------------------
// Stan

const S = {
  cam: { x: FIELD_SPOT.x, y: FIELD_SPOT.y, zoom: FIELD_SPOT.zoom },
  targetZoom: FIELD_SPOT.zoom,
  ship: { x: FIELD_SPOT.x, y: FIELD_SPOT.y, vx: 0, vy: 0, angle: FIELD_SPOT.angle, angVel: 0, thrust: 0, reverse: 0 },
  origin: { x: Math.round(FIELD_SPOT.x), y: Math.round(FIELD_SPOT.y) },
  keys: new Set(),
  time: 0,
  frame: 0,
  fps: 60,
  cpuMs: 0,
  gpuRenderMs: 0,
  gpuComputeMs: 0,
  speed: 1400,
  showEscort: true,
  shipLights: true,
  dynLights: true,
  sunOcc: true,
  backRocks: true,
  rockLights: true,
  thrustGain: 1,
  blastGain: 1,
  dampGain: 1,
  dustBright: 1,
  lightTarget: 256,
  mouse: { x: 0, y: 0, inside: false },
  hideUi: false,
  ready: false
};

let W = innerWidth;
let H = innerHeight;

// ---------------------------------------------------------------------------
// Renderer i sceny

let renderer = null;
let pipeline = null;
let bloomNode = null;
const bgScene = new THREE.Scene();
const fgScene = new THREE.Scene();
bgScene.name = 'tło';
fgScene.name = 'gra';
const fgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 80000);
const bgCam = new THREE.PerspectiveCamera(FOV_DEG, 1, 10, 50000);
const sunFg = new THREE.DirectionalLight(0xffffff, ROCK_LIGHT_DEFAULTS.sunIntensity);
const sunBg = new THREE.DirectionalLight(0xffffff, ROCK_LIGHT_DEFAULTS.sunIntensity);
for (const [scene, light] of [[fgScene, sunFg], [bgScene, sunBg]]) {
  light.color.setRGB(...ROCK_LIGHT_DEFAULTS.sunColor, THREE.LinearSRGBColorSpace);
  scene.add(light);
  scene.add(light.target);
}

const grid = new LightGrid();
let shared = null;
let bank = null;
const layers = [];
let playLayer = null;
let atlas = null;
let escort = null;
let glow = null;
let sky = null;

function focalPx() {
  return (H * 0.5) / Math.tan((FOV_DEG * Math.PI / 180) * 0.5);
}

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome/Edge z WebGPU i kontekst bezpieczny (localhost).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU (requestAdapter zwrócił null).');
  // Więcej zmiennych między etapami i buforów storage, jeśli adapter pozwala.
  const requiredLimits = {};
  const want = { maxInterStageShaderVariables: 28, maxStorageBuffersPerShaderStage: 10 };
  for (const [k, v] of Object.entries(want)) {
    if (adapter.limits[k] >= v) requiredLimits[k] = v;
  }
  renderer = new THREE.WebGPURenderer({
    antialias: false,
    alpha: false,
    trackTimestamp: true,
    requiredLimits
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.lighting = new GridLighting(grid);
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  renderer.highPrecision = true;
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie WebGL — demo wymaga WebGPU.');
  }
}

function buildPipeline() {
  pipeline = new THREE.RenderPipeline(renderer);
  const bgPass = pass(bgScene, bgCam, { samples: 4 });
  const fgPass = pass(fgScene, fgCam, { samples: 4 });
  const bg = bgPass.getTextureNode('output');
  const fg = fgPass.getTextureNode('output');
  // Pass gry nad tłem: kolor gry premultiplied, tło pod jej alfą.
  const comp = fg.rgb.add(bg.rgb.mul(float(1.0).sub(fg.a)));
  bloomNode = bloom(vec4(comp, 1.0), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  pipeline.outputNode = vec4(acesGame(comp.add(bloomNode.rgb)), 1.0);
  pipeline.outputColorTransform = true;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer?.setSize(W, H);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Początek sceny, kamery

function rebaseIfNeeded() {
  const dx = S.cam.x - S.origin.x;
  const dy = S.cam.y - S.origin.y;
  if (Math.abs(dx) < REBASE_DIST && Math.abs(dy) < REBASE_DIST) return;
  const nx = Math.round(S.cam.x);
  const ny = Math.round(S.cam.y);
  const shiftX = nx - S.origin.x;
  const shiftY = ny - S.origin.y;
  S.origin.x = nx;
  S.origin.y = ny;
  for (const layer of layers) layer.setOrigin(nx, ny);
  onOriginShift(shiftX, shiftY);
}

// Przesunięcie żywych danych (pył) przy zmianie początku — dopina dust.js.
let onOriginShift = () => {};

function updateCameras() {
  const zoom = S.cam.zoom;
  const cx = S.cam.x - S.origin.x;
  const cy = -(S.cam.y - S.origin.y);
  const hw = W * 0.5 / zoom;
  const hh = H * 0.5 / zoom;
  fgCam.left = -hw; fgCam.right = hw; fgCam.top = hh; fgCam.bottom = -hh;
  fgCam.position.set(cx, cy, 30000);
  fgCam.near = 1;
  fgCam.far = 60000;
  fgCam.updateProjectionMatrix();
  fgCam.updateMatrixWorld(true);
  const camZ = focalPx() / zoom;
  bgCam.aspect = W / H;
  bgCam.fov = FOV_DEG;
  bgCam.near = Math.max(5, camZ * 0.05);
  bgCam.far = camZ + 45000;
  bgCam.position.set(cx, cy, camZ);
  bgCam.updateProjectionMatrix();
  bgCam.updateMatrixWorld(true);
  return camZ;
}

// Kierunek do słońca (scena) podniesiony o kąt nad płaszczyzną — jak w skałach gry.
const _sunDir = new THREE.Vector3();
function updateSun() {
  const dx = SUN.x - S.cam.x;
  const dy = -(SUN.y - S.cam.y);
  const l = Math.hypot(dx, dy) || 1;
  const e = ROCK_LIGHT_DEFAULTS.sunElevDeg * Math.PI / 180;
  _sunDir.set(dx / l * Math.cos(e), dy / l * Math.cos(e), Math.sin(e)).normalize();
  shared.sunDir.value.copy(_sunDir);
  const cx = S.cam.x - S.origin.x;
  const cy = -(S.cam.y - S.origin.y);
  for (const light of [sunFg, sunBg]) {
    light.target.position.set(cx, cy, 0);
    light.position.set(cx + _sunDir.x * 1000, cy + _sunDir.y * 1000, _sunDir.z * 1000);
    light.target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
  }
  shared.sunOcc.value = S.sunOcc ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Ruch statku i kamery (jak w dema/asteroidy.js)

function stepShip(dt) {
  const ship = S.ship;
  const k = S.keys;
  const boost = k.has('shift') ? 3 : 1;
  const accel = 900 * boost;
  const fwd = k.has('w');
  const back = k.has('s');
  if (fwd) { ship.vx += Math.cos(ship.angle) * accel * dt; ship.vy += Math.sin(ship.angle) * accel * dt; }
  if (back) { ship.vx -= Math.cos(ship.angle) * accel * 0.6 * dt; ship.vy -= Math.sin(ship.angle) * accel * 0.6 * dt; }
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
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  // Ciąg dysz (0..1, z dopalaczem do 1,6) — wygładzony (rozruch plazmy).
  const want = fwd ? (boost > 1 ? 1.6 : 1) : 0;
  ship.thrust += (want - ship.thrust) * (1 - Math.exp(-(want > ship.thrust ? 6 : 3) * dt));
}

function formationCenter(out) {
  let tx = S.ship.x;
  let ty = S.ship.y;
  if (escort && S.showEscort) {
    const c = Math.cos(S.ship.angle);
    const s = Math.sin(S.ship.angle);
    tx += (c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side) * 0.5;
    ty += (s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side) * 0.5;
  }
  out.x = tx;
  out.y = ty;
  return out;
}

const _fc = { x: 0, y: 0 };
function stepCamera(dt) {
  const lz = Math.log(S.cam.zoom);
  const lt = Math.log(S.targetZoom);
  S.cam.zoom = Math.exp(lz + (lt - lz) * (1 - Math.exp(-9 * dt)));
  formationCenter(_fc);
  const k = 1 - Math.exp(-8 * dt);
  S.cam.x += (_fc.x - S.cam.x) * k;
  S.cam.y += (_fc.y - S.cam.y) * k;
}

function syncHulls(time) {
  const ship = S.ship;
  const occ = S.sunOcc;
  if (atlas) {
    atlas.setPose(ship.x, ship.y, ship.angle, ship.vx, ship.vy, ship.angVel);
    atlas.thrust = ship.thrust * S.thrustGain;
    atlas.syncMesh(S.origin.x, S.origin.y, occ ? sunTransmittance(ship.x, ship.y) : 1);
  }
  if (escort) {
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    const ex = ship.x + c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side;
    const ey = ship.y + s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side;
    escort.setPose(ex, ey, ship.angle, ship.vx, ship.vy, ship.angVel);
    escort.thrust = atlas ? atlas.thrust : 0;
    escort.mesh.visible = S.showEscort;
    escort.syncMesh(S.origin.x, S.origin.y, occ ? sunTransmittance(ex, ey) : 1);
  }
  void time;
}

// ---------------------------------------------------------------------------
// Światła

// Dopięcia kolejnych etapów (światła dynamiczne, pył).
const frameHooks = { lights: [], glows: [], preRender: [] };

function buildLights(camZ) {
  grid.begin();
  const ox = S.origin.x;
  const oy = S.origin.y;
  if (S.shipLights) {
    if (atlas) addShipLights(grid, atlas.entity, atlas.length, ox, oy, { time: S.time });
    if (escort && S.showEscort) addShipLights(grid, escort.entity, escort.length, ox, oy, { time: S.time });
  }
  for (const fn of frameHooks.lights) fn(grid, ox, oy, camZ);
  // Siatka: kadr gry z zapasem (skały tła przy brzegu kadru i tak leżą w mroku).
  const hw = W * 0.5 / S.cam.zoom * 1.4 + 800;
  const hh = H * 0.5 / S.cam.zoom * 1.4 + 800;
  const cx = S.cam.x - ox;
  const cy = -(S.cam.y - oy);
  grid.build(cx - hw, cy - hh, cx + hw, cy + hh);
}

// ---------------------------------------------------------------------------
// Klatka

let lastT = 0;
const layerFrame = { cam: null, viewW: 0, viewH: 0, focalPx: 1, time: 0, budgetMs: 3 };

function frame(nowMs, forcedDt = null) {
  const t0 = performance.now();
  const realDt = forcedDt ?? Math.min(0.1, Math.max(0, (nowMs - (lastT || nowMs)) / 1000));
  lastT = nowMs;
  S.frame++;
  if (realDt > 0) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  S.time += realDt;
  stepShip(realDt);
  stepCamera(realDt);
  rebaseIfNeeded();
  const camZ = updateCameras();
  updateSun();
  shared.time.value = S.time;
  syncHulls(S.time);

  // Skały: komórki z budżetem, LOD per skała.
  layerFrame.cam = S.cam;
  layerFrame.viewW = W;
  layerFrame.viewH = H;
  layerFrame.focalPx = focalPx();
  layerFrame.time = S.time;
  layerFrame.budgetMs = 3 / Math.max(1, layers.length);
  for (const layer of layers) layer.update(layerFrame);
  field.endFrame(7000);

  buildLights(camZ);

  glow.begin();
  const ox = S.origin.x;
  const oy = S.origin.y;
  if (atlas) atlas.addGlows(glow, ox, oy, S.time);
  if (escort && S.showEscort) escort.addGlows(glow, ox, oy, S.time);
  for (const fn of frameHooks.glows) fn(glow, ox, oy);
  glow.commit();

  updateSky();
  for (const fn of frameHooks.preRender) fn(realDt, camZ);

  pipeline.render();
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  if (S.frame % 3 === 0) resolveGpuTimes();
  if (S.frame % 6 === 0) updateHud();
}

function updateSky() {
  const m = field.sampleMacro(S.cam.x, S.cam.y);
  const Tcam = S.sunOcc ? sunTransmittance(S.cam.x, S.cam.y) : 1;
  const target = m.weight * smooth01(0.06, 0.42, m.cluster);
  sky.u.veil.value = Math.min(1, target * (0.85 + 0.15 * (1 - Tcam)));
  sky.u.sunLevel.value = Tcam;
  const dx = SUN.x - S.cam.x;
  const dy = -(SUN.y - S.cam.y);
  const l = Math.hypot(dx, dy) || 1;
  sky.u.sunDir.value.set(dx / l, dy / l);
  // Gwiazdy prawie w nieskończoności: przesunięcie ~0,2% ruchu kamery.
  sky.u.offset.value.set(((S.cam.x * 0.002) % 7000 + 7000) % 7000, ((S.cam.y * 0.002) % 7000 + 7000) % 7000);
}

function smooth01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

let gpuPending = false;
function resolveGpuTimes() {
  if (gpuPending || !renderer) return;
  gpuPending = true;
  Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')])
    .then(([r, c]) => {
      if (Number.isFinite(r)) S.gpuRenderMs = S.gpuRenderMs * 0.8 + r * 0.2;
      if (Number.isFinite(c)) S.gpuComputeMs = S.gpuComputeMs * 0.8 + c * 0.2;
    })
    .catch(() => {})
    .finally(() => { gpuPending = false; });
}

// ---------------------------------------------------------------------------
// HUD i statystyki

function fmt(n) { return Math.round(n).toLocaleString('pl-PL'); }
function f2(v) { return v.toFixed(2).replace('.', ','); }

// Liczniki dopinane przez kolejne moduły (pył, światła dynamiczne).
const statSources = [];

function collectStats() {
  const info = renderer.info;
  const rocks = layers.reduce((a, l) => a + (l.enabled ? l.stats.drawn : 0), 0);
  const out = {
    fps: +S.fps.toFixed(1),
    cpuMs: +S.cpuMs.toFixed(2),
    gpuMs: +(S.gpuRenderMs + S.gpuComputeMs).toFixed(2),
    gpuRenderMs: +S.gpuRenderMs.toFixed(2),
    gpuComputeMs: +S.gpuComputeMs.toFixed(2),
    drawCalls: info.render.drawCalls,
    triangles: info.render.triangles,
    computeCalls: info.compute.frameCalls,
    lights: grid.stats.lights,
    lightItems: grid.stats.items,
    lightsMaxPerCell: grid.stats.maxPerCell,
    rocks,
    particles: 0
  };
  for (const fn of statSources) Object.assign(out, fn());
  return out;
}

function updateHud() {
  if (S.hideUi) return;
  const st = collectStats();
  $('stats').innerHTML = [
    `<b>${st.fps.toFixed(0)} FPS</b> · CPU ${f2(st.cpuMs)} ms · GPU ${f2(st.gpuMs)} ms`,
    `GPU: render ${f2(st.gpuRenderMs)} ms · compute ${f2(st.gpuComputeMs)} ms`,
    `drobiny ${fmt(st.particles)} · światła ${fmt(st.lights)} (max ${fmt(st.lightsMaxPerCell)} w komórce)`,
    `draw calle ${fmt(st.drawCalls)} · compute ${fmt(st.computeCalls)} · trójkąty ${fmt(st.triangles / 1000)} tys.`,
    `skały w kadrze ${fmt(st.rocks)}`
  ].join('\n');
  const m = field.sampleMacro(S.cam.x, S.cam.y);
  const dx = S.cam.x - SUN.x;
  const dy = S.cam.y - SUN.y;
  const Tship = sunTransmittance(S.ship.x, S.ship.y);
  const lines = [];
  lines.push(`<b>ASTEROIDY WebGPU</b> · scena 5 · zoom ${S.cam.zoom.toFixed(3).replace('.', ',')}`);
  lines.push(`${(Math.hypot(dx, dy) / AU).toFixed(2).replace('.', ',')} AU od Słońca · pole ${m.cluster.toFixed(2).replace('.', ',')} · słońce przy statku ${(Tship * 100).toFixed(0)}%${S.sunOcc ? '' : ' (wyłączone przesłanianie)'}`);
  lines.push(`w kadrze: gra ${fmt(playLayer?.stats.drawn || 0)} · tło ${fmt(layers.slice(1).reduce((a, l) => a + l.stats.drawn, 0))} · komórki w kolejce ${layers.reduce((a, l) => a + l.stats.pending, 0)}`);
  lines.push(`bank kształtów ${bank ? bank.bakeMs.toFixed(0) : '…'} ms · początek sceny ${fmt(S.origin.x)}, ${fmt(S.origin.y)}`);
  lines.push(`Atlas: ${fmt(Math.hypot(S.ship.vx, S.ship.vy))} j/s · ciąg ${(S.ship.thrust * 100).toFixed(0)}% · W/S/A/D/Q/E, Shift`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
  if (k === 'z') S.targetZoom = 1;
  if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
  const click = (id) => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
  if (k === 'l') click('t-shiplights');
  if (k === 'o') click('t-sunocc');
  if (k === 'b') click('t-bloom');
  if (k === 'm') click('t-dust');
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => S.keys.clear());

/** Punkt ekranu → świat gry (płaszczyzna gry, kamera ortho). */
export function screenToWorld(px, py, out = { x: 0, y: 0 }) {
  out.x = S.cam.x + (px - W * 0.5) / S.cam.zoom;
  out.y = S.cam.y + (py - H * 0.5) / S.cam.zoom;
  return out;
}

function bindCanvasInput(canvas) {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.targetZoom * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    S.mouse.x = e.clientX;
    S.mouse.y = e.clientY;
    S.mouse.inside = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    const p = screenToWorld(e.clientX, e.clientY);
    for (const fn of pointerHooks) fn(e.button, p);
  });
}
const pointerHooks = [];

// ---------------------------------------------------------------------------
// Panel

function bindRange(id, outId, fmtFn, apply) {
  const el = $(id);
  const out = $(outId);
  const run = () => { const v = Number(el.value); out.textContent = fmtFn(v); apply(v); };
  el.addEventListener('input', run);
  run();
}

function bindControls() {
  const toggle = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  toggle('t-shiplights', (v) => { S.shipLights = v; });
  toggle('t-dynlights', (v) => { S.dynLights = v; });
  toggle('t-sunocc', (v) => { S.sunOcc = v; });
  toggle('t-bloom', (v) => { if (bloomNode) bloomNode.strength.value = v ? BLOOM_DEFAULTS.strength : 0; });
  toggle('t-escort', (v) => { S.showEscort = v; });
  toggle('t-back', (v) => { S.backRocks = v; for (const l of layers.slice(1)) l.setVisible(v); });
  toggle('t-rocklights', (v) => { S.rockLights = v; });
  bindRange('s-thrust', 'o-thrust', f2, (v) => { S.thrustGain = v; });
  bindRange('s-blast', 'o-blast', f2, (v) => { S.blastGain = v; });
  bindRange('s-damp', 'o-damp', f2, (v) => { S.dampGain = v; });
  bindRange('s-dustb', 'o-dustb', f2, (v) => { S.dustBright = v; });
  bindRange('s-lights', 'o-lights', (v) => fmt(v), (v) => { S.lightTarget = Math.min(LIGHT_CAP - 64, v); });
  $('b-zoom1').addEventListener('click', () => { S.targetZoom = 1; });
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  const loading = $('loading');
  await initRenderer();
  bindCanvasInput(renderer.domElement);
  loading.textContent = 'Pieczenie kształtów skał (TSL, GPU)…';
  await new Promise((r) => setTimeout(r, 20));
  bank = await new RockShapeBankGPU().bake(renderer);
  const noise = createRockNoiseVolume(renderer, 64);
  shared = createRockShared(bank, noise);
  const playMaterial = new RockNodeMaterial({ shared, backdrop: false });
  // Czubek skały gry pod płaszczyzną: kadłuby (z = 0) zawsze nad skałą.
  const playZ = (rock) => -rock.r * 1.45 * Math.max(rock.sx, rock.sy, rock.sz);
  playLayer = new RockLayer({
    scene: fgScene, bank, material: playMaterial, field, bandIndex: BELT_BAND.PLAY,
    perspective: false, renderOrder: 1, zOf: playZ, minPx: 0.7, maxLod: 5, sunT: sunTransmittance
  });
  layers.push(playLayer);
  const FADE = { [BELT_BAND.RUBBLE]: [0.22, 0.09], [BELT_BAND.MID]: [0.07, 0.03], [BELT_BAND.DEEP]: null };
  for (const band of [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP]) {
    layers.push(new RockLayer({
      scene: bgScene, bank, material: new RockNodeMaterial({ shared, backdrop: true }), field, bandIndex: band,
      perspective: true, renderOrder: 2, minPx: 0.8, fadeZoom: FADE[band], maxLod: 3, sunT: sunTransmittance
    }));
  }
  for (const layer of layers) layer.setOrigin(S.origin.x, S.origin.y);
  sky = new Sky(bgScene);
  glow = new GlowSprites({ scene: fgScene, capacity: 4096 });
  loading.textContent = 'Kadłuby…';
  try {
    atlas = await DemoHull.load({ id: 'atlas', url: atlasUrl, editor: ATLAS_EDITOR_DEFAULTS, scene: fgScene, shared });
  } catch (err) { reportError(`Atlas: ${err.stack || err}`); }
  try {
    escort = await DemoHull.load({ id: 'terran_carrier', url: carrierUrl, editor: SHIP_EDITOR_DEFAULTS.ships?.terran_carrier || null, scene: fgScene, shared });
  } catch (err) { reportError(`Eskorta: ${err.stack || err}`); }
  buildPipeline();
  bindControls();
  // Kamera od razu na szyku, komórki pola wczytane przed pierwszą klatką.
  formationCenter(S.cam);
  updateCameras();
  loading.textContent = 'Wczytywanie skał pola…';
  await new Promise((r) => setTimeout(r, 20));
  layerFrame.cam = S.cam; layerFrame.viewW = W; layerFrame.viewH = H; layerFrame.focalPx = focalPx(); layerFrame.time = 0;
  layerFrame.budgetMs = 4000;
  for (const layer of layers) layer.update(layerFrame);
  loading.textContent = 'Kompilacja shaderów…';
  await new Promise((r) => setTimeout(r, 20));
  loading.style.display = 'none';
  S.ready = true;
  window.__demo = {
    S, field, layers, grid, renderer, bank,
    setZoom: (z) => { S.cam.zoom = S.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z) || 1)); },
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(performance.now(), dt); },
    stats: () => collectStats()
  };
  renderer.setAnimationLoop((t) => {
    try { frame(t); } catch (err) { reportError(err.stack || String(err)); renderer.setAnimationLoop(null); }
  });
}

start().catch((err) => {
  $('loading').textContent = `Błąd: ${err.message || err}`;
  reportError(err.stack || String(err));
});

export { S, frameHooks, statSources, pointerHooks, grid };
export function setOriginShiftHandler(fn) { onOriginShift = fn; }
