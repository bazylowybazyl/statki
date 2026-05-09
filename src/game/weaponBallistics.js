// Shared helpers for projectile aim and inherited muzzle velocity.

export const PROJECTILE_VELOCITY_INHERIT = 0.2;

export function getEntityVelocity(entity, out = { x: 0, y: 0 }) {
  const vx = entity?.vel?.x ?? entity?.vx ?? 0;
  const vy = entity?.vel?.y ?? entity?.vy ?? 0;
  out.x = Number.isFinite(vx) ? vx : 0;
  out.y = Number.isFinite(vy) ? vy : 0;
  return out;
}

export function scaleVelocity(vel, scale = 1, out = { x: 0, y: 0 }) {
  const vx = Number(vel?.x) || 0;
  const vy = Number(vel?.y) || 0;
  const mul = Number.isFinite(scale) ? scale : 0;
  out.x = vx * mul;
  out.y = vy * mul;
  return out;
}

export function getTargetPosition(target, out = { x: 0, y: 0 }) {
  const x = target?.pos?.x ?? target?.x ?? 0;
  const y = target?.pos?.y ?? target?.y ?? 0;
  out.x = Number.isFinite(x) ? x : 0;
  out.y = Number.isFinite(y) ? y : 0;
  return out;
}

export function computeBallisticLead(origin, inheritedVelocity, target, projectileSpeed, out = { x: 0, y: 0 }) {
  const ox = Number(origin?.x) || 0;
  const oy = Number(origin?.y) || 0;
  const tx = Number(target?.pos?.x ?? target?.x) || 0;
  const ty = Number(target?.pos?.y ?? target?.y) || 0;
  const tvxRaw = target?.vel?.x ?? target?.vx ?? 0;
  const tvyRaw = target?.vel?.y ?? target?.vy ?? 0;
  const tvx = Number.isFinite(tvxRaw) ? tvxRaw : 0;
  const tvy = Number.isFinite(tvyRaw) ? tvyRaw : 0;
  const ivx = Number(inheritedVelocity?.x) || 0;
  const ivy = Number(inheritedVelocity?.y) || 0;
  const speed = Number(projectileSpeed);

  if (!Number.isFinite(speed) || speed <= 0) {
    out.x = tx;
    out.y = ty;
    return out;
  }

  const rx = tx - ox;
  const ry = ty - oy;
  const rvx = tvx - ivx;
  const rvy = tvy - ivy;
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

  out.x = tx + rvx * t;
  out.y = ty + rvy * t;
  return out;
}

export function computeProjectileVelocity(dir, projectileSpeed, baseVelocity, inheritFactor = PROJECTILE_VELOCITY_INHERIT, out = { x: 0, y: 0 }) {
  const speed = Number(projectileSpeed) || 0;
  const inherit = Number.isFinite(inheritFactor) ? inheritFactor : PROJECTILE_VELOCITY_INHERIT;
  const bx = Number(baseVelocity?.x) || 0;
  const by = Number(baseVelocity?.y) || 0;
  out.x = (Number(dir?.x) || 0) * speed + bx * inherit;
  out.y = (Number(dir?.y) || 0) * speed + by * inherit;
  return out;
}

export function computeSegmentCircleHit(start, end, circle, radius, out = { hit: false, x: 0, y: 0, t: 0, tEnter: 0, tExit: 0, distSq: 0 }) {
  const sx = Number(start?.x) || 0;
  const sy = Number(start?.y) || 0;
  const ex = Number(end?.x) || 0;
  const ey = Number(end?.y) || 0;
  const cx = Number(circle?.x) || 0;
  const cy = Number(circle?.y) || 0;
  const r = Math.max(0, Number(radius) || 0);
  const vx = ex - sx;
  const vy = ey - sy;
  const lenSq = vx * vx + vy * vy;
  let t = 0;

  if (lenSq > 1e-9) {
    t = ((cx - sx) * vx + (cy - sy) * vy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const x = sx + vx * t;
  const y = sy + vy * t;
  const dx = cx - x;
  const dy = cy - y;
  const distSq = dx * dx + dy * dy;
  const hit = distSq <= r * r;
  let tEnter = t;
  let tExit = t;

  if (hit && lenSq > 1e-9) {
    const ox = sx - cx;
    const oy = sy - cy;
    const b = 2 * (ox * vx + oy * vy);
    const c = ox * ox + oy * oy - r * r;
    const disc = b * b - 4 * lenSq * c;

    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const invDenom = 1 / (2 * lenSq);
      tEnter = (-b - root) * invDenom;
      tExit = (-b + root) * invDenom;
      if (tEnter < 0) tEnter = 0;
      else if (tEnter > 1) tEnter = 1;
      if (tExit < 0) tExit = 0;
      else if (tExit > 1) tExit = 1;
    }
  }

  out.hit = hit;
  out.x = x;
  out.y = y;
  out.t = t;
  out.tEnter = tEnter;
  out.tExit = tExit;
  out.distSq = distSq;
  return out;
}
