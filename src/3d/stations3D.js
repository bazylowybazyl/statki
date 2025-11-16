import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --- POCZĄTEK KODU DO WKLEJENIA (Krok 1) ---

// Helper skopiowany z planet3d.assets.js
function sunDirFor(worldX, worldY) {
  const sx = (window.SUN?.x ?? 0) - worldX;
  const sy = (window.SUN?.y ?? 0) - worldY;
  const L = Math.hypot(sx, sy) || 1;
  return { x: sx / L, y: -sy / L, z: 0 };
}

// Shadery skopiowane z planet3d.assets.js i lekko zmodyfikowane dla stacji

const stationVertShader = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const stationFragShader = `
  uniform sampler2D dayTexture;
  uniform vec3 uLightDirView; // Kierunek światła w 'view space'
  uniform float minAmbient;
  uniform float uIntensity;
  uniform vec3 uColor;       // Kolor bazowy (jeśli brak tekstury)
  uniform bool hasTexture;   // Flaga

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vWorldPosition;

  void main(){
    // Światło w 'view space' (tak jak robi to planet3d.assets.js)
    float ndl = max(dot(vNormalView, uLightDirView), 0.0);

    vec3 baseColor;
    if (hasTexture) {
      // sRGB do Linear (jeśli tekstura jest sRGB)
      baseColor = pow(texture2D(dayTexture, vUv).rgb, vec3(2.2));
    } else {
      // Kolor materiału też jest sRGB
      baseColor = pow(uColor, vec3(2.2));
    }

    // 'k' to współczynnik oświetlenia, 'minAmbient' to światło otoczenia
    float k = clamp(ndl, 0.0, 1.0);
    vec3 finalColor = baseColor * (minAmbient + (1.0 - minAmbient) * k);

    // Prosty rim light (efekt krawędziowy), żeby krawędzie nie były czarne
    vec3 vViewPosition = cameraPosition;
    vec3 vViewDir = normalize(vViewPosition - vWorldPosition);
    float rim = 1.0 - max(dot(normalize(vNormalView), vViewDir), 0.0);
    float rimAmount = smoothstep(0.4, 1.0, rim) * 0.25; // Mniejsza moc

    finalColor += rimAmount; // Rim light dodaje blasku

    // Mnożymy przez intensywność i na koniec konwertujemy z powrotem do sRGB
    // (Ponieważ toneMapped: true robi to automatycznie, możemy pominąć ręczną konwersję)
    gl_FragColor = vec4(finalColor * uIntensity, 1.0);
  }`;

// --- KONIEC KODU DO WKLEJENIA (Krok 1) ---

const loader = new GLTFLoader();
const templateCache = new Map();
const stationRecords = new Map();

// Sprites per-station: render 3D->2D jak piracka stacja
let ownScene = null;
let previewCam = null;            // mała kamera do renderu pojedynczej stacji
let activeScene = null;           // = ownScene
let ambLight = null;
let dirLight = null;
let sharedRendererWarned = false;
const DEFAULT_STATION_SPRITE_SIZE = 512;
const DEFAULT_STATION_SPRITE_FRAME = 1.25;
const MIN_SPRITE_RENDER_INTERVAL = 0; // ms
const FRAME_EPSILON = 0.001;

function getStationSpriteSize() {
  let fromCfg = NaN;
  let fromLS = NaN;
  if (typeof window !== 'undefined') {
    if (window.DevConfig && typeof window.DevConfig === 'object') {
      fromCfg = Number(window.DevConfig.stationSpriteSize);
    }
    try {
      fromLS = Number(window.localStorage?.getItem('stationSpriteSize'));
    } catch {}
  }
  let v = Number.isFinite(fromCfg)
    ? fromCfg
    : Number.isFinite(fromLS)
      ? fromLS
      : DEFAULT_STATION_SPRITE_SIZE;
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
  if (!record) return;
  record.forceSpriteRefresh = true;
  record.lastSpriteTime = 0;
}

// --- POCZĄTEK KODU DO WKLEJENIA (Krok 4) ---

function initScene() {
  if (ownScene) return ownScene;
  ownScene = new THREE.Scene();
  activeScene = ownScene;

  // Nasz shader ma własny ambient ('minAmbient'), więc ten może być słabszy
  if (ambLight) ownScene.remove(ambLight);
  ambLight = new THREE.AmbientLight(0xffffff, 0.15);
  ownScene.add(ambLight);

  // Usuwamy stare światło kierunkowe, shader ma własne
  if (dirLight) ownScene.remove(dirLight);
  // dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  // dirLight.position.set(2.5, 5.0, 3.5);
  // ownScene.add(dirLight);

  // Kamera do renderowania sprite'ów
  const S = getStationSpriteSize();
  const H = S / 2;
  previewCam = new THREE.PerspectiveCamera(30, 1, 1, H * 8);
  previewCam.position.set(H * 1.0, H * 0.8, H * 1.9);
  previewCam.lookAt(0, 0, 0);
  ownScene.add(previewCam);
  return ownScene;
}
// --- KONIEC KODU DO WKLEJENIA (Krok 4) ---

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

// --- POCZĄTEK NOWEJ FUNKCJI getTemplate (Krok 2) ---

function getTemplate(stationId, path) {
  if (templateCache.has(path)) {
    return templateCache.get(path);
  }

  // Obiekt tymczasowy, na wypadek gdyby wiele stacji prosiło o ten sam model
  const placeholder = { scene: null, materials: [], error: false, loading: true };
  templateCache.set(path, placeholder);

  loader.load(path, (gltf) => {
    // Kiedy model jest załadowany, przechodzimy po nim i podmieniamy materiały
    
    const customMaterials = []; // Tablica na nowe materiały
    
    gltf.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;

        if (o.material) {
          const oldMat = o.material;
          const tex = oldMat.map || null;
          // Zachowujemy oryginalny kolor materiału (ważne dla modeli bez tekstur)
          const color = oldMat.color || new THREE.Color(0xffffff);

          const uniforms = {
            dayTexture:   { value: tex },
            uLightDirView:{ value: new THREE.Vector3(1, 0, 0) }, // Domyślny kierunek
            minAmbient:   { value: 0.15 }, // Trochę jaśniej niż planety
            uIntensity:   { value: 1.5 },  // Tak jak w planetach
            uColor:       { value: color },
            hasTexture:   { value: !!tex }
          };

          const newMat = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: stationVertShader,
            fragmentShader: stationFragShader,
            toneMapped: true,
            side: THREE.DoubleSide // <--- TO JEST POPRAWKA NA "PRZENIKANIE"
          });
          
          o.material = newMat;
          customMaterials.push(newMat); // Zapisujemy materiał do aktualizacji
        }
      }
    });

    // Aktualizujemy placeholder o gotowe dane
    placeholder.scene = gltf.scene;
    placeholder.materials = customMaterials;
    placeholder.loading = false;

  }, undefined, (err) => {
    console.error('GLTFLoader error loading station:', path, err);
    placeholder.error = true;
    placeholder.loading = false;
  });

  return placeholder; // Zwracamy placeholder (który zostanie wypełniony)
}
// --- KONIEC NOWEJ FUNKCJI getTemplate (Krok 2) ---

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
  if (!station) return null;
  if (station.id != null) return String(station.id).toLowerCase();
  if (station.name) return String(station.name).toLowerCase();
  if (station?.planet?.id != null) return String(station.planet.id).toLowerCase();
  if (station?.planet?.name) return String(station.planet.name).toLowerCase();
  return null;
}

// --- POCZĄTEK KODU DO WKLEJENIA (Krok 3) ---

function cloneTemplate(stationId, path) {
  const cacheEntry = getTemplate(stationId, path);
  if (!cacheEntry || cacheEntry.error || !cacheEntry.scene) {
    // Jeśli jeszcze się ładuje, cacheEntry.scene będzie nullem
    return null;
  }

  const scene = SkeletonUtils.clone(cacheEntry.scene);
  
  // Musimy też znaleźć referencje do NOWYCH, sklonowanych materiałów
  const newMaterials = [];
  scene.traverse(o => {
    if (o.isMesh && o.material?.isShaderMaterial) {
      newMaterials.push(o.material);
    }
  });

  return { scene, materials: newMaterials }; // Zwracamy też materiały
}
// --- KONIEC KODU DO WKLEJENIA (Krok 3) ---

function getPerStationSpriteFrame(station) {
  const key = getStationIdKey(station);
  const map = (typeof window !== 'undefined' && window.DevConfig && window.DevConfig.stationSpriteFrameById)
    ? window.DevConfig.stationSpriteFrameById
    : {};
  const per = Number(map && key != null ? map[key] : undefined);
  if (Number.isFinite(per)) return Math.max(0.8, Math.min(3.0, per));
  let global = Number(typeof window !== 'undefined' ? window.DevConfig?.stationSpriteFrame : NaN);
  if (!Number.isFinite(global) && typeof window !== 'undefined') {
    let saved = NaN;
    try {
      saved = Number(window.localStorage?.getItem('stationSpriteFrame'));
    } catch {}
    global = saved;
  }
  if (Number.isFinite(global)) return Math.max(0.8, Math.min(3.0, global));
  return DEFAULT_STATION_SPRITE_FRAME;
}

function isUse3DEnabled() {
  if (typeof window === 'undefined') return true;
  // Uwaga: oddzielna flaga dla planetarnych stacji 3D (nie mylić z "3D Pirate Station").
  // Domyślnie: WŁĄCZONE (true), wyłączysz ustawiając window.USE_PLANET_STATIONS_3D = false.
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

function ensureStationObject(record, station) {
  if (!record || !station) return null;
  if (record.group || record.loadingPromise) return record.loadingPromise;
  if (!activeScene) return null;
  const urls = getModelUrlsForStation(station);
  if (!urls) return null;
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

      // promień docelowy stacji w jednostkach świata (jak w updateRecordTransform)
      const desiredRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
      const targetRadius = Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0 ? desiredRadiusRaw : 1;

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

      record.lastRenderedScale = null;
      record.lastTargetRadius = targetRadius;
      record.lastSpriteFrame = NaN;
      record.lastSpriteSize = 0;
      markSpriteDirty(record);

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

export function initStations3D(_sceneIgnored, stations) {
  activeScene = initScene();
  if (!activeScene || !Array.isArray(stations)) return;

  const activeKeys = new Set();
  for (const station of stations) {
    if (!station || isPirateStation(station)) continue;
    const urls = getModelUrlsForStation(station);
    if (!urls) {
      if (station._mesh3d) {
        if (station._mesh3d.parent) station._mesh3d.parent.remove(station._mesh3d);
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

    const { scene: group, materials } = clone; // <-- Odbierz materiały
    group.visible = false;
    activeScene.add(group);
    elevateOverlay(group);

    const bbox = new THREE.Box3().setFromObject(group);
    const center = bbox.getCenter(new THREE.Vector3());
    group.position.sub(center);
    group.updateMatrixWorld(true);

    bbox.setFromObject(group);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const geometryRadius = sphere?.radius && sphere.radius > 0 ? sphere.radius : 1;

    const desiredRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
    const targetRadius = Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0 ? desiredRadiusRaw : 1;
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
    record.materials = materials || [];
    record.camera = previewCam;
    record._lightDirWorld = record._lightDirWorld || new THREE.Vector3();
    record._lightDirView = record._lightDirView || new THREE.Vector3();
    record._viewMatrix3 = record._viewMatrix3 || new THREE.Matrix3();
    markSpriteDirty(record);

    group.position.set(0, 0, 0);
    const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
    group.rotation.y = baseAngle + (record.spinOffset ?? 0);

    station._mesh3d = group;
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
    const urls = getModelUrlsForStation(station);
    if (!urls) continue;
    const path = urls.find(Boolean);
    if (!path) continue;
    const record = ensureStationRecord(station);
    if (!record) continue;
    activeKeys.add(record.key);
    if (!record.group) {
      const clone = cloneTemplate(station.id, path);
      if (!clone) continue;

      const { scene: group, materials } = clone;
      group.visible = false;
      activeScene.add(group);
      elevateOverlay(group);

      const bbox = new THREE.Box3().setFromObject(group);
      const center = bbox.getCenter(new THREE.Vector3());
      group.position.sub(center);
      group.updateMatrixWorld(true);

      bbox.setFromObject(group);
      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      const geometryRadius = sphere?.radius && sphere.radius > 0 ? sphere.radius : 1;

      const desiredRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
      const targetRadius = Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0 ? desiredRadiusRaw : 1;
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
      record.materials = materials || [];
      record.camera = previewCam;
      record._lightDirWorld = record._lightDirWorld || new THREE.Vector3();
      record._lightDirView = record._lightDirView || new THREE.Vector3();
      record._viewMatrix3 = record._viewMatrix3 || new THREE.Matrix3();
      markSpriteDirty(record);

      group.position.set(0, 0, 0);
      const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
      group.rotation.y = baseAngle + (record.spinOffset ?? 0);
    }

    if (!record || !record.group) continue;

    // === POCZĄTEK: AKTUALIZACJA SHADERA OŚWIETLENIA ===
    if (record.materials && record.materials.length > 0) {
      // 1. Oblicz kierunek słońca (w 'world space')
      const sunDirWorld = sunDirFor(station.x, station.y);
      
      // 2. Przekonwertuj na 'view space' (tak jak robi to planetd3d.assets.js)
      // Musimy pobrać kamerę, której używamy do renderowania sprite'a
      const cam = record.camera || previewCam;
      
      if (cam) {
        // Używamy wektorów z rekordu, aby uniknąć tworzenia nowych obiektów
        record._lightDirWorld.set(sunDirWorld.x, sunDirWorld.y, 0.001); // (x, y, z)
        record._viewMatrix3.setFromMatrix4(cam.matrixWorldInverse);
        record._lightDirView.copy(record._lightDirWorld).applyMatrix3(record._viewMatrix3).normalize();

        // 3. Zaktualizuj wszystkie materiały dla tej stacji
        for (const mat of record.materials) {
          if (mat.uniforms.uLightDirView) {
            mat.uniforms.uLightDirView.value.copy(record._lightDirView);
          }
          // Możesz też zaktualizować intensywność, jeśli chcesz ją zmieniać w devtools
          // if (mat.uniforms.uIntensity) {
          //   mat.uniforms.uIntensity.value = 1.5; 
          // }
        }
      }
    }
    // === KONIEC: AKTUALIZACJA SHADERA OŚWIETLENIA ===

    updateRecordTransform(record, station, devScale, visible);
  }

  for (const [key, record] of stationRecords) {
    if (!activeKeys.has(key)) {
      removeRecord(record);
      stationRecords.delete(key);
    }
  }
}

function ensureSpriteTarget(record, sizeOverride) {
  const size = sizeOverride ?? getStationSpriteSize();
  if (!record.spriteCanvas) {
    record.spriteCanvas = document.createElement('canvas');
    record.spriteCtx = record.spriteCanvas.getContext('2d');
  }
  if (record.spriteCanvas.width !== size || record.spriteCanvas.height !== size) {
    record.spriteCanvas.width = size;
    record.spriteCanvas.height = size;
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
  const size = getStationSpriteSize();
  const zoomMul = getPerStationSpriteFrame(record.stationRef); // 0.8..3.0
  const scale = record.group?.scale?.x || 1;
  const sizeChanged = record.lastSpriteSize !== size;
  const frameChanged = !approxEqual(record.lastSpriteFrame, zoomMul);
  const scaleChanged = !approxEqual(record.lastRenderedScale, scale);
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  const elapsed = record.lastSpriteTime ? now - record.lastSpriteTime : Infinity;
  if (!record.forceSpriteRefresh && !sizeChanged && !frameChanged && !scaleChanged && elapsed < MIN_SPRITE_RENDER_INTERVAL) {
    return;
  }

  const scene = initScene();
  const cam = ensurePreviewCamera();
  const renderer = getSharedRenderer(size, size);
  if (!scene || !cam || !renderer) return;

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

  const R_geom = Math.max(1, record.geometryRadius || record.group?.userData?.geometryRadius || 1);
  const s = record.group?.scale?.x || 1;
  const R_eff = Math.max(1, R_geom * s);

  const fovRad = cam.fov * Math.PI / 180;
  const distFit = R_eff / Math.tan(fovRad * 0.5);
  // Większy zoomMul => bliżej => większy sprite:
  const dist = Math.max(10, distFit / zoomMul);
  cam.position.set(dist, dist * 0.62, dist);
  cam.lookAt(0, 0, 0);

  // Ustaw kierunek światła na podstawie pozycji Słońca i stacji (XY świata -> XZ Three.js)
  const dirLight = scene.userData?.dirLight || null;
  const stRef = record.stationRef;
  if (dirLight && stRef && typeof window !== 'undefined' && window.SUN) {
    const dx = (window.SUN.x ?? 0) - (stRef.x ?? 0);
    const dy = (window.SUN.y ?? 0) - (stRef.y ?? 0);
    // 2D (x,y ekranowe; y w dół) -> 3D (x,z; z do "przodu"):
    // dy trzeba odwrócić, żeby "góra ekranu" była dodatnim Z.
    const v = new THREE.Vector3(dx, 0.6, -dy);
    if (v.lengthSq() > 0) {
      v.normalize().multiplyScalar(Math.max(200, dist));
      dirLight.position.copy(v);
      if (dirLight.target) {
        dirLight.target.position.set(0, 0, 0);
        dirLight.target.updateMatrixWorld();
      }
    }
  }

  resetRenderer(renderer, size, size);
  renderer.autoClear = true;
  renderer.render(scene, cam);

  const spriteCanvas = ensureSpriteTarget(record, size);
  const spriteCtx = record.spriteCtx;
  let rendered = false;
  if (spriteCanvas && spriteCtx && renderer.domElement) {
    spriteCtx.clearRect(0, 0, size, size);
    spriteCtx.drawImage(renderer.domElement, 0, 0, size, size);
    rendered = true;
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
    const numeric = Number(window.DevConfig.stationScaleById[key]) || 1;
    const slider = document.getElementById(`dt-scale-station-${key}`);
    const num = document.getElementById(`dt-scale-station-${key}-num`);
    if (slider) slider.value = String(numeric);
    if (num) num.value = String(numeric);
    const valEl = slider?.nextElementSibling?.nextElementSibling || num?.nextElementSibling;
    if (valEl && typeof valEl.textContent === 'string') {
      valEl.textContent = numeric.toFixed(2);
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

  // ⬇⬇⬇ BACK-COMPAT: globalne API używane przez index/loop ⬇⬇⬇
  window.initStations3D = initStations3D;
  window.updateStations3D = updateStations3D;
  window.drawStations3D = drawStations3D;
  window.detachPlanetStations3D = detachPlanetStations3D;

  // Domyślna aktywacja stacji 3D (planetarnych), niezależnie od przełącznika pirackiej stacji 3D.
  if (typeof window.USE_PLANET_STATIONS_3D === 'undefined') {
    window.USE_PLANET_STATIONS_3D = true;
  }
}
