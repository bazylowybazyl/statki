// src/3d/ships3d/meshBuilder3D.js
//
// BUDOWNICZY BRYŁ 3D — geometria modeli okrętów i broni (demo `dema/atlas3d-webgpu.html`).
// Czysty JS + `ShapeUtils` (earcut) z three: działa w przeglądarce i w Node (testy).
//
// Wierzchołek niesie: pozycję, normalną, uv i numer materiału palety (`aMat`, SHIP3D_MAT) —
// jeden materiał TSL na cały model, barwy i połysk z palety (shipMaterials3D.tsl.js).
// Ściany są płaskie (twarde krawędzie) poza walcami i toczeniami (gładkie wokół osi).
//
// Każdy prymityw ustawia kolejność wierzchołków sam: z „podpowiedzi” kierunku na
// zewnątrz (hint) po przekształceniu macierzą normalnych, więc lustro (scale −1),
// obroty i dowolny stos przekształceń nie odwracają ścian.
//
// UV: materiał POKŁADU (SHIP3D_MAT.DECK) dostaje rzut z góry na sprite kadłuba
// (`deck: { width, height }` — środek sprite'a = 0, +Y w górę obrazka), reszta — rzut
// pudełkowy w jednostkach modelu (panele liczy shader).

import { ShapeUtils, Vector2 } from 'three/webgpu';

/** Numery materiałów palety (indeks w SHIP3D_PALETTE, shipMaterials3D.tsl.js). */
export const SHIP3D_MAT = Object.freeze({
  DECK: 0,      // pokład: tekstura sprite'a (osobny materiał)
  PAINT: 1,     // farba kadłuba (burty, bloki)
  PANEL: 2,     // ciemniejsze płyty, fazy
  DARK: 3,      // grafit: mechanizmy, wnęki, kratki
  STEEL: 4,     // jasna stal obudów broni
  METAL: 5,     // goły metal: lufy, szyny
  BRIGHT: 6,    // jasne krawędzie, czujniki
  GLASS: 7,     // ciemne szkło
  TRIM: 8,      // akcent malowany (cyjan Atlasa)
  E_CYAN: 9,    // świecące paski: cyjan (Tempest, Yamato, Plasma)
  E_AMBER: 10,  // bursztyn (Vulcan, Flak, Goliath, Cruise)
  E_RED: 11,    // czerwień (Helios, Pulse, lampy pozycyjne)
  E_MINT: 12,   // mięta (CIWS)
  E_MAGENTA: 13, // magenta (Valkyrie, Supernova)
  E_TURQ: 14,   // turkus (laser ciągły)
  E_WHITE: 15,  // biel (reflektory, okna)
  E_ENGINE: 16, // wnętrze dyszy (plazma)
  E_ICE: 17,    // lodowy cyjan (Mjolnir, Hexlance)
  E_WINDOW: 18, // okna mostka (ciepła biel)
  HANGAR: 19    // wnętrze hangaru (ciemne, ze światłem)
});

export const SHIP3D_MAT_COUNT = 20;

// ---------------------------------------------------------------------------
// Wektory 3D (tablice) i wielokąty 2D
// ---------------------------------------------------------------------------

export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
};

/** Pole ze znakiem (> 0 — CCW oglądane z +Z). */
export function polyArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s * 0.5;
}

export function ensureCCW(poly) {
  return polyArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function rectPoly(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Prostokąt ze ściętymi narożnikami (c — liczba albo [dół-lewo, dół-prawo, góra-prawo, góra-lewo]). */
export function octPoly(x0, y0, x1, y1, c) {
  const k = Array.isArray(c) ? c : [c, c, c, c];
  return [
    [x0 + k[0], y0], [x1 - k[1], y0], [x1, y0 + k[1]], [x1, y1 - k[2]],
    [x1 - k[2], y1], [x0 + k[3], y1], [x0, y1 - k[3]], [x0, y0 + k[0]]
  ].filter((p, i, arr) => {
    const q = arr[(i + arr.length - 1) % arr.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

/** Wielokąt foremny (n boków) o promieniu r; phase — obrót pierwszego wierzchołka. */
export function ngonPoly(cx, cy, r, n, phase = 0, ry = r) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Lustrzane odbicie połowy (y ≥ 0, od rufy do dziobu) w pełny wielokąt CCW. */
export function mirrorHalf(half) {
  const lower = half.map(([x, y]) => [x, -y]);
  const upper = half.slice().reverse();
  const out = lower.concat(upper);
  // Punkty na osi (y = 0) występują dwa razy — usuwamy duplikaty.
  const clean = [];
  for (const p of out) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p);
  }
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) clean.pop();
  return ensureCCW(clean);
}

/**
 * Wielokąt odsunięty do środka o d (ujemne — na zewnątrz); d — liczba albo funkcja
 * (a, b) → d krawędzi a→b (0 = krawędź bez fazy, np. styk dwóch brył). Wierzchołek =
 * przecięcie przesuniętych prostych sąsiednich krawędzi; działa dla wklęsłych przy
 * małym d (skos na fazę), przesunięcie ograniczone do `limit`·|d| (ostre narożniki).
 */
export function offsetPolygon(poly, d, limit = 3) {
  const P = ensureCCW(poly);
  const n = P.length;
  const dOf = typeof d === 'function' ? d : () => d;
  const L = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    let ex = b[0] - a[0]; let ey = b[1] - a[1];
    const l = Math.hypot(ex, ey);
    if (l < 1e-9) { L.push(null); continue; }
    ex /= l; ey /= l;
    const di = dOf(a, b);
    // Wnętrze CCW leży po lewej: normalna (−ey, ex).
    L.push({ px: a[0] - ey * di, py: a[1] + ex * di, ex, ey, d: di });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let j0 = (i - 1 + n) % n;
    for (let k = 0; k < n && !L[j0]; k++) j0 = (j0 - 1 + n) % n;
    let j1 = i;
    for (let k = 0; k < n && !L[j1]; k++) j1 = (j1 + 1) % n;
    const A = L[j0]; const Bl = L[j1];
    const v = P[i];
    if (!A || !Bl) { out.push([v[0], v[1]]); continue; }
    const cr = A.ex * Bl.ey - A.ey * Bl.ex;
    let q;
    if (Math.abs(cr) < 1e-6) {
      const dd = (A.d + Bl.d) * 0.5;
      q = [v[0] - Bl.ey * dd, v[1] + Bl.ex * dd];
    } else {
      const t = ((Bl.px - A.px) * Bl.ey - (Bl.py - A.py) * Bl.ex) / cr;
      q = [A.px + A.ex * t, A.py + A.ey * t];
    }
    const dm = Math.max(Math.abs(A.d), Math.abs(Bl.d));
    const dx = q[0] - v[0]; const dy = q[1] - v[1];
    const dl = Math.hypot(dx, dy);
    if (dl > limit * dm && dl > 1e-9) q = [v[0] + (dx / dl) * limit * dm, v[1] + (dy / dl) * limit * dm];
    out.push(q);
  }
  return out;
}

/** Punkt w wielokącie (parzystość przecięć). */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Macierze 4×4 (kolumnami, jak three)
// ---------------------------------------------------------------------------

const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function normalMat(m) {
  // Odwrotność transponowanej części 3×3 (kolumnami: a b c | d e f | g h i).
  const a = m[0]; const b = m[1]; const c = m[2];
  const d = m[4]; const e = m[5]; const f = m[6];
  const g = m[8]; const h = m[9]; const i = m[10];
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const D = -(b * i - c * h); const E = a * i - c * g; const F = -(a * h - b * g);
  const G = b * f - c * e; const H = -(a * f - c * d); const K = a * e - b * d;
  const det = a * A + d * D + g * G || 1;
  // inverse = adj^T / det; normal = (inverse)^T = adj / det (kofaktory).
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, K / det];
}

// ---------------------------------------------------------------------------
// Budowniczy
// ---------------------------------------------------------------------------

export class MeshBuilder3D {
  /**
   * @param {object} [o]
   * @param {{width:number,height:number}} [o.deck] rzut uv materiału DECK (jednostki modelu)
   * @param {number} [o.uvScale] skala uv rzutu pudełkowego (domyślnie 1)
   */
  constructor(o = {}) {
    this.pos = [];
    this.nrm = [];
    this.uvs = [];
    this.mat = [];
    this.idx = [];
    this.deck = o.deck || null;
    this.uvScale = o.uvScale ?? 1;
    this._m = I4();
    this._n = normalMat(this._m);
    this._stack = [];
  }

  vcount() { return this.pos.length / 3; }

  // --- stos przekształceń -------------------------------------------------

  push() { this._stack.push(this._m); return this; }
  pop() { this._m = this._stack.pop() || I4(); this._n = normalMat(this._m); return this; }
  _apply(t) { this._m = mul4(this._m, t); this._n = normalMat(this._m); return this; }
  translate(x, y, z) { return this._apply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
  scale(x, y = x, z = x) { return this._apply([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); }
  rotateX(a) { const c = Math.cos(a); const s = Math.sin(a); return this._apply([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
  rotateY(a) { const c = Math.cos(a); const s = Math.sin(a); return this._apply([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
  rotateZ(a) { const c = Math.cos(a); const s = Math.sin(a); return this._apply([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }

  /** fn() w bieżącym układzie i drugi raz odbite względem płaszczyzny y = 0. */
  mirrorY(fn) {
    fn(false);
    this.push().scale(1, -1, 1);
    fn(true);
    this.pop();
    return this;
  }

  /** fn() z tymczasowym przekształceniem (push → setup(this) → fn → pop). */
  with(setup, fn) {
    this.push();
    setup(this);
    fn();
    this.pop();
    return this;
  }

  tp(p) {
    const m = this._m;
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }

  tn(n) {
    const k = this._n;
    return v3.norm([
      k[0] * n[0] + k[3] * n[1] + k[6] * n[2],
      k[1] * n[0] + k[4] * n[1] + k[7] * n[2],
      k[2] * n[0] + k[5] * n[1] + k[8] * n[2]
    ]);
  }

  // --- wierzchołki (już w układzie końcowym) -------------------------------

  _v(p, n, mat) {
    const i = this.vcount();
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.mat.push(mat);
    if (mat === SHIP3D_MAT.DECK && this.deck) {
      this.uvs.push(p[0] / this.deck.width + 0.5, p[1] / this.deck.height + 0.5);
    } else {
      const ax = Math.abs(n[0]); const ay = Math.abs(n[1]); const az = Math.abs(n[2]);
      const s = this.uvScale;
      if (az >= ax && az >= ay) this.uvs.push(p[0] * s, p[1] * s);
      else if (ax >= ay) this.uvs.push(p[1] * s, p[2] * s);
      else this.uvs.push(p[0] * s, p[2] * s);
    }
    return i;
  }

  /** Płaski wielokąt wypukły (punkty lokalne), hint — kierunek na zewnątrz (lokalnie). */
  face(pts, mat, hint = null) {
    const W = pts.map((p) => this.tp(p));
    const n = W.length;
    if (n < 3) return false;
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0; i < n; i++) {
      const a = W[i];
      const b = W[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return false;
    let N = [nx / len, ny / len, nz / len];
    let list = W;
    if (hint) {
      const h = this.tn(hint);
      if (v3.dot(N, h) < 0) { list = W.slice().reverse(); N = v3.mul(N, -1); }
    }
    const base = this.vcount();
    for (const p of list) this._v(p, N, mat);
    for (let i = 1; i < n - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return true;
  }

  /** Dowolny prosty wielokąt 2D (także wklęsły) na wysokości z; up — normalna +Z. zOf(x, y) — płaszczyzna pochyła. */
  poly(poly2, z, mat, up = true, zOf = null) {
    const contour = poly2.map(([x, y]) => new Vector2(x, y));
    const tris = ShapeUtils.triangulateShape(contour, []);
    const P = poly2.map(([x, y]) => this.tp([x, y, zOf ? zOf(x, y) : z]));
    const hint = this.tn([0, 0, up ? 1 : -1]);
    // Normalna całego płata (Newell) — przy pochyłej płaszczyźnie wspólna dla trójkątów.
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    let N = v3.norm([nx, ny, nz]);
    if (v3.dot(N, hint) < 0) N = v3.mul(N, -1);
    const base = this.vcount();
    for (const p of P) this._v(p, N, mat);
    for (const t of tris) {
      const a = P[t[0]]; const b = P[t[1]]; const c = P[t[2]];
      const tn = v3.cross(v3.sub(b, a), v3.sub(c, a));
      if (v3.dot(tn, N) < 0) this.idx.push(base + t[0], base + t[2], base + t[1]);
      else this.idx.push(base + t[0], base + t[1], base + t[2]);
    }
    return this;
  }

  /** Czworokąt / trójkąt z normalnymi wierzchołków (lokalne); kolejność z normalnej średniej. */
  quadSmooth(p, nrm, mat) {
    const W = p.map((q) => this.tp(q));
    const N = nrm.map((q) => this.tn(q));
    const fn = v3.cross(v3.sub(W[1], W[0]), v3.sub(W[2], W[0]));
    const avg = v3.add(v3.add(N[0], N[1]), v3.add(N[2], N[3]));
    const base = this.vcount();
    for (let i = 0; i < 4; i++) this._v(W[i], N[i], mat);
    if (v3.dot(fn, avg) < 0) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  triSmooth(p, nrm, mat) {
    const W = p.map((q) => this.tp(q));
    const N = nrm.map((q) => this.tn(q));
    const fn = v3.cross(v3.sub(W[1], W[0]), v3.sub(W[2], W[0]));
    const avg = v3.add(v3.add(N[0], N[1]), N[2]);
    const base = this.vcount();
    for (let i = 0; i < 3; i++) this._v(W[i], N[i], mat);
    if (v3.dot(fn, avg) < 0) this.idx.push(base, base + 2, base + 1);
    else this.idx.push(base, base + 1, base + 2);
  }

  // --- bryły ----------------------------------------------------------------

  /**
   * Ściany między pierścieniami (lower na z0 / zOf0, upper na z1 / zOf1), ta sama liczba
   * punktów. Zwraca listę ścian { a, b, c, d, edge } w układzie lokalnym (do detali).
   */
  walls(lower, z0, upper, z1, mat, o = {}) {
    const n = lower.length;
    const faces = [];
    const zl = (p) => (o.zOf0 ? o.zOf0(p[0], p[1]) : z0);
    const zu = (p) => (o.zOf1 ? o.zOf1(p[0], p[1]) : z1);
    const ccw = polyArea(lower) >= 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [lower[i][0], lower[i][1], zl(lower[i])];
      const b = [lower[j][0], lower[j][1], zl(lower[j])];
      const c = [upper[j][0], upper[j][1], zu(upper[j])];
      const d = [upper[i][0], upper[i][1], zu(upper[i])];
      let ex = b[0] - a[0]; let ey = b[1] - a[1];
      if (Math.hypot(ex, ey) < 1e-9) { ex = c[0] - d[0]; ey = c[1] - d[1]; }
      // Na zewnątrz = prawa strona krawędzi wielokąta CCW.
      const hint = ccw ? [ey, -ex, 0] : [-ey, ex, 0];
      const m = typeof mat === 'function' ? mat(i) : mat;
      if (m == null) continue;
      if (this._degenerate(a, b, c, d)) {
        // Czworokąt zdegenerowany do trójkąta (wspólny wierzchołek).
        const pts = [a, b, c, d].filter((p, k, arr) => {
          const q = arr[(k + 3) % 4];
          return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-7;
        });
        if (pts.length >= 3) this.face(pts, m, hint);
      } else {
        this.face([a, b, c, d], m, hint);
      }
      faces.push({ a, b, c, d, edge: i });
    }
    return faces;
  }

  _degenerate(a, b, c, d) {
    const e = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-7;
    return e(a, b) || e(b, c) || e(c, d) || e(d, a);
  }

  /**
   * Graniastosłup z wielokąta (wklęsły dozwolony): ściany z0 → z1, faza górna / dolna,
   * pochylenie ścian (slope — odsunięcie góry do środka).
   * o.bevel: liczba albo [wysokość, odsunięcie]; o.bevelBottom — to samo na dole.
   * o.mat (wszystko), o.wallMat, o.bevelMat, o.capMat, o.bottomMat; o.cap (true), o.bottom (false).
   * o.zTop(x, y) — płaszczyzna górna pochyła (liniowa!), o.zBottom(x, y) — dolna.
   * o.flush(a, b) → true: krawędź styku z sąsiednią bryłą — bez fazy i bez pochylenia.
   */
  prism(poly, z0, z1, o = {}) {
    const P = ensureCCW(poly);
    const mat = o.mat ?? SHIP3D_MAT.PAINT;
    const wallMat = o.wallMat ?? mat;
    const bevelMat = o.bevelMat ?? wallMat;
    const capMat = o.capMat ?? mat;
    const bottomMat = o.bottomMat ?? wallMat;
    const bev = o.bevel ? (Array.isArray(o.bevel) ? o.bevel : [o.bevel, o.bevel]) : null;
    const bevB = o.bevelBottom ? (Array.isArray(o.bevelBottom) ? o.bevelBottom : [o.bevelBottom, o.bevelBottom]) : null;
    const slope = o.slope || 0;
    const zTop = o.zTop || null;
    const zBot = o.zBottom || null;
    const top = (dz) => (zTop ? (x, y) => zTop(x, y) - dz : null);
    const bot = (dz) => (zBot ? (x, y) => zBot(x, y) + dz : null);
    const edgeD = (d) => (o.flush ? (a, b) => (o.flush(a, b) ? 0 : d) : d);

    let ringLow = bevB ? offsetPolygon(P, edgeD(bevB[1])) : P;
    const zLow = z0;
    const zA = bevB ? z0 + bevB[0] : z0;
    const midTop = slope ? offsetPolygon(P, edgeD(slope)) : P;
    const zB = bev ? z1 - bev[0] : z1;
    const capRing = bev ? offsetPolygon(midTop, edgeD(bev[1])) : midTop;

    if (bevB) {
      this.walls(ringLow, zLow, P, zA, bevelMat, { zOf0: bot(0), zOf1: bot(bevB[0]) });
    }
    const body = this.walls(P, zA, midTop, zB, wallMat, { zOf0: bevB ? bot(bevB[0]) : bot(0), zOf1: bev ? top(bev[0]) : top(0) });
    let bevel = null;
    if (bev) bevel = this.walls(midTop, zB, capRing, z1, bevelMat, { zOf0: top(bev[0]), zOf1: top(0) });
    if (o.cap !== false) this.poly(capRing, z1, capMat, true, top(0));
    if (o.bottom) this.poly(ringLow, zLow, bottomMat, false, bot(0));
    return { poly: P, top: capRing, mid: midTop, body, bevel, z0, z1 };
  }

  /** Prostopadłościan (środek, rozmiary) z fazą krawędzi pionowych i górnych. */
  box(cx, cy, cz, sx, sy, sz, o = {}) {
    const c = o.corner ?? (o.bevel ? (Array.isArray(o.bevel) ? o.bevel[1] : o.bevel) : 0);
    const poly = c > 0 ? octPoly(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2, c) : rectPoly(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2);
    return this.prism(poly, cz - sz / 2, cz + sz / 2, { bottom: o.bottom ?? true, ...o });
  }

  /**
   * Bryła wzdłuż osi X: przekrój w płaszczyźnie (y, z) — wielokąt [[y, z], ...] —
   * przeciągnięty od x0 do x1. Fazy jak w prism (na końcach przekroju).
   */
  alongX(x0, x1, section, o = {}) {
    this.push();
    this.translate(x0, 0, 0).rotateY(Math.PI / 2);
    // Lokalnie: (lx, ly, lz) → świat (lz, ly, −lx) ⇒ lx = −z, ly = y.
    const poly = section.map(([y, z]) => [-z, y]);
    const r = this.prism(poly, 0, x1 - x0, { bottom: true, ...o });
    this.pop();
    return r;
  }

  /** Walec / stożek ścięty z punktu a do b (lokalnie), promienie ra, rb. */
  cylinder(a, b, ra, rb, o = {}) {
    const seg = o.seg || 16;
    const mat = o.mat ?? SHIP3D_MAT.METAL;
    const d = v3.norm(v3.sub(b, a));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = v3.norm(v3.cross(ref, d));
    const w = v3.cross(d, u);
    const phase = o.phase ?? (o.flat ? Math.PI / seg : 0);
    const radial = (k) => {
      const ph = phase + (k / seg) * Math.PI * 2;
      return v3.add(v3.mul(u, Math.cos(ph)), v3.mul(w, Math.sin(ph)));
    };
    const slope = (ra - rb) / Math.max(1e-6, len);
    for (let s = 0; s < seg; s++) {
      const r0 = radial(s);
      const r1 = radial(s + 1);
      const A0 = v3.add(a, v3.mul(r0, ra)); const A1 = v3.add(a, v3.mul(r1, ra));
      const B0 = v3.add(b, v3.mul(r0, rb)); const B1 = v3.add(b, v3.mul(r1, rb));
      if (o.flat) {
        // Graniastosłup (ostre krawędzie wzdłuż osi).
        const mid = v3.norm(v3.add(r0, r1));
        if (rb > 1e-6 && ra > 1e-6) this.face([A0, A1, B1, B0], mat, mid);
        else if (ra > 1e-6) this.face([A0, A1, b], mat, mid);
        else this.face([a, B1, B0], mat, mid);
      } else {
        const n0 = v3.norm(v3.add(r0, v3.mul(d, slope)));
        const n1 = v3.norm(v3.add(r1, v3.mul(d, slope)));
        if (rb > 1e-6 && ra > 1e-6) this.quadSmooth([A0, A1, B1, B0], [n0, n1, n1, n0], mat);
        else if (ra > 1e-6) this.triSmooth([A0, A1, b], [n0, n1, v3.norm(v3.add(n0, n1))], mat);
        else this.triSmooth([a, B1, B0], [v3.norm(v3.add(n0, n1)), n1, n0], mat);
      }
    }
    if (o.capB !== false && rb > 1e-6) {
      const ring = [];
      for (let s = 0; s < seg; s++) ring.push(v3.add(b, v3.mul(radial(s), rb)));
      this.face(ring, o.capMat ?? mat, d);
    }
    if (o.capA !== false && ra > 1e-6) {
      const ring = [];
      for (let s = 0; s < seg; s++) ring.push(v3.add(a, v3.mul(radial(s), ra)));
      this.face(ring, o.capMatA ?? o.capMat ?? mat, v3.mul(d, -1));
    }
    return this;
  }

  /** Walec wzdłuż X (lufy): środek osi (y, z), od x0 do x1. */
  tubeX(x0, x1, y, z, r0, r1 = r0, o = {}) {
    return this.cylinder([x0, y, z], [x1, y, z], r0, r1, o);
  }

  /**
   * Toczenie wokół lokalnej osi Z: profil [[r, z], ...] od dołu do góry. Każdy odcinek
   * profilu ma własną normalną (twarde krawędzie w profilu, gładko wokół osi).
   * o.mats — materiał per odcinek (tablica) albo o.mat.
   */
  lathe(profile, o = {}) {
    const seg = o.seg || 24;
    const phase = o.phase || 0;
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, z0] = profile[k];
      const [r1, z1] = profile[k + 1];
      const mat = o.mats ? o.mats[k] : (o.mat ?? SHIP3D_MAT.METAL);
      if (mat == null) continue;
      const dr = r1 - r0; const dz = z1 - z0;
      const L = Math.hypot(dr, dz);
      if (L < 1e-9) continue;
      // Normalna profilu (na zewnątrz dla profilu idącego w górę).
      const pr = dz / L; const pz = -dr / L;
      const flip = o.inside ? -1 : 1;
      for (let s = 0; s < seg; s++) {
        const a0 = phase + (s / seg) * Math.PI * 2;
        const a1 = phase + ((s + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0); const s0 = Math.sin(a0);
        const c1 = Math.cos(a1); const s1 = Math.sin(a1);
        const n0 = [pr * c0 * flip, pr * s0 * flip, pz * flip];
        const n1 = [pr * c1 * flip, pr * s1 * flip, pz * flip];
        const P00 = [r0 * c0, r0 * s0, z0]; const P01 = [r0 * c1, r0 * s1, z0];
        const P10 = [r1 * c0, r1 * s0, z1]; const P11 = [r1 * c1, r1 * s1, z1];
        if (r0 < 1e-6) this.triSmooth([P00, P11, P10], [n0, n1, n0], mat);
        else if (r1 < 1e-6) this.triSmooth([P00, P01, P10], [n0, n1, n0], mat);
        else this.quadSmooth([P00, P01, P11, P10], [n0, n1, n1, n0], mat);
      }
    }
    return this;
  }

  /** Kopuła (półelipsoida) na (cx, cy, z0), promień r, wysokość hz. */
  dome(cx, cy, z0, r, hz, o = {}) {
    const rings = o.rings || 5;
    const prof = [];
    for (let k = 0; k <= rings; k++) {
      const th = (k / rings) * Math.PI * 0.5;
      prof.push([r * Math.cos(th), hz * Math.sin(th)]);
    }
    // Profil kopuły jest gładki — normalne z elipsoidy zamiast z odcinków.
    const seg = o.seg || 20;
    const mat = o.mat ?? SHIP3D_MAT.BRIGHT;
    const N = (p) => v3.norm([p[0] / (r * r), p[1] / (r * r), (p[2]) / (hz * hz)]);
    this.push().translate(cx, cy, z0);
    for (let k = 0; k < rings; k++) {
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2; const a1 = ((s + 1) / seg) * Math.PI * 2;
        const [ra, za] = prof[k]; const [rb, zb] = prof[k + 1];
        const p00 = [ra * Math.cos(a0), ra * Math.sin(a0), za];
        const p01 = [ra * Math.cos(a1), ra * Math.sin(a1), za];
        const p10 = [rb * Math.cos(a0), rb * Math.sin(a0), zb];
        const p11 = [rb * Math.cos(a1), rb * Math.sin(a1), zb];
        if (rb < 1e-6) this.triSmooth([p00, p01, p10], [N(p00), N(p01), [0, 0, 1]], mat);
        else this.quadSmooth([p00, p01, p11, p10], [N(p00), N(p01), N(p11), N(p10)], mat);
      }
    }
    this.pop();
    return this;
  }

  // --- wynik ----------------------------------------------------------------

  /** Surowe tablice (Float32 / Uint32) — do BufferGeometry albo testów. */
  build() {
    const vc = this.vcount();
    return {
      position: Float32Array.from(this.pos),
      normal: Float32Array.from(this.nrm),
      uv: Float32Array.from(this.uvs),
      mat: Float32Array.from(this.mat),
      index: vc > 65535 ? Uint32Array.from(this.idx) : Uint16Array.from(this.idx),
      vertexCount: vc,
      triangleCount: this.idx.length / 3
    };
  }

  /** BufferGeometry (three) z atrybutami position, normal, uv, aMat. */
  toGeometry(THREE, scale = 1) {
    const d = this.build();
    if (scale !== 1) for (let i = 0; i < d.position.length; i++) d.position[i] *= scale;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setAttribute('aMat', new THREE.BufferAttribute(d.mat, 1));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
