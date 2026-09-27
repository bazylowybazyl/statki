// ECUMENE (Mars) — siatki Three z planu (ecumenePlan.js). Dema:
// dema/orbital_ring_demo.html (ląd, konstrukcja, kopuły, tablice), skala ×3,
// habitat na zewnątrz. Powierzchnia dzielnic liczy typ terenu, wodę,
// kwartały, arterie i ścieżki tymi samymi wzorami co tekstury dema, ale na
// piksel (ostro przy każdym zoomie gry). Wszystko w układzie lokalnym ringu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  HALO_GLSL_COMMON,
  HALO_GLSL_FG,
  HALO_GLSL_FG_CLIP,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_PORTSITES,
  HALO_GLSL_TRANSIT
} from '../haloRingGLSL.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ARCH_GLSL_LIT, ARCH_GLSL_SABS } from './archGLSL.js';
import { ArchLights, archBatchMesh, archHemisphere, archPointsMesh, archTreeGeometry } from './archMaterials.js';
import { archHex, archRingTubeBoxes } from './archFrame.js';
import {
  ECU_DISTRICTS,
  ECU_S,
  ECU_SHELL_PROFILE,
  ECU_TUBES,
  ECU_TYPE_PALETTE,
  buildEcumeneDomes,
  buildEcumeneInstances,
  buildEcumeneStructure,
  createEcumenePlan
} from './ecumenePlan.js';

const S = ECU_S;

// ---------------------------------------------------------------------------
// Powierzchnia dzielnic (tekstury createSectorTextures dema, na piksel).
const ECU_SURFACE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
attribute vec2 aEcu;        // s w dzielnicy, id dzielnicy (dema)
varying vec3 vPos;
varying vec3 vN;
varying vec2 vEcu;
void main() {
  vPos = position;
  vN = normal;
  vEcu = aEcu;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ECU_SURFACE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_TRANSIT}
${HALO_GLSL_PORTSITES}
${ARCH_GLSL_LIT}
${ARCH_GLSL_SABS}
uniform vec4 uEcu;          // LEN dzielnicy, S, W, -
uniform vec3 uEcuPal[10];   // barwy typow (liniowo)
varying vec3 vPos;
varying vec3 vN;
varying vec2 vEcu;

float ecuEllipse(vec2 q, vec2 c, vec2 r) { return (length((q - c) / r) - 1.0) * min(r.x, r.y); }
float ecuMod(float a, float n) { return a - n * floor(a / n); }

float ecuWater(vec2 q, float k) {
  float L = uEcu.x;
  float Sc = uEcu.y;
  float s = q.x;
  float z = q.y;
  float d = 1e5;
  if (abs(k - 1.0) < 0.5) d = ecuEllipse(q, vec2(L * 0.54, 30.0 * Sc), vec2(720.0, 265.0) * Sc) + sin(s * 0.007 / Sc) * 12.0 * Sc;
  if (abs(k - 2.0) < 0.5) {
    d = ecuEllipse(q, vec2(L * 0.52, -30.0 * Sc), vec2(1570.0, 655.0) * Sc) + sin(s * 0.009 / Sc + z * 0.007 / Sc) * 23.0 * Sc;
    d = max(d, -ecuEllipse(q, vec2(L * 0.58, 100.0 * Sc), vec2(230.0, 155.0) * Sc));
  }
  if (abs(k - 3.0) < 0.5) d = abs(z - 130.0 * Sc * sin(s * 0.0028 / Sc)) - 32.0 * Sc;
  if (abs(k - 5.0) < 0.5) d = abs(z - 130.0 * Sc * sin(s * 0.0021 / Sc)) - 68.0 * Sc;
  if (abs(k - 6.0) < 0.5) d = abs(z + 490.0 * Sc) - 46.0 * Sc;
  if (abs(k - 8.0) < 0.5) d = abs(z - 200.0 * Sc * sin(s * 0.0009 / Sc)) - 45.0 * Sc;
  if (abs(k - 9.0) < 0.5) {
    d = ecuEllipse(q, vec2(L * 0.51, 0.0), vec2(L * 0.47, 745.0 * Sc)) + sin(s * 0.006 / Sc + z * 0.009 / Sc) * 17.0 * Sc;
    d = max(d, -ecuEllipse(q, vec2(L * 0.57, 10.0 * Sc), vec2(340.0, 210.0) * Sc));
    d = max(d, -ecuEllipse(q, vec2(L * 0.31, -220.0 * Sc), vec2(150.0, 95.0) * Sc));
  }
  if (abs(k - 11.0) < 0.5) d = min(ecuEllipse(q, vec2(L * 0.59, 0.0), vec2(620.0, 250.0) * Sc), abs(z - 210.0 * Sc * sin(s * 0.0018 / Sc)) - 40.0 * Sc);
  return d;
}

float ecuType(vec2 q, float k, float water) {
  float L = uEcu.x;
  float Sc = uEcu.y;
  float HW = uEcu.z * 0.5;
  float s = q.x;
  float z = q.y;
  float t = 0.0;
  if (water < 0.0) {
    t = 3.0;
  } else if (abs(z) > HW - 38.0 * Sc) {
    t = 7.0;
  } else if (abs(abs(z) - 850.0 * Sc) < 19.0 * Sc) {
    t = 6.0;
  } else if (water < 28.0 * Sc && (abs(k - 1.0) < 0.5 || abs(k - 2.0) < 0.5 || abs(k - 9.0) < 0.5 || abs(k - 11.0) < 0.5)) {
    t = 8.0;
  } else {
    if (abs(k - 1.0) < 0.5) t = ecuEllipse(q, vec2(L * 0.51, 0.0), vec2(1600.0, 670.0) * Sc) < 0.0 ? 1.0 : 0.0;
    if (abs(k - 2.0) < 0.5) t = (ecuEllipse(q, vec2(L * 0.1, 610.0 * Sc), vec2(400.0, 140.0) * Sc) < 0.0 || ecuEllipse(q, vec2(L * 0.9, -610.0 * Sc), vec2(340.0, 160.0) * Sc) < 0.0) ? 0.0 : 2.0;
    if (abs(k - 3.0) < 0.5) t = abs(z - 130.0 * Sc * sin(s * 0.0028 / Sc)) < 115.0 * Sc ? 1.0 : 0.0;
    if (abs(k - 4.0) < 0.5) t = 1.0;
    if (abs(k - 5.0) < 0.5) t = 4.0;
    if (abs(k - 6.0) < 0.5 || abs(k - 7.0) < 0.5 || abs(k - 10.0) < 0.5) t = 5.0;
    if (abs(k - 8.0) < 0.5) t = abs(z - 200.0 * Sc * sin(s * 0.0009 / Sc)) < 110.0 * Sc ? 1.0 : 0.0;
    if (abs(k - 9.0) < 0.5) t = 2.0;
    if (abs(k - 11.0) < 0.5) t = sin(s * 0.0028 / Sc) + cos(z * 0.009 / Sc) > 0.65 ? 0.0 : 2.0;
    if (k < 0.5 && ecuEllipse(q, vec2(L * 0.48, -30.0 * Sc), vec2(330.0, 230.0) * Sc) < 0.0) t = 7.0;
    if (t < 0.5 || abs(t - 5.0) < 0.5) {
      if (ecuMod(s, 76.0 * Sc) < 12.0 * Sc || ecuMod(z + 850.0 * Sc, 88.0 * Sc) < 12.0 * Sc) t = 6.0;
    }
  }
  return t;
}

vec3 ecuPal(float t) {
  vec3 c = uEcuPal[0];
  for (int i = 1; i < 10; i++) {
    if (abs(t - float(i)) < 0.5) c = uEcuPal[i];
  }
  return c;
}
vec3 ecuLin(vec3 srgb255) {
  vec3 c = clamp(srgb255 / 255.0, 0.0, 1.0);
  return pow(c, vec3(2.2));
}

void main() {
  float sAbs = archSAbs(vPos);
  float z = vPos.z;
  if (haloInTransitCut(sAbs, z)) discard;
  float Sc = uEcu.y;
  float L = uEcu.x;
  float k = floor(vEcu.y + 0.5);
  vec2 q = vec2(vEcu.x, z);
  float water = ecuWater(q, k);
  float t = ecuType(q, k, water);
  // plyty portu (miejsca kompleksow i tranzytow: plasko, beton)
  float tFloor = z - uRingZ.z;
  float pad = haloPortPad(sAbs, tFloor, L, 0.0, 60.0);
  vec3 n = normalize(vN);
  vec3 emit = vec3(0.0);
  vec3 col;
  // szum teksela dema (4 m x S) i wzory typow
  vec2 texel = floor(q / (4.14 * Sc));
  float nz = (haloHash12(texel + k * 131.0) - 0.5) * 14.0 + sin(q.x * 0.019 / Sc + z * 0.011 / Sc) * 3.0;
  if (abs(t - 4.0) < 0.5) nz += sin(floor(q.x / (180.0 * Sc)) * 16.0 + floor((z + uEcu.z * 0.5) / (220.0 * Sc)) * 8.0) * 19.0 + (ecuMod(z, 12.0 * Sc) < 4.0 * Sc ? -9.0 : 4.0);
  if (abs(t - 2.0) < 0.5 || abs(t - 1.0) < 0.5) nz += sin(q.x * 0.018 / Sc) * cos(z * 0.022 / Sc) * 7.0;
  vec3 base255 = ecuPal(t);
  // kwartaly: slady budynkow w siatce katastralnej (76 x 88 dema)
  if (t < 0.5 || abs(t - 5.0) < 0.5 || abs(t - 6.0) < 0.5) {
    float ci = floor(q.x / (76.0 * Sc));
    float sc0 = 38.0 * Sc + ci * 76.0 * Sc;
    float cj = floor((z + 806.0 * Sc + 44.0 * Sc) / (88.0 * Sc));
    float zc0 = -806.0 * Sc + cj * 88.0 * Sc;
    vec2 cc = vec2(sc0, zc0);
    float tc = ecuType(cc, k, ecuWater(cc, k));
    if ((tc < 0.5 || abs(tc - 5.0) < 0.5) && abs(q.x - sc0) < 26.0 * Sc && abs(z - zc0) < 30.0 * Sc && cj >= 0.0 && zc0 < 820.0 * Sc) {
      float v = 67.0 + haloHash12(vec2(ci, cj) + k * 17.0) * 38.0;
      base255 = vec3(v, v + 7.0, v + 9.0);
      nz *= 0.3;
    }
    float r2 = haloHash12(vec2(ci, cj) + k * 29.0 + 3.0);
    if ((tc < 0.5 || abs(tc - 5.0) < 0.5) && r2 > 0.57 && abs(q.x - sc0) < 30.0 * Sc && abs(z - (zc0 - 37.0 * Sc)) < 1.3 * Sc) {
      emit += r2 > 0.7 ? vec3(0.15, 0.27, 0.29) : vec3(0.32, 0.22, 0.12);
    }
  }
  col = ecuLin(base255 + nz);
  // arterie z = +-850: asfalt, przerywana os, oswietlenie od frontu
  float azd = abs(abs(z) - 850.0 * Sc);
  if (azd < 18.0 * Sc && water >= 0.0) {
    col = ecuLin(vec3(34.0, 44.0, 50.0) + nz * 0.3);
    float dash = step(ecuMod(q.x, 8.0 * 4.14 * Sc), 3.0 * 4.14 * Sc);
    if (azd < 0.9 * Sc) col = mix(col, ecuLin(vec3(168.0, 170.0, 153.0)), dash);
  }
  if (abs(abs(z + 15.0 * Sc * sign(z)) - 850.0 * Sc) < 1.1 * Sc) emit += vec3(0.30, 0.19, 0.07);
  // sciezki spacerowe w parkach i lasach (bez brodzenia)
  if ((abs(k - 1.0) < 0.5 || abs(k - 2.0) < 0.5 || abs(k - 4.0) < 0.5 || abs(k - 9.0) < 0.5 || abs(k - 11.0) < 0.5) && water > 25.0 * Sc) {
    for (int lane = 0; lane < 3; lane++) {
      float fl = float(lane);
      float zt = -620.0 * Sc + fl * 580.0 * Sc + sin(q.x * 0.0026 / Sc + fl) * 95.0 * Sc;
      if (abs(z - zt) < 2.5 * Sc) col = ecuLin(vec3(146.0, 149.0, 122.0));
    }
  }
  if (pad > 0.5) {
    vec2 g = abs(fract(vec2(sAbs, z) / 120.0) - 0.5);
    float line = 1.0 - smoothstep(0.46, 0.49, max(g.x, g.y));
    col = ecuLin(uEcuPal[9] * (0.92 + 0.1 * haloHash12(floor(vec2(sAbs, z) / 120.0))) - line * 18.0);
  }
  float night = archNight(vPos);
  if (water < 0.0 && pad < 0.5) {
    col = archWater(vPos, n, q, vec3(0.018, 0.092, 0.093) * 0.6, vec3(0.06, 0.15, 0.17), clamp(-water / (60.0 * Sc), 0.0, 1.0));
  } else {
    col = archShade(vPos, n, col, 0.0);
  }
  col += emit * 0.9 * (0.3 + 0.7 * night) * uLayers.y;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Tekstura płyt metalu (createPanelTexture dema): mapa + chropowatość w jednym.
function makeEcumenePanelTexture(seed) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  let a = (seed ^ 0x7971) >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  x.fillStyle = '#76818a';
  x.fillRect(0, 0, size, size);
  for (let iy = 0; iy < 8; iy++) {
    for (let ix = 0; ix < 6; ix++) {
      const px = ix * 86;
      const py = iy * 64;
      const v = 90 + r() * 48;
      x.fillStyle = `rgb(${v | 0},${(v + 10) | 0},${(v + 16) | 0})`;
      x.fillRect(px + 2, py + 2, 82, 60);
      x.fillStyle = '#151f27';
      x.fillRect(px, py, 86, 2);
      x.fillRect(px, py, 2, 64);
      x.fillStyle = '#a1a7a7';
      x.fillRect(px + 4, py + 4, 76, 1);
      if (r() > 0.35) {
        x.fillStyle = '#29353e';
        for (let j = 0; j < 6; j++) x.fillRect(px + 12, py + 18 + j * 4, 35, 2);
      }
      x.fillStyle = '#b8b09b';
      for (const dx of [6, 77]) for (const dy of [6, 55]) x.fillRect(px + dx, py + dy, 2, 2);
    }
  }
  for (let i = 0; i < 20000; i++) {
    const v = r() > 0.5 ? 255 : 0;
    x.fillStyle = `rgba(${v},${v},${v},.025)`;
    x.fillRect(r() * size, r() * size, 1 + r() * 5, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// Tablice sektorów (createSectorSigns): atlas 2 × 6 tablic 512 × 256.
function makeSignAtlas(plan) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1536;
  const x = c.getContext('2d');
  plan.sectors.forEach((sec, p) => {
    const ox = (p % 2) * 512;
    const oy = Math.floor(p / 2) * 256;
    x.fillStyle = '#172832';
    x.fillRect(ox, oy, 512, 256);
    x.strokeStyle = '#ad9470';
    x.lineWidth = 5;
    x.strokeRect(ox + 8, oy + 8, 496, 240);
    x.fillStyle = '#d6d9cf';
    x.font = 'bold 110px monospace';
    x.fillText(String(p + 1).padStart(2, '0'), ox + 28, oy + 122);
    x.font = '29px monospace';
    x.fillText(sec.name, ox + 30, oy + 173);
    x.font = '13px monospace';
    x.fillStyle = '#acb9b9';
    x.fillText('ECUMENE // ' + (ECU_DISTRICTS[sec.district]?.[1] || ''), ox + 30, oy + 219);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Siatka powierzchni dzielnicy p: (s, z) → punkt z wysokością terenu planu.
function districtSurface(plan, p, cell) {
  const { R, LEN, HW } = plan;
  const k = plan.sectors[p].district;
  const ns = Math.max(8, Math.ceil(LEN / cell));
  const nz = Math.max(8, Math.ceil((2 * HW) / cell));
  const pos = new Float32Array((ns + 1) * (nz + 1) * 3);
  const ecu = new Float32Array((ns + 1) * (nz + 1) * 2);
  const th0 = plan.theta0(p);
  let o = 0;
  let e = 0;
  for (let i = 0; i <= ns; i++) {
    const s = (LEN * i) / ns;
    const th = th0 + s / R;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    for (let j = 0; j <= nz; j++) {
      const z = -HW + (2 * HW * j) / nz;
      let h = plan.terrainHeight(s, z, k);
      if (plan.waterField(s, z, k) < 0) h = 3.6 * S;
      const pc = plan.portClass(th, z);
      if (pc === 2) h = PORT_PAD_H;
      else if (pc === 1) h = Math.min(h, 20 * S);
      const r = R + h;
      pos[o++] = r * c;
      pos[o++] = r * sn;
      pos[o++] = z;
      ecu[e++] = s;
      ecu[e++] = k;
    }
  }
  const idx = [];
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nz; j++) {
      const a = i * (nz + 1) + j;
      const b = a + nz + 1;
      // normalna ku górze (od planety): (θ̂, ẑ, r̂) — kolejność jak w demie
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEcu', new THREE.BufferAttribute(ecu, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // normalne mają patrzeć od planety (habitat na zewnątrz)
  const n = g.getAttribute('normal');
  const p0 = new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), 0);
  const n0 = new THREE.Vector3().fromBufferAttribute(n, 0);
  if (n0.x * p0.x + n0.y * p0.y < 0) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  }
  g.computeBoundingSphere();
  return g;
}

// Pas wokół ringu po profilu (h, z) — powłoka; u wzdłuż ringu co `rep` j.
function shellStrip(plan, profile, segs, repU, repV) {
  const { R } = plan;
  const pos = [];
  const uv = [];
  const idx = [];
  const nrm = [];
  const L = 2 * Math.PI * R;
  for (let f = 0; f < profile.length - 1; f++) {
    const [h0, z0] = profile[f];
    const [h1, z1] = profile[f + 1];
    const base = pos.length / 3;
    // normalna ściany w (r, z): prostopadła do odcinka, na zewnątrz bryły
    const dr = (h1 - h0) * S;
    const dz = (z1 - z0) * S;
    const len = Math.hypot(dr, dz) || 1;
    // normalna na zewnątrz bryły: profil idzie od lewej krawędzi (−z) przez
    // spód do prawej, bryła po lewej stronie kierunku → n = (−dz, dr)
    const nr = -dz / len;
    const nzz = dr / len;
    for (let i = 0; i <= segs; i++) {
      const th = plan.layout.sectorStart + (i / segs) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      for (let j = 0; j < 2; j++) {
        const h = (j ? h1 : h0) * S;
        const z = (j ? z1 : z0) * S;
        const r = R + h;
        pos.push(r * c, r * sn, z);
        nrm.push(nr * c, nr * sn, nzz);
        uv.push((i / segs) * L / repU, j * len / repV);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Macierz korzenia kopuły: środek podstawy (θ, z, base), góra = od planety,
// skala (r, r·vertical, r) — jak root dema (P + obrót ramy + scale).
function domeRootMatrix(plan, d, out) {
  const c = Math.cos(d.theta);
  const s = Math.sin(d.theta);
  const r = plan.R + d.base;
  // kolumny: X = styczna·r, Y = góra·r·v, Z = −oś·r (Matrix4.set bierze wiersze)
  out.set(
    -s * d.r, c * d.r * d.vertical, 0, r * c,
    c * d.r, s * d.r * d.vertical, 0, r * s,
    0, 0, -d.r, d.z,
    0, 0, 0, 1
  );
  return out;
}

export function buildEcumeneRing({ layout, uniforms, materials, geos, quality, seed, portLights = [], portSolid = null }) {
  const plan = createEcumenePlan(layout, seed);
  const bg = [];
  const fg = [];
  const disposables = [];
  const lights = new ArchLights();
  for (const l of portLights) lights.add(l.x, l.y, l.z, l.color, l.size, l.phase);
  const zTop = layout.z.topIn;

  // ---- powierzchnia dzielnic ----
  const surfUniforms = {
    ...uniforms,
    uEcu: { value: new THREE.Vector4(plan.LEN, S, plan.W, 0) },
    uEcuPal: { value: ECU_TYPE_PALETTE.map((c) => new THREE.Vector3(...c)) }
  };
  const surfaceMat = new THREE.ShaderMaterial({
    name: 'EcumeneSurface',
    uniforms: surfUniforms,
    vertexShader: ECU_SURFACE_VERTEX,
    fragmentShader: ECU_SURFACE_FRAGMENT
  });
  disposables.push(surfaceMat);
  const cell = quality?.gridDiv >= 64 ? 48 : 64;
  const surfaces = [];
  for (let p = 0; p < plan.N; p++) {
    const mesh = new THREE.Mesh(districtSurface(plan, p, cell), surfaceMat);
    mesh.name = `EcumeneSurface_${p}`;
    bg.push(mesh);
    surfaces.push(mesh);
  }

  // ---- zabudowa, przemysł, lasy, parki, kopuły ----
  const inst = buildEcumeneInstances(plan);
  const domes = buildEcumeneDomes(plan, inst.per, lights);
  const treeGeo = archTreeGeometry('ico');
  disposables.push(treeGeo);
  const matBG = materials.instanced(false);
  const treeMat = materials.instanced(false, true);
  const districts = inst.per.map((B, p) => {
    const d = {
      p,
      box: archBatchMesh(B.box, geos.box, matBG),
      cyl: archBatchMesh(B.cyl, geos.cyl, matBG),
      tree: archBatchMesh(B.tree, treeGeo, treeMat)
    };
    for (const k of ['box', 'cyl', 'tree']) if (d[k]) bg.push(d[k]);
    const th = plan.theta0(p) + plan.span * 0.5;
    d.center = new THREE.Vector3(plan.R * Math.cos(th), plan.R * Math.sin(th), 0);
    return d;
  });

  // ---- konstrukcja: żebra, belki, radiatory, rury wzdłuż ringu i bryły
  // portu (zatoki, tranzyty) — jedna partia na stronę (BG + FG) ----
  const st = buildEcumeneStructure(plan);
  for (const t of ECU_TUBES) {
    for (const side of [-1, 1]) {
      const color = t.color == null ? [0.38 * 0.55, 1.6 * 0.55, 2.3 * 0.55] : archHex(t.color);
      const z = side * t.z * S;
      archRingTubeBoxes(z > zTop - 1 ? st.fg : st.bg, plan.R, t.h * S, z, t.r * S, 512, color,
        t.color == null ? 2 : 0, t.color == null ? 1 : (t.color === 0xb19a70 ? 0.6 : 0.3));
    }
  }
  if (portSolid) st.bg.append(portSolid);
  const stBG = archBatchMesh(st.bg, geos.box, matBG);
  const stFG = archBatchMesh(st.fg, geos.box, materials.instanced(true));
  if (stBG) bg.push(stBG);
  if (stFG) fg.push(stFG);

  // ---- powłoka (profil dema) ----
  const panel = makeEcumenePanelTexture(seed);
  const black = blackTexture();
  disposables.push(panel, black);
  const prof = ECU_SHELL_PROFILE;
  const shellSegs = Math.round(48 * 12 * layout.circumference / (S * 2 * Math.PI * 8100));
  const shellBG = shellStrip(plan, prof.slice(0, 6), shellSegs, 390 * S, 1.7 * 390 * S / 1.7);
  const shellFG = shellStrip(plan, prof.slice(5), shellSegs, 390 * S, 390 * S);
  const tint = [0.84, 0.86, 0.87];
  const shellMatBG = materials.strip({ map: panel, emap: black, tint, emitGain: 0, varScale: 2700 });
  const shellMatFG = materials.strip({ map: panel, emap: black, tint, emitGain: 0, varScale: 2700, fg: true });
  const shellMeshBG = new THREE.Mesh(shellBG, shellMatBG);
  const shellMeshFG = new THREE.Mesh(shellFG, shellMatFG);
  shellMeshBG.name = 'EcumeneShell';
  shellMeshFG.name = 'EcumeneShellFG';
  bg.push(shellMeshBG);
  fg.push(shellMeshFG);

  // ---- tablice sektorów (+z, patrzą w kamerę gry) ----
  let signMesh = null;
  const atlas = makeSignAtlas(plan);
  disposables.push(atlas);
  {
    const pos = [];
    const uv = [];
    const nrm = [];
    const idx = [];
    plan.sectors.forEach((sec, p) => {
      const a = plan.theta0(p) + plan.span * 0.5;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const r = plan.R - 190 * S;
      const hw = 195 * S;
      const hh = 97.5 * S;
      const z = 1130 * S + 6;
      const ox = (p % 2) * 0.5;
      const oy = 1 - (Math.floor(p / 2) + 1) / 6;
      const base = pos.length / 3;
      // tablica w płaszczyźnie z = const: szerokość wzdłuż ringu, wysokość promieniowo
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const rr = r + v * hh;
        const x = rr * c - sn * u * hw;
        const y = rr * sn + c * u * hw;
        pos.push(x, y, z);
        nrm.push(0, 0, 1);
        uv.push(ox + (u + 1) * 0.25, oy + (v + 1) * 0.5 / 6);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = materials.strip({ map: atlas, emap: atlas, tint: [1, 1, 1], emitGain: 0.19, varScale: 1e9, fg: true });
    mat.side = THREE.DoubleSide;
    const signs = new THREE.Mesh(g, mat);
    signs.name = 'EcumeneSigns';
    fg.push(signs);
    signMesh = signs;
  }
  const signCenters = plan.sectors.map((sec, p) => {
    const a = plan.theta0(p) + plan.span * 0.5;
    return new THREE.Vector3((plan.R - 190 * S) * Math.cos(a), (plan.R - 190 * S) * Math.sin(a), 1130 * S);
  });

  // ---- kopuły: szkło, kratownica, żebra, kołnierz, dno, ścieżka, staw ----
  const hemi = archHemisphere();
  disposables.push(hemi);
  const domeM = new THREE.Matrix4();
  const glassMesh = new THREE.InstancedMesh(hemi, materials.glass({ alpha: 0.1 }), Math.max(1, domes.length));
  glassMesh.count = domes.length;
  glassMesh.renderOrder = 30;
  glassMesh.name = 'EcumeneDomeGlass';
  const glassTint = archHex(0x83a9ab);
  // kratownica: linie półkuli w układzie ringu (jedno wywołanie)
  const wire = new THREE.WireframeGeometry(hemi);
  const wp = wire.getAttribute('position');
  const linePos = new Float32Array(wp.count * 3 * Math.max(1, domes.length));
  const v = new THREE.Vector3();
  // żebra (6 południków), kołnierz, dno, ścieżka, staw: instancje
  const ribParts = [];
  for (let j = 0; j < 6; j++) {
    const az = (j / 6) * Math.PI;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(t) * Math.cos(az), Math.sin(t), Math.cos(t) * Math.sin(az)));
    }
    ribParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.004, 5, false));
  }
  const ribGeo = mergeGeometries(ribParts);
  for (const g of ribParts) g.dispose();
  ribGeo.deleteAttribute('uv');
  const collarGeo = new THREE.CylinderGeometry(1.012, 1.025, 0.07, 64, 1, true).translate(0, -0.008, 0);
  collarGeo.deleteAttribute('uv');
  const floorGeo = new THREE.CircleGeometry(0.97, 64).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
  floorGeo.deleteAttribute('uv');
  const walkGeo = new THREE.RingGeometry(0.53, 0.56, 64).rotateX(-Math.PI / 2).translate(0, 0.015, 0);
  walkGeo.deleteAttribute('uv');
  const pondGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  pondGeo.deleteAttribute('uv');
  disposables.push(ribGeo, collarGeo, floorGeo, walkGeo, pondGeo, wire);
  const domeBatches = { rib: [], collar: [], floor: [], walk: [], pond: [] };
  domes.forEach((d, i) => {
    domeRootMatrix(plan, d, domeM);
    glassMesh.setMatrixAt(i, domeM);
    glassMesh.setColorAt(i, new THREE.Color().setRGB(glassTint[0], glassTint[1], glassTint[2]));
    for (let q = 0; q < wp.count; q++) {
      v.fromBufferAttribute(wp, q).multiplyScalar(1.002).applyMatrix4(domeM);
      linePos.set([v.x, v.y, v.z], (i * wp.count + q) * 3);
    }
    domeBatches.rib.push(domeM.clone());
    domeBatches.collar.push(domeM.clone());
    domeBatches.floor.push(domeM.clone());
    domeBatches.walk.push(domeM.clone());
    const pm = domeM.clone().multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(0.15, 0.021, -0.08), new THREE.Quaternion(),
      new THREE.Vector3(d.type === 5 ? 0.68 : 0.34, 1, d.type === 5 ? 0.57 : 0.27)));
    domeBatches.pond.push(pm);
  });
  glassMesh.instanceMatrix.needsUpdate = true;
  if (glassMesh.instanceColor) glassMesh.instanceColor.needsUpdate = true;
  glassMesh.computeBoundingSphere();
  if (domes.length) bg.push(glassMesh);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.computeBoundingSphere();
  const lattice = new THREE.LineSegments(lineGeo, materials.lines({ color: archHex(0xa6b9b9), alpha: 0.63 }));
  lattice.name = 'EcumeneDomeLattice';
  if (domes.length) bg.push(lattice);
  const domeInst = (list, geo, color, kind, p1, name, mat = matBG) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo.clone(), mat, list.length);
    const a = new Float32Array(list.length * 4);
    list.forEach((mm, i) => {
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, new THREE.Color().setRGB(color[0], color[1], color[2]));
      a.set([kind, 0.3, p1, 0], i * 4);
    });
    mesh.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(a, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    bg.push(mesh);
  };
  // żebra, kołnierz, dno i ścieżka kopuły w jednej bryle (barwy w wierzchołkach)
  const tintGeo = (g, hex) => {
    const c = archHex(hex);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  // staw (0,34 × 0,27 promienia, jak w demie) w tej samej bryle
  const pondPart = pondGeo.clone().scale(0.34, 1, 0.27).translate(0.15, 0.021, -0.08);
  const partsGeo = mergeGeometries([tintGeo(ribGeo, 0xb9c6c8), tintGeo(collarGeo, 0x202b34), tintGeo(floorGeo, 0x4c6643), tintGeo(walkGeo, 0x939581), tintGeo(pondPart, 0x225658)]);
  pondPart.dispose();
  disposables.push(partsGeo);
  domeInst(domeBatches.rib, partsGeo, [1, 1, 1], 0, 0.3, 'EcumeneDomeParts', materials.instanced(false, true));
  const domeMeshes = bg.filter((o) => /^EcumeneDome/.test(o.name));
  const domeCenters = domes.map((d) => {
    const r = plan.R + d.base;
    return { p: new THREE.Vector3(r * Math.cos(d.theta), r * Math.sin(d.theta), d.z), r: d.r };
  });

  // ---- światła pozycyjne (lampki kopuł) ----
  const pts = archPointsMesh(lights, materials.points(false));
  if (pts) bg.push(pts);

  const lod = quality?.lod || {};
  const treeAlt = (lod.treeAltitude || 2500) * 6;
  return {
    bg,
    fg,
    domes,
    landmarks: [],
    stats: { instances: inst.stats.buildings + inst.stats.trees, buildings: inst.stats.buildings, trees: inst.stats.trees, lights: lights.pos.length / 3 },
    heightAt: (theta, z) => plan.heightAt(theta, z),
    plan,
    // LOD: drzewa i drobne bryły dzielnicy znikają, gdy kamera daleko (mniej niż ~1 px)
    update(camLocal, frustum, pixelAngle) {
      // kopuły i tablice tylko w zasięgu kadru (jak LOD kamery gry ringu Ziemi)
      const reach = Math.max(4000, Math.abs(camLocal.z) * 1.1) + 2500;
      let near = false;
      for (const d of domeCenters) if (d.p.distanceTo(camLocal) - d.r < reach) { near = true; break; }
      for (const o of domeMeshes) o.visible = near;
      let signNear = false;
      for (const c of signCenters) if (c.distanceTo(camLocal) < reach + 1200) { signNear = true; break; }
      if (signMesh) signMesh.visible = signNear;
      for (const d of districts) {
        const dist = Math.max(1, d.center.distanceTo(camLocal) - plan.LEN * 0.5);
        const px = pixelAngle > 0 ? 1 / (dist * pixelAngle) : 1;
        if (d.tree) d.tree.visible = 90 * px > 1.2 && dist < treeAlt * 12;
        if (d.cyl) d.cyl.visible = 60 * px > 1.0;
        if (d.box) d.box.visible = 250 * px > 1.0;
      }
    },
    dispose() {
      for (const x of disposables) x.dispose?.();
    }
  };
}
