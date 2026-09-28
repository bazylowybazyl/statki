// ECUMENE (Mars) — siatki Three z planu (ecumenePlan.js). Dema:
// dema/orbital_ring_demo.html (ląd, konstrukcja, kopuły, tablice), skala ×3,
// habitat na zewnątrz. Powierzchnia dzielnic liczy typ terenu, wodę,
// kwartały, arterie i ścieżki tymi samymi wzorami co tekstury dema, ale na
// piksel (ostro przy każdym zoomie gry). Wszystko w układzie lokalnym ringu.
//
// Port WebGPU (zadanie 10): powierzchnia dzielnic w TSL (dawne ECU_SURFACE_VERTEX /
// _FRAGMENT 1:1; pola wody i typu terenu jako czyste funkcje WGSL z uEcu w parametrze),
// szkło kopuł, żebra i dno kopuł — partie instancji archetypów (archBatchMesh), bez
// THREE.InstancedMesh (PLAN §3).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, If, Loop, Discard,
  float, vec2, vec3, vec4,
  attribute, varyingProperty, uniform, uniformArray, positionGeometry, normalGeometry,
  modelViewMatrix, cameraProjectionMatrix,
  abs, clamp, cos, floor, fract, length, max, min, mix, normalize, pow, sign, sin, smoothstep, step
} from 'three/tsl';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { haloHash12, haloPureFn } from '../haloRingTSL.js';
import { uniformsAdapter } from '../haloUniformsAdapter.js';
import { archLitTSL, archNodeMaterial } from './archTSL.js';
import { ArchBatch, archHex, archRingTubeBoxes } from './archFrame.js';
import { ArchLights, archBatchMesh, archHemisphere, archPointsMesh, archTreeGeometry } from './archMaterials.js';
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
// Powierzchnia dzielnic (tekstury createSectorTextures dema, na piksel). Funkcje pól czyste
// (setLayout): uEcu (LEN dzielnicy, S, W, —) w parametrze, bez uniformów w domknięciu (PLAN §3).
const sel = (k, i) => abs(k.sub(i)).lessThan(0.5);
const ecuEllipse = haloPureFn('ecuEllipse', 'float', [['q', 'vec2'], ['c', 'vec2'], ['r', 'vec2']], (a) =>
  length(a.q.sub(a.c).div(a.r)).sub(1.0).mul(min(a.r.x, a.r.y)));
const ecuMod = haloPureFn('ecuMod', 'float', [['a', 'float'], ['n', 'float']], (a) =>
  a.a.sub(a.n.mul(floor(a.a.div(a.n)))));

const ecuWater = haloPureFn('ecuWater', 'float', [['q', 'vec2'], ['k', 'float'], ['ecu', 'vec4']], (a) => {
  const L = a.ecu.x;
  const Sc = a.ecu.y;
  const s = a.q.x;
  const z = a.q.y;
  const k = a.k;
  const d = float(1e5).toVar();
  If(sel(k, 1.0), () => {
    d.assign(ecuEllipse(a.q, vec2(L.mul(0.54), Sc.mul(30.0)), vec2(720.0, 265.0).mul(Sc)).add(sin(s.mul(0.007).div(Sc)).mul(12.0).mul(Sc)));
  });
  If(sel(k, 2.0), () => {
    d.assign(ecuEllipse(a.q, vec2(L.mul(0.52), Sc.mul(-30.0)), vec2(1570.0, 655.0).mul(Sc))
      .add(sin(s.mul(0.009).div(Sc).add(z.mul(0.007).div(Sc))).mul(23.0).mul(Sc)));
    d.assign(max(d, ecuEllipse(a.q, vec2(L.mul(0.58), Sc.mul(100.0)), vec2(230.0, 155.0).mul(Sc)).negate()));
  });
  If(sel(k, 3.0), () => { d.assign(abs(z.sub(float(130.0).mul(Sc).mul(sin(s.mul(0.0028).div(Sc))))).sub(Sc.mul(32.0))); });
  If(sel(k, 5.0), () => { d.assign(abs(z.sub(float(130.0).mul(Sc).mul(sin(s.mul(0.0021).div(Sc))))).sub(Sc.mul(68.0))); });
  If(sel(k, 6.0), () => { d.assign(abs(z.add(Sc.mul(490.0))).sub(Sc.mul(46.0))); });
  If(sel(k, 8.0), () => { d.assign(abs(z.sub(float(200.0).mul(Sc).mul(sin(s.mul(0.0009).div(Sc))))).sub(Sc.mul(45.0))); });
  If(sel(k, 9.0), () => {
    d.assign(ecuEllipse(a.q, vec2(L.mul(0.51), 0.0), vec2(L.mul(0.47), Sc.mul(745.0)))
      .add(sin(s.mul(0.006).div(Sc).add(z.mul(0.009).div(Sc))).mul(17.0).mul(Sc)));
    d.assign(max(d, ecuEllipse(a.q, vec2(L.mul(0.57), Sc.mul(10.0)), vec2(340.0, 210.0).mul(Sc)).negate()));
    d.assign(max(d, ecuEllipse(a.q, vec2(L.mul(0.31), Sc.mul(-220.0)), vec2(150.0, 95.0).mul(Sc)).negate()));
  });
  If(sel(k, 11.0), () => {
    d.assign(min(ecuEllipse(a.q, vec2(L.mul(0.59), 0.0), vec2(620.0, 250.0).mul(Sc)),
      abs(z.sub(float(210.0).mul(Sc).mul(sin(s.mul(0.0018).div(Sc))))).sub(Sc.mul(40.0))));
  });
  return d;
});

const ecuType = haloPureFn('ecuType', 'float', [['q', 'vec2'], ['k', 'float'], ['water', 'float'], ['ecu', 'vec4']], (a) => {
  const L = a.ecu.x;
  const Sc = a.ecu.y;
  const HW = a.ecu.z.mul(0.5);
  const s = a.q.x;
  const z = a.q.y;
  const k = a.k;
  const t = float(0.0).toVar();
  If(a.water.lessThan(0.0), () => {
    t.assign(3.0);
  }).ElseIf(abs(z).greaterThan(HW.sub(Sc.mul(38.0))), () => {
    t.assign(7.0);
  }).ElseIf(abs(abs(z).sub(Sc.mul(850.0))).lessThan(Sc.mul(19.0)), () => {
    t.assign(6.0);
  }).ElseIf(a.water.lessThan(Sc.mul(28.0)).and(sel(k, 1.0).or(sel(k, 2.0)).or(sel(k, 9.0)).or(sel(k, 11.0))), () => {
    t.assign(8.0);
  }).Else(() => {
    If(sel(k, 1.0), () => {
      t.assign(ecuEllipse(a.q, vec2(L.mul(0.51), 0.0), vec2(1600.0, 670.0).mul(Sc)).lessThan(0.0).select(float(1.0), float(0.0)));
    });
    If(sel(k, 2.0), () => {
      t.assign(ecuEllipse(a.q, vec2(L.mul(0.1), Sc.mul(610.0)), vec2(400.0, 140.0).mul(Sc)).lessThan(0.0)
        .or(ecuEllipse(a.q, vec2(L.mul(0.9), Sc.mul(-610.0)), vec2(340.0, 160.0).mul(Sc)).lessThan(0.0)).select(float(0.0), float(2.0)));
    });
    If(sel(k, 3.0), () => {
      t.assign(abs(z.sub(float(130.0).mul(Sc).mul(sin(s.mul(0.0028).div(Sc))))).lessThan(Sc.mul(115.0)).select(float(1.0), float(0.0)));
    });
    If(sel(k, 4.0), () => { t.assign(1.0); });
    If(sel(k, 5.0), () => { t.assign(4.0); });
    If(sel(k, 6.0).or(sel(k, 7.0)).or(sel(k, 10.0)), () => { t.assign(5.0); });
    If(sel(k, 8.0), () => {
      t.assign(abs(z.sub(float(200.0).mul(Sc).mul(sin(s.mul(0.0009).div(Sc))))).lessThan(Sc.mul(110.0)).select(float(1.0), float(0.0)));
    });
    If(sel(k, 9.0), () => { t.assign(2.0); });
    If(sel(k, 11.0), () => {
      t.assign(sin(s.mul(0.0028).div(Sc)).add(cos(z.mul(0.009).div(Sc))).greaterThan(0.65).select(float(0.0), float(2.0)));
    });
    If(k.lessThan(0.5).and(ecuEllipse(a.q, vec2(L.mul(0.48), Sc.mul(-30.0)), vec2(330.0, 230.0).mul(Sc)).lessThan(0.0)), () => { t.assign(7.0); });
    If(t.lessThan(0.5).or(sel(t, 5.0)), () => {
      If(ecuMod(s, Sc.mul(76.0)).lessThan(Sc.mul(12.0)).or(ecuMod(z.add(Sc.mul(850.0)), Sc.mul(88.0)).lessThan(Sc.mul(12.0))), () => { t.assign(6.0); });
    });
  });
  return t;
});

// sRGB 0–255 → liniowo (pow 2,2 jak w demie)
const ecuLin = (srgb255) => pow(clamp(srgb255.div(255.0), 0.0, 1.0), vec3(2.2));
// iloczyn stałych zwinięty jak w kompilatorze GLSL bazy (float32)
const f32mul = (a, b) => Math.fround(Math.fround(a) * Math.fround(b));
const F32_8x414 = f32mul(8.0, 4.14);
const F32_3x414 = f32mul(3.0, 4.14);

// Materiał powierzchni dzielnic (dawne ECU_SURFACE_*): ecu — uniform vec4 (LEN, S, W, —),
// pal — uniformArray 10 × vec3 (barwy typów, sRGB 0–255).
export function makeEcumeneSurfaceNodes({ u, ecu, pal }) {
  const { H, U, archNight, archShade, archWater, archSAbs } = archLitTSL(u);
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vNV = varyingProperty('vec3', 'vArchN');
  const vEcuV = varyingProperty('vec2', 'vEcu');
  const vertexNode = Fn(() => {
    const position = positionGeometry;
    vPosV.assign(position);
    vNV.assign(normalGeometry);
    vEcuV.assign(attribute('aEcu', 'vec2'));   // s w dzielnicy, id dzielnicy (dema)
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const ecuPal = (t) => {
    const c = vec3(pal.element(0)).toVar();
    Loop({ start: 1, end: 10, type: 'int', condition: '<', name: 'ecuPalI' }, ({ ecuPalI }) => {
      If(abs(t.sub(float(ecuPalI))).lessThan(0.5), () => { c.assign(pal.element(ecuPalI)); });
    });
    return c;
  };
  const fragmentNode = Fn(() => {
    const vPos = vec3(vPosV).toVar();
    const sAbs = archSAbs(vPos).toVar();
    const z = vPos.z.toVar();
    If(H.haloInTransitCut(sAbs, z), () => { Discard(); });
    const Sc = ecu.y;
    const L = ecu.x;
    const k = floor(vEcuV.y.add(0.5)).toVar();
    const q = vec2(vEcuV.x, z).toVar();
    const water = ecuWater(q, k, ecu).toVar();
    const t = ecuType(q, k, water, ecu).toVar();
    // płyty portu (miejsca kompleksów i tranzytów: płasko, beton)
    const tFloor = z.sub(U.uRingZ.z).toVar();
    const pad = H.haloPortPad(sAbs, tFloor, L, 0.0, 60.0).toVar();
    const n = normalize(vNV).toVar();
    const emit = vec3(0.0).toVar();
    // szum teksela dema (4 m × S) i wzory typów
    const texel = floor(q.div(Sc.mul(4.14))).toVar();
    const nz = haloHash12(texel.add(k.mul(131.0))).sub(0.5).mul(14.0).add(sin(q.x.mul(0.019).div(Sc).add(z.mul(0.011).div(Sc))).mul(3.0)).toVar();
    If(sel(t, 4.0), () => {
      nz.addAssign(sin(floor(q.x.div(Sc.mul(180.0))).mul(16.0).add(floor(z.add(ecu.z.mul(0.5)).div(Sc.mul(220.0))).mul(8.0))).mul(19.0)
        .add(ecuMod(z, Sc.mul(12.0)).lessThan(Sc.mul(4.0)).select(float(-9.0), float(4.0))));
    });
    If(sel(t, 2.0).or(sel(t, 1.0)), () => {
      nz.addAssign(sin(q.x.mul(0.018).div(Sc)).mul(cos(z.mul(0.022).div(Sc))).mul(7.0));
    });
    const base255 = ecuPal(t).toVar();
    // kwartały: ślady budynków w siatce katastralnej (76 × 88 dema)
    If(t.lessThan(0.5).or(sel(t, 5.0)).or(sel(t, 6.0)), () => {
      const ci = floor(q.x.div(Sc.mul(76.0))).toVar();
      const sc0 = Sc.mul(38.0).add(ci.mul(76.0).mul(Sc)).toVar();
      const cj = floor(z.add(Sc.mul(806.0)).add(Sc.mul(44.0)).div(Sc.mul(88.0))).toVar();
      const zc0 = Sc.mul(-806.0).add(cj.mul(88.0).mul(Sc)).toVar();
      const cc = vec2(sc0, zc0).toVar();
      const tc = ecuType(cc, k, ecuWater(cc, k, ecu), ecu).toVar();
      const house = tc.lessThan(0.5).or(sel(tc, 5.0)).toVar();
      If(house.and(abs(q.x.sub(sc0)).lessThan(Sc.mul(26.0))).and(abs(z.sub(zc0)).lessThan(Sc.mul(30.0)))
        .and(cj.greaterThanEqual(0.0)).and(zc0.lessThan(Sc.mul(820.0))), () => {
        const v = float(67.0).add(haloHash12(vec2(ci, cj).add(k.mul(17.0))).mul(38.0)).toVar();
        base255.assign(vec3(v, v.add(7.0), v.add(9.0)));
        nz.mulAssign(0.3);
      });
      const r2 = haloHash12(vec2(ci, cj).add(k.mul(29.0)).add(3.0)).toVar();
      If(house.and(r2.greaterThan(0.57)).and(abs(q.x.sub(sc0)).lessThan(Sc.mul(30.0))).and(abs(z.sub(zc0.sub(Sc.mul(37.0)))).lessThan(Sc.mul(1.3))), () => {
        emit.addAssign(r2.greaterThan(0.7).select(vec3(0.15, 0.27, 0.29), vec3(0.32, 0.22, 0.12)));
      });
    });
    const col = ecuLin(base255.add(nz)).toVar();
    // arterie z = ±850: asfalt, przerywana oś, oświetlenie od frontu
    const azd = abs(abs(z).sub(Sc.mul(850.0))).toVar();
    If(azd.lessThan(Sc.mul(18.0)).and(water.greaterThanEqual(0.0)), () => {
      col.assign(ecuLin(vec3(34.0, 44.0, 50.0).add(nz.mul(0.3))));
      // 8 · 4,14 i 3 · 4,14 zwinięte jak stałe GLSL w bazie (mnożenie w float32)
      const dash = step(ecuMod(q.x, float(F32_8x414).mul(Sc)), float(F32_3x414).mul(Sc));
      If(azd.lessThan(Sc.mul(0.9)), () => { col.assign(mix(col, ecuLin(vec3(168.0, 170.0, 153.0)), dash)); });
    });
    If(abs(abs(z.add(Sc.mul(15.0).mul(sign(z)))).sub(Sc.mul(850.0))).lessThan(Sc.mul(1.1)), () => { emit.addAssign(vec3(0.30, 0.19, 0.07)); });
    // ścieżki spacerowe w parkach i lasach (bez brodzenia)
    If(sel(k, 1.0).or(sel(k, 2.0)).or(sel(k, 4.0)).or(sel(k, 9.0)).or(sel(k, 11.0)).and(water.greaterThan(Sc.mul(25.0))), () => {
      Loop({ start: 0, end: 3, type: 'int', condition: '<', name: 'ecuLane' }, ({ ecuLane }) => {
        const fl = float(ecuLane);
        const zt = Sc.mul(-620.0).add(fl.mul(580.0).mul(Sc)).add(sin(q.x.mul(0.0026).div(Sc).add(fl)).mul(95.0).mul(Sc));
        If(abs(z.sub(zt)).lessThan(Sc.mul(2.5)), () => { col.assign(ecuLin(vec3(146.0, 149.0, 122.0))); });
      });
    });
    If(pad.greaterThan(0.5), () => {
      const sz = vec2(sAbs, z).toVar();
      const g = abs(fract(sz.div(120.0)).sub(0.5));
      const line = float(1.0).sub(smoothstep(0.46, 0.49, max(g.x, g.y)));
      col.assign(ecuLin(vec3(pal.element(9)).mul(float(0.92).add(float(0.1).mul(haloHash12(floor(sz.div(120.0)))))).sub(line.mul(18.0))));
    });
    const night = archNight(vPos).toVar();
    If(water.lessThan(0.0).and(pad.lessThan(0.5)), () => {
      col.assign(archWater(vPos, n, q, vec3(0.018, 0.092, 0.093).mul(0.6), vec3(0.06, 0.15, 0.17), clamp(water.negate().div(Sc.mul(60.0)), 0.0, 1.0)));
    }).Else(() => {
      col.assign(archShade(vPos, n, col, 0.0));
    });
    col.addAssign(emit.mul(0.9).mul(float(0.3).add(float(0.7).mul(night))).mul(U.uLayers.y));
    return vec4(col, 1.0);
  })();
  return { vertexNode, fragmentNode };
}

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

// Czarna mapa emisji (powłoka bez okien). Filtr liniowy: TSL wybiera ścieżkę próbkowania z tekstury
// przy budowie (NEAREST = textureLoad) — 1 × 1, więc obraz ten sam co przy NEAREST w bazie.
function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
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
  // uEcu: LEN dzielnicy, S, W, —; uEcuPal: barwy typów (sRGB 0–255), tablica ze stałą nazwą bufora
  // (ten sam WGSL przy przebudowie ringu)
  const uEcu = uniform(new THREE.Vector4(plan.LEN, S, plan.W, 0));
  const uEcuPal = uniformArray(ECU_TYPE_PALETTE.map((c) => new THREE.Vector3(...c)), 'vec3').setName('ecuPal');
  const surfaceMat = archNodeMaterial('EcumeneSurface', makeEcumeneSurfaceNodes({ u: uniforms, ecu: uEcu, pal: uEcuPal }), {},
    { ...uniforms, ...uniformsAdapter({ uEcu, uEcuPal }) });
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
  // szkło: partia instancji półkul (barwa instancji = odcień szkła)
  const glassBatch = new ArchBatch('EcumeneDomeGlass');
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
    glassBatch.push16(domeM.elements, glassTint, 0, 0, 0, 0);
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
  const glassMesh = archBatchMesh(glassBatch, hemi, materials.glass({ alpha: 0.1 }));
  if (glassMesh) {
    glassMesh.renderOrder = 30;
    bg.push(glassMesh);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.computeBoundingSphere();
  const lattice = new THREE.LineSegments(lineGeo, materials.lines({ color: archHex(0xa6b9b9), alpha: 0.63 }));
  lattice.name = 'EcumeneDomeLattice';
  if (domes.length) bg.push(lattice);
  const domeInst = (list, geo, color, kind, p1, name, mat = matBG) => {
    if (!list.length) return;
    const batch = new ArchBatch(name);
    for (const mm of list) batch.push16(mm.elements, color, kind, 0.3, p1, 0);
    const mesh = archBatchMesh(batch, geo, mat);
    if (mesh) bg.push(mesh);
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
