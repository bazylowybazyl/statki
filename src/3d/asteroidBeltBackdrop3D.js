/**
 * AsteroidBeltBackdrop3D — dekoracyjne tło 3D pasów asteroid pod warstwą gameplayu.
 *
 * Czysto wizualny system (zero fizyki, zero interakcji) renderowany na warstwie 1
 * (background perspective pass w core3d), czyli POD ortho-warstwą gameplayu i pod
 * sprite'owym polem asteroid (AsteroidField, Z=-120). Skały leżą w płycie
 * Z ∈ [-BACKDROP_Z_NEAR, -BACKDROP_Z_FAR], więc kamera perspektywiczna daje im
 * naturalną paralaksę względem warstwy grywalnej.
 *
 * Strategia wydajnościowa:
 *   - 6 proceduralnych brył skał (displaced icosahedron, flat shading, pseudo-AO
 *     w vertex colors). Zero assetów z dysku.
 *   - Jeden InstancedMesh per wariant geometrii, sloty kompaktowane swap-remove
 *     (mesh.count == liczba żywych skał — GPU nie mieli pustych slotów).
 *   - Świat dzielony na chunki CHUNK_SIZE; zawartość chunka w 100% deterministyczna
 *     z seeda (nic nie jest trzymane poza aktywnym zestawem wokół kamery).
 *   - Streaming z throttlingiem (czas / ruch kamery), upload buforów tylko przy
 *     zmianie zestawu chunków — nigdy per-frame.
 *   - Depth cueing w shaderze: im głębiej w Z, tym ciemniej i bardziej we mgle.
 *
 * Immersja pasa (dla ambientu sceny):
 *   - beltImmersionAt() zwraca 0..1: 0 na krawędzi/poza pasem, 1 głęboko w środku.
 *   - Klasa wygładza to w czasie; getAmbientDim() konsumuje pętla 2D (index.html)
 *     do przyciemnienia całej sceny, a opacity pyłu rośnie razem z immersją.
 *     Wlatujesz głębiej -> ciemniej + mgła; wylatujesz -> jaśniej.
 *
 * Regiony pasów liczone są z tych samych BELT_DEFINITIONS i pozycji planet co
 * AsteroidField w chwili inicjalizacji, więc tło pokrywa się z grywalnym polem.
 */

import * as THREE from 'three';
import { BELT_DEFINITIONS } from '../data/asteroidTypes.js';

export const CHUNK_SIZE = 9000;
// Tło musi leżeć wyraźnie za warstwą gameplayu. Przy poprzednim Z_NEAR=520
// rzadka duża skała zajmowała przy zoomie 1 niemal cały ekran, a przy zoom-in
// kamera praktycznie wlatywała w jej bryłę (czarna ściana z widocznym tylko HUD).
export const BACKDROP_Z_NEAR = 3000;  // dodatnie głębokości (świat: z = -3000)
export const BACKDROP_Z_FAR = 10000;
export const ROCK_VARIANTS = 6;
export const MAX_ACTIVE_CHUNKS = 48;
// Chunk ma 9000u i jest oglądany perspektywicznie przez kilka warstw głębokości.
// Gęstość dobrana wizualnie: pole ma czytać się jako "jesteś w pasie", ale tło
// nie może konkurować z warstwą grywalną o uwagę.
export const ROCKS_PER_CHUNK_BASE = 26;
export const ROCKS_PER_CHUNK_CAP = 44;
export const IMMERSION_RAMP_AU = 2.5;
export const ROCK_RADIUS_MIN = 28;
export const ROCK_RADIUS_MAX = 520;
// Rzadkie GIGANTY — pojedyncze bryły wielkości małej planety, w osobnym,
// najgłębszym pasmie Z (wolniejsza paralaksa, mocniej zamglone sylwetki).
export const GIANT_ROCK_CHANCE = 0.05;
export const GIANT_RADIUS_MIN = 1500;
export const GIANT_RADIUS_MAX = 4500;
export const GIANT_Z_NEAR = 9000;
export const GIANT_Z_FAR = 16000;
export const DUST_Z_NEAR = 3200;
export const DUST_Z_FAR = 7400;
export const DUST_SIZE_MIN = 1400;
export const DUST_SIZE_MAX = 4200;
// Pył WebGL: addytywne billboardy (świecą, nie zaciemniają). Wcześniejsze
// wyłączenie było mylną diagnozą — "czarna zasłona" pochodziła z NaN w vertex
// colors skał (patrz makeRockGeometry), co potwierdziła bisekcja na żywo.
export const WEBGL_DUST_ENABLED = true;
// Fade całej warstwy po szerokości widoku w world units (zoom-out => tło znika,
// bo skały i tak byłyby subpikselowe, a streaming musiałby pokryć ogromny obszar).
export const ZOOM_FADE_START_WORLD_W = 60000;
export const ZOOM_FADE_END_WORLD_W = 110000;

const DUST_CAPACITY = 96;
const ROCK_POOL_CAPACITY = [1300, 1300, 1300, 1300, 420, 420]; // 4-5 = duże bryły (gęstsza siatka)
export const BIG_ROCK_RADIUS = 140;

// ================= Deterministyczny RNG =================

/** Mulberry32 — szybki deterministyczny generator [0..1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stabilny seed per chunk (współrzędne całkowite chunka + seed świata). */
export function hashChunkSeed(cx, cy, seed) {
  let h = (seed >>> 0) ^ Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ================= Regiony pasów =================

const BELT_PALETTES = {
  // ciepła skała (żelazo/krzem) — Main Belt, Greeks, Trojans, Hildas
  rock: {
    tintA: [0.70, 0.60, 0.50],
    tintB: [1.00, 0.92, 0.82],
    // Pył renderowany ADDYTYWNIE (świeci, nigdy nie zaciemnia) — wartości to
    // delikatna luminancja mgławicowa, nie albedo.
    dust: [0.085, 0.066, 0.048],
  },
  // lodowy Kuiper
  ice: {
    tintA: [0.58, 0.66, 0.78],
    tintB: [0.84, 0.93, 1.04],
    dust: [0.050, 0.068, 0.095],
  },
};

function paletteForBelt(beltId) {
  return beltId === 'kuiper' ? BELT_PALETTES.ice : BELT_PALETTES.rock;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function resolvePlanetPos(planet, sunX, sunY, au) {
  if (!planet) return null;
  const x = Number.isFinite(planet.x)
    ? planet.x
    : sunX + Math.cos(planet.angle || 0) * (planet.orbitRadius || (planet.orbitAU || 0) * au);
  const y = Number.isFinite(planet.y)
    ? planet.y
    : sunY + Math.sin(planet.angle || 0) * (planet.orbitRadius || (planet.orbitAU || 0) * au);
  return { x, y };
}

/**
 * Zamienia BELT_DEFINITIONS na geometryczne regiony w 2D world space.
 * Pozycje planet (kotwice Lagrange/Hildas) zamrażane w chwili wywołania —
 * dokładnie tak samo robi AsteroidField przy generacji, więc tło i grywalne
 * pole zawsze się pokrywają.
 *
 * Region: { kind:'ring', cx, cy, rInner, rOuter } lub
 *         { kind:'arc', cx, cy, rMid, rHalf, angMid, angHalf }
 * plus wspólne: beltId, density (względna gęstość skał), maxHalf (najgłębsze
 * możliwe wniknięcie — do normalizacji immersji), tintA/tintB/dust (paleta).
 */
export function computeBeltRegions(beltDefs, { planets = [], sunX = 0, sunY = 0, auToWorld = 3000 } = {}) {
  const au = auToWorld;
  const regions = [];
  const findPlanet = (id) => {
    if (!id) return null;
    for (const p of planets) {
      if (p && (p.id === id || p.name === id)) return p;
    }
    return null;
  };

  for (const belt of beltDefs || []) {
    const pal = paletteForBelt(belt.id);
    const common = {
      beltId: belt.id,
      tintA: pal.tintA,
      tintB: pal.tintB,
      dust: pal.dust,
    };

    if (belt.shape === 'ring') {
      const rInner = belt.innerAU * au;
      const rOuter = belt.outerAU * au;
      // Względna gęstość z definicji (count / pole pierścienia), znormalizowana
      // do rzędu 1 i przycięta — tło ma sugerować gęstość, nie ją odtwarzać.
      const areaAU2 = Math.PI * (belt.outerAU * belt.outerAU - belt.innerAU * belt.innerAU);
      const perAU2 = areaAU2 > 0 ? belt.count / areaAU2 : 0;
      regions.push({
        ...common,
        kind: 'ring',
        cx: sunX, cy: sunY,
        rInner, rOuter,
        density: Math.min(2.2, Math.max(0.35, perAU2 / 78)),
        maxHalf: (rOuter - rInner) / 2,
      });
      continue;
    }

    if (belt.shape === 'lagrange') {
      const planet = resolvePlanetPos(findPlanet(belt.anchorPlanet), sunX, sunY, au);
      if (!planet) continue;
      const px = planet.x - sunX;
      const py = planet.y - sunY;
      const rMid = Math.hypot(px, py);
      if (rMid < 1) continue;
      const offset = belt.lagrange === 'L4' ? +Math.PI / 3 : -Math.PI / 3;
      const angHalf = (belt.arcSpread || 0.3) * 0.5 + 0.02;
      const rHalf = (belt.spreadAU || 4) * au * 0.5;
      regions.push({
        ...common,
        kind: 'arc',
        cx: sunX, cy: sunY,
        rMid, rHalf,
        angMid: Math.atan2(py, px) + offset,
        angHalf,
        density: 1.35,
        maxHalf: Math.min(rHalf, angHalf * rMid),
      });
      continue;
    }

    if (belt.shape === 'triangle') {
      const planet = resolvePlanetPos(findPlanet(belt.anchorPlanet), sunX, sunY, au);
      const px = (planet ? planet.x : sunX) - sunX;
      const py = (planet ? planet.y : sunY) - sunY;
      const planetAngle = Math.atan2(py, px);
      const rMid = (belt.radiusAU || 42) * au;
      const rHalf = (belt.spreadAU || 3) * au * 0.5;
      const angHalf = 0.17;
      for (let k = 0; k < 3; k++) {
        regions.push({
          ...common,
          kind: 'arc',
          cx: sunX, cy: sunY,
          rMid, rHalf,
          angMid: planetAngle + k * (Math.PI * 2 / 3),
          angHalf,
          density: 1.1,
          maxHalf: Math.min(rHalf, angHalf * rMid),
        });
      }
      continue;
    }
  }
  return regions;
}

/**
 * Głębokość wniknięcia punktu w region, w world units.
 * > 0 wewnątrz (odległość od najbliższej krawędzi), <= 0 na zewnątrz.
 */
export function regionPenetration(region, x, y) {
  const dx = x - region.cx;
  const dy = y - region.cy;
  const r = Math.hypot(dx, dy);
  if (region.kind === 'ring') {
    return Math.min(r - region.rInner, region.rOuter - r);
  }
  // arc: metryka radialna i styczna (kątowa przeskalowana na world units)
  const radial = region.rHalf - Math.abs(r - region.rMid);
  const dAng = Math.abs(wrapAngle(Math.atan2(dy, dx) - region.angMid));
  const tangential = (region.angHalf - dAng) * region.rMid;
  return Math.min(radial, tangential);
}

/**
 * Immersja 0..1 — jak głęboko punkt siedzi w którymkolwiek pasie.
 * Rampa: pełna immersja po min(rampWorld, maxHalf regionu) w głąb od krawędzi.
 * Wyjście przepuszczone przez smoothstep (miękkie wejście/wyjście).
 */
export function beltImmersionAt(regions, x, y, rampWorld) {
  let best = 0;
  for (const region of regions) {
    const pen = regionPenetration(region, x, y);
    if (pen <= 0) continue;
    const ramp = Math.max(1, Math.min(rampWorld, region.maxHalf));
    const t = Math.min(1, pen / ramp);
    if (t > best) best = t;
  }
  return best * best * (3 - 2 * best);
}

/** Fade warstwy po szerokości widoku w world units (1 = pełna widoczność). */
export function computeBackdropZoomFade(viewWorldW) {
  const t = (viewWorldW - ZOOM_FADE_START_WORLD_W) / (ZOOM_FADE_END_WORLD_W - ZOOM_FADE_START_WORLD_W);
  const c = Math.min(1, Math.max(0, t));
  return 1 - c * c * (3 - 2 * c);
}

/** Łączny fade warstwy: zoom-out oraz płynne wejście/wyjście z pasa. */
export function computeBackdropVisibility(zoomFade, immersion) {
  const z = Math.min(1, Math.max(0, Number(zoomFade) || 0));
  const i = Math.min(1, Math.max(0, Number(immersion) || 0));
  const beltFade = i * i * (3 - 2 * i);
  return z * beltFade;
}

/**
 * Zestaw chunków potrzebnych dla kamery. Rect widoku liczony na najgłębszej
 * płaszczyźnie skał (kamera perspektywiczna widzi tam szerzej niż na Z=0),
 * filtrowany po przecięciu z regionami, sortowany po odległości, przycięty capem.
 *
 * @param cam {x, y, zoom} — kamera gry (2D world space)
 * @returns Array<{cx, cy, key}>
 */
export function chunksForView(cam, viewW, viewH, regions, opts = {}) {
  const chunk = opts.chunkSize || CHUNK_SIZE;
  const cap = opts.maxChunks || MAX_ACTIVE_CHUNKS;
  const fovDeg = opts.fovDeg || 35;
  const deepZ = opts.deepZ || BACKDROP_Z_FAR;
  const zoom = Math.max(1e-4, cam.zoom || 1);

  const camZ = (viewH / 2) / Math.tan(fovDeg * Math.PI / 360) / zoom;
  const ratio = (camZ + deepZ) / camZ;
  const halfW = (viewW / 2 / zoom) * ratio + chunk * 0.6;
  const halfH = (viewH / 2 / zoom) * ratio + chunk * 0.6;

  const cx0 = Math.floor((cam.x - halfW) / chunk);
  const cx1 = Math.floor((cam.x + halfW) / chunk);
  const cy0 = Math.floor((cam.y - halfH) / chunk);
  const cy1 = Math.floor((cam.y + halfH) / chunk);

  // Bezpiecznik na ekstremalny zoom-out — zanim zadziała zoomFade.
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return [];

  const chunkR = chunk * 0.7071;
  const out = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const centerX = (cx + 0.5) * chunk;
      const centerY = (cy + 0.5) * chunk;
      let near = false;
      for (const region of regions) {
        if (regionPenetration(region, centerX, centerY) > -chunkR * 1.4) { near = true; break; }
      }
      if (!near) continue;
      const dx = centerX - cam.x;
      const dy = centerY - cam.y;
      out.push({ cx, cy, key: cx + ',' + cy, d2: dx * dx + dy * dy });
    }
  }
  out.sort((a, b) => a.d2 - b.d2);
  if (out.length > cap) out.length = cap;
  return out;
}

/**
 * Deterministyczny plan zawartości chunka: skały + giganty + pył.
 * Czysta funkcja — te same argumenty dają zawsze ten sam wynik.
 *
 * Skała/gigant: { x, y (2D world), z (dodatnia głębokość), radius, variant,
 *                 rotX/rotY/rotZ, sx/sy/sz (mnożniki skali), tint:[r,g,b] }
 * Pył:          { x, y, z, size, rotZ, tint:[r,g,b] }
 */
export function planChunkContent(cx, cy, regions, seed, opts = {}) {
  const chunk = opts.chunkSize || CHUNK_SIZE;
  const base = opts.rocksPerChunk || ROCKS_PER_CHUNK_BASE;
  const cap = opts.rocksPerChunkCap || ROCKS_PER_CHUNK_CAP;
  const rng = mulberry32(hashChunkSeed(cx, cy, seed));
  const x0 = cx * chunk;
  const y0 = cy * chunk;

  // Region dominujący (najgłębsze wniknięcie środka chunka) daje gęstość i paletę.
  const centerX = x0 + chunk * 0.5;
  const centerY = y0 + chunk * 0.5;
  let domRegion = null;
  let domPen = -Infinity;
  for (const region of regions) {
    const pen = regionPenetration(region, centerX, centerY);
    if (pen > domPen) { domPen = pen; domRegion = region; }
  }

  const rocks = [];
  const giants = [];
  const dust = [];
  if (!domRegion) return { rocks, giants, dust };

  const attempts = Math.min(cap, Math.round(base * domRegion.density));
  for (let i = 0; i < attempts; i++) {
    const x = x0 + rng() * chunk;
    const y = y0 + rng() * chunk;
    // Odrzucanie poza pasem — naturalnie przerzedza chunki na krawędzi regionu.
    let inside = false;
    for (const region of regions) {
      if (regionPenetration(region, x, y) > 0) { inside = true; break; }
    }
    // rng() zużywane zawsze w tej samej liczbie — determinizm niezależny od gałęzi.
    const rScale = rng();
    const rBig = rng();
    const rVar = rng();
    const rz = rng();
    const rRotX = rng();
    const rRotY = rng();
    const rRotZ = rng();
    const rSquashA = rng();
    const rSquashB = rng();
    const rTint = rng();
    const rTintJitter = rng();
    if (!inside) continue;

    // pow(x, 3): dużo drobnicy, pojedyncze naprawdę duże bryły.
    let radius = ROCK_RADIUS_MIN + (ROCK_RADIUS_MAX - ROCK_RADIUS_MIN) * Math.pow(rScale, 3.0);
    if (rBig < 0.03) radius *= 1.25;
    radius = Math.min(ROCK_RADIUS_MAX, radius);
    const variant = radius > BIG_ROCK_RADIUS
      ? 4 + Math.floor(rVar * 2)
      : Math.floor(rVar * 4);
    const tA = domRegion.tintA;
    const tB = domRegion.tintB;
    const jitter = 0.92 + rTintJitter * 0.16;
    rocks.push({
      x, y,
      z: BACKDROP_Z_NEAR + rz * (BACKDROP_Z_FAR - BACKDROP_Z_NEAR),
      radius,
      variant,
      rotX: rRotX * Math.PI * 2,
      rotY: rRotY * Math.PI * 2,
      rotZ: rRotZ * Math.PI * 2,
      sx: 0.78 + rSquashA * 0.5,
      sy: 0.78 + rSquashB * 0.5,
      sz: 0.78 + (rSquashA + rSquashB) * 0.25,
      tint: [
        (tA[0] + (tB[0] - tA[0]) * rTint) * jitter,
        (tA[1] + (tB[1] - tA[1]) * rTint) * jitter,
        (tA[2] + (tB[2] - tA[2]) * rTint) * jitter,
      ],
    });
  }

  // Rzadki GIGANT — samotna bryła wielkości małej planety w najgłębszym pasmie.
  // Wszystkie rng() ciągnięte bezwarunkowo — determinizm niezależny od gałęzi.
  const gRoll = rng();
  const gX = rng();
  const gY = rng();
  const gRad = rng();
  const gZ = rng();
  const gRotX = rng();
  const gRotY = rng();
  const gRotZ = rng();
  const gVar = rng();
  const gTint = rng();
  if (gRoll < GIANT_ROCK_CHANCE) {
    const x = x0 + gX * chunk;
    const y = y0 + gY * chunk;
    let inside = false;
    for (const region of regions) {
      if (regionPenetration(region, x, y) > 0) { inside = true; break; }
    }
    if (inside) {
      const tA = domRegion.tintA;
      const tB = domRegion.tintB;
      giants.push({
        x, y,
        z: GIANT_Z_NEAR + gZ * (GIANT_Z_FAR - GIANT_Z_NEAR),
        radius: GIANT_RADIUS_MIN + gRad * (GIANT_RADIUS_MAX - GIANT_RADIUS_MIN),
        variant: 4 + Math.floor(gVar * 2),
        rotX: gRotX * Math.PI * 2,
        rotY: gRotY * Math.PI * 2,
        rotZ: gRotZ * Math.PI * 2,
        sx: 0.9, sy: 0.9, sz: 0.9,
        tint: [
          (tA[0] + (tB[0] - tA[0]) * gTint) * 0.92,
          (tA[1] + (tB[1] - tA[1]) * gTint) * 0.92,
          (tA[2] + (tB[2] - tA[2]) * gTint) * 0.92,
        ],
      });
    }
  }

  // 0-2 płaty pyłu per chunk.
  const dustCount = rng() < 0.45 ? 2 : (rng() < 0.8 ? 1 : 0);
  for (let i = 0; i < dustCount; i++) {
    const x = x0 + rng() * chunk;
    const y = y0 + rng() * chunk;
    const rSize = rng();
    const rz = rng();
    const rRot = rng();
    const rShade = rng();
    let inside = false;
    for (const region of regions) {
      if (regionPenetration(region, x, y) > 0) { inside = true; break; }
    }
    if (!inside) continue;
    const d = domRegion.dust;
    const shade = 0.75 + rShade * 0.5;
    dust.push({
      x, y,
      z: DUST_Z_NEAR + rz * (DUST_Z_FAR - DUST_Z_NEAR),
      size: DUST_SIZE_MIN + rSize * (DUST_SIZE_MAX - DUST_SIZE_MIN),
      rotZ: rRot * Math.PI * 2,
      tint: [d[0] * shade, d[1] * shade, d[2] * shade],
    });
  }

  return { rocks, giants, dust };
}

// ================= Proceduralna geometria skał =================

function latticeHash(ix, iy, iz, seed) {
  let h = (seed >>> 0) ^ Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(iz | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Trójwymiarowy value noise [0..1] na siatce całkowitej. */
export function valueNoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smootherstep(x - ix), fy = smootherstep(y - iy), fz = smootherstep(z - iz);
  let result = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        result += w * latticeHash(ix + dx, iy + dy, iz + dz, seed);
      }
    }
  }
  return result;
}

function fbm3(x, y, z, seed, octaves) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/**
 * Bryła skały: icosahedron z displacem po fbm + pseudo-AO w vertex colors
 * (ciemniej we wgłębieniach). Non-indexed => flat shading po computeVertexNormals.
 * Eksport na potrzeby testów: każda wartość position/normal/color MUSI być
 * skończona — patrz komentarz o NaN przy obliczaniu AO.
 */
export function makeRockGeometry(seed, detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const radii = new Float32Array(pos.count);
  let rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(v.x * 1.7 + 9.1, v.y * 1.7 + 3.7, v.z * 1.7 + 5.3, seed, 3);
    const r = 1 + (n - 0.5) * 0.78;
    radii[i] = r;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  const span = Math.max(1e-6, rMax - rMin);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // KRYTYCZNY clamp: radii to Float32Array, a rMin ma pełną precyzję float64.
    // Dla wierzchołka-minimum zaokrąglenie do float32 potrafi zejść PONIŻEJ rMin,
    // wtedy ao = -epsilon, a Math.pow(ujemna, 1.15) = NaN. Jeden NaN w vertex
    // colors truje piksele HDR, a bloom rozmazuje NaN w czarne bloki na pół
    // ekranu (tak wyglądał "czarny prostokąt" przy wlocie w pas).
    const ao = Math.min(1, Math.max(0, (radii[i] - rMin) / span));
    const c = 0.55 + 0.5 * Math.pow(ao, 1.15);
    colors[i * 3] = c; colors[i * 3 + 1] = c; colors[i * 3 + 2] = c;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ================= Tekstury (canvas, tylko browser) =================

function makeRockTexture(seed) {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Próbkujemy szum w przestrzeni kafelkowalnej (torus) — bez szwów.
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6;
      const nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
      let t = fbm3(nx + nz * 0.7, ny + nw * 0.7, nz - nx * 0.3, seed, 4);
      t = Math.pow(Math.min(1, Math.max(0, (t - 0.28) / 0.5)), 1.1);
      const v = Math.round(120 + t * 135);
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 2;
  return tex;
}

function makeDustTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.09)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ================= Shader skał =================

const ROCK_VERTEX = /* glsl */`
  attribute vec3 color;
  attribute vec3 rockTint;
  varying vec3 vNormalW;
  varying vec3 vNormalObj;
  varying vec3 vObjPos;
  varying vec3 vTint;
  varying float vDepth;
  void main() {
    vObjPos = position;
    vNormalObj = normal;
    vTint = color * rockTint;
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 wp = modelMatrix * p;
    vNormalW = normalize(mat3(modelMatrix) * n);
    vDepth = -wp.z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ROCK_FRAGMENT = /* glsl */`
  uniform sampler2D uTex;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform vec2 uFogRange;
  uniform float uFade;
  varying vec3 vNormalW;
  varying vec3 vNormalObj;
  varying vec3 vObjPos;
  varying vec3 vTint;
  varying float vDepth;
  void main() {
    // Triplanar w object space — brak UV, brak szwów.
    vec3 bw = abs(normalize(vNormalObj));
    bw = bw * bw * bw;
    bw /= (bw.x + bw.y + bw.z + 1e-5);
    float k = 0.85;
    float t = texture2D(uTex, vObjPos.yz * k).r * bw.x
            + texture2D(uTex, vObjPos.zx * k).r * bw.y
            + texture2D(uTex, vObjPos.xy * k).r * bw.z;
    vec3 nrm = normalize(vNormalW);
    float lam = max(dot(nrm, uSunDir), 0.0);
    vec3 albedo = vTint * (0.55 + 0.65 * t);
    vec3 col = albedo * (uAmbient + uSunColor * lam);
    // Depth cueing: im głębiej pod płaszczyzną gry, tym ciemniej i bardziej we mgle
    // — ale nigdy do czerni: sylwetka musi czytać się na tle kosmosu.
    float fogT = smoothstep(uFogRange.x, uFogRange.y, vDepth);
    col = mix(col, uFogColor, fogT * 0.55);
    col *= mix(1.0, 0.80, fogT);
    // Opaque screen-door fade: nie wpuszczamy częściowej alfy do wspólnego
    // render targetu Core3D. Stabilny dithering daje płynne wejście bez czarnej
    // pełnoekranowej alfy przy późniejszym blitowaniu na Canvas 2D.
    float fade = clamp(uFade, 0.0, 1.0);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (fade <= 0.0 || dither > fade) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ================= Pool slotów (kompaktowany) =================

class SlotPool {
  constructor(capacity) {
    this.capacity = capacity;
    this.count = 0;
    this.slotChunk = new Array(capacity).fill(null);
  }
  allocate(chunkKey) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.slotChunk[i] = chunkKey;
    return i;
  }
  /** Zwalnia wszystkie sloty chunka; moveSlot(from, to) przenosi dane instancji. */
  freeChunk(chunkKey, moveSlot) {
    let removed = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.slotChunk[i] !== chunkKey) continue;
      const last = this.count - 1;
      if (i !== last) {
        moveSlot(last, i);
        this.slotChunk[i] = this.slotChunk[last];
      }
      this.slotChunk[last] = null;
      this.count = last;
      removed++;
    }
    return removed;
  }
}

// ================= Główna klasa =================

const _MAT = new THREE.Matrix4();
const _POS = new THREE.Vector3();
const _QUAT = new THREE.Quaternion();
const _SCALE = new THREE.Vector3();
const _EULER = new THREE.Euler();
const _noopRaycast = () => {};

export class AsteroidBeltBackdrop {
  constructor(opts = {}) {
    this.seed = (opts.seed != null ? opts.seed : 0xB4CD07) >>> 0;
    this.scene = opts.scene || null;
    this.auToWorld = Number(opts.auToWorld) > 0 ? Number(opts.auToWorld) : 3000;
    this.fovDeg = Number(opts.fovDeg) > 0 ? Number(opts.fovDeg) : 35;
    const sun = opts.sun || (typeof window !== 'undefined' ? window.SUN : null);
    this.regions = computeBeltRegions(opts.beltDefs || BELT_DEFINITIONS, {
      planets: Array.isArray(opts.planets) ? opts.planets : [],
      sunX: Number.isFinite(sun?.x) ? sun.x : 0,
      sunY: Number.isFinite(sun?.y) ? sun.y : 0,
      auToWorld: this.auToWorld,
    });
    this.rampWorld = IMMERSION_RAMP_AU * this.auToWorld;

    this.immersion = 0;       // wygładzona immersja pasa (0..1)
    this.zoomFade = 1;        // fade po zoomie (0..1)
    this.visibility = 0;      // fade łączny: zoom + zanurzenie w pasie
    this._loadedChunks = new Map(); // key -> true (zawartość odtwarzalna z seeda)
    this._lastStreamTime = -Infinity;
    this._lastStreamX = Infinity;
    this._lastStreamY = Infinity;
    this._lastStreamZoom = -1;
    this._time = 0;

    this.group = new THREE.Group();
    this.group.name = 'asteroidBeltBackdrop';

    // --- Materiał skał (wspólny dla wszystkich pul) ---
    this.rockTexture = makeRockTexture(this.seed ^ 0x51CA7);
    this.rockMaterial = new THREE.ShaderMaterial({
      vertexShader: ROCK_VERTEX,
      fragmentShader: ROCK_FRAGMENT,
      uniforms: {
        uTex: { value: this.rockTexture },
        uSunDir: { value: new THREE.Vector3(30000, 20000, 45000).normalize() },
        uSunColor: { value: new THREE.Vector3(1.55, 1.45, 1.30) },
        uAmbient: { value: new THREE.Vector3(0.42, 0.45, 0.52) },
        uFogColor: { value: new THREE.Vector3(0.12, 0.16, 0.24) },
        // Mgła głębi rozciągnięta aż po pasmo gigantów — giganty mają czytać
        // się jako zamglone sylwetki, nie ostre bryły.
        uFogRange: { value: new THREE.Vector2(BACKDROP_Z_NEAR - 20, GIANT_Z_FAR + 400) },
        uFade: { value: 0 },
      },
      transparent: false,
      // Background nie może zostawiać depth dla żadnej alternatywnej ścieżki
      // Core3D (direct/refraction). Główny composer czyści depth między passami,
      // ale ten belt-only bezpiecznik gwarantuje, że skały nigdy nie wytną gameplayu.
      depthWrite: false,
      depthTest: true,
    });

    // --- Pule skał: 6 wariantów geometrii, warianty 4-5 gęstsze (duże bryły) ---
    this.rockPools = [];
    for (let vIdx = 0; vIdx < ROCK_VARIANTS; vIdx++) {
      const capacity = ROCK_POOL_CAPACITY[vIdx];
      const detail = vIdx >= 4 ? 2 : 1;
      const baseGeo = makeRockGeometry(this.seed + vIdx * 7919, detail);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', baseGeo.getAttribute('position'));
      geo.setAttribute('normal', baseGeo.getAttribute('normal'));
      geo.setAttribute('color', baseGeo.getAttribute('color'));
      const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      tintAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('rockTint', tintAttr);

      const mesh = new THREE.InstancedMesh(geo, this.rockMaterial, capacity);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = _noopRaycast;
      mesh.renderOrder = 0;
      this.group.add(mesh);
      this.rockPools.push({ mesh, slots: new SlotPool(capacity), tintAttr, dirty: false });
    }

    // --- Pył (miękkie billboardy, opacity sterowane immersją) ---
    // ADDITIVE: mgła w kosmosie musi delikatnie świecić — normal blending z ciemnym
    // kolorem dawał wielkie przyciemniające prostokąty ("czarna ściana" przy wlocie).
    this.dustTexture = makeDustTexture();
    this.dustMaterial = new THREE.MeshBasicMaterial({
      map: this.dustTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    this.dustMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.dustMaterial, DUST_CAPACITY);
    this.dustMesh.count = 0;
    this.dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dustMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DUST_CAPACITY * 3), 3);
    this.dustMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.dustMesh.frustumCulled = false;
    this.dustMesh.raycast = _noopRaycast;
    this.dustMesh.renderOrder = 1;
    this.dustMesh.visible = WEBGL_DUST_ENABLED;
    this.group.add(this.dustMesh);
    this.dustSlots = new SlotPool(DUST_CAPACITY);
    this._dustDirty = false;

    // Cała grupa na warstwie tła (layer 1 = background perspective pass w core3d).
    this.group.traverse((child) => { child.layers.set(1); });

    if (this.scene) this.scene.add(this.group);
  }

  /** Przyciemnienie ambientu sceny 0..1 (konsumowane przez overlay 2D w pętli gry). */
  getAmbientDim() {
    return this.immersion;
  }

  /**
   * @param dt sekundy
   * @param cam {x, y, zoom} — kamera gry (bez shake — streaming nie powinien drgać)
   * @param shipPos {x, y} — pozycja statku gracza (immersja podąża za statkiem)
   * @param viewW/viewH — rozmiar viewportu w px
   */
  update(dt, cam, shipPos, viewW, viewH) {
    if (!cam) return;
    const step = Math.min(0.25, Math.max(0, Number(dt) || 0));
    this._time += step;

    // --- Immersja: cel z pozycji statku, wygładzanie wykładnicze ---
    const probe = shipPos && Number.isFinite(shipPos.x) ? shipPos : cam;
    const target = beltImmersionAt(this.regions, probe.x, probe.y, this.rampWorld);
    this.immersion += (target - this.immersion) * (1 - Math.exp(-1.6 * step));
    if (Math.abs(target - this.immersion) < 0.001) this.immersion = target;

    // --- Fade po zoomie ---
    const zoom = Math.max(1e-4, cam.zoom || 1);
    const w = Math.max(1, viewW || 1920);
    const h = Math.max(1, viewH || 1080);
    this.zoomFade = computeBackdropZoomFade(w / zoom);

    this.visibility = computeBackdropVisibility(this.zoomFade, this.immersion);
    this.rockMaterial.uniforms.uFade.value = this.visibility;
    this.dustMaterial.opacity = WEBGL_DUST_ENABLED ? this.visibility * 0.5 : 0;
    const anythingVisible = this.visibility > 0.002;
    this.group.visible = anythingVisible;
    if (!anythingVisible) return;

    // --- Streaming chunków (throttling: czas / ruch / zmiana zooma) ---
    const moved = Math.hypot(cam.x - this._lastStreamX, cam.y - this._lastStreamY);
    const zoomChanged = this._lastStreamZoom > 0
      ? Math.abs(zoom - this._lastStreamZoom) / this._lastStreamZoom > 0.12
      : true;
    if (this._time - this._lastStreamTime > 0.22 || moved > CHUNK_SIZE * 0.35 || zoomChanged) {
      this._stream(cam, w, h);
      this._lastStreamTime = this._time;
      this._lastStreamX = cam.x;
      this._lastStreamY = cam.y;
      this._lastStreamZoom = zoom;
    }
  }

  _stream(cam, viewW, viewH) {
    const needed = chunksForView(cam, viewW, viewH, this.regions, {
      fovDeg: this.fovDeg,
      // Rect pokrycia liczony na płaszczyźnie gigantów (najgłębszej) — inaczej
      // wielka bryła przy krawędzi kadru wystawałaby poza streamowany obszar.
      deepZ: GIANT_Z_FAR,
    });
    const neededKeys = new Set();
    for (const c of needed) neededKeys.add(c.key);

    // Unload chunków poza zestawem.
    for (const key of this._loadedChunks.keys()) {
      if (neededKeys.has(key)) continue;
      for (const pool of this.rockPools) {
        if (pool.slots.freeChunk(key, (from, to) => this._moveRockSlot(pool, from, to)) > 0) {
          pool.dirty = true;
        }
      }
      if (this.dustSlots.freeChunk(key, (from, to) => this._moveDustSlot(from, to)) > 0) {
        this._dustDirty = true;
      }
      this._loadedChunks.delete(key);
    }

    // Load nowych (posortowane po odległości — najbliższe mają priorytet na sloty).
    for (const c of needed) {
      if (this._loadedChunks.has(c.key)) continue;
      this._loadChunk(c);
      this._loadedChunks.set(c.key, true);
    }

    // Upload buforów tylko dla dotkniętych pul.
    for (const pool of this.rockPools) {
      if (!pool.dirty) continue;
      pool.mesh.count = pool.slots.count;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.tintAttr.needsUpdate = true;
      pool.dirty = false;
    }
    if (this._dustDirty) {
      this.dustMesh.count = this.dustSlots.count;
      this.dustMesh.instanceMatrix.needsUpdate = true;
      this.dustMesh.instanceColor.needsUpdate = true;
      this._dustDirty = false;
    }
  }

  _loadChunk(chunk) {
    const { rocks, giants, dust } = planChunkContent(chunk.cx, chunk.cy, this.regions, this.seed);
    for (const list of [rocks, giants]) {
      for (const rock of list) {
        const pool = this.rockPools[rock.variant];
        const slot = pool.slots.allocate(chunk.key);
        if (slot < 0) continue;
        _POS.set(rock.x, -rock.y, -rock.z);
        _EULER.set(rock.rotX, rock.rotY, rock.rotZ);
        _QUAT.setFromEuler(_EULER);
        _SCALE.set(rock.radius * rock.sx, rock.radius * rock.sy, rock.radius * rock.sz);
        _MAT.compose(_POS, _QUAT, _SCALE);
        pool.mesh.setMatrixAt(slot, _MAT);
        pool.tintAttr.array[slot * 3] = rock.tint[0];
        pool.tintAttr.array[slot * 3 + 1] = rock.tint[1];
        pool.tintAttr.array[slot * 3 + 2] = rock.tint[2];
        pool.dirty = true;
      }
    }
    if (WEBGL_DUST_ENABLED) for (const puff of dust) {
      const slot = this.dustSlots.allocate(chunk.key);
      if (slot < 0) continue;
      _POS.set(puff.x, -puff.y, -puff.z);
      _EULER.set(0, 0, puff.rotZ);
      _QUAT.setFromEuler(_EULER);
      _SCALE.set(puff.size, puff.size, 1);
      _MAT.compose(_POS, _QUAT, _SCALE);
      this.dustMesh.setMatrixAt(slot, _MAT);
      this.dustMesh.instanceColor.array[slot * 3] = puff.tint[0];
      this.dustMesh.instanceColor.array[slot * 3 + 1] = puff.tint[1];
      this.dustMesh.instanceColor.array[slot * 3 + 2] = puff.tint[2];
      this._dustDirty = true;
    }
  }

  _moveRockSlot(pool, from, to) {
    const m = pool.mesh.instanceMatrix.array;
    m.copyWithin(to * 16, from * 16, from * 16 + 16);
    const t = pool.tintAttr.array;
    t.copyWithin(to * 3, from * 3, from * 3 + 3);
  }

  _moveDustSlot(from, to) {
    const m = this.dustMesh.instanceMatrix.array;
    m.copyWithin(to * 16, from * 16, from * 16 + 16);
    const c = this.dustMesh.instanceColor.array;
    c.copyWithin(to * 3, from * 3, from * 3 + 3);
  }

  dispose() {
    if (this.scene) this.scene.remove(this.group);
    for (const pool of this.rockPools) {
      pool.mesh.geometry.dispose();
      pool.mesh.dispose();
    }
    this.dustMesh.geometry.dispose();
    this.dustMesh.dispose();
    this.rockMaterial.dispose();
    this.dustMaterial.dispose();
    if (this.rockTexture) this.rockTexture.dispose();
    if (this.dustTexture) this.dustTexture.dispose();
    this.rockPools.length = 0;
    this._loadedChunks.clear();
  }
}
