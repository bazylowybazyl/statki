// Skóra CIAŁA ŚWIATA z brył budowli Z7 (PortBuilding3D — suchy dok piratów; docs/PLAN-zniszczenia-swiata-3d.md § 6):
// instancje grupy kawałka (zestawy bg / fg — dach w fg, wszystkie rodzaje brył, także lampy) wypieczone do układu CIAŁA —
// środek rastra ciała = 0, x — oś budowli, y — −z układu (obraz ciała w górę), z — wysokość świata — z atrybutami
// wariantu „skin” grafu budowli (portBuildings3D.tsl.js): aPbA (położenie w bryle — płyty, materiał), aPbN (normalna
// bryły — oś płyt), aPbFx (efekt), aLat / aOwn (kratownica ciała: położenie w komórkach i najbliższa komórka
// pierwotnej konstrukcji). Trójkąty dzielone wzdłuż najdłuższej krawędzi W RZUCIE (x, y), aż ≤ maxEdge komórek —
// FFD ugina bryłę po węzłach w płaszczyźnie, wysokość podziału nie potrzebuje (ściana 300 j. wysoka, 700 j. długa
// to ~50 trójkątów, nie 1000). Wierzchołek poza kratownicą (bryły pod i nad płaszczyzną gry wystające poza raster
// ciała — szpony, rękawy) jedzie za NAJBLIŻSZĄ komórką konstrukcji (mapa odległości po siatce), nie znika.
import * as THREE from 'three/webgpu';
import { PB_STRIDE } from './portBuildingScene.js';

const KINDS = Object.freeze(['box', 'cyl', 'torus', 'cone']);
let _bases = null;

// Te same bryły bazowe co instancje budowli (portBuildings3D.baseGeometries), bez indeksu.
function bases() {
  if (_bases) return _bases;
  const ni = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    return n;
  };
  _bases = {
    box: ni(new THREE.BoxGeometry(1, 1, 1)),
    cyl: ni(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false)),
    torus: ni(new THREE.TorusGeometry(1, 0.13, 6, 24)),
    cone: ni(new THREE.ConeGeometry(1, 1, 8, 1))
  };
  return _bases;
}

function qrot(qx, qy, qz, qw, vx, vy, vz, out) {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * Mapa „najbliższa zajęta komórka” kratownicy (BFS 8-sąsiedni od komórek konstrukcji): Int32Array nx·ny z indeksem
 * komórki zajętej (x + y·nx). Wierzchołek poza zasięgiem okna kotwicy hullSkin3D (2 komórki) dostaje komórkę
 * z tej mapy.
 */
function nearestOccupied(lattice) {
  const nx = lattice.dims.x, ny = lattice.dims.y, occ = lattice.occ;
  const near = new Int32Array(nx * ny).fill(-1);
  const q = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  for (let i = 0; i < nx * ny; i++) if (occ[i]) { near[i] = i; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    const x = i % nx, y = (i / nx) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = X + Y * nx;
        if (near[j] >= 0) continue;
        near[j] = near[i];
        q[tail++] = j;
      }
    }
  }
  return near;
}

/**
 * Geometrie skóry kawałka: { bg, fg } (BufferGeometry albo null — zestaw bez brył grupy).
 * building — PortBuilding3D (scene.sets), group — numer grupy kawałka, cx / cz — środek rastra ciała w układzie
 * budowli, lattice — hullSkinLattice(konstrukcja, anchorDX, anchorDY) (cs, dims, occ, ax, ay).
 */
export function bakeBuildingChunkSkin(building, group, opts) {
  const it = bakeBuildingChunkSkinSteps(building, group, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * To samo co bakeBuildingChunkSkin, w KROKACH (generator: yield co porcję pracy, wynik w `value` po `done`) —
 * wypiek w tle (worldBodies3D.js, requestIdleCallback) bez długich przestojów klatki: odcinek trzonu to kilkadziesiąt
 * tysięcy wierzchołków.
 */
export function* bakeBuildingChunkSkinSteps(building, group, { cx, cz, lattice, maxEdgeCells = 2 }) {
  const out = { bg: null, fg: null, triangles: 0 };
  const sets = building?.scene?.sets;
  if (!sets || !lattice) return out;
  const B = bases();
  const cs = lattice.cs, nx = lattice.dims.x, ny = lattice.dims.y, occ = lattice.occ;
  const ox = lattice.ax, oy = lattice.ay;     // środek rastra względem latticeMin
  const near = nearestOccupied(lattice);
  const maxEdge2 = (maxEdgeCells * cs) ** 2;
  const lp = [0, 0, 0], r = [0, 0, 0], nl = [0, 0, 0];
  // dach (zestaw roof — w budowli zanika jak K-7; w grze dach suchego doku zostaje) jedzie skórą FG
  for (const set of ['bg', 'fg']) {
    const verts = [];      // [x, y, z (model), nx, ny, nz (model), lx, ly, lz, mat, bnx, bny, bnz, fx0..3] na wierzchołek
    for (const src of set === 'fg' ? ['fg', 'roof'] : ['bg']) {
      const S = sets[src];
      if (!S) continue;
      for (const kind of KINDS) {
        const a = S[kind];
        if (!a || !a.length) continue;
        const g = B[kind];
        const P = g.attributes.position, N = g.attributes.normal;
        let seen = 0;
        for (let i = 0; i < a.length; i += PB_STRIDE) {
          if (a[i + 12] !== group) continue;
          if ((++seen & 63) === 0) yield;
          const c0 = a[i], c1 = a[i + 1], c2 = a[i + 2], vs = a[i + 3];
          const sx = a[i + 4], sy = a[i + 5], sz = a[i + 6], mat = a[i + 7];
          const qx = a[i + 8], qy = a[i + 9], qz = a[i + 10], qw = a[i + 11];
          const f0 = a[i + 16], f1 = a[i + 17], f2 = a[i + 18], f3 = a[i + 19];
          for (let v = 0; v < P.count; v++) {
            const px = P.getX(v), py = P.getY(v), pz = P.getZ(v);
            const bnx = N.getX(v), bny = N.getY(v), bnz = N.getZ(v);
            lp[0] = px * sx; lp[1] = py * sy; lp[2] = pz * sz;
            qrot(qx, qy, qz, qw, lp[0], lp[1], lp[2], r);
            const hx = c0 + r[0], hy = c1 + r[1] * vs, hz = c2 + r[2];
            let nnx = bnx / Math.max(1e-3, sx), nny = bny / Math.max(1e-3, sy), nnz = bnz / Math.max(1e-3, sz);
            let nlen = Math.hypot(nnx, nny, nnz) || 1;
            qrot(qx, qy, qz, qw, nnx / nlen, nny / nlen, nnz / nlen, nl);
            nnx = nl[0]; nny = nl[1] / Math.max(1e-3, vs); nnz = nl[2];
            nlen = Math.hypot(nnx, nny, nnz) || 1;
            // układ budowli (x, wysokość, z) → model ciała (x − cx, cz − z, wysokość)
            verts.push(hx - cx, cz - hz, hy, nnx / nlen, -nnz / nlen, nny / nlen, lp[0], lp[1], lp[2], mat, bnx, bny, bnz, f0, f1, f2, f3);
          }
        }
      }
    }
    if (!verts.length) continue;
    // podział w rzucie: trójkąty wzdłuż najdłuższej krawędzi (x, y), aż ≤ maxEdge
    const K = 17;
    const tris = [];
    const mid = (A, Bv) => {
      const m = new Array(K);
      for (let k = 0; k < K; k++) m[k] = (A[k] + Bv[k]) * 0.5;
      const l = Math.hypot(m[3], m[4], m[5]) || 1;
      m[3] /= l; m[4] /= l; m[5] /= l;
      m[9] = A[9];
      m[13] = A[13]; m[14] = A[14]; m[15] = A[15]; m[16] = A[16];
      return m;
    };
    const e2 = (A, Bv) => (A[0] - Bv[0]) ** 2 + (A[1] - Bv[1]) ** 2;
    const split = (A, Bv, C, depth) => {
      const ab = e2(A, Bv), bc = e2(Bv, C), ca = e2(C, A);
      const m = Math.max(ab, bc, ca);
      if (depth >= 14 || m <= maxEdge2) { tris.push(A, Bv, C); return; }
      if (m === ab) { const M = mid(A, Bv); split(A, M, C, depth + 1); split(M, Bv, C, depth + 1); }
      else if (m === bc) { const M = mid(Bv, C); split(A, Bv, M, depth + 1); split(A, M, C, depth + 1); }
      else { const M = mid(C, A); split(A, Bv, M, depth + 1); split(M, Bv, C, depth + 1); }
    };
    const nV = verts.length / K;
    const vert = (j) => verts.slice(j * K, j * K + K);
    for (let j = 0; j + 2 < nV; j += 3) {
      split(vert(j), vert(j + 1), vert(j + 2), 0);
      if ((j & 1023) === 0) yield;
    }
    yield;
    const n = tris.length;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const STR = 18;
    const inter = new Float32Array(n * STR);   // aPbA(4) aPbN(4) aPbFx(4) aLat(3) aOwn(3)
    for (let j = 0; j < n; j++) {
      if ((j & 8191) === 8191) yield;
      const v = tris[j];
      pos[j * 3] = v[0]; pos[j * 3 + 1] = v[1]; pos[j * 3 + 2] = v[2];
      nor[j * 3] = v[3]; nor[j * 3 + 1] = v[4]; nor[j * 3 + 2] = v[5];
      const o = j * STR;
      inter[o] = v[6]; inter[o + 1] = v[7]; inter[o + 2] = v[8]; inter[o + 3] = v[9];
      inter[o + 4] = v[10]; inter[o + 5] = v[11]; inter[o + 6] = v[12]; inter[o + 7] = 0;
      inter[o + 8] = v[13]; inter[o + 9] = v[14]; inter[o + 10] = v[15]; inter[o + 11] = v[16];
      // kratownica: komórki od latticeMin (środek komórki i = (i + ½)·cs)
      const fx = (v[0] + ox) / cs - 0.5, fy = (v[1] + oy) / cs - 0.5;
      inter[o + 12] = fx; inter[o + 13] = fy; inter[o + 14] = 0;
      // kotwica widoczności: najbliższa zajęta komórka w oknie 3×3 / 5×5, dalej — mapa najbliższej komórki
      const rx = Math.round(fx), ry = Math.round(fy);
      let bx = -1, by = -1, best = Infinity;
      for (let R = 1; R <= 2 && bx < 0; R++) {
        for (let y = ry - R; y <= ry + R; y++) {
          if (y < 0 || y >= ny) continue;
          for (let x = rx - R; x <= rx + R; x++) {
            if (x < 0 || x >= nx || !occ[x + y * nx]) continue;
            const dd = (x - fx) ** 2 + (y - fy) ** 2;
            if (dd < best) { best = dd; bx = x; by = y; }
          }
        }
      }
      if (bx < 0) {
        const cxl = Math.max(0, Math.min(nx - 1, rx)), cyl = Math.max(0, Math.min(ny - 1, ry));
        const k = near[cxl + cyl * nx];
        if (k >= 0) { bx = k % nx; by = (k / nx) | 0; } else { bx = cxl; by = cyl; }
      }
      inter[o + 15] = bx; inter[o + 16] = by; inter[o + 17] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const ib = new THREE.InterleavedBuffer(inter, STR);
    geo.setAttribute('aPbA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('aPbN', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    geo.setAttribute('aPbFx', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    geo.setAttribute('aLat', new THREE.InterleavedBufferAttribute(ib, 3, 12));
    geo.setAttribute('aOwn', new THREE.InterleavedBufferAttribute(ib, 3, 15));
    geo.computeBoundingSphere();
    out[set] = geo;
    out.triangles += n / 3;
  }
  return out;
}

const _warmGeo = [null, null];
/**
 * Geometria rozgrzewki: jeden trójkąt z układem atrybutów skóry (klucz pipeline'u). indexed — wariant z indeksem
 * (odłamy rysują podzbiór trójkątów kawałka — worldBodies3D.js; three r183 ma `index` w kluczu geometrii).
 */
export function buildingSkinWarmGeometry(indexed = false) {
  const k = indexed ? 1 : 0;
  if (_warmGeo[k]) return _warmGeo[k];
  const g = new THREE.BufferGeometry();
  if (indexed) g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const ib = new THREE.InterleavedBuffer(new Float32Array(3 * 18), 18);
  g.setAttribute('aPbA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  g.setAttribute('aPbN', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  g.setAttribute('aPbFx', new THREE.InterleavedBufferAttribute(ib, 4, 8));
  g.setAttribute('aLat', new THREE.InterleavedBufferAttribute(ib, 3, 12));
  g.setAttribute('aOwn', new THREE.InterleavedBufferAttribute(ib, 3, 15));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  _warmGeo[k] = g;
  return g;
}
