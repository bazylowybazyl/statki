// src/game/hullDesign/hullDesignGeometry.js
//
// KREATOR KADŁUBÓW — geometria projektu (czysta: bez three i DOM). Z bloków, brył i modułów liczy dla każdego
// poziomu (rama / pancerz / nadbudówka / mostek) POLE ODLEGŁOŚCI ze znakiem od krawędzi [j. świata, ujemne
// wewnątrz] — z niego kompozytor TSL (src/3d/hullDesign/hullComposer.js) liczy alfę, fazy, tarasy, rury
// maszynowni, linie paneli, nity, okna i detale, a gra — alfę fizyki (belki). Do tego KOPUŁA (rozmyta sylwetka,
// jak HullSurface sprite'ów — bryła całego kadłuba w normalnych).
//
//   1. kontury bloków poziomu (krawędzie bloków bez sąsiada, sklejone w pętle; na styku po przekątnej pętle
//      rozłączne — skręt w prawo),
//   2. styl: 'chamfer' — rogi ścięte 45° (pojedynczy schodek → prosta 45°, jak marching squares na środkach
//      bloków), 'rounded' — najpierw fazy, potem współliniowe odcinki scalone (schodki = jedna przekątna), krótkie
//      fazy między dłuższymi krawędziami złożone w róg, na końcu łuk w każdym rogu z promieniem ograniczonym
//      długością sąsiednich krawędzi (jak canvas arcTo — bez fal na schodkach), 'sharp' — bez zmian,
//   3. pole: dokładna odległość od odcinków konturu w paśmie ±band (dalej obcięta), znak z wypełnienia
//      parzysto-nieparzystego; bryły (koła, prostokąty, wielokąty) jako prawdziwe pola w kolejności projektu:
//      suma / różnica gładka (styl zaokrąglony — łuk na styku koła z blokami), z fazą (fazowany) albo ostra,
//   4. tarasy: poziom L co najmniej insetDu[L] jd wewnątrz poziomu L − 1,
//   5. rozdzielczość pola i pasmo z SKALI DETALU (design.detail [j./jd]): pole ~0,7 teksela na jd, pasmo 56 jd —
//      fregata 150 j. i lotniskowiec 1100 j. mają pole podobnej wielkości w tekselach.

import { standardizeLoop } from './hullDesignRegularize.js';
import { HD_BLOCK, HD_LEVELS, HD_SHAPE_TUNE, blocksAtLevel, expandHullDesign } from './hullDesignSchema.js';
import { buildPipeNetwork, rasterPipeNetwork } from './hullDesignPipes.js';

// ---------------------------------------------------------------------------
// 1. Kontury bloków

/**
 * Pętle konturu zbioru bloków ('bx,by'), wierzchołki w jednostkach bloków (całkowite), bez punktów
 * współliniowych. Obieg: wnętrze po prawej stronie kierunku (układ obrazu, y w dół).
 */
export function traceBlockContours(cells) {
  const has = (x, y) => cells.has(`${x},${y}`);
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = `${x0},${y0}`;
    let l = out.get(k);
    if (!l) { l = []; out.set(k, l); }
    l.push([x1, y1]);
  };
  for (const key of cells) {
    const c = key.indexOf(',');
    const bx = Number(key.slice(0, c)), by = Number(key.slice(c + 1));
    if (!has(bx, by - 1)) add(bx, by, bx + 1, by);
    if (!has(bx + 1, by)) add(bx + 1, by, bx + 1, by + 1);
    if (!has(bx, by + 1)) add(bx + 1, by + 1, bx, by + 1);
    if (!has(bx - 1, by)) add(bx, by + 1, bx, by);
  }
  const loops = [];
  for (;;) {
    // start w wierzchołku z jedną krawędzią wychodzącą (nie na styku po przekątnej)
    let startKey = null;
    for (const [k, l] of out) if (l.length === 1) { startKey = k; break; }
    if (startKey === null) { for (const k of out.keys()) { startKey = k; break; } }
    if (startKey === null) break;
    const c = startKey.indexOf(',');
    const sx = Number(startKey.slice(0, c)), sy = Number(startKey.slice(c + 1));
    const loop = [];
    let x = sx, y = sy, dx = 0, dy = 0, guard = 0;
    for (;;) {
      const k = `${x},${y}`;
      const l = out.get(k);
      if (!l || !l.length) break;
      let pick = 0;
      if (l.length > 1 && (dx || dy)) {
        // skręt w prawo (y w dół: cross > 0), potem prosto, potem w lewo
        let best = -9;
        for (let i = 0; i < l.length; i++) {
          const ox = l[i][0] - x, oy = l[i][1] - y;
          const cr = dx * oy - dy * ox;
          const score = cr > 0 ? 2 : (cr === 0 ? 1 : 0);
          if (score > best) { best = score; pick = i; }
        }
      }
      const [nx, ny] = l.splice(pick, 1)[0];
      if (!l.length) out.delete(k);
      loop.push([x, y]);
      dx = nx - x; dy = ny - y;
      x = nx; y = ny;
      if (x === sx && y === sy) break;
      if (++guard > 1e6) break;
    }
    if (loop.length >= 3) loops.push(simplifyCollinear(loop));
  }
  return loops;
}

/** Usuwa wierzchołki współliniowe i powtórzone (pętla zamknięta). */
export function simplifyCollinear(pts, eps = 1e-6) {
  let p = pts.slice();
  for (let pass = 0; pass < 4; pass++) {
    const n = p.length;
    if (n < 3) return p;
    const q = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-6) continue;                                    // powtórzony
      if (lv < 1e-6) { q.push(b); continue; }
      const cr = (ux * vy - uy * vx) / (lu * lv);
      const dt = (ux * vx + uy * vy) / (lu * lv);
      if (Math.abs(cr) < eps && dt > 0) continue;                 // współliniowy
      q.push(b);
    }
    if (q.length === p.length) return q;
    p = q;
  }
  return p;
}

// ---------------------------------------------------------------------------
// 2. Style rogów

/**
 * Fazy 45°: róg ścięty o t = min(chamfer, ½ krótszej krawędzi), a róg z krawędzią pojedynczego bloku o połowę
 * krótszej krawędzi — schodki stają się prostą 45° (jak marching squares na środkach bloków).
 */
export function chamferLoop(pts, chamfer = HD_SHAPE_TUNE.chamfer, block = HD_BLOCK) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = pts[(i - 1 + n) % n], V = pts[i], N = pts[(i + 1) % n];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) { out.push(V); continue; }
    const step = lp <= block * 1.01 || ln <= block * 1.01;
    const t = step ? Math.min(lp, ln) * 0.5 : Math.min(chamfer, lp * 0.5, ln * 0.5);
    if (t < 0.01) { out.push(V); continue; }
    out.push([V[0] - (V[0] - P[0]) / lp * t, V[1] - (V[1] - P[1]) / lp * t]);
    out.push([V[0] + (N[0] - V[0]) / ln * t, V[1] + (N[1] - V[1]) / ln * t]);
  }
  return simplifyCollinear(out, 1e-4);
}

function lineIntersect(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  return [a[0] + r0 * t, a[1] + r1 * t];
}

/** Krótka faza między dwiema dłuższymi krawędziami → jeden róg (przecięcie krawędzi sąsiednich). */
export function mergeShortChamfers(pts, maxLen = HD_SHAPE_TUNE.shortMerge) {
  let p = pts.slice();
  for (let pass = 0; pass < 3; pass++) {
    const n = p.length;
    if (n < 5) return p;
    const len = (i) => { const a = p[(i + n) % n], b = p[(i + 1 + n) % n]; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
    const drop = new Uint8Array(n);
    const repl = new Map();
    let changed = false;
    for (let i = 0; i < n; i++) {
      const L = len(i);
      if (L >= maxLen || drop[i] || drop[(i + 1) % n]) continue;
      if (len(i - 1) <= L * 1.05 || len(i + 1) <= L * 1.05) continue;
      const A = p[i], B = p[(i + 1) % n];
      const X = lineIntersect(p[(i - 1 + n) % n], A, B, p[(i + 2) % n]);
      if (!X) continue;
      if (Math.hypot(X[0] - A[0], X[1] - A[1]) > L * 1.5 || Math.hypot(X[0] - B[0], X[1] - B[1]) > L * 1.5) continue;
      repl.set(i, X);
      drop[(i + 1) % n] = 1;
      drop[i] = 1;
      changed = true;
    }
    if (!changed) return p;
    const q = [];
    for (let i = 0; i < n; i++) {
      if (repl.has(i)) q.push(repl.get(i));
      else if (!drop[i]) q.push(p[i]);
    }
    p = simplifyCollinear(q, 1e-4);
  }
  return p;
}

/**
 * Łuk w każdym rogu (jak canvas arcTo): odległość styczna t = R / tg(θ/2) ograniczona do połowy krótszej z
 * sąsiednich krawędzi (zostaje miejsce na łuk sąsiedniego rogu), promień z niej. Łuk jako łamana (≤ stepDeg).
 */
export function roundLoop(pts, radius = HD_SHAPE_TUNE.radius, stepDeg = 5) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = pts[(i - 1 + n) % n], V = pts[i], N = pts[(i + 1) % n];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) { out.push(V); continue; }
    const ix = (V[0] - P[0]) / lp, iy = (V[1] - P[1]) / lp;
    const ox = (N[0] - V[0]) / ln, oy = (N[1] - V[1]) / ln;
    const cosA = Math.max(-1, Math.min(1, ix * ox + iy * oy));
    const alpha = Math.acos(cosA);               // kąt skrętu
    if (alpha < 1e-3) { out.push(V); continue; }
    const tanHalf = Math.tan((Math.PI - alpha) * 0.5);
    let t = radius / Math.max(tanHalf, 1e-6);
    const tMax = 0.5 * Math.min(lp, ln);
    if (t > tMax) t = tMax;
    const r = t * tanHalf;
    if (r < 0.25) { out.push(V); continue; }
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
  return simplifyCollinear(out, 1e-7);
}

/** Kontur bloków (j. bloków) → łamana w j. świata w stylu projektu. */
export function styleLoop(loopBlocks, style, tune = HD_SHAPE_TUNE) {
  const pts = loopBlocks.map(([x, y]) => [x * HD_BLOCK, y * HD_BLOCK]);
  if (style === 'sharp') return pts;
  const ch = chamferLoop(pts, tune.chamfer);
  if (style !== 'rounded') return ch;
  return roundLoop(mergeShortChamfers(ch, tune.shortMerge), tune.radius);
}


// ---------------------------------------------------------------------------
// 2b. Wielokąty (bryły 'poly'): rogi ścięte / zaokrąglone

/**
 * Faza na rogach wielokąta (bryły): róg o skręcie ≥ minTurnDeg ścięty o t = min(ch, ½ krótszej sąsiedniej
 * krawędzi). Rogi prawie proste w linii (punkty pośrednie obrysu) zostają.
 */
export function cornerCut(pts, ch, minTurnDeg = 20) {
  if (!(ch > 0)) return pts;
  const n = pts.length;
  const cosMin = Math.cos(minTurnDeg * Math.PI / 180);
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = pts[(i - 1 + n) % n], V = pts[i], N = pts[(i + 1) % n];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) { out.push(V); continue; }
    const ix = (V[0] - P[0]) / lp, iy = (V[1] - P[1]) / lp, ox = (N[0] - V[0]) / ln, oy = (N[1] - V[1]) / ln;
    if (ix * ox + iy * oy > cosMin) { out.push(V); continue; }
    const t = Math.min(ch, lp * 0.5, ln * 0.5);
    if (t < 0.01) { out.push(V); continue; }
    out.push([V[0] - ix * t, V[1] - iy * t]);
    out.push([V[0] + ox * t, V[1] + oy * t]);
  }
  return simplifyCollinear(out, 1e-4);
}

function treatLoop(loop, s) {
  let pts = simplifyCollinear(loop.map(([x, y]) => [x, y]), 1e-5);
  // STANDARYZACJA (obrys z zaszumionego sprite'a): krawędzie 0 / 45 / 90° na wspólnej siatce linii, bez ząbków, lustro
  // burt zachowane — src/game/hullDesign/hullDesignRegularize.js; kształt, którego się nie da (okruch cieńszy niż
  // najmniejszy element): z `regDrop` znika, bez — zostaje jak był
  if (s.reg > 0) {
    const r = standardizeLoop(pts, s.reg);
    if (r) pts = r;
    else if (s.regDrop) return null;
    // cienki okruch (haczyk, listwa — grubość 2 · pole / obwód poniżej regThin) znika razem z małym polem
    if (s.regDrop && s.regThin > 0) {
      let a = 0, per = 0;
      for (let i = 0, n = pts.length; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
        per += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      a = Math.abs(a) * 0.5;
      if (2 * a / per < s.regThin && a < 25 * s.regThin * s.regThin) return null;
    }
  }
  if (s.ch > 0) pts = cornerCut(pts, s.ch);
  if (s.r > 0) pts = roundLoop(pts, s.r);
  return pts;
}

/** Łamane bryły 'poly' (obrys po rozwinięciu sym + otwory) po fazie / łuku rogów [j.]; [] — bryła znika (okruch). */
export function polyShapeLoops(s) {
  const outer = treatLoop(s.pts, s);
  if (!outer) return [];
  const out = [outer];
  if (s.holes) for (const h of s.holes) { const l = treatLoop(h, s); if (l) out.push(l); }
  return out;
}

/** Zewnętrzna łamana bryły 'poly' (bez otworów); [] — bryła znika (okruch). */
export function polyShapeLoop(s) {
  return treatLoop(s.pts, s) || [];
}

// ---------------------------------------------------------------------------
// 3. Pole odległości

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pole pętli (łamane w j. świata) na siatce `grid` { x0, y0, w, h, res } (teksel i: x = x0 + (i + ½)/res) w oknie
 * tekseli [i0, i1] × [j0, j1] (domyślnie cała siatka): dokładna odległość od odcinków w paśmie ±band, dalej ±band;
 * ujemne wewnątrz (parzysto-nieparzyście). Wynik: Float32Array okna (wiersz po wierszu).
 */
export function polygonField(loops, grid, band, win = null) {
  const { x0, y0, res } = grid;
  const wi0 = win ? win[0] : 0, wi1 = win ? win[1] : grid.w - 1;
  const wj0 = win ? win[2] : 0, wj1 = win ? win[3] : grid.h - 1;
  const w = wi1 - wi0 + 1, h = wj1 - wj0 + 1;
  const f = new Float32Array(w * h).fill(band);
  const inv = 1 / res;
  for (const loop of loops) {
    const n = loop.length;
    for (let s = 0; s < n; s++) {
      const a = loop[s], b = loop[(s + 1) % n];
      const ix0 = Math.max(wi0, Math.floor((Math.min(a[0], b[0]) - band - x0) * res));
      const ix1 = Math.min(wi1, Math.ceil((Math.max(a[0], b[0]) + band - x0) * res));
      const iy0 = Math.max(wj0, Math.floor((Math.min(a[1], b[1]) - band - y0) * res));
      const iy1 = Math.min(wj1, Math.ceil((Math.max(a[1], b[1]) + band - y0) * res));
      for (let j = iy0; j <= iy1; j++) {
        const py = y0 + (j + 0.5) * inv;
        const row = (j - wj0) * w - wi0;
        for (let i = ix0; i <= ix1; i++) {
          const d = segDist(x0 + (i + 0.5) * inv, py, a[0], a[1], b[0], b[1]);
          if (d < f[row + i]) f[row + i] = d;
        }
      }
    }
  }
  // znak: wypełnienie parzysto-nieparzyste w środkach tekseli (wiersz po wierszu)
  const xs = [];
  for (let j = wj0; j <= wj1; j++) {
    const py = y0 + (j + 0.5) * inv;
    xs.length = 0;
    for (const loop of loops) {
      const n = loop.length;
      for (let s = 0; s < n; s++) {
        const a = loop[s], b = loop[(s + 1) % n];
        if ((a[1] <= py) !== (b[1] <= py)) xs.push(a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const row = (j - wj0) * w - wi0;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(wi0, Math.ceil((xs[k] - x0) * res - 0.5));
      const i1 = Math.min(wi1, Math.floor((xs[k + 1] - x0) * res - 0.5));
      for (let i = i0; i <= i1; i++) f[row + i] = -f[row + i];
    }
  }
  return f;
}

/** Odległość ze znakiem od zamkniętych łamanych (ujemna wewnątrz; parzysto-nieparzyście). `loops` — łamana albo lista. */
export function loopDistance(loops, px, py) {
  const list = Array.isArray(loops[0]?.[0]) ? loops : [loops];
  let d = Infinity, inside = false;
  for (const loop of list) {
    const n = loop.length;
    for (let s = 0, k = n - 1; s < n; k = s++) {
      const a = loop[k], b = loop[s];
      const v = segDist(px, py, a[0], a[1], b[0], b[1]);
      if (v < d) d = v;
      if ((a[1] <= py) !== (b[1] <= py) && px < a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) inside = !inside;
    }
  }
  return inside ? -d : d;
}

const SQRT1_2 = Math.SQRT1_2;

/** Pole bryły (koło / prostokąt z zaokrągleniem, fazą i obrotem / wielokąt) w punkcie. */
export function shapeDistance(s, px, py) {
  if (s.kind === 'circle') { const dx = px - s.x, dy = py - s.y; return Math.sqrt(dx * dx + dy * dy) - s.r; }
  if (s.kind === 'poly') return loopDistance(s._loops || polyShapeLoops(s), px, py);
  let dx = px - s.x, dy = py - s.y;
  if (s.rot) {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
    dx = lx; dy = ly;
  }
  const r = s.r || 0;
  const qx = Math.abs(dx) - (s.w - r), qy = Math.abs(dy) - (s.h - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  let d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  if (s.ch > 0) d = Math.max(d, (Math.abs(dx) + Math.abs(dy) - (s.w + s.h - s.ch)) * SQRT1_2);
  return d;
}

/** Pudło bryły [x0, y0, x1, y1]. */
export function shapeBox(s) {
  if (s.kind === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
  if (s.kind === 'poly') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const loop of s.holes ? [s.pts, ...s.holes] : [s.pts]) {
      for (const [x, y] of loop) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return [x0, y0, x1, y1];
  }
  const R = Math.hypot(s.w, s.h);
  return [s.x - R, s.y - R, s.x + R, s.y + R];
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Suma pól w stylu projektu (łuk / faza / ostro na styku). */
export function fieldUnion(a, b, style, tune = HD_SHAPE_TUNE) {
  if (style === 'rounded') return smin(a, b, tune.blendRounded);
  if (style === 'chamfer') return Math.min(Math.min(a, b), (a + b - tune.blendChamfer) * SQRT1_2);
  return Math.min(a, b);
}
/** Różnica pól: z a wycięte b. */
export function fieldSubtract(a, b, style, tune = HD_SHAPE_TUNE) {
  if (style === 'rounded') return -smin(-a, b, tune.blendRounded);
  if (style === 'chamfer') return Math.max(Math.max(a, -b), (a + tune.blendChamfer - b) * SQRT1_2);
  return Math.max(a, -b);
}

/** Pudło kadłuba (poziom 0) z konturów i brył dodających [j.]. */
function designBox(loops0, shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops0) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const s of shapes) {
    if (s.op !== 'add') continue;
    const b = shapeBox(s);
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  if (!(x1 > x0)) return [-60, -60, 60, 60];
  return [x0, y0, x1, y1];
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/** Skala pola projektu: { detail [j./jd], band [j.], res [teksele/j.], pad [j.] }. */
export function hullFieldScale(design, tune = HD_SHAPE_TUNE) {
  const D = design.detail;
  return {
    detail: D,
    band: clamp(tune.bandDu * D, tune.bandMin, tune.bandMax),
    res: clamp(tune.fieldTexPerDu / D, tune.fieldResMin, tune.fieldResMax),
    pad: clamp(24 * D, 3, tune.pad)
  };
}

/** Rozmycie prawie-gaussowskie (3 przejścia pudełkowe w obu osiach, poza siatką zera) — kopuła. */
function blur3(src, w, h, sigma) {
  const out = Float32Array.from(src);
  if (!(sigma > 0.25)) return out;
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) * 0.5));
  const tmp = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  const pass = (a, b, stride, lines, lineStep, len) => {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStep;
      let acc = 0;
      for (let k = 0; k <= r && k < len; k++) acc += a[base + k * stride];
      for (let k = 0; k < len; k++) {
        b[base + k * stride] = acc * norm;
        const add = k + r + 1, sub = k - r;
        if (add < len) acc += a[base + add * stride];
        if (sub >= 0) acc -= a[base + sub * stride];
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    pass(out, tmp, 1, h, w, w);
    pass(tmp, out, w, w, 1, h);
  }
  return out;
}

/**
 * Odległość ze znakiem w metryce OŚMIOKĄTNEJ (transformata fazowana, wagi 1 i √2 na siatce pola): izolinie
 * równoległe do krawędzi, a w narożnikach wklęsłych — FAZA 45° zamiast łuku (linie przy krawędzi płyt, grube płyty
 * i rury maszynowni wyglądają jak w sprite'ach Terra Novy). Ziarno: dokładna odległość euklidesowa w pasie ±1,5
 * teksela przy krawędzi. Wynik w j., znak jak `f`, obcięty do ±band.
 */
export function octagonalField(f, w, h, res, band) {
  const n = w * h;
  const d = new Float32Array(n);
  const hs = 1 / res, hd = Math.SQRT2 / res, seed = 1.5 / res;
  for (let i = 0; i < n; i++) { const a = Math.abs(f[i]); d[i] = a <= seed ? a : 1e9; }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (i > 0 && d[k - 1] + hs < v) v = d[k - 1] + hs;
      if (j > 0) {
        if (d[k - w] + hs < v) v = d[k - w] + hs;
        if (i > 0 && d[k - w - 1] + hd < v) v = d[k - w - 1] + hd;
        if (i < w - 1 && d[k - w + 1] + hd < v) v = d[k - w + 1] + hd;
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (i < w - 1 && d[k + 1] + hs < v) v = d[k + 1] + hs;
      if (j < h - 1) {
        if (d[k + w] + hs < v) v = d[k + w] + hs;
        if (i < w - 1 && d[k + w + 1] + hd < v) v = d[k + w + 1] + hd;
        if (i > 0 && d[k + w - 1] + hd < v) v = d[k + w - 1] + hd;
      }
      d[k] = v;
    }
  }
  for (let i = 0; i < n; i++) {
    const v = d[i] > band ? band : d[i];
    d[i] = f[i] < 0 ? -v : v;
  }
  return d;
}

/**
 * Pola poziomów projektu. `opts.fieldRes` — teksele na j. (domyślnie ze skali detalu; kompozytor próbkuje
 * dwuliniowo), `opts.pipes === false` — bez sieci rur. Zwraca { expanded, style, scale, grid, levels: [Float32Array
 * × 4], oct: [null, × 3] (metryka ośmiokątna poziomów 1–3), loops: [łamane poziomów], bounds (kadłub bez marginesu),
 * image (pudło obrazu z marginesem), band, dome (rozmyta sylwetka 0..1 na siatce pola), domeSigma [j.], groove,
 * pipeNet (sieć rur albo null), pipeTex (jej raster na siatce pola), area (powierzchnia kadłuba [j.²] z pokrycia pola) }.
 */
export function buildHullField(input, opts = {}) {
  const expanded = expandHullDesign(input);
  const { design, blocks, shapes } = expanded;
  // Styk brył (łuk / faza) w j. przy detail 0,6 — skalowany z detalem (fregata nie dostaje łuku większego od siebie).
  const base = { ...HD_SHAPE_TUNE, ...(opts.tune || {}) };
  const k = design.detail / 0.6;
  const tune = { ...base, blendRounded: base.blendRounded * k, blendChamfer: base.blendChamfer * k };
  const style = design.style;
  const scale = hullFieldScale(design, tune);
  if (Number(opts.fieldRes) > 0) scale.res = Number(opts.fieldRes);
  const { band, res } = scale;
  const D = design.detail;
  const loops = [];
  for (let L = 0; L < HD_LEVELS; L++) {
    const raw = traceBlockContours(blocksAtLevel(blocks, L));
    loops.push(raw.map((l) => styleLoop(l, style, tune)));
  }
  for (const s of shapes) if (s.kind === 'poly') s._loops = polyShapeLoops(s);
  const box = designBox(loops[0], shapes);
  const margin = scale.pad + band * 0.25 + 2;
  const gx0 = Math.floor(box[0] - margin), gy0 = Math.floor(box[1] - margin);
  const w = Math.max(4, Math.ceil((box[2] + margin - gx0) * res));
  const h = Math.max(4, Math.ceil((box[3] + margin - gy0) * res));
  const grid = { x0: gx0, y0: gy0, w, h, res };
  const inv = 1 / res;
  // Pola brył — raz na bryłę (okno pudła ± pasmo), wspólne dla poziomów.
  const polyCache = new Map();
  const shapeWindow = (s) => {
    const b = shapeBox(s);
    return [
      Math.max(0, Math.floor((b[0] - band - gx0) * res)), Math.min(w - 1, Math.ceil((b[2] + band - gx0) * res)),
      Math.max(0, Math.floor((b[1] - band - gy0) * res)), Math.min(h - 1, Math.ceil((b[3] + band - gy0) * res))
    ];
  };
  const levels = [];
  for (let L = 0; L < HD_LEVELS; L++) {
    const f = loops[L].length ? polygonField(loops[L], grid, band) : new Float32Array(w * h).fill(band);
    for (const s of shapes) {
      const applies = s.op === 'add' ? s.level >= L : s.level <= L;
      if (!applies) continue;
      // przycięta do poziomu C: na poziomach ≤ C nic nie dokłada (leży w nich), wyżej — część wspólna z poziomem C
      // (z odsunięciem clipIn [j.] w głąb — płyty klocków: brzeg ramy przy burcie)
      const clipF = s.clip !== undefined ? (L <= s.clip ? null : levels[s.clip]) : undefined;
      if (clipF === null) continue;
      const clipIn = s.clipIn || 0;
      const win = shapeWindow(s);
      const [i0, i1, j0, j1] = win;
      if (i1 < i0 || j1 < j0) continue;
      let pf = polyCache.get(s);
      if (!pf) {
        if (s.kind === 'poly') pf = polygonField(s._loops, grid, band, win);
        else {
          pf = new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1));
          let k = 0;
          for (let j = j0; j <= j1; j++) {
            const py = gy0 + (j + 0.5) * inv;
            for (let i = i0; i <= i1; i++) pf[k++] = clamp(shapeDistance(s, gx0 + (i + 0.5) * inv, py), -band, band);
          }
        }
        polyCache.set(s, pf);
      }
      // wielokąty i bryły modułów to dokładna geometria (wspólne krawędzie ramy i pancerza) — bez fazy / łuku na styku
      // (styk z fazą wybrzusza wspólną krawędź o pół promienia); faza i łuk zostają dla bloków, kół i prostokątów
      const sStyle = s.kind === 'poly' || s.module ? 'sharp' : style;
      const ww = i1 - i0 + 1;
      for (let j = j0; j <= j1; j++) {
        const row = j * w;
        const prow = (j - j0) * ww - i0;
        for (let i = i0; i <= i1; i++) {
          let ds = pf[prow + i];
          if (clipF && clipF[row + i] + clipIn > ds) ds = clipF[row + i] + clipIn;
          const a = f[row + i];
          const v = s.op === 'add' ? fieldUnion(a, ds, sStyle, tune) : fieldSubtract(a, ds, sStyle, tune);
          f[row + i] = v < -band ? -band : (v > band ? band : v);
        }
      }
    }
    if (L > 0) {
      const lower = levels[L - 1];
      const ins = (tune.insetDu[L] || 0) * D;
      for (let i = 0; i < f.length; i++) {
        const v = lower[i] + ins;
        if (v > f[i]) f[i] = v > band ? band : v;
      }
    }
    levels.push(f);
  }
  // pudło kadłuba z pola poziomu 0 (bryły i wycięcia już policzone)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const f0 = levels[0];
  const cov = new Float32Array(w * h);
  let covSum = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = f0[j * w + i];
      const c = clamp(0.5 - v * res, 0, 1);
      cov[j * w + i] = c;
      covSum += c;
      if (v > 0.5 * inv) continue;
      const x = gx0 + (i + 0.5) * inv, y = gy0 + (j + 0.5) * inv;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
  }
  if (!(bx1 > bx0)) { bx0 = -30; by0 = -30; bx1 = 30; by1 = 30; }
  bx0 -= inv; by0 -= inv; bx1 += inv; by1 += inv;
  const bounds = { minX: bx0, minY: by0, maxX: bx1, maxY: by1 };
  const image = {
    minX: Math.floor(bx0 - scale.pad), minY: Math.floor(by0 - scale.pad),
    maxX: Math.ceil(bx1 + scale.pad), maxY: Math.ceil(by1 + scale.pad)
  };
  image.w = image.maxX - image.minX;
  image.h = image.maxY - image.minY;
  image.cx = (image.minX + image.maxX) * 0.5;
  image.cy = (image.minY + image.maxY) * 0.5;
  // Kopuła: sylwetka rozmyta jak w HullSurface sprite'ów (σ = domeSigma × krótszy bok kadłuba).
  const domeSigma = tune.domeSigma * Math.max(1, Math.min(bx1 - bx0, by1 - by0));
  const dome = blur3(cov, w, h, domeSigma * res);
  for (const s of shapes) delete s._loops;
  // metryka ośmiokątna poziomów płyt (pancerz, nadbudówka, mostek) — offsety i rury z fazami 45°
  const oct = [null];
  for (let L = 1; L < HD_LEVELS; L++) oct.push(octagonalField(levels[L], w, h, res, band));
  // rowki: odległość od najbliższej łamanej [j.], obcięta do grooveBand
  const grooveBand = Math.max(8 * D, 3 / res);
  const groove = grooveField(expanded.grooves, grid, grooveBand);
  // sieć rur (generowana + ręczne) i jej raster na siatce pola (src/game/hullDesign/hullDesignPipes.js)
  const base0 = { expanded, grid, levels, bounds, band };
  const pipeNet = opts.pipes === false ? null : buildPipeNetwork(base0, opts.pipeTune);
  const pipeTex = pipeNet ? rasterPipeNetwork(pipeNet, grid) : null;
  return { expanded, style, scale, grid, levels, oct, loops, bounds, image, band, dome, domeSigma, groove, grooveBand, pipeNet, pipeTex, area: covSum * inv * inv };
}

/**
 * Odległość od łamanych rowków na siatce pola [j.], obcięta do `cap` (bez rowków — cała siatka = cap), i szerokość
 * najbliższego rowku [jd] (`f.width`, Float32Array).
 */
export function grooveField(grooves, grid, cap) {
  const { x0, y0, w, h, res } = grid;
  const f = new Float32Array(w * h).fill(cap);
  const width = new Float32Array(w * h).fill(1.4);
  f.width = width;
  const inv = 1 / res;
  for (const g of grooves || []) {
    const gw = g.w || 1.4;
    const P = g.pts;
    for (let s = 0; s + 1 < P.length; s++) {
      const a = P[s], b = P[s + 1];
      const ix0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - cap - x0) * res));
      const ix1 = Math.min(w - 1, Math.ceil((Math.max(a[0], b[0]) + cap - x0) * res));
      const iy0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - cap - y0) * res));
      const iy1 = Math.min(h - 1, Math.ceil((Math.max(a[1], b[1]) + cap - y0) * res));
      for (let j = iy0; j <= iy1; j++) {
        const py = y0 + (j + 0.5) * inv;
        const row = j * w;
        for (let i = ix0; i <= ix1; i++) {
          const d = segDist(x0 + (i + 0.5) * inv, py, a[0], a[1], b[0], b[1]);
          if (d < f[row + i]) { f[row + i] = d; width[row + i] = gw; }
        }
      }
    }
  }
  return f;
}

/** Pole poziomu w punkcie (dwuliniowo, poza siatką — pasmo). */
export function sampleHullField(field, level, x, y) {
  const { x0, y0, w, h, res } = field.grid;
  const f = field.levels[level];
  const fx = (x - x0) * res - 0.5, fy = (y - y0) * res - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return field.band;
  const tx = fx - i, ty = fy - j;
  const a = f[j * w + i], b = f[j * w + i + 1], c = f[(j + 1) * w + i], d = f[(j + 1) * w + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Alfa kadłuba w rozdzielczości `pxPerUnit` (kanwa fizyki gry: 1 px = 1 j.) — RGBA (barwa biała), pudło obrazu
 * `field.image`. Krawędź wygładzona na 1 px.
 */
export function rasterHullAlpha(field, pxPerUnit = 1) {
  const im = field.image;
  const W = Math.max(1, Math.round(im.w * pxPerUnit)), H = Math.max(1, Math.round(im.h * pxPerUnit));
  const data = new Uint8ClampedArray(W * H * 4);
  const inv = 1 / pxPerUnit;
  for (let j = 0; j < H; j++) {
    const y = im.minY + (j + 0.5) * inv;
    for (let i = 0; i < W; i++) {
      const d = sampleHullField(field, 0, im.minX + (i + 0.5) * inv, y);
      const a = Math.max(0, Math.min(1, 0.5 - d * pxPerUnit));
      const o = (j * W + i) * 4;
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = Math.round(a * 255);
    }
  }
  return { width: W, height: H, data };
}

/**
 * Komórki siatki belek (bok HD_CELL j., od rogu obrazu jak sampleSpriteLattice) z pokryciem ≥ minCoverage na
 * poziomie `level` — receptura, kawałki kadłuba. Zwraca { nx, ny, cells: Uint8Array, count }.
 */
export function hullCells(field, level = 0, cell = 15, minCoverage = 0.2, samples = 5) {
  const im = field.image;
  const nx = Math.ceil(im.w / cell), ny = Math.ceil(im.h / cell);
  const cells = new Uint8Array(nx * ny);
  let count = 0;
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      let hit = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = im.minX + (cx + (sx + 0.5) / samples) * cell, y = im.minY + (cy + (sy + 0.5) / samples) * cell;
          if (sampleHullField(field, level, x, y) < 0) hit++;
        }
      }
      if (hit >= minCoverage * samples * samples) { cells[cy * nx + cx] = 1; count++; }
    }
  }
  return { nx, ny, cells, count };
}

/** Spójne części siatki komórek (4-sąsiedztwo) — kadłub w kawałkach to ostrzeżenie receptury. */
export function cellComponents(grid) {
  const { nx, ny, cells } = grid;
  const lab = new Int32Array(nx * ny).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || lab[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(i);
    lab[i] = id;
    while (stack.length) {
      const k = stack.pop();
      n++;
      const x = k % nx, y = (k / nx) | 0;
      const nb = [x > 0 ? k - 1 : -1, x < nx - 1 ? k + 1 : -1, y > 0 ? k - nx : -1, y < ny - 1 ? k + nx : -1];
      for (const q of nb) if (q >= 0 && cells[q] && lab[q] < 0) { lab[q] = id; stack.push(q); }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}
