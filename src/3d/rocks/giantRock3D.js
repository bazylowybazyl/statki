// src/3d/rocks/giantRock3D.js
//
// Render olbrzymiej asteroidy (asteroidGiants.js): raymarching pola odległości
// z tekstury 3D w passie ortho gry (warstwa 0, kamera z góry).
//
//   uSdf   — siatka SDF (R8, wąskie pasmo ±BAND_VOXELS, 128 = powierzchnia),
//            ta sama tablica co na CPU (kolizje);
//   uLight — pieczone raz: R widoczność słońca (miękki cień przez bryłę), G AO,
//            B poświata złóż, A barwa złoża. Olbrzym się nie obraca, słońce
//            (środek układu) stoi → oświetlenie liczone na starcie; wnętrza
//            tuneli i jaskiń są CIEMNE (świecą tylko złoża i reflektory statku).
//
// Promień w ortho jest pionowy: marsz z góry pudła w dół po wartości SDF.
// PRZEKRÓJ (okno wokół statku pod stropem): w promieniu uCut.z promień
// startuje na wysokości uCutZ (nad płaszczyzną gry); jeśli startuje w skale,
// piksel to płaszczyzna cięcia (ciemny przekrój z obwódką ścian) — widać
// statek w tunelu i dno tunelu pod nim. Poza oknem strop zasłania wnętrze
// (tam można się schować). Głębia z punktu trafienia (gl_FragDepth) — kadłuby
// na z ≈ 0 chowają się pod stropem i widać je w oknie.
//
// Precyzja: mesh w pozycji świata (three składa modelViewMatrix w double),
// cały marsz w układzie olbrzyma (±30 tys. j.) — float32 wystarcza.
// Renderer: wyłącznie Core3D (AGENTS.md).

import * as THREE from 'three';
import { BAND_VOXELS } from '../../game/asteroidGiants.js';
import { SUN_SHADOW_GLSL, attachSunShadowUniforms } from '../sunShadowMask.js';
import { FIELD_LIGHTS_GLSL, attachFieldLightUniforms } from '../fieldLights3D.js';

const DEPOSIT_CAP = 16;
const CRATER_CAP = 64;

// Wspólne: próbka SDF w układzie olbrzyma (x, y gry, z do kamery).
const SDF_GLSL = /* glsl */`
uniform highp sampler3D uSdf;
uniform vec3 uExt;       // −ext = środek woksela 0 (układ gry)
uniform vec3 uGridN;     // wymiary siatki
uniform float uVoxel;
uniform float uBand;
vec3 giantUvw(vec3 g) {
  return (g + uExt + 0.5 * uVoxel) / (uGridN * uVoxel);
}
float giantSdf(vec3 g) {
  vec3 uvw = giantUvw(g);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return uBand;
  return (textureLod(uSdf, uvw, 0.0).r * 255.0 - 128.0) * (uBand / 127.0);
}
vec3 giantNormal(vec3 g, float e) {
  vec3 n = vec3(
    giantSdf(g + vec3(e, 0.0, 0.0)) - giantSdf(g - vec3(e, 0.0, 0.0)),
    giantSdf(g + vec3(0.0, e, 0.0)) - giantSdf(g - vec3(0.0, e, 0.0)),
    giantSdf(g + vec3(0.0, 0.0, e)) - giantSdf(g - vec3(0.0, 0.0, e))
  );
  float l = length(n);
  return l > 1e-6 ? n / l : vec3(0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Pieczenie światła (plaster po plastrze do WebGL3DRenderTarget)

const BAKE_VERTEX = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAKE_FRAGMENT = /* glsl */`
precision highp float;
precision highp sampler3D;
${SDF_GLSL}
uniform vec3 uLightN;
uniform float uSlice;
uniform vec3 uSunG;          // kierunek do słońca w układzie olbrzyma (gry)
uniform int uDepCount;
uniform vec4 uDep[${DEPOSIT_CAP}];     // xyz środek, w promień
uniform float uDepHue[${DEPOSIT_CAP}];
void main() {
  vec3 uvw = vec3(gl_FragCoord.xy / uLightN.xy, (uSlice + 0.5) / uLightN.z);
  vec3 g0 = uvw * uGridN * uVoxel - uExt - 0.5 * uVoxel;
  vec3 n = giantNormal(g0, uVoxel);
  // Teksel rzutowany na najbliższą powierzchnię: teksel w skale liczyłby cień
  // ze środka skały (widoczność 0) i ściemniał interpolację na powierzchni.
  vec3 g = g0 - n * giantSdf(g0);
  // Miękki cień słońca: marsz po SDF od punktu nad powierzchnią w stronę słońca.
  float vis = 1.0;
  float t = uVoxel * 1.5;
  vec3 o = g + n * uVoxel * 0.75;
  for (int i = 0; i < 48; i++) {
    vec3 q = o + uSunG * t;
    float h = giantSdf(q);
    // SDF jest obcięte do ±pasma: h = pasmo znaczy „daleko od skały”, nie
    // odległość — kara półcienia tylko przy geometrii (inaczej 6h/t malało
    // z t w pustce i cała oświetlona strona miała widoczność ~0,5).
    if (h < uBand * 0.95) vis = min(vis, 12.0 * h / t);
    if (vis < 0.01) break;
    t += clamp(h, uVoxel * 0.6, uVoxel * 6.0);
    if (t > uVoxel * 260.0 || q.z > uExt.z) break;
  }
  vis = clamp(vis, 0.0, 1.0);
  // AO: próbki wzdłuż normalnej na rosnących odległościach.
  float occ = 0.0;
  float w = 0.5;
  for (int k = 0; k < 5; k++) {
    float dist = uVoxel * (1.0 + float(k) * float(k) * 1.2);
    occ += w * clamp((dist - giantSdf(g + n * dist)) / dist, 0.0, 1.0);
    w *= 0.62;
  }
  float ao = clamp(1.0 - occ * 1.15, 0.0, 1.0);
  // Złoża: poświata w ich pobliżu (barwa w kanale A).
  float glow = 0.0;
  float hue = 0.0;
  for (int i = 0; i < ${DEPOSIT_CAP}; i++) {
    if (i >= uDepCount) break;
    vec4 dp = uDep[i];
    vec3 dd = g - dp.xyz;
    float e = exp(-dot(dd, dd) / (dp.w * dp.w));
    if (e > glow) hue = uDepHue[i];
    glow = max(glow, e);
  }
  gl_FragColor = vec4(vis, ao, glow, hue);
}
`;

// ---------------------------------------------------------------------------
// Raymarching

const GIANT_VERTEX = /* glsl */`
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GIANT_FRAGMENT = /* glsl */`
precision highp float;
precision highp sampler3D;
// three deklaruje je tylko w shaderze wierzchołków; uniform programu jest
// wspólny dla obu etapów (głębia i układ widoku punktu trafienia).
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
${SDF_GLSL}
uniform highp sampler3D uLight;
uniform highp sampler3D uNoise;
uniform vec3 uSunS;          // kierunek do słońca (scena)
uniform vec3 uSunColor;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBounce;
uniform vec4 uCut;           // xy środek okna (scena, układ olbrzyma), z promień, w miękkość
uniform float uCutZ;         // wysokość cięcia
uniform float uPxPerUnit;
uniform vec3 uRockA;         // skała jasna
uniform vec3 uRockB;         // skała ciemna
uniform vec3 uCapColor;      // przekrój
uniform float uFieldLightGain;
uniform float uDebugCut;
uniform int uCraterCount;
uniform vec4 uCraters[${CRATER_CAP}];   // xy środek (układ gry), z promień, w świeżość
varying vec3 vLocal;
${SUN_SHADOW_GLSL}
${FIELD_LIGHTS_GLSL}

// Scena ↔ olbrzym: y odwrócone (gra ma y w dół).
vec3 toG(vec3 s) { return vec3(s.x, -s.y, s.z); }
vec3 toS(vec3 g) { return vec3(g.x, -g.y, g.z); }

float cutTop(vec2 ps) {
  if (uCut.z <= 1.0) return 1e9;
  float rho = length(ps - uCut.xy);
  float k = smoothstep(uCut.z, uCut.z + uCut.w, rho);
  return k >= 1.0 ? 1e9 : mix(uCutZ, uExt.z + uVoxel * 2.0, k);
}

void main() {
  // Promień pionowy (kamera ortho z góry) przez (x, y) fragmentu.
  vec2 ps = vLocal.xy;
  vec3 gTop = toG(vec3(ps, 0.0));
  float zTop = uExt.z;
  float zc = cutTop(ps);
  bool inCut = zc < zTop;
  float z = min(zTop, zc);
  bool cap = false;
  bool hit = false;
  if (inCut && giantSdf(vec3(gTop.xy, z)) < 0.0) {
    cap = true;
    hit = true;
  } else {
    float zEnd = -uExt.z;
    for (int i = 0; i < 112; i++) {
      float d = giantSdf(vec3(gTop.xy, z));
      if (d < uVoxel * 0.06) { hit = true; break; }
      z -= max(d * 0.9, uVoxel * 0.3);
      if (z < zEnd) break;
    }
    if (hit) {
      // Doprecyzowanie (bisekcja między ostatnim krokiem a punktem).
      float lo = z;
      float hi = z + uVoxel * 0.6;
      for (int k = 0; k < 4; k++) {
        float m = (lo + hi) * 0.5;
        if (giantSdf(vec3(gTop.xy, m)) < 0.0) lo = m; else hi = m;
      }
      z = hi;
    }
  }
  if (!hit) discard;
  vec3 g = vec3(gTop.xy, z);
  vec3 sPos = toS(g);
  vec4 mv = modelViewMatrix * vec4(sPos, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  // Szum i pochodne PRZED rozgałęzieniem przekrój/powierzchnia (bez gradientów
  // w rozbieżnym przepływie). Poziom mip z rozmiaru piksela: objętość 64³
  // o okresie S ma teksel S/64 j.; z daleka drobny szum uśrednia się zamiast
  // dawać ziarno i mory.
  float pxW = 1.0 / max(uPxPerUnit, 1e-5);
  // Układ szumu obrócony względem osi: sieć węzłów szumu wartości nie układa się
  // w rzędy wzdłuż osi siatki (progi dawały „koraliki” w równych rzędach).
  vec3 gn = mat3(0.80, 0.36, -0.48, -0.60, 0.48, -0.64, 0.0, 0.80, 0.60) * g;
  vec4 n1 = textureLod(uNoise, gn / 3100.0, max(0.0, log2(pxW * 64.0 / 3100.0)));
  vec4 n2 = textureLod(uNoise, gn / 900.0 + 0.37, max(0.0, log2(pxW * 64.0 / 900.0)));
  vec4 n3 = textureLod(uNoise, gn / 260.0 + 0.71, max(0.0, log2(pxW * 64.0 / 260.0)));
  // Detal wypukłości: skala dobrana do zoomu (z daleka większe garby, z bliska drobne).
  // Z daleka tylko duże garby (drobny szum 260 j. dawał ziarno jak papier ścierny).
  float near = smoothstep(0.06, 0.3, uPxPerUnit);
  float detail = smoothstep(0.004, 0.05, uPxPerUnit);
  float hBump = (n2.r * 0.7 + n1.r * 0.3) * 160.0 * detail + n3.r * 50.0 * near;
  vec3 dpx = dFdx(mv.xyz);
  vec3 dpy = dFdy(mv.xyz);
  float dhx = dFdx(hBump);
  float dhy = dFdy(hBump);

  vec3 col;
  if (cap) {
    // Przekrój: ciemna płaszczyzna cięcia z warstwami i jaśniejszą obwódką
    // ścian (gdzie cięcie dochodzi do próżni).
    float dIn = -giantSdf(g);
    float rim = 1.0 - smoothstep(0.0, uVoxel * 1.4, dIn);
    float strata = 0.5 + 0.5 * sin(g.x * 0.0021 + g.y * 0.0013 + n1.r * 6.0);
    col = uCapColor * (0.75 + 0.35 * strata + 0.3 * n2.g) + vec3(0.035, 0.037, 0.04) * rim;
    col *= 1.0 - fieldDarkness() * 0.5;
    if (uDebugCut > 0.5) col = mix(col, vec3(0.6, 0.1, 0.1), 0.5);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // --- Powierzchnia ---
  vec3 nG = giantNormal(g, uVoxel);
  vec3 N = toS(nG);
  vec4 lt = textureLod(uLight, giantUvw(g), 0.0);
  float bakedSun = lt.r;
  float ao = lt.g;
  // Barwa: skała z plamami (szum w układzie olbrzyma), pył w zagłębieniach.
  // Szarości bazaltu i regolitu (bez brązu): ciemne łaty wietrzenia
  // kosmicznego, warstwy skały, jasne świeże odłamy i drobne jasne ziarna.
  vec3 albedo = mix(uRockB, uRockA, smoothstep(0.2, 0.8, n1.r * 0.5 + n2.r * 0.5));
  float strata = sin(dot(g, vec3(0.00093, 0.00061, 0.0036)) + n1.g * 6.0);
  albedo *= 0.9 + 0.11 * strata;
  albedo *= mix(0.64, 1.0, smoothstep(0.32, 0.62, n1.a));
  float fresh = smoothstep(0.58, 0.74, n2.a * 0.5 + n1.g * 0.3 + n3.a * 0.2) * smoothstep(0.55, 0.9, ao);
  albedo = mix(albedo, uRockA * 1.55, fresh * 0.55);
  albedo += uRockA * 0.8 * smoothstep(0.88, 0.97, n3.b * 0.7 + n2.r * 0.3) * near;
  // Duże regiony: chłodniejszy / cieplejszy odcień szarości (subtelnie).
  albedo *= mix(vec3(0.96, 0.99, 1.05), vec3(1.03, 1.0, 0.97), smoothstep(0.35, 0.65, n1.b));
  albedo *= 0.86 + 0.24 * n3.r;
  // Kratery: ciemniejsze dno, jasny wał, świeże — jasny wyrzut z promieniami.
  if (g.z > 0.0) {
    for (int i = 0; i < ${CRATER_CAP}; i++) {
      if (i >= uCraterCount) break;
      vec4 c = uCraters[i];
      vec2 dc = g.xy - c.xy;
      float rho = length(dc) / c.z;
      if (rho > 3.2) continue;
      float floorM = 1.0 - smoothstep(0.55, 0.9, rho);
      float rimM = exp(-(rho - 1.0) * (rho - 1.0) / 0.012);
      float ang = atan(dc.y, dc.x);
      float rays = 0.55 + 0.45 * sin(ang * 11.0 + c.w * 40.0) * sin(ang * 5.0 - c.w * 17.0);
      float ejecta = smoothstep(3.1, 1.05, rho) * step(1.0, rho) * c.w * c.w * rays;
      albedo *= 1.0 - 0.25 * floorM;
      albedo *= 1.0 + 0.45 * rimM + 0.9 * ejecta;
    }
  }
  albedo = mix(albedo * 0.55, albedo, smoothstep(0.25, 0.85, ao));
  // Detal wypukłości z szumu (gradient powierzchni) — przy zbliżeniu.
  mat3 V3 = mat3(viewMatrix);
  vec3 Nv = normalize(V3 * N);
  {
    vec3 r1 = cross(dpy, Nv);
    vec3 r2 = cross(Nv, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    if (abs(det) > 1e-12 && detail > 0.001) Nv = normalize(abs(det) * Nv - grad);
  }
  vec3 Lv = normalize(V3 * uSunS);
  vec3 Vv = vec3(0.0, 0.0, 1.0);
  float ndl = dot(Nv, Lv);
  float sunVis = bakedSun * sunVisibility();
  float fill = mix(0.22, 1.0, sunVisibility()) * (1.0 - fieldDarkness());
  float diffuse = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
  float up = clamp(Nv.z * 0.5 + 0.5, 0.0, 1.0);
  // Otoczenie: pył nad bryłą (z góry) — w tunelach i jaskiniach gaśnie z AO
  // i z brakiem słońca (wnętrze bez światła poza reflektorami i złożami).
  float open = smoothstep(0.05, 0.6, bakedSun) * 0.65 + 0.35 * ao;
  vec3 ambient = (uAmbientTop * (0.5 + 0.5 * up) + uAmbientBounce * max(0.0, -ndl)) * ao * open;
  col = albedo * (uSunColor * diffuse * sunVis + ambient * fill);
  vec3 Hh = normalize(Lv + Vv);
  col += uSunColor * pow(max(dot(Nv, Hh), 0.0), 18.0) * 0.03 * sunVis;
  if (uFieldLightCount > 0 && uFieldLightGain > 0.0) {
    vec3 fSpec;
    vec3 fDiff = fieldLightsShade(mv.xyz, Nv, Vv, 16.0, 0.05, fSpec);
    col += (albedo * fDiff * (0.4 + 0.6 * ao) + fSpec) * uFieldLightGain;
  }
  // Złoża: świecące plamy kryształu (cyjan) i uranu (zieleń) na ścianach.
  float glow = lt.b;
  if (glow > 0.01) {
    vec3 gc = mix(vec3(0.25, 0.75, 1.0), vec3(0.3, 1.0, 0.25), step(0.5, lt.a));
    float veins = smoothstep(0.55, 0.7, n2.b) + smoothstep(0.62, 0.8, n3.g) * 0.6;
    col += gc * glow * (0.08 + 1.6 * veins * glow);
  }
  if (uDebugCut > 1.5) {
    // Podgląd: 2 = słońce wypieczone, 3 = AO, 4 = normalna.
    col = uDebugCut < 2.5 ? vec3(bakedSun) : (uDebugCut < 3.5 ? vec3(ao) : N * 0.5 + 0.5);
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export const GIANT_LOOK = Object.freeze({
  rockA: [0.1, 0.102, 0.106],
  rockB: [0.034, 0.035, 0.038],
  cap: [0.016, 0.015, 0.014]
});

export class GiantRock3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene Core3D.scene
   * @param {THREE.WebGLRenderer} o.renderer Core3D.renderer
   * @param {import('../../game/asteroidGiants.js').GiantRock} o.giant gotowa siatka
   * @param {THREE.Texture} o.noise objętość szumu skał (bakeRockNoiseVolume)
   * @param {{x:number,y:number}} o.sun słońce w świecie gry
   * @param {number} [o.sunElevDeg]
   */
  constructor(o) {
    this.scene = o.scene;
    this.renderer = o.renderer;
    this.giant = o.giant;
    const { nx, ny, nz, ext } = this.giant.dims;
    const v = this.giant.plan.voxel;
    // Tekstura 3D: ta sama tablica co na CPU (wiersze nieparzyste — unpackAlignment 1).
    this.sdfTexture = new THREE.Data3DTexture(this.giant.grid, nx, ny, nz);
    this.sdfTexture.format = THREE.RedFormat;
    this.sdfTexture.type = THREE.UnsignedByteType;
    this.sdfTexture.minFilter = THREE.LinearFilter;
    this.sdfTexture.magFilter = THREE.LinearFilter;
    this.sdfTexture.wrapS = this.sdfTexture.wrapT = this.sdfTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.sdfTexture.unpackAlignment = 1;
    this.sdfTexture.generateMipmaps = false;
    this.sdfTexture.needsUpdate = true;
    const sdfUniforms = () => ({
      uSdf: { value: this.sdfTexture },
      uExt: { value: new THREE.Vector3(ext[0], ext[1], ext[2]) },
      uGridN: { value: new THREE.Vector3(nx, ny, nz) },
      uVoxel: { value: v },
      uBand: { value: BAND_VOXELS * v }
    });
    this.lightN = [Math.ceil(nx / 2), Math.ceil(ny / 2), Math.ceil(nz / 2)];
    this.lightTarget = new THREE.WebGL3DRenderTarget(this.lightN[0], this.lightN[1], this.lightN[2], {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false
    });
    const lt = this.lightTarget.texture;
    lt.minFilter = THREE.LinearFilter;
    lt.magFilter = THREE.LinearFilter;
    lt.generateMipmaps = false;
    lt.wrapS = lt.wrapT = lt.wrapR = THREE.ClampToEdgeWrapping;
    this.bakeMaterial = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      uniforms: {
        ...sdfUniforms(),
        uLightN: { value: new THREE.Vector3(...this.lightN) },
        uSlice: { value: 0 },
        uSunG: { value: new THREE.Vector3(1, 0, 0) },
        uDepCount: { value: 0 },
        uDep: { value: Array.from({ length: DEPOSIT_CAP }, () => new THREE.Vector4()) },
        uDepHue: { value: new Array(DEPOSIT_CAP).fill(0) }
      },
      depthTest: false,
      depthWrite: false
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: GIANT_VERTEX,
      fragmentShader: GIANT_FRAGMENT,
      uniforms: attachFieldLightUniforms(attachSunShadowUniforms({
        ...sdfUniforms(),
        uLight: { value: lt },
        uNoise: { value: o.noise },
        uSunS: { value: new THREE.Vector3(1, 0, 0) },
        uSunColor: { value: new THREE.Vector3(1.9, 1.8, 1.67) },
        uAmbientTop: { value: new THREE.Vector3(0.16, 0.18, 0.22) },
        uAmbientBounce: { value: new THREE.Vector3(0.1, 0.085, 0.07) },
        uCut: { value: new THREE.Vector4(0, 0, 0, 1) },
        uCutZ: { value: 300 },
        uPxPerUnit: { value: 1 },
        uRockA: { value: new THREE.Vector3(...GIANT_LOOK.rockA) },
        uRockB: { value: new THREE.Vector3(...GIANT_LOOK.rockB) },
        uCapColor: { value: new THREE.Vector3(...GIANT_LOOK.cap) },
        uFieldLightGain: { value: 1 },
        uDebugCut: { value: 0 },
        uCraterCount: { value: 0 },
        uCraters: { value: Array.from({ length: CRATER_CAP }, () => new THREE.Vector4()) }
      })),
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending
    });
    // Kratery planu (największe pierwsze) — jasne wyrzuty i wały w albedo.
    const craters = this.giant.plan.craters || [];
    this.material.uniforms.uCraterCount.value = Math.min(CRATER_CAP, craters.length);
    craters.slice(0, CRATER_CAP).forEach((c, i) => this.material.uniforms.uCraters.value[i].set(c.x, c.y, c.r, c.fresh ?? 0.5));
    // Pudło = dziedzina siatki (środki skrajnych wokseli ± pół woksela).
    const sx = nx * v; const sy = ny * v; const sz = nz * v;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    // Środek pudła w układzie olbrzyma (gra): −ext − v/2 + n·v/2.
    const cx = -ext[0] - v / 2 + sx / 2;
    const cy = -ext[1] - v / 2 + sy / 2;
    const cz = -ext[2] - v / 2 + sz / 2;
    geo.translate(cx, -cy, cz);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.layers.set(o.renderLayer ?? 0);
    this.mesh.name = `giant_${this.giant.plan.id}`;
    this.mesh.position.set(this.giant.x, -this.giant.y, 0);
    this.scene.add(this.mesh);
    // Przekrój: otwarcie 0..1 (łagodnie), środek i promień okna.
    this.cut = { open: 0, x: 0, y: 0, radius: 0, soft: 0, z: 300 };
    this.sunElevDeg = o.sunElevDeg ?? 24;
    this.bake(o.sun || { x: 0, y: 0 });
  }

  /** Pieczenie światła dla słońca w (sun.x, sun.y) świata gry. */
  bake(sun, sunElevDeg = this.sunElevDeg) {
    this.sunElevDeg = sunElevDeg;
    const dx = sun.x - this.giant.x;
    const dy = sun.y - this.giant.y;
    const l = Math.hypot(dx, dy) || 1;
    const el = sunElevDeg * Math.PI / 180;
    // Układ olbrzyma (gra: y w dół) i scena (y w górę).
    const gx = dx / l * Math.cos(el); const gy = dy / l * Math.cos(el); const gz = Math.sin(el);
    const bu = this.bakeMaterial.uniforms;
    bu.uSunG.value.set(gx, gy, gz);
    this.material.uniforms.uSunS.value.set(gx, -gy, gz);
    const deps = this.giant.plan.deposits || [];
    bu.uDepCount.value = Math.min(DEPOSIT_CAP, deps.length);
    for (let i = 0; i < DEPOSIT_CAP; i++) {
      const d = deps[i];
      if (d) {
        bu.uDep.value[i].set(d.x, d.y, d.z, d.r);
        bu.uDepHue.value[i] = d.hue || 0;
      }
    }
    const renderer = this.renderer;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMaterial);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const t0 = performance.now();
    try {
      for (let z = 0; z < this.lightN[2]; z++) {
        bu.uSlice.value = z;
        this.bakeMaterial.uniformsNeedUpdate = true;
        renderer.setRenderTarget(this.lightTarget, z);
        renderer.render(scene, cam);
      }
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      quad.geometry.dispose();
    }
    this.bakeMs = performance.now() - t0;
  }

  /**
   * Co klatkę: przekrój wokół statku pod stropem, uniformy światła.
   * @param {object} f { cam, viewW, viewH, dt, light (ROCK light: sunColor, ambient…) }
   * @param {{x:number,y:number,len:number}|null} focus statek gracza (przekrój)
   */
  update(f, focus = null) {
    const u = this.material.uniforms;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    u.uPxPerUnit.value = zoom;
    const c = this.cut;
    let want = 0;
    if (focus && this.giant.ready && this.giant.containsWorld(focus.x, focus.y, this.giant.band)) {
      // Okno otwiera się, gdy nad statkiem jest strop (tunel, jaskinia, nawis).
      if (this.giant.solidAbove(focus.x, focus.y, c.z)) want = 1;
    }
    const dt = Math.min(0.25, Math.max(0, f.dt || 0));
    c.open += (want - c.open) * (dt > 0 ? 1 - Math.exp(-dt / 0.28) : 1);
    if (focus) {
      c.x = focus.x - this.giant.x;
      c.y = focus.y - this.giant.y;
      const view = Math.min(f.viewW, f.viewH) / zoom;
      c.radius = Math.max((focus.len || 1800) * 1.25, view * 0.36);
      c.soft = c.radius * 0.14;
    }
    const r = c.radius * c.open;
    // Układ olbrzyma w scenie: y odwrócone.
    u.uCut.value.set(c.x, -c.y, r, Math.max(1, c.soft * c.open));
    u.uCutZ.value = c.z;
    if (f.light) {
      const L = f.light;
      const k = L.sunIntensity ?? 1.9;
      u.uSunColor.value.set(L.sunColor[0] * k, L.sunColor[1] * k, L.sunColor[2] * k);
      u.uAmbientTop.value.set(...L.ambientTop);
      u.uAmbientBounce.value.set(...L.ambientBounce);
    }
  }

  setVisible(v) { this.mesh.visible = !!v; }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.bakeMaterial.dispose();
    this.lightTarget.dispose();
    this.sdfTexture.dispose();
  }
}
