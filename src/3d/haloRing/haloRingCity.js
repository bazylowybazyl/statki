// Miasta i zieleń z bliska (M4, v2 po uwadze użytkownika: „za mocny LOD,
// chowają się budynki” i „dzielnica fabryczna — same kwadraty”).
//
// Budynki wyrastają z tych samych kwartałów i działek, które shader terenu
// rysuje z daleka (dachy z mapy, pozorny cień). Zamiast okna działek wokół
// kamery (dawało twardą granicę w kadrze) — KAWAŁKI wzdłuż ringu: instancja =
// kawałek (4 kwartały ogrodu / 1 kwartał przemysłu) na całą szerokość
// habitatu; CPU wybiera kawałki w kadrze (frustum + odległość, na której
// budynek ma jeszcze ≥ ~1 px) i przepisuje bufor tylko przy zmianie wyboru.
// Budynek ginie PŁYNNIE: wysokość maleje z rozmiarem w pikselach, a przy
// dalekiej kamerze całe miasto opada wspólnie (bez granicy w kadrze).
//
// Przemysł: zestaw brył działki z haloRingIndustryKit.js (hala szedowa,
// zbiorniki, silosy, kotłownia z kominem, chłodnia, rafineria, kontenery).
//
// Draw calle: 1 (ogrody/szkło) + 1 (przemysł) + 1 (drzewa).
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_RTE
} from './haloRingGLSL.js';
import { HALO_TAU, haloPortSites } from './haloRingConfig.js';
import { HALO_GLSL_SURFACE } from './haloRingTerrain.js';
import { HALO_PRIM_FRAGMENT } from './haloRingMegastructure.js';
import { HALO_GLSL_INDKIT, IND_PARTS } from './haloRingIndustryKit.js';

export const HALO_CITY = Object.freeze({
  gardenChunkBlocks: 4,      // kwartały ogrodu (140 j.) na kawałek
  industryChunkBlocks: 1,    // kwartały przemysłu (336 j.) na kawałek
  gardenBlockT: 118,         // kwartał w poprzek [j.] — jak w terenie
  industryBlockT: 252,
  maxGardenChunks: 96,
  maxIndustryChunks: 128,
  // najwyższa bryła klasy sektora [j.] → zasięg rysowania z rozmiaru piksela
  maxHeight: Object.freeze({ garden: 125, glass: 480, industrial: 125 }),
  // kawałek wchodzi do rysowania, gdy jego najwyższa bryła ma ≥ 1 px (niżej
  // budynki i tak już opadły: płynne znikanie w shaderze między 0,6 a 1,6 px)
  minPixels: 1.0,
  // wspólne opadanie miasta przy dalekiej kamerze (odległość od podłogi) [j.]
  fadeNear: 17000,
  fadeFar: 30000
});

const GLSL_FLOOR_FRAME = /* glsl */`
vec3 cityFloorRel(float sRel, float t, float h) {
  float dr = (uFloorLine.x - uFloorDims.z) + uFloorLine.z * t + uHabitat.x * h;
  float z = uFloorLine.y + uFloorLine.w * t;
  return haloRelFromPolar(sRel / uFloorDims.z, dr, z);
}
void cityFrame(float sRel, out vec3 ex, out vec3 ey, out vec3 ez) {
  float th = uRefBasis.z + sRel / uFloorDims.z;
  vec3 er = vec3(cos(th), sin(th), 0.0);
  ex = vec3(-sin(th), cos(th), 0.0);
  ey = er * uFloorLine.z + vec3(0.0, 0.0, uFloorLine.w);
  ez = uHabitat.x * (er * uFloorLine.w - vec3(0.0, 0.0, uFloorLine.z));
}
vec4 cityVarLod(int k, float sRel, float t) {
  float T = uVarN[k];
  return textureLod(uDetail2, vec2(sRel / T + uVarOff[k], t / T), 2.0);
}
// kwartał bezwzględny → numer względem kwartału odniesienia (−n/2 .. n/2)
float cityRelBlock(float blockAbs, int bk) {
  float n = uPatN[bk];
  float rel = haloWrapI(blockAbs - uPatI[bk], n);
  return rel >= n * 0.5 ? rel - n : rel;
}
`;

// ---- ogrody i szkło: prostopadłościan 8-wierzchołkowy × (bryła + uskok)
const GARDEN_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${GLSL_FLOOR_FRAME}
uniform vec4 uCityGrid;        // kwartały na kawałek, rzędy kwartałów, —, zanik miasta
uniform float uPixelAngle;
attribute vec4 aLot;           // kwartał w kawałku, rząd kwartałów, działka (0..5), piętro (0/1)
attribute float iChunk;        // pierwszy kwartał (bezwzględny) kawałka
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;
varying vec3 vEx;
varying vec3 vEy;
varying vec3 vEz;

void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vRel = vec3(0.0); vNormal = vec3(0.0, 0.0, 1.0); vLocal = vec3(0.0); vLocalN = vec3(0.0, 0.0, 1.0);
  vSize = vec3(1.0); vMat = 0.0; vSeed = 0.0; vEx = vec3(1.0, 0.0, 0.0); vEy = vec3(0.0, 1.0, 0.0); vEz = vec3(0.0, 0.0, 1.0);
}

void main() {
  float T = uPatT[0];
  float blockT = ${HALO_CITY.gardenBlockT}.0;
  float blockAbs = iChunk + aLot.x;
  if (blockAbs > uPatN[0] - 0.5 || uCityGrid.w < 0.01) { collapse(); return; }
  float rel = cityRelBlock(blockAbs, 0);
  float lx = aLot.z - 3.0 * floor((aLot.z + 0.5) / 3.0);
  float ly = floor((aLot.z + 0.5) / 3.0);
  float tier = aLot.w;
  float cLot = rel + (lx + 0.5) / 3.0;
  float tbLot = aLot.y + (ly + 0.5) / 2.0;
  // odwrócenie skrzywienia ulic miasta-ogrodu (dwie iteracje), jak w terenie
  float sRel = (cLot - uPatF[0]) * T;
  float t = tbLot * blockT;
  vec4 Bw = textureLod(uMapB, haloMapUV(sRel + uRefBasis.w, t), 0.0);
  if (Bw.g > 0.01) {
    for (int it = 0; it < 2; it++) {
      float warpS = cityVarLod(0, sRel, t).b * 0.35 * Bw.g;
      float warpT = cityVarLod(1, sRel, t).b * 0.3 * Bw.g;
      sRel = (cLot - uPatF[0] - warpS) * T;
      t = (tbLot - warpT) * blockT;
      Bw = textureLod(uMapB, haloMapUV(sRel + uRefBasis.w, t), 0.0);
    }
  }
  float typeInd = Bw.b;
  float typeGlass = Bw.a;
  if (typeInd > 0.5 || t < 30.0 || t > uFloorDims.y - 30.0) { collapse(); return; }
  vec2 uvMap = haloMapUV(sRel + uRefBasis.w, t);
  vec4 A = textureLod(uMapA, uvMap, 0.0);
  vec4 C = textureLod(uMapC, uvMap, 0.0);
  float water = 1.0 - smoothstep(-0.6, 0.6, A.r);
  float cityMask = smoothstep(0.25, 0.5, C.g + cityVarLod(1, sRel, t).b * 0.15) * (1.0 - water);
  vec2 bid = vec2(blockAbs, aLot.y);
  vec2 lot = vec2(lx, ly);
  float lotH = haloHash12(bid * 7.0 + lot + 3.0);
  float bh = haloHash12(bid + 0.5);
  float park = step(bh, 0.24);
  if (park > 0.5 || cityMask < 0.5) { collapse(); return; }
  float lotHt = 0.35 + 0.65 * fract(lotH * 13.7);
  float height = mix(10.0 + 60.0 * lotHt * lotHt, 40.0 + 250.0 * lotHt * lotHt, typeGlass);
  vec2 foot = vec2(T / 3.0, blockT / 2.0) * 0.72;
  vec3 size = vec3(foot, height + 8.0);
  float base = max(A.r, 0.0) - 8.0;
  vec2 offT = vec2(0.0);
  if (tier > 0.5) {
    float tall = step(0.55, lotHt) * step(fract(lotH * 5.3), mix(0.6, 0.95, typeGlass));
    if (tall < 0.5) { collapse(); return; }
    base += height + 8.0;
    size = vec3(foot * mix(0.55, 0.62, fract(lotH * 3.7)), height * mix(0.35, 0.7, fract(lotH * 9.1)));
    offT = (vec2(fract(lotH * 2.3), fract(lotH * 4.9)) - 0.5) * (foot - size.xy) * 0.8;
  }
  vec3 anchor = cityFloorRel(sRel + offT.x, t + offT.y, base);
  // płynne znikanie: wysokość maleje, gdy budynek ma < ~1,5 px (dach z mapy zostaje)
  float px = (height + 8.0) / max(length(anchor), 1.0) / uPixelAngle;
  float k = smoothstep(0.6, 1.6, px) * uCityGrid.w;
  if (k < 0.02) { collapse(); return; }
  size.z *= k;
  vec3 ex;
  vec3 ey;
  vec3 ez;
  cityFrame(sRel, ex, ey, ez);
  vec3 lp = position * size;
  vRel = anchor + ex * lp.x + ey * lp.y + ez * lp.z;
  vNormal = ez;
  vLocal = lp;
  vLocalN = vec3(0.0, 0.0, 1.0);
  vSize = size;
  vEx = ex;
  vEy = ey;
  vEz = ez;
  float greenRoof = step(0.72, fract(lotH * 7.3)) * step(lotH, 0.86);
  float pal = typeGlass > 0.5 ? 7.0 : (lotH > 0.86 ? 15.0 : (greenRoof > 0.5 ? 14.0 : (lotH > 0.5 ? 3.0 : 0.0)));
  if (tier > 0.5 && typeGlass > 0.5) pal = 7.0;
  float emit = typeGlass > 0.5 ? 2.0 : 1.0;
  vMat = pal + 32.0 * emit;
  vSeed = lotH;
  gl_Position = haloProjectRel(vRel);
}
`;

// ---- przemysł: zestaw działki (2 prostopadłościany + 3 walce)
const INDUSTRY_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${GLSL_FLOOR_FRAME}
${HALO_GLSL_INDKIT}
uniform vec4 uCityGrid;
uniform float uPixelAngle;
attribute vec4 aLot;           // kwartał w kawałku, rząd kwartałów, działka (0..5), część (0..4)
attribute float aPrim;         // 0 prostopadłościan, 1 walec
attribute float iChunk;
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;

void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vRel = vec3(0.0); vNormal = vec3(0.0, 0.0, 1.0); vLocal = vec3(0.0); vLocalN = vec3(0.0, 0.0, 1.0);
  vSize = vec3(1.0); vMat = 0.0; vSeed = 0.0;
}

void main() {
  if (uCityGrid.w < 0.01) { collapse(); return; }
  float T = uPatT[1];
  float blockT = ${HALO_CITY.industryBlockT}.0;
  float blockAbs = iChunk + aLot.x;
  if (blockAbs > uPatN[1] - 0.5) { collapse(); return; }
  float lx = aLot.z - 3.0 * floor((aLot.z + 0.5) / 3.0);
  float ly = floor((aLot.z + 0.5) / 3.0);
  vec2 bid = vec2(blockAbs, aLot.y);
  vec2 lot = vec2(lx, ly);
  float lotH = haloHash12(bid * 7.0 + lot + 3.0);
  int part = int(aLot.w + 0.5);
  vec4 KA;
  vec4 KB;
  indKitPart(lotH, part, KA, KB);
  // część nieużywana w tym rodzaju zakładu albo zły prymityw: tanio do kosza
  bool wantCyl = part >= 2;
  if (KB.y < 0.01 || (aPrim > 0.5) != wantCyl) { collapse(); return; }
  float rel = cityRelBlock(blockAbs, 1);
  float cLot = rel + (lx + 0.5) / 3.0;
  float tbLot = aLot.y + (ly + 0.5) / 2.0;
  float sRel = (cLot - uPatF[1]) * T;
  float t = tbLot * blockT;
  vec2 uvMap = haloMapUV(sRel + uRefBasis.w, t);
  vec4 Bw = textureLod(uMapB, uvMap, 0.0);
  if (Bw.b <= 0.5 || t < 40.0 || t > uFloorDims.y - 40.0) { collapse(); return; }
  vec4 A = textureLod(uMapA, uvMap, 0.0);
  vec4 C = textureLod(uMapC, uvMap, 0.0);
  float water = 1.0 - smoothstep(-0.6, 0.6, A.r);
  float cityMask = smoothstep(0.25, 0.5, C.g + cityVarLod(1, sRel, t).b * 0.15) * (1.0 - water);
  if (cityMask < 0.5) { collapse(); return; }
  float base = max(A.r, 0.0) - 2.0 + KB.x;
  vec3 anchor = cityFloorRel(sRel + KA.x, t + KA.y, base);
  float px = (KB.y + KB.x) / max(length(anchor), 1.0) / uPixelAngle;
  float k = smoothstep(0.6, 1.6, px) * uCityGrid.w;
  if (k < 0.02) { collapse(); return; }
  vec3 lp;
  vec3 ln;
  vec3 size;
  if (aPrim < 0.5) {
    size = vec3(KA.z, KA.w, KB.y * k);
    lp = position * size;
    ln = normal;
  } else {
    float tt = position.z;
    float rs = indCylRadius(KB.w, tt);
    float h = KB.y * k;
    lp = vec3(position.xy * KA.z * rs, tt * h);
    ln = normal;
    if (abs(ln.z) < 0.5) {
      float sl = indCylSlope(KB.w, tt) * KA.z / max(h, 1.0);
      ln = normalize(vec3(ln.xy, -sl));
    }
    size = vec3(KA.z * 2.0, KA.z * 2.0, h);
  }
  vec3 ex;
  vec3 ey;
  vec3 ez;
  cityFrame(sRel + KA.x, ex, ey, ez);
  vRel = anchor + ex * lp.x + ey * lp.y + ez * lp.z;
  vNormal = normalize(ex * ln.x + ey * ln.y + ez * ln.z);
  vLocal = lp;
  vLocalN = ln;
  vSize = size;
  vMat = KB.z;
  vSeed = fract(lotH * 17.0 + float(part) * 0.31);
  gl_Position = haloProjectRel(vRel);
}
`;

// Drzewa: slot siatki wokół kamery (co 16 j.), gęstość z mapy lasu,
// parków miasta i nabrzeży; iglaste w chłodzie (korona ściśnięta w stożek).
const TREE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${GLSL_FLOOR_FRAME}
uniform vec4 uTreeGrid;        // sloty wzdluz, sloty w poprzek, krok [j.], t srodka siatki
uniform float uPixelAngle;
attribute float aPart;         // 0 pien, 1 korona
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vCol;
varying float vPart;
void main() {
  float NS = uTreeGrid.x;
  float NT = uTreeGrid.y;
  float step0 = uTreeGrid.z;
  float id = float(gl_InstanceID);
  float iT = floor((id + 0.5) / NS);
  float iS = id - NS * iT;
  // siatka zakotwiczona w swiecie: indeks wzgledem punktu odniesienia
  float cellS = floor(uRefBasis.w / step0) - floor(NS * 0.5) + iS;
  float cellT = floor(uTreeGrid.w / step0) - floor(NT * 0.5) + iT;
  vec2 j = haloHash22(vec2(mod(cellS, 65536.0), cellT) + 0.37);
  float sAbsCell = (cellS + j.x) * step0;
  float sRel = sAbsCell - uRefBasis.w;
  float t = (cellT + j.y) * step0;
  vec2 uvMap = haloMapUV(sRel + uRefBasis.w, t);
  vec4 A = textureLod(uMapA, uvMap, 0.0);
  vec4 B = textureLod(uMapB, uvMap, 0.0);
  vec4 C = textureLod(uMapC, uvMap, 0.0);
  float h = A.r;
  float water = 1.0 - smoothstep(0.2, 1.5, h);
  float snowy = smoothstep(0.12, 0.04, A.a) + smoothstep(700.0, 900.0, h);
  float forest = C.r;
  float urban = C.g;
  float riverBank = smoothstep(40.0, 10.0, A.g) * (1.0 - water);
  float density = max(forest * 0.9, max(riverBank * 0.35, (1.0 - urban) * 0.12 * B.g));
  density *= (1.0 - water) * (1.0 - clamp(snowy, 0.0, 1.0)) * (1.0 - C.b) * step(8.0, t) * step(t, uFloorDims.y - 8.0);
  float r1 = haloHash12(vec2(mod(cellS, 65536.0), cellT) + 5.1);
  float r2 = haloHash12(vec2(mod(cellS, 65536.0), cellT) + 9.7);
  bool present = r1 < density;
  float conifer = step(A.a, 0.42 + 0.1 * (r2 - 0.5));
  float height = mix(7.0, 15.0, r2) * mix(1.0, 1.35, conifer);
  float crownR = height * mix(0.36, 0.22, conifer);
  vec3 anchor = cityFloorRel(sRel, t, max(h, 0.0) - 1.0);
  float dist = length(anchor);
  present = present && height / max(dist, 1.0) > 1.5 * uPixelAngle;
  vec3 ex;
  vec3 ey;
  vec3 ez;
  cityFrame(sRel, ex, ey, ez);
  vec3 lp = position;
  vec3 nl = normal;
  if (aPart < 0.5) {
    lp *= vec3(height * 0.05, height * 0.05, height * 0.45);
  } else {
    float zc = lp.z;
    float cone = mix(1.0, 1.25 * (1.0 - zc), conifer);
    lp = vec3(lp.xy * crownR * cone, height * (0.3 + 0.7 * zc));
    nl = normalize(vec3(nl.xy, nl.z * mix(1.0, 0.5, conifer) + conifer * 0.6));
  }
  if (!present) lp = vec3(0.0);
  float yaw = r1 * 6.2831;
  vec2 cs = vec2(cos(yaw), sin(yaw));
  lp.xy = vec2(cs.x * lp.x - cs.y * lp.y, cs.y * lp.x + cs.x * lp.y);
  nl.xy = vec2(cs.x * nl.x - cs.y * nl.y, cs.y * nl.x + cs.x * nl.y);
  vec3 rel = anchor + ex * lp.x + ey * lp.y + ez * lp.z;
  vRel = rel;
  vNormal = ex * nl.x + ey * nl.y + ez * nl.z;
  vec3 leaf = mix(vec3(0.030, 0.052, 0.018), vec3(0.020, 0.040, 0.016), A.b);
  leaf = mix(leaf, vec3(0.055, 0.050, 0.020), smoothstep(0.7, 0.9, A.a) * (1.0 - A.b));
  leaf = mix(leaf, vec3(0.012, 0.028, 0.018), conifer);
  vCol = aPart < 0.5 ? vec3(0.035, 0.025, 0.016) : leaf * (0.75 + 0.5 * r2);
  vPart = aPart;
  gl_Position = haloProjectRel(rel);
}
`;

const TREE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vCol;
varying float vPart;
void main() {
  vec3 rel = vRel;
  vec3 p = uCamLocal + rel;
  vec3 N = normalize(vNormal);
  vec3 V = -normalize(rel);
  vec3 L = uSunDir;
  vec3 up = haloUp(p);
  vec3 sunVis = haloSunVisibility(p + up * 2.0, L);
  float wrap = vPart > 0.5 ? 0.35 : 0.0;
  float NdL = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
  float trans = vPart > 0.5 ? pow(max(dot(-V, L), 0.0), 4.0) * 0.25 : 0.0;
  float ao = vPart > 0.5 ? 0.7 + 0.3 * max(dot(N, up), 0.0) : 0.6;
  vec3 amb = haloSkyAmbient(p, N) + vec3(uNightAmbient);
  vec3 color = vCol * ao * (uSunColor * sunVis * (NdL + trans) + amb);
  color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

// Prostopadłościan 8-wierzchołkowy (ściana w shaderze z położenia lokalnego):
// x, y ∈ [−0,5; 0,5], z ∈ [0; 1].
const BOX8_POS = [
  [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0],
  [-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]
];
// ściany z nawinięciem przeciwnym do wskazówek zegara patrząc z zewnątrz
const BOX8_IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

function makeGardenChunk(blocks, rows) {
  const count = blocks * rows * 6 * 2;
  const pos = new Float32Array(count * 8 * 3);
  const lot = new Float32Array(count * 8 * 4);
  const idx = new Uint32Array(count * 36);
  let b = 0;
  for (let blk = 0; blk < blocks; blk++) {
    for (let r = 0; r < rows; r++) {
      for (let l = 0; l < 6; l++) {
        for (let tier = 0; tier < 2; tier++) {
          for (let v = 0; v < 8; v++) {
            const k = b * 8 + v;
            pos.set(BOX8_POS[v], k * 3);
            lot[k * 4] = blk;
            lot[k * 4 + 1] = r;
            lot[k * 4 + 2] = l;
            lot[k * 4 + 3] = tier;
          }
          for (let i = 0; i < 36; i++) idx[b * 36 + i] = b * 8 + BOX8_IDX[i];
          b++;
        }
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aLot', new THREE.BufferAttribute(lot, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Walec jednostkowy: promień 1, z ∈ [0, 1], pierścienie pod kształty
// (chłodnia = hiperboloida, komin zwężany), pokrywa u góry.
function makeUnitCylinder(sides = 10, rings = [0, 0.3, 0.6, 0.78, 1.0]) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (let r = 0; r < rings.length; r++) {
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), rings[r]);
      nor.push(Math.cos(a), Math.sin(a), 0);
    }
  }
  const row = sides + 1;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * row + s;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const capStart = pos.length / 3;
  for (let s = 0; s <= sides; s++) {
    const a = s / sides * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 1);
    nor.push(0, 0, 1);
  }
  const center = pos.length / 3;
  pos.push(0, 0, 1);
  nor.push(0, 0, 1);
  for (let s = 0; s < sides; s++) idx.push(capStart + s, capStart + s + 1, center);
  return { pos, nor, idx };
}
function makeUnitBox24() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0, 0.5);
  const pos = Array.from(g.getAttribute('position').array);
  const nor = Array.from(g.getAttribute('normal').array);
  const idx = Array.from(g.index.array);
  g.dispose();
  return { pos, nor, idx };
}

function makeIndustryChunk(blocks, rows) {
  const box = makeUnitBox24();
  const cyl = makeUnitCylinder();
  const lots = blocks * rows * 6;
  const perLot = 2 * box.pos.length / 3 + 3 * cyl.pos.length / 3;
  const idxPerLot = 2 * box.idx.length + 3 * cyl.idx.length;
  const pos = new Float32Array(lots * perLot * 3);
  const nor = new Float32Array(lots * perLot * 3);
  const lot = new Float32Array(lots * perLot * 4);
  const prim = new Float32Array(lots * perLot);
  const idx = new Uint32Array(lots * idxPerLot);
  let v = 0;
  let ii = 0;
  for (let blk = 0; blk < blocks; blk++) {
    for (let r = 0; r < rows; r++) {
      for (let l = 0; l < 6; l++) {
        for (let part = 0; part < IND_PARTS; part++) {
          const src = part < 2 ? box : cyl;
          const base = v;
          const n = src.pos.length / 3;
          for (let k = 0; k < n; k++) {
            pos[v * 3] = src.pos[k * 3]; pos[v * 3 + 1] = src.pos[k * 3 + 1]; pos[v * 3 + 2] = src.pos[k * 3 + 2];
            nor[v * 3] = src.nor[k * 3]; nor[v * 3 + 1] = src.nor[k * 3 + 1]; nor[v * 3 + 2] = src.nor[k * 3 + 2];
            lot[v * 4] = blk; lot[v * 4 + 1] = r; lot[v * 4 + 2] = l; lot[v * 4 + 3] = part;
            prim[v] = part < 2 ? 0 : 1;
            v++;
          }
          for (let k = 0; k < src.idx.length; k++) idx[ii++] = base + src.idx[k];
        }
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aLot', new THREE.BufferAttribute(lot, 4));
  g.setAttribute('aPrim', new THREE.BufferAttribute(prim, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Drzewo: pień (graniastosłup) + korona (z od 0 do 1 w lokalnym z, promień 1).
function makeTree() {
  const trunk = new THREE.CylinderGeometry(1, 1.2, 1, 5, 1, true);
  trunk.rotateX(Math.PI / 2);
  trunk.translate(0, 0, 0.5);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const cp = crown.getAttribute('position');
  for (let i = 0; i < cp.count; i++) cp.setZ(i, cp.getZ(i) * 0.5 + 0.5);
  crown.computeVertexNormals();
  const parts = [trunk, crown].map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [];
  const nor = [];
  const part = [];
  parts.forEach((g, k) => {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      part.push(k);
    }
  });
  trunk.dispose();
  crown.dispose();
  parts.forEach((g) => g.dispose());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return g;
}

function instancedTrees(base, count) {
  const geo = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

// Klasa sektora dla kawałków: czy w sektorze stoją budynki danej klasy.
function sectorHas(sector, cls) {
  if (cls === 'industrial') return sector.type === 'industrial';
  return sector.type === 'garden' || sector.type === 'glass';
}

// Wybór kawałków jednej klasy (bez alokacji: bufory stałe).
export class HaloCityChunkSet {
  constructor({ layout, cls, blocksPerChunk, blocks, maxChunks, mesh = null }) {
    this.layout = layout;
    this.cls = cls;
    this.blocksPerChunk = blocksPerChunk;
    this.maxChunks = maxChunks;
    this.mesh = mesh;
    this.blocks = blocks;
    this.count = Math.ceil(blocks / blocksPerChunk);
    this.blockLen = layout.circumference / blocks;
    this.chunkAngle = this.blockLen * blocksPerChunk / layout.radii.floorMid;
    // maks. wysokość kawałka z planu sektorów (+ margines przenikania typów ~⅓ sektora)
    this.chunkMaxH = new Float32Array(this.count);
    const H = HALO_CITY.maxHeight;
    const secs = layout.sectors;
    const margin = secs[0].span * 0.34;
    for (let c = 0; c < this.count; c++) {
      const th = (c + 0.5) * this.chunkAngle;
      let h = 0;
      for (const d of [-margin, 0, margin]) {
        const s = secs[layout.sectorIndexAt(th + d)];
        if (!sectorHas(s, cls)) continue;
        h = Math.max(h, cls === 'industrial' ? H.industrial : (s.type === 'glass' ? H.glass : H.garden));
      }
      this.chunkMaxH[c] = h;
    }
    // strefy wokół doków i tranzytów (mapy terenu: pas fabryczny → domy) —
    // budynki stoją tam niezależnie od typu sektora (+ zapas na zafalowanie 700 j.)
    if (layout.sigma > 0 && layout.flightLevel !== 'roof') {
      const R = layout.radii.floorMid;
      for (const site of haloPortSites(R)) {
        const zone = cls === 'industrial' ? site.zoneInd : Math.max(site.zoneRes, site.zoneInd);
        if (!(zone > 0)) continue;
        const halfA = (site.halfS + zone * 1.2 + 700) / R + this.chunkAngle;
        for (let c = 0; c < this.count; c++) {
          let d = (c + 0.5) * this.chunkAngle - site.theta;
          d -= HALO_TAU * Math.round(d / HALO_TAU);
          if (Math.abs(d) <= halfA) this.chunkMaxH[c] = Math.max(this.chunkMaxH[c], cls === 'industrial' ? H.industrial : H.garden);
        }
      }
    }
    this.data = new Float32Array(maxChunks);
    this.attr = typeof THREE.InstancedBufferAttribute === 'function' ? new THREE.InstancedBufferAttribute(this.data, 1) : null;
    this.attr?.setUsage(THREE.DynamicDrawUsage);
    this.sel = new Int32Array(maxChunks);
    this.selN = 0;
    this.next = new Int32Array(maxChunks);
    this._sphere = new THREE.Sphere();
    this._c = new THREE.Vector3();
  }

  // Od kawałka kamery na zewnątrz w obie strony — najbliższe pierwsze.
  select(frustum, camLocal, pixelAngle, fade) {
    const L = this.layout;
    let n = 0;
    if (fade > 0.01) {
      const rMid = L.radii.floorMid;
      const zMid = (L.z.topIn + L.z.botIn) * 0.5;
      let th = Math.atan2(camLocal.y, camLocal.x);
      if (th < 0) th += HALO_TAU;
      const c0 = Math.floor(th / this.chunkAngle);
      const half = Math.hypot(this.chunkAngle * rMid * 0.5, L.floor.length * 0.5);
      const minPx = HALO_CITY.minPixels * Math.max(pixelAngle, 1e-6);
      // Horyzont wypukłej podłogi (habitat na zewnątrz): punkt podłogi dalej
      // kątowo niż acos(Rf/Rc) jest za krzywizną — plus zapas na wysokość brył
      // i pół kawałka. Dla Halo (podłoga wklęsła) bez ograniczenia.
      let horizon = Math.PI;
      if (L.sigma > 0) {
        const Rf = Math.min(L.radii.floorBottom, L.radii.floorTop);
        const Rc = Math.max(Math.hypot(camLocal.x, camLocal.y), Rf + 1);
        horizon = Math.acos(Math.min(1, Rf / Rc)) + Math.acos(Rf / (Rf + HALO_CITY.maxHeight.glass)) + this.chunkAngle * 0.5;
      }
      let stopA = false;
      let stopB = false;
      for (let i = 0; i < this.count && n < this.maxChunks && !(stopA && stopB); i++) {
        for (let side = 0; side < 2; side++) {
          if (i === 0 && side === 1) continue;
          if (side === 0 ? stopA : stopB) continue;
          if (i * this.chunkAngle - this.chunkAngle > horizon) {
            if (side === 0) stopA = true; else stopB = true;
            continue;
          }
          const c = ((c0 + (side === 0 ? i : -i)) % this.count + this.count) % this.count;
          const h = this.chunkMaxH[c];
          const cth = (c + 0.5) * this.chunkAngle;
          this._c.set(Math.cos(cth) * rMid, Math.sin(cth) * rMid, zMid);
          const d = Math.max(0, this._c.distanceTo(camLocal) - half);
          // dalej niż zasięg najwyższej bryły w ogóle — koniec w tę stronę
          if (d * minPx > HALO_CITY.maxHeight.glass) {
            if (side === 0) stopA = true; else stopB = true;
            continue;
          }
          if (h <= 0 || d * minPx > h) continue;
          this._sphere.center.copy(this._c);
          this._sphere.radius = half + h + 50;
          if (frustum && !frustum.intersectsSphere(this._sphere)) continue;
          if (n < this.maxChunks) this.next[n++] = c;
        }
      }
    }
    let changed = n !== this.selN;
    if (!changed) for (let i = 0; i < n; i++) if (this.next[i] !== this.sel[i]) { changed = true; break; }
    if (changed) {
      for (let i = 0; i < n; i++) {
        this.sel[i] = this.next[i];
        this.data[i] = this.next[i] * this.blocksPerChunk;
      }
      this.selN = n;
      if (this.attr) {
        this.attr.needsUpdate = true;
        this.attr.clearUpdateRanges();
        this.attr.addUpdateRange(0, Math.max(1, n));
      }
    }
    if (this.mesh) this.mesh.geometry.instanceCount = n;
    return n;
  }
}

export class HaloCity {
  constructor({ layout, uniforms, surfaceUniforms, quality }) {
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'HaloCity';
    const common = { ...uniforms, ...surfaceUniforms };
    const side = layout.sigma > 0 ? THREE.FrontSide : THREE.BackSide;
    this.pixelAngle = { value: 2 * Math.tan(17.5 * Math.PI / 180) / 1080 };
    const Wf = layout.floor.length;
    const C = HALO_CITY;
    const gRows = Math.ceil(Wf / C.gardenBlockT);
    const iRows = Math.ceil(Wf / C.industryBlockT);
    this.gardenGrid = new THREE.Vector4(C.gardenChunkBlocks, gRows, 0, 1);
    this.industryGrid = new THREE.Vector4(C.industryChunkBlocks, iRows, 1, 1);

    const gardenMat = new THREE.ShaderMaterial({
      name: 'HaloCity_garden',
      uniforms: { ...common, uCityGrid: { value: this.gardenGrid }, uPixelAngle: this.pixelAngle },
      vertexShader: GARDEN_VERTEX,
      fragmentShader: HALO_PRIM_FRAGMENT,
      defines: { AIR_STEPS: 4, PRIM_FACE_FROM_LOCAL: 1 },
      side
    });
    const gardenGeo = makeGardenChunk(C.gardenChunkBlocks, gRows);
    const industryMat = new THREE.ShaderMaterial({
      name: 'HaloCity_industry',
      uniforms: { ...common, uCityGrid: { value: this.industryGrid }, uPixelAngle: this.pixelAngle },
      vertexShader: INDUSTRY_VERTEX,
      fragmentShader: HALO_PRIM_FRAGMENT,
      defines: { AIR_STEPS: 4 },
      side
    });
    const industryGeo = makeIndustryChunk(C.industryChunkBlocks, iRows);
    this.materials = [gardenMat, industryMat];
    this.buildings = [];
    const mk = (geo, mat, name) => {
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.buildings.push(mesh);
      return mesh;
    };
    const gardenMesh = mk(gardenGeo, gardenMat, 'HaloCity_garden');
    const industryMesh = mk(industryGeo, industryMat, 'HaloCity_industry');
    const pn = surfaceUniforms.uPatN.value;
    this.garden = new HaloCityChunkSet({ layout, cls: 'garden', blocksPerChunk: C.gardenChunkBlocks, blocks: pn[0], maxChunks: C.maxGardenChunks, mesh: gardenMesh });
    this.industry = new HaloCityChunkSet({ layout, cls: 'industrial', blocksPerChunk: C.industryChunkBlocks, blocks: pn[1], maxChunks: C.maxIndustryChunks, mesh: industryMesh });
    gardenGeo.setAttribute('iChunk', this.garden.attr);
    industryGeo.setAttribute('iChunk', this.industry.attr);
    gardenGeo.instanceCount = 0;
    industryGeo.instanceCount = 0;
    this.gardenVerts = gardenGeo.getAttribute('position').count;
    this.industryVerts = industryGeo.getAttribute('position').count;

    // drzewa
    const hi = quality.gridDiv >= 32;
    this._tree = makeTree();
    const tns = hi ? 128 : 88;
    this.treeGrid = new THREE.Vector4(tns, tns, 16, 0);
    this.treeMaterial = new THREE.ShaderMaterial({
      name: 'HaloTrees',
      uniforms: { ...common, uTreeGrid: { value: this.treeGrid }, uPixelAngle: this.pixelAngle },
      vertexShader: TREE_VERTEX,
      fragmentShader: TREE_FRAGMENT,
      defines: { AIR_STEPS: 4 },
      side
    });
    this.trees = new THREE.Mesh(instancedTrees(this._tree, tns * tns), this.treeMaterial);
    this.trees.name = 'HaloTrees';
    this.trees.frustumCulled = false;
    this.treeCount = tns * tns;
    this.group.add(this.trees);
    this._floor = {};
    this.stats = { gardenChunks: 0, industryChunks: 0, fade: 1 };
  }

  update(camLocal, pixelAngle, frustum) {
    const L = this.layout;
    if (pixelAngle > 0) this.pixelAngle.value = pixelAngle;
    const f = L.worldToFloor(camLocal.x, camLocal.y, camLocal.z, this._floor);
    // odległość kamery od podłogi (z boku wstęgi: od najbliższego brzegu)
    const dz = Math.max(L.z.botIn - camLocal.z, 0, camLocal.z - L.z.topIn);
    const camFloor = Math.hypot(Math.abs(f.alt), dz);
    const C = HALO_CITY;
    const t = Math.min(1, Math.max(0, (camFloor - C.fadeNear) / (C.fadeFar - C.fadeNear)));
    const fade = 1 - t * t * (3 - 2 * t);
    this.gardenGrid.w = fade;
    this.industryGrid.w = fade;
    this.stats.fade = fade;
    this.stats.gardenChunks = this.garden.select(frustum, camLocal, this.pixelAngle.value, fade);
    this.stats.industryChunks = this.industry.select(frustum, camLocal, this.pixelAngle.value, fade);
    const near = L.isInsideAir(camLocal.x, camLocal.y, camLocal.z) || Math.abs(f.alt) < 2500;
    this.trees.geometry.instanceCount = near ? this.treeCount : 0;
    this.treeGrid.w = Math.min(Math.max(f.t, 0), L.floor.length);
  }

  get meshes() {
    return [...this.buildings, this.trees];
  }

  dispose() {
    for (const b of this.buildings) b.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.trees.geometry.dispose();
    this.treeMaterial.dispose();
    this._tree.dispose();
  }
}
