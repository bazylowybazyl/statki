/**
 * OBJAZD BRYŁ DOKÓW + ROUTER RINGU — wspólna trasa „z przestrzeni” dla bańki ruchu (`materializedFlight.js`,
 * `routeAround`) i kapsuł ratunkowych (`src/game/escapePodRoutes.js`).
 *
 * Dysk = `[x, y, keepR, R]` w płaskiej tablicy (R — promień łuku objazdu, `dockDetourRadius`). Trasa A → B objeżdża
 * dyski budowli doków (styczna → łuk → styczna, krótszą stroną — jak `pushDetour` ringu), a KAŻDY wolny odcinek idzie
 * przez router ringu (`routeRing`: płyta tylko tranzytami, przerwy ringu w budowie). Dysk, w którym leży koniec
 * odcinka, nie jest objeżdżany (punkty portu — wejście lejkiem, wyjście za dysk — są poza nim).
 *
 * Czysta matematyka (bez DOM i Three). Pisze do bufora ścieżki z `portPaths.js`.
 */

import { routeRing } from './ringRouter.js';
import { pathPush, PATH_STRIDE } from './portPaths.js';

const TAU = Math.PI * 2;
const S = PATH_STRIDE;

/** Krok łuku objazdu dysku budowli doku — cięciwa nie schodzi pod `keepR`. */
export const DOCK_ARC_STEP = 12 * Math.PI / 180;
/**
 * Łuk objazdu tyle za dyskiem zapasu: w swobodnym locie statek ścina zakręt o do
 * 1500 j. (`pathApplyCornerSpeeds`, otwarta przestrzeń) — ścięty łuk nie wchodzi w dysk.
 */
export const DOCK_ARC_MARGIN = 1600;

/** Promień łuku objazdu dysku zapasu `keepR`. */
export function dockDetourRadius(keepR) {
  return keepR / Math.cos(DOCK_ARC_STEP * 0.5) + DOCK_ARC_MARGIN;
}

/** Dopisuje dysk budowli do płaskiej listy `[x, y, keepR, R, …]`. */
export function pushDockDisc(list, x, y, keepR) {
  list.push(x, y, keepR, dockDetourRadius(keepR));
  return list;
}

function wrap2Pi(a) {
  const v = a % TAU;
  return v < 0 ? v + TAU : v;
}

/**
 * Objazd dysku `i` z P do Q (oba poza dyskiem): punkty na łuku promienia objazdu. Odcinek
 * z P do zejścia na łuk idzie przez router ringu (bez ringu po drodze — ten sam punkt).
 */
function pushDiscDetour(path, rings, discs, i, px, py, qx, qy) {
  const ox = discs[i];
  const oy = discs[i + 1];
  const R = discs[i + 3];
  const dp = Math.hypot(px - ox, py - oy);
  const dq = Math.hypot(qx - ox, qy - oy);
  const fp = Math.atan2(py - oy, px - ox);
  const fq = Math.atan2(qy - oy, qx - ox);
  const ap = Math.acos(Math.min(1, R / Math.max(R, dp)));
  const aq = Math.acos(Math.min(1, R / Math.max(R, dq)));
  const ccw = wrap2Pi((fq - aq) - (fp + ap));
  const cw = wrap2Pi((fp - ap) - (fq + aq));
  const a0 = ccw <= cw ? fp + ap : fp - ap;
  const delta = ccw <= cw ? ccw : -cw;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / DOCK_ARC_STEP));
  routeRing(path, rings, px, py, ox + Math.cos(a0) * R, oy + Math.sin(a0) * R, Infinity, 0);
  for (let k = 1; k <= n; k++) {
    const a = a0 + delta * (k / n);
    pathPush(path, ox + Math.cos(a) * R, oy + Math.sin(a) * R, Infinity, 0);
  }
}

/**
 * Trasa A → B (A jest już ostatnim punktem ścieżki): objazd dysków `discs`, potem router ringu `rings`.
 * B dostaje `vmax` i `flags`.
 */
export function routeAroundDiscs(path, rings, discs, ax, ay, bx, by, vmax, flags) {
  let cx = ax;
  let cy = ay;
  for (let iter = 0; iter < 4 && discs && discs.length; iter++) {
    let best = -1;
    let bestT = Infinity;
    const vx = bx - cx;
    const vy = by - cy;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1) break;
    for (let i = 0; i < discs.length; i += 4) {
      const ox = discs[i];
      const oy = discs[i + 1];
      const r = discs[i + 2];
      const r2 = r * r;
      if ((cx - ox) ** 2 + (cy - oy) ** 2 < r2 || (bx - ox) ** 2 + (by - oy) ** 2 < r2) continue;
      const t = ((ox - cx) * vx + (oy - cy) * vy) / len2;
      if (t <= 0 || t >= 1) continue;
      const px = cx + vx * t - ox;
      const py = cy + vy * t - oy;
      if (px * px + py * py >= r2) continue;
      if (t < bestT) { bestT = t; best = i; }
    }
    if (best < 0) break;
    pushDiscDetour(path, rings, discs, best, cx, cy, bx, by);
    const o = (path.count - 1) * S;
    cx = path.data[o];
    cy = path.data[o + 1];
  }
  routeRing(path, rings, cx, cy, bx, by, vmax, flags);
}
