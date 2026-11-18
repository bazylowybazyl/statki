// HUTA — element 4 (dzielenie, runda 9): STOJAK — GRZEBIEŃ POLA I KASETY (czysty JS, bez alokacji w kroku).
//
// Projekt: `.tmp/huta/formowanie/PROJEKT-chwyt-zwijanie.md` § 3. Arkusz postawiony na sztorc schodzi z listwy przechyłu
// pierwszą podziałką grzebienia (sprzęgniętą z drogą taśmy — `model.js`), potem `enter` wpisuje go do KOLEJKI grzebienia:
// cel = kolejny wolny slot kasety w załadunku albo miejsce w buforze za poprzednim (kolejność cięć zachowana, nikt nikogo
// nie wyprzedza); ruch do celu pięciomianowy z ograniczeniami v ≤ 100 j./s, a ≤ 200 j./s², bez cofania; nowy cel (kaseta
// wjechała, kolejka ruszyła) — nowy plan ze stanu (z, v, a), więc przebieg ciągły z przyspieszeniem. W slocie pole kasety
// przejmuje arkusz bez ruchu (prędkość 0).
// KASETA (pula `KAS_CAP`): DOWÓZ pustej zza krawędzi pokładu → BUFOR pustej → WJAZD do załadunku (gdy pełna zjechała o
// `release`) → ZAŁADUNEK (8 slotów od dalekiego) → ODJAZD do odbioru (pokrywa pola zamyka się) → ODBIÓR (postój `pick` s
// albo do `release()` w trybie 'stop') → WYJAZD przez bramę → konto `odebrane`. Ruchy S5 z masą ramy i ładunku; reakcja
// napędu — konto pędu konstrukcji (`model.js`).
import { CHWYT, KASETA, PASS_Y, S5, S5d, S5dd, STOJAK, slotZ } from './geometria.js';
import { evalQuintic, planQuintic, planQuinticT } from './lot.js';

/** Rekord kasety (`view.kas`, krok `KAS_N`). */
export const KAS = Object.freeze({
  st: 0, dx: 1, dz: 2, vx: 3, vz: 4, ax: 5, az: 6, t: 7, k: 8, asg: 9, lid: 10, units: 11, id: 12, Tpick: 13, Tout: 14,
  tBorn: 15, px: 16, pz: 17, F: 18, dx0: 19, dz0: 20, Fd: 21, tFull: 22, field: 23
});
export const KAS_N = 24;
const HALF_PI = Math.PI / 2;
/** Czas oczekiwania arkusza w grzebieniu przed ponowną próbą planu (poprzednik za blisko) [s]. */
const WAIT = 0.1;
export const KAS_CAP = 6;
export const KAS_ST = Object.freeze({ WOLNA: 0, DOWOZ: 1, BUFOR: 2, WJAZD: 3, ZALADUNEK: 4, ODJAZD: 5, ODBIOR: 6, WYJAZD: 7 });
export const KAS_ST_NAMES = Object.freeze(['wolna', 'dowóz', 'bufor', 'wjazd', 'załadunek', 'odjazd', 'odbiór', 'wyjazd']);
/** Miejsc na liście arkuszy kasety. */
export const KAS_LIST = 12;
/** Długość kolejki grzebienia. */
export const Q_CAP = 24;

/**
 * Stojak. `ctx`: B (rekordy ciał), MV (rekordy ruchu), CV (widoki planów pięciomianowych per ciało), A (indeksy pól —
 * `{ ARK, ARK_N, MV, MV_N, ST }`), `units(i)`, `move(i, stan)` — zmiana stanu ciała i konta masy, `gone(i)` — kaseta
 * wyjechała z arkuszem i (konto `odebrane`, pęd wyniesiony), `cfg` — [0] odbiór 'stop'.
 */
export function createRack(ctx) {
  const { B, MV, CV, A } = ctx;
  const { ARK, ARK_N, M, MV_N, ST } = A;
  const KS = new Float64Array(KAS_CAP * KAS_N);
  const KL = new Int32Array(KAS_CAP * KAS_LIST).fill(-1);
  const Q = new Int32Array(Q_CAP).fill(-1);
  const QN = new Int32Array(4);              // [0] długość kolejki, [1] seq kasety, [2] przepełnienia (zdarzenia), [3] —
  const REL = new Int32Array(1);
  const QE = new Float64Array(4);
  const SK = new Float64Array(3);
  const CT = new Float64Array(7);

  function place(c, st, dx, dz) {
    const o = c * KAS_N;
    for (let k = 0; k < KAS_N; k++) KS[o + k] = 0;
    for (let j = 0; j < KAS_LIST; j++) KL[c * KAS_LIST + j] = -1;
    KS[o + KAS.st] = st; KS[o + KAS.dx] = dx; KS[o + KAS.dz] = dz; KS[o + KAS.dx0] = dx; KS[o + KAS.dz0] = dz;
    KS[o + KAS.id] = ++QN[1];
  }
  // start: kaseta w załadunku i pusta w buforze
  place(0, KAS_ST.ZALADUNEK, 0, 0);
  place(1, KAS_ST.BUFOR, -KASETA.in.dx, 0);

  const findSt = (st) => { for (let c = 0; c < KAS_CAP; c++) if (KS[c * KAS_N + KAS.st] === st) return c; return -1; };
  const loading = () => findSt(KAS_ST.ZALADUNEK);
  /** Wolnych slotów w kasecie w załadunku. */
  function freeSlots() { const c = loading(); return c < 0 ? 0 : KASETA.n - KS[c * KAS_N + KAS.asg]; }
  /** Arkusze w kolejce z celem w buforze. */
  function bufTargeted() {
    let n = 0;
    for (let j = 0; j < QN[0]; j++) if (B[Q[j] * ARK_N + ARK.kas] < 0) n++;
    return n;
  }

  /** Ruch S5 osi kasety: z wartości `a0` o `d` w czasie T, chwila t → SK = [pozycja, v, a]. */
  function s5(a0, d, t, T) {
    const u = t / T;
    SK[0] = a0 + d * S5(u); SK[1] = d * S5d(u) / T; SK[2] = d * S5dd(u) / (T * T);
  }

  /**
   * Nowy plan dosuwu ciała i do z `zt` ze stanu (z, v, a) — ciągły w położeniu, prędkości i przyspieszeniu. Gdy z tego
   * stanu nie ma planu bez cofania (ciało hamuje przed poprzednim celem), cel czeka (`pend`): ciało dojeżdża starym planem
   * do spoczynku i stamtąd rusza do nowego celu.
   */
  function replan(i, zt, time, lead = -1) {
    const o = i * ARK_N;
    const m = i * MV_N;
    MV[m + M.zt] = zt;
    const fresh = MV[m + M.tp0] < 0;
    const z0 = B[o + ARK.z];
    const v0 = fresh ? 0 : B[o + ARK.vz];
    const a0 = fresh ? 0 : B[o + ARK.az0];
    let ok = planQuintic(z0, v0, a0, zt, STOJAK.vMax, STOJAK.aMax, CT);
    // za poprzednim w kolejce: plan nie podchodzi bliżej niż podziałka — najwyżej ok. 1,85 × dłuższy (wolniej); gdy i to
    // nie wystarcza, poprzednik jest jeszcze za blisko: arkusz czeka (stoi albo kończy stary plan) i próbuje ponownie
    if (ok && lead >= 0 && MV[lead * MV_N + M.tp0] >= 0) {
      let T = CT[6];
      let it = 0;
      while (!clearOfLead(time, lead)) {
        if (++it > 8) { ok = false; break; }
        T *= 1.08;
        ok = planQuinticT(z0, v0, a0, zt, T, STOJAK.vMax, STOJAK.aMax, CT);
        if (!ok) break;
      }
    }
    const C = CV[i];
    if (ok) {
      for (let k = 0; k < 7; k++) C[k] = CT[k];
      MV[m + M.tp0] = time;
      MV[m + M.pend] = 0;
    } else if (fresh) {
      // ze spoczynku: stoi `WAIT` s i próbuje ponownie
      C[0] = z0; C[1] = 0; C[2] = 0; C[3] = 0; C[4] = 0; C[5] = 0; C[6] = WAIT;
      MV[m + M.tp0] = time;
      MV[m + M.pend] = 1;
    } else MV[m + M.pend] = 1;
  }
  /** Plan `CT` (od chwili `time`) trzyma się co najmniej podziałkę za planem poprzednika `lead`. */
  function clearOfLead(time, lead) {
    const Cl = CV[lead];
    const tl = MV[lead * MV_N + M.tp0];
    const Tm = Math.max(CT[6], Cl[6] - (time - tl), 0);
    for (let k = 0; k <= 96; k++) {
      const tau = Tm * k / 96;
      evalQuintic(CT, tau, QE);
      const zf = QE[0];
      evalQuintic(Cl, time + tau - tl, QE);
      if (zf - QE[0] < STOJAK.pitch - 1e-6) return false;
    }
    return true;
  }

  /** Cele kolejki: kolejne sloty kasety w załadunku, reszta — bufor za poprzednim (od `zBuf0` ku wejściu). */
  function assign(time) {
    const c = loading();
    let nb = 0;
    for (let j = 0; j < QN[0]; j++) {
      const i = Q[j];
      const o = i * ARK_N;
      if (B[o + ARK.kas] >= 0) continue;
      let zt;
      if (c >= 0 && KS[c * KAS_N + KAS.asg] < KASETA.n) {
        const k = KS[c * KAS_N + KAS.asg]++;
        B[o + ARK.kas] = c;
        B[o + ARK.slot] = k;
        KL[c * KAS_LIST + k] = i;
        zt = slotZ(k) + KS[c * KAS_N + KAS.dz];
      } else {
        zt = STOJAK.zBuf0 + STOJAK.pitch * nb;
        nb++;
      }
      if (Math.abs(zt - MV[i * MV_N + M.zt]) > 1e-9 || MV[i * MV_N + M.tp0] < 0) replan(i, zt, time, j > 0 ? Q[j - 1] : -1);
    }
  }

  const api = {
    KS, KL, Q, QN,
    freeSlots, bufTargeted, loading,
    /**
     * Czy listwa może złapać nowy arkusz: kolejka grzebienia ma miejsce na rekord (przepełnienie w sensie fizycznym — wejście
     * zajęte przez arkusz, który nie mógł zejść podziałką — rozstrzyga `model.js`, § 2.7 projektu).
     */
    canGrab(pending) { return QN[0] + pending + 1 <= Q_CAP; },
    /** Czy arkusz z wejścia może ruszyć pierwszą podziałką (miejsce w buforze dla niego). */
    canMarch(marching) { return bufTargeted() + marching < STOJAK.buf + freeSlots(); },
    /**
     * Arkusz i w pierwszej podziałce, na końcu jej stałej prędkości: jeśli z obecnego stanu (z, v, a) jest plan do jego celu
     * bez cofania i bez podchodzenia do poprzednika, wchodzi do kolejki W RUCHU (bez zatrzymania na końcu podziałki).
     */
    tryEnterMoving(i, time) {
      if (QN[0] >= Q_CAP) return false;
      const o = i * ARK_N;
      const m = i * MV_N;
      const c = loading();
      const zt = c >= 0 && KS[c * KAS_N + KAS.asg] < KASETA.n ? slotZ(KS[c * KAS_N + KAS.asg]) + KS[c * KAS_N + KAS.dz] : STOJAK.zBuf0 + STOJAK.pitch * bufTargeted();
      if (!planQuintic(B[o + ARK.z], B[o + ARK.vz], B[o + ARK.az0], zt, STOJAK.vMax, STOJAK.aMax, CT)) return false;
      const lead = QN[0] > 0 ? Q[QN[0] - 1] : -1;
      if (lead >= 0 && MV[lead * MV_N + M.tp0] >= 0 && !clearOfLead(time, lead)) return false;
      const C = CV[i];
      for (let k = 0; k < 7; k++) C[k] = CT[k];
      MV[m + M.tp0] = time;
      MV[m + M.zt] = zt;
      MV[m + M.pend] = 0;
      Q[QN[0]++] = i;
      B[o + ARK.kas] = -1;
      B[o + ARK.slot] = -1;
      assign(time);
      return true;
    },
    /** Arkusz i zszedł z wejścia (podziałka za nim): do kolejki grzebienia, cel i plan ze spoczynku. */
    enter(i, time) {
      if (QN[0] >= Q_CAP) return false;
      Q[QN[0]++] = i;
      const o = i * ARK_N;
      B[o + ARK.kas] = -1;
      B[o + ARK.slot] = -1;
      MV[i * MV_N + M.tp0] = -1;
      MV[i * MV_N + M.zt] = 1e9;
      assign(time);
      return true;
    },
    release() {
      const c = findSt(KAS_ST.ODBIOR);
      if (c < 0) return false;
      REL[0] = 1;
      return true;
    },
    /** Krok: kasety (automat stanów, ruchy S5), cele kolejki, dosuw grzebienia, lądowanie w slotach, arkusze w kasetach. */
    step(time, h) {
      const stop = ctx.cfg[0] > 0;
      // --- kasety ---
      let blockRelease = false;
      for (let c = 0; c < KAS_CAP; c++) {
        const o = c * KAS_N;
        const st = KS[o + KAS.st];
        if (st === KAS_ST.ODJAZD && KS[o + KAS.dz] > -KASETA.release) blockRelease = true;
      }
      const busyLoad = findSt(KAS_ST.WJAZD) >= 0 || findSt(KAS_ST.ZALADUNEK) >= 0;
      // miejsce odbioru zajęte: kaseta w odjeździe albo w odbiorze, albo wyjeżdżająca jeszcze nie odjechała w +x o tyle, żeby
      // następna, zjeżdżając w −z, minęła ją (wyjazd S5 790 j. w 5 s, odjazd 270 j. w 2,6 s — test „kasety nie zachodzą”)
      let busyPick = findSt(KAS_ST.ODJAZD) >= 0 || findSt(KAS_ST.ODBIOR) >= 0;
      for (let c = 0; c < KAS_CAP; c++) if (KS[c * KAS_N + KAS.st] === KAS_ST.WYJAZD && KS[c * KAS_N + KAS.dx] < KASETA.exitClear) busyPick = true;
      for (let c = 0; c < KAS_CAP; c++) {
        const o = c * KAS_N;
        const st = KS[o + KAS.st];
        if (st === KAS_ST.WOLNA) continue;
        KS[o + KAS.t] += h;
        const t = KS[o + KAS.t];
        let vx = 0; let vz = 0; let ax = 0; let az = 0;
        if (st === KAS_ST.DOWOZ) {
          s5(KS[o + KAS.dz0], KASETA.supply.dz, t, KASETA.supply.t);
          KS[o + KAS.dz] = SK[0]; vz = SK[1]; az = SK[2];
          if (t >= KASETA.supply.t) { KS[o + KAS.dz] = 0; vz = 0; az = 0; KS[o + KAS.st] = KAS_ST.BUFOR; KS[o + KAS.t] = 0; }
        } else if (st === KAS_ST.BUFOR) {
          if (!busyLoad && !blockRelease) { KS[o + KAS.st] = KAS_ST.WJAZD; KS[o + KAS.t] = 0; KS[o + KAS.dx0] = KS[o + KAS.dx]; }
        } else if (st === KAS_ST.WJAZD) {
          s5(KS[o + KAS.dx0], KASETA.in.dx, t, KASETA.in.t);
          KS[o + KAS.dx] = SK[0]; vx = SK[1]; ax = SK[2];
          if (t >= KASETA.in.t) { KS[o + KAS.dx] = 0; vx = 0; ax = 0; KS[o + KAS.st] = KAS_ST.ZALADUNEK; KS[o + KAS.t] = 0; KS[o + KAS.asg] = 0; KS[o + KAS.k] = 0; }
        } else if (st === KAS_ST.ZALADUNEK) {
          if (KS[o + KAS.k] >= KASETA.n && !busyPick) {
            KS[o + KAS.st] = KAS_ST.ODJAZD; KS[o + KAS.t] = 0; KS[o + KAS.dz0] = KS[o + KAS.dz]; KS[o + KAS.tFull] = time;
            for (let j = 0; j < KASETA.n; j++) { const i = KL[c * KAS_LIST + j]; if (i >= 0) ctx.move(i, ST.ODBIOR); }
          }
        } else if (st === KAS_ST.ODJAZD) {
          s5(KS[o + KAS.dz0], KASETA.out.dz, t, KASETA.out.t);
          KS[o + KAS.dz] = SK[0]; vz = SK[1]; az = SK[2];
          if (t >= KASETA.out.t) {
            KS[o + KAS.dz] = KASETA.out.dz; vz = 0; az = 0; KS[o + KAS.st] = KAS_ST.ODBIOR; KS[o + KAS.t] = 0;
            KS[o + KAS.Tpick] = ctx.avgT(c);
          }
        } else if (st === KAS_ST.ODBIOR) {
          if ((!stop && t >= KASETA.pick) || REL[0] > 0) {
            REL[0] = 0;
            KS[o + KAS.st] = KAS_ST.WYJAZD; KS[o + KAS.t] = 0; KS[o + KAS.dx0] = KS[o + KAS.dx];
            for (let j = 0; j < KASETA.n; j++) { const i = KL[c * KAS_LIST + j]; if (i >= 0) ctx.move(i, ST.WYJAZD); }
          }
        } else if (st === KAS_ST.WYJAZD) {
          s5(KS[o + KAS.dx0], KASETA.exit.dx, t, KASETA.exit.t);
          KS[o + KAS.dx] = SK[0]; vx = SK[1]; ax = SK[2];
          if (t >= KASETA.exit.t) {
            KS[o + KAS.Tout] = ctx.avgT(c);
            ctx.lastCassette(c);
            for (let j = 0; j < KASETA.n; j++) { const i = KL[c * KAS_LIST + j]; if (i >= 0) ctx.gone(i); }
            ctx.frameGone(c);
            KS[o + KAS.st] = KAS_ST.WOLNA;
            continue;
          }
        }
        // pokrywa pola: zamyka się na początku odjazdu, zostaje zamknięta do wyjazdu
        const st2 = KS[o + KAS.st];
        KS[o + KAS.lid] = st2 === KAS_ST.ODJAZD ? S5(KS[o + KAS.t] / KASETA.lid) : st2 === KAS_ST.ODBIOR || st2 === KAS_ST.WYJAZD ? 1 : 0;
        KS[o + KAS.vx] = vx; KS[o + KAS.vz] = vz; KS[o + KAS.ax] = ax; KS[o + KAS.az] = az;
      }
      // dowóz pustej, gdy żadna nie czeka
      if (findSt(KAS_ST.DOWOZ) < 0 && findSt(KAS_ST.BUFOR) < 0) {
        const c = findSt(KAS_ST.WOLNA);
        if (c >= 0) { place(c, KAS_ST.DOWOZ, -KASETA.in.dx, -KASETA.supply.dz); KS[c * KAS_N + KAS.tBorn] = time; }
      }
      // --- kolejka grzebienia: stan w chwili `time` (plan bieżący), cele (nowy plan ze stanu w tej samej chwili), dosuw ---
      for (let j = 0; j < QN[0]; j++) {
        const i = Q[j];
        const o = i * ARK_N;
        const m = i * MV_N;
        if (MV[m + M.tp0] < 0) continue;
        evalQuintic(CV[i], time - MV[m + M.tp0], QE);
        B[o + ARK.z] = QE[0]; B[o + ARK.vz] = QE[1]; B[o + ARK.az0] = QE[2];
        // cel czekający (plan ciągły niemożliwy): stary plan skończony — nowy ze spoczynku
        if (MV[m + M.pend] > 0 && time - MV[m + M.tp0] >= CV[i][6]) { MV[m + M.tp0] = -1; replan(i, MV[m + M.zt], time, j > 0 ? Q[j - 1] : -1); }
      }
      assign(time);
      let w = 0;
      for (let j = 0; j < QN[0]; j++) {
        const i = Q[j];
        const o = i * ARK_N;
        const m = i * MV_N;
        const c = B[o + ARK.kas];
        const done = time - MV[m + M.tp0] >= CV[i][6] && MV[m + M.pend] === 0;
        // (lądowanie dopiero na sztorc i w spoczynku w x — przechył i hamowanie skończone)
        if (c >= 0 && done && B[o + ARK.th] >= HALF_PI - 1e-9 && B[o + ARK.vx] === 0 && KS[c * KAS_N + KAS.st] === KAS_ST.ZALADUNEK) {
          // LĄDOWANIE w slocie: pole kasety przejmuje arkusz (bez ruchu)
          B[o + ARK.z] = MV[m + M.zt];
          B[o + ARK.vz] = 0; B[o + ARK.az0] = 0;
          KS[c * KAS_N + KAS.k]++;
          KS[c * KAS_N + KAS.units] += ctx.units(i);
          ctx.move(i, ST.KASETA);
          continue;
        }
        Q[w++] = i;
      }
      for (let j = w; j < QN[0]; j++) Q[j] = -1;
      QN[0] = w;
      // --- arkusze w kasetach jadą z kasetą ---
      for (let c = 0; c < KAS_CAP; c++) {
        const o = c * KAS_N;
        const st = KS[o + KAS.st];
        if (st < KAS_ST.ZALADUNEK) continue;
        let Fsum = 0;
        for (let j = 0; j < KASETA.n; j++) {
          const i = KL[c * KAS_LIST + j];
          if (i < 0) continue;
          const b = i * ARK_N;
          if (B[b + ARK.st] !== ST.KASETA && B[b + ARK.st] !== ST.ODBIOR && B[b + ARK.st] !== ST.WYJAZD) continue;
          B[b + ARK.x] = CHWYT.xStop + KS[o + KAS.dx];
          B[b + ARK.z] = slotZ(B[b + ARK.slot]) + KS[o + KAS.dz];
          B[b + ARK.vx] = KS[o + KAS.vx]; B[b + ARK.vz] = KS[o + KAS.vz];
          B[b + ARK.ax0] = KS[o + KAS.ax]; B[b + ARK.az0] = KS[o + KAS.az];
          B[b + ARK.y] = PASS_Y + CHWYT.rise.h;
          Fsum += ctx.units(i);
        }
        // pole slotów: czuwa w załadunku, trzyma ładunek w ruchu (siła napędu kasety z masą)
        const mt = KASETA.mass + Fsum / ctx.UT;
        KS[o + KAS.Fd] = mt * Math.sqrt(KS[o + KAS.ax] * KS[o + KAS.ax] + KS[o + KAS.az] * KS[o + KAS.az]);
        KS[o + KAS.field] = st === KAS_ST.ZALADUNEK ? 0.12 + 0.05 * KS[o + KAS.k] : 0.3 + KS[o + KAS.Fd] / 4000;
      }
    }
  };
  return api;
}
