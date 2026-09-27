// Tło menu głównego (przed startem gry): Ziemia z ringiem „Halo” w kamerze
// kinowej. Ring jest ringiem GRY (HaloRingGame.showcaseRing — mapy dopiekają
// się już w menu, więc start przy Ziemi ma je gotowe), Ziemia i niebo to
// shadery kamery kinowej z dema ringu (dema/halo_ring_demo_env.js) przeliczone
// na układ lokalny ringu: oświetla je to samo słońce co ring (uSunDir), cień
// ringu na planecie liczy haloRingBlock. Render: Core3D.renderBackdrop — ta
// sama scena, renderer, bloom i ACES co gra, tylko warstwa MENU_BACKDROP_LAYER
// (passy gry jej nie widzą). Tekstury Ziemi są pożyczone od planety gry
// (window.EARTH) — tło ich nie zwalnia.
//
//   const bd = new MenuBackdrop3D({ haloRings });
//   bd.start();                 // DOMContentLoaded, po initHaloRings
//   bd.setActive(menuVisible);  // pętla rAF tylko przy widocznym menu
//   bd.launch();                // start gry: przejazd kamery
//   bd.stop();                  // przed pierwszą klatką gry: ring wraca do gry
import * as THREE from 'three';
import { Core3D, MENU_BACKDROP_LAYER } from './core3d.js';
import { HALO_GLSL_COMMON, HALO_GLSL_LIGHT } from './haloRing/haloRingGLSL.js';
import { HALO_HDR } from './haloRing/haloRingConfig.js';
import { createHaloBakeWarmup } from './haloRing/haloRingWorldGen.js';

const DEG = Math.PI / 180;

// Ujęcie w układzie lokalnym ringu: oś Z = oś ringu, środek planety (0, 0, cz).
// Słońce obraca się razem z kamerą („talerz”): oświetlenie kadru stoi, a ring
// i planeta powoli płyną pod kamerą.
export const MENU_SHOT = Object.freeze({
  distance: 196000,       // kamera od środka planety [j.]
  elevationDeg: 13,       // nad płaszczyzną ringu
  azimuthDeg: 200,        // azymut startowy
  orbitDegPerSec: 0.6,    // obrót „talerza”
  sunOffsetDeg: 50,       // azymut słońca względem kamery
  sunElevationDeg: 27,    // słońce nad płaszczyzną ringu
  fovDeg: 30,
  rollDeg: -12,           // przechył horyzontu ringu
  shiftX: 0.22,           // planeta w prawo od środka kadru (ułamek szerokości)
  shiftY: 0.02,
  focusShiftX: 0.3,       // otwarty panel podmenu: planeta dalej w prawo
  earthSpin: 0.006,       // obrót Ziemi [rad/s]
  cloudSpin: 0.0085,
  introSeconds: 7.5,      // najazd po gotowości
  introDistanceMul: 1.4,
  introElevationDeg: 5,
  parallaxDeg: 1.3,       // paralaksa za kursorem
  launchSeconds: 2.8,     // przejazd przy starcie gry
  launchDistanceMul: 0.62,
  // mgławica gry na niebie: środek względem kierunku kamera → planeta
  nebulaYawDeg: 22,
  nebulaPitchDeg: 8,
  nebulaRollDeg: -24,
  nebulaHalfWidthDeg: 58,
  nebulaGain: 1.15
});

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOutCubic = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// ---------------------------------------------------------------------------
// Shadery (port z dema: CINE_EARTH_*, CINE_ATM_FRAGMENT, SKY_*). Wszystko
// w układzie ringu: punkt z uLocal (siatka → ring), kamera = uCamLocal
// (ring.update), środek i promień planety = uPlanet, słońce = uSunDir.
const LOCAL_VERTEX = /* glsl */`
uniform mat4 uLocal;
varying vec2 vUv;
varying vec3 vPosL;
void main() {
  vUv = uv;
  vPosL = (uLocal * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EARTH_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_LIGHT}
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D specularTexture;
uniform sampler2D normalTexture;
uniform sampler2D cloudTexture;
uniform float uCloudShift;
varying vec2 vUv;
varying vec3 vPosL;
float mbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mbNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mbHash(i), mbHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(mbHash(i + vec3(0.0, 1.0, 0.0)), mbHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(mbHash(i + vec3(0.0, 0.0, 1.0)), mbHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(mbHash(i + vec3(0.0, 1.0, 1.0)), mbHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main() {
  vec3 Ng = normalize(vPosL - uPlanet.xyz);
  vec3 V = normalize(uCamLocal - vPosL);
  vec3 L = uSunDir;
  // mapa normalnych (rama z pochodnych, jak w grze)
  vec3 mapN = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= 0.9;
  vec3 q0 = dFdx(vPosL);
  vec3 q1 = dFdy(vPosL);
  vec2 st0 = dFdx(vUv);
  vec2 st1 = dFdy(vUv);
  vec3 S = normalize(q0 * st1.t - q1 * st0.t + 1e-6);
  vec3 T = normalize(-q0 * st1.s + q1 * st0.s + 1e-6);
  vec3 N = normalize(mat3(S, T, Ng) * mapN);
  float NgL = dot(Ng, L);
  float NdL = dot(N, L);
  float ringVis = haloRingBlock(vPosL + Ng * 8.0, L);
  // detal z bliska: szum 3D na sferze (tekstura 8k to ~29 j./teksel)
  float dn = mbNoise(Ng * uPlanet.w / 420.0) * 0.6 + mbNoise(Ng * uPlanet.w / 95.0) * 0.4;
  float closeK = 1.0 - smoothstep(9000.0, 30000.0, length(uCamLocal - vPosL));
  vec3 day = texture2D(dayTexture, vUv).rgb * (1.0 + (dn - 0.5) * 0.22 * closeK);
  float water = smoothstep(0.08, 0.8, texture2D(specularTexture, vUv).r);
  // Chmury płyną względem lądu: przesunięcie zawinięte fract() z gradientami
  // nieprzesuniętego UV (tekstura chmur gry ma zawijanie clamp, a fract bez
  // gradientów dawał szew mipmap na południku zawinięcia).
  vec2 cGx = dFdx(vUv);
  vec2 cGy = dFdy(vUv);
  vec2 cuv = vec2(fract(vUv.x + uCloudShift), vUv.y);
  float cRaw = dot(textureGrad(cloudTexture, cuv, cGx, cGy).rgb, vec3(0.299, 0.587, 0.114));
  float cloud = smoothstep(0.1, 0.78, cRaw + (dn - 0.5) * 0.12 * closeK);
  // cien chmur: odczyt przesuniety ku sloncu (warstwa ~1% promienia nad ziemia)
  vec3 Lt = L - Ng * NgL;
  vec2 shOff = vec2(dot(Lt, S), dot(Lt, T)) * 0.0009;
  vec2 shUV = vec2(fract(cuv.x + shOff.x), cuv.y + shOff.y);
  float cShadow = smoothstep(0.15, 0.8, dot(textureGrad(cloudTexture, shUV, cGx, cGy).rgb, vec3(0.299, 0.587, 0.114)));
  float term = smoothstep(-0.06, 0.16, NgL);
  vec3 sun = uSunColor * ringVis * term;
  vec3 surf = day * 0.95 * (sun * max(NdL, 0.0) * (1.0 - cShadow * 0.55) + vec3(0.004, 0.006, 0.01));
  // polysk oceanu (GGX, lekko szorstki)
  vec3 H = normalize(L + V);
  float a2 = 0.028;
  float NdH = max(dot(Ng, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
  float glint = min(a2 / (3.14159 * dd * dd) * fres * 0.25 * max(NgL, 0.0), 12.0);
  surf += sun * glint * water * (1.0 - cloud) * vec3(1.0, 0.95, 0.88);
  // swiatla nocne (miasta Ziemi) po nocnej stronie i w cieniu ringu
  vec3 night = texture2D(nightTexture, vUv).rgb;
  float nightMask = 1.0 - smoothstep(-0.14, 0.04, NgL * ringVis);
  surf += night * night * vec3(1.0, 0.72, 0.42) * 0.55 * nightMask * (1.0 - cloud * 0.8);
  // chmury (ta sama tekstura co w grze)
  vec3 cloudCol = vec3(0.74) * (sun * (0.35 + 0.65 * max(NgL, 0.0)) + vec3(0.005, 0.007, 0.012));
  surf = mix(surf, cloudCol, cloud * 0.94);
  // cienka atmosfera wzdluz promienia: blekit w dzien, zachod przy terminatorze
  float mu = max(dot(Ng, V), 0.0);
  float airmass = 1.0 / (mu + 0.045);
  vec3 beta = vec3(0.020, 0.048, 0.115);
  vec3 ext = exp(-beta * airmass);
  float dayF = smoothstep(-0.1, 0.3, NgL);
  float sunsetF = smoothstep(-0.2, 0.0, NgL) * (1.0 - smoothstep(0.0, 0.28, NgL));
  vec3 scat = mix(vec3(0.30, 0.52, 1.0), vec3(1.0, 0.42, 0.16), sunsetF) * (dayF * 0.9 + sunsetF * 0.35) * ringVis;
  surf = surf * ext + scat * uSunColor * (1.0 - ext) * 0.62;
  gl_FragColor = vec4(max(surf, vec3(0.0)), 1.0);
}
`;

// Poświata limbu: tylna ścianka powłoki, widoczna tylko poza tarczą planety.
const ATMOSPHERE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_LIGHT}
uniform float uRa;
varying vec2 vUv;
varying vec3 vPosL;
void main() {
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vPosL - ro);
  vec3 oc = ro - uPlanet.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRa * uRa;
  float disc = b * b - c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float R = uPlanet.w;
  float cp = dot(oc, oc) - R * R;
  float dp = b * b - cp;
  if (dp > 0.0) { float tp = -b - sqrt(dp); if (tp > 0.0) t1 = min(t1, tp); }
  if (t1 <= t0) discard;
  float tm = clamp(-b, t0, t1);
  vec3 pm = ro + rd * tm;
  float hmin = max(length(pm - uPlanet.xyz) - R, 0.0);
  float Hs = (uRa - R) * 0.22;
  float tau = (t1 - t0) * exp(-hmin / Hs) / (uRa - R) * 0.9;
  vec3 n = normalize(pm - uPlanet.xyz);
  float nl = dot(n, uSunDir);
  float dayF = smoothstep(-0.22, 0.25, nl);
  float sunsetF = smoothstep(-0.28, -0.02, nl) * (1.0 - smoothstep(-0.02, 0.22, nl));
  float ringVis = haloRingBlock(pm, uSunDir);
  vec3 col = mix(vec3(0.26, 0.5, 1.0), vec3(1.0, 0.38, 0.12), sunsetF) * (dayF + sunsetF * 0.6) * ringVis;
  vec3 glow = col * uSunColor * (1.0 - exp(-tau * vec3(0.35, 0.62, 1.0))) * 0.75;
  gl_FragColor = vec4(glow, 1.0);
}
`;

// Niebo na nieskończoności (xyww): gwiazdy w 3 warstwach, Droga Mleczna,
// mgławica gry (ta sama tekstura co NebulaSystem) za planetą i tarcza słońca
// HDR z poświatą. Siatka jest dzieckiem grupy ringu obróconym o azymut
// kamery: niebo i słońce stoją względem kadru, a pod nimi płyną ring i planeta.
const SKY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 clip = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;
const SKY_FRAGMENT = /* glsl */`
uniform vec3 uSunDir;
uniform float uSunCore;
uniform float uStars;
uniform sampler2D uNebulaMap;
uniform float uNebulaGain;
uniform vec3 uNebC;
uniform vec3 uNebR;
uniform vec3 uNebU;
uniform vec2 uNebHalf;
varying vec3 vDir;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float starLayer(vec3 d, float scale, float threshold) {
  vec3 cp = d * scale;
  vec3 cell = floor(cp);
  vec3 local = fract(cp) - 0.5;
  float seed = h31(cell);
  vec3 jitter = vec3(h31(cell + 7.1), h31(cell + 3.7), h31(cell + 1.9)) - 0.5;
  float radius = mix(0.05, 0.12, seed);
  float core = 1.0 - smoothstep(radius * 0.2, radius, length(local - jitter * 0.6));
  return core * step(threshold, seed);
}
float vh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vh(i), vh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vh(i + vec3(0.0, 1.0, 0.0)), vh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vh(i + vec3(0.0, 0.0, 1.0)), vh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vh(i + vec3(0.0, 1.0, 1.0)), vh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  // Droga Mleczna: pasmo wokol wielkiego kola, oblok gwiazd + ciemne pasy pylu
  vec3 bandN = normalize(vec3(0.31, -0.52, 0.8));
  float lat = dot(d, bandN);
  float band = exp(-lat * lat / (2.0 * 0.16 * 0.16));
  float core = exp(-lat * lat / (2.0 * 0.05 * 0.05));
  float cloud = fbm(d * 4.0 + 3.0);
  float dust = smoothstep(0.52, 0.72, fbm(d * 9.0 + 11.0)) * core;
  float glow = band * (0.35 + 0.9 * smoothstep(0.35, 0.75, cloud)) * (1.0 - dust * 0.85);
  vec3 col = vec3(0.0005, 0.0008, 0.0016);
  col += vec3(0.010, 0.013, 0.022) * glow;
  col += vec3(0.013, 0.011, 0.010) * core * smoothstep(0.45, 0.8, cloud) * (1.0 - dust);
  // mglawica gry: plat nieba za planeta (katy wokol uNebC), miekki brzeg
  float nc = dot(d, uNebC);
  if (uNebulaGain > 0.0 && nc > 0.05) {
    vec2 nuv = vec2(atan(dot(d, uNebR), nc) / uNebHalf.x, atan(dot(d, uNebU), nc) / uNebHalf.y);
    vec2 edge = smoothstep(vec2(1.0), vec2(0.45), abs(nuv));
    if (edge.x * edge.y > 0.0) col += texture2D(uNebulaMap, nuv * 0.5 + 0.5).rgb * uNebulaGain * edge.x * edge.y;
  }
  float s1 = starLayer(d, 110.0, 0.985);
  float s2 = starLayer(d.yzx + vec3(7.1, 3.7, 5.3), 240.0, 0.975 - band * 0.03);
  float s3 = starLayer(d.zxy + vec3(1.9, 8.2, 4.4), 52.0, 0.996);
  col += vec3(0.62, 0.74, 1.0) * s1 * 0.55 * uStars;
  col += vec3(0.85, 0.9, 1.0) * s2 * 0.32 * uStars * (0.6 + band);
  col += vec3(1.0, 0.86, 0.7) * s3 * 1.6 * uStars;
  float sd = dot(d, uSunDir);
  float disk = smoothstep(0.99996, 0.99999, sd);
  float halo = pow(max(sd, 0.0), 1400.0) * 1.4 + pow(max(sd, 0.0), 90.0) * 0.06 + pow(max(sd, 0.0), 8.0) * 0.004;
  // poswiata tylko poza tarcza: rdzen zostaje dokladnie w pasmie bieli (8-12)
  col += vec3(1.0, 0.96, 0.9) * mix(halo, uSunCore, disk);
  gl_FragColor = vec4(col, 1.0);
}
`;

const TEXTURE_PATHS = Object.freeze({
  day: 'assets/planety/solar/earth/earth_color.jpg',
  night: 'assets/planety/images/earth_nightmap.jpg',
  spec: 'assets/planety/images/earth_specularmap.jpg',
  normal: 'assets/planety/solar/earth/earth_normal.jpg',
  clouds: 'assets/planety/solar/earth/earth_clouds.jpg'
});

function textureLoaded(tex) {
  const img = tex?.image;
  if (!img) return false;
  if (img.complete === false) return false;
  return (img.naturalWidth || img.width || 0) > 0;
}

export class MenuBackdrop3D {
  constructor({ haloRings = null, planetKey = 'earth', shot = MENU_SHOT } = {}) {
    this.haloRings = haloRings;
    this.planetKey = planetKey;
    this.shot = { ...shot };
    this.camera = new THREE.PerspectiveCamera(this.shot.fovDeg, 1, 100, 500000);
    this.ring = null;
    this.running = false;
    this.active = false;
    this.ready = false;
    this.readyAt = -1;
    this.time = 0;
    this.orbit = 0;
    this.focus = 0;
    this.focusTarget = 0;
    this.launchAt = -1;
    this.frozen = false;
    this.stats = { frames: 0, frameMs: 0, mapsReady: false, texturesReady: false, warmupMs: 0, ringBuildMs: 0, compileMs: 0, readyAtMs: 0 };
    this._live = false;
    this._raf = 0;
    this._last = 0;
    this._pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this._readyCallbacks = [];
    this._textures = null;
    this._ownTextures = [];
    this._warmed = new Set();
    this._objects = null;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._tick = (now) => this._frame(now);
    this._onVisibility = () => this._sync();
  }

  // Start w tle (menu zostaje responsywne): shader pieczenia map ringu
  // kompilowany równolegle (KHR_parallel_shader_compile), potem ring gry
  // (showcase), Ziemia i niebo, ich programy znów w tle — dopiero wtedy pętla
  // renderu. Bez Core3D albo ringu — false (menu zostaje na tle CSS).
  start() {
    if (this.running) return true;
    if (!Core3D.isInitialized || !this.haloRings) return false;
    this.running = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    this._startAsync().catch((err) => {
      console.error('[MenuBackdrop3D] start nie wyszedł — zostaje tło CSS', err);
      this.stop();
    });
    return true;
  }

  async _startAsync() {
    // Urządzenie WebGPU powstaje w tle po Core3D.init() — pieczenie map ringu,
    // kompilacja i render czekają na nie. Bez WebGPU tła nie ma (menu pokazuje
    // komunikat, index.html), zostaje tło CSS.
    const gpuOk = await Core3D.ready;
    if (!gpuOk || !this.running) {
      if (!gpuOk) this.stop();
      return;
    }
    const renderer = Core3D.renderer;
    const t0 = performance.now();
    // 1) shader pieczenia map: kilka sekund w sterowniku, na pierwszym bake'u
    //    zamrażał stronę — teraz w tle, program trafia do cache three
    const warm = createHaloBakeWarmup();
    try {
      await renderer.compileAsync(warm.scene, this.camera);
    } catch (err) {
      console.warn('[MenuBackdrop3D] rozgrzewka shadera map nie wyszła — kompilacja przy bake’u', err);
    }
    this.stats.warmupMs = performance.now() - t0;
    if (!this.running) { warm.dispose(); return; }
    // 2) ring gry (budowa + pierwszy bake map niskich z gotowym programem)
    const t1 = performance.now();
    let ring = null;
    try {
      ring = this.haloRings.showcaseRing(this.planetKey);
    } finally {
      warm.dispose();
    }
    this.stats.ringBuildMs = performance.now() - t1;
    if (!ring) throw new Error('brak ringu planety ' + this.planetKey);
    this.ring = ring;
    ring.setLayers({ default: MENU_BACKDROP_LAYER, fg: MENU_BACKDROP_LAYER });
    ring.setCutaway(0, null);
    ring.setCutaway(1, null);
    ring.group.visible = true;
    this._textures = this._resolveTextures();
    this._objects = this._build(ring);
    // 3) programy ringu, Ziemi i nieba w tle (pierwsza klatka bez przestoju)
    const t2 = performance.now();
    try {
      await renderer.compileAsync(ring.group, this.camera, Core3D.scene);
    } catch (err) {
      console.warn('[MenuBackdrop3D] kompilacja materiałów w tle nie wyszła', err);
    }
    this.stats.compileMs = performance.now() - t2;
    if (!this.running) return;
    this._live = true;
    this._last = performance.now();
    this._sync();
  }

  // Menu widoczne → pętla renderu; schowane (edytor, nakładki split-screen)
  // albo karta w tle → stop bez zwalniania czegokolwiek.
  setActive(on) {
    this.active = !!on;
    this._sync();
  }

  // Kursor w [-1, 1] (środek ekranu = 0) — paralaksa kamery.
  setPointer(nx, ny) {
    this._pointer.x = Math.max(-1, Math.min(1, Number(nx) || 0));
    this._pointer.y = Math.max(-1, Math.min(1, Number(ny) || 0));
  }

  // 0 = ekran główny menu, 1 = otwarty panel podmenu (planeta ustępuje w prawo).
  setFocus(k) {
    this.focusTarget = Math.max(0, Math.min(1, Number(k) || 0));
  }

  // Start gry: najazd kamery na ring, trwa do stop().
  launch() {
    if (this.launchAt < 0) this.launchAt = this.time;
  }

  onReady(fn) {
    if (typeof fn !== 'function') return;
    if (this.ready) fn();
    else this._readyCallbacks.push(fn);
  }

  // Ring wraca do gry (warstwy, słońce, widoczność), obiekty tła zwolnione.
  // Także w trakcie startu w tle — _startAsync kończy się po najbliższym await.
  stop() {
    if (!this.running) return;
    this.running = false;
    this._live = false;
    this.active = false;
    this._sync();
    document.removeEventListener('visibilitychange', this._onVisibility);
    const o = this._objects;
    if (o) {
      o.earthGroup.parent?.remove(o.earthGroup);
      o.sky.parent?.remove(o.sky);
      for (const m of o.materials) m.dispose();
      for (const g of o.geometries) g.dispose();
    }
    for (const tex of this._ownTextures) tex.dispose();
    this._ownTextures.length = 0;
    this._objects = null;
    this.haloRings?.releaseShowcase(this.planetKey);
    this.ring = null;
    this._readyCallbacks.length = 0;
  }

  // ---------------------------------------------------------------------
  _sync() {
    const want = this.running && this._live && this.active && document.visibilityState !== 'hidden';
    if (want && !this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    } else if (!want && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  _resolveTextures() {
    const src = typeof window !== 'undefined' ? window.EARTH : null;
    const u = src?.uniforms;
    const pick = (tex, path, srgb) => {
      if (tex?.isTexture) return tex;
      const own = new THREE.TextureLoader().load(path);
      if (srgb) own.colorSpace = THREE.SRGBColorSpace;
      own.anisotropy = Core3D.getMaxAnisotropy();
      this._ownTextures.push(own);
      return own;
    };
    return {
      day: pick(u?.dayTexture?.value, TEXTURE_PATHS.day, true),
      night: pick(u?.nightTexture?.value, TEXTURE_PATHS.night, true),
      spec: pick(u?.specularTexture?.value, TEXTURE_PATHS.spec, false),
      normal: pick(u?.normalTexture?.value, TEXTURE_PATHS.normal, false),
      clouds: pick(src?.cloudUniforms?.cloudTexture?.value, TEXTURE_PATHS.clouds, true)
    };
  }

  _build(ring) {
    const L = ring.layout;
    const R = L.planetRadius;
    const tex = this._textures;
    const ru = ring.uniforms;
    const materials = [];
    const geometries = [];

    const earthUniforms = {
      ...ru,
      uLocal: { value: new THREE.Matrix4() },
      dayTexture: { value: tex.day },
      nightTexture: { value: tex.night },
      specularTexture: { value: tex.spec },
      normalTexture: { value: tex.normal },
      cloudTexture: { value: tex.clouds },
      uCloudShift: { value: 0 }
    };
    const earthMat = new THREE.ShaderMaterial({
      name: 'MenuEarth',
      uniforms: earthUniforms,
      vertexShader: LOCAL_VERTEX,
      fragmentShader: EARTH_FRAGMENT
    });
    const atmUniforms = { ...ru, uLocal: { value: new THREE.Matrix4() }, uRa: { value: R + 1250 } };
    const atmMat = new THREE.ShaderMaterial({
      name: 'MenuEarthAtmosphere',
      uniforms: atmUniforms,
      vertexShader: LOCAL_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sphere = new THREE.SphereGeometry(1, 192, 128);
    const atmSphere = new THREE.SphereGeometry((R + 1250) / R, 128, 96);
    materials.push(earthMat, atmMat);
    geometries.push(sphere, atmSphere);

    // Grupa planety w grupie ringu: biegun (oś Y sfery) = oś ringu (Z).
    const earthGroup = new THREE.Group();
    earthGroup.name = 'MenuEarth';
    earthGroup.position.set(0, 0, L.planetCenterZ);
    earthGroup.rotation.x = Math.PI / 2;
    earthGroup.scale.setScalar(R);
    const earth = new THREE.Mesh(sphere, earthMat);
    const atmosphere = new THREE.Mesh(atmSphere, atmMat);
    atmosphere.renderOrder = 6;
    earthGroup.add(earth, atmosphere);

    // Mgławica tła gry (NebulaSystem, planet3d.assets.js) — pożyczona tekstura.
    const nebulaMap = Core3D.scene.getObjectByName('Nebula')?.material?.uniforms?.map?.value || null;
    const skyMat = new THREE.ShaderMaterial({
      name: 'MenuSky',
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunCore: { value: HALO_HDR.sunDisk },
        uStars: { value: 1.0 },
        uNebulaMap: { value: nebulaMap },
        uNebulaGain: { value: 0 },
        uNebC: { value: new THREE.Vector3(-1, 0, 0) },
        uNebR: { value: new THREE.Vector3(0, -1, 0) },
        uNebU: { value: new THREE.Vector3(0, 0, 1) },
        uNebHalf: { value: new THREE.Vector2(1, 0.6) }
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false
    });
    const skyGeo = new THREE.SphereGeometry(1, 64, 32);
    materials.push(skyMat);
    geometries.push(skyGeo);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'MenuSky';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;

    for (const obj of [earthGroup, sky]) obj.traverse((o) => o.layers.set(MENU_BACKDROP_LAYER));
    ring.group.add(earthGroup, sky);
    return { earthGroup, earth, atmosphere, sky, earthUniforms, atmUniforms, skyUniforms: skyMat.uniforms, materials, geometries, spin: 0, cloudSpin: 0 };
  }

  // Tekstury Ziemi wczytane i wgrane (po jednej na klatkę, żeby upload 8K
  // nie trafił w pierwszą klatkę po zdjęciu kurtyny).
  _texturesReady() {
    let ok = true;
    let warmedThisFrame = false;
    for (const tex of Object.values(this._textures)) {
      if (!textureLoaded(tex)) { ok = false; continue; }
      if (this._warmed.has(tex)) continue;
      ok = false;
      if (warmedThisFrame) continue;
      try { Core3D.renderer.initTexture(tex); } catch { /* wgra się przy renderze */ }
      this._warmed.add(tex);
      warmedThisFrame = true;
    }
    return ok;
  }

  // Słońce i płat mgławicy w układzie nieba (kamera na azymucie 0, patrzy ku −X).
  _skyFrame(su, s) {
    const sOff = s.sunOffsetDeg * DEG;
    const sEl = s.sunElevationDeg * DEG;
    su.uSunDir.value.set(Math.cos(sOff) * Math.cos(sEl), Math.sin(sOff) * Math.cos(sEl), Math.sin(sEl));
    const yaw = Math.PI + s.nebulaYawDeg * DEG;
    const pitch = (s.nebulaPitchDeg - s.elevationDeg) * DEG;
    const c = su.uNebC.value.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    const r = su.uNebR.value.crossVectors(c, this._up.set(0, 0, 1)).normalize();
    const u = su.uNebU.value.crossVectors(r, c).normalize();
    const roll = s.nebulaRollDeg * DEG;
    r.applyAxisAngle(c, roll);
    u.applyAxisAngle(c, roll);
    const half = s.nebulaHalfWidthDeg * DEG;
    su.uNebHalf.value.set(half, half / 1.6);
    su.uNebulaGain.value = su.uNebulaMap.value ? s.nebulaGain : 0;
  }

  _frame(now) {
    this._raf = 0;
    if (!this.running || !this.active) return;
    this._raf = requestAnimationFrame(this._tick);
    const t0 = performance.now();
    const dt = this.frozen ? 0 : Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.renderFrame(dt);
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  // Jedna klatka tła (pętla rAF albo zrzuty: renderFrame(0) po ustawieniu kadru).
  renderFrame(dt = 0) {
    const ring = this.ring;
    const o = this._objects;
    if (!ring || !o) return;
    const s = this.shot;
    this.time += dt;
    this.orbit += dt * s.orbitDegPerSec;
    // jakość z opcji menu (jak haloRings.update w grze): zmiana = przebudowa ringu
    this.haloRings.setQuality(window.OPTIONS?.planetQuality || this.haloRings.qualityKey);
    const L = ring.layout;

    if (!this.ready) {
      const texOk = this._texturesReady();
      this.stats.texturesReady = texOk;
      this.stats.mapsReady = !!ring.mapsReady;
      if (texOk && ring.mapsReady && this.stats.frames > 2) {
        this.ready = true;
        this.readyAt = this.time;
        this.stats.readyAtMs = performance.now();
        const cbs = this._readyCallbacks.splice(0);
        for (const fn of cbs) { try { fn(); } catch (err) { console.error('[MenuBackdrop3D] onReady', err); } }
      }
    }

    // płynne dojście paralaksy i kadru panelu
    const kp = 1 - Math.exp(-dt * 2.2);
    const pt = this._pointer;
    pt.sx += (pt.x - pt.sx) * kp;
    pt.sy += (pt.y - pt.sy) * kp;
    this.focus += (this.focusTarget - this.focus) * (1 - Math.exp(-dt * 2.6));

    const intro = this.ready ? easeOutCubic((this.time - this.readyAt) / s.introSeconds) : 0;
    const launch = this.launchAt >= 0 ? smooth01((this.time - this.launchAt) / s.launchSeconds) : 0;

    // słońce idzie z kamerą: stałe oświetlenie kadru
    const az = (s.azimuthDeg + this.orbit) * DEG - pt.sx * s.parallaxDeg * DEG;
    ring.setSun(az + s.sunOffsetDeg * DEG, s.sunElevationDeg * DEG);
    // niebo obrócone o azymut kamery: w jego układzie kamera stoi na azymucie 0
    o.sky.rotation.z = az;
    this._skyFrame(o.skyUniforms, s);

    // kamera w układzie ringu → świat (grupa ringu leży w scenie bez rodzica)
    const dist = s.distance
      * (1 + (s.introDistanceMul - 1) * (1 - intro))
      * (1 + (s.launchDistanceMul - 1) * launch);
    const el = (s.elevationDeg + s.introElevationDeg * (1 - intro) + pt.sy * s.parallaxDeg * 0.6) * DEG;
    const cz = L.planetCenterZ;
    ring.group.updateMatrix();
    const M = ring.group.matrix;
    const cosEl = Math.cos(el);
    const pos = this._p.set(Math.cos(az) * cosEl * dist, Math.sin(az) * cosEl * dist, Math.sin(el) * dist + cz);
    const tgt = this._t.set(0, 0, cz);
    const camLocalX = pos.x;
    const camLocalY = pos.y;
    const camLocalZ = pos.z;
    pos.applyMatrix4(M);
    tgt.applyMatrix4(M);
    const cam = this.camera;
    cam.position.copy(pos);
    const fwd = this._f.subVectors(tgt, pos).normalize();
    const up = this._up.set(0, 0, 1);
    this._q.setFromAxisAngle(fwd, s.rollDeg * DEG);
    up.applyQuaternion(this._q);
    cam.up.copy(up);
    cam.lookAt(tgt);

    // near z analitycznej odległości do ringu (z halami K-7) i planety
    const r = Math.hypot(camLocalX, camLocalY);
    const dr = Math.max(L.radii.min - r, 0, r - L.radii.max - 9000);
    const dzr = Math.max(L.bounds.zMin - camLocalZ, 0, camLocalZ - L.bounds.zMax);
    const dRing = Math.hypot(dr, dzr);
    const dCenter = Math.hypot(camLocalX, camLocalY, camLocalZ - cz);
    const dPlanet = Math.max(1, dCenter - L.planetRadius);
    const target = Core3D.composerTarget;
    const vw = Math.max(1, target?.width || window.innerWidth);
    const vh = Math.max(1, target?.height || window.innerHeight);
    cam.fov = s.fovDeg * (1 - 0.12 * launch);
    cam.aspect = vw / vh;
    cam.near = Math.min(20000, Math.max(1, Math.min(dRing, dPlanet) * 0.35));
    cam.far = Math.max(cam.near * 1000, dCenter + L.radii.max + 90000);
    // start gry: menu zjeżdża w lewo, planeta wraca na środek kadru
    const shiftX = (s.shiftX + (s.focusShiftX - s.shiftX) * smooth01(this.focus)) * (1 - launch);
    cam.setViewOffset(vw, vh, -shiftX * vw, s.shiftY * (1 - launch) * vh, vw, vh);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // Ziemia: obrót i przesunięcie chmur, macierz siatka → ring
    o.spin += dt * s.earthSpin;
    o.cloudSpin += dt * s.cloudSpin;
    o.earth.rotation.y = o.spin;
    const shift = ((o.cloudSpin - o.spin) / (Math.PI * 2)) % 1;
    o.earthUniforms.uCloudShift.value = shift < 0 ? shift + 1 : shift;
    o.earthGroup.updateMatrix();
    o.earth.updateMatrix();
    o.atmosphere.updateMatrix();
    o.earthUniforms.uLocal.value.multiplyMatrices(o.earthGroup.matrix, o.earth.matrix);
    o.atmUniforms.uLocal.value.multiplyMatrices(o.earthGroup.matrix, o.atmosphere.matrix);

    ring.update(dt, { camera: cam, viewportHeight: vh, gameView: false });
    // lampy hal K-7: noc w cieniu planety
    const sd = ring.uniforms.uSunDir.value;
    for (const hall of ring.k7Halls) {
      if (!hall.root.visible) continue;
      const h = hall.frame.origin;
      const oz = -cz;
      const tt = -(h.x * sd.x + h.y * sd.y + oz * sd.z);
      let daylight = 1;
      if (tt > 0) {
        const d = Math.sqrt(Math.max(0, h.x * h.x + h.y * h.y + oz * oz - tt * tt));
        daylight = smooth01((d - (L.planetRadius - 500)) / 1300);
      }
      hall.update(dt, { daylight });
    }

    Core3D.renderBackdrop(cam);
    this.stats.frames++;
  }
}
