// dema/rakiety-webgpu/arcs.js
//
// Cienkie świecące odcinki: łuki wyładowań w zjonizowanym śladzie supernowej
// (łamana z przemieszczeniem środków + odgałęzienia) i linia anamorficzna
// błysku detonacji. Grubość w PIKSELACH (rdzeń ~1–2 px, poświata kilka px),
// więc nad progiem bloomu zostaje tylko cienka linia (plan pasm HDR).
// Pierścień 8192 odcinków, każdy z własnym życiem i migotaniem.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, uv, varyingProperty, positionGeometry,
  select, mix, smoothstep, clamp, exp, sin, max, length, abs
} from 'three/tsl';

export const ARC_CAP = 8192;

export class ArcSystem {
  constructor({ scene, capacity = ARC_CAP, renderOrder = 80 }) {
    this.capacity = capacity;
    this.head = 0;
    this.highWater = 0;
    this.lastSpawn = -1e9;
    this.maxLife = 0;
    this._lo = Infinity;
    this._hi = -1;
    this.U = { time: uniform(0), zoom: uniform(1), gain: uniform(1) };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = () => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.a0 = mk(); this.a1 = mk(); this.a2 = mk(); this.a3 = mk();
    geo.setAttribute('ar0', this.a0); // a.xy, b.xy (scena)
    geo.setAttribute('ar1', this.a1); // t0, życie, rdzeń [px], poświata [px]
    geo.setAttribute('ar2', this.a2); // barwa rdzenia (rgb HDR), z
    geo.setAttribute('ar3', this.a3); // barwa poświaty (rgb), migotanie 0..1
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vArA'); // across [px], rdzeń, poświata, wiek/życie
    const vB = varyingProperty('vec4', 'vArB'); // along 0..1, migotanie, t0, —
    const vCore = varyingProperty('vec3', 'vArCore');
    const vGlow = varyingProperty('vec3', 'vArGlow');
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('ar0', 'vec4');
      const B = attribute('ar1', 'vec4');
      const C = attribute('ar2', 'vec4');
      const D = attribute('ar3', 'vec4');
      const age = U.time.sub(B.x);
      const alive = age.greaterThanEqual(0.0).and(age.lessThan(B.y));
      const d = A.zw.sub(A.xy).toVar();
      const L = max(length(d), 1e-3);
      const dir = d.div(L);
      const perp = vec2(dir.y.negate(), dir.x);
      const halfPx = B.w.mul(1.5).add(1.0);
      const halfW = halfPx.div(U.zoom);
      const q = positionGeometry.xy;
      // Przedłużenie o pół szerokości na końcach (zaokrąglenie łączeń łamanej).
      const along = q.x.add(0.5);
      const p = A.xy.add(dir.mul(along.mul(L.add(halfW.mul(2.0))).sub(halfW))).add(perp.mul(q.y.mul(2.0).mul(halfW)));
      vA.assign(vec4(q.y.mul(2.0).mul(halfPx), B.z, B.w, clamp(age.div(max(B.y, 1e-3)), 0.0, 1.0)));
      vB.assign(vec4(along, D.w, B.x, 0.0));
      vCore.assign(C.xyz);
      vGlow.assign(D.xyz);
      return select(alive, vec3(p, C.w), vec3(0.0, 0.0, -1e5));
    })();
    mat.fragmentNode = Fn(() => {
      const x = vA.x;
      const core = exp(x.div(max(vA.y, 0.3)).mul(x.div(max(vA.y, 0.3))).mul(-1.6));
      const glow = exp(abs(x).div(max(vA.z, 0.5)).mul(-2.2));
      const ageN = vA.w;
      const fade = float(1.0).sub(smoothstep(0.35, 1.0, ageN));
      // Migotanie wyładowania (stroboskop), tylko gdy włączone.
      const strobe = mix(float(1.0), sin(U.time.mul(95.0).add(vB.z.mul(311.0))).mul(0.45).add(0.55), vB.y);
      const ends = smoothstep(0.0, 0.06, vB.x).mul(float(1.0).sub(smoothstep(0.94, 1.0, vB.x)));
      const c = vCore.mul(core).add(vGlow.mul(glow)).mul(fade).mul(strobe).mul(ends.mul(0.6).add(0.4));
      return vec4(c.mul(U.gain), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'arcs';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  _seg(time, ax, ay, bx, by, life, corePx, glowPx, core, glow, z, flicker) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const o = i * 4;
    const A = this.a0.array; const B = this.a1.array; const C = this.a2.array; const D = this.a3.array;
    A[o] = ax; A[o + 1] = ay; A[o + 2] = bx; A[o + 3] = by;
    B[o] = time; B[o + 1] = life; B[o + 2] = corePx; B[o + 3] = glowPx;
    C[o] = core[0]; C[o + 1] = core[1]; C[o + 2] = core[2]; C[o + 3] = z;
    D[o] = glow[0]; D[o + 1] = glow[1]; D[o + 2] = glow[2]; D[o + 3] = flicker;
    if (i < this._lo) this._lo = i;
    if (i > this._hi) this._hi = i;
    if (this.head === 0) this._flush();
    if (i + 1 > this.highWater) this.highWater = i + 1;
    this.lastSpawn = time;
    if (life > this.maxLife) this.maxLife = life;
  }

  /** Prosta linia (błysk anamorficzny). */
  line(time, ax, ay, bx, by, { life = 0.5, corePx = 1.4, glowPx = 5, core = [8, 9, 10], glow = [0.4, 0.9, 1.2], z = 90 } = {}) {
    this._seg(time, ax, ay, bx, by, life, corePx, glowPx, core, glow, z, 0);
  }

  /**
   * Łuk wyładowania między punktami SCENY: łamana z przemieszczeniem środków
   * (głębokość 4 → 16 odcinków) i 0–2 odgałęzienia.
   */
  bolt(time, ax, ay, bx, by, { life = 0.09, jag = 0.22, corePx = 1.1, glowPx = 4, core = [5.5, 3.2, 6.5], glow = [0.9, 0.2, 1.1], z = 60, branches = 1, rng = Math.random } = {}) {
    const pts = [[ax, ay], [bx, by]];
    let len = Math.hypot(bx - ax, by - ay);
    for (let depth = 0; depth < 4; depth++) {
      const next = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k];
        const [x1, y1] = pts[k + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const off = (rng() - 0.5) * 2 * jag * len;
        const l = Math.hypot(dx, dy) || 1;
        next.push([(x0 + x1) * 0.5 - dy / l * off, (y0 + y1) * 0.5 + dx / l * off]);
        next.push(pts[k + 1]);
      }
      pts.length = 0;
      pts.push(...next);
      len *= 0.5;
    }
    for (let k = 0; k < pts.length - 1; k++) {
      this._seg(time, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], life, corePx, glowPx, core, glow, z, 1);
    }
    for (let b = 0; b < branches; b++) {
      const k = 3 + Math.floor(rng() * (pts.length - 6));
      if (k < 1 || k >= pts.length - 1) continue;
      const [sx, sy] = pts[k];
      const dx = bx - ax;
      const dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      const bl = l * (0.18 + rng() * 0.2);
      const ang = Math.atan2(dy, dx) + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6);
      const ex = sx + Math.cos(ang) * bl;
      const ey = sy + Math.sin(ang) * bl;
      let px = sx;
      let py = sy;
      for (let s = 1; s <= 4; s++) {
        const u = s / 4;
        const nx = sx + (ex - sx) * u + (rng() - 0.5) * bl * 0.25;
        const ny = sy + (ey - sy) * u + (rng() - 0.5) * bl * 0.25;
        this._seg(time, px, py, nx, ny, life * 0.8, corePx * 0.7, glowPx * 0.7, core.map((c) => c * 0.6), glow, z, 1);
        px = nx; py = ny;
      }
    }
  }

  _flush() {
    if (this._hi < this._lo) return;
    const s = this._lo * 4;
    const n = (this._hi - this._lo + 1) * 4;
    for (const at of [this.a0, this.a1, this.a2, this.a3]) {
      if (at.updateRanges.length > 32) { at.clearUpdateRanges(); at.addUpdateRange(0, at.array.length); } else at.addUpdateRange(s, n);
      at.needsUpdate = true;
    }
    this._lo = Infinity;
    this._hi = -1;
  }

  update(time, zoom) {
    this.U.time.value = time;
    this.U.zoom.value = zoom;
    this._flush();
    if (this.highWater > 0 && time - this.lastSpawn > this.maxLife + 0.2) {
      this.highWater = 0;
      this.head = 0;
      this.maxLife = 0;
    }
    this.geo.instanceCount = this.highWater;
    this.mesh.visible = this.highWater > 0;
  }
}
