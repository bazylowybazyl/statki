const DEFAULT_BATTLESHIP_IDEAL_RANGE = 1200;
const CAPITAL_CLEARANCE_MARGIN = 520;

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolveCapitalIdealRange(npc, target = null) {
  const configured =
    finitePositive(npc?.broadsideRange) ||
    finitePositive(npc?.preferredRange) ||
    finitePositive(npc?.weaponRange) ||
    DEFAULT_BATTLESHIP_IDEAL_RANGE;

  const selfRadius = finitePositive(npc?.radius);
  const targetRadius = finitePositive(target?.radius ?? target?.r);
  const clearanceFloor = selfRadius + targetRadius + CAPITAL_CLEARANCE_MARGIN;

  return Math.max(configured, clearanceFloor || DEFAULT_BATTLESHIP_IDEAL_RANGE);
}

export function resolveCapitalOrbitStrafe({ distance, idealRange, orbitDir }) {
  const d = finitePositive(distance);
  const range = finitePositive(idealRange) || DEFAULT_BATTLESHIP_IDEAL_RANGE;
  const dir = Number(orbitDir) >= 0 ? 1 : -1;

  if (d < range * 0.85) return 0.4 * dir;
  if (d > range * 1.15) return -0.4 * dir;
  return 0;
}
