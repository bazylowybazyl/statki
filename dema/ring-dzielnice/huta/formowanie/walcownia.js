// HUTA — element 3, etap „Walcowanie”: KLATKI WALCOWNICZE F1–F3 NA ZAKRZEPŁEJ, GORĄCEJ TAŚMIE (czysty JS, bez three;
// krok bez alokacji).
//
// Kinematyka ciała stałego dla linii (`createFormingLine({ kin })` — ten sam kontrakt co `openMill()`): linia czyta w
// każdym podkroku tablicę `factor` (prędkość ciała stałego / prędkość linii co 1 j. drogi od `TX_S0`) i `stretch`
// (długość taśmy na jednostkę x — pętle między klatkami), a po cieple woła `step(h, line)`. Grubość taśmy wynika z masy:
// plaster Lagrange'a przyspiesza w klatce, wydłuża się, jego przekrój V / ℓ maleje — STAŁOŚĆ PRZEPŁYWU MASY (szerokość ×
// grubość × prędkość) nie jest dopisana, tylko wychodzi z ruchu granic plastrów.
//
//   KLATKA k   walce R 80 (gładkie), szczelina = grubość wyjścia t_k (oś przekroju: półgrubość `b_k`); w ŁUKU STYKU
//              (od punktu chwytu e_k do osi walców x_k) grubość idzie po okręgu walca, a prędkość z przepływu:
//              v(x) = v_wyj · t_k / t(x). Prędkość obwodowa walców = prędkość taśmy na wyjściu (ω = v_wyj / R).
//              Na klatce taśma traci ciepło w styku (ΔT rdzenia −8 K stal / −5 K miedź, lico −80 K wracające z τ 0,3 s)
//              i zrzuca zgorzelinę (ξ → 0,15 ξ) — zgorzelina odrasta między klatkami (model ciepła linii).
//   PRĘDKOŚCI  F1 jest sprzężona z linią (wejście = prędkość odlewania). Dalsze klatki: kaskada mnożników m_k =
//              m_{k−1} · (1 + c_k + d_k): d_k — SPADEK PRĘDKOŚCI PRZY CHWYCIE czoła (udar obciążenia, −3 % na ~0,4 s),
//              c_k — korekta PĘTLOWNIKA (regulator luzu w przęśle przed klatką; ±4 %, napęd τ 0,12 s).
//   PRZĘSŁO    między klatkami: luz ΔL = całka (v_wyj,k − v_wej,k+1); taśma wygina się w PĘTLĘ (sin², szczyt nad
//              pętlownikiem polowym), wysokość z długości łuku (tablica dla przęsła). Pętlownik trzyma ΔL = 8 j. Czoło
//              w przęśle (przed chwytem następnej klatki) jedzie prosto z prędkością wyjścia; po wyjściu końca z klatki
//              pętla opada (τ 0,35 s). Prędkość w przęśle: wzdłuż taśmy liniowo między końcami, w x podzielona przez
//              wydłużenie łuku (masa dokładna — plastry Lagrange'a; przekrój widziany przez `stretch`).
// Wyrób: taśma 200 × 9 j. (oś 9,3), v = v_odl · 30 / 9 (334 j./s przy Q_nom), 2,61 t/s.
import { HALA, LINIA, PATH } from './geometria.js';
import { LIN_STAN, PASMO, PL, SLICE_CAP, SLICE_STRIDE, TX_N, TX_S0, VOL_TON, areaK } from './linia.js';

const TAU = Math.PI * 2;
/** K(n) przekroju taśmy po bramie G4 (nadelipsa n = 6 — ta sama co w linii i obrazie). */
const K6 = areaK(6);

/** Liczby walcowni. Grubość `T` — średnia (przekrój / szerokość); półgrubość osi `b` = 2·t / K(6). */
export const WALC = Object.freeze((() => {
  const T = [LINIA.t0, ...LINIA.stands.map((s) => s.t)];               // 30 → 20 → 13 → 9
  const b = T.map((t) => 2 * t / K6);
  const R = LINIA.stands[0].R;
  const stands = LINIA.stands.map((s, k) => {
    // łuk styku: półgrubość osi rośnie po okręgu walca od b_k (oś walców) do b_{k−1} (chwyt)
    const db = b[k] - b[k + 1];
    const phi = Math.acos(1 - db / R);
    const ld = R * Math.sin(phi);
    return Object.freeze({ id: s.id, x: s.x + PATH.xOff, e: s.x + PATH.xOff - ld, ld, phi, tIn: T[k], tOut: T[k + 1], bIn: b[k], bOut: b[k + 1], R });
  });
  const spans = [0, 1].map((j) => {
    const a = stands[j].x;
    const e = stands[j + 1].e;
    return Object.freeze({ a, b: e, L: e - a, xm: (a + e) / 2 });
  });
  return {
    T: Object.freeze(T), b: Object.freeze(b), R, K6,
    stands: Object.freeze(stands), spans: Object.freeze(spans),
    // udar przy chwycie (spadek prędkości klatki): głębokość, narastanie [s], powrót τ [s], koniec [s]
    dip: 0.03, dipRise: 0.05, dipTau: 0.18, dipEnd: 1.5,
    // pętlownik: luz zadany [j.], wzmocnienie (korekta / błąd względny), granica korekty, napęd τ [s], opadanie po końcu [s]
    loopSet: 8, kp: 0.067, trimMax: 0.04, tauDrive: 0.12, tauTail: 0.35,
    // klatka: ochłodzenie rdzenia w styku [K] (stal, miedź), lica, zgorzelina po zrzucie (udział)
    dT: Object.freeze([8, 5]), dTs: -80, xiKeep: 0.15,
    // pętlownik polowy: emiter pod środkiem przęsła — wierzch [j. pod osią pasma], długość w x, półszerokość w z
    looperY: -46, looperLx: 34, looperZ: 118,
    // (runda 7, „Walcowanie — dopracowanie”) ZAKŁÓCENIA PRZEPŁYWU — skąd pętle pracują w stanie ustalonym:
    //   szczelina ustala grubość wyjścia, prędkość wejścia wynika z przepływu masy (v_wej = v_wyj · szczelina / grubość
    //   wejścia) — szum grubości taśmy z odlewania przechodzi w prędkość F1 i w niezgodność przepływu w przęśle;
    //   napęd F2 / F3 dochodzi do prędkości zadanej z opóźnieniem `tauD` [s] — przy zmianie prędkości odlewania
    //   (po zrzucie 0,7 → 1,4 nominału i z powrotem) pętle rosną i maleją;
    //   bicie walców (mimośród `ecc` — udział szczeliny) zmienia szczelinę w rytmie obrotu walca, fazy `eccPh`;
    //   sprężystość klatki (`spring`): grubszy wsad podnosi nacisk, klatka się rozpręża i przenosi tę część odchyłki
    //   grubości wejścia na wyjście (reszta przechodzi w prędkość) — szum grubości dochodzi też do F2 i F3
    tauD: 0.1, ecc: 0.008, spring: 0.35, eccPh: Object.freeze([0.3, 2.1, 4.4]),
    // RAMIĘ PĘTLOWNIKA (głowica z emiterem pola pod pętlą, bez dotyku): oś wahań `armDx` przed środkiem przęsła, `armDy`
    // pod osią pasma, długość `armL`, głowica `armClr` pod szczytem pętli, ramiona na |z| = `armZ`; ramię nadąża za
    // pętlą jak napęd z bezwładnością (ω_n `armW` [rad/s], tłumienie `armZeta`)
    armDx: -55, armDy: -100, armL: 115, armClr: 28, armZ: 126, armW: 9, armZeta: 0.55
  };
})());

/** Kąt ramienia pętlownika [rad] dla wysokości pętli h [j.] (głowica `armClr` pod szczytem; nad poziomem osi wahań). */
export function armAngleFor(h) {
  const W = WALC;
  const sn = (h - W.armClr - W.armDy) / W.armL;
  return Math.asin(sn < -0.95 ? -0.95 : sn > 0.999 ? 0.999 : sn);
}
/** Kąt spoczynku ramienia (bez pętli — taśma płaska albo przęsło puste). */
export const ARM_REST = armAngleFor(0);

const NS = 3;
const SP = WALC.stands;
const SPN = WALC.spans;
const RR = WALC.R;
const EXIT_S = PASMO.sExit;

/** Półgrubość osi taśmy [j.] na drodze s (profil nominalny walcowni — szczeliny i łuki styku). */
export function axisHalfAt(s) {
  for (let k = 0; k < NS; k++) {
    const st = SP[k];
    if (s < st.e) return WALC.b[k];
    if (s <= st.x) { const sn = (st.x - s) / RR; return st.bOut + RR * (1 - Math.sqrt(Math.max(0, 1 - sn * sn))); }
  }
  return WALC.b[NS];
}
/** Średnia grubość nominalna [j.] na s (przekrój / szerokość). */
export function thickAt(s) { return axisHalfAt(s) * K6 / 2; }

/** Środki walców klatki k: [x, y górnego, y dolnego] (układ komory). */
export function rollCenters(k) {
  const st = SP[k];
  return [st.x - PATH.xOff, HALA.passY + st.bOut + RR, HALA.passY - st.bOut - RR];
}

// tablice stałe: średnia grubość nominalna co 1 j. (środek komórki)
const TT = new Float64Array(TX_N);
for (let i = 0; i < TX_N; i++) TT[i] = thickAt(TX_S0 + i + 0.5);
const IE0 = Math.max(0, Math.floor(SP[0].e - TX_S0) - 2);            // od tej komórki tablice walcowni się zmieniają

/** Pętla: ΔL [j.] dla wysokości h na przęśle długości L (kształt y = h·sin²(πξ)) — tablice wysokość ↔ luz. */
const LOOP_N = 321;
const LOOP_DH = 0.25;
const LOOP_TAB = SPN.map((sp) => {
  const t = new Float64Array(LOOP_N);
  const M = 400;
  for (let q = 0; q < LOOP_N; q++) {
    const hh = q * LOOP_DH;
    let acc = 0;
    for (let i = 0; i < M; i++) {
      const xi = (i + 0.5) / M;
      const d = hh * Math.PI / sp.L * Math.sin(TAU * xi);
      acc += (Math.sqrt(1 + d * d) - 1) * sp.L / M;
    }
    t[q] = acc;
  }
  return t;
});

/** Wysokość pętli [j.] przy luzie ΔL na przęśle j (odwrócenie tablicy). */
export function loopHeight(j, dL) {
  const t = LOOP_TAB[j];
  if (!(dL > 0)) return 0;
  if (dL >= t[LOOP_N - 1]) return (LOOP_N - 1) * LOOP_DH;
  let lo = 0;
  let hi = LOOP_N - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= dL) lo = m; else hi = m; }
  const f = (dL - t[lo]) / Math.max(t[hi] - t[lo], 1e-12);
  return (lo + f) * LOOP_DH;
}

/** Tryby przęsła. */
export const PRZESLO = Object.freeze({ PUSTE: 0, CZOLO: 1, PETLA: 2, KONIEC: 3 });

/**
 * Walcownia F1–F3. Zwraca kinematykę dla `createFormingLine({ kin })` i stan do obrazu (`view`).
 */
export function createRollingMill() {
  const factor = new Float64Array(TX_N).fill(1);
  const stretch = new Float64Array(TX_N).fill(1);
  const lift = new Float64Array(TX_N);
  // stan klatek: kąt walców [rad], ω [rad/s], mnożnik prędkości m, korekta c, udar d, czas od chwytu [s], chwytów,
  // pokrycie wejścia / wyjścia (0/1), obciążenie (wygładzone 0…1), zgorzelina zrzucona [jedn.·ξ] (licznik), ochłodzenie
  const ang = new Float64Array(NS);
  const omega = new Float64Array(NS);
  const m = new Float64Array(NS).fill(1);
  const trim = new Float64Array(NS);
  const dip = new Float64Array(NS);
  const biteT = new Float64Array(NS).fill(99);
  const bites = new Int32Array(NS);
  const tailOuts = new Int32Array(NS);
  const tailT = new Float64Array(NS).fill(99);
  const covE = new Uint8Array(NS);
  const covX = new Uint8Array(NS);
  const prevE = new Uint8Array(NS);
  const prevX = new Uint8Array(NS);
  const load = new Float64Array(NS);
  const shed = new Float64Array(NS);           // zrzucona zgorzelina (narastająco) — iskry i płatki liczą przyrost
  const vExit = new Float64Array(NS);          // prędkość taśmy na wyjściu klatki [j./s]
  const vEntry = new Float64Array(NS);
  // przęsła: luz ΔL [j.], wysokość pętli [j.], tryb
  const dL = new Float64Array(2);
  const hLoop = new Float64Array(2);
  const mode = new Uint8Array(2);
  const looper = new Float64Array(2);          // siła pętlownika polowego (0…1+) — obraz
  const st = new Float64Array(8);              // [0] prędkość linii, [1] czas, [2] wyrób t/s
  // (runda 7) przepływ przez klatki: prędkość napędu (obwodowa) F2 / F3 z opóźnieniem, grubość wejścia względem
  // nominalnej (z plastrów przy chwycie), szczelina względna (bicie walców), współczynniki prędkości wyjścia i wejścia
  // (prędkość / prędkość linii — tablice kinematyki)
  const vDrive = new Float64Array(NS);
  const rIn = new Float64Array(NS).fill(1);
  const gap = new Float64Array(NS).fill(1);
  const fX = new Float64Array(NS).fill(1);
  const fE = new Float64Array(NS).fill(1);
  // ramię pętlownika: kąt [rad], prędkość kątowa, kąt zadany (z wysokości pętli)
  const arm = new Float64Array(2).fill(ARM_REST);
  const armV = new Float64Array(2);
  const armT = new Float64Array(2).fill(ARM_REST);
  const aDrive = 1 - Math.exp(-PASMO.h / WALC.tauDrive);
  const aSpeed = 1 - Math.exp(-PASMO.h / WALC.tauD);
  const aTail = Math.exp(-PASMO.h / WALC.tauTail);
  const aLoad = 1 - Math.exp(-PASMO.h / 0.15);
  for (let k = 0; k < NS; k++) { fX[k] = 30 / WALC.T[k + 1]; fE[k] = 30 / WALC.T[k]; }

  /**
   * Grubość wejścia klatki k względem nominalnej: przekrój plastrów tuż przed łukiem styku (pierwszy plaster w całości
   * przed punktem chwytu − 3 j. i następny w górę pasma, liniowo po położeniu — ciągłe, gdy granice przechodzą) przez
   * przekrój nominalny A0 · t_k / t0. Bez taśmy przed chwytem — 1.
   */
  function biteRatio(line, k) {
    // (wynik w `rIn[k]` — funkcja w kroku nie zwraca liczby zmiennoprzecinkowej: bez alokacji)
    rIn[k] = 1;
    const SL = line.view.slices;
    const ring = line.view.ring;
    const n = ring[1];
    const r0 = ring[0];
    const ref = SP[k].e - 3;
    for (let i = 0; i < n; i++) {
      const o = ((r0 + i) & (SLICE_CAP - 1)) * SLICE_STRIDE;
      const bot = SL[o + PL.s];
      if (bot > ref) continue;
      const t = SL[o + PL.tail];
      if (t === 2) return;
      const top = t === 1 ? SL[o + PL.ts] : SL[((r0 + i + 1) & (SLICE_CAP - 1)) * SLICE_STRIDE + PL.s];
      if (bot < ref - 60) return;
      const A0 = SL[o + PL.A];
      let A1 = A0;
      if (t === 0 && i + 1 < n) {
        const o1 = ((r0 + i + 1) & (SLICE_CAP - 1)) * SLICE_STRIDE;
        if (SL[o1 + PL.tail] !== 2 && SL[o1 + PL.fs] >= 0.999) A1 = SL[o1 + PL.A];
      }
      const len = bot - top;
      let f = len > 1e-6 ? (ref - bot) / len : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      // (gdy plaster zostaje kandydatem — jego dolna granica o długość plastra przed punktem — waga 1 na nim; gdy granica
      // dochodzi do punktu, waga przechodzi na następny w górę pasma, który zaraz zostanie kandydatem: bez skoku)
      const A = A1 + (A0 - A1) * f;
      const An = PASMO.A0 * WALC.T[k] / WALC.T[0];
      if (A > 0) rIn[k] = A / An;
      return;
    }
  }

  function rebuild() {
    // tablice od chwytu F1 do końca: łuki styku, przęsła (pętle), wyjście F3. W łuku styku klatki k prędkość z przepływu
    // względem grubości nominalnej łuku (v ∝ 1 / t(x)), skorygowana liniowo od wejścia (v_wej — z grubości wejścia i
    // szczeliny) do wyjścia (prędkość obwodowa walców)
    for (let i = IE0; i < TX_N; i++) {
      const s = TX_S0 + i + 0.5;
      let f = 1;
      let w = 1;
      let y = 0;
      let k = -1;
      if (s < SP[0].e) f = 1;
      else if (s <= SP[0].x) k = 0;
      else if (s < SP[1].e) {
        // przęsło 0
        const sp = SPN[0];
        const xi = (s - sp.a) / sp.L;
        const va = fX[0];
        const vb = fE[1];
        const hh = hLoop[0];
        const sn = Math.sin(Math.PI * xi);
        y = hh * sn * sn;
        const d = hh * Math.PI / sp.L * Math.sin(TAU * xi);
        w = Math.sqrt(1 + d * d);
        const md = mode[0];
        f = md === PRZESLO.PETLA ? (va + (vb - va) * xi) / w : md === PRZESLO.KONIEC ? vb / w : va / w;
      } else if (s <= SP[1].x) k = 1;
      else if (s < SP[2].e) {
        const sp = SPN[1];
        const xi = (s - sp.a) / sp.L;
        const va = fX[1];
        const vb = fE[2];
        const hh = hLoop[1];
        const sn = Math.sin(Math.PI * xi);
        y = hh * sn * sn;
        const d = hh * Math.PI / sp.L * Math.sin(TAU * xi);
        w = Math.sqrt(1 + d * d);
        const md = mode[1];
        f = md === PRZESLO.PETLA ? (va + (vb - va) * xi) / w : md === PRZESLO.KONIEC ? vb / w : va / w;
      } else if (s <= SP[2].x) k = 2;
      else f = fX[2];
      if (k >= 0) {
        const S = SP[k];
        const fn = fX[k] * WALC.T[k + 1] / TT[i];
        const rho = fE[k] / (fX[k] * WALC.T[k + 1] / WALC.T[k]);
        const wgt = (S.x - s) / S.ld;
        f = fn * (1 + (rho - 1) * (wgt < 0 ? 0 : wgt > 1 ? 1 : wgt));
      }
      factor[i] = f;
      stretch[i] = w;
      lift[i] = y;
    }
  }

  const kin = {
    id: 'walcownia',
    factor, stretch, lift,
    /** Prędkość ciała stałego na drodze s przy prędkości linii v [j./s]. */
    speedAt(s, v) { let i = (s - TX_S0) | 0; i = i < 0 ? 0 : i >= TX_N ? TX_N - 1 : i; return v * factor[i]; },
    /** Średnia grubość nominalna na s [j.]. */
    thickAt,
    /** Numer klatki, której łuk styku / oś jest najbliżej s (−1 — daleko). */
    passIndex(s) { for (let k = 0; k < NS; k++) if (s >= SP[k].e - 40 && s <= SP[k].x + 40) return k; return -1; },
    /** Krok kinematyki (podkrok linii h): pokrycie klatek, chwyty, zgorzelina, regulatory pętli, tablice, kąty walców. */
    step(h, line) {
      const S = line.stan;
      const SL = line.view.slices;
      const ring = line.view.ring;
      const n = ring[1];
      const vL = S[LIN_STAN.vLine];
      st[0] = vL;
      st[1] += h;
      // --- pokrycie punktów chwytu i osi walców; przejścia plastrów przez klatki (styk: ciepło, zgorzelina) ---
      for (let k = 0; k < NS; k++) { prevE[k] = covE[k]; prevX[k] = covX[k]; covE[k] = 0; covX[k] = 0; }
      const r0 = ring[0];
      for (let i = 0; i < n; i++) {
        const o = ((r0 + i) & (SLICE_CAP - 1)) * SLICE_STRIDE;
        const t = SL[o + PL.tail];
        const bot = SL[o + PL.s];
        const top = t === 2 ? PASMO.sG0 : t === 1 ? SL[o + PL.ts] : SL[((r0 + i + 1) & (SLICE_CAP - 1)) * SLICE_STRIDE + PL.s];
        if (bot < SP[0].e - 1) continue;
        for (let k = 0; k < NS; k++) {
          if (top <= SP[k].e && bot >= SP[k].e) covE[k] = 1;
          if (top <= SP[k].x && bot >= SP[k].x) covX[k] = 1;
        }
        // przejście środka plastra przez oś walców klatki (kolejno: PL.k = liczba klatek za plastrem)
        const c = 0.5 * (top + bot);
        const kk = SL[o + PL.k] | 0;
        if (kk < NS && c >= SP[kk].x && SL[o + PL.fs] >= 0.999) {
          const x = SL[o + PL.x];
          SL[o + PL.H] -= WALC.dT[0] + (WALC.dT[1] - WALC.dT[0]) * x;
          SL[o + PL.dTs] = WALC.dTs;
          const xi = SL[o + PL.xi];
          SL[o + PL.xi] = xi * WALC.xiKeep;
          shed[kk] += xi * (1 - WALC.xiKeep) * SL[o + PL.m];
          SL[o + PL.k] = kk + 1;
        }
      }
      // --- chwyt czoła (wejście pokryte od teraz) i wyjście końca z klatki ---
      for (let k = 0; k < NS; k++) {
        if (covE[k] && !prevE[k]) { biteT[k] = 0; bites[k]++; }
        if (!covX[k] && prevX[k] && !covE[k]) { tailT[k] = 0; tailOuts[k]++; }
        biteT[k] += h;
        tailT[k] += h;
        const tb = biteT[k];
        // udar przy chwycie (F1 sprzężona z linią — bez spadku; jej chwyt widać w iskrach i świetle)
        dip[k] = k > 0 && tb < WALC.dipEnd ? -WALC.dip * Math.min(1, tb / WALC.dipRise) * Math.exp(-Math.max(0, tb - WALC.dipRise) / WALC.dipTau) : 0;
        load[k] += ((covE[k] || covX[k] ? 1 : 0) - load[k]) * aLoad;
      }
      // --- tryby przęseł ---
      for (let j = 0; j < 2; j++) {
        const a = covX[j];
        const b = covE[j + 1];
        mode[j] = a && b ? PRZESLO.PETLA : a ? PRZESLO.CZOLO : b ? PRZESLO.KONIEC : PRZESLO.PUSTE;
      }
      // --- regulatory pętlowników (korekta klatki za przęsłem) i kaskada prędkości zadanych ---
      // (runda 7) PRZEPŁYW PRZEZ KLATKI: szczelina ustala grubość wyjścia (z biciem walca), prędkość wejścia wynika z
      // przepływu masy — v_wej = v_wyj · szczelina / grubość wejścia. F1 sprzężona z odlewaniem: v_wej = v_odl, więc jej
      // prędkość obwodowa idzie za grubością wsadu (szum grubości z odlewania → prędkość wyjścia F1). F2 i F3: prędkość
      // zadana z kaskady na prędkości odlewania (rozkład grubości × korekty pętlowników), napęd dochodzi do niej z
      // opóźnieniem `tauD`, udar chwytu zbija prędkość rzeczywistą. Niezgodność wyjście k / wejście k + 1 to luz pętli.
      for (let k = 0; k < NS; k++) {
        if (covE[k]) biteRatio(line, k); else rIn[k] = 1;
        // szczelina pod obciążeniem: bicie walca + sprężystość klatki (grubszy wsad — większy nacisk — klatka „oddaje”
        // część różnicy grubości na wyjście, `spring`)
        gap[k] = (1 + WALC.ecc * Math.sin(ang[k] + WALC.eccPh[k])) * (1 + WALC.spring * (rIn[k] - 1));
      }
      m[0] = rIn[0] / gap[0];
      const vOk = vL > 0.5;
      vExit[0] = vL * 30 / WALC.T[1] * rIn[0] / gap[0];
      vDrive[0] = vExit[0];
      let cas = vL * 30;
      for (let k = 1; k < NS; k++) {
        const j = k - 1;
        let cT = 0;
        if (mode[j] === PRZESLO.PETLA) {
          cT = WALC.kp * (dL[j] - WALC.loopSet) / WALC.loopSet;
          cT = cT < -WALC.trimMax ? -WALC.trimMax : cT > WALC.trimMax ? WALC.trimMax : cT;
        }
        trim[k] += (cT - trim[k]) * aDrive;
        cas *= 1 + trim[k];
        const vRef = cas / WALC.T[k + 1];
        vDrive[k] = vOk && st[3] > 0 ? vDrive[k] + (vRef - vDrive[k]) * aSpeed : vRef;
        let v = vDrive[k] * (1 + dip[k]);
        // taśma napięta (luz 0): klatka nie wyciągnie więcej, niż daje poprzednia (wejście = wyjście poprzedniej)
        const vIn = v * WALC.T[k + 1] * gap[k] / (WALC.T[k] * rIn[k]);
        if (mode[j] === PRZESLO.PETLA && dL[j] <= 0 && vIn > vExit[j]) v *= vExit[j] / vIn;
        vExit[k] = v;
        m[k] = vOk ? v / (vL * 30 / WALC.T[k + 1]) : 1 + trim[k];
      }
      for (let k = 0; k < NS; k++) {
        vEntry[k] = vExit[k] * WALC.T[k + 1] * gap[k] / (WALC.T[k] * rIn[k]);
        if (k === 0) vEntry[0] = vL;
        fX[k] = vOk ? vExit[k] / vL : 30 / WALC.T[k + 1] * m[k];
        fE[k] = vOk ? vEntry[k] / vL : 30 / WALC.T[k] * m[k];
      }
      // --- luz w przęsłach ---
      for (let j = 0; j < 2; j++) {
        if (mode[j] === PRZESLO.PETLA) {
          dL[j] += (vExit[j] - vEntry[j + 1]) * h;
          if (dL[j] < 0) dL[j] = 0;
        } else if (mode[j] === PRZESLO.KONIEC) dL[j] *= aTail;
        else dL[j] = 0;
        hLoop[j] = loopHeight(j, dL[j]);
        // siła pętlownika polowego (obraz): trzyma pętlę (∝ wysokości) + praca regulatora (korekta klatki za przęsłem)
        looper[j] = mode[j] === PRZESLO.PETLA ? 0.35 + 0.65 * Math.min(1.4, hLoop[j] / 28) + 0.3 * Math.abs(trim[j + 1]) / WALC.trimMax : mode[j] === PRZESLO.KONIEC ? 0.2 : 0.08;
        // RAMIĘ PĘTLOWNIKA: kąt zadany z wysokości pętli nad głowicą, nadążanie jak napęd z bezwładnością (2. rzędu)
        const sp = SPN[j];
        const xh = (sp.xm + WALC.armDx + WALC.armL * Math.cos(arm[j]) - sp.a) / sp.L;
        const shp = Math.sin(Math.PI * (xh < 0 ? 0 : xh > 1 ? 1 : xh));
        {
          // (kąt zadany jak `armAngleFor` — wklejony: bez wywołania zwracającego liczbę w kroku)
          const hh = mode[j] === PRZESLO.PETLA || mode[j] === PRZESLO.KONIEC ? hLoop[j] * shp * shp : 0;
          let sn = (hh - WALC.armClr - WALC.armDy) / WALC.armL;
          sn = sn < -0.95 ? -0.95 : sn > 0.999 ? 0.999 : sn;
          armT[j] = Math.asin(sn);
        }
        const wn = WALC.armW;
        armV[j] += (wn * wn * (armT[j] - arm[j]) - 2 * WALC.armZeta * wn * armV[j]) * h;
        arm[j] += armV[j] * h;
      }
      rebuild();
      // --- walce: prędkość obwodowa = prędkość taśmy na wyjściu ---
      for (let k = 0; k < NS; k++) {
        omega[k] = vExit[k] / RR;
        ang[k] += omega[k] * h;
        if (ang[k] > TAU) ang[k] -= TAU;
      }
      st[2] = WALC.T[3] * gap[2] * LINIA.w * vExit[2] / VOL_TON;
      st[3] = 1;                                  // napędy F2 / F3 rozpędzone (pierwszy krok — od prędkości zadanej)
    },
    /** Wymiary wyrobu przy bieżącej prędkości linii. */
    product() {
      const v = vExit[2];
      return { szerokosc: LINIA.w, grubosc: WALC.T[3], grubOsi: 2 * WALC.b[3], v, tNaS: WALC.T[3] * LINIA.w * v / VOL_TON, jNaT: VOL_TON / (WALC.T[3] * LINIA.w) };
    },
    view: { ang, omega, m, trim, dip, biteT, bites, tailT, tailOuts, covE, covX, load, shed, vExit, vEntry, dL, hLoop, mode, looper, st, vDrive, rIn, gap, arm, armV, armT }
  };
  rebuild();
  return kin;
}

/** Sprawdzenie: wyjście pasma (tunel) leży za ostatnią klatką i w tablicach. */
export const MILL_OK = SP[NS - 1].x < EXIT_S && Math.ceil(EXIT_S) - TX_S0 < TX_N;
