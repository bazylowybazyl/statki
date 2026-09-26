// src/3d/fieldLights3D.js
//
// Światła statków w polu asteroid: reflektory DALEKIE z przodu i słabsze
// światło DOOKOŁA kadłuba. Oświetlają skały (gry i tła), pył/mgłę i drobiny,
// a reflektor zostawia w pyle widoczną smugę. W głębi gęstego pola, gdzie
// słońce jest przesłonięte (asteroidFieldLight.js), to one są głównym światłem.
//
// Uniformy są WSPÓLNE (te same obiekty w każdym materiale — attachFieldLightUniforms),
// ustawiane raz na klatkę w commit(). Pozycje świateł względem kamery gry
// liczone na CPU w double (x, −y sceny) + z sceny: shader składa pozycję
// w układzie widoku jako mat3(viewMatrix) · (xy, z − cameraPosition.z), więc
// nic nie drga przy 5–10 mln j.
//
// Źródło świateł statku: znaczniki `road` z edytora świateł (te same, które
// oświetlają kadłub w hexShips3D — buildRoadLightWorldEmitters), z zasięgiem
// i mocą pola z profilu; kadłub bez znaczników dostaje reflektory na dziobie.
// Do tego reflektory OTOCZENIA (`flood`: rufa i burty, krótkie i szerokie)
// i grupy czerwonych lamp pozycyjnych (buildNavLightClusters) — czerwień
// pulsuje po skałach razem z sekwencją lamp.
//
// Koszt (pomiar 2026-09-26, RTX 5080, 2560×1440, licznik GPU): ~0,02–0,04 ms
// na światło, głównie w mgle — dlatego mgła liczy rozpraszanie w WIERZCHOŁKACH
// płatów (beltDust3D), a piksel płaci tylko skała.

import * as THREE from 'three';
import { buildNavLightClusters, buildRoadLightWorldEmitters } from '../game/shipLightRuntime.js';

// 32: Atlas w polu to 2 reflektory + 5 otoczenia + 1 dookoła + 4 grupy lamp,
// do tego świecące skały, eskorta i błyski burzy. Nadmiar odcina commit() po
// priorytecie (jasność / odległość od kamery).
export const FIELD_LIGHT_CAP = 32;

export const fieldLightUniforms = Object.freeze({
  uFieldLightCount: { value: 0 },
  // xy = względem kamery (scena), z = z sceny, w = zasięg [j.]
  uFieldLightPos: { value: Array.from({ length: FIELD_LIGHT_CAP }, () => new THREE.Vector4()) },
  // xyz = kierunek (scena) × ułamek rozpraszania w pyle (długość wektora; shader
  // normalizuje oś), w = cos stożka zewnętrznego (−2 = dookólne)
  uFieldLightDir: { value: Array.from({ length: FIELD_LIGHT_CAP }, () => new THREE.Vector4(0, 0, -1, -2)) },
  // rgb = barwa × moc, w = cos stożka wewnętrznego (reflektor) albo ułamek
  // rozpraszania w pyle (światło dookólne)
  uFieldLightCol: { value: Array.from({ length: FIELD_LIGHT_CAP }, () => new THREE.Vector4()) },
  // Punkty uderzeń piorunów burzy (beltStorm3D): xy względem kamery (scena),
  // z = z sceny, w = siła rozbłysku (0 = pusty). Skała energetyczna przy
  // uderzeniu rozbłyskuje pęknięciami (fieldStrikeSurge).
  uFieldStrike: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }
});

export const FIELD_STRIKE_CAP = 4;

export function attachFieldLightUniforms(uniforms) {
  uniforms.uFieldLightCount = fieldLightUniforms.uFieldLightCount;
  uniforms.uFieldLightPos = fieldLightUniforms.uFieldLightPos;
  uniforms.uFieldLightDir = fieldLightUniforms.uFieldLightDir;
  uniforms.uFieldLightCol = fieldLightUniforms.uFieldLightCol;
  uniforms.uFieldStrike = fieldLightUniforms.uFieldStrike;
  return uniforms;
}

// Działa w shaderach wierzchołków i fragmentów (viewMatrix, cameraPosition
// deklaruje three). P = punkt w układzie widoku.
export const FIELD_LIGHTS_GLSL = /* glsl */`
#define FIELD_LIGHT_CAP ${FIELD_LIGHT_CAP}
uniform int uFieldLightCount;
uniform vec4 uFieldLightPos[FIELD_LIGHT_CAP];
uniform vec4 uFieldLightDir[FIELD_LIGHT_CAP];
uniform vec4 uFieldLightCol[FIELD_LIGHT_CAP];

// Natężenie światła i w punkcie P (widok) i kierunek do światła L.
float fieldLightAt(int i, vec3 P, out vec3 L) {
  vec4 lp = uFieldLightPos[i];
  vec3 lv = mat3(viewMatrix) * vec3(lp.xy, lp.z - cameraPosition.z);
  vec3 d = lv - P;
  float dist = length(d);
  L = d / max(dist, 1e-3);
  float x = dist / max(lp.w, 1.0);
  if (x >= 1.0) return 0.0;
  // Okno do zera na zasięgu × miękkie 1/(1 + k x²) — zasięg daleki, bez ostrej granicy.
  float win = 1.0 - x * x;
  float att = win * win / (1.0 + 4.0 * x * x);
  vec4 ld = uFieldLightDir[i];
  if (ld.w > -1.5) {
    vec3 axis = normalize(mat3(viewMatrix) * ld.xyz);
    att *= smoothstep(ld.w, uFieldLightCol[i].w, dot(-L, axis));
  }
  return att;
}

// Rozproszenie Lamberta (z lekkim zawinięciem) i połysk od wszystkich świateł.
vec3 fieldLightsShade(vec3 P, vec3 N, vec3 V, float gloss, float specK, out vec3 spec) {
  vec3 diff = vec3(0.0);
  spec = vec3(0.0);
  for (int i = 0; i < FIELD_LIGHT_CAP; i++) {
    if (i >= uFieldLightCount) break;
    vec3 L;
    float a = fieldLightAt(i, P, L);
    if (a <= 0.0) continue;
    vec3 c = uFieldLightCol[i].rgb * a;
    float ndl = dot(N, L);
    diff += c * clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
    vec3 H = normalize(L + V);
    spec += c * pow(max(dot(N, H), 0.0), gloss) * specK * step(0.0, ndl);
  }
  return diff;
}

// Rozpraszanie w ośrodku (pył, drobiny): bez normalnej. Każde światło ma swój
// ułamek: dookólne w Col.w, reflektor w długości Dir.xyz (daleki 1 = smuga,
// otoczenia mało) — światło dookoła kadłuba sięga kilku tysięcy j. i przy
// pełnym rozpraszaniu szarzyło cały kadr.
vec3 fieldLightsScatter(vec3 P) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < FIELD_LIGHT_CAP; i++) {
    if (i >= uFieldLightCount) break;
    vec3 L;
    float a = fieldLightAt(i, P, L);
    vec4 ld = uFieldLightDir[i];
    if (a > 0.0) s += uFieldLightCol[i].rgb * a * (ld.w < -1.5 ? uFieldLightCol[i].w : length(ld.xyz));
  }
  return s;
}

// Rozbłysk ładunku przy uderzeniu pioruna w pobliżu P (widok): suma siły
// uderzeń × gauss odległości (radius [j.]). Czyta go skała energetyczna.
uniform vec4 uFieldStrike[4];
float fieldStrikeSurge(vec3 P, float radius) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 st = uFieldStrike[i];
    if (st.w <= 0.0) continue;
    vec3 d = mat3(viewMatrix) * vec3(st.xy, st.z - cameraPosition.z) - P;
    s += st.w * exp(-dot(d, d) / (radius * radius));
  }
  return s;
}
`;

// Profil świateł pola dla kadłuba (mnożniki długości kadłuba, granice w j.).
export const FIELD_SHIP_LIGHTS = Object.freeze({
  spot: Object.freeze({
    rangeMul: 6.5, minRange: 2600, maxRange: 14000,
    coneDeg: 30, innerFrac: 0.45,
    intensity: 2.4, color: [1.0, 0.94, 0.84],
    z: 140, tiltDeg: 5,
    beam: 1.0
  }),
  // Światło dookoła = reflektory kadłuba rozlane na skały OBOK statku (zasięg
  // ~1,15 długości kadłuba od środka). Przy 2,3 długości Atlas oświetlał cały
  // kadr na zoomie 0,5 i lodowe skały Kuipera wyglądały jak w świetle księżyca.
  omni: Object.freeze({
    rangeMul: 1.15, minRange: 700, maxRange: 2800,
    intensity: 0.5, color: [0.74, 0.84, 1.0],
    z: 320,
    // Oświetla skały wokół, ale w pyle prawie nie świeci (inaczej szara mgła na cały kadr).
    scatter: 0.12
  }),
  // Reflektory otoczenia (lampy `flood`: rufa, burty): krótkie, szerokie,
  // pochylone w dół na skały pod płaszczyzną, w pyle tylko lekka poświata.
  flood: Object.freeze({
    rangeMul: 0.55, minRange: 450, maxRange: 2400,
    coneDeg: 110, innerFrac: 0.35,
    intensity: 1.0, color: [0.92, 0.95, 1.0],
    z: 60, tiltDeg: 16,
    // Lampę na pancerzu rysuje shader kadłuba — rozbłysk pola tylko lekki.
    beam: 0.3, flare: 0.2, scatter: 0.25
  }),
  // Grupy czerwonych lamp pozycyjnych: moc = suma mocy lamp grupy × bieżąca
  // sekwencja × intensity; zasięg = rozrzut grupy + NAV_CLUSTER.reachWorld.
  nav: Object.freeze({
    intensity: 0.075, z: 40, rangeMul: 1.0, minRange: 320,
    scatter: 0.35
  })
});

// ---------------------------------------------------------------------------
// Smugi reflektorów w pyle (pass ortho, addytywnie)

// 24: reflektory otoczenia dokładają do 5 smug na okręt.
const BEAM_CAP = 24;

const BEAM_VERTEX = /* glsl */`
attribute vec4 iOrigin;   // xy względem początku (scena), z = z sceny, w = zasięg
attribute vec4 iAxis;     // xy = oś (scena), z = tan połowy stożka, w = natężenie
attribute vec4 iTint;     // rgb = barwa, a = pył (0..1) × widoczność w cieniu
attribute float iFlare;   // rozbłysk lampy (1 = reflektor dziobu, mniej = otoczenia)
varying vec2 vUV;
varying vec2 vScene;
varying vec3 vTint;
varying float vK;
varying float vRange;
varying float vTan;
varying float vFlare;
void main() {
  // Kwadrat od ZA źródłem (stałe ~480 j. — poświata rozbłysku gaśnie przed
  // brzegiem, inaczej krawędź kwadratu przecina kadr) po koniec zasięgu.
  float range = iOrigin.w;
  float uBack = -max(0.02, 480.0 / max(range, 1.0));
  float u = mix(uBack, 1.0, position.x + 0.5);
  float v = position.y * 2.0;
  vec2 axis = iAxis.xy;
  vec2 perp = vec2(-axis.y, axis.x);
  vec2 p = iOrigin.xy + axis * (u * range) + perp * (v * range * iAxis.z * 1.1);
  vUV = vec2(u, v * 1.1);
  vScene = p;
  vTint = iTint.rgb * iAxis.w;
  vK = iTint.a;
  vRange = range;
  vTan = iAxis.z;
  vFlare = iFlare;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, iOrigin.z, 1.0);
}
`;

const BEAM_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uNoise;
uniform vec2 uNoiseBase;
uniform float uNoiseScale;
uniform float uTime;
varying vec2 vUV;
varying vec2 vScene;
varying vec3 vTint;
varying float vK;
varying float vRange;
varying float vTan;
varying float vFlare;
void main() {
  float u = vUV.x;
  float across = abs(vUV.y) / max(u, 0.02);
  // Stożek: szeroki miękki brzeg, jaśniejszy rdzeń blisko osi.
  float cone = (1.0 - smoothstep(0.35, 1.0, across)) * step(0.0, u);
  float core = exp(-across * across * 3.0);
  // Zanik z odległością (światło rozchodzi się w stożku) i łagodne wejście
  // tuż przy lampie — inaczej początek smugi był jednolitą białą plamą.
  float along = u < 0.0 ? 0.0 : (1.0 - u * u) * (1.0 - u * u) / (1.0 + 9.0 * u) * smoothstep(0.0, 0.03, u);
  // Pył w smudze: ten sam szum co mgła (świat), kontrastowe kłęby i włókna,
  // płyną powoli — smuga ma fakturę pyłu, nie płaską biel.
  vec2 q = uNoiseBase + vScene / uNoiseScale;
  float n = texture(uNoise, q + vec2(uTime * 0.004, 0.0)).r * 0.6 + texture(uNoise, q * 3.1 + 0.37).g * 0.4;
  float dust = mix(0.12, 1.7, smoothstep(0.28, 0.8, n));
  float beam = along * cone * (0.45 + 0.55 * core) * dust * vK;
  // Rozbłysk lampy: mały, jasny rdzeń (jedyne miejsce nad progiem bloomu)
  // i krótka poświata, która gaśnie ~3σ = 420 j. — przed tyłem kwadratu.
  float r = length(vec2(u, vUV.y * vTan)) * vRange;
  float flare = (exp(-r * r / (32.0 * 32.0)) * 1.1 + exp(-r * r / (140.0 * 140.0)) * 0.06) * vFlare;
  vec3 col = vTint * (beam * 0.16 + flare);
  float a = max(col.r, max(col.g, col.b));
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;

class LightBeams3D {
  constructor(scene) {
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    this.axis = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    this.flare = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP), 1);
    for (const a of [this.origin, this.axis, this.tint, this.flare]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOrigin', this.origin);
    geo.setAttribute('iAxis', this.axis);
    geo.setAttribute('iTint', this.tint);
    geo.setAttribute('iFlare', this.flare);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = {
      uNoise: { value: null },
      uNoiseBase: { value: new THREE.Vector2() },
      uNoiseScale: { value: 9000 },
      uTime: { value: 0 }
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Nad skałami gry (czubki na z ≤ 0 zasłaniają smugę), pod kadłubami.
    this.mesh.renderOrder = 8;
    this.mesh.layers.set(0);
    this.mesh.name = 'fieldLightBeams';
    this.geo = geo;
    scene.add(this.mesh);
  }
}

// ---------------------------------------------------------------------------

const _emitters = [];
const _clusters = [];
const _emitterOptions = { out: _emitters, maxEmitters: 12 };
const _navOptions = { out: _clusters, time: 0, getGrid: (e) => e?.hexGrid || e?.beamHull };
// Argumenty addSpot/addOmni z addShip (kopiowane do rekordu od razu — wielokrotne użycie).
const _spotArgs = { x: 0, y: 0, z: 0, dirX: 1, dirY: 0, color: null, intensity: 0, range: 0, coneDeg: 30, innerFrac: 0.45, tiltDeg: 0, beam: 1, flare: 1, scatter: 1 };
const _omniArgs = { x: 0, y: 0, z: 0, color: null, intensity: 0, range: 0, scatter: 0.5 };
const _navColor = [1, 0.17, 0.17];

const byScoreDesc = (a, b) => b.score - a.score;

function makeLightRecord() {
  return {
    kind: '', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, r: 0, g: 0, b: 0, range: 0,
    cosOuter: -2, cosInner: 0, tanHalf: 0, beam: 0, flare: 1, dirX: 1, dirY: 0, scatter: 1, score: 0
  };
}

export class FieldLights {
  constructor({ scene }) {
    this.scene = scene;
    // Rekordy świateł z puli (bez alokacji co klatkę): lights = bieżąca klatka.
    this.lights = [];
    this._pool = [];
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.enabled = true;
    this.strength = 1;
    this.beamStrength = 1;
    // Reflektory otoczenia (rufa, burty) i rozlew czerwonych lamp pozycyjnych.
    this.floodsEnabled = true;
    this.navEnabled = true;
    this.beams = new LightBeams3D(scene);
    this.stats = { lights: 0, beams: 0, requested: 0 };
  }

  /** @param {{x:number,y:number}} cam @param {number} [time] [s] — faza sekwencji lamp pozycyjnych */
  begin(cam, time) {
    this.lights.length = 0;
    this.cam.x = cam.x;
    this.cam.y = cam.y;
    this.time = Number.isFinite(time) ? time : (typeof performance !== 'undefined' ? performance.now() * 0.001 : 0);
  }

  _next() {
    const i = this.lights.length;
    let l = this._pool[i];
    if (!l) { l = makeLightRecord(); this._pool[i] = l; }
    this.lights.push(l);
    return l;
  }

  addSpot(o) {
    const half = Math.max(1, Math.min(170, o.coneDeg ?? 30)) * Math.PI / 360;
    const tilt = (o.tiltDeg ?? 0) * Math.PI / 180;
    const len = Math.hypot(o.dirX, o.dirY) || 1;
    const l = this._next();
    l.kind = 'spot';
    l.x = o.x; l.y = o.y; l.z = o.z ?? 140;
    // Kierunek w scenie: y odwrócone, lekkie pochylenie w dół (skały leżą pod płaszczyzną).
    l.dx = (o.dirX / len) * Math.cos(tilt); l.dy = -(o.dirY / len) * Math.cos(tilt); l.dz = -Math.sin(tilt);
    l.r = o.color[0] * o.intensity; l.g = o.color[1] * o.intensity; l.b = o.color[2] * o.intensity;
    l.range = o.range;
    l.cosOuter = Math.cos(half);
    l.cosInner = Math.cos(half * (o.innerFrac ?? 0.45));
    l.tanHalf = Math.tan(half);
    l.beam = o.beam ?? 1;
    l.flare = o.flare ?? 1;
    l.dirX = o.dirX / len; l.dirY = o.dirY / len;
    // Ułamek rozpraszania w pyle (długość Dir.xyz w shaderze; > 0 — shader normalizuje oś).
    l.scatter = Math.max(0.01, Math.min(1, o.scatter ?? 1));
  }

  addOmni(o) {
    const l = this._next();
    l.kind = 'omni';
    l.x = o.x; l.y = o.y; l.z = o.z ?? 300;
    l.dx = 0; l.dy = 0; l.dz = -1;
    l.r = o.color[0] * o.intensity; l.g = o.color[1] * o.intensity; l.b = o.color[2] * o.intensity;
    l.range = o.range;
    l.cosOuter = -2;
    // Dla dookólnych w = ułamek rozpraszania w pyle (fieldLightsScatter).
    l.cosInner = Math.max(0, Math.min(1, o.scatter ?? 0.5));
    l.tanHalf = 0;
    l.beam = 0;
    l.scatter = 1;
  }

  /**
   * Światła pola statku: reflektory z jego znaczników `road` (edytor świateł)
   * albo z dziobu, reflektory otoczenia (`flood`: rufa i burty — z edytora
   * albo generowane z obrysu lamp), światło dookoła i grupy czerwonych lamp
   * pozycyjnych. hullLength [j.] = długość kadłuba. Profil bez `flood`/`nav`
   * (np. jaskiniowy w demie) bierze je z FIELD_SHIP_LIGHTS.
   */
  addShip(entity, hullLength, profile = FIELD_SHIP_LIGHTS) {
    if (!entity) return;
    const L = Math.max(100, hullLength || 600);
    const sp = profile.spot || FIELD_SHIP_LIGHTS.spot;
    const om = profile.omni || FIELD_SHIP_LIGHTS.omni;
    const fl = profile.flood || FIELD_SHIP_LIGHTS.flood;
    const nv = profile.nav || FIELD_SHIP_LIGHTS.nav;
    const range = Math.min(sp.maxRange, Math.max(sp.minRange, L * sp.rangeMul));
    const angle = Number(entity.angle) || 0;
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    const ex = Number(entity.pos?.x ?? entity.x) || 0;
    const ey = Number(entity.pos?.y ?? entity.y) || 0;
    _emitters.length = 0;
    buildRoadLightWorldEmitters([entity], _emitterOptions);
    let far = 0;
    for (const em of _emitters) if (!em.flood) far++;
    const a = _spotArgs;
    if (far) {
      for (const em of _emitters) {
        if (em.flood) continue;
        a.x = em.x; a.y = em.y; a.z = sp.z; a.dirX = em.dir.x; a.dirY = em.dir.y;
        a.color = sp.color; a.intensity = sp.intensity / Math.sqrt(far);
        a.range = range; a.coneDeg = sp.coneDeg; a.innerFrac = sp.innerFrac; a.tiltDeg = sp.tiltDeg;
        a.beam = sp.beam; a.flare = sp.flare ?? 1; a.scatter = sp.scatter ?? 1;
        this.addSpot(a);
      }
    } else {
      // Bez znaczników: para reflektorów na dziobie.
      const side = L * 0.035;
      for (let s = -1; s <= 1; s += 2) {
        a.x = ex + fx * L * 0.47 - fy * side * s; a.y = ey + fy * L * 0.47 + fx * side * s; a.z = sp.z;
        a.dirX = fx; a.dirY = fy; a.color = sp.color; a.intensity = sp.intensity / Math.SQRT2;
        a.range = range; a.coneDeg = sp.coneDeg; a.innerFrac = sp.innerFrac; a.tiltDeg = sp.tiltDeg;
        a.beam = sp.beam; a.flare = sp.flare ?? 1; a.scatter = sp.scatter ?? 1;
        this.addSpot(a);
      }
    }
    // Reflektory otoczenia: krótkie, szerokie, w dół na skały; moc z lampy (1,5 = domyślna).
    if (this.floodsEnabled) {
      const floodRange = Math.min(fl.maxRange, Math.max(fl.minRange, L * fl.rangeMul));
      for (const em of _emitters) {
        if (!em.flood) continue;
        a.x = em.x; a.y = em.y; a.z = fl.z; a.dirX = em.dir.x; a.dirY = em.dir.y;
        a.color = fl.color; a.intensity = fl.intensity * (Number(em.power) || 1.5) / 1.5;
        a.range = floodRange; a.coneDeg = fl.coneDeg; a.innerFrac = fl.innerFrac; a.tiltDeg = fl.tiltDeg;
        a.beam = fl.beam; a.flare = fl.flare ?? 0.2; a.scatter = fl.scatter;
        this.addSpot(a);
      }
    }
    const o = _omniArgs;
    o.x = ex; o.y = ey; o.z = om.z; o.color = om.color; o.intensity = om.intensity;
    o.range = Math.min(om.maxRange, Math.max(om.minRange, L * om.rangeMul));
    o.scatter = om.scatter;
    this.addOmni(o);
    // Czerwone lampy pozycyjne: grupy (burta × połowa kadłuba) pulsujące
    // sekwencją „pasa startowego” — błysk biegnie też po skałach obok.
    if (this.navEnabled) {
      _navOptions.time = this.time;
      buildNavLightClusters([entity], _navOptions);
      for (const c of _clusters) {
        _navColor[0] = c.color.r; _navColor[1] = c.color.g; _navColor[2] = c.color.b;
        o.x = c.x; o.y = c.y; o.z = nv.z; o.color = _navColor;
        o.intensity = nv.intensity * c.power * c.pulse;
        o.range = Math.max(nv.minRange, c.rangeWorld * nv.rangeMul);
        o.scatter = nv.scatter;
        this.addOmni(o);
      }
    }
  }

  /**
   * Wpisanie świateł do uniformów (najważniejsze pierwsze) i smug.
   * @param {object} f
   * @param {(x:number, y:number) => {dust:number, shade:number}} f.beamMedium
   *   pył (0..1) i „cień” (1 − T) w punkcie — smuga jest widoczna w pyle i w mroku
   * @param {object} [f.noise] { texture, scale, baseX, baseY } szum pyłu mgły
   * @param {number} f.time
   */
  commit(f = {}) {
    const lights = this.lights;
    const cx = this.cam.x;
    const cy = this.cam.y;
    // Priorytet: bliżej kamery i jaśniej.
    for (const l of lights) {
      const d = Math.hypot(l.x - cx, l.y - cy);
      l.score = (l.r + l.g + l.b) / (1 + (d / Math.max(1, l.range)) ** 2);
    }
    lights.sort(byScoreDesc);
    const n = this.enabled ? Math.min(FIELD_LIGHT_CAP, lights.length) : 0;
    const U = fieldLightUniforms;
    U.uFieldLightCount.value = n;
    const k = this.strength;
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      // Reflektor: ułamek rozpraszania w pyle w długości osi (fieldLightsScatter).
      const sk = l.kind === 'spot' ? l.scatter : 1;
      U.uFieldLightPos.value[i].set(l.x - cx, -(l.y - cy), l.z, l.range);
      U.uFieldLightDir.value[i].set(l.dx * sk, l.dy * sk, l.dz * sk, l.cosOuter);
      U.uFieldLightCol.value[i].set(l.r * k, l.g * k, l.b * k, l.cosInner);
    }
    this.stats.lights = n;
    this.stats.requested = lights.length;

    // Smugi reflektorów.
    const B = this.beams;
    let nb = 0;
    if (this.enabled && this.beamStrength > 0) {
      const o = B.origin.array;
      const a = B.axis.array;
      const t = B.tint.array;
      for (let i = 0; i < n && nb < BEAM_CAP; i++) {
        const l = lights[i];
        if (l.kind !== 'spot' || !(l.beam > 0)) continue;
        const med = f.beamMedium ? f.beamMedium(l.x, l.y) : { dust: 0.5, shade: 0.5 };
        const vis = med.dust * (0.3 + 0.7 * med.shade) * l.beam * this.beamStrength;
        if (vis < 0.01) continue;
        const b = nb * 4;
        o[b] = l.x - cx; o[b + 1] = -(l.y - cy); o[b + 2] = -2; o[b + 3] = l.range;
        a[b] = l.dirX; a[b + 1] = -l.dirY; a[b + 2] = l.tanHalf; a[b + 3] = k;
        const lum = Math.max(l.r, l.g, l.b) || 1;
        t[b] = l.r / lum * Math.min(3, lum); t[b + 1] = l.g / lum * Math.min(3, lum); t[b + 2] = l.b / lum * Math.min(3, lum);
        t[b + 3] = vis;
        B.flare.array[nb] = l.flare;
        nb++;
      }
      if (nb) {
        B.origin.needsUpdate = true;
        B.axis.needsUpdate = true;
        B.tint.needsUpdate = true;
        B.flare.needsUpdate = true;
      }
    }
    B.geo.instanceCount = nb;
    B.mesh.visible = nb > 0;
    B.mesh.position.set(cx, -cy, 0);
    B.mesh.updateMatrixWorld(true);
    if (f.noise) {
      B.uniforms.uNoise.value = f.noise.texture;
      B.uniforms.uNoiseScale.value = f.noise.scale;
      // Początek szumu = kamera w kaflach, double na CPU. Mod 20, nie mod 1:
      // shader próbkuje też q × 3,1 — przy zawinięciu mod 1 pył w smudze
      // przeskakiwał co `scale` j. lotu (jak DUST_NOISE_WRAP w beltDust3D.js).
      const bx = cx / f.noise.scale;
      const by = -cy / f.noise.scale;
      B.uniforms.uNoiseBase.value.set(bx - Math.floor(bx / 20) * 20, by - Math.floor(by / 20) * 20);
    }
    B.uniforms.uTime.value = f.time || 0;
    this.stats.beams = nb;
  }

  dispose() {
    this.scene.remove(this.beams.mesh);
    this.beams.geo.dispose();
    this.beams.material.dispose();
  }
}
