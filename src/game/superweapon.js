/**
 * Moduł Superbroni (Hexlance)
 * Wersja V4: Wierna kopia wizualna z Testbench index.html
 * - Main Sparks: Kwadraty z glowem (Square Plasma)
 * - BG Sparks: Linie z trailem (Speed Lines)
 */

// Konfiguracja wizualna (Wartości 1:1 z Twojego panelu "tuner" w HTML)
const VFX_CONFIG = {
    // --- NOWE ISKRY (Main - Kwadraty) ---
    // W testbenchu: Min 2.0, Max 5.0
    newMinSize: 2.0,
    newMaxSize: 5.0,
    
    // --- STARE ISKRY (Background - Linie) ---
    // W testbenchu: Min 0.5, Max 1.5
    oldMinSize: 0.5,
    oldMaxSize: 1.5,

    // Kolory
    colors: ['#ffffff', '#d0eaff', '#85c1ff', '#4a90e2']
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
    barrelLength: 160,
    barrelSpacing: 35,
    recoilOffset: 0,
    recoilRecovery: 100
};

// =========================================================================
// SYSTEM CZĄSTECZEK (Wzorowany na updateAndDrawEffects z Testbench)
// =========================================================================

// Typ 1: Główne Iskry (Kwadraty)
class MainSpark {
    constructor(x, y, vx, vy) {
        this.x = x; 
        this.y = y;
        
        // Kąt i prędkość jak w Testbench:
        // const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 2.5;
        // const speed = Math.random() * 8 + 2; 
        // UWAGA: W Testbench speed 2-10 to "pixele na klatkę". W grze mamy dt (sekundy).
        // Mnożymy x60, żeby zachować dynamikę (120 - 600 jednostek/s).
        
        const baseAngle = Math.atan2(vy, vx);
        const spread = (Math.random() - 0.5) * 2.5; 
        const angle = baseAngle + spread;
        
        const frameSpeed = Math.random() * 8 + 2; 
        const worldSpeed = frameSpeed * 60; // Konwersja na czas rzeczywisty

        this.vx = Math.cos(angle) * worldSpeed;
        this.vy = Math.sin(angle) * worldSpeed;
        
        this.life = 1.0; 
        this.decay = Math.random() * 0.05 + 0.02; // Z testbenchu
        // Konwersja decay na czas (w testbenchu jest per klatka, tu per sekunda, więc x60)
        this.decayPerSec = this.decay * 60;

        this.size = VFX_CONFIG.newMinSize + Math.random() * (VFX_CONFIG.newMaxSize - VFX_CONFIG.newMinSize);
        this.color = VFX_CONFIG.colors[Math.floor(Math.random() * VFX_CONFIG.colors.length)];
        this.type = 'main';
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        // Tarcie (Testbench: this.vx *= 0.9)
        // Aproksymacja dla dt: Math.pow(0.9, dt * 60)
        const friction = Math.pow(0.9, dt * 60);
        this.vx *= friction;
        this.vy *= friction;
        
        this.life -= this.decayPerSec * dt;
    }

    draw(ctx, camera, worldToScreen) {
        if (this.life <= 0) return;
        const s = worldToScreen(this.x, this.y, camera);

        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life); 
        ctx.fillStyle = this.color;
        
        // Glow (z Testbench)
        ctx.shadowBlur = 8 * camera.zoom;
        ctx.shadowColor = this.color;
        
        const drawSize = Math.max(0.5, this.size * camera.zoom);
        
        // Rysujemy KWADRAT (Testbench: fillRect)
        ctx.fillRect(s.x - drawSize/2, s.y - drawSize/2, drawSize, drawSize); 
        ctx.restore();
    }
}

// Typ 2: Iskry Tła (Linie)
class BgSpark {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        
        this.life = 0.2 + Math.random() * 0.3; // Z Testbench
        this.maxLife = this.life;
        
        // Kolory tła z Testbench:
        const bgColors = ['#ffffff', '#e0f7fa', '#85c1ff'];
        this.color = bgColors[Math.floor(Math.random() * bgColors.length)];
        
        this.size = VFX_CONFIG.oldMinSize + Math.random() * (VFX_CONFIG.oldMaxSize - VFX_CONFIG.oldMinSize);
        this.drag = 0.90 + Math.random() * 0.06;
        this.curve = (Math.random() - 0.5) * 6.0;
        this.type = 'bg';
    }

    update(dt) {
        // Krzywizna (z Testbench)
        if (this.curve) {
            const angle = this.curve * dt;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const nvx = this.vx * cos - this.vy * sin;
            const nvy = this.vx * sin + this.vy * cos;
            this.vx = nvx; this.vy = nvy;
        }
        
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        // Tarcie: w Testbench p.vx *= p.drag co klatkę.
        const friction = Math.pow(this.drag, dt * 60);
        this.vx *= friction;
        this.vy *= friction;
        
        this.life -= dt;
    }

    draw(ctx, camera, worldToScreen) {
        if (this.life <= 0) return;
        const s = worldToScreen(this.x, this.y, camera);
        
        // Logika linii z Testbench:
        // const speed = Math.hypot(p.vx, p.vy);
        // const trailLen = Math.min(speed * 0.04, 30) * camera.zoom;
        
        // Uwaga: w Testbench speed był w px/klatkę. Tu mamy px/s.
        // Żeby uzyskać ten sam visual, dzielimy speed przez 60 przed mnożeniem przez 0.04.
        const speedPerSec = Math.hypot(this.vx, this.vy);
        const speedPerFrame = speedPerSec / 60; 
        
        const trailLen = Math.min(speedPerFrame * 3.5, 60) * camera.zoom; // Lekko podkręcone (3.5 zamiast 0.04*speed) dla widoczności
        
        const angle = Math.atan2(this.vy, this.vx);
        const dx = Math.cos(angle) * trailLen;
        const dy = Math.sin(angle) * trailLen;

        ctx.save();
        ctx.globalAlpha = (this.life / this.maxLife);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = Math.max(1, this.size * camera.zoom); // Min 1px żeby nie znikały
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(s.x - dx, s.y - dy);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        
        ctx.restore();
    }
}

// --- HELPERS ---
function rotate(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function getMuzzlePos(ship, cannonIndex, barrelIndex, aimPos) {
    const tuneX = 275;
    const tuneY = 315;
    const offsets = [ { x: -tuneX, y: tuneY }, { x: tuneX, y: tuneY } ];
    const off = offsets[cannonIndex];
    
    const pivotOffset = rotate(off, ship.angle);
    const pivotPos = { x: ship.pos.x + pivotOffset.x, y: ship.pos.y + pivotOffset.y };
    
    let dir;
    if (aimPos) {
        const dx = aimPos.x - pivotPos.x;
        const dy = aimPos.y - pivotPos.y;
        const dist = Math.hypot(dx, dy) || 1;
        dir = { x: dx / dist, y: dy / dist };
    } else {
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

function fireSingleBarrel(ship, cannonIndex, barrelIndex, aimPos) {
    const m = getMuzzlePos(ship, cannonIndex, barrelIndex, aimPos);
    const angle = Math.atan2(m.dir.y, m.dir.x);
    superweaponState.recoilOffset = Math.min(25, superweaponState.recoilOffset + 12);
    
    if (window.camera && window.camera.addShake) window.camera.addShake(8, 0.25);

    // --- AUDIO EVENT: Wysyłamy sygnał do gry, że strzela konkretna broń ---
    window.dispatchEvent(new CustomEvent('game_weapon_fired', { 
        detail: { 
            weaponId: 'hexlance', // Unikalne ID tej broni
            x: m.x, 
            y: m.y 
        } 
    }));
    // ----------------------------------------------------------------------

    // Dodanie pocisku
    hexlanceProjectiles.push({
        x: m.x, y: m.y,
        vx: m.dir.x * superweaponState.projectileSpeed + ship.vel.x,
        vy: m.dir.y * superweaponState.projectileSpeed + ship.vel.y,
        life: 2.0, traveled: 0,
        beamWidth: superweaponState.beamWidth,
        angle: angle
    });

    // Flash i Shockwave (Zewnętrzne systemy)
    if (window.spawnParticle) window.spawnParticle({ x: m.x, y: m.y }, { x: m.dir.x * 50, y: m.dir.y * 50 }, 0.08, '#ffffff', 60, true);
    if (window.spawnShockwave) window.spawnShockwave(m.x, m.y, { maxR: 80, maxLife: 0.12, w: 4, color: 'rgba(133, 193, 255,' });

    // 1. SPAWN NOWYCH ISKIER (Main - Kwadraty)
    // w Testbench: spawnSparks(..., 12)
    const newCount = 12;
    for(let i=0; i<newCount; i++) {
        localParticles.push(new MainSpark(m.x, m.y, m.dir.x, m.dir.y));
    }

    // 2. SPAWN STARYCH ISKIER (Background - Linie)
    // w Testbench: pętla 60 razy
    const oldCount = 60;
    for (let i = 0; i < oldCount; i++) {
        const spread = (Math.random() - 0.5) * 1.4; // VFX_CONFIG.oldSpread
        const sparkAngle = angle + spread;
        
        // Prędkość w Testbench: 1000 + random * 1500 (px/s, bo tam używali dt przy liniach)
        const speed = 1000 + Math.random() * 1500;
        
        const vx = Math.cos(sparkAngle) * speed + ship.vel.x;
        const vy = Math.sin(sparkAngle) * speed + ship.vel.y;
        
        localParticles.push(new BgSpark(m.x, m.y, vx, vy));
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

    // Aktualizacja lokalnych cząsteczek
    for (let i = localParticles.length - 1; i >= 0; i--) {
        const p = localParticles[i];
        p.update(dt);
        if (p.life <= 0) localParticles.splice(i, 1);
    }
}

export function drawSuperweapon(ctx, camera, ship, worldToScreen, aimPos) {
    if (!spriteReady) return;
    const zoom = camera.zoom;
    drawHexlanceProjectiles(ctx, camera, worldToScreen);
    
    // Rysowanie cząsteczek (iskier)
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
        const c = Math.cos(ship.angle);
        const s = Math.sin(ship.angle);
        const rotatedOffX = off.x * c - off.y * s;
        const rotatedOffY = off.x * s + off.y * c;
        const mountWorldX = ship.pos.x + rotatedOffX;
        const mountWorldY = ship.pos.y + rotatedOffY;
        const sPos = worldToScreen(mountWorldX, mountWorldY, camera);
        
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
