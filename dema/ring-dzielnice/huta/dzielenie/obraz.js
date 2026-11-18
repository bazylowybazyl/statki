// HUTA — element 4 (dzielenie): OBRAZ — partia arkuszy i odpadu (1 rysunek, bufor instancji z modelu, zakres wysyłki;
// runda 9: płyta obraca się na sztorc wokół chwyconej krawędzi), ostrze pola (1 rysunek, tylko przy mocy > 0), POLE
// RUCHOME (1 rysunek: pokrywy kaset, pas chwytu pod krawędzią, pasy wyrzutu), kanały pola dzielenia (32–47) i grupy
// ruchome (wózki noża, kasety) w materiale otoczenia, źródło światła linii przy cięciu. Moduł renderu: stan dostaje z
// argumentów `frame`, nie czyta `window` ani DOM. Klatka bez alokacji.
import * as THREE from 'three';
import { zbierzZakres } from '../../../../src/3d/zakresyWysylki.js';
import { METAL_FIZ, PASMO, VOL_UNIT } from '../formowanie/linia.js';
import { LIN_STAN, PL } from '../formowanie/linia.js';
import { ARK, ARK_CAP, ARK_N, ARK_ST, MV, MV_N, NOZ, NOZ_ST, RODZAJ, URZ, edgeAge, edgeExcess, edgeWidth, sweepTime } from './model.js';
import { KAS, KAS_CAP, KAS_N, KAS_ST } from './stojak.js';
import { CHWYT, DZIEL, HALF_T, KASETA, PASS_Y, XB } from './geometria.js';
import { DZ_MARK, F_REF } from './bryly.js';
import { STACJE } from '../formowanie/stacje.js';
import { WALC } from '../formowanie/walcownia.js';
import { OZ_X1 } from '../formowanie/odzgorzanie.js';
import { ARK_STRIDE, createBladeGeometry, createBladeMaterial, createBladeUniforms, createSheetGeometry, createSheetMaterial } from './arkuszTSL.js';
import { POLE_CAP, POLE_RODZAJ, POLE_STRIDE, createFieldGeometry, createFieldMaterial } from './poleTSL.js';

/** Pojemność partii (ciała ≤ 96). */
export const ARK_INST_CAP = 128;
const WRAP = 1048576;
const MS = METAL_FIZ[0];
const MC = METAL_FIZ[1];
const PC_K = VOL_UNIT / PASMO.A0;
const XF3 = WALC.stands[2].x;

const TQ = new Float64Array(2);
/** Faza krzywki, od której rozpina się pas pola (przed oknem synchronizacji). */
const ENV_ON = 0.96;
const sstep = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
/** k_metal przy udziale miedzi. */
const kMetal = (cu) => MS.kMetal + (MC.kMetal - MS.kMetal) * cu;
/** (poprawki rundy 8) Wiek brzegu w jednostkach τ przyrasta wzdłuż brzegu o −k_metal · sw / (200 · τ) na 1 j. z. */
const edgeSlope = (sw, cu) => -kMetal(cu) * sw / (200 * DZIEL.edge.tau);
/** Promień źródła światła cięcia: rura świecąca o wysokości lica h zastępczo jako kula R² / d² — R = √(h · d_ref). */
const tubeR = (h) => Math.sqrt(h * 60);
/** Plaster pasma pod x (najstarsze pasmo — przy nożu): T [K] → out[0] (0 — brak taśmy), udział miedzi → out[1]. */
function stripAt(line, x, adv, out) {
  out[0] = 0; out[1] = 0;
  if (!line) return;
  const SL = line.view.slices;
  const n = line.view.ring[1];
  for (let i = 0; i < n; i++) {
    const o = line.sliceOffset(i);
    if (SL[o + PL.s] + SL[o + PL.u] * adv <= x) { out[0] = SL[o + PL.T]; out[1] = SL[o + PL.x]; return; }
  }
}
/** Pozycja „poza kadrem” grupy ruchu (kaseta wolna w puli). */
const AWAY = 1e6;

export class DzielenieObraz {
  /**
   * @param {object} o
   * @param {import('three').Group} o.root   grupa w układzie komory
   * @param {object} o.U                      uniformy wytopu
   * @param {object} o.LM                     uniformy metalu linii (`LiniaObraz.LM` — jasność żaru taśmy)
   * @param {object} o.zl                     obraz otoczenia (`OU.pole`, `OU.dz`, `OU.ruch`, blok świateł linii)
   */
  constructor({ root, U, LM, zl, stations = null }) {
    this.zl = zl;
    // rekordy stacji pasma (`LiniaObraz.ST.array`): ξ łuski wwalcowanej za F3 — arkusz dostaje ją w chwili rozdzielenia
    this.stations = stations;
    this.xr = new Float32Array(ARK_CAP);
    this.ageSeen = new Float64Array(ARK_CAP).fill(1e9);
    this.data = new Float32Array(ARK_INST_CAP * ARK_STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, ARK_STRIDE);
    const g = createSheetGeometry();
    const { material, attrs } = createSheetMaterial(U, LM, this.buf);
    for (const k of Object.keys(attrs)) g.setAttribute(k, attrs[k]);
    this.g = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'Dzielenie_arkusze';
    this.mesh.frustumCulled = false;
    root.add(this.mesh);
    this.OB = createBladeUniforms();
    this.LM = LM;
    this.blade = new THREE.Mesh(createBladeGeometry(), createBladeMaterial(U, this.OB, LM));
    this.blade.name = 'Dzielenie_ostrze';
    this.blade.frustumCulled = false;
    this.blade.renderOrder = 4;
    this.blade.visible = false;
    root.add(this.blade);
    // (runda 9) POLE RUCHOME: pokrywy kaset, pas chwytu, pasy wyrzutu
    this.fData = new Float32Array(POLE_CAP * POLE_STRIDE);
    this.fBuf = new THREE.InstancedInterleavedBuffer(this.fData, POLE_STRIDE);
    const fg = createFieldGeometry();
    const fm = createFieldMaterial(U, this.fBuf);
    for (const k of Object.keys(fm.attrs)) fg.setAttribute(k, fm.attrs[k]);
    this.fg = fg;
    this.field = new THREE.Mesh(fg, fm.material);
    this.field.name = 'Dzielenie_pole_ruchome';
    this.field.frustumCulled = false;
    this.field.renderOrder = 5;
    root.add(this.field);
    this.n = 0;
    this.nf = 0;
    this.knifeLight = 0;
    // dwa ciała na listwie przechyłu (x tyłu, długość, F chwytu, F wyrzutu — po interpolacji ułamka kroku)
    this.slot = new Float64Array(8);
  }

  setLayers(layer) { this.mesh.layers.set(layer); this.blade.layers.set(layer); this.field.layers.set(layer); }

  /** Siatki zwykłe (rozgrzewka). */
  warmupMeshes() { return [this.blade]; }
  /** Siatki instancji (rozgrzewka z wariantem licznika ≥ 2). */
  warmupInstanced() { return [this.mesh, this.field]; }

  /** Rekord instancji k (bez alokacji). */
  _put(k, x, y, z, len, hwB, hwF, ht, kind, T0, T1, T2, T3, eB, sB, eF, sF, pcF, pcK, xi, cu, xr, th, kB, kF) {
    const d = this.data;
    const o = k * ARK_STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = len;
    d[o + 4] = hwB; d[o + 5] = hwF; d[o + 6] = ht; d[o + 7] = kind;
    d[o + 8] = T0; d[o + 9] = T1; d[o + 10] = T2; d[o + 11] = T3;
    d[o + 12] = eB; d[o + 13] = sB; d[o + 14] = eF; d[o + 15] = sF;
    d[o + 16] = pcF; d[o + 17] = pcK; d[o + 18] = xi; d[o + 19] = cu;
    d[o + 20] = xr; d[o + 21] = th; d[o + 22] = 0; d[o + 23] = 0;
    d[o + 24] = kB; d[o + 25] = kF; d[o + 26] = 0; d[o + 27] = 0;
  }
  /** Rekord pola ruchomego k: środek, półosie, rodzaj, jasność, postęp, linie sił (x0, podziałka). */
  _field(k, cx, cy, cz, hx, hy, hz, kind, F, prog, lx0, lp) {
    const d = this.fData;
    const o = k * POLE_STRIDE;
    d[o] = cx; d[o + 1] = cy; d[o + 2] = cz; d[o + 3] = kind;
    d[o + 4] = hx; d[o + 5] = hy; d[o + 6] = hz; d[o + 7] = F;
    d[o + 8] = prog; d[o + 9] = lx0; d[o + 10] = lp; d[o + 11] = 0;
  }

  /** ξ łuski wwalcowanej na taśmie za F3 teraz (stacje pasma między stacją odzgorzania a nożem); bez stacji — −1. */
  _xiRemNow() {
    const A = this.stations;
    if (!A) return -1;
    const SR = STACJE.stride;
    const x0 = Math.max(XF3 + 60, OZ_X1 + 30);
    for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
      const r = q * SR;
      const sx = A[r + 3];
      if (A[r + 7] < 2.5 || sx < x0) continue;
      if (sx > XB - 30) break;
      return A[r + 18];
    }
    return -1;
  }

  /**
   * Klatka: `model` — dzielenie (`createDivider`), `line` — linia (czoło cięte: żar brzegu na świetle), `alpha` — ułamek
   * kroku strony, `dt` — krok strony [s], `lineFlash` — błysk chwytu walców (światło [14] zajęte).
   */
  frame(model, line, alpha, dt, realDt = 1 / 60, lineFlash = 0) {
    this.fill(model, alpha, dt);
    this.uniforms(model, line, alpha, dt, realDt, lineFlash);
  }

  /** Bufory instancji (arkusze, pole ruchome) z modelu (ułamek kroku `alpha` — ruch ciał). Bez alokacji. */
  fill(model, alpha, dt) {
    const V = model.view;
    const B = V.bodies;
    const MVR = V.mov;
    const KS = V.kas;
    const adv = alpha * dt;
    const tNow = model.time + adv;
    let k = 0;
    const xrNow = this._xiRemNow();
    const S = this.slot;
    for (let q = 0; q < 8; q++) S[q] = 0;
    let ns = 0;
    let nf = 0;
    for (let i = 0; i < ARK_CAP && k < ARK_INST_CAP; i++) {
      const o = i * ARK_N;
      const st = B[o + ARK.st];
      if (st === ARK_ST.WOLNY) { this.ageSeen[i] = 1e9; continue; }
      // nowe ciało (wiek mniejszy niż w poprzedniej klatce): ξ resztki łuski z taśmy w chwili rozdzielenia (stała potem)
      const ag = B[o + ARK.age];
      if (ag < this.ageSeen[i]) this.xr[i] = xrNow >= 0 ? xrNow : 0.8 * B[o + ARK.xi];
      this.ageSeen[i] = ag;
      const cu = B[o + ARK.cu];
      const T0 = MS.T0 + (MC.T0 - MS.T0) * cu;
      const dT = (MS.T1 + (MC.T1 - MS.T1) * cu) - T0;
      // ruch w ułamku kroku: tył, środek y, zawias z, θ (prędkości z modelu — ciała w kasetach jadą z kasetą)
      const x = B[o + ARK.x] + B[o + ARK.vx] * adv;
      const y = B[o + ARK.y] + B[o + ARK.vy] * adv;
      const zh = B[o + ARK.z] + B[o + ARK.vz] * adv;
      const th = Math.min(Math.PI / 2, B[o + ARK.th] + B[o + ARK.om] * adv);
      const hwM = MVR[i * MV_N + MV.hw];
      // brzegi cięcia z WIEKU (poprawki rundy 8): nadwyżka w chwili cięcia, wiek w środku brzegu, zmiana wieku wzdłuż brzegu
      const tcB = B[o + ARK.tcB];
      const tcF = B[o + ARK.tcF];
      const swB = B[o + ARK.swB];
      const swF = B[o + ARK.swF];
      const eB = tcB >= 0 ? B[o + ARK.dTB] / dT : 0;
      const sB = tcB >= 0 ? edgeAge(tNow - tcB + 0.5 * Math.abs(swB), cu) : 0;
      const eF = tcF >= 0 ? B[o + ARK.dTF] / dT : 0;
      const sF = tcF >= 0 ? edgeAge(tNow - tcF + 0.5 * Math.abs(swF), cu) : 0;
      const kB = tcB >= 0 ? edgeSlope(swB, cu) : 0;
      const kF = tcF >= 0 ? edgeSlope(swF, cu) : 0;
      const kind = B[o + ARK.kind];
      const kk = kind === RODZAJ.CZOLO && B[o + ARK.tongue] > 0 ? 1 : kind === RODZAJ.DOBRY || kind === RODZAJ.ZLY || kind === RODZAJ.PRZEPELNIENIE ? 0 : 3;
      this._put(k++, x, y, zh + hwM, B[o + ARK.len], 0.5 * B[o + ARK.wB], 0.5 * B[o + ARK.wF], 0.25 * (B[o + ARK.tB] + B[o + ARK.tF]), kk,
        (B[o + ARK.T0] - T0) / dT, (B[o + ARK.T1] - T0) / dT, (B[o + ARK.T2] - T0) / dT, (B[o + ARK.T3] - T0) / dT,
        eB, sB, eF, sF, (B[o + ARK.m0F] * PC_K) % WRAP, B[o + ARK.dens] * PC_K, B[o + ARK.xi], cu, this.xr[i], th, kB, kF);
      // POLE pod krawędzią: wyrzut (obie listwy), chwyt i przechył (listwa przechyłu), pierwsza podziałka nad listwą
      const dev = B[o + ARK.dev];
      const onRail = st === ARK_ST.LOT || st === ARK_ST.PRZETOP;
      if (onRail && (dev === URZ.WYRZUT || dev === URZ.LISTWA || (dev === URZ.GRZEBIEN && zh > CHWYT.rail.z0))) {
        const len = B[o + ARK.len];
        const F = B[o + ARK.F] / F_REF;
        const kick = dev === URZ.WYRZUT;
        if (ns < 2) { const q = ns * 4; S[q] = x; S[q + 1] = len; if (kick) S[q + 3] = F; else S[q + 2] = F; ns++; }
        const yb = y - HALF_T;
        const R = CHWYT.rail;
        if (nf < POLE_CAP - 2) {
          // pas chwytu: od lica listwy (z −104…−110, wierzch −1050) do krawędzi płyty (zawias z_h, spód y_b)
          const z0 = Math.min(zh - 3, R.z0);
          const z1 = Math.max(zh + 3, R.z1);
          const y0 = R.y0;
          const y1 = Math.max(yb + 3, R.y1 + 1);
          this._field(nf++, x + 0.5 * len, 0.5 * (y0 + y1), 0.5 * (z0 + z1), 0.5 * len, 0.5 * (y1 - y0), 0.5 * (z1 - z0), kick ? POLE_RODZAJ.WYRZUT : POLE_RODZAJ.CHWYT, kick ? 0.5 * F : F, 0, R.x0, R.seg);
          if (kick) {
            // wyrzut: druga listwa (+z)
            const K = CHWYT.kickRail;
            const zz0 = Math.min(-zh - 3, K.z0);
            const zz1 = Math.max(-zh + 3, K.z1);
            this._field(nf++, x + 0.5 * len, 0.5 * (y0 + y1), 0.5 * (zz0 + zz1), 0.5 * len, 0.5 * (y1 - y0), 0.5 * (zz1 - zz0), POLE_RODZAJ.WYRZUT, 0.5 * F, 0, K.x0, K.seg);
          }
        }
      }
    }
    // POKRYWY POLA kaset (zamykanie w odjeździe, trzymanie do wyjazdu)
    for (let c = 0; c < KAS_CAP && nf < POLE_CAP; c++) {
      const o = c * KAS_N;
      const st = KS[o + KAS.st];
      const lid = KS[o + KAS.lid];
      if (st === KAS_ST.WOLNA || lid <= 0.001) continue;
      const dx = KS[o + KAS.dx] + KS[o + KAS.vx] * adv;
      const dz = KS[o + KAS.dz] + KS[o + KAS.vz] * adv;
      const closing = st === KAS_ST.ODJAZD && KS[o + KAS.t] < KASETA.lid;
      this._field(nf++, 0.5 * (KASETA.x0 + KASETA.x1) + dx, 0.5 * (KASETA.y0 + KASETA.y1) + 4, 0.5 * (KASETA.z0 + KASETA.z1) + dz,
        0.5 * (KASETA.x1 - KASETA.x0) + 4, 0.5 * (KASETA.y1 - KASETA.y0) + 6, 0.5 * (KASETA.z1 - KASETA.z0) + 4, POLE_RODZAJ.POKRYWA, closing ? 0.8 : 0.32, lid, 0, 1);
    }
    this.n = k;
    this.g.instanceCount = k;
    if (k > 0) zbierzZakres(this.buf, 0, k * ARK_STRIDE);
    this.nf = nf;
    this.fg.instanceCount = nf;
    this.field.visible = nf > 0;
    if (nf > 0) zbierzZakres(this.fBuf, 0, nf * POLE_STRIDE);
  }

  /**
   * Uniformy: ostrze, grupy ruchome otoczenia (wózki, kasety), kanały pola 32–47, światło [14] przy cięciu. (Zapis liczb do
   * wektorów three pakuje je w V8 jak w reszcie dema — mierzony bez alokacji jest `fill`.)
   */
  uniforms(model, line, alpha, dt, realDt, lineFlash) {
    const V = model.view;
    const B = V.bodies;
    const NZ = V.noz;
    const KS = V.kas;
    const adv = alpha * dt;

    // --- ostrze pola (runda 8, zasada G) ---
    const pw = NZ[NOZ.power];
    const sw = NZ[NOZ.sweep];
    const xb = NZ[NOZ.x] + NZ[NOZ.v] * adv;
    const u = NZ[NOZ.u];
    const f = u - Math.floor(u);
    const work = NZ[NOZ.st] === NOZ_ST.PRACA;
    let hwB = 24;
    if (f < DZIEL.U_SW0) hwB = 24 - 18 * f / DZIEL.U_SW0;
    else if (f <= DZIEL.U_SW1) hwB = 6;
    else if (f <= DZIEL.U_FOLD) hwB = 6 - 4 * (f - DZIEL.U_SW1) / (DZIEL.U_FOLD - DZIEL.U_SW1);
    let env = 0;
    if (work) {
      if (f >= ENV_ON) env = 0.5 * sstep((f - ENV_ON) / (1 - ENV_ON));
      else if (f < DZIEL.U_SW0) env = 0.5 + 0.5 * sstep(f / DZIEL.U_SW0);
      else if (f <= DZIEL.U_SW1) env = 1;
      else if (f <= DZIEL.U_FOLD) env = 1 - sstep((f - DZIEL.U_SW1) / (DZIEL.U_FOLD - DZIEL.U_SW1));
    }
    const dir = NZ[NOZ.dir];
    const zF = sw >= 0 ? NZ[NOZ.zF] + dir * 200 / ((DZIEL.U_SW1 - DZIEL.U_SW0) * DZIEL.P) * NZ[NOZ.vm] * adv : -100 * dir;
    const zFc = Math.max(-100, Math.min(100, zF));
    stripAt(line, xb, adv, TQ);
    const cu = TQ[1];
    const T0 = MS.T0 + (MC.T0 - MS.T0) * cu;
    const T1 = MS.T1 + (MC.T1 - MS.T1) * cu;
    const Tsol = MS.Tsol + (MC.Tsol - MS.Tsol) * cu;
    const Tb = TQ[0] > 0 ? (TQ[0] - T0) / (T1 - T0) : 0;
    const E0 = TQ[0] > 0 ? Math.max(0, (Tsol - TQ[0]) / (T1 - T0)) : 0;
    this.OB.A.value.set(xb, PASS_Y + HALF_T + 1.2, zFc, pw);
    this.OB.B.value.set(sw, dir, hwB, env);
    const swT = sweepTime(NZ[NOZ.vm]);
    this.OB.C.value.set(Tb, E0, cu, kMetal(cu) * swT / (200 * DZIEL.edge.tau));

    // --- żar brzegu cięcia na czole pasma (materiał pasma, `LM.cut`) ---
    let fx = 0; let fE = 0; let fE0 = 0; let fS = 0; let fK = 0; let fW = 0; let fTb = 0; let fcu = 0;
    if (line && line.stan[LIN_STAN.cutFront] > 0 && line.view.ring[1] > 0) {
      const L = line.stan;
      const o = line.sliceOffset(0);
      const SL = line.view.slices;
      fcu = SL[o + PL.x];
      const fT0 = MS.T0 + (MC.T0 - MS.T0) * fcu;
      const fT1 = MS.T1 + (MC.T1 - MS.T1) * fcu;
      const swc = NZ[NOZ.swD] * NZ[NOZ.swT];
      const tc = L[LIN_STAN.time] + adv - L[LIN_STAN.cutT] + 0.5 * NZ[NOZ.swT];
      fx = SL[o + PL.s] + SL[o + PL.u] * adv;
      fE0 = L[LIN_STAN.cutDT0] / (fT1 - fT0);
      fE = edgeExcess(L[LIN_STAN.cutDT0], tc, fcu) / (fT1 - fT0);
      fS = edgeAge(tc, fcu);
      fK = edgeSlope(swc, fcu);
      fW = edgeWidth(tc, fcu);
      fTb = (SL[o + PL.T] - fT0) / (fT1 - fT0);
    }
    if (this.LM && this.LM.cut) this.LM.cut.value.set(fx, fE0, fS, fK);
    // szczelina po rozdzieleniu: czoło pasma ↔ tył najmłodszego ciała w locie (wąska — wnęka z gorącymi licami)
    let gx = 0; let gw = 1e9; let ga = 1e9;
    if (fx > 0) {
      for (let i = 0; i < ARK_CAP; i++) {
        const o = i * ARK_N;
        const st = B[o + ARK.st];
        if ((st !== ARK_ST.LOT && st !== ARK_ST.PRZETOP) || B[o + ARK.age] >= ga) continue;
        ga = B[o + ARK.age];
        const xbk = B[o + ARK.x] + B[o + ARK.vx] * adv;
        gw = xbk - fx; gx = 0.5 * (xbk + fx);
      }
    }
    const gapOn = fx > 0 && gw > 0 && gw < 14 && fE > 0;
    this.OB.D.value.set(gapOn ? gx : 0, gapOn ? gw : 0, gapOn ? fE0 : 0, gapOn ? 1 : 0);
    this.OB.E.value.set(gapOn ? fS : 0, gapOn ? fK : 0, 0, 0);
    this.blade.visible = pw * env > 0.002 || gapOn;

    // --- grupy ruchome w materiale otoczenia: wózki noża, kasety ---
    const OU = this.zl.OU;
    OU.dz.value.set(xb - DZIEL.X_HOME, 0, 0, 0);
    const RA = OU.ruch.array;
    let gate = 0.08;
    for (let c = 0; c < DZ_MARK.ruchN; c++) {
      if (c >= KAS_CAP) { RA[c].set(AWAY, 0, 0, 0); continue; }
      const o = c * KAS_N;
      const st = KS[o + KAS.st];
      if (st === KAS_ST.WOLNA) { RA[c].set(AWAY, 0, 0, 0); continue; }
      if (st === KAS_ST.WYJAZD) gate = 1;
      RA[c].set(KS[o + KAS.dx] + KS[o + KAS.vx] * adv, 0, KS[o + KAS.dz] + KS[o + KAS.vz] * adv, Math.min(1.1, KS[o + KAS.field]));
    }

    // --- kanały pola dzielenia (32–47) ---
    const P = OU.pole.array;
    let Fg = 0;
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      const st = B[o + ARK.st];
      if (st === ARK_ST.GRZEBIEN || (st === ARK_ST.LOT && B[o + ARK.dev] === URZ.GRZEBIEN)) Fg += B[o + ARK.F];
    }
    const S = this.slot;
    P[8].set(Math.min(0.85, pw * 0.75), 0, 0, 0.02 + 0.8 * Math.min(1, Fg / F_REF));
    P[9].set(S[0], S[1], S[2], S[3]);
    P[10].set(S[4], S[5], S[6], S[7]);
    // 44 brama kaset, 45 szyny pola pomostu (czuwanie), 46–47 styk etapu 2
    P[11].set(gate, 0.12, 0, 0);

    // --- ŚWIATŁO CIĘCIA (źródło [14] bloku świateł linii, gdy błysk chwytu walców nie świeci): odcinek wzdłuż
    // szczeliny — w przemiataniu od brzegu taśmy do ogniska, po rozdzieleniu w środku odstępu (świecą oba lica), gdy
    // odstęp się otwiera — płynnie na czoło pasma (runda 9: arkusz odlatuje w osi i unosi się)
    let Tl = 0; let lx = 0; let lz0 = -100; let lz1 = 100; let R = 12;
    if (work && sw >= 0 && E0 > 0) { Tl = Tb + E0; lx = xb; lz0 = -100 * dir; lz1 = zFc; R = tubeR(9 + DZIEL.edge.w0 + 4 * env); }
    else if (fx > 0 && fx < DZIEL.wall.x0) {
      const k = gw < 1e8 ? 1 - sstep((gw - 8) / 24) : 0;
      Tl = fTb + fE; lx = fx + (gx - fx) * k; R = tubeR(9 + fW);
    }
    this.knifeLight = Tl;
    if (lineFlash <= 0.01 && Tl > 0.15) {
      const D = this.zl.LU.data;
      D[14].set(lx, PASS_Y + HALF_T, lz0, R);
      D[30].set(lx, PASS_Y + HALF_T, lz1, Tl);
    }
  }
}
