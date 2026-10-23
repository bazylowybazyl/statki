// src/3d/shipProxyBatch3D.js
//
// Statki-proxy z bańki ruchu v2 (docs/PLAN-ruch-v2-w-grze.md § 3.1, zadanie Z4):
// lekki render kadłubów POZA npcs[] — bez kadłuba belkowego, fizyki i AI.
//
//  - Jedna siatka (Mesh + InstancedBufferGeometry) na teksturę kadłuba (sprite z src/data/trafficHulls.js),
//    warstwa 0, pass ortho jak kadłuby (renderOrder 10). Tekstura to TEN SAM obiekt,
//    co kadłub pełnego NPC z tego obrazka (acquireHullVisualTexture, hexShips3D) —
//    awans proxy → NPC nie ładuje niczego drugi raz. Pusty rodzaj: visible = false
//    (zero draw calli), dłużej nieużywany odpina się od sceny (obchód grafu).
//  - Precyzja float32 (AGENTS.md): początek przy kamerze w mesh.position
//    (sceneOriginNearCamera, wzór Bridge3D._setOrigin), instancje względem niego
//    liczone w double, węzeł modelViewMatrix three (highPrecision).
//  - Materiał w TSL (shipProxyBatch3D.tsl.js): graf raz na moduł, rodzaj = lekki
//    ShipProxyNodeMaterial z teksturą w `uniforms.uSprite.value`.
//  - Światło jak kadłuby (lustro rdzenia hullFragmentNode z hexShips3D.tsl.js): poduszkowa normalna,
//    słońce z RenderWorld.sun (z = 600), strojenie świateł kadłubów (getHullLightTuning), maska cieni
//    Core3D (sunVisibility / sunFill), mrok pola i glow niebieskich elementów.
//    Bez lakieru, świateł statku, żaru i cienia SDF — proxy jest małe i daleko.
//  - Poza interpolowana między krokami bańki: prev + (bieżąca − prev) · alpha
//    (jak actorRenderPose w materializedFlight.js).
//  - Dysze MAIN: widok encji na proxy (`engineEntities`) z `visual.mainThrusters`
//    i `visual.engineFx` — EngineVfxSystem rysuje je z pul MAIN jak dysze NPC.
//    Z budżetem (pula strug jest wspólna dla całej floty) i bez plazmy warpa.
//
// Kolejność w klatce (Z13, index.html → render, PRZED Core3D.render):
//   ShipProxyBatch3D.update(getActorList(bańka), alpha, cam);
//   encjeHex.push(...ShipProxyBatch3D.engineEntities);   // → updateHexShips3D
// Obrazki: setImageResolver((hullId, url) => loadHullSprite(url)?.image) — wspólny
// cache obrazków z index.html. Klik na proxy: pickAt(x, y) → awans do NPC.
// Instancja = 16 liczb w buforze z przeplotem (`kind.buffer`, układ dawnej instanceMatrix):
// [0..1] oś x × szerokość, [4..5] oś y × wysokość, [8..10] (cos, sin, krycie),
// [12..13] środek względem początku.

import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { zbierzZakres } from './zakresyWysylki.js';
import { PROXY_SHARED, PROXY_INSTANCE_STRIDE, ShipProxyNodeMaterial, createProxyGeometry } from './shipProxyBatch3D.tsl.js';
import { acquireHullVisualTexture, releaseHullVisualTexture, getHullLightTuning } from './hexShips3D.js';
import { TRAFFIC_HULLS, resolveTrafficHullId, trafficHullRenderSize } from '../data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../data/hardpointEditorDefaults.js';
import { buildEntityEngineFx } from '../data/engineFx.js';
import { RenderWorld } from '../render/renderWorld.js';
import { loadImageBitmap, createCanvas2D } from './canvas2d.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';
import { cameraRoll, rolledHalfExtents } from './viewRoll.js';

const _rollHalf = { hw: 0, hh: 0 };

const INITIAL_CAPACITY = 32;
const MAX_CAPACITY = 1024;
const MAX_PICK = 2048;
// Poniżej tylu pikseli (dłuższy bok) kadłub nie ma sensu — sub-pikselowy kwad miga.
const MIN_DRAW_PX = 0.75;
const DRAW_MARGIN_PX = 96;
// Rodzaj bez instancji tyle klatek → odpięty od sceny (updateMatrixWorld chodzi
// po wszystkich dzieciach, także niewidocznych).
const IDLE_DETACH_FRAMES = 600;
// Pula strug MAIN (MainExhaust3D, 4096 kwadów, ~12 na dyszę) jest wspólna z graczem
// i NPC — proxy dostają dysze najwyżej na tylu statkach, od największych na ekranie.
const ENGINE_PROXY_BUDGET = 48;
// Jak MainExhaust3D: dysza poniżej 0,35 px nie rysuje strug.
const ENGINE_MIN_PX = 0.35;
// Tyle trzeba lecieć, żeby dysze w ogóle pracowały (postój przy stanowisku = cisza).
const ENGINE_MIN_SPEED = 0.5;
// Warp bańki (DRIVE_MODES) — powyżej przelotu konwencjonalnego dysze na dopalaczu.
const WARP_BOOST_SPEED = 1200;

// Wspólne węzły uniformów (grupa renderu) — jeden zapis na klatkę dla wszystkich rodzajów.
const lightUniforms = PROXY_SHARED;

let quadGeometry = null;
const kinds = new Map();          // url sprite'a → rodzaj (mesh + tekstura)
const kindList = [];
const hullInfos = new Map();      // unitClass / hullId → dane kadłuba
const ownImages = new Map();      // url → ImageBitmap | null (w drodze) — gdy gra nie podała resolvera
const engineRecords = new Map();  // klucz proxy → { view, frame }
let imageResolver = null;
let engineLayoutResolver = null;
/** (ref encji) → { x: u0, y: v0, z: u1, w: v1 } otwartego luku w uv sprite'a albo null (E12, przeładunek). */
let bayCutResolver = null;
let frameNo = 0;

const origin = { x: 0, y: 0 };
const frame = {
  active: false,
  free: false,
  cull: true,
  camX: 0,
  camY: 0,
  zoom: 1,
  halfW: 0,
  halfH: 0,
  margin: 0,
  engines: true,
  t0: 0
};

// Instancje tej klatki (do pickAt): środek w świecie gry, promień, obiekt.
const pickX = new Float64Array(MAX_PICK);
const pickY = new Float64Array(MAX_PICK);
const pickR = new Float32Array(MAX_PICK);
const pickRef = new Array(MAX_PICK).fill(null);
let pickCount = 0;

// Kandydaci na dysze tej klatki (budżet): widok encji i jego promień dyszy w px.
const engineCand = [];
const engineCandPx = new Float32Array(MAX_PICK);
const engineCandSorted = new Float32Array(MAX_PICK);
let engineCandCount = 0;

const stats = {
  pushed: 0,
  drawn: 0,
  culled: 0,
  waitingImage: 0,
  kinds: 0,
  drawCalls: 0,
  engines: 0,
  nozzles: 0,
  cpuMs: 0,
  lastMs: 0
};

function wrapPi(a) {
  if (a > Math.PI || a < -Math.PI) a -= Math.PI * 2 * Math.round(a / (Math.PI * 2));
  return a;
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

function imageReady(img) {
  if (!img) return false;
  if (img.complete === false) return false;
  return (Number(img.naturalWidth ?? img.width) || 0) > 0 && (Number(img.height) || 0) > 0;
}

// Obraz przez fetch + createImageBitmap (canvas2d.js) — działa na stronie i w workerze renderu (bez DOM).
// Do czasu wczytania rodzaj czeka (stats.waitingImage), błąd zostawia rodzaj pusty z jednym ostrzeżeniem.
function defaultImage(url) {
  if (ownImages.has(url)) return ownImages.get(url);
  ownImages.set(url, null);
  loadImageBitmap(url).then((bitmap) => { ownImages.set(url, bitmap); }, (err) => {
    console.warn('[ShipProxyBatch3D] sprite', url, err?.message || err);
  });
  return null;
}

// ---------------------------------------------------------------- kadłuby

function hullInfoFor(key) {
  let info = hullInfos.get(key);
  if (info !== undefined) return info;
  const hullId = resolveTrafficHullId(key);
  const def = TRAFFIC_HULLS[hullId];
  const size = def ? trafficHullRenderSize(hullId) : null;
  info = def && size ? {
    hullId,
    def,
    url: def.sprite,
    w: size.w,
    h: size.h,
    radius: Math.hypot(size.w, size.h) * 0.5,
    kind: null,
    engine: undefined
  } : null;
  hullInfos.set(key, info);
  return info;
}

function resolveKind(info) {
  if (info.kind) return info.kind;
  let kind = kinds.get(info.url);
  if (!kind) {
    const img = imageResolver ? imageResolver(info.hullId, info.url) : defaultImage(info.url);
    if (!imageReady(img)) return null;
    kind = createKind(info.url, img);
    if (!kind) return null;
  }
  info.kind = kind;
  return kind;
}

function forwardFromDeg(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// Dysze MAIN kadłuba w układzie lokalnym encji (piksele PNG × skala renderu),
// jak npcHardpointRuntime.applyLayoutToNpc. Liczone raz na kadłub.
function buildEngineLayout(info) {
  if (engineLayoutResolver) {
    const custom = engineLayoutResolver(info.hullId, info);
    if (custom && Array.isArray(custom.mainThrusters) && custom.mainThrusters.length) return custom;
  }
  const def = info.def;
  const sx = info.w / def.png[0];
  const sy = info.h / def.png[1];
  let markers = null;
  let fxKey = info.hullId;
  let stored = null;
  let dRef = 0;
  if (def.editorKey) {
    const cfg = SHIP_EDITOR_DEFAULTS?.ships?.[def.editorKey];
    const raw = Array.isArray(cfg?.engines?.main) ? cfg.engines.main : [];
    markers = [];
    for (const m of raw) {
      const x = Number(m?.x);
      const y = Number(m?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const deg = Number.isFinite(Number(m.nozzleDeg)) ? Number(m.nozzleDeg)
        : Number.isFinite(Number(m.deg)) ? Number(m.deg) : 90;
      markers.push([x + (Number(m.offsetX) || 0), y + (Number(m.offsetY) || 0), 0, deg]);
    }
    fxKey = def.editorKey;
    stored = cfg?.engineFx || null;
  } else if (Array.isArray(def.main)) {
    markers = [];
    for (const n of def.main) {
      markers.push([n[0], n[1], n[2], 90]);
      if (n[2] > dRef) dRef = n[2];
    }
    stored = { mainNozzle: dRef, ...(def.fx || {}) };
  }
  if (!markers || !markers.length) return null;
  const mainThrusters = markers.map(([x, y, d, deg]) => ({
    offset: { x: x * sx, y: y * sy },
    forward: forwardFromDeg(deg),
    mount: 'rear_center',
    baseDeg: deg,
    nozzleDeg: deg,
    gimbalMinDeg: -45,
    gimbalMaxDeg: 45,
    // Dysze jednego kadłuba różnej średnicy: promień z engineFx × vfxScale.
    vfxScale: d > 0 && dRef > 0 ? d / dRef : 1
  }));
  return { mainThrusters, engineFx: buildEntityEngineFx(fxKey, stored, (sx + sy) * 0.5) };
}

function engineLayoutFor(info) {
  if (info.engine === undefined) info.engine = buildEngineLayout(info);
  return info.engine;
}

// ---------------------------------------------------------------- rodzaje

function ensureQuad() {
  if (!quadGeometry) quadGeometry = new THREE.PlaneGeometry(1, 1);
  return quadGeometry;
}

// Mesh + InstancedBufferGeometry, nie InstancedMesh: uuid InstancedMesh wchodzi do klucza
// programu (osobny NodeBuilder na rodzaj). Bez DynamicDrawUsage — wysyłka zakresem (commitMatrices).
function makeMesh(kind, capacity) {
  const { geometry, buffer } = createProxyGeometry(ensureQuad(), capacity);
  const mesh = new THREE.Mesh(geometry, kind.material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = `shipProxy:${kind.url.split('/').pop()}`;
  mesh.userData.shipProxyBuffer = buffer;
  kind.buffer = buffer;
  return mesh;
}

function createKind(url, image) {
  if (!Core3D.isInitialized || !Core3D.scene) return null;
  const texture = acquireHullVisualTexture(image);
  if (!texture) return null;
  const material = new ShipProxyNodeMaterial(texture);
  const kind = {
    url,
    image,
    texture,
    material,
    mesh: null,
    buffer: null,
    capacity: INITIAL_CAPACITY,
    count: 0,
    attached: false,
    lastUsed: frameNo,
  };
  kind.mesh = makeMesh(kind, kind.capacity);
  kinds.set(url, kind);
  kindList.push(kind);
  prewarmKind(kind);
  return kind;
}

// Pipeline passa ortho w tle (compileAsync). Rodzaje dzielą graf i klucz programu, więc
// kompiluje się raz; bez tego pierwszy rysunek tworzyłby pipeline synchronicznie.
// compileAsync pomija niewidoczne — widoczność tylko na czas (synchronicznej) projekcji.
function prewarmKind(kind) {
  if (!Core3D.gpuReady || typeof Core3D.prewarmPass !== 'function') return;
  const mesh = kind.mesh;
  const wasVisible = mesh.visible;
  mesh.visible = true;
  try {
    Core3D.prewarmPass(mesh, 0);
  } finally {
    mesh.visible = wasVisible;
  }
}

// Rozgrzewka (E6): rodzaje dzielą graf i klucz programu, więc jedna siatka z teksturą zastępczą tego samego
// rodzaju (createManagedTexture z obrazu — jak sprite) kompiluje pipeline passa ortho dla wszystkich kadłubów
// na ekranie ładowania. Bez niej pierwszy statek ruchu w kadrze czekał na prewarmKind w trakcie gry.
let warmKind = null;
function warmupMeshes() {
  if (!Core3D.isInitialized || !Core3D.scene) return null;
  if (!warmKind) {
    const canvas = createCanvas2D(4, 4);
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 4, 4); }
    const texture = acquireHullVisualTexture(canvas);
    if (!texture) return null;
    warmKind = { url: 'rozgrzewka', image: canvas, texture, material: new ShipProxyNodeMaterial(texture), mesh: null, buffer: null };
    warmKind.mesh = makeMesh(warmKind, 2);
  }
  return [warmKind.mesh];
}
Core3D.warmup?.add?.({ name: 'proxy statków ruchu', objects: warmupMeshes, phase: 'loading', variant: WARIANT_INSTANCJI });

// Pełny rodzaj: nowa siatka ×2 (rzadko — pojemność zostaje na zawsze).
function growKind(kind) {
  if (kind.capacity >= MAX_CAPACITY) return false;
  const capacity = Math.min(MAX_CAPACITY, kind.capacity * 2);
  const old = kind.mesh;
  const oldBuffer = kind.buffer;
  const mesh = makeMesh(kind, capacity);
  kind.buffer.array.set(oldBuffer.array.subarray(0, kind.count * PROXY_INSTANCE_STRIDE));
  if (old.parent) {
    old.parent.remove(old);
    Core3D.scene.add(mesh);
  }
  old.geometry.dispose();
  kind.mesh = mesh;
  kind.capacity = capacity;
  return true;
}

function commitMatrices(kind) {
  // Zakres zbierany (zakresyWysylki.js): siatka nierysowana w tej klatce nie zgubi zmiany.
  zbierzZakres(kind.buffer, 0, kind.count * PROXY_INSTANCE_STRIDE);
}

// ---------------------------------------------------------------- dysze

function engineRecordFor(key, info, layout) {
  let rec = engineRecords.get(key);
  if (!rec || rec.hullId !== info.hullId) {
    const view = {
      x: 0,
      y: 0,
      angle: 0,
      vx: 0,
      vy: 0,
      radius: info.radius,
      visual: { mainThrusters: layout.mainThrusters, engineFx: layout.engineFx, spriteScale: 1 },
      thrusterInput: { main: 0 },
      // Dopalacz MAIN zamiast plazmy warpa (resolveMainBoost w EngineVfxSystem):
      // pula WARP_PLUME_CAP zostaje dla gracza i pełnych NPC.
      __editorBoost: false,
      isTrafficProxy: true,
      dead: false
    };
    rec = { view, hullId: info.hullId, frame: frameNo };
    engineRecords.set(key, rec);
  }
  rec.frame = frameNo;
  return rec;
}

function considerEngines(key, info, x, y, angle, vx, vy, throttle, speed, warp) {
  if (!frame.engines || (speed < ENGINE_MIN_SPEED && throttle <= 0.01)) return;
  const layout = engineLayoutFor(info);
  if (!layout || engineCandCount >= MAX_PICK) return;
  const nozzlePx = (Number(layout.engineFx?.nozzleRadius) || info.w * 0.0188) * frame.zoom;
  if (!frame.free && nozzlePx < ENGINE_MIN_PX) return;
  const rec = engineRecordFor(key, info, layout);
  const view = rec.view;
  view.x = x;
  view.y = y;
  view.angle = angle;
  view.vx = vx;
  view.vy = vy;
  view.thrusterInput.main = throttle;
  view.__editorBoost = warp;
  engineCand[engineCandCount] = view;
  engineCandPx[engineCandCount] = frame.free ? 1 : nozzlePx;
  engineCandCount++;
}

// Budżet dysz: przy nadmiarze zostają największe na ekranie (próg z sortu typowanej
// tablicy — bez alokacji i komparatora).
function flushEngines(out) {
  out.length = 0;
  let minPx = -1;
  if (engineCandCount > ENGINE_PROXY_BUDGET) {
    const sorted = engineCandSorted.subarray(0, engineCandCount);
    sorted.set(engineCandPx.subarray(0, engineCandCount));
    sorted.sort();
    minPx = sorted[engineCandCount - ENGINE_PROXY_BUDGET];
  }
  let nozzles = 0;
  for (let i = 0; i < engineCandCount; i++) {
    if (engineCandPx[i] < minPx || out.length >= ENGINE_PROXY_BUDGET) continue;
    const view = engineCand[i];
    out.push(view);
    nozzles += view.visual.mainThrusters.length;
  }
  for (let i = 0; i < engineCandCount; i++) engineCand[i] = null;
  engineCandCount = 0;
  stats.engines = out.length;
  stats.nozzles = nozzles;
  // Widoki proxy, których nie było w tej klatce, odpadają (EngineVfxSystem wygasi
  // ich strugi, gdy znikną z listy encji).
  for (const [key, rec] of engineRecords) {
    if (rec.frame !== frameNo) engineRecords.delete(key);
  }
}

// ---------------------------------------------------------------- API

export const ShipProxyBatch3D = {
  /** Widoki encji z dyszami MAIN tej klatki — do listy encji updateHexShips3D. */
  engineEntities: [],
  stats,

  /**
   * `(hullId, url) → obraz | null` — skąd brać obrazki kadłubów. Gra podaje swój
   * cache (loadHullSprite w index.html), żeby proxy i pełny NPC miały jeden obraz,
   * a więc jedną teksturę. Bez resolvera moduł ładuje obrazki sam. Ustawić przed
   * pierwszym update — rodzaj zapamiętuje obraz, z którym powstał.
   */
  /**
   * Otwarte luki ładowni (E12, przeładunek w bańce — src/3d/cargo/portCargo3D.js): fn(ref encji) →
   * prostokąt otworu w uv sprite'a (x u0, y v0, z u1, w v1, skin — skóra w otworze 0…1 przy domykaniu wrót) albo null —
   * skóra proxy ma tam dziurę.
   */
  setBayCutResolver(fn) {
    bayCutResolver = typeof fn === 'function' ? fn : null;
  },

  setImageResolver(fn) {
    imageResolver = typeof fn === 'function' ? fn : null;
  },

  /**
   * `(hullId, info) → { mainThrusters, engineFx } | null` — układ dysz z edytora
   * gry (zapis użytkownika). Bez niego: trafficHulls.js i domyślne edytora.
   */
  setEngineLayoutResolver(fn) {
    engineLayoutResolver = typeof fn === 'function' ? fn : null;
    for (const info of hullInfos.values()) if (info) info.engine = undefined;
  },

  /**
   * Początek klatki: początek układu przy kamerze tej klatki i pudło widoku.
   * @param {object} camera kamera gry ({ x, y, zoom } albo free3d)
   * @param {object} [options]
   *   cull     false = bez przycinania do kadru (np. split-screen)
   *   engines  false = bez dysz
   *   sun      { x, y } zamiast RenderWorld.sun
   */
  begin(camera = Core3D.activeCam1, options = {}) {
    frame.t0 = performance.now();
    frameNo++;
    frame.active = true;
    sceneOriginNearCamera(origin, camera);
    frame.free = !!(camera && Core3D.isFreePerspectiveCamera(camera));
    frame.cull = options.cull !== false && !frame.free && !!camera;
    frame.engines = options.engines !== false;
    frame.zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
    frame.camX = Number(camera?.x) || 0;
    frame.camY = Number(camera?.y) || 0;
    const viewW = Number(Core3D.width) || Number(RenderWorld.viewWidth) || 1920;
    const viewH = Number(Core3D.height) || Number(RenderWorld.viewHeight) || 1080;
    // obrót kadru (hipercruise — viewRoll.js): pudło osi świata wokół obróconego kadru
    const rh = rolledHalfExtents(viewW * 0.5 / frame.zoom, viewH * 0.5 / frame.zoom, cameraRoll(camera), _rollHalf);
    frame.halfW = rh.hw;
    frame.halfH = rh.hh;
    frame.margin = DRAW_MARGIN_PX / frame.zoom;

    for (let k = 0; k < kindList.length; k++) kindList[k].count = 0;
    pickCount = 0;
    engineCandCount = 0;
    stats.pushed = 0;
    stats.drawn = 0;
    stats.culled = 0;
    stats.waitingImage = 0;

    const sun = options.sun || RenderWorld.sun;
    if (sun && Number.isFinite(Number(sun.x)) && Number.isFinite(Number(sun.y))) {
      lightUniforms.uSunRel.value.set(Number(sun.x) - origin.x, -Number(sun.y) - origin.y);
      lightUniforms.uHasSun.value = 1;
    } else {
      lightUniforms.uHasSun.value = 0;
    }
    const tune = getHullLightTuning();
    lightUniforms.uDayAmbient.value = clampNum(tune?.dayAmbient, 0, 1, 0.24);
    lightUniforms.uDayDiffuseMul.value = clampNum(tune?.dayDiffuseMul, 0, 3, 1.18);
    lightUniforms.uSpecularMul.value = clampNum(tune?.specularMul, 0, 1.5, 0.30);
  },

  /**
   * Encja bańki ruchu (materializedFlight: x, y, angle, prevX, prevY, prevAngle,
   * vx, vy, speed, throttle, mode, unitClass, courseId) albo obiekt o tym kształcie
   * z `hullId`. alpha: 0 = poza z początku ostatniego kroku bańki, 1 = bieżąca.
   */
  pushActor(actor, alpha = 1) {
    if (!actor) return false;
    const info = hullInfoFor(actor.hullId || actor.unitClass);
    if (!info) return false;
    let x = Number(actor.x);
    let y = Number(actor.y);
    let angle = Number(actor.angle) || 0;
    const t = alpha >= 1 ? 1 : alpha > 0 ? alpha : 0;
    const px = actor.prevX;
    const py = actor.prevY;
    if (t < 1 && Number.isFinite(px) && Number.isFinite(py)) {
      x = px + (x - px) * t;
      y = py + (y - py) * t;
      const pa = actor.prevAngle;
      if (Number.isFinite(pa)) angle = pa + wrapPi(angle - pa) * t;
    }
    if (!this._draw(info, x, y, angle, actor.proxyOpacity ?? 1, actor)) return false;
    const vx = Number(actor.vx) || 0;
    const vy = Number(actor.vy) || 0;
    const speed = Math.abs(Number.isFinite(actor.speed) ? actor.speed : Math.hypot(vx, vy));
    const throttle = Math.max(0, Math.min(1, Number(actor.throttle) || 0));
    const warp = actor.mode === 'warp' && speed > WARP_BOOST_SPEED;
    considerEngines(actor.courseId ?? actor, info, x, y, angle, vx, vy, throttle, speed, warp);
    return true;
  },

  /**
   * Surowa poza (reda, testy): `key` — stały identyfikator (dysze), `hullOrClass`
   * — id kadłuba albo klasa kursu. opts: { opacity, vx, vy, throttle, ref }.
   */
  push(key, hullOrClass, x, y, angle, opts = null) {
    const info = hullInfoFor(hullOrClass);
    if (!info) return false;
    if (!this._draw(info, x, y, angle || 0, opts?.opacity ?? 1, opts?.ref ?? key)) return false;
    if (opts && (opts.vx || opts.vy || opts.throttle)) {
      const vx = Number(opts.vx) || 0;
      const vy = Number(opts.vy) || 0;
      const throttle = Math.max(0, Math.min(1, Number(opts.throttle) || 0));
      considerEngines(key, info, x, y, angle || 0, vx, vy, throttle, Math.hypot(vx, vy), false);
    }
    return true;
  },

  _draw(info, x, y, angle, opacity, ref) {
    if (!frame.active) return false;
    stats.pushed++;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const r = info.radius;
    if (frame.cull) {
      if (Math.abs(x - frame.camX) > frame.halfW + r + frame.margin ||
          Math.abs(y - frame.camY) > frame.halfH + r + frame.margin) {
        stats.culled++;
        return false;
      }
      if (Math.max(info.w, info.h) * frame.zoom < MIN_DRAW_PX) {
        stats.culled++;
        return false;
      }
    }
    const kind = resolveKind(info);
    if (!kind) {
      stats.waitingImage++;
      return false;
    }
    if (kind.count >= kind.capacity && !growKind(kind)) return false;

    const n = kind.count++;
    kind.lastUsed = frameNo;
    // Układ sceny: (x, −y), obrót −kąt (jak mesh kadłuba), środek względem początku.
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const w = info.w;
    const h = info.h;
    const M = kind.buffer.array;
    const o = n * PROXY_INSTANCE_STRIDE;
    // Luk ładowni otwarty (E12): prostokąt uv otworu z resolvera przeładunku (portCargo3D) — albo pusty.
    const cut = bayCutResolver ? bayCutResolver(ref) : null;
    M[o] = c * w; M[o + 1] = s * w; M[o + 2] = cut ? cut.x : 0; M[o + 3] = cut ? cut.y : 0;
    M[o + 4] = -s * h; M[o + 5] = c * h; M[o + 6] = cut ? cut.z : 0; M[o + 7] = cut ? cut.w : 0;
    M[o + 8] = c; M[o + 9] = s; M[o + 10] = opacity; M[o + 11] = cut ? (cut.skin || 0) : 0;
    M[o + 12] = x - origin.x; M[o + 13] = -y - origin.y; M[o + 14] = 0; M[o + 15] = 1;

    if (pickCount < MAX_PICK) {
      pickX[pickCount] = x;
      pickY[pickCount] = y;
      pickR[pickCount] = Math.min(w, h) * 0.5;
      pickRef[pickCount] = ref;
      pickCount++;
    }
    stats.drawn++;
    return true;
  },

  /** Koniec klatki: zakresy buforów, widoczność rodzajów, dysze. */
  end() {
    if (!frame.active) return;
    frame.active = false;
    let drawCalls = 0;
    let live = 0;
    for (let k = 0; k < kindList.length; k++) {
      const kind = kindList[k];
      const mesh = kind.mesh;
      if (kind.count > 0) {
        if (!kind.attached) {
          Core3D.scene.add(mesh);
          kind.attached = true;
        }
        mesh.position.set(origin.x, origin.y, 0);
        mesh.geometry.instanceCount = kind.count;
        commitMatrices(kind);
        if (!mesh.visible) mesh.visible = true;
        drawCalls++;
      } else {
        mesh.geometry.instanceCount = 0;
        if (mesh.visible) mesh.visible = false;
        if (kind.attached && frameNo - kind.lastUsed > IDLE_DETACH_FRAMES) {
          Core3D.scene.remove(mesh);
          kind.attached = false;
        }
      }
      if (kind.attached) live++;
    }
    for (let i = pickCount; i < MAX_PICK && pickRef[i] !== null; i++) pickRef[i] = null;
    flushEngines(this.engineEntities);
    stats.kinds = live;
    stats.drawCalls = drawCalls;
    const ms = performance.now() - frame.t0;
    stats.lastMs = ms;
    stats.cpuMs = stats.cpuMs > 0 ? stats.cpuMs * 0.9 + ms * 0.1 : ms;
  },

  /**
   * Cała klatka: encje bańki (np. getActorList) z interpolacją alpha.
   * Wołać PRZED Core3D.render, z kamerą tej klatki.
   */
  update(actors, alpha = 1, camera = Core3D.activeCam1, options = {}) {
    if (!Core3D.isInitialized) {
      this.engineEntities.length = 0;
      return;
    }
    this.begin(camera, options);
    if (actors) {
      for (let i = 0; i < actors.length; i++) this.pushActor(actors[i], alpha);
    }
    this.end();
  },

  /**
   * Cała klatka z listy rekordów encji (pierwsze `count`, poza już w chwili klatki — alpha 1): bańka ruchu
   * v2 w grze (E6) — tryb `off` w index.html i worker renderu z bloku `traffic`. Dysze proxy dopisuje do
   * `entities` (lista kadłubów updateHexShips3D). Pusta lista po pustej klatce nic nie robi.
   */
  drawList(camera, list, count, entities = null) {
    if (!Core3D.isInitialized || (!(count > 0) && !stats.drawn)) {
      this.engineEntities.length = 0;
      return;
    }
    this.begin(camera);
    for (let i = 0; i < count; i++) this.pushActor(list[i], 1);
    this.end();
    if (entities) {
      const engines = this.engineEntities;
      for (let i = 0; i < engines.length; i++) entities.push(engines[i]);
    }
  },

  /**
   * Proxy pod punktem świata gry z ostatniej klatki (najbliższy środek w promieniu
   * połowy krótszego boku + pad) — obiekt podany przy push (encja bańki) albo null.
   */
  pickAt(worldX, worldY, pad = 0) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < pickCount; i++) {
      const dx = pickX[i] - worldX;
      const dy = pickY[i] - worldY;
      const d2 = dx * dx + dy * dy;
      const r = pickR[i] + pad;
      if (d2 <= r * r && d2 < bestD) {
        bestD = d2;
        best = pickRef[i];
      }
    }
    return best;
  },

  /** Wymiary proxy klasy/kadłuba { w, h, hullId } — te same co kadłub pełnego NPC. */
  getHullSize(hullOrClass) {
    const info = hullInfoFor(hullOrClass);
    return info ? { w: info.w, h: info.h, hullId: info.hullId } : null;
  },

  getStats() {
    return stats;
  },

  dispose() {
    for (const kind of kindList) {
      if (kind.mesh.parent) kind.mesh.parent.remove(kind.mesh);
      kind.mesh.geometry.dispose();
      kind.material.dispose();
      releaseHullVisualTexture(kind.image);
    }
    kindList.length = 0;
    kinds.clear();
    hullInfos.clear();
    engineRecords.clear();
    this.engineEntities.length = 0;
    pickRef.fill(null);
    pickCount = 0;
    if (quadGeometry) {
      quadGeometry.dispose();
      quadGeometry = null;
    }
  }
};
