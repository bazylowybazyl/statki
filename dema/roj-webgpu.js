// ============================================================
// Demo WebGPU: rój dronów przeładunkowych S / M / L / Capital (dema/roj-webgpu.html) — jeden
// kontener standardowy, chwyt płaski 1 / 2 / 4 / 8, tempo domyślne ×4 (jak w grze).
//
// Klatka: wejście → kamera → scena (galeria: CPU pisze stan dronów; rój: wieża — planista CPU —
// dopisuje zadania, symulacja GPU robi kroki compute, odczyt stanu wraca do wieży) → render
// (pass sceny MSAA 4 → bloom gry → ACES gry → sRGB, jak post Core3D). Układ sceny jak Core3D:
// (x, −y gry, z w górę), kamera z góry (perspektywa wąska jak w demie ładowni) albo kinowa.
// ============================================================
import * as THREE from 'three/webgpu';
import { max, nodeObject, pass, uniform, vec3, vec4 } from 'three/tsl';
import { BloomGry, hdrBezpieczny } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { CARGO_BAY_HULLS } from '../src/data/cargoBays.js';
import { SWARM_DRONE_VEC4, SWARM_DRONE } from '../src/game/swarm/swarmPort.js';
import { SWARM_SCENARIOS, SWARM_SCENARIO_ORDER } from '../src/game/swarm/swarmScenarios.js';
import { CARGO_LIGHT, setCargoSun } from '../src/3d/cargo/cargoLight.tsl.js';
import { CargoLights } from '../src/3d/cargo/drones.tsl.js';
import { SwarmReadback, SwarmSim, SWARM_SIM_TUNE } from '../src/3d/swarm/swarmSim.js';
import { SWARM_LOOK, SwarmDroneLights, SwarmDroneMeshes } from '../src/3d/swarm/swarmDrones.tsl.js';
import { SwarmShadows, SwarmUnits } from '../src/3d/swarm/swarmUnits.tsl.js';
import { buildSwarmDroneGeometries } from '../src/3d/swarm/swarmDroneModel.js';
import { createSky } from './ladownia-webgpu/tlo.js';
import { loadImage, spriteTexture } from './ladownia-webgpu/kadlub.js';
import { GalleryScene, SwarmScene } from './roj-webgpu/sceny.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PANEL_W = 352;
const SCENES = ['galeria', ...SWARM_SCENARIO_ORDER];

const errEl = $('err');
function showError(text) {
  errEl.style.display = 'block';
  errEl.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));

function noWebGPU(detail) {
  $('nogpu').style.display = 'flex';
  $('nogpu-detail').textContent = detail || '';
  $('backend').textContent = 'WebGPU niedostępne';
  $('loading').style.display = 'none';
  window.__demo = { ready: false, error: 'webgpu', detail };
}

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—');

// Kadłuby scenariuszy (sprite'y i maski alfy do mapy przeszkód roju).
const HULLS_USED = ['atlas', 'heavy_freighter', 'megafreighter_wagon', 'container_ship', 'long_haul_freighter', 'terran_frigate', 'terran_destroyer'];

async function main() {
  if (!('gpu' in navigator)) { noWebGPU('navigator.gpu nie istnieje.'); return; }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) { noWebGPU('Brak adaptera WebGPU (requestAdapter zwrócił null).'); return; }

  // Limity z adaptera (jak Core3D) — kernel sterowania roju trzyma 8 buforów storage.
  const requiredLimits = {};
  for (const key of ['maxStorageBuffersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeInvocationsPerWorkgroup']) {
    const v = adapter.limits?.[key];
    if (Number.isFinite(v)) requiredLimits[key] = v;
  }
  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true, powerPreference: 'high-performance', requiredLimits });
  const DPR = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) { noWebGPU('WebGPURenderer przełączył się na WebGL2 — demo wymaga WebGPU.'); return; }
  const device = renderer.backend.device;
  device.addEventListener('uncapturederror', (e) => showError(`WebGPU: ${e.error?.message || e.error}`));
  const timestamps = renderer.backend.trackTimestamp === true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 5, 80000);
  const TAN_H = Math.tan(THREE.MathUtils.degToRad(35 / 2));
  const sky = createSky(renderer, scene);

  // Rój: jeden bufor symulacji na stronę (sceny go przestawiają przez init()).
  const MAX_DRONES = Math.max(4096, Number(params.get('liczba')) || 0);
  const sim = new SwarmSim({ maxDrones: MAX_DRONES, maxUnits: 8192, maxColumns: 16384, hfCells: 1 << 21 });
  const geometries = buildSwarmDroneGeometries(THREE);
  const render = {
    drones: new SwarmDroneMeshes(scene, sim.drones, geometries),
    lights: new SwarmDroneLights(scene, sim.drones),
    units: new SwarmUnits(scene, sim.units, 65536),
    shadows: new SwarmShadows(scene, sim.drones, sim.units)
  };
  const cargoLights = new CargoLights(scene, 2048);
  // Śledzenie drona: odczyt pozy jednego drona (4 liczby z rekordu).
  let followRead = null;

  // Post: pass (MSAA 4, HalfFloat) → siatka bezpieczeństwa HDR → bloom gry → ACES gry → sRGB.
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const sceneColor = hdrBezpieczny(scenePass.getTextureNode('output'));
  const bloomGry = new BloomGry(sceneColor, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  const bloomNode = nodeObject(bloomGry);
  const uBloomOn = uniform(1);
  const lin = sceneColor.rgb.add(bloomNode.rgb.mul(uBloomOn));
  pipeline.outputNode = vec4(linearDoSrgb(acesGry(max(lin, vec3(0.0)))), 1.0);
  pipeline.outputColorTransform = false;

  // Sprite'y kadłubów i maski alfy (do mapy przeszkód: wierzch kadłuba z kształtu sprite'a).
  const textures = new Map();
  const masks = new Map();
  let loaded = 0;
  await Promise.all(HULLS_USED.map(async (id) => {
    const img = await loadImage(`/${CARGO_BAY_HULLS[id].sprite}`);
    textures.set(id, spriteTexture(img, 8));
    const w = 384;
    const h = Math.max(8, Math.round(w * img.height / img.width));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = px[i * 4 + 3];
    masks.set(id, { w, h, a });
    loaded++;
    $('loading').textContent = `wczytywanie sprite'ów kadłubów… ${loaded} / ${HULLS_USED.length}`;
  }));
  $('loading').style.display = 'none';

  const S = {
    t: 0, speed: 1, scene: null, sceneName: '', mode: params.get('tryb') === 'naive' ? 'naive' : 'smart',
    count: Number(params.get('liczba')) || 2048, layers: true, avoid: true, resume: 4,
    frames: 0, fps: 60, cpuMs: 0, gpuMs: 0, pxPerUnit: 1, info: {}, keys: new Set(), dragging: null,
    shadows: true, lightsOn: true, follow: -1, followPos: null,
    metrics: null
  };
  const ctx = { scene, renderer, sim, render, textures, masks, cargoLights };
  // Tempo domyślne sceny: rój ×4 (jak w grze — ×1 za wolne), galeria ×1 (cykl chwytu z bliska).
  const sceneSpeed = (name) => (name === 'galeria' ? 1 : 4);

  // Kamera: cel (x, y), odległość d, pochylenie i azymut (kamera kinowa).
  const cam = { x: 0, y: 0, d: 2000, td: 2000, tilt: 0, az: 0, fly: null, anchor: { on: false } };
  const ZOOM_MAX = 12;
  const ZOOM_MIN = 0.02;
  const dForZoom = (z) => (innerHeight * 0.5) / (z * TAN_H);
  let D_MIN = dForZoom(ZOOM_MAX);
  let D_MAX = dForZoom(ZOOM_MIN);
  function syncCamera() {
    const tilt = THREE.MathUtils.degToRad(cam.tilt);
    const az = THREE.MathUtils.degToRad(cam.az);
    if (cam.tilt < 0.01) {
      camera.position.set(cam.x, cam.y, cam.d);
      camera.up.set(0, 1, 0);
    } else {
      camera.position.set(cam.x + cam.d * Math.sin(tilt) * Math.sin(az), cam.y - cam.d * Math.sin(tilt) * Math.cos(az), cam.d * Math.cos(tilt));
      camera.up.set(0, 0, 1);
    }
    camera.lookAt(cam.x, cam.y, 0);
    camera.near = Math.max(1, cam.d * 0.02);
    camera.far = cam.d * 3 + 12000;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    S.pxPerUnit = (innerHeight * 0.5) / (cam.d * TAN_H);
  }
  function fitRect(r, instant = false) {
    if (!r) return;
    const freeW = Math.max(200, innerWidth - PANEL_W);
    const aspect = freeW / innerHeight;
    const d = clamp(Math.max(r.h / (2 * TAN_H), r.w / (2 * TAN_H * aspect)), D_MIN, D_MAX);
    const px = (innerHeight * 0.5) / (d * TAN_H);
    const target = { x: r.x - (PANEL_W / 2) / px, y: r.y, d };
    if (instant) { cam.x = target.x; cam.y = target.y; cam.d = cam.td = d; cam.fly = null; } else cam.fly = { ...target, from: { x: cam.x, y: cam.y, d: cam.d }, t: 0 };
    cam.td = d;
    cam.anchor.on = false;
  }

  // ---------------------------------------------------------------------------
  // Sceny
  // ---------------------------------------------------------------------------

  const resetMetrics = () => { S.metrics = { minSep: Infinity, nearMax: 0, nearSum: 0, deepSum: 0, frames: 0, stallFrom: null, stall: 0, lastDone: -1, overflowMax: 0, worst: [], minGap: Infinity, collisionSum: 0, collisionFrames: 0, collisionMax: 0 }; };
  function setScene(name, opts = {}) {
    if (S.scene) S.scene.dispose();
    S.follow = -1;
    S.sceneName = SCENES.includes(name) ? name : 'galeria';
    if (opts.mode) S.mode = opts.mode;
    if (opts.count) S.count = opts.count;
    sim.setTune('layersOn', S.layers ? 1 : 0);
    S.scene = S.sceneName === 'galeria' ? new GalleryScene(ctx) : new SwarmScene(ctx, S.sceneName, { mode: S.mode, count: S.count });
    S.t = 0;
    S.resume = sceneSpeed(S.sceneName);
    if (!opts.keepSpeed) setSpeed(S.resume);
    resetMetrics();
    for (const b of document.querySelectorAll('#scenes button')) b.classList.toggle('on', b.dataset.s === S.sceneName);
    const sc = SWARM_SCENARIOS[S.sceneName];
    $('note').textContent = S.sceneName === 'galeria'
      ? 'Jeden kontener standardowy 16 × 8 × 8. Dron chwyta płaską warstwę: S 1, M 2, L 4, Capital 8 kontenerów — każdy za dwa gniazda narożne na swojej zewnętrznej krawędzi; ramiona M, L i Capital wysuwane (teleskop).'
      : (sc ? sc(S.count).note : '');
    $('banner').style.display = 'none';
    $('labels').innerHTML = '';
    if (S.sceneName === 'galeria') {
      cam.tilt = 52; cam.az = -24;
      fitRect(S.scene.frame(), true);
    } else {
      cam.tilt = 0; cam.az = 0;
      fitRect(S.scene.frame(), true);
    }
    syncUi();
    syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------

  for (const b of document.querySelectorAll('#scenes button')) b.addEventListener('click', () => setScene(b.dataset.s));
  function setSpeed(v) {
    S.speed = v;
    for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.v) === v);
  }
  for (const b of document.querySelectorAll('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.v)));
  function syncUi() {
    $('t-mode').textContent = `M · wieża: ${S.mode === 'smart' ? 'SMART' : 'NAIWNA'}`;
    $('t-mode').classList.toggle('on', S.mode === 'smart');
    $('t-layers').textContent = `V · warstwy przelotu: ${S.layers ? 'wł.' : 'wył.'}`;
    $('t-layers').classList.toggle('on', S.layers);
    $('t-avoid').textContent = `U · unikanie: ${S.avoid ? 'wł.' : 'WYŁ.'}`;
    $('t-avoid').classList.toggle('on', S.avoid);
    $('v-cine').classList.toggle('on', cam.tilt > 0.01);
    $('v-follow').classList.toggle('on', S.follow >= 0);
    $('s-tilt').value = String(cam.tilt);
    $('o-tilt').textContent = cam.tilt.toFixed(0);
  }
  const toggleMode = () => { S.mode = S.mode === 'smart' ? 'naive' : 'smart'; if (S.sceneName !== 'galeria') setScene(S.sceneName); syncUi(); };
  const toggleLayers = () => { S.layers = !S.layers; sim.setTune('layersOn', S.layers ? 1 : 0); syncUi(); };
  const toggleAvoid = () => {
    S.avoid = !S.avoid;
    sim.setTune('avoidOn', S.avoid ? 1 : 0);
    syncUi();
  };
  $('t-mode').addEventListener('click', toggleMode);
  $('t-layers').addEventListener('click', toggleLayers);
  $('t-avoid').addEventListener('click', toggleAvoid);
  function toggleCine() {
    cam.tilt = cam.tilt > 0.01 ? 0 : 46;
    if (cam.tilt > 0 && !cam.az) cam.az = -18;
    syncUi();
    syncCamera();
  }
  function frameScene() { S.follow = -1; fitRect(S.scene.frame()); syncUi(); }
  function followDrone(k = null) {
    const n = sim.count;
    if (!n) return;
    if (k === null) {
      // Kolejny dron w ruchu (z odczytu stanu): pierwszy nieparkujący od bieżącego.
      const st = sim.statusData;
      let pick = (S.follow + 1) % n;
      for (let j = 0; j < n && st; j++) {
        const c = (S.follow + 1 + j) % n;
        if ((st[c * 4] | 0) !== 0) { pick = c; break; }
      }
      k = pick;
    }
    S.follow = clamp(k | 0, 0, n - 1);
    if (!followRead) followRead = new SwarmReadback(renderer, sim.drones, 4, 2);
    cam.td = Math.min(cam.td, dForZoom(3.2));
    syncUi();
  }
  $('v-frame').addEventListener('click', frameScene);
  $('v-cine').addEventListener('click', toggleCine);
  $('v-follow').addEventListener('click', () => (S.follow >= 0 ? (S.follow = -1, syncUi()) : followDrone()));

  function bindRange(id, fn, fmtFn = (v) => v.toFixed(2)) {
    const el = $(id);
    const out = $(id.replace('s-', 'o-'));
    const upd = () => { if (out) out.textContent = fmtFn(Number(el.value)); fn(Number(el.value)); };
    el.addEventListener('input', upd);
    upd();
  }
  let sunAz = 128;
  const applySun = () => setCargoSun(THREE.MathUtils.degToRad(sunAz), 30, 0.03);
  bindRange('s-sun', (v) => { sunAz = v; applySun(); }, (v) => v.toFixed(0));
  bindRange('s-tilt', (v) => { cam.tilt = v; syncCamera(); $('v-cine').classList.toggle('on', v > 0.01); }, (v) => v.toFixed(0));
  bindRange('s-tau', (v) => sim.setTune('orcaTau', v));
  bindRange('s-avoid', (v) => sim.setTune('margin', v));
  $('c-bloom').addEventListener('change', (e) => { uBloomOn.value = e.target.checked ? 1 : 0; });
  $('c-shadows').addEventListener('change', (e) => { S.shadows = e.target.checked; });
  $('c-lights').addEventListener('change', (e) => { S.lightsOn = e.target.checked; });

  // ---------------------------------------------------------------------------
  // Wejście
  // ---------------------------------------------------------------------------

  const canvas = renderer.domElement;
  const _v = new THREE.Vector3();
  const _ray = new THREE.Raycaster();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const _ndc = new THREE.Vector2();
  function screenToPlane(px, py, out) {
    _ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    return _ray.ray.intersectPlane(_plane, out);
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    canvas.setPointerCapture(e.pointerId);
    S.dragging = { x: e.clientX, y: e.clientY };
    cam.fly = null;
    cam.anchor.on = false;
    if (S.follow >= 0) { S.follow = -1; syncUi(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.dragging) return;
    const dx = e.clientX - S.dragging.x;
    const dy = e.clientY - S.dragging.y;
    S.dragging.x = e.clientX; S.dragging.y = e.clientY;
    const k = 1 / S.pxPerUnit;
    const az = THREE.MathUtils.degToRad(cam.tilt > 0.01 ? cam.az : 0);
    const c = Math.cos(az);
    const s = Math.sin(az);
    cam.x -= (dx * c + dy * s) * k;
    cam.y += (dy * c - dx * s) * k;
    syncCamera();
  });
  addEventListener('pointerup', () => { S.dragging = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.fly = null;
    cam.td = clamp(cam.td * Math.exp(e.deltaY * 0.0012), D_MIN, D_MAX);
    if (cam.tilt < 0.01 && S.follow < 0) {
      const p = screenToPlane(e.clientX, e.clientY, _v);
      if (p) cam.anchor = { on: true, wx: p.x, wy: p.y, nx: (e.clientX / innerWidth) * 2 - 1, ny: -(e.clientY / innerHeight) * 2 + 1 };
    }
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k >= '1' && k <= '7') setScene(SCENES[Number(k) - 1]);
    if (k === 'h') $('panel').classList.toggle('hidden');
    if (k === 'm') toggleMode();
    if (k === 'v') toggleLayers();
    if (k === 'u') toggleAvoid();
    if (k === 'f') frameScene();
    if (k === 'c') toggleCine();
    if (k === 't') followDrone();
    if (k === 'r') setScene(S.sceneName);
    if (k === ' ') { e.preventDefault(); setSpeed(S.speed > 0 ? 0 : S.resume); }
  });
  addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    D_MIN = dForZoom(ZOOM_MAX);
    D_MAX = dForZoom(ZOOM_MIN);
    syncCamera();
  });

  function updateCamera(dt) {
    const pan = 900 * dt * (cam.d / 2000);
    let moved = false;
    const az = THREE.MathUtils.degToRad(cam.tilt > 0.01 ? cam.az : 0);
    const fx = -Math.sin(az);
    const fy = Math.cos(az);
    if (S.keys.has('w') || S.keys.has('arrowup')) { cam.x += fx * pan; cam.y += fy * pan; moved = true; }
    if (S.keys.has('s') || S.keys.has('arrowdown')) { cam.x -= fx * pan; cam.y -= fy * pan; moved = true; }
    if (S.keys.has('a') || S.keys.has('arrowleft')) { cam.x -= fy * pan; cam.y += fx * pan; moved = true; }
    if (S.keys.has('d') || S.keys.has('arrowright')) { cam.x += fy * pan; cam.y -= fx * pan; moved = true; }
    if (cam.tilt > 0.01) {
      if (S.keys.has('q')) cam.az -= 40 * dt;
      if (S.keys.has('e')) cam.az += 40 * dt;
    }
    if (moved) { cam.anchor.on = false; cam.fly = null; if (S.follow >= 0) { S.follow = -1; syncUi(); } }
    if (S.follow >= 0 && S.followPos) {
      cam.x += (S.followPos[0] - cam.x) * Math.min(1, dt * 5);
      cam.y += (S.followPos[1] - cam.y) * Math.min(1, dt * 5);
      cam.d += (cam.td - cam.d) * Math.min(1, dt * 6);
    } else if (cam.fly) {
      const f = cam.fly;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t * f.t * (3 - 2 * f.t);
      cam.x = f.from.x + (f.x - f.from.x) * e;
      cam.y = f.from.y + (f.y - f.from.y) * e;
      cam.d = Math.exp(Math.log(f.from.d) + (Math.log(f.d) - Math.log(f.from.d)) * e);
      if (f.t >= 1) cam.fly = null;
    } else {
      cam.d += (cam.td - cam.d) * Math.min(1, dt * 8);
      const a = cam.anchor;
      if (a.on) {
        cam.x = a.wx - a.nx * cam.d * TAN_H * camera.aspect;
        cam.y = a.wy - a.ny * cam.d * TAN_H;
        if (Math.abs(cam.td - cam.d) < 0.5) a.on = false;
      }
    }
    syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Klatka
  // ---------------------------------------------------------------------------

  const labelsEl = $('labels');
  function updateLabels() {
    if (S.sceneName !== 'galeria') { if (labelsEl.childElementCount) labelsEl.innerHTML = ''; return; }
    const list = S.scene.labels();
    while (labelsEl.childElementCount < list.length) {
      const d = document.createElement('div');
      d.className = 'lbl';
      d.innerHTML = '<b></b><small></small>';
      labelsEl.appendChild(d);
    }
    list.forEach((l, i) => {
      const el = labelsEl.children[i];
      _v.set(l.x, l.y, l.z).project(camera);
      el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight + 10}px`;
      el.style.display = _v.z < 1 ? 'block' : 'none';
      el.firstChild.textContent = l.title;
      el.lastChild.textContent = l.text;
    });
  }

  function frame(dt) {
    const t0 = performance.now();
    S.t += dt * S.speed;
    S.frames++;
    updateCamera(dt);
    CARGO_LIGHT.time.value = S.t;
    SWARM_LOOK.time.value = S.t;
    cargoLights.begin();
    S.info = S.scene.update(S.t, dt, S.speed) || {};
    cargoLights.commit(camera, S.pxPerUnit);
    render.drones.setLod(S.pxPerUnit);
    for (const e of render.lights.meshes) e.mesh.visible = S.lightsOn && e.mesh.geometry.instanceCount > 0;
    render.shadows.drones.visible = S.shadows && render.shadows.drones.geometry.instanceCount > 0;
    // Śledzenie drona: poza z odczytu (4 liczby rekordu, opóźnienie 1–2 klatek).
    if (S.follow >= 0 && followRead) {
      followRead.request(4, S.follow * SWARM_DRONE_VEC4 * 4 + SWARM_DRONE.POSE * 4);
      if (followRead.frame > 0) S.followPos = followRead.latest;
    }
    sky.fit(camera);
    pipeline.render();
    updateLabels();
    trackMetrics();
    S.draw = renderer.info.render.drawCalls;
    S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    if (timestamps && (S.frames % 8) === 0) {
      renderer.resolveTimestampsAsync('render').then((ms) => { if (Number.isFinite(ms)) S.gpuMs = ms; });
      renderer.resolveTimestampsAsync('compute').then((ms) => { if (Number.isFinite(ms)) S.gpuComputeMs = ms; });
    }
  }

  function trackMetrics() {
    const I = S.info;
    const M = S.metrics;
    if (!M || S.sceneName === 'galeria' || !I.steps) return;
    M.frames++;
    if (I.free > 0 && Number.isFinite(I.minSep) && I.minSep < 99) M.minSep = Math.min(M.minSep, I.minSep);
    M.nearMax = Math.max(M.nearMax, I.near || 0);
    M.nearSum += I.near || 0;
    M.overflowMax = Math.max(M.overflowMax, I.overflow || 0);
    M.deepSum += I.deep || 0;
    if (I.minGap !== null && I.minGap !== undefined) M.minGap = Math.min(M.minGap, I.minGap);
    M.collisionSum += I.collisions || 0;
    if (I.collisions > 0) M.collisionFrames++;
    M.collisionMax = Math.max(M.collisionMax, I.collisions || 0);
    // Najgorsze pary (diagnostyka unikania): stosunek, fazy, ładunek, klasy.
    if (I.minPair !== undefined && I.minPair < 0xffffffff) {
      // Prawdziwa przerwa najbliższej pary [j.] (obrysy z kursem): (q / 100) − 100.
      const r = (I.minPair >>> 16) / 100 - 100;
      if (r < 0.5 && M.worst.length < 400) {
        const k = I.minPairKind >>> 0;
        M.worst.push({ t: +I.simTime.toFixed(2), r, pi: (I.minPair >>> 8) & 255, pj: I.minPair & 255, li: (k >>> 9) & 1, lj: (k >>> 8) & 1, ci: (k >>> 4) & 15, cj: k & 15 });
      }
    }
    if (I.done !== M.lastDone) { M.lastDone = I.done; M.stallFrom = I.simTime; }
    M.stall = I.done < I.total ? I.simTime - (M.stallFrom ?? I.simTime) : 0;
  }

  const statusEl = $('status');
  const statsEl = $('stats');
  const trimsEl = $('trims');
  let statsAt = 0;
  let fpsFrames = 0;
  let fpsT = performance.now();
  function updatePanel(now) {
    fpsFrames++;
    if (now - statsAt < 250) return;
    S.fps = fpsFrames * 1000 / Math.max(1, now - fpsT);
    fpsFrames = 0; fpsT = now; statsAt = now;
    const I = S.info;
    const W = renderer.domElement.width;
    const H = renderer.domElement.height;
    if (S.sceneName === 'galeria') {
      statusEl.textContent = 'Cykl chwytu: zawis → zejście (ramiona się rozkładają) → zacisk szczęk\n→ podniesienie → odłożenie → zwolnienie → powrót.';
      trimsEl.innerHTML = '';
    } else if (I.total !== undefined) {
      const el = (I.endTime ?? I.simTime) - (I.startTime ?? 0);
      const rate = el > 1 ? I.done / el * 60 : 0;
      const eta = rate > 0 ? (I.total - I.done) / rate * 60 : Infinity;
      const M = S.metrics;
      statusEl.textContent =
        `kontenery ${fmt(I.done)} / ${fmt(I.total)}   ${fmt(rate, 1)} / min   ETA ${I.done >= I.total ? 'gotowe' : fmtTime(eta)}\n` +
        `czas ${fmtTime(I.simTime)}   drony ${fmt(I.drones - I.parked)} w locie / ${fmt(I.drones)}\n` +
        `wolny lot ${fmt(I.free)} · tor pionowy ${fmt(I.guided)} · czeka ${fmt(I.waiting)} · ORCA: linie ${fmt(I.orcaLines)}, tłok ${fmt(I.dense)}\n` +
        `puste przeloty ${fmt(I.emptyShare * 100, 1)}%   statek→statek ${fmt(I.direct)}\n` +
        `najmniejsza przerwa ${Number.isFinite(M.minGap) ? fmt(M.minGap, 1) : '—'} j.   zderzenia ${fmt(M.collisionSum)}${M.stall > 60 ?`\nZASTÓJ ${fmt(M.stall, 0)} s` : ''}`;
      const trims = (I.trims || []).filter((t) => t.active);
      trimsEl.innerHTML = trims.map((t) => {
        const v = clamp(t.trim / 0.25, 0, 1);
        const cls = t.trim > 0.15 ? 'bad' : t.trim > 0.08 ? 'warn' : '';
        return `<div class="trim"><span>wyważenie ${t.id}</span><span class="bar"><i class="${cls}" style="width:${(v * 100).toFixed(0)}%"></i></span><span>${fmt(t.trim * 100, 1)}%</span></div>`;
      }).join('');
      const banner = $('banner');
      if (I.doneAt !== null && I.doneAt !== undefined) {
        banner.style.display = 'block';
        banner.textContent = `Przeładunek zakończony: ${fmt(I.total)} kontenerów w ${fmtTime(I.endTime - I.startTime)} · puste przeloty ${fmt(I.emptyShare * 100, 1)}% · wieża ${I.mode === 'smart' ? 'SMART' : 'NAIWNA'} — R: od początku, M: druga wieża`;
      } else banner.style.display = 'none';
    }
    statsEl.textContent =
      `FPS ${S.fps.toFixed(0)} (${W}×${H})  CPU ${S.cpuMs.toFixed(2)} ms  GPU ${timestamps ? S.gpuMs.toFixed(2) : '—'} ms\n` +
      `compute ${timestamps && S.gpuComputeMs !== undefined ? S.gpuComputeMs.toFixed(2) : '—'} ms  kroki/klatkę ${I.steps ?? 0}  zoom ×${S.pxPerUnit.toFixed(2)}\n` +
      `draw ${S.draw ?? '—'}  kontenery ${fmt(render.units.count)}  drony ${fmt(sim.count)}`;
  }

  // ---------------------------------------------------------------------------
  // Pętla (pod ?test=1 klatki tylko z step(n))
  // ---------------------------------------------------------------------------

  let pendingSteps = 0;
  let stepDone = null;
  let stepDt = 1 / 60;
  let last = performance.now();
  let frameErrors = 0;
  function safeFrame(dt) {
    try {
      frame(dt);
      frameErrors = 0;
    } catch (e) {
      showError(`Klatka: ${e?.stack || e}`);
      if (++frameErrors > 30) { renderer.setAnimationLoop(null); showError('Pętla zatrzymana po powtarzających się błędach.'); }
    }
  }
  renderer.setAnimationLoop((now) => {
    if (pendingSteps > 0) {
      pendingSteps--;
      safeFrame(stepDt);
      if (pendingSteps === 0 && stepDone) {
        const done = stepDone;
        stepDone = null;
        device.queue.onSubmittedWorkDone().then(done);
      }
      last = now;
      updatePanel(now);
      return;
    }
    if (TEST) return;
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;
    safeFrame(dt);
    updatePanel(now);
  });

  applySun();
  setSpeed(4);
  const start = SCENES.includes(params.get('scena')) ? params.get('scena') : 'galeria';
  setScene(start);
  $('backend').textContent = `WebGPU · ${timestamps ? 'pomiar czasu GPU' : 'bez pomiaru czasu GPU'} · three r${THREE.REVISION}`;

  window.__demo = {
    ready: true,
    S, cam, renderer, scene, camera, sim, render,
    step(n = 1, dt = 1 / 60) {
      stepDt = dt;
      return new Promise((resolve) => { pendingSteps = Math.max(1, n | 0); stepDone = resolve; });
    },
    /** Przewija symulację o `seconds` czasu sceny (klatki po 1/60 s × tempo). */
    async run(seconds, speed = S.speed || 1) {
      setSpeed(speed);
      const frames = Math.ceil(seconds / (speed / 60));
      for (let k = 0; k < frames; k += 120) await this.step(Math.min(120, frames - k));
      return this.stats();
    },
    scene: (name, opts) => { setScene(name, opts || {}); return S.sceneName; },
    pause(on = true) { setSpeed(on ? 0 : S.resume); return S.speed; },
    speed: (v) => setSpeed(v),
    mode: () => toggleMode(),
    layers: (on) => { if (on !== S.layers) toggleLayers(); return S.layers; },
    avoid: (on) => { if (on !== S.avoid) toggleAvoid(); return S.avoid; },
    lookAt(x, y, zoom) {
      cam.fly = null; cam.anchor.on = false;
      cam.x = x; cam.y = y;
      if (zoom) cam.d = cam.td = clamp(dForZoom(zoom), D_MIN, D_MAX);
      syncCamera();
    },
    frame() { fitRect(S.scene.frame(), true); syncCamera(); return S.scene.frame(); },
    focusItem(k) { if (S.scene.focusItem) { fitRect(S.scene.focusItem(k), true); syncCamera(); } },
    tilt(deg = 46, az = -18) { cam.tilt = deg; cam.az = az; syncUi(); syncCamera(); return cam.tilt; },
    follow: (k) => followDrone(k ?? null),
    stats() {
      const I = S.info;
      return {
        fps: S.fps, cpuMs: S.cpuMs, gpuMs: S.gpuMs, gpuComputeMs: S.gpuComputeMs, scene: S.sceneName, mode: S.mode, t: S.t,
        drawCalls: S.draw ?? renderer.info.render.drawCalls, containers: render.units.count, drones: sim.count,
        metrics: S.metrics, ...I, trims: I.trims
      };
    }
  };
}

main().catch((e) => {
  showError(`Start: ${e?.stack || e}`);
  window.__demo = { ready: false, error: 'start', detail: String(e?.message || e) };
});
