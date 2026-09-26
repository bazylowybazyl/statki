// src/3d/rocks/rockShapes3D.js
//
// Bank kształtów skał: proceduralne bryły gwiaździste (promień jako funkcja
// kierunku), pieczone RAZ przy starcie na GPU do tablicy tekstur w mapowaniu
// oktaedrycznym. Jedna warstwa = jeden kształt.
//
//   shapeTexA (RGBA16F): x = promień (1 = nominalny), yzw = normalna obiektu
//   shapeTexB (RGBA8):   r = AO, g = krater (wnętrze), b = zmienność albedo,
//                        a = wypukłość (grzbiety 1, zagłębienia 0)
//
// Siatki LOD są WSPÓLNE dla wszystkich kształtów (sfera z podzielonego
// oktaedru) — shader wierzchołków czyta promień z mapy, więc jeden draw call
// obsłuży dowolną mieszankę kształtów. Kopia promienia w niskiej rozdzielczości
// wraca na CPU (`radiusMaps`): sylwetki do kolizji 2D, dyski cienia i przyszłe
// ciała destruktora 3D (bryła gwiaździsta: punkt p jest w środku, gdy
// |p| < promień(p/|p|)).
//
// Konwencja tekseli: środki tekseli leżą NA krawędziach kwadratu oktaedru
// (uv = i / (N − 1)), więc filtr dwuliniowy przez zagięcie mapy jest ciągły
// (wartości na krawędzi są wspólne dla obu stron). Próbkowanie:
// uvTex = (uv · (N − 1) + 0,5) / N — patrz ROCK_OCT_GLSL.
//
// Renderer: wyłącznie Core3D.renderer (zasada AGENTS.md: jeden WebGLRenderer).

import * as THREE from 'three';
import { SHAPE_COUNT, SHAPE_VARIANTS, FAMILY } from '../../game/asteroidRockKinds.js';

export const ROCK_SHAPE_DEFAULTS = Object.freeze({
  count: SHAPE_COUNT,
  size: 256,
  readbackSize: 48,
  craters: 40,
  facets: 10,
  lobes: 10,
  seed: 0x0A57E7
});

// Promień w mapie odczytu (RG8 = 16 bitów) kodowany w tym przedziale.
export const RADIUS_CODE_MIN = 0.25;
export const RADIUS_CODE_MAX = 1.75;
// Po pieczeniu kształt jest skalowany: średni promień 1, ale najdalszy punkt
// najwyżej ROCK_MAX_RADIUS (czubek skały gry pod płaszczyzną, sylwetki, zapas
// w kolizjach) — owal nie może wystawać 2× poza koło skały.
export const ROCK_MAX_RADIUS = 1.45;

// ---------------------------------------------------------------------------
// Mapowanie oktaedryczne (CPU — lustro ROCK_OCT_GLSL)

export function octEncode(x, y, z, out = { u: 0, v: 0 }) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let px = x / s;
  let py = y / s;
  if (z / s < 0) {
    const ox = px;
    px = (1 - Math.abs(py)) * (ox >= 0 ? 1 : -1);
    py = (1 - Math.abs(ox)) * (py >= 0 ? 1 : -1);
  }
  out.u = px * 0.5 + 0.5;
  out.v = py * 0.5 + 0.5;
  return out;
}

export function octDecode(u, v, out = { x: 0, y: 0, z: 1 }) {
  let fx = u * 2 - 1;
  let fy = v * 2 - 1;
  const fz = 1 - Math.abs(fx) - Math.abs(fy);
  const t = Math.max(-fz, 0);
  fx += fx >= 0 ? -t : t;
  fy += fy >= 0 ? -t : t;
  const len = Math.hypot(fx, fy, fz) || 1;
  out.x = fx / len;
  out.y = fy / len;
  out.z = fz / len;
  return out;
}

export const ROCK_OCT_GLSL = /* glsl */`
vec2 rockOctEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 p = n.xy;
  if (n.z < 0.0) {
    p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  }
  return p * 0.5 + 0.5;
}
vec3 rockOctDecode(vec2 uv) {
  vec2 f = uv * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
// uv kierunku → współrzędna tekstury przy środkach tekseli na krawędziach.
vec2 rockOctTexUv(vec3 dir, float size) {
  return (rockOctEncode(dir) * (size - 1.0) + 0.5) / size;
}
`;

const _texelWeights = new Map();

/**
 * Kąt bryłowy tekseli mapy oktaedrycznej R×R (środki na krawędziach
 * kwadratu) — do średniej po kierunkach. Liczony raz na rozmiar.
 */
export function octTexelWeights(R) {
  let w = _texelWeights.get(R);
  if (w) return w;
  w = new Float32Array(R * R);
  const a = { x: 0, y: 0, z: 1 };
  const b = { x: 0, y: 0, z: 1 };
  const c = { x: 0, y: 0, z: 1 };
  const d = { x: 0, y: 0, z: 1 };
  const h = 0.5 / (R - 1);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const u = x / (R - 1);
      const v = y / (R - 1);
      octDecode(clamp(u - h), v, a);
      octDecode(clamp(u + h), v, b);
      octDecode(u, clamp(v - h), c);
      octDecode(u, clamp(v + h), d);
      const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
      const vx = d.x - c.x; const vy = d.y - c.y; const vz = d.z - c.z;
      w[y * R + x] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
  }
  _texelWeights.set(R, w);
  return w;
}

// ---------------------------------------------------------------------------
// Parametry kształtów (deterministyczne, CPU)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rng) {
  const z = rng() * 2 - 1;
  const phi = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

function smaxCpu(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (a - b) / k));
  return a * h + b * (1 - h) + k * h * (1 - h);
}

/** Promień bryły bazowej na CPU (bez szumu i kraterów) — do normalizacji przed pieczeniem. */
function baseShapeRadiusCpu(p, d) {
  let r;
  if (p.lobes.length) {
    r = 0;
    for (const L of p.lobes) {
      const b = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
      const disc = b * b - (L[0] * L[0] + L[1] * L[1] + L[2] * L[2] - L[3] * L[3]);
      if (disc > 0) r = r === 0 ? b + Math.sqrt(disc) : smaxCpu(r, b + Math.sqrt(disc), p.lobeK);
    }
    r = Math.max(r, 0.2);
  } else {
    r = 1 / Math.hypot(d[0] / p.elong[0], d[1] / p.elong[1], d[2] / p.elong[2]);
  }
  r += p.eqRidge[0] * Math.exp(-((d[2] / p.eqRidge[1]) ** 2));
  for (const f of p.facets) {
    const c = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (c > 0.08) r = Math.min(r, f[3] / c);
  }
  return r;
}

/**
 * Parametry jednego kształtu. Rodzina = floor(index / SHAPE_VARIANTS)
 * (asteroidRockKinds.ROCK_FAMILIES): bryła, kanciasta, kraterowana,
 * z grzbietem, owalna, podwójna (dwa płaty ze smukłą szyjką), dysk
 * (spłaszczony z grzbietem równikowym), odłam (kilka wielkich płaszczyzn
 * pęknięcia), gruzowisko (rdzeń obsypany głazami), wielki krater.
 */
export function makeRockShapeParams(index, seed = ROCK_SHAPE_DEFAULTS.seed, opts = {}) {
  const craterCap = opts.craters ?? ROCK_SHAPE_DEFAULTS.craters;
  const facetCap = opts.facets ?? ROCK_SHAPE_DEFAULTS.facets;
  const lobeCap = opts.lobes ?? ROCK_SHAPE_DEFAULTS.lobes;
  const rng = mulberry32((seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0);
  const family = Math.floor(index / SHAPE_VARIANTS);
  const F = FAMILY;
  const pick = (table) => table[family] ?? table[0];
  // Przedziały per rodzina (kolejność = ROCK_FAMILIES).
  const lumpAmp = pick([0.30, 0.22, 0.24, 0.30, 0.13, 0.12, 0.12, 0.12, 0.10, 0.14]) + rng() * pick([0.14, 0.12, 0.12, 0.1, 0.07, 0.06, 0.06, 0.06, 0.06, 0.06]);
  const lumpFreq = 0.85 + rng() * 0.6;
  const ridgeAmp = pick([0.05, 0.08, 0.04, 0.11, 0.03, 0.03, 0.03, 0.05, 0.03, 0.04]) + rng() * 0.05;
  const ridgeFreq = 1.6 + rng() * 1.4;
  const offset = [rng() * 97, rng() * 97, rng() * 97];
  // Wydłużenie pieczone w kształt — instancja dokłada swoje (sx, sy, sz).
  const elong = [1, 1, 1];
  const axis = Math.floor(rng() * 3);
  if (family === F.oval) {
    elong[axis] += 0.75 + rng() * 0.65;
    elong[(axis + 1) % 3] += rng() * 0.2;
  } else if (family === F.disc) {
    elong[0] = elong[1] = 1.15 + rng() * 0.12;
    elong[2] = 0.5 + rng() * 0.12;
  } else {
    const e = family === F.ridged ? 0.25 + rng() * 0.25 : (family === F.shard ? 0.1 + rng() * 0.35 : rng() * 0.18);
    elong[axis] += e;
  }
  // Grzbiet równikowy (dysk jak Pan/Atlas przy Saturnie): amplituda, szerokość w d.z.
  const eqRidge = family === F.disc ? [0.08 + rng() * 0.07, 0.1 + rng() * 0.06] : [0, 0.1];
  // Płaty (gwiaździsta otoczka sfer): podwójna = dwa płaty, gruzowisko = rdzeń + głazy.
  const lobes = [];
  let lobeK = 0.1;
  if (family === F.binary) {
    const rA = 0.64 + rng() * 0.1;
    const rB = 0.5 + rng() * 0.16;
    // Szyjka: oba płaty zawierają środek (otoczka gwiaździsta bez „cieni”),
    // środki daleko (0,65–0,9 promienia) — wyraźne przewężenie.
    const cA = rA * (0.64 + rng() * 0.16);
    const cB = rB * (0.74 + rng() * 0.16);
    const tilt = (rng() - 0.5) * 0.5;
    lobes.push([-cA * Math.cos(tilt), -cA * Math.sin(tilt), 0, rA]);
    lobes.push([cB * Math.cos(tilt), cB * Math.sin(tilt), (rng() - 0.5) * 0.12, rB]);
    lobeK = 0.05 + rng() * 0.06;
  } else if (family === F.rubble) {
    const core = 0.72 + rng() * 0.08;
    lobes.push([0, 0, 0, core]);
    const n = Math.min(lobeCap - 1, 5 + Math.floor(rng() * 5));
    for (let i = 0; i < n; i++) {
      const u = randomUnit(rng);
      const rb = 0.2 + rng() * 0.22;
      // Głaz osadzony: styczna z rdzenia krótsza niż jego promień (gładka otoczka).
      const dist = Math.min(Math.sqrt(core * core + rb * rb) * 0.97, core * (0.78 + rng() * 0.2));
      lobes.push([u[0] * dist, u[1] * dist, u[2] * dist, rb]);
    }
    lobeK = 0.05 + rng() * 0.05;
  }
  const facetCount = family === F.shard ? Math.min(facetCap, 7 + Math.floor(rng() * 3))
    : family === F.angular ? Math.min(facetCap, 6)
      : Math.floor(rng() * 5);
  const facets = [];
  for (let i = 0; i < facetCount; i++) {
    const n = randomUnit(rng);
    const w = family === F.shard ? 0.5 + rng() * 0.28 : (family === F.angular ? 0.7 : 0.8) + rng() * 0.16;
    facets.push([n[0], n[1], n[2], w]);
  }
  const facetK = family === F.shard ? 0.025 : 0.07;
  const craterShare = pick([0.45, 0.35, 1.0, 0.55, 0.4, 0.45, 0.35, 0.2, 0.3, 0.45]);
  const craterCount = Math.max(6, Math.round(craterCap * (craterShare + rng() * 0.2)));
  const craters = [];
  if (family === F.bowl) {
    // Jeden krater na pół bryły (jak Stickney na Fobosie) — misa z wałem.
    const c = randomUnit(rng);
    const angle = 0.85 + rng() * 0.3;
    craters.push([c[0], c[1], c[2], angle, angle * (0.4 + rng() * 0.08), angle * 0.08, 0.7 + rng() * 0.3]);
  }
  while (craters.length < Math.min(craterCap, craterCount)) {
    const c = randomUnit(rng);
    // Rozkład potęgowy rozmiarów: dużo małych, kilka dużych (kąt w radianach).
    const u = rng();
    const ang = 0.05 * Math.pow(1 - u * 0.985, -0.75);
    const angle = Math.min(family === F.shard ? 0.35 : 0.75, ang);
    const depth = angle * (0.22 + rng() * 0.16);
    const rim = angle * (0.03 + rng() * 0.05);
    const fresh = rng();
    craters.push([c[0], c[1], c[2], angle, depth, rim, fresh]);
  }
  const p = { index, family, lumpAmp, lumpFreq, ridgeAmp, ridgeFreq, offset, elong, facets, facetK, lobes, lobeK, eqRidge, craters, scale: 1 };
  // Wstępna normalizacja bryły bazowej (bez szumu): średnia ~1, najdalszy punkt
  // z zapasem na garby — żeby promień zmieścił się w kodowaniu odczytu.
  // Dokładną skalę daje odczyt po pieczeniu (RockShapeBank._normalize).
  let sum = 0;
  let max = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = i * 2.399963229728653;
    const r = baseShapeRadiusCpu(p, [rr * Math.cos(phi), rr * Math.sin(phi), z]);
    sum += r;
    if (r > max) max = r;
  }
  const mean = sum / N;
  const peak = max * (1 + 0.6 * lumpAmp) + 0.6 * ridgeAmp;
  p.scale = Math.min(1 / mean, 1.5 / peak);
  return p;
}

// ---------------------------------------------------------------------------
// GLSL kształtu (pieczenie)

const BAKE_VERTEX = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Pieczenie w trzech lekkich przejściach (ANGLE → HLSL rozwija pętle i wkleja
// funkcje: shader wołający kształt 5–13 razy kompilował się sekundami):
//  1) PROC: kształt RAZ na teksel → cel pośredni (promień, krater, promień
//     bazowy, zmienność albedo);
//  2) NORMAL: normalna z różnic promienia w celu pośrednim → shapeTexA;
//  3) MASK: AO i wypukłość z pierścieni próbek celu pośredniego → shapeTexB.
function procFragment(craterCap, facetCap, lobeCap) {
  return /* glsl */`
precision highp float;
uniform float uSize;
uniform vec3 uOffset;
uniform float uLumpAmp;
uniform float uLumpFreq;
uniform float uRidgeAmp;
uniform float uRidgeFreq;
uniform vec3 uElong;
uniform float uScale;
uniform vec2 uEqRidge;                  // x amplituda, y szerokość (d.z)
uniform int uLobeCount;
uniform vec4 uLobes[${lobeCap}];        // xyz środek płata, w promień
uniform float uLobeK;
uniform int uFacetCount;
uniform vec4 uFacets[${facetCap}];
uniform float uFacetK;
uniform int uCraterCount;
uniform vec4 uCraterA[${craterCap}];   // xyz kierunek, w kąt
uniform vec4 uCraterB[${craterCap}];   // x głębokość, y wał, z świeżość, w cos(zasięgu)
${ROCK_OCT_GLSL}

float rhash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(rhash(i), rhash(i + vec3(1, 0, 0)), f.x),
                 mix(rhash(i + vec3(0, 1, 0)), rhash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rhash(i + vec3(0, 0, 1)), rhash(i + vec3(1, 0, 1)), f.x),
                 mix(rhash(i + vec3(0, 1, 1)), rhash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = p * 2.07 + vec3(13.1, 7.3, 3.7);
    a *= 0.5;
  }
  return s / n;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

// Promień niskiej częstotliwości (bryła bez kraterów i ziarna) — do AO.
float baseRadius(vec3 d) {
  float r;
  if (uLobeCount > 0) {
    // Płaty: gwiaździsta otoczka sfer (dalszy punkt przecięcia promienia),
    // zszyte gładkim max — szyjka podwójnej, głazy gruzowiska.
    r = 0.0;
    for (int i = 0; i < ${lobeCap}; i++) {
      if (i >= uLobeCount) break;
      vec4 L = uLobes[i];
      float b = dot(d, L.xyz);
      float disc = b * b - (dot(L.xyz, L.xyz) - L.w * L.w);
      if (disc > 0.0) {
        float t = b + sqrt(disc);
        r = r == 0.0 ? t : smax(r, t, uLobeK);
      }
    }
    r = max(r, 0.2);
  } else {
    r = 1.0 / length(d / uElong);
  }
  r += uEqRidge.x * exp(-(d.z * d.z) / (uEqRidge.y * uEqRidge.y));
  float lump = fbm3(d * uLumpFreq + uOffset, 4);
  r *= 1.0 + (lump - 0.5) * 2.0 * uLumpAmp;
  float rn = vnoise(d * uRidgeFreq + uOffset.yzx);
  float ridge = 1.0 - abs(rn * 2.0 - 1.0);
  r += (ridge * ridge - 0.4) * uRidgeAmp;
  for (int i = 0; i < ${facetCap}; i++) {
    if (i >= uFacetCount) break;
    vec4 pl = uFacets[i];
    float c = dot(d, pl.xyz);
    if (c > 0.08) r = smin(r, pl.w / c, uFacetK);
  }
  return r * uScale;
}

float fullRadius(vec3 d, out float craterMask, out float fresh) {
  float r = baseRadius(d);
  craterMask = 0.0;
  fresh = 0.0;
  for (int i = 0; i < ${craterCap}; i++) {
    if (i >= uCraterCount) break;
    vec4 ca = uCraterA[i];
    vec4 cb = uCraterB[i];
    float cosd = dot(d, ca.xyz);
    if (cosd < cb.w) continue;
    float t = acos(clamp(cosd, -1.0, 1.0)) / ca.w;
    // Misa (paraboloida) do wału, wał gaussem za krawędzią.
    float bowl = t < 1.0 ? (t * t - 1.0) : 0.0;
    float tr = (t - 1.0) * 3.0;
    float rim = exp(-tr * tr);
    r += (cb.x * bowl + cb.y * rim) * uScale;
    float m = 1.0 - smoothstep(0.55, 1.15, t);
    if (m > craterMask) { craterMask = m; fresh = cb.z; }
  }
  // Drobne ziarno — głównie do normalnej.
  r += (fbm3(d * 11.0 + uOffset.zxy, 3) - 0.5) * 0.028 * uScale;
  return r;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uSize - 1.0);
  vec3 d = rockOctDecode(uv);
  float cm, fr;
  float r0 = fullRadius(d, cm, fr);
  float albedoVar = fbm3(d * 2.3 + uOffset * 1.7, 3);
  gl_FragColor = vec4(r0, cm * (0.35 + 0.65 * fr), baseRadius(d), albedoVar);
}
`;
}

// Wspólne dla przejść 2 i 3: próbka celu pośredniego w kierunku.
const PROC_SAMPLE_GLSL = /* glsl */`
uniform highp sampler2DArray uProc;
uniform float uSize;
uniform float uLayer;
${ROCK_OCT_GLSL}
vec4 procAt(vec3 d) {
  return textureLod(uProc, vec3(rockOctTexUv(normalize(d), uSize), uLayer), 0.0);
}
void tangents(vec3 d, out vec3 t1, out vec3 t2) {
  t1 = normalize(abs(d.y) < 0.95 ? cross(d, vec3(0.0, 1.0, 0.0)) : cross(d, vec3(1.0, 0.0, 0.0)));
  t2 = cross(d, t1);
}
`;

const NORMAL_FRAGMENT = /* glsl */`
precision highp float;
uniform float uNorm;
${PROC_SAMPLE_GLSL}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uSize - 1.0);
  vec3 d = rockOctDecode(uv);
  vec3 t1, t2;
  tangents(d, t1, t2);
  // Różnice centralne na powierzchni, krok ~1,2 teksela.
  float e = 2.4 / uSize;
  vec3 d1 = normalize(d + t1 * e);
  vec3 d2 = normalize(d + t2 * e);
  vec3 d3 = normalize(d - t1 * e);
  vec3 d4 = normalize(d - t2 * e);
  vec3 n = normalize(cross(d1 * procAt(d1).x - d3 * procAt(d3).x, d2 * procAt(d2).x - d4 * procAt(d4).x));
  if (dot(n, d) < 0.0) n = -n;
  // Promień po normalizacji (średnia 1, szczyt ≤ ROCK_MAX_RADIUS); normalna
  // nie zależy od jednorodnej skali.
  gl_FragColor = vec4(procAt(d).x * uNorm, n);
}
`;

const MASK_FRAGMENT = /* glsl */`
precision highp float;
${PROC_SAMPLE_GLSL}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uSize - 1.0);
  vec3 d = rockOctDecode(uv);
  vec3 t1, t2;
  tangents(d, t1, t2);
  vec4 p0 = procAt(d);
  // AO / wypukłość: promień względem średniej z pierścieni kierunków.
  float avgNear = 0.0;
  float avgFar = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    vec3 o = t1 * cos(a) + t2 * sin(a);
    avgNear += procAt(d + o * 0.07).x;
    avgFar += procAt(d + o * 0.28).z;
  }
  avgNear *= 0.125;
  avgFar *= 0.125;
  float cav = p0.x - avgNear;
  float convex = p0.z - avgFar;
  float ao = clamp(0.62 + cav * 9.0 + convex * 2.2, 0.0, 1.0);
  gl_FragColor = vec4(ao, p0.y, p0.w, clamp(0.5 + convex * 4.0 + cav * 6.0, 0.0, 1.0));
}
`;

// Odczyt na CPU: promień z warstwy tablicy (cel pośredni, przed normalizacją),
// zakodowany 16-bitowo w RG8, wszystkie warstwy w jednym wysokim celu
// (kafel = warstwa).
const READBACK_FRAGMENT = /* glsl */`
precision highp float;
uniform highp sampler2DArray uShapeA;
uniform float uSize;
uniform float uTile;
${ROCK_OCT_GLSL}
void main() {
  float layer = floor((gl_FragCoord.y - 0.5) / uTile);
  vec2 cell = vec2(gl_FragCoord.x - 0.5, gl_FragCoord.y - 0.5 - layer * uTile);
  vec2 uv = cell / (uTile - 1.0);
  vec3 d = rockOctDecode(uv);
  float r = textureLod(uShapeA, vec3(rockOctTexUv(d, uSize), layer), 0.0).x;
  float t = clamp((r - ${RADIUS_CODE_MIN.toFixed(4)}) / ${(RADIUS_CODE_MAX - RADIUS_CODE_MIN).toFixed(4)}, 0.0, 1.0) * 65535.0;
  float hi = floor(t / 256.0);
  float lo = t - hi * 256.0;
  gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Siatki LOD: sfera z podzielonego oktaedru

/**
 * Sfera jednostkowa z oktaedru podzielonego na n odcinków na krawędź
 * (8·n² trójkątów, 4·n² + 2 wierzchołków). Wierzchołki leżą w siatce zgodnej
 * z mapą oktaedryczną, więc próbkowanie promienia nie „pływa” między LOD-ami.
 * Atrybut aMip: poziom mipmapy promienia pasujący do gęstości siatki
 * (rzadka siatka na pełnej mapie łapałaby szpilki wałów kraterów).
 */
export function buildOctaSphere(n, mapSize = ROCK_SHAPE_DEFAULTS.size) {
  const faces = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[0, 0, 1], [-1, 0, 0], [0, -1, 0]], [[0, 0, 1], [0, -1, 0], [1, 0, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, -1, 0], [-1, 0, 0]], [[0, 0, -1], [1, 0, 0], [0, -1, 0]]
  ];
  const positions = [];
  const indices = [];
  const keyToIndex = new Map();
  const vertexIndex = (x, y, z) => {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const key = `${Math.round(nx * 1e6)},${Math.round(ny * 1e6)},${Math.round(nz * 1e6)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(nx, ny, nz);
      keyToIndex.set(key, idx);
    }
    return idx;
  };
  for (const [a, b, c] of faces) {
    const grid = [];
    for (let i = 0; i <= n; i++) {
      const row = [];
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        // Punkt na płaskiej ścianie oktaedru (|x|+|y|+|z| = 1), potem na sferę.
        row.push(vertexIndex(
          a[0] * w + b[0] * u + c[0] * v,
          a[1] * w + b[1] * u + c[1] * v,
          a[2] * w + b[2] * u + c[2] * v
        ));
      }
      grid.push(row);
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const v0 = grid[i][j];
        const v1 = grid[i + 1][j];
        const v2 = grid[i][j + 1];
        indices.push(v0, v1, v2);
        if (j < n - i - 1) {
          const v3 = grid[i + 1][j + 1];
          indices.push(v1, v3, v2);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  // Równik mapy to romb |u|+|v| = 1: 2√2·N tekseli; siatka ma na nim 4n odcinków.
  const mip = Math.max(0, Math.log2((2 * Math.SQRT2 * mapSize) / (4 * n)));
  geo.setAttribute('aMip', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(mip), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return geo;
}

/**
 * Poziomy LOD: n odcinków na krawędź oktaedru i próg promienia na ekranie [px]
 * (krawędź siatki ~10–15 px). Najgęstszy n = 96 (74 tys. trójkątów): równik
 * mapy kształtu ma 2√2·256 ≈ 724 teksele, 4n = 384 odcinki — gęstsza siatka
 * nie ma już czego odwzorować (dawny n = 160 dawał 205 tys. trójkątów na skałę
 * i 25–37 mln na klatkę przy dużym zbliżeniu).
 */
export const ROCK_LODS = Object.freeze([
  Object.freeze({ n: 3, maxPx: 9 }),
  Object.freeze({ n: 6, maxPx: 22 }),
  Object.freeze({ n: 12, maxPx: 55 }),
  Object.freeze({ n: 24, maxPx: 130 }),
  Object.freeze({ n: 48, maxPx: 320 }),
  Object.freeze({ n: 96, maxPx: Infinity })
]);

export function pickRockLod(radiusPx, maxLod = ROCK_LODS.length - 1) {
  for (let i = 0; i < maxLod; i++) if (radiusPx < ROCK_LODS[i].maxPx) return i;
  return maxLod;
}

// ---------------------------------------------------------------------------
// Bank

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class RockShapeBank {
  constructor(opts = {}) {
    const d = ROCK_SHAPE_DEFAULTS;
    this.count = opts.count ?? d.count;
    this.size = opts.size ?? d.size;
    this.readbackSize = opts.readbackSize ?? d.readbackSize;
    this.craterCap = opts.craters ?? d.craters;
    this.facetCap = opts.facets ?? d.facets;
    this.lobeCap = opts.lobes ?? d.lobes;
    this.seed = opts.seed ?? d.seed;
    this.params = [];
    for (let i = 0; i < this.count; i++) {
      this.params.push(makeRockShapeParams(i, this.seed, { craters: this.craterCap, facets: this.facetCap, lobes: this.lobeCap }));
    }
    this.targetA = null;
    this.targetB = null;
    this.radiusMaps = null;   // Float32Array[count], readbackSize² promieni (po normalizacji)
    this.maxRadius = null;    // Float32Array[count]
    this.meanRadius = null;   // Float32Array[count]
    this.norm = new Float32Array(this.count).fill(1); // skala po pieczeniu
    this.longAxis = new Float32Array(this.count * 3); // długa oś bryły (układ obiektu)
    this.geometries = [];     // wspólne siatki LOD
    this.baked = false;
    this.bakeMs = 0;
  }

  get textureA() { return this.targetA ? this.targetA.texture : null; }
  get textureB() { return this.targetB ? this.targetB.texture : null; }

  /** Siatki LOD (lazy, raz). */
  ensureGeometries() {
    if (this.geometries.length) return this.geometries;
    for (const lod of ROCK_LODS) this.geometries.push(buildOctaSphere(lod.n, this.size));
    return this.geometries;
  }

  /**
   * Pieczenie wszystkich kształtów. Stan renderera (cel, autoClear) wraca
   * do poprzedniego. Wymaga WebGL2 (RGBA16F jako cel — EXT_color_buffer_float
   * jest w Chrome zawsze dla half float).
   */
  bake(renderer) {
    if (!renderer) throw new Error('RockShapeBank.bake: brak renderera');
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const N = this.size;
    const makeTarget = (type) => {
      const rt = new THREE.WebGLArrayRenderTarget(N, N, this.count, {
        type,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter
      });
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      rt.texture.generateMipmaps = true;
      rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.targetA = makeTarget(THREE.HalfFloatType);
    this.targetB = makeTarget(THREE.UnsignedByteType);
    // Cel pośredni (przejście 1): bez mipmap, dwuliniowy do próbek sąsiadów.
    const proc = new THREE.WebGLArrayRenderTarget(N, N, this.count, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    proc.texture.generateMipmaps = false;
    proc.texture.minFilter = THREE.LinearFilter;
    proc.texture.colorSpace = THREE.NoColorSpace;

    const uniforms = {
      uSize: { value: N },
      uOffset: { value: new THREE.Vector3() },
      uLumpAmp: { value: 0 },
      uLumpFreq: { value: 1 },
      uRidgeAmp: { value: 0 },
      uRidgeFreq: { value: 1 },
      uElong: { value: new THREE.Vector3(1, 1, 1) },
      uScale: { value: 1 },
      uEqRidge: { value: new THREE.Vector2(0, 0.1) },
      uLobeCount: { value: 0 },
      uLobes: { value: Array.from({ length: this.lobeCap }, () => new THREE.Vector4()) },
      uLobeK: { value: 0.1 },
      uFacetCount: { value: 0 },
      uFacets: { value: Array.from({ length: this.facetCap }, () => new THREE.Vector4()) },
      uFacetK: { value: 0.07 },
      uCraterCount: { value: 0 },
      uCraterA: { value: Array.from({ length: this.craterCap }, () => new THREE.Vector4()) },
      uCraterB: { value: Array.from({ length: this.craterCap }, () => new THREE.Vector4()) }
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: procFragment(this.craterCap, this.facetCap, this.lobeCap),
      uniforms,
      depthTest: false,
      depthWrite: false
    });
    const procUniforms = {
      uProc: { value: proc.texture },
      uSize: { value: N },
      uLayer: { value: 0 },
      uNorm: { value: 1 }
    };
    const normalMaterial = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX, fragmentShader: NORMAL_FRAGMENT, uniforms: procUniforms, depthTest: false, depthWrite: false
    });
    const maskMaterial = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX, fragmentShader: MASK_FRAGMENT, uniforms: procUniforms, depthTest: false, depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Mipmapy raz, po ostatniej warstwie: pamięć poziomów alokuje
    // initRenderTarget (przy włączonym generateMipmaps), a three generuje je
    // po KAŻDYM renderze do celu — przy 24 warstwach × 2 celach 48 razy.
    renderer.initRenderTarget(this.targetA);
    renderer.initRenderTarget(this.targetB);
    this.targetA.texture.generateMipmaps = false;
    this.targetB.texture.generateMipmaps = false;
    try {
      for (let k = 0; k < this.count; k++) {
        const p = this.params[k];
        uniforms.uOffset.value.set(p.offset[0], p.offset[1], p.offset[2]);
        uniforms.uLumpAmp.value = p.lumpAmp;
        uniforms.uLumpFreq.value = p.lumpFreq;
        uniforms.uRidgeAmp.value = p.ridgeAmp;
        uniforms.uRidgeFreq.value = p.ridgeFreq;
        uniforms.uElong.value.set(p.elong[0], p.elong[1], p.elong[2]);
        uniforms.uScale.value = p.scale;
        uniforms.uEqRidge.value.set(p.eqRidge[0], p.eqRidge[1]);
        uniforms.uLobeCount.value = p.lobes.length;
        uniforms.uLobeK.value = p.lobeK;
        for (let i = 0; i < this.lobeCap; i++) {
          const L = p.lobes[i];
          uniforms.uLobes.value[i].set(L ? L[0] : 0, L ? L[1] : 0, L ? L[2] : 0, L ? L[3] : 0);
        }
        uniforms.uFacetCount.value = p.facets.length;
        uniforms.uFacetK.value = p.facetK;
        for (let i = 0; i < this.facetCap; i++) {
          const f = p.facets[i];
          uniforms.uFacets.value[i].set(f ? f[0] : 0, f ? f[1] : 0, f ? f[2] : 1, f ? f[3] : 9);
        }
        uniforms.uCraterCount.value = p.craters.length;
        for (let i = 0; i < this.craterCap; i++) {
          const c = p.craters[i];
          uniforms.uCraterA.value[i].set(c ? c[0] : 0, c ? c[1] : 0, c ? c[2] : 1, c ? c[3] : 0.001);
          // w = cos zasięgu wpływu krateru (misa + wał do 1,7 promienia).
          uniforms.uCraterB.value[i].set(c ? c[4] : 0, c ? c[5] : 0, c ? c[6] : 0, c ? Math.cos(Math.min(c[3] * 1.7, 3.0)) : 2);
        }
        material.uniformsNeedUpdate = true;
        renderer.setRenderTarget(proc, k);
        renderer.render(scene, cam);
      }
      // Odczyt promienia przed normalizacją → skala każdej bryły (średnia 1,
      // szczyt ≤ ROCK_MAX_RADIUS), potem normalne zapisują promień już przeskalowany.
      this._readback(renderer, scene, quad, cam, proc.texture);
      for (const [target, mat] of [[this.targetA, normalMaterial], [this.targetB, maskMaterial]]) {
        quad.material = mat;
        for (let k = 0; k < this.count; k++) {
          procUniforms.uLayer.value = k;
          procUniforms.uNorm.value = this.norm[k];
          mat.uniformsNeedUpdate = true;
          target.texture.generateMipmaps = k === this.count - 1;
          renderer.setRenderTarget(target, k);
          renderer.render(scene, cam);
        }
      }
      quad.material = material;
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      this.targetA.texture.generateMipmaps = true;
      this.targetB.texture.generateMipmaps = true;
      material.dispose();
      normalMaterial.dispose();
      maskMaterial.dispose();
      proc.dispose();
      quad.geometry.dispose();
    }
    this.ensureGeometries();
    this.baked = true;
    this.bakeMs = (typeof performance !== 'undefined') ? performance.now() - t0 : 0;
    return this;
  }

  _readback(renderer, scene, quad, cam, source = this.targetA.texture) {
    const R = this.readbackSize;
    const rt = new THREE.WebGLRenderTarget(R, R * this.count, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: READBACK_FRAGMENT,
      uniforms: {
        uShapeA: { value: source },
        uSize: { value: this.size },
        uTile: { value: R }
      },
      depthTest: false,
      depthWrite: false
    });
    const prevMaterial = quad.material;
    quad.material = material;
    const buf = new Uint8Array(R * R * this.count * 4);
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, R, R * this.count, buf);
    } finally {
      quad.material = prevMaterial;
      material.dispose();
      rt.dispose();
    }
    this.setRadiusMapsFromBytes(buf);
  }

  /**
   * Dekoduje odczyt RG8 (16 bitów) do map promienia i liczy skalę bryły:
   * średni promień (ważony kątem bryłowym tekseli mapy) 1, szczyt najwyżej
   * ROCK_MAX_RADIUS. `normalize` false = mapy bez zmiany skali (testy).
   */
  setRadiusMapsFromBytes(buf, normalize = true) {
    const R = this.readbackSize;
    const span = RADIUS_CODE_MAX - RADIUS_CODE_MIN;
    this.radiusMaps = [];
    this.maxRadius = new Float32Array(this.count);
    this.meanRadius = new Float32Array(this.count);
    const weights = octTexelWeights(R);
    for (let k = 0; k < this.count; k++) {
      const map = new Float32Array(R * R);
      let mx = 0;
      let sum = 0;
      let wsum = 0;
      for (let y = 0; y < R; y++) {
        for (let x = 0; x < R; x++) {
          const o = ((k * R + y) * R + x) * 4;
          const code = buf[o] * 256 + buf[o + 1];
          const r = RADIUS_CODE_MIN + (code / 65535) * span;
          map[y * R + x] = r;
          if (r > mx) mx = r;
          const w = weights[y * R + x];
          sum += r * w;
          wsum += w;
        }
      }
      const mean = sum / Math.max(1e-9, wsum);
      const norm = normalize ? Math.min(1 / Math.max(0.05, mean), ROCK_MAX_RADIUS / Math.max(0.05, mx)) : 1;
      if (norm !== 1) for (let i = 0; i < map.length; i++) map[i] *= norm;
      this.norm[k] = norm;
      this.radiusMaps.push(map);
      this.maxRadius[k] = mx * norm;
      this.meanRadius[k] = mean * norm;
      // Długa oś: średnia kierunków (ze znakiem względem najdalszego punktu)
      // ważona nadwyżką promienia — owal, podwójna i odłam mają wyraźną.
      let best = 0;
      for (let i = 1; i < map.length; i++) if (map[i] > map[best]) best = i;
      const ref = octDecode((best % R) / (R - 1), Math.floor(best / R) / (R - 1), { x: 0, y: 0, z: 1 });
      let ax = 0; let ay = 0; let az = 0;
      for (let y = 0; y < R; y++) {
        for (let x = 0; x < R; x++) {
          const i = y * R + x;
          const ex = map[i] - mean * norm;
          if (ex <= 0) continue;
          const dd = octDecode(x / (R - 1), y / (R - 1), _dec);
          const s = (dd.x * ref.x + dd.y * ref.y + dd.z * ref.z) >= 0 ? 1 : -1;
          const w = ex * ex * weights[i];
          ax += dd.x * s * w; ay += dd.y * s * w; az += dd.z * s * w;
        }
      }
      const al = Math.hypot(ax, ay, az) || 1;
      this.longAxis[k * 3] = ax / al;
      this.longAxis[k * 3 + 1] = ay / al;
      this.longAxis[k * 3 + 2] = az / al;
    }
  }

  /** Promień kształtu w kierunku (CPU, dwuliniowo z mapy odczytu). */
  radiusAt(shape, x, y, z) {
    const map = this.radiusMaps && this.radiusMaps[shape];
    if (!map) return 1;
    const R = this.readbackSize;
    const o = octEncode(x, y, z, _oct);
    const fx = o.u * (R - 1);
    const fy = o.v * (R - 1);
    const x0 = Math.min(R - 2, Math.max(0, Math.floor(fx)));
    const y0 = Math.min(R - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const a = map[y0 * R + x0];
    const b = map[y0 * R + x0 + 1];
    const c = map[(y0 + 1) * R + x0];
    const d = map[(y0 + 1) * R + x0 + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }

  /**
   * Sylwetka z góry skały o orientacji (qx..qw) i rozciągnięciu (sx, sy, sz):
   * max promienia rzutu na płaszczyznę gry w `bins` kątach (układ sceny,
   * kąt 0 = +x, rośnie ku +y sceny). Jednostka = promień nominalny skały.
   * Kąty w układzie gry (y w dół): angleGame = −angleScene.
   */
  silhouette(shape, qx, qy, qz, qw, sx = 1, sy = 1, sz = 1, bins = 48, out = null) {
    const res = out && out.length === bins ? out : new Float32Array(bins);
    res.fill(0);
    const map = this.radiusMaps && this.radiusMaps[shape];
    const R = this.readbackSize;
    _q.set(qx, qy, qz, qw);
    const step = (Math.PI * 2) / bins;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const dir = octDecode(i / (R - 1), j / (R - 1), _dec);
        const r = map ? map[j * R + i] : 1;
        _v.set(dir.x * r * sx, dir.y * r * sy, dir.z * r * sz).applyQuaternion(_q);
        const rr = Math.hypot(_v.x, _v.y);
        let a = Math.atan2(_v.y, _v.x);
        if (a < 0) a += Math.PI * 2;
        const b = Math.min(bins - 1, Math.floor(a / step));
        if (rr > res[b]) res[b] = rr;
      }
    }
    // Wypełnij puste kosze (rzadkie przy małej mapie) i lekko wygładź maksimum.
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < bins; b++) {
        const l = res[(b + bins - 1) % bins];
        const r = res[(b + 1) % bins];
        if (res[b] < Math.min(l, r)) res[b] = Math.min(l, r);
      }
    }
    return res;
  }

  dispose() {
    this.targetA?.dispose();
    this.targetB?.dispose();
    this.targetA = null;
    this.targetB = null;
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.baked = false;
  }
}

const _oct = { u: 0, v: 0 };
const _dec = { x: 0, y: 0, z: 1 };
