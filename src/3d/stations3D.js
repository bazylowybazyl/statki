import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const templateCache = new Map();
const stationRecords = new Map();

// Sprites per-station: render 3D->2D jak piracka stacja
let ownScene = null;
let previewCam = null;            // mała kamera do renderu pojedynczej stacji
let activeScene = null;           // = ownScene
let sharedRendererWarned = false;
const SPRITE_SIZE = 512;

const TMP_COLOR = new THREE.Color();
const TMP_VIEWPORT = new THREE.Vector4();
const TMP_SCISSOR = new THREE.Vector4();

function ensureOwnScene() {
  if (!ownScene) {
    ownScene = new THREE.Scene();
    // światła minimalistyczne, wystarczające dla GLB
    ownScene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(500, 800, 1000);
    ownScene.add(dir);
  }
  return ownScene;
}

function getSharedRenderer(width, height) {
  if (typeof window === 'undefined') return null;
  const getter = window.getSharedRenderer;
  if (typeof getter !== 'function') {
    if (!sharedRendererWarned) {
      console.warn('Stations3D: shared renderer unavailable');
      sharedRendererWarned = true;
    }
    return null;
  }
  return getter(width, height);
}

function ensurePreviewCamera() {
  if (!previewCam) {
    previewCam = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    previewCam.position.set(60, 28, 60);
    previewCam.lookAt(0, 0, 0);
  }
  return previewCam;
}

const STATION_KEY_PROP = '__station3DKey';
let stationKeySequence = 0;

const MODEL_URLS = {
  earth: [
    new URL('../stations/earth-station.glb', import.meta.url).href,
    new URL('../stations/Earth-station.glb', import.meta.url).href
  ],
  mars: [
    new URL('../stations/mars-station.glb', import.meta.url).href,
    new URL('../stations/Mars-station.glb', import.meta.url).href
  ],
  jupiter: [
    new URL('../stations/jupiter-station.glb', import.meta.url).href,
    new URL('../stations/Jupiter-station.glb', import.meta.url).href
  ],
  neptune: [
    new URL('../stations/neptune-station.glb', import.meta.url).href,
    new URL('../stations/Neptune-station.glb', import.meta.url).href
  ]
};

function getStationKey(station) {
  if (!station) return null;
  if (!Object.prototype.hasOwnProperty.call(station, STATION_KEY_PROP)) {
    const suffix = (++stationKeySequence).toString(36);
    const baseId = station.id != null ? String(station.id) : `station-${suffix}`;
    const key = `${baseId}__${suffix}`;
    Object.defineProperty(station, STATION_KEY_PROP, {
      value: key,
      configurable: true,
      enumerable: false,
      writable: false
    });
  }
  return station[STATION_KEY_PROP];
}

function getModelUrlsForStation(station) {
  const tryStr = (v) => (typeof v === 'string' ? v.toLowerCase() : '');
  const id = tryStr(station?.id);
  const name = tryStr(station?.name);
  const style = tryStr(station?.style);
  const planet = tryStr(station?.planet?.name) || tryStr(station?.planet?.id);
  const orbit = tryStr(station?.orbit?.name);
  const host = tryStr(station?.host) || tryStr(station?.home);
  const candidates = [id, name, style, planet, orbit, host].filter(Boolean).join(' ');
  const keys = Object.keys(MODEL_URLS);
  const hit = keys.find((k) => candidates.includes(k));
  return hit ? MODEL_URLS[hit] : null;
}

function isPirateStation(station) {
  if (!station) return false;
  const name = typeof station.name === 'string' ? station.name.toLowerCase() : '';
  const style = typeof station.style === 'string' ? station.style.toLowerCase() : '';
  const piratey = /\bpir(?:ate)?\b/;
  return station.isPirate === true
    || String(station.type).toLowerCase() === 'pirate'
    || style === 'pirate'
    || piratey.test(name);
}

function getDevScale() {
  if (typeof window === 'undefined') return 1;
  const devValue = window.Dev?.station3DScale;
  const tuning = window.DevTuning?.pirateStationScale;
  const value = Number.isFinite(devValue) ? devValue : Number.isFinite(tuning) ? tuning : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function getPerStationScaleMap() {
  if (typeof window === 'undefined') return {};
  const cfg = (window.DevConfig && window.DevConfig.stationScaleById) || {};
  const tun = (window.DevTuning && window.DevTuning.stationScaleById) || {};
  const fb = window.stationScaleById || {};
  return Object.assign({}, fb, tun, cfg);
}

function getStationIdKey(station) {
  const raw = station?.id ?? station?.planet?.id ?? station?.planet?.name ?? '';
  return String(raw).toLowerCase();
}

function isUse3DEnabled() {
  if (typeof window === 'undefined') return true;
  // domyślnie ON (ustaw window.USE_STATION_3D=false aby wyłączyć)
  return window.USE_STATION_3D !== false;
}

function disableShadows(object) {
  object.traverse?.((node) => {
    if (node && (node.isMesh || node.isPoints || node.isLine)) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
}

// zawsze rysuj "jak overlay" (ponad geometrią planet)
function elevateOverlay(object) {
  object.traverse?.((node) => {
    if (node && (node.isMesh || node.isPoints || node.isLine)) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m) continue;
        m.depthTest = false;
        m.depthWrite = false;
        m.transparent = true; // stabilniejsza kolejność
      }
      node.renderOrder = 10000; // ponad planetami
    }
  });
}

function loadTemplate(url) {
  if (!templateCache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        const scene = gltf?.scene || (Array.isArray(gltf?.scenes) ? gltf.scenes[0] : null);
        if (!scene) {
          reject(new Error(`GLTF at ${url} has no scene`));
          return;
        }
        disableShadows(scene);
        resolve(scene);
      }, undefined, (err) => {
        reject(err);
      });
    });
    templateCache.set(url, promise);
  }
  return templateCache.get(url);
}

async function loadTemplateWithFallback(urls) {
  if (!urls || !urls.length) throw new Error('No model URLs provided');
  let lastError = null;
  for (const url of urls) {
    try {
      const template = await loadTemplate(url);
      if (template) return template;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  throw new Error('Failed to load station model');
}

function removeRecord(record) {
  if (!record) return;
  const group = record.group;
  if (group && group.parent) {
    group.parent.remove(group);
  }
  if (record.stationRef) {
    if (record.stationRef._mesh3d === group) {
      delete record.stationRef._mesh3d;
    }
    if (Object.prototype.hasOwnProperty.call(record.stationRef, STATION_KEY_PROP)) {
      delete record.stationRef[STATION_KEY_PROP];
    }
  }
  record.group = null;
  record.stationRef = null;
  record.spriteCanvas = null;
  record.spriteCtx = null;
  record.lastSpriteTime = 0;
}

function ensureStationRecord(station) {
  const key = getStationKey(station);
  if (!key) return null;
  let record = stationRecords.get(key);
  if (!record) {
    record = {
      key,
      stationRef: station,
      group: null,
      template: null,
      geometryRadius: 1,
      loadingPromise: null,
      spinOffset: Math.random() * Math.PI * 2,
      spriteCanvas: null,
      spriteCtx: null,
      lastSpriteTime: 0
    };
    stationRecords.set(key, record);
  } else {
    record.stationRef = station;
  }
  return record;
}

function ensureStationObject(record, station) {
  if (!record || !station) return null;
  if (record.group || record.loadingPromise) return record.loadingPromise;
  if (!activeScene) return null;
  const urls = getModelUrlsForStation(station);
  if (!urls) return null;
  // Preferuj runtime'owy promień (po skalowaniu), potem bazowy:
  const targetRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
  const targetRadius = Number.isFinite(targetRadiusRaw) && targetRadiusRaw > 0 ? targetRadiusRaw : 1;
  const promise = loadTemplateWithFallback(urls)
    .then((template) => {
      if (!template || !stationRecords.has(record.key)) return null;
      record.template = template;
      const clone = SkeletonUtils.clone(template);
      disableShadows(clone);
      elevateOverlay(clone); // <- stacje zawsze nad planetami

      const wrapper = new THREE.Group();
      wrapper.name = `station3d:${station.id ?? record.key}`;
      wrapper.add(clone);
      // gwarantuj, że cała grupa ma priorytet nad resztą sceny
      wrapper.renderOrder = 10001;

      const bbox = new THREE.Box3().setFromObject(wrapper);
      const center = bbox.getCenter(new THREE.Vector3());
      clone.position.sub(center);
      wrapper.updateMatrixWorld(true);

      bbox.setFromObject(wrapper);
      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      const geometryRadius = sphere?.radius && sphere.radius > 0 ? sphere.radius : 1;

      record.geometryRadius = geometryRadius;
      wrapper.userData.geometryRadius = geometryRadius;
      const baseScale = targetRadius / geometryRadius;
      wrapper.userData.baseScale = baseScale;
      wrapper.userData.stationId = station.id ?? record.key;
      wrapper.userData.targetRadius = targetRadius;

      record.group = wrapper;

      const devScale = getDevScale();
      const visible = isUse3DEnabled();
      updateRecordTransform(record, station, devScale, visible);

      // MODEL w (0,0,0). Pozycjonowanie na ekranie robi 2D drawImage.
      wrapper.position.set(0, 0, 0);
      const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
      wrapper.rotation.y = baseAngle + (record.spinOffset ?? 0);

      if (activeScene && !wrapper.parent) {
        activeScene.add(wrapper);
      }
      station._mesh3d = wrapper;
      return wrapper;
    })
    .catch((err) => {
      console.error('Failed to load station 3D model:', err);
      return null;
    })
    .finally(() => {
      record.loadingPromise = null;
    });

  record.loadingPromise = promise;
  return promise;
}

function updateRecordTransform(record, station, devScale, visible) {
  const group = record.group;
  if (!group) return;
  if (activeScene && group.parent !== activeScene) {
    activeScene.add(group);
  }
  const geometryRadius = record.geometryRadius || group.userData.geometryRadius || 1;
  const desiredRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
  const desiredRadius = Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0 ? desiredRadiusRaw : 1;
  const baseScale = desiredRadius / geometryRadius;
  group.userData.baseScale = baseScale;
  group.userData.geometryRadius = geometryRadius;
  group.userData.targetRadius = desiredRadius;

  const perMap = getPerStationScaleMap();
  const idKey = getStationIdKey(station);
  const perScale = Number(perMap[idKey]) || 1;

  const globalScalar = Number.isFinite(devScale) && devScale > 0 ? devScale : 1;
  const devScalar = globalScalar * perScale;
  group.scale.setScalar(baseScale * devScalar);

  group.visible = visible;
  station._mesh3d = group;
}

export function initStations3D(_sceneIgnored, stations) {
  activeScene = ensureOwnScene();
  if (!activeScene || !Array.isArray(stations)) return;

  const activeKeys = new Set();
  for (const station of stations) {
    if (!station || isPirateStation(station)) continue;
    if (!getModelUrlsForStation(station)) {
      if (station._mesh3d) {
        if (station._mesh3d.parent) station._mesh3d.parent.remove(station._mesh3d);
        delete station._mesh3d;
      }
      continue;
    }
    const record = ensureStationRecord(station);
    if (!record) continue;
    activeKeys.add(record.key);
    if (record.group) {
      if (record.group.parent !== activeScene) {
        activeScene.add(record.group);
      }
      station._mesh3d = record.group;
    } else {
      ensureStationObject(record, station);
    }
  }

  for (const [key, record] of stationRecords) {
    if (!activeKeys.has(key)) {
      removeRecord(record);
      stationRecords.delete(key);
    }
  }
}

export function updateStations3D(stations) {
  if (!Array.isArray(stations) || !activeScene) return;
  const devScale = getDevScale();
  const visible = isUse3DEnabled();
  const activeKeys = new Set();

  for (const station of stations) {
    if (!station || isPirateStation(station)) continue;
    if (!getModelUrlsForStation(station)) continue;
    const record = ensureStationRecord(station);
    if (!record) continue;
    activeKeys.add(record.key);
    if (!record.group) {
      ensureStationObject(record, station);
      continue;
    }
    updateRecordTransform(record, station, devScale, visible);
  }

  for (const [key, record] of stationRecords) {
    if (!activeKeys.has(key)) {
      removeRecord(record);
      stationRecords.delete(key);
    }
  }
}

function ensureSpriteTarget(record) {
  if (!record.spriteCanvas) {
    record.spriteCanvas = document.createElement('canvas');
    record.spriteCanvas.width = SPRITE_SIZE;
    record.spriteCanvas.height = SPRITE_SIZE;
    record.spriteCtx = record.spriteCanvas.getContext('2d');
  }
  return record.spriteCanvas;
}

function resetRenderer(renderer, w, h) {
  if (!renderer) return;
  if (typeof renderer.setRenderTarget === 'function') renderer.setRenderTarget(null);
  if (typeof renderer.setSize === 'function') renderer.setSize(w, h, false);
  if (typeof renderer.setViewport === 'function') renderer.setViewport(0, 0, w, h);
  if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(false);
  if (typeof renderer.setClearColor === 'function') renderer.setClearColor(0x000000, 0);
  if (typeof renderer.clear === 'function') renderer.clear(true, true, false);
}

function renderStationSprite(record) {
  if (!record.group) return;
  const scene = ensureOwnScene();
  const cam = ensurePreviewCamera();
  const renderer = getSharedRenderer(SPRITE_SIZE, SPRITE_SIZE);
  if (!renderer) return;

  const prevAutoClear = renderer.autoClear;
  const prevTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
  const hasViewport = typeof renderer.getViewport === 'function' && typeof renderer.setViewport === 'function';
  const prevViewport = hasViewport ? renderer.getViewport(TMP_VIEWPORT) : null;
  const hasScissor = typeof renderer.getScissor === 'function' && typeof renderer.setScissor === 'function';
  const prevScissor = hasScissor ? renderer.getScissor(TMP_SCISSOR) : null;
  const prevScissorTest = typeof renderer.getScissorTest === 'function'
    ? renderer.getScissorTest()
    : (renderer.state?.scissor?.test ?? false);
  const prevAlpha = typeof renderer.getClearAlpha === 'function' ? renderer.getClearAlpha() : undefined;
  let prevColorR = null;
  let prevColorG = null;
  let prevColorB = null;
  if (typeof renderer.getClearColor === 'function') {
    const color = renderer.getClearColor(TMP_COLOR);
    if (color) {
      prevColorR = color.r;
      prevColorG = color.g;
      prevColorB = color.b;
    }
  }

  // pokaż tylko tę jedną stację
  const prevVis = [];
  for (const [, rec] of stationRecords) {
    if (!rec.group) continue;
    prevVis.push([rec.group, rec.group.visible]);
    rec.group.visible = rec === record;
  }

  const R = Math.max(1, record.geometryRadius || record.group.userData.geometryRadius || 1);
  const dist = Math.max(60, R * 2.4);
  cam.position.set(dist, dist * 0.62, dist);
  cam.lookAt(0, 0, 0);

  resetRenderer(renderer, SPRITE_SIZE, SPRITE_SIZE);
  renderer.autoClear = true;
  renderer.render(scene, cam);

  const spriteCanvas = ensureSpriteTarget(record);
  const spriteCtx = record.spriteCtx;
  if (spriteCanvas && spriteCtx && renderer.domElement) {
    spriteCtx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    spriteCtx.drawImage(renderer.domElement, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    record.lastSpriteTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  // przywróć widoczności
  for (const [group, visible] of prevVis) {
    group.visible = visible;
  }

  // przywróć ustawienia renderera
  renderer.autoClear = prevAutoClear;
  if (prevViewport && typeof renderer.setViewport === 'function') {
    renderer.setViewport(prevViewport.x, prevViewport.y, prevViewport.z, prevViewport.w);
  }
  if (prevScissor && typeof renderer.setScissor === 'function') {
    renderer.setScissor(prevScissor.x, prevScissor.y, prevScissor.z, prevScissor.w);
  }
  if (typeof renderer.setScissorTest === 'function') {
    renderer.setScissorTest(!!prevScissorTest);
  }
  if (prevColorR !== null && typeof renderer.setClearColor === 'function') {
    TMP_COLOR.setRGB(prevColorR, prevColorG, prevColorB);
    renderer.setClearColor(TMP_COLOR, prevAlpha ?? 0);
  }
  if (typeof renderer.setRenderTarget === 'function') {
    renderer.setRenderTarget(prevTarget || null);
  }
}

export function drawStations3D(ctx, cam, worldToScreen) {
  if (!isUse3DEnabled()) return;
  if (!ctx || !ctx.canvas) return;
  const devScale = getDevScale();
  const globalScalar = Number.isFinite(devScale) && devScale > 0 ? devScale : 1;
  const perMap = getPerStationScaleMap();
  const zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
  if (!Number.isFinite(zoom) || zoom <= 0) return;
  const hasW2S = typeof worldToScreen === 'function';
  const canvasWidth = ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.canvas?.height ?? 0;

  for (const [, record] of stationRecords) {
    const st = record.stationRef;
    if (!st || !record.group) continue;

    // aktualizacja rotacji (spin)
    const baseAngle = typeof st.angle === 'number' ? st.angle : 0;
    record.spinOffset = (record.spinOffset ?? 0) + 0.002;
    record.group.rotation.y = baseAngle + record.spinOffset;

    const idKey = getStationIdKey(st);
    const perScale = Number(perMap[idKey]) || 1;
    const effectiveScalar = globalScalar * perScale;
    const radiusWorld = Math.max(1, (Number.isFinite(st.r) ? st.r : st.baseR) || 1) * effectiveScalar;
    const sizePx = radiusWorld * 2 * zoom;
    if (!hasW2S) continue;
    const screen = worldToScreen(st.x || 0, st.y || 0, cam);
    if (!screen) continue;
    if (canvasWidth > 0 && canvasHeight > 0) {
      const half = sizePx / 2;
      if (screen.x + half < 0 || screen.x - half > canvasWidth || screen.y + half < 0 || screen.y - half > canvasHeight) {
        continue;
      }
    }

    renderStationSprite(record);
    if (!record.spriteCanvas) continue;
    const offsetY = sizePx * 0.55;
    ctx.drawImage(record.spriteCanvas, screen.x - sizePx / 2, screen.y - offsetY, sizePx, sizePx);
  }
}

export function detachPlanetStations3D(sceneOverride) {
  const targetScene = ownScene || sceneOverride || activeScene;
  for (const record of stationRecords.values()) {
    if (record.group && targetScene && record.group.parent === targetScene) {
      targetScene.remove(record.group);
    }
    if (record.stationRef && record.stationRef._mesh3d === record.group) {
      delete record.stationRef._mesh3d;
    }
    if (record.stationRef && Object.prototype.hasOwnProperty.call(record.stationRef, STATION_KEY_PROP)) {
      delete record.stationRef[STATION_KEY_PROP];
    }
    record.group = null;
    record.stationRef = null;
  }
  stationRecords.clear();
  if (!sceneOverride || sceneOverride === activeScene) {
    activeScene = null;
  }
}

export function setStationScale(id, scale = 1) {
  if (typeof window === 'undefined') return;
  const key = String(id ?? '').toLowerCase();
  if (!key) return;
  if (!window.DevConfig) window.DevConfig = {};
  if (!window.DevConfig.stationScaleById) window.DevConfig.stationScaleById = {};
  window.DevConfig.stationScaleById[key] = Number(scale) || 1;

  const devScale = getDevScale();
  for (const rec of stationRecords.values()) {
    const st = rec.stationRef;
    if (!st) continue;
    if (getStationIdKey(st) === key && rec.group) {
      updateRecordTransform(rec, st, devScale, rec.group.visible !== false);
    }
  }

  if (typeof document !== 'undefined') {
    const slider = document.getElementById(`dt-scale-station-${key}`);
    if (slider) {
      const numeric = Number(window.DevConfig.stationScaleById[key]) || 1;
      slider.value = String(numeric);
      const valEl = slider.nextElementSibling;
      if (valEl && typeof valEl.textContent === 'string') {
        valEl.textContent = numeric.toFixed(2);
      }
    }
  }

  if (typeof window.__devtoolsSaveLS === 'function') window.__devtoolsSaveLS();
  if (typeof window.__saveDevLS === 'function') window.__saveDevLS();
}

export function getStationScales() {
  return getPerStationScaleMap();
}

if (typeof window !== 'undefined') {
  window.setStationScale = setStationScale;
  window.getStationScales = getStationScales;
}
