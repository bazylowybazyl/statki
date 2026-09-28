// dema/rakiety-webgpu/sparks.js
//
// Iskry wybuchów i odłamków — wygląd iskier broni z gry (src/3d/sparkSystem3D.js,
// user je lubi): smuga wzdłuż prędkości, biel → barwa iskry → stygnięcie do
// ciemnej czerwieni, migotanie w drugiej połowie życia, jasność 4 → 0,5.
// Tor analityczny z oporem: p = p0 + v0·(1 − e^(−k·t))/k + nośnik·t — iskra nie
// potrzebuje stanu na GPU. Pierścień 32 768 iskier, zapis zakresami atrybutów.
// Grubość i długość w j. świata z minimum w pikselach (dalekie zoomy).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, uv, varyingProperty, positionGeometry,
  select, mix, smoothstep, clamp, exp, sin, min, max, length, pow
} from 'three/tsl';

export const SPARK_CAP = 1 << 15;

export class SparkSystem {
  constructor({ scene, capacity = SPARK_CAP, renderOrder = 60 }) {
    this.capacity = capacity;
    this.head = 0;
    this.highWater = 0;
    this.lastSpawn = -1e9;
    this.maxLife = 0;
    this._dirtyLo = Infinity;
    this._dirtyHi = -1;
    this.U = {
      time: uniform(0),
      zoom: uniform(1),
      gain: uniform(1)
    };
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
    geo.setAttribute('sp0', this.a0);
    geo.setAttribute('sp1', this.a1);
    geo.setAttribute('sp2', this.a2);
    geo.setAttribute('sp3', this.a3);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vUv = varyingProperty('vec4', 'vSpA'); // wiek/życie, t0, jasność, —
    const vCol = varyingProperty('vec3', 'vSpCol');
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
      const A = attribute('sp0', 'vec4');
      const B = attribute('sp1', 'vec4');
      const C = attribute('sp2', 'vec4');
      const D = attribute('sp3', 'vec4');
      const age = U.time.sub(A.w).toVar();
      const life = B.w;
      const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
      const k = max(C.w, 0.01);
      const decay = exp(age.negate().mul(k));
      const travel = float(1.0).sub(decay).div(k);
      const pos = A.xyz.add(B.xyz.mul(travel)).add(vec3(C.xy.mul(age), 0.0));
      const vel = B.xy.mul(decay);
      const speed = length(vel).toVar();
      const fwd = select(speed.greaterThan(0.01), vel.div(max(speed, 0.01)), vec2(1.0, 0.0)).toVar();
      const right = vec2(fwd.y.negate(), fwd.x);
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      const vis = min(speed, 1400.0);
      const size = C.z;
      const pxMin = float(1.1).div(U.zoom);
      const thick = max(min(vis.mul(0.0012).add(3.0).mul(float(1.0).sub(ageN.mul(0.6))).mul(size), 9.0), pxMin);
      const len = max(min(vis.mul(0.018).add(12.0).mul(size), 95.0), pxMin.mul(2.5));
      const q = positionGeometry.xy;
      // Głowa (x = +0,5) w punkcie iskry, ogon za nią.
      const off = fwd.mul(q.x.sub(0.5).mul(len)).add(right.mul(q.y.mul(thick)));
      vUv.assign(vec4(ageN, A.w, D.w, 0.0));
      vCol.assign(D.xyz);
      return select(alive, vec3(pos.xy.add(off), pos.z), vec3(0.0, 0.0, -1e5));
    })();
    mat.fragmentNode = Fn(() => {
      const ageN = vUv.x;
      // MSAA ekstrapoluje UV poza trójkąt — clamp przed pow (NaN rozlałby bloom).
      const t = clamp(uv(), 0.0, 1.0);
      // Jasna głowa, zwężający się ogon; gauss w poprzek.
      const along = pow(max(t.x, 0.0), 1.3);
      const edge = pow(max(sin(t.y.mul(3.14159)), 0.0), 1.5);
      const inten = along.mul(edge).mul(float(1.0).sub(ageN.mul(ageN))).toVar();
      const flicker = sin(U.time.mul(60.0).add(vUv.y.mul(123.45))).mul(0.4).add(0.6);
      inten.mulAssign(mix(float(1.0), flicker, smoothstep(0.2, 0.8, ageN)));
      const white = vec3(1.0);
      const core = mix(white, vCol, 0.5);
      const cool = vec3(0.5, 0.1, 0.0);
      const dead = vec3(0.1, 0.02, 0.0);
      const c1 = mix(white, core, smoothstep(0.0, 0.1, ageN));
      const c2 = mix(c1, vCol, smoothstep(0.1, 0.3, ageN));
      const c3 = mix(c2, cool, smoothstep(0.3, 0.7, ageN));
      const col = mix(c3, dead, smoothstep(0.7, 1.0, ageN));
      const boost = mix(float(4.0), float(0.5), pow(ageN, 0.5));
      return vec4(col.mul(inten).mul(boost).mul(vUv.z).mul(U.gain), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'sparks';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Iskra (współrzędne SCENY). v — ruch własny, (cx, cy) — nośnik, size 0,12–0,9
   * (jak w grze), drag [1/s], barwa liniowa, gain — jasność serii.
   */
  emit(time, x, y, z, vx, vy, vz, life, size, drag, r, g, b, gain = 1, cx = 0, cy = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const o = i * 4;
    const A = this.a0.array; const B = this.a1.array; const C = this.a2.array; const D = this.a3.array;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = time;
    B[o] = vx; B[o + 1] = vy; B[o + 2] = vz; B[o + 3] = life;
    C[o] = cx; C[o + 1] = cy; C[o + 2] = size; C[o + 3] = drag;
    D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = gain;
    if (i < this._dirtyLo) this._dirtyLo = i;
    if (i > this._dirtyHi) this._dirtyHi = i;
    if (this.head === 0) this._flush();
    if (i + 1 > this.highWater) this.highWater = i + 1;
    this.lastSpawn = time;
    if (life > this.maxLife) this.maxLife = life;
  }

  _flush() {
    if (this._dirtyHi < this._dirtyLo) return;
    const s = this._dirtyLo * 4;
    const n = (this._dirtyHi - this._dirtyLo + 1) * 4;
    for (const at of [this.a0, this.a1, this.a2, this.a3]) {
      if (at.updateRanges.length > 32) { at.clearUpdateRanges(); at.addUpdateRange(0, at.array.length); } else at.addUpdateRange(s, n);
      at.needsUpdate = true;
    }
    this._dirtyLo = Infinity;
    this._dirtyHi = -1;
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
