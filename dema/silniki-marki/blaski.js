// dema/silniki-marki/blaski.js
//
// Blaski (poświata wylotu, błysk zapłonu, kula ładowania warpa) i ISKRY dema marek silników.
// Blaski: addytywne kwady na instancjach w jednym rysunku — okrągłe zwrócone do kamery albo smugi obracane wokół
// własnego kierunku (jak struga). Iskry: mała pula CPU (pierścień), rysowana tymi samymi kwadami jako smugi.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, uv, positionGeometry, mix, smoothstep, clamp, exp, max, length, cross, normalize
} from 'three/tsl';

export const BLASK_KOLO = 0;
export const BLASK_SMUGA = 1;

export class Blaski {
  constructor({ scene, capacity = 4096, renderOrder = 80 }) {
    this.capacity = capacity;
    this.count = 0;
    this.U = {
      right: uniform(new THREE.Vector3(1, 0, 0)),
      up: uniform(new THREE.Vector3(0, 1, 0)),
      view: uniform(new THREE.Vector3(0, 0, -1))
    };
    const U = this.U;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.data = new Float32Array(capacity * 12);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, 12, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('bA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0)); // x, y, z, rozmiar
    geo.setAttribute('bB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4)); // rgb HDR, kształt
    geo.setAttribute('bC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8)); // kierunek xy, wydłużenie, —
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    const bA = attribute('bA', 'vec4');
    const bB = attribute('bB', 'vec4');
    const bC = attribute('bC', 'vec4');
    mat.positionNode = Fn(() => {
      const p = positionGeometry.xy;
      const dir3 = vec3(bC.xy, 0.0);
      const side = normalize(cross(dir3, U.view));
      const round = U.right.mul(p.x).add(U.up.mul(p.y));
      const streak = dir3.mul(p.x.mul(max(bC.z, 1.0))).add(side.mul(p.y));
      return bA.xyz.add(mix(round, streak, clamp(bB.w, 0.0, 1.0)).mul(bA.w));
    })();
    mat.fragmentNode = Fn(() => {
      const q = clamp(uv(), 0.0, 1.0).sub(0.5).mul(2.0);
      const r2 = q.dot(q);
      // Koło: ostry środek + miękka poświata, gaśnie przed brzegiem kwadu.
      const round = exp(r2.mul(-14.0)).add(exp(r2.mul(-3.5)).mul(0.18)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
      // Smuga: jasna głowa z przodu (q.x = +1), ogon gaśnie.
      const along = q.x.mul(0.5).add(0.5);
      const streak = exp(q.y.mul(q.y).mul(-9.0)).mul(along.mul(along)).mul(float(1.0).sub(smoothstep(0.85, 1.0, length(q))));
      const shape = mix(round, streak, clamp(bB.w, 0.0, 1.0));
      return vec4(max(bB.rgb.mul(shape), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'blaski';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  add(x, y, z, size, r, g, b, shape = BLASK_KOLO, dirX = 1, dirY = 0, stretch = 1) {
    if (this.count >= this.capacity || !(size > 0)) return;
    const o = this.count++ * 12;
    const d = this.data;
    const l = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = shape;
    d[o + 8] = dirX / l; d[o + 9] = dirY / l; d[o + 10] = stretch; d[o + 11] = 0;
  }

  commit(camera) {
    const e = camera.matrixWorld.elements;
    this.U.right.value.set(e[0], e[1], e[2]);
    this.U.up.value.set(e[4], e[5], e[6]);
    this.U.view.value.set(-e[8], -e[9], -e[10]);
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, n * 12);
    this.buffer.needsUpdate = true;
  }
}

const ISKRA_POLA = 12; // x, y, z, vx, vy, życie, życie0, rozmiar, r, g, b, rodzaj

/**
 * Iskry: rodzaj 0 — wylatują z dyszy i gasną; rodzaj 1 — zbiegają się DO dyszy (ładowanie warpa) i jaśnieją
 * przed końcem życia.
 */
export class Iskry {
  constructor(capacity = 3072) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * ISKRA_POLA);
    this.head = 0;
    this.alive = 0;
    this._seed = 0x2545f491;
  }

  /** Losowość obrazu dema z własnego ciągu (nie Math.random). */
  rnd() {
    let s = this._seed | 0;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this._seed = s;
    return ((s >>> 0) % 1000003) / 1000003;
  }

  emit(x, y, z, vx, vy, life, size, r, g, b, kind = 0) {
    const o = this.head * ISKRA_POLA;
    this.head = (this.head + 1) % this.capacity;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy;
    d[o + 5] = life; d[o + 6] = life; d[o + 7] = size; d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = kind;
  }

  update(dt) {
    const d = this.data;
    const drag = Math.exp(-1.1 * dt);
    let alive = 0;
    for (let i = 0, o = 0; i < this.capacity; i++, o += ISKRA_POLA) {
      if (!(d[o + 5] > 0)) continue;
      d[o + 5] -= dt;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      if (d[o + 11] < 0.5) { d[o + 3] *= drag; d[o + 4] *= drag; }
      alive++;
    }
    this.alive = alive;
  }

  draw(blaski) {
    const d = this.data;
    for (let i = 0, o = 0; i < this.capacity; i++, o += ISKRA_POLA) {
      const life = d[o + 5];
      if (!(life > 0)) continue;
      const k = life / d[o + 6];
      const inward = d[o + 11] > 0.5;
      const a = inward ? (1 - k) * (1 - k) * 1.4 + 0.1 : k * k;
      const vx = d[o + 3];
      const vy = d[o + 4];
      const sp = Math.sqrt(vx * vx + vy * vy);
      const size = d[o + 7];
      const stretch = 1 + Math.min(9, sp * 0.02 / Math.max(size, 0.5));
      if (sp > 1e-3) blaski.add(d[o], d[o + 1], d[o + 2], size, d[o + 8] * a, d[o + 9] * a, d[o + 10] * a, BLASK_SMUGA, vx, vy, stretch);
      else blaski.add(d[o], d[o + 1], d[o + 2], size, d[o + 8] * a, d[o + 9] * a, d[o + 10] * a, BLASK_KOLO);
    }
  }

  clear() {
    this.data.fill(0);
    this.alive = 0;
  }
}
