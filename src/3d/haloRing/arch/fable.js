// Ring Fable (Jowisz) — siatki Three z planu (fablePlan.js). Demo:
// dema/orbital_ring_demo_2.html (ląd ze strefami, zamieszkane ściany,
// kadłub z płyt, żebra i kratownice, radiatory, hangary, anteny, kopuły),
// skala ×3, habitat na zewnątrz. Mapa stref pieczona na CPU (tekstura jak
// w demie), szczegół (drogi, arterie, pola, lądowiska, światła miast) na
// piksel. Bez udawanego ruchu (smugi aut i impulsy maglevu dema wypadają —
// ring nie udaje życia, docs/BRIEF-ring-halo.md §1).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  HALO_GLSL_COMMON,
  HALO_GLSL_FG,
  HALO_GLSL_FG_CLIP,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_TRANSIT
} from '../haloRingGLSL.js';
import { ARCH_GLSL_LIT, ARCH_GLSL_SABS } from './archGLSL.js';
import { ArchLights, archBatchMesh, archHemisphere, archPointsMesh, archTreeGeometry } from './archMaterials.js';
import { archHex, archRingTubeBoxes } from './archFrame.js';
import { FAB_S, buildFableCity, buildFableDomes, buildFableStructure, createFablePlan, fableTubes } from './fablePlan.js';

const S = FAB_S;

// ---------------------------------------------------------------------------
// Powierzchnia habitatu (SURFACE_FRAG dema, x 3).
const FAB_SURFACE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
attribute vec2 aRing;       // s od początku sektora 0, u (= z)
varying vec3 vPos;
varying vec3 vN;
varying vec2 vRing;
void main() {
  vPos = position;
  vN = normal;
  vRing = aRing;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FAB_SURFACE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_TRANSIT}
${ARCH_GLSL_LIT}
${ARCH_GLSL_SABS}
uniform sampler2D uZone;
uniform vec4 uFab;          // obwód (s), W, komórka siatki, S
varying vec3 vPos;
varying vec3 vN;
varying vec2 vRing;

float fabLineAA(float x, float w) { float fw = fwidth(x); return 1.0 - smoothstep(w - fw, w + fw, abs(x)); }
float fabGrid(vec2 p, float cell, float w) {
  vec2 f = fract(p / cell) * cell;
  f = min(f, cell - f);
  return max(fabLineAA(f.x, w), fabLineAA(f.y, w));
}
float fabNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = haloHash12(i);
  float b = haloHash12(i + vec2(1.0, 0.0));
  float c = haloHash12(i + vec2(0.0, 1.0));
  float d = haloHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fabFbm3(vec2 p) { return (fabNoise(p) * 0.5 + fabNoise(p * 2.03) * 0.25 + fabNoise(p * 4.07) * 0.125) / 0.875; }

void main() {
  if (haloInTransitCut(archSAbs(vPos), vPos.z)) discard;
  float Sc = uFab.w;
  vec2 ring = vRing;
  vec2 rd = ring / Sc;                     // wspolrzedne dema (m)
  vec2 jit = (haloHash22(floor(rd / 5.0)) - 0.5) * 9.0 * Sc;
  vec2 zuv = vec2((ring.x + jit.x) / uFab.x, (ring.y + jit.y) / uFab.y + 0.5);
  vec4 zm = texture2D(uZone, zuv);
  float type = floor(zm.r * 255.0 / 16.0);
  float dens = zm.g;
  float extra = zm.b;
  vec3 n = normalize(vN);
  float night = archNight(vPos);
  float dist = length(uCamLocal - vPos);
  float farBoost = 1.0 + 3.0 * smoothstep(2500.0 * Sc, 16000.0 * Sc, dist);
  vec3 albedo = vec3(0.2);
  vec3 emissive = vec3(0.0);
  float cell = uFab.z;
  vec2 cellId = floor(ring / cell);
  float cellHash = haloHash12(cellId);
  float n1 = fabFbm3(rd * 0.01);
  float n2 = fabNoise(rd * 0.15);
  float isUrban = 0.0;
  bool water = false;
  float waterDepth = 0.0;
  if (type < 0.5) {
    water = true;
    waterDepth = smoothstep(0.2, 1.0, extra);
  } else if (type < 1.5) {
    albedo = mix(vec3(0.075, 0.17, 0.045), vec3(0.14, 0.24, 0.07), n1) * (0.85 + 0.3 * n2);
    float path = fabGrid(rd + vec2(n1 * 40.0, 0.0), 180.0, 2.2);
    albedo = mix(albedo, vec3(0.32, 0.29, 0.24), path * 0.8);
  } else if (type < 2.5) {
    float can = fabNoise(rd * 0.35) * 0.5 + fabNoise(rd * 0.9) * 0.5;
    albedo = mix(vec3(0.02, 0.07, 0.02), vec3(0.06, 0.15, 0.045), can) * (0.7 + 0.5 * n1);
  } else if (type < 3.5) {
    vec2 fid = floor((rd + vec2(0.0, 30.0)) / vec2(150.0, 95.0));
    float fh = haloHash12(fid + 7.0);
    vec3 c1 = vec3(0.22, 0.24, 0.07);
    vec3 c2 = vec3(0.10, 0.20, 0.05);
    vec3 c3 = vec3(0.30, 0.21, 0.09);
    vec3 c4 = vec3(0.16, 0.26, 0.09);
    albedo = fh < 0.25 ? c1 : fh < 0.5 ? c2 : fh < 0.75 ? c3 : c4;
    albedo *= 0.85 + 0.15 * sin(rd.y * 2.2 + fh * 10.0);
    float fb = fabGrid(rd + vec2(0.0, 30.0), 150.0, 3.0);
    albedo = mix(albedo, vec3(0.28, 0.25, 0.2), fb * 0.7);
  } else if (type < 4.5) {
    albedo = mix(vec3(0.15, 0.22, 0.06), vec3(0.24, 0.27, 0.10), n1) * (0.85 + 0.3 * n2);
  } else if (type < 5.5) {
    isUrban = 1.0;
    float sh = haloHash12(floor(rd / 14.0) + 3.0);
    albedo = mix(vec3(0.30, 0.27, 0.24), vec3(0.42, 0.36, 0.30), sh) * (0.75 + 0.25 * n2);
    albedo = mix(albedo, vec3(0.12, 0.2, 0.08), smoothstep(0.55, 0.8, fabNoise(rd * 0.08)) * 0.6);
  } else if (type < 6.5) {
    isUrban = 1.0;
    albedo = mix(vec3(0.20, 0.20, 0.21), vec3(0.34, 0.33, 0.32), cellHash) * (0.8 + 0.2 * n2);
  } else if (type < 7.5) {
    isUrban = 1.0;
    albedo = mix(vec3(0.13, 0.14, 0.17), vec3(0.24, 0.25, 0.28), cellHash) * (0.8 + 0.2 * n2);
  } else if (type < 8.5) {
    isUrban = 1.0;
    albedo = mix(vec3(0.17, 0.15, 0.13), vec3(0.28, 0.26, 0.23), cellHash) * (0.8 + 0.2 * n2);
    float stripe = step(0.92, fract(ring.x / cell)) * step(0.5, haloHash12(cellId + 11.0));
    albedo = mix(albedo, vec3(0.6, 0.45, 0.05), stripe * 0.5);
  } else if (type < 9.5) {
    isUrban = 1.0;
    albedo = vec3(0.30, 0.31, 0.32) * (0.85 + 0.2 * n2);
    float padCell = cell * 3.0;
    vec2 padId = floor(ring / padCell);
    vec2 pc = (fract(ring / padCell) - 0.5) * padCell;
    float pr = length(pc) / Sc;
    float padMask = 1.0 - step(0.5, padId.x + 2.0 * padId.y - 3.0 * floor((padId.x + 2.0 * padId.y) / 3.0));
    float padRing = padMask * (fabLineAA(pr - 52.0, 2.5) + fabLineAA(pr - 30.0, 1.5) + fabLineAA(pr - 8.0, 3.0));
    albedo = mix(albedo, vec3(0.65, 0.6, 0.2), clamp(padRing, 0.0, 1.0) * 0.8);
    emissive += vec3(0.9, 0.35, 0.1) * clamp(padRing, 0.0, 1.0) * (0.4 + 0.6 * night) * uLayers.y * padMask;
  } else if (type < 10.5) {
    isUrban = 1.0;
    albedo = mix(vec3(0.12, 0.15, 0.20), vec3(0.22, 0.26, 0.32), cellHash) * (0.85 + 0.2 * n2);
    float glowLine = fabGrid(ring, cell, 1.2 * Sc) * step(0.6, haloHash12(cellId + 21.0));
    emissive += vec3(0.1, 0.6, 0.9) * glowLine * (0.3 + 0.7 * night) * uLayers.y;
  } else if (type < 11.5) {
    albedo = vec3(0.36, 0.36, 0.35) * (0.85 + 0.2 * n2);
    albedo *= 1.0 - fabGrid(rd, 28.0, 0.8) * 0.25;
  } else if (type < 12.5) {
    albedo = vec3(0.48, 0.42, 0.29) * (0.9 + 0.2 * n2);
  } else {
    // plyta doku gry: beton z siatka 120 j.
    albedo = vec3(0.26, 0.27, 0.285) * (0.9 + 0.12 * haloHash12(floor(ring / 120.0)));
    albedo *= 1.0 - fabGrid(ring, 120.0, 1.5) * 0.35;
  }
  // drogi i kwartaly w strefach miejskich
  float road = fabGrid(ring, cell, 5.0 * Sc) * isUrban;
  float roadCenter = fabGrid(ring, cell, 0.35 * Sc) * isUrban;
  albedo = mix(albedo, vec3(0.05, 0.05, 0.055), road);
  albedo = mix(albedo, vec3(0.5, 0.45, 0.25), roadCenter * 0.6);
  // arterie wzdluz ringu (u = +-280) i w poprzek co 1600, tor maglevu na osi
  float hw = fabLineAA(abs(rd.y) - 280.0, 20.0);
  float hwLane = fabLineAA(abs(rd.y) - 280.0, 0.6) + fabLineAA(abs(abs(rd.y) - 280.0) - 10.0, 0.5);
  float crossHw = fabLineAA(fract(rd.x / 1600.0) * 1600.0 - 800.0, 14.0);
  vec3 hwCol = water ? vec3(0.22, 0.22, 0.24) : vec3(0.06, 0.06, 0.065);
  float onPad = step(12.5, type);
  float arter = max(hw, crossHw) * (1.0 - onPad);
  albedo = mix(albedo, hwCol, arter);
  albedo = mix(albedo, vec3(0.55, 0.5, 0.3), clamp(hwLane, 0.0, 1.0) * hw * 0.7 * (1.0 - onPad));
  float rail = fabLineAA(rd.y, 9.0) * (1.0 - onPad);
  float railLine = fabLineAA(abs(rd.y) - 3.5, 0.5);
  albedo = mix(albedo, vec3(0.18, 0.19, 0.21), rail);
  albedo = mix(albedo, vec3(0.45, 0.47, 0.5), railLine * rail);
  // swiatla miast (noc): okna kwartalow, latarnie
  float lightsOn = uLayers.y * (0.06 + 0.94 * night);
  if (isUrban > 0.5) {
    float warm = haloHash12(cellId + 1.0);
    vec3 winCol = mix(vec3(1.0, 0.80, 0.55), vec3(0.70, 0.85, 1.0), step(0.55, warm));
    if (type > 7.5 && type < 8.5) winCol = mix(vec3(1.0, 0.65, 0.3), vec3(0.9, 0.9, 0.8), warm);
    if (type > 9.5 && type < 10.5) winCol = vec3(0.6, 0.85, 1.0);
    float mid = fabFbm3(rd * 0.006 + 7.0);
    float fine = fabNoise(rd * 0.5) * 0.5 + haloHash12(floor(rd / 4.0)) * 0.5;
    float sparkle = step(0.965, haloHash12(floor(rd / 7.0) + 3.0));
    float blockGlow = dens * (0.25 + 0.75 * cellHash) * (0.35 + 0.65 * mid) * (0.4 + 0.6 * fine);
    float intensity = (type > 6.5 && type < 7.5) ? 0.8 : (type > 9.5 && type < 10.5) ? 0.6 : 0.4;
    emissive += winCol * (blockGlow * intensity * farBoost + sparkle * 0.9 * dens * (0.5 + 0.5 * mid)) * lightsOn * (1.0 - road);
    emissive += vec3(1.0, 0.75, 0.4) * road * 0.14 * lightsOn;
  }
  emissive += vec3(1.0, 0.8, 0.5) * (hw + crossHw) * 0.10 * lightsOn * (1.0 - onPad);
  vec3 col;
  if (water) {
    col = archWater(vPos, n, rd, vec3(0.008, 0.035, 0.07), vec3(0.03, 0.15, 0.19), waterDepth);
    col += vec3(0.4, 0.35, 0.3) * 0.02 * night * uLayers.y;
  } else {
    col = archShade(vPos, n, albedo, 0.0);
  }
  gl_FragColor = vec4(col + emissive, 1.0);
}
`;

// Tekstury płyt (makePanelTextures dema): mapa, emisja (okna ścian), bez chropowatości.
function makePanelTextures(kind, seedTag, size = 1024) {
  const rng = new (class {
    constructor(seed) { let a = seed >>> 0; this.f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    next() { return this.f(); }
    range(a, b) { return a + (b - a) * this.f(); }
    int(a, b) { return Math.floor(this.range(a, b + 1)); }
    chance(p) { return this.f() < p; }
  })(seedTag);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const e = document.createElement('canvas');
  e.width = e.height = size;
  const ectx = e.getContext('2d');
  const base = kind === 'hull' ? [78, 82, 88] : kind === 'wall' ? [92, 96, 104] : [70, 72, 78];
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, size, size);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);
  const panels = [];
  (function split(x, y, w, h, depth) {
    const minS = kind === 'hull' ? 70 : 40;
    if ((w < minS * 2 && h < minS * 2) || depth > 6 || (depth > 2 && rng.chance(0.28))) { panels.push([x, y, w, h]); return; }
    if (w > h || (w === h && rng.chance(0.5))) {
      const t = rng.range(0.3, 0.7);
      split(x, y, Math.floor(w * t), h, depth + 1);
      split(x + Math.floor(w * t), y, w - Math.floor(w * t), h, depth + 1);
    } else {
      const t = rng.range(0.3, 0.7);
      split(x, y, w, Math.floor(h * t), depth + 1);
      split(x, y + Math.floor(h * t), w, h - Math.floor(h * t), depth + 1);
    }
  })(0, 0, size, size, 0);
  for (const [x, y, w, h] of panels) {
    const v = rng.range(-14, 14);
    const tint = rng.chance(0.08) ? [rng.range(-6, 4), rng.range(-4, 4), rng.range(2, 12)] : [0, 0, 0];
    ctx.fillStyle = `rgb(${base[0] + v + tint[0]},${base[1] + v + tint[1]},${base[2] + v + tint[2]})`;
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(10,8,6,${rng.range(0.05, 0.3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(12,14,18,0.85)';
    ctx.lineWidth = rng.chance(0.3) ? 3 : 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (w > 60 && h > 60 && rng.chance(0.6)) {
      ctx.fillStyle = 'rgba(20,22,26,0.7)';
      for (let i = 0; i < 4; i++) {
        const px = i % 2 ? x + w - 8 : x + 8;
        const py = i < 2 ? y + 8 : y + h - 8;
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (w > 90 && h > 50 && rng.chance(0.18)) {
      ctx.fillStyle = 'rgba(8,9,12,0.9)';
      const vx = x + rng.range(10, w - 40);
      const vy = y + rng.range(10, h - 24);
      for (let i = 0; i < 4; i++) ctx.fillRect(vx, vy + i * 5, 30, 2);
    }
    if (kind !== 'wall' && w > 120 && h > 30 && rng.chance(0.05)) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x + 6, y + h - 14, w - 12, 8); ctx.clip();
      for (let i = -20; i < w; i += 16) {
        ctx.fillStyle = (i / 16) % 2 ? 'rgba(220,170,20,0.8)' : 'rgba(20,20,20,0.9)';
        ctx.beginPath(); ctx.moveTo(x + i, y + h - 14); ctx.lineTo(x + i + 8, y + h - 14); ctx.lineTo(x + i, y + h - 6); ctx.lineTo(x + i - 8, y + h - 6); ctx.fill();
      }
      ctx.restore();
    }
    if (kind === 'wall') {
      if (rng.chance(0.55) && w > 40) {
        const rows = Math.max(1, Math.floor(h / 22));
        for (let ry = 0; ry < rows; ry++) {
          const yy = y + 8 + ry * 22;
          for (let xx = x + 6; xx < x + w - 8; xx += 9) {
            if (rng.chance(0.55)) {
              const warm = rng.chance(0.6);
              ectx.fillStyle = warm ? `rgba(255,${190 + rng.int(0, 40)},${120 + rng.int(0, 60)},${rng.range(0.5, 1)})` : `rgba(${150 + rng.int(0, 60)},${200 + rng.int(0, 40)},255,${rng.range(0.4, 0.9)})`;
              ectx.fillRect(xx, yy, 5, 8);
            }
          }
        }
      }
    } else {
      if (rng.chance(0.14)) { ectx.fillStyle = rng.chance(0.5) ? 'rgb(255,60,30)' : rng.chance(0.5) ? 'rgb(120,220,255)' : 'rgb(255,220,160)'; ectx.fillRect(x + rng.range(4, w - 8), y + rng.range(4, h - 8), 4, 4); }
      if (w > 80 && h > 80 && rng.chance(0.12)) { ectx.fillStyle = 'rgba(90,180,255,0.9)'; ectx.fillRect(x + 10, y + h / 2 - 1, w - 20, 2); }
    }
  }
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(c), emissiveMap: mk(e) };
}

// Pas wokół ringu (ringStrip dema): od (u0, h0) do (u1, h1), normalna (nU, nH)
// w (z, promień); u = z, h wysokość nad podłogą (na zewnątrz).
function ringStrip(plan, u0, h0, u1, h1, nU, nH, segments, { across = 1, repU = 1, repV = 1, extraRing = false } = {}) {
  const R = plan.R;
  const cols = segments + 1;
  const rows = across + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const ringA = extraRing ? new Float32Array(cols * rows * 2) : null;
  const nl = Math.hypot(nU, nH) || 1;
  nU /= nl; nH /= nl;
  const th0 = plan.layout.sectorStart;
  for (let i = 0; i < cols; i++) {
    const th = th0 + (i / segments) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let j = 0; j < rows; j++) {
      const t = j / across;
      const u = u0 + (u1 - u0) * t;
      const h = h0 + (h1 - h0) * t;
      const r = R + h;
      const idx = i * rows + j;
      pos[idx * 3] = r * c; pos[idx * 3 + 1] = r * s; pos[idx * 3 + 2] = u;
      nor[idx * 3] = c * nH; nor[idx * 3 + 1] = s * nH; nor[idx * 3 + 2] = nU;
      uv[idx * 2] = (i / segments) * repU; uv[idx * 2 + 1] = t * repV;
      if (ringA) { ringA[idx * 2] = (i / segments) * plan.CIRC; ringA[idx * 2 + 1] = u; }
    }
  }
  const idx = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * rows + j;
      const b = a + 1;
      const c = a + rows;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (ringA) geo.setAttribute('aRing', new THREE.BufferAttribute(ringA, 2));
  geo.setIndex(idx);
  // nawinięcie zgodne z normalną
  const pa = new THREE.Vector3().fromArray(pos, 0);
  const pb = new THREE.Vector3().fromArray(pos, rows * 3);
  const pc = new THREE.Vector3().fromArray(pos, 3);
  const fn = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
  if (fn.dot(new THREE.Vector3().fromArray(nor, 0)) < 0) {
    const ia = geo.getIndex().array;
    for (let i = 0; i < ia.length; i += 3) { const tt = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = tt; }
  }
  geo.computeBoundingSphere();
  return geo;
}


export function buildFableRing({ layout, uniforms, materials, geos, quality, seed, portLights = [], portSolid = null }) {
  const plan = createFablePlan(layout, seed);
  const bg = [];
  const fg = [];
  const disposables = [];
  const zTop = layout.z.topIn;
  const lightsBG = new ArchLights();
  const lightsFG = new ArchLights();
  const lights = { add: (x, y, z, c, s, p) => (z > zTop - 1 ? lightsFG : lightsBG).add(x, y, z, c, s, p) };
  for (const l of portLights) lightsBG.add(l.x, l.y, l.z, l.color, l.size, l.phase);
  const HW = plan.HW;
  const T = 460 * S;
  const WH = 260 * S;
  const WT = 90 * S;

  // ---- mapa stref + powierzchnia ----
  const ZW = 8192;
  const ZH = 256;
  const zoneData = plan.bakeZoneMap(ZW, ZH);
  const zoneTex = new THREE.DataTexture(zoneData, ZW, ZH, THREE.RGBAFormat);
  zoneTex.magFilter = THREE.NearestFilter;
  zoneTex.minFilter = THREE.NearestFilter;
  zoneTex.wrapS = THREE.RepeatWrapping;
  zoneTex.wrapT = THREE.ClampToEdgeWrapping;
  zoneTex.generateMipmaps = false;
  zoneTex.needsUpdate = true;
  disposables.push(zoneTex);
  const surfMat = new THREE.ShaderMaterial({
    name: 'FableSurface',
    uniforms: { ...uniforms, uZone: { value: zoneTex }, uFab: { value: new THREE.Vector4(plan.CIRC, plan.W, plan.CIRC / Math.round(plan.CIRC / (56 * S)), S) } },
    vertexShader: FAB_SURFACE_VERTEX,
    fragmentShader: FAB_SURFACE_FRAGMENT
  });
  disposables.push(surfMat);
  const segSurf = Math.round(plan.CIRC / 110);
  const floorGeo = ringStrip(plan, -HW, 0, HW, 0, 0, 1, segSurf, { across: 6, extraRing: true });
  const floor = new THREE.Mesh(floorGeo, surfMat);
  floor.name = 'FableSurface';
  floor.frustumCulled = false;
  bg.push(floor);

  // ---- kadłub i ściany (tekstury płyt dema) ----
  const hullTex = makePanelTextures('hull', (seed ^ 0x51) >>> 0);
  const wallTex = makePanelTextures('wall', (seed ^ 0x77) >>> 0);
  // atlas: kadłub (lewa połowa) | zamieszkane ściany (prawa) — jedno wywołanie
  // rysowania na stronę zamiast czterech
  const atlasOf = (a, b) => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    const x = c.getContext('2d');
    x.drawImage(a.image, 0, 0, 1024, 1024);
    x.drawImage(b.image, 1024, 0, 1024, 1024);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const atlasMap = atlasOf(hullTex.map, wallTex.map);
  const atlasEmit = atlasOf(hullTex.emissiveMap, wallTex.emissiveMap);
  for (const t of [hullTex.map, hullTex.emissiveMap, wallTex.map, wallTex.emissiveMap]) t.dispose();
  disposables.push(atlasMap, atlasEmit);
  const tagAtlas = (g, v) => {
    g.setAttribute('aAtlas', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(v), 1));
    return g;
  };
  const SEG = Math.round(768 * layout.circumference / (S * 2 * Math.PI * 8000));
  const circPanels = plan.CIRC / (420 * S);
  const wallRep = plan.CIRC / (300 * S);
  const hullBG = [];
  const hullFG = [];
  const wallBG = [];
  const wallFG = [];
  hullBG.push(tagAtlas(ringStrip(plan, -HW - WT, -T, HW + WT, -T, 0, -1, SEG, { across: 4, repU: circPanels, repV: (plan.W + 2 * WT) / (420 * S) }), 0));
  hullFG.push(tagAtlas(ringStrip(plan, HW + WT, -T, HW + WT, WH, 1, 0, SEG, { across: 2, repU: circPanels, repV: (T + WH) / (420 * S) }), 0));
  hullBG.push(tagAtlas(ringStrip(plan, -HW - WT, -T, -HW - WT, WH, -1, 0, SEG, { across: 2, repU: circPanels, repV: (T + WH) / (420 * S) }), 0));
  hullFG.push(tagAtlas(ringStrip(plan, HW, WH, HW + WT, WH, 0, 1, SEG, { repU: circPanels, repV: 0.25 }), 0));
  hullBG.push(tagAtlas(ringStrip(plan, -HW - WT, WH, -HW, WH, 0, 1, SEG, { repU: circPanels, repV: 0.25 }), 0));
  wallFG.push(tagAtlas(ringStrip(plan, HW, 0, HW, WH, -1, 0, SEG, { across: 2, repU: wallRep, repV: WH / (300 * S) }), 1));
  wallBG.push(tagAtlas(ringStrip(plan, -HW, 0, -HW, WH, 1, 0, SEG, { across: 2, repU: wallRep, repV: WH / (300 * S) }), 1));
  hullBG.push(tagAtlas(ringStrip(plan, -HW - WT + 40 * S, -T + 140 * S, HW + WT - 40 * S, -T + 140 * S, 0, -1, SEG, { across: 2, repU: circPanels * 1.5, repV: 3 }), 0));
  const stripMesh = (geos_, mat, name) => {
    const g = mergeGeometries(geos_, false);
    for (const x of geos_) x.dispose();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  };
  const tint = [0.77, 0.79, 0.81];
  bg.push(stripMesh([...hullBG, ...wallBG], materials.strip({ map: atlasMap, emap: atlasEmit, tint, emitGain: 1.4, varScale: 2000, atlas: true }), 'FableHull'));
  fg.push(stripMesh([...hullFG, ...wallFG], materials.strip({ map: atlasMap, emap: atlasEmit, tint, emitGain: 1.4, varScale: 2000, atlas: true, fg: true }), 'FableHullFG'));

  // ---- konstrukcja ----
  const st = buildFableStructure(plan, lights);
  const matBG = materials.instanced(false);
  const matFG = materials.instanced(true);
  // rury i belki wzdłuż ringu (tori dema) jako odcinki w tej samej partii,
  // bryły portu (zatoki, tranzyty) dopisane do BG — jedno wywołanie na stronę
  for (const t of fableTubes()) {
    const z = t.u * S;
    const color = t.color == null ? [0.35 * 1.2, 0.8 * 1.2, 1.0 * 1.2] : archHex(t.color).map((v) => v * (t.square ? 0.28 : 0.8));
    archRingTubeBoxes(z > zTop - 1 ? st.fg.all : st.bg.all, plan.R, t.h * S, z, t.r * S, 512, color, t.color == null ? 2 : 0, t.color == null ? 1 : 0.35);
  }
  if (portSolid) st.bg.all.append(portSolid);
  for (const [set, mat, list] of [[st.bg, matBG, bg], [st.fg, matFG, fg]]) {
    const mesh = archBatchMesh(set.all, geos.box, mat);
    if (mesh) list.push(mesh);
  }


  // ---- miasto i drzewa per sektor ----
  const city = buildFableCity(plan);
  const domes = buildFableDomes(plan, city.per, lights);
  const treeGeo = archTreeGeometry('cone');
  disposables.push(treeGeo);
  const treeMat = materials.instanced(false, true);
  const sectors = city.per.map((B, p) => {
    const d = {
      p,
      box: archBatchMesh(B.box, geos.box, matBG),
      cyl: archBatchMesh(B.cyl, geos.cyl8, matBG),
      tree: archBatchMesh(B.tree, treeGeo, treeMat),
      sphere: archBatchMesh(B.sphere, geos.sphere, matBG)
    };
    for (const k of ['box', 'cyl', 'tree', 'sphere']) if (d[k]) bg.push(d[k]);
    const th = plan.theta0(p) + plan.span * 0.5;
    d.center = new THREE.Vector3(plan.R * Math.cos(th), plan.R * Math.sin(th), 0);
    return d;
  });

  // ---- kopuły: szkło (instancje półkul), kratownice (linie), żebra (tory) ----
  const hemi = archHemisphere();
  disposables.push(hemi);
  const tints = { FOREST: [0.55, 0.78, 0.95], TROPICAL: [0.55, 0.85, 0.85], BOTANICAL: [0.7, 0.8, 0.95], RECREATION: [0.65, 0.8, 1.0], WILDERNESS: [0.5, 0.75, 0.9], AQUATIC: [0.45, 0.8, 1.0] };
  const glass = new THREE.InstancedMesh(hemi, materials.glass({ alpha: 0.15 }), Math.max(1, domes.length));
  glass.count = domes.length;
  glass.renderOrder = 30;
  glass.name = 'FableDomeGlass';
  const unitTorus = new THREE.TorusGeometry(1, 0.011, 6, 96);
  unitTorus.deleteAttribute('uv');
  disposables.push(unitTorus);
  const ribMats = [];
  const wireGeo3 = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.004, 3));
  const wireGeo4 = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.004, 4));
  disposables.push(wireGeo3, wireGeo4);
  const linePos = [];
  const frame = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  domes.forEach((d, i) => {
    // rama kopuły: środek kuli na h = −r · zagłębienie, góra = od planety
    const c = Math.cos(d.theta);
    const sn = Math.sin(d.theta);
    const rr = plan.R - d.r * d.sunk;
    frame.set(
      -sn, c, 0, rr * c,
      c, sn, 0, rr * sn,
      0, 0, -1, d.u,
      0, 0, 0, 1
    );
    tmp.copy(frame).scale(v.set(d.r, d.r, d.r));
    glass.setMatrixAt(i, tmp);
    const tc = tints[d.type] || tints.FOREST;
    glass.setColorAt(i, new THREE.Color(tc[0], tc[1], tc[2]));
    const wire = d.r > 350 * S ? wireGeo4 : wireGeo3;
    const wp = wire.getAttribute('position');
    for (let q = 0; q < wp.count; q++) {
      v.fromBufferAttribute(wp, q).applyMatrix4(tmp);
      linePos.push(v.x, v.y, v.z);
    }
    const nMer = d.r > 350 * S ? 8 : 6;
    for (let k = 0; k < nMer; k++) {
      rot.makeRotationY((k / nMer) * Math.PI);
      ribMats.push(frame.clone().multiply(rot).scale(v.set(d.r * 1.006, d.r * 1.006, d.r * 1.006)));
    }
    for (const phi of [0.25, 0.5, 0.72]) {
      const rp = d.r * Math.cos(phi * Math.PI * 0.5) * 1.006;
      const hy = d.r * Math.sin(phi * Math.PI * 0.5);
      rot.makeRotationX(Math.PI * 0.5).setPosition(0, hy, 0);
      ribMats.push(frame.clone().multiply(rot).scale(v.set(rp, rp, rp)));
    }
    rot.makeRotationX(Math.PI * 0.5).setPosition(0, d.r * d.sunk + 4.5, 0);
    ribMats.push(frame.clone().multiply(rot).scale(v.set(d.baseR, d.baseR, d.baseR * 1.8)));
  });
  glass.instanceMatrix.needsUpdate = true;
  if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
  glass.computeBoundingSphere();
  if (domes.length) bg.push(glass);
  if (linePos.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lg.computeBoundingSphere();
    const lines = new THREE.LineSegments(lg, materials.lines({ color: archHex(0x9fb4c8), alpha: 0.45 }));
    lines.name = 'FableDomeLattice';
    bg.push(lines);
  }
  if (ribMats.length) {
    const ribs = new THREE.InstancedMesh(unitTorus.clone(), matBG, ribMats.length);
    const a = new Float32Array(ribMats.length * 4);
    const rc = archHex(0xc9ced6);
    ribMats.forEach((mm, i) => {
      ribs.setMatrixAt(i, mm);
      ribs.setColorAt(i, new THREE.Color(rc[0], rc[1], rc[2]));
      a.set([0, 0.2, 0.6, 0], i * 4);
    });
    ribs.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(a, 4));
    ribs.instanceMatrix.needsUpdate = true;
    ribs.computeBoundingSphere();
    ribs.name = 'FableDomeRibs';
    bg.push(ribs);
  }

  // ---- światła pozycyjne ----
  const pBG = archPointsMesh(lightsBG, materials.points(false));
  const pFG = archPointsMesh(lightsFG, materials.points(true));
  if (pBG) bg.push(pBG);
  if (pFG) fg.push(pFG);

  const domeMeshes = bg.filter((o) => /^FableDome/.test(o.name));
  const domeCenters = domes.map((d) => {
    const r = plan.R - d.r * d.sunk;
    return { p: new THREE.Vector3(r * Math.cos(d.theta), r * Math.sin(d.theta), d.u), r: d.r };
  });
  const lod = quality?.lod || {};
  const treeAlt = (lod.treeAltitude || 2500) * 6;
  return {
    bg,
    fg,
    domes,
    landmarks: [],
    stats: { instances: city.stats.buildings + city.stats.trees, buildings: city.stats.buildings, trees: city.stats.trees, lights: (lightsBG.pos.length + lightsFG.pos.length) / 3, textureBytes: ZW * ZH * 4 },
    heightAt: (theta, z) => plan.heightAt(theta, z),
    plan,
    update(camLocal, frustum, pixelAngle) {
      // kopuły tylko w zasięgu kadru (jak LOD kamery gry ringu Ziemi)
      const reach = Math.max(4000, Math.abs(camLocal.z) * 1.1) + 2500;
      let near = false;
      for (const d of domeCenters) if (d.p.distanceTo(camLocal) - d.r < reach) { near = true; break; }
      for (const o of domeMeshes) o.visible = near;
      for (const d of sectors) {
        const dist = Math.max(1, d.center.distanceTo(camLocal) - plan.LEN * 0.5);
        const px = pixelAngle > 0 ? 1 / (dist * pixelAngle) : 1;
        const treesOn = 40 * px > 1.2 && dist < treeAlt * 12;
        if (d.tree) d.tree.visible = treesOn;
        if (d.cyl) d.cyl.visible = 30 * px > 1.0;
        if (d.sphere) d.sphere.visible = 200 * px > 1.0;
        if (d.box) d.box.visible = 250 * px > 1.0;
      }
    },
    dispose() {
      for (const x of disposables) x.dispose?.();
    }
  };
}
