// Elektrownia „KOREK” — ODBIORNIK NA ORBICIE (1,075 R od środka Ziemi, na osi gryzu, pod wewnętrzną krawędzią ringu
// „Halo”): odbiera promień z korka, magazynuje energię i oddaje ją promieniem przekaźnikowym do ringu. Windy idą do RINGU
// PLANETARNEGO, nie tu — odbiornik nie ma doków lin.
//
// KADR GRY: kamera gry patrzy znad bieguna obrotu, czyli w ramie gryzu ZAWSZE z jednej strony — od północy, 10° nad
// płaszczyzną odbiornika. Oś odbiornika (A) leży więc prawie w płaszczyźnie ekranu (w prawo ku ringowi), pierścień
// widać prawie z profilu, a moduły w azymucie ~90° stoją frontem do kamery. Sylwetka jest budowana WZDŁUŻ OSI A:
//   −A (ku korkowi): DZWON — głęboka czasza z fartuchem, w którym chowa się koniec promienia i rozbłysk uderzenia;
//   pierścień: KORONA ŁOPAT radiatorów sięgających nad i pod pierścień (azymuty co 30° bez południka promienia);
//   +A (ku ringowi): BLIŹNIACZE IGLICE nadajnika na stosach magazynu — po obu stronach linii promienia
//     przekaźnikowego (iglica na osi leżałaby w kadrze gry dokładnie na tym promieniu i zasłaniała jego start).
// Promień przekaźnikowy biegnie ze środka odbiornika do najbliższego punktu ringu (`hubRelayDir`: w ramie prawie poziomo,
// w azymucie ~270°, 4° w górę) — przez LUFĘ nadajnika i BRAMĘ w pierścieniu (soczewka z pierścieniami cewek, w kadrze
// gry widziana od czoła jako tarcza z koncentrycznymi kręgami). Moduł naprzeciw bramy (~90°) to FRONT: dok serwisowy
// z CIEMNĄ halą (dwie kondygnacje sterowni na tylnej ścianie, lampy suwnicy, chłodne światła wrót i podejścia), maszt
// łączności; obok — przeszklone galerie (szyby osobno, z przekosem — błyski, nie smuga) i gondole.
//   • PIERŚCIEŃ-STACJA: moduły z łącznikami i kołnierzami — węzły przy szprychach (większe, blok węzła, kopuła, chłodne
//     belki świateł, białe stroboskopy), przemysłowe pod łopatami (zbiorniki), mieszkalne (pasy okien, świetliki, ciepła
//     listwa, wyposażenie z ziarna: nadbudówki, maszty z antenami, kopuły, gondole pod stępką); szyna energii (fala
//     dookoła pierścienia, przerwana w bramie).
//   • CZASZA ZBIERAJĄCA (zwrócona w dół): płatki szkła, żebra, pierścienie cewek, ognisko w końcu promienia; ciemny grzbiet,
//     obrzeże z ciągłą cienką cewką (czytelna z profilu), fartuch z cewkami, żebrami i światłami na wardze.
//   • SZPRYCHY: kratownice magazyn → węzeł z przewodami energii; MAGAZYN — stosy ciemnych ogniw przy rdzeniu z cienkimi
//     pierścieniami cewek (w = −1, jasność wg naładowania) między ogniwami.
//   • ŁOPATY RADIATORÓW: ciemne, matowe płyty żaru o płytkiej fali (krawędzią do osi — z góry linie), rury cieplne
//     wzdłuż promienia z gorącym szwem i kolektor u nasady — żar w rurach i na krawędziach, gasnący ku końcowi łopaty;
//     nocą obrys ciepłą listwą i światła pozycyjne w rogach końca.
//   • ŚWIATŁA POZYCYJNE (`lamp`): ciemna oprawa z małą soczewką — zgaszone to metal z szybką, nie kolorowa kula.
//   • NADAJNIK w środku (`hubCenterObject`): świecący rdzeń w sferze armilarnej cewek i dwóch pierścieniach gimbala
//     (w sferze mieści się kula ładowania promienia), lufa z cewkami i dyszą ku ringowi przez szczelinę w kołnierzu.
// Z góry (oś gryzu) odbiornik wisi nad korkiem i go nie zasłania: otwarty pierścień, kratownice i łopaty krawędzią do
// widza, magazyn nad czaszą (w rzucie poza pierścieniami zamknięcia promienia), czasza z fartuchem ≤ 0,024 R.
// Geometria CPU w ramie elektrowni (earthBitePlantFrame.js) budowana względem środka odbiornika i na końcu przesunięta
// o hubHeight; części z rodzajem powierzchni (PART): bryły — materiał metalu, przewody — przepływu.
// uv części ze `sweep` / `lathe` / `prism`: u — droga po obwodzie [R], v — droga po przekroju [R].
import * as THREE from 'three/webgpu';
import {
  PART, finalizePart, hubHeight, plantRng, objectToFrameMatrix, ringPointObject
} from './earthBitePlantFrame.js';
import { earthSpinAxis } from './earthSpin.js';
import { earthBiteFrame } from './earthBiteShape.js';
import { EARTH_BITE } from '../data/earthBite.js';

const TAU = Math.PI * 2;
/** Koniec promienia głównego względem środka odbiornika (earthBitePlantBeam.js: hubHeight − 0,01). */
const BEAM_END = -0.01;

/** Wymiary odbiornika (R Ziemi). hubRadius (od środka Ziemi), hubRing (promień pierścienia) — w PLANT_LAYOUT. */
export const HUB_DEFAULTS = Object.freeze({
  hubModules: 24,      // moduły pierścienia (24–36): węzły, brama przekaźnika, front, przemysłowe, mieszkalne
  hubGap: 0.14,        // ułamek podziałki modułu na łącznik
  hubTubeW: 0.0056,    // pół-szerokość kadłuba modułu (promieniowo)
  hubTubeH: 0.0034,    // pół-wysokość kadłuba modułu (bez grzbietu i stępki)
  hubSpokes: 6,        // kratownice do rdzenia; przy rdzeniu na każdej — stos ogniw magazynu
  hubBankRing: 0.0175, // magazyn: odległość stosów ogniw od osi (z góry nad czaszą, wewnątrz pierścieni zamknięcia)
  hubRadiators: 12,    // siatka azymutów łopat (bez południka promienia przekaźnikowego — brama i front)
  hubRadLen: 0.032,    // długość łopaty radiatora (promieniowo)
  hubRadH: 0.0165,     // pół-wysokość łopaty u nasady (wzdłuż osi — sylwetka w kadrze gry)
  hubDishR: 0.0205,    // promień czaszy zbierającej
  hubDishDepth: 0.009, // głębokość czaszy
  hubApron: 0.0125,    // fartuch czaszy: wysokość pod obrzeżem (dzwon chowa koniec promienia i rozbłysk)
  hubSpireH: 0.031,    // wysokość iglic nadajnika nad środkiem odbiornika
  hubSeed: 4127        // ziarno odmian modułów (wyposażenie, anteny, gęstość okien)
});

/**
 * Kierunek promienia przekaźnikowego (jednostkowy, rama elektrowni): środek odbiornika → najbliższy punkt wewnętrznej
 * krawędzi ringu (oś obrotu `axis` w układzie obiektu kuli — jak `EarthBitePlant.attachRing`).
 */
export function hubRelayDir(L, b = EARTH_BITE.radiusR, axis = earthSpinAxis(), out = new THREE.Vector3()) {
  const { C } = earthBiteFrame(EARTH_BITE);
  const H = new THREE.Vector3(C[0], C[1], C[2]).multiplyScalar(L.hubRadius);
  const T = ringPointObject(H, axis, L.ringInnerR, new THREE.Vector3());
  const inv = objectToFrameMatrix(b);
  H.applyMatrix4(inv);
  T.applyMatrix4(inv);
  return out.subVectors(T, H).normalize();
}

/** Odległość wylotu dyszy nadajnika od środka odbiornika wzdłuż promienia przekaźnikowego [R]. */
export const HUB_RELAY_MUZZLE = 0.0168;

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

/**
 * Rejestr części jednego materiału: `part(rodzaj, ziarno, z, w)` → bufor; `shared(klucz, …)` — jedna wspólna część na
 * klucz (np. oprawy wszystkich świateł); `finish(dy)` → części po finalizePart.
 */
function partList() {
  const list = [];
  const byKey = new Map();
  return {
    part(kind, seed = 0, z = 0, w = 0) {
      const b = new PartBuf();
      list.push({ b, kind, seed, z, w });
      return b;
    },
    shared(key, kind, seed = 0, z = 0, w = 0) {
      if (!byKey.has(key)) byKey.set(key, this.part(kind, seed, z, w));
      return byKey.get(key);
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

/**
 * Bryła obrotowa o PŁASKICH ścianach (wielokąt o `sides` bokach): przekrój (r, y) jak w `sweep` (r od osi), każda ściana
 * z własną normalną — walce czytają się jak kute graniastosłupy, nie chromowane rury. `closed` — także ostatni → pierwszy.
 */
function prism(B, prof, sides, a0 = 0, closed = false) {
  const m = prof.length;
  const ne = closed ? m : m - 1;
  const step = TAU / sides;
  const kk = Math.cos(step / 2);
  let vAcc = 0;
  for (let k = 0; k < ne; k++) {
    const [r1, y1] = prof[k];
    const [r2, y2] = prof[(k + 1) % m];
    const tx = r2 - r1, ty = y2 - y1;
    const len = Math.sqrt(tx * tx + ty * ty);
    if (len < 1e-9) continue;
    for (let j = 0; j < sides; j++) {
      const aA = a0 + j * step, aB = aA + step, am = aA + step / 2;
      let nx = ty * Math.cos(am), ny = -tx * kk, nz = -ty * Math.sin(am);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const cA = Math.cos(aA), sA = Math.sin(aA), cB = Math.cos(aB), sB = Math.sin(aB);
      const a = B.v(r1 * cA, y1, -r1 * sA, nx, ny, nz, r1 * aA, vAcc);
      const b = B.v(r1 * cB, y1, -r1 * sB, nx, ny, nz, r1 * aB, vAcc);
      const c = B.v(r2 * cB, y2, -r2 * sB, nx, ny, nz, r2 * aB, vAcc + len);
      const d = B.v(r2 * cA, y2, -r2 * sA, nx, ny, nz, r2 * aA, vAcc + len);
      B.quad(a, b, c, d);
    }
    vAcc += len;
  }
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

/** Płaski wielokąt wypukły w płaszczyźnie XY (grubość tp wzdłuż Z): obie twarze i boki. */
function slab(B, poly, tp) {
  const z = tp / 2;
  const m = poly.length;
  for (const sg of [1, -1]) {
    const q = poly.map(([x, y]) => B.v(x, y, sg * z, 0, 0, sg, x, y));
    for (let k = 1; k < m - 1; k++) B.tri(q[0], q[k], q[k + 1]);
  }
  for (let k = 0; k < m; k++) {
    const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % m];
    const tx = x2 - x1, ty = y2 - y1, l = Math.sqrt(tx * tx + ty * ty);
    if (l < 1e-9) continue;
    let nx = ty / l, ny = -tx / l;
    // na zewnątrz wielokąta (środek ciężkości po drugiej stronie)
    let cx = 0, cy = 0;
    for (const [x, y] of poly) { cx += x; cy += y; }
    cx /= m; cy /= m;
    if ((x1 - cx) * nx + (y1 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const a = B.v(x1, y1, z, nx, ny, 0), b = B.v(x2, y2, z, nx, ny, 0);
    const c = B.v(x2, y2, -z, nx, ny, 0), d = B.v(x1, y1, -z, nx, ny, 0);
    B.quad(a, b, c, d);
  }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
/** Punkt w odległości r od osi, w azymucie a, na wysokości y (rama: x = cos a, z = −sin a). */
const polar = (r, a, y) => v3(r * Math.cos(a), y, -r * Math.sin(a));
/** Macierz: obrót wokół osi Y o azymut a (lokalne +X → kierunek promieniowy a) i przesunięcie. */
function radial(a, x = 0, y = 0, z = 0) {
  return new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
}
/** Różnica kątów zawinięta do (−π, π]. */
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

const _lq = new THREE.Quaternion();
/**
 * Światło pozycyjne na powierzchni w punkcie S (normalna `nrm`): ciemna sześciokątna OPRAWA (stal — wspólna część
 * wszystkich opraw) wpuszczona w kadłub i mała kopułka SOCZEWKI (BEACON) na niej. W fazie zgaszonej czyta się jak ciemny
 * metal z szybką, nie jak kolorowa kula; z daleka zostaje błysk soczewki. r — promień oprawy.
 */
function lamp(M, bc, S, nrm, r = 0.0003) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(_lq.setFromUnitVectors(Y_UP, nrm)).setPosition(S);
  const rl = r * 0.6, top = r * 0.5, hh = r * 0.55;
  const housing = M.shared('oprawy', PART.STRUCT, 0.58);
  const s0 = housing.count;
  prism(housing, [[0, -hh], [r, -hh], [r, top], [rl, top]], 6, Math.PI / 6);
  housing.transformFrom(s0, m);
  const lens = new THREE.SphereGeometry(rl, 8, 3, 0, TAU, 0, Math.PI / 2);
  lens.translate(0, top, 0);
  bc.add(lens, m);
}

/** Kierunek od osi w azymucie a, uniesiony o `up` (znormalizowany) — normalne świateł na krawędziach. */
const outDir = (a, up = 0) => v3(Math.cos(a), up, -Math.sin(a)).normalize();

/**
 * Część w trybie WŁASNEGO uv (kontrakt aPart.z < 0): wierzchołki od `start` dostają STAŁE uv.y = v (listwa: v = STRIP_V —
 * oś pierwszej rurki światła; listwa świeci równo z bliska i z daleka, bez trafiania w przerwy między rurkami rzutu
 * pudełkowego) i uv.x = droga wzdłuż [R] zapisana przez prymityw (`bar`) + pół segmentu albo — `u` podane — stałe
 * (małe lampy z pudełek: uv pudełka 0…1 to nie [R]).
 */
function pinUv(B, start, v, u = null) {
  for (let k = start; k < B.count; k++) {
    B.t[k * 2] = u === null ? B.t[k * 2] + 0.00125 : u;
    B.t[k * 2 + 1] = v;
  }
}
/**
 * Belki `bar` (z wieczkami: 4 ściany × 4 wierzchołki + 2 × 4) od wierzchołka `start` w trybie własnego uv części żaru:
 * uv.y = położenie w poprzek ściany [R] (−s/2 … s/2) — szew płyt (uv.y = 0) biegnie osią każdej ściany belki, wieczka
 * całe na szwie; uv.x (droga wzdłuż belki) bez zmian.
 */
function seamBars(B, start, s) {
  for (let k = start; k < B.count; k++) {
    const i = (k - start) % 24;
    B.t[k * 2 + 1] = i < 16 ? (B.t[k * 2 + 1] - Math.floor(i / 4) - 0.5) * s : 0;
  }
}
/** uv.y osi pierwszej rurki listwy w trybie własnego uv (stripLight: v0 = 0,00035 R). */
const STRIP_V = 0.00035;
/** uv.y linii kondygnacji pasa okien w trybie własnego uv (windowSlots: środek pasa WIN_BAND = 0,0045 R). */
const WIN_LINE_V = 0.00225;

/**
 * Antena talerzowa: cienka czasza (paraboloida z wargą — widoczna z obu stron), wspornik i promiennik w ognisku.
 * Lokalnie otwarta ku +Y; `m` — położenie i kierunek.
 */
function dishAntenna(B, R, depth, m) {
  const t = Math.max(R * 0.08, 0.00009);
  const pts = [];
  for (let k = 0; k <= 4; k++) { const r = R * k / 4; pts.push([r, depth * (r / R) * (r / R) - t]); }
  for (let k = 4; k >= 0; k--) { const r = R * k / 4; pts.push([r, depth * (r / R) * (r / R)]); }
  const s0 = B.count;
  sweep(B, pts, 0, 0, TAU, 16, false);
  bar(B, v3(0, 0, 0), v3(0, R * 0.9, 0), R * 0.12, R * 0.12, X_AX);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    bar(B, v3(Math.cos(a) * R * 0.85, depth * 0.72, -Math.sin(a) * R * 0.85), v3(0, R * 0.9, 0), R * 0.05, R * 0.05);
  }
  B.transformFrom(s0, m);
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
const BANK_R = 0.0032; // promień ogniw magazynu
const BANK_HALF = 0.0051; // pół-wysokość stosu ogniw (wzdłuż osi)

// ── Brama przekaźnika: oprawa soczewki w pierścieniu, przez którą promień wychodzi do ringu ──────────────────────
const GATE_IN = 0.0044;   // światło soczewki
const GATE_OUT = 0.0068;  // zewnętrzny promień oprawy
const GATE_D = 0.0021;    // pół-głębokość oprawy (wzdłuż promienia przekaźnikowego)

/** Macierz bazy: lokalne Y → kierunek d, lokalne X → poziomy kierunek styczny (⟂ d), środek w P. */
function relayBasis(d, P) {
  const t = v3(-d.z, 0, d.x);
  if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
  t.normalize();
  const z = new THREE.Vector3().crossVectors(t, d).normalize();
  return new THREE.Matrix4().makeBasis(t, d.clone().normalize(), z).setPosition(P);
}

// ── Pierścień: moduły, łączniki, kołnierze, okna, listwy, światła, szyna energii ───────────────────────────────────
// Rodzaje modułów: WĘZŁY (przy szprychach), BRAMA (w azymucie promienia przekaźnikowego), FRONT (naprzeciw bramy — do
// kamery gry), PRZEMYSŁOWE (pod łopatami) i MIESZKALNE (z wyposażeniem z ziarna).
function buildRing(M, L, rng, lay) {
  const n = L.hubModules;
  const R0 = L.hubRing;
  const pitch = TAU / n;
  const span = pitch * (1 - L.hubGap);
  const cs = 0.0007 / R0;   // kąt kołnierza (łuk ~0,0007 R)
  const e = EPS;
  const { nodes, radMods, gate, front } = lay;
  const Wk = L.hubTubeW * 0.45, Hk = L.hubTubeH * 0.55;
  const conn = octagon(Wk, Hk, -Hk, Hk * 0.3);
  for (let i = 0; i < n; i++) {
    if (gate && i === gate.idx) continue;
    const node = nodes.has(i);
    const isFront = i === front;
    const frontSide = !node && !isFront && (i === (front + 1) % n || i === (front + n - 1) % n);
    const ind = !node && !isFront && radMods.has(i);
    const ac = i * pitch, a0 = ac - span / 2, a1 = ac + span / 2;
    const W = L.hubTubeW * (node ? 1.22 : 1), H = L.hubTubeH * (node ? 1.25 : 1);
    const S = habShape(W, H);
    const seed = rng.next();
    const hull = M.part(PART.HULL, seed);
    sweep(hull, S.prof, R0, a0 + cs * 0.5, a1 - cs * 0.5, 12);
    // łącznik do następnego modułu (węższa rura ciśnieniowa); przed bramą — do jej oprawy
    const next = (i + 1) % n;
    const c1 = gate && next === gate.idx ? a1 + angDiff(gate.ac - gate.connAng, a1) : a1 + (pitch - span) + cs;
    sweep(hull, conn, R0, a1 - cs, c1, 3);
    if (gate && next === gate.idx) sweepCap(hull, conn, R0, c1, 1);
    // kołnierze na końcach modułu (stal, zamknięte wieczkami)
    const col = M.part(PART.STRUCT, seed);
    const cp = octagon(W * 1.05, (H + S.dh) * 1.05, -(H + S.kh) * 1.05, H * 0.3);
    for (const [k0, k1] of [[a0 - cs * 0.1, a0 + cs], [a1 - cs, a1 + cs * 0.1]]) {
      sweep(col, cp, R0, k0, k1, 1);
      sweepCap(col, cp, R0, k0, -1);
      sweepCap(col, cp, R0, k1, 1);
    }
    // pasy okien (rzędy okien rysuje materiał): zewnętrzne, wewnętrzne, świetliki na barkach pokładu
    const wa0 = a0 + cs * 1.6, wa1 = a1 - cs * 1.6;
    // gęstość zapalonych ~0,8 (nocą pierścień w kadrze gry czyta się rytmem pasów okien); przemysłowe rzadziej
    const dens = ind ? 0.55 : (node ? 0.8 : isFront ? 0.85 : 0.8 + rng.next() * 0.12);
    const win = M.part(PART.WINDOW, seed, dens);
    const sh0 = S.dw + S.dh + 0.0004, sh1 = W - S.c - 0.0003;
    const bands = ind
      ? [[[W + e, H * 0.1], [W + e, H * 0.45]], [[-W - e, H * 0.5], [-W - e, H * 0.08]]]
      : isFront
        ? [[[W + e, H * 0.3], [W + e, H * 0.62]], [[-W - e, H * 0.5], [-W - e, H * 0.06]]]
        : [[[W + e, H * 0.08], [W + e, H * 0.56]], [[W + e, -H * 0.56], [W + e, -H * 0.08]], [[-W - e, H * 0.5], [-W - e, H * 0.06]]];
    if (!ind && !node) bands.push([[sh1, H + e], [sh0, H + e]], [[-sh0, H + e], [-sh1, H + e]]);
    for (const band of bands) sweep(win, band, R0, wa0, wa1, 8, false);
    // cienka chłodna linia na dolnym skosie zewnętrznej ściany — nocą obrys pierścienia w kadrze gry (pod progiem bloomu)
    const ol = M.part(PART.STRIP, seed * 0.3 + 0.6, 0.38, 1);
    const cx = W - S.c * 0.5, cy = -H + S.c * 0.5, on = Math.SQRT1_2 * EPS * 1.5, q = 0.00009;
    sweep(ol, [[cx + on - q, cy - on - q], [cx + on + q, cy - on + q]], R0, wa0, wa1, 8, false);
    // spód (widok od korka): rzadkie okna na barkach stępki
    if (!ind && !node) {
      const k0 = S.kw + S.kh + 0.0004, k1 = W - S.c - 0.0004;
      const under = M.part(PART.WINDOW, seed, 0.5);
      for (const band of [[[-k1, -H - e], [-k0, -H - e]], [[k0, -H - e], [k1, -H - e]]]) sweep(under, band, R0, wa0, wa1, 8, false);
    }
    // listwa grzbietu: ciepła (mieszkalne), chłodna (przemysłowe) — cienka, pod progiem bloomu
    const strip = M.part(PART.STRIP, seed, ind ? 0.4 : 0.45, ind ? 1 : 0);
    sweep(strip, [[S.dw * 0.3, H + S.dh + e], [-S.dw * 0.3, H + S.dh + e]], R0, wa0, wa1, 8, false);
    // lampy pokładu na końcach modułu (małe, jasne — z daleka punkty pierścienia); w węzłach — chłodne belki świateł
    const lampS = M.part(PART.STRIP, seed, node ? 1.4 : 2.0, node ? 1 : 0);
    const lw = node ? S.dw * 0.85 : 0.00036, ll = (node ? 0.00028 : 0.00036) / R0;
    const yd = H + S.dh;
    const lp = [[lw, yd], [lw, yd + 0.00022], [-lw, yd + 0.00022], [-lw, yd]];
    for (const am of [a0 + cs * 2.4, a1 - cs * 2.4]) {
      sweep(lampS, lp, R0, am - ll, am + ll, 1);
      sweepCap(lampS, lp, R0, am - ll, -1);
      sweepCap(lampS, lp, R0, am + ll, 1);
    }
    // światło pozycyjne na ściętej krawędzi (czerwone naprzemiennie; białe stroboskopy na węzłach)
    const bc = M.part(PART.BEACON, node ? 0 : (i % 2) * 0.5, node ? 1.1 : 0.5, node ? 1 : 0);
    const br = R0 + W - S.c * 0.5, by = H - S.c * 0.5;
    for (const am of node ? [a1 - cs * 2.5, a0 + cs * 2.5] : [a1 - cs * 2.5]) {
      lamp(M, bc, polar(br, am, by), outDir(am, 1), node ? 0.00036 : 0.0003);
    }
    if (node) lamp(M, M.part(PART.BEACON, 0.5, 0.5, 0), polar(R0, ac, -H - S.kh), v3(0, -1, 0), 0.00032);
    if (ind) {
      // zbiorniki chłodziwa na barkach (graniaste) i rura zbiorcza
      const tk = M.part(PART.HULL, seed * 0.7 + 0.1);
      for (const side of [-1, 1]) {
        const rr = R0 + side * (W - S.c - 0.0011);
        for (const f of [-0.27, 0.27]) {
          const len = span * R0 * 0.36, r = 0.00085, ch = 0.0003;
          const s0 = tk.count;
          prism(tk, [[0, -len / 2], [r - ch, -len / 2], [r, -len / 2 + ch], [r, len / 2 - ch], [r - ch, len / 2], [0, len / 2]], 8, Math.PI / 8);
          tk.transformFrom(s0, radial(ac + f * span, rr, H + 0.00085, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        }
      }
      bar(M.part(PART.STRUCT, seed), polar(R0, a0 + cs * 2, H + S.dh + 0.0003), polar(R0, a1 - cs * 2, H + S.dh + 0.0003), 0.0005, 0.0005);
    } else if (isFront) {
      buildServiceDock(M, R0, W, H, S, ac, span, seed);
    } else if (frontSide) {
      buildOuterDomes(M, R0, W, H, ac, span, seed, i > front || (front === 0 && i === 1) ? 1 : -1);
    } else if (!node) {
      buildHabKit(M, R0, W, H, S, ac, a0, a1, span, cs, seed, rng);
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
  if (gate) buildGate(M, L, gate, conn);
  // szyna energii na wewnętrznym skosie pokładu (widać ją z góry; cewka: fala biegnie dookoła pierścienia, w węzłach
  // chowa się w większym kadłubie); przerwana w bramie przekaźnika
  const bus = M.part(PART.COIL, 0.37, PER_VERTEX, 0.4);
  bus.zAt = (a) => a / TAU;
  const S0 = habShape(L.hubTubeW, L.hubTubeH);
  const mr = -L.hubTubeW + S0.c / 2, my = L.hubTubeH - S0.c / 2;
  const tr = -Math.SQRT1_2, ty = -Math.SQRT1_2, nr = -Math.SQRT1_2, ny = Math.SQRT1_2;
  const ba = 0.00048, bh = 0.00034;
  const P1 = [mr - tr * ba, my - ty * ba], P2 = [mr + tr * ba, my + ty * ba];
  const busProf = [P1, [P1[0] + nr * bh, P1[1] + ny * bh], [P2[0] + nr * bh, P2[1] + ny * bh], P2];
  if (gate) {
    const g0 = gate.ac + span / 2, g1 = gate.ac + TAU - span / 2;
    sweep(bus, busProf, R0, g0, g1, 276);
    sweepCap(bus, busProf, R0, g0, -1);
    sweepCap(bus, busProf, R0, g1, 1);
  } else sweep(bus, busProf, R0, 0, TAU, 288);
  // wsporniki szyny nad łącznikami (szyna przechodzi nad przerwą między modułami)
  const brk = M.part(PART.STRUCT, 0.52);
  for (let i = 0; i < n; i++) {
    if (gate && (i === gate.idx || (i + 1) % n === gate.idx)) continue;
    const ag = (i + 0.5) * pitch;
    bar(brk, polar(R0 + mr + nr * bh * 0.5, ag, my + ny * bh * 0.5), polar(R0 - Wk * 0.6, ag, Hk * 0.8), 0.0003, 0.0003);
  }
}

/** FRONT (moduł naprzeciw bramy — w kadrze gry od czoła): dok serwisowy z oświetloną halą, holownik, maszt łączności. */
function buildServiceDock(M, R0, W, H, S, ac, span, seed) {
  const hull = M.part(PART.HULL, seed * 0.5 + 0.3);
  const st = M.part(PART.STRUCT, seed);
  const r0 = R0 + W - 0.0004, depth = 0.0026, r1 = r0 + depth;
  const hw = Math.min(0.0034, span * R0 * 0.3), yb = -H - 0.0016, yt = H + 0.0004;
  // ściany boczne, strop, dno hali (kadłub); oprawa wrót (stal)
  const wall = 0.00055;
  for (const sg of [-1, 1]) hull.add(new THREE.BoxGeometry(depth, yt - yb, wall), radial(ac, (r0 + r1) / 2, (yt + yb) / 2, sg * (hw + wall / 2)));
  hull.add(new THREE.BoxGeometry(depth, wall, hw * 2 + wall * 2), radial(ac, (r0 + r1) / 2, yt + wall / 2, 0));
  hull.add(new THREE.BoxGeometry(depth, wall, hw * 2 + wall * 2), radial(ac, (r0 + r1) / 2, yb - wall / 2, 0));
  for (const sg of [-1, 1]) st.add(new THREE.BoxGeometry(0.0004, yt - yb + wall * 2.4, 0.0005), radial(ac, r1 + 0.0002, (yt + yb) / 2, sg * (hw + wall * 0.7)));
  // WNĘTRZE HALI CIEMNE (w kadrze gry hala stoi frontem do kamery — jednolita świecąca ściana czytała się jak szyld):
  // tylna ściana ze stali, na niej DWIE KONDYGNACJE sterowni (pasy okien własnego uv: linia kondygnacji w środku pasa —
  // z daleka dwie bursztynowe kreski, z bliska rzędy szczelin) z półkami pomostów; światło głównie z suwnicy i wrót
  const rot = new THREE.Matrix4().makeRotationY(ac);
  const at = (x, y, z) => v3(x, y, z).applyMatrix4(rot);
  const out = outDir(ac);
  const rb = R0 + W + 0.00012;
  st.add(new THREE.PlaneGeometry(hw * 2, yt - yb), radial(ac, rb, (yt + yb) / 2, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  const hb = 0.00034, vc = WIN_LINE_V;
  [[0.62, 0.86, [[-0.92, -0.08], [0.06, 0.92]]], [0.8, 0.7, [[-0.92, 0.3], [0.44, 0.92]]]].forEach(([f, dens, segs], k) => {
    const win = M.part(PART.WINDOW, seed * 0.37 + 0.13 * (k + 1), -dens);
    const y = yb + (yt - yb) * f;
    for (const [z0, z1] of segs) {
      const p = [[z0, -hb], [z1, -hb], [z1, hb], [z0, hb]].map(([zz, dy]) => {
        const P = at(rb + 0.00008, y + dy, zz * hw);
        return win.v(P.x, P.y, P.z, out.x, out.y, out.z, (zz - z0) * hw, vc + dy);
      });
      win.quad(p[0], p[1], p[2], p[3]);
    }
    // półka pomostu pod pasem okien (stal) — w świetle wrót łapie krawędź
    st.add(new THREE.BoxGeometry(0.0005, 0.00012, hw * 2), radial(ac, rb + 0.00025, y - hb - 0.0001, 0));
  });
  // SUWNICA pod stropem: szyny na ścianach bocznych, most, wózek, lina z hakiem; pod mostem trzy ciepłe lampy (sód)
  const yr = yt - 0.0005, xm = rb + depth * 0.5;
  for (const sg of [-1, 1]) st.add(new THREE.BoxGeometry(depth - 0.0006, 0.0002, 0.0002), radial(ac, rb + (depth - 0.0006) / 2, yr, sg * (hw - 0.0001)));
  st.add(new THREE.BoxGeometry(0.0004, 0.00035, hw * 2), radial(ac, xm, yr - 0.00028, 0));
  st.add(new THREE.BoxGeometry(0.0006, 0.0003, 0.0006), radial(ac, xm, yr - 0.0006, -hw * 0.25));
  bar(st, at(xm, yr - 0.00075, -hw * 0.25), at(xm, yb + 0.0027, -hw * 0.25), 0.00007, 0.00007, X_AX);
  st.add(new THREE.BoxGeometry(0.0003, 0.00022, 0.0003), radial(ac, xm, yb + 0.0026, -hw * 0.25));
  const craneL = M.part(PART.STRIP, 0, -0.55, 0);
  const sc = craneL.count;
  for (const z of [-0.62, 0.04, 0.62]) craneL.add(new THREE.BoxGeometry(0.00028, 0.00018, 0.0005), radial(ac, xm + 0.0003, yr - 0.00055, z * hw));
  pinUv(craneL, sc, STRIP_V, 0.00125);
  // wrota: chłodne listwy progu i nadproża, na posadzce trzy chłodne światła podejścia
  const lip = M.part(PART.STRIP, seed, 0.9, 1);
  for (const y of [yt + wall + 0.00012, yb - wall - 0.00012]) lip.add(new THREE.BoxGeometry(0.00025, 0.00018, hw * 2), radial(ac, r1 + 0.0001, y, 0));
  const land = M.part(PART.STRIP, 0, -0.35, 1);
  const sl = land.count;
  for (const z of [-0.6, 0, 0.6]) land.add(new THREE.BoxGeometry(0.0003, 0.00005, 0.0003), radial(ac, r1 - 0.0004, yb + 0.000025, z * hw));
  pinUv(land, sl, STRIP_V, 0.00125);
  // holownik w hali (pod hakiem suwnicy): kadłub, kabina, światło na dziobie
  const tug = M.part(PART.HULL, 0.77);
  tug.add(new THREE.BoxGeometry(0.0016, 0.0011, 0.0022), radial(ac, r0 + 0.0011, yb + 0.0009, -0.0006));
  tug.add(new THREE.BoxGeometry(0.0009, 0.0007, 0.0011), radial(ac, r0 + 0.0013, yb + 0.0018, -0.0009));
  lamp(M, M.part(PART.BEACON, 0.61, 0.9, 1), at(r0 + 0.0019, yb + 0.0009, -0.0006), out, 0.00016);
  // światła wrót (rogi, na czołach słupków): białe, małe
  const bc = M.part(PART.BEACON, 0.27, 0.7, 1);
  for (const [y, sz] of [[yt + wall * 0.5, -1], [yt + wall * 0.5, 1], [yb - wall * 0.5, -1], [yb - wall * 0.5, 1]]) {
    lamp(M, bc, at(r1 + 0.0004, y, sz * (hw + wall * 0.7)), out, 0.00019);
  }
  // maszt łączności nad pokładem (wzdłuż osi — w kadrze gry kreska w stronę ringu) z anteną talerzową
  const yd = H + S.dh;
  const am = ac - span * 0.3;
  const Pm = polar(R0 + S.dw * 0.5, am, yd), Qm = polar(R0 + S.dw * 0.5, am, yd + 0.0075);
  bar(st, Pm, Qm, 0.0003, 0.0003, X_AX);
  bar(st, polar(R0 + S.dw * 0.5, am, yd + 0.0028), polar(R0 + S.dw * 0.5 + 0.0016, am, yd + 0.0028), 0.00022, 0.00022);
  dishAntenna(M.part(PART.STRUCT, 0.81), 0.0014, 0.00055,
    radial(am, R0 + S.dw * 0.5 + 0.0016, yd + 0.0028, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI * 0.3)));
  lamp(M, M.part(PART.BEACON, 0.43, 0.6, 0), Qm, Y_UP, 0.00024);
}

/** Moduły obok frontu: przeszklona galeria widokowa na zewnętrznej ścianie (szprosy, czoła) i gondola pod stępką. */
function buildOuterDomes(M, R0, W, H, ac, span, seed, side) {
  const glass = M.part(PART.GLASS, seed);
  const st = M.part(PART.STRUCT, seed);
  const rg = 0.0014, fl = 0.6, yc = H * 0.12;
  const arc = (rr) => {
    const p = [];
    for (let k = 0; k <= 6; k++) { const t = -Math.PI / 2 + (k / 6) * Math.PI; p.push([W - 0.0002 + Math.cos(t) * rr * fl, yc + Math.sin(t) * rr]); }
    return p;
  };
  const g0 = ac - span * 0.34, g1 = ac + span * 0.34;
  // SZYBY osobno między szprosami i ślemionami, każda lekko WYPUKŁA (normalne w rogach odchylone od środka szyby) i z
  // własnym PRZEKOSEM (do ~20°, większym niż wypukłość): słońce odbija się tylko w nielicznych szybach, krótkimi
  // błyskami, nie ciągłą białą smugą przez całą galerię (gładka fasetka po łuku łapała je na całej długości)
  const nm = Math.max(3, Math.round((g1 - g0) * R0 / 0.0011));
  const prof = arc(rg);
  const jr = plantRng(Math.floor(seed * 1e6) + 913);
  const tilt = 0.1, jit = 0.35;
  for (let k = 0; k < nm; k++) {
    const am = [g0 + (g1 - g0) * (k / nm), g0 + (g1 - g0) * ((k + 1) / nm)];
    for (let j = 0; j < prof.length - 1; j++) {
      const [r1, y1] = prof[j], [r2, y2] = prof[j + 1];
      const tx = r2 - r1, ty = y2 - y1, len = Math.sqrt(tx * tx + ty * ty);
      const nr = ty / len, ny = -tx / len, dr = tx / len, dy = ty / len;
      const jx = (jr.next() - 0.5) * 2 * jit, jy = (jr.next() - 0.5) * 2 * jit;
      const q = [];
      for (const [ia, ip] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const a = am[ia], c = Math.cos(a), s = Math.sin(a);
        const su = ia ? 1 : -1, sv = ip ? 1 : -1;
        const r = R0 + (ip ? r2 : r1), y = ip ? y2 : y1;
        // normalna fasetki + odchylenie ku rogowi (wzdłuż łuku: −sin, 0, −cos; wzdłuż przekroju: dr, dy) + przekos szyby
        const kt = tilt * su + jx, kp = tilt * sv + jy;
        _n.set(nr * c - kt * s + kp * dr * c, ny + kp * dy, -nr * s - kt * c - kp * dr * s).normalize();
        q.push(glass.v(r * c, y, -r * s, _n.x, _n.y, _n.z));
      }
      glass.quad(q[0], q[1], q[2], q[3]);
    }
  }
  // ślemiona (stal) na co drugim załamaniu przekroju — szyby w siatce, nie pasy na całą długość
  for (const j of [2, 4]) {
    const [pr, py] = prof[j], qq = 0.00007;
    sweep(st, [[pr - qq, py - qq], [pr + qq, py - qq], [pr + qq, py + qq], [pr - qq, py + qq]], R0, g0, g1, 14);
  }
  // szprosy (łuki stali co ~0,0011 R) i czoła galerii
  const mul = [[W - 0.0002, yc - rg - 0.00012], ...arc(rg + 0.00012).slice(1, -1), [W - 0.0002, yc + rg + 0.00012]];
  for (let k = 0; k <= nm; k++) {
    const am = g0 + (g1 - g0) * (k / nm), da = (k === 0 || k === nm ? 0.00035 : 0.00012) / R0;
    sweep(st, mul, R0, am - da, am + da, 1, false);
  }
  const cap = [[W - 0.0003, yc - rg - 0.0002], ...arc(rg + 0.0002).slice(1, -1), [W - 0.0003, yc + rg + 0.0002]];
  sweepCap(st, cap, R0, g0 - 0.0002 / R0, -1);
  sweepCap(st, cap, R0, g1 + 0.0002 / R0, 1);
  // listwa nad galerią (ciepła, cienka)
  sweep(M.part(PART.STRIP, seed, 0.5, 0), [[W + EPS, yc + rg + 0.0004], [W + EPS, yc + rg + 0.0007]], R0, g0, g1, 8, false);
  // gondola pod stępką (w kadrze gry — wypustka w stronę korka)
  const hull = M.part(PART.HULL, seed * 0.3 + 0.5);
  const a = ac - side * span * 0.05;
  hull.add(new THREE.BoxGeometry(0.0032, 0.0034, 0.0042), radial(a, R0 + 0.0008, -H - 0.0022, 0));
  M.part(PART.WINDOW, seed, 0.7).add(new THREE.PlaneGeometry(0.0034, 0.0012), radial(a, R0 + 0.0024 + EPS, -H - 0.0025, 0)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  lamp(M, M.part(PART.BEACON, seed, 0.45, 0), polar(R0 + 0.0008, a, -H - 0.0039), v3(0, -1, 0), 0.00024);
}

/** Wyposażenie modułu mieszkalnego (ziarno): skrzynie, nadbudówka, maszt z anteną albo gondola pod stępką. */
function buildHabKit(M, R0, W, H, S, ac, a0, a1, span, cs, seed, rng) {
  const hull = M.part(PART.HULL, seed);
  const nb = rng.int(3);
  for (let k = 0; k < nb; k++) {
    const side = rng.sign();
    const a = a0 + cs * 3 + rng.next() * (span - cs * 6);
    const sr = 0.0010 + rng.next() * 0.0006, sy = 0.0005 + rng.next() * 0.0006, st = 0.0010 + rng.next() * 0.0016;
    const rr = side * (W - S.c - sr / 2 - 0.0002);
    hull.add(new THREE.BoxGeometry(sr, sy, st), radial(a, R0 + rr, H + sy / 2, 0));
  }
  const kit = rng.int(4);
  const yd = H + S.dh;
  if (kit === 0) {
    // nadbudówka na pokładzie z pasem okien (w kadrze gry — schodek sylwetki ku ringowi)
    const a = ac + (rng.next() - 0.5) * span * 0.3;
    const len = span * R0 * (0.32 + rng.next() * 0.16), hh = 0.0016 + rng.next() * 0.0008;
    hull.add(new THREE.BoxGeometry(S.dw * 1.5, hh, len), radial(a, R0, yd + hh / 2, 0));
    M.part(PART.WINDOW, seed, 0.75).add(new THREE.PlaneGeometry(len * 0.9, hh * 0.35), radial(a, R0 + S.dw * 0.75 + EPS, yd + hh * 0.55, 0)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  } else if (kit === 1) {
    // maszt z anteną talerzową i światłem
    const a = ac + (rng.next() - 0.5) * span * 0.5;
    const P = polar(R0 + S.dw * 0.7, a, yd), Q = polar(R0 + S.dw * 0.7, a, yd + 0.0034 + rng.next() * 0.0024);
    bar(M.part(PART.STRUCT, seed), P, Q, 0.00028, 0.00028, X_AX);
    dishAntenna(M.part(PART.STRUCT, 0.81), 0.0009, 0.00035,
      radial(a, R0 + S.dw * 0.7 + 0.00035, yd + 0.0018, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI * 0.36)));
    lamp(M, M.part(PART.BEACON, rng.next(), 0.3, 1), Q, Y_UP, 0.00022);
  } else if (kit === 2) {
    // gondola pod stępką
    const a = ac + (rng.next() - 0.5) * span * 0.3;
    hull.add(new THREE.BoxGeometry(0.0028, 0.0026, span * R0 * 0.3), radial(a, R0 + 0.0006, -H - S.kh - 0.0011, 0));
    lamp(M, M.part(PART.BEACON, rng.next(), 0.4, 0), polar(R0 + 0.0006, a, -H - S.kh - 0.0024), v3(0, -1, 0), 0.00022);
  }
}

/** BRAMA przekaźnika: oprawa soczewki w pierścieniu (płaszczyzna ⟂ promienia), pierścienie cewek, pancerz, światła. */
function buildGate(M, L, gate, conn) {
  const R0 = L.hubRing;
  const m = gate.basis;
  const hull = M.part(PART.HULL, 0.91);
  const st = M.part(PART.STRUCT, 0.93);
  const s0 = hull.count;
  const c = 0.0006, ri = GATE_IN, ro = GATE_OUT, d = GATE_D;
  // oprawa (przekrój ośmiokątny, obrót wokół osi promienia — lokalne Y)
  prism(hull, [[ri, -d + c], [ri + c, -d], [ro - c, -d], [ro, -d + c], [ro, d - c], [ro - c, d], [ri + c, d], [ri, d - c]], 16, Math.PI / 16, true);
  hull.transformFrom(s0, m);
  // pancerne nakładki na obwodzie (8) i belki do łączników
  const s1 = st.count;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + Math.PI / 8;
    st.add(new THREE.BoxGeometry(0.0016, d * 2 + 0.0008, 0.0022), radial(a, ro + 0.0004, 0, 0));
  }
  st.transformFrom(s1, m);
  // soczewka: trzy pierścienie cewek w świetle oprawy — lejek ku ringowi (w kadrze gry koncentryczne kręgi od czoła)
  const lens = [[0.0041, -d + 0.0005, 0.0], [0.0035, 0, 0.33], [0.0029, d - 0.0005, 0.66]];
  lens.forEach(([r, y, ph], k) => {
    const cb = M.part(PART.COIL, 0.95 + k * 0.01, ph, 0.9);
    const t = new THREE.TorusGeometry(r, 0.00024, 6, 48);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    cb.add(t, m);
    // szprychy uchwytu pierścienia (stal) do oprawy
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * TAU + k * 0.4;
      const P = new THREE.Vector3(Math.cos(a) * (r + 0.0002), y, -Math.sin(a) * (r + 0.0002)).applyMatrix4(m);
      const Q = new THREE.Vector3(Math.cos(a) * (ri + 0.0002), y, -Math.sin(a) * (ri + 0.0002)).applyMatrix4(m);
      bar(st, P, Q, 0.00022, 0.00022);
    }
  });
  // tarcze cewek na obu czołach oprawy (od środka stacji — w kadrze gry pierścień od czoła; od ringu — wylot)
  for (const [y, sg] of [[-d - EPS, -1], [d + EPS, 1]]) {
    const ann = M.part(PART.COIL, 0.97, sg > 0 ? 0.5 : 0.1, 0.55);
    const s2 = ann.count;
    sweep(ann, sg > 0 ? [[ri + 0.0009, y], [ri + 0.0002, y]] : [[ri + 0.0002, y], [ri + 0.0009, y]], 0, 0, TAU, 48, false);
    ann.transformFrom(s2, m);
  }
  // światła na obwodzie (białe, wolne)
  const bc = M.part(PART.BEACON, 0.71, 0.4, 1);
  const gateN = new THREE.Vector3(0, 1, 0).transformDirection(m);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    lamp(M, bc, new THREE.Vector3(Math.cos(a) * (ro - 0.0009), d, -Math.sin(a) * (ro - 0.0009)).applyMatrix4(m), gateN, 0.00026);
  }
  // łącznik z bramy do następnego modułu (poprzedni moduł dochodzi swoim)
  const pitch = TAU / L.hubModules;
  const span = pitch * (1 - L.hubGap);
  const cs = 0.0007 / R0;
  const c0 = gate.ac + gate.connAng;
  const c1 = c0 + angDiff((gate.idx + 1) * pitch - span / 2 + cs, c0);
  sweep(hull, conn, R0, c0, c1, 3);
  sweepCap(hull, conn, R0, c0, -1);
}

// ── Rdzeń: kołnierz szprych (z szczeliną lufy), kołyska, szyja, nadajnik (rdzeń, sfera armilarna, gimbal, lufa) ──────
function buildCore(M, L, lay) {
  const { spokeAz, relayDir: d, aRel } = lay;
  const hull = M.part(PART.HULL, 0.11);
  // KOŁYSKA RDZENIA: niski kołnierz pod nadajnikiem (nadajnik stoi na nim jak na cokole — z boku widać całą maszynę)
  // z misą pod gimbalem; tu dochodzą gniazda stosów magazynu i zastrzały czaszy
  const cIn = 0.0074, cOut = 0.0128, cBot = -0.0068, cTop = -0.0027, ch = 0.0008;
  sweep(hull, [[0.0030, -0.0074], [cOut - ch, cBot], [cOut, cBot + ch], [cOut, cTop - ch], [cOut - ch, cTop], [cIn, cTop],
    [0.0062, -0.0041], [0.0044, -0.0051], [0.0030, -0.0055]], 0, 0, TAU, 64);
  const cb = M.part(PART.COIL, 0.2, 0.0, 0.3);
  sweep(cb, [[cOut + EPS, -0.0052], [cOut + EPS, -0.0046]], 0, 0, TAU, 64, false);
  sweep(cb, [[cOut - ch - 0.0006, cTop + EPS], [cOut - ch - 0.0011, cTop + EPS]], 0, 0, TAU, 64, false);
  // gniazda szprych: kołnierz → stos magazynu
  for (const a of spokeAz) hull.add(new THREE.BoxGeometry(L.hubBankRing - BANK_R - cOut + 0.0008, 0.0034, 0.0036),
    radial(a, (L.hubBankRing - BANK_R + cOut) / 2, -0.0046, 0));
  // szyja do grzbietu czaszy
  prism(hull, [[0, -0.0078], [0.0034, -0.0078], [0.0030, -0.0058], [0, -0.0058]], 12, 0);
  // NADAJNIK (zbudowany dla promienia w lokalnym +Z i obrócony wokół osi do azymutu promienia): świecący rdzeń w sferze
  // armilarnej cewek i w dwóch pierścieniach gimbala; kula ładowania promienia (earthBitePlantBeam.js) mieści się w sferze
  const rot = new THREE.Matrix4().makeRotationY(aRel - Math.PI * 1.5);
  const coreC = M.part(PART.COIL, 0.5, 0.15, 1.0);
  coreC.add(new THREE.IcosahedronGeometry(0.0014, 2), rot);
  const cage = M.part(PART.STRUCT, 0.33);
  let sc = cage.count;
  // oprawy rdzenia na biegunach (dolna obrócona o π wokół X — bez odbicia)
  for (const sg of [-1, 1]) {
    const m = new THREE.Matrix4().makeTranslation(0, sg * 0.0024, 0).multiply(new THREE.Matrix4().makeRotationX(sg > 0 ? 0 : Math.PI));
    const s1 = cage.count;
    prism(cage, [[0, -0.0006], [0.0011, -0.0006], [0.0007, 0.0006], [0, 0.0006]], 8, 0);
    cage.transformFrom(s1, m);
  }
  [[Math.PI / 2, 0], [0, 0], [0, Math.PI / 2]].forEach(([rx, ry], k) => {
    const t = new THREE.TorusGeometry(0.0037, 0.00018, 6, 64);
    t.rotateX(rx);
    t.rotateY(ry);
    M.part(PART.COIL, 0.5 + k * 0.1, k / 3, 0.5).add(t, rot);
  });
  const st = M.part(PART.STRUCT, 0.41);
  const alpha = 25 * Math.PI / 180, beta = 35 * Math.PI / 180;
  const rect = (w, h) => [[-w, -h], [w, -h], [w, h], [-w, h]];
  const outer = new THREE.Matrix4().makeRotationX(alpha);
  const inner = new THREE.Matrix4().makeRotationX(alpha).multiply(new THREE.Matrix4().makeRotationZ(beta));
  const stStart = st.count;
  let s1 = st.count;
  sweep(st, rect(0.00038, 0.00055), 0.006, 0, TAU, 64);
  st.transformFrom(s1, outer);
  s1 = st.count;
  sweep(st, rect(0.00032, 0.00045), 0.0049, 0, TAU, 64);
  st.transformFrom(s1, inner);
  // czopy: wewnętrzny pierścień na zewnętrznym (oś Z'), zewnętrzny na jarzmie (oś X); wsporniki rdzenia
  const zA = v3(0, -Math.sin(alpha), Math.cos(alpha));
  const xI = v3(Math.cos(beta), Math.sin(beta) * Math.cos(alpha), Math.sin(beta) * Math.sin(alpha));
  for (const sg of [-1, 1]) bar(st, xI.clone().multiplyScalar(sg * 0.0016), xI.clone().multiplyScalar(sg * 0.0047), 0.0004, 0.0004);
  for (const sg of [-1, 1]) {
    bar(st, zA.clone().multiplyScalar(sg * 0.0046), zA.clone().multiplyScalar(sg * 0.0063), 0.0005, 0.0005, X_AX);
    bar(st, v3(sg * 0.0057, 0, 0), v3(sg * 0.0068, 0, 0), 0.0007, 0.0007);
    bar(st, v3(sg * 0.0066, -0.0002, 0), v3(sg * (cIn + 0.0012), cTop + 0.0003, 0), 0.0012, 0.0009);
  }
  st.transformFrom(stStart, rot);
  cage.transformFrom(sc, rot);
  // LUFA nadajnika ku ringowi: zamek, korpus z cewkami i kołnierzami, dysza z tarczą cewki (wylot promienia)
  const m = relayBasis(d, v3(0, 0, 0));
  const barrel = M.part(PART.HULL, 0.12);
  sc = barrel.count;
  const r0 = 0.0064, rb = 0.0016, mz = HUB_RELAY_MUZZLE;
  prism(barrel, [[0, r0], [0.0021, r0], [0.0023, r0 + 0.0008], [0.0023, r0 + 0.0022], [rb + 0.0002, r0 + 0.0028],
    [rb, r0 + 0.0032], [rb, mz - 0.0034], [0.0021, mz - 0.0026], [0.0028, mz - 0.0004], [0.0028, mz], [0.0019, mz]], 8, Math.PI / 8);
  barrel.transformFrom(sc, m);
  const bcol = M.part(PART.STRUCT, 0.13);
  sc = bcol.count;
  for (const y of [r0 + 0.0042, r0 + 0.0058, r0 + 0.0074]) {
    prism(bcol, [[0.0012, y - 0.00035], [rb + 0.00045, y - 0.00035], [rb + 0.00045, y + 0.00035], [0.0012, y + 0.00035]], 8, Math.PI / 8, true);
  }
  bcol.transformFrom(sc, m);
  const bco = M.part(PART.COIL, 0.14, 0.2, 0.8);
  sc = bco.count;
  for (const y of [r0 + 0.005, r0 + 0.0066, r0 + 0.0082]) sweep(bco, [[rb + EPS, y - 0.00022], [rb + EPS, y + 0.00022]], 0, 0, TAU, 24, false);
  bco.transformFrom(sc, m);
  // tarcza dyszy (wylot): cewka zwrócona ku ringowi
  const mouth = M.part(PART.COIL, 0.15, 0.6, 1.2);
  sc = mouth.count;
  sweep(mouth, [[0.0019, mz + EPS], [0, mz + EPS]], 0, 0, TAU, 24, false);
  mouth.transformFrom(sc, m);
  // podpory lufy do wierzchu kołnierza
  for (const sg of [-1, 1]) {
    const P = new THREE.Vector3(sg * 0.0019, r0 + 0.0062, 0).applyMatrix4(m);
    const Q = polar(cIn + 0.0022, aRel - sg * 0.42, cTop);
    bar(st, P, Q, 0.0006, 0.0005);
  }
}

// ── Czasza zbierająca z fartuchem (DZWON): płatki szkła, żebra, cewki, obrzeże z cewką, fartuch, ognisko ──────────
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
  // obrzeże (kadłub) z CIĄGŁĄ cienką cewką na zewnętrznej ścianie — z profilu (kadr gry) jasna kreska soczewki
  const yR = surf(Rd);
  const hull = M.part(PART.HULL, 0.66);
  const rim = [[-0.0009, yR - 0.0007], [0.0013, yR - 0.0007], [0.0013, yR + 0.0010], [-0.0009, yR + 0.0010]];
  sweep(hull, rim, Rd, 0, TAU, 128);
  sweep(M.part(PART.COIL, 0.68, 0.1, 0.7), [[0.0013 + EPS, yR - 0.0001], [0.0013 + EPS, yR + 0.00035]], Rd, 0, TAU, 128, false);
  const q = 0.0004, ym = surf(0.0043) - 0.0002;
  sweep(st, [[-q, ym - q], [q, ym - q], [q, ym + q], [-q, ym + q]], 0.0043, 0, TAU, 48);
  // grzbiet (ciemna stal) i żebra grzbietu
  const back = [], backN = [];
  for (let k = 0; k <= 8; k++) {
    const r = 0.003 + (Rd - 0.0006 - 0.003) * (k / 8);
    back.push([r, surf(r) + 0.0008]);
    backN.push(nOut(r));
  }
  lathe(M.part(PART.STRUCT, 0.64), back, backN, 0, TAU, 64);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * TAU;
    const P = [0.0045, 0.010, 0.0155, Rd - 0.001].map((r) => polar(r, a, surf(r) + 0.0011));
    for (let j = 0; j < 3; j++) bar(st, P[j], P[j + 1], 0.0006, 0.0007);
  }
  // FARTUCH: stożek pod obrzeżem (24 ściany) — zewnątrz kadłub, wewnątrz ciemna stal; dwie cewki, żebra, warga ze
  // światłami. W kadrze gry dzwon po stronie korka: chowa koniec promienia i rozbłysk uderzenia.
  const aT = [Rd + 0.0011, yR - 0.0005], aB = [Rd + 0.0034, yR - L.hubApron];
  const sides = 24, rot = Math.PI / sides;
  const ap = M.part(PART.HULL, 0.67);
  prism(ap, [aB, aT], sides, rot);
  prism(M.part(PART.STRUCT, 0.69), [[aT[0] - 0.0006, aT[1]], [aB[0] - 0.0006, aB[1]]], sides, rot);
  const coneAt = (f, off = 0) => {
    const r = aT[0] + (aB[0] - aT[0]) * f, y = aT[1] + (aB[1] - aT[1]) * f;
    return [r + off, y];
  };
  const kk = Math.cos(Math.PI / sides);
  const apC = M.part(PART.COIL, 0.72, 0.4, 0.6);
  for (const f of [0.3, 0.72]) {
    const [r1, y1] = coneAt(f - 0.018), [r2, y2] = coneAt(f + 0.018);
    prism(apC, [[(r2 + 0.00009 / kk), y2], [(r1 + 0.00009 / kk), y1]], sides, rot);
  }
  // żebra fartucha (na krawędziach ścian)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    bar(st, polar(aT[0] + 0.0002, a, aT[1] - 0.0002), polar(aB[0] + 0.0002, a, aB[1] + 0.0004), 0.00045, 0.0004);
  }
  // warga fartucha (stal) i światła: białe i czerwone na przemian
  prism(st, [[aB[0] - 0.0009, aB[1] - 0.0005], [aB[0] + 0.0005, aB[1] - 0.0005], [aB[0] + 0.0005, aB[1] + 0.0005],
    [aB[0] - 0.0009, aB[1] + 0.0005]], sides, rot, true);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * TAU;
    lamp(M, M.part(PART.BEACON, 0.25 + (k % 2) * 0.1, k % 2 ? 0.5 : 0.9, k % 2 ? 0 : 1), polar(aB[0] + 0.0005, a, aB[1]), outDir(a, -0.35), 0.0003);
  }
  // zastrzały grzbiet → kołnierz rdzenia i przewody energii czasza → rdzeń
  for (const a of spokeAz) {
    const P = polar(0.0165, a, surf(0.0165) + 0.001), Q = polar(0.0108, a, -0.0066);
    bar(st, P, Q, 0.0006, 0.0006);
    const off = polar(0.0006, a + Math.PI / 2, 0.0005);
    const g = cylinderPath(P.clone().add(off), Q.clone().add(off), 0.00028);
    F.push(finalizePart(g.geo, PART.PIPE, 0.8, g.len, 1));
  }
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

// ── Szprychy: kratownice magazyn → węzeł modułu, przewody energii w środku ───────────────────────────────────────
/** Kratownica wzdłuż +X od x0 do x1 (przekrój kwadratowy 2s, przęsła Warrena); pręty bez wieczek (końce w węzłach). */
function truss(B, x0, x1, s) {
  const bays = Math.max(2, Math.round((x1 - x0) / 0.0026));
  const cw = 0.00042, fw = 0.0003;
  for (const [y, z] of [[s, s], [s, -s], [-s, s], [-s, -s]]) bar(B, v3(x0, y, z), v3(x1, y, z), cw, cw, Y_UP, false);
  for (let k = 0; k <= bays; k++) {
    const x = x0 + (x1 - x0) * (k / bays);
    bar(B, v3(x, s, -s), v3(x, s, s), fw, fw, Y_UP, false);
    bar(B, v3(x, -s, -s), v3(x, -s, s), fw, fw, Y_UP, false);
    bar(B, v3(x, -s, s), v3(x, s, s), fw, fw, X_AX, false);
    bar(B, v3(x, -s, -s), v3(x, s, -s), fw, fw, X_AX, false);
    if (k === bays) break;
    const xb = x0 + (x1 - x0) * ((k + 1) / bays);
    const f = k % 2 ? 1 : -1;
    bar(B, v3(x, s, -s * f), v3(xb, s, s * f), fw, fw, Y_UP, false);
    bar(B, v3(x, -s, s * f), v3(xb, -s, -s * f), fw, fw, Y_UP, false);
    bar(B, v3(x, -s * f, s), v3(xb, s * f, s), fw, fw, X_AX, false);
    bar(B, v3(x, s * f, -s), v3(xb, -s * f, -s), fw, fw, X_AX, false);
  }
}

function buildSpokes(M, F, L, lay) {
  const R0 = L.hubRing;
  const xNode = R0 - L.hubTubeW * 1.22 - 0.0032;
  const xb = L.hubBankRing;
  lay.spokeAz.forEach((a, k) => {
    const m = radial(a);
    const st = M.part(PART.STRUCT, k / lay.spokeAz.length);
    truss(st, xb + BANK_R - 0.0002, xNode + 0.0002, 0.0013);
    st.transformFrom(0, m);
    // przewód energii w osi kratownicy: magazyn → pierścień
    const g = cylinderPath(polar(xb + BANK_R - 0.0004, a, 0), polar(xNode + 0.0006, a, 0), 0.00042);
    F.push(finalizePart(g.geo, PART.PIPE, 0.3 + k * 0.1, g.len, 1));
    buildBank(M, L, a, k / lay.spokeAz.length, lay.spireAz.includes(a));
  });
}

// ── MAGAZYN: stos ciemnych ogniw (graniaste, żebrowane) z cienkimi pierścieniami cewek między ogniwami ─────────────
function buildBank(M, L, a, seed, spire) {
  const m = radial(a, L.hubBankRing, 0, 0);
  const Rc = BANK_R, ch = 0.00045, rIn = 0.0011, cells = 4, g = 0.0005;
  const t = (BANK_HALF * 2 - (cells - 1) * g) / cells;
  const cell = M.part(PART.STRUCT, seed);
  const hull = M.part(PART.HULL, seed);
  const coil = M.part(PART.COIL, seed, 0, -1);
  const rib = M.part(PART.STRUCT, seed * 0.5 + 0.25);
  const sides = 12, a0 = Math.PI / sides;
  prism(hull, [[0, -BANK_HALF - 0.0014], [rIn, -BANK_HALF - 0.0014], [rIn, BANK_HALF + 0.0004], [0, BANK_HALF + 0.0004]], 8, 0);
  for (let k = 0; k < cells; k++) {
    const yb = -BANK_HALF + k * (t + g), yt = yb + t;
    prism(cell, [[rIn, yb], [Rc - ch, yb], [Rc, yb + ch], [Rc, yt - ch], [Rc - ch, yt], [rIn, yt]], sides, a0);
    if (k < cells - 1) {
      // szczelina między ogniwami: wpuszczony pierścień cewki (wskaźnik naładowania)
      const rc = Rc - 0.0005;
      prism(coil, [[rc, yt + 0.00011], [rc, yt + g - 0.00011]], sides, a0);
      prism(hull, [[rIn, yt], [rc - 0.0001, yt], [rc - 0.0001, yt + g], [rIn, yt + g]], sides, a0);
    }
  }
  // żebra chłodzące wzdłuż stosu (co druga ściana)
  for (let j = 0; j < sides; j += 2) {
    const aj = a0 + j * (TAU / sides) + Math.PI / sides;
    const r = Rc * Math.cos(Math.PI / sides) + 0.00012;
    bar(rib, polar(r, aj, -BANK_HALF + 0.0003), polar(r, aj, BANK_HALF - 0.0003), 0.00028, 0.00024);
  }
  // pierścienie cewki na czołach stosu (od góry — wskaźnik widoczny z kadrów nad odbiornikiem)
  if (!spire) prism(coil, [[0.0028, BANK_HALF + EPS], [0.0019, BANK_HALF + EPS]], sides, a0);
  prism(coil, [[0.0019, -BANK_HALF - EPS], [0.0028, -BANK_HALF - EPS]], sides, a0);
  for (const B of [cell, hull, coil, rib]) B.transformFrom(0, m);
  if (spire) buildSpire(M, L, a);
}

/** IGLICA nadajnika na stosie magazynu (wzdłuż +A): cokół, maszt graniasty, tarcze z cewkami, światła na szczycie. */
function buildSpire(M, L, a) {
  const m = radial(a, L.hubBankRing, 0, 0);
  const y0 = BANK_HALF, yS = L.hubSpireH;
  const hull = M.part(PART.STRUCT, 0.17);
  const st = M.part(PART.STRUCT, 0.19);
  const coil = M.part(PART.COIL, 0.21, 0.3, 0.7);
  const s0h = hull.count, s0s = st.count, s0c = coil.count;
  prism(hull, [[0, y0], [0.0023, y0], [0.0023, y0 + 0.0009], [0.0016, y0 + 0.0024], [0.0011, y0 + 0.0038], [0, y0 + 0.0038]], 8, Math.PI / 8);
  prism(st, [[0, y0 + 0.0038], [0.00085, y0 + 0.0038], [0.00055, yS - 0.0032], [0.00022, yS], [0, yS]], 8, Math.PI / 8);
  const nD = 4;
  for (let k = 0; k < nD; k++) {
    const y = y0 + 0.0075 + k * ((yS - y0 - 0.0115) / (nD - 1));
    const rd = 0.0025 - k * 0.00035;
    prism(st, [[0, y - 0.00022], [rd, y - 0.00022], [rd, y + 0.00022], [0, y + 0.00022]], 12, 0);
    prism(coil, [[rd + EPS, y - 0.00016], [rd + EPS, y + 0.00016]], 12, 0);
  }
  hull.transformFrom(s0h, m);
  st.transformFrom(s0s, m);
  coil.transformFrom(s0c, m);
  const P = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
  lamp(M, M.part(PART.BEACON, 0.07 + (a > 1 ? 0.3 : 0), 0.7, 1), v3(P.x, yS, P.z), Y_UP, 0.0003);
  lamp(M, M.part(PART.BEACON, 0.37 + (a > 1 ? 0.2 : 0), 0.45, 0), v3(P.x + 0.0007 * Math.cos(a), y0 + 0.0115, P.z - 0.0007 * Math.sin(a)),
    outDir(a), 0.00022);
}

// ── ŁOPATY RADIATORÓW: ciemna, matowa blacha (krawędzią do osi gryzu) o PŁYTKIEJ fali, grube rury cieplne ─────────────
// Blacha to płyty żaru (HOT) o niskim cieple: najciemniejszy i najbardziej matowy metal — grzbiety nie łapią szarego
// połysku (głęboka fala z jasnymi grzbietami czytała się jak żaluzje); u nasady szwy płyt ledwie się żarzą (nocą łopata
// nie znika). Rysunek łopaty dają RURY CIEPLNE (sześć grubych po obu stronach, żar od nasady gasnący ku końcowi), rama
// z żarem, kolektor i usztywnienia. Nocą obrys: cienka ciepła listwa na krawędziach i światła pozycyjne w rogach końca.
const Z_AX = new THREE.Vector3(0, 0, 1);
function buildRadiators(M, L, lay) {
  const R0 = L.hubRing;
  const root = R0 + L.hubTubeW * 1.22 + 0.0004;
  const s0 = root + 0.0012, s4 = root + L.hubRadLen;
  const x0 = s0 + 0.0016;                       // początek blachy (za kolektorem)
  const h0 = L.hubRadH, h1 = L.hubRadH * 0.55;  // pół-wysokość u nasady i na końcu (zwężenie — wrzeciono w kadrze gry)
  const h = (x) => h0 + (h1 - h0) * (x - s0) / (s4 - s0);
  const tp = 0.00016, dz = 0.00007, nL = 17;    // grubość blachy, amplituda (płytka — ~4°) i liczba linii fal
  // żar: od nasady gaśnie ku końcowi łopaty (rampa c³ materiału); rury z ≈ 0,6 u nasady (pomarańcz na progu bloomu)
  const heatOf = (zo) => (i, x, y, z) => {
    const t = Math.min(1, Math.max(0, (Math.sqrt(x * x + z * z) - s0) / (s4 - s0)));
    return zo * (1 - 0.68 * t);
  };
  // rury: własne uv (z < 0 — kontrakt, |z| — żar) z SZWEM płyt żaru wzdłuż osi każdej ściany rury (`seamBars`) —
  // ciemna rura z gorącą linią na całej długości (w rzucie pudełkowym żar dawał tylko kropki na przecięciach szwów)
  const hotPipe = M.part(PART.HOT, 0.31, (i, x, y, z) => -heatOf(0.46)(i, x, y, z));
  const hotEdge = M.part(PART.HOT, 0.37, heatOf(0.4));
  const sheet = M.part(PART.HOT, 0.53, heatOf(0.2));
  const edgeL = M.part(PART.STRIP, 0.29, -0.17, 0);
  // linie fal: k parzyste — grzbiet od przodu (z = +dz), nieparzyste — dolina
  const lineY = (k, x) => ((k / (nL - 1)) * 2 - 1) * (h(x) - 0.0005);
  const lineZ = (k) => (k % 2 ? -dz : dz);
  lay.radAz.forEach((a, k) => {
    const m = radial(a);
    const seed = k / lay.radAz.length;
    const node = lay.nodeAz.has(a);
    const W = L.hubTubeW * (node ? 1.22 : 1);
    const S = M.part(PART.STRUCT, seed);
    const hull = M.part(PART.HULL, seed);
    const sp = hotPipe.count, se = hotEdge.count, ss = sheet.count, sl = edgeL.count;
    // nasada na ścianie modułu i dźwigar łopaty wzdłuż osi
    hull.add(new THREE.BoxGeometry(s0 + 0.0004 - (R0 + W - 0.0006), 0.0098, 0.0028),
      new THREE.Matrix4().makeTranslation((s0 + 0.0004 + R0 + W - 0.0006) / 2, 0, 0));
    bar(S, v3(s0, -h0 - 0.0005, 0), v3(s0, h0 + 0.0005, 0), 0.0012, 0.0014, X_AX);
    // blacha: pasy między liniami fal, obie strony (normalne płaskie, w stronę strony)
    const xa = x0, xb = s4;
    for (const side of [1, -1]) {
      const zo = side * tp / 2;
      for (let j = 0; j < nL - 1; j++) {
        const A0 = v3(xa, lineY(j, xa), lineZ(j) + zo), A1 = v3(xa, lineY(j + 1, xa), lineZ(j + 1) + zo);
        const B1 = v3(xb, lineY(j + 1, xb), lineZ(j + 1) + zo), B0 = v3(xb, lineY(j, xb), lineZ(j) + zo);
        _n.subVectors(B1, A0).cross(_p.subVectors(B0, A1)).normalize();
        if (_n.z * side < 0) _n.negate();
        const q = [A0, A1, B1, B0].map((P) => sheet.v(P.x, P.y, P.z, _n.x, _n.y, _n.z, P.x, P.y));
        sheet.quad(q[0], q[1], q[2], q[3]);
      }
    }
    // RURY CIEPLNE: sześć grubych po obu stronach (nad grzbietami fal), zbiegają się ze zwężeniem łopaty
    const rp = 0.00021, xe = s4 - 0.0012;
    for (let j = 0; j < 6; j++) {
      const f = (2 * j + 1) / 6 - 1;
      for (const side of [1, -1]) {
        const z = side * (dz + tp / 2 + rp);
        bar(hotPipe, v3(x0 - 0.0006, f * (h(x0) - 0.0005), z), v3(xe, f * (h(xe) - 0.0005), z), rp * 2, rp * 2, Z_AX);
      }
    }
    seamBars(hotPipe, sp, rp * 2 * 1.3);
    // kolektor u nasady (pion wzdłuż osi, obie strony) i krawędzie łopaty (rama z żarem gasnącym ku końcowi)
    for (const sg of [-1, 1]) {
      bar(hotEdge, v3(s0 + 0.0009, -h0 + 0.0003, sg * (dz + 0.0004)), v3(s0 + 0.0009, h0 - 0.0003, sg * (dz + 0.0004)), 0.0006, 0.0005, X_AX);
    }
    for (const sg of [-1, 1]) bar(hotEdge, v3(s0, sg * (h0 - 0.0001), 0), v3(s4, sg * (h1 - 0.0001), 0), 0.0005, dz * 2 + 0.0006, Z_AX);
    // usztywnienia w poprzek blachy (dwa, obie strony) i belka końca
    for (const f of [0.36, 0.7]) {
      const x = s0 + (s4 - s0) * f, hx = h(x) - 0.0003;
      for (const sg of [-1, 1]) bar(S, v3(x, -hx, sg * (dz + tp / 2 + rp * 2 + 0.00013)), v3(x, hx, sg * (dz + tp / 2 + rp * 2 + 0.00013)), 0.0005, 0.00026, Z_AX);
    }
    bar(S, v3(s4 + 0.0003, -h1 - 0.0002, 0), v3(s4 + 0.0003, h1 + 0.0002, 0), 0.0008, dz * 2 + 0.0007, Z_AX);
    // OBRYS NOCĄ: ciepła listwa w segmentach na krawędziach (górna, dolna — nad ramą żaru; czoło końca), słaba — pod
    // progiem bloomu i pod jasnością korony (chłodny pełny obrys czytał się jak ramka zaznaczenia)
    const lw = 0.00016, lt = 0.00016, xt = s4 + 0.0007 + lw / 2;
    for (const sg of [-1, 1]) {
      bar(edgeL, v3(s0 + 0.002, sg * (h(s0 + 0.002) + 0.00015 + lw / 2), 0), v3(xt, sg * (h(xt) + 0.00015 + lw / 2), 0), lw, lt, Z_AX);
    }
    bar(edgeL, v3(xt, -h1 - 0.0002 - lw, 0), v3(xt, h1 + 0.0002 + lw, 0), lw, lt, Z_AX);
    pinUv(edgeL, sl, STRIP_V);
    for (const B of [S, hull]) B.transformFrom(0, m);
    hotPipe.transformFrom(sp, m);
    hotEdge.transformFrom(se, m);
    sheet.transformFrom(ss, m);
    edgeL.transformFrom(sl, m);
    // światła pozycyjne w rogach końca łopaty (czerwone / białe — na przemian w rogach i między łopatami)
    for (const sg of [1, -1]) {
      const white = (k + (sg > 0 ? 0 : 1)) % 2;
      const S0 = v3(s4 + 0.0007, sg * (h1 + 0.0002), 0).applyMatrix4(m);
      lamp(M, M.part(PART.BEACON, ((k * 2 + (sg > 0 ? 0 : 1)) % 4) * 0.25, 0.5, white), S0, v3(1, sg, 0).normalize().transformDirection(m), 0.0003);
    }
  });
}

/** Układ odbiornika: azymuty szprych, iglic, łopat, brama przekaźnika i moduł frontu. */
function hubLayout(L, b) {
  const n = L.hubModules;
  const pitch = TAU / n;
  const snap = (a) => (((Math.round(a / pitch) % n) + n) % n) * pitch;
  const idx = (a) => ((Math.round(a / pitch) % n) + n) % n;
  const spokeAz = [];
  for (let k = 0; k < L.hubSpokes; k++) spokeAz.push(snap((k / L.hubSpokes) * TAU));
  const nodes = new Set(spokeAz.map(idx));
  const nodeAz = new Set(spokeAz);
  // promień przekaźnikowy: azymut i nachylenie w ramie odbiornika
  const relayDir = hubRelayDir(L, b);
  const dh = Math.sqrt(relayDir.x * relayDir.x + relayDir.z * relayDir.z);
  const aRel = ((Math.atan2(-relayDir.z, relayDir.x) % TAU) + TAU) % TAU;
  const yCross = dh > 1e-6 ? L.hubRing * relayDir.y / dh : Infinity;
  let gate = null;
  const gi = idx(aRel);
  if (dh > 0.3 && Math.abs(yCross) < 0.006 && !nodes.has(gi)) {
    const P = v3(L.hubRing * Math.cos(aRel), yCross, -L.hubRing * Math.sin(aRel));
    // łącznik do oprawy: tam, gdzie płaszczyzna pierścienia (y = 0) przecina oprawę bramy
    const tCon = Math.sqrt(Math.max(GATE_OUT * GATE_OUT - yCross * yCross, 0)) - 0.0003;
    gate = { idx: gi, ac: aRel, basis: relayBasis(relayDir, P), connAng: Math.max(tCon, GATE_IN + 0.0006) / L.hubRing };
  }
  const front = idx(aRel + Math.PI);
  // łopaty co 30° bez południka promienia (brama i front: w kadrze gry łopata leżałaby na linii promieni)
  const radAz = [];
  for (let k = 0; k < L.hubRadiators; k++) {
    const a = snap((k / L.hubRadiators) * TAU);
    if (Math.abs(angDiff(a, aRel)) < 0.35 || Math.abs(angDiff(a, aRel + Math.PI)) < 0.35) continue;
    if (!radAz.includes(a)) radAz.push(a);
  }
  const radMods = new Set(radAz.map(idx));
  // iglice: na stosach magazynu najbliżej kierunków prostopadłych do promienia przekaźnikowego
  const spireAz = [];
  for (const t of [aRel + Math.PI / 2, aRel - Math.PI / 2]) {
    let best = spokeAz[0];
    for (const a of spokeAz) if (Math.abs(angDiff(a, t)) < Math.abs(angDiff(best, t))) best = a;
    if (!spireAz.includes(best)) spireAz.push(best);
  }
  return { spokeAz, nodes, nodeAz, radAz, radMods, relayDir, aRel, gate, front, spireAz };
}

/** Odbiornik: { metal: części, flow: części } w ramie elektrowni. */
export function buildOrbital(L, b) {
  const hHub = hubHeight(L, b);
  const rng = plantRng(L.hubSeed);
  const M = partList();
  const flow = [];
  const lay = hubLayout(L, b);
  buildRing(M, L, rng, lay);
  buildCore(M, L, lay);
  buildDish(M, flow, L, lay.spokeAz);
  buildSpokes(M, flow, L, lay);
  buildRadiators(M, L, lay);
  for (const g of flow) g.translate(0, hHub, 0);
  return { metal: M.finish(hHub), flow };
}
