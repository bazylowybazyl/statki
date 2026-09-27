// Render budowli portowych (Z7): stocznia z suchym dokiem i hangar postojowy.
// Dane brył z portBuildingScene.js (bez Three), tu: instancje (prostopadłościan,
// walec, torus) w zestawach BG / FG / dach, płyty, napisy, grupy ruchome
// (macierze co klatkę), kanały efektów i kadłuby w budowie (portHullBuild3D.js).
//
// Zasady (AGENTS.md): bez własnego renderera — obiekty trafiają do sceny
// gospodarza (Core3D.scene albo grupa ringu), warstwy ustawia gospodarz
// (setLayers: BG = 1 pod statkami, FG = 2 nad nimi, jak hale K-7). Dane instancji
// liczone względem korzenia budowli (małe liczby), a korzeń stoi w
// `root.matrix` = układ budowli → scena gospodarza; three składa
// modelViewMatrix w double, więc bez drgań przy 5–10 mln j. (wzór hal K-7 i
// Bridge3D._setOrigin — dane względem pobliskiego początku, duży offset w macierzy).
//
// Dwa modele światła (define):
//  - PB_LIGHT_HALO — na ringu: model ringu jak hala K-7 (haloSunVisibility: cień
//    planety z czerwonym brzegiem i bryły ringu, światło planety), uniformy ringu
//    (createHaloUniforms) + uHub = macierz budowli → układ ringu;
//  - przestrzeń (megadok, stacja bez ringu, demo): słońce gry z wysokością 49°
//    (jak DirectionalLight i ring), widoczność od gospodarza (uSunVisS: cień
//    planety) × maska cieni słońca Core3D (sunVisibility/sunFill, sunShadowMask.js).
// Emisja w paśmie HDR 0,9–1,4 (bloom przy progu 0,9), iskry spawania i błyski
// drobne (≤ kilka px) do ~6 — AGENTS.md: emitery HDR > 1.
import * as THREE from 'three';
import { HALO_GLSL_COMMON, HALO_GLSL_LIGHT, HALO_GLSL_NOISE } from '../haloRing/haloRingGLSL.js';
import { K7_ABOVE_SCALE, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { SUN_SHADOW_GLSL, sunShadowUniforms } from '../sunShadowMask.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements } from './portModuleTraffic.js';
import {
  HANGAR_CH,
  PB_CHANNELS,
  PB_MAX_GROUPS,
  PB_MAX_LAMPS,
  PB_STRIDE,
  YARD_CH,
  buildHangarScene,
  buildShipyardScene
} from './portBuildingScene.js';
import { HULL_BUILD_STAGES, hullBuildFront } from './portShipyardLayout.js';
import { PortHullBuild3D } from './portHullBuild3D.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// stan „bez zmian” (update bez argumentu) — bez literału obiektu co klatkę
const NO_STATE = Object.freeze({});
const smooth = (t) => t * t * (3 - 2 * t);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

// ---------------------------------------------------------------------------
// GLSL (komentarze tylko ASCII, bez znaku grawisu — kończyłby szablon JS)

const PB_GLSL_UNIFORMS = /* glsl */`
uniform mat4 uGroup[${PB_MAX_GROUPS}];
uniform vec4 uChan[${PB_CHANNELS / 4}];
uniform vec4 uPbTime;              // x czas, y krycie (dach), z dzien 0..1, w moc lamp
uniform vec3 uPbPal[14];           // paleta materialow K-7 z profilu planety
uniform vec3 uPbEmit[5];           // cyjan, ciepla, biel, czerwien, zielen (HDR)
uniform vec3 uPbGlow[2];           // poswiata szkla: stala, nocna
uniform vec3 uPbWeld;              // luk spawalniczy (HDR)
uniform vec4 uLamps[${PB_MAX_LAMPS}];   // xyz w ukladzie budowli, w: 0 brak, 1 ciepla, 2 zimna
#ifdef PB_LIGHT_HALO
uniform mat4 uHub;                 // uklad budowli -> uklad ringu
#else
uniform vec3 uSunDirW;             // kierunek do slonca (scena)
uniform vec3 uSunColorS;
uniform vec3 uAmbientS;
uniform float uSunVisS;            // cien planety od gospodarza (0..1)
#endif
float pbChan(float c) {
  int i = int(c + 0.5);
  vec4 v = uChan[i / 4];
  int k = i - (i / 4) * 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`;

const PB_GLSL_VARYINGS = /* glsl */`
varying vec3 vLit;
varying vec3 vLitN;
varying vec3 vHub;
varying vec3 vHubN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying float vMat;
varying vec4 vFx;
varying vec3 vSunL;
`;

// Wspolne dla wierzcholka: polozenie i normalna w ukladzie swiatla.
const PB_GLSL_LIGHT_FRAME = /* glsl */`
void pbLightFrame(vec4 gp, vec3 gn) {
  vHub = gp.xyz;
  vHubN = gn;
#ifdef PB_LIGHT_HALO
  vLit = (uHub * gp).xyz;
  vLitN = normalize(mat3(uHub) * gn);
  vSunL = uSunDir;
#else
  vLit = (modelViewMatrix * gp).xyz;
  vLitN = normalize(mat3(modelViewMatrix) * gn);
  vSunL = normalize(mat3(viewMatrix) * uSunDirW);
#endif
}
`;

const INSTANCE_VERTEX = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
#endif
${PB_GLSL_UNIFORMS}
${PB_GLSL_VARYINGS}
attribute vec4 iA;     // srodek xyz, skala pionowa
attribute vec4 iB;     // rozmiar xyz, material
attribute vec4 iQ;     // kwaternion
attribute vec4 iC;     // grupa
attribute vec4 iD;     // efekt: jasnosc, tryb, faza, parametr
${PB_GLSL_LIGHT_FRAME}
vec3 qrot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  vec3 lp = position * iB.xyz;
  vec3 r = qrot(iQ, lp);
  r.y *= iA.w;
  vec3 hubP = iA.xyz + r;
  vec3 nl = normalize(normal / max(iB.xyz, vec3(1e-3)));
  vec3 nr = qrot(iQ, nl);
  nr.y /= max(iA.w, 1e-3);
  mat4 G = uGroup[int(iC.x + 0.5)];
  vec4 gp = G * vec4(hubP, 1.0);
  vec3 gn = normalize(mat3(G) * nr);
  pbLightFrame(gp, gn);
  vLocal = lp;
  vLocalN = normal;
  vMat = iB.w;
  vFx = iD;
  gl_Position = projectionMatrix * modelViewMatrix * gp;
  // tryb show (7): bryla widoczna tylko z flaga kanalu (blok na suwnicy)
  if (iD.y > 6.5 && iD.y < 7.5) {
    int flags = int(pbChan(iD.w) + 0.5);
    int bit = int(iD.z + 0.5);
    if ((flags / bit) - ((flags / bit) / 2) * 2 == 0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
}
`;

// Powierzchnia: plyty K-7 (lustro k7Plates z haloPortK7.js), BRDF jak k7Shade,
// lampy budowli, emisja z efektami.
const PB_GLSL_SURFACE = /* glsl */`
float pbHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 pbPalette(float m) {
  int i = int(clamp(floor(m + 0.5), 0.0, 14.0));
  return i < 14 ? uPbPal[i] : vec3(0.02, 0.022, 0.025);
}
vec3 pbEmit(float m) {
  return uPbEmit[int(clamp(floor(m + 0.5) - 14.0, 0.0, 4.0))];
}
float pbPlates(vec2 uv, bool deck, float fw, out float highlight) {
  vec2 cells = deck ? vec2(4.0, 4.0) : vec2(3.0, 4.0);
  vec2 g = uv / 260.0 * cells;
  vec2 id = floor(g);
  vec2 fcell = fract(g);
  vec2 psz = 260.0 / cells;
  vec2 d = min(fcell, 1.0 - fcell) * psz;
  float aa = fw * 1.2 + 0.2;
  float seam = 1.0 - smoothstep(0.35, 0.35 + aa, min(d.x, d.y));
  highlight = (1.0 - smoothstep(0.7, 0.7 + aa, fcell.x * psz.x)) + (1.0 - smoothstep(0.7, 0.7 + aa, (1.0 - fcell.y) * psz.y));
  highlight *= 1.0 - seam;
  float v = pbHash12(id + (deck ? 17.0 : 3.0));
  vec2 b = abs(fcell * psz - 4.4);
  vec2 b2 = abs((1.0 - fcell) * psz - 4.4);
  float bolt = 1.0 - smoothstep(0.7, 0.7 + aa, min(min(length(b), length(b2)), min(length(vec2(b.x, b2.y)), length(vec2(b2.x, b.y)))));
  vec2 sc = fcell - vec2(0.8, 0.7);
  float stain = exp(-dot(sc, sc) * 9.0) * pbHash12(id + 5.0);
  float detail = 1.0 - smoothstep(0.8, 3.0, fw);
  float base = deck ? mix(0.11, 0.17, v) : mix(0.42, 0.56, v);
  return base * (1.0 - seam * 0.55 * detail) * (1.0 - bolt * 0.5 * detail) * (1.0 - stain * 0.25);
}
vec3 pbLampLight(vec3 hubP, vec3 N) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${PB_MAX_LAMPS}; i++) {
    vec4 Lp = uLamps[i];
    vec3 dv = Lp.xyz - hubP;
    float d = length(dv);
    float fall = 1.0 / (1.0 + (d / 520.0) * (d / 520.0));
    float win = (1.0 - smoothstep(1500.0, 2450.0, d)) * step(0.5, Lp.w);
    vec3 col = Lp.w < 1.5 ? vec3(1.0, 0.78, 0.55) : vec3(0.66, 0.85, 0.92);
    acc += col * fall * win * max(dot(N, dv / max(d, 1.0)), 0.0);
  }
  return acc;
}
// Poziom efektu (0..1+) wg trybu instancji.
float pbFxLevel(vec4 fx) {
  float mode = fx.y;
  float ph = fx.z;
  float par = fx.w;
  float t = uPbTime.x;
  if (mode < 0.5) return 1.0;
  if (mode < 1.5) return fract(t * par + ph) < 0.3 ? 1.0 : 0.05;
  if (mode < 2.5) return 0.08 + 0.92 * exp(-fract(t * par - ph) * 7.0);
  if (mode < 3.5) return pbChan(par) >= ph ? 1.0 : 0.07;
  if (mode < 4.5) {
    float work = pbChan(par);
    float front = pbChan(par + 1.0);
    float near = 1.0 - smoothstep(0.03, 0.12, abs(front - ph));
    float n = floor(t * 22.0);
    float on = step(0.45, pbHash12(vec2(n, ph * 311.0)));
    return work * near * on * (0.7 + 1.6 * pbHash12(vec2(n + 7.0, ph * 97.0)));
  }
  if (mode < 5.5) return 1.0;
  if (mode < 6.5) {
    float n = pbChan(par);
    // zajete miejsca kolejki swieca, impuls biegnie ku bramie (prowadzi do wlotu)
    return n > ph ? 0.6 + 0.4 * exp(-fract(t * 0.9 + ph * 0.083) * 5.0) : 0.04;
  }
  if (mode > 7.5 && mode < 8.5) return pbChan(par) >= 0.5 ? 0.08 + 0.92 * exp(-fract(t * 1.2 - ph) * 7.0) : 0.12;
  return 1.0;
}
vec3 pbShade(vec3 albedo0, float m, vec3 hubN, vec2 fuv, float fw, vec4 fx) {
  vec3 P = vLit;
  vec3 N = normalize(vLitN);
  vec3 L = normalize(vSunL);
#ifdef PB_LIGHT_HALO
  vec3 V = normalize(uCamLocal - P);
  vec3 sunVis = haloSunVisibility(P + N * 2.0, L);
  vec3 sunCol = uSunColor;
  vec3 amb = vec3(0.050, 0.056, 0.066) * (0.55 + 0.45 * max(hubN.y, 0.0)) + haloPlanetshine(P, N) + vec3(uNightAmbient);
#else
  vec3 V = normalize(-P);
  float sv = uSunVisS * sunVisibility();
  vec3 sunVis = vec3(sv);
  vec3 sunCol = uSunColorS;
  vec3 amb = uAmbientS * (0.55 + 0.45 * max(hubN.y, 0.0)) * sunFill(sv);
#endif
  bool plated = m < 5.5;
  bool deck = (m > 5.5 && m < 6.5) || m > 19.5;
  float hl = 0.0;
  vec3 albedo = albedo0;
  if (plated || deck) albedo *= pbPlates(fuv, deck, fw, hl);
  if (m > 19.5) albedo = vec3(0.012, 0.017, 0.021) * pbPlates(fuv, true, fw, hl);
  float rough = m > 6.5 && m < 7.5 ? 0.38 : (m > 9.5 && m < 10.5 ? 0.45 : (m > 10.5 && m < 11.5 ? 0.2 : 0.72));
  float metal = m > 6.5 && m < 7.5 ? 0.86 : (plated ? 0.5 : 0.1);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  vec3 H = normalize(L + V);
  float a2 = rough * rough;
  float NdH = max(dot(N, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = Fs * min(a2 / (3.14159265 * dd * dd) * 0.25 / NdV, 6.0) * NdL;
  amb += pbLampLight(vHub, hubN) * uPbTime.w;
  vec3 diffuse = albedo * (1.0 - metal * 0.7);
  vec3 color = diffuse * (sunCol * sunVis * NdL + amb) + sunCol * sunVis * spec * 0.8;
  color += albedo * hl * 0.25 * (dot(sunVis, vec3(0.2126, 0.7152, 0.0722)) * NdL + 0.2);
  color += F0 * 0.03 * (1.0 - rough);
  float gain = fx.x > 0.0 ? fx.x : 1.0;
  if (m > 13.5 && m < 18.5) color = pbEmit(m) * gain * pbFxLevel(fx);
  if (m > 18.5 && m < 19.5) color = mix(uPbEmit[3], uPbEmit[4], clamp(pbChan(fx.w), 0.0, 1.0)) * gain;
  if (m > 15.5 && m < 16.5 && fx.y > 3.5 && fx.y < 4.5) color = uPbWeld * pbFxLevel(fx);
  if (m > 10.5 && m < 11.5) color += uPbGlow[0] + uPbGlow[1] * (0.3 + 0.7 * (1.0 - uPbTime.z));
  return max(color, vec3(0.0));
}
`;

const PB_FRAGMENT_HEAD = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
#else
${SUN_SHADOW_GLSL}
#endif
${PB_GLSL_UNIFORMS}
${PB_GLSL_VARYINGS}
${PB_GLSL_SURFACE}
`;

const INSTANCE_FRAGMENT = /* glsl */`
${PB_FRAGMENT_HEAD}
void main() {
  float m = floor(vMat + 0.5);
  vec3 kn = abs(vLocalN);
  vec2 fuv = kn.y > 0.55 ? vLocal.xz : (kn.x > 0.55 ? vLocal.zy : vLocal.xy);
  float fw = fwidth(fuv.x) + fwidth(fuv.y);
  vec3 c = pbShade(pbPalette(m), m, normalize(vHubN), fuv, fw, vFx);
  gl_FragColor = vec4(c, uPbTime.y);
}
`;

const PLATE_VERTEX = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
#endif
${PB_GLSL_UNIFORMS}
${PB_GLSL_VARYINGS}
attribute float aMat;
${PB_GLSL_LIGHT_FRAME}
void main() {
  pbLightFrame(vec4(position, 1.0), normal);
  vLocal = position;
  vLocalN = normal;
  vMat = aMat;
  vFx = vec4(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const PLATE_FRAGMENT = /* glsl */`
${PB_FRAGMENT_HEAD}
void main() {
  float m = floor(vMat + 0.5);
  vec2 fuv = abs(vLocalN.y) > 0.5 ? vLocal.xz : (abs(vLocalN.x) > 0.5 ? vLocal.zy : vLocal.xy);
  float fw = fwidth(fuv.x) + fwidth(fuv.y);
  vec3 c = pbShade(pbPalette(m), m, vLocalN, fuv, fw, vec4(0.0));
  gl_FragColor = vec4(c, uPbTime.y);
}
`;

// Napisy: atlas (bialy tekst w alfie), kolor na czworokat, swiatlo slonca.
const LABEL_VERTEX = /* glsl */`
#ifdef PB_LIGHT_HALO
${HALO_GLSL_COMMON}
#endif
${PB_GLSL_UNIFORMS}
${PB_GLSL_VARYINGS}
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
${PB_GLSL_LIGHT_FRAME}
void main() {
  vUv = uv;
  vColor = aColor;
  pbLightFrame(vec4(position, 1.0), normal);
  vLocal = position;
  vLocalN = normal;
  vMat = 0.0;
  vFx = vec4(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LABEL_FRAGMENT = /* glsl */`
${PB_FRAGMENT_HEAD}
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float a = texture2D(uAtlas, vUv).a;
  if (a < 0.02) discard;
  vec3 N = normalize(vLitN);
  vec3 L = normalize(vSunL);
  float NdL = max(dot(N, L), 0.0);
#ifdef PB_LIGHT_HALO
  vec3 sunVis = haloSunVisibility(vLit + N * 2.0, L);
  vec3 lit = uSunColor * sunVis * NdL + vec3(0.05, 0.056, 0.066) + haloPlanetshine(vLit, N);
#else
  float sv = uSunVisS * sunVisibility();
  vec3 lit = uSunColorS * sv * NdL + uAmbientS * sunFill(sv);
#endif
  lit += pbLampLight(vHub, vec3(0.0, 1.0, 0.0)) * uPbTime.w * 0.6;
  vec3 col = vColor * lit * 0.9;
  gl_FragColor = vec4(col * a * uPbTime.y, a * uPbTime.y);
}
`;

export const PORT_BUILDING_SHADERS = Object.freeze({
  INSTANCE_VERTEX, INSTANCE_FRAGMENT, PLATE_VERTEX, PLATE_FRAGMENT, LABEL_VERTEX, LABEL_FRAGMENT
});

// ---------------------------------------------------------------------------
// Geometrie

function makeInstanced(base, data, sphere) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const arr = new Float32Array(data);
  const buf = new THREE.InstancedInterleavedBuffer(arr, PB_STRIDE);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 12));
  geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(buf, 4, 16));
  geo.instanceCount = arr.length / PB_STRIDE;
  geo.boundingSphere = sphere.clone();
  return { geo, arr, buf };
}

// Obwiednia budowli w jej układzie (środki instancji + zapas).
function sceneSphere(sets, plates) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  const take = (x, z) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  for (const set of Object.values(sets)) {
    for (const data of Object.values(set)) for (let i = 0; i < data.length; i += PB_STRIDE) take(data[i], data[i + 2]);
  }
  for (const p of plates) for (const [x, z] of p.points) take(x, z);
  if (!Number.isFinite(x0)) { x0 = z0 = -1; x1 = z1 = 1; }
  const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1200;
  return new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), r);
}

// Wypukłe wielokąty wytłoczone w pionie (pokład, dach) — jedna geometria na zestaw.
function makePlates(plates) {
  const pos = [];
  const nor = [];
  const mat = [];
  const tri = (a, b, c, n, m) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { nor.push(...n); mat.push(m); }
  };
  for (const p of plates) {
    const pts = p.points;
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ordered = area < 0 ? pts : pts.slice().reverse();
    const top = ordered.map(([x, z]) => [x, p.z1, z]);
    const bot = ordered.map(([x, z]) => [x, p.z0, z]);
    for (let i = 1; i + 1 < n; i++) {
      tri(top[0], top[i], top[i + 1], [0, 1, 0], p.mat);
      tri(bot[0], bot[i + 1], bot[i], [0, -1, 0], p.mat);
    }
    for (let i = 0; i < n; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      const nrm = [-ez / len, 0, ex / len];
      const sideMat = p.mat === 6 ? 1 : p.mat;
      tri([a[0], p.z0, a[1]], [b[0], p.z0, b[1]], [b[0], p.z1, b[1]], nrm, sideMat);
      tri([a[0], p.z0, a[1]], [b[0], p.z1, b[1]], [a[0], p.z1, a[1]], nrm, sideMat);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  g.computeBoundingSphere();
  return g;
}

const srgbTriple = (hex) => {
  const h = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  const c = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255)];
};

// Atlas napisów (jak groundText K-7: pogrubiony Arial + opis mono).
function makeLabelAtlas(labels) {
  if (typeof document === 'undefined' || !labels.length) return null;
  const unique = new Map();
  for (const l of labels) {
    const key = l.text + '|' + l.small;
    if (!unique.has(key)) unique.set(key, { text: l.text, small: l.small, cell: unique.size });
  }
  const cellW = 512;
  const cellH = 116;
  const cols = 4;
  const rows = Math.ceil(unique.size / cols);
  const H = Math.max(128, 2 ** Math.ceil(Math.log2(rows * cellH)));
  const canvas = document.createElement('canvas');
  canvas.width = cellW * cols;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const u of unique.values()) {
    const cx = (u.cell % cols) * cellW;
    const cy = Math.floor(u.cell / cols) * cellH;
    const hasSmall = !!u.small;
    const h = hasSmall ? cellH : cellH * 140 / 230;
    const scale = cellW / 1024;
    g.save();
    g.translate(cx, cy);
    g.font = `700 ${Math.round(102 * scale)}px Arial`;
    g.fillText(u.text, cellW / 2, 66 * scale, 970 * scale);
    if (hasSmall) {
      g.font = `${Math.round(27 * scale)}px monospace`;
      g.fillText(u.small, cellW / 2, 177 * scale, 960 * scale);
    }
    g.restore();
    u.uv = [cx / canvas.width, 1 - (cy + h) / canvas.height, (cx + cellW) / canvas.width, 1 - cy / canvas.height];
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, unique };
}

function makeLabelMesh(labels, atlas) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  for (const l of labels) {
    const u = atlas.unique.get(l.text + '|' + l.small);
    const [u0, v0, u1, v1] = u.uv;
    const c = srgbTriple(l.color);
    const base = pos.length / 3;
    const r = l.rotation || 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    for (const [a, b, uu, vv] of [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]]) {
      const px = a * l.width;
      const py = b * l.depth;
      const x = px * cr - py * sr;
      const y = px * sr + py * cr;
      pos.push(l.x + x, l.y, l.z - y);
      nor.push(0, 1, 0);
      uv.push(uu, vv);
      col.push(...c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Światło w trybie przestrzeni: słońce gry (azymut z Słońca gry, wysokość 49°
// jak DirectionalLight i ring), otoczenie jak obiekty 3D gry.
export const PORT_SPACE_LIGHT = Object.freeze({
  sunElevationDeg: 49,
  sunColor: Object.freeze([1.02, 0.984, 0.933]),
  ambient: Object.freeze([0.050, 0.056, 0.066])
});

// Geometrie bazowe instancji — osobne na budowlę (jak _box / _cyl hali K-7):
// dispose() jednej budowli zwalnia bufory atrybutów, które dzieli tylko ze sobą.
function baseGeometries() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false),
    torus: new THREE.TorusGeometry(1, 0.13, 6, 24)
  };
}

/**
 * Wspólna podstawa budowli: korzeń (układ budowli → scena gospodarza), zestawy
 * siatek BG / FG / dach, uniformy (paleta ze stylu, kanały, grupy, lampy, światło).
 */
export class PortBuilding3D {
  /**
   * @param {object} o
   *   layout      układ (createShipyardLayout / createHangarLayout)
   *   scene       dane sceny (buildShipyardScene / buildHangarScene)
   *   style       styl (resolvePortBuildingStyle albo klucz / profil / styl megadoku)
   *   frame       ramka (portModuleFrame / portRingModuleFrame) w układzie gospodarza
   *   light       'space' (domyślnie) albo 'halo'
   *   haloUniforms  uniformy ringu (createHaloUniforms) — wymagane dla 'halo'
   */
  constructor({ layout, scene, style = 'earth', frame, light = 'space', haloUniforms = null, name = 'PortBuilding' }) {
    this.layout = layout;
    this.scene = scene;
    this.style = style && style.palette ? style : resolvePortBuildingStyle(style);
    this.frame = frame;
    this.lightMode = light === 'halo' && haloUniforms ? 'halo' : 'space';
    this.root = new THREE.Group();
    this.root.name = name;
    this.root.matrixAutoUpdate = false;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.meshes = { bg: [], fg: [], roof: [] };
    this.materials = [];
    this.time = 0;
    this.roofFade = 0;
    const groups = Array.from({ length: PB_MAX_GROUPS }, () => new THREE.Matrix4());
    const lamps = Array.from({ length: PB_MAX_LAMPS }, (_, i) => {
      const l = scene.lamps[i];
      return l ? new THREE.Vector4(l[0], l[1], l[2], l[3]) : new THREE.Vector4(0, 0, 0, 0);
    });
    this.uniforms = {
      uGroup: { value: groups },
      uChan: { value: Array.from({ length: PB_CHANNELS / 4 }, () => new THREE.Vector4()) },
      uPbTime: { value: new THREE.Vector4(0, 1, 1, 0.3) },
      uPbPal: { value: this.style.palette.map((c) => new THREE.Vector3(...c)) },
      uPbEmit: { value: this.style.emit.map((c) => new THREE.Vector3(...c)) },
      uPbGlow: { value: this.style.glow.map((c) => new THREE.Vector3(...c)) },
      uPbWeld: { value: new THREE.Vector3(...this.style.weld) },
      uLamps: { value: lamps },
      uHub: { value: this.root.matrix },
      uSunDirW: { value: new THREE.Vector3(0.4, 0.3, 0.87).normalize() },
      uSunColorS: { value: new THREE.Vector3(...PORT_SPACE_LIGHT.sunColor) },
      uAmbientS: { value: new THREE.Vector3(...PORT_SPACE_LIGHT.ambient) },
      uSunVisS: { value: 1 }
    };
    // dach: osobny obiekt krycia (reszta zawsze 1)
    this.roofTime = { value: new THREE.Vector4(0, 1, 1, 0.3) };
    const hostUniforms = this.lightMode === 'halo' ? haloUniforms : sunShadowUniforms;
    this._common = { ...hostUniforms, ...this.uniforms };
    this._commonRoof = { ...hostUniforms, ...this.uniforms, uPbTime: this.roofTime };
    this.defines = this.lightMode === 'halo' ? { PB_LIGHT_HALO: 1 } : {};
    this.sphere = sceneSphere(scene.sets, scene.plates);
    this._build();
  }

  _material(name, vs, fs, uniforms, opts = {}) {
    const m = new THREE.ShaderMaterial({ name, uniforms, vertexShader: vs, fragmentShader: fs, defines: { ...this.defines }, ...opts });
    this.materials.push(m);
    return m;
  }

  _build() {
    const sc = this.scene;
    const bases = baseGeometries();
    this._bases = bases;
    this.instances = {};
    const mats = {
      bg: this._material('PortBuildingBG', INSTANCE_VERTEX, INSTANCE_FRAGMENT, this._common),
      fg: this._material('PortBuildingFG', INSTANCE_VERTEX, INSTANCE_FRAGMENT, this._common),
      roof: this._material('PortBuildingRoof', INSTANCE_VERTEX, INSTANCE_FRAGMENT, this._commonRoof, { transparent: true })
    };
    this.roofMaterials = [mats.roof];
    for (const set of ['bg', 'fg', 'roof']) {
      for (const kind of ['box', 'cyl', 'torus']) {
        const data = sc.sets[set][kind];
        if (!data.length) continue;
        const inst = makeInstanced(bases[kind], data, this.sphere);
        const mesh = new THREE.Mesh(inst.geo, mats[set]);
        mesh.name = `${this.root.name}_${set}_${kind}`;
        mesh.frustumCulled = true;
        if (set === 'roof') mesh.renderOrder = 20;
        this.root.add(mesh);
        this.meshes[set].push(mesh);
        this.instances[set + '_' + kind] = inst;
      }
    }
    for (const set of ['bg', 'fg', 'roof']) {
      const list = sc.plates.filter((p) => (p.set || 'bg') === set);
      if (!list.length) continue;
      const uni = set === 'roof' ? this._commonRoof : this._common;
      const mat = this._material(`PortBuildingPlates_${set}`, PLATE_VERTEX, PLATE_FRAGMENT, uni, set === 'roof' ? { transparent: true } : {});
      if (set === 'roof') this.roofMaterials.push(mat);
      const mesh = new THREE.Mesh(makePlates(list), mat);
      mesh.name = `${this.root.name}_plates_${set}`;
      mesh.frustumCulled = true;
      if (set === 'roof') mesh.renderOrder = 20;
      this.root.add(mesh);
      this.meshes[set].push(mesh);
    }
    this.atlas = makeLabelAtlas(sc.labels);
    if (this.atlas) {
      for (const set of ['bg', 'fg', 'roof']) {
        const list = sc.labels.filter((l) => (l.set || 'bg') === set);
        if (!list.length) continue;
        const uni = { ...(set === 'roof' ? this._commonRoof : this._common), uAtlas: { value: this.atlas.tex } };
        const mat = this._material(`PortBuildingLabels_${set}`, LABEL_VERTEX, LABEL_FRAGMENT, uni, {
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        const mesh = new THREE.Mesh(makeLabelMesh(list, this.atlas), mat);
        mesh.name = `${this.root.name}_labels_${set}`;
        mesh.frustumCulled = true;
        mesh.renderOrder = set === 'roof' ? 21 : 5;
        this.root.add(mesh);
        this.meshes[set].push(mesh);
        if (set === 'roof') this.roofMaterials.push(mat);
      }
    }
  }

  /** Warstwy gospodarza: BG pod statkami, FG nad nimi (dach też w FG). */
  setLayers(bgLayer = 1, fgLayer = 2) {
    for (const m of this.meshes.bg) m.layers.set(bgLayer);
    for (const m of this.meshes.fg) m.layers.set(fgLayer);
    for (const m of this.meshes.roof) m.layers.set(fgLayer);
    this._layers = { bg: bgLayer, fg: fgLayer };
  }

  setVisible(v) { this.root.visible = !!v; }

  /**
   * Słońce w trybie przestrzeni: `sun` — punkt Słońca w UKŁADZIE GRY (y w dół)
   * albo { azimuth } (radiany, scena), `at` — punkt budowli w grze, `visibility`
   * — cień planety 0..1 (gospodarz: planeta między budowlą a Słońcem).
   */
  setSun({ sun = null, at = null, azimuth = null, elevationDeg = PORT_SPACE_LIGHT.sunElevationDeg, visibility = 1 } = {}) {
    let az = Number(azimuth);
    if (!Number.isFinite(az) && sun) {
      const ax = Number(at?.x) || 0;
      const ay = Number(at?.y) || 0;
      az = Math.atan2(-(Number(sun.y) - ay), Number(sun.x) - ax);
    }
    if (!Number.isFinite(az)) az = 0;
    const el = elevationDeg * Math.PI / 180;
    this.uniforms.uSunDirW.value.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).normalize();
    this.uniforms.uSunVisS.value = clamp01(Number(visibility));
    this.sunAzimuth = az;
  }

  _setChan(i, v) {
    const vec = this.uniforms.uChan.value[i >> 2];
    const k = i & 3;
    if (k === 0) vec.x = v; else if (k === 1) vec.y = v; else if (k === 2) vec.z = v; else vec.w = v;
  }

  /** Zegar efektów i pora dnia (lampy hal mocniejsze nocą) — woła update podklas. */
  tick(dt, { daylight = 1, lampPower = null } = {}) {
    this.time += Math.max(0, Number(dt) || 0);
    const t = this.uniforms.uPbTime.value;
    t.x = this.time;
    t.y = 1;
    t.z = clamp01(daylight);
    t.w = lampPower ?? (0.22 + 0.55 * (1 - clamp01(daylight)));
    const rt = this.roofTime.value;
    rt.x = t.x; rt.z = t.z; rt.w = t.w;
  }

  // Zanik dachu (0 = nieprzezroczysty, 1 = statek w środku — dach znika) jak K-7.
  _applyRoofFade(fade) {
    this.roofFade = clamp01(fade);
    const opacity = 1 - this.roofFade;
    this.roofTime.value.y = opacity;
    const opaque = opacity > 0.97;
    for (const m of this.roofMaterials) {
      // napisy (mieszanie własne) zawsze przezroczyste i bez zapisu głębi
      if (m.blending === THREE.CustomBlending) continue;
      m.depthWrite = opaque;
      m.transparent = !opaque;
    }
    const vis = opacity > 0.003;
    for (const mesh of this.meshes.roof) mesh.visible = vis;
  }

  get drawCalls() {
    return this.meshes.bg.length + this.meshes.fg.length + this.meshes.roof.length;
  }

  dispose() {
    for (const set of Object.values(this.meshes)) for (const m of set) m.geometry.dispose();
    for (const g of Object.values(this._bases || {})) g.dispose();
    for (const m of this.materials) m.dispose();
    this.atlas?.tex.dispose();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Stocznia z suchym dokiem

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Stan stoczni na klatkę (update):
 *   slips     [{ hullId, classId, progress } | null] — slipStatesFromYard(yard)
 *   launch    [0..1] — światła zejścia pochylni (opcjonalnie; domyślnie przy progress ≥ 1)
 *   drydock   { doors 0..1, roofFade 0..1, work 0..1, service 0/1 }
 *   daylight  0 noc .. 1 dzień (lampy hal)
 */
export class PortShipyard3D extends PortBuilding3D {
  constructor(opts) {
    const style = opts.style && opts.style.palette ? opts.style : resolvePortBuildingStyle(opts.style || 'earth');
    super({ ...opts, style, scene: buildShipyardScene(opts.layout, style), name: opts.name || `Stocznia ${opts.layout.id}` });
    this.rig = this.scene.rig;
    this.hulls = this.layout.slips.map((s) => new PortHullBuild3D({ slip: s, building: this }));
    for (const h of this.hulls) {
      this.root.add(h.mesh);
      this.meshes.bg.push(h.mesh);
    }
    this.slipState = this.layout.slips.map(() => null);
    // wygładzone pozy suwnic pochylni: [pochylnia][suwnica] = { z, tx, hy }
    this._gantryPose = this.layout.slips.map((s) => s.gantry.homeZ.map((z) => ({ z, tx: 0, hy: s.gantry.legTop - 30 })));
    this._dock = { doors: 0, work: 0 };
    this._towerAngle = this.rig.towers.map((_, i) => 0.6 * i);
    this.update(0, {});
  }

  _slipGantries(dt, i) {
    const s = this.layout.slips[i];
    const st = this.slipState[i];
    const G = this.uniforms.uGroup.value;
    const t = this.time;
    const rig = this.rig.slips[i];
    const hull = this.hulls[i];
    const base = YARD_CH.slipBase(i);
    const p = st ? clamp01(st.progress) : 0;
    const building = !!st && p < 0.999;
    const len = hull.hullLength || s.padLength * 0.8;
    const beam = hull.hullBeam || s.padBeam * 0.5;
    const stern = s.z - len / 2;
    const front = building ? hullBuildFront(p) : 0;
    const zFront = stern + front * len;
    const stage = !building ? 'idle' : p < HULL_BUILD_STAGES.keel[1] ? 'keel' : p < HULL_BUILD_STAGES.frames[1] ? 'frames' : p < HULL_BUILD_STAGES.plating[1] ? 'plating' : 'outfit';
    let flags = 0;
    for (let k = 0; k < rig.gantries.length; k++) {
      const g = rig.gantries[k];
      const home = s.gantry.homeZ[k];
      let z = home;
      let tx = 0;
      let hy = g.top - 30;         // zblocze u góry
      if (building) {
        if (k === 0) {
          // A: nad czołem budowy, wózek przesuwa się nad burtami, zblocze pracuje
          z = zFront + 50 * Math.sin(t * 0.61 + i);
          tx = beam * 0.32 * Math.sin(t * 0.43 + i * 1.7);
          const lowering = stage === 'frames' || stage === 'plating';
          const cyc = (t * 0.11 + i * 0.37) % 1;
          hy = lowering ? 150 + 140 * (0.5 + 0.5 * Math.cos(cyc * TAU)) : g.top - 30;
          if (stage === 'plating' && cyc < 0.5) flags |= 1;
        } else {
          // B: kursuje z blokiem między halą prefabrykacji a czołem budowy
          const cyc = ((t / 26) + i * 0.41) % 1;
          const zb = Math.max(home, zFront - 260);
          let u;
          if (cyc < 0.35) u = smooth(cyc / 0.35);
          else if (cyc < 0.5) u = 1;
          else if (cyc < 0.85) u = 1 - smooth((cyc - 0.5) / 0.35);
          else u = 0;
          z = home + (zb - home) * u;
          tx = -beam * 0.2;
          const loaded = cyc < 0.43 || cyc > 0.9;
          hy = (cyc > 0.36 && cyc < 0.49) || cyc > 0.88 ? 190 : g.top - 60;
          if (loaded && (stage === 'frames' || stage === 'plating')) flags |= 2;
        }
      }
      // wygładzenie (bez skoków przy zmianie etapu)
      const prev = this._gantryPose[i][k];
      prev.z = dt > 0 ? approach(prev.z, z, 2.2, dt) : z;
      prev.tx = dt > 0 ? approach(prev.tx, tx, 2.2, dt) : tx;
      prev.hy = dt > 0 ? approach(prev.hy, hy, 2.6, dt) : hy;
      G[g.bridge].makeTranslation(s.x, 0, prev.z);
      G[g.trolley].copy(G[g.bridge]).multiply(_m.makeTranslation(prev.tx, 0, 0));
      G[g.hoist].copy(G[g.trolley]).multiply(_m.makeTranslation(0, k7HeightToZ(prev.hy), 0));
      const z0 = k7HeightToZ(prev.hy + 10);
      const z1 = k7HeightToZ(g.top + 40);
      const cl = Math.max(1, z1 - z0);
      _m2.makeScale(1, cl / K7_ABOVE_SCALE, 1);
      G[g.cables].copy(G[g.trolley]).multiply(_m.makeTranslation(0, (z0 + z1) / 2, 0)).multiply(_m2);
    }
    const work = !building ? 0 : stage === 'keel' ? 0.6 : stage === 'outfit' ? 0.35 : 1;
    this._setChan(base, work);
    this._setChan(base + 1, (zFront - s.z0) / s.padLength);
    const launch = Number.isFinite(this._launch?.[i]) ? this._launch[i] : (st && p >= 0.999 ? 1 : 0);
    this._setChan(base + 2, launch);
    this._setChan(base + 3, flags);
  }

  _towers(dt) {
    const G = this.uniforms.uGroup.value;
    for (let i = 0; i < this.rig.towers.length; i++) {
      const r = this.rig.towers[i];
      const t = this.layout.towers[i];
      const cyc = (this.time / 38 + i * 0.3) % 1;
      // obrót między pochylniami (wysięgnik nad jedną, potem nad drugą)
      const target = Math.PI / 2 + 1.15 * Math.sin(cyc * TAU);
      this._towerAngle[i] = dt > 0 ? approach(this._towerAngle[i], target, 0.9, dt) : target;
      const a = this._towerAngle[i];
      _q.setFromAxisAngle(_yAxis, a);
      _v.set(t.x, k7HeightToZ(t.height), t.z);
      G[r.slew].compose(_v, _q, _one);
      const rad = 180 + (t.jib - 260) * (0.5 + 0.5 * Math.sin(this.time * 0.19 + i));
      G[r.trolley].copy(G[r.slew]).multiply(_m.makeTranslation(rad, 0, 0));
      const drop = (60 + 240 * (0.5 + 0.5 * Math.sin(this.time * 0.27 + i * 2))) * K7_ABOVE_SCALE;
      G[r.hook].copy(G[r.trolley]).multiply(_m.makeTranslation(0, -drop, 0));
    }
  }

  _drydock(dt, d) {
    const rig = this.rig.dock;
    const dock = this.layout.drydock;
    if (!rig || !dock) return;
    const G = this.uniforms.uGroup.value;
    const doors = clamp01(Number(d?.doors) || 0);
    const work = clamp01(Number(d?.work) || 0);
    this._dock.doors = dt > 0 ? approach(this._dock.doors, doors, 3, dt) : doors;
    this._dock.work = dt > 0 ? approach(this._dock.work, work, 2, dt) : work;
    const o = smooth(this._dock.doors);
    for (const leaf of rig.doors) {
      // skrzydła wchodzą do kieszeni po kolei (teleskop): najbliższe osi rusza pierwsze
      const k = leaf.leaf;
      const u = clamp01(o * 1.25 - (2 - k) * 0.12);
      G[leaf.group].makeTranslation((leaf.openX - leaf.closedX) * u, 0, 0);
    }
    const len = dock.z1 - dock.z0;
    const w = this._dock.work;
    for (let k = 0; k < rig.gantries.length; k++) {
      const g = rig.gantries[k];
      const home = dock.gantry.homeZ[k];
      const sweep = dock.z0 + 500 + (len - 1000) * (0.5 + 0.5 * Math.sin(this.time * 0.07 + k * Math.PI));
      const z = home + (sweep - home) * w;
      const x = dock.x + (dock.halfWidth * 0.45) * Math.sin(this.time * 0.23 + k * 2.1) * w;
      G[g.bridge].makeTranslation(0, 0, z);
      G[g.trolley].copy(G[g.bridge]).multiply(_m.makeTranslation(x, 0, 0));
      const hy = dock.gantry.y + 60 - (200 * w) * (0.6 + 0.4 * Math.sin(this.time * 0.5 + k));
      G[g.head].copy(G[g.trolley]).multiply(_m.makeTranslation(0, k7HeightToZ(hy), 0));
    }
    const front = 0.5 + 0.42 * Math.sin(this.time * 0.07);
    this._setChan(YARD_CH.dockWork, w);
    this._setChan(YARD_CH.dockFront, front);
    this._setChan(YARD_CH.dockDoors, this._dock.doors);
    this._setChan(YARD_CH.dockStatus, d?.service ? 1 : (w > 0.05 ? 1 : 0));
    this._applyRoofFade(Number(d?.roofFade) || 0);
  }

  /** Stan klatki (patrz opis klasy). */
  update(dt, state = NO_STATE) {
    this.tick(dt, state);
    if (Array.isArray(state.slips)) {
      for (let i = 0; i < this.layout.slips.length; i++) {
        const st = state.slips[i] || null;
        this.slipState[i] = st;
        this.hulls[i].setState(st, this.time);
      }
    } else {
      for (const h of this.hulls) h.setState(h.state, this.time);
    }
    this._launch = state.launch || null;
    this.uniforms.uGroup.value[0].identity();
    for (let i = 0; i < this.layout.slips.length; i++) this._slipGantries(dt, i);
    this._towers(dt);
    this._drydock(dt, state.drydock || this._lastDock || NO_STATE);
    if (state.drydock) this._lastDock = state.drydock;
  }

  dispose() {
    for (const h of this.hulls) h.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Hangar postojowy

/**
 * Stan hangaru na klatkę (update):
 *   fill     [0..1] zajętość każdego bębna (kolejność layout.drums) albo
 *            occupancy (liczba statków) — rozkładana po bębnach klasami
 *   heavy    0..1 zajętość zatoki ciężkiej
 *   queue    liczba statków w kolejce przed bramą IN
 *   gateIn   0 czerwone / 1 zielone, gateOut 0/1
 *   events   [{ drum, dir: +1 (przyjęcie) | −1 (wydanie) }] — obrót bębna o gniazdo
 *   daylight 0..1
 */
export class PortHangar3D extends PortBuilding3D {
  constructor(opts) {
    const style = opts.style && opts.style.palette ? opts.style : resolvePortBuildingStyle(opts.style || 'earth');
    super({ ...opts, style, scene: buildHangarScene(opts.layout, style), name: opts.name || `Hangar ${opts.layout.id}` });
    this.rig = this.scene.rig;
    this._drumAngle = this.layout.drums.map((d, i) => (i * 0.37) % (TAU / d.slots));
    this._drumTarget = this._drumAngle.slice();
    this._fill = new Float32Array(this.layout.drums.length);
    this.update(0, {});
  }

  /** Obrót bębna o jedno gniazdo (przyjęcie +1, wydanie −1). */
  rotateDrum(i, dir = 1) {
    const d = this.layout.drums[i];
    if (!d) return;
    this._drumTarget[i] += (dir < 0 ? -1 : 1) * TAU / d.slots;
  }

  update(dt, state = NO_STATE) {
    this.tick(dt, state);
    const events = state.events;
    if (events) for (let k = 0; k < events.length; k++) this.rotateDrum(events[k].drum, events[k].dir);
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    const roofY = this.layout.roofBase + 60;
    const fill = Array.isArray(state.fill) || ArrayBuffer.isView(state.fill) ? state.fill : null;
    for (let i = 0; i < this.layout.drums.length; i++) {
      const d = this.layout.drums[i];
      this._drumAngle[i] = dt > 0 ? approach(this._drumAngle[i], this._drumTarget[i], 1.4, dt) : this._drumTarget[i];
      _q.setFromAxisAngle(_yAxis, this._drumAngle[i]);
      _v.set(d.x, k7HeightToZ(roofY), d.z);
      G[this.rig.drums[i]].compose(_v, _q, _one);
      if (fill) this._fill[i] = clamp01(Number(fill[i]) || 0);
      this._setChan(HANGAR_CH.drum(i), this._fill[i]);
    }
    if (state.gateIn !== undefined) this._setChan(HANGAR_CH.gateIn, clamp01(Number(state.gateIn)));
    if (state.queue !== undefined) this._setChan(HANGAR_CH.queue, Math.max(0, Number(state.queue) || 0));
    if (state.gateOut !== undefined) this._setChan(HANGAR_CH.gateOut, clamp01(Number(state.gateOut)));
    if (state.heavy !== undefined) this._setChan(HANGAR_CH.heavy, clamp01(Number(state.heavy)));
  }
}

