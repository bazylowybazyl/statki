// src/3d/hallGas3d/hallGas3dBench.js
//
// SZKIELET KROKU gazu hali K-7 v2 do pomiaru kosztu (etap E0 briefu docs/BRIEF-gaz-hali-3d.md): kernele o DOCELOWYM
// rozmiarze i wzorcu dostępu do pamięci — te same tekstury 3D RGBA16F, bufory ciśnienia f32 i liczby próbek co krok
// solvera (hallGas3dGrid.js) — ale z arytmetyką zastępczą. Pomiar w demie (dema/3d-gaz.html?bench=1, harness
// scripts/webgpu/3d-gaz-demo.mjs --tryb e0) przy komórce 48 / 56 / 64 j. → wybór komórki wobec budżetu § 11.
//
// Krok (jak w hallGas3dGrid): zajętość → wiry → adwekcja → reakcja (siły, źródła, MacCormack — ~45 próbek, pętla
// strumieni z odrzuceniem po pudle) → pokład (2D, 2× drobniej) → dywergencja (rhs + maska sąsiadów do buforów) →
// Jacobi × K (bufory f32, wariant „tekstura” jak gasGrid — RGBA16F) → rzut. Jeden renderer.compute(lista) na krok.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec3, vec4, uvec3, uvec2, vec2, uniform, instanceIndex, instancedArray,
  texture, texture3D, textureStore, max, min, clamp, abs, dot, length, exp, select
} from 'three/tsl';
import { hallGas3dDomain, hallGas3dMemory } from './hallGas3dLayout.js';

const JET_STRIDE = 6;   // vec4 na strumień (jak w hallGasGrid: wierzchołek, oś, profil, źródło, wstrzykiwanie, pudło)

function tex3(nx, nd, nh, name) {
  const t = new THREE.Storage3DTexture(nx, nd, nh);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function tex2(w, h, name) {
  const t = new THREE.StorageTexture(w, h);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class HallGas3dBench {
  /**
   * @param {object} o
   * @param {number} o.cell bok komórki [j.]
   * @param {number} [o.jacobi] iteracje ciśnienia (30)
   * @param {'buffer'|'texture'} [o.pressure] ciśnienie w buforach f32 (domyślnie) albo w teksturach RGBA16F (gasGrid)
   * @param {number} [o.jets] strumieni w pętli reakcji (dysze MAIN per dysza, SIDE, źródła hali)
   */
  constructor({ cell, jacobi = 30, pressure = 'buffer', jets = 96, layout = undefined } = {}) {
    const dom = this.domain = hallGas3dDomain(layout, cell);
    this.jacobi = jacobi;
    this.pressure = pressure;
    const { nx, nd, nh } = dom;
    const names = ['velA', 'velB', 'velC', 'denA', 'denB', 'denC', 'curlT', 'occT'];
    this.tex = {};
    for (const n of names) this.tex[n] = tex3(nx, nd, nh, `hallGas3dBench_${n}`);
    // statyczna zajętość (RGBA8 w docelowym — tu RGBA16F z zerami: koszt próbki ten sam rząd)
    this.tex.stat = tex3(nx, nd, nh, 'hallGas3dBench_stat');
    this.tex.deckA = tex2(dom.deckNx, dom.deckNd, 'hallGas3dBench_deckA');
    this.tex.deckB = tex2(dom.deckNx, dom.deckNd, 'hallGas3dBench_deckB');
    if (pressure === 'texture') {
      this.tex.prsA = tex3(nx, nd, nh, 'hallGas3dBench_prsA');
      this.tex.prsB = tex3(nx, nd, nh, 'hallGas3dBench_prsB');
    } else {
      this.pA = instancedArray(dom.cells, 'float').setName('hallGas3dBench_pA');
      this.pB = instancedArray(dom.cells, 'float').setName('hallGas3dBench_pB');
      this.rhs = instancedArray(dom.cells, 'float').setName('hallGas3dBench_rhs');
      this.mask = instancedArray(dom.cells, 'uint').setName('hallGas3dBench_mask');
    }
    this.jetCap = Math.max(1, jets);
    this.jetBuf = instancedArray(this.jetCap * JET_STRIDE, 'vec4').setName('hallGas3dBench_jets');
    this._fillJets(jets);
    this.U = { dt: uniform(1 / 60), jetCount: uniform(jets, 'int'), warm: uniform(0.9), active: uniform(1) };
    this._build();
  }

  /** Strumienie zastępcze: pudła w hali (większość komórek je odrzuca jak w prawdziwej klatce). */
  _fillJets(n) {
    const a = this.jetBuf.value.array;
    const { nx, nd, nh } = this.domain;
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let j = 0; j < n; j++) {
      const o = j * JET_STRIDE * 4;
      const cx = 10 + rnd() * (nx - 20), cy = 10 + rnd() * (nd - 20), cz = 1 + rnd() * 4;
      const ang = rnd() * Math.PI * 2;
      const L = j < 10 ? 50 : 8;            // dysze MAIN — długie stożki, źródła hali — krótkie
      a.set([cx, cy, cz, 0], o);                                // wierzchołek
      a.set([Math.cos(ang), Math.sin(ang), 0, L], o + 4);       // oś, długość
      a.set([1.2, 0.15, 50, 7], o + 8);                         // szerokość, rozszerzanie, prędkość, narzucanie
      a.set([3, 12, 1, 0], o + 12);                             // źródło objętości
      const r = L * 0.6 + 4;
      a.set([cx - r, cy - r, cz - r, 0], o + 16);               // pudło: minimum
      a.set([cx + r, cy + r, cz + r, 0], o + 20);               //        maksimum
    }
    this.jetBuf.value.needsUpdate = true;
  }

  get memoryBytes() {
    const texN = 9 + (this.pressure === 'texture' ? 2 : 0);
    return hallGas3dMemory(this.domain, { tex3: texN, statTex: 0, buf: this.pressure === 'texture' ? 0 : 4, deckTex: 2 });
  }

  _build() {
    const dom = this.domain;
    const { nx, nd, nh, cells } = dom;
    const T = this.tex;
    const U = this.U;
    const dims = vec3(nx, nd, nh);
    const at = (tex, p) => texture3D(tex, clamp(p, vec3(0.5), vec3(nx - 0.5, nd - 0.5, nh - 0.5)).div(dims)).level(0);
    const cell = () => {
      If(instanceIndex.greaterThanEqual(uint(cells)), () => { Return(); });
      const xi = int(instanceIndex.mod(uint(nx))).toVar();
      const yi = int(instanceIndex.div(uint(nx)).mod(uint(nd))).toVar();
      const zi = int(instanceIndex.div(uint(nx * nd))).toVar();
      const p = vec3(float(xi), float(yi), float(zi)).add(0.5).toVar();
      return { xi, yi, zi, p, store: uvec3(uint(xi), uint(yi), uint(zi)).toVar() };
    };
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const K = [];
    const kernel = (fn, count, name) => { const k = Fn(fn)().compute(count).setName(name); K.push(k); return k; };

    // zajętość: statyczna + pętla 16 kadłubów (tu sama arytmetyka) → occT
    this.kOcc = kernel(() => {
      const c = cell();
      const s = at(T.stat, c.p).toVar();
      const acc = float(0).toVar();
      Loop({ start: int(0), end: int(16), type: 'int', condition: '<', name: 'bHull' }, ({ bHull }) => {
        const q = c.p.xy.sub(vec2(float(bHull).mul(13.0), 40.0));
        If(abs(q.x).lessThan(20.0).and(abs(q.y).lessThan(10.0)), () => { acc.addAssign(1.0); });
      });
      textureStore(T.occT, c.store, vec4(s.x.add(acc.mul(0.001)), s.y, s.z, 0.0));
    }, cells, 'hgbOcc');

    this.kCurl = kernel(() => {
      const c = cell();
      const v = N6.map((d) => at(T.velA, c.p.add(vec3(...d))).xyz);
      const w = vec3(v[2].z.sub(v[3].z).sub(v[4].y.sub(v[5].y)), v[4].x.sub(v[5].x).sub(v[0].z.sub(v[1].z)),
        v[0].y.sub(v[1].y).sub(v[2].x.sub(v[3].x))).mul(0.5).toVar();
      textureStore(T.curlT, c.store, vec4(w, length(w)));
    }, cells, 'hgbCurl');

    this.kAdv = kernel(() => {
      const c = cell();
      const v0 = at(T.velA, c.p).xyz.toVar();
      const vm = at(T.velA, c.p.sub(v0.mul(U.dt.mul(0.5)))).xyz;
      const pb = c.p.sub(vm.mul(U.dt)).toVar();
      const vPb = at(T.velA, pb).toVar();
      const d = at(T.denA, pb).toVar();
      textureStore(T.denB, c.store, d.div(max(float(1.0).sub(vPb.w), 0.2)));
      textureStore(T.velC, c.store, vec4(vPb.xyz, 0.0));
    }, cells, 'hgbAdvect');

    this.kReact = kernel(() => {
      const c = cell();
      const p = c.p;
      const v0 = at(T.velA, p).xyz.toVar();
      const vm = at(T.velA, p.sub(v0.mul(U.dt.mul(0.5)))).xyz;
      const pb = p.sub(vm.mul(U.dt)).toVar();
      const fwd = p.add(v0.mul(U.dt)).toVar();
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      const lo = vec4(1e6).toVar();
      const hi = vec4(-1e6).toVar();
      const loV = vec3(1e6).toVar();
      const hiV = vec3(-1e6).toVar();
      for (let i = 0; i < 8; i++) {
        const o = vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1);
        const s = at(T.denA, b0.add(o));
        lo.assign(min(lo, s)); hi.assign(max(hi, s));
        const sv = at(T.velA, b0.add(o)).xyz;
        loV.assign(min(loV, sv)); hiV.assign(max(hiV, sv));
      }
      const mcV = at(T.velC, p).xyz.add(v0.sub(at(T.velC, fwd).xyz).mul(0.5));
      const vel = clamp(mcV, loV, hiV).toVar();
      const den = clamp(at(T.denB, p).add(at(T.denA, p).sub(at(T.denB, fwd)).mul(0.5)), lo, hi).toVar();
      // wiry (7 próbek), zajętość (7 próbek), pył nad komórką (opadanie), pokład (4 próbki)
      const om = at(T.curlT, p).toVar();
      const occ = at(T.occT, p).toVar();
      const g = vec3(0.0).toVar();
      for (const d of N6) {
        g.addAssign(at(T.curlT, p.add(vec3(...d))).www);
        g.addAssign(at(T.occT, p.add(vec3(...d))).xxx);
      }
      const above = at(T.denA, p.add(vec3(0, 0, 1))).x;
      const dk = float(0.0).toVar();
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        dk.addAssign(texture(T.deckA, p.xy.sub(0.5).add(vec2(ox, oy)).div(vec2(nx, nd))).level(0).x);
      }
      // strumienie: pętla z odrzuceniem po pudle
      const jv = vec3(0.0).toVar();
      const src = float(0.0).toVar();
      Loop({ start: int(0), end: U.jetCount, type: 'int', condition: '<', name: 'bJet' }, ({ bJet }) => {
        const o = bJet.mul(JET_STRIDE);
        const bmin = this.jetBuf.element(o.add(4)).xyz;
        const bmax = this.jetBuf.element(o.add(5)).xyz;
        If(p.x.greaterThan(bmin.x).and(p.x.lessThan(bmax.x)).and(p.y.greaterThan(bmin.y)).and(p.y.lessThan(bmax.y))
          .and(p.z.greaterThan(bmin.z)).and(p.z.lessThan(bmax.z)), () => {
          const A = this.jetBuf.element(o).toVar();
          const B = this.jetBuf.element(o.add(1)).toVar();
          const C = this.jetBuf.element(o.add(2)).toVar();
          const rel = p.sub(A.xyz).toVar();
          const along = dot(rel, B.xyz).toVar();
          const across2 = dot(rel, rel).sub(along.mul(along));
          const wdt = C.x.add(max(along, 0.0).mul(C.y));
          const prof = exp(across2.div(wdt.mul(wdt)).mul(-2.2)).toVar();
          jv.addAssign(B.xyz.mul(C.z.mul(prof)));
          src.addAssign(this.jetBuf.element(o.add(3)).x.mul(prof));
        });
      });
      vel.addAssign(jv.mul(U.dt).add(g.mul(0.001)).add(om.xyz.mul(0.001)));
      vel.assign(select(occ.x.greaterThan(0.5), vec3(0.0), vel));
      textureStore(T.velB, c.store, vec4(vel, src));
      textureStore(T.denC, c.store, max(den.add(vec4(dk.mul(0.001), above.mul(0.001), 0.0, 0.0)), vec4(0.0)));
    }, cells, 'hgbReact');

    // pokład 2D (2× drobniej): ścinanie z warstwy 0, pył warstwy 0 (4 próbki), depozyt
    const deckCells = dom.deckCells;
    const dnx = dom.deckNx;
    this.kDeck = kernel(() => {
      If(instanceIndex.greaterThanEqual(uint(deckCells)), () => { Return(); });
      const xi = int(instanceIndex.mod(uint(dnx))).toVar();
      const yi = int(instanceIndex.div(uint(dnx))).toVar();
      const q = vec2(float(xi), float(yi)).add(0.5).mul(0.5).toVar();   // komórki siatki 3D
      const v = at(T.velA, vec3(q, 0.5)).xyz;
      const air = float(0.0).toVar();
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) air.addAssign(at(T.denA, vec3(q.add(vec2(ox, oy)), 0.5)).x);
      const d = texture(T.deckA, q.div(vec2(nx, nd))).level(0).toVar();
      textureStore(T.deckB, uvec2(uint(xi), uint(yi)), vec4(d.x.add(air.mul(0.001)).sub(length(v).mul(0.0001)), d.y, 0.0, 0.0));
    }, deckCells, 'hgbDeck');
    this.kDeckCopy = kernel(() => {
      If(instanceIndex.greaterThanEqual(uint(deckCells)), () => { Return(); });
      const xi = int(instanceIndex.mod(uint(dnx))).toVar();
      const yi = int(instanceIndex.div(uint(dnx))).toVar();
      const uv = vec2(float(xi), float(yi)).add(0.5).div(vec2(dom.deckNx, dom.deckNd));
      textureStore(T.deckA, uvec2(uint(xi), uint(yi)), texture(T.deckB, uv).level(0));
    }, deckCells, 'hgbDeckCopy');

    if (this.pressure === 'texture') this._buildPressureTex(at, cell, N6, kernel);
    else this._buildPressureBuf(at, cell, N6, kernel);
    this.kernels = K;
  }

  // Ciśnienie w buforach f32: dywergencja pisze rhs i maskę sąsiadów (2 bity na sąsiada: płyn / stały / brzeg otwarty),
  // Jacobi czyta 7 wartości p + maskę + rhs, rzut — gradient z bufora.
  _buildPressureBuf(at, cell, N6, kernel) {
    const { nx, nd, nh, cells } = this.domain;
    const T = this.tex;
    const U = this.U;
    const stride = [1, -1, nx, -nx, nx * nd, -nx * nd];
    const inDom = (c, k) => [c.xi.lessThan(int(nx - 1)), c.xi.greaterThan(int(0)), c.yi.lessThan(int(nd - 1)),
      c.yi.greaterThan(int(0)), c.zi.lessThan(int(nh - 1)), c.zi.greaterThan(int(0))][k];
    this.kDiv = kernel(() => {
      const c = cell();
      const v = N6.map((d) => at(T.velB, c.p.add(vec3(...d))));
      const div = v[0].x.sub(v[1].x).add(v[2].y.sub(v[3].y)).add(v[4].z.sub(v[5].z)).mul(0.5).sub(at(T.velB, c.p).w);
      const m = uint(0).toVar();
      N6.forEach((d, k) => {
        const s = at(T.occT, c.p.add(vec3(...d))).x;
        m.assign(m.bitOr(select(inDom(c, k), select(s.greaterThan(0.5), uint(1), uint(0)), uint(2)).shiftLeft(uint(k * 2))));
      });
      this.rhs.element(instanceIndex).assign(div);
      this.mask.element(instanceIndex).assign(m);
      this.pA.element(instanceIndex).assign(this.pB.element(instanceIndex).mul(U.warm));
    }, cells, 'hgbDiv');
    const jac = (src, dst, name) => kernel(() => {
      const c = cell();
      const i = instanceIndex;
      const m = this.mask.element(i).toVar();
      const q0 = src.element(i).toVar();
      const sum = float(0.0).toVar();
      for (let k = 0; k < 6; k++) {
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const j = int(i).add(int(stride[k]));
        const nb = src.element(uint(clamp(j, int(0), int(cells - 1)))).toVar();
        sum.addAssign(select(code.equal(uint(0)), nb, select(code.equal(uint(1)), q0, float(0.0))));
      }
      void c;
      dst.element(i).assign(sum.sub(this.rhs.element(i)).div(6.0));
    }, cells, name);
    this.kJacAB = jac(this.pA, this.pB, 'hgbJacobiAB');
    this.kJacBA = jac(this.pB, this.pA, 'hgbJacobiBA');
    this.kProj = kernel(() => {
      const c = cell();
      const i = instanceIndex;
      const m = this.mask.element(i).toVar();
      const q0 = this.pB.element(i).toVar();
      const P = (k) => {
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const nb = this.pB.element(uint(clamp(int(i).add(int(stride[k])), int(0), int(cells - 1))));
        return select(code.equal(uint(0)), nb, select(code.equal(uint(1)), q0, float(0.0)));
      };
      const grad = vec3(P(0).sub(P(1)), P(2).sub(P(3)), P(4).sub(P(5))).mul(0.5);
      const vb = at(T.velB, c.p).toVar();
      const occ = at(T.occT, c.p).toVar();
      const v = vb.xyz.sub(grad).toVar();
      textureStore(T.velA, c.store, vec4(v, occ.x));
      textureStore(T.denA, c.store, at(T.denC, c.p));
    }, cells, 'hgbProject');
  }

  // Wariant gasGrid: ciśnienie w teksturach RGBA16F (p, rhs, flaga) — porównanie z buforami f32.
  _buildPressureTex(at, cell, N6, kernel) {
    const { nx, nd, nh, cells } = this.domain;
    const T = this.tex;
    const U = this.U;
    this.kDiv = kernel(() => {
      const c = cell();
      const v = N6.map((d) => at(T.velB, c.p.add(vec3(...d))));
      const div = v[0].x.sub(v[1].x).add(v[2].y.sub(v[3].y)).add(v[4].z.sub(v[5].z)).mul(0.5).sub(at(T.velB, c.p).w);
      const solid = at(T.occT, c.p).x.greaterThan(0.5);
      textureStore(T.prsA, c.store, vec4(at(T.prsB, c.p).x.mul(U.warm), div, select(solid, float(1.0), float(0.0)), 0.0));
    }, cells, 'hgbDivTex');
    const jac = (src, dst, name) => kernel(() => {
      const c = cell();
      const C0 = at(src, c.p).toVar();
      const inD = [c.xi.lessThan(int(nx - 1)), c.xi.greaterThan(int(0)), c.yi.lessThan(int(nd - 1)), c.yi.greaterThan(int(0)),
        c.zi.lessThan(int(nh - 1)), c.zi.greaterThan(int(0))];
      const sum = float(0.0).toVar();
      N6.forEach((d, k) => {
        const s = at(src, c.p.add(vec3(...d))).toVar();
        sum.addAssign(select(inD[k], select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0)));
      });
      textureStore(dst, c.store, vec4(select(C0.z.greaterThan(0.5), float(0.0), sum.sub(C0.y).div(6.0)), C0.y, C0.z, 0.0));
    }, cells, name);
    this.kJacAB = jac(T.prsA, T.prsB, 'hgbJacobiTexAB');
    this.kJacBA = jac(T.prsB, T.prsA, 'hgbJacobiTexBA');
    this.kProj = kernel(() => {
      const c = cell();
      const P = N6.map((d) => at(T.prsB, c.p.add(vec3(...d))).x);
      const grad = vec3(P[0].sub(P[1]), P[2].sub(P[3]), P[4].sub(P[5])).mul(0.5);
      const vb = at(T.velB, c.p).toVar();
      textureStore(T.velA, c.store, vec4(vb.xyz.sub(grad), at(T.occT, c.p).x));
      textureStore(T.denA, c.store, at(T.denC, c.p));
    }, cells, 'hgbProjectTex');
  }

  /** Lista kerneli jednego kroku (części: 'all' | 'adv' | 'react' | 'jacobi' | 'rest'). */
  stepList(part = 'all', out = []) {
    out.length = 0;
    const jac = () => { for (let k = 0; k < this.jacobi; k++) out.push(k % 2 === 0 ? this.kJacAB : this.kJacBA); };
    if (part === 'adv') { out.push(this.kAdv); return out; }
    if (part === 'react') { out.push(this.kReact); return out; }
    if (part === 'jacobi') { jac(); return out; }
    if (part === 'rest') { out.push(this.kOcc, this.kCurl, this.kDeck, this.kDeckCopy, this.kDiv, this.kProj); return out; }
    out.push(this.kOcc, this.kCurl, this.kAdv, this.kReact, this.kDeck, this.kDeckCopy, this.kDiv);
    jac();
    out.push(this.kProj);
    return out;
  }

  /**
   * Pomiar: czas do skończenia pracy kolejki dla n0 / n1 kroków (po 2 próby, minimum) — nachylenie = czas GPU kroku
   * (onSubmittedWorkDone ma stałe opóźnienie ~ms w headless). cpuMs — czas kodowania kroków (część synchroniczna).
   */
  async measure(renderer, part = 'all', n0 = 20, n1 = 120) {
    const dev = renderer.backend.device;
    const list = this.stepList(part, []);
    const run = async (n) => {
      let best = Infinity, cpu = 0;
      for (let k = 0; k < 2; k++) {
        await dev.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) renderer.compute(list);
        const t1 = performance.now();
        await dev.queue.onSubmittedWorkDone();
        const t = performance.now() - t0;
        if (t < best) { best = t; cpu = t1 - t0; }
      }
      return { t: best, cpu };
    };
    // rozgrzewka (pipeline'y compute powstają synchronicznie przy pierwszym użyciu)
    renderer.compute(list);
    await dev.queue.onSubmittedWorkDone();
    const a = await run(n0);
    const b = await run(n1);
    return {
      part, dispatches: list.length,
      msPerStep: +((b.t - a.t) / (n1 - n0)).toFixed(4),
      cpuMsPerStep: +((b.cpu) / n1).toFixed(4),
      raw: { n0, t0: +a.t.toFixed(2), n1, t1: +b.t.toFixed(2) }
    };
  }

  dispose() {
    for (const t of Object.values(this.tex)) t.dispose();
    for (const b of [this.pA, this.pB, this.rhs, this.mask, this.jetBuf]) b?.value?.dispose?.();
  }
}
