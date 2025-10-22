import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const templateCache = new Map();
const stationRecords = new Map();

let activeScene = null;

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
  const planet = tryStr(station?.planet || station?.host || station?.home || station?.orbit?.name);
  const candidates = [id, name, style, planet].join(' ');
  const keys = ['earth', 'mars', 'jupiter', 'neptune'];
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
      geometryRadius: null,
      loadingPromise: null,
      spinOffset: Math.random() * Math.PI * 2
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

      const devScale = getDevScale();
      wrapper.scale.setScalar(baseScale * devScale);
      // Płaszczyzna overlay'a to XZ (Y jest osią "w górę") → mapuj 2D (x,y) → 3D (x,0,y)
      wrapper.position.set(
        Number.isFinite(station.x) ? station.x : 0,
        0,
        Number.isFinite(station.y) ? station.y : 0
      );
      wrapper.visible = isUse3DEnabled();

      record.group = wrapper;
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

  const devScalar = Number.isFinite(devScale) && devScale > 0 ? devScale : 1;
  group.scale.setScalar(baseScale * devScalar);

  const px = Number.isFinite(station.x) ? station.x : 0;
  const py = Number.isFinite(station.y) ? station.y : 0;
  // 2D (x,y) → 3D (x,0,y) – taka sama płaszczyzna jak reszta sceny overlay
  group.position.set(px, 0, py);

  const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
  record.spinOffset = (record.spinOffset ?? 0) + 0.002;
  // Dla sceny planetarnej kręcimy wokół osi Y (kamera top-down w układzie XZ)
  group.rotation.y = baseAngle + record.spinOffset;

  group.visible = visible;
  station._mesh3d = group;
}

export function initStations3D(scene, stations) {
  activeScene = scene || null;
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

export function detachPlanetStations3D(sceneOverride) {
  const targetScene = sceneOverride || activeScene;
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
