// Demo Z5: kontenery na statkach i drony przeładunkowe w porcie ringu „Halo”
// Ziemi (plan ruchu v2 § 3.4). Serwowanie: `npm run dev`, potem
// /dema/kontenery.html (?view=1…6, ?t=sekundy, ?shot=1 — zrzuty, ?quality=…).
//
// Scena jak w demie ringu (halo_ring_demo.js): ring, Ziemia, tło gry, post HDR,
// replika kamery gry Core3D (BG persp → Ziemia ortho → świat ortho → FG persp)
// i kamera kinowa. Na tym:
//  - zatoka Z-02 (kompleks gracza) z kilkoma statkami na stanowiskach —
//    każdy w pętli rozładunek → załadunek (kontekst z ziarna i numeru cyklu,
//    stan z transferState: bez stanu, dowolny czas);
//  - statek gracza w trybie lotu K-7 (L): zadokowanie uruchamia drony,
//    oddokowanie w trakcie je odwołuje (abortAt);
//  - sprite'y „pusty pokład” (Z11) oświetlone jak kadłub gry (otoczenie 0,24,
//    rozproszone z poduszkowej normalnej), żeby kontenery oceniać na tle
//    kadłuba takim jak w grze; przełącznik „stary sprite” pokazuje tryb maski
//    ładowni na sprite'ach z domalowanym ładunkiem.
// Statki są tu tylko dla dema kontenerów — ring nie udaje życia (w grze statki
// przyjdą z ruchu v2, Z14).
//
// WebGPU (2026-10-04): host jak demo ringu (halo_ring_demo.js) — WebGPURenderer
// z limitami adaptera, sprite kadłuba w TSL, budowa ringu asynchroniczna
// (await ring.ready przed trybem lotu K-7 — hale i zatoki są dopiero po niej).
import * as THREE from 'three/webgpu';
import { Discard, Fn, If, cos, dot, float, max, normalize, pow, sin, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { createHaloRing } from '../src/3d/haloRing/index.js';
import { HALO_GEOMETRY_DEFAULTS, HALO_QUALITY } from '../src/3d/haloRing/haloRingConfig.js';
import { computeGameCameraHeight } from '../src/3d/haloRing/haloRingLayout.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { k7HeadingToWorld, k7HubToWorld } from '../src/3d/haloRing/haloPortK7Layout.js';
import { PORT_SEQUENCE } from '../src/3d/haloRing/haloPortDocking.js';
import { HALO_PLAYER_HULLS } from '../src/3d/haloRing/haloPortHulls.js';
import { K7FlightDemo } from './halo_ring_k7_flight.js';
import { DEMO_LAYERS, createEarth, createGameBackground, createPost, createSky } from './halo_ring_demo_env.js';
import { CARGO_HOLD_LAYOUTS, cargoDeckFill, cargoHash01, cargoResourceKey } from '../src/data/cargoContainers.js';
import {
  CARGO_MODE,
  cargoBerthGeometry,
  cargoHullExtent,
  cargoTransferPlan,
  cargoTransferWindow,
  createTransferState,
  transferState
} from '../src/game/cargoPortOps.js';
import { CARGO3D_TUNE, CargoContainers3D } from '../src/3d/cargoContainers3D.js';
import { CARGO_DRONE_TUNE, CargoDrones3D, pushCargoScene } from '../src/3d/cargoDrones3D.js';
import { RESOURCES } from '../src/data/resources.js';
import { getPlaceholderStats, installPlaceholders } from '../src/3d/tsl/zamiennik.js';

const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const shaderErrors = [];
function reportError(text) {
  shaderErrors.push(text);
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = shaderErrors.join('\n\n');
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));

// ---------------------------------------------------------------------------
// Renderer i scena (demo jest hostem — moduły go nie tworzą). Tylko WebGPU:
// limity z adaptera (domyślne urządzenie ma 8192 px tekstury — mapy „Ultra” 16K).
const canvas = $('view');
const WANTED_LIMITS = ['maxTextureDimension2D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage',
  'maxInterStageShaderVariables', 'maxVertexAttributes', 'maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage',
  'maxColorAttachmentBytesPerSample', 'maxBufferSize', 'maxStorageBufferBindingSize'];
const adapter = navigator.gpu ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) : null;
if (!adapter) {
  reportError('Demo wymaga przeglądarki z WebGPU (brak adaptera).');
  throw new Error('brak WebGPU');
}
const requiredLimits = {};
for (const k of WANTED_LIMITS) if (Number.isFinite(adapter.limits[k])) requiredLimits[k] = adapter.limits[k];
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, requiredLimits });
await renderer.init();
if (!renderer.backend.isWebGPUBackend) {
  reportError('Demo wymaga WebGPU (three przeszedł na zapasowy backend WebGL2).');
  throw new Error('brak WebGPU');
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.highPrecision = true;
// bezpiecznik: ShaderMaterial (GLSL) rysuje się magentą z ostrzeżeniem (licznik w stats)
installPlaceholders(renderer);
// błędy walidacji WebGPU / WGSL (odpowiednik debug.onShaderError z WebGL)
renderer.backend.device.addEventListener('uncapturederror', (e) => reportError(`WEBGPU: ${e.error?.message || e.error}`));

const quality = HALO_QUALITY[params.get('quality')] ? params.get('quality') : 'high';
const scene = new THREE.Scene();
const planetRadius = RING_PLANET_WORLD_RADII.earth;
const ring = createHaloRing({ planetRadius, seed: 1337, quality, renderer });
ring.setLayers({ default: DEMO_LAYERS.bg, fg: DEMO_LAYERS.fg });
scene.add(ring.group);
const earth = createEarth(renderer, ring.uniforms, planetRadius);
scene.add(earth.game, earth.cine);
const sky = createSky();
scene.add(sky.mesh);
const gameBg = createGameBackground(renderer, { starsZ: -(HALO_GEOMETRY_DEFAULTS.width + 3000) });
scene.add(gameBg.group);
const post = createPost(renderer);

// Budowa ringu jest asynchroniczna (mapy, bryły, hale K-7 i zatoki) — tryb lotu
// i rejestr stanowisk potrzebują hal, więc dalej dopiero po niej.
$('loading').style.display = 'block';
const ringOk = await ring.ready;
if (!ringOk) reportError(`Budowa ringu nie wyszła: ${ring.error?.message || ring.error}`);

// Kontenery i drony (warstwa świata ortho; światła dronów w FG).
CargoContainers3D.attach(scene);
CargoDrones3D.attach(scene);
CargoContainers3D.setLayer(DEMO_LAYERS.world);
CargoDrones3D.setLayers(DEMO_LAYERS.world, DEMO_LAYERS.fg);

// ---------------------------------------------------------------------------
// Słońce: azymut w płaszczyźnie sceny + wysokość 49° (jak ring w grze)
const sun = { azimuth: -25, elevation: 49 };
const sunDir = new THREE.Vector3();
function applySun() {
  ring.setSun(sun.azimuth * DEG, sun.elevation * DEG);
  sunDir.copy(ring.uniforms.uSunDir.value);
  sky.uniforms.uSunDirW.value.copy(sunDir);
}
applySun();
// Widoczność słońca w punkcie (cień planety, CPU) — dzień portu i lampy hal.
function sunVisAt(x, y, z) {
  const c = ring.layout.planetCenterZ;
  const R = ring.layout.planetRadius;
  const oz = z - c;
  const t = -(x * sunDir.x + y * sunDir.y + oz * sunDir.z);
  if (t <= 0) return 1;
  const d = Math.sqrt(Math.max(0, x * x + y * y + oz * oz - t * t));
  return THREE.MathUtils.smoothstep(d, R - 500, R + 800);
}
// Słońce gry (świat gry, y w dół): daleko w azymucie — światło kadłubów.
function gameSun() {
  const az = sun.azimuth * DEG;
  return { x: Math.cos(az) * 1.06e6, y: -Math.sin(az) * 1.06e6 };
}

// ---------------------------------------------------------------------------
// Sprite kadłuba oświetlony jak w grze (lustro HEX_FRAGMENT_SHADER bez normal
// mapy): poduszkowa normalna z UV, otoczenie 0,24, rozproszone 1,18, połysk 0,30.
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function shipTexture(path) {
  let t = texCache.get(path);
  if (!t) {
    t = texLoader.load(path.startsWith('/') ? path : '/' + path);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.getMaxAnisotropy();
    texCache.set(path, t);
  }
  return t;
}
// TSL (dawny ShaderMaterial 1:1): graf na sprite (kilkanaście statków dema),
// wartości w material.uniforms — obiekty z .value, placeSprite / setDeckMode bez zmian.
function litSpriteMaterial(tex) {
  const uMap = texture(tex);
  const uLightDir = uniform(new THREE.Vector3(0, 0, 1));
  const uRot = uniform(0);
  const m = new THREE.NodeMaterial();
  m.name = 'KonteneryDemoSprite';
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const t = uMap.sample(vUv).toVar();
    If(t.a.lessThan(0.45), () => { Discard(); });
    const p = vUv.mul(2.0).sub(1.0);
    const n0 = normalize(vec3(p.x.mul(0.45), p.y.mul(0.45), 1.0)).toVar();
    const c = cos(uRot);
    const s = sin(uRot);
    const n = normalize(vec3(n0.x.mul(c).sub(n0.y.mul(s)), n0.x.mul(s).add(n0.y.mul(c)), n0.z)).toVar();
    const ndl = dot(n, uLightDir).toVar();
    const col = t.rgb.mul(float(0.24).add(max(0.0, ndl).mul(1.18))).toVar();
    const h = normalize(uLightDir.add(vec3(0.0, 0.0, 1.0)));
    col.addAssign(vec3(pow(max(dot(n, h), 0.0), 32.0).mul(0.3).mul(smoothstep(-0.02, 0.08, ndl))));
    return vec4(col, 1.0);
  })();
  m.depthWrite = true;
  m.depthTest = true;
  m.uniforms = { uMap, uLightDir, uRot };
  return m;
}
function makeShipSprite(w, h, tex) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), litSpriteMaterial(tex));
  mesh.layers.set(DEMO_LAYERS.world);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
function placeSprite(mesh, sx, sy, heading) {
  mesh.position.set(sx, sy, 0);
  mesh.rotation.set(0, 0, heading);
  mesh.updateMatrixWorld();
  const s = gameSun();
  const L = mesh.material.uniforms.uLightDir.value.set(s.x - sx, -s.y - sy, 600).normalize();
  void L;
  mesh.material.uniforms.uRot.value = heading;
}

// ---------------------------------------------------------------------------
// Tryb lotu K-7 (gracz) — klasa z dema ringu, bez zmian; sprite gracza rysuje
// to demo (oświetlony, pusty pokład), klasa dostaje atrapę.
const dummyAtlas = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
const flight = new K7FlightDemo({ ring, scene, atlas: dummyAtlas, layers: DEMO_LAYERS, $, loadTexture: null, daylightAt: (x, y) => sunVisAt(x, y, 0) });
flight.active = false;
const registry = flight.registry;
const hubFrame = flight.frame;

// Poza stanowiska (wpis rejestru) w scenie i w świecie gry.
function entryPose(e) {
  const w = k7HubToWorld(hubFrame, e.x, e.z, {});
  const heading = k7HeadingToWorld(hubFrame, e.angle);
  return { sx: w.x, sy: w.y, heading, game: { x: w.x, y: -w.y, angle: -heading } };
}
const entryByLabel = (label) => registry.entries.find((e) => e.label === label) || null;

// ---------------------------------------------------------------------------
// Statki na stanowiskach zatoki Z-02 (pętla: rozładunek → załadunek)
const CAPACITY = { inter_station_shuttle: 60, container_ship: 160, long_haul_freighter: 380, heavy_freighter: 900, megafreighter: 2400 };
const NPC = [
  { label: 'Z02-M01', hull: 'container_ship', cargo: [['chips', 'titan_alloy'], ['hull_plate', 'avionics'], ['ammo_kinetic', 'flak_shell']], offset: 38 },
  { label: 'Z02-M02', hull: 'container_ship', cargo: [['optic_lens', 'chips'], ['fuel_rods'], ['thruster', 'life_support']], offset: 131 },
  { label: 'Z02-M03', hull: 'container_ship', cargo: [['coolant'], ['missile_round', 'chips'], ['reactor_core', 'titan_alloy']], offset: 90 },
  { label: 'Z02-L01', hull: 'long_haul_freighter', cargo: [['iron_ore', 'copper_ore'], ['helium3', 'hydrogen'], ['ice']], offset: 64 },
  { label: 'Z02-L03', hull: 'long_haul_freighter', cargo: [['steel', 'copper_wire'], ['methane', 'ammonia'], ['scrap', 'polymer']], offset: 170 },
  { label: 'Z02-S01', hull: 'inter_station_shuttle', cargo: [['chips'], ['oxygen'], ['avionics']], offset: 20 },
  { label: 'Z02-S03', hull: 'inter_station_shuttle', cargo: [['optic_lens'], ['fusion_fuel'], ['pd_turret']], offset: 110 },
  { label: 'Z02-MG1', hull: 'megafreighter', cargo: [['iron_ore', 'ice'], ['titanium_ore', 'raw_crystal'], ['uranium_ore', 'silicon_ore']], offset: 55 },
  { label: 'Z02-MG2', hull: 'heavy_freighter', cargo: [['helium3', 'fusion_fuel'], ['steel', 'hull_plate'], ['torpedo_round', 'ammo_kinetic']], offset: 150 }
];
// Długości faz pętli (sekundy zegara stanowiska): okno + plac (winda) + zapas.
const WIN_UNLOAD = cargoTransferWindow({ seconds: 120, moveSeconds: 18 });
const WIN_LOAD = cargoTransferWindow({ seconds: 90, moveSeconds: 18 });
const PHASE_A = WIN_UNLOAD.end + 26;
const PHASE_B = WIN_LOAD.end + 6;
const CYCLE = PHASE_A + PHASE_B;

const view = { deckMode: 'empty', ships: true };
const npcs = [];
for (let i = 0; i < NPC.length; i++) {
  const spec = NPC[i];
  const e = entryByLabel(spec.label);
  if (!e) { reportError(`brak stanowiska ${spec.label}`); continue; }
  e.berth.occupied = 'npc';
  e.berth.reserved = 'npc';
  const lay = CARGO_HOLD_LAYOUTS[spec.hull];
  const pose = entryPose(e);
  const hs = HALO_PLAYER_HULLS[spec.hull];
  const w = hs ? hs.w : lay.renderLength;
  const h = hs ? hs.h : lay.renderLength * lay.png.h / lay.png.w;
  const sprite = makeShipSprite(w, h, shipTexture(lay.sprite.empty));
  placeSprite(sprite, pose.sx, pose.sy, pose.heading);
  npcs.push({
    i, spec, entry: e, lay, pose, sprite,
    geom: cargoBerthGeometry(e.berth, cargoHullExtent(lay)),
    daylight: sunVisAt(pose.sx, pose.sy, 0),
    ctxs: new Map(),
    state: null,
    plan: null,
    info: ''
  });
}
for (const n of npcs) n.state = createTransferState(null);
// Obie wersje sprite'ów od razu (przełącznik „stary sprite” bez pustej klatki).
for (const lay of Object.values(CARGO_HOLD_LAYOUTS)) { shipTexture(lay.sprite.empty); shipTexture(lay.sprite.painted); }

// Ładunek cyklu k statku (ziarnisty): 1–2 surowce, 55–100% ładowni.
function npcCargo(n, k) {
  const list = n.spec.cargo[((k % n.spec.cargo.length) + n.spec.cargo.length) % n.spec.cargo.length];
  const cap = CAPACITY[n.spec.hull];
  const frac = 0.55 + 0.45 * cargoHash01(n.i * 131 + 7, k, 1);
  const out = {};
  list.forEach((id, j) => { out[id] = cap * frac * (j === 0 ? (list.length > 1 ? 0.62 : 1) : 0.38); });
  return out;
}
function npcCtx(n, k, mode) {
  const key = `${k}:${mode}`;
  let ctx = n.ctxs.get(key);
  if (!ctx) {
    ctx = {
      seed: 1000 + n.i * 97 + (mode === CARGO_MODE.LOAD ? k + 1 : k) * 7,
      layoutId: n.spec.hull,
      cargo: npcCargo(n, mode === CARGO_MODE.LOAD ? k + 1 : k),
      capacity: CAPACITY[n.spec.hull],
      mode,
      window: mode === CARGO_MODE.LOAD ? WIN_LOAD : WIN_UNLOAD,
      berth: n.geom
    };
    n.ctxs.set(key, ctx);
    if (n.ctxs.size > 6) n.ctxs.delete(n.ctxs.keys().next().value);
  }
  return ctx;
}
// Stan statku w chwili demo T: kontekst fazy i czas na zegarze stanowiska.
function npcAt(n, T) {
  const tt = T + n.spec.offset;
  const k = Math.floor(tt / CYCLE);
  const tau = tt - k * CYCLE;
  const unload = tau < PHASE_A;
  // Rekord kursu: rozładunek niesie ładunek k, załadunek — ładunek k + 1 (ten
  // sam kontener wygląda tak samo, bo ziarno kursu jest to samo).
  const ctx = npcCtx(n, k, unload ? CARGO_MODE.UNLOAD : CARGO_MODE.LOAD);
  const plan = cargoTransferPlan(ctx);
  n.plan = plan;
  n.tBerth = unload ? tau : tau - PHASE_A;
  transferState(plan, n.tBerth, n.state);
  return n.state;
}

// ---------------------------------------------------------------------------
// Gracz: sprite (pusty pokład), ładunek i przeładunek przy stanowisku
const player = {
  sprite: null,
  hullId: 'container_ship',
  cargo: { chips: 70, titan_alloy: 60 },
  deck: null,
  ctx: null,
  plan: null,
  state: createTransferState(null),
  dockedAt: -1,
  berthPose: null,
  phase: 'idle',
  seq: 0,
  info: 'ładownia: —'
};
function playerSpriteFor(hullId) {
  const hs = HALO_PLAYER_HULLS[hullId];
  const lay = CARGO_HOLD_LAYOUTS[hullId];
  const tex = shipTexture(lay ? lay.sprite.empty : hs.sprite);
  if (player.sprite) { scene.remove(player.sprite); player.sprite.geometry.dispose(); player.sprite.material.dispose(); }
  player.sprite = makeShipSprite(hs.w, hs.h, tex);
}
function playerDeckFromCargo() {
  const lay = CARGO_HOLD_LAYOUTS[player.hullId];
  player.deck = lay ? cargoDeckFill(lay, player.cargo, CAPACITY[player.hullId] || 160).slots : null;
}
function setPlayerHull(id, mode = 'free') {
  flight.setHull(id, mode);
  player.hullId = id;
  const cap = CAPACITY[id] || 0;
  player.cargo = cap ? { chips: cap * 0.4, titan_alloy: cap * 0.35 } : {};
  player.ctx = null;
  player.phase = 'idle';
  playerSpriteFor(id);
  playerDeckFromCargo();
}
setPlayerHull('container_ship', 'free');
flight.jumpToBerth('Z02-M04');

// Nowy ładunek po rozładunku (ziarnisty, inny surowiec).
const PLAYER_CARGO = [['steel', 'polymer'], ['helium3'], ['avionics', 'chips'], ['iron_ore'], ['fuel_rods', 'ammo_kinetic']];
function nextPlayerCargo() {
  const cap = CAPACITY[player.hullId] || 0;
  const list = PLAYER_CARGO[player.seq % PLAYER_CARGO.length];
  const out = {};
  list.forEach((id, j) => { out[id] = cap * 0.8 * (j === 0 ? (list.length > 1 ? 0.6 : 1) : 0.4); });
  return out;
}

// Automat gracza (jeden postój): DOCKED → rozładunek (jeśli coś wiezie) →
// załadunek nowego ładunku → koniec do oddokowania. Oddokowanie w trakcie
// ustawia abortAt: drony kończą albo odwołują kurs i wracają; pokład jedzie
// ze statkiem w tym stanie, w jakim był.
function startPlayerTransfer(T, mode) {
  const d = flight.docking;
  const lay = CARGO_HOLD_LAYOUTS[player.hullId];
  const e = d.entry;
  const seqDock = PORT_SEQUENCE.clamp.dock;
  const tNow = Math.max(seqDock, T - player.dockedAt + seqDock);
  if (mode === CARGO_MODE.LOAD) player.cargo = nextPlayerCargo();
  player.seq++;
  player.berthPose = entryPose(e).game;
  player.ctx = {
    seed: 5000 + player.seq * 13,
    layoutId: player.hullId,
    cargo: player.cargo,
    capacity: CAPACITY[player.hullId],
    mode,
    window: { start: tNow, end: tNow + (mode === CARGO_MODE.UNLOAD ? 70 : 55) },
    berth: cargoBerthGeometry(e.berth, cargoHullExtent(lay))
  };
}
function updatePlayer(T) {
  const d = flight.docking;
  const lay = CARGO_HOLD_LAYOUTS[player.hullId];
  if (!lay) { player.info = 'kadłub bez ładowni kontenerowej'; return; }
  const seqDock = PORT_SEQUENCE.clamp.dock;
  if (d.state === 'DOCKED' && player.dockedAt < 0) {
    // Nowy postój.
    player.dockedAt = T;
    player.phase = 'service';
    const hasCargo = Object.values(player.cargo).some((m) => m > 0);
    startPlayerTransfer(T, hasCargo ? CARGO_MODE.UNLOAD : CARGO_MODE.LOAD);
  }
  if (!player.ctx) {
    if (d.state === 'FREE') { player.dockedAt = -1; player.phase = 'idle'; }
    player.info = `ładownia: ${deckSummary(player.deck)}`;
    return;
  }
  const ctx = player.ctx;
  const t = T - player.dockedAt + seqDock;
  if (d.state !== 'DOCKED' && !Number.isFinite(ctx.abortAt) && t < ctx.window.end) ctx.abortAt = t;
  player.plan = cargoTransferPlan(ctx);
  transferState(player.plan, t, player.state);
  const st = player.state;
  if (!player.deck || player.deck.length !== st.slotRes.length) player.deck = new Int16Array(st.slotRes.length);
  player.deck.set(st.slotRes.subarray(0, player.deck.length));
  const label = ctx.mode === CARGO_MODE.UNLOAD ? 'ROZŁADUNEK' : 'ZAŁADUNEK';
  player.info = `${label}${Number.isFinite(ctx.abortAt) ? ' (przerwany)' : ''} · na pokładzie ${st.onboard}/${player.plan.N} · drony ${st.droneCount} · ${deckSummary(player.deck)}`;
  // Koniec: drony w gnieździe, plac pusty.
  if (!st.busy && t > ctx.window.start + 1) {
    if (ctx.mode === CARGO_MODE.UNLOAD) {
      const left = st.onboard;
      player.cargo = left ? scaleCargo(ctx.cargo, left / Math.max(1, player.plan.N)) : {};
    }
    const unloaded = ctx.mode === CARGO_MODE.UNLOAD && !Number.isFinite(ctx.abortAt);
    player.ctx = null;
    if (d.state === 'DOCKED' && unloaded) startPlayerTransfer(T, CARGO_MODE.LOAD);
    else if (d.state !== 'DOCKED') { player.dockedAt = -1; player.phase = 'idle'; }
    else player.phase = 'done';
  }
}
function scaleCargo(cargo, k) {
  const out = {};
  for (const [id, m] of Object.entries(cargo)) out[id] = m * k;
  return out;
}
function deckSummary(deck) {
  if (!deck) return '—';
  const counts = new Map();
  for (const r of deck) if (r >= 0) counts.set(r, (counts.get(r) || 0) + 1);
  if (!counts.size) return 'pusta';
  return [...counts].map(([r, c]) => `${RESOURCES[cargoResourceKey(r)]?.short || r}×${c}`).join(' ');
}

// ---------------------------------------------------------------------------
// Kamery
let viewW = 1;
let viewH = 1;
function onResize() {
  // ≥ 1 px: okno 0 × 0 (karta w tle) to w WebGPU pusty cel głębi i łańcucha wymiany
  viewW = Math.max(1, window.innerWidth);
  viewH = Math.max(1, window.innerHeight);
  const q = HALO_QUALITY[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio);
  post.configure({ msaa: q.msaa, bloomResolution: q.bloomScale });
  renderer.setSize(viewW, viewH, false);
  const pr = renderer.getPixelRatio();
  post.resize(Math.max(1, Math.floor(viewW * pr)), Math.max(1, Math.floor(viewH * pr)));
}
window.addEventListener('resize', onResize);
onResize();

const gameCam = { x: 0, y: 0, zoom: 1 };
const camPersp = new THREE.PerspectiveCamera(35, 1, 100, 500000);
const camOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
const cineCam = new THREE.PerspectiveCamera(50, 1, 2, 200000);
cineCam.up.set(0, 0, 1);
const cine = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 };
let mode = 'game';
let cameraHeight = 1000;
function syncGameCameras() {
  gameCam.zoom = THREE.MathUtils.clamp(gameCam.zoom, 0.05, 4);
  const zoom = gameCam.zoom;
  const halfW = (viewW / 2) / zoom;
  const halfH = (viewH / 2) / zoom;
  camOrtho.left = -halfW; camOrtho.right = halfW; camOrtho.top = halfH; camOrtho.bottom = -halfH;
  camOrtho.updateProjectionMatrix();
  const camX = gameCam.x;
  const camY = -gameCam.y;
  camOrtho.position.set(camX, camY, 150000);
  camOrtho.lookAt(camX, camY, 0);
  camOrtho.updateMatrixWorld();
  camPersp.fov = 35;
  camPersp.aspect = viewW / viewH;
  camPersp.near = 100;
  camPersp.far = 500000;
  camPersp.updateProjectionMatrix();
  const h = computeGameCameraHeight(zoom, viewH);
  camPersp.position.set(camX, camY, h);
  camPersp.up.set(0, 1, 0);
  camPersp.lookAt(camX, camY, 0);
  camPersp.updateMatrixWorld();
  gameBg.update(camX, camY);
  return h;
}
function syncCine() {
  cineCam.position.copy(cine.pos);
  cineCam.up.set(0, 0, 1);
  cineCam.lookAt(cine.target);
  const d = cine.pos.distanceTo(cine.target);
  cineCam.near = THREE.MathUtils.clamp(d * 0.02, 1, 200);
  cineCam.far = 400000;
  cineCam.fov = cine.fov;
  cineCam.aspect = viewW / viewH;
  cineCam.updateProjectionMatrix();
  cineCam.updateMatrixWorld();
  sky.mesh.position.copy(cine.pos);
  sky.mesh.updateMatrixWorld();
}

// Widoki: środek na stanowisku (scena → gra: y = −y sceny).
function centerOn(label, zoom, du = 0, dv = 0) {
  const e = entryByLabel(label);
  if (!e) return false;
  const p = entryPose(e);
  const c = Math.cos(p.game.angle);
  const s = Math.sin(p.game.angle);
  mode = 'game';
  flight.setActive(false);
  gameCam.x = p.game.x + du * c - dv * s;
  gameCam.y = p.game.y + du * s + dv * c;
  gameCam.zoom = zoom;
  return true;
}
function cineOn(label, dist, elevDeg, azDeg, fov = 42) {
  const e = entryByLabel(label);
  if (!e) return false;
  const p = entryPose(e);
  mode = 'cine';
  flight.setActive(false);
  cine.target.set(p.sx, p.sy, -60);
  const az = (p.heading + azDeg * DEG);
  cine.pos.set(p.sx + Math.cos(az) * Math.cos(elevDeg * DEG) * dist, p.sy + Math.sin(az) * Math.cos(elevDeg * DEG) * dist, Math.sin(elevDeg * DEG) * dist);
  cine.fov = fov;
  return true;
}
// Galeria: wszystkie surowce w kontenerach na wolnym polu Z02-L02 (rzędy wg
// rodziny), pod nimi drony w zawisie — do oceny wyglądu z bliska.
const GALLERY_BERTH = 'Z02-L02';
const gallery = (() => {
  const e = entryByLabel(GALLERY_BERTH);
  if (!e) return null;
  const ids = Object.keys(RESOURCES);
  const fam = (id) => (RESOURCES[id].form !== 'solid' ? 1 : (RESOURCES[id].unit === 't' && RESOURCES[id].value < 40 ? 2 : 0));
  ids.sort((a, b) => fam(a) - fam(b) || ids.indexOf(a) - ids.indexOf(b));
  const lay = CARGO_HOLD_LAYOUTS.container_ship;
  const plan = { unit: null, lay };
  return { e, ids, plan, pose: entryPose(e).game };
})();
let showGallery = false;
function pushGallery(T) {
  if (!gallery || !showGallery) return;
  const unit = { L: 22, W: 13.5, H: 11.5 };
  const grid = 1 + 8 + 64;
  const cols = 8;
  gallery.ids.forEach((id, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const u = (c - (cols - 1) / 2) * unit.L * 1.45;
    const v = (r - 2) * unit.W * 2.1;
    const ri = Object.keys(RESOURCES).indexOf(id);
    CargoContainers3D.pushBerthContainer(gallery.pose, u, v, -114.5, 0, unit, grid, ri, cargoHash01(77, i, 5), -1e9, 1, 'yard');
  });
  // Moduły ciężkich kadłubów (podsiatka 2 × 3, dwa piętra) i drony w zawisie.
  const mod = { L: 54, W: 39, H: 22 };
  ['hull_plate', 'iron_ore', 'helium3'].forEach((id, i) => {
    const ri = Object.keys(RESOURCES).indexOf(id);
    CargoContainers3D.pushBerthContainer(gallery.pose, (i - 1) * 75, 150, -114.5, 0, mod, 2 + 8 * 3 + 64 * 2, ri, cargoHash01(78, i, 5), -1e9, 1, 'yard');
  });
  const d = gallery.drone || (gallery.drone = new Float32Array(16));
  for (let i = 0; i < 3; i++) {
    d.fill(0);
    d[0] = (i - 1) * 60; d[1] = -150; d[2] = -60 + i * 30; d[3] = 0.2 * i; d[4] = 1; d[7] = 0.6; d[8] = 1; d[11] = -1e9; d[14] = 0.3 * i;
    CargoDrones3D.pushDrone(gallery.pose, d, 0, { L: unit.L * 1.08 + 1.5, W: unit.W * 1.08 + 1.5, H: 0.42 * unit.W + 1 }, T);
    const ri = Object.keys(RESOURCES).indexOf(['chips', 'methane', 'ice'][i]);
    CargoContainers3D.pushBerthContainer(gallery.pose, d[0], d[1], d[2] - unit.H, d[3], unit, grid, ri, cargoHash01(79, i, 5), -1e9, 1, 'loose');
  }
}
const VIEWS = [
  { key: '1', name: 'Kontenerowiec — rozładunek', apply: () => centerOn('Z02-M01', 1.25, -40, 90) },
  { key: '2', name: 'Grzebień zatoki (M i L)', apply: () => centerOn('Z02-M02', 0.42, -150, 0) },
  { key: '3', name: 'Pas MEGA — megafrachtowiec', apply: () => centerOn('Z02-MG1', 0.2, 0, 350) },
  { key: '4', name: 'Plac i drony z bliska', apply: () => centerOn('Z02-L01', 1.9, 60, 260) },
  { key: '5', name: 'Prom i ciężki frachtowiec', apply: () => centerOn('Z02-S01', 0.9, 0, 0) },
  { key: '6', name: 'Kino — grzebień z ukosa', apply: () => cineOn('Z02-M02', 1500, 32, 200, 40) },
  { key: '7', name: 'Galeria: 37 surowców, moduły, drony', apply: () => { showGallery = true; centerOn(GALLERY_BERTH, 2.4, 0, 0); } }
];
let viewIndex = 0;
function applyView(i) {
  viewIndex = Math.max(0, Math.min(VIEWS.length - 1, i));
  showGallery = false;
  VIEWS[viewIndex].apply();
  for (const [j, b] of viewButtons.entries()) b.classList.toggle('on', j === viewIndex && mode !== 'flight');
}

// ---------------------------------------------------------------------------
// UI
const viewButtons = VIEWS.map((v, i) => {
  const b = document.createElement('button');
  b.textContent = v.key;
  b.title = v.name;
  b.addEventListener('click', () => applyView(i));
  $('views').appendChild(b);
  return b;
});
const clock = { T: Number(params.get('t')) || 20, speed: 1, paused: false };
const SPEEDS = [['pauza', 0], ['1×', 1], ['3×', 3], ['10×', 10]];
const speedButtons = SPEEDS.map(([label, s]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => setSpeed(s));
  $('speeds').appendChild(b);
  return b;
});
function setSpeed(s) {
  clock.speed = s;
  speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i][1] === s));
}
setSpeed(1);
const TOGGLES = [
  ['kontenery', () => CARGO3D_TUNE.drawContainers, (v) => { CARGO3D_TUNE.drawContainers = v; }],
  ['cienie', () => CARGO3D_TUNE.drawShadows, (v) => { CARGO3D_TUNE.drawShadows = v; }],
  ['drony', () => CARGO_DRONE_TUNE.enabled, (v) => { CARGO_DRONE_TUNE.enabled = v; }],
  ['światła dronów', () => CARGO_DRONE_TUNE.drawLights, (v) => { CARGO_DRONE_TUNE.drawLights = v; }],
  ['statki', () => view.ships, (v) => { view.ships = v; }],
  ['stary sprite (maska)', () => view.deckMode === 'painted', (v) => setDeckMode(v ? 'painted' : 'empty')]
];
for (const [label, get, set] of TOGGLES) {
  const l = document.createElement('label');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = get();
  c.addEventListener('change', () => set(c.checked));
  l.append(c, label);
  $('toggles').appendChild(l);
}
function setDeckMode(m) {
  view.deckMode = m === 'painted' ? 'painted' : 'empty';
  for (const n of npcs) n.sprite.material.uniforms.uMap.value = shipTexture(view.deckMode === 'painted' ? n.lay.sprite.painted : n.lay.sprite.empty);
  const lay = CARGO_HOLD_LAYOUTS[player.hullId];
  if (player.sprite && lay) player.sprite.material.uniforms.uMap.value = shipTexture(view.deckMode === 'painted' ? lay.sprite.painted : lay.sprite.empty);
}
function setFlight(on) {
  if (on) {
    mode = 'flight';
    flight.setActive(true);
    gameCam.zoom = Math.max(gameCam.zoom, 0.6);
  } else {
    mode = 'game';
    flight.setActive(false);
  }
  for (const b of viewButtons) b.classList.remove('on');
}
$('fly').addEventListener('click', () => setFlight(mode !== 'flight'));

// Sterowanie
const keys = new Set();
let dragging = 0;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { dragging = e.button === 2 ? 2 : 1; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (mode === 'game') { gameCam.x -= dx / gameCam.zoom; gameCam.y -= dy / gameCam.zoom; return; }
  if (mode === 'cine') {
    const off = cine.pos.clone().sub(cine.target);
    off.applyAxisAngle(new THREE.Vector3(0, 0, 1), -dx * 0.004);
    const right = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0, 0, 1)).normalize();
    const off2 = off.clone().applyAxisAngle(right, dy * 0.004);
    if (Math.abs(off2.clone().normalize().z) < 0.98) off.copy(off2);
    cine.pos.copy(cine.target).add(off);
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'cine') {
    const off = cine.pos.clone().sub(cine.target).multiplyScalar(Math.exp(e.deltaY * 0.001));
    cine.pos.copy(cine.target).add(off);
  } else {
    gameCam.zoom = THREE.MathUtils.clamp(gameCam.zoom * Math.exp(-e.deltaY * 0.0012), 0.05, 4);
  }
}, { passive: false });
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (/^Digit[1-7]$/.test(e.code) && mode !== 'flight') applyView(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyL' && !e.repeat) setFlight(mode !== 'flight');
  if (e.code === 'KeyE' && !e.repeat && mode === 'flight') flight.action();
  if (e.code === 'KeyV' && !e.repeat && mode === 'flight') {
    const order = ['container_ship', 'long_haul_freighter', 'inter_station_shuttle', 'heavy_freighter', 'megafreighter'];
    const next = order[(order.indexOf(player.hullId) + 1) % order.length];
    setPlayerHull(next, flight.docking.state === 'FREE' ? 'free' : 'docked');
  }
  if (e.code === 'Space' && mode !== 'flight') setSpeed(clock.speed ? 0 : 1);
  if (mode === 'flight' && ['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
function updateControls(dt) {
  if (mode !== 'game') return;
  const sp = 900 / gameCam.zoom * dt * (keys.has('ShiftLeft') ? 4 : 1);
  if (keys.has('KeyW')) gameCam.y -= sp;
  if (keys.has('KeyS')) gameCam.y += sp;
  if (keys.has('KeyA')) gameCam.x -= sp;
  if (keys.has('KeyD')) gameCam.x += sp;
}

// ---------------------------------------------------------------------------
// Klatka
const bayZ02 = registry.bays.find((o) => o.layout.id === 'Z-02' && o.complex === 0) || null;
const cutZ02 = (() => {
  if (!bayZ02) return null;
  const f = bayZ02.frame;
  const l = bayZ02.layout;
  const z0 = f.floorZ - 100;
  const z1 = l.openZ + 200;
  const c = k7HubToWorld(f, 0, (z0 + z1) * 0.5, {});
  return { x: c.x, y: c.y, angle: Math.atan2(f.ty, f.tx), a: l.halfWidth + 1000, b: (z1 - z0) * 0.5, strength: 1 };
})();

let lastFrame = performance.now();
let fps = 60;
let frameMs = 16;
const lastStats = { calls: 0, triangles: 0 };

function prepareFrame(dt) {
  const T = clock.T;
  updateControls(dt);
  flight.update(dt, mode === 'flight' ? keys : null);
  if (mode === 'flight') flight.followCamera(gameCam, dt);
  // Wycięcie górnej ściany nad Z-02, gdy statek gracza nie wycina własnego.
  if (cutZ02 && ring.setCutaway && (mode !== 'flight' || (flight.bayIndex < 0 && flight.hallIndex < 0))) ring.setCutaway(0, cutZ02);
  updatePlayer(T);
  let camera;
  if (mode === 'cine') { syncCine(); camera = cineCam; } else { cameraHeight = syncGameCameras(); camera = camPersp; }
  ring.update(dt, { camera, viewportHeight: renderer.domElement.height, gameView: mode !== 'cine' });
  earth.update(dt, { planetCenterZ: ring.layout.planetCenterZ, sunAzimuth: sun.azimuth * DEG, sunDir });

  // Statek gracza (sprite) — poza z trybu lotu.
  const sw = flight.shipWorld;
  if (player.sprite) {
    player.sprite.visible = view.ships;
    placeSprite(player.sprite, sw.x, sw.y, sw.heading);
  }
  for (const n of npcs) n.sprite.visible = view.ships;

  // Kontenery i drony tej klatki (dzień portu: cień planety nad zatoką).
  const portSun = { dir: [sunDir.x, sunDir.y, sunDir.z], daylight: npcs.length ? npcs[0].daylight : 1 };
  if (mode === 'cine') {
    const d = cine.pos.distanceTo(cine.target);
    CargoContainers3D.begin({
      camera: { x: cine.pos.x, y: -cine.pos.y, zoom: 1 },
      origin: { x: cine.pos.x, y: cine.pos.y },
      perspective: true,
      pxPerUnit: (viewH * 0.5) / Math.tan(cine.fov * 0.5 * DEG) / Math.max(1, d),
      sun: gameSun(), portSun, time: T
    });
  } else {
    CargoContainers3D.begin({
      camera: gameCam,
      cameraHeight,
      pxPerUnit: gameCam.zoom,
      viewHalfW: (viewW / 2) / gameCam.zoom,
      viewHalfH: (viewH / 2) / gameCam.zoom,
      sun: gameSun(), portSun, time: T
    });
  }
  CargoDrones3D.begin({ camera3: mode === 'cine' ? cineCam : camPersp });
  pushGallery(T);
  for (const n of npcs) {
    const st = npcAt(n, T);
    if (!view.ships) continue;
    pushCargoScene(st, n.plan, n.pose.game, { deckMode: view.deckMode, time: T });
    n.info = `${n.spec.label} ${n.plan.mode === CARGO_MODE.UNLOAD ? 'rozł.' : 'zał.'} ${st.onboard}/${n.plan.N} d${st.droneCount}`;
  }
  // Gracz: w porcie — scena przeładunku (pokład jedzie ze statkiem), w locie — sam pokład.
  const shipPose = { x: sw.x, y: -sw.y, angle: -sw.heading };
  if (view.ships) {
    if (player.ctx && player.plan && player.berthPose) {
      pushCargoScene(player.state, player.plan, player.berthPose, { shipPose, deckMode: view.deckMode, time: T });
    } else if (player.deck && CARGO_HOLD_LAYOUTS[player.hullId]) {
      CargoContainers3D.pushShipDeck(shipPose, player.hullId, player.deck, 5000 + player.seq * 13, { deckMode: view.deckMode });
    }
  }
  CargoContainers3D.end();
  CargoDrones3D.end();
}

function renderScene() {
  post.begin();
  if (mode !== 'cine') {
    camPersp.layers.set(DEMO_LAYERS.gameSky);
    camPersp.layers.enable(DEMO_LAYERS.bg);
    renderer.render(scene, camPersp);
    renderer.clearDepth();
    camOrtho.layers.set(DEMO_LAYERS.ringPlanet);
    renderer.render(scene, camOrtho);
    renderer.clearDepth();
    camOrtho.layers.set(DEMO_LAYERS.world);
    renderer.render(scene, camOrtho);
    renderer.clearDepth();
    camPersp.layers.set(DEMO_LAYERS.fg);
    renderer.render(scene, camPersp);
  } else {
    cineCam.layers.set(DEMO_LAYERS.cineSky);
    cineCam.layers.enable(DEMO_LAYERS.cinePlanet);
    cineCam.layers.enable(DEMO_LAYERS.bg);
    cineCam.layers.enable(DEMO_LAYERS.fg);
    cineCam.layers.enable(DEMO_LAYERS.world);
    renderer.render(scene, cineCam);
  }
}

function step(dt) {
  clock.T += dt * clock.speed;
  renderer.info.reset();
  prepareFrame(dt);
  renderScene();
  lastStats.calls = renderer.info.render.drawCalls;
  lastStats.triangles = renderer.info.render.triangles;
  post.finish(dt);
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const t0 = performance.now();
  step(dt);
  frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-3)) * 0.08;
  updateHud();
  flight.hud();
  const cargoEl = $('k7-cargo');
  if (cargoEl) cargoEl.textContent = player.info;
  if (!shotMode) requestAnimationFrame(frame);
}

let hudTimer = 0;
function updateHud() {
  const now = performance.now();
  if (now - hudTimer < 250) return;
  hudTimer = now;
  const C = CargoContainers3D.stats;
  const D = CargoDrones3D.stats;
  const lines = [
    `<b>FPS</b> ${fps.toFixed(0).padStart(4)}   <b>ms</b> ${frameMs.toFixed(1)}   <b>draw</b> ${lastStats.calls}`,
    `<b>kontenery</b> pokład ${C.deck} · niesione ${C.loose} · plac ${C.yard}`,
    `<b>cienie</b> kadłub ${C.hullShadows} · pokład ${C.deckShadows}`,
    `<b>drony</b> ${D.drones} · światła ${D.lights} · <b>draw Z5</b> ${C.drawCalls + D.drawCalls}`,
    `<b>CPU Z5</b> ${C.cpuMs.toFixed(2)} ms   <b>zoom</b> ${gameCam.zoom.toFixed(2)}`,
    `<b>czas</b> ${clock.T.toFixed(1)} s (${clock.speed ? clock.speed + '×' : 'pauza'})  ${VIEWS[viewIndex].name}`,
    ...npcs.map((n) => n.info)
  ];
  $('hud').innerHTML = lines.join('\n');
  $('loading').style.display = ring.mapsReady ? 'none' : 'block';
  $('clock').textContent = `pętla statku: rozładunek ${PHASE_A.toFixed(0)} s + załadunek ${PHASE_B.toFixed(0)} s`;
}

// ---------------------------------------------------------------------------
// API zrzutów (dema/kontenery-shots.js)
window.__cargo = {
  ready: false,
  ring,
  get stats() {
    return { ...lastStats, containers: { ...CargoContainers3D.stats }, drones: { ...CargoDrones3D.stats }, errors: shaderErrors.slice(), placeholders: getPlaceholderStats().builds, mode, zoom: gameCam.zoom, T: clock.T };
  },
  view(i) { applyView(i - 1); return VIEWS[viewIndex].name; },
  center(label, zoom, du = 0, dv = 0) { return centerOn(label, zoom, du, dv); },
  cine(label, dist, elev, az, fov) { return cineOn(label, dist, elev, az, fov); },
  setTime(T) { clock.T = T; },
  setSpeed(s) { setSpeed(s); },
  setDeckMode(m) { setDeckMode(m); },
  setSun(az, el = 49) { sun.azimuth = az; sun.elevation = el; applySun(); },
  tune: { containers: CARGO3D_TUNE, drones: CARGO_DRONE_TUNE },
  npcs: () => npcs.map((n) => ({ label: n.spec.label, hull: n.spec.hull, mode: n.plan?.mode, N: n.plan?.N, D: n.plan?.D, t: n.tBerth, onboard: n.state.onboard, carried: n.state.carriedCount, yard: n.state.yardCount, drones: n.state.droneCount })),
  flight: {
    game: flight,
    player,
    fly(on = true) { setFlight(on); },
    hull(id, m = 'free') { setPlayerHull(id, m); return player.hullId; },
    berth(label) { return flight.jumpToBerth(label); },
    place(label) { return flight.placeOnBerth(label); },
    dock() { return flight.action(); },
    simulate(seconds, input = null) {
      const n = Math.round(seconds * 60);
      const ks = new Set(input || []);
      for (let i = 0; i < n; i++) { clock.T += 1 / 60; flight.update(1 / 60, ks); updatePlayer(clock.T); }
      return { state: flight.docking.state, info: player.info };
    }
  },
  renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) step(dt);
    return { ...lastStats };
  },
  async waitMaps() {
    await ring.ready;
    return new Promise((resolve) => {
      const tick = () => {
        const texReady = [...texCache.values()].every((t) => t.image && t.image.complete !== false && (t.image.width || t.image.naturalWidth));
        if (ring.mapsReady && texReady) resolve(true);
        else { ring.update(1 / 60, { camera: camPersp }); setTimeout(tick, 16); }
      };
      tick();
    });
  },
  // Kontrola paralaksy: punkt (dx, dy od środka kadru w scenie, wysokość z)
  // rzutowany kamerą persp passu BG i przez przeliczenie paralaksy w passie
  // ortho (jak shader cargoContainers3D) — piksele obu mają się zgadzać.
  parallaxCheck(dx, dy, z) {
    const cx = gameCam.x;
    const cy = -gameCam.y;
    const x = cx + dx;
    const y = cy + dy;
    const persp = new THREE.Vector3(x, y, z).project(camPersp);
    const k = z < 0 ? cameraHeight / (cameraHeight - z) : 1;
    const ortho = new THREE.Vector3(cx + (x - cx) * k, cy + (y - cy) * k, z).project(camOrtho);
    const px = (v) => [(v.x * 0.5 + 0.5) * viewW, (0.5 - v.y * 0.5) * viewH];
    return { persp: px(persp), ortho: px(ortho) };
  }
};

// ---------------------------------------------------------------------------
// Start
applyView(Math.max(1, Math.min(VIEWS.length, Number(params.get('view')) || 1)) - 1);
if (params.has('zoom')) gameCam.zoom = Number(params.get('zoom'));
if (shotMode) {
  setSpeed(0);
  window.__cargo.waitMaps().then(() => {
    window.__cargo.renderFrames(3);
    window.__cargo.ready = true;
  });
} else {
  window.__cargo.ready = true;
  requestAnimationFrame(frame);
}
