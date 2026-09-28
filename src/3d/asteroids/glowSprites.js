// src/3d/asteroids/glowSprites.js
//
// Port dema/asteroidy-webgpu/glowSprites.js (zadanie 21): addytywne duszki blasku
// pola w passie gry (jeden draw call) — błyski i stygnący żar w miejscach uderzeń
// piorunów. Instancja: A = (x, y, z, rozmiar) względem początku pola (lokalnie),
// B = barwa HDR × jasność + kształt, C = kierunek (xy) i wydłużenie smugi. Kolor
// premultiplied, alfa zostaje (blend: kolor One/One, alfa Zero/One).
// Zmiana względem dema: stały zakres wysyłki atrybutów (bez alokacji na klatkę).

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, uv, exp, max, length, mix, smoothstep, clamp } from 'three/tsl';
import { permanentUpdateRange, markLiveRange } from './tslCommon.js';

export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;

export class GlowSprites {
  constructor({ parent, capacity = 2048, renderOrder = 20, layer = 0 }) {
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
    this._ranges = [this.a, this.b, this.c].map((at) => {
      at.setUsage(THREE.DynamicDrawUsage);
      return permanentUpdateRange(at);
    });
    geo.setAttribute('gA', this.a);
    geo.setAttribute('gB', this.b);
    geo.setAttribute('gC', this.c);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:glow';
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
    mat.premultipliedAlpha = false;
    mat.lights = false;
    mat.fog = false;
    const gA = attribute('gA', 'vec4');
    const gB = attribute('gB', 'vec4');
    const gC = attribute('gC', 'vec4');
    // Wierzchołki: kwadrat wzdłuż kierunku, wydłużony dla smugi.
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
      // Okrągły: ostry rdzeń + miękka poświata gasnąca przed brzegiem kwadratu.
      const round = exp(r2.mul(-14.0)).add(exp(r2.mul(-3.5)).mul(0.18)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
      // Smuga: jasna przy głowie (x = +1), zanik ku ogonowi, gauss w poprzek.
      const along = q.x.mul(0.5).add(0.5);
      const streak = exp(q.y.mul(q.y).mul(-9.0)).mul(along.mul(along)).mul(float(1.0).sub(smoothstep(0.85, 1.0, length(q))));
      const shape = mix(round, streak, clamp(gB.w, 0.0, 1.0));
      const col = gB.rgb.mul(shape);
      return vec4(col, 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'AsteroidBelt:glowSprites';
    this.mesh.layers.set(layer);
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Duszek (lokalnie): (x, y, z) środek, size [j.], barwa HDR (r, g, b). */
  add(x, y, z, size, r, g, b, shape = GLOW_ROUND, dirX = 1, dirY = 0, stretch = 1) {
    if (this.count >= this.capacity || !(size > 0)) return;
    const i = this.count++;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    const o = i * 4;
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
    markLiveRange(this.a, this._ranges[0], n * 4);
    markLiveRange(this.b, this._ranges[1], n * 4);
    markLiveRange(this.c, this._ranges[2], n * 4);
  }
}
