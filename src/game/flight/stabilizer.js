// src/game/flight/stabilizer.js
// Heading target and assist torque for ship stabilizer mode.

import { SHIP_PHYSICS } from './thrusterModel.js';
import {
  HEADING_THRUSTER_LAG,
  computeHeadingTorqueCommand,
  computeTurnStoppingAngle
} from './headingControl.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

// Najdalej, jak strzałka może wyprzedzić dziób przy trzymanym A/D.
export const STABILIZER_MAX_ARROW_LEAD = (170 * Math.PI) / 180;

export function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function writeOutput(state, values) {
  const out = state.output || (state.output = {
    active: false,
    manualActive: false,
    targetAngle: 0,
    headingError: 0,
    torque: 0,
    targetRate: 0,
    desiredRate: 0,
    predictiveBrake: false,
    stoppingAngle: 0,
    dirX: 1,
    dirY: 0
  });
  out.active = !!values.active;
  out.manualActive = !!values.manualActive;
  out.targetAngle = Number(values.targetAngle) || 0;
  out.headingError = Number(values.headingError) || 0;
  out.torque = Number(values.torque) || 0;
  out.targetRate = Number(values.targetRate) || 0;
  out.desiredRate = Number(values.desiredRate) || 0;
  out.predictiveBrake = !!values.predictiveBrake;
  out.stoppingAngle = Math.max(0, Number(values.stoppingAngle) || 0);
  out.dirX = Math.cos(out.targetAngle);
  out.dirY = Math.sin(out.targetAngle);
  return out;
}

export function updateHeadingStabilizer(state, ship, dt, options = {}) {
  const s = state || {};
  const angle = Number.isFinite(Number(ship?.angle)) ? Number(ship.angle) : 0;
  const omega = Number(ship?.angVel) || 0;
  const enabled = !!options.enabled;
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));

  if (!enabled) {
    s.enabled = false;
    s.targetAngle = angle;
    s.targetOffset = 0;
    s.lastAngle = angle;
    return writeOutput(s, {
      active: false,
      manualActive: false,
      targetAngle: angle,
      headingError: 0,
      torque: 0,
      targetRate: 0,
      desiredRate: 0
    });
  }

  if (!s.enabled || !Number.isFinite(Number(s.targetAngle))) {
    s.targetAngle = angle;
  }
  s.enabled = true;

  // Strzałka jako przesunięcie względem dziobu, BEZ zawijania do ±180°.
  // Zawinięta strzałka po przejechaniu 180° wskazywała „na skróty" w drugą
  // stronę i statek zawracał. s.targetAngle zostaje kanoniczną strzałką dla
  // HUD i dla zmian z zewnątrz (setFlightStabilizerEnabled).
  let offset = Number(s.targetOffset);
  const lastAngle = Number(s.lastAngle);
  if (!Number.isFinite(offset) || !Number.isFinite(lastAngle)) {
    offset = wrapAngle(Number(s.targetAngle) - angle);
  } else {
    offset -= wrapAngle(angle - lastAngle);
    if (Math.abs(wrapAngle(angle + offset - Number(s.targetAngle))) > 1e-6) {
      offset = wrapAngle(Number(s.targetAngle) - angle);
    }
  }

  const physics = options.physics || SHIP_PHYSICS;
  const manualDeadzone = Math.max(0, Math.min(0.5, Number(options.manualDeadzone) || 0.08));
  const manualTorque = clamp(options.manualTorque, -1, 1);
  const manualMag = Math.abs(manualTorque);
  const manualActive = manualMag > manualDeadzone;
  let targetRate = 0;

  if (manualActive) {
    const manualNorm = ((manualMag - manualDeadzone) / Math.max(1e-6, 1 - manualDeadzone)) * Math.sign(manualTorque);
    const targetTurnRate = Math.max(
      0.2,
      Number(options.targetTurnRate) || Math.max(1.4, Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED)
    );
    targetRate = manualNorm * targetTurnRate;
    // Strzałka biegnie dużo szybciej niż ciężki kadłub się obraca — nie dalej
    // niż STABILIZER_MAX_ARROW_LEAD przed dziób, żeby kierunek obrotu był
    // zawsze jednoznaczny (dalej niż 180° nie odróżnisz prawo od lewo).
    const next = offset + targetRate * clampedDt;
    offset = Math.abs(next) > STABILIZER_MAX_ARROW_LEAD && Math.abs(next) > Math.abs(offset)
      ? Math.sign(next) * Math.max(Math.abs(offset), STABILIZER_MAX_ARROW_LEAD)
      : next;
  }

  // Prawdziwa zdolność obrotu statku (resolveShipTurnCapability z index.html).
  // Bez niej — stary szacunek; dawna stała 0,85 rad/s² była ~23× za optymistyczna
  // dla Atlasa, więc stabilizator hamował za późno i kiwał się wokół strzałki.
  const capability = options.turnCapability || null;
  const turnAccel = Math.max(1e-3, Number(capability?.accel) || Number(options.brakeAccel) || 0.85);
  const maxTurnRate = Math.max(0.02, Number(capability?.maxRate) || Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED);
  const lagTime = Number.isFinite(Number(capability?.lag)) ? Number(capability.lag) : HEADING_THRUSTER_LAG;
  const maxAssist = Math.max(0, Number(options.maxAssist) || 1);

  // Strzałka nie może stać bliżej niż punkt, w którym statek i tak wyhamuje
  // obrót — inaczej przestrzelenie jest pewne i regulator wraca, przestrzeliwuje
  // w drugą stronę itd. Gdy gracz puścił klawisz (albo trzyma go w tę samą
  // stronę), strzałkę przesuwamy do punktu zatrzymania: manewr kończy się jednym
  // ruchem, a strzałka pokazuje, gdzie statek się zatrzyma. Klawisz w przeciwną
  // stronę jej nie dotyczy — wtedy gracz sam chce zawrócić.
  if (Math.abs(omega) > 1e-4) {
    const turnSign = Math.sign(omega);
    const manualAgainst = manualActive && Math.sign(targetRate) === -turnSign;
    if (!manualAgainst && offset * turnSign >= 0) {
      // Punkt zatrzymania przy PEŁNYM hamowaniu (zapas 1.0). Regulator planuje
      // z zapasem 0,8, więc taki cel jest dla niego „na styk" i hamuje pełnym
      // momentem. Z tym samym zapasem po obu stronach powstawał punkt stały:
      // zero momentu i strzałka jadąca razem ze statkiem bez końca.
      const stopOffset = turnSign * computeTurnStoppingAngle(omega, turnAccel * Math.min(1, maxAssist), lagTime, 1);
      if ((offset - stopOffset) * turnSign < 0) offset = stopOffset;
    }
  }

  s.targetOffset = offset;
  s.lastAngle = angle;
  const targetAngle = wrapAngle(angle + offset);
  s.targetAngle = targetAngle;
  const headingError = offset;
  const control = computeHeadingTorqueCommand({
    headingError,
    omega,
    turnAccel,
    maxTurnRate,
    lagTime,
    torqueLimit: maxAssist
  });

  return writeOutput(s, {
    active: true,
    manualActive,
    targetAngle,
    headingError,
    torque: control.torque,
    targetRate,
    desiredRate: control.desiredOmega,
    predictiveBrake: control.braking,
    stoppingAngle: control.stoppingAngle,
  });
}

export function shouldZeroStabilizedAngularVelocity(options = {}) {
  if (!options.stabilizerEnabled) return false;
  const turnThreshold = Math.max(0, Number(options.turnThreshold) || 0.03);
  const angularThreshold = Math.max(0, Number(options.angularThreshold) || 0.0035);
  const activeTurnCommand = Math.abs(Number(options.activeTurnCommand) || 0);
  const angVel = Math.abs(Number(options.angVel) || 0);
  return activeTurnCommand < turnThreshold && angVel < angularThreshold;
}
