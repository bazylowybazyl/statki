// src/3d/cargoContainers3D.js
//
// KONTENERY 3D — widok ładunku statków ruchu v2 (Z5, plan § 3.4). Kontener to
// WIDOK liczby: moduł rysuje to, co podaje logika (cargoPortOps.js — pokład
// i przeładunek; src/data/cargoContainers.js — sloty, rodziny, wygląd), nic
// nie liczy od nowa i nic nie zmienia w grze.
//
// RYSOWANIE (jeden renderer: Core3D; obiekty w podanej scenie, warstwa 0 —
// pass ortho, jak kadłuby i mostki). Budżet: 3 wywołania na całą flotę:
//   • kontenery — jedna siatka instancji (sfazowany prostopadłościan) dla
//     wszystkich: na pokładach, niesione przez drony, na placach portu i płyty
//     maski ładowni; rodzina (standard / zbiornik / zsyp / płyta) to wzór
//     wierzchu w shaderze, nie osobna geometria; renderOrder 12 (jak mostek);
//   • cień na kadłubie — prostokąty POD kadłubem z testem głębi GREATER
//     (renderOrder 11): rysują się tylko tam, gdzie kadłub zapisał głębię,
//     więc są przycięte do sylwetki (wzór: mostek, bridge3D.js);
//   • cień na pokładzie portu — prostokąty na płycie pola (z ≈ −115) ze
//     zwykłym testem głębi: kadłuby nad nim go zasłaniają; do tego włazy wind
//     placu (renderOrder 11,5).
// Drony (cargoDrones3D.js) dokładają tu swoje cienie.
//
// PARALAKSA: statki są w passie ortho, a port (ring) w perspektywie (Core3D:
// kamera persp na wysokości H nad z = 0, ta sama skala w płaszczyźnie lotu).
// Wszystko poniżej płaszczyzny lotu (plac, drony nad pokładem portu) dostaje
// w shaderze skalę widoku H / (H − z) wokół środka kadru — PER WIERZCHOŁEK, więc
// kontener na placu ma perspektywę jak pokład pod nim (widać boki przy brzegu
// ekranu). Nad płaszczyzną (pokład statku) — bez skali: kadłub jest ortho.
// Wolna kamera (free3d, kamera kinowa dema): prawdziwe z, bez paralaksy.
//
// GŁĘBIA: nad płaszczyzną lotu z jest ściskane do ułamka jednostki (uDepth) —
// pass tarcz rysuje się na głębi ortho kadłubów, a kontener sterczący ponad
// kopułę tarczy wycinałby w niej dziurę. Porządek (kontener nad kadłubem, dron
// nad kontenerem) zostaje, bo ścisk jest monotoniczny.
//
// ŚWIATŁO: dwa słońca. Na pokładzie statku jak kadłub (hexShips3D: kierunek
// normalize(słońce − statek, z = 600), otoczenie 0,24, rozproszone 1,18, połysk
// 0,30, maska cieni Core3D — sunVisibility/sunFill; wierzch jasny jak kadłub
// pod kontenerem — hullLightAt jak w bridge3D.js). Na placu portu jak ring
// (słońce 49° nad płaszczyzną, dzień/noc z cienia planety, bez maski Core3D —
// ring ma własny model słońca). Niesiony kontener przechodzi płynnie
// (lightMix z wysokości).
//
// POCZĄTEK PRZY KAMERZE: dane instancji względem origin (mesh.position, three
// składa modelViewMatrix w double) — świat leży przy 5–10 mln j., float32
// w shaderze drgałby ~1 px (sceneOrigin.js, bridge3D._setOrigin).

import * as THREE from 'three';
import {
  CONTAINER_FAMILY_CODE,
  COVER_PAINT,
  HAZMAT_PAINT,
  HOPPER_BODIES,
  HOPPER_MATERIAL,
  STANDARD_PAINTS,
  TANK_FRAMES,
  TANK_SHELLS,
  cargoHash01,
  cargoHoldLayout,
  cargoHoldSlots,
  cargoLayoutScale,
  cargoResourceKey,
  cargoUnitSize,
  containerFamilyOf,
  isHazmatCargo
} from '../data/cargoContainers.js';
import { RESOURCE_KEYS, RESOURCES } from '../data/resources.js';
import { sunShadowUniforms } from './sunShadowMask.js';
// AGENT: moduł Z5 poza grą (dema/kontenery) — GLSL; przejdzie na TSL przy integracji ruchu v2 (PLAN §12 p. 1).
// Napis maski GLSL wprost z biblioteki poza portem (gra ładuje tylko TSL z sunShadowMask.js).
import { SUN_SHADOW_GLSL } from './sunShadowMaskGLSL.js';

// ---------------------------------------------------------------------------
// Strojenie (window.__cargo3DTune)
// ---------------------------------------------------------------------------

export const CARGO3D_TUNE = {
  enabled: true,
  // Zanik z odległością: krótszy bok kontenera na ekranie [px].
  minPx: 3,
  fullPx: 6,
  // Cienie dopiero od tylu px (i pełne od shadowFullPx).
  shadowMinPx: 10,
  shadowFullPx: 14,
  // Cień na kadłubie: „słońce cieni” jak mostek (azymut słońca, niska wysokość).
  shadowElevDeg: 30,
  shadowStrength: 0.5,
  shadowSoft: 0.08,
  contactAo: 0.35,
  // Cień na pokładzie portu (słońce ringu).
  deckShadowStrength: 0.55,
  // Światło na pokładzie statku (= SHIP_LIGHT_DEFAULTS kadłuba).
  ambient: 0.24,
  diffuse: 1.18,
  specular: 0.30,
  // Światło portu (ring: słońce 49°, otoczenie nieba).
  portAmbient: 0.2,
  portDiffuse: 0.95,
  portSpecular: 0.22,
  // Ścisk głębi nad płaszczyzną lotu (pass tarcz — patrz nagłówek).
  depthSquash: 0.02,
  drawContainers: true,
  drawShadows: true
};

if (typeof window !== 'undefined') window.__cargo3DTune = CARGO3D_TUNE;

// ---------------------------------------------------------------------------
// Stałe
// ---------------------------------------------------------------------------

export const CARGO3D_LIMITS = Object.freeze({
  deck: 2048,        // kontenery na pokładach (plan: talia pokładu ≤ 2048)
  loose: 256,        // niesione przez drony (≤ 256)
  yard: 1024,        // na placach portu
  hullShadows: 2048 + 256,
  deckShadows: 1024 + 512 + 256
});
const CAPACITY = CARGO3D_LIMITS.deck + CARGO3D_LIMITS.loose + CARGO3D_LIMITS.yard;
const MODEL_RENDER_ORDER = 12;
const HULL_SHADOW_ORDER = 11;
const DECK_SHADOW_ORDER = 11.5;
const SHIP_Z = 0.06;               // pokład statku (jak MODEL_LIFT mostka)
const HULL_SHADOW_Z = -0.6;        // pod kadłubem (jak odbiornik cienia mostka)
const COVER_H = 0.35;              // płyta maski ładowni
const NO_CLIP = -1e9;
const DEG = Math.PI / 180;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  const raw = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return [1, 1, 1];
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(raw.slice(i, i + 2), 16) / 255));
}
const smooth01 = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1e-6)));
  return t * t * (3 - 2 * t);
};

// Palety do shadera (liniowe). Kolejność = indeksy w danych.
const vecs = (list) => list.map((h) => new THREE.Vector3(...hexToLinear(h)));
const RES_COUNT = RESOURCE_KEYS.length;
// Wygląd surowców: kod rodziny, hazmat, materiał zsypu (dla CPU — dane instancji).
const RES_FAMILY = new Float32Array(RES_COUNT);
const RES_MAT = new Float32Array(RES_COUNT);
RESOURCE_KEYS.forEach((id, i) => {
  RES_FAMILY[i] = CONTAINER_FAMILY_CODE[containerFamilyOf(id)];
  const hop = RES_FAMILY[i] === CONTAINER_FAMILY_CODE.hopper;
  const mat = hop ? ({ ice: HOPPER_MATERIAL.ICE, scrap: HOPPER_MATERIAL.SCRAP, steel: HOPPER_MATERIAL.BARS, copper_wire: HOPPER_MATERIAL.COILS, polymer: HOPPER_MATERIAL.GRANULATE, raw_crystal: HOPPER_MATERIAL.CRYSTAL }[id] ?? HOPPER_MATERIAL.ORE) : 0;
  RES_MAT[i] = mat + (isHazmatCargo(id) ? 16 : 0);
});

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

// Paralaksa (ortho pass udający perspektywę portu) i ścisk głębi — wspólne
// z dronami (cargoDrones3D.js). uCgParallax: środek kadru (względem origin),
// wysokość kamery H, włącznik; uCgDepth: ścisk nad z = 0, włącznik.
export const CARGO_VIEW_GLSL = `
uniform vec4 uCgParallax;
uniform vec2 uCgDepth;
vec4 cgProject(vec3 wp) {
  vec3 p = wp;
  if (uCgParallax.w > 0.5 && p.z < 0.0) {
    float k = uCgParallax.z / max(uCgParallax.z - p.z, 1.0);
    p.xy = uCgParallax.xy + (p.xy - uCgParallax.xy) * k;
  }
  if (uCgDepth.y > 0.5 && p.z > 0.0) p.z *= uCgDepth.x;
  return projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

// Światło pokładu statku albo portu (mix). Wspólne z dronami.
// uCgShip: otoczenie, rozproszone, połysk, (wolne); uCgPort: otoczenie,
// rozproszone, połysk, dzień (0 = cień planety).
export const CARGO_LIGHT_GLSL = `
uniform vec4 uCgShip;
uniform vec4 uCgPort;
uniform vec3 uCgSunRel;
uniform vec3 uCgPortSun;
vec3 cgLightDir(vec3 wp, float lightMix) {
  vec3 ls = normalize(vec3(uCgSunRel.xy - wp.xy, 600.0));
  return normalize(mix(ls, uCgPortSun, clamp(lightMix, 0.0, 1.0)));
}
// hullL: jasność kadłuba pod obiektem (otoczenie + poduszkowa normalna), N i L
// w tym samym układzie, top = udział „dachu” (0..1).
vec3 cgShade(vec3 albedo, vec3 N, vec3 L, float lightMix, float hullL, float specK, float specPow) {
  float sunVis = sunVisibility();
  float NdotL = dot(N, L);
  float up = max(N.z, 0.0);
  float shipAmb = uCgShip.x * sunFill(sunVis) + max(hullL - uCgShip.x, 0.0) * sunVis;
  float ship = shipAmb * (0.55 + 0.45 * up) + max(NdotL, 0.0) * uCgShip.y * sunVis;
  float port = uCgPort.x * (0.55 + 0.45 * up) + max(NdotL, 0.0) * uCgPort.y * uCgPort.w;
  float m = clamp(lightMix, 0.0, 1.0);
  vec3 col = albedo * mix(ship, port, m);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float sp = pow(max(dot(N, H), 0.0), specPow) * smoothstep(-0.02, 0.08, NdotL);
  float spK = mix(uCgShip.z * sunVis, uCgPort.z * uCgPort.w, m);
  col += vec3(sp * specK * spK);
  // Powierzchnia nie świeci: jasne skosy łagodnie dochodzą do ~0,86 (pod
  // progiem bloomu 0,9), jak model mostka.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (lum > 0.62) col *= (0.62 + 0.24 * (1.0 - exp(-(lum - 0.62) / 0.24))) / lum;
  return col;
}
`;

export const CARGO_NOISE_GLSL = `
float cgHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cgHash(i), cgHash(i + vec2(1.0, 0.0)), f.x),
             mix(cgHash(i + vec2(0.0, 1.0)), cgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Zanik z odległością: rozrzut w ekranie (bez przezroczystości — kontener
// zostaje w passie nieprzezroczystym i pisze głębię).
bool cgDitherOut(float a) {
  if (a >= 0.999) return false;
  return cgHash(floor(gl_FragCoord.xy)) > a;
}
`;

const CONTAINER_VERT = `
attribute vec3 aBevel;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iLook;
attribute vec4 iExtra;
${CARGO_VIEW_GLSL}
uniform vec3 uCgSunRel;
uniform vec3 uCgPortSun;
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vObjL;
flat varying vec4 vLook;
flat varying vec4 vExtra;
flat varying vec4 vSize;

void main() {
  vSize = iSize;
  vLook = iLook;
  vExtra = iExtra;
  float bev = min(0.07 * min(iSize.x, iSize.y), 0.3 * iSize.z);
  vec3 lp = position * iSize.xyz + aBevel * bev;
  float c = cos(iPos.w);
  float s = sin(iPos.w);
  vec3 wp = vec3(iPos.x + c * lp.x - s * lp.y, iPos.y + s * lp.x + c * lp.y, iPos.z + lp.z);
  // Wyłaz windy placu: część poniżej płaszczyzny cięcia ściśnięta na nią.
  wp.z = max(wp.z, iExtra.x);
  vLocal = vec3(lp.xy, wp.z - iPos.z);
  vObjN = normal;
  vec3 ls = normalize(vec3(uCgSunRel.xy - wp.xy, 600.0));
  vec3 L = normalize(mix(ls, uCgPortSun, clamp(iLook.w, 0.0, 1.0)));
  vObjL = vec3(c * L.x + s * L.y, -s * L.x + c * L.y, L.z);
  gl_Position = cgProject(wp);
}
`;

const CONTAINER_FRAG = `
uniform vec3 uStd[${STANDARD_PAINTS.length}];
uniform vec3 uShell[${TANK_SHELLS.length}];
uniform vec3 uFrame[${TANK_FRAMES.length}];
uniform vec3 uBody[${HOPPER_BODIES.length}];
uniform vec3 uRes[${RES_COUNT}];
uniform vec3 uHazmat;
uniform vec3 uCover;
uniform vec3 uAmber;
${SUN_SHADOW_GLSL}
${CARGO_LIGHT_GLSL}
${CARGO_NOISE_GLSL}
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vObjL;
flat varying vec4 vLook;
flat varying vec4 vExtra;
flat varying vec4 vSize;

vec3 cgStdPaint(float h) {
  int i = int(clamp(floor(h * ${STANDARD_PAINTS.length}.0), 0.0, ${STANDARD_PAINTS.length - 1}.0));
  return uStd[i];
}

// Pas ostrzegawczy (ukośne pasy żółto-czarne) i romb nalepki hazmat.
vec3 cgHazmat(vec2 cc, vec2 hs, vec3 paint, vec3 accent) {
  vec3 col = paint;
  float band = smoothstep(hs.x * 0.62, hs.x * 0.66, abs(cc.x));
  float stripe = step(0.5, fract((cc.x + cc.y) / max(hs.y * 0.55, 0.2)));
  col = mix(col, mix(paint, vec3(0.018), stripe), band);
  float r = min(hs.x, hs.y) * 0.46;
  float dm = abs(cc.x) + abs(cc.y);
  col = mix(col, vec3(0.8), 1.0 - smoothstep(r * 0.98, r * 1.04, dm));
  col = mix(col, accent, 1.0 - smoothstep(r * 0.78, r * 0.84, dm));
  return col;
}

void main() {
  if (cgDitherOut(vSize.w)) discard;
  vec3 N = normalize(vObjN);
  float fam = vLook.x;
  float seed = vLook.z;
  float hullL = vExtra.w;
  float packedGrid = vExtra.y;
  float nx = max(1.0, mod(packedGrid, 8.0));
  float ny = max(1.0, mod(floor(packedGrid / 8.0), 8.0));
  float tiers = max(1.0, floor(packedGrid / 64.0));
  float matCode = mod(vExtra.z, 16.0);
  bool hazmat = vExtra.z >= 15.5;
  int resI = int(vLook.y + 0.5);
  vec3 accent = uRes[resI];
  vec2 size = vSize.xy;
  vec2 cell = size / vec2(nx, ny);
  vec2 q = (vLocal.xy + size * 0.5) / cell;
  vec2 cid = clamp(floor(q), vec2(0.0), vec2(nx, ny) - 1.0);
  vec2 cc = (q - cid - 0.5) * cell;
  vec2 hs = cell * 0.5;
  float cellSeed = cgHash(cid + vec2(seed * 71.3, seed * 17.9));
  vec3 Nb = N;
  vec3 albedo;
  float specK = 0.6;
  float specPow = 24.0;
  bool top = N.z > 0.9;
  bool chamfer = N.z > 0.3 && !top;
  vec2 fwc = fwidth(vLocal.xy);
  float px = max(max(fwc.x, fwc.y), 1e-4);

  if (fam > 2.5) {
    // Płyta maski ładowni: grafit, bursztynowy obrys, zamki w narożach.
    vec2 d = size * 0.5 - abs(vLocal.xy);
    float edge = min(d.x, d.y);
    albedo = uCover * (0.9 + 0.2 * cgNoise(vLocal.xy * 0.8));
    float line = min(size.x, size.y) * 0.05;
    albedo = mix(albedo, uAmber, (1.0 - smoothstep(line * 0.6, line * 0.6 + px, abs(edge - line * 1.6))) * 0.9);
    float corner = step(d.x, line * 2.4) * step(d.y, line * 2.4);
    albedo = mix(albedo, vec3(0.12), corner * 0.7);
    specK = 0.2;
  } else if (fam > 1.5) {
    // ZSYP: burty i otwarty wierzch z usypanym ładunkiem (przegrody = podsiatka).
    vec3 body = uBody[int(floor(cellSeed * ${HOPPER_BODIES.length}.0))];
    albedo = body * (0.85 + 0.25 * cgNoise(vLocal.xy * 0.35 + seed));
    if (top) {
      float rim = 0.09 * min(cell.x, cell.y) + 0.25;
      vec2 dd = hs - abs(cc);
      float inner = min(dd.x, dd.y) - rim;
      if (inner > 0.0) {
        vec2 hn = cc / max(hs - rim, vec2(0.2));
        float lump = 3.0 / max(min(cell.x, cell.y), 1.0);
        vec2 np = cc * lump * 4.0 + cid * 7.1 + seed;
        float n1 = cgNoise(np);
        float n2 = cgNoise(np * 2.3 + 5.1);
        // Kopiec: pochyła ku burtom, grudki z szumu (gradient → normalna).
        vec2 g = -2.0 * hn * vec2(1.0 - hn.y * hn.y, 1.0 - hn.x * hn.x) * 0.6;
        g += (vec2(cgNoise(np + vec2(0.4, 0.0)), cgNoise(np + vec2(0.0, 0.4))) - n1) * 2.2;
        vec3 mat = accent;
        float m = matCode;
        if (m < 0.5) {
          mat *= mix(0.55, 1.15, n1 * 0.7 + n2 * 0.3);
        } else if (m < 1.5) {
          mat = mix(accent, vec3(0.92, 0.97, 1.0), 0.45 + 0.35 * n2) * (0.85 + 0.3 * n1);
          specK = 1.6; specPow = 60.0;
        } else if (m < 2.5) {
          float pick = cgHash(floor(np * 1.6));
          mat = pick < 0.35 ? vec3(0.22, 0.12, 0.06) : pick < 0.7 ? accent : vec3(0.12, 0.14, 0.17);
          mat *= 0.7 + 0.6 * n2;
          g *= 1.8;
          specK = 1.0;
        } else if (m < 3.5) {
          float bw = max(cell.y / 9.0, 0.3);
          float fb = fract(cc.y / bw);
          g = vec2(0.0, (fb - 0.5) * 3.0);
          mat = accent * (0.75 + 0.4 * sin(fb * 3.1416)) * (0.9 + 0.2 * cgHash(vec2(floor(cc.y / bw), cid.x)));
          specK = 1.2; specPow = 40.0;
        } else if (m < 4.5) {
          float cd = max(min(cell.x, cell.y) / 3.2, 0.4);
          vec2 cq = fract(cc / cd) - 0.5;
          float rr = length(cq) * 2.0;
          float ring = 0.5 + 0.5 * cos(rr * 18.0);
          mat = accent * (0.6 + 0.5 * ring) * step(rr, 0.95) + vec3(0.02) * step(0.95, rr);
          g = cq * 1.5;
          specK = 1.3; specPow = 36.0;
        } else if (m < 5.5) {
          mat *= 0.8 + 0.35 * cgNoise(np * 5.0);
          g *= 0.4;
        } else {
          float f = cgNoise(np * 1.7);
          mat = mix(accent * 0.6, vec3(0.95, 0.9, 1.0), smoothstep(0.62, 0.8, f));
          g = (vec2(cgHash(floor(np * 1.7)), cgHash(floor(np * 1.7) + 3.3)) - 0.5) * 2.4;
          specK = 2.0; specPow = 80.0;
        }
        // Cień przy burtach (ładunek niżej niż krawędź).
        float ao = smoothstep(0.0, rim * 3.0 + 0.4, inner);
        albedo = mat * (0.45 + 0.55 * ao);
        Nb = normalize(vec3(g, 1.0));
      } else {
        albedo *= 1.12;
      }
    } else {
      // Burty: pionowe żebra.
      float rib = 0.5 + 0.5 * cos(dot(vLocal.xy, vec2(1.0)) / max(min(cell.x, cell.y) * 0.18, 0.2) * 3.1416);
      albedo *= 0.88 + 0.12 * rib;
    }
  } else if (fam > 0.5) {
    // ZBIORNIK (ISO tank): rama na końcach, walec wzdłuż, pas barwy ładunku, pomost.
    vec3 shell = uShell[int(floor(cellSeed * ${TANK_SHELLS.length}.0))];
    vec3 frame = uFrame[int(floor(cgHash(vec2(seed, 3.7)) * ${TANK_FRAMES.length}.0))];
    albedo = frame;
    if (top) {
      // Z góry: walec wzdłuż ramy (mocne cieniowanie w poprzek, połysk na
      // grzbiecie), dennice zaokrąglone ku ramom czołowym, dwa pasy w barwie
      // ładunku, cienki pomost; ramy czołowe wąskie, z narożnikami.
      float endW = 0.09 * cell.x;
      float r = hs.y * 0.97;
      float yy = cc.y / r;
      float ax = abs(cc.x);
      if (ax > hs.x - endW) {
        vec2 dd = hs - abs(cc);
        float cst = 0.16 * hs.y;
        albedo = frame * (step(min(dd.x, dd.y), cst) > 0.5 ? 0.45 : 1.0);
      } else if (abs(yy) < 1.0) {
        float zz = sqrt(max(1.0 - yy * yy, 0.0));
        // Dennica: ostatnie ~12% długości walca schodzi ku ramie.
        float headZone = cell.x * 0.12;
        float hd = smoothstep(hs.x - endW - headZone, hs.x - endW, ax);
        Nb = normalize(vec3(sign(cc.x) * hd * 1.4, yy * 1.15, zz));
        albedo = shell * (0.9 + 0.1 * cgNoise(cc * 0.6 + seed)) * (1.0 - 0.35 * hd);
        float bandW = cell.x * 0.045;
        float band = 1.0 - smoothstep(bandW, bandW + px, abs(ax - hs.x * 0.42));
        albedo = mix(albedo, accent, band * (1.0 - hd));
        float walk = 1.0 - smoothstep(hs.y * 0.05, hs.y * 0.05 + px, abs(cc.y));
        albedo = mix(albedo, albedo * 0.55, walk * (1.0 - hd));
        specK = 1.5; specPow = 40.0;
      } else {
        albedo = frame * 0.3;
      }
    } else {
      // Boki: rama i cień walca między słupkami.
      float post = smoothstep(hs.x - 0.13 * cell.x, hs.x - 0.1 * cell.x, abs(cc.x));
      albedo = mix(shell * 0.55, frame, post);
    }
  } else {
    // STANDARD: dach z przetłoczeniami w poprzek, narożniki, farba z palety.
    vec3 paint = hazmat ? uHazmat : cgStdPaint(cellSeed);
    albedo = paint;
    if (top) {
      // Przetłoczenia dachu w poprzek (normalna faluje — światło je rysuje),
      // ciemniejszy pas drzwi na jednym końcu, narożniki.
      float period = max(cell.x / 10.0, 0.2);
      float ribAA = 1.0 - smoothstep(0.25, 0.6, px / period);
      float ph = cc.x / period * 6.2832;
      float rib = 0.5 + 0.5 * cos(ph);
      albedo *= 1.0 - 0.16 * rib * ribAA;
      Nb = normalize(vec3(-sin(ph) * 0.22 * ribAA, 0.0, 1.0));
      float door = smoothstep(hs.x * 0.9, hs.x * 0.92, cc.x * (cgHash(vec2(seed, cid.x)) > 0.5 ? 1.0 : -1.0));
      albedo *= 1.0 - 0.22 * door;
      float cst = 0.075 * min(cell.x, cell.y) + 0.12;
      vec2 dd = hs - abs(cc);
      albedo = mix(albedo, vec3(0.06), step(dd.x, cst) * step(dd.y, cst));
      if (hazmat) albedo = cgHazmat(cc, hs, albedo, accent);
      float grime = smoothstep(0.55, 0.95, cgNoise(vLocal.xy * (0.9 / max(cell.y, 0.5)) + seed * 3.0));
      albedo *= 1.0 - 0.18 * grime;
    } else if (!chamfer) {
      float period = max(cell.x / 18.0, 0.18);
      float rib = 0.5 + 0.5 * cos((vLocal.x + vLocal.y) / period * 6.2832);
      albedo *= 0.9 + 0.1 * rib;
      if (hazmat) albedo = mix(albedo, vec3(0.018), step(0.5, fract((vLocal.x + vLocal.z) / max(cell.y * 0.3, 0.2))) * 0.8);
    }
  }
  // Szczeliny podsiatki (moduł = kilka kontenerów w ramie) i piętra na bokach.
  if (nx * ny > 1.5 && top) {
    vec2 dd = hs - abs(cc);
    float seam = 1.0 - smoothstep(0.0, max(0.035 * min(cell.x, cell.y), px), min(dd.x, dd.y));
    albedo = mix(albedo, vec3(0.02), seam * 0.85);
  }
  if (tiers > 1.5 && !top) {
    float tz = fract(vLocal.z / max(vSize.z / tiers, 0.1));
    float seam = 1.0 - smoothstep(0.0, 0.06, min(tz, 1.0 - tz));
    albedo *= 1.0 - 0.7 * seam;
  }
  if (chamfer) albedo *= 1.08;
  vec3 col = cgShade(albedo, Nb, normalize(vObjL), vLook.w, hullL, specK, specPow);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Cień: prostokąt obrysu (L × W, kurs yaw) przeciągnięty od z0 do z1 wzdłuż
// kierunku od słońca. Pokrycie liczone z odległości do przeciągniętego
// prostokąta (6 próbek wzdłuż cienia), półcień rośnie z wysokością.
const SHADOW_COMMON_GLSL = `
float cgSdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float cgSwept(vec2 p, vec2 hs, vec2 o0, vec2 o1) {
  float d = 1e9;
  for (int i = 0; i < 6; i++) {
    float t = float(i) / 5.0;
    d = min(d, cgSdBox(p - mix(o0, o1, t), hs));
  }
  return d;
}
`;

const SHADOW_VERT = `
attribute vec4 iPos;
attribute vec4 iBox;
attribute vec4 iPar;
${CARGO_VIEW_GLSL}
uniform vec3 uCgSunRel;
uniform vec3 uCgPortSun;
uniform vec4 uShadow;
varying vec2 vP;
flat varying vec4 vBox;
flat varying vec4 vPar;
flat varying vec4 vOff;

void main() {
  vBox = iBox;
  vPar = iPar;
  float c = cos(iPos.w);
  float s = sin(iPos.w);
  // Kierunek od słońca i tangens wysokości: kadłub — „słońce cieni” (azymut
  // prawdziwego słońca, niska wysokość), port — słońce ringu.
  vec2 dirW;
  float tanE;
  float baseZ;
  if (uShadow.w > 0.5) {
    vec2 h = uCgPortSun.xy;
    float hl = max(length(h), 1e-4);
    dirW = -h / hl;
    tanE = max(uCgPortSun.z / hl, 0.05);
    baseZ = iPar.w;
  } else {
    dirW = -normalize(uCgSunRel.xy - iPos.xy + vec2(1e-3, 0.0));
    tanE = uShadow.x;
    baseZ = 0.0;
  }
  vec2 dirL = vec2(c * dirW.x + s * dirW.y, -s * dirW.x + c * dirW.y);
  vec2 o0 = dirL * max(iBox.z - baseZ, 0.0) / tanE;
  vec2 o1 = dirL * max(iBox.w - baseZ, 0.0) / tanE;
  vOff = vec4(o0, o1);
  vec2 hs = iBox.xy * 0.5;
  float pad = uShadow.z * length(o1) + 0.25 * min(iBox.x, iBox.y) + 0.5;
  vec2 lo = -hs + min(min(o0, o1), vec2(0.0)) - pad;
  vec2 hi = hs + max(max(o0, o1), vec2(0.0)) + pad;
  vec2 m = mix(lo, hi, position.xy + 0.5);
  vP = m;
  vec2 xy = vec2(iPos.x + c * m.x - s * m.y, iPos.y + s * m.x + c * m.y);
  // Pokład portu: paralaksa jak płyta pod nim. Kadłub: tuż pod nim, bez
  // paralaksy (kadłub jest ortho) — sama głębia za kadłubem dla testu GREATER.
  gl_Position = uShadow.w > 0.5
    ? cgProject(vec3(xy, baseZ + 0.3))
    : projectionMatrix * modelViewMatrix * vec4(xy, ${HULL_SHADOW_Z.toFixed(2)}, 1.0);
}
`;

const SHADOW_FRAG = `
${SHADOW_COMMON_GLSL}
${SUN_SHADOW_GLSL}
uniform vec4 uShadow;
uniform vec4 uShadowMix;
varying vec2 vP;
flat varying vec4 vBox;
flat varying vec4 vPar;
flat varying vec4 vOff;

void main() {
  vec2 hs = vBox.xy * 0.5;
  float a;
  if (vPar.z > 0.5) {
    // Właz windy placu: ciemny prostokąt o ostrych brzegach.
    float d = cgSdBox(vP, hs);
    float aa = max(fwidth(d), 1e-3);
    a = (1.0 - smoothstep(-aa, aa, d)) * vPar.x;
  } else {
    float d = cgSwept(vP, hs, vOff.xy, vOff.zw);
    float reach = length(vOff.zw);
    float soft = max(uShadow.y * reach + 0.06 * min(vBox.x, vBox.y), max(fwidth(d), 1e-3));
    float body = 1.0 - smoothstep(-soft, soft, d);
    // Kontakt: przy podstawie stojącego kontenera ciemniej (AO).
    float contact = (1.0 - smoothstep(0.0, 0.18 * min(vBox.x, vBox.y) + 0.3, cgSdBox(vP, hs))) * vPar.y;
    float vis = uShadow.w > 0.5 ? uShadowMix.x : sunVisibility();
    a = max(body * vis, contact) * vPar.x;
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, min(a, 0.9));
}
`;

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

// Sfazowany prostopadłościan: x, y ∈ [−½, ½], z ∈ [0, 1]; aBevel = przesunięcie
// wierzchołka o fazę (xy do środka, z w dół) — faza w jednostkach świata liczy
// shader (niezależnie od skali instancji). Bez dna (nigdy go nie widać z góry).
export function buildContainerGeometry() {
  const pos = [];
  const nrm = [];
  const bev = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0], v[1], v[2]);
      bev.push(v[3], v[4], v[5]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const S = Math.SQRT1_2;
  // wierzchołki: [x, y, z, bevX, bevY, bevZ]
  const B = (x, y) => [x, y, 0, 0, 0, 0];
  const O = (x, y) => [x, y, 1, 0, 0, -1];                         // górny pierścień zewnętrzny (opuszczony o fazę)
  const I = (x, y) => [x, y, 1, -Math.sign(x), -Math.sign(y), 0];  // wierzch (cofnięty o fazę)
  const h = 0.5;
  // boki
  quad(B(h, -h), B(h, h), O(h, h), O(h, -h), [1, 0, 0]);
  quad(B(-h, h), B(-h, -h), O(-h, -h), O(-h, h), [-1, 0, 0]);
  quad(B(h, h), B(-h, h), O(-h, h), O(h, h), [0, 1, 0]);
  quad(B(-h, -h), B(h, -h), O(h, -h), O(-h, -h), [0, -1, 0]);
  // fazy
  quad(O(h, -h), O(h, h), I(h, h), I(h, -h), [S, 0, S]);
  quad(O(-h, h), O(-h, -h), I(-h, -h), I(-h, h), [-S, 0, S]);
  quad(O(h, h), O(-h, h), I(-h, h), I(h, h), [0, S, S]);
  quad(O(-h, -h), O(h, -h), I(h, -h), I(-h, -h), [0, -S, S]);
  // wierzch
  quad(I(-h, -h), I(h, -h), I(h, h), I(-h, h), [0, 0, 1]);
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    bevel: new Float32Array(bev),
    index: new Uint16Array(idx)
  };
}

function makeInstanceAttr(geometry, name, itemSize, capacity) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

// Upload tylko użytej części (jeden obiekt zakresu na atrybut — bez alokacji).
function commitAttr(attr, count) {
  if (count <= 0) return;
  const ranges = attr.updateRanges;
  if (Array.isArray(ranges)) {
    const r = attr.__cgRange || (attr.__cgRange = { start: 0, count: 0 });
    r.start = 0;
    r.count = count * attr.itemSize;
    ranges.length = 0;
    ranges.push(r);
  }
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Pomocnicze: poza, światło kadłuba
// ---------------------------------------------------------------------------

/**
 * Jasność kadłuba pod punktem sprite'a — lustro HEX_FRAGMENT_SHADER bez normal
 * mapy (jak hullLightAt w bridge3D.js): poduszkowa normalna z UV sprite'a
 * (px, py ∈ [−1, 1]), kurs sceny θ, kierunek do słońca (scena, z = 600).
 */
export function cargoHullLight(px, py, theta, lx, ly, lz, ambient, diffuse) {
  let nx = px * 0.45;
  let ny = -py * 0.45;
  const nl = Math.hypot(nx, ny, 1);
  nx /= nl; ny /= nl;
  const nz = 1 / nl;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const wx = nx * c - ny * s;
  const wy = nx * s + ny * c;
  return ambient + diffuse * Math.max(0, wx * lx + wy * ly + nz * lz);
}

const _v = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Moduł
// ---------------------------------------------------------------------------

export const CargoContainers3D = {
  scene: null,
  ready: false,
  mesh: null,
  attrs: null,
  hullShadow: null,
  deckShadow: null,
  uniforms: null,
  frame: null,
  count: 0,
  counts: { deck: 0, loose: 0, yard: 0 },
  stats: { instances: 0, deck: 0, loose: 0, yard: 0, hullShadows: 0, deckShadows: 0, drawCalls: 0, cpuMs: 0, culled: 0, faded: 0 },

  /** Podpina moduł do sceny (w grze: Core3D.scene). Bez własnego renderera. */
  attach(scene) {
    if (this.scene === scene && this.ready) return true;
    this.dispose();
    if (!scene) return false;
    this.scene = scene;
    const U = {
      uCgParallax: { value: new THREE.Vector4(0, 0, 1e6, 0) },
      uCgDepth: { value: new THREE.Vector2(CARGO3D_TUNE.depthSquash, 1) },
      uCgShip: { value: new THREE.Vector4() },
      uCgPort: { value: new THREE.Vector4() },
      uCgSunRel: { value: new THREE.Vector3(-1e6, 5e5, 600) },
      uCgPortSun: { value: new THREE.Vector3(0.5, 0.3, 0.75).normalize() },
      ...sunShadowUniforms
    };
    this.uniforms = U;

    // Kontenery.
    {
      const g = buildContainerGeometry();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('aBevel', new THREE.BufferAttribute(g.bevel, 3));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      const attrs = {
        pos: makeInstanceAttr(geo, 'iPos', 4, CAPACITY),
        size: makeInstanceAttr(geo, 'iSize', 4, CAPACITY),
        look: makeInstanceAttr(geo, 'iLook', 4, CAPACITY),
        extra: makeInstanceAttr(geo, 'iExtra', 4, CAPACITY)
      };
      geo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...U,
          uStd: { value: vecs(STANDARD_PAINTS) },
          uShell: { value: vecs(TANK_SHELLS) },
          uFrame: { value: vecs(TANK_FRAMES) },
          uBody: { value: vecs(HOPPER_BODIES) },
          uRes: { value: RESOURCE_KEYS.map((k) => new THREE.Vector3(...hexToLinear(RESOURCES[k].color))) },
          uHazmat: { value: new THREE.Vector3(...hexToLinear(HAZMAT_PAINT)) },
          uCover: { value: new THREE.Vector3(...hexToLinear(COVER_PAINT)) },
          uAmber: { value: new THREE.Vector3(...hexToLinear('#c8861e')) }
        },
        vertexShader: CONTAINER_VERT,
        fragmentShader: CONTAINER_FRAG,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
        forceSinglePass: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'CARGO3D_CONTAINERS';
      mesh.frustumCulled = false;
      mesh.renderOrder = MODEL_RENDER_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      this.mesh = mesh;
      this.attrs = attrs;
    }

    // Cienie: kadłub (GREATER) i pokład portu.
    const shadowPart = (name, capacity, deck) => {
      const geo = new THREE.InstancedBufferGeometry();
      const plane = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      const attrs = {
        pos: makeInstanceAttr(geo, 'iPos', 4, capacity),
        box: makeInstanceAttr(geo, 'iBox', 4, capacity),
        par: makeInstanceAttr(geo, 'iPar', 4, capacity)
      };
      geo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uShadow: { value: new THREE.Vector4() }, uShadowMix: { value: new THREE.Vector4(1, 0, 0, 0) } },
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        depthFunc: deck ? THREE.LessEqualDepth : THREE.GreaterDepth,
        blending: THREE.NormalBlending
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = deck ? DECK_SHADOW_ORDER : HULL_SHADOW_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, geometry: geo, material: mat, attrs, count: 0, capacity };
    };
    this.hullShadow = shadowPart('CARGO3D_HULL_SHADOW', CARGO3D_LIMITS.hullShadows, false);
    this.deckShadow = shadowPart('CARGO3D_DECK_SHADOW', CARGO3D_LIMITS.deckShadows, true);
    this.frame = {
      originX: 0, originY: 0, camX: 0, camY: 0, H: 1e6, parallax: false, pxPerUnit: 1,
      viewHalfW: Infinity, viewHalfH: Infinity, sunX: -1e6, sunY: 5e5, time: 0,
      lx: 0, ly: 0, lz: 1, tanShadow: Math.tan(30 * DEG)
    };
    this.ready = true;
    return true;
  },

  setLayer(layer = 0) {
    for (const m of [this.mesh, this.hullShadow?.mesh, this.deckShadow?.mesh]) if (m) m.layers.set(layer);
  },

  /**
   * Początek klatki. opts:
   *   camera       — kamera gry { x, y, zoom } (świat gry, y w dół): początek
   *                  danych i środek paralaksy,
   *   cameraHeight — wysokość kamery persp nad z = 0 (Core3D.syncCamera:
   *                  (wys. bufora / 2) / tan(fov / 2) / zoom),
   *   pxPerUnit    — piksele ekranu na jednostkę w płaszczyźnie lotu (zoom),
   *   viewHalfW/H  — połowa kadru w jednostkach świata (kadrowanie; brak = bez),
   *   perspective  — wolna kamera (true z, bez paralaksy i ścisku głębi),
   *   origin       — { x, y } scena (domyślnie środek kadru),
   *   sun          — Słońce gry { x, y } (światło kadłubów),
   *   portSun      — { dir: [x, y, z] scena, daylight } — słońce ringu,
   *   time         — czas animacji [s].
   */
  begin(opts = {}) {
    if (!this.ready) return;
    const T = CARGO3D_TUNE;
    const F = this.frame;
    const cam = opts.camera || { x: 0, y: 0, zoom: 1 };
    F.camX = Number(cam.x) || 0;
    F.camY = -(Number(cam.y) || 0);
    F.originX = Number.isFinite(opts.origin?.x) ? opts.origin.x : F.camX;
    F.originY = Number.isFinite(opts.origin?.y) ? opts.origin.y : F.camY;
    F.perspective = !!opts.perspective;
    F.H = Math.max(1, Number(opts.cameraHeight) || 1e6);
    F.parallax = !F.perspective && Number.isFinite(Number(opts.cameraHeight));
    F.pxPerUnit = Math.max(1e-6, Number(opts.pxPerUnit) || Number(cam.zoom) || 1);
    F.viewHalfW = Number(opts.viewHalfW) > 0 ? Number(opts.viewHalfW) : Infinity;
    F.viewHalfH = Number(opts.viewHalfH) > 0 ? Number(opts.viewHalfH) : Infinity;
    const sun = opts.sun || (typeof window !== 'undefined' ? window.SUN : null);
    F.sunX = Number.isFinite(sun?.x) ? sun.x : F.camX - 60000;
    F.sunY = Number.isFinite(sun?.y) ? -sun.y : F.camY + 40000;
    F.time = Number(opts.time) || 0;
    F.tanShadow = Math.tan(Math.max(5, Math.min(85, T.shadowElevDeg)) * DEG);
    const U = this.uniforms;
    U.uCgParallax.value.set(F.camX - F.originX, F.camY - F.originY, F.H, F.parallax ? 1 : 0);
    U.uCgDepth.value.set(T.depthSquash, F.perspective ? 0 : 1);
    U.uCgShip.value.set(T.ambient, T.diffuse, T.specular, 0);
    const day = Number.isFinite(opts.portSun?.daylight) ? Math.max(0, Math.min(1, opts.portSun.daylight)) : 1;
    U.uCgPort.value.set(T.portAmbient * (0.35 + 0.65 * day), T.portDiffuse, T.portSpecular, day);
    U.uCgSunRel.value.set(F.sunX - F.originX, F.sunY - F.originY, 600);
    const d = opts.portSun?.dir;
    if (d && d.length >= 3) U.uCgPortSun.value.set(d[0], d[1], d[2]).normalize();
    else if (d && Number.isFinite(d.x)) U.uCgPortSun.value.set(d.x, d.y, d.z).normalize();
    this.hullShadow.material.uniforms.uShadow.value.set(F.tanShadow, T.shadowSoft, 0.08, 0);
    this.deckShadow.material.uniforms.uShadow.value.set(1, T.shadowSoft, 0.06, 1);
    this.deckShadow.material.uniforms.uShadowMix.value.set(day, 0, 0, 0);
    for (const m of [this.mesh, this.hullShadow.mesh, this.deckShadow.mesh]) m.position.set(F.originX, F.originY, 0);
    this.count = 0;
    this.counts.deck = 0;
    this.counts.loose = 0;
    this.counts.yard = 0;
    this.hullShadow.count = 0;
    this.deckShadow.count = 0;
    this.stats.culled = 0;
    this.stats.faded = 0;
    this._t0 = performance.now();
  },

  // Skala paralaksy w punkcie (x, y scena, z) — do LOD i kadrowania.
  _k(z) {
    const F = this.frame;
    return F.parallax && z < 0 ? F.H / Math.max(F.H - z, 1) : 1;
  },

  _inView(sx, sy, r) {
    const F = this.frame;
    return Math.abs(sx - F.camX) <= F.viewHalfW + r && Math.abs(sy - F.camY) <= F.viewHalfH + r;
  },

  /**
   * Kontener (dowolny: pokład, hak drona, plac). Scena: sx, sy, z (podstawa),
   * yaw (kurs sceny), L × W × H, res (indeks surowca), seed (wygląd), light
   * (0 statek … 1 port), clipZ (wyłaz), hullL (jasność kadłuba pod nim),
   * grid (podsiatka: nx + 8 ny + 64 tiers), kind: 'deck' | 'loose' | 'yard',
   * family (−1 = z surowca; 3 = płyta maski). Zwraca true, gdy dodany.
   */
  pushContainer(sx, sy, z, yaw, L, W, H, res, seed, light, clipZ, hullL, grid, kind = 'deck', family = -1) {
    if (!this.ready || !CARGO3D_TUNE.enabled) return false;
    const lim = CARGO3D_LIMITS[kind] ?? 0;
    if (this.counts[kind] >= lim || this.count >= CAPACITY) return false;
    const k = this._k(z);
    const px = Math.min(L, W) * this.frame.pxPerUnit * k;
    const fade = smooth01(CARGO3D_TUNE.minPx, CARGO3D_TUNE.fullPx, px);
    if (fade <= 0.01) { this.stats.faded++; return false; }
    if (!this._inView(sx, sy, Math.max(L, W) + H)) { this.stats.culled++; return false; }
    const n = this.count++;
    this.counts[kind]++;
    const F = this.frame;
    const A = this.attrs;
    const o = n * 4;
    const P = A.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = z; P[o + 3] = yaw;
    const S = A.size.array;
    S[o] = L; S[o + 1] = W; S[o + 2] = H; S[o + 3] = fade;
    const ri = res >= 0 && res < RES_COUNT ? res : 0;
    const Lk = A.look.array;
    Lk[o] = family >= 0 ? family : RES_FAMILY[ri]; Lk[o + 1] = ri; Lk[o + 2] = seed; Lk[o + 3] = light;
    const E = A.extra.array;
    E[o] = Number.isFinite(clipZ) ? clipZ : NO_CLIP; E[o + 1] = grid; E[o + 2] = RES_MAT[ri]; E[o + 3] = hullL;
    // Cienie: pokład statku — na kadłub; niesiony — na kadłub pod nim (GREATER
    // rysuje tylko na kadłubie) i na pokład portu; plac — na pokład portu.
    if (CARGO3D_TUNE.drawShadows && px >= CARGO3D_TUNE.shadowMinPx) {
      const sf = smooth01(CARGO3D_TUNE.shadowMinPx, CARGO3D_TUNE.shadowFullPx, px) * fade;
      if (kind !== 'yard' && z + H > 0) this.pushHullShadow(sx, sy, yaw, L, W, Math.max(0, z), z + H, CARGO3D_TUNE.shadowStrength * sf, kind === 'deck' ? CARGO3D_TUNE.contactAo * sf : 0);
      if (kind !== 'deck') this.pushDeckShadow(sx, sy, yaw, L, W, z, z + H, CARGO3D_TUNE.deckShadowStrength * sf, kind === 'yard' ? CARGO3D_TUNE.contactAo * sf : 0, this._deckZ);
    }
    return true;
  },

  /** Cień na kadłubie (GREATER): obrys L × W, kurs yaw, wysokość z0…z1 nad z = 0. */
  pushHullShadow(sx, sy, yaw, L, W, z0, z1, strength, contact = 0) {
    const R = this.hullShadow;
    if (!R || R.count >= R.capacity || strength <= 0.003) return false;
    const n = R.count++;
    const F = this.frame;
    const o = n * 4;
    const P = R.attrs.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = 0; P[o + 3] = yaw;
    const B = R.attrs.box.array;
    B[o] = L; B[o + 1] = W; B[o + 2] = z0; B[o + 3] = z1;
    const Q = R.attrs.par.array;
    Q[o] = strength; Q[o + 1] = contact; Q[o + 2] = 0; Q[o + 3] = 0;
    return true;
  },

  /**
   * Cień na pokładzie portu (słońce ringu) albo właz windy (hatch = true:
   * ciemny prostokąt L × W, strength = otwarcie). deckZ — wysokość płyty.
   */
  pushDeckShadow(sx, sy, yaw, L, W, z0, z1, strength, contact = 0, deckZ = this._deckZ, hatch = false) {
    const R = this.deckShadow;
    if (!R || R.count >= R.capacity || strength <= 0.003) return false;
    const n = R.count++;
    const F = this.frame;
    const o = n * 4;
    const P = R.attrs.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = 0; P[o + 3] = yaw;
    const B = R.attrs.box.array;
    B[o] = L; B[o + 1] = W; B[o + 2] = z0; B[o + 3] = z1;
    const Q = R.attrs.par.array;
    Q[o] = strength; Q[o + 1] = contact; Q[o + 2] = hatch ? 1 : 0; Q[o + 3] = deckZ;
    return true;
  },

  _deckZ: -114.5,
  /** Wysokość pokładu portu dla cieni (domyślnie płyta pola stanowiska). */
  setDeckZ(z) { if (Number.isFinite(z)) this._deckZ = z; },

  /**
   * Pokład statku: kontenery w slotach układu ładowni. pose — { x, y, angle }
   * świat gry (poza RENDERU statku), layoutId, slotRes — Int16Array surowców
   * w slotach (−1 pusty), seed — ziarno kursu. opts: spriteRotation, scale
   * (j./px), mask (Uint8Array: 0 = komórka kadłuba zniszczona — slot pusty,
   * kontener do łupu później), deckMode: 'empty' (sprite z pustym pokładem)
   * | 'painted' (stary sprite: płyty maski na pustych slotach).
   */
  pushShipDeck(pose, layoutId, slotRes, seed = 0, opts = {}) {
    if (!this.ready || !CARGO3D_TUNE.drawContainers) return 0;
    const lay = cargoHoldLayout(layoutId);
    if (!lay || !pose) return 0;
    const F = this.frame;
    const T = CARGO3D_TUNE;
    const slots = cargoHoldSlots(lay);
    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : cargoLayoutScale(lay);
    const unit = cargoUnitSize(lay, scale, this._unit || (this._unit = {}));
    const ang = (Number(pose.angle) || 0) + (Number(opts.spriteRotation) || 0);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const X = Number(pose.x) || 0;
    const Y = Number(pose.y) || 0;
    const yaw = -ang;
    // Kadrowanie całego statku (promień z płótna).
    const R = 0.5 * Math.hypot(lay.png.w, lay.png.h) * scale;
    if (!this._inView(X, -Y, R)) { this.stats.culled += slots.length; return 0; }
    const px = Math.min(unit.L, unit.W) * F.pxPerUnit;
    if (px < T.minPx) { this.stats.faded += slots.length; return 0; }
    const grid = lay.unit.nx + 8 * lay.unit.ny + 64 * lay.unit.tiers;
    // Światło kadłuba: kierunek do słońca w scenie (z = 600), jak hexShips3D.
    let lx = F.sunX - X;
    let ly = F.sunY + Y;
    let lz = 600;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const halfW = lay.png.w / 2;
    const halfH = lay.png.h / 2;
    const painted = opts.deckMode === 'painted';
    const mask = opts.mask || null;
    let pushed = 0;
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i];
      const r = slotRes ? slotRes[i] : -1;
      const alive = !mask || mask[i] !== 0;
      if ((r < 0 || !alive) && !painted) continue;
      const lxp = sl.x * scale;
      const lyp = sl.y * scale;
      const gx = X + lxp * c - lyp * s;
      const gy = Y + lxp * s + lyp * c;
      const hullL = cargoHullLight(sl.x / halfW, sl.y / halfH, yaw, lx, ly, lz, T.ambient, T.diffuse);
      if (r >= 0 && alive) {
        if (this.pushContainer(gx, -gy, SHIP_Z, yaw, unit.L, unit.W, unit.H, r, cargoHash01(seed, i, 5), 0, NO_CLIP, hullL, grid, 'deck')) pushed++;
      } else if (painted && alive) {
        this.pushContainer(gx, -gy, SHIP_Z, yaw, sl.w * scale, sl.h * scale, COVER_H, 0, 0, 0, NO_CLIP, hullL, 1 + 8 + 64, 'deck', CONTAINER_FAMILY_CODE.cover);
      }
    }
    return pushed;
  },

  /**
   * Kontener w układzie stanowiska (niesiony albo na placu): berthPose —
   * { x, y, angle } świata gry (poza stanowiska = statku zadokowanego), u, v,
   * z, yaw (lokalny), unit — wymiary (cargoUnitSize), grid, res, seed, clipZ,
   * light, kind 'loose' | 'yard'.
   */
  pushBerthContainer(berthPose, u, v, z, yaw, unit, grid, res, seed, clipZ, light, kind = 'loose') {
    const ang = Number(berthPose.angle) || 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const gx = berthPose.x + u * c - v * s;
    const gy = berthPose.y + u * s + v * c;
    return this.pushContainer(gx, -gy, z, -(ang + yaw), unit.L, unit.W, unit.H, res, seed, light, clipZ, this.uniforms.uCgShip.value.x, grid, kind);
  },

  /** Właz windy placu w układzie stanowiska (ciemny prostokąt na płycie). */
  pushBerthHatch(berthPose, u, v, yaw, L, W, open, deckZ = this._deckZ) {
    const ang = Number(berthPose.angle) || 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const gx = berthPose.x + u * c - v * s;
    const gy = berthPose.y + u * s + v * c;
    return this.pushDeckShadow(gx, -gy, -(ang + yaw), L, W, deckZ, deckZ, 0.92 * open, 0, deckZ, true);
  },

  /** Koniec klatki: wysyłka instancji (tylko użyte zakresy). */
  end() {
    if (!this.ready) return;
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    let draws = 0;
    if (n) {
      draws++;
      for (const a of Object.values(this.attrs)) commitAttr(a, n);
    }
    for (const R of [this.hullShadow, this.deckShadow]) {
      R.geometry.instanceCount = R.count;
      R.mesh.visible = R.count > 0;
      if (R.count) {
        draws++;
        for (const a of Object.values(R.attrs)) commitAttr(a, R.count);
      }
    }
    const S = this.stats;
    S.instances = n;
    S.deck = this.counts.deck;
    S.loose = this.counts.loose;
    S.yard = this.counts.yard;
    S.hullShadows = this.hullShadow.count;
    S.deckShadows = this.deckShadow.count;
    S.drawCalls = draws;
    const ms = performance.now() - (this._t0 || performance.now());
    S.cpuMs = S.cpuMs > 0 ? S.cpuMs * 0.9 + ms * 0.1 : ms;
  },

  dispose() {
    const scene = this.scene;
    for (const part of [this.mesh ? { mesh: this.mesh } : null, this.hullShadow, this.deckShadow]) {
      if (!part?.mesh) continue;
      if (scene) scene.remove(part.mesh);
      part.mesh.geometry?.dispose?.();
      part.mesh.material?.dispose?.();
    }
    this.mesh = null;
    this.attrs = null;
    this.hullShadow = null;
    this.deckShadow = null;
    this.uniforms = null;
    this.scene = null;
    this.ready = false;
  }
};

/** Klucz surowca dla indeksu (pomocnicze dla HUD dema). */
export function cargoResourceLabel(index) {
  const id = cargoResourceKey(index);
  return id ? RESOURCES[id].label : '—';
}

if (typeof window !== 'undefined') window.CargoContainers3D = CargoContainers3D;
