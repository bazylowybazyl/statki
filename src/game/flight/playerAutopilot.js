// src/game/flight/playerAutopilot.js
// Command-level player autopilot. Produces player input/thruster targets; does not integrate physics.

import { SHIP_PHYSICS, estimateShipTurnAcceleration } from './thrusterModel.js';
import {
  compensateStrafeYaw,
  computeHeadingTorqueCommand,
  computePlannedHeadingTorque,
  strafeUsableForCapability,
  wrapAngle
} from './headingControl.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const lerp = (a, b, t) => a + (b - a) * t;

// Komendy lotu statku gracza (z turnCapability) — patrz computePlayerCommandControl.
const APPROACH_MAX_LEAD = 0.35;
const APPROACH_LEAD_REF_SPEED = 300;
const APPROACH_ALIGN_ZERO_COS = Math.cos(15 * Math.PI / 180);
const APPROACH_ALIGN_FULL_COS = Math.cos(3 * Math.PI / 180);
// Retro poniżej tej prędkości przełącza się na ciąg wsteczny (thrusterModel:
// RETRO_REVERSE_ENGAGE_SPEED 22, zwolnienie przy 44) — to już napęd, nie hamulec.
const APPROACH_RETRO_MIN_SPEED = 45;
// Strefa końcowa dolotu (ponad promień dolotu) i największy namiar, przy
// którym jeszcze nie obracamy dziobu.
const APPROACH_FINAL_ZONE = 350;
const APPROACH_FINAL_MAX_BEARING = (60 * Math.PI) / 180;
// Jaką część maks. prędkości obrotu może zająć lot po orbicie.
const ORBIT_TURN_RATE_SHARE = 0.5;
// Jaką część ciągu głównego może zająć przyspieszenie dośrodkowe orbity.
const ORBIT_CENTRIPETAL_SHARE = 0.45;
const ORBIT_BRAKE_ALIGN_COS = Math.cos((50 * Math.PI) / 180);
// Orbita-pościg: punkt goniony na okręgu co najmniej tyle promienia przed statkiem.
// Orbita bez strafe'u: przy błędzie promienia ORBIT_VECTOR_ERR_SAT·r korekta
// promienia zajmuje ORBIT_VECTOR_RADIAL_SHARE ciągu głównego; nos zawsze
// co najmniej ORBIT_VECTOR_MIN_INWARD·ciąg do środka (bez przewrotek na zewnątrz).
const ORBIT_VECTOR_ERR_SAT = 0.15;
const ORBIT_VECTOR_RADIAL_SHARE = 0.5;
const ORBIT_VECTOR_MIN_INWARD = 0.15;
const ORBIT_VECTOR_TANGENT_TAU = 2.0;
const ORBIT_VECTOR_TANGENT_SHARE = 0.6;
// Orbita-pościg (kadłub skręcający silnikami głównymi): punkt goniony na
// okręgu co najmniej tyle promienia przed statkiem; korekta jego promienia.
const ORBIT_PURSUIT_MIN_ARC = 0.35;
const ORBIT_PURSUIT_RADIAL_GAIN = 0.5;
// Kadłub skręcający silnikami głównymi: od tej odchyłki kursu obraca się
// w miejscu (tłumik trzyma pozycję), poniżej koryguje kurs w locie.
const VECTOR_TURN_IN_PLACE_ERROR = (30 * Math.PI) / 180;
// Najmniejszy „zły" dryf (w bok / od celu), który hamuje tłumik.
const LOW_SPEED_DRIFT_MIN = 8;
// Postój: tłumik zeruje prędkość poniżej ~0,5 u/s (physicsStep).
const HOLD_STOP_SPEED = 2;
const HOLD_SETTLE_OMEGA = 0.0005;

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function computeApproachForwardGate(headingError, omega) {
  const headingAlignment = Math.max(0, Math.cos(headingError));
  const headingGate = smoothstep01((headingAlignment - 0.82) / 0.18);
  const spinGate = 1 - smoothstep01((Math.abs(Number(omega) || 0) - 0.18) / 0.48);
  return headingGate * spinGate;
}

function resolveShipBrakeAccel(ship, fallbackBrakeAccel) {
  const fallback = Math.max(0.1, Number(fallbackBrakeAccel) || 0.1);
  const positiveTurnAccel = estimateShipTurnAcceleration(ship, 1);
  const negativeTurnAccel = estimateShipTurnAcceleration(ship, -1);
  const measured = Math.min(
    positiveTurnAccel > 1e-4 ? positiveTurnAccel : Infinity,
    negativeTurnAccel > 1e-4 ? negativeTurnAccel : Infinity
  );
  if (!Number.isFinite(measured) || measured <= 1e-4) return fallback;
  return Math.min(fallback, Math.max(0.08, measured * 0.72));
}

// Moment kursu z PRAWDZIWEJ zdolności obrotu (resolveShipTurnCapability):
// profil hamowania liczony z tym samym przyspieszeniem kątowym, które całkuje
// fizyka gracza — obrót kończy się jednym ruchem, bez kiwania wokół kursu.
function capabilityHeadingTorque(capability, headingError, omega, torqueLimit = 1, targetRate = 0) {
  return computeHeadingTorqueCommand({
    headingError,
    omega,
    turnAccel: capability.accel,
    maxTurnRate: capability.maxRate,
    targetRate,
    lagTime: capability.lag,
    torqueLimit
  }).torque;
}

function getEntityPos(entity) {
  return {
    x: Number(entity?.pos?.x ?? entity?.x) || 0,
    y: Number(entity?.pos?.y ?? entity?.y) || 0
  };
}

function getCommandTargetPos(cmd) {
  if (!cmd) return null;
  const ent = cmd.targetEntity;
  if (ent && !ent.dead && !ent.destroyed && !ent.removed) return getEntityPos(ent);
  if (cmd.target && Number.isFinite(cmd.target.x) && Number.isFinite(cmd.target.y)) {
    return cmd.target;
  }
  return null;
}

function computeOrbitSteerVector(ship, center, orbitRadius, orbitDir = 1) {
  const pos = getEntityPos(ship);
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const radialX = dx / dist;
  const radialY = dy / dist;
  const tangentSign = orbitDir >= 0 ? 1 : -1;
  const tangentX = -radialY * tangentSign;
  const tangentY = radialX * tangentSign;
  const radius = Math.max(80, Number(orbitRadius) || 900);
  const radialError = dist - radius;
  const absError = Math.abs(radialError);
  const radialCorrection = clamp(-radialError / Math.max(radius * 0.12, 220), -1.35, 1.35);
  const tangentWeight = lerp(
    1.0,
    0.12,
    smoothstep01(absError / Math.max(radius * 0.45, 700))
  );
  const desiredX = tangentX * tangentWeight + radialX * radialCorrection;
  const desiredY = tangentY * tangentWeight + radialY * radialCorrection;
  const len = Math.max(1e-6, Math.hypot(desiredX, desiredY));
  return {
    dirX: desiredX / len,
    dirY: desiredY / len,
    tangentX,
    tangentY,
    orbitDir: tangentSign,
    dist,
    radius,
    radialError,
    absError
  };
}

// `turnCapability` (resolveShipTurnCapability) — prawdziwa zdolność obrotu
// statku gracza. Bez niej zostaje stary szacunek (ścieżka NPC w npcFlight.js).
export function computePlayerHoldControl(ship, physics = SHIP_PHYSICS, faceAngle = null, turnCapability = null) {
  const angle = Number(ship?.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const vel = ship?.vel || { x: ship?.vx || 0, y: ship?.vy || 0 };
  const forwardVel = ((Number(vel.x) || 0) * cosA) + ((Number(vel.y) || 0) * sinA);
  const lateralVel = -((Number(vel.x) || 0) * sinA) + ((Number(vel.y) || 0) * cosA);
  const speed = Math.hypot(Number(vel.x) || 0, Number(vel.y) || 0);
  const maxTurn = Math.max(0.06, (Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED) * 0.28);
  const omega = Number(ship?.angVel) || 0;
  const hasFaceAngle = Number.isFinite(faceAngle);
  const headingError = hasFaceAngle ? wrapAngle(faceAngle - angle) : 0;
  if (turnCapability) {
    // Postój statku gracza. Hamuje tłumik (thrustY < 0 → physicsStep), przy
    // większej prędkości z retro — retro celuje przeciw całej prędkości, więc
    // hamuje też ruch wstecz i w bok (dawniej ruch wstecz hamowały same silniki
    // główne, bez tłumika). Poniżej ~22 u/s retro przełącza się na ciąg
    // wsteczny i odpychałoby statek — końcówkę robi sam tłumik, a dysze boczne
    // zostają wolne do obrotu. Stary próg „stoi” 28 u/s zostawiał dryf na km.
    const retro = speed > APPROACH_RETRO_MIN_SPEED ? clamp(speed / 520, 0.15, 1) : 0;
    // Bez zadanego kursu uchyb 0 = samo wygaszenie obrotu, bez cofania się.
    const holdTorque = capabilityHeadingTorque(turnCapability, headingError, omega, 1);
    // Ciasne progi: fizyka gracza nie ma tarcia kątowego, więc resztka obrotu
    // zostawiona przy „stoi” kręciła statkiem bez końca.
    const holdAngularSettled = Math.abs(omega) < HOLD_SETTLE_OMEGA
      && (!hasFaceAngle || Math.abs(headingError) < 0.0045);
    const settled = speed <= HOLD_STOP_SPEED && holdAngularSettled;
    return {
      controller: 'player',
      thrustY: settled ? 0 : -1,
      main: 0,
      retro,
      torque: holdTorque,
      leftSide: 0,
      rightSide: 0,
      settled,
      rotationStopped: Math.abs(omega) < HOLD_SETTLE_OMEGA
    };
  }
  const torque = hasFaceAngle
    ? computePlannedHeadingTorque({
      headingError,
      omega,
      maxTurnSpeed: Math.max(0.45, (Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED) * 0.72),
      brakeAccel: resolveShipBrakeAccel(ship, Math.max(1.0, (Number(physics?.TURN_ACCEL) || SHIP_PHYSICS.TURN_ACCEL) * 0.16)),
      torqueLimit: 0.6,
      leadTime: 0.28,
      profileScale: 0.9,
      minCounterTorque: 0.22
    }).torque
    : clamp(-omega / maxTurn, -0.6, 0.6);
  const retro = clamp(Math.max(0, forwardVel) / 520, 0, 1);
  const main = clamp(Math.max(0, -forwardVel) / 460, 0, 0.65);
  const rightSide = clamp(Math.max(0, lateralVel) / 360, 0, 1);
  const leftSide = clamp(Math.max(0, -lateralVel) / 360, 0, 1);
  const angularSettled = hasFaceAngle
    ? Math.abs(omega) < 0.0016 && Math.abs(headingError) < 0.0045
    : Math.abs(omega) < 0.003;
  return {
    controller: 'player',
    thrustY: retro > 0.05 ? -retro : main,
    main,
    retro,
    torque,
    leftSide,
    rightSide,
    settled: speed < 28 && angularSettled
  };
}

function commandTuning(type) {
  if (type === 'ram') {
    return {
      maxSpeed: 3600,
      speedK: 1.8,
      velocityTau: 0.45,
      arrivalBrake: 0,
      stopAccelScale: 0,
      stopLeadTime: 0,
      stopSpeedScale: 1
    };
  }
  if (type === 'approach') {
    return {
      maxSpeed: 3200,
      speedK: 1.55,
      velocityTau: 0.55,
      arrivalBrake: 1.0,
      stopAccelScale: 5.6,
      stopLeadTime: 0.12,
      stopSpeedScale: 1.0
    };
  }
  if (type === 'orbit') {
    return {
      maxSpeed: 2600,
      minTangentSpeed: 720,
      speedK: 1.2,
      velocityTau: 0.46,
      arrivalBrake: 0.0
    };
  }
  return { maxSpeed: 940, speedK: 0.72, velocityTau: 0.68, arrivalBrake: 1.0 };
}

function computeLinearStopAccel(tuning) {
  return Math.max(140, SHIP_PHYSICS.SPEED * (Number(tuning?.stopAccelScale) || 0.9));
}

function computeCommandSpeedBudget(cmdType, dist, arrival, tuning) {
  if (cmdType === 'orbit') return tuning.maxSpeed;
  if (cmdType === 'ram') return tuning.maxSpeed;

  const remaining = Math.max(0, dist - arrival);
  let budget = clamp(remaining * tuning.speedK, 0, tuning.maxSpeed);
  if (cmdType !== 'approach') return budget;

  const stopAccel = computeLinearStopAccel(tuning);
  const leadTime = Math.max(0, Number(tuning.stopLeadTime) || 0);
  const stopScale = Math.max(0.1, Number(tuning.stopSpeedScale) || 1);
  const safeStopSpeed = Math.max(0, Math.sqrt(2 * stopAccel * remaining) - (stopAccel * leadTime)) * stopScale;
  budget = Math.min(budget, safeStopSpeed);
  return clamp(budget, 0, tuning.maxSpeed);
}

function computeOrbitSpeedBudget(orbit, tuning) {
  const radius = Math.max(80, Number(orbit?.radius) || 900);
  const absError = Math.max(0, Number(orbit?.absError) || 0);
  const maxSpeed = Math.max(720, Number(tuning?.maxSpeed) || 2600);
  const minTangentSpeed = Math.max(360, Number(tuning?.minTangentSpeed) || 720);
  const sustainableTangent = clamp(
    Math.sqrt(radius * SHIP_PHYSICS.SPEED * 0.62),
    minTangentSpeed,
    maxSpeed
  );
  const radialRunSpeed = clamp(absError * (Number(tuning?.speedK) || 1.2), 0, maxSpeed);
  const radialT = smoothstep01(absError / Math.max(radius * 0.18, 450));
  return clamp(lerp(sustainableTangent, Math.max(sustainableTangent, radialRunSpeed), radialT), minTangentSpeed, maxSpeed);
}

// `guided` (statek gracza): { damperBrake, retroBrake, headingRate } — hamowanie
// liczone względem prędkości, nie osi dziobu, i prędkość obrotu samego kursu
// zadanego (styczna orbity) — patrz computePlayerCommandControl.
function makeControlFromLocalAccel(ship, localAx, localAy, headingError, preferStrafeHeading, turnCapability = null, guided = null) {
  // Statek gracza: gaz liczony z prawdziwego ciągu (sonda dysz), nie ze stałej
  // SPEED·1,05 — Atlas bojowo ma 182 u/s² zamiast 630, więc ciągłe sterowanie
  // (orbita) dawało ~3× za mały ciąg i ustalało się na złym promieniu.
  const forwardAccelScale = turnCapability && Number(turnCapability.mainAccel) > 1
    ? Number(turnCapability.mainAccel)
    : SHIP_PHYSICS.SPEED * 1.05;
  const retroAccelScale = SHIP_PHYSICS.SPEED * 0.85;
  const sideAccelScale = turnCapability && Number(turnCapability.strafeAccel) > 1
    ? Number(turnCapability.strafeAccel)
    : SHIP_PHYSICS.SPEED * 0.9;
  const main = clamp(localAx / forwardAccelScale, 0, 1);
  const retro = guided
    ? clamp((Number(guided.retroBrake) || 0) / retroAccelScale, 0, 1)
    : clamp(-localAx / retroAccelScale, 0, 1);
  const leftSide = clamp(localAy / sideAccelScale, 0, 1);
  const rightSide = clamp(-localAy / sideAccelScale, 0, 1);
  const omega = Number(ship?.angVel) || 0;
  if (turnCapability) {
    const torque = capabilityHeadingTorque(
      turnCapability, headingError, omega, preferStrafeHeading ? 0.65 : 1.0, Number(guided?.headingRate) || 0
    );
    // Te same dysze boczne obracają statek i dają strafe; strafe w trakcie
    // obrotu zabiera mu ~2/3 momentu i regulator nie wyhamowałby na czas.
    // Obrót ma pierwszeństwo, dryf w bok kasujemy przy ustalonym kursie.
    const strafeRoom = 1 - smoothstep01(Math.abs(torque) / 0.25);
    if (guided?.damperBrake) {
      // Sam tłumik (thrustY < 0 bez retro — physicsStep): zatrzymuje dryf
      // w każdym kierunku i nie zajmuje dysz, które obracają statek.
      return { controller: 'player', thrustY: -1, main: 0, retro: 0, torque, leftSide: 0, rightSide: 0 };
    }
    const leftOut = leftSide * strafeRoom;
    const rightOut = rightSide * strafeRoom;
    return {
      controller: 'player',
      thrustY: retro > 0.05 ? -retro : main,
      main,
      retro,
      torque: compensateStrafeYaw(turnCapability, torque, leftOut, rightOut),
      leftSide: leftOut,
      rightSide: rightOut
    };
  }
  const maxTurnSpeed = Math.max(0.4, SHIP_PHYSICS.MAX_TURN_SPEED * (preferStrafeHeading ? 0.38 : 0.9));
  const brakeAccel = resolveShipBrakeAccel(
    ship,
    Math.max(0.9, SHIP_PHYSICS.TURN_ACCEL * (preferStrafeHeading ? 0.14 : 0.16))
  );
  const torqueLimit = preferStrafeHeading ? 0.65 : 1.0;
  const torque = computePlannedHeadingTorque({
    headingError,
    omega,
    maxTurnSpeed,
    brakeAccel,
    torqueLimit,
    leadTime: preferStrafeHeading ? 0.24 : 0.28,
    profileScale: preferStrafeHeading ? 0.8 : 0.92,
    minCounterTorque: preferStrafeHeading ? 0.16 : 0.24
  }).torque;
  return {
    controller: 'player',
    thrustY: retro > 0.05 ? -retro : main,
    main,
    retro,
    torque,
    leftSide,
    rightSide
  };
}

export function computePlayerCommandControl(ship, cmd, options = {}) {
  if (!ship || !cmd) {
    return { control: null, nextCommand: null, clearCommand: true };
  }
  const isRam = cmd.type === 'ram';
  const turnCapability = options.turnCapability || null;
  // Czy kadłub umie przesunąć się w bok bez skręcania. Nie: Bellator (same
  // silniki główne) oraz Custos (dysza strafe'u to dysza obrotu) — te
  // nie dostają strafe'u, pełzania ani orbity bokiem.
  const strafeUsable = !!turnCapability && strafeUsableForCapability(turnCapability);

  if (cmd.type === 'hold') {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS, cmd.faceAngle, turnCapability);
    // Postój bez zadanego kursu: gdy obrót wygasł, trzymamy kurs, na którym
    // statek stanął — inaczej nic nie pilnuje go przed powolnym dryfem.
    const lockHeading = turnCapability && !Number.isFinite(cmd.faceAngle) && hold.rotationStopped;
    return {
      control: hold.settled
        ? { controller: 'player', main: 0, thrustY: 0, torque: 0, leftSide: 0, rightSide: 0, retro: 0 }
        : hold,
      nextCommand: lockHeading ? { ...cmd, faceAngle: wrapAngle(Number(ship.angle) || 0) } : null,
      clearCommand: false
    };
  }

  const targetPos = getCommandTargetPos(cmd);
  if (!targetPos) {
    return { control: null, nextCommand: null, clearCommand: true };
  }

  const pos = getEntityPos(ship);
  let desiredVecX = targetPos.x - pos.x;
  let desiredVecY = targetPos.y - pos.y;
  let dist = Math.hypot(desiredVecX, desiredVecY);
  let orbitNav = null;
  const arrival = Number(cmd.arrival) || Number(options.defaultArrival) || 90;
  const arrivalVel = ship.vel || { x: ship.vx || 0, y: ship.vy || 0 };
  const arrivalSpeed = Math.hypot(Number(arrivalVel.x) || 0, Number(arrivalVel.y) || 0);
  const arrivalSlack = Math.max(6, Math.min(24, arrival * 0.1));
  const arrived = dist <= arrival || (dist <= arrival + arrivalSlack && arrivalSpeed < 32);

  // Statek gracza okrąża cel dziobem do środka: kurs obraca się tylko o v/r,
  // wokół niesie strafe, a promień trzyma ciąg główny — w tej pozycji to wprost
  // przyspieszenie dośrodkowe. Lot dziobem naprzód wymagał ciągłych zakrętów
  // pod korektę promienia i ciężki kadłub kiwał dziobem nawet o ±100°.
  const strafeOrbit = cmd.type === 'orbit' && strafeUsable;
  // Kadłub bez strafe'u, ale z dyszami obrotu (Custos), też okrąża cel
  // nosem do środka — przyspieszenie styczne daje pochyleniem nosa (niżej).
  const vectorOrbit = cmd.type === 'orbit' && !!turnCapability && !strafeUsable && !turnCapability.mainAssist;
  // Kadłub skręcający silnikami głównymi (Bellator) każdą korektą kursu dokłada
  // ciągu wzdłuż nosa — z nosem do środka ściągałoby go z orbity. Leci nosem
  // wzdłuż toru i goni punkt na okręgu przed sobą.
  const pursuitOrbit = cmd.type === 'orbit' && !!turnCapability && !strafeUsable && !!turnCapability.mainAssist;
  if (cmd.type === 'orbit') {
    orbitNav = computeOrbitSteerVector(ship, targetPos, cmd.orbitRadius, cmd.orbitDir);
    if (pursuitOrbit) {
      const turnTime = 2 * Math.sqrt(0.5 / Math.max(1e-3, 0.8 * turnCapability.accel));
      const lookahead = Math.max(orbitNav.radius * ORBIT_PURSUIT_MIN_ARC, arrivalSpeed * turnTime * 2, 400);
      const carrotAngle = Math.atan2(pos.y - targetPos.y, pos.x - targetPos.x)
        + orbitNav.orbitDir * Math.min(1.2, lookahead / orbitNav.radius);
      // Pościg bez poślizgu bocznego ustala się na większym okręgu — punkt
      // gonimy na okręgu pomniejszonym o bieżący błąd promienia.
      const carrotRadius = orbitNav.radius
        - clamp(orbitNav.radialError, -0.5 * orbitNav.radius, 0.5 * orbitNav.radius) * ORBIT_PURSUIT_RADIAL_GAIN;
      desiredVecX = targetPos.x + Math.cos(carrotAngle) * carrotRadius - pos.x;
      desiredVecY = targetPos.y + Math.sin(carrotAngle) * carrotRadius - pos.y;
    } else {
      desiredVecX = orbitNav.dirX;
      desiredVecY = orbitNav.dirY;
    }
    dist = orbitNav.dist;
  } else if (!isRam && arrived) {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS, null, turnCapability);
    const nextCommand = Number.isFinite(cmd.faceAngle)
      ? { type: 'hold', faceAngle: cmd.faceAngle }
      : { type: 'hold' };
    return {
      control: hold.settled
        ? { controller: 'player', main: 0, thrustY: 0, torque: 0, leftSide: 0, rightSide: 0, retro: 0 }
        : hold,
      nextCommand,
      clearCommand: false
    };
  }

  const angle = Number(ship.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const vel = ship.vel || { x: ship.vx || 0, y: ship.vy || 0 };
  const vx = Number(vel.x) || 0;
  const vy = Number(vel.y) || 0;
  const localTargetX = desiredVecX * cosA + desiredVecY * sinA;
  const localTargetY = -desiredVecX * sinA + desiredVecY * cosA;
  const lateralRatio = Math.abs(localTargetY) / Math.max(1, Math.abs(localTargetX) + Math.abs(localTargetY));
  const closeStrafeT = 1 - smoothstep01((dist - 260) / 1500);
  const allowStrafeHeading = (cmd.type === 'move' || cmd.preferStrafeHeading === true)
    && (!turnCapability || strafeUsable);
  const preferStrafeHeading = allowStrafeHeading && closeStrafeT > 0.05 && lateralRatio > 0.42 && Math.abs(localTargetY) > 120;

  const len = Math.max(1e-6, Math.hypot(desiredVecX, desiredVecY));
  const dirX = desiredVecX / len;
  const dirY = desiredVecY / len;
  const tuning = commandTuning(cmd.type);
  let speedBudget = cmd.type === 'orbit'
    ? computeOrbitSpeedBudget(orbitNav, tuning)
    : computeCommandSpeedBudget(cmd.type, dist, arrival, tuning);
  if (turnCapability && Number.isFinite(turnCapability.speedLimit)) {
    // Szybciej i tak nie pozwoli governor trybu napędu — zadana prędkość ponad
    // limit kazała orbicie bez końca dopychać ciąg styczny i zjeżdżała z promienia.
    speedBudget = Math.min(speedBudget, 0.95 * turnCapability.speedLimit);
  }
  if (cmd.type === 'orbit' && turnCapability) {
    // Lot po okręgu to stały obrót v/r i przyspieszenie dośrodkowe v²/r.
    // Ciężki kadłub nie nadąży ponad część swojej maks. prędkości obrotu ani
    // ciągu głównego (dawny budżet zakładał ~370 u/s², Atlas ma 140–180).
    const mainAccel = Math.max(1, Number(turnCapability.mainAccel) || SHIP_PHYSICS.SPEED);
    speedBudget = Math.min(
      speedBudget,
      ORBIT_TURN_RATE_SHARE * turnCapability.maxRate * orbitNav.radius,
      Math.sqrt(ORBIT_CENTRIPETAL_SHARE * mainAccel * orbitNav.radius)
    );
  }
  const desiredVx = dirX * speedBudget;
  const desiredVy = dirY * speedBudget;
  const tau = Math.max(0.18, tuning.velocityTau);
  let desiredAx = (desiredVx - vx) / tau;
  let desiredAy = (desiredVy - vy) / tau;
  if (cmd.type === 'orbit' && turnCapability) {
    // Lot po okręgu potrzebuje stale v²/r do środka — sam regulator prędkości
    // dawał je dopiero ze stałym odsunięciem promienia (~500 u przy r=3000).
    const tangentSpeed = (vx * orbitNav.tangentX) + (vy * orbitNav.tangentY);
    const centripetal = (tangentSpeed * tangentSpeed) / Math.max(1, orbitNav.dist);
    desiredAx += ((targetPos.x - pos.x) / Math.max(1, orbitNav.dist)) * centripetal;
    desiredAy += ((targetPos.y - pos.y) / Math.max(1, orbitNav.dist)) * centripetal;
  }
  let orbitAimX = 0;
  let orbitAimY = 0;
  if (vectorOrbit) {
    // Układ biegunowy: do środka v²/r plus PD na błąd promienia (to zmienia
    // tylko siłę ciągu, nos nie musi się obracać), stycznie pętla prędkości
    // (to daje lekkie pochylenie nosa). Ciąg główny działa tylko naprzód, więc
    // nos zostaje skierowany do środka — korekta na zewnątrz = mniej ciągu.
    const d = Math.max(1, orbitNav.dist);
    const outX = (pos.x - targetPos.x) / d;
    const outY = (pos.y - targetPos.y) / d;
    const radialVel = vx * outX + vy * outY;
    const tangentVel = vx * orbitNav.tangentX + vy * orbitNav.tangentY;
    const aMax = Math.max(1, Number(turnCapability.mainAccel) || SHIP_PHYSICS.SPEED);
    const kR = ORBIT_VECTOR_RADIAL_SHARE * aMax / Math.max(1, ORBIT_VECTOR_ERR_SAT * orbitNav.radius);
    const dR = 1.6 * Math.sqrt(kR);
    const aR = clamp(-(tangentVel * tangentVel) / d - kR * orbitNav.radialError - dR * radialVel, -aMax, aMax);
    const tangentCap = ORBIT_VECTOR_TANGENT_SHARE * aMax;
    const aT = clamp((speedBudget - tangentVel) / ORBIT_VECTOR_TANGENT_TAU, -tangentCap, tangentCap);
    desiredAx = outX * aR + orbitNav.tangentX * aT;
    desiredAy = outY * aR + orbitNav.tangentY * aT;
    const aimR = Math.min(aR, -ORBIT_VECTOR_MIN_INWARD * aMax);
    orbitAimX = outX * aimR + orbitNav.tangentX * aT;
    orbitAimY = outY * aimR + orbitNav.tangentY * aT;
  }

  if (cmd.type !== 'orbit' && !isRam) {
    const toTargetSpeed = (vx * dirX) + (vy * dirY);
    const stopAccel = computeLinearStopAccel(tuning);
    const leadTime = Math.max(0, Number(tuning.stopLeadTime) || 0);
    const brakeDistance = arrival + Math.max(
      140,
      Math.max(0, toTargetSpeed) * leadTime + (toTargetSpeed * toTargetSpeed) / (2 * stopAccel)
    ) * tuning.arrivalBrake;
    const brakeOverspeed = Math.max(45, speedBudget * 0.82);
    if (toTargetSpeed > brakeOverspeed && dist < brakeDistance) {
      const brakeT = clamp((brakeDistance - dist) / Math.max(brakeDistance - arrival, 1), 0, 1);
      desiredAx -= dirX * (stopAccel * (0.25 + brakeT * 0.75));
      desiredAy -= dirY * (stopAccel * (0.25 + brakeT * 0.75));
    }
  }

  let localAx = desiredAx * cosA + desiredAy * sinA;
  let localAy = -desiredAx * sinA + desiredAy * cosA;
  let desiredHeading = preferStrafeHeading
    ? angle
    : Math.atan2(desiredVecY, desiredVecX);
  // Statek gracza (prawdziwa zdolność obrotu) — wszystkie komendy lotu; NPC
  // (npcFlight.js) zostają na starym sterowaniu niżej.
  const guidedFlight = !!turnCapability;
  // Tuż przy celu namiar ucieka przy każdym metrze bocznego błędu — gonienie
  // go kończyło dolot zbędnym dokręceniem o ~10°. Jak przy dokowaniu: kurs
  // stoi, resztę pozycji robi ciąg wzdłuż dziobu i strafe.
  const finalCreep = guidedFlight && strafeUsable && (cmd.type === 'approach' || cmd.type === 'move')
    && dist < arrival + APPROACH_FINAL_ZONE
    && Math.abs(wrapAngle(desiredHeading - angle)) < APPROACH_FINAL_MAX_BEARING;
  const creep = finalCreep || preferStrafeHeading || strafeOrbit;
  if (strafeOrbit) {
    desiredHeading = Math.atan2(targetPos.y - pos.y, targetPos.x - pos.x);
  } else if (vectorOrbit) {
    desiredHeading = Math.atan2(orbitAimY, orbitAimX);
  } else if (creep) {
    desiredHeading = angle;
  } else if (guidedFlight && !turnCapability.mainAssist) {
    // Nos lekko pod dryf w bok, żeby ciąg główny go kasował, zamiast mijać cel.
    // Nie przy kadłubie skręcającym silnikami głównymi: tam każda korekta kursu
    // sama pcha statek w bok (dysze odchylone o 26° przy pełnym ciągu) i
    // wyprzedzenie zapętlało się z tym dryfem w kiwanie ±10°.
    const crossVel = -vx * dirY + vy * dirX;
    const alongVel = vx * dirX + vy * dirY;
    desiredHeading += clamp(
      Math.atan2(-crossVel, Math.max(Math.abs(alongVel), APPROACH_LEAD_REF_SPEED)),
      -APPROACH_MAX_LEAD,
      APPROACH_MAX_LEAD
    );
  }
  const headingError = wrapAngle(desiredHeading - angle);
  let damperBrake = false;
  let retroBrake = 0;
  let headingRate = 0;
  if (guidedFlight) {
    // Kolejność ciężkiego okrętu: nos na cel, potem ciąg, na końcu retro.
    // Ciąg dopiero przy wyrównanym kursie — przy ~35° odchyłki statek mijał
    // cel bokiem, hamował, obracał się i krążył. Retro tylko hamuje: jako
    // napęd wstecz zajmowało dysze boczne, które wtedy nie obracają statku
    // (cel za rufą = lot tyłem przez cały dystans i przelot przez cel).
    const align = Math.cos(headingError);
    const alignGate = smoothstep01((align - APPROACH_ALIGN_ZERO_COS) / (APPROACH_ALIGN_FULL_COS - APPROACH_ALIGN_ZERO_COS));
    const spinGate = 1 - smoothstep01((Math.abs(Number(ship?.angVel) || 0) - 0.18) / 0.48);
    const speed = Math.hypot(vx, vy);
    localAx = Math.max(0, localAx) * alignGate * spinGate;
    if (cmd.type === 'orbit') {
      // Styczna obraca się z prędkością v_styczna / r — kurs ją śledzi.
      headingRate = ((vx * orbitNav.tangentX) + (vy * orbitNav.tangentY)) / Math.max(1, orbitNav.dist)
        * (orbitNav.orbitDir >= 0 ? 1 : -1);
      // Na orbicie kierunek prędkości stale zostaje trochę za styczną — ten
      // uchyb ma kasować kurs i ciąg, nie hamulec (inaczej każdy zakręt
      // kończył się zatrzymaniem). Hamujemy nadmiar prędkości, a przy orbicie
      // bokiem także ruch mocno obok kursu (> ~50°), którego nie zawróci.
      if (speed >= APPROACH_RETRO_MIN_SPEED) {
        const alongDir = (vx * dirX) + (vy * dirY);
        const offCourse = strafeOrbit && alongDir < speed * ORBIT_BRAKE_ALIGN_COS;
        const overspeed = Math.max(0, speed - speedBudget * 1.1);
        retroBrake = offCourse
          ? Math.max(0, -((desiredAx * vx) + (desiredAy * vy)) / speed)
          : overspeed / Math.max(0.2, tuning.velocityTau);
      }
    } else if (speed >= APPROACH_RETRO_MIN_SPEED) {
      // Retro celuje przeciw CAŁEJ prędkości (thrusterModel: tryb 'brake'), więc
      // to hamulec, nie dysza wstecz: odpalamy je tylko o tyle, o ile zadane
      // przyspieszenie przeciwdziała prędkości. Dawne „składowa wstecz wzdłuż
      // dziobu" hamowało np. strafe w bok i statek pulsował zamiast lecieć.
      retroBrake = Math.max(0, -((desiredAx * vx) + (desiredAy * vy)) / speed);
    }
    if (speed < APPROACH_RETRO_MIN_SPEED && cmd.type !== 'orbit') {
      // Powolny dryf w bok albo od celu: tego nie wyhamuje ani retro (tu już
      // ciąg wsteczny), ani ciąg główny czekający na kurs — statek, który minął
      // cel o włos, odpływał dziesiątki sekund. Hamuje sam tłumik.
      // Przy pełzaniu strafe'em ruch idzie ukosem do celu (strafe działa tylko
      // w poprzek dziobu) — to postęp, nie dryf; hamujemy tylko ruch od celu.
      const alongVel = vx * dirX + vy * dirY;
      const goodVel = Math.max(0, alongVel);
      const wrongSpeed = Math.hypot(vx - dirX * goodVel, vy - dirY * goodVel);
      const drifting = creep
        ? alongVel < -LOW_SPEED_DRIFT_MIN
        : wrongSpeed > Math.max(LOW_SPEED_DRIFT_MIN, speed * 0.5);
      if (drifting) damperBrake = true;
    }
    if (turnCapability.mainAssist && !creep && cmd.type !== 'orbit'
      && Math.abs(headingError) > VECTOR_TURN_IN_PLACE_ERROR) {
      // Kadłub skręca odchyleniem silników głównych (brak dysz bocznych), więc
      // każdy obrót pcha go naprzód — przy nosie daleko od kursu w złą stronę.
      // Przy takim obrocie w miejscu tłumik trzyma pozycję. Nie przy zwykłych
      // korektach w locie (zatrzymywał statek do zera) ani na orbicie.
      damperBrake = true;
    }
    if (!strafeUsable) {
      // Kadłub bez dysz bocznych — strafe'u nie ma.
      localAy = 0;
    } else if (creep) {
      // Strafe prosto z zadanego przyspieszenia: kasuje też boczny błąd pozycji.
      localAy = clamp(localAy, -SHIP_PHYSICS.SPEED * 0.75, SHIP_PHYSICS.SPEED * 0.75);
    } else {
      const lateralVel = (-vx * sinA) + (vy * cosA);
      localAy = clamp(-lateralVel / Math.max(0.2, tuning.velocityTau), -SHIP_PHYSICS.SPEED * 0.75, SHIP_PHYSICS.SPEED * 0.75);
    }
  } else if (cmd.type === 'approach' || isRam) {
    const forwardGate = computeApproachForwardGate(headingError, ship?.angVel);
    const lateralVel = (-vx * sinA) + (vy * cosA);
    if (localAx > 0) localAx *= forwardGate;
    localAy = clamp(-lateralVel / Math.max(0.2, tuning.velocityTau), -SHIP_PHYSICS.SPEED * 0.75, SHIP_PHYSICS.SPEED * 0.75);
  }

  const targetRadius = Math.max(0, Number(cmd.targetEntity?.radius || cmd.targetEntity?.r || cmd.targetEntity?.baseR || 0) || 0);
  const shipRadius = Math.max(0, Number(ship?.radius || ship?.r || 0) || 0);
  const ramTriggerDistance = Math.max(
    180,
    Number(cmd.ramTriggerDistance) || 0,
    Math.min(Number(cmd.arrival) || Infinity, targetRadius + shipRadius + 260)
  );
  const ramAligned = Math.abs(headingError) < 0.28 && Math.abs(Number(ship?.angVel) || 0) < 0.55;
  const ramImpulse = isRam && !cmd.ramImpulseDone && dist <= ramTriggerDistance && ramAligned
    ? {
      power: Math.max(1600, Number(cmd.ramImpulse) || 3400),
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      distance: dist
    }
    : null;

  return {
    control: makeControlFromLocalAccel(
      ship, localAx, localAy, headingError, preferStrafeHeading, turnCapability,
      guidedFlight ? { damperBrake, retroBrake, headingRate } : null
    ),
    nextCommand: null,
    clearCommand: false,
    ramImpulse
  };
}
