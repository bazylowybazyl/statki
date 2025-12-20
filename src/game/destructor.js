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

// Globalne kontenery dla systemu destrukcji
export const DestructorSystem = {
  debris: [], // Lista luźnych odłamków
  sparks: [], // Lista iskier
  
  // Metoda do aktualizacji fizyki i logiki
  update(dt, entities) {
    // 1. Aktualizacja odłamków (debris)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.updateDebris();
      if (!d.active) {
        // Swap & Pop dla wydajności
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

    // 3. Kolizje i mielenie (Grind)
    this.resolveHexGrinding(entities);
  },

  // --- NOWOŚĆ: Obsługa trafień z broni ---
  applyImpact(entity, worldX, worldY, damage, bulletVel) {
    if (!entity.hexGrid) return false; // Brak siatki - użyj standardowego HP

    // Dodatkowe zabezpieczenie: fightery ignorują system heksów (mają standardowe HP)
    if (entity.fighter || (entity.type && (entity.type === 'fighter' || entity.type === 'interceptor' || entity.type === 'drone'))) {
        return false;
    }

    const r = DESTRUCTOR_CONFIG.gridDivisions;
    const h = r * Math.sqrt(3);

    // 1. Transformacja pozycji trafienia do układu lokalnego statku
    const pos = entity.pos || {x: entity.x, y: entity.y};
    const ang = entity.angle || 0;
    
    // Wektor od środka statku do trafienia
    const dx = worldX - pos.x;
    const dy = worldY - pos.y;
    
    // Obrót o -angle (do lokalnego układu)
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;

    // 2. Znalezienie heksa w siatce
    const approxC = Math.round((lx - entity.hexGrid.offsetX) / (1.5 * r));
    const approxR = Math.round((ly - entity.hexGrid.offsetY) / h);

    // Sprawdzamy ten heks i bliskich sąsiadów (bo pocisk ma promień)
    let hitSomething = false;
    const searchRadius = 1;

    for (let dc = -searchRadius; dc <= searchRadius; dc++) {
      for (let dr = -searchRadius; dr <= searchRadius; dr++) {
         const key = (approxC + dc) + "," + (approxR + dr);
         const shard = entity.hexGrid.map[key];

         if (shard && shard.active && !shard.isDebris) {
             // Sprawdź dokładny dystans
             const distSq = (shard.lx - lx)**2 + (shard.ly - ly)**2;
             if (distSq < (r * 1.5)**2) {
                 hitSomething = true;
                 
                 // Aplikuj deformację
                 // Wektor uderzenia w lokalnym układzie
                 const lvx = bulletVel.x * c - bulletVel.y * s;
                 const lvy = bulletVel.x * s + bulletVel.y * c;
                 
                 // Wgniecenie w miejscu trafienia
                 shard.deform(lx - shard.lx, ly - shard.ly); 

                 // Structural warp (przemieszczenie całego heksa)
                 const warpFactor = 0.05 * (damage / 50); 
                 shard.warpStructure(lvx * warpFactor, lvy * warpFactor, r * 2.0);

                 // Obrażenia (uwzględniamy pancerz)
                 shard.hp -= damage / shard.hardness;

                 if (shard.hp <= 0) {
                     this.spawnSparks(worldX, worldY, 3);
                     // Odłamek dziedziczy prędkość pocisku (trochę)
                     shard.becomeDebris(bulletVel.x * 0.15, bulletVel.y * 0.15, entity);
                 }
             }
         }
      }
    }
    
    return hitSomething;
  },

  // Główna logika kolizji heksów
  resolveHexGrinding(entities) {
    const r = DESTRUCTOR_CONFIG.gridDivisions;
    const h = r * Math.sqrt(3);
    const checkDistSq = (r * 1.4) ** 2;

    // Filtrujemy tylko byty, które mają zainicjowaną siatkę heksów
    // I wykluczamy fightery (na wszelki wypadek, choć initHexBody ich nie tworzy)
    const activeBodies = entities.filter(e => 
        e && !e.dead && e.hexGrid && 
        !(e.fighter || e.type === 'fighter' || e.type === 'interceptor' || e.type === 'drone')
    );

    for (let i = 0; i < activeBodies.length; i++) {
      const A = activeBodies[i];
      
      for (let j = i + 1; j < activeBodies.length; j++) {
        const B = activeBodies[j];

        // Szybki test AABB (bounding box)
        const posA = A.pos || {x: A.x, y: A.y}; // Obsługa obu typów obiektów (shipEntity vs NPC)
        const posB = B.pos || {x: B.x, y: B.y};
        
        const distSq = (posA.x - posB.x)**2 + (posA.y - posB.y)**2;
        const radSum = (A.radius || 100) + (B.radius || 100);
        if (distSq > radSum * radSum) continue;

        // Ustalenie kto jest "Iteratorem" (ten z mniejszą liczbą heksów iteruje po drugim)
        let iterator = A, gridHolder = B;
        if (A.hexGrid.shards.length > B.hexGrid.shards.length) { 
            iterator = B; gridHolder = A; 
        }

        // Pobranie pozycji i prędkości
        const iPos = iterator.pos || {x: iterator.x, y: iterator.y};
        const gPos = gridHolder.pos || {x: gridHolder.x, y: gridHolder.y};
        const iVel = iterator.vel || {x: iterator.vx, y: iterator.vy};
        const gVel = gridHolder.vel || {x: gridHolder.vx, y: gridHolder.vy};

        // Parametry transformacji
        const gCos = Math.cos(-gridHolder.angle); 
        const gSin = Math.sin(-gridHolder.angle);
        const iCos = Math.cos(iterator.angle); 
        const iSin = Math.sin(iterator.angle);
        
        // Relatywna prędkość do skalowania obrażeń
        const relVx = (iVel.x || 0) - (gVel.x || 0);
        const relVy = (iVel.y || 0) - (gVel.y || 0);
        const impactSpeed = Math.hypot(relVx, relVy) * 0.5;

        // Skalowanie obrażeń (Kinetic Energy)
        const speedFactor = 1 + (impactSpeed * impactSpeed * 6.0);
        const massA = iterator.mass || 100;
        const massB = gridHolder.mass || 100;
        
        const baseDmgToGrid = (massA * 0.005) * speedFactor;
        const baseDmgToIter = (massB * 0.005) * speedFactor;
        
        const warpStrength = DESTRUCTOR_CONFIG.structureWarp * (impactSpeed * 0.5);

        // Pętla po heksach iteratora
        for (const sI of iterator.hexGrid.shards) {
          if (!sI.active || sI.isDebris) continue;

          // Pozycja sI w świecie
          const wx = iPos.x + sI.lx * iCos - sI.ly * iSin;
          const wy = iPos.y + sI.lx * iSin + sI.ly * iCos;

          // Transformacja do układu lokalnego gridHolder
          const rdx = wx - gPos.x;
          const rdy = wy - gPos.y;
          const glx = rdx * gCos - rdy * gSin;
          const gly = rdx * gSin + rdy * gCos;

          // Lookup w siatce (hashmapa)
          const approxC = Math.round((glx - gridHolder.hexGrid.offsetX) / (1.5 * r));
          const approxR = Math.round((gly - gridHolder.hexGrid.offsetY) / h);

          // Sprawdzenie sąsiadów
          for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
              const key = (approxC + dc) + "," + (approxR + dr);
              const sG = gridHolder.hexGrid.map[key];

              if (sG && sG.active && !sG.isDebris) {
                const dx = sG.lx - glx;
                const dy = sG.ly - gly;

                if (dx*dx + dy*dy < checkDistSq) {
                  // === KOLIZJA ===
                  
                  // Współczynniki twardości (Armor vs Hull)
                  const dmgFactorGrid = sI.hardness / sG.hardness;
                  const dmgFactorIter = sG.hardness / sI.hardness;

                  // 1. Deformacja i DMG dla GridHolder (B)
                  sG.deform(-dx, -dy);
                  const dist = Math.sqrt(dx*dx + dy*dy) || 1;
                  const ndx = dx/dist; const ndy = dy/dist;
                  const warpPush = warpStrength * (1.0 / sG.hardness);
                  sG.warpStructure(ndx * warpPush, ndy * warpPush, r * 1.5);
                  sG.hp -= baseDmgToGrid * dmgFactorGrid;

                  // 2. Deformacja i DMG dla Iterator (A)
                  const revICos = Math.cos(-iterator.angle); 
                  const revISin = Math.sin(-iterator.angle);
                  const wdx = dx * Math.cos(gridHolder.angle) - dy * Math.sin(gridHolder.angle);
                  const wdy = dx * Math.sin(gridHolder.angle) + dy * Math.cos(gridHolder.angle);
                  const idx = wdx * revICos - wdy * revISin;
                  const idy = wdx * revISin + wdy * revICos;

                  sI.deform(idx, idy);
                  const iDist = Math.sqrt(idx*idx + idy*idy) || 1;
                  sI.warpStructure((idx/iDist) * warpPush, (idy/iDist) * warpPush, r * 1.5);
                  sI.hp -= baseDmgToIter * dmgFactorIter;

                  // 3. Momentum Transfer (Popychanie statków)
                  const impulse = impactSpeed * 0.05;
                  const pushDirX = wdx / (Math.hypot(wdx, wdy) || 1);
                  const pushDirY = wdy / (Math.hypot(wdx, wdy) || 1);
                  
                  // Modyfikacja prędkości (obsługa struktur `vel` i `vx/vy`)
                  if (massA > 0) {
                      if (iterator.vel) {
                        iterator.vel.x -= pushDirX * impulse * (massB / (massA + massB));
                        iterator.vel.y -= pushDirY * impulse * (massB / (massA + massB));
                      } else {
                        iterator.vx -= pushDirX * impulse * (massB / (massA + massB));
                        iterator.vy -= pushDirY * impulse * (massB / (massA + massB));
                      }
                  }
                  if (massB > 0) {
                      if (gridHolder.vel) {
                        gridHolder.vel.x += pushDirX * impulse * (massA / (massA + massB));
                        gridHolder.vel.y += pushDirY * impulse * (massA / (massA + massB));
                      } else {
                        gridHolder.vx += pushDirX * impulse * (massA / (massA + massB));
                        gridHolder.vy += pushDirY * impulse * (massA / (massA + massB));
                      }
                  }

                  // 4. Zniszczenie i Debris
                  if (sG.hp <= 0) {
                    this.spawnSparks(wx, wy, 2);
                    const iVelX = iterator.vel ? iterator.vel.x : iterator.vx;
                    const iVelY = iterator.vel ? iterator.vel.y : iterator.vy;
                    sG.becomeDebris(iVelX * 0.2, iVelY * 0.2, gridHolder);
                  }
                  if (sI.hp <= 0) {
                    this.spawnSparks(wx, wy, 2);
                    const gVelX = gridHolder.vel ? gridHolder.vel.x : gridHolder.vx;
                    const gVelY = gridHolder.vel ? gridHolder.vel.y : gridHolder.vy;
                    sI.becomeDebris(gVelX * 0.2, gVelY * 0.2, iterator);
                  }
                  
                  // Hamowanie przy "szlifowaniu"
                  if (iterator.vel) { iterator.vel.x *= 0.95; iterator.vel.y *= 0.95; }
                  else { iterator.vx *= 0.95; iterator.vy *= 0.95; }
                  
                  if (gridHolder.vel) { gridHolder.vel.x *= 0.95; gridHolder.vel.y *= 0.95; }
                  else { gridHolder.vx *= 0.95; gridHolder.vy *= 0.95; }
                }
              }
            }
          }
        }
      }
    }
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

  // Rysowanie (wywoływane w głównej pętli render)
  draw(ctx, camera, worldToScreenFunc) {
    // 1. Rysuj Debris
    const viewLeft = camera.x - (ctx.canvas.width/2)/camera.zoom - 100;
    const viewRight = camera.x + (ctx.canvas.width/2)/camera.zoom + 100;
    const viewTop = camera.y - (ctx.canvas.height/2)/camera.zoom - 100;
    const viewBottom = camera.y + (ctx.canvas.height/2)/camera.zoom + 100;

    ctx.save();
    for (const d of this.debris) {
        // Culling
        if (d.worldX < viewLeft || d.worldX > viewRight || d.worldY < viewTop || d.worldY > viewBottom) continue;
        d.draw(ctx, camera, worldToScreenFunc);
    }
    ctx.restore();

    // 2. Rysuj Iskry
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

// Klasa pojedynczego heksa
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
    this.color = color; // Opcjonalnie kolor zamiast tekstury
    
    this.active = true;
    this.isDebris = false;
    this.hp = DESTRUCTOR_CONFIG.shardHP;
    this.hardness = 1.0;

    // Debris state
    this.worldX = 0; this.worldY = 0;
    this.dvx = 0; this.dvy = 0; this.drot = 0;
    this.alpha = 1;
    this.angle = 0;

    // Wierzchołki (lokalne względem środka heksa)
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

        // Clamp
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

  becomeDebris(impulseX, impulseY, parentEntity) {
    if (this.isDebris) return;
    
    // Oblicz pozycję w świecie w momencie oderwania
    // Obsługa obu struktur: entity.pos (gra) i entity.x (destructor prototype)
    const px = parentEntity.pos ? parentEntity.pos.x : parentEntity.x;
    const py = parentEntity.pos ? parentEntity.pos.y : parentEntity.y;
    
    const c = Math.cos(parentEntity.angle);
    const s = Math.sin(parentEntity.angle);
    this.worldX = px + this.lx * c - this.ly * s;
    this.worldY = py + this.lx * s + this.ly * c;

    // Dziedziczenie pędu (liniowy + obrotowy)
    let vx = parentEntity.vel ? parentEntity.vel.x : (parentEntity.vx || 0);
    let vy = parentEntity.vel ? parentEntity.vel.y : (parentEntity.vy || 0);
    const angVel = parentEntity.angVel || 0;
    
    // Wektor styczny od obrotu: v = omega * r
    const rx = this.lx * c - this.ly * s;
    const ry = this.lx * s + this.ly * c;
    vx += -angVel * ry;
    vy +=  angVel * rx;

    this.dvx = vx + impulseX + (Math.random() - 0.5);
    this.dvy = vy + impulseY + (Math.random() - 0.5);
    this.drot = (Math.random() - 0.5) * 0.3;
    this.angle = parentEntity.angle;
    this.alpha = 1.5; // Życie > 1 żeby powoli znikało

    this.isDebris = true;
    this.active = true;
    
    // Dodaj do systemu globalnego:
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
    if (!this.active) return;
    
    // Jeśli debris - używamy worldX/Y
    if (!this.isDebris) return; 

    const p = worldToScreenFunc(this.worldX, this.worldY, camera);
    
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    ctx.globalAlpha = Math.min(1, this.alpha);
    
    this.drawShape(ctx);
    
    ctx.restore();
  }

  drawShape(ctx) {
    ctx.beginPath();
    // Overlap dla usunięcia szwów
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
        // Tekstura jest mapowana względem lx,ly
        const texW = this.img.width;
        const texH = this.img.height;
        ctx.translate(-this.lx, -this.ly);
        ctx.drawImage(this.img, -texW/2, -texH/2);
        ctx.restore();
    }
  }
  
  // Wersja do rysowania "na statku" (lokalnie)
  drawLocal(ctx) {
     ctx.save();
     ctx.translate(this.lx, this.ly);
     this.drawShape(ctx);
     ctx.restore();
  }
}

// Inicjalizacja siatki heksów na obiekcie
export function initHexBody(entity, image) {
  // === FIX: IGNORUJ MYŚLIWCE ===
  if (entity.fighter || (entity.type && (entity.type === 'fighter' || entity.type === 'interceptor' || entity.type === 'drone'))) {
      return;
  }
  
  if (!image || !image.width) {
      console.warn("Destructor: Image not ready for", entity);
      return;
  }
  
  const w = image.width;
  const h = image.height;
  
  // Parametry siatki
  const r = DESTRUCTOR_CONFIG.gridDivisions; // Promień heksa
  const hexHeight = Math.sqrt(3) * r;
  
  // Tworzymy tymczasowy canvas do analizy pikseli
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  
  const shards = [];
  const map = {}; // Hashmapa "col,row" -> shard

  // Oblicz ile kolumn i wierszy potrzebujemy
  const cols = Math.ceil(w / (r * 1.5));
  const rows = Math.ceil(h / hexHeight);
  
  // Offsety do centrowania siatki względem środka statku (0,0)
  const centerX = w / 2;
  const centerY = h / 2;
  
  // Próbkowanie (Multi-sampling)
  for (let c = 0; c < cols; c++) {
      for (let ro = 0; ro < rows; ro++) {
          // Współrzędne środka heksa w obrazku (pixel coords)
          const cx = c * r * 1.5;
          let cy = ro * hexHeight;
          if (c % 2 !== 0) cy += hexHeight / 2;
          
          // Sprawdź czy heks trafia w nieprzezroczysty fragment
          let hit = false;
          // 5 punktów: środek + 4 rogi
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
              // Utwórz Shard
              // Pozycja lokalna względem środka statku
              const lx = cx - centerX;
              const ly = cy - centerY;
              
              const shard = new HexShard(image, lx, ly, r, c, ro);
              shards.push(shard);
              map[`${c},${ro}`] = shard;
          }
      }
  }
  
  // --- ZMIANA: USUNIĘTO WADLIWE AUTOCENTROWANIE ---
  // Teraz ufamy, że środek obrazka (w/2, h/2) to środek statku.
  // Wcześniej kod próbował przesuwać shardy względem "masy pikseli",
  // co powodowało offset sprite'a w prawo.
  
  const finalOffsetX = -centerX;
  const finalOffsetY = -centerY;
  
  // Analiza komponentów (Armor vs Core)
  const coreRadSq = (Math.min(w, h) * 0.25) ** 2;
  
  for (const s of shards) {
      const distSq = s.lx*s.lx + s.ly*s.ly;
      const odd = (s.c % 2 !== 0);
      const neighborOffsets = odd 
          ? [[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]]
          : [[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]];
      
      let nFound = 0;
      for (const no of neighborOffsets) {
          if (map[`${s.c + no[0]},${s.r + no[1]}`]) nFound++;
      }
      
      if (distSq < coreRadSq) {
          s.hardness = 3.0; // Core
          s.hp *= 3.0;
      } else if (nFound < 6) {
          s.hardness = 2.0; // Armor (krawędź)
          s.hp *= 2.0;
      } else {
          s.hardness = 1.0; // Hull
      }
  }

  // Zapisz dane w encji
  entity.hexGrid = {
      shards,
      map,
      offsetX: finalOffsetX,
      offsetY: finalOffsetY
  };
  
  // Ustaw promień kolizji encji na podstawie obrazka (jeśli nie ma)
  if (!entity.radius) {
      entity.radius = Math.max(w, h) / 2;
  }
  
  console.log(`Destructor: Initialized hex body for entity. Shards: ${shards.length}`);
}

// Rysowanie statku jako chmury heksów (zastępuje zwykłe drawImage)
export function drawHexBody(ctx, entity, camera, worldToScreenFunc) {
    if (!entity.hexGrid) return;
    
    // Oblicz transformację do ekranu raz dla całego statku
    const posX = entity.pos ? entity.pos.x : entity.x;
    const posY = entity.pos ? entity.pos.y : entity.y;
    const s = worldToScreenFunc(posX, posY, camera);
    
    // Culling (Wycinka poza ekranem)
    const size = entity.radius * camera.zoom;
    if (s.x + size < 0 || s.x - size > ctx.canvas.width ||
        s.y + size < 0 || s.y - size > ctx.canvas.height) return;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(entity.angle);
    ctx.scale(camera.zoom, camera.zoom); // Skalujemy tutaj
    
    // Rysujemy heksy
    for (const shard of entity.hexGrid.shards) {
        if (shard.active && !shard.isDebris) {
            // Można dodać lokalny culling tutaj jeśli wydajność spadnie
            shard.drawLocal(ctx);
        }
    }
    
    ctx.restore();
}