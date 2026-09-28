// dema/asteroidy-webgpu/sparks.js
//
// Iskry na GPU (compute): pula drobin w buforach storage, emisja z kolejki
// emiterów ustawianej na CPU (punkt, normalna, stożek, prędkość, życie,
// barwa HDR), krok ruchu w compute (opór, bez grawitacji — próżnia), render
// instancjami jako smugi wzdłuż prędkości (addytywnie, HDR: białoniebieski
// żar gaśnie przez fiolet do czerwieni — jony ładunku, nie proch).
// Używa ich burza (storm.js): snop iskier w miejscu uderzenia pioruna,
// trzaski na skałach energetycznych; wybuchy (dynamics.js).
//
// Pozycje względem lokalnego początku sceny; przy przeskoku początku iskry
// przesuwa krok compute (shift), więc nic nie skacze.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, instanceIndex, hash,
  positionGeometry, uv, varyingProperty, Loop, If, Return, Break, select, mix, smoothstep, clamp,
  sqrt, sin, cos, exp, max, min, length, normalize, cross, dot, abs, pow
} from 'three/tsl';

export const SPARK_CAP = 1 << 15;
const EMITTER_CAP = 24;

export class Sparks {
  constructor({ renderer, scene, capacity = SPARK_CAP }) {
    this.renderer = renderer;
    this.capacity = capacity;
    this.head = 0;
    this.time = 0;
    this.pos = instancedArray(capacity, 'vec4').setName('sparkPos');   // xyz, wiek
    this.vel = instancedArray(capacity, 'vec4').setName('sparkVel');   // xyz, życie
    this.col = instancedArray(capacity, 'vec4').setName('sparkCol');   // rgb HDR, grubość [j.]
    const v4 = () => uniformArray(Array.from({ length: EMITTER_CAP }, () => new THREE.Vector4()), 'vec4');
    this.U = {
      dt: uniform(0),
      count: uniform(0, 'uint'),
      head: uniform(0, 'uint'),
      seed: uniform(0, 'uint'),
      emitters: uniform(0, 'int'),
      // A = pozycja xyz, w = pierwszy indeks (prefiks); B = normalna xyz, w = cos stożka;
      // C = prędkość min, max, życie min, max; D = barwa rgb, w = grubość.
      eA: v4(), eB: v4(), eC: v4(), eD: v4(),
      shift: uniform(new THREE.Vector3()),
      zoom: uniform(1),
      drag: uniform(2.2)
    };
    this._queue = [];
    this._total = 0;
    this._build();
    this._buildRender(scene);
    this.stats = { spawned: 0 };
  }

  _build() {
    const U = this.U;
    const cap = this.capacity;
    // Emisja: wątek i < count → emiter z prefiksów, drobina (head + i) mod cap.
    this.spawnNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const e = vec4(0).toVar();
      const b = vec4(0, 0, 1, 0).toVar();
      const c = vec4(0).toVar();
      const d = vec4(0).toVar();
      Loop({ start: 0, end: EMITTER_CAP, type: 'int', condition: '<', name: 'ke' }, ({ ke }) => {
        If(ke.greaterThanEqual(U.emitters), () => { Break(); });
        const A = U.eA.element(ke);
        If(float(instanceIndex).greaterThanEqual(A.w), () => {
          e.assign(A);
          b.assign(U.eB.element(ke));
          c.assign(U.eC.element(ke));
          d.assign(U.eD.element(ke));
        });
      });
      const i = instanceIndex.add(U.head).mod(uint(cap)).toVar();
      const s = instanceIndex.add(U.seed.mul(uint(0x9E3779B1))).toVar();
      const h1 = hash(s);
      const h2 = hash(s.bitXor(uint(0x68E31DA4)));
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const h5 = hash(s.bitXor(uint(0x2F9E0C33)));
      // Kierunek w stożku wokół normalnej (równomiernie po czaszy).
      const n = normalize(b.xyz).toVar();
      const t1 = normalize(select(abs(n.z).lessThan(0.95), cross(n, vec3(0, 0, 1)), cross(n, vec3(1, 0, 0)))).toVar();
      const t2 = cross(n, t1);
      const cz = mix(float(1.0), b.w, h1);
      const sz = sqrt(max(float(1.0).sub(cz.mul(cz)), 0.0));
      const ph = h2.mul(6.2831853);
      const dir = n.mul(cz).add(t1.mul(cos(ph).mul(sz))).add(t2.mul(sin(ph).mul(sz)));
      const speed = mix(c.x, c.y, h3.mul(h3));
      const life = mix(c.z, c.w, h4);
      this.pos.element(i).assign(vec4(e.xyz, 0.0));
      this.vel.element(i).assign(vec4(dir.mul(speed), life));
      this.col.element(i).assign(vec4(d.rgb.mul(h5.mul(0.5).add(0.75)), d.w));
    })().compute(cap).setName('sparkSpawn');

    this.stepNode = Fn(() => {
      const P = this.pos.element(instanceIndex).toVar();
      const V = this.vel.element(instanceIndex).toVar();
      If(P.w.lessThan(V.w), () => {
        const v = V.xyz.mul(exp(U.drag.mul(U.dt).negate()));
        this.pos.element(instanceIndex).assign(vec4(P.xyz.add(v.mul(U.dt)).add(U.shift), P.w.add(U.dt)));
        this.vel.element(instanceIndex).assign(vec4(v, V.w));
      });
    })().compute(cap).setName('sparkStep');

    // Czyszczenie puli (start): wiek > życie.
    this.clearNode = Fn(() => {
      this.pos.element(instanceIndex).assign(vec4(0, 0, 0, 1));
      this.vel.element(instanceIndex).assign(vec4(0, 0, 0, 0));
    })().compute(cap).setName('sparkClear');
  }

  _buildRender(scene) {
    const U = this.U;
    const vCol = varyingProperty('vec3', 'vSparkCol');
    const vK = varyingProperty('float', 'vSparkK');
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
    mat.positionNode = Fn(() => {
      const P = this.pos.element(instanceIndex).toVar();
      const V = this.vel.element(instanceIndex).toVar();
      const C = this.col.element(instanceIndex).toVar();
      const alive = P.w.lessThan(V.w);
      const a = clamp(P.w.div(max(V.w, 1e-3)), 0.0, 1.0).toVar();
      // Smuga wzdłuż prędkości na ekranie (min 1,5 px szerokości).
      const vxy = V.xy.toVar();
      const sp = length(vxy).toVar();
      const dir = select(sp.greaterThan(1e-3), vxy.div(sp), vec2(1, 0));
      const perp = vec2(dir.y.negate(), dir.x);
      const w = max(C.w, float(1.5).div(U.zoom)).toVar();
      const len = max(sp.mul(0.028), w.mul(2.0));
      const q = positionGeometry.xy;
      const local = dir.mul(q.x.mul(len)).add(perp.mul(q.y.mul(w).mul(2.0)));
      // Żar: biel → barwa → fiolet → czerwień (jony stygną), zanik ku końcowi życia.
      const hot = C.rgb.mul(float(1.0).sub(a).mul(1.4).add(0.2));
      const cool = mix(C.rgb, vec3(0.9, 0.25, 0.7).mul(max(C.r, max(C.g, C.b)).mul(0.5)), smoothstep(0.35, 1.0, a));
      vCol.assign(mix(hot, cool, a).mul(pow(float(1.0).sub(a), 1.6)));
      vK.assign(select(alive, float(1.0), float(0.0)));
      return vec3(P.xy.add(local.mul(select(alive, float(1.0), float(0.0)))), P.z);
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const across = exp(q.y.mul(q.y).mul(-5.0));
      const along = smoothstep(1.0, 0.2, abs(q.x)).mul(q.x.mul(0.35).add(0.65));
      return vec4(vCol.mul(across.mul(along)).mul(vK), 0.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.count = this.capacity;
    this.mesh.renderOrder = 24;
    this.mesh.name = 'sparks';
    scene.add(this.mesh);
    this.renderer.compute(this.clearNode);
  }

  /**
   * Emiter (scena): n iskier z punktu (x, y, z) w stożku wokół normalnej
   * (nx, ny, nz); o: { cone (cos), speed [a, b], life [a, b], color [r, g, b], size }.
   */
  emit(x, y, z, nx, ny, nz, n, o = {}) {
    if (this._queue.length >= EMITTER_CAP || !(n > 0)) return;
    const count = Math.min(4096, Math.round(n));
    this._queue.push({ x, y, z, nx, ny, nz, count, o });
  }

  /** Przesunięcie żywych iskier przy przeskoku początku sceny (scena). */
  shift(dx, dy) {
    this._shiftX = (this._shiftX || 0) + dx;
    this._shiftY = (this._shiftY || 0) + dy;
  }

  update(dt, zoom) {
    const U = this.U;
    this.time += dt;
    U.zoom.value = zoom;
    const q = this._queue;
    if (q.length) {
      let total = 0;
      for (let k = 0; k < q.length; k++) {
        const e = q[k];
        const o = e.o;
        const speed = o.speed || [300, 1200];
        const life = o.life || [0.15, 0.5];
        const col = o.color || [1.5, 2.4, 3.9];
        U.eA.array[k].set(e.x, e.y, e.z, total);
        const nl = Math.hypot(e.nx, e.ny, e.nz) || 1;
        U.eB.array[k].set(e.nx / nl, e.ny / nl, e.nz / nl, o.cone ?? 0.2);
        U.eC.array[k].set(speed[0], speed[1], life[0], life[1]);
        U.eD.array[k].set(col[0], col[1], col[2], o.size ?? 6);
        total += e.count;
      }
      total = Math.min(total, this.capacity);
      U.emitters.value = q.length;
      U.count.value = total;
      U.head.value = this.head;
      U.seed.value = (U.seed.value + 1) >>> 0;
      this.renderer.compute(this.spawnNode, total);
      this.head = (this.head + total) % this.capacity;
      this.stats.spawned += total;
      q.length = 0;
    }
    U.dt.value = Math.min(0.05, Math.max(0, dt));
    U.shift.value.set(this._shiftX || 0, this._shiftY || 0, 0);
    this._shiftX = 0;
    this._shiftY = 0;
    this.renderer.compute(this.stepNode);
  }
}
