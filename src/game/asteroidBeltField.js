// src/game/asteroidBeltField.js
//
// Proceduralny, deterministyczny pas asteroid — źródło skał dla gry i tła.
//
// Skały nie są trzymane w pamięci. Zawartość świata jest funkcją (ziarno,
// pasmo, oktawa rozmiaru, komórka): komórkę generuje się, gdy ktoś jej
// potrzebuje (render w kadrze, fizyka przy statku), i wyrzuca z pamięci, gdy
// przestaje być potrzebna. Ten sam argument zawsze daje te same skały.
//
// Gęstość = profil pasa (krawędzie z BELT_DEFINITIONS, miękkie) × pola:
// szum niskiej częstotliwości wyznacza GĘSTE POLA (manewrowanie, zasadzki,
// kopanie) na tle rzadkiego pasa. Dawny pas miał 225 tys. skał na 5,1·10¹² j.²
// Main Belt, czyli 0,09 skały na ekran przy zoomie 1 — poza polami zostaje
// podobnie, w rdzeniu pola jest ich kilka–kilkanaście na ekran.
//
// Pasma (BELT_BAND): PLAY — skały w płaszczyźnie gry (kolizje, łup);
// RUBBLE / MID / DEEP — tło pod płaszczyzną na rosnącej głębokości (paralaksa
// kamery perspektywicznej). Pole jest więc chmurą 3D, a gra jest jej przekrojem.
//
// Rozmiary w oktawach (średnica ×2 na oktawę): każda oktawa ma własny rozmiar
// komórki (duże skały — duże komórki), więc przy oddaleniu pomija się całe
// oktawy drobnicy, zamiast generować i odrzucać subpikselowe skały.
//
// Moduł bez three i bez DOM-u — testy w node (tests/asteroidBeltField.test.mjs).

import { BELT_DEFINITIONS, ASTEROID_TYPES } from '../data/asteroidTypes.js';
import { NEUTRAL_TYPE, ENERGY_TYPE, SHAPE_COUNT, pickShape, oreShareAtDepth, oreTierFactor } from './asteroidRockKinds.js';
import { STORM_CONFIG, stormIntensity, stormHash01 } from './asteroidStorms.js';

export const BELT_BAND = Object.freeze({ PLAY: 0, RUBBLE: 1, MID: 2, DEEP: 3 });

/**
 * Pasma. Gęstość pasma dla skał o średnicy ≥ D:
 *   densityAt(x, y) · densityMul · (D / REF_DIAMETER)^(−beta)
 * gdzie densityAt to gęstość skał PLAY o średnicy ≥ REF_DIAMETER.
 * z — głębokość POD płaszczyzną gry (dodatnia = dalej od kamery).
 */
// Tło: blisko płaszczyzny tylko drobnica (paralaksa ruchu), duże bryły dopiero
// głęboko — kamera persp. przy zoomie 1 wisi 1713 j. nad płaszczyzną, więc
// skała 2 tys. j. na głębokości 2600 zajmowała pół ekranu i udawała skałę gry.
export const REF_DIAMETER = 80;
export const BELT_BANDS = Object.freeze([
  Object.freeze({ id: 'play', dMin: 80, dMax: 2600, beta: 1.45, zNear: 0, zFar: 0, densityMul: 1.0 }),
  Object.freeze({ id: 'rubble', dMin: 20, dMax: 170, beta: 1.7, zNear: 450, zFar: 2600, densityMul: 0.9 }),
  Object.freeze({ id: 'mid', dMin: 50, dMax: 760, beta: 1.5, zNear: 3000, zFar: 9500, densityMul: 1.3 }),
  Object.freeze({ id: 'deep', dMin: 300, dMax: 4200, beta: 1.2, zNear: 10000, zFar: 26000, densityMul: 0.6 })
]);

export const BELT_FIELD_CONFIG = Object.freeze({
  // Gęstość skał PLAY (D ≥ 80) na j.² poza polami i w rdzeniu pola.
  baseDensity: 6e-8,
  fieldDensity: 4.5e-6,
  // Pola: szum 2D o okresie ~clusterScale, próg z miękkim brzegiem
  // (0,65 → pola zajmują ~15% pasa, reszta rzadka jak dawniej).
  clusterScale: 240000,
  clusterThreshold: 0.65,
  clusterSoftness: 0.09,
  // Rdzeń pola gęstnieje szybciej niż brzeg (wykładnik na wartości pola).
  clusterPower: 1.6,
  // Obrzeże z wypełniacza: pas skał (głównie neutralnych) PRZED właściwym
  // polem — szerokość w jednostkach szumu pól i gęstość względem rdzenia.
  // Gracz najpierw przebija się przez jałową skałę, rudy leżą głębiej.
  rimWidth: 0.1,
  rimDensity: 0.3,
  // Miękka krawędź pasa (w AU mapy) — skały rzedną, zamiast urwać się na linii.
  edgeAu: 1.2,
  // Prowincje rud: szum przesuwający skład w stronę jednego typu.
  provinceScale: 150000,
  provinceStrength: 0.9,
  // Cel: tyle skał na komórkę w rdzeniu pola (dobór rozmiaru komórki oktawy).
  cellTargetCount: 12,
  cellMin: 1024,
  cellMax: 65536,
  // Pozwolone zachodzenie skał PLAY na siebie (ułamek sumy promieni).
  playOverlap: 0.82,
  // Liczba kształtów w banku (rockShapes3D): rodziny × warianty
  // (asteroidRockKinds.js) — kształt zależy od typu i rozmiaru skały.
  shapeCount: SHAPE_COUNT
});

export const TYPE_INDEX = Object.freeze(Object.fromEntries(ASTEROID_TYPES.map((t, i) => [t, i])));

// ---------------------------------------------------------------------------
// Losowość i szum (deterministyczne, bez stanu globalnego)

export function hash32(a, b = 0, c = 0, d = 0, e = 0) {
  let h = (a | 0) ^ 0x9E3779B9;
  h = Math.imul(h ^ (b | 0), 0x85EBCA6B); h ^= h >>> 13;
  h = Math.imul(h ^ (c | 0), 0xC2B2AE35); h ^= h >>> 16;
  h = Math.imul(h ^ (d | 0), 0x27D4EB2F); h ^= h >>> 15;
  h = Math.imul(h ^ (e | 0), 0x165667B1); h ^= h >>> 13;
  h = Math.imul(h, 0x5BD1E995); h ^= h >>> 15;
  return h >>> 0;
}

/** Mulberry32 — [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice2(ix, iy, seed) {
  return hash32(ix, iy, seed, 0x51ED27, 0) / 4294967296;
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Szum wartości 2D [0, 1]. */
export function valueNoise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = lattice2(ix, iy, seed);
  const b = lattice2(ix + 1, iy, seed);
  const c = lattice2(ix, iy + 1, seed);
  const d = lattice2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** fbm 2D [0, 1] z obrotem między oktawami (bez siatkowych smug). */
export function fbm2(x, y, seed, octaves = 4) {
  let sum = 0;
  let norm = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(px, py, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    const nx = px * 1.6 - py * 1.2;
    const ny = px * 1.2 + py * 1.6;
    px = nx + 17.3;
    py = ny - 9.1;
  }
  return sum / norm;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function wrapAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------------------------------------------------------------------------
// Geometria pasów

function resolvePlanetXY(planet, sunX, sunY, au) {
  if (!planet) return null;
  if (Number.isFinite(planet.x) && Number.isFinite(planet.y)) return { x: planet.x, y: planet.y };
  const r = Number(planet.orbitRadius) || (Number(planet.orbitAU) || 0) * au;
  const ang = Number(planet.angle) || 0;
  return { x: sunX + Math.cos(ang) * r, y: sunY + Math.sin(ang) * r };
}

/**
 * BELT_DEFINITIONS → regiony w świecie gry. Ring: pierścień wokół słońca.
 * Arc (Grecy, Trojańczycy, 3 skupiska Hildas): wycinek pierścienia.
 * Pozycje planet-kotwic zamrażane w chwili wywołania, jak robiło to dawne pole.
 */
export function buildBeltRegions(beltDefs = BELT_DEFINITIONS, { planets = [], sunX = 0, sunY = 0, auToWorld = 42253.52 } = {}) {
  const au = auToWorld;
  const regions = [];
  const find = (id) => planets.find((p) => p && (p.id === id || p.name === id)) || null;
  for (const belt of beltDefs || []) {
    const types = belt.types || {};
    const composition = ASTEROID_TYPES.map((t) => Math.max(0, Number(types[t]) || 0));
    const common = { beltId: belt.id, composition, ice: belt.id === 'kuiper' ? 1 : 0 };
    if (belt.shape === 'ring') {
      regions.push({ ...common, kind: 'ring', cx: sunX, cy: sunY, rInner: belt.innerAU * au, rOuter: belt.outerAU * au });
      continue;
    }
    if (belt.shape === 'lagrange') {
      const p = resolvePlanetXY(find(belt.anchorPlanet), sunX, sunY, au);
      if (!p) continue;
      const rMid = Math.hypot(p.x - sunX, p.y - sunY);
      if (rMid < 1) continue;
      const offset = belt.lagrange === 'L4' ? Math.PI / 3 : -Math.PI / 3;
      regions.push({
        ...common, kind: 'arc', cx: sunX, cy: sunY, rMid,
        rHalf: (belt.spreadAU || 4) * au * 0.5,
        angMid: Math.atan2(p.y - sunY, p.x - sunX) + offset,
        angHalf: (belt.arcSpread || 0.3) * 0.5 + 0.02
      });
      continue;
    }
    if (belt.shape === 'triangle') {
      const p = resolvePlanetXY(find(belt.anchorPlanet), sunX, sunY, au);
      const base = p ? Math.atan2(p.y - sunY, p.x - sunX) : 0;
      for (let k = 0; k < 3; k++) {
        regions.push({
          ...common, kind: 'arc', cx: sunX, cy: sunY,
          rMid: (belt.radiusAU || 42) * au,
          rHalf: (belt.spreadAU || 3) * au * 0.5,
          angMid: base + k * (Math.PI * 2 / 3),
          angHalf: 0.17
        });
      }
    }
  }
  return regions;
}

/** Głębokość wniknięcia w region [j.]: > 0 wewnątrz, ≤ 0 na zewnątrz. */
export function regionPenetration(region, x, y) {
  const dx = x - region.cx;
  const dy = y - region.cy;
  const r = Math.hypot(dx, dy);
  if (region.kind === 'ring') return Math.min(r - region.rInner, region.rOuter - r);
  const radial = region.rHalf - Math.abs(r - region.rMid);
  const tangential = (region.angHalf - Math.abs(wrapAngle(Math.atan2(dy, dx) - region.angMid))) * region.rMid;
  return Math.min(radial, tangential);
}

// ---------------------------------------------------------------------------
// Pole

const _macro = { weight: 0, cluster: 0, rim: 0, depth: 0, density: 0, ice: 0, region: null };

export class AsteroidBeltField {
  /**
   * @param {object} opts
   * @param {number} [opts.seed]
   * @param {Array} [opts.beltDefs] domyślnie BELT_DEFINITIONS
   * @param {Array} [opts.planets] planety gry (kotwice Lagrange'a i Hildas)
   * @param {number} [opts.sunX] @param {number} [opts.sunY]
   * @param {number} [opts.auToWorld]
   * @param {object} [opts.config] nadpisania BELT_FIELD_CONFIG
   */
  constructor(opts = {}) {
    this.seed = (opts.seed ?? 0xA57E3D) >>> 0;
    this.config = { ...BELT_FIELD_CONFIG, ...(opts.config || {}) };
    this.auToWorld = Number(opts.auToWorld) > 0 ? Number(opts.auToWorld) : 42253.52;
    this.sunX = Number.isFinite(opts.sunX) ? opts.sunX : 0;
    this.sunY = Number.isFinite(opts.sunY) ? opts.sunY : 0;
    this.regions = buildBeltRegions(opts.beltDefs || BELT_DEFINITIONS, {
      planets: opts.planets || [], sunX: this.sunX, sunY: this.sunY, auToWorld: this.auToWorld
    });
    this.edgeWorld = this.config.edgeAu * this.auToWorld;
    // Mnożnik gęstości ustawiany na żywo (demo, strojenie) — nie zmienia
    // rozmieszczenia istniejących skał w komórkach poza przerzedzeniem.
    this.densityScale = 1;
    // Obszary bez skał gry (olbrzymy: asteroidGiants.js) — elipsy w świecie.
    this.exclusions = [];
    this.bands = BELT_BANDS.map((band, index) => this._buildBandPlan(band, index));
    this._cache = new Map();
    this._frame = 0;
    this.stats = { cellsGenerated: 0, rocksGenerated: 0, cacheHits: 0 };
  }

  /** Makro-próbka w punkcie (bez alokacji; wynik ważny do następnego wywołania). */
  sampleMacro(x, y, out = _macro) {
    let best = -Infinity;
    let region = null;
    for (let i = 0; i < this.regions.length; i++) {
      const pen = regionPenetration(this.regions[i], x, y);
      if (pen > best) { best = pen; region = this.regions[i]; }
    }
    const weight = region ? smoothstep(-this.edgeWorld * 0.35, this.edgeWorld, best) : 0;
    const c = this.config;
    let cluster = 0;
    let rim = 0;
    if (weight > 0) {
      const n = fbm2(x / c.clusterScale, y / c.clusterScale, this.seed ^ 0xC1A57E, 4);
      const edge0 = c.clusterThreshold - c.clusterSoftness;
      cluster = Math.pow(smoothstep(edge0, c.clusterThreshold + c.clusterSoftness, n), c.clusterPower);
      // Obrzeże z wypełniacza zaczyna się rimWidth przed polem i przechodzi
      // w pole (w rdzeniu gęstość to już tylko pole).
      rim = smoothstep(edge0 - c.rimWidth, edge0 + c.clusterSoftness * 0.4, n) * (1 - cluster);
    }
    out.weight = weight;
    out.cluster = cluster;
    out.rim = rim;
    // Głębokość w polu dla składu (0 = rzadki pas i obrzeże, 1 = rdzeń).
    out.depth = cluster;
    out.density = weight * (c.baseDensity + (c.fieldDensity - c.baseDensity) * cluster + c.fieldDensity * c.rimDensity * rim) * this.densityScale;
    out.ice = region ? region.ice : 0;
    out.region = region;
    return out;
  }

  /** Intensywność burzy energetycznej (0..1) w punkcie — asteroidStorms.js. */
  stormAt(x, y) {
    const cluster = this.sampleMacro(x, y).cluster;
    return stormIntensity(this.seed, x, y, cluster);
  }

  /** Gęstość skał PLAY o średnicy ≥ REF_DIAMETER na j.². */
  densityAt(x, y) {
    return this.sampleMacro(x, y).density;
  }

  /** Najwyższa możliwa gęstość PLAY (rdzeń pola, w środku pasa). */
  get maxDensity() {
    return this.config.fieldDensity * this.densityScale;
  }

  _buildBandPlan(band, index) {
    const octaves = [];
    const c = this.config;
    const refCore = c.fieldDensity;
    for (let k = 0; k < 12; k++) {
      const d0 = band.dMin * Math.pow(2, k);
      if (d0 >= band.dMax) break;
      const d1 = Math.min(band.dMax, d0 * 2);
      // Udział oktawy w gęstości pasma: N(≥d0) − N(≥d1) względem REF_DIAMETER.
      const frac = band.densityMul * (Math.pow(d0 / REF_DIAMETER, -band.beta) - Math.pow(d1 / REF_DIAMETER, -band.beta));
      const coreDensity = refCore * frac;
      let cell = Math.sqrt(c.cellTargetCount / Math.max(1e-18, coreDensity));
      cell = Math.max(cell, d1 * 4);
      cell = Math.min(c.cellMax, Math.max(c.cellMin, cell));
      cell = Math.pow(2, Math.round(Math.log2(cell)));
      octaves.push({ k, d0, d1, frac, cell });
    }
    return { ...band, index, octaves };
  }

  /** Poisson(λ) z danego rng (Knuth dla małych λ, normalne przybliżenie dla dużych). */
  static poisson(lambda, rng) {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= rng(); } while (p > L);
      return k - 1;
    }
    // Box–Muller
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
  }

  _cellKey(bandIndex, k, cx, cy) {
    return `${bandIndex}:${k}:${cx}:${cy}`;
  }

  /**
   * Skały komórki (pasmo, oktawa, cx, cy). Tablica z cache — nie modyfikować.
   */
  cellRocks(bandIndex, k, cx, cy) {
    const key = this._cellKey(bandIndex, k, cx, cy);
    const hit = this._cache.get(key);
    if (hit) {
      hit.frame = this._frame;
      this.stats.cacheHits++;
      return hit.rocks;
    }
    const rocks = this._generateCell(bandIndex, k, cx, cy);
    this._cache.set(key, { rocks, frame: this._frame });
    return rocks;
  }

  _generateCell(bandIndex, k, cx, cy) {
    const band = this.bands[bandIndex];
    const oct = band.octaves[k];
    const cs = oct.cell;
    const x0 = cx * cs;
    const y0 = cy * cs;
    // Ograniczenie gęstości w komórce: max z 5 próbek + zapas (szum pól ma
    // okres ≫ komórki, więc szczyt między próbkami jest płytki).
    let dMax = 0;
    for (let sy = 0; sy <= 2; sy++) {
      for (let sx = 0; sx <= 2; sx++) {
        if ((sx + sy) & 1) continue;
        const d = this.densityAt(x0 + cs * sx * 0.5, y0 + cs * sy * 0.5);
        if (d > dMax) dMax = d;
      }
    }
    const rocks = [];
    this.stats.cellsGenerated++;
    if (dMax <= 0) return rocks;
    const bound = dMax * 1.35;
    const lambda = bound * oct.frac * cs * cs;
    const rng = mulberry32(hash32(this.seed, bandIndex + 1, k + 1, cx, cy));
    const n = AsteroidBeltField.poisson(lambda, rng);
    const c = this.config;
    const isPlay = bandIndex === BELT_BAND.PLAY;
    for (let i = 0; i < n; i++) {
      // Stała liczba losowań na kandydata — atrybuty kandydata nie zależą
      // od tego, czy poprzedni został przyjęty.
      const ux = rng(); const uy = rng(); const uAccept = rng();
      const uSize = rng(); const uType = rng(); const uShape = rng();
      const q0 = rng(); const q1 = rng(); const q2 = rng();
      const a0 = rng(); const a1 = rng(); const uSpin = rng(); const uPhase = rng();
      const s0 = rng(); const s1 = rng(); const s2 = rng();
      const uZ = rng(); const uSeed = rng(); const uVariant = rng();
      const x = x0 + ux * cs;
      const y = y0 + uy * cs;
      // sampleMacro zwraca współdzielony obiekt, a _overlapsLarger generuje
      // (rekurencyjnie) większe komórki — potrzebne wartości kopiujemy od razu.
      const m = this.sampleMacro(x, y);
      if (uAccept * bound > m.density) continue;
      const region = m.region;
      const cluster = m.cluster;
      const depth = m.depth;
      // Średnica w oktawie z rozkładu potęgowego (odwrotna dystrybuanta).
      const b = band.beta;
      const lo = Math.pow(oct.d0, -b);
      const hi = Math.pow(oct.d1, -b);
      const d = Math.pow(lo - uSize * (lo - hi), -1 / b);
      const r = d * 0.5;
      if (isPlay && this.exclusions.length && this._excluded(x, y, r)) continue;
      if (isPlay && this._overlapsLarger(bandIndex, k, x, y, r, rocks)) continue;
      const type = this._pickRockType(region, x, y, uType, depth, d, isPlay);
      // Orientacja: równomierny kwaternion (Shoemake).
      const sq1 = Math.sqrt(1 - q0);
      const sq2 = Math.sqrt(q0);
      const t1 = 2 * Math.PI * q1;
      const t2 = 2 * Math.PI * q2;
      const qx = sq1 * Math.sin(t1);
      const qy = sq1 * Math.cos(t1);
      const qz = sq2 * Math.sin(t2);
      const qw = sq2 * Math.cos(t2);
      // Oś obrotu: w grze tylko wokół Z (fizyka płaska), w tle dowolna.
      let ax = 0; let ay = 0; let az = 1;
      if (!isPlay) {
        const zc = a0 * 2 - 1;
        const phi = a1 * Math.PI * 2;
        const rs = Math.sqrt(Math.max(0, 1 - zc * zc));
        ax = rs * Math.cos(phi); ay = rs * Math.sin(phi); az = zc;
      }
      // Małe skały kręcą się szybciej; w kosmosie powoli (rad/s).
      const spin = (uSpin - 0.5) * 2 * Math.min(0.35, 9 / Math.sqrt(d + 40));
      const z = isPlay ? 0 : band.zNear + uZ * (band.zFar - band.zNear);
      rocks.push({
        id: hash32(this.seed ^ 0x1D, bandIndex, k, cx, cy) * 1024 + i,
        band: bandIndex, oct: k,
        x, y, z, d, r,
        shape: Math.min(c.shapeCount - 1, pickShape(type, d, uShape, uVariant)),
        type,
        qx, qy, qz, qw,
        ax, ay, az, spin,
        phase: uPhase * Math.PI * 2,
        sx: 0.8 + s0 * 0.4, sy: 0.8 + s1 * 0.4, sz: 0.72 + s2 * 0.4,
        seed: uSeed,
        cluster
      });
    }
    this.stats.rocksGenerated += rocks.length;
    return rocks;
  }

  /** Skała PLAY wchodzi na większą (starsze oktawy) albo na przyjętą w tej komórce? */
  _overlapsLarger(bandIndex, k, x, y, r, sameCell) {
    const allow = this.config.playOverlap;
    for (let i = 0; i < sameCell.length; i++) {
      const o = sameCell[i];
      const rr = (o.r + r) * allow;
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    const band = this.bands[bandIndex];
    for (let j = k + 1; j < band.octaves.length; j++) {
      const oct = band.octaves[j];
      const reach = oct.d1 * 0.5 + r;
      const cx0 = Math.floor((x - reach) / oct.cell);
      const cx1 = Math.floor((x + reach) / oct.cell);
      const cy0 = Math.floor((y - reach) / oct.cell);
      const cy1 = Math.floor((y + reach) / oct.cell);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const list = this.cellRocks(bandIndex, j, cx, cy);
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            const rr = (o.r + r) * allow;
            const dx = o.x - x;
            const dy = o.y - y;
            if (dx * dx + dy * dy < rr * rr) return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Typ skały: najpierw neutralna (wypełniacz) albo ruda — udział rud rośnie
   * z głębokością w polu — potem ruda ze składu pasa. Jedno losowanie u dzielone
   * na obie decyzje (stała liczba losowań na kandydata).
   */
  _pickRockType(region, x, y, u, depth = 1, d = 0, isPlay = true) {
    if (!region) return NEUTRAL_TYPE;
    // Komórka burzy (asteroidStorms.js): część skał to skały energetyczne.
    // Decyzja z haszu pozycji — bez dodatkowego losowania rng komórki (układ
    // pola poza burzami zostaje bit w bit).
    if (depth > STORM_CONFIG.minCluster && d >= STORM_CONFIG.energyMinDiameter) {
      const storm = stormIntensity(this.seed, x, y, depth);
      const share = STORM_CONFIG.energyShare * (isPlay ? 1 : STORM_CONFIG.energyBackdropShare);
      if (storm > 0 && stormHash01(x, y, this.seed) < storm * share) return ENERGY_TYPE;
    }
    const share = oreShareAtDepth(depth);
    if (u >= share) return NEUTRAL_TYPE;
    return this._pickType(region, x, y, u / share, depth);
  }

  _pickType(region, x, y, u, depth = 1) {
    if (!region) return 0;
    const comp = region.composition;
    const c = this.config;
    // Prowincja rud: jeden typ z listy pasa dostaje premię w tej okolicy.
    const pn = fbm2(x / c.provinceScale, y / c.provinceScale, this.seed ^ 0x0E5, 3);
    let nonzero = 0;
    for (let i = 0; i < comp.length; i++) if (comp[i] > 0) nonzero++;
    let favored = -1;
    if (nonzero > 1) {
      let slot = Math.min(nonzero - 1, Math.floor(pn * nonzero * 0.999));
      for (let i = 0; i < comp.length; i++) {
        if (comp[i] <= 0) continue;
        if (slot === 0) { favored = i; break; }
        slot--;
      }
    }
    const boost = c.provinceStrength * smoothstep(0.35, 0.65, fbm2(x / c.provinceScale + 31.7, y / c.provinceScale - 12.2, this.seed ^ 0x7A1, 2));
    // Rudy rzadkie (kryształ, uran) i średnie (miedź, tytan) głównie w głębi pola.
    let total = 0;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] > 0) total += (comp[i] + (i === favored ? boost : 0)) * oreTierFactor(i, depth);
    }
    let t = u * total;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] <= 0) continue;
      const w = (comp[i] + (i === favored ? boost : 0)) * oreTierFactor(i, depth);
      if (w <= 0) continue;
      t -= w;
      if (t <= 0) return i;
    }
    for (let i = comp.length - 1; i >= 0; i--) if (comp[i] > 0) return i;
    return 0;
  }

  /**
   * Skały pasma w prostokącie świata. `minDiameter` pomija całe oktawy
   * drobnicy (przy oddaleniu subpikselowe skały nie są nawet generowane).
   * cb(rock) — rock z cache, nie modyfikować.
   */
  forEachRockInRect(bandIndex, x0, y0, x1, y1, minDiameter, cb) {
    const band = this.bands[bandIndex];
    if (!band) return 0;
    let count = 0;
    for (let k = 0; k < band.octaves.length; k++) {
      const oct = band.octaves[k];
      if (oct.d1 < minDiameter) continue;
      const pad = oct.d1 * 0.5;
      const cx0 = Math.floor((x0 - pad) / oct.cell);
      const cx1 = Math.floor((x1 + pad) / oct.cell);
      const cy0 = Math.floor((y0 - pad) / oct.cell);
      const cy1 = Math.floor((y1 + pad) / oct.cell);
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 20000) continue; // bezpiecznik
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const list = this.cellRocks(bandIndex, k, cx, cy);
          for (let i = 0; i < list.length; i++) {
            const rock = list[i];
            if (rock.d < minDiameter) continue;
            const r = rock.r;
            if (rock.x + r < x0 || rock.x - r > x1 || rock.y + r < y0 || rock.y - r > y1) continue;
            cb(rock);
            count++;
          }
        }
      }
    }
    return count;
  }

  /** Czy region świata w ogóle dotyka pasa (szybkie odrzucenie całych kadrów). */
  rectTouchesBelt(x0, y0, x1, y1) {
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const half = Math.hypot(x1 - x0, y1 - y0) * 0.5;
    for (let i = 0; i < this.regions.length; i++) {
      if (regionPenetration(this.regions[i], cx, cy) > -(half + this.edgeWorld)) return true;
    }
    return false;
  }

  /** Koniec klatki: licznik wieku komórek i przycięcie cache do `maxCells`. */
  endFrame(maxCells = 6000) {
    this._frame++;
    if (this._cache.size <= maxCells) return;
    // Najstarsze komórki pierwsze; świeże (z tej i poprzedniej klatki) zostają.
    const entries = [];
    for (const [key, v] of this._cache) entries.push([key, v.frame]);
    entries.sort((a, b) => a[1] - b[1]);
    const drop = this._cache.size - Math.floor(maxCells * 0.8);
    for (let i = 0; i < drop && i < entries.length; i++) {
      if (entries[i][1] >= this._frame - 2) break;
      this._cache.delete(entries[i][0]);
    }
  }

  clearCache() {
    this._cache.clear();
  }

  /**
   * Obszary bez skał gry: [{ x, y, rx, ry }] (elipsy w świecie). Skały PLAY,
   * które by w nie weszły, są pomijane (olbrzym stoi w polu, w jego tunelach
   * i jaskiniach nie ma drobnicy). Tło pod płaszczyzną zostaje — olbrzym je
   * zasłania. Czyści cache komórek.
   */
  setExclusions(list) {
    this.exclusions = (list || []).map((e) => ({ x: e.x, y: e.y, rx: e.rx, ry: e.ry }));
    this.clearCache();
  }

  _excluded(x, y, r) {
    for (let i = 0; i < this.exclusions.length; i++) {
      const e = this.exclusions[i];
      const dx = (x - e.x) / (e.rx + r);
      const dy = (y - e.y) / (e.ry + r);
      if (dx * dx + dy * dy < 1) return true;
    }
    return false;
  }

  get cacheSize() {
    return this._cache.size;
  }
}
