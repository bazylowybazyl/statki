// dema/rakiety-webgpu/pulsarParticles.js
//
// CZĄSTKI PLAZMY wybuchu „Pulsar” (głowica rakiety „Niszczyciel”, pulsar.js) — własna pula na GPU (compute),
// w pełnym 3D: pozycja i prędkość mają trzy składowe, a cząstki pod płaszczyzną gry chowają się za kadłubami
// (test głębi). Ruch liczy kernel kroku w układzie wybuchu (środek, oś obrotu S, promień R — uniformy):
//   0 DOPŁYW  — ładowanie i zapaść: spirala do środka w płaszczyźnie równika. To pole prędkości, nie siły:
//               prędkość radialna i styczna rosną ku jądru, więc smugi wydłużają się jak w dysku akrecyjnym;
//   1 DŻET    — plazma wyrzucana wzdłuż obracającej się osi magnetycznej (kolejne porcje lecą w innym
//               kierunku — w 3D układają się w śrubę na stożku), z wirem wokół osi;
//   2 WYRZUT  — rozbryzg w płaszczyźnie równika, przy detonacji i przy każdym pulsie;
//   3 POWŁOKA — iskry jadące z powłoką wybuchu (silny opór — zostają w miejscu i migoczą);
//   4 PYŁ     — wolne, długo żyjące drobiny (migoczą); w zapaści ściągane do jądra.
// W zapaści (współczynnik w uniformie wybuchu) wszystko poza dopływem przyspiesza do jądra i tam gaśnie.
// Emisja paczkami (≤ 48 na klatkę): kernel rozpisuje paczkę na cząstki haszem — bez pracy CPU na cząstkę.
// Obraz: kreski wzdłuż rzutu prędkości (rozmycie ruchu), barwa z wieku: biel → lodowy błękit → lazur →
// głęboki błękit; cząstki wyżej nad płaszczyzną gry (bliżej kamery) są większe.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, instanceIndex,
  positionGeometry, varyingProperty, select, mix, clamp, smoothstep, step, exp, sin, cos, atan, log, max, length, normalize, cross, dot, sqrt
} from 'three/tsl';

export const PULSAR_PARTICLE_CAP = 1 << 17;
/** Wybuchów naraz (indeks wybuchu w uniformach puli). */
export const PULSAR_BLASTS = 4;
const BURST_CAP = 48;
/** Najwięcej nowych cząstek na klatkę (detonacja: powłoka + rozbryzg + dżety). */
const EMIT_MAX = 20480;

export const PK = Object.freeze({ INFLOW: 0, JET: 1, EJECTA: 2, SHELL: 3, MOTE: 4 });
/** Kształt paczki: kierunki z całej sfery, z płaszczyzny równika (⟂ S) albo ze stożka wokół `dir`. */
export const PSHAPE = Object.freeze({ SPHERE: 0, PLANE: 1, CONE: 2 });

// Barwy liniowe (jasny błękit pulsara).
const WHITE = [1.0, 1.0, 1.0];
const ICE = [0.6, 0.86, 1.0];
const AZURE = [0.14, 0.52, 1.0];
const DEEP = [0.04, 0.13, 0.7];

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

// Hasz u32 → [0, 1) (PCG).
function hash01(x) {
  const s = uint(x).mul(uint(747796405)).add(uint(2891336453)).toVar();
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737)).toVar();
  return float(w.shiftRight(uint(22)).bitXor(w)).mul(1 / 4294967296);
}

export class PulsarParticles {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene scena dema (kamera ortho z góry, z ku kamerze)
   */
  constructor({ renderer, scene, renderOrder = 64 }) {
    this.renderer = renderer;
    this.head = 0;
    this.highWater = 0;
    this.maxLife = 0;
    this.lastEmit = -1e9;
    this.time = 0;
    this.stats = { spawned: 0, alive: 0, bursts: 0 };
    this.P = instancedArray(PULSAR_PARTICLE_CAP, 'vec4').setName('pulsarP'); // pozycja (scena), wiek
    this.V = instancedArray(PULSAR_PARTICLE_CAP, 'vec4').setName('pulsarV'); // prędkość w układzie wybuchu [j./s], życie
    this.D = instancedArray(PULSAR_PARTICLE_CAP, 'vec4').setName('pulsarD'); // rodzaj, ziarno, rozmiar [j.], wybuch
    this._bursts = Array.from({ length: BURST_CAP }, () => ({
      slot: 0, kind: 0, shape: 0, count: 0, dx: 0, dy: 0, dz: 1, spread: 0, s0: 0, s1: 0, l0: 0, l1: 0, r0: 0, r1: 0, swirl: 0, size: 1, seed: 0
    }));
    this._nBursts = 0;
    this.U = {
      dt: uniform(1 / 60),
      time: uniform(0),
      zoom: uniform(1),
      count: uniform(0, 'uint'),
      cap: uniform(PULSAR_PARTICLE_CAP, 'uint'),
      head: uniform(0, 'uint'),
      emitCount: uniform(0, 'uint'),
      nBursts: uniform(0, 'int'),
      bA: v4Array(BURST_CAP, 'pulsarBA'), // kierunek stożka, początek paczki (indeks cząstki)
      bB: v4Array(BURST_CAP, 'pulsarBB'), // prędkość min, max [R/s], życie min, max [s]
      bC: v4Array(BURST_CAP, 'pulsarBC'), // promień startu r0, r1 [R], rozrzut stożka 0..1, wir [R/s]
      bD: v4Array(BURST_CAP, 'pulsarBD'), // rozmiar [j.], rodzaj, wybuch, ziarno
      bE: v4Array(BURST_CAP, 'pulsarBE'), // kształt, —, —, —
      pC: v4Array(PULSAR_BLASTS, 'pulsarPC'), // środek wybuchu (scena), R [j.]
      pS: v4Array(PULSAR_BLASTS, 'pulsarPS'), // oś obrotu S, zapaść 0..1
      pV: v4Array(PULSAR_BLASTS, 'pulsarPV'), // nośnik wybuchu [j./s] (trafiony kadłub w ruchu)
      shutter: uniform(1 / 42),
      gain: uniform(1)
    };
    for (let i = 0; i < PULSAR_BLASTS; i++) {
      this.U.pC.array[i].set(0, 0, 0, 1);
      this.U.pS.array[i].set(0, 0, 1, 0);
    }
    this._buildCompute();
    this._buildRender(scene, renderOrder);
  }

  _buildCompute() {
    const U = this.U;
    const { P, V, D } = this;
    // Emisja: wątek = nowa cząstka; paczka z przedziałów początków.
    this.emitNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.emitCount), () => { Return(); });
      const i = float(instanceIndex);
      const b = int(0).toVar();
      Loop({ start: int(1), end: U.nBursts, type: 'int', condition: '<', name: 'pb' }, ({ pb }) => {
        If(i.greaterThanEqual(U.bA.element(pb).w), () => { b.assign(pb); });
      });
      const A = U.bA.element(b).toVar();
      const B = U.bB.element(b).toVar();
      const C = U.bC.element(b).toVar();
      const E = U.bD.element(b).toVar();
      const shape = U.bE.element(b).x.toVar();
      const bi = int(E.z.add(0.5)).toVar();
      const BC = U.pC.element(bi).toVar();
      const S = U.pS.element(bi).xyz.toVar();
      const R = BC.w;
      const id = instanceIndex.add(U.head).mul(uint(9)).add(uint(E.w.mul(7919.0))).toVar();
      const r1 = hash01(id).toVar();
      const r2 = hash01(id.add(uint(1))).toVar();
      const r3 = hash01(id.add(uint(2))).toVar();
      const r4 = hash01(id.add(uint(3))).toVar();
      const r5 = hash01(id.add(uint(4))).toVar();
      const r6 = hash01(id.add(uint(5))).toVar();
      // Losowy kierunek na sferze.
      const zz = r1.mul(2.0).sub(1.0).toVar();
      const ph = r2.mul(6.2831853).toVar();
      const rr = sqrt(max(float(1.0).sub(zz.mul(zz)), 0.0)).toVar();
      const rnd = vec3(rr.mul(cos(ph)), rr.mul(sin(ph)), zz).toVar();
      const n = vec3(0.0).toVar();
      const axis = vec3(0.0).toVar();
      n.assign(rnd);
      axis.assign(S);
      If(shape.greaterThan(0.5), () => {
        // Pierścień: kierunek w płaszczyźnie równika (⟂ S).
        n.assign(normalize(rnd.sub(S.mul(dot(rnd, S))).add(vec3(1e-4, 0.0, 0.0))));
      });
      If(shape.greaterThan(1.5), () => {
        // Stożek wokół kierunku paczki; wir wokół tej osi.
        n.assign(normalize(mix(A.xyz, rnd, C.z)));
        axis.assign(A.xyz);
      });
      const rad = mix(C.x, C.y, sqrt(r3)).mul(R);
      const sp = mix(B.x, B.y, r4.mul(r4)).mul(R);
      const tang = cross(axis, n).toVar();
      const tl = max(length(tang), 1e-3);
      const vel = n.mul(sp).add(tang.div(tl).mul(C.w.mul(R)));
      const life = mix(B.z, B.w, r5);
      const slot = instanceIndex.add(U.head).mod(U.cap);
      P.element(slot).assign(vec4(BC.xyz.add(n.mul(rad)), 0.0));
      V.element(slot).assign(vec4(vel, life));
      D.element(slot).assign(vec4(E.y, r6, E.x.mul(mix(0.6, 1.4, r1)), E.z));
    })().compute(EMIT_MAX).setName('pulsarEmit');

    // Krok: ruch w układzie wybuchu (pole prędkości dopływu, opór, zapaść).
    this.stepNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const Pp = P.element(instanceIndex).toVar();
      const Vv = V.element(instanceIndex).toVar();
      If(Pp.w.greaterThanEqual(Vv.w), () => { Return(); });
      const Dd = D.element(instanceIndex).toVar();
      const bi = int(Dd.w.add(0.5)).toVar();
      const BC = U.pC.element(bi).toVar();
      const BS = U.pS.element(bi).toVar();
      const BV = U.pV.element(bi).toVar();
      const R = max(BC.w, 1.0).toVar();
      const S = BS.xyz.toVar();
      const kc = BS.w.toVar();
      const p = Pp.xyz.toVar();
      const v = Vv.xyz.toVar();
      const q = p.sub(BC.xyz).div(R).toVar();
      const r = max(length(q), 1e-3).toVar();
      const age = Pp.w.add(U.dt).toVar();
      const kind = Dd.x.toVar();
      If(kind.lessThan(0.5), () => {
        // DOPŁYW: spirala do jądra w płaszczyźnie równika; składowa wzdłuż S gaśnie (dysk się spłaszcza).
        const h = dot(q, S).toVar();
        const qp = q.sub(S.mul(h)).toVar();
        const rp = max(length(qp), 1e-3).toVar();
        const er = qp.div(rp).toVar();
        const et = cross(S, er);
        const vr = float(0.5).div(rp.add(0.12)).add(0.55).negate();
        const vt = float(0.9).div(rp.add(0.15));
        v.assign(er.mul(vr).add(et.mul(vt)).add(S.mul(h.mul(-4.0))).mul(R));
        If(rp.lessThan(0.05), () => { age.assign(max(age, Vv.w)); });
      }).Else(() => {
        // Opór wg rodzaju: dżet 0,5 / wyrzut 1,3 / powłoka 2,2 / pył 0,7 [1/s].
        const drag = float(0.5).add(step(1.5, kind).mul(0.8)).add(step(2.5, kind).mul(0.9)).sub(step(3.5, kind).mul(1.5));
        v.mulAssign(exp(drag.negate().mul(U.dt)));
        If(kc.greaterThan(0.001), () => {
          v.subAssign(q.div(r).mul(R.mul(16.0).mul(kc).mul(U.dt)));
          If(r.lessThan(0.07), () => { age.assign(max(age, Vv.w)); });
        });
      });
      p.addAssign(v.add(BV.xyz).mul(U.dt));
      P.element(instanceIndex).assign(vec4(p, age));
      V.element(instanceIndex).assign(vec4(v, Vv.w));
    })().compute(PULSAR_PARTICLE_CAP).setName('pulsarStep');
  }

  _buildRender(scene, renderOrder) {
    const U = this.U;
    const { P, V, D } = this;
    const vA = varyingProperty('vec4', 'vPulsPA'); // q (kwad), —, —
    const vB = varyingProperty('vec4', 'vPulsPB'); // barwa HDR
    const mat = new THREE.NodeMaterial();
    mat.name = 'PulsarParticles';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const Pp = P.element(instanceIndex).toVar();
      const Vv = V.element(instanceIndex).toVar();
      const Dd = D.element(instanceIndex).toVar();
      const age = Pp.w;
      const life = Vv.w;
      const alive = age.lessThan(life);
      const u = clamp(age.div(max(life, 1e-3)), 0.0, 1.0).toVar();
      const kind = Dd.x;
      const isIn = float(1.0).sub(step(0.5, kind)).toVar();
      const isJet = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind))).toVar();
      const isEj = step(1.5, kind).mul(float(1.0).sub(step(2.5, kind)));
      const isSh = step(2.5, kind).mul(float(1.0).sub(step(3.5, kind)));
      const isMo = step(3.5, kind);
      const sp = length(Vv.xy).toVar();
      const dir = select(sp.greaterThan(1.0), Vv.xy.div(max(sp, 1.0)), vec2(1.0, 0.0)).toVar();
      // Bliżej kamery (wyżej nad płaszczyzną gry) — większe: głębia bez perspektywy kamery.
      const persp = clamp(Pp.z.mul(0.0007).add(1.0), 0.65, 1.7);
      const size = max(Dd.z.mul(float(1.0).sub(u.mul(0.5))).mul(persp), float(1.1).div(U.zoom)).toVar();
      // Smuga = prędkość × czas migawki; dopływ ma migawkę ×3,2 (długie nitki wciągane po spirali), dżet ×1,4.
      const shutter = U.shutter.mul(isIn.mul(2.2).add(isJet.mul(0.4)).add(1.0));
      const len = max(size, sp.mul(shutter)).toVar();
      const q = positionGeometry.xy.mul(2.0).toVar();
      const off = dir.mul(q.x.sub(1.0).mul(0.5).mul(len)).add(vec2(dir.y.negate(), dir.x).mul(q.y.mul(0.5).mul(size)));
      // DOPŁYW świeci w RAMIONACH spirali logarytmicznej (te same ramiona rysuje dysk bryły — pulsar.js): między
      // ramionami cząstki są ciemne, więc dysk ma strukturę zamiast równej kaszy.
      const bi = int(Dd.w.add(0.5)).toVar();
      const BC = U.pC.element(bi).toVar();
      const S = U.pS.element(bi).xyz.toVar();
      const rel = Pp.xyz.sub(BC.xyz).div(max(BC.w, 1.0)).toVar();
      const qp = rel.sub(S.mul(dot(rel, S))).toVar();
      const rho = max(length(qp), 1e-3).toVar();
      const s1 = normalize(vec3(S.y, S.x.negate(), 1e-6)).toVar();
      const s2 = cross(S, s1);
      const psi = atan(dot(qp, s2), dot(qp, s1));
      const ph2 = log(rho.add(0.03)).mul(1.35).add(psi.mul(1 / Math.PI)).add(U.time.mul(2.6));
      const ar = cos(ph2.mul(6.2831853)).mul(0.5).add(0.5).toVar();
      const armK = mix(float(1.0), ar.mul(ar).mul(0.92).add(0.08), isIn);
      // Barwa z wieku; jasność wg rodzaju (dopływ jaśnieje ku jądru), rozrzut jasności z ziarna, pył i powłoka migoczą.
      const c1 = mix(vec3(...WHITE), vec3(...ICE), smoothstep(0.0, 0.2, u));
      const c2 = mix(c1, vec3(...AZURE), smoothstep(0.15, 0.55, u));
      const c3 = mix(c2, vec3(...DEEP), smoothstep(0.5, 1.0, u));
      const gain = isIn.mul(u.mul(1.3).add(0.35)).add(isJet.mul(1.1)).add(isEj.mul(0.9)).add(isSh.mul(0.8)).add(isMo.mul(0.8));
      const vary = mix(float(0.3), float(1.6), Dd.y.mul(Dd.y));
      // Iskry wybuchu (wyrzut, powłoka, pył) rozjaśniają się dopiero, gdy się rozejdą — w pierwszej ćwierci życia
      // siedzą jeszcze w ciasnej kuli i razem dawałyby białą plamę.
      const fadeIn = smoothstep(0.0, mix(float(0.05), float(0.3), step(1.5, kind)), u);
      const fade = float(1.0).sub(smoothstep(0.55, 1.0, u)).mul(fadeIn);
      const tw = sin(U.time.mul(37.0).add(Dd.y.mul(91.0))).mul(0.45).add(0.55);
      const twinkle = mix(float(1.0), tw, step(2.5, kind));
      // Dopływ zostaje jasny do końca (ginie w jądrze); reszta stygnie.
      const col = mix(c3, mix(vec3(...ICE), vec3(...AZURE), 0.45), isIn.mul(0.75)).mul(gain.mul(vary).mul(armK))
        .mul(mix(fade, smoothstep(0.0, 0.04, u), isIn)).mul(twinkle).mul(U.gain);
      vA.assign(vec4(q, u, 0.0));
      // Smuga dłuższa niż kwadrat — jasność rozłożona na długości.
      vB.assign(vec4(col.mul(size.div(max(len, 1e-4)).mul(0.7).add(0.3)), 0.0));
      return select(alive, vec3(Pp.xy.add(off), Pp.z.add(24.0)), vec3(0.0, 0.0, -1e5));
    })();
    mat.fragmentNode = Fn(() => {
      const ax = vA.x;
      const ay = vA.y;
      const prof = exp(ay.mul(ay).mul(-3.2)).mul(smoothstep(-1.0, -0.6, ax)).mul(float(1.0).sub(smoothstep(0.75, 1.0, ax)));
      return vec4(max(vB.xyz.mul(prof), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = 'pulsarParticles';
    this.material = mat;
    scene.add(this.mesh);
  }

  /** Stan wybuchu `slot` na tę klatkę: środek (scena), R [j.], oś obrotu S, zapaść 0..1, nośnik [j./s]. */
  setBlast(slot, cx, cy, cz, R, sx, sy, sz, collapse, vx, vy) {
    this.U.pC.array[slot].set(cx, cy, cz, R);
    this.U.pS.array[slot].set(sx, sy, sz, collapse);
    this.U.pV.array[slot].set(vx, vy, 0, 0);
  }

  /**
   * Paczka cząstek wybuchu `slot`: rodzaj (PK), kształt (PSHAPE), liczba, kierunek stożka (dx, dy, dz) i rozrzut
   * 0..1, prędkości s0..s1 [R/s], życie l0..l1 [s], promień startu r0..r1 [R], wir [R/s], rozmiar [j.].
   */
  burst(slot, kind, shape, count, dx, dy, dz, spread, s0, s1, l0, l1, r0, r1, swirl, size) {
    if (this._nBursts >= BURST_CAP || !(count >= 1)) return;
    const b = this._bursts[this._nBursts++];
    b.slot = slot; b.kind = kind; b.shape = shape; b.count = Math.min(count | 0, EMIT_MAX);
    b.dx = dx; b.dy = dy; b.dz = dz; b.spread = spread;
    b.s0 = s0; b.s1 = s1; b.l0 = l0; b.l1 = l1; b.r0 = r0; b.r1 = r1; b.swirl = swirl; b.size = size;
    b.seed = Math.random();
    if (l1 > this.maxLife) this.maxLife = l1;
  }

  /** Krok klatki: emisja paczek, ruch. dt = 0 w pauzie (cząstki stoją). */
  update(dt, time, zoom = 1) {
    const U = this.U;
    this.time += dt > 0 ? dt : 0;
    U.time.value = time % 1000;
    U.zoom.value = zoom;
    const L = this._list || (this._list = []);
    L.length = 0;
    let total = 0;
    const nb = this._nBursts;
    let used = 0;
    for (let k = 0; k < nb; k++) {
      const b = this._bursts[k];
      if (total + b.count > EMIT_MAX) b.count = EMIT_MAX - total;
      if (b.count <= 0) break;
      const l = Math.hypot(b.dx, b.dy, b.dz) || 1;
      U.bA.array[k].set(b.dx / l, b.dy / l, b.dz / l, total);
      U.bB.array[k].set(b.s0, b.s1, b.l0, b.l1);
      U.bC.array[k].set(b.r0, b.r1, b.spread, b.swirl);
      U.bD.array[k].set(b.size, b.kind, b.slot, b.seed);
      U.bE.array[k].set(b.shape, 0, 0, 0);
      total += b.count;
      used = k + 1;
    }
    this._nBursts = 0;
    if (total > 0 && dt > 0) {
      U.nBursts.value = used;
      U.emitCount.value = total;
      U.head.value = this.head;
      this.emitNode.count = total;
      L.push(this.emitNode);
      this.head = (this.head + total) % PULSAR_PARTICLE_CAP;
      this.highWater = Math.min(PULSAR_PARTICLE_CAP, Math.max(this.highWater, this.head === 0 ? PULSAR_PARTICLE_CAP : this.head));
      if (this.head < total) this.highWater = PULSAR_PARTICLE_CAP;
      this.lastEmit = this.time;
      this.stats.spawned += total;
      this.stats.bursts += used;
    }
    if (this.highWater > 0 && dt > 0) {
      U.dt.value = dt;
      U.count.value = this.highWater;
      this.stepNode.count = this.highWater;
      L.push(this.stepNode);
    }
    if (L.length) this.renderer.compute(L);
    // Pula wygasła w całości — od zera (krótszy dispatch i rysunek).
    if (this.highWater > 0 && this.time - this.lastEmit > this.maxLife + 0.5) {
      this.highWater = 0; this.head = 0; this.maxLife = 0;
    }
    this.mesh.count = this.highWater > 1 ? this.highWater : 0;
    this.mesh.visible = this.highWater > 1;
    this.stats.alive = this.highWater;
  }

  /** Rozgrzewka: puste dispatche kerneli (potok siatki — klatką rozgrzewki dema). */
  warm() {
    this.U.emitCount.value = 0;
    this.U.count.value = 0;
    this.emitNode.count = 64;
    this.stepNode.count = 64;
    this.renderer.compute([this.emitNode, this.stepNode]);
  }

  clear() {
    this.highWater = 0; this.head = 0; this.maxLife = 0; this._nBursts = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
