// src/game/shipSystem.js
//
// Stan systemu okrętu pod F (definicje: src/data/shipSystems.js) — czysta logika (bez DOM i three), wspólna dla
// gracza (index.html, blok „SYSTEM OKRĘTU (F)”) i NPC (src/ai/npcShipSystem.js). Fizykę nakłada klej gry.
//
// Rodzaje „zrywowe” — ram_burn (szarża), engine_burst (zryw silników), rapid_fire (szybki ogień) — mają stan
// szarży z ramBurn.js: ładunek 0..1, start tylko z pełnego, przez `duration` aktywny (ładunek schodzi do zera),
// potem odbudowa od zera przez `recharge`. Przerwanie nie zwraca zużytego ładunku.
//
// Manewr (maneuver) ma ładunki (`charges`, odnawiane po kolei co `recharge` s) i najwyżej jedną akcję w toku:
//   SKOK (jump) — prędkość boczna wzdłuż kierunku ustalonego przy starcie = bazowa + profil u(t): wybicie
//     (ćwiartka sinusa) przez jumpKick · T, potem łagodne wyhamowanie (połówka cosinusa); całka profilu =
//     przesunięcie D. Zmiana prędkości bocznej spoza skoku (zderzenie, impuls) zrywa skok.
//   OBRÓT (turn) — kąt pozostały w kierunku obrotu liczony bez zawijania (ruch celu dodaje, obrót okrętu
//     odejmuje; obrót „w tę stronę” może mieć prawie 360°), blisko celu — błąd wprost. Prędkość kątowa z profilu
//     hamowania √(2 · α · e) z sufitem turnRate, końcówka liniowa.
//
// Stan jest jednym obiektem o stałym kształcie (zero alokacji w krokach).

import { canStartRamBurn, startRamBurn, stopRamBurn, stepRamBurn, RAM_BURN_END, RAM_BURN_READY } from './flight/ramBurn.js';

export const SYS_END = RAM_BURN_END;        // zryw / ogień właśnie się skończył
export const SYS_READY = RAM_BURN_READY;    // system znów gotowy (zryw: pełny ładunek; manewr: wszystkie ładunki)
export const SYS_CHARGE = 'charge';         // manewr: odnowiony jeden ładunek (jeszcze nie wszystkie)

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
// Obrót: poniżej tego kąta pozostałego — błąd wprost (domknięcie, także gdy cel przeskoczył przez dziób).
const TURN_SETTLE_ZONE = 30 * DEG;
// Obrót skończony: błąd i prędkość kątowa poniżej (prędkość — wielokrotność α · dt).
const TURN_DONE_TOL = 0.6 * DEG;
// Końcówka obrotu: prędkość kątowa ≤ błąd × wzmocnienie (bez drgań profilu √ przy zerze).
const TURN_END_GAIN = 6;
// Profil hamowania obrotu planujemy z zapasem (reszta pokrywa krok dyskretny).
const TURN_BRAKE_MARGIN = 0.9;
// Tempo zmiany kursu docelowego (cel się rusza) — wygładzone tą stałą czasową [s]; obrót je wyprzedza.
const TURN_AIM_RATE_TAU = 0.12;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

export function wrapSysAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function createShipSystemState() {
  return {
    def: null,
    // zryw / ogień / szarża (pola ramBurn.js)
    charge: 1,
    active: false,
    t: 0,
    serial: 0,
    // manewr
    charges: 0,
    regen: 0,
    action: '',
    actT: 0,
    jumpDirX: 0,
    jumpDirY: 0,
    jumpDist: 0,
    jumpTime: 0,
    jumpKick: 0,
    jumpPeak: 0,
    jumpBase: 0,
    jumpLast: 0,
    jumpAborted: false,
    turnDir: 0,
    turnLeft: 0,
    turnAim: 0,
    turnAimRate: 0,
    turnAngle: 0,
    turnOmega: 0,
    turnOffset: 0,
    turnTarget: null,
    // AI: jak długo trwa warunek użycia [s]
    want: 0,
    uses: 0
  };
}

export function isBurstSystem(def) {
  const id = def ? def.id : '';
  return id === 'ram_burn' || id === 'engine_burst' || id === 'rapid_fire';
}

/** Wiąże stan z definicją; nowa definicja (zmiana kadłuba / wyboru) = system pełny i bezczynny. */
export function bindShipSystem(st, def) {
  if (!st || st.def === def) return false;
  st.def = def || null;
  st.charge = 1;
  st.active = false;
  st.t = 0;
  st.charges = def && def.id === 'maneuver' ? Math.max(0, def.charges | 0) : 0;
  st.regen = 0;
  st.action = '';
  st.actT = 0;
  st.turnTarget = null;
  st.want = 0;
  return true;
}

/** Czy system można teraz włączyć (zryw: pełny ładunek; manewr: ładunek i brak akcji w toku). */
export function shipSystemReady(st, def) {
  if (!st || !def) return false;
  if (def.id === 'maneuver') return st.charges >= 1 && !st.action;
  return canStartRamBurn(st, def);
}

/** Start rodzaju zrywowego (szarża, zryw silników, szybki ogień). */
export function startShipSystemBurst(st, def) {
  if (!isBurstSystem(def)) return false;
  if (!startRamBurn(st, def)) return false;
  st.uses++;
  return true;
}

/** Przerwanie (skok, zniszczenie, hamulec szarży): zryw kończy się bez zwrotu ładunku, akcja manewru gaśnie. */
export function stopShipSystem(st) {
  if (!st) return false;
  const burst = stopRamBurn(st);
  const action = !!st.action;
  st.action = '';
  st.turnTarget = null;
  return burst || action;
}

/** Czy system pracuje (zryw aktywny albo akcja manewru w toku). */
export function shipSystemActive(st) {
  return !!st && (st.active || !!st.action);
}

/**
 * Krok ładunków (akcje manewru kroczy klej fizyki: stepManeuverJump / stepManeuverTurn). Zwraca SYS_END,
 * SYS_READY, SYS_CHARGE albo ''.
 */
export function stepShipSystem(st, def, dt) {
  if (!st || !def || !(dt > 0)) return '';
  if (def.id !== 'maneuver') return stepRamBurn(st, def, dt);
  const max = Math.max(0, def.charges | 0);
  if (st.charges >= max) {
    st.regen = 0;
    return '';
  }
  st.regen += dt / Math.max(0.1, Number(def.recharge) || 1);
  if (st.regen < 1) return '';
  st.charges++;
  st.regen = st.charges < max ? st.regen - 1 : 0;
  return st.charges >= max ? SYS_READY : SYS_CHARGE;
}

/** Mnożnik szybkostrzelności dział (szybki ogień aktywny) albo 1. */
export function shipSystemFireRateMul(st, def) {
  return def && def.id === 'rapid_fire' && st && st.active ? Math.max(1, Number(def.fireRateMul) || 1) : 1;
}

/** Struga MAIN jak przy dopalaczu: szarża albo zryw silników w toku. */
export function shipSystemMainBoost(st, def) {
  return !!def && !!st && st.active && (def.id === 'ram_burn' || def.id === 'engine_burst');
}

/** Ułamek do paska HUD: zryw — ładunek (w trakcie zrywu — co zostało), manewr — odnowa następnego ładunku. */
export function shipSystemGauge(st, def) {
  if (!st || !def) return 0;
  if (def.id !== 'maneuver') return clamp(st.charge, 0, 1);
  const max = Math.max(1, def.charges | 0);
  return st.charges >= max ? 1 : clamp(st.regen, 0, 1);
}

// ---------------------------------------------------------------- manewr: skok

/** Szczyt prędkości profilu skoku na przesunięcie `dist` w czasie `time` z wybiciem `kick` · time. */
export function maneuverJumpPeak(dist, time, kick) {
  const T = Math.max(0.05, Number(time) || 0);
  const k = clamp(Number(kick) || 0.3, 0.05, 0.95);
  return Math.max(0, Number(dist) || 0) / (T * (k * 2 / Math.PI + (1 - k) * 0.5));
}

/** Prędkość profilu skoku w chwili t (0 poza [0, time)). */
export function maneuverJumpSpeed(t, time, kick, peak) {
  if (!(t > 0) || !(t < time)) return 0;
  const tk = time * kick;
  if (t < tk) return peak * Math.sin(0.5 * Math.PI * t / tk);
  return peak * 0.5 * (1 + Math.cos(Math.PI * (t - tk) / (time - tk)));
}

/** Faza skoku dla obrazu dysz: 1 — wybicie, -1 — hamowanie, 0 — bez skoku. */
export function maneuverJumpPhase(st) {
  if (!st || st.action !== 'jump') return 0;
  return st.actT < st.jumpTime * st.jumpKick ? 1 : -1;
}

/**
 * Start skoku w kierunku (dirX, dirY) — świat gry, bok okrętu. `hullLength` — długość kadłuba [j.],
 * `baseLateral` — prędkość okrętu wzdłuż kierunku skoku w chwili startu (zostaje po skoku).
 */
export function startManeuverJump(st, def, dirX, dirY, hullLength, baseLateral = 0) {
  if (!st || !def || def.id !== 'maneuver' || st.action || st.charges < 1) return false;
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (!(len > 1e-9)) return false;
  st.charges -= 1;
  st.action = 'jump';
  st.actT = 0;
  st.jumpDirX = dirX / len;
  st.jumpDirY = dirY / len;
  st.jumpDist = Math.max(0, Number(hullLength) || 0) * (Number(def.jumpHullFrac) || 0.5);
  st.jumpTime = Math.max(0.1, Number(def.jumpTime) || 1);
  st.jumpKick = clamp(Number(def.jumpKick) || 0.3, 0.05, 0.95);
  st.jumpPeak = maneuverJumpPeak(st.jumpDist, st.jumpTime, st.jumpKick);
  st.jumpBase = Number(baseLateral) || 0;
  st.jumpLast = st.jumpBase;
  st.jumpAborted = false;
  st.serial++;
  st.uses++;
  return true;
}

/**
 * Krok skoku. `lat` — prędkość okrętu wzdłuż kierunku skoku po reszcie fizyki tego kroku, `abortTol` — największa
 * zmiana prędkości bocznej spoza skoku między krokami [j/s]. Zwraca prędkość boczną do wpisania albo NaN (bez
 * skoku / zerwany — wtedy st.jumpAborted). Ostatni krok zwraca prędkość bazową i kończy akcję.
 */
export function stepManeuverJump(st, dt, lat, abortTol) {
  if (!st || st.action !== 'jump') return NaN;
  if (Math.abs(lat - st.jumpLast) > abortTol) {
    st.action = '';
    st.jumpAborted = true;
    return NaN;
  }
  st.actT += dt;
  if (st.actT >= st.jumpTime) {
    st.action = '';
    st.jumpLast = st.jumpBase;
    return st.jumpBase;
  }
  st.jumpLast = st.jumpBase + maneuverJumpSpeed(st.actT, st.jumpTime, st.jumpKick, st.jumpPeak);
  return st.jumpLast;
}

// ---------------------------------------------------------------- manewr: obrót

/**
 * Najlepszy namiar celu względem dziobu z łuków dział: `arcs` — tablica płaska [środek, połowa, …] (rad, układ
 * kadłuba: 0 = dziób, kurs świata = kurs okrętu + kąt), `n` — liczba łuków. Najwięcej łuków obejmujących namiar,
 * przy remisie bliżej dziobu; dziób wygrywa, gdy daje ≥ bowPref najlepszego (jak resolveWeaponFacingBias AI).
 * out: { offset, count, symmetric } — symmetric: namiar −offset obejmuje tyle samo dział.
 */
export function maneuverFacingOffset(arcs, n, bowPref, out) {
  const step = 5 * DEG;
  let best = 0;
  let bestCount = -1;
  let bowCount = 0;
  for (let k = 0; k <= 72; k++) {
    const beta = k === 0 ? 0 : ((k & 1) ? 1 : -1) * Math.ceil(k / 2) * step;
    const c = countArcs(arcs, n, beta);
    if (k === 0) bowCount = c;
    if (c > bestCount) {
      bestCount = c;
      best = beta;
    }
  }
  if (bowCount >= bestCount * bowPref) best = 0;
  out.offset = best;
  out.count = countArcs(arcs, n, best);
  out.symmetric = best !== 0 && countArcs(arcs, n, -best) === out.count;
  return out;
}

function countArcs(arcs, n, beta) {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(wrapSysAngle(beta - arcs[2 * i])) <= arcs[2 * i + 1] + 1e-9) c++;
  }
  return c;
}

/**
 * Kąt obrotu do kursu `aim` z kursu `angle` w kierunku `dir` (−1 w lewo / A, +1 w prawo / D; 0 — najkrótszą
 * drogą): [0, 2π) w kierunku obrotu, a dla dir 0 — wartość ze znakiem w (−π, π].
 */
export function maneuverTurnDelta(angle, aim, dir) {
  const e = wrapSysAngle(aim - angle);
  if (!dir) return e;
  const d = dir < 0 ? -e : e;
  return d < 0 ? d + TAU : d;
}

/**
 * Start obrotu na kurs `aim`: `dir` — −1 / +1 (A / D) albo 0 (najkrótszą drogą). `offset` — namiar celu względem
 * dziobu, który ma się ustawić (0 = dziób, ±π/2 = burta); klej kroczy obrót z kursem aim = namiar celu − offset.
 * `omega` — prędkość kątowa okrętu przy starcie [rad/s].
 */
export function startManeuverTurn(st, def, dir, angle, aim, offset = 0, omega = 0) {
  if (!st || !def || def.id !== 'maneuver' || st.action || st.charges < 1) return false;
  const e = wrapSysAngle(aim - angle);
  const s = dir ? (dir < 0 ? -1 : 1) : (e < 0 ? -1 : 1);
  st.charges -= 1;
  st.action = 'turn';
  st.actT = 0;
  st.turnDir = s;
  st.turnLeft = dir ? maneuverTurnDelta(angle, aim, s) : Math.abs(e);
  st.turnAim = aim;
  st.turnAimRate = 0;
  st.turnAngle = angle;
  st.turnOffset = offset;
  st.turnOmega = Number(omega) || 0;
  st.serial++;
  st.uses++;
  return true;
}

/**
 * Krok obrotu: kurs docelowy `aim` (cel się rusza), kurs okrętu `angle` → prędkość kątowa do wpisania [rad/s].
 * Profil prowadzi WŁASNĄ prędkość kątową (st.turnOmega) — limit obrotu napędu, który fizyka okrętu nakłada przed
 * manewrem, nie może jej przycinać krok po kroku. NaN — bez obrotu. Gdy obrót się kończy (cel osiągnięty albo
 * turnTimeout), zwraca 0 i zeruje akcję (st.action === '').
 */
export function stepManeuverTurn(st, def, dt, angle, aim) {
  if (!st || st.action !== 'turn' || !def) return NaN;
  const s = st.turnDir;
  const dAim = wrapSysAngle(aim - st.turnAim);
  st.turnLeft += s * dAim - s * wrapSysAngle(angle - st.turnAngle);
  // Tempo kursu docelowego w kierunku obrotu (wyprzedzenie ruchomego celu — bez błędu ustalonego).
  if (dt > 0) st.turnAimRate += (s * dAim / dt - st.turnAimRate) * (1 - Math.exp(-dt / TURN_AIM_RATE_TAU));
  st.turnAim = aim;
  st.turnAngle = angle;
  if (Math.abs(st.turnLeft) < TURN_SETTLE_ZONE) st.turnLeft = s * wrapSysAngle(aim - angle);
  st.actT += dt;
  const alpha = Math.max(1e-3, (Number(def.turnAccel) || 90) * DEG);
  const wMax = Math.max(1e-3, (Number(def.turnRate) || 45) * DEG);
  const e = st.turnLeft;
  const ae = e < 0 ? -e : e;
  const ws = s * st.turnOmega;
  const ff = clamp(st.turnAimRate, -wMax, wMax);
  const slip = ws - ff;
  if ((ae < TURN_DONE_TOL && (slip < 0 ? -slip : slip) < alpha * Math.max(dt, 1 / 240) * 2)
    || st.actT > (Number(def.turnTimeout) || 5)) {
    st.action = '';
    st.turnTarget = null;
    st.turnOmega = 0;
    return 0;
  }
  // Profil hamowania względem ruchu celu: prędkość zbliżania √(2·α·e), końcówka liniowa.
  const mag = Math.min(wMax, Math.sqrt(2 * alpha * TURN_BRAKE_MARGIN * ae), ae * TURN_END_GAIN);
  const want = clamp(ff + (e < 0 ? -mag : mag), -wMax, wMax);
  const dv = alpha * dt;
  const next = ws < want ? Math.min(want, ws + dv) : Math.max(want, ws - dv);
  st.turnOmega = s * next;
  return st.turnOmega;
}

/** Kierunek momentu obrotu manewru dla obrazu dysz: +1 / −1 (rozkręcanie / hamowanie) albo 0. */
export function maneuverTurnTorque(st, omegaBefore, omegaAfter) {
  if (!st || st.action !== 'turn') return 0;
  const d = omegaAfter - omegaBefore;
  if (d > 1e-6) return 1;
  if (d < -1e-6) return -1;
  return st.turnDir;
}
