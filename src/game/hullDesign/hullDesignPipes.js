// src/game/hullDesign/hullDesignPipes.js
//
// KREATOR KADŁUBÓW — SIEĆ RUR (czysta: bez three i DOM; testy tests/hullDesign.test.mjs). Wzór: sprite'y Terra Novy —
// wiązki 2–7 rur o różnych średnicach w rowach maszynowni między płytami, proste i 45° z zaokrąglonymi kolanami,
// znikające pod płytami (kołnierz na wejściu), z osprzętem (skrzynki rozdzielcze, zawory, pompy, kolektory przy
// gondolach, obejmy); najgęściej przy rufie i wokół gondoli silników, rzadko ku dziobowi.
//
// GENERATOR (deterministyczny z ziarna projektu, `design.pipeNet = { density, seed }`, gęstość 0 — brak sieci):
//   1. siatka trasowania (komórka HD_PIPE_TUNE.cellDu jd) nad kadłubem — przy lustrze tylko burta y < 0 (druga
//      to lustro wyniku: symetria z konstrukcji, połowa pracy); koszt komórki: rów maszynowni tanio (najtaniej przy
//      ścianie płyty), pod płytą drożej (rura chowa się pod płytę), przez moduł najdrożej, przy sylwetce zakaz,
//   2. drzewo od korzenia (reaktor; bez niego mostek albo pierwsza gondola): kolejne cele dołączają najkrótszą trasą
//      (A* w stanach komórka × kierunek: 8 kierunków = 45°, kara za skręt; heurystyka = odległość do drzewa) do
//      NAJBLIŻSZEGO miejsca rosnącej sieci — najpierw gondole silników, potem moduły (wieże, pierścienie, wrota,
//      mostek) i punkty wzdłuż grzbietu (zawsze najbliższy cel pierwszy), na końcu cele wypełnienia (komórki rowów
//      najdalej od sieci, z wagą ku rufie) — sieć wchodzi w każdy większy rów,
//   3. trasy: każdy cel karmi najbliższa po drzewie gondola (z wyrównaniem obciążenia), każda gondola — reaktor;
//      liczba tras przez krawędź drzewa → liczba rur w wiązce (1 + k · log2(1 + trasy)) — koncentracja przy
//      silnikach wychodzi sama,
//   4. biegi (odcinki drzewa między węzłami) → łamane PROSTE: schodki trasy A* → najwyżej dwa odcinki (prosty + 45°),
//      gdy koszt nie rośnie (straightenOctilinear); każdy prosty odcinek z JEDNYM przesunięciem w poprzek, przy którym
//      wiązka mieści się w rowie (pole wolnego miejsca), rogi z przecięć przesuniętych prostych (offsetRun) — wiązka
//      biegnie równolegle do ściany jak w czystym sprite'cie Bellatora, bez falowania za ząbkami; kolana zaokrąglone
//      promieniem z szerokości wiązki,
//   5. osprzęt: skrzynki rozdzielcze w rozgałęzieniach, kołnierze na wejściach pod płyty i w moduły, zaślepki na
//      końcach, zawory na długich odcinkach, pompy i kolektory przy gondolach.
// Do tego RĘCZNE rury projektu (`design.pipes`: łamana, liczba rur, materiał; domyślnie leżą też na płytach).
//
// RASTER (rasterPipeNetwork): na siatce pola (jak grooveField) — dla tekseli przy wiązkach przesunięcie w poprzek
// od osi biegu ze znakiem [j.], cos / sin fazy długości łuku (obejmy co clampDu jd), numer odcinka między obejmami
// (kołnierze rur), numer biegu i numer elementu osprzętu; kompozytor (src/3d/hullDesign/hullComposer.js) rysuje z tego
// rury, obejmy i osprzęt. Wymiary rur i osprzętu w jd.

import { HD_MODULES } from './hullDesignSchema.js';

export const HD_PIPE_TUNE = Object.freeze({
  cellDu: 5,            // komórka trasowania [jd]
  freeDu: 2,            // komórka pola wolnego miejsca (przesuw wiązek w rowie) [jd]
  edgeDu: 3,            // oś rury co najmniej tyle jd wewnątrz sylwetki
  cost: Object.freeze({
    gap: 1, plate: 4, module: 9, halo: 1.1, axis: 2.5, edge: 0.6, wall: 0.45,
    turn45: 0.8, turn90: 2.4, turn135: 7
  }),
  haloCells: 2,         // pas kary wokół sieci [komórki] — równoległe wiązki nie nachodzą na siebie
  heurK: 1.3,           // A* ważone: heurystyka × k (szybciej, trasy prawie najkrótsze)
  spineStepDu: 105,     // punkty wzdłuż grzbietu co … [jd]
  spineBand: 0.45,      // … nie dalej od osi niż ułamek pół-szerokości
  fillPerDensity: 11,   // cele wypełnienia na burtę przy gęstości 1
  fillMinCells: 5,      // wypełnienie tylko komórek dalej od sieci niż … [komórki]
  rearBias: 0.72,       // waga celów ku dziobowi: 1 − rearBias · u (u: 0 rufa → 1 dziób)
  maxPipes: 8,
  fillShare: 0.65,      // wiązka wypełnia co najmniej taki ułamek szerokości rowu (mediana na widocznej długości)
  pipesK: 1.3,          // rur w wiązce: 1 + k · log2(1 + trasy)
  rThin: Object.freeze([1.15, 1.8]), rThick: Object.freeze([2.2, 3.1]), thickP: 0.72, gap: Object.freeze([0.25, 0.55]),
  clearDu: 0.5,         // luz wiązki od ścian [jd]
  shiftDu: 9,           // przesuw wiązki w poprzek najwyżej [jd]
  filletK: 1.2,         // promień kolana = k · (pół-szerokość + najgrubsza rura) [jd]
  clampDu: 26,          // okres obejm [jd]
  valveDu: 95,          // zawór / kołnierz co ~ [jd] na długich widocznych odcinkach
  maxRuns: 255,
  maxFits: 255
});

/** Rodzaje osprzętu (te same kody rysuje kompozytor: _pipeNet w hullComposer.js) i ich pierwszeństwo przy nakładaniu. */
export const HD_PIPE_FIT = Object.freeze({ box: 1, collar: 2, valve: 3, pump: 4, collector: 5, cap: 6 });
const FIT_PRIO = Object.freeze({ 6: 0, 3: 1, 2: 2, 4: 3, 5: 4, 1: 5 });
/** Materiały rur (ręczne): mieszane, stal, miedź. */
export const HD_PIPE_MATS = Object.freeze(['mix', 'steel', 'copper']);

const SQ2 = Math.SQRT2;
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DL = [1, SQ2, 1, SQ2, 1, SQ2, 1, SQ2];

function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Pole modułu [j.] (koło / prostokąt z obrotem) — obrys przeszkody (obudowy wież sięgają ~1,2 promienia). */
export function pipeModuleSdf(m, x, y) {
  const def = HD_MODULES[m.type];
  if (def.r) {
    const k = m.type.startsWith('turret_') ? 1.22 : 1.04;
    return Math.hypot(x - m.x, y - m.y) - (m.r || def.r) * k;
  }
  let dx = x - m.x, dy = y - m.y;
  if (m.rot) {
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    dx = lx; dy = ly;
  }
  const qx = Math.abs(dx) - m.w, qy = Math.abs(dy) - m.h;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
function moduleBox(m) {
  const def = HD_MODULES[m.type];
  const R = def.r ? (m.r || def.r) * 1.25 : Math.hypot(m.w, m.h);
  return [m.x - R, m.y - R, m.x + R, m.y + R];
}
/** Moduł rysowany (przeszkoda dla rur) — reaktor wewnątrz (v ≥ 1) nie ma bryły. */
const isObstacle = (m) => !(m.type === 'reactor' && (m.v || 0) >= 1);

/** Próbnik dwuliniowy pola poziomu (poza siatką — pasmo). */
function fieldSampler(field) {
  const { x0, y0, w, h, res } = field.grid;
  const band = field.band;
  return (arr, x, y) => {
    const fx = (x - x0) * res - 0.5, fy = (y - y0) * res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return band;
    const tx = fx - i, ty = fy - j;
    const k = j * w + i;
    const a = arr[k], b = arr[k + 1], c = arr[k + w], d = arr[k + w + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/** Kopiec binarny (klucz float, wartość int) na tablicach typowanych. */
class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; this.top = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const out = V[0];
    this.top = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return out;
  }
}

/** Łamana otwarta z zaokrąglonymi kolanami (promień R, łuk ≤ stepDeg); końce bez zmian. */
export function filletPolyline(pts, R, stepDeg = 15) {
  if (pts.length < 3 || !(R > 0)) return pts.map((p) => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const P = pts[i - 1], V = pts[i], N = pts[i + 1];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) continue;
    const ix = (V[0] - P[0]) / lp, iy = (V[1] - P[1]) / lp, ox = (N[0] - V[0]) / ln, oy = (N[1] - V[1]) / ln;
    const cosA = clamp(ix * ox + iy * oy, -1, 1);
    const alpha = Math.acos(cosA);
    if (alpha < 1e-3) { out.push([V[0], V[1]]); continue; }
    const tanHalf = Math.tan((Math.PI - alpha) * 0.5);
    let t = R / Math.max(tanHalf, 1e-6);
    const tMax = Math.min(i === 1 ? lp * 0.9 : lp * 0.5, i === n - 2 ? ln * 0.9 : ln * 0.5);
    if (t > tMax) t = tMax;
    const r = t * tanHalf;
    if (r < 1e-3) { out.push([V[0], V[1]]); continue; }
    const side = ix * oy - iy * ox > 0 ? 1 : -1;
    const T1x = V[0] - ix * t, T1y = V[1] - iy * t;
    const cx = T1x - iy * r * side, cy = T1y + ix * r * side;
    const a0 = Math.atan2(T1y - cy, T1x - cx);
    const steps = Math.max(1, Math.ceil(alpha / (stepDeg * Math.PI / 180)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * alpha * (k / steps);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  // bez punktów prawie pokrywających się (styk łuku z sąsiednim łukiem / końcem odcinka)
  const eps = R * 0.02;
  const clean = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const q = clean[clean.length - 1];
    if (Math.hypot(out[i][0] - q[0], out[i][1] - q[1]) > eps || i === out.length - 1) clean.push(out[i]);
  }
  if (clean.length > 2) {
    const q = clean[clean.length - 2], e = clean[clean.length - 1];
    if (Math.hypot(e[0] - q[0], e[1] - q[1]) <= eps) clean.splice(clean.length - 2, 1);
  }
  return clean;
}

/** Promienie rur wiązki (jd) z ziarna: grube stalowe i cieńsze; najgrubsza zwykle na brzegu. */
function pipeRadii(seedRand, n, scale = 1) {
  const T = HD_PIPE_TUNE;
  const out = [];
  const thick = n >= 2 && seedRand() < T.thickP;
  const thickAt = thick ? (seedRand() < 0.6 ? 0 : Math.min(n - 1, 1 + Math.floor(seedRand() * 2))) : -1;
  const thick2 = n >= 5 && seedRand() < 0.45 ? Math.min(n - 1, thickAt + 3) : -1;
  for (let k = 0; k < n; k++) {
    const big = k === thickAt || k === thick2;
    const [lo, hi] = big ? T.rThick : T.rThin;
    out.push((lo + (hi - lo) * seedRand()) * scale);
  }
  return out;
}

/**
 * Sieć rur projektu (null, gdy gęstość 0 i brak rur ręcznych). `field` — buildHullField (pola poziomów, moduły
 * rozwinięte, projekt). Zwraca { runs: [{ radii [jd], halfW [jd], gap, rMax, mat (0 mix, 1 stal, 2 miedź), over,
 * phase [j.], count, n, polys: [[[x, y], …], …] (kopia lustra w tym samym biegu) }], fits: [{ type, x, y, rot, hw,
 * hh [jd], p1, p2 }], clampJ [j.], stats }.
 */
export function buildPipeNetwork(field, tuneIn = {}) {
  const T = { ...HD_PIPE_TUNE, ...tuneIn, cost: { ...HD_PIPE_TUNE.cost, ...(tuneIn.cost || {}) } };
  const { design, modules } = field.expanded;
  const manual = field.expanded.pipes || [];
  const density = design.pipeNet?.density || 0;
  if (!(density > 0) && !manual.length) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const D = design.detail;
  const S = fieldSampler(field);
  const L0 = field.levels[0], L1 = field.levels[1];
  const mirror = design.mirror;
  const rand = rng(((design.seed || 7) * 7919 + (design.pipeNet?.seed || 0) * 104729 + 17) >>> 0);
  const runs = [];
  const fits = [];
  const obstacles = modules.filter(isObstacle);
  const bnd = field.bounds;
  const stats = { cells: 0, routes: 0, searches: 0, expanded: 0 };

  // ── pole wolnego miejsca (komórka freeDu jd): min(odległość od płyt, od sylwetki, od modułów, od osi lustra) [j.] ──
  const cf = T.freeDu * D;
  const fx0 = Math.floor(bnd.minX / cf) - 1, fy0 = Math.floor(bnd.minY / cf) - 1;
  const FW = Math.ceil(bnd.maxX / cf) + 2 - fx0, FH = Math.ceil((mirror ? cf : bnd.maxY) / cf) + 2 - fy0;   // lustro: burta y < 0
  const fs = new Float32Array(FW * FH);
  const fsMod = new Float32Array(FW * FH).fill(1e4);
  const modReach = 24 * D;
  for (const m of obstacles) {
    const b = moduleBox(m);
    const i0 = Math.max(0, Math.floor((b[0] - modReach) / cf) - fx0), i1 = Math.min(FW - 1, Math.ceil((b[2] + modReach) / cf) - fx0);
    const j0 = Math.max(0, Math.floor((b[1] - modReach) / cf) - fy0), j1 = Math.min(FH - 1, Math.ceil((b[3] + modReach) / cf) - fy0);
    for (let j = j0; j <= j1; j++) {
      const y = (fy0 + j) * cf;
      for (let i = i0; i <= i1; i++) {
        const v = pipeModuleSdf(m, (fx0 + i) * cf, y);
        const k = j * FW + i;
        if (v < fsMod[k]) fsMod[k] = v;
      }
    }
  }
  for (let j = 0; j < FH; j++) {
    const y = (fy0 + j) * cf;
    for (let i = 0; i < FW; i++) {
      const x = (fx0 + i) * cf;
      const k = j * FW + i;
      let v = Math.min(S(L1, x, y), -S(L0, x, y), fsMod[k]);
      if (mirror) v = Math.min(v, Math.abs(y));
      fs[k] = v;
    }
  }
  const fsAt = (x, y) => {
    const fx = x / cf - fx0, fy = y / cf - fy0;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= FW || j + 1 >= FH) return -1e3;
    const tx = fx - i, ty = fy - j, k = j * FW + i;
    return (fs[k] + (fs[k + 1] - fs[k]) * tx) * (1 - ty) + (fs[k + FW] + (fs[k + FW + 1] - fs[k + FW]) * tx) * ty;
  };
  /** Widoczne miejsce rury z ziemi (rów maszynowni, nie moduł, nie pod płytą, wewnątrz sylwetki). */
  const visAt = (x, y) => S(L1, x, y) >= 0 && S(L0, x, y) < 0 && modMin(x, y) > 0;
  const modMin = (x, y) => {
    const fx = x / cf - fx0, fy = y / cf - fy0;
    const i = Math.round(fx), j = Math.round(fy);
    if (i < 0 || j < 0 || i >= FW || j >= FH) return 1e4;
    return fsMod[j * FW + i];
  };

  // ── sieć generowana ──
  if (density > 0) {
    const c = T.cellDu * D;
    const gx0 = Math.floor(bnd.minX / c), gx1 = Math.ceil(bnd.maxX / c);
    const gy0 = Math.floor(bnd.minY / c), gy1 = mirror ? 0 : Math.ceil(bnd.maxY / c);
    const GW = gx1 - gx0, GH = Math.max(1, gy1 - gy0), N = GW * GH;
    stats.cells = N;
    const cxOf = (k) => (gx0 + (k % GW) + 0.5) * c, cyOf = (k) => (gy0 + ((k / GW) | 0) + 0.5) * c;
    const cellAt = (x, y) => {
      const i = Math.floor(x / c) - gx0, j = Math.floor(y / c) - gy0;
      return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
    };
    const kind = new Uint8Array(N);       // 0 zakaz, 1 rów, 2 płyta, 3 moduł
    const cost = new Float32Array(N);
    const d1c = new Float32Array(N);
    const C = T.cost;
    const edge = T.edgeDu * D;
    for (let k = 0; k < N; k++) {
      const x = cxOf(k), y = cyOf(k);
      const d0 = S(L0, x, y), d1 = S(L1, x, y);
      d1c[k] = d1;
      if (d0 > -edge) { kind[k] = 0; cost[k] = Infinity; continue; }
      if (d1 < 0) { kind[k] = 2; cost[k] = C.plate; } else {
        kind[k] = 1;
        cost[k] = C.gap + C.wall * smooth01((d1 - 7 * D) / (16 * D)) + (-d0 < 7 * D ? C.edge : 0);
      }
      if (mirror && Math.abs(y) < 10 * D) cost[k] += C.axis;
    }
    for (const m of obstacles) {
      const b = moduleBox(m);
      const i0 = Math.max(0, Math.floor(b[0] / c) - gx0), i1 = Math.min(GW - 1, Math.ceil(b[2] / c) - gx0);
      const j0 = Math.max(0, Math.floor(b[1] / c) - gy0), j1 = Math.min(GH - 1, Math.ceil(b[3] / c) - gy0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * GW + i;
        if (!kind[k]) continue;
        if (pipeModuleSdf(m, cxOf(k), cyOf(k)) < c * 0.35) { kind[k] = 3; cost[k] = C.module + (mirror && Math.abs(cyOf(k)) < 10 * D ? C.axis : 0); }
      }
    }
    // stan A*: komórka × 9 (8 kierunków wejścia + start bez kierunku)
    const g = new Float32Array(N * 9).fill(Infinity);
    const prev = new Int32Array(N * 9);
    const touched = [];
    const heap = new Heap(4096);
    const tree = new Uint8Array(N);
    const links = new Uint8Array(N);
    const near = new Uint8Array(N);
    const dt = new Float32Array(N).fill(1e9);
    const TP = [0, C.turn45, C.turn90, C.turn135];
    const HK = T.heurK;
    const dirOf = (a, b) => {
      const dx = (b % GW) - (a % GW), dy = ((b / GW) | 0) - ((a / GW) | 0);
      for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
      return -1;
    };
    const relax = (seeds) => {
      const q = seeds.slice();
      for (const k of seeds) dt[k] = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const k = q[qi], i = k % GW, j = (k / GW) | 0;
        for (let d = 0; d < 8; d++) {
          const ni = i + DX[d], nj = j + DY[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni, v = dt[k] + DL[d];
          if (v < dt[nk] - 1e-4) { dt[nk] = v; q.push(nk); }
        }
      }
    };
    const markTree = (cells) => {
      const fresh = [];
      for (const k of cells) if (!tree[k]) { tree[k] = 1; fresh.push(k); }
      const hr = T.haloCells;
      for (const k of fresh) {
        const i = k % GW, j = (k / GW) | 0;
        for (let dj = -hr; dj <= hr; dj++) for (let di = -hr; di <= hr; di++) {
          const ni = i + di, nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < GW && nj < GH) near[nj * GW + ni] = 1;
        }
      }
      if (fresh.length) relax(fresh);
    };
    const link = (a, b) => {
      const d = dirOf(a, b);
      if (d < 0) return;
      links[a] |= 1 << d;
      links[b] |= 1 << ((d + 4) & 7);
    };
    /** A* od komórek startu do najbliższej komórki drzewa; zwraca komórki [start … dołączenie] albo null. */
    const search = (starts) => {
      for (const s of touched) g[s] = Infinity;
      touched.length = 0;
      heap.clear();
      stats.searches++;
      for (const k of starts) {
        if (!kind[k]) continue;
        if (tree[k]) return [k];
        const s = k * 9 + 8;
        if (g[s] === Infinity) touched.push(s);
        g[s] = 0; prev[s] = -1;
        heap.push(HK * dt[k], s);
      }
      while (heap.n) {
        const s = heap.pop();
        const f = heap.top;
        const k = (s / 9) | 0, d = s - k * 9;
        const gs = g[s];
        if (f > gs + HK * dt[k] + 1e-3) continue;
        stats.expanded++;
        if (tree[k]) {
          const out = [];
          for (let q = s; q >= 0; q = prev[q]) {
            const kk = (q / 9) | 0;
            if (out[out.length - 1] !== kk) out.push(kk);
          }
          return out.reverse();
        }
        const i = k % GW, j = (k / GW) | 0;
        const ck = cost[k];
        for (let nd = 0; nd < 8; nd++) {
          let tp = 0;
          if (d < 8) { let t = nd > d ? nd - d : d - nd; if (t > 4) t = 8 - t; if (t === 4) continue; tp = TP[t]; }
          const ni = i + DX[nd], nj = j + DY[nd];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          const cn = cost[nk];
          if (cn === Infinity) continue;
          if (nd & 1) {
            const ka = j * GW + ni, kb = nj * GW + i;
            if (cost[ka] === Infinity || cost[kb] === Infinity) continue;
            if ((tree[ka] || tree[kb]) && !tree[nk]) continue;     // bez przecinania sieci po przekątnej
          }
          const ng = gs + DL[nd] * 0.5 * (ck + cn) + tp + (near[nk] && !tree[nk] ? C.halo : 0);
          const ns = nk * 9 + nd;
          if (ng < g[ns]) {
            if (g[ns] === Infinity) touched.push(ns);
            g[ns] = ng; prev[ns] = s;
            heap.push(ng + HK * dt[nk], ns);
          }
        }
      }
      return null;
    };
    /** Komórki startu przy module: obrys + pas (gondola — tylko połowa przy kadłubie). */
    const startsOf = (m, inner = false) => {
      const out = [];
      const b = moduleBox(m);
      const pad = c * 1.6;
      const i0 = Math.max(0, Math.floor((b[0] - pad) / c) - gx0), i1 = Math.min(GW - 1, Math.ceil((b[2] + pad) / c) - gx0);
      const j0 = Math.max(0, Math.floor((b[1] - pad) / c) - gy0), j1 = Math.min(GH - 1, Math.ceil((b[3] + pad) / c) - gy0);
      const cr = Math.cos(m.rot || 0), sr = Math.sin(m.rot || 0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * GW + i;
        if (!kind[k]) continue;
        const x = cxOf(k), y = cyOf(k);
        if (pipeModuleSdf(m, x, y) > pad) continue;
        if (inner && ((x - m.x) * cr + (y - m.y) * sr) < -0.25 * (m.w || 0)) continue;
        out.push(k);
      }
      return out;
    };
    const inHalf = (m) => !mirror || m.y <= 0.5;
    const engines = modules.filter((m) => m.type === 'engine' && inHalf(m));
    const reactor = modules.find((m) => m.type === 'reactor' && inHalf(m));
    const bridge = modules.find((m) => m.type === 'bridge' && inHalf(m));
    // korzeń: jedna komórka (reaktor → mostek → pierwsza gondola)
    const rootMod = reactor || bridge || engines[0] || null;
    let rootCell = -1;
    if (rootMod) {
      let best = Infinity;
      for (const k of startsOf(rootMod)) {
        const v = Math.hypot(cxOf(k) - rootMod.x, cyOf(k) - rootMod.y) + (kind[k] === 1 ? 0 : 2 * c);
        if (v < best) { best = v; rootCell = k; }
      }
    }
    if (rootCell >= 0) {
      markTree([rootCell]);
      const targets = [];   // { kind, starts, anchor, path, gondola }
      const addTarget = (t) => {
        if (!t.starts.length) return null;
        const path = search(t.starts);
        if (!path) return null;
        for (let q = 0; q + 1 < path.length; q++) link(path[q], path[q + 1]);
        markTree(path);
        t.anchor = path[0];
        t.join = path[path.length - 1];
        t.len = path.length;
        targets.push(t);
        stats.routes++;
        return t;
      };
      const minDt = (starts) => { let v = Infinity; for (const k of starts) if (dt[k] < v) v = dt[k]; return v; };
      // 1. gondole (najbliższa sieci pierwsza)
      const gq = engines.filter((m) => m !== rootMod).map((m) => ({ kind: 'engine', mod: m, starts: startsOf(m, true) }));
      const gondolas = [];
      if (rootMod && rootMod.type === 'engine') gondolas.push({ kind: 'engine', mod: rootMod, starts: [rootCell], anchor: rootCell, join: rootCell, len: 1, root: true });
      while (gq.length) {
        let bi = 0, bv = Infinity;
        gq.forEach((t, i) => { const v = minDt(t.starts); if (v < bv) { bv = v; bi = i; } });
        const t = gq.splice(bi, 1)[0];
        if (addTarget(t)) gondolas.push(t);
      }
      // 2. moduły i grzbiet (najbliższy sieci pierwszy)
      const pool = [];
      for (const m of modules) {
        if (!inHalf(m) || m === rootMod) continue;
        if (m.type.startsWith('turret_') || m.type === 'well' || m.type === 'hangar' || m.type === 'bridge' || (m.type === 'reactor' && m !== rootMod)) {
          pool.push({ kind: m.type, mod: m, starts: startsOf(m) });
        }
      }
      const halfWidth = Math.max(Math.abs(bnd.minY), Math.abs(bnd.maxY));
      const L = bnd.maxX - bnd.minX;
      const step = T.spineStepDu * D;
      const nSpine = Math.max(0, Math.round(L * 0.78 / step));
      for (let s = 0; s < nSpine * density; s++) {
        const x = bnd.minX + L * 0.1 + (s + 0.5) * (L * 0.72 / (nSpine * density));
        const i = Math.floor(x / c) - gx0;
        if (i < 0 || i >= GW) continue;
        let bestK = -1, bestY = Infinity;
        for (let j = 0; j < GH; j++) {
          const k = j * GW + i;
          if (kind[k] !== 1) continue;
          const y = cyOf(k);
          if (Math.abs(y) > halfWidth * T.spineBand) continue;
          const v = Math.abs(Math.abs(y) - 14 * D);
          if (v < bestY) { bestY = v; bestK = k; }
        }
        if (bestK >= 0) pool.push({ kind: 'spine', starts: [bestK] });
      }
      while (pool.length) {
        let bi = 0, bv = Infinity;
        pool.forEach((t, i) => { const v = minDt(t.starts); if (v < bv) { bv = v; bi = i; } });
        addTarget(pool.splice(bi, 1)[0]);
      }
      // 3. wypełnienie: komórki rowów najdalej od sieci (waga ku rufie)
      const nFill = Math.round(T.fillPerDensity * density * (mirror ? 1 : 2));
      const minX = bnd.minX;
      for (let f = 0; f < nFill; f++) {
        let bestK = -1, bestV = 0;
        for (let k = 0; k < N; k++) {
          if (kind[k] !== 1 || dt[k] < T.fillMinCells || d1c[k] < 2 * D) continue;
          const u = (cxOf(k) - minX) / Math.max(1, L);
          const v = dt[k] * (1 - T.rearBias * u) * (0.85 + 0.3 * ((k * 2654435761) % 997) / 997);
          if (v > bestV) { bestV = v; bestK = k; }
        }
        if (bestK < 0) break;
        addTarget({ kind: 'fill', starts: [bestK] });
      }
      // ── trasy: cel → gondola (najbliższa po drzewie, z wyrównaniem), gondola → korzeń ──
      const cnt = new Uint16Array(N * 8);
      const bfs = (src) => {
        const dist = new Int32Array(N).fill(-1);
        const par = new Int32Array(N).fill(-1);
        const q = [src];
        dist[src] = 0;
        for (let qi = 0; qi < q.length; qi++) {
          const k = q[qi], lk = links[k];
          for (let d = 0; d < 8; d++) {
            if (!(lk & (1 << d))) continue;
            const nk = k + DY[d] * GW + DX[d];
            if (dist[nk] >= 0) continue;
            dist[nk] = dist[k] + 1; par[nk] = k;
            q.push(nk);
          }
        }
        return { dist, par };
      };
      const walk = (from, tree2) => {
        let k = from;
        for (let guard = 0; guard < N && tree2.par[k] >= 0; guard++) {
          const p = tree2.par[k];
          const d = dirOf(k, p);
          cnt[k * 8 + d]++;
          cnt[p * 8 + ((d + 4) & 7)]++;
          k = p;
        }
      };
      const G = gondolas.length;
      const gb = gondolas.map((t) => bfs(t.anchor));
      const load = new Float32Array(Math.max(1, G));
      const rootB = bfs(rootCell);
      for (const t of gondolas) if (!t.root) walk(t.anchor, rootB);
      const others = targets.filter((t) => t.kind !== 'engine');
      for (const t of others) {
        if (!G) { walk(t.anchor, rootB); continue; }
        let best = -1, bv = Infinity;
        const mean = others.length / G;
        for (let q = 0; q < G; q++) {
          const dd = gb[q].dist[t.anchor];
          if (dd < 0) continue;
          const v = (dd + 4) * (1 + 0.55 * load[q] / (mean + 1));
          if (v < bv) { bv = v; best = q; }
        }
        if (best < 0) { walk(t.anchor, rootB); continue; }
        load[best]++;
        t.gondola = best;
        walk(t.anchor, gb[best]);
      }
      // ── biegi: odcinki drzewa między węzłami (stopień ≠ 2 albo zmiana liczby tras) ──
      const deg = (k) => { let n = 0, l = links[k]; while (l) { n += l & 1; l >>= 1; } return n; };
      const isNode = (k) => {
        if (deg(k) !== 2) return true;
        let a = -1;
        for (let d = 0; d < 8; d++) if (links[k] & (1 << d)) { const v = cnt[k * 8 + d]; if (a < 0) a = v; else if (v !== a) return true; }
        return false;
      };
      const seen = new Uint8Array(N * 8);
      const rawRuns = [];
      for (let k = 0; k < N; k++) {
        if (!tree[k] || !links[k] || !isNode(k)) continue;
        for (let d = 0; d < 8; d++) {
          if (!(links[k] & (1 << d)) || seen[k * 8 + d]) continue;
          const cells = [k];
          let cur = k, dir = d, count = 0;
          for (let guard = 0; guard < N; guard++) {
            const nk = cur + DY[dir] * GW + DX[dir];
            seen[cur * 8 + dir] = 1;
            seen[nk * 8 + ((dir + 4) & 7)] = 1;
            count = Math.max(count, cnt[cur * 8 + dir]);
            cells.push(nk);
            cur = nk;
            if (isNode(cur)) break;
            let nd = -1;
            for (let e = 0; e < 8; e++) if ((links[cur] & (1 << e)) && e !== ((dir + 4) & 7)) { nd = e; break; }
            if (nd < 0) break;
            dir = nd;
          }
          rawRuns.push({ cells, count: Math.max(1, count) });
        }
      }
      // gondola biegu (najbliższa po drzewie) → sekwencja promieni tej gondoli: grube rury ciągną się przez węzły
      const seqs = [];
      for (let q = 0; q < Math.max(1, G); q++) {
        const r = rng((design.seed || 7) * 31 + q * 977 + (design.pipeNet?.seed || 0));
        seqs.push({ radii: pipeRadii(r, T.maxPipes), gap: T.gap[0] + (T.gap[1] - T.gap[0]) * r() });
      }
      const nodeInfo = new Map();     // komórka węzła → { halfW, pts przesunięte }
      for (const rr of rawRuns) {
        const mid = rr.cells[rr.cells.length >> 1];
        let gq2 = 0, gd = Infinity;
        for (let q = 0; q < G; q++) { const v = gb[q].dist[mid]; if (v >= 0 && v < gd) { gd = v; gq2 = q; } }
        const n = clamp(Math.round(1 + T.pipesK * Math.log2(1 + rr.count)), 1, T.maxPipes);
        const sq = seqs[Math.min(gq2, seqs.length - 1)];
        rr.radii = sq.radii.slice(0, n);
        rr.gap = sq.gap;
        rr.n = n;
        rr.halfW = (rr.radii.reduce((a, r) => a + 2 * r, 0) + sq.gap * (n - 1)) * 0.5;
        rr.rMax = Math.max(...rr.radii);
        rr.gondola = gq2;
        for (const e of [rr.cells[0], rr.cells[rr.cells.length - 1]]) {
          const ni = nodeInfo.get(e) || { halfW: 0, runs: [] };
          ni.halfW = Math.max(ni.halfW, rr.halfW);
          ni.runs.push(rr);
          nodeInfo.set(e, ni);
        }
      }
      // węzły: przesunięte w stronę wolnego miejsca (wiązka mieści się w rowie)
      for (const [k, ni] of nodeInfo) {
        let x = cxOf(k), y = cyOf(k);
        const need = (ni.halfW + T.clearDu) * D;
        const x0 = x, y0 = y;
        if (fsAt(x, y) > -2 * D) {
          for (let it = 0; it < 14; it++) {
            const v = fsAt(x, y);
            if (v >= need) break;
            const h = D;
            let gxv = fsAt(x + h, y) - fsAt(x - h, y), gyv = fsAt(x, y + h) - fsAt(x, y - h);
            const gl = Math.hypot(gxv, gyv);
            if (gl < 1e-6) break;
            gxv /= gl; gyv /= gl;
            const st = Math.min(need - v, 1.5 * D);
            x += gxv * st; y += gyv * st;
            const dd = Math.hypot(x - x0, y - y0), lim = T.shiftDu * D;
            if (dd > lim) { x = x0 + (x - x0) * lim / dd; y = y0 + (y - y0) * lim / dd; break; }
          }
        }
        if (mirror && y > -0.2 * D) y = -0.2 * D;
        ni.x = x; ni.y = y;
        ni.deg = deg(k);
        ni.cell = k;
      }
      // koszt łamanej po komórkach (do prostowania schodków: zamiennik nie może iść drożej niż trasa A*)
      const inAt = (x, y) => -S(L0, x, y);
      const pathCost = (poly) => {
        let sum = 0;
        for (let q = 0; q + 1 < poly.length; q++) {
          const a = poly[q], b = poly[q + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.ceil(L / (0.5 * c)));
          for (let t = 0; t < n; t++) {
            const kk = cellAt(a[0] + (b[0] - a[0]) * (t + 0.5) / n, a[1] + (b[1] - a[1]) * (t + 0.5) / n);
            const v = kk < 0 ? Infinity : cost[kk];
            if (v === Infinity) return Infinity;
            sum += v * L / n;
          }
        }
        return sum;
      };
      for (const rr of rawRuns) {
        // rogi trasy na środkach komórek (zmiany kierunku) → schodki wyprostowane (najwyżej dwa odcinki: prosty
        // i 45°, gdy nie drożej) → wiązka ze STAŁYM przesunięciem na każdy prosty odcinek; końce przez węzły
        const pts = [];
        for (let q = 0; q < rr.cells.length; q++) {
          const k = rr.cells[q];
          if (q > 0 && q < rr.cells.length - 1) {
            const a = rr.cells[q - 1], b = rr.cells[q + 1];
            if (dirOf(a, k) === dirOf(k, b)) continue;
          }
          pts.push([cxOf(k), cyOf(k)]);
        }
        const corners = straightenOctilinear(pts, pathCost);
        const A = nodeInfo.get(rr.cells[0]), B = nodeInfo.get(rr.cells[rr.cells.length - 1]);
        rr.corners = corners;
        rr.pts = offsetRun(corners, [A.x, A.y], [B.x, B.y], rr.halfW, D, T, fsAt, inAt, mirror);
        rr.nodeA = A; rr.nodeB = B;
        // pojemność rowu: wiązka nie szersza niż rów (mediana szerokości na widocznej długości) i wypełnia co
        // najmniej fillShare jego szerokości — jak w sprite'ach, gdzie rowy są pełne rur
        const capW = runGapWidth(rr.pts, D, fsAt);
        if (capW > 0) {
          const sq = seqs[Math.min(rr.gondola, seqs.length - 1)];
          let w = 0, nCap = 0;
          for (let k2 = 0; k2 < T.maxPipes; k2++) {
            const add = 2 * sq.radii[k2] + (k2 ? sq.gap : 0);
            if (w + add > capW - 2 * T.clearDu) break;
            w += add; nCap++;
          }
          nCap = Math.max(1, nCap);
          const nMin = Math.min(nCap, Math.max(2, Math.round(T.fillShare * nCap)));
          const n2 = clamp(rr.n, nMin, nCap);
          if (n2 !== rr.n) {
            rr.n = n2;
            rr.radii = sq.radii.slice(0, n2);
            rr.halfW = (rr.radii.reduce((a, r) => a + 2 * r, 0) + sq.gap * (n2 - 1)) * 0.5;
            rr.rMax = Math.max(...rr.radii);
            rr.pts = offsetRun(rr.corners, [A.x, A.y], [B.x, B.y], rr.halfW, D, T, fsAt, inAt, mirror);
          }
        }
      }
      // biegi do wyjścia (najwyżej maxRuns — przy nadmiarze odpadają najmniej obciążone)
      rawRuns.sort((a, b) => b.count - a.count || a.cells[0] - b.cells[0]);
      const keep = rawRuns.slice(0, T.maxRuns - Math.min(T.maxRuns - 1, manual.length));
      for (const rr of keep) {
        const R = Math.max(T.filletK * (rr.halfW + rr.rMax), 2.2) * D;
        const poly = filletPolyline(rr.pts, R);
        const polys = [poly];
        if (mirror) polys.push(poly.map(([x, y]) => [x, -y]));
        runs.push({
          radii: rr.radii, halfW: rr.halfW, gap: rr.gap, rMax: rr.rMax, mat: 0, over: false, phase: rand() * T.clampDu * D,
          count: rr.count, n: rr.n, polys, auto: true, nodeA: rr.nodeA, nodeB: rr.nodeB, gondola: rr.gondola
        });
      }
      // ── osprzęt sieci ──
      autoFittings(runs.filter((r) => r.auto), fits, { D, T, rand, visAt, fsAt, gondolas, mirror });
      for (const r of runs) { delete r.nodeA; delete r.nodeB; }     // wynik bez odwołań do węzłów (JSON, worker)
      stats.targets = targets.length;
      stats.gondolas = G;
    }
  }

  // ── rury ręczne: bieg na rurę (kopia lustra w tym samym biegu); domyślnie leżą też na płytach ──
  const bySrc = new Map();
  for (const p of manual) {
    const key = p.src ?? p;
    if (!bySrc.has(key)) bySrc.set(key, []);
    bySrc.get(key).push(p);
  }
  let mi = 0;
  for (const list of bySrc.values()) {
    if (runs.length >= T.maxRuns) break;
    const p = list[0];
    const r = rng((design.seed || 7) * 131 + (++mi) * 7177);
    const n = clamp(p.n || 3, 1, 8);
    const scale = p.r || 1;
    let radii = pipeRadii(r, n, scale);
    const mat = Math.max(0, HD_PIPE_MATS.indexOf(p.mat || 'mix'));
    const gap = (T.gap[0] + (T.gap[1] - T.gap[0]) * r()) * scale;
    const halfW = (radii.reduce((a, v) => a + 2 * v, 0) + gap * (n - 1)) * 0.5;
    const rMax = Math.max(...radii);
    const R = Math.max(T.filletK * (halfW + rMax), 2.2) * D;
    const polys = list.map((q) => filletPolyline(q.pts, R));
    radii = radii.slice(0, 8);
    runs.push({ radii, halfW, gap, rMax, mat, over: p.over !== false, phase: r() * T.clampDu * D, count: n, n, polys, auto: false });
    // zaślepki na końcach (widocznych)
    for (const poly of polys) {
      for (const end of [0, 1]) {
        const a = end ? poly[poly.length - 1] : poly[0], b = end ? poly[poly.length - 2] : poly[1];
        if (!b) continue;
        const rot = Math.atan2(a[1] - b[1], a[0] - b[0]);
        fits.push({ type: HD_PIPE_FIT.cap, x: a[0] - Math.cos(rot) * 0.6 * D, y: a[1] - Math.sin(rot) * 0.6 * D, rot, hw: 0.9, hh: halfW + 0.6, p1: 0, p2: rMax + 0.5, over: p.over !== false });
      }
    }
  }
  // osprzęt: pierwszeństwo przy nakładaniu (później zapisany przykrywa wcześniejszy), limit
  fits.sort((a, b) => FIT_PRIO[a.type] - FIT_PRIO[b.type]);
  while (fits.length > T.maxFits) fits.shift();
  stats.runs = runs.length;
  stats.fits = fits.length;
  stats.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { runs, fits, clampJ: T.clampDu * D, detail: D, stats };
}

/**
 * Schodki trasy A* → odcinki ośmiokierunkowe (proste i 45°): od każdego rogu najdalszy róg, do którego da się dojść
 * jednym odcinkiem albo dwoma (ukośny + prosty, w dowolnej kolejności) nie drożej niż trasą A* (× 1,08) — jak wiązki
 * w czystych sprite'ach TN (Bellator): długa prosta, kolano 45°, prosta. Trasa A* po siatce komórek ma schodek przy
 * każdym ząbku ściany rowu (obrys z zaszumionego sprite'a), stąd dawny zygzak.
 */
function straightenOctilinear(pts, pathCost) {
  const n = pts.length;
  if (n <= 2) return pts.map((p) => [p[0], p[1]]);
  // koszt trasy A* między rogami: sumy prefiksowe odcinków (odcinki zakazane liczone osobno)
  const pre = new Float64Array(n), inf = new Int32Array(n);
  for (let q = 1; q < n; q++) {
    const v = pathCost([pts[q - 1], pts[q]]);
    pre[q] = pre[q - 1] + (v < Infinity ? v : 0);
    inf[q] = inf[q - 1] + (v < Infinity ? 0 : 1);
  }
  const octi = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [[a, b]];
    const sx = Math.sign(dx), sy = Math.sign(dy), dg = Math.min(ax, ay);
    return [[a, [a[0] + sx * dg, a[1] + sy * dg], b], [a, [b[0] - sx * dg, b[1] - sy * dg], b]];
  };
  const out = [[pts[0][0], pts[0][1]]];
  let i = 0;
  while (i < n - 1) {
    let next = i + 1, chosen = null;
    for (let j = n - 1; j >= i + 2 && !chosen; j--) {
      if (inf[j] - inf[i] > 0) continue;
      const base = pre[j] - pre[i];
      let bestV = Infinity;
      for (const cand of octi(pts[i], pts[j])) {
        const v = pathCost(cand);
        if (v <= base * 1.08 + 1e-6 && v < bestV) { bestV = v; chosen = cand; next = j; }
      }
    }
    if (chosen) for (let q = 1; q < chosen.length; q++) out.push([chosen[q][0], chosen[q][1]]);
    else out.push([pts[next][0], pts[next][1]]);
    i = next;
  }
  return dropCollinear(out);
}

/** Łamana bez zerowych odcinków i punktów współliniowych (także zawrotów w miejscu); końce zostają. */
function dropCollinear(pts) {
  const out = [pts[0]];
  for (let q = 1; q < pts.length; q++) {
    const p = pts[q], a = out[out.length - 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (la < 1e-6) { if (q === pts.length - 1) out[out.length - 1] = p; continue; }
    if (q < pts.length - 1) {
      const b = pts[q + 1];
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const cr = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      if (lb > 1e-6 && Math.abs(cr) <= 1e-9 * la * lb) continue;
    }
    out.push(p);
  }
  return out;
}

/** Bez zawrotów: punkt, w którym łamana zawraca (> ~155°), wypada (zabezpieczenie po przesunięciach). */
function dropFolds(pts) {
  let out = pts;
  for (let guard = 0; guard < pts.length; guard++) {
    let hit = -1;
    for (let q = 1; q + 1 < out.length && hit < 0; q++) {
      const a = out[q - 1], p = out[q], b = out[q + 1];
      const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-6 || lv < 1e-6 || ux * vx + uy * vy < -0.9 * lu * lv) hit = q;
    }
    if (hit < 0) break;
    out = out.filter((_, q) => q !== hit);
  }
  return out;
}

/**
 * Wiązka w rowie: STAŁE przesunięcie w poprzek na każdy prosty odcinek trasy, rogi = przecięcia przesuniętych prostych
 * (kolana zostają 45° / 90°, wiązka biegnie równolegle do ściany — bez falowania za ząbkami obrysu). Przesunięcie
 * odcinka: najmniejsze, przy którym wiązka ma luz od ścian (pole wolnego miejsca) na całej widocznej długości odcinka
 * (pod płytą — bez wymagań), a oś na całej długości leży w sylwetce; bez takiego — najlepszy luz. Odcinek końcowy
 * biegnie przez swój węzeł (węzeł przesunięty w wolne miejsce, wspólny dla biegów rozgałęzienia), a gdy tam nie ma
 * luzu — wchodzi na swoją prostą kolanem 45° tuż za węzłem. Odcinek odwrócony przez przesunięcia: kolano przy węźle
 * znika, odcinek końcowy za węzłem odpada, środkowy — sąsiad przesunięty tak, by odcinek miał długość zero.
 */
function offsetRun(corners, A, B, halfW, D, T, fsAt, inAt, mirror) {
  const m = corners.length;
  if (m < 2) return [[A[0], A[1]], [B[0], B[1]]];
  const segs = [];
  for (let s = 0; s + 1 < m; s++) {
    const a = corners[s], b = corners[s + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    segs.push({ a, L, ux, uy, nx: -uy, ny: ux, o: 0 });
  }
  const ns = segs.length;
  const clear = T.clearDu * D, maxS = T.shiftDu * D, hw = halfW * D, jogMin = 0.25 * D;
  const S0 = segs[0], S1 = segs[ns - 1];
  // węzły względem prostych odcinków końcowych: przesunięcie w poprzek (o) i położenie wzdłuż (t)
  const oA = (A[0] - S0.a[0]) * S0.nx + (A[1] - S0.a[1]) * S0.ny;
  const tA = (A[0] - S0.a[0]) * S0.ux + (A[1] - S0.a[1]) * S0.uy;
  const oB = (B[0] - S1.a[0]) * S1.nx + (B[1] - S1.a[1]) * S1.ny;
  const tB = (B[0] - S1.a[0]) * S1.ux + (B[1] - S1.a[1]) * S1.uy;
  const fit = (g, pref, t0, t1) => {
    const lo = clamp(t0, 0, g.L), hi = clamp(t1, lo, g.L);
    const n = Math.max(2, Math.round((hi - lo) / (1.5 * D)));
    const all = [], vis = [];
    for (let q = 0; q <= n; q++) {
      const t = lo + (hi - lo) * q / n;
      const x = g.a[0] + g.ux * t, y = g.a[1] + g.uy * t;
      all.push(x, y);
      if (fsAt(x, y) >= -1.5 * D) vis.push(x, y);
    }
    const score = (o) => {
      for (let q = 0; q < all.length; q += 2) if (inAt(all[q] + g.nx * o, all[q + 1] + g.ny * o) < D) return -Infinity;
      let v = Infinity;
      for (let q = 0; q < vis.length; q += 2) {
        const cx = vis[q] + g.nx * o, cy = vis[q + 1] + g.ny * o;
        const cl = Math.min(fsAt(cx + g.nx * hw, cy + g.ny * hw), fsAt(cx - g.nx * hw, cy - g.ny * hw), fsAt(cx, cy) - hw);
        if (cl < v) v = cl;
      }
      return v;
    };
    let bestO = pref.length ? pref[0] : 0, bestV = -Infinity;
    const ok = (o) => {
      const v = score(o);
      if (v >= clear) return true;
      if (v > bestV + 1e-6) { bestV = v; bestO = o; }
      return false;
    };
    for (const o of pref) if (ok(o)) return o;
    for (let k = 0; k * 0.5 * D <= maxS + 1e-6; k++) {
      const o = k * 0.5 * D;
      if (ok(o)) return o;
      if (k && ok(-o)) return -o;
    }
    return bestO;
  };
  if (ns === 1) S0.o = fit(S0, [oA, oB, (oA + oB) * 0.5], tA, tB);
  else {
    S0.o = fit(S0, [oA], tA, S0.L);
    S1.o = fit(S1, [oB], 0, tB);
    for (let s = 1; s < ns - 1; s++) segs[s].o = fit(segs[s], [], 0, segs[s].L);
  }
  let jogA = true, jogB = true;
  const meet = (g, h) => {
    const px = g.a[0] + g.nx * g.o, py = g.a[1] + g.ny * g.o;
    const qx = h.a[0] + h.nx * h.o, qy = h.a[1] + h.ny * h.o;
    const den = g.ux * h.uy - g.uy * h.ux;
    const t = ((qx - px) * h.uy - (qy - py) * h.ux) / den;
    return [px + g.ux * t, py + g.uy * t];
  };
  const along = (g, p) => (p[0] - g.a[0]) * g.ux + (p[1] - g.a[1]) * g.uy;
  const jA = () => (jogA && Math.abs(S0.o - oA) > jogMin ? Math.abs(S0.o - oA) : 0);
  const jB = () => (jogB && Math.abs(S1.o - oB) > jogMin ? Math.abs(S1.o - oB) : 0);
  /** Długość odcinka s wzdłuż jego kierunku (z kolanami przy węzłach). */
  const span = (s) => {
    const g = segs[s];
    const t0 = s === 0 ? tA + jA() : along(g, meet(segs[s - 1], g));
    const t1 = s === ns - 1 ? tB - jB() : along(g, meet(g, segs[s + 1]));
    return t1 - t0;
  };
  for (let guard = 0; guard < 3 * ns + 4; guard++) {
    let bad = -1;
    for (let s = 0; s < ns && bad < 0; s++) if (span(s) < -1e-6) bad = s;
    if (bad < 0) break;
    const end0 = bad === 0, end1 = bad === ns - 1;
    if (end0 && jA() > 0) { jogA = false; S0.o = oA; continue; }
    if (end1 && jB() > 0) { jogB = false; S1.o = oB; continue; }
    if (ns === 1) return [[A[0], A[1]], [B[0], B[1]]];
    if (end0) return offsetRun(corners.slice(1), A, B, halfW, D, T, fsAt, inAt, mirror);
    if (end1) return offsetRun(corners.slice(0, -1), A, B, halfW, D, T, fsAt, inAt, mirror);
    // środkowy: przesunięcie sąsiada (najpierw nie-końcowego) tak, by odcinek miał długość zero (długość liniowa w o)
    const fixWith = (h) => {
      const o0 = h.o, v0 = span(bad);
      h.o = o0 + D;
      const k = span(bad) - v0;
      h.o = Math.abs(k) > 1e-9 ? o0 - v0 / k * D : o0;
      if (span(bad) < -1e-6) { h.o = o0; return false; }
      return true;
    };
    const left = segs[bad - 1], right = segs[bad + 1];
    const order = bad - 1 === 0 ? [right, left] : [left, right];
    if (!fixWith(order[0]) && !fixWith(order[1])) break;
  }
  const pts = [[A[0], A[1]]];
  const dA = S0.o - oA, dB = S1.o - oB;
  if (jA() > 0) pts.push([A[0] + S0.ux * Math.abs(dA) + S0.nx * dA, A[1] + S0.uy * Math.abs(dA) + S0.ny * dA]);
  for (let s = 0; s + 1 < ns; s++) pts.push(meet(segs[s], segs[s + 1]));
  if (jB() > 0) pts.push([B[0] - S1.ux * Math.abs(dB) + S1.nx * dB, B[1] - S1.uy * Math.abs(dB) + S1.ny * dB]);
  pts.push([B[0], B[1]]);
  if (mirror) for (const p of pts) if (p[1] > -0.2 * D) p[1] = -0.2 * D;
  return dropFolds(dropCollinear(pts));
}

/**
 * Szerokość rowu wzdłuż łamanej [jd]: mediana (w poprzek: od ściany do ściany pola wolnego miejsca) w punktach
 * widocznych co 2 jd; 0, gdy widoczna jest mniej niż ćwierć długości.
 */
function runGapWidth(pts, D, fsAt) {
  const ws = [];
  let total = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], b = pts[s + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const n = Math.max(1, Math.round(L / (2 * D)));
    for (let q = 0; q < n; q++) {
      total++;
      const t = (q + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (fsAt(x, y) < 0.3 * D) continue;
      let wp = 0, wm = 0;
      while (wp < 40 * D && fsAt(x + nx * wp, y + ny * wp) > 0) wp += 0.5 * D;
      while (wm < 40 * D && fsAt(x - nx * wm, y - ny * wm) > 0) wm += 0.5 * D;
      ws.push((wp + wm) / D);
    }
  }
  if (ws.length < total * 0.25 || ws.length < 3) return 0;
  ws.sort((p, q) => p - q);
  return ws[ws.length >> 1];
}

/** Długość łamanej. */
function polyLength(poly) {
  let L = 0;
  for (let i = 0; i + 1 < poly.length; i++) L += Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
  return L;
}

/** Punkt i kierunek łamanej na długości s. */
function polyAt(poly, s) {
  let acc = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + L >= s || i + 2 === poly.length) {
      const t = L > 0 ? clamp((s - acc) / L, 0, 1) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    acc += L;
  }
  const p = poly[poly.length - 1];
  return { x: p[0], y: p[1], rot: 0 };
}

/**
 * Osprzęt sieci generowanej (tylko burta y ≤ 0 przy lustrze — kopia lustra na końcu): skrzynki rozdzielcze
 * w rozgałęzieniach, kołnierze na wejściach pod płyty / w moduły, zaślepki na końcach, zawory na długich odcinkach,
 * pompy na wiązkach przy gondolach, kolektory przy gondolach.
 */
function autoFittings(runs, fits, ctx) {
  const { D, T, rand, visAt, fsAt, mirror } = ctx;
  const own = [];
  const free = (x, y, r) => own.every((f) => Math.hypot(f.x - x, f.y - y) > (r + Math.max(f.hw, f.hh) * D) * 0.8);
  const put = (f) => { own.push(f); };
  // skrzynki w rozgałęzieniach (stopień ≥ 3), oś = bieg o największej liczbie tras
  const nodes = new Map();
  for (const r of runs) for (const [nd, poly, end] of [[r.nodeA, r.polys[0], 0], [r.nodeB, r.polys[0], 1]]) {
    if (!nd || nd.deg < 3) continue;
    if (!nodes.has(nd)) nodes.set(nd, []);
    nodes.get(nd).push({ r, poly, end });
  }
  for (const [nd, list] of nodes) {
    if (!visAt(nd.x, nd.y)) continue;
    list.sort((a, b) => b.r.count - a.r.count);
    const main = list[0];
    const p = main.end ? main.poly[main.poly.length - 2] : main.poly[1];
    const rot = Math.atan2(p[1] - nd.y, p[0] - nd.x);
    let side = 0, total = 0;
    for (const e of list.slice(1)) side = Math.max(side, e.r.halfW);
    for (const e of list) total += e.r.n;
    // duże rozgałęzienie — skrzynka rozdzielcza (czasem z kółkiem zaworu), małe — obejma-trójnik w poprzek wiązki
    if (total >= 6 || nd.deg >= 4) {
      const hw = Math.max(side + 1.4, 2.6), hh = main.r.halfW + 1.5;
      put({ type: HD_PIPE_FIT.box, x: nd.x, y: nd.y, rot, hw, hh, p1: total >= 9 && rand() < 0.4 ? 1 : 0, p2: main.r.rMax + 1.4 });
    } else {
      put({ type: HD_PIPE_FIT.collar, x: nd.x, y: nd.y, rot, hw: Math.max(1.3, side + 0.6), hh: main.r.halfW + 0.9, p1: 0, p2: main.r.rMax + 0.6 });
    }
  }
  // wzdłuż biegów: kołnierze na przejściach rów ↔ przykryte, zaślepki, zawory, pompy
  for (const r of runs) {
    const poly = r.polys[0];
    const L = polyLength(poly);
    const st = 0.7 * D;
    let prevVis = null;
    let visRun = 0, nextValve = T.valveDu * D * (0.45 + 0.6 * rand());
    for (let s = 0; s <= L; s += st) {
      const a = polyAt(poly, s);
      const v = visAt(a.x, a.y);
      if (prevVis !== null && v !== prevVis) {
        // kołnierz po stronie widocznej, ~1 jd od przejścia
        const sv = v ? s + 0.9 * D : s - st - 0.9 * D;
        const b = polyAt(poly, clamp(sv, 0, L));
        if (visAt(b.x, b.y) && free(b.x, b.y, (r.halfW + 0.8) * D)) put({ type: HD_PIPE_FIT.collar, x: b.x, y: b.y, rot: b.rot, hw: 1.1, hh: r.halfW + 0.75, p1: 0, p2: r.rMax + 0.55 });
      }
      visRun = v ? visRun + st : 0;
      if (v && visRun > 10 * D && s > nextValve && s < L - 8 * D && r.n >= 2) {
        const b = polyAt(poly, s - 4 * D);
        if (free(b.x, b.y, (r.halfW + 2) * D)) {
          const kindV = rand();
          if (kindV < 0.45) put({ type: HD_PIPE_FIT.valve, x: b.x, y: b.y, rot: b.rot, hw: 2.0, hh: r.halfW + 1.2, p1: Math.min(1.8, r.halfW * 0.5 + 0.7), p2: r.rMax + 1.5 });
          else if (kindV < 0.8 || r.count < 4) put({ type: HD_PIPE_FIT.collar, x: b.x, y: b.y, rot: b.rot, hw: 1.6, hh: r.halfW + 0.8, p1: 1, p2: r.rMax + 0.6 });
          else put({ type: HD_PIPE_FIT.pump, x: b.x, y: b.y, rot: b.rot, hw: 2.6, hh: r.halfW + 2.0, p1: 0, p2: r.rMax + 2.0 });
        }
        nextValve = s + T.valveDu * D * (0.7 + 0.6 * rand());
      }
      prevVis = v;
    }
    // zaślepki: wolne (widoczne) końce biegu w liściach
    for (const [nd, end] of [[r.nodeA, 0], [r.nodeB, 1]]) {
      if (!nd || nd.deg !== 1) continue;
      const a = end ? poly[poly.length - 1] : poly[0], b = end ? poly[poly.length - 2] : poly[1];
      if (!b || !visAt(a[0], a[1])) continue;
      const rot = Math.atan2(a[1] - b[1], a[0] - b[0]);
      const x = a[0] - Math.cos(rot) * 0.8 * D, y = a[1] - Math.sin(rot) * 0.8 * D;
      if (free(x, y, (r.halfW + 0.6) * D)) put({ type: HD_PIPE_FIT.cap, x, y, rot, hw: 1.0, hh: r.halfW + 0.7, p1: 0, p2: r.rMax + 0.6 });
    }
  }
  // gondole: kolektor (stos krótkich rur wzdłuż osi gondoli) w rowie przy szyjce
  for (const t of ctx.gondolas) {
    const m = t.mod;
    if (!m) continue;
    const cr = Math.cos(m.rot || 0), sr = Math.sin(m.rot || 0);
    let best = null;
    for (const [lx, ly] of [[0.35 * m.w, -(m.h + 5 * D)], [0.35 * m.w, m.h + 5 * D], [m.w + 6 * D, 0], [0.75 * m.w, -(m.h + 5 * D)], [0.75 * m.w, m.h + 5 * D]]) {
      const x = m.x + lx * cr - ly * sr, y = m.y + lx * sr + ly * cr;
      if (mirror && y > -1 * D) continue;
      const f = fsAt(x, y);
      if (f > 2.6 * D && visAt(x, y) && (!best || f > best.f)) best = { x, y, f, along: lx > m.w };
    }
    if (!best) continue;
    const hh = Math.min(best.f / D - 0.6, 6.5), hw = Math.min(0.42 * m.w / D, 10);
    if (hh < 2.2 || hw < 2.5) continue;
    put({ type: HD_PIPE_FIT.collector, x: best.x, y: best.y, rot: (m.rot || 0) + (best.along ? Math.PI / 2 : 0), hw: best.along ? hh : hw, hh: best.along ? hw : hh, p1: clamp(Math.round(2 * Math.min(hh, hw) / 2.1), 3, 8), p2: 2.4 });
  }
  for (const f of own) {
    fits.push(f);
    if (mirror && Math.abs(f.y) > 0.5 * D) fits.push({ ...f, y: -f.y, rot: -f.rot, mirrorOf: true });
  }
}

/**
 * Raster sieci na siatce pola `grid` { x0, y0, w, h, res }: A (Float32 × 4 na teksel) — przesunięcie w poprzek od
 * osi biegu ze znakiem [j.], cos φ, sin φ (φ = 2π · s / okres obejm), numer odcinka między obejmami (s / okres mod 8);
 * B (Uint8 × 4) — numer biegu (1…255, 0 — brak), numer elementu osprzętu (1…255); mask — teksele zapisane.
 * Wiązka należy do biegu, którego brzeg jest najbliżej (|t| − pół-szerokość najmniejsze); końce biegów płaskie.
 */
export function rasterPipeNetwork(net, grid) {
  const { x0, y0, w, h, res } = grid;
  const n = w * h;
  const A = new Float32Array(n * 4);
  const B = new Uint8Array(n * 4);
  const mask = new Uint8Array(n);
  if (!net) return { a: A, b: B, mask, count: 0 };
  const best = new Float32Array(n).fill(Infinity);
  const inv = 1 / res;
  const pad = 2.6 * inv;
  const P = net.clampJ;
  const iP = 1 / P;
  const D = net.detail;
  const TAU = Math.PI * 2;
  for (let ri = 0; ri < net.runs.length && ri < 255; ri++) {
    const run = net.runs[ri];
    const hw = run.halfW * D;
    const reach = hw + pad, reach2 = reach * reach;
    for (const poly of run.polys) {
      let s0 = run.phase;
      const last = poly.length - 2;
      for (let q = 0; q + 1 < poly.length; q++) {
        const a = poly[q], b = poly[q + 1];
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const L2 = vx * vx + vy * vy, L = Math.sqrt(L2);
        if (L < 1e-9) continue;
        const ix0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - x0) * res));
        const ix1 = Math.min(w - 1, Math.ceil((Math.max(a[0], b[0]) + reach - x0) * res));
        const iy0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - y0) * res));
        const iy1 = Math.min(h - 1, Math.ceil((Math.max(a[1], b[1]) + reach - y0) * res));
        for (let j = iy0; j <= iy1; j++) {
          const py = y0 + (j + 0.5) * inv;
          for (let i = ix0; i <= ix1; i++) {
            const px = x0 + (i + 0.5) * inv;
            const wx = px - a[0], wy = py - a[1];
            let t = (wx * vx + wy * vy) / L2;
            if (t < 0) { if (q === 0) continue; t = 0; }
            if (t > 1) { if (q === last) continue; t = 1; }
            const dx = wx - vx * t, dy = wy - vy * t;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            const k = j * w + i;
            const dist = Math.sqrt(d2);
            const sdf = dist - hw;
            if (sdf >= best[k]) continue;
            best[k] = sdf;
            const sign = vx * wy - vy * wx >= 0 ? 1 : -1;
            const ph = (s0 + t * L) * iP;
            A[k * 4] = sign * dist;
            A[k * 4 + 1] = Math.cos(TAU * ph);
            A[k * 4 + 2] = Math.sin(TAU * ph);
            A[k * 4 + 3] = ph - 8 * Math.floor(ph / 8);
            B[k * 4] = ri + 1;
            mask[k] = 1;
          }
        }
        s0 += L;
      }
    }
  }
  const fits = net.fits;
  for (let fi = 0; fi < fits.length && fi < 255; fi++) {
    const f = fits[fi];
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const hx = f.hw * D + 2 * inv, hy = f.hh * D + 2 * inv;
    const ex = Math.abs(c) * hx + Math.abs(s) * hy, ey = Math.abs(s) * hx + Math.abs(c) * hy;
    const ix0 = Math.max(0, Math.floor((f.x - ex - x0) * res)), ix1 = Math.min(w - 1, Math.ceil((f.x + ex - x0) * res));
    const iy0 = Math.max(0, Math.floor((f.y - ey - y0) * res)), iy1 = Math.min(h - 1, Math.ceil((f.y + ey - y0) * res));
    for (let j = iy0; j <= iy1; j++) {
      const py = y0 + (j + 0.5) * inv - f.y;
      for (let i = ix0; i <= ix1; i++) {
        const px = x0 + (i + 0.5) * inv - f.x;
        const lx = px * c + py * s, ly = -px * s + py * c;
        if (Math.abs(lx) > hx || Math.abs(ly) > hy) continue;
        const k = j * w + i;
        B[k * 4 + 1] = fi + 1;
        mask[k] = 1;
      }
    }
  }
  return { a: A, b: B, mask, count: Math.min(255, net.runs.length) };
}

/** Rury na tercję długości (rufa, środek, dziób): Σ liczba rur × długość widocznych biegów generowanych [j.]. */
export function pipeTercileLoad(net, bounds) {
  const out = [0, 0, 0];
  if (!net) return out;
  const L = bounds.maxX - bounds.minX;
  for (const r of net.runs) {
    for (const poly of r.polys) {
      for (let i = 0; i + 1 < poly.length; i++) {
        const a = poly[i], b = poly[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = ((a[0] + b[0]) * 0.5 - bounds.minX) / L;
        out[clamp(Math.floor(u * 3), 0, 2)] += len * r.n;
      }
    }
  }
  return out;
}
