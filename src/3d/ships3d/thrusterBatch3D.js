// ============================================================
// Dysze SIDE 3D w JEDNEJ PARTII (2026-10-07; model: thrusters/sideThruster3D.js, rysuje shipModels3DGame.js z listy
// SideNozzleFrame, którą pisze EngineVfxSystem). Wzór partii wież (turretBatch3D.js):
//  • geometria = scalone części modelu (BASE — sponson przy kadłubie, SWIVEL — obrotowa dysza) z atrybutem wierzchołka
//    aThrPart = (część, waga żaru dzwonu);
//  • Mesh + InstancedBufferGeometry (nie InstancedMesh — jego uuid wchodzi do klucza programu), JEDEN przepleciony
//    bufor instancji (rekord dyszy, SIDE_THRUSTER_INST_STRIDE liczb) — 5 buforów geometrii + 1 ≤ 8;
//  • JEDEN materiał (graf TSL raz) i JEDEN rysunek na wszystkie dysze w kadrze, wszystkich frakcji: farba z rekordu
//    (indeks palety — createShipMaterial({ palettes, paletteIndex })), żar gardzieli z ciągu (engineNode), żar dzwonu
//    z „heat” płomienia SIDE (emissiveAdd), poza części w etapie wierzchołków (ThrusterBatchNodeMaterial.setupPosition —
//    pozycja i normalna jak InstanceNode three), warstwa głębi z rekordu (modelSlabDepth.js).
// Pozycje rekordów względem początku przy kamerze (sceneOriginNearCamera — świat leży przy 5–10 mln j., float32),
// siatka partii stoi w tym początku (three składa modelViewMatrix w double). Wysyłka zakresem (zakresyWysylki.js),
// bez DynamicDrawUsage, bez alokacji na klatkę.
// ============================================================
import * as THREE from 'three/webgpu';
import { Fn, attribute, varying, vec3, float, select, positionLocal, normalLocal } from 'three/tsl';
import { buildSideThrusterArrays, SIDE_THRUSTER_PALETTES } from './thrusters/sideThruster3D.js';
import { createShipMaterial } from './shipMaterials3D.tsl.js';
import { applyModelSlabDepth } from './modelSlabDepth.js';
import { zbierzZakres } from '../zakresyWysylki.js';

/**
 * Rekord dyszy w buforze instancji (liczby float32):
 *   iThrPos   [0..3]   x, y, z osi obrotu względem początku partii (z = podstawa: sprite 0, model — mocowanie), K —
 *                      skala świat / lokalne (promień wylotu w j. świata)
 *   iThrRot   [4..7]   cos, sin kierunku podstawy (wydech w spoczynku), cos, sin kierunku wydechu teraz — scena
 *   iThrState [8..11]  ciąg (0..1), żar (0..1), indeks palety (SIDE_THRUSTER_PALETTE_KEYS), rezerwa
 *   iThrSlab  [12..15] warstwa głębi (modelSlabDepth.js): zb, zt (z świata bryły), lo, hi
 */
export const SIDE_THRUSTER_INST_STRIDE = 16;
export const SIDE_THRUSTER_INST_ATTRS = Object.freeze([
  Object.freeze({ name: 'iThrPos', offset: 0 }),
  Object.freeze({ name: 'iThrRot', offset: 4 }),
  Object.freeze({ name: 'iThrState', offset: 8 }),
  Object.freeze({ name: 'iThrSlab', offset: 12 })
]);

/** Rekord dyszy z pól obiektu `t` (bez wywołań z liczbami double — gorąca pętla klatki). */
export function writeSideThrusterInstance(data, o, t) {
  data[o] = t.x; data[o + 1] = t.y; data[o + 2] = t.z; data[o + 3] = t.scale;
  data[o + 4] = t.baseCos; data[o + 5] = t.baseSin; data[o + 6] = t.dirCos; data[o + 7] = t.dirSin;
  data[o + 8] = t.throttle; data[o + 9] = t.heat; data[o + 10] = t.palette; data[o + 11] = 0;
  data[o + 12] = t.zb; data[o + 13] = t.zt; data[o + 14] = t.lo; data[o + 15] = t.hi;
}

/** Pusty obiekt pól rekordu (writeSideThrusterInstance). */
export function sideThrusterInstanceScratch() {
  return {
    x: 0, y: 0, z: 0, scale: 1, baseCos: 1, baseSin: 0, dirCos: 1, dirSin: 0,
    throttle: 0, heat: 0, palette: 0, zb: 0, zt: 1, lo: 0, hi: 1
  };
}

// ---------------------------------------------------------------------------
// Materiał (graf TSL raz na grę)
// ---------------------------------------------------------------------------
let _graph = null;

function thrusterGraph() {
  if (_graph) return _graph;
  const iPos = attribute('iThrPos', 'vec4');
  const iRot = attribute('iThrRot', 'vec4');
  const aPart = attribute('aThrPart', 'vec2');
  const swivel = aPart.x.greaterThan(0.5);
  // BASE — kierunek podstawy, SWIVEL — kierunek wydechu (obrót wokół osi Z sceny)
  const c = select(swivel, iRot.z, iRot.x), s = select(swivel, iRot.w, iRot.y);
  const rotZ = (v) => vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
  const position = Fn(() => rotZ(positionLocal.toVar()).mul(iPos.w).add(iPos.xyz))();
  const normal = Fn(() => rotZ(normalLocal.toVar()))();
  // Stałe na instancję (flat — bez interpolacji): ciąg, żar, paleta; warstwa głębi.
  const state = varying(attribute('iThrState', 'vec4'), 'vThrState').setInterpolation('flat');
  const slab = varying(attribute('iThrSlab', 'vec4'), 'vThrSlab').setInterpolation('flat');
  const heatW = varying(aPart.y, 'vThrHeatW');
  _graph = { position, normal, state, slab, heatW };
  return _graph;
}

/** Materiał partii dysz: materiał okrętów (shipMaterials3D.tsl.js) z pozą części z rekordu dyszy. */
export class ThrusterBatchNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'ThrusterBatchNodeMaterial';
  }

  // Jak InstanceNode three: pozycja i normalna w układzie partii przed resztą etapu wierzchołków.
  setupPosition(builder) {
    const g = thrusterGraph();
    positionLocal.assign(g.position);
    if (builder.hasGeometryAttribute('normal')) normalLocal.assign(g.normal);
    return positionLocal;
  }
}

// Żar dzwonu po dłuższym ciągu (stygnie jak „heat” płomienia SIDE): ciemna czerwień przy gardzieli, pod progiem
// bloomu (0,9) — ciepły odcień metalu, nie lampa. Gardziel (E_ENGINE, widać ją w kamerach 3D): tlenie na jałowym,
// pełny żar przy ciągu.
export const SIDE_THRUSTER_GLOW = Object.freeze({ heat: [1.0, 0.22, 0.03], heatGain: 0.26, throatIdle: 0.15, throatGain: 1.1 });

/** Materiał dysz (bez mapy otoczenia i maski słońca — dokłada je gra, shipModels3DGame.js). */
export function createThrusterBatchMaterial() {
  const g = thrusterGraph();
  const thr = g.state.x, heat = g.state.y;
  const G = SIDE_THRUSTER_GLOW;
  const mat = createShipMaterial({
    panelW: 1.1, panelH: 0.55, name: 'dysze SIDE 3D (partia)', materialClass: ThrusterBatchNodeMaterial,
    palettes: SIDE_THRUSTER_PALETTES, paletteIndex: g.state.z,
    engineNode: float(G.throatIdle).add(thr.mul(G.throatGain)),
    // żar ~ heat³ — przy pracy impulsowej dzwon ledwie się rumieni, po dłuższym ciągu ciemna czerwień
    emissiveAdd: vec3(G.heat[0], G.heat[1], G.heat[2]).mul(heat.mul(heat).mul(heat).mul(g.heatW).mul(G.heatGain))
  });
  applyModelSlabDepth(mat, g.slab);
  return mat;
}

// ---------------------------------------------------------------------------
// Partia (jedna w grze)
// ---------------------------------------------------------------------------
let _staticAttrs = null;
function staticAttributes() {
  if (_staticAttrs) return _staticAttrs;
  const fa = buildSideThrusterArrays();
  _staticAttrs = {
    position: new THREE.BufferAttribute(fa.position, 3),
    normal: new THREE.BufferAttribute(fa.normal, 3),
    uv: new THREE.BufferAttribute(fa.uv, 2),
    aMat: new THREE.BufferAttribute(fa.mat, 1),
    aThrPart: new THREE.BufferAttribute(fa.part, 2),
    index: new THREE.BufferAttribute(fa.index, 1)
  };
  return _staticAttrs;
}

/** InstancedBufferGeometry dysz z buforem instancji na `capacity` dysz. */
export function createThrusterBatchGeometry(capacity) {
  const a = staticAttributes();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', a.position);
  g.setAttribute('normal', a.normal);
  g.setAttribute('uv', a.uv);
  g.setAttribute('aMat', a.aMat);
  g.setAttribute('aThrPart', a.aThrPart);
  g.setIndex(a.index);
  const data = new Float32Array(Math.max(1, capacity) * SIDE_THRUSTER_INST_STRIDE);
  const buffer = new THREE.InstancedInterleavedBuffer(data, SIDE_THRUSTER_INST_STRIDE, 1);
  for (const { name, offset } of SIDE_THRUSTER_INST_ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); // instancje w całym kadrze (frustumCulled = false)
  return { geometry: g, data, buffer };
}

const START_CAPACITY = 64;

/** Partia dysz (jedna na grę): begin → push(rekord) × dysze → end, raz na klatkę renderu. */
export class ThrusterBatch {
  constructor(scene, material) {
    this.count = 0;
    this.capacity = 0;
    this.data = null;
    this.buffer = null;
    this.orgX = 0;
    this.orgY = 0;
    this.draws = 0;
    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.name = 'dysze SIDE 3D';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.layers.set(0);
    this._alloc(START_CAPACITY);
    scene.add(this.mesh);
  }

  _alloc(capacity) {
    const old = this.mesh.geometry;
    const { geometry, data, buffer } = createThrusterBatchGeometry(capacity);
    if (this.data && this.count > 0) data.set(this.data.subarray(0, this.count * SIDE_THRUSTER_INST_STRIDE));
    this.mesh.geometry = geometry;
    this.data = data;
    this.buffer = buffer;
    this.capacity = capacity;
    // stara geometria: bufor instancji zwalnia three (dispose); stałe atrybuty wracają przy najbliższym rysunku
    if (old && old.isBufferGeometry) old.dispose();
  }

  /** Początek klatki: licznik na zero, początek partii (układ sceny: x, −y świata gry). */
  begin(orgX, orgY) {
    this.orgX = orgX;
    this.orgY = orgY;
    this.count = 0;
  }

  /** Rekord następnej dyszy z pól `t` (writeSideThrusterInstance); pojemność rośnie ×2. */
  push(t) {
    if (this.count >= this.capacity) this._alloc(this.capacity * 2);
    writeSideThrusterInstance(this.data, (this.count++) * SIDE_THRUSTER_INST_STRIDE, t);
  }

  /** Koniec klatki: liczba instancji, widoczność, początek i wysyłka zapisanego zakresu. */
  end() {
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    if (n > 0) {
      this.mesh.position.set(this.orgX, this.orgY, 0);
      zbierzZakres(this.buffer, 0, n * SIDE_THRUSTER_INST_STRIDE);
    }
    if (this.mesh.visible !== n > 0) this.mesh.visible = n > 0;
    this.draws = n > 0 ? 1 : 0;
  }
}

/** Siatka rozgrzewki: układ atrybutów partii (jedna instancja), materiał partii, stan jak siatka partii. */
export function thrusterBatchWarmHolder(material) {
  const { geometry } = createThrusterBatchGeometry(1);
  geometry.instanceCount = 1;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}
