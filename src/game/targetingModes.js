export const TARGETING_MODE = Object.freeze({
  SINGLE: 0,
  MULTI: 1,
  SUB: 2
});

export const TARGETING_MODE_NAMES = Object.freeze(['SINGLE', 'MULTI', 'SUB']);
export const TARGETING_MODE_COLORS = Object.freeze(['#ffb648', '#34e7ff', '#52ff9a']);
export const TARGETING_MODE_ICONS = Object.freeze(['◇', '][', '⌁']);

export function targetingModeFromWheelVector(dx, dy, deadzone = 25) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (Math.hypot(x, y) <= Math.max(0, Number(deadzone) || 0)) return -1;

  const deg = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  if (deg < 120) return TARGETING_MODE.MULTI;
  if (deg < 240) return TARGETING_MODE.SUB;
  return TARGETING_MODE.SINGLE;
}

export function lerpTargetingAxisAngle(current, target, amount) {
  let delta = (Number(target) || 0) - (Number(current) || 0);
  const halfTurn = Math.PI;
  while (delta > halfTurn * 0.5) delta -= halfTurn;
  while (delta < -halfTurn * 0.5) delta += halfTurn;
  return (Number(current) || 0) + delta * Math.max(0, Math.min(1, Number(amount) || 0));
}

export function perpendicularTargetingAngle(vx, vy, fallbackX = 0, fallbackY = 0) {
  let x = Number(vx) || 0;
  let y = Number(vy) || 0;
  if (Math.hypot(x, y) < 2) {
    x = Number(fallbackX) || 0;
    y = Number(fallbackY) || 0;
  }
  return Math.hypot(x, y) > 0.01 ? Math.atan2(y, x) - Math.PI * 0.5 : 0;
}

export function targetingVisualScale(zoom, minScale = 0.22, maxScale = 1.8) {
  const min = Math.max(0.01, Number(minScale) || 0.22);
  const max = Math.max(min, Number(maxScale) || 1.8);
  const value = Number(zoom);
  return Math.max(min, Math.min(max, Number.isFinite(value) && value > 0 ? value : 1));
}

export function reconcileLockedTargets(targets, canLock) {
  const valid = [];
  const seen = new Set();
  if (Array.isArray(targets) && typeof canLock === 'function') {
    for (const target of targets) {
      if (!target || seen.has(target) || !canLock(target)) continue;
      seen.add(target);
      valid.push(target);
    }
  }
  return { targets: valid, primary: valid[0] || null };
}
