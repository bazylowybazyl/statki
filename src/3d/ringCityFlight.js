import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { getPlanetaryRing } from './planetaryRing3D.js';
import { loadSynthCityFlightAssets, synthCityAssets } from './ringCityAssets.js';
import { RingCitySkyDome } from './ringCitySkyDome.js';
import {
  composeInwardCityMatrix,
  mapInwardCityPoint,
  resolveOutwardCitySurface
} from './ringCitySurface.js';

export const RING_FLIGHT_PROXIMITY = 7000;

const TAU = Math.PI * 2;
const PHASE = Object.freeze({
  IDLE: 'idle',
  LAUNCH: 'launch',
  AIRLOCK: 'airlock',
  MANUAL: 'manual',
  RETURN: 'return'
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(value) {
  return value - TAU * Math.floor((value + Math.PI) / TAU);
}

function cubicBezier(out, a, b, c, d, t) {
  const it = 1 - t;
  const it2 = it * it;
  const t2 = t * t;
  return out.set(
    a.x * it2 * it + b.x * 3 * it2 * t + c.x * 3 * it * t2 + d.x * t2 * t,
    a.y * it2 * it + b.y * 3 * it2 * t + c.y * 3 * it * t2 + d.y * t2 * t,
    a.z * it2 * it + b.z * 3 * it2 * t + c.z * 3 * it * t2 + d.z * t2 * t
  );
}

function cubicBezierTangent(out, a, b, c, d, t) {
  const it = 1 - t;
  return out.set(
    3 * it * it * (b.x - a.x) + 6 * it * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
    3 * it * it * (b.y - a.y) + 6 * it * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
    3 * it * it * (b.z - a.z) + 6 * it * t * (c.z - b.z) + 3 * t * t * (d.z - c.z)
  ).normalize();
}

export function findNearestRingLaunchCandidate({
  ship,
  planets = [],
  stations = [],
  ringLookup = getPlanetaryRing,
  maxDistance = RING_FLIGHT_PROXIMITY
} = {}) {
  const sx = Number(ship?.pos?.x ?? ship?.x);
  const sy = Number(ship?.pos?.y ?? ship?.y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

  let best = null;
  for (let index = 0; index < planets.length; index++) {
    const planet = planets[index];
    const key = String(planet?.id || planet?.name || '').toLowerCase();
    if (key !== 'earth' && key !== 'mars') continue;
    const ring = ringLookup(key);
    if (!ring?.layout || !ring?.ringFloor) continue;
    const distance = Math.hypot(sx - (Number(planet.x) || 0), sy - (Number(planet.y) || 0));
    const inner = Number(ring.layout.innerRadius) || Number(ring.layout.inner?.innerR) || 0;
    const outer = Number(ring.layout.outerRadius) || Number(ring.layout.military?.outerR) || inner;
    const edgeDistance = distance < inner ? inner - distance : distance > outer ? distance - outer : 0;
    const station = stations.find(item => String(item?.id || item?.planet?.id || '').toLowerCase() === key) || null;
    const candidate = {
      key,
      planet,
      ring,
      station,
      distance,
      edgeDistance,
      available: edgeDistance <= maxDistance
    };
    if (!best || edgeDistance < best.edgeDistance) best = candidate;
  }
  return best;
}

function makeHdrBasicMaterial(hex, intensity = 2.5, options = {}) {
  const color = new THREE.Color(hex).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...options });
}

class RingCityFlightController {
  constructor() {
    this.active = false;
    this.loading = false;
    this.phase = PHASE.IDLE;
    this.phaseTime = 0;
    this.phaseDuration = 1;
    this.ring = null;
    this.planet = null;
    this.station = null;
    this.gateAngle = 0;
    this.gates = new Map();
    this.skyDome = new RingCitySkyDome();
    this.carRoot = null;
    this.uiRoot = null;
    this.returnButton = null;
    this.inputCanvas = null;
    this.setUiVisible = null;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.manualAngle = 0;
    this.manualAcross = 0;
    this.manualAltitude = 92;
    this.heading = 0;
    this.targetHeading = 0;
    this.pitch = 0;
    this.targetPitch = 0;
    this.bank = 0;
    this.speed = 0;
    this.savedCoreFov = 35;
    this.savedGameCamera = null;
    this.cameraDescriptor = {
      mode: 'free3d',
      x: 0,
      y: 0,
      zoom: 1,
      fov: 58,
      near: 2,
      far: 160000,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion()
    };

    this.path = Array.from({ length: 4 }, () => new THREE.Vector3());
    this.returnPath = Array.from({ length: 4 }, () => new THREE.Vector3());
    this.savedCameraPosition = new THREE.Vector3();
    this.savedCameraQuaternion = new THREE.Quaternion();
    this.carWorldPosition = new THREE.Vector3();
    this.carForward = new THREE.Vector3(0, 0, 1);
    this.carUp = new THREE.Vector3(0, 1, 0);
    this.carRight = new THREE.Vector3(1, 0, 0);

    this._matrix = new THREE.Matrix4();
    this._basis = new THREE.Matrix4();
    this._lookMatrix = new THREE.Matrix4();
    this._scratchA = new THREE.Vector3();
    this._scratchB = new THREE.Vector3();
    this._scratchC = new THREE.Vector3();
    this._scratchD = new THREE.Vector3();
    this._scratchQ = new THREE.Quaternion();
    this._globalUp = new THREE.Vector3(0, 0, 1);
    this._listenersInstalled = false;
  }

  configure({ setUiVisible = null, inputCanvas = null } = {}) {
    this.setUiVisible = typeof setUiVisible === 'function' ? setUiVisible : this.setUiVisible;
    this.inputCanvas = inputCanvas || this.inputCanvas || (typeof document !== 'undefined' ? document.getElementById('c') : null);
    this.ensureUi();
    this.installInputListeners();
    return this;
  }

  ensureUi() {
    if (typeof document === 'undefined' || this.uiRoot) return;
    const root = document.createElement('div');
    root.id = 'ring-city-flight-ui';
    root.className = 'hidden';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ring-flight-return';
    button.textContent = 'POWRÓT NA STATEK';
    button.title = 'W/S: prędkość · A/D lub mysz: kierunek · Shift: dopalacz · Esc: powrót';
    button.addEventListener('click', () => this.requestReturn());
    root.appendChild(button);
    document.body.appendChild(root);
    this.uiRoot = root;
    this.returnButton = button;
  }

  installInputListeners() {
    if (typeof window === 'undefined' || this._listenersInstalled) return;
    this._listenersInstalled = true;
    const flightKeys = new Set([
      'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
      'ShiftLeft', 'ShiftRight', 'Space', 'Escape'
    ]);
    window.addEventListener('keydown', event => {
      if (!this.active || !flightKeys.has(event.code)) return;
      if (event.code === 'Escape') this.requestReturn();
      else this.keys.add(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    window.addEventListener('keyup', event => {
      if (!this.active || !flightKeys.has(event.code)) return;
      this.keys.delete(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    window.addEventListener('mousemove', event => {
      if (!this.active || this.phase !== PHASE.MANUAL) return;
      if (typeof document !== 'undefined' && document.pointerLockElement && document.pointerLockElement !== this.inputCanvas) return;
      this.mouseDX += clamp(Number(event.movementX) || 0, -200, 200);
      this.mouseDY += clamp(Number(event.movementY) || 0, -200, 200);
    }, true);
    window.addEventListener('wheel', event => {
      if (!this.active) return;
      this.cameraDescriptor.fov = clamp(this.cameraDescriptor.fov + Math.sign(event.deltaY) * 2, 42, 72);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
    this.inputCanvas?.addEventListener('click', () => {
      if (this.active && this.phase === PHASE.MANUAL) this.lockPointer();
    });
  }

  lockPointer() {
    if (!this.inputCanvas?.requestPointerLock || typeof document === 'undefined') return;
    if (document.pointerLockElement !== this.inputCanvas) {
      this.inputCanvas.requestPointerLock().catch?.(() => {});
    }
  }

  isActive() {
    return this.active;
  }

  getLaunchCandidate() {
    return findNearestRingLaunchCandidate({
      ship: typeof window !== 'undefined' ? window.ship : null,
      planets: typeof window !== 'undefined' && Array.isArray(window.planets) ? window.planets : [],
      stations: typeof window !== 'undefined' && Array.isArray(window.stations) ? window.stations : []
    });
  }

  getLaunchStatus() {
    if (this.active) return { available: false, active: true, reason: 'Lot po Ring City jest aktywny.' };
    if (this.loading) return { available: false, loading: true, reason: 'Ładowanie bolidu SynthCity…' };
    if (typeof window !== 'undefined' && window.splitScreenMode) {
      return { available: false, reason: 'Tryb eksperymentalny jest dostępny tylko dla jednego gracza.' };
    }
    const candidate = this.getLaunchCandidate();
    if (!candidate) return { available: false, reason: 'Brak aktywnego Ring City.' };
    if (!candidate.available) {
      return {
        available: false,
        candidate,
        reason: `Podejdź bliżej ringu (${Math.ceil(candidate.edgeDistance)} u).`
      };
    }
    return {
      available: true,
      candidate,
      reason: `Wystrzel bolid do ${String(candidate.planet?.label || candidate.key).toUpperCase()}.`
    };
  }

  async requestLaunch() {
    const status = this.getLaunchStatus();
    if (!status.available || this.loading) {
      this.notify(status.reason, status.loading ? 'orbit' : 'warn');
      return false;
    }
    this.loading = true;
    // Pointer lock must be requested while the original button click still
    // carries user activation. Retrying after the cinematic is kept below.
    this.lockPointer();
    this.notify('Przygotowanie bolidu SynthCity…', 'orbit');
    try {
      await loadSynthCityFlightAssets();
      this.loading = false;
      const fresh = this.getLaunchStatus();
      if (!fresh.available) {
        this.notify(fresh.reason, 'warn');
        return false;
      }
      return this.beginLaunch(fresh.candidate);
    } catch (error) {
      console.error('[RingCityFlight] Nie udało się załadować bolidu:', error);
      this.notify('Nie udało się załadować bolidu SynthCity.', 'warn');
      return false;
    } finally {
      this.loading = false;
      if (!this.active && typeof document !== 'undefined' && document.pointerLockElement === this.inputCanvas) {
        document.exitPointerLock?.();
      }
    }
  }

  notify(message, tone = '') {
    if (typeof window === 'undefined') return;
    window.cockpitUI?.log?.(message, tone);
    window.cockpitUI?.toast?.(message, tone === 'warn' ? 'bad' : 'good');
  }

  resolveGateAngle(candidate) {
    if (Number.isFinite(Number(candidate?.station?.angle))) return Number(candidate.station.angle);
    const planet = candidate?.planet;
    const station = candidate?.station;
    if (planet && station) return Math.atan2(station.y - planet.y, station.x - planet.x);
    return candidate?.key === 'mars' ? Math.PI * 1.25 : Math.PI * 0.25;
  }

  ensureGates(dt = 0) {
    if (!Core3D.isInitialized) return;
    const planets = typeof window !== 'undefined' && Array.isArray(window.planets) ? window.planets : [];
    const stations = typeof window !== 'undefined' && Array.isArray(window.stations) ? window.stations : [];
    for (const planet of planets) {
      const key = String(planet?.id || planet?.name || '').toLowerCase();
      if (key !== 'earth' && key !== 'mars') continue;
      const ring = getPlanetaryRing(key);
      if (!ring?.ringFloor) continue;
      const station = stations.find(item => String(item?.id || item?.planet?.id || '').toLowerCase() === key) || null;
      const old = this.gates.get(key);
      if (!old || old.ring !== ring || old.group.parent !== ring.ringFloor) {
        if (old?.group?.parent) old.group.parent.remove(old.group);
        this.gates.set(key, this.createGate(ring, station));
      }
    }

    const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    for (const entry of this.gates.values()) {
      const pulse = 0.72 + Math.sin(time * 3.4 + entry.phase) * 0.28;
      for (const material of entry.pulseMaterials) material.opacity = 0.48 + pulse * 0.42;
      entry.innerRing.rotation.z += dt * 0.24;
      entry.outerRing.rotation.z -= dt * 0.16;
    }
  }

  createGate(ring, station) {
    const angle = this.resolveGateAngle({ key: ring.key, ring, station });
    const surface = resolveOutwardCitySurface(ring.layout);
    const sourceRadius = surface.sourceInnerRadius + surface.width * 0.5;
    const group = new THREE.Group();
    group.name = `RingCityAirlock:${ring.key}`;
    group.userData.fgCategory = 'buildings';
    group.userData.ringCityAirlock = true;
    composeInwardCityMatrix(angle, sourceRadius, ring.layout, group.matrix);
    group.matrixAutoUpdate = false;
    group.matrixWorldNeedsUpdate = true;

    const deckMaterial = new THREE.MeshStandardMaterial({
      color: 0x07111a,
      emissive: 0x012b3d,
      emissiveIntensity: 0.8,
      metalness: 0.82,
      roughness: 0.34
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x010307,
      emissive: 0x001018,
      emissiveIntensity: 0.25,
      metalness: 0.92,
      roughness: 0.22
    });
    const cyan = makeHdrBasicMaterial(0x42dfff, 3.1, { transparent: true, opacity: 0.78 });
    const amber = makeHdrBasicMaterial(0xffb238, 2.8, { transparent: true, opacity: 0.76 });
    const pulseMaterials = [cyan, amber];

    const deck = new THREE.Mesh(new THREE.BoxGeometry(390, 480, 14), deckMaterial);
    deck.position.z = 5;
    group.add(deck);
    const aperture = new THREE.Mesh(new THREE.CircleGeometry(142, 48), darkMaterial);
    aperture.scale.y = 1.25;
    aperture.position.z = 14;
    group.add(aperture);

    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(166, 10, 12, 64), cyan);
    outerRing.scale.y = 1.22;
    outerRing.position.z = 34;
    group.add(outerRing);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(126, 6, 10, 56), amber);
    innerRing.scale.y = 1.22;
    innerRing.position.z = 76;
    group.add(innerRing);

    const pylonGeometry = new THREE.BoxGeometry(24, 24, 176);
    const pylonPositions = [
      [-174, -194], [174, -194], [-174, 194], [174, 194]
    ];
    for (let i = 0; i < pylonPositions.length; i++) {
      const pylon = new THREE.Mesh(pylonGeometry, i < 2 ? deckMaterial : darkMaterial);
      pylon.position.set(pylonPositions[i][0], pylonPositions[i][1], 88);
      group.add(pylon);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), i % 2 ? amber : cyan);
      cap.position.set(pylonPositions[i][0], pylonPositions[i][1], 182);
      group.add(cap);
    }

    const guideGeometry = new THREE.BoxGeometry(8, 360, 5);
    for (const x of [-128, 128]) {
      const guide = new THREE.Mesh(guideGeometry, x < 0 ? cyan : amber);
      guide.position.set(x, 0, 18);
      group.add(guide);
    }

    Core3D.enableForeground3D(group);
    ring.ringFloor.add(group);
    return {
      ring,
      station,
      group,
      angle,
      sourceRadius,
      innerRing,
      outerRing,
      pulseMaterials,
      phase: ring.key === 'mars' ? 1.7 : 0
    };
  }

  updateIdle(dt = 0) {
    this.ensureGates(dt);
  }

  createCar() {
    this.removeCar();
    const bodyGeometry = synthCityAssets.models.spinner?.clone();
    const windowsGeometry = synthCityAssets.models.spinner_windows?.clone();
    if (!bodyGeometry || !windowsGeometry) return false;
    const root = new THREE.Group();
    root.name = 'RingCityPlayerSpinner';
    root.userData.fgCategory = 'weapons';
    root.userData.ringCityFlightVehicle = true;
    root.scale.setScalar(1.55);

    const body = new THREE.Mesh(bodyGeometry, [
      synthCityAssets.materials.spinner_interior,
      synthCityAssets.materials.spinner_exterior
    ]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.frustumCulled = false;
    root.add(body);

    const windows = new THREE.Mesh(windowsGeometry, synthCityAssets.materials.spinner_windows);
    windows.renderOrder = 22;
    windows.frustumCulled = false;
    root.add(windows);

    const engineMaterial = makeHdrBasicMaterial(0x35d9ff, 4.2, {
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const engineGeometry = new THREE.SphereGeometry(0.32, 12, 8);
    for (const x of [-0.86, 0.86]) {
      const glow = new THREE.Mesh(engineGeometry, engineMaterial);
      glow.position.set(x, 0, -3.15);
      glow.scale.set(1.0, 0.75, 2.4);
      root.add(glow);
    }
    const light = new THREE.PointLight(0x42dfff, 34, 95, 1.7);
    light.position.set(0, 0.5, -3.7);
    root.add(light);

    Core3D.enableForeground3D(root);
    Core3D.scene.add(root);
    this.carRoot = root;
    return true;
  }

  removeCar() {
    if (!this.carRoot) return;
    if (this.carRoot.parent) this.carRoot.parent.remove(this.carRoot);
    this.carRoot.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material && !material.userData?.shared) material.dispose?.();
      }
    });
    this.carRoot = null;
  }

  beginLaunch(candidate) {
    if (!candidate?.ring?.ringFloor || !Core3D.isInitialized || !this.createCar()) return false;
    this.active = true;
    this.phase = PHASE.LAUNCH;
    this.phaseTime = 0;
    this.phaseDuration = 5.2;
    this.ring = candidate.ring;
    this.planet = candidate.planet;
    this.station = candidate.station;
    this.gateAngle = this.resolveGateAngle(candidate);
    this.savedGameCamera = Core3D.activeCam1;
    this.savedCoreFov = Core3D.cameraPersp?.fov || 35;
    this.savedCameraPosition.copy(Core3D.cameraPersp.position);
    this.savedCameraQuaternion.copy(Core3D.cameraPersp.quaternion);
    this.cameraDescriptor.position.copy(this.savedCameraPosition);
    this.cameraDescriptor.quaternion.copy(this.savedCameraQuaternion);
    this.cameraDescriptor.fov = this.savedCoreFov;
    this.ensureGates(0);
    this.skyDome.activate();
    this.ring.ringFloor.updateWorldMatrix(true, false);

    const ship = typeof window !== 'undefined' ? window.ship : null;
    this.path[0].set(Number(ship?.pos?.x) || 0, -(Number(ship?.pos?.y) || 0), 35);
    this.getGateWorldPoint(1180, -420, this.path[3]);
    this.path[1].lerpVectors(this.path[0], this.path[3], 0.34);
    this.path[1].z += 520;
    this.path[2].lerpVectors(this.path[0], this.path[3], 0.78);
    this.getSurfaceWorldUp(this.gateAngle, this._scratchA);
    this.path[2].addScaledVector(this._scratchA, 360);

    this.carWorldPosition.copy(this.path[0]);
    this.carForward.subVectors(this.path[1], this.path[0]).normalize();
    this.carUp.copy(this._globalUp);
    this.applyCarPose(this.carWorldPosition, this.carForward, this.carUp, 0);
    Core3D.activeCam1 = this.cameraDescriptor;
    Core3D.activeCam2 = null;
    this.setUiVisible?.(false);
    this.ensureUi();
    this.uiRoot?.classList.remove('hidden');
    if (typeof document !== 'undefined') document.body.classList.add('ring-city-flight-active');
    this.notify(`Bolid wystrzelony — kurs na śluzę ${String(candidate.key).toUpperCase()}.`, 'ok');
    return true;
  }

  getGateWorldPoint(altitude, tangentOffset, target) {
    if (!this.ring?.ringFloor) return target.set(0, 0, 0);
    const surface = resolveOutwardCitySurface(this.ring.layout);
    const gate = this.gates.get(this.ring.key);
    const sourceRadius = gate?.sourceRadius || (surface.sourceInnerRadius + surface.width * 0.5);
    mapInwardCityPoint(this.gateAngle, sourceRadius, altitude, this.ring.layout, target);
    if (tangentOffset) {
      this._scratchD.set(-Math.sin(this.gateAngle), Math.cos(this.gateAngle), 0).multiplyScalar(tangentOffset);
      target.add(this._scratchD);
    }
    return target.applyMatrix4(this.ring.ringFloor.matrixWorld);
  }

  getSurfaceWorldUp(angle, target) {
    target.set(-Math.cos(angle), -Math.sin(angle), 0);
    return target.transformDirection(this.ring.ringFloor.matrixWorld);
  }

  getSurfaceWorldTangent(angle, target) {
    target.set(-Math.sin(angle), Math.cos(angle), 0);
    return target.transformDirection(this.ring.ringFloor.matrixWorld);
  }

  beginAirlock() {
    this.phase = PHASE.AIRLOCK;
    this.phaseTime = 0;
    this.phaseDuration = 3.4;
    this.getGateWorldPoint(1180, -420, this.path[0]);
    this.getGateWorldPoint(760, -310, this.path[1]);
    this.getGateWorldPoint(230, -110, this.path[2]);
    this.getGateWorldPoint(92, 130, this.path[3]);
  }

  beginManualFlight() {
    const surface = resolveOutwardCitySurface(this.ring.layout);
    this.phase = PHASE.MANUAL;
    this.phaseTime = 0;
    this.phaseDuration = Infinity;
    this.manualAngle = this.gateAngle + 130 / Math.max(1, surface.baseRadius);
    this.manualAcross = surface.width * 0.5;
    this.manualAltitude = 92;
    this.heading = 0;
    this.targetHeading = 0;
    this.pitch = 0;
    this.targetPitch = 0;
    this.speed = 165;
    this.lockPointer();
    this.notify('Sterowanie przejęte — lot swobodny w Ring City.', 'ok');
  }

  requestReturn() {
    if (!this.active || this.phase === PHASE.RETURN) return false;
    this.phase = PHASE.RETURN;
    this.phaseTime = 0;
    this.phaseDuration = 2.8;
    this.returnPath[0].copy(this.carWorldPosition);
    const ship = typeof window !== 'undefined' ? window.ship : null;
    this.returnPath[3].set(Number(ship?.pos?.x) || 0, -(Number(ship?.pos?.y) || 0), 35);
    this.returnPath[1].lerpVectors(this.returnPath[0], this.returnPath[3], 0.32);
    this.returnPath[1].addScaledVector(this.carUp, 520);
    this.returnPath[2].lerpVectors(this.returnPath[0], this.returnPath[3], 0.76);
    this.returnPath[2].z += 460;
    this.keys.clear();
    if (this.returnButton) {
      this.returnButton.disabled = true;
      this.returnButton.textContent = 'POWRÓT…';
    }
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.();
    return true;
  }

  finishReturn() {
    this.removeCar();
    this.skyDome.deactivate();
    this.active = false;
    this.phase = PHASE.IDLE;
    this.phaseTime = 0;
    this.keys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (Core3D.cameraPersp) Core3D.cameraPersp.fov = this.savedCoreFov;
    if (this.savedGameCamera) Core3D.activeCam1 = this.savedGameCamera;
    this.uiRoot?.classList.add('hidden');
    if (this.returnButton) {
      this.returnButton.disabled = false;
      this.returnButton.textContent = 'POWRÓT NA STATEK';
    }
    if (typeof document !== 'undefined') document.body.classList.remove('ring-city-flight-active');
    this.setUiVisible?.(true);
    this.notify('Bolid zadokowany. Sterowanie okrętem przywrócone.', 'ok');
    this.ring = null;
    this.planet = null;
    this.station = null;
    return true;
  }

  update(dt) {
    if (!this.active) return;
    const step = clamp(Number(dt) || 0, 0, 0.05);
    this.phaseTime += step;
    this.ensureGates(step);

    if (this.phase === PHASE.LAUNCH) this.updateLaunch();
    else if (this.phase === PHASE.AIRLOCK) this.updateAirlock();
    else if (this.phase === PHASE.MANUAL) this.updateManual(step);
    else if (this.phase === PHASE.RETURN) this.updateReturn();

    this.updateCameraDescriptorLocation();
  }

  updateLaunch() {
    const t = clamp(this.phaseTime / this.phaseDuration, 0, 1);
    const eased = smoothstep(t);
    cubicBezier(this.carWorldPosition, this.path[0], this.path[1], this.path[2], this.path[3], eased);
    cubicBezierTangent(this.carForward, this.path[0], this.path[1], this.path[2], this.path[3], eased);
    this.carUp.copy(this._globalUp);
    this.applyCarPose(this.carWorldPosition, this.carForward, this.carUp, 0);
    this.setChaseCamera(this.carWorldPosition, this.carForward, this.carUp, 34, 12, 26);

    const blend = smoothstep(t / 0.34);
    this.cameraDescriptor.position.lerpVectors(this.savedCameraPosition, this._scratchA.copy(this.cameraDescriptor.position), blend);
    this._scratchQ.copy(this.savedCameraQuaternion).slerp(this.cameraDescriptor.quaternion, blend);
    this.cameraDescriptor.quaternion.copy(this._scratchQ);
    this.cameraDescriptor.fov = THREE.MathUtils.lerp(this.savedCoreFov, 58, blend);
    if (t >= 1) this.beginAirlock();
  }

  updateAirlock() {
    const t = clamp(this.phaseTime / this.phaseDuration, 0, 1);
    const eased = smoothstep(t);
    cubicBezier(this.carWorldPosition, this.path[0], this.path[1], this.path[2], this.path[3], eased);
    cubicBezierTangent(this.carForward, this.path[0], this.path[1], this.path[2], this.path[3], eased);
    this.getSurfaceWorldUp(this.gateAngle, this._scratchA);
    const align = smoothstep((t - 0.16) / 0.68);
    this.carUp.lerpVectors(this._globalUp, this._scratchA, align).normalize();
    this.applyCarPose(this.carWorldPosition, this.carForward, this.carUp, Math.sin(t * Math.PI) * -0.08);
    this.setChaseCamera(this.carWorldPosition, this.carForward, this.carUp, 27, 9, 30);
    this.cameraDescriptor.fov = 58;
    if (t >= 1) this.beginManualFlight();
  }

  updateManual(dt) {
    const mouseScale = 0.00155;
    this.targetHeading = wrapAngle(this.targetHeading - this.mouseDX * mouseScale);
    this.targetPitch = clamp(this.targetPitch - this.mouseDY * mouseScale, -0.48, 0.48);
    this.mouseDX = 0;
    this.mouseDY = 0;

    if (this.keys.has('KeyA')) this.targetHeading = wrapAngle(this.targetHeading + dt * 1.18);
    if (this.keys.has('KeyD')) this.targetHeading = wrapAngle(this.targetHeading - dt * 1.18);
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const braking = this.keys.has('KeyS');
    const accelerating = this.keys.has('KeyW') || boost;
    const targetSpeed = braking ? 48 : boost ? 520 : accelerating ? 360 : 170;
    const speedBlend = 1 - Math.exp(-(targetSpeed > this.speed ? 2.7 : 4.8) * dt);
    this.speed += (targetSpeed - this.speed) * speedBlend;

    const headingError = wrapAngle(this.targetHeading - this.heading);
    this.heading = wrapAngle(this.heading + headingError * (1 - Math.exp(-4.2 * dt)));
    this.pitch += (this.targetPitch - this.pitch) * (1 - Math.exp(-3.8 * dt));
    this.bank += (clamp(-headingError * 1.7, -0.52, 0.52) - this.bank) * (1 - Math.exp(-5.2 * dt));

    const surface = resolveOutwardCitySurface(this.ring.layout);
    const horizontalSpeed = Math.cos(this.pitch) * this.speed;
    this.manualAngle += Math.cos(this.heading) * horizontalSpeed / Math.max(1, surface.baseRadius) * dt;
    this.manualAcross += Math.sin(this.heading) * horizontalSpeed * dt;
    if (this.keys.has('KeyQ')) this.manualAcross -= 135 * dt;
    if (this.keys.has('KeyE')) this.manualAcross += 135 * dt;
    this.manualAltitude += Math.sin(this.pitch) * this.speed * dt;

    const acrossMin = 34;
    const acrossMax = Math.max(acrossMin, surface.width - 34);
    if (this.manualAcross <= acrossMin || this.manualAcross >= acrossMax) {
      this.manualAcross = clamp(this.manualAcross, acrossMin, acrossMax);
      this.targetHeading *= 0.82;
      this.heading *= 0.82;
    }
    this.manualAltitude = clamp(this.manualAltitude, 38, 820);
    if ((this.manualAltitude <= 38 && this.targetPitch < 0) || (this.manualAltitude >= 820 && this.targetPitch > 0)) {
      this.targetPitch *= 0.6;
    }

    this.syncManualPose();
    this.cameraDescriptor.fov += ((boost ? 66 : 58) - this.cameraDescriptor.fov) * (1 - Math.exp(-3 * dt));
  }

  syncManualPose() {
    if (!this.ring?.ringFloor) return;
    const surface = resolveOutwardCitySurface(this.ring.layout);
    const sourceRadius = surface.sourceInnerRadius + this.manualAcross;
    mapInwardCityPoint(this.manualAngle, sourceRadius, this.manualAltitude, this.ring.layout, this.carWorldPosition)
      .applyMatrix4(this.ring.ringFloor.matrixWorld);

    this._scratchA.set(-Math.sin(this.manualAngle), Math.cos(this.manualAngle), 0);
    this._scratchB.set(0, 0, 1);
    this._scratchC.set(-Math.cos(this.manualAngle), -Math.sin(this.manualAngle), 0);
    this.carForward.copy(this._scratchA).multiplyScalar(Math.cos(this.heading) * Math.cos(this.pitch));
    this.carForward.addScaledVector(this._scratchB, Math.sin(this.heading) * Math.cos(this.pitch));
    this.carForward.addScaledVector(this._scratchC, Math.sin(this.pitch));
    this.carForward.transformDirection(this.ring.ringFloor.matrixWorld);
    this.carUp.copy(this._scratchC).transformDirection(this.ring.ringFloor.matrixWorld);
    this.applyCarPose(this.carWorldPosition, this.carForward, this.carUp, this.bank);
    this.setChaseCamera(this.carWorldPosition, this.carForward, this.carUp, 24, 8.5, 34, this.bank * 0.22);
  }

  updateReturn() {
    const t = clamp(this.phaseTime / this.phaseDuration, 0, 1);
    const eased = smoothstep(t);
    cubicBezier(this.carWorldPosition, this.returnPath[0], this.returnPath[1], this.returnPath[2], this.returnPath[3], eased);
    cubicBezierTangent(this.carForward, this.returnPath[0], this.returnPath[1], this.returnPath[2], this.returnPath[3], eased);
    this.carUp.lerp(this._globalUp, smoothstep(t)).normalize();
    this.applyCarPose(this.carWorldPosition, this.carForward, this.carUp, 0);
    this.setChaseCamera(this.carWorldPosition, this.carForward, this.carUp, 30, 12, 24);
    const cameraBlend = smoothstep((t - 0.28) / 0.72);
    this.cameraDescriptor.position.lerp(this.savedCameraPosition, cameraBlend);
    this.cameraDescriptor.quaternion.slerp(this.savedCameraQuaternion, cameraBlend);
    this.cameraDescriptor.fov = THREE.MathUtils.lerp(58, this.savedCoreFov, cameraBlend);
    if (t >= 1) this.finishReturn();
  }

  applyCarPose(position, forward, up, bank = 0) {
    if (!this.carRoot) return;
    this.carForward.copy(forward).normalize();
    this.carUp.copy(up).normalize();
    if (bank) this.carUp.applyAxisAngle(this.carForward, bank).normalize();
    this.carRight.crossVectors(this.carUp, this.carForward).normalize();
    this.carUp.crossVectors(this.carForward, this.carRight).normalize();
    this._basis.makeBasis(this.carRight, this.carUp, this.carForward);
    this.carRoot.position.copy(position);
    this.carRoot.quaternion.setFromRotationMatrix(this._basis);
    this.carRoot.updateMatrixWorld(true);
  }

  setChaseCamera(position, forward, up, distance, height, lead, roll = 0) {
    this.cameraDescriptor.position.copy(position)
      .addScaledVector(forward, -distance)
      .addScaledVector(up, height);
    this._scratchA.copy(position).addScaledVector(forward, lead).addScaledVector(up, 1.5);
    this._scratchB.copy(up);
    if (roll) this._scratchB.applyAxisAngle(forward, roll);
    this._lookMatrix.lookAt(this.cameraDescriptor.position, this._scratchA, this._scratchB);
    this.cameraDescriptor.quaternion.setFromRotationMatrix(this._lookMatrix);
  }

  updateWorld(dt = 0) {
    this.ensureGates(dt);
    if (!this.active || !this.ring?.ringFloor) return;
    this.ring.ringFloor.updateWorldMatrix(true, false);
    if (this.phase === PHASE.MANUAL) this.syncManualPose();
    this.updateCameraDescriptorLocation();
    Core3D.activeCam1 = this.cameraDescriptor;
    Core3D.activeCam2 = null;
  }

  updateCameraDescriptorLocation() {
    this.cameraDescriptor.x = this.carWorldPosition.x;
    this.cameraDescriptor.y = -this.carWorldPosition.y;
    this.cameraDescriptor.zoom = 1;
  }

  getCamera() {
    return this.cameraDescriptor;
  }

  getCullInfo(width = 1920, height = 1080) {
    return {
      x: this.cameraDescriptor.x,
      y: this.cameraDescriptor.y,
      halfW: Math.max(5000, width * 2),
      halfH: Math.max(5000, height * 2)
    };
  }
}

export const RingCityFlight = new RingCityFlightController();

if (typeof window !== 'undefined') {
  window.RingCityFlight = RingCityFlight;
}
