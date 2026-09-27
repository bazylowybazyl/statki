// dema/asteroidy-webgpu/ship.js
//
// Kadłuby dema (Atlas + lotniskowiec eskorty) w uproszczonym renderze:
// kwad z tekstury sprite'a (alfa = sylwetka), oświetlany tym samym modelem co
// skały (słońce + WSZYSTKIE światła siatki), normalna z gradientu luminancji
// tekstury. Do tego:
//   • dysze MAIN z danych edytora (`engines.main`) i promienia z engineFx —
//     duszki blasku i smugi ciągu (glowSprites.js), światło dysz w pyle;
//   • lampy pozycyjne (czerwone, sekwencja „pasa startowego” jak w grze);
//   • POLE ODLEGŁOŚCI sylwetki z kanału alfa (transformata odległości na CPU,
//     raz) — przeszkoda dla pyłu (dust.js): d < 0 w kadłubie + gradient.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, texture, uv, modelViewMatrix, positionViewDirection,
  max, mix, dot, normalize, clamp, diffuseColor
} from 'three/tsl';
import { getHullRenderSize } from '../../src/data/ships.js';
import { buildEntityEngineFx } from '../../src/data/engineFx.js';
import { navChaseSequence, buildPositionLightWorldSprites } from '../../src/game/shipLightRuntime.js';
import { SurfaceLightingModel } from './surfaceLighting.js';
import { GLOW_ROUND, GLOW_STREAK } from './glowSprites.js';

// Rozdzielczość pola odległości (teksele wzdłuż długości kadłuba) i margines.
const SDF_RES = 320;
const SDF_MARGIN = 260;

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Transformata odległości (Felzenszwalb) 1D — kwadraty odległości. */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function edt2d(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  return grid;
}

/**
 * Pole odległości sylwetki w lokalnym układzie kadłuba (x wzdłuż dziobu,
 * y w górę sceny), teksele RGBA16F: d [j.], gradient (gx, gy).
 */
function buildHullSdf(img, hullW, hullH) {
  const worldW = hullW + SDF_MARGIN * 2;
  const worldH = hullH + SDF_MARGIN * 2;
  const texel = worldW / SDF_RES;
  const w = SDF_RES;
  const h = Math.max(8, Math.round(worldH / texel));
  // Maska: sprite przeskalowany do rozmiaru kadłuba w świecie, w środku płótna.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
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
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    dist[i] = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) * texel;
  }
  // Wiersz 0 płótna = góra sprite'a = +y sceny: tekstura z v rosnącym w górę.
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const i = sy * w + x;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(w - 1, x + 1);
      const yu = Math.max(0, sy - 1);
      const yd = Math.min(h - 1, sy + 1);
      const gx = (dist[sy * w + xr] - dist[sy * w + xl]) / ((xr - xl) * texel || 1);
      // sy rośnie w dół sceny → gradient w +y sceny ma znak odwrotny.
      const gy = -(dist[yd * w + x] - dist[yu * w + x]) / ((yd - yu) * texel || 1);
      const o = (y * w + x) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(dist[i]);
      data[o + 1] = THREE.DataUtils.toHalfFloat(gx);
      data[o + 2] = THREE.DataUtils.toHalfFloat(gy);
      data[o + 3] = THREE.DataUtils.toHalfFloat(0);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, width: worldW, height: worldH };
}

/** Materiał kadłuba: tekstura sprite'a, normalna z luminancji, model światła skał. */
class HullNodeMaterial extends THREE.NodeMaterial {
  static get type() { return 'HullNodeMaterial'; }

  constructor({ map, shared, hullW, hullH, texW, texH }) {
    super();
    this.lights = true;
    this.fog = false;
    this.alphaTest = 0.5;
    this.map = map;
    this.S = shared;
    this.hullW = hullW;
    this.hullH = hullH;
    this.texW = texW;
    this.texH = texH;
    // Transmitancja słońca przy kadłubie (× przełącznik przesłaniania).
    this.sunT = uniform(1);
    this._surf = null;
  }

  setupDiffuseColor() {
    const S = this.S;
    const map = this.map;
    const tuv = uv();
    const tex = texture(map, tuv).toVar();
    diffuseColor.assign(tex);
    diffuseColor.a.lessThanEqual(0.5).discard();
    // Normalna z gradientu luminancji (relief paneli, kraty, dysze).
    const du = 1.5 / this.texW;
    const dv = 1.5 / this.texH;
    const lum = (t) => dot(texture(map, t).rgb, vec3(0.299, 0.587, 0.114));
    const hs = 7.0; // j. wysokości na jednostkę luminancji
    const gx = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(hs / (2 * du * this.hullW));
    const gy = lum(tuv.add(vec2(0, dv))).sub(lum(tuv.sub(vec2(0, dv)))).mul(hs / (2 * dv * this.hullH));
    const nLocal = normalize(vec3(gx.negate(), gy.negate(), 1.0));
    const Nv = normalize(modelViewMatrix.mul(vec4(nLocal, 0.0)).xyz).toVar();
    const Vv = positionViewDirection.toVar();
    const albedo = tex.rgb.mul(0.85).toVar();
    const metal = float(0.3);
    const diffAlbedo = albedo.mul(float(1.0).sub(metal.mul(0.85))).toVar();
    const specTint = mix(vec3(1.0), vec3(0.6, 0.6, 0.62), metal);
    const sunT = mix(float(1.0), this.sunT, S.sunOcc).toVar();
    const fill = mix(float(0.4), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.92)));
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const emissive = diffAlbedo.mul(S.ambientTop.mul(up.mul(0.45).add(0.55))).mul(fill).toVar();
    this._surf = {
      N: Nv, V: Vv, mu: max(dot(Nv, Vv), 0.02), diffAlbedo, lunarK: float(0), wrap: S.wrap,
      gloss: float(40), specK: float(0.22), specTint, sparkBase: float(0), sparkCol: vec3(1), sunVis: sunT, emissive
    };
  }

  setupNormal() {
    return this._surf ? this._surf.N : vec3(0, 0, 1);
  }

  setupLightingModel() {
    return new SurfaceLightingModel(this._surf);
  }

  setupLighting(builder) {
    return super.setupLighting(builder).add(this._surf.emissive);
  }

  setupOutput(builder, outputNode) {
    return vec4(max(outputNode.rgb.mul(this.S.exposure), vec3(0.0)), 1.0);
  }
}

/**
 * Kadłub dema.
 * @param {object} o
 * @param {string} o.id klucz kadłuba (getHullRenderSize, engineFx)
 * @param {string} o.url sprite
 * @param {object} o.editor dane edytora (engines, lights)
 */
export class DemoHull {
  static async load({ id, url, editor, scene, shared }) {
    const img = await loadImage(url);
    const hull = new DemoHull();
    await hull._init({ id, img, editor, scene, shared });
    return hull;
  }

  async _init({ id, img, editor, scene, shared }) {
    this.id = id;
    const size = getHullRenderSize(id, img.naturalWidth, img.naturalHeight);
    this.w = size.w;
    this.h = size.h;
    this.length = size.w;
    this.hpScale = size.w / img.naturalWidth;
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.needsUpdate = true;
    this.material = new HullNodeMaterial({ map, shared, hullW: size.w, hullH: size.h, texW: img.naturalWidth, texH: img.naturalHeight });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = `hull_${id}`;
    scene.add(this.mesh);
    // Encja w formacie gry: światła z edytora (shipLightRuntime czyta px PNG × skala).
    this.entity = {
      id, pos: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, editorLights: editor?.lights || null,
      __hardpointScale: this.hpScale, visual: { spriteScale: 1 }, w: size.w, h: size.h
    };
    // Dysze MAIN (px PNG względem środka, +X = dziób) → układ kadłuba w j. świata.
    const fx = buildEntityEngineFx(id, null, this.hpScale);
    this.nozzleRadius = fx.nozzleRadius || this.length * 0.0188;
    this.nozzles = (editor?.engines?.main || []).map((e) => ({ x: e.x * this.hpScale, y: e.y * this.hpScale }));
    if (!this.nozzles.length) this.nozzles.push({ x: -size.w * 0.48, y: 0 });
    this.sdf = buildHullSdf(img, size.w, size.h);
    // Stan ruchu (świat gry).
    this.x = 0; this.y = 0; this.angle = 0; this.vx = 0; this.vy = 0; this.angVel = 0;
    this.thrust = 0;
    this._navSprites = [];
    // Faza sekwencji lamp wzdłuż kadłuba: szerokość sprite'a w świecie (jak
    // siatka kadłuba w grze).
    const gridLike = { srcWidth: size.w, pivot: { x: 0 } };
    this._navOpts = { out: this._navSprites, time: 0, getGrid: () => gridLike };
  }

  setPose(x, y, angle, vx, vy, angVel) {
    this.x = x; this.y = y; this.angle = angle; this.vx = vx; this.vy = vy; this.angVel = angVel;
    const e = this.entity;
    e.x = e.pos.x = x;
    e.y = e.pos.y = y;
    e.angle = angle;
  }

  /** Mesh w scenie względem początku (ox, oy) [świat gry]. */
  syncMesh(ox, oy, sunT) {
    this.mesh.position.set(this.x - ox, -(this.y - oy), 0);
    this.mesh.rotation.set(0, 0, -this.angle);
    this.mesh.updateMatrixWorld(true);
    this.material.sunT.value = sunT;
  }

  /** Pozycja dyszy w świecie gry. */
  nozzleWorld(n, out) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    // Oś y sprite'a (px w dół) = +y gry przy kącie 0.
    out.x = this.x + n.x * c - n.y * s;
    out.y = this.y + n.x * s + n.y * c;
    return out;
  }

  /**
   * Duszki: blask dysz i smugi ciągu, lampy pozycyjne. Scena względem (ox, oy).
   */
  addGlows(glow, ox, oy, time, thrustVis = 1) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const back = { x: -c, y: -s };
    const p = { x: 0, y: 0 };
    const th = this.thrust;
    const R = this.nozzleRadius;
    for (const n of this.nozzles) {
      this.nozzleWorld(n, p);
      const sx = p.x - ox;
      const sy = -(p.y - oy);
      // Rdzeń dyszy: stały blask plazmy + ciąg (paleta „plazma” z engineFx).
      const k = (0.35 + th * 1.2) * thrustVis;
      glow.add(sx, sy, 4, R * (2.2 + th * 1.3), 0.7 * k, 2.1 * k, 3.6 * k, GLOW_ROUND);
      if (th > 0.02) {
        const len = R * (6 + th * 22);
        const cxs = sx + back.x * len * 0.45;
        const cys = sy - back.y * len * 0.45;
        glow.add(cxs, cys, 3, R * 1.6, 0.25 * th, 0.9 * th, 2.4 * th, GLOW_STREAK, -back.x, back.y, len / (R * 1.6));
      }
    }
    // Lampy pozycyjne: sekwencja jak w grze (billboardy shipLights3D).
    this._navOpts.time = time;
    buildPositionLightWorldSprites([this.entity], this._navOpts);
    for (const l of this._navSprites) {
      const seq = navChaseSequence(time, l.phase);
      const col = l.color;
      const k = 3.0 * seq * l.intensity;
      glow.add(l.x - ox, -(l.y - oy), 6, Math.max(12, l.coreWorld * 7), col.r * k, col.g * k, col.b * k, GLOW_ROUND);
    }
  }
}
