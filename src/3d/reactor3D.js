// src/3d/reactor3D.js
//
// MODELE REAKTORA w scenie Core3D — bez własnego renderera. Geometria:
// reactor3DShapes.js (tokamak Terra Nova, prowizorka piratów, podwójny
// pierścień Atlasa). Stan (komora, osłona, stopienie) czyta z runtime rdzeni
// shipCore.js — nic nie zmienia w gameplayu.
//
// WIDOCZNOŚĆ: model leży POD kadłubem (dach na z = REACTOR_Z_TOP, głębia
// rośnie z promieniem komory). Kadłub heksowy pisze głębię na z = 0, więc
// model przechodzi test głębi tylko przez martwe heksy — widać go wyłącznie
// przez wyrwę, jak dawny żar coreFx3D (dla rdzeni z modelem żar jest
// wyłączany — światło daje plazma w torusie). Instancje są tylko dla rdzeni
// ODSŁONIĘTYCH i wyżej (i wraków reaktora po wyrzucie/kuli).
//
// WARSTWA 7 (pass tarcz, bez maski cieni i czyszczenia głębi) — jak
// coreFx3D: na warstwie 0 cień własnego kadłuba mnożył dawniej wnętrze o ~0,5.
// Konstrukcja (nieprzezroczysta, zapis głębi) idzie przed plazmą
// (addytywna, test głębi): cewki przykrywają pierścień, między nimi plazmę
// widać. Kontrakt AGENTS.md: sync() zgłasza warstwę przez markLayerActive.
//
// ŚWIATŁO: w komorze pod pancerzem słońca nie ma — konstrukcję oświetla
// własna plazma (pierścień jako źródło liniowe, u Atlasa też kula rdzenia),
// liczona w układzie modelu, więc nie zależy od obrotu kadłuba. Otoczenie
// nisko (0,05), rozproszone i połysk od plazmy. Pasma HDR jak żar
// (coreBands.js): plazma — ciało 0,62 / 0,72 / 0,84, biała nić 9–11,5 z ostrą
// krawędzią; metal oświetlony plazmą zostaje pod progiem bloomu (≤ ~0,8),
// cewki w stopieniu żarzą się pomarańczem.
//
// STANY: ODSŁONIĘTY — plazma spokojnie krąży; KRYTYCZNY — szybciej, pęka
// część cewek (osłona), plazma wypycha się przy pękniętych; STOPIENIE —
// wirowanie przyspiesza, rura się rozlewa (niestabilność), cewki żarzą się,
// puls jak żar (1,2 → 7 Hz). Po detonacji: wyrzut i kula zostawiają wrak
// reaktora (plazma gaśnie w 0,25 s, żar stygnie; wyrzut wyrywa łuk konstrukcji
// w swoim kierunku), pozostałe warianty wyparowują model razem z komorą.
//
// PRECYZJA (AGENTS.md): świat gry leży przy 5–10 mln j., a float32 na GPU ma
// tam krok ~1 j. — model drgałby względem krawędzi wyrwy w kadłubie. Środki
// instancji są więc WZGLĘDEM początku przy kamerze (sync(..., { sceneOrigin })
// z sceneOriginNearCamera, src/3d/sceneOrigin.js; bez niego — pierwszy
// widoczny rdzeń), początek siedzi w mesh.position, a shader liczy
// modelViewMatrix × pozycja (three składa macierz w double). Dane przepisywane
// co klatkę, więc początek też co klatkę. Wzór: Bridge3D._setOrigin
// (docs/PORT-mostki.md § 8.12). Moduł nie importuje sceneOrigin.js (ten ciągnie
// core3d.js) — testy node działają na samej scenie.
//
// Koszt: najwyżej 2 wywołania rysowania na rodzaj (konstrukcja + plazma),
// tylko gdy jest widoczna instancja; bufory instancji bez alokacji na klatkę.
import * as THREE from 'three';
import { CORE_STATE, coreStateRank, gridToLocal, localToWorld } from '../game/shipCore.js';
import { CORE_FX_BANDS, CORE_FX_LAYER, coreStateBand } from './coreBands.js';
import { REACTOR3D_KINDS, buildReactorModel } from './reactor3DShapes.js';

export const REACTOR3D_TUNE = {
  ambient: 0.05,        // wnętrze pod pancerzem: prawie ciemno
  lightGain: 1.45,      // światło plazmy na konstrukcji (× ciało plazmy)
  falloff: 3.5,         // 1 / (1 + d² · falloff), d w promieniach komory
  accentL: 0.7,         // listwy i akcenty — barwa bez bloomu
  zTop: -1.2,           // dach modelu pod kadłubem (0) i płytą pancerza (−0,25)
  zScale: 0.45,         // głębokość modelu × promień komory
  streaks: 7,           // jasne pasma krążące w pierścieniu
  filament: 0.016,      // półszerokość białej linii na szczycie rury (v rury; 0,25 = ćwierć obwodu)
  packet: 0.9,          // próg pasma, od którego pakiet plazmy świeci bielą (0–1)
  burnCool: 2.2,        // s — stygnięcie wraku reaktora (e^(−t/τ))
  plasmaOut: 0.25       // s — gaśnięcie plazmy po wyrzucie/kuli
};
if (typeof window !== 'undefined') window.__reactor3DTune = REACTOR3D_TUNE;

const MAX_PER_KIND = 64;
const STRUCT_RENDER_ORDER = 8;
const PLASMA_RENDER_ORDER = 9;
const MAX_COILS = 32;

// Obroty plazmy na sekundę i niestabilność rury wg stanu.
function flowRevPerSec(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.8 + 1.7 * band.prog * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.6;
  return 0.35;
}
function instability(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.25 + 0.65 * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.18;
  return 0.05;
}
function coilHeat(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.25 + 0.6 * band.prog * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.15;
  return 0;
}
// Pęknięte cewki rosną z utratą osłony (część zawsze zostaje).
function brokenFrac(core) {
  const integ = Number.isFinite(core.integrity) ? core.integrity : 1;
  return Math.max(0, Math.min(0.85, (1 - integ) * 1.1));
}

/**
 * Rodzaj modelu dla rdzenia: gracz → atlas, piraci → pirate, reszta → terran.
 * Gra może podać własne `kindFor` (np. po frakcji albo ramie kadłuba).
 */
export function resolveReactorKind(core) {
  const h = core?.host;
  if (!h) return 'terran';
  if (h.isPlayer || h.shipFrame === 'atlas' || h.__hullId === 'atlas') return 'atlas';
  const id = String(h.__hullId || h.shipFrame || h.type || '').toLowerCase();
  const fac = String(h.faction || h.factionId || '').toLowerCase();
  if (id.includes('pirate') || id.includes('skull') || fac.includes('pira')) return 'pirate';
  return 'terran';
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return new THREE.Vector3(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255));
}
function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function parseColor(col, fallback) {
  if (Array.isArray(col) && col.length >= 3) return [Number(col[0]) || 0, Number(col[1]) || 0, Number(col[2]) || 0];
  if (typeof col === 'string' && /^#?[0-9a-f]{6}$/i.test(col)) {
    const v = hexToLinear(col);
    return [v.x, v.y, v.z];
  }
  return fallback;
}

const HASH_GLSL = /* glsl */`
float r3Hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float r3Noise(float x) { float i = floor(x); float f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(r3Hash(i), r3Hash(i + 1.0), u); }
`;

const INSTANCE_GLSL = /* glsl */`
attribute vec4 iBasis;   // oś x modelu → scena (x, y), oś y modelu → scena (z, w)
attribute vec4 iPos;     // środek w scenie WZGLĘDEM mesh.position (x, y), dach z, głębokość na jednostkę
attribute vec4 iState;   // ciało plazmy, biel nici, faza obrotu, niestabilność
attribute vec4 iState2;  // żar cewek, pęknięte (0–1), puls (0–1), obecność plazmy
attribute vec4 iColor;   // barwa plazmy (L = 1), ziarno
attribute vec4 iBreak;   // kierunek rozerwania (x, y modelu), półszerokość łuku, żar wraku (< 0 = żywy)
`;

const STRUCT_VERTEX = /* glsl */`
attribute float aMat;
attribute float aCoil;
attribute float aAng;
${INSTANCE_GLSL}
varying vec3 vP;
varying vec3 vN;
varying float vMat;
varying float vCoil;
varying vec4 vState;
varying vec4 vState2;
varying vec4 vColor;
varying vec4 vBreak;
void main() {
  vP = position;
  vN = normal;
  vMat = aMat;
  vCoil = aCoil;
  vState = iState;
  vState2 = iState2;
  vColor = iColor;
  vBreak = iBreak;
  vec2 xy = iPos.xy + position.x * iBasis.xy + position.y * iBasis.zw;
  float z = iPos.z + position.z * iPos.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
}
`;

const STRUCT_FRAGMENT = /* glsl */`
uniform vec3 uAlbedo[8];
uniform vec2 uSpec[8];
uniform vec4 uRing[2];      // R, z, ex, ey
uniform int uRingCount;
uniform vec3 uCoreLight;    // z, wzmocnienie, włączone (> 0,5)
uniform vec3 uAccent;       // barwa akcentów (0 = barwa plazmy)
uniform float uAccentL;
uniform float uAmbient;
uniform float uLightGain;
uniform float uFalloff;
uniform float uTime;
uniform float uXray;
varying vec3 vP;
varying vec3 vN;
varying float vMat;
varying float vCoil;
varying vec4 vState;
varying vec4 vState2;
varying vec4 vColor;
varying vec4 vBreak;
${HASH_GLSL}
vec3 heatColor(float h) {
  // ciemna czerwień → pomarańcz → żółć, w paśmie barwy (≤ ~1,2)
  vec3 c = mix(vec3(0.30, 0.02, 0.0), vec3(1.0, 0.34, 0.05), smoothstep(0.0, 0.65, h));
  return c * h + vec3(0.22, 0.18, 0.08) * smoothstep(0.75, 1.0, h);
}
void main() {
  int mat = int(vMat + 0.5);
  float burnt = vBreak.w;
  bool dead = burnt >= 0.0;
  float r = length(vP.xy);
  float edgeGlow = 0.0;
  if (dead && vBreak.z > 0.0) {
    float a = atan(vP.y, vP.x);
    float ad = atan(vBreak.y, vBreak.x);
    float d = abs(mod(a - ad + 3.14159265, 6.2831853) - 3.14159265);
    if (d < vBreak.z && r > 0.22 && r < 0.84) discard;
    edgeGlow = (1.0 - smoothstep(0.0, 0.14, d - vBreak.z)) * step(0.22, r) * step(r, 0.86);
  }
  vec3 N = normalize(vN);
  vec3 albedo = uAlbedo[mat];
  float presence = vState2.w;
  float pulse = vState2.z;
  float I = vState.x * presence * uLightGain * (0.8 + 0.2 * pulse);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float diff = 0.0;
  float spec = 0.0;
  for (int i = 0; i < 2; i++) {
    if (i >= uRingCount) break;
    vec4 ring = uRing[i];
    float a = atan(vP.y / ring.w, vP.x / ring.z);
    vec3 Q = vec3(cos(a) * ring.x * ring.z, sin(a) * ring.x * ring.w, ring.y);
    vec3 L = Q - vP;
    float d2 = dot(L, L);
    L *= inversesqrt(max(d2, 1e-5));
    float att = 1.0 / (1.0 + d2 * uFalloff);
    diff += max(0.0, dot(N, L) * 0.8 + 0.2) * att;
    spec += pow(max(0.0, dot(N, normalize(L + V))), uSpec[mat].x) * uSpec[mat].y * att;
  }
  if (uCoreLight.z > 0.5) {
    vec3 L = vec3(0.0, 0.0, uCoreLight.x) - vP;
    float d2 = dot(L, L);
    L *= inversesqrt(max(d2, 1e-5));
    float att = uCoreLight.y / (1.0 + d2 * uFalloff * 2.0);
    diff += max(0.0, dot(N, L) * 0.8 + 0.2) * att;
    spec += pow(max(0.0, dot(N, normalize(L + V))), uSpec[mat].x) * uSpec[mat].y * att;
  }
  vec3 pc = vColor.rgb;
  vec3 col = albedo * (uAmbient + pc * diff * I) + pc * spec * I * 0.6;
  if (mat == 2) {
    float broken = step(r3Hash(vCoil + vColor.a * 17.0), vState2.y);
    col *= mix(1.0, 0.35, broken);
    col += heatColor(clamp(vState2.x + broken * 0.25, 0.0, 1.0)) * (0.65 + 0.35 * pulse) * presence;
    float sparkT = floor(uTime * 24.0) + vCoil * 7.0 + vColor.a * 3.0;
    col += broken * step(0.93, r3Hash(sparkT)) * vec3(1.0, 0.6, 0.25) * 0.8 * presence;
  }
  if (mat == 7) {
    vec3 acc = (uAccent.r + uAccent.g + uAccent.b) > 0.0 ? uAccent : pc;
    col = albedo * 0.2 + acc * uAccentL * (dead ? 0.0 : 1.0);
  }
  if (dead) {
    col *= 0.55;
    col += heatColor(burnt) * (mat == 2 ? 0.9 : 0.35);
    col += vec3(1.0, 0.45, 0.12) * edgeGlow * (0.25 + 0.9 * burnt);
  }
  if (uXray > 0.5) col = col * 0.85 + vec3(0.03, 0.05, 0.07);
  gl_FragColor = vec4(col, 1.0);
}
`;

const PLASMA_VERTEX = /* glsl */`
attribute vec3 aCenter;
attribute float aTube;
attribute float aRing;
attribute vec2 aUV;
${INSTANCE_GLSL}
uniform float uCoilAng[${MAX_COILS}];
uniform float uCoilCode[${MAX_COILS}];   // pierścień; + 10 = cewki brak (zawsze wycieka)
uniform int uCoilCount;
uniform float uTime;
varying vec2 vUV;
varying float vRing;
varying float vFace;
varying float vLeak;
varying vec4 vState;
varying vec4 vState2;
varying vec4 vColor;
${HASH_GLSL}
void main() {
  float ang = aUV.x * 6.2831853;
  float leak = 0.0;
  if (aRing < 1.5) {
    for (int k = 0; k < ${MAX_COILS}; k++) {
      if (k >= uCoilCount) break;
      float code = uCoilCode[k];
      if (abs(mod(code, 10.0) - aRing) > 0.5) continue;
      bool broken = code >= 9.5 || r3Hash(float(k) + iColor.a * 17.0) < iState2.y;
      if (!broken) continue;
      float d = abs(mod(ang - uCoilAng[k] + 3.14159265, 6.2831853) - 3.14159265);
      leak += exp(-d * d / 0.018);
    }
  }
  float inst = iState.w;
  float wob = (r3Noise(aUV.x * 14.0 + uTime * 2.3 + aRing * 5.0 + iColor.a * 9.0) - 0.5) * inst;
  float tube = aTube * (1.0 + wob * 0.8 + min(leak, 1.5) * 0.7 * (0.6 + 0.4 * iState2.z));
  vec3 p = aCenter + normal * tube;
  vUV = aUV;
  vRing = aRing;
  vFace = normal.z;
  vLeak = min(leak, 1.0);
  vState = iState;
  vState2 = iState2;
  vColor = iColor;
  vec2 xy = iPos.xy + p.x * iBasis.xy + p.y * iBasis.zw;
  float z = iPos.z + p.z * iPos.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
}
`;

const PLASMA_FRAGMENT = /* glsl */`
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
uniform float uRingDir[3];
uniform float uStreaks;
uniform float uFilament;
uniform float uPacket;
uniform float uFlicker;
uniform float uTime;
varying vec2 vUV;
varying float vRing;
varying float vFace;
varying float vLeak;
varying vec4 vState;
varying vec4 vState2;
varying vec4 vColor;
${HASH_GLSL}
void main() {
  float presence = vState2.w;
  if (presence <= 0.001) discard;
  // Tylko górna połowa rury (ku kamerze, +z modelu). Baza instancji odbija
  // oś y (scena ma odwrócone y), więc kolejność wierzchołków się odwraca —
  // materiał jest dwustronny, a stronę wybiera normalna modelu, nie nawinięcie.
  if (vFace < -0.02) discard;
  int ri = int(vRing + 0.5);
  float dir = ri == 0 ? uRingDir[0] : (ri == 1 ? uRingDir[1] : uRingDir[2]);
  float u = vUV.x;
  float phase = vState.z;
  float inst = vState.w;
  float pulse = vState2.z;
  float face = clamp(vFace, 0.0, 1.0);
  float fl = 1.0 - uFlicker * step(0.86, r3Hash(floor(uTime * 18.0) + vColor.a * 31.0));
  // pasma plazmy krążące w pierścieniu (u kuli — falowanie powierzchni)
  float s1 = 0.5 + 0.5 * sin(6.2831853 * (u * uStreaks - phase * dir));
  float s2 = 0.5 + 0.5 * sin(6.2831853 * (u * (uStreaks * 2.0 + 1.0) - phase * dir * 1.7) + 1.3);
  float flow = ri == 2 ? 0.7 + 0.3 * sin(uTime * 9.0 + vUV.y * 12.0) : pow(s1, 3.0) * 0.7 + pow(s2, 4.0) * 0.3;
  // ciało w paśmie barwy (pod progiem bloomu)
  float body = vState.x * presence * fl * (0.45 + 0.55 * flow) * (0.55 + 0.45 * face) * (0.85 + 0.15 * pulse);
  body *= 1.0 + vLeak * 0.35;
  // BIEL (8–12, ostro): tylko w pakietach plazmy na szczycie rury — linia z
  // parametru v (góra rury: v = 0,25; kuli: v = 1), pakiet z fazy pasma.
  // Ciągła nić przez cały obwód zalewała model bloomem.
  float dv = ri == 2 ? (1.0 - vUV.y) : abs(vUV.y - 0.25);
  float wv = uFilament * (1.0 + inst * 0.6) * (ri == 2 ? 5.0 : 1.0);
  float line = 1.0 - smoothstep(wv * CORE_EDGE, wv, dv);
  // w stopieniu pakietów przybywa, ale wolno — pełna biel na pierścieniu
  // z bloomem zakrywała cały model
  float pw = uPacket * (1.0 - 0.12 * inst);
  float packet = ri == 2 ? 1.0 : smoothstep(pw, pw + 0.035, s1);
  float white = line * packet * vState.y * presence * fl;
  vec3 col = vColor.rgb * body + vec3(1.0, 0.97, 0.93) * white;
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

// Kolor i alfa ONE/ONE jak blend bloomu w three (coreFx3D FX_BLEND).
const FX_BLEND = { blending: THREE.AdditiveBlending, premultipliedAlpha: true };

/**
 * @param {object} options
 *   scene — THREE.Scene (Core3D.scene), layer — warstwa (7), markLayerActive,
 *   kindFor(core) → 'terran' | 'pirate' | 'atlas', colorFor(core) → [r, g, b]
 */
export function createReactor3D(options = {}) {
  const scene = options.scene;
  if (!scene) throw new Error('createReactor3D: wymagana scena');
  const layer = Number.isFinite(options.layer) ? options.layer : CORE_FX_LAYER;
  const markLayerActive = typeof options.markLayerActive === 'function' ? options.markLayerActive : null;
  const kindFor = typeof options.kindFor === 'function' ? options.kindFor : resolveReactorKind;
  const colorFor = typeof options.colorFor === 'function' ? options.colorFor : () => [0.3, 0.7, 1.0];
  const T = REACTOR3D_TUNE;
  const debug = { enabled: true, xray: false, structure: true, plasma: true };
  const stats = { instances: 0, drawCalls: 0, burnt: 0 };
  let clock = 0;

  const instAttrs = ['iBasis', 'iPos', 'iState', 'iState2', 'iColor', 'iBreak'];
  const kinds = new Map();
  const kindList = [];   // te same rekordy co w `kinds` — pętle na klatkę bez iteratora Map
  for (const kind of REACTOR3D_KINDS) {
    const model = buildReactorModel(kind);
    const bufs = {};
    for (const key of instAttrs) {
      const arr = new Float32Array(MAX_PER_KIND * 4);
      bufs[key] = { arr, attr: new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage) };
    }
    const mkGeo = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
      for (const key of instAttrs) g.setAttribute(key, bufs[key].attr);
      g.instanceCount = 0;
      return g;
    };
    const ringsU = [];
    for (let i = 0; i < 2; i++) {
      const r = model.rings[Math.min(i, model.rings.length - 1)];
      ringsU.push(new THREE.Vector4(r.R, r.z, r.ex, r.ey));
    }
    const albedo = model.palette.map(hexToLinear);
    const structMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlbedo: { value: albedo },
        uSpec: { value: model.spec.map(([p, k]) => new THREE.Vector2(p, k)) },
        uRing: { value: ringsU },
        uRingCount: { value: model.rings.length },
        uCoreLight: { value: new THREE.Vector3(model.coreLight?.z ?? 0, model.coreLight?.gain ?? 0, model.coreLight ? 1 : 0) },
        uAccent: { value: model.accent ? hexToLinear(model.accent) : new THREE.Vector3(0, 0, 0) },
        uAccentL: { value: T.accentL },
        uAmbient: { value: T.ambient },
        uLightGain: { value: T.lightGain },
        uFalloff: { value: T.falloff },
        uTime: { value: 0 },
        uXray: { value: 0 }
      },
      vertexShader: STRUCT_VERTEX,
      fragmentShader: STRUCT_FRAGMENT,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true
    });
    const coilAng = new Float32Array(MAX_COILS);
    const coilCode = new Float32Array(MAX_COILS);
    for (let k = 0; k < Math.min(MAX_COILS, model.coils.length); k++) {
      coilAng[k] = model.coils[k];
      coilCode[k] = model.coilRing[k];
    }
    const plasmaMat = new THREE.ShaderMaterial({
      uniforms: {
        uCoilAng: { value: Array.from(coilAng) },
        uCoilCode: { value: Array.from(coilCode) },
        uCoilCount: { value: Math.min(MAX_COILS, model.coils.length) },
        uRingDir: { value: [model.rings[0]?.dir ?? 1, model.rings[1]?.dir ?? 1, 1] },
        uStreaks: { value: T.streaks },
        uFilament: { value: T.filament },
        uPacket: { value: T.packet },
        uFlicker: { value: model.flicker || 0 },
        uTime: { value: 0 }
      },
      vertexShader: PLASMA_VERTEX,
      fragmentShader: PLASMA_FRAGMENT,
      ...FX_BLEND,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });
    const structGeo = mkGeo(model.structure);
    const plasmaGeo = mkGeo(model.plasma);
    const structMesh = new THREE.Mesh(structGeo, structMat);
    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    for (const [mesh, order, name] of [[structMesh, STRUCT_RENDER_ORDER, 'structure'], [plasmaMesh, PLASMA_RENDER_ORDER, 'plasma']]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      mesh.visible = false;
      mesh.layers.set(layer);
      mesh.name = `reactor3D:${kind}:${name}`;
      scene.add(mesh);
    }
    const kd = { kind, model, bufs, structGeo, plasmaGeo, structMat, plasmaMat, structMesh, plasmaMesh, n: 0 };
    kinds.set(kind, kd);
    kindList.push(kd);
  }

  // Rekord na rdzeń: rodzaj, ziarno, fazy; po wyrzucie/kuli — wrak reaktora.
  const records = new Map();
  const band = { prog: 0, bodyL: 0, coreL: 0, coreR: 0, rim: 0, pulseHz: 0 };
  const _c = { x: 0, y: 0 };
  const _px = { x: 0, y: 0 };
  const _py = { x: 0, y: 0 };
  const _l = { x: 0, y: 0 };
  const colorCache = new WeakMap();
  // początek klatki w scenie (y odwrócone), wspólny dla wszystkich rodzajów
  const origin = { x: 0, y: 0, set: false };

  function coreColor(core) {
    let c = colorCache.get(core);
    if (!c) {
      const raw = parseColor(core.color, null) || parseColor(colorFor(core), [0.3, 0.7, 1.0]);
      const L = Math.max(1e-3, luminance(raw));
      c = [raw[0] / L, raw[1] / L, raw[2] / L];
      colorCache.set(core, c);
    }
    return c;
  }

  function recordFor(core) {
    let rec = records.get(core);
    if (!rec) {
      const k = kindFor(core);
      rec = {
        core, host: core.host, kind: kinds.has(k) ? k : 'terran',
        seed: ((Math.imul((core.uid | 0) + 1, 2654435761) >>> 0) % 1000) / 1000 + Math.random() * 0.001,
        flowPhase: Math.random(), pulsePhase: Math.random() * Math.PI * 2,
        burnt: null, lastSeen: clock
      };
      records.set(core, rec);
    }
    return rec;
  }

  // Czy rdzeń ma model (coreFx3D wyłącza wtedy swój żar — światło daje plazma).
  function covers(core) {
    if (!debug.enabled || !core || core.invalid) return false;
    return kinds.has(records.get(core)?.kind ?? kindFor(core));
  }

  // Detonacja: wyrzut i kula zostawiają wrak reaktora (kierunek w siatce),
  // pozostałe warianty wyparowują model. `info.host` — obiekt, który niesie
  // kadłub po wybuchu, gdy nie jest nim core.host (gra: zabity NPC oddaje heksy
  // wrakowi ze spawnWreckEntity; wrak żyje na komórkach rodzica, więc
  // core.gridX/gridY dalej pasują — zmienia się tylko pivot).
  function detonated(core, info = {}) {
    const rec = records.get(core) || (core ? recordFor(core) : null);
    if (!rec) return;
    const v = info.variant;
    if (v !== 'jet' && v !== 'orb') { records.delete(core); return; }
    const dx = Number(info.dirGridX) || 0;
    const dy = Number(info.dirGridY) || 0;
    rec.burnt = {
      t0: clock, variant: v,
      dirX: dx, dirY: dy,
      halfWidth: v === 'jet' && (dx || dy) ? 0.42 : 0,
      plasma0: 1
    };
    rec.host = info.host || core.host;
  }

  // Kadłub wraku reaktora zniknął: martwy (gra: zabity NPC, `recycleWreck`)
  // albo w puli wraków — obiekt z puli wraca potem jako INNY wrak, więc rekord
  // nie może na nim zostać. Zimny wrak (hexGrid === null) nie jest zniknięciem.
  function burntHostGone(host) {
    return !host || host.dead === true || host._inPool === true;
  }

  // Wrak reaktora przechodzi na inny obiekt kadłuba (np. wrak utworzony po
  // detonacji). false = rdzeń nie ma wraku reaktora.
  function rehost(core, host) {
    const rec = records.get(core);
    if (!rec?.burnt || !host) return false;
    rec.host = host;
    return true;
  }

  function writeInstance(kd, rec, core, host, gridX, gridY, gridR) {
    if (kd.n >= MAX_PER_KIND) return false;
    const b = kd.n * 4;
    gridToLocal(host, gridX, gridY, _l); localToWorld(host, _l.x, _l.y, _c);
    gridToLocal(host, gridX + gridR, gridY, _l); localToWorld(host, _l.x, _l.y, _px);
    gridToLocal(host, gridX, gridY + gridR, _l); localToWorld(host, _l.x, _l.y, _py);
    const B = kd.bufs;
    // scena: y odwrócone
    B.iBasis.arr[b] = _px.x - _c.x; B.iBasis.arr[b + 1] = -(_px.y - _c.y);
    B.iBasis.arr[b + 2] = _py.x - _c.x; B.iBasis.arr[b + 3] = -(_py.y - _c.y);
    const Rw = Math.sqrt(Math.hypot(_px.x - _c.x, _px.y - _c.y) * Math.hypot(_py.x - _c.x, _py.y - _c.y));
    if (!origin.set) { origin.x = _c.x; origin.y = -_c.y; origin.set = true; }
    B.iPos.arr[b] = _c.x - origin.x; B.iPos.arr[b + 1] = -_c.y - origin.y;
    // prześwietlenie (podgląd całości): model nad kadłubem, test głębi bez zmian —
    // wyłączony test głębi w WebGL wyłącza też zapis, a cewki przestałyby
    // przykrywać plazmę
    B.iPos.arr[b + 2] = debug.xray ? Rw * T.zScale + 3 : T.zTop; B.iPos.arr[b + 3] = Rw * T.zScale;
    const col = coreColor(core);
    B.iColor.arr[b] = col[0]; B.iColor.arr[b + 1] = col[1]; B.iColor.arr[b + 2] = col[2]; B.iColor.arr[b + 3] = rec.seed;
    kd.n++;
    return b;
  }

  // matrixAutoUpdate = false, a scena Core3D ma jeden sync macierzy na
  // klatkę — macierz świata odświeżana od razu, niezależnie od kolejności.
  function placeAtOrigin(mesh) {
    mesh.position.set(origin.x, origin.y, 0);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
  }

  /**
   * @param cores   rdzenie (shipCores wszystkich kadłubów)
   * @param nowSec  czas (nieużywany — model kroczy simDt)
   * @param simDt   krok symulacji tej klatki (pauza = 0)
   * @param opts    { sceneOrigin: { x, y } } — początek przy kamerze w układzie
   *                SCENY (x, −y świata), np. wynik sceneOriginNearCamera
   *                (src/3d/sceneOrigin.js) — tak w grze; albo { origin: { x, y } }
   *                w układzie świata gry (y w dół). Bez obu — pierwszy widoczny rdzeń.
   */
  function sync(cores, nowSec, simDt = 1 / 60, opts = null) {
    const dt = Math.max(0, Number(simDt) || 0);
    clock += dt;
    for (let k = 0; k < kindList.length; k++) kindList[k].n = 0;
    const so = opts?.sceneOrigin;
    const o = opts?.origin;
    if (so && Number.isFinite(so.x) && Number.isFinite(so.y)) {
      origin.x = so.x; origin.y = so.y; origin.set = true;
    } else {
      origin.set = !!o && Number.isFinite(o.x) && Number.isFinite(o.y);
      if (origin.set) { origin.x = o.x; origin.y = -o.y; }
    }
    let visible = 0;
    let burntN = 0;
    if (debug.enabled) {
      const list = Array.isArray(cores) ? cores : [];
      for (const core of list) {
        if (!core || core.invalid || core.state === CORE_STATE.DETONATED) continue;
        const host = core.host;
        if (!host?.hexGrid || host.dead) continue;
        if (!debug.xray && coreStateRank(core.state) < coreStateRank(CORE_STATE.EXPOSED)) continue;
        const rec = recordFor(core);
        rec.lastSeen = clock;
        rec.host = host;
        const kd = kinds.get(rec.kind);
        coreStateBand(core, band);
        rec.flowPhase += flowRevPerSec(core, band) * dt;
        rec.pulsePhase += Math.PI * 2 * band.pulseHz * dt;
        const pulse = 0.5 + 0.5 * Math.sin(rec.pulsePhase);
        const b = writeInstance(kd, rec, core, host, core.gridX, core.gridY, core.gridR);
        if (b === false) continue;
        const B = kd.bufs;
        B.iState.arr[b] = band.bodyL; B.iState.arr[b + 1] = band.coreL * (0.92 + 0.08 * pulse);
        B.iState.arr[b + 2] = rec.flowPhase; B.iState.arr[b + 3] = instability(core, band);
        B.iState2.arr[b] = coilHeat(core, band); B.iState2.arr[b + 1] = brokenFrac(core);
        B.iState2.arr[b + 2] = pulse; B.iState2.arr[b + 3] = 1;
        B.iBreak.arr[b] = 0; B.iBreak.arr[b + 1] = 0; B.iBreak.arr[b + 2] = 0; B.iBreak.arr[b + 3] = -1;
        visible++;
      }
      // wraki reaktorów (po wyrzucie i kuli); zimny wrak (bez hexGrid) nie
      // rysuje, ale rekord czeka na odmrożenie
      for (const rec of records.values()) {
        if (!rec.burnt) continue;
        const host = rec.host;
        if (!host?.hexGrid || burntHostGone(host)) continue;
        const kd = kinds.get(rec.kind);
        const t = clock - rec.burnt.t0;
        const core = rec.core;
        const b = writeInstance(kd, rec, core, host, core.gridX, core.gridY, core.gridR);
        if (b === false) continue;
        const heat = Math.exp(-t / Math.max(0.05, T.burnCool));
        const plasma = Math.max(0, 1 - t / Math.max(0.01, T.plasmaOut));
        rec.flowPhase += 2.5 * dt * plasma;
        const B = kd.bufs;
        B.iState.arr[b] = CORE_FX_BANDS.bodyL.meltdown; B.iState.arr[b + 1] = CORE_FX_BANDS.coreL.meltdown * plasma;
        B.iState.arr[b + 2] = rec.flowPhase; B.iState.arr[b + 3] = 0.9;
        B.iState2.arr[b] = heat; B.iState2.arr[b + 1] = 0.85; B.iState2.arr[b + 2] = 0.5; B.iState2.arr[b + 3] = plasma;
        B.iBreak.arr[b] = rec.burnt.dirX; B.iBreak.arr[b + 1] = rec.burnt.dirY;
        B.iBreak.arr[b + 2] = rec.burnt.halfWidth; B.iBreak.arr[b + 3] = heat;
        visible++;
        burntN++;
      }
    }
    // rekordy rdzeni, których nie widać od dawna (kadłub zniknął)
    for (const [core, rec] of records) {
      if (rec.burnt) { if (burntHostGone(rec.host)) records.delete(core); continue; }
      if (clock - rec.lastSeen > 30) records.delete(core);
    }
    let calls = 0;
    for (let k = 0; k < kindList.length; k++) {
      const kd = kindList[k];
      const n = kd.n;
      kd.structGeo.instanceCount = n;
      kd.plasmaGeo.instanceCount = n;
      kd.structMesh.visible = n > 0 && debug.structure;
      kd.plasmaMesh.visible = n > 0 && debug.plasma;
      if (n > 0) {
        for (const key of instAttrs) {
          const a = kd.bufs[key].attr;
          a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true;
        }
        placeAtOrigin(kd.structMesh);
        placeAtOrigin(kd.plasmaMesh);
      }
      kd.structMat.uniforms.uTime.value = clock;
      kd.plasmaMat.uniforms.uTime.value = clock;
      kd.structMat.uniforms.uXray.value = debug.xray ? 1 : 0;
      calls += (kd.structMesh.visible ? 1 : 0) + (kd.plasmaMesh.visible ? 1 : 0);
    }
    stats.instances = visible;
    stats.burnt = burntN;
    stats.drawCalls = calls;
    if (markLayerActive && calls > 0) markLayerActive();
    return calls;
  }

  function reset() {
    records.clear();
  }

  function dispose() {
    for (const kd of kinds.values()) {
      scene.remove(kd.structMesh);
      scene.remove(kd.plasmaMesh);
      kd.structGeo.dispose(); kd.plasmaGeo.dispose();
      kd.model.structure.dispose(); kd.model.plasma.dispose();
      kd.structMat.dispose(); kd.plasmaMat.dispose();
    }
    kinds.clear();
    kindList.length = 0;
    records.clear();
  }

  return {
    sync, detonated, rehost, covers, reset, dispose, stats, debug, layer, origin,
    kinds: [...kinds.keys()],
    meshes: Object.fromEntries([...kinds.values()].map((kd) => [kd.kind, { structure: kd.structMesh, plasma: kd.plasmaMesh }])),
    records
  };
}
