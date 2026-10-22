// Elektrownia „KOREK” — ODBIORNIK NA ORBICIE (1,075 R od środka Ziemi, na osi gryzu, pod wewnętrzną krawędzią ringu
// „Halo”): odbiera promień z korka, magazynuje energię i oddaje ją promieniem przekaźnikowym do ringu. Windy idą do RINGU
// PLANETARNEGO, nie tu — odbiornik nie ma doków lin.
//   • PIERŚCIEŃ-STACJA: moduły z łącznikami i kołnierzami — węzły przy szprychach (większe, blok węzła, kopuła, chłodne
//     belki świateł, białe stroboskopy), przemysłowe pod radiatorami (zbiorniki, chłodna listwa) i mieszkalne (pasy okien,
//     świetliki, ciepła listwa); lampy pokładu, światła pozycyjne, szyna energii (fala dookoła pierścienia).
//   • CZASZA ZBIERAJĄCA pod środkiem (zwrócona w dół): płatki szkła, żebra, pierścienie cewek, ognisko w końcu promienia.
//   • SZPRYCHY: kratownice rdzeń → węzeł z przewodami energii w osi; w połowie — MAGAZYN (stosy ogniw, cewki w = −1).
//   • RADIATORY: cienkie panele promieniste (krawędzią do osi), żar u nasady.
//   • NADAJNIK na osi w punkcie wyjścia promienia przekaźnikowego (`hubCenterObject`): kryształ w sferze armilarnej
//     cewek i dwóch pierścieniach gimbala (w sferze mieści się kula ładowania promienia), maszt z odciągami.
// Z góry (oś gryzu) odbiornik wisi nad korkiem i go nie zasłania: otwarty pierścień, cienkie kratownice i radiatory
// krawędzią do widza, czasza ≤ 0,025 R; z daleka — jasny pierścień z punktami (listwy, lampy, belki węzłów, szyna).
// Symetria szprych 6-krotna, moduły z odmianą (ziarno `hubSeed`).
// Geometria CPU w ramie elektrowni (earthBitePlantFrame.js) budowana względem środka odbiornika i na końcu przesunięta
// o hubHeight; części z rodzajem powierzchni (PART): bryły — materiał metalu, przewody — przepływu.
// uv części ze `sweep` / `lathe`: u — droga po obwodzie [R], v — droga po przekroju [R].
import * as THREE from 'three/webgpu';
import { PART, finalizePart, hubHeight, plantRng } from './earthBitePlantFrame.js';

const TAU = Math.PI * 2;
/** Koniec promienia głównego względem środka odbiornika (earthBitePlantBeam.js: hubHeight − 0,01). */
const BEAM_END = -0.01;

/** Wymiary odbiornika (R Ziemi). hubRadius (od środka Ziemi), hubRing (promień pierścienia) — w PLANT_LAYOUT. */
export const HUB_DEFAULTS = Object.freeze({
  hubModules: 24,      // moduły pierścienia (24–36): węzły przy szprychach, przemysłowe pod radiatorami, mieszkalne
  hubGap: 0.14,        // ułamek podziałki modułu na łącznik
  hubTubeW: 0.0056,    // pół-szerokość kadłuba modułu (promieniowo)
  hubTubeH: 0.0034,    // pół-wysokość kadłuba modułu (bez grzbietu i stępki)
  hubSpokes: 6,        // kratownice do rdzenia, w połowie każdej — stos ogniw magazynu
  hubBankRing: 0.026,  // magazyn: odległość stosów ogniw od osi
  hubRadiators: 12,    // radiatory promieniste na zewnątrz pierścienia
  hubRadLen: 0.032,    // długość radiatora
  hubDishR: 0.0205,    // promień czaszy zbierającej (≤ 0,025 — z góry nie zasłania korka)
  hubDishDepth: 0.005, // głębokość czaszy
  hubSeed: 4127        // ziarno odmian modułów (wyposażenie, anteny, gęstość okien)
});

// ── Budowa siatek: bufor części (pozycje, normalne, uv, indeks; z per wierzchołek) ────────────────────────────────
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const Y_UP = new THREE.Vector3(0, 1, 0);
const X_AX = new THREE.Vector3(1, 0, 0);
/** Znacznik: parametr z części per wierzchołek (z kanału `zs` bufora). */
const PER_VERTEX = 'v';

class PartBuf {
  constructor() {
    this.p = []; this.n = []; this.t = []; this.i = []; this.zs = [];
    this.cur = 0;      // bieżące z wierzchołka (PER_VERTEX)
    this.zAt = null;   // z(kąt) dla `sweep` (faza wzdłuż obwodu)
  }

  get count() { return this.p.length / 3; }

  v(x, y, z, nx, ny, nz, u = 0, w = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.t.push(u, w); this.zs.push(this.cur);
    return this.p.length / 3 - 1;
  }

  /** Czworokąt a-b-c-d (obwód); strona przednia — po stronie normalnych wierzchołków (nawinięcie dobiera się samo). */
  quad(a, b, c, d) {
    if (this._back(a, b, c, d)) this.i.push(a, d, c, a, c, b);
    else this.i.push(a, b, c, a, c, d);
  }

  tri(a, b, c) {
    if (this._back(a, b, c, c)) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }

  // normalna geometryczna (iloczyn przekątnych) przeciw sumie normalnych wierzchołków
  _back(a, b, c, d) {
    const P = this.p, N = this.n;
    const ux = P[c * 3] - P[a * 3], uy = P[c * 3 + 1] - P[a * 3 + 1], uz = P[c * 3 + 2] - P[a * 3 + 2];
    const vx = P[d * 3] - P[b * 3], vy = P[d * 3 + 1] - P[b * 3 + 1], vz = P[d * 3 + 2] - P[b * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const sx = N[a * 3] + N[b * 3] + N[c * 3] + N[d * 3];
    const sy = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1] + N[d * 3 + 1];
    const sz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2] + N[d * 3 + 2];
    return gx * sx + gy * sy + gz * sz < 0;
  }

  /** Dokleja geometrię three (z indeksem albo bez) przekształconą macierzą `m` (wyznacznik > 0). */
  add(g, m = null) {
    const base = this.count;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    if (m) _nm.getNormalMatrix(m);
    for (let k = 0; k < pos.count; k++) {
      _p.fromBufferAttribute(pos, k);
      _n.fromBufferAttribute(nor, k);
      if (m) { _p.applyMatrix4(m); _n.applyMatrix3(_nm).normalize(); }
      this.v(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    g.dispose();
    return this;
  }

  /** Przekształca wierzchołki od `start` macierzą `m` (pozycje i normalne). */
  transformFrom(start, m) {
    _nm.getNormalMatrix(m);
    const P = this.p, N = this.n;
    for (let k = start; k < this.count; k++) {
      _p.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]).applyMatrix4(m);
      _n.set(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]).applyMatrix3(_nm).normalize();
      P[k * 3] = _p.x; P[k * 3 + 1] = _p.y; P[k * 3 + 2] = _p.z;
      N[k * 3] = _n.x; N[k * 3 + 1] = _n.y; N[k * 3 + 2] = _n.z;
    }
    return this;
  }

  geometry(dy = 0) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(this.p);
    for (let k = 1; k < p.length; k += 3) p[k] += dy;
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.t), 2));
    g.setIndex(this.i);
    return g;
  }
}

/** Rejestr części jednego materiału: `part(rodzaj, ziarno, z, w)` → bufor; `finish(dy)` → części po finalizePart. */
function partList() {
  const list = [];
  return {
    part(kind, seed = 0, z = 0, w = 0) {
      const b = new PartBuf();
      list.push({ b, kind, seed, z, w });
      return b;
    },
    finish(dy) {
      return list.filter((e) => e.b.i.length > 0).map((e) => {
        const z = e.z === PER_VERTEX ? (i) => e.b.zs[i] : e.z;
        return finalizePart(e.b.geometry(dy), e.kind, e.seed, z, e.w);
      });
    }
  };
}

// ── Prymitywy ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Przekrój (dr, dy) obiegany wokół osi Y od kąta a0 do a1 w odległości r0 (kąt φ: x = cos φ, z = −sin φ — jak rama).
 * Każda krawędź przekroju to osobny pas (twarde krawędzie), po obwodzie gładko. Przekrój przeciwnie do wskazówek zegara
 * (r w prawo, y w górę) → normalne na zewnątrz; `closed` — także krawędź ostatni → pierwszy.
 */
function sweep(B, prof, r0, a0, a1, seg, closed = true, y0 = 0) {
  const m = prof.length;
  const ne = closed ? m : m - 1;
  let vAcc = 0;
  for (let k = 0; k < ne; k++) {
    const [r1, y1] = prof[k];
    const [r2, y2] = prof[(k + 1) % m];
    const tx = r2 - r1, ty = y2 - y1;
    const len = Math.sqrt(tx * tx + ty * ty);
    if (len < 1e-9) continue;
    const nr = ty / len, ny = -tx / len;
    const base = B.count;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (a1 - a0) * (j / seg);
      const c = Math.cos(a), s = Math.sin(a);
      if (B.zAt) B.cur = B.zAt(a);
      B.v((r0 + r1) * c, y0 + y1, -(r0 + r1) * s, nr * c, ny, -nr * s, r0 * a, vAcc);
      B.v((r0 + r2) * c, y0 + y2, -(r0 + r2) * s, nr * c, ny, -nr * s, r0 * a, vAcc + len);
    }
    for (let j = 0; j < seg; j++) {
      const q = base + j * 2;
      B.quad(q, q + 1, q + 3, q + 2);
    }
    vAcc += len;
  }
}

/** Wieczko przekroju `sweep` w kącie a (wachlarz ze środka — przekrój wypukły); dir +1 — w stronę rosnącego kąta. */
function sweepCap(B, prof, r0, a, dir, y0 = 0) {
  const c = Math.cos(a), s = Math.sin(a);
  const nx = -s * dir, nz = -c * dir;
  let cr = 0, cy = 0;
  for (const [r, y] of prof) { cr += r; cy += y; }
  cr /= prof.length; cy /= prof.length;
  const ctr = B.v((r0 + cr) * c, y0 + cy, -(r0 + cr) * s, nx, 0, nz, 0, 0);
  const base = B.count;
  for (const [r, y] of prof) B.v((r0 + r) * c, y0 + y, -(r0 + r) * s, nx, 0, nz, r, y);
  for (let k = 0; k < prof.length; k++) B.tri(ctr, base + k, base + ((k + 1) % prof.length));
}

/** Gładka powierzchnia obrotowa: punkty (r, y) i normalne (nr, ny) przekroju, od kąta a0 do a1. */
function lathe(B, pts, nrm, a0, a1, seg) {
  const base = B.count;
  const m = pts.length;
  for (let j = 0; j <= seg; j++) {
    const a = a0 + (a1 - a0) * (j / seg);
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < m; k++) {
      const [r, y] = pts[k];
      const [nr, ny] = nrm[k];
      B.v(r * c, y, -r * s, nr * c, ny, -nr * s, r * a, k / (m - 1));
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let k = 0; k < m - 1; k++) {
      const q = base + j * m + k;
      B.quad(q, q + 1, q + m + 1, q + m);
    }
  }
}

const _bd = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _bu = new THREE.Vector3();
const _bc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
/** Belka P → Q o przekroju w × h (h wzdłuż `up` rzutowanego ⟂ osi belki): 4 ściany i wieczka. */
function bar(B, P, Q, w, h, up = Y_UP, caps = true) {
  _bd.subVectors(Q, P);
  const len = _bd.length();
  if (len < 1e-9) return;
  _bd.divideScalar(len);
  _bs.crossVectors(_bd, up);
  if (_bs.lengthSq() < 1e-8) _bs.crossVectors(_bd, X_AX);
  _bs.normalize();
  _bu.crossVectors(_bs, _bd);
  const hw = w / 2, hh = h / 2;
  _bc[0].copy(_bs).multiplyScalar(hw).addScaledVector(_bu, hh);
  _bc[1].copy(_bs).multiplyScalar(-hw).addScaledVector(_bu, hh);
  _bc[2].copy(_bs).multiplyScalar(-hw).addScaledVector(_bu, -hh);
  _bc[3].copy(_bs).multiplyScalar(hw).addScaledVector(_bu, -hh);
  for (let f = 0; f < 4; f++) {
    const ca = _bc[f], cb = _bc[(f + 1) % 4];
    _n.addVectors(ca, cb).normalize();
    const a = B.v(P.x + ca.x, P.y + ca.y, P.z + ca.z, _n.x, _n.y, _n.z, 0, f);
    const b = B.v(P.x + cb.x, P.y + cb.y, P.z + cb.z, _n.x, _n.y, _n.z, 0, f + 1);
    const c = B.v(Q.x + cb.x, Q.y + cb.y, Q.z + cb.z, _n.x, _n.y, _n.z, len, f + 1);
    const d = B.v(Q.x + ca.x, Q.y + ca.y, Q.z + ca.z, _n.x, _n.y, _n.z, len, f);
    B.quad(a, b, c, d);
  }
  if (!caps) return;
  for (const [E, sg] of [[P, -1], [Q, 1]]) {
    const q = [];
    for (let f = 0; f < 4; f++) q.push(B.v(E.x + _bc[f].x, E.y + _bc[f].y, E.z + _bc[f].z, _bd.x * sg, _bd.y * sg, _bd.z * sg));
    B.quad(q[0], q[1], q[2], q[3]);
  }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
/** Punkt w odległości r od osi, w azymucie a, na wysokości y (rama: x = cos a, z = −sin a). */
const polar = (r, a, y) => v3(r * Math.cos(a), y, -r * Math.sin(a));
/** Macierz: obrót wokół osi Y o azymut a (lokalne +X → kierunek promieniowy a) i przesunięcie. */
function radial(a, x = 0, y = 0, z = 0) {
  return new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
}

/** Światło pozycyjne (ośmiościan) w punkcie P. */
function beacon(B, P, r = 0.00055) {
  const g = new THREE.OctahedronGeometry(r, 0);
  B.add(g, new THREE.Matrix4().makeTranslation(P.x, P.y, P.z));
}

// ── Przekroje modułu pierścienia ───────────────────────────────────────────────────────────────────────────────────
/** Kadłub modułu: korpus ze ściętymi krawędziami, grzbiet (pokład) u góry, stępka u dołu. */
function habShape(W, H) {
  const c = H * 0.32, dw = W * 0.42, dh = H * 0.3, kw = W * 0.3, kh = H * 0.26;
  return {
    c, dw, dh, kw, kh,
    prof: [
      [W, -H + c], [W, H - c], [W - c, H], [dw + dh, H], [dw, H + dh], [-dw, H + dh], [-dw - dh, H], [-W + c, H],
      [-W, H - c], [-W, -H + c], [-W + c, -H], [-kw - kh, -H], [-kw, -H - kh], [kw, -H - kh], [kw + kh, -H], [W - c, -H]
    ]
  };
}

/** Ośmiokąt (pół-szerokość w, góra yt, dół yb, ścięcie c). */
function octagon(w, yt, yb, c) {
  return [[w, yb + c], [w, yt - c], [w - c, yt], [-w + c, yt], [-w, yt - c], [-w, yb + c], [-w + c, yb], [w - c, yb]];
}

const EPS = 0.00008;   // odsunięcie nakładek (okna, listwy, cewki) od kadłuba
const BANK_R = 0.004;  // promień ogniw magazynu

// ── Pierścień: moduły, łączniki, kołnierze, okna, listwy, światła, szyna energii ───────────────────────────────────
// Rodzaje modułów: WĘZŁY (przy szprychach — większe, blok węzła ku osi, kopuła, białe stroboskopy), PRZEMYSŁOWE (pod
// radiatorami — zbiorniki na barkach, chłodna listwa, mało okien) i MIESZKALNE (pasy okien, świetliki, ciepła listwa).
function buildRing(M, L, rng, nodes, radMods) {
  const n = L.hubModules;
  const R0 = L.hubRing;
  const pitch = TAU / n;
  const span = pitch * (1 - L.hubGap);
  const cs = 0.0007 / R0;   // kąt kołnierza (łuk ~0,0007 R)
  const e = EPS;
  for (let i = 0; i < n; i++) {
    const node = nodes.has(i);
    const ind = !node && radMods.has(i);
    const ac = i * pitch, a0 = ac - span / 2, a1 = ac + span / 2;
    const W = L.hubTubeW * (node ? 1.22 : 1), H = L.hubTubeH * (node ? 1.25 : 1);
    const S = habShape(W, H);
    const seed = rng.next();
    const hull = M.part(PART.HULL, seed);
    sweep(hull, S.prof, R0, a0 + cs * 0.5, a1 - cs * 0.5, 12);
    // łącznik do następnego modułu (węższa rura ciśnieniowa)
    const Wk = L.hubTubeW * 0.45, Hk = L.hubTubeH * 0.55;
    sweep(hull, octagon(Wk, Hk, -Hk, Hk * 0.3), R0, a1 - cs, a1 + (pitch - span) + cs, 3);
    // kołnierze na końcach modułu (stal, zamknięte wieczkami)
    const col = M.part(PART.STRUCT, seed);
    const cp = octagon(W * 1.05, (H + S.dh) * 1.05, -(H + S.kh) * 1.05, H * 0.3);
    for (const [c0, c1] of [[a0 - cs * 0.1, a0 + cs], [a1 - cs, a1 + cs * 0.1]]) {
      sweep(col, cp, R0, c0, c1, 1);
      sweepCap(col, cp, R0, c0, -1);
      sweepCap(col, cp, R0, c1, 1);
    }
    // pasy okien (rzędy okien rysuje materiał): zewnętrzne, wewnętrzne, świetliki na barkach pokładu
    const wa0 = a0 + cs * 1.6, wa1 = a1 - cs * 1.6;
    const dens = ind ? 0.15 : (node ? 0.45 : 0.55 + rng.next() * 0.3);
    const win = M.part(PART.WINDOW, seed, dens);
    const sh0 = S.dw + S.dh + 0.0004, sh1 = W - S.c - 0.0003;
    const bands = ind
      ? [[[W + e, H * 0.1], [W + e, H * 0.45]], [[-W - e, H * 0.5], [-W - e, H * 0.08]]]
      : [[[W + e, H * 0.08], [W + e, H * 0.56]], [[W + e, -H * 0.56], [W + e, -H * 0.08]], [[-W - e, H * 0.5], [-W - e, H * 0.06]]];
    if (!ind && !node) bands.push([[sh1, H + e], [sh0, H + e]], [[-sh0, H + e], [-sh1, H + e]]);
    for (const band of bands) sweep(win, band, R0, wa0, wa1, 8, false);
    // spód (widok od korka): rzadkie okna na barkach stępki
    if (!ind && !node) {
      const k0 = S.kw + S.kh + 0.0004, k1 = W - S.c - 0.0004;
      const under = M.part(PART.WINDOW, seed, 0.3);
      for (const band of [[[-k1, -H - e], [-k0, -H - e]], [[k0, -H - e], [k1, -H - e]]]) sweep(under, band, R0, wa0, wa1, 8, false);
    }
    // listwa grzbietu: ciepła (mieszkalne), chłodna (przemysłowe) — z daleka przerywany jasny pierścień
    const strip = M.part(PART.STRIP, seed, ind ? 0.5 : 0.6, ind ? 1 : 0);
    sweep(strip, [[S.dw * 0.38, H + S.dh + e], [-S.dw * 0.38, H + S.dh + e]], R0, wa0, wa1, 8, false);
    // lampy pokładu na końcach modułu (małe, jasne — z daleka punkty pierścienia); w węzłach — chłodne belki świateł
    // w poprzek pokładu (z daleka jaśniejsze punkty w osiach szprych)
    const lamp = M.part(PART.STRIP, seed, node ? 1.6 : 2.2, node ? 1 : 0);
    const lw = node ? S.dw * 0.85 : 0.00036, ll = (node ? 0.00028 : 0.00036) / R0;
    const yd = H + S.dh;
    const lp = [[lw, yd], [lw, yd + 0.00022], [-lw, yd + 0.00022], [-lw, yd]];
    for (const am of [a0 + cs * 2.4, a1 - cs * 2.4]) {
      sweep(lamp, lp, R0, am - ll, am + ll, 1);
      sweepCap(lamp, lp, R0, am - ll, -1);
      sweepCap(lamp, lp, R0, am + ll, 1);
    }
    // światło pozycyjne na ściętej krawędzi (czerwone naprzemiennie; białe stroboskopy na węzłach)
    const bc = M.part(PART.BEACON, node ? 0 : (i % 2) * 0.5, node ? 1.1 : 0.5, node ? 1 : 0);
    const br = R0 + W - S.c * 0.5 + 0.0003, by = H - S.c * 0.5 + 0.0003;
    beacon(bc, polar(br, a1 - cs * 2.5, by), node ? 0.0008 : 0.00055);
    if (node) beacon(bc, polar(br, a0 + cs * 2.5, by), 0.0008);
    if (node) beacon(M.part(PART.BEACON, 0.5, 0.5, 0), polar(R0, ac, -H - S.kh - 0.0004), 0.0006);
    if (ind) {
      // zbiorniki chłodziwa na barkach i rura zbiorcza
      for (const side of [-1, 1]) {
        const rr = R0 + side * (W - S.c - 0.0011);
        for (const f of [-0.27, 0.27]) {
          const tank = new THREE.CylinderGeometry(0.00085, 0.00085, span * R0 * 0.36, 16, 1, false);
          tank.rotateX(Math.PI / 2);
          hull.add(tank, radial(ac + f * span, rr, H + 0.00085, 0));
        }
      }
      bar(M.part(PART.STRUCT, seed), polar(R0, a0 + cs * 2, H + S.dh + 0.0003), polar(R0, a1 - cs * 2, H + S.dh + 0.0003), 0.0005, 0.0005);
    } else if (!node) {
      // wyposażenie na barkach (skrzynie), czasem maszt anteny — złamanie symetrii
      const nb = rng.int(3);
      for (let k = 0; k < nb; k++) {
        const side = rng.sign();
        const a = a0 + cs * 3 + rng.next() * (span - cs * 6);
        const sr = 0.0010 + rng.next() * 0.0006, sy = 0.0005 + rng.next() * 0.0006, st = 0.0010 + rng.next() * 0.0016;
        const rr = side * (W - S.c - sr / 2 - 0.0002);
        hull.add(new THREE.BoxGeometry(sr, sy, st), radial(a, R0 + rr, H + sy / 2, 0));
      }
      if (rng.chance(0.3)) {
        const a = ac + (rng.next() - 0.5) * span * 0.5;
        const P = polar(R0 + S.dw * 0.7, a, H + S.dh);
        const Q = polar(R0 + S.dw * 0.7, a, H + S.dh + 0.0026 + rng.next() * 0.0014);
        bar(M.part(PART.STRUCT, seed), P, Q, 0.00028, 0.00028, X_AX);
        beacon(M.part(PART.BEACON, rng.next(), 0.3, 1), Q, 0.00035);
      }
    }
    if (node) {
      // blok węzła szprychy (ku osi) i kopuła obserwacyjna na pokładzie
      hull.add(new THREE.BoxGeometry(0.0038, H * 1.7, 0.0064), radial(ac, R0 - W - 0.0013, 0, 0));
      const dome = new THREE.SphereGeometry(0.0017, 20, 8, 0, TAU, 0, Math.PI / 2);
      M.part(PART.GLASS, seed).add(dome, radial(ac, R0, H + S.dh, 0));
      const ring = new THREE.TorusGeometry(0.0018, 0.00022, 4, 24);
      ring.rotateX(Math.PI / 2);
      M.part(PART.STRUCT, seed).add(ring, radial(ac, R0, H + S.dh + 0.0001, 0));
    }
  }
  // szyna energii na wewnętrznym skosie pokładu (widać ją z góry; cewka: fala biegnie dookoła pierścienia, w węzłach
  // chowa się w większym kadłubie)
  const bus = M.part(PART.COIL, 0.37, PER_VERTEX, 0.45);
  bus.zAt = (a) => a / TAU;
  const S0 = habShape(L.hubTubeW, L.hubTubeH);
  const mr = -L.hubTubeW + S0.c / 2, my = L.hubTubeH - S0.c / 2;
  const tr = -Math.SQRT1_2, ty = -Math.SQRT1_2, nr = -Math.SQRT1_2, ny = Math.SQRT1_2;
  const ba = 0.00048, bh = 0.00034;
  const P1 = [mr - tr * ba, my - ty * ba], P2 = [mr + tr * ba, my + ty * ba];
  sweep(bus, [P1, [P1[0] + nr * bh, P1[1] + ny * bh], [P2[0] + nr * bh, P2[1] + ny * bh], P2], R0, 0, TAU, 288);
  // wsporniki szyny nad łącznikami (szyna przechodzi nad przerwą między modułami)
  const brk = M.part(PART.STRUCT, 0.52);
  const Wk = L.hubTubeW * 0.45, Hk = L.hubTubeH * 0.55;
  for (let i = 0; i < n; i++) {
    const ag = (i + 0.5) * pitch;
    bar(brk, polar(R0 + mr + nr * bh * 0.5, ag, my + ny * bh * 0.5), polar(R0 - Wk * 0.6, ag, Hk * 0.8), 0.0003, 0.0003);
  }
}

// ── Rdzeń: kołnierz szprych, kołyska, szyja, nadajnik (kula-gimbal z pierścieniami cewek), maszt ───────────────────
function buildCore(M, L, spokeAz, guyAz) {
  const hull = M.part(PART.HULL, 0.11);
  // kołnierz rdzenia: tu dochodzą szprychy
  const cIn = 0.008, cOut = 0.0128, cBot = -0.0036, cTop = 0.0016, ch = 0.0008;
  sweep(hull, [[cIn, cBot], [cOut - ch, cBot], [cOut, cBot + ch], [cOut, cTop - ch], [cOut - ch, cTop], [cIn, cTop]], 0, 0, TAU, 72);
  const cb = M.part(PART.COIL, 0.2, 0.0, 0.3);
  sweep(cb, [[cOut + EPS, -0.0013], [cOut + EPS, -0.0007]], 0, 0, TAU, 72, false);
  sweep(cb, [[cOut - ch - 0.0006, cTop + EPS], [cOut - ch - 0.0011, cTop + EPS]], 0, 0, TAU, 72, false);
  for (const a of spokeAz) hull.add(new THREE.BoxGeometry(0.0016, 0.0036, 0.0038), radial(a, cOut + 0.0004, -0.001, 0));
  // kołyska pod kulą i szyja do grzbietu czaszy
  sweep(hull, [[0.0030, -0.0068], [0.0050, -0.0063], [0.0068, -0.0053], [cIn, -0.0043], [cIn, cBot],
    [0.0066, -0.0045], [0.0047, -0.0053], [0.0030, -0.0057]], 0, 0, TAU, 48);
  hull.add(new THREE.CylinderGeometry(0.0030, 0.0034, 0.0018, 24, 1, false), new THREE.Matrix4().makeTranslation(0, -0.0068, 0));
  // NADAJNIK: kryształ emitera (ciemne szkło) w sferze armilarnej cewek, w dwóch pierścieniach gimbala; w sferze
  // (r < 0,0039) mieści się kula ładowania promienia (earthBitePlantBeam.js), promień przekaźnikowy wychodzi ze środka
  M.part(PART.GLASS, 0.31).add(new THREE.SphereGeometry(0.0024, 32, 16));
  const cage = M.part(PART.STRUCT, 0.33);
  // oprawy kryształu (bieguny; dolna obrócona o π wokół X — bez odbicia, które odwróciłoby nawinięcie)
  for (const sg of [-1, 1]) {
    const m = new THREE.Matrix4().makeTranslation(0, sg * 0.0029, 0).multiply(new THREE.Matrix4().makeRotationX(sg > 0 ? 0 : Math.PI));
    cage.add(new THREE.CylinderGeometry(0.0007, 0.0011, 0.0012, 16, 1, false), m);
  }
  [[Math.PI / 2, 0], [0, 0], [0, Math.PI / 2]].forEach(([rx, ry], k) => {
    const t = new THREE.TorusGeometry(0.0039, 0.0002, 6, 64);
    t.rotateX(rx);
    t.rotateY(ry);
    M.part(PART.COIL, 0.5 + k * 0.1, k / 3, 0.55).add(t);
  });
  const st = M.part(PART.STRUCT, 0.41);
  const alpha = 25 * Math.PI / 180, beta = 35 * Math.PI / 180;
  const rect = (w, h) => [[-w, -h], [w, -h], [w, h], [-w, h]];
  const outer = new THREE.Matrix4().makeRotationX(alpha);
  const inner = new THREE.Matrix4().makeRotationX(alpha).multiply(new THREE.Matrix4().makeRotationZ(beta));
  let s0 = st.count;
  sweep(st, rect(0.00038, 0.00055), 0.006, 0, TAU, 64);
  st.transformFrom(s0, outer);
  s0 = st.count;
  sweep(st, rect(0.00032, 0.00045), 0.0049, 0, TAU, 64);
  st.transformFrom(s0, inner);
  // czopy: wewnętrzny pierścień na zewnętrznym (oś Z'), zewnętrzny na jarzmie (oś X)
  const zA = v3(0, -Math.sin(alpha), Math.cos(alpha));
  // wsporniki kryształu w wewnętrznym pierścieniu (prostopadle do jego osi obrotu)
  const xI = v3(Math.cos(beta), Math.sin(beta) * Math.cos(alpha), Math.sin(beta) * Math.sin(alpha));
  for (const sg of [-1, 1]) bar(st, xI.clone().multiplyScalar(sg * 0.0022), xI.clone().multiplyScalar(sg * 0.0047), 0.0004, 0.0004);
  for (const sg of [-1, 1]) {
    bar(st, zA.clone().multiplyScalar(sg * 0.0046), zA.clone().multiplyScalar(sg * 0.0063), 0.0005, 0.0005, X_AX);
    bar(st, v3(sg * 0.0057, 0, 0), v3(sg * 0.0068, 0, 0), 0.0007, 0.0007);
    bar(st, v3(sg * 0.0066, -0.0002, 0), v3(sg * (cIn + 0.0003), -0.0014, 0), 0.0012, 0.0009);
  }
  // maszt nad kulą ze światłem i odciągi do modułów przemysłowych (koło szprychowe z góry, namiot z boku)
  bar(st, v3(0, 0.0034, 0), v3(0, 0.0088, 0), 0.0004, 0.0004, X_AX);
  bar(st, v3(-0.0012, 0.0074, 0), v3(0.0012, 0.0074, 0), 0.00025, 0.00025);
  st.add(new THREE.CylinderGeometry(0.0007, 0.0007, 0.0004, 16, 1, false), new THREE.Matrix4().makeTranslation(0, 0.0074, 0));
  beacon(M.part(PART.BEACON, 0.13, 0.8, 1), v3(0, 0.0091, 0), 0.0006);
  const S0 = habShape(L.hubTubeW, L.hubTubeH);
  for (const a of guyAz) bar(st, polar(0.0006, a, 0.0074), polar(L.hubRing - S0.dw * 0.6, a, L.hubTubeH + S0.dh), 0.00018, 0.00018);
}

// ── Czasza zbierająca: płatki szkła, żebra, cewki, obrzeże, grzbiet, ognisko w końcu promienia ────────────────────
function buildDish(M, F, L, spokeAz) {
  const Rd = L.hubDishR, D = L.hubDishDepth, yV = -0.008;
  const surf = (r) => yV - D * (r / Rd) * (r / Rd);
  const grad = (r) => 2 * D * r / (Rd * Rd);
  const nIn = (r) => { const g = grad(r), l = Math.sqrt(g * g + 1); return [-g / l, -1 / l]; };
  const nOut = (r) => { const g = grad(r), l = Math.sqrt(g * g + 1); return [g / l, 1 / l]; };
  const rA = 0.0044, rB = Rd - 0.0008;
  // płatki (szkło) między żebrami
  const petals = 16, gap = 0.014;
  for (let p = 0; p < petals; p++) {
    const a0 = (p / petals) * TAU + gap / 2, a1 = ((p + 1) / petals) * TAU - gap / 2;
    const pts = [], nrm = [];
    for (let k = 0; k <= 6; k++) {
      const r = rA + (rB - rA) * (k / 6);
      pts.push([r, surf(r)]);
      nrm.push(nIn(r));
    }
    lathe(M.part(PART.GLASS, p / petals), pts, nrm, a0, a1, 5);
  }
  const st = M.part(PART.STRUCT, 0.61);
  const rMid = (rA + rB) / 2;
  for (let p = 0; p < petals; p++) {
    const a = (p / petals) * TAU;
    const P = [rA, rMid, rB].map((r) => polar(r, a, surf(r) - 0.00022));
    bar(st, P[0], P[1], 0.0005, 0.0005);
    bar(st, P[1], P[2], 0.0005, 0.0005);
  }
  // pierścienie cewek na czaszy: fala od obrzeża do ogniska
  [0.0165, 0.0125, 0.0085].forEach((r, k) => {
    const q = 0.0002, y = surf(r) - 0.0002;
    sweep(M.part(PART.COIL, 0.7 + k * 0.05, k * 0.22, 0.4), [[-q, y - q], [q, y - q], [q, y + q], [-q, y + q]], r, 0, TAU, 96);
  });
  // obrzeże i pierścień mocowania ogniska (stal)
  const yR = surf(Rd);
  const hull = M.part(PART.HULL, 0.66);
  sweep(hull, [[-0.0009, yR - 0.0006], [0.0011, yR - 0.0006], [0.0011, yR + 0.0010], [-0.0009, yR + 0.0010]], Rd, 0, TAU, 128);
  const q = 0.0004, ym = surf(0.0043) - 0.0002;
  sweep(st, [[-q, ym - q], [q, ym - q], [q, ym + q], [-q, ym + q]], 0.0043, 0, TAU, 48);
  // grzbiet (kadłub) i żebra grzbietu
  const back = [], backN = [];
  for (let k = 0; k <= 8; k++) {
    const r = 0.003 + (Rd - 0.0006 - 0.003) * (k / 8);
    back.push([r, surf(r) + 0.0008]);
    backN.push(nOut(r));
  }
  lathe(hull, back, backN, 0, TAU, 64);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * TAU;
    const P = [0.0045, 0.010, 0.0155, Rd - 0.001].map((r) => polar(r, a, surf(r) + 0.0011));
    for (let j = 0; j < 3; j++) bar(st, P[j], P[j + 1], 0.0006, 0.0007);
  }
  // zastrzały grzbiet → kołnierz rdzenia i przewody energii czasza → rdzeń
  for (const a of spokeAz) {
    const P = polar(0.0165, a, surf(0.0165) + 0.001), Q = polar(0.0102, a, -0.0038);
    bar(st, P, Q, 0.0006, 0.0006);
    const off = polar(0.0006, a + Math.PI / 2, 0.0005);
    const g = cylinderPath(P.clone().add(off), Q.clone().add(off), 0.00028);
    F.push(finalizePart(g.geo, PART.PIPE, 0.8, g.len, 1));
  }
  // światła obrzeża (białe)
  const bc = M.part(PART.BEACON, 0.25, 0.9, 1);
  for (let k = 0; k < 6; k++) beacon(bc, polar(Rd + 0.0012, ((k + 0.5) / 6) * TAU, yR - 0.0007), 0.0005);
  // OGNISKO: pochłaniacz w końcu promienia (cewka, jaśniejsza)
  const fo = M.part(PART.COIL, 0.9, 0.66, 1.0);
  sweep(fo, [[0, BEAM_END - 0.0006], [0.0017, BEAM_END - 0.0004], [0.0031, BEAM_END + 0.0003], [0.004, BEAM_END + 0.0013],
    [0.0042, yV + 0.0002], [0, yV + 0.0002]], 0, 0, TAU, 40, false);
}

/** Przewód P → Q (uv.y: 0 przy P, 1 przy Q — droga od źródła) w ramie odbiornika (przesunięcie na końcu). */
function cylinderPath(P, Q, r) {
  const d = new THREE.Vector3().subVectors(Q, P);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 8, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
  g.translate((P.x + Q.x) / 2, (P.y + Q.y) / 2, (P.z + Q.z) / 2);
  return { geo: g, len };
}

// ── Szprychy: kratownice rdzeń → magazyn → węzeł modułu, przewody energii w środku ────────────────────────────────
/** Kratownica wzdłuż +X od x0 do x1 (przekrój kwadratowy 2s, przęsła Warrena). */
function truss(B, x0, x1, s) {
  const bays = Math.max(2, Math.round((x1 - x0) / 0.0026));
  const cw = 0.00042, fw = 0.0003;
  for (const [y, z] of [[s, s], [s, -s], [-s, s], [-s, -s]]) bar(B, v3(x0, y, z), v3(x1, y, z), cw, cw);
  for (let k = 0; k <= bays; k++) {
    const x = x0 + (x1 - x0) * (k / bays);
    bar(B, v3(x, s, -s), v3(x, s, s), fw, fw);
    bar(B, v3(x, -s, -s), v3(x, -s, s), fw, fw);
    bar(B, v3(x, -s, s), v3(x, s, s), fw, fw, X_AX);
    bar(B, v3(x, -s, -s), v3(x, s, -s), fw, fw, X_AX);
    if (k === bays) break;
    const xb = x0 + (x1 - x0) * ((k + 1) / bays);
    const f = k % 2 ? 1 : -1;
    bar(B, v3(x, s, -s * f), v3(xb, s, s * f), fw, fw);
    bar(B, v3(x, -s, s * f), v3(xb, -s, -s * f), fw, fw);
    bar(B, v3(x, -s * f, s), v3(xb, s * f, s), fw, fw, X_AX);
    bar(B, v3(x, s * f, -s), v3(xb, -s * f, -s), fw, fw, X_AX);
  }
}

function buildSpokes(M, F, L, spokeAz) {
  const R0 = L.hubRing;
  const xIn = 0.0134;
  const xNode = R0 - L.hubTubeW * 1.22 - 0.0032;
  const xb = L.hubBankRing, Rc = BANK_R;
  spokeAz.forEach((a, k) => {
    const m = radial(a);
    const st = M.part(PART.STRUCT, k / spokeAz.length);
    truss(st, xIn, xb - Rc + 0.0002, 0.0013);
    truss(st, xb + Rc - 0.0002, xNode + 0.0002, 0.0013);
    st.transformFrom(0, m);
    // przewód energii w osi kratownicy: rdzeń → magazyn → pierścień
    const g = cylinderPath(polar(0.0128, a, 0), polar(xNode + 0.0006, a, 0), 0.00042);
    F.push(finalizePart(g.geo, PART.PIPE, 0.3 + k * 0.1, g.len, 1));
    buildBank(M, L, a, k / spokeAz.length);
  });
}

// ── MAGAZYN: stos ogniw na szprysze (cewki wskaźnika: w = −1, jasność wg naładowania) ─────────────────────────────
function buildBank(M, L, a, seed) {
  const m = radial(a, L.hubBankRing, 0, 0);
  const Rc = BANK_R, t = 0.0024, g = 0.0008, ch = 0.0005, rIn = 0.0013, cells = 3;
  const hull = M.part(PART.HULL, seed);
  hull.add(new THREE.CylinderGeometry(rIn, rIn, cells * t + (cells - 1) * g + 0.003, 20, 1, false));
  for (let k = 0; k < cells; k++) {
    const yc = (k - (cells - 1) / 2) * (t + g);
    const yb = yc - t / 2, yt = yc + t / 2;
    sweep(hull, [[rIn, yb], [Rc - ch, yb], [Rc, yb + ch], [Rc, yt - ch], [Rc - ch, yt], [rIn, yt]], 0, 0, TAU, 40, false);
    const coil = M.part(PART.COIL, seed, k / cells, -1);
    sweep(coil, [[Rc + EPS, yc - 0.00016], [Rc + EPS, yc + 0.00016]], 0, 0, TAU, 40, false);
    if (k === cells - 1) sweep(coil, [[0.0033, yt + EPS], [0.0026, yt + EPS]], 0, 0, TAU, 40, false);
    if (k === 0) sweep(coil, [[0.0026, yb - EPS], [0.0033, yb - EPS]], 0, 0, TAU, 40, false);
    coil.transformFrom(0, m);
  }
  hull.transformFrom(0, m);
}

// ── Radiatory: cienkie panele promieniste (krawędzią do osi gryzu), żar u nasady ──────────────────────────────────
function buildRadiators(M, L, radAz, nodes, pitch) {
  const R0 = L.hubRing;
  const root = R0 + L.hubTubeW * 1.22 + 0.0004;
  const s0 = root + 0.001, s4 = root + L.hubRadLen;
  const h0 = 0.006, h1 = 0.0042;
  const h = (x) => h0 + (h1 - h0) * (x - s0) / (s4 - s0);
  const tp = 0.00026, rw = 0.0006, slats = 4;
  const st = (k) => s0 + (s4 - s0) * (k / slats);
  // żar: od nasady (z ≈ 0,42) gaśnie do końca drugiego panelu
  const sHot = st(2);
  const heat = (i, x, y, z) => {
    const t = Math.min(1, Math.max(0, (Math.sqrt(x * x + z * z) - s0) / (sHot - s0)));
    return 0.42 * (1 - t) * (1 - t);
  };
  radAz.forEach((a, k) => {
    const m = radial(a);
    const seed = k / radAz.length;
    const node = nodes.has(Math.round(a / pitch) % L.hubModules);
    const W = L.hubTubeW * (node ? 1.22 : 1);
    const S = M.part(PART.STRUCT, seed);
    const hot = M.part(PART.HOT, seed, heat);
    const hull = M.part(PART.HULL, seed);
    // nasada na ścianie modułu
    hull.add(new THREE.BoxGeometry(s0 + 0.0004 - (R0 + W - 0.0006), 0.0092, 0.0026),
      new THREE.Matrix4().makeTranslation((s0 + 0.0004 + R0 + W - 0.0006) / 2, 0, 0));
    // panele: dwa pierwsze żarzą się, reszta — stal
    for (let j = 0; j < slats; j++) {
      const xa = st(j) + rw / 2, xb = st(j + 1) - rw / 2;
      const B = j < 2 ? hot : S;
      plate(B, xa, xb, h(xa) - 0.0003, h(xb) - 0.0003, tp);
    }
    // żebra poprzeczne, rury cieplne, ramy górna i dolna, grzbiet
    for (let j = 0; j <= slats; j++) {
      const x = st(j);
      bar(S, v3(x, -h(x), 0), v3(x, h(x), 0), 0.0007, rw, X_AX);
    }
    for (let x = s0 + 0.0011; x < s4 - 0.0006; x += 0.0016) {
      if (Math.abs(((x - s0) / (s4 - s0)) * slats - Math.round(((x - s0) / (s4 - s0)) * slats)) < 0.06) continue;
      bar(S, v3(x, -h(x) + 0.0004, 0), v3(x, h(x) - 0.0004, 0), 0.00052, 0.00022, X_AX);
    }
    for (const sg of [-1, 1]) bar(S, v3(s0, sg * h(s0), 0), v3(s4, sg * h(s4), 0), 0.0007, 0.0006);
    bar(S, v3(R0 + W - 0.0004, 0, 0), v3(s4, 0, 0), 0.0008, 0.0007);
    // kolektor u nasady (rura pionowa) i zaślepka końca
    hull.add(new THREE.CylinderGeometry(0.00055, 0.00055, 2 * h0 + 0.0006, 12, 1, false), new THREE.Matrix4().makeTranslation(s0 - 0.0001, 0, 0));
    bar(S, v3(s4 + 0.0003, -h1 - 0.0002, 0), v3(s4 + 0.0003, h1 + 0.0002, 0), 0.0009, 0.0008, X_AX);
    for (const B of [S, hot, hull]) B.transformFrom(0, m);
    const bc = M.part(PART.BEACON, (k % 2) * 0.5, 0.5, 0);
    beacon(bc, polar(s4 + 0.0003, a, h1 + 0.0007), 0.0005);
  });
}

/** Płyta w płaszczyźnie XY (grubość tp wzdłuż Z): od x = xa (pół-wysokość ha) do xb (hb). */
function plate(B, xa, xb, ha, hb, tp) {
  const z = tp / 2;
  const C = [[xa, -ha], [xb, -hb], [xb, hb], [xa, ha]];
  for (const sg of [1, -1]) {
    const q = C.map(([x, y]) => B.v(x, y, sg * z, 0, 0, sg, x, y));
    B.quad(q[0], q[1], q[2], q[3]);
  }
  for (let k = 0; k < 4; k++) {
    const [x1, y1] = C[k], [x2, y2] = C[(k + 1) % 4];
    const tx = x2 - x1, ty = y2 - y1, l = Math.sqrt(tx * tx + ty * ty);
    const nx = ty / l, ny = -tx / l;
    const a = B.v(x1, y1, z, nx, ny, 0), b = B.v(x2, y2, z, nx, ny, 0);
    const c = B.v(x2, y2, -z, nx, ny, 0), d = B.v(x1, y1, -z, nx, ny, 0);
    B.quad(a, b, c, d);
  }
}

/** Odbiornik: { metal: części, flow: części } w ramie elektrowni. */
export function buildOrbital(L, b) {
  const hHub = hubHeight(L, b);
  const rng = plantRng(L.hubSeed);
  const M = partList();
  const flow = [];
  const n = L.hubModules;
  const pitch = TAU / n;
  // szprychy i radiatory w osiach modułów (węzły — moduły przy szprychach)
  const snap = (a) => (Math.round(a / pitch) % n) * pitch;
  const spokeAz = [];
  for (let k = 0; k < L.hubSpokes; k++) spokeAz.push(snap((k / L.hubSpokes) * TAU));
  const nodes = new Set(spokeAz.map((a) => Math.round(a / pitch) % n));
  const radAz = [];
  for (let k = 0; k < L.hubRadiators; k++) radAz.push(snap((k / L.hubRadiators) * TAU));
  const radMods = new Set(radAz.map((a) => Math.round(a / pitch) % n));
  buildRing(M, L, rng, nodes, radMods);
  buildCore(M, L, spokeAz, radAz.filter((a) => !nodes.has(Math.round(a / pitch) % n)));
  buildDish(M, flow, L, spokeAz);
  buildSpokes(M, flow, L, spokeAz);
  buildRadiators(M, L, radAz, nodes, pitch);
  for (const g of flow) g.translate(0, hHub, 0);
  return { metal: M.finish(hHub), flow };
}
