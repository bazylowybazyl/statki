// src/3d/warpPlume3D.js
//
// Silnik WARP — port PlasmaEngineFX z `dema/silniki/plasma_engine_demo.html`.
// Plume to raymarch objętościowy w proxy (Box, BackSide): granice marszu
// (walec ∩ warstwa Z) liczą się analitycznie z AKTUALNYCH rozmiarów strumienia,
// więc wygląda poprawnie z każdego kąta, także w ortho z góry.
//
// Warp leci z tych samych dysz co MAIN: EngineVfxSystem bierze instancję
// z puli na czas ładowania i skoku, a po wyjściu gasi ją (poświata) i oddaje.
// Instancja kosztuje ~5 draw calli i raymarch na pikselach plume, dlatego pula
// ma limit — nadmiarowe dysze (duża flota wlatująca skokiem) dostają zwykłą
// strugę MAIN z dopalaczem.
//
// Różnice względem dema:
//   - bez PointLightów (enginePointLights: false) i bez passa zakłóceń
//     cieplnych (warstwa 3 w grze to planety; gorące powietrze daje
//     Core3D.pushHeatHazeWorld);
//   - bez siatek dyszy (gardziel, wnętrze) — dyszę rysuje sprite kadłuba;
//   - alfa = max(rgb) przy premultipliedAlpha: alfa 1 na całym proxy wycinała
//     w poświacie bloomu ciemny prostokąt (kanwa Core3D jest premultiplied);
//   - pozycja w mesh.position (świat 5–10 mln j. — three składa modelView
//     w double), cały raymarch w przestrzeni lokalnej instancji;
//   - fazy przepływu całkowane na CPU (patrz sampleMedium).

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { WARP_PLASMA_PALETTES, WARP_PLUME_BASE_LEN, WARP_PLUME_BOOST_LEN } from '../data/engineFx.js';

/* ============================================================================
   0. WSPÓLNY GLSL — simplex noise 3D (Ashima / Gustavson), prefiks pe_
   ========================================================================== */
const NOISE = /* glsl */`
vec3 pe_mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec4 pe_mod289(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec4 pe_permute(vec4 x){ return pe_mod289(((x*34.0)+1.0)*x); }
vec4 pe_tis(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float pe_snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = pe_mod289(i);
  vec4 p = pe_permute( pe_permute( pe_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = pe_tis(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float pe_hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/* ============================================================================
   1. PLUME — raymarch w układzie lokalnym: oś dyszy = +Z, promień dyszy = 1
   ========================================================================== */
const PLUME_VS = /* glsl */`
varying vec3 vLocal;
void main(){
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PLUME_FS = NOISE + /* glsl */`
precision highp float;

varying vec3 vLocal;

uniform float uTime;       // tylko ziarno jittera marszu (zawijany na CPU)
uniform float uLen;        // długość ciała plume (promień dyszy = 1)
uniform float uWidth;      // mnożnik promienia
uniform float uCore;       // intensywność białego rdzenia
uniform float uBright;     // globalna jasność
uniform float uTurb;       // amplituda turbulencji
uniform float uStretch;    // rozciągnięcie smug wzdłuż osi (wygładzane na CPU)
uniform vec3  uFlowPh;     // fazy oktaw w przestrzeni szumu (całkowane na CPU)
uniform float uMachPh;     // faza diamentów Macha (całkowana na CPU)
uniform float uSheath;     // siła otoczki
uniform float uDensity;    // gęstość / gain całki
uniform float uBodyGain;   // ciało + otoczka względem rdzenia (pod próg bloomu gry)
uniform float uAfterglow;  // 0..1 — poświata po wyłączeniu (bez rdzenia)
uniform float uPower;      // 0..1 moc silnika (kształt + barwa)
uniform float uIgnite;     // impuls zapłonu (0..1+)
uniform float uExtinct;    // samoprzesłanianie ośrodka

uniform vec3  uCamPosL;    // pozycja kamery w przestrzeni lokalnej
uniform vec3  uCamDirL;    // kierunek patrzenia kamery (ortho) w przestrzeni lokalnej
uniform float uOrtho;
uniform float uBoundR;     // ciasne granice marszu — promień
uniform float uBoundZ0;
uniform float uBoundZ1;
uniform float uJitter;

#ifndef PE_STEPS
  #define PE_STEPS 44
#endif
#ifndef PE_OCT
  #define PE_OCT 3
#endif

uniform vec3 uCoreWarm;
uniform vec3 uCoreCold;
uniform vec3 uBody0;
uniform vec3 uBody1;
uniform vec3 uBody2;
uniform vec3 uBody3;
uniform vec3 uOuter0;
uniform vec3 uOuter1;

vec4 sampleMedium(vec3 p){
  float L  = max(uLen, 0.001);
  float s  = p.z / L;                       // 0 = wylot dyszy, 1 = koniec ciała
  if (s > 1.32) return vec4(0.0);

  float sc   = clamp(s, 0.0, 1.32);
  float r    = length(p.xy);
  float inNoz = (s < 0.0) ? exp(p.z * 5.0) : 1.0;

  float flare = 1.0 + 0.24 * (sc / (sc + 0.055)) * exp(-sc * 6.5);
  float taper = 1.0 - 0.56 * smoothstep(0.08, 1.20, sc);
  float Renv  = uWidth * flare * taper;

  // Fazy przepływu CAŁKOWANE na CPU (faza += prędkość·dt). Iloczyn czas·prędkość
  // skakał przy każdej zmianie prędkości i po minucie cofał strumień.
  float expand = 1.0 / (0.55 + 0.95 * sc);
  float fstr = uStretch;
  vec3 q1 = vec3(p.xy * expand * 1.45, p.z * (0.26 * fstr) - uFlowPh.x);
  float n1 = pe_snoise(q1);
  float n2 = 0.0;
  float n3 = 0.0;
  #if PE_OCT > 1
    vec3 q2 = vec3(p.xy * expand * 3.40, p.z * (0.62 * fstr) - uFlowPh.y);
    n2 = pe_snoise(q2);
  #else
    n2 = n1 * 0.6;
  #endif
  #if PE_OCT > 2
    vec3 q3 = vec3(p.xy * expand * 7.60 + 17.3, p.z * (1.45 * fstr) - uFlowPh.z);
    n3 = pe_snoise(q3);
  #else
    n3 = n2 * 0.6;
  #endif

  float tLow  = n1;
  float tMid  = n1 * 0.55 + n2 * 0.45;
  float tHigh = n1 * 0.26 + n2 * 0.34 + n3 * 0.40;

  float tAmp = uTurb * smoothstep(-0.02, 0.22, sc) * (1.0 + 0.45 * (1.0 - uPower));

  float rq  = r / max(Renv, 1e-4);
  float rqB = rq * (1.0 - 0.42 * tAmp * tMid);
  float rqS = rq * (1.0 - 0.50 * tAmp * tLow);

  float tipN   = 0.17 * tAmp * tLow;
  float eB = max(1.02 + tipN, 0.34);
  float eS = max(1.30 + tipN * 1.4, 0.42);
  float axBody = 1.0 - smoothstep(0.46, eB, sc);
  float axShe  = 1.0 - smoothstep(0.34, eS, sc);
  float axCore = pow(1.0 - smoothstep(0.008, 0.26, sc), 1.20);

  float body = pow(max(0.0, 1.0 - rqB * rqB), 1.70) * axBody;
  float mott = 0.72 + 0.56 * (tMid * 0.5 + 0.5);
  body *= mix(0.98, mott, smoothstep(0.02, 0.30, sc));

  float coreVis = smoothstep(0.14, 0.52, uPower);
  float Rc = uWidth * (0.18 + 0.27 * sc) * (0.70 + 0.42 * uPower);
  float cr = r / max(Rc, 1e-4);
  float core = exp(-cr * cr * 2.9) * axCore;
  core *= 0.86 + 0.28 * (tHigh * 0.5 + 0.5);
  core *= 1.0 + 0.19 * sin(sc * 33.0 - uMachPh) * exp(-sc * 7.5);
  core *= coreVis;

  float ign = exp(-max(sc, 0.0) * 26.0) * (1.0 - smoothstep(0.35, 1.05, rq));
  ign *= 0.85 + 0.30 * (tHigh * 0.5 + 0.5);

  float d = (rqS - 0.88) / 0.26;
  float shell = exp(-d * d);
  float skirt = exp(-pow(max(0.0, rqS - 0.34) / 0.66, 2.0)) * 0.46;
  float sheath = (shell + skirt) * axShe;
  sheath *= 0.68 + 0.64 * (tLow * 0.5 + 0.5);
  sheath *= 0.45 + 0.75 * smoothstep(0.0, 0.35, sc);

  float rm = clamp(rqB, 0.0, 1.2);
  vec3 bodyCol = mix(uBody0,  uBody1, smoothstep(0.00, 0.20, rm));
  bodyCol      = mix(bodyCol, uBody2, smoothstep(0.12, 0.46, rm));
  bodyCol      = mix(bodyCol, uBody3, smoothstep(0.38, 0.82, rm));
  bodyCol      = mix(bodyCol, uOuter0, smoothstep(0.58, 1.34, sc * 0.74 + rm * 0.46));
  bodyCol = mix(bodyCol, mix(uOuter0, uOuter1, 0.45), uAfterglow * 0.85 + (1.0 - uPower) * 0.18);

  vec3 coreCol   = mix(uCoreWarm, uCoreCold, smoothstep(0.02, 0.26, sc));
  vec3 sheathCol = mix(uOuter0, uOuter1, smoothstep(0.06, 0.70, sc));

  float noCore = 1.0 - uAfterglow;
  float hollow = 1.0 - 0.50 * exp(-cr * cr * 1.7) * coreVis;
  vec3 e = vec3(0.0);
  e += coreCol             * core   * (34.0 * uCore) * noCore;
  e += vec3(1.0,0.90,0.80) * ign    * ((3.4 + 16.0 * uIgnite) * uCore) * noCore;
  e += bodyCol             * body   * hollow * 1.35 * uBodyGain;
  e += sheathCol           * sheath * (0.46 * uSheath) * uBodyGain;
  e *= uBright * uDensity * inNoz;

  float dens = (body * 0.55 + core * 1.10 + sheath * 0.22 + ign * 0.5) * inNoz;
  return vec4(e, dens);
}

void main(){
  vec3 ro, rd;
  if (uOrtho > 0.5){
    rd = normalize(uCamDirL);
    ro = vLocal - rd * (uBoundZ1 * 4.0 + 40.0);
  } else {
    ro = uCamPosL;
    rd = normalize(vLocal - ro);
  }

  float t0 = 0.0;
  float t1 = 1.0e9;

  float a = dot(rd.xy, rd.xy);
  float b = 2.0 * dot(ro.xy, rd.xy);
  float c = dot(ro.xy, ro.xy) - uBoundR * uBoundR;
  if (a < 1.0e-7){
    if (c > 0.0) discard;
  } else {
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    t0 = max(t0, (-b - sq) / (2.0 * a));
    t1 = min(t1, (-b + sq) / (2.0 * a));
  }
  if (abs(rd.z) < 1.0e-7){
    if (ro.z < uBoundZ0 || ro.z > uBoundZ1) discard;
  } else {
    float ta = (uBoundZ0 - ro.z) / rd.z;
    float tb = (uBoundZ1 - ro.z) / rd.z;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  }
  t0 = max(t0, 0.0);
  if (t1 <= t0) discard;

  float stepLen = (t1 - t0) / float(PE_STEPS);
  float jit = pe_hash12(gl_FragCoord.xy + fract(uTime) * 91.7) * uJitter;
  float t = t0 + stepLen * jit;

  vec3  acc  = vec3(0.0);
  float tr   = 1.0;

  for (int i = 0; i < PE_STEPS; i++){
    vec3 p = ro + rd * t;
    vec4 m = sampleMedium(p);
    acc += m.rgb * stepLen * tr;
    tr  *= exp(-m.a * stepLen * uExtinct);
    if (tr < 0.012) break;
    t += stepLen;
  }

  vec3 col = max(acc, 0.0);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}`;

/* ============================================================================
   2. BILLBOARDY POŚWIATY (view-space — działa w ortho i perspektywie)
   ========================================================================== */
const GLOW_VS = /* glsl */`
uniform float uSize;
uniform float uStretch;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += vec2(position.x * uSize * uStretch, position.y * uSize);
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FS = NOISE + /* glsl */`
precision highp float;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uFalloff;
uniform float uCoreBoost;
uniform float uTime;
uniform float uWobble;
varying vec2 vUv;
void main(){
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  // atan(0, 0) jest niezdefiniowany — NaN w buforze HalfFloat bloom rozlewa
  // na cały ekran; przesunięcie o 1e-6 nic nie zmienia w obrazie.
  float ang = atan(q.y, q.x + 1e-6);
  float w = pe_snoise(vec3(cos(ang) * 1.6, sin(ang) * 1.6, uTime * 0.6)) * uWobble;
  d *= 1.0 + w;
  float f = max(0.0, 1.0 - d);
  float a = pow(f, uFalloff) + uCoreBoost * pow(f, uFalloff * 4.5);
  if (a < 0.0008) discard;
  vec3 col = uColor * a * uIntensity;
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}`;

/* ============================================================================
   3. CZĄSTKI — pozycja liczona proceduralnie w vertex shaderze
   ========================================================================== */
const PART_VS = /* glsl */`
attribute vec3  aSeed;
attribute float aPhase;
uniform float uLen, uWidth, uEmit, uPower, uSizeK, uPixK, uOrtho;
uniform float uLifePh;     // faza życia cząstek, całkowana na CPU (0..1)
uniform vec3  uPart0, uPart1, uPart2;
varying float vA;
varying vec3  vC;
void main(){
  float life = fract(uLifePh + aPhase);
  float gate = step(aPhase, uEmit);
  float sp   = 0.70 + 0.60 * aSeed.z;
  float z    = life * uLen * 1.20 * sp;
  float ang  = aSeed.x * 6.28318 + life * 2.4 * (aSeed.z - 0.5);
  float rad  = (0.16 + 0.80 * aSeed.y) * uWidth * (0.55 + 1.10 * life);
  vec3 pos = vec3(cos(ang) * rad, sin(ang) * rad, z);
  pos.xy += vec2(sin(life * 12.0 + aSeed.x * 31.0), cos(life * 9.5 + aSeed.y * 27.0))
            * 0.09 * uWidth * life;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float fade = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.30, 1.0, life));
  vA = fade * gate * smoothstep(0.05, 0.4, uPower);
  vC = mix(uPart0, mix(uPart1, uPart2, smoothstep(0.25, 0.9, life)),
           smoothstep(0.015, 0.28, life));
  float sz = (0.026 + 0.042 * aSeed.z) * (1.0 - 0.45 * life) * uWidth;
  float szP = sz * uSizeK / max(-mv.z, 0.01);
  gl_PointSize = clamp(mix(szP, sz * uPixK, uOrtho), 1.0, 42.0);
}`;

const PART_FS = /* glsl */`
precision highp float;
uniform float uGain;
varying float vA;
varying vec3  vC;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.3);
  if (a * vA < 0.002) discard;
  vec3 col = vC * a * vA * uGain;
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}`;

/* ============================================================================
   4. KLASA
   ========================================================================== */
// Jakość gry: HIGH z dema (44 kroki, 3 oktawy). Proxy jest duże, ale granice
// marszu liczą się z aktualnych rozmiarów, więc koszt idzie za plume.
const QUALITY = Object.freeze({ steps: 44, oct: 3, particles: 520, jitter: 1.0 });

// Zapas na NAJGORSZY przypadek: długość 5 × dopalacz 1 + 0,55 × zasięg otoczki
// 1,34 — za małe proxy ścina ogon płaszczyzną, a nic nie kosztuje.
const MAX_LEN = 110.0;
const MAX_RAD = 3.0;

const _m1 = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
// wykładnicze dążenie niezależne od kroku czasu
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// Szum poświaty ma okres 289 w przestrzeni szumu; czas mnożony przez 0,6.
const GLOW_TIME_WRAP = 289 / 0.6;

export class WarpPlumeFX {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'WarpPlumeFX';

    this.params = {
      coreBrightness: 1.00,
      plumeLength: 1.00,
      plumeWidth: 1.00,
      turbulence: 1.00,
      flowSpeed: 4.50,
      blueSheath: 1.00,
      flicker: 0.35,
      particles: 0.35,
      density: 1.00,
      bodyGain: 1.00,
      extinction: 0.28,
      boostAmount: 1.00
    };

    this.ch = {
      power: 0, core: 0, len: 0, wid: 0, bright: 0,
      sheath: 0, glow: 0, emit: 0, afterglow: 0, ignite: 0, boost: 0
    };
    this.boost = false;
    this.state = 'off';          // off | ignition | running | shutdown
    this.throttle = 0;
    this._stateT = 0;
    this._time = Math.random() * 10;
    this._ph = { o1: 0, o2: 0, o3: 0, mach: 0, life: 0, stretch: 1 };
    this._flickMul = 1;
    this._palIdx = -1;

    this._buildPlume();
    this._buildGlows();
    this._buildParticles();
    this.setPalette(0);
  }

  _buildPlume() {
    const g = new THREE.BoxGeometry(MAX_RAD * 2, MAX_RAD * 2, MAX_LEN + 1.0);
    g.translate(0, 0, (MAX_LEN + 1.0) * 0.5 - 0.5);
    this.plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VS,
      fragmentShader: PLUME_FS,
      uniforms: {
        uTime: { value: 0 }, uLen: { value: WARP_PLUME_BASE_LEN }, uWidth: { value: 1 }, uCore: { value: 1 },
        uBright: { value: 1 }, uTurb: { value: 1 }, uSheath: { value: 1 },
        uFlowPh: { value: new THREE.Vector3() }, uMachPh: { value: 0 }, uStretch: { value: 1 },
        uDensity: { value: 1 }, uBodyGain: { value: 1 }, uAfterglow: { value: 0 }, uPower: { value: 0 },
        uIgnite: { value: 0 }, uExtinct: { value: 0.28 },
        uCamPosL: { value: new THREE.Vector3() }, uCamDirL: { value: new THREE.Vector3(0, 0, -1) },
        uOrtho: { value: 1 }, uBoundR: { value: 1.5 }, uBoundZ0: { value: -0.5 }, uBoundZ1: { value: 12 },
        uJitter: { value: QUALITY.jitter },
        uCoreWarm: { value: new THREE.Color(1, 1, 1) }, uCoreCold: { value: new THREE.Color(1, 1, 1) },
        uBody0: { value: new THREE.Color() }, uBody1: { value: new THREE.Color() },
        uBody2: { value: new THREE.Color() }, uBody3: { value: new THREE.Color() },
        uOuter0: { value: new THREE.Color() }, uOuter1: { value: new THREE.Color() }
      },
      defines: { PE_STEPS: QUALITY.steps, PE_OCT: QUALITY.oct },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true
    });
    this.plume = new THREE.Mesh(g, this.plumeMat);
    this.plume.name = 'WarpPlume';
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 1;
    this.root.add(this.plume);
  }

  _makeGlow(cfg) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS,
      fragmentShader: GLOW_FS,
      uniforms: {
        uSize: { value: cfg.size }, uStretch: { value: 1 },
        uColor: { value: new THREE.Color() }, uIntensity: { value: 0 },
        uFalloff: { value: cfg.falloff }, uCoreBoost: { value: cfg.boost || 0 },
        uTime: { value: 0 }, uWobble: { value: cfg.wobble || 0 }
      },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.z = cfg.z;
    m.frustumCulled = false;
    m.renderOrder = cfg.order;
    this.root.add(m);
    return m;
  }

  _buildGlows() {
    this.glowHot = this._makeGlow({ size: 2.6, z: 0.10, falloff: 3.2, boost: 1.0, order: 3, wobble: 0.05 });
    this.glowMag = this._makeGlow({ size: 7.0, z: 0.90, falloff: 2.5, boost: 0.35, order: 2, wobble: 0.10 });
    this.glowBlue = this._makeGlow({ size: 14.0, z: 2.20, falloff: 2.1, boost: 0.0, order: 0, wobble: 0.14 });
  }

  _buildParticles() {
    const N = QUALITY.particles;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
      phase[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, MAX_LEN * 0.5), MAX_LEN);
    this.partMat = new THREE.ShaderMaterial({
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      uniforms: {
        uLifePh: { value: 0 }, uLen: { value: WARP_PLUME_BASE_LEN }, uWidth: { value: 1 },
        uEmit: { value: 0 }, uPower: { value: 0 }, uSizeK: { value: 600 }, uPixK: { value: 20 },
        uOrtho: { value: 1 }, uGain: { value: 0.95 },
        uPart0: { value: new THREE.Color() }, uPart1: { value: new THREE.Color() },
        uPart2: { value: new THREE.Color() }
      },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, premultipliedAlpha: true
    });
    this.particles = new THREE.Points(g, this.partMat);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 4;
    this.root.add(this.particles);
  }

  /** Paleta z WARP_PLASMA_PALETTES (indeks). */
  setPalette(idx) {
    const n = WARP_PLASMA_PALETTES.length;
    const k = ((Number(idx) | 0) % n + n) % n;
    if (k === this._palIdx) return;
    this._palIdx = k;
    const p = WARP_PLASMA_PALETTES[k];
    const U = this.plumeMat.uniforms;
    U.uCoreWarm.value.setHex(p.core[0]); U.uCoreCold.value.setHex(p.core[1]);
    U.uBody0.value.setHex(p.body[0]); U.uBody1.value.setHex(p.body[1]);
    U.uBody2.value.setHex(p.body[2]); U.uBody3.value.setHex(p.body[3]);
    U.uOuter0.value.setHex(p.outer[0]); U.uOuter1.value.setHex(p.outer[1]);
    this.glowHot.material.uniforms.uColor.value.setHex(p.glow[0]);
    this.glowMag.material.uniforms.uColor.value.setHex(p.glow[1]);
    this.glowBlue.material.uniforms.uColor.value.setHex(p.glow[2]);
    const pu = this.partMat.uniforms;
    pu.uPart0.value.setHex(p.part[0]);
    pu.uPart1.value.setHex(p.part[1]);
    pu.uPart2.value.setHex(p.part[2]);
  }

  ignite() {
    if (this.state === 'ignition' || this.state === 'running') return;
    this.state = 'ignition';
    this._stateT = 0;
    this.throttle = Math.max(this.throttle, 1);
  }

  shutdown() {
    if (this.state === 'off' || this.state === 'shutdown') return;
    this.state = 'shutdown';
    this._stateT = 0;
  }

  setBoost(on) { this.boost = !!on; }

  /** Instancja zgasła do końca — można ją oddać do puli. */
  get finished() {
    const ch = this.ch;
    return this.state === 'off' && ch.bright < 0.004 && ch.sheath < 0.004 && ch.glow < 0.004 && ch.ignite < 0.01;
  }

  /** Stan jak po utworzeniu — przed ponownym użyciem z puli. */
  reset() {
    for (const k of Object.keys(this.ch)) this.ch[k] = 0;
    this.boost = false;
    this.state = 'off';
    this.throttle = 0;
    this._stateT = 0;
    this._ph.stretch = 1;
  }

  /**
   * Pozycja i kierunek w scenie gry.
   * @param {number} x,y,z   wylot dyszy (scena)
   * @param {number} dirX,dirY kierunek wydechu w płaszczyźnie (jednostkowy)
   * @param {number} radius  promień wylotu dyszy [j. świata]
   */
  setPose(x, y, z, dirX, dirY, radius) {
    this.root.position.set(x, y, z);
    _v1.set(dirX, dirY, 0);
    if (_v1.lengthSq() < 1e-10) _v1.set(0, -1, 0);
    _v1.normalize();
    _q1.setFromUnitVectors(_Z, _v1);
    this.root.quaternion.copy(_q1);
    this.root.scale.setScalar(Math.max(1e-3, Number(radius) || 1));
  }

  update(dt, camera, viewportH, isOrtho) {
    this._time += dt;
    this._stateT += dt;
    const ch = this.ch;
    const P = this.params;
    const t = this._time;

    /* --------- automat stanów: każdy kanał ma inną charakterystykę ------- */
    let cmd = this.throttle;
    ch.ignite = approach(ch.ignite, 0, 9.0, dt);

    if (this.state === 'off') {
      cmd = 0;
      ch.afterglow = approach(ch.afterglow, 0, 5.0, dt);
    } else if (this.state === 'ignition') {
      const T = this._stateT;
      ch.afterglow = 0;
      if (T < 0.24) {
        cmd = 0.035 + 0.05 * (T / 0.24);
        ch.glow = approach(ch.glow, 1.35 * (0.25 + T / 0.24), 14, dt);
      } else {
        if (ch.ignite < 0.05 && T < 0.34) ch.ignite = 1.0;   // błysk zapłonu
        const u = clamp((T - 0.24) / 0.62, 0, 1);
        const e = 1 - Math.pow(1 - u, 2.6);
        cmd = lerp(0.085, this.throttle, e);
        if (T > 0.95) { this.state = 'running'; this._stateT = 0; }
      }
    } else if (this.state === 'running') {
      ch.afterglow = approach(ch.afterglow, 0, 6.0, dt);
    } else { // shutdown
      cmd = 0;
      ch.afterglow = approach(ch.afterglow, 1, 7.0, dt);
      if (this._stateT > 1.5) this.state = 'off';
    }

    // 'dying' = shutdown ORAZ off — inaczej po zgaśnięciu kanały wracałyby
    // do wartości spoczynkowych i plume odradzałby się jako stały kikut.
    const dying = (this.state === 'shutdown' || this.state === 'off');

    ch.power = approach(ch.power, cmd, dying ? 7.5 : 3.6, dt);
    const coreTgt = Math.pow(clamp((cmd - 0.07) / 0.93, 0, 1), 0.75);
    ch.core = approach(ch.core, dying ? 0 : coreTgt, dying ? 16 : 9, dt);
    const lenTgt = dying ? (0.22 * ch.sheath) : (0.16 + 0.84 * Math.pow(cmd, 0.72));
    ch.len = approach(ch.len, lenTgt, dying ? 9 : 5.2, dt);
    let widTgt = 0.55 + 0.45 * Math.pow(cmd, 0.5);
    if (dying) widTgt = (this._stateT < 0.22 && this.state === 'shutdown') ? ch.wid * 1.35 : 0.55 * ch.sheath;
    ch.wid = approach(ch.wid, widTgt, dying ? 3.2 : 2.6, dt);
    ch.bright = approach(ch.bright, dying ? 0 : (0.30 + 0.70 * cmd), dying ? 3.0 : 6.0, dt);
    ch.sheath = approach(ch.sheath, dying ? 0 : (0.45 + 0.55 * cmd), dying ? 1.9 : 3.4, dt);
    const glowTgt = dying ? 0 : (0.12 + 1.25 * Math.pow(cmd, 0.6));
    if (!(this.state === 'ignition' && this._stateT < 0.24)) {
      ch.glow = approach(ch.glow, glowTgt, dying ? 2.4 : 8, dt);
    }
    ch.emit = approach(ch.emit, dying ? 0 : cmd, 6, dt);
    const boostOn = this.boost && !dying && cmd > 0.25;
    ch.boost = approach(ch.boost, boostOn ? 1 : 0, boostOn ? 5.0 : 2.4, dt);

    /* --------------------------- flicker / drżenie ciśnienia ------------- */
    const unstable = P.flicker * (0.45 + 0.95 * (1 - ch.power)) * (ch.power > 0.01 ? 1 : 0);
    const f = Math.sin(t * 37.3) * 0.5 + Math.sin(t * 91.7) * 0.28 + Math.sin(t * 13.1) * 0.22;
    this._flickMul = 1 + unstable * 0.11 * f + ch.ignite * 0.9;

    /* ----------------------------- uniformy plume ------------------------ */
    const U = this.plumeMat.uniforms;
    // B = siła dopalacza: strumień SZYBSZY, dłuższy, nieco węższy i gorętszy.
    const B = ch.boost * P.boostAmount;
    const len = WARP_PLUME_BASE_LEN * P.plumeLength * Math.max(ch.len, 0.0001) * (1 + WARP_PLUME_BOOST_LEN * B);
    const width = P.plumeWidth * Math.max(ch.wid, 0.0001) * (1 - 0.10 * Math.min(B, 1.4));
    const flow = P.flowSpeed * (0.45 + 0.80 * ch.power) * (1 + 1.70 * B);

    // Całkowanie faz: prędkość strumienia = pochodna fazy, więc zmiana flow
    // zmienia tylko tempo. Oktawy żyją w przestrzeni szumu (z·k); simplex ma
    // okres 289, więc fazy zawijają się bez skoku obrazu. Rozciągnięcie k
    // przesuwa cechę na z o z·Δk/k — limit tempa zmian trzyma prędkość ogona
    // ≥ 30% flow, więc strumień nigdy nie płynie wstecz.
    const ph = this._ph;
    const zMax = Math.max(len * 1.34 + 0.4, 1);
    const maxLn = 0.7 * flow / zMax * dt;
    const lnD = clamp(Math.log(1.17 / (1 + flow * 0.085) / ph.stretch), -maxLn, maxLn);
    ph.stretch *= Math.exp(lnD);
    const fstr = ph.stretch;
    const dz = flow * fstr * dt;
    ph.o1 = (ph.o1 + dz * 1.00 * 0.26) % 289;
    ph.o2 = (ph.o2 + dz * 2.30 * 0.62) % 289;
    ph.o3 = (ph.o3 + dz * 4.10 * 1.45) % 289;
    ph.mach = (ph.mach + flow * 5.0 * dt) % (Math.PI * 2);

    U.uTime.value = t % 1000;
    U.uLen.value = len;
    U.uWidth.value = width;
    U.uCore.value = P.coreBrightness * ch.core * this._flickMul * (1 + 0.30 * B);
    U.uBright.value = Math.max(ch.bright, ch.sheath * 0.60) * this._flickMul * (1 + 0.10 * B);
    U.uTurb.value = P.turbulence * (1 + 0.45 * B);
    U.uFlowPh.value.set(ph.o1, ph.o2, ph.o3);
    U.uMachPh.value = ph.mach;
    U.uStretch.value = fstr;
    U.uSheath.value = P.blueSheath * ch.sheath;
    U.uDensity.value = P.density;
    U.uBodyGain.value = P.bodyGain;
    U.uAfterglow.value = ch.afterglow;
    U.uPower.value = ch.power;
    U.uIgnite.value = ch.ignite;
    U.uExtinct.value = P.extinction;
    U.uBoundR.value = Math.min(MAX_RAD - 0.05, width * 1.45 + 0.20);
    U.uBoundZ0.value = -0.45;
    U.uBoundZ1.value = Math.min(MAX_LEN, len * 1.34 + 0.4);
    this.plume.visible = ch.bright > 0.004 || ch.sheath > 0.004;

    /* ---- kamera w przestrzeni lokalnej (poprawny raymarch w ortho) ------ */
    this.root.updateMatrixWorld(true);
    _m1.copy(this.plume.matrixWorld).invert();
    if (camera) {
      camera.getWorldPosition(_v1).applyMatrix4(_m1);
      U.uCamPosL.value.copy(_v1);
      camera.getWorldDirection(_v2).transformDirection(_m1).normalize();
      U.uCamDirL.value.copy(_v2);
    }
    U.uOrtho.value = isOrtho ? 1 : 0;

    /* ------------------------------ billboardy --------------------------- */
    const scl = this.root.scale.x;
    const glowT = t % GLOW_TIME_WRAP;
    const gh = this.glowHot.material.uniforms;
    gh.uTime.value = glowT;
    gh.uSize.value = (0.80 + 0.50 * ch.power) * scl;
    gh.uIntensity.value = (0.95 * ch.core + 3.2 * ch.ignite + 0.28 * ch.glow) * this._flickMul * (1 - ch.afterglow * 0.85);
    const gm = this.glowMag.material.uniforms;
    gm.uTime.value = glowT;
    gm.uSize.value = (2.3 + 1.7 * ch.power) * scl;
    gm.uIntensity.value = (0.30 * ch.bright + 0.8 * ch.ignite) * this._flickMul * (1 - ch.afterglow * 0.35);
    this.glowMag.position.z = 0.40 + 0.55 * ch.len;
    const gb = this.glowBlue.material.uniforms;
    gb.uTime.value = glowT;
    gb.uSize.value = (4.0 + 3.4 * ch.power) * scl;
    gb.uIntensity.value = 0.075 * ch.sheath * P.blueSheath * (0.5 + 0.5 * this._flickMul);
    this.glowBlue.position.z = 0.9 + 1.5 * ch.len;
    this.glowHot.visible = gh.uIntensity.value > 0.004;
    this.glowMag.visible = gm.uIntensity.value > 0.004;
    this.glowBlue.visible = gb.uIntensity.value > 0.004;

    /* -------------------------------- cząstki ---------------------------- */
    const pu = this.partMat.uniforms;
    const count = Math.floor(QUALITY.particles * P.particles);
    this.particles.geometry.setDrawRange(0, count);
    this.particles.visible = count > 0 && ch.emit > 0.01;
    const partFlow = (0.55 + 0.9 * ch.power) * (1 + 1.5 * B);
    ph.life = (ph.life + partFlow * dt) % 1;
    pu.uLifePh.value = ph.life;
    pu.uLen.value = len;
    pu.uWidth.value = width;
    pu.uEmit.value = ch.emit;
    pu.uPower.value = ch.power;
    pu.uOrtho.value = isOrtho ? 1 : 0;
    pu.uGain.value = 0.95 * this._flickMul;
    if (camera && !isOrtho && camera.isPerspectiveCamera) {
      pu.uSizeK.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
    } else if (camera && camera.isOrthographicCamera) {
      pu.uPixK.value = viewportH / ((camera.top - camera.bottom) / (camera.zoom || 1)) * scl;
    }
  }

  /** Siatki do kompilacji shaderów na ekranie ładowania. */
  get meshes() {
    return [this.plume, this.glowHot, this.glowMag, this.glowBlue, this.particles];
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

/* ============================================================================
   5. PULA
   ========================================================================== */
// Gracz ma 5 dysz, ciężka flota piracka wlatuje skokiem kilkunastoma — ponad
// limit dysze dostają strugę MAIN z dopalaczem (EngineVfxSystem).
export const WARP_PLUME_CAP = 16;

const free = [];
let active = 0;

export const WarpPlume3D = {
  get cap() { return WARP_PLUME_CAP; },
  get activeCount() { return active; },

  /** Instancja z puli albo null, gdy limit wyczerpany / brak Core3D. */
  acquire() {
    if (active >= WARP_PLUME_CAP) return null;
    if (!Core3D.isInitialized || !Core3D.scene) return null;
    const fx = free.pop() || new WarpPlumeFX();
    if (fx.root.parent !== Core3D.scene) Core3D.scene.add(fx.root);
    fx.reset();
    fx.root.visible = true;
    active++;
    return fx;
  },

  release(fx) {
    if (!fx) return;
    fx.reset();
    fx.root.visible = false;
    free.push(fx);
    active = Math.max(0, active - 1);
  },

  /**
   * Obiekty do kompilacji na ekranie ładowania (widoczność ustawia wołający).
   * Instancja zostaje w puli — pierwszy skok nie buduje już niczego.
   */
  prewarm() {
    if (!Core3D.isInitialized || !Core3D.scene) return [];
    let fx = free[free.length - 1];
    if (!fx) {
      fx = new WarpPlumeFX();
      fx.root.visible = false;
      Core3D.scene.add(fx.root);
      free.push(fx);
    }
    return [fx.root, ...fx.meshes];
  },

  disposeAll() {
    for (const fx of free) fx.dispose();
    free.length = 0;
    active = 0;
  }
};
