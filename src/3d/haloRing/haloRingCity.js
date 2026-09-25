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
import { HALO_TAU, haloPortSites, haloQualityLod } from './haloRingConfig.js';
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
uniform vec2 uBldPx;         // budynek opada miedzy N a M px (LOD jakosci)
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
  float k = smoothstep(uBldPx.x, uBldPx.y, px) * uCityGrid.w;
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
uniform vec2 uBldPx;
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
  float k = smoothstep(uBldPx.x, uBldPx.y, px) * uCityGrid.w;
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

// Drzewa: slot siatki wokół kamery (co 16 j.), gęstość z mapy lasu (też
// kępy i pojedyncze drzewa parków), nabrzeży i ogrodów miasta. Gatunek z
// klimatu (geometria: makeTreeKit): chłód → iglaste, tropiki i ciepłe plaże
// → palmy, nad rzeką i losowo → topole, reszta liściaste (część w odmianach
// ozdobnych: miedź, złoto — więcej w chłodniejszych sektorach).
const TREE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${GLSL_FLOOR_FRAME}
uniform vec4 uTreeGrid;        // sloty wzdluz, sloty w poprzek, krok [j.], t srodka siatki
uniform float uPixelAngle;
uniform float uTreePx;       // drzewo rysowane od N px (LOD jakosci)
attribute float aSpecies;      // -1 pien (wspolny), 0 lisciaste, 1 iglaste, 2 topola, 3 palma
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vCol;
varying float vPart;
void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vRel = vec3(0.0); vNormal = vec3(0.0, 0.0, 1.0); vCol = vec3(0.0); vPart = 0.0;
}
// gatunek z klimatu (A: h, odleglosc od rzeki, wilgoc, temperatura) i losu slotu
float treeSpecies(vec4 A, float r3, float r4) {
  float coldK = 1.0 - smoothstep(0.36, 0.48, A.a);
  float palmK = max(smoothstep(0.68, 0.8, A.a) * smoothstep(0.45, 0.6, A.b),
    smoothstep(0.6, 0.66, A.a) * smoothstep(14.0, 5.0, A.r) * smoothstep(0.55, 0.7, A.b));
  float poplarK = 0.1 + 0.35 * smoothstep(60.0, 15.0, A.g);
  if (r3 < coldK) return 1.0;
  if (r4 < palmK) return 3.0;
  if (r4 > 1.0 - poplarK) return 2.0;
  return 0.0;
}
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
  vec2 cid = vec2(mod(cellS, 65536.0), cellT);
  vec2 j = haloHash22(cid + 0.37);
  float sAbsCell = (cellS + j.x) * step0;
  float sRel = sAbsCell - uRefBasis.w;
  float t = (cellT + j.y) * step0;
  vec2 uvMap = haloMapUV(sRel + uRefBasis.w, t);
  vec4 A = textureLod(uMapA, uvMap, 0.0);
  float r3 = haloHash12(cid + 13.3);
  float r4 = haloHash12(cid + 17.9);
  float species = treeSpecies(A, r3, r4);
  // wierzcholki innych gatunkow do kosza zaraz po mapie A (tanio)
  if (aSpecies > -0.5 && abs(aSpecies - species) > 0.5) { collapse(); return; }
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
  float r1 = haloHash12(cid + 5.1);
  float r2 = haloHash12(cid + 9.7);
  if (r1 >= density) { collapse(); return; }
  // wymiary gatunku: wysokosc [j.], pien (promien, wysokosc) w ulamkach wysokosci
  float height = mix(7.0, 15.0, r2);
  vec2 trunk = vec2(0.05, 0.5);
  if (species > 2.5) { height = mix(9.0, 17.0, r2); trunk = vec2(0.024, 0.93); }
  else if (species > 1.5) { height = mix(12.0, 22.0, r2); trunk = vec2(0.03, 0.2); }
  else if (species > 0.5) { height = mix(9.5, 20.0, r2); trunk = vec2(0.035, 0.3); }
  vec3 anchor = cityFloorRel(sRel, t, max(h, 0.0) - 1.0);
  if (height / max(length(anchor), 1.0) <= uTreePx * uPixelAngle) { collapse(); return; }
  vec3 ex;
  vec3 ey;
  vec3 ez;
  cityFrame(sRel, ex, ey, ez);
  vec3 lp = position;
  vec3 nl = normal;
  if (aSpecies < -0.5) {
    lp = vec3(lp.xy * trunk.x, lp.z * trunk.y) * height;
  } else {
    float wj = mix(0.85, 1.2, fract(r2 * 7.7 + r3));
    lp = vec3(lp.xy * wj, lp.z) * height;
    nl = normalize(vec3(nl.xy / wj, nl.z));
  }
  // palma: pien lekko wygiety, pioropusz na jego szczycie
  if (species > 2.5) {
    float zc = aSpecies < -0.5 ? position.z : 1.0;
    float ang = r4 * 97.0;
    lp.xy += vec2(cos(ang), sin(ang)) * (0.04 + 0.1 * r3) * height * zc * zc;
  }
  float yaw = fract(r1 * 13.7 + r3) * 6.2831;
  vec2 cs = vec2(cos(yaw), sin(yaw));
  lp.xy = vec2(cs.x * lp.x - cs.y * lp.y, cs.y * lp.x + cs.x * lp.y);
  nl.xy = vec2(cs.x * nl.x - cs.y * nl.y, cs.y * nl.x + cs.x * nl.y);
  vec3 rel = anchor + ex * lp.x + ey * lp.y + ez * lp.z;
  vRel = rel;
  vNormal = ex * nl.x + ey * nl.y + ez * nl.z;
  // barwy (albedo liniowe): lisciaste wg wilgoci i suszy, czesc w odmianach
  // ozdobnych; iglaste sine, topola jasniejsza, palma zolto-zielona na jasnym pniu
  vec3 leaf = mix(vec3(0.030, 0.052, 0.018), vec3(0.020, 0.040, 0.016), A.b);
  leaf = mix(leaf, vec3(0.055, 0.050, 0.020), smoothstep(0.7, 0.9, A.a) * (1.0 - A.b));
  vec3 bark = vec3(0.035, 0.025, 0.016);
  if (species < 0.5) {
    float orn = 0.06 + 0.2 * smoothstep(0.56, 0.44, A.a);
    float ro = fract(r2 * 13.1 + r4 * 3.7);
    if (ro < orn) leaf = ro < orn * 0.5 ? vec3(0.072, 0.028, 0.014) : vec3(0.080, 0.062, 0.016);
  } else if (species < 1.5) {
    leaf = vec3(0.012, 0.028, 0.018);
    bark = vec3(0.028, 0.019, 0.013);
  } else if (species < 2.5) {
    leaf = mix(leaf, vec3(0.040, 0.064, 0.020), 0.5);
  } else {
    leaf = vec3(0.038, 0.064, 0.020);
    bark = vec3(0.075, 0.062, 0.044);
  }
  vCol = aSpecies < -0.5 ? bark : leaf * (0.75 + 0.5 * r2);
  vPart = aSpecies < -0.5 ? 0.0 : 1.0;
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

// Gatunki drzew: jedna geometria indeksowana (~190 wierzchołków — mniej niż
// dawna korona z ikosaedru bez indeksów). Shader zostawia pień i koronę
// gatunku wylosowanego w slocie, wierzchołki pozostałych zapadają się zaraz
// po odczycie mapy A. Pień (−1) = walec o promieniu i wysokości 1 (skala z
// gatunku w shaderze); korony w ułamkach wysokości drzewa (z: 0 podłoga, 1 czubek).
export const HALO_TREE_SPECIES = Object.freeze(['broadleaf', 'conifer', 'poplar', 'palm']);

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_POS = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
  [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
  [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1]
];
const ICO_IDX = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
];
// stały „szum” wierzchołków (nieregularne korony; obrót instancji ukrywa powtórzenie)
const treeJit = (k) => {
  const x = Math.sin(k * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

export function makeTreeKit() {
  const pos = [];
  const nor = [];
  const spc = [];
  const idx = [];
  const vert = (species, p, n) => {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0] / l, n[1] / l, n[2] / l);
    spc.push(species);
    return spc.length - 1;
  };
  const tri = (a, b, c) => idx.push(a, b, c);
  // pierścienie wokół osi z: [z, promień, składowa pionowa normalnej, rozrzut promienia]
  const lathe = (species, sides, rings, rot = 0) => {
    const start = spc.length;
    rings.forEach(([z, r, nz, jit = 0], k) => {
      for (let s = 0; s < sides; s++) {
        const a = rot + s / sides * Math.PI * 2;
        const rr = r * (1 + jit * (treeJit(start + k * 17 + s) - 0.5));
        vert(species, [Math.cos(a) * rr, Math.sin(a) * rr, z], [Math.cos(a), Math.sin(a), nz]);
      }
    });
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let s = 0; s < sides; s++) {
        const a = start + k * sides + s;
        const b = start + k * sides + (s + 1) % sides;
        tri(a, b, b + sides);
        tri(a, b + sides, a + sides);
      }
    }
    return start;
  };
  const capTop = (species, ring, sides, apex) => {
    const c = vert(species, apex, [0, 0, 1]);
    for (let s = 0; s < sides; s++) tri(ring + s, ring + (s + 1) % sides, c);
  };
  const capBottom = (species, ring, sides, center) => {
    const c = vert(species, center, [0, 0, -1]);
    for (let s = 0; s < sides; s++) tri(c, ring + (s + 1) % sides, ring + s);
  };

  // pień: graniastosłup 5-boczny zwężany ku górze (3 pierścienie: palma się gnie)
  lathe(-1, 5, [[0, 1, 0], [0.5, 0.85, 0], [1, 0.7, 0]]);

  // 0 liściaste: cztery nieregularne kule (ikosaedr) — szczyt + trzy niżej wokół
  const lobes = [[0, 0, 0.7, 0.3, 0.27]];
  for (let k = 0; k < 3; k++) {
    const a = 0.35 + k * Math.PI * 2 / 3;
    lobes.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.5 + 0.03 * k, 0.215 - 0.008 * k, 0.185]);
  }
  lobes.forEach(([cx, cy, cz, rh, rv], li) => {
    const start = spc.length;
    ICO_POS.forEach((v, k) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      const u = [v[0] / l, v[1] / l, v[2] / l];
      const j = 0.9 + 0.2 * treeJit(li * 31 + k);
      vert(0, [cx + u[0] * rh * j, cy + u[1] * rh * j, cz + u[2] * rv * j], [u[0] / rh, u[1] / rh, u[2] / rv]);
    });
    for (let i = 0; i < ICO_IDX.length; i += 3) tri(start + ICO_IDX[i], start + ICO_IDX[i + 1], start + ICO_IDX[i + 2]);
  });

  // 1 iglaste: trzy piętra stożków (spód lekko wklęsły), piętra obrócone
  [[0.12, 0.62, 0.3], [0.36, 0.84, 0.23], [0.6, 1.0, 0.15]].forEach(([zb, zt, r], k) => {
    const rot = k * 0.45;
    const side = lathe(1, 7, [[zb, r, r / (zt - zb), 0.22]], rot);
    capTop(1, side, 7, [0, 0, zt]);
    const under = spc.length;
    for (let s = 0; s < 7; s++) {
      const p = [pos[(side + s) * 3], pos[(side + s) * 3 + 1], zb];
      vert(1, p, [p[0] * 0.3, p[1] * 0.3, -1]);
    }
    capBottom(1, under, 7, [0, 0, zb + 0.05]);
  });

  // 2 topola: wrzeciono (profil jak topola włoska), wąska i wysoka
  const prof = [[0.1, 0.03], [0.22, 0.1], [0.4, 0.13], [0.62, 0.11], [0.82, 0.065]];
  const pz = [...prof.map((p) => p[0]), 1];
  const pr = [...prof.map((p) => p[1]), 0];
  const ring0 = lathe(2, 6, prof.map(([z, r], k) => {
    const a = Math.max(k - 1, 0);
    const b = k + 1;
    return [z, r, -(pr[b] - pr[a]) / (pz[b] - pz[a]), 0.12];
  }), 0.3);
  capTop(2, ring0 + (prof.length - 1) * 6, 6, [0, 0, 1]);
  capBottom(2, ring0, 6, [0, 0, 0.08]);

  // 3 palma: 7 liści-pióropuszy z czubka pnia (z = 0,93), łuk w górę i opadanie;
  // przekrój Λ (nerw wyżej niż brzegi listków) zamknięty spodem — widać z obu stron
  const nF = 7;
  for (let f = 0; f < nF; f++) {
    const a = f / nF * Math.PI * 2 + (f % 2) * 0.2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const S = [-dy, dx, 0];
    const Lf = 0.42 * (0.85 + 0.3 * treeJit(f * 7 + 3));
    const at = (u) => [dx * Lf * u, dy * Lf * u, 0.935 + Lf * (0.55 * u - 0.95 * u * u)];
    const frame = (u) => {
      const p0 = at(u - 0.02);
      const p1 = at(u + 0.02);
      const T = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const l = Math.hypot(T[0], T[1], T[2]);
      const t = [T[0] / l, T[1] / l, T[2] / l];
      // góra liścia = T × S
      const N = [t[1] * S[2] - t[2] * S[1], t[2] * S[0] - t[0] * S[2], t[0] * S[1] - t[1] * S[0]];
      return { P: at(u), N };
    };
    const sec = [];
    for (const u of [0.12, 0.55]) {
      const { P, N } = frame(u);
      const w = 0.07 * Math.sin(Math.PI * Math.min(u * 1.1, 1));
      const drop = w * 0.35;
      const M = vert(3, P, N);
      const Lv = vert(3, [P[0] + S[0] * w - N[0] * drop, P[1] + S[1] * w - N[1] * drop, P[2] - N[2] * drop], [N[0] + S[0] * 0.35, N[1] + S[1] * 0.35, N[2]]);
      const Rv = vert(3, [P[0] - S[0] * w - N[0] * drop, P[1] - S[1] * w - N[1] * drop, P[2] - N[2] * drop], [N[0] - S[0] * 0.35, N[1] - S[1] * 0.35, N[2]]);
      sec.push({ M, L: Lv, R: Rv });
    }
    const tip = frame(0.98);
    const Tp = vert(3, at(1), tip.N);
    const [i, j] = sec;
    tri(i.M, j.M, j.L); tri(i.M, j.L, i.L);
    tri(i.R, j.R, j.M); tri(i.R, j.M, i.M);
    tri(i.L, j.L, j.R); tri(i.L, j.R, i.R);
    tri(j.M, Tp, j.L); tri(j.R, Tp, j.M); tri(j.L, Tp, j.R);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSpecies', new THREE.Float32BufferAttribute(spc, 1));
  g.setIndex(idx);
  return g;
}

function instancedTrees(base, count) {
  const geo = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(base.index);
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
  constructor({ layout, cls, blocksPerChunk, blocks, maxChunks, mesh = null, minPixels = HALO_CITY.minPixels }) {
    this.layout = layout;
    this.cls = cls;
    this.blocksPerChunk = blocksPerChunk;
    this.maxChunks = maxChunks;
    this.minPixels = minPixels;
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
      const minPx = this.minPixels * Math.max(pixelAngle, 1e-6);
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
    // progi LOD z jakości (tryb ultra: dalej, więcej kawałków i drzew)
    const lod = haloQualityLod(quality);
    this.lod = lod;
    this.bldPx = { value: new THREE.Vector2(lod.buildingPixels[0], lod.buildingPixels[1]) };
    this.treePx = { value: lod.treePixels };
    const gRows = Math.ceil(Wf / C.gardenBlockT);
    const iRows = Math.ceil(Wf / C.industryBlockT);
    this.gardenGrid = new THREE.Vector4(C.gardenChunkBlocks, gRows, 0, 1);
    this.industryGrid = new THREE.Vector4(C.industryChunkBlocks, iRows, 1, 1);

    const gardenMat = new THREE.ShaderMaterial({
      name: 'HaloCity_garden',
      uniforms: { ...common, uCityGrid: { value: this.gardenGrid }, uPixelAngle: this.pixelAngle, uBldPx: this.bldPx },
      vertexShader: GARDEN_VERTEX,
      fragmentShader: HALO_PRIM_FRAGMENT,
      defines: { AIR_STEPS: 4, PRIM_FACE_FROM_LOCAL: 1 },
      side
    });
    const gardenGeo = makeGardenChunk(C.gardenChunkBlocks, gRows);
    const industryMat = new THREE.ShaderMaterial({
      name: 'HaloCity_industry',
      uniforms: { ...common, uCityGrid: { value: this.industryGrid }, uPixelAngle: this.pixelAngle, uBldPx: this.bldPx },
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
    this.garden = new HaloCityChunkSet({ layout, cls: 'garden', blocksPerChunk: C.gardenChunkBlocks, blocks: pn[0], maxChunks: lod.cityChunks[0], mesh: gardenMesh, minPixels: lod.cityMinPixels });
    this.industry = new HaloCityChunkSet({ layout, cls: 'industrial', blocksPerChunk: C.industryChunkBlocks, blocks: pn[1], maxChunks: lod.cityChunks[1], mesh: industryMesh, minPixels: lod.cityMinPixels });
    gardenGeo.setAttribute('iChunk', this.garden.attr);
    industryGeo.setAttribute('iChunk', this.industry.attr);
    gardenGeo.instanceCount = 0;
    industryGeo.instanceCount = 0;
    this.gardenVerts = gardenGeo.getAttribute('position').count;
    this.industryVerts = industryGeo.getAttribute('position').count;

    // drzewa
    this._tree = makeTreeKit();
    const tns = lod.treeGrid;
    this.treeGrid = new THREE.Vector4(tns, tns, 16, 0);
    this.treeMaterial = new THREE.ShaderMaterial({
      name: 'HaloTrees',
      uniforms: { ...common, uTreeGrid: { value: this.treeGrid }, uPixelAngle: this.pixelAngle, uTreePx: this.treePx },
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
    const fadeNear = this.lod.cityFade[0];
    const fadeFar = this.lod.cityFade[1];
    const t = Math.min(1, Math.max(0, (camFloor - fadeNear) / (fadeFar - fadeNear)));
    const fade = 1 - t * t * (3 - 2 * t);
    this.gardenGrid.w = fade;
    this.industryGrid.w = fade;
    this.stats.fade = fade;
    this.stats.gardenChunks = this.garden.select(frustum, camLocal, this.pixelAngle.value, fade);
    this.stats.industryChunks = this.industry.select(frustum, camLocal, this.pixelAngle.value, fade);
    const near = L.isInsideAir(camLocal.x, camLocal.y, camLocal.z) || Math.abs(f.alt) < this.lod.treeAltitude;
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
