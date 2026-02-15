/**
 * Hybrid hex destruction engine ported from
 * destruktorhybridclaude_crushfix_edgefix_perf_flickerfix.html.
 */

export const DESTRUCTOR_CONFIG = {
  gridDivisions: 10,
  shardHP: 100,
  armorThreshold: 0.4,
  maxDeform: 120.0,
  tearThreshold: 180.0,
  bendingRadius: 100.0,
  playerStartingMass: 800000,
  friction: 0.99,
  shardMass: 10.0,
  visualRotationOffset: 0,
  yieldPoint: 200.0,
  restitution: 0.05,
  plasticity: 0.00002,
  collisionDeformScale: 1.0,
  collisionSearchRadius: 5,
  collisionIterations: 2,
  crushMinSpeed: 1.5,
  crushPenetrationMin: 0.15,
  crushVelK: 0.15,
  crushPenK: 10.0,
  shearK: 0.06,
  crushSeparation: 0.25,
  crushImpulseScale: 0.45,
  recoverSpeed: 1.0,
  repairRate: 100,
  visualLerpSpeed: 5.0,
  softBodyTension: 0.15,
  tearSensitivity: 0.15,
  maxFray: 15.0,
  deformMul: 0.6,
  inflictedDamageMult: 1.0,
  beamWidth: 12,
  beamForce: 400,
  splitForceThreshold: 50,
  splitDamageThreshold: 200,
  splitCheckInterval: 10
};

const HEX_R = DESTRUCTOR_CONFIG.gridDivisions;
const HEX_HEIGHT = Math.sqrt(3) * HEX_R;
const HEX_SPACING = HEX_R * 1.5;
const HIT_RAD = HEX_R * 1.3;
const HIT_RAD_SQ = HIT_RAD * HIT_RAD;
const BENDING_RAD_SQ = DESTRUCTOR_CONFIG.bendingRadius * DESTRUCTOR_CONFIG.bendingRadius;

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

let HEX_SHIPS_3D_ACTIVE = false;

export function setHexShips3DActive(active) {
  HEX_SHIPS_3D_ACTIVE = !!active;
}

export function isHexShips3DActive() {
  return HEX_SHIPS_3D_ACTIVE;
}

const SEARCH_OFFSETS_CACHE = Object.create(null);
function getSearchOffsets(radius) {
  const r = Math.max(0, radius | 0);
  let arr = SEARCH_OFFSETS_CACHE[r];
  if (arr) return arr;
  const list = [];
  const r2 = r * r;
  for (let dc = -r; dc <= r; dc++) {
    for (let dr = -r; dr <= r; dr++) {
      if (dc * dc + dr * dr <= r2) list.push(dc, dr);
    }
  }
  arr = (r <= 127) ? new Int8Array(list) : new Int16Array(list);
  SEARCH_OFFSETS_CACHE[r] = arr;
  return arr;
}

function isHexEligible(entity) {
  if (!entity) return false;
  if (entity.fighter) return false;
  if (entity.type && ['fighter', 'interceptor', 'drone'].includes(entity.type)) return false;
  return true;
}

function getFinalScale(entity) {
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntitySpriteRotation(entity) {
  const r =
    (entity?.visual && typeof entity.visual.spriteRotation === 'number') ? entity.visual.spriteRotation
      : (entity?.capitalProfile && typeof entity.capitalProfile.spriteRotation === 'number') ? entity.capitalProfile.spriteRotation
        : (entity?.profile && typeof entity.profile.spriteRotation === 'number') ? entity.profile.spriteRotation
          : 0;
  return Number.isFinite(r) ? r : 0;
}

function getEntityPosX(entity) {
  if (!entity) return 0;
  if (entity.pos && typeof entity.pos.x === 'number') return entity.pos.x;
  return Number(entity.x) || 0;
}

function getEntityPosY(entity) {
  if (!entity) return 0;
  if (entity.pos && typeof entity.pos.y === 'number') return entity.pos.y;
  return Number(entity.y) || 0;
}

function setEntityPos(entity, x, y) {
  if (!entity) return;
  if (entity.pos && typeof entity.pos.x === 'number' && typeof entity.pos.y === 'number') {
    entity.pos.x = x;
    entity.pos.y = y;
  }
  entity.x = x;
  entity.y = y;
}

function addEntityPosition(entity, dx, dy) {
  setEntityPos(entity, getEntityPosX(entity) + dx, getEntityPosY(entity) + dy);
}

function getEntityVelX(entity) {
  if (!entity) return 0;
  if (entity.vel && typeof entity.vel.x === 'number') return entity.vel.x;
  return Number(entity.vx) || 0;
}

function getEntityVelY(entity) {
  if (!entity) return 0;
  if (entity.vel && typeof entity.vel.y === 'number') return entity.vel.y;
  return Number(entity.vy) || 0;
}

function setEntityVelocity(entity, vx, vy) {
  if (!entity) return;
  if (entity.vel && typeof entity.vel.x === 'number' && typeof entity.vel.y === 'number') {
    entity.vel.x = vx;
    entity.vel.y = vy;
  }
  entity.vx = vx;
  entity.vy = vy;
}

function addEntityVelocity(entity, dvx, dvy) {
  setEntityVelocity(entity, getEntityVelX(entity) + dvx, getEntityVelY(entity) + dvy);
}

function getEntityAngle(entity) {
  return Number(entity?.angle) || 0;
}

function getEntityHexAngle(entity) {
  return getEntityAngle(entity) + getEntitySpriteRotation(entity) + DESTRUCTOR_CONFIG.visualRotationOffset;
}

function getEntityAngVel(entity) {
  return Number(entity?.angVel) || 0;
}

function addEntityAngVel(entity, da) {
  if (!entity) return;
  entity.angVel = getEntityAngVel(entity) + da;
}

function getEntityMass(entity) {
  const m = Number(entity?.mass);
  if (Number.isFinite(m) && m > 0) return m;
  return 100;
}

function worldToScreenFallback(wx, wy, cam, ctx) {
  return {
    x: (wx - cam.x) * cam.zoom + ctx.canvas.width / 2,
    y: (wy - cam.y) * cam.zoom + ctx.canvas.height / 2
  };
}

function updateShardLocal(entity, shard) {
  const cx = entity.hexGrid.srcWidth * 0.5;
  const cy = entity.hexGrid.srcHeight * 0.5;
  const px = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
  const py = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
  shard.lx = (shard.gridX + shard.deformation.x) - cx - px;
  shard.ly = (shard.gridY + shard.deformation.y) - cy - py;
}

function rebuildNeighbors(grid) {
  if (!grid?.shards || !grid.grid) return;
  const cols = grid.cols | 0;
  const rows = grid.rows | 0;
  for (const s of grid.shards) {
    s.neighbors = [];
    const odd = (s.c % 2 !== 0);
    const offsets = odd
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    for (let i = 0; i < 6; i++) {
      const nc = s.c + offsets[i][0];
      const nr = s.r + offsets[i][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = grid.grid[nc + nr * cols];
      if (n) s.neighbors.push(n);
    }
  }
}

function updateHexCache(entity) {
  if (!entity?.hexGrid?.cacheCtx) return;
  const g = entity.hexGrid;
  const ctx = g.cacheCtx;
  ctx.clearRect(0, 0, g.srcWidth, g.srcHeight);
  for (const s of g.shards) {
    if (!s.active || s.isDebris) continue;
    updateShardLocal(entity, s);
    s.drawShape(ctx);
  }
  g.cacheDirty = false;
  g.textureDirty = false;
  g.meshDirty = false;
  g.gpuTextureNeedsUpdate = false;
}

export function refreshHexBodyCache(entity) {
  if (!entity?.hexGrid) return;
  const grid = entity.hexGrid;
  const needsMeshRefresh2D = !HEX_SHIPS_3D_ACTIVE && !!grid.meshDirty;
  if (grid.cacheDirty || grid.textureDirty || needsMeshRefresh2D) updateHexCache(entity);
}

class HexShard {
  constructor(img, damagedImg, gridX, gridY, radius, c, r, color = null) {
    this.img = img;
    this.damagedImg = damagedImg;
    this.gridX = gridX;
    this.gridY = gridY;
    this.radius = radius;
    this.c = c;
    this.r = r;
    this.color = color;
    this.active = true;
    this.isDebris = false;
    this.maxHp = DESTRUCTOR_CONFIG.shardHP;
    this.hp = this.maxHp;
    this.deformation = { x: 0, y: 0 };
    this.targetDeformation = { x: 0, y: 0 };
    this.frays = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
    this.worldX = 0;
    this.worldY = 0;
    this.dvx = 0;
    this.dvy = 0;
    this.drot = 0;
    this.alpha = 1;
    this.angle = 0;
    this.scale = 1;
    this.neighbors = [];
    this.verts = [];
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      this.verts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    }
    this.lx = 0;
    this.ly = 0;
    this.origLx = 0;
    this.origLy = 0;
  }

  repair(dt) {
    if (!this.active || this.isDebris) return;
    const k = Math.min(1, DESTRUCTOR_CONFIG.recoverSpeed * dt);
    this.targetDeformation.x *= (1 - k);
    this.targetDeformation.y *= (1 - k);
    this.hp = Math.min(this.maxHp, this.hp + DESTRUCTOR_CONFIG.repairRate * dt);
  }

  updateAnimation(dt) {
    const spd = DESTRUCTOR_CONFIG.visualLerpSpeed;
    const dx = this.targetDeformation.x - this.deformation.x;
    const dy = this.targetDeformation.y - this.deformation.y;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      this.deformation.x += dx * spd * dt;
      this.deformation.y += dy * spd * dt;
      return true;
    }
    return false;
  }

  applyDeformation(vecX, vecY) {
    this.targetDeformation.x += vecX;
    this.targetDeformation.y += vecY;
    const maxD = DESTRUCTOR_CONFIG.maxDeform;
    const tx = this.targetDeformation.x;
    const ty = this.targetDeformation.y;
    const d2 = tx * tx + ty * ty;
    if (d2 > maxD * maxD) {
      const s = maxD / Math.sqrt(d2);
      this.targetDeformation.x *= s;
      this.targetDeformation.y *= s;
    }
    const tt = DESTRUCTOR_CONFIG.tearThreshold;
    if (this.targetDeformation.x * this.targetDeformation.x + this.targetDeformation.y * this.targetDeformation.y > tt * tt) {
      this.hp = 0;
    }
  }

  becomeDebris(impulseX, impulseY, parentEntity, scale = 1.0) {
    if (this.isDebris) return;
    this.scale = scale;
    const px = getEntityPosX(parentEntity);
    const py = getEntityPosY(parentEntity);
    const rotation = getEntityHexAngle(parentEntity);
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const cx = parentEntity.hexGrid.srcWidth * 0.5;
    const cy = parentEntity.hexGrid.srcHeight * 0.5;
    const pX = parentEntity.hexGrid.pivot ? parentEntity.hexGrid.pivot.x : 0;
    const pY = parentEntity.hexGrid.pivot ? parentEntity.hexGrid.pivot.y : 0;
    const startLx = (this.gridX - cx) + this.deformation.x - pX;
    const startLy = (this.gridY - cy) + this.deformation.y - pY;
    this.worldX = px + (startLx * scale) * c - (startLy * scale) * s;
    this.worldY = py + (startLx * scale) * s + (startLy * scale) * c;
    let vx = getEntityVelX(parentEntity);
    let vy = getEntityVelY(parentEntity);
    const angVel = getEntityAngVel(parentEntity);
    const rx = (startLx * scale) * c - (startLy * scale) * s;
    const ry = (startLx * scale) * s + (startLy * scale) * c;
    vx += -angVel * ry;
    vy += angVel * rx;
    this.dvx = vx + impulseX + this.deformation.x * 3;
    this.dvy = vy + impulseY + this.deformation.y * 3;
    this.drot = (Math.random() - 0.5) * 8;
    this.angle = rotation;
    this.alpha = 1;
    this.isDebris = true;
    this.active = true;
    DestructorSystem.debris.push(this);
    if (parentEntity.mass) {
      parentEntity.mass -= DESTRUCTOR_CONFIG.shardMass;
      if (parentEntity.mass < 10) parentEntity.mass = 10;
    }
  }

  updateDebris(dt) {
    this.worldX += this.dvx * dt;
    this.worldY += this.dvy * dt;
    this.angle += this.drot * dt;
    this.dvx *= DESTRUCTOR_CONFIG.friction;
    this.dvy *= DESTRUCTOR_CONFIG.friction;
    this.alpha -= dt * 0.2;
    if (this.alpha <= 0) this.active = false;
  }

  drawDebris(ctx, camera, worldToScreenFunc) {
    if (!this.active || !this.isDebris) return;
    const toScreen = worldToScreenFunc || worldToScreenFallback;
    const p = toScreen(this.worldX, this.worldY, camera, ctx);
    if (p.x < -100 || p.x > ctx.canvas.width + 100 || p.y < -100 || p.y > ctx.canvas.height + 100) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    const s = camera.zoom * (this.scale || 1);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.max(0, this.alpha);
    this._drawHexPath(ctx);
    ctx.clip();
    if (this.damagedImg) ctx.drawImage(this.damagedImg, -this.gridX, -this.gridY);
    else if (this.img) ctx.drawImage(this.img, -this.gridX, -this.gridY);
    else {
      ctx.fillStyle = '#444';
      ctx.fill();
    }
    ctx.restore();
  }

  drawShape(ctx) {
    ctx.save();
    ctx.translate(this.gridX + this.deformation.x, this.gridY + this.deformation.y);
    this._drawHexPath(ctx);
    ctx.save();
    ctx.clip();
    if (this.color) {
      ctx.fillStyle = this.color;
      ctx.fill();
    } else {
      if (this.damagedImg) ctx.drawImage(this.damagedImg, -this.gridX, -this.gridY);
      else {
        ctx.fillStyle = '#222';
        ctx.fill();
      }
      if (this.img) {
        const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
        const threshold = DESTRUCTOR_CONFIG.armorThreshold;
        let armorAlpha = 0;
        if (hpRatio > threshold) armorAlpha = (hpRatio - threshold) / Math.max(0.0001, 1 - threshold);
        if (armorAlpha > 0.01) {
          ctx.globalAlpha = armorAlpha;
          ctx.drawImage(this.img, -this.gridX, -this.gridY);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
    const stressSq = this.deformation.x * this.deformation.x + this.deformation.y * this.deformation.y;
    if (stressSq > 25) {
      const ratio = Math.min(1, Math.sqrt(stressSq) / DESTRUCTOR_CONFIG.tearThreshold);
      ctx.fillStyle = `rgba(255, ${Math.floor(ratio * 100)}, 0, ${ratio * 0.6})`;
      ctx.fill();
    }
    ctx.restore();
  }

  _drawHexPath(ctx) {
    ctx.beginPath();
    const overlap = 1.08;
    let fx = this.verts[0].x + this.frays[0].x;
    let fy = this.verts[0].y + this.frays[0].y;
    ctx.moveTo(fx * overlap, fy * overlap);
    for (let i = 1; i < 6; i++) {
      fx = this.verts[i].x + this.frays[i].x;
      fy = this.verts[i].y + this.frays[i].y;
      ctx.lineTo(fx * overlap, fy * overlap);
    }
    ctx.closePath();
  }
}

export const DestructorSystem = {
  debris: [],
  splitQueue: [],
  _tick: 0,
  _frameContacts: 0,
  _contactsBuf: Array.from({ length: 8 }, () => ({
    shardA: null,
    shardB: null,
    worldAx: 0,
    worldAy: 0,
    worldBx: 0,
    worldBy: 0,
    normalX: 0,
    normalY: 0,
    penetration: 0
  })),
  perf: {
    lastUpdateMs: 0,
    lastDeformMs: 0,
    lastCollisionMs: 0,
    lastContacts: 0
  },

  update(dt, entities) {
    const tUpdate0 = nowMs();
    const list = Array.isArray(entities) ? entities : [];
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : (1 / 120);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.updateDebris(step);
      if (!d.active) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }
    this._tick++;
    const tDeform0 = nowMs();
    this.updateVisualDeformation(list, step);
    const tAfterDeform = nowMs();
    this.simulateElasticity(list, step);
    this._frameContacts = 0;
    const tCollision0 = nowMs();
    const iters = Math.max(1, DESTRUCTOR_CONFIG.collisionIterations | 0);
    for (let i = 0; i < iters; i++) this.resolveCollisions(list, step, i === 0);
    const tAfterCollision = nowMs();
    const splitInterval = Math.max(1, DESTRUCTOR_CONFIG.splitCheckInterval | 0);
    if (this._tick % splitInterval === 0 && this.splitQueue.length > 0) this.processSplits(list);
    const tUpdateEnd = nowMs();
    this.perf.lastUpdateMs = tUpdateEnd - tUpdate0;
    this.perf.lastDeformMs = tAfterDeform - tDeform0;
    this.perf.lastCollisionMs = tAfterCollision - tCollision0;
    this.perf.lastContacts = this._frameContacts;
  },

  updateVisualDeformation(entities, dt) {
    for (const e of entities) {
      if (!e?.hexGrid?.shards) continue;
      let moving = false;
      for (const s of e.hexGrid.shards) {
        if (!s.active || s.isDebris) continue;
        if (s.updateAnimation(dt)) moving = true;
      }
      if (moving) e.hexGrid.meshDirty = true;
    }
  },

  simulateElasticity(entities, dt) {
    const tension = DESTRUCTOR_CONFIG.softBodyTension;
    if (tension <= 0) return;
    const k = 1 - Math.exp(-tension * dt * 60);
    for (const e of entities) {
      if (!e?.hexGrid?.shards) continue;
      for (const s of e.hexGrid.shards) {
        if (!s.active || s.isDebris) continue;
        for (const n of s.neighbors) {
          if (!n.active || n.isDebris) continue;
          if (n.c < s.c || (n.c === s.c && n.r <= s.r)) continue;
          const ax = s.targetDeformation.x;
          const ay = s.targetDeformation.y;
          const bx = n.targetDeformation.x;
          const by = n.targetDeformation.y;
          const avgX = (ax + bx) * 0.5;
          const avgY = (ay + by) * 0.5;
          s.targetDeformation.x += (avgX - ax) * k;
          s.targetDeformation.y += (avgY - ay) * k;
          n.targetDeformation.x += (avgX - bx) * k;
          n.targetDeformation.y += (avgY - by) * k;
        }
      }
      e.hexGrid.meshDirty = true;
    }
  },

  repair(entities, dt) {
    const list = Array.isArray(entities) ? entities : [];
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : 0.1;
    for (const e of list) {
      if (!e?.hexGrid?.shards) continue;
      let anyFix = false;
      for (const s of e.hexGrid.shards) {
        if (!s.active || s.isDebris) continue;
        if (Math.abs(s.deformation.x) > 0.1 || Math.abs(s.deformation.y) > 0.1 || s.hp < s.maxHp) {
          s.repair(step);
          anyFix = true;
        }
      }
      if (anyFix) {
        e.hexGrid.meshDirty = true;
        e.hexGrid.textureDirty = true;
        e.hexGrid.cacheDirty = true;
      }
    }
  },

  applyImpact(entity, worldX, worldY, damage = 0, bulletVel = { x: 0, y: 0 }) {
    if (!entity?.hexGrid || !isHexEligible(entity)) return false;

    const angle = getEntityHexAngle(entity);
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    const dx = worldX - getEntityPosX(entity);
    const dy = worldY - getEntityPosY(entity);
    const localX = dx * c + dy * s;
    const localY = -dx * s + dy * c;

    const cx = entity.hexGrid.srcWidth * 0.5;
    const cy = entity.hexGrid.srcHeight * 0.5;
    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;

    const gridX = localX + cx + pX;
    const gridY = localY + cy + pY;

    const cols = entity.hexGrid.cols | 0;
    const rows = entity.hexGrid.rows | 0;
    const grid = entity.hexGrid.grid;
    if (!grid || cols <= 0 || rows <= 0) return false;

    const approxC = Math.round(gridX / HEX_SPACING);
    const approxR = Math.round(gridY / HEX_HEIGHT);
    const searchR = Math.max(2, (DESTRUCTOR_CONFIG.collisionSearchRadius | 0) - 2);
    const offsets = getSearchOffsets(searchR);

    let hitShard = null;
    let bestD2 = Infinity;

    for (let oi = 0; oi < offsets.length; oi += 2) {
      const ic = approxC + offsets[oi];
      const ir = approxR + offsets[oi + 1];
      if (ic < 0 || ir < 0 || ic >= cols || ir >= rows) continue;
      const shard = grid[ic + ir * cols];
      if (!shard || !shard.active || shard.isDebris) continue;
      const sx = shard.gridX + shard.deformation.x;
      const sy = shard.gridY + shard.deformation.y;
      const d2 = (sx - gridX) ** 2 + (sy - gridY) ** 2;
      if (d2 < HIT_RAD_SQ * 4 && d2 < bestD2) {
        bestD2 = d2;
        hitShard = shard;
      }
    }

    if (!hitShard) return false;
    if (damage <= 0) return true;

    let forceX = (bulletVel?.x || 0) * c + (bulletVel?.y || 0) * s;
    let forceY = -(bulletVel?.x || 0) * s + (bulletVel?.y || 0) * c;
    if (Math.hypot(forceX, forceY) < 0.001) {
      const fx = (hitShard.gridX - cx - pX) - localX;
      const fy = (hitShard.gridY - cy - pY) - localY;
      const fm = Math.hypot(fx, fy) || 1;
      forceX = (fx / fm) * Math.max(10, damage * 0.4);
      forceY = (fy / fm) * Math.max(10, damage * 0.4);
    }

    const scale = Math.max(0.35, damage / 80);
    this.distributeStructuralDamage(
      entity,
      localX,
      localY,
      forceX * 0.05 * scale,
      forceY * 0.05 * scale,
      1.0
    );

    hitShard.hp -= Math.max(1, damage * 0.9);
    const splitDamageThreshold = DESTRUCTOR_CONFIG.splitDamageThreshold ?? 200;
    if (hitShard.hp <= 0 && !hitShard.isDebris) {
      this.destroyShard(entity, hitShard, { x: getEntityVelX(entity), y: getEntityVelY(entity) });
      if (damage >= splitDamageThreshold) this.splitQueue.push(entity);
    }

    entity.hexGrid.meshDirty = true;
    entity.hexGrid.textureDirty = true;
    entity.hexGrid.cacheDirty = true;
    return true;
  },

  distributeStructuralDamage(entity, impactLocalX, impactLocalY, forceX, forceY, damageScale = 1.0) {
    if (!entity?.hexGrid?.shards) return;

    const radius = DESTRUCTOR_CONFIG.bendingRadius;
    const invRadius = 1 / radius;
    const deformMul = DESTRUCTOR_CONFIG.deformMul;
    let anyDestroyed = false;
    let anyMeshChange = false;
    let anyTextureChange = false;

    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
    const impactX = impactLocalX + pX;
    const impactY = impactLocalY + pY;

    const tearSensitivity = DESTRUCTOR_CONFIG.tearSensitivity;
    const maxFray = DESTRUCTOR_CONFIG.maxFray;
    const maxFraySq = maxFray * maxFray;

    const forceMag = Math.hypot(forceX, forceY);
    const doFray = (damageScale > 0) && (forceMag > 2);
    const fnx = doFray ? forceX / forceMag : 0;
    const fny = doFray ? forceY / forceMag : 0;
    const hpDmgBase = (Math.abs(forceX) + Math.abs(forceY)) * DESTRUCTOR_CONFIG.inflictedDamageMult * damageScale;

    const cx = entity.hexGrid.srcWidth * 0.5;
    const cy = entity.hexGrid.srcHeight * 0.5;
    const cols = entity.hexGrid.cols;
    const rows = entity.hexGrid.rows;
    const grid = entity.hexGrid.grid;

    const approxC = Math.round((impactX + cx) / HEX_SPACING);
    const approxR = Math.round((impactY + cy) / HEX_HEIGHT);
    const cellRadC = Math.ceil(radius / HEX_SPACING) + 2;
    const cellRadR = Math.ceil(radius / HEX_HEIGHT) + 2;

    let c0 = approxC - cellRadC;
    let c1 = approxC + cellRadC;
    let r0 = approxR - cellRadR;
    let r1 = approxR + cellRadR;

    if (grid && cols && rows) {
      if (c0 < 0) c0 = 0;
      if (r0 < 0) r0 = 0;
      if (c1 >= cols) c1 = cols - 1;
      if (r1 >= rows) r1 = rows - 1;

      for (let r = r0; r <= r1; r++) {
        const rowBase = r * cols;
        for (let c = c0; c <= c1; c++) {
          const shard = grid[rowBase + c];
          if (!shard || !shard.active || shard.isDebris) continue;

          const dx = (shard.gridX - cx) - impactX;
          const dy = (shard.gridY - cy) - impactY;
          const d2 = dx * dx + dy * dy;
          if (d2 >= BENDING_RAD_SQ) continue;

          const factor = 1 - Math.sqrt(d2) * invRadius;
          if (factor <= 0) continue;
          const influence = factor * factor * (3 - 2 * factor);

          shard.applyDeformation(forceX * influence * deformMul, forceY * influence * deformMul);
          anyMeshChange = true;

          if (doFray) {
            const tearBase = forceMag * influence * tearSensitivity;
            for (let i = 0; i < 6; i++) {
              const rnd = Math.random() * tearBase;
              const f = shard.frays[i];
              f.x += fnx * rnd + (Math.random() - 0.5) * rnd * 0.5;
              f.y += fny * rnd + (Math.random() - 0.5) * rnd * 0.5;
              const fraySq = f.x * f.x + f.y * f.y;
              if (fraySq > maxFraySq) {
                const s = maxFray / Math.sqrt(fraySq);
                f.x *= s;
                f.y *= s;
              }
            }
            anyTextureChange = true;
          }

          if (damageScale > 0) {
            shard.hp -= hpDmgBase * influence;
            if (!HEX_SHIPS_3D_ACTIVE) anyTextureChange = true;
            if (shard.hp <= 0 && !shard.isDebris) {
              this.destroyShard(entity, shard, { x: getEntityVelX(entity), y: getEntityVelY(entity) });
              anyDestroyed = true;
            }
          }
        }
      }
    }

    const splitForceThreshold = DESTRUCTOR_CONFIG.splitForceThreshold ?? 50;
    if (damageScale > 0 && anyDestroyed && forceMag > splitForceThreshold) this.splitQueue.push(entity);
    if (anyMeshChange) entity.hexGrid.meshDirty = true;
    if (anyTextureChange) {
      entity.hexGrid.textureDirty = true;
      entity.hexGrid.cacheDirty = true;
    }
  },

  resolveCollisions(entities, dt, doDamage) {
    const len = entities.length;
    for (let i = 0; i < len; i++) {
      const A = entities[i];
      if (!A?.hexGrid || A.dead || A.isCollidable === false) continue;
      const ax = getEntityPosX(A);
      const ay = getEntityPosY(A);
      const ar = A.radius || 100;
      for (let j = i + 1; j < len; j++) {
        const B = entities[j];
        if (!B?.hexGrid || B.dead || B.isCollidable === false) continue;
        const rootA = A.owner || A;
        const rootB = B.owner || B;
        if (rootA === rootB || rootA === B || rootB === A) continue;
        const dx = ax - getEntityPosX(B);
        const dy = ay - getEntityPosY(B);
        const rs = ar + (B.radius || 100);
        if (dx * dx + dy * dy > rs * rs) continue;
        this.collideEntities(A, B, dt, doDamage);
      }
    }
  },

  collideEntities(A, B, dt, doDamage) {
    let iterator = A;
    let gridHolder = B;
    if (A.hexGrid.shards.length > B.hexGrid.shards.length) {
      iterator = B;
      gridHolder = A;
    }

    const massA = getEntityMass(A);
    const massB = getEntityMass(B);

    const angIter = getEntityHexAngle(iterator);
    const angGrid = getEntityHexAngle(gridHolder);
    const cosI = Math.cos(angIter);
    const sinI = Math.sin(angIter);
    const cosG = Math.cos(angGrid);
    const sinG = Math.sin(angGrid);

    const cxI = iterator.hexGrid.srcWidth * 0.5;
    const cyI = iterator.hexGrid.srcHeight * 0.5;
    const cxG = gridHolder.hexGrid.srcWidth * 0.5;
    const cyG = gridHolder.hexGrid.srcHeight * 0.5;

    const pIx = iterator.hexGrid.pivot ? iterator.hexGrid.pivot.x : 0;
    const pIy = iterator.hexGrid.pivot ? iterator.hexGrid.pivot.y : 0;
    const pGx = gridHolder.hexGrid.pivot ? gridHolder.hexGrid.pivot.x : 0;
    const pGy = gridHolder.hexGrid.pivot ? gridHolder.hexGrid.pivot.y : 0;

    const iterRadius = iterator.radius || 100;
    const ix = getEntityPosX(iterator);
    const iy = getEntityPosY(iterator);
    const gx = getEntityPosX(gridHolder);
    const gy = getEntityPosY(gridHolder);

    let minC = Infinity;
    let maxC = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    const searchR = DESTRUCTOR_CONFIG.collisionSearchRadius ?? 4;

    for (let k = 0; k < 4; k++) {
      const sx = (k === 0 || k === 3) ? -iterRadius : iterRadius;
      const sy = (k < 2) ? -iterRadius : iterRadius;
      const wx = ix + sx;
      const wy = iy + sy;
      const dx = wx - gx;
      const dy = wy - gy;
      const hlx = dx * cosG + dy * sinG;
      const hly = -dx * sinG + dy * cosG;
      const c = Math.floor((hlx + cxG + pGx) / HEX_SPACING);
      const r = Math.floor((hly + cyG + pGy) / HEX_HEIGHT);
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }

    const pad = searchR + 2;
    minC -= pad;
    maxC += pad;
    minR -= pad;
    maxR += pad;

    const holderGrid = gridHolder.hexGrid.grid;
    const iterGrid = iterator.hexGrid.grid;
    const holderCols = gridHolder.hexGrid.cols || 0;
    const holderRows = gridHolder.hexGrid.rows || 0;
    const iterCols = iterator.hexGrid.cols || 0;
    const iterRows = iterator.hexGrid.rows || 0;
    if (!holderGrid || !iterGrid || holderCols <= 0 || holderRows <= 0 || iterCols <= 0 || iterRows <= 0) return;

    if (minC < 0) minC = 0;
    if (minR < 0) minR = 0;
    if (maxC >= holderCols) maxC = holderCols - 1;
    if (maxR >= holderRows) maxR = holderRows - 1;
    if (minC > maxC || minR > maxR) return;

    const contacts = this._contactsBuf;
    const maxContacts = 8;
    let contactsCount = 0;
    const offsets = getSearchOffsets(searchR);
    const cds = DESTRUCTOR_CONFIG.collisionDeformScale ?? 1.0;

    for (let r = minR; r <= maxR; r++) {
      const rowBase = r * holderCols;
      for (let c = minC; c <= maxC; c++) {
        const sG = holderGrid[rowBase + c];
        if (!sG || !sG.active || sG.isDebris) continue;

        const relGx = (sG.gridX - cxG) + sG.deformation.x * cds - pGx;
        const relGy = (sG.gridY - cyG) + sG.deformation.y * cds - pGy;
        const worldGx = gx + relGx * cosG - relGy * sinG;
        const worldGy = gy + relGx * sinG + relGy * cosG;

        const dx = worldGx - ix;
        const dy = worldGy - iy;
        const localIx = dx * cosI + dy * sinI;
        const localIy = -dx * sinI + dy * cosI;
        const gridIx = localIx + cxI + pIx;
        const gridIy = localIy + cyI + pIy;

        const approxC = Math.round(gridIx / HEX_SPACING);
        const approxR = Math.round(gridIy / HEX_HEIGHT);

        // Quick reject: skip whole offset scan when target cell is far outside iterator grid.
        if (approxC < -searchR || approxC >= iterCols + searchR || approxR < -searchR || approxR >= iterRows + searchR) {
          continue;
        }

        for (let oi = 0; oi < offsets.length; oi += 2) {
          const ic = approxC + offsets[oi];
          const ir = approxR + offsets[oi + 1];
          if (ic < 0 || ir < 0 || ic >= iterCols || ir >= iterRows) continue;

          const sI = iterGrid[ic + ir * iterCols];
          if (!sI || !sI.active || sI.isDebris) continue;

          const gi = sI.gridX + sI.deformation.x * cds;
          const gj = sI.gridY + sI.deformation.y * cds;
          const ddx = gi - gridIx;
          const ddy = gj - gridIy;
          if (ddx * ddx + ddy * ddy >= HIT_RAD_SQ) continue;

          const relIx = (sI.gridX - cxI) + sI.deformation.x * cds - pIx;
          const relIy = (sI.gridY - cyI) + sI.deformation.y * cds - pIy;
          const worldIx = ix + relIx * cosI - relIy * sinI;
          const worldIy = iy + relIx * sinI + relIy * cosI;

          const normalX = worldIx - worldGx;
          const normalY = worldIy - worldGy;
          const dist = Math.hypot(normalX, normalY);

          const swapped = iterator !== A;
          const ct = contacts[contactsCount];
          ct.shardA = swapped ? sG : sI;
          ct.shardB = swapped ? sI : sG;
          ct.worldAx = swapped ? worldGx : worldIx;
          ct.worldAy = swapped ? worldGy : worldIy;
          ct.worldBx = swapped ? worldIx : worldGx;
          ct.worldBy = swapped ? worldIy : worldGy;
          ct.normalX = swapped ? -normalX : normalX;
          ct.normalY = swapped ? -normalY : normalY;
          ct.penetration = Math.max(0, HIT_RAD - dist);
          contactsCount++;
          if (contactsCount >= maxContacts) break;
        }
        if (contactsCount >= maxContacts) break;
      }
      if (contactsCount >= maxContacts) break;
    }

    if (contactsCount === 0) return;
    this._frameContacts += contactsCount;

    let worldHitX = 0;
    let worldHitY = 0;
    let nx = 0;
    let ny = 0;
    let penetration = 0;
    for (let i = 0; i < contactsCount; i++) {
      const ct = contacts[i];
      worldHitX += (ct.worldAx + ct.worldBx) * 0.5;
      worldHitY += (ct.worldAy + ct.worldBy) * 0.5;
      nx += ct.normalX;
      ny += ct.normalY;
      if (ct.penetration > penetration) penetration = ct.penetration;
    }
    worldHitX /= contactsCount;
    worldHitY /= contactsCount;

    const aX = getEntityPosX(A);
    const aY = getEntityPosY(A);
    const bX = getEntityPosX(B);
    const bY = getEntityPosY(B);

    let normalLenSq = nx * nx + ny * ny;
    if (normalLenSq < 1e-12) {
      nx = aX - bX;
      ny = aY - bY;
      normalLenSq = nx * nx + ny * ny;
      if (normalLenSq < 1e-12) normalLenSq = 1;
    }
    const invNormalLen = 1 / Math.sqrt(normalLenSq);
    nx *= invNormalLen;
    ny *= invNormalLen;

    const rAx = worldHitX - aX;
    const rAy = worldHitY - aY;
    const rBx = worldHitX - bX;
    const rBy = worldHitY - bY;

    const vAx = getEntityVelX(A) - getEntityAngVel(A) * rAy;
    const vAy = getEntityVelY(A) + getEntityAngVel(A) * rAx;
    const vBx = getEntityVelX(B) - getEntityAngVel(B) * rBy;
    const vBy = getEntityVelY(B) + getEntityAngVel(B) * rBx;

    const dvx = vAx - vBx;
    const dvy = vAy - vBy;

    const velAlongNormal = dvx * nx + dvy * ny;
    const tx = -ny;
    const ty = nx;
    const velTangent = dvx * tx + dvy * ty;

    const invMassA = 1 / massA;
    const invMassB = 1 / massB;
    const slop = 0.01;
    const pen = Math.max(0, penetration - slop);

    let isDestruction = false;

    if (velAlongNormal < 0) {
      const iaScale = 0.5;
      const ra = Math.max(1, A.radius || 100);
      const rb = Math.max(1, B.radius || 100);
      const invIa = 1 / (iaScale * massA * ra * ra);
      const invIb = 1 / (iaScale * massB * rb * rb);

      const rnA = rAx * ny - rAy * nx;
      const rnB = rBx * ny - rBy * nx;
      const denom = invMassA + invMassB + rnA * rnA * invIa + rnB * rnB * invIb;

      if (Number.isFinite(denom) && denom > 1e-8) {
        const restBase = DESTRUCTOR_CONFIG.restitution;
        const jTest = Math.abs((-(1 + restBase) * velAlongNormal) / denom);
        isDestruction = jTest > DESTRUCTOR_CONFIG.yieldPoint;

        const restitution = isDestruction ? 0 : restBase;
        let j = (-(1 + restitution) * velAlongNormal) / denom;
        if (isDestruction) j *= (DESTRUCTOR_CONFIG.crushImpulseScale ?? 0.45);

        const impulseX = j * nx;
        const impulseY = j * ny;
        addEntityVelocity(A, impulseX * invMassA, impulseY * invMassA);
        addEntityVelocity(B, -impulseX * invMassB, -impulseY * invMassB);
        addEntityAngVel(A, rnA * j * invIa);
        addEntityAngVel(B, -rnB * j * invIb);

        let jt = -velTangent;
        const tDen = invMassA + invMassB + (rAx * ty - rAy * tx) ** 2 * invIa + (rBx * ty - rBy * tx) ** 2 * invIb;
        jt = (Number.isFinite(tDen) && tDen > 1e-8) ? (jt / tDen) : 0;
        const mu = 0.5;
        const maxF = Math.abs(j) * mu;
        if (Math.abs(jt) > maxF) jt = -maxF * Math.sign(velTangent || 1);
        jt *= isDestruction ? 0.25 : 0.8;

        const fX = jt * tx;
        const fY = jt * ty;
        addEntityVelocity(A, fX * invMassA, fY * invMassA);
        addEntityVelocity(B, -fX * invMassB, -fY * invMassB);
        addEntityAngVel(A, (rAx * ty - rAy * tx) * jt * invIa);
        addEntityAngVel(B, -(rBx * ty - rBy * tx) * jt * invIb);
      }
    }

    const penMin = DESTRUCTOR_CONFIG.crushPenetrationMin ?? 0.15;
    const crushActive = isDestruction || (pen > penMin);
    const impactSpeed = Math.hypot(dvx, dvy);
    const allowCrush = (impactSpeed > (DESTRUCTOR_CONFIG.crushMinSpeed ?? 1.5)) || (pen > penMin);

    if (crushActive && allowCrush) {
      const ct0 = contacts[0];
      const sA = ct0.shardA;
      const sB = ct0.shardB;
      if (sA && sB) {
        const angA = getEntityHexAngle(A);
        const angB = getEntityHexAngle(B);
        const ia = 1 / (DESTRUCTOR_CONFIG.collisionIterations || 1);
        const dtScale = dt * 60 * ia;

        const totalMass = massA + massB;
        const ratioA = massB / totalMass;
        const ratioB = massA / totalMass;

        const cxA = A.hexGrid.srcWidth * 0.5;
        const cyA = A.hexGrid.srcHeight * 0.5;
        const cxB = B.hexGrid.srcWidth * 0.5;
        const cyB = B.hexGrid.srcHeight * 0.5;
        const pAx = A.hexGrid.pivot ? A.hexGrid.pivot.x : 0;
        const pAy = A.hexGrid.pivot ? A.hexGrid.pivot.y : 0;
        const pBx = B.hexGrid.pivot ? B.hexGrid.pivot.x : 0;
        const pBy = B.hexGrid.pivot ? B.hexGrid.pivot.y : 0;

        const relAX = (sA.gridX - cxA) + sA.deformation.x - pAx;
        const relAY = (sA.gridY - cyA) + sA.deformation.y - pAy;
        const relBX = (sB.gridX - cxB) + sB.deformation.x - pBx;
        const relBY = (sB.gridY - cyB) + sB.deformation.y - pBy;

        const ca = Math.cos(angA), sa = Math.sin(angA);
        const cb = Math.cos(angB), sb = Math.sin(angB);

        const velK = DESTRUCTOR_CONFIG.crushVelK ?? 0.15;
        const penK = DESTRUCTOR_CONFIG.crushPenK ?? 10;
        const shearK = DESTRUCTOR_CONFIG.shearK ?? 0.06;

        let wForceAx = -dvx * velK * dtScale;
        let wForceAy = -dvy * velK * dtScale;
        let wForceBx = dvx * velK * dtScale;
        let wForceBy = dvy * velK * dtScale;

        if (pen > 0) {
          const penForce = pen * penK * dtScale;
          wForceAx += nx * penForce;
          wForceAy += ny * penForce;
          wForceBx -= nx * penForce;
          wForceBy -= ny * penForce;
        }

        if (Math.abs(velTangent) > 0.1) {
          const sh = velTangent * shearK * dtScale;
          wForceAx += tx * sh;
          wForceAy += ty * sh;
          wForceBx -= tx * sh;
          wForceBy -= ty * sh;
        }

        const forceAx = wForceAx * ca + wForceAy * sa;
        const forceAy = -wForceAx * sa + wForceAy * ca;
        const forceBx = wForceBx * cb + wForceBy * sb;
        const forceBy = -wForceBx * sb + wForceBy * cb;

        const crushScale = isDestruction ? 1 : 0.35;
        const dmgScale = doDamage ? 1 : 0;

        this.distributeStructuralDamage(A, relAX, relAY, forceAx * (ratioA * 2) * crushScale, forceAy * (ratioA * 2) * crushScale, dmgScale);
        this.distributeStructuralDamage(B, relBX, relBY, forceBx * (ratioB * 2) * crushScale, forceBy * (ratioB * 2) * crushScale, dmgScale);
      }
    }

    const sepPercent = crushActive ? (DESTRUCTOR_CONFIG.crushSeparation ?? 0.25) : 0.8;
    if (penetration > slop) {
      const corr = Math.max(penetration - slop, 0) / (invMassA + invMassB) * sepPercent;
      addEntityPosition(A, nx * corr * invMassA, ny * corr * invMassA);
      addEntityPosition(B, -nx * corr * invMassB, -ny * corr * invMassB);
    }
  },

  destroyShard(entity, shard, velVector) {
    if (!entity?.hexGrid?.cacheCtx || !shard || shard.isDebris) return;
    shard.hp = 0;
    const ctx = entity.hexGrid.cacheCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.translate(shard.gridX + shard.deformation.x, shard.gridY + shard.deformation.y);
    ctx.beginPath();
    ctx.arc(0, 0, shard.radius * 1.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    const scale = getFinalScale(entity);
    shard.becomeDebris(
      (velVector?.x || 0) * 0.3 + shard.deformation.x * 2,
      (velVector?.y || 0) * 0.3 + shard.deformation.y * 2,
      entity,
      scale
    );
    if (Number.isFinite(entity.hexGrid.activeStructuralCount)) {
      entity.hexGrid.activeStructuralCount = Math.max(0, entity.hexGrid.activeStructuralCount - 1);
    }
    entity.hexGrid.meshDirty = true;
    entity.hexGrid.gpuTextureNeedsUpdate = true;
  },

  processSplits(entities) {
    const queue = [...new Set(this.splitQueue)];
    this.splitQueue = [];
    for (const entity of queue) {
      if (!entity?.hexGrid) continue;
      const groups = this.findIslands(entity.hexGrid);
      if (groups.length <= 1) continue;
      groups.sort((a, b) => b.length - a.length);
      const main = groups[0];
      const loose = groups.slice(1);
      this.rebuildEntityGrid(entity, main);
      for (const group of loose) {
        if (group.length < 3) {
          for (const s of group) this.destroyShard(entity, s, { x: getEntityVelX(entity), y: getEntityVelY(entity) });
          continue;
        }
        this.spawnWreckEntity(entity, group, entities);
      }
    }
  },

  findIslands(grid) {
    const active = grid.shards.filter(s => s.active && !s.isDebris);
    if (active.length === 0) return [];
    const inBody = new Set(active);
    const visited = new Set();
    const groups = [];
    for (const seed of active) {
      if (visited.has(seed)) continue;
      const group = [];
      const stack = [seed];
      visited.add(seed);
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        for (const n of cur.neighbors || []) {
          if (!n || !inBody.has(n)) continue;
          if (!n.active || n.isDebris || visited.has(n)) continue;
          visited.add(n);
          stack.push(n);
        }
      }
      groups.push(group);
    }
    return groups;
  },

  rebuildEntityGrid(entity, shards) {
    const cols = entity.hexGrid.cols || Math.ceil(entity.hexGrid.srcWidth / HEX_SPACING);
    const rows = entity.hexGrid.rows || Math.ceil(entity.hexGrid.srcHeight / HEX_HEIGHT);
    const map = {};
    const grid = new Array(cols * rows);
    for (const s of shards) {
      map[s.c + ',' + s.r] = s;
      if (s.c >= 0 && s.c < cols && s.r >= 0 && s.r < rows) grid[s.c + s.r * cols] = s;
    }
    entity.hexGrid.shards = shards;
    entity.hexGrid.map = map;
    entity.hexGrid.grid = grid;
    entity.hexGrid.cols = cols;
    entity.hexGrid.rows = rows;
    entity.hexGrid.meshDirty = true;
    entity.hexGrid.textureDirty = true;
    entity.hexGrid.cacheDirty = true;
    entity.hexGrid.activeStructuralCount = shards.length;
    entity.hexGrid.baseStructuralCount = Math.max(
      Number(entity.hexGrid.baseStructuralCount) || 0,
      shards.length
    );
    rebuildNeighbors(entity.hexGrid);
    if (!entity.isPlayer) entity.mass = Math.max(10, shards.length * DESTRUCTOR_CONFIG.shardMass);
  },

  spawnWreckEntity(parent, shards, entities) {
    if (!parent?.hexGrid || !shards?.length) return;
    let sumX = 0, sumY = 0;
    for (const s of shards) {
      sumX += s.gridX + s.deformation.x;
      sumY += s.gridY + s.deformation.y;
    }
    const avgX = sumX / shards.length;
    const avgY = sumY / shards.length;
    const cx = parent.hexGrid.srcWidth * 0.5;
    const cy = parent.hexGrid.srcHeight * 0.5;
    const relX = avgX - cx;
    const relY = avgY - cy;

    let maxD2 = 0;
    for (const s of shards) {
      const d2 = ((s.gridX + s.deformation.x) - avgX) ** 2 + ((s.gridY + s.deformation.y) - avgY) ** 2;
      if (d2 > maxD2) maxD2 = d2;
    }
    const newRadius = Math.sqrt(maxD2) + DESTRUCTOR_CONFIG.gridDivisions * 2;

    const scale = getFinalScale(parent);
    const ang = getEntityHexAngle(parent);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const worldX = getEntityPosX(parent) + (relX * scale) * c - (relY * scale) * s;
    const worldY = getEntityPosY(parent) + (relX * scale) * s + (relY * scale) * c;
    const angVel = getEntityAngVel(parent);
    let wreckVx = getEntityVelX(parent);
    let wreckVy = getEntityVelY(parent);
    if (angVel) {
      const rx = worldX - getEntityPosX(parent);
      const ry = worldY - getEntityPosY(parent);
      wreckVx += -angVel * ry;
      wreckVy += angVel * rx;
    }

    const cols = parent.hexGrid.cols || Math.ceil(parent.hexGrid.srcWidth / HEX_SPACING);
    const rows = parent.hexGrid.rows || Math.ceil(parent.hexGrid.srcHeight / HEX_HEIGHT);

    const wreck = {
      x: worldX,
      y: worldY,
      vx: wreckVx,
      vy: wreckVy,
      angle: getEntityAngle(parent),
      angVel: getEntityAngVel(parent),
      radius: newRadius,
      mass: Math.max(10, shards.length * DESTRUCTOR_CONFIG.shardMass),
      friction: 0.998,
      dead: false,
      isWreck: true,
      isCollidable: true,
      owner: parent.owner || parent,
      visual: { spriteScale: scale, spriteRotation: getEntitySpriteRotation(parent) },
      hexGrid: {
        shards,
        map: {},
        grid: new Array(cols * rows),
        cols,
        rows,
        srcWidth: parent.hexGrid.srcWidth,
        srcHeight: parent.hexGrid.srcHeight,
        cacheCanvas: parent.hexGrid.cacheCanvas.cloneNode(),
        cacheCtx: null,
        cacheDirty: true,
        textureDirty: true,
        meshDirty: true,
        gpuTextureNeedsUpdate: false,
        activeStructuralCount: shards.length,
        baseStructuralCount: shards.length,
        pivot: { x: relX, y: relY }
      }
    };

    wreck.hexGrid.cacheCtx = wreck.hexGrid.cacheCanvas.getContext('2d');
    wreck.hexGrid.cacheCtx.drawImage(parent.hexGrid.cacheCanvas, 0, 0);
    for (const hs of shards) {
      wreck.hexGrid.map[hs.c + ',' + hs.r] = hs;
      if (hs.c >= 0 && hs.c < cols && hs.r >= 0 && hs.r < rows) {
        wreck.hexGrid.grid[hs.c + hs.r * cols] = hs;
      }
    }
    rebuildNeighbors(wreck.hexGrid);

    if (Array.isArray(entities) && !entities.includes(wreck)) entities.push(wreck);
    if (typeof window !== 'undefined' && Array.isArray(window.wrecks) && !window.wrecks.includes(wreck)) {
      window.wrecks.push(wreck);
    }
  },

  draw(ctx, camera, worldToScreenFunc) {
    const toScreen = worldToScreenFunc || worldToScreenFallback;
    for (const d of this.debris) d.drawDebris(ctx, camera, toScreen);
  }
};

export function initHexBody(entity, image, damagedImage = null, isProjectile = false, massOverride = null) {
  if (!entity || !image?.width || !isHexEligible(entity)) return;

  const w = Math.ceil(image.width / 2) * 2;
  const h = Math.ceil(image.height / 2) * 2;
  const r = DESTRUCTOR_CONFIG.gridDivisions;
  const hexHeight = Math.sqrt(3) * r;

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const srcCtx = src.getContext('2d', { willReadFrequently: true });

  let data;
  try {
    srcCtx.drawImage(image, 0, 0, w, h);
    data = srcCtx.getImageData(0, 0, w, h).data;
  } catch {
    return;
  }

  let damaged = null;
  if (damagedImage?.width) {
    damaged = document.createElement('canvas');
    damaged.width = w;
    damaged.height = h;
    const dctx = damaged.getContext('2d');
    dctx.drawImage(damagedImage, 0, 0, w, h);
  }

  const shards = [];
  const map = {};
  const cols = Math.ceil(w / (r * 1.5));
  const rows = Math.ceil(h / hexHeight);
  const grid = new Array(cols * rows);

  const cx = w * 0.5;
  const cy = h * 0.5;
  let rawRadiusSq = 0;

  for (let c = 0; c < cols; c++) {
    for (let ro = 0; ro < rows; ro++) {
      const x = c * r * 1.5;
      let y = ro * hexHeight;
      if (c % 2 !== 0) y += hexHeight * 0.5;
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const alpha = data[(py * w + px) * 4 + 3];
      if (alpha <= 40) continue;
      const shard = new HexShard(isProjectile ? null : src, damaged, x, y, r, c, ro, isProjectile ? '#ffcc00' : null);
      shard.lx = x - cx; 
      shard.ly = y - cy;
      shard.origLx = shard.lx;
      shard.origLy = shard.ly;
      const d2 = shard.lx * shard.lx + shard.ly * shard.ly;
      if (d2 > rawRadiusSq) rawRadiusSq = d2;
      shards.push(shard);
      map[c + ',' + ro] = shard;
      grid[c + ro * cols] = shard;
    }
  }

  if (!shards.length) return;

  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = w;
  cacheCanvas.height = h;
  const cacheCtx = cacheCanvas.getContext('2d', { willReadFrequently: true });

  if (isProjectile) cacheCtx.drawImage(image, 0, 0, w, h);
  else for (const s of shards) s.drawShape(cacheCtx);

  entity.hexGrid = {
    shards,
    map,
    grid,
    cols,
    rows,
    srcWidth: w,
    srcHeight: h,
    rawRadius: Math.sqrt(rawRadiusSq) + r,
    cacheCanvas,
    cacheCtx,
    cacheDirty: false,
    textureDirty: false,
    meshDirty: false,
    gpuTextureNeedsUpdate: false,
    activeStructuralCount: shards.length,
    baseStructuralCount: shards.length,
    pivot: null
  };

  rebuildNeighbors(entity.hexGrid);
  entity.radius = entity.hexGrid.rawRadius * getFinalScale(entity);
  entity.isProjectile = !!isProjectile;

  if (Number.isFinite(massOverride)) entity.mass = massOverride;
  else if (!Number.isFinite(entity.mass) || entity.mass <= 0) {
    entity.mass = Math.max(10, shards.length * DESTRUCTOR_CONFIG.shardMass);
  }
}

export function getHexStructuralState(entity) {
  const grid = entity?.hexGrid;
  if (!grid || !Array.isArray(grid.shards)) return null;

  let active = Number(grid.activeStructuralCount);
  if (!Number.isFinite(active)) {
    active = 0;
    for (let i = 0; i < grid.shards.length; i++) {
      const shard = grid.shards[i];
      if (shard?.active && !shard?.isDebris && shard.hp > 0) active++;
    }
    grid.activeStructuralCount = active;
  }
  active = Math.max(0, active);

  let total = Number(grid.baseStructuralCount);
  if (!Number.isFinite(total) || total <= 0) {
    total = grid.shards.length;
    grid.baseStructuralCount = total;
  }
  total = Math.max(0, total);

  const ratio = total > 0 ? Math.max(0, Math.min(1, active / total)) : 0;
  return { active, total, ratio };
}

export function drawHexBody(ctx, entity, camera, worldToScreenFunc) {
  if (HEX_SHIPS_3D_ACTIVE) return;
  if (!entity?.hexGrid?.cacheCanvas) return;

  const toScreen = worldToScreenFunc || worldToScreenFallback;
  const s = toScreen(getEntityPosX(entity), getEntityPosY(entity), camera, ctx);
  const size = (entity.radius || 100) * camera.zoom;
  if (s.x + size < 0 || s.x - size > ctx.canvas.width || s.y + size < 0 || s.y - size > ctx.canvas.height) return;

  refreshHexBodyCache(entity);

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(getEntityHexAngle(entity));
  const sc = camera.zoom * getFinalScale(entity);
  ctx.scale(sc, sc);
  if (entity.hexGrid.pivot) ctx.translate(-entity.hexGrid.pivot.x, -entity.hexGrid.pivot.y);
  ctx.drawImage(entity.hexGrid.cacheCanvas, -entity.hexGrid.srcWidth * 0.5, -entity.hexGrid.srcHeight * 0.5);
  ctx.restore();
}

export function drawHexBodyLocal(ctx, entity, forceRender2D = false) {
  if (HEX_SHIPS_3D_ACTIVE && !forceRender2D) return;
  if (!entity?.hexGrid?.cacheCanvas) return;
  if (forceRender2D) {
    const grid = entity.hexGrid;
    if (grid.cacheDirty || grid.textureDirty) updateHexCache(entity);
  } else {
    refreshHexBodyCache(entity);
  }
  ctx.save();
  const sc = getFinalScale(entity);
  ctx.scale(sc, sc);
  if (entity.hexGrid.pivot) ctx.translate(-entity.hexGrid.pivot.x, -entity.hexGrid.pivot.y);
  ctx.drawImage(entity.hexGrid.cacheCanvas, -entity.hexGrid.srcWidth * 0.5, -entity.hexGrid.srcHeight * 0.5);
  ctx.restore();
}
