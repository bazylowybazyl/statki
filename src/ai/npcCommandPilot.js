// src/ai/npcCommandPilot.js
//
// Komendy RTS (move / approach / hold / orbit / ram / attack-move) dla okrętów,
// które latają modelem shipFlightModel. Komenda tylko ustawia intencję lotu;
// sam lot liczy stepShipFlight w npcStep — ten sam pilot i ta sama
// specyfikacja kadłuba co w walce, więc rozkaz „leć tam" nie ma innej fizyki
// niż autonomiczne AI (dawniej: dysze z edytora dla jednych, kinematyka dla
// innych).
//
// Zależności od index.html wchodzą przez `deps`, żeby moduł był testowalny:
//   getTargetPos(npc, cmd) → {x, y} | null
//   pickTarget(npc)        → cel dla attack-move
//   triggerRam(npc, impulse)
//   defaultOrbitRadius

import {
  resolveShipFlightSpec,
  setFlightArrive,
  wrapFlightAngle
} from '../game/flight/shipFlightModel.js';

// Na miejscu = w promieniu przybycia i prędkość względna poniżej tego progu.
const ARRIVED_REL_SPEED = 40;
// Taran odpala dopiero przy dziobie na celu i spokojnym obrocie.
const RAM_ALIGN = 0.28;
const RAM_MAX_SPIN = 0.55;

function liveEntity(e) {
  return e && !e.dead && !e.destroyed && !e.removed ? e : null;
}

function velX(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function velY(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

// Zwraca true, gdy komenda steruje okrętem w tym ticku (jak executeNpcCommand);
// false — gdy komenda się skończyła albo oddaje sterowanie mózgowi (attack-move
// z celem).
export function applyNpcCommandIntent(npc, cmd, deps = {}) {
  if (!npc || !cmd) return false;
  const spec = resolveShipFlightSpec(npc);
  if (!spec) return false;

  if (cmd.type === 'hold') {
    // Trzymamy PUNKT, w którym padł rozkaz (odpychany okręt wraca), i kurs:
    // zadany albo ten, który miał w chwili rozkazu.
    if (!Number.isFinite(cmd.holdX) || !Number.isFinite(cmd.holdY)) {
      cmd.holdX = npc.x;
      cmd.holdY = npc.y;
    }
    if (!Number.isFinite(cmd.faceAngle) && !Number.isFinite(cmd.holdFace)) cmd.holdFace = Number(npc.angle) || 0;
    const face = Number.isFinite(cmd.faceAngle) ? cmd.faceAngle : cmd.holdFace;
    setFlightArrive(npc, cmd.holdX, cmd.holdY, { arrival: 0, speedMode: 'combat', face, faceNear: 0, faceFar: 0 });
    npc.forceTarget = null;
    return true;
  }

  const targetPos = typeof deps.getTargetPos === 'function' ? deps.getTargetPos(npc, cmd) : null;
  if (!targetPos) {
    npc.command = null;
    npc.forceTarget = null;
    return false;
  }

  if (cmd.type === 'attack-move') {
    const target = liveEntity(cmd.targetEntity) || (typeof deps.pickTarget === 'function' ? deps.pickTarget(npc) : null);
    if (target) {
      npc.forceTarget = target;
      return false;
    }
  }

  const ent = liveEntity(cmd.targetEntity);
  const refVx = ent ? velX(ent) : 0;
  const refVy = ent ? velY(ent) : 0;
  const dx = targetPos.x - npc.x;
  const dy = targetPos.y - npc.y;
  const dist = Math.hypot(dx, dy);

  if (cmd.type === 'orbit') {
    // „Marchewka" na okręgu kawałek przed okrętem: lecąc za nią, okręt kreśli
    // okrąg. Prędkość tak dobrana, żeby przyspieszenie dośrodkowe (boczne dysze
    // + część ciągu) wystarczyło na ten promień.
    const radius = Math.max(80, Number(cmd.orbitRadius) || Number(deps.defaultOrbitRadius) || 900);
    const dir = (Number(cmd.orbitDir) || 1) >= 0 ? 1 : -1;
    const speed = Math.min(spec.maxSpeed, Math.sqrt(radius * (spec.strafeAccel + 0.5 * spec.accel)));
    const lead = Math.max(0.15, Math.min(0.9, (speed * 1.2) / radius));
    const a = Math.atan2(npc.y - targetPos.y, npc.x - targetPos.x) + dir * lead;
    setFlightArrive(npc, targetPos.x + Math.cos(a) * radius, targetPos.y + Math.sin(a) * radius, {
      arrival: 0,
      speedLimit: speed,
      noBrake: true,
      refVx,
      refVy
    });
    return true;
  }

  if (cmd.type === 'ram') {
    const heading = Math.atan2(dy, dx);
    setFlightArrive(npc, targetPos.x, targetPos.y, {
      arrival: 0,
      speedMode: 'cruise',
      noBrake: true,
      refVx,
      refVy,
      face: heading,
      faceNear: 0,
      faceFar: 0
    });
    const targetRadius = Math.max(0, Number(ent?.radius || ent?.r || ent?.baseR || 0) || 0);
    const shipRadius = Math.max(0, Number(npc.radius || npc.r || 0) || 0);
    const trigger = Math.max(
      180,
      Number(cmd.ramTriggerDistance) || 0,
      Math.min(Number(cmd.arrival) || Infinity, targetRadius + shipRadius + 260)
    );
    const aligned = Math.abs(wrapFlightAngle(heading - (Number(npc.angle) || 0))) < RAM_ALIGN
      && Math.abs(Number(npc.angVel) || 0) < RAM_MAX_SPIN;
    if (!cmd.ramImpulseDone && dist <= trigger && aligned) {
      cmd.ramImpulseDone = true;
      const angle = Number(npc.angle) || 0;
      if (typeof deps.triggerRam === 'function') {
        deps.triggerRam(npc, {
          power: Math.max(1600, Number(cmd.ramImpulse) || 3400),
          dirX: Math.cos(angle),
          dirY: Math.sin(angle),
          distance: dist
        });
      }
      if (npc.command === cmd) npc.command = null;
    }
    return true;
  }

  // move / approach / attack-move bez celu
  const arrival = Math.max(0, Number(cmd.arrival) || Number(deps.defaultArrival) || ((Number(npc.radius) || 20) + 20));
  const slack = Math.max(6, Math.min(24, arrival * 0.1));
  const relSpeed = Math.hypot((Number(npc.vx) || 0) - refVx, (Number(npc.vy) || 0) - refVy);
  if (dist <= arrival + slack && relSpeed < ARRIVED_REL_SPEED) {
    // Na miejscu komenda przechodzi w „hold": trzymaj punkt (i zadany kurs).
    const hold = Number.isFinite(cmd.faceAngle) ? { type: 'hold', faceAngle: cmd.faceAngle } : { type: 'hold' };
    npc.command = hold;
    npc.forceTarget = null;
    return applyNpcCommandIntent(npc, hold, deps);
  }
  const face = Number.isFinite(cmd.faceAngle) ? cmd.faceAngle : NaN;
  setFlightArrive(npc, targetPos.x, targetPos.y, {
    arrival,
    speedMode: dist > 4000 ? 'cruise' : 'combat',
    refVx,
    refVy,
    face,
    faceNear: arrival,
    faceFar: arrival + Math.max(600, spec.maxSpeed * 2)
  });
  return true;
}
