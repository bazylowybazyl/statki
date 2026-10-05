// src/3d/shield/shieldLattice.js
//
// Siatka płytek-heksów tarczy na CPU (port z dema dema/tarcza-webgpu/heksy.js — buildLattice):
// siatka trójkątna w płaszczyźnie kadłuba (klatka lokalna tarczy: x wzdłuż kadłuba, y = −y gry,
// z w górę), środki płytek na czaszy h·(1 − t²)^0,62 nad obrysem r(θ) z shieldSystem.js, normalne
// czaszy z różnic, 6 sąsiadów przez (kolumna, wiersz). Płytka = komórka Woronoja siatki (heks
// ostrym wierzchołkiem w górę) — z góry płytki kładą się dokładnie na siatkę.
// Czysty moduł (bez three) — budowa przy pierwszym trafieniu tarczy danej klasy, potem z pamięci
// (klucz = kształt obrysu, jak dawna geometria czaszy w shield3D.js).

import { sampleShieldProfileRadius } from '../../../shieldSystem.js';

const SQ3_2 = 0.8660254;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** Wysokość czaszy (jak dawna kopuła gry i demo): clamp(0,85·minR, 8, 140). */
export function shieldDomeHeight(profile) {
  return clamp(profile.minR * 0.85, 8, 140);
}

/** Odstęp środków płytek (średnica wpisana heksa) dla obrysu: clamp(0,026·maxR, 8, 40). */
export function shieldHexCell(profile) {
  return clamp(profile.maxR * 0.026, 8, 40);
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Siatka płytek dla obrysu. Gdy płytek wychodzi więcej niż `maxCount`, odstęp rośnie (duży kadłub
 * dostaje większe heksy zamiast przepełnić slot puli).
 * @returns {{ n: number, cell: number, domeHeight: number, rest: Float32Array, nrm: Float32Array, nbr: Int32Array }}
 *   rest — (x, y, z czaszy, ziarno) × n; nrm — (normalna xyz, t = r / r(θ)) × n; nbr — 6 sąsiadów × n
 *   (indeksy lokalne, −1 = brak — brzeg tarczy). Kolejność sąsiadów jak kierunki 0°, 180°, 120°, 60°,
 *   240°, 300° (SHIELD_NEIGHBOR_DIRS).
 */
export function buildShieldLattice(profile, maxCount, cellScale = 1) {
  const H = shieldDomeHeight(profile);
  const tAt = (x, y) => Math.hypot(x, y) / Math.max(sampleShieldProfileRadius(profile, Math.atan2(-y, x)), 1e-3);
  const zAt = (x, y) => { const t = tAt(x, y); return H * Math.pow(Math.max(0, 1 - t * t), 0.62); };
  let d = shieldHexCell(profile) * cellScale;
  let pts = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    pts = [];
    const rows = Math.ceil(profile.maxR / (d * SQ3_2)) + 2;
    const cols = Math.ceil(profile.maxR / d) + 2;
    for (let j = -rows; j <= rows; j++) {
      for (let i = -cols; i <= cols; i++) {
        const x = (i + ((j & 1) ? 0.5 : 0)) * d, y = j * d * SQ3_2;
        if (tAt(x, y) < 0.975) pts.push(i, j, x, y);
      }
    }
    if (pts.length / 4 <= maxCount) break;
    d *= Math.sqrt(pts.length / 4 / maxCount) * 1.02;
  }
  const n = pts.length / 4;
  const index = new Map();
  for (let k = 0; k < n; k++) index.set(pts[k * 4] * 100003 + pts[k * 4 + 1], k);
  const at = (i, j) => { const k = index.get(i * 100003 + j); return k === undefined ? -1 : k; };
  const rest = new Float32Array(n * 4);
  const nrm = new Float32Array(n * 4);
  const nbr = new Int32Array(n * 6);
  const rnd = mulberry32(0x5eed + n);
  const e = 1.5;
  for (let k = 0; k < n; k++) {
    const i = pts[k * 4], j = pts[k * 4 + 1], x = pts[k * 4 + 2], y = pts[k * 4 + 3];
    const gx = (zAt(x + e, y) - zAt(x - e, y)) / (2 * e);
    const gy = (zAt(x, y + e) - zAt(x, y - e)) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    rest[k * 4] = x; rest[k * 4 + 1] = y; rest[k * 4 + 2] = zAt(x, y); rest[k * 4 + 3] = rnd();
    nrm[k * 4] = -gx / l; nrm[k * 4 + 1] = -gy / l; nrm[k * 4 + 2] = 1 / l; nrm[k * 4 + 3] = tAt(x, y);
    const odd = j & 1;
    // Kolejność = SHIELD_NEIGHBOR_DIRS (w wierszach parzystych i nieparzystych ten sam kierunek).
    const nb = odd
      ? [[i + 1, j], [i - 1, j], [i, j + 1], [i + 1, j + 1], [i, j - 1], [i + 1, j - 1]]
      : [[i + 1, j], [i - 1, j], [i - 1, j + 1], [i, j + 1], [i - 1, j - 1], [i, j - 1]];
    for (let m = 0; m < 6; m++) nbr[k * 6 + m] = at(nb[m][0], nb[m][1]);
  }
  return { n, cell: d, domeHeight: H, rest, nrm, nbr, index };
}

/**
 * Najbliższa płytka punktu (x, y) klatki lokalnej tarczy albo −1 (poza siatką). Bez alokacji —
 * wiersz i kolumna z siatki trójkątnej, sprawdzenie 3 × 3 sąsiednich węzłów.
 */
export function nearestShieldTile(lat, x, y) {
  const d = lat.cell, rowH = d * SQ3_2;
  const j0 = Math.round(y / rowH);
  let best = -1, bestD = Infinity;
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const off = (j & 1) ? 0.5 : 0;
    const i0 = Math.round(x / d - off);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const k = lat.index.get(i * 100003 + j);
      if (k === undefined) continue;
      const dx = lat.rest[k * 4] - x, dy = lat.rest[k * 4 + 1] - y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = k; }
    }
  }
  return best;
}

/** Kierunki do 6 sąsiadów (jednostkowe, kolejność jak `nbr`): 0°, 180°, 120°, 60°, 240°, 300°. */
export const SHIELD_NEIGHBOR_DIRS = [
  [1, 0], [-1, 0], [-0.5, SQ3_2], [0.5, SQ3_2], [-0.5, -SQ3_2], [0.5, -SQ3_2]
];

// ── Pamięć siatek: klucz = kształt obrysu (biny), statki jednej klasy dzielą siatkę ────────────
const _cache = new Map();
const CACHE_MAX = 64;

export function shieldProfileKey(profile) {
  const bins = profile.bins;
  let hash = 0;
  for (let i = 0; i < bins.length; i++) hash = ((hash * 31) + ((bins[i] * 4 + 0.5) | 0)) | 0;
  return bins.length + '|' + hash;
}

/** Siatka z pamięci (budowa przy pierwszym użyciu kształtu). */
export function acquireShieldLattice(profile, maxCount) {
  const key = shieldProfileKey(profile) + '|' + maxCount;
  let lat = _cache.get(key);
  if (lat) {
    _cache.delete(key);
    _cache.set(key, lat);            // LRU: świeżo użyte na koniec
    return lat;
  }
  lat = buildShieldLattice(profile, maxCount);
  _cache.set(key, lat);
  if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
  return lat;
}

// ── Obrys koła (stacje, platformy, myśliwce bez kadłuba na belkach) ─────────────────────────
const _circles = new Map();

/** Profil koła o promieniu r (ten sam format co getEntityShieldProfile). */
export function circleShieldProfile(radius, binCount = 96) {
  const r = Math.max(4, Math.round(radius));
  let p = _circles.get(r);
  if (!p) {
    p = { bins: new Float32Array(binCount).fill(r), binCount, maxR: r, minR: r, pad: 0 };
    _circles.set(r, p);
    if (_circles.size > 64) _circles.delete(_circles.keys().next().value);
  }
  return p;
}
