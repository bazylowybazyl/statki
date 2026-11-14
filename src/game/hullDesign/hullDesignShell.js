// src/game/hullDesign/hullDesignShell.js
//
// KREATOR KADŁUBÓW — PANCERZ Z OBRYSU (temat 2 generatora kadłubów, PROTOTYP CPU, niewpięty; propozycja:
// docs/PROPOZYCJA-kreator-pancerz.md, makieta: scripts/kreator-pancerz-makieta.mjs, test: tests/hullDesignShell.test.mjs).
// Czysty moduł: bez three i DOM.
//
// Zamiast płyt kładzionych klocek po klocku (każda z własną fazą, szwem i rowem wokół) — JEDNA CIĄGŁA SKORUPA idąca za
// całą sylwetką (rama projektu = suma pełnych obrysów klocków) z jawnie zadanymi OTWARCIAMI (klocki-wycięcia: rów
// wzdłuż osi, wnęki silników). Rytm pancerza rysują ROWKI liczone z odległości od brzegu skorupy (burty i ścian
// otwarć), więc wszystkie linie idą równolegle do burt i obchodzą otwarcia:
//   - OBWÓDKA — izolinia w odległości `rim` jd od brzegu (pas wzdłuż całej sylwetki i wokół otwarć),
//   - PASY — kolejne izolinie co `bandStep` jd (`bands` sztuk),
//   - ŻEBRA — odcinki poprzeczne do osi co `ribStep` jd w strefie pasów,
//   - WPUSTY „płyta w płycie” — strefa `inset.lo … inset.hi` jd od brzegu pocięta poprzecznie co `inset.step` jd i wzdłuż
//     osi (`inset.axis`), każdy kawałek obwiedziony rowkiem z fazą rogów `inset.ch`,
//   - STĘPKA — rowek wzdłuż osi (gdy nie ma tam otwarcia).
// Odległość liczy transformata ośmiokątna (wagi 1 i √2) na siatce komórek — izolinie mają w narożach wklęsłych fazy 45°
// jak linie paneli TN, a kawałki, które się nie mieszczą (wąski ząb, kolec), znikają same. Lustro z konstrukcji: rowki
// z burty y ≤ 0, druga burta to kopia (expandHullDesign); siatka jest symetryczna względem osi.
// Wszystkie wymiary rytmu w JEDNOSTKACH DETALU (jd = design.detail j.), szerokość rowków `grooveW` jd.
//
// Wynik `buildHullShell` jest w postaci, którą dzisiejszy projekt rozumie bez zmian kodu: płyta = bryły 'poly' poziomu 1
// (z otworami, przycięte do ramy jak płyty klocków: clip 0 + clipIn), rytm = `grooves` (łamane). `applyHullShell` składa
// z tego wariant projektu do makiety (płyty klocków poziomu 1 zdjęte, `panels` 0 — bez losowej siatki paneli wzdłuż osi).
// Wariant NIE przechodzi `isPlayerBuildable` (wielokąt skorupy i rowki mają setki punktów) — w docelowym formacie skorupa
// jest JEDNĄ cechą projektu (`shell: { rhythm, rim, … }`) rozwijaną w expandHullDesign jak kasztele, a strażnik sprawdza
// tylko jej parametry (propozycja, § „Format i edytor”).

import { expandHullDesign, normalizeHullDesign } from './hullDesignSchema.js';
import { blockWorldLoops, loopArea, normalizeBlock, polygonDifference, polygonUnion, HD_BLOCK_TUNE } from './hullDesignBlocks.js';
import { cornerCut } from './hullDesignGeometry.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const MIRROR_EPS = 1e-6;

/**
 * RYTMY pancerza (warianty do wyboru użytkownika; wymiary w jd). `rim` — szerokość obwódki, `bands` / `bandStep` — pasy
 * równoległe do burt, `ribStep` — żebra poprzeczne w strefie pasów, `inset` — wpusty { lo, hi (Infinity — do środka),
 * step, cut (szerokość rowu między wpustami), axis (rów osi między wpustami), ch (faza rogów), minW (najwęższy wpust) },
 * `keel` — rowek stępki wzdłuż osi.
 */
export const HD_SHELL_RHYTHMS = Object.freeze({
  wzor: Object.freeze({ label: 'Obwódka i wpusty', rim: 44, bands: 0, ribStep: 0, keel: true,
    inset: Object.freeze({ lo: 62, hi: 230, step: 440, cut: 16, axis: 16, ch: 22, minW: 40 }) }),
  pasy: Object.freeze({ label: 'Pasy wzdłuż burt', rim: 44, bands: 4, bandStep: 34, ribStep: 0, keel: true, inset: null }),
  zebra: Object.freeze({ label: 'Pasy i żebra', rim: 44, bands: 3, bandStep: 40, ribStep: 110, keel: true, inset: null })
});

/** Ustawienia domyślne narzędzia (poza rytmem): szerokość rowków [jd], rozmiar komórki siatki odległości (0 — z detalu). */
export const HD_SHELL_DEFAULTS = Object.freeze({ rhythm: 'wzor', grooveW: 3, rimGrooveW: 4, cell: 0, maxCells: 6e6 });

// ---------------------------------------------------------------------------
// Sylwetka i otwarcia

/** Sylwetka projektu: rama z klocków (suma pełnych obrysów, z lustrem) — lista wielokątów [obrys, …otwory]. */
export function hullShellSilhouette(designInput) {
  const ex = expandHullDesign(designInput);
  const out = [];
  for (const s of ex.shapes) if (s.blockSet === 'frame' && s.op === 'add') out.push([s.pts, ...(s.holes || [])]);
  return out;
}

/** Otwarcia (klocki-wycięcia; kopia lustra jak w projekcie) → suma wielokątów [{ outer, holes }]. */
export function hullShellOpenings(openings, mirror = true) {
  const loops = [];
  for (const o of openings || []) {
    const b = normalizeBlock({ ...o, kind: 'block', op: 'cut' });
    loops.push(blockWorldLoops(b, false));
    if (mirror && b.mirror !== false && Math.abs(b.y) > MIRROR_EPS) loops.push(blockWorldLoops(b, true));
  }
  return loops.length ? polygonUnion(loops) : [];
}

/**
 * Rów wzdłuż osi z „pióra” stacji [[x, pół-szerokość], …] (od rufy ku dziobowi) — klocki-wycięcia (trapezy na osi,
 * obrót +90°: podstawa od rufy), tak jak gracz kładzie wycięcie w edytorze. Pół-szerokość 0 — szpic.
 */
export function axisTrench(stations, level = 1) {
  const st = stations.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i + 1 < st.length; i++) {
    const [x0, h0] = st[i], [x1, h1] = st[i + 1];
    const hw = Math.max(h0, h1);
    if (!(hw > 0) || !(x1 > x0)) continue;
    // trapez obrócony o +90°: w — szerokość w poprzek (2·hw), h — długość; a, b wcinają róg po stronie dziobu (x1),
    // rot −90° — po stronie rufy (x0)
    const fwdNarrow = h1 <= h0;
    out.push({ kind: 'block', shape: 'trap', op: 'cut', level, x: (x0 + x1) / 2, y: 0, w: 2 * hw, h: x1 - x0,
      rot: fwdNarrow ? Math.PI / 2 : -Math.PI / 2, a: hw - Math.min(h0, h1), b: hw - Math.min(h0, h1) });
  }
  return out;
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

/** Łamana jako rowek (pętla zamknięta powtórzeniem pierwszego punktu). */
function toGroove(l, w) {
  const pts = roundPts(l.closed ? [...l.pts, l.pts[0]] : l.pts);
  return pts.length >= 2 ? { pts, w } : null;
}

const polyLength = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

// ---------------------------------------------------------------------------
// Skorupa

/**
 * PANCERZ Z OBRYSU. `opts`: rhythm (klucz HD_SHELL_RHYTHMS albo obiekt rytmu), nadpisania pól rytmu (rim, bands,
 * bandStep, ribStep, inset, keel), openings (klocki-wycięcia: rów osi, wnęki — `axisTrench` albo zwykłe klocki), grooveW,
 * rimGrooveW, cell [j.]. Zwraca { detail, half, silhouette, openings, plate: [{ outer, holes }], grooves, insets (pętle
 * wpustów), grid, stats }. Rowki tylko z burty y ≤ 0 (przy lustrze) — drugą burtę dokłada expandHullDesign.
 */
export function buildHullShell(designInput, opts = {}) {
  const design = normalizeHullDesign(designInput);
  const D = design.detail;
  const half = !!design.mirror;
  const base = typeof opts.rhythm === 'object' ? opts.rhythm : (HD_SHELL_RHYTHMS[opts.rhythm || HD_SHELL_DEFAULTS.rhythm] || HD_SHELL_RHYTHMS.wzor);
  const R = { ...base, ...Object.fromEntries(['rim', 'bands', 'bandStep', 'ribStep', 'inset', 'keel'].filter((k) => opts[k] !== undefined).map((k) => [k, opts[k]])) };
  const grooveW = num(opts.grooveW, HD_SHELL_DEFAULTS.grooveW), rimW = num(opts.rimGrooveW, HD_SHELL_DEFAULTS.rimGrooveW);

  // sylwetka i płyta: sylwetka minus otwarcia (suma geometryczna — bez szwów)
  const silhouette = hullShellSilhouette(design);
  const openings = hullShellOpenings(opts.openings, half);
  let plate;
  if (!silhouette.length) plate = [];
  else if (openings.length) plate = polygonDifference(silhouette.flat(), openings.flatMap((p) => [p.outer, ...p.holes]));
  else plate = polygonUnion(silhouette);
  plate = plate.filter((p) => Math.abs(loopArea(p.outer)) > 1e-6);

  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of plate) for (const [x, y] of p.outer) {
    if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
  }
  const grooves = [], insets = [];
  const stats = { cells: 0, isolines: 0, grooves: 0, insets: 0, groovePts: 0, grooveLen: 0 };
  if (!plate.length) return { detail: D, half, silhouette, openings, plate, grooves, insets, grid: null, stats, rhythm: R };

  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  let c = num(opts.cell, HD_SHELL_DEFAULTS.cell) || Math.max(D * 0.9, span / 3200);
  // pułap pamięci: komórek najwyżej maxCells
  const area0 = (box[2] - box[0] + 4 * c) * (2 * Math.max(Math.abs(box[1]), Math.abs(box[3])) + 4 * c);
  if (area0 / (c * c) > HD_SHELL_DEFAULTS.maxCells) c = Math.sqrt(area0 / HD_SHELL_DEFAULTS.maxCells);
  const g = makeGrid(box, c, 2 * c);
  const inside = rasterInside(plate, g);
  const dist = chamferDistance(inside, g);
  stats.cells = g.w * g.h;
  const N = g.w * g.h;
  // przy lustrze: łamane tylko z wierszy y < 0 (+ wiersz przez oś — przycięty niżej do y ≤ 0)
  const jMax = half ? g.h / 2 : g.h - 1;
  const tol = Math.max(0.35 * c, 0.25 * D);
  const f = new Float32Array(N);
  const clipHalf = (l) => (half ? clipToHalf(l) : [l]);
  const addLines = (lines, w, minLen, kind) => {
    for (const l0 of lines) {
      for (const l1 of clipHalf(simplifyLine(l0, tol))) {
        if (l1.pts.length < 2 || polyLength(l1.pts) < minLen) continue;
        const gr = toGroove(l1, w);
        if (!gr) continue;
        gr.shell = kind;
        grooves.push(gr);
      }
    }
  };

  // OBWÓDKA i PASY: izolinie odległości od brzegu skorupy
  const levelsJd = [];
  if (R.rim > 0) levelsJd.push([R.rim, rimW, 'rim']);
  for (let k = 1; k <= (R.bands | 0); k++) levelsJd.push([R.rim + k * R.bandStep, grooveW, 'band']);
  for (const [t, w, kind] of levelsJd) {
    const tw = t * D;
    for (let q = 0; q < N; q++) f[q] = inside[q] ? dist[q] - tw : -tw;
    const lines = isolines(f, g, 0, jMax);
    stats.isolines += lines.length;
    addLines(lines, w, 3 * w * D, kind);
  }

  // ŻEBRA: odcinki x = const w strefie pasów (rim … rim + bands·bandStep), krok od x = 0 (na siatce)
  if (R.ribStep > 0 && R.bands > 0) {
    const lo = R.rim * D, hi = (R.rim + R.bands * R.bandStep) * D, st = R.ribStep * D;
    for (let x = Math.ceil(box[0] / st) * st; x <= box[2]; x += st) {
      const fi = (x - g.x0) / c - 0.5, i = Math.floor(fi), t = fi - i;
      if (i < 0 || i + 1 >= g.w) continue;
      const at = (j) => (inside[j * g.w + i] || inside[j * g.w + i + 1]) ? dist[j * g.w + i] * (1 - t) + dist[j * g.w + i + 1] * t : -1;
      let ya = null;
      const jEnd = half ? g.h / 2 : g.h;
      for (let j = 0; j <= jEnd; j++) {
        const v = j < jEnd ? at(j) : -1;
        const inZ = v >= lo && v <= hi;
        const y = g.y0 + (j + 0.5) * c;
        if (inZ && ya === null) ya = y;
        if (!inZ && ya !== null) {
          const yb = Math.min(y - c, half ? 0 : Infinity);
          if (yb - ya > 0.5 * R.bandStep * D) grooves.push({ pts: [[R3(x), R3(ya)], [R3(x), R3(yb) === 0 ? 0 : R3(yb)]], w: grooveW, shell: 'rib' });
          ya = null;
        }
      }
    }
  }

  // WPUSTY: strefa lo … hi od brzegu minus rowy poprzeczne (co step) i rów osi; brzeg kawałka = izolinia 0 pola g
  if (R.inset) {
    const I = R.inset;
    const lo = I.lo * D, hi = (I.hi === undefined || I.hi === null ? Infinity : I.hi * D), st = I.step * D;
    const cutH = I.cut * D * 0.5, axH = (I.axis || 0) * D * 0.5;
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
    const lines = isolines(f, g, 0, g.h - 1);
    const minA = (I.minW * D) ** 2 * 2;
    for (const l of lines) {
      if (!l.closed) continue;
      const s = simplifyLine(l, tol);
      if (half && s.pts.some(([, y]) => y > MIRROR_EPS)) continue;     // druga burta — z lustra
      if (Math.abs(loopArea(s.pts)) < minA) continue;
      // wąski kawałek (pole / obwód): wpust poniżej minW znika
      if (2 * Math.abs(loopArea(s.pts)) / polyLength([...s.pts, s.pts[0]]) < I.minW * D * 0.5) continue;
      const pts = I.ch > 0 ? cornerCut(s.pts, I.ch * D, 30) : s.pts;
      insets.push(roundPts(pts));
      grooves.push({ ...toGroove({ pts, closed: true }, grooveW), shell: 'inset' });
    }
  }

  // STĘPKA: rowek na osi tam, gdzie płyta sięga dalej niż obwódka
  if (R.keel) {
    const jA = g.h / 2 - 1, jB = g.h / 2;
    let xa = null;
    for (let i = 0; i <= g.w; i++) {
      const v = i < g.w ? Math.min(inside[jA * g.w + i] ? dist[jA * g.w + i] : 0, inside[jB * g.w + i] ? dist[jB * g.w + i] : 0) : 0;
      const x = g.x0 + (i + 0.5) * c;
      const on = v >= (R.rim + 0.5 * (R.bandStep || R.rim)) * D;
      if (on && xa === null) xa = x;
      if (!on && xa !== null) {
        if (x - c - xa > 4 * R.rim * D) grooves.push({ pts: [[R3(xa), 0], [R3(x - c), 0]], w: grooveW, shell: 'keel' });
        xa = null;
      }
    }
  }

  stats.grooves = grooves.length;
  stats.insets = insets.length;
  for (const q of grooves) { stats.groovePts += q.pts.length; stats.grooveLen += polyLength(q.pts); }
  stats.grooveLen = Math.round(stats.grooveLen);
  return { detail: D, half, silhouette, openings, plate, grooves, insets, grid: { x0: g.x0, y0: g.y0, w: g.w, h: g.h, c }, stats, rhythm: R };
}

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
        const X = [q[0] + (p[0] - q[0]) * t, 0];
        cur.push(X);
        if (p[1] > 0) { if (cur.length >= 2) out.push(cur); cur = []; }
      }
    }
    if (p[1] <= 0) cur.push(p);
  }
  if (cur.length >= 2) out.push(cur);
  if (l.closed && out.length > 1 && P[0][1] <= 0) {
    // pętla rozcięta osią: pierwszy i ostatni kawałek to jedna łamana
    const last = out.pop();
    out[0] = [...last, ...out[0].slice(1)];
  }
  if (l.closed && out.length === 1 && out[0].length === P.length) return [{ pts: out[0].slice(0, -1), closed: true }];
  return out.map((pts) => ({ pts, closed: false }));
}

/**
 * Wariant projektu z ciągłym pancerzem (makieta): zdjęte klocki-płyty poziomu 1 (i poziomu ≥ 2, dla których
 * `keepUpper(b)` daje false), dopisana płyta skorupy (bryły 'poly' poziomu 1 przycięte do ramy jak płyty klocków)
 * i rowki rytmu; `panels` 0 — bez losowej siatki paneli wzdłuż osi. Rama (poziom 0) bez zmian.
 */
export function applyHullShell(designInput, shell, opts = {}) {
  const d = structuredClone(designInput);
  const D = shell.detail;
  const keepUpper = opts.keepUpper || (() => true);
  // klocek-płyta schodzi do ramy (poziom 0), nie znika: rama = suma PEŁNYCH obrysów wszystkich klocków dodających,
  // więc zdjęcie płyt zmniejszałoby sylwetkę (Colossus ma burty z klocków poziomu 1)
  d.shapes = d.shapes.map((s) => {
    if (s.kind !== 'block' || s.op === 'cut') return s;
    const L = s.level ?? 1;
    if (L === 0 || (L >= 2 && keepUpper(s))) return s;
    return { ...s, level: 0 };
  });
  for (const p of shell.plate) {
    d.shapes.push({ kind: 'poly', op: 'add', level: 1, pts: roundPts(p.outer), holes: p.holes.length ? p.holes.map(roundPts) : undefined,
      ch: HD_BLOCK_TUNE.plateChDu * D, clip: 0, clipIn: HD_BLOCK_TUNE.rimDu * D, mirror: false });
  }
  d.grooves = [...(d.grooves || []), ...shell.grooves.map(({ pts, w }) => ({ pts, w }))];
  d.panels = opts.panels ?? 0;
  if (opts.name !== false) d.name = `${d.name} — ciągły pancerz (makieta)`;
  return d;
}
