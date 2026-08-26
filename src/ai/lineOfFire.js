const LINE_OF_FIRE_QUERY_PADDING = 1200;

function entityBlocksLine(victim, shooter, target, player, startX, startY, dirX, dirY, checkDist) {
  if (!victim || victim === shooter || victim === target || victim.dead || victim.destroyed) return false;

  const isAlly = (shooter.friendly === victim.friendly) || (shooter.friendly && victim === player);
  if (!isAlly) return false;

  const victimX = victim.pos?.x ?? victim.x;
  const victimY = victim.pos?.y ?? victim.y;
  if (!Number.isFinite(victimX) || !Number.isFinite(victimY)) return false;

  const victimRadius = Number(victim.radius ?? victim.r) || 0;
  const fromStartX = victimX - startX;
  const fromStartY = victimY - startY;
  const maxReach = checkDist + victimRadius;
  if (fromStartX * fromStartX + fromStartY * fromStartY > maxReach * maxReach) return false;

  const dot = fromStartX * dirX + fromStartY * dirY;
  if (dot < 0) return false;

  const closestX = startX + dirX * dot;
  const closestY = startY + dirY * dot;
  const offsetX = victimX - closestX;
  const offsetY = victimY - closestY;
  const safeRadius = (victimRadius || 20) + 15;
  return offsetX * offsetX + offsetY * offsetY < safeRadius * safeRadius;
}

/**
 * Checks whether an allied hull crosses the shot path. The spatial query is
 * centred on the segment, so callers avoid rebuilding/scanning the whole NPC
 * array for every weapon candidate.
 */
export function isFriendlyLineOfFireBlocked(
  shooter,
  target,
  weaponRange,
  queryNearby,
  fallbackEntities,
  player
) {
  if (!shooter || !target) return false;
  const startX = Number(shooter.x);
  const startY = Number(shooter.y);
  const targetX = target.pos?.x ?? target.x;
  const targetY = target.pos?.y ?? target.y;
  if (!Number.isFinite(startX) || !Number.isFinite(startY)
      || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

  const toTargetX = targetX - startX;
  const toTargetY = targetY - startY;
  const distSq = toTargetX * toTargetX + toTargetY * toTargetY;
  if (!(distSq > 0)) return false;
  const distToTarget = Math.sqrt(distSq);
  const checkDist = Math.min(distToTarget, Number(weaponRange) || 1000);
  const dirX = toTargetX / distToTarget;
  const dirY = toTargetY / distToTarget;

  if (typeof queryNearby === 'function') {
    const halfDist = checkDist * 0.5;
    const query = queryNearby(
      startX + dirX * halfDist,
      startY + dirY * halfDist,
      halfDist + LINE_OF_FIRE_QUERY_PADDING
    );
    const buffer = query?.buffer;
    const count = Math.min(Number(query?.count) || 0, buffer?.length || 0);
    for (let i = 0; i < count; i++) {
      if (entityBlocksLine(buffer[i], shooter, target, player, startX, startY, dirX, dirY, checkDist)) {
        return true;
      }
    }
    return false;
  }

  if (player && entityBlocksLine(player, shooter, target, player, startX, startY, dirX, dirY, checkDist)) {
    return true;
  }
  const entities = fallbackEntities || [];
  for (let i = 0; i < entities.length; i++) {
    if (entityBlocksLine(entities[i], shooter, target, player, startX, startY, dirX, dirY, checkDist)) {
      return true;
    }
  }
  return false;
}
