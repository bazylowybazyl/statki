// HUTA — element 4: DZIELENIE TAŚMY — MODEL (czysty JS, bez three i DOM; krok bez alokacji, losowość mulberry32 z ziarna).
//
// Projekt: `.tmp/huta/formowanie/PROJEKT-dzielenie.md` (nóż, runda 8 — ZASADA G: bez zmian) i `PROJEKT-chwyt-zwijanie.md`
// (runda 9 — wszystko po rozdzieleniu). Model liczy się W PODKROKU LINII (1/240 s), po ruchu plastrów i kinematyce
// walcowni (`createFormingLine({ divider })` woła `step(h)`):
//   NÓŻ       krzywka elektroniczna sprzęgnięta z DROGĄ TAŚMY M = (x czoła − XB) + C_cięte; wózki (serwo pola) jadą do
//             x(u); ROZDZIELENIE, gdy M dojdzie do M_1 + k·P — w RZECZYWISTYM położeniu ostrza (`line.cutAt`); stany:
//             SPOCZYNEK → UZBROJONY (zmierzone zimne czoło) → PRACA → STOP (pasmo się skończyło). (Runda 9, styk zwijarki:
//             `program` — ARKUSZE / KREGI, zmiana na granicy cięcia z `onProgramChange`; poza programem ARKUSZE krzywka
//             parkuje w tylnym zawrocie, `armOneCut(M)` — jeden obieg i jedno cięcie na drodze M.)
//   CIAŁA     (runda 9) od rozdzielenia arkusz jest CIAŁEM SWOBODNYM: prędkość zmienia mu tylko widoczne urządzenie
//             (`lot.js`): WYRZUT listwami pola → LOT (prędkość stała) → CHWYT polem listwy przechyłu (prędkość względna 0)
//             → UNIESIENIE i HAMOWANIE w x (regulator położenia: tył staje na `CHWYT.xStop`) → PRZECHYŁ na sztorc →
//             pierwsza podziałka GRZEBIENIA sprzęgnięta z drogą taśmy → KOLEJKA grzebienia (`stojak.js`) → slot KASETY;
//             kaseta odjeżdża do ODBIORU i przez bramę (konto `odebrane`). ODPAD (zimne czoło, ogon, metal mieszany,
//             arkusz niezłapany — przepełnienie, `chwyt: false`) dostaje ten sam wyrzut i leci prosto w osi przez otwór
//             PRZETOP (konto `przetop` za tunelem).
//   PĘD       każda zmiana pędu ciała (środka masy) i ramy kasety idzie do konta `pedKonstrukcji` (reakcja urządzenia);
//             Σ pęd ciał + ram + konstrukcja + wyniesiony = Σ wniesiony przy cięciach (m·v taśmy) — `audit().ped`.
//   CIEPŁO    arkusz: 4 węzły T wzdłuż długości; promieniowanie jak taśma (`linia.js`: K_r, ε ciała stałego, T_env) z obu
//             dużych ścian i brzegów; w kasecie ściana zwrócona do sąsiada ledwie widzi halę (`SHIELD`). Żar brzegu cięcia —
//             analitycznie z czasu cięcia (`edgeExcess`).
// BILANS [jedn. 1/1536 t]: wejscie (= `exited` linii) = lot + grzebien + kasety + odbior + wyjazd + odebrane + szczelina +
// rynna + przetopLot + przetop + [etap 2: zwoj + kregi + odebraneKregi + kieszen] po KAŻDYM podkroku (`audit()`), plus
// zgodność kont z ciałami.
import { UNITS_PER_TON } from '../wytop/komora.js';
import { KAW, KAW_N, LIN_LICZNIK, LIN_STAN, METAL_FIZ, PASMO, PL, SLICE_CAP, SLICE_STRIDE, VOL_TON, VOL_UNIT } from '../formowanie/linia.js';
import { LINIA } from '../formowanie/geometria.js';
import { WALC } from '../formowanie/walcownia.js';
import { CHWYT, DZIEL, HALF_T, KASETA, PASS_Y, PRZETOP, STOJAK, U_HOME, XB, camGp, camGpp, camX } from './geometria.js';
import { marchCam, motionLift, motionX, planFlight, plateCom } from './lot.js';
import { KAS, KAS_CAP, KAS_LIST, KAS_N, KAS_ST, createRack } from './stojak.js';

const UT = UNITS_PER_TON;
const MASK = SLICE_CAP - 1;
const D = DZIEL;
const P = D.P;
const TW = D.T;
const F3X = WALC.stands[2].x;
/** Prędkość taśmy za F3 przy Q_nom [j./s] (≈ 334; moc ostrza ∝ v). */
const V_NOM = PASMO.qNom * VOL_TON / PASMO.A0 * LINIA.t0 / LINIA.sched[3];
const KR = PASMO.Kr;
const TREF = PASMO.Tref;
const ENV4 = (PASMO.Tenv / TREF) ** 4;
const MS = METAL_FIZ[0];
const MC = METAL_FIZ[1];
const PERIOD_U = 1 + D.U_CUT - U_HOME;      // faza od tylnego zawrotu do rozdzielenia (0,316)
/** Ściana arkusza zwrócona do sąsiada w kasecie (24 j. podziałki, 15 j. szczeliny przy 200 j. wysokości): widzi halę w tym
 *  ułamku (współczynnik widzenia szczeliny ok. 2 · 15 / 200 z odbiciami), reszta to wymiana z sąsiadem o tej samej T. */
const SHIELD = 0.12;
const HALF_PI = Math.PI / 2;
/** Najmniejszy postęp pierwszej podziałki poprzedniego arkusza w chwili przechyłu następnego (plan projektu przy 1,4 Q:
 *  0,85 podziałki i prześwit płyt 8,8 j.; w rytmie ≈ 1). Mniej — wejście zajęte, arkusz do przetopu (przepełnienie). */
const ENTRY_U = 0.85;
/** Stała czasowa wygładzenia prędkości taśmy dla sprzężenia grzebienia [s]. */
const VS_TAU = 0.06;

/** Rekord ciała (arkusz / kawałek odpadu) w `view.bodies` (krok `ARK_N`). Indeksy `st`, `xi`, `age` stałe od rundy 8. */
export const ARK = Object.freeze({
  st: 0, kind: 1, units: 2, len: 3, wB: 4, wF: 5, tB: 6, tF: 7,
  // tył arkusza x, środek płyty y (przy θ = 0), ZAWIAS z (dolna krawędź −z płyty), ich prędkości
  x: 8, y: 9, z: 10, vx: 11, vy: 12, vz: 13,
  // przechył wokół zawiasu θ [rad] i ω; temperatura 4 węzłów (przód → tył)
  th: 14, om: 15, T0: 16, T1: 17, T2: 18, T3: 19,
  xi: 20, cu: 21, m0F: 22, dens: 23, tcB: 24, tcF: 25, dTB: 26, dTF: 27,
  // F — siła urządzenia na ciele [t·j./s²] (= m · |a środka masy|), tS — czas od rozdzielenia, dev — urządzenie (`URZ`),
  // seq — numer cięcia, kas / slot — kaseta i slot (−1 — bez), cause — bity przyczyny (zapis tolerancji, odrzut metalu)
  F: 28, tS: 29, dev: 30, tongue: 31, seq: 32, kas: 33, slot: 34, cause: 35,
  // przyspieszenie ŚRODKA MASY (x, y, z)
  ax: 36, ay: 37, az: 38, age: 39,
  // stan marszu (`MARSZ`), przyspieszenie tyłu w x i zawiasu w z (ciągłość planów grzebienia), α, przemiatanie brzegów
  mst: 40, ax0: 41, az0: 42, al: 43, swB: 44, swF: 45
});
export const ARK_N = 46;
export const ARK_CAP = 96;
/** Stany ciała (konto masy). */
export const ARK_ST = Object.freeze({ WOLNY: 0, LOT: 1, GRZEBIEN: 2, KASETA: 3, ODBIOR: 4, WYJAZD: 5, PRZETOP: 6 });
export const ARK_ST_NAMES = Object.freeze(['wolny', 'lot', 'grzebień', 'kaseta', 'odbiór', 'wyjazd', 'przetop']);
/** Rodzaj ciała. */
export const RODZAJ = Object.freeze({ DOBRY: 0, CZOLO: 1, OGON: 2, ZLY: 3, PRZEPELNIENIE: 4 });
export const RODZAJ_NAMES = Object.freeze(['dobry', 'czoło', 'ogon', 'zły', 'przepełnienie']);
/** Przyczyna (bity `cause`): wymiary — tylko zapis (runda 9, SPEC § 12.1 F), metal mieszany — odrzut. */
export const PRZYCZYNA = Object.freeze({ dlugosc: 1, szerokosc: 2, grubosc: 4, metal: 8 });
/** Urządzenie działające na ciele (`ARK.dev`). */
export const URZ = Object.freeze({ BRAK: 0, WYRZUT: 1, LISTWA: 2, GRZEBIEN: 3, KASETA: 4 });
/** Stan marszu (`ARK.mst`): czeka na wejściu, pierwsza podziałka (sprzęgnięta), w kolejce grzebienia. */
export const MARSZ = Object.freeze({ CZEKA: 0, PODZIALKA: 1, KOLEJKA: 2 });

/** Rekord ruchu ciała (`view.mov`, krok `MV_N`): plan lotu (9 liczb `planFlight`), plan pięciomianowy (7), pęd środka masy. */
export const MV = Object.freeze({
  x0: 0, v0: 1, t0: 2, z0: 3, F: 4, mM0: 13, C: 14, tp0: 21, zt: 22, px: 23, py: 24, pz: 25, grab: 26, hw: 27,
  ly: 28, lvy: 29, lay: 30, vzc: 31, pend: 32, tt0: 33
});
export const MV_N = 34;

/** Nóż (`view.noz`). */
export const NOZ = Object.freeze({
  st: 0, u: 1, x: 2, v: 3, a: 4, M: 5, Mon: 6, C: 7, cuts: 8, Lc: 9, sweep: 10, dir: 11, power: 12, tSep: 13, zF: 14,
  Mb: 15, vm: 16, nextCut: 17, uStop: 18, M1: 19, lastLen: 20, sparkDue: 21, sparkX: 22, sparkZ: 23, sparkT: 24,
  sparkEnd: 25, xCut: 26, vStrip: 27, errMax: 28, dvMax: 29, frontCut: 30, tCut: 31, lastUnits: 32, prevCutT: 33,
  sparkDir: 34, kerfA: 35,
  xt: 36, vt: 37, at: 38,                     // cel serwa wózków z poprzedniego podkroku (serwo goni cel z początku podkroku)
  headOk: 39,                                 // zimne czoło zmierzone w całości (100 j. w tolerancji widać za klinem)
  swT: 40, swD: 41,                           // ostatnie cięcie: czas przemiatania ogniska [s] i jego kierunek (± 1)
  one: 42, dvm: 43,                           // (runda 9) jeden obieg (`armOneCut`), przyrost prędkości taśmy [j./s²]
  // (runda 9) droga i prędkość taśmy DLA GRZEBIENIA: prędkość czoła wygładzona (τ `VS_TAU`) — czoło pasma przy ogonie
  // i przy cięciu skacze o kilkadziesiąt j./s z podkroku na podkrok; sprzężenie podziałki z drogą nie przenosi tych skoków
  vs: 44, Mc: 45, dvs: 46, v1: 47
});
export const NOZ_N = 48;
export const NOZ_ST = Object.freeze({ SPOCZYNEK: 0, UZBROJONY: 1, PRACA: 2, STOP: 3 });
export const NOZ_ST_NAMES = Object.freeze(['spoczynek', 'uzbrojony', 'praca', 'stop']);
/** Program wyrobu (styk zwijarki, etap 2). */
export const PROGRAM = Object.freeze({ ARKUSZE: 0, KREGI: 1 });

/** Konta masy [jedn.] i liczniki (`view.licz`). */
export const LICZ = Object.freeze({
  wejscie: 0, lot: 1, grzebien: 2, kasety: 3, odbior: 4, wyjazd: 5, odebrane: 6, szczelina: 7, rynna: 8, przetopLot: 9,
  przetop: 10, zwoj: 11, kregi: 12, odebraneKregi: 13, kieszen: 14,
  dobre: 15, kaset: 16, czolo: 17, ogon: 18, zle: 19, przepelnienie: 20, ciecia: 21, przelot: 22, iskry: 23, poTolerancji: 24
});
export const LICZ_N = 28;
/** Konta pędu [t·j./s] (`view.ped`): wniesiony przy cięciach, konstrukcja (reakcje urządzeń), wyniesiony (za halą). */
export const PED = Object.freeze({ wx: 0, wy: 1, wz: 2, kx: 3, ky: 4, kz: 5, ox: 6, oy: 7, oz: 8 });
/** LISTWY (`view.listwa`): dwa ciała na listwie przechyłu — [x tyłu, długość, siła chwytu, siła wyrzutu] × 2; [8] grzebień. */
export const LISTWA_N = 12;

/**
 * Klasyfikacja kawałka przy rozdzieleniu (§ 5.3 rundy 8): 0 — w tolerancji, > 0 — bity przyczyny (`PRZYCZYNA`), < 0 —
 * −(rodzaj + 1) dla czoła i ogona pasma. `out` — rekord `KAW`.
 */
export function classifyPiece(out) {
  if (out[KAW.tail] > 0) return -(RODZAJ.OGON + 1);
  if (out[KAW.cutF] === 0) return -(RODZAJ.CZOLO + 1);
  const T = D.tol;
  const cu = out[KAW.cu];
  let cause = 0;
  if (Math.abs(out[KAW.len] - D.L) > T.len) cause |= PRZYCZYNA.dlugosc;
  if (out[KAW.wMin] < T.w0 || out[KAW.wMax] > T.w1) cause |= PRZYCZYNA.szerokosc;
  if (out[KAW.tMin] < T.t0 || out[KAW.tMax] > T.t1) cause |= PRZYCZYNA.grubosc;
  if (cu > T.cu && cu < 1 - T.cu) cause |= PRZYCZYNA.metal;
  return cause;
}

/**
 * Wiek brzegu w jednostkach τ: s = t · k_metal / τ (t — czas od przejścia ogniska przez to miejsce brzegu [s]). Obraz
 * liczy nadwyżkę i pas z s (`krawedzTSL.js`: E = E0 / √(1 + s), w = w0 (1 + √s)), także zmienne wzdłuż brzegu.
 */
export function edgeAge(t, cu) {
  const km = MS.kMetal + (MC.kMetal - MS.kMetal) * cu;
  return Math.max(0, t) * km / D.edge.tau;
}
/** Nadwyżka temperatury brzegu cięcia [K] po czasie t od cięcia (ΔT0 — w chwili cięcia; miedź τ / k_metal). */
export function edgeExcess(dT0, t, cu) {
  return dT0 / Math.sqrt(1 + edgeAge(t, cu));
}
/** Szerokość pasa żaru brzegu [j.] po czasie t od cięcia (w0 + 2√(α t) = w0 (1 + √(t/τ)), τ = w0² / 4α). */
export function edgeWidth(t, cu) {
  return D.edge.w0 * (1 + Math.sqrt(edgeAge(t, cu)));
}
/** Czas przemiatania ogniska przez szerokość taśmy [s] przy prędkości taśmy v (faza U_SW0…U_SW1 krzywki). */
export function sweepTime(v) {
  return (D.U_SW1 - D.U_SW0) * P / Math.max(1, v);
}

/**
 * Dzielenie. `seed` — ziarno (iskry), `odbior` — 'auto' (kaseta odjeżdża z odbioru po `KASETA.pick` s) albo 'stop' (zostaje
 * do `odbierz()` — testy blokady i przepełnienia), `chwyt` — false: listwa nie łapie (A/B, awaria — wszystko do przetopu).
 * Łączy się z linią przez `createFormingLine({ divider })`.
 */
export function createDivider({ seed = 17, odbior = 'auto', chwyt = true } = {}) {
  const B = new Float64Array(ARK_CAP * ARK_N);
  const MVR = new Float64Array(ARK_CAP * MV_N);
  const FV = [];
  const CV = [];
  for (let i = 0; i < ARK_CAP; i++) { FV.push(MVR.subarray(i * MV_N + MV.F, i * MV_N + MV.F + 9)); CV.push(MVR.subarray(i * MV_N + MV.C, i * MV_N + MV.C + 7)); }
  const NZ = new Float64Array(NOZ_N);
  const KQ = new Float64Array(32 * 2);            // metal szczeliny czekający (czas, jedn.) — pierścień
  const KR_ = new Int32Array(2);                   // [0] początek, [1] liczba
  const RQ = new Float64Array(64 * 2);            // krople w rynnie pod nożem (czas, jedn.) — pierścień do przetopu dnem rynny
  const RR = new Int32Array(2);
  const L = new Float64Array(LICZ_N);
  const PD = new Float64Array(9);
  const LW = new Float64Array(LISTWA_N);
  const OUT = new Float64Array(KAW_N);
  const TQ = new Float64Array(6);
  const RB = new Float64Array(3);
  const MX = new Float64Array(4);
  const ML = new Float64Array(9);
  const MC_ = new Float64Array(3);
  const PC = new Float64Array(6);
  // [0] odbiór stop, [1] chwyt włączony, [2] program (`PROGRAM`), [3] program zadany (na najbliższym cięciu)
  const CFG = Float64Array.of(odbior === 'stop' ? 1 : 0, chwyt ? 1 : 0, PROGRAM.ARKUSZE, PROGRAM.ARKUSZE);
  const CH = new Int32Array(4);                    // [0] numer cięcia, [1] —
  const rs = new Uint32Array(1);
  rs[0] = (seed >>> 0) ^ 0x9E3779B9;
  let line = null;
  let onProgramChange = null;
  const TT = new Float64Array(2);                  // [0] czas modelu [s], [1] przelot linii (widziany)
  const lastCas = new Float64Array(8);
  NZ[NOZ.x] = D.X_HOME;
  NZ[NOZ.xt] = D.X_HOME;
  NZ[NOZ.dir] = 1;
  NZ[NOZ.prevCutT] = -1;
  NZ[NOZ.tCut] = -1;

  // --- pomocnicze (bez alokacji) -----------------------------------------------------------------------------------
  function freeBody() {
    for (let i = 0; i < ARK_CAP; i++) if (B[i * ARK_N + ARK.st] === ARK_ST.WOLNY) return i;
    return -1;
  }
  /** Własności metalu przy udziale miedzi → TQ: [ε, k_metal, T0, T1, T_sol]. */
  function metal(cu) {
    TQ[0] = MS.es + (MC.es - MS.es) * cu;
    TQ[1] = MS.kMetal + (MC.kMetal - MS.kMetal) * cu;
    TQ[2] = MS.T0 + (MC.T0 - MS.T0) * cu;
    TQ[3] = MS.T1 + (MC.T1 - MS.T1) * cu;
    TQ[4] = MS.Tsol + (MC.Tsol - MS.Tsol) * cu;
  }
  function stateSum(st) {
    let s = 0;
    for (let i = 0; i < ARK_CAP; i++) if (B[i * ARK_N + ARK.st] === st) s += B[i * ARK_N + ARK.units];
    return s;
  }
  const ACC = [-1, LICZ.lot, LICZ.grzebien, LICZ.kasety, LICZ.odbior, LICZ.wyjazd, LICZ.przetopLot];
  /** Zmiana stanu ciała i razem konta masy (każda masa ma jednego właściciela). */
  function move(i, st) {
    const o = i * ARK_N;
    const u = B[o + ARK.units];
    const a = ACC[B[o + ARK.st]];
    if (a >= 0) L[a] -= u;
    B[o + ARK.st] = st;
    const b = ACC[st];
    if (b >= 0) L[b] += u;
  }
  const avgT = (o) => 0.25 * (B[o + ARK.T0] + B[o + ARK.T1] + B[o + ARK.T2] + B[o + ARK.T3]);

  // --- STOJAK (grzebień i kasety) ---
  const rack = createRack({
    B, MV: MVR, CV, cfg: CFG, UT,
    A: { ARK, ARK_N, M: MV, MV_N, ST: ARK_ST },
    units: (i) => B[i * ARK_N + ARK.units],
    move,
    avgT(c) {
      let s = 0; let n = 0;
      for (let j = 0; j < KASETA.n; j++) { const i = rack.KL[c * KAS_LIST + j]; if (i >= 0) { s += avgT(i * ARK_N); n++; } }
      return n ? s / n : 0;
    },
    gone(i) {
      // arkusz wyjechał z kasetą za bramę: konto `odebrane`, pęd wyniesiony
      const o = i * ARK_N;
      const m = i * MV_N;
      const u = B[o + ARK.units];
      L[ACC[B[o + ARK.st]]] -= u;
      L[LICZ.odebrane] += u;
      PD[PED.ox] += MVR[m + MV.px]; PD[PED.oy] += MVR[m + MV.py]; PD[PED.oz] += MVR[m + MV.pz];
      MVR[m + MV.px] = 0; MVR[m + MV.py] = 0; MVR[m + MV.pz] = 0;
      B[o + ARK.st] = ARK_ST.WOLNY;
    },
    frameGone(c) {
      const o = c * KAS_N;
      PD[PED.ox] += rack.KS[o + KAS.px]; PD[PED.oz] += rack.KS[o + KAS.pz];
      rack.KS[o + KAS.px] = 0; rack.KS[o + KAS.pz] = 0;
      L[LICZ.kaset]++;
    },
    lastCassette(c) {
      const o = c * KAS_N;
      lastCas[0] = rack.KS[o + KAS.k]; lastCas[1] = rack.KS[o + KAS.units]; lastCas[2] = rack.KS[o + KAS.Tpick];
      lastCas[3] = rack.KS[o + KAS.Tout]; lastCas[4] = TT[0] - rack.KS[o + KAS.tFull]; lastCas[5] = rack.KS[o + KAS.id];
      lastCas[6] = TT[0];
    }
  });

  /**
   * Zimne czoło: droga od czoła do początku 100 j. taśmy w tolerancji (szerokość ≥ 197, grubość ≤ 9,3) + 20 j. → `NZ.Lc`;
   * `NZ.headOk` = 1, gdy te 100 j. widać już za F3 (inaczej pomiar jest dolną granicą i powtarza się w następnych
   * podkrokach — krzywka rusza dopiero przy M_on z ostatecznego pomiaru).
   */
  function measureHead() {
    NZ[NOZ.headOk] = 0;
    const SL = line.view.slices;
    const ring = line.view.ring;
    const n = ring[1];
    const H = D.head;
    const o0 = ((ring[0]) & MASK) * SLICE_STRIDE;
    const xF = SL[o0 + PL.s];
    let runStart = 0;
    for (let i = 0; i < n; i++) {
      const o = ((ring[0] + i) & MASK) * SLICE_STRIDE;
      const t = SL[o + PL.tail];
      const bot = SL[o + PL.s];
      const top = t === 2 ? PASMO.sG0 : t === 1 ? SL[o + PL.ts] : SL[((ring[0] + i + 1) & MASK) * SLICE_STRIDE + PL.s];
      if (top < F3X + 30) break;                   // przed F3 grubość nie jest końcowa — dalej nie mierzymy
      const wid = 2 * SL[o + PL.a];
      const thk = SL[o + PL.A] / Math.max(1e-6, wid);
      const T = D.tol;
      if (!(wid >= T.w0 && wid <= T.w1 && thk >= T.t0 && thk <= T.t1)) runStart = xF - top;
      else if (xF - top - runStart >= H.run) {
        const lc = runStart + H.margin;
        NZ[NOZ.headOk] = 1;
        return lc < H.min ? H.min : lc > H.max ? H.max : lc;
      }
      if (t !== 0) break;
      void bot;
    }
    const lc = runStart + H.margin;
    return lc < H.min ? H.min : lc > H.max ? H.max : lc;
  }

  /** Uzbrojenie krzywki z pomiaru czoła: M_1 = L_c + w_k / 2, M_on = M_1 − 0,316 · P (nie wcześniej niż teraz). */
  function armFromHead(first) {
    const lc = measureHead();
    NZ[NOZ.Lc] = lc;
    const M = NZ[NOZ.M];
    let M1 = lc + D.WK / 2;
    let Mon = M1 - PERIOD_U * P;
    if (Mon < M) {
      // czoło minęło już punkt ruszenia (start po zatrzymaniu krzywki): ruszamy teraz, kawałek czoła dłuższy
      if (!first && NZ[NOZ.Mon] <= M) return;
      Mon = M; M1 = Mon + PERIOD_U * P;
    }
    NZ[NOZ.Mon] = Mon;
    NZ[NOZ.M1] = M1;
    NZ[NOZ.nextCut] = M1;
  }

  /** Złapane arkusze, które jeszcze nie weszły do kolejki grzebienia (lot, chwyt, przechył, pierwsza podziałka). */
  function pendingGrab() {
    let n = 0;
    for (let i = 0; i < ARK_CAP; i++) { const o = i * ARK_N; if (B[o + ARK.st] === ARK_ST.LOT && MVR[i * MV_N + MV.grab] > 0) n++; }
    return n;
  }
  /**
   * Wejście zajęte (§ 2.7 projektu — przepełnienie): arkusz po uniesieniu nie zszedł jeszcze z wejścia, bo pierwsza
   * podziałka nie mogła ruszyć (bufor grzebienia pełny). Następny arkusz nie zostaje wtedy złapany.
   */
  function entryBlocked() {
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      if (B[o + ARK.st] !== ARK_ST.LOT || MVR[i * MV_N + MV.grab] === 0 || B[o + ARK.mst] !== MARSZ.CZEKA) continue;
      if (B[o + ARK.tS] > FV[i][2] + CHWYT.rise.t + 1e-9) return true;
    }
    return false;
  }
  /** Przechył arkusza j może ruszyć: każdy wcześniejszy arkusz w pierwszej podziałce przeszedł już `ENTRY_U` podziałki. */
  function entryClear(j) {
    const seq = B[j * ARK_N + ARK.seq];
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      if (i === j || B[o + ARK.st] !== ARK_ST.LOT || B[o + ARK.seq] > seq) continue;
      const mst = B[o + ARK.mst];
      if (mst === MARSZ.CZEKA && MVR[i * MV_N + MV.grab] > 0) return false;
      if (mst === MARSZ.PODZIALKA && (NZ[NOZ.Mc] - MVR[i * MV_N + MV.mM0]) / P < ENTRY_U) return false;
    }
    return true;
  }

  /** Nowe ciało z rekordu kawałka (`OUT`) — klasyfikacja, chwyt albo przetop, plan lotu, konta, pęd wniesiony. */
  function spawnBody(vStrip, swTail = 0) {
    const units = OUT[KAW.units];
    const kerf = OUT[KAW.kerf];
    L[LICZ.wejscie] += units + kerf;
    if (kerf > 0) {
      L[LICZ.szczelina] += kerf;
      if (KR_[1] < 32) {
        const j = ((KR_[0] + KR_[1]) & 31) * 2;
        KQ[j] = TT[0]; KQ[j + 1] = kerf; KR_[1]++;
      } else { L[LICZ.szczelina] -= kerf; L[LICZ.przetop] += kerf; }
    }
    if (units <= 0) return -1;
    const i = freeBody();
    if (i < 0) {
      // (pula pełna — nie zdarza się: ≤ 3 w locie, ≤ 13 w grzebieniu, kasety 3 × 8, odpad w osi ≤ 3) — masa wprost do przetopu
      L[LICZ.przetop] += units;
      return -1;
    }
    const o = i * ARK_N;
    const m = i * MV_N;
    for (let k = 0; k < ARK_N; k++) B[o + k] = 0;
    for (let k = 0; k < MV_N; k++) MVR[m + k] = 0;
    const cu = OUT[KAW.cu];
    const cause = classifyPiece(OUT);
    // (runda 9, SPEC § 12.1 F) odpad to tylko czoło, ogon i metal mieszany — wymiar poza tolerancją po zmianie przepływu
    // jest zapisem (`cause`, licznik), arkusz idzie do kasety
    let kind = cause < 0 ? -cause - 1 : (cause & PRZYCZYNA.metal) ? RODZAJ.ZLY : RODZAJ.DOBRY;
    let grab = 0;
    if (kind === RODZAJ.DOBRY) {
      if (cause > 0) L[LICZ.poTolerancji]++;
      if (CFG[1] > 0 && CFG[2] === PROGRAM.ARKUSZE && !entryBlocked() && rack.canGrab(pendingGrab())) grab = 1;
      else kind = RODZAJ.PRZEPELNIENIE;
    }
    B[o + ARK.kind] = kind;
    B[o + ARK.cause] = cause > 0 ? cause : 0;
    B[o + ARK.units] = units;
    B[o + ARK.len] = OUT[KAW.len];
    B[o + ARK.wB] = OUT[KAW.wB]; B[o + ARK.wF] = OUT[KAW.wF];
    B[o + ARK.tB] = OUT[KAW.tB]; B[o + ARK.tF] = OUT[KAW.tF];
    const hw = 0.5 * Math.max(OUT[KAW.wB], OUT[KAW.wF]);
    B[o + ARK.x] = OUT[KAW.xB];
    B[o + ARK.y] = PASS_Y;
    B[o + ARK.z] = -hw;
    B[o + ARK.vx] = vStrip;
    B[o + ARK.kas] = -1;
    B[o + ARK.slot] = -1;
    B[o + ARK.seq] = ++CH[0];
    B[o + ARK.dev] = URZ.WYRZUT;
    MVR[m + MV.x0] = OUT[KAW.xB];
    MVR[m + MV.v0] = vStrip;
    MVR[m + MV.t0] = TT[0];
    MVR[m + MV.z0] = -hw;
    MVR[m + MV.hw] = hw;
    MVR[m + MV.grab] = grab;
    MVR[m + MV.tp0] = -1;
    MVR[m + MV.tt0] = -1;
    planFlight(OUT[KAW.xB], vStrip, grab > 0, FV[i]);
    for (let q = 0; q < 4; q++) B[o + ARK.T0 + q] = OUT[KAW.T0 + q];
    B[o + ARK.xi] = OUT[KAW.xi];
    B[o + ARK.cu] = cu;
    B[o + ARK.m0F] = OUT[KAW.m0F];
    B[o + ARK.dens] = OUT[KAW.dens];
    metal(cu);
    if (OUT[KAW.tail] > 0) { B[o + ARK.tcB] = -1; B[o + ARK.dTB] = 0; } else { B[o + ARK.tcB] = TT[0]; B[o + ARK.dTB] = Math.max(0, TQ[4] - OUT[KAW.T3]); B[o + ARK.swB] = swTail; }
    if (OUT[KAW.cutF] > 0) { B[o + ARK.tcF] = OUT[KAW.tcF]; B[o + ARK.dTF] = OUT[KAW.dTF]; B[o + ARK.swF] = NZ[NOZ.swD] * NZ[NOZ.swT]; } else { B[o + ARK.tcF] = -1; B[o + ARK.dTF] = 0; }
    B[o + ARK.tongue] = OUT[KAW.cutF] > 0 ? 0 : 1;
    // pęd przejęty z pasma (m · v taśmy pod ostrzem)
    const mt = units / UT;
    MVR[m + MV.px] = mt * vStrip;
    PD[PED.wx] += mt * vStrip;
    B[o + ARK.st] = grab ? ARK_ST.LOT : ARK_ST.PRZETOP;
    L[grab ? LICZ.lot : LICZ.przetopLot] += units;
    if (kind === RODZAJ.DOBRY) L[LICZ.dobre]++;
    else if (kind === RODZAJ.CZOLO) L[LICZ.czolo]++;
    else if (kind === RODZAJ.OGON) L[LICZ.ogon]++;
    else if (kind === RODZAJ.ZLY) L[LICZ.zle]++;
    else L[LICZ.przepelnienie]++;
    return i;
  }

  /** Serwo pola jednej osi: przyspieszenie (zadane + PD), ograniczenie — wynik w TQ[5]. */
  function servo(x, v, xt, vt, at, om, ze, amax) {
    let a = at + om * om * (xt - x) + 2 * ze * om * (vt - v);
    a = a > amax ? amax : a < -amax ? -amax : a;
    TQ[5] = a;
  }

  /** Ciepło jednego ciała (4 węzły) przez h: wystawienie `e` [1/j.] (powierzchnia / objętość). */
  function coolBody(o, e, h) {
    metal(B[o + ARK.cu]);
    const k = KR * TQ[0] * e * h;
    for (let q = 0; q < 4; q++) {
      const T = B[o + ARK.T0 + q];
      const tr = T / TREF;
      B[o + ARK.T0 + q] = T - k * (tr * tr * tr * tr - ENV4);
    }
  }

  // --- krok ----------------------------------------------------------------------------------------------------------
  function step(h) {
    if (!line) return;
    const LS = line.stan;
    // czas modelu = czas linii (ten sam podkrok; czasy cięć z linii bez przeliczeń)
    TT[0] = LS[LIN_STAN.time];
    const time = TT[0];
    const SL = line.view.slices;
    const ring = line.view.ring;
    // przelot (bezpiecznik linii): masa za końcem drogi pasma wchodzi do dzielenia jako odpad — test pilnuje zera
    if (LS[LIN_STAN.overrun] > TT[1]) {
      const d = LS[LIN_STAN.overrun] - TT[1];
      TT[1] = LS[LIN_STAN.overrun];
      L[LICZ.wejscie] += d; L[LICZ.przetop] += d; L[LICZ.przelot] += d;
    }
    // --- pasmo przy nożu: czoło najstarszego pasma, jego prędkość, koniec ---
    const n = ring[1];
    let xF = -1e9;
    let uF = 0;
    let tailS = -1e9;
    let tailFree = false;
    if (n > 0) {
      const o0 = (ring[0] & MASK) * SLICE_STRIDE;
      xF = SL[o0 + PL.s];
      uF = SL[o0 + PL.u];
      for (let i = 0; i < n; i++) {
        const o = ((ring[0] + i) & MASK) * SLICE_STRIDE;
        const t = SL[o + PL.tail];
        if (t === 1) { tailS = SL[o + PL.ts]; tailFree = true; break; }
        if (t === 2) break;
      }
    }
    const st = NZ[NOZ.st];
    const vPrev = NZ[NOZ.vm];
    let vm = NZ[NOZ.vm];
    // OGON minął nóż: cała reszta najstarszego pasma jest jednym kawałkiem (odpad)
    if (tailFree && xF >= XB && tailS >= XB + D.WK / 2) {
      line.releaseAll(OUT);
      if (OUT[KAW.units] > 0) spawnBody(uF);
      if (st === NOZ_ST.PRACA || st === NOZ_ST.UZBROJONY) {
        NZ[NOZ.st] = st === NOZ_ST.PRACA ? NOZ_ST.STOP : NOZ_ST.SPOCZYNEK;
        // zatrzymanie w najbliższym tylnym zawrocie (następna faza U_HOME + k)
        const u = NZ[NOZ.u];
        NZ[NOZ.uStop] = Math.floor(u - U_HOME) + 1 + U_HOME;
      }
      // pasmo przy nożu odczytamy w następnym podkroku (następne pasmo albo nic)
      xF = -1e9; uF = 0;
    }
    const st2 = NZ[NOZ.st];
    const hasStrip = xF > -1e8;
    if (st2 === NOZ_ST.SPOCZYNEK) {
      NZ[NOZ.u] = U_HOME;
      if (hasStrip && xF >= XB && LS[LIN_STAN.cutFront] === 0) {
        NZ[NOZ.C] = 0;
        NZ[NOZ.M] = xF - XB;
        NZ[NOZ.headOk] = 0;
        NZ[NOZ.st] = NOZ_ST.UZBROJONY;
        armFromHead(true);
      } else if (hasStrip && LS[LIN_STAN.cutFront] > 0 && CFG[2] !== PROGRAM.ARKUSZE) {
        // (runda 9, styk zwijarki) krzywka zaparkowana poza programem ARKUSZE: droga taśmy biegnie dalej z prędkością taśmy
        // pod nożem (czoło nie jest już miarą drogi — taśma idzie do zwijarki), `armOneCut` tnie na tej drodze
        NZ[NOZ.M] += uF * h;
      }
    }
    // pomiar czoła powtarzany, póki klin nie jest widoczny w całości (M_on rośnie z nim; krzywka jeszcze stoi)
    if (NZ[NOZ.st] === NOZ_ST.UZBROJONY && NZ[NOZ.headOk] === 0 && hasStrip) { NZ[NOZ.M] = xF - XB + NZ[NOZ.C]; armFromHead(false); }
    if (NZ[NOZ.st] === NOZ_ST.UZBROJONY || NZ[NOZ.st] === NOZ_ST.PRACA) {
      if (hasStrip) {
        // (program ARKUSZE — droga z czoła, jak w rundzie 8; jeden obieg `armOneCut` — droga całkowana z prędkości taśmy)
        NZ[NOZ.M] = NZ[NOZ.one] > 0 ? NZ[NOZ.M] + uF * h : xF - XB + NZ[NOZ.C];
        vm = uF;
      }
      if (NZ[NOZ.st] === NOZ_ST.UZBROJONY) {
        NZ[NOZ.u] = U_HOME;
        if (NZ[NOZ.M] >= NZ[NOZ.Mon]) NZ[NOZ.st] = NOZ_ST.PRACA;
      }
      if (NZ[NOZ.st] === NOZ_ST.PRACA) NZ[NOZ.u] = U_HOME + (NZ[NOZ.M] - NZ[NOZ.Mon]) / P;
    } else if (NZ[NOZ.st] === NOZ_ST.STOP) {
      // droga wirtualna: M rośnie dalej z ostatnią prędkością, aż krzywka dojdzie do tylnego zawrotu
      NZ[NOZ.M] += vm * h;
      const u = U_HOME + (NZ[NOZ.M] - NZ[NOZ.Mon]) / P;
      if (u >= NZ[NOZ.uStop]) { NZ[NOZ.u] = NZ[NOZ.uStop]; NZ[NOZ.st] = NOZ_ST.SPOCZYNEK; } else NZ[NOZ.u] = u;
    }
    // droga ciał (ciągła zawsze; po końcu pasma — wirtualna z ostatnią prędkością)
    NZ[NOZ.vm] = vm;
    NZ[NOZ.dvm] = (vm - vPrev) / h;
    NZ[NOZ.Mb] += vm * h;
    {
      // filtr dwustopniowy: prędkość i jej pochodna ciągłe (zryw podziałki ograniczony także przy skokach czoła)
      const k = 1 - Math.exp(-h / VS_TAU);
      const vs0 = NZ[NOZ.vs];
      NZ[NOZ.v1] += (vm - NZ[NOZ.v1]) * k;
      NZ[NOZ.vs] += (NZ[NOZ.v1] - vs0) * k;
      NZ[NOZ.dvs] = (NZ[NOZ.vs] - vs0) / h;
      NZ[NOZ.Mc] += NZ[NOZ.vs] * h;
    }
    NZ[NOZ.vStrip] = uF;
    // --- serwo wózków noża (z wyprzedzeniem przyspieszenia krzywki) ---
    // (serwo goni cel z POCZĄTKU podkroku: półniejawny krok Eulera kończy wtedy podkrok w celu z jego końca z błędem
    // O(a·h²) — cel z końca podkroku dawał stałe opóźnienie o drogę jednego podkroku, v·h ≈ 1,4 j.)
    {
      const running = NZ[NOZ.st] === NOZ_ST.PRACA || NZ[NOZ.st] === NOZ_ST.STOP;
      const u = NZ[NOZ.u];
      const S = D.servoCar;
      servo(NZ[NOZ.x], NZ[NOZ.v], NZ[NOZ.xt], NZ[NOZ.vt], NZ[NOZ.at], S.om, S.ze, S.amax);
      NZ[NOZ.a] = TQ[5];
      NZ[NOZ.v] += TQ[5] * h;
      NZ[NOZ.x] += NZ[NOZ.v] * h;
      NZ[NOZ.xt] = running ? camX(u) : D.X_HOME;
      NZ[NOZ.vt] = running ? camGp(u) * vm : 0;
      NZ[NOZ.at] = running ? camGpp(u) * vm * vm / P + camGp(u) * (vm - vPrev) / h : 0;
      if (!running && NZ[NOZ.st] === NOZ_ST.SPOCZYNEK && Math.abs(NZ[NOZ.x] - D.X_HOME) < 1e-3 && Math.abs(NZ[NOZ.v]) < 1e-3) { NZ[NOZ.x] = D.X_HOME; NZ[NOZ.v] = 0; }
      // przemiatanie ogniska (faza 0,02…0,12 okna synchronizacji) i moc ostrza ∝ prędkość taśmy (moc topienia szczeliny)
      const f = u - Math.floor(u);
      let pw = 0;
      let sw = -1;
      if (NZ[NOZ.st] === NOZ_ST.PRACA) {
        if (f >= U_HOME) { const s = (f - U_HOME) / (1 - U_HOME); pw = 0.6 * s * s; } else if (f < D.U_SW0) pw = 0.6 + 0.4 * f / D.U_SW0;
        else if (f <= D.U_SW1) { pw = 1; sw = (f - D.U_SW0) / (D.U_SW1 - D.U_SW0); } else if (f <= D.U_FOLD) pw = 1 - 0.9 * (f - D.U_SW1) / (D.U_FOLD - D.U_SW1);
        else pw = 0.1 * (1 - (f - D.U_FOLD) / (U_HOME - D.U_FOLD));
        pw *= Math.max(0, vm) / V_NOM;
      }
      const swPrev = NZ[NOZ.sweep];
      NZ[NOZ.power] = pw;
      NZ[NOZ.sweep] = sw;
      if (sw >= 0) {
        const dir = NZ[NOZ.dir];
        NZ[NOZ.zF] = dir * (-100 + 200 * sw);
        // iskry z liczonej masy szczeliny: round(8 · jedn. szczeliny) na cięcie, w miarę przemiatania
        const A = n > 0 ? SL[(ring[0] & MASK) * SLICE_STRIDE + PL.A] : 0;
        const kerfU = D.WK * A / VOL_UNIT;
        NZ[NOZ.kerfA] = kerfU;
        const ds = sw - (swPrev >= 0 ? swPrev : 0);
        if (ds > 0) {
          NZ[NOZ.sparkDue] += Math.round(D.sparkPerUnit * kerfU) * ds;
          NZ[NOZ.sparkX] = NZ[NOZ.x];
          NZ[NOZ.sparkZ] = NZ[NOZ.zF];
          NZ[NOZ.sparkDir] = dir;
          NZ[NOZ.sparkEnd] = sw > 0.85 ? 1 : 0;
          metal(LS[LIN_STAN.resX]);
          NZ[NOZ.sparkT] = Math.min(1.1, (TQ[4] - TQ[2]) / (TQ[3] - TQ[2]) + 0.1);
        }
        // synchronizacja: prędkość ostrza względem taśmy w czasie przemiatania (test)
        if (vm > 1) { const dv = Math.abs(NZ[NOZ.v] - vm) / vm; if (dv > NZ[NOZ.dvMax]) NZ[NOZ.dvMax] = dv; }
      }
    }
    // --- ROZDZIELENIE: M doszło do M_1 + k·P — szczelina w rzeczywistym położeniu ostrza ---
    if (NZ[NOZ.st] === NOZ_ST.PRACA && NZ[NOZ.M] >= NZ[NOZ.nextCut] && hasStrip) {
      const xc = NZ[NOZ.x];
      const fb = xF;
      line.cutAt(xc, D.WK, OUT);
      if (OUT[KAW.units] + OUT[KAW.kerf] > 0) {
        const len = OUT[KAW.len];
        // przemiatanie tego cięcia (kierunek × czas): tył nowego kawałka i czoło pasma; przód kawałka — cięcie poprzednie
        const swT = sweepTime(vm);
        spawnBody(uF, NZ[NOZ.dir] * swT);
        NZ[NOZ.swT] = swT;
        NZ[NOZ.swD] = NZ[NOZ.dir];
        NZ[NOZ.cuts]++;
        L[LICZ.ciecia]++;
        NZ[NOZ.lastLen] = len;
        NZ[NOZ.lastUnits] = OUT[KAW.units];
        NZ[NOZ.xCut] = xc;
        NZ[NOZ.prevCutT] = NZ[NOZ.tCut];
        NZ[NOZ.tCut] = time;
        NZ[NOZ.tSep] = 0;
        NZ[NOZ.dir] = -NZ[NOZ.dir];
        // M ciągłe: czoło cofnęło się o (fb − nowe czoło)
        if (ring[1] > 0 && LS[LIN_STAN.cutFront] > 0) NZ[NOZ.C] += fb - SL[(ring[0] & MASK) * SLICE_STRIDE + PL.s];
        else {
          // pasmo skończyło się w szczelinie — droga wirtualna do tylnego zawrotu
          NZ[NOZ.st] = NOZ_ST.STOP;
          NZ[NOZ.uStop] = Math.floor(NZ[NOZ.u] - U_HOME) + 1 + U_HOME;
        }
        // (runda 9, styk zwijarki) zmiana programu na granicy cięcia; poza ARKUSZE (i po jednym obiegu) krzywka wraca do
        // tylnego zawrotu i parkuje
        if (CFG[3] !== CFG[2]) { CFG[2] = CFG[3]; if (onProgramChange) onProgramChange(CFG[2], NZ[NOZ.cuts]); }
        if ((CFG[2] !== PROGRAM.ARKUSZE || NZ[NOZ.one] > 0) && NZ[NOZ.st] === NOZ_ST.PRACA) {
          NZ[NOZ.one] = 0;
          NZ[NOZ.st] = NOZ_ST.STOP;
          NZ[NOZ.uStop] = Math.floor(NZ[NOZ.u] - U_HOME) + 1 + U_HOME;
        }
      }
      NZ[NOZ.nextCut] += P;
    }
    NZ[NOZ.tSep] += h;
    // --- metal szczeliny: po `kerfHold` s do rynny pod nożem, po `kerfOut` s dnem rynny do przetopu ---
    while (KR_[1] > 0) {
      const j = (KR_[0] & 31) * 2;
      if (time - KQ[j] < TW.kerfHold) break;
      L[LICZ.szczelina] -= KQ[j + 1];
      L[LICZ.rynna] += KQ[j + 1];
      if (RR[1] < 64) { const r = ((RR[0] + RR[1]) & 63) * 2; RQ[r] = time; RQ[r + 1] = KQ[j + 1]; RR[1]++; } else { L[LICZ.rynna] -= KQ[j + 1]; L[LICZ.przetop] += KQ[j + 1]; }
      KR_[0] = (KR_[0] + 1) & 31;
      KR_[1]--;
    }
    while (RR[1] > 0) {
      const r = (RR[0] & 63) * 2;
      if (time - RQ[r] < TW.kerfOut) break;
      L[LICZ.rynna] -= RQ[r + 1];
      L[LICZ.przetop] += RQ[r + 1];
      RR[0] = (RR[0] + 1) & 63;
      RR[1]--;
    }
    // --- CIAŁA: lot, chwyt, przechył, pierwsza podziałka (prawo ruchu `lot.js`), odpad w osi do przetopu ---
    const Mb = NZ[NOZ.Mb];
    const R = CHWYT.rise;
    let marching = 0;
    for (let i = 0; i < ARK_CAP; i++) { const o = i * ARK_N; if (B[o + ARK.st] === ARK_ST.LOT && B[o + ARK.mst] === MARSZ.PODZIALKA) marching++; }
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      const bst = B[o + ARK.st];
      if (bst === ARK_ST.WOLNY) continue;
      B[o + ARK.age] += h;
      const m = i * MV_N;
      const t = time - MVR[m + MV.t0];
      B[o + ARK.tS] = t;
      if (bst === ARK_ST.GRZEBIEN) {
        // hamowanie w x i przechył kończą się w kolejce grzebienia, jeśli trwają (przy rosnącym przepływie podziałka
        // sprzężona z drogą taśmy kończy się przed hamowaniem); zawias w z prowadzi grzebień — `stojak.js`
        motionX(t, MVR[m + MV.v0], FV[i], RB, MX);
        B[o + ARK.x] = MVR[m + MV.x0] + MX[0];
        B[o + ARK.vx] = MX[1];
        B[o + ARK.ax0] = MX[2];
        const tp = MVR[m + MV.tt0];
        if (tp >= 0 && t < tp + CHWYT.tilt.t) {
          motionLift(t, FV[i][2], MVR[m + MV.z0], tp, ML);
          B[o + ARK.th] = ML[6]; B[o + ARK.om] = ML[7]; B[o + ARK.al] = ML[8];
        } else { B[o + ARK.th] = HALF_PI; B[o + ARK.om] = 0; B[o + ARK.al] = 0; }
      }
      if (bst !== ARK_ST.LOT && bst !== ARK_ST.PRZETOP) continue;
      const F = FV[i];
      motionX(t, MVR[m + MV.v0], F, RB, MX);
      B[o + ARK.x] = MVR[m + MV.x0] + MX[0];
      B[o + ARK.vx] = MX[1];
      B[o + ARK.ax0] = MX[2];
      if (bst === ARK_ST.PRZETOP) {
        // odpad: wyrzut i lot w osi; czoło na końcu tunelu PRZETOP (cały kawałek już za ścianą, pod dachem tunelu) — konto
        // `przetop`, pęd wyniesiony
        B[o + ARK.dev] = MX[3] === 0 ? URZ.WYRZUT : URZ.BRAK;
        if (B[o + ARK.x] + B[o + ARK.len] >= PRZETOP.x1) {
          L[LICZ.przetopLot] -= B[o + ARK.units];
          L[LICZ.przetop] += B[o + ARK.units];
          PD[PED.ox] += MVR[m + MV.px]; PD[PED.oy] += MVR[m + MV.py]; PD[PED.oz] += MVR[m + MV.pz];
          MVR[m + MV.px] = 0; MVR[m + MV.py] = 0; MVR[m + MV.pz] = 0;
          B[o + ARK.st] = ARK_ST.WOLNY;
        }
        continue;
      }
      const tg = F[2];
      if (t >= tg) {
        // PRZECHYŁ rusza po uniesieniu, gdy poprzedni arkusz przeszedł już `ENTRY_U` podziałki (w rytmie — od razu; w
        // przejściu przepływu poczeka ułamek sekundy płasko nad pasmem)
        if (MVR[m + MV.tt0] < 0 && t >= tg + R.t && entryClear(i)) MVR[m + MV.tt0] = t;
        const tp = MVR[m + MV.tt0];
        motionLift(t, tg, MVR[m + MV.z0], tp, ML);
        MVR[m + MV.ly] = ML[0]; MVR[m + MV.lvy] = ML[1]; MVR[m + MV.lay] = ML[2];
        B[o + ARK.th] = ML[6]; B[o + ARK.om] = ML[7]; B[o + ARK.al] = ML[8];
        const mst = B[o + ARK.mst];
        if (mst === MARSZ.CZEKA) {
          B[o + ARK.z] = ML[3]; B[o + ARK.vz] = ML[4]; B[o + ARK.az0] = ML[5];
          // PIERWSZA PODZIAŁKA grzebienia rusza z początkiem przechyłu, gdy za wejściem jest miejsce
          if (tp >= 0 && t >= tp && rack.canMarch(marching)) { B[o + ARK.mst] = MARSZ.PODZIALKA; MVR[m + MV.mM0] = NZ[NOZ.Mc]; marching++; }
        }
        if (B[o + ARK.mst] === MARSZ.PODZIALKA) {
          const u = (NZ[NOZ.Mc] - MVR[m + MV.mM0]) / P;
          marchCam(u, MC_);
          const vmv = NZ[NOZ.vs];
          B[o + ARK.z] = CHWYT.zHinge - STOJAK.pitch * MC_[0];
          B[o + ARK.vz] = -STOJAK.pitch * MC_[1] * vmv / P;
          B[o + ARK.az0] = -STOJAK.pitch * (MC_[2] * vmv * vmv / (P * P) + MC_[1] * NZ[NOZ.dvs] / P);
          // koniec stałej prędkości podziałki: do kolejki W RUCHU, jeśli plan do celu jest (bez zatrzymania na końcu podziałki)
          if (u >= 1 - STOJAK.uRamp && u < 1 && rack.tryEnterMoving(i, time)) {
            move(i, ARK_ST.GRZEBIEN);
            B[o + ARK.mst] = MARSZ.KOLEJKA;
          } else if (u >= 1) {
            // podziałka przebyta: arkusz schodzi z wejścia do kolejki grzebienia (przechył, jeśli trwa, kończy się w drodze —
            // płyta pod kątem > 70° nie sięga już nad wejście; czekanie na pionie zostawiało go na drodze następnego)
            B[o + ARK.z] = CHWYT.zHinge - STOJAK.pitch;
            B[o + ARK.vz] = 0; B[o + ARK.az0] = 0;
            move(i, ARK_ST.GRZEBIEN);
            B[o + ARK.mst] = MARSZ.KOLEJKA;
            rack.enter(i, time);
          }
        }
        // urządzenie: listwa trzyma, hamuje i przechyla; grzebień — gdy płyta stoi już w x i na sztorc (podziałka)
        B[o + ARK.dev] = B[o + ARK.mst] === MARSZ.CZEKA || B[o + ARK.vx] !== 0 || B[o + ARK.th] < HALF_PI ? URZ.LISTWA : URZ.GRZEBIEN;
      } else {
        B[o + ARK.dev] = MX[3] === 0 ? URZ.WYRZUT : URZ.BRAK;
      }
      B[o + ARK.y] = PASS_Y + MVR[m + MV.ly];
      B[o + ARK.vy] = MVR[m + MV.lvy];
    }
    // --- STOJAK: kasety, kolejka grzebienia, sloty ---
    rack.step(time, h);
    // --- PĘD i SIŁY: środek masy każdego ciała, zmiana pędu → konstrukcja (reakcja urządzenia), |F| = m |a| ---
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      const bst = B[o + ARK.st];
      if (bst === ARK_ST.WOLNY) continue;
      const m = i * MV_N;
      const mt = B[o + ARK.units] / UT;
      const tk = 0.5 * (B[o + ARK.tB] + B[o + ARK.tF]);
      let vy = 0; let ay = 0;
      if (bst === ARK_ST.LOT) { vy = MVR[m + MV.lvy]; ay = MVR[m + MV.lay]; }
      if (bst === ARK_ST.GRZEBIEN) B[o + ARK.dev] = URZ.GRZEBIEN;
      else if (bst >= ARK_ST.KASETA && bst <= ARK_ST.WYJAZD) { B[o + ARK.th] = HALF_PI; B[o + ARK.om] = 0; B[o + ARK.al] = 0; B[o + ARK.dev] = URZ.KASETA; }
      plateCom(2 * MVR[m + MV.hw], tk, B[o + ARK.th], B[o + ARK.om], B[o + ARK.al], PC);
      const vzc = B[o + ARK.vz] + PC[2];
      const vyc = vy + PC[3];
      const vxc = B[o + ARK.vx];
      const axc = B[o + ARK.ax0];
      const azc = B[o + ARK.az0] + PC[4];
      const ayc = ay + PC[5];
      B[o + ARK.ax] = axc; B[o + ARK.ay] = ayc; B[o + ARK.az] = azc;
      MVR[m + MV.vzc] = vzc;
      const px = mt * vxc; const py = mt * vyc; const pz = mt * vzc;
      PD[PED.kx] -= px - MVR[m + MV.px]; PD[PED.ky] -= py - MVR[m + MV.py]; PD[PED.kz] -= pz - MVR[m + MV.pz];
      MVR[m + MV.px] = px; MVR[m + MV.py] = py; MVR[m + MV.pz] = pz;
      B[o + ARK.F] = mt * Math.sqrt(axc * axc + ayc * ayc + azc * azc);
    }
    for (let c = 0; c < KAS_CAP; c++) {
      const o = c * KAS_N;
      const KS = rack.KS;
      if (KS[o + KAS.st] === KAS_ST.WOLNA) continue;
      const px = KASETA.mass * KS[o + KAS.vx];
      const pz = KASETA.mass * KS[o + KAS.vz];
      PD[PED.kx] -= px - KS[o + KAS.px]; PD[PED.kz] -= pz - KS[o + KAS.pz];
      KS[o + KAS.px] = px; KS[o + KAS.pz] = pz;
    }
    // --- LISTWY (obraz: wędrujące pole pod chwyconą krawędzią, błysk wyrzutu) i grzebień ---
    for (let k = 0; k < LISTWA_N; k++) LW[k] = 0;
    let ns = 0;
    let Fg = 0;
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      const bst = B[o + ARK.st];
      if (bst !== ARK_ST.LOT && bst !== ARK_ST.PRZETOP) {
        if (bst === ARK_ST.GRZEBIEN) Fg += B[o + ARK.F];
        continue;
      }
      const dev = B[o + ARK.dev];
      if (dev === URZ.GRZEBIEN) Fg += B[o + ARK.F];
      // na listwie przechyłu: wyrzut, chwyt, przechył (zawias nad listwą — z ≥ −110)
      if ((dev === URZ.WYRZUT || dev === URZ.LISTWA || (dev === URZ.GRZEBIEN && B[o + ARK.z] > CHWYT.rail.z0)) && ns < 2) {
        const q = ns * 4;
        LW[q] = B[o + ARK.x]; LW[q + 1] = B[o + ARK.len];
        if (dev === URZ.WYRZUT) LW[q + 3] = B[o + ARK.F];
        else LW[q + 2] = B[o + ARK.F];
        ns++;
      }
    }
    LW[8] = Fg;
    // --- CIEPŁO ---
    for (let i = 0; i < ARK_CAP; i++) {
      const o = i * ARK_N;
      const bst = B[o + ARK.st];
      if (bst === ARK_ST.WOLNY) continue;
      const t = 0.5 * (B[o + ARK.tB] + B[o + ARK.tF]);
      const Lb = Math.max(1, B[o + ARK.len]);
      const Wb = Math.max(1, 0.5 * (B[o + ARK.wB] + B[o + ARK.wF]));
      const edge = 2 * (Lb + Wb) / (Lb * Wb);
      let fa = 1; let fb = 1;
      if (bst >= ARK_ST.KASETA && bst <= ARK_ST.WYJAZD) {
        // w kasecie: ściana zwrócona do sąsiada (slot k ± 1 zajęty) widzi halę tylko przez szczelinę
        const c = B[o + ARK.kas];
        const k = B[o + ARK.slot];
        if (c >= 0) {
          const KLr = rack.KL;
          if (k > 0 && KLr[c * KAS_LIST + k - 1] >= 0 && B[KLr[c * KAS_LIST + k - 1] * ARK_N + ARK.st] >= ARK_ST.KASETA) fa = SHIELD;
          if (k < KASETA.n - 1 && KLr[c * KAS_LIST + k + 1] >= 0 && B[KLr[c * KAS_LIST + k + 1] * ARK_N + ARK.st] >= ARK_ST.KASETA) fb = SHIELD;
        }
      }
      coolBody(o, edge + (fa + fb) / t, h);
    }
  }

  const api = {
    /** Połączenie z linią (`createFormingLine` woła przed rozbiegiem). */
    bind(ln) { line = ln; },
    step,
    get line() { return line; },
    /** Tryb odbioru: 'auto' / 'stop'. */
    setPickup(mode) { CFG[0] = mode === 'stop' ? 1 : 0; },
    /** Chwyt listwą włączony / wyłączony (A/B, awaria — wszystko do przetopu). */
    setGrab(on) { CFG[1] = on ? 1 : 0; },
    /** Odbiór ręczny kasety stojącej w punkcie odbioru (tryb 'stop'). */
    odbierz() { return rack.release(); },
    /**
     * (Styk zwijarki, etap 2) Program wyrobu (`PROGRAM`): zmiana na najbliższym cięciu (`onProgramChange(program, cięcie)`);
     * poza ARKUSZE krzywka po cięciu wraca do tylnego zawrotu i parkuje.
     */
    setProgram(p) { CFG[3] = p; },
    get program() { return CFG[2]; },
    set onProgramChange(fn) { onProgramChange = fn; },
    /**
     * (Styk zwijarki) Jeden obieg krzywki z zaparkowanego tylnego zawrotu: rozdzielenie na drodze taśmy `Mcut` (≥ obecna
     * droga + 0,316 P), po nim powrót do zawrotu. Zwraca false, gdy krzywka nie jest zaparkowana albo `Mcut` za blisko.
     */
    armOneCut(Mcut) {
      if (NZ[NOZ.st] !== NOZ_ST.SPOCZYNEK || line.stan[LIN_STAN.cutFront] === 0) return false;
      const Mon = Mcut - PERIOD_U * P;
      if (Mon < NZ[NOZ.M]) return false;
      NZ[NOZ.Mon] = Mon; NZ[NOZ.M1] = Mcut; NZ[NOZ.nextCut] = Mcut; NZ[NOZ.one] = 1;
      NZ[NOZ.st] = NOZ_ST.UZBROJONY;
      NZ[NOZ.headOk] = 1;
      return true;
    },
    /**
     * Bilans: wejscie − (lot + grzebien + kasety + odbior + wyjazd + odebrane + szczelina + rynna + przetopLot + przetop +
     * zwoj + kregi + odebraneKregi + kieszen) = 0; zgodność kont z ciałami i kasetami (`mismatch`), wejścia z `exited`
     * linii (`line`); pęd: |Σ ciał + ram + konstrukcja + wyniesiony − wniesiony| / Σ|wniesiony| (`ped`).
     */
    audit() {
      const sum = L[LICZ.lot] + L[LICZ.grzebien] + L[LICZ.kasety] + L[LICZ.odbior] + L[LICZ.wyjazd] + L[LICZ.odebrane] + L[LICZ.szczelina] +
        L[LICZ.rynna] + L[LICZ.przetopLot] + L[LICZ.przetop] + L[LICZ.zwoj] + L[LICZ.kregi] + L[LICZ.odebraneKregi] + L[LICZ.kieszen];
      const balance = L[LICZ.wejscie] - sum;
      let kq = 0;
      for (let k = 0; k < KR_[1]; k++) kq += KQ[((KR_[0] + k) & 31) * 2 + 1];
      let kr = 0;
      for (let k = 0; k < RR[1]; k++) kr += RQ[((RR[0] + k) & 63) * 2 + 1];
      let mismatch = Math.abs(stateSum(ARK_ST.LOT) - L[LICZ.lot]) + Math.abs(stateSum(ARK_ST.GRZEBIEN) - L[LICZ.grzebien]) +
        Math.abs(stateSum(ARK_ST.KASETA) - L[LICZ.kasety]) + Math.abs(stateSum(ARK_ST.ODBIOR) - L[LICZ.odbior]) +
        Math.abs(stateSum(ARK_ST.WYJAZD) - L[LICZ.wyjazd]) + Math.abs(stateSum(ARK_ST.PRZETOP) - L[LICZ.przetopLot]) +
        Math.abs(kq - L[LICZ.szczelina]) + Math.abs(kr - L[LICZ.rynna]);
      // masa kasety = suma arkuszy w jej slotach
      for (let c = 0; c < KAS_CAP; c++) {
        const o = c * KAS_N;
        if (rack.KS[o + KAS.st] < KAS_ST.ZALADUNEK) continue;
        let u = 0;
        for (let j = 0; j < KASETA.n; j++) { const i = rack.KL[c * KAS_LIST + j]; if (i >= 0 && B[i * ARK_N + ARK.st] >= ARK_ST.KASETA && B[i * ARK_N + ARK.st] <= ARK_ST.WYJAZD) u += B[i * ARK_N + ARK.units]; }
        mismatch += Math.abs(u - rack.KS[o + KAS.units]);
      }
      const lineIn = line ? L[LICZ.wejscie] - line.counters[LIN_LICZNIK.exited] : 0;
      // pęd
      let sx = PD[PED.kx] + PD[PED.ox]; let sy = PD[PED.ky] + PD[PED.oy]; let sz = PD[PED.kz] + PD[PED.oz];
      for (let i = 0; i < ARK_CAP; i++) { if (B[i * ARK_N + ARK.st] === ARK_ST.WOLNY) continue; const m = i * MV_N; sx += MVR[m + MV.px]; sy += MVR[m + MV.py]; sz += MVR[m + MV.pz]; }
      for (let c = 0; c < KAS_CAP; c++) { const o = c * KAS_N; if (rack.KS[o + KAS.st] === KAS_ST.WOLNA) continue; sx += rack.KS[o + KAS.px]; sz += rack.KS[o + KAS.pz]; }
      const ref = Math.max(1, Math.abs(PD[PED.wx]) + Math.abs(PD[PED.wy]) + Math.abs(PD[PED.wz]));
      const ped = (Math.abs(sx - PD[PED.wx]) + Math.abs(sy - PD[PED.wy]) + Math.abs(sz - PD[PED.wz])) / ref;
      return { balance, mismatch, line: lineIn, ped };
    },
    /** Hasz stanu (powtarzalność z ziarna). */
    hash() {
      let hh = 0x811C9DC5 | 0;
      const mix = (v) => { hh = Math.imul(hh ^ (Math.round(v * 1e4) | 0), 0x01000193); hh = Math.imul(hh ^ (hh >>> 13), 0x5BD1E995); };
      for (let k = 0; k < NOZ_N; k++) mix(NZ[k]);
      for (let k = 0; k < LICZ_N; k++) mix(L[k]);
      for (let k = 0; k < KAS_CAP * KAS_N; k++) mix(rack.KS[k]);
      for (let i = 0; i < ARK_CAP * ARK_N; i++) if (B[i] !== 0) mix(B[i] + i);
      mix(rs[0]);
      return (hh >>> 0).toString(16);
    },
    /** Iskry szczeliny do wypuszczenia (strona woła po kroku linii): liczba całkowita, zeruje licznik. */
    takeSparks() {
      const k = Math.floor(NZ[NOZ.sparkDue]);
      NZ[NOZ.sparkDue] -= k;
      L[LICZ.iskry] += k;
      return k;
    },
    /** Liczby wyrobu zmierzone w modelu. */
    product() {
      const t = (u) => u / UT;
      return {
        arkusz: { dlugosc: NZ[NOZ.lastLen], masaT: t(NZ[NOZ.lastUnits]), rytmS: NZ[NOZ.prevCutT] >= 0 ? NZ[NOZ.tCut] - NZ[NOZ.prevCutT] : null },
        kaseta: { arkuszy: lastCas[0], masaT: t(lastCas[1]), Todbior: lastCas[2], Twyjazd: lastCas[3], odZaladunku: lastCas[4], id: lastCas[5], czas: lastCas[6] },
        ciecia: L[LICZ.ciecia], dobre: L[LICZ.dobre], kaset: L[LICZ.kaset]
      };
    },
    /** Konta w tonach. */
    tons() {
      const t = (u) => u / UT;
      return {
        wejscie: t(L[LICZ.wejscie]), lot: t(L[LICZ.lot]), grzebien: t(L[LICZ.grzebien]), kasety: t(L[LICZ.kasety]), odbior: t(L[LICZ.odbior]),
        wyjazd: t(L[LICZ.wyjazd]), odebrane: t(L[LICZ.odebrane]), szczelina: t(L[LICZ.szczelina]), rynna: t(L[LICZ.rynna]),
        przetopLot: t(L[LICZ.przetopLot]), przetop: t(L[LICZ.przetop])
      };
    },
    /** Czas modelu [s]. */
    get time() { return TT[0]; },
    rack,
    view: { bodies: B, mov: MVR, plan: CV, flight: FV, noz: NZ, licz: L, ped: PD, listwa: LW, kas: rack.KS, kasList: rack.KL, kolejka: rack.Q, kolejkaN: rack.QN, cfg: CFG, lastCas }
  };
  return api;
}
