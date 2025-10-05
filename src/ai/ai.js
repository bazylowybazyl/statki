const DEFAULT_DT = 0.016;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function resolveTargetPosition(target) {
  if (!target) {
    return { x: 0, y: 0 };
  }
  if (typeof target.x === 'number' && typeof target.y === 'number') {
    return { x: target.x, y: target.y };
  }
  if (target.pos && typeof target.pos.x === 'number' && typeof target.pos.y === 'number') {
    return { x: target.pos.x, y: target.pos.y };
  }
  return { x: 0, y: 0 };
}

export function limitSpeed(entity, max) {
  const vx = entity.vel ? entity.vel.x : entity.vx;
  const vy = entity.vel ? entity.vel.y : entity.vy;
  const v = Math.hypot(vx, vy);
  if (v > max) {
    const s = max / v;
    if (entity.vel) {
      entity.vel.x *= s;
      entity.vel.y *= s;
    } else {
      entity.vx *= s;
      entity.vy *= s;
    }
  }
}

export function leadTarget(shooter, shooterVel, target, speed) {
  const targetPos = resolveTargetPosition(target);
  const tx = targetPos.x;
  const ty = targetPos.y;
  const tvx = target.vx ?? (target.vel ? target.vel.x : 0);
  const tvy = target.vy ?? (target.vel ? target.vel.y : 0);
  const rx = tx - shooter.x;
  const ry = ty - shooter.y;
  const rvx = tvx - shooterVel.x;
  const rvy = tvy - shooterVel.y;
  const a = rvx * rvx + rvy * rvy - speed * speed;
  const b = 2 * (rx * rvx + ry * rvy);
  const c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      t = Math.min(t1, t2);
      if (t < 0) t = Math.max(t1, t2);
    }
  }
  if (!Number.isFinite(t) || t < 0) t = 0;
  return { x: tx + tvx * t, y: ty + tvy * t };
}

export function steerToward(entity, target, params = {}) {
  const { dt = DEFAULT_DT } = params;
  const accel = params.accel ?? entity.accel;
  const turnRate = params.turnRate ?? entity.turn;
  const maxSpeed = params.maxSpeed ?? entity.maxSpeed;
  const { x: tx, y: ty } = resolveTargetPosition(target);
  const desired = Math.atan2(ty - entity.y, tx - entity.x);
  const currentAngle = entity.angle ?? 0;
  const diff = wrapAngle(desired - currentAngle);
  const turn = clamp(diff, -turnRate * dt, turnRate * dt);
  const newAngle = wrapAngle(currentAngle + turn);
  entity.angle = newAngle;
  if (accel) {
    entity.vx = (entity.vx ?? 0) + Math.cos(newAngle) * accel * dt;
    entity.vy = (entity.vy ?? 0) + Math.sin(newAngle) * accel * dt;
  }
  if (maxSpeed != null) {
    limitSpeed(entity, maxSpeed);
  }
}

export function chaseEvadeAI(npc, target, opts = {}) {
  if (!npc || !target) return;
  const dt = opts.dt ?? DEFAULT_DT;
  steerToward(npc, target, {
    dt,
    accel: opts.accel ?? npc.accel,
    turnRate: opts.turnRate ?? npc.turn,
    maxSpeed: npc.maxSpeed,
  });

  if (opts.strafe) {
    const side = opts.strafeDir ?? (Math.random() < 0.5 ? -1 : 1);
    const ang = (npc.angle ?? 0) + (side * Math.PI) / 2;
    const strafeAccel = opts.strafeAccel ?? npc.accel * 0.25;
    npc.vx = (npc.vx ?? 0) + Math.cos(ang) * strafeAccel * dt;
    npc.vy = (npc.vy ?? 0) + Math.sin(ang) * strafeAccel * dt;
  }
}

export function dogfightAI(npc, player, world, tuning = {}) {
  if (!npc || !player) return;
  const dt = tuning.dt ?? DEFAULT_DT;
  chaseEvadeAI(npc, player, { dt, strafe: true });
}

export function battleshipAI(npc, targets, world, tuning = {}) {
  if (!npc) return;
  const dt = tuning.dt ?? DEFAULT_DT;
  const retreatRange = tuning.retreatRange ?? 600;
  const target = Array.isArray(targets)
    ? targets.find((t) => t && !t.dead) || targets[0]
    : targets;
  if (!target) return;
  const { x: tx, y: ty } = resolveTargetPosition(target);
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);

  if (dist < retreatRange) {
    const ang = Math.atan2(npc.y - ty, npc.x - tx);
    npc.vx = (npc.vx ?? 0) + Math.cos(ang) * npc.accel * dt;
    npc.vy = (npc.vy ?? 0) + Math.sin(ang) * npc.accel * dt;
    limitSpeed(npc, npc.maxSpeed);
  } else {
    chaseEvadeAI(npc, target, { dt });
  }
}

export const AIUtils = {
  wrapAngle,
  leadTarget,
  limitSpeed,
};

export default {
  steerToward,
  chaseEvadeAI,
  dogfightAI,
  battleshipAI,
  leadTarget,
  wrapAngle,
  limitSpeed,
};
