import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Core3D } from './core3d.js'; // ZMIEŃ ŚCIEŻKĘ jeśli to konieczne

const loader = new GLTFLoader();
const templateCache = new Map();
const stationRecords = new Map();

let stationKeySequence = 0;
const STATION_KEY_PROP = '__station3DKey';

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

function isUse3DEnabled() {
  if (typeof window === 'undefined') return true;
  return window.USE_PLANET_STATIONS_3D !== false;
}

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
      const maxAnisotropy = Core3D.renderer ? Core3D.renderer.capabilities.getMaxAnisotropy() : 4;
      
      // --- FIX: ZBIERAMY FAŁSZYWE TŁA DO USUNIĘCIA ---
      const toRemove = [];

      scene.traverse((o) => {
        if (!o.isMesh) return;
        
        const name = o.name.toLowerCase();
        // Wykrywamy wbudowane planety/atmosfery z darmowych modeli GLTF
        const isBackground = name.includes('planet') || name.includes('earth') || 
                             name.includes('mars') || name.includes('jupiter') || 
                             name.includes('neptune') || name.includes('clouds') || 
                             name.includes('atmosphere') || name.includes('bg_') || 
                             name.includes('background') || name.includes('sphere');
                             
        // Zabezpieczenie: usuwamy tylko, jeśli to nie jest sama stacja
        if (isBackground && !name.includes('station') && !name.includes('base') && !name.includes('hub')) {
          toRemove.push(o);
          return; // Przerywamy pętlę, obiekt i tak idzie do kosza
        }

        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; 

        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          if (!m) continue;
          if (m.map) m.map.anisotropy = maxAnisotropy;
          
          m.roughness = 0.4; 
          m.metalness = 0.6; 
          m.envMapIntensity = 0.0; 
          
          m.side = THREE.DoubleSide; 
          m.transparent = false;
          m.depthWrite = true;
          m.depthTest = true;
          
          if (m.map || m.alphaMap) {
            m.alphaTest = 0.5;
          }
          m.needsUpdate = true;
        }
      });

      // --- FIX: FIZYCZNE USUNIĘCIE TŁA Z MODELU ---
      toRemove.forEach(obj => {
        if (obj.parent) obj.parent.remove(obj);
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

function removeRecord(record) {
  if (!record) return;
  const group = record.group;
  if (group && group.parent) {
    group.parent.remove(group);
  }
  if (record.stationRef) {
    if (record.stationRef._mesh3d === group) delete record.stationRef._mesh3d;
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
      geometryRadius: 1,
      spinOffset: Math.random() * Math.PI * 2,
      lastRenderedScale: null,
      lastTargetRadius: null
    };
    stationRecords.set(key, record);
  } else {
    record.stationRef = station;
  }
  return record;
}

function updateRecordTransform(record, station, devScale, visible) {
  const group = record.group;
  if (!group || !Core3D.scene) return;
  
  if (group.parent !== Core3D.scene) {
    Core3D.scene.add(group);
  }
  
  const geometryRadius = record.geometryRadius || group.userData.geometryRadius || 1;
  const desiredRadiusRaw = (Number.isFinite(station.r) ? station.r : station.baseR) ?? 1;
  const desiredRadius = Number.isFinite(desiredRadiusRaw) && desiredRadiusRaw > 0 ? desiredRadiusRaw : 1;
  const baseScale = desiredRadius / geometryRadius;

  const perMap = getPerStationScaleMap();
  const idKey = getStationIdKey(station);
  const perScale = Number(perMap[idKey]) || 1;
  const globalScalar = Number.isFinite(devScale) && devScale > 0 ? devScale : 1;
  const effectiveScale = baseScale * globalScalar * perScale * 2.8; 

  group.scale.setScalar(effectiveScale);
  
  // Z = -100 utrzymuje stację na odpowiedniej płaszczyźnie
  group.position.set(station.x, -station.y, -100);

  const baseAngle = typeof station.angle === 'number' ? station.angle : 0;
  record.spinOffset += 0.002;
  group.rotation.set(Math.PI / 8, baseAngle + record.spinOffset, 0);

  group.visible = visible;
  station._mesh3d = group;
  record.lastTargetRadius = desiredRadius;
}

export function initStations3D(_sceneIgnored, stations) {
  if (!Core3D.isInitialized || !Array.isArray(stations)) return;

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

    if (record.group) {
      if (record.group.parent !== Core3D.scene) Core3D.scene.add(record.group);
      station._mesh3d = record.group;
      continue;
    }

    const clone = cloneTemplate(station.id, path);
    if (!clone) continue;

    const { scene: group } = clone;
    group.visible = false;
    Core3D.scene.add(group);

    const bbox = new THREE.Box3().setFromObject(group);
    const center = bbox.getCenter(new THREE.Vector3());
    group.position.sub(center);
    group.updateMatrixWorld(true);

    bbox.setFromObject(group);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const geometryRadius = sphere?.radius && sphere.radius > 0 ? sphere.radius : 1;

    record.group = group;
    record.geometryRadius = geometryRadius;
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
  if (!Core3D.isInitialized || !Array.isArray(stations)) return;

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
        Core3D.scene.add(group);

        const bbox = new THREE.Box3().setFromObject(group);
        const center = bbox.getCenter(new THREE.Vector3());
        group.position.sub(center);
        group.updateMatrixWorld(true);

        bbox.setFromObject(group);
        const sphere = bbox.getBoundingSphere(new THREE.Sphere());
        record.geometryRadius = sphere?.radius > 0 ? sphere.radius : 1;
        record.group = group;
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

export function drawStations3D(ctx, cam, worldToScreen) { }

export function detachPlanetStations3D(_sceneIgnored) {
  for (const record of stationRecords.values()) {
    if (record.group && Core3D.scene && record.group.parent === Core3D.scene) {
      Core3D.scene.remove(record.group);
    }
    if (record.stationRef && record.stationRef._mesh3d === record.group) {
      delete record.stationRef._mesh3d;
    }
    record.group = null;
    record.stationRef = null;
  }
  stationRecords.clear();
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
}

export function setStationSpriteFrame(id, val) { }

export function getStationScales() {
  return getPerStationScaleMap();
}

if (typeof window !== 'undefined') {
  window.setStationScale = setStationScale;
  window.setStationSpriteFrame = setStationSpriteFrame; 
  window.getStationScales = getStationScales;
  window.initStations3D = initStations3D;
  window.updateStations3D = updateStations3D;
  window.drawStations3D = drawStations3D;
  window.detachPlanetStations3D = detachPlanetStations3D;
  if (typeof window.USE_PLANET_STATIONS_3D === 'undefined') {
    window.USE_PLANET_STATIONS_3D = true;
  }
}