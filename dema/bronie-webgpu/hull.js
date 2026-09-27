// dema/bronie-webgpu/hull.js
//
// Kadłub dema broni: kwad ze sprite'a gry oświetlany słońcem i WSZYSTKIMI
// światłami siatki (błyski luf, pociski, trafienia, żar ran — lightGrid.js),
// normalna z gradientu luminancji tekstury (jak dema/asteroidy-webgpu/ship.js).
// Do tego:
//   • POLE ODLEGŁOŚCI sylwetki (tekstura dla compute iskier i odłamków — odbijają
//     się od burty) i jego kopia na CPU (trafienia pocisków, normalna w punkcie);
//   • MAPA USZKODZEŃ na GPU (bufor storage w układzie uv kwadu): żar (stygnie
//     z bieli przez pomarańcz do czerwieni, szybciej gdy gorętszy), osmalenie,
//     przestrzelina (kadłub przezroczysty, brzeg rozżarzony) i poświata jonowa
//     (Tempest). Stemple ran z CPU, stygnięcie compute raz na klatkę. Brzeg rany
//     świeci jak w grze (biały żar 8–12 HDR tylko na świeżym brzegu).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, instanceIndex,
  texture, uv, modelViewMatrix, positionViewDirection, If, Return, Loop,
  max, min, mix, dot, normalize, clamp, smoothstep, fwidth, diffuseColor, exp, floor, fract, sin, abs, length, atan
} from 'three/tsl';
import { getHullRenderSize } from '../../src/data/ships.js';
import { SurfaceLightingModel } from './surfaceLighting.js';

const SDF_RES = 320;
const SDF_MARGIN = 220;
export const DMG_W = 512;
export const DMG_H = 256;
const STAMP_CAP = 64;

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// Transformata odległości (Felzenszwalb) — kopia z dema/asteroidy-webgpu/ship.js.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2d(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n); const d = new Float64Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = grid[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) grid[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = grid[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) grid[y * w + x] = d[x]; }
  return grid;
}

/**
 * Pole odległości sylwetki w układzie kadłuba (x ku dziobowi, y w górę sceny):
 * tekstura RGBA16F (d, gx, gy) + tablica CPU (d) z tym samym układem.
 */
function buildHullSdf(img, hullW, hullH) {
  const worldW = hullW + SDF_MARGIN * 2;
  const worldH = hullH + SDF_MARGIN * 2;
  const texel = worldW / SDF_RES;
  const w = SDF_RES;
  const h = Math.max(8, Math.round(worldH / texel));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.clearRect(0, 0, w, h);
  cx.drawImage(img, SDF_MARGIN / texel, SDF_MARGIN / texel, hullW / texel, hullH / texel);
  const px = cx.getImageData(0, 0, w, h).data;
  const INF = 1e20;
  const inside = new Float64Array(w * h);
  const outside = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const solid = px[i * 4 + 3] > 127;
    outside[i] = solid ? 0 : INF;
    inside[i] = solid ? INF : 0;
  }
  edt2d(outside, w, h);
  edt2d(inside, w, h);
  // cpu: wiersz 0 = GÓRA sceny (+y); tekstura: v rośnie w górę sceny
  const cpu = new Float32Array(w * h);
  const data = new Uint16Array(w * h * 4);
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) * texel;
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;          // wiersz płótna (dół sceny = duże sy)
    for (let x = 0; x < w; x++) {
      const i = sy * w + x;
      const xl = Math.max(0, x - 1); const xr = Math.min(w - 1, x + 1);
      const yu = Math.max(0, sy - 1); const yd = Math.min(h - 1, sy + 1);
      const gx = (dist[sy * w + xr] - dist[sy * w + xl]) / ((xr - xl) * texel || 1);
      const gy = -(dist[yd * w + x] - dist[yu * w + x]) / ((yd - yu) * texel || 1);
      const o = (y * w + x) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(dist[i]);
      data[o + 1] = THREE.DataUtils.toHalfFloat(gx);
      data[o + 2] = THREE.DataUtils.toHalfFloat(gy);
      data[o + 3] = 0;
      cpu[y * w + x] = dist[i];
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, width: worldW, height: worldH, cpu, w, h, texel };
}

/** Wspólne uniformy oświetlenia kadłubów i wieżyczek. */
export function createSurfaceShared() {
  return {
    ambientTop: uniform(new THREE.Vector3(0.10, 0.11, 0.14)),
    exposure: uniform(1.0),
    wrap: uniform(0.25),
    time: uniform(0),
    damageOn: uniform(1)
  };
}

/** Materiał kadłuba: tekstura, normalna z luminancji, światła siatki, mapa uszkodzeń. */
class HullFxMaterial extends THREE.NodeMaterial {
  static get type() { return 'HullFxMaterial'; }

  constructor({ map, shared, hullW, hullH, texW, texH, damage, noise }) {
    super();
    this.lights = true;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = true;
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = THREE.OneFactor;
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.map = map;
    this.S = shared;
    this.hullW = hullW; this.hullH = hullH;
    this.texW = texW; this.texH = texH;
    this.damage = damage;
    this.noiseTex = noise;
    this._surf = null;
  }

  /** Dwuliniowe próbkowanie bufora uszkodzeń w uv kwadu. */
  _sampleDamage(tuv) {
    const dmg = this.damage;
    const p = tuv.mul(vec2(DMG_W, DMG_H)).sub(0.5).toVar();
    const c = floor(p).toVar();
    const f = p.sub(c).toVar();
    const x0 = clamp(int(c.x), int(0), int(DMG_W - 1));
    const y0 = clamp(int(c.y), int(0), int(DMG_H - 1));
    const x1 = clamp(int(c.x).add(int(1)), int(0), int(DMG_W - 1));
    const y1 = clamp(int(c.y).add(int(1)), int(0), int(DMG_H - 1));
    const at = (x, y) => dmg.element(y.mul(int(DMG_W)).add(x));
    const a = mix(at(x0, y0), at(x1, y0), f.x);
    const b = mix(at(x0, y1), at(x1, y1), f.x);
    return mix(a, b, f.y);
  }

  setupDiffuseColor() {
    const S = this.S;
    const map = this.map;
    const tuv = uv().toVar();
    const tex = texture(map, tuv).toVar();
    diffuseColor.assign(tex);
    diffuseColor.a.lessThanEqual(0.02).discard();
    const sprA = smoothstep(float(0.5).sub(fwidth(tex.a).mul(0.75)), float(0.5).add(fwidth(tex.a).mul(0.75)), tex.a);
    // Uszkodzenia: x żar, y osmalenie, z przestrzelina, w jony.
    const D = this._sampleDamage(tuv).mul(S.damageOn).toVar();
    const n1 = texture(this.noiseTex, tuv.mul(vec2(this.hullW / 170, this.hullH / 170))).r;
    const n2 = texture(this.noiseTex, tuv.mul(vec2(this.hullW / 55, this.hullH / 55))).b;
    const jag = n1.mul(0.65).add(n2.mul(0.35)).sub(0.5).toVar();
    const n3 = texture(this.noiseTex, tuv.mul(vec2(this.hullW / 22, this.hullH / 22))).g;
    const holeF = D.z.add(jag.mul(0.62)).add(n3.sub(0.5).mul(0.18)).toVar();
    const hole = smoothstep(0.52, 0.6, holeF).toVar();
    const rim = smoothstep(0.18, 0.5, holeF).mul(float(1.0).sub(hole)).toVar();
    const scorch = clamp(D.y.add(jag.mul(0.35)), 0.0, 1.0).toVar();
    this._alpha = sprA.mul(float(1.0).sub(hole));
    // Normalna z gradientu luminancji (relief paneli) + wgniecenie brzegu rany.
    const du = 1.5 / this.texW;
    const dv = 1.5 / this.texH;
    const lum = (t) => dot(texture(map, t).rgb, vec3(0.299, 0.587, 0.114));
    const hs = 7.0;
    const gx = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(hs / (2 * du * this.hullW));
    const gy = lum(tuv.add(vec2(0, dv))).sub(lum(tuv.sub(vec2(0, dv)))).mul(hs / (2 * dv * this.hullH));
    const nLocal = normalize(vec3(gx.negate(), gy.negate(), 1.0));
    const Nv = normalize(modelViewMatrix.mul(vec4(nLocal, 0.0)).xyz).toVar();
    const Vv = positionViewDirection.toVar();
    const burnt = mix(vec3(1.0), vec3(0.10, 0.085, 0.075), scorch);
    const albedo = tex.rgb.mul(0.85).mul(burnt).toVar();
    const metal = float(0.3);
    const diffAlbedo = albedo.mul(float(1.0).sub(metal.mul(0.85))).toVar();
    const specTint = mix(vec3(1.0), vec3(0.6, 0.6, 0.62), metal);
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const ambient = diffAlbedo.mul(S.ambientTop.mul(up.mul(0.45).add(0.55)));
    // Żar: skala barwy ciała czarnego (czerwień → pomarańcz → biel), mocniej na brzegu.
    const t = D.x.mul(rim.mul(2.2).add(scorch.mul(0.6)).add(0.25)).toVar();
    const heatCol = vec3(1.0, 0.18, 0.02).mul(smoothstep(0.02, 0.5, t).mul(1.3))
      .add(vec3(1.0, 0.5, 0.1).mul(smoothstep(0.35, 1.4, t).mul(2.4)))
      .add(vec3(1.0, 0.92, 0.78).mul(smoothstep(1.2, 3.2, t).mul(7.0)));
    const flick = sin(S.time.mul(9.0).add(n2.mul(31.0))).mul(0.12).add(0.88);
    const ionCol = vec3(0.35, 1.25, 2.9).mul(D.w.mul(n1.mul(1.4).add(0.3)).mul(flick));
    const emissive = ambient.add(heatCol.mul(flick)).add(ionCol).toVar();
    this._surf = {
      N: Nv, V: Vv, mu: max(dot(Nv, Vv), 0.02), diffAlbedo, lunarK: float(0), wrap: S.wrap,
      gloss: float(40), specK: float(0.22).mul(float(1.0).sub(scorch.mul(0.8))), specTint,
      sparkBase: float(0), sparkCol: vec3(1), sunVis: float(1), emissive
    };
  }

  setupNormal() { return this._surf ? this._surf.N : vec3(0, 0, 1); }
  setupLightingModel() { return new SurfaceLightingModel(this._surf); }
  setupLighting(builder) { return super.setupLighting(builder).add(this._surf.emissive); }
  setupOutput(builder, outputNode) {
    const a = this._alpha;
    return vec4(max(outputNode.rgb.mul(this.S.exposure), vec3(0.0)).mul(a), a);
  }
}

/**
 * Kadłub dema z mapą uszkodzeń. Świat gry: (x, y), kąt; scena: (x, −y), −kąt.
 */
export class FxHull {
  static async load({ id, url, scene, shared, noise, renderer, renderOrder = 5 }) {
    const img = await loadImage(url);
    const hull = new FxHull();
    hull._init({ id, img, scene, shared, noise, renderer, renderOrder });
    return hull;
  }

  _init({ id, img, scene, shared, noise, renderer, renderOrder }) {
    this.id = id;
    this.renderer = renderer;
    const size = getHullRenderSize(id, img.naturalWidth, img.naturalHeight);
    this.w = size.w;
    this.h = size.h;
    this.hpScale = size.w / img.naturalWidth;
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.needsUpdate = true;
    // Mapa uszkodzeń + stemple (uniformy, ≤ STAMP_CAP na klatkę).
    this.damage = instancedArray(DMG_W * DMG_H, 'vec4').setName(`dmg_${id}`);
    this.U = {
      dt: uniform(0),
      stampCount: uniform(0, 'int'),
      stampA: uniformArray(Array.from({ length: STAMP_CAP }, () => new THREE.Vector4()), 'vec4'),
      stampB: uniformArray(Array.from({ length: STAMP_CAP }, () => new THREE.Vector4()), 'vec4'),
      stampC: uniformArray(Array.from({ length: STAMP_CAP }, () => new THREE.Vector4(1, 0, 1, 0)), 'vec4'),
      coolK: uniform(1),
      reset: uniform(0)
    };
    this._stamps = 0;
    this.material = new HullFxMaterial({
      map, shared, hullW: size.w, hullH: size.h, texW: img.naturalWidth, texH: img.naturalHeight,
      damage: this.damage, noise
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = `hull_${id}`;
    scene.add(this.mesh);
    this.sdf = buildHullSdf(img, size.w, size.h);
    this.x = 0; this.y = 0; this.angle = 0;
    this._buildKernel();
  }

  _buildKernel() {
    const U = this.U;
    const dmg = this.damage;
    const aspect = this.w / this.h;
    this.kernel = Fn(() => {
      const i = instanceIndex.toVar();
      If(i.greaterThanEqual(uint(DMG_W * DMG_H)), () => { Return(); });
      const e = dmg.element(i);
      const d = e.toVar();
      If(U.reset.greaterThan(0.5), () => { d.assign(vec4(0.0)); });
      // Stygnięcie: gorący brzeg szybko (biel → pomarańcz w ~0,3 s), czerwień długo.
      const k = d.x.mul(1.3).add(0.45).mul(U.coolK);
      d.x.assign(d.x.mul(exp(k.negate().mul(U.dt))));
      d.w.assign(d.w.mul(exp(U.dt.mul(-5.0))));
      const cx = float(i.mod(uint(DMG_W))).add(0.5).div(DMG_W);
      const cy = float(i.div(uint(DMG_W))).add(0.5).div(DMG_H);
      Loop(U.stampCount, ({ i: s }) => {
        const A = U.stampA.element(s);
        const B = U.stampB.element(s);
        const C = U.stampC.element(s);
        // A: uv środka, promień (w v); B: żar, osmalenie, przestrzelina, jony;
        // C: kierunek (lokalny kadłuba), wydłużenie wzdłuż niego, ziarno kształtu
        const dx = cx.sub(A.x).mul(aspect);
        const dy = cy.sub(A.y);
        const al = dx.mul(C.x).add(dy.mul(C.y));
        const ac = dy.mul(C.x).sub(dx.mul(C.y));
        const ang = atan(ac, al);
        // nieregularny obrys: kilka harmonicznych kąta z ziarnem stempla
        const wob = sin(ang.mul(5.0).add(C.w)).mul(0.13).add(sin(ang.mul(9.0).sub(C.w.mul(1.7))).mul(0.07)).add(sin(ang.mul(2.0).add(C.w.mul(3.1))).mul(0.1));
        const r = length(vec2(al.div(max(C.z, 1.0)), ac)).div(max(A.z, 1e-5)).mul(float(1.0).add(wob));
        If(r.lessThan(1.6), () => {
          const core = exp(r.mul(r).mul(-2.6));
          const halo = exp(r.mul(r).mul(-0.9));
          d.x.assign(max(d.x, B.x.mul(core)).add(B.x.mul(0.12).mul(halo)));
          d.y.assign(min(d.y.add(B.y.mul(halo)), 1.0));
          d.z.assign(max(d.z, B.z.mul(clamp(float(1.25).sub(r.mul(0.9)), 0.0, 1.0))));
          d.w.assign(max(d.w, B.w.mul(halo)));
        });
      });
      e.assign(d);
    })().compute(DMG_W * DMG_H).setName(`dmgKernel_${this.id}`);
  }

  /** Poza w świecie gry. */
  setPose(x, y, angle) {
    this.x = x; this.y = y; this.angle = angle;
    this.mesh.position.set(x, -y, 0);
    this.mesh.rotation.set(0, 0, -angle);
    this.mesh.updateMatrixWorld(true);
  }

  /** Świat gry → lokalny układ kadłuba (x ku dziobowi, y w górę sceny). */
  toLocal(wx, wy, out) {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    out.x = dx * c + dy * s;
    out.y = -(-dx * s + dy * c);
    return out;
  }

  /** Lokalny → świat gry. */
  toWorld(lx, ly, out) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const gy = -ly;
    out.x = this.x + lx * c - gy * s;
    out.y = this.y + lx * s + gy * c;
    return out;
  }

  /** Odległość od sylwetki [j.] w punkcie lokalnym (dwuliniowo). */
  distLocal(lx, ly) {
    const S = this.sdf;
    const fx = (lx + S.width * 0.5) / S.texel - 0.5;
    const fy = (S.height * 0.5 - ly) / S.texel - 0.5;
    if (fx < 0 || fy < 0 || fx >= S.w - 1 || fy >= S.h - 1) return 1e4;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    const tx = fx - x0; const ty = fy - y0;
    // tablica cpu: wiersz 0 = góra sceny (duże ly)
    const r0 = (S.h - 1 - y0) * S.w;
    const r1 = (S.h - 1 - (y0 + 1)) * S.w;
    const a = S.cpu[r0 + x0] * (1 - tx) + S.cpu[r0 + x0 + 1] * tx;
    const b = S.cpu[r1 + x0] * (1 - tx) + S.cpu[r1 + x0 + 1] * tx;
    return a * (1 - ty) + b * ty;
  }

  /** Normalna na zewnątrz w świecie gry w punkcie świata. */
  normalAt(wx, wy, out) {
    const l = this.toLocal(wx, wy, { x: 0, y: 0 });
    const e = this.sdf.texel;
    const gx = this.distLocal(l.x + e, l.y) - this.distLocal(l.x - e, l.y);
    const gy = this.distLocal(l.x, l.y + e) - this.distLocal(l.x, l.y - e);
    const len = Math.hypot(gx, gy) || 1;
    const nlx = gx / len;
    const nly = gy / len;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    out.x = nlx * c + nly * s;
    out.y = nlx * s - nly * c;
    return out;
  }

  /**
   * Przecięcie odcinka (świat gry) z sylwetką: pierwszy punkt z d < 0.
   * Zwraca ułamek odcinka [0, 1] albo −1.
   */
  raycast(x0, y0, x1, y1, stepLen = 5) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / stepLen));
    const p = { x: 0, y: 0 };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.toLocal(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p);
      if (Math.abs(p.x) > this.w * 0.5 + 10 || Math.abs(p.y) > this.h * 0.5 + 10) continue;
      if (this.distLocal(p.x, p.y) < 0) {
        // doprecyzowanie połowieniem
        let lo = Math.max(0, (i - 1) / n);
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) * 0.5;
          this.toLocal(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m, p);
          if (this.distLocal(p.x, p.y) < 0) hi = m; else lo = m;
        }
        return hi;
      }
    }
    return -1;
  }

  /** Czy punkt świata leży w sylwetce. */
  inside(wx, wy) {
    const p = this.toLocal(wx, wy, { x: 0, y: 0 });
    return this.distLocal(p.x, p.y) < 0;
  }

  /**
   * Stempel rany (świat gry). radius [j.], heat (1 = pomarańcz, 3 = biel),
   * scorch 0..1, hole 0..1 (> 0,55 — przestrzelina), ion 0..1.
   */
  stamp(wx, wy, radius, heat, scorch = 0, hole = 0, ion = 0, dirX = 0, dirY = 0, elong = 1) {
    if (this._stamps >= STAMP_CAP) return;
    const p = this.toLocal(wx, wy, { x: 0, y: 0 });
    const u = p.x / this.w + 0.5;
    const v = p.y / this.h + 0.5;
    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return;
    const i = this._stamps++;
    this.U.stampA.array[i].set(u, v, radius / this.h, 1);
    this.U.stampB.array[i].set(heat, scorch, hole, ion);
    // kierunek w układzie kadłuba (x ku dziobowi, y w górę sceny)
    let lx = 1; let ly = 0;
    const dl = Math.hypot(dirX, dirY);
    if (dl > 1e-6) {
      const c = Math.cos(this.angle); const s = Math.sin(this.angle);
      lx = (dirX * c + dirY * s) / dl;
      ly = -(-dirX * s + dirY * c) / dl;
    }
    this.U.stampC.array[i].set(lx, ly, dl > 1e-6 ? elong : 1, Math.random() * 100);
  }

  resetDamage() { this._reset = true; }

  /** Stygnięcie i stemple — raz na klatkę. */
  update(dt) {
    const U = this.U;
    U.dt.value = dt;
    U.stampCount.value = this._stamps;
    U.reset.value = this._reset ? 1 : 0;
    this._reset = false;
    this.renderer.compute(this.kernel, DMG_W * DMG_H);
    this._stamps = 0;
  }
}
