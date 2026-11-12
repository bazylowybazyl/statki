// src/game/hullDesign/hullDesignPaint.js
//
// KREATOR KADŁUBÓW — WARSTWA MALOWANIA (pędzel; czysta: bez three i DOM). Klocek albo kasztel z `paint` (slot palety
// HD_PAINT_SLOTS albo własna '#rrggbb') ma płyty w tej barwie zamiast płyty / nadbudówki palety. Warstwa nie zmienia
// geometrii: raster na siatce pola (kompozytor próbkuje go w passie barw), a barwy slotów rozwiązuje kompozytor z palety
// projektu w chwili wypieku — zmiana palety nacji przemalowuje też pomalowane klocki.
//
//   hullPaintLayer(design, grid) → { key, table: [wartość pędzla, …] (indeks 1 = table[0]), w, h,
//                                    data: Uint8Array RGBA (R — indeks w tabeli, A — pokrycie 0–255) albo null }
//
// Raster: 2 × 2 próbki na teksel (pokrycie brzegu, kompozytor próbkuje je dwuliniowo), pędzle w kolejności projektu (późniejszy na wierzchu), kopie lustra jak bryły.

import { blockWorldLoops, normalizeHullPaint } from './hullDesignBlocks.js';
import { expandCastle } from './hullDesignCastles.js';
import { HD_LEVELS } from './hullDesignSchema.js';

/** Najwięcej różnych barw pędzla na projekt (wiersze 12–27 palety kompozytora). */
export const HD_PAINT_MAX = 15;
const SS = 2;

/** Pędzle projektu: [{ paint, loops: [[[x, y], …], …] }] w kolejności (klocki, potem kasztele), z kopiami lustra. */
export function hullPaintStrokes(design) {
  const out = [];
  const mirrorOf = (o) => design.mirror && o.mirror !== false;
  for (const s of design.shapes || []) {
    if (s.kind !== 'block' || s.op === 'cut') continue;
    const paint = normalizeHullPaint(s.paint);
    if (!paint) continue;
    const loops = blockWorldLoops(s, false);
    if (mirrorOf(s) && Math.abs(s.y) > 1e-6) loops.push(...blockWorldLoops(s, true));
    out.push({ paint, loops });
  }
  for (const c of design.castles || []) {
    const paint = normalizeHullPaint(c.paint);
    if (!paint) continue;
    const loops = [];
    const copies = [false];
    if (mirrorOf(c) && Math.abs(c.y) >= c.h * 0.35) copies.push(true);
    for (const flip of copies) {
      const ex = expandCastle(c, flip, design.detail, HD_LEVELS);
      if (ex.shapes[0]?.pts) loops.push(ex.shapes[0].pts);
    }
    out.push({ paint, loops });
  }
  return out;
}

/** Raster pędzli na siatce pola { x0, y0, w, h, res } (patrz nagłówek). */
export function hullPaintLayer(design, grid) {
  const strokes = hullPaintStrokes(design);
  const table = [];
  for (const s of strokes) {
    if (!table.includes(s.paint) && table.length < HD_PAINT_MAX) table.push(s.paint);
    s.index = table.indexOf(s.paint) + 1;
  }
  const key = `${grid.x0},${grid.y0},${grid.w},${grid.h},${grid.res}|${JSON.stringify(strokes.map((s) => [s.index, s.loops]))}`;
  const { x0, y0, w, h, res } = grid;
  if (!strokes.length) return { key, table, w, h, data: null };
  // pudło pędzli w tekselach
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const s of strokes) {
    s.edges = [];
    s.y0 = Infinity; s.y1 = -Infinity;
    for (const loop of s.loops) {
      for (let k = 0, n = loop.length; k < n; k++) {
        const a = loop[k], b = loop[(k + 1) % n];
        s.edges.push(a[0], a[1], b[0], b[1]);
        if (a[1] < s.y0) s.y0 = a[1]; if (a[1] > s.y1) s.y1 = a[1];
        if (a[0] < bx0) bx0 = a[0]; if (a[0] > bx1) bx1 = a[0];
        if (a[1] < by0) by0 = a[1]; if (a[1] > by1) by1 = a[1];
      }
    }
  }
  const i0 = Math.max(0, Math.floor((bx0 - x0) * res) - 1), i1 = Math.min(w - 1, Math.ceil((bx1 - x0) * res) + 1);
  const j0 = Math.max(0, Math.floor((by0 - y0) * res) - 1), j1 = Math.min(h - 1, Math.ceil((by1 - y0) * res) + 1);
  const data = new Uint8Array(w * h * 4);
  if (i1 < i0 || j1 < j0) return { key, table, w, h, data };
  const span = (i1 - i0 + 1) * SS;
  const row = new Uint8Array(span);       // indeks pędzla próbek jednego podwiersza
  const cnt = new Uint8Array(i1 - i0 + 1);
  const idx = new Uint8Array(i1 - i0 + 1);
  const xs = [];
  const inv = 1 / (res * SS);
  const sx0 = x0 + i0 / res;               // lewy brzeg pierwszej próbki − pół próbki
  // bufory podwiersza i wiersza tekseli są zerowe na starcie; czyści się tylko dotknięty zakres
  for (let j = j0; j <= j1; j++) {
    let cLo = cnt.length, cHi = -1;
    for (let sj = 0; sj < SS; sj++) {
      const py = y0 + (j + (sj + 0.5) / SS) / res;
      let tLo = span, tHi = -1;
      for (const s of strokes) {
        if (py < s.y0 || py > s.y1) continue;
        xs.length = 0;
        const E = s.edges;
        for (let e = 0; e < E.length; e += 4) {
          const ay = E[e + 1], by = E[e + 3];
          if ((ay <= py) !== (by <= py)) xs.push(E[e] + (py - ay) / (by - ay) * (E[e + 2] - E[e]));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(0, Math.ceil((xs[k] - sx0) / inv - 0.5)), b = Math.min(span - 1, Math.floor((xs[k + 1] - sx0) / inv - 0.5));
          if (b < a) continue;
          if (a < tLo) tLo = a;
          if (b > tHi) tHi = b;
          row.fill(s.index, a, b + 1);
        }
      }
      for (let t = tLo; t <= tHi; t++) {
        const v = row[t];
        if (!v) continue;
        const c = (t / SS) | 0;
        if (c < cLo) cLo = c;
        if (c > cHi) cHi = c;
        cnt[c]++;
        idx[c] = v;
      }
      if (tHi >= tLo) row.fill(0, tLo, tHi + 1);
    }
    for (let c = cLo; c <= cHi; c++) {
      if (!cnt[c]) continue;
      const o = (j * w + i0 + c) * 4;
      data[o] = idx[c];
      data[o + 3] = Math.round(cnt[c] * 255 / (SS * SS));
    }
    if (cHi >= cLo) { cnt.fill(0, cLo, cHi + 1); idx.fill(0, cLo, cHi + 1); }
  }
  return { key, table, w, h, data };
}
