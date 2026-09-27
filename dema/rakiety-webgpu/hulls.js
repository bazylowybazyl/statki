// dema/rakiety-webgpu/hulls.js
//
// Kadłuby dema rakiet — na bazie DemoHull z dema asteroid WebGPU (commit
// cb02194, dema/asteroidy-webgpu/ship.js): kwad z tekstury sprite'a (alfa =
// sylwetka), normalna z gradientu luminancji, model światła kadłubów, przez
// który idą słońce i WSZYSTKIE światła siatki (dysze rakiet, błyski wybuchów).
// Zmiany względem oryginału:
//   • pole odległości sylwetki tylko na CPU (sdfAt / sdfGradAt) — zapalnik
//     kontaktowy rakiet: wybuch na prawdziwym obrysie poszycia;
//   • CIEŃ DYMU na poszyciu: marsz ku słońcu po mapie gęstości dymu (ta sama,
//     z której dym liczy samocień) — gęsta chmura nad okrętem go przygasza;
//   • ruch celu (drift, uniki) i promień zapalnika z profilu kadłuba gry.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, texture, uv, modelViewMatrix, positionViewDirection, positionWorld,
  max, mix, dot, normalize, clamp, smoothstep, fwidth, diffuseColor, exp
} from 'three/tsl';
import { getHullRenderSize } from '../../src/data/ships.js';
import { buildEntityEngineFx } from '../../src/data/engineFx.js';
import { navChaseSequence, buildPositionLightWorldSprites } from '../../src/game/shipLightRuntime.js';
import { SurfaceLightingModel, GLOW_ROUND, GLOW_STREAK } from './common.js';

const SDF_RES = 256;
const SDF_MARGIN = 160;

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

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

/** Pole odległości sylwetki na CPU (wiersz 0 = góra sprite'a = −y lokalne gry). */
function buildHullSdf(img, hullW, hullH) {
  const worldW = hullW + SDF_MARGIN * 2;
  const worldH = hullH + SDF_MARGIN * 2;
  const texel = worldW / SDF_RES;
  const w = SDF_RES;
  const h = Math.max(8, Math.round(worldH / texel));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
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
  for (let i = 0; i < w * h; i++) dist[i] = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) * texel;
  return { field: dist, fw: w, fh: h, texel, width: worldW, height: worldH };
}

/** Wspólne uniformy materiału kadłubów + cień dymu. */
export function createHullShared() {
  return {
    ambientTop: uniform(new THREE.Vector3(0.16, 0.18, 0.22)),
    wrap: uniform(0.12),
    exposure: uniform(1.0),
    smokeShadow: uniform(1),
    smoke: null // { tex, dRect, dStep, kappa } — podpina main po utworzeniu dymu
  };
}

class HullNodeMaterial extends THREE.NodeMaterial {
  static get type() { return 'RocketDemoHullMaterial'; }

  constructor({ map, shared, hullW, hullH, texW, texH, owner = 0 }) {
    super();
    this.lights = true;
    this.lightOwner = uniform(owner);
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
    this.hullW = hullW;
    this.hullH = hullH;
    this.texW = texW;
    this.texH = texH;
    this._surf = null;
  }

  setupDiffuseColor() {
    const S = this.S;
    const map = this.map;
    const tuv = uv();
    const tex = texture(map, tuv).toVar();
    diffuseColor.assign(tex);
    diffuseColor.a.lessThanEqual(0.02).discard();
    this._alpha = smoothstep(float(0.5).sub(fwidth(tex.a).mul(0.75)), float(0.5).add(fwidth(tex.a).mul(0.75)), tex.a);
    const du = 1.5 / this.texW;
    const dv = 1.5 / this.texH;
    const lum = (t) => dot(texture(map, t).rgb, vec3(0.299, 0.587, 0.114));
    const hs = 7.0;
    const gx = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(hs / (2 * du * this.hullW));
    const gy = lum(tuv.add(vec2(0, dv))).sub(lum(tuv.sub(vec2(0, dv)))).mul(hs / (2 * dv * this.hullH));
    const nLocal = normalize(vec3(gx.negate(), gy.negate(), 1.0));
    const Nv = normalize(modelViewMatrix.mul(vec4(nLocal, 0.0)).xyz).toVar();
    const Vv = positionViewDirection.toVar();
    const albedo = tex.rgb.mul(0.85).toVar();
    const metal = float(0.3);
    const diffAlbedo = albedo.mul(float(1.0).sub(metal.mul(0.85))).toVar();
    const specTint = mix(vec3(1.0), vec3(0.6, 0.6, 0.62), metal);
    // Cień dymu: marsz ku słońcu po mapie gęstości dymu (4 próbki).
    let sunVis = float(1.0);
    const sm = S.smoke;
    if (sm) {
      const P = positionWorld.xy;
      const tau = float(0.0).toVar();
      for (let k = 1; k <= 4; k++) {
        const q = P.add(sm.dStep.mul(k * 1.6));
        tau.addAssign(texture(sm.tex, q.sub(sm.dRect.xy).mul(sm.dRect.zw)).x);
      }
      sunVis = mix(float(1.0), exp(tau.mul(sm.kappa).mul(-0.6)), S.smokeShadow).toVar();
    }
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const emissive = diffAlbedo.mul(S.ambientTop.mul(up.mul(0.45).add(0.55))).toVar();
    this._surf = {
      N: Nv, V: Vv, diffAlbedo, wrap: S.wrap,
      gloss: float(40), specK: float(0.22), specTint, sunVis, emissive
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
    const a = this._alpha;
    return vec4(max(outputNode.rgb.mul(this.S.exposure), vec3(0.0)).mul(a), a);
  }
}

export class DemoHull {
  static async load({ id, url, editor, scene, shared, owner = 0 }) {
    const img = await loadImage(url);
    const hull = new DemoHull();
    hull._init({ id, img, editor, scene, shared, owner });
    return hull;
  }

  _init({ id, img, editor, scene, shared, owner }) {
    this.id = id;
    this.owner = owner;
    const size = getHullRenderSize(id, img.naturalWidth, img.naturalHeight);
    this.w = size.w;
    this.h = size.h;
    this.length = size.w;
    this.radius = size.radius;
    this.hpScale = size.w / img.naturalWidth;
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.needsUpdate = true;
    this.material = new HullNodeMaterial({ map, shared, hullW: size.w, hullH: size.h, texW: img.naturalWidth, texH: img.naturalHeight, owner });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = `hull_${id}`;
    scene.add(this.mesh);
    this.entity = {
      id, pos: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, editorLights: editor?.lights || null,
      __hardpointScale: this.hpScale, visual: { spriteScale: 1 }, w: size.w, h: size.h
    };
    const fx = buildEntityEngineFx(id, null, this.hpScale);
    this.nozzleRadius = fx.nozzleRadius || this.length * 0.0188;
    this.nozzles = (editor?.engines?.main || []).map((e) => ({ x: e.x * this.hpScale, y: e.y * this.hpScale }));
    if (!this.nozzles.length) this.nozzles.push({ x: -size.w * 0.48, y: 0 });
    // Gniazda rakiet (px PNG → j. świata, układ kadłuba).
    this.missileMounts = (editor?.hardpoints || [])
      .filter((h) => h.type === 'missile' || h.type === 'special_missile')
      .map((h) => ({ x: h.x * this.hpScale, y: h.y * this.hpScale, special: h.type === 'special_missile' }));
    this.sdf = buildHullSdf(img, size.w, size.h);
    this.x = 0; this.y = 0; this.angle = 0; this.vx = 0; this.vy = 0; this.angVel = 0;
    this.thrust = 0;
    this.dead = false;
    this._navSprites = [];
    const gridLike = { srcWidth: size.w, pivot: { x: 0 } };
    this._navOpts = { out: this._navSprites, time: 0, getGrid: () => gridLike };
    this._g = { x: 0, y: 0 };
  }

  setPose(x, y, angle, vx, vy, angVel) {
    this.x = x; this.y = y; this.angle = angle; this.vx = vx; this.vy = vy; this.angVel = angVel;
    const e = this.entity;
    e.x = e.pos.x = x;
    e.y = e.pos.y = y;
    e.angle = angle;
  }

  syncMesh(ox, oy) {
    this.mesh.position.set(this.x - ox, -(this.y - oy), 0);
    this.mesh.rotation.set(0, 0, -this.angle);
    this.mesh.updateMatrixWorld(true);
  }

  /** Punkt w układzie kadłuba (px PNG × skala) → świat gry. */
  localToWorld(lx, ly, out) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    out.x = this.x + lx * c - ly * s;
    out.y = this.y + lx * s + ly * c;
    return out;
  }

  nozzleWorld(n, out) {
    return this.localToWorld(n.x, n.y, out);
  }

  /** Odległość punktu świata od sylwetki [j.] (< 0 w kadłubie). */
  sdfAt(wx, wy) {
    const S = this.sdf;
    const dx = wx - this.x;
    const dy = wy - this.y;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    const fx = (lx + S.width * 0.5) / S.texel - 0.5;
    const fy = (ly + S.height * 0.5) / S.texel - 0.5;
    if (fx < 0 || fy < 0 || fx > S.fw - 1.001 || fy > S.fh - 1.001) {
      const ex = Math.max(Math.abs(lx) - S.width * 0.5, 0);
      const ey = Math.max(Math.abs(ly) - S.height * 0.5, 0);
      return SDF_MARGIN + Math.hypot(ex, ey);
    }
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const F = S.field;
    const i = y0 * S.fw + x0;
    const a = F[i] + (F[i + 1] - F[i]) * tx;
    const b = F[i + S.fw] + (F[i + S.fw + 1] - F[i + S.fw]) * tx;
    return a + (b - a) * ty;
  }

  /** Normalna na zewnątrz poszycia (gradient pola) w punkcie świata. */
  sdfGradAt(wx, wy) {
    const e = this.sdf.texel;
    const gx = this.sdfAt(wx + e, wy) - this.sdfAt(wx - e, wy);
    const gy = this.sdfAt(wx, wy + e) - this.sdfAt(wx, wy - e);
    const l = Math.hypot(gx, gy) || 1;
    this._g.x = gx / l;
    this._g.y = gy / l;
    return this._g;
  }

  /** Duszki: blask dysz i smugi ciągu, lampy pozycyjne (scena względem ox, oy). */
  addGlows(glow, ox, oy, time) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const p = { x: 0, y: 0 };
    const th = this.thrust;
    const R = this.nozzleRadius;
    for (const n of this.nozzles) {
      this.nozzleWorld(n, p);
      const sx = p.x - ox;
      const sy = -(p.y - oy);
      const k = 0.35 + th * 1.2;
      glow.add(sx, sy, 4, R * (2.2 + th * 1.3), 0.7 * k, 2.1 * k, 3.6 * k, GLOW_ROUND);
      if (th > 0.02) {
        const len = R * (6 + th * 22);
        glow.add(sx - c * len * 0.45, sy + s * len * 0.45, 3, R * 1.6, 0.25 * th, 0.9 * th, 2.4 * th, GLOW_STREAK, -c, s, len / (R * 1.6));
      }
    }
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
