// src/ai/aiUtils.js

const _clampTurnOut = { vx: 0, vy: 0 };
export function clampTurnVec(vx, vy, wantVx, wantVy, dt, maxDeg, out = _clampTurnOut) {
  // NaN recovery: if current velocity is NaN, treat as zero (stationary)
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  if (!Number.isFinite(wantVx) || !Number.isFinite(wantVy)) { out.vx = vx; out.vy = vy; return out; }
  const maxRad = (maxDeg * Math.PI / 180) * dt;
  const a = Math.atan2(vy, vx);
  const b = Math.atan2(wantVy, wantVx);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const lim = Math.max(-maxRad, Math.min(maxRad, d));
  const speed = Math.hypot(wantVx, wantVy);
  const ang = a + lim;
  out.vx = Math.cos(ang) * speed;
  out.vy = Math.sin(ang) * speed;
  return out;
}

const _leadAimOut = { x: 0, y: 0 };
export function getLeadAim(shooter, target, projSpeed, out = _leadAimOut) {
  const targetX = target.pos ? target.pos.x : target.x;
  const targetY = target.pos ? target.pos.y : target.y;
  // ?? only catches null/undefined, NOT NaN — guard explicitly
  let vx = target.vx ?? target.vel?.x ?? 0;
  let vy = target.vy ?? target.vel?.y ?? 0;
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
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
  out.x = targetX + vx * t;
  out.y = targetY + vy * t;
  return out;
}

export function isEnemyUnit(self, other) {
  if (!self || !other || other.dead || other === self) return false;

  if (other === window.ship) return !self.friendly;
  if (self === window.ship) return !other.friendly;

  if (typeof self.friendly === 'boolean' && typeof other.friendly === 'boolean') {
    if (self.friendly !== other.friendly) return true;
  }

  if (self.team && other.team && self.team !== other.team) return true;

  if (!!self.isPirate !== !!other.isPirate) {
    if (!!self.friendly === !!other.friendly) return true;
  }

  return false;
}

export function aiPickBestTarget(self, rangeLimit) {
  const tPick0 = (typeof performance !== 'undefined') ? performance.now() : 0;

  let bestTarget = null;
  let bestScore = -Infinity;

  const MAX_RANGE = rangeLimit || 20000;
  const MAX_RANGE_SQ = MAX_RANGE * MAX_RANGE;

  const amFighter = self.fighter || self.type === 'fighter' || self.type === 'interceptor';

  // In-place check for player ship
  if (!self.friendly && window.ship && isEnemyUnit(self, window.ship)) {
    const u = window.ship;
    const dx = u.pos.x - self.x;
    const dy = u.pos.y - self.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= MAX_RANGE_SQ) {
      let score = -distSq * 0.00016;
      score += amFighter ? 1400 : 4200; // player is never a fighter
      if (distSq < 350 * 350) score += 1200;
      bestScore = score;
      bestTarget = u;
    }
  }

  // Note: spatial grid is intentionally NOT used here. Realistic SEARCH_RANGE
  // values (6000-30000) blow past the grid's useful span (cell size 600 →
  // hundreds of cells), and aiPickBestTarget is already throttled by
  // retargetTimer (1-1.5s/fighter), so a per-call iteration over npcs[] is
  // both simpler and faster than going through the shared result buffer.
  const npcs = window.npcs || [];
  for (let i = 0; i < npcs.length; i++) {
    const u = npcs[i];
    if (!isEnemyUnit(self, u)) continue;

    const ux = u.pos ? u.pos.x : u.x;
    const uy = u.pos ? u.pos.y : u.y;
    const dx = ux - self.x;
    const dy = uy - self.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > MAX_RANGE_SQ) continue;

    let score = -distSq * 0.00016;
    const isFighter = u.fighter || u.type === 'fighter' || u.type === 'interceptor';

    if (amFighter) {
      score += isFighter ? 5000 : 1400;
    } else {
      score += isFighter ? 2200 : 4200;
    }

    if (distSq < 350 * 350) score += 1200;

    if (score > bestScore) {
      bestScore = score;
      bestTarget = u;
    }
  }

  if (typeof window !== 'undefined' && typeof performance !== 'undefined') {
    window.__aiTargetPickMs = (window.__aiTargetPickMs || 0) + (performance.now() - tPick0);
  }

  return bestTarget;
}

export function getEffectiveRange(self, target, baseRange) {
  const selfR = self?.radius || 50;
  const targetR = target?.radius || 50;
  return baseRange + selfR + targetR;
}

window.clampTurnVec = clampTurnVec;
window.getLeadAim = getLeadAim;
window.isEnemyUnit = isEnemyUnit;
window.aiPickBestTarget = aiPickBestTarget;
window.getEffectiveRange = getEffectiveRange;