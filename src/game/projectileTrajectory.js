function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Czas lotu pocisku w bieżącym kroku [s]: dt, a dla pocisku wystrzelonego w tym kroku — od pozy lufy
 * (`bornSim`) do `nowSim`. Odcinek b.px → b.x kroku trwa tyle; kolizje liczą z tego ruch względny celu.
 */
export function projectileStepSpan(projectile, dt, nowSim = null) {
  let step = Math.max(0, finite(dt, 0));
  if (nowSim !== null && Number.isFinite(projectile?.bornSim)) {
    step = Math.min(step, Math.max(0, finite(nowSim, 0) - projectile.bornSim));
  }
  return step;
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
  const step = projectileStepSpan(projectile, dt, nowSim);
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
 * Czas wejścia odcinka (x0, y0) → (x1, y1) w koło (cx, cy, radius) jako ułamek odcinka [0, 1]:
 * 0 — początek już w kole, −1 — odcinek koła nie przecina. Bramka szeroka pocisku przed sweepem
 * kadłuba (pętla kandydatów w bulletsAndCollisionsStep). Do 2026-10-19 w src/physics/physicsKernel.js
 * (rusztowanie workera fizyki ciał heksowych — usunięte razem z silnikiem heksów).
 */
export function segmentCircleToi(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const radiusSq = radius * radius;
  if (fx * fx + fy * fy <= radiusSq) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;
  const root = Math.sqrt(discriminant);
  const inv = 1 / (2 * a);
  const near = (-b - root) * inv;
  if (near >= 0 && near <= 1) return near;
  const far = (-b + root) * inv;
  return far >= 0 && far <= 1 ? far : -1;
}

/**
 * Consumes a projectile after impact. A destructible hull is a solid target:
 * its impact response already propagates structural damage, so rail penetration
 * must not keep the projectile flying through the same ship after the first cell.
 */
export function shouldRemoveProjectileAfterImpact(projectile, hitSolidHull = false) {
  if (!projectile) return true;
  if (hitSolidHull || projectile.type !== 'rail') return true;

  projectile.penetration = (Number(projectile.penetration) || 1) - 1;
  return projectile.penetration <= 0;
}
