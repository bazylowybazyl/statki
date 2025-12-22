/**
 * Moduł Destrukcji "Hex Grinder"
 * Wersja: FIXED SCALING & HITBOX
 */

export const DESTRUCTOR_CONFIG = {
  gridDivisions: 60,
  shardHP: 40,
  deformStrength: 20.0,
  deformRadius: 8.0,
  maxDeform: 0.98,
  structureWarp: 2.0,
  friction: 0.99
};

function getFinalScale(entity) {
    if (!entity.hexGrid) return 1.0;
    // Jeśli statek ma zdefiniowany promień i znamy szerokość zawartości
    if (entity.radius && entity.hexGrid.contentWidth) {
        // Skalujemy tak, aby 'contentWidth' pasował do 2 * radius (średnicy)
        return ((entity.radius * 2) / entity.hexGrid.contentWidth) * 1.05;
    }
    // Fallback do szerokości obrazka
    if (entity.radius && entity.hexGrid.srcWidth) {
        return ((entity.radius * 2) / entity.hexGrid.srcWidth) * 1.05;
    }
    return 1.0;
}

export const DestructorSystem = {
  debris: [],
  sparks: [],
  // Kolejka obiektów do sprawdzenia czy się nie rozpadły
  splitQueue: new Set(),

  update(dt, entities) {
    // 1. Aktualizacja odłamków
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.updateDebris();
      if (!d.active) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }

    // 2. Aktualizacja iskier
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
      }
    }

    // 3. Kolizje
    this.resolveHexGrinding(entities);

    // 4. Obsługa pękania statków (Split Check)
    this.processSplits(entities);
  },

  applyImpact(entity, worldX, worldY, damage, bulletVel) {
    if (!entity.hexGrid) return false; 
    if (entity.fighter || (entity.type && ['fighter','interceptor','drone'].includes(entity.type))) {
        return false;
    }

    const r = DESTRUCTOR_CONFIG.gridDivisions;
    const h = r * Math.sqrt(3);
    const scale = getFinalScale(entity);

    const pos = entity.pos || {x: entity.x, y: entity.y};
    const ang = entity.angle || 0;
    
    const dx = worldX - pos.x;
    const dy = worldY - pos.y;
    
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    
    const lx = (dx * c - dy * s) / scale;
    const ly = (dx * s + dy * c) / scale;

    const searchRadius = scale < 0.5 ? 2 : 1;
    // Korekta offsetu przy wyszukiwaniu w mapie
    const approxC = Math.round((lx - entity.hexGrid.offsetX) / (1.5 * r));
    const approxR = Math.round((ly - entity.hexGrid.offsetY) / h);

    let hitSomething = false;

    for (let dc = -searchRadius; dc <= searchRadius; dc++) {
      for (let dr = -searchRadius; dr <= searchRadius; dr++) {
         const key = (approxC + dc) + "," + (approxR + dr);
         const shard = entity.hexGrid.map[key];

         if (shard && shard.active && !shard.isDebris) {
             const distSq = (shard.lx - lx)**2 + (shard.ly - ly)**2;
             // Zwiększona tolerancja trafienia
             if (distSq < (r * 2.5)**2) {
                 hitSomething = true;
                 
                 const lvx = bulletVel.x * c - bulletVel.y * s;
                 const lvy = bulletVel.x * s + bulletVel.y * c;
                 
                 shard.deform(lx - shard.lx, ly - shard.ly); 
                 const warpFactor = 0.05 * (damage / 50); 
                 shard.warpStructure(lvx * warpFactor, lvy * warpFactor, r * 2.0);

                 shard.hp -= damage / shard.hardness;

                 if (shard.hp <= 0) {
                     this.spawnSparks(worldX, worldY, 3);
                     shard.becomeDebris(bulletVel.x * 0.15, bulletVel.y * 0.15, entity, scale);
                     this.splitQueue.add(entity);
                 }
             }
         }
      }
    }
    
    return hitSomething;
  },

  resolveHexGrinding(entities) {
    const r = DESTRUCTOR_CONFIG.gridDivisions;
    const h = r * Math.sqrt(3);
    const checkDistSq = (r * 2.2) ** 2; 

    const activeBodies = entities.filter(e => e && !e.dead && e.hexGrid);

    for (let i = 0; i < activeBodies.length; i++) {
      const A = activeBodies[i];
      const scaleA = getFinalScale(A);
      const massA = A.rammingMass || A.mass || 100;
      
      const realRadA = A.hexGrid.rawRadius ? (A.hexGrid.rawRadius * scaleA) : (A.radius || 100);
      const broadPhaseRadA = Math.max(A.radius || 0, realRadA);

      for (let j = i + 1; j < activeBodies.length; j++) {
        const B = activeBodies[j];
        const scaleB = getFinalScale(B);
        const massB = B.rammingMass || B.mass || 100;

        const realRadB = B.hexGrid.rawRadius ? (B.hexGrid.rawRadius * scaleB) : (B.radius || 100);
        const broadPhaseRadB = Math.max(B.radius || 0, realRadB);

        const posA = A.pos || {x: A.x, y: A.y};
        const posB = B.pos || {x: B.x, y: B.y};
        
        const distSq = (posA.x - posB.x)**2 + (posA.y - posB.y)**2;
        const radSum = broadPhaseRadA + broadPhaseRadB;
        
        if (distSq > radSum * radSum) continue;

        let iterator = A, gridHolder = B;
        let iterScale = scaleA, gridScale = scaleB;
        
        if (A.hexGrid.shards.length > B.hexGrid.shards.length) { 
            iterator = B; gridHolder = A; 
            iterScale = scaleB; gridScale = scaleA;
        }
        
        const massIter = iterator.rammingMass || iterator.mass || 100;
        const massHolder = gridHolder.rammingMass || gridHolder.mass || 100;

        const iPos = iterator.pos || {x: iterator.x, y: iterator.y};
        const gPos = gridHolder.pos || {x: gridHolder.x, y: gridHolder.y};
        
        const gCos = Math.cos(-gridHolder.angle); 
        const gSin = Math.sin(-gridHolder.angle);
        const iCos = Math.cos(iterator.angle); 
        const iSin = Math.sin(iterator.angle);
        
        const relativeScale = iterScale / gridScale; 
        const searchRadius = relativeScale > 2.0 ? 3 : (relativeScale > 1.0 ? 2 : 1);

        const relVx = (iterator.vx || 0) - (gridHolder.vx || 0);
        const relVy = (iterator.vy || 0) - (gridHolder.vy || 0);
        const impactSpeed = Math.hypot(relVx, relVy) * 0.5; 
        const warpStrength = DESTRUCTOR_CONFIG.structureWarp * (impactSpeed * 0.5);

        for (const sI of iterator.hexGrid.shards) {
          if (!sI.active || sI.isDebris) continue;

          const wx = iPos.x + (sI.lx * iterScale) * iCos - (sI.ly * iterScale) * iSin;
          const wy = iPos.y + (sI.lx * iterScale) * iSin + (sI.ly * iterScale) * iCos;

          const rdx = wx - gPos.x;
          const rdy = wy - gPos.y;
          const glxRaw = rdx * gCos - rdy * gSin;
          const glyRaw = rdx * gSin + rdy * gCos;
          
          const glx = glxRaw / gridScale;
          const gly = glyRaw / gridScale;

          const approxC = Math.round((glx - gridHolder.hexGrid.offsetX) / (1.5 * r));
          const approxR = Math.round((gly - gridHolder.hexGrid.offsetY) / h);

          for (let dc = -searchRadius; dc <= searchRadius; dc++) {
            for (let dr = -searchRadius; dr <= searchRadius; dr++) {
              const key = (approxC + dc) + "," + (approxR + dr);
              const sG = gridHolder.hexGrid.map[key];

              if (sG && sG.active && !sG.isDebris) {
                const dx = sG.lx - glx;
                const dy = sG.ly - gly;

                if (dx*dx + dy*dy < checkDistSq) {
                  const baseDamage = 35; 
                  const crushFactor = 0.08; 
                  const speedFactor = Math.max(1, impactSpeed * 0.15);
                  
                  const damageToHolder = baseDamage + (massIter / 1000) * crushFactor * speedFactor;
                  const damageToIter = baseDamage + (massHolder / 1000) * crushFactor * speedFactor;

                  sG.hp -= damageToHolder;
                  sI.hp -= damageToIter;

                  sG.deform(-dx, -dy);
                  const dist = Math.sqrt(dx*dx + dy*dy) || 1;
                  const warpPush = warpStrength * (1.0 / sG.hardness);
                  sG.warpStructure((dx/dist) * warpPush, (dy/dist) * warpPush, r * 1.5);

                  const collisionForce = 80000; 
                  const dt = 0.016; 
                  
                  const centerDx = iPos.x - gPos.x;
                  const centerDy = iPos.y - gPos.y;
                  const centerDist = Math.hypot(centerDx, centerDy) || 1;
                  const pushDirX = centerDx / centerDist;
                  const pushDirY = centerDy / centerDist;

                  const accelIter = collisionForce / massIter;
                  const accelHolder = collisionForce / massHolder;

                  if (iterator.vel) { 
                      iterator.vel.x += pushDirX * accelIter * dt; 
                      iterator.vel.y += pushDirY * accelIter * dt; 
                  } else { 
                      iterator.vx += pushDirX * accelIter * dt; 
                      iterator.vy += pushDirY * accelIter * dt; 
                  }
                  
                  if (gridHolder.vel) { 
                      gridHolder.vel.x -= pushDirX * accelHolder * dt; 
                      gridHolder.vel.y -= pushDirY * accelHolder * dt; 
                  } else { 
                      gridHolder.vx -= pushDirX * accelHolder * dt; 
                      gridHolder.vy -= pushDirY * accelHolder * dt; 
                  }

                  if (sG.hp <= 0) {
                    this.spawnSparks(wx, wy, 2);
                    sG.becomeDebris(iterator.vx * 0.2, iterator.vy * 0.2, gridHolder, gridScale);
                    this.splitQueue.add(gridHolder);
                  }
                  if (sI.hp <= 0) {
                    this.spawnSparks(wx, wy, 2);
                    sI.becomeDebris(gridHolder.vx * 0.2, gridHolder.vy * 0.2, iterator, iterScale);
                    this.splitQueue.add(iterator);
                  }
                }
              }
            }
          }
        }
      }
    }
  },

  processSplits(activeEntities) {
    if (this.splitQueue.size === 0) return;

    for (const entity of this.splitQueue) {
        if (!entity.hexGrid || entity.dead) continue;
        const groups = findConnectedComponents(entity.hexGrid);

        if (groups.length <= 1) continue;

        let mainGroup = null;
        const wreckGroups = [];

        for (const group of groups) {
            const hasCore = group.some(shard => shard.isCore);
            // Wybieramy największą grupę z rdzeniem jako główny statek
            if (hasCore) {
                if (!mainGroup || group.length > mainGroup.length) {
                    if (mainGroup) wreckGroups.push(mainGroup);
                    mainGroup = group;
                } else {
                    wreckGroups.push(group);
                }
            } else {
                wreckGroups.push(group);
            }
        }

        if (!mainGroup && groups.length > 0) {
             // Jeśli statek stracił wszystkie rdzenie - umiera
             entity.dead = true;
             wreckGroups.push(...groups);
        }

        // --- ZASTOSOWANIE ZMIAN ---
        
        // 1. Główny statek (Gracz/NPC) zostaje, ale traci odłączone części
        if (mainGroup && !entity.dead) {
            rebuildEntityGrid(entity, mainGroup);
        }

        // 2. Odłączone części stają się wrakami
        for (const group of wreckGroups) {
            if (window.createWreckage) {
                window.createWreckage(entity, group);
            }
        }
    }
    this.splitQueue.clear();
  },

  spawnSparks(x, y, count = 1) {
    for(let i=0; i<count; i++) {
        this.sparks.push({
            x, y,
            vx: (Math.random()-0.5) * 500,
            vy: (Math.random()-0.5) * 500,
            life: 1.0,
            color: '#fbbf24'
        });
    }
  },

  draw(ctx, camera, worldToScreenFunc) {
    const viewLeft = camera.x - (ctx.canvas.width/2)/camera.zoom - 200;
    const viewRight = camera.x + (ctx.canvas.width/2)/camera.zoom + 200;
    const viewTop = camera.y - (ctx.canvas.height/2)/camera.zoom - 200;
    const viewBottom = camera.y + (ctx.canvas.height/2)/camera.zoom + 200;

    ctx.save();
    for (const d of this.debris) {
        if (d.worldX < viewLeft || d.worldX > viewRight || d.worldY < viewTop || d.worldY > viewBottom) continue;
        d.draw(ctx, camera, worldToScreenFunc);
    }
    ctx.restore();

    ctx.save();
    for (const s of this.sparks) {
        const p = worldToScreenFunc(s.x, s.y, camera);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.life;
        ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.restore();
  }
};

// --- FUNKCJE POMOCNICZE ---

function findConnectedComponents(hexGrid) {
    const shards = hexGrid.shards.filter(s => s.active && !s.isDebris);
    if (shards.length === 0) return [];

    const visited = new Set();
    const groups = [];

    for (const seed of shards) {
        const seedKey = seed.c + "," + seed.r;
        if (visited.has(seedKey)) continue;

        const group = [];
        const stack = [seed];
        visited.add(seedKey);

        while (stack.length > 0) {
            const current = stack.pop();
            group.push(current);

            const odd = (current.c % 2 !== 0);
            const neighborOffsets = odd
                ? [[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]]
                : [[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]];

            for (const offset of neighborOffsets) {
                const nc = current.c + offset[0];
                const nr = current.r + offset[1];
                const nKey = nc + "," + nr;

                const neighbor = hexGrid.map[nKey];
                if (neighbor && neighbor.active && !neighbor.isDebris && !visited.has(nKey)) {
                    visited.add(nKey);
                    stack.push(neighbor);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function rebuildEntityGrid(entity, shardsToKeep) {
    const newMap = {};
    const newShards = [];
    let minLx = Infinity, maxLx = -Infinity;
    let rawRadiusSq = 0;

    for (const s of shardsToKeep) {
        newShards.push(s);
        newMap[s.c + "," + s.r] = s;
        
        minLx = Math.min(minLx, s.lx);
        maxLx = Math.max(maxLx, s.lx);
        
        // Obliczamy nowy promień surowy (od środka obrazka)
        const distSq = s.lx * s.lx + s.ly * s.ly;
        if (distSq > rawRadiusSq) rawRadiusSq = distSq;
    }

    entity.hexGrid.shards = newShards;
    entity.hexGrid.map = newMap;

    if (newShards.length > 0) {
        const r = newShards[0].radius || DESTRUCTOR_CONFIG.gridDivisions;
        entity.hexGrid.rawRadius = Math.sqrt(rawRadiusSq) + r;
        entity.hexGrid.contentWidth = Math.max(1, maxLx - minLx);
        
        // === FIX BŁĘDU: AKTUALIZACJA FIZYCZNEGO PROMIENIA ===
        // Bez tego getFinalScale() zwracałoby ogromne wartości (mała zawartość / duży stary promień)
        // Co powodowało efekt "wielkiego ducha" nakładającego się na wraki.
        entity.radius = entity.hexGrid.rawRadius; 
    }
}

class HexShard {
  constructor(img, lx, ly, radius, c, r, color = null) {
    this.img = img;
    this.lx = lx;
    this.ly = ly;
    this.origLx = lx;
    this.origLy = ly;
    this.radius = radius;
    this.c = c;
    this.r = r;
    this.color = color;
    this.active = true;
    this.isDebris = false;
    this.isCore = false;
    this.hp = DESTRUCTOR_CONFIG.shardHP;
    this.hardness = 1.0;
    this.worldX = 0; this.worldY = 0;
    this.dvx = 0; this.dvy = 0; this.drot = 0;
    this.alpha = 1;
    this.angle = 0;
    this.scale = 1.0;

    this.verts = [];
    this.baseVerts = [];
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      this.verts.push({ x: px, y: py });
      this.baseVerts.push({ x: px, y: py });
    }
  }

  deform(localHitX, localHitY) {
    const range = this.radius * DESTRUCTOR_CONFIG.deformRadius;
    const strength = DESTRUCTOR_CONFIG.deformStrength / this.hardness;
    const limit = this.radius * DESTRUCTOR_CONFIG.maxDeform;

    for (let i = 0; i < 6; i++) {
      const v = this.verts[i];
      const dx = v.x - localHitX;
      const dy = v.y - localHitY;
      const dist = Math.hypot(dx, dy);
      if (dist < range && dist > 0.001) {
        const t = 1 - dist / range;
        const influence = t * t;
        const nx = dx / dist;
        const ny = dy / dist;
        v.x += nx * strength * influence;
        v.y += ny * strength * influence;
        const bx = v.x - this.baseVerts[i].x;
        const by = v.y - this.baseVerts[i].y;
        const stretch = Math.hypot(bx, by);
        if (stretch > limit) {
           const s = limit / stretch;
           v.x = this.baseVerts[i].x + bx * s;
           v.y = this.baseVerts[i].y + by * s;
        }
      }
    }
  }

  warpStructure(pushX, pushY, limitRadius) {
    this.lx += pushX;
    this.ly += pushY;
    const dx = this.lx - this.origLx;
    const dy = this.ly - this.origLy;
    const distSq = dx*dx + dy*dy;
    const maxSq = limitRadius * limitRadius;
    if (distSq > maxSq) {
        const dist = Math.sqrt(distSq);
        const s = limitRadius / dist;
        this.lx = this.origLx + dx * s;
        this.ly = this.origLy + dy * s;
    }
  }

  becomeDebris(impulseX, impulseY, parentEntity, scale = 1.0) {
    if (this.isDebris) return;
    this.scale = scale;

    const px = parentEntity.pos ? parentEntity.pos.x : parentEntity.x;
    const py = parentEntity.pos ? parentEntity.pos.y : parentEntity.y;
    
    const c = Math.cos(parentEntity.angle);
    const s = Math.sin(parentEntity.angle);
    
    this.worldX = px + (this.lx * scale) * c - (this.ly * scale) * s;
    this.worldY = py + (this.lx * scale) * s + (this.ly * scale) * c;

    let vx = parentEntity.vel ? parentEntity.vel.x : (parentEntity.vx || 0);
    let vy = parentEntity.vel ? parentEntity.vel.y : (parentEntity.vy || 0);
    const angVel = parentEntity.angVel || 0;
    
    const rx = (this.lx * scale) * c - (this.ly * scale) * s;
    const ry = (this.lx * scale) * s + (this.ly * scale) * c;
    vx += -angVel * ry;
    vy +=  angVel * rx;

    this.dvx = vx + impulseX + (Math.random() - 0.5) * 50;
    this.dvy = vy + impulseY + (Math.random() - 0.5) * 50;
    this.drot = (Math.random() - 0.5) * 0.3;
    this.angle = parentEntity.angle;
    this.alpha = 1.5; 

    this.isDebris = true;
    this.active = true;
    DestructorSystem.debris.push(this);
  }

  updateDebris() {
    this.worldX += this.dvx;
    this.worldY += this.dvy;
    this.angle += this.drot;
    this.dvx *= DESTRUCTOR_CONFIG.friction;
    this.dvy *= DESTRUCTOR_CONFIG.friction;
    this.alpha -= 0.005;
    if (this.alpha <= 0) this.active = false;
  }

  draw(ctx, camera, worldToScreenFunc) {
    if (!this.active || !this.isDebris) return; 
    const p = worldToScreenFunc(this.worldX, this.worldY, camera);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    const s = camera.zoom * (this.scale || 1.0);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.min(1, this.alpha);
    this.drawShape(ctx);
    ctx.restore();
  }

  drawShape(ctx) {
    ctx.beginPath();
    const overlap = 1.08; 
    ctx.moveTo(this.verts[0].x * overlap, this.verts[0].y * overlap);
    for (let i = 1; i < 6; i++) {
        ctx.lineTo(this.verts[i].x * overlap, this.verts[i].y * overlap);
    }
    ctx.closePath();

    if (this.color) {
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 0.5;
        ctx.stroke();
    } else if (this.img) {
        ctx.save();
        ctx.clip();
        const texW = this.img.width;
        const texH = this.img.height;
        ctx.translate(-this.lx, -this.ly);
        ctx.drawImage(this.img, -texW/2, -texH/2);
        ctx.restore();
    }
  }
  
  drawLocal(ctx) {
     ctx.save();
     ctx.translate(this.lx, this.ly);
     this.drawShape(ctx);
     ctx.restore();
  }
}

export function initHexBody(entity, image) {
  if (entity.fighter || (entity.type && ['fighter','interceptor','drone'].includes(entity.type))) {
      return;
  }
  if (!image || !image.width) return;
  
  const w = image.width;
  const h = image.height;
  const r = DESTRUCTOR_CONFIG.gridDivisions;
  const hexHeight = Math.sqrt(3) * r;
  
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  
  const shards = [];
  const map = {};
  const cols = Math.ceil(w / (r * 1.5));
  const rows = Math.ceil(h / hexHeight);
  
  const centerX = w / 2;
  const centerY = h / 2;
  
  let minContentX = w, maxContentX = 0;
  let rawRadiusSq = 0;

  for (let c = 0; c < cols; c++) {
      for (let ro = 0; ro < rows; ro++) {
          const cx = c * r * 1.5;
          let cy = ro * hexHeight;
          if (c % 2 !== 0) cy += hexHeight / 2;
          
          let hit = false;
          const offsets = [{x:0,y:0}, {x:r*0.5,y:0}, {x:-r*0.5,y:0}, {x:0,y:r*0.5}, {x:0,y:-r*0.5}];
          for (const off of offsets) {
              const px = Math.floor(cx + off.x);
              const py = Math.floor(cy + off.y);
              if (px >= 0 && px < w && py >= 0 && py < h) {
                  const alpha = data[(py * w + px) * 4 + 3];
                  if (alpha > 40) {
                      hit = true;
                      break;
                  }
              }
          }
          if (hit) {
              const lx = cx - centerX;
              const ly = cy - centerY;
              
              minContentX = Math.min(minContentX, lx);
              maxContentX = Math.max(maxContentX, lx);

              const shard = new HexShard(image, lx, ly, r, c, ro);
              shards.push(shard);
              map[`${c},${ro}`] = shard;
          }
      }
  }

  // --- RDZENIE ---
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const s of shards) {
      if (s.c < minC) minC = s.c;
      if (s.c > maxC) maxC = s.c;
      if (s.r < minR) minR = s.r;
      if (s.r > maxR) maxR = s.r;
  }
  const centerC = Math.floor((minC + maxC) / 2);
  const centerR = Math.floor((minR + maxR) / 2);

  let cw = 2, ch = 2; 
  if (entity.coreDimensions) {
      cw = entity.coreDimensions.w;
      ch = entity.coreDimensions.h;
  } else if (entity.type) {
      if (entity.type.includes('frigate')) { cw = 1; ch = 2; }
      else if (entity.type === 'destroyer') { cw = 2; ch = 2; }
      else if (entity.type === 'battleship') { cw = 3; ch = 3; }
      else if (entity.isCapitalShip) { cw = 3; ch = 5; } 
  }

  const halfW = Math.floor(cw / 2);
  const halfH = Math.floor(ch / 2);
  for (const s of shards) {
      const dc = Math.abs(s.c - centerC);
      const dr = Math.abs(s.r - centerR);
      if (dc <= halfW && dr <= halfH) {
          s.isCore = true;
          s.hardness = 5.0;
          s.hp *= 5.0;
      } else {
          s.isCore = false;
      }
  }

  // --- AUTO-CENTERING ---
  let shiftX = 0;
  let shiftY = 0;
  let finalOffsetX = -centerX;
  let finalOffsetY = -centerY;
  let contentWidth = w;
  
  if (shards.length > 0) {
      // Wyśrodkowanie na podstawie bounding boxa
      shiftX = -(minContentX + maxContentX) / 2;
      // W osi Y nie przesuwamy tak agresywnie, żeby zachować środek obrazka jako pivot
      // Ale jeśli statek jest niesymetryczny, można odkomentować:
      // shiftY = -(minContentY + maxContentY) / 2; 
      
      for (const s of shards) {
          s.lx += shiftX;
          s.ly += shiftY;
          s.origLx += shiftX;
          s.origLy += shiftY;
          
          const d2 = s.lx*s.lx + s.ly*s.ly;
          if(d2 > rawRadiusSq) rawRadiusSq = d2;
      }
      
      finalOffsetX = -centerX + shiftX;
      finalOffsetY = -centerY + shiftY;
      contentWidth = maxContentX - minContentX;
  }
  
  entity.hexGrid = {
      shards,
      map,
      offsetX: finalOffsetX,
      offsetY: finalOffsetY,
      srcWidth: w,
      srcHeight: h,
      contentWidth: contentWidth, 
      rawRadius: Math.sqrt(rawRadiusSq) + r 
  };
  
  if (!entity.radius) entity.radius = Math.max(w, h) / 2;
}

export function drawHexBody(ctx, entity, camera, worldToScreenFunc) {
    if (!entity.hexGrid) return;
    
    const posX = entity.pos ? entity.pos.x : entity.x;
    const posY = entity.pos ? entity.pos.y : entity.y;
    const s = worldToScreenFunc(posX, posY, camera);
    
    const size = entity.radius * camera.zoom;
    // Frustum culling
    if (s.x + size < 0 || s.x - size > ctx.canvas.width ||
        s.y + size < 0 || s.y - size > ctx.canvas.height) return;

    const finalScale = getFinalScale(entity);

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(entity.angle);
    ctx.scale(camera.zoom * finalScale, camera.zoom * finalScale);
    
    for (const shard of entity.hexGrid.shards) {
        if (shard.active && !shard.isDebris) {
            shard.drawLocal(ctx);
        }
    }
    ctx.restore();
}

export function drawHexBodyLocal(ctx, entity) {
    if (!entity.hexGrid) return;
    const finalScale = getFinalScale(entity);
    ctx.save();
    ctx.scale(finalScale, finalScale);
    for (const shard of entity.hexGrid.shards) {
        if (shard.active && !shard.isDebris) {
            shard.drawLocal(ctx);
        }
    }
    ctx.restore();
}