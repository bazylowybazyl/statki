// src/game/flight/hypercruise.js
//
// HIPERCRUISE gracza (E5, decyzja użytkownika 2026-10-21: „będzie możliwość hipercruise, czyli przelotu
// dającego większy vmax dla statków”; liczby — src/data/driveModes.js). Automat:
//   idle → spool (rozruch; lot zwykły trwa) → active (rozpęd do vmax × strefa, kurs z dziobu) → drop
//   (hamowanie do HYPERCRUISE_TUNE.exitSpeed, dalej regulator do limitu bojowego) → idle. PRZELOTU gracza nie ma
//   (decyzja użytkownika 2026-10-22) — hipercruise to jedyny napęd odcinków 'drive' TRAVEL TO.
// W 'active' i 'drop' automat PROWADZI prędkość (jak rampa wyjścia z warpa): klej gry pisze ship.vel =
// dziób × speed, bez ciągu dysz. Odcinek 'drive' rozkazu TRAVEL TO podaje cel (`target`) — automat sam
// hamuje tak, żeby wyjść `stopMargin` przed punktem z prędkością wyjścia (resztę dolotu robi autopilot).
// Hipercruise DA SIĘ PRZERWAĆ (warp nie): trafienie i blokada masy (wróg bliżej niż massLockRange)
// kończą go wyjściem — decyduje klej gry (`dropHypercruise(hc, powód)`).
//
// Moduł czysty: bez DOM, three i stanu gry.

import { hypercruiseSpec, HYPERCRUISE_TUNE } from '../../data/driveModes.js';

export const HC_IDLE = 'idle';
export const HC_SPOOL = 'spool';
export const HC_ACTIVE = 'active';
export const HC_DROP = 'drop';

export function createHypercruise() {
  return {
    state: HC_IDLE,
    t: 0,                // [s] w bieżącym stanie
    speed: 0,            // [j/s] prędkość prowadzona (active / drop)
    engineId: null,
    flightClass: null,
    vmax: 0, accel: 0, decel: 0, spool: 0, turnMul: 0.5,
    spoolNow: 0,         // [s] rozruch bieżącego startu (krótki odcinek TRAVEL TO — skrócony)
    vcap: 0,             // [j/s] sufit tej chwili (vmax × strefa)
    target: null,        // { x, y } — cel odcinka TRAVEL TO (null: lot ręczny)
    reason: '',          // powód ostatniego wyjścia ('', 'manual', 'arrive', 'brake', powód przerwania)
    interrupted: false   // ostatnie wyjście wymuszone (przechwyt)
  };
}

/** Silnik i klasa kadłuba → parametry; zwraca true, gdy statek ma hipercruise. */
export function configureHypercruise(hc, engineId, flightClass) {
  if (!hc) return false;
  if (hc.engineId === (engineId || null) && hc.flightClass === (flightClass || null)) return hc.vmax > 0;
  const spec = hypercruiseSpec(engineId, flightClass);
  hc.engineId = spec ? spec.engineId : null;
  hc.flightClass = flightClass || null;
  hc.vmax = spec ? spec.vmax : 0;
  hc.accel = spec ? spec.accel : 0;
  hc.decel = spec ? spec.decel : 0;
  hc.spool = spec ? spec.spool : 0;
  hc.turnMul = spec ? spec.turnMul : 0.5;
  if (!spec && hc.state !== HC_IDLE) resetHypercruise(hc);
  return !!spec;
}

export function hypercruiseBusy(hc) {
  return !!hc && hc.state !== HC_IDLE;
}

/** Automat prowadzi prędkość statku (lot zwykły wyłączony). */
export function hypercruiseDriving(hc) {
  return !!hc && (hc.state === HC_ACTIVE || hc.state === HC_DROP);
}

/**
 * Start rozruchu. opts.target — cel odcinka TRAVEL TO, opts.spool — rozruch tego startu [s] (krótki odcinek;
 * domyślnie pełny rozruch klasy). Zwraca false bez silnika albo w trakcie.
 */
export function engageHypercruise(hc, opts = {}) {
  if (!hc || !(hc.vmax > 0) || hc.state !== HC_IDLE) return false;
  hc.state = HC_SPOOL;
  hc.t = 0;
  const spool = Number(opts.spool);
  hc.spoolNow = Number.isFinite(spool) && spool >= 0 ? Math.min(hc.spool, spool) : hc.spool;
  hc.target = opts.target ? { x: Number(opts.target.x) || 0, y: Number(opts.target.y) || 0 } : null;
  hc.reason = '';
  hc.interrupted = false;
  return true;
}

/**
 * Wyjście: rozruch — od razu idle, lot — hamowanie do prędkości wyjścia. `forced` = przechwyt
 * (komunikat i HUD). Zwraca true, gdy coś przerwał.
 */
export function dropHypercruise(hc, reason = 'manual', forced = false) {
  if (!hc || hc.state === HC_IDLE || hc.state === HC_DROP) return false;
  hc.reason = reason;
  hc.interrupted = !!forced;
  if (hc.state === HC_SPOOL) {
    hc.state = HC_IDLE;
    hc.t = 0;
    hc.target = null;
    return true;
  }
  hc.state = HC_DROP;
  hc.t = 0;
  return true;
}

export function resetHypercruise(hc) {
  if (!hc) return;
  hc.state = HC_IDLE;
  hc.t = 0;
  hc.speed = 0;
  hc.target = null;
}

/**
 * Krok automatu. ctx:
 *   speed      — bieżąca prędkość statku [j/s] (start lotu z niej),
 *   zone       — mnożnik strefy (pas 0,8, planety 0,3 — jak warp; ≥ HYPERCRUISE_TUNE.minZone),
 *   remaining  — droga do celu wzdłuż kursu [j.] (cel TRAVEL TO; bez celu — Infinity),
 *   stopMargin — ile przed celem kończy się hipercruise [j.] (droga hamowania lotu zwykłego),
 *   brake      — hamulec gracza (S): cel 0, poniżej prędkości wyjścia — wyjście,
 *   exitSpeed  — prędkość końca wyjścia (domyślnie HYPERCRUISE_TUNE.exitSpeed),
 *   align      — 0…1, zgodność dziobu z kursem do celu (cos² błędu; bez celu — pomiń),
 *   thrust     — 0…1, ułamek sprawnego ciągu MAIN (rozpęd × thrust; hamowanie bez zmian).
 * Zwraca zdarzenie: 'engage' (koniec rozruchu), 'exit' (koniec wyjścia), 'arrive' (cel odcinka) albo null.
 */
export function stepHypercruise(hc, ctx, dt) {
  if (!hc || hc.state === HC_IDLE) return null;
  const step = Math.max(0, Number(dt) || 0);
  const exitSpeed = Math.max(0, Number(ctx?.exitSpeed ?? HYPERCRUISE_TUNE.exitSpeed) || 0);
  hc.t += step;
  if (hc.state === HC_SPOOL) {
    if (hc.t < hc.spoolNow) return null;
    hc.state = HC_ACTIVE;
    hc.t = 0;
    hc.speed = Math.max(0, Number(ctx?.speed) || 0);
    return 'engage';
  }
  const zone = Math.max(HYPERCRUISE_TUNE.minZone, Math.min(1, Number(ctx?.zone ?? 1) || 1));
  hc.vcap = hc.vmax * zone;
  if (hc.state === HC_DROP) {
    // Przechwyt hamuje mocniej (HYPERCRUISE_TUNE.interruptDecelMul) — wypada przy przechwytującym, nie 60 km dalej.
    const decel = hc.decel * (hc.interrupted ? HYPERCRUISE_TUNE.interruptDecelMul : 1);
    hc.speed = Math.max(exitSpeed, hc.speed - decel * step);
    if (hc.speed <= exitSpeed + 1e-6) {
      hc.state = HC_IDLE;
      hc.t = 0;
      hc.target = null;
      return 'exit';
    }
    return null;
  }
  // HC_ACTIVE: prędkość zadana — sufit strefy, hamulec, profil dolotu do celu.
  let cmd = hc.vcap;
  if (ctx?.brake) cmd = 0;
  const remaining = Number(ctx?.remaining);
  if (hc.target && Number.isFinite(remaining)) {
    const left = remaining - Math.max(0, Number(ctx?.stopMargin) || 0);
    if (left <= 0) {
      hc.state = HC_IDLE;
      hc.t = 0;
      hc.speed = Math.min(hc.speed, exitSpeed);
      hc.target = null;
      hc.reason = 'arrive';
      return 'arrive';
    }
    // v² = vExit² + 2·b·droga — hamowanie kończy się w punkcie wyjścia z prędkością wyjścia.
    cmd = Math.min(cmd, Math.sqrt(exitSpeed * exitSpeed + 2 * hc.decel * left));
  }
  // Dziób poza kursem (cel z boku): prędkość × cos² błędu, nie mniej niż prędkość wyjścia — statek
  // najpierw dociąga dziób, zamiast kreślić łuk na dziesiątki kilometrów.
  const align = Number(ctx?.align);
  if (Number.isFinite(align) && align < 1) cmd = Math.min(cmd, Math.max(exitSpeed, cmd * Math.max(0, align)));
  // Ciąg: uszkodzone dysze MAIN rozpędzają wolniej (mainEngineFraction — klej gry).
  const thrust = Math.max(0, Math.min(1, Number(ctx?.thrust ?? 1)));
  if (hc.speed < cmd) hc.speed = Math.min(cmd, hc.speed + hc.accel * thrust * step);
  else hc.speed = Math.max(cmd, hc.speed - hc.decel * step);
  if (ctx?.brake && hc.speed <= exitSpeed) {
    hc.state = HC_IDLE;
    hc.t = 0;
    hc.target = null;
    hc.reason = 'brake';
    return 'exit';
  }
  return null;
}

/**
 * BEZPIECZNIK PRZESZKÓD (E9 2026-10-22): hipercruise jest duchem dla kadłubów, ale płyta ringu zostaje przeszkodą, a
 * sufit strefy planety hamuje automat za wolno (Mk III wpadał w płytę Ziemi z 38 tys. j/s). Klej mierzy odległość
 * wzdłuż kursu do przeszkody, a ten automat mówi, kiedy wyjść: gdy przeszkoda jest bliżej niż droga hamowania
 * przechwytu (× interruptDecelMul) z bieżącej prędkości + zapas + dwa kroki lotu.
 */
export const HC_OBSTACLE_MARGIN = 1500;

/** Droga [j.] od bieżącej prędkości do prędkości wyjścia; forced — hamowanie przechwytu. */
export function hypercruiseStopDistance(hc, forced = false, exitSpeed = HYPERCRUISE_TUNE.exitSpeed) {
  if (!hc || !(hc.decel > 0)) return 0;
  const v = Math.max(0, Number(hc.speed) || 0);
  const ve = Math.max(0, Number(exitSpeed) || 0);
  if (v <= ve) return 0;
  const a = hc.decel * (forced ? HYPERCRUISE_TUNE.interruptDecelMul : 1);
  return (v * v - ve * ve) / (2 * a);
}

/** Jak daleko wzdłuż kursu klej ma szukać przeszkody [j.] (0 — hipercruise nie prowadzi lotu). */
export function hypercruiseObstacleLookAhead(hc, dt) {
  if (!hypercruiseDriving(hc)) return 0;
  return hypercruiseStopDistance(hc, true) + HC_OBSTACLE_MARGIN + 2 * Math.max(0, Number(hc.speed) || 0) * Math.max(0, Number(dt) || 0);
}

/**
 * Przeszkoda `dist` [j.] przed dziobem (Infinity — brak): 'drop' — wyjście wymuszone (hamowanie przechwytu), 'brake'
 * — trwające wyjście zwykłe ma hamować mocniej, null — nic. Wyjście kończy się przed przeszkodą z prędkością wyjścia.
 */
export function hypercruiseObstacleAction(hc, dist, dt) {
  if (!hypercruiseDriving(hc) || !Number.isFinite(dist)) return null;
  if (dist > hypercruiseObstacleLookAhead(hc, dt)) return null;
  if (hc.state === HC_ACTIVE) return 'drop';
  return hc.interrupted ? null : 'brake';
}

/** Postęp rozruchu 0…1 (HUD). */
export function hypercruiseSpoolProgress(hc) {
  if (!hc || hc.state !== HC_SPOOL) return hc && hypercruiseDriving(hc) ? 1 : 0;
  return Math.min(1, hc.t / Math.max(1e-3, hc.spoolNow));
}
