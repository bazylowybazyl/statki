// Ring „Halo” — czysta matematyka, bez Three.js i bez DOM.
//
// Przekrój ringu to JEDEN profil 2D (r, z) obracany wokół osi Z. Z niego
// biorą się podłoga, ściany, kadłub, dach, mapowanie (s, t) i przyszłe
// kolizje — dlatego `floorTilt` nie wymaga przepisywania żadnego modułu.
//
// Współrzędne podłogi:
//   θ — kąt w płaszczyźnie XY sceny (atan2(y, x)), u = θ / 2π ∈ [0, 1)
//   s — długość łuku na promieniu środka podłogi (0 … L)
//   t — pozycja w poprzek podłogi, od dolnej ściany do górnej (rośnie z Z)
//   h — wysokość terenu: przesunięcie PROMIENIOWE „w górę” = σ·r̂
//
// Kierunek habitatu σ: +1 'outward' (habitat w stronę kosmosu, „dół” = ku
// planecie — grawitacja Ziemi), −1 'inward' (klasyczne Halo: habitat do
// planety, „dół” = od osi — siła odśrodkowa). Cała reszta geometrii bierze
// się z σ, więc oba warianty idą przez te same moduły.
import {
  HALO_BIOME_CLIMATE,
  HALO_GEOMETRY_DEFAULTS,
  HALO_LANDSCAPE_BIOMES,
  HALO_LIMITS,
  HALO_SECTOR_MIX,
  HALO_SECTOR_PLAN_16,
  HALO_STATION_ANGLE,
  HALO_TAU,
  HALO_TYPE_CLIMATE,
  computeHaloEnvelope,
  resolveHabitatFacing
} from './haloRingConfig.js';
import { resolveRingPlanetWorldRadius } from '../ringScale.js';

export const GAME_CAMERA_FOV_DEG = 35;
const HALF_FOV_TAN = Math.tan((GAME_CAMERA_FOV_DEG * 0.5) * Math.PI / 180);

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(seed, salt = 0) {
  let h = (Number(seed) | 0) ^ Math.imul(salt | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
const smooth = (t) => t * t * (3 - 2 * t);

function clampToLimit(value, key, fallback) {
  const n = Number(value);
  const lim = HALO_LIMITS[key];
  if (!Number.isFinite(n)) return fallback;
  return lim ? clamp(n, lim[0], lim[1]) : n;
}

// Poziom płaszczyzny gry na podłodze: liczba 0–1 albo 'roof' (układ M1–M5).
export function resolveFlightLevel(value) {
  if (value === 'roof' || value === 'dach' || value === null) return 'roof';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'roof';
  return clamp(n, HALO_LIMITS.flightLevel[0], HALO_LIMITS.flightLevel[1]);
}

// Plan sektorów dla dowolnej liczby: proporcje z HALO_SECTOR_MIX (od
// 2026-09-23 bez sektorów przemysłowych — przemysł tylko wokół doków), bez
// dwóch takich samych typów obok siebie, deterministycznie z seeda. Sektor 0
// (port) to krajobraz górski. Dla 16 — plan ręczny.
export function buildHaloSectorPlan(count, seed) {
  const n = Math.round(clamp(Number(count) || 16, HALO_LIMITS.sectorCount[0], HALO_LIMITS.sectorCount[1]));
  const rand = mulberry32(hashSeed(seed, 0x51c7));
  if (n === 16) {
    return HALO_SECTOR_PLAN_16.map((entry, index) => jitterClimate({ ...entry, index }, rand));
  }
  const kinds = Object.keys(HALO_SECTOR_MIX).filter((type) => HALO_SECTOR_MIX[type] > 0);
  const total = kinds.reduce((sum, type) => sum + HALO_SECTOR_MIX[type], 0);
  const counts = {};
  let assigned = 0;
  for (const type of kinds) {
    counts[type] = Math.max(1, Math.round(n * HALO_SECTOR_MIX[type] / total));
    assigned += counts[type];
  }
  // korekta zaokrągleń na krajobrazie / mieście-ogrodzie
  while (assigned > n) { const k = counts.landscape >= counts.garden ? 'landscape' : 'garden'; counts[k]--; assigned--; }
  while (assigned < n) { const k = counts.landscape <= counts.garden ? 'landscape' : 'garden'; counts[k]++; assigned++; }
  // Zachłannie: zawsze typ z największą resztą, inny niż poprzedni (a na
  // końcu także inny niż pierwszy — ring jest cykliczny).
  const types = ['landscape'];
  counts.landscape--;
  while (types.length < n) {
    const prev = types[types.length - 1];
    const last = types.length === n - 1;
    let pool = Object.keys(counts).filter((type) => counts[type] > 0 && type !== prev && (!last || type !== types[0]));
    if (!pool.length) pool = Object.keys(counts).filter((type) => counts[type] > 0 && type !== prev);
    if (!pool.length) pool = Object.keys(counts).filter((type) => counts[type] > 0);
    let pick = pool[0];
    let best = -1;
    for (const type of pool) {
      const score = counts[type] + rand() * 0.9;
      if (score > best) { best = score; pick = type; }
    }
    counts[pick]--;
    types.push(pick);
  }
  // Gdy zachłanny wybór utknie (szew cyklu), przeplot: posortowany multizbiór
  // na pozycje parzyste, potem nieparzyste — poprawny przy max ≤ n/2 —
  // i obrót tak, żeby krajobraz (port) wypadł na indeksie 0.
  const valid = (arr) => arr.every((type, i) => type !== arr[(i + 1) % n]);
  if (!valid(types)) {
    const total = {};
    for (const type of types) total[type] = (total[type] || 0) + 1;
    const multiset = Object.keys(total).sort((a, b) => total[b] - total[a]).flatMap((type) => Array(total[type]).fill(type));
    const order = [];
    for (let i = 0; i < n; i += 2) order.push(i);
    for (let i = 1; i < n; i += 2) order.push(i);
    const woven = new Array(n);
    order.forEach((pos, k) => { woven[pos] = multiset[k]; });
    const shift = woven.indexOf('landscape');
    types.splice(0, n, ...woven.slice(shift), ...woven.slice(0, shift));
  }
  let biomeIndex = 0;
  const plan = types.map((type, index) => {
    if (index === 0) return { type, name: 'PORT', biome: 'port', port: true, climate: { ...HALO_BIOME_CLIMATE.port } };
    if (type === 'landscape') {
      const biome = HALO_LANDSCAPE_BIOMES[biomeIndex++ % HALO_LANDSCAPE_BIOMES.length];
      return { type, name: biome.toUpperCase(), biome, climate: { ...HALO_BIOME_CLIMATE[biome] } };
    }
    return { type, name: type.toUpperCase(), climate: { ...HALO_TYPE_CLIMATE[type] } };
  });
  return plan.map((entry, index) => jitterClimate({ ...entry, index }, rand));
}

function jitterClimate(entry, rand) {
  const c = entry.climate || {};
  const j = (v, amp) => clamp(v + (rand() - 0.5) * 2 * amp, 0, 1);
  return {
    ...entry,
    climate: {
      sea: j(c.sea ?? 0.25, 0.04),
      mount: j(c.mount ?? 0.3, 0.06),
      temp: j(c.temp ?? 0.6, 0.03),
      moist: j(c.moist ?? 0.6, 0.05)
    }
  };
}

// Rzeki: meandry okresowe wokół ringu (całkowite liczby okresów → brak szwu
// na u = 0/1). Wspólne dla GLSL (uniformy) i JS (rozstawianie mostów w M4).
function buildRivers(seed) {
  const rand = mulberry32(hashSeed(seed, 0x21e5));
  const rivers = [];
  const bands = [0.33, 0.52, 0.7];
  for (let i = 0; i < bands.length; i++) {
    rivers.push({
      center: bands[i] + (rand() - 0.5) * 0.06,
      // [okresy na obwód, amplituda (ułamek szerokości), faza]
      m1: [7 + Math.floor(rand() * 5), 0.045 + rand() * 0.03, rand() * HALO_TAU],
      m2: [23 + Math.floor(rand() * 11), 0.018 + rand() * 0.014, rand() * HALO_TAU],
      m3: [61 + Math.floor(rand() * 29), 0.006 + rand() * 0.006, rand() * HALO_TAU],
      width: 70 + rand() * 60,
      phase: rand()
    });
  }
  return rivers;
}

export function riverCenterV(river, u) {
  const a = HALO_TAU * u;
  return river.center
    + river.m1[1] * Math.sin(a * river.m1[0] + river.m1[2])
    + river.m2[1] * Math.sin(a * river.m2[0] + river.m2[2])
    + river.m3[1] * Math.sin(a * river.m3[0] + river.m3[2]);
}

export function computeGameCameraHeight(zoom, viewportHeight = 1080) {
  const z = Math.max(0.0001, Number(zoom) || 1);
  return (Math.max(1, Number(viewportHeight) || 1080) * 0.5) / HALF_FOV_TAN / z;
}

// Wzór z briefu §5.4: kamera nad środkiem planety widzi pas podłogi
// d·W/(h+W) − H (w jednostkach świata na płaszczyźnie z = 0).
export function habitatVisibleStripBrief(floorRadius, width, wallHeight, cameraHeight) {
  return floorRadius * width / (cameraHeight + width) - wallHeight;
}

export function createHaloRingLayout(options = {}) {
  const g = HALO_GEOMETRY_DEFAULTS;
  const planetRadius = Math.max(2000, Number(options.planetRadius) || g.planetRadius);
  const seed = (Number(options.seed) >>> 0) || 1337;
  const width = clampToLimit(options.width, 'width', g.width);
  const wallHeight = clampToLimit(options.wallHeight, 'wallHeight', g.wallHeight);
  const floorTiltDeg = clampToLimit(options.floorTiltDeg, 'floorTiltDeg', g.floorTiltDeg);
  const hullThickness = Number(options.hullThickness) || g.hullThickness;
  const wallThickness = Number(options.wallThickness) || g.wallThickness;
  const roofDetailMax = Number.isFinite(Number(options.roofDetailMax)) ? Number(options.roofDetailMax) : g.roofDetailMax;
  const sectorCount = Math.round(clampToLimit(options.sectorCount, 'sectorCount', g.sectorCount));
  const minHullAtTilt = Number(options.minHullAtTilt) || g.minHullAtTilt;

  const facing = resolveHabitatFacing(options.habitatFacing ?? g.habitatFacing);
  const sigma = facing === 'outward' ? 1 : -1;

  // Promienie. Do planety: kadłub na zewnętrznej granicy obwiedni, podłoga
  // pod nim, krawędź ścian ku osi. Na zewnątrz: krawędź ścian na zewnętrznej
  // granicy obwiedni (habitat możliwie daleko od planety), podłoga niżej,
  // kadłub-megastruktura od strony planety. Obie wersje mieszczą się w tej
  // samej obwiedni 41 202–43 752, więc strefy orbit i spawn się nie zmieniają.
  const envelope = computeHaloEnvelope(planetRadius);
  let rim;
  let floorBase;
  let back;
  if (sigma < 0) {
    back = envelope.outerRadius;
    floorBase = back - hullThickness;
    rim = floorBase - wallHeight;
  } else {
    rim = envelope.outerRadius;
    floorBase = rim - wallHeight;
    back = floorBase - hullThickness;
  }
  const rMin = Math.min(rim, back);
  const rMax = Math.max(rim, back);

  // Z: płaszczyzna gry (z = 0) przecina podłogę na wysokości flightLevel
  // (0 = górna ściana, 0,5 = środek wstęgi — domyślnie od 2026-09-23: doki
  // wpięte w podłogę na środku, rozgrywka „na środku ringu”). 'roof' = układ
  // M1–M5: detale dachu do z = 0, spód na z = −W (cała wstęga pod statkami).
  const flightLevel = resolveFlightLevel(options.flightLevel ?? (sigma > 0 ? g.flightLevel : 'roof'));
  const floorSpanZ = width - roofDetailMax - 2 * wallThickness;
  const zShift = flightLevel === 'roof' ? 0 : roofDetailMax + wallThickness + flightLevel * floorSpanZ;
  const zRoof = zShift - roofDetailMax;
  const zTopIn = zRoof - wallThickness;
  const zBottom = zShift - width;
  const zBotIn = zBottom + wallThickness;

  // Pochylenie podłogi: normalna = (σ·cos τ, sin τ), czyli ku powietrzu
  // i ku kamerze gry (+Z). Idąc w górę podłogi (ku górnej ścianie) promień
  // zmienia się o −σ·tan τ; krawędź przy górnej ścianie nie może zjeść
  // kadłuba poniżej minHullAtTilt.
  const tilt = floorTiltDeg * Math.PI / 180;
  const halfDr = 0.5 * floorSpanZ * Math.tan(tilt);
  let floorMid = floorBase;
  if (halfDr > 0 && sigma * (floorMid - sigma * halfDr - back) < minHullAtTilt) {
    floorMid = back + sigma * (minHullAtTilt + halfDr);
  }
  const floorTop = floorMid - sigma * halfDr;
  const floorBottom = floorMid + sigma * halfDr;
  const floorDr = floorTop - floorBottom;
  const floorLength = Math.hypot(floorDr, floorSpanZ);
  const floorTangent = { r: floorDr / floorLength, z: floorSpanZ / floorLength };
  const floorNormal = { r: sigma * floorTangent.z, z: -sigma * floorTangent.r }; // ku powietrzu
  const floorSlope = floorDr / floorSpanZ; // dr/dz

  // Planeta równikowo względem wstęgi (w grze planeta jest ortho — jej z nic
  // nie zmienia na ekranie). Na środku: środek planety w płaszczyźnie gry.
  const planetCenterZ = flightLevel === 'roof' ? -width * 0.5 : (zTopIn + zBotIn) * 0.5;
  const circumference = HALO_TAU * floorMid;

  // Profil zamknięty, obchodzony zgodnie z ruchem wskazówek zegara w (r, z):
  // bryła leży po prawej stronie kierunku, normalna zewnętrzna = (−dz, dr).
  let vertices;
  let edgeKinds;
  if (sigma < 0) {
    vertices = [
      { r: floorBottom, z: zBotIn },   // podłoga × dolna ściana
      { r: floorTop, z: zTopIn },      // podłoga × górna ściana
      { r: rim, z: zTopIn },           // krawędź górnej ściany (od środka)
      { r: rim, z: zRoof },            // krawędź górnej ściany (dach)
      { r: back, z: zRoof },           // dach × kadłub
      { r: back, z: zBottom },         // kadłub × spód
      { r: rim, z: zBottom },          // krawędź dolnej ściany (spód)
      { r: rim, z: zBotIn }            // krawędź dolnej ściany (od środka)
    ];
    edgeKinds = ['floor', 'wallTopInner', 'rimTop', 'roof', 'hull', 'underside', 'rimBottom', 'wallBottomInner'];
  } else {
    vertices = [
      { r: floorTop, z: zTopIn },      // podłoga × górna ściana
      { r: floorBottom, z: zBotIn },   // podłoga × dolna ściana
      { r: rim, z: zBotIn },           // krawędź dolnej ściany (od środka)
      { r: rim, z: zBottom },          // krawędź dolnej ściany (spód)
      { r: back, z: zBottom },         // spód × kadłub od strony planety
      { r: back, z: zRoof },           // kadłub × dach
      { r: rim, z: zRoof },            // krawędź górnej ściany (dach)
      { r: rim, z: zTopIn }            // krawędź górnej ściany (od środka)
    ];
    edgeKinds = ['floor', 'wallBottomInner', 'rimBottom', 'underside', 'hull', 'roof', 'rimTop', 'wallTopInner'];
  }
  const edges = edgeKinds.map((kind, i) => {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dr = b.r - a.r;
    const dz = b.z - a.z;
    const len = Math.hypot(dr, dz);
    return { kind, index: i, a, b, length: len, normal: { r: -dz / len, z: dr / len } };
  });

  const plan = buildHaloSectorPlan(sectorCount, seed);
  const sectorSpan = HALO_TAU / plan.length;
  const sectorStart = HALO_STATION_ANGLE - sectorSpan * 0.5;
  const sectors = plan.map((entry, index) => {
    const start = sectorStart + index * sectorSpan;
    return {
      ...entry,
      index,
      startAngle: wrapAngle(start),
      endAngle: wrapAngle(start + sectorSpan),
      centerAngle: wrapAngle(start + sectorSpan * 0.5),
      span: sectorSpan,
      length: sectorSpan * floorMid
    };
  });

  const rivers = buildRivers(seed);
  const rand = mulberry32(hashSeed(seed, 0x0ff5e7));
  const noiseOffset = [rand() * 1000, rand() * 1000, rand() * 1000, rand() * 1000];

  // ---- funkcje -----------------------------------------------------------
  const angleToU = (theta) => wrapAngle(theta) / HALO_TAU;
  const uToAngle = (u) => u * HALO_TAU;
  const floorRadiusAtT = (t) => floorBottom + floorTangent.r * t;
  const floorZAtT = (t) => zBotIn + floorTangent.z * t;
  const floorRadiusAtZ = (z) => floorMid + (z - (zTopIn + zBotIn) * 0.5) * floorSlope;

  function floorPoint(s, t, h = 0, out = {}) {
    const theta = s / floorMid;
    const r = floorRadiusAtT(t) + sigma * h;
    out.x = r * Math.cos(theta);
    out.y = r * Math.sin(theta);
    out.z = floorZAtT(t);
    return out;
  }

  // Świat (lokalny układ ringu) → współrzędne podłogi. alt = wysokość nad
  // bazową podłogą (promieniowo, w kierunku σ·r̂), bez terenu.
  // `out` opcjonalny — wywołania co klatkę podają własny obiekt (bez alokacji).
  function worldToFloor(x, y, z, out = {}) {
    const theta = wrapAngle(Math.atan2(y, x));
    const r = Math.hypot(x, y);
    const t = (z - zBotIn) / floorTangent.z;
    out.theta = theta;
    out.u = theta / HALO_TAU;
    out.s = theta * floorMid;
    out.t = t;
    out.v = t / floorLength;
    out.alt = sigma * (r - floorRadiusAtZ(z));
    out.r = r;
    return out;
  }

  function isInsideAir(x, y, z) {
    const r = Math.hypot(x, y);
    return z > zBotIn && z < zTopIn && sigma * (r - floorRadiusAtZ(z)) > 0 && sigma * (rim - r) > 0;
  }

  function sectorIndexAt(theta) {
    const rel = wrapAngle(theta - sectorStart);
    return Math.min(plan.length - 1, Math.floor(rel / sectorSpan));
  }

  // Wagi typów sektorów (bez szumu granic — lustro GLSL do rozstawiania
  // obiektów; przejścia na ~⅓ sektora, brief §7).
  function sectorBlendAt(theta) {
    const x = wrapAngle(theta - sectorStart) / sectorSpan;
    const k = Math.floor(x) % plan.length;
    const f = x - Math.floor(x);
    const b = 1 / 6;
    const out = [{ index: k, weight: 1 }];
    if (f < b) {
      const a = smooth(clamp((f + b) / (2 * b), 0, 1));
      out[0].weight = a;
      out.push({ index: (k - 1 + plan.length) % plan.length, weight: 1 - a });
    } else if (f > 1 - b) {
      const a = smooth(clamp((f - (1 - b)) / (2 * b), 0, 1));
      out[0].weight = 1 - a;
      out.push({ index: (k + 1) % plan.length, weight: a });
    }
    return out;
  }

  // Rzut punktu profilu (r, z) na płaszczyznę z = 0 z kamery gry (persp)
  // stojącej na promieniu c, wysokość h, patrzącej pionowo w dół.
  // Punkt nad kamerą (flightLevel < 'roof', duży zoom) leży za nią — rzut
  // „w nieskończoność” w tę samą stronę (nic nie zasłania).
  const proj = (r, z, c, h) => c + (r - c) * (h - z > 1 ? h / (h - z) : 1e6);

  // Pas podłogi widoczny z kamery gry (dokładna geometria; brief §5.4).
  // Do planety: kamera nad otworem (c < rim), podłoga między rzutem jej
  // dolnej krawędzi a krawędzią dachu. Na zewnątrz: kamera poza ringiem
  // (c > rim), to samo lustrzanie — widać z obszaru rozgrywki.
  function habitatVisibleStrip(cameraHeight, cameraRadius = 0) {
    const h = Math.max(1, cameraHeight);
    const c = Number(cameraRadius) || 0;
    return sigma * (proj(floorBottom, zBotIn, c, h) - proj(rim, zRoof, c, h));
  }

  // Dolna ściana od środka (normalna +Z, brief §5.5): część, której nie
  // zasłania górna ściana (dach) patrząc z kamery gry.
  function bottomWallVisibleStrip(cameraHeight, cameraRadius) {
    const h = Math.max(1, cameraHeight);
    const c = Number(cameraRadius) || 0;
    const wallFloorSide = proj(floorBottom, zBotIn, c, h);
    const wallRimSide = proj(rim, zBotIn, c, h);
    const roofEdge = proj(rim, zRoof, c, h);
    if (sigma < 0) return Math.max(0, Math.min(wallFloorSide, roofEdge) - wallRimSide);
    return Math.max(0, wallRimSide - Math.max(wallFloorSide, roofEdge));
  }

  return Object.freeze({
    seed,
    planetRadius,
    width,
    wallHeight,
    wallThickness,
    hullThickness,
    roofDetailMax,
    floorTiltDeg,
    floorTilt: tilt,
    flightLevel,
    zShift,
    facing,
    sigma,
    envelope,
    // back = powierzchnia kadłuba-megastruktury (hull — nazwa zgodna z M1–M2),
    // min/max = promieniowy zasięg bryły (ściany zajmują cały przedział)
    radii: Object.freeze({ rim, floorBase, floorMid, floorTop, floorBottom, back, hull: back, min: rMin, max: rMax }),
    // top = szczyt detali dachu; floorMid = środek podłogi (z = 0 przy flightLevel 0,5)
    z: Object.freeze({ roof: zRoof, topIn: zTopIn, botIn: zBotIn, bottom: zBottom, top: zShift, floorMid: (zTopIn + zBotIn) * 0.5 }),
    planetCenterZ,
    circumference,
    floor: Object.freeze({
      length: floorLength,
      spanZ: floorSpanZ,
      tangent: Object.freeze(floorTangent),
      normal: Object.freeze(floorNormal),
      slope: floorSlope,
      bottom: Object.freeze({ r: floorBottom, z: zBotIn }),
      top: Object.freeze({ r: floorTop, z: zTopIn })
    }),
    profile: Object.freeze({ vertices: Object.freeze(vertices), edges: Object.freeze(edges) }),
    sectors: Object.freeze(sectors),
    sectorSpan,
    sectorStart,
    rivers: Object.freeze(rivers),
    noiseOffset: Object.freeze(noiseOffset),
    // obwiednia do porównań z portem (brief §4)
    bounds: Object.freeze({
      innerRadius: rMin,
      outerRadius: rMax,
      insideEnvelope: rMin >= envelope.innerRadius - 1e-6 && rMax <= envelope.outerRadius + 1e-6,
      zMin: zBottom,
      zMax: zShift
    }),
    angleToU,
    uToAngle,
    floorRadiusAtT,
    floorZAtT,
    floorRadiusAtZ,
    floorPoint,
    worldToFloor,
    isInsideAir,
    sectorIndexAt,
    sectorBlendAt,
    habitatVisibleStrip,
    bottomWallVisibleStrip,
    habitatVisibleStripBrief: (cameraHeight) => habitatVisibleStripBrief(floorMid, width, wallHeight, cameraHeight)
  });
}

// Getter obwiedni zgodny z polami computePlanetaryRingLayout — do podmiany
// przy porcie (strefy orbit, spawn, CIC, testy scaleTuning liczą się z tego).
export function computeHaloRingLayout(planetOrRadius) {
  return computeHaloEnvelope(resolveRingPlanetWorldRadius(planetOrRadius));
}
