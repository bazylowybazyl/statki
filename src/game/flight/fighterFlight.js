// src/game/flight/fighterFlight.js
//
// PILOT MYŚLIWCA (2026-10-14, audyt docs/AUDYT-mysliwce-2026-10-14.md). Mózg (src/ai/fighterAI.js, 20 Hz)
// ustawia tylko ZAMIAR — wektor żądanej prędkości, sufit tempa skrętu, opcjonalnie kurs nosa — a ten moduł
// w KAŻDYM kroku fizyki zamienia go na ruch:
//   • kurs wektora prędkości skręca z ograniczonym PRZECIĄŻENIEM BOCZNYM: ω ≤ min(maxTurn, latAccel / v)
//     — promień skrętu v² / latAccel, szybki myśliwiec zakręca szerzej niż zwolniony (prędkość narożna),
//   • tempo skrętu narasta z ograniczonym przyspieszeniem kątowym (rollAccel) — łuk zaczyna się łagodnie,
//     bez załamań toru co tick mózgu,
//   • moduł prędkości dociąga przyspieszeniem / hamowaniem z karty eskadry,
//   • nos (npc.angle) idzie za wektorem prędkości; zamiar `face` może go odchylić najwyżej o slipMax
//     (celowanie w przelocie), obrót kadłuba ma własny sufit.
// Dawniej mózg co 50 ms obracał SAM wektor prędkości o 15–22° (280–450°/s przy 2800 j/s = przeciążenie
// boczne 7–22 tys. j/s² przy przyspieszeniu 2000), a kadłub obracał się do 690°/s osobno: tor był łamaną,
// myśliwiec połowę czasu leciał bokiem i zawracał co ~1,3 s (pomiar scripts/webgpu/mysliwce-zachowanie-gra.mjs).
//
// Czysty moduł: bez window i DOM. Gra woła stepFighterFlight w npcStep (krok fizyki), mózg — setFighterIntent.

import { getFighterSquadronDef } from '../../data/fighterSquadrons.js';

/** Strojenie na żywo (window.FighterFlightTune w index.html): mnożniki karty eskadry. */
export const FIGHTER_FLIGHT_TUNE = {
  latAccelMul: 1,
  maxTurnMul: 1,
  rollAccelMul: 1,
  speedMul: 1,
  /** Wzmocnienie regulatora kursu [1/s]: ω = błąd · gain (bez przestrzelenia przy małym błędzie). */
  headingGain: 6.5,
  /** Najmniejsza prędkość do przeciążenia bocznego — poniżej ω ogranicza sam maxTurn. */
  minTurnSpeed: 240,
  /** Odchyłka nosa od wektora prędkości dopuszczona zamiarem `face` [rad]. */
  slipMax: 0.3,
  /** Obrót kadłuba = maxTurn × ten mnożnik (dogania nos po zmianie zamiaru `face`). */
  spriteTurnMul: 1.7,
  /** Obrót wieżyczki kanonierki [rad/s]. */
  turretTurn: 4.5
};

const DEG = Math.PI / 180;

const wrap = (a) => {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/**
 * Karta lotu myśliwca: z karty eskadry (`npc.squadronId`), braki z pól encji. Wartości w j./s, j./s², rad/s.
 * Liczona raz na encję i zmianę strojenia (licznik `_tuneRev`).
 */
let _tuneRev = 1;
export function bumpFighterFlightTune() { _tuneRev++; }

export function fighterFlightSpec(npc) {
  let s = npc.__flSpec;
  if (s && s.rev === _tuneRev && s.sq === npc.squadronId && s.ms === npc.maxSpeed) return s;
  if (!s) {
    s = npc.__flSpec = {
      rev: 0, sq: null, ms: 0,
      maxSpeed: 0, accel: 0, decel: 0, latAccel: 0, maxTurn: 0, rollAccel: 0, spriteTurn: 0, cornerSpeed: 0
    };
  }
  const def = npc.squadronId ? getFighterSquadronDef(npc.squadronId) : null;
  const T = FIGHTER_FLIGHT_TUNE;
  const maxSpeed = Math.max(150, (Number(npc.maxSpeed) || Number(def?.maxSpeed) || 1200) * T.speedMul);
  const accel = Math.max(60, Number(npc.accel) || Number(def?.accel) || maxSpeed * 0.75);
  const flight = def?.flight || null;
  s.rev = _tuneRev;
  s.sq = npc.squadronId;
  s.ms = npc.maxSpeed;
  s.maxSpeed = maxSpeed;
  s.accel = accel;
  s.decel = Math.max(accel, Number(flight?.decel) || accel * 1.35);
  s.latAccel = Math.max(200, (Number(flight?.latAccel) || accel * 3) * T.latAccelMul);
  s.maxTurn = Math.max(0.3, (Number(flight?.maxTurnDeg) || 150) * DEG * T.maxTurnMul);
  s.rollAccel = Math.max(0.5, (Number(flight?.rollAccel) || 8) * T.rollAccelMul);
  s.spriteTurn = s.maxTurn * T.spriteTurnMul;
  s.cornerSpeed = s.latAccel / s.maxTurn;
  return s;
}

/** Promień skrętu przy prędkości v [j.] — do geometrii mózgu (dobieg, nawrót, orbita). */
export function fighterTurnRadius(spec, v) {
  const speed = Math.max(Number(v) || 0, 1);
  const omega = Math.min(spec.maxTurn, spec.latAccel / Math.max(speed, FIGHTER_FLIGHT_TUNE.minTurnSpeed));
  return speed / Math.max(1e-6, omega);
}

/**
 * Zamiar mózgu. `turnDeg` — sufit tempa skrętu z gałęzi mózgu [°/s] (Infinity: tylko karta); `face` — kurs nosa
 * (NaN: wzdłuż prędkości). Zamiar obowiązuje do następnego wywołania (pilot leci z nim także między tickami).
 */
export function setFighterIntent(npc, wantVx, wantVy, turnDeg = Infinity, face = NaN) {
  npc.__flOn = true;
  npc.__flWx = Number.isFinite(wantVx) ? wantVx : 0;
  npc.__flWy = Number.isFinite(wantVy) ? wantVy : 0;
  npc.__flTurn = (Number.isFinite(turnDeg) && turnDeg > 0) ? turnDeg * DEG : Infinity;
  npc.__flFace = face;
}

/** Kurs nosa na najbliższy krok (NaN — wzdłuż prędkości). */
export function setFighterFace(npc, face) {
  npc.__flFace = face;
}

/**
 * Krok pilota. Zwraca false, gdy encja nie ma zamiaru (np. tuż po starcie z hangaru) — wtedy ruchem rządzi
 * dotychczasowa prędkość. Bez alokacji.
 */
export function stepFighterFlight(npc, dt) {
  if (!npc.__flOn || !(dt > 0)) return false;
  const spec = fighterFlightSpec(npc);
  const T = FIGHTER_FLIGHT_TUNE;
  let vx = Number(npc.vx) || 0;
  let vy = Number(npc.vy) || 0;
  let speed = Math.sqrt(vx * vx + vy * vy);
  const wx = npc.__flWx;
  const wy = npc.__flWy;
  let wantSpeed = Math.sqrt(wx * wx + wy * wy);
  if (wantSpeed > spec.maxSpeed) wantSpeed = spec.maxSpeed;

  let psi;
  if (speed > 1) psi = Math.atan2(vy, vx);
  else if (wantSpeed > 1e-6) psi = Math.atan2(wy, wx);   // z postoju prosto w żądaną stronę
  else psi = Number(npc.angle) || 0;

  let omega = 0;
  if (wantSpeed > 1e-6 && speed > 1) {
    const err = wrap(Math.atan2(wy, wx) - psi);
    const lim = Math.min(spec.maxTurn, npc.__flTurn, spec.latAccel / Math.max(speed, T.minTurnSpeed));
    omega = clamp(err * T.headingGain, -lim, lim);
    // Przyspieszenie kątowe: skręt narasta / gaśnie łagodnie — łuk zamiast załamania.
    const prev = Number(npc.__flOmega) || 0;
    const dw = spec.rollAccel * dt;
    omega = clamp(omega, prev - dw, prev + dw);
    // Nie przekręć celu w tym kroku (mały błąd przy dużym poprzednim ω).
    if (Math.abs(omega * dt) > Math.abs(err) && Math.sign(omega) === Math.sign(err)) omega = err / dt;
    psi += omega * dt;
  }
  npc.__flOmega = omega;

  if (wantSpeed > speed) speed = Math.min(wantSpeed, speed + spec.accel * dt);
  else speed = Math.max(wantSpeed, speed - spec.decel * dt);

  const c = Math.cos(psi);
  const s = Math.sin(psi);
  npc.vx = c * speed;
  npc.vy = s * speed;

  // Nos: wzdłuż prędkości albo zamiar `face` w granicy poślizgu.
  let face = psi;
  if (Number.isFinite(npc.__flFace)) {
    face = speed > 60 ? psi + clamp(wrap(npc.__flFace - psi), -T.slipMax, T.slipMax) : npc.__flFace;
  }
  const ang = Number.isFinite(npc.angle) ? npc.angle : face;
  const da = wrap(face - ang);
  const maxRot = spec.spriteTurn * dt;
  const rot = clamp(da, -maxRot, maxRot);
  npc.angle = wrap(ang + rot);
  npc.angVel = rot / dt;
  npc.desiredAngle = npc.angle;

  // Wieżyczka (kanonierka): obrót do kursu `__turAim` z własnym sufitem.
  if (Number.isFinite(npc.__turAim)) {
    const cur = Number.isFinite(npc.turretAngle) ? npc.turretAngle : npc.angle;
    const dt2 = wrap(npc.__turAim - cur);
    const lim = T.turretTurn * dt;
    npc.turretAngle = wrap(cur + clamp(dt2, -lim, lim));
  }
  return true;
}
