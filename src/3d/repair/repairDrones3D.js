// src/3d/repair/repairDrones3D.js
//
// OBRAZ ROJU DRONÓW NAPRAWCZYCH (stan liczy src/game/repairRig.js, rejestr src/game/repairSwarm.js) — tylko obraz:
//  • BRYŁY: wszystkie drony wszystkich rigów w JEDNEJ PARTII (wzór thrusterBatch3D.js / turretBatch3D.js): geometria
//    = scalone części drona (repairDroneModel.js) z atrybutem aRdPart, Mesh + InstancedBufferGeometry (nie
//    InstancedMesh — uuid w kluczu programu), JEDEN przepleciony bufor instancji (REPAIR_DRONE_INST_STRIDE liczb),
//    jeden materiał (graf TSL raz) i jeden rysunek; materiał okrętów 3D (shipMaterials3D.tsl.js: paleta drona, szwy
//    paneli, mapa otoczenia, maska słońca), poza części w etapie wierzchołków (RepairDroneNodeMaterial.setupPosition —
//    lustro repairDroneVertexCpu), głębia w warstwie nad kadłubami i wieżami (modelSlabDepth.js, SLAB_REPAIR_DRONE),
//    palnik świeci przy spawaniu, dysze jonowe z ciągu, czerwony błysk przy trafieniu, drony gasną z maskowaniem
//    nosiciela (rozpuszczanie przez dither — maskNode);
//  • EFEKTY z pul gry (bez nowych pul): iskry spawania (SparkSystem3D — obiegają krawędź płyty łaty), światło łuku
//    w siatce świateł (Core3D.fx.lights.point), błysk odbudowanej komórki (flash), zestrzelony dron — WeaponFx.droneBlast
//    (odłamki i kula ognia z pul broni) + błysk.
// Pozycje: dron w układzie encji (cel / nosiciel) → świat z pozą RENDERU encji (gracz — interpolowana), rekordy względem
// początku przy kamerze (sceneOriginNearCamera — świat 5–10 mln j., float32). Wysyłka zakresem, bez alokacji na klatkę.

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, varying, vec2, vec3, float, select, positionLocal, normalLocal, uniform, fract, sin, cos, dot, floor,
  screenCoordinate
} from 'three/tsl';
import { Core3D } from '../core3d.js';
import { createShipMaterial } from '../ships3d/shipMaterials3D.tsl.js';
import { applyModelSlabDepth } from '../ships3d/modelSlabDepth.js';
import { applyShip3DEnv } from '../ships3d/shipModels3DGame.js';
import { applySunShadowToBuiltinMaterial } from '../sunShadowMask.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { zbierzZakres } from '../zakresyWysylki.js';
import { SparkSystem3D } from '../sparkSystem3D.js';
import { WeaponFx } from '../weapons/weaponFx.js';
import { fxRandom } from '../fx/fxRandom.js';
import { ActiveCarrier, writeCarrier, createCarrier } from '../../game/carrierVelocity.js';
import { entityCloakVisAt } from '../../game/cloakLook.js';
import { RepairSwarm } from '../../game/repairSwarm.js';
import { DRONE_STATE, REPAIR_FX, REPAIR_JOB } from '../../game/repairRig.js';
import { REPAIR_TUNE } from '../../data/repairDrones.js';
import { buildRepairDroneArrays, REPAIR_DRONE_DIMS, REPAIR_DRONE_PALETTE } from './repairDroneModel.js';

/**
 * Rekord drona w buforze instancji (float32):
 *   iRdPos   [0..3]   x, y, z środka względem początku partii (scena: x, −y gry, z w górę), kurs sceny
 *   iRdState [4..7]   skala, ramiona (0 — przenoszenie, 1 — płyta na poszyciu), płyta (0 / 1), spaw (0..1)
 *   iRdFx    [8..11]  ciąg (0..1), widoczność (maskowanie, 0..1), błysk trafienia (0..1), ziarno
 *   iRdSlab  [12..15] warstwa głębi (modelSlabDepth.js): zb, zt (z świata bryły), lo, hi
 */
export const REPAIR_DRONE_INST_STRIDE = 16;
export const REPAIR_DRONE_INST_ATTRS = Object.freeze([
  Object.freeze({ name: 'iRdPos', offset: 0 }),
  Object.freeze({ name: 'iRdState', offset: 4 }),
  Object.freeze({ name: 'iRdFx', offset: 8 }),
  Object.freeze({ name: 'iRdSlab', offset: 12 })
]);

/** Warstwa głębi dronów w passie ortho: nad skórą sprite'a, wieżami (≤ 1,8) i dyszami SIDE, pod efektami (14–15). */
export const SLAB_REPAIR_DRONE = Object.freeze({ lo: 2.2, hi: 10.5 });

/** Wygląd i efekty (strojenie: window.RepairDroneLook). */
export const REPAIR_DRONE_LOOK = {
  torch: [2.4, 3.1, 4.8],      // łuk palnika (HDR, × spaw)
  torchFlicker: 0.45,
  heat: [2.6, 0.9, 0.18],      // palnik przy prostowaniu (grzanie blachy)
  hit: [3.2, 0.45, 0.15],      // błysk trafienia
  engineIdle: 0.25,
  engineGain: 1.6,
  // iskry spawania: tempo [1/s], prędkość [j/s], życie [s], rozmiar, jasność
  sparkRate: 40,
  sparkRateHeat: 8,
  sparkSpeed: [60, 220],
  sparkLife: [0.14, 0.36],
  sparkSize: 0.32,
  sparkGain: 1.0,
  sparkColor: [1.0, 0.82, 0.55],
  heatSparkColor: [1.0, 0.45, 0.12],
  // światło łuku w siatce świateł (moc, zasięg [j.], wysokość)
  lightPower: 2.2,
  lightRange: 90,
  lightZ: 14,
  heatLightPower: 0.9,
  // błysk odbudowanej komórki
  regrowFlash: [0.75, 0.85, 1.0, 3.2, 120, 0.35],
  lostFlash: [1.0, 0.55, 0.25, 6, 260, 0.5],
  // dron mniejszy na ekranie (długość × zoom) — bez iskier i świateł
  minPx: 3
};

function rotZ(v, c, s) {
  return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
}

let _graph = null;
function droneGraph() {
  if (_graph) return _graph;
  const D = REPAIR_DRONE_DIMS;
  const iPos = attribute('iRdPos', 'vec4');
  const iState = attribute('iRdState', 'vec4');
  const aPart = attribute('aRdPart', 'vec2');
  const part = aPart.x;
  const c = cos(iPos.w), s = sin(iPos.w);
  const position = Fn(() => {
    const p = positionLocal.toVar();
    const drop = iState.y.mul(D.plateDrop);
    const isArm = part.greaterThan(0.5).and(part.lessThan(1.5));
    const isPlate = part.greaterThan(1.5).and(part.lessThan(2.5));
    // Przedramiona z chwytakami i płyta opadają z ramionami; bez płyty — płyta zwinięta do punktu pod dziobem.
    const z = select(isArm.or(isPlate), p.z.sub(drop), p.z);
    const noPlate = isPlate.and(iState.z.lessThan(0.5));
    const q = select(noPlate, vec3(D.plateX, 0.0, D.plateZ), vec3(p.x, p.y, z));
    return rotZ(q, c, s).mul(iState.x).add(iPos.xyz);
  })();
  const normal = Fn(() => rotZ(normalLocal.toVar(), c, s))();
  const state = varying(iState, 'vRdState').setInterpolation('flat');
  const fx = varying(attribute('iRdFx', 'vec4'), 'vRdFx').setInterpolation('flat');
  const slab = varying(attribute('iRdSlab', 'vec4'), 'vRdSlab').setInterpolation('flat');
  const torchW = varying(aPart.y, 'vRdTorch');
  _graph = { position, normal, state, fx, slab, torchW };
  return _graph;
}

/** Materiał partii dronów: materiał okrętów 3D z pozą części z rekordu drona. */
export class RepairDroneNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'RepairDroneNodeMaterial';
  }

  // Jak InstanceNode three: pozycja i normalna w układzie partii przed resztą etapu wierzchołków.
  setupPosition(builder) {
    const g = droneGraph();
    positionLocal.assign(g.position);
    if (builder.hasGeometryAttribute('normal')) normalLocal.assign(g.normal);
    return positionLocal;
  }
}

/** Zegar migotania palnika (raz na klatkę). */
export const REPAIR_DRONE_TIME = uniform(0);

/** Materiał dronów (graf raz; mapa otoczenia i maska słońca jak modele okrętów). */
export function createRepairDroneMaterial() {
  const g = droneGraph();
  const L = REPAIR_DRONE_LOOK;
  const weld = g.state.w, thrust = g.fx.x, hit = g.fx.z, seed = g.fx.w;
  // Łuk palnika migocze (spaw = 1 — łuk niebieskobiały, < 0,8 — grzanie pomarańczem przy prostowaniu).
  const flick = float(1.0).sub(fract(sin(REPAIR_DRONE_TIME.mul(53.0).add(seed.mul(17.0))).mul(43758.5453)).mul(L.torchFlicker));
  const arc = vec3(L.torch[0], L.torch[1], L.torch[2]).mul(select(weld.greaterThan(0.8), float(1.0), float(0.0)));
  const heatC = vec3(L.heat[0], L.heat[1], L.heat[2]).mul(select(weld.greaterThan(0.1).and(weld.lessThan(0.8)), float(1.0), float(0.0)));
  const torch = arc.add(heatC).mul(flick).mul(g.torchW);
  const hitC = vec3(L.hit[0], L.hit[1], L.hit[2]).mul(hit.mul(hit));
  const mat = createShipMaterial({
    name: 'drony naprawcze (partia)', materialClass: RepairDroneNodeMaterial,
    palette: REPAIR_DRONE_PALETTE, panelW: 5.5, panelH: 2.6,
    engineNode: float(L.engineIdle).add(thrust.mul(L.engineGain)),
    emissiveAdd: torch.add(hitC)
  });
  applyModelSlabDepth(mat, g.slab);
  // Maskowanie nosiciela: rozpuszczanie przez dither ekranu (widoczność w rekordzie).
  const vis = g.fx.y;
  const h = fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453));
  mat.maskNode = h.lessThan(vis.mul(1.02));
  applyShip3DEnv(mat);
  applySunShadowToBuiltinMaterial(mat);
  return mat;
}

let _staticAttrs = null;
function staticAttributes() {
  if (_staticAttrs) return _staticAttrs;
  const a = buildRepairDroneArrays();
  _staticAttrs = {
    position: new THREE.BufferAttribute(a.position, 3),
    normal: new THREE.BufferAttribute(a.normal, 3),
    uv: new THREE.BufferAttribute(a.uv, 2),
    aMat: new THREE.BufferAttribute(a.mat, 1),
    aRdPart: new THREE.BufferAttribute(a.part, 2),
    index: new THREE.BufferAttribute(a.index, 1)
  };
  return _staticAttrs;
}

/** InstancedBufferGeometry dronów z buforem instancji na `capacity` dronów. */
export function createRepairDroneGeometry(capacity) {
  const a = staticAttributes();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', a.position);
  g.setAttribute('normal', a.normal);
  g.setAttribute('uv', a.uv);
  g.setAttribute('aMat', a.aMat);
  g.setAttribute('aRdPart', a.aRdPart);
  g.setIndex(a.index);
  const data = new Float32Array(Math.max(1, capacity) * REPAIR_DRONE_INST_STRIDE);
  const buffer = new THREE.InstancedInterleavedBuffer(data, REPAIR_DRONE_INST_STRIDE, 1);
  for (const { name, offset } of REPAIR_DRONE_INST_ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry: g, data, buffer };
}

const START_CAPACITY = 32;
const _rec = new Float32Array(REPAIR_DRONE_INST_STRIDE);
const _carrier = createCarrier();
const _pose = { x: 0, y: 0, angle: 0 };

/** Partia dronów i ich efekty (jedna na grę). */
export class RepairDronesView {
  constructor(scene) {
    this.material = createRepairDroneMaterial();
    this.mesh = new THREE.Mesh(undefined, this.material);
    this.mesh.name = 'drony naprawcze';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.layers.set(0);
    this.count = 0;
    this.capacity = 0;
    this.data = null;
    this.buffer = null;
    this.draws = 0;
    this._fxRead = new WeakMap();   // rig → licznik przeczytanych zdarzeń
    this._alloc(START_CAPACITY);
    this._org = { x: 0, y: 0 };
    this.stats = { drones: 0, sparks: 0, lights: 0, events: 0 };
    if (scene) scene.add(this.mesh);
  }

  _alloc(capacity) {
    const old = this.mesh.geometry;
    const { geometry, data, buffer } = createRepairDroneGeometry(capacity);
    if (this.data && this.count > 0) data.set(this.data.subarray(0, this.count * REPAIR_DRONE_INST_STRIDE));
    this.mesh.geometry = geometry;
    this.data = data;
    this.buffer = buffer;
    this.capacity = capacity;
    if (old && old.isBufferGeometry) old.dispose();
  }

  /**
   * Raz na klatkę renderu. p: poseOf(e) → { x, y, angle } pozy renderu (gracz — interpolowana) albo null;
   * dt — czas klatki (pauza: 0 — bez iskier); zoom — px na j. (LOD efektów); hidden(e) — nosiciel ukryty (mgła wojny);
   * time — zegar (migotanie palnika); swarm — rejestr (domyślnie RepairSwarm).
   */
  sync(p = {}) {
    const swarm = p.swarm || RepairSwarm;
    const dt = Math.max(0, Number(p.dt) || 0);
    const zoom = Math.max(1e-4, Number(p.zoom) || 1);
    const L = REPAIR_DRONE_LOOK;
    REPAIR_DRONE_TIME.value = Number(p.time) || 0;
    sceneOriginNearCamera(this._org);
    this.count = 0;
    let sparks = 0, lights = 0;
    for (let r = 0; r < swarm.rigs.length; r++) {
      const rig = swarm.rigs[r];
      this._drainFx(rig);
      if (rig.out === 0) continue;
      if (p.hidden && p.hidden(rig.carrier)) continue;
      const T = rig.tune || REPAIR_TUNE;
      const cs = rig.target?.beamHull ? rig.target.beamHull.cellSize : 15;
      for (let k = 0; k < rig.drones.length; k++) {
        const d = rig.drones[k];
        if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) continue;
        const ent = d.frame === 1 ? rig.carrier : rig.target;
        if (!ent) continue;
        const pose = this._poseOf(ent, p.poseOf);
        const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
        const wx = pose.x + c * d.lx - s * d.ly;
        const wy = pose.y + s * d.lx + c * d.ly;
        const wyaw = d.yaw + pose.angle;
        const vis = entityCloakVisAt(rig.carrier, wx, wy);
        if (vis <= 0.01) continue;
        const hitAge = rig.time - d.hitT;
        // Rekord instancji.
        const R = _rec;
        R[0] = wx - this._org.x; R[1] = -wy - this._org.y; R[2] = d.lz; R[3] = -wyaw;
        R[4] = 1; R[5] = d.arm; R[6] = d.plate; R[7] = d.weld;
        R[8] = d.thrust; R[9] = vis; R[10] = hitAge >= 0 && hitAge < 0.25 ? 1 - hitAge / 0.25 : 0; R[11] = (d.index * 0.618) % 1;
        R[12] = d.lz - 8; R[13] = d.lz + 3; R[14] = SLAB_REPAIR_DRONE.lo; R[15] = SLAB_REPAIR_DRONE.hi;
        this._push(R);
        // Efekty spawania i grzania (pauza: dt = 0 — nic).
        if (dt > 0 && d.state === DRONE_STATE.WORK && d.weld > 0.1 && T.droneLength * zoom >= L.minPx && vis > 0.5) {
          const fc = Math.cos(wyaw), fs = Math.sin(wyaw);
          let px, py;
          if (d.job === REPAIR_JOB.REGROW) {
            // Punkt spawu obiega obwód płyty z postępem spawania.
            const half = cs * 0.5;
            const u = (d.jobTimer / Math.max(0.1, T.weldTime)) * 4;
            const side = Math.floor(u) & 3, t = (u - Math.floor(u)) * 2 - 1;
            let ox = 0, oy = 0;
            if (side === 0) { ox = half; oy = t * half; } else if (side === 1) { ox = -t * half; oy = half; }
            else if (side === 2) { ox = -half; oy = -t * half; } else { ox = t * half; oy = -half; }
            const fx = T.plateForward + ox;
            px = wx + fc * fx - fs * oy;
            py = wy + fs * fx + fc * oy;
          } else {
            // Prostowanie / gniazdo: palnik pod dziobem.
            px = wx + fc * REPAIR_DRONE_DIMS.torchX;
            py = wy + fs * REPAIR_DRONE_DIMS.torchX;
          }
          const arc = d.weld > 0.8;
          const rate = arc ? L.sparkRate : L.sparkRateHeat;
          ActiveCarrier.set(writeCarrier(rig.target, px, py, true, _carrier));
          sparks += this._sparks(px, py, rate * dt, arc ? L.sparkColor : L.heatSparkColor);
          const fl = Core3D.fx?.lights;
          if (fl) {
            const k2 = 0.7 + 0.3 * fxRandom.next();
            const pw = (arc ? L.lightPower : L.heatLightPower) * k2;
            const col = arc ? L.torch : L.heat;
            if (fl.point(px, py, col[0] / 4.8, col[1] / 4.8, col[2] / 4.8, pw, L.lightRange, L.lightZ)) lights++;
          }
          ActiveCarrier.clear();
        }
      }
    }
    this._end();
    this.stats.drones = this.count;
    this.stats.sparks = sparks;
    this.stats.lights = lights;
    return this.count;
  }

  _poseOf(ent, poseOf) {
    const q = poseOf ? poseOf(ent) : null;
    if (q && Number.isFinite(q.x)) { _pose.x = q.x; _pose.y = q.y; _pose.angle = q.angle; return _pose; }
    _pose.x = (ent.pos && typeof ent.pos.x === 'number') ? ent.pos.x : (Number(ent.x) || 0);
    _pose.y = (ent.pos && typeof ent.pos.y === 'number') ? ent.pos.y : (Number(ent.y) || 0);
    _pose.angle = Number(ent.angle) || 0;
    return _pose;
  }

  _sparks(x, y, want, color) {
    const L = REPAIR_DRONE_LOOK;
    // Ułamek iskry przechodzi na następną klatkę losowaniem (fxRandom — obraz, nie rozgrywka).
    let n = Math.floor(want);
    if (fxRandom.next() < want - n) n++;
    for (let i = 0; i < n; i++) {
      const a = fxRandom.next() * Math.PI * 2;
      const sp = L.sparkSpeed[0] + fxRandom.next() * (L.sparkSpeed[1] - L.sparkSpeed[0]);
      const life = L.sparkLife[0] + fxRandom.next() * (L.sparkLife[1] - L.sparkLife[0]);
      SparkSystem3D.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life, L.sparkSize * (0.6 + 0.6 * fxRandom.next()), L.sparkGain, color);
    }
    return n;
  }

  // Zdarzenia rigu od ostatniego odczytu: błysk odbudowanej komórki, zestrzelony dron.
  _drainFx(rig) {
    let read = this._fxRead.get(rig);
    if (read === undefined) { read = rig.fxWrite; this._fxRead.set(rig, read); return; }
    const cap = rig.fx.length;
    if (rig.fxWrite - read > cap) read = rig.fxWrite - cap;
    const L = REPAIR_DRONE_LOOK;
    const fl = Core3D.fx?.lights;
    for (; read < rig.fxWrite; read++) {
      const f = rig.fx[read % cap];
      this.stats.events++;
      if (f.kind === REPAIR_FX.REGROWN) {
        ActiveCarrier.set(writeCarrier(rig.target, f.x, f.y, false, _carrier));
        const q = L.regrowFlash;
        if (fl) fl.flash(f.x, f.y, q[0], q[1], q[2], q[3], q[4], q[5], 2, 0.3, 18);
        this._sparks(f.x, f.y, 10, L.sparkColor);
        ActiveCarrier.clear();
      } else if (f.kind === REPAIR_FX.DRONE_LOST) {
        const q = L.lostFlash;
        if (fl) fl.flash(f.x, f.y, q[0], q[1], q[2], q[3], q[4], q[5], 2, 0.4, 30);
        WeaponFx.droneBlast?.(f.x, f.y, 26);
        SparkSystem3D.burst(f.x, f.y, 18, 260, 0.5, 0.6, '#ffb070');
      }
    }
    this._fxRead.set(rig, read);
  }

  _push(R) {
    if (this.count >= this.capacity) this._alloc(this.capacity * 2);
    this.data.set(R, (this.count++) * REPAIR_DRONE_INST_STRIDE);
  }

  _end() {
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    if (n > 0) {
      this.mesh.position.set(this._org.x, this._org.y, 0);
      zbierzZakres(this.buffer, 0, n * REPAIR_DRONE_INST_STRIDE);
    }
    if (this.mesh.visible !== n > 0) this.mesh.visible = n > 0;
    this.draws = n > 0 ? 1 : 0;
  }
}

/** Siatka rozgrzewki: układ atrybutów partii (jedna instancja), materiał partii. */
export function repairDroneWarmHolder(material) {
  const { geometry, data } = createRepairDroneGeometry(1);
  geometry.instanceCount = 1;
  data[4] = 1; data[9] = 1; data[12] = -1; data[13] = 1; data[14] = SLAB_REPAIR_DRONE.lo; data[15] = SLAB_REPAIR_DRONE.hi;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

// Jedna partia na grę (Core3D.scene) — tworzona przy pierwszym użyciu albo rozgrzewce.
let _view = null;
export function repairDronesView() {
  if (!_view && Core3D.scene) _view = new RepairDronesView(Core3D.scene);
  return _view;
}

/** Raz na klatkę renderu (index.html: po syncShipModels3D) — opcje jak RepairDronesView.sync. */
export function syncRepairDrones3D(p) {
  if (RepairSwarm.out === 0 && !_view) return 0;
  const v = repairDronesView();
  return v ? v.sync(p) : 0;
}

// Partia od razu przy gotowym urządzeniu (menu, pod kurtyną): mapa otoczenia modeli (applyShip3DEnv) przychodzi
// asynchronicznie i ustawia needsUpdate materiału — musi zdążyć PRZED rozgrzewką na ekranie ładowania, inaczej pierwszy
// rysunek roju budował drugi program w klatce.
Core3D.ready?.then?.((ok) => { if (ok) repairDronesView(); });

// Rozgrzewka (ekran ładowania): partia w passie ortho i w kamerach 3D — pierwszy wypuszczony rój nie kompiluje nic.
function warmObjects() {
  const v = repairDronesView();
  return v ? [repairDroneWarmHolder(v.material)] : [];
}
Core3D.warmup?.add({ name: 'drony naprawcze', objects: warmObjects, layer: 0, phase: 'loading' });
Core3D.warmup?.add({ name: 'drony naprawcze (kamery 3D)', objects: warmObjects, layer: 0, ortho: false, phase: 'loading' });

if (typeof window !== 'undefined') window.RepairDroneLook = REPAIR_DRONE_LOOK;
