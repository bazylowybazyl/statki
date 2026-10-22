// Elektrownia „KOREK” — KOREK: czarna megabudowla zatykająca jądro na dnie gryzu (stoi w jeziorze płaszcza), z kraterem
// wylotu promienia pośrodku. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js: y — wysokość nad dnem gryzu),
// części z rodzajem powierzchni (PART) — materiał metalu i przepływu (earthBitePlant.tsl.js).
//
// Bryła (od zewnątrz, kompozycja z góry: koncentryczne pierścienie + 6 mostów = „koło w jeziorze ognia”):
//   • MASYW — wielokąt 72 ścian z fazami: spódnica w lawie, ściana z pasem okien, kołnierz z listwą, pokład górny,
//     uskok, taras środkowy, uskok, ZIGGURAT akceleratora (3 stopnie + warga krateru), lej i gardziel wylotu;
//   • 36 PRZĘSEŁ ściany między przyporami; w przęsłach: baterie wymienników na linii lawy (żar per wierzchołek),
//     między mostami na przemian 3 KANAŁY wlotu lawy (koryto z głowicą pomp) i 3 WYLOTY (rury w lawę), 6 BRAM mostów;
//   • MOSTY nad lawą (azymuty wind) od bramy do STOPY ŚCIANY (`wallFootPoint`): pokład skrzynkowy, filary i łuki
//     z żarem od spodu, wiązka przewodów energii (PIPE: uv.y 0 korek → 1 stopa), blok kotwiący na ścianie;
//   • GROBLE energii w azymutach mostów: od zigguratu po tarasach do bram (2 przewody PIPE) — 6 szprych koła;
//   • pokład górny: 24 hale turbin, szyna zbiorcza (PIPE w pierścieniu), rozdzielnie, lądowiska, wieże kontroli;
//   • taras środkowy: 8 hiperboloidalnych chłodni, pola transformatorów, 2 lądowiska, maszty ze światłami;
//   • akcelerator: 4 pierścienie COIL (promienie maleją ku górze) z obejmami i 6 emiterów-zębów nad wylotem.
// Rozrzut drobnych brył z ziarnem (`plantRng`). Wierzchołki zbierają akumulatory per rodzaj (i kubełek ziarna), więc
// korek oddaje kilkanaście części zamiast setek.
import * as THREE from 'three/webgpu';
import { DEG, PART, finalizePart, bowlPoint, plantZ0, rimPsi, wallFootPoint, plantRng } from './earthBitePlantFrame.js';

/** Wymiary korka (R Ziemi). corkR, corkTopH, apertureH, apertureR — w PLANT_LAYOUT (wspólne z promieniem i obudową). */
export const CORK_DEFAULTS = Object.freeze({
  // tarasy ku wylotowi: środkowy, wewnętrzny, krater
  corkMidR: 0.098, corkMidH: 0.059,
  corkInnerR: 0.046, corkInnerH: 0.065,
  corkCraterR: 0.024,
  // chłodnie hiperboloidalne na tarasie środkowym (pierścień, promień podstawy, wysokość)
  corkTowers: 8, corkTowerRing: 0.073, corkTowerR: 0.0115, corkTowerH: 0.032,
  // przęsła ściany (przypory), hale turbin na pokładzie górnym
  corkSpans: 36, corkHalls: 24,
  // emitery-zęby nad wylotem: wysokość i odległość czubka od osi
  corkToothH: 0.101, corkToothTipR: 0.0155,
  // mosty nad lawą: szerokość pokładu, promień przewodu energii, ziarno rozrzutu
  corkBridgeW: 0.0115, corkPipeR: 0.0009, corkSeed: 7
});

const V3 = THREE.Vector3;
const UP = Object.freeze(new V3(0, 1, 0));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
/** Kierunek na zewnątrz w azymucie phi (rama: x = cos, z = −sin) i styczna (rosnące phi). */
const dirAz = (phi, out = new V3()) => out.set(Math.cos(phi), 0, -Math.sin(phi));
const tanAz = (phi, out = new V3()) => out.set(-Math.sin(phi), 0, -Math.cos(phi));
const polar = (rho, phi, y, out = new V3()) => out.set(rho * Math.cos(phi), y, -rho * Math.sin(phi));

// ── Akumulatory wierzchołków ────────────────────────────────────────────────────────────────────────────────────────
/** Wierzchołki jednego rodzaju powierzchni (i kubełka ziarna): pozycja, normalna, uv, z / w per wierzchołek, indeks. */
class Acc {
  constructor(kind, seed) {
    this.kind = kind;
    this.seed = seed;
    this.n = 0;
    this.cap = 0;
    this.ni = 0;
    this.idx = new Uint32Array(3072);
    this._grow(1024);
  }

  /** Bufory rosną dwukrotnie (bez tysięcy push na tablicach JS). */
  _grow(cap) {
    const g = (old, k) => {
      const t = new Float32Array(cap * k);
      if (old) t.set(old.subarray(0, this.n * k));
      return t;
    };
    this.pos = g(this.pos, 3);
    this.nrm = g(this.nrm, 3);
    this.uv = g(this.uv, 2);
    this.pz = g(this.pz, 1);
    this.pw = g(this.pw, 1);
    this.cap = cap;
  }

  get count() { return this.n; }

  vert(p, n, u, v, z, w) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.nrm[i * 3] = n.x; this.nrm[i * 3 + 1] = n.y; this.nrm[i * 3 + 2] = n.z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.pz[i] = z;
    this.pw[i] = w;
    return i;
  }

  tri(a, b, c) {
    if (this.ni + 3 > this.idx.length) {
      const t = new Uint32Array(this.idx.length * 2);
      t.set(this.idx);
      this.idx = t;
    }
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  build() {
    const n = this.n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    const { pz, pw } = this;
    return finalizePart(g, this.kind, this.seed, (i) => pz[i], (i) => pw[i]);
  }
}

/** Zbiór akumulatorów: rodzaj × kubełek ziarna (8 kubełków — odmiana części bez setek siatek). */
class Mesher {
  constructor() { this.map = new Map(); }

  acc(kind, seed = 0) {
    const s = Math.min(7, Math.floor(clamp01(seed) * 8));
    const key = kind * 8 + s;
    let a = this.map.get(key);
    if (!a) this.map.set(key, (a = new Acc(kind, (s + 0.5) / 8)));
    return a;
  }

  /** Części metalu (rodzaje 0–7) i przepływu (8–9). */
  parts() {
    const metal = [];
    const flow = [];
    for (const a of this.map.values()) {
      if (!a.count) continue;
      (a.kind >= PART.PIPE ? flow : metal).push(a.build());
    }
    return { metal, flow };
  }
}

const val = (f, p) => (typeof f === 'function' ? f(p) : f);
const _e1 = new V3();
const _e2 = new V3();
const _n = new V3();

/** Czworokąt a-b-c-d (płaski cień); `hint` — strona zewnętrzna (kolejność odwracana, gdy normalna patrzy w drugą stronę). */
function quad(A, a, b, c, d, hint, z = 0, w = 0) {
  if (!A) return;
  _n.crossVectors(_e1.subVectors(c, a), _e2.subVectors(d, b));
  if (_n.lengthSq() < 1e-26) return;
  _n.normalize();
  if (hint && _n.dot(hint) < 0) { const t = b; b = d; d = t; _n.negate(); }
  const i0 = A.vert(a, _n, 0, 0, val(z, a), val(w, a));
  const i1 = A.vert(b, _n, 1, 0, val(z, b), val(w, b));
  const i2 = A.vert(c, _n, 1, 1, val(z, c), val(w, c));
  const i3 = A.vert(d, _n, 0, 1, val(z, d), val(w, d));
  A.tri(i0, i1, i2);
  A.tri(i0, i2, i3);
}

function triangle(A, a, b, c, hint, z = 0, w = 0) {
  if (!A) return;
  _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a));
  if (_n.lengthSq() < 1e-26) return;
  _n.normalize();
  if (hint && _n.dot(hint) < 0) { const t = b; b = c; c = t; _n.negate(); }
  const i0 = A.vert(a, _n, 0, 0, val(z, a), val(w, a));
  const i1 = A.vert(b, _n, 1, 0, val(z, b), val(w, b));
  const i2 = A.vert(c, _n, 0, 1, val(z, c), val(w, c));
  A.tri(i0, i1, i2);
}

/** Rama lokalna: początek o, osie U (bok), V (góra), W (przód); `at(u, v, w)` → punkt ramy elektrowni. */
function frame(o, U, V, W) {
  return {
    o, U, V, W,
    at(u, v, w, out = new V3()) { return out.copy(o).addScaledVector(U, u).addScaledVector(V, v).addScaledVector(W, w); },
    dir(u, v, w, out = new V3()) { return out.set(0, 0, 0).addScaledVector(U, u).addScaledVector(V, v).addScaledVector(W, w); }
  };
}

/** Rama promienista w azymucie phi: U — styczna, V — pion, W — na zewnątrz; początek (rho, y). */
const radialFrame = (phi, rho, y) => frame(polar(rho, phi, y), tanAz(phi), UP.clone(), dirAz(phi));

/**
 * Graniastosłup: wielokąt `poly` ([u, w] w ramie F, wypukły albo gwiaździsty względem środka) wyciągnięty wzdłuż V przez
 * wiersze `rows` ({ v, s: skala | [su, sw], o: [ou, ow] }) — zwężenia i fazy; `acc` — Acc albo { side, top, bottom }
 * (side może być funkcją (krawędź) → Acc). z / w: liczba albo funkcja punktu.
 */
function prism(F, poly, rows, acc, z = 0, w = 0) {
  const side = acc instanceof Acc ? acc : acc.side;
  const top = acc instanceof Acc ? acc : acc.top;
  const bottom = acc instanceof Acc ? acc : acc.bottom;
  const n = poly.length;
  let cu = 0, cw = 0;
  for (const [u, ww] of poly) { cu += u / n; cw += ww / n; }
  const ring = rows.map((r) => {
    const s = r.s ?? 1;
    const su = Array.isArray(s) ? s[0] : s, sw = Array.isArray(s) ? s[1] : s;
    const ou = r.o?.[0] ?? 0, ow = r.o?.[1] ?? 0;
    return poly.map(([u, ww]) => F.at(cu + (u - cu) * su + ou, r.v, cw + (ww - cw) * sw + ow));
  });
  const hint = new V3();
  for (let k = 0; k < n; k++) {
    const [u0, w0] = poly[k], [u1, w1] = poly[(k + 1) % n];
    // normalna krawędzi na zewnątrz (od środka wielokąta)
    let nu = w1 - w0, nw = -(u1 - u0);
    if (nu * ((u0 + u1) / 2 - cu) + nw * ((w0 + w1) / 2 - cw) < 0) { nu = -nu; nw = -nw; }
    F.dir(nu, 0, nw, hint);
    const A = typeof side === 'function' ? side(k, nu, nw) : side;
    if (!A) continue;
    for (let r = 0; r + 1 < rows.length; r++) {
      quad(A, ring[r][k], ring[r][(k + 1) % n], ring[r + 1][(k + 1) % n], ring[r + 1][k], hint, z, w);
    }
  }
  const cap = (pts, A, h) => {
    if (!A) return;
    const c = new V3();
    for (const p of pts) c.addScaledVector(p, 1 / n);
    for (let k = 0; k < n; k++) triangle(A, c, pts[k], pts[(k + 1) % n], h, z, w);
  };
  cap(ring[ring.length - 1], top, F.V);
  cap(ring[0], bottom, F.V.clone().negate());
}

/** Prostopadłościan w ramie F: środek (cu, cw), wysokość v0…v1, półwymiary hu, hw; `chamfer` — faza górnych krawędzi. */
function box(F, cu, cw, hu, hw, v0, v1, acc, z = 0, w = 0, chamfer = 0) {
  const poly = [[cu - hu, cw - hw], [cu + hu, cw - hw], [cu + hu, cw + hw], [cu - hu, cw + hw]];
  const rows = chamfer > 0
    ? [{ v: v0 }, { v: v1 - chamfer }, { v: v1, s: [Math.max(0.05, 1 - (2 * chamfer) / (2 * hu)), Math.max(0.05, 1 - (2 * chamfer) / (2 * hw))] }]
    : [{ v: v0 }, { v: v1 }];
  prism(F, poly, rows, acc, z, w);
}

/** Wielokąt foremny (n wierzchołków, półosie ru, rw) — przekrój filarów i masztów. */
function ngon(n, ru, rw, rot = Math.PI / n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    out.push([Math.cos(a) * ru, Math.sin(a) * rw]);
  }
  return out;
}

/**
 * Bryła obrotowa wokół pionu (cx, cy, cz): profil [r, y] (bryła po LEWEJ przy marszu — wtedy normalne na zewnątrz),
 * `segs[i]` — atrybuty odcinka i → i + 1: { acc, smooth, z, w } (z / w: liczba albo (r, y) → wartość).
 * Odcinki płaskie (smooth: false) — ściany wielokąta o `n` bokach, gładkie — normalne obracane z profilem.
 */
function lathe(profile, segs, n, { cx = 0, cy = 0, cz = 0, theta0 = 0 } = {}) {
  const cs = [], sn = [], csM = [], snM = [];
  for (let j = 0; j <= n; j++) {
    const t = theta0 + (j / n) * Math.PI * 2;
    cs.push(Math.cos(t)); sn.push(Math.sin(t));
    const tm = theta0 + ((j + 0.5) / n) * Math.PI * 2;
    csM.push(Math.cos(tm)); snM.push(Math.sin(tm));
  }
  const P = (r, y, j, out) => out.set(cx + r * cs[j], cy + y, cz - r * sn[j]);
  const a = new V3(), b = new V3(), c = new V3(), d = new V3(), nn = new V3();
  let vAcc = 0;
  for (let i = 0; i + 1 < profile.length; i++) {
    const s = segs[i];
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    const len = Math.hypot(r1 - r0, y1 - y0);
    if (!s?.acc || len < 1e-9) { vAcc += len; continue; }
    const A = s.acc;
    const nr = (y1 - y0) / len, ny = -(r1 - r0) / len;
    const z0 = val2(s.z, r0, y0), z1 = val2(s.z, r1, y1);
    const w0 = val2(s.w, r0, y0), w1 = val2(s.w, r1, y1);
    const v0 = vAcc * 40, v1 = (vAcc + len) * 40;
    if (s.smooth) {
      const base = A.count;
      for (let j = 0; j <= n; j++) {
        nn.set(nr * cs[j], ny, -nr * sn[j]);
        A.vert(P(r0, y0, j, a), nn, j / n, v0, z0, w0);
        A.vert(P(r1, y1, j, d), nn, j / n, v1, z1, w1);
      }
      for (let j = 0; j < n; j++) {
        const ia = base + j * 2, id = ia + 1, ib = ia + 2, ic = ia + 3;
        A.tri(ia, ib, ic);
        A.tri(ia, ic, id);
      }
    } else {
      for (let j = 0; j < n; j++) {
        nn.set(nr * csM[j], ny, -nr * snM[j]);
        const i0 = A.vert(P(r0, y0, j, a), nn, j / n, v0, z0, w0);
        const i1 = A.vert(P(r0, y0, j + 1, b), nn, (j + 1) / n, v0, z0, w0);
        const i2 = A.vert(P(r1, y1, j + 1, c), nn, (j + 1) / n, v1, z1, w1);
        const i3 = A.vert(P(r1, y1, j, d), nn, j / n, v1, z1, w1);
        A.tri(i0, i1, i2);
        A.tri(i0, i2, i3);
      }
    }
    vAcc += len;
  }
}
const val2 = (f, r, y) => (typeof f === 'function' ? f(r, y) : (f ?? 0));

/** Torus wokół pionu (środek przekroju r0, y0; promień rury rt) — gładki. */
function torus(A, r0, y0, rt, n, m = 10, opts = {}, z = 0, w = 0) {
  const prof = [];
  for (let k = 0; k <= m; k++) {
    const t = (k / m) * Math.PI * 2;
    prof.push([r0 + Math.cos(t) * rt, y0 + Math.sin(t) * rt]);
  }
  lathe(prof, prof.map(() => ({ acc: A, smooth: true, z, w })), n, opts);
}

/**
 * Belka po ścieżce (prostokątny przekrój): punkty `pts`, w każdym półszerokość hw (wzdłuż S) i półwysokość hh (wzdłuż N,
 * N ⟂ T od wektora `up`). `accOf(ściana)` → Acc ('top' +N, 'bottom' −N, 'side'), z — liczba, tablica per punkt
 * albo funkcja (ściana, i) → wartość.
 */
function sweep(pts, hw, hh, up, accOf, z = 0, w = 0, caps = true) {
  const m = pts.length;
  const T = [], N = [], S = [];
  for (let i = 0; i < m; i++) {
    const t = new V3().subVectors(pts[Math.min(m - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    const u = (Array.isArray(up) ? up[i] : up);
    const nv = u.clone().addScaledVector(t, -u.dot(t)).normalize();
    T.push(t); N.push(nv); S.push(new V3().crossVectors(t, nv).normalize());
  }
  const H = (i) => (Array.isArray(hw) ? hw[i] : hw);
  const Hh = (i) => (Array.isArray(hh) ? hh[i] : hh);
  const corner = (i, sa, na) => pts[i].clone().addScaledVector(S[i], sa * H(i)).addScaledVector(N[i], na * Hh(i));
  const C = [];
  for (let i = 0; i < m; i++) C.push([corner(i, 1, 1), corner(i, -1, 1), corner(i, -1, -1), corner(i, 1, -1)]);
  const faces = [['top', 0, 1, (i) => N[i]], ['side', 1, 2, (i) => S[i].clone().negate()], ['bottom', 2, 3, (i) => N[i].clone().negate()], ['side', 3, 0, (i) => S[i]]];
  for (const [name, k0, k1, hf] of faces) {
    const A = accOf(name);
    if (!A) continue;
    const zf = (i) => (typeof z === 'function' ? z(name, i) : (Array.isArray(z) ? z[i] : z));
    const wf = (i) => (typeof w === 'function' ? w(name, i) : w);
    for (let i = 0; i + 1 < m; i++) {
      const h = hf(i).add(hf(i + 1)).normalize();
      // z / w per punkt ścieżki (oba wierzchołki przekroju i mają tę samą wartość)
      const zi = zf(i), zj = zf(i + 1), wi = wf(i), wj = wf(i + 1);
      const a = C[i][k0], b = C[i][k1], c = C[i + 1][k1], d = C[i + 1][k0];
      const zz = (p) => (p === a || p === b ? zi : zj);
      const ww = (p) => (p === a || p === b ? wi : wj);
      quad(A, a, b, c, d, h, zz, ww);
    }
  }
  if (caps) {
    const A = accOf('cap');
    if (A) {
      const zf = (i) => (typeof z === 'function' ? z('cap', i) : (Array.isArray(z) ? z[i] : z));
      quad(A, C[0][0], C[0][1], C[0][2], C[0][3], T[0].clone().negate(), zf(0), 0);
      quad(A, C[m - 1][0], C[m - 1][1], C[m - 1][2], C[m - 1][3], T[m - 1], zf(m - 1), 0);
    }
  }
}

/** Walec P → Q (gładki płaszcz, opcjonalne denka), promienie r0 (P) i r1 (Q). */
function cylinder(A, P, Q, r0, r1, n, caps = true, z = 0, w = 0) {
  const ax = new V3().subVectors(Q, P);
  const len = ax.length();
  if (len < 1e-9) return;
  ax.divideScalar(len);
  const e1 = new V3(1, 0, 0);
  if (Math.abs(ax.x) > 0.9) e1.set(0, 0, 1);
  const e2 = new V3().crossVectors(ax, e1).normalize();
  e1.crossVectors(e2, ax).normalize();
  const base = A.count;
  const p = new V3(), nn = new V3();
  for (let j = 0; j <= n; j++) {
    const t = (j / n) * Math.PI * 2;
    nn.copy(e1).multiplyScalar(Math.cos(t)).addScaledVector(e2, Math.sin(t));
    A.vert(p.copy(P).addScaledVector(nn, r0), nn, j / n, 0, val(z, P), val(w, P));
    A.vert(p.copy(Q).addScaledVector(nn, r1), nn, j / n, 1, val(z, Q), val(w, Q));
  }
  // kolejność: zewnętrzna normalna (sprawdzona na pierwszym czworokącie)
  const a0 = new V3().copy(P).addScaledVector(e1, r0);
  const t1 = (1 / n) * Math.PI * 2;
  const b0 = new V3().copy(P).addScaledVector(e1, r0 * Math.cos(t1)).addScaledVector(e2, r0 * Math.sin(t1));
  const d0 = new V3().copy(Q).addScaledVector(e1, r1);
  const flip = new V3().crossVectors(b0.sub(a0), d0.sub(a0)).dot(e1) < 0;
  for (let j = 0; j < n; j++) {
    const ia = base + j * 2, id = ia + 1, ib = ia + 2, ic = ia + 3;
    if (flip) { A.tri(ia, ic, ib); A.tri(ia, id, ic); } else { A.tri(ia, ib, ic); A.tri(ia, ic, id); }
  }
  if (caps) {
    const ring = (C, r) => { const out = []; for (let j = 0; j < n; j++) { const t = (j / n) * Math.PI * 2; out.push(C.clone().addScaledVector(e1, r * Math.cos(t)).addScaledVector(e2, r * Math.sin(t))); } return out; };
    const rq = ring(Q, r1), rp = ring(P, r0);
    for (let j = 0; j < n; j++) {
      triangle(A, Q, rq[j], rq[(j + 1) % n], ax, z, w);
      triangle(A, P, rp[j], rp[(j + 1) % n], ax.clone().negate(), z, w);
    }
  }
}

// ── Lawa pod korkiem ────────────────────────────────────────────────────────────────────────────────────────────────
const _bp = new V3();
/** Wysokość dna / ściany gryzu (powierzchni lawy) w azymucie phi, w odległości rho od osi (bisekcja po ψ). */
function lavaHeight(phi, rho, b, z0) {
  let lo = 0, hi = rimPsi(phi, b);
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5;
    bowlPoint(phi, mid, 0, b, z0, _bp);
    if (Math.hypot(_bp.x, _bp.z) < rho) lo = mid; else hi = mid;
  }
  return bowlPoint(phi, (lo + hi) * 0.5, 0, b, z0, _bp).y;
}

/** Linia lawy na boku korka w azymucie phi: pierwszy punkt profilu boku (łamana `side`) nad lawą → { r, y }. */
function waterline(side, phi, b, z0) {
  const at = (t) => {
    const k = Math.min(side.length - 2, Math.floor(t));
    const f = t - k;
    return [lerp(side[k][0], side[k + 1][0], f), lerp(side[k][1], side[k + 1][1], f)];
  };
  const below = (t) => { const [r, y] = at(t); return y < lavaHeight(phi, r, b, z0); };
  let lo = 0, hi = side.length - 1;
  if (!below(lo)) return { r: side[0][0], y: side[0][1] };
  if (below(hi)) { const [r, y] = at(hi); return { r, y }; }
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    if (below(mid)) lo = mid; else hi = mid;
  }
  const [r, y] = at((lo + hi) * 0.5);
  return { r, y };
}

// ── Korek ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Korek: { metal: części, flow: części } w ramie elektrowni. */
export function buildCork(L, b) {
  const M = new Mesher();
  const z0 = plantZ0(b);
  const rng = plantRng(L.corkSeed * 7919 + 13);
  const ctx = { L, b, z0, M, rng, geo: corkProfile(L) };
  // azymuty mostów (wind) i wlotów / wylotów (między mostami); przęsła: środki co 360° / corkSpans
  ctx.bridgeAz = L.elevators.map((a) => a * DEG);
  ctx.intakeAz = L.elevators.map((a) => (a + 360 / L.elevators.length / 2) * DEG);
  buildMassif(ctx);
  buildSpans(ctx);
  for (let i = 0; i < ctx.bridgeAz.length; i++) buildBridge(ctx, ctx.bridgeAz[i], i);
  buildTopDeck(ctx);
  ctx.bridgeAz.forEach((az, i) => buildCauseway(ctx, az, i));
  buildMidTerrace(ctx);
  buildAccelerator(ctx);
  return M.parts();
}

/** Profil masywu [r, y] i odcinki z rodzajami; `side` — łamana boku (spódnica → kołnierz) do szukania linii lawy. */
function corkProfile(L) {
  const R = L.corkR, T = L.corkTopH, Mr = L.corkMidR, Mh = L.corkMidH, Ir = L.corkInnerR, Ih = L.corkInnerH;
  const Cr = L.corkCraterR, Ah = L.apertureH, Ar = L.apertureR;
  const P = [];
  const S = [];
  const add = (r, y, seg) => { P.push([r, y]); S.push(seg); };
  // spódnica w lawie, ściana z pasem okien, kołnierz z listwą i fazami
  add(R + 0.022, -0.030, 'hull');
  add(R + 0.006, 0.012, 'hull');
  add(R + 0.002, 0.015, 'hull');
  add(R + 0.002, T - 0.023, 'window');
  add(R + 0.002, T - 0.017, 'hull');
  add(R + 0.002, T - 0.014, 'hull');
  add(R + 0.0045, T - 0.012, 'hull');
  add(R + 0.0045, T - 0.0068, 'hull');
  add(R + 0.0030, T - 0.0053, 'strip');
  add(R + 0.0018, T - 0.0041, 'hull');
  add(R + 0.0010, T - 0.0033, 'hull');
  add(R - 0.0010, T - 0.0013, 'hull');
  // pokład górny, uskok z oknami, taras środkowy, uskok z oknami, półka
  add(R - 0.0020, T, 'deck');
  add(Mr + 0.0015, T, 'hull');
  add(Mr, T + 0.0015, 'window');
  add(Mr, Mh - 0.0015, 'stripW');
  add(Mr - 0.0015, Mh, 'deck');
  add(Ir + 0.0015, Mh, 'hull');
  add(Ir, Mh + 0.0015, 'window');
  add(Ir, Ih - 0.0015, 'stripC');
  add(Ir - 0.0015, Ih, 'hull');
  // ziggurat akceleratora: 4 skosy po 0,0015 R, 3 stopnie, warga krateru (apertureH)
  const r0 = Ir - 0.0035, rise = 0.0015, steps = 3;
  const tread = (r0 - Cr - rise * 4) / steps;
  const dh = (Ah - Ih) / 4;
  const treads = [];
  add(r0, Ih, 'hull');
  let r = r0, y = Ih;
  for (let k = 0; k < steps; k++) {
    r -= rise; y += dh;
    add(r, y, 'deck');
    treads.push({ r: r - tread * 0.5, y, w: tread });
    r -= tread;
    add(r, y, 'hull');
  }
  // warga krateru i lej do gardzieli (gładko)
  add(Cr, Ah, 'deck');
  treads.push({ r: Cr - 0.002, y: Ah, w: 0.004 });
  add(Cr - 0.004, Ah, 'smooth');
  add(Ar + 0.0013, Ah - 0.0014, 'smooth');
  add(Ar + 0.0001, Ah - 0.0045, 'smooth');
  add(Ar, Ah - 0.017, 'smooth');
  add(Ar - 0.0003, -0.005, null);
  return { P, S, treads, side: P.slice(0, 6) };
}

function buildMassif(ctx) {
  const { M, geo } = ctx;
  const hull = M.acc(PART.HULL, 0.1);
  const deck = M.acc(PART.HULL, 0.3);
  const segs = geo.S.map((s) => {
    if (s === 'window') return { acc: M.acc(PART.WINDOW, 0.2), z: 0.42 };
    if (s === 'strip') return { acc: M.acc(PART.STRIP, 0.6), z: 0.2, w: 1 };
    // krawędzie tarasów: ciepła (taras środkowy) i chłodna (wewnętrzny) — koncentryczne pierścienie z daleka
    if (s === 'stripW') return { acc: M.acc(PART.STRIP, 0.7), z: 0.22, w: 0 };
    if (s === 'stripC') return { acc: M.acc(PART.STRIP, 0.8), z: 0.26, w: 1 };
    if (s === 'deck') return { acc: deck };
    if (s === 'smooth') return { acc: hull, smooth: true };
    if (s === 'hull') return { acc: hull };
    return null;
  });
  lathe(geo.P, segs, 72);
}

// ── Przęsła ściany: przypory, wymienniki, kanały wlotu, bramy mostów ───────────────────────────────────────────────
function buildSpans(ctx) {
  const { L, M, b, z0, geo, rng } = ctx;
  const n = L.corkSpans;
  const R = L.corkR, T = L.corkTopH;
  const near = (az, list, tol) => list.some((a) => Math.abs(Math.atan2(Math.sin(az - a), Math.cos(az - a))) < tol);
  const ribAcc = M.acc(PART.HULL, 0.45);
  const ribCap = M.acc(PART.STRUCT, 0.45);
  // przypory na krawędziach przęseł (co 360° / n, przesunięte o pół przęsła): klin z fazami, stopa w lawie
  const ribProfile = [
    [R + 0.001, -0.012], [R + 0.030, -0.012], [R + 0.024, 0.006], [R + 0.0115, T - 0.013],
    [R + 0.0098, T - 0.0055], [R + 0.0072, T - 0.0028], [R + 0.001, T - 0.0028]
  ];
  for (let i = 0; i < n; i++) {
    const az = ((i + 0.5) / n) * Math.PI * 2;
    const F = radialFrame(az, 0, 0);
    // przypora: wielokąt boku (r, y) wyciągnięty wzdłuż stycznej (grubość 0,0034)
    extrudeSide(F, ribProfile, 0.0017, { side: ribAcc, cap: ribCap });
    if (i % 3 === 1) {
      // czerwone światła pozycyjne na co trzeciej przyporze (pierścień błysków czytelny z daleka)
      box(F, 0, R + 0.0055, 0.00075, 0.00075, T - 0.0028, T - 0.0013, M.acc(PART.BEACON, (i * 0.137) % 1), 0.4, 0);
    }
  }
  // przęsła: środki co 360° / n
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2;
    if (near(az, ctx.bridgeAz, 0.6 * Math.PI / n)) { buildGate(ctx, az, i); continue; }
    const wl = waterline(geo.side, az, b, z0);
    const k = ctx.intakeAz.findIndex((a) => Math.abs(Math.atan2(Math.sin(az - a), Math.cos(az - a))) < 0.6 * Math.PI / n);
    // między mostami na przemian: kanał wlotu lawy i wylot zużytego medium; reszta przęseł — wymienniki
    if (k >= 0) (k % 2 ? buildOutlet : buildIntake)(ctx, az, wl, i);
    else buildExchanger(ctx, az, wl, i, rng);
  }
}

/** Wielokąt boku (r, y) w płaszczyźnie promienistej ramy F wyciągnięty o ±half wzdłuż U. */
function extrudeSide(F, prof, half, acc, z = 0, w = 0) {
  const sideAcc = acc.side, capAcc = acc.cap ?? acc.side;
  const m = prof.length;
  const pt = (k, s) => F.at(s * half, prof[k][1], prof[k][0]);
  const hint = new V3();
  let cr = 0, cy = 0;
  for (const [r, y] of prof) { cr += r / m; cy += y / m; }
  for (let k = 0; k < m; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[(k + 1) % m];
    let nr = y1 - y0, ny = -(r1 - r0);
    if (nr * ((r0 + r1) / 2 - cr) + ny * ((y0 + y1) / 2 - cy) < 0) { nr = -nr; ny = -ny; }
    F.dir(0, ny, nr, hint);
    quad(sideAcc, pt(k, -1), pt((k + 1) % m, -1), pt((k + 1) % m, 1), pt(k, 1), hint, z, w);
  }
  // boki: triangulacja wielokąta (earcut)
  const tris = THREE.ShapeUtils.triangulateShape(prof.map(([r, y]) => new THREE.Vector2(r, y)), []);
  for (const s of [-1, 1]) {
    const h = F.U.clone().multiplyScalar(s);
    for (const [a, c, d] of tris) triangle(capAcc, pt(a, s), pt(c, s), pt(d, s), h, z, w);
  }
}

/**
 * Bateria wymienników ciepła na linii lawy: żebra promieniste (żar od lawy w górę), kolektor i rura — tylko gdy pod
 * kołnierzem jest miejsce (z boków, gdzie lawa stoi wysoko, żebra sięgają kołnierza i nic nad nimi nie ma).
 */
function buildExchanger(ctx, az, wl, i, rng) {
  const { L, M } = ctx;
  const n = L.corkSpans;
  const T = L.corkTopH;
  const span = (Math.PI * 2 / n) * (wl.r + 0.006);
  const F = radialFrame(az, 0, 0);
  const hot = M.acc(PART.HOT, (i * 0.31) % 1);
  const hW = wl.y;
  const ceil = T - 0.0125;                       // spód kołnierza
  // żar: 1 przy linii lawy → 0 ~0,012 wyżej
  const heat = (p) => clamp01(1 - (p.y - hW) / 0.012);
  const fins = 6;
  const usable = span - 0.0048;
  const finTop = Math.min(hW + 0.0135, ceil);
  const rows = [hW - 0.009, hW - 0.001, hW + 0.003, hW + 0.007, hW + 0.011].filter((v) => v < finTop - 0.0008);
  rows.push(finTop);
  for (let k = 0; k < fins; k++) {
    const u = -usable / 2 + (usable * (k + 0.5)) / fins;
    const w0 = wl.r - 0.004, w1 = wl.r + 0.0105 + rng.range(-0.0012, 0.0012);
    const poly = [[u - 0.00055, w0], [u + 0.00055, w0], [u + 0.00055, w1], [u - 0.00055, w1]];
    // krawędź zewnętrzna żebra cofa się ku górze (skos)
    prism(F, poly, rows.map((v) => ({ v, o: [0, -0.0035 * clamp01((v - rows[0]) / 0.0225)] })), hot, heat);
  }
  if (hW + 0.0195 > ceil) return;
  // kolektor nad żebrami i rura zbiorcza
  const hull = M.acc(PART.HULL, (i * 0.17) % 1);
  box(F, 0, wl.r + 0.002, usable / 2 + 0.0008, 0.0065, hW + 0.0135, hW + 0.0175, hull, 0, 0, 0.0008);
  const st = M.acc(PART.STRUCT, 0.5);
  cylinder(st, F.at(-usable / 2, hW + 0.0186, wl.r + 0.0042), F.at(usable / 2, hW + 0.0186, wl.r + 0.0042), 0.00095, 0.00095, 8, true);
  // co trzecie przęsło — okna nadzoru nad kolektorem
  if (i % 3 === 1 && hW + 0.022 < ceil) box(F, 0, wl.r + 0.0002, usable * 0.3, 0.0008, hW + 0.0176, hW + 0.021, M.acc(PART.WINDOW, 0.7), 0.55);
}

/**
 * Kanał wlotu lawy: koryto na podporach — wynurza się z jeziora (głowica pomp) i wznosi do śluzy w ścianie korka;
 * w korycie płynie żar (HOT), ścianki i głowica — stal, wrota śluzy z listwą.
 */
function buildIntake(ctx, az, wl, i) {
  const { M, b, z0 } = ctx;
  const F = radialFrame(az, 0, 0);
  const st = M.acc(PART.STRUCT, (i * 0.21) % 1);
  const hull = M.acc(PART.HULL, 0.62);
  const hot = M.acc(PART.HOT, 0.9);
  const half = 0.0052, wallT = 0.0016, len = 0.032;
  const w0 = wl.r - 0.002, w1 = w0 + len;
  const lava1 = lavaHeight(az, w1, b, z0);
  // dno koryta: od lustra lawy przy głowicy (−0,001) do +0,005 nad linią lawy przy ścianie
  const fA = wl.y + 0.005, fB = lava1 - 0.001;
  const nS = 12;
  const S = [];
  for (let k = 0; k <= nS; k++) {
    const t = k / nS;
    const w = lerp(w0, w1, t);
    S.push({ w, f: lerp(fA, fB, t), h: lavaHeight(az, w, b, z0) });
  }
  for (let k = 0; k < nS; k++) {
    const a = S[k], c = S[k + 1];
    // ścianki koryta (od lawy do korony 0,0035 nad dnem)
    for (const s of [-1, 1]) {
      const u0 = s * half, u1 = s * (half + wallT);
      const pa = (u, v, w) => F.at(u, v, w);
      const lo = Math.min(a.h, c.h) - 0.003;
      quad(st, pa(u1, a.f + 0.0035, a.w), pa(u1, c.f + 0.0035, c.w), pa(u1, lo, c.w), pa(u1, lo, a.w), F.U.clone().multiplyScalar(s));
      quad(st, pa(u0, a.f + 0.0035, a.w), pa(u0, c.f + 0.0035, c.w), pa(u0, c.f, c.w), pa(u0, a.f, a.w), F.U.clone().multiplyScalar(-s));
      quad(hull, pa(u0, a.f + 0.0035, a.w), pa(u1, a.f + 0.0035, a.w), pa(u1, c.f + 0.0035, c.w), pa(u0, c.f + 0.0035, c.w), UP);
    }
    // żar w korycie (jaśniej przy głowicy — świeża lawa)
    const za = 0.42 + 0.12 * (k / nS), zc = 0.42 + 0.12 * ((k + 1) / nS);
    const p0 = F.at(-half, a.f, a.w), p1 = F.at(half, a.f, a.w), p2 = F.at(half, c.f, c.w), p3 = F.at(-half, c.f, c.w);
    quad(hot, p0, p1, p2, p3, UP, (p) => (p === p0 || p === p1 ? za : zc));
  }
  // podpory koryta nad lawą
  for (const t of [0.3, 0.62]) {
    const w = lerp(w0, w1, t), f = lerp(fA, fB, t), h = lavaHeight(az, w, b, z0);
    if (f - h > 0.002) box(F, 0, w, half + wallT + 0.0006, 0.0011, h - 0.004, f, st);
  }
  // głowica pomp na końcu (wynurza się z lawy) i wrota śluzy przy ścianie
  box(F, 0, w1 - 0.002, half + wallT + 0.0012, 0.0032, lava1 - 0.006, fB + 0.0062, hull, 0, 0, 0.0007);
  box(F, 0, w1 - 0.002, half + wallT + 0.0006, 0.00025, fB + 0.0062, fB + 0.0072, M.acc(PART.STRIP, 0.3), 0.35, 0);
  box(F, 0, wl.r + 0.0022, half + wallT + 0.0016, 0.0024, wl.y - 0.004, fA + 0.0105, hull, 0, 0, 0.0008);
  box(F, 0, wl.r + 0.0047, half - 0.0003, 0.0002, fA + 0.0055, fA + 0.0068, M.acc(PART.STRIP, 0.3), 0.5, 0);
}

/**
 * Wylot zużytego medium: dwie grube rury z obudowy przy ścianie, zgięte w dół do jeziora (u wejścia w lawę —
 * żarzący się pierścień rozbryzgu), podpory na lawie.
 */
function buildOutlet(ctx, az, wl, i) {
  const { M, b, z0 } = ctx;
  const F = radialFrame(az, 0, 0);
  const st = M.acc(PART.STRUCT, (i * 0.23 + 0.4) % 1);
  const hull = M.acc(PART.HULL, 0.58);
  const hot = M.acc(PART.HOT, 0.85);
  const y0 = wl.y + 0.0095;
  const wIn = wl.r + 0.021;
  const hIn = lavaHeight(az, wIn, b, z0);
  for (const u of [-0.0034, 0.0034]) {
    const pts = [
      F.at(u, y0, wl.r - 0.001), F.at(u, y0, wl.r + 0.007), F.at(u, lerp(y0, hIn, 0.45), wl.r + 0.0145),
      F.at(u, hIn + 0.002, wIn - 0.0012), F.at(u, hIn - 0.006, wIn + 0.0006)
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    appendGeometry(st, new THREE.TubeGeometry(curve, 40, 0.0019, 12, false), 0, 0);
    // obręcze co ~0,006 wzdłuż rury
    for (const t of [0.18, 0.42, 0.66]) {
      const p = curve.getPointAt(t), d = curve.getTangentAt(t);
      cylinder(hull, p.clone().addScaledVector(d, -0.0004), p.clone().addScaledVector(d, 0.0004), 0.0023, 0.0023, 12, true);
    }
    // pierścień rozbryzgu na lustrze lawy wokół wejścia rury
    const c = F.at(u, 0, wIn);
    const hC = lavaHeight(az, wIn, b, z0);
    lathe([[0.0046, hC + 0.0005], [0.0021, hC + 0.0009]], [{ acc: hot, z: (r) => lerp(0.35, 0.85, clamp01((0.0046 - r) / 0.0025)) }], 24, { cx: c.x, cz: c.z });
    // podpora pod kolanem rury
    const pS = curve.getPointAt(0.3);
    const hS = lavaHeight(az, wl.r + 0.009, b, z0);
    if (pS.y - hS > 0.003) {
      const Fs = frame(new V3(pS.x, 0, pS.z), F.U, UP.clone(), F.W);
      box(Fs, 0, 0, 0.0014, 0.0012, hS - 0.004, pS.y - 0.0019, st);
    }
  }
  // obudowa wylotu przy ścianie z listwą ciepłą
  box(F, 0, wl.r + 0.002, 0.0066, 0.0026, wl.y + 0.003, wl.y + 0.0145, hull, 0, 0, 0.0008);
  box(F, 0, wl.r + 0.0047, 0.0058, 0.0002, wl.y + 0.0128, wl.y + 0.0138, M.acc(PART.STRIP, 0.35), 0.45, 0);
}

/** Brama mostu w przęśle: blok na ścianie korka z portalem (mosty wchodzą w jej czoło), dyspozytornia i maszt. */
function buildGate(ctx, az, i) {
  const { L, M, b, z0, geo } = ctx;
  const F = radialFrame(az, 0, 0);
  const R = L.corkR, T = L.corkTopH;
  const wl = waterline(geo.side, az, b, z0);
  const hull = M.acc(PART.HULL, 0.75);
  const half = 0.0092;
  const r1 = R + 0.0125;
  // bryła bramy: od lawy do nad pokład, fazowana
  prism(F, [[-half, R - 0.002], [half, R - 0.002], [half, r1], [-half, r1]],
    [{ v: wl.y - 0.008 }, { v: T + 0.0006 }, { v: T + 0.0018, s: [0.88, 0.86] }], hull);
  // skośne przypory bramy ku lawie
  for (const s of [-1, 1]) {
    prism(F, [[s * half - 0.0015, r1 - 0.004], [s * half + 0.0015, r1 - 0.004], [s * half + 0.0015, r1 + 0.008], [s * half - 0.0015, r1 + 0.008]],
      [{ v: wl.y - 0.010 }, { v: wl.y + 0.004 }, { v: T - 0.004, o: [0, -0.011] }], M.acc(PART.STRUCT, 0.75));
  }
  // portal: rama listwy chłodnej wokół wejścia przewodów, ciemne szkło nad nim, pas okien
  const deckTop = L.footH - L.corkPipeR - 0.0003;
  const hw = L.corkBridgeW / 2;
  box(F, 0, r1 + 0.0002, hw + 0.0008, 0.0003, deckTop - 0.0005, deckTop + 0.0058, M.acc(PART.STRIP, 0.2), 0.4, 1);
  box(F, 0, r1 + 0.0004, hw - 0.0006, 0.0003, deckTop + 0.0006, deckTop + 0.0050, M.acc(PART.GLASS, 0.2));
  box(F, 0, r1 + 0.0001, half * 0.8, 0.0003, T - 0.0045, T - 0.0012, M.acc(PART.WINDOW, 0.4), 0.6);
  // dyspozytornia na bramie i maszt z białym światłem
  const top = T + 0.0018;
  box(F, 0, R + 0.0055, 0.0042, 0.003, top, top + 0.0032, { side: M.acc(PART.WINDOW, 0.9), top: hull, bottom: null }, 0.7);
  box(F, 0, R + 0.0055, 0.0046, 0.0034, top + 0.0032, top + 0.0040, hull, 0, 0, 0.0004);
  const mast = M.acc(PART.STRUCT, 0.9);
  prism(F, ngon(4, 0.00045, 0.00045), [{ v: top }, { v: top + 0.016, s: 0.45 }].map((r) => ({ ...r, o: [-0.0035, R + 0.0095] })), mast);
  box(F, -0.0035, R + 0.0095, 0.0006, 0.0006, top + 0.016, top + 0.0172, M.acc(PART.BEACON, (i * 0.29 + 0.1) % 1), 0.35, 1);
}

// ── Mosty nad lawą ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Most w azymucie phi: od czoła bramy do STOPY ŚCIANY (`wallFootPoint`) — WIADUKT: pokład skrzynkowy na masywnych
 * filarach, między nimi łuki ze ścianami nadłucza (podniebie łuku żarzy się od lawy), wiązka 3 przewodów energii
 * (PIPE: uv.y 0 korek → 1 stopa), blok kotwiący na ścianie z pylonami.
 */
function buildBridge(ctx, phi, idx) {
  const { L, M, b, z0 } = ctx;
  const foot = wallFootPoint(L, b, phi);
  const rf = Math.hypot(foot.x, foot.z);
  const F = radialFrame(phi, 0, 0);
  const R = L.corkR;
  const r0 = R + 0.0125;               // czoło bramy
  const hw = L.corkBridgeW / 2;
  const deckTop = L.footH - L.corkPipeR - 0.0003;
  const deckBot = deckTop - 0.0052;
  const len = Math.max(0.004, rf - r0);
  // lawa pod mostem (próbki co ~0,003 R)
  const nL = Math.max(4, Math.ceil(len / 0.003));
  const lava = [];
  for (let k = 0; k <= nL; k++) { const w = r0 + (len * k) / nL; lava.push(lavaHeight(phi, w, b, z0)); }
  const lavaAt = (w) => {
    const t = clamp01((w - r0) / len) * nL;
    const k = Math.min(nL - 1, Math.floor(t));
    return lerp(lava[k], lava[k + 1], t - k);
  };
  const seed = (idx * 0.173 + 0.05) % 1;
  const top = M.acc(PART.HULL, seed);
  const st = M.acc(PART.STRUCT, seed);
  const hot = M.acc(PART.HOT, seed);
  const win = M.acc(PART.WINDOW, seed);
  const end = rf - 0.004;
  const hd = hw - 0.0009;              // spód skrzynki węższy (faza)
  // pokład: odcinki co ~0,004 — wierzch kadłub, boki z galerią okien, spód żarzy się wg prześwitu nad lawą
  const nD = Math.max(2, Math.ceil((end - r0) / 0.004));
  const underHeat = (w) => 0.16 + 0.4 * clamp01(1 - (deckBot - lavaAt(w)) / 0.03);
  for (let k = 0; k < nD; k++) {
    const wa = r0 + ((end - r0) * k) / nD, wb = r0 + ((end - r0) * (k + 1)) / nD;
    const a = [F.at(-hw, deckTop, wa), F.at(hw, deckTop, wa), F.at(hw, deckTop, wb), F.at(-hw, deckTop, wb)];
    const m = [F.at(-hw, deckBot + 0.0012, wa), F.at(hw, deckBot + 0.0012, wa), F.at(hw, deckBot + 0.0012, wb), F.at(-hw, deckBot + 0.0012, wb)];
    const d = [F.at(-hd, deckBot, wa), F.at(hd, deckBot, wa), F.at(hd, deckBot, wb), F.at(-hd, deckBot, wb)];
    quad(top, a[0], a[1], a[2], a[3], UP);
    quad(hot, d[0], d[1], d[2], d[3], UP.clone().negate(), (p) => underHeat(p === d[0] || p === d[1] ? wa : wb));
    // bok: pas galerii okien pod attyką, niżej stal, faza ku spodowi
    const g = [F.at(-hw, deckTop - 0.0019, wa), F.at(hw, deckTop - 0.0019, wa), F.at(hw, deckTop - 0.0019, wb), F.at(-hw, deckTop - 0.0019, wb)];
    quad(win, a[1], a[2], g[2], g[1], F.U, 0.24);
    quad(win, a[0], a[3], g[3], g[0], F.U.clone().negate(), 0.24);
    quad(top, g[1], g[2], m[2], m[1], F.U);
    quad(top, g[0], g[3], m[3], m[0], F.U.clone().negate());
    quad(st, m[1], m[2], d[2], d[1], F.U.clone().sub(UP));
    quad(st, m[0], m[3], d[3], d[0], F.U.clone().negate().sub(UP));
  }
  // attyki z listwą ciepłą, siodła przewodów co 0,006
  for (const s of [-1, 1]) {
    box(F, s * (hw - 0.0005), (r0 + end) / 2, 0.0005, (end - r0) / 2, deckTop, deckTop + 0.0011, st);
    box(F, s * (hw - 0.0005), (r0 + end) / 2, 0.00035, (end - r0) / 2, deckTop + 0.0011, deckTop + 0.0014, M.acc(PART.STRIP, 0.1), 0.34, 0);
  }
  for (let w = r0 + 0.004; w < end - 0.002; w += 0.006) box(F, 0, w, hw - 0.0012, 0.00045, deckTop, deckTop + 0.0006, st);
  // podpory: czoło bramy, filary co ~0,03 R, blok kotwiący
  const nSpan = Math.max(1, Math.round(len / 0.03));
  const ph = 0.0034;                   // pół grubości filara wzdłuż mostu
  const anchorW = rf - 0.016;
  const sup = [{ w: r0, a: 0, b: 0 }];
  for (let k = 1; k < nSpan; k++) sup.push({ w: r0 + ((anchorW - r0) * k) / nSpan, a: ph, b: ph });
  sup.push({ w: anchorW, a: 0, b: 0 });
  const hp = hw - 0.0004;              // ściany nadłucza (lekko cofnięte od krawędzi pokładu)
  for (let k = 1; k < sup.length - 1; k++) {
    const w = sup[k].w;
    const hL = lavaAt(w);
    if (hL > deckBot - 0.002) { sup[k].a = sup[k].b = 0; continue; }
    // filar: ośmiokąt zwężany ku górze, żar u stopy (1 przy lawie → 0 ~0,012 wyżej)
    const heat = (p) => clamp01(1 - (p.y - hL) / 0.012);
    const vs = [hL - 0.007, hL, hL + 0.003, hL + 0.007, hL + 0.012].filter((v) => v < deckBot - 0.002);
    const rows = vs.map((v) => ({ v, s: lerp(1.12, 1, clamp01((v - vs[0]) / Math.max(1e-6, deckBot - vs[0]))) }));
    rows.push({ v: deckBot });
    prism(F, ngon(8, hp, ph * 0.94, Math.PI / 8).map(([u, ww]) => [u, ww + w]), rows, hot, heat);
  }
  // łuki eliptyczne między podporami: ściany nadłucza (stal), podniebie (żar wg prześwitu), obramienie łuku
  const crown = deckBot - 0.0016;
  for (let k = 0; k + 1 < sup.length; k++) {
    const wa = sup[k].w + sup[k].b, wb = sup[k + 1].w - sup[k + 1].a;
    if (wb - wa < 0.004) continue;
    const ys = Math.max(lavaAt(wa), lavaAt(wb)) + 0.0035;
    const wm = (wa + wb) / 2;
    if (crown - ys < 0.003) {
      // płytko nad lawą: pełna ściana do lawy zamiast łuku
      const lo = Math.min(lavaAt(wa), lavaAt(wb)) - 0.004;
      prism(F, [[-hp, wa], [hp, wa], [hp, wb], [-hp, wb]], [{ v: lo }, { v: deckBot }], { side: st, top: null, bottom: null });
      continue;
    }
    const m = 18;
    const P = [];
    for (let j = 0; j <= m; j++) {
      const t = (1 - Math.cos((Math.PI * j) / m)) / 2;
      const w = lerp(wa, wb, t);
      P.push({ w, y: ys + (crown - ys) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) });
    }
    for (const s of [-1, 1]) {
      const h = F.U.clone().multiplyScalar(s);
      for (let j = 0; j < m; j++) {
        quad(st, F.at(s * hp, deckBot, P[j].w), F.at(s * hp, deckBot, P[j + 1].w), F.at(s * hp, P[j + 1].y, P[j + 1].w), F.at(s * hp, P[j].y, P[j].w), h);
      }
      // obramienie łuku (wysunięta opaska wzdłuż krzywej, normalna elipsy)
      const pts = [], ups = [];
      const ea = (wb - wa) / 2, eb = crown - ys;
      for (let j = 0; j <= m; j++) {
        const nv = F.dir(0, (P[j].y - ys) / (eb * eb), (P[j].w - wm) / (ea * ea)).normalize();
        pts.push(F.at(s * (hp + 0.00025), P[j].y, P[j].w).addScaledVector(nv, 0.0006));
        ups.push(nv);
      }
      sweep(pts, 0.00035, 0.0006, ups, (f) => (f === 'bottom' ? hot : st), (f, j) => (f === 'bottom' ? 0.14 + 0.5 * clamp01(1 - (P[j].y - lavaAt(P[j].w)) / 0.024) : 0), 0, false);
    }
    const toC = new V3();
    for (let j = 0; j < m; j++) {
      const a = F.at(-hp, P[j].y, P[j].w), bb = F.at(hp, P[j].y, P[j].w), c = F.at(hp, P[j + 1].y, P[j + 1].w), d = F.at(-hp, P[j + 1].y, P[j + 1].w);
      F.at(0, ys, wm, toC).sub(a.clone().add(c).multiplyScalar(0.5));
      const zj = (p) => {
        const first = p === a || p === bb;
        return 0.14 + 0.5 * clamp01(1 - ((first ? P[j].y : P[j + 1].y) - lavaAt(first ? P[j].w : P[j + 1].w)) / 0.024);
      };
      quad(hot, a, bb, c, d, toC, zj);
    }
  }
  // blok kotwiący na stopie ściany (część w ścianie) i pylony ze światłami
  const hk = Math.min(lavaAt(anchorW), deckBot - 0.004);
  const anchor = M.acc(PART.HULL, (seed + 0.5) % 1);
  prism(F, [[-hw - 0.0028, anchorW], [hw + 0.0028, anchorW], [hw + 0.0028, rf + 0.006], [-hw - 0.0028, rf + 0.006]],
    [{ v: hk - 0.008 }, { v: deckTop - 0.0008 }, { v: deckTop, s: [0.94, 0.93] }], anchor);
  for (const s of [-1, 1]) {
    box(F, s * (hw + 0.0012), rf - 0.009, 0.0014, 0.0032, deckTop, deckTop + 0.0075, anchor, 0, 0, 0.0005);
    box(F, s * (hw + 0.0012), rf - 0.009, 0.0006, 0.0006, deckTop + 0.0075, deckTop + 0.0087, M.acc(PART.BEACON, (seed * 3 + (s > 0 ? 0.3 : 0.7)) % 1), 0.6, 0);
  }
  // wiązka przewodów: z bramy po pokładzie do stopy ściany (boczne zbiegają się przy kotwie)
  const pr = L.corkPipeR;
  const yp = deckTop + pr;
  for (const o of [-0.0034, 0, 0.0034]) {
    const pts = [
      F.at(o, yp, R + 0.002), F.at(o, yp, r0 + 0.004), F.at(o, yp, lerp(r0, rf, 0.5)), F.at(o, yp, rf - 0.018),
      F.at(o * 0.55, yp, rf - 0.008), F.at(o * 0.12, lerp(yp, foot.y, 0.6), rf - 0.002)
    ];
    pts.push(foot.clone().addScaledVector(F.U, o * 0.05));
    pipe(M, pts, pr * (o === 0 ? 1.1 : 0.85), (idx * 0.37 + (o + 0.004) * 60) % 1);
  }
}

/** Przewód energii (PIPE) po punktach: uv.y 0 → 1 wzdłuż, z — długość drogi, w = +1 (impulsy od korka). */
function pipe(M, pts, r, seed) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const tube = new THREE.TubeGeometry(curve, Math.max(16, Math.ceil(len / 0.0018)), r, 8, false);
  appendGeometry(M.acc(PART.PIPE, seed), tube, len, 1, true);
}

/** Dopisuje geometrię three (pozycje, normalne, uv) do akumulatora; `swapUv` — uv.y = droga (TubeGeometry ma ją w u). */
function appendGeometry(A, g, z, w, swapUv = false) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const base = A.count;
  const p = new V3(), n = new V3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const u = uv.getX(i), v = uv.getY(i);
    A.vert(p, n, swapUv ? 0.25 : u, swapUv ? u : v, val(z, p), val(w, p));
  }
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) A.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
  else for (let i = 0; i < pos.count; i += 3) A.tri(base + i, base + i + 1, base + i + 2);
  g.dispose();
}

// ── Pokład górny: hale turbin, szyna zbiorcza, rozdzielnie, lądowiska, wieże kontroli ───────────────────────────────
function buildTopDeck(ctx) {
  const { L, M, rng } = ctx;
  const T = L.corkTopH, R = L.corkR, Mr = L.corkMidR;
  const nH = L.corkHalls;
  const rc = (R - 0.002 + Mr + 0.0015) / 2 - 0.0025;   // środek hal
  for (let i = 0; i < nH; i++) {
    const az = ((i + 0.5) / nH) * Math.PI * 2;
    buildHall(ctx, az, rc, i, rng);
  }
  // szyna zbiorcza: pierścień przewodu na krawędzi pokładu (impulsy wokół; długość — wielokrotność odstępu impulsów)
  const rb = R - 0.0032;
  const ring = new THREE.TorusGeometry(rb, 0.00085, 8, 288);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, T + 0.00095, 0);
  {
    const A = M.acc(PART.PIPE, 0.55);
    const pos = ring.attributes.position, nor = ring.attributes.normal;
    const base = A.count;
    const p = new V3(), n = new V3();
    const lenQ = Math.round((Math.PI * 2 * rb) / 0.03) * 0.03;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      // droga wzdłuż pierścienia z azymutu (ciągła na szwie: z jest wielokrotnością odstępu)
      let a = Math.atan2(-p.z, p.x) / (Math.PI * 2);
      if (a < 0) a += 1;
      A.vert(p, n, 0.25, a, lenQ, 1);
    }
    const idx = ring.index;
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
      // trójkąty na szwie azymutu dostają uv z drugiej strony — bez skoku (u → u + 1)
      const ua = A.uv[(base + ia) * 2 + 1], ub = A.uv[(base + ib) * 2 + 1], uc = A.uv[(base + ic) * 2 + 1];
      if (Math.max(ua, ub, uc) - Math.min(ua, ub, uc) > 0.5) {
        const fix = (j) => { const k = (base + j) * 2 + 1; return A.uv[k] < 0.5 ? A.vert(new V3(A.pos[(base + j) * 3], A.pos[(base + j) * 3 + 1], A.pos[(base + j) * 3 + 2]), new V3(A.nrm[(base + j) * 3], A.nrm[(base + j) * 3 + 1], A.nrm[(base + j) * 3 + 2]), 0.25, A.uv[k] + 1, lenQ, 1) : base + j; };
        A.tri(fix(ia), fix(ib), fix(ic));
      } else A.tri(base + ia, base + ib, base + ic);
    }
    ring.dispose();
  }
  // wsporniki szyny co 7,5°
  const st = M.acc(PART.STRUCT, 0.35);
  for (let k = 0; k < 48; k++) box(radialFrame((k / 48) * Math.PI * 2, 0, 0), 0, rb, 0.0004, 0.0012, T, T + 0.0006, st);
  // luki między halami (co 360° / nH): rozdzielnie przy mostach, lądowiska / wieże kontroli między mostami, drobne bryły
  for (let i = 0; i < nH; i++) {
    const az = (i / nH) * Math.PI * 2;
    const deg = Math.round(az / DEG);
    const isBridge = ctx.bridgeAz.some((a) => Math.abs(Math.atan2(Math.sin(az - a), Math.cos(az - a))) < 0.01);
    if (isBridge) buildSwitchyard(ctx, az, rc, i);
    else if (deg % 120 === 0) buildPad(ctx, az, rc + 0.001, i);
    else if (deg % 60 === 0) buildControlTower(ctx, az, rc, i);
    else scatter(ctx, az, rc, 0.0095, (3.0 * DEG), T, 5, i);
  }
  // drogi obwodowe pokładu: listwy ciepłe (pod progiem bloomu)
  stripRing(M, Mr + 0.0045, T, 0.0007, 0.15, 0, 144);
}

/** Pierścień listwy płasko na pokładzie (promień r, wysokość y, półszerokość hw). */
function stripRing(M, r, y, hw, z, w, n) {
  lathe([[r + hw, y + 0.00012], [r - hw, y + 0.00012]], [{ acc: M.acc(PART.STRIP, 0.15), z, w }], n);
}

/** Hala turbin: długi promienisty blok — cokół, pochyłe ściany z oknami, płaski dach z grzbietem świetlika (listwa chłodna) i wentylatorami. */
function buildHall(ctx, az, rc, i, rng) {
  const { L, M } = ctx;
  const T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const seed = (i * 0.0417 + 0.02) % 1;
  const hull = M.acc(PART.HULL, seed);
  const win = M.acc(PART.WINDOW, seed);
  const hl = 0.0105 + rng.range(-0.0006, 0.0006);  // pół długości
  const hu = 0.0047;
  const v0 = T, v1 = T + 0.0009, v2 = v1 + 0.0042 + rng.range(-0.0004, 0.0004);
  box(F, 0, rc, hu + 0.0011, hl + 0.0012, v0, v1, hull, 0, 0, 0.0003);
  // korpus: ściany pochyłe (brutalizm) — długie z oknami, czołowe — kadłub; dach płaski z fazą
  prism(F, [[-hu, rc - hl], [hu, rc - hl], [hu, rc + hl], [-hu, rc + hl]],
    [{ v: v1 }, { v: v2 - 0.0005, s: [0.88, 0.985] }],
    { side: (k, nu) => (Math.abs(nu) > 1e-6 ? win : hull), top: null, bottom: null }, 0.28 + rng.next() * 0.3);
  prism(F, [[-hu, rc - hl], [hu, rc - hl], [hu, rc + hl], [-hu, rc + hl]],
    [{ v: v2 - 0.0005, s: [0.88, 0.985] }, { v: v2, s: [0.84, 0.975] }], { side: hull, top: hull, bottom: null });
  // grzbiet świetlika: boki — listwa chłodna (energia), wierzch — kadłub
  box(F, 0, rc, 0.0011, hl * 0.84, v2, v2 + 0.0011, { side: M.acc(PART.STRIP, 0.4), top: hull, bottom: null }, 0.16, 1);
  box(F, 0, rc, 0.0013, hl * 0.86, v2 + 0.0011, v2 + 0.0015, hull, 0, 0, 0.0002);
  // wentylatory na dachu (naprzemiennie po bokach grzbietu)
  for (let k = 0; k < 4; k++) {
    const w = rc - hl * 0.66 + (hl * 1.32 * k) / 3;
    box(F, (k % 2 ? 1 : -1) * 0.0026, w, 0.0008, 0.0011, v2, v2 + 0.0007, hull, 0, 0, 0.0002);
  }
  // generator na końcu zewnętrznym (bęben wzdłuż promienia) i transformator na wewnętrznym
  cylinder(hull, F.at(0, v1 + 0.0024, rc + hl + 0.0002), F.at(0, v1 + 0.0024, rc + hl + 0.0021), 0.0024, 0.0021, 16, true);
  box(F, 0, rc - hl - 0.0024, 0.0028, 0.0013, v0, v1 + 0.0022, hull, 0, 0, 0.0004);
  box(F, 0, rc - hl - 0.0024, 0.0020, 0.0003, v1 + 0.0022, v1 + 0.0027, M.acc(PART.COIL, seed), rng.next(), 0.3);
}

/** Rozdzielnia nad bramą mostu: dwa rzędy izolatorów z akcentami COIL po bokach grobli przewodów, budynek łączy. */
function buildSwitchyard(ctx, az, rc, i) {
  const { L, M } = ctx;
  const T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const hull = M.acc(PART.HULL, 0.66);
  for (const u of [-0.0064, 0.0064]) {
    for (let k = 0; k < 4; k++) {
      const w = rc - 0.0085 + k * 0.0042;
      box(F, u, w, 0.0013, 0.0013, T, T + 0.0018, hull, 0, 0, 0.0003);
      box(F, u, w, 0.0003, 0.0003, T + 0.0018, T + 0.0040, M.acc(PART.STRUCT, 0.66));
      box(F, u, w, 0.0009, 0.0002, T + 0.0040, T + 0.0044, M.acc(PART.COIL, 0.66), (k * 0.25 + (u > 0 ? 0.12 : 0)) % 1, 0.3);
    }
  }
  box(F, 0.0062, rc + 0.0088, 0.0017, 0.0024, T, T + 0.0030, { side: M.acc(PART.WINDOW, 0.66), top: hull, bottom: null }, 0.6, 0, 0);
  box(F, 0.0062, rc + 0.0088, 0.0020, 0.0027, T + 0.0030, T + 0.0036, hull, 0, 0, 0.0004);
}

/**
 * Grobla energii (azymuty mostów): od podstawy zigguratu przez taras środkowy i pokład górny do bramy mostu — niski
 * nasyp z dwoma przewodami (PIPE: uv.y 0 akcelerator → 1 brama), schodzi uskokami tarasów. Z góry: 6 szprych koła.
 */
function buildCauseway(ctx, phi, idx) {
  const { L, M } = ctx;
  const F = radialFrame(phi, 0, 0);
  const R = L.corkR, T = L.corkTopH, Mr = L.corkMidR, Mh = L.corkMidH, Ir = L.corkInnerR, Ih = L.corkInnerH;
  const hull = M.acc(PART.HULL, 0.71);
  const hc = 0.0031, hh = 0.0011;
  // nasyp na każdym tarasie (ze ścięciem krawędzi) i port wyjścia z zigguratu
  box(F, 0, (Ir - 0.0042 + Ir) / 2, hc, 0.0021, Ih, Ih + hh, hull, 0, 0, 0.0003);
  box(F, 0, (Ir + Mr) / 2, hc, (Mr - Ir) / 2 - 0.0016, Mh, Mh + hh, hull, 0, 0, 0.0003);
  box(F, 0, (Mr + R - 0.003) / 2, hc, (R - 0.003 - Mr) / 2 - 0.0016, T, T + hh, hull, 0, 0, 0.0003);
  box(F, 0, Ir - 0.0047, hc + 0.0006, 0.0012, Ih, Ih + 0.0032, hull, 0, 0, 0.0004);
  // listwy chłodne wzdłuż nasypu (pod progiem) — szprychy czytelne z daleka
  for (const s of [-1, 1]) {
    box(F, s * (hc + 0.00025), (Ir + Mr) / 2, 0.00025, (Mr - Ir) / 2 - 0.002, Mh, Mh + 0.0007, M.acc(PART.STRIP, 0.71), 0.22, 1);
    box(F, s * (hc + 0.00025), (Mr + R - 0.003) / 2, 0.00025, (R - 0.003 - Mr) / 2 - 0.002, T, T + 0.0007, M.acc(PART.STRIP, 0.71), 0.22, 1);
  }
  // przewody: port → stopnie tarasów → dyspozytornia bramy
  const pr = 0.0006;
  const lift = hh + pr;
  for (const o of [-0.0014, 0.0014]) {
    const pts = [
      F.at(o, Ih + lift, Ir - 0.0045), F.at(o, Ih + lift, Ir - 0.0006), F.at(o, Mh + lift + 0.0016, Ir + 0.0022),
      F.at(o, Mh + lift, Ir + 0.006), F.at(o, Mh + lift, (Ir + Mr) / 2), F.at(o, Mh + lift, Mr - 0.0045),
      F.at(o, Mh + lift - 0.0006, Mr - 0.0004), F.at(o, T + lift + 0.0012, Mr + 0.0026), F.at(o, T + lift, Mr + 0.007),
      F.at(o, T + lift, (Mr + R) / 2), F.at(o, T + lift, R - 0.006), F.at(o, T + lift + 0.0016, R + 0.0002), F.at(o, T + 0.0028, R + 0.003)
    ];
    pipe(M, pts, pr, (idx * 0.19 + (o > 0 ? 0.5 : 0)) % 1);
  }
}

/** Lądowisko: ośmiokątna płyta z pierścieniem świateł pozycyjnych (białe) i listwą znaku. */
function buildPad(ctx, az, rc, i, T = ctx.L.corkTopH) {
  const { M } = ctx;
  const F = radialFrame(az, 0, 0);
  const hull = M.acc(PART.HULL, 0.82);
  const rP = 0.0058;
  prism(F, ngon(8, rP, rP).map(([u, w]) => [u, w + rc]), [{ v: T }, { v: T + 0.0007 }, { v: T + 0.0010, s: 0.94 }], hull);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    box(F, Math.cos(a) * rP * 0.84, rc + Math.sin(a) * rP * 0.84, 0.00035, 0.00035, T + 0.0010, T + 0.0015, M.acc(PART.BEACON, (k / 8 + i * 0.1) % 1), 0.8, 1);
  }
  // znak: pierścień listwy ciepłej na płycie
  const ring = [];
  const n = 24;
  for (let k = 0; k <= n; k++) ring.push((k / n) * Math.PI * 2);
  const S = M.acc(PART.STRIP, 0.82);
  for (let k = 0; k < n; k++) {
    const a = ring[k], c = ring[k + 1];
    const p = (r, t) => F.at(Math.cos(t) * r, T + 0.00105, rc + Math.sin(t) * r);
    quad(S, p(rP * 0.52, a), p(rP * 0.52, c), p(rP * 0.6, c), p(rP * 0.6, a), UP, 0.45, 0);
  }
}

/** Wieża kontroli: cokół, trzon, kopuła ze szkła, światło na szczycie. */
function buildControlTower(ctx, az, rc, i) {
  const { L, M } = ctx;
  const T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const hull = M.acc(PART.HULL, 0.9);
  box(F, 0, rc, 0.0042, 0.0042, T, T + 0.0016, { side: M.acc(PART.WINDOW, 0.9), top: hull, bottom: null }, 0.5, 0, 0);
  const c = F.at(0, 0, rc);
  cylinder(hull, new V3(c.x, T + 0.0016, c.z), new V3(c.x, T + 0.0118, c.z), 0.0018, 0.0014, 16, false);
  cylinder(M.acc(PART.GLASS, 0.9), new V3(c.x, T + 0.0118, c.z), new V3(c.x, T + 0.0142, c.z), 0.0029, 0.0029, 20, true);
  cylinder(hull, new V3(c.x, T + 0.0142, c.z), new V3(c.x, T + 0.0150, c.z), 0.0031, 0.0016, 20, true);
  box(F, 0, rc, 0.0005, 0.0005, T + 0.0150, T + 0.0160, M.acc(PART.BEACON, (i * 0.13) % 1), 0.55, 0);
}

/** Drobne bryły (ziarno): pudła różnych wysokości w wycinku (az ± da, rc ± dr) na wysokości y. */
function scatter(ctx, az, rc, dr, da, y, n, i, avoid = null) {
  const { M, rng } = ctx;
  for (let k = 0; k < n; k++) {
    const a = az + rng.range(-da, da);
    const r = rc + rng.range(-dr, dr);
    const hu = rng.range(0.0006, 0.0022), hw = rng.range(0.0006, 0.0024);
    if (avoid && avoid(a, r, Math.max(hu, hw))) continue;
    const F = radialFrame(a, 0, 0);
    const h = rng.range(0.0006, 0.0034);
    const s = rng.next();
    const acc = s < 0.18 ? { side: M.acc(PART.WINDOW, s), top: M.acc(PART.HULL, s), bottom: null } : M.acc(s < 0.75 ? PART.HULL : PART.STRUCT, s);
    box(F, 0, r, hu, hw, y, y + h, acc, 0.25 + s, 0, 0.00025);
    if (s > 0.94) box(F, 0, r, 0.0003, 0.0003, y + h, y + h + 0.0008, M.acc(PART.BEACON, s), 0.7, 0);
  }
}

// ── Taras środkowy: chłodnie, pola transformatorów, maszty ─────────────────────────────────────────────────────────
function buildMidTerrace(ctx) {
  const { L, M, rng } = ctx;
  const y = L.corkMidH;
  const towers = [];
  for (let i = 0; i < L.corkTowers; i++) {
    const az = (i / L.corkTowers) * Math.PI * 2;
    towers.push(polar(L.corkTowerRing, az, y));
    buildTower(ctx, towers[i], i, rng);
  }
  const avoid = (a, r, s) => {
    const p = polar(r, a, y);
    if (towers.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < L.corkTowerR + 0.0022 + s)) return true;
    // grobla energii w azymutach mostów
    if (ctx.bridgeAz.some((q) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))) * r < 0.0045 + s)) return true;
    return r < L.corkInnerR + 0.003 + s || r > L.corkMidR - 0.003 - s;
  };
  // pola transformatorów między chłodniami (siatka biegunowa, luki z ziarna)
  for (let i = 0; i < L.corkTowers; i++) {
    const az = ((i + 0.5) / L.corkTowers) * Math.PI * 2;
    // w dwóch wycinkach (naprzeciw siebie) — lądowisko na skraju tarasu zamiast zewnętrznych rzędów pola
    const pad = i % 4 === 1;
    if (pad) buildPad(ctx, az, L.corkMidR - 0.0125, i, y);
    for (let row = 0; row < (pad ? 3 : 5); row++) {
      const r = 0.0575 + row * 0.0066;
      for (let col = 0; col < 4; col++) {
        const off = (col - 1.5) * 0.0068;
        const a = az + off / r;
        if (avoid(a, r, 0.002) || rng.chance(0.14)) continue;
        const F = radialFrame(a, 0, 0);
        const s = rng.next();
        box(F, 0, r, 0.0014, 0.0019, y, y + 0.0017, M.acc(PART.HULL, s), 0, 0, 0.0003);
        box(F, 0, r, 0.0002, 0.0014, y + 0.0017, y + 0.0020, M.acc(PART.COIL, s), rng.next(), 0.12);
        for (const u of [-0.0009, 0.0009]) box(F, u, r - 0.0012, 0.00022, 0.00022, y + 0.0017, y + 0.0031, M.acc(PART.STRUCT, s));
      }
    }
    const pc = polar(L.corkMidR - 0.0125, az, y);
    scatter(ctx, az, 0.072, 0.02, 0.32, y, 6, i, (a, r, q) => avoid(a, r, q) || (pad && Math.hypot(r * Math.cos(a) - pc.x, -r * Math.sin(a) - pc.z) < 0.0078 + q));
  }
  // maszty ze światłami pozycyjnymi na zewnętrznym skraju tarasu
  for (let k = 0; k < 12; k++) {
    const az = ((k + 0.5) / 12) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const r = L.corkMidR - 0.0055;
    const F = radialFrame(az, 0, 0);
    const h = rng.range(0.010, 0.017);
    prism(F, ngon(4, 0.0005, 0.0005).map(([u, w]) => [u, w + r]), [{ v: y }, { v: y + h, s: 0.4 }], M.acc(PART.STRUCT, 0.25));
    box(F, 0, r, 0.0011, 0.0011, y, y + 0.0009, M.acc(PART.HULL, 0.25));
    box(F, 0, r, 0.00055, 0.00055, y + h, y + h + 0.001, M.acc(PART.BEACON, (k * 0.0833 + 0.04) % 1), rng.range(0.4, 0.7), k % 4 === 0 ? 1 : 0);
  }
  // droga obwodowa tarasu (listwa ciepła)
  stripRing(M, L.corkInnerR + 0.0045, y, 0.0007, 0.14, 0, 96);
}

/** Chłodnia hiperboloidalna: powłoka (na zewnątrz kadłub, w środku żar od dna), świecąca krawędź, nogi V, basen. */
function buildTower(ctx, c, i, rng) {
  const { L, M } = ctx;
  const H = L.corkTowerH * (1 + rng.range(-0.06, 0.06));
  const r0 = L.corkTowerR, rt = r0 * 0.68, ht = 0.74 * H;
  const cc = ht / Math.sqrt((r0 / rt) ** 2 - 1);
  const rOut = (h) => rt * Math.sqrt(1 + ((h - ht) / cc) ** 2);
  const th = 0.0007, hb = 0.0034;
  const prof = [];
  const segs = [];
  const n = 10;
  const hull = M.acc(PART.HULL, (i * 0.125 + 0.06) % 1);
  const hot = M.acc(PART.HOT, (i * 0.125 + 0.06) % 1);
  for (let k = 0; k <= n; k++) { const h = hb + ((H - hb) * k) / n; prof.push([rOut(h), h]); segs.push({ acc: hull, smooth: true }); }
  // krawędź (listwa ciepła), wnętrze w dół — żar rośnie ku dnu
  segs[n] = { acc: M.acc(PART.STRIP, 0.5), z: 0.75, w: 0, smooth: true };
  prof.push([rOut(H) - th, H]);
  for (let k = n; k >= 0; k--) {
    const h = hb + ((H - hb) * k) / n;
    prof.push([rOut(h) - th, h]);
    segs.push({ acc: hot, smooth: true, z: (r, yy) => 0.05 + 0.3 * clamp01(1 - (yy - hb) / (H - hb)) });
  }
  segs[segs.length - 1] = { acc: hull, smooth: true };
  prof.push([rOut(hb), hb]);
  segs.push(null);
  lathe(prof, segs, 40, { cx: c.x, cy: c.y, cz: c.z });
  // basen z żarem pod powłoką i stopa pierścieniowa
  lathe([[rOut(hb) - th, 0.0005], [0, 0.0005]], [{ acc: hot, z: 0.32, smooth: true }], 40, { cx: c.x, cy: c.y, cz: c.z });
  lathe([[r0 + 0.0012, 0], [r0 + 0.0012, 0.0004], [r0 - 0.0016, 0.0004]], [{ acc: hull }, { acc: hull }], 40, { cx: c.x, cy: c.y, cz: c.z });
  // nogi V pod powłoką
  const st = M.acc(PART.STRUCT, 0.2);
  const nl = 18;
  for (let k = 0; k < nl; k++) {
    const a = (k / nl) * Math.PI * 2;
    const top = new V3(c.x + Math.cos(a) * (r0 - th * 0.5), c.y + hb, c.z - Math.sin(a) * (r0 - th * 0.5));
    for (const s of [-1, 1]) {
      const a2 = a + s * (Math.PI / nl);
      const bot = new V3(c.x + Math.cos(a2) * r0, c.y + 0.0004, c.z - Math.sin(a2) * r0);
      cylinder(st, bot, top, 0.00028, 0.00028, 4, false);
    }
  }
}

// ── Akcelerator: pierścienie COIL na stopniach zigguratu, obejmy, emitery-zęby ─────────────────────────────────────
function buildAccelerator(ctx) {
  const { L, M, geo } = ctx;
  const hull = M.acc(PART.HULL, 0.97);
  const rt = 0.00095;
  geo.treads.forEach((t, k) => {
    // pierścień: rura COIL (faza rośnie ku górze — impuls wędruje do wylotu), obudowa pod spodem
    torus(M.acc(PART.COIL, 0.1 + k * 0.2), t.r, t.y + rt * 1.05, rt, 120, 10, {}, k * 0.18, 0.26 + k * 0.03);
    lathe([[t.r + rt * 1.4, t.y], [t.r + rt * 1.4, t.y + rt * 0.7], [t.r - rt * 1.4, t.y + rt * 0.7], [t.r - rt * 1.4, t.y]],
      [{ acc: hull }, { acc: hull }, { acc: hull }], 72);
    // obejmy co 15° (przesunięte per pierścień — rytm schodkowy)
    const nC = 24;
    for (let j = 0; j < nC; j++) {
      const az = ((j + k * 0.25) / nC) * Math.PI * 2;
      const F = radialFrame(az, 0, 0);
      prism(F, [[-0.00055, t.r - rt * 1.55], [0.00055, t.r - rt * 1.55], [0.00055, t.r + rt * 1.55], [-0.00055, t.r + rt * 1.55]],
        [{ v: t.y }, { v: t.y + rt * 2.2 }, { v: t.y + rt * 2.6, s: [1, 0.7] }], hull);
    }
  });
  // emitery-zęby nad wylotem w azymutach mostów: cokół na stopniu, zwężany ząb wygięty ku osi, czubek COIL
  const Cr = L.corkCraterR, Ah = L.apertureH;
  ctx.bridgeAz.forEach((az, i) => {
    const F = radialFrame(az, 0, 0);
    const toAxis = F.W.clone().negate();
    prism(F, [[-0.0032, Cr - 0.0006], [0.0032, Cr - 0.0006], [0.0032, Cr + 0.0058], [-0.0032, Cr + 0.0058]],
      [{ v: Ah - 0.0025 }, { v: Ah + 0.0022 }, { v: Ah + 0.0030, s: [0.8, 0.8] }], hull);
    const P0 = new V3(0, Ah + 0.0026, Cr + 0.0026), P1 = new V3(0, lerp(Ah, L.corkToothH, 0.62), Cr + 0.0048);
    const P2 = new V3(0, L.corkToothH, L.corkToothTipR);
    const m = 16;
    const pts = [], hw = [], hh = [], zs = [];
    for (let j = 0; j <= m; j++) {
      const t = j / m, s = 1 - t;
      const q = new V3().addScaledVector(P0, s * s).addScaledVector(P1, 2 * s * t).addScaledVector(P2, t * t);
      pts.push(F.at(0, q.y, q.z));
      hw.push(lerp(0.0024, 0.00065, t));
      hh.push(lerp(0.0017, 0.0005, t));
      zs.push(t * 0.85);
    }
    const coil = M.acc(PART.COIL, 0.4 + i * 0.09);
    // ściana ku osi — pas COIL (impuls wędruje w górę), pozostałe — kadłub
    sweep(pts, hw, hh, toAxis, (f) => (f === 'top' ? coil : hull), (f, j) => (f === 'top' ? zs[j] : 0), (f) => (f === 'top' ? 0.4 : 0));
    // obejmy wzdłuż zęba (rytm mechaniczny)
    for (const t of [0.24, 0.47, 0.7]) {
      const j = Math.round(t * m);
      const d = new V3().subVectors(pts[j + 1], pts[j - 1]).normalize();
      sweep([pts[j].clone().addScaledVector(d, -0.0006), pts[j].clone().addScaledVector(d, 0.0006)],
        hw[j] * 1.22 + 0.0002, hh[j] * 1.22 + 0.0002, toAxis, () => hull, 0, 0, true);
    }
    // czubek: kostka COIL na końcu
    const tip = pts[m].clone().addScaledVector(new V3().subVectors(pts[m], pts[m - 1]).normalize(), 0.0006);
    const Ft = frame(tip, F.U, UP.clone(), F.W);
    box(Ft, 0, 0, 0.0008, 0.0008, -0.0008, 0.0008, M.acc(PART.COIL, 0.95), 0.9, 1.2);
  });
}
