// src/3d/gas/gasVolume.js
//
// OBRAZ GAZU — marsz promienia przez domeny gasGrid (TSL). Dwie drogi, ten sam marsz domeny (`_march`):
//   • `node(depth)` — przebieg PEŁNOEKRANOWY (dema: RTT w połowie rozdzielczości w RenderPipeline, głębia
//     sceny obcina marsz, domeny od najbliższej, wynik składany z obrazem przed bloomem);
//   • `createMeshes()` — BRYŁY DOMEN w passie sceny (gra: Core3D rysuje wszystkie passy do jednego bufora
//     z MSAA i czyści głębię między nimi — tekstury głębi do obcięcia marszu nie ma). Pudło domeny
//     (instancja, strona tylna — kamera może być w środku) liczy promień z przestrzeni widoku (kamera
//     z góry ortho albo perspektywa — rozpoznanie po macierzy rzutu; pozycje lokalne względem początku
//     sceny, bez positionWorld float32), a PŁASZCZYZNA GRY dzieli marsz na dwie warstwy: część za
//     płaszczyzną (od kamery) rysuje się PRZED kadłubami (kolejka nieprzezroczysta — kadłub ją zasłania),
//     część przed płaszczyzną — PO nich (zasłania kadłub). Okręt w dymie jest w dymie bez głębi.
//
// W próbce:
//   • gęstość dymu × detal szumu 3D czytanego z POLA POZYCJI SPOCZYNKOWYCH symulacji (gasGrid: rest —
//     detal jedzie z gazem; dawne fazy mapy przepływu wracały co 0,7 s do startu i dym „szedł i cofał się”),
//     przesunięcie odczytu polem wirowym („kalafior”) z tego samego pola i erozja rzadkich brzegów;
//   • ogień: barwa ciała czarnego z temperatury, sadza świeci wg Kirchhoffa (σ_pochłaniania · B(T)) + czysty
//     płomień frontu spalania, temperatura zaburzona szumem (języki ognia), HDR;
//   • rozpraszanie: słońce × przepuszczalność z objętości światła (samocień kłębów) × faza
//     Henyeya–Greensteina + przybliżenie wielokrotnego rozpraszania (T^¼) + otoczenie + blask ognia
//     z objętości światła (dym przy płomieniu świeci od środka); w grze człon słońca × maska cienia słońca;
//   • całka zachowująca energię: (S − S·e^(−σΔ)) / σ, front-to-back.
// Wyjście premultiplied: (barwa, 1 − przepuszczalność).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, uint, vec3, vec4, uniform, uniformArray, texture3D, screenUV, screenCoordinate,
  getViewPosition, select, mix, clamp, smoothstep, exp, max, min, abs, length, normalize, dot, pow,
  attribute, positionGeometry, positionView, varyingProperty, cameraProjectionMatrix, cameraWorldMatrix
} from 'three/tsl';
import { gasBlackbody, gasFirePower } from './gasCommon.js';

/** Parametry obrazu gazu (uniformy). */
export function createGasLook() {
  return {
    density: 0.65,        // gęstość optyczna dymu [na komórkę na jednostkę dymu]
    albedo: [0.095, 0.085, 0.075], // sadza (para wodna ~0,8 — barwa domeny `tint`)
    sunColor: [1.0, 0.95, 0.88],
    sunGain: 1.5,
    ambient: [0.05, 0.06, 0.08],
    phaseG: 0.35,         // anizotropia HG (podświetlenie pod słońce)
    multiScatter: 0.25,   // udział wielokrotnego rozpraszania
    emission: 1.0,        // mnożnik ognia
    glowGain: 0.55,       // blask ognia w dymie
    detail: 0.6,          // siła detalu szumu
    detailScale: 0.065,   // częstotliwość detalu [kafle szumu / komórka] (wyżej — prążki aliasingu)
    erosion: 0.8,         // erozja rzadkich brzegów
    stepCells: 0.6,       // krok marszu [komórki]
    maxSteps: 150,
    flameNoise: 0.6,      // zaburzenie temperatury szumem (języki ognia)
    warpAmp: 1.4,         // przesunięcie odczytu polem wirowym [komórki]
    warpScale: 0.05,      // częstotliwość pola przesunięcia [kafle szumu / komórka]
    jitter: 1,            // przesunięcie startu marszu (0 = bez — A/B pasów)
    nearFade: 10,         // zasięg wygaszenia gazu przed kamerą [komórki]
    frontDensity: 1.0     // bryły (gra): mnożnik gęstości części PRZED płaszczyzną gry — kadłub widać przez dym nad nim
  };
}

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);
const _m = new THREE.Matrix4();
const byCamDist = (a, b) => a._camD - b._camD;

export class GasVolume {
  /**
   * @param {object} o
   * @param {import('./gasGrid.js').GasGrid} o.grid
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (fxNoise.noise3D)
   * @param {THREE.Data3DTexture} o.curl3D pole wirowe 3D kafelkowe (fxNoise.curl3D) — przesunięcie odczytu
   */
  constructor({ grid, noise3D, curl3D }) {
    this.grid = grid;
    this.noise3D = noise3D;
    this.curl3D = curl3D;
    this.look = createGasLook();
    const S = grid.S;
    this.U = {
      invProj: uniform(new THREE.Matrix4()),
      camWorld: uniform(new THREE.Matrix4()),
      camPos: uniform(new THREE.Vector3()),
      count: uniform(0, 'int'),
      domA: v4Array(S, 'gasDomA'),   // minimum pudła (scena lokalnie), rozmiar komórki h
      domB: v4Array(S, 'gasDomB'),   // slot, mnożnik obrazu, ziarno, —
      domC: v4Array(S, 'gasDomC'),   // barwa dymu rgb, —
      time: uniform(0),
      sunDir: uniform(new THREE.Vector3(0, 1, 0)),
      density: uniform(1), albedo: uniform(new THREE.Vector3(0.5, 0.5, 0.5)),
      sunColor: uniform(new THREE.Vector3(1, 1, 1)), sunGain: uniform(1),
      ambient: uniform(new THREE.Vector3(0.05, 0.05, 0.05)), phaseG: uniform(0.4), multiScatter: uniform(0.4),
      emission: uniform(1), glowGain: uniform(1), detail: uniform(0.5), detailScale: uniform(0.15),
      erosion: uniform(0.5), stepCells: uniform(0.85), maxSteps: uniform(110, 'int'),
      flameNoise: uniform(0.4), fireGain: uniform(1), fireBurn: uniform(1),
      warpAmp: uniform(1.4), warpScale: uniform(0.05), jitter: uniform(1), nearFade: uniform(10),
      frontDensity: uniform(1),
      planeZ: uniform(0)               // płaszczyzna gry (scena lokalnie) — podział warstw brył
    };
    this._order = [];
    this.stats = { domains: 0 };
    this.meshes = null;
  }

  // --- wspólne węzły marszu (wołane wewnątrz Fn) -------------------------------------------------

  /** Przesunięcie startu marszu: biały szum z haszu PCG piksela (IGN dawał regularną kratkę „wafla”). */
  _jitter() {
    const fc = screenCoordinate.xy;
    const hs = uint(fc.x).add(uint(fc.y).mul(uint(7919))).mul(uint(747796405)).add(uint(2891336453)).toVar();
    const hw = hs.shiftRight(hs.shiftRight(uint(28)).add(uint(4))).bitXor(hs).mul(uint(277803737)).toVar();
    const white = float(hw.shiftRight(uint(22)).bitXor(hw)).mul(1 / 4294967296);
    return white.sub(0.5).mul(this.U.jitter).add(0.5).toVar();
  }

  /** Faza Henyeya–Greensteina dla kierunku promienia (zmieszana z izotropową). */
  _phase(rd) {
    const U = this.U;
    const cosT = dot(rd, U.sunDir);
    const g = U.phaseG;
    const g2 = g.mul(g);
    const hg = float(1.0).sub(g2).div(pow(max(float(1.0).add(g2).sub(g.mul(cosT).mul(2.0)), 1e-4), 1.5));
    return mix(float(1.0), hg, 0.85).toVar();
  }

  /** Przedział [tmin, tmax] promienia w pudle domeny (bmin, h). */
  _boxSpan(ro, rd, bmin, h) {
    const N = this.grid.N;
    const NZ = this.grid.NZ;
    const inv = vec3(1.0).div(select(abs(rd).lessThan(vec3(1e-6)), vec3(1e-6), rd)).toVar();
    const bmax = bmin.add(vec3(h.mul(N), h.mul(N), h.mul(NZ)));
    const t0s = bmin.sub(ro).mul(inv);
    const t1s = bmax.sub(ro).mul(inv);
    const tn = min(t0s, t1s);
    const tf = max(t0s, t1s);
    return { tmin: max(max(max(tn.x, tn.y), tn.z), 0.0).toVar(), tmax: min(min(tf.x, tf.y), tf.z).toVar() };
  }

  /**
   * Marsz jednej domeny na odcinku [tmin, tmax] promienia ro + rd·t (scena lokalnie); akumuluje do
   * col / trans (zmienne TSL). sunVis — mnożnik członu słońca (maska cienia słońca gry; dema 1); densK —
   * mnożnik gęstości odcinka (przednia warstwa brył gry).
   */
  _march({ ro, rd, tmin, tmax, bmin, h, slot, fade, seed, tint, jitter, phase, col, trans, sunVis, densK = null }) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const S = grid.S;
    const noise = this.noise3D;
    const curl = this.curl3D;
    If(tmax.greaterThan(tmin), () => {
      const span = tmax.sub(tmin);
      const nSteps = clamp(int(span.div(h.mul(U.stepCells))).add(1), int(2), U.maxSteps).toVar();
      const dtW = span.div(float(nSteps)).toVar();       // krok [j. sceny]
      const dtC = dtW.div(h).toVar();                    // krok [komórki]
      const t = tmin.add(dtW.mul(jitter)).toVar();
      const slotZ = slot.mul(NZ);
      // Temperatura poprzedniej próbki (−1 = brak): emisja całkowana po odcinku (niżej).
      const Tprev = float(-1.0).toVar();
      Loop({ start: int(0), end: nSteps, type: 'int', condition: '<', name: 'gstep' }, () => {
        const pw = ro.add(rd.mul(t));
        const pc = pw.sub(bmin).div(h).toVar();
        const qz = clamp(pc.z, 0.5, NZ - 0.5);
        const uvw = vec3(pc.x.mul(1 / N), pc.y.mul(1 / N), qz.add(slotZ).mul(1 / (NZ * S)));
        const den0 = texture3D(grid.denA, uvw).level(0);
        If(den0.x.add(den0.y).greaterThan(0.003), () => {
          // Pozycja spoczynkowa gazu (komórki) — detal i przesunięcie odczytu jadą z dymem.
          const rest = texture3D(grid.restA, uvw).level(0).xyz.toVar();
          const seedV = vec3(seed, seed.mul(0.7), seed.mul(1.3));
          // Przesunięcie odczytu polem wirowym (detal poniżej rozdzielczości siatki — „kalafior”).
          const qw = rest.mul(U.warpScale).add(seedV);
          const wa = texture3D(curl, qw).level(0).xy;
          const wb = texture3D(curl, qw.zxy.add(vec3(0.29, 0.61, 0.17))).level(0).x;
          const warp = vec3(wa, wb).mul(U.warpAmp);
          const pq = pc.add(warp);
          const uvq = vec3(pq.x.mul(1 / N), pq.y.mul(1 / N), clamp(pq.z, 0.5, NZ - 0.5).add(slotZ).mul(1 / (NZ * S)));
          const den = texture3D(grid.denA, uvq).level(0).toVar();
          const lgt = texture3D(grid.lightT, uvq).level(0).toVar();
          const n1 = texture3D(noise, rest.mul(U.detailScale).add(seedV)).level(0);
          const nA = n1.x.toVar();
          const nB = n1.y.toVar();
          const nd = nA.mul(0.65).add(nB.mul(0.35)).toVar();
          // Miękkie ściany pudła i elipsoida domeny (symulacja gasi gaz za ~0,97 promienia — zapas).
          const ew = min(pc, vec3(N, N, NZ).sub(pc));
          const halfD = vec3(N * 0.5, N * 0.5, NZ * 0.5);
          const rc = length(pc.sub(halfD).div(halfD));
          const wall = smoothstep(0.6, 6.0, min(min(ew.x, ew.y), ew.z)).mul(float(1.0).sub(smoothstep(0.9, 1.05, rc)));
          // Wygaszenie tuż przed kamerą (kamera w dymie / kuli ognia: mgła zamiast nieprzezroczystej ściany).
          const nearK = smoothstep(U.nearFade.mul(0.15), U.nearFade, t.div(h));
          // Ciągły próg pominięcia: gęstość czytamy z PRZESUNIĘTEGO miejsca (warp), a próg — z nieprzesuniętego;
          // skok wkładu z 0 na granicy progu rysował poziomice (bez przesunięcia startu marszu — słoje, z nim — ziarno).
          const gate = smoothstep(0.003, 0.06, den0.x.add(den0.y));
          const fw = fade.mul(wall).mul(nearK).mul(gate).toVar();
          // Gęstość: detal mnożny + erozja rzadkich brzegów (strzępy zamiast gładkiej mgły).
          const sm = den.x.mul(fw).toVar();
          const det = mix(float(1.0), nd.mul(2.0), U.detail);
          const ero = U.erosion.mul(float(1.0).sub(nd)).mul(float(1.0).sub(smoothstep(0.0, 1.2, sm)));
          const rho = max(sm.mul(det).sub(ero.mul(0.35)), 0.0).toVar();
          const sigma = (densK ? rho.mul(U.density).mul(densK) : rho.mul(U.density)).toVar();
          // Ogień: temperatura z językami szumu. Sadza świeci jak ciało czarne (Kirchhoff: emisja =
          // σ_pochłaniania · B(T)); czysty płomień frontu spalania świeci bez sadzy (tempo spalania).
          const T = den.y.mul(float(1.0).add(nA.sub(0.5).mul(2.0).mul(U.flameNoise))).toVar();
          // Emisja ŚREDNIA na odcinku (temperatura liniowo od poprzedniej próbki, 4 podpróbki — sama arytmetyka):
          // front ognia cieńszy niż krok, próbkowany w tych samych płaszczyznach z (kamera z góry), rysował słoje
          // poziomic (bez przesunięcia startu) albo ziarno (z nim). Całka po odcinku je wygładza.
          const T0 = select(Tprev.lessThan(0.0), T, Tprev);
          const gSum = vec3(0.0).toVar();
          const bSum = vec3(0.0).toVar();
          for (const k of [0.125, 0.375, 0.625, 0.875]) {
            const Tk = mix(T0, T, k);
            const bk = gasBlackbody(Tk);
            gSum.addAssign(bk.mul(gasFirePower(Tk, float(0.0), U.fireGain, float(0.0))));
            bSum.addAssign(bk);
          }
          Tprev.assign(T);
          const radiance = gSum.mul(0.25).mul(U.emission).mul(fw);
          const flame = bSum.mul(0.25).mul(max(den.w, 0.0).mul(U.fireBurn)).mul(U.emission).mul(fw);
          // Rozpraszanie: słońce (samocień, maska cienia słońca gry), wielokrotne (T^¼), otoczenie, blask ognia.
          const sunT = lgt.x;
          const sun = U.sunColor.mul(U.sunGain).mul(sunT.mul(phase).add(pow(max(sunT, 1e-4), 0.25).mul(U.multiScatter))).mul(sunVis);
          const alb = U.albedo.mul(tint).toVar();
          const scat = alb.mul(sun.add(U.ambient).add(lgt.yzw.mul(U.glowGain)));
          const segT = exp(sigma.mul(dtC).negate()).toVar();
          const absorb = float(1.0).sub(alb.x.add(alb.y).add(alb.z).div(3.0));
          const src = scat.add(radiance.mul(absorb)).mul(sigma).add(flame);
          const integ = select(sigma.greaterThan(1e-4), src.mul(float(1.0).sub(segT)).div(max(sigma, 1e-4)), src.mul(dtC));
          col.addAssign(integ.mul(trans));
          trans.mulAssign(segT);
        }).Else(() => {
          Tprev.assign(0.0);
        });
        t.addAssign(dtW);
        If(trans.lessThan(0.01), () => { Break(); });
      });
    });
  }

  /**
   * Węzeł obrazu gazu (vec4 premultiplied) dla przebiegu pełnoekranowego (dema). depthNode — tekstura
   * głębi sceny (np. pass(...).getTextureNode('depth')) albo null (bez obcinania).
   */
  node(depthNode) {
    const U = this.U;
    return Fn(() => {
      const uvS = screenUV;
      // Promień z kamery sceny (scena lokalnie względem początku).
      const vFar = getViewPosition(uvS, float(1.0), U.invProj).toVar();
      const rdView = normalize(vFar);
      const rd = normalize(U.camWorld.mul(vec4(rdView, 0.0)).xyz).toVar();
      const ro = U.camPos.toVar();
      const tScene = float(1e9).toVar();
      if (depthNode) {
        const d = depthNode.sample(uvS).x;
        If(d.lessThan(0.99999), () => {
          tScene.assign(length(getViewPosition(uvS, d, U.invProj)));
        });
      }
      const jitter = this._jitter();
      const col = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      const phase = this._phase(rd);
      Loop({ start: int(0), end: U.count, type: 'int', condition: '<', name: 'gdom' }, ({ gdom }) => {
        If(trans.lessThan(0.01), () => { Break(); });
        const A = U.domA.element(gdom).toVar();
        const B = U.domB.element(gdom).toVar();
        const C = U.domC.element(gdom).toVar();
        const { tmin, tmax } = this._boxSpan(ro, rd, A.xyz, A.w);
        this._march({
          ro, rd, tmin, tmax: min(tmax, tScene), bmin: A.xyz, h: A.w, slot: B.x, fade: B.y, seed: B.z, tint: C.xyz,
          jitter, phase, col, trans, sunVis: float(1.0)
        });
      });
      return vec4(col, float(1.0).sub(trans));
    })();
  }

  /**
   * BRYŁY DOMEN do passa sceny (gra): dwie siatki instancji (pudło na domenę) — `back` (część za płaszczyzną
   * gry od kamery; kolejka nieprzezroczysta, renderOrder przed kadłubami) i `front` (część przed płaszczyzną;
   * przezroczysta, po kadłubach). Bez testu i zapisu głębi (kolejność warstw robi zasłanianie).
   * opts: layer (warstwa Core3D), renderOrderBack / Front, sunVisibility — () => węzeł mnożnika słońca.
   */
  createMeshes({ layer = 0, renderOrderBack = 1, renderOrderFront = 26, sunVisibility = null, name = 'GasVolume' } = {}) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const cap = grid.S;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(box.index);
    geo.setAttribute('position', box.getAttribute('position'));
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      return a;
    };
    const aA = mk(4); // minimum pudła (lokalnie), h
    const aB = mk(4); // slot, mnożnik obrazu, ziarno, —
    const aC = mk(4); // barwa dymu rgb, —
    geo.setAttribute('gasA', aA);
    geo.setAttribute('gasB', aB);
    geo.setAttribute('gasC', aC);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const vLocal = varyingProperty('vec3', 'vGasLocal');
    const vA = varyingProperty('vec4', 'vGasA');
    const vB = varyingProperty('vec4', 'vGasB');
    const vC = varyingProperty('vec4', 'vGasC');
    const positionNode = Fn(() => {
      const A = attribute('gasA', 'vec4');
      const size = vec3(A.w.mul(N), A.w.mul(N), A.w.mul(NZ));
      const local = A.xyz.add(positionGeometry.add(0.5).mul(size));
      vLocal.assign(local);
      vA.assign(A);
      vB.assign(attribute('gasB', 'vec4'));
      vC.assign(attribute('gasC', 'vec4'));
      return local;
    })();
    const makeLayer = (back) => {
      const mat = new THREE.NodeMaterial();
      mat.name = `${name}${back ? 'Back' : 'Front'}`;
      mat.transparent = !back;           // tył: kolejka nieprzezroczysta (przed kadłubami), przód: przezroczysta
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.side = THREE.BackSide;
      mat.forceSinglePass = true;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.rulonBend = false;             // rulon warpa (gra): marsz liczy pudło nieugięte
      mat.positionNode = positionNode;
      mat.fragmentNode = Fn(() => {
        const P = vLocal;
        const h = vA.w;
        const size = vec3(h.mul(N), h.mul(N), h.mul(NZ));
        // Promień: z góry (ortho — macierz rzutu [3][3] = 1) wzdłuż osi kamery, inaczej od kamery przez piksel.
        const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
        const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
        const rd = normalize(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz).toVar();
        const ro = select(ortho, P.sub(rd.mul(length(size).mul(2.0))), P.sub(rd.mul(length(positionView)))).toVar();
        const span = this._boxSpan(ro, rd, vA.xyz, h);
        // Płaszczyzna gry: tc — gdzie promień ją przecina (poza zasięgiem — cały promień po stronie kamery).
        const tcRaw = U.planeZ.sub(ro.z).div(select(abs(rd.z).lessThan(1e-6), float(1e-6), rd.z));
        const tc = select(tcRaw.greaterThan(0.0), tcRaw, float(1e12));
        const tmin = back ? max(span.tmin, tc) : span.tmin;
        const tmax = back ? span.tmax : min(span.tmax, tc);
        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        this._march({
          ro, rd, tmin, tmax, bmin: vA.xyz, h, slot: vB.x, fade: vB.y, seed: vB.z, tint: vC.xyz,
          jitter: this._jitter(), phase: this._phase(rd), col, trans,
          sunVis: sunVisibility ? sunVisibility() : float(1.0),
          densK: back ? null : U.frontDensity
        });
        return vec4(col, float(1.0).sub(trans));
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = back ? renderOrderBack : renderOrderFront;
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      return mesh;
    };
    this.meshes = { geometry: geo, attrs: [aA, aB, aC], back: makeLayer(true), front: makeLayer(false) };
    return this.meshes;
  }

  /**
   * Instancje brył tej klatki: domeny względem początku sceny (originX, originY — scena, double), bryły
   * na początku (macierz modelu w double — highPrecision). planeZ — płaszczyzna gry (scena).
   */
  updateMeshes(originX, originY, planeZ = 0) {
    const M = this.meshes;
    if (!M) return 0;
    const grid = this.grid;
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    const [aA, aB, aC] = M.attrs;
    const A = aA.array, B = aB.array, C = aC.array;
    let n = 0;
    for (const s of grid.slots) {
      if (!s.active || s.fade <= 0) continue;
      const o = n * 4;
      A[o] = s.cx - half * s.h - originX; A[o + 1] = s.cy - half * s.h - originY; A[o + 2] = s.cz - halfZ * s.h; A[o + 3] = s.h;
      B[o] = s.index; B[o + 1] = s.fade; B[o + 2] = s.seed; B[o + 3] = 0;
      C[o] = s.tint[0]; C[o + 1] = s.tint[1]; C[o + 2] = s.tint[2]; C[o + 3] = 0;
      n++;
    }
    M.geometry.instanceCount = n;
    for (const mesh of [M.back, M.front]) {
      mesh.visible = n > 0;
      mesh.position.set(originX, originY, 0);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
    }
    if (n) for (const a of M.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    this.U.planeZ.value = planeZ;
    this.stats.domains = n;
    return n;
  }

  /** Parametry obrazu → uniformy (raz na klatkę). */
  syncLook() {
    const U = this.U;
    const L = this.look;
    const grid = this.grid;
    U.sunDir.value.copy(grid.sunDir);
    U.density.value = L.density;
    U.albedo.value.set(L.albedo[0], L.albedo[1], L.albedo[2]);
    U.sunColor.value.set(L.sunColor[0], L.sunColor[1], L.sunColor[2]);
    U.sunGain.value = L.sunGain;
    U.ambient.value.set(L.ambient[0], L.ambient[1], L.ambient[2]);
    U.phaseG.value = L.phaseG;
    U.multiScatter.value = L.multiScatter;
    U.emission.value = L.emission;
    U.glowGain.value = L.glowGain;
    U.detail.value = L.detail;
    U.detailScale.value = L.detailScale;
    U.erosion.value = L.erosion;
    U.stepCells.value = L.stepCells;
    U.maxSteps.value = L.maxSteps;
    U.flameNoise.value = L.flameNoise;
    U.warpAmp.value = L.warpAmp;
    U.warpScale.value = L.warpScale;
    U.jitter.value = L.jitter;
    U.nearFade.value = L.nearFade;
    U.frontDensity.value = L.frontDensity ?? 1;
    U.fireGain.value = grid.tune.fireGain;
    U.fireBurn.value = grid.tune.fireBurn;
  }

  /**
   * Uniformy przebiegu pełnoekranowego tej klatki (dema): kamera sceny (macierze, pozycja względem
   * początku `origin` gridu), domeny od najbliższej, parametry obrazu.
   */
  update(camera, time) {
    const U = this.U;
    const grid = this.grid;
    const o = grid.origin;
    camera.updateMatrixWorld();
    U.invProj.value.copy(camera.projectionMatrixInverse);
    _m.copy(camera.matrixWorld);
    _m.elements[12] = 0; _m.elements[13] = 0; _m.elements[14] = 0;
    U.camWorld.value.copy(_m);
    const cx = camera.matrixWorld.elements[12];
    const cy = camera.matrixWorld.elements[13];
    const cz = camera.matrixWorld.elements[14];
    U.camPos.value.set(cx - o.x, cy - o.y, cz - o.z);
    U.time.value = time % 1000;
    // Domeny od najbliższej (środek pudła).
    const order = this._order;
    order.length = 0;
    for (const s of grid.slots) {
      if (!s.active || s.fade <= 0) continue;
      const dx = s.cx - cx, dy = s.cy - cy, dz = s.cz - cz;
      s._camD = dx * dx + dy * dy + dz * dz;
      order.push(s);
    }
    order.sort(byCamDist);
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    for (let k = 0; k < order.length; k++) {
      const s = order[k];
      U.domA.array[k].set(s.cx - half * s.h - o.x, s.cy - half * s.h - o.y, s.cz - halfZ * s.h - o.z, s.h);
      U.domB.array[k].set(s.index, s.fade, s.seed, 0);
      U.domC.array[k].set(s.tint[0], s.tint[1], s.tint[2], 0);
    }
    U.count.value = order.length;
    this.stats.domains = order.length;
    this.syncLook();
  }
}
