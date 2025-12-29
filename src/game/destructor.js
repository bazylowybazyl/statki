/**
 * Moduł Destrukcji "Hex Grinder" - Wersja INTEGRATED HP
 * Teraz heksy są bezpośrednio połączone z paskiem życia statku.
 */

export const DESTRUCTOR_CONFIG = {
    gridDivisions: 20,
    shardHP: 40,
    deformStrength: 20.0,
    deformRadius: 8.0,
    maxDeform: 0.98,
    structureWarp: 2.0,
    friction: 0.90
};

// Funkcja pomocnicza do pobierania skali
function getFinalScale(entity) {
    if (entity.visual && typeof entity.visual.spriteScale === 'number') {
        return entity.visual.spriteScale;
    }
    return 1.0;
}

function updateHexCache(entity) {
    if (!entity.hexGrid || !entity.hexGrid.cacheCtx) return;
    const ctx = entity.hexGrid.cacheCtx;
    const grid = entity.hexGrid;

    ctx.clearRect(0, 0, grid.srcWidth, grid.srcHeight);

    ctx.save();
    const centerX = grid.srcWidth / 2;
    const centerY = grid.srcHeight / 2;
    ctx.translate(centerX, centerY);

    for (const shard of grid.shards) {
        if (shard.active && !shard.isDebris) {
            ctx.save();
            ctx.translate(shard.lx, shard.ly);
            shard.drawShape(ctx);
            ctx.restore();
        }
    }
    ctx.restore();

    grid.cacheDirty = false;
}

export const DestructorSystem = {
    debris: [],
    sparks: [],
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

        // 3. Kolizje fizyczne heksów
        this.resolveHexGrinding(entities);

        // 4. Podział statków (Split Check)
        this.processSplits();
    },

    applyImpact(entity, worldX, worldY, damage, bulletVel) {
        if (!entity.hexGrid) return false;
        if (entity.fighter || (entity.type && ['fighter', 'interceptor', 'drone'].includes(entity.type))) {
            return false;
        }

        const r = DESTRUCTOR_CONFIG.gridDivisions;
        const h = r * Math.sqrt(3);
        const scale = getFinalScale(entity);

        const pos = entity.pos || { x: entity.x, y: entity.y };
        const ang = entity.angle || 0;

        const dx = worldX - pos.x;
        const dy = worldY - pos.y;

        const c = Math.cos(-ang);
        const s = Math.sin(-ang);

        const lx = (dx * c - dy * s) / scale;
        const ly = (dx * s + dy * c) / scale;

        // Larger search radius for wrecks since their hexes may be scattered
        const searchRadius = entity.isWreck ? 3 : (scale < 0.5 ? 2 : 1);

        const approxC = Math.round((lx - entity.hexGrid.offsetX) / (1.5 * r));
        const approxR = Math.round((ly - entity.hexGrid.offsetY) / h);

        let hitSomething = false;

        for (let dc = -searchRadius; dc <= searchRadius; dc++) {
            for (let dr = -searchRadius; dr <= searchRadius; dr++) {
                const key = (approxC + dc) + "," + (approxR + dr);
                const shard = entity.hexGrid.map[key];

                if (shard && shard.active && !shard.isDebris) {
                    const distSq = (shard.lx - lx) ** 2 + (shard.ly - ly) ** 2;

                    if (distSq < (r * 2.5) ** 2) {
                        hitSomething = true;

                        // Oblicz obrażenia dla heksa
                        const rawDmg = damage / shard.hardness;

                        // --- LOGIKA HP 1: Odejmij od HP statku ---
                        if (entity.hexGrid.hpRatio) {
                            // Odejmujemy proporcjonalnie do uszkodzenia heksa
                            entity.hp -= rawDmg * entity.hexGrid.hpRatio;
                        }

                        shard.deform(lx - shard.lx, ly - shard.ly);
                        shard.hp -= rawDmg;
                        entity.hexGrid.cacheDirty = true;

                        if (shard.hp <= 0) {
                            this.spawnSparks(worldX, worldY, 3);
                            shard.becomeDebris(bulletVel.x * 0.02, bulletVel.y * 0.02, entity, scale);
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

        const activeBodies = entities.filter(e => e && !e.dead && e.hexGrid && e.isCollidable !== false);

        if (window.SpatialGrid && activeBodies.length > 20) {
            const checkedPairs = new Set();
            const ids = new WeakMap();
            let nextId = 1;
            const getId = (obj) => {
                let id = ids.get(obj);
                if (!id) { id = nextId++; ids.set(obj, id); }
                return id;
            };

            for (const A of activeBodies) {
                if (A.fighter) continue;
                const ax = A.pos ? A.pos.x : A.x;
                const ay = A.pos ? A.pos.y : A.y;
                const nearby = window.SpatialGrid.getPotentialTargets(ax, ay);

                for (const B of nearby) {
                    if (A === B || !B || !B.hexGrid || B.dead || B.fighter) continue;
                    const idA = getId(A);
                    const idB = getId(B);
                    const pairKey = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
                    if (checkedPairs.has(pairKey)) continue;
                    checkedPairs.add(pairKey);
                    this._checkPair(A, B, r, h, checkDistSq);
                }
            }
        } else {
            for (let i = 0; i < activeBodies.length; i++) {
                const A = activeBodies[i];
                if (A.fighter) continue;
                for (let j = i + 1; j < activeBodies.length; j++) {
                    const B = activeBodies[j];
                    if (B.fighter) continue;
                    this._checkPair(A, B, r, h, checkDistSq);
                }
            }
        }
    },

    _checkPair(A, B, r, h, checkDistSq) {
        const scaleA = getFinalScale(A);
        const scaleB = getFinalScale(B);
        const radA = (A.hexGrid.rawRadius || A.radius) * scaleA;
        const radB = (B.hexGrid.rawRadius || B.radius) * scaleB;

        const posA = A.pos || { x: A.x, y: A.y };
        const posB = B.pos || { x: B.x, y: B.y };
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const distSq = dx * dx + dy * dy;
        const minDist = radA + radB;

        if (distSq > minDist * minDist) return;

        const impactSpeed = Math.hypot((A.vx || 0) - (B.vx || 0), (A.vy || 0) - (B.vy || 0));
        if (impactSpeed < 15) {
            this.applyRepulsion(A, B, posA, posB, 0.5);
            return;
        }

        this._processHexCollisionPair(A, B, scaleA, scaleB, impactSpeed, 1.0, r, h, checkDistSq);
    },

    applyRepulsion(A, B, posA, posB, forceMul) {
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;

        const push = 200 * forceMul;

        const massA = A.mass || 100;
        const massB = B.mass || 100;

        if (!A.static) { A.vx += nx * (push / massA); A.vy += ny * (push / massA); }
        if (!B.static) { B.vx -= nx * (push / massB); B.vy -= ny * (push / massB); }
    },

    _processHexCollisionPair(A, B, scaleA, scaleB, impactSpeed, dmgMult, r, h, checkDistSq) {
        let iterator = A, gridHolder = B;
        let iterScale = scaleA, gridScale = scaleB;
        if (A.hexGrid.shards.length > B.hexGrid.shards.length) {
            iterator = B; gridHolder = A;
            iterScale = scaleB; gridScale = scaleA;
        }

        const iPos = iterator.pos || { x: iterator.x, y: iterator.y };
        const gPos = gridHolder.pos || { x: gridHolder.x, y: gridHolder.y };
        const gCos = Math.cos(-gridHolder.angle), gSin = Math.sin(-gridHolder.angle);
        const iCos = Math.cos(iterator.angle), iSin = Math.sin(iterator.angle);

        const massIter = iterator.rammingMass || iterator.mass || 100;
        const massHolder = gridHolder.rammingMass || gridHolder.mass || 100;

        this.applyRepulsion(iterator, gridHolder, iPos, gPos, 2.0);

        for (const sI of iterator.hexGrid.shards) {
            if (!sI.active || sI.isDebris) continue;

            const wx = iPos.x + (sI.lx * iterScale) * iCos - (sI.ly * iterScale) * iSin;
            const wy = iPos.y + (sI.lx * iterScale) * iSin + (sI.ly * iterScale) * iCos;

            const rdx = wx - gPos.x;
            const rdy = wy - gPos.y;
            const glx = (rdx * gCos - rdy * gSin) / gridScale;
            const gly = (rdx * gSin + rdy * gCos) / gridScale;

            const approxC = Math.round((glx - gridHolder.hexGrid.offsetX) / (1.5 * r));
            const approxR = Math.round((gly - gridHolder.hexGrid.offsetY) / h);

            for (let dc = -1; dc <= 1; dc++) {
                for (let dr = -1; dr <= 1; dr++) {
                    const key = (approxC + dc) + "," + (approxR + dr);
                    const sG = gridHolder.hexGrid.map[key];
                    if (sG && sG.active && !sG.isDebris) {
                        const dx = sG.lx - glx;
                        const dy = sG.ly - gly;
                        if (dx * dx + dy * dy < checkDistSq) {
                            const baseDamage = 35;
                            const speedFactor = Math.max(1, impactSpeed * 0.15);

                            const dmgToHolder = (baseDamage + (massIter / 1000) * speedFactor) * dmgMult;
                            const dmgToIter = (baseDamage + (massHolder / 1000) * speedFactor) * dmgMult;

                            if (dmgToHolder > 1) {
                                sG.hp -= dmgToHolder;
                                // --- LOGIKA HP 2: Kolizje odbierają HP statku ---
                                if (gridHolder.hexGrid.hpRatio) {
                                    gridHolder.hp -= dmgToHolder * gridHolder.hexGrid.hpRatio;
                                }

                                sG.deform(-dx, -dy);
                                gridHolder.hexGrid.cacheDirty = true;
                                if (sG.hp <= 0) {
                                    this.spawnSparks(wx, wy, 2);
                                    sG.becomeDebris(iterator.vx * 0.2, iterator.vy * 0.2, gridHolder, gridScale);
                                    this.splitQueue.add(gridHolder);
                                }
                            }

                            if (dmgToIter > 1) {
                                sI.hp -= dmgToIter;
                                // --- LOGIKA HP 2 (cd) ---
                                if (iterator.hexGrid.hpRatio) {
                                    iterator.hp -= dmgToIter * iterator.hexGrid.hpRatio;
                                }

                                iterator.hexGrid.cacheDirty = true;
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
    },

    processSplits() {
        if (this.splitQueue.size === 0) return;

        for (const entity of this.splitQueue) {
            if (!entity.hexGrid || entity.dead) continue;

            const groups = findConnectedComponents(entity.hexGrid);
            if (groups.length <= 1) continue;

            let survivorGroup = null;
            const debrisGroups = [];

            for (const group of groups) {
                const hasCore = group.some(shard => shard.isCore);
                if (hasCore) {
                    if (!survivorGroup || group.length > survivorGroup.length) {
                        if (survivorGroup) debrisGroups.push(survivorGroup);
                        survivorGroup = group;
                    } else {
                        debrisGroups.push(group);
                    }
                } else {
                    debrisGroups.push(group);
                }
            }

            if (!survivorGroup) {
                entity.dead = true;
                debrisGroups.push(...groups);
            } else {
                // --- LOGIKA HP 3: Utrata masy (Split) ---
                // Obliczamy ile "wartości HP" traci statek przez odcięcie tych fragmentów
                let totalLostHpValue = 0;
                const ratio = entity.hexGrid.hpRatio || 0;

                for (const group of debrisGroups) {
                    for (const shard of group) {
                        // Jeśli heks jeszcze ma HP (a zwykle ma, bo odpadł jako cały kawałek),
                        // to statek traci to HP.
                        if (shard.hp > 0) {
                            totalLostHpValue += shard.hp * ratio;
                            // Zerujemy HP sharda, żeby wrak nie był "żywy" logicznie (opcjonalne)
                            // shard.hp = 0; // Zostawmy to, żeby wrak miał HP
                        }
                    }
                }

                // Odejmij HP od statku
                if (totalLostHpValue > 0) {
                    entity.hp -= totalLostHpValue;
                    // Jeśli utrata masy zabiła statek
                    if (entity.hp <= 0) entity.dead = true;
                }

                if (!entity.dead) {
                    updateBodyWithShards(entity, survivorGroup);
                }
            }

            for (const group of debrisGroups) {
                // Nie twórz wraków z wraków - zapobiega powielaniu
                if (entity.isWreck) continue;

                if (window.createWreckage) {
                    window.createWreckage(entity, group);
                }
            }
        }
        this.splitQueue.clear();
    },

    spawnSparks(x, y, count = 1) {
        for (let i = 0; i < count; i++) {
            this.sparks.push({
                x, y,
                vx: (Math.random() - 0.5) * 500,
                vy: (Math.random() - 0.5) * 500,
                life: 1.0,
                color: '#fbbf24'
            });
        }
    },

    draw(ctx, camera, worldToScreenFunc) {
        const viewLeft = camera.x - (ctx.canvas.width / 2) / camera.zoom - 200;
        const viewRight = camera.x + (ctx.canvas.width / 2) / camera.zoom + 200;
        const viewTop = camera.y - (ctx.canvas.height / 2) / camera.zoom - 200;
        const viewBottom = camera.y + (ctx.canvas.height / 2) / camera.zoom + 200;

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

function findConnectedComponents(hexGrid) {
    const shards = hexGrid.shards.filter(s => s.active && !s.isDebris);
    if (shards.length === 0) return [];

    const visited = new Set();
    const groups = [];
    const activeMap = {};
    for (const s of shards) {
        activeMap[s.c + "," + s.r] = s;
    }

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
                ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
                : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];

            for (const offset of neighborOffsets) {
                const nc = current.c + offset[0];
                const nr = current.r + offset[1];
                const nKey = nc + "," + nr;
                const neighbor = activeMap[nKey];
                if (neighbor && !visited.has(nKey)) {
                    visited.add(nKey);
                    stack.push(neighbor);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function updateBodyWithShards(entity, shardsToKeep) {
    let sumLx = 0, sumLy = 0;
    for (const s of shardsToKeep) {
        sumLx += s.lx;
        sumLy += s.ly;
    }
    const avgLx = entity.isWreck ? 0 : sumLx / shardsToKeep.length;
    const avgLy = entity.isWreck ? 0 : sumLy / shardsToKeep.length;

    const scale = getFinalScale(entity);
    const c = Math.cos(entity.angle);
    const s = Math.sin(entity.angle);

    const shiftX = (avgLx * scale) * c - (avgLy * scale) * s;
    const shiftY = (avgLx * scale) * s + (avgLy * scale) * c;

    if (entity.pos) {
        entity.pos.x += shiftX;
        entity.pos.y += shiftY;
        entity.x = entity.pos.x;
        entity.y = entity.pos.y;
    } else {
        entity.x += shiftX;
        entity.y += shiftY;
    }

    const newMap = {};
    const newShards = [];
    let minLx = Infinity, maxLx = -Infinity;
    let maxR2 = 0;

    let sumC = 0, sumR = 0;
    for (const s of shardsToKeep) { sumC += s.c; sumR += s.r; }
    const avgC = entity.isWreck ? 0 : Math.round(sumC / shardsToKeep.length);
    const avgR = entity.isWreck ? 0 : Math.round(sumR / shardsToKeep.length);

    for (const shard of shardsToKeep) {
        shard.lx -= avgLx;
        shard.ly -= avgLy;
        shard.origLx -= avgLx;
        shard.origLy -= avgLy;

        shard.c -= avgC;
        shard.r -= avgR;

        newShards.push(shard);
        newMap[shard.c + "," + shard.r] = shard;

        if (shard.lx < minLx) minLx = shard.lx;
        if (shard.lx > maxLx) maxLx = shard.lx;

        const d2 = shard.lx * shard.lx + shard.ly * shard.ly;
        if (d2 > maxR2) maxR2 = d2;
    }

    entity.hexGrid.shards = newShards;
    entity.hexGrid.map = newMap;
    entity.hexGrid.contentWidth = Math.max(1, maxLx - minLx);
    entity.hexGrid.offsetX = 0;
    entity.hexGrid.offsetY = 0;
    const r = DESTRUCTOR_CONFIG.gridDivisions;
    entity.hexGrid.rawRadius = Math.sqrt(maxR2) + r;
    entity.hexGrid.cacheDirty = true;

    entity.radius = entity.hexGrid.rawRadius * scale;
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
        const distSq = dx * dx + dy * dy;
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
        vy += angVel * rx;

        this.dvx = vx + impulseX + (Math.random() - 0.5) * 1.0;
        this.dvy = vy + impulseY + (Math.random() - 0.5) * 1.0;
        this.drot = (Math.random() - 0.5) * 0.2;

        this.angle = parentEntity.angle;
        this.alpha = 1.5;

        const key = this.c + "," + this.r;
        if (parentEntity.hexGrid && parentEntity.hexGrid.map[key] === this) {
            delete parentEntity.hexGrid.map[key];
        }

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

        if (this.isDebris) {
            ctx.fillStyle = this.color || '#555';
            ctx.fill();
            return;
        }

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
            ctx.drawImage(this.img, -texW / 2, -texH / 2);
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
    if (entity.fighter || (entity.type && ['fighter', 'interceptor', 'drone'].includes(entity.type))) {
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
            const offsets = [{ x: 0, y: 0 }, { x: r * 0.5, y: 0 }, { x: -r * 0.5, y: 0 }, { x: 0, y: r * 0.5 }, { x: 0, y: -r * 0.5 }];
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

    // --- KALIBRACJA HP ---
    let totalStructuralHp = 0;

    for (const s of shards) {
        const dc = Math.abs(s.c - centerC);
        const dr = Math.abs(s.r - centerR);
        if (dc <= halfW && dr <= halfH) {
            s.isCore = true;
            s.hardness = 5.0;
            s.hp *= 5.0;
            s.color = null;
        } else {
            s.isCore = false;
        }
        totalStructuralHp += s.hp;
    }

    // Obliczamy współczynnik: ile HP statku odpowiada 1 HP heksa
    const entityMaxHp = entity.maxHp || 1000;
    const hpRatio = totalStructuralHp > 0 ? (entityMaxHp / totalStructuralHp) : 1.0;

    let shiftX = 0;
    let shiftY = 0;
    let finalOffsetX = -centerX;
    let finalOffsetY = -centerY;
    let contentWidth = w;

    if (shards.length > 0) {
        shiftX = -(minContentX + maxContentX) / 2;

        for (const s of shards) {
            s.lx += shiftX;
            s.ly += shiftY;
            s.origLx += shiftX;
            s.origLy += shiftY;

            const d2 = s.lx * s.lx + s.ly * s.ly;
            if (d2 > rawRadiusSq) rawRadiusSq = d2;
        }

        finalOffsetX = -centerX + shiftX;
        finalOffsetY = -centerY + shiftY;
        contentWidth = maxContentX - minContentX;
    }

    const cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = w;
    cacheCanvas.height = h;

    entity.hexGrid = {
        shards,
        map,
        offsetX: finalOffsetX,
        offsetY: finalOffsetY,
        srcWidth: w,
        srcHeight: h,
        contentWidth: contentWidth,
        rawRadius: Math.sqrt(rawRadiusSq) + r,
        cacheCanvas: cacheCanvas,
        cacheCtx: cacheCanvas.getContext('2d', { willReadFrequently: true }),
        cacheDirty: true,
        hpRatio: hpRatio // ZAPAMIĘTUJEMY WSPÓŁCZYNNIK
    };

    const scale = getFinalScale(entity);
    entity.radius = entity.hexGrid.rawRadius * scale;
}

export function drawHexBody(ctx, entity, camera, worldToScreenFunc) {
    if (!entity.hexGrid || !entity.hexGrid.cacheCanvas) return;

    const posX = entity.pos ? entity.pos.x : entity.x;
    const posY = entity.pos ? entity.pos.y : entity.y;
    const s = worldToScreenFunc(posX, posY, camera);

    const finalScale = getFinalScale(entity);
    const size = entity.radius * camera.zoom;
    if (s.x + size < 0 || s.x - size > ctx.canvas.width ||
        s.y + size < 0 || s.y - size > ctx.canvas.height) return;

    if (entity.hexGrid.cacheDirty) {
        updateHexCache(entity);
    }

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(entity.angle);
    ctx.scale(camera.zoom * finalScale, camera.zoom * finalScale);

    const cw = entity.hexGrid.srcWidth;
    const ch = entity.hexGrid.srcHeight;
    ctx.drawImage(entity.hexGrid.cacheCanvas, -cw / 2, -ch / 2);
    ctx.restore();
}

export function drawHexBodyLocal(ctx, entity) {
    if (!entity.hexGrid || !entity.hexGrid.cacheCanvas) return;
    const finalScale = getFinalScale(entity);
    if (entity.hexGrid.cacheDirty) {
        updateHexCache(entity);
    }

    const cw = entity.hexGrid.srcWidth;
    const ch = entity.hexGrid.srcHeight;
    ctx.save();
    ctx.scale(finalScale, finalScale);
    ctx.drawImage(entity.hexGrid.cacheCanvas, -cw / 2, -ch / 2);
    ctx.restore();
}