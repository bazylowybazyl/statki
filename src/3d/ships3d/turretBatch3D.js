// ============================================================
// Wieże broni 3D w PARTIACH (opcja „Bronie 3D”, src/3d/ships3d/shipModels3DGame.js; 2026-10-07).
//
// Dawniej każda wieża była drzewem siatek (pierścień, obudowa, każda lufa, wirnik) — 3–6 rysunków na wieżę,
// a rysunek kosztuje w three r183 na WebGPU ~15–20 µs CPU: bitwa 166 okrętów przy zoomie 0,1 (247 wież) to
// +880 rysunków i Core3D 4,3 → 16,4 ms. Teraz JEDEN rysunek na RODZINĘ broni (WEAPON3D_FAMILY) dla wszystkich
// wież tej rodziny w kadrze (24 rodziny, niezależnie od liczby wież):
//  • geometria rodziny = scalone części modelu (pierścień, obudowa, n kopii lufy, n kopii wirnika) z atrybutem
//    wierzchołka aTurPart = (część, przesunięcie kopii lufy w układzie czopu x, y, z) — TURRET_PART;
//  • Mesh + InstancedBufferGeometry (nie InstancedMesh — jego uuid wchodzi do klucza programu), JEDEN
//    przepleciony bufor instancji (rekord wieży, TURRET_INST_STRIDE liczb) — 5 buforów geometrii + 1 ≤ 8;
//  • jeden materiał (graf TSL raz) dla wszystkich rodzin: pozę części liczy etap wierzchołków z rekordu wieży
//    (TurretBatchNodeMaterial.setupPosition, wzór InstanceNode three — pozycja i normalna), czop rodziny
//    z uniformu obiektu (userData.turretTrunnion), warstwa głębi (modelSlabDepth.js) z rekordu.
// Łańcuch części jak dawne drzewo Object3D (lustro CPU: turretVertexCpu, test tests/turretBatch3D.test.mjs):
//   pierścień — kurs kadłuba θ;  obudowa — kurs lufy α;
//   lufa      — α, czop (tx, tz), pochylenie p (obrót wokół osi Y o −p), odrzut wzdłuż osi lufy, kopia lufy;
//   wirnik    — jak lufa + obrót wokół osi lufy (X) o kąt wirnika, przed przesunięciem kopii.
// Pozycje rekordów względem początku przy kamerze (sceneOriginNearCamera — świat leży przy 5–10 mln j., float32),
// siatka partii stoi w tym początku (three składa modelViewMatrix w double). Wysyłka zakresem (zakresyWysylki.js),
// bez DynamicDrawUsage, bez alokacji na klatkę.
// ============================================================
import * as THREE from 'three/webgpu';
import { Fn, If, attribute, uniform, varying, vec3, select, cos, sin, positionLocal, normalLocal } from 'three/tsl';
import { buildWeapon3D } from './weapons/weapons3D.js';
import { createShipMaterial } from './shipMaterials3D.tsl.js';
import { applyModelSlabDepth } from './modelSlabDepth.js';
import { zbierzZakres } from '../zakresyWysylki.js';

/** Część modelu wieży (aTurPart.x). */
export const TURRET_PART = Object.freeze({ RING: 0, HOUSING: 1, BARREL: 2, SPIN: 3 });

/**
 * Rekord wieży w buforze instancji (liczby float32):
 *   iTurPos    [0..3]   x, y, z podstawy wieży względem początku partii (z = pokład pod wieżą), K — skala świat / lokalne
 *   iTurRot    [4..7]   cos α, sin α (kurs lufy w świecie), cos θ, sin θ (kurs kadłuba — pierścień)
 *   iTurBarrel [8..11]  cos p, sin p (pochylenie lufy), odrzut (j. lokalne wieży), kąt wirnika
 *   iTurSlab   [12..15] warstwa głębi (modelSlabDepth.js): zb, zt (z świata bryły), lo, hi
 */
export const TURRET_INST_STRIDE = 16;
export const TURRET_INST_ATTRS = Object.freeze([
  Object.freeze({ name: 'iTurPos', offset: 0 }),
  Object.freeze({ name: 'iTurRot', offset: 4 }),
  Object.freeze({ name: 'iTurBarrel', offset: 8 }),
  Object.freeze({ name: 'iTurSlab', offset: 12 })
]);

/** Rekord wieży z pól obiektu `t` (bez wywołań z liczbami double — gorąca pętla klatki). */
export function writeTurretInstance(data, o, t) {
  data[o] = t.x; data[o + 1] = t.y; data[o + 2] = t.z; data[o + 3] = t.scale;
  data[o + 4] = t.yawCos; data[o + 5] = t.yawSin; data[o + 6] = t.hullCos; data[o + 7] = t.hullSin;
  data[o + 8] = t.pitchCos; data[o + 9] = t.pitchSin; data[o + 10] = t.back; data[o + 11] = t.spin;
  data[o + 12] = t.zb; data[o + 13] = t.zt; data[o + 14] = t.lo; data[o + 15] = t.hi;
}

/** Pusty obiekt pól rekordu (writeTurretInstance). */
export function turretInstanceScratch() {
  return {
    x: 0, y: 0, z: 0, scale: 1, yawCos: 1, yawSin: 0, hullCos: 1, hullSin: 0,
    pitchCos: 1, pitchSin: 0, back: 0, spin: 0, zb: 0, zt: 1, lo: 0, hi: 1
  };
}

// ---------------------------------------------------------------------------
// Geometria rodziny (czyste tablice — bez three; testy w Node)
// ---------------------------------------------------------------------------
const _familyArrays = new Map();

function maxZ(position) {
  let m = -Infinity;
  for (let i = 2; i < position.length; i += 3) if (position[i] > m) m = position[i];
  return m;
}

/**
 * Scalona geometria rodziny broni: { family, model, position, normal, uv, mat, part (vec4 na wierzchołek), index,
 * vertexCount, height, trunnion: [tx, tz], pieces: [{ part, off, first, count }] }.
 * Wysokość wieży (j. lokalne) jak dawne weaponGeometry: obudowa, pierścień albo lufa na czopie (≥ 1).
 */
export function buildTurretFamilyArrays(family) {
  let e = _familyArrays.get(family);
  if (e) return e;
  const model = buildWeapon3D(family);
  const P = model.parts;
  const ring = P.ring.build(), housing = P.housing.build(), barrel = P.barrel.build();
  const spin = P.spin ? P.spin.build() : null;
  const pieces = [
    { src: ring, part: TURRET_PART.RING, off: [0, 0, 0] },
    { src: housing, part: TURRET_PART.HOUSING, off: [0, 0, 0] }
  ];
  const offs = model.barrels.map(([y, z], i) => [model.barrelShift ? model.barrelShift[i] : 0, y, z]);
  for (const off of offs) pieces.push({ src: barrel, part: TURRET_PART.BARREL, off });
  if (spin) for (const off of offs) pieces.push({ src: spin, part: TURRET_PART.SPIN, off });
  let nv = 0, ni = 0;
  for (const p of pieces) { nv += p.src.vertexCount; ni += p.src.index.length; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const mat = new Float32Array(nv), part = new Float32Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const p of pieces) {
    const s = p.src;
    position.set(s.position, v * 3);
    normal.set(s.normal, v * 3);
    uv.set(s.uv, v * 2);
    mat.set(s.mat, v);
    for (let i = 0; i < s.vertexCount; i++) {
      const o = (v + i) * 4;
      part[o] = p.part; part[o + 1] = p.off[0]; part[o + 2] = p.off[1]; part[o + 3] = p.off[2];
    }
    for (let i = 0; i < s.index.length; i++) index[k + i] = s.index[i] + v;
    p.first = v;
    p.count = s.vertexCount;
    v += s.vertexCount;
    k += s.index.length;
  }
  const trunnion = [model.trunnion?.[0] || 0, model.trunnion?.[1] || 0];
  const height = Math.max(1, maxZ(ring.position), maxZ(housing.position), trunnion[1] + maxZ(barrel.position));
  e = Object.freeze({
    family, model, position, normal, uv, mat, part, index, vertexCount: nv, height, trunnion,
    pieces: Object.freeze(pieces.map(({ part: pp, off, first, count }) => Object.freeze({ part: pp, off, first, count })))
  });
  _familyArrays.set(family, e);
  return e;
}

/**
 * Lustro CPU etapu wierzchołków (TurretBatchNodeMaterial): wierzchołek v (j. lokalne części) z atrybutem
 * części `pt` = [część, ox, oy, oz] i rekordem `r` (TURRET_INST_STRIDE liczb od `o`) → pozycja względem
 * początku partii; `n` (opcjonalnie) — normalna. out = { x, y, z, nx, ny, nz }.
 */
export function turretVertexCpu(r, o, pt, trunnion, v, n, out) {
  const part = pt[0];
  const moving = part > 1.5, spinning = part > 2.5, ring = part < 0.5;
  const cs = Math.cos(r[o + 11]), sn = Math.sin(r[o + 11]);
  const cp = r[o + 8], sp = r[o + 9], back = r[o + 10];
  const yc = ring ? r[o + 6] : r[o + 4], ys = ring ? r[o + 7] : r[o + 5];
  const step = (x, y, z, point) => {
    if (spinning) { const ty = y * cs - z * sn, tz = y * sn + z * cs; y = ty; z = tz; }
    if (point) { x += pt[1]; y += pt[2]; z += pt[3]; if (moving) x -= back; }
    if (moving) {
      const tx = x * cp - z * sp, tz = x * sp + z * cp;
      x = tx + (point ? trunnion[0] : 0); z = tz + (point ? trunnion[1] : 0);
    }
    const wx = x * yc - y * ys, wy = x * ys + y * yc;
    return [wx, wy, z];
  };
  const p = step(v[0], v[1], v[2], true);
  const K = r[o + 3];
  out.x = p[0] * K + r[o]; out.y = p[1] * K + r[o + 1]; out.z = p[2] * K + r[o + 2];
  if (n) { const q = step(n[0], n[1], n[2], false); out.nx = q[0]; out.ny = q[1]; out.nz = q[2]; }
  return out;
}

// ---------------------------------------------------------------------------
// Materiał (graf TSL raz na grę)
// ---------------------------------------------------------------------------
const ZERO2 = new THREE.Vector2();
let _graph = null;

function turretGraph() {
  if (_graph) return _graph;
  const iPos = attribute('iTurPos', 'vec4');
  const iRot = attribute('iTurRot', 'vec4');
  const iBar = attribute('iTurBarrel', 'vec4');
  const aPart = attribute('aTurPart', 'vec4');
  const uTrunnion = uniform(new THREE.Vector2()).onObjectUpdate(({ object }) => object?.userData?.turretTrunnion || ZERO2);
  const part = aPart.x;
  const moving = part.greaterThan(1.5); // lufa i wirnik: kopia, odrzut, czop, pochylenie
  const spinning = part.greaterThan(2.5);
  const ring = part.lessThan(0.5);
  const cp = iBar.x, sp = iBar.y;
  const yc = select(ring, iRot.z, iRot.x), ys = select(ring, iRot.w, iRot.y);
  const rotX = (v, cs, sn) => vec3(v.x, v.y.mul(cs).sub(v.z.mul(sn)), v.y.mul(sn).add(v.z.mul(cs)));
  const rotP = (v) => vec3(v.x.mul(cp).sub(v.z.mul(sp)), v.y, v.x.mul(sp).add(v.z.mul(cp)));
  const rotZ = (v) => vec3(v.x.mul(yc).sub(v.y.mul(ys)), v.x.mul(ys).add(v.y.mul(yc)), v.z);
  // Kolejność jak dawne drzewo: wirnik (oś lufy) → kopia lufy − odrzut → pochylenie wokół czopu → kurs → skala, podstawa.
  const position = Fn(() => {
    const p = positionLocal.toVar();
    If(spinning, () => { p.assign(rotX(p, cos(iBar.w), sin(iBar.w))); });
    If(moving, () => { p.assign(rotP(p.add(aPart.yzw).sub(vec3(iBar.z, 0.0, 0.0))).add(vec3(uTrunnion.x, 0.0, uTrunnion.y))); });
    return rotZ(p).mul(iPos.w).add(iPos.xyz);
  })();
  const normal = Fn(() => {
    const n = normalLocal.toVar();
    If(spinning, () => { n.assign(rotX(n, cos(iBar.w), sin(iBar.w))); });
    If(moving, () => { n.assign(rotP(n)); });
    return rotZ(n);
  })();
  // warstwa głębi z rekordu: stała na instancję (bez interpolacji)
  const slab = varying(attribute('iTurSlab', 'vec4'), 'vTurSlab').setInterpolation('flat');
  _graph = { position, normal, slab };
  return _graph;
}

/** Materiał partii wież: materiał broni (shipMaterials3D.tsl.js) z pozą części z rekordu wieży. */
export class TurretBatchNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'TurretBatchNodeMaterial';
  }

  // Jak InstanceNode three: pozycja i normalna w układzie partii przed resztą etapu wierzchołków
  // (positionWorld, positionView i normalView liczą się już z wyniku).
  setupPosition(builder) {
    const g = turretGraph();
    positionLocal.assign(g.position);
    if (builder.hasGeometryAttribute('normal')) normalLocal.assign(g.normal);
    return positionLocal;
  }
}

/** Materiał wież (bez mapy otoczenia i maski słońca — dokłada je gra, shipModels3DGame.js). */
export function createTurretBatchMaterial() {
  const mat = createShipMaterial({ panelW: 7, panelH: 3.5, name: 'broń 3D (partie)', materialClass: TurretBatchNodeMaterial });
  applyModelSlabDepth(mat, turretGraph().slab);
  return mat;
}

// ---------------------------------------------------------------------------
// Partie (jedna na rodzinę w grze)
// ---------------------------------------------------------------------------
// Stałe atrybuty rodziny (wspólne dla geometrii partii i rozgrzewki — jedna wysyłka na GPU).
const _staticAttrs = new WeakMap();
function staticAttributes(fa) {
  let a = _staticAttrs.get(fa);
  if (a) return a;
  a = {
    position: new THREE.BufferAttribute(fa.position, 3),
    normal: new THREE.BufferAttribute(fa.normal, 3),
    uv: new THREE.BufferAttribute(fa.uv, 2),
    aMat: new THREE.BufferAttribute(fa.mat, 1),
    aTurPart: new THREE.BufferAttribute(fa.part, 4),
    index: new THREE.BufferAttribute(fa.index, 1)
  };
  _staticAttrs.set(fa, a);
  return a;
}

/** InstancedBufferGeometry rodziny z buforem instancji na `capacity` wież. */
export function createTurretBatchGeometry(fa, capacity) {
  const a = staticAttributes(fa);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', a.position);
  g.setAttribute('normal', a.normal);
  g.setAttribute('uv', a.uv);
  g.setAttribute('aMat', a.aMat);
  g.setAttribute('aTurPart', a.aTurPart);
  g.setIndex(a.index);
  const data = new Float32Array(Math.max(1, capacity) * TURRET_INST_STRIDE);
  const buffer = new THREE.InstancedInterleavedBuffer(data, TURRET_INST_STRIDE, 1);
  for (const { name, offset } of TURRET_INST_ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); // instancje w całym kadrze (frustumCulled = false)
  return { geometry: g, data, buffer };
}

const START_CAPACITY = 16;

class TurretFamilyBatch {
  constructor(family, material, scene) {
    this.family = family;
    this.arrays = buildTurretFamilyArrays(family);
    this.count = 0;
    this.capacity = 0;
    this.data = null;
    this.buffer = null;
    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.name = `wieże 3D: ${family}`;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.layers.set(0);
    this.mesh.userData.turretTrunnion = new THREE.Vector2(this.arrays.trunnion[0], this.arrays.trunnion[1]);
    this._alloc(START_CAPACITY);
    scene.add(this.mesh);
  }

  _alloc(capacity) {
    const old = this.mesh.geometry;
    const { geometry, data, buffer } = createTurretBatchGeometry(this.arrays, capacity);
    if (this.data && this.count > 0) data.set(this.data.subarray(0, this.count * TURRET_INST_STRIDE));
    this.mesh.geometry = geometry;
    this.data = data;
    this.buffer = buffer;
    this.capacity = capacity;
    // stara geometria: bufor instancji zwalnia three (dispose); stałe atrybuty wracają przy najbliższym rysunku
    if (old && old.isBufferGeometry) old.dispose();
  }

  /** Rekord następnej wieży z pól `t` (writeTurretInstance); pojemność rośnie ×2 (nowy bufor — `data` po wzroście). */
  push(t) {
    if (this.count >= this.capacity) this._alloc(this.capacity * 2);
    writeTurretInstance(this.data, (this.count++) * TURRET_INST_STRIDE, t);
  }
}

/** Zestaw partii wież (jeden na grę): begin → family(rodzina).push(rekord) × wieże → end, raz na klatkę renderu. */
export class TurretBatchSet {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.families = new Map(); // rodzina → TurretFamilyBatch
    this.list = [];
    this.orgX = 0;
    this.orgY = 0;
  }

  /** Początek klatki: liczniki na zero, początek partii (układ sceny: x, −y świata gry). */
  begin(orgX, orgY) {
    this.orgX = orgX;
    this.orgY = orgY;
    const L = this.list;
    for (let i = 0; i < L.length; i++) L[i].count = 0;
  }

  family(family) {
    let b = this.families.get(family);
    if (!b) {
      b = new TurretFamilyBatch(family, this.material, this.scene);
      this.families.set(family, b);
      this.list.push(b);
    }
    return b;
  }

  /** Koniec klatki: liczba instancji, widoczność, początek i wysyłka zapisanego zakresu. */
  end() {
    const L = this.list;
    let draws = 0, turrets = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      const n = b.count;
      b.mesh.geometry.instanceCount = n;
      if (n > 0) {
        b.mesh.position.set(this.orgX, this.orgY, 0);
        zbierzZakres(b.buffer, 0, n * TURRET_INST_STRIDE);
        draws++;
        turrets += n;
      }
      if (b.mesh.visible !== n > 0) b.mesh.visible = n > 0;
    }
    this.draws = draws;
    this.turrets = turrets;
  }
}

/** Siatka rozgrzewki: układ atrybutów partii (geometria rodziny, jedna instancja), materiał partii. */
export function turretBatchWarmHolder(material, family) {
  const fa = buildTurretFamilyArrays(family);
  const { geometry } = createTurretBatchGeometry(fa, 1);
  geometry.instanceCount = 1;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.turretTrunnion = new THREE.Vector2(fa.trunnion[0], fa.trunnion[1]);
  return mesh;
}
