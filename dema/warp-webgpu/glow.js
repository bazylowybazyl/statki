// dema/warp-webgpu/glow.js
//
// Addytywne duszki blasku w passie gry (jeden draw call): dysze MAIN, plazma
// WARP, szew odsłaniania kadłuba (cienka linia), błyski. Na wzór
// dema/asteroidy-webgpu/glowSprites.js, z trzecim kształtem — LINIĄ.
// Kolor premultiplied, alfa zostaje (blend: kolor One/One, alfa Zero/One),
// więc blask nie wycina dziur w tle przy składaniu passów.
// Nad progiem bloomu (0,9) tylko cienkie linie i małe rdzenie (hdr-band-plan).

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, uv, exp, max, length, mix, smoothstep, clamp, select } from 'three/tsl';

export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;
export const GLOW_LINE = 2;

export class GlowSprites {
  constructor({ scene, capacity = 2048, renderOrder = 20 }) {
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
    mat.depthTest = false;
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
    // gA: xyz środek (scena), w rozmiar poprzeczny; gB: rgb HDR, w kształt;
    // gC: xy kierunek, z wydłużenie (długość / rozmiar), w miękkość końców linii.
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
      const round = exp(r2.mul(-14.0)).add(exp(r2.mul(-3.5)).mul(0.18)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
      const along = q.x.mul(0.5).add(0.5);
      const streak = exp(q.y.mul(q.y).mul(-9.0)).mul(along.mul(along)).mul(float(1.0).sub(smoothstep(0.85, 1.0, length(q))));
      // Linia: gauss w poprzek, miękkie końce (gC.w = udział końców w długości).
      const soft = max(gC.w, 0.02);
      const ends = smoothstep(1.0, float(1.0).sub(soft), q.x.abs());
      const line = exp(q.y.mul(q.y).mul(-10.0)).mul(ends);
      const shape = select(gB.w.lessThan(0.5), round, select(gB.w.lessThan(1.5), streak, line));
      return vec4(gB.rgb.mul(shape), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'warpGlow';
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Duszek w SCENIE: (x, y, z) środek, size [j.], barwa HDR (r, g, b). */
  add(x, y, z, size, r, g, b, shape = GLOW_ROUND, dirX = 1, dirY = 0, stretch = 1, soft = 0.2) {
    if (this.count >= this.capacity || !(size > 0)) return;
    if (!(r > 0.0005 || g > 0.0005 || b > 0.0005)) return;
    const i = this.count++;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    const o = i * 4;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = size;
    B[o] = r; B[o + 1] = g; B[o + 2] = b; B[o + 3] = shape;
    const l = Math.hypot(dirX, dirY) || 1;
    C[o] = dirX / l; C[o + 1] = dirY / l; C[o + 2] = stretch; C[o + 3] = soft;
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
