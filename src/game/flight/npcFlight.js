// src/game/flight/npcFlight.js
// Adapter that lets legacy NPC entities use the same command/thruster pipeline as the player ship.

import {
  SHIP_PHYSICS,
  applyPlayerInput,
  composeShipThrusterCommand,
  computeShipThrusterForces,
  updateShipThrusterState
} from '../shipEntity.js';
import {
  computePlayerCommandControl,
  computePlayerHoldControl
} from './playerAutopilot.js';

const BASE_FRAME_DT = 1 / 60;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const lerp = (a, b, t) => a + (b - a) * t;

function approachValue(current, target, delta) {
  if (current < target) return Math.min(target, current + delta);
  if (current > target) return Math.max(target, current - delta);
  return target;
}

function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function applyForwardImpulse(npc, impulse = {}) {
  const power = Number(impulse?.power) || 0;
  if (!npc || Math.abs(power) <= 1e-4) return false;
  syncNpcFlightState(npc);
  const angle = Number(npc.angle) || 0;
  const dirX = Number.isFinite(Number(impulse.dirX)) ? Number(impulse.dirX) : Math.cos(angle);
  const dirY = Number.isFinite(Number(impulse.dirY)) ? Number(impulse.dirY) : Math.sin(angle);
  const len = Math.max(1e-6, Math.hypot(dirX, dirY));
  npc.vel.x += (dirX / len) * power;
  npc.vel.y += (dirY / len) * power;
  npc.vx = npc.vel.x;
  npc.vy = npc.vel.y;
  return true;
}

function resolveNpcDimensions(npc) {
  const radius = Math.max(20, Number(npc?.radius) || Number(npc?.r) || 20);
  const profile = npc?.capitalProfile || {};
  const w = Math.max(80, Number(npc?.w) || radius * (Number(profile.lengthScale) || 3.0));
  const h = Math.max(60, Number(npc?.h) || radius * (Number(profile.widthScale) || 1.6));
  return { w, h };
}

function resolveNpcInertia(npc) {
  const mass = Math.max(1, Number(npc?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const { w, h } = resolveNpcDimensions(npc);
  npc.w = w;
  npc.h = h;
  if (!Number.isFinite(Number(npc.inertia)) || Number(npc.inertia) <= 0) {
    npc.inertia = (1 / 12) * mass * ((w * w) + (h * h));
  }
  return Math.max(1, Number(npc.inertia) || 1);
}

export function npcHasPhysicalThrusters(npc) {
  return !!(npc?.visual && Array.isArray(npc.visual.mainThrusters) && npc.visual.mainThrusters.length > 0);
}

export function syncNpcFlightState(npc) {
  if (!npc) return null;
  const x = Number(npc.x ?? npc.pos?.x) || 0;
  const y = Number(npc.y ?? npc.pos?.y) || 0;
  const vx = Number(npc.vx ?? npc.vel?.x) || 0;
  const vy = Number(npc.vy ?? npc.vel?.y) || 0;

  npc.x = x;
  npc.y = y;
  npc.vx = vx;
  npc.vy = vy;

  npc.pos = npc.pos || { x, y };
  npc.pos.x = x;
  npc.pos.y = y;
  npc.vel = npc.vel || { x: vx, y: vy };
  npc.vel.x = vx;
  npc.vel.y = vy;
  npc.input = npc.input || { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 };
  npc.thrusterInput = npc.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 };
  if (!Number.isFinite(Number(npc.mass)) || Number(npc.mass) <= 0) npc.mass = SHIP_PHYSICS.PLAYER_MASS;
  resolveNpcInertia(npc);
  return npc;
}

export function applyNpcFlightControl(npc, control = {}, dt = BASE_FRAME_DT, options = {}) {
  if (!npc || npc.dead || !npcHasPhysicalThrusters(npc)) {
    return { usedThrusters: false, control: null };
  }

  syncNpcFlightState(npc);
  const stepDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || BASE_FRAME_DT));
  const frameNorm = stepDt / BASE_FRAME_DT;

  applyPlayerInput(npc, control, npc.thrusterInput);
  composeShipThrusterCommand(npc, options.assist || null);
  const drive = updateShipThrusterState(npc, stepDt);

  const driveMain = clamp(drive?.main ?? npc.thrusterInput.main, 0, 1);
  const driveRetro = clamp(drive?.retro ?? npc.thrusterInput.retro, 0, 1);
  const reverseInput = Math.max(0, -clamp(npc.input?.thrustY ?? 0, -1, 1));
  const reverseEngaged = !!(reverseInput > 0.05 && npc.__retroState?.reverseEngaged);
  const reverseThrustInput = reverseEngaged ? reverseInput : 0;

  const mass = Math.max(1, Number(npc.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const inertia = resolveNpcInertia(npc);
  const invMass = 1 / mass;
  const angle = Number(npc.angle) || 0;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const forward = { x: cos, y: sin };
  const right = { x: -sin, y: cos };

  const velAlongForward = (npc.vel.x * forward.x) + (npc.vel.y * forward.y);
  const counterThrustNorm = driveMain > 1e-3
    ? clamp((-velAlongForward) / Math.max(600, SHIP_PHYSICS.SPEED * 4.0), 0, 1)
    : 0;
  const boostMul = Math.max(1, Number(options.boostMul) || 1);
  const forces = computeShipThrusterForces(npc, {
    mainForceMul: boostMul * (1.0 + counterThrustNorm * 1.75),
    sideForceMul: Math.max(0.1, Number(options.sideForceMul) || 1.6),
    reverseInput: reverseThrustInput
  }, npc.__npcForceScratch || (npc.__npcForceScratch = { localFx: 0, localFy: 0, localTorque: 0 }));

  const worldFx = (forward.x * forces.localFx) + (right.x * forces.localFy);
  const worldFy = (forward.y * forces.localFx) + (right.y * forces.localFy);
  npc.vel.x += (worldFx * invMass + (Number(options.externalAx) || 0)) * stepDt;
  npc.vel.y += (worldFy * invMass + (Number(options.externalAy) || 0)) * stepDt;

  const linearFriction = clamp(Number(options.linearFriction) || SHIP_PHYSICS.LINEAR_FRICTION, 0.9, 0.9999);
  const drag = Math.pow(linearFriction, frameNorm);
  npc.vel.x *= drag;
  npc.vel.y *= drag;

  const damperState = npc.__damperState || (npc.__damperState = { power: 0 });
  const speed = Math.hypot(npc.vel.x, npc.vel.y);
  const brakeHeld = (npc.input?.thrustY ?? 0) < -0.15 && !reverseEngaged;
  const speedRampNorm = clamp(speed / 40000, 0, 1);
  const damperRampIn = lerp(11.0, 3.4, speedRampNorm);
  const damperRampOut = 7.5;
  damperState.power = approachValue(
    Number(damperState.power) || 0,
    brakeHeld ? 1 : 0,
    (brakeHeld ? damperRampIn : damperRampOut) * stepDt
  );
  const damperPower = clamp(damperState.power, 0, 1);
  if (damperPower > 1e-4 && speed > 1e-4) {
    const retroAssist = Math.max(reverseThrustInput, driveRetro);
    const lowSpeedAssist = clamp(1 - (speed / 260), 0, 1);
    const damperLinearScale = retroAssist > 0.05 ? lerp(0.28, 1.0, lowSpeedAssist) : 1.0;
    const linearBrakeBase = lerp(SHIP_PHYSICS.SPEED * 0.7, SHIP_PHYSICS.SPEED * 16.0, damperPower) * damperLinearScale;
    const linearBrakeDynamic = speed * lerp(0.18, 1.25, damperPower) * damperLinearScale;
    const brakeDelta = Math.min(speed, Math.max(linearBrakeBase, linearBrakeDynamic) * stepDt);
    const invSpeed = 1 / speed;
    npc.vel.x -= npc.vel.x * invSpeed * brakeDelta;
    npc.vel.y -= npc.vel.y * invSpeed * brakeDelta;
  }

  const angularFriction = clamp(Number(options.angularFriction) || SHIP_PHYSICS.ANGULAR_FRICTION, 0.85, 0.9999);
  npc.angVel = Number(npc.angVel) || 0;
  npc.angVel += (forces.localTorque / inertia) * stepDt;
  npc.angVel *= Math.pow(angularFriction, frameNorm);
  npc.angVel = clamp(npc.angVel, -SHIP_PHYSICS.MAX_TURN_SPEED, SHIP_PHYSICS.MAX_TURN_SPEED);
  npc.angle = wrapAngle(angle + npc.angVel * stepDt);

  npc.x += npc.vel.x * stepDt;
  npc.y += npc.vel.y * stepDt;
  npc.vx = npc.vel.x;
  npc.vy = npc.vel.y;
  npc.pos.x = npc.x;
  npc.pos.y = npc.y;
  npc.__npcFlightIntegrated = true;

  return {
    usedThrusters: true,
    control,
    drive,
    forces
  };
}

export function applyNpcFlightVector(npc, {
  thrustNorm = 0,
  strafeNorm = 0,
  desiredAngle = null,
  boostT = 0,
  separation = null
} = {}, dt = BASE_FRAME_DT, options = {}) {
  if (!npc || !npcHasPhysicalThrusters(npc)) return { usedThrusters: false, control: null };
  syncNpcFlightState(npc);
  const heading = Number.isFinite(desiredAngle)
    ? computePlayerHoldControl(npc, SHIP_PHYSICS, desiredAngle)
    : { torque: 0 };
  const thrust = clamp(thrustNorm, -1, 1);
  const strafe = clamp(strafeNorm, -1, 1);
  const control = {
    controller: 'npc',
    thrustY: thrust,
    main: clamp(thrust, 0, 1),
    retro: clamp(-thrust, 0, 1),
    leftSide: clamp(strafe, 0, 1),
    rightSide: clamp(-strafe, 0, 1),
    torque: heading.torque
  };
  return applyNpcFlightControl(npc, control, dt, {
    ...options,
    boostMul: (Number(boostT) || 0) > 0 ? 1.7 : 1,
    externalAx: Number(separation?.ax) || Number(options.externalAx) || 0,
    externalAy: Number(separation?.ay) || Number(options.externalAy) || 0
  });
}

export function executeNpcFlightCommand(npc, cmd, dt = BASE_FRAME_DT, options = {}) {
  if (!npc || !cmd || !npcHasPhysicalThrusters(npc)) {
    return { handled: false, usedThrusters: false, result: null };
  }
  syncNpcFlightState(npc);
  const result = computePlayerCommandControl(npc, cmd, {
    defaultArrival: Number(options.defaultArrival) || Math.max(90, (Number(npc.radius) || 20) + 20),
    physics: SHIP_PHYSICS
  });
  if (!result || result.clearCommand) {
    npc.command = null;
    return { handled: true, usedThrusters: false, result };
  }
  if (result.nextCommand) npc.command = result.nextCommand;
  if (result.control) {
    const flight = applyNpcFlightControl(npc, result.control, dt, options);
    if (result.ramImpulse && !cmd.ramImpulseDone) {
      let applied = false;
      if (typeof options.onRamImpulse === 'function') {
        applied = options.onRamImpulse(npc, result.ramImpulse) !== false;
      } else {
        applied = applyForwardImpulse(npc, result.ramImpulse);
      }
      if (applied) {
        cmd.ramImpulseDone = true;
        if (npc.command === cmd) npc.command = null;
      }
    }
    return { handled: true, usedThrusters: flight.usedThrusters, result, flight };
  }
  return { handled: true, usedThrusters: false, result };
}
