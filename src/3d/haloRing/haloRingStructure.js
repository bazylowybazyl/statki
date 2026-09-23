// Bryła ringu z JEDNEGO profilu (r, z) obróconego wokół Z: ściany (od środka
// i krawędzie), dach, kadłub, spód. Instancje = segmenty kątowe (8 na korzeń
// terenu), wierzchołki liczone względem kamery jak w terenie, więc panele
// i linie świateł są przyklejone do świata na każdym zoomie.
//
// M1: ciemny metal z panelami, pasy świateł na krawędziach, oświetlenie
// analityczne. Greeble dachu, kratownice i doki to M3.
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_RTE
} from './haloRingGLSL.js';
import { HALO_GLSL_FG, HALO_GLSL_FG_CLIP, HALO_GLSL_TRANSIT } from './haloRingGLSL.js';
import { HALO_HDR, HALO_ROOF } from './haloRingConfig.js';
import { HALO_GLSL_SURFACE } from './haloRingTerrain.js';

// Rodzaje krawędzi profilu (indeks = aEdge.x w shaderze).
export const HALO_EDGE_KIND = Object.freeze({
  floor: 0, wallTopInner: 1, rimTop: 2, roof: 3, hull: 4, underside: 5, rimBottom: 6, wallBottomInner: 7
});

// Wspólny wierzchołek dla pasów obrotowych (konstrukcja, chmury, powłoka).
export const HALO_GLSL_STRIP_VERTEX = /* glsl */`
attribute float aAlong;        // 0..1 wzdluz segmentu
attribute vec2 aProfile;       // r, z punktu profilu
attribute vec4 aEdge;          // rodzaj, v wzdluz krawedzi [j.], normalna r, normalna z
attribute float iSeg;          // poczatek segmentu wzgl. refS [komorki najdrobniejszej siatki]
uniform float uSegCells;       // komorek na segment
varying vec3 vRel;
varying vec3 vNormal;
varying vec2 vST;              // sRel [j.], v [j.]
varying float vKind;
varying vec2 vRZ;
`;

const STRUCTURE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
${HALO_GLSL_SURFACE}
${HALO_GLSL_STRIP_VERTEX}
void main() {
  float cells = iSeg + aAlong * uSegCells;
  float sRel = cells * uGridInfo.x;
  float dTheta = sRel / uFloorDims.z;
  float r = aProfile.x;
  float z = aProfile.y;
  vec3 rel = haloRelFromPolar(dTheta, r - uFloorDims.z, z);
  float th = uRefBasis.z + dTheta;
  vec2 er = vec2(cos(th), sin(th));
  vRel = rel;
  vNormal = vec3(er * aEdge.z, aEdge.w);
  vST = vec2(sRel, aEdge.y);
  vKind = aEdge.x;
  vRZ = vec2(r, z);
  gl_Position = haloProjectRel(rel);
}
`;

// Odcisk dachu z daleka (M3): te same reguly komorek co haloRingRoofPlan.js
// (ten sam hasz calkowity), wiec bryly z bliska stoja dokladnie na swoich
// odciskach, a pozorne cienie ponizej sa ich cieniami.
export const HALO_GLSL_ROOF = /* glsl */`
uniform vec4 uRoofLanes0;
uniform vec4 uRoofLanes1;
uniform vec4 uRoofLanes2;
uniform vec4 uRoofCells;
uniform vec4 uRoofSector;
uniform float uSectorClass[32];
uniform vec4 uPortDocks;

float roofClassOf(float cellIdx) {
  float x = mod(cellIdx + 0.5 - uRoofSector.x, uRoofCells.z);
  int k = int(min(floor(x / uRoofSector.y), uRoofSector.z - 1.0));
  return uSectorClass[k];
}
bool roofInDock(float lotId) {
  if (uPortDocks.z < 0.5) return false;
  float th = (lotId + 0.5) * uRoofCells.y / uFloorDims.z;
  for (int k = 0; k < 4; k++) {
    if (float(k) >= uPortDocks.z) break;
    float d = th - (uPortDocks.x + float(k) * uPortDocks.y);
    d -= HALO_TAU * floor(d / HALO_TAU + 0.5);
    if (abs(d) <= uPortDocks.w) return true;
  }
  return false;
}
// komorka przemyslowa: (rodzaj, a, b, wysokosc); ex = (przesuniecie, wzdluz?)
vec4 roofIndCell(float i, float j, float cls, out vec3 ex) {
  ex = vec3(0.0);
  float occ = cls < 0.5 ? 0.55 : (cls < 1.5 ? 0.62 : (cls < 2.5 ? 0.9 : 0.85));
  if (haloHashI(i, j, 11.0) >= occ) return vec4(0.0);
  float k = haloHashI(i, j, 12.0);
  float s = haloHashI(i, j, 13.0);
  float hg = haloHashI(i, j, 14.0);
  float jx = haloHashI(i, j, 15.0) - 0.5;
  float jy = haloHashI(i, j, 16.0) - 0.5;
  float cS = uRoofCells.x;
  float cD = uRoofLanes2.w;
  if (k < 0.34) {
    float r = 12.0 + 12.0 * s;
    ex = vec3(jx * max(0.0, cS - 2.0 * r - 8.0), jy * max(0.0, cD - 2.0 * r - 8.0), 0.0);
    return vec4(1.0, r, r, 18.0 + 70.0 * hg);
  }
  if (k < 0.62) {
    float sx = 22.0 + 24.0 * s;
    float sy = 22.0 + 24.0 * haloHashI(i, j, 17.0);
    ex = vec3(jx * max(0.0, cS - sx - 8.0), jy * max(0.0, cD - sy - 8.0), 0.0);
    return vec4(2.0, sx, sy, 10.0 + 60.0 * hg);
  }
  if (k < 0.8) {
    float al = haloHashI(i, j, 18.0) < 0.5 ? 1.0 : 0.0;
    ex = vec3(0.0, 0.0, al);
    return vec4(3.0, al > 0.5 ? 44.0 : 40.0, al > 0.5 ? 40.0 : 44.0, 26.0 + 50.0 * hg);
  }
  if (k < 0.9) {
    ex = vec3(jx * max(0.0, cS - 30.0), jy * max(0.0, cD - 30.0), 0.0);
    return vec4(4.0, 5.0 + 4.0 * s, 22.0, 60.0 + 36.0 * hg);
  }
  float r = 14.0 + 10.0 * s;
  ex = vec3(jx * max(0.0, cS - 2.0 * r - 8.0), jy * max(0.0, cD - 2.0 * r - 8.0), 0.0);
  return vec4(5.0, r, r, r);
}
float roofBoxSdf(vec2 q, vec2 h) {
  vec2 d = abs(q) - h;
  return max(d.x, d.y);
}
// odcisk obiektu komorki (q wzgledem srodka obiektu); ujemne = w srodku
float roofIndSdf(vec4 c, vec3 ex, vec2 q) {
  if (c.x < 0.5) return 1e5;
  if (c.x < 1.5 || c.x > 4.5) return length(q) - c.y;
  if (c.x < 2.5) return roofBoxSdf(q, 0.5 * c.yz);
  if (c.x < 3.5) {
    if (ex.z > 0.5) {
      float fy = q.y - 9.0 * clamp(floor(q.y / 9.0 + 0.5), -2.0, 2.0);
      return roofBoxSdf(vec2(q.x, fy), vec2(22.0, 1.5));
    }
    float fx = q.x - 9.0 * clamp(floor(q.x / 9.0 + 0.5), -2.0, 2.0);
    return roofBoxSdf(vec2(fx, q.y), vec2(1.5, 22.0));
  }
  return min(roofBoxSdf(q, vec2(11.0)), length(q) - c.y);
}
// odcinek [a, a + V] kontra prostokat |x| <= h (metoda plyt): 1 = cien
float roofSegBox(vec2 a, vec2 V, vec2 h) {
  vec2 inv = 1.0 / (sign(V) * max(abs(V), vec2(1e-4)) + vec2(equal(V, vec2(0.0))) * 1e-4);
  vec2 t1 = (-h - a) * inv;
  vec2 t2 = (h - a) * inv;
  vec2 tmin = min(t1, t2);
  vec2 tmax = max(t1, t2);
  float lo = max(max(tmin.x, tmin.y), 0.0);
  float hi = min(min(tmax.x, tmax.y), 1.0);
  return step(lo, hi);
}
float roofSegCircle(vec2 a, vec2 V, float r) {
  float t = clamp(-dot(a, V) / max(dot(V, V), 1e-6), 0.0, 1.0);
  return 1.0 - smoothstep(r - 0.8, r + 0.8, length(a + V * t));
}
// cien rzucany przez obiekt komorki (iN, jN) na punkt q (wzgledem srodka komorki)
float roofIndShadow(float iN, float jN, vec2 q, vec2 sdir) {
  if (jN < 0.0 || jN >= uRoofLanes2.y) return 0.0;
  float ii = haloWrapI(iN, uRoofCells.z);
  vec3 ex;
  vec4 c = roofIndCell(ii, jN, roofClassOf(ii), ex);
  if (c.x < 0.5) return 0.0;
  vec2 a = q - ex.xy;
  vec2 V = sdir * c.w;
  if (c.x < 1.5 || c.x > 4.5) return roofSegCircle(a, V, c.y);
  if (c.x < 2.5) return roofSegBox(a, V, 0.5 * c.yz + 0.4);
  if (c.x < 3.5) return roofSegBox(a, V, (ex.z > 0.5 ? vec2(22.0, 20.0) : vec2(20.0, 22.0))) * 0.55;
  return max(roofSegCircle(a, V, c.y), roofSegBox(a, sdir * 14.0, vec2(11.0)));
}
// dzialka: (rodzaj 0 plac 1 wieza 2 hala 3 kontenery, a, b, h); tw = wieza (a, b, h), to = przesuniecie
vec4 roofPlot(float Lid, float row, float cls, out vec3 tw, out vec2 to) {
  tw = vec3(0.0);
  to = vec2(0.0);
  float pE = cls < 0.5 ? 0.8 : (cls < 1.5 ? 0.6 : (cls < 2.5 ? 0.32 : 0.3));
  if (haloHashI(Lid, row, 21.0) < pE) return vec4(0.0);
  float k = haloHashI(Lid, row, 22.0);
  float a = haloHashI(Lid, row, 23.0);
  float b = haloHashI(Lid, row, 24.0);
  float c = haloHashI(Lid, row, 25.0);
  float kind = cls > 1.5 ? (k < 0.45 ? 3.0 : (k < 0.75 ? 2.0 : 1.0)) : (k < 0.6 ? 1.0 : 2.0);
  if (kind < 1.5) {
    float pa = 150.0 + 120.0 * a;
    float pb = 220.0 + 200.0 * b;
    tw = vec3(60.0 + 50.0 * haloHashI(Lid, row, 26.0), 60.0 + 50.0 * haloHashI(Lid, row, 27.0), 40.0 + 56.0 * haloHashI(Lid, row, 28.0));
    to = vec2((haloHashI(Lid, row, 29.0) - 0.5) * (pa - tw.x), (haloHashI(Lid, row, 30.0) - 0.5) * (pb - tw.y));
    return vec4(1.0, pa, pb, 18.0 + 16.0 * c);
  }
  if (kind < 2.5) return vec4(2.0, 200.0 + 90.0 * a, 280.0 + 170.0 * b, 24.0 + 22.0 * c);
  return vec4(3.0, 240.0, 288.0, 12.0);
}

// Odcisk w punkcie dachu: sRel wzdluz, d od krawedzi habitatu.
// albedo/emit modyfikowane w miejscu, shade = cien pozorny (0..1).
void haloRoofImpression(float sRel, float d, float fwS, float fwd, vec3 p, vec3 L, float night,
                        inout vec3 albedo, inout vec3 emit, out float shade) {
  shade = 0.0;
  float rl = max(length(p.xy), 1.0);
  vec3 et = vec3(-p.y, p.x, 0.0) / rl;
  vec3 er = vec3(p.x, p.y, 0.0) / rl;
  vec2 sunT = vec2(dot(L, et), -uHabitat.x * dot(L, er));
  vec2 sdir = L.z > 0.03 ? sunT / L.z : vec2(0.0);
  sdir = clamp(sdir, vec2(-2.5), vec2(2.5));
  float cS = uRoofCells.x;
  float cD = uRoofLanes2.w;
  float fw = max(fwS, fwd);
  float detailK = 1.0 - smoothstep(0.35, 0.8, fw / cD);
  vec3 steel = vec3(0.055, 0.058, 0.064);
  float Wr = uRoofLanes2.z;
  bool rimBand = d < uRoofLanes0.x;
  bool hullBand = d >= uRoofLanes1.w;
  if (rimBand || hullBand) {
    // kratownica: dwa pasy gorne + poprzeczki co komorke; cien pasow na dachu
    float dA = rimBand ? 30.0 : uRoofLanes1.w + 20.0;
    float dB = rimBand ? 110.0 : Wr - 20.0;
    float hT = ${HALO_ROOF.trussHeight.toFixed(1)};
    float chord = max(1.0 - smoothstep(4.0, 4.0 + fwd, abs(d - dA)), 1.0 - smoothstep(4.0, 4.0 + fwd, abs(d - dB)));
    vec2 pc = haloPat(6, sRel);
    float u = (pc.y - 0.5) * cS;
    float crossB = (1.0 - smoothstep(3.0, 3.0 + fwS, abs(abs(u) - 0.5 * cS))) * step(dA, d) * step(d, dB);
    float truss = max(chord, crossB) * mix(0.5, 1.0, detailK);
    albedo = mix(albedo, steel, truss);
    // cien pasow: czy odcinek [d, d + sdir.y * hT] mija ktorys pas
    float dy = sdir.y * hT;
    float lo = min(d, d + dy);
    float hi = max(d, d + dy);
    float sh = max(step(lo, dA + 4.0) * step(dA - 4.0, hi), step(lo, dB + 4.0) * step(dB - 4.0, hi));
    shade = max(shade, sh * 0.8 * (1.0 - chord));
    return;
  }
  bool rowA = d >= uRoofLanes0.y && d < uRoofLanes0.z;
  bool rowB = d >= uRoofLanes0.w && d < uRoofLanes1.x;
  bool maglev = d >= uRoofLanes1.y && d < uRoofLanes1.z;
  bool ind = d >= uRoofLanes1.z && d < uRoofLanes1.w;
  if (rowA || rowB) {
    vec2 lot = haloPat(7, sRel);
    float Lid = lot.x;
    float lotS = uRoofCells.y;
    float u = (lot.y - 0.5) * lotS;
    float row = rowA ? 0.0 : 1.0;
    float dc = rowA ? 0.5 * (uRoofLanes0.y + uRoofLanes0.z) : 0.5 * (uRoofLanes0.w + uRoofLanes1.x);
    float w = d - dc;
    float halfA = 0.5 * lotS - 15.0;
    float halfB = 0.5 * (rowA ? uRoofLanes0.z - uRoofLanes0.y : uRoofLanes1.x - uRoofLanes0.w) - 10.0;
    float road = step(halfA, abs(u)) + step(halfB, abs(w));
    if (road > 0.5) {
      albedo = vec3(0.042, 0.044, 0.047);
      float dash = (1.0 - smoothstep(1.0, 1.0 + fwd, abs(abs(w) - halfB - 5.0))) * step(0.5, fract(sRel / 24.0));
      albedo = mix(albedo, vec3(0.2, 0.19, 0.15), dash * detailK * step(abs(u), halfA));
      return;
    }
    float cls = roofClassOf(Lid * uRoofCells.w + 2.0);
    vec3 tw;
    vec2 to;
    vec4 pl = vec4(0.0);
    if (!(row < 0.5 && roofInDock(Lid))) pl = roofPlot(Lid, row, cls, tw, to);
    // plac: beton, obwodka, siatka fundamentow, narozniki
    vec3 pad = vec3(0.115, 0.117, 0.12) * (0.92 + 0.16 * haloHash12(vec2(Lid, row)));
    float border = 1.0 - smoothstep(1.3, 1.3 + fwd, abs(max(abs(u) - halfA, abs(w) - halfB) + 8.0));
    vec2 g = abs(fract(vec2(u, w) / 30.0) - 0.5) * 30.0;
    float grid = (1.0 - smoothstep(0.6, 0.6 + fw, min(g.x, g.y))) * detailK;
    vec2 cq = vec2(halfA, halfB) - abs(vec2(u, w));
    float corner = step(cq.x, 26.0) * step(cq.y, 26.0) * (1.0 - smoothstep(2.0, 2.0 + fw, min(abs(cq.x - 8.0), abs(cq.y - 8.0))));
    albedo = pad * (1.0 - 0.25 * grid);
    albedo = mix(albedo, vec3(0.28, 0.25, 0.15), max(border * (pl.x < 0.5 ? 1.0 : 0.4), corner) * mix(0.4, 1.0, detailK));
    vec2 q = vec2(u, w);
    if (pl.x > 0.5 && pl.x < 1.5) {
      float sdP = roofBoxSdf(q, 0.5 * pl.yz);
      vec2 qt = q - to;
      float sdT = roofBoxSdf(qt, 0.5 * tw.xy);
      if (sdP < 0.0) albedo = vec3(0.14, 0.142, 0.146);
      if (sdT < 0.0) albedo = cls > 0.5 && cls < 1.5 ? vec3(0.05, 0.065, 0.08) : vec3(0.26, 0.262, 0.26);
      if (sdT >= 0.0) shade = max(shade, roofSegBox(qt, sdir * tw.z, 0.5 * tw.xy));
      if (sdP >= 0.0) shade = max(shade, roofSegBox(q, sdir * pl.w, 0.5 * pl.yz));
    } else if (pl.x > 1.5 && pl.x < 2.5) {
      float sdH = roofBoxSdf(q, 0.5 * pl.yz);
      if (sdH < 0.0) {
        float rib = 1.0 - smoothstep(0.8, 0.8 + fwS, abs(fract(u / 12.0) - 0.5) * 12.0 - 4.5);
        albedo = vec3(0.085, 0.087, 0.09) * (1.0 - 0.3 * rib * detailK);
        emit += vec3(${HALO_HDR.windowSodium.map((x) => x.toFixed(3)).join(', ')}) * night * 0.06 * detailK * rib;
      } else {
        shade = max(shade, roofSegBox(q, sdir * pl.w, 0.5 * pl.yz));
      }
    } else if (pl.x > 2.5) {
      float a = clamp(floor((u + 120.0) / 48.0), 0.0, 4.0);
      float b = clamp(floor((w + 144.0) / 18.0), 0.0, 15.0);
      vec2 cq2 = q - vec2((a - 2.0) * 48.0, (b - 7.5) * 18.0);
      float ia = Lid * 5.0 + a;
      float ib = row * 16.0 + b;
      float miss = step(haloHashI(ia, ib, 37.0), 0.12);
      float inC = step(roofBoxSdf(cq2, vec2(20.0, 6.0)), 0.0) * (1.0 - miss) * step(roofBoxSdf(q, vec2(120.0, 144.0)), 0.0);
      float palI = floor(haloHashI(ia, ib, 38.0) * 4.0);
      vec3 cc = palI < 0.5 ? vec3(0.19, 0.06, 0.035) : (palI < 1.5 ? vec3(0.03, 0.08, 0.15) : (palI < 2.5 ? vec3(0.16, 0.12, 0.05) : vec3(0.3)));
      vec3 avg = vec3(0.13, 0.09, 0.07);
      float inYard = step(roofBoxSdf(q, vec2(120.0, 144.0)), 0.0);
      albedo = mix(albedo, mix(avg, cc, detailK), mix(0.7 * inYard, inC, detailK));
      shade = max(shade, (1.0 - inC) * 0.35 * inYard * detailK);
    }
    // noca: znaczniki placow swieca na niebiesko (bilboardy robia to z bliska)
    emit += vec3(${HALO_HDR.stripBlue.map((x) => x.toFixed(3)).join(', ')}) * corner * night * 0.25 * (pl.x < 0.5 ? 1.0 : 0.0) * (1.0 - detailK * 0.6);
    return;
  }
  if (maglev) {
    float g1 = uRoofLanes1.y + 30.0;
    float g2 = uRoofLanes1.z - 30.0;
    float guide = max(1.0 - smoothstep(13.0, 13.0 + fwd, abs(d - g1)), 1.0 - smoothstep(13.0, 13.0 + fwd, abs(d - g2)));
    albedo = mix(vec3(0.04, 0.042, 0.046), vec3(0.11, 0.112, 0.116), guide);
    float edge = max(1.0 - smoothstep(0.8, 0.8 + fwd, abs(abs(d - g1) - 14.0)), 1.0 - smoothstep(0.8, 0.8 + fwd, abs(abs(d - g2) - 14.0)));
    emit += vec3(${HALO_HDR.stripBlue.map((x) => x.toFixed(3)).join(', ')}) * edge * (0.12 + 0.35 * night) * step(0.35, fract(sRel / 40.0));
    float dy = sdir.y * 12.0;
    float lo = min(d, d + dy);
    float hi = max(d, d + dy);
    float sh = max(step(lo, g1 + 13.0) * step(g1 - 13.0, hi), step(lo, g2 + 13.0) * step(g2 - 13.0, hi));
    shade = max(shade, (1.0 - guide) * sh * 0.7);
    return;
  }
  if (ind) {
    vec2 pc = haloPat(6, sRel);
    float i = pc.x;
    float u = (pc.y - 0.5) * cS;
    float dd = d - uRoofLanes2.x;
    float j = floor(dd / cD);
    float w = dd - (j + 0.5) * cD;
    float cls = roofClassOf(i);
    vec3 plate = cls > 1.5 ? vec3(0.07, 0.062, 0.058) : vec3(0.08, 0.082, 0.086);
    albedo = plate * (0.9 + 0.2 * haloHash12(vec2(i, j)));
    if (j >= uRoofLanes2.y) return;
    vec3 ex;
    vec4 c0 = roofIndCell(i, j, cls, ex);
    vec2 q = vec2(u, w) - ex.xy;
    float sd = roofIndSdf(c0, ex, q);
    float objA = 1.0 - smoothstep(-0.6, 0.6 + fw * 0.5, sd);
    if (c0.x > 0.5) {
      float white = step(haloHashI(i, j, 19.0), 0.5);
      vec3 objCol = vec3(0.3);
      if (c0.x < 1.5) objCol = mix(vec3(0.15, 0.152, 0.156), vec3(0.3), white) * (1.0 - 0.35 * (1.0 - smoothstep(-3.0, -1.2, sd)));
      else if (c0.x < 2.5) objCol = cls > 1.5 ? vec3(0.12, 0.082, 0.06) : vec3(0.15, 0.152, 0.156);
      else if (c0.x < 4.5 && c0.x > 3.5) objCol = length(q) < c0.y ? vec3(0.09) : vec3(0.03);
      else if (c0.x > 4.5) objCol = vec3(0.3) * (0.75 + 0.25 * clamp(1.0 - length(q) / c0.y, 0.0, 1.0));
      float avgA = c0.x > 2.5 && c0.x < 3.5 ? 0.35 : 0.6;
      albedo = mix(albedo, objCol, mix(avgA * 0.5, objA, detailK));
      // styk z dachem: ciemniejsza obwodka
      albedo *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 3.0 + fw, sd)) * step(0.0, sd) * detailK;
    }
    // cienie: ta komorka i sasiednie w strone slonca
    float si = sunT.x >= 0.0 ? 1.0 : -1.0;
    float sj = sunT.y >= 0.0 ? 1.0 : -1.0;
    vec2 uw = vec2(u, w);
    float sh = roofIndShadow(i, j, uw, sdir);
    sh = max(sh, roofIndShadow(i + si, j, uw - vec2(si * cS, 0.0), sdir));
    sh = max(sh, roofIndShadow(i, j + sj, uw - vec2(0.0, sj * cD), sdir));
    sh = max(sh, roofIndShadow(i + si, j + sj, uw - vec2(si * cS, sj * cD), sdir));
    if (abs(sdir.x) > abs(sdir.y)) sh = max(sh, roofIndShadow(i + 2.0 * si, j, uw - vec2(2.0 * si * cS, 0.0), sdir));
    else sh = max(sh, roofIndShadow(i, j + 2.0 * sj, uw - vec2(0.0, 2.0 * sj * cD), sdir));
    shade = max(shade, sh * step(0.0, sd) * mix(0.6, 1.0, detailK));
    // noca lampy sodowe (przemysl): nie w kazdej komorce, w losowym miejscu
    float lampOn = step(0.6, haloHashI(i, j, 41.0)) * step(1.5, cls);
    vec2 lpos = (vec2(haloHashI(i, j, 42.0), haloHashI(i, j, 43.0)) - 0.5) * vec2(cS, cD) * 0.8;
    float lamp = (1.0 - smoothstep(1.6, 1.6 + fw, length(vec2(u, w) - lpos))) * lampOn * (0.5 + 0.8 * haloHashI(i, j, 44.0));
    emit += vec3(${HALO_HDR.windowSodium.map((x) => x.toFixed(3)).join(', ')}) * night * mix(0.006 * step(1.5, cls), lamp, detailK);
    return;
  }
}
`;

const STRUCTURE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
${HALO_GLSL_SURFACE}
${HALO_GLSL_ROOF}
${HALO_GLSL_FG}
${HALO_GLSL_FG_CLIP}
${HALO_GLSL_TRANSIT}
varying vec3 vRel;
varying vec3 vNormal;
varying vec2 vST;
varying float vKind;
varying vec2 vRZ;

// Otoczenie odbijane przez metal: planeta (sfera), niebo habitatu albo kosmos.
vec3 structEnv(vec3 R, vec3 p, bool inner) {
  vec3 oc = uPlanet.xyz - p;
  float tb = dot(oc, R);
  float d2 = dot(oc, oc) - tb * tb;
  if (tb > 0.0 && d2 < uPlanet.w * uPlanet.w) {
    vec3 hitN = normalize(p + R * (tb - sqrt(uPlanet.w * uPlanet.w - d2)) - uPlanet.xyz);
    float pl = dot(hitN, uSunDir);
    return mix(vec3(0.003, 0.005, 0.009), vec3(0.11, 0.17, 0.26) * uSunColor, smoothstep(-0.05, 0.3, pl));
  }
  if (inner) {
    vec3 up = haloUp(p);
    float h = dot(R, up);
    vec3 sky = mix(vec3(0.15, 0.22, 0.33), vec3(0.04, 0.08, 0.16), clamp(h, 0.0, 1.0));
    vec3 ground = vec3(0.025, 0.04, 0.028);
    float lit = haloLuma(haloSunVisibility(p + up * 600.0, uSunDir));
    return mix(ground, sky, smoothstep(-0.12, 0.06, h)) * (0.15 + 0.85 * lit) + vec3(0.002);
  }
  return vec3(0.0012, 0.0016, 0.0024);
}

void main() {
  vec3 rel = vRel;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  vec3 p = uCamLocal + rel;
  haloFgClip(p);
  vec3 N = normalize(vNormal);
  int kind = int(vKind + 0.5);
  // wylot tranzytu po stronie planety (kadlub)
  if (kind == 4 && haloInTransitCut(vST.x + uRefBasis.w, vRZ.y)) discard;
  bool inner = kind == 1 || kind == 7;
  float sRel = vST.x;
  float v = vST.y;
  float fwS = fwidth(sRel);
  float fwv = fwidth(v);

  // plyty: sciany od srodka duze (480 x 300 j.), dach i kadlub drobne (96 x 64)
  int pk = inner ? 4 : 3;
  float pH = inner ? 300.0 : 64.0;
  vec2 pp = haloPat(pk, sRel);
  float pv = v / pH;
  vec2 pf = vec2(pp.y, fract(pv));
  vec2 pw = vec2(fwS / uPatT[pk], fwv / pH);
  float farP = smoothstep(0.1, 0.4, max(pw.x, pw.y));
  float seamD = min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y));
  float seamW = inner ? 0.004 : 0.015;
  float seam = (1.0 - smoothstep(seamW, seamW + max(pw.x, pw.y) * 1.5, seamD)) * (1.0 - farP) * (inner ? 0.35 : 1.0);
  float ph = haloHash12(vec2(pp.x, floor(pv)) + vKind * 17.0);
  float panelVar = mix(ph, 0.5, farP);
  vec3 base = vec3(0.030, 0.034, 0.040);           // kadlub, spod, krawedzie: prawie czern
  if (kind == 3) base = vec3(0.056, 0.060, 0.066);  // dach
  if (inner) base = vec3(0.060, 0.064, 0.070);      // sciany od srodka: ciemna stal
  vec3 metal = base * (0.86 + 0.28 * panelVar);
  vec4 var0 = haloVar(0, sRel, v);
  vec4 var1 = haloVar(1, sRel, v);
  vec4 var2 = haloVar(2, sRel, v);
  metal *= 0.84 + 0.32 * (var0.b * 0.5 + 0.5) * (0.75 + 0.25 * (var1.b * 0.5 + 0.5));
  float rough = inner ? 0.30 : (kind == 3 ? 0.55 : 0.42);
  rough = clamp(rough + (var2.b) * 0.08, 0.15, 0.6);
  // Sciany od srodka (M3): „miasto na scianie” - tarasy co 150 j., fasady
  // budynkow z oknami w rzedach, zebra konstrukcji; w sektorach krajobrazu
  // goly metal z rzadkimi oknami. Dolna sciana patrzy prosto w kamere gry.
  vec3 wallEmit = vec3(0.0);
  float wallGlass = 0.0;
  if (inner) {
    float Wh = uFloorDims.w;
    float hw = ((kind == 7) == (uHabitat.x > 0.0)) ? v : Wh - v;
    float fwh = fwidth(hw);
    vec2 fc = haloPat(6, sRel);
    float cls = roofClassOf(fc.x);
    float cityK = cls > 0.5 ? 1.0 : 0.16;
    // tarasy: jasna krawedz pokladu u dolu pasma, cien nawisu u gory
    float lv = hw / 150.0;
    float lw = fwidth(lv);
    float tf = fract(lv);
    float fadeT = 1.0 - smoothstep(0.12, 0.4, lw);
    float deck = (1.0 - smoothstep(0.03, 0.03 + lw * 1.5, tf)) * fadeT;
    float overhang = smoothstep(0.72, 1.0, tf) * fadeT;
    // budynki wzdluz: kwartal 140 j. (wzor 0), okna 7 j. (wzor 2), kondygnacje 10 j.
    // Dolna sciana lezy ~5,7 tys. j. pod plaszczyzna gry, wiec kamera gry widzi
    // ja w ~1/4 skali dachu: pojedyncze okna znikaja, zostaje skala posrednia -
    // pasma pieter (30 j.) i grupy kolumn (35 j.) z wlasna jasnoscia.
    vec2 bp = haloPat(0, sRel);
    float level = floor(lv);
    float bRand = haloHash12(vec2(bp.x, level) + 3.7);
    float hasB = step(1.0 - cityK * 0.85, bRand) * step(0.5, level) * step(level, floor(Wh / 150.0) - 1.0);
    float gap = step(0.06, bp.y) * step(bp.y, 0.94);
    float band = floor(hw / 30.0);
    float grp = floor(bp.y * 4.0);
    float bandK = haloHash12(vec2(bp.x * 7.0 + grp, band) + 1.3);
    float grpK = haloHash12(vec2(bp.x, grp) + 9.1);
    float wellGap = 1.0 - (1.0 - smoothstep(0.0, 0.04 + fwS / uPatT[0] * 2.0, abs(fract(bp.y * 4.0) - 0.5) - 0.44)) * 0.7;
    vec2 wc = haloPat(2, sRel);
    float row = floor(hw / 10.0);
    float wf = fract(hw / 10.0);
    float winAA = 1.0 - smoothstep(0.3, 0.9, max(fwS / uPatT[2], fwh / 10.0));
    float midAA = 1.0 - smoothstep(0.3, 0.9, max(fwS / (uPatT[0] * 0.25), fwh / 30.0));
    float win = step(0.22, wc.y) * step(wc.y, 0.78) * step(0.28, wf) * step(wf, 0.78) * gap * hasB;
    float winAvg = 0.28 * gap * hasB;
    // fasada: tynk / szklo wedlug budynku, pasma pieter jasniejsze/ciemniejsze
    vec3 facade = mix(vec3(0.085, 0.088, 0.094), vec3(0.05, 0.062, 0.075), step(0.55, fract(bRand * 7.3)));
    facade *= mix(1.0, 0.8 + 0.4 * bandK, midAA) * mix(1.0, wellGap, midAA);
    vec3 wallBase = mix(metal, facade, hasB * gap);
    wallBase = mix(wallBase, vec3(0.02, 0.026, 0.034), mix(winAvg, win, winAA) * 0.85);
    wallBase = mix(wallBase, vec3(0.16, 0.16, 0.155), deck * 0.8);
    // ogrody na tarasach (M4): pas zieleni nad krawedzia pokladu, korony drzew
    float gardenBand = smoothstep(0.03, 0.05, tf) * (1.0 - smoothstep(0.13, 0.16, tf)) * fadeT
      * step(0.5, cityK) * step(0.3, fract(bRand * 4.1));
    float crownsW = smoothstep(0.35, 0.1, haloVar(2, sRel, hw * 3.0).r);
    vec3 green = mix(vec3(0.030, 0.058, 0.022), vec3(0.016, 0.036, 0.015), crownsW);
    wallBase = mix(wallBase, green, gardenBand * 0.9);
    // z daleka (pas ogrodow ponizej piksela) zostaje zielonkawy odcien pasma
    wallBase = mix(wallBase, mix(wallBase, green, 0.1), (1.0 - fadeT) * cityK);
    wallBase *= 1.0 - 0.55 * overhang;
    // zebra konstrukcji co 960 j. (wzor 4) i smugi
    vec2 rp = haloPat(4, sRel);
    float rib = (1.0 - smoothstep(0.02, 0.02 + fwS / uPatT[4] * 1.5, abs(fract(rp.y * 0.5 + 0.25) - 0.5) - 0.47)) * (1.0 - farP);
    float streak = haloVar(3, sRel, hw * 0.08).b;
    metal = wallBase * (1.0 - rib * 0.4 + streak * 0.12);
    // brud przy podlodze
    metal *= mix(0.7, 1.0, smoothstep(0.0, 200.0, hw));
    wallGlass = mix(winAvg, win, winAA) * 0.8;
    // noca okna: czesc swieci (losowo per okno), cieple/chlodne wedlug budynku
    vec3 up = haloUp(p);
    float dayW = haloLuma(haloPlanetTransmit(p, uSunDir)) * smoothstep(-0.02, 0.12, dot(up, uSunDir));
    // kazdy budynek ma wlasny odsetek zapalonych okien (czesc zupelnie ciemna)
    float litFrac = step(0.2, fract(bRand * 5.7)) * (0.08 + 0.5 * fract(bRand * 11.3));
    // posrednia skala: pasmo pieter x grupa kolumn (czesc pasm zupelnie ciemna)
    float midLit = step(0.35, bandK) * (0.35 + 0.9 * bandK) * (0.5 + grpK) * wellGap;
    float litMid = litFrac * mix(1.0, midLit, midAA);
    float lit = step(haloHash12(vec2(wc.x, row) + bp.x * 0.37), litFrac * (0.4 + midLit));
    vec3 wcol = cls > 1.5 ? vec3(${HALO_HDR.windowSodium.map((x) => (x * 0.8).toFixed(3)).join(', ')}) :
      mix(vec3(${HALO_HDR.windowWarm.map((x) => x.toFixed(3)).join(', ')}), vec3(${HALO_HDR.windowCool.map((x) => x.toFixed(3)).join(', ')}), step(0.6, fract(bRand * 3.1)));
    wallEmit = wcol * mix(winAvg * litMid, win * lit, winAA) * (1.0 - dayW * 0.92) * 0.8 * uLayers.y * uNightLights;
    // krawedz tarasow noca: pas swiatla (ogrody M4)
    float dash = step(0.45, fract(sRel / 23.0 + level * 0.37)) * step(0.3, fract(bRand * 2.3));
    wallEmit += vec3(${HALO_HDR.windowWarm.map((x) => (x * 0.2).toFixed(3)).join(', ')}) * deck * cityK * (1.0 - dayW) * mix(0.3, dash, winAA) * uLayers.y;
  }
  metal *= 1.0 - seam * 0.4;

  // swiatla: pasy przy krawedziach dachu i spodu + rzedy na kadlubie
  vec3 emit = vec3(0.0);
  // dach (M3): pasy, dzialki, kolej, przemysl - odcisk bryl z pozornym cieniem
  float roofShade = 0.0;
  if (kind == 3) {
    float dR = uHabitat.x > 0.0 ? (uRoofLanes2.z - v) : v;
    float nightR = 1.0 - smoothstep(0.02, 0.2, haloLuma(haloSunVisibility(p + N * 2.0, uSunDir)) * max(uSunDir.z + 0.15, 0.0));
    haloRoofImpression(sRel, dR, fwS, fwv, p, uSunDir, nightR, metal, emit, roofShade);
  }
  vec3 blue = vec3(${HALO_HDR.stripBlue.map((x) => x.toFixed(3)).join(', ')});
  if (kind == 3 || kind == 5) {
    float w1 = max(3.0, fwv * 0.8);
    float edgeLine = (1.0 - smoothstep(w1, w1 + fwv * 1.5, abs(v - 38.0))) * (3.0 / w1);
    edgeLine += (1.0 - smoothstep(w1, w1 + fwv * 1.5, abs(v - (uHabitat.w - uHabitat.z - 60.0)))) * (3.0 / w1) * 0.6;
    vec2 lp = haloPat(4, sRel);
    float dash = step(0.35, lp.y);
    emit += blue * edgeLine * mix(dash, 0.65, smoothstep(0.1, 0.4, fwS / uPatT[4])) * 0.9;
  }
  if (kind == 4) {
    float rowV = v / 740.0;
    float wr = max(0.006, fwidth(rowV) * 0.8);
    float row = (1.0 - smoothstep(wr, wr + fwidth(rowV) * 1.5, abs(fract(rowV) - 0.5))) * (0.006 / wr);
    vec2 lp = haloPat(5, sRel);
    float dotW = max(0.06, fwS / uPatT[5]);
    float dots = (1.0 - smoothstep(dotW, dotW * 1.6, abs(lp.y - 0.5))) * (0.06 / dotW) * row;
    emit += blue * dots * 1.1;
    float win = step(0.965, haloHash12(vec2(pp.x, floor(v / 22.0)) + 4.0)) * (1.0 - farP);
    emit += vec3(${HALO_HDR.windowWarm.map((x) => (x * 0.55).toFixed(3)).join(', ')}) * win;
  }
  if (kind == 2 || kind == 6) {
    float w2 = max(4.0, fwv * 0.8);
    float mid = (1.0 - smoothstep(w2, w2 + fwv * 1.5, abs(v - 0.5 * ${'${RIM_H}'}))) * (4.0 / w2);
    emit += blue * mid * 0.8;
  }
  emit += wallEmit;

  // oswietlenie analityczne + odbicie otoczenia (metal)
  vec3 L = uSunDir;
  vec3 sunVis = haloSunVisibility(p + N * 2.0, L) * (1.0 - 0.85 * roofShade);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  vec3 H = normalize(L + V);
  float a2 = rough * rough;
  float NdH = max(dot(N, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  vec3 F0 = inner ? vec3(0.16 + 0.5 * wallGlass) : (kind == 3 ? vec3(0.1) : vec3(0.2));
  vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = Fs * min(a2 / (HALO_PI * dd * dd) * 0.25 / NdV, 8.0) * NdL;
  vec3 Fe = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0) * (1.0 - rough);
  vec3 env = structEnv(reflect(-V, N), p, inner);
  vec3 amb = haloPlanetshine(p, N) + vec3(uNightAmbient);
  if (inner) amb += haloSkyAmbient(p, N);
  vec3 color = metal * (uSunColor * sunVis * NdL + amb) * (1.0 - F0 * 0.5)
    + uSunColor * sunVis * spec
    + env * Fe * (inner ? 0.32 : 0.85);
  color += emit;
  if (inner) color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

// Siatka jednego segmentu: pasy dla podanych krawędzi profilu.
export function buildStripGeometry(strips, alongDiv, capacity) {
  const aAlong = [];
  const aProfile = [];
  const aEdge = [];
  const index = [];
  let base = 0;
  for (const strip of strips) {
    const pts = strip.points; // [{r, z, v}] w poprzek krawędzi
    const rows = pts.length;
    for (let i = 0; i <= alongDiv; i++) {
      for (let j = 0; j < rows; j++) {
        aAlong.push(i / alongDiv);
        aProfile.push(pts[j].r, pts[j].z);
        aEdge.push(strip.kind, pts[j].v, strip.normal.r, strip.normal.z);
      }
    }
    for (let i = 0; i < alongDiv; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = base + i * rows + j;
        const b = a + rows;
        const c = a + 1;
        const d = b + 1;
        // (a,c,b): normalna ściany = (v w poprzek) × (θ̂) = normalna zewnętrzna
        // profilu obchodzonego zgodnie z ruchem wskazówek w (r, z)
        index.push(a, c, b, c, d, b);
      }
    }
    base += (alongDiv + 1) * rows;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(aAlong, 1));
  g.setAttribute('aProfile', new THREE.Float32BufferAttribute(aProfile, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(aEdge, 4));
  // three wymaga atrybutu position do liczenia wierzchołków
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aAlong.length * 3), 3));
  g.setIndex(index);
  const segData = new Float32Array(capacity);
  const segAttr = new THREE.InstancedBufferAttribute(segData, 1);
  segAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iSeg', segAttr);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry: g, segData, segAttr };
}

// Wspólna logika wyboru segmentów w kadrze (konstrukcja, chmury, powłoka).
export class HaloSegmentSet {
  constructor({ layout, domain, geometry, segData, segAttr, rMin, rMax, zMin, zMax }) {
    this.layout = layout;
    this.domain = domain;
    this.geometry = geometry;
    this.segData = segData;
    this.segAttr = segAttr;
    this.bounds = { rMin, rMax, zMin, zMax };
    this.count = 0;
    this._sphere = new THREE.Sphere();
  }

  update(frustum, refS) {
    const { segCount, segCells, Ns } = this.domain;
    const { rMin, rMax, zMin, zMax } = this.bounds;
    const segAngle = (Math.PI * 2) / segCount;
    const rMid = (rMin + rMax) * 0.5;
    const zMid = (zMin + zMax) * 0.5;
    const segLen = segAngle * rMax;
    const radius = Math.hypot(segLen * 0.5, (rMax - rMin) * 0.5, (zMax - zMin) * 0.5) + segLen * segLen / (8 * rMax);
    let n = 0;
    for (let i = 0; i < segCount; i++) {
      const th = (i + 0.5) * segAngle;
      this._sphere.center.set(Math.cos(th) * rMid, Math.sin(th) * rMid, zMid);
      this._sphere.radius = radius;
      if (!frustum.intersectsSphere(this._sphere)) continue;
      let rel = i * segCells - refS;
      rel -= Ns * Math.round(rel / Ns);
      this.segData[n++] = rel;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.segAttr.needsUpdate = true;
    this.segAttr.clearUpdateRanges();
    this.segAttr.addUpdateRange(0, n);
  }
}

// Krawędzie górnej ściany (dach, jej krawędź i spód od strony habitatu) —
// przy płaszczyźnie gry na środku wstęgi leżą nad statkami (FG).
export const HALO_TOP_WALL_EDGES = Object.freeze(['roof', 'rimTop', 'wallTopInner']);

export class HaloStructure {
  // part: 'all' (cała bryła), 'top' (górna ściana, FG), 'rest' (bez górnej ściany)
  constructor({ layout, uniforms, surfaceUniforms, domain, part = 'all' }) {
    this.layout = layout;
    this.part = part;
    const top = new Set(HALO_TOP_WALL_EDGES);
    const edges = layout.profile.edges.filter((e) => e.kind !== 'floor'
      && (part === 'all' || (part === 'top') === top.has(e.kind)));
    const strips = edges.map((e) => ({
      kind: HALO_EDGE_KIND[e.kind],
      normal: e.normal,
      points: [
        { r: e.a.r, z: e.a.z, v: 0 },
        { r: e.b.r, z: e.b.z, v: e.length }
      ]
    }));
    this.stripCount = strips.length;
    const built = buildStripGeometry(strips, 16, domain.segCount);
    this.geometry = built.geometry;
    const rimH = layout.roofDetailMax >= 0 ? (layout.z.roof - layout.z.topIn) : 250;
    this.material = new THREE.ShaderMaterial({
      name: 'HaloStructure',
      uniforms: { ...uniforms, ...surfaceUniforms, uSegCells: { value: domain.segCells } },
      vertexShader: STRUCTURE_VERTEX,
      fragmentShader: STRUCTURE_FRAGMENT.replace('${RIM_H}', rimH.toFixed(1)),
      defines: part === 'top' ? { AIR_STEPS: 6, HALO_FG: 1 } : { AIR_STEPS: 6 },
      side: THREE.FrontSide
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = part === 'top' ? 'HaloStructure_topWall' : 'HaloStructure';
    this.mesh.frustumCulled = false;
    this.segments = new HaloSegmentSet({
      layout,
      domain,
      geometry: this.geometry,
      segData: built.segData,
      segAttr: built.segAttr,
      rMin: layout.radii.min,
      rMax: layout.radii.max,
      zMin: part === 'top' ? layout.z.topIn : layout.bounds.zMin,
      zMax: part === 'rest' ? layout.z.roof : layout.bounds.zMax
    });
  }

  update(frustum, refS) {
    this.segments.update(frustum, refS);
  }

  get triangleEstimate() {
    return this.segments.count * 16 * this.stripCount * 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
