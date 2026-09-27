// dema/rakiety-webgpu/common.js
//
// Wspólne klocki dema rakiet — KOPIE z dema asteroid WebGPU (commit cb02194,
// dema/asteroidy-webgpu/{tslCommon,glowSprites,sky,surfaceLighting}.js), żeby
// demo było samowystarczalne (tamto demo jest równolegle przebudowywane):
//   • acesGame — tone mapping gry (uberPass Core3D, Narkowicz bez ÷0,6),
//   • GlowSprites — addytywne duszki blasku w jednym draw callu,
//   • Sky — gwiazdy i ciemna mgławica (bez zasłony pyłu pasa),
//   • SurfaceLightingModel — model światła kadłubów (Lambert z zawinięciem,
//     Blinn–Phong), przez który idą słońce i wszystkie światła siatki.

import * as THREE from 'three/webgpu';
import { LightingModel } from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, attribute, uv, uniform, screenCoordinate, floor, dot, exp,
  max, min, length, mix, smoothstep, clamp, hash, mx_fractal_noise_float, normalize, pow
} from 'three/tsl';

/** Tone mapping gry: dopasowanie ACES Narkowicza bez przeskalowania wejścia. */
export const acesGame = Fn(([c]) => {
  const x = max(c, vec3(0.0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
}).setLayout({ name: 'acesGame', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;

/**
 * Addytywne duszki blasku (jeden draw call). Instancja: A = (x, y, z, rozmiar)
 * w scenie, B = barwa HDR + kształt, C = kierunek i wydłużenie smugi. Kolor
 * premultiplied, alfa celu bez zmian (blask nie wycina dziur w tle).
 */
export class GlowSprites {
  constructor({ scene, capacity = 4096, renderOrder = 90 }) {
    this.capacity = capacity;
    this.count = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const at of [this.a, this.b, this.c]) at.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('gA', this.a);
    geo.setAttribute('gB', this.b);
    geo.setAttribute('gC', this.c);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.lights = false;
    mat.fog = false;
    const gA = attribute('gA', 'vec4');
    const gB = attribute('gB', 'vec4');
    const gC = attribute('gC', 'vec4');
    mat.positionNode = Fn(() => {
      const p = attribute('position', 'vec3').xy;
      const dir = gC.xy;
      const perp = vec2(dir.y.negate(), dir.x);
      const stretch = max(gC.z, 1.0);
      const local = dir.mul(p.x.mul(stretch)).add(perp.mul(p.y)).mul(gA.w);
      return vec3(gA.xy.add(local), gA.z);
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const r2 = q.dot(q);
      // Ostry rdzeń + miękka poświata gasnąca przed brzegiem kwadratu.
      const round = exp(r2.mul(-14.0)).add(exp(r2.mul(-3.5)).mul(0.18)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
      const along = q.x.mul(0.5).add(0.5);
      const streak = exp(q.y.mul(q.y).mul(-9.0)).mul(along.mul(along)).mul(float(1.0).sub(smoothstep(0.85, 1.0, length(q))));
      const shape = mix(round, streak, clamp(gB.w, 0.0, 1.0));
      return vec4(gB.rgb.mul(shape), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'glowSprites';
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  add(x, y, z, size, r, g, b, shape = GLOW_ROUND, dirX = 1, dirY = 0, stretch = 1) {
    if (this.count >= this.capacity || !(size > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = size;
    B[o] = r; B[o + 1] = g; B[o + 2] = b; B[o + 3] = shape;
    const l = Math.hypot(dirX, dirY) || 1;
    C[o] = dirX / l; C[o + 1] = dirY / l; C[o + 2] = stretch; C[o + 3] = 0;
  }

  commit() {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const at of [this.a, this.b, this.c]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}

/** Tło: gwiazdy (komórki 7 px) i ciemna, chłodna mgławica; wolna paralaksa. */
export class Sky {
  constructor(scene) {
    this.u = {
      offset: uniform(new THREE.Vector2()),
      starGain: uniform(1),
      nebula: uniform(1)
    };
    const U = this.u;
    const mat = new THREE.NodeMaterial();
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.lights = false;
    mat.fog = false;
    mat.vertexNode = Fn(() => {
      const p = attribute('position', 'vec3');
      return vec4(p.xy, 0.5, 1.0);
    })();
    mat.fragmentNode = Fn(() => {
      const px = screenCoordinate.xy.add(U.offset).toVar();
      const cellSize = 7.0;
      const cell = floor(px.div(cellSize)).toVar();
      const s = cell.x.add(cell.y.mul(4099.0)).add(1.0e6).toUint().toVar();
      const h1 = hash(s);
      const h2 = hash(s.bitXor(uint(0x68E31DA4)));
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const starPos = cell.add(vec2(h2, h3).mul(0.8).add(0.1)).mul(cellSize);
      const d = px.sub(starPos);
      const r2 = dot(d, d);
      // Rzadziej i ciemniej niż w demie asteroid (tu tło nie ma zasłony pyłu).
      const bright = smoothstep(0.972, 1.0, h1).mul(h1.mul(h1).mul(h1)).mul(0.7);
      const tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h4);
      const star = tint.mul(bright).mul(exp(r2.mul(-0.9)).mul(1.4).add(exp(r2.mul(-0.12)).mul(0.08)));
      const q = px.div(900.0);
      const neb = mx_fractal_noise_float(vec3(q, 0.37), 4, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const neb2 = mx_fractal_noise_float(vec3(q.mul(2.3).add(5.1), 1.7), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const nebula = vec3(0.012, 0.013, 0.021).mul(smoothstep(0.35, 0.8, neb)).add(vec3(0.008, 0.004, 0.011).mul(smoothstep(0.45, 0.9, neb2)));
      return vec4(max(star.mul(U.starGain).add(nebula.mul(U.nebula)).add(vec3(0.003, 0.0035, 0.005)), vec3(0.0)), 1.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
  }
}

/**
 * Model światła powierzchni kadłubów: Lambert z zawinięciem, Blinn–Phong.
 * Jednostki gry (światło = barwa × moc, bez 1/π). Słońce mnożone przez sunVis.
 */
export class SurfaceLightingModel extends LightingModel {
  constructor(s) {
    super();
    this.s = s;
  }

  direct({ lightDirection, lightColor, reflectedLight, lightNode }) {
    const s = this.s;
    const isSun = !!(lightNode && lightNode.light && lightNode.light.isDirectionalLight === true);
    const L = lightDirection;
    const NdotL = dot(s.N, L).toVar();
    const mu0 = max(NdotL, 0.0).toVar();
    const lambert = clamp(NdotL.add(s.wrap).div(s.wrap.add(1.0)), 0.0, 1.0);
    const c = (isSun ? lightColor.mul(s.sunVis) : lightColor).toVar();
    reflectedLight.directDiffuse.addAssign(s.diffAlbedo.mul(c).mul(lambert));
    const ndh = max(dot(s.N, normalize(L.add(s.V))), 0.0).toVar();
    const spec = pow(ndh, s.gloss).mul(isSun ? s.specK : s.specK.add(0.03));
    reflectedLight.directSpecular.addAssign(c.mul(s.specTint.mul(spec)).mul(mu0));
  }

  indirect() {
    // Otoczenie liczy materiał (emisja).
  }
}

export { min };
