export function clampTurnVec(vx, vy, wantVx, wantVy, dt, maxDeg) {
  const maxRad = (maxDeg * Math.PI / 180) * dt;
  const a = Math.atan2(vy, vx);
  const b = Math.atan2(wantVy, wantVx);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const lim = Math.max(-maxRad, Math.min(maxRad, d));
  const speed = Math.hypot(wantVx, wantVy);
  const ang = a + lim;
  return { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed };
}

export function getLeadAim(shooter, target, projSpeed) {
  const targetX = target.pos ? target.pos.x : target.x;
  const targetY = target.pos ? target.pos.y : target.y;
  const vx = target.vx ?? target.vel?.x ?? 0;
  const vy = target.vy ?? target.vel?.y ?? 0;
  const px = targetX - shooter.x;
  const py = targetY - shooter.y;
  const A = (vx * vx + vy * vy) - projSpeed * projSpeed;
  const B = 2 * (px * vx + py * vy);
  const C = (px * px + py * py);
  let t = 0;
  if (Math.abs(A) < 1e-3) {
    t = -C / Math.max(B, -1e-3);
  } else {
    const disc = B * B - 4 * A * C;
    t = (disc > 0) ? (-B - Math.sqrt(disc)) / (2 * A) : 0;
  }
  t = Math.max(0, Math.min(2.0, t));
  return { x: targetX + vx * t, y: targetY + vy * t };
}

export function aiPickBestTarget(self, rangeLimit) {
  let bestTarget = null;
  let bestScore = -Infinity;

  const npcs = window.npcs || [];
  const ship = window.ship;

  const enemies = self.friendly
    ? npcs.filter(n => n.isPirate && !n.dead)
    : [ship, ...npcs.filter(n => n.friendly && !n.dead)].filter(Boolean);

  const MAX_RANGE_SQ = (rangeLimit || 20000) ** 2;

  for (const u of enemies) {
    const distSq = (u.x - self.x) ** 2 + (u.y - self.y) ** 2;
    if (distSq > MAX_RANGE_SQ) continue;

    let score = 0;
    score -= distSq * 0.00008;

    const amFighter = self.fighter || self.type === 'fighter' || self.type === 'interceptor';
    const isFighter = u.fighter || u.type === 'fighter' || u.type === 'interceptor';
    if (amFighter) {
      if (isFighter) {
        if (distSq < 6250000) score += 40000;
        else score += 1000;
      } else {
        score += 1000;
      }
    } else {
      if (isFighter) score += 2000;
      else score += 5000;
    }

    if (distSq < 122500) {
      score += 50000;
    }

    score += Math.random() * 500;

    if (score > bestScore) {
      bestScore = score;
      bestTarget = u;
    }
  }

  return bestTarget;
}

window.clampTurnVec = clampTurnVec;
window.getLeadAim = getLeadAim;
window.aiPickBestTarget = aiPickBestTarget;
