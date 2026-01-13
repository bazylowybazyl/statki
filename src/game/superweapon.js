/**
 * Moduł Superbroni (Hexlance)
 * Zawiera logikę broni, pocisków oraz dedykowany system cząsteczek (Iskry).
 * Integruje się z globalnym DestructorSystem.
 */

// Konfiguracja wizualna
const VFX_CONFIG = {
    // --- NOWE ISKRY (Główny efekt - prostokątne odłamki) ---
    newCount: 40,
    newSpeedMin: 1000,
    newSpeedMax: 2500,
    newSpread: 1.4,
    newDecay: 0.04,
    newDrag: 0.92,
    newSizeMin: 1.5, // PRZYWRÓCONE: 1.5
    newSizeMax: 7.0, // PRZYWRÓCONE: 7.0

    // --- STARE ISKRY (Tło - zakrzywione linie) ---
    oldCount: 10,
    oldSpeed: 1000,
    oldSpread: 1.4,
    oldDrag: 0.90,
    oldCurve: 6.0,
    oldLife: 0.2,
    oldSizeMin: 0.5, // Pozostawione zgodnie z życzeniem
    oldSizeMax: 1.2
};

// Stan wewnętrzny modułu
const localParticles = []; 
const hexlanceProjectiles = [];
let globalTime = 0;

// Assety
const sprite = new Image();
let spriteReady = false;
sprite.onload = () => { spriteReady = true; };
sprite.src = "assets/weapons/supercapitalmain.png"; 

// Stan broni
export const superweaponState = {
    cooldown: 0,
    cooldownMax: 4.0, 
    chargeTime: 0.6,
    charging: false,
    chargeProgress: 0,
    
    // Parametry fizyczne
    projectileSpeed: 8000,
    beamWidth: 8,
    range: 12000,
    damage: 9999, 
    
    // Sekwencja strzałów
    queue: [],
    shotDelay: 0.25,
    
    // Konfiguracja montażu
    barrelLength: 160,
    barrelSpacing: 35,
    
    // Wizualny odrzut
    recoilOffset: 0,
    recoilRecovery: 100
};

// --- KLASA SPARK ---
class Spark {
    constructor(x, y, vx, vy) {
        this.x = x; 
        this.y = y;
        const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * VFX_CONFIG.newSpread; 
        const speed = VFX_CONFIG.newSpeedMin + Math.random() * (VFX_CONFIG.newSpeedMax - VFX_CONFIG.newSpeedMin);
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0; 
        this.decay = Math.random() * VFX_CONFIG.newDecay + 0.02; 
        const colors = ['#ffffff', '#fffbd0', '#ffcc66'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
        this.size = VFX_CONFIG.newSizeMin + Math.random() * (VFX_CONFIG.newSizeMax - VFX_CONFIG.newSizeMin);
    }
    update() { 
        this.x += this.vx; 
        this.y += this.vy; 
        this.vx *= VFX_CONFIG.newDrag; 
        this.vy *= VFX_CONFIG.newDrag; 
        this.life -= this.decay; 
    }
    draw(ctx, camera, worldToScreen) { 
        const s = worldToScreen(this.x, this.y, camera);
        const speed = Math.hypot(this.vx, this.vy);
        const rot = Math.atan2(this.vy, this.vx);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(rot);
        ctx.globalAlpha = Math.max(0, this.life); 
        const length = Math.min(speed * 1.5, 60) * camera.zoom; 
        const thickness = this.size * camera.zoom;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 160, 60, 0.8)';
        ctx.fillStyle = this.color; 
        ctx.fillRect(-length * 0.2, -thickness/2, length, thickness); 
        ctx.restore();
    }
}

// --- HELPERS ---
function rotate(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// FIX: Dodano aimPos (punkt celowania)
function getMuzzlePos(ship, cannonIndex, barrelIndex, aimPos) {
    const tuneX = 275;
    const tuneY = 315;
    const offsets = [ { x: -tuneX, y: tuneY }, { x: tuneX, y: tuneY } ];
    const off = offsets[cannonIndex];
    
    // Punkt montażu obraca się razem ze statkiem
    const pivotOffset = rotate(off, ship.angle);
    const pivotPos = { x: ship.pos.x + pivotOffset.x, y: ship.pos.y + pivotOffset.y };
    
    // FIX: Kierunek strzału wyznaczany z pozycji pivota do kursora (aimPos)
    let dir;
    if (aimPos) {
        const dx = aimPos.x - pivotPos.x;
        const dy = aimPos.y - pivotPos.y;
        const dist = Math.hypot(dx, dy) || 1;
        dir = { x: dx / dist, y: dy / dist };
    } else {
        // Fallback: strzał zgodnie z kadłubem
        dir = { x: Math.cos(ship.angle), y: Math.sin(ship.angle) };
    }

    const perp = { x: -dir.y, y: dir.x };
    
    const recoilShift = -superweaponState.recoilOffset;
    const currentLength = superweaponState.barrelLength + recoilShift;
    const currentSpacing = superweaponState.barrelSpacing;
    const sideOffset = (barrelIndex === 0 ? -0.5 : 0.5) * currentSpacing;

    return {
        x: pivotPos.x + (dir.x * currentLength) + (perp.x * sideOffset),
        y: pivotPos.y + (dir.y * currentLength) + (perp.y * sideOffset),
        dir: dir
    };
}

function spawnNewSparks(x, y, ivx, ivy) {
    const count = VFX_CONFIG.newCount;
    for(let i=0; i<count; i++) localParticles.push(new Spark(x, y, ivx, ivy));
}

function spawnChargeEffect(targetPos) {
    if (window.spawnParticle) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 50; 
        const startX = targetPos.x + Math.cos(angle) * dist;
        const startY = targetPos.y + Math.sin(angle) * dist;
        const life = 0.2 + Math.random() * 0.15;
        const speed = dist / life; 
        const vx = -Math.cos(angle) * speed;
        const vy = -Math.sin(angle) * speed;
        window.spawnParticle({ x: startX, y: startY }, { x: vx, y: vy }, life, '#cceeff', 1.5 + Math.random() * 1.5, false);
    }
}

// FIX: Dodano aimPos
function fireSingleBarrel(ship, cannonIndex, barrelIndex, aimPos) {
    const m = getMuzzlePos(ship, cannonIndex, barrelIndex, aimPos);
    const angle = Math.atan2(m.dir.y, m.dir.x);
    superweaponState.recoilOffset = Math.min(25, superweaponState.recoilOffset + 12);
    
    if (window.camera && window.camera.addShake) window.camera.addShake(8, 0.25);

    hexlanceProjectiles.push({
        x: m.x, y: m.y,
        vx: m.dir.x * superweaponState.projectileSpeed + ship.vel.x,
        vy: m.dir.y * superweaponState.projectileSpeed + ship.vel.y,
        life: 2.0, traveled: 0,
        beamWidth: superweaponState.beamWidth,
        angle: angle
    });

    if (window.spawnParticle) {
        window.spawnParticle({ x: m.x, y: m.y }, { x: m.dir.x * 50, y: m.dir.y * 50 }, 0.08, '#ffffff', 60, true);
    }
    if (window.spawnShockwave) {
        window.spawnShockwave(m.x, m.y, { maxR: 80, maxLife: 0.12, w: 4, color: 'rgba(133, 193, 255,' });
    }

    spawnNewSparks(m.x, m.y, m.dir.x, m.dir.y);

    if (window.spawnParticle) {
        const count = VFX_CONFIG.oldCount;
        for (let i = 0; i < count; i++) {
            const spread = (Math.random() - 0.5) * VFX_CONFIG.oldSpread;
            const sparkAngle = angle + spread;
            const speed = VFX_CONFIG.oldSpeed + (Math.random() * 500 - 250);
            const vx = Math.cos(sparkAngle) * speed + ship.vel.x;
            const vy = Math.sin(sparkAngle) * speed + ship.vel.y;
            const colors = ['#ffffff', '#e0f7fa', '#85c1ff'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = VFX_CONFIG.oldSizeMin + Math.random() * (VFX_CONFIG.oldSizeMax - VFX_CONFIG.oldSizeMin);
            window.spawnParticle({ x: m.x, y: m.y }, { x: vx, y: vy }, 0.2 + Math.random() * 0.1, color, size, false);
        }
    }
}

function prepareSuperweaponSalvo() {
    superweaponState.queue = [];
    const delay = superweaponState.shotDelay;
    superweaponState.queue.push({ cannonIndex: 1, barrelIndex: 0, delay: 0 }); 
    superweaponState.queue.push({ cannonIndex: 0, barrelIndex: 0, delay: delay });
    superweaponState.queue.push({ cannonIndex: 1, barrelIndex: 1, delay: delay });
    superweaponState.queue.push({ cannonIndex: 0, barrelIndex: 1, delay: delay });
    superweaponState.cooldown = superweaponState.cooldownMax;
}

// --- PUBLIC API ---

export function tryFireSuperweapon() {
    if (superweaponState.cooldown > 0) return false;
    if (superweaponState.charging) return false;
    if (superweaponState.queue.length > 0) return false;
    superweaponState.charging = true;
    superweaponState.chargeProgress = 0;
    return true;
}

// FIX: Dodano aimPos w argumencie
export function updateSuperweapon(dt, ship, aimPos) {
    globalTime += dt;
    if (superweaponState.recoilOffset > 0) {
        superweaponState.recoilOffset = Math.max(0, superweaponState.recoilOffset - superweaponState.recoilRecovery * dt);
    }
    if (superweaponState.cooldown > 0 && !superweaponState.charging && superweaponState.queue.length === 0) {
        superweaponState.cooldown = Math.max(0, superweaponState.cooldown - dt);
    }
    if (superweaponState.charging) {
        superweaponState.chargeProgress += dt;
        // Używamy aimPos do efektu ładowania
        const m = getMuzzlePos(ship, 1, 0, aimPos);
        for(let k=0; k<3; k++) spawnChargeEffect(m);
        if (superweaponState.chargeProgress >= superweaponState.chargeTime) {
            superweaponState.charging = false;
            superweaponState.chargeProgress = 0;
            prepareSuperweaponSalvo();
        }
    }
    if (superweaponState.queue.length > 0) {
        const nextShot = superweaponState.queue[0];
        if (nextShot.delay > 0 && nextShot.delay <= 0.22) {
             const m = getMuzzlePos(ship, nextShot.cannonIndex, nextShot.barrelIndex, aimPos);
             for(let k=0; k<3; k++) spawnChargeEffect(m);
        }
        nextShot.delay -= dt;
        while (superweaponState.queue.length > 0 && superweaponState.queue[0].delay <= 0) {
            const shot = superweaponState.queue.shift();
            // Przekazujemy aimPos do strzału
            fireSingleBarrel(ship, shot.cannonIndex, shot.barrelIndex, aimPos);
            if (superweaponState.queue.length > 0) {
                superweaponState.queue[0].delay += shot.delay; 
            }
        }
    }

    // Aktualizacja pocisków
    for (let i = hexlanceProjectiles.length - 1; i >= 0; i--) {
        const proj = hexlanceProjectiles[i];
        const stepDist = Math.hypot(proj.vx, proj.vy) * dt;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.life -= dt;
        proj.traveled += stepDist;

        if (window.DestructorSystem && window.npcs) {
            const targets = [...window.npcs, ...(window.wrecks || [])];
            for (const t of targets) {
                if (!t.hexGrid || (t.dead && !t.isWreck)) continue;
                const dx = t.x - proj.x;
                const dy = t.y - proj.y;
                if (dx*dx + dy*dy < (t.radius + 20)**2) {
                     window.DestructorSystem.applyImpact(t, proj.x, proj.y, 150, {x: proj.vx, y: proj.vy});
                }
            }
        }

        if (proj.life <= 0 || proj.traveled > superweaponState.range) {
            hexlanceProjectiles.splice(i, 1);
        }
    }

    for (let i = localParticles.length - 1; i >= 0; i--) {
        const p = localParticles[i];
        p.update();
        if (p.life <= 0) localParticles.splice(i, 1);
    }
}

// FIX: Dodano aimPos
export function drawSuperweapon(ctx, camera, ship, worldToScreen, aimPos) {
    if (!spriteReady) return;
    const zoom = camera.zoom;
    drawHexlanceProjectiles(ctx, camera, worldToScreen);
    for (const p of localParticles) {
        p.draw(ctx, camera, worldToScreen);
    }

    const tuneX = 275; const tuneY = 315; const anchorX = 0.25; const anchorY = 0.5; const tuneScale = 0.2;
    const spriteScale = tuneScale * zoom;
    const spriteW = sprite.width * spriteScale;
    const spriteH = sprite.height * spriteScale;
    const recoilDrawOffset = -superweaponState.recoilOffset * zoom;
    const drawOffsetX = -spriteW * anchorX + recoilDrawOffset;
    const drawOffsetY = -spriteH * anchorY;
    const offsets = [ { x: -tuneX, y: tuneY }, { x: tuneX, y: tuneY } ];

    offsets.forEach(off => {
        // Punkt montażu (obrót ze statkiem)
        const c = Math.cos(ship.angle);
        const s = Math.sin(ship.angle);
        const rotatedOffX = off.x * c - off.y * s;
        const rotatedOffY = off.x * s + off.y * c;
        const mountWorldX = ship.pos.x + rotatedOffX;
        const mountWorldY = ship.pos.y + rotatedOffY;
        const sPos = worldToScreen(mountWorldX, mountWorldY, camera);
        
        // FIX: Kąt wieżyczki celuje w aimPos (lub zgodnie z kadłubem jeśli brak celu)
        let turretAngle = ship.angle;
        if (aimPos) {
            const dx = aimPos.x - mountWorldX;
            const dy = aimPos.y - mountWorldY;
            turretAngle = Math.atan2(dy, dx);
        }

        ctx.save();
        ctx.translate(sPos.x, sPos.y);
        ctx.rotate(turretAngle);
        ctx.drawImage(sprite, drawOffsetX, drawOffsetY, spriteW, spriteH);
        ctx.restore();
    });
}

function drawHexlanceProjectiles(ctx, camera, worldToScreen) {
    // ... (bez zmian w rysowaniu pocisków) ...
    const zoom = camera.zoom;
    const tailLengthBase = 500 * zoom; 
    const segments = 40; 
    const waveFreq = 0.15; 
    const waveSpeed = 25.0; 
    const waveAmpBase = 6 * zoom; 
    const waveAmpGrow = 0.08 * zoom; 

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const proj of hexlanceProjectiles) {
        const screen = worldToScreen(proj.x, proj.y, camera);
        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(proj.angle); 
        
        ctx.globalCompositeOperation = 'screen';
        const aberrationOffset = 2 * zoom;

        ctx.save();
        ctx.translate(0, -aberrationOffset); 
        ctx.strokeStyle = 'rgba(200, 240, 255, 0.6)';
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-tailLengthBase * 0.8, 0); ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(0, aberrationOffset); 
        ctx.strokeStyle = 'rgba(0, 100, 255, 0.6)';
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-tailLengthBase * 0.8, 0); ctx.stroke();
        ctx.restore();

        ctx.globalCompositeOperation = 'source-over';
        const gradientCore = ctx.createLinearGradient(0, 0, -tailLengthBase, 0);
        gradientCore.addColorStop(0, 'rgba(255,255,255,1)');
        gradientCore.addColorStop(0.3, 'rgba(200,240,255,0.8)');
        gradientCore.addColorStop(1, 'rgba(100,200,255,0)');
        ctx.strokeStyle = gradientCore;
        ctx.lineWidth = 4 * zoom;
        ctx.shadowColor = 'rgba(200,240,255,0.8)';
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-tailLengthBase * 0.8, 0); ctx.stroke();

        const phaseA = globalTime * waveSpeed; 
        const phaseB = phaseA + Math.PI; 
        const drawStrand = (color, phaseOffset) => {
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.lineWidth = 3 * zoom;
            ctx.beginPath();
            for (let i = 0; i <= segments; i++) {
                const t = i / segments; 
                const px = -t * tailLengthBase; 
                let currentAmp = waveAmpBase + (Math.abs(px) * waveAmpGrow);
                let jitterY = 0;
                if (t > 0.7) {
                    const chaosFactor = (t - 0.7) / 0.3; 
                    jitterY = (Math.random() - 0.5) * 40 * chaosFactor * zoom;
                    currentAmp *= (1 + chaosFactor * 2); 
                }
                const py = Math.sin(px * waveFreq * 0.1 + phaseOffset) * currentAmp + jitterY;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        };

        const gradA = ctx.createLinearGradient(0, 0, -tailLengthBase, 0);
        gradA.addColorStop(0, 'rgba(133, 217, 255, 1)'); 
        gradA.addColorStop(1, 'rgba(0, 100, 255, 0)');
        drawStrand(gradA, phaseA);

        const gradB = ctx.createLinearGradient(0, 0, -tailLengthBase, 0);
        gradB.addColorStop(0, 'rgba(200, 240, 255, 1)'); 
        gradB.addColorStop(1, 'rgba(0, 50, 200, 0)');
        drawStrand(gradB, phaseB);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.ellipse(10 * zoom, 0, 25 * zoom, 6 * zoom, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
    ctx.restore();
}