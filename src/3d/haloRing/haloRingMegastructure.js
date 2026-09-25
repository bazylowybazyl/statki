// Megastruktura z bliska (M3): bryły dachu, kratownice, kolej, doki portu,
// światła pozycyjne i pociągi. Plan (co i gdzie) liczy haloRingRoofPlan.js;
// tu tylko render: 3 instancjonowane bryły (prostopadłościan, walec,
// kopuła), billboardy świateł i wagony. Dach (detal, pociągi, światła dachu)
// i doki (punkty orientacyjne + ich światła) to osobne siatki: przy
// płaszczyźnie gry na środku wstęgi dach leży NAD statkami (FG, znika nad
// graczem), a doki w płaszczyźnie gry pod nimi (BG). ≤ 9 draw calli.
//
// Instancje leżą w statycznych tablicach posortowanych po segmentach.
// Co klatkę wybór segmentów (frustum + odległość dla detalu) — dopiero gdy
// ZMIENI się wybór, zakresy segmentów kopiuje się do dynamicznego bufora
// (gotowe widoki subarray, zero alokacji). Pozycja w shaderze względem kamery
// (RTE): (segment − refS) liczone na liczbach całkowitych, jak pasy konstrukcji.
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_FG,
  HALO_GLSL_FG_CLIP,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_RTE
} from './haloRingGLSL.js';
import { HALO_HDR, haloQualityLod } from './haloRingConfig.js';
import { HALO_GLSL_SURFACE } from './haloRingTerrain.js';
import { HALO_INSTANCE_STRIDE, HALO_LIGHT_STRIDE, HALO_PRIM_NAMES, HALO_TRAIN_STRIDE } from './haloRingRoofPlan.js';

const f3 = (a) => a.map((x) => x.toFixed(3)).join(', ');

const PRIM_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
uniform float uSegCells;
uniform vec2 uGeomFade;        // odleglosc: pelny detal / brak detalu
attribute vec4 iPos;           // segment, wzdluz [j.], dr, z
attribute vec4 iSize;          // x, y, z, material (+256 = punkt orientacyjny, bez zaniku)
attribute vec4 iQuat;
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;           // wspolrzedne bryly [j.] (z od podstawy)
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;

vec3 qrot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  float cells = iPos.x * uSegCells - uGridInfo.w;
  cells -= uGridInfo.z * floor(cells / uGridInfo.z + 0.5);
  float sRel = cells * uGridInfo.x + iPos.y;
  float dTheta = sRel / uFloorDims.z;
  vec3 anchor = haloRelFromPolar(dTheta, iPos.z, iPos.w);
  float th = uRefBasis.z + dTheta;
  vec3 et = vec3(-sin(th), cos(th), 0.0);
  vec3 er = vec3(cos(th), sin(th), 0.0);
  float mat = iSize.w;
  float seed = fract(iPos.y * 0.01737 + iPos.x * 0.61803 + iPos.w * 0.0131);
  // zanik detalu z odlegloscia: obiekty znikaja po kolei (prog z haszu),
  // dach i tak rysuje ich odcisk z cieniem
  float fade = mat > 255.5 ? 1.0 : 1.0 - smoothstep(uGeomFade.x, uGeomFade.y, length(anchor));
  float keep = step(seed * 0.999, fade);
  vec3 local = position * iSize.xyz * keep;
  vec3 lr = qrot(iQuat, local);
  vec3 rel = anchor + et * lr.x + er * lr.y + vec3(0.0, 0.0, lr.z);
  vec3 nl = normalize(normal / max(iSize.xyz, vec3(1e-3)));
  vec3 nr = qrot(iQuat, nl);
  vRel = rel;
  vNormal = et * nr.x + er * nr.y + vec3(0.0, 0.0, nr.z);
  vLocal = position * iSize.xyz;
  vLocalN = normal;
  vSize = iSize.xyz;
  vMat = mat - 256.0 * floor((mat + 0.5) / 256.0);
  vSeed = seed;
  gl_Position = haloProjectRel(rel);
}
`;

const TRAIN_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
attribute vec4 iTrainA;        // d od krawedzi, s0, predkosc, dlugosc wagonu
attribute vec4 iTrainB;        // indeks wagonu, szerokosc, wysokosc, wariant
uniform vec4 uTrainLane;       // rim, sigma, z dachu + estakada, obwod L
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;
void main() {
  float L = uTrainLane.w;
  float dir = sign(iTrainA.z);
  float carLen = iTrainA.w;
  float sAbs = iTrainA.y + mod(iTrainA.z * uTime, L) - dir * iTrainB.x * (carLen + 6.0);
  float sRel = mod(sAbs - uRefBasis.w + 0.5 * L, L) - 0.5 * L;
  float r = uTrainLane.x - uTrainLane.y * iTrainA.x;
  float dTheta = sRel / uFloorDims.z;
  vec3 anchor = haloRelFromPolar(dTheta, r - uFloorDims.z, uTrainLane.z);
  float th = uRefBasis.z + dTheta;
  vec3 et = vec3(-sin(th), cos(th), 0.0);
  vec3 er = vec3(cos(th), sin(th), 0.0);
  vec3 size = vec3(carLen, iTrainB.y, iTrainB.z);
  vec3 lp = position * size;
  vRel = anchor + et * lp.x + er * lp.y + vec3(0.0, 0.0, lp.z);
  vNormal = et * normal.x + er * normal.y + vec3(0.0, 0.0, normal.z);
  vLocal = lp * vec3(dir, 1.0, 1.0);
  vLocalN = normal * vec3(dir, 1.0, 1.0);
  vSize = size;
  // wagon czolowy ma reflektory: material 13 (pociag) + 32 * (1 = czolo)
  vMat = 13.0 + (iTrainB.x < 0.5 ? 32.0 : 0.0);
  vSeed = fract(iTrainA.y * 0.0137);
  gl_Position = haloProjectRel(vRel);
}
`;

export const HALO_PRIM_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;
#ifdef PRIM_FACE_FROM_LOCAL
// bryly 8-wierzcholkowe (budynki miasta): sciana z polozenia lokalnego,
// baza lokalna bryly w swiecie przekazana z wierzcholka
varying vec3 vEx;
varying vec3 vEy;
varying vec3 vEz;
#endif

vec3 palette(float pal, float seed) {
  if (pal < 0.5) return vec3(0.150, 0.152, 0.156);        // jasny dach
  if (pal < 1.5) return vec3(0.090, 0.092, 0.097);        // sredni
  if (pal < 2.5) return vec3(0.030, 0.032, 0.036);        // ciemny
  if (pal < 3.5) return vec3(0.300, 0.302, 0.300);        // bialy panel
  if (pal < 4.5) return vec3(0.120, 0.082, 0.060);        // rdza przemyslu
  if (pal < 5.5) return vec3(0.055, 0.058, 0.064);        // stal kratownic
  if (pal < 6.5) return vec3(0.330, 0.230, 0.040);        // zolty (suwnice, chwytaki)
  if (pal < 7.5) return vec3(0.040, 0.055, 0.070);        // szklo
  if (pal < 8.5) return vec3(0.070, 0.072, 0.076);        // poklad zatoki
  if (pal < 9.5) return vec3(0.200, 0.205, 0.210);        // tunel
  if (pal < 10.5) return vec3(0.190, 0.060, 0.035);       // kontener czerwony
  if (pal < 11.5) return vec3(0.030, 0.080, 0.150);       // kontener niebieski
  if (pal < 12.5) return vec3(0.160, 0.120, 0.050);       // kontener ochra
  if (pal < 13.5) return vec3(0.230, 0.235, 0.245);       // pociag
  if (pal < 14.5) return vec3(0.280, 0.282, 0.275);       // fasada biala (dach zielony)
  if (pal < 15.5) return vec3(0.260, 0.235, 0.200);       // fasada kremowa (dachowka)
  if (pal < 16.5) return vec3(0.160, 0.160, 0.150);       // beton
  if (pal < 17.5) return vec3(0.280, 0.280, 0.260);       // beton jasny (chlodnia)
  if (pal < 18.5) return vec3(0.130, 0.110, 0.095);       // hala szedowa (sciany)
  if (pal < 19.5) return vec3(0.040, 0.040, 0.042);       // komin
  if (pal < 20.5) return vec3(0.290, 0.292, 0.290);       // zbiornik
  if (pal < 21.5) return vec3(0.230, 0.230, 0.220);       // silos
  if (pal < 22.5) return vec3(0.160, 0.120, 0.080);       // kontenery
  if (pal < 23.5) return vec3(0.120, 0.130, 0.140);       // rury, stal gladka
  // megabudowle (haloRingLandmarks.js)
  if (pal < 24.5) return vec3(0.310, 0.290, 0.255);       // kamien (podium, zebra, plyty)
  if (pal < 25.5) return vec3(0.300, 0.220, 0.105);       // mosiadz (szprosy, maszty)
  if (pal < 26.5) return vec3(0.300, 0.280, 0.240);       // pas swietlny (swieci)
  if (pal < 27.5) return vec3(0.270, 0.235, 0.190);       // rama fasady cieplej (piaskowiec)
  if (pal < 28.5) return vec3(0.170, 0.200, 0.235);       // rama fasady chlodnej (stal)
  return vec3(0.120, 0.130, 0.140);
}

void main() {
  vec3 rel = vRel;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  vec3 p = uCamLocal + rel;
  haloFgClip(p);
#ifdef PRIM_FACE_FROM_LOCAL
  vec3 qn = vLocal / max(vSize, vec3(1e-3));
  vec3 dq = vec3(0.5 - abs(qn.x), 0.5 - abs(qn.y), min(qn.z, 1.0 - qn.z)) * vSize;
  vec3 lN = dq.z < min(dq.x, dq.y) ? vec3(0.0, 0.0, qn.z > 0.5 ? 1.0 : -1.0)
    : (dq.x < dq.y ? vec3(sign(qn.x), 0.0, 0.0) : vec3(0.0, sign(qn.y), 0.0));
  vec3 N = normalize(vEx * lN.x + vEy * lN.y + vEz * lN.z);
#else
  vec3 lN = vLocalN;
  vec3 N = normalize(vNormal);
#endif
  // dekodowanie kodu materialu na liczbach calkowitych z zapasem 0,5:
  // mod()/dzielenie w ANGLE/D3D ida przez przyblizone odwrotnosci i 64/32
  // potrafi dac 1,9999 -> zla paleta (brazowe dachy szarych bryl)
  float matI = floor(vMat + 0.5);
  float emitK = floor((matI + 0.5) / 32.0);
  float pal = matI - 32.0 * emitK;
  vec3 base = palette(pal, vSeed);
  // megabudowle: jedna barwa na budowle (czesci nie rozjezdzaja sie w laty)
  base *= pal > 23.5 ? 0.96 + 0.08 * vSeed : 0.85 + 0.3 * vSeed;
  bool top = lN.z > 0.5;
  if (top && pal > 13.5 && pal < 14.5) base = vec3(0.040, 0.070, 0.028) * (0.8 + 0.4 * vSeed);   // dach-ogrod
  if (top && pal > 14.5 && pal < 15.5) base = vec3(0.160, 0.105, 0.080);                            // dachowka
  // krawedzie bryly: fazka jasniejsza, szczeliny paneli ciemniejsze
  vec3 halfS = vSize * vec3(0.5, 0.5, 1.0);
  vec3 lc = vec3(vLocal.x, vLocal.y, vLocal.z - 0.5 * vSize.z);
  vec3 edgeD3 = halfS * vec3(1.0, 1.0, 0.5) - abs(lc);
  float edgeD = top ? min(edgeD3.x, edgeD3.y) : min(abs(lN.x) > 0.5 ? edgeD3.y : edgeD3.x, edgeD3.z);
  float fw = max(fwidth(vLocal.x) + fwidth(vLocal.y) + fwidth(vLocal.z), 1e-3);
  float bevel = 1.0 - smoothstep(0.0, 1.8 + fw, edgeD);
  vec2 fuv = top ? vLocal.xy : vec2(abs(lN.x) > 0.5 ? vLocal.y : vLocal.x, vLocal.z);
  // plyty rosna z bryla: kontener ma drobne panele, sciana doku - wielkie
  vec2 panelS = vec2(9.0, 7.0) * clamp(min(vSize.x, min(vSize.y, vSize.z)) / 40.0, 1.0, 8.0);
  vec2 pg = abs(fract(fuv / panelS) - 0.5);
  float seamW = 0.03 + fw * 0.08;
  // szczeliny paneli: 1 na szczelinie, gasna z odlegloscia (srednia ~bez zmian)
  float seamLine = smoothstep(0.5 - seamW, 0.5, max(pg.x, pg.y)) * (1.0 - smoothstep(0.6, 2.5, fw));
  float panel = haloHash12(floor(fuv / panelS) + vSeed * 91.0);
  vec3 albedo = base * (0.9 + 0.2 * mix(panel, 0.5, smoothstep(0.6, 2.5, fw)));
  albedo *= 1.0 - 0.45 * seamLine;
  albedo = mix(albedo, albedo * 1.6 + 0.02, bevel * 0.6);
  // kontakt z dachem: przy podstawie ciemniej
  float ao = mix(0.5, 1.0, smoothstep(0.0, 10.0, vLocal.z)) * (top ? 1.0 : 0.92);
  // ---- przemysl (M4 v2): walce i hale z zestawu dzialki (haloRingIndustryKit.js)
  float tH = vLocal.z / max(vSize.z, 1e-3);
  float ang = atan(vLocal.y, vLocal.x);
  float indEmit = 0.0;
  if (pal > 16.5 && pal < 17.5) {
    // chlodnia: beton z pionowymi smugami, u gory ciemny otwor
    float streak = haloHash12(vec2(floor(ang * 9.0), vSeed * 31.0));
    albedo = top ? vec3(0.012, 0.013, 0.015) : base * (0.82 + 0.2 * streak) * (0.88 + 0.12 * smoothstep(0.0, 0.25, tH));
  } else if (pal > 17.5 && pal < 18.5) {
    if (top) {
      // dach szedowy: pasy swietlikow co 9 j. (jasne szklo / ciemna blacha)
      float saw = fract(vLocal.x / 9.0);
      float glassS = 1.0 - step(0.38, saw);
      albedo = mix(vec3(0.20, 0.21, 0.22), vec3(0.03, 0.04, 0.05), glassS * (1.0 - smoothstep(0.8, 2.5, fw)));
      albedo = mix(albedo, vec3(0.11), smoothstep(0.8, 2.5, fw));
      indEmit = glassS * (1.0 - smoothstep(0.8, 2.5, fw));
    } else {
      float band = step(0.45, tH) * step(tH, 0.7);
      albedo = mix(base, vec3(0.03, 0.035, 0.04), band * 0.8);
    }
  } else if (pal > 18.5 && pal < 19.5) {
    // komin: ciemny, u gory pasy czerwono-biale (ostrzegawcze)
    float rb = step(0.80, tH) * step(tH, 0.97);
    float white = step(0.5, fract((tH - 0.80) / 0.17 * 3.0 * 0.5));
    albedo = mix(base, mix(vec3(0.20, 0.03, 0.02), vec3(0.28), white), rb);
    if (top) albedo = vec3(0.01);
  } else if (pal > 19.5 && pal < 20.5) {
    // zbiornik: obrecze co 6 j., czesc zbiornikow szara
    albedo = base * mix(1.0, 0.72, step(0.62, vSeed));
    float ring = 1.0 - smoothstep(0.3, 0.3 + fw, abs(fract(vLocal.z / 6.0) - 0.5) * 6.0 - 2.6);
    albedo *= 1.0 - 0.18 * ring * (top ? 0.0 : 1.0);
    if (top) albedo *= 0.85 + 0.15 * smoothstep(vSize.x * 0.5, vSize.x * 0.35, length(vLocal.xy));
  } else if (pal > 20.5 && pal < 21.5) {
    // silos: pionowe szwy segmentow
    float seamS = 1.0 - smoothstep(0.02, 0.04 + fw * 0.02, abs(fract(ang * 16.0 / 6.2832) - 0.5) - 0.44);
    albedo = base * (1.0 - 0.2 * seamS * (top ? 0.0 : 1.0));
  } else if (pal > 21.5 && pal < 22.5) {
    // kontenery: kolor per kontener (12,2 × 2,6 j. na stos), zebra blach
    vec2 cc = floor(vec2(vLocal.x / 12.2, vLocal.z / 2.6) + 40.0);
    float kc = haloHash12(cc + vec2(floor(vLocal.y / 6.5), vSeed * 17.0));
    vec3 cc3 = kc < 0.25 ? vec3(0.19, 0.06, 0.035) : (kc < 0.5 ? vec3(0.03, 0.08, 0.15) : (kc < 0.75 ? vec3(0.16, 0.12, 0.05) : vec3(0.26)));
    float rib = step(0.5, fract(vLocal.x / 0.8)) * (1.0 - smoothstep(0.3, 1.0, fw));
    float gap = 1.0 - smoothstep(0.08, 0.08 + fw * 0.2, abs(fract(vLocal.x / 12.2) - 0.5) - 0.42);
    albedo = cc3 * (0.9 + 0.1 * rib) * (1.0 - 0.6 * gap);
  }

  vec3 emit = vec3(0.0);
  float facadeGlass = 0.0;
  vec3 L = uSunDir;
  vec3 sunVis = haloSunVisibility(p + N * 2.0, L);
  // „góra” bryły: w powietrzu habitatu kierunek mieszkańców, poza nim +Z
  bool inAir = haloAltitude(p) > -60.0 && haloAltitude(p) < uFloorDims.w && p.z < uRingZ.y && p.z > uRingZ.z;
  vec3 upW = inAir ? haloUp(p) : vec3(0.0, 0.0, 1.0);
  float dayG = haloLuma(haloPlanetTransmit(p, L)) * smoothstep(-0.02, 0.12, dot(upW, L));
  float night = (1.0 - smoothstep(0.02, 0.25, haloLuma(sunVis) * max(dot(upW, L) + 0.2, 0.0))) * (1.0 - 0.9 * dayG * (inAir ? 1.0 : 0.0));
  float emitType = emitK;
  bool side = !top && abs(lN.z) < 0.5;
  if (pal > 12.5 && pal < 13.5) {
    // pociag: pas okien + reflektory czola
    float head = emitK - 2.0 * floor((emitK + 0.5) * 0.5) > 0.5 ? 1.0 : 0.0;
    float band = side ? (1.0 - smoothstep(1.2, 1.6, abs(vLocal.z - vSize.z * 0.55) / 1.4)) : 0.0;
    float win = step(0.45, fract(vLocal.x / 5.0)) * band;
    emit += vec3(0.55, 0.82, 1.25) * win * (0.35 + 0.65 * night);
    float front = head * step(0.5, lN.x) * (1.0 - smoothstep(2.0, 3.0, abs(vLocal.z - vSize.z * 0.5)));
    emit += vec3(${f3([HALO_HDR.navWhite, HALO_HDR.navWhite, HALO_HDR.navWhite * 0.95])}) * front * 0.6;
  } else if (emitType > 0.5 && emitType < 2.5 && side) {
    // okna w rzedach (co 6 j., na wielkich bryłach co 30 j.); noca czesc swieci
    float big = step(150.0, vSize.z);
    vec2 wgS = mix(vec2(4.0, 6.0), vec2(16.0, 30.0), big);
    vec2 wg = vec2(fuv.x / wgS.x, (vLocal.z - 4.0) / wgS.y);
    vec2 wc = floor(wg);
    vec2 wf = fract(wg);
    float frame = step(0.2, wf.x) * step(wf.x, 0.8) * step(0.25, wf.y) * step(wf.y, 0.75) * step(0.0, vLocal.z - 4.0) * step(vLocal.z, vSize.z - 4.0);
    float lit = step(0.55, haloHash12(wc + vSeed * 57.0));
    float aa = 1.0 - smoothstep(0.4, 1.2, fw / (4.0 * uDetailScale));
    vec3 wcol = emitType < 1.5 ? vec3(${f3(HALO_HDR.windowWarm)}) : vec3(${f3(HALO_HDR.windowCool)});
    emit += wcol * frame * lit * night * mix(0.28, 1.0, aa) * 0.9 * uLayers.y * uNightLights;
    albedo = mix(albedo, vec3(0.02, 0.025, 0.03), frame * aa * 0.8);
  } else if (emitType > 2.5 && emitType < 3.5) {
    emit += vec3(${f3(HALO_HDR.stripBlue)}) * 0.9;
  } else if (emitType > 3.5 && emitType < 4.5) {
    // sodowe lampy na gornych krawedziach
    float lamp = top ? (1.0 - smoothstep(0.0, 2.5 + fw, min(edgeD3.x, edgeD3.y))) * step(0.72, fract(fuv.x / 14.0 + vSeed)) : 0.0;
    emit += vec3(${f3(HALO_HDR.windowSodium)}) * lamp * night;
  } else if (emitType > 4.5 && emitType < 5.5 && top) {
    // podloga tunelu tranzytu (poklady zatok maja typ 6): obrys, pasy, plamy reflektorow
    vec2 q = vLocal.xy;
    vec2 berth = abs(q) - vec2(1000.0, 460.0);
    float outline = 1.0 - smoothstep(3.0, 6.0 + fw, abs(max(berth.x, berth.y)));
    float lanes = (1.0 - smoothstep(1.5, 3.0 + fw, abs(abs(q.y) - 560.0))) * step(0.5, fract(q.x / 60.0));
    float center = (1.0 - smoothstep(1.5, 3.0 + fw, abs(q.y))) * step(0.6, fract(q.x / 40.0));
    vec3 paint = vec3(0.34, 0.26, 0.06);
    albedo = mix(albedo, paint, max(outline, max(lanes, center)) * 0.85);
    // swiatlo nocne: poswiata od scian (reflektory na scianach bocznych i tylnej)
    // + latarnie wzdluz pasow prowadzacych, kazda inna
    vec2 hb = 0.5 * vSize.xy;
    float wallWash = exp(-(hb.x - 180.0 - abs(q.x)) / 160.0) * 0.5 + exp(-(q.y + hb.y) / 200.0) * 0.6;
    float px = floor(q.x / 200.0);
    vec2 lampP = vec2((px + 0.5) * 200.0, sign(q.y) * 560.0);
    float lampK = 0.5 + 0.8 * haloHash12(vec2(px, sign(q.y)) + vSeed * 13.0);
    float post = exp(-dot(q - lampP, q - lampP) / (2.0 * 45.0 * 45.0)) * lampK;
    emit += vec3(0.9, 0.62, 0.34) * (wallWash * 0.22 + post * 0.3) * night + vec3(${f3(HALO_HDR.stripBlue)}) * outline * 0.25 * night;
  } else if (emitType > 5.5 && emitType < 6.5 && top) {
    // poklad otwartej zatoki: bez znaczen (stanowiska K-7 rysuje render
    // kompleksu), noca poswiata reflektorow scian bocznych i tylnej
    vec2 q = vLocal.xy;
    vec2 hb = 0.5 * vSize.xy;
    float wallWash = exp(-(hb.x - abs(q.x)) / 220.0) * 0.55 + exp(-(q.y + hb.y) / 260.0) * 0.6;
    emit += vec3(0.9, 0.62, 0.34) * wallWash * 0.24 * night;
  } else if (emitType > 6.5 && emitType < 7.5 && side) {
    // fasada megabudowli (ECUMENE): kondygnacje 4,5 j., przesla 5 j., szklo
    // w ramach (cieplej: braz, chlodnej: stal), pas stropu co 12 kondygnacji.
    // Swiatla nocne w trzech skalach: okno -> grupa 3 x 3 okien (zapalona
    // lub nie) -> pas 12 kondygnacji; kazda skala to srednia poprzedniej,
    // wiec z daleka wieza nie zlewa sie w jednolita tafle ani nie migocze
    float faceId = abs(lN.x) > 0.5 ? (lN.x > 0.0 ? 1.0 : 2.0) : (lN.y > 0.0 ? 3.0 : 4.0);
    bool coolF = pal > 27.5 && pal < 28.5;
    vec2 fc = vec2(fuv.x / 5.0, vLocal.z / 4.5);
    vec2 cid = floor(fc);
    vec2 cf = fract(fc);
    vec2 fwc = max(vec2(fwidth(fc.x), fwidth(fc.y)), vec2(1e-4));
    float fwm = max(fwc.x, fwc.y);
    float farA = smoothstep(0.35, 0.85, fwm / uDetailScale);
    float farB = smoothstep(0.35, 0.85, fwm / (3.0 * uDetailScale));
    float gx = smoothstep(0.16 - fwc.x, 0.16 + fwc.x, cf.x) * (1.0 - smoothstep(0.84 - fwc.x, 0.84 + fwc.x, cf.x));
    float gy = smoothstep(0.24 - fwc.y, 0.24 + fwc.y, cf.y) * (1.0 - smoothstep(0.86 - fwc.y, 0.86 + fwc.y, cf.y));
    float bz = vLocal.z / 54.0;
    float fwb = max(fwidth(bz), 1e-4);
    float slab = (1.0 - smoothstep(0.03 - fwb, 0.03 + fwb, abs(fract(bz + 0.5) - 0.5))) * (1.0 - smoothstep(0.2, 0.6, fwb));
    float glaz = mix(gx * gy, 0.42, farA) * (1.0 - slab);
    vec3 glassTint = coolF ? vec3(0.32, 0.41, 0.45) : vec3(0.46, 0.38, 0.30);
    albedo = mix(base * 1.15, base * glassTint * 0.55, glaz);
    albedo = mix(albedo, albedo * 1.6 + 0.02, bevel * 0.6);
    facadeGlass = glaz;
    // aktywnosc pasa 12 kondygnacji -> grupy 3 x 3 okien -> okna
    float band = floor(cid.y / 12.0);
    float bAct = 0.12 + 0.4 * haloHash12(vec2(band, faceId * 7.3 + vSeed * 13.0));
    vec2 gid = floor(cid / 3.0);
    float gOn = step(haloHash12(gid + vec2(faceId * 17.3, vSeed * 23.0)), bAct);
    float pOn = mix(0.06, 0.8, gOn);
    float on = step(haloHash12(cid + vec2(faceId * 31.7, vSeed * 57.0)), pOn);
    float fl13 = cid.y - 13.0 * floor((cid.y + 0.5) / 13.0);
    float lum = mix(0.5, 0.7, step(fl13, 7.5)) + 0.25 * haloHash12(cid + vec2(3.3, faceId));
    vec2 gf = fract(cid / 3.0 + cf / 3.0);
    vec2 fwg = fwc / 3.0;
    float ggx = smoothstep(0.08 - fwg.x, 0.08 + fwg.x, gf.x) * (1.0 - smoothstep(0.92 - fwg.x, 0.92 + fwg.x, gf.x));
    float ggy = smoothstep(0.1 - fwg.y, 0.1 + fwg.y, gf.y) * (1.0 - smoothstep(0.9 - fwg.y, 0.9 + fwg.y, gf.y));
    float litA = on * lum * gx * gy;
    float litB = pOn * 0.302 / 0.67 * ggx * ggy;
    float litC = (bAct * 0.8 + (1.0 - bAct) * 0.06) * 0.302;
    float lit = mix(mix(litA, litB, farA), litC, farB) * (1.0 - slab);
    vec3 wcol = coolF ? vec3(${f3(HALO_HDR.windowCool)}) : vec3(${f3(HALO_HDR.windowWarm)});
    emit += wcol * lit * night * 0.95 * uLayers.y * uNightLights;
  }
  if (pal > 25.5 && pal < 26.5) {
    // pas swietlny megabudowli (korona, wejscie): cieply, noca pelny
    emit += vec3(1.25, 0.98, 0.58) * mix(0.35, 1.0, night) * uLayers.y * uNightLights;
  }
  if (vSize.z > 150.0 && side && pal < 23.5) {
    // wielkie bryly (doki): zebra poziome co 60 j. i pilastry co 120 j.
    float ribZ = 1.0 - smoothstep(1.5, 1.5 + fw, abs(fract(vLocal.z / 60.0) - 0.5) * 60.0 - 27.0);
    float pil = 1.0 - smoothstep(3.0, 3.0 + fw, abs(fract(fuv.x / 120.0) - 0.5) * 120.0 - 54.0);
    albedo *= 1.0 - 0.35 * max(ribZ, pil * 0.6);
  }
  if (pal > 8.5 && pal < 9.5 && side) {
    // tunel: zebra co 30 j., miedzy nimi przeszklenie z cieplym wnetrzem noca
    float rib = 1.0 - smoothstep(2.0, 3.5 + fw, abs(fract(vLocal.z / 30.0) - 0.5) * 30.0 - 12.0);
    albedo = mix(vec3(0.02, 0.03, 0.04), albedo, rib);
    emit += vec3(${f3(HALO_HDR.windowWarm)}) * (1.0 - rib) * night * 0.35;
  }

  if (pal > 17.5 && pal < 18.5) emit += vec3(${f3(HALO_HDR.windowWarm)}) * indEmit * night * 0.35 * uLayers.y * uNightLights;
  if (pal > 18.5 && pal < 19.5) {
    // swiatlo przeszkodowe na szczycie komina (miga)
    float beacon = step(0.96, tH) * (lN.z > 0.5 ? 1.0 : step(0.985, tH)) * (0.5 + 0.5 * step(0.5, fract(uTime * 0.8 + vSeed)));
    emit += vec3(1.25, 0.12, 0.06) * beacon;
  }
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  vec3 H = normalize(L + V);
  float rough = pal > 6.5 && pal < 7.5 ? 0.12 : (pal > 12.5 ? 0.25 : 0.45);
  if (pal > 23.5 && pal < 24.5) rough = 0.55;                 // kamien
  rough = mix(rough, 0.12, facadeGlass);                      // szklo fasady
  float a2 = rough * rough;
  float NdH = max(dot(N, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  vec3 F0 = vec3(mix(pal > 6.5 && pal < 7.5 ? 0.08 : 0.05, 0.08, facadeGlass));
  vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = Fs * min(a2 / (HALO_PI * dd * dd) * 0.25 / NdV, 6.0) * NdL;
  vec3 amb = haloPlanetshine(p, N) + vec3(uNightAmbient);
  if (inAir) amb += haloSkyAmbient(p, N);
  // swiatlo odbite od dachu (jasny metal pod spodem)
  amb += vec3(0.020, 0.021, 0.023) * haloLuma(sunVis) * max(L.z, 0.0) * max(-N.z * 0.5 + 0.5, 0.0);
  vec3 color = albedo * ao * (uSunColor * sunVis * NdL + amb) + uSunColor * sunVis * spec * 0.6;
  // odbicie nieba: szklo (mocno) i metal (slabo); w habitacie niebo, w kosmosie czern
  {
    vec3 R = reflect(-V, N);
    float up = clamp(dot(R, upW), -1.0, 1.0);
    vec3 skyR = inAir
      ? mix(vec3(0.18, 0.25, 0.36), vec3(0.05, 0.10, 0.21), clamp(up, 0.0, 1.0)) * haloLuma(haloSunVisibility(p + upW * 600.0, L)) * max(dot(upW, L) + 0.3, 0.0)
      : vec3(0.004, 0.005, 0.008);
    skyR = mix(skyR, vec3(0.03, 0.035, 0.03), smoothstep(0.05, -0.2, up));
    float glassK = max(pal > 6.5 && pal < 7.5 ? 1.0 : 0.25, facadeGlass);
    float Fr = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    color += skyR * mix(0.08, 1.0, Fr) * glassK * (side ? 1.0 : 0.6);
  }
  color += emit;
  color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

// Szkło kopuł-biosfer (haloRingDomes.js): półkula przezroczysta, żebra
// (południki i równoleżniki) i drobna siatka rombów z położenia na kopule,
// Fresnel z odbiciem nieba habitatu, odblask słońca, nocą ciepła poświata
// wnętrza. Paleta instancji = typ wnętrza (barwa szkła), emisja = ciepłe
// wnętrze. Jedna siatka na wszystkie kopuły (1 draw call), bez zapisu głębi.
const GLASS_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vSeed;

float glassLine(float x, float w, float fw) {
  float d = abs(fract(x + 0.5) - 0.5);
  return 1.0 - smoothstep(w, w + fw, d);
}

void main() {
  vec3 rel = vRel;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  vec3 p = uCamLocal + rel;
  vec3 N = normalize(vNormal);
  float NdV = dot(N, V);
  if (NdV < 0.0) { N = -N; NdV = -NdV; }
  float matI = floor(vMat + 0.5);
  float warmK = floor((matI + 0.5) / 32.0);
  float type = matI - 32.0 * warmK;
  // polozenie na kopule: wysokosc katowa (0 u podstawy) i azymut
  vec3 q = vLocal / max(vSize, vec3(1e-3));
  float zq = clamp(q.z, 0.0, 1.0);
  float el = asin(zq) / 1.5707963;
  float az = atan(q.y, q.x) / 6.2831853;
  // fwidth azymutu bez skoku na szwie +-pi
  float fwAz = min(fwidth(az), fwidth(fract(az + 0.5)));
  float fwEl = fwidth(el);
  float nMer = 16.0;
  float nPar = 6.0;
  vec2 g = vec2(az * nMer, el * nPar);
  vec2 fwg = vec2(fwAz * nMer, fwEl * nPar) + 1e-4;
  // zebra: poludniki (gasna przy szczycie, gdzie sie zbiegaja) i rownolezniki
  float mer = glassLine(g.x, 0.035, fwg.x) * (1.0 - smoothstep(0.82, 0.95, zq));
  float par = glassLine(g.y, 0.05, fwg.y);
  float rib = max(mer, par);
  // drobna siatka rombow (geodezyjna), z daleka srednia zamiast migotania
  vec2 g2 = g * vec2(3.0, 3.0);
  float fw2 = max(fwg.x, fwg.y) * 3.0;
  float mesh = max(glassLine(g2.x + g2.y, 0.04, fw2), glassLine(g2.x - g2.y, 0.04, fw2));
  mesh = mix(mesh, 0.18, smoothstep(0.25, 0.8, fw2)) * (1.0 - smoothstep(0.85, 0.97, zq));
  // barwa szkla wg typu wnetrza (las, tropiki, ogrod, rekreacja, dzicz, woda)
  vec3 tint = vec3(0.55, 0.78, 0.95);
  if (type > 0.5 && type < 1.5) tint = vec3(0.55, 0.85, 0.85);
  if (type > 1.5 && type < 2.5) tint = vec3(0.70, 0.82, 0.95);
  if (type > 2.5 && type < 3.5) tint = vec3(0.65, 0.80, 1.00);
  if (type > 3.5 && type < 4.5) tint = vec3(0.50, 0.75, 0.90);
  if (type > 4.5) tint = vec3(0.45, 0.80, 1.00);
  vec3 L = uSunDir;
  vec3 sunVis = haloSunVisibility(p + N * 2.0, L);
  vec3 upW = haloUp(p);
  float dayG = haloLuma(haloPlanetTransmit(p, L)) * smoothstep(-0.02, 0.12, dot(upW, L));
  float night = (1.0 - smoothstep(0.02, 0.25, haloLuma(sunVis) * max(dot(upW, L) + 0.2, 0.0))) * (1.0 - 0.9 * dayG);
  float fres = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  // odbicie nieba habitatu (jak szklo megastruktury)
  vec3 R = reflect(-V, N);
  float up = clamp(dot(R, upW), -1.0, 1.0);
  vec3 skyR = mix(vec3(0.18, 0.25, 0.36), vec3(0.05, 0.10, 0.21), clamp(up, 0.0, 1.0)) * haloLuma(haloSunVisibility(p + upW * 600.0, L)) * max(dot(upW, L) + 0.3, 0.0);
  skyR = mix(skyR, vec3(0.03, 0.035, 0.03), smoothstep(0.05, -0.2, up));
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float NdH = max(dot(N, H), 0.0);
  float a2 = 0.012;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float spec = min(a2 / (HALO_PI * dd * dd) * 0.25 / max(NdV, 0.05), 8.0) * NdL;
  vec3 amb = haloSkyAmbient(p, N) + vec3(uNightAmbient);
  vec3 glassC = tint * 0.05 * (uSunColor * sunVis * NdL + amb) + skyR * mix(0.25, 1.0, fres);
  glassC += uSunColor * sunVis * spec * fres * 0.9;
  // rama: jasny metal, oswietlony
  vec3 frameC = vec3(0.26, 0.27, 0.28) * (uSunColor * sunVis * (0.35 + 0.65 * NdL) + amb);
  vec3 warmC = warmK > 0.5 ? vec3(1.0, 0.78, 0.52) : vec3(0.62, 0.8, 1.0);
  // noca poswiata wnetrza na szkle (slaba, przy podstawie) i lampy na zebrach
  float lowK = (1.0 - zq) * (1.0 - zq);
  glassC += warmC * 0.06 * night * uLayers.y * uNightLights * (0.25 + 0.75 * lowK);
  frameC += warmC * 0.35 * night * uLayers.y * uNightLights * par * step(fract(g.x * 2.0), 0.12);
  float frameK = max(rib, mesh * 0.55);
  vec3 color = mix(glassC, frameC, frameK);
  float alpha = clamp(0.12 + 0.5 * fres + 0.8 * rib + 0.4 * mesh + 0.06 * night, 0.0, 0.95);
  color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), alpha);
}
`;

// Półkula szkła gęstsza niż prymityw kopuły (duże promienie, gładki obrys).
function makeGlassDome() {
  const g = new THREE.SphereGeometry(0.5, 56, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 2);                // półsfera: z od 0 do 1
  g.computeVertexNormals();
  return g;
}

// Billboardy świateł pozycyjnych: stały rozmiar w świecie, ale nie mniejszy
// niż ~1,6 px (z daleka ring obrysowują migające punkty).
const LIGHT_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${HALO_GLSL_FG}
uniform float uSegCells;
uniform float uPixelAngle;     // 2 tan(fov/2) / wysokosc kadru [px]
attribute vec4 iL0;            // segment, wzdluz, dr, z
attribute vec4 iL1;            // rozmiar, faza, barwa, tryb
varying vec2 vQuad;
varying vec3 vCol;
void main() {
  float cells = iL0.x * uSegCells - uGridInfo.w;
  cells -= uGridInfo.z * floor(cells / uGridInfo.z + 0.5);
  float sRel = cells * uGridInfo.x + iL0.y;
  vec3 rel = haloRelFromPolar(sRel / uFloorDims.z, iL0.z, iL0.w);
  vec3 view = mat3(viewMatrix) * (mat3(modelMatrix) * rel);
  float dist = max(-view.z, 1.0);
  float sizeMin = 1.6 * uPixelAngle * dist;
  float size = max(iL1.x, sizeMin);
  // tryby migania
  float t = uTime;
  float ph = iL1.y;
  float mode = iL1.w;
  float k = 1.0;
  if (mode < 0.5) k = pow(max(0.0, 1.0 - fract(t * 0.9 + ph) * 7.0), 2.0);
  else if (mode < 1.5) k = 1.0;
  else if (mode < 2.5) k = 0.5 + 0.5 * sin(6.2831853 * (t * 0.45 + ph));
  else k = pow(max(0.0, 1.0 - fract(t * 0.35 - ph * 4.0) * 5.0), 2.0) * 0.95 + 0.05;
  float c = iL1.z;
  vec3 col = vec3(${f3([HALO_HDR.navWhite, HALO_HDR.navWhite * 0.97, HALO_HDR.navWhite * 0.92])});
  if (c > 0.5) col = vec3(1.25, 0.1, 0.06);
  if (c > 1.5) col = vec3(${f3(HALO_HDR.stripBlue)});
  if (c > 2.5) col = vec3(${f3(HALO_HDR.windowWarm)}) * 1.2;
  if (c > 3.5) col = vec3(0.1, 1.2, 0.35);
  // z daleka (rozmiar podbity do min. piksela) energia maleje, zeby tysiace
  // punktow nie zalaly bloomu
  float far = clamp(iL1.x / size, 0.2, 1.0);
  vCol = col * k * far * haloFgVisibility(uCamLocal + rel);
  vQuad = position.xy;
  view.xy += position.xy * size * (0.6 + 0.4 * k);
  gl_Position = projectionMatrix * vec4(view, 1.0);
}
`;
const LIGHT_FRAGMENT = /* glsl */`
varying vec2 vQuad;
varying vec3 vCol;
void main() {
  float r2 = dot(vQuad, vQuad);
  float a = exp(-r2 * 5.0) - 0.0067;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vCol * a, 0.0);
}
`;

function makeBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0, 0.5);
  return g;
}
function makeCylinder() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false);
  g.rotateX(Math.PI / 2);          // oś Y → Z
  g.translate(0, 0, 0.5);
  return g;
}
function makeDome() {
  const g = new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 2);                // półsfera: z od 0 do 1
  g.computeVertexNormals();
  return g;
}

// Instancjonowana bryła z dynamicznym buforem (wybrane segmenty).
function makeInstanced(base, capacity, material) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const data = new Float32Array(capacity * HALO_INSTANCE_STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(data, HALO_INSTANCE_STRIDE);
  buf.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQuat', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { geo, data, buf, mesh, capacity, count: 0 };
}

export class HaloMegastructure {
  constructor({ layout, uniforms, surfaceUniforms, domain, plan, quality = null }) {
    this.layout = layout;
    this.plan = plan;
    this.domain = domain;
    this.group = new THREE.Group();
    this.group.name = 'HaloMegastructure';
    // zasięg detalu z LOD jakości (ultra: dalej); pojemność buforów detalu
    // rośnie z zasięgiem (więcej segmentów w kadrze naraz)
    const lod = haloQualityLod(quality);
    this._geomFade = { value: new THREE.Vector2(lod.geomFade[0], lod.geomFade[1]) };
    this._detailSegs = Math.round(72 * Math.max(1, lod.geomFade[1] / 20000));
    // dach nad płaszczyzną gry (flightLevel liczbowy): materiały z HALO_FG
    const fgDefines = layout.flightLevel !== 'roof' ? { HALO_FG: 1 } : {};
    const common = { ...uniforms, ...surfaceUniforms, uSegCells: { value: domain.segCells } };
    const primMaterial = (defines) => new THREE.ShaderMaterial({
      name: 'HaloMegaPrims',
      uniforms: { ...common, uGeomFade: this._geomFade },
      vertexShader: PRIM_VERTEX,
      fragmentShader: HALO_PRIM_FRAGMENT,
      defines: { AIR_STEPS: 4, ...defines },
      // (θ̂, r̂, ẑ) jest lewoskrętny → odbicie zmienia nawinięcie trójkątów
      side: THREE.BackSide
    });
    this.material = primMaterial(fgDefines);          // dach (detal)
    this.landmarkMaterial = primMaterial({});         // doki
    const bases = [makeBox(), makeCylinder(), makeDome()];
    this._bases = bases;
    const makeSet = (key, material) => HALO_PRIM_NAMES.map((name, p) => {
      const src = plan.prims[p][key];
      const capacity = key === 'detail'
        ? Math.max(64, Math.min(src.total, src.maxPerSeg * this._detailSegs))
        : Math.max(16, src.total);
      const inst = makeInstanced(bases[p], capacity, material);
      inst.mesh.name = `HaloMega_${key}_${name}`;
      inst.views = Array.from({ length: plan.segCount }, (_, s) => src.data.subarray(src.offsets[s] * HALO_INSTANCE_STRIDE, (src.offsets[s] + src.counts[s]) * HALO_INSTANCE_STRIDE));
      inst.mesh.visible = src.total > 0;
      this.group.add(inst.mesh);
      return inst;
    });
    this.prims = makeSet('detail', this.material);
    this.landmarks = makeSet('landmark', this.landmarkMaterial);

    // szkło kopuł-biosfer: osobna siatka przezroczysta (po bryłach, bez zapisu
    // głębi), wybierana razem z punktami orientacyjnymi (te same segmenty)
    const gsrc = plan.glass;
    this.glassMaterial = new THREE.ShaderMaterial({
      name: 'HaloDomeGlass',
      uniforms: { ...common, uGeomFade: this._geomFade },
      vertexShader: PRIM_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      defines: { AIR_STEPS: 4 },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    this._glassBase = makeGlassDome();
    this.glass = makeInstanced(this._glassBase, Math.max(4, gsrc?.total || 0), this.glassMaterial);
    this.glass.mesh.name = 'HaloMega_domeGlass';
    this.glass.mesh.renderOrder = 30;
    this.glass.views = Array.from({ length: plan.segCount }, (_, s) => (gsrc
      ? gsrc.data.subarray(gsrc.offsets[s] * HALO_INSTANCE_STRIDE, (gsrc.offsets[s] + gsrc.counts[s]) * HALO_INSTANCE_STRIDE)
      : new Float32Array(0)));
    this.glass.mesh.visible = (gsrc?.total || 0) > 0;
    this.group.add(this.glass.mesh);

    // pociągi: ta sama bryła prostopadłościanu, własny wierzchołek
    const trainGeo = new THREE.InstancedBufferGeometry();
    trainGeo.index = bases[0].index;
    trainGeo.setAttribute('position', bases[0].getAttribute('position'));
    trainGeo.setAttribute('normal', bases[0].getAttribute('normal'));
    const tbuf = new THREE.InstancedInterleavedBuffer(plan.trains, HALO_TRAIN_STRIDE);
    trainGeo.setAttribute('iTrainA', new THREE.InterleavedBufferAttribute(tbuf, 4, 0));
    trainGeo.setAttribute('iTrainB', new THREE.InterleavedBufferAttribute(tbuf, 4, 4));
    trainGeo.instanceCount = plan.trainCount;
    trainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.trainMaterial = new THREE.ShaderMaterial({
      name: 'HaloMegaTrains',
      uniforms: {
        ...common,
        uTrainLane: { value: new THREE.Vector4(layout.radii.rim, layout.sigma, layout.z.roof + 12, layout.circumference) }
      },
      vertexShader: TRAIN_VERTEX,
      fragmentShader: HALO_PRIM_FRAGMENT,
      defines: { AIR_STEPS: 4, ...fgDefines },
      side: THREE.BackSide
    });
    this.trains = new THREE.Mesh(trainGeo, this.trainMaterial);
    this.trains.name = 'HaloMega_trains';
    this.trains.frustumCulled = false;
    this.group.add(this.trains);

    // światła pozycyjne: dach (FG) i doki (BG)
    const quad = new THREE.PlaneGeometry(2, 2);
    this._quad = quad;
    const lightMaterial = (defines) => new THREE.ShaderMaterial({
      name: 'HaloMegaLights',
      uniforms: { ...common, uPixelAngle: this._pixelAngle || (this._pixelAngle = { value: 2 * Math.tan(17.5 * Math.PI / 180) / 1080 }) },
      vertexShader: LIGHT_VERTEX,
      fragmentShader: LIGHT_FRAGMENT,
      defines,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor
    });
    const makeLights = (src, material, name) => {
      const lightGeo = new THREE.InstancedBufferGeometry();
      lightGeo.index = quad.index;
      lightGeo.setAttribute('position', quad.getAttribute('position'));
      const lcap = Math.max(16, src.total);
      const ldata = new Float32Array(lcap * HALO_LIGHT_STRIDE);
      const lbuf = new THREE.InstancedInterleavedBuffer(ldata, HALO_LIGHT_STRIDE);
      lbuf.setUsage(THREE.DynamicDrawUsage);
      lightGeo.setAttribute('iL0', new THREE.InterleavedBufferAttribute(lbuf, 4, 0));
      lightGeo.setAttribute('iL1', new THREE.InterleavedBufferAttribute(lbuf, 4, 4));
      lightGeo.instanceCount = 0;
      lightGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(lightGeo, material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = 40;
      mesh.visible = src.total > 0;
      this.group.add(mesh);
      return {
        geo: lightGeo, data: ldata, buf: lbuf, capacity: lcap, count: 0, mesh,
        views: Array.from({ length: plan.segCount }, (_, s) => src.data.subarray(src.offsets[s] * HALO_LIGHT_STRIDE, (src.offsets[s] + src.counts[s]) * HALO_LIGHT_STRIDE))
      };
    };
    this.lightMaterial = lightMaterial(fgDefines);
    this.landmarkLightMaterial = lightMaterial({});
    this.lights = makeLights(plan.lights, this.lightMaterial, 'HaloMega_lights');
    this.landmarkLights = makeLights(plan.landmarkLights, this.landmarkLightMaterial, 'HaloMega_dockLights');
    this.lightMesh = this.lights.mesh;

    // sfery segmentów (detal i punkty orientacyjne mają różne granice)
    this._spheres = [plan.detailBounds, plan.landmarkBounds].map((list) => list.map((b, s) => {
      if (!b) return null;
      const th = (s + 0.5) * plan.segAngle;
      const rMid = (b.rMin + b.rMax) * 0.5;
      const zMid = (b.zMin + b.zMax) * 0.5;
      const segLen = plan.segAngle * b.rMax;
      const radius = Math.hypot(segLen * 0.5 + 1800, (b.rMax - b.rMin) * 0.5, (b.zMax - b.zMin) * 0.5);
      return new THREE.Sphere(new THREE.Vector3(Math.cos(th) * rMid, Math.sin(th) * rMid, zMid), radius);
    }));
    // światła dachu leżą na dachu (z.roof), doków — w granicach brył doków
    this._lightSpheres = plan.detailBounds.map((b, s) => {
      const th = (s + 0.5) * plan.segAngle;
      const rMid = layout.radii.rim;
      return new THREE.Sphere(new THREE.Vector3(Math.cos(th) * rMid, Math.sin(th) * rMid, layout.z.roof), plan.segAngle * rMid * 0.5 + 2200);
    });
    // wybór segmentów: bieżący i poprzedni (bufory stałe, zero alokacji na klatkę)
    const keys = ['detail', 'landmark', 'lights', 'landmarkLights'];
    this._sel = Object.fromEntries(keys.map((k) => [k, new Int32Array(plan.segCount)]));
    this._selN = Object.fromEntries(keys.map((k) => [k, -1]));
    this._next = Object.fromEntries(keys.map((k) => [k, new Int32Array(plan.segCount)]));
    this._nextN = Object.fromEntries(keys.map((k) => [k, 0]));
    this.visibleInstances = 0;
  }

  setPixelAngle(value) {
    this._pixelAngle.value = value;
  }

  _select(frustum, camLocal) {
    const far = this._geomFade.value.y;
    const n = this._nextN;
    n.detail = 0;
    n.landmark = 0;
    n.lights = 0;
    n.landmarkLights = 0;
    const [detS, lmS] = this._spheres;
    for (let s = 0; s < this.plan.segCount; s++) {
      const d = detS[s];
      if (d && frustum.intersectsSphere(d) && d.center.distanceTo(camLocal) - d.radius < far) this._next.detail[n.detail++] = s;
      const l = lmS[s];
      if (l && frustum.intersectsSphere(l)) {
        this._next.landmark[n.landmark++] = s;
        this._next.landmarkLights[n.landmarkLights++] = s;
      }
      if (frustum.intersectsSphere(this._lightSpheres[s])) this._next.lights[n.lights++] = s;
    }
    return n;
  }

  _changed(key, count) {
    const prev = this._sel[key];
    const next = this._next[key];
    if (this._selN[key] !== count) return true;
    for (let i = 0; i < count; i++) if (prev[i] !== next[i]) return true;
    return false;
  }

  _accept(key, count) {
    for (let i = 0; i < count; i++) this._sel[key][i] = this._next[key][i];
    this._selN[key] = count;
  }

  _fillPrims(set, key, count) {
    let total = 0;
    for (const inst of set) {
      let o = 0;
      const cap = inst.capacity * HALO_INSTANCE_STRIDE;
      for (let i = 0; i < count; i++) {
        const v = inst.views[this._sel[key][i]];
        if (o + v.length > cap) break;
        inst.data.set(v, o);
        o += v.length;
      }
      inst.count = o / HALO_INSTANCE_STRIDE;
      inst.geo.instanceCount = inst.count;
      inst.buf.needsUpdate = true;
      inst.buf.clearUpdateRanges();
      inst.buf.addUpdateRange(0, o);
      total += inst.count;
    }
    return total;
  }

  _fillLights(L, key, count) {
    let o = 0;
    const cap = L.capacity * HALO_LIGHT_STRIDE;
    for (let i = 0; i < count; i++) {
      const v = L.views[this._sel[key][i]];
      if (o + v.length > cap) break;
      L.data.set(v, o);
      o += v.length;
    }
    L.count = o / HALO_LIGHT_STRIDE;
    L.geo.instanceCount = L.count;
    L.buf.needsUpdate = true;
    L.buf.clearUpdateRanges();
    L.buf.addUpdateRange(0, o);
  }

  update(frustum, camLocal) {
    const n = this._select(frustum, camLocal);
    if (this._changed('detail', n.detail)) {
      this._accept('detail', n.detail);
      this._detailCount = this._fillPrims(this.prims, 'detail', n.detail);
    }
    if (this._changed('landmark', n.landmark)) {
      this._accept('landmark', n.landmark);
      this._landmarkCount = this._fillPrims(this.landmarks, 'landmark', n.landmark);
      this._fillPrims([this.glass], 'landmark', n.landmark);
    }
    this.visibleInstances = (this._detailCount || 0) + (this._landmarkCount || 0);
    if (this._changed('lights', n.lights)) {
      this._accept('lights', n.lights);
      this._fillLights(this.lights, 'lights', n.lights);
    }
    if (this._changed('landmarkLights', n.landmarkLights)) {
      this._accept('landmarkLights', n.landmarkLights);
      this._fillLights(this.landmarkLights, 'landmarkLights', n.landmarkLights);
    }
  }

  // Dach nad płaszczyzną gry (FG) i doki w niej (BG).
  get fgMeshes() {
    return [...this.prims.map((p) => p.mesh), this.trains, this.lights.mesh];
  }

  get bgMeshes() {
    return [...this.landmarks.map((p) => p.mesh), this.glass.mesh, this.landmarkLights.mesh];
  }

  get meshes() {
    return [...this.fgMeshes, ...this.bgMeshes];
  }

  dispose() {
    for (const inst of [...this.prims, ...this.landmarks, this.glass]) inst.geo.dispose();
    for (const b of this._bases) b.dispose();
    this._glassBase.dispose();
    this.glassMaterial.dispose();
    this.trains.geometry.dispose();
    this.lights.geo.dispose();
    this.landmarkLights.geo.dispose();
    this._quad.dispose();
    this.material.dispose();
    this.landmarkMaterial.dispose();
    this.trainMaterial.dispose();
    this.lightMaterial.dispose();
    this.landmarkLightMaterial.dispose();
  }
}
