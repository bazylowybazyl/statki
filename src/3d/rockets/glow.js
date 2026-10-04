// src/3d/rockets/glow.js
//
// Addytywne duszki blasku efektów rakiet (port `GlowSprites` z dema rakiet, common.js —
// kopia z dema asteroid; zadanie 19): jeden draw call. Instancja: A = (x, y, z, rozmiar)
// lokalnie względem początku pul Core3D, B = barwa HDR + kształt (0 okrąg, 1 smuga),
// C = kierunek i wydłużenie smugi. Kolor premultiplied, alfa celu bez zmian (blask nie
// wycina dziur w tle). Przepisywane co klatkę po origin.update.

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, uv, max, exp, mix, smoothstep, clamp, length } from 'three/tsl';

export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;

function liveAttr(capacity) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  at.setUsage(THREE.DynamicDrawUsage);
  const range = { start: 0, count: 4 };
  at.updateRanges.length = 0;
  at.updateRanges.push(range);
  at.clearUpdateRanges = () => {};
  at.__range = range;
  return at;
}

export class GlowSprites {
  constructor({ scene, capacity = 4096, renderOrder = 90 }) {
    this.capacity = capacity;
    this.count = 0;
    // Wpis roboczy dla push(): wołający wypełnia pola i woła push() — w pętlach klatki bez
    // przekazywania liczb zmiennoprzecinkowych przez argumenty (V8 opakowuje je w obiekty
    // przy wywołaniu, którego nie wklei; add(...) zostaje dla wywołań rzadkich).
    this.s = { x: 0, y: 0, z: 0, size: 0, r: 0, g: 0, b: 0, dx: 1, dy: 0, stretch: 1 };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a = liveAttr(capacity);
    this.b = liveAttr(capacity);
    this.c = liveAttr(capacity);
    this._attrs = [this.a, this.b, this.c];
    geo.setAttribute('rgA', this.a);
    geo.setAttribute('rgB', this.b);
    geo.setAttribute('rgC', this.c);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketGlow';
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
    const gA = attribute('rgA', 'vec4');
    const gB = attribute('rgB', 'vec4');
    const gC = attribute('rgC', 'vec4');
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
    this.mesh.name = 'RocketGlow';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /** Duszek LOKALNIE (x, y, z), rozmiar [j.], barwa HDR, kształt, kierunek i wydłużenie smugi. */
  add(x, y, z, size, r, g, b, shape = GLOW_ROUND, dirX = 1, dirY = 0, stretch = 1) {
    if (this.count >= this.capacity || !(size > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = size;
    B[o] = r; B[o + 1] = g; B[o + 2] = b; B[o + 3] = shape;
    const l = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    C[o] = dirX / l; C[o + 1] = dirY / l; C[o + 2] = stretch; C[o + 3] = 0;
  }

  /** Okrągły duszek z wpisu roboczego `s` (lokalnie x, y, z, rozmiar, barwa HDR). */
  push() {
    const s = this.s;
    if (this.count >= this.capacity || !(s.size > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    A[o] = s.x; A[o + 1] = s.y; A[o + 2] = s.z; A[o + 3] = s.size;
    B[o] = s.r; B[o + 1] = s.g; B[o + 2] = s.b; B[o + 3] = GLOW_ROUND;
    C[o] = 1; C[o + 1] = 0; C[o + 2] = 1; C[o + 3] = 0;
  }

  /**
   * Smuga z wpisu roboczego `s` (lokalnie x, y, z — środek; rozmiar = szerokość, barwa HDR,
   * kierunek (dx, dy) jednostkowy — jasny koniec po stronie +kierunku, wydłużenie = długość / szerokość).
   */
  pushStreak() {
    const s = this.s;
    if (this.count >= this.capacity || !(s.size > 0)) return;
    const i = this.count++;
    const o = i * 4;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    A[o] = s.x; A[o + 1] = s.y; A[o + 2] = s.z; A[o + 3] = s.size;
    B[o] = s.r; B[o + 1] = s.g; B[o + 2] = s.b; B[o + 3] = GLOW_STREAK;
    C[o] = s.dx; C[o + 1] = s.dy; C[o + 2] = s.stretch; C[o + 3] = 0;
  }

  commit(ox, oy) {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const m = this.mesh;
    m.position.set(ox, oy, 0);
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
    const A = this._attrs;
    for (let k = 0; k < A.length; k++) {
      A[k].__range.start = 0;
      A[k].__range.count = n * 4;
      A[k].needsUpdate = true;
    }
  }
}
