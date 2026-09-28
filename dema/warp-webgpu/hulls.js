// dema/warp-webgpu/hulls.js
//
// Kadłuby dema warpa: kwad z tekstury sprite'a gry (alfa = sylwetka),
// oświetlony prosto (normalna z gradientu luminancji, słońce + otoczenie).
// Do tego trzy rzeczy warpa, wszystkie w jednym materiale TSL:
//   • ODSŁANIANIE frontem — przy wyjściu z warpa widać tylko część kadłuba
//     przed linią frontu (rzeczywistość prostuje się od dziobu ku rufie),
//     przy odlocie kadłub znika od dziobu (dziób pierwszy wchodzi w bańkę);
//   • SZEW — cienka gorąca linia w miejscu frontu (tylko na sylwetce);
//   • ŻAR BRZEGU — pole odległości sylwetki (transformata odległości z kanału
//     alfa, raz na CPU): świeci pas przy krawędzi, biel → pomarańcz → wiśnia;
//   • SMUGA SYLWETKI — przy wypadnięciu z tunelu (i wejściu w niego) za
//     okrętem ciągnie się rozciągnięta kopia sylwetki w barwie plazmy
//     (propozycja 1, warpFx3D._drawSmear).
// Dysze MAIN z danych edytora (engines.main) i promień z engineFx — jak w grze.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, texture, uv, max, min, mix, dot, normalize, clamp,
  smoothstep, fwidth, exp, abs
} from 'three/tsl';
import { getHullRenderSize } from '../../src/data/ships.js';
import { buildEntityEngineFx, WARP_PLASMA_PALETTES } from '../../src/data/engineFx.js';

const SDF_RES = 256;
const SDF_MARGIN_K = 0.08;

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
 * Pole odległości sylwetki [j.] w lokalnym układzie kadłuba (x = dziób,
 * y = w górę sceny), R16F. Ujemne w środku kadłuba.
 */
function buildHullSdf(img, hullW, hullH) {
  const margin = Math.max(hullW, hullH) * SDF_MARGIN_K;
  const worldW = hullW + margin * 2;
  const worldH = hullH + margin * 2;
  const texel = worldW / SDF_RES;
  const w = SDF_RES;
  const h = Math.max(8, Math.round(worldH / texel));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.clearRect(0, 0, w, h);
  cx.drawImage(img, margin / texel, margin / texel, hullW / texel, hullH / texel);
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
  const data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y; // wiersz 0 płótna = góra sprite'a = +y sceny
    for (let x = 0; x < w; x++) {
      const i = sy * w + x;
      const d = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) * texel;
      data[y * w + x] = THREE.DataUtils.toHalfFloat(d);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, width: worldW, height: worldH };
}

function hexLin(hex) {
  const c = new THREE.Color();
  c.setHex(hex);
  return [c.r, c.g, c.b];
}

/** Barwy plazmy WARP z palety gry (liniowo): ciało, rdzeń, poświata. */
export function warpPalette(id) {
  const pal = WARP_PLASMA_PALETTES.find((p) => p.id === id) || WARP_PLASMA_PALETTES[0];
  return {
    id: pal.id,
    core: hexLin(pal.core[0]),
    body: hexLin(pal.body[2]),
    outer: hexLin(pal.outer[1]),
    glow: hexLin(pal.glow[1])
  };
}

/** Żar kadłuba: 1 = biel, 0,55 = pomarańcz, 0,25 = wiśnia (liniowo, HDR). */
export function heatColor(h, out) {
  const k = Math.max(0, Math.min(1, h));
  // Barwa ciała doskonale czarnego w uproszczeniu: czerwień rośnie pierwsza.
  const r = Math.min(1, k * 2.4);
  const g = Math.max(0, Math.min(1, (k - 0.28) * 1.7));
  const b = Math.max(0, Math.min(1, (k - 0.62) * 2.2));
  const I = k * k * 1.5 + k * 0.25;
  out[0] = r * I;
  out[1] = g * g * I;
  out[2] = b * b * I * 0.9;
  return out;
}

class HullNodeMaterial extends THREE.NodeMaterial {
  static get type() { return 'WarpHullNodeMaterial'; }

  constructor({ map, sdf, hullW, hullH, texW, texH, sdfW, sdfH }) {
    super();
    this.lights = false;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = false;
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = THREE.OneFactor;
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.u = {
      sunLocal: uniform(new THREE.Vector3(0.4, 0.3, 0.86)),
      sunCol: uniform(new THREE.Vector3(1.12, 1.06, 0.98)),
      ambient: uniform(new THREE.Vector3(0.12, 0.13, 0.16)),
      revealLine: uniform(-1e6),   // lokalne x frontu [j.]
      revealMode: uniform(1),      // +1: widać x > linia (wyjście), −1: widać x < linia (odlot)
      seamLine: uniform(-1e6),     // lokalne x szwu [j.] (front przechodzący przez kadłub)
      seam: uniform(new THREE.Vector3()),
      seamW: uniform(12),
      heat: uniform(new THREE.Vector3()),
      heatW: uniform(30),
      exposure: uniform(1)
    };
    const U = this.u;
    this.fragmentNode = Fn(() => {
      const tuv = uv();
      const tex = texture(map, tuv).toVar();
      tex.a.lessThanEqual(0.02).discard();
      const alpha = smoothstep(float(0.5).sub(fwidth(tex.a).mul(0.75)), float(0.5).add(fwidth(tex.a).mul(0.75)), tex.a).toVar();
      // Normalna z gradientu luminancji (relief paneli).
      const du = 1.5 / texW;
      const dv = 1.5 / texH;
      const lum = (t) => dot(texture(map, t).rgb, vec3(0.299, 0.587, 0.114));
      const hs = 7.0;
      const gx = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(hs / (2 * du * hullW));
      const gy = lum(tuv.add(vec2(0, dv))).sub(lum(tuv.sub(vec2(0, dv)))).mul(hs / (2 * dv * hullH));
      const nL = normalize(vec3(gx.negate(), gy.negate(), 1.0));
      const lam = max(dot(nL, U.sunLocal), 0.0);
      const albedo = tex.rgb.mul(0.9);
      const lit = albedo.mul(U.ambient.add(U.sunCol.mul(lam))).toVar();
      // Lokalne położenie [j.] (x = dziób).
      const lx = tuv.x.sub(0.5).mul(hullW).toVar();
      const ly = tuv.y.sub(0.5).mul(hullH).toVar();
      const edge = max(fwidth(lx), 0.5).mul(1.5);
      const vis = smoothstep(edge.negate(), edge, lx.sub(U.revealLine).mul(U.revealMode)).toVar();
      // Szew: cienka linia w miejscu frontu, tylko na sylwetce.
      const sx = lx.sub(U.seamLine).div(U.seamW);
      const seam = U.seam.mul(exp(sx.mul(sx).negate()));
      // Żar brzegu z pola odległości (d < 0 w środku).
      const suv = vec2(lx.div(sdfW), ly.div(sdfH)).add(0.5);
      const d = texture(sdf, suv).r;
      const rim = exp(max(d.negate(), 0.0).div(U.heatW).negate());
      const heat = U.heat.mul(rim.mul(rim).mul(0.85).add(rim.mul(0.15)));
      const col = lit.mul(U.exposure).add(heat).mul(vis).add(seam);
      return vec4(col.mul(alpha), alpha.mul(vis));
    })();
  }
}

/** Smuga sylwetki: kopia alfy sprite'a rozciągnięta wzdłuż kursu, addytywnie. */
function smearMaterial(map) {
  const u = { color: uniform(new THREE.Vector3(1, 0.5, 1)), k: uniform(0) };
  const mat = new THREE.NodeMaterial();
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.fragmentNode = Fn(() => {
    const t = uv();
    const a = texture(map, t).a;
    // Najjaśniej przy dziobie, gaśnie ku ogonowi smugi.
    const fade = t.x.mul(t.x).mul(t.x.mul(0.6).add(0.4));
    return vec4(u.color.mul(u.k).mul(a).mul(fade), 0.0);
  })();
  return { mat, u };
}

/** Typ kadłuba (raz na sprite): tekstura, rozmiar jak w grze, dysze, pole odległości. */
export class HullType {
  static async load({ id, profile, editorKey, url, editor }) {
    const img = await loadImage(url);
    const t = new HullType();
    t._init({ id, profile, editorKey, img, editor });
    return t;
  }

  _init({ id, profile, editorKey, img, editor }) {
    this.id = id;
    const size = getHullRenderSize(profile, img.naturalWidth, img.naturalHeight);
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
    this.sdf = buildHullSdf(img, size.w, size.h);
    this._matArgs = {
      map, sdf: this.sdf.texture, hullW: size.w, hullH: size.h,
      texW: img.naturalWidth, texH: img.naturalHeight, sdfW: this.sdf.width, sdfH: this.sdf.height
    };
    this.geometry = new THREE.PlaneGeometry(size.w, size.h);
    const fx = buildEntityEngineFx(editorKey, null, this.hpScale);
    this.nozzleRadius = fx.nozzleRadius || size.w * 0.0188;
    this.palette = warpPalette(fx.warpPalette);
    this.nozzles = (editor?.engines?.main || []).map((e) => ({ x: e.x * this.hpScale, y: e.y * this.hpScale }));
    if (!this.nozzles.length) this.nozzles.push({ x: -size.w * 0.48, y: 0 });
  }

  /** Nowy kadłub w scenie — własny materiał (odsłanianie, szew, żar). */
  createInstance(scene, name) {
    const material = new HullNodeMaterial(this._matArgs);
    material.u.seamW.value = Math.max(5, this.w * 0.007);
    material.u.heatW.value = Math.max(8, this.w * 0.011);
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.name = `hull_${name || this.id}`;
    mesh.visible = false;
    scene.add(mesh);
    const sm = smearMaterial(this._matArgs.map);
    const smear = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sm.mat);
    smear.frustumCulled = false;
    smear.renderOrder = 4;
    smear.visible = false;
    scene.add(smear);
    return { type: this, mesh, u: material.u, material, smear, smearU: sm.u };
  }
}

/**
 * Stan kadłuba → mesh i uniformy. s: { x, y, angle } (świat gry, y w dół),
 * reveal: { line (lokalne x), mode (+1/−1), on }, seam (0..1), heat (0..1).
 * ox, oy — kotwica kamery (świat gry); sun — kierunek słońca w scenie.
 */
export function syncHullInstance(inst, s, ox, oy, sun, seamCol) {
  const { mesh, u, type } = inst;
  syncSmear(inst, s, ox, oy);
  mesh.visible = s.visible !== false;
  if (!mesh.visible) return;
  mesh.position.set(s.x - ox, -(s.y - oy), 0);
  mesh.rotation.set(0, 0, -s.angle);
  mesh.updateMatrixWorld(true);
  const c = Math.cos(s.angle);
  const sn = Math.sin(s.angle);
  u.sunLocal.value.set(c * sun.x - sn * sun.y, sn * sun.x + c * sun.y, sun.z).normalize();
  const half = type.w * 0.5;
  if (s.revealMode) {
    u.revealMode.value = s.revealMode;
    u.revealLine.value = s.revealLine;
  } else {
    u.revealMode.value = 1;
    u.revealLine.value = -half * 4;
  }
  u.seamLine.value = Number.isFinite(s.seamLine) ? s.seamLine : -half * 4;
  const k = Math.max(0, s.seam || 0);
  u.seam.value.set(seamCol[0] * k, seamCol[1] * k, seamCol[2] * k);
  const hc = heatColor(s.heat || 0, _hc);
  u.heat.value.set(hc[0], hc[1], hc[2]);
}
const _hc = [0, 0, 0];

/** Smuga: s.smear (0..1), s.smearLen (długość całkowita w długościach kadłuba). */
function syncSmear(inst, s, ox, oy) {
  const { smear, smearU, type } = inst;
  const k = s.smear || 0;
  smear.visible = k > 0.01;
  if (!smear.visible) return;
  const L = type.w;
  const total = Math.max(1, s.smearLen || 1);
  const c = Math.cos(s.angle);
  const sn = Math.sin(s.angle);
  // Przód smugi przy dziobie, reszta za rufą.
  const bowX = s.x + c * L * 0.5;
  const bowY = s.y + sn * L * 0.5;
  const cx = bowX - c * L * total * 0.5;
  const cy = bowY - sn * L * total * 0.5;
  smear.position.set(cx - ox, -(cy - oy), -1);
  smear.rotation.set(0, 0, -s.angle);
  smear.scale.set(L * total, type.h, 1);
  smear.updateMatrixWorld(true);
  const pc = type.palette.body;
  smearU.color.value.set(pc[0], pc[1], pc[2]);
  smearU.k.value = 1.4 * k;
}
