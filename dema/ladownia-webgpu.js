// ============================================================
// Demo WebGPU: ładownie kadłubów „à la Venator” (zadanie 26).
// Strona: dema/ladownia-webgpu.html (Vite, `npm run dev`).
//
// Klatka: wejście → kamera → scena (czysta funkcja czasu sceny: wrota, kontenery, drony,
// światła, cienie) → pule instancji → render (pass sceny MSAA 4 → bloom gry ×3 → ACES gry
// → sRGB, jak post Core3D). Układ sceny jak Core3D: (x, −y gry, z w górę), kamera z góry.
// ============================================================
import * as THREE from 'three/webgpu';
import { float, max, nodeObject, pass, uniform, vec3, vec4 } from 'three/tsl';
import { BLOOM_ZGODNOSC_WEBGL, BloomGry, hdrBezpieczny } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import {
  CARGO_BAY_HULLS, CARGO_BAY_HULL_ORDER, CARGO_COPPER_ROCK_ORE_T, CARGO_TONNES_DEFAULT, CARGO_TONNES_OPTIONS,
  cargoCapacityTable, cargoHullBays, cargoHullCapacity
} from '../src/data/cargoBays.js';
import { BAY_MODE } from '../src/game/cargoBayOps.js';
import { CARGO_LIGHT, CargoBayTable, setCargoSun } from '../src/3d/cargo/cargoLight.tsl.js';
import { CargoContainers } from '../src/3d/cargo/containers.tsl.js';
import { CargoDrones, CargoLights } from '../src/3d/cargo/drones.tsl.js';
import { CargoShadows } from '../src/3d/cargo/shadows.tsl.js';
import { createSky } from './ladownia-webgpu/tlo.js';
import { loadImage, spriteTexture } from './ladownia-webgpu/kadlub.js';
import { CARGO_MIXES, DoorScene, GalleryScene, TransferScene } from './ladownia-webgpu/sceny.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PANEL_W = 342;

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

const HULL_NAMES = Object.fromEntries(CARGO_BAY_HULL_ORDER.map((id) => [id, CARGO_BAY_HULLS[id].label]));
const FAMILY_LABEL = { gracz: 'gracz', terra: 'Terra Nova', piraci: 'piraci (Iron Skull)', frachtowce: 'frachtowce (Z11)' };
const fmt = (v, d = 0) => v.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });

async function main() {
  if (!('gpu' in navigator)) { noWebGPU('navigator.gpu nie istnieje.'); return; }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) { noWebGPU('Brak adaptera WebGPU (requestAdapter zwrócił null).'); return; }

  // ---------------------------------------------------------------------------
  // Renderer i post jak w grze (NoToneMapping, wyjście liniowe → ACES gry + sRGB)

  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true, powerPreference: 'high-performance' });
  const DPR = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    noWebGPU('WebGPURenderer przełączył się na WebGL2 — demo wymaga WebGPU.');
    return;
  }
  const device = renderer.backend.device;
  device.addEventListener('uncapturederror', (e) => showError(`WebGPU: ${e.error?.message || e.error}`));
  const timestamps = renderer.backend.trackTimestamp === true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 5, 60000);
  const TAN_H = Math.tan(THREE.MathUtils.degToRad(35 / 2));
  const sky = createSky(renderer, scene);

  // Pule wspólne dla scen.
  const pools = {
    containers: new CargoContainers(scene, 20000),
    drones: new CargoDrones(scene, 128),
    lights: new CargoLights(scene, 4096),
    shadows: new CargoShadows(scene, 4096)
  };

  // Post: pass (MSAA 4, HalfFloat) → siatka bezpieczeństwa HDR → bloom gry (BloomGry ×3) → ACES gry → sRGB.
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const sceneColor = hdrBezpieczny(scenePass.getTextureNode('output'));
  const bloomGry = new BloomGry(sceneColor, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  const bloomNode = nodeObject(bloomGry);
  const uBloomOn = uniform(1);
  const uExposure = uniform(1);
  const lin = sceneColor.rgb.add(bloomNode.rgb.mul(float(BLOOM_ZGODNOSC_WEBGL)).mul(uBloomOn));
  pipeline.outputNode = vec4(linearDoSrgb(acesGry(max(lin, vec3(0.0)).mul(uExposure))), 1.0);
  pipeline.outputColorTransform = false;

  // ---------------------------------------------------------------------------
  // Sprite'y kadłubów (raz)

  const textures = new Map();
  let loaded = 0;
  await Promise.all(CARGO_BAY_HULL_ORDER.map(async (id) => {
    const img = await loadImage(`/${CARGO_BAY_HULLS[id].sprite}`);
    textures.set(id, spriteTexture(img, 8));
    loaded++;
    $('loading').textContent = `wczytywanie sprite'ów kadłubów… ${loaded} / ${CARGO_BAY_HULL_ORDER.length}`;
  }));
  $('loading').style.display = 'none';
  const ctx = { scene, pools, textures };

  // ---------------------------------------------------------------------------
  // Stan dema

  const S = {
    t: Number(params.get('t')) || 0,
    speed: 1, scene: null, sceneName: '', hull: params.get('kadlub') || 'atlas',
    tons: CARGO_TONNES_DEFAULT, mix: 'mieszany', frames: 0, fps: 60, cpuMs: 0, gpuMs: 0, pxPerUnit: 1,
    shadows: true, info: {}, keys: new Set(), dragging: null
  };
  if (!CARGO_BAY_HULLS[S.hull]) S.hull = 'atlas';

  // Kamera: cel (x, y) w układzie sceny, odległość d, pochylenie i azymut (kamera kinowa).
  const cam = { x: 0, y: 0, d: 2000, td: 2000, tilt: 0, az: 0, fly: null, anchor: { on: false } };
  // Zoom jak w grze (px ekranu na jednostkę): kadry do ×3,2 (maks. gry), kółko do ×6.
  const ZOOM_FIT_MAX = 3.2;
  const ZOOM_MAX = 6;
  const ZOOM_MIN = 0.03;
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
    camera.near = Math.max(2, cam.d * 0.02);
    camera.far = cam.d * 3 + 8000;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    S.pxPerUnit = (innerHeight * 0.5) / (cam.d * TAN_H);
  }
  function fitRect(r, instant = false) {
    if (!r) return;
    const freeW = Math.max(200, innerWidth - PANEL_W);
    const aspect = freeW / innerHeight;
    const d = clamp(Math.max(r.h / (2 * TAN_H), r.w / (2 * TAN_H * aspect)), dForZoom(ZOOM_FIT_MAX), D_MAX);
    // Przesunięcie celu w lewo o pół panelu (treść na środku wolnego obszaru).
    const px = (innerHeight * 0.5) / (d * TAN_H);
    const target = { x: r.x - (PANEL_W / 2) / px, y: r.y, d };
    if (instant) { cam.x = target.x; cam.y = target.y; cam.d = cam.td = d; cam.fly = null; } else cam.fly = { ...target, from: { x: cam.x, y: cam.y, d: cam.d }, t: 0 };
    cam.td = d;
    cam.anchor.on = false;
  }

  // ---------------------------------------------------------------------------
  // Sceny

  function buildScene(name, hullId) {
    if (S.scene) S.scene.dispose();
    CargoBayTable.count = 0;
    S.sceneName = name;
    if (hullId && CARGO_BAY_HULLS[hullId]) S.hull = hullId;
    if (name === 'galeria') S.scene = new GalleryScene(ctx);
    else if (name === 'otwieranie') S.scene = new DoorScene(ctx, S.hull);
    else S.scene = new TransferScene(ctx, S.hull, name === 'zaladunek' ? BAY_MODE.LOAD : BAY_MODE.UNLOAD, { mix: S.mix, count: 48 });
    for (const b of document.querySelectorAll('#scenes button')) b.classList.toggle('on', b.dataset.s === name);
    $('door').textContent = name === 'zaladunek' || name === 'rozladunek' ? 'R · przeładunek od początku' : 'O · otwórz / zamknij wrota';
    updateHullButtons();
    updateCapacity();
  }
  function setScene(name, hullId, keepTime = false) {
    buildScene(name, hullId);
    if (!keepTime) S.t = 0;
    // Galeria startuje na ładowni wybranego kadłuba (od razu widać wnętrze i ładunek).
    const r = name === 'galeria' ? S.scene.bayFocus(S.hull) : S.scene.frame();
    fitRect(r, true);
    syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Panel

  const hullsEl = $('hulls');
  let lastFam = null;
  for (const id of CARGO_BAY_HULL_ORDER) {
    const fam = CARGO_BAY_HULLS[id].family;
    if (fam !== lastFam) {
      const f = document.createElement('div');
      f.className = 'fam';
      f.textContent = FAMILY_LABEL[fam] || fam;
      hullsEl.appendChild(f);
      lastFam = fam;
    }
    const b = document.createElement('button');
    b.dataset.h = id;
    b.textContent = HULL_NAMES[id];
    b.addEventListener('click', () => selectHull(id));
    hullsEl.appendChild(b);
  }
  function updateHullButtons() {
    for (const b of hullsEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.h === S.hull);
  }
  function selectHull(id) {
    if (!CARGO_BAY_HULLS[id]) return;
    if (S.sceneName === 'galeria') {
      S.hull = id;
      fitRect(S.scene.bayFocus(id));
      updateHullButtons();
      updateCapacity();
    } else setScene(S.sceneName, id);
  }
  function stepHull(dir) {
    const i = CARGO_BAY_HULL_ORDER.indexOf(S.hull);
    selectHull(CARGO_BAY_HULL_ORDER[(i + dir + CARGO_BAY_HULL_ORDER.length) % CARGO_BAY_HULL_ORDER.length]);
  }
  for (const b of document.querySelectorAll('#scenes button')) b.addEventListener('click', () => setScene(b.dataset.s));
  function setSpeed(v) {
    S.speed = v;
    for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.v) === v);
  }
  for (const b of document.querySelectorAll('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.v)));
  function doorAction() {
    if (S.sceneName === 'otwieranie') S.scene.toggle(S.t);
    else if (S.sceneName === 'galeria') S.scene.toggle(S.t);
    else S.t = 0;
  }
  $('door').addEventListener('click', doorAction);
  function frameScene() { fitRect(S.scene.frame()); }
  function frameBay() { fitRect(S.scene.bayFocus(S.hull)); }
  function toggleCine() {
    cam.tilt = cam.tilt > 0.01 ? 0 : 38;
    $('s-tilt').value = String(cam.tilt);
    $('o-tilt').textContent = cam.tilt.toFixed(0);
    $('v-cine').classList.toggle('on', cam.tilt > 0.01);
    syncCamera();
  }
  $('v-frame').addEventListener('click', frameScene);
  $('v-bay').addEventListener('click', frameBay);
  $('v-cine').addEventListener('click', toggleCine);

  const tonsSel = $('sel-tons');
  for (const t of CARGO_TONNES_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(t);
    o.textContent = `${fmt(t, t < 1 ? 1 : 0)} t / kontener${t === CARGO_TONNES_DEFAULT ? ' (propozycja)' : ''}`;
    tonsSel.appendChild(o);
  }
  tonsSel.value = String(S.tons);
  tonsSel.addEventListener('change', () => { S.tons = Number(tonsSel.value); updateCapacity(); });
  const mixSel = $('sel-mix');
  for (const k of Object.keys(CARGO_MIXES)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = k.replace(/_/g, ' ');
    mixSel.appendChild(o);
  }
  mixSel.addEventListener('change', () => { S.mix = mixSel.value; if (S.sceneName === 'zaladunek' || S.sceneName === 'rozladunek') setScene(S.sceneName, S.hull); });

  function updateCapacity() {
    const H = CARGO_BAY_HULLS[S.hull];
    const cap = cargoHullCapacity(H, S.tons);
    const lines = [`${H.label} — ${H.renderLength} j. długości`];
    for (const g of cargoHullBays(H)) {
      const door = g.door === 'over' ? `Venator nad poszycie, ${g.leafCount} skrz./stronę` : 'Venator pod poszycie (kieszeń)';
      lines.push(`  ${g.bay.label}: ${fmt(2 * g.halfA)} × ${fmt(2 * g.halfB)} × ${fmt(g.depth, 1)} j.`);
      lines.push(`    ${door}; moduły ${g.cols} × ${g.rows} po ${g.module.nx}×${g.module.ny}×${g.module.nz}`);
    }
    lines.push(`kontenery ${fmt(cap.containers)} × ${fmt(S.tons, S.tons < 1 ? 1 : 0)} t = ${fmt(cap.tonnes)} t`);
    lines.push(`dziś ${fmt(H.cargoToday)} t (${H.todayNote}) → ×${fmt(cap.tonnes / H.cargoToday, 1)}`);
    lines.push(`ruda miedzi: ${fmt(cap.tonnes / CARGO_COPPER_ROCK_ORE_T, 1)} skały po ${CARGO_COPPER_ROCK_ORE_T} t`);
    $('cap').textContent = lines.join('\n');
    const rows = cargoCapacityTable(S.tons).map((r) => `<tr><td>${r.label}</td><td class="n">${fmt(r.containers)}</td>` +
      `<td class="n">${fmt(r.tonnes)}</td><td class="n">${fmt(r.today)}</td><td class="n">${fmt(r.rocks, 1)}</td></tr>`).join('');
    $('captable').innerHTML = `<table class="capt"><tr><th>kadłub</th><th>kont.</th><th>t</th><th>dziś t</th><th>skały</th></tr>${rows}</table>`;
  }

  function bindRange(id, fn, fmtFn = (v) => v.toFixed(2)) {
    const el = $(id);
    const out = $(id.replace('s-', 'o-'));
    const upd = () => { if (out) out.textContent = fmtFn(Number(el.value)); fn(Number(el.value)); };
    el.addEventListener('input', upd);
    upd();
  }
  let sunAz = 128;
  let sunElev = 30;
  const applySun = () => setCargoSun(THREE.MathUtils.degToRad(sunAz), sunElev, 0.03);
  bindRange('s-sun', (v) => { sunAz = v; applySun(); }, (v) => v.toFixed(0));
  bindRange('s-elev', (v) => { sunElev = v; applySun(); }, (v) => v.toFixed(0));
  bindRange('s-lamp', (v) => { CARGO_LIGHT.lampGain.value = v; });
  bindRange('s-tilt', (v) => { cam.tilt = v; syncCamera(); }, (v) => v.toFixed(0));
  $('c-bloom').addEventListener('change', (e) => { uBloomOn.value = e.target.checked ? 1 : 0; });
  $('c-shadows').addEventListener('change', (e) => { S.shadows = e.target.checked; });

  // ---------------------------------------------------------------------------
  // Wejście

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
    if (cam.tilt < 0.01) {
      const p = screenToPlane(e.clientX, e.clientY, _v);
      if (p) {
        cam.anchor = { on: true, wx: p.x, wy: p.y, nx: (e.clientX / innerWidth) * 2 - 1, ny: -(e.clientY / innerHeight) * 2 + 1 };
      }
    }
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k >= '1' && k <= '4') setScene(['galeria', 'otwieranie', 'zaladunek', 'rozladunek'][Number(k) - 1]);
    if (k === 'h') $('panel').classList.toggle('hidden');
    if (k === 'o' || k === 'r') doorAction();
    if (k === 'f') frameScene();
    if (k === 'b') frameBay();
    if (k === 'c') toggleCine();
    if (k === '[') stepHull(-1);
    if (k === ']') stepHull(1);
    if (k === ' ') { e.preventDefault(); setSpeed(S.speed > 0 ? 0 : 1); }
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
    if (moved) { cam.anchor.on = false; cam.fly = null; }
    if (cam.fly) {
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

  function frame(dt) {
    const t0 = performance.now();
    S.t += dt * S.speed;
    S.frames++;
    updateCamera(dt);
    CARGO_LIGHT.time.value = S.t;
    pools.containers.begin();
    pools.drones.begin();
    pools.lights.begin();
    pools.shadows.begin();
    S.info = S.scene.update(S.t) || {};
    if (!S.shadows) pools.shadows.begin();
    pools.containers.commit();
    pools.drones.commit();
    pools.lights.commit(camera, S.pxPerUnit);
    pools.shadows.commit();
    sky.fit(camera);
    pipeline.render();
    S.draw = renderer.info.render.drawCalls;
    S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    if (timestamps && (S.frames % 8) === 0) renderer.resolveTimestampsAsync('render').then((ms) => { if (Number.isFinite(ms)) S.gpuMs = ms; });
  }

  const statsEl = $('stats');
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
    let scene = '';
    if (S.sceneName === 'zaladunek' || S.sceneName === 'rozladunek') {
      scene = `moduły: ładownia ${I.inBay} · plac ${I.onYard} · w locie ${I.carried} / ${I.N}\n` +
        `drony ${I.drones} / ${I.D}   czas ${fmt(I.phase || 0, 1)} / ${fmt(I.period || 0, 0)} s\n`;
    } else if (S.sceneName === 'otwieranie') {
      scene = `wrota ${fmt((I.door || 0) * 100)}%\n`;
    }
    statsEl.textContent =
      `FPS ${S.fps.toFixed(0)} (${W}×${H})  CPU ${S.cpuMs.toFixed(2)} ms  GPU ${timestamps ? S.gpuMs.toFixed(2) : '—'} ms\n` +
      `zoom gry ×${S.pxPerUnit.toFixed(2)}  kontenery ${fmt(I.containers || 0)}  światła ${pools.lights.count}\n` +
      `draw ${S.draw ?? '—'}  ładownie ${CargoBayTable.count}\n` + scene;
  }

  // ---------------------------------------------------------------------------
  // Pętla (pod ?test=1 klatki tylko z step(n), pętla rAF three zostaje — węzły odświeżają klatkę)

  let pendingSteps = 0;
  let stepDone = null;
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
      safeFrame(1 / 60);
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
  setSpeed(1);
  const startScene = ['galeria', 'otwieranie', 'zaladunek', 'rozladunek'].includes(params.get('scena')) ? params.get('scena') : 'galeria';
  setScene(startScene, S.hull, true);
  $('backend').textContent = `WebGPU · ${timestamps ? 'pomiar czasu GPU' : 'bez pomiaru czasu GPU'} · three r${THREE.REVISION}`;

  window.__demo = {
    ready: true,
    S, cam, renderer, scene, camera, pools,
    step(n = 1) {
      return new Promise((resolve) => { pendingSteps = Math.max(1, n | 0); stepDone = resolve; });
    },
    scene: (name, hull) => { setScene(name, hull); return S.sceneName; },
    setTime(t) { S.t = Number(t) || 0; return S.t; },
    pause(on = true) { setSpeed(on ? 0 : 1); return S.speed; },
    speed: (v) => setSpeed(v),
    hull: (id) => selectHull(id),
    door: () => doorAction(),
    lookAt(x, y, zoom) {
      cam.fly = null; cam.anchor.on = false;
      cam.x = x; cam.y = y;
      if (zoom) cam.d = cam.td = clamp((innerHeight * 0.5) / (zoom * TAN_H), D_MIN, D_MAX);
      syncCamera();
    },
    frame(id) {
      const r = S.sceneName === 'galeria' ? (id ? S.scene.frameOf(id) : S.scene.frame()) : S.scene.frame();
      fitRect(r, true);
      syncCamera();
      return r;
    },
    /** Kadr ładowni kadłuba id (jak klik w panelu w galerii); zoom — nadpisanie (px/j.). */
    focus(id = S.hull, zoom = null) {
      const r = S.scene.bayFocus(id);
      fitRect(r, true);
      if (zoom) {
        cam.d = cam.td = clamp(dForZoom(zoom), D_MIN, D_MAX);
        // Środek treści w wolnym obszarze (przesunięcie panelu przy nowym zoomie).
        cam.x = r.x - (PANEL_W / 2) / zoom;
      }
      syncCamera();
      return r;
    },
    tilt(deg = 38, az = 0) { cam.tilt = deg; cam.az = az; syncCamera(); return cam.tilt; },
    sun(azDeg, elevDeg) { sunAz = azDeg; sunElev = elevDeg ?? sunElev; applySun(); },
    stats() {
      return {
        fps: S.fps, cpuMs: S.cpuMs, gpuMs: S.gpuMs, scene: S.sceneName, hull: S.hull, t: S.t,
        drawCalls: S.draw ?? renderer.info.render.drawCalls, bays: CargoBayTable.count, lights: pools.lights.count,
        shadows: pools.shadows.hull.count + pools.shadows.contact.count, ...S.info
      };
    },
    capacity: (t = S.tons) => cargoCapacityTable(t)
  };
}

main().catch((e) => {
  showError(`Start: ${e?.stack || e}`);
  window.__demo = { ready: false, error: 'start', detail: String(e?.message || e) };
});
