/**
 * Moduł Destrukcji "Hex Grinder"
 * Implementuje fizykę miękkich ciał, mielenie heksów i deformację strukturalną.
 */

// Konfiguracja fizyki (tryb Heavy Metal)
export const DESTRUCTOR_CONFIG = {
  gridDivisions: 20,       // Gęstość siatki (im mmniej tym większe heksy)
  shardHP: 40,             // Bazowe HP heksa (kruchość)
  deformStrength: 20.0,    // Siła wyginania wierzchołków
  deformRadius: 8.0,       // Promień plastyczności
  maxDeform: 0.98,         // Limit rozciągnięcia heksa
  structureWarp: 2.0,      // Siła przesuwania heksa w strukturze
  friction: 0.99           // Tarcie dla odłamków w kosmosie
};

// Pomocnik do pobierania parametrów wizualnych statku
function getVisualProps(entity) {
  const prof = entity.capitalProfile || {};
  return {
    scale: Number.isFinite(prof.spriteScale) ? prof.spriteScale : 1.0,
    rotation: Number.isFinite(prof.spriteRotation) ? prof.spriteRotation : 0,
    offX: (prof.spriteOffset && Number.isFinite(prof.spriteOffset.x)) ? prof.spriteOffset.x : 0,
    offY: (prof.spriteOffset && Number.isFinite(prof.spriteOffset.y)) ? prof.spriteOffset.y : 0
  };
}

// Globalne kontenery dla systemu destrukcji
export const DestructorSystem = {
  debris: [],
  sparks: [],
  
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

    this.resolveHexGrinding(entities);
  },

  applyImpact(entity, worldX, worldY, damage, bulletVel) {
    if (!entity.hexGrid) return false;
    if (entity.fighter || (entity.type && (entity.type === 'fighter' || entity.type === 'interceptor' || entity.type === 'drone'))) {
        return false;
    }

    const { scale, rotation, offX, offY } = getVisualProps(entity);
    const r = DESTRUCTOR_CONFIG.gridDivisions;
    const h = r * Math.sqrt(3);

    const pos = entity.pos || {x: entity.x, y: entity.y};
    const ang = (entity.angle || 0) + rotation;
    
    const dx = worldX - pos.x;
    const dy = worldY - pos.y;
    
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    
    let lx = dx * c - dy * s;
    let ly = dx * s + dy * c;

    lx /= scale;
    ly /= scale;
    lx -= offX;
    ly -= offY;

    const approxC = Math.round((lx - entity.hexGrid.offsetX) / (1.5 * r));
    const approxR = Math.round((ly - entity.hexGrid.offsetY) / h);

    let hitSomething = false;
    const searchRadius = 1;

    for (let dc = -searchRadius; dc <= searchRadius; dc++) {
      for (let dr = -searchRadius; dr <= searchRadius; dr++) {
         const key = (approxC + dc) + "," + (approxR + dr);
         const shard = entity.hexGrid.map[key];

         if (shard && shard.active && !shard.isDebris) {
             const distSq = (shard.lx - lx)**2 + (shard.ly - ly)**2;
             if (distSq < (r * 1.5)**2) {
                 hitSomething = true;
                 
                 const lvx = bulletVel.x * c - bulletVel.y * s;
                 const lvy = bulletVel.x * s + bulletVel.y * c;
                 
                 shard.deform(lx - shard.lx, ly - shard.ly); 
                 const warpFactor = 0.05 * (damage / 50) / scale; 
                 shard.warpStructure(lvx * warpFactor, lvy * warpFactor, r * 2.0);

                 shard.hp -= damage / shard.hardness;

                 if (shard.hp <= 0) {
                     this.spawnSparks(worldX, worldY, 3);
                     shard.becomeDebris(bulletVel.x * 0.15, bulletVel.y * 0.15, entity, {scale, rotation, offX, offY});
                 }
             }
         }
      }
    }
    return hitSomething;
  },

  resolveHexGrinding(entities) {
      // Logika kolizji heksów (skrócona wersja z poprzednich plików)
      // Wymaga analogicznych poprawek 'scale' jak applyImpact, 
      // ale dla uproszczenia w tym momencie zostawiamy pustą lub podstawową implementację
      // jeśli nie używasz taranowania statkami.
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
    this.hp = DESTRUCTOR_CONFIG.shardHP;
    this.hardness = 1.0;
    this.worldX = 0; this.worldY = 0;
    this.dvx = 0; this.dvy = 0; this.drot = 0;
    this.alpha = 1;
    this.angle = 0;
    this.debScale = 1;
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

  becomeDebris(impulseX, impulseY, parentEntity, visualProps = {scale:1, rotation:0, offX:0, offY:0}) {
    if (this.isDebris) return;
    const px = parentEntity.pos ? parentEntity.pos.x : parentEntity.x;
    const py = parentEntity.pos ? parentEntity.pos.y : parentEntity.y;
    const scale = visualProps.scale;
    const effLx = (this.lx + visualProps.offX) * scale;
    const effLy = (this.ly + visualProps.offY) * scale;
    const ang = parentEntity.angle + visualProps.rotation;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    this.worldX = px + effLx * c - effLy * s;
    this.worldY = py + effLx * s + effLy * c;
    let vx = parentEntity.vel ? parentEntity.vel.x : (parentEntity.vx || 0);
    let vy = parentEntity.vel ? parentEntity.vel.y : (parentEntity.vy || 0);
    const angVel = parentEntity.angVel || 0;
    const rx = effLx * c - effLy * s;
    const ry = effLx * s + effLy * c;
    vx += -angVel * ry;
    vy +=  angVel * rx;
    this.dvx = vx + impulseX + (Math.random() - 0.5);
    this.dvy = vy + impulseY + (Math.random() - 0.5);
    this.drot = (Math.random() - 0.5) * 2.0;
    this.angle = ang;
    this.alpha = 2.0;
    this.debScale = scale;
    this.isDebris = true;
    this.active = true;
    DestructorSystem.debris.push(this);
  }

  updateDebris() {
    this.worldX += this.dvx;
    this.worldY += this.dvy;
    this.angle += this.drot * 0.05;
    this.dvx *= DESTRUCTOR_CONFIG.friction;
    this.dvy *= DESTRUCTOR_CONFIG.friction;
    this.alpha -= 0.01;
    if (this.alpha <= 0) this.active = false;
  }

  draw(ctx, camera, worldToScreenFunc) {
    if (!this.active || !this.isDebris) return; 
    const p = worldToScreenFunc(this.worldX, this.worldY, camera);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    ctx.scale(camera.zoom * this.debScale, camera.zoom * this.debScale);
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
  if (entity.fighter || (entity.type && (entity.type === 'fighter' || entity.type === 'interceptor' || entity.type === 'drone'))) return;
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
                  if (alpha > 40) { hit = true; break; }
              }
          }
          if (hit) {
              const lx = cx - centerX;
              const ly = cy - centerY;
              const shard = new HexShard(image, lx, ly, r, c, ro);
              shards.push(shard);
              map[`${c},${ro}`] = shard;
          }
      }
  }
  
  const finalOffsetX = -centerX;
  const finalOffsetY = -centerY;
  const coreRadSq = (Math.min(w, h) * 0.25) ** 2;
  for (const s of shards) {
      const distSq = s.lx*s.lx + s.ly*s.ly;
      let nFound = 0;
      const odd = (s.c % 2 !== 0);
      const neighborOffsets = odd 
          ? [[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]]
          : [[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]];
      for (const no of neighborOffsets) {
          if (map[`${s.c + no[0]},${s.r + no[1]}`]) nFound++;
      }
      if (distSq < coreRadSq) { s.hardness = 3.0; s.hp *= 3.0; } 
      else if (nFound < 6) { s.hardness = 2.0; s.hp *= 2.0; } 
      else { s.hardness = 1.0; }
  }

  entity.hexGrid = { shards, map, offsetX: finalOffsetX, offsetY: finalOffsetY };
  console.log(`Destructor: Initialized hex body for entity. Shards: ${shards.length}`);
}

export function drawHexGridLocal(ctx, hexGrid) {
    if (!hexGrid) return;
    for (const shard of hexGrid.shards) {
        if (shard.active && !shard.isDebris) {
            shard.drawLocal(ctx);
        }
    }
}

// === FIX 2: FUNKCJA DO RYSOWANIA GRACZA W ISTNIEJĄCYM KONTEKŚCIE ===
export function drawHexBodyLocal(ctx, entity) {
    if (!entity.hexGrid) return;
    
    const { scale, rotation, offX, offY } = getVisualProps(entity);

    ctx.save();
    // Zakładamy, że ctx jest już:
    // 1. Przesunięty do środka statku (Translate)
    // 2. Obrócony o kąt statku (Rotate)
    // 3. Przeskalowany o Zoom kamery (Scale)
    
    // Aplikujemy tylko różnice wizualne Sprite'a:
    ctx.rotate(rotation);       // np. 0
    ctx.scale(scale, scale);    // np. 2.2
    ctx.translate(offX, offY);  // np. 0,0

    // Rysujemy siatkę bezpośrednio w (0,0) lokalnego układu
    drawHexGridLocal(ctx, entity.hexGrid);
    
    ctx.restore();
}

// Stara funkcja do rysowania NPC (absolutna)
export function drawHexBody(ctx, entity, camera, worldToScreenFunc) {
    if (!entity.hexGrid) return;
    
    const posX = entity.pos ? entity.pos.x : entity.x;
    const posY = entity.pos ? entity.pos.y : entity.y;
    const s = worldToScreenFunc(posX, posY, camera);
    const { scale, rotation, offX, offY } = getVisualProps(entity);

    const size = (entity.radius || 100) * scale * camera.zoom;
    if (s.x + size < 0 || s.x - size > ctx.canvas.width ||
        s.y + size < 0 || s.y - size > ctx.canvas.height) return;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(entity.angle + rotation); // Suma kątów
    ctx.scale(camera.zoom * scale, camera.zoom * scale); // Suma skali
    ctx.translate(offX, offY);
    drawHexGridLocal(ctx, entity.hexGrid);
    ctx.restore();
}
