import { getCollisionMass, getHardness } from '../data/asteroidPhysics.js';

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getImageWidth(image) {
  return Math.max(1, positiveNumber(image?.naturalWidth, positiveNumber(image?.width, 1)));
}

function getImageHeight(image) {
  return Math.max(1, positiveNumber(image?.naturalHeight, positiveNumber(image?.height, 1)));
}

export function getImageMaxSide(image) {
  return Math.max(
    1,
    getImageWidth(image),
    getImageHeight(image)
  );
}

export function computeAsteroidSpriteScale(asteroid, image) {
  const worldDiameter = positiveNumber(asteroid?.scale, 1);
  return worldDiameter / getImageMaxSide(image);
}

export function buildAsteroidHexEntityModel(asteroid, image, options = {}) {
  const worldDiameter = positiveNumber(asteroid?.scale, 1);
  const spriteScale = computeAsteroidSpriteScale(asteroid, image);
  const spriteScaleX = worldDiameter / getImageWidth(image);
  const spriteScaleY = worldDiameter / getImageHeight(image);
  const collisionMass = positiveNumber(
    options.collisionMass,
    getCollisionMass(asteroid?.type, asteroid?.size)
  );
  const radius = positiveNumber(asteroid?.scale, 1) * 0.5;

  return {
    asteroidRef: asteroid,
    asteroidId: asteroid?.id,
    isAsteroidHex: true,
    destructionMaterial: 'brittle',
    noElasticity: true,
    noGpuSoftBody: true,
    isCollidable: true,
    noSplit: false,
    x: finiteNumber(asteroid?.worldX, 0),
    y: finiteNumber(asteroid?.worldY, 0),
    vx: finiteNumber(asteroid?.vx, 0),
    vy: finiteNumber(asteroid?.vy, 0),
    angle: finiteNumber(asteroid?.rotZ, 0),
    angVel: finiteNumber(asteroid?.spin, 0),
    mass: collisionMass,
    rammingMass: collisionMass,
    radius,
    hp: positiveNumber(asteroid?.hp, positiveNumber(asteroid?.hpMax, 1)),
    maxHp: positiveNumber(asteroid?.hpMax, positiveNumber(asteroid?.hp, 1)),
    hardness: finiteNumber(asteroid?.hardness, getHardness(asteroid?.type)),
    visual: {
      spriteScale,
      spriteScaleX,
      spriteScaleY,
      preserveBillboardLighting: true,
      preserveBillboardOrientation: true,
      spriteRotation: 0
    }
  };
}

export function syncAsteroidFromHexEntity(asteroid, entity) {
  if (!asteroid || !entity) return asteroid;
  asteroid.worldX = finiteNumber(entity.x ?? entity.pos?.x, asteroid.worldX);
  asteroid.worldY = finiteNumber(entity.y ?? entity.pos?.y, asteroid.worldY);
  asteroid.vx = finiteNumber(entity.vx ?? entity.vel?.x, asteroid.vx);
  asteroid.vy = finiteNumber(entity.vy ?? entity.vel?.y, asteroid.vy);
  asteroid.rotZ = finiteNumber(entity.angle, asteroid.rotZ);
  asteroid.spin = finiteNumber(entity.angVel, asteroid.spin);
  asteroid.mass = positiveNumber(entity.mass, asteroid.mass);
  asteroid.hp = Math.max(0, positiveNumber(entity.hp, asteroid.hp));
  return asteroid;
}

export function syncHexEntityFromAsteroid(asteroid, entity) {
  if (!asteroid || !entity) return entity;
  entity.x = finiteNumber(asteroid.worldX, entity.x);
  entity.y = finiteNumber(asteroid.worldY, entity.y);
  entity.vx = finiteNumber(asteroid.vx, entity.vx);
  entity.vy = finiteNumber(asteroid.vy, entity.vy);
  entity.angle = finiteNumber(asteroid.rotZ, entity.angle);
  entity.angVel = finiteNumber(asteroid.spin, entity.angVel);
  entity.mass = positiveNumber(entity.mass, getCollisionMass(asteroid.type, asteroid.size));
  entity.rammingMass = positiveNumber(entity.rammingMass, entity.mass);
  return entity;
}

export function integrateAsteroidHexEntityMotion(asteroid, entity, dt, options = {}) {
  if (!asteroid || !entity) return entity;
  const step = Math.max(0, Math.min(0.1, finiteNumber(dt, 0)));
  if (step <= 0) return entity;

  let vx = finiteNumber(entity.vx ?? entity.vel?.x, 0);
  let vy = finiteNumber(entity.vy ?? entity.vel?.y, 0);
  const maxVelocity = positiveNumber(options.maxVelocity, 0);
  if (maxVelocity > 0) {
    const speedSq = vx * vx + vy * vy;
    const maxSq = maxVelocity * maxVelocity;
    if (speedSq > maxSq) {
      const k = maxVelocity / Math.sqrt(speedSq);
      vx *= k;
      vy *= k;
    }
  }

  entity.vx = vx;
  entity.vy = vy;
  entity.x = finiteNumber(entity.x ?? entity.pos?.x, finiteNumber(asteroid.worldX, 0)) + vx * step;
  entity.y = finiteNumber(entity.y ?? entity.pos?.y, finiteNumber(asteroid.worldY, 0)) + vy * step;
  entity.angle = finiteNumber(entity.angle, finiteNumber(asteroid.rotZ, 0)) + finiteNumber(entity.angVel, 0) * step;

  return syncAsteroidFromHexEntity(asteroid, entity);
}
