// Habitat = JEDNA ciągła powierzchnia: CDLOD na instancjach (2 draw calle
// niezależnie od zoomu) + mapy z bake'u + detal z kafelkowych tekstur.
//
// Siatka węzła: gridDiv × gridDiv komórek. Współrzędne węzłów liczone
// w całkowitych jednostkach najdrobniejszej siatki (dokładne we float32),
// więc wspólne wierzchołki sąsiadów wychodzą identyczne — bez pęknięć.
// Morphing kaskadowy: węzeł narysowany drobniej niż trzeba (dziecko poza
// zasięgiem swojego LOD) domorfowuje się w shaderze do grubszej siatki, więc
// wybór może zawsze dzielić węzeł na cztery i nie ma twardych cięć LOD.
//
// Wierzchołki liczone względem kamery (RTE): kąt od kąta odniesienia blisko
// kamery, przesunięcie do kamery policzone w double na CPU. Bez tego ring
// o promieniu 43 tys. j. drżałby przy ujęciach z 20 j. nad ziemią.
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_PORTSITES,
  HALO_GLSL_RTE,
  HALO_GLSL_TRANSIT
} from './haloRingGLSL.js';
import { HALO_HDR, HALO_ROOF, HALO_TERRAIN } from './haloRingConfig.js';
import { haloDetailScales, haloCloudScales } from './haloRingDetail.js';
import { HALO_GLSL_INDKIT } from './haloRingIndustryKit.js';

const MAX_LOD_UNIFORM = 12;

// Wspólne próbkowanie map i detalu (vertex + fragment + chmury).
export const HALO_GLSL_SURFACE = /* glsl */`
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform sampler2D uMapC;
uniform vec4 uMapSize;       // w, h, 1/w, 1/h
uniform sampler2D uDetail1;
uniform sampler2D uDetail2;
uniform vec4 uDetailN;       // okresy kafli detalu [j.]
uniform vec4 uDetailOff;     // fract(s_ref / okres) dla kazdej skali
uniform vec4 uCloudS0;       // okresy chmur w s (4 pierwsze)
uniform vec4 uCloudT0;       // okresy chmur w t
uniform vec4 uCloudOff0;     // fract(s_ref / okres_s)
uniform vec4 uGridInfo;      // ds, dt (j. na komorke najdrobniejszej), Ns, refS
uniform vec4 uVarN;          // okresy tekstur zmiennosci barw [j.]
uniform vec4 uVarOff;
uniform float uPatT[8];      // wzory: okres L/n (0-5 miasto, 6 komorka dachu, 7 dzialka)
uniform float uPatF[8];      // fract(s_ref / okres)
uniform float uPatI[8];      // floor(s_ref / okres) mod n
uniform float uPatN[8];      // n (okresy na obwod)

// Reszta z dzielenia liczb calkowitych zapisanych we float, odporna na
// przyblizone dzielenie w ANGLE/D3D (mod(32, 16) potrafi dac 16).
float haloWrapI(float x, float n) {
  return x - n * floor((x + 0.5) / n);
}
// Komorka wzoru zakotwiczona w swiecie (nie w kamerze): id mod n, ulamek.
vec2 haloPat(int k, float sRel) {
  float c = sRel / uPatT[k] + uPatF[k];
  float fl = floor(c);
  return vec2(haloWrapI(fl + uPatI[k], uPatN[k]), c - fl);
}
vec4 haloVar(int k, float sRel, float t) {
  float T = uVarN[k];
  return texture(uDetail2, vec2(sRel / T + uVarOff[k], t / T));
}

vec2 haloMapUV(float sAbs, float t) {
  return vec2(sAbs / uFloorDims.x, t / uFloorDims.y);
}
// detal wysokosci: 0 = gory (ridged), 1 = rownina; zwraca (h, dh/ds, dh/dt).
// Petle rozwiniete: dynamiczne indeksowanie wektorow ANGLE/D3D emuluje (wolno).
vec3 haloDetailOct(float sRel, float t, float T, float off, float amp, float ridgeK, float lodBias) {
  vec2 uv = vec2(sRel / T + off, t / T);
  float fade = 1.0 - smoothstep(0.35, 0.9, lodBias / T);
  vec4 d1 = textureLod(uDetail1, uv, max(0.0, log2(max(lodBias * 1024.0 / T, 1.0)) - 0.5));
  float hN = mix(d1.r, d1.a * 1.3, ridgeK);
  return vec3(hN, d1.g / T, d1.b / T) * amp * fade;
}
vec3 haloDetailHeight(float sRel, float t, float mountain, float flatten, float lodBias) {
  vec3 acc = haloDetailOct(sRel, t, uDetailN.x, uDetailOff.x, mix(2.6, 20.0, mountain), mountain, lodBias);
  acc += haloDetailOct(sRel, t, uDetailN.y, uDetailOff.y, mix(1.0, 5.0, mountain), mountain, lodBias);
  acc += haloDetailOct(sRel, t, uDetailN.z, uDetailOff.z, mix(0.34, 1.2, mountain), 0.0, lodBias);
  acc += haloDetailOct(sRel, t, uDetailN.w, uDetailOff.w, mix(0.12, 0.3, mountain), 0.0, lodBias);
  return acc * (1.0 - flatten);
}
`;

// Pokrycie chmur: te same kafelkowe tekstury, wiatr wzdluz wstegi. Wspolne
// dla cienia chmur na terenie i samej warstwy chmur (spojnosc cieni).
export const HALO_GLSL_CLOUDCOVER = /* glsl */`
${HALO_GLSL_PORTSITES}
float haloCloudOct(float sRel, float t, float S, float T, float off, float windK, float salt) {
  float wind = uTime * uCloudParams.z * windK;
  vec2 uv = vec2((sRel + wind) / S + off, t / T + salt);
  return texture(uDetail2, uv).b * 0.5 + 0.5;
}
float haloCloudCover(float sRel, float t, float moist, int octaves) {
  float sum = 0.55 * haloCloudOct(sRel, t, uCloudS0.x, uCloudT0.x, uCloudOff0.x, 1.0, 0.0);
  float norm = 0.55;
  if (octaves > 1) { sum += 0.275 * haloCloudOct(sRel, t, uCloudS0.y, uCloudT0.y, uCloudOff0.y, 1.35, 0.37); norm += 0.275; }
  if (octaves > 2) { sum += 0.1375 * haloCloudOct(sRel, t, uCloudS0.z, uCloudT0.z, uCloudOff0.z, 1.7, 0.74); norm += 0.1375; }
  if (octaves > 3) { sum += 0.06875 * haloCloudOct(sRel, t, uCloudS0.w, uCloudT0.w, uCloudOff0.w, 2.05, 1.11); norm += 0.06875; }
  float c = sum / norm;
  float cover = mix(0.62, 0.44, clamp(moist, 0.0, 1.0)) - uCloudParams.w;
  // nad dokami przejasnienie (hala i zatoki przechodza przez warstwe chmur)
  float clear = haloPortPad(sRel + uRefBasis.w, t, uFloorDims.x, 1400.0, 1400.0);
  return smoothstep(cover, cover + 0.16, c) * (1.0 - clear);
}
`;

const TERRAIN_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
uniform vec2 uLodMorph[${MAX_LOD_UNIFORM}];
attribute vec4 iNode;          // s0 (wzgl. refS), t0, 0, lod - w jednostkach najdrobniejszej siatki
varying vec3 vRel;
varying vec2 vST;              // sRel [j.], t [j.]
varying vec2 vUvMap;
varying float vH;
varying float vSpacing;

float macroHeightAt(vec2 gp, float spacingWorld, out vec2 uvMap) {
  float sAbs = (gp.x + uGridInfo.w) * uGridInfo.x;
  float t = gp.y * uGridInfo.y;
  uvMap = haloMapUV(sAbs, t);
  float texel = uFloorDims.x * uMapSize.z;
  float lod = max(0.0, log2(max(spacingWorld / texel, 1.0)));
  return textureLod(uMapA, uvMap, lod).r;
}

vec3 relAt(vec2 gp, float h) {
  float sRel = gp.x * uGridInfo.x;
  float t = gp.y * uGridInfo.y;
  float dTheta = sRel / uFloorDims.z;
  float dr = (uFloorLine.x - uFloorDims.z) + uFloorLine.z * t + uHabitat.x * h;
  float z = uFloorLine.y + uFloorLine.w * t;
  return haloRelFromPolar(dTheta, dr, z);
}

void main() {
  float k = iNode.w;
  float spacing = exp2(k);
  vec2 gp = iNode.xy + position.xy * spacing;
  vec2 uvTmp;
  float cellWorld = max(uGridInfo.x, uGridInfo.y);
  // wysokosc do dystansu: staly gruby mip (zalezy tylko od pozycji), zeby
  // wspolne wierzcholki sasiadow o roznym LOD liczyly ten sam morph
  float h0 = max(macroHeightAt(gp, cellWorld * 64.0, uvTmp), 0.0);
  float d = length(relAt(gp, h0));
  // kaskadowy morph CDLOD: nieparzyste wierzcholki suna do parzystych
  float m = 0.0;
  float kFinal = k;
  for (int j = 0; j < 4; j++) {
    int kk = int(k) + j;
    if (kk >= ${MAX_LOD_UNIFORM}) break;
    vec2 range = uLodMorph[kk];
    m = clamp((d - range.x) / max(range.y - range.x, 1.0), 0.0, 1.0);
    float cell = exp2(float(kk));
    // parzystosc z indeksu BEZWZGLEDNEGO (gp jest wzgledem refS; suma
    // dwoch liczb calkowitych < 2^24 jest we float dokladna)
    vec2 idx = (gp + vec2(uGridInfo.w, 0.0)) / cell;
    vec2 odd = idx - 2.0 * floor(idx * 0.5 + 0.25);
    gp -= odd * m * cell;
    kFinal = float(kk);
    if (m < 1.0) break;
  }
  vec2 uvMap;
  // mip i detal z POZIOMU KONCOWEGO (identyczny po obu stronach granicy LOD)
  float effSpacing = exp2(kFinal) * (1.0 + m) * cellWorld;
  float hm = macroHeightAt(gp, effSpacing, uvMap);
  vec4 C = textureLod(uMapC, uvMap, 2.0);
  float mountain = smoothstep(60.0, 380.0, hm) * (1.0 - C.g);
  float flatten = clamp(C.g * 0.92 + C.b, 0.0, 1.0);
  float sRel = gp.x * uGridInfo.x;
  float t = gp.y * uGridInfo.y;
  vec3 det = haloDetailHeight(sRel, t, mountain, flatten, effSpacing * 2.0);
  float h = hm + det.x * smoothstep(-2.0, 3.0, hm);
  float hDisp = max(h, 0.0);
  vec3 rel = relAt(gp, hDisp);
  vRel = rel;
  vST = vec2(sRel, t);
  vUvMap = uvMap;
  vH = h;
  vSpacing = effSpacing;
  gl_Position = haloProjectRel(rel);
}
`;

const TERRAIN_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
${HALO_GLSL_SURFACE}
${HALO_GLSL_CLOUDCOVER}
${HALO_GLSL_INDKIT}
${HALO_GLSL_TRANSIT}
uniform float uExposedLines;
varying vec3 vRel;
varying vec2 vST;
varying vec2 vUvMap;
varying float vH;
varying float vSpacing;

float aaStep(float edge, float x, float w) {
  return smoothstep(edge - w, edge + w, x);
}

// Cien terenu z mapy wysokosci: marsz wzdluz rzutu slonca na plaszczyzne
// styczna (kroki rosna geometrycznie do ~3 tys. j.) - gory rzucaja cien bez
// map cieni, ta sama analityka co reszta modelu swiatla.
float haloTerrainShadow(float sRel, float t, float h, vec3 L, vec3 up, vec3 eTh, float Tz) {
  float cz = dot(L, up);
  if (cz <= 0.0) return 0.0;
  vec3 Lt = L - up * cz;
  float lt = length(Lt);
  if (lt < 1e-4) return 1.0;
  vec2 dir = vec2(dot(Lt, eTh), Lt.z / max(Tz, 0.2)) / lt;
  float rise = cz / lt;
  float vis = 1.0;
  float stepLen = 28.0;
  float x = 0.0;
  float texel = uFloorDims.x * uMapSize.z;
  for (int i = 0; i < 7; i++) {
    x += stepLen;
    vec2 st = vec2(sRel, t) + dir * x;
    if (st.y < 0.0 || st.y > uFloorDims.y) break;
    float lod = max(0.0, log2(max(stepLen * 0.5 / texel, 1.0)));
    float hs = max(textureLod(uMapA, haloMapUV(st.x + uRefBasis.w, st.y), lod).r, 0.0);
    float rayH = h + x * rise;
    vis = min(vis, smoothstep(-12.0 - x * 0.015, 10.0 + x * 0.02, rayH - hs));
    stepLen *= 1.9;
  }
  return vis;
}

void main() {
  vec3 rel = vRel;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  vec3 p = uCamLocal + rel;
  float sRel = vST.x;
  float t = vST.y;
  // wylot tranzytu przez ring (tunel w plycie podlogi — bryly w megastrukturze)
  if (haloInTransitCut(sRel + uRefBasis.w, p.z)) discard;
  vec2 uv = vUvMap;
  vec4 A = texture(uMapA, uv);
  vec4 Bw = texture(uMapB, uv);
  vec4 C = texture(uMapC, uv);
  float hMap = A.r;
  float riverDist = A.g;
  float moist = A.b;
  float temp = A.a;
  float forest = C.r;
  float urban = C.g;
  float exposed = C.b;
  float rockMap = C.a;

  // makro-normalna z mapy (roznice centralne na tekselu bazowym)
  float du = uMapSize.z;
  float dv = uMapSize.w;
  float hE = texture(uMapA, uv + vec2(du, 0.0)).r;
  float hW = texture(uMapA, uv - vec2(du, 0.0)).r;
  float hN = texture(uMapA, uv + vec2(0.0, dv)).r;
  float hS = texture(uMapA, uv - vec2(0.0, dv)).r;
  float dhs = (max(hE, 0.0) - max(hW, 0.0)) / (2.0 * du * uFloorDims.x);
  float dht = (max(hN, 0.0) - max(hS, 0.0)) / (2.0 * dv * uFloorDims.y);

  float mountain = smoothstep(60.0, 380.0, hMap) * (1.0 - urban);
  float flatten = clamp(urban * 0.92 + exposed, 0.0, 1.0);
  float pix = max(dist * 0.0012, 0.02);
  vec3 det = haloDetailHeight(sRel, t, mountain, flatten, pix);
  float h = hMap + det.x * smoothstep(-2.0, 3.0, hMap);
  float water = 1.0 - smoothstep(-0.6, 0.6, h);
  float gs = (dhs + det.y) * (1.0 - water);
  float gt = (dht + det.z) * (1.0 - water);

  vec3 up = haloUp(p);
  vec3 eR = vec3(p.xy / max(length(p.xy), 1.0), 0.0);
  float sg = uHabitat.x;
  vec3 eTh = vec3(-p.y, p.x, 0.0) / max(length(p.xy), 1.0);
  vec3 eZ = vec3(0.0, 0.0, 1.0);
  float Tr = uFloorLine.z;
  float Tz = uFloorLine.w;
  // n = sigma*Tz*r - Tz*h_s*th - (sigma*Tr + h_t)*z  (iloczyn stycznych, zwrot ku powietrzu)
  vec3 N = normalize(sg * Tz * eR - Tz * gs * eTh - (sg * Tr + gt) * eZ);
  vec3 Nflat = normalize(sg * Tz * eR - sg * Tr * eZ);
  float slope = 1.0 - clamp(dot(N, Nflat), 0.0, 1.0);
  // do decyzji o materiale: nachylenie z makro-mapy + czesc detalu (bez szumu "moro")
  float slopeMacro = 1.0 - inversesqrt(1.0 + dhs * dhs + dht * dht);
  float slopeMat = mix(slopeMacro, slope, 0.3);

  // ---- materialy (albedo liniowe; zielen ciemniej - waga luminancji 0,7152)
  vec4 var0 = haloVar(0, sRel, t);
  vec4 var1 = haloVar(1, sRel, t);
  vec4 var2 = haloVar(2, sRel, t);
  vec4 d1c = texture(uDetail1, vec2(sRel / uDetailN.x + uDetailOff.x, t / uDetailN.x));
  float varA = var0.b;
  vec3 lushGrass = vec3(0.060, 0.112, 0.024);
  vec3 dryGrass = vec3(0.190, 0.170, 0.070);
  vec3 grass = mix(dryGrass, lushGrass, smoothstep(0.25, 0.75, moist + varA * 0.3));
  grass = mix(grass, grass * vec3(1.25, 1.05, 0.7), smoothstep(0.1, 0.6, var2.b) * 0.5);
  grass = mix(grass, grass * vec3(0.8, 0.95, 1.05), smoothstep(0.0, -0.5, var1.b) * 0.4);
  grass *= 0.86 + 0.28 * (var1.b * 0.5 + 0.5);
  float crowns = smoothstep(0.34, 0.05, var2.r);
  vec3 forestCol = mix(vec3(0.013, 0.028, 0.010), vec3(0.030, 0.062, 0.019), crowns * (0.6 + 0.4 * var2.g));
  forestCol = mix(forestCol, vec3(0.022, 0.034, 0.020), smoothstep(0.35, 0.1, temp));
  float strata = sin(h * 0.045 + varA * 3.0) * 0.5 + 0.5;
  vec3 rockCol = mix(vec3(0.125, 0.112, 0.098), vec3(0.085, 0.078, 0.070), strata * 0.5 + (d1c.a + 0.5) * 0.25);
  rockCol = mix(rockCol, vec3(0.30, 0.18, 0.10) * (0.85 + 0.3 * strata), smoothstep(0.55, 0.8, temp) * smoothstep(0.35, 0.15, moist));
  vec3 sandCol = mix(vec3(0.44, 0.31, 0.15), vec3(0.34, 0.23, 0.11), var1.b * 0.5 + 0.5);
  vec3 beachCol = vec3(0.52, 0.45, 0.31);
  vec3 snowCol = vec3(0.68, 0.72, 0.76);
  vec3 iceCol = vec3(0.40, 0.54, 0.64);

  float desert = smoothstep(0.32, 0.14, moist) * smoothstep(0.55, 0.8, temp);
  vec3 ground = mix(grass, sandCol, desert);
  float fEdge = forest + var1.b * 0.22 + (var2.r - 0.3) * 0.25;
  float fMask = smoothstep(0.42, 0.56, fEdge) * (1.0 - desert) * (1.0 - smoothstep(0.3, 0.5, slopeMat));
  ground = mix(ground, forestCol, fMask);
  // pojedyncze drzewa i kępy na łąkach (komórki ~13 j.), z daleka średnia
  vec4 treeTex = texture(uDetail2, vec2(sRel / uDetailN.x + uDetailOff.x, t / uDetailN.x));
  float treeDens = clamp(0.06 + forest * 0.5 + moist * 0.12, 0.0, 0.6) * (1.0 - desert) * (1.0 - smoothstep(0.35, 0.55, slopeMat)) * smoothstep(0.12, 0.3, temp);
  float canopy = smoothstep(0.3, 0.12, treeTex.r) * step(treeTex.g, treeDens * 1.6);
  float treeFar = smoothstep(0.25, 0.9, fwidth(sRel) / (uDetailN.x / 32.0));
  canopy = mix(canopy, treeDens * 0.35, treeFar);
  ground = mix(ground, forestCol * (1.3 + 0.8 * treeTex.g), canopy * (1.0 - fMask));
  float rockAmt = clamp(max(rockMap, smoothstep(0.2, 0.42, slopeMat)), 0.0, 1.0);
  ground = mix(ground, rockCol, rockAmt * (1.0 - flatten));
  float beach = smoothstep(4.5, 0.8, h) * (1.0 - water) * (1.0 - urban) * (1.0 - fMask * 0.6);
  ground = mix(ground, beachCol, beach * (1.0 - desert * 0.5));
  float snowLine = mix(110.0, 800.0, clamp(temp * 1.5, 0.0, 1.0));
  float snow = smoothstep(snowLine - 40.0, snowLine + 60.0, h + varA * 60.0 + (var2.b) * 18.0) * (1.0 - smoothstep(0.22, 0.42, slopeMat + d1c.a * 0.18 + var1.b * 0.06));
  snow = max(snow, smoothstep(0.14, 0.04, temp) * (1.0 - water) * (1.0 - smoothstep(0.4, 0.65, slopeMat)));
  ground = mix(ground, snowCol, snow);

  // ---- zabudowa z mapy (daleki LOD miasta): kwartaly, ulice, dachy, parki
  vec3 emit = vec3(0.0);
  float typeInd = Bw.b;
  float typeGlass = Bw.a;
  float typeGarden = Bw.g;
  bool indBlocks = typeInd > 0.5;
  int bk = indBlocks ? 1 : 0;
  // miasto-ogrod: ulice lekko wygiete (warp z szumu zakotwiczonego w swiecie)
  float warpS = var0.b * 0.35 * typeGarden;
  float warpT = var1.b * 0.3 * typeGarden;
  float cS = sRel / uPatT[bk] + uPatF[bk] + warpS;
  float flS = floor(cS);
  vec2 ps = vec2(haloWrapI(flS + uPatI[bk], uPatN[bk]), cS - flS);
  float blockT = indBlocks ? 252.0 : 118.0;
  float tb = t / blockT + warpT;
  vec2 bid = vec2(ps.x, floor(tb));
  vec2 bf = vec2(ps.y, fract(tb));
  vec2 fw = vec2(fwidth(cS), fwidth(tb));
  float edgeD = min(min(bf.x, 1.0 - bf.x), min(bf.y, 1.0 - bf.y));
  float street = 1.0 - aaStep(indBlocks ? 0.035 : 0.045, edgeD, max(fw.x, fw.y) * 0.7);
  vec2 lot = floor(bf * vec2(3.0, 2.0));
  float lotH = haloHash12(bid * 7.0 + lot + 3.0);
  float bh = haloHash12(bid + 0.5);
  vec2 lotF = fract(bf * vec2(3.0, 2.0));
  float lotEdge = min(min(lotF.x, 1.0 - lotF.x), min(lotF.y, 1.0 - lotF.y));
  float fwLot = max(fw.x * 3.0, fw.y * 2.0);
  float footprint = aaStep(0.14, lotEdge, fwLot);
  vec3 roofA = vec3(0.105, 0.108, 0.112) * (0.78 + 0.44 * lotH);
  roofA = mix(roofA, vec3(0.16, 0.115, 0.095), step(0.86, lotH) * typeGarden);
  roofA = mix(roofA, grass * 0.8, step(0.72, fract(lotH * 7.3)) * step(lotH, 0.86) * typeGarden * 0.9);
  roofA = mix(roofA, vec3(0.12, 0.112, 0.10) + vec3(0.04, 0.012, 0.0) * lotH, typeInd);
  roofA = mix(roofA, vec3(0.20, 0.23, 0.25) + vec3(0.0, 0.02, 0.05) * lotH, typeGlass * 0.8);
  vec3 yard = mix(grass * 0.75, vec3(0.11, 0.11, 0.105), 0.45 + 0.4 * typeInd);
  float park = step(bh, 0.24) * (1.0 - typeInd);
  // pozorny cien budynku po stronie odwrotnej do slonca (wysokosc losowa per dzialka)
  vec3 sunT = uSunDir - haloUp(uCamLocal + vRel) * dot(uSunDir, haloUp(uCamLocal + vRel));
  vec2 sunST = normalize(vec2(dot(sunT, vec3(-(uCamLocal + vRel).y, (uCamLocal + vRel).x, 0.0) / max(length((uCamLocal + vRel).xy), 1.0)), sunT.z) + 1e-5);
  vec2 lotC = (lotF - 0.5) * vec2(uPatT[bk] / 3.0, blockT / 2.0);
  float lotHt = 0.35 + 0.65 * fract(lotH * 13.7);
  float shadowSide = smoothstep(0.0, 0.5, -dot(normalize(lotC + 1e-4), sunST)) * (1.0 - smoothstep(0.1, 0.42, lotEdge)) * lotHt;
  vec3 blockCol = mix(yard * (1.0 - shadowSide * 0.55), roofA * (1.0 + 0.15 * lotHt), footprint);
  blockCol = mix(blockCol, grass * 0.9 * (0.85 + 0.3 * crowns), park);
  if (indBlocks) {
    // przemysl (M4 v2): odcisk zestawu bryl dzialki - te same bryly, ktore
    // haloRingCity.js stawia z bliska (hala szedowa, zbiorniki, silosy, komin,
    // chlodnia, rafineria, kontenery), z pozornym cieniem od slonca
    vec2 lotSz = vec2(uPatT[1] / 3.0, blockT / 2.0);
    vec2 q = (lotF - 0.5) * lotSz;
    float fwq = max(fw.x * uPatT[1], fw.y * blockT) * 0.5;
    vec3 ic = vec3(0.075, 0.076, 0.074) * (0.9 + 0.2 * fract(lotH * 29.0));
    // oznakowanie placu: linie co 12 j. (z daleka srednia)
    float mk = (1.0 - smoothstep(0.3, 0.3 + fwq, abs(fract(q.x / 12.0) - 0.5) * 12.0 - 5.6)) * (1.0 - smoothstep(1.0, 3.0, fwq));
    ic = mix(ic, vec3(0.16, 0.15, 0.11), mk * 0.35);
    vec3 upI = haloUp(uCamLocal + vRel);
    float czI = max(dot(uSunDir, upI), 0.06);
    vec3 stI = uSunDir - upI * dot(uSunDir, upI);
    vec3 pI = uCamLocal + vRel;
    vec3 eThI = vec3(-pI.y, pI.x, 0.0) / max(length(pI.xy), 1.0);
    vec2 sdirI = vec2(dot(stI, eThI), stI.z / max(uFloorLine.w, 0.2)) / czI;
    float shI = 0.0;
    float onPart = 0.0;
    for (int ip = 0; ip < 5; ip++) {
      vec4 KA;
      vec4 KB;
      indKitPart(lotH, ip, KA, KB);
      if (KB.y < 0.01) continue;
      vec2 d = q - KA.xy;
      float sd = ip < 2 ? max(abs(d.x) - KA.z * 0.5, abs(d.y) - KA.w * 0.5) : length(d) - KA.z;
      float inside = 1.0 - smoothstep(-0.5 - fwq, 0.5 + fwq, sd);
      ic = mix(ic, indTopColor(KB.z, lotH, d, KA), inside);
      onPart = max(onPart, inside);
      float hTop = KB.x + KB.y;
      float sh = ip < 2 ? indSegBox(d, sdirI * hTop, 0.5 * KA.zw) : indSegCircle(d, sdirI * hTop, KA.z);
      shI = max(shI, sh * (1.0 - inside));
    }
    ic *= 1.0 - 0.55 * shI;
    blockCol = ic;
  }
  vec3 cityCol = mix(blockCol, vec3(0.048, 0.050, 0.054), street);
  float farCity = smoothstep(0.22, 0.6, max(fw.x, fw.y));
  vec3 cityAvg = mix(vec3(0.105, 0.108, 0.11), vec3(0.11, 0.105, 0.095), typeInd);
  cityAvg = mix(cityAvg, grass, 0.25 * (1.0 - typeInd));
  cityCol = mix(cityCol, cityAvg, farCity);
  float cityMask = smoothstep(0.25, 0.5, urban + var1.b * 0.15) * (1.0 - water);
  ground = mix(ground, cityCol, cityMask);

  // odslonieta konstrukcja: goly metal z niebieskimi liniami (ref. 2)
  vec2 pp = haloPat(3, sRel);
  float pt = t / 96.0;
  vec2 pf = vec2(pp.y, fract(pt));
  vec2 pw = vec2(fwidth(sRel) / uPatT[3], fwidth(pt));
  float seam = 1.0 - aaStep(0.03, min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y)), max(pw.x, pw.y));
  vec3 metal = mix(vec3(0.085, 0.10, 0.12), vec3(0.14, 0.16, 0.18), haloHash12(vec2(pp.x, floor(pt)) + 9.0));
  metal *= 1.0 - seam * 0.5 * (1.0 - smoothstep(0.2, 0.6, max(pw.x, pw.y)));
  float exMask = smoothstep(0.35, 0.6, exposed) * (1.0 - water);
  ground = mix(ground, metal, exMask);
  vec2 lp = haloPat(4, sRel);
  float lt = t / 540.0;
  vec2 lf = abs(vec2(lp.y, fract(lt)) - 0.5);
  vec2 lw = vec2(fwidth(sRel) / uPatT[4], fwidth(lt));
  float line = (1.0 - aaStep(0.012, lf.y, lw.y)) * step(0.5, haloHash12(vec2(floor(lt), 5.0)));
  line = max(line, (1.0 - aaStep(0.008, lf.x, lw.x)) * 0.6);
  float lineFar = 1.0 - smoothstep(0.08, 0.3, max(lw.x, lw.y));
  float exDark = 1.0 - smoothstep(0.05, 0.4, haloLuma(haloSunVisibility(p, uSunDir)) * max(dot(Nflat, uSunDir), 0.0));
  emit += vec3(${HALO_HDR.stripBlue.map((v) => v.toFixed(3)).join(", ")}) * line * exMask * mix(0.12, 1.0, lineFar) * uExposedLines * mix(0.25, 1.0, exDark);

  // ---- oswietlenie
  vec3 L = uSunDir;
  vec3 sunVis = haloSunVisibility(p, L);
  float cz = dot(L, up);
  float cloudShadow = 0.0;
  if (uLayers.x > 0.5 && cz > 0.02) {
    float hc = uCloudParams.x - max(h, 0.0);
    float travel = hc / cz;
    vec3 Lt = L - up * cz;
    float dss = dot(Lt, eTh) * travel;
    float dtt = Lt.z * travel / max(Tz, 0.2);
    float cov = haloCloudCover(sRel + dss, t + dtt, moist, 3);
    cloudShadow = cov * 0.72;
  }
  float terrSh = haloTerrainShadow(sRel, t, max(h, 0.0), L, up, eTh, Tz);
  vec3 sunLight = uSunColor * sunVis * (1.0 - cloudShadow) * terrSh;
  float NdL = max(dot(N, L), 0.0);
  vec3 psh = haloPlanetshine(p, N);
  vec3 amb = haloSkyAmbient(p, N) * (1.0 - cloudShadow * 0.35) + psh + vec3(uNightAmbient);

  vec3 color = ground * (sunLight * NdL + amb);
  if (water > 0.001) {
    // ---- woda: Fresnel, odbicie nieba/planety, odblask slonca, glebia, piana
    float depth = max(-h, 0.0);
    vec2 wuv1 = vec2((sRel + uTime * 3.0) / uDetailN.z + uDetailOff.z, (t + uTime * 1.3) / uDetailN.z);
    vec2 wuv2 = vec2((sRel - uTime * 2.1) / uDetailN.y + uDetailOff.y, (t - uTime * 1.7) / uDetailN.y);
    vec4 w1 = texture(uDetail1, wuv1);
    vec4 w2 = texture(uDetail1, wuv2);
    float waveFade = 1.0 - smoothstep(400.0, 6000.0, dist);
    vec2 wg = (w1.gb / uDetailN.z * 0.35 + w2.gb / uDetailN.y * 1.1) * waveFade;
    vec3 Nw = normalize(Nflat - (wg.x * eTh + wg.y * eZ) * 0.6);
    float NdV = clamp(dot(Nw, V), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, Nw);
    vec3 oc = uPlanet.xyz - p;
    float tbp = dot(oc, R);
    float dperp2 = dot(oc, oc) - tbp * tbp;
    float skyUp = clamp(dot(R, up), 0.0, 1.0);
    vec3 skyCol = mix(vec3(0.20, 0.30, 0.45), vec3(0.05, 0.10, 0.22), skyUp) * haloLuma(sunVis) * 0.9 + vec3(0.004, 0.006, 0.01);
    vec3 refl = skyCol;
    if (tbp > 0.0 && dperp2 < uPlanet.w * uPlanet.w) {
      vec3 hitN = normalize((p + R * (tbp - sqrt(uPlanet.w * uPlanet.w - dperp2))) - uPlanet.xyz);
      float pl = dot(hitN, L);
      refl = mix(vec3(0.004, 0.006, 0.012), vec3(0.16, 0.24, 0.36) * uSunColor, smoothstep(-0.05, 0.3, pl));
    }
    vec3 Hs = normalize(L + V);
    float rough = mix(0.035, 0.16, 1.0 - waveFade);
    float a2 = rough * rough;
    float NdH = max(dot(Nw, Hs), 0.0);
    float dd = NdH * NdH * (a2 - 1.0) + 1.0;
    float Dg = a2 / (HALO_PI * dd * dd);
    float spec = min(Dg * fres * 0.25 * max(dot(Nw, L), 0.0), 40.0);
    vec3 deep = vec3(0.004, 0.020, 0.034);
    vec3 shallow = vec3(0.020, 0.110, 0.115);
    vec3 absorb = exp(-depth * vec3(0.09, 0.035, 0.028));
    vec3 bed = mix(beachCol * 0.6, rockCol, 0.3);
    vec3 body = mix(deep, mix(shallow, bed, absorb.g * 0.7), absorb);
    float frozen = smoothstep(0.1, 0.03, temp);
    body = mix(body, iceCol, frozen);
    vec3 lit = body * (sunLight * max(dot(Nflat, L), 0.0) * 0.9 + amb);
    float foamN = texture(uDetail2, wuv1 * 2.0).r;
    float foam = smoothstep(2.4, 0.2, depth) * smoothstep(0.55, 0.2, foamN) * 0.6 * waveFade;
    lit = mix(lit, vec3(0.6) * (sunLight * 0.7 + amb), foam);
    vec3 wcol = mix(lit, refl, fres * (1.0 - frozen)) + sunLight * spec * (1.0 - frozen);
    color = mix(color, wcol, water);
  }

  // ---- swiatla miast: zapalaja sie z lokalnego oswietlenia, losowo per dzialke
  // (jasne niebo w cieniu sciany to wciaz dzien - liczy sie cale otoczenie)
  float dayLight = haloLuma(sunVis) * max(dot(Nflat, L), 0.0) * (1.0 - cloudShadow * 0.6) + haloLuma(amb) * 1.5;
  float dark = 1.0 - smoothstep(0.03, 0.28, dayLight);
  float thr = 0.15 + 0.7 * haloHash12(bid * 3.0 + lot + 11.0);
  float on = smoothstep(thr - 0.12, thr + 0.12, dark);
  // dzien (slonce nad horyzontem i poza cieniem planety): cien sciany czy gory
  // to tylko cien pod jasnym niebem, miasto nie przechodzi w tryb nocny
  float dayG = haloLuma(haloPlanetTransmit(p, L)) * smoothstep(-0.02, 0.12, dot(up, L));
  on *= 1.0 - 0.9 * dayG;
  vec3 warm = vec3(${HALO_HDR.windowWarm.map((v) => v.toFixed(3)).join(", ")});
  vec3 sodium = vec3(${HALO_HDR.windowSodium.map((v) => v.toFixed(3)).join(", ")});
  vec3 cool = vec3(${HALO_HDR.windowCool.map((v) => v.toFixed(3)).join(", ")});
  vec3 lampCol = mix(mix(warm, sodium, typeInd), cool, typeGlass);
  vec2 wp = haloPat(2, sRel);
  float wt = t / 7.0;
  float win = step(0.62, haloHash12(vec2(wp.x, floor(wt)) + 0.37)) * (1.0 - park);
  float winAA = smoothstep(0.35, 0.9, fwidth(sRel) / uPatT[2]);
  // kwartaly roznia sie jasnoscia (nieliczne jasne centra, reszta przygaszona),
  // parki ciemne - z daleka miasto to siec ulic i plam, nie jednolita tafla
  float blockB = 0.3 + 0.7 * haloHash12(bid * 3.1 + 5.0);
  blockB *= blockB;
  float lotDensity = mix(win, 0.3, max(winAA, farCity)) * blockB * (1.0 - park);
  // glowne ulice jasniejsze od bocznych (latarnie, bez ruchu - swiatla aut
  // usuniete 2026-09-24: ruch wdrazany osobno)
  float artery = 1.0 - aaStep(0.018, abs(fract(bid.y * 0.3334 + bf.y * 0.3334 + 0.02) - 0.5), fw.y * 0.34);
  vec3 cityLight = lampCol * (lotDensity * (1.0 - street) * 0.32 + street * 0.2 + artery * 0.12);
  emit += cityLight * cityMask * on * uLayers.y * uNightLights;
  color += emit;

  color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

export class HaloTerrain {
  constructor({ layout, uniforms, maps, detail, quality }) {
    this.layout = layout;
    this.uniforms = uniforms;
    this.maps = maps;
    this.detail = detail;
    this.quality = quality;
    this.gridDiv = quality.gridDiv;
    this._setupDomain();
    this.surfaceUniforms = this._makeSurfaceUniforms();
    this.material = this._makeMaterial();
    this.geometry = this._makeGeometry(this.gridDiv, quality.maxNodes * 4);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'HaloTerrain';
    this.mesh.frustumCulled = false;
    this.activeNodes = 0;
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._tmp = new THREE.Vector3();
    this._rangeCache = new Map();
    this.syncMaps();
  }

  _setupDomain() {
    const L = this.layout.circumference;
    const Wf = this.layout.floor.length;
    this.maxLod = HALO_TERRAIN.maxLod;
    const rootCells = this.gridDiv << this.maxLod;           // najdrobniejsze komórki na bok korzenia
    this.rootCount = Math.max(8, Math.round(L / Wf));
    this.Ns = this.rootCount * rootCells;
    this.Nt = rootCells;
    this.ds = L / this.Ns;
    this.dt = Wf / this.Nt;
    this.rootCells = rootCells;
    // zasięgi LOD w świecie: range[k] = lodFactor × rozmiar węzła LOD k
    const nodeWorld0 = this.gridDiv * Math.max(this.ds, this.dt);
    this.ranges = [];
    for (let k = 0; k <= this.maxLod; k++) this.ranges.push(this.quality.lodFactor * nodeWorld0 * (1 << k));
  }

  _makeSurfaceUniforms() {
    const L = this.layout.circumference;
    const periodic = (want) => {
      const count = Math.max(1, Math.round(L / want));
      return { count, size: L / count };
    };
    // wzory miasta zakotwiczone w świecie: kwartał ogrodu, kwartał przemysłu,
    // okna, panele metalu, linie świetlne, ruch na arteriach
    this.patterns = [140, 336, 7, 96, 480, 56].map(periodic);
    // dach (M3): drobna komórka i działka dzielą segment konstrukcji bez reszty
    // (segment = korzeń / 8), więc shader i plan brył liczą te same indeksy
    const segCount = this.rootCount * 8;
    this.patterns.push({ count: segCount * HALO_ROOF.cellsPerSegment, size: L / (segCount * HALO_ROOF.cellsPerSegment) });
    this.patterns.push({ count: segCount * HALO_ROOF.lotsPerSegment, size: L / (segCount * HALO_ROOF.lotsPerSegment) });
    this.varPeriods = [3300, 1100, 210, 52].map((w) => periodic(w).size);
    const scales = haloDetailScales(this.layout.circumference);
    const clouds = haloCloudScales(this.layout.circumference);
    const lod = [];
    for (let k = 0; k < MAX_LOD_UNIFORM; k++) {
      const end = k < this.ranges.length ? this.ranges[k] : 1e9;
      const start = k < this.ranges.length ? end * HALO_TERRAIN.morphStart : 1e9;
      lod.push(new THREE.Vector2(start, k >= this.maxLod ? 1e9 : end));
    }
    return {
      uMapA: { value: null },
      uMapB: { value: null },
      uMapC: { value: null },
      uMapSize: { value: new THREE.Vector4(1, 1, 1, 1) },
      uDetail1: { value: this.detail.tex1 },
      uDetail2: { value: this.detail.tex2 },
      uDetailN: { value: new THREE.Vector4(scales[0].size, scales[1].size, scales[2].size, scales[3].size) },
      uDetailOff: { value: new THREE.Vector4() },
      uCloudS0: { value: new THREE.Vector4(clouds[0].sizeS, clouds[1].sizeS, clouds[2].sizeS, clouds[3].sizeS) },
      uCloudT0: { value: new THREE.Vector4(clouds[0].sizeT, clouds[1].sizeT, clouds[2].sizeT, clouds[3].sizeT) },
      uCloudOff0: { value: new THREE.Vector4() },
      uGridInfo: { value: new THREE.Vector4(this.ds, this.dt, this.Ns, 0) },
      uLodMorph: { value: lod },
      uExposedLines: { value: 1 },
      uVarN: { value: new THREE.Vector4(...this.varPeriods) },
      uVarOff: { value: new THREE.Vector4() },
      uPatT: { value: this.patterns.map((p) => p.size) },
      uPatF: { value: this.patterns.map(() => 0) },
      uPatI: { value: this.patterns.map(() => 0) },
      uPatN: { value: this.patterns.map((p) => p.count) }
    };
  }

  _makeMaterial() {
    return new THREE.ShaderMaterial({
      name: 'HaloTerrain',
      uniforms: { ...this.uniforms, ...this.surfaceUniforms },
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      defines: { AIR_STEPS: this.quality.airSteps },
      // Siatka węzła ma przód zwrócony ku osi ringu (σ = −1). Dla habitatu
      // w stronę kosmosu powietrze jest po drugiej stronie — rysujemy tył.
      side: this.layout.sigma > 0 ? THREE.BackSide : THREE.FrontSide
    });
  }

  _makeGeometry(div, capacity) {
    const verts = (div + 1) * (div + 1);
    const pos = new Float32Array(verts * 3);
    let o = 0;
    for (let y = 0; y <= div; y++) {
      for (let x = 0; x <= div; x++) {
        pos[o++] = x; pos[o++] = y; pos[o++] = 0;
      }
    }
    const idx = [];
    for (let y = 0; y < div; y++) {
      for (let x = 0; x < div; x++) {
        const a = y * (div + 1) + x;
        const b = a + 1;
        const c = a + div + 1;
        const d = c + 1;
        // przekątna naprzemiennie — mniej widoczny kierunek siatki
        if ((x + y) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.nodeData = new Float32Array(capacity * 4);
    this.nodeAttr = new THREE.InstancedBufferAttribute(this.nodeData, 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iNode', this.nodeAttr);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.capacity = capacity;
    return g;
  }

  syncMaps() {
    const set = this.maps.current;
    if (!set) return;
    const su = this.surfaceUniforms;
    su.uMapA.value = set.A.texture;
    su.uMapB.value = set.B.texture;
    su.uMapC.value = set.C.texture;
    su.uMapSize.value.set(set.size.w, set.size.h, 1 / set.size.w, 1 / set.size.h);
    this._mapVersion = this.maps.version;
    this._rangeCache.clear();
  }

  // min/max wysokości węzła z mapy CPU (cache po id węzła)
  _heightRange(s0, t0, cells) {
    const key = `${s0}|${t0}|${cells}`;
    let r = this._rangeCache.get(key);
    if (r) return r;
    let lo = 1e9;
    let hi = -1e9;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const s = ((s0 + cells * i / steps) % this.Ns + this.Ns) % this.Ns;
        const t = t0 + cells * j / steps;
        const h = this.maps.heightAtUV(s / this.Ns, t / this.Nt);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    r = [Math.max(0, lo) - 60, Math.max(0, hi) + 70];
    if (this._rangeCache.size > 20000) this._rangeCache.clear();
    this._rangeCache.set(key, r);
    return r;
  }

  _nodeSphere(sAbs0, t0, cells, out) {
    const layout = this.layout;
    const sMid = (sAbs0 + cells * 0.5) * this.ds;
    const tMid = (t0 + cells * 0.5) * this.dt;
    const range = this._heightRange(sAbs0, t0, cells);
    const hMid = (range[0] + range[1]) * 0.5;
    layout.floorPoint(sMid, tMid, hMid, this._pt || (this._pt = {}));
    const sLen = cells * this.ds;
    const tLen = cells * this.dt;
    const sag = sLen * sLen / (8 * layout.radii.floorMid);
    const radius = 0.5 * Math.hypot(sLen, tLen) + (range[1] - range[0]) * 0.5 + sag;
    out.center.set(this._pt.x, this._pt.y, this._pt.z);
    out.radius = radius;
    return out;
  }

  // Wybór węzłów CDLOD dla kamery (pozycja w układzie lokalnym ringu).
  update(view) {
    if (this._mapVersion !== this.maps.version) this.syncMaps();
    const cam = view.camLocal;
    const refS = view.refS;          // w komórkach najdrobniejszej siatki (całkowite)
    this.surfaceUniforms.uGridInfo.value.w = refS;
    this._projScreen.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
    this._projScreen.multiply(view.ringMatrixWorld);
    this._frustum.setFromProjectionMatrix(this._projScreen);
    this._count = 0;
    this._cam = cam;
    this._refS = refS;
    const rc = this.rootCells;
    for (let i = 0; i < this.rootCount; i++) {
      const s0 = i * rc;
      if (!this._select(s0, 0, this.maxLod)) this._emit(s0, 0, this.maxLod);
    }
    this.geometry.instanceCount = this._count;
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, this._count * 4);
    this.activeNodes = this._count;
  }

  _select(sAbs0, t0, k) {
    const cells = this.gridDiv << k;
    const sphere = this._nodeSphere(sAbs0, t0, cells, this._sphere);
    if (!this._frustum.intersectsSphere(sphere)) return true; // poza kadrem: nic nie kosztuje
    const dist = Math.max(0, sphere.center.distanceTo(this._cam) - sphere.radius);
    if (k < this.maxLod && dist > this.ranges[k]) return false;
    if (k === 0 || dist > this.ranges[k - 1]) {
      this._emit(sAbs0, t0, k);
      return true;
    }
    const half = cells >> 1;
    for (let c = 0; c < 4; c++) {
      const cs = sAbs0 + (c & 1) * half;
      const ct = t0 + (c >> 1) * half;
      if (!this._select(cs, ct, k - 1)) this._emit(cs, ct, k - 1);
    }
    return true;
  }

  _emit(sAbs0, t0, k) {
    if (this._count >= this.capacity) return;
    // s względem refS, zawinięte per węzeł (spójne wewnątrz węzła)
    let rel = sAbs0 - this._refS;
    const Ns = this.Ns;
    rel -= Ns * Math.round(rel / Ns);
    const o = this._count * 4;
    this.nodeData[o] = rel;
    this.nodeData[o + 1] = t0;
    this.nodeData[o + 2] = 0;
    this.nodeData[o + 3] = k;
    this._count++;
  }

  // Przesunięcia wzorów i tekstur względem punktu odniesienia RTE — liczone
  // w double, żeby wzory były przyklejone do świata, a nie do kamery.
  setReference(refSWorld) {
    const su = this.surfaceUniforms;
    const f = (period) => {
      const x = refSWorld / period;
      return x - Math.floor(x);
    };
    const N = su.uDetailN.value;
    su.uDetailOff.value.set(f(N.x), f(N.y), f(N.z), f(N.w));
    const S = su.uCloudS0.value;
    su.uCloudOff0.value.set(f(S.x), f(S.y), f(S.z), f(S.w));
    const V = su.uVarN.value;
    su.uVarOff.value.set(f(V.x), f(V.y), f(V.z), f(V.w));
    for (let i = 0; i < this.patterns.length; i++) {
      const { size, count } = this.patterns[i];
      const x = refSWorld / size;
      const fl = Math.floor(x);
      su.uPatF.value[i] = x - fl;
      su.uPatI.value[i] = ((fl % count) + count) % count;
    }
  }

  get triangleEstimate() {
    return this.activeNodes * this.gridDiv * this.gridDiv * 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export { TERRAIN_FRAGMENT as HALO_TERRAIN_FRAGMENT };
