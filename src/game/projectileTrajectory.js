function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Advances the authoritative 2D projectile pose by one fixed physics step.
 * The previous pose is retained for render interpolation and swept collision.
 *
 * `nowSim` (SimClock.sim, src/game/simClock.js) + `projectile.bornSim` (czas pozy
 * lufy przy strzale): pocisk wystrzelony w tym kroku z pozy PO całkowaniu ruchu
 * (CIWS, NPC) stoi już tam, gdzie lufa na końcu kroku — pełny krok lotu wysuwał
 * go o v·dt przed lufę (przy 100% dziedziczenia prędkości: 83 j. przy 10 000 j/s).
 * Taki pocisk leci dopiero od następnego kroku.
 */
export function stepProjectileKinematics(projectile, dt, nowSim = null) {
  if (!projectile) return null;
  let step = Math.max(0, finite(dt, 0));
  if (nowSim !== null && Number.isFinite(projectile.bornSim)) {
    step = Math.min(step, Math.max(0, finite(nowSim, 0) - projectile.bornSim));
  }
  const x = finite(projectile.x, 0);
  const y = finite(projectile.y, 0);

  projectile.px = x;
  projectile.py = y;
  projectile.x = x + finite(projectile.vx, 0) * step;
  projectile.y = y + finite(projectile.vy, 0) * step;
  // Gra 3D: wysokość pocisku (strzał z wysokości statku w punkt celowania 3D); bez vz — z stoi.
  if (projectile.vz) {
    const z = finite(projectile.z, 0);
    projectile.pz = z;
    projectile.z = z + projectile.vz * step;
  }
  projectile.life = finite(projectile.life, 0) - step;
  projectile.age = Math.max(0, finite(projectile.age, 0)) + step;

  if (projectile.homingDelay !== undefined) {
    const homingDelay = Math.max(0, finite(projectile.homingDelay, 0));
    projectile.homingDelay = Math.max(0, homingDelay - step);
  }
  return projectile;
}

/**
 * Consumes a projectile after impact. A destructible hex hull is a solid target:
 * its impact response already propagates structural damage, so rail penetration
 * must not keep the projectile flying through the same ship after the first cell.
 */
export function shouldRemoveProjectileAfterImpact(projectile, hitSolidHex = false) {
  if (!projectile) return true;
  if (hitSolidHex || projectile.type !== 'rail') return true;

  projectile.penetration = (Number(projectile.penetration) || 1) - 1;
  return projectile.penetration <= 0;
}
