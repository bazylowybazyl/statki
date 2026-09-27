// Ringi-archetypy (Mars = ECUMENE, Jowisz = Fable) — shadery. Światło jak
// w silniku Halo (haloRingGLSL.js: cień planety i bryły ringu, niebo
// habitatu, światło planety) — hala K-7 i ring Ziemi świecą tym samym
// modelem. Pozycje: instancje i siatki w układzie lokalnym ringu (≤ 60 tys. j.),
// gl_Position przez modelViewMatrix (three składa go w double — ring stoi przy
// planecie miliony j. od początku świata; AGENTS.md, precyzja float32).
//
// Rodzaje materiału instancji (aInst.x):
//   0 — zwykła bryła (barwa instancji; aInst.z = połysk)
//   1 — budynek ECUMENE (siatka okien dema × 3, okna z ziarna instancji)
//   2 — światło (barwa HDR × aInst.z, bez cieniowania; aInst.w > 0 = miganie)
//   3 — budynek Fable (aInst.z = rodzaj budynku dema 0–8, okna per kondygnacja)
//   4 — płyty metalu (szwy, kratki, odcień płyty)
//   5 — radiator (ciemny, czerwony żar × aInst.z)
//   6 — woda (połysk słońca, fresnel nieba)
// Pułapki ANGLE (docs/PORT-halo-ring.md): bez wczesnego return w funkcjach
// z pętlą, mod() na liczbach całkowitych we float przez floor, bez słowa flat.
import {
  HALO_GLSL_COMMON,
  HALO_GLSL_FG,
  HALO_GLSL_FG_CLIP,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_TRANSIT
} from '../haloRingGLSL.js';

export const ARCH_GLSL_LIT = /* glsl */`
// Noc w punkcie: slonce pod lokalnym horyzontem (gora = od planety) albo
// punkt w cieniu planety. 0 dzien, 1 noc.
float archNight(vec3 p) {
  vec3 up = haloUp(p);
  float sunUp = dot(up, uSunDir);
  float vis = haloLuma(haloPlanetTransmit(p + up * 40.0, uSunDir));
  return 1.0 - smoothstep(-0.10, 0.18, sunUp) * vis;
}
// Cieniowanie: slonce (cien planety i bryly ringu), niebo habitatu, swiatlo
// planety, minimum nocy; gloss = polysk.
vec3 archShade(vec3 p, vec3 n, vec3 albedo, float gloss) {
  vec3 L = uSunDir;
  vec3 vis = haloSunVisibility(p + n * 3.0, L);
  float ndl = max(dot(n, L), 0.0);
  vec3 V = normalize(uCamLocal - p);
  vec3 H = normalize(L + V);
  float sp = gloss * pow(max(dot(n, H), 0.0), 40.0);
  vec3 direct = uSunColor * vis * ndl * (albedo + vec3(sp));
  vec3 amb = albedo * (haloSkyAmbient(p, n) + haloPlanetshine(p, n) + vec3(uNightAmbient));
  return direct + amb;
}
// Woda: ciemna toń, fresnel nieba, blysk slonca, zmarszczki w czasie.
vec3 archWater(vec3 p, vec3 n, vec2 q, vec3 deep, vec3 shallow, float depthMix) {
  float a = sin(q.x * 0.028 + q.y * 0.037 + uTime * 0.46);
  float b = cos(q.x * 0.047 - q.y * 0.024 - uTime * 0.31);
  vec3 up = haloUp(p);
  vec3 N = normalize(n + (vec3(a, b, a * b) * 0.024));
  vec3 V = normalize(uCamLocal - p);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 vis = haloSunVisibility(p + up * 5.0, uSunDir);
  float spec = pow(max(dot(N, normalize(uSunDir + V)), 0.0), 150.0);
  vec3 base = archShade(p, up, mix(shallow, deep, depthMix), 0.0);
  vec3 sky = uSkyTint * uSkyAmbient * 0.6 * smoothstep(-0.2, 0.3, dot(up, uSunDir));
  return base + sky * fres + uSunColor * vis * spec * 1.4;
}
// hasz bez sin() (stabilny dla duzych argumentow); ziarno instancji zawsze
// skwantowane do calkowitej — interpolowany atrybut „staly” rozni sie o ~1e-7
// miedzy pikselami, a hasz z duzym mnoznikiem zamienial to w szum okien
float archHash(vec2 p) { return haloHash12(p * 0.7071 + vec2(13.17, 71.3)); }
`;

// s na podlodze (kat x floorMid) — wyciecia tranzytow.
export const ARCH_GLSL_SABS = /* glsl */`
float archSAbs(vec3 p) {
  float th = atan(p.y, p.x);
  th += th < 0.0 ? HALO_TAU : 0.0;
  return th * uFloorDims.z;
}
`;

// ---------------------------------------------------------------------------
// Instancje (skrzynki, walce, korony drzew…): bryła jednostkowa z podstawą
// na y = 0 albo środkiem w 0; ziarno, rodzaj i parametry w aInst.
export const ARCH_INSTANCED_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
attribute vec4 aInst;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vScale;
varying vec4 vInst;
varying vec3 vCol;
void main() {
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 lp = im * vec4(position, 1.0);
  vec3 sc = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vN = normalize(mat3(im) * (normal / max(sc * sc, vec3(1e-6))));
  vPos = lp.xyz;
  vObj = position;
  vObjN = normal;
  vScale = sc;
  vInst = aInst;
  vec3 c = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  c = instanceColor;
#endif
#ifdef USE_COLOR
  c *= color.rgb;
#endif
  vCol = c;
  gl_Position = projectionMatrix * modelViewMatrix * lp;
}
`;

export const ARCH_INSTANCED_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
${ARCH_GLSL_LIT}
varying vec3 vPos;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vScale;
varying vec4 vInst;
varying vec3 vCol;

// wspolrzedne na scianie bryly: (poziomo, pionowo) w j. swiata
vec2 archFaceCoord() {
  return abs(vObjN.x) > 0.5 ? vec2(vObj.z * vScale.z, vObj.y * vScale.y) : vec2(vObj.x * vScale.x, vObj.y * vScale.y);
}

// Okna ECUMENE (makeBuildingMaterial dema, x 3).
vec3 archEcumeneFacade(vec3 albedo, float night, float dist, float seedI, float seed, inout vec3 emit) {
  float face = 1.0 - step(0.5, abs(vObjN.y));
  vec2 wp = archFaceCoord();
  vec2 cell = wp / vec2(22.5, 15.6);
  vec2 edge = abs(fract(cell) - 0.5);
  vec2 aa = max(fwidth(cell), vec2(0.015));
  vec2 wm = 1.0 - smoothstep(vec2(0.28) - aa, vec2(0.28) + aa, edge);
  float windowMask = wm.x * wm.y * face;
  float live = step(0.61, archHash(floor(cell) + vec2(seedI * 0.37, seedI * 1.91)));
  float detailFade = 1.0 - smoothstep(2700.0 * uDetailScale, 17400.0 * uDetailScale, dist);
  float lightMask = mix(0.058 * face, windowMask * live, detailFade);
  vec3 winCol = mix(uHdrWarm, uHdrCool, step(0.72, seed));
  vec3 a = albedo * mix(0.47, 1.0, smoothstep(0.0, 0.4, vObj.y));
  a = mix(a, a * 0.22, windowMask * detailFade * 0.72);
  float floorLine = 1.0 - smoothstep(0.0, 0.07, abs(fract(wp.y / 15.6) - 0.5));
  a += floorLine * 0.018 * face * detailFade;
  emit += winCol * lightMask * (0.45 + 0.85 * night) * uLayers.y;
  return a;
}

// Budynki Fable (createBuildingMaterial dema, x 3). kind: 0 domy, 1 bloki,
// 2 wieze, 3 hale przemyslowe, 4 magazyny, 5 wieze tech, 6 hale portu,
// 7 hale hydroponiczne, 8 walce (zbiorniki, kominy, iglice).
vec3 archFableBuilding(vec3 albedo, float kind, float seedI, float seed, float night, inout vec3 emit) {
  float hWorld = vObj.y * vScale.y;
  vec3 a = albedo * (0.5 + 0.5 * smoothstep(0.0, 66.0, hWorld));
  float lightsOn = uLayers.y * (0.05 + 0.95 * night);
  bool isK1 = abs(kind - 1.0) < 0.5;
  bool isK2 = abs(kind - 2.0) < 0.5;
  bool isK3 = abs(kind - 3.0) < 0.5;
  bool isK4 = abs(kind - 4.0) < 0.5;
  bool isK5 = abs(kind - 5.0) < 0.5;
  bool isK6 = abs(kind - 6.0) < 0.5;
  bool isK7 = abs(kind - 7.0) < 0.5;
  bool isK8 = abs(kind - 8.0) < 0.5;
  if (vObjN.y > 0.5) {
    float rp = step(0.72, archHash(floor(vObj.xz * vScale.xz / 15.0) + seedI * 0.1));
    a *= 0.78 - 0.3 * rp;
  } else if (kind < 7.5 && !isK6) {
    vec2 fc = archFaceCoord();
    float band = 0.9 + 0.1 * step(0.5, fract(hWorld / 12.0));
    float panel = 0.92 + 0.08 * archHash(floor(fc / 18.0) + seedI * 0.013);
    a *= band * panel;
  }
  if (abs(vObjN.y) < 0.5 && kind < 6.5) {
    bool xFace = abs(vObjN.x) > abs(vObjN.z);
    float hc = xFace ? vObj.z * vScale.z : vObj.x * vScale.x;
    float faceId = xFace ? (vObjN.x > 0.0 ? 0.0 : 1.0) : (vObjN.z > 0.0 ? 2.0 : 3.0);
    float floorH = (isK2 || isK5) ? 12.0 : (isK3 || isK4) ? 21.0 : 10.2;
    float colW = (isK3 || isK4) ? 18.0 : 9.0;
    float fy = hWorld / floorH;
    float fx = hc / colW;
    vec2 wid = vec2(floor(fx), floor(fy));
    vec2 wf = vec2(fract(fx), fract(fy));
    float winMask = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.25, wf.y) * step(wf.y, 0.72);
    float thr = 0.55 + 0.3 * (1.0 - night);
    float lit = step(thr, archHash(wid + vec2(seedI * 0.97 + faceId * 7.0, seedI * 0.31)));
    float warmSel = archHash(vec2(seedI * 0.31 + faceId, kind));
    vec3 wc = mix(vec3(1.0, 0.78, 0.5), vec3(0.66, 0.84, 1.0), step(0.62, warmSel));
    if (isK5) wc = vec3(0.45, 0.85, 1.0);
    if (isK3 || isK4) wc = vec3(1.0, 0.62, 0.28);
    float inten = isK2 ? 1.0 : isK5 ? 1.2 : isK1 ? 0.8 : kind < 0.5 ? 0.6 : 0.7;
    float fw = fwidth(fx) + fwidth(fy);
    float farBlend = smoothstep(0.3, 1.4, fw);
    float avgLit = 0.28 * (1.0 - thr) * 2.2;
    float w = mix(winMask * lit, avgLit * (0.6 + 0.6 * archHash(floor(wid / 3.0) + seedI * 0.011)), farBlend);
    emit += wc * 1.25 * w * inten * lightsOn;
    emit += vec3(1.0, 0.85, 0.6) * step(hWorld, 3.6) * 0.35 * lightsOn * (1.0 - farBlend);
  }
  if (isK7) {
    float g = 0.5 + 0.5 * step(0.5, fract(vObj.x * vScale.x / 12.0));
    emit += vec3(1.0, 0.45, 0.85) * g * 0.55 * (0.3 + 0.7 * night) * uLayers.y;
  }
  if (isK8) {
    float ringMask = step(0.9, vObj.y) * step(vObj.y, 0.94);
    emit += vec3(1.3, 0.45, 0.06) * ringMask * uLayers.y;
  }
  if (isK3 && vObjN.y > 0.5) {
    float v = step(0.85, archHash(floor(vObj.xz * vScale.xz / 27.0) + seedI * 0.03));
    emit += vec3(1.0, 0.8, 0.5) * v * 0.6 * lightsOn;
  }
  if ((isK2 || isK5) && vObjN.y > 0.5) {
    float blink = step(0.5, fract(uTime * 0.7 + seed * 5.0));
    float c = 1.0 - smoothstep(0.08, 0.14, length(vObj.xz));
    emit += vec3(1.3, 0.16, 0.06) * blink * c * 2.0 * uLayers.y;
  }
  return a;
}

// Plyty metalu: podzial na plyty (szwy, odcien, kratki wentylacyjne) na
// wspolrzednych sciany w j. swiata — jak tekstury paneli dem.
vec3 archPanels(vec3 albedo, float seedI) {
  vec2 fc = abs(vObjN.y) > 0.5 ? vObj.xz * vScale.xz : archFaceCoord();
  vec2 big = fc / vec2(126.0, 96.0);
  vec2 id = floor(big);
  vec2 f = fract(big);
  float tint = archHash(id + seedI * 0.13);
  vec3 a = albedo * (0.86 + 0.28 * tint);
  vec2 sm = min(f, 1.0 - f) * vec2(126.0, 96.0);
  float seam = 1.0 - smoothstep(0.0, 3.0, min(sm.x, sm.y));
  a *= 1.0 - 0.45 * seam;
  float vent = step(0.72, archHash(id + 3.7)) * step(0.3, f.x) * step(f.x, 0.62) * step(0.3, f.y) * step(f.y, 0.55);
  vent *= step(0.5, fract(f.y * 22.0));
  a *= 1.0 - 0.55 * vent;
  return a;
}

void main() {
  haloFgClip(vPos);
  vec3 n = normalize(vN);
  float kind = floor(vInst.x + 0.5);
  float seedI = floor(vInst.y * 1000.0 + 0.5);
  float seed = seedI / 1000.0;
  vec3 albedo = vCol;
  vec3 emit = vec3(0.0);
  vec3 col;
  float dist = length(uCamLocal - vPos);
  if (kind > 1.5 && kind < 2.5) {
    // swiatlo: HDR bez cieniowania (miganie: faza w aInst.w > 0)
    float blink = vInst.w > 0.0 ? 0.35 + 0.65 * step(0.5, fract(uTime * 0.9 + vInst.w * 4.0)) : 1.0;
    col = vCol * vInst.z * blink;
  } else if (kind > 5.5 && kind < 6.5) {
    col = archWater(vPos, n, vPos.xy + vPos.z, vec3(0.018, 0.092, 0.093), vec3(0.06, 0.15, 0.15), 0.6);
  } else {
    float night = archNight(vPos);
    float gloss = 0.0;
    if (kind < 0.5) {
      gloss = vInst.z;
    } else if (kind < 1.5) {
      albedo = archEcumeneFacade(albedo, night, dist, seedI, seed, emit);
      gloss = 0.35;
    } else if (kind < 3.5) {
      albedo = archFableBuilding(albedo, floor(vInst.z + 0.5), seedI, seed, night, emit);
      gloss = 0.25;
    } else if (kind < 4.5) {
      albedo = archPanels(albedo, seedI);
      gloss = 0.3;
    } else {
      // radiator: ciemne lamele, czerwony zar
      float fin = 0.8 + 0.2 * step(0.5, fract(vObj.x * vScale.x / 12.0));
      albedo *= fin;
      emit += vec3(0.55, 0.08, 0.02) * vInst.z;
    }
    col = archShade(vPos, n, albedo, gloss) + emit;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Pasy wokół ringu z teksturą płyt (kadłub, ściany Fable; powłoka ECUMENE):
// mapa sRGB + mapa emisji (okna zamieszkanych ścian), wycięcia tranzytów.
export const ARCH_STRIP_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
varying vec3 vPos;
varying vec3 vN;
varying vec2 vUv;
#ifdef ARCH_ATLAS
attribute float aAtlas;     // polowa atlasu: 0 lewa, 1 prawa
varying float vAtlas;
#endif
void main() {
  vPos = position;
  vN = normal;
  vUv = uv;
#ifdef ARCH_ATLAS
  vAtlas = aAtlas;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ARCH_STRIP_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
${HALO_GLSL_TRANSIT}
${ARCH_GLSL_LIT}
${ARCH_GLSL_SABS}
uniform sampler2D uMap;
uniform sampler2D uEmap;
uniform vec3 uTint;
uniform float uEmitGain;
uniform float uVarScale;
varying vec3 vPos;
varying vec3 vN;
varying vec2 vUv;
#ifdef ARCH_ATLAS
varying float vAtlas;
#endif
// atlas dwoch tekstur (kadlub | sciany): powtorzenie przez fract i gradient
// z niezawinietych UV (bez szwow mipmap na granicy powtorzen)
vec4 archStripTex(sampler2D t, vec2 uv) {
#ifdef ARCH_ATLAS
  vec2 a = vec2(fract(uv.x) * 0.5 + floor(vAtlas + 0.5) * 0.5, fract(uv.y));
  return textureGrad(t, a, dFdx(uv) * vec2(0.5, 1.0), dFdy(uv) * vec2(0.5, 1.0));
#else
  return texture2D(t, uv);
#endif
}
void main() {
  if (haloInTransitCut(archSAbs(vPos), vPos.z)) discard;
  haloFgClip(vPos);
  vec3 n = normalize(vN);
  vec3 albedo = archStripTex(uMap, vUv).rgb * uTint;
  // wielkoskalowa zmiennosc odcienia (addWorldVariation dema)
  float wv = haloHash12(floor(vPos.xy / uVarScale + vPos.z / (uVarScale * 1.4)));
  albedo *= 1.0 + (wv - 0.5) * 0.3;
  float night = archNight(vPos);
  vec3 emit = archStripTex(uEmap, vUv).rgb * uEmitGain * (0.25 + 0.75 * night) * uLayers.y;
  gl_FragColor = vec4(archShade(vPos, n, albedo, 0.3) + emit, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Szkło kopuł (instancje półkul): fresnel, odbicie nieba, blask słońca,
// nocna poświata wnętrza. Przezroczyste, bez zapisu głębi.
export const ARCH_GLASS_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
varying vec3 vPos;
varying vec3 vN;
varying vec3 vCol;
varying float vH;
void main() {
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 lp = im * vec4(position, 1.0);
  vec3 sc = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vN = normalize(mat3(im) * (normal / max(sc * sc, vec3(1e-6))));
  vPos = lp.xyz;
  vH = position.y;
  vec3 c = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  c = instanceColor;
#endif
  vCol = c;
  gl_Position = projectionMatrix * modelViewMatrix * lp;
}
`;

export const ARCH_GLASS_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
${ARCH_GLSL_LIT}
uniform float uGlassAlpha;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vCol;
varying float vH;
void main() {
  haloFgClip(vPos);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamLocal - vPos);
  vec3 L = uSunDir;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 vis = haloSunVisibility(vPos + N * 5.0, L);
  float day = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  float night = archNight(vPos);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 160.0) * 2.5;
  float band = 0.5 + 0.5 * sin(vH * 6.0 + uTime * 0.3);
  vec3 col = vCol * (0.05 + 0.3 * fres) * (0.25 + 0.75 * day) * uSunColor * max(vis, vec3(0.2));
  col += uSunColor * vis * spec;
  col += uHdrWarm * (0.16 + 0.05 * band) * night * uLayers.y * (1.0 - 0.6 * fres);
  float alpha = uGlassAlpha + 0.5 * fres + spec * 0.4 + 0.1 * night * uLayers.y;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
}
`;

// Kratownice kopuł (linie): barwa × światło otoczenia, bez cieni.
export const ARCH_LINE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const ARCH_LINE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
${ARCH_GLSL_LIT}
uniform vec3 uLineColor;
uniform float uLineAlpha;
varying vec3 vPos;
void main() {
  haloFgClip(vPos);
  vec3 up = haloUp(vPos);
  vec3 c = archShade(vPos, up, uLineColor, 0.0) + uLineColor * 0.08;
  gl_FragColor = vec4(c, uLineAlpha);
}
`;

// ---------------------------------------------------------------------------
// Światła pozycyjne (punkty): rozmiar w j. świata, miganie z fazą (faza < 0,25
// = stałe), zanik z odległością (jak navLights dema Fable).
export const ARCH_POINTS_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
attribute vec3 aColor;
attribute vec2 aLight;     // rozmiar [j.], faza
uniform float uPointScale; // wysokosc bufora * 0,5 * projectionMatrix[1][1]
varying vec3 vCol;
varying float vBlink;
varying vec3 vPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float phase = aLight.y;
  float blink = 0.35 + 0.65 * step(0.5, fract(uTime * 0.9 + phase * 4.0));
  blink = mix(1.0, blink, step(0.25, phase));
  vBlink = blink;
  vCol = aColor;
  vPos = position;
  float ps = aLight.x * uPointScale / max(-mv.z, 1.0);
  gl_PointSize = clamp(ps, 1.5, 24.0) * (0.8 + 0.2 * blink);
  gl_Position = projectionMatrix * mv;
}
`;
export const ARCH_POINTS_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
varying vec3 vCol;
varying float vBlink;
varying vec3 vPos;
void main() {
  haloFgClip(vPos);
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.15, r);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * (0.9 + 0.6 * vBlink) * a * uLayers.y, a);
}
`;
