// dema/wybuchy-webgpu.js
//
// Demo WYBUCHÓW I DYMU na WebGPU (plan docs/PLAN-zniszczenia-swiata-3d.md § 12): gaz na siatce 3D
// (src/3d/gas/gasGrid.js — compute jak Niagara Fluids), obraz objętościowy (gasVolume.js), reżyser
// wybuchów budowli (gasExplosions.js), iskry porywane przez gaz i błyski (gasEmbers.js), światła ognia,
// fala refrakcji i post — wspólny zestaw dem `GasSceneFx` (gasSceneFx.js, ten sam w destruktor3d-webgpu.html).
// Stacja z gry (src/stations/earth-station.glb) jako cel; kliknięcie = wybuch w punkcie pod kursorem.
//
// Konsola / harness: window.__demo (boom, view, step, setPaused, grid, volume, director…);
// zrzuty: node scripts/webgpu/wybuchy-demo.mjs.

import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, positionWorldDirection, floor, fract, sin, dot, exp, smoothstep, normalize, mix } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GasSceneFx } from '../src/3d/gas/gasSceneFx.js';

const STATION_URL = new URL('../src/stations/earth-station.glb', import.meta.url).href;
const STATION_SIZE = 140;        // największy wymiar stacji [j.]
const params = new URLSearchParams(location.search);
const GRID_N = Number(params.get('n')) || 64;
const GRID_SLOTS = Number(params.get('domeny')) || 6;

const $ = (id) => document.getElementById(id);
const errors = [];
function showError(msg) {
  errors.push(String(msg));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.slice(-6).join('\n');
}
addEventListener('error', (e) => showError(e.message || e));
addEventListener('unhandledrejection', (e) => showError(e.reason?.stack || e.reason));

// Generator efektów (LCG) — powtarzalne pokazy (harness).
function makeRng(seed = 12345) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }, seed(v) { s = v >>> 0; } };
}
const rng = makeRng(20261005);

let W = innerWidth, H = innerHeight;
let renderer, scene, camera, controls, fx;
let grid, volume, director, embers, flashes;
const station = { root: null, meshes: [] };
const S = { paused: false, slow: false, kind: 'building', size: 14, frame: 0 };

// --- scena -----------------------------------------------------------------------------------------
function starfield() {
  return Fn(() => {
    const d = normalize(positionWorldDirection);
    const p = d.mul(420.0);
    const cell = floor(p);
    const f = fract(p).sub(0.5);
    const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const h2 = fract(sin(dot(cell, vec3(39.346, 11.135, 83.155))).mul(24634.6345));
    const star = smoothstep(0.9962, 1.0, h).mul(exp(dot(f, f).mul(-55.0))).mul(h2.mul(1.8).add(0.2));
    const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.75, 0.85, 1.0), h2);
    const neb = smoothstep(0.2, 1.0, d.y.mul(0.5).add(d.x.mul(0.3)).add(0.4));
    return vec4(vec3(0.0022, 0.0028, 0.0042).add(vec3(0.004, 0.0028, 0.006).mul(neb)).add(tint.mul(star)), 1.0);
  })();
}

async function loadStation() {
  const gltf = await new GLTFLoader().loadAsync(STATION_URL);
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = STATION_SIZE / Math.max(size.x, size.y, size.z);
  root.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  root.position.sub(c);
  root.traverse((o) => {
    if (o.isMesh) {
      station.meshes.push(o);
      const m = o.material;
      if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0;
    }
  });
  scene.add(root);
  station.root = root;
  root.updateMatrixWorld(true);
}

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU.');
  const requiredLimits = {};
  for (const k of ['maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxSampledTexturesPerShaderStage',
    'maxInterStageShaderVariables', 'maxTextureDimension3D', 'maxComputeInvocationsPerWorkgroup']) {
    if (adapter.limits[k] !== undefined) requiredLimits[k] = adapter.limits[k];
  }
  renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, requiredLimits, trackTimestamp: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  $('root').appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie — demo wymaga WebGPU.');
  renderer.highPrecision = true;
  // Znaczniki czasu GPU dopiero po rozgrzewce (pula zapytań zapełniłaby się przy kompilacji).
  S.gpuTiming = true;
}

function resize() {
  W = innerWidth; H = innerHeight;
  if (!renderer) return;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  fx?.resize(W, H);
}
addEventListener('resize', resize);

// --- wybuchy ---------------------------------------------------------------------------------------
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _n = new THREE.Vector3();
function pickStation(clientX, clientY) {
  _ndc.set((clientX / W) * 2 - 1, -(clientY / H) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const hit = _ray.intersectObjects(station.meshes, false)[0];
  if (!hit) return null;
  _n.copy(hit.face?.normal || new THREE.Vector3(0, 1, 0)).transformDirection(hit.object.matrixWorld);
  if (_n.dot(_ray.ray.direction) > 0) _n.negate();
  return { x: hit.point.x, y: hit.point.y, z: hit.point.z, nx: _n.x, ny: _n.y, nz: _n.z };
}

/** Losowy punkt powierzchni stacji (promień z zewnątrz ku środkowi). */
function randomSurfacePoint() {
  for (let k = 0; k < 20; k++) {
    const u = rng.next() * 2 - 1;
    const ph = rng.next() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(ph), u * 0.6, r * Math.sin(ph)).normalize();
    const origin = dir.clone().multiplyScalar(STATION_SIZE * 1.5);
    _ray.set(origin, dir.clone().negate());
    const hit = _ray.intersectObjects(station.meshes, false)[0];
    if (hit) {
      _n.copy(hit.face?.normal || dir).transformDirection(hit.object.matrixWorld);
      if (_n.dot(dir) < 0) _n.negate();
      return { x: hit.point.x, y: hit.point.y, z: hit.point.z, nx: _n.x, ny: _n.y, nz: _n.z };
    }
  }
  return { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
}

const pending = [];
function schedule(delay, fn) { pending.push({ t: director.time + delay, fn }); }

function boom(kind, p, size = S.size) {
  const n = [p.nx, p.ny, p.nz];
  const x = p.x + p.nx * size * 0.1, y = p.y + p.ny * size * 0.1, z = p.z + p.nz * size * 0.1;
  if (kind === 'building') director.building(x, y, z, size, n);
  else if (kind === 'blast') director.blast(x, y, z, size * 0.55, n);
  else if (kind === 'blaze') director.blaze(x, y, z, size * 0.8, 24, n);
  else if (kind === 'reactor') director.building(x, y, z, size * 2.1, n, { power: 1.8, trails: 14, secondaries: 4, fires: 4, domainScale: 5.6, life: 24 });
  else if (kind === 'chain') {
    for (let i = 0; i < 6; i++) {
      schedule(i * 0.42 + rng.next() * 0.2, () => {
        const q = i === 0 ? p : randomSurfacePoint();
        boom(i === 5 ? 'building' : 'blast', q, size * (0.6 + i * 0.12));
      });
    }
  }
}

function showcase() {
  setView([210, 95, 240], [0, 0, 0]);
  const pts = [randomSurfacePoint(), randomSurfacePoint(), randomSurfacePoint()];
  schedule(0.2, () => boom('blast', pts[0], 12));
  schedule(0.9, () => boom('blast', pts[1], 14));
  schedule(1.6, () => boom('building', pts[2], 16));
  schedule(3.2, () => boom('reactor', randomSurfacePoint(), 18));
}

// --- kamera ---------------------------------------------------------------------------------------
function setView(eye, target) {
  camera.position.set(eye[0], eye[1], eye[2]);
  controls.target.set(target[0], target[1], target[2]);
  controls.update();
}

// --- panel ----------------------------------------------------------------------------------------
function slider(host, label, obj, key, min, max, step, fmt = (v) => v.toFixed(2)) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
  const input = row.querySelector('input');
  const out = row.querySelector('output');
  input.value = obj[key];
  out.textContent = fmt(obj[key]);
  input.addEventListener('input', () => { obj[key] = Number(input.value); out.textContent = fmt(obj[key]); });
  host.appendChild(row);
}

function initPanel() {
  const sim = $('sim-sliders');
  const T = grid.tune;
  slider(sim, 'Wiry', T, 'vorticity', 0, 4, 0.05);
  slider(sim, 'Rozprężanie', T, 'expansion', 0, 3, 0.05);
  slider(sim, 'Turbulencja', T, 'turbulence', 0, 80, 1, (v) => v.toFixed(0));
  slider(sim, 'Wypór', T, 'buoyancy', 0, 30, 0.5);
  slider(sim, 'Spalanie', T, 'burnRate', 0.5, 20, 0.25);
  slider(sim, 'Ciepło spalania', T, 'heat', 0.2, 4, 0.05);
  slider(sim, 'Sadza', T, 'soot', 0, 4, 0.05);
  slider(sim, 'Stygnięcie', T, 'cooling', 0, 3, 0.05);
  slider(sim, 'Zanik dymu', T, 'smokeDecay', 0, 0.5, 0.005, (v) => v.toFixed(3));
  slider(sim, 'Opór', T, 'drag', 0, 3, 0.05);
  const look = $('look-sliders');
  const L = volume.look;
  slider(look, 'Gęstość dymu', L, 'density', 0.1, 6, 0.05);
  slider(look, 'Ogień', L, 'emission', 0, 4, 0.05);
  slider(look, 'Blask w dymie', L, 'glowGain', 0, 4, 0.05);
  slider(look, 'Słońce', L, 'sunGain', 0, 6, 0.05);
  slider(look, 'Detal', L, 'detail', 0, 1, 0.01);
  slider(look, 'Erozja brzegów', L, 'erosion', 0, 2, 0.02);
  slider(look, 'Języki ognia', L, 'flameNoise', 0, 1.5, 0.02);
  slider(look, 'Krok marszu', L, 'stepCells', 0.4, 2.5, 0.05);
  slider(look, 'Kalafior (warp)', L, 'warpAmp', 0, 4, 0.05);
  const sizeEl = $('sl-size');
  const sizeOut = sizeEl.nextElementSibling;
  sizeEl.value = S.size; sizeOut.textContent = S.size;
  sizeEl.addEventListener('input', () => { S.size = Number(sizeEl.value); sizeOut.textContent = S.size; });
  for (const b of document.querySelectorAll('[data-kind]')) b.addEventListener('click', () => setKind(b.dataset.kind));
  $('btn-show').addEventListener('click', showcase);
  const bindS = (id, key) => {
    const el = $(id);
    el.checked = S[key];
    el.addEventListener('change', () => { S[key] = el.checked; });
  };
  const bindFx = (id, key) => {
    const el = $(id);
    el.checked = fx.on[key];
    el.addEventListener('change', () => { fx.on[key] = el.checked; });
  };
  bindS('cb-pause', 'paused');
  bindS('cb-slow', 'slow');
  bindFx('cb-gas', 'gas');
  bindFx('cb-sparks', 'sparks');
  bindFx('cb-lights', 'lights');
  bindFx('cb-bloom', 'bloom');
}

function setKind(kind) {
  S.kind = kind;
  for (const b of document.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
}

const KEYS = { Digit1: 'building', Digit2: 'blast', Digit3: 'blaze', Digit4: 'chain', Digit5: 'reactor' };
addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT') return;
  if (KEYS[e.code]) setKind(KEYS[e.code]);
  else if (e.code === 'Space') { S.paused = !S.paused; $('cb-pause').checked = S.paused; e.preventDefault(); }
  else if (e.code === 'KeyS') { S.slow = !S.slow; $('cb-slow').checked = S.slow; }
  else if (e.code === 'KeyG') { fx.on.gas = !fx.on.gas; $('cb-gas').checked = fx.on.gas; }
  else if (e.code === 'KeyH') $('panel').style.display = $('panel').style.display === 'none' ? '' : 'none';
  else if (e.code === 'KeyC') clearAll();
  else if (e.code === 'KeyP') showcase();
});

function clearAll() {
  fx.clear();
  pending.length = 0;
}

// --- pętla ----------------------------------------------------------------------------------------
let last = performance.now();
let hudTimer = 0;
function simulate(dt) {
  // Zdarzenia zaplanowane (seria, pokaz) — zegar reżysera.
  for (let i = pending.length - 1; i >= 0; i--) {
    if (director.time >= pending[i].t) { const f = pending[i].fn; pending.splice(i, 1); f(); }
  }
  fx.update(dt);
}

function renderFrame() {
  fx.render();
  pollTimestamps();
}

// Czasy GPU (znaczniki compute i render) — odczyt, gdy poprzedni wrócił (pula zapytań się nie zapycha).
function pollTimestamps() {
  if (!S.gpuTiming || S.tsPending || !renderer.backend?.trackTimestamp) return;
  S.tsPending = true;
  Promise.all([
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE),
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
  ]).then(([c, r]) => {
    S.gpuCompute = S.gpuCompute === undefined ? c : S.gpuCompute * 0.8 + c * 0.2;
    S.gpuRender = S.gpuRender === undefined ? r : S.gpuRender * 0.8 + r * 0.2;
  }).catch(() => {}).finally(() => { S.tsPending = false; });
}

function frame(now) {
  const real = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const dt = S.paused ? 0 : real * (S.slow ? 0.25 : 1);
  controls.update();
  simulate(dt);
  renderFrame();
  S.frame++;
  hudTimer += real;
  if (hudTimer > 0.25) { hudTimer = 0; updateHud(real); }
}

function updateHud(real) {
  const g = grid.stats;
  $('hud').innerHTML = `<b>Wybuchy i dym · WebGPU</b>  ${(1 / Math.max(real, 1e-3)).toFixed(0)} FPS\n` +
    `domeny gazu  ${g.active}/${grid.S} (${grid.N}³)  podkroki ${g.substeps}\n` +
    `źródła ${g.sources}  emitery ${director.stats.emitters}  wybuchy ${director.stats.explosions}\n` +
    `iskry  ${embers.stats.alive}  błyski ${flashes.items.length}\n` +
    `CPU efektów ${fx.simMs.toFixed(2)} ms` + (S.gpuCompute !== undefined ? `  GPU compute ${S.gpuCompute.toFixed(2)} ms  render ${S.gpuRender.toFixed(2)} ms` : '') +
    (S.paused ? '  <b>PAUZA</b>' : '') + (S.slow ? '  <b>×0,25</b>' : '');
}

// --- start ----------------------------------------------------------------------------------------
async function main() {
  await initRenderer();
  scene = new THREE.Scene();
  scene.backgroundNode = starfield();
  camera = new THREE.PerspectiveCamera(46, W / H, 0.5, 30000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  setView([190, 80, 210], [0, 0, 0]);
  scene.add(new THREE.HemisphereLight(0x5d6f8f, 0x0b0907, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1df, 2.4);
  sun.position.set(220, 260, 160);
  scene.add(sun);
  fx = new GasSceneFx({ renderer, scene, camera, rng, N: GRID_N, slots: GRID_SLOTS, lightScale: STATION_SIZE });
  ({ grid, volume, director, embers, flashes } = fx);
  await loadStation();
  fx.buildPipeline(W, H);
  initPanel();
  // Rozgrzewka: pipeline'y compute przed pierwszym wybuchem.
  fx.warm();
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = pickStation(e.clientX, e.clientY);
    if (p) boom(S.kind, p);
  });
  $('loading').style.display = 'none';
  renderer.setAnimationLoop(frame);
  window.__demo = {
    ready: true, renderer, scene, camera, controls, fx, grid, volume, director, embers, flashes, S,
    get lights() { return fx.lights; },
    boom: (kind, x, y, z, size, nx = 0, ny = 1, nz = 0) => boom(kind, { x, y, z, nx, ny, nz }, size),
    randomSurfacePoint, pickStation, showcase, clear: clearAll,
    view: (eye, target, hidePanels = true) => { setView(eye, target); document.body.classList.toggle('shot', !!hidePanels); },
    setPaused: (v) => { S.paused = !!v; $('cb-pause').checked = S.paused; },
    // Krok deterministyczny (harness): n kroków po dt bez renderu, potem jeden render.
    step: (dt, n = 1) => { for (let i = 0; i < n; i++) simulate(dt); controls.update(); renderFrame(); return grid.stats; },
    setLoop: (on) => renderer.setAnimationLoop(on ? frame : null),
    errors
  };
  // Harness przełącza gaz przez S.gas (A/B pomiaru) — lustro na fx.on.gas.
  Object.defineProperty(S, 'gas', { get: () => fx.on.gas, set: (v) => { fx.on.gas = !!v; } });
}

main().catch((e) => { showError(e.stack || e.message || e); $('loading').textContent = 'Błąd startu — szczegóły na dole.'; });
