/**

 * Hybrid hex destruction engine ported from

 * destruktorhybridclaude_crushfix_edgefix_perf_flickerfix.html.

 */

import { DestructorGpuSoftBody } from './destructorGpuSoftBody.js';

export const DESTRUCTOR_CONFIG = {

  // ── Siatka hexagonalna ──
  gridDivisions: 9,            // Promień hexagonu (px). HEX_SPACING = 13.5, HEX_HEIGHT = 15.6
  shardMass: 10.0,             // Masa jednego sharda. Masa wraku = shards × shardMass
  visualRotationOffset: 0,     // Stały offset kąta renderowania siatki (rad)

  // ── HP i obrażenia ──
  shardHP: 100,                // Startowe HP sharda. Ginie przy hp ≤ 0
  armorThreshold: 0.8,         // Próg hp/maxHp do wyświetlania tekstury pancerza
  inflictedDamageMult: 1.0,    // Mnożnik zadawanych obrażeń (legacy)

  // ── Deformacja i rwanie materiału ──
  maxDeform: 100.0,            // Max deformacja (px) — GPU zabija sharda powyżej. 220 = ~16 hex spacings
  tearThreshold: 80.0,        // Rwanie od rozciągnięcia sąsiadów — GPU kill gdy stretch > próg. 150 = ~11 hex spacings
  yieldPoint: 100.0,            // Plastyczność — powyżej deformacja "bakes" do gridX/Y (trwała). Sprężyny × 0.1
  deformMul: 0.01,              // Mnożnik siły deformacji od broni (distributeStructuralDamage)
  bendingRadius: 30.0,        // Promień wpływu uderzenia (px) z gładką krzywą Hermite'a

  // ── Soft Body (sprężyny GPU + CPU) ──
  softBodyTension: 3.5,        // Stiffness sprężyn → k ≈ 0.97. Wyżej = szybsza propagacja fali
  gpuPropagationDamping: 0.55, // Tłumienie velocity fali. vel × 0.55 per klatkę@60fps. Po 5kl: ~5%
  recoverSpeed: 1.0,           // Prędkość powrotu targetDeformation do 0 (repair)
  repairRate: 100,             // Regeneracja HP sharda per sekundę
  visualLerpSpeed: 5.0,        // Lerp wizualny deformation → targetDeformation

  // ── Sleep / Wake ──
  elasticSleepFrames: 60,      // Klatki ciszy zanim grid zasypia (brak symulacji)
  elasticSleepThreshold: 0.08, // Peak deformacja poniżej której grid zaczyna zasypiać
  elasticWakeFrames: 20,       // Force-awake po uderzeniu (zapobiega przedwczesnemu zasypianiu)

  // ── Fizyka kolizji (rigid body) ──
  restitution: 0.05,                  // Sprężystość odbicia (0.05 = prawie brak). Przy crush → 0
  crashApproachSpeedThreshold: 500.0, // Prędkość zbliżania do aktywacji crush (niszczenie hexów)
  crushPenetrationMin: 0.30,          // Min. penetracja do startu crush
  crushImpulseScale: 0.25,            // Skala impulsu niszczącego hexsy
  shearK: 0.06,                       // Ścinanie tangentne przy otarciu (szlifowanie burt)
  friction: 0.99,                     // Tarcie odłamków (debris). vel × 0.99/klatkę

  // ── Detekcja kolizji ──
  collisionDeformScale: 1.0,  // Wpływ deformacji na pozycję w kolizjach (1.0 = pełne)
  collisionSearchRadius: 5,   // Promień szukania hex sąsiadów w siatce
  collisionIterations: 1,     // Ile razy per klatkę rozwiązywać kolizje. Damage tylko w 1. iteracji
  broadphaseCellSize: 2400,   // Rozmiar komórki broadphase hash grid
  broadphaseMaxCandidates: 256, // Twardy limit kandydatów broadphase na zapytanie
  ringBroadphaseRadiusCap: 1800, // Limit promienia broadphase dla segmentów ringu

  // ── Splitting (rozdzielanie wysp) ──
  splitForceThreshold: 50,    // Min. siła uderzenia do kolejkowania splitu
  splitDamageThreshold: 200,  // Próg obrażeń w applyImpact → wymuszenie split check
  splitCheckInterval: 10,     // Co ile klatek przetwarzać kolejkę splitów
  splitMaxPerTick: 2,         // Max splitów per tick
  splitTimeBudgetMs: 1.2,     // Budżet ms per tick na processing splitów

  // ── GPU Soft Body ──
  gpuSoftBody: 1,             // Włącznik GPU soft body (1 = on, 0 = CPU only)
  gpuSoftBodyMinShards: 64    // Min. shardów do GPU — poniżej → CPU elasticity
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



function markRingSegmentHot(entity, physicsHoldMs = 2500, visualHoldMs = physicsHoldMs) {

  if (!entity?.isRingSegment) return;

  const now = nowMs();

  const physicsUntil = now + Math.max(0, Number(physicsHoldMs) || 0);

  const visualUntil = now + Math.max(0, Number(visualHoldMs) || 0);

  const prevPhysics = Number(entity.__destructorHotUntilMs) || 0;

  const prevVisual = Number(entity.__ringVisualHotUntilMs) || 0;

  if (physicsUntil > prevPhysics) entity.__destructorHotUntilMs = physicsUntil;

  if (visualUntil > prevVisual) entity.__ringVisualHotUntilMs = visualUntil;

}



function resetGridMeshDirtyRange(grid) {

  if (!grid) return;

  grid.meshDirtyAll = false;

  grid.meshDirtyStart = -1;

  grid.meshDirtyEnd = -1;

}

function markGridMeshDirtyAll(grid) {

  if (!grid) return;

  grid.meshDirty = true;

  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;

  grid.meshDirtyAll = true;

  grid.meshDirtyStart = 0;

  grid.meshDirtyEnd = Math.max(0, count - 1);

}

function markGridMeshDirtyRange(grid, minIndex, maxIndex) {

  if (!grid) return;

  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;

  if (count <= 0) {

    markGridMeshDirtyAll(grid);

    return;

  }

  const a = Number(minIndex);

  const b = Number(maxIndex);

  if (!Number.isFinite(a) || !Number.isFinite(b)) {

    markGridMeshDirtyAll(grid);

    return;

  }

  let start = a | 0;

  let end = b | 0;

  if (end < start) {

    const tmp = start;

    start = end;

    end = tmp;

  }

  if (start < 0 || end < 0 || start >= count || end >= count) {

    markGridMeshDirtyAll(grid);

    return;

  }

  grid.meshDirty = true;

  if (grid.meshDirtyAll) return;

  const curStart = Number(grid.meshDirtyStart);

  const curEnd = Number(grid.meshDirtyEnd);

  if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || curStart < 0 || curEnd < curStart) {

    grid.meshDirtyStart = start;

    grid.meshDirtyEnd = end;

    return;

  }

  if (start < curStart) grid.meshDirtyStart = start;

  if (end > curEnd) grid.meshDirtyEnd = end;

}

function markGridMeshDirtyByShard(grid, shard) {

  const idx = Number(shard?.__meshIndex);

  if (!Number.isFinite(idx)) {

    markGridMeshDirtyAll(grid);

    return;

  }

  markGridMeshDirtyRange(grid, idx | 0, idx | 0);

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



function hasActiveStructuralHexes(entity) {

  const grid = entity?.hexGrid;

  if (!grid) return false;

  const active = Number(grid.activeStructuralCount);

  return !Number.isFinite(active) || active > 0;

}



function getBroadphaseRadius(entity) {

  if (!entity) return 100;

  let radius = Number(entity.radius);

  if (!Number.isFinite(radius) || radius <= 0) radius = Number(entity.r) || 100;

  radius = Math.max(80, radius);

  if (entity.isRingSegment) {

    const gridRadius = Number(entity?.hexGrid?.rawRadius);

    if (Number.isFinite(gridRadius) && gridRadius > 0) {

      const scaledGridRadius = gridRadius * Math.max(0.0001, getFinalScale(entity));

      radius = Math.min(radius, Math.max(140, scaledGridRadius + 80));

    }

    const ringCap = Math.max(200, Number(DESTRUCTOR_CONFIG.ringBroadphaseRadiusCap) || 1800);

    radius = Math.min(radius, ringCap);

  }

  return radius;

}



function circleOverlapsEntityRect(worldX, worldY, worldRadius, entity, extraMargin = 0) {

  const grid = entity?.hexGrid;

  if (!grid) return true;

  const width = Number(grid.srcWidth) || 0;

  const height = Number(grid.srcHeight) || 0;

  if (width <= 0 || height <= 0) return true;

  const scale = Math.max(0.0001, getFinalScale(entity));

  const angle = getEntityHexAngle(entity);

  const c = Math.cos(angle);

  const s = Math.sin(angle);

  const dx = worldX - getEntityPosX(entity);

  const dy = worldY - getEntityPosY(entity);

  const lx = (dx * c + dy * s) / scale;

  const ly = (-dx * s + dy * c) / scale;

  const pX = grid.pivot ? grid.pivot.x : 0;

  const pY = grid.pivot ? grid.pivot.y : 0;

  const cx = width * 0.5;

  const cy = height * 0.5;

  const minX = -cx - pX;

  const maxX = width - cx - pX;

  const minY = -cy - pY;

  const maxY = height - cy - pY;

  const margin = (Math.max(0, Number(worldRadius) || 0) / scale) + Math.max(0, Number(extraMargin) || 0);

  return (
    lx >= (minX - margin) &&
    lx <= (maxX + margin) &&
    ly >= (minY - margin) &&
    ly <= (maxY + margin)
  );

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

  resetGridMeshDirtyRange(g);

  g.gpuTextureNeedsUpdate = false;

}



export function refreshHexBodyCache(entity) {

  if (!entity?.hexGrid) return;

  const grid = entity.hexGrid;

  const needsMeshRefresh2D = !HEX_SHIPS_3D_ACTIVE && !!grid.meshDirty;

  const needsTextureRebuild = !HEX_SHIPS_3D_ACTIVE && !!grid.textureDirty;

  if (grid.cacheDirty || needsTextureRebuild || needsMeshRefresh2D) updateHexCache(entity);

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

    this.__collVelX = 0;

    this.__collVelY = 0;

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

    this._crushStamp = 0;

    this.__meshIndex = -1;

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



  applyDeformation(vecX, vecY, waveMult = 1.0) {

    const MAX_INSTANT = 8.0;

    const magSq = vecX * vecX + vecY * vecY;

    let instX = vecX, instY = vecY;



    if (magSq > MAX_INSTANT * MAX_INSTANT) {

      const mag = Math.sqrt(magSq);

      instX = (vecX / mag) * MAX_INSTANT;

      instY = (vecY / mag) * MAX_INSTANT;

    }



    this.targetDeformation.x += instX;

    this.targetDeformation.y += instY;

    this.deformation.x += instX;

    this.deformation.y += instY;



    // Collision velocity goes to __collVelX — survives GPU _applyResult overwrite.

    // Weapon velocity (distributeStructuralDamage) stays on __velX and gets damped by GPU.

    this.__collVelX = (Number(this.__collVelX) || 0) + vecX * 1.5 * waveMult;

    this.__collVelY = (Number(this.__collVelY) || 0) + vecY * 1.5 * waveMult;



    const vSq = this.__collVelX * this.__collVelX + this.__collVelY * this.__collVelY;

    const MAX_VEL = Math.max(1.0, 160.0 * waveMult);

    if (vSq > MAX_VEL * MAX_VEL) {

      const vMag = Math.sqrt(vSq);

      this.__collVelX = (this.__collVelX / vMag) * MAX_VEL;

      this.__collVelY = (this.__collVelY / vMag) * MAX_VEL;

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

const _staticProbeResult = { hitShard: null, localX: 0, localY: 0, scale: 1, c: 1, s: 0, cx: 0, cy: 0, pX: 0, pY: 0 };



export const DestructorSystem = {

  debris: [],

  splitQueue: [],

  _tick: 0,

  _frameContacts: 0,

  // Limit removed: 1024 contacts to handle very large hull surfaces in one pass.

  _contactsBuf: Array.from({ length: 1024 }, () => ({

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

    lastSplitMs: 0,

    lastContacts: 0

  },

  _liveCollisionDebug: {

    enabled: false,

    intervalMs: 1000,

    startedAt: 0,

    lastFlushAt: 0,

    frames: 0,

    frameMsSum: 0,

    frameMsMax: 0,

    pairCandidates: 0,

    pairNarrow: 0,

    ringPairs: 0,

    queryCandidates: 0,

    queryReturned: 0,

    buckets: Object.create(null)

  },

  _dbgCollisionReset(intervalMs = null) {

    const dbg = this._liveCollisionDebug;

    if (!dbg) return;

    if (intervalMs != null) dbg.intervalMs = Math.max(250, Number(intervalMs) || 1000);

    dbg.frames = 0;

    dbg.frameMsSum = 0;

    dbg.frameMsMax = 0;

    dbg.pairCandidates = 0;

    dbg.pairNarrow = 0;

    dbg.ringPairs = 0;

    dbg.queryCandidates = 0;

    dbg.queryReturned = 0;

    dbg.buckets = Object.create(null);

  },

  setCollisionLiveDebug(enabled = true, intervalMs = 1000) {

    const dbg = this._liveCollisionDebug;

    if (!dbg) return null;

    dbg.enabled = !!enabled;

    dbg.intervalMs = Math.max(250, Number(intervalMs) || 1000);

    const now = nowMs();

    if (dbg.enabled) {

      dbg.startedAt = now;

      dbg.lastFlushAt = now;

      this._dbgCollisionReset();

      console.log(`[ColFuncDBG] ON interval=${dbg.intervalMs}ms`);

    } else {

      console.log('[ColFuncDBG] OFF');

      this._dbgCollisionReset();

    }

    return { enabled: dbg.enabled, intervalMs: dbg.intervalMs };

  },

  _dbgCollisionRecord(name, ms) {

    const dbg = this._liveCollisionDebug;

    if (!dbg?.enabled) return;

    const key = String(name || '');

    let bucket = dbg.buckets[key];

    if (!bucket) {

      bucket = dbg.buckets[key] = { calls: 0, sum: 0, max: 0 };

    }

    bucket.calls++;

    bucket.sum += ms;

    if (ms > bucket.max) bucket.max = ms;

  },

  _dbgCollisionFlush(now = nowMs(), force = false) {

    const dbg = this._liveCollisionDebug;

    if (!dbg?.enabled) return;

    if (!force && (now - dbg.lastFlushAt) < dbg.intervalMs) return;

    const fmt = (name) => {

      const b = dbg.buckets[name];

      if (!b || b.calls <= 0) return '0.000/0.00ms x0';

      const avg = b.sum / b.calls;

      return `${avg.toFixed(3)}/${b.max.toFixed(2)}ms x${b.calls}`;

    };

    let topName = '';

    let topMs = 0;

    for (const [name, b] of Object.entries(dbg.buckets)) {

      if ((b?.max || 0) > topMs) {

        topMs = b.max;

        topName = name;

      }

    }

    const elapsed = (now - dbg.startedAt) / 1000;

    const frameAvg = dbg.frames > 0 ? (dbg.frameMsSum / dbg.frames) : 0;

    console.log(`[ColFuncDBG ${elapsed.toFixed(1)}s]`, {

      frame: `${frameAvg.toFixed(2)}/${dbg.frameMsMax.toFixed(2)}ms x${dbg.frames}`,

      pairs: `cand=${dbg.pairCandidates} narrow=${dbg.pairNarrow} ring=${dbg.ringPairs}`,

      query: `cand=${dbg.queryCandidates} ret=${dbg.queryReturned}`,

      update: fmt('update'),

      prepare: fmt('prepareBroadphase'),

      resolve: fmt('resolveCollisions'),

      queryFn: fmt('queryBroadphase'),

      collide: fmt('collideEntities'),

      elasticity: fmt('simulateElasticity'),

      impact: fmt('applyImpact'),

      deform: fmt('distributeStructuralDamage'),

      split: fmt('processSplits'),

      topSpike: topName ? `${topName}:${topMs.toFixed(2)}ms` : 'n/a'

    });

    dbg.lastFlushAt = now;

    this._dbgCollisionReset();

  },

  // --- ZMIENNE OPTYMALIZACYJNE ---

  _bpTable: Array.from({ length: 4096 }, () => []),

  _bpMask: 4095,

  _bpTouched: [],

  _wreckPool: [],

  _bpCellSize: DESTRUCTOR_CONFIG.broadphaseCellSize,

  _bpQueryBuffer: [],

  _bpQueryCount: 0,

  _bpQueryStamp: 1,

  _bpGatherStamp: 1,

  _splitStamp: 1,

  _splitUniqueBuffer: [],

  _crushStampCounter: 0,

  _crushStampA: 0,

  _crushStampB: 0,



  _prepareBroadphase(entities) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tBroadphase0 = dbgEnabled ? nowMs() : 0;

    const cellSize = Math.max(300, Number(DESTRUCTOR_CONFIG.broadphaseCellSize) || 2400);

    this._bpCellSize = cellSize;

    const table = this._bpTable;

    const touched = this._bpTouched;

    for (let i = 0; i < touched.length; i++) {

      table[touched[i]].length = 0;

    }

    touched.length = 0;

    const mask = this._bpMask;



    const len = entities.length;

    for (let i = 0; i < len; i++) {

      const ent = entities[i];

      if (!ent?.hexGrid || ent.dead || ent.isCollidable === false) {

        if (ent) {

          ent._hasActiveHex = false;

          ent._bpRadius = 0;

        }

        continue;

      }

      const hasActiveHex = hasActiveStructuralHexes(ent);

      ent._hasActiveHex = hasActiveHex;

      if (!hasActiveHex) {

        ent._bpRadius = 0;

        continue;

      }



      const x = getEntityPosX(ent);

      const y = getEntityPosY(ent);



      // DODANO: Rozszerzamy broadphase o predkosc, zeby nie gubic statkow w locie!

      const vx = getEntityVelX(ent) * (1 / 60);

      const vy = getEntityVelY(ent) * (1 / 60);

      const speedExtension = Math.min(180, Math.sqrt(vx * vx + vy * vy));



      const bpRadius = getBroadphaseRadius(ent);

      ent._bpRadius = bpRadius;

      const radius = bpRadius + speedExtension;

      const minCx = Math.floor((x - radius) / cellSize);

      const maxCx = Math.floor((x + radius) / cellSize);

      const minCy = Math.floor((y - radius) / cellSize);

      const maxCy = Math.floor((y + radius) / cellSize);

      ent._destrBpIndex = i;



      for (let cy = minCy; cy <= maxCy; cy++) {

        for (let cx = minCx; cx <= maxCx; cx++) {

          const hash = ((cx * 73856093) ^ (cy * 19349663));

          const posHash = (hash >>> 0) & mask;

          const bucket = table[posHash];

          if (bucket.length === 0) touched.push(posHash);

          bucket.push(ent);

        }

      }

    }

    if (dbgEnabled) this._dbgCollisionRecord('prepareBroadphase', nowMs() - tBroadphase0);

  },



  _queryBroadphase(x, y, radius) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tQuery0 = dbgEnabled ? nowMs() : 0;

    const finish = (retCount) => {

      if (dbgEnabled) {

        this._liveCollisionDebug.queryReturned += retCount;

        this._dbgCollisionRecord('queryBroadphase', nowMs() - tQuery0);

      }

      return retCount;

    };

    const queryRadius = Math.max(80, Number(radius) || 80);

    const cellSize = this._bpCellSize || 2400;

    const minCx = Math.floor((x - queryRadius) / cellSize);

    const maxCx = Math.floor((x + queryRadius) / cellSize);

    const minCy = Math.floor((y - queryRadius) / cellSize);

    const maxCy = Math.floor((y + queryRadius) / cellSize);



    const out = this._bpQueryBuffer;

    let count = 0;

    const maxCandidates = Math.max(64, Number(DESTRUCTOR_CONFIG.broadphaseMaxCandidates) || 256);

    let gatherStamp = (this._bpGatherStamp + 1) | 0;

    if (gatherStamp <= 0) gatherStamp = 1;

    this._bpGatherStamp = gatherStamp;

    const mask = this._bpMask;

    const table = this._bpTable;

    for (let cy = minCy; cy <= maxCy; cy++) {

      for (let cx = minCx; cx <= maxCx; cx++) {

        const hash = ((cx * 73856093) ^ (cy * 19349663));

        const posHash = (hash >>> 0) & mask;

        const cell = table[posHash];

        for (let i = 0; i < cell.length; i++) {

          const ent = cell[i];

          if (dbgEnabled) this._liveCollisionDebug.queryCandidates++;

          if (ent?._destrBpGather === gatherStamp) continue;

          ent._destrBpGather = gatherStamp;

          if (!ent?._hasActiveHex) continue;

          const dx = x - getEntityPosX(ent);

          const dy = y - getEntityPosY(ent);

          const rs = queryRadius + (Number(ent?._bpRadius) || 100);

          if (dx * dx + dy * dy > rs * rs) continue;

          out[count++] = ent;

          if (count >= maxCandidates) {

            this._bpQueryCount = count;

            return finish(count);

          }

        }

      }

    }

    this._bpQueryCount = count;

    return finish(count);

  },



  wakeHexEntity(entity, holdFrames = 0) {

    const grid = entity?.hexGrid;

    if (!grid) return;

    grid.isSleeping = false;

    grid.sleepFrames = 0;

    if (holdFrames > 0) {

      const prevHold = Number(grid.wakeHoldFrames) || 0;

      grid.wakeHoldFrames = Math.max(prevHold, holdFrames | 0);

    }

  },



  update(dt, entities) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

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

    DestructorGpuSoftBody.tick(list, DESTRUCTOR_CONFIG, step);

    const tAfterDeform = nowMs();

    this.simulateElasticity(list, step);

    this._frameContacts = 0;

    const tCollision0 = nowMs();

    this._prepareBroadphase(list);

    const iters = Math.max(1, DESTRUCTOR_CONFIG.collisionIterations | 0);

    for (let i = 0; i < iters; i++) {

      const doDamage = (i === 0);

      const skipRingPairs = (i > 0);

      this.resolveCollisions(list, step, doDamage, skipRingPairs, true);

    }

    const tAfterCollision = nowMs();

    const tSplit0 = nowMs();

    const splitInterval = Math.max(1, DESTRUCTOR_CONFIG.splitCheckInterval | 0);

    if (this._tick % splitInterval === 0 && this.splitQueue.length > 0) this.processSplits(list);

    const tUpdateEnd = nowMs();

    this.perf.lastUpdateMs = tUpdateEnd - tUpdate0;

    this.perf.lastDeformMs = tAfterDeform - tDeform0;

    this.perf.lastCollisionMs = tAfterCollision - tCollision0;

    this.perf.lastSplitMs = tUpdateEnd - tSplit0;

    this.perf.lastContacts = this._frameContacts;

    if (dbgEnabled) {

      const frameMs = tUpdateEnd - tUpdate0;

      const dbg = this._liveCollisionDebug;

      dbg.frames++;

      dbg.frameMsSum += frameMs;

      if (frameMs > dbg.frameMsMax) dbg.frameMsMax = frameMs;

      this._dbgCollisionRecord('update', frameMs);

      this._dbgCollisionFlush(tUpdateEnd, false);

    }

  },



  updateVisualDeformation(entities, dt) {

    const sleepFramesLimit = Math.max(1, DESTRUCTOR_CONFIG.elasticSleepFrames | 0);

    const sleepThreshold = Math.max(0.0001, Number(DESTRUCTOR_CONFIG.elasticSleepThreshold) || 0.08);

    for (const e of entities) {

      const grid = e?.hexGrid;

      if (!grid?.shards) continue;

      if ((Number(grid.wakeHoldFrames) || 0) > 0) grid.wakeHoldFrames -= 1;

      if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;



      let moving = false;

      let peakDeformation = 0;

      let dirtyMin = Number.POSITIVE_INFINITY;

      let dirtyMax = -1;

      const shards = grid.shards;

      for (let i = 0; i < shards.length; i++) {

        const s = shards[i];

        if (!s.active || s.isDebris) continue;

        const amp = Math.max(

          Math.abs(s.targetDeformation.x),

          Math.abs(s.targetDeformation.y),

          Math.abs(s.deformation.x),

          Math.abs(s.deformation.y)

        );

        if (amp > peakDeformation) peakDeformation = amp;

        if (s.updateAnimation(dt)) {

          moving = true;

          if (i < dirtyMin) dirtyMin = i;

          if (i > dirtyMax) dirtyMax = i;

        }

      }

      if (moving) {

        if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(grid, dirtyMin, dirtyMax);

        else markGridMeshDirtyAll(grid);

        grid.sleepFrames = 0;

        grid.isSleeping = false;

        continue;

      }



      if (peakDeformation <= sleepThreshold && (Number(grid.wakeHoldFrames) || 0) <= 0) {

        const frames = (Number(grid.sleepFrames) || 0) + 1;

        grid.sleepFrames = frames;

        if (frames >= sleepFramesLimit) grid.isSleeping = true;

      } else {

        grid.sleepFrames = 0;

        grid.isSleeping = false;

      }

    }

  },



  simulateElasticity(entities, dt) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tElastic0 = dbgEnabled ? nowMs() : 0;

    try {

    const tension = DESTRUCTOR_CONFIG.softBodyTension;

    if (tension <= 0) return;

    const k = 1 - Math.exp(-tension * dt * 60);



    // Opcje dla asynchronicznego GPU

    const useGpu = (DESTRUCTOR_CONFIG.gpuSoftBody | 0) === 1;

    const gpuMin = DESTRUCTOR_CONFIG.gpuSoftBodyMinShards || 64;



    for (const e of entities) {

      const grid = e?.hexGrid;

      if (!grid?.shards) continue;

      if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;



      // CPU load killer: skip CPU elasticity for ships handled asynchronously by GPU.

      const shardCount = grid.shards.length;

      if (useGpu && DestructorGpuSoftBody && DestructorGpuSoftBody.active && shardCount >= gpuMin) {

        continue; // This ship is currently simulated asynchronously on GPU.

      }



      if (e?.isRingSegment) continue; // Always skip rings in CPU elasticity loop

      // -------------------------------------------------------------



      let changed = false;

      let dirtyMin = Number.POSITIVE_INFINITY;

      let dirtyMax = -1;

      for (const s of grid.shards) {

        if (!s.active || s.isDebris) continue;



        // True plasticity baking: once yield is exceeded, commit part of the offset to base grid.

        const yieldP = DESTRUCTOR_CONFIG.yieldPoint || 80;

        const tdx = s.targetDeformation.x;

        const tdy = s.targetDeformation.y;

        const defLen = Math.sqrt(tdx * tdx + tdy * tdy);

        if (defLen > yieldP) {

          const excess = defLen - yieldP;

          const ratio = excess / defLen;

          const tx = s.targetDeformation.x * ratio;

          const ty = s.targetDeformation.y * ratio;

          s.gridX += tx;

          s.gridY += ty;

          s.targetDeformation.x -= tx;

          s.targetDeformation.y -= ty;

          changed = true;

          const idxS = Number(s.__meshIndex);

          if (Number.isFinite(idxS)) {

            if (idxS < dirtyMin) dirtyMin = idxS;

            if (idxS > dirtyMax) dirtyMax = idxS;

          } else {

            dirtyMin = 0;

            dirtyMax = grid.shards.length - 1;

          }

        }

        // Keep CPU elasticity active even for tiny deformation magnitudes.



        for (const n of s.neighbors) {

          if (!n) continue;

          if (!n.active || n.isDebris) continue;

          // Prevent double-processing the same shard pair

          if (n.c < s.c || (n.c === s.c && n.r <= s.r)) continue;



          const ax = s.targetDeformation.x;

          const ay = s.targetDeformation.y;

          const bx = n.targetDeformation.x;

          const by = n.targetDeformation.y;



          // DODANO: Zrywanie/oslabianie sprezyn przy poteznych wgnieceniach

          const defSq = ax * ax + ay * ay;

          const yieldSq = DESTRUCTOR_CONFIG.yieldPoint * DESTRUCTOR_CONFIG.yieldPoint;



          let currentK = k;

          if (defSq > yieldSq) {

            currentK = k * 0.1; // Odksztalcenie plastyczne (blacha sie wgniata i nie wraca!)

          }



          const avgX = (ax + bx) * 0.5;

          const avgY = (ay + by) * 0.5;



          const dax = (avgX - ax) * currentK;

          const day = (avgY - ay) * currentK;

          const dbx = (avgX - bx) * currentK;

          const dby = (avgY - by) * currentK;



          if (Math.abs(dax) > 1e-5 || Math.abs(day) > 1e-5 || Math.abs(dbx) > 1e-5 || Math.abs(dby) > 1e-5) {

            changed = true;

            const idxS = Number(s.__meshIndex);

            if (Number.isFinite(idxS)) {

              if (idxS < dirtyMin) dirtyMin = idxS;

              if (idxS > dirtyMax) dirtyMax = idxS;

            } else {

              dirtyMin = 0;

              dirtyMax = grid.shards.length - 1;

            }

            const idxN = Number(n.__meshIndex);

            if (Number.isFinite(idxN)) {

              if (idxN < dirtyMin) dirtyMin = idxN;

              if (idxN > dirtyMax) dirtyMax = idxN;

            } else {

              dirtyMin = 0;

              dirtyMax = grid.shards.length - 1;

            }

          }



          s.targetDeformation.x += dax;

          s.targetDeformation.y += day;

          n.targetDeformation.x += dbx;

          n.targetDeformation.y += dby;

        }

      }



      if (changed) {

        if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(grid, dirtyMin, dirtyMax);

        else markGridMeshDirtyAll(grid);

        grid.isSleeping = false;

        grid.sleepFrames = 0;

      }

    }

    } finally {

      if (dbgEnabled) this._dbgCollisionRecord('simulateElasticity', nowMs() - tElastic0);

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

        this.wakeHexEntity(e, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

        markGridMeshDirtyAll(e.hexGrid);

        if (!HEX_SHIPS_3D_ACTIVE) {

          e.hexGrid.textureDirty = true;

          e.hexGrid.cacheDirty = true;

        }

      }

    }

  },



  _probeImpactData(entity, worldX, worldY) {

    if (!entity?.hexGrid || !isHexEligible(entity)) return null;



    const angle = getEntityHexAngle(entity);

    const scale = Math.max(0.0001, getFinalScale(entity));

    const c = Math.cos(angle);

    const s = Math.sin(angle);



    const dx = worldX - getEntityPosX(entity);

    const dy = worldY - getEntityPosY(entity);

    const localX = (dx * c + dy * s) / scale;

    const localY = (-dx * s + dy * c) / scale;



    const cx = entity.hexGrid.srcWidth * 0.5;

    const cy = entity.hexGrid.srcHeight * 0.5;

    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;

    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;



    const gridX = localX + cx + pX;

    const gridY = localY + cy + pY;



    const cols = entity.hexGrid.cols | 0;

    const rows = entity.hexGrid.rows | 0;

    const grid = entity.hexGrid.grid;

    if (!grid || cols <= 0 || rows <= 0) return null;



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



    if (!hitShard) return null;

    _staticProbeResult.hitShard = hitShard;
    _staticProbeResult.localX = localX;
    _staticProbeResult.localY = localY;
    _staticProbeResult.scale = scale;
    _staticProbeResult.c = c;
    _staticProbeResult.s = s;
    _staticProbeResult.cx = cx;
    _staticProbeResult.cy = cy;
    _staticProbeResult.pX = pX;
    _staticProbeResult.pY = pY;

    return _staticProbeResult;

  },



  probeImpact(entity, worldX, worldY) {

    return !!this._probeImpactData(entity, worldX, worldY);

  },



  applyImpact(entity, worldX, worldY, damage = 0, bulletVel = { x: 0, y: 0 }, opts = null) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tImpact0 = dbgEnabled ? nowMs() : 0;

    try {

    const probe = this._probeImpactData(entity, worldX, worldY);

    if (!probe) return false;

    const { hitShard, localX, localY, scale, c, s, cx, cy, pX, pY } = probe;



    if (damage <= 0) {

      if (opts?.wakeOnProbe === true) this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

      return true;

    }



    let forceX = ((bulletVel?.x || 0) * c + (bulletVel?.y || 0) * s) / scale;

    let forceY = (-(bulletVel?.x || 0) * s + (bulletVel?.y || 0) * c) / scale;

    if (Math.sqrt(forceX * forceX + forceY * forceY) < 0.001) {

      const fx = (hitShard.gridX - cx - pX) - localX;

      const fy = (hitShard.gridY - cy - pY) - localY;

      const fm = Math.sqrt(fx * fx + fy * fy) || 1;

      forceX = (fx / fm) * Math.max(10, damage * 0.4);

      forceY = (fy / fm) * Math.max(10, damage * 0.4);

    }



    const damageScale = Math.max(0.35, damage / 80);

    markRingSegmentHot(entity, 1500, 15000);

    this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

    const customRadius = opts?.radius || DESTRUCTOR_CONFIG.bendingRadius;

    this.distributeStructuralDamage(

      entity,

      localX,

      localY,

      forceX * 0.05 * damageScale,

      forceY * 0.05 * damageScale,

      1.0,

      customRadius

    );



    hitShard.hp -= Math.max(1, damage * 0.9);

    const splitDamageThreshold = DESTRUCTOR_CONFIG.splitDamageThreshold ?? 200;

    if (hitShard.hp <= 0 && !hitShard.isDebris) {

      this.destroyShard(entity, hitShard, { x: getEntityVelX(entity), y: getEntityVelY(entity) });

      if (!entity.noSplit && damage >= splitDamageThreshold) this.splitQueue.push(entity);

    }



    markGridMeshDirtyByShard(entity.hexGrid, hitShard);

    if (!HEX_SHIPS_3D_ACTIVE) {

      entity.hexGrid.textureDirty = true;

      entity.hexGrid.cacheDirty = true;

    }

    return true;

    } finally {

      if (dbgEnabled) this._dbgCollisionRecord('applyImpact', nowMs() - tImpact0);

    }

  },



  distributeStructuralDamage(entity, impactLocalX, impactLocalY, forceX, forceY, damageScale = 1.0, customRadius = null) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tDeform0 = dbgEnabled ? nowMs() : 0;

    try {

    if (!entity?.hexGrid?.shards) return;

    this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);



    const radius = customRadius || DESTRUCTOR_CONFIG.bendingRadius;

    const invRadius = 1 / radius;

    const currentBendingRadSq = radius * radius;

    const deformMul = DESTRUCTOR_CONFIG.deformMul;

    let anyDestroyed = false;

    let anyMeshChange = false;

    let dirtyMin = Number.POSITIVE_INFINITY;

    let dirtyMax = -1;

    let anyTextureChange = false;



    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;

    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;

    const impactX = impactLocalX + pX;

    const impactY = impactLocalY + pY;



    const forceMag = Math.sqrt(forceX * forceX + forceY * forceY);



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

          if (d2 >= currentBendingRadSq) continue;



          const factor = 1 - Math.sqrt(d2) * invRadius;

          if (factor <= 0) continue;

          const influence = factor * factor * (3 - 2 * factor);



          // FAZA 2: Wstrzykiwanie kinetyki do GPU (Zgniatanie + Wybąblenie)
          const dist = Math.sqrt(d2);
          let radialX = 0, radialY = 0;

          // Wylicz wektor promienisty od epicentrum uderzenia
          if (dist > 0.001) {
            radialX = dx / dist;
            radialY = dy / dist;
          }

          // Główna siła wpychająca w głąb (kierunek pocisku)
          const pushX = forceX * influence * deformMul;
          const pushY = forceY * influence * deformMul;

          // Siła wybąblająca (rozpychanie na boki wokół krateru)
          // influence maleje do zewnątrz, (1 - factor) rośnie do zewnątrz.
          // Razem tworzą "oponkę" (największe rozpychanie jest w połowie krateru)
          const bulgeFactor = influence * (1.0 - factor) * 2.5;
          const bulgeX = radialX * forceMag * bulgeFactor * deformMul;
          const bulgeY = radialY * forceMag * bulgeFactor * deformMul;

          // Łączymy wgniecenie i rozpychanie
          const appliedDefX = pushX + bulgeX;
          const appliedDefY = pushY + bulgeY;



          // Weapons: small local dent, no hull-wide wave.
          // Direct targetDeformation (no applyDeformation — that injects __collVelX for collisions).
          shard.targetDeformation.x += appliedDefX * 0.15;
          shard.targetDeformation.y += appliedDefY * 0.15;

          // Tiny velocity for GPU to propagate locally (damped by GPU overwrite cycle)
          shard.__velX = (Number(shard.__velX) || 0) + (appliedDefX * 0.3);
          shard.__velY = (Number(shard.__velY) || 0) + (appliedDefY * 0.3);



          anyMeshChange = true;

          const shardIdx = Number(shard.__meshIndex);

          if (Number.isFinite(shardIdx)) {

            if (shardIdx < dirtyMin) dirtyMin = shardIdx;

            if (shardIdx > dirtyMax) dirtyMax = shardIdx;

          } else {

            dirtyMin = 0;

            dirtyMax = entity.hexGrid.shards.length - 1;

          }



          // Thermal damage and friction scraping

          if (damageScale > 0) {

            // CPU no longer instantly deletes shards from pure kinetic spikes.

            // Convert impact into heat so damage accumulates over sustained scraping.

            // Shards should wear down over time instead of evaporating in one frame.

            const frictionHeat = (Math.abs(appliedDefX) + Math.abs(appliedDefY)) * 0.05;



            shard.hp -= frictionHeat;



            if (!HEX_SHIPS_3D_ACTIVE && frictionHeat > 0.5) anyTextureChange = true;



            // Shard dies from friction, or from GPU stress tearing.

            if (shard.hp <= 0 && !shard.isDebris) {

              this.destroyShard(entity, shard, { x: getEntityVelX(entity), y: getEntityVelY(entity) });

              anyDestroyed = true;

            }

          }

        }

      }

    }



    const splitForceThreshold = DESTRUCTOR_CONFIG.splitForceThreshold ?? 50;

    if (!entity.noSplit && damageScale > 0 && anyDestroyed && forceMag > splitForceThreshold) this.splitQueue.push(entity);

    if (anyMeshChange || anyDestroyed) markRingSegmentHot(entity, 1200, 12000);

    if (anyMeshChange) {

      if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(entity.hexGrid, dirtyMin, dirtyMax);

      else markGridMeshDirtyAll(entity.hexGrid);

    }

    if (anyTextureChange && !HEX_SHIPS_3D_ACTIVE) {

      entity.hexGrid.textureDirty = true;

      entity.hexGrid.cacheDirty = true;

    }

    } finally {

      if (dbgEnabled) this._dbgCollisionRecord('distributeStructuralDamage', nowMs() - tDeform0);

    }

  },



  resolveCollisions(entities, dt, doDamage, skipRingPairs = false, broadphasePrepared = false) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tResolve0 = dbgEnabled ? nowMs() : 0;

    try {

    const len = entities.length;

    if (len <= 1) return;

    if (!broadphasePrepared) this._prepareBroadphase(entities);

    for (let i = 0; i < len; i++) {

      const A = entities[i];

      if (!A?.hexGrid || A.dead || A.isCollidable === false) continue;

      if (!A?._hasActiveHex) continue;

      if (A.isRingSegment) continue;

      const ax = getEntityPosX(A);

      const ay = getEntityPosY(A);

      const ar = Number(A?._bpRadius) || 100;

      const velAx = getEntityVelX(A);

      const velAy = getEntityVelY(A);

      const speedAMag = Math.sqrt(velAx * velAx + velAy * velAy);

      if (A.hexGrid?.isSleeping && speedAMag < 0.5 && Math.abs(getEntityAngVel(A)) < 0.01) continue;

      const speedA = Math.min(180, speedAMag * (1 / 60));

      const queryCount = this._queryBroadphase(ax, ay, Math.max(80, ar));

      let queryStamp = (this._bpQueryStamp + 1) | 0;

      if (queryStamp <= 0) queryStamp = 1;

      this._bpQueryStamp = queryStamp;

      const candidates = this._bpQueryBuffer;



      for (let ci = 0; ci < queryCount; ci++) {

        const B = candidates[ci];

        if (!B?.hexGrid || B.dead || B.isCollidable === false) continue;

        if (!B?._hasActiveHex) continue;

        if (B === A) continue;

        if (B._destrBpSeen === queryStamp) continue;

        B._destrBpSeen = queryStamp;

        if ((B._destrBpIndex | 0) <= i) continue;

        if (skipRingPairs && B.isRingSegment) continue;

        if (A.isRingSegment && B.isRingSegment) continue;

        const rootA = A.owner || A;

        const rootB = B.owner || B;

        if (rootA === rootB || rootA === B || rootB === A) continue;

        if (dbgEnabled) this._liveCollisionDebug.pairCandidates++;

        const dx = ax - getEntityPosX(B);

        const dy = ay - getEntityPosY(B);



        const velBx = getEntityVelX(B);

        const velBy = getEntityVelY(B);

        const speedBMag = Math.sqrt(velBx * velBx + velBy * velBy);

        const speedB = Math.min(180, speedBMag * (1 / 60));

        const br = Number(B?._bpRadius) || 100;

        const rs = ar + br + speedA + speedB;

        if (dx * dx + dy * dy > rs * rs) continue;

        if (B.isRingSegment && !circleOverlapsEntityRect(
          ax,
          ay,
          ar + speedA + speedB,
          B,
          HEX_SPACING * 6.0
        )) continue;

        if (dbgEnabled) {

          this._liveCollisionDebug.pairNarrow++;

          if (A.isRingSegment || B.isRingSegment) this._liveCollisionDebug.ringPairs++;

        }

        this.collideEntities(A, B, dt, doDamage);

      }

    }

    } finally {

      if (dbgEnabled) this._dbgCollisionRecord('resolveCollisions', nowMs() - tResolve0);

    }

  },



  collideEntities(A, B, dt, doDamage) {

    const dbgEnabled = this._liveCollisionDebug?.enabled === true;

    const tCollide0 = dbgEnabled ? nowMs() : 0;

    try {

    let iterator = A;

    let gridHolder = B;

    if (A.hexGrid.shards.length > B.hexGrid.shards.length) {

      iterator = B;

      gridHolder = A;

    }



    const scaleA = Math.max(0.0001, getFinalScale(A));

    const scaleB = Math.max(0.0001, getFinalScale(B));

    const scaleIter = Math.max(0.0001, getFinalScale(iterator));

    const scaleGrid = Math.max(0.0001, getFinalScale(gridHolder));



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

    const baseSearchR = DESTRUCTOR_CONFIG.collisionSearchRadius ?? 4;

    let searchR = (A.isRingSegment || B.isRingSegment)

      ? Math.max(2, Math.min(3, baseSearchR | 0))

      : baseSearchR;



    // --- POPRAWKA 1: Kompensacja prędkości (Tunelowanie) ---

    // Obliczamy ile heksów statki pokonają w tej klatce i rozszerzamy poszukiwania

    const relVx = getEntityVelX(A) - getEntityVelX(B);

    const relVy = getEntityVelY(A) - getEntityVelY(B);

    const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);

    const speedHexes = Math.ceil((relSpeed * dt) / HEX_SPACING);

    // DRASTYCZNE CIĘCIE! Max 6 heksów to absolutny sufit dla ochrony przed lagami (zmniejszenie iteracji o blisko 80%)

    searchR = Math.min(6, searchR + Math.min(3, speedHexes));



    for (let k = 0; k < 4; k++) {

      const sx = (k === 0 || k === 3) ? -iterRadius : iterRadius;

      const sy = (k < 2) ? -iterRadius : iterRadius;

      const wx = ix + sx;

      const wy = iy + sy;

      const dx = wx - gx;

      const dy = wy - gy;

      const hlx = (dx * cosG + dy * sinG) / scaleGrid;

      const hly = (-dx * sinG + dy * cosG) / scaleGrid;

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

    // Cap contacts to prevent massive collision spikes

    const maxContacts = 128;

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

        const worldGx = gx + (relGx * scaleGrid) * cosG - (relGy * scaleGrid) * sinG;

        const worldGy = gy + (relGx * scaleGrid) * sinG + (relGy * scaleGrid) * cosG;



        const dx = worldGx - ix;

        const dy = worldGy - iy;

        const localIx = (dx * cosI + dy * sinI) / scaleIter;

        const localIy = (-dx * sinI + dy * cosI) / scaleIter;

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

          const worldIx = ix + (relIx * scaleIter) * cosI - (relIy * scaleIter) * sinI;

          const worldIy = iy + (relIx * scaleIter) * sinI + (relIy * scaleIter) * cosI;



          const normalX = worldIx - worldGx;

          const normalY = worldIy - worldGy;

          const dist = Math.sqrt(normalX * normalX + normalY * normalY);



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

          break; // One contact per holder shard is enough — skip remaining offsets

        }

        if (contactsCount >= maxContacts) break;

      }

      if (contactsCount >= maxContacts) break;

    }



    if (contactsCount === 0) return;

    this.wakeHexEntity(A, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

    this.wakeHexEntity(B, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

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



    // Define impactSpeed early so crush logic can use it consistently.

    const impactSpeed = Math.sqrt(dvx * dvx + dvy * dvy);



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

        const approachSpeed = -velAlongNormal; // Closing speed along collision normal



        // Anti-jelly gate:

        // Enable soft-body crush only above crash speed threshold (default 200 px/s).

        // Below threshold, keep rigid behavior for low-speed pushing.

        const crashApproachSpeedThreshold = Number(DESTRUCTOR_CONFIG.crashApproachSpeedThreshold) || 200.0;

        isDestruction = approachSpeed > crashApproachSpeedThreshold;



        const restitution = isDestruction ? 0.0 : restBase;

        let j = (-(1 + restitution) * velAlongNormal) / denom;



        // Crash: reduce rigid impulse (0.05) so bodies can interpenetrate and crumple.

        // Non-crash push: keep full rigid impulse (1.0) to block like solid bodies.

        if (isDestruction) {

          const hittingWall = (invMassA === 0 || invMassB === 0) || A.isRingSegment || B.isRingSegment;

          j *= hittingWall ? 0.8 : 0.8;

        }



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



        // Surface friction: lower in crash mode (0.25), higher in push mode (0.8).

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



    // Enable soft-body crushing only during crash events.

    const crushActive = isDestruction;

    const allowCrush = isDestruction;



    if (crushActive && allowCrush) {

      const angA = getEntityHexAngle(A);

      const angB = getEntityHexAngle(B);

      const ia = 1 / (DESTRUCTOR_CONFIG.collisionIterations || 1);

      const dtScale = dt * 60 * ia;



      const totalMass = massA + massB;

      const ca = Math.cos(angA), sa = Math.sin(angA);

      const cb = Math.cos(angB), sb = Math.sin(angB);

      const shearK = DESTRUCTOR_CONFIG.shearK ?? 0.06;



      const impulse = (totalMass > 0) ? (impactSpeed * (massA * massB) / totalMass) : 0;

      const crushEnergy = impulse * (DESTRUCTOR_CONFIG.crushImpulseScale ?? 0.25) * dtScale;



      let wForceAx = nx * crushEnergy;

      let wForceAy = ny * crushEnergy;

      let wForceBx = -nx * crushEnergy;

      let wForceBy = -ny * crushEnergy;



      // Note: removed synthetic crush boost from penetration term.

      // Penetration now only handles separation correction at the end of function.



      if (Math.abs(velTangent) > 0.1) {

        const sh = velTangent * shearK * dtScale;

        wForceAx += tx * sh;

        wForceAy += ty * sh;

        wForceBx -= tx * sh;

        wForceBy -= ty * sh;

      }



      const forceAx = (wForceAx * ca + wForceAy * sa) / scaleA;

      const forceAy = (-wForceAx * sa + wForceAy * ca) / scaleA;

      const forceBx = (wForceBx * cb + wForceBy * sb) / scaleB;

      const forceBy = (-wForceBx * sb + wForceBy * cb) / scaleB;



      const crushScale = isDestruction ? 1 : 0.35;



      // 2. Nonlinear impact weighting (squared mass ratios)

      const baseRatioA = (invMassB === 0) ? 0.0 : (invMassA === 0 ? 1.0 : massB / totalMass);

      const baseRatioB = (invMassA === 0) ? 0.0 : (invMassB === 0 ? 1.0 : massA / totalMass);



      // Squaring strongly favors damage transfer into lighter body.

      // Example: ship vs ring -> almost all damage stays on the lighter ship.

      const sumSq = (baseRatioA * baseRatioA) + (baseRatioB * baseRatioB);

      const realRatioA = (baseRatioA * baseRatioA) / sumSq;

      const realRatioB = (baseRatioB * baseRatioB) / sumSq;



      let crushDefAx = forceAx * (realRatioA * 2) * crushScale;

      let crushDefAy = forceAy * (realRatioA * 2) * crushScale;

      let crushDefBx = forceBx * (realRatioB * 2) * crushScale;

      let crushDefBy = forceBy * (realRatioB * 2) * crushScale;



      // --- POPRAWKA 2: Uwolnienie limitu wgnieceń ---

      // Pozwalamy wgnieceniom przekroczyć tearThreshold (150), żeby GPU mogło rozerwać siatkę

      const maxCrushLimit = DESTRUCTOR_CONFIG.maxDeform || 220.0;



      const rawCrushMagA = Math.sqrt(crushDefAx * crushDefAx + crushDefAy * crushDefAy);

      const rawCrushMagB = Math.sqrt(crushDefBx * crushDefBx + crushDefBy * crushDefBy);



      // --- POPRAWKA: Płynne, potężne wgniatanie taranem ---

      // Static reusable objects to avoid GC pressure

      const _clampA = this._clampResultA || (this._clampResultA = { x: 0, y: 0 });

      const _clampB = this._clampResultB || (this._clampResultB = { x: 0, y: 0 });

      const clampCrush = (fx, fy, ratio, mag, out) => {

        const limit = maxCrushLimit * (0.15 + ratio * 1.0);

        if (mag > limit) { out.x = (fx / mag) * limit; out.y = (fy / mag) * limit; }

        else { out.x = fx; out.y = fy; }

      };



      clampCrush(crushDefAx, crushDefAy, realRatioA, rawCrushMagA, _clampA);

      clampCrush(crushDefBx, crushDefBy, realRatioB, rawCrushMagB, _clampB);

      const clampA = _clampA;

      const clampB = _clampB;



      let crushStampB = (this._crushStampCounter + 2) | 0;

      if (crushStampB <= 1) crushStampB = 2;

      this._crushStampCounter = crushStampB;

      this._crushStampA = crushStampB - 1;

      this._crushStampB = crushStampB;



      const massAdvantageA = massA / (massB + 1);

      const massAdvantageB = massB / (massA + 1);



      // KAGANIEC OBRAŻEŃ CPU: max 30% HP na jedną klatkę fizyki.

      // Dajemy heksom ułamek sekundy na przeżycie. Zostaną zniszczone na GPU, gdy naprężenia przekroczą tearThreshold (150).

      const maxDmgPerTick = DESTRUCTOR_CONFIG.shardHP * 0.08;

      let dirtyMinA = Number.POSITIVE_INFINITY;

      let dirtyMaxA = -1;

      let dirtyMinB = Number.POSITIVE_INFINITY;

      let dirtyMaxB = -1;

      for (let c = 0; c < contactsCount; c++) {

        const ct = contacts[c];

        const sA = ct.shardA;

        const sB = ct.shardB;



        // OBIEKT A

        if (sA && sA.active && sA._crushStamp !== this._crushStampA) {

          sA._crushStamp = this._crushStampA;



          // Wpychamy heksy proporcjonalnie do przewagi masy

          const pushMult = 1.0 + Math.min(6.0, massAdvantageB * 0.2);

          const pushX = clampA.x * pushMult;

          const pushY = clampA.y * pushMult;



          sA.applyDeformation(pushX, pushY);

          const idxA = Number(sA.__meshIndex);

          if (Number.isFinite(idxA)) {

            if (idxA < dirtyMinA) dirtyMinA = idxA;

            if (idxA > dirtyMaxA) dirtyMaxA = idxA;

          } else {

            dirtyMinA = 0;

            dirtyMaxA = A.hexGrid.shards.length - 1;

          }



          // Wstrzyknięcie dużego pędu dla GPU (tworzy efekt płynnego "rozchodzenia się" wgniecenia na boki)

          sA.__collVelX = (Number(sA.__collVelX) || 0) + (pushX * 1.2);

          sA.__collVelY = (Number(sA.__collVelY) || 0) + (pushY * 1.2);



          if (doDamage) {

            // Mniej natychmiastowych obrażeń, więcej fizycznego rozrywania

            const kineticDmg = (rawCrushMagA * realRatioA * 0.18 * massAdvantageB) / Math.sqrt(contactsCount);

            sA.hp -= Math.min(maxDmgPerTick, kineticDmg);

          }

          if (sA.hp <= 0) this.destroyShard(A, sA, { x: getEntityVelX(A), y: getEntityVelY(A) });

        }



        // OBIEKT B

        if (sB && sB.active && sB._crushStamp !== this._crushStampB) {

          sB._crushStamp = this._crushStampB;



          const pushMult = 1.0 + Math.min(6.0, massAdvantageA * 0.2);

          const pushX = clampB.x * pushMult;

          const pushY = clampB.y * pushMult;



          sB.applyDeformation(pushX, pushY);

          const idxB = Number(sB.__meshIndex);

          if (Number.isFinite(idxB)) {

            if (idxB < dirtyMinB) dirtyMinB = idxB;

            if (idxB > dirtyMaxB) dirtyMaxB = idxB;

          } else {

            dirtyMinB = 0;

            dirtyMaxB = B.hexGrid.shards.length - 1;

          }



          sB.__collVelX = (Number(sB.__collVelX) || 0) + (pushX * 1.2);

          sB.__collVelY = (Number(sB.__collVelY) || 0) + (pushY * 1.2);



          if (doDamage) {

            const kineticDmg = (rawCrushMagB * realRatioB * 0.18 * massAdvantageA) / Math.sqrt(contactsCount);

            sB.hp -= Math.min(maxDmgPerTick, kineticDmg);

          }

          if (sB.hp <= 0) this.destroyShard(B, sB, { x: getEntityVelX(B), y: getEntityVelY(B) });

        }

      }

      if (A.hexGrid && dirtyMaxA >= 0 && Number.isFinite(dirtyMinA)) {

        markGridMeshDirtyRange(A.hexGrid, dirtyMinA, dirtyMaxA);

        if (!HEX_SHIPS_3D_ACTIVE) A.hexGrid.textureDirty = true;

      }

      if (B.hexGrid && dirtyMaxB >= 0 && Number.isFinite(dirtyMinB)) {

        markGridMeshDirtyRange(B.hexGrid, dirtyMinB, dirtyMaxB);

        if (!HEX_SHIPS_3D_ACTIVE) B.hexGrid.textureDirty = true;

      }

    }



    // --- POPRAWKA 4: Miażdżenie taranem ---

    // Jeśli masa jest drastycznie różna (np. 800k vs 30k), niemal wyłączamy odpychanie

    // dla trybu crush. Pozwala to wielkiemu statkowi fizycznie wjechać w mniejszy i go rozerwać.

    const massRatio = Math.max(massA, massB) / Math.max(1, Math.min(massA, massB));

    let crushSep = 0.3;

    if (massRatio > 5) crushSep = 0.05; // Prawie brak separacji - statek wgniata mniejszego



    const isRingCollision = !!(A?.isRingSegment || B?.isRingSegment);
    const isHittingWallSep = (invMassA === 0 || invMassB === 0) || isRingCollision;

    const sepPercent = isHittingWallSep ? 1.0 : (crushActive ? crushSep : 0.8);



    if (penetration > slop) {

      const corr = Math.max(penetration - slop, 0) / (invMassA + invMassB) * sepPercent;

      addEntityPosition(A, nx * corr * invMassA, ny * corr * invMassA);

      addEntityPosition(B, -nx * corr * invMassB, -ny * corr * invMassB);

    }

    } finally {

      if (dbgEnabled) this._dbgCollisionRecord('collideEntities', nowMs() - tCollide0);

    }

  },



  destroyShard(entity, shard, velVector) {

    if (!entity?.hexGrid || !shard || shard.isDebris) return;

    this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

    shard.hp = 0;

    const skipCanvasErase = HEX_SHIPS_3D_ACTIVE && entity.isRingSegment;

    if (!skipCanvasErase) {

      const ctx = entity.hexGrid.cacheCtx;

      if (!ctx) return;

      ctx.save();

      ctx.globalCompositeOperation = 'destination-out';

      ctx.translate(shard.gridX + shard.deformation.x, shard.gridY + shard.deformation.y);

      ctx.beginPath();

      ctx.arc(0, 0, shard.radius * 1.12, 0, Math.PI * 2);

      ctx.fill();

      ctx.restore();

      ctx.globalCompositeOperation = 'source-over';

    }

    const scale = getFinalScale(entity);

    if (skipCanvasErase) {

      shard.isDebris = true;

      shard.active = false;

    } else {

      shard.becomeDebris(

        (velVector?.x || 0) * 0.3 + shard.deformation.x * 2,

        (velVector?.y || 0) * 0.3 + shard.deformation.y * 2,

        entity,

        scale

      );

    }

    if (Number.isFinite(entity.hexGrid.activeStructuralCount)) {

      entity.hexGrid.activeStructuralCount = Math.max(0, entity.hexGrid.activeStructuralCount - 1);

    }

    markGridMeshDirtyByShard(entity.hexGrid, shard);

    entity.hexGrid.gpuTextureNeedsUpdate = !skipCanvasErase;

  },



  recycleWreck(wreck) {

    if (!wreck || !wreck.isWreck || wreck._inPool) return;

    wreck.dead = true;

    wreck.isCollidable = false;

    wreck._inPool = true;

    this._wreckPool.push(wreck);

  },



  processSplits(entities) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tSplitDbg0 = dbgEnabled ? nowMs() : 0;
    try {

    const queued = this.splitQueue;

    if (!queued.length) return;

    this.splitQueue = [];



    let stamp = (this._splitStamp + 1) | 0;

    if (stamp <= 0) stamp = 1;

    this._splitStamp = stamp;



    const queue = this._splitUniqueBuffer;

    queue.length = 0;

    for (let i = 0; i < queued.length; i++) {

      const entity = queued[i];

      if (!entity) continue;

      if (entity._destrSplitStamp === stamp) continue;

      entity._destrSplitStamp = stamp;

      queue.push(entity);

    }



    const splitBudgetMs = Math.max(0.25, Number(DESTRUCTOR_CONFIG.splitTimeBudgetMs) || 1.2);

    const splitMaxPerTick = Math.max(1, DESTRUCTOR_CONFIG.splitMaxPerTick | 0);

    const startedAt = nowMs();

    let processedCount = 0;

    const deferred = this.splitQueue;



    for (const entity of queue) {

      if (!entity?.hexGrid) continue;

      if (processedCount >= splitMaxPerTick || (nowMs() - startedAt) > splitBudgetMs) {

        deferred.push(entity);

        continue;

      }

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

      processedCount++;

    }
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('processSplits', nowMs() - tSplitDbg0);
    }

  },



  findIslands(grid) {

    const cols = grid?.cols | 0;

    const rows = grid?.rows | 0;

    const cells = grid?.grid;

    if (!cells || cols <= 0 || rows <= 0) return [];



    const total = cols * rows;

    let visited = grid._islandVisited;

    if (!(visited instanceof Uint8Array) || visited.length < total) {

      visited = new Uint8Array(total);

      grid._islandVisited = visited;

    } else {

      visited.fill(0, 0, total);

    }



    let stack = grid._islandStack;

    if (!(stack instanceof Int32Array) || stack.length < total) {

      stack = new Int32Array(total);

      grid._islandStack = stack;

    }



    const groups = [];

    for (let seedIdx = 0; seedIdx < total; seedIdx++) {

      if (visited[seedIdx]) continue;

      const seed = cells[seedIdx];

      if (!seed || !seed.active || seed.isDebris) {

        visited[seedIdx] = 1;

        continue;

      }



      const group = [];

      let stackSize = 0;

      stack[stackSize++] = seedIdx;

      visited[seedIdx] = 1;



      while (stackSize > 0) {

        const curIdx = stack[--stackSize];

        const cur = cells[curIdx];

        if (!cur || !cur.active || cur.isDebris) continue;

        group.push(cur);



        for (const n of cur.neighbors || []) {

          if (!n || !n.active || n.isDebris) continue;

          const nc = n.c | 0;

          const nr = n.r | 0;

          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;

          const nIdx = nc + nr * cols;

          if (visited[nIdx]) continue;

          if (cells[nIdx] !== n) continue;

          visited[nIdx] = 1;

          stack[stackSize++] = nIdx;

        }

      }

      if (group.length) groups.push(group);

    }

    return groups;

  },



  rebuildEntityGrid(entity, shards) {

    const cols = entity.hexGrid.cols || Math.ceil(entity.hexGrid.srcWidth / HEX_SPACING);

    const rows = entity.hexGrid.rows || Math.ceil(entity.hexGrid.srcHeight / HEX_HEIGHT);

    const map = {};

    const grid = new Array(cols * rows);

    for (let i = 0; i < shards.length; i++) {

      const s = shards[i];

      s.__meshIndex = i;

      map[s.c + ',' + s.r] = s;

      if (s.c >= 0 && s.c < cols && s.r >= 0 && s.r < rows) grid[s.c + s.r * cols] = s;

    }

    entity.hexGrid.shards = shards;

    entity.hexGrid.map = map;

    entity.hexGrid.grid = grid;

    entity.hexGrid.cols = cols;

    entity.hexGrid.rows = rows;

    if (!HEX_SHIPS_3D_ACTIVE) {

      entity.hexGrid.textureDirty = true;

      entity.hexGrid.cacheDirty = true;

    } else {

      entity.hexGrid.textureDirty = false;

      entity.hexGrid.cacheDirty = false;

    }

    markGridMeshDirtyAll(entity.hexGrid);

    entity.hexGrid.isSleeping = false;

    entity.hexGrid.sleepFrames = 0;

    entity.hexGrid.wakeHoldFrames = DESTRUCTOR_CONFIG.elasticWakeFrames | 0;

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



    let wreck = this._wreckPool.pop();



    if (!wreck) {

      const canvas = document.createElement('canvas');

      wreck = {

        hexGrid: {

          map: {},

          grid: [],

          cacheCanvas: canvas,

          cacheCtx: canvas.getContext('2d', { willReadFrequently: true }),

          pivot: { x: 0, y: 0 },

          meshDirtyAll: false,

          meshDirtyStart: -1,

          meshDirtyEnd: -1

        }

      };

    }



    wreck._inPool = false;

    wreck.x = worldX;

    wreck.y = worldY;

    wreck.vx = wreckVx;

    wreck.vy = wreckVy;

    wreck.angle = getEntityAngle(parent);

    wreck.angVel = getEntityAngVel(parent);

    wreck.radius = newRadius;

    wreck.mass = Math.max(10, shards.length * DESTRUCTOR_CONFIG.shardMass);

    wreck.friction = 0.998;

    wreck.dead = false;

    wreck.isWreck = true;

    wreck.isCollidable = true;

    wreck.owner = parent.owner || parent;

    wreck.visual = { spriteScale: scale, spriteRotation: getEntitySpriteRotation(parent) };



    const wGrid = wreck.hexGrid;

    wGrid.shards = shards;

    wGrid.cols = cols;

    wGrid.rows = rows;

    wGrid.srcWidth = parent.hexGrid.srcWidth;

    wGrid.srcHeight = parent.hexGrid.srcHeight;

    wGrid.armorImage = parent.hexGrid.armorImage || null;

    wGrid.damagedImage = parent.hexGrid.damagedImage || null;

    if (!HEX_SHIPS_3D_ACTIVE) {

      wGrid.cacheDirty = true;

      wGrid.textureDirty = true;

    } else {

      wGrid.cacheDirty = false;

      wGrid.textureDirty = false;

    }

    markGridMeshDirtyAll(wGrid);

    wGrid.gpuTextureNeedsUpdate = false;

    wGrid.isSleeping = false;

    wGrid.sleepFrames = 0;

    wGrid.wakeHoldFrames = DESTRUCTOR_CONFIG.elasticWakeFrames | 0;

    wGrid.activeStructuralCount = shards.length;

    wGrid.baseStructuralCount = shards.length;

    wGrid.pivot.x = relX;

    wGrid.pivot.y = relY;



    wGrid.cacheCanvas.width = wGrid.srcWidth;

    wGrid.cacheCanvas.height = wGrid.srcHeight;

    wGrid.cacheCtx.drawImage(parent.hexGrid.cacheCanvas, 0, 0);



    const gridLen = cols * rows;

    if (wGrid.grid.length < gridLen) wGrid.grid = new Array(gridLen);

    else wGrid.grid.fill(undefined);



    for (const key in wGrid.map) delete wGrid.map[key];



    for (let i = 0; i < shards.length; i++) {

      const hs = shards[i];

      hs.__meshIndex = i;

      wGrid.map[hs.c + ',' + hs.r] = hs;

      if (hs.c >= 0 && hs.c < cols && hs.r >= 0 && hs.r < rows) {

        wGrid.grid[hs.c + hs.r * cols] = hs;

      }

    }

    rebuildNeighbors(wGrid);



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



export function initHexBody(entity, image, damagedImage = null, isProjectile = false, massOverride = null, alphaCutoff = 40) {

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



  const alphaThreshold = Math.max(0, Math.min(255, Number(alphaCutoff) || 40));



  for (let c = 0; c < cols; c++) {

    for (let ro = 0; ro < rows; ro++) {

      const x = c * r * 1.5;

      let y = ro * hexHeight;

      if (c % 2 !== 0) y += hexHeight * 0.5;

      const px = Math.floor(x);

      const py = Math.floor(y);

      if (px < 0 || py < 0 || px >= w || py >= h) continue;

      const alpha = data[(py * w + px) * 4 + 3];

      if (alpha <= alphaThreshold) continue;

      const shard = new HexShard(isProjectile ? null : src, damaged, x, y, r, c, ro, isProjectile ? '#ffcc00' : null);

      shard.__meshIndex = shards.length;

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

    armorImage: src,

    damagedImage: damaged,

    rawRadius: Math.sqrt(rawRadiusSq) + r,

    cacheCanvas,

    cacheCtx,

    cacheDirty: false,

    textureDirty: false,

    meshDirty: false,

    meshDirtyAll: false,

    meshDirtyStart: -1,

    meshDirtyEnd: -1,

    gpuTextureNeedsUpdate: false,

    isSleeping: false,

    sleepFrames: 0,

    wakeHoldFrames: DESTRUCTOR_CONFIG.elasticWakeFrames | 0,

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

if (typeof window !== 'undefined') {
  window.ColFuncDbgStart = (intervalMs = 1000) => DestructorSystem.setCollisionLiveDebug(true, intervalMs);
  window.ColFuncDbgStop = () => DestructorSystem.setCollisionLiveDebug(false);
  window.ColFuncDbgDump = () => DestructorSystem._dbgCollisionFlush(nowMs(), true);
}









