// src/3d/rockets/sparks.js
//
// PULA ISKIER w scenie Core3D (port WebGPU, zadanie 19) — iskry z dema rakiet
// (dema/rakiety-webgpu/sparks.js — „w wyglądzie sparkSystem3D.js gry”, który użytkownik
// lubi): smuga wzdłuż prędkości, jasna głowa na końcu toru, biel → barwa iskry →
// stygnięcie do ciemnej czerwieni, migotanie w drugiej połowie życia, jasność 4 → 0,5.
// Jedna pula dla iskier trafień i tarcia (API SparkSystem3D gry) i iskier rakiet (wybuchy,
// odłamki, jony supernowej); barwa, jasność i opór PER ISKRA (dawny SparkSystem3D miał
// jedną globalną barwę — ostatni `burst(..., kolor)` przemalowywał wszystkie iskry).
//
// Tor analityczny, bez stanu na GPU:
//   p(T) = p0 + v0 · (1 − e^(−k·wiek)) / k + v_nośnika · (T_zegar − t0)
// — ruch własny z oporem k, NOŚNIK z zegarem gry (SimClock, agents.md § Nośnik:
// `fxCarrierOffset` z src/3d/fx/carrier.js) — iskra trafienia w pędzący kadłub leci z nim.
// Wiek z zegara efektów Core3D (`origin.timeFx` — biegnie też w pauzie, jak dawne iskry
// z ticku overlaya). Pozycje WZGLĘDEM początku pul Core3D (`mesh.position = początek`),
// czasy względem epok FxPoolOrigin; przeskok przesuwa żywe dane na CPU (`onRebase`).
// Pierścień 32 768 iskier, wysyłka tylko dotkniętego wycinka (ringUpload.js: zakresy na stałe,
// zawinięcie = dwa wycinki, bez alokacji).
// Bufory wierzchołków: pozycja, uv + 5 atrybutów = 7 (limit 8).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, uv, varyingProperty, positionGeometry,
  select, mix, smoothstep, clamp, exp, sin, min, max, length, sqrt, pow
} from 'three/tsl';
import { fxCarrierOffset } from '../fx/carrier.js';
import { ringAttr, RingUpload } from './ringUpload.js';

export const SPARK_CAP = 1 << 15;
/** Wysokość iskier nad płaszczyzną gry (scena) — nad dymem (10–16) i kadłubami (≈ 0). */
export const SPARK_Z = 34;
const STRIDE = 4;


export class SparkPool {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.scene
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin|null} o.origin początek pul i zegary
   *   (Core3D.fx.origin); bez niego (testy w Node) — pozycje świata, zegar wewnętrzny
   */
  constructor({ scene, origin = null, capacity = SPARK_CAP, renderOrder = 60 }) {
    this.capacity = capacity;
    this.origin = origin;
    this.head = 0;
    this.highWater = 0;
    this.liveUntil = -Infinity;    // zegar efektów (lokalny względem epoki)
    this.upload = new RingUpload(capacity);
    // Wpis roboczy dla push(): pętle klatki efektów rakiet wypełniają pola zamiast przekazywać
    // liczby przez argumenty (V8 opakowuje je w obiekty przy wywołaniu, którego nie wklei).
    this.s = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, drag: 0, r: 0, g: 0, b: 0, gain: 1, cvx: 0, cvy: 0, t0: 0, clock: 0 };
    this.fxTime = 0;               // bieżący zegar efektów względem epoki (ustawia update)
    this.stats = { emitted: 0 };
    this.U = { zoom: uniform(1), gain: uniform(1), z: uniform(SPARK_Z) };
    // Bez początku pul (Node): własne uniformy zegarów.
    this._timeFx = origin ? origin.timeFx : uniform(0);
    this._timeSim = origin ? origin.timeSim : uniform(0);
    this._timeRender = origin ? origin.timeRender : uniform(0);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a0 = ringAttr(capacity, STRIDE); // x, y (lokalnie), narodziny (zegar efektów − epoka), życie
    this.a1 = ringAttr(capacity, STRIDE); // vx, vy (scena, ruch własny), opór [1/s], rozmiar
    this.a2 = ringAttr(capacity, STRIDE); // barwa (liniowa), —
    this.a3 = ringAttr(capacity, STRIDE); // nośnik: vx, vy (scena), t0 − epoka gry, zegar (0 sim, 1 render)
    // Jasność serii osobnym atrybutem (jak dawny iGain — tests/collisionSparks.test.mjs).
    this.gain = ringAttr(capacity, 1);
    this._attrs = [this.a0, this.a1, this.a2, this.a3, this.gain];
    geo.setAttribute('sk0', this.a0);
    geo.setAttribute('sk1', this.a1);
    geo.setAttribute('sk2', this.a2);
    geo.setAttribute('sk3', this.a3);
    geo.setAttribute('iGain', this.gain);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const timeFx = this._timeFx;
    const timeSim = this._timeSim;
    const timeRender = this._timeRender;
    const vA = varyingProperty('vec4', 'vRkSpA'); // wiek/życie, narodziny, jasność, —
    const vCol = varyingProperty('vec3', 'vRkSpCol');
    const mat = new THREE.NodeMaterial();
    mat.name = 'SparkPool';
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
      const A = attribute('sk0', 'vec4');
      const B = attribute('sk1', 'vec4');
      const C = attribute('sk2', 'vec4');
      const D = attribute('sk3', 'vec4');
      const gain = attribute('iGain', 'float');
      const age = timeFx.sub(A.z).toVar();
      const life = A.w;
      const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
      const k = max(B.z, 0.01);
      const decay = exp(age.negate().mul(k));
      const travel = float(1.0).sub(decay).div(k);
      const pos = A.xy.add(B.xy.mul(travel)).add(fxCarrierOffset(D, timeSim, timeRender));
      const vel = B.xy.mul(decay);
      const speed = length(vel).toVar();
      const fwd = select(speed.greaterThan(0.01), vel.div(max(speed, 0.01)), vec2(1.0, 0.0)).toVar();
      const right = vec2(fwd.y.negate(), fwd.x);
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      const vis = min(speed, 1400.0);
      const size = B.w;
      const pxMin = float(1.1).div(U.zoom);
      const thick = max(min(vis.mul(0.0012).add(3.0).mul(float(1.0).sub(ageN.mul(0.6))).mul(size), 9.0), pxMin);
      const len = max(min(vis.mul(0.018).add(12.0).mul(size), 95.0), pxMin.mul(2.5));
      const q = positionGeometry.xy;
      // Głowa (x = +0,5) w punkcie iskry, ogon za nią.
      const off = fwd.mul(q.x.sub(0.5).mul(len)).add(right.mul(q.y.mul(thick)));
      vA.assign(vec4(ageN, A.z, gain, 0.0));
      vCol.assign(C.xyz);
      return select(alive, vec3(pos.add(off), U.z), vec3(0.0, 0.0, -1e5));
    })();
    mat.fragmentNode = Fn(() => {
      const ageN = clamp(vA.x, 0.0, 1.0);
      // MSAA ekstrapoluje UV poza trójkąt — clamp przed potęgami (ujemna podstawa pow = NaN,
      // który rozlałby bloom — pułapka z dema rakiet); kwadrat jako x·x.
      const t = clamp(uv(), 0.0, 1.0);
      const along = pow(t.x, 1.3);
      const edge = pow(max(sin(t.y.mul(3.14159)), 0.0), 1.5);
      const inten = along.mul(edge).mul(float(1.0).sub(ageN.mul(ageN))).toVar();
      const flicker = sin(timeFx.mul(60.0).add(vA.y.mul(123.45))).mul(0.4).add(0.6);
      inten.mulAssign(mix(float(1.0), flicker, smoothstep(0.2, 0.8, ageN)));
      const white = vec3(1.0);
      const core = mix(white, vCol, 0.5);
      const cool = vec3(0.5, 0.1, 0.0);
      const dead = vec3(0.1, 0.02, 0.0);
      const c1 = mix(white, core, smoothstep(0.0, 0.1, ageN));
      const c2 = mix(c1, vCol, smoothstep(0.1, 0.3, ageN));
      const c3 = mix(c2, cool, smoothstep(0.3, 0.7, ageN));
      const col = mix(c3, dead, smoothstep(0.7, 1.0, ageN));
      const boost = mix(float(4.0), float(0.5), sqrt(ageN));
      return vec4(col.mul(inten).mul(boost).mul(vA.z).mul(U.gain), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'SparkPool';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    if (origin) {
      const pool = this;
      this.originEntry = origin.register({
        isLive: () => pool.highWater > 0,
        onRebase: (dx, dy, dFx, dSim) => pool._rebase(dx, dy, dFx, dSim)
      });
    }
  }

  /**
   * Iskra (ŚWIAT gry): pozycja (x, y — double), ruch własny (vx, vy świata), życie [s],
   * rozmiar (0,12–0,9 jak w grze), opór [1/s], barwa liniowa (r, g, b), jasność serii,
   * nośnik (cvx, cvy świata, t0 — czas pozy nośnika w zegarze gry, clock — CLOCK_*).
   */
  emit(x, y, vx, vy, life, size, drag, r, g, b, gain = 1, cvx = 0, cvy = 0, t0 = 0, clock = 0) {
    const s = this.s;
    s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.life = life; s.size = size; s.drag = drag;
    s.r = r; s.g = g; s.b = b; s.gain = gain; s.cvx = cvx; s.cvy = cvy; s.t0 = t0; s.clock = clock;
    this.push();
  }

  /** Iskra z wpisu roboczego `s` (pola jak argumenty emit). */
  push() {
    const s = this.s;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const o = i * STRIDE;
    const o0 = this.origin;
    const lx = o0 ? s.x - o0.x : s.x;
    const ly = o0 ? -s.y - o0.y : -s.y;
    const birth = this.fxTime;
    const life = s.life;
    const A = this.a0.array; const B = this.a1.array; const C = this.a2.array; const D = this.a3.array;
    A[o] = lx; A[o + 1] = ly; A[o + 2] = birth; A[o + 3] = life;
    B[o] = s.vx; B[o + 1] = -s.vy; B[o + 2] = s.drag; B[o + 3] = s.size;
    C[o] = s.r; C[o + 1] = s.g; C[o + 2] = s.b; C[o + 3] = 0;
    this.gain.array[i] = s.gain;
    const cvx = s.cvx;
    const cvy = s.cvy;
    const moving = cvx !== 0 || cvy !== 0;
    D[o] = cvx; D[o + 1] = -cvy;
    D[o + 2] = moving ? s.t0 - (o0 ? o0.simEpoch : 0) : 0;
    D[o + 3] = moving && s.clock > 0.5 ? 1 : 0;
    this.upload.touch(i);
    if (i + 1 > this.highWater) this.highWater = i + 1;
    const dies = birth + life;
    if (dies > this.liveUntil) this.liveUntil = dies;
    this.stats.emitted++;
  }

  /** Przeskok początku pul / epok: przesunięcie żywych danych (rzadkie) i pełna wysyłka. */
  _rebase(dx, dy, dFx, dSim) {
    const n = this.highWater;
    if (n > 0) {
      const A = this.a0.array;
      const D = this.a3.array;
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        A[o] += dx; A[o + 1] += dy; A[o + 2] += dFx;
        if (D[o] !== 0 || D[o + 1] !== 0) D[o + 2] += dSim;
      }
      this.upload.markAll();
    }
    this.fxTime += dFx;
    this.liveUntil += dFx;
  }

  _flush() {
    this.upload.flush(this._attrs, this.highWater);
  }

  /**
   * Raz na klatkę (krok efektów Core3D, po origin.update): zegar, zoom, wysyłka, widoczność.
   * fxTimeLocal — zegar efektów względem epoki (origin.timeFx.value); bez początku pul —
   * wołający podaje własny zegar.
   */
  update(fxTimeLocal, zoom, ox = 0, oy = 0) {
    this.fxTime = fxTimeLocal;
    if (!this.origin) this._timeFx.value = fxTimeLocal;
    this.U.zoom.value = zoom;
    this._flush();
    if (this.highWater > 0 && fxTimeLocal > this.liveUntil + 0.2) {
      this.highWater = 0;
      this.head = 0;
      this.liveUntil = -Infinity;
    }
    const n = this.highWater;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      const m = this.mesh;
      m.position.set(ox, oy, 0);
      m.updateMatrix();
      m.matrixWorld.copy(m.matrix);
    }
  }

  clear() {
    this.highWater = 0;
    this.head = 0;
    this.liveUntil = -Infinity;
    this.upload.reset();
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    if (this.originEntry && this.origin) this.origin.unregister(this.originEntry);
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.material.dispose();
  }
}
