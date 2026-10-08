// Indeks wraków dla AI (2026-10-08): wraki jako PRZESZKODY lotu okrętów NPC.
//
// Dlaczego: siatka AI (aiSpatialGrid.js) powstaje z listy npcs, a wraki żyją w osobnej
// liście `wrecks` — ogranicznik prędkości przed przeszkodą i objazd po stycznej
// (capitalAI.js: capitalObstacleSpeedCap, computeObstacleDetour) wraków nie widziały.
// Zmierzone w grze (scripts/webgpu/wraki-omijanie-gra.mjs): skrzydło 25 okrętów lecące
// przez 16 wraków — 27 zetknięć, 73 s styku, 14,6 tys. punktów kadłuba, wraki pchane
// przed dziobem do 19 km.
//
// Wraki NIE trafiają do siatki AI: jej czytają też wybór celów, separacja i unik — wrak
// byłby tam celem, sąsiadem w szyku itd. Osobny indeks: duże wraki (promień ≥
// WRECK_OBSTACLE_MIN_RADIUS — drobne odłamy okręt może odepchnąć) jako tablice typowane
// POSORTOWANE PO x, przebudowa raz na takt AI (20 Hz; wraki dryfują wolno). Zapytanie:
// wyszukiwanie binarne pasa [x − zasięg, x + zasięg] i odrzut po y — przy horyzoncie
// przeszkody 1,5–5 km okręt ogląda kilka wraków, nie wszystkie.

export const WRECK_OBSTACLE_MIN_RADIUS = 80;
// Wrak jako KAPSUŁA wzdłuż osi kadłuba (angle): promień kadłuba to pół-długości, pół-szerokość
// ≈ tyle × promień (kadłuby ~3:1). Koło o promieniu pół-długości przepuszczało okręt obok środka
// długiego wraku leżącego w poprzek kursu albo, szersze, zasłaniało pół pola wraków.
export const WRECK_HALF_WIDTH_K = 0.33;
const WRECK_HALF_WIDTH_MIN = 50;

const index = {
  count: 0,
  rMax: 0,
  x: new Float64Array(64),
  y: new Float64Array(64),
  r: new Float64Array(64),
  // oś kapsuły (jednostkowa), pół-długość odcinka osi, pół-szerokość
  ux: new Float64Array(64),
  uy: new Float64Array(64),
  h: new Float64Array(64),
  w: new Float64Array(64),
  refs: []
};
// Robocze: kandydaci (byty i ich x) i kolejność po x — bez alokacji w stanie ustalonym.
const _cand = [];
const _candX = [];
const _order = [];

function grow(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Float64Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}

function byX(a, b) { return _candX[a] - _candX[b]; }

// Wrak jest przeszkodą: żywy, zderza się (duch odłamu budowli nie), dość duży.
function isObstacleWreck(w) {
  if (!w || w.dead || w.removed || w.isCollidable === false) return false;
  const r = Number(w.radius) || 0;
  return r >= WRECK_OBSTACLE_MIN_RADIUS && Number.isFinite(w.x) && Number.isFinite(w.y);
}

export function rebuildWreckIndex(wrecks) {
  _cand.length = 0;
  _order.length = 0;
  const n0 = Array.isArray(wrecks) ? wrecks.length : 0;
  for (let i = 0; i < n0; i++) {
    const w = wrecks[i];
    if (!isObstacleWreck(w)) continue;
    _candX[_cand.length] = w.x;
    _order.push(_cand.length);
    _cand.push(w);
  }
  const n = _cand.length;
  index.count = n;
  index.rMax = 0;
  index.refs.length = n;
  if (n > 0) {
    _order.sort(byX);
    index.x = grow(index.x, n);
    index.y = grow(index.y, n);
    index.r = grow(index.r, n);
    index.ux = grow(index.ux, n);
    index.uy = grow(index.uy, n);
    index.h = grow(index.h, n);
    index.w = grow(index.w, n);
    for (let s = 0; s < n; s++) {
      const w = _cand[_order[s]];
      const r = Number(w.radius) || 0;
      const a = Number(w.angle) || 0;
      const hw = Math.max(WRECK_HALF_WIDTH_MIN, r * WRECK_HALF_WIDTH_K);
      index.x[s] = w.x;
      index.y[s] = w.y;
      index.r[s] = r;
      index.ux[s] = Math.cos(a);
      index.uy[s] = Math.sin(a);
      index.h[s] = Math.max(0, r - hw);
      index.w[s] = hw;
      index.refs[s] = w;
      if (r > index.rMax) index.rMax = r;
    }
  }
  _cand.length = 0;
  return index;
}

// Pierwszy wrak o x ≥ xmin (wyszukiwanie binarne w posortowanych x).
export function wreckLowerBound(xmin) {
  const X = index.x;
  let lo = 0;
  let hi = index.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (X[mid] < xmin) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function getWreckIndex() {
  return index;
}

export function resetWreckIndex() {
  index.count = 0;
  index.rMax = 0;
  index.refs.length = 0;
}

if (typeof window !== 'undefined') {
  window.rebuildWreckIndex = rebuildWreckIndex;
  window.getWreckIndex = getWreckIndex;
}
