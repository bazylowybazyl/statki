// dema/asteroidy-webgpu.js — demo WebGPU nowego pola asteroid.
//
// Port dema WebGL (dema/asteroidy.html) na WebGPURenderer + TSL, z tymi samymi
// scenami: galerie typów i kształtów, olbrzymy (tunele, szczeliny, jaskinie),
// olbrzym w polu, gęste pole, przelot od słońca w głąb pola, głąb pola, rzadki
// pas, pas Kuipera i burza energetyczna. Ponad port:
//   • ŚWIATŁO WOLUMETRYCZNE (volumetrics.js): smugi reflektorów dalekich
//     i bocznych w pyle pola, z cieniami skał w smudze (atlas map cienia
//     spotShadows.js — mapa na każdą lampę), poświata wybuchów, piorunów,
//     świecących skał i lamp w ośrodku;
//   • setki świateł dynamicznych w jednej siatce (lights.js) — skały, kadłuby,
//     minerały, olbrzymy i ośrodek widzą te same światła;
//   • NOWE PIORUNY (storm.js): rozgałęziony kanał z liderem krokowym, udarami
//     i poświatą, łańcuch świateł wzdłuż kanału, iskry na GPU (sparks.js);
//   • noc w rdzeniu pola (sky.js): zasłona z łuną przesianą przez pole,
//     prześwity gwiazd, błyski burzy w chmurach.
//
// Passy jak w Core3D gry: gra (ortho: skały gry, kadłuby, olbrzymy, minerały,
// płytka mgła, ośrodek, pioruny, duszki) + tło (persp.: skały tła, głęboka
// mgła, niebo); składanie gra + tło · (1 − alfa), bloom, ACES gry.
//
// Precyzja: świat leży przy milionach j. Wszystko, co trafia na GPU, jest
// względem lokalnego początku sceny przy kamerze liczonego na CPU w double;
// po odjeździe kamery o > 20 tys. j. początek przeskakuje, dane się przesuwają.
//
// Konsola: window.__demo (setScene, setZoom, step, explode, strike, stats…).

import * as THREE from 'three/webgpu';
import { pass, float, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { ROCK_TYPE_INDEX, ROCK_TYPE_LABELS_PL, ROCK_FAMILIES, SHAPE_VARIANTS } from '../src/game/asteroidRockKinds.js';
import { GiantBuilder } from '../src/game/asteroidGiantBuilder.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import carrierUrl from '../src/assets/ships/terrancarrier.png';
import {
  SUN, AU, field, BELT_BAND, sunTransmittance, SPOTS, FLIGHT, GIANTS, FIELD_GIANTS, ALL_GIANTS,
  precomputeOcclusion, findDeepSpot, findSparseSpot, findStormSpot
} from './asteroidy-webgpu/world.js';
import { RockShapeBankGPU } from './asteroidy-webgpu/rockBank.js';
import { createRockNoiseVolume } from './asteroidy-webgpu/rockNoise.js';
import { createRockShared, RockNodeMaterial, ROCK_LIGHT_DEFAULTS } from './asteroidy-webgpu/rockMaterial.js';
import { ShadowAtlas } from './asteroidy-webgpu/spotShadows.js';
import { RockLayer, RockSet } from './asteroidy-webgpu/rockLayers.js';
import { MineralTemplates, MineralLayer, MineralMaterial, MINERAL_TYPES } from './asteroidy-webgpu/minerals.js';
import { LightGrid, GridLighting, addShipLights, LIGHT_CAP, CAVE_SHIP_LIGHTS } from './asteroidy-webgpu/lights.js';
import { DemoHull } from './asteroidy-webgpu/ship.js';
import { GlowSprites } from './asteroidy-webgpu/glowSprites.js';
import { Sky } from './asteroidy-webgpu/sky.js';
import { Dynamics } from './asteroidy-webgpu/dynamics.js';
import { BeltFog } from './asteroidy-webgpu/fog.js';
import { FieldMap } from './asteroidy-webgpu/sunMap.js';
import { VolumeLight } from './asteroidy-webgpu/volumetrics.js';
import { Sparks } from './asteroidy-webgpu/sparks.js';
import { StormSystem } from './asteroidy-webgpu/storm.js';
import { GiantView } from './asteroidy-webgpu/giants.js';
import { acesGame } from './asteroidy-webgpu/tslCommon.js';
import { MinedRocks } from './asteroidy-webgpu/minedRocks.js';
import { MiningRig, CHARGES } from './asteroidy-webgpu/miningRig.js';
import { AsteroidMining } from '../src/game/asteroidMining.js';

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

// Zakres zoomu jak w grze (0,035–3,2); przy olbrzymach do 0,012 (Wrzeciono ma 62 tys. j.).
const ZOOM_MIN = 0.035;
const ZOOM_MIN_GIANTS = 0.012;
const ZOOM_MAX = 3.2;
const FOV_DEG = 35;
const REBASE_DIST = 20000;
// Szyk eskorty: przy lewej burcie Atlasa, lekko z tyłu (jak w demie WebGL).
const ESCORT_OFFSET = Object.freeze({ along: -300, side: -1250 });

const SCENES = ['gallery', 'shapes', 'giants', 'giantField', 'field', 'flight', 'deep', 'sparse', 'kuiper', 'storm', 'mining'];
const SCENE_LABELS = {
  gallery: '1 · Galeria typów', shapes: '2 · Galeria kształtów', giants: '3 · Olbrzymy', giantField: '4 · Olbrzym w polu',
  field: '5 · Gęste pole', flight: '6 · Przelot', deep: '7 · Głąb pola', sparse: '8 · Rzadki pas', kuiper: '9 · Pas Kuipera', storm: '0 · Burza',
  mining: 'G · Kopalnia'
};
const GALLERY_SCENES = new Set(['gallery', 'shapes']);
// Eskorta nie leci pod stropy olbrzymów (tunele są na jeden okręt).
const ESCORT_OFF_SCENES = new Set(['gallery', 'shapes', 'giants', 'giantField']);
// Flary (dopełnienie liczby świateł) tylko w polu — w galeriach i przy olbrzymach nic nie wnoszą.
const FLARE_SCENES = new Set(['field', 'flight', 'deep', 'sparse', 'kuiper', 'storm', 'mining']);
const GALLERY_TYPES = ['rock', 'iron', 'silicon', 'copper', 'titan', 'ice', 'crystal', 'uran', 'energy'];
const TYPE_SHOWCASE_FAMILY = { rock: 'cratered', iron: 'oval', silicon: 'rubble', copper: 'angular', titan: 'shard', ice: 'binary', crystal: 'angular', uran: 'potato', energy: 'ridged' };

// ---------------------------------------------------------------------------
// Stan

const S = {
  scene: 'field',
  cam: { x: SPOTS.field.x, y: SPOTS.field.y, zoom: 1 },
  targetZoom: 1,
  camGoal: null,
  camHold: null,
  ship: { x: SPOTS.field.x, y: SPOTS.field.y, vx: 0, vy: 0, angle: -0.4, angVel: 0, thrust: 0 },
  origin: { x: Math.round(SPOTS.field.x), y: Math.round(SPOTS.field.y) },
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
  floods: true,
  navGlow: true,
  dynLights: true,
  sunOcc: true,
  backRocks: true,
  rockLights: true,
  fogOn: true,
  volumeOn: true,
  spotShadows: true,
  stormOn: true,
  lightTarget: 64,
  focus: -1,
  autopilot: null,
  dragging: null,
  mouse: { x: 0, y: 0, valid: false },
  miningDown: false,
  sawStart: null,
  hideUi: false,
  underRoof: false,
  // Kopalnia: typ skały testowej do postawienia w następnej klatce (po wczytaniu komórek pola).
  pendingTestRock: null,
  testType: 'copper',
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
const dynamics = new Dynamics();
const fieldMap = new FieldMap();
let shared = null;
let bank = null;
const layers = [];
let playLayer = null;
let playMaterial = null;
let atlas = null;
let escort = null;
let glow = null;
let sky = null;
let fog = null;
let shadows = null;
let volume = null;
let sparks = null;
let storm = null;
let mining = null;
let minedRocks = null;
let rig = null;
let typeSet = null;
let shapeSet = null;
let mineralTemplates = null;
let giantBuilder = null;
const typeRocks = [];
const shapeRocks = [];
const galleryCells = [];
const shapeCells = [];
// Stan olbrzymów: obiekt GiantRock (siatka), widok (GiantView), postęp budowy.
const giantState = new Map(ALL_GIANTS.map((g) => [g, { giant: null, view: null, progress: 0, error: null }]));

const overlay = document.createElement('canvas');
overlay.id = 'labels';
const ctx2d = overlay.getContext('2d');

function focalPx() {
  return (H * 0.5) / Math.tan((FOV_DEG * Math.PI / 180) * 0.5);
}

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome/Edge z WebGPU i kontekst bezpieczny (localhost).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU (requestAdapter zwrócił null).');
  // Więcej zmiennych między etapami i buforów storage, jeśli adapter pozwala.
  const requiredLimits = {};
  const want = { maxInterStageShaderVariables: 28, maxStorageBuffersPerShaderStage: 10, maxStorageTexturesPerShaderStage: 8 };
  for (const [k, v] of Object.entries(want)) {
    if (adapter.limits[k] >= v) requiredLimits[k] = v;
  }
  renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, trackTimestamp: true, requiredLimits });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.lighting = new GridLighting(grid);
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  $('root').appendChild(overlay);
  await renderer.init();
  renderer.highPrecision = true;
  // Liczniki (draw calle, trójkąty, compute) za całą klatkę — wszystkie passy,
  // kafle map cienia i bloom; zerowane ręcznie na początku klatki.
  renderer.info.autoReset = false;
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
  overlay.width = W;
  overlay.height = H;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Początek sceny, kamery, słońce

function rebaseIfNeeded() {
  const dx = S.cam.x - S.origin.x;
  const dy = S.cam.y - S.origin.y;
  if (Math.abs(dx) < REBASE_DIST && Math.abs(dy) < REBASE_DIST) return;
  const nx = Math.round(S.cam.x);
  const ny = Math.round(S.cam.y);
  // Scena: X = x − O.x, Y = −(y − O.y) — żywe iskry przesuwa compute.
  sparks?.shift(-(nx - S.origin.x), ny - S.origin.y);
  S.origin.x = nx;
  S.origin.y = ny;
  for (const layer of layers) layer.setOrigin(nx, ny);
  typeSet?.setOrigin(nx, ny);
  shapeSet?.setOrigin(nx, ny);
  fieldMap.invalidate();
}

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

function one() { return 1; }

// Głęboka noc (prośba użytkownika 2026-09-27: „jeszcze ciemniej”): słońce
// przesiane przez pole gaśnie w rdzeniu szybciej niż sama transmitancja —
// poniżej T = NIGHT_KNEE jasność ∝ T · smoothstep(0, NIGHT_KNEE, T), wyżej bez
// zmian. W głębi pola (T ≈ 0,03) słońce słabnie ~7×, gęste pole (T ≈ 0,18)
// zostaje jak było. Tę wartość dostają materiały, mgła i niebo; miejsca scen
// i HUD liczą z samej transmitancji.
const NIGHT_KNEE = 0.12;
function nightKnee(t) {
  if (!(t < NIGHT_KNEE)) return t;
  const u = Math.max(0, t) / NIGHT_KNEE;
  return t * u * u * (3 - 2 * u);
}
function sunLight(x, y) { return nightKnee(sunTransmittance(x, y)); }
function sunT(x, y) { return S.sunOcc ? sunLight(x, y) : 1; }

// ---------------------------------------------------------------------------
// Galerie (kopia buildTypeGallery / buildShapeGallery z dema WebGL)

function showcaseOrientation(shape, angle, mode = 'long') {
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
  const tilt = o.tilt ?? 0.35;
  return {
    x: o.x, y: o.y, z: 0, r: o.d * 0.5, d: o.d,
    shape: o.shape, type: o.type,
    ...orient,
    ax: Math.sin(tilt) * 0.6, ay: Math.sin(tilt) * 0.8, az: Math.cos(tilt), spin: o.spin ?? 0.12,
    phase: o.phase ?? 0,
    sx: o.sx ?? 1, sy: o.sy ?? 0.95, sz: o.sz ?? 0.9,
    seed: o.seed ?? 0.37,
    label: o.label || null
  };
}

function buildTypeGallery() {
  typeRocks.length = 0;
  galleryCells.length = 0;
  const g = SPOTS.gallery;
  const COLS = 5;
  const cellW = 2100;
  const cellH = 2200;
  GALLERY_TYPES.forEach((typeId, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const inRow = Math.min(COLS, GALLERY_TYPES.length - row * COLS);
    const cx = g.x + (col - (inRow - 1) / 2) * cellW;
    const cy = g.y + (row - 0.5) * cellH;
    const type = ROCK_TYPE_INDEX[typeId];
    const fam = Math.max(0, ROCK_FAMILIES.findIndex((f) => f.id === TYPE_SHOWCASE_FAMILY[typeId]));
    const sizes = [
      { d: 1150, dx: -260, dy: 60, v: 0 },
      { d: 430, dx: 620, dy: -420, v: 1 },
      { d: 200, dx: 640, dy: 330, v: 2 },
      { d: 110, dx: 380, dy: 640, v: 3 }
    ];
    sizes.forEach((s, k) => {
      const famId = ROCK_FAMILIES[fam].id;
      typeRocks.push(galleryRock({
        x: cx + s.dx, y: cy + s.dy, d: s.d,
        shape: fam * SHAPE_VARIANTS + ((s.v + i) % SHAPE_VARIANTS),
        mode: famId === 'bowl' ? 'crater' : (famId === 'disc' ? 'disc' : 'long'),
        type, angle: 0.4 + k * 0.9 + i * 0.3, spin: 0.08 + k * 0.05, phase: i * 1.7 + k,
        seed: ((i * 7 + k * 3 + 1) * 0.0731) % 1,
        label: k === 0 ? ROCK_TYPE_LABELS_PL[typeId] : null
      }));
    });
    galleryCells.push({ x: cx - 100, y: cy + 60, zoom: 0.62, label: ROCK_TYPE_LABELS_PL[typeId] });
  });
  typeSet.set(typeRocks);
}

function buildShapeGallery() {
  shapeRocks.length = 0;
  shapeCells.length = 0;
  const g = SPOTS.shapes;
  const COLS = 5;
  const cellW = 2000;
  const cellH = 1900;
  ROCK_FAMILIES.forEach((fam, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = g.x + (col - (COLS - 1) / 2) * cellW;
    const cy = g.y + (row - 0.5) * cellH;
    const mode = fam.id === 'bowl' ? 'crater' : (fam.id === 'disc' ? 'disc' : 'long');
    shapeRocks.push(galleryRock({
      x: cx - 250, y: cy, d: 1100, shape: i * SHAPE_VARIANTS, type: ROCK_TYPE_INDEX.rock, mode,
      angle: 0.35, spin: 0.16, phase: i, seed: (i * 0.137) % 1, label: fam.label
    }));
    for (let v = 1; v < SHAPE_VARIANTS; v++) {
      shapeRocks.push(galleryRock({
        x: cx + 620, y: cy + (v - 2) * 520, d: 420, shape: i * SHAPE_VARIANTS + v, type: ROCK_TYPE_INDEX.rock, mode,
        angle: 0.2 + v, spin: 0.2, phase: i + v, seed: ((i * 5 + v) * 0.173) % 1
      }));
    }
    shapeCells.push({ x: cx + 100, y: cy, zoom: 0.62, label: fam.label });
  });
  shapeSet.set(shapeRocks);
}

function galleryOverviewZoom(name) {
  return name === 'shapes' ? Math.min(W / 10400, H / 4300) : Math.min(W / 10900, H / 4700);
}

function focusGallery(i) {
  const cells = S.scene === 'shapes' ? shapeCells : galleryCells;
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

// ---------------------------------------------------------------------------
// Olbrzymy

function giantVisibleIn(g, scene) {
  if (g.where === 'gallery') return scene === 'giants';
  return !GALLERY_SCENES.has(scene) && scene !== 'giants';
}

function startGiants() {
  giantBuilder = new GiantBuilder();
  // Najpierw olbrzym pola (scena „Olbrzym w polu”), potem galeria.
  for (const g of [...FIELD_GIANTS, ...GIANTS]) {
    const st = giantState.get(g);
    const { giant, promise } = giantBuilder.build(g.id, g.seed, g.x, g.y, { onProgress: (p) => { st.progress = p; } });
    st.giant = giant;
    promise.then(() => {
      st.view = new GiantView({ renderer, scene: fgScene, giant, noise: shared.noise, shared, grid, sun: SUN, sunElevDeg: ROCK_LIGHT_DEFAULTS.sunElevDeg });
      st.view.setVisible(giantVisibleIn(g, S.scene));
      st.progress = 1;
    }).catch((err) => {
      st.error = err;
      reportError(`Olbrzym ${g.id}: ${err.stack || err}`);
    });
  }
}

function giantRoute(g) {
  const r = giantState.get(g).giant?.plan.routes[0];
  return r ? r.pts.map(([x, y]) => ({ x: g.x + x, y: g.y + y })) : [];
}

function giantFitZoom(g) {
  const [hx, hy] = g.preset.half;
  return Math.max(ZOOM_MIN_GIANTS, Math.min(ZOOM_MAX, Math.min(W / (hx * 2.35), H / (hy * 2.35))));
}

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

// Kolizja Atlasa z przekrojem z = 0 olbrzymów: koła wzdłuż osi kadłuba.
const _hit = { depth: 0, nx: 0, ny: 0 };
function collideShipWithGiants() {
  const ship = S.ship;
  const L = atlas?.length || 1800;
  const R = (atlas?.h || 800) * 0.46;
  const fx = Math.cos(ship.angle);
  const fy = Math.sin(ship.angle);
  for (const g of ALL_GIANTS) {
    if (!giantVisibleIn(g, S.scene)) continue;
    const giant = giantState.get(g).giant;
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

// ---------------------------------------------------------------------------
// Sceny

function setScene(name) {
  if (!SCENES.includes(name)) return;
  S.scene = name;
  S.focus = -1;
  S.camGoal = null;
  S.camHold = null;
  S.autopilot = null;
  for (const b of document.querySelectorAll('[data-scene]')) b.classList.toggle('on', b.dataset.scene === name);
  const spot = SPOTS[name] || SPOTS.field;
  const ship = S.ship;
  ship.vx = 0; ship.vy = 0; ship.angVel = 0; ship.thrust = 0;
  if (GALLERY_SCENES.has(name)) {
    S.cam.x = spot.x; S.cam.y = spot.y;
    S.cam.zoom = S.targetZoom = galleryOverviewZoom(name);
  } else if (name === 'giantField') {
    parkShipAtGiant(FIELD_GIANTS[0]);
    S.cam.x = ship.x; S.cam.y = ship.y;
    S.cam.zoom = S.targetZoom = 0.3;
  } else if (name === 'giants') {
    const g = GIANTS.find((x) => x.id === 'hollow') || GIANTS[0];
    S.focus = GIANTS.indexOf(g);
    parkShipAtGiant(g);
    S.cam.x = g.x; S.cam.y = g.y;
    S.cam.zoom = S.targetZoom = giantFitZoom(g);
    S.camGoal = { x: g.x, y: g.y };
  } else if (name === 'flight') {
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
  typeSet?.setVisible(name === 'gallery');
  shapeSet?.setVisible(name === 'shapes');
  for (const g of ALL_GIANTS) giantState.get(g).view?.setVisible(giantVisibleIn(g, name));
  // Kopalnia: skały w wydobyciu zostają przy swojej scenie — nowa scena zaczyna od czystego pola.
  resetMining();
  if (name === 'mining') {
    S.cam.zoom = S.targetZoom = 0.34;
    S.pendingTestRock = S.testType;
  }
  rig?.setEnabled(name === 'mining' || (rig.enabled && !GALLERY_SCENES.has(name) && name !== 'giants'));
  updateMiningButtons();
  updateFocusButtons();
  updateSceneInfo();
}

/** Skały w wydobyciu znikają, skały pola wracają. */
function resetMining() {
  if (!mining) return;
  mining.bodies.length = 0;
  mining.pebbles.length = 0;
  mining.balls.length = 0;
  mining.drainEvents();
  if (playLayer && playLayer.hidden.size) {
    playLayer.hidden.clear();
    playLayer._version++;
  }
  if (rig) { rig.charges.length = 0; rig.gallery.length = 0; }
}

/** Galeria rdzeni (J): kawałki rdzeni wszystkich rud i odłamki skorupy przed statkiem, zbliżenie. */
function showCoreGallery() {
  if (!rig) return;
  if (S.scene !== 'mining') setScene('mining');
  else resetMining();
  S.pendingTestRock = null;
  const c = rig.spawnCoreGallery({ x: S.ship.x, y: S.ship.y, angle: S.ship.angle });
  S.camHold = { x: c.x, y: c.y };
  S.cam.zoom = S.targetZoom = 0.62;
  rig.setEnabled(true);
  updateMiningButtons();
}

function updateMiningButtons() {
  if (!rig) return;
  const on = (id, v) => { const el = $(id); if (el) el.classList.toggle('on', !!v); };
  on('b-mine-mode', rig.enabled);
  on('b-tractor', rig.tractor);
  on('b-scan', rig.scan);
  on('b-trap', rig.trap);
  for (const b of document.querySelectorAll('[data-charge]')) b.classList.toggle('on', Number(b.dataset.charge) === rig.chargeIndex);
  for (const b of document.querySelectorAll('[data-mine-type]')) b.classList.toggle('on', b.dataset.mineType === S.testType);
}

function updateSceneInfo() {
  const el = $('sceneinfo');
  if (el) el.textContent = SCENE_LABELS[S.scene] || S.scene;
}

function updateFocusButtons() {
  const box = $('focus');
  if (!box) return;
  if (S.scene === 'giants') {
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
  const cells = S.scene === 'shapes' ? shapeCells : (S.scene === 'gallery' ? galleryCells : []);
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
// Ruch statku i kamery (jak w dema/asteroidy.js)

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
  ship.thrust += (0.8 - ship.thrust) * (1 - Math.exp(-4 * dt));
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
    ship.thrust += (1 - ship.thrust) * (1 - Math.exp(-4 * dt));
  } else if (S.autopilot) {
    stepAutopilot(dt);
  } else {
    const k = S.keys;
    const boost = k.has('shift') ? 3 : 1;
    const accel = 900 * boost;
    const fwd = k.has('w');
    if (fwd) { ship.vx += Math.cos(ship.angle) * accel * dt; ship.vy += Math.sin(ship.angle) * accel * dt; }
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
    const want = fwd ? (boost > 1 ? 1.6 : 1) : 0;
    ship.thrust += (want - ship.thrust) * (1 - Math.exp(-(want > ship.thrust ? 6 : 3) * dt));
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  collideShipWithGiants();
}

const _fc = { x: 0, y: 0 };
function formationCenter(out) {
  let tx = S.ship.x;
  let ty = S.ship.y;
  if (escortOn()) {
    const c = Math.cos(S.ship.angle);
    const s = Math.sin(S.ship.angle);
    tx += (c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side) * 0.5;
    ty += (s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side) * 0.5;
  }
  out.x = tx;
  out.y = ty;
  return out;
}

function escortOn() {
  return !!escort && S.showEscort && !ESCORT_OFF_SCENES.has(S.scene);
}

function shipsOn() {
  return !GALLERY_SCENES.has(S.scene);
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
    S.cam.x = S.camHold.x; S.cam.y = S.camHold.y;
  } else {
    formationCenter(_fc);
    const k = 1 - Math.exp(-8 * dt);
    S.cam.x += (_fc.x - S.cam.x) * k;
    S.cam.y += (_fc.y - S.cam.y) * k;
    if (S.scene === 'flight') { S.cam.x = _fc.x; S.cam.y = _fc.y; }
  }
}

function syncHulls() {
  const ship = S.ship;
  const on = shipsOn();
  if (atlas) {
    atlas.mesh.visible = on;
    atlas.setPose(ship.x, ship.y, ship.angle, ship.vx, ship.vy, ship.angVel);
    atlas.thrust = on ? ship.thrust : 0;
    atlas.syncMesh(S.origin.x, S.origin.y, sunT(ship.x, ship.y));
  }
  if (escort) {
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    const ex = ship.x + c * ESCORT_OFFSET.along - s * ESCORT_OFFSET.side;
    const ey = ship.y + s * ESCORT_OFFSET.along + c * ESCORT_OFFSET.side;
    const rx = ex - ship.x;
    const ry = ey - ship.y;
    escort.setPose(ex, ey, ship.angle, ship.vx - ship.angVel * ry, ship.vy + ship.angVel * rx, ship.angVel);
    escort.thrust = atlas ? atlas.thrust : 0;
    escort.mesh.visible = escortOn();
    escort.syncMesh(S.origin.x, S.origin.y, sunT(ex, ey));
  }
}

function activeHulls() {
  const list = [];
  if (atlas && shipsOn()) list.push(atlas);
  if (escortOn()) list.push(escort);
  return list;
}

// ---------------------------------------------------------------------------
// Światła

function lightBox() {
  const hw = W * 0.5 / S.cam.zoom * 1.4 + 800;
  const hh = H * 0.5 / S.cam.zoom * 1.4 + 800;
  return { hw, hh };
}

function buildLights() {
  grid.begin();
  const ox = S.origin.x;
  const oy = S.origin.y;
  if (shadows) {
    shadows.enabled = S.spotShadows;
    shadows.begin();
  }
  // Światła statków; reflektory dalekie i boczne z mapami cienia skał.
  // Pod stropem olbrzyma reflektory w dół do dna, szersze światło dookoła.
  const profile = S.underRoof ? CAVE_SHIP_LIGHTS : undefined;
  for (const hull of activeHulls()) {
    if (S.shipLights) addShipLights(grid, hull.entity, hull.length, ox, oy, { time: S.time, owner: hull.owner, shadows, floods: S.floods, nav: S.navGlow, profile });
  }
  if (shadows) {
    shadows.gather(playLayer);
    if (minedRocks) shadows.gatherCarved(minedRocks.shadowData, minedRocks.shadowCount);
  }
  if (storm) storm.addLights(grid, ox, oy);
  if (S.dynLights) {
    _dynCtx.hulls = activeHulls();
    _dynCtx.rockLights = S.rockLights;
    _dynCtx.sunOcc = S.sunOcc;
    dynamics.addLights(grid, ox, oy, S.time, _dynCtx);
  }
  if (rig) rig.addLights(grid, ox, oy);
  const { hw, hh } = lightBox();
  const cx = S.cam.x - ox;
  const cy = -(S.cam.y - oy);
  grid.build(cx - hw, cy - hh, cx + hw, cy + hh);
}

const _dynCtx = { rocks: null, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, hulls: [], rockLights: true, sunOcc: true, sunT: sunLight, flareTarget: 0 };
function updateDynamics(dt) {
  const { hw, hh } = lightBox();
  const b = _dynCtx.box;
  b.x0 = S.cam.x - hw; b.x1 = S.cam.x + hw;
  b.y0 = S.cam.y - hh; b.y1 = S.cam.y + hh;
  _dynCtx.rocks = playLayer;
  const others = grid.stats.lights - dynamics.stats.flares;
  const flares = S.dynLights && FLARE_SCENES.has(S.scene);
  _dynCtx.flareTarget = flares ? Math.max(0, Math.min(LIGHT_CAP - 160, S.lightTarget - Math.max(0, others))) : 0;
  dynamics.update(dt, S.time, _dynCtx);
}

// ---------------------------------------------------------------------------
// Klatka

let lastT = 0;
const layerFrame = { cam: null, viewW: 0, viewH: 0, focalPx: 1, time: 0, budgetMs: 3 };
const mapFrame = { cam: null, viewW: 0, viewH: 0, focalPx: 1, originX: 0, originY: 0, sunT: null, field };
const volFrame = { camX: 0, camY: 0, zoom: 1, viewW: 0, viewH: 0, time: 0, originX: 0, originY: 0 };
const fogFrame = { cam: null, viewW: 0, viewH: 0, focalPx: 1, time: 0, sunX: SUN.x, sunY: SUN.y, originX: 0, originY: 0, sunOcc: true };
const stormFrame = { cam: null, viewW: 0, viewH: 0, dt: 0, originX: 0, originY: 0 };
const giantFrame = { cam: null, viewW: 0, viewH: 0, dt: 0, originX: 0, originY: 0, sunT: 1 };
const _focus = { x: 0, y: 0, len: 1800 };
const _rigFrame = { time: 0, ship: { x: 0, y: 0, angle: 0, len: 1800 }, originX: 0, originY: 0 };
const _minedFrame = { zoom: 1, originX: 0, originY: 0, time: 0, camX: 0, camY: 0, sunT: null };
const _stormOpts = { layer: null, zOf: null };
const _flashes = [];
const _flashPool = [];

function frame(nowMs, forcedDt = null) {
  const t0 = performance.now();
  const realDt = forcedDt ?? Math.min(0.1, Math.max(0, (nowMs - (lastT || nowMs)) / 1000));
  lastT = nowMs;
  S.frame++;
  if (realDt > 0.002) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  S.time += realDt;
  // Klatka ręczna (__demo.step): numer klatki węzłów rośnie tylko w pętli rAF
  // renderera (setAnimationLoop(null) zdejmuje sam callback), a passy sceny
  // renderują się raz na ten numer — bez tego kilka kroków w jednym zadaniu
  // pokazałoby obraz pierwszego z nich (pole prywatne three r183: _nodes).
  if (forcedDt !== null) renderer._nodes?.nodeFrame?.update();
  renderer.info.reset();
  stepShip(realDt);
  stepCamera(realDt);
  rebaseIfNeeded();
  updateCameras();
  updateSun();
  shared.time.value = S.time;
  syncHulls();

  // Skały: komórki z budżetem, LOD per skała; galerie (zestawy skał podanych wprost).
  layerFrame.cam = S.cam;
  layerFrame.viewW = W;
  layerFrame.viewH = H;
  layerFrame.focalPx = focalPx();
  layerFrame.time = S.time;
  layerFrame.budgetMs = 3 / Math.max(1, layers.length);
  for (const layer of layers) layer.update(layerFrame);
  if (S.scene === 'gallery') typeSet.update(layerFrame);
  if (S.scene === 'shapes') shapeSet.update(layerFrame);
  field.endFrame(7000);

  // Olbrzymy: pozycja, przekrój pod stropem.
  const shipOn = shipsOn() && !!atlas;
  _focus.x = S.ship.x; _focus.y = S.ship.y; _focus.len = atlas ? atlas.length : 1800;
  giantFrame.cam = S.cam; giantFrame.viewW = W; giantFrame.viewH = H; giantFrame.dt = realDt;
  giantFrame.originX = S.origin.x; giantFrame.originY = S.origin.y;
  let roof = false;
  for (const g of ALL_GIANTS) {
    const view = giantState.get(g).view;
    if (!view || !view.mesh.visible) continue;
    giantFrame.sunT = sunT(g.x, g.y);
    view.update(giantFrame, shipOn ? _focus : null);
    if (view.cut.open > 0.3) roof = true;
  }
  S.underRoof = roof;

  // Kopalnia: skała testowa (po wczytaniu komórek pola), drony, lasery, wiązka,
  // fizyka skał (asteroidMining.step) i render ciał / okruchów.
  if (rig) {
    const hullLen = atlas ? atlas.length : 1800;
    if (S.pendingTestRock && S.frame > 2) {
      const tb = rig.spawnTestRock(S.pendingTestRock, { x: S.ship.x, y: S.ship.y, angle: S.ship.angle, len: hullLen }, S.time);
      S.pendingTestRock = null;
      // Kadr między Atlasem a skałą testową (skała bliżej środka).
      if (tb) S.camHold = { x: S.ship.x + (tb.p[0] - S.ship.x) * 0.62, y: S.ship.y + (-tb.p[1] - S.ship.y) * 0.62 };
    }
    if (S.mouse.valid) {
      const mp = screenToWorld(S.mouse.x, S.mouse.y);
      rig.pointer(mp.x, mp.y, S.miningDown);
    }
    _rigFrame.time = S.time;
    _rigFrame.ship.x = S.ship.x; _rigFrame.ship.y = S.ship.y; _rigFrame.ship.angle = S.ship.angle; _rigFrame.ship.len = hullLen;
    _rigFrame.originX = S.origin.x; _rigFrame.originY = S.origin.y;
    rig.update(realDt, _rigFrame);
    _minedFrame.zoom = S.cam.zoom; _minedFrame.originX = S.origin.x; _minedFrame.originY = S.origin.y;
    _minedFrame.time = S.time; _minedFrame.camX = S.cam.x; _minedFrame.camY = S.cam.y;
    _minedFrame.sunT = S.sunOcc ? sunLight : null;
    minedRocks.update(_minedFrame);
  }

  updateDynamics(realDt);
  // Mapa pola nad kadrem (słońce, pył, lód, burze): mgła, ośrodek, niebo.
  mapFrame.cam = S.cam; mapFrame.viewW = W; mapFrame.viewH = H; mapFrame.focalPx = focalPx();
  mapFrame.originX = S.origin.x; mapFrame.originY = S.origin.y;
  mapFrame.sunT = S.sunOcc ? sunLight : one;
  fieldMap.update(mapFrame);
  if (fog && S.fogOn) {
    fogFrame.cam = S.cam; fogFrame.viewW = W; fogFrame.viewH = H; fogFrame.focalPx = focalPx();
    fogFrame.time = S.time; fogFrame.originX = S.origin.x; fogFrame.originY = S.origin.y; fogFrame.sunOcc = S.sunOcc;
    fog.update(fogFrame);
  }
  // Burza (przed światłami: dokłada łańcuchy świateł kanałów).
  if (storm) {
    stormFrame.cam = S.cam; stormFrame.viewW = W; stormFrame.viewH = H; stormFrame.dt = realDt;
    stormFrame.originX = S.origin.x; stormFrame.originY = S.origin.y;
    _stormOpts.layer = playLayer; _stormOpts.zOf = playLayer.zOf;
    storm.update(stormFrame, _stormOpts);
  }
  buildLights();
  if (shadows) shadows.render(renderer);
  if (volume) {
    volume.setVisible(S.volumeOn);
    volFrame.camX = S.cam.x - S.origin.x; volFrame.camY = -(S.cam.y - S.origin.y);
    volFrame.zoom = S.cam.zoom; volFrame.viewW = W; volFrame.viewH = H; volFrame.time = S.time;
    volFrame.originX = S.origin.x; volFrame.originY = S.origin.y;
    volume.update(volFrame);
    volume.compute();
  }
  if (sparks) sparks.update(realDt, S.cam.zoom);

  glow.begin();
  const ox = S.origin.x;
  const oy = S.origin.y;
  for (const hull of activeHulls()) hull.addGlows(glow, ox, oy, S.time);
  if (S.dynLights) dynamics.addGlows(glow, ox, oy, S.time);
  storm?.addGlows(glow, ox, oy);
  rig?.addGlows(glow, ox, oy);
  glow.commit();

  updateSky();
  pipeline.render();
  drawOverlay();
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  if (S.frame % 3 === 0) resolveGpuTimes();
  if (S.frame % 6 === 0) updateHud();
}

function updateSky() {
  const m = field.sampleMacro(S.cam.x, S.cam.y);
  const Tcam = sunT(S.cam.x, S.cam.y);
  const target = m.weight * smooth01(0.06, 0.42, m.cluster);
  sky.u.veil.value = Math.min(1, target * (0.85 + 0.15 * (1 - Tcam)));
  sky.u.sunLevel.value = Tcam;
  sky.u.ice.value = Math.min(1, m.ice || 0);
  const dx = SUN.x - S.cam.x;
  const dy = -(SUN.y - S.cam.y);
  const l = Math.hypot(dx, dy) || 1;
  sky.u.sunDir.value.set(dx / l, dy / l);
  sky.u.offset.value.set(((S.cam.x * 0.002) % 7000 + 7000) % 7000, ((S.cam.y * 0.002) % 7000 + 7000) % 7000);
  // Błyski burzy głęboko pod płaszczyzną: pozycja na ekranie z paralaksą tła.
  _flashes.length = 0;
  if (storm) {
    const camZ = focalPx() / S.cam.zoom;
    for (const f of storm.flashes) {
      const depth = 6000;
      const k = focalPx() / (camZ + depth);
      const q = _flashPool[_flashes.length] || (_flashPool[_flashes.length] = { sx: 0, sy: 0, r: 0, e: 0 });
      q.sx = (f.x - S.cam.x) * k + W * 0.5; q.sy = (f.y - S.cam.y) * k + H * 0.5; q.r = Math.max(120, f.range * k * 0.6); q.e = f.e;
      _flashes.push(q);
      if (_flashes.length >= 4) break;
    }
  }
  sky.setFlashes(_flashes);
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
// Podpisy (galerie, olbrzymy)

function drawOverlay() {
  ctx2d.clearRect(0, 0, overlay.width, overlay.height);
  if (S.hideUi) return;
  const cam = S.cam;
  if (S.scene === 'giants') {
    ctx2d.save();
    ctx2d.font = '600 14px ui-monospace, Consolas, monospace';
    ctx2d.textAlign = 'center';
    for (const g of GIANTS) {
      const st = giantState.get(g);
      const x = (g.x - cam.x) * cam.zoom + W * 0.5;
      const y = (g.y - g.preset.half[1] * 1.05 - cam.y) * cam.zoom + H * 0.5 - 10;
      if (x < -300 || x > W + 300 || y < -40 || y > H + 40) continue;
      ctx2d.fillStyle = 'rgba(200,225,240,0.88)';
      const state = st.view ? '' : (st.error ? ' — błąd' : ` — liczę ${Math.round(st.progress * 100)}%`);
      ctx2d.fillText(`${g.preset.label}${state}`, x, y);
    }
    ctx2d.restore();
    return;
  }
  if (!GALLERY_SCENES.has(S.scene)) {
    rig?.drawOverlay(ctx2d, S.cam, W, H);
    return;
  }
  ctx2d.save();
  ctx2d.font = `600 ${Math.round(Math.min(18, Math.max(12, 12 + cam.zoom * 6)))}px ui-monospace, Consolas, monospace`;
  ctx2d.textAlign = 'center';
  for (const r of (S.scene === 'shapes' ? shapeRocks : typeRocks)) {
    if (!r.label) continue;
    const x = (r.x - cam.x) * cam.zoom + W * 0.5;
    const y = (r.y - cam.y) * cam.zoom + H * 0.5 - r.r * 1.3 * cam.zoom - 12;
    ctx2d.fillStyle = 'rgba(200,225,240,0.88)';
    ctx2d.fillText(r.label, x, y);
  }
  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Akcje

/** Wybuch w świecie gry; (x, y) mniejsze od 1 mln = przesunięcie od środka kamery. */
function explode(x, y, power = 1) {
  let wx = Number(x);
  let wy = Number(y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
    wx = S.ship.x + Math.cos(S.ship.angle) * 1500;
    wy = S.ship.y + Math.sin(S.ship.angle) * 1500;
  } else if (Math.abs(wx) < 1e6 && Math.abs(wy) < 1e6) {
    wx += S.cam.x;
    wy += S.cam.y;
  }
  dynamics.explode(wx, wy, Math.max(0.05, Number(power) || 1), S.time);
  // Iskry wybuchu (GPU): snop na wszystkie strony, ciepłe.
  sparks?.emit(wx - S.origin.x, -(wy - S.origin.y), 60, 0, 0, 1, 380 * Math.min(2, power), { cone: -1, speed: [300, 2400], life: [0.2, 0.9], color: [3.2, 1.9, 0.9], size: 6 });
}

function shootAt(wx, wy) {
  if (!atlas || !shipsOn()) return;
  const c = Math.cos(S.ship.angle);
  const s = Math.sin(S.ship.angle);
  const side = (S.frame & 1) ? 60 : -60;
  const x = S.ship.x + c * atlas.length * 0.5 - s * side;
  const y = S.ship.y + s * atlas.length * 0.5 + c * side;
  dynamics.shoot(x, y, wx, wy, S.ship.vx, S.ship.vy, S.time);
}

function barrage() {
  const c = Math.cos(S.ship.angle);
  const s = Math.sin(S.ship.angle);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.45;
    const d = 1300 + (i % 2) * 700;
    const dx = Math.cos(a) * c - Math.sin(a) * s;
    const dy = Math.cos(a) * s + Math.sin(a) * c;
    dynamics.explode(S.ship.x + dx * d, S.ship.y + dy * d, 0.8, S.time - i * 0.09);
  }
}

/** Piorun na żądanie: między skałami przed dziobem (skały energetyczne mają pierwszeństwo). */
function strike(x, y) {
  if (!storm || !playLayer) return false;
  let wx = Number(x);
  let wy = Number(y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
    wx = S.ship.x + Math.cos(S.ship.angle) * 1400;
    wy = S.ship.y + Math.sin(S.ship.angle) * 1400;
  }
  return storm.forceStrike(playLayer, playLayer.zOf, wx, wy);
}

// ---------------------------------------------------------------------------
// HUD i statystyki

function fmt(n) { return Math.round(n).toLocaleString('pl-PL'); }
function f2(v) { return v.toFixed(2).replace('.', ','); }

function collectStats() {
  const info = renderer.info;
  const rocks = layers.reduce((a, l) => a + (l.enabled ? l.stats.drawn : 0), 0);
  return {
    scene: S.scene,
    fps: +S.fps.toFixed(1),
    cpuMs: +S.cpuMs.toFixed(2),
    gpuMs: +(S.gpuRenderMs + S.gpuComputeMs).toFixed(2),
    gpuRenderMs: +S.gpuRenderMs.toFixed(2),
    gpuComputeMs: +S.gpuComputeMs.toFixed(2),
    drawCalls: info.render.drawCalls,
    triangles: info.render.triangles,
    computeCalls: info.compute.frameCalls,
    lights: grid.stats.lights,
    lightsMaxPerCell: grid.stats.maxPerCell,
    flares: dynamics.stats.flares,
    rockLights: dynamics.stats.rockLights,
    explosions: dynamics.stats.explosions,
    rocks,
    minerals: playLayer?.minerals?.stats.drawn || 0,
    shadowMaps: shadows ? shadows.stats.maps : 0,
    shadowCasters: shadows ? shadows.stats.casters : 0,
    volumeColumns: volume && S.volumeOn ? volume.stats.columns : 0,
    storm: storm ? +storm.intensity.toFixed(2) : 0,
    strikes: storm ? storm.stats.strikes : 0,
    boltSegments: storm ? storm.stats.segments : 0,
    sparks: sparks ? sparks.stats.spawned : 0,
    Tship: +(S.sunOcc ? sunTransmittance(S.ship.x, S.ship.y) : 1).toFixed(3),
    giants: ALL_GIANTS.filter((g) => giantState.get(g).view).length
  };
}

function updateHud() {
  if (S.hideUi) return;
  const st = collectStats();
  $('stats').innerHTML = [
    `<b>${st.fps.toFixed(0)} FPS</b> · CPU ${f2(st.cpuMs)} ms · GPU ${f2(st.gpuMs)} ms`,
    `GPU: render ${f2(st.gpuRenderMs)} ms · compute ${f2(st.gpuComputeMs)} ms`,
    `światła ${fmt(st.lights)} (max ${fmt(st.lightsMaxPerCell)} w komórce) · flary ${fmt(st.flares)} · skały ${fmt(st.rockLights)}`,
    `ośrodek ${fmt(st.volumeColumns)} kolumn × 40 · mapy cienia ${st.shadowMaps} (${fmt(st.shadowCasters)} skał)`,
    `draw calle ${fmt(st.drawCalls)} · trójkąty ${fmt(st.triangles / 1000)} tys. · skały ${fmt(st.rocks)} · minerały ${fmt(st.minerals)}`,
    `burza ${Math.round(st.storm * 100)}% · pioruny ${st.strikes} · segmenty ${fmt(st.boltSegments)} · iskry łącznie ${fmt(st.sparks)}`
  ].join('\n');
  const m = field.sampleMacro(S.cam.x, S.cam.y);
  const dx = S.cam.x - SUN.x;
  const dy = S.cam.y - SUN.y;
  const lines = [];
  lines.push(`<b>ASTEROIDY WebGPU</b> · ${SCENE_LABELS[S.scene]} · zoom ${S.cam.zoom.toFixed(3).replace('.', ',')}`);
  lines.push(`${(Math.hypot(dx, dy) / AU).toFixed(2).replace('.', ',')} AU od Słońca · pole ${m.cluster.toFixed(2).replace('.', ',')} · słońce przy statku ${(st.Tship * 100).toFixed(0)}%${S.sunOcc ? '' : ' (przesłanianie wył.)'}`);
  lines.push(`w kadrze: gra ${fmt(playLayer?.stats.drawn || 0)} · tło ${fmt(layers.slice(1).reduce((a, l) => a + l.stats.drawn, 0))} · komórki w kolejce ${layers.reduce((a, l) => a + l.stats.pending, 0)}`);
  if (S.scene === 'giants' || S.scene === 'giantField') {
    const g = S.scene === 'giantField' ? FIELD_GIANTS[0] : (GIANTS[S.focus] || GIANTS[0]);
    const gs = giantState.get(g);
    lines.push(`olbrzymy: ${st.giants}/${ALL_GIANTS.length} gotowe · ${g.preset.label}: ${g.preset.desc}`);
    if (gs.giant) lines.push(`siatka ${gs.giant.dims.nx}×${gs.giant.dims.ny}×${gs.giant.dims.nz} · przekrój ${gs.view ? Math.round(gs.view.cut.open * 100) : 0}%${S.autopilot ? ' · AUTOPILOT' : ''}`);
  }
  if (shipsOn()) lines.push(`Atlas: ${fmt(Math.hypot(S.ship.vx, S.ship.vy))} j/s · ciąg ${(S.ship.thrust * 100).toFixed(0)}% · W/S/A/D/Q/E, Shift`);
  if (rig) lines.push(...rig.hudLines());
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

const click = (id) => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
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
  // Kopalnia: lot statkiem oddaje kamerę formacji (kadr skały testowej był przytrzymany).
  if (S.scene === 'mining' && 'wsadqe'.includes(k) && k.length === 1) S.camHold = null;
  if ((S.scene === 'giants' || S.scene === 'giantField') && 'wsadqe'.includes(k) && k.length === 1) {
    if (S.autopilot) { S.autopilot = null; updateFocusButtons(); }
    S.camGoal = null;
  }
  if (k === 'z') S.targetZoom = 1;
  if (k === 'x') S.targetZoom = ZOOM_MIN;
  if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
  if (k === 'l') click('t-shiplights');
  if (k === 'o') click('t-sunocc');
  if (k === 'b') click('t-bloom');
  if (k === 'v') click('t-volume');
  if (k === 'n') click('t-fog');
  if (k === 'p') strike();
  // Kopalnia.
  if (k === 'g' && rig && !GALLERY_SCENES.has(S.scene) && S.scene !== 'giants') { rig.setEnabled(!rig.enabled); updateMiningButtons(); }
  if (k === 'j' && rig) showCoreGallery();
  if (rig?.enabled) {
    if (k === 'f') rig.detonate();
    if (k === 'r') rig.blastCore(S.time);
    if (k === 'c') { rig.cycleCharge(e.shiftKey ? -1 : 1); updateMiningButtons(); }
    if (k === 't') { rig.toggleTractor(); updateMiningButtons(); }
    if (k === 'm') { rig.toggleTrap(); updateMiningButtons(); }
    if (k === 'k') { rig.toggleScan(); updateMiningButtons(); }
  }
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => S.keys.clear());

function screenToWorld(px, py, out = { x: 0, y: 0 }) {
  out.x = S.cam.x + (px - W * 0.5) / S.cam.zoom;
  out.y = S.cam.y + (py - H * 0.5) / S.cam.zoom;
  return out;
}

function bindCanvasInput(canvas) {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zMin = S.scene === 'giants' ? ZOOM_MIN_GIANTS : ZOOM_MIN;
    S.targetZoom = Math.min(ZOOM_MAX, Math.max(zMin, S.targetZoom * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    S.dragging = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, moved: false, button: e.button };
    canvas.setPointerCapture(e.pointerId);
    // Kopalnia: LPM trzymany = lasery dronów; Shift + przeciągnięcie = linia piły.
    if (rig?.enabled && e.button === 0) {
      if (e.shiftKey) S.sawStart = screenToWorld(e.clientX, e.clientY, { x: 0, y: 0 });
      else S.miningDown = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    S.mouse.x = e.clientX; S.mouse.y = e.clientY; S.mouse.valid = true;
    if (S.sawStart && rig) {
      const q = screenToWorld(e.clientX, e.clientY);
      rig.previewSaw([S.sawStart.x, S.sawStart.y], [q.x, q.y]);
    }
    const d = S.dragging;
    if (!d || !(GALLERY_SCENES.has(S.scene) || S.scene === 'giants')) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (!d.moved) return;
    S.cam.x = d.cx - (e.clientX - d.x) / S.cam.zoom;
    S.cam.y = d.cy - (e.clientY - d.y) / S.cam.zoom;
    S.camGoal = S.scene === 'giants' ? { x: S.cam.x, y: S.cam.y } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = S.dragging;
    S.dragging = null;
    if (rig?.enabled && !GALLERY_SCENES.has(S.scene) && S.scene !== 'giants') {
      if (e.button === 0) S.miningDown = false;
      if (e.button === 0 && S.sawStart) {
        const q = screenToWorld(e.clientX, e.clientY);
        rig.startSaw(S.sawStart.x, S.sawStart.y, q.x, q.y);
        S.sawStart = null;
      }
      if (e.button === 2) {
        const p = screenToWorld(e.clientX, e.clientY);
        rig.plantCharge(p.x, p.y, S.time);
      }
      return;
    }
    if (!d || d.moved) return;
    const p = screenToWorld(e.clientX, e.clientY);
    if (GALLERY_SCENES.has(S.scene)) {
      const cells = S.scene === 'shapes' ? shapeCells : galleryCells;
      let best = -1;
      let bd = Infinity;
      cells.forEach((c, i) => { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < bd) { bd = dd; best = i; } });
      if (best >= 0 && bd < 1400) focusGallery(best === S.focus ? -1 : best);
      return;
    }
    if (S.scene === 'giants') return;
    if (d.button === 0) explode(p.x, p.y, 1);
    if (d.button === 2) shootAt(p.x, p.y);
  });
}

// ---------------------------------------------------------------------------
// Panel

function bindRange(id, outId, fmtFn, apply) {
  const el = $(id);
  const out = $(outId);
  const run = () => { const v = Number(el.value); out.textContent = fmtFn(v); apply(v); };
  el.addEventListener('input', run);
  run();
  return (v) => { el.value = String(v); run(); };
}

let setLightsUi = null;
function bindControls() {
  const toggle = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  toggle('t-volume', (v) => { S.volumeOn = v; });
  toggle('t-fog', (v) => { S.fogOn = v; fog?.setVisible(v); });
  toggle('t-shadows', (v) => { S.spotShadows = v; });
  toggle('t-shiplights', (v) => { S.shipLights = v; });
  toggle('t-dynlights', (v) => { S.dynLights = v; });
  toggle('t-sunocc', (v) => { S.sunOcc = v; fieldMap.invalidate(); });
  toggle('t-bloom', (v) => { if (bloomNode) bloomNode.strength.value = v ? BLOOM_DEFAULTS.strength : 0; });
  toggle('t-escort', (v) => { S.showEscort = v; });
  toggle('t-back', (v) => { S.backRocks = v; for (const l of layers.slice(1)) l.setVisible(v); });
  toggle('t-rocklights', (v) => { S.rockLights = v; });
  toggle('t-floods', (v) => { S.floods = v; });
  toggle('t-navglow', (v) => { S.navGlow = v; });
  toggle('t-storm', (v) => { S.stormOn = v; storm?.setVisible(v); });
  setLightsUi = bindRange('s-lights', 'o-lights', (v) => fmt(v), (v) => { S.lightTarget = Math.min(LIGHT_CAP - 160, v); });
  bindRange('s-voldens', 'o-voldens', f2, (v) => { if (volume) volume.cfg.density = v; });
  bindRange('s-volgain', 'o-volgain', f2, (v) => { if (volume) volume.cfg.gain = 0.0014 * v; });
  bindRange('s-speed', 'o-speed', (v) => `${v}`, (v) => { S.speed = v; });
  // Światło i mgła (jak panel dema WebGL).
  toggle('t-detail', (v) => { shared.detail.value = v ? 1 : 0; });
  toggle('t-veins', (v) => { shared.veins.value = v ? 1 : 0; });
  bindRange('s-sun', 'o-sun', f2, (v) => {
    sunFg.intensity = v;
    sunBg.intensity = v;
    shared.sunColor.value.set(...ROCK_LIGHT_DEFAULTS.sunColor).multiplyScalar(v);
  });
  bindRange('s-amb', 'o-amb', f2, (v) => {
    shared.ambientTop.value.set(...ROCK_LIGHT_DEFAULTS.ambientTop).multiplyScalar(v);
    shared.ambientBounce.value.set(...ROCK_LIGHT_DEFAULTS.ambientBounce).multiplyScalar(v);
  });
  bindRange('s-fog', 'o-fog', f2, (v) => { if (fog) fog.U.density.value = v; });
  bindRange('s-fogb', 'o-fogb', f2, (v) => { if (fog) fog.U.bright.value = v; });
  $('b-zoom1').addEventListener('click', () => { S.targetZoom = 1; });
  // Kopalnia.
  $('b-mine-mode').addEventListener('click', () => {
    if (GALLERY_SCENES.has(S.scene) || S.scene === 'giants') setScene('mining');
    else rig.setEnabled(!rig.enabled);
    updateMiningButtons();
  });
  $('b-detonate').addEventListener('click', () => rig.detonate());
  $('b-tractor').addEventListener('click', () => { rig.toggleTractor(); updateMiningButtons(); });
  $('b-scan').addEventListener('click', () => { rig.toggleScan(); updateMiningButtons(); });
  $('b-core-blast')?.addEventListener('click', () => {
    if (!rig.enabled) { if (GALLERY_SCENES.has(S.scene) || S.scene === 'giants') setScene('mining'); else rig.setEnabled(true); }
    rig.blastCore(S.time);
    updateMiningButtons();
  });
  $('b-trap')?.addEventListener('click', () => { rig.toggleTrap(); updateMiningButtons(); });
  $('b-core-gallery')?.addEventListener('click', () => showCoreGallery());
  for (const b of document.querySelectorAll('[data-charge]')) {
    b.addEventListener('click', () => { rig.chargeIndex = Number(b.dataset.charge); updateMiningButtons(); });
  }
  for (const b of document.querySelectorAll('[data-mine-type]')) {
    b.addEventListener('click', () => {
      S.testType = b.dataset.mineType;
      if (S.scene !== 'mining') setScene('mining');
      else { resetMining(); S.pendingTestRock = S.testType; }
      updateMiningButtons();
    });
  }
  $('b-explode').addEventListener('click', () => explode());
  $('b-barrage').addEventListener('click', barrage);
  $('b-strike').addEventListener('click', () => strike());
  for (const b of document.querySelectorAll('[data-scene]')) b.addEventListener('click', () => setScene(b.dataset.scene));
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  const loading = $('loading');
  await initRenderer();
  resize();
  bindCanvasInput(renderer.domElement);
  loading.textContent = 'Pieczenie kształtów skał (TSL, GPU)…';
  await new Promise((r) => setTimeout(r, 20));
  bank = await new RockShapeBankGPU().bake(renderer);
  const noise = createRockNoiseVolume(renderer, 64);
  shared = createRockShared(bank, noise);
  shared.noise = noise;
  playMaterial = new RockNodeMaterial({ shared, backdrop: false });
  // Mapy cienia lamp: skały gry z pozycji reflektorów (atlas); siatka świateł
  // czyta je w pętli (światła z flagą mapy gasną za skałą — skały i ośrodek).
  shadows = new ShadowAtlas({ bank, source: playMaterial });
  grid.shadows = shadows;
  // Światło wolumetryczne (ośrodek nad i pod płaszczyzną gry) — materiały
  // passa gry czytają je w setupOutput, więc musi istnieć przed ich kompilacją.
  volume = new VolumeLight({ renderer, grid, fieldMap, scene: fgScene, maxW: Math.max(innerWidth, screen.width || 0), maxH: Math.max(innerHeight, screen.height || 0) });
  shared.volume = volume;
  // Czubek skały gry pod płaszczyzną: kadłuby (z = 0) zawsze nad skałą;
  // skały z minerałami sięgają dalej (czubki kryształów ~1,6 promienia).
  const mineralTypes = new Set(MINERAL_TYPES);
  const playZ = (rock) => -rock.r * (mineralTypes.has(rock.type) ? 1.62 : 1.45) * Math.max(rock.sx, rock.sy, rock.sz);
  mineralTemplates = new MineralTemplates(bank);
  const mineralMat = new MineralMaterial({ shared, layer: playMaterial.L, grid, minRockPx: 9 });
  const playMinerals = new MineralLayer({ scene: fgScene, templates: mineralTemplates, material: mineralMat, renderOrder: 2, name: 'minerals_play' });
  playLayer = new RockLayer({
    scene: fgScene, bank, material: playMaterial, field, bandIndex: BELT_BAND.PLAY,
    perspective: false, renderOrder: 1, zOf: playZ, minPx: 0.7, maxLod: 5, sunT: sunLight, minerals: playMinerals
  });
  layers.push(playLayer);
  const FADE = { [BELT_BAND.RUBBLE]: [0.22, 0.09], [BELT_BAND.MID]: [0.07, 0.03], [BELT_BAND.DEEP]: null };
  for (const band of [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP]) {
    layers.push(new RockLayer({
      scene: bgScene, bank, material: new RockNodeMaterial({ shared, backdrop: true }), field, bandIndex: band,
      perspective: true, renderOrder: 2, minPx: 0.8, fadeZoom: FADE[band], maxLod: 3, sunT: sunLight
    }));
  }
  for (const layer of layers) layer.setOrigin(S.origin.x, S.origin.y);
  // Galerie: zestawy skał podanych wprost (materiał i minerały warstwy gry).
  const galleryMinerals = (name) => new MineralLayer({ scene: fgScene, templates: mineralTemplates, material: mineralMat, renderOrder: 2, capacity: 2048, minRockPx: 6, name });
  typeSet = new RockSet({ scene: fgScene, bank, material: playMaterial, zOf: playZ, name: 'galleryTypes', minerals: galleryMinerals('minerals_types') });
  shapeSet = new RockSet({ scene: fgScene, bank, material: playMaterial, zOf: playZ, name: 'galleryShapes', minerals: galleryMinerals('minerals_shapes') });
  buildTypeGallery();
  buildShapeGallery();
  typeSet.setOrigin(S.origin.x, S.origin.y);
  shapeSet.setOrigin(S.origin.x, S.origin.y);
  sky = new Sky(bgScene);
  glow = new GlowSprites({ scene: fgScene, capacity: 4096 });
  sparks = new Sparks({ renderer, scene: fgScene });
  storm = new StormSystem({ scene: fgScene, field, shared, sparks });
  // Kopalnia: fizyka wydobycia (src/game/asteroidMining.js — ta sama w grze),
  // render ciał i okruchów (minedRocks.js), drony i ładunki dema (miningRig.js).
  // Rdzenie skał (2026-09-28): skała energetyczna ma w geodzie piorun kulisty (w grze jeszcze wył.).
  mining = new AsteroidMining({ radiusAt: (shape, x, y, z) => bank.radiusAt(shape, x, y, z), seed: 0x51A7, config: { ballLightning: true } });
  minedRocks = new MinedRocks({ renderer, scene: fgScene, bank, shared, grid, mining, mineralTemplates, shadows });
  rig = new MiningRig({ scene: fgScene, mining, playLayer, playZ, dynamics, sparks, sunT: sunLight, storm, shared });
  loading.textContent = 'Kadłuby…';
  try {
    atlas = await DemoHull.load({ id: 'atlas', url: atlasUrl, editor: ATLAS_EDITOR_DEFAULTS, scene: fgScene, shared, owner: 1 });
  } catch (err) { reportError(`Atlas: ${err.stack || err}`); }
  try {
    escort = await DemoHull.load({ id: 'terran_carrier', url: carrierUrl, editor: SHIP_EDITOR_DEFAULTS.ships?.terran_carrier || null, scene: fgScene, shared, owner: 2 });
  } catch (err) { reportError(`Eskorta: ${err.stack || err}`); }
  // Mgła pasa (płaty beltDust3D) w passie tła i gry.
  fog = new BeltFog({ renderer, scene: bgScene, fgScene, field, grid, fieldMap });
  // Olbrzymy liczą się w workerach w tle.
  startGiants();
  // Cień pól dla całego układu (jak ekran ładowania gry) — potem miejsca scen,
  // które potrzebują transmitancji słońca.
  await precomputeOcclusion((p) => { loading.textContent = `Liczenie cienia pól asteroid… ${Math.round(p * 100)}%`; });
  SPOTS.deep = findDeepSpot();
  SPOTS.sparse = findSparseSpot();
  SPOTS.storm = findStormSpot() || SPOTS.field;
  field.clearCache();
  buildPipeline();
  bindControls();
  const initial = params.get('scene');
  setScene(SCENES.includes(initial) ? initial : 'field');
  loading.textContent = 'Wczytywanie skał pola…';
  await new Promise((r) => setTimeout(r, 20));
  layerFrame.cam = S.cam; layerFrame.viewW = W; layerFrame.viewH = H; layerFrame.focalPx = focalPx(); layerFrame.time = 0;
  layerFrame.budgetMs = 4000;
  updateCameras();
  for (const layer of layers) layer.update(layerFrame);
  // Parametry testów w adresie: ?scene=storm&lights=512&zoom=1.5
  if (params.has('lights')) setLightsUi(Math.max(0, Math.min(LIGHT_CAP - 160, Number(params.get('lights')) || 0)));
  if (params.has('zoom')) S.cam.zoom = S.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_GIANTS, Number(params.get('zoom')) || 1));
  loading.style.display = 'none';
  S.ready = true;
  updateMiningButtons();
  window.__demo = {
    S, field, layers, grid, renderer, bank, volume, shadows, fog, dynamics, fieldMap, storm, sparks, SPOTS, FLIGHT, GIANTS, FIELD_GIANTS, giantState,
    mining, minedRocks, rig, resetMining, screenToWorld,
    stopLoop: () => renderer.setAnimationLoop(null),
    setScene,
    focusGallery, focusGiant, flyGiant,
    lookAt: (x, y, zoom) => { S.camHold = Number.isFinite(x) ? { x, y } : null; if (zoom) S.cam.zoom = S.targetZoom = zoom; },
    setZoom: (z) => { S.cam.zoom = S.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_GIANTS, Number(z) || 1)); },
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(performance.now(), dt); },
    explode,
    strike,
    shoot: (x, y) => shootAt(Number(x), Number(y)),
    setLights: (n) => { const v = Math.max(0, Math.min(LIGHT_CAP - 160, Math.round(Number(n) || 0))); setLightsUi(v); return v; },
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
