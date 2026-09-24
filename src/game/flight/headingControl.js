// Shared heading motion-profile controller for angular ship steering.

import {
  SHIP_PHYSICS,
  clamp01,
  composeShipThrusterCommand,
  computeShipThrusterForces
} from './thrusterModel.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

// Zapas przy planowaniu hamowania obrotu: planujemy z 80% realnego
// przyspieszenia kątowego — reszta pokrywa błąd szacunku i opóźnienie dysz.
export const HEADING_BRAKE_MARGIN = 0.8;
// Opóźnienie odwrócenia ciągu dysz manewrowych (zmierzone: przejście momentu
// przez zero ~0,07 s, 90% odwrotnego ciągu ~0,13 s).
export const HEADING_THRUSTER_LAG = 0.1;

// Silniki główne obracają statek tylko odchyleniem dysz, a pracują wtedy na
// ≥18% ciągu, więc statek przy okazji rusza naprzód. Jeśli dysze boczne dają
// mniej niż tę część momentu, bez głównych obrót jest praktycznie niemożliwy
// (Bellator w domyślnym układzie edytora ma same silniki główne).
export const SIDE_TURN_WEAK_SHARE = 0.25;

// Rzeczywista zdolność obrotu statku — MIERZONA na tym samym modelu dysz, który
// całkuje physicsStep (composeShipThrusterCommand → computeShipThrusterForces),
// z przepustnicami i dyszami od razu w położeniu ustalonym, × mnożniki trybu
// napędu / bezwładność kadłuba. Dzięki temu nadąża za każdym kadłubem, trybem
// napędu i układem dysz z edytora. Dawniej stabilizator planował hamowanie ze
// stałej 0,85 rad/s² (Atlas bojowo ma ~0,037), a osobny szacunek rozjeżdżał się
// z fizyką zależnie od układu dysz (−11% Atlas, +23% fregata).
// `mainAssist`: true — obrót z odchyleniem silników głównych (w physicsStep
// mainTorque), false — same dysze boczne, 'auto' — główne tylko wtedy, gdy
// boczne są za słabe (wynik: `mainAssist`). `mainThrottle` — gaz główny w tej
// klatce, `mainBoost` — mnożnik ciągu głównego (boost). Z buforem `out` wynik
// jest pamiętany, dopóki nie zmieni się napęd, gaz ani układ dysz.
const NO_CAPABILITY_OPTIONS = Object.freeze({});
export function resolveShipTurnCapability(ship, drive = null, {
  mainAssist = false,
  mainThrottle = 0,
  mainBoost = 1,
  physics = SHIP_PHYSICS
} = NO_CAPABILITY_OPTIONS, out = null) {
  const sideForceMul = drive ? Math.max(1e-6, Number(drive.sideForceScale) || 0) : 1.6;
  const mainForceMul = (drive ? Math.max(1e-6, (Number(drive.mainForceScale) || 0) * (Number(drive.shiftBoostMultiplier) || 1)) : 1)
    * Math.max(1, Number(mainBoost) || 1);
  const turnScale = drive ? Math.max(0, Number(drive.turnAccelerationScale) || 0) : 1;
  const baseRate = Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED;
  const maxRate = Math.max(0.02, baseRate * (drive ? (Number(drive.maxTurnSpeedScale) || 1) : 1));
  const mainAccel = (Number(physics?.SPEED) || SHIP_PHYSICS.SPEED)
    * (drive ? Math.max(0, (Number(drive.mainForceScale) || 0) * (Number(drive.shiftBoostMultiplier) || 1)) : 1);
  const throttle = clamp01(mainThrottle);
  const geometry = thrusterGeometrySignature(ship);
  const mass = Math.max(1, Number(ship?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const inertia = Math.max(1, Number(ship?.inertia) || ((1 / 12) * mass * (((ship?.w || 450) ** 2) + ((ship?.h || 250) ** 2))));
  const result = out || {};
  const fresh = !(out && out._memoShip === ship && out._memoGeometry === geometry && out._memoMass === mass
    && out._memoInertia === inertia && out._memoSide === sideForceMul && out._memoMain === mainForceMul
    && out._memoThrottle === throttle && out._memoTurn === turnScale && out._memoSpeed === SHIP_PHYSICS.SPEED);
  if (fresh) {
    const probe = resolveTurnProbe(result, ship, geometry, mass);
    const sidePlus = measureSteadyTurnTorque(probe, 1, 0, throttle, mainForceMul, sideForceMul);
    const sideMinus = -measureSteadyTurnTorque(probe, -1, 0, throttle, mainForceMul, sideForceMul);
    const vectorPlus = measureSteadyTurnTorque(probe, 1, 1, throttle, mainForceMul, sideForceMul);
    const vectorMinus = -measureSteadyTurnTorque(probe, -1, -1, throttle, mainForceMul, sideForceMul);
    result.sideAccelPos = Math.max(0, sidePlus) / inertia * turnScale;
    result.sideAccelNeg = Math.max(0, sideMinus) / inertia * turnScale;
    result.vectorAccelPos = Math.max(0, vectorPlus) / inertia * turnScale;
    result.vectorAccelNeg = Math.max(0, vectorMinus) / inertia * turnScale;
    result.sideAccel = Math.min(result.sideAccelPos, result.sideAccelNeg);
    result.vectorAccel = Math.min(result.vectorAccelPos, result.vectorAccelNeg);
    // Strafe: moment (ze znakiem) i przyspieszenie boczne na jednostkę komendy.
    // Przy jednej dyszy bocznej na burtę (Custos) strafe JEST obrotem —
    // compensateStrafeYaw znosi go wtedy przeciwnym momentem.
    const yawLeft = measureSteadyStrafeTorque(probe, 1, 0, 0, mainForceMul, sideForceMul);
    const strafeLeftAccel = Math.abs(_probeForces.localFy) / mass;
    const yawRight = measureSteadyStrafeTorque(probe, 0, 1, 0, mainForceMul, sideForceMul);
    const strafeRightAccel = Math.abs(_probeForces.localFy) / mass;
    result.strafeYawLeft = yawLeft / inertia * turnScale;
    result.strafeYawRight = yawRight / inertia * turnScale;
    const turnTorque = Math.max(1e-9, Math.min(sidePlus, sideMinus), Math.min(vectorPlus, vectorMinus));
    result.strafeCoupling = Math.max(Math.abs(yawLeft), Math.abs(yawRight)) / turnTorque;
    // Przyspieszenie boczne samego strafe'u (u/s²); 0 = kadłub bez dysz bocznych.
    result.strafeAccel = Math.min(strafeLeftAccel, strafeRightAccel);
    // …i strafe'u ze zniesionym obrotem (przeciwna dysza zjada część siły).
    const compLeft = -yawLeft / Math.max(1e-9, yawLeft > 0 ? sideMinus : sidePlus);
    measureSteadyStrafeTorque(probe, 1, 0, clamp(compLeft, -1, 1), mainForceMul, sideForceMul);
    const netLeftAccel = Math.abs(_probeForces.localFy) / mass;
    const compRight = -yawRight / Math.max(1e-9, yawRight > 0 ? sideMinus : sidePlus);
    measureSteadyStrafeTorque(probe, 0, 1, clamp(compRight, -1, 1), mainForceMul, sideForceMul);
    const netRightAccel = Math.abs(_probeForces.localFy) / mass;
    result.strafeAccelCompensated = Math.min(netLeftAccel, netRightAccel);
    result._memoShip = ship;
    result._memoGeometry = geometry;
    result._memoMass = mass;
    result._memoInertia = inertia;
    result._memoSide = sideForceMul;
    result._memoMain = mainForceMul;
    result._memoThrottle = throttle;
    result._memoTurn = turnScale;
    result._memoSpeed = SHIP_PHYSICS.SPEED;
  }
  const useMain = mainAssist === 'auto'
    ? result.sideAccel < SIDE_TURN_WEAK_SHARE * result.vectorAccel
    : !!mainAssist;
  result.mainAssist = useMain;
  result.accel = Math.max(1e-3, useMain ? result.vectorAccel : result.sideAccel);
  result.maxRate = maxRate;
  result.lag = HEADING_THRUSTER_LAG;
  // Przyspieszenie liniowe z ciągu głównego (physicsStep: siła = masa·SPEED·mnożnik).
  result.mainAccel = mainAccel;
  // Limit prędkości governora bieżącego trybu/biegu (applyDriveSpeedGovernor).
  result.speedLimit = drive && Number(drive.speedLimit) > 0 ? Number(drive.speedLimit) : Infinity;
  return result;
}

// Obrót, który daje sam strafe (lewo/prawo 0..1), znosimy przeciwnym momentem
// w jednostkach komendy −1..1. Przy parach dysz przód/tył strafe nie skręca
// i nic się nie zmienia; przy jednej dyszy na burtę bez tego strafe skręcał
// statek, a regulator kursu (liczony na płynny obrót) nie nadążał go odkręcać.
export function compensateStrafeYaw(capability, torque, leftSide, rightSide) {
  // Gdy zniesienie obrotu zjada niemal cały strafe (Custos: strafe i
  // obrót to ta sama dysza), nie ma czego ratować — zostaje zwykła fizyka.
  if (!strafeUsableForCapability(capability)) return clamp(torque, -1, 1);
  const yaw = (Number(leftSide) || 0) * (Number(capability?.strafeYawLeft) || 0)
    + (Number(rightSide) || 0) * (Number(capability?.strafeYawRight) || 0);
  if (Math.abs(yaw) < 1e-9) return clamp(torque, -1, 1);
  const useMain = !!capability.mainAssist;
  const authority = yaw > 0
    ? (useMain ? capability.vectorAccelNeg : capability.sideAccelNeg)
    : (useMain ? capability.vectorAccelPos : capability.sideAccelPos);
  return clamp((Number(torque) || 0) - yaw / Math.max(1e-6, Number(authority) || 0), -1, 1);
}

// Czy kadłub umie przesunąć się w bok bez skręcania (po zniesieniu obrotu
// zostaje ≥25% siły strafe'u). Nie: Bellator (brak dysz bocznych), Custos
// (po jednej dyszy na burtę — strafe to ta sama dysza co obrót).
export const STRAFE_COMPENSATED_MIN_SHARE = 0.25;
export function strafeUsableForCapability(capability) {
  const compensated = Number(capability?.strafeAccelCompensated) || 0;
  return compensated > 1 && compensated >= STRAFE_COMPENSATED_MIN_SHARE * (Number(capability?.strafeAccel) || 0);
}

// Sonda: kopia dysz statku, na której liczymy ustalony moment obrotu, bez
// ruszania stanu dysz prawdziwego statku. Odtwarzana tylko po zmianie układu.
function resolveTurnProbe(holder, ship, geometry, mass) {
  let probe = holder._probe;
  if (!probe || holder._probeGeometry !== geometry || holder._probeShip !== ship) {
    probe = {
      mass,
      w: ship?.w,
      h: ship?.h,
      angle: 0,
      vel: { x: 0, y: 0 },
      visual: {
        mainThrusters: cloneProbeThrusters(ship?.visual?.mainThrusters),
        torqueThrusters: cloneProbeThrusters(ship?.visual?.torqueThrusters)
      },
      thrusterInput: { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 }
    };
    holder._probe = probe;
    holder._probeGeometry = geometry;
    holder._probeShip = ship;
  }
  probe.mass = mass;
  return probe;
}

function cloneProbeThrusters(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    offset: { x: Number(t?.offset?.x) || 0, y: Number(t?.offset?.y) || 0 },
    baseDeg: t?.baseDeg,
    nozzleDeg: t?.baseDeg,
    mount: t?.mount,
    side: t?.side,
    gimbalMinDeg: t?.gimbalMinDeg,
    gimbalMaxDeg: t?.gimbalMaxDeg
  }));
}

function settleProbeThrusters(list) {
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    t.__throttle = clamp01(t.__throttleTarget);
    if (Number.isFinite(Number(t.__nozzleTargetDeg))) t.nozzleDeg = t.__nozzleCurrentDeg = Number(t.__nozzleTargetDeg);
    t.__forceScale = Number.isFinite(Number(t.__forceScaleTarget)) ? Number(t.__forceScaleTarget) : 1;
    t.__turnWeight = Number(t.__turnWeightTarget) || 0;
  }
}

const _probeForces = { localFx: 0, localFy: 0, localTorque: 0 };
function measureSteadyStrafeTorque(probe, leftSide, rightSide, torque, mainForceMul, sideForceMul) {
  const input = probe.thrusterInput;
  input.main = 0;
  input.leftSide = 0;
  input.rightSide = 0;
  input.retro = 0;
  input.torque = 0;
  composeShipThrusterCommand(probe, { torque, leftSide, rightSide, mainTorque: 0, suppressManualTorque: true });
  settleProbeThrusters(probe.visual.mainThrusters);
  settleProbeThrusters(probe.visual.torqueThrusters);
  computeShipThrusterForces(probe, { mainForceMul, sideForceMul, reverseInput: 0 }, _probeForces);
  return _probeForces.localTorque;
}

function measureSteadyTurnTorque(probe, torque, mainTorque, throttle, mainForceMul, sideForceMul) {
  const input = probe.thrusterInput;
  input.main = throttle;
  input.leftSide = 0;
  input.rightSide = 0;
  input.retro = 0;
  input.torque = 0;
  composeShipThrusterCommand(probe, { torque, leftSide: 0, rightSide: 0, mainTorque, suppressManualTorque: true });
  settleProbeThrusters(probe.visual.mainThrusters);
  settleProbeThrusters(probe.visual.torqueThrusters);
  computeShipThrusterForces(probe, { mainForceMul, sideForceMul, reverseInput: 0 }, _probeForces);
  return _probeForces.localTorque;
}

function sumThrusterGeometry(list, salt) {
  if (!list) return salt;
  let sum = list.length * 1009 * salt;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    sum += (i + 1 + salt * 101) * (
      (Number(t?.offset?.x) || 0) * 1.31
      + (Number(t?.offset?.y) || 0) * 1.77
      + (Number(t?.baseDeg) || 0) * 0.37
    );
  }
  return sum;
}

// Tania sygnatura rozmieszczenia dysz (edytor hardpointów może je przesunąć).
function thrusterGeometrySignature(ship) {
  return sumThrusterGeometry(ship?.visual?.mainThrusters, 1)
    + sumThrusterGeometry(ship?.visual?.torqueThrusters, 2)
    + (Number(ship?.w) || 0) * 0.013 + (Number(ship?.h) || 0) * 0.017;
}

// Czasooptymalny regulator kursu: zadana prędkość obrotu to profil hamowania
// sqrt(2·a·kąt) (z zapasem i poprawką na opóźnienie dysz), przy samym celu
// liniowa — więc statek rozpędza się, hamuje dokładnie na czas i dochodzi do
// celu jednym ruchem. Moment (−1..1) śledzi zadaną prędkość ze stałą czasową
// `trackTime`. Wymaga PRAWDZIWEJ zdolności obrotu (resolveShipTurnCapability).
// `headingError` NIE jest zawijany — kurs zadany wprost podaje wrapAngle(),
// a stabilizator może zlecić obrót dalszy niż 180° w jedną stronę.
// `targetRate` — z jaką prędkością kątową obraca się sam cel (np. styczna
// orbity): profil liczymy względem celu, bez tego kurs stale zostawał w tyle.
export function computeHeadingTorqueCommand({
  headingError,
  omega,
  turnAccel,
  maxTurnRate,
  targetRate = 0,
  lagTime = HEADING_THRUSTER_LAG,
  brakeMargin = HEADING_BRAKE_MARGIN,
  fineAngle = 0.03,
  trackTime = 0.25,
  torqueLimit = 1
} = {}) {
  const e = Number(headingError) || 0;
  const ae = Math.abs(e);
  const wAbs = Number(omega) || 0;
  const wTarget = Number(targetRate) || 0;
  const w = wAbs - wTarget;
  const a = Math.max(1e-4, Number(turnAccel) || 0);
  const limit = Math.max(0, Number(torqueLimit) || 0);
  // Z limitem momentu < 1 hamujemy słabiej — profil musi to wiedzieć, inaczej
  // zaplanuje hamowanie, na które nie starczy dysz.
  const aBrake = a * clamp(brakeMargin, 0.3, 1) * Math.min(1, Math.max(0.05, limit));
  const wMax = Math.max(1e-3, Number(maxTurnRate) || 1);
  const lag = Math.max(0, Number(lagTime) || 0);
  // Kąt przejechany, zanim dysze zdążą odwrócić ciąg — tyle mniej miejsca na hamowanie.
  const lead = Math.abs(w) * lag;
  const room = Math.max(0, ae - lead);
  // Końcówka liniowa (bez przełączania bang-bang przy samym celu); wzmocnienie
  // ograniczone opóźnieniem dysz i nadążaniem pętli prędkości (trackTime) —
  // zwrotne fregaty z samym limitem od opóźnienia drgały przy celu.
  const kLin = Math.min(
    Math.sqrt((2 * aBrake) / Math.max(1e-4, fineAngle)),
    0.5 / Math.max(1e-3, lag),
    0.5 / Math.max(1e-3, trackTime)
  );
  const wProfile = Math.sqrt(2 * aBrake * room);
  const wLinear = kLin * ae;
  const sign = e < 0 ? -1 : (e > 0 ? 1 : 0);
  const towardTarget = w * sign > 0;
  let wDes;
  // Sprzężenie w przód: na krzywej hamowania profil SAM zwalnia z tempem aBrake
  // (w strefie liniowej: kLin·ω). Moment potrzebny do nadążania za nim dajemy
  // wprost — sam człon proporcjonalny zostawiał stały uchyb (~a·trackTime)
  // i statek dojeżdżał do celu z resztką prędkości.
  let feedForward = 0;
  if (wMax <= wProfile && wMax <= wLinear) {
    wDes = wMax;
  } else if (wProfile <= wLinear) {
    wDes = wProfile;
    if (towardTarget) feedForward = -aBrake / a;
  } else {
    wDes = wLinear;
    if (towardTarget) feedForward = -(kLin * Math.abs(w)) / a;
  }
  wDes *= sign;
  feedForward *= sign;
  const wDesAbs = clamp(wDes + wTarget, -wMax, wMax);
  const torque = clamp(feedForward + (wDesAbs - wAbs) / (a * Math.max(1e-3, trackTime)), -limit, limit);
  return {
    torque,
    desiredOmega: wDesAbs,
    stoppingAngle: (w * w) / (2 * aBrake) + lead,
    braking: w !== 0 && torque !== 0 && Math.sign(torque) === -Math.sign(w)
  };
}

// Kąt, o który statek jeszcze się obróci, zanim wyhamuje obrót (z zapasem
// planowania i opóźnieniem dysz) — do pilnowania, żeby cel nie stał bliżej.
export function computeTurnStoppingAngle(omega, turnAccel, lagTime = HEADING_THRUSTER_LAG, brakeMargin = HEADING_BRAKE_MARGIN) {
  const w = Math.abs(Number(omega) || 0);
  const aBrake = Math.max(1e-4, (Number(turnAccel) || 0) * clamp(brakeMargin, 0.3, 1));
  return (w * w) / (2 * aBrake) + w * Math.max(0, Number(lagTime) || 0);
}

export function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function computeStoppingAngle(omega, brakeAccel) {
  const absOmega = Math.abs(Number(omega) || 0);
  const accel = Math.max(0.05, Number(brakeAccel) || 0.05);
  return (absOmega * absOmega) / (2 * accel);
}

export function computePlannedHeadingTorque(options = {}) {
  const headingError = wrapAngle(options.headingError);
  const omega = Number(options.omega) || 0;
  const absError = Math.abs(headingError);
  const errorSign = Math.sign(headingError);
  const maxTurnSpeed = Math.max(0.08, Number(options.maxTurnSpeed) || 2.2);
  const torqueLimit = Math.max(0, Number(options.torqueLimit) || 1);
  const brakeAccel = Math.max(0.1, Number(options.brakeAccel) || 3.2);
  const leadTime = Math.max(0.08, Number(options.leadTime) || 0.26);
  const profileScale = clamp(options.profileScale ?? 0.92, 0.25, 1.25);
  const fineAngle = Math.max(0, Number(options.fineAngle) || 0.08);
  const fineSpeed = Math.max(0, Number(options.fineSpeed) || 0.08);
  const settleAngle = Math.max(0, Number(options.settleAngle) || 0.0015);
  const settleOmega = Math.max(0, Number(options.settleOmega) || 0.0012);
  const minCounterTorque = clamp(options.minCounterTorque ?? 0.18, 0, torqueLimit);

  if (torqueLimit <= 0 || (absError <= settleAngle && Math.abs(omega) <= settleOmega)) {
    return {
      torque: 0,
      desiredOmega: 0,
      stoppingAngle: computeStoppingAngle(omega, brakeAccel),
      braking: false
    };
  }

  const safeError = Math.max(0, absError - settleAngle);
  const profileSpeed = Math.sqrt(2 * brakeAccel * safeError) * profileScale;
  const fineProfileSpeed = fineAngle > 1e-6 && absError < fineAngle
    ? fineSpeed * clamp(absError / fineAngle, 0, 1)
    : maxTurnSpeed;
  const desiredSpeed = Math.min(maxTurnSpeed, profileSpeed, fineProfileSpeed);
  const desiredOmega = errorSign === 0 ? 0 : errorSign * desiredSpeed;
  const speedError = desiredOmega - omega;
  let torque = clamp(speedError / (brakeAccel * leadTime), -torqueLimit, torqueLimit);

  const stoppingAngle = computeStoppingAngle(omega, brakeAccel);
  const omegaSign = Math.sign(omega);
  const movingTowardTarget = errorSign !== 0 && omegaSign === errorSign;
  const braking = movingTowardTarget && Math.abs(omega) > desiredSpeed + 0.015;
  if (braking && Math.sign(torque) === -omegaSign) {
    const overspeed = Math.abs(omega) - desiredSpeed;
    const overspeedNorm = clamp(overspeed / Math.max(0.25, maxTurnSpeed * 0.45), 0, 1);
    const brakeFloor = Math.min(torqueLimit, minCounterTorque + overspeedNorm * 0.55);
    torque = -omegaSign * Math.max(Math.abs(torque), brakeFloor);
  }

  return {
    torque,
    desiredOmega,
    stoppingAngle,
    braking
  };
}
