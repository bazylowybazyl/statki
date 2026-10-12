// src/3d/hallGas3d/hallGas3dGrid.js
//
// GAZ I PYŁ HALI K-7 v2 — SOLVER na siatce 3D (compute WebGPU, TSL; docs/BRIEF-gaz-hali-3d.md § 5, plan
// docs/PLAN-3d-gaz.md). Jedna siatka na halę: komórka h (56 j.), nx × nd × nh (x hali, głąb, wysokość od pokładu).
// Gaz nieściśliwy ze ŹRÓDŁAMI OBJĘTOŚCI (dysze pchają, nie zasysają), rzut ciśnienia Jacobi z rozgrzaniem, Neumann na
// przeszkodach, p = 0 na brzegach domeny (brama, otwarty dach, poza halą), pokład bez przenikania z tarciem.
// Skalary: PYŁ w powietrzu, PARA (ciężka — opada), SPALINY (udział gazu z dysz — rozrzedzają pył), TEMPERATURA (wypór).
// KURZ NA POKŁADZIE — pole 2D 2× drobniejsze, wymiana masy z warstwą 0 DOKŁADNIE zachowawcza (te same liczby po obu
// stronach: kernel pokładu liczy podrywanie i opadanie, rzut dodaje do komórki 3D sumę czterech komórek pokładu).
//
// Układ: komórki domeny (x, y = głąb hali, z = wysokość), prędkość w komórkach/s. Dane tylko w komórkach — świat gry
// widzi wyłącznie obraz (hallGas3dVolume.js). Zero window / DOM (render w workerze = przekazanie tablicy wejścia).
//
// KROK (raz na klatkę, dt czasu gry z sufitem; jeden renderer.compute(lista)):
//   1. zajętość  — statyka (wokselizacja brył z 64 próbek) ∪ dach (zamknięty poza otworem) ∪ PŁYTA kadłubów 48–116 ×
//                  maska obrysu (żywe węzły belek), prędkość przeszkody (ciało + ω × r) → occT,
//   2. wiry      — ω, |ω| z velA → curlT,
//   3. adwekcja  — RK2 wstecz; φ̂ skalarów (próbka bez komórek stałych) → denB, v̂ → velC (MacCormack prędkości),
//   4. reakcja   — MacCormack prędkości i skalarów z obcięciem, dyfuzja (strumienie symetryczne), strumienie (dysze MAIN
//                  per dysza, SIDE, źródła hali: stożki i buchy promieniowe — prędkość, źródło objętości, spaliny,
//                  temperatura, para, pył; zasłanianie marszem po polu odległości), wiry, wypór, ciężka para,
//                  turbulencja, opór, tarcie przy pokładzie / płycie kadłuba, zanik w próżni → velB (v, cel dywergencji),
//                  denC,
//   5. pokład    — podrywanie i opadanie kurzu (2D, komórka h / 2) → deckB (depozyt, zmiana pyłu warstwy 0),
//   6. dywergencja — prawa strona (div − cel), maska sąsiadów (płyn / stały / brzeg otwarty), rozgrzanie → bufory f32,
//   7. Jacobi × K (bufory f32 — 2× szybciej niż RGBA16F, ciśnienie bez gubienia precyzji f16),
//   8. rzut      — v −= ∇p, sufit prędkości, bez wnikania w przeszkody (prędkość ściany), opadanie pyłu piętro niżej
//                  (zachowawczo), wymiana z pokładem w warstwie 0 → velA, denA,
//   9. kopia pokładu deckB → deckA.
// Żaden kernel nie czyta i nie pisze tej samej tekstury; ≤ 2 tekstury storage zapisu i ≤ 4 bufory storage na kernel.
// Zapis RGBA16F z ZAOKRĄGLENIEM STOCHASTYCZNYM (src/3d/tsl/zapisF16.js — RTX obcina ku zeru: drobne przyrosty ginęłyby).
// LUSTRA CPU formuł: hallGas3dLayout.js (profil i wydatek stożka, zajętość, Jacobi / rzut komórki, opadanie, pokład).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Break, float, int, uint, vec2, vec3, vec4, uvec2, uvec3, uniform, instanceIndex, instancedArray,
  texture, texture3D, textureStore, select, mix, clamp, smoothstep, exp, max, min, abs, length, dot, cross, sqrt, floor
} from 'three/tsl';
import { sroundF16, rndF16, rndF16Next, ensureHalfRoundingProbe, F16_ROUNDING } from '../tsl/zapisF16.js';
import { HALL_GAS3D_JET, HALL_GAS3D_JET_K, HALL_GAS3D_SRC_WIDE, HALL_GAS3D_HULL, HALL_GAS3D_ROOF, createHallGas3dTune } from './hallGas3dLayout.js';
import { HALL_DUST_MASK } from '../gasField/hallDustLayout.js';

/** Rekordy w buforze `recs` (vec4): kadłuby (3 na kadłub), potem strumienie (HALL_GAS3D_JET.stride / 4 na strumień). */
export const HALL_GAS3D_BODY_VEC4 = 3;
export const HALL_GAS3D_JET_VEC4 = HALL_GAS3D_JET.stride / 4;

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

export class HallGas3dGrid {
  /**
   * @param {object} o
   * @param {object} o.domain hallGas3dDomain
   * @param {Uint8Array} o.stat rastr statyczny RGBA8 (rasterizeHallGas3d().data)
   * @param {Float32Array} o.deckStart wzór startowy kurzu na pokładzie (hallGas3dDeckStart)
   * @param {THREE.Data3DTexture} o.noise3D szum 3D (fxNoise.noise3D)
   * @param {number} [o.maxBodies] kadłubów na klatkę (16 — HALL_DUST_MAX_SHIPS)
   * @param {number} [o.jetCap] strumieni na klatkę (dysze MAIN per dysza + SIDE + źródła hali)
   */
  constructor({ domain, stat, deckStart, noise3D, maxBodies = 16, jetCap = 160, tune = null }) {
    const dom = this.domain = domain;
    const { nx, nd, nh, cells, deckNx, deckNd } = dom;
    this.noise3D = noise3D;
    this.maxBodies = maxBodies;
    this.jetCap = jetCap;
    this.tune = tune || createHallGas3dTune();
    this.jacobi = this.tune.jacobi | 1;
    this.solver = this.tune.solver === 'jacobi' ? 'jacobi' : 'sor';   // wybór przy budowie (kernele dywergencji i rzutu)
    this.sorIters = Math.max(1, this.tune.sorIters | 0);
    this.time = 0;
    this._seed = 0;
    this._clear = true;
    this.stats = { steps: 0, dispatches: 0, jets: 0, bodies: 0 };

    // statyka (RGBA8: zajętość, wnętrze hali, odległość od przeszkody × 4, kolumna w obrysie)
    this.statTex = new THREE.Data3DTexture(stat, nx, nd, nh);
    this.statTex.name = 'hallGas3dStat';
    this.statTex.format = THREE.RGBAFormat;
    this.statTex.type = THREE.UnsignedByteType;
    this.statTex.minFilter = THREE.LinearFilter;
    this.statTex.magFilter = THREE.LinearFilter;
    this.statTex.wrapS = this.statTex.wrapT = this.statTex.wrapR = THREE.ClampToEdgeWrapping;
    this.statTex.generateMipmaps = false;
    this.statTex.unpackAlignment = 1;
    this.statTex.colorSpace = THREE.NoColorSpace;
    this.statTex.needsUpdate = true;
    // wzór startowy pokładu (R8 — 1/255 wystarcza, czyta go tylko zerowanie)
    const deck8 = new Uint8Array(deckNx * deckNd * 4);
    for (let i = 0; i < deckNx * deckNd; i++) deck8[i * 4] = Math.round(Math.min(1, Math.max(0, deckStart[i])) * 255);
    this.deckStartTex = new THREE.DataTexture(deck8, deckNx, deckNd, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.deckStartTex.name = 'hallGas3dDeckStart';
    this.deckStartTex.minFilter = THREE.NearestFilter;
    this.deckStartTex.magFilter = THREE.NearestFilter;
    this.deckStartTex.generateMipmaps = false;
    this.deckStartTex.flipY = false;
    this.deckStartTex.colorSpace = THREE.NoColorSpace;
    this.deckStartTex.needsUpdate = true;

    this.velA = tex3(nx, nd, nh, 'hallGas3dVelA');   // v (x, głąb, w górę) [kom./s], flaga komórki stałej
    this.velB = tex3(nx, nd, nh, 'hallGas3dVelB');   // v po reakcji, cel dywergencji [1/s]
    this.velC = tex3(nx, nd, nh, 'hallGas3dVelC');   // v̂ (MacCormack prędkości)
    this.denA = tex3(nx, nd, nh, 'hallGas3dDenA');   // pył, para, spaliny, temperatura
    this.denB = tex3(nx, nd, nh, 'hallGas3dDenB');   // φ̂
    this.denC = tex3(nx, nd, nh, 'hallGas3dDenC');   // po reakcji
    this.curlT = tex3(nx, nd, nh, 'hallGas3dCurl');  // ω, ∇·v (velA)
    this.lapT = tex3(nx, nd, nh, 'hallGas3dLap');    // ∇²v (velA, 7 punktów) — filtr biharmoniczny w reakcji
    this.faceT = tex3(nx, nd, nh, 'hallGas3dFace');  // prędkości ŚCIAN +x, +y, +z komórki (Rhie–Chow) — transport
    this.occT = tex3(nx, nd, nh, 'hallGas3dOcc');    // zajętość 0..1, prędkość przeszkody [kom./s]
    this.deckA = tex2(deckNx, deckNd, 'hallGas3dDeckA');   // depozyt kurzu (0..1), —
    this.deckB = tex2(deckNx, deckNd, 'hallGas3dDeckB');   // depozyt po kroku, zmiana pyłu warstwy 0 (jedn. powietrza)
    this.pA = instancedArray(cells, 'float').setName('hallGas3dPA');
    this.pB = instancedArray(cells, 'float').setName('hallGas3dPB');
    this.rhs = instancedArray(cells, 'float').setName('hallGas3dRhs');
    this.mask = instancedArray(cells, 'uint').setName('hallGas3dMask');

    // Rekordy klatki (vec4): kadłuby (kotwica + macierz K, przesunięcie, prędkość + ω — hallBodyUniforms) i strumienie
    // (HALL_GAS3D_JET). Wysyłka tylko użytego wycinka (właściciel — hallGas3d.js: zbierzZakres).
    this.jetBase = maxBodies * HALL_GAS3D_BODY_VEC4;
    this.recs = instancedArray(this.jetBase + jetCap * HALL_GAS3D_JET_VEC4, 'vec4').setName('hallGas3dRecs');
    const arr = this.recs.value.array;
    this.bodies = new Float32Array(arr.buffer, 0, maxBodies * 12);
    this.jets = new Float32Array(arr.buffer, this.jetBase * 16, jetCap * HALL_GAS3D_JET.stride);
    this.jetCount = 0;
    this.bodyCount = 0;

    // Maski OBRYSU kadłubów (R8, pas maskH wierszy na slot — jak pole 2D): kadłub rozcina gaz swoim kształtem.
    this.maskW = HALL_DUST_MASK.w;
    this.maskH = HALL_DUST_MASK.h;
    this.maskData = new Uint8Array(this.maskW * this.maskH * maxBodies);
    this.maskTex = new THREE.DataTexture(this.maskData, this.maskW, this.maskH * maxBodies, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.name = 'hallGas3dBodyMasks';
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.wrapS = this.maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTex.generateMipmaps = false;
    this.maskTex.flipY = false;
    this.maskTex.unpackAlignment = 1;
    this.maskTex.colorSpace = THREE.NoColorSpace;
    this.maskTex.needsUpdate = true;
    this._masksDirty = false;

    const u = (v, t) => uniform(v, t);
    this.U = {
      active: u(0), seed: u(0, 'uint'), dt: u(1 / 60), time: u(0),
      jetCount: u(0, 'int'), bodyCount: u(0, 'int'),
      // dach: otwarcie (ułamek), prostokąt otworu [komórki: x0, głąb0, x1, głąb1], spód płyty [komórki]
      roofOpen: u(0), roofRect: u(new THREE.Vector4(0, 0, 0, 0)), roofY0: u(HALL_GAS3D_ROOF.y0 / dom.h),
      hullY0: u(HALL_GAS3D_HULL.y0 / dom.h), hullY1: u(HALL_GAS3D_HULL.y1 / dom.h),
      drag: u(0), dragQuad: u(0), dragFrontLo: u(0), dragFrontHi: u(0), vorticity: u(0), turbulence: u(0),
      turbScale: u(0), turbShear: u(0), dustDiff: u(0), eddyDiff: u(0), maxSpeed: u(0), warm: u(0.9),
      buoyancy: u(0), vaporWeight: u(0), dustWeight: u(0), cooling: u(0), vaporDecay: u(0), exhaustDecay: u(0),
      vacuumDecay: u(0), vaporVacuum: u(0), exhaustVacuum: u(0), tempVacuum: u(0), friction: u(0), porousDrag: u(0),
      settleSpeed: u(0), settleMin: u(0), settleLo: u(0), settleHi: u(0),
      liftLo: u(0), liftHi: u(0), liftRate: u(0), deckMass: u(0.6), hazeAir: u(0), hazeH: u(1), sor: u(1.7), velMC: u(1), biharm: u(1 / 300), edgeRate: u(8), gapLead: u(0.5), wallCd: u(0.01), vaporSettle: u(0), jetClean: u(6)
    };
    this.syncTune();
    this._build();
    this._list = [];
  }

  /** Strojenie (jednostki świata) → uniformy (komórki). */
  syncTune(T = this.tune) {
    const U = this.U;
    const h = this.domain.h;
    this.jacobi = (T.jacobi | 0) | 1;
    this.sorIters = Math.max(1, T.sorIters | 0);
    U.sor.value = T.sor;
    U.velMC.value = T.velMacCormack;
    U.biharm.value = T.biharmonic;
    U.edgeRate.value = T.edgeRate;
    U.wallCd.value = T.wallCd;
    U.gapLead.value = T.gapLead;
    U.vaporSettle.value = T.vaporSettle / h;
    U.jetClean.value = T.jetClean;
    U.warm.value = T.warm;
    U.drag.value = T.drag;
    U.dragQuad.value = T.dragQuad * h;           // [1/j.] × |v| [j/s] = [1/kom.] × |v| [kom./s]
    U.dragFrontLo.value = T.dragFrontLo / h;
    U.dragFrontHi.value = T.dragFrontHi / h;
    U.vorticity.value = T.vorticity / h;
    U.turbulence.value = T.turbulence / h;
    U.turbScale.value = T.turbScale * h;
    U.turbShear.value = T.turbShear;
    U.dustDiff.value = T.dustDiff / (h * h);
    U.eddyDiff.value = T.eddyDiff / (h * h);
    U.maxSpeed.value = T.maxSpeed / h;
    U.buoyancy.value = T.buoyancy / h;
    U.vaporWeight.value = T.vaporWeight / h;
    U.dustWeight.value = T.dustWeight / h;
    U.cooling.value = T.cooling;
    U.vaporDecay.value = T.vaporDecay;
    U.exhaustDecay.value = T.exhaustDecay;
    U.vacuumDecay.value = T.vacuumDecay;
    U.vaporVacuum.value = T.vaporVacuum;
    U.exhaustVacuum.value = T.exhaustVacuum;
    U.tempVacuum.value = T.tempVacuum;
    U.friction.value = T.friction;
    U.porousDrag.value = T.porousDrag;
    U.settleSpeed.value = T.settleSpeed / h;
    U.settleMin.value = T.settleMin;
    U.settleLo.value = T.settleLo / h;
    U.settleHi.value = T.settleHi / h;
    U.liftLo.value = T.liftLo / h;
    U.liftHi.value = T.liftHi / h;
    U.liftRate.value = T.liftRate;
    U.deckMass.value = T.deckMass;
    U.hazeAir.value = T.hazeAir;
    U.hazeH.value = T.hazeH / h;
  }

  /** Test zaokrąglania zapisu f16 na urządzeniu (raz na grę, w tle). */
  get halfRounding() {
    return F16_ROUNDING.mode;
  }

  // --- TSL: pomocniki --------------------------------------------------------------------------------------------

  _cell() {
    const { nx, nd, cells } = this.domain;
    If(this.U.active.lessThan(0.5).or(instanceIndex.greaterThanEqual(uint(cells))), () => { Return(); });
    const xi = int(instanceIndex.mod(uint(nx))).toVar();
    const yi = int(instanceIndex.div(uint(nx)).mod(uint(nd))).toVar();
    const zi = int(instanceIndex.div(uint(nx * nd))).toVar();
    const p = vec3(float(xi), float(yi), float(zi)).add(0.5).toVar();
    return { xi, yi, zi, p, store: uvec3(uint(xi), uint(yi), uint(zi)).toVar() };
  }

  _deckCell() {
    const { deckNx, deckCells } = this.domain;
    If(this.U.active.lessThan(0.5).or(instanceIndex.greaterThanEqual(uint(deckCells))), () => { Return(); });
    const a = int(instanceIndex.mod(uint(deckNx))).toVar();
    const b = int(instanceIndex.div(uint(deckNx))).toVar();
    return { a, b, store: uvec2(uint(a), uint(b)).toVar() };
  }

  /** Próbka tekstury 3D w punkcie komórkowym p (trójliniowo, przycięta do domeny). */
  _at(tex, p) {
    const { nx, nd, nh } = this.domain;
    const q = clamp(p, vec3(0.5), vec3(nx - 0.5, nd - 0.5, nh - 0.5));
    return texture3D(tex, q.mul(vec3(1 / nx, 1 / nd, 1 / nh))).level(0);
  }

  /** Próbka tekstury pokładu w punkcie komórek pokładu q (środki w + 0,5). */
  _atDeck(tex, q) {
    const { deckNx, deckNd } = this.domain;
    return texture(tex, q.mul(vec2(1 / deckNx, 1 / deckNd))).level(0);
  }

  /** Zapis do RGBA16F z zaokrągleniem stochastycznym (wektor 3 / 4). salt — sól kernela. */
  _w16(x, salt, n) {
    const r0 = rndF16(instanceIndex, this.U.seed, salt).toVar();
    const r = n === 4 ? vec4(r0, rndF16Next(r0, 1), rndF16Next(r0, 2), rndF16Next(r0, 3)) : n === 3
      ? vec3(r0, rndF16Next(r0, 1), rndF16Next(r0, 2)) : r0;
    return sroundF16(x.toVar(), r);
  }

  /**
   * Profil stożka (lustro CPU: hallGas3dConeProfileCpu): { prof, srcProf, width, along } — srcProf: profil ŹRÓDŁA OBJĘTOŚCI,
   * HALL_GAS3D_SRC_WIDE × szerszy (ostre źródło ~1 komórki dawało szpilkę ciśnienia, a na siatce kolokowanej resztę
   * dywergencji (laplasjan zwarty ≠ dywergencja gradientu centralnego) ∝ krzywiźnie ciśnienia).
   */
  _cone(p, A, B, C, wl) {
    const prof = float(0.0).toVar();
    const srcProf = float(0.0).toVar();
    const width = float(C.x).toVar();
    const rel = p.sub(A.xyz).toVar();
    const along = dot(rel, B.xyz).toVar();
    If(along.greaterThan(C.x.mul(HALL_GAS3D_SRC_WIDE).negate()).and(along.lessThan(B.w)), () => {
      const across2 = max(dot(rel, rel).sub(along.mul(along)), 0.0).toVar();
      // przekrój ELIPTYCZNY (lustro: hallGas3dConeProfileCpu): w pionie (oś n_v = ẑ − (ẑ·b)·b) pół-szerokość
      // w0 + x·widen, na boki w0 + x·wl — struga przy pokładzie (strumień przyścienny) rozpływa się na boki ~5–6× szybciej
      // niż w pion (Launder, Rodi 1983); oś prawie pionowa — cały przekrój „na boki”
      const nv = vec3(0.0, 0.0, 1.0).sub(B.xyz.mul(B.z)).toVar();
      const lv = length(nv);
      const av = select(lv.greaterThan(0.2), dot(rel, nv).div(max(lv, 1e-3)), float(0.0)).toVar();
      const av2 = av.mul(av);
      const ah2 = max(across2.sub(av2), 0.0);
      const wv = C.x.add(max(along, 0.0).mul(C.y)).toVar();
      const wh = C.x.add(max(along, 0.0).mul(wl)).toVar();
      width.assign(sqrt(wv.mul(wh)));
      const x2 = ah2.div(wh.mul(wh)).add(av2.div(wv.mul(wv))).toVar();
      const ends = float(1.0).sub(smoothstep(B.w.mul(0.5), B.w, along)).toVar();
      prof.assign(exp(x2.mul(-HALL_GAS3D_JET_K)).mul(ends).mul(smoothstep(C.x.negate(), 0.0, along)));
      srcProf.assign(exp(x2.mul(-HALL_GAS3D_JET_K / (HALL_GAS3D_SRC_WIDE * HALL_GAS3D_SRC_WIDE))).mul(ends)
        .mul(smoothstep(C.x.mul(HALL_GAS3D_SRC_WIDE).negate(), 0.0, along)));
    });
    return { prof, srcProf, width, along };
  }

  /**
   * Zasłanianie stożka (lustro: pole 2D jetVisibleCpu, tu 3D): marsz od komórki ku wylotowi po polu odległości od brył
   * (stat.B — komórki × 4), najwyżej 8 kroków; trafienie w bryłę = komórka za ścianą — poza strumieniem (0 / 1).
   */
  _coneVisible(p, apex) {
    const to = apex.sub(p).toVar();
    const L = length(to).toVar();
    const dir = to.div(max(L, 1e-3)).toVar();
    const t = float(0.0).toVar();
    const vis = float(1.0).toVar();
    Loop({ start: int(0), end: int(8), type: 'int', condition: '<', name: 'hgOcc' }, () => {
      If(t.greaterThanEqual(L), () => { Break(); });
      const d = this._at(this.statTex, p.add(dir.mul(t))).z.mul(63.75).toVar();
      If(d.lessThan(0.6), () => { vis.assign(0.0); Break(); });
      t.addAssign(max(d.sub(0.5), 0.75));
    });
    return vis;
  }

  _build() {
    const U = this.U;
    const dom = this.domain;
    const { nx, nd, nh, cells, deckNx, deckNd, deckCells } = dom;
    const at = (tex, p) => this._at(tex, p);
    const noise = this.noise3D;
    const recs = this.recs;
    const jetBase = this.jetBase;
    const JV = HALL_GAS3D_JET_VEC4;
    const MW = this.maskW;
    const MH = this.maskH;
    const maxBodies = this.maxBodies;
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const AX = ['x', 'y', 'z'];        // składowa osi
    const OBS = ['y', 'z', 'w'];       // składowa prędkości przeszkody w occT (x — zajętość)
    const stride = [1, -1, nx, -nx, nx * nd, -nx * nd];
    const K = this._kernels = [];
    const sor = this.solver === 'sor';
    const kernel = (fn, count, name) => { const k = Fn(fn)().compute(count).setName(name); K.push(k); return k; };
    const inDom = (c) => [c.xi.lessThan(int(nx - 1)), c.xi.greaterThan(int(0)), c.yi.lessThan(int(nd - 1)),
      c.yi.greaterThan(int(0)), c.zi.lessThan(int(nh - 1)), c.zi.greaterThan(int(0))];

    // Zerowanie (nowa hala, start): spokojny gaz, cienka mgiełka pyłu przy pokładzie w hali, ciśnienie 0.
    this.kClear = kernel(() => {
      const c = this._cell();
      const st = at(this.statTex, c.p).toVar();
      const solid = st.x.greaterThanEqual(0.5);
      const haze = select(solid, float(0.0), U.hazeAir.mul(exp(c.p.z.negate().div(U.hazeH))).mul(st.y));
      textureStore(this.velA, c.store, vec4(0.0, 0.0, 0.0, select(solid, float(1.0), float(0.0))));
      textureStore(this.denA, c.store, vec4(haze, 0.0, 0.0, 0.0));
      textureStore(this.faceT, c.store, vec4(0.0));
      this.pB.element(instanceIndex).assign(0.0);
      this.pA.element(instanceIndex).assign(0.0);
    }, cells, 'hallGas3dClear');
    this.kClearDeck = kernel(() => {
      const d = this._deckCell();
      const s = this._atDeck(this.deckStartTex, vec2(float(d.a), float(d.b)).add(0.5)).x;
      textureStore(this.deckA, d.store, vec4(s, 0.0, 0.0, 0.0));
    }, deckCells, 'hallGas3dClearDeck');

    // 1. Zajętość: statyka ∪ dach ∪ płyta kadłubów (maska obrysu, próg 0,5) — lustro: hallGas3dOccCpu.
    this.kOcc = kernel(() => {
      const c = this._cell();
      const p = c.p;
      const st = at(this.statTex, p).toVar();
      const occ = st.x.toVar();
      const kf = float(c.zi);
      // dach: udział warstwy powyżej spodu płyty × kolumna w obrysie × (1 − otwarcie w prostokącie otworu)
      const roofFrac = clamp(kf.add(1.0).sub(max(kf, U.roofY0)), 0.0, 1.0);
      const R = U.roofRect;
      const inRect = p.x.greaterThan(R.x).and(p.x.lessThan(R.z)).and(p.y.greaterThan(R.y)).and(p.y.lessThan(R.w));
      const open = select(inRect, U.roofOpen, float(0.0));
      occ.assign(max(occ, st.w.mul(roofFrac).mul(float(1.0).sub(open))));
      // płyta kadłubów: udział warstwy w 48–116 × maska obrysu (kadłub w ruchu — prędkość ciała + ω × r)
      const hullFrac = clamp(min(kf.add(1.0), U.hullY1).sub(max(kf, U.hullY0)), 0.0, 1.0).toVar();
      const ov = vec3(0.0).toVar();
      If(hullFrac.greaterThan(0.0), () => {
        Loop({ start: int(0), end: U.bodyCount, type: 'int', condition: '<', name: 'hgBody' }, ({ hgBody }) => {
          const o = hgBody.mul(3);
          const A = recs.element(o).toVar();
          const B = recs.element(o.add(1)).toVar();
          const rel = p.xy.sub(A.xy).toVar();
          const q = vec2(dot(A.zw, rel), dot(B.xy, rel)).add(B.zw).toVar();
          If(q.x.greaterThan(0.0).and(q.x.lessThan(float(MW))).and(q.y.greaterThan(0.0)).and(q.y.lessThan(float(MH))), () => {
            const mu = clamp(q.x, 0.5, MW - 0.5).mul(1 / MW);
            const mv = float(hgBody).mul(MH).add(clamp(q.y, 0.5, MH - 0.5)).mul(1 / (MH * maxBodies));
            If(texture(this.maskTex, vec2(mu, mv)).level(0).x.greaterThan(0.5).and(hullFrac.greaterThan(occ)), () => {
              const C = recs.element(o.add(2)).toVar();
              occ.assign(hullFrac);
              const vb = vec2(C.x.sub(C.z.mul(rel.y)), C.y.add(C.z.mul(rel.x))).toVar();
              ov.assign(vec3(vb, 0.0));
              // SZCZELINA pod płytą (warstwa 0, komórka płynu): cel przepływu = wleczenie ½·v (Couette), w = 1 + ŹRÓDŁO
              // szczeliny [1/s] (C.w — ciśnienie spiętrzenia przed płytą wtłacza powietrze pod kadłub; wydatek tak, by
              // wypływ przez obrys miał edgePush·|v| — rzut rozprowadza go po burtach, dziobie i rufie wg kształtu
              // kadłuba). Spiętrzenie jest największe przy krawędzi NATARCIA: gęstość źródła × (1 + gapLead · l_x · znak
              // ruchu wzdłuż kadłuba), l_x ∈ [−1, 1] rufa → dziób (średnio 1 — wydatek bez zmian). Lustro: hallGas3dGapFlowCpu.
              // Komórka płynu: yzw poza szczeliną nieużywane.
              If(c.zi.equal(int(0)), () => {
                const ex = A.zw.toVar();
                const lead = select(dot(vb, ex).greaterThanEqual(0.0), float(1.0), float(-1.0));
                const lx = q.x.mul(2.0 / MW).sub(1.0);
                const wLead = max(float(1.0).add(U.gapLead.mul(lx).mul(lead)), 0.0);
                ov.assign(vec3(vb.mul(0.5), float(1.0).add(C.w.mul(wLead))));
              });
            });
          });
        });
      });
      textureStore(this.occT, c.store, vec4(occ, ov));
    }, cells, 'hallGas3dOcc');

    // 2. Wiry, dywergencja centralna (diagnostyka) i LAPLASJAN pola velA (filtr biharmoniczny: v −= a·∇²(∇²v) w reakcji —
    // tłumi mod 2Δ, którego dywergencja centralna nie widzi, a MacCormack nie gasi). Wiry: pokład pod warstwą 0 —
    // prędkość 0, komórki stałe — prędkość przeszkody (velA). Laplasjan filtra: przy pokładzie i bryłach ODBICIE (składowa
    // normalna względem przeszkody 2·v_s − v, styczne v — bez poślizgu filtr działałby jak silne tarcie na każdą warstwę
    // przy ścianie: strumień przyścienny i wypływ spod kadłuba, grube na komórkę, gasły w ~0,2 s; tarcie ściany ma osobny
    // człon — prawo ściany w reakcji). Lustro: hallGas3dFilterNbCpu.
    this.kCurl = kernel(() => {
      const c = this._cell();
      const S = (d) => at(this.velA, c.p.add(vec3(...d))).toVar();
      const v0 = at(this.velA, c.p).xyz.toVar();
      const sxp = S(N6[0]); const sxm = S(N6[1]);
      const syp = S(N6[2]); const sym = S(N6[3]);
      const szp = S(N6[4]); const szm = S(N6[5]);
      const deck = c.zi.equal(int(0));
      const xp = sxp.xyz; const xm = sxm.xyz;
      const yp = syp.xyz; const ym = sym.xyz;
      const zp = szp.xyz;
      const zm = select(deck, vec3(0.0), szm.xyz).toVar();
      const w = vec3(yp.z.sub(ym.z).sub(zp.y.sub(zm.y)), zp.x.sub(zm.x).sub(xp.z.sub(xm.z)), xp.y.sub(xm.y).sub(yp.x.sub(ym.x)))
        .mul(0.5).toVar();
      const div = xp.x.sub(xm.x).add(yp.y.sub(ym.y)).add(zp.z.sub(zm.z)).mul(0.5);
      textureStore(this.curlT, c.store, vec4(w, div));
      const mir = (s, a) => (a === 0 ? vec3(s.x.mul(2.0).sub(v0.x), v0.y, v0.z)
        : a === 1 ? vec3(v0.x, s.y.mul(2.0).sub(v0.y), v0.z) : vec3(v0.x, v0.y, s.z.mul(2.0).sub(v0.z)));
      const F = (s, a) => select(s.w.greaterThan(0.5), mir(s, a), s.xyz);
      const fzm = select(deck, vec3(v0.x, v0.y, v0.z.negate()), F(szm, 2));
      const lapV = F(sxp, 0).add(F(sxm, 0)).add(F(syp, 1)).add(F(sym, 1)).add(F(szp, 2)).add(fzm).sub(v0.mul(6.0));
      textureStore(this.lapT, c.store, vec4(this._w16(lapV, 8, 3), 0.0));
    }, cells, 'hallGas3dCurl');

    // Próbka skalarów bez komórek stałych (gasGrid freeSample): udział komórek stałych w próbce = trójliniowa flaga velA.w.
    const freeSample = (s, flag) => {
      const v = s.toVar();
      return select(flag.greaterThan(1e-3), v.div(max(float(1.0).sub(flag), 0.2)), v);
    };
    // PRĘDKOŚĆ TRANSPORTU z pola ścian (faceT: teksel i = ściana i → i + 1, położenie i + 1): składowa w swoim offsecie
    // (q − ½ w osi składowej), u_z → 0 na pokładzie (liniowo w warstwie 0). Pole ścian jest bezdywergencyjne do residuum
    // solvera (Rhie–Chow) — adwekcja nie tworzy masy (dawniej transport po prędkościach komórek: mod szachownicy i
    // obcięcie w ścianę dawały trwałą ∇·v ≠ 0).
    const faceVel = (q) => {
      const ux = at(this.faceT, q.sub(vec3(0.5, 0.0, 0.0))).x;
      const uy = at(this.faceT, q.sub(vec3(0.0, 0.5, 0.0))).y;
      const uz = at(this.faceT, q.sub(vec3(0.0, 0.0, 0.5))).z.mul(clamp(q.z, 0.0, 1.0));
      return vec3(ux, uy, uz);
    };
    const backtrace = (p, dt) => {
      const v0 = faceVel(p).toVar();
      const vm = faceVel(p.sub(v0.mul(dt.mul(0.5))));
      return { v0, pb: p.sub(vm.mul(dt)).toVar() };
    };

    // 3. Adwekcja: φ̂ (bez komórek stałych) i v̂.
    this.kAdvect = kernel(() => {
      const c = this._cell();
      const { pb } = backtrace(c.p, U.dt);
      const vPb = at(this.velA, pb).toVar();
      textureStore(this.denB, c.store, this._w16(freeSample(at(this.denA, pb), vPb.w), 0, 4));
      textureStore(this.velC, c.store, vec4(this._w16(vPb.xyz, 1, 3), 0.0));
    }, cells, 'hallGas3dAdvect');

    // 4. Reakcja.
    this.kReact = kernel(() => {
      const c = this._cell();
      const p = c.p;
      const dt = U.dt;
      const occC = at(this.occT, p).toVar();
      const isSolid = occC.x.greaterThanEqual(0.5).toVar();
      const st = at(this.statTex, p).toVar();
      const { v0, pb } = backtrace(p, dt);
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      const fwd = p.add(v0.mul(dt)).toVar();
      // prędkość: MacCormack (v̂ + ½(v − ṽ)) obcięty do 8 komórek wokół punktu wstecz
      const mcV = at(this.velC, p).xyz.add(at(this.velA, p).xyz.sub(at(this.velC, fwd).xyz).mul(0.5)).toVar();
      const loV = vec3(1e6).toVar();
      const hiV = vec3(-1e6).toVar();
      // skalary: MacCormack z obcięciem
      const phi = at(this.denA, p).toVar();
      const hat = at(this.denB, p).toVar();
      const tilde = freeSample(at(this.denB, fwd), at(this.velA, fwd).w);
      const mc = hat.add(phi.sub(tilde).mul(0.5)).toVar();
      const lo = vec4(1e6).toVar();
      const hi = vec4(-1e6).toVar();
      for (let i = 0; i < 8; i++) {
        const q = b0.add(vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1));
        const sv = at(this.velA, q).xyz;
        loV.assign(min(loV, sv));
        hiV.assign(max(hiV, sv));
        const s = at(this.denA, q);
        lo.assign(min(lo, s));
        hi.assign(max(hi, s));
      }
      // prędkość: semi-Lagrange (v̂) + udział velMC korekcji MacCormacka (1 — pełny 2. rząd, 0 — 1. rząd)
      const vel = mix(at(this.velC, p).xyz, clamp(mcV, loV, hiV), clamp(U.velMC, 0.0, 1.0)).toVar();
      const den = clamp(mc, lo, hi).toVar();

      // gradient |ω| (wzmacnianie wirów) i sąsiedzi stali (bez wzmacniania przy przeszkodzie). Dyfuzja pyłu i pary — w rzucie,
      // na polu PO reakcji (dawniej tu, z pola sprzed adwekcji dodawana do przeniesionego — przy szybkim przepływie
      // liczyła masę podwójnie: pył rósł wykładniczo)
      const om = at(this.curlT, p).toVar();
      const omL = length(om.xyz).toVar();
      const eta = vec3(0.0).toVar();
      const nSolid = float(0.0).toVar();
      const bih = at(this.lapT, p).xyz.mul(-6.0).toVar();   // ∇²(∇²v)
      N6.forEach((d, k) => {
        const q = p.add(vec3(...d));
        const wn = length(at(this.curlT, q).xyz).toVar();
        bih.addAssign(at(this.lapT, q).xyz);
        nSolid.addAssign(select(at(this.occT, q).x.greaterThanEqual(0.5), float(1.0), float(0.0)));
        const sgn = k % 2 === 0 ? 0.5 : -0.5;
        if (k < 2) eta.x.addAssign(wn.mul(sgn));
        else if (k < 4) eta.y.addAssign(wn.mul(sgn));
        else eta.z.addAssign(wn.mul(sgn));
      });

      // filtr biharmoniczny (a na krok 1/60 s): 2Δ wzdłuż osi ~5 %/krok, 8Δ ~0,1 % — wiry od 8 komórek nietknięte
      vel.subAssign(bih.mul(U.biharm.mul(dt).mul(60.0)));

      // strumienie (dysze MAIN, SIDE, źródła hali)
      const S = float(0.0).toVar();     // źródło objętości [1/s] (cel dywergencji)
      const SE = float(0.0).toVar();    // Σ s · udział spalin w nowym gazie
      const ST = float(0.0).toVar();    // Σ s · temperatura nowego gazu
      const jetW = float(0.0).toVar();  // najsilniejszy stożek w komórce (bez oporu kwadratowego)
      const engW = float(0.0).toVar();  // najsilniejszy stożek DYSZY (MAIN / SIDE: D.w — rdzeń > 0) — rozrzedzanie spalinami
      // szczelina pod płytą kadłuba (warstwa 0, znacznik celu w occT.w ≥ 1): cel wleczenia i źródło objętości w − 1
      const gapFlow = c.zi.equal(int(0)).and(occC.x.lessThan(0.5)).and(occC.w.greaterThan(0.5));
      const inj = vec2(0.0).toVar();    // wstrzykiwanie pyłu, pary [1/s]
      Loop({ start: int(0), end: U.jetCount, type: 'int', condition: '<', name: 'hgJet' }, ({ hgJet }) => {
        const o = hgJet.mul(JV).add(jetBase);
        const mn4 = recs.element(o.add(5)).toVar();
        const mn = mn4.xyz;
        const mx = recs.element(o.add(6)).xyz;
        If(p.x.greaterThan(mn.x).and(p.x.lessThan(mx.x)).and(p.y.greaterThan(mn.y)).and(p.y.lessThan(mx.y))
          .and(p.z.greaterThan(mn.z)).and(p.z.lessThan(mx.z)), () => {
          const A = recs.element(o).toVar();
          const B = recs.element(o.add(1)).toVar();
          const C = recs.element(o.add(2)).toVar();
          const D = recs.element(o.add(3)).toVar();
          const E = recs.element(o.add(4)).toVar();
          If(A.w.greaterThan(0.5), () => {
            // buch promieniowy (para dookoła złączki): prędkość od środka, płaty z szumu, pierścień wstrzykiwania
            const rel = p.sub(A.xyz).toVar();
            const r = length(rel).toVar();
            const dir = rel.div(max(r, 1e-3)).toVar();
            const lobe = clamp(texture3D(noise, dir.mul(0.85).add(vec3(B.x, B.y, 0.37))).level(0).x.sub(0.5).mul(2.6).add(0.9), 0.25, 1.6).toVar();
            const prof = smoothstep(0.0, C.x, r).mul(float(1.0).sub(smoothstep(B.w.mul(0.45), B.w, r))).mul(lobe);
            const target = dir.mul(C.z.mul(sqrt(C.x.div(max(r, C.x)))));
            vel.assign(mix(vel, target, clamp(C.w.mul(dt).mul(prof), 0.0, 1.0)));
            const x = r.sub(C.x).div(max(D.y, 1.0));
            const ring = exp(x.mul(x).negate()).mul(lobe).toVar();
            S.addAssign(D.x.mul(ring));
            inj.addAssign(E.xy.mul(ring));
          }).Else(() => {
            const J = this._cone(p, A, B, C, mn4.w);
            If(J.prof.add(J.srcProf).greaterThan(1e-4).and(D.z.greaterThan(0.5)), () => {
              const vis = this._coneVisible(p, A.xyz);
              J.prof.mulAssign(vis);
              J.srcProf.mulAssign(vis);
            });
            If(J.prof.greaterThan(1e-4), () => {
              // prędkość na osi: struga okrągła (D.w = długość rdzenia [kom.] > 0 — pełna w rdzeniu, dalej ∝ 1/x) albo
              // stożek źródeł hali (prędkość × szerokość u nasady / szerokość). Lustro: hallGas3dConeSpeedCpu.
              const spd = select(D.w.greaterThan(0.0), C.z.mul(clamp(D.w.div(max(J.along, 1e-3)), 0.2, 1.0)),
                C.z.mul(max(C.x.div(J.width), 0.25)));
              vel.assign(mix(vel, B.xyz.mul(spd), clamp(C.w.mul(dt).mul(J.prof), 0.0, 1.0)));
              jetW.assign(max(jetW, J.prof));
              engW.assign(max(engW, select(D.w.greaterThan(0.0), J.prof, float(0.0))));
              inj.addAssign(E.xy.mul(J.prof));
            });
            // źródło objętości (szerszy profil; wydatek / całka — hallGas3dSourceIntegralCpu)
            If(J.srcProf.greaterThan(1e-4).and(D.x.greaterThan(0.0)), () => {
              const s = D.x.mul(J.srcProf).mul(smoothstep(-1.0, 2.0, J.along)).mul(float(1.0).sub(smoothstep(D.y.mul(0.5), D.y, J.along))).toVar();
              S.addAssign(s);
              SE.addAssign(s.mul(E.z));
              ST.addAssign(s.mul(E.w));
            });
          });
        });
      });
      // źródło szczeliny pod płytą kadłuba w ruchu (czyste powietrze spiętrzenia — rozrzedza, wypycha kurz burtami)
      S.addAssign(select(gapFlow, occC.w.sub(1.0), float(0.0)));
      // nowy gaz ze źródeł objętości (udział nowej objętości 1 − e^(−S·dt)): pył i para rozrzedzone (Dc/Dt = −c·∇·v, ∇·v = S),
      // spaliny i temperatura ku wartości nowego gazu
      const keep = exp(S.negate().mul(dt)).toVar();
      const fresh = float(1.0).sub(keep);
      const invS = float(1.0).div(max(S, 1e-6));
      den.assign(vec4(den.x.mul(keep), den.y.mul(keep), min(den.z.mul(keep).add(SE.mul(invS).mul(fresh)), 1.0), den.w.mul(keep).add(ST.mul(invS).mul(fresh))));
      den.xy.addAssign(inj.mul(dt));
      // RDZEŃ STRUGI = SPALINY (jak pole 2D: jetClean × profil stożka dyszy): pył i para w stożku dysz MAIN / SIDE
      // rozrzedzane w tempie jetClean × profil — kurz poderwany spod strugi nie zostaje w jej rdzeniu (tunel w locie):
      // rozprasza się w ogromnym wydatku spalin poniżej rozdzielczości siatki. Bez dysz — bez zmian (bilans masy bez
      // źródeł nietknięty)
      den.xy.mulAssign(exp(U.jetClean.mul(engW).negate().mul(dt)));

      // siły: wiry ε(N × ω), wypór (gorące w górę, zimna para i pył w dół), turbulencja (szum 3D) w gazie i przy ścinaniu
      // (bez wzmacniania przy przeszkodzie: ω tam to ścinanie przy ścianie, nie wir — wzmacniane rośnie bez końca)
      const nv = eta.div(max(length(eta), 1e-4));
      const fvc = cross(nv, om.xyz).mul(U.vorticity).mul(select(nSolid.greaterThan(0.5), float(0.0), float(1.0)));
      // ciężar pary: liniowo ze stężeniem (gęsta przy złączce spływa z płyty po burtach; rozrzedzona prawie bez siły — inaczej
      // każdy ślad pary ze źródeł hali rozkręcał prąd gęstościowy po pokładzie ~500 j/s i podrywał kurz w całej hali)
      const fb = vec3(0.0, 0.0, min(den.w, 1.5).mul(U.buoyancy).sub(min(den.y, 1.0).mul(U.vaporWeight)).sub(min(den.x, 2.0).mul(U.dustWeight)));
      const tq = p.mul(U.turbScale).add(vec3(0.0, 0.0, U.time.mul(0.08)));
      const n1 = texture3D(noise, tq).level(0).xy;
      const n2 = texture3D(noise, tq.mul(1.37).add(vec3(0.41, 0.17, 0.73))).level(0).x;
      const turbW = clamp(den.x.add(den.y).add(den.z).mul(0.8).add(omL.mul(U.turbShear)), 0.0, 1.0);
      const ft = vec3(n1.x, n1.y, n2).sub(0.5).mul(2.0).mul(U.turbulence).mul(turbW);
      vel.addAssign(fvc.add(fb).add(ft).mul(dt));
      // opór: stały + kwadratowy szybkiego frontu poza stożkami + w komórce częściowo zajętej
      const spd = length(vel).toVar();
      const front = clamp(spd.sub(U.dragFrontLo).div(max(U.dragFrontHi.sub(U.dragFrontLo), 1e-3)), 0.0, 1.0);
      const quad = U.dragQuad.mul(spd).mul(front).mul(float(1.0).sub(clamp(jetW.mul(2.0), 0.0, 1.0)));
      vel.mulAssign(exp(U.drag.add(quad).add(U.porousDrag.mul(occC.x)).negate().mul(dt)));
      // tarcie przy pokładzie (z = 0) i płytach (przeszkoda nad / pod komórką): pozioma prędkość ku prędkości ściany —
      // PRAWO ŚCIANY (kwadratowe): τ/ρ = Cd·|v − v_ściany|², warstwa grubości komórki → tempo Cd·|Δv| / h (+ człon liniowy)
      const below = select(c.zi.greaterThan(int(0)), at(this.occT, p.sub(vec3(0, 0, 1))), vec4(1.0, 0.0, 0.0, 0.0)).toVar();
      const above = select(c.zi.lessThan(int(nh - 1)), at(this.occT, p.add(vec3(0, 0, 1))), vec4(0.0)).toVar();
      const bS = select(below.x.greaterThanEqual(0.5), float(1.0), float(0.0));
      const aS = select(above.x.greaterThanEqual(0.5), float(1.0), float(0.0));
      const nW = select(gapFlow, float(0.0), bS.add(aS));
      If(nW.greaterThan(0.0), () => {
        const tgt = below.yz.mul(bS).add(above.yz.mul(aS)).div(nW).toVar();
        const kW = U.friction.add(U.wallCd.mul(length(vel.xy.sub(tgt)))).mul(nW);
        vel.xy.assign(mix(vel.xy, tgt, float(1.0).sub(exp(kW.negate().mul(dt)))));
      });
      // EFEKT PRZYPOWIERZCHNIOWY kadłuba w ruchu (szczelina 48 j. pod płytą — warstwa 0): wleczenie ½·v z kernela
      // zajętości (occT.yz) zamiast tarcia — wypływ burtami daje źródło szczeliny (wyżej, cel dywergencji)
      If(gapFlow, () => {
        vel.xy.assign(mix(vel.xy, occC.yz, clamp(U.edgeRate.mul(dt), 0.0, 1.0)));
      });
      // próżnia (poza halą: za bramą, nad otwartym dachem, za ścianami) — gaz ginie; w hali para, spaliny, ciepło gasną
      const out = float(1.0).sub(st.y);
      den.x.mulAssign(exp(U.vacuumDecay.mul(out).negate().mul(dt)));
      den.y.mulAssign(exp(U.vaporDecay.add(U.vaporVacuum.mul(out)).negate().mul(dt)));
      den.z.mulAssign(exp(U.exhaustDecay.add(U.exhaustVacuum.mul(out)).negate().mul(dt)));
      den.w.mulAssign(exp(U.cooling.add(U.tempVacuum.mul(out)).negate().mul(dt)));
      // komórka stała: prędkość przeszkody, bez gazu
      vel.assign(select(isSolid, occC.yzw, vel));
      textureStore(this.velB, c.store, vec4(select(isSolid, vel, this._w16(vel, 2, 3)), select(isSolid, float(0.0), S)));
      textureStore(this.denC, c.store, select(isSolid, vec4(0.0), max(this._w16(den, 3, 4), vec4(0.0))));
    }, cells, 'hallGas3dReact');

    // Opadanie (ułamek masy komórki w kroku; lustro: hallGas3dSettleCpu) — prędkość z velB (te same liczby w pokładzie i rzucie).
    const settleFrac = (speed) => {
      const k = U.settleMin.add(float(1.0).sub(U.settleMin).mul(float(1.0).sub(smoothstep(U.settleLo, U.settleHi, speed))));
      return min(float(0.5), U.settleSpeed.mul(k).mul(U.dt));
    };

    // 5. Pokład: podrywanie (prędkość warstwy 0, tylko w hali) i opadanie z komórki 3D nad (¼ na komórkę pokładu, do sufitu 1).
    // Lustro: hallGas3dDeckExchangeCpu. deckB = (nowy depozyt, zmiana pyłu komórki 3D: L − s).
    this.kDeck = kernel(() => {
      const d = this._deckCell();
      const q = vec2(float(d.a), float(d.b)).add(0.5).toVar();
      const cp = vec3(floor(q.mul(0.5)).add(0.5), 0.5).toVar();          // środek komórki 3D warstwy 0
      const D0 = this._atDeck(this.deckA, q).x.toVar();
      const solid = at(this.occT, cp).x.greaterThanEqual(0.5);
      const c0 = at(this.denC, cp).x;
      const inside = select(at(this.statTex, cp).y.greaterThan(0.5), float(1.0), float(0.0));
      const speed = length(at(this.velB, vec3(q.mul(0.5), 0.5)).xyz).toVar();
      const m = U.deckMass;
      const s = min(c0.mul(settleFrac(speed)).mul(0.25), max(float(1.0).sub(D0), 0.0).mul(m)).toVar();
      // podrywanie = STRUMIEŃ erozji zależny od ścinania (nie ułamek depozytu): pokład pod strugą traci liftRate na sekundę,
      // dopóki ma kurz — drugie odpalenie zdejmuje podobnie jak pierwsze tam, gdzie kurz został
      const L = m.mul(min(D0, U.liftRate.mul(smoothstep(U.liftLo, U.liftHi, speed)).mul(U.dt))).mul(inside).toVar();
      const D1 = D0.add(s.sub(L).div(m));
      const e = L.sub(s);
      const r0 = rndF16(instanceIndex, U.seed, 7).toVar();
      textureStore(this.deckB, d.store, select(solid, vec4(D0, 0.0, 0.0, 0.0),
        vec4(clamp(sroundF16(D1, r0), 0.0, 1.0), sroundF16(e, rndF16Next(r0, 1)), 0.0, 0.0)));
    }, deckCells, 'hallGas3dDeck');

    // 6. Dywergencja (prawa strona = div − cel), maska sąsiadów (2 bity: 0 płyn, 1 stały / pokład, 2 brzeg otwarty;
    // bit 12 — komórka stała), rozgrzanie ciśnienia.
    this.kDiv = kernel(() => {
      const c = this._cell();
      const p = c.p;
      const inD = inDom(c);
      const occC = at(this.occT, p).toVar();
      const selfSolid = occC.x.greaterThanEqual(0.5);
      const m = uint(0).toVar();
      const vb0 = at(this.velB, p).toVar();
      // dywergencja w postaci ŚCIANOWEJ (zgodna z laplasjanem zwartym — Rhie–Chow): ściana płyn–płyn ½(v_i + v_j),
      // płyn–bryła — prędkość normalna przeszkody, pokład — 0, brzeg otwarty — v komórki (lustro: hallGas3dFacePriorCpu)
      const D = float(0.0).toVar();
      N6.forEach((d, k) => {
        const q = p.add(vec3(...d));
        const o = at(this.occT, q).toVar();
        const nbSolid = o.x.greaterThanEqual(0.5);
        // pokład pod warstwą 0 — ściana (bez przenikania, prędkość 0), wysokość ponad domeną — brzeg otwarty
        const deck = k === 5 ? c.zi.equal(int(0)) : null;
        const code = (deck
          ? select(deck, uint(1), select(nbSolid, uint(1), uint(0)))
          : select(inD[k], select(nbSolid, uint(1), uint(0)), uint(2))).toVar();
        m.assign(m.bitOr(code.shiftLeft(uint(k * 2))));
        const a = AX[k >> 1];
        const obs = deck ? select(deck, float(0.0), o[OBS[k >> 1]]) : o[OBS[k >> 1]];
        const F = select(code.equal(uint(0)), vb0[a].add(at(this.velB, q)[a]).mul(0.5), select(code.equal(uint(1)), obs, vb0[a]));
        D.addAssign(k % 2 === 0 ? F : F.negate());
      });
      m.assign(m.bitOr(select(selfSolid, uint(1 << 12), uint(0))));
      const div = D.sub(vb0.w);
      this.rhs.element(instanceIndex).assign(select(selfSolid, float(0.0), div));
      this.mask.element(instanceIndex).assign(m);
      // rozgrzanie: SOR liczy w miejscu na pA (wynik poprzedniego kroku), Jacobi — z pB do pA
      const prev = sor ? this.pA.element(instanceIndex) : this.pB.element(instanceIndex);
      this.pA.element(instanceIndex).assign(select(selfSolid, float(0.0), prev.mul(U.warm)));
    }, cells, 'hallGas3dDiv');

    // 7. Jacobi (lustro: hallGas3dJacobiCellCpu): sąsiad płyn — p, stały — p komórki (Neumann), brzeg — 0.
    const jac = (src, dst, name) => kernel(() => {
      If(U.active.lessThan(0.5).or(instanceIndex.greaterThanEqual(uint(cells))), () => { Return(); });
      const i = instanceIndex;
      const m = this.mask.element(i).toVar();
      const q0 = src.element(i).toVar();
      const sum = float(0.0).toVar();
      for (let k = 0; k < 6; k++) {
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const j = int(i).add(int(stride[k]));
        const nb = src.element(uint(clamp(j, int(0), int(cells - 1))));
        sum.addAssign(select(code.equal(uint(0)), nb, select(code.equal(uint(1)), q0, float(0.0))));
      }
      const solid = m.bitAnd(uint(1 << 12)).greaterThan(uint(0));
      dst.element(i).assign(select(solid, float(0.0), sum.sub(this.rhs.element(i)).div(6.0)));
    }, cells, name);
    this.kJacAB = jac(this.pA, this.pB, 'hallGas3dJacobiAB');
    this.kJacBA = jac(this.pB, this.pA, 'hallGas3dJacobiBA');

    // 7'. SOR red-black W MIEJSCU (bufor pA): kolor (i + j + k) mod 2; komórka czyta tylko sąsiadów drugiego koloru —
    // bez wyścigu, deterministycznie. q ← q + ω(jacobi − q). Jedna iteracja = dwa dispatche po pół komórek; zbieżność
    // błędów dalekiego zasięgu dużo szybsza niż Jacobi przy tym samym koszcie (lustro komórki: hallGas3dJacobiCellCpu).
    const half = cells / 2;
    const hx = nx / 2;
    const sorK = (parity, name) => kernel(() => {
      If(U.active.lessThan(0.5).or(instanceIndex.greaterThanEqual(uint(half))), () => { Return(); });
      const mI = instanceIndex.mod(uint(hx));
      const row = instanceIndex.div(uint(hx));
      const jI = row.mod(uint(nd));
      const kI = row.div(uint(nd));
      const iI = mI.mul(uint(2)).add(uint(parity).add(jI).add(kI).bitAnd(uint(1)));
      const i = kI.mul(uint(nx * nd)).add(jI.mul(uint(nx))).add(iI).toVar();
      const m = this.mask.element(i).toVar();
      const q0 = this.pA.element(i).toVar();
      const sum = float(0.0).toVar();
      for (let k = 0; k < 6; k++) {
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const j = int(i).add(int(stride[k]));
        const nb = this.pA.element(uint(clamp(j, int(0), int(cells - 1))));
        sum.addAssign(select(code.equal(uint(0)), nb, select(code.equal(uint(1)), q0, float(0.0))));
      }
      const solid = m.bitAnd(uint(1 << 12)).greaterThan(uint(0));
      const jacV = sum.sub(this.rhs.element(i)).div(6.0);
      this.pA.element(i).assign(select(solid, float(0.0), q0.add(jacV.sub(q0).mul(U.sor))));
    }, half, name);
    this.kSorR = sorK(0, 'hallGas3dSorRed');
    this.kSorB = sorK(1, 'hallGas3dSorBlack');
    const pFinal = sor ? this.pA : this.pB;

    // 8. Rzut (lustro: hallGas3dProjectCellCpu) + opadanie pyłu piętro niżej (zachowawczo: komórka oddaje F(siebie),
    // przyjmuje F(nad sobą) — te same liczby z denC i velB) + wymiana z pokładem w warstwie 0 (Σ deckB.y).
    this.kProject = kernel(() => {
      const c = this._cell();
      const p = c.p;
      const i = instanceIndex;
      const m = this.mask.element(i).toVar();
      const q0 = pFinal.element(i).toVar();
      const P = (k) => {
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const nb = pFinal.element(uint(clamp(int(i).add(int(stride[k])), int(0), int(cells - 1))));
        return select(code.equal(uint(0)), nb, select(code.equal(uint(1)), q0, float(0.0)));
      };
      const isW = (k) => m.shiftRight(uint(k * 2)).bitAnd(uint(3)).equal(uint(1));
      const grad = vec3(P(0).sub(P(1)), P(2).sub(P(3)), P(4).sub(P(5))).mul(0.5);
      const vb = at(this.velB, p).toVar();
      const occC = at(this.occT, p).toVar();
      const selfSolid = occC.x.greaterThanEqual(0.5).toVar();
      const v = vb.xyz.sub(grad).toVar();
      v.mulAssign(min(float(1.0), U.maxSpeed.div(max(length(v), 1e-3))));
      v.assign(select(selfSolid, occC.yzw, v));
      // PRĘDKOŚCI ŚCIAN +x, +y, +z (Rhie–Chow; transport w następnym kroku): płyn–płyn ½(vb_i + vb_j) − (p_j − p_i),
      // płyn–bryła — prędkość normalna przeszkody, brzeg otwarty — vb_i + p_i (za brzegiem p = 0), komórka stała — jej
      // prędkość. Dywergencja ścianowa = cel S do residuum solvera (lustro: hallGas3dFaceCpu). Bez obcinania składowej
      // w ścianę w komórce (psuło dywergencję sąsiadów).
      const fv = vec3(0.0).toVar();
      for (let a = 0; a < 3; a++) {
        const k = a * 2;
        const code = m.shiftRight(uint(k * 2)).bitAnd(uint(3));
        const q = p.add(vec3(...N6[k]));
        const fFluid = vb[AX[a]].add(at(this.velB, q)[AX[a]]).mul(0.5).sub(P(k).sub(q0));
        const fSolid = at(this.occT, q)[OBS[a]];
        const f = select(code.equal(uint(0)), fFluid, select(code.equal(uint(1)), fSolid, vb[AX[a]].add(q0)));
        fv[AX[a]].assign(clamp(select(selfSolid, occC[OBS[a]], f), U.maxSpeed.negate(), U.maxSpeed));
      }
      textureStore(this.faceT, c.store, vec4(this._w16(fv, 9, 3), 0.0));
      // pył i para: DYFUZJA zachowawcza na polu po reakcji — strumień ½(ν_i + ν_j)(φ_j − φ_i)·dt (ν = stała + wirowa ∝ |ω|,
      // ≤ 1/12 na ścianę — stabilnie), sąsiad stały — bez strumienia (Neumann)
      const den = at(this.denC, p).toVar();
      const c0 = den.x.toVar();   // pył przed dyfuzją — tę samą liczbę czyta komórka pod (dopływ z opadania)
      const y0 = den.y.toVar();   // para przed dyfuzją (opadanie pary — jak pył)
      const nu0 = U.dustDiff.add(U.eddyDiff.mul(length(at(this.curlT, p).xyz))).toVar();
      const lap = vec2(0.0).toVar();
      N6.forEach((d, k) => {
        const q = p.add(vec3(...d));
        const nu1 = U.dustDiff.add(U.eddyDiff.mul(length(at(this.curlT, q).xyz)));
        const kk = clamp(nu0.add(nu1).mul(0.5).mul(U.dt), 0.0, 1 / 12);
        lap.addAssign(select(isW(k).or(m.shiftRight(uint(k * 2)).bitAnd(uint(3)).equal(uint(2))), vec2(0.0),
          at(this.denC, q).xy.sub(den.xy).mul(kk)));
      });
      den.xy.addAssign(lap);
      // pył: opadanie (k ≥ 1, pod komórką nie bryła), dopływ z komórki nad (gdy ta nie jest bryłą i ta komórka nie jest)
      const fSelf = select(c.zi.greaterThan(int(0)).and(isW(5).not()), c0.mul(settleFrac(length(vb.xyz))), float(0.0));
      const pa = p.add(vec3(0, 0, 1));
      const aboveOk = c.zi.lessThan(int(nh - 1)).and(at(this.occT, pa).x.lessThan(0.5));
      const fAbove = select(aboveOk, at(this.denC, pa).x.mul(settleFrac(length(at(this.velB, pa).xyz))), float(0.0));
      const ex = float(0.0).toVar();
      If(c.zi.equal(int(0)), () => {
        const q = vec2(float(c.xi), float(c.yi)).mul(2.0).add(0.5);
        ex.assign(this._atDeck(this.deckB, q).y.add(this._atDeck(this.deckB, q.add(vec2(1, 0))).y)
          .add(this._atDeck(this.deckB, q.add(vec2(0, 1))).y).add(this._atDeck(this.deckB, q.add(vec2(1, 1))).y));
      });
      den.x.assign(den.x.sub(fSelf).add(fAbove).add(ex));
      // para kriogeniczna: OPADANIE — stała opadania osobna od pyłu (brief § 1, § 5), strumień zachowawczy w dół między
      // warstwami; na pokładzie i na bryle zalega (bez osiadania na pokładzie)
      const vf = min(float(0.5), U.vaporSettle.mul(U.dt));
      const vSelf = select(c.zi.greaterThan(int(0)).and(isW(5).not()), y0.mul(vf), float(0.0));
      const vAbove = select(aboveOk, at(this.denC, pa).y.mul(vf), float(0.0));
      den.y.assign(den.y.sub(vSelf).add(vAbove));
      textureStore(this.velA, c.store, vec4(select(selfSolid, v, this._w16(v, 5, 3)), select(selfSolid, float(1.0), float(0.0))));
      textureStore(this.denA, c.store, select(selfSolid, vec4(0.0), max(this._w16(den, 6, 4), vec4(0.0))));
    }, cells, 'hallGas3dProject');

    // 9. Kopia pokładu (deckB → deckA).
    this.kDeckCopy = kernel(() => {
      const d = this._deckCell();
      textureStore(this.deckA, d.store, this._atDeck(this.deckB, vec2(float(d.a), float(d.b)).add(0.5)));
    }, deckCells, 'hallGas3dDeckCopy');
  }

  /** Iteracje ciśnienia do listy kroku (SOR: czerwone + czarne × sorIters; Jacobi: AB / BA × jacobi). */
  _pushPressure(L) {
    if (this.solver === 'sor') {
      for (let k = 0; k < this.sorIters; k++) L.push(this.kSorR, this.kSorB);
    } else {
      for (let k = 0; k < this.jacobi; k++) L.push(k % 2 === 0 ? this.kJacAB : this.kJacBA);
    }
    return L;
  }

  /** Lista kerneli jednego kroku bez zerowania (pomiar kosztu). */
  stepList(out = []) {
    out.length = 0;
    out.push(this.kOcc, this.kCurl, this.kAdvect, this.kReact, this.kDeck, this.kDiv);
    this._pushPressure(out);
    out.push(this.kProject, this.kDeckCopy);
    return out;
  }

  /** Wszystkie kernele (rozgrzewka, testy WGSL w Node). */
  kernels() {
    return this._kernels.slice();
  }

  /** Następny krok zaczyna od czystego stanu (nowa hala, reset). */
  requestClear() {
    this._clear = true;
  }

  /** Maski obrysu (`maskData`) zmienione — wysyłka przed najbliższym krokiem. */
  markMasks() {
    this._masksDirty = true;
  }

  /**
   * Krok klatki: dt [s] czasu gry (0 — stoi; sufit tune.maxDt). Liczniki rekordów (jetCount, bodyCount) i dane
   * (`jets`, `bodies`) ustawia właściciel przed wołaniem; wysyłkę wycinka bufora rekordów też (hallGas3d.js).
   */
  step(renderer, dt) {
    const L = this._list;
    L.length = 0;
    const U = this.U;
    if (this._clear) {
      L.push(this.kClear, this.kClearDeck);
      this._clear = false;
      this._seed = 0;
      this.time = 0;
    }
    const d = Math.min(Math.max(0, dt), this.tune.maxDt);
    const run = d > 0;
    if (run) {
      U.dt.value = d;
      U.jetCount.value = Math.min(this.jetCount, this.jetCap);
      U.bodyCount.value = Math.min(this.bodyCount, this.maxBodies);
      if (this._masksDirty) { this.maskTex.needsUpdate = true; this._masksDirty = false; }
      L.push(this.kOcc, this.kCurl, this.kAdvect, this.kReact, this.kDeck, this.kDiv);
      this._pushPressure(L);
      L.push(this.kProject, this.kDeckCopy);
      this.time += d;
      U.time.value = this.time;
      this._seed = (this._seed + 1) >>> 0;
      U.seed.value = this._seed;
    }
    this.stats.steps = run ? 1 : 0;
    this.stats.dispatches = L.length;
    this.stats.jets = U.jetCount.value;
    this.stats.bodies = U.bodyCount.value;
    if (!L.length || !renderer) return run;
    ensureHalfRoundingProbe(renderer);
    U.active.value = 1;
    renderer.compute(L);
    return run;
  }

  /** Rozgrzewka (ekran ładowania): wszystkie kernele z active = 0 — pipeline'y compute bez pracy. */
  warm(renderer) {
    if (!renderer) return;
    const prev = this.U.active.value;
    this.U.active.value = 0;
    renderer.compute(this._kernels);
    this.U.active.value = prev;
  }

  /** Pamięć GPU [B]. */
  get memoryBytes() {
    const { cells, deckCells } = this.domain;
    return cells * 8 * 10 + cells * 4 + cells * 4 * 4 + deckCells * 8 * 2 + deckCells * 4 + this.recs.value.array.byteLength
      + this.maskData.byteLength;
  }

  dispose() {
    for (const t of [this.velA, this.velB, this.velC, this.denA, this.denB, this.denC, this.curlT, this.lapT, this.faceT, this.occT, this.deckA, this.deckB,
      this.statTex, this.deckStartTex, this.maskTex]) t.dispose();
  }
}
