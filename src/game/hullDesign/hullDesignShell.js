// src/game/hullDesign/hullDesignShell.js
//
// KREATOR KADŁUBÓW — PANCERZ Z OBRYSU (skorupa; czysty: bez three i DOM, bez importu schematu — woła go expandHullDesign).
// Propozycja i makieta: docs/PROPOZYCJA-kreator-pancerz.md, scripts/kreator-pancerz-makieta.mjs; test
// tests/hullDesignShell.test.mjs.
//
// Pole projektu `shell` (normalizeHullShell; brak — jak dawniej, płyty z klocków). Przy włączonej skorupie:
//   - klocki poziomu 1 są tylko SYLWETKĄ (rama), płyty z nich nie ma; klocki poziomu ≥ 2 to dalej nadbudówki NA skorupie,
//   - PŁYTA = sylwetka ramy (suma pełnych obrysów klocków) minus OTWARCIA — jedna bryła 'poly' poziomu 1 bez szwów
//     (suma / różnica geometryczna), przycięta do ramy jak płyty klocków (clip 0 + clipIn),
//   - OTWARCIA = klocki-wycięcia poziomu 1 (rów osi — `axisTrench`, wnęki) i WNĘKI generatora przy przyłączach paliwa
//     (kanał serwisowy gondoli MAIN, dyszy SIDE i zbiornika poszerzony o `nicheDu`) — przy skorupie wycięcie poziomu 1
//     otwiera tylko skorupę: nadbudówki stojące w rowie zostają (kręgosłup w rowie),
//   - RYTM = rowki (`grooves`, znacznik `shell`) z odległości od brzegu skorupy (burty i ścian otwarć; transformata
//     ośmiokątna — w narożach wklęsłych fazy 45°, za wąskie kawałki znikają same): OBWÓDKA (`rim`), PASY (`bands` co
//     `bandStep`), ŻEBRA poprzeczne (`ribStep`), WPUSTY „płyta w płycie” (`inset`), STĘPKA (`keel`).
// Lustro z konstrukcji: przy `mirror` siatka obejmuje burtę y ≤ 0 (odległość do ścian drugiej burty nigdy nie jest
// mniejsza niż do ich odbicia), rowki tylko z niej — kopie dokłada wywołujący. Wymiary rytmu w jd (design.detail j.).
// Wynik w pamięci (LRU po kluczu wejścia) — rozwinięcie projektu woła się przy każdej budowie i każdym kluczu.

import { blockWorldLoops, loopArea, polygonDifference, polygonUnion } from './hullDesignBlocks.js';
import { serviceChannel } from './hullDesignSystems.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const MIRROR_EPS = 0.5;

/**
 * RYTMY (wymiary w jd): A „obwódka i wpusty” (jak wzór użytkownika), B „pasy wzdłuż burt”, C „pasy i żebra”.
 * `inset`: { lo, hi (od brzegu), step (krok cięć poprzecznych), cut (rów między wpustami), axis (rów osi między
 * wpustami), ch (faza rogów), minW (najwęższy wpust) }.
 */
export const HD_SHELL_RHYTHMS = Object.freeze({
  wzor: Object.freeze({ label: 'A · obwódka i wpusty', rim: 44, bands: 0, bandStep: 34, ribStep: 0, keel: true,
    inset: Object.freeze({ lo: 62, hi: 230, step: 440, cut: 16, axis: 16, ch: 22, minW: 40 }) }),
  pasy: Object.freeze({ label: 'B · pasy wzdłuż burt', rim: 44, bands: 4, bandStep: 34, ribStep: 0, keel: true, inset: null }),
  zebra: Object.freeze({ label: 'C · pasy i żebra', rim: 44, bands: 3, bandStep: 40, ribStep: 110, keel: true, inset: null })
});
export const HD_SHELL_RHYTHM_KEYS = Object.freeze(Object.keys(HD_SHELL_RHYTHMS));
/** Zakresy parametrów (edytor, normalizacja, strażnik) [jd]. */
export const HD_SHELL_LIMITS = Object.freeze({
  rim: [8, 200], bands: [0, 8], bandStep: [8, 200], ribStep: [0, 600], grooveW: [0.6, 8], niche: [0, 24],
  inset: Object.freeze({ lo: [8, 400], hi: [16, 2000], step: [0, 2000], cut: [4, 80], axis: [0, 80], ch: [0, 80], minW: [8, 400] })
});
/** Szerokość rowków [jd]: obwódka i reszta; wnęka przy przyłączu paliwa [jd] ponad kanał serwisowy. */
export const HD_SHELL_DEFAULTS = Object.freeze({ rhythm: 'wzor', grooveW: 3, rimGrooveW: 4, niche: 6, maxCells: 6e6 });

/**
 * Normalizacja pola `shell`: brak, false albo { on: false } → null (płyty z klocków). Pola spoza rytmu nadpisują
 * jego wartości; wynik ma komplet pól (stały klucz). `inset: null` — bez wpustów.
 */
export function normalizeHullShell(v) {
  if (!v || v.on === false) return null;
  const rhythm = HD_SHELL_RHYTHMS[v.rhythm] ? v.rhythm : HD_SHELL_DEFAULTS.rhythm;
  const R = HD_SHELL_RHYTHMS[rhythm], L = HD_SHELL_LIMITS;
  const r = (k, d) => clamp(num(v[k], d), L[k][0], L[k][1]);
  let inset = null;
  const iv = v.inset === undefined ? R.inset : v.inset;
  if (iv) {
    const base = R.inset || HD_SHELL_RHYTHMS.wzor.inset;
    const ri = (k) => clamp(num(iv[k], base[k]), L.inset[k][0], L.inset[k][1]);
    inset = { lo: ri('lo'), hi: ri('hi'), step: ri('step'), cut: ri('cut'), axis: ri('axis'), ch: ri('ch'), minW: ri('minW') };
    if (inset.hi < inset.lo + inset.minW) inset.hi = inset.lo + inset.minW;
  }
  return {
    rhythm,
    rim: r('rim', R.rim),
    bands: Math.round(r('bands', R.bands)),
    bandStep: r('bandStep', R.bandStep),
    ribStep: r('ribStep', R.ribStep),
    inset,
    keel: v.keel === undefined ? R.keel : v.keel !== false,
    grooveW: r('grooveW', HD_SHELL_DEFAULTS.grooveW),
    niche: r('niche', HD_SHELL_DEFAULTS.niche)
  };
}

/**
 * Rów wzdłuż osi z „pióra” stacji [[x, pół-szerokość], …] — klocki-wycięcia poziomu 1 (trapezy na osi, obrót ±90°),
 * tak jak gracz kładzie wycięcie w edytorze. Pół-szerokość 0 — szpic.
 */
export function axisTrench(stations, level = 1) {
  const st = stations.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i + 1 < st.length; i++) {
    const [x0, h0] = st[i], [x1, h1] = st[i + 1];
    const hw = Math.max(h0, h1);
    if (!(hw > 0) || !(x1 > x0)) continue;
    // trapez obrócony o +90°: wcięcia a, b po stronie dziobu (x1); −90° — po stronie rufy (x0)
    const fwdNarrow = h1 <= h0;
    out.push({ kind: 'block', shape: 'trap', op: 'cut', level, x: (x0 + x1) / 2, y: 0, w: 2 * hw, h: x1 - x0,
      rot: fwdNarrow ? Math.PI / 2 : -Math.PI / 2, a: hw - Math.min(h0, h1), b: hw - Math.min(h0, h1) });
  }
  return out;
}

/** Faza rogów pętli (jak cornerCut geometrii): róg o skręcie ≥ minTurnDeg ścięty o min(ch, ½ krótszej krawędzi). */
function cornerCut(pts, ch, minTurnDeg = 30) {
  if (!(ch > 0)) return pts;
  const n = pts.length, cosMin = Math.cos(minTurnDeg * Math.PI / 180), out = [];
  for (let i = 0; i < n; i++) {
    const P = pts[(i - 1 + n) % n], V = pts[i], N = pts[(i + 1) % n];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) { out.push(V); continue; }
    const ix = (V[0] - P[0]) / lp, iy = (V[1] - P[1]) / lp, ox = (N[0] - V[0]) / ln, oy = (N[1] - V[1]) / ln;
    if (ix * ox + iy * oy > cosMin) { out.push(V); continue; }
    const t = Math.min(ch, lp * 0.5, ln * 0.5);
    out.push([V[0] - ix * t, V[1] - iy * t], [V[0] + ox * t, V[1] + oy * t]);
  }
  return out;
}

/** Prostokąt obrócony (środek, obrót, pół-wymiary) → pętla w obiegu klocków. */
function rectLoop(x, y, rot, hw, hh) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
}

// ---------------------------------------------------------------------------
// Siatka odległości

/** Siatka symetryczna względem osi nad pudłem wielokątów (`box` [x0, y0, x1, y1]) o komórce `c` [j.]. */
function makeGrid(box, c, pad) {
  const ymax = Math.max(Math.abs(box[1]), Math.abs(box[3])) + pad;
  const nh = Math.ceil(ymax / c);
  const x0 = Math.floor((box[0] - pad) / c) * c;
  const w = Math.ceil((box[2] + pad - x0) / c);
  return { x0, y0: -nh * c, w, h: 2 * nh, c };
}

/** Wnętrze wielokątów (parzysto-nieparzyście) w środkach komórek — Uint8Array. */
function rasterInside(parts, g) {
  const { x0, y0, w, h, c } = g;
  const m = new Uint8Array(w * h);
  const edges = [];
  for (const p of parts) for (const loop of [p.outer, ...p.holes]) {
    for (let i = 0, n = loop.length; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      if (a[1] !== b[1]) edges.push(a[0], a[1], b[0], b[1]);
    }
  }
  const xs = [];
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * c;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const ax = edges[e], ay = edges[e + 1], bx = edges[e + 2], by = edges[e + 3];
      if ((ay <= y) !== (by <= y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / c - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / c - 0.5));
      for (let i = i0; i <= i1; i++) m[j * w + i] = 1;
    }
  }
  return m;
}

/**
 * Odległość ośmiokątna [j.] od brzegu wnętrza `m` (transformata dwuprzebiegowa, wagi c i c·√2); poza wnętrzem 0.
 * Środek komórki leży pół komórki od brzegu — odjęte.
 */
function chamferDistance(m, g) {
  const { w, h, c } = g;
  const a = c, b = c * Math.SQRT2, INF = 1e30;
  const d = new Float32Array(w * h);
  for (let q = 0; q < w * h; q++) d[q] = m[q] ? INF : 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const q = j * w + i;
      let v = d[q];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[q - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[q - w] + a);
        if (i > 0) v = Math.min(v, d[q - w - 1] + b);
        if (i + 1 < w) v = Math.min(v, d[q - w + 1] + b);
      }
      d[q] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const q = j * w + i;
      let v = d[q];
      if (v === 0) continue;
      if (i + 1 < w) v = Math.min(v, d[q + 1] + a);
      if (j + 1 < h) {
        v = Math.min(v, d[q + w] + a);
        if (i + 1 < w) v = Math.min(v, d[q + w + 1] + b);
        if (i > 0) v = Math.min(v, d[q + w - 1] + b);
      }
      d[q] = v;
    }
  }
  for (let q = 0; q < w * h; q++) if (d[q] > 0) d[q] = Math.max(0, d[q] - c * 0.5);
  return d;
}

// ---------------------------------------------------------------------------
// Izolinie (marching squares) → łamane

/**
 * Izolinie pola `f` (wartości w środkach komórek) na poziomie 0, tylko w wierszach `j0 … j1` (komórki marszu między
 * środkami). Zwraca łamane [{ pts, closed }].
 */
function isolines(f, g, j0 = 0, j1 = g.h - 1) {
  const { x0, y0, w, c } = g;
  const X = (i) => x0 + (i + 0.5) * c, Y = (j) => y0 + (j + 0.5) * c;
  const pt = new Map();
  const segs = [];
  const keyH = (i, j) => (j * w + i) * 2, keyV = (i, j) => (j * w + i) * 2 + 1;
  const put = (k, x, y) => { if (!pt.has(k)) pt.set(k, [x, y]); return k; };
  const lerp = (va, vb) => va / (va - vb);
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const va = f[j * w + i], vb = f[j * w + i + 1], vc = f[(j + 1) * w + i + 1], vd = f[(j + 1) * w + i];
      const idx = (va > 0 ? 1 : 0) | (vb > 0 ? 2 : 0) | (vc > 0 ? 4 : 0) | (vd > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => put(keyH(i, j), X(i) + lerp(va, vb) * c, Y(j));
      const R = () => put(keyV(i + 1, j), X(i + 1), Y(j) + lerp(vb, vc) * c);
      const B = () => put(keyH(i, j + 1), X(i) + lerp(vd, vc) * c, Y(j + 1));
      const L = () => put(keyV(i, j), X(i), Y(j) + lerp(va, vd) * c);
      switch (idx) {
        case 1: case 14: segs.push(L(), T()); break;
        case 2: case 13: segs.push(T(), R()); break;
        case 3: case 12: segs.push(L(), R()); break;
        case 4: case 11: segs.push(R(), B()); break;
        case 6: case 9: segs.push(T(), B()); break;
        case 7: case 8: segs.push(L(), B()); break;
        case 5: case 10: {
          const ctr = (va + vb + vc + vd) * 0.25 > 0;
          if ((idx === 5) === ctr) segs.push(L(), T(), R(), B());
          else segs.push(L(), B(), T(), R());
          break;
        }
      }
    }
  }
  // sklejanie odcinków w łamane: każdy punkt (krawędź marszu) należy do najwyżej dwóch odcinków
  const adj = new Map();
  const link = (k, s) => { const l = adj.get(k); if (l) l.push(s); else adj.set(k, [s]); };
  const nS = segs.length / 2;
  for (let s = 0; s < nS; s++) { link(segs[2 * s], s); link(segs[2 * s + 1], s); }
  const used = new Uint8Array(nS);
  const out = [];
  const walk = (s0, from) => {
    const chain = [from];
    let s = s0, k = from;
    for (;;) {
      used[s] = 1;
      const nk = segs[2 * s] === k ? segs[2 * s + 1] : segs[2 * s];
      chain.push(nk);
      const nx = (adj.get(nk) || []).find((t) => !used[t]);
      if (nx === undefined) return { chain, closed: nk === from };
      s = nx; k = nk;
    }
  };
  // najpierw łamane otwarte (od końców), potem pętle
  for (const [k, l] of adj) {
    if (l.length !== 1 || used[l[0]]) continue;
    const { chain } = walk(l[0], k);
    out.push({ pts: chain.map((q) => pt.get(q)), closed: false });
  }
  for (let s = 0; s < nS; s++) {
    if (used[s]) continue;
    const { chain, closed } = walk(s, segs[2 * s]);
    if (closed) chain.pop();
    out.push({ pts: chain.map((q) => pt.get(q)), closed });
  }
  return out;
}

/** Douglas–Peucker łamanej otwartej. */
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (st.length) {
    const [a, b] = st.pop();
    const A = pts[a], B = pts[b];
    const vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
    let best = -1, bd = t2;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      let t = L2 > 0 ? ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = P[0] - A[0] - vx * t, dy = P[1] - A[1] - vy * t;
      const d2 = dx * dx + dy * dy;
      if (d2 > bd) { bd = d2; best = i; }
    }
    if (best >= 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Uproszczenie łamanej (pętla: rozcięta w punkcie najdalszym od pierwszego). */
function simplifyLine(l, tol) {
  if (!l.closed || l.pts.length < 4) return { pts: simplifyOpen(l.pts, tol), closed: l.closed };
  const P = l.pts;
  let far = 0, fd = -1;
  for (let i = 1; i < P.length; i++) { const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = simplifyOpen(P.slice(0, far + 1), tol), b = simplifyOpen([...P.slice(far), P[0]], tol);
  return { pts: [...a, ...b.slice(1, -1)], closed: true };
}

const R3 = (v) => Math.round(v * 1000) / 1000;
const roundPts = (pts) => pts.map(([x, y]) => [R3(x), R3(y) === 0 ? 0 : R3(y)]);
const polyLength = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/** Łamana przycięta do burty y ≤ 0 (kawałki; przecięcia z osią wstawione). */
function clipToHalf(l) {
  const P = l.closed ? [...l.pts, l.pts[0]] : l.pts;
  const out = [];
  let cur = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (i > 0) {
      const q = P[i - 1];
      if ((q[1] <= 0) !== (p[1] <= 0)) {
        const t = q[1] / (q[1] - p[1]);
        cur.push([q[0] + (p[0] - q[0]) * t, 0]);
        if (p[1] > 0) { if (cur.length >= 2) out.push(cur); cur = []; }
      }
    }
    if (p[1] <= 0) cur.push(p);
  }
  if (cur.length >= 2) out.push(cur);
  if (l.closed && out.length > 1 && P[0][1] <= 0) { const last = out.pop(); out[0] = [...last, ...out[0].slice(1)]; }
  if (l.closed && out.length === 1 && out[0].length === P.length) return [{ pts: out[0].slice(0, -1), closed: true }];
  return out.map((pts) => ({ pts, closed: false }));
}

const CACHE = new Map();
const CACHE_MAX = 4;

/**
 * SKORUPA: `frame` — wielokąty sylwetki [[obrys, …otwory], …] (rama z klocków, kopie lustra już w środku), `cuts` —
 * klocki-wycięcia poziomu 1 (znormalizowane), `modules` — moduły rozwinięte (z kopiami lustra; wnęki przy przyłączach
 * paliwa), `detail` [j./jd], `mirror`, `shell` (normalizeHullShell). Zwraca { plate: [{ outer, holes }], grooves
 * (burta y ≤ 0 przy lustrze; { pts, w, shell }), insets (pętle wpustów), openings, grid, stats }.
 */
export function hullShellGeometry({ frame, cuts = [], modules = [], detail, mirror = true, shell }) {
  const key = JSON.stringify([frame, cuts, modules.map((m) => [m.type, m.x, m.y, m.rot, m.w, m.h]), detail, mirror, shell]);
  const hit = CACHE.get(key);
  if (hit) { CACHE.delete(key); CACHE.set(key, hit); return hit; }
  const res = computeShell(frame, cuts, modules, detail, mirror, shell);
  CACHE.set(key, res);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return res;
}

function computeShell(frame, cuts, modules, D, half, R) {
  const stats = { cells: 0, grooves: 0, insets: 0, groovePts: 0, grooveLen: 0, niches: 0 };
  // otwarcia: klocki-wycięcia (z lustrem) + wnęki przy przyłączach paliwa
  const openLoops = [];
  for (const b of cuts) {
    openLoops.push(blockWorldLoops(b, false));
    if (half && b.mirror !== false && Math.abs(b.y) > MIRROR_EPS) openLoops.push(blockWorldLoops(b, true));
  }
  if (R.niche > 0) {
    for (const m of modules) {
      const ch = serviceChannel(m, D, true);
      if (!ch) continue;
      const g = R.niche * D;
      openLoops.push([rectLoop(ch.x, ch.y, ch.rot, ch.w + g, ch.h + g)]);
      stats.niches++;
    }
  }
  const openings = openLoops.length ? polygonUnion(openLoops) : [];
  let plate = !frame.length ? [] : (openings.length
    ? polygonDifference(frame.flat(), openings.flatMap((p) => [p.outer, ...p.holes]))
    : polygonUnion(frame));
  plate = plate.filter((p) => Math.abs(loopArea(p.outer)) > 1e-6);
  const grooves = [], insets = [];
  if (!plate.length) return { plate, grooves, insets, openings, grid: null, stats };

  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of plate) for (const [x, y] of p.outer) {
    if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
  }
  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  let c = Math.max(D * 0.9, span / 3200);
  const area0 = (box[2] - box[0] + 4 * c) * ((half ? 1 : 2) * Math.max(Math.abs(box[1]), Math.abs(box[3])) + 4 * c);
  if (area0 / (c * c) > HD_SHELL_DEFAULTS.maxCells) c = Math.sqrt(area0 / HD_SHELL_DEFAULTS.maxCells);
  const g = makeGrid(box, c, 2 * c);
  if (half) g.h = g.h / 2;                        // tylko wiersze y < 0 (ostatni wiersz przy osi)
  const inside = rasterInside(plate, g);
  const dist = chamferDistance(inside, g);
  const N = g.w * g.h;
  stats.cells = N;
  const tol = Math.max(0.35 * c, 0.25 * D);
  const f = new Float32Array(N);
  const gw = R.grooveW, rimW = Math.max(gw, HD_SHELL_DEFAULTS.rimGrooveW);
  const addLines = (lines, w, minLen, kind) => {
    for (const l0 of lines) {
      for (const l1 of (half ? clipToHalf(simplifyLine(l0, tol)) : [simplifyLine(l0, tol)])) {
        if (l1.pts.length < 2 || polyLength(l1.pts) < minLen) continue;
        const pts = roundPts(l1.closed ? [...l1.pts, l1.pts[0]] : l1.pts);
        grooves.push({ pts, w, shell: kind });
      }
    }
  };
  // OBWÓDKA i PASY: izolinie odległości od brzegu skorupy
  const levels = [[R.rim, rimW, 'rim']];
  for (let k = 1; k <= R.bands; k++) levels.push([R.rim + k * R.bandStep, gw, 'band']);
  for (const [t, w, kind] of levels) {
    const tw = t * D;
    for (let q = 0; q < N; q++) f[q] = inside[q] ? dist[q] - tw : -tw;
    addLines(isolines(f, g), w, 3 * w * D, kind);
  }
  // ŻEBRA: odcinki x = const w strefie pasów, krok od x = 0
  if (R.ribStep > 0 && R.bands > 0) {
    const lo = R.rim * D, hi = (R.rim + R.bands * R.bandStep) * D, st = R.ribStep * D;
    for (let x = Math.ceil(box[0] / st) * st; x <= box[2]; x += st) {
      const fi = (x - g.x0) / c - 0.5, i = Math.floor(fi), t = fi - i;
      if (i < 0 || i + 1 >= g.w) continue;
      const at = (j) => (inside[j * g.w + i] || inside[j * g.w + i + 1] ? dist[j * g.w + i] * (1 - t) + dist[j * g.w + i + 1] * t : -1);
      let ya = null;
      for (let j = 0; j <= g.h; j++) {
        const v = j < g.h ? at(j) : -1;
        const on = v >= lo && v <= hi;
        const y = g.y0 + (j + 0.5) * c;
        if (on && ya === null) ya = y;
        if (!on && ya !== null) {
          const yb = Math.min(y - c, half ? 0 : Infinity);
          if (yb - ya > 0.5 * R.bandStep * D) grooves.push({ pts: [[R3(x), R3(ya)], [R3(x), R3(yb) === 0 ? 0 : R3(yb)]], w: gw, shell: 'rib' });
          ya = null;
        }
      }
    }
  }
  // WPUSTY: strefa lo … hi od brzegu minus rowy poprzeczne (co step) i rów osi; brzeg kawałka = izolinia 0
  if (R.inset) {
    const I = R.inset;
    const lo = I.lo * D, hi = I.hi * D, st = I.step * D, cutH = I.cut * D * 0.5;
    // przy lustrze rów osi co najmniej pół komórki — kawałek nie może przejść przez oś (siatka kończy się na osi)
    const axH = Math.max(I.axis * D * 0.5, half ? c : 0);
    for (let j = 0; j < g.h; j++) {
      const y = g.y0 + (j + 0.5) * c;
      for (let i = 0; i < g.w; i++) {
        const q = j * g.w + i;
        if (!inside[q]) { f[q] = -lo; continue; }
        const x = g.x0 + (i + 0.5) * c;
        const dx = st > 0 ? Math.abs(x - Math.round(x / st) * st) - cutH : Infinity;
        f[q] = Math.min(dist[q] - lo, hi - dist[q], dx, Math.abs(y) - axH);
      }
    }
    const minA = (I.minW * D) ** 2 * 2;
    for (const l of isolines(f, g)) {
      if (!l.closed) continue;
      const s = simplifyLine(l, tol);
      const A = Math.abs(loopArea(s.pts));
      if (A < minA || 2 * A / polyLength([...s.pts, s.pts[0]]) < I.minW * D * 0.5) continue;
      const pts = roundPts(I.ch > 0 ? cornerCut(s.pts, I.ch * D) : s.pts);
      insets.push(pts);
      grooves.push({ pts: [...pts, pts[0]], w: gw, shell: 'inset' });
    }
  }
  // STĘPKA: rowek na osi tam, gdzie płyta sięga dalej niż obwódka (przy lustrze — wiersz przy osi)
  if (R.keel) {
    const rows = half ? [g.h - 1] : [g.h / 2 - 1, g.h / 2];
    let xa = null;
    for (let i = 0; i <= g.w; i++) {
      let v = Infinity;
      for (const j of rows) v = Math.min(v, i < g.w && inside[j * g.w + i] ? dist[j * g.w + i] : 0);
      const x = g.x0 + (i + 0.5) * c;
      const on = v >= (R.rim + 0.5 * (R.bandStep || R.rim)) * D;
      if (on && xa === null) xa = x;
      if (!on && xa !== null) {
        if (x - c - xa > 4 * R.rim * D) grooves.push({ pts: [[R3(xa), 0], [R3(x - c), 0]], w: gw, shell: 'keel' });
        xa = null;
      }
    }
  }
  stats.grooves = grooves.length;
  stats.insets = insets.length;
  for (const q of grooves) { stats.groovePts += q.pts.length; stats.grooveLen += polyLength(q.pts); }
  stats.grooveLen = Math.round(stats.grooveLen);
  return { plate, grooves, insets, openings, grid: { x0: g.x0, y0: g.y0, w: g.w, h: g.h, c }, stats };
}
