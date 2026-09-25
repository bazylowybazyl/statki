// src/3d/reactor3DShapes.js
//
// MODELE REAKTORA — geometria proceduralna (bez sceny i bez DOM; testy node).
//
// Układ modelu: jednostka = promień komory rdzenia, (x, y) = osie siatki heksów
// kadłuba, z ≤ 0 w głąb kadłuba (0 = dach modelu, −1 = podłoga przedziału).
// Kamera gry patrzy z góry (ortho), więc liczą się dachy, skosy i to, co
// przykrywa co — ściany pionowe są kreską, a ich spody nigdy nie są widoczne,
// więc ich nie ma. Plazma krąży w torusie pod cewkami: między cewkami ją widać.
//
// Rodzaje (REACTOR3D_KINDS):
//   terran — tokamak Terra Nova (Bellator): równy pierścień plazmy w 16 cewkach,
//            szyny cewek, solenoid w środku, grodź z zaciskami i sprzęgłami mocy;
//   pirate — prowizorka piratów (Iron Skull): eliptyczny pierścień w 11 cewkach
//            o nierównych odstępach (jednej brak — plazma tam wystaje), łaty na
//            grodzi z przerwą, kable w poprzek, dwa zbiorniki, kanciasty rdzeń;
//   atlas  — Atlas gracza: dwa przeciwbieżne pierścienie (20 + 12 cewek), kula
//            rdzenia w kołnierzu, listwy świetlne na grodzi.
//
// Konstrukcja (BufferGeometry bez indeksów): position, normal, aMat (materiał,
// REACTOR3D_MAT), aCoil (indeks cewki albo −1), aAng (kąt środka elementu —
// łuk rozerwany wyrzutem znika po kącie). Plazma (z indeksami): position,
// normal, aCenter (środek rury), aTube (promień rury), aRing (pierścień; 2 =
// kula Atlasa), aUV (u wzdłuż pierścienia, v dookoła rury).
import * as THREE from 'three';

export const REACTOR3D_KINDS = Object.freeze(['terran', 'pirate', 'atlas']);

// Materiały konstrukcji (indeks = aMat).
export const REACTOR3D_MAT = Object.freeze({
  floor: 0, frame: 1, coil: 2, core: 3, strut: 4, conduit: 5, detail: 6, accent: 7
});

const TAU = Math.PI * 2;

// Deterministyczny szum dla elementów „prowizorki” (bez Math.random: model
// ma być ten sam przy każdym wczytaniu).
function hash01(i, salt = 0) {
  const x = Math.sin((i + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

class ShapeBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.m = [];
    this.c = [];
    this.a = [];
  }

  vert(x, y, z, nx, ny, nz, mat, coil, ang) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.m.push(mat);
    this.c.push(coil);
    this.a.push(ang);
  }

  // Czworokąt ABCD (dwa trójkąty), normalna na wierzchołek.
  quad(A, B, C, D, NA, NB, NC, ND, mat, coil, ang) {
    this.vert(A[0], A[1], A[2], NA[0], NA[1], NA[2], mat, coil, ang);
    this.vert(B[0], B[1], B[2], NB[0], NB[1], NB[2], mat, coil, ang);
    this.vert(C[0], C[1], C[2], NC[0], NC[1], NC[2], mat, coil, ang);
    this.vert(A[0], A[1], A[2], NA[0], NA[1], NA[2], mat, coil, ang);
    this.vert(C[0], C[1], C[2], NC[0], NC[1], NC[2], mat, coil, ang);
    this.vert(D[0], D[1], D[2], ND[0], ND[1], ND[2], mat, coil, ang);
  }

  /**
   * Powierzchnia obrotowa profilu [[r, z], ...] (od środka/dołu w górę i na
   * zewnątrz — wtedy normalne patrzą w górę i na zewnątrz). o: a0, a1 (łuk),
   * cx, cy (środek), ex, ey (elipsa), coil, ang (stały kąt elementu).
   */
  lathe(profile, segs, mat, o = {}) {
    const a0 = o.a0 ?? 0;
    const a1 = o.a1 ?? TAU;
    const cx = o.cx ?? 0;
    const cy = o.cy ?? 0;
    const ex = o.ex ?? 1;
    const ey = o.ey ?? 1;
    const coil = o.coil ?? -1;
    const n = Math.max(3, Math.round(segs * Math.abs(a1 - a0) / TAU));
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, z0] = profile[j];
      const [r1, z1] = profile[j + 1];
      if (r0 === 0 && r1 === 0) continue;
      const dr = r1 - r0;
      const dz = z1 - z0;
      const len = Math.hypot(dr, dz) || 1;
      const nr = -dz / len;
      const nz = dr / len;
      for (let k = 0; k < n; k++) {
        const ta = a0 + (a1 - a0) * (k / n);
        const tb = a0 + (a1 - a0) * ((k + 1) / n);
        const ca = Math.cos(ta); const sa = Math.sin(ta);
        const cb = Math.cos(tb); const sb = Math.sin(tb);
        const nA = normalize3(nr * ca / ex, nr * sa / ey, nz);
        const nB = normalize3(nr * cb / ex, nr * sb / ey, nz);
        const ang = o.ang ?? (ta + tb) * 0.5;
        this.quad(
          [cx + r0 * ca * ex, cy + r0 * sa * ey, z0],
          [cx + r1 * ca * ex, cy + r1 * sa * ey, z1],
          [cx + r1 * cb * ex, cy + r1 * sb * ey, z1],
          [cx + r0 * cb * ex, cy + r0 * sb * ey, z0],
          nA, nA, nB, nB, mat, coil, ang
        );
      }
    }
  }

  /**
   * Prostopadłościan z fazą dachu: środek (cx, cy), długość wzdłuż kierunku
   * `rot`, szerokość w poprzek, dach zTop, spód zBot, faza `bevel`.
   */
  box(cx, cy, len, wid, rot, zTop, zBot, mat, coil = -1, bevel = 0, ang = null) {
    const ux = Math.cos(rot); const uy = Math.sin(rot);
    const wx = -uy; const wy = ux;
    const hl = len * 0.5; const hw = wid * 0.5;
    const b = Math.max(0, Math.min(bevel, hl * 0.45, hw * 0.45));
    const P = (su, sw, z, du = 0, dw = 0) => [
      cx + ux * (su * hl - Math.sign(su) * du) + wx * (sw * hw - Math.sign(sw) * dw),
      cy + uy * (su * hl - Math.sign(su) * du) + wy * (sw * hw - Math.sign(sw) * dw),
      z
    ];
    const a = ang ?? Math.atan2(cy, cx);
    const up = [0, 0, 1];
    const zs = zTop - b;
    // dach
    this.quad(P(-1, -1, zTop, b, b), P(1, -1, zTop, b, b), P(1, 1, zTop, b, b), P(-1, 1, zTop, b, b), up, up, up, up, mat, coil, a);
    if (b > 0) {
      const s2 = Math.SQRT1_2;
      const nU = [ux * s2, uy * s2, s2]; const nUm = [-ux * s2, -uy * s2, s2];
      const nW = [wx * s2, wy * s2, s2]; const nWm = [-wx * s2, -wy * s2, s2];
      this.quad(P(1, -1, zTop, b, b), P(1, -1, zs), P(1, 1, zs), P(1, 1, zTop, b, b), nU, nU, nU, nU, mat, coil, a);
      this.quad(P(-1, 1, zTop, b, b), P(-1, 1, zs), P(-1, -1, zs), P(-1, -1, zTop, b, b), nUm, nUm, nUm, nUm, mat, coil, a);
      this.quad(P(1, 1, zTop, b, b), P(1, 1, zs), P(-1, 1, zs), P(-1, 1, zTop, b, b), nW, nW, nW, nW, mat, coil, a);
      this.quad(P(-1, -1, zTop, b, b), P(-1, -1, zs), P(1, -1, zs), P(1, -1, zTop, b, b), nWm, nWm, nWm, nWm, mat, coil, a);
    }
    const sU = [ux, uy, 0]; const sUm = [-ux, -uy, 0];
    const sW = [wx, wy, 0]; const sWm = [-wx, -wy, 0];
    this.quad(P(1, -1, zs), P(1, -1, zBot), P(1, 1, zBot), P(1, 1, zs), sU, sU, sU, sU, mat, coil, a);
    this.quad(P(-1, 1, zs), P(-1, 1, zBot), P(-1, -1, zBot), P(-1, -1, zs), sUm, sUm, sUm, sUm, mat, coil, a);
    this.quad(P(1, 1, zs), P(1, 1, zBot), P(-1, 1, zBot), P(-1, 1, zs), sW, sW, sW, sW, mat, coil, a);
    this.quad(P(-1, -1, zs), P(-1, -1, zBot), P(1, -1, zBot), P(1, -1, zs), sWm, sWm, sWm, sWm, mat, coil, a);
  }

  // Odcinek (kabel, belka) z punktu A do B w płaszczyźnie modelu.
  beam(ax, ay, bx, by, wid, zTop, zBot, mat, bevel = 0) {
    const len = Math.hypot(bx - ax, by - ay);
    this.box((ax + bx) * 0.5, (ay + by) * 0.5, len, wid, Math.atan2(by - ay, bx - ax), zTop, zBot, mat, -1, bevel,
      Math.atan2((ay + by) * 0.5, (ax + bx) * 0.5));
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 1));
    g.setAttribute('aCoil', new THREE.Float32BufferAttribute(this.c, 1));
    g.setAttribute('aAng', new THREE.Float32BufferAttribute(this.a, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// Plazma: tory i kula w jednej geometrii z indeksami.
class PlasmaBuilder {
  constructor() {
    this.p = []; this.n = []; this.ctr = []; this.tube = []; this.ring = []; this.uv = []; this.idx = [];
  }

  vert(cx, cy, cz, nx, ny, nz, tube, ring, u, v) {
    this.p.push(cx + nx * tube, cy + ny * tube, cz + nz * tube);
    this.n.push(nx, ny, nz);
    this.ctr.push(cx, cy, cz);
    this.tube.push(tube);
    this.ring.push(ring);
    this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }

  torus(R, tube, zc, segU, segV, ring, ex = 1, ey = 1) {
    const base = this.p.length / 3;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const a = u * TAU;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const [rx, ry] = normalize3(ca / ex, sa / ey, 0);
      for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        const b = v * TAU;
        const cb = Math.cos(b); const sb = Math.sin(b);
        this.vert(R * ca * ex, R * sa * ey, zc, rx * cb, ry * cb, sb, tube, ring, u, v);
      }
    }
    const row = segV + 1;
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = base + i * row + j;
        const b = base + (i + 1) * row + j;
        this.idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  sphere(r, zc, segU, segV, ring) {
    const base = this.p.length / 3;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const lat = -Math.PI / 2 + v * Math.PI;
      for (let i = 0; i <= segU; i++) {
        const u = i / segU;
        const lon = u * TAU;
        this.vert(0, 0, zc, Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), r, ring, u, v);
      }
    }
    const row = segU + 1;
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = base + j * row + i;
        const b = a + row;
        this.idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.ctr, 3));
    g.setAttribute('aTube', new THREE.Float32BufferAttribute(this.tube, 1));
    g.setAttribute('aRing', new THREE.Float32BufferAttribute(this.ring, 1));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Profile powtarzalne: szyna cewek (r0..r1, dach z) i podłoga.
function railProfile(r0, r1, z, depth = -0.6, bevel = 0.015) {
  return [[r0, depth], [r0, z - bevel], [r0 + bevel, z], [r1 - bevel, z], [r1, z - bevel], [r1, depth]];
}
const FLOOR_PROFILE = [[0, -1.0], [0.965, -1.0], [0.995, -0.975], [0.995, -0.94]];

function buildTerran() {
  const S = new ShapeBuilder();
  const P = new PlasmaBuilder();
  const M = REACTOR3D_MAT;
  const coils = [];
  const coilRing = [];
  S.lathe(FLOOR_PROFILE, 64, M.floor);
  for (let k = 0; k < 12; k++) {
    const a = (k + 0.5) * TAU / 12;
    S.box(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.64, 0.03, a, -0.965, -1.0, M.detail, -1, 0.008);
  }
  // solenoid i akcent na czapie
  S.lathe([[0, -0.05], [0.13, -0.05], [0.165, -0.075], [0.2, -0.12], [0.2, -0.99]], 48, M.core);
  S.lathe([[0.085, -0.049], [0.115, -0.049]], 48, M.accent);
  // szyny cewek
  S.lathe(railProfile(0.33, 0.41, -0.15), 64, M.frame);
  S.lathe(railProfile(0.69, 0.77, -0.15), 72, M.frame);
  // cewki (16) z płytkami śrub
  for (let k = 0; k < 16; k++) {
    const a = k * TAU / 16;
    const c = Math.cos(a); const s = Math.sin(a);
    S.box(c * 0.55, s * 0.55, 0.4, 0.07, a, -0.07, -0.62, M.coil, k, 0.012);
    S.box(c * 0.4, s * 0.4, 0.045, 0.078, a, -0.064, -0.08, M.detail, k, 0.006);
    S.box(c * 0.7, s * 0.7, 0.045, 0.078, a, -0.064, -0.08, M.detail, k, 0.006);
    coils.push(a);
    coilRing.push(0);
  }
  // wsporniki szyna → grodź
  for (let k = 0; k < 6; k++) {
    const a = (k + 0.5) * TAU / 6;
    S.box(Math.cos(a) * 0.815, Math.sin(a) * 0.815, 0.1, 0.05, a, -0.16, -0.5, M.strut, -1, 0.01);
  }
  // grodź z zaciskami i sprzęgłami mocy
  S.lathe([[0.845, -0.5], [0.845, -0.16], [0.865, -0.12], [0.955, -0.12], [0.975, -0.15], [0.975, -0.95]], 80, M.frame);
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + TAU / 16;
    S.box(Math.cos(a) * 0.91, Math.sin(a) * 0.91, 0.07, 0.055, a, -0.1, -0.13, M.detail, -1, 0.01);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4 + TAU / 8;
    S.box(Math.cos(a) * 0.905, Math.sin(a) * 0.905, 0.1, 0.12, a, -0.095, -0.13, M.conduit, -1, 0.012);
    S.box(Math.cos(a) * 0.905, Math.sin(a) * 0.905, 0.07, 0.02, a, -0.093, -0.1, M.accent, -1, 0);
  }
  P.torus(0.55, 0.1, -0.3, 128, 14, 0);
  return {
    kind: 'terran',
    structure: S.toGeometry(),
    plasma: P.toGeometry(),
    coils, coilRing,
    rings: [{ R: 0.55, tube: 0.1, z: -0.3, ex: 1, ey: 1, dir: 1 }],
    coreLight: null,
    // farba grodzi, ciemna stal, miedź cewek, rdzeń, wsporniki, sprzęgła, detale
    palette: ['#262b31', '#8f98a1', '#9a6a3e', '#4d535b', '#6e767e', '#353b41', '#565d65', '#000000'],
    spec: [[16, 0.08], [40, 0.35], [28, 0.5], [30, 0.3], [24, 0.25], [20, 0.2], [18, 0.15], [1, 0]],
    accent: null,
    flicker: 0
  };
}

function buildPirate() {
  const S = new ShapeBuilder();
  const P = new PlasmaBuilder();
  const M = REACTOR3D_MAT;
  const EX = 1.07;
  const EY = 0.93;
  const coils = [];
  const coilRing = [];
  S.lathe(FLOOR_PROFILE, 56, M.floor);
  for (let k = 0; k < 7; k++) {
    const a = hash01(k, 1) * TAU;
    const r0 = 0.2 + hash01(k, 2) * 0.15;
    const r1 = 0.62 + hash01(k, 3) * 0.28;
    S.box(Math.cos(a) * (r0 + r1) * 0.5, Math.sin(a) * (r0 + r1) * 0.5, r1 - r0, 0.035, a + (hash01(k, 4) - 0.5) * 0.2, -0.962, -1.0, M.detail, -1, 0.006);
  }
  // kanciasty rdzeń na śrubach, pomarańczowy pas ostrzegawczy
  S.box(0, 0, 0.3, 0.3, 0.39, -0.06, -0.99, M.core, -1, 0.03, 0);
  for (let k = 0; k < 4; k++) {
    const a = 0.39 + k * Math.PI / 2 + Math.PI / 4;
    S.box(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.05, 0.05, a, -0.055, -0.07, M.detail, -1, 0.008, 0);
  }
  S.box(0, 0, 0.22, 0.026, 0.39, -0.058, -0.065, M.accent, -1, 0, 0);
  // szyna zewnętrzna w dwóch łukach (po elipsie)
  S.lathe(railProfile(0.7, 0.775, -0.155), 72, M.frame, { a0: 0.2, a1: 3.6, ex: EX, ey: EY });
  S.lathe(railProfile(0.7, 0.775, -0.155), 72, M.frame, { a0: 3.95, a1: 6.05, ex: EX, ey: EY });
  // 11 cewek w nierównych odstępach; piątej brak, ósma podwójna
  for (let k = 0; k < 11; k++) {
    const a = k * TAU / 11 + (hash01(k, 5) - 0.5) * 0.24;
    coils.push(a);
    coilRing.push(k === 5 ? 10 : 0);
    if (k === 5) continue;
    const r = 0.54;
    const cx = Math.cos(a) * r * EX;
    const cy = Math.sin(a) * r * EY;
    const rot = Math.atan2(Math.sin(a) / EY, Math.cos(a) / EX);
    const len = 0.38 + hash01(k, 6) * 0.07;
    const wid = 0.06 + hash01(k, 7) * 0.04;
    const zTop = -0.07 - hash01(k, 8) * 0.02;
    if (k === 8) {
      for (const off of [-0.055, 0.055]) {
        const b = a + off;
        S.box(Math.cos(b) * r * EX, Math.sin(b) * r * EY, len, wid * 0.6, rot + off, zTop, -0.62, M.coil, k, 0.01);
      }
      continue;
    }
    S.box(cx, cy, len, wid, rot, zTop, -0.62, M.coil, k, 0.01);
  }
  // kable w poprzek pierścienia (nad plazmą, pod dachami cewek)
  for (let k = 0; k < 7; k++) {
    const a = hash01(k, 9) * TAU;
    const b = a + 0.25 + hash01(k, 10) * 0.5;
    S.beam(Math.cos(a) * 0.9 * EX, Math.sin(a) * 0.9 * EY, Math.cos(b) * 0.6 * EX, Math.sin(b) * 0.6 * EY,
      0.018, -0.11 - hash01(k, 11) * 0.02, -0.14, M.conduit, 0.004);
  }
  // grodź z przerwą i łatami
  S.lathe([[0.86, -0.5], [0.86, -0.15], [0.88, -0.12], [0.95, -0.12], [0.97, -0.15], [0.97, -0.95]], 72, M.frame, { a0: 0.5, a1: TAU - 0.2 });
  for (const [a, l, w, t] of [[0.9, 0.2, 0.12, 0.25], [2.2, 0.16, 0.1, -0.3], [3.1, 0.22, 0.14, 0.1], [4.4, 0.18, 0.11, -0.2], [5.6, 0.2, 0.13, 0.3]]) {
    S.box(Math.cos(a) * 0.91, Math.sin(a) * 0.91, l, w, a + Math.PI / 2 + t, -0.105, -0.13, M.detail, -1, 0.01, a);
  }
  // zbiorniki
  for (const [a, r] of [[0.8, 0.78], [3.5, 0.8]]) {
    S.lathe([[0, -0.07], [0.06, -0.075], [0.09, -0.1], [0.1, -0.14], [0.1, -0.6]], 28, M.detail, { cx: Math.cos(a) * r, cy: Math.sin(a) * r, ang: a });
  }
  P.torus(0.54, 0.115, -0.3, 128, 14, 0, EX, EY);
  return {
    kind: 'pirate',
    structure: S.toGeometry(),
    plasma: P.toGeometry(),
    coils, coilRing,
    rings: [{ R: 0.54, tube: 0.115, z: -0.3, ex: EX, ey: EY, dir: 1 }],
    coreLight: null,
    palette: ['#1b1917', '#48423c', '#6b4429', '#37322e', '#524a43', '#2b1a12', '#5a5047', '#000000'],
    spec: [[10, 0.05], [18, 0.18], [16, 0.3], [14, 0.15], [14, 0.15], [8, 0.08], [12, 0.12], [1, 0]],
    accent: '#ff7a2a',
    flicker: 0.35
  };
}

function buildAtlas() {
  const S = new ShapeBuilder();
  const P = new PlasmaBuilder();
  const M = REACTOR3D_MAT;
  const coils = [];
  const coilRing = [];
  S.lathe(FLOOR_PROFILE, 64, M.floor);
  S.lathe([[0.47, -0.985], [0.5, -0.985]], 64, M.detail);
  for (let k = 0; k < 18; k++) {
    const a = (k + 0.5) * TAU / 18;
    S.box(Math.cos(a) * 0.53, Math.sin(a) * 0.53, 0.62, 0.022, a, -0.97, -1.0, M.detail, -1, 0.006);
  }
  // szyny obu pierścieni
  S.lathe(railProfile(0.52, 0.57, -0.155, -0.6, 0.012), 72, M.frame);
  S.lathe(railProfile(0.72, 0.77, -0.155, -0.6, 0.012), 80, M.frame);
  S.lathe(railProfile(0.27, 0.31, -0.16, -0.6, 0.01), 56, M.frame);
  S.lathe(railProfile(0.45, 0.49, -0.16, -0.6, 0.01), 64, M.frame);
  // cewki: zewnętrzne 20, wewnętrzne 12
  for (let k = 0; k < 20; k++) {
    const a = k * TAU / 20;
    S.box(Math.cos(a) * 0.64, Math.sin(a) * 0.64, 0.2, 0.04, a, -0.08, -0.6, M.coil, k, 0.008);
    coils.push(a);
    coilRing.push(0);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k + 0.5) * TAU / 12;
    S.box(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.15, 0.035, a, -0.085, -0.6, M.coil, 20 + k, 0.007);
    coils.push(a);
    coilRing.push(1);
  }
  // kołnierz kuli rdzenia z akcentem
  S.lathe([[0.13, -0.3], [0.13, -0.1], [0.145, -0.085], [0.2, -0.085], [0.215, -0.1], [0.215, -0.6]], 48, M.core);
  S.lathe([[0.16, -0.084], [0.185, -0.084]], 48, M.accent);
  // wsporniki i grodź z listwami
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * TAU / 8;
    S.box(Math.cos(a) * 0.81, Math.sin(a) * 0.81, 0.07, 0.035, a, -0.14, -0.5, M.strut, -1, 0.008);
  }
  S.lathe([[0.85, -0.5], [0.85, -0.14], [0.87, -0.1], [0.95, -0.1], [0.97, -0.13], [0.97, -0.95]], 88, M.frame);
  for (let k = 0; k < 6; k++) {
    const a = k * TAU / 6 + TAU / 12;
    S.box(Math.cos(a) * 0.91, Math.sin(a) * 0.91, 0.12, 0.018, a + Math.PI / 2, -0.098, -0.1, M.accent, -1, 0);
  }
  P.torus(0.64, 0.075, -0.26, 144, 12, 0);
  P.torus(0.38, 0.06, -0.23, 112, 12, 1);
  P.sphere(0.12, -0.18, 32, 16, 2);
  return {
    kind: 'atlas',
    structure: S.toGeometry(),
    plasma: P.toGeometry(),
    coils, coilRing,
    rings: [
      { R: 0.64, tube: 0.075, z: -0.26, ex: 1, ey: 1, dir: 1 },
      { R: 0.38, tube: 0.06, z: -0.23, ex: 1, ey: 1, dir: -1 }
    ],
    coreLight: { z: -0.18, gain: 0.8 },
    palette: ['#15191f', '#4c5663', '#667991', '#2b313a', '#3a424e', '#252b34', '#333a45', '#000000'],
    spec: [[20, 0.1], [48, 0.45], [40, 0.55], [36, 0.35], [30, 0.3], [24, 0.2], [24, 0.2], [1, 0]],
    accent: '#46dcff',
    flicker: 0
  };
}

const BUILDERS = { terran: buildTerran, pirate: buildPirate, atlas: buildAtlas };

/** Model rodzaju `kind` (REACTOR3D_KINDS): { structure, plasma, coils, coilRing, rings, ... }. */
export function buildReactorModel(kind) {
  const build = BUILDERS[kind] || BUILDERS.terran;
  const model = build();
  model.coilCount = model.coils.length;
  return model;
}
