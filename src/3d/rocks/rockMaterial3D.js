// src/3d/rocks/rockMaterial3D.js
//
// Materiał skał (instancje z rockLayer3D) + objętość szumu do rud i detalu.
//
// Kształt: shader wierzchołków czyta promień z mapy oktaedrycznej banku
// (rockShapes3D), rozciąga, obraca (kwaternion bazowy × obrót wokół osi
// w czasie — zero uploadu na klatkę) i skaluje promieniem instancji.
// Pozycje instancji są względem początku przy kamerze (mesh.position) —
// float32 na GPU nie drga przy 5–10 mln j. (sceneOrigin.js, AGENTS.md).
//
// Światło: prawdziwe słońce (kierunek z pozycji skały do słońca, jak na
// kadłubach w hexShips3D) podniesione o uSunElev. Rozproszenie = Lambert
// z domieszką Lommela–Seeligera (regolit: płaska tarcza bez ciemnienia
// brzegu), otoczenie z góry kadru + odbicie od pyłu po stronie cienia.
// Maska cienia słońca Core3D: sunVisibility() gasi człon słońca, sunFill()
// otoczenie (warstwa gry); tło — sunShaftBackdrop (smuga jak mgławica).
//
// Typy (asteroidRockKinds.ROCK_TYPES) mają WŁASNE programy powierzchni, nie
// jedną żyłę w innym kolorze — każdy czytelny z daleka po czymś innym:
//   żelazo  — odsłonięty metal z połyskiem, rdza w zagłębieniach, „odciski
//             kciuka” (regmaglipty) i krata lamel Widmanstättena z bliska;
//   miedź   — skorupy malachitu z koncentrycznymi pasami, plamki azurytu,
//             żyłki i bryłki rodzimej miedzi (metal);
//   krzem   — jasny chondryt: ziarna chondr, mleczne żyły kwarcu, iskry;
//   tytan   — warstwy (ilmenit czarny z połyskiem, szary plagioklaz, złote
//             pasma rutylu) z tarasami na granicach warstw;
//   kryształ— ciemna skała ze świecącymi szczelinami (kryształy to osobne
//             bryły: rockMinerals3D.js);
//   lód     — szkliwo z niebieskimi szczelinami, pasy pyłu, prześwit, szron;
//   uran    — czarny smolinek (uraninit) z bąblowatą powierzchnią i połyskiem
//             smoły, żółtozielona świecąca skorupa autunitu i torbernitu;
//   neutralna — zwykła skała (wypełniacz): regolit, kratery, bez akcentów.
// Wzory liczone w układzie skały (obracają się razem z nią), cechy o skali
// rozmiaru skały (Q = p / R) albo świata (ziarno, lamele), wygaszane, gdy
// mają poniżej ~2 px. Pochodne (linie, relief) tylko POZA gałęziami typów —
// FXC spłaszcza gałęzie z gradientami i liczyłby wszystkie typy naraz.

import * as THREE from 'three';
import { ROCK_OCT_GLSL } from './rockShapes3D.js';
import { SUN_SHADOW_GLSL, attachSunShadowUniforms } from '../sunShadowMask.js';
import { FIELD_LIGHTS_GLSL, attachFieldLightUniforms } from '../fieldLights3D.js';
import { ROCK_TYPES, SHAPE_COUNT } from '../../game/asteroidRockKinds.js';

export const ROCK_TYPE_COUNT = ROCK_TYPES.length;

// Kolejność = ROCK_TYPES: iron, copper, silicon, titan, crystal, ice, uran, rock.
// Barwy w sRGB (strojenie na oko), do shadera idą liniowo. Znaczenie akcentów
// a/b/c/d zależy od typu (opis przy każdym). Liczby:
//   aSpec  — połysk akcentu a; bParam — parametr akcentu b; emit — emisja HDR
//   cover  — pokrycie akcentem (0..1); line — szerokość linii żył [j.]
//   sparkle — iskry ziaren; ice — prześwit lodu; gloss — wykładnik połysku
//   metal  — metaliczność akcentu (połysk w barwie metalu); relief — głębokość reliefu (× R)
// JASNOŚĆ: słońce ma moc 1,9, próg bloomu ~0,9 — albedo powierzchni najwyżej
// ~0,3 liniowo (sRGB ≈ #95), inaczej bryła prześwietla się na biało i świeci.
// Jasne akcenty (kwarc, szron) tylko w cienkich liniach i drobnych plamkach.
export const ROCK_TYPE_LOOKS = Object.freeze([
  // żelazo: a = metal, b = rdza, c = jaśniejsza lamela, d = ciemna ruda żelaza
  Object.freeze({ id: 'iron', base: '#3e3935', base2: '#26221f', a: '#44484e', aSpec: 0.7, b: '#5a2b15', bParam: 0.55, c: '#80868e', d: '#2e2926', emit: 0, cover: 0.4, line: 0, sparkle: 0.35, ice: 0, gloss: 60, metal: 1, relief: 0.05 }),
  // miedź: a = malachit jasny, b = malachit ciemny, c = rodzima miedź, d = azuryt
  Object.freeze({ id: 'copper', base: '#4a4540', base2: '#302c28', a: '#2f8a58', aSpec: 0.3, b: '#0d3a26', bParam: 0.5, c: '#b8683a', d: '#1d3a94', emit: 0, cover: 0.3, line: 11, sparkle: 0.2, ice: 0, gloss: 60, metal: 1, relief: 0.03 }),
  // krzem: a = kwarc, b = ciemna chondra, c = rdzawa chondra, d = jasna chondra
  Object.freeze({ id: 'silicon', base: '#827b71', base2: '#5f5951', a: '#b7bbbf', aSpec: 0.7, b: '#4a443d', bParam: 0.5, c: '#7f6246', d: '#a39d92', emit: 0, cover: 0.25, line: 13, sparkle: 1.0, ice: 0, gloss: 70, metal: 0, relief: 0.02 }),
  // tytan: a = ilmenit (czarny, połysk), b = szary środek, c = rutyl (złoty), d = jasny plagioklaz
  Object.freeze({ id: 'titan', base: '#72777d', base2: '#4f545a', a: '#16181b', aSpec: 0.9, b: '#4b5056', bParam: 7.0, c: '#7c5d28', d: '#7a7f85', emit: 0, cover: 0.5, line: 0, sparkle: 0.5, ice: 0, gloss: 70, metal: 0.8, relief: 0.03 }),
  // kryształ: a = cyjan (świecenie), b = fiolet, c = szron kryształów, d = —
  Object.freeze({ id: 'crystal', base: '#3a3444', base2: '#201c27', a: '#5ce1ff', aSpec: 1.2, b: '#a070ff', bParam: 0.5, c: '#9fc4e0', d: '#2a2433', emit: 0.9, cover: 0.3, line: 9, sparkle: 0.8, ice: 0, gloss: 72, metal: 0, relief: 0.03 }),
  // lód: a = szczelina (głęboki błękit), b = pył, c = poświata prześwitu, d = szron
  Object.freeze({ id: 'ice', base: '#8699aa', base2: '#62768a', a: '#123f78', aSpec: 0.55, b: '#3d3630', bParam: 0.4, c: '#5aa9ff', d: '#9fb1c1', emit: 0, cover: 0.4, line: 12, sparkle: 0.6, ice: 1, gloss: 80, metal: 0, relief: 0.03 }),
  // uran: a = autunit (żółtozielony), b = torbernit (zielony), c = świecenie, d = „yellowcake”
  // Zieleń ma największą wagę luminancji — emisja ciemniejsza od kryształu
  // (inaczej cała bryła tonie w zielonym bloomie).
  Object.freeze({ id: 'uran', base: '#1e1f19', base2: '#0d0e0a', a: '#7a8f2a', aSpec: 0.45, b: '#25733f', bParam: 0.5, c: '#58d843', d: '#a8973a', emit: 0.7, cover: 0.3, line: 6, sparkle: 0.03, ice: 0, gloss: 32, metal: 0, relief: 0.045 }),
  // neutralna: a = chłodna jasna, b = chłodna ciemna (odcień per skała), c = jasny głaz, d = ciemny regolit
  Object.freeze({ id: 'rock', base: '#5c554d', base2: '#3b3631', a: '#595b5e', aSpec: 0.04, b: '#37383a', bParam: 0.5, c: '#77716a', d: '#2c2926', emit: 0, cover: 0.3, line: 0, sparkle: 0.05, ice: 0, gloss: 12, metal: 0, relief: 0.025 }),
  // energetyczna (burze, asteroidStorms.js): a = błękitna biel łuku (gorące
  // pęknięcia), b = fiolet ładunku, c = emisja HDR pęknięć, d = szklisty czarny bazalt
  Object.freeze({ id: 'energy', base: '#26213a', base2: '#110e1a', a: '#a8ecff', aSpec: 0.6, b: '#8a3cff', bParam: 0.5, c: '#b8f0ff', d: '#0c0a12', emit: 1.6, cover: 0.75, line: 6, sparkle: 0.5, ice: 0, gloss: 55, metal: 0, relief: 0.04 })
]);

export const ROCK_LIGHT_DEFAULTS = Object.freeze({
  sunColor: [1.0, 0.95, 0.88],
  sunIntensity: 1.9,
  sunElevDeg: 24,
  ambientTop: [0.16, 0.18, 0.22],
  ambientBounce: [0.10, 0.085, 0.07],
  lunar: 0.35,
  wrap: 0.12,
  exposure: 1.0,
  // Tło: zamglenie z głębokością (barwa pyłu w cieniu, udział na j. głębokości).
  hazeColor: [0.030, 0.034, 0.045],
  hazePerUnit: 1 / 26000
});

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex, out = new THREE.Vector3()) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return out.set(
    srgbToLinear(((v >> 16) & 255) / 255),
    srgbToLinear(((v >> 8) & 255) / 255),
    srgbToLinear((v & 255) / 255)
  );
}

// ---------------------------------------------------------------------------
// Objętość szumu (kafelkowana) — pieczona raz na GPU

const NOISE_VERTEX = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NOISE_FRAGMENT = /* glsl */`
precision highp float;
precision highp int;
uniform float uSize;
uniform float uSlice;
uint hashu(uvec3 p) {
  p = p * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint h = (p.x ^ p.y ^ p.z) * 1597334673u;
  h ^= h >> 16u;
  h *= 2246822519u;
  h ^= h >> 13u;
  return h;
}
float hash01(ivec3 c, int period, uint salt) {
  ivec3 w = ((c % period) + period) % period;
  return float(hashu(uvec3(w) + uvec3(salt, salt * 7u, salt * 13u)) & 0xFFFFFFu) / 16777215.0;
}
float tnoise(vec3 p, int period, uint salt) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float a = hash01(c, period, salt);
  float b = hash01(c + ivec3(1, 0, 0), period, salt);
  float cc = hash01(c + ivec3(0, 1, 0), period, salt);
  float d = hash01(c + ivec3(1, 1, 0), period, salt);
  float e = hash01(c + ivec3(0, 0, 1), period, salt);
  float g = hash01(c + ivec3(1, 0, 1), period, salt);
  float h = hash01(c + ivec3(0, 1, 1), period, salt);
  float k = hash01(c + ivec3(1, 1, 1), period, salt);
  return mix(mix(mix(a, b, f.x), mix(cc, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float tfbm(vec3 uvw, int basePeriod, uint salt, int octaves) {
  float s = 0.0, amp = 0.5, n = 0.0;
  int period = basePeriod;
  for (int o = 0; o < 5; o++) {
    if (o >= octaves) break;
    float v = tnoise(uvw * float(period), period, salt + uint(o) * 101u);
    s += amp * v;
    n += amp;
    amp *= 0.5;
    period *= 2;
  }
  return s / n;
}
float worley(vec3 uvw, int period, uint salt) {
  vec3 p = uvw * float(period);
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 9.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    ivec3 c = ivec3(i) + ivec3(x, y, z);
    vec3 o = vec3(hash01(c, period, salt), hash01(c, period, salt + 17u), hash01(c, period, salt + 31u));
    vec3 d = vec3(x, y, z) + o - f;
    best = min(best, dot(d, d));
  }
  return sqrt(best);
}
void main() {
  vec3 uvw = vec3((gl_FragCoord.xy - 0.5) / uSize, (uSlice + 0.0) / uSize);
  float r = tfbm(uvw, 4, 11u, 5);
  // g i a: dwa GŁADKIE, niezależne pola (2 oktawy) — ich poziomica g = a to
  // meandrujące żyły; z 5 oktaw wychodziła fraktalna „panterka”.
  float g = tfbm(uvw, 4, 29u, 2);
  float b = 1.0 - clamp(worley(uvw, 8, 53u) * 1.1, 0.0, 1.0);
  float a = tfbm(uvw, 4, 71u, 2);
  gl_FragColor = vec4(r, g, b, a);
}
`;

/**
 * Kafelkowana objętość szumu 64³ RGBA8: r = fbm, g = grzbiety (żyły),
 * b = komórki Worleya (drobne kratery/ziarna), a = drugie fbm.
 * Pieczona Core3D.rendererem przez WebGL3DRenderTarget (plaster po plastrze).
 */
export function bakeRockNoiseVolume(renderer, size = 64) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false
  });
  const tex = rt.texture;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  // Mipmapy: przy oddaleniu żyły i ziarno uśredniają się zamiast migotać.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  const material = new THREE.ShaderMaterial({
    vertexShader: NOISE_VERTEX,
    fragmentShader: NOISE_FRAGMENT,
    uniforms: { uSize: { value: size }, uSlice: { value: 0 } },
    depthTest: false,
    depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  // Pamięć mipmap alokuje initRenderTarget; generujemy raz, po ostatnim plastrze.
  renderer.initRenderTarget(rt);
  try {
    for (let z = 0; z < size; z++) {
      material.uniforms.uSlice.value = z;
      material.uniformsNeedUpdate = true;
      tex.generateMipmaps = z === size - 1;
      renderer.setRenderTarget(rt, z);
      renderer.render(scene, cam);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    tex.generateMipmaps = true;
    material.dispose();
    quad.geometry.dispose();
  }
  return rt;
}

// ---------------------------------------------------------------------------
// Shader skał

const ROCK_VERTEX = /* glsl */`
precision highp float;
uniform highp sampler2DArray uShapeA;
uniform float uShapeSize;
uniform float uTime;
uniform vec3 uSunRel;
uniform float uSunElev;
uniform float uPxScale;
uniform float uCamZ;
uniform float uMinPx;
// Mapa transmitancji słońca w polu (tylko tło — skały gry dostają ją z maski
// Core3D): offset = początek warstwy − róg mapy (scena), invSize = 1/rozmiar.
uniform sampler2D uFieldMap;
uniform float uFieldMapOn;
uniform vec2 uFieldMapOffset;
uniform vec2 uFieldMapInvSize;
attribute float aMip;
attribute vec4 iPos;
attribute vec4 iRot;
attribute vec4 iSpin;
attribute vec4 iShape;
attribute vec4 iStretch;
varying vec3 vDir;
varying vec3 vObjP;
varying vec3 vViewPos;
flat varying vec4 vRot;
flat varying vec3 vStretch;
flat varying vec3 vSunDir;
flat varying vec4 vInfo;     // x warstwa, y typ, z ziarno, w lod mapy
flat varying float vRadiusPx;
flat varying float vPxPerUnit;
flat varying float vDepth;
flat varying float vSunT;
flat varying float vRockR;
${ROCK_OCT_GLSL}

vec4 quatMul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 dir = normalize(position);
  float layer = iShape.x;
  float r = textureLod(uShapeA, vec3(rockOctTexUv(dir, uShapeSize), layer), aMip).x;
  // Rozmiar na ekranie: ortho → promień × zoom; persp → ogniskowa / odległość.
  float depth = -iPos.z;
  float pxPerUnit = uCamZ > 0.0 ? uPxScale / (uCamZ + depth) : uPxScale;
  float radiusPx = iPos.w * pxPerUnit;
  // Poniżej progu skała maleje do zera (bez wyskakiwania przy zmianie zoomu).
  float fadeScale = smoothstep(uMinPx, uMinPx * 2.0, radiusPx);
  vec4 q = quatMul(vec4(iSpin.xyz * sin(0.5 * (iShape.w + iSpin.w * uTime)), cos(0.5 * (iShape.w + iSpin.w * uTime))), iRot);
  vec3 pObj = dir * r * iStretch.xyz;
  vec3 local = quatRotate(q, pObj) * (iPos.w * fadeScale);
  vec3 scenePos = iPos.xyz + local;
  vec4 mv = modelViewMatrix * vec4(scenePos, 1.0);
  gl_Position = projectionMatrix * mv;
  vDir = dir;
  vObjP = pObj * iPos.w;
  vViewPos = mv.xyz;
  vRot = q;
  vStretch = iStretch.xyz;
  // Słońce: kierunek w płaszczyźnie od skały do słońca, podniesiony o uSunElev.
  vec2 toSun = uSunRel.xy - iPos.xy;
  float ls = length(toSun);
  vec2 sdir = ls > 1e-3 ? toSun / ls : vec2(1.0, 0.0);
  vSunDir = normalize(vec3(sdir * cos(uSunElev), sin(uSunElev)));
  // Poziom mipmap map kształtu: tekseli na równiku / pikseli obwodu.
  float lod = log2(max(1.0, (2.8284 * uShapeSize) / max(1.0, 6.2832 * radiusPx)));
  vInfo = vec4(layer, iShape.y, iShape.z, lod);
  vRadiusPx = radiusPx;
  vPxPerUnit = pxPerUnit;
  vDepth = depth;
  vRockR = iPos.w;
  vSunT = 1.0;
  if (uFieldMapOn > 0.5) {
    vec2 fuv = (iPos.xy + uFieldMapOffset) * uFieldMapInvSize;
    if (fuv.x >= 0.0 && fuv.y >= 0.0 && fuv.x <= 1.0 && fuv.y <= 1.0) vSunT = textureLod(uFieldMap, fuv, 0.0).r;
  }
}
`;

const ROCK_FRAGMENT = /* glsl */`
precision highp float;
uniform highp sampler2DArray uShapeA;
uniform highp sampler2DArray uShapeB;
uniform highp sampler3D uNoise;
uniform float uShapeSize;
uniform vec3 uSunColor;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBounce;
uniform float uLunar;
uniform float uWrap;
uniform float uExposure;
uniform float uDetail;
uniform float uVeins;
uniform float uLayerDim;
uniform float uDebugLod;
uniform vec3 uHazeColor;
uniform float uHazePerUnit;
uniform float uFieldLightGain;
uniform float uTime;                          // puls ładunku skał energetycznych
uniform vec4 uTypeBase[${ROCK_TYPE_COUNT}];   // rgb skała jasna
uniform vec4 uTypeBase2[${ROCK_TYPE_COUNT}];  // rgb skała ciemna
uniform vec4 uTypeA[${ROCK_TYPE_COUNT}];      // rgb akcent a, w połysk a
uniform vec4 uTypeB[${ROCK_TYPE_COUNT}];      // rgb akcent b, w parametr b
uniform vec4 uTypeC[${ROCK_TYPE_COUNT}];      // rgb akcent c, w emisja HDR
uniform vec4 uTypeD[${ROCK_TYPE_COUNT}];      // rgb akcent d
uniform vec4 uTypeP[${ROCK_TYPE_COUNT}];      // x pokrycie, y szer. linii [j.], z iskry, w relief (× R)
uniform vec4 uTypeS[${ROCK_TYPE_COUNT}];      // x lód, y połysk, z metal
uniform vec4 uShapeAxis[${SHAPE_COUNT}];      // xyz długa oś bryły (układ obiektu)
varying vec3 vDir;
varying vec3 vObjP;
varying vec3 vViewPos;
flat varying vec4 vRot;
flat varying vec3 vStretch;
flat varying vec3 vSunDir;
flat varying vec4 vInfo;
flat varying float vRadiusPx;
flat varying float vPxPerUnit;
flat varying float vDepth;
flat varying float vSunT;
flat varying float vRockR;
${ROCK_OCT_GLSL}
${SUN_SHADOW_GLSL}
${FIELD_LIGHTS_GLSL}

vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
float hash11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
// Widoczność cechy o rozmiarze s [j.]: 0 poniżej ~1,5 px, 1 od ~4 px.
float featureFade(float s) { return smoothstep(1.5, 4.0, s * vPxPerUnit); }
// Paski wzdłuż h z antyaliasingiem analitycznym (fw = zmiana h na piksel):
// 1 w środku paska o względnej szerokości w, 0 poza nim.
float bandMask(float h, float w, float fw) {
  float t = abs(fract(h) - 0.5);
  float e = max(fw, 1e-4);
  float m = 1.0 - smoothstep(w * 0.5 - e, w * 0.5 + e, t);
  return mix(m, w, smoothstep(0.35, 0.9, e));
}

void main() {
  vec3 dir = normalize(vDir);
  float layer = vInfo.x;
  int type = int(vInfo.y + 0.5);
  float seed = vInfo.z;
  float lod = vInfo.w;
  vec2 uv = rockOctTexUv(dir, uShapeSize);
  vec4 sa = textureLod(uShapeA, vec3(uv, layer), lod);
  vec4 sb = textureLod(uShapeB, vec3(uv, layer), lod);
  // Normalna obiektu → rozciągnięcie (odwrotna transpozycja) → scena.
  vec3 nObj = normalize(sa.yzw / vStretch);
  vec3 N = normalize(quatRotate(vRot, nObj));
  // Wszystko w układzie widoku (ortho i persp tak samo).
  mat3 V3 = mat3(viewMatrix);
  vec3 Nv = normalize(V3 * N);
  vec3 Lv = normalize(V3 * vSunDir);
  vec3 Vv = normalize(-vViewPos);
  if (isOrthographic) Vv = vec3(0.0, 0.0, 1.0);

  // --- Próbki szumu (wszystkie PRZED gałęziami typów) ---
  // P — punkt w układzie skały [j.]; Q — w promieniach skały (cechy w skali bryły).
  // Objętość powtarza się co 1 w uvw: próbka P / S ma okres S [j.], plamy fbm
  // ~S/4, komórki Worleya (kanał b) S/8.
  vec3 P = vObjP;
  float R = max(vRockR, 1.0);
  vec3 Q = P / R;
  vec3 so = vec3(seed * 37.1, seed * 91.7, seed * 53.3);
  vec4 n1 = texture(uNoise, P / 520.0 + so);                            // plamy ~130 j.
  vec4 n2 = texture(uNoise, P / 219.3 + so.yzx + vec3(0.31, 0.77, 0.13)); // ~55 j.
  vec4 nd = texture(uNoise, P / 90.0 + so.zxy);                         // detal, komórki 11 j.
  vec4 nq = texture(uNoise, Q * 0.62 + so * 0.71);                      // plamy ~0,4 R, komórki 0,2 R
  vec4 nm = texture(uNoise, Q * 1.9 + so.yxz + vec3(0.47, 0.11, 0.83)); // komórki 0,066 R
  vec4 nc = texture(uNoise, P / 380.0 + so.xzy);                        // ziarno: komórki 47 j.
  float zoneN = texture(uNoise, P / 1155.0 + vec3(0.53, 0.21, 0.87) + so).r;
  // Pochodne do antyaliasingu wzorów (przed gałęziami): zmiana Q i pól na piksel.
  vec3 dQx = dFdx(Q);
  vec3 dQy = dFdy(Q);
  float fwNqG = fwidth(nq.g);
  vec3 longAxis = uShapeAxis[int(layer + 0.5)].xyz;

  vec4 tA = uTypeA[type];
  vec4 tB = uTypeB[type];
  vec4 tC = uTypeC[type];
  vec4 tD = uTypeD[type];
  vec4 tP = uTypeP[type];
  vec4 tS = uTypeS[type];
  float ao = sb.r;
  float crater = sb.g;
  float macro = sb.b;
  float convex = sb.a;

  // Skała macierzysta (wspólna): jasna/ciemna z makro zmienności, wypukłości
  // jaśniejsze, świeże kratery z jaśniejszym wyrzutem.
  vec3 albedo = mix(uTypeBase2[type].rgb, uTypeBase[type].rgb, smoothstep(0.25, 0.75, macro * 0.7 + n1.r * 0.3));
  albedo *= mix(0.78, 1.12, convex);
  albedo = mix(albedo, albedo * 1.25 + 0.015, crater * 0.5);

  // Wyjście programów typów (pochodne liczone po gałęziach):
  float H = 0.0;                 // relief [j.]
  float lf = 1.0;                // pole linii (poziomica 0), 1 = brak linii
  float lw = 0.0;                // szerokość linii [j.]
  vec3 lcol = vec3(0.0);         // barwa linii
  float lspec = 0.0;             // połysk linii
  float lemit = 0.0;             // emisja linii (× lcol)
  float lmetal = 0.0;            // linia metaliczna (połysk w jej barwie)
  float specK = 0.03;            // połysk powierzchni
  float gloss = tS.y;
  float metal = 0.0;             // metaliczność powierzchni (0..1)
  vec3 metalF0 = vec3(0.56, 0.57, 0.58); // odbicie metalu (barwa połysku), żelazo domyślnie
  vec3 emit = vec3(0.0);
  float sparkK = tP.z;
  vec3 sparkCol = vec3(1.0);
  float relief = tP.w * R;       // skala reliefu [j.]
  // Strefy żył w niskiej częstotliwości (duże fragmenty bryły z żyłami lub bez).
  float veinZone = smoothstep(0.58 - tP.x * 0.3, 0.66 - tP.x * 0.3, zoneN);
  float veinField = n1.g - n1.a + (n2.r - 0.5) * 0.05 + (nd.r - 0.5) * 0.018;

  if (type == 0) {
    // ŻELAZO: metal na wypukłościach i dużych płatach, rdza w zagłębieniach.
    float metalM = smoothstep(0.6, 0.72, convex * 0.45 + nq.r * 0.75 + (1.0 - crater) * 0.06);
    float rustM = (1.0 - metalM) * smoothstep(0.3, 0.7, (1.0 - ao) * 0.9 + n2.a * 0.5 + crater * 0.25);
    // Regmaglipty: płytkie misy w komórkach ~0,2 R na metalu (1 w środku komórki).
    float thumb = smoothstep(0.3, 0.95, nq.b);
    H -= thumb * relief * mix(0.35, 1.0, metalM);
    // Krata lamel Widmanstättena (trzy kierunki, okres 9 j.) — tylko z bliska.
    float lam = 9.0;
    vec3 u1 = vec3(0.577, 0.577, 0.577);
    vec3 u2 = vec3(0.577, -0.577, 0.577);
    vec3 u3 = vec3(-0.577, 0.577, 0.577);
    float kq = R / lam;
    float w1 = bandMask(dot(Q, u1) * kq + nd.r * 0.25, 0.22, (abs(dot(dQx, u1)) + abs(dot(dQy, u1))) * kq);
    float w2 = bandMask(dot(Q, u2) * kq + nd.a * 0.25, 0.22, (abs(dot(dQx, u2)) + abs(dot(dQy, u2))) * kq);
    float w3 = bandMask(dot(Q, u3) * kq + nd.g * 0.25, 0.22, (abs(dot(dQx, u3)) + abs(dot(dQy, u3))) * kq);
    float lamella = max(w1, max(w2, w3)) * featureFade(lam);
    vec3 metalCol = mix(tA.rgb * (0.88 + 0.24 * nd.r), tC.rgb, lamella * 0.25);
    // Żelazo-nikiel: ciemniejszy, ciepły połysk (nie aluminium).
    metalF0 = vec3(0.36, 0.35, 0.33) * (0.9 + 0.25 * lamella);
    albedo = mix(albedo, tD.rgb, smoothstep(0.4, 0.8, nq.a) * 0.5);
    albedo = mix(albedo, metalCol, metalM);
    albedo = mix(albedo, tB.rgb * (0.75 + 0.5 * n2.r), rustM * tB.w * 1.6);
    metal = metalM;
    specK = mix(0.04, tA.w, metalM);
    gloss = mix(18.0, tS.y * (0.75 + 0.5 * nd.a), metalM);
    sparkCol = vec3(1.0, 0.92, 0.85);
  } else if (type == 1) {
    // MIEDŹ: skorupy malachitu w zagłębieniach z koncentrycznymi pasami
    // (poziomice gładkiego pola wokół środka płata), ~1/3 bryły.
    float malN = nq.g * 0.85 + (1.0 - convex) * 0.22 + (1.0 - ao) * 0.2;
    float mal = smoothstep(0.7 - tP.x * 0.15, 0.74 - tP.x * 0.15, malN);
    float bands = nq.g * 8.0 + nd.r * 0.18;
    float band = bandMask(bands, 0.42, fwNqG * 8.0 + 0.03);
    vec3 malCol = mix(tB.rgb, tA.rgb, band);
    malCol *= 0.85 + 0.3 * nd.a;
    // Azuryt: głęboki błękit w komórkach przy malachicie.
    float az = smoothstep(0.82, 0.9, nm.b) * smoothstep(0.35, 0.75, mal);
    albedo = mix(albedo, malCol, mal);
    albedo = mix(albedo, tD.rgb, az * 0.85);
    H += mal * relief * (0.6 + 0.4 * band);
    // Rodzima miedź: żyłki poza malachitem i bryłki na wypukłościach (metal).
    float nug = smoothstep(0.9, 0.95, nd.b) * (1.0 - mal) * smoothstep(0.5, 0.75, convex);
    albedo = mix(albedo, tC.rgb, nug);
    metal = nug;
    metalF0 = vec3(0.95, 0.64, 0.54);
    specK = mix(0.05, 1.0, nug);
    gloss = mix(20.0, tS.y, nug);
    lf = veinField;
    lw = tP.y * (1.0 - mal) * veinZone;
    lcol = tC.rgb;
    lspec = 0.6;
    lmetal = 1.0;
    sparkCol = vec3(1.0, 0.8, 0.6);
  } else if (type == 2) {
    // KRZEM: jasny chondryt — ziarna chondr w trzech barwach, żyły kwarcu, iskry.
    // Chondry: ziarna ~25 j. w trzech barwach (tylko albedo — garby dawały „pieprz”).
    float chond = smoothstep(0.62, 0.72, nc.b) * featureFade(30.0);
    vec3 chCol = nc.r < 0.4 ? tB.rgb : (nc.r < 0.62 ? tC.rgb : tD.rgb);
    albedo = mix(albedo, chCol, chond * 0.7);
    albedo *= 0.92 + 0.16 * nd.a;
    // Druza w zagłębieniach: jasne, mocno iskrzące.
    float druse = smoothstep(0.55, 0.85, (1.0 - ao) * 0.8 + crater * 0.5) * smoothstep(0.5, 0.7, nm.r);
    albedo = mix(albedo, tA.rgb * 0.9, druse * 0.6);
    sparkK = tP.z * (1.0 + druse * 2.0);
    specK = 0.06 + druse * 0.3;
    lf = veinField;
    lw = tP.y * veinZone;
    lcol = tA.rgb;
    lspec = tA.w;
  } else if (type == 3) {
    // TYTAN: warstwy w poprzek długiej osi bryły (ilmenit / szary / plagioklaz
    // / rutyl) z tarasami — jak pokrojony bochen, paski widać z góry.
    vec3 axis = normalize(longAxis + vec3(sin(seed * 12.9), cos(seed * 7.3), sin(seed * 3.1)) * 0.25);
    float per = tB.w * (0.75 + 0.5 * fract(seed * 3.7));   // warstw na promień
    float h = dot(Q, axis) * per + (nq.g - 0.5) * 1.1 + (nm.r - 0.5) * 0.3;
    float id = floor(h);
    float t = h - id;
    float fw = (abs(dot(dQx, axis)) + abs(dot(dQy, axis))) * per + fwNqG * 1.1; // zmiana h na piksel
    float rA = hash11(id + seed * 17.0);
    float rP = hash11(id - 1.0 + seed * 17.0);
    vec3 cA = rA < 0.34 ? tA.rgb : (rA < 0.68 ? tD.rgb : (rA < 0.95 ? tB.rgb : tC.rgb));
    vec3 cP = rP < 0.34 ? tA.rgb : (rP < 0.68 ? tD.rgb : (rP < 0.95 ? tB.rgb : tC.rgb));
    float edgeMix = smoothstep(0.0, max(fw * 1.5, 0.02), t);
    vec3 layerCol = mix(cP, cA, edgeMix);
    // Warstwy węższe niż piksel → średnia barwa (bez migotania).
    vec3 avgCol = tA.rgb * 0.34 + tD.rgb * 0.34 + tB.rgb * 0.27 + tC.rgb * 0.05;
    layerCol = mix(layerCol, avgCol, smoothstep(0.3, 0.8, fw));
    // Laminy: drobne warstewki w środku warstwy (3× gęściej, słaby kontrast).
    float lamina = bandMask(h * 3.0 + nd.r * 0.2, 0.3, fw * 3.0);
    layerCol *= (0.9 + 0.2 * nd.r) * (1.0 - 0.14 * lamina);
    albedo = mix(albedo, layerCol, 0.85);
    float ilm = (rA < 0.34 ? edgeMix : 0.0) + (rP < 0.34 ? 1.0 - edgeMix : 0.0);
    float gold = (rA >= 0.95 ? edgeMix : 0.0) + (rP >= 0.95 ? 1.0 - edgeMix : 0.0);
    ilm *= 1.0 - smoothstep(0.3, 0.8, fw);
    // Taras: schodek na granicy warstw (bez trendu — średnio zero).
    H += (id + smoothstep(0.78, 1.0, t) - h) * relief * featureFade(R / per * 0.25);
    metal = ilm * tS.z + gold * 0.8;
    metalF0 = mix(vec3(0.34, 0.35, 0.37), vec3(0.85, 0.62, 0.3), gold);
    specK = 0.05 + ilm * tA.w + gold * 0.8;
    sparkCol = mix(vec3(1.0), vec3(1.0, 0.8, 0.45), 0.6);
  } else if (type == 4) {
    // KRYSZTAŁ: ciemna skała, nieliczne świecące szczeliny cyjan/fiolet,
    // druza przy nich (wystające kryształy to osobne bryły).
    float mixV = smoothstep(0.35, 0.65, n2.a);
    lf = veinField;
    lw = tP.y * veinZone;
    lcol = mix(tA.rgb, tB.rgb, mixV);
    lspec = tA.w;
    lemit = tC.w;
    float fr = (1.0 - smoothstep(0.0, 0.05, abs(veinField))) * veinZone;
    H -= fr * relief;
    // Szron kryształków przy szczelinach (iskry i jaśniejszy nalot).
    float frost = (1.0 - smoothstep(0.0, 0.1, abs(veinField))) * veinZone;
    albedo = mix(albedo, tC.rgb * 0.5, frost * 0.25);
    sparkK = tP.z * (0.3 + frost * 2.0);
    sparkCol = mix(tA.rgb, vec3(1.0), 0.5);
    specK = 0.1;
  } else if (type == 5) {
    // LÓD: szkliwo, pasy pyłu (brudny lód jak jądra komet), pył w zagłębieniach.
    vec3 axis = normalize(longAxis + vec3(cos(seed * 5.1), sin(seed * 9.7), 0.4) * 0.5);
    float dh = dot(Q, axis) * 1.6 + (nq.g - 0.5) * 1.2;
    float dust = bandMask(dh, 0.26, (abs(dot(dQx, axis)) + abs(dot(dQy, axis))) * 1.6 + fwNqG * 1.2) * smoothstep(0.35, 0.6, nq.r);
    dust = max(dust, smoothstep(0.55, 0.9, (1.0 - ao) * 0.8 + crater * 0.4) * tB.w);
    albedo = mix(albedo, tD.rgb, smoothstep(0.55, 0.75, convex * 0.6 + nd.r * 0.5) * 0.6);
    albedo = mix(albedo, tB.rgb * (0.8 + 0.4 * n2.r), dust * 0.85);
    // Penitenty (kolce szronu) w części stref — drobny relief.
    float pen = smoothstep(0.55, 0.7, nq.a) * (1.0 - dust);
    H += nd.r * nd.r * nd.r * relief * 2.0 * pen * featureFade(90.0);
    // Szczeliny: głęboki błękit.
    lf = nq.g - nq.a + (n2.r - 0.5) * 0.03 + (nd.r - 0.5) * 0.012;
    lw = tP.y * veinZone;
    lcol = tA.rgb;
    lspec = 0.2;
    specK = mix(tA.w, 0.08, dust);
    gloss = tS.y;
    sparkK = tP.z * (1.0 - dust);
    sparkCol = vec3(0.85, 0.93, 1.0);
  } else if (type == 6) {
    // URAN: czarny smolinek z bąblami (groniasty), połysk smoły.
    // Groniaste bąble: duże (komórki 0,2 R) i średnie (0,066 R) — miękki połysk.
    float bub = sqrt(clamp((nq.b - 0.15) / 0.85, 0.0, 1.0));
    float bub2 = sqrt(clamp((nm.b - 0.25) / 0.75, 0.0, 1.0));
    H += (bub * 0.75 + bub2 * 0.35) * relief;
    albedo *= 0.9 + 0.2 * nd.r;
    // Skorupa autunitu/torbernitu: płaty na wypukłościach, żółtozielona, świeci.
    float crust = smoothstep(0.8 - tP.x * 0.15, 0.86 - tP.x * 0.15, nq.a * 0.7 + nm.r * 0.35 + convex * 0.2);
    float flake = smoothstep(0.35, 0.55, nd.b);
    vec3 crustCol = mix(tB.rgb, tA.rgb, smoothstep(0.3, 0.7, nd.r));
    crustCol = mix(crustCol, tD.rgb, smoothstep(0.75, 0.95, n2.r) * 0.6);
    float cm = crust * mix(0.6, 1.0, flake);
    albedo = mix(albedo, crustCol, cm);
    emit += tC.rgb * tC.w * 0.12 * cm;
    specK = mix(tA.w, 0.12, cm);
    gloss = mix(tS.y, 20.0, cm);
    // Świecące żyłki tylko w rzadkich strefach (inaczej zielona łuna na całej bryle).
    lf = veinField;
    lw = tP.y * smoothstep(0.6, 0.68, zoneN);
    lcol = tC.rgb;
    lspec = 0.4;
    lemit = tC.w;
  } else if (type == 8) {
    // ENERGETYCZNA (burze): ciemny, szklisty bazalt z gęstą siecią pęknięć,
    // w których świeci ładunek (fiolet → błękitna biel). Ładunek pulsuje per
    // skała i trzaska; przy uderzeniu pioruna obok (uFieldStrike) pęknięcia
    // i poświata rozbłyskują. Sieć w skali bryły (Q) + plamy (P) — gęsta na
    // małych i dużych skałach. Bez próbek i pochodnych w gałęzi (FXC).
    float ph = seed * 43.7;
    float pulse = 0.6 + 0.4 * sin(uTime * (1.1 + fract(seed * 7.1) * 1.4) + ph);
    float crackle = pow(max(0.0, sin(uTime * 19.0 + ph * 3.0) * sin(uTime * 6.1 + ph)), 14.0);
    float surge = fieldStrikeSurge(vViewPos, R * 2.4);
    float charge = pulse + crackle * 1.6 + surge * 0.9;
    // Pęknięcia jak u kryształu (poziomica pola żył), ale w większej części bryły.
    lf = veinField;
    lw = tP.y * veinZone;
    lcol = mix(tB.rgb, tA.rgb, smoothstep(0.35, 0.8, nd.r + surge * 0.4));
    lspec = 0.4;
    lemit = tC.w * charge;
    float halo = (1.0 - smoothstep(0.0, 0.1, abs(lf))) * veinZone;
    emit += tB.rgb * tC.w * 0.06 * halo * charge;
    albedo = mix(albedo, tD.rgb, smoothstep(0.4, 0.8, nq.r) * 0.6);
    H -= (1.0 - smoothstep(0.0, 0.06, abs(lf))) * relief;
    specK = 0.18;
    gloss = tS.y;
    sparkK = tP.z * (0.4 + crackle * 3.0 + surge * 2.0);
    sparkCol = tA.rgb;
  } else {
    // NEUTRALNA: zwykła skała — odcień per skała (ciepły/chłodny), regolit,
    // ciemne łaty wietrzenia kosmicznego, jaśniejsze głazy. Bez akcentów.
    float cool = step(0.5, fract(seed * 7.13));
    vec3 hi = mix(uTypeBase[type].rgb, tA.rgb, cool);
    vec3 lo = mix(uTypeBase2[type].rgb, tB.rgb, cool);
    albedo = mix(lo, hi, smoothstep(0.25, 0.75, macro * 0.7 + n1.r * 0.3));
    albedo *= mix(0.78, 1.12, convex);
    albedo = mix(albedo, albedo * 1.25 + 0.015, crater * 0.5);
    albedo = mix(albedo, tD.rgb, smoothstep(0.5, 0.8, nq.r) * 0.45);
    // Głazy: garby w komórkach 0,2 R (drobniejsze dawały czarny „pieprz”).
    float boulder = smoothstep(0.55, 0.95, nq.b) * smoothstep(0.45, 0.65, nq.a);
    albedo = mix(albedo, tC.rgb, boulder * 0.25);
    H += boulder * relief;
    specK = tA.w;
  }

  // --- Relief i linie (pochodne w jednolitym przepływie sterowania) ---
  // Detal wypukłości (gradient powierzchni Mikkelsena, bez stycznych) — przy
  // zbliżeniu. Okres objętości 90 j., komórka Worleya ~11 j.: detal wchodzi,
  // gdy komórka ma kilka pikseli (inaczej migocze).
  float hDetail = nd.r * 0.8 + nd.b * 0.2;
  float detailAmt = uDetail * smoothstep(1.5, 5.0, 11.0 * vPxPerUnit);
  float Htot = hDetail * 4.0 * detailAmt + H * uDetail;
  vec3 dpx = dFdx(vViewPos);
  vec3 dpy = dFdy(vViewPos);
  float dhx = dFdx(Htot);
  float dhy = dFdy(Htot);
  {
    vec3 r1 = cross(dpy, Nv);
    vec3 r2 = cross(Nv, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    if (abs(det) > 1e-12) Nv = normalize(abs(det) * Nv - grad);
  }
  // Linia: poziomica pola lf o STAŁEJ szerokości w świecie (lw [j.]),
  // wygładzana w pikselach; węższa niż piksel słabnie, zostaje lekkie zabarwienie.
  float distPx = abs(lf) / max(fwidth(lf), 1e-5);
  float widthVar = mix(0.3, 1.45, smoothstep(0.3, 0.7, n2.a));
  float halfPx = 0.5 * lw * widthVar * vPxPerUnit;
  float wPx = max(halfPx, 0.5);
  float line = (1.0 - smoothstep(wPx - 0.5, wPx + 0.6, distPx)) * min(1.0, halfPx * 2.0) * uVeins;
  line *= step(0.001, lw);
  float lineTint = veinZone * uVeins * 0.16 * (1.0 - min(1.0, halfPx * 2.0)) * step(0.001, lw);
  albedo = mix(albedo, lcol, clamp(line + lineTint, 0.0, 1.0));
  metal = max(metal, line * lmetal);
  // Połysk linii dopiero przy szerokiej linii: normalna bruzdy z pochodnych
  // szumi na 1–3 px, a połysk (kryształ 1,2) robił z tego migające iskry HDR
  // i plamy bloomu na żyłach (połowa mrygania skał kryształu w oddaleniu).
  specK = mix(specK, lspec, line * smoothstep(1.5, 4.0, halfPx));

  // --- Światło ---
  float NdotL = dot(Nv, Lv);
  float mu0 = max(NdotL, 0.0);
  float mu = max(dot(Nv, Vv), 0.02);
  float lambert = clamp((NdotL + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  // Lommel–Seeliger (regolit): płaska tarcza, bez ciemnienia ku brzegowi;
  // przycięty, żeby brzeg pod kątem nie świecił jaśniej niż środek w słońcu.
  float lommel = min(1.15, 2.0 * mu0 / (mu0 + mu)) * smoothstep(-uWrap, uWrap + 0.05, NdotL);
  float diffuse = mix(lambert, lommel, uLunar * (1.0 - metal));
#ifdef ROCK_BACKDROP
  // Tło leży głęboko pod płaszczyzną: maska powierzchni (liczona dla gry) nie
  // pasuje do jego pozycji na ekranie. Słońce przesłonięte przez pole bierze
  // z mapy pola w środku skały; otoczenie (pył oświetlony słońcem) gaśnie razem.
  float sunVis = vSunT;
  float fill = vSunT;
#else
  // Otoczenie skały w cieniu (planety, kadłuba) słabsze niż kadłuba (0,22
  // wobec 0,4); w mroku gęstego pola gaśnie całkiem — w rdzeniu skałę widać
  // tylko w reflektorach i przy świecących skałach.
  float sunVis = sunVisibility();
  float fill = mix(0.22, 1.0, sunVis) * (1.0 - fieldDarkness());
#endif
  // Metal: mało rozproszenia, połysk w barwie metalu i odbicie otoczenia
  // (pył oświetlony od strony słońca) — bez niego metal wyglądał jak szary plastik.
  vec3 diffAlbedo = albedo * (1.0 - 0.85 * metal);
  vec3 specTint = mix(vec3(1.0), metalF0, metal);
  // Otoczenie: z góry kadru (od strony kamery) + odbicie od pyłu po stronie cienia.
  float up = clamp(Nv.z * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = (uAmbientTop * (0.55 + 0.45 * up) + uAmbientBounce * max(0.0, -NdotL)) * ao;
  vec3 col = diffAlbedo * (uSunColor * diffuse * sunVis + ambient * fill);
  // Metal odbija też otoczenie: odbity kierunek widoku → jasno od strony słońca
  // (pył w świetle), ciemno od strony cienia; w mroku pola gaśnie z otoczeniem.
  if (metal > 0.001) {
    // Nad płaszczyzną jest czarne niebo: metal zwrócony w górę odbija mrok,
    // blask tylko tam, gdzie odbicie celuje blisko słońca (szeroki płat).
    vec3 Rv = reflect(-Vv, Nv);
    float glare = pow(max(dot(Rv, Lv), 0.0), 6.0);
    vec3 env = (uAmbientTop * 0.5 + uSunColor * 0.35 * glare * sunVis) * fill;
    col += metalF0 * env * metal * (0.35 + 0.65 * ao);
  }
  vec3 Hh = normalize(Lv + Vv);
  float ndh = max(dot(Nv, Hh), 0.0);
  float spec = pow(ndh, gloss) * specK;
  // Iskry ziaren: rzadkie (część komórek), dopiero gdy komórka ma ≥ 2 px.
  float sparkle = step(0.965, nd.b) * step(0.62, nd.a) * sparkK * pow(ndh, 10.0) * 0.5
    * smoothstep(1.5, 3.0, 11.0 * vPxPerUnit);
  col += uSunColor * (spec * specTint + sparkle * sparkCol) * mu0 * sunVis;
  // Lód: prześwit przy terminatorze i w szczelinach, chłodna obwódka — słabe,
  // lód ma zostać pod progiem bloomu (0,9), inaczej cała bryła świeci na biało.
  float iceK = uTypeS[type].x;
  if (iceK > 0.5) {
    float sss = pow(clamp(1.0 - abs(NdotL), 0.0, 1.0), 3.0) * 0.08;
    float rim = pow(1.0 - mu, 3.0) * 0.05;
    col += uTypeC[type].rgb * 0.45 * (sss * sunVis + rim + line * 0.05 * sunVis) * ao;
  }
  // Światła statków (reflektory, światło dookoła) — w głębi pola główne źródło.
  if (uFieldLightCount > 0 && uFieldLightGain > 0.0) {
    vec3 fSpec;
    vec3 fDiff = fieldLightsShade(vViewPos, Nv, Vv, gloss, specK + 0.05, fSpec);
    col += (diffAlbedo * fDiff * ao + fSpec * specTint) * uFieldLightGain;
  }
  // Emisja (kryształ, uran) — HDR tylko na samej linii (bloom na liniach,
  // nie na bryle); przy oddaleniu linia słabnie, zostaje lekki poblask strefy.
  col += lcol * (line + lineTint * 0.25) * lemit + emit;
  col *= uExposure * uLayerDim;
#ifdef ROCK_BACKDROP
  // Tło: zamglenie z głębokością — im głębiej, tym ciemniej i bardziej w barwie
  // pyłu w cieniu; giganty na dnie zostają sylwetkami. Smugi cienia z maski
  // Core3D tło NIE czyta: słońce leży w płaszczyźnie, cień kadłuba nie pada na
  // pył tysiące jednostek niżej (dawał prostokąt przez cały kadr).
  // Barwa zamglenia = pył między skałą a kamerą, oświetlony słońcem — w cieniu
  // pola gaśnie razem z nim (inaczej skały tła świecą w mroku jak szare duchy).
  float haze = clamp(vDepth * uHazePerUnit, 0.0, 0.92);
  col = mix(col * (1.0 - 0.45 * haze), uHazeColor * vSunT, haze * 0.85);
#endif
  if (uDebugLod > 0.5) {
    float l = floor(log2(max(1.0, vRadiusPx)));
    col = mix(col, vec3(fract(l * 0.37), fract(l * 0.61), fract(l * 0.83)), 0.6);
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

/**
 * Materiał dla warstwy skał.
 * @param {object} opts
 * @param {import('./rockShapes3D.js').RockShapeBank} opts.bank
 * @param {THREE.Texture} opts.noise objętość szumu (bakeRockNoiseVolume)
 * @param {boolean} [opts.backdrop] tło (warstwa 1): smuga cienia zamiast cienia powierzchni
 */
export function createRockMaterial({ bank, noise, backdrop = false }) {
  const typeArray = () => Array.from({ length: ROCK_TYPE_COUNT }, () => new THREE.Vector4());
  const uniforms = attachFieldLightUniforms(attachSunShadowUniforms({
    uShapeA: { value: bank.textureA },
    uShapeB: { value: bank.textureB },
    uNoise: { value: noise },
    uShapeSize: { value: bank.size },
    uTime: { value: 0 },
    uSunRel: { value: new THREE.Vector3(1e7, 0, 0) },
    uSunElev: { value: ROCK_LIGHT_DEFAULTS.sunElevDeg * Math.PI / 180 },
    uPxScale: { value: 1 },
    uCamZ: { value: 0 },
    uMinPx: { value: 0.6 },
    uSunColor: { value: new THREE.Vector3() },
    uAmbientTop: { value: new THREE.Vector3() },
    uAmbientBounce: { value: new THREE.Vector3() },
    uLunar: { value: ROCK_LIGHT_DEFAULTS.lunar },
    uWrap: { value: ROCK_LIGHT_DEFAULTS.wrap },
    uExposure: { value: ROCK_LIGHT_DEFAULTS.exposure },
    uDetail: { value: 1 },
    uVeins: { value: 1 },
    uLayerDim: { value: backdrop ? 0.85 : 1 },
    uDebugLod: { value: 0 },
    uHazeColor: { value: new THREE.Vector3() },
    uHazePerUnit: { value: 0 },
    uFieldLightGain: { value: 1 },
    uFieldMap: { value: null },
    uFieldMapOn: { value: 0 },
    uFieldMapOffset: { value: new THREE.Vector2() },
    uFieldMapInvSize: { value: new THREE.Vector2(1, 1) },
    uTypeBase: { value: typeArray() },
    uTypeBase2: { value: typeArray() },
    uTypeA: { value: typeArray() },
    uTypeB: { value: typeArray() },
    uTypeC: { value: typeArray() },
    uTypeD: { value: typeArray() },
    uTypeP: { value: typeArray() },
    uTypeS: { value: typeArray() },
    uShapeAxis: {
      value: Array.from({ length: SHAPE_COUNT }, (_, k) => {
        const a = bank.longAxis;
        return a && a.length >= (k + 1) * 3 ? new THREE.Vector4(a[k * 3], a[k * 3 + 1], a[k * 3 + 2], 0) : new THREE.Vector4(1, 0, 0, 0);
      })
    }
  }));
  const material = new THREE.ShaderMaterial({
    vertexShader: ROCK_VERTEX,
    fragmentShader: ROCK_FRAGMENT,
    uniforms,
    defines: backdrop ? { ROCK_BACKDROP: 1 } : {},
    // Tło: kolejka przezroczysta, żeby skały rysowały się PO gwiazdach
    // (Points na z = −250 bez zapisu głębi) i je zasłaniały. Pełna alfa.
    transparent: backdrop,
    blending: THREE.NoBlending,
    depthWrite: true,
    depthTest: true
  });
  applyRockLooks(material, ROCK_TYPE_LOOKS);
  applyRockLight(material, ROCK_LIGHT_DEFAULTS);
  return material;
}

const _lin = new THREE.Vector3();

export function applyRockLooks(material, looks = ROCK_TYPE_LOOKS) {
  const u = material.uniforms;
  for (let i = 0; i < ROCK_TYPE_COUNT; i++) {
    const L = looks[Math.min(i, looks.length - 1)];
    hexToLinear(L.base, _lin); u.uTypeBase.value[i].set(_lin.x, _lin.y, _lin.z, 1);
    hexToLinear(L.base2, _lin); u.uTypeBase2.value[i].set(_lin.x, _lin.y, _lin.z, 1);
    hexToLinear(L.a, _lin); u.uTypeA.value[i].set(_lin.x, _lin.y, _lin.z, L.aSpec);
    hexToLinear(L.b, _lin); u.uTypeB.value[i].set(_lin.x, _lin.y, _lin.z, L.bParam);
    hexToLinear(L.c, _lin); u.uTypeC.value[i].set(_lin.x, _lin.y, _lin.z, L.emit);
    hexToLinear(L.d, _lin); u.uTypeD.value[i].set(_lin.x, _lin.y, _lin.z, 1);
    u.uTypeP.value[i].set(L.cover, L.line, L.sparkle, L.relief);
    u.uTypeS.value[i].set(L.ice, L.gloss, L.metal, 0);
  }
  material.uniformsNeedUpdate = true;
}

export function applyRockLight(material, light = ROCK_LIGHT_DEFAULTS) {
  const u = material.uniforms;
  const k = light.sunIntensity;
  u.uSunColor.value.set(light.sunColor[0] * k, light.sunColor[1] * k, light.sunColor[2] * k);
  u.uAmbientTop.value.set(...light.ambientTop);
  u.uAmbientBounce.value.set(...light.ambientBounce);
  u.uLunar.value = light.lunar;
  u.uWrap.value = light.wrap;
  u.uExposure.value = light.exposure;
  u.uSunElev.value = light.sunElevDeg * Math.PI / 180;
  if (light.hazeColor) u.uHazeColor.value.set(...light.hazeColor);
  if (Number.isFinite(light.hazePerUnit)) u.uHazePerUnit.value = light.hazePerUnit;
  material.uniformsNeedUpdate = true;
}
