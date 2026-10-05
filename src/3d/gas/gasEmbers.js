// src/3d/gas/gasEmbers.js
//
// ISKRY I ŻAR WYBUCHÓW (cząstki GPU, compute) niesione POLEM PRĘDKOŚCI GAZU (gasGrid): w kuli
// ognia wirują razem z kłębami, poza domeną lecą balistycznie z oporem. Rysowane jako kreski
// wzdłuż prędkości (rozmycie ruchu: długość = prędkość × czas migawki), barwa z temperatury
// (biel → żółć → czerwień → gaśnie), mieszanie addytywne, HDR (bloom).
// Błyski (GasFlashes): krótki, bardzo jasny rdzeń wybuchu + szeroka poświata — kwady zwrócone do
// kamery, przepisywane co klatkę (≤ 32).
//
// Pozycje WZGLĘDEM początku gridu (grid.origin) — w grze początek przy kamerze (float32).
// Emisja paczkami: zlecenie = (środek, kierunek, rozrzut, liczba, prędkości, życie, rozmiar,
// temperatura, domena); jeden kernel emisji rozpisuje paczki na cząstki z haszem (bez CPU na cząstkę).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, instanceIndex,
  texture3D, positionGeometry, varyingProperty, select, mix, clamp, smoothstep, exp, max, min, length, normalize,
  cross, dot, sqrt, sin, cos, fract, attribute
} from 'three/tsl';
import { gasBlackbody } from './gasCommon.js';

export const EMBER_CAP = 1 << 16;
const BURST_CAP = 64;

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

// Hasz u32 → [0, 1) (PCG).
function hash01(x) {
  const s = uint(x).mul(uint(747796405)).add(uint(2891336453)).toVar();
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737)).toVar();
  return float(w.shiftRight(uint(22)).bitXor(w)).mul(1 / 4294967296);
}

export class GasEmbers {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('./gasGrid.js').GasGrid} o.grid
   * @param {{ next(): number }} o.rng
   */
  constructor({ scene, grid, rng, renderOrder = 60 }) {
    this.grid = grid;
    this.rng = rng;
    this.head = 0;
    this.highWater = 0;
    this.maxLife = 0;
    this.lastEmit = -1e9;
    this.time = 0;
    this.stats = { bursts: 0, spawned: 0, alive: 0 };
    this.P = instancedArray(EMBER_CAP, 'vec4').setName('gasEmberP'); // pozycja (lokalnie), wiek
    this.V = instancedArray(EMBER_CAP, 'vec4').setName('gasEmberV'); // prędkość, życie
    this.D = instancedArray(EMBER_CAP, 'vec4').setName('gasEmberD'); // temperatura0, rozmiar, ziarno, domena
    this._bursts = [];
    for (let i = 0; i < BURST_CAP; i++) this._bursts.push({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, spread: 1, count: 0, s0: 0, s1: 0, l0: 0, l1: 0, size: 0, temp: 0, slot: -1, seed: 0 });
    this._nBursts = 0;
    const S = grid.S;
    this.U = {
      dt: uniform(1 / 60),
      count: uniform(0, 'uint'),
      cap: uniform(EMBER_CAP, 'uint'),
      head: uniform(0, 'uint'),
      emitCount: uniform(0, 'uint'),
      nBursts: uniform(0, 'int'),
      bA: v4Array(BURST_CAP, 'gasEmberBA'), // środek (lokalnie), początek paczki (indeks cząstki)
      bB: v4Array(BURST_CAP, 'gasEmberBB'), // kierunek, rozrzut
      bC: v4Array(BURST_CAP, 'gasEmberBC'), // prędkość min, max, życie min, max
      bD: v4Array(BURST_CAP, 'gasEmberBD'), // rozmiar, temperatura, domena, ziarno
      slotBox: v4Array(S, 'gasEmberSlot'),  // minimum pudła domeny (lokalnie), h (0 = nieaktywna)
      drag: uniform(1.1),
      coupling: uniform(4.5),
      gravity: uniform(new THREE.Vector3(0, 0, 0)),
      camPos: uniform(new THREE.Vector3()),
      shutter: uniform(1 / 45),
      gain: uniform(1),
      cooling: uniform(1)
    };
    this._buildCompute();
    this._buildRender(scene, renderOrder);
  }

  _buildCompute() {
    const U = this.U;
    const { P, V, D } = this;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const S = grid.S;
    // Emisja: wątek = nowa cząstka; paczka z przedziałów początków (≤ 64 paczek).
    this.emitNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.emitCount), () => { Return(); });
      const i = float(instanceIndex);
      const b = int(0).toVar();
      Loop({ start: int(1), end: U.nBursts, type: 'int', condition: '<', name: 'eb' }, ({ eb }) => {
        If(i.greaterThanEqual(U.bA.element(eb).w), () => { b.assign(eb); });
      });
      const A = U.bA.element(b).toVar();
      const B = U.bB.element(b).toVar();
      const C = U.bC.element(b).toVar();
      const E = U.bD.element(b).toVar();
      const id = instanceIndex.add(uint(E.w.mul(97.0)));
      const r1 = hash01(id.mul(uint(4)));
      const r2 = hash01(id.mul(uint(4)).add(uint(1)));
      const r3 = hash01(id.mul(uint(4)).add(uint(2)));
      const r4 = hash01(id.mul(uint(4)).add(uint(3)));
      // Kierunek: losowy na sferze, odbity w półkulę normalnej, ściśnięty rozrzutem.
      const zz = r1.mul(2.0).sub(1.0);
      const ph = r2.mul(6.2831853);
      const rr = sqrt(max(float(1.0).sub(zz.mul(zz)), 0.0));
      const rnd = vec3(rr.mul(cos(ph)), rr.mul(sin(ph)), zz).toVar();
      const dn = dot(rnd, B.xyz);
      rnd.assign(select(dn.lessThan(0.0), rnd.sub(B.xyz.mul(dn.mul(2.0))), rnd));
      const dir = normalize(mix(B.xyz, rnd, B.w));
      // Prędkość: rozkład z przewagą wolnych, kilka bardzo szybkich (r³).
      const sp = mix(C.x, C.y, r3.mul(r3).mul(r3));
      const life = mix(C.z, C.w, r4);
      const slot = (instanceIndex.add(U.head)).mod(U.cap);
      P.element(slot).assign(vec4(A.xyz.add(dir.mul(E.x.mul(r4).mul(2.0))), 0.0));
      V.element(slot).assign(vec4(dir.mul(sp), life));
      D.element(slot).assign(vec4(E.y.mul(mix(0.75, 1.15, r2)), E.x.mul(mix(0.5, 1.3, r1)), r3.add(r1.mul(13.0)), E.z));
    })().compute(4096).setName('gasEmberEmit');

    // Krok: opór, porwanie przez gaz domeny (próbka prędkości z atlasu), grawitacja (opcjonalna).
    this.stepNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const Pp = P.element(instanceIndex).toVar();
      const Vv = V.element(instanceIndex).toVar();
      If(Pp.w.greaterThanEqual(Vv.w), () => { Return(); });
      const Dd = D.element(instanceIndex).toVar();
      const p = Pp.xyz.toVar();
      const v = Vv.xyz.toVar();
      // Domena gazu porywającego cząstkę; −1 = bez porwania (ciężkie łby odłamków lecą balistycznie).
      const slotF = Dd.w;
      If(slotF.greaterThanEqual(0.0), () => {
        const box = U.slotBox.element(int(slotF.add(0.5))).toVar();
        If(box.w.greaterThan(0.0), () => {
          const pc = p.sub(box.xyz).div(box.w).toVar();
          const inside = pc.x.greaterThan(1.0).and(pc.x.lessThan(N - 1)).and(pc.y.greaterThan(1.0)).and(pc.y.lessThan(N - 1))
            .and(pc.z.greaterThan(1.0)).and(pc.z.lessThan(NZ - 1));
          If(inside, () => {
            const uvw = vec3(pc.x.mul(1 / N), pc.y.mul(1 / N), pc.z.add(slotF.mul(NZ)).mul(1 / (NZ * S)));
            const g = texture3D(grid.velA, uvw).level(0).xyz.mul(box.w);
            v.addAssign(g.sub(v).mul(float(1.0).sub(exp(U.coupling.negate().mul(U.dt)))));
          });
        });
      });
      v.mulAssign(exp(U.drag.negate().mul(U.dt)));
      v.addAssign(U.gravity.mul(U.dt));
      p.addAssign(v.mul(U.dt));
      P.element(instanceIndex).assign(vec4(p, Pp.w.add(U.dt)));
      V.element(instanceIndex).assign(vec4(v, Vv.w));
    })().compute(EMBER_CAP).setName('gasEmberStep');
  }

  _buildRender(scene, renderOrder) {
    const U = this.U;
    const { P, V, D } = this;
    const vA = varyingProperty('vec4', 'vGasEmbA'); // q (kwad), wiek/życie, —
    const vB = varyingProperty('vec4', 'vGasEmbB'); // barwa HDR, —
    const mat = new THREE.NodeMaterial();
    mat.name = 'GasEmbers';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const Pp = P.element(instanceIndex);
      const Vv = V.element(instanceIndex);
      const Dd = D.element(instanceIndex);
      const age = Pp.w;
      const life = Vv.w;
      const alive = age.lessThan(life);
      const u = clamp(age.div(max(life, 1e-3)), 0.0, 1.0);
      const p = Pp.xyz;
      const v = Vv.xyz;
      const sp = length(v);
      const vdir = select(sp.greaterThan(1e-3), v.div(max(sp, 1e-3)), vec3(0.0, 1.0, 0.0));
      const view = normalize(p.sub(U.camPos));
      const across0 = cross(vdir, view);
      const across = select(length(across0).greaterThan(1e-4), normalize(across0), normalize(cross(vec3(0.0, 1.0, 0.0), view)));
      const size = select(alive, Dd.y.mul(float(1.0).sub(u.mul(0.5))), float(0.0));
      const len = max(size, sp.mul(U.shutter));
      const q = positionGeometry.xy.mul(2.0);
      // Kreska: oś wzdłuż prędkości (za cząstką — smuga), szerokość = rozmiar.
      const off = vdir.mul(q.x.sub(1.0).mul(0.5).mul(len)).add(across.mul(q.y.mul(0.5).mul(size)));
      // Temperatura: stygnie z wiekiem; jasność ∝ T² (iskry gasną szybko, żar dłużej się tli).
      const T = Dd.x.mul(exp(u.mul(-2.6).mul(U.cooling))).toVar();
      const fade = float(1.0).sub(smoothstep(0.75, 1.0, u));
      const hdr = gasBlackbody(T).mul(T.mul(T).mul(1.6).add(0.05)).mul(fade).mul(U.gain);
      // Smuga dłuższa niż kwadrat — jasność rozłożona na długości (stała energia na piksel).
      vA.assign(vec4(q, u, 0.0));
      vB.assign(vec4(hdr.mul(size.div(max(len, 1e-4)).mul(0.7).add(0.3)), 0.0));
      return p.add(off);
    })();
    mat.fragmentNode = Fn(() => {
      const q = vA.xy;
      const ax = q.x;
      const ay = q.y;
      const prof = exp(ay.mul(ay).mul(-3.2)).mul(smoothstep(-1.0, -0.6, ax)).mul(float(1.0).sub(smoothstep(0.75, 1.0, ax)));
      return vec4(vB.xyz.mul(prof), 0.0);
    })();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = 'GasEmbers';
    this.material = mat;
    scene.add(this.mesh);
  }

  /**
   * Paczka iskier (scena, double — przeliczana względem grid.origin przy wysyłce): kierunek n,
   * rozrzut 0..1 (1 = półkula), liczba, prędkości [j./s], życie [s], rozmiar [j.], temperatura
   * gazu (gasCommon — 2,5 = biało-żółte), domena gazu (−1 = bez porwania).
   */
  burst(x, y, z, nx, ny, nz, spread, count, s0, s1, l0, l1, size, temp, slot = -1) {
    if (this._nBursts >= BURST_CAP || count <= 0) return;
    const b = this._bursts[this._nBursts++];
    b.x = x; b.y = y; b.z = z; b.nx = nx; b.ny = ny; b.nz = nz; b.spread = spread;
    b.count = Math.min(count | 0, 4096); b.s0 = s0; b.s1 = s1; b.l0 = l0; b.l1 = l1; b.size = size; b.temp = temp; b.slot = slot;
    b.seed = this.rng.next() * 1000;
    if (l1 > this.maxLife) this.maxLife = l1;
  }

  /** Krok klatki: emisja zleceń, ruch, porwanie przez gaz. Po grid.simulate (prędkość tej klatki). */
  update(renderer, dt, camera) {
    const U = this.U;
    const grid = this.grid;
    const o = grid.origin;
    this.time += dt;
    // Pudła domen (indeks = slot) do porwania.
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    for (let i = 0; i < grid.S; i++) {
      const s = grid.slots[i];
      U.slotBox.array[i].set(s.cx - half * s.h - o.x, s.cy - half * s.h - o.y, s.cz - halfZ * s.h - o.z, s.active ? s.h : 0);
    }
    if (camera) {
      const e = camera.matrixWorld.elements;
      U.camPos.value.set(e[12] - o.x, e[13] - o.y, e[14] - o.z);
    }
    const L = this._list || (this._list = []);
    L.length = 0;
    // Emisja.
    let total = 0;
    const nb = this._nBursts;
    for (let k = 0; k < nb; k++) {
      const b = this._bursts[k];
      if (total + b.count > 4096) b.count = 4096 - total;
      U.bA.array[k].set(b.x - o.x, b.y - o.y, b.z - o.z, total);
      const nl = Math.hypot(b.nx, b.ny, b.nz) || 1;
      U.bB.array[k].set(b.nx / nl, b.ny / nl, b.nz / nl, b.spread);
      U.bC.array[k].set(b.s0, b.s1, b.l0, b.l1);
      U.bD.array[k].set(b.size, b.temp, b.slot, b.seed);
      total += b.count;
      if (total >= 4096) { this._nBursts = k + 1; break; }
    }
    if (total > 0) {
      U.nBursts.value = this._nBursts;
      U.emitCount.value = total;
      U.head.value = this.head;
      this.emitNode.count = total;
      L.push(this.emitNode);
      this.head = (this.head + total) % EMBER_CAP;
      this.highWater = Math.min(EMBER_CAP, Math.max(this.highWater, this.head === 0 ? EMBER_CAP : this.head));
      if (this.head < total) this.highWater = EMBER_CAP;
      this.lastEmit = this.time;
      this.stats.spawned += total;
      this.stats.bursts += this._nBursts;
    }
    this._nBursts = 0;
    if (this.highWater > 0 && dt > 0) {
      U.dt.value = dt;
      U.count.value = this.highWater;
      this.stepNode.count = this.highWater;
      L.push(this.stepNode);
    }
    if (L.length) renderer.compute(L);
    // Pula wygasła — od zera.
    if (this.highWater > 0 && this.time - this.lastEmit > this.maxLife + 0.5) {
      this.highWater = 0; this.head = 0; this.maxLife = 0;
    }
    this.mesh.count = this.highWater;
    this.mesh.visible = this.highWater > 0;
    this.stats.alive = this.highWater;
  }

  warm(renderer) {
    this.U.emitCount.value = 0;
    this.U.count.value = 0;
    this.emitNode.count = 64;
    this.stepNode.count = 64;
    renderer.compute([this.emitNode, this.stepNode]);
  }

  clear() {
    this.highWater = 0; this.head = 0; this.maxLife = 0; this._nBursts = 0;
    this.mesh.count = 0; this.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------------------------

const FLASH_CAP = 32;

/**
 * Błyski wybuchów: rdzeń (mały, bardzo jasny, gaśnie w ~0,1 s) + poświata (szeroka, dłuższa).
 * Kwady zwrócone do kamery (oś prawa / góra kamery w uniformach), instancje co klatkę.
 */
export class GasFlashes {
  constructor({ scene, grid, renderOrder = 70 }) {
    this.grid = grid;
    this.items = [];
    this.time = 0;
    this.U = {
      right: uniform(new THREE.Vector3(1, 0, 0)),
      up: uniform(new THREE.Vector3(0, 1, 0)),
      gain: uniform(1)
    };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(FLASH_CAP * 4), 4); // środek (lokalnie), rozmiar
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(FLASH_CAP * 4), 4); // barwa HDR, kształt (rdzeń 0..1)
    geo.setAttribute('flA', this.aA);
    geo.setAttribute('flB', this.aB);
    geo.instanceCount = 0;
    this.geo = geo;
    const U = this.U;
    const vA = varyingProperty('vec4', 'vGasFlA');
    const vB = varyingProperty('vec4', 'vGasFlB');
    const mat = new THREE.NodeMaterial();
    mat.name = 'GasFlashes';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('flA', 'vec4');
      const B = attribute('flB', 'vec4');
      const q = positionGeometry.xy.mul(2.0);
      vA.assign(vec4(q, B.w, 0.0));
      vB.assign(vec4(B.xyz, 0.0));
      return A.xyz.add(U.right.mul(q.x.mul(A.w))).add(U.up.mul(q.y.mul(A.w)));
    })();
    mat.fragmentNode = Fn(() => {
      const r2 = dot(vA.xy, vA.xy);
      const core = exp(r2.mul(-26.0));
      const halo = exp(r2.mul(-5.5)).mul(0.22).add(exp(r2.mul(-2.6)).mul(0.04));
      const edge = float(1.0).sub(smoothstep(0.35, 1.0, r2));
      return vec4(vB.xyz.mul(mix(halo, core.add(halo), vA.z)).mul(edge).mul(U.gain), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.name = 'GasFlashes';
    scene.add(this.mesh);
  }

  /** Błysk (scena): rozmiar [j.], moc (1 = wybuch budowli), czas [s]. */
  add(x, y, z, size, power = 1, life = 0.35) {
    if (this.items.length >= FLASH_CAP) this.items.shift();
    this.items.push({ x, y, z, size, power, life, t0: this.time });
  }

  update(dt, camera) {
    this.time += dt;
    const o = this.grid.origin;
    const e = camera.matrixWorld.elements;
    this.U.right.value.set(e[0], e[1], e[2]).normalize();
    this.U.up.value.set(e[4], e[5], e[6]).normalize();
    const A = this.aA.array;
    const B = this.aB.array;
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      const age = this.time - f.t0;
      if (age > f.life) { this.items.splice(i, 1); continue; }
      const u = age / f.life;
      // Rdzeń: biel ~25 HDR gasnąca w ~0,03 s; krótka poświata pomarańczowa (kula ognia gazu przejmuje obraz).
      const core = Math.exp(-age / 0.03);
      const glow = Math.exp(-age / (f.life * 0.3)) * (1 - u);
      // Kamera w zasięgu błysku: gaśnie (inaczej kwad zalewa cały kadr jednolitą barwą).
      const dx = f.x - e[12], dy = f.y - e[13], dz = f.z - e[14];
      const dc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const near = Math.min(1, Math.max(0, (dc - f.size * 0.6) / (f.size * 1.2)));
      const k = f.power * near * near;
      const size = f.size * (0.3 + 0.3 * (1 - Math.exp(-age / 0.04)));
      A[n * 4] = f.x - o.x; A[n * 4 + 1] = f.y - o.y; A[n * 4 + 2] = f.z - o.z; A[n * 4 + 3] = size;
      B[n * 4] = (26 * core + 2.2 * glow) * k; B[n * 4 + 1] = (23 * core + 1.0 * glow) * k; B[n * 4 + 2] = (18 * core + 0.3 * glow) * k;
      B[n * 4 + 3] = Math.min(1, core * 1.4);
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) { this.aA.needsUpdate = true; this.aB.needsUpdate = true; }
  }

  clear() { this.items.length = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}
