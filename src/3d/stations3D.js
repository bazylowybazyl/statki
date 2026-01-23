import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const loader = new GLTFLoader();
const templateCache = new Map();
const stationRecords = new Map();

// Sprites per-station variables
let ownScene = null;
let previewCam = null;
let activeScene = null;
let ambLight = null;
let dirLight = null;

// FIX: Lokalny renderer, aby uniknąć konfliktów z głównym silnikiem gry
let localRenderer = null; 

// Stałe konfiguracyjne
const DEFAULT_STATION_SPRITE_SIZE = 512;
const DEFAULT_STATION_SPRITE_FRAME = 3.0; // Domyślny zoom na sprite
const MIN_SPRITE_RENDER_INTERVAL = 0;
const FRAME_EPSILON = 0.001;

function getStationSpriteSize() {
  let fromCfg = NaN;
  let fromLS = NaN;
  if (typeof window !== 'undefined') {
    if (window.DevConfig && typeof window.DevConfig === 'object') {
      fromCfg = Number(window.DevConfig.stationSpriteSize);
    }
    try { fromLS = Number(window.localStorage?.getItem('stationSpriteSize')); } catch {}
  }
  let v = Number.isFinite(fromCfg) ? fromCfg : Number.isFinite(fromLS) ? fromLS : DEFAULT_STATION_SPRITE_SIZE;
  v = Math.max(64, Math.min(4096, Math.round(v)));
  return v;
}

const TMP_COLOR = new THREE.Color();
const TMP_VIEWPORT = new THREE.Vector4();
const TMP_SCISSOR = new THREE.Vector4();

function approxEqual(a, b, eps = FRAME_EPSILON) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= eps;
}

function markSpriteDirty(record) {
  if (record) {
    record.forceSpriteRefresh = true;
    record.lastSpriteTime = 0;
  }
}

function initScene() {
  if (ownScene) return ownScene;
  ownScene = new THREE.Scene();
  activeScene = ownScene;

  // --- OŚWIETLENIE "PÓŁ NA PÓŁ" (Terminator Line) ---
  
  // 1. Światło Ambient (rozproszone) - BARDZO CIEMNE
  // Dzięki temu strona odwrócona od słońca będzie prawie czarna
  if (ambLight) ownScene.remove(ambLight);
  ambLight = new THREE.AmbientLight(0xffffff, 0.15); 
  ownScene.add(ambLight);

  // 2. Światło Kierunkowe (Słońce) - BARDZO JASNE
  // To światło będzie poruszane w funkcji renderStationSprite
  if (dirLight) ownScene.remove(dirLight);
  dirLight = new THREE.DirectionalLight(0xffffff, 3.5);
  
  // Parametry cieni dla wysokiej jakości
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.0005; // Zapobiega "shadow acne"
  dirLight.shadow.normalBias = 0.02;
  
  ownScene.add(dirLight);
  ownScene.userData.dirLight = dirLight;

  // 3. Environment Map (Odbicia) - zmniejszona intensywność, żeby nie rozjaśniała cieni
  const pmremGenerator = new THREE.PMREMGenerator(new THREE.WebGLRenderer());
  pmremGenerator.compileEquirectangularShader();
  const envTexture = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  ownScene.environment = envTexture;
  ownScene.environmentIntensity = 0.4; // Zmniejszone odbicia otoczenia

  // Kamera
  const S = getStationSpriteSize();
  const H = S / 2;
  previewCam = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
  previewCam.position.set(0, 0, 100);
  previewCam.lookAt(0, 0, 0);
  ownScene.add(previewCam);

  return ownScene;
}

function getSharedRenderer(width, height) {
  // 1. Próba użycia globalnego
  if (typeof window !== 'undefined' && typeof window.getSharedRenderer === 'function') {
    const r = window.getSharedRenderer(width, height);
    if (r) return r;
  }

  // 2. Fallback: Własny renderer z FIXEM NA MIGOTANIE (Logarithmic Depth)
  if (!localRenderer) {
    localRenderer = new THREE.WebGLRenderer({ 
        alpha: true, 
        antialias: true, 
        preserveDrawingBuffer: true,
        logarithmicDepthBuffer: true // <--- FIX Z-FIGHTING
    });
    localRenderer.setPixelRatio(1);
    localRenderer.outputColorSpace = THREE.SRGBColorSpace;
    localRenderer.shadowMap.enabled = true;
    localRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  
  const size = localRenderer.getSize(new THREE.Vector2());
  if (size.x !== width || size.y !== height) {
      localRenderer.setSize(width, height, false);
  }
  
  return localRenderer;
}

function ensurePreviewCamera() {
  if (!previewCam) {
    initScene();
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

function getTemplate(stationId, path) {
  if (templateCache.has(path)) {
    return templateCache.get(path);
  }

  const placeholder = { scene: null, materials: [], error: false, loading: true };
  templateCache.set(path, placeholder);

  loader.load(
    path,
    (gltf) => {
      const scene = gltf.scene;
      
      const maxAnisotropy = localRenderer ? localRenderer.capabilities.getMaxAnisotropy() : 4;

      scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; 

        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          if (!m) continue;
          
          if (m.map) m.map.anisotropy = maxAnisotropy;
          if (m.normalMap) m.normalMap.anisotropy = maxAnisotropy;
          if (m.roughnessMap) m.roughnessMap.anisotropy = maxAnisotropy;
          if (m.metalnessMap) m.metalnessMap.anisotropy = maxAnisotropy;

          m.side = THREE.DoubleSide; 
          m.transparent = false;
          m.depthWrite = true;
          m.depthTest = true;
          
          if (m.map || m.alphaMap) {
            m.alphaTest = 0.5;
          }
          
          // Zmniejszamy wpływ mapy otoczenia, żeby nie rozjaśniała cieni
          m.envMapIntensity = 0.5;
          
          if (typeof m.metalness === 'number' && m.metalness < 0.1) m.metalness = 0.5; 
          if (typeof m.roughness === 'number' && m.roughness > 0.9) m.roughness = 0.6;
          
          m.needsUpdate = true;
        }
      });
      placeholder.scene = scene;
      placeholder.materials = [];
      placeholder.loading = false;
    },
    undefined,
    (err) => {
      console.warn('GLTFLoader error loading station:', path, err);
      placeholder.error = true;
      placeholder.loading = false;
    }
  );

  return placeholder;
}

function cloneTemplate(stationId, path) {
  const cacheEntry = getTemplate(stationId, path);
  if (!cacheEntry || cacheEntry.error || !cacheEntry.scene) {
    return null;
  }
  const scene = SkeletonUtils.clone(cacheEntry.scene);
  return { scene, materials: [] };
}

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
  if (hit) return MODEL_URLS[hit];

  if (!isPirateStation(station)) {
      return MODEL_URLS.earth; 
  }

  return null;
}

function isPirateStation(station) {
  if (!station) return false;
  const name = typeof station.name === 'string' ? station.name.toLowerCase() : '';
  const style = typeof station.style === 'string' ? station.style.toLowerCase() : '';
  const piratey = /\bpir(?:ate)?\b/;
  return (
    station.isPirate === true ||
    String(station.type).toLowerCase() === 'pirate' ||
    style === 'pirate' ||
    piratey.test(name)
  );
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
  if (!station) return null;
  if (station.id != null) return String(station.id).toLowerCase();
  if (station.name) return String(station.name).toLowerCase();
  if (station?.planet?.id != null) return String(station.planet.id).toLowerCase();
  if (station?.planet?.name) return String(station.planet.name).toLowerCase();
  return null;
}

function getPerStationSpriteFrame(station) {
  const key = getStationIdKey(station);
  const map =
    typeof window !== 'undefined' &&
    window.DevConfig &&
    window.DevConfig.stationSpriteFrameById
      ? window.DevConfig.stationSpriteFrameById
      : {};
  const per = Number(map && key != null ? map[key] : undefined);
  if (Number.isFinite(per)) return Math.max(0.8, Math.min(3.0, per));
  let global = Number(
    typeof window !== 'undefined' ? window.DevConfig?.stationSpriteFrame : NaN
  );
  if (!Number.isFinite(global) && typeof window !== 'undefined') {
    try {
      global = Number(window.localStorage?.getItem('stationSpriteFrame'));
    } catch {}
  }
  if (Number.isFinite(global)) return Math.max(0.8, Math.min(3.0, global));
  return DEFAULT_STATION_SPRITE_FRAME;
}

function isUse3DEnabled() {
  if (typeof window === 'undefined') return true;
  return window.USE_PLANET_STATIONS_3D !== false;
}

function disableShadows(object) {
  object.traverse?.((node) => {
    if (node && (node.isMesh || node.isPoints || node.isLine)) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
}

function loadTemplate(url) {
  if (!templateCache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const scene =
            gltf?.scene || (Array.isArray(gltf?.scenes) ? gltf.scenes[0] : null);
          if (!scene) {
            reject(new Error(`GLTF at ${url} has no scene`));
            return;
          }
          disableShadows(scene);
          resolve(scene);
        },
        undefined,
        (err) => {
          reject(err);
        }
      );
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
  record.lastSpriteSize = 0;
  record.lastSpriteFrame = NaN;
  record.lastRenderedScale = null;
  record.lastTargetRadius = null;
  record.forceSpriteRefresh = true;
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
      lastSpriteTime: 0,
      lastSpriteSize: 0,
      lastSpriteFrame: NaN,
      lastRenderedScale: null,
      lastTargetRadius: null,
      forceSpriteRefresh: true
    };
    stationRecords.set(key, record);
  } else {
    record.stationRef = station;
  }
  return record;
}

function updateRecordTransform(record, station, devScale, visible) {
  const group = record.group;
  if (!group) return;
  if (activeScene && group.parent !== activeScene) {
    activeScene.add(group);
  }
  const geometryRadius = record.geometryRadius || group.userData.geometryRadius || 1;
  const desiredRadiusRaw =
    (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
  const desiredRadius =
    Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0
      ? desiredRadiusRaw
      : 1;
  const baseScale = desiredRadius / geometryRadius;
  group.userData.baseScale = baseScale;
  group.userData.geometryRadius = geometryRadius;
  group.userData.targetRadius = desiredRadius;

  const perMap = getPerStationScaleMap();
  const idKey = getStationIdKey(station);
  const perScale = Number(perMap[idKey]) || 1;
  const globalScalar = Number.isFinite(devScale) && devScale > 0 ? devScale : 1;
  const devScalar = globalScalar * perScale;
  const effectiveScale = baseScale * devScalar;
  const scaleChanged = !approxEqual(record.lastRenderedScale, effectiveScale);
  const radiusChanged = !approxEqual(record.lastTargetRadius, desiredRadius);

  group.scale.setScalar(effectiveScale);
  if (scaleChanged || radiusChanged) {
    markSpriteDirty(record);
  }
  group.visible = visible;
  station._mesh3d = group;
  record.lastTargetRadius = desiredRadius;
}

// --- INIT STATIONS ---
export function initStations3D(_sceneIgnored, stations) {
  activeScene = initScene();
  if (!activeScene || !Array.isArray(stations)) return;

  const activeKeys = new Set();

  for (const station of stations) {
    if (!station || isPirateStation(station)) continue;

    const urls = getModelUrlsForStation(station);
    if (!urls) {
      if (station._mesh3d) {
        if (station._mesh3d.parent)
          station._mesh3d.parent.remove(station._mesh3d);
        delete station._mesh3d;
      }
      continue;
    }

    const path = urls.find(Boolean);
    if (!path) continue;

    const record = ensureStationRecord(station);
    if (!record) continue;
    activeKeys.add(record.key);

    if (record.group) {
      if (record.group.parent !== activeScene) {
        activeScene.add(record.group);
      }
      station._mesh3d = record.group;
      continue;
    }

    const clone = cloneTemplate(station.id, path);
    if (!clone) continue;

    const { scene: group } = clone;
    group.visible = false;
    activeScene.add(group);

    const bbox = new THREE.Box3().setFromObject(group);
    const center = bbox.getCenter(new THREE.Vector3());
    group.position.sub(center);
    group.updateMatrixWorld(true);

    bbox.setFromObject(group);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const geometryRadius = sphere?.radius && sphere.radius > 0 ? sphere.radius : 1;

    const desiredRadiusRaw =
      (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
    const targetRadius =
      Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0
        ? desiredRadiusRaw
        : 1;
    const baseScale = targetRadius / geometryRadius;

    group.userData.geometryRadius = geometryRadius;
    group.userData.baseScale = baseScale;
    group.userData.stationId = station.id ?? record.key;
    group.userData.targetRadius = targetRadius;

    record.group = group;
    record.geometryRadius = geometryRadius;
    record.lastRenderedScale = null;
    record.lastTargetRadius = targetRadius;
    record.lastSpriteFrame = NaN;
    record.lastSpriteSize = 0;
    record.materials = [];
    record.camera = previewCam;
    markSpriteDirty(record);

    group.position.set(0, 0, 0);
    const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
    record.spinOffset = record.spinOffset ?? Math.random() * Math.PI * 2;
    group.rotation.y = baseAngle + record.spinOffset;

    station._mesh3d = group;
  }

  for (const [key, record] of stationRecords) {
    if (!activeKeys.has(key)) {
      removeRecord(record);
      stationRecords.delete(key);
    }
  }
}

// --- UPDATE STATIONS ---
export function updateStations3D(stations) {
  if (!Array.isArray(stations)) return;
  if (!activeScene) activeScene = initScene();

  const devScale = getDevScale();
  const visible = isUse3DEnabled();
  const activeKeys = new Set();

  for (const station of stations) {
    if (!station || isPirateStation(station)) continue;
    const urls = getModelUrlsForStation(station);
    if (!urls) continue;
    const path = urls.find(Boolean);
    if (!path) continue;

    const record = ensureStationRecord(station);
    if (!record) continue;
    activeKeys.add(record.key);

    if (!record.group) {
      const clone = cloneTemplate(station.id, path);
      if (clone) {
        const { scene: group } = clone;
        group.visible = false;
        activeScene.add(group);

        const bbox = new THREE.Box3().setFromObject(group);
        const center = bbox.getCenter(new THREE.Vector3());
        group.position.sub(center);
        group.updateMatrixWorld(true);

        bbox.setFromObject(group);
        const sphere = bbox.getBoundingSphere(new THREE.Sphere());
        record.geometryRadius = sphere?.radius > 0 ? sphere.radius : 1;
        record.group = group;
        markSpriteDirty(record);
        station._mesh3d = group;
      }
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

// --- SPRITES / RENDER ---

function ensureSpriteTarget(record, sizeOverride) {
  const size = sizeOverride ?? getStationSpriteSize();
  if (!record.spriteCanvas) {
    record.spriteCanvas = document.createElement('canvas');
    record.spriteCtx = record.spriteCanvas.getContext('2d');
  }
  if (
    record.spriteCanvas.width !== size ||
    record.spriteCanvas.height !== size
  ) {
    record.spriteCanvas.width = size;
    record.spriteCanvas.height = size;
  }
  return record.spriteCanvas;
}

function resetRenderer(renderer, w, h) {
  if (!renderer) return;
  if (typeof renderer.setRenderTarget === 'function')
    renderer.setRenderTarget(null);
  if (typeof renderer.setSize === 'function') renderer.setSize(w, h, false);
  if (typeof renderer.setViewport === 'function')
    renderer.setViewport(0, 0, w, h);
  if (typeof renderer.setScissorTest === 'function')
    renderer.setScissorTest(false);
  if (typeof renderer.setClearColor === 'function')
    renderer.setClearColor(0x000000, 0);
  if (typeof renderer.clear === 'function') renderer.clear(true, true, false);
}

function renderStationSprite(record) {
  if (!record.group) return;

  const size = getStationSpriteSize();
  const zoomMul = getPerStationSpriteFrame(record.stationRef);
  const scale = record.group?.scale?.x || 1;

  const sizeChanged = record.lastSpriteSize !== size;
  const frameChanged = !approxEqual(record.lastSpriteFrame, zoomMul);
  const scaleChanged = !approxEqual(record.lastRenderedScale, scale);

  const now =
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const elapsed = record.lastSpriteTime ? now - record.lastSpriteTime : Infinity;

  if (
    !record.forceSpriteRefresh &&
    !sizeChanged &&
    !frameChanged &&
    !scaleChanged &&
    elapsed < MIN_SPRITE_RENDER_INTERVAL
  ) {
    return;
  }

  const scene = initScene();
  const cam = ensurePreviewCamera();
  const renderer = getSharedRenderer(size, size);
  if (!scene || !cam || !renderer) return;

  const prevAutoClear = renderer.autoClear;
  const prevTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
  const prevViewport = new THREE.Vector4();
  if (typeof renderer.getViewport === 'function') renderer.getViewport(prevViewport);

  const prevVis = [];
  for (const [, rec] of stationRecords) {
    if (!rec.group) continue;
    prevVis.push([rec.group, rec.group.visible]);
    rec.group.visible = rec === record;
  }

  const R_geom = Math.max(1, record.geometryRadius || record.group?.userData?.geometryRadius || 1);
  const s = record.group?.scale?.x || 1;
  const R_eff = Math.max(1, R_geom * s);

  const fovRad = (cam.fov * Math.PI) / 180;
  const distToFit = R_eff / Math.sin(fovRad / 2);
  const minSafeDist = R_eff * 1.1 + 1.0; 
  const dist = Math.max(minSafeDist, distToFit / zoomMul);

  cam.position.set(dist, dist * 0.62, dist); 
  cam.lookAt(0, 0, 0);

  // --- AKTUALIZACJA POZYCJI SŁOŃCA W RELACJI DO STACJI ---
  const sunLight = scene.userData?.dirLight;
  const stRef = record.stationRef;
  if (sunLight && stRef && typeof window !== 'undefined' && window.SUN) {
    // Wektor od stacji do słońca (w świecie gry 2D)
    const dx = (window.SUN.x ?? 0) - (stRef.x ?? 0);
    const dy = (window.SUN.y ?? 0) - (stRef.y ?? 0);
    
    // Mapowanie na 3D:
    // Game X -> Three X
    // Game Y -> Three Z (typowe mapowanie top-down)
    // Y (wysokość) -> Dajemy lekkie wzniesienie, żeby oświetlało też górę
    
    const distanceToSun = Math.max(200, dist * 2); // Odsuwamy słońce daleko
    const lightVec = new THREE.Vector3(dx, 0, dy); // Płaski wektor
    lightVec.normalize();
    
    // Dodajemy lekkie wzniesienie (elevation), np. 20 stopni w górę
    lightVec.y = 0.35; 
    lightVec.normalize();
    
    lightVec.multiplyScalar(distanceToSun);
    
    sunLight.position.copy(lightVec);
    sunLight.updateMatrixWorld();
  }

  resetRenderer(renderer, size, size);
  renderer.autoClear = false;
  renderer.clear(true, true, true);

  if (!renderer.capabilities.isWebGL2) {
    const gl = renderer.getContext();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  renderer.render(scene, cam);

  const spriteCanvas = ensureSpriteTarget(record, size);
  const spriteCtx = record.spriteCtx;
  let rendered = false;
  if (spriteCanvas && spriteCtx && renderer.domElement) {
    spriteCtx.clearRect(0, 0, size, size);
    spriteCtx.drawImage(renderer.domElement, 0, 0, size, size);
    rendered = true;
  }

  for (const [group, visible] of prevVis) {
    group.visible = visible;
  }

  renderer.autoClear = prevAutoClear;
  if (prevViewport.width > 0) {
      renderer.setViewport(prevViewport);
  }
  if (typeof renderer.setRenderTarget === 'function') renderer.setRenderTarget(prevTarget || null);

  if (rendered) {
    record.lastSpriteTime = now;
    record.lastSpriteSize = size;
    record.lastSpriteFrame = zoomMul;
    record.lastRenderedScale = scale;
    record.forceSpriteRefresh = false;
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
      if (
        screen.x + half < 0 ||
        screen.x - half > canvasWidth ||
        screen.y + half < 0 ||
        screen.y - half > canvasHeight
      ) {
        continue;
      }
    }

    renderStationSprite(record);
    if (!record.spriteCanvas) continue;

    const offsetY = sizePx * 0.55;
    ctx.drawImage(
      record.spriteCanvas,
      screen.x - sizePx / 2,
      screen.y - offsetY,
      sizePx,
      sizePx
    );
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
    if (
      record.stationRef &&
      Object.prototype.hasOwnProperty.call(record.stationRef, STATION_KEY_PROP)
    ) {
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
  if (!window.DevConfig.stationScaleById)
    window.DevConfig.stationScaleById = {};
  window.DevConfig.stationScaleById[key] = Number(scale) || 1;

  const devScale = getDevScale();
  for (const rec of stationRecords.values()) {
    const st = rec.stationRef;
    if (!st) continue;
    if (getStationIdKey(st) === key && rec.group) {
      updateRecordTransform(rec, st, devScale, rec.group.visible !== false);
    }
  }
}

// --- NOWA FUNKCJA DO OBSŁUGI KADRU ---
export function setStationSpriteFrame(id, val) {
  if (typeof window === 'undefined') return;
  const key = String(id ?? '').toLowerCase();
  if (!key) return;

  // 1. Aktualizacja konfiguracji
  if (!window.DevConfig) window.DevConfig = {};
  if (!window.DevConfig.stationSpriteFrameById) window.DevConfig.stationSpriteFrameById = {};
  window.DevConfig.stationSpriteFrameById[key] = Number(val);

  // 2. Wymuszenie odświeżenia sprite'a
  for (const rec of stationRecords.values()) {
    const st = rec.stationRef;
    if (!st) continue;
    if (getStationIdKey(st) === key) {
       markSpriteDirty(rec);
    }
  }
}

export function getStationScales() {
  return getPerStationScaleMap();
}

if (typeof window !== 'undefined') {
  window.setStationScale = setStationScale;
  window.setStationSpriteFrame = setStationSpriteFrame; // Export nowego API
  window.getStationScales = getStationScales;
  window.initStations3D = initStations3D;
  window.updateStations3D = updateStations3D;
  window.drawStations3D = drawStations3D;
  window.detachPlanetStations3D = detachPlanetStations3D;
  if (typeof window.USE_PLANET_STATIONS_3D === 'undefined') {
    window.USE_PLANET_STATIONS_3D = true;
  }
}