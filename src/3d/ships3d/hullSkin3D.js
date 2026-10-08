// ============================================================
// Skóra modelu 3D na kadłubie 2D (opcja „Statki 3D”, 2026-09-30): model okrętu (ships/ships3D.js) jedzie po
// polu przesunięć węzłów kadłuba ze sprite'a (silnik belek, kratownica jednej warstwy) i znika tam, gdzie
// zginął jego węzeł — wgniecenia, dziury, rozpad i wraki z rozgrywki 2D widać na bryle 3D na całej jej
// wysokości (fizyka bez zmian, model to tylko wygląd).
//
// POLE: jeden bufor storage vec4 na grę (FIELD_CAP komórek): per ciało SLOT = pudło komórek kratownicy
// (cmin, cdim) — kadłub cały, wrak tylko pudło swoich węzłów. Komórka: (dx, dy, dz, stan) w układzie
// ciała, stan 1 — żywy węzeł TEGO ciała, 0,5 — komórka, której w pierwotnej konstrukcji nie było,
// 0 — węzeł martwy albo w innym kawałku (wraku). Zapis tylko zmienionych komórek, wysyłka zakresami
// (zakresyWysylki.js — wiele rozłącznych wycinków w jednej klatce).
//
// WIERZCHOŁEK (siatka w układzie CIAŁA — ta sama poza co skóra sprite'a w hexShips3D): pozycja =
// uOff + pozycja modelu (środek sprite'a = 0, skala sprite'a) + Σ w·d / Σ w (w — wagi rogów komórki
// żywych węzłów; bez żywych — przesunięcie kotwicy), uOff = latticeMin + anchorD (środek sprite'a w
// układzie ciała; wrak po rozpadzie — z przesuniętym latticeMin). aLat = położenie w komórkach kratownicy
// (z = 0: jedna warstwa, model w całej wysokości idzie za węzłem pod sobą), aOwn = najbliższa komórka
// pierwotnej konstrukcji (kotwica widoczności). Fragment znika (maskNode), gdy przeważają martwe rogi.
// Graf raz na model (tekstura pokładu), wartości per obiekt przez uniform().onObjectUpdate (slot, pudło,
// uOff) — każdy egzemplarz i każdy wrak na wspólnych węzłach.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, storage, vec2, vec3, vec4, float, int, floor, select, varyingProperty, max, mix, clamp,
  smoothstep, sin, time, texture, fract, positionLocal, hash
} from 'three/tsl';
import { zbierzZakresy } from '../zakresyWysylki.js';
import { hullDamagePool, sampleHullDamage } from '../hullDamageMap.tsl.js';
import { fxNoise } from '../fx/noise.js';

export const FIELD_CAP = 1 << 21; // komórek (vec4) — 32 MB GPU / CPU

const STATE_ALIVE = 1;
const STATE_NEVER = 0.5;
const STATE_GONE = 0;

let _attr = null;
let _node = null;
let _data = null;
// wolne przedziały [start, end) w komórkach (first-fit, scalane przy zwalnianiu)
const _free = [[0, FIELD_CAP]];

function ensureField() {
  if (_attr) return;
  _data = new Float32Array(FIELD_CAP * 4);
  _attr = new THREE.StorageBufferAttribute(_data, 4);
  _node = storage(_attr, 'vec4', FIELD_CAP).toReadOnly().setName('hullSkin3DField');
}

function allocCells(n) {
  for (let k = 0; k < _free.length; k++) {
    const f = _free[k];
    if (f[1] - f[0] >= n) {
      const start = f[0];
      f[0] += n;
      if (f[0] >= f[1]) _free.splice(k, 1);
      return start;
    }
  }
  return -1;
}

function freeCells(start, n) {
  if (!(n > 0) || start < 0) return;
  let k = 0;
  while (k < _free.length && _free[k][0] < start) k++;
  _free.splice(k, 0, [start, start + n]);
  // scal sąsiednie
  for (let i = Math.max(0, k - 1); i < _free.length - 1;) {
    if (_free[i][1] >= _free[i + 1][0]) { _free[i][1] = Math.max(_free[i][1], _free[i + 1][1]); _free.splice(i + 1, 1); }
    else i++;
  }
}

/**
 * Węzeł pola przesunięć (bufor storage vec4 na grę) — dla własnych grafów skóry FFD (budowle świata:
 * portBuildings3D.tsl.js, wariant „skin”). Komórka: (dx, dy, dz, stan) — stan 1 żywy, 0,5 nigdy, 0 martwy.
 */
export function hullSkinField() {
  ensureField();
  return _node;
}

export function hullSkinFieldStats() {
  let freeN = 0;
  for (const f of _free) freeN += f[1] - f[0];
  return { cap: FIELD_CAP, used: FIELD_CAP - freeN, blocks: _free.length };
}

// ---------------------------------------------------------------------------
// Geometria: atrybuty kratownicy dla (model, skala)
// ---------------------------------------------------------------------------

/**
 * Kratownica kadłuba 2D do skóry (z konstrukcji HullBodies.structureFor — wszystkie węzły pierwotne):
 * { cs, dims, occ (Uint8Array x·y — komórki z węzłem), ax, ay (środek sprite'a względem latticeMin) }.
 */
export function hullSkinLattice(structure, anchorDX, anchorDY) {
  const d = structure.dims, ns = structure.nodeStore;
  const occ = new Uint8Array(d.x * d.y);
  for (let i = 0; i < ns.count; i++) {
    if (ns.iz[i] !== 0) continue;
    occ[ns.ix[i] + ns.iy[i] * d.x] = 1;
  }
  return { cs: structure.cellSize, dims: { x: d.x, y: d.y, z: 1 }, occ, ax: anchorDX, ay: anchorDY };
}

/**
 * Geometria skóry: kopia geometrii modelu (jednostki świata, środek sprite'a = 0) × skala `scale`,
 * trójkąty dzielone na połówki krawędzi, aż najdłuższa krawędź ≤ maxEdgeCells komórek (wgniecenia z FFD
 * potrzebują wierzchołków w komórkach), z atrybutami aLat (położenie w komórkach kratownicy `lattice`,
 * hullSkinLattice) i aOwn (najbliższa komórka pierwotnej konstrukcji). Bez indeksu (każdy trójkąt
 * osobno). Źródło bez zmian.
 */
export function buildHullSkinGeometry(srcGeometry, lattice, scale = 1, maxEdgeCells = 2) {
  const src = srcGeometry.index ? srcGeometry.toNonIndexed() : srcGeometry;
  const P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv, M = src.attributes.aMat;
  const cs = lattice.cs, d = lattice.dims, occ = lattice.occ;
  // aLat = (środek sprite'a + pozycja) / cs − ½ (środek komórki i = latticeMin + (i + ½)·cs); z = 0.
  const o = { x: -lattice.ax, y: -lattice.ay };
  const maxEdge2 = (maxEdgeCells * cs) ** 2;
  const pos = [], nrm = [], uvs = [], mat = [];
  const pushV = (v) => { pos.push(v[0], v[1], v[2]); nrm.push(v[3], v[4], v[5]); uvs.push(v[6], v[7]); mat.push(v[8]); };
  const mid = (a, b) => {
    const m = new Array(9);
    for (let k = 0; k < 8; k++) m[k] = (a[k] + b[k]) * 0.5;
    const l = Math.hypot(m[3], m[4], m[5]) || 1;
    m[3] /= l; m[4] /= l; m[5] /= l;
    m[8] = a[8];
    return m;
  };
  const e2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const emit = (a, b, c, depth) => {
    if (depth < 7 && (e2(a, b) > maxEdge2 || e2(b, c) > maxEdge2 || e2(c, a) > maxEdge2)) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      emit(a, ab, ca, depth + 1); emit(ab, b, bc, depth + 1); emit(ca, bc, c, depth + 1); emit(ab, bc, ca, depth + 1);
      return;
    }
    pushV(a); pushV(b); pushV(c);
  };
  const vert = (i) => [
    P.getX(i) * scale, P.getY(i) * scale, P.getZ(i) * scale,
    N ? N.getX(i) : 0, N ? N.getY(i) : 0, N ? N.getZ(i) : 1,
    U ? U.getX(i) : 0, U ? U.getY(i) : 0,
    M ? M.getX(i) : 0
  ];
  for (let i = 0; i + 2 < P.count; i += 3) emit(vert(i), vert(i + 1), vert(i + 2), 0);
  const n = pos.length / 3;
  const lat = new Float32Array(n * 3);
  const own = new Float32Array(n * 3);
  const dxy = d.x * d.y;
  for (let i = 0; i < n; i++) {
    const fx = (pos[i * 3] - o.x) / cs - 0.5;
    const fy = (pos[i * 3 + 1] - o.y) / cs - 0.5;
    const fz = 0; // jedna warstwa kratownicy: cała wysokość modelu nad węzłem
    lat[i * 3] = fx; lat[i * 3 + 1] = fy; lat[i * 3 + 2] = fz;
    // Kotwica: najbliższa zajęta komórka w oknie 3×3 wokół komórki wierzchołka (5×5 w razie braku).
    const cx = Math.round(fx), cy = Math.round(fy), cz = Math.round(fz);
    let found = false, bestD = Infinity, bx = cx, by = cy, bz = cz;
    for (let R = 1; R <= 2 && !found; R++) {
      for (let z = cz - R; z <= cz + R; z++) {
        if (z < 0 || z >= d.z) continue;
        for (let y = cy - R; y <= cy + R; y++) {
          if (y < 0 || y >= d.y) continue;
          for (let x = cx - R; x <= cx + R; x++) {
            if (x < 0 || x >= d.x) continue;
            if (!occ[x + y * d.x + z * dxy]) continue;
            const ddx = x - fx, ddy = y - fy, ddz = z - fz;
            const dd = ddx * ddx + ddy * ddy + ddz * ddz;
            if (dd < bestD) { bestD = dd; found = true; bx = x; by = y; bz = z; }
          }
        }
      }
    }
    own[i * 3] = bx; own[i * 3 + 1] = by; own[i * 3 + 2] = bz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(mat), 1));
  g.setAttribute('aLat', new THREE.BufferAttribute(lat, 3));
  g.setAttribute('aOwn', new THREE.BufferAttribute(own, 3));
  g.computeBoundingSphere();
  if (src !== srcGeometry) src.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// Materiał: FFD + maska na wspólnym grafie (per obiekt: slot, pudło, uOff)
// ---------------------------------------------------------------------------

/**
 * Zamienia materiał okrętu (createShipMaterial) w skórę 3D: positionNode (FFD) i maskNode.
 * Obiekt (siatka) niesie w userData.skin3D: { offset, cmin: Vector3, cdim: Vector3, off: Vector3, cs, on }.
 */
export function makeHullSkinMaterial(mat) {
  ensureField();
  const F = _node;
  const skinOf = (o) => o?.userData?.skin3D || null;
  const uOn = uniform(0).onObjectUpdate(({ object }) => (skinOf(object)?.on ? 1 : 0));
  const uOffset = uniform(0).onObjectUpdate(({ object }) => skinOf(object)?.offset || 0);
  const uCs = uniform(15).onObjectUpdate(({ object }) => skinOf(object)?.cs || 15);
  const uCmin = uniform(new THREE.Vector3()).onObjectUpdate(({ object }) => skinOf(object)?.cmin || _zero3);
  const uCdim = uniform(new THREE.Vector3(1, 1, 1)).onObjectUpdate(({ object }) => skinOf(object)?.cdim || _one3);
  const uOffV = uniform(new THREE.Vector3()).onObjectUpdate(({ object }) => skinOf(object)?.off || _zero3);
  const vVis = varyingProperty('float', 'vHullSkin3DVis');
  const vLat = varyingProperty('vec3', 'vHullSkin3DLat');
  const cell = (c) => {
    const l = c.sub(uCmin);
    const inside = l.x.greaterThanEqual(0).and(l.y.greaterThanEqual(0)).and(l.z.greaterThanEqual(0))
      .and(l.x.lessThan(uCdim.x)).and(l.y.lessThan(uCdim.y)).and(l.z.lessThan(uCdim.z));
    const idx = uOffset.add(l.x).add(l.y.mul(uCdim.x)).add(l.z.mul(uCdim.x).mul(uCdim.y));
    const safe = select(inside, idx, float(0));
    const v = F.element(int(safe));
    return select(inside, v, vec4(0, 0, 0, 0));
  };
  mat.positionNode = Fn(() => {
    const f = attribute('aLat', 'vec3');
    const own = attribute('aOwn', 'vec3');
    const base = floor(f).toVar();
    const fr = f.sub(base).toVar();
    const disp = vec3(0).toVar();
    const wsum = float(0).toVar();
    for (let k = 0; k < 8; k++) {
      const ox = k & 1, oy = (k >> 1) & 1, oz = (k >> 2) & 1;
      const t = cell(base.add(vec3(ox, oy, oz)));
      const wx = ox ? fr.x : fr.x.oneMinus();
      const wy = oy ? fr.y : fr.y.oneMinus();
      const wz = oz ? fr.z : fr.z.oneMinus();
      const w = wx.mul(wy).mul(wz).mul(t.w.greaterThan(0.75).select(1.0, 0.0));
      disp.addAssign(t.xyz.mul(w));
      wsum.addAssign(w);
    }
    const ownT = cell(own);
    const d = select(wsum.greaterThan(1e-4), disp.div(max(wsum, 1e-4)), ownT.xyz);
    const on = uOn.greaterThan(0.5);
    vVis.assign(select(on, select(ownT.w.greaterThan(0.75), float(1), float(0)), float(1)));
    vLat.assign(f);
    // Spoczynek = pozycja modelu (środek sprite'a) przesunięta do układu ciała.
    const rest = uOffV.add(attribute('position', 'vec3'));
    return select(on, rest.add(d), rest);
  })();
  // Widoczność NA PIKSEL: 8 rogów komórki punktu powierzchni (współrzędna kratownicy interpolowana
  // z wierzchołków — w modelu afiniczna), waga żywych rogów kontra martwych (komórki spoza pierwotnej
  // konstrukcji się nie liczą); bez żadnego z nich — stan kotwicy wierzchołków. Dziura ma brzeg w połowie
  // między żywym a martwym węzłem, niezależnie od wielkości trójkątów modelu.
  const dmg = damageInputs(vLat);
  // Stan brzegu w punkcie: waga żywych − martwych rogów + szum poszarpania (≥ 0 — widać) i czy są rogi.
  const edgeState = () => {
    const f = vLat;
    const base = floor(f).toVar();
    const fr = f.sub(base).toVar();
    const alive = float(0).toVar();
    const gone = float(0).toVar();
    for (let k = 0; k < 8; k++) {
      const ox = k & 1, oy = (k >> 1) & 1, oz = (k >> 2) & 1;
      const t = cell(base.add(vec3(ox, oy, oz)));
      const wx = ox ? fr.x : fr.x.oneMinus();
      const wy = oy ? fr.y : fr.y.oneMinus();
      const wz = oz ? fr.z : fr.z.oneMinus();
      const w = wx.mul(wy).mul(wz);
      alive.addAssign(w.mul(t.w.greaterThan(0.75).select(1.0, 0.0)));
      gone.addAssign(w.mul(t.w.lessThan(0.25).select(1.0, 0.0)));
    }
    const any = alive.add(gone).greaterThan(1e-4);
    // Poszarpany brzeg dziury: ten sam szum co brzeg rany skóry sprite'a (± ~⅓ komórki).
    const edge = alive.sub(gone).add(dmg.edgeNoise().mul(2.0));
    return { any, edge };
  };
  dmg.edgeState = edgeState;
  dmg.uOn = uOn;
  mat.maskNode = Fn(() => {
    const { any, edge } = edgeState();
    const vis = select(any, edge.greaterThanEqual(0.0), vVis.greaterThan(0.5));
    return uOn.lessThan(0.5).or(vis);
  })();
  applyHullSkinDamage(mat, vLat, dmg);
  mat.userData.hullSkin3D = true;
  return mat;
}

// ---------------------------------------------------------------------------
// Mapa ran (src/3d/hullDamageMap.js) na modelu: ten sam slot rodu i ten sam uv skóry sprite'a co skóra
// belek — uv z położenia w kratownicy (vLat, spoczynek: rana jedzie z odkształceniem) na CAŁEJ bryle
// (pokład i burty nad komórką). Osmalenie i lej → albedo, żar (skala ciała czarnego) i poświata jonowa →
// emisja; wzory i szum poszarpanego brzegu jak hullWoundSurface (hullDamageMap.tsl.js), bez przestrzelin
// małego kalibru (dziury robi maska węzłów). Model świeci głównie odbiciem mapy otoczenia (PBR — odbicie
// dielektryka nie zależy od koloru), więc osmalenie i lej gaszą też światło pośrednie (aoNode) i połysk
// (roughnessNode) — samo albedo prawie nie ciemniało. Per obiekt: userData.dmgSlot (base, w, h, on)
// i dmgWorld (w, h slotu w j. świata) z HullDamageMap.bind, userData.dmgUv (pitch / srcWidth, pitch /
// srcHeight, ny, 0).
// ---------------------------------------------------------------------------
const _slotOff = new THREE.Vector4(0, 1, 1, 0);
const _uvOne = new THREE.Vector4(1, 1, 0, 0);
const _worldOne = new THREE.Vector2(1, 1);

// Wejścia mapy ran wspólne dla maski i koloru: uniformy obiektu, uv skóry, szum brzegu.
function damageInputs(vLat) {
  const uSlot = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData?.dmgSlot || _slotOff);
  const uUv = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData?.dmgUv || _uvOne);
  const uWorld = uniform(new THREE.Vector2()).onObjectUpdate(({ object }) => object?.userData?.dmgWorld || _worldOne);
  const noise = fxNoise.tile2D();
  // uv skóry (hullBodies.writeSpriteUv): u = cx·pitch/W, v = (ny − cy)·pitch/H, c = aLat + ½ (komórki od latticeMin)
  const woundUv = () => vec2(vLat.x.add(0.5).mul(uUv.x), uUv.z.sub(vLat.y.add(0.5)).mul(uUv.y));
  // szum poszarpanego brzegu dema (skale w j. świata kadłuba): { jag, nz, n2 }
  const edge = (uvW) => {
    const n1 = texture(noise, uvW.mul(uWorld.div(170.0))).r;
    const n2 = texture(noise, uvW.mul(uWorld.div(55.0))).b.toVar();
    const n3 = texture(noise, uvW.mul(uWorld.div(22.0))).g;
    const jag = n1.mul(0.65).add(n2.mul(0.35)).sub(0.5).toVar();
    const nz = jag.mul(0.62).add(n3.sub(0.5).mul(0.18)).toVar();
    return { jag, nz, n2 };
  };
  return { uSlot, uUv, uWorld, noise, woundUv, edge, edgeNoise: () => edge(woundUv()).nz };
}

// ---------------------------------------------------------------------------
// Ścianki przekroju w dziurach (kamery 3D — z góry stoją bokiem): pionowe prostokąty na krawędziach
// żywa ↔ zniszczona komórka kratownicy, od dna do pokładu modelu (geometria: shipModels3DGame.syncCutWalls).
// Ciemna blacha z liniami pokładów i wręgami, osmalenie i żar z tej samej mapy ran co skóra (uv skóry z aLat).
// ---------------------------------------------------------------------------
export function makeHullCutMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = 'przekrój kadłuba 3D';
  const aLat = attribute('aLat', 'vec3');
  const dmg = damageInputs(aLat);
  const pool = hullDamagePool().ro;
  const wound = () => {
    const uvW = dmg.woundUv().toVar();
    const D = sampleHullDamage(pool, dmg.uSlot, uvW);
    const scorch = clamp(D.scorch.add(dmg.edge(uvW).jag.mul(0.35)), 0.0, 1.0).mul(dmg.uSlot.w).toVar();
    return { D, scorch };
  };
  // pokłady co 24 j. (jasna krawędź stropu) i wręgi co 2 komórki (aLat.x / y), płyty z haszu komórki
  const z = positionLocal.z;
  const deck = smoothstep(0.86, 0.97, fract(z.div(24.0)));
  const rib = smoothstep(0.9, 0.98, fract(aLat.x.add(aLat.y).mul(0.5)));
  const plate = hash(floor(aLat.x.add(aLat.y.mul(7.0))).add(floor(z.div(24.0)).mul(13.0))).mul(0.35).add(0.8);
  const base = vec3(0.075, 0.08, 0.09).mul(plate).add(vec3(0.16, 0.16, 0.17).mul(max(deck, rib.mul(0.6))));
  mat.colorNode = Fn(() => {
    const W = wound();
    return base.mul(mix(vec3(1.0), vec3(0.25, 0.2, 0.17), W.scorch));
  })();
  mat.emissiveNode = Fn(() => {
    const W = wound();
    const t = W.D.heat.mul(W.scorch.mul(0.8).add(0.6)).toVar();
    const heatCol = vec3(1.0, 0.18, 0.02).mul(smoothstep(0.02, 0.5, t).mul(1.3))
      .add(vec3(1.0, 0.5, 0.1).mul(smoothstep(0.35, 1.4, t).mul(2.4)))
      .add(vec3(1.0, 0.92, 0.78).mul(smoothstep(1.2, 3.2, t).mul(5.0)));
    return heatCol.mul(dmg.uSlot.w);
  })();
  mat.roughnessNode = float(0.82);
  mat.metalnessNode = float(0.55);
  return mat;
}

function applyHullSkinDamage(mat, vLat, dmg) {
  const { uSlot, woundUv, edge } = dmg;
  const pool = hullDamagePool().ro;
  const wound = () => {
    const uvW = woundUv().toVar();
    const D = sampleHullDamage(pool, uSlot, uvW);
    // poszarpany brzeg: szum dema w j. świata kadłuba (jak skóra sprite'a)
    const { jag, nz, n2 } = edge(uvW);
    const holeF = D.rim.add(nz).toVar();
    const lej = smoothstep(0.52, 0.6, holeF).toVar();
    const hole = lej.mul(D.crater).toVar();
    const rim = smoothstep(0.18, 0.5, holeF).mul(float(1.0).sub(lej)).toVar();
    const scorch = clamp(D.scorch.add(jag.mul(0.35)), 0.0, 1.0).mul(uSlot.w).toVar();
    // Rozdarcie brzegu (jak hullTearFray skóry sprite'a): ciemny pas ~⅓ komórki przy brzegu dziury,
    // niezależnie od mapy ran (dziury po zderzeniach i rozpadzie też).
    const es = dmg.edgeState();
    const tear = select(es.any.and(dmg.uOn.greaterThan(0.5)), smoothstep(0.75, 0.0, es.edge), float(0.0)).toVar();
    return { D, lej, hole: hole.mul(uSlot.w), rim, scorch, n2, tear };
  };
  const baseColor = mat.colorNode;
  const baseEmissive = mat.emissiveNode;
  const baseRough = mat.roughnessNode;
  mat.colorNode = Fn(() => {
    const W = wound();
    const burnt = mix(vec3(1.0), vec3(0.10, 0.085, 0.075), max(W.scorch, W.tear.mul(0.9)))
      .mul(float(1.0).sub(W.hole.mul(0.92)));
    return baseColor.mul(burnt);
  })();
  // światło pośrednie (mapa otoczenia) — osmalona blacha i lej go nie odbijają
  mat.aoNode = Fn(() => {
    const W = wound();
    return float(1.0).sub(max(W.scorch, W.tear).mul(0.85)).mul(float(1.0).sub(W.hole.mul(0.95)));
  })();
  if (baseRough) {
    mat.roughnessNode = Fn(() => {
      const W = wound();
      return mix(baseRough, float(1.0), W.scorch.mul(0.8));
    })();
  }
  mat.emissiveNode = Fn(() => {
    const W = wound();
    const t = W.D.heat.mul(W.rim.mul(2.2).add(W.scorch.mul(0.6)).add(0.25)).mul(float(1.0).sub(W.lej)).toVar();
    const heatCol = vec3(1.0, 0.18, 0.02).mul(smoothstep(0.02, 0.5, t).mul(1.3))
      .add(vec3(1.0, 0.5, 0.1).mul(smoothstep(0.35, 1.4, t).mul(2.4)))
      .add(vec3(1.0, 0.92, 0.78).mul(smoothstep(1.2, 3.2, t).mul(7.0)));
    const flick = sin(time.mul(9.0).add(W.n2.mul(31.0))).mul(0.12).add(0.88);
    const ion = vec3(0.35, 1.25, 2.9).mul(W.D.ion.mul(0.9));
    const glow = heatCol.mul(flick).add(ion).mul(uSlot.w);
    return baseEmissive ? baseEmissive.add(glow) : glow;
  })();
}

const _zero3 = new THREE.Vector3();
const _one3 = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------------------
// Slot ciała: przydział, zapis pola z węzłów, zwolnienie
// ---------------------------------------------------------------------------

/**
 * Stan skóry kadłuba (hull z HullBodies — statek albo wrak): slot pola i kopia ostatnio zapisanych
 * wartości. `occ` — komórki pierwotnej konstrukcji (hullSkinLattice). Zwraca skin3D (obiekt dla
 * userData siatki) albo null (brak miejsca w polu).
 */
export function ensureHullSkinSlot(hull, occ) {
  ensureField();
  const body = hull.body;
  let st = hull.__skin3D;
  if (st && st.body === body) return st;
  if (st) releaseHullSkinSlot(hull);
  // Pudło komórek: statek — cała pierwotna konstrukcja (`occ`; zniszczone węzły odrastają — HullBodies.regrowCell /
  // restoreHull — w każdej jej komórce, także poza pudłem żywych węzłów z chwili przydziału), wrak — tylko jego
  // kawałek pierwotnej kratownicy (żywe węzły ciała).
  const s = body.nodeStore;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  if (!hull.isFragment && occ && occ.length === body.dims.x * body.dims.y) {
    const W = body.dims.x;
    for (let c = 0; c < occ.length; c++) {
      if (!occ[c]) continue;
      const ix = c % W, iy = (c - ix) / W;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix;
      if (iy < y0) y0 = iy; if (iy > y1) y1 = iy;
    }
    if (x1 >= x0) { z0 = 0; z1 = 0; }
  }
  if (!(x1 >= x0)) {
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const ix = s.ix[i], iy = s.iy[i], iz = s.iz[i];
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix;
      if (iy < y0) y0 = iy; if (iy > y1) y1 = iy;
      if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
  }
  if (!(x1 >= x0)) return null;
  // margines 1 komórki (rogi FFD przy brzegu kawałka)
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); z0 = Math.max(0, z0 - 1);
  x1 = Math.min(body.dims.x - 1, x1 + 1); y1 = Math.min(body.dims.y - 1, y1 + 1); z1 = Math.min(body.dims.z - 1, z1 + 1);
  const cdx = x1 - x0 + 1, cdy = y1 - y0 + 1, cdz = z1 - z0 + 1;
  const n = cdx * cdy * cdz;
  const offset = allocCells(n);
  if (offset < 0) return null;
  st = {
    body, offset, count: n,
    cmin: new THREE.Vector3(x0, y0, z0),
    cdim: new THREE.Vector3(cdx, cdy, cdz),
    off: new THREE.Vector3(),
    cs: body.cellSize,
    on: true,
    last: new Float32Array(n * 4).fill(-1e9),
    revision: -1,
    wroteFrame: -1
  };
  // Stan początkowy: komórki pierwotnej konstrukcji = GONE (inny kawałek), reszta = NEVER.
  const d = body.dims, dxy = d.x * d.y;
  for (let z = 0; z < cdz; z++) for (let y = 0; y < cdy; y++) for (let x = 0; x < cdx; x++) {
    const li = x + y * cdx + z * cdx * cdy;
    const gi = (x + x0) + (y + y0) * d.x + (z + z0) * dxy;
    const o = (offset + li) * 4;
    _data[o] = 0; _data[o + 1] = 0; _data[o + 2] = 0;
    _data[o + 3] = occ && occ[gi] ? STATE_GONE : STATE_NEVER;
  }
  zbierzZakresy(_attr, offset * 4, n * 4);
  hull.__skin3D = st;
  return st;
}

export function releaseHullSkinSlot(hull) {
  const st = hull?.__skin3D;
  if (!st) return;
  freeCells(st.offset, st.count);
  hull.__skin3D = null;
}

/**
 * Zapis pola z węzłów ciała (przesunięcie względem spoczynku w komórkach kratownicy, stan). Tylko komórki
 * zmienione od ostatniego zapisu; zakres do wysyłki. uOff = latticeMin + anchorD (środek sprite'a w
 * układzie ciała). Zwraca liczbę zapisanych komórek.
 */
export function writeHullSkinField(hull) {
  const st = hull.__skin3D;
  if (!st) return 0;
  const body = hull.body, s = body.nodeStore, lm = body.latticeMin, cs = body.cellSize;
  st.off.set(lm.x + hull.anchorDX, lm.y + hull.anchorDY, 0);
  // Śpiące ciało bez zmian węzłów — pole aktualne.
  if (body.isSleeping && st.revision === hull.revision && st.wroteSleep) return 0;
  st.revision = hull.revision;
  st.wroteSleep = !!body.isSleeping;
  const x0 = st.cmin.x, y0 = st.cmin.y, z0 = st.cmin.z;
  const cdx = st.cdim.x, cdy = st.cdim.y, cdz = st.cdim.z;
  const last = st.last;
  let lo = Infinity, hi = -1, wrote = 0;
  for (let i = 0; i < s.count; i++) {
    const lx = s.ix[i] - x0, ly = s.iy[i] - y0, lz = s.iz[i] - z0;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= cdx || ly >= cdy || lz >= cdz) continue;
    const li = lx + ly * cdx + lz * cdx * cdy;
    const o4 = li * 4;
    let dx = 0, dy = 0, dz = 0, state = STATE_GONE;
    if (s.active[i]) {
      dx = s.x[i] - (lm.x + (s.ix[i] + 0.5) * cs);
      dy = s.y[i] - (lm.y + (s.iy[i] + 0.5) * cs);
      dz = s.z[i] - (lm.z + (s.iz[i] + 0.5) * cs);
      state = STATE_ALIVE;
    }
    if (Math.abs(last[o4] - dx) < 0.02 && Math.abs(last[o4 + 1] - dy) < 0.02 && Math.abs(last[o4 + 2] - dz) < 0.02 && last[o4 + 3] === state) continue;
    last[o4] = dx; last[o4 + 1] = dy; last[o4 + 2] = dz; last[o4 + 3] = state;
    const o = (st.offset + li) * 4;
    _data[o] = dx; _data[o + 1] = dy; _data[o + 2] = dz; _data[o + 3] = state;
    if (li < lo) lo = li;
    if (li > hi) hi = li;
    wrote++;
  }
  if (wrote > 0) zbierzZakresy(_attr, (st.offset + lo) * 4, (hi - lo + 1) * 4);
  return wrote;
}
