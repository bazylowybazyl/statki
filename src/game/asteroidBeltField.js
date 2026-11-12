// src/game/asteroidBeltField.js
//
// Proceduralny, deterministyczny pas asteroid — źródło skał dla gry i tła.
//
// Skały nie są trzymane w pamięci. Zawartość świata jest funkcją (ziarno,
// pasmo, oktawa rozmiaru, komórka): komórkę generuje się, gdy ktoś jej
// potrzebuje (render w kadrze, fizyka przy statku), i wyrzuca z pamięci, gdy
// przestaje być potrzebna. Ten sam argument zawsze daje te same skały.
//
// Gęstość = profil pasa (krawędzie z BELT_DEFINITIONS, miękkie) × luki Kirkwooda
// (rzadsze pierścienie na rezonansach z Jowiszem) × pola:
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

import { BELT_DEFINITIONS } from '../data/asteroidTypes.js';
import { ASTEROID_FAMILIES, REGION_FAMILIES, BELT_FAMILY_CONFIG } from '../data/asteroidFamilies.js';
import { SMALL_BODY_BY_ID, smallBodyPosition } from '../data/smallBodies.js';
import {
  ROCK_TYPES, ROCK_TYPE_INDEX, ORE_ROCK_TYPES, NEUTRAL_TYPE, NEUTRAL_CARBON_TYPE, ENERGY_TYPE, SHAPE_COUNT,
  pickShape, oreShareAtDepth, oreTierFactor
} from './asteroidRockKinds.js';
import { STORM_CONFIG, stormIntensity, stormHash01 } from './asteroidStorms.js';
import { rockSpinRate, rockTumble, rockMoonFor, rockSystemReach, MOON_CONFIG } from './asteroidRotation.js';

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
  // LUKI KIRKWOODA: rezonanse średniego ruchu z Jowiszem wymiatają pas na stałych odległościach od
  // Słońca. Prawdziwe 2,50 / 2,82 / 2,95 / 3,27 AU przeliczone liniowo jak BELT_DEFINITIONS
  // (AU mapy = 33 + (a − 1,524) · 17,2 / 3,680). `width` [AU mapy] — szerokość w połowie głębokości,
  // brzegi miękkie na `kirkwoodSoftAu` (albo `soft` luki); w środku luki gęstość × `kirkwoodDensity`
  // (albo `density` luki) — rzadki przesmyk, nie pustka; przecina też gęste pola. Luka kończy się
  // dokładnie na width / 2 + soft / 2 — dalej mnożnik 1. Pusta lista = pas bez luk (A/B).
  // Pierścienie skanu rdzeni olbrzymów (asteroidBeltGiants.js: 38,17 / 39,5 / 40,83 … AU) leżą POZA
  // lukami: rdzenie mają remisy maksymalnej gęstości, więc nawet ogon luki ×0,997 przestawiał olbrzymy
  // (test w tests/asteroidBeltField.test.mjs). 7:3 — najwęższa z prawdziwych luk, 0,2 AU od pierścienia 39,5.
  kirkwoodGaps: Object.freeze([
    Object.freeze({ id: '3:1', au: 37.57, width: 0.45 }),
    Object.freeze({ id: '5:2', au: 39.08, width: 0.4 }),
    Object.freeze({ id: '7:3', au: 39.70, width: 0.24, soft: 0.12 }),
    Object.freeze({ id: '2:1', au: 41.20, width: 0.5 })
  ]),
  kirkwoodSoftAu: 0.2,
  kirkwoodDensity: 0.1,
  // Zewnętrzna krawędź pasa głównego [AU mapy] — null: BELT_DEFINITIONS (47). 41,5 ≈ prawdziwa krawędź
  // (luka 2:1, 3,27 AU) — łuki Hild stoją osobno za pasem (decyzja użytkownika 2026-10-11). Strefa HUD /
  // warpa pasa (ASTEROID_BELT w index.html, 36–47 — obejmuje Hildy), skan olbrzymów (37,5–45,5 AU) i zasadzka
  // misji 2 czytają krawędź z BELT_DEFINITIONS; olbrzymy szukają rdzeni w gęstości pola, więc przy 41,5
  // cztery z pięciu stoją bliżej (38,6–39,9 AU), Labirynt bez zmian.
  mainOuterAu: 41.5,
  // Prowincje rud: szum przesuwający skład w stronę jednego typu.
  provinceScale: 150000,
  provinceStrength: 0.9,
  // Najmniejsza waga typu w składzie, przy której prowincja może go faworyzować (premia 0,9 robiła
  // z domieszki gradientu — np. węglowej 6% przy rodzinie Westy — rudę dominującą okolicy).
  provinceMinWeight: 0.08,
  // Cel: tyle skał na komórkę w rdzeniu pola (dobór rozmiaru komórki oktawy).
  cellTargetCount: 12,
  cellMin: 1024,
  cellMax: 65536,
  // Pozwolone zachodzenie skał PLAY na siebie (ułamek sumy promieni).
  playOverlap: 0.82,
  // Liczba kształtów w banku (src/3d/asteroids/rockBank.js): rodziny × warianty
  // (asteroidRockKinds.js) — kształt zależy od typu i rozmiaru skały.
  shapeCount: SHAPE_COUNT
});

/**
 * WYRWY (E3, ekonomia pasa — docs/PLAN-ekonomia-rynki.md § 3.3): obszary przerzedzone wydobyciem. Źródłem jest
 * rejestr uszczuplenia świata ruchu (src/game/traffic/miningFields.js), do gry dochodzą przez most ruchu i świat
 * pasa (beltWorld.setHoles → pole gry i replika obrazu). Wyrwa = koło { x, y, r, depth }: do `inner` promienia
 * gęstość × (1 − depth), dalej miękki brzeg poszarpany szumem; dotyczy WSZYSTKICH pasm (gra i tło).
 */
export const BELT_HOLE_CONFIG = Object.freeze({
  // Komórka siatki wyszukiwania wyrw [j.] (≥ największy promień wyrwy).
  grid: 16384,
  // Pełna głębokość do tego ułamka brzegu, dalej miękkie przejście do brzegu.
  inner: 0.6,
  // Poszarpanie brzegu (brzeg między (1 − edgeNoise) r a r) i skala jego szumu [j.].
  edgeNoise: 0.35,
  edgeScale: 3200,
  // Zapas unieważnienia komórek wokół wyrwy [j.]: skała PLAY ≤ 2600 j. z księżycem (zasięg układu ~4,85 r)
  // — komórka poza kołem mogła odrzucić skałę z powodu większej skały w kole (_overlapsLarger).
  reach: 7000,
  // Ile ostatnich prostokątów zmian pamięta pole (warstwy obrazu dogrywają je w update()).
  dirtyKeep: 64,
  // Zasięg zmiany cienia pól za wyrwą (od słońca) [j.]: ~6 długości odbudowy światła (asteroidFieldLight.js) —
  // dalej różnica transmitancji < 0,002. `holesTouch(…, light)` — pamięci obrazu ze słońcem (mapa pola, skały).
  lightReach: 420000
});

// Rudy pola → indeks ROCK_TYPES (rudy gry 0–6 jak dawniej, typy z widm 9–13).
export const TYPE_INDEX = Object.freeze(Object.fromEntries(ORE_ROCK_TYPES.map((t) => [t, ROCK_TYPE_INDEX[t]])));

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

/** Hasz napisu (FNV-1a, 32 bity) — ziarno brzegu wyrwy z jej id (ten sam w polu gry i w replice obrazu). */
function stringHash32(s) {
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Klucz komórki siatki wyrw (ix, iy w ±32 tys. komórek). */
function holeGridKey(ix, iy) {
  return (ix + 32768) * 65536 + (iy + 32768);
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

/**
 * Mnożnik gęstości luk Kirkwooda w odległości `rAu` od Słońca [AU mapy]: 1 poza lukami,
 * `density` (albo `gap.density`) w środku luki, miękko na brzegach (`softAu` albo `gap.soft`;
 * połowa głębokości na width / 2). Luki się nie sumują (minimum).
 */
export function kirkwoodGapFactor(rAu, gaps, softAu = 0.2, density = 0.1) {
  let f = 1;
  if (!gaps) return f;
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    const t = Math.abs(rAu - g.au);
    const soft = Number.isFinite(g.soft) ? g.soft : softAu;
    const e1 = g.width * 0.5 + soft * 0.5;
    if (t >= e1) continue;
    const e0 = Math.max(0, g.width * 0.5 - soft * 0.5);
    const d = Number.isFinite(g.density) ? g.density : density;
    const v = d + (1 - d) * (e1 > e0 ? smoothstep(e0, e1, t) : 1);
    if (v < f) f = v;
  }
  return f;
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

/** Wagi rud { typ: waga } → tablica po indeksach ROCK_TYPES (zera poza rudami pola). */
function oreWeights(map) {
  const out = new Float64Array(ROCK_TYPES.length);
  for (const t of ORE_ROCK_TYPES) out[ROCK_TYPE_INDEX[t]] = Math.max(0, Number(map?.[t]) || 0);
  return out;
}

/**
 * Pole `types` definicji pasa → skład regionu. Postać obiektu = stały skład (wypełniacz
 * kamienny); lista przystanków [{ au, dark, ore }] = skład po odległości od Słońca
 * (`compStops`: r w j. świata rosnąco). `composition` = skład pierwszego przystanku (zgodność).
 */
export function buildRegionComposition(types, au) {
  if (Array.isArray(types) && types.length > 0) {
    const compStops = types
      .map((s) => ({ r: (Number(s.au) || 0) * au, dark: Math.min(1, Math.max(0, Number(s.dark) || 0)), comp: oreWeights(s.ore) }))
      .sort((a, b) => a.r - b.r);
    return { composition: compStops[0].comp, compStops };
  }
  const comp = oreWeights(types || {});
  return { composition: comp, compStops: [{ r: 0, dark: 0, comp }] };
}

/**
 * Skład regionu w odległości r od Słońca → out (wagi po indeksach ROCK_TYPES); zwraca udział
 * wypełniacza węglowego (dark). Liniowo między przystankami, poza skrajnymi — skrajny.
 */
export function regionCompositionAt(region, r, out) {
  const stops = region.compStops;
  const n = stops.length;
  let a = stops[0], b = a, t = 0;
  if (n > 1 && r > a.r) {
    if (r >= stops[n - 1].r) { a = b = stops[n - 1]; }
    else {
      let i = 1;
      while (stops[i].r < r) i++;
      a = stops[i - 1]; b = stops[i];
      t = (r - a.r) / Math.max(1e-9, b.r - a.r);
    }
  }
  const ca = a.comp, cb = b.comp;
  for (let i = 0; i < out.length; i++) out[i] = ca[i] + (cb[i] - ca[i]) * t;
  return a.dark + (b.dark - a.dark) * t;
}

// ---------------------------------------------------------------------------
// Rodziny kolizyjne (A2, docs/PLAN-pas-realizm.md § A2; dane src/data/asteroidFamilies.js): gęste pole pasa
// głównego należy do rodziny — szczyt pola (wejście pod górę gładkiego szumu pól) → najbliższe ziarno rodziny
// (odległość promieniowa w rozrzucie `sigmaAu`, łukowa w `sigmaArcAu` / `anchorArcAu`). Rodzina daje skład
// rud pola i nazwę (`familyAt`). Westa i Hygiea mają jedno ziarno w miejscu ciała (kotwica: pozycje ciał
// z opcji `smallBodies` / `setSmallBodyAnchors`, inaczej kąty preferowane ze smallBodies.js).

/**
 * Ziarna rodzin: { fam (indeks), au, ang [rad], sigR [AU], sigS [AU łuku], anchor (id ciała | null) }.
 * `anchors` — { id: { x, y } } pozycje ciał w świecie (brak = kąt preferowany ciała).
 */
export function buildFamilySeeds(families, anchors, sunX, sunY, auToWorld, cfg = BELT_FAMILY_CONFIG) {
  const seeds = [];
  const p = { x: 0, y: 0 };
  families.forEach((f, fam) => {
    const sigR = Number(f.sigmaAu) > 0 ? Number(f.sigmaAu) : 0.3;
    if (f.anchor) {
      let pos = anchors?.[f.anchor];
      if (!pos) {
        const body = SMALL_BODY_BY_ID[f.anchor];
        if (!body) return;
        pos = smallBodyPosition(body, { x: sunX, y: sunY }, auToWorld, p);
      }
      const dx = pos.x - sunX;
      const dy = pos.y - sunY;
      seeds.push({ fam, au: Math.hypot(dx, dy) / auToWorld, ang: Math.atan2(dy, dx), sigR, sigS: cfg.anchorArcAu, anchor: f.anchor });
      return;
    }
    const n = Math.max(1, Math.round(Number(f.seeds) || 3));
    const ph = (Number(f.phaseDeg) || 0) * Math.PI / 180;
    for (let k = 0; k < n; k++) {
      seeds.push({ fam, au: f.au, ang: wrapAngle(ph + (k * 2 * Math.PI) / n), sigR, sigS: cfg.sigmaArcAu, anchor: null });
    }
  });
  return seeds;
}

/**
 * Przypisanie rodzin do szczytów pól (lista `peaks`: { rAu, ang } — pola pasa głównego): (1) rodzina z kotwicą
 * bierze szczyt najbliższy swojemu ciału (|Δr| ≤ cfg.anchorClaim.maxDr; ważony Δr / dr, łuk / arc) i szczyty
 * w jego bliskim zasięgu (wynik < 1); (2) reszta — najbliższe ziarno (familyOfPeak); (3) rodzina bez kotwicy
 * bez żadnego szczytu przejmuje najlepiej pasujący szczyt od rodziny, która ma ich ≥ 2 (nie kotwicowy).
 * Zapisuje `fam` w każdym szczycie; deterministyczne.
 */
export function assignFamiliesToPeaks(peaks, families, seeds, cfg = BELT_FAMILY_CONFIG) {
  const claim = cfg.anchorClaim || { dr: 1, arc: 20, maxDr: 2, maxArcDeg: 75 };
  const maxArc = (Number(claim.maxArcDeg) || 180) * Math.PI / 180;
  for (const p of peaks) { p.fam = -1; p.anchored = false; }
  // (1) kotwice
  for (const s of seeds) {
    if (!s.anchor) continue;
    let best = null;
    let bestS = Infinity;
    for (const p of peaks) {
      const dr = p.rAu - s.au;
      const da = Math.abs(wrapAngle(p.ang - s.ang));
      if (Math.abs(dr) > claim.maxDr || da > maxArc) continue;
      const ds = da * s.au;
      const score = (dr / claim.dr) ** 2 + (ds / claim.arc) ** 2;
      if (score < 1 && !p.anchored) { p.fam = s.fam; p.anchored = true; }
      if (score < bestS && !p.anchored) { bestS = score; best = p; }
    }
    if (best && !peaks.some((p) => p.anchored && p.fam === s.fam)) { best.fam = s.fam; best.anchored = true; }
  }
  // (2) najbliższe ziarno (bez ziaren z kotwicą — te już wybrały)
  const free = seeds.filter((s) => !s.anchor);
  for (const p of peaks) {
    if (p.anchored) continue;
    p.fam = familyOfPeak(free, p.rAu, p.ang, null, null, null);
  }
  // (3) każda rodzina bez kotwicy ma co najmniej jedno pole (gdy jest od kogo wziąć)
  const count = new Map();
  for (const p of peaks) count.set(p.fam, (count.get(p.fam) || 0) + 1);
  families.forEach((f, fam) => {
    if (f.anchor || (count.get(fam) || 0) > 0) return;
    let best = null;
    let bestS = Infinity;
    for (const s of free) {
      if (s.fam !== fam) continue;
      for (const p of peaks) {
        if (p.anchored || (count.get(p.fam) || 0) < 2) continue;
        const dr = (p.rAu - s.au) / s.sigR;
        const ds = Math.abs(wrapAngle(p.ang - s.ang)) * p.rAu / s.sigS;
        const score = dr * dr + ds * ds;
        if (score < bestS) { bestS = score; best = p; }
      }
    }
    if (best) {
      count.set(best.fam, count.get(best.fam) - 1);
      best.fam = fam;
      count.set(fam, 1);
    }
  });
  return peaks;
}

/**
 * Rodzina (indeks) szczytu pola: ziarno o najmniejszej odległości ważonej. Szczyt jako (px, py) w świecie
 * z (sunX, sunY, auToWorld) — albo od razu (rAu, ang), gdy sunX === null.
 */
export function familyOfPeak(seeds, px, py, sunX, sunY, auToWorld) {
  if (sunX === null) {
    let best = -1;
    let bestS = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const dr = (px - s.au) / s.sigR;
      const ds = Math.abs(wrapAngle(py - s.ang)) * px / s.sigS;
      const score = dr * dr + ds * ds;
      if (score < bestS) { bestS = score; best = s.fam; }
    }
    return best;
  }
  const dx = px - sunX;
  const dy = py - sunY;
  const rAu = Math.sqrt(dx * dx + dy * dy) / auToWorld;
  const ang = Math.atan2(dy, dx);
  let best = -1;
  let bestS = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const dr = (rAu - s.au) / s.sigR;
    const ds = Math.abs(wrapAngle(ang - s.ang)) * rAu / s.sigS;
    const score = dr * dr + ds * ds;
    if (score < bestS) { bestS = score; best = s.fam; }
  }
  return best;
}

/**
 * Pola populacji (strumień E, 2026-10-12 — docs/PLAN-pas-realizm.md § „E: projekt”), wszystkie opcjonalne;
 * bez nich region liczy się bit w bit jak dawniej:
 *   densityMul — mnożnik gęstości (NEA 0,25; L5 0,61 = L4 / 1,64), fieldMul — mnożnik gęstych pól i obrzeża
 *   (0 = pojedyncze skały), edgeAU / edgeInAU — miękka krawędź (domyślnie BELT_FIELD_CONFIG.edgeAu; edgeInAU —
 *   tylko wewnętrzna krawędź ringu), profile [[au, mnożnik], …] — radialny profil gęstości (liniowo), holes
 *   [{ planet, r }] — wycięcie koła r [j.] wokół planety (pas nie budzi się przy K-7 i porcie Marsa — wycięcie
 *   wchodzi też do rectTouchesBelt), avoid { planet, halfDeg, softDeg, depth } — przerzedzenie (× depth) wokół
 *   długości planety (plutonki unikają Neptuna), overlay — region tylko składu i mnożnika gęstości (bez własnej
 *   obwiedni, wewnątrz innego regionu), bananaK — zwężenie promieniowe łuku ku końcom, angCoreDeg / angEnd —
 *   gęstość wzdłuż łuku (rdzeń 1, końce angEnd).
 */
function regionShapeFields(belt, au, find, sunX, sunY) {
  const num = (v, d) => (Number.isFinite(v) ? Number(v) : d);
  let profile = null;
  if (Array.isArray(belt.profile) && belt.profile.length > 1) {
    const pts = belt.profile.map(([a, v]) => [Number(a) * au, Math.max(0, Number(v) || 0)]).sort((p, q) => p[0] - q[0]);
    profile = { r: Float64Array.from(pts, (p) => p[0]), v: Float64Array.from(pts, (p) => p[1]) };
  }
  let holes = null;
  if (Array.isArray(belt.holes)) {
    for (const h of belt.holes) {
      const p = resolvePlanetXY(find(h.planet), sunX, sunY, au);
      if (!p || !(Number(h.r) > 0)) continue;
      (holes || (holes = [])).push({ planet: h.planet, x: p.x, y: p.y, r: Number(h.r) });
    }
  }
  let avoid = null;
  if (belt.avoid) {
    const p = resolvePlanetXY(find(belt.avoid.planet), sunX, sunY, au);
    if (p) {
      avoid = {
        ang: Math.atan2(p.y - sunY, p.x - sunX),
        half: num(belt.avoid.halfDeg, 60) * Math.PI / 180,
        soft: num(belt.avoid.softDeg, 15) * Math.PI / 180,
        depth: Math.min(1, Math.max(0, num(belt.avoid.depth, 0.2)))
      };
    }
  }
  const angCore = Number.isFinite(belt.angCoreDeg) ? belt.angCoreDeg * Math.PI / 180 : 0;
  return {
    densityMul: Math.max(0, num(belt.densityMul, 1)),
    fieldMul: Math.max(0, num(belt.fieldMul, 1)),
    overlay: !!belt.overlay,
    // 0 = domyślna krawędź pola (konstruktor AsteroidBeltField)
    edge: num(belt.edgeAU, 0) * au,
    edgeIn: num(belt.edgeInAU, 0) * au,
    profile, holes, avoid,
    bananaK: Math.min(0.95, Math.max(0, num(belt.bananaK, 0))),
    angCore, angEnd: angCore > 0 ? Math.min(1, Math.max(0, num(belt.angEnd, 1))) : 1
  };
}

/** Profil radialny regionu ({ r, v } w j.) w odległości r — liniowo, poza skrajnymi węzłami skrajny. */
function profileAt(p, r) {
  const rs = p.r;
  const n = rs.length;
  if (r <= rs[0]) return p.v[0];
  if (r >= rs[n - 1]) return p.v[n - 1];
  let i = 1;
  while (rs[i] < r) i++;
  const t = (r - rs[i - 1]) / (rs[i] - rs[i - 1]);
  return p.v[i - 1] + (p.v[i] - p.v[i - 1]) * t;
}

/**
 * BELT_DEFINITIONS → regiony w świecie gry. Ring: pierścień wokół słońca.
 * Arc (Grecy, Trojańczycy, 3 skupiska Hildas w wierzchołkach L3 / L4 / L5): wycinek pierścienia.
 * Pozycje planet-kotwic zamrażane w chwili wywołania, jak robiło to dawne pole.
 * `priority` regionu — pierwszeństwo w wyborze regionu (skład) tam, gdzie region leży (sampleMacro).
 */
export function buildBeltRegions(beltDefs = BELT_DEFINITIONS, { planets = [], sunX = 0, sunY = 0, auToWorld = 42253.52 } = {}) {
  const au = auToWorld;
  const regions = [];
  const find = (id) => planets.find((p) => p && (p.id === id || p.name === id)) || null;
  for (const belt of beltDefs || []) {
    const { composition, compStops } = buildRegionComposition(belt.types, au);
    const common = {
      beltId: belt.id, composition, compStops,
      ice: Number.isFinite(belt.ice) ? Number(belt.ice) : (belt.id === 'kuiper' ? 1 : 0),
      priority: Number(belt.priority) || 0,
      ...regionShapeFields(belt, au, find, sunX, sunY)
    };
    if (belt.shape === 'ring') {
      regions.push({ ...common, kind: 'ring', cx: sunX, cy: sunY, rInner: belt.innerAU * au, rOuter: belt.outerAU * au });
      continue;
    }
    if (belt.shape === 'lagrange') {
      const p = resolvePlanetXY(find(belt.anchorPlanet), sunX, sunY, au);
      if (!p) continue;
      const rMid = Math.hypot(p.x - sunX, p.y - sunY);
      if (rMid < 1) continue;
      const l4 = belt.lagrange === 'L4';
      const offset = l4 ? Math.PI / 3 : -Math.PI / 3;
      const angHalf = (belt.arcSpread || 0.3) * 0.5 + 0.02;
      // Kijanka asymetryczna: `angLeadDeg` — w stronę Jowisza, `angTrailDeg` — od Jowisza (L4 leży na +60°,
      // więc „ku Jowiszowi” to ujemne Δ; L5 — lustro). Bez pól — łuk symetryczny jak dawniej.
      const lead = Number.isFinite(belt.angLeadDeg) ? belt.angLeadDeg * Math.PI / 180 : angHalf;
      const trail = Number.isFinite(belt.angTrailDeg) ? belt.angTrailDeg * Math.PI / 180 : angHalf;
      regions.push({
        ...common, kind: 'arc', cx: sunX, cy: sunY, rMid,
        rHalf: (belt.spreadAU || 4) * au * 0.5,
        angMid: Math.atan2(p.y - sunY, p.x - sunX) + offset,
        angHalf,
        angLo: l4 ? -lead : -trail,
        angHi: l4 ? trail : lead
      });
      continue;
    }
    if (belt.shape === 'triangle') {
      // Skupiska w wierzchołkach trójkąta (kąty względem kotwicy; domyślnie L3 / L4 / L5).
      const p = resolvePlanetXY(find(belt.anchorPlanet), sunX, sunY, au);
      const base = p ? Math.atan2(p.y - sunY, p.x - sunX) : 0;
      const angles = Array.isArray(belt.anglesDeg) ? belt.anglesDeg : [180, 60, -60];
      for (const deg of angles) {
        const angHalf = (Number(belt.arcSpread) || 0.34) * 0.5;
        regions.push({
          ...common, kind: 'arc', cx: sunX, cy: sunY,
          rMid: (belt.radiusAU || 44.4) * au,
          rHalf: (belt.spreadAU || 3) * au * 0.5,
          angMid: base + deg * Math.PI / 180,
          angHalf, angLo: -angHalf, angHi: angHalf
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
  let pen;
  const r = Math.hypot(dx, dy);
  if (region.kind === 'ring') pen = Math.min(r - region.rInner, region.rOuter - r);
  else {
    const d = wrapAngle(Math.atan2(dy, dx) - region.angMid);
    const lo = Number.isFinite(region.angLo) ? region.angLo : -region.angHalf;
    const hi = Number.isFinite(region.angHi) ? region.angHi : region.angHalf;
    const side = d < 0 ? -lo : hi;
    const ad = d < 0 ? -d : d;
    let rHalf = region.rHalf;
    if (region.bananaK > 0) { const u = Math.min(1, ad / side); rHalf *= 1 - region.bananaK * u * u; }
    pen = Math.min(rHalf - Math.abs(r - region.rMid), (side - ad) * region.rMid);
  }
  const holes = region.holes;
  if (holes) {
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      const hd = Math.hypot(x - h.x, y - h.y) - h.r;
      if (hd < pen) pen = hd;
    }
  }
  return pen;
}

// Obwiednia regionu (0..1) w punkcie (dx, dy — od środka regionu, r = |d|); wniknięcie → _rsPen.
// Krawędzie: reg.edge (zewnętrzna, łuki, wycięcia), reg.edgeIn (wewnętrzna ringu). smoothstep jest monotoniczny,
// więc min po składowych = smoothstep(min wniknięć) — przy jednej krawędzi bit w bit z dawnym smoothstep(pen).
let _rsPen = 0;
function regionEnvelope(reg, x, y, dx, dy, r) {
  const e = reg.edge;
  let pen;
  let w;
  if (reg.kind === 'ring') {
    const pi = r - reg.rInner;
    const po = reg.rOuter - r;
    pen = pi < po ? pi : po;
    if (reg.edgeIn === e) w = smoothstep(-e * 0.35, e, pen);
    else {
      const ei = reg.edgeIn;
      const a = smoothstep(-ei * 0.35, ei, pi);
      const b = smoothstep(-e * 0.35, e, po);
      w = a < b ? a : b;
    }
  } else {
    const d = wrapAngle(Math.atan2(dy, dx) - reg.angMid);
    const side = d < 0 ? -reg.angLo : reg.angHi;
    const ad = d < 0 ? -d : d;
    let rHalf = reg.rHalf;
    if (reg.bananaK > 0) { const u = Math.min(1, ad / side); rHalf *= 1 - reg.bananaK * u * u; }
    const radial = rHalf - Math.abs(r - reg.rMid);
    const tangential = (side - ad) * reg.rMid;
    pen = Math.min(radial, tangential);
    w = smoothstep(-e * 0.35, e, pen);
    // Gęstość wzdłuż łuku: rdzeń ±angCore = 1, ku końcom do angEnd.
    if (reg.angCore > 0 && w > 0 && ad > reg.angCore) w *= reg.angEnd + (1 - reg.angEnd) * (1 - smoothstep(reg.angCore, side, ad));
  }
  const holes = reg.holes;
  if (holes) {
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      const hd = Math.hypot(x - h.x, y - h.y) - h.r;
      if (hd < pen) pen = hd;
      const hw = smoothstep(-e * 0.35, e, hd);
      if (hw < w) w = hw;
    }
  }
  _rsPen = pen;
  return w;
}

// Przerzedzenie wokół długości planety (plutonki unikają Neptuna): depth w środku, 1 poza half + soft.
function avoidFactor(av, dx, dy) {
  const d = Math.abs(wrapAngle(Math.atan2(dy, dx) - av.ang));
  return av.depth + (1 - av.depth) * smoothstep(av.half - av.soft, av.half + av.soft, d);
}

// ---------------------------------------------------------------------------
// Pole

const _macro = { weight: 0, gap: 1, cluster: 0, rim: 0, depth: 0, density: 0, ice: 0, region: null, hole: 1, gas: 0 };

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
    if (Number.isFinite(this.config.mainOuterAu)) {
      const main = this.regions.find((r) => r.beltId === 'main' && r.kind === 'ring');
      if (main) main.rOuter = Math.max(main.rInner, this.config.mainOuterAu * this.auToWorld);
    }
    this.edgeWorld = this.config.edgeAu * this.auToWorld;
    // Krawędzie regionów (0 = domyślna) i pasmo promieni [rLo, rHi], poza którym region nie daje obwiedni ani
    // wniknięcia > −0,35 krawędzi — sampleMacro pomija go wtedy przed atan2 / wycięciami.
    for (const reg of this.regions) {
      if (!(reg.edge > 0)) reg.edge = this.edgeWorld;
      if (!(reg.edgeIn > 0)) reg.edgeIn = reg.edge;
      if (reg.kind === 'ring') {
        reg.rLo = Math.max(0, reg.rInner - reg.edgeIn * 0.35);
        reg.rHi = reg.rOuter + reg.edge * 0.35;
      } else {
        reg.rLo = Math.max(0, reg.rMid - reg.rHalf - reg.edge * 0.35);
        reg.rHi = reg.rMid + reg.rHalf + reg.edge * 0.35;
      }
      reg.solarCentered = reg.cx === this.sunX && reg.cy === this.sunY;
    }
    // Luki Kirkwooda: pasmo [r0, r1] obejmujące wszystkie luki (r² w j.², bez pierwiastka poza nim).
    this._hasGaps = false;
    this._gapR0sq = 0;
    this._gapR1sq = 0;
    const gaps = this.config.kirkwoodGaps;
    if (Array.isArray(gaps) && gaps.length > 0) {
      let r0 = Infinity;
      let r1 = 0;
      for (const g of gaps) {
        const e1 = g.width * 0.5 + (Number.isFinite(g.soft) ? g.soft : this.config.kirkwoodSoftAu) * 0.5;
        r0 = Math.min(r0, g.au - e1);
        r1 = Math.max(r1, g.au + e1);
      }
      r0 = Math.max(0, r0) * this.auToWorld;
      r1 *= this.auToWorld;
      this._hasGaps = r1 > r0;
      this._gapR0sq = r0 * r0;
      this._gapR1sq = r1 * r1;
    }
    // Mnożnik gęstości ustawiany na żywo (demo, strojenie) — nie zmienia
    // rozmieszczenia istniejących skał w komórkach poza przerzedzeniem.
    this.densityScale = 1;
    // Obszary bez skał gry (olbrzymy: asteroidGiants.js) — elipsy w świecie.
    this.exclusions = [];
    // Koła budzenia pasa [{ x, y, r, active }] poza regionami — skała rysowana materiałem pasa poza polem
    // (przelot NEA przy Ziemi: src/game/neaFlyby.js); rectTouchesBelt widzi je jak region.
    this.wakeSpots = [];
    // Wyrwy po wydobyciu (setHoles): lista, siatka wyszukiwania, wersja i ostatnie prostokąty zmian.
    this.holes = [];
    this._holeById = new Map();
    this._holeGrid = new Map();
    this.holeVersion = 0;
    this.holeDirty = [];
    this.bands = BELT_BANDS.map((band, index) => this._buildBandPlan(band, index));
    this._cache = new Map();
    this._frame = 0;
    this.stats = { cellsGenerated: 0, rocksGenerated: 0, cacheHits: 0 };
    // Rodziny kolizyjne (A2): skład i nazwa gęstych pól pasa głównego.
    this._initFamilies(opts.families || ASTEROID_FAMILIES, opts.smallBodies || null, opts.familyConfig);
  }

  // ---------------------------------------------------------------------------
  // Rodziny kolizyjne (A2)

  _initFamilies(families, anchors, cfg) {
    this.families = families;
    this.familyConfig = { ...BELT_FAMILY_CONFIG, ...(cfg || {}) };
    this._famComp = families.map((f) => oreWeights(f.ore));
    this._famDark = families.map((f) => Math.min(1, Math.max(0, Number(f.dark) || 0)));
    this._famCell = new Map();
    this._famIdx = new Int32Array(8);
    this._famWt = new Float64Array(8);
    // Prowincje rud fbm zostają tylko w regionach bez rodzin (Kuiper, populacje E); pas główny i roje
    // przy Jowiszu mają skład rodzin.
    for (const reg of this.regions) {
      reg.familyRegion = reg.beltId === 'main' ? 'main' : (REGION_FAMILIES[reg.beltId] ? 'region' : null);
    }
    this.setSmallBodyAnchors(anchors, false);
  }

  /**
   * Pozycje ciał-kotwic rodzin (Westa, Hygiea): [{ id, x, y }] albo { id: { x, y } } w świecie gry —
   * gra podaje je po rozstrzygnięciu kątów (resolveSmallBodyAngles, index.html); brak = kąty preferowane.
   * Czyści pamięć przypisań i cache komórek (skład skał zależy od rodziny).
   */
  setSmallBodyAnchors(list, clear = true) {
    let anchors = null;
    if (Array.isArray(list)) {
      anchors = {};
      for (const b of list) if (b && b.id != null && Number.isFinite(b.x) && Number.isFinite(b.y)) anchors[b.id] = { x: b.x, y: b.y };
    } else if (list && typeof list === 'object') {
      anchors = list;
    }
    this._famSeeds = buildFamilySeeds(this.families, anchors, this.sunX, this.sunY, this.auToWorld, this.familyConfig);
    this._famAnchors = this._famSeeds.filter((s) => s.anchor);
    if (this._famPeaks) assignFamiliesToPeaks(this._famPeaks, this.families, this._famSeeds, this.familyConfig);
    this._famCell.clear();
    if (clear) this.clearCache();
  }

  /**
   * Szczyty pól pasa głównego (raz, leniwie, ~20–40 ms): wejścia pod górę z rzadkiej siatki w pierścieniu pasa
   * (z zapasem — pole ze szczytem tuż za krawędzią sięga w pas), szczyt z polem (szum pól ≥ próg), bez
   * powtórzeń; przypisanie rodzin — assignFamiliesToPeaks.
   */
  familyPeaks() {
    if (this._famPeaks) return this._famPeaks;
    const peaks = [];
    const main = this.regions.find((r) => r.familyRegion === 'main' && r.kind === 'ring');
    if (main && this.families.length) {
      const c = this.config;
      const cfg = this.familyConfig;
      const s = c.clusterScale;
      const seed = this.seed ^ 0xC1A57E;
      const edge0 = c.clusterThreshold - c.clusterSoftness;
      const pad = cfg.peakScanPadAu * this.auToWorld;
      const r0 = Math.max(0, main.rInner - pad);
      const r1 = main.rOuter + pad;
      const step = cfg.peakScanStep;
      const dd = cfg.peakDedupe * cfg.peakDedupe;
      for (let gx = this.sunX - r1; gx <= this.sunX + r1; gx += step) {
        for (let gy = this.sunY - r1; gy <= this.sunY + r1; gy += step) {
          const r = Math.hypot(gx - this.sunX, gy - this.sunY);
          if (r < r0 || r > r1) continue;
          this._climbPeak(gx, gy);
          const px = this._peakX;
          const py = this._peakY;
          let dup = false;
          for (let i = 0; i < peaks.length && !dup; i++) {
            const ex = peaks[i].x - px;
            const ey = peaks[i].y - py;
            dup = ex * ex + ey * ey < dd;
          }
          if (dup) continue;
          const n4 = fbm2(px / s, py / s, seed, 4);
          const n2 = fbm2(px / s, py / s, seed, cfg.climbOctaves);
          if (Math.max(n4, n2) < edge0) continue;
          const dx = px - this.sunX;
          const dy = py - this.sunY;
          const pr = Math.hypot(dx, dy);
          if (pr < r0 || pr > r1) continue;
          peaks.push({ x: px, y: py, rAu: pr / this.auToWorld, ang: Math.atan2(dy, dx), fam: -1, anchored: false });
        }
      }
    }
    this._famPeaks = peaks;
    assignFamiliesToPeaks(peaks, this.families, this._famSeeds, this.familyConfig);
    return peaks;
  }

  /** Wejście pod górę gładkiego szumu pól od (x, y) → this._peakX / this._peakY (szczyt pola). */
  _climbPeak(x, y) {
    const s = this.config.clusterScale;
    const seed = this.seed ^ 0xC1A57E;
    const oct = this.familyConfig.climbOctaves;
    let u = x / s;
    let v = y / s;
    let val = fbm2(u, v, seed, oct);
    let step = 0.02;
    const e = 0.003;
    for (let i = 0; i < 96 && step > 1e-4; i++) {
      const gx = fbm2(u + e, v, seed, oct) - fbm2(u - e, v, seed, oct);
      const gy = fbm2(u, v + e, seed, oct) - fbm2(u, v - e, seed, oct);
      const g = Math.sqrt(gx * gx + gy * gy);
      if (g < 1e-12) break;
      const nu = u + (gx / g) * step;
      const nv = v + (gy / g) * step;
      const nval = fbm2(nu, nv, seed, oct);
      if (nval > val) { u = nu; v = nv; val = nval; step = Math.min(0.04, step * 1.25); } else step *= 0.5;
    }
    this._peakX = u * s;
    this._peakY = v * s;
  }

  /**
   * Rodzina komórki pamięci (ix, iy): szczyt pola od środka komórki → szczyt z listy (familyPeaks; ten sam
   * szczyt w promieniu peakMatch) → jego rodzina; szczyt spoza listy — najbliższe ziarno.
   */
  _familyCell(ix, iy) {
    const key = (ix + 32768) * 65536 + (iy + 32768);
    let f = this._famCell.get(key);
    if (f === undefined) {
      const cfg = this.familyConfig;
      const G = cfg.cellSize;
      this._climbPeak((ix + 0.5) * G, (iy + 0.5) * G);
      const px = this._peakX;
      const py = this._peakY;
      const peaks = this.familyPeaks();
      const m2 = cfg.peakMatch * cfg.peakMatch;
      let best = null;
      let bd = m2;
      for (let i = 0; i < peaks.length; i++) {
        const ex = peaks[i].x - px;
        const ey = peaks[i].y - py;
        const d2 = ex * ex + ey * ey;
        if (d2 < bd) { bd = d2; best = peaks[i]; }
      }
      f = best ? best.fam : familyOfPeak(this._famSeeds, px, py, this.sunX, this.sunY, this.auToWorld);
      this._famCell.set(key, f);
    }
    return f;
  }

  /**
   * Udziały rodzin w punkcie pasa głównego → this._famIdx / this._famWt (zwraca liczbę): rodzina pola
   * (cztery komórki dookoła, dwuliniowo) × smoothstep(depth) i strefy rodzin przy ciałach poza polem.
   */
  _familyWeights(x, y, depth) {
    const cfg = this.familyConfig;
    const idx = this._famIdx;
    const wt = this._famWt;
    let n = 0;
    const wf = depth > cfg.depth[0] ? smoothstep(cfg.depth[0], cfg.depth[1], depth) : 0;
    if (wf > 0) {
      const G = cfg.cellSize;
      const fx = x / G - 0.5;
      const fy = y / G - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const f00 = this._familyCell(ix, iy);
      const f10 = this._familyCell(ix + 1, iy);
      const f01 = this._familyCell(ix, iy + 1);
      const f11 = this._familyCell(ix + 1, iy + 1);
      if (f00 === f10 && f00 === f01 && f00 === f11) {
        if (f00 >= 0) { idx[n] = f00; wt[n] = wf; n++; }
      } else {
        const ws = this._famCornerW || (this._famCornerW = new Float64Array(4));
        const fs = this._famCornerF || (this._famCornerF = new Int32Array(4));
        ws[0] = (1 - tx) * (1 - ty); ws[1] = tx * (1 - ty); ws[2] = (1 - tx) * ty; ws[3] = tx * ty;
        fs[0] = f00; fs[1] = f10; fs[2] = f01; fs[3] = f11;
        for (let k = 0; k < 4; k++) {
          if (fs[k] < 0 || ws[k] <= 0) continue;
          let j = 0;
          while (j < n && idx[j] !== fs[k]) j++;
          if (j === n) { idx[n] = fs[k]; wt[n] = 0; n++; }
          wt[j] += ws[k] * wf;
        }
      }
    }
    // Strefy rodzin przy ciałach (rzadki pas przy Weście i Hygiei — rodzina siedzi przy ciele).
    const anchors = this._famAnchors;
    if (anchors.length && wf < 1) {
      const z = cfg.anchorZone;
      const dx = x - this.sunX;
      const dy = y - this.sunY;
      const rAu = Math.sqrt(dx * dx + dy * dy) / this.auToWorld;
      const ang = Math.atan2(dy, dx);
      for (let i = 0; i < anchors.length && n < idx.length; i++) {
        const s = anchors[i];
        const dr = (rAu - s.au) / z.radiusAu;
        const ds = Math.abs(wrapAngle(ang - s.ang)) * rAu / z.arcAu;
        const d2 = dr * dr + ds * ds;
        if (d2 > 16) continue;
        const wa = z.share * Math.exp(-0.5 * d2) * (1 - wf);
        if (wa < 0.01) continue;
        idx[n] = s.fam; wt[n] = wa; n++;
      }
    }
    // Suma udziałów ≤ 1 (reszta — skład tła regionu).
    let sum = 0;
    for (let k = 0; k < n; k++) sum += wt[k];
    if (sum > 1) for (let k = 0; k < n; k++) wt[k] /= sum;
    return n;
  }

  /**
   * Skład w punkcie → this._comp (wagi po indeksach ROCK_TYPES); zwraca udział wypełniacza węglowego.
   * Tło: przystanki `types` regionu; w pasie głównym na to rodziny (pole, strefy przy ciałach).
   */
  _composeAt(region, x, y, depth) {
    let dark = this._regionComp(region, x, y);
    if (region.familyRegion !== 'main') return dark;
    const n = this._familyWeights(x, y, depth);
    if (n === 0) return dark;
    const comp = this._comp;
    let W = 0;
    for (let k = 0; k < n; k++) W += this._famWt[k];
    const keep = 1 - W;
    for (let i = 0; i < comp.length; i++) comp[i] *= keep;
    dark *= keep;
    for (let k = 0; k < n; k++) {
      const fc = this._famComp[this._famIdx[k]];
      const w = this._famWt[k];
      for (let i = 0; i < comp.length; i++) comp[i] += fc[i] * w;
      dark += this._famDark[this._famIdx[k]] * w;
    }
    return dark;
  }

  /**
   * Rodzina w punkcie świata (HUD: skaner wydobycia, komunikat strefy) albo null: pasmo pasa głównego —
   * rodzina pola (głąb ≥ depth[1] / 2) albo strefy przy ciele; roje przy Jowiszu (Hildy, Trojańczycy) — region.
   * Zwraca obiekt rodziny (src/data/asteroidFamilies.js: label, title?, desc, spectral …).
   */
  familyAt(x, y) {
    const m = this.sampleMacro(x, y);
    const region = m.region;
    if (!region || !(m.weight > 0)) return null;
    if (region.familyRegion === 'region') return REGION_FAMILIES[region.beltId];
    if (region.familyRegion !== 'main') return null;
    const n = this._familyWeights(x, y, m.depth);
    let best = -1;
    let bw = 0.5;
    for (let k = 0; k < n; k++) if (this._famWt[k] > bw) { bw = this._famWt[k]; best = this._famIdx[k]; }
    return best >= 0 ? this.families[best] : null;
  }

  /**
   * Makro-próbka w punkcie (bez alokacji; wynik ważny do następnego wywołania).
   * weight — obwiednia pasa (najgłębsze wniknięcie w region), gap — mnożnik luk Kirkwooda,
   * cluster / rim — pole i obrzeże już przerzedzone luką, density — gęstość skał PLAY,
   * region — region składu (pierwszeństwo `priority`, potem najgłębsze wniknięcie).
   */
  sampleMacro(x, y, out = _macro) {
    // Obwiednia = max po regionach (bez nakładek) obwiedni × profil × densityMul; przy mnożnikach 1 — bit w bit
    // dawne smoothstep(max wniknięcia). Region składu: `priority`, potem najgłębsze wniknięcie (też nakładki).
    let best = -Infinity;
    let region = null;
    let pick = null;
    let pickPri = -Infinity;
    let pickPen = 0;
    let wBest = 0;
    let wReg = null;
    let ovMul = 1;
    const sdx = x - this.sunX;
    const sdy = y - this.sunY;
    const sr = Math.hypot(sdx, sdy);
    for (let i = 0; i < this.regions.length; i++) {
      const reg = this.regions[i];
      let dx = sdx;
      let dy = sdy;
      let r = sr;
      if (!reg.solarCentered) { dx = x - reg.cx; dy = y - reg.cy; r = Math.hypot(dx, dy); }
      if (r < reg.rLo || r > reg.rHi) continue;
      const w0 = regionEnvelope(reg, x, y, dx, dy, r);
      const pen = _rsPen;
      if (reg.overlay) {
        if (w0 > 0) {
          let t = reg.densityMul;
          if (reg.avoid) t *= avoidFactor(reg.avoid, dx, dy);
          ovMul *= 1 + (t - 1) * w0;
        }
      } else {
        if (pen > best) { best = pen; region = reg; }
        let w = w0;
        if (w > 0) {
          if (reg.profile) w *= profileAt(reg.profile, r);
          if (reg.avoid) w *= avoidFactor(reg.avoid, dx, dy);
          w *= reg.densityMul;
          if (w > wBest) { wBest = w; wReg = reg; }
        }
      }
      // Region o wyższym priorytecie wygrywa skład wszędzie, gdzie leży (Hildy w pasie głównym).
      if (pen > 0 && (reg.priority > pickPri || (reg.priority === pickPri && pen > pickPen))) {
        pick = reg; pickPri = reg.priority; pickPen = pen;
      }
    }
    // Poza każdym regionem: region = najgłębsze wniknięcie po WSZYSTKICH regionach (jak dawniej — barwa lodu,
    // skład obrzeża); tylko w punktach z zerową obwiednią, więc koszt pełnej pętli płacą próbki poza pasem.
    if (!pick && wBest === 0) {
      best = -Infinity;
      for (let i = 0; i < this.regions.length; i++) {
        const reg = this.regions[i];
        if (reg.overlay) continue;
        // Wniknięcie ≤ wniknięcie promieniowe (ring: dokładnie bez wycięć; łuk: tylko pasmo promieni) — region,
        // który i tak nie przebije `best`, pomijamy przed atan2 / wycięciami (wynik ten sam).
        if (reg.solarCentered) {
          const radial = reg.kind === 'ring' ? Math.min(sr - reg.rInner, reg.rOuter - sr) : reg.rHalf - Math.abs(sr - reg.rMid);
          if (radial <= best) continue;
        }
        const pen = regionPenetration(reg, x, y);
        if (pen > best) { best = pen; region = reg; }
      }
    }
    const wDens = wBest * ovMul;
    const weight = wDens < 1 ? wDens : 1;
    if (pick) region = pick;
    const fieldMul = wReg ? wReg.fieldMul : 1;
    const c = this.config;
    let cluster = 0;
    let rim = 0;
    let gap = 1;
    if (weight > 0) {
      const n = fbm2(x / c.clusterScale, y / c.clusterScale, this.seed ^ 0xC1A57E, 4);
      const edge0 = c.clusterThreshold - c.clusterSoftness;
      cluster = Math.pow(smoothstep(edge0, c.clusterThreshold + c.clusterSoftness, n), c.clusterPower);
      // Obrzeże z wypełniacza zaczyna się rimWidth przed polem i przechodzi
      // w pole (w rdzeniu gęstość to już tylko pole).
      rim = smoothstep(edge0 - c.rimWidth, edge0 + c.clusterSoftness * 0.4, n) * (1 - cluster);
      // Populacja bez gęstych pól (NEA) albo z rzadszymi (Hungarie): pola i obrzeże × fieldMul.
      if (fieldMul !== 1) { cluster *= fieldMul; rim *= fieldMul; }
      if (this._hasGaps) {
        const r2 = sdx * sdx + sdy * sdy;
        if (r2 > this._gapR0sq && r2 < this._gapR1sq) {
          gap = kirkwoodGapFactor(Math.sqrt(r2) / this.auToWorld, c.kirkwoodGaps, c.kirkwoodSoftAu, c.kirkwoodDensity);
        }
      }
    }
    out.weight = weight;
    out.gap = gap;
    // Luka przerzedza pas razem z polem: w luce mniej skał, płytsze pole (mniej rud, bez burz),
    // słabsza zasłona i cień pola.
    out.cluster = cluster * gap;
    out.rim = rim * gap;
    // Głębokość w polu dla składu (0 = rzadki pas i obrzeże, 1 = rdzeń).
    out.depth = out.cluster;
    out.density = wDens * gap * (c.baseDensity + (c.fieldDensity - c.baseDensity) * cluster + c.fieldDensity * c.rimDensity * rim) * this.densityScale;
    out.ice = region ? region.ice : 0;
    out.region = region;
    // Wyrwy po wydobyciu (setHoles): mnożnik mgły, pyłu, zasłony i cienia pól w punkcie (tam, gdzie nie ma skał,
    // nie ma też pyłu). Skały biorą go w _generateCell; `density` zostaje surowa — granica losowania komórki.
    out.hole = this.holes.length ? this.holeFactor(x, y) : 1;
    // AGENT: miejsce na źródła gazu (skały produkujące gaz — osobny temat, demo gazów i mgieł): dodatkowa gęstość
    // mgły w punkcie. Odbiorcy (fog.js, fieldMap.js, zasłona w asteroidBelt.js, cień pól asteroidFieldLight.js)
    // liczą pył jako „gęstość × hole + gas”, więc źródło gazu wystarczy dopisać tutaj (bez wyrw).
    out.gas = 0;
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

  /** Sześć haszy 0 … 1 skały (id) do pary z księżycem — tablica wielokrotnego użytku. */
  _moonHashes(idLo, idHi) {
    const h = this._mh || (this._mh = new Float64Array(6));
    for (let j = 0; j < 6; j++) h[j] = hash32(this.seed ^ 0x300A, idLo, idHi, j) / 4294967296;
    return h;
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
    // Pasmo, oktawa i komórka przy wpisie — wyrwa unieważnia komórki w swoim prostokącie (setHoles).
    this._cache.set(key, { rocks, frame: this._frame, b: bandIndex, k, cx, cy });
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
      // Wyrwa (wydobycie, setHoles) przerzedza tylko przyjęcie kandydata: ta sama liczba losowań i te same
      // skały poza wyrwą — w wyrwie zostaje ich podzbiór. Bez wyrw — bit w bit jak dawniej.
      if (uAccept * bound > (m.hole < 1 ? m.density * m.hole : m.density)) continue;
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
      // Obrót (asteroidRotation.js, D2 2026-10-12): okresy jak bariera obrotu rumowisk, w czasie
      // gry ściśnięte (małe monolity od ~30 s, duże od ~150 s, rozrzut × 8, wolne rotatory) — znak
      // i wielkość z uSpin, wolny rotator z haszu id (stała liczba losowań na kandydata).
      const id = hash32(this.seed ^ 0x1D, bandIndex, k, cx, cy) * 1024 + i;
      const idLo = id >>> 0;
      const idHi = Math.floor(id / 4294967296) >>> 0;
      const spin = rockSpinRate(d, uSpin, hash32(this.seed ^ 0x5B1, idLo, idHi) / 4294967296, hash32(this.seed ^ 0x5B2, idLo, idHi) / 4294967296);
      const z = isPlay ? 0 : band.zNear + uZ * (band.zFar - band.zNear);
      const rock = {
        id,
        band: bandIndex, oct: k,
        x, y, z, d, r,
        shape: Math.min(c.shapeCount - 1, pickShape(type, d, uShape, uVariant)),
        type,
        qx, qy, qz, qw,
        ax, ay, az, spin,
        phase: uPhase * Math.PI * 2,
        sx: 0.8 + s0 * 0.4, sy: 0.8 + s1 * 0.4, sz: 0.72 + s2 * 0.4,
        seed: uSeed,
        cluster,
        // Koziołkowanie (tempo precesji, rad/s; tylko tło — lustro shadera rockSpin.tsl.js) i
        // księżyc (rockMoonFor — para; null bez księżyca).
        tumble: isPlay ? 0 : rockTumble(uSeed, spin),
        moon: null
      };
      // Para z księżycem (hasze id): w paśmie gry orbita nie wchodzi na większe skały ani w strefy
      // wyłączone (ciała pasa) — inaczej skała zostaje bez księżyca.
      const moon = rockMoonFor(rock, isPlay, this._moonHashes(idLo, idHi));
      if (moon && (!isPlay || (!(this.exclusions.length && this._excluded(x, y, moon.dist + moon.r))
        && !this._overlapsLarger(bandIndex, k, x, y, moon.dist + moon.r, rocks)))) rock.moon = moon;
      rocks.push(rock);
    }
    this.stats.rocksGenerated += rocks.length;
    return rocks;
  }

  /** Skała PLAY wchodzi na większą (starsze oktawy) albo na przyjętą w tej komórce? */
  _overlapsLarger(bandIndex, k, x, y, r, sameCell) {
    const allow = this.config.playOverlap;
    // Skała z księżycem zajmuje cały układ (orbita — rockSystemReach): mniejsze skały nie wchodzą
    // na tor księżyca.
    for (let i = 0; i < sameCell.length; i++) {
      const o = sameCell[i];
      const rr = (rockSystemReach(o) + r) * allow;
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    const band = this.bands[bandIndex];
    const moonK = MOON_CONFIG.distRatio[1] + MOON_CONFIG.sizeRatio[1];
    for (let j = k + 1; j < band.octaves.length; j++) {
      const oct = band.octaves[j];
      // Okno komórek obejmuje też układy z księżycem (orbita do moonK promieni skały).
      const reach = oct.d1 * 0.5 * (oct.d1 >= MOON_CONFIG.playD[0] ? moonK : 1) + r;
      const cx0 = Math.floor((x - reach) / oct.cell);
      const cx1 = Math.floor((x + reach) / oct.cell);
      const cy0 = Math.floor((y - reach) / oct.cell);
      const cy1 = Math.floor((y + reach) / oct.cell);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const list = this.cellRocks(bandIndex, j, cx, cy);
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            const rr = (rockSystemReach(o) + r) * allow;
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
    // Skład (tło regionu + rodziny pasa głównego) i udział wypełniacza węglowego — raz na kandydata.
    const dark = this._composeAt(region, x, y, depth);
    if (u >= share) {
      // Wypełniacz: odmiana kamienna albo węglowa wg gradientu pasa i rodziny pola (tylko wygląd) —
      // z tego samego losowania (reszta u ponad udziałem rud jest jednostajna).
      if (dark <= 0) return NEUTRAL_TYPE;
      return (u - share) < dark * (1 - share) ? NEUTRAL_CARBON_TYPE : NEUTRAL_TYPE;
    }
    return this._pickFromComp(region, x, y, u / share, depth);
  }

  /**
   * Skład regionu w punkcie → this._comp; zwraca dark. Przystanki `types` są w AU od SŁOŃCA
   * (nie od środka regionu — regiony bez środka w Słońcu, np. przy planecie, też liczą od Słońca).
   */
  _regionComp(region, x, y) {
    const comp = this._comp || (this._comp = new Float64Array(ROCK_TYPES.length));
    if (region.compStops.length === 1) {
      comp.set(region.compStops[0].comp);
      return region.compStops[0].dark;
    }
    const dx = x - this.sunX, dy = y - this.sunY;
    return regionCompositionAt(region, Math.sqrt(dx * dx + dy * dy), comp);
  }

  _regionDark(region, x, y) {
    const stops = region.compStops;
    if (stops.length === 1) return stops[0].dark;
    const dx = x - this.sunX, dy = y - this.sunY;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r <= stops[0].r) return stops[0].dark;
    const n = stops.length;
    if (r >= stops[n - 1].r) return stops[n - 1].dark;
    let i = 1;
    while (stops[i].r < r) i++;
    const a = stops[i - 1], b = stops[i];
    return a.dark + (b.dark - a.dark) * (r - a.r) / Math.max(1e-9, b.r - a.r);
  }

  /** Ruda ze składu w punkcie (tło regionu + rodziny); u ∈ [0, 1). */
  _pickType(region, x, y, u, depth = 1) {
    if (!region) return 0;
    this._composeAt(region, x, y, depth);
    return this._pickFromComp(region, x, y, u, depth);
  }

  /** Ruda z this._comp (po _composeAt) — szczeble rud z głębokością; prowincje tylko poza rodzinami. */
  _pickFromComp(region, x, y, u, depth) {
    const comp = this._comp;
    const total = this._oreWeights(region, x, y, depth);
    const w = this._oreW;
    let t = u * total;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] <= 0) continue;
      const wi = w[i];
      if (wi <= 0) continue;
      t -= wi;
      if (t <= 0) return i;
    }
    for (let i = comp.length - 1; i >= 0; i--) if (comp[i] > 0) return i;
    return 0;
  }

  /**
   * Wagi rud z this._comp (po _composeAt) → this._oreW (po indeksach ROCK_TYPES; zwraca sumę): skład × szczebel
   * rudy na głębokości pola, premia prowincji w regionach bez rodzin. Wspólne dla losowania typu skały
   * (_pickFromComp) i udziałów typów w punkcie (typeSharesAt).
   */
  _oreWeights(region, x, y, depth) {
    const comp = this._comp;
    const w = this._oreW || (this._oreW = new Float64Array(comp.length));
    const c = this.config;
    let favored = -1;
    let boost = 0;
    if (!region.familyRegion) {
      // Prowincja rud: jeden typ z listy pasa dostaje premię w tej okolicy (regiony bez rodzin).
      const pn = fbm2(x / c.provinceScale, y / c.provinceScale, this.seed ^ 0x0E5, 3);
      // Premię dostaje tylko typ z wagą ≥ provinceMinWeight — śladowa domieszka gradientu (np. lód
      // 1% w środku pasa) nie staje się przez prowincję rudą dominującą.
      const minW = c.provinceMinWeight ?? 0;
      let nonzero = 0;
      for (let i = 0; i < comp.length; i++) if (comp[i] >= minW && comp[i] > 0) nonzero++;
      if (nonzero > 1) {
        let slot = Math.min(nonzero - 1, Math.floor(pn * nonzero * 0.999));
        for (let i = 0; i < comp.length; i++) {
          if (comp[i] < minW || comp[i] <= 0) continue;
          if (slot === 0) { favored = i; break; }
          slot--;
        }
      }
      boost = c.provinceStrength * smoothstep(0.35, 0.65, fbm2(x / c.provinceScale + 31.7, y / c.provinceScale - 12.2, this.seed ^ 0x7A1, 2));
    }
    // Rudy rzadkie (kryształ, uran) i średnie (miedź, tytan) głównie w głębi pola.
    let total = 0;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] > 0) {
        const wi = (comp[i] + (i === favored ? boost : 0)) * oreTierFactor(i, depth);
        w[i] = wi;
        total += wi;
      } else {
        w[i] = 0;
      }
    }
    return total;
  }

  /**
   * Udziały typów skał PLAY (≥ REF_DIAMETER) w punkcie → out (po indeksach ROCK_TYPES, suma 1; poza pasem
   * zera); zwraca gęstość PLAY (densityAt). Te same wagi co losowanie typu w komórce (_pickRockType) bez
   * burz: udział rud z głębokości pola, skład regionu i rodzin, prowincje, szczeble rud; wypełniacz kamienny
   * i węglowy. Ekonomia pasa (src/game/traffic/miningFields.js) liczy z tego urobek wypraw i zasób pola.
   */
  typeSharesAt(x, y, out) {
    out.fill(0);
    const m = this.sampleMacro(x, y);
    const density = m.density;
    const region = m.region;
    const depth = m.depth;
    if (!(density > 0)) return 0;
    if (!region) { out[NEUTRAL_TYPE] = 1; return density; }
    const share = oreShareAtDepth(depth);
    const dark = this._composeAt(region, x, y, depth);
    const total = this._oreWeights(region, x, y, depth);
    const w = this._oreW;
    if (total > 0) for (let i = 0; i < w.length; i++) if (w[i] > 0) out[i] = share * w[i] / total;
    const rest = total > 0 ? 1 - share : 1;
    if (dark > 0) out[NEUTRAL_CARBON_TYPE] += rest * dark;
    out[NEUTRAL_TYPE] += rest * (dark > 0 ? 1 - dark : 1);
    return density;
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
  /**
   * Największe wniknięcie [j.] w regiony o podanych `beltId` (> 0 wewnątrz) albo -Infinity, gdy żadnego nie ma —
   * strefy HUD w kształcie regionów (roje Trojańczyków: index.html, detectZones).
   */
  penetrationOf(beltIds, x, y) {
    let best = -Infinity;
    for (let i = 0; i < this.regions.length; i++) {
      const reg = this.regions[i];
      if (!beltIds.includes(reg.beltId)) continue;
      const pen = regionPenetration(reg, x, y);
      if (pen > best) best = pen;
    }
    return best;
  }

  rectTouchesBelt(x0, y0, x1, y1) {
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const half = Math.hypot(x1 - x0, y1 - y0) * 0.5;
    for (let i = 0; i < this.regions.length; i++) {
      // Krawędź regionu (domyślnie edgeWorld; od strony Słońca ringu — edgeIn); wycięcia wokół planet (K-7,
      // port Marsa) są w wniknięciu.
      const reg = this.regions[i];
      let e = reg.edge;
      if (reg.kind === 'ring' && reg.edgeIn !== e && Math.hypot(cx - reg.cx, cy - reg.cy) < (reg.rInner + reg.rOuter) * 0.5) e = reg.edgeIn;
      if (regionPenetration(reg, cx, cy) > -(half + e)) return true;
    }
    const spots = this.wakeSpots;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (s.active && Math.hypot(cx - s.x, cy - s.y) < half + s.r) return true;
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

  // ---------------------------------------------------------------------------
  // Wyrwy po wydobyciu (E3)

  /**
   * Zmiany wyrw: [{ id, x, y, r, depth }] — nowa albo zmieniona wyrwa o tym id; depth ≤ 0 usuwa. Unieważnia
   * komórki cache w prostokącie zmian (z zapasem `reach`) i dopisuje go do `holeDirty` z nową `holeVersion` —
   * warstwy obrazu przeładowują swoje komórki w tym prostokącie. Zwraca liczbę zmian.
   */
  setHoles(list) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    const cfg = BELT_HOLE_CONFIG;
    const box = this._holeBox || (this._holeBox = new Float64Array(4));
    box[0] = Infinity; box[1] = Infinity; box[2] = -Infinity; box[3] = -Infinity;
    const grow = (h) => {
      if (h.x - h.r < box[0]) box[0] = h.x - h.r;
      if (h.y - h.r < box[1]) box[1] = h.y - h.r;
      if (h.x + h.r > box[2]) box[2] = h.x + h.r;
      if (h.y + h.r > box[3]) box[3] = h.y + h.r;
    };
    let changed = 0;
    for (const rec of list) {
      if (!rec || rec.id == null) continue;
      const id = String(rec.id);
      const old = this._holeById.get(id);
      const x = Number(rec.x);
      const y = Number(rec.y);
      const r = Number(rec.r);
      const depth = Math.min(1, Math.max(0, Number(rec.depth) || 0));
      if (!(depth > 0) || !(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
        if (!old) continue;
        this._holeById.delete(id);
        grow(old);
        changed++;
        continue;
      }
      if (old && old.x === x && old.y === y && old.r === r && old.depth === depth) continue;
      if (old) grow(old);
      const hole = { id, x, y, r, depth, seed: (this.seed ^ stringHash32(id)) >>> 0 };
      this._holeById.set(id, hole);
      grow(hole);
      changed++;
    }
    if (!changed) return 0;
    this.holes = [...this._holeById.values()];
    this._holeGrid.clear();
    const g = cfg.grid;
    for (const h of this.holes) {
      const ix0 = Math.floor((h.x - h.r) / g);
      const ix1 = Math.floor((h.x + h.r) / g);
      const iy0 = Math.floor((h.y - h.r) / g);
      const iy1 = Math.floor((h.y + h.r) / g);
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const key = holeGridKey(ix, iy);
          const cell = this._holeGrid.get(key);
          if (cell) cell.push(h); else this._holeGrid.set(key, [h]);
        }
      }
    }
    this._invalidateRect(box[0] - cfg.reach, box[1] - cfg.reach, box[2] + cfg.reach, box[3] + cfg.reach);
    return changed;
  }

  /** Mnożnik gęstości wyrw w punkcie (1 = nietknięte, 0 = pusto). */
  holeFactor(x, y) {
    if (this.holes.length === 0) return 1;
    const cfg = BELT_HOLE_CONFIG;
    const g = cfg.grid;
    const list = this._holeGrid.get(holeGridKey(Math.floor(x / g), Math.floor(y / g)));
    if (!list) return 1;
    let mul = 1;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      const dx = x - h.x;
      const dy = y - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= h.r * h.r) continue;
      // Brzeg między (1 − edgeNoise) r a r, poszarpany szumem w świecie (nie koło z cyrkla).
      const e = 1 - cfg.edgeNoise * fbm2(x / cfg.edgeScale, y / cfg.edgeScale, h.seed, 2);
      const t = Math.sqrt(d2) / h.r;
      if (t >= e) continue;
      const v = 1 - h.depth * (1 - smoothstep(cfg.inner * e, e, t));
      if (v < mul) mul = v;
    }
    return mul;
  }

  /**
   * Czy zmiany wyrw nowsze niż wersja `seen` dotykają prostokąta świata [x0, x1] × [y0, y1] — pamięci obrazu
   * (mgła, mapa pola, skały) przebudowują się tylko przy wyrwie w swoim zasięgu, nie przy każdej w pasie.
   * `light` — także klin cienia pól ZA wyrwą (od słońca, do `lightReach`): tam zmienia się transmitancja.
   * Pominięte prostokąty (`seen` starsza niż pamięć `holeDirty`) — true.
   */
  holesTouch(seen, x0, y0, x1, y1, light = false) {
    const dirty = this.holeDirty;
    if (!dirty.length || dirty[0].v > seen + 1) return this.holeVersion !== seen;
    const reach = BELT_HOLE_CONFIG.lightReach;
    const qx = (x0 + x1) * 0.5 - this.sunX;
    const qy = (y0 + y1) * 0.5 - this.sunY;
    const rq = Math.sqrt(qx * qx + qy * qy);
    const halfQ = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) * 0.5;
    for (let i = 0; i < dirty.length; i++) {
      const d = dirty[i];
      if (d.v <= seen) continue;
      if (!(d.x0 > x1 || d.x1 < x0 || d.y0 > y1 || d.y1 < y0)) return true;
      if (!light) continue;
      const dx = (d.x0 + d.x1) * 0.5 - this.sunX;
      const dy = (d.y0 + d.y1) * 0.5 - this.sunY;
      const rd = Math.sqrt(dx * dx + dy * dy);
      const halfD = Math.sqrt((d.x1 - d.x0) * (d.x1 - d.x0) + (d.y1 - d.y0) * (d.y1 - d.y0)) * 0.5;
      if (rq + halfQ < rd - halfD || rq - halfQ > rd + halfD + reach) continue;
      let da = Math.atan2(qy, qx) - Math.atan2(dy, dx);
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      if (Math.abs(da) <= halfD / Math.max(1, rd) + halfQ / Math.max(1, rq)) return true;
    }
    return false;
  }

  /** Gęstość skał PLAY z wyrwami (densityAt × holeFactor) — skaner, testy. */
  depletedDensityAt(x, y) {
    const d = this.sampleMacro(x, y).density;
    return d > 0 ? d * this.holeFactor(x, y) : d;
  }

  /** Usuwa z cache komórki dotykające prostokąta i zapisuje go w `holeDirty` (nowa `holeVersion`). */
  _invalidateRect(x0, y0, x1, y1) {
    for (const [key, e] of this._cache) {
      if (e.b === undefined) continue;
      const cs = this.bands[e.b].octaves[e.k].cell;
      const ex = e.cx * cs;
      const ey = e.cy * cs;
      if (ex > x1 || ex + cs < x0 || ey > y1 || ey + cs < y0) continue;
      this._cache.delete(key);
    }
    this.holeVersion++;
    this.holeDirty.push({ v: this.holeVersion, x0, y0, x1, y1 });
    if (this.holeDirty.length > BELT_HOLE_CONFIG.dirtyKeep) this.holeDirty.shift();
  }

  get cacheSize() {
    return this._cache.size;
  }
}
