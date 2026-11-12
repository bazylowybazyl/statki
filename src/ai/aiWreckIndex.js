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
//
// BUDOWLE (2026-10-28, zgłoszenie użytkownika: „supercapital wbija się w habitat zamiast okrążyć budowlę”): stojące
// budowle w płaszczyźnie gry (baza piratów misji 1 — pirateBaseObstacles) wchodzą do tego samego indeksu jako
// przeszkody STATYCZNE — kapsuły z jawną geometrią (`statics` w rebuildWreckIndex; wielokąt bryły → capsuleFromPolygon),
// więc ogranicznik, objazd z drugą stroną i rozkazy RTS omijają je tą samą drogą co wraki.

export const WRECK_OBSTACLE_MIN_RADIUS = 80;
// Bryła 3D (wrak `solid3D` — odłam budowli, gruz upadku habitatu) jest przeszkodą tylko, gdy jej sfera (z ± promień
// encji — obejmuje każdy węzeł z komórką) sięga pasa ± tyle j. przy płaszczyźnie gry: słup okrętu
// (HULL_BODY_CONFIG.shipColumn, 70) + zapas na promień encji, który odświeża się dopiero przy zmianie liczby węzłów.
// Dalej okręt jej nie dotknie, a indeks widziałby sam rzut — gruz upadku habitatu leżący na planetoidzie 24–27 km pod
// bazą piratów zatrzymywał w płaszczyźnie okręty lecące nad bazą (2026-10-21).
export const WRECK_OBSTACLE_BAND = 120;
// Wrak jako KAPSUŁA wzdłuż osi kadłuba (angle): promień kadłuba to pół-długości, pół-szerokość
// ≈ tyle × promień (kadłuby ~3:1). Koło o promieniu pół-długości przepuszczało okręt obok środka
// długiego wraku leżącego w poprzek kursu albo, szersze, zasłaniało pół pola wraków.
export const WRECK_HALF_WIDTH_K = 0.33;
const WRECK_HALF_WIDTH_MIN = 50;
// Przeszkoda STATYCZNA (budowla — `statics` w rebuildWreckIndex): { x, y, ux, uy, h, w } — środek, oś jednostkowa,
// pół-długość odcinka osi, pół-szerokość — i `obstacleOwner`: byt budowli (stacja); rozkaz RTS wycelowany w nią
// (taran, orbita, podejście — `ignore` pilota rozkazów) jej kapsuł nie omija.

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
  refs: [],
  // byt budowli przeszkody statycznej (null — wrak)
  owner: [],
  // same przeszkody statyczne (trasy wokół budowli — staticRoutes.js) i wersja ich zestawu (rośnie przy zmianie)
  statics: [],
  staticsVer: 0
};
// Robocze: kandydaci (byty i ich x), rodzaj (1 — przeszkoda statyczna) i kolejność po x — bez alokacji w stanie
// ustalonym.
const _cand = [];
const _candX = [];
const _candStatic = [];
const _order = [];

function grow(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Float64Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}

function byX(a, b) { return _candX[a] - _candX[b]; }

// Wrak jest przeszkodą: żywy, zderza się (duch odłamu budowli nie), dość duży, a bryła 3D — przy płaszczyźnie gry
// (WRECK_OBSTACLE_BAND). Zimny wrak (src/game/coldWrecks.js) nie ma kolizji (duch dla okrętów i pocisków), ale stoi
// w kadrze jak inne — okręty go omijają.
function isObstacleWreck(w) {
  if (!w || w.dead || w.removed || (w.isCollidable === false && w.isCold !== true)) return false;
  const r = Number(w.radius) || 0;
  if (r < WRECK_OBSTACLE_MIN_RADIUS || !Number.isFinite(w.x) || !Number.isFinite(w.y)) return false;
  return w.solid3D !== true || Math.abs(Number(w.z) || 0) - r <= WRECK_OBSTACLE_BAND;
}

function addCandidates(list) {
  const n0 = Array.isArray(list) ? list.length : 0;
  for (let i = 0; i < n0; i++) {
    const w = list[i];
    if (!isObstacleWreck(w)) continue;
    _candX[_cand.length] = w.x;
    _candStatic[_cand.length] = 0;
    _order.push(_cand.length);
    _cand.push(w);
  }
}

function addStatics(list) {
  const S = index.statics;
  const n0 = Array.isArray(list) ? list.length : 0;
  let k = 0;
  let changed = false;
  for (let i = 0; i < n0; i++) {
    const o = list[i];
    if (!o || !(o.w > 0) || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.ux) || !Number.isFinite(o.uy)) continue;
    _candX[_cand.length] = o.x;
    _candStatic[_cand.length] = 1;
    _order.push(_cand.length);
    _cand.push(o);
    if (S[k] !== o) { S[k] = o; changed = true; }
    k++;
  }
  if (S.length !== k) { S.length = k; changed = true; }
  if (changed) index.staticsVer++;
}

/**
 * Kapsuła { x, y, ux, uy, h, w } zawierająca wielokąt `pts` ([{ x, y }]) — z osi boków i osi głównej wierzchołków ta
 * o najmniejszym polu: prostokąt — oś wzdłuż dłuższego boku, pół-szerokość = pół krótszego, pół-długość = pół
 * dłuższego (końce kapsuły wystają poza krótsze boki o pół-szerokość; rogi leżą na łukach); wielokąt foremny — prawie
 * koło (h ≈ 0, w = promień). Zapis do `out`.
 */
export function capsuleFromPolygon(pts, out = {}) {
  const n = Array.isArray(pts) ? pts.length : 0;
  out.x = 0; out.y = 0; out.ux = 1; out.uy = 0; out.h = 0; out.w = 0;
  if (n === 0) return out;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  let best = Infinity;
  const tryAxis = (ax, ay) => {
    let s0 = Infinity; let s1 = -Infinity; let t0 = Infinity; let t1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const s = pts[i].x * ax + pts[i].y * ay;
      const t = pts[i].y * ax - pts[i].x * ay;
      if (s < s0) s0 = s; if (s > s1) s1 = s;
      if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const cs = (s0 + s1) / 2;
    const ct = (t0 + t1) / 2;
    const w = (t1 - t0) / 2;
    // pół-długość: wierzchołek za końcem odcinka osi leży najdalej `w` od tego końca
    let h = 0;
    for (let i = 0; i < n; i++) {
      const s = pts[i].x * ax + pts[i].y * ay - cs;
      const t = pts[i].y * ax - pts[i].x * ay - ct;
      const need = Math.abs(s) - Math.sqrt(Math.max(0, w * w - t * t));
      if (need > h) h = need;
    }
    const area = 4 * h * w + Math.PI * w * w;
    if (area < best) {
      best = area;
      out.x = ax * cs - ay * ct;
      out.y = ay * cs + ax * ct;
      out.ux = ax;
      out.uy = ay;
      out.h = h;
      out.w = w;
    }
  };
  const pa = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  tryAxis(Math.cos(pa), Math.sin(pa));
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ex = pts[i].x - pts[j].x;
    const ey = pts[i].y - pts[j].y;
    const L = Math.sqrt(ex * ex + ey * ey);
    if (L > 1e-6) tryAxis(ex / L, ey / L);
  }
  return out;
}

/**
 * `coldWrecks` — zimne wraki (tło); przeszkody lotu jak wraki z `wrecks`. `statics` — budowle (przeszkody statyczne
 * z jawną kapsułą, opis przy WRECK_HALF_WIDTH_MIN).
 */
export function rebuildWreckIndex(wrecks, coldWrecks = null, statics = null) {
  _cand.length = 0;
  _order.length = 0;
  addCandidates(wrecks);
  addCandidates(coldWrecks);
  addStatics(statics);
  const n = _cand.length;
  index.count = n;
  index.rMax = 0;
  index.refs.length = n;
  index.owner.length = n;
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
      const c = _order[s];
      const w = _cand[c];
      if (_candStatic[c] === 1) {
        const h = w.h > 0 ? w.h : 0;
        index.x[s] = w.x;
        index.y[s] = w.y;
        index.r[s] = h + w.w;
        index.ux[s] = w.ux;
        index.uy[s] = w.uy;
        index.h[s] = h;
        index.w[s] = w.w;
        index.refs[s] = w;
        index.owner[s] = w.obstacleOwner || null;
        if (h + w.w > index.rMax) index.rMax = h + w.w;
        continue;
      }
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
      index.owner[s] = null;
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
  index.owner.length = 0;
  if (index.statics.length) {
    index.statics.length = 0;
    index.staticsVer++;
  }
}

if (typeof window !== 'undefined') {
  window.rebuildWreckIndex = rebuildWreckIndex;
  window.getWreckIndex = getWreckIndex;
}
