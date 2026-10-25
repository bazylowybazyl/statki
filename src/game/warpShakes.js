// src/game/warpShakes.js — wstrząsy kamery skoku gracza i wyrzutów NPC po stronie GRY (nowy warp, etap W — DECYZJE W1;
// wzór RW-30: src/game/cameraShakes.js).
//
// Dawniej wstrząsy skoku zgłaszał moduł renderu (`WarpPlayerFx` — player.js: kop 18 / 0,3 s, wyjście 8 / 0,4 s,
// hamowanie 22 / 0,3 s; `WarpNurt._burstShake` — wyrzut okrętu NPC z tunelu) hakiem `onShake`, podpiętym tylko na
// stronie: w workerze renderu (tryb gracza) ginęły wszystkie. Wszystkie te chwile zna gra (automat warpa, rampa wyjścia,
// hipercruise, zegar rejestru ruchu warpa), więc żądania idą stąd — te same wartości i ta sama oś czasu co w efekcie
// (przejścia stanu, zegar gry), w trybie `off` i w workerze tak samo; render już nie wstrząsa (bez podwójnego wstrząsu).
// Czysty moduł (bez three i DOM).

import { WARP_EXIT } from './warpDrive.js';

/** Wstrząsy skoku gracza [siła, czas s] (wartości z dema — dawniej player.js); hipercruise: kop × hyperKickMul. */
export const WARP_SHAKE = Object.freeze({
  kick: Object.freeze([18, 0.3]),
  exit: Object.freeze([8, 0.4]),
  brake: Object.freeze([22, 0.3]),
  hyperKickMul: 0.5,
  // wyrzut okrętu NPC z tunelu (dawniej WarpNurt._burstShake): siła 12 · (0,4 + 0,8 · skala) · bliskość, 0,35 s
  burstMag: 12, burstBase: 0.4, burstSize: 0.8, burstDur: 0.35, burstReachMin: 4000, burstReachHull: 6
});

/** Stan automatu wstrząsów skoku gracza (jeden na gracza). */
export function createWarpShakeState() {
  return { jumping: false, hyper: false, exitAge: -1, tBrake: 0 };
}

/**
 * Krok automatu (raz na krok fizyki, PO automacie warpa i hipercruise'u — czas gry, w pauzie nie biegnie). Przejścia
 * jak w dawnym `WarpPlayerFx`:
 *   • start lotu (warp 'active' albo lot hipercruise'u) → kop (hipercruise × hyperKickMul);
 *   • koniec lotu → wyjście, potem hamowanie w chwili `tBrake` osi wyjścia — z rampy gry (warp z rampą: wiek rampy) albo
 *     z czasów domyślnych `WARP_EXIT.slow + coast` od wyjścia (hipercruise, hamowanie grawitacyjne bez rampy);
 *   • nowe ładowanie przed hamowaniem kasuje czekające hamowanie (efekt przechodził wtedy w ładowanie);
 *   • lot prosto w ładowanie (bez kroku bezczynności — hipercruise ponawiany przez TRAVEL TO) — bez wyjścia i hamowania
 *     (dawny efekt przechodził z 'warp' wprost w 'charging', bez `_beginExit`).
 * `input` = { alive, jumping, hyper, charging, ramp (warp.exitRamp albo null) }; `emit(siła, czas)`. Zwraca liczbę
 * zgłoszonych wstrząsów w tym kroku.
 */
export function stepWarpShakes(s, input, dt, emit) {
  if (!input || !input.alive) {
    s.jumping = false;
    s.exitAge = -1;
    return 0;
  }
  let n = 0;
  if (input.jumping) {
    if (!s.jumping) {
      s.jumping = true;
      s.hyper = !!input.hyper;
      s.exitAge = -1;
      const k = WARP_SHAKE.kick;
      emit(k[0] * (s.hyper ? WARP_SHAKE.hyperKickMul : 1), k[1]);
      n++;
    }
    return n;
  }
  if (s.jumping) {
    s.jumping = false;
    if (input.charging) {
      // lot prosto w nowe ładowanie (hipercruise 'active' → 'spool' w jednym kroku): dawny efekt szedł z lotu wprost
      // do ładowania — bez wyjścia i bez hamowania
      s.exitAge = -1;
      return n;
    }
    const r = input.ramp;
    if (!s.hyper && r && r.active) {
      s.exitAge = Math.max(0, Number(r.age) || 0);
      s.tBrake = Number(r.tBrake) || 0;
    } else {
      s.exitAge = 0;
      s.tBrake = WARP_EXIT.slow + WARP_EXIT.coast;
    }
    emit(WARP_SHAKE.exit[0], WARP_SHAKE.exit[1]);
    n++;
  } else if (s.exitAge >= 0) {
    s.exitAge += Math.max(0, Number(dt) || 0);
  }
  if (s.exitAge >= 0) {
    if (input.charging) s.exitAge = -1;
    else if (s.exitAge >= s.tBrake) {
      s.exitAge = -1;
      emit(WARP_SHAKE.brake[0], WARP_SHAKE.brake[1]);
      n++;
    }
  }
  return n;
}

/**
 * Siła wstrząsu wyrzutu okrętu NPC z tunelu (oś przylotu rejestru ruchu warpa `fx`: x, y — koniec hamowania,
 * hullLength, sizeScale) przy kamerze (camX, camY — bez wstrząsu): 0 poza zasięgiem.
 */
export function warpBurstShake(fx, camX, camY) {
  if (!fx) return 0;
  const dx = fx.x - camX;
  const dy = fx.y - camY;
  const d = Math.sqrt(dx * dx + dy * dy);
  const B = WARP_SHAKE;
  const near = Math.max(0, 1 - d / Math.max(B.burstReachMin, (Number(fx.hullLength) || 0) * B.burstReachHull));
  if (!(near > 0)) return 0;
  return B.burstMag * (B.burstBase + B.burstSize * (Number(fx.sizeScale) || 0)) * near;
}

/**
 * Wyrzuty NPC (raz na klatkę gry, po kroku rejestru `warpTraffic.step`): przylot, którego zegar rejestru minął chwilę
 * hamowania (`fx.tBrake`), zgłasza wstrząs RAZ (`seen` — WeakSet osi; alokacja tylko przy zdarzeniu). `records` —
 * `warpTraffic.records`, `time` — `warpTraffic.time`. Zwraca liczbę zgłoszeń.
 */
export function stepWarpBurstShakes(records, time, seen, camX, camY, emit) {
  let n = 0;
  if (!records) return 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const fx = rec && rec.kind === 'arrival' ? rec.fx : null;
    if (!fx || !(time >= fx.tBrake) || seen.has(fx)) continue;
    seen.add(fx);
    const mag = warpBurstShake(fx, camX, camY);
    if (mag > 0) { emit(mag, WARP_SHAKE.burstDur); n++; }
  }
  return n;
}
