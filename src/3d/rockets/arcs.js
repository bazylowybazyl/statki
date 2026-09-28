// src/3d/rockets/arcs.js
//
// Cienkie świecące odcinki (port z dema dema/rakiety-webgpu/arcs.js, zadanie 19): łuki
// wyładowań w zjonizowanym śladzie supernowej (łamana z przemieszczeniem środków +
// odgałęzienia) i linia anamorficzna błysku detonacji. Grubość w PIKSELACH (rdzeń ~1–2 px,
// poświata kilka px), więc nad progiem bloomu zostaje tylko cienka linia (plan pasm HDR).
// Pierścień 8192 odcinków, każdy z własnym życiem i migotaniem (wysyłka: ringUpload.js).
//
// Pozycje lokalne względem początku pul Core3D (przeskok przesuwa żywe na CPU), czasy
// w zegarze reżysera rakiet względem jego epoki (`timeLocal`). Łamana liczona w
// buforach roboczych (bez alokacji na łuk — demo tworzyło tablice punktów).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry,
  select, mix, smoothstep, clamp, exp, sin, max, length, abs
} from 'three/tsl';
import { ringAttr, RingUpload } from './ringUpload.js';
import { fillRandom } from './rand.js';

export const ARC_CAP = 8192;
const MAX_PTS = 17;   // głębokość 4: 2 → 17 punktów

export class ArcSystem {
  constructor({ scene, origin, capacity = ARC_CAP, renderOrder = 80 }) {
    this.capacity = capacity;
    this.origin = origin;
    this.head = 0;
    this.highWater = 0;
    this.liveUntil = -Infinity;   // zegar reżysera (lokalny)
    this.upload = new RingUpload(capacity);
    // Styl odcinków (wpis roboczy _segFrom): czas, życie, grubości [px], barwy, z, migotanie.
    this.s = { time: 0, life: 0, corePx: 0, glowPx: 0, cr: 0, cg: 0, cb: 0, gr: 0, gg: 0, gb: 0, z: 0, flicker: 0 };
    this._ptsA = new Float64Array(MAX_PTS * 2);
    this._rnd = new Float64Array(16);
    this._ptsB = new Float64Array(MAX_PTS * 2);
    this.U = { time: uniform(0), zoom: uniform(1), gain: uniform(1) };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a0 = ringAttr(capacity, 4); this.a1 = ringAttr(capacity, 4); this.a2 = ringAttr(capacity, 4); this.a3 = ringAttr(capacity, 4);
    this._attrs = [this.a0, this.a1, this.a2, this.a3];
    geo.setAttribute('ar0', this.a0); // a.xy, b.xy (lokalnie)
    geo.setAttribute('ar1', this.a1); // t0, życie, rdzeń [px], poświata [px]
    geo.setAttribute('ar2', this.a2); // barwa rdzenia (rgb HDR), z
    geo.setAttribute('ar3', this.a3); // barwa poświaty (rgb), migotanie 0..1
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vRkArA'); // across [px], rdzeń, poświata, wiek/życie
    const vB = varyingProperty('vec4', 'vRkArB'); // along 0..1, migotanie, t0, —
    const vCore = varyingProperty('vec3', 'vRkArCore');
    const vGlow = varyingProperty('vec3', 'vRkArGlow');
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketArcs';
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
      const along = clamp(vB.x, 0.0, 1.0);
      const ends = smoothstep(0.0, 0.06, along).mul(float(1.0).sub(smoothstep(0.94, 1.0, along)));
      const c = vCore.mul(core).add(vGlow.mul(glow)).mul(fade).mul(strobe).mul(ends.mul(0.6).add(0.4));
      return vec4(c.mul(U.gain), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketArcs';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    const sys = this;
    this.originEntry = origin.register({
      isLive: () => sys.highWater > 0,
      onRebase: (dx, dy) => sys._rebase(dx, dy)
    });
  }

  _rebase(dx, dy) {
    const n = this.highWater;
    if (!n) return;
    const A = this.a0.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      A[o] += dx; A[o + 1] += dy; A[o + 2] += dx; A[o + 3] += dy;
    }
    this.upload.markAll();
  }

  /**
   * Odcinek: punkty ŚWIATA gry z tablicy `P` od indeksu `k` (ax, ay, bx, by — double →
   * lokalne przy zapisie), styl z wpisu roboczego `this.s` (czas, życie, grubości, barwy, z,
   * migotanie). Bez liczb w argumentach — łuk pisze kilkadziesiąt odcinków naraz, a V8
   * opakowuje każdą liczbę zmiennoprzecinkową niewklejonego wywołania.
   */
  _segFrom(P, k) {
    const st = this.s;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const o = i * 4;
    const ox = this.origin.x;
    const oy = this.origin.y;
    const A = this.a0.array; const B = this.a1.array; const C = this.a2.array; const D = this.a3.array;
    A[o] = P[k] - ox; A[o + 1] = -P[k + 1] - oy; A[o + 2] = P[k + 2] - ox; A[o + 3] = -P[k + 3] - oy;
    B[o] = st.time; B[o + 1] = st.life; B[o + 2] = st.corePx; B[o + 3] = st.glowPx;
    C[o] = st.cr; C[o + 1] = st.cg; C[o + 2] = st.cb; C[o + 3] = st.z;
    D[o] = st.gr; D[o + 1] = st.gg; D[o + 2] = st.gb; D[o + 3] = st.flicker;
    this.upload.touch(i);
    if (i + 1 > this.highWater) this.highWater = i + 1;
    const end = st.time + st.life;
    if (end > this.liveUntil) this.liveUntil = end;
  }

  _style(time, life, corePx, glowPx, core, coreK, glow, z, flicker) {
    const st = this.s;
    st.time = time; st.life = life; st.corePx = corePx; st.glowPx = glowPx;
    st.cr = core[0] * coreK; st.cg = core[1] * coreK; st.cb = core[2] * coreK;
    st.gr = glow[0]; st.gg = glow[1]; st.gb = glow[2]; st.z = z; st.flicker = flicker;
  }

  /** Prosta linia (błysk anamorficzny) — punkty świata, czas lokalny reżysera. */
  line(time, ax, ay, bx, by, life, corePx, glowPx, core, glow, z) {
    this._style(time, life, corePx, glowPx, core, 1, glow, z, 0);
    const P = this._ptsA;
    P[0] = ax; P[1] = ay; P[2] = bx; P[3] = by;
    this._segFrom(P, 0);
  }

  /**
   * Łuk wyładowania między punktami ŚWIATA: łamana z przemieszczeniem środków (głębokość
   * 4 → 16 odcinków) i 0–2 odgałęzienia. rng — generator efektów (fxRandom).
   */
  bolt(time, ax, ay, bx, by, rng, life = 0.09, branches = 1, jag = 0.22, corePx = 1.1, glowPx = 4, core = BOLT_CORE, glow = BOLT_GLOW, z = 60) {
    let src = this._ptsA;
    let dst = this._ptsB;
    src[0] = ax; src[1] = ay; src[2] = bx; src[3] = by;
    let n = 2;
    const ex0 = bx - ax;
    const ey0 = by - ay;
    const L0 = Math.sqrt(ex0 * ex0 + ey0 * ey0);
    let len = L0;
    const R = this._rnd;
    for (let depth = 0; depth < 4; depth++) {
      let w = 0;
      dst[w++] = src[0]; dst[w++] = src[1];
      fillRandom(rng, R, n - 1);
      for (let k = 0; k < n - 1; k++) {
        const x0 = src[k * 2]; const y0 = src[k * 2 + 1];
        const x1 = src[k * 2 + 2]; const y1 = src[k * 2 + 3];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const off = (R[k] - 0.5) * 2 * jag * len;
        const l = Math.sqrt(dx * dx + dy * dy) || 1;
        dst[w++] = (x0 + x1) * 0.5 - dy / l * off;
        dst[w++] = (y0 + y1) * 0.5 + dx / l * off;
        dst[w++] = x1; dst[w++] = y1;
      }
      n = w >> 1;
      const t = src; src = dst; dst = t;
      len *= 0.5;
    }
    this._style(time, life, corePx, glowPx, core, 1, glow, z, 1);
    for (let k = 0; k < n - 1; k++) this._segFrom(src, k * 2);
    // Odgałęzienia: 5 punktów w wolnym buforze (dst), słabsze i krótsze.
    this._style(time, life * 0.8, corePx * 0.7, glowPx * 0.7, core, 0.6, glow, z, 1);
    for (let b = 0; b < branches; b++) {
      fillRandom(rng, R, 12);
      const k = 3 + Math.floor(R[0] * (n - 6));
      if (k < 1 || k >= n - 1) continue;
      const sx = src[k * 2];
      const sy = src[k * 2 + 1];
      const bl = (L0 || 1) * (0.18 + R[1] * 0.2);
      const ang = Math.atan2(ey0, ex0) + (R[2] < 0.5 ? -1 : 1) * (0.5 + R[3] * 0.6);
      const ex = sx + Math.cos(ang) * bl;
      const ey = sy + Math.sin(ang) * bl;
      dst[0] = sx; dst[1] = sy;
      for (let q = 1; q <= 4; q++) {
        const u = q / 4;
        dst[q * 2] = sx + (ex - sx) * u + (R[2 + q * 2] - 0.5) * bl * 0.25;
        dst[q * 2 + 1] = sy + (ey - sy) * u + (R[3 + q * 2] - 0.5) * bl * 0.25;
      }
      for (let q = 0; q < 4; q++) this._segFrom(dst, q * 2);
    }
  }

  _flush() {
    this.upload.flush(this._attrs, this.highWater);
  }

  /** Czas lokalny reżysera, zoom kamery, początek pul (scena). */
  update(time, zoom, ox, oy) {
    this.U.time.value = time;
    this.U.zoom.value = zoom;
    this._flush();
    if (this.highWater > 0 && time > this.liveUntil + 0.2) {
      this.highWater = 0;
      this.head = 0;
      this.liveUntil = -Infinity;
    }
    this.geo.instanceCount = this.highWater;
    this.mesh.visible = this.highWater > 0;
    if (this.highWater > 0) {
      const m = this.mesh;
      m.position.set(ox, oy, 0);
      m.updateMatrix();
      m.matrixWorld.copy(m.matrix);
    }
  }

  /** Przesunięcie czasów żywych odcinków po przeskoku epoki reżysera (dT = stara − nowa). */
  shiftTime(dT) {
    const n = this.highWater;
    if (!n) return;
    const B = this.a1.array;
    for (let i = 0; i < n; i++) B[i * 4] += dT;
    this.liveUntil += dT;
    this.upload.markAll();
  }

  get live() { return this.highWater > 0; }

  clear() {
    this.highWater = 0;
    this.head = 0;
    this.liveUntil = -Infinity;
    this.upload.reset();
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }
}

const BOLT_CORE = Object.freeze([5.5, 3.2, 6.5]);
const BOLT_GLOW = Object.freeze([0.9, 0.2, 1.1]);
