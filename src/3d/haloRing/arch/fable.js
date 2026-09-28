// Ring Fable (Jowisz) — siatki Three z planu (fablePlan.js). Demo:
// dema/orbital_ring_demo_2.html (ląd ze strefami, zamieszkane ściany,
// kadłub z płyt, żebra i kratownice, radiatory, hangary, anteny, kopuły),
// skala ×3, habitat na zewnątrz. Mapa stref pieczona na CPU (tekstura jak
// w demie), szczegół (drogi, arterie, pola, lądowiska, światła miast) na
// piksel. Bez udawanego ruchu (smugi aut i impulsy maglevu dema wypadają —
// ring nie udaje życia, docs/BRIEF-ring-halo.md §1).
//
// Port WebGPU (zadanie 10): powierzchnia habitatu w TSL (dawne FAB_SURFACE_VERTEX /
// _FRAGMENT 1:1). Pochodne linii (fwidth w fabLineAA) liczone przed gałęziami stref — baza
// WebGL (FXC) spłaszczała gałęzie, w WGSL pochodna w rozbieżnej gałęzi (granica stref) jest
// nieokreślona. Mapa stref RGBA8 z NEAREST: odczyt textureLoad z zawinięciem (TSL). Szkło
// i żebra kopuł — partie instancji archetypów (archBatchMesh), bez THREE.InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, If, Discard,
  float, vec2, vec3, vec4,
  attribute, varyingProperty, uniform, texture, positionGeometry, normalGeometry,
  modelViewMatrix, cameraProjectionMatrix,
  abs, clamp, floor, fract, fwidth, length, max, min, mix, normalize, sin, smoothstep, step
} from 'three/tsl';
import { haloHash12, haloHash22, haloPureFn } from '../haloRingTSL.js';
import { archLitTSL, archNodeMaterial } from './archTSL.js';
import { ArchBatch, archHex, archRingTubeBoxes, archRunSteps } from './archFrame.js';
import { ArchLights, archBatchMesh, archHemisphere, archPointsMesh, archTreeGeometry } from './archMaterials.js';
import { FAB_S, buildFableCitySteps, buildFableDomes, buildFableStructure, createFablePlan, fableTubes } from './fablePlan.js';

const S = FAB_S;

// ---------------------------------------------------------------------------
// Powierzchnia habitatu (SURFACE_FRAG dema, × 3). Szum wartości — czysta funkcja (hasz z
// wejść całkowitych: floor(p)).
const fabNoise = haloPureFn('fabNoise', 'float', [['p', 'vec2']], (a) => {
  const i = floor(a.p).toVar();
  const f0 = fract(a.p).toVar();
  const f = f0.mul(f0).mul(vec2(3.0).sub(f0.mul(2.0))).toVar();
  const ha = haloHash12(i);
  const hb = haloHash12(i.add(vec2(1.0, 0.0)));
  const hc = haloHash12(i.add(vec2(0.0, 1.0)));
  const hd = haloHash12(i.add(vec2(1.0, 1.0)));
  return mix(mix(ha, hb, f.x), mix(hc, hd, f.x), f.y);
});
const fabFbm3 = haloPureFn('fabFbm3', 'float', [['p', 'vec2']], (a) =>
  fabNoise(a.p).mul(0.5).add(fabNoise(a.p.mul(2.03)).mul(0.25)).add(fabNoise(a.p.mul(4.07)).mul(0.125)).div(0.875));
// linia z antyaliasingiem: fw = fwidth(x) policzone wcześniej (przed gałęziami)
const fabLineAA = (x, fw, w) => float(1.0).sub(smoothstep(float(w).sub(fw), float(w).add(fw), abs(x)));
// siatka: złożona współrzędna f = min(fract(p / cell)·cell, cell − …) i jej pochodne (vec2)
const fabFold = (p, cell) => {
  const f = fract(p.div(cell)).mul(cell).toVar();
  return min(f, vec2(cell).sub(f));
};
const fabGridAA = (f, fw, w) => max(fabLineAA(f.x, fw.x, w), fabLineAA(f.y, fw.y, w));
const fw2 = (f) => vec2(fwidth(f.x), fwidth(f.y));

// Materiał powierzchni (dawne FAB_SURFACE_*): zone — tekstura stref (węzeł texture z uv-atrapą),
// fab — uniform vec4 (obwód s, W, komórka siatki, S).
export function makeFableSurfaceNodes({ u, zone, fab }) {
  const { H, U, archNight, archShade, archWater, archSAbs } = archLitTSL(u);
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vNV = varyingProperty('vec3', 'vArchN');
  const vRingV = varyingProperty('vec2', 'vFabRing');
  const vertexNode = Fn(() => {
    const position = positionGeometry;
    vPosV.assign(position);
    vNV.assign(normalGeometry);
    vRingV.assign(attribute('aRing', 'vec2'));   // s od początku sektora 0, u (= z)
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const fragmentNode = Fn(() => {
    const vPos = vec3(vPosV).toVar();
    If(H.haloInTransitCut(archSAbs(vPos), vPos.z), () => { Discard(); });
    const Sc = fab.w;
    const ring = vec2(vRingV).toVar();
    const rd = ring.div(Sc).toVar();                     // współrzędne dema (m)
    const jit = haloHash22(floor(rd.div(5.0))).sub(0.5).mul(9.0).mul(Sc).toVar();
    const zuv = vec2(ring.x.add(jit.x).div(fab.x), ring.y.add(jit.y).div(fab.y).add(0.5));
    const zm = zone.sample(zuv).toVar();
    const type = floor(zm.r.mul(255.0).div(16.0)).toVar();
    const dens = zm.g.toVar();
    const extra = zm.b.toVar();
    const n = normalize(vNV).toVar();
    const night = archNight(vPos).toVar();
    const dist = length(U.uCamLocal.sub(vPos)).toVar();
    const farBoost = float(1.0).add(float(3.0).mul(smoothstep(Sc.mul(2500.0), Sc.mul(16000.0), dist))).toVar();
    const albedo = vec3(0.2).toVar();
    const emissive = vec3(0.0).toVar();
    const cell = fab.z;
    const cellId = floor(ring.div(cell)).toVar();
    const cellHash = haloHash12(cellId).toVar();
    const n1 = fabFbm3(rd.mul(0.01)).toVar();
    const n2 = fabNoise(rd.mul(0.15)).toVar();
    const isUrban = float(0.0).toVar();
    const water = float(0.0).toVar();       // bool jako 0/1
    const waterDepth = float(0.0).toVar();
    // ---- pochodne linii przed gałęziami stref (patrz nagłówek)
    const gPark = fabFold(rd.add(vec2(n1.mul(40.0), 0.0)), 180.0).toVar();
    const gParkFw = fw2(gPark).toVar();
    const gFarm = fabFold(rd.add(vec2(0.0, 30.0)), 150.0).toVar();
    const gFarmFw = fw2(gFarm).toVar();
    const gCell = fabFold(ring, cell).toVar();
    const gCellFw = fw2(gCell).toVar();
    const gFine = fabFold(rd, 28.0).toVar();
    const gFineFw = fw2(gFine).toVar();
    const gPad = fabFold(ring, 120.0).toVar();
    const gPadFw = fw2(gPad).toVar();
    const padCell = cell.mul(3.0).toVar();
    const padId = floor(ring.div(padCell)).toVar();
    const pc = fract(ring.div(padCell)).sub(0.5).mul(padCell).toVar();
    const pr = length(pc).div(Sc).toVar();
    // fwidth(pr − c) osobno dla każdego pierścienia (jak fwidth argumentu fabLineAA w bazie)
    const pr52 = pr.sub(52.0).toVar();
    const pr30 = pr.sub(30.0).toVar();
    const pr8 = pr.sub(8.0).toVar();
    const pr52Fw = fwidth(pr52).toVar();
    const pr30Fw = fwidth(pr30).toVar();
    const pr8Fw = fwidth(pr8).toVar();
    const hwX = abs(rd.y).sub(280.0).toVar();
    const hwFw = fwidth(hwX).toVar();
    const hwLaneX = abs(hwX).sub(10.0).toVar();
    const hwLaneFw = fwidth(hwLaneX).toVar();
    const crossX = fract(rd.x.div(1600.0)).mul(1600.0).sub(800.0).toVar();
    const crossFw = fwidth(crossX).toVar();
    const railFw = fwidth(rd.y).toVar();
    const railLineX = abs(rd.y).sub(3.5).toVar();
    const railLineFw = fwidth(railLineX).toVar();

    If(type.lessThan(0.5), () => {
      water.assign(1.0);
      waterDepth.assign(smoothstep(0.2, 1.0, extra));
    }).ElseIf(type.lessThan(1.5), () => {
      albedo.assign(mix(vec3(0.075, 0.17, 0.045), vec3(0.14, 0.24, 0.07), n1).mul(float(0.85).add(float(0.3).mul(n2))));
      const path = fabGridAA(gPark, gParkFw, 2.2);
      albedo.assign(mix(albedo, vec3(0.32, 0.29, 0.24), path.mul(0.8)));
    }).ElseIf(type.lessThan(2.5), () => {
      const can = fabNoise(rd.mul(0.35)).mul(0.5).add(fabNoise(rd.mul(0.9)).mul(0.5));
      albedo.assign(mix(vec3(0.02, 0.07, 0.02), vec3(0.06, 0.15, 0.045), can).mul(float(0.7).add(float(0.5).mul(n1))));
    }).ElseIf(type.lessThan(3.5), () => {
      const fid = floor(rd.add(vec2(0.0, 30.0)).div(vec2(150.0, 95.0))).toVar();
      const fh = haloHash12(fid.add(7.0)).toVar();
      albedo.assign(fh.lessThan(0.25).select(vec3(0.22, 0.24, 0.07), fh.lessThan(0.5).select(vec3(0.10, 0.20, 0.05),
        fh.lessThan(0.75).select(vec3(0.30, 0.21, 0.09), vec3(0.16, 0.26, 0.09)))));
      albedo.mulAssign(float(0.85).add(float(0.15).mul(sin(rd.y.mul(2.2).add(fh.mul(10.0))))));
      const fb = fabGridAA(gFarm, gFarmFw, 3.0);
      albedo.assign(mix(albedo, vec3(0.28, 0.25, 0.2), fb.mul(0.7)));
    }).ElseIf(type.lessThan(4.5), () => {
      albedo.assign(mix(vec3(0.15, 0.22, 0.06), vec3(0.24, 0.27, 0.10), n1).mul(float(0.85).add(float(0.3).mul(n2))));
    }).ElseIf(type.lessThan(5.5), () => {
      isUrban.assign(1.0);
      const sh = haloHash12(floor(rd.div(14.0)).add(3.0));
      albedo.assign(mix(vec3(0.30, 0.27, 0.24), vec3(0.42, 0.36, 0.30), sh).mul(float(0.75).add(float(0.25).mul(n2))));
      albedo.assign(mix(albedo, vec3(0.12, 0.2, 0.08), smoothstep(0.55, 0.8, fabNoise(rd.mul(0.08))).mul(0.6)));
    }).ElseIf(type.lessThan(6.5), () => {
      isUrban.assign(1.0);
      albedo.assign(mix(vec3(0.20, 0.20, 0.21), vec3(0.34, 0.33, 0.32), cellHash).mul(float(0.8).add(float(0.2).mul(n2))));
    }).ElseIf(type.lessThan(7.5), () => {
      isUrban.assign(1.0);
      albedo.assign(mix(vec3(0.13, 0.14, 0.17), vec3(0.24, 0.25, 0.28), cellHash).mul(float(0.8).add(float(0.2).mul(n2))));
    }).ElseIf(type.lessThan(8.5), () => {
      isUrban.assign(1.0);
      albedo.assign(mix(vec3(0.17, 0.15, 0.13), vec3(0.28, 0.26, 0.23), cellHash).mul(float(0.8).add(float(0.2).mul(n2))));
      const stripe = step(0.92, fract(ring.x.div(cell))).mul(step(0.5, haloHash12(cellId.add(11.0))));
      albedo.assign(mix(albedo, vec3(0.6, 0.45, 0.05), stripe.mul(0.5)));
    }).ElseIf(type.lessThan(9.5), () => {
      isUrban.assign(1.0);
      albedo.assign(vec3(0.30, 0.31, 0.32).mul(float(0.85).add(float(0.2).mul(n2))));
      const padMask = float(1.0).sub(step(0.5, padId.x.add(padId.y.mul(2.0)).sub(floor(padId.x.add(padId.y.mul(2.0)).div(3.0)).mul(3.0)))).toVar();
      const padRing = padMask.mul(fabLineAA(pr52, pr52Fw, 2.5).add(fabLineAA(pr30, pr30Fw, 1.5)).add(fabLineAA(pr8, pr8Fw, 3.0))).toVar();
      albedo.assign(mix(albedo, vec3(0.65, 0.6, 0.2), clamp(padRing, 0.0, 1.0).mul(0.8)));
      emissive.addAssign(vec3(0.9, 0.35, 0.1).mul(clamp(padRing, 0.0, 1.0)).mul(float(0.4).add(float(0.6).mul(night))).mul(U.uLayers.y).mul(padMask));
    }).ElseIf(type.lessThan(10.5), () => {
      isUrban.assign(1.0);
      albedo.assign(mix(vec3(0.12, 0.15, 0.20), vec3(0.22, 0.26, 0.32), cellHash).mul(float(0.85).add(float(0.2).mul(n2))));
      const glowLine = fabGridAA(gCell, gCellFw, Sc.mul(1.2)).mul(step(0.6, haloHash12(cellId.add(21.0))));
      emissive.addAssign(vec3(0.1, 0.6, 0.9).mul(glowLine).mul(float(0.3).add(float(0.7).mul(night))).mul(U.uLayers.y));
    }).ElseIf(type.lessThan(11.5), () => {
      albedo.assign(vec3(0.36, 0.36, 0.35).mul(float(0.85).add(float(0.2).mul(n2))));
      albedo.mulAssign(float(1.0).sub(fabGridAA(gFine, gFineFw, 0.8).mul(0.25)));
    }).ElseIf(type.lessThan(12.5), () => {
      albedo.assign(vec3(0.48, 0.42, 0.29).mul(float(0.9).add(float(0.2).mul(n2))));
    }).Else(() => {
      // płyta doku gry: beton z siatką 120 j.
      albedo.assign(vec3(0.26, 0.27, 0.285).mul(float(0.9).add(float(0.12).mul(haloHash12(floor(ring.div(120.0)))))));
      albedo.mulAssign(float(1.0).sub(fabGridAA(gPad, gPadFw, 1.5).mul(0.35)));
    });
    // drogi i kwartały w strefach miejskich
    const road = fabGridAA(gCell, gCellFw, Sc.mul(5.0)).mul(isUrban).toVar();
    const roadCenter = fabGridAA(gCell, gCellFw, Sc.mul(0.35)).mul(isUrban).toVar();
    albedo.assign(mix(albedo, vec3(0.05, 0.05, 0.055), road));
    albedo.assign(mix(albedo, vec3(0.5, 0.45, 0.25), roadCenter.mul(0.6)));
    // arterie wzdłuż ringu (u = ±280) i w poprzek co 1600, tor maglevu na osi
    const hw = fabLineAA(hwX, hwFw, 20.0).toVar();
    const hwLane = fabLineAA(hwX, hwFw, 0.6).add(fabLineAA(hwLaneX, hwLaneFw, 0.5)).toVar();
    const crossHw = fabLineAA(crossX, crossFw, 14.0).toVar();
    const hwCol = water.greaterThan(0.5).select(vec3(0.22, 0.22, 0.24), vec3(0.06, 0.06, 0.065));
    const onPad = step(12.5, type).toVar();
    const arter = max(hw, crossHw).mul(float(1.0).sub(onPad));
    albedo.assign(mix(albedo, hwCol, arter));
    albedo.assign(mix(albedo, vec3(0.55, 0.5, 0.3), clamp(hwLane, 0.0, 1.0).mul(hw).mul(0.7).mul(float(1.0).sub(onPad))));
    const rail = fabLineAA(rd.y, railFw, 9.0).mul(float(1.0).sub(onPad)).toVar();
    const railLine = fabLineAA(railLineX, railLineFw, 0.5);
    albedo.assign(mix(albedo, vec3(0.18, 0.19, 0.21), rail));
    albedo.assign(mix(albedo, vec3(0.45, 0.47, 0.5), railLine.mul(rail)));
    // światła miast (noc): okna kwartałów, latarnie
    const lightsOn = U.uLayers.y.mul(float(0.06).add(float(0.94).mul(night))).toVar();
    If(isUrban.greaterThan(0.5), () => {
      const warm = haloHash12(cellId.add(1.0)).toVar();
      const winCol = mix(vec3(1.0, 0.80, 0.55), vec3(0.70, 0.85, 1.0), step(0.55, warm)).toVar();
      If(type.greaterThan(7.5).and(type.lessThan(8.5)), () => { winCol.assign(mix(vec3(1.0, 0.65, 0.3), vec3(0.9, 0.9, 0.8), warm)); });
      If(type.greaterThan(9.5).and(type.lessThan(10.5)), () => { winCol.assign(vec3(0.6, 0.85, 1.0)); });
      const mid = fabFbm3(rd.mul(0.006).add(7.0)).toVar();
      const fine = fabNoise(rd.mul(0.5)).mul(0.5).add(haloHash12(floor(rd.div(4.0))).mul(0.5));
      const sparkle = step(0.965, haloHash12(floor(rd.div(7.0)).add(3.0)));
      const blockGlow = dens.mul(float(0.25).add(float(0.75).mul(cellHash))).mul(float(0.35).add(float(0.65).mul(mid))).mul(float(0.4).add(float(0.6).mul(fine)));
      const intensity = type.greaterThan(6.5).and(type.lessThan(7.5)).select(float(0.8),
        type.greaterThan(9.5).and(type.lessThan(10.5)).select(float(0.6), float(0.4)));
      emissive.addAssign(winCol.mul(blockGlow.mul(intensity).mul(farBoost).add(sparkle.mul(0.9).mul(dens).mul(float(0.5).add(float(0.5).mul(mid)))))
        .mul(lightsOn).mul(float(1.0).sub(road)));
      emissive.addAssign(vec3(1.0, 0.75, 0.4).mul(road).mul(0.14).mul(lightsOn));
    });
    emissive.addAssign(vec3(1.0, 0.8, 0.5).mul(hw.add(crossHw)).mul(0.10).mul(lightsOn).mul(float(1.0).sub(onPad)));
    const col = vec3(0.0).toVar();
    If(water.greaterThan(0.5), () => {
      col.assign(archWater(vPos, n, rd, vec3(0.008, 0.035, 0.07), vec3(0.03, 0.15, 0.19), waterDepth));
      col.addAssign(vec3(0.4, 0.35, 0.3).mul(0.02).mul(night).mul(U.uLayers.y));
    }).Else(() => {
      col.assign(archShade(vPos, n, albedo, 0.0));
    });
    return vec4(col.add(emissive), 1.0);
  })();
  return { vertexNode, fragmentNode };
}

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


export function buildFableRing(args) {
  return archRunSteps(buildFableRingSteps(args));
}

// Krokami (zadanie 23): mapa stref (~0,5 s CPU przy Jowiszu), miasto i kopuły z `yield` między częściami —
// archRing.js kroczy je w klatkach gry (bez przestoju ~0,7 s przy pierwszym zbliżeniu); wynik jak buildFableRing.
export function* buildFableRingSteps({ layout, uniforms, materials, geos, quality, seed, portLights = [], portSolid = null }) {
  const plan = createFablePlan(layout, seed);
  yield;
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
  const zoneData = yield* plan.bakeZoneMapSteps(ZW, ZH);
  const zoneTex = new THREE.DataTexture(zoneData, ZW, ZH, THREE.RGBAFormat);
  zoneTex.magFilter = THREE.NearestFilter;
  zoneTex.minFilter = THREE.NearestFilter;
  zoneTex.wrapS = THREE.RepeatWrapping;
  zoneTex.wrapT = THREE.ClampToEdgeWrapping;
  zoneTex.generateMipmaps = false;
  zoneTex.needsUpdate = true;
  disposables.push(zoneTex);
  // uZone: węzeł tekstury z uv-atrapą (próbkowanie z uv w materiale; bez macierzy uv), uFab: obwód (s),
  // W, komórka siatki, S
  const uZone = texture(zoneTex, vec2(0.0));
  const uFab = uniform(new THREE.Vector4(plan.CIRC, plan.W, plan.CIRC / Math.round(plan.CIRC / (56 * S)), S));
  const surfMat = archNodeMaterial('FableSurface', makeFableSurfaceNodes({ u: uniforms, zone: uZone, fab: uFab }), {}, { ...uniforms, uZone, uFab });
  disposables.push(surfMat);
  const segSurf = Math.round(plan.CIRC / 110);
  const floorGeo = ringStrip(plan, -HW, 0, HW, 0, 0, 1, segSurf, { across: 6, extraRing: true });
  const floorMesh = new THREE.Mesh(floorGeo, surfMat);
  floorMesh.name = 'FableSurface';
  floorMesh.frustumCulled = false;
  bg.push(floorMesh);

  yield;
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
  yield;
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

  yield;
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


  yield;
  // ---- miasto i drzewa per sektor ----
  const city = yield* buildFableCitySteps(plan);
  const domes = buildFableDomes(plan, city.per, lights);
  yield;
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

  yield;
  // ---- kopuły: szkło (instancje półkul), kratownice (linie), żebra (tory) ----
  const hemi = archHemisphere();
  disposables.push(hemi);
  const tints = { FOREST: [0.55, 0.78, 0.95], TROPICAL: [0.55, 0.85, 0.85], BOTANICAL: [0.7, 0.8, 0.95], RECREATION: [0.65, 0.8, 1.0], WILDERNESS: [0.5, 0.75, 0.9], AQUATIC: [0.45, 0.8, 1.0] };
  // szkło: partia instancji półkul (barwa instancji = odcień szkła wg typu kopuły)
  const glassBatch = new ArchBatch('FableDomeGlass');
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
    const tc = tints[d.type] || tints.FOREST;
    glassBatch.push16(tmp.elements, tc, 0, 0, 0, 0);
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
  const glass = archBatchMesh(glassBatch, hemi, materials.glass({ alpha: 0.15 }));
  if (glass) {
    glass.renderOrder = 30;
    bg.push(glass);
  }
  if (linePos.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lg.computeBoundingSphere();
    const lines = new THREE.LineSegments(lg, materials.lines({ color: archHex(0x9fb4c8), alpha: 0.45 }));
    lines.name = 'FableDomeLattice';
    bg.push(lines);
  }
  if (ribMats.length) {
    const rc = archHex(0xc9ced6);
    const ribBatch = new ArchBatch('FableDomeRibs');
    for (const mm of ribMats) ribBatch.push16(mm.elements, rc, 0, 0.2, 0.6, 0);
    const ribs = archBatchMesh(ribBatch, unitTorus, matBG);
    if (ribs) bg.push(ribs);
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
