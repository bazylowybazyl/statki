/**
 * Moduł Superbroni (Hexlance) - W pełni zintegrowany z Hardpointami
 */

const VFX_CONFIG = {
    newMinSize: 2.0,
    newMaxSize: 5.0,
    oldMinSize: 0.5,
    oldMaxSize: 1.5,
    colors: ['#ffffff', '#d0eaff', '#85c1ff', '#4a90e2']
};

const localParticles = []; 
const hexlanceProjectiles = [];
let globalTime = 0;

export const superweaponState = {
    cooldown: 0,
    cooldownMax: 4.0, 
    chargeTime: 0.6,
    charging: false,
    chargeProgress: 0,
    projectileSpeed: 8000,
    beamWidth: 8,
    range: 12000,
    damage: 9999, 
    queue: [],
    shotDelay: 0.25,
    barrelLength: 160,
    barrelSpacing: 35,
    recoilOffset: 0,
    recoilRecovery: 100
};

function editorDegToForward(deg = 90) {
    const rad = (Number(deg) || 0) * Math.PI / 180;
    return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// --- HELPER: Odczytuje aktywne hardpointy BUILT-IN dla Hexlance ---
function getActiveMounts(ship) {
    if (ship && ship.weapons && ship.weapons.builtin) {
        const builtins = ship.weapons.builtin.filter(l => l.weapon && l.weapon.id === 'hexlance_siege' && l.hp);
        if (builtins.length > 0) {
            return builtins;
        }
    }
    return [];
}

class MainSpark {
    constructor(x, y, vx, vy) {
        this.x = x; this.y = y;
        const baseAngle = Math.atan2(vy, vx);
        const spread = (Math.random() - 0.5) * 2.5; 
        const angle = baseAngle + spread;
        const frameSpeed = Math.random() * 8 + 2; 
        const worldSpeed = frameSpeed * 60; 
        this.vx = Math.cos(angle) * worldSpeed;
        this.vy = Math.sin(angle) * worldSpeed;
        this.life = 1.0; 
        this.decay = Math.random() * 0.05 + 0.02; 
        this.decayPerSec = this.decay * 60;
        this.size = VFX_CONFIG.newMinSize + Math.random() * (VFX_CONFIG.newMaxSize - VFX_CONFIG.newMinSize);
        this.color = VFX_CONFIG.colors[Math.floor(Math.random() * VFX_CONFIG.colors.length)];
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
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
        ctx.shadowBlur = 8 * camera.zoom;
        ctx.shadowColor = this.color;
        const drawSize = Math.max(0.5, this.size * camera.zoom);
        ctx.fillRect(s.x - drawSize/2, s.y - drawSize/2, drawSize, drawSize); 
        ctx.restore();
    }
}

class BgSpark {
    constructor(x, y, vx, vy) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = 0.2 + Math.random() * 0.3; 
        this.maxLife = this.life;
        const bgColors = ['#ffffff', '#e0f7fa', '#85c1ff'];
        this.color = bgColors[Math.floor(Math.random() * bgColors.length)];
        this.size = VFX_CONFIG.oldMinSize + Math.random() * (VFX_CONFIG.oldMaxSize - VFX_CONFIG.oldMinSize);
        this.drag = 0.90 + Math.random() * 0.06;
        this.curve = (Math.random() - 0.5) * 6.0;
    }
    update(dt) {
        if (this.curve) {
            const angle = this.curve * dt;
            const cos = Math.cos(angle); const sin = Math.sin(angle);
            const nvx = this.vx * cos - this.vy * sin;
            const nvy = this.vx * sin + this.vy * cos;
            this.vx = nvx; this.vy = nvy;
        }
        this.x += this.vx * dt; this.y += this.vy * dt;
        const friction = Math.pow(this.drag, dt * 60);
        this.vx *= friction; this.vy *= friction;
        this.life -= dt;
    }
    draw(ctx, camera, worldToScreen) {
        if (this.life <= 0) return;
        const s = worldToScreen(this.x, this.y, camera);
        const speedPerSec = Math.hypot(this.vx, this.vy);
        const speedPerFrame = speedPerSec / 60; 
        const trailLen = Math.min(speedPerFrame * 3.5, 60) * camera.zoom; 
        const angle = Math.atan2(this.vy, this.vx);
        const dx = Math.cos(angle) * trailLen;
        const dy = Math.sin(angle) * trailLen;
        ctx.save();
        ctx.globalAlpha = (this.life / this.maxLife);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = Math.max(1, this.size * camera.zoom); 
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x - dx, s.y - dy); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.restore();
    }
}

function rotate(v, angle) {
    const c = Math.cos(angle); const s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function getMuzzlePos(ship, cannonIndex, barrelIndex) {
    const mounts = getActiveMounts(ship);
    const hp = mounts[cannonIndex]?.hp || mounts[cannonIndex] || null;
    const hpPos = hp?.pos || hp || { x: 0, y: 0, rot: 90 };
    const off = { x: Number(hpPos.x) || 0, y: Number(hpPos.y) || 0 };
    const pivotOffset = rotate(off, ship.angle);
    const pivotPos = { x: ship.pos.x + pivotOffset.x, y: ship.pos.y + pivotOffset.y };
    const localDir = editorDegToForward(Number.isFinite(Number(hpPos.rot)) ? Number(hpPos.rot) : 90);
    const dir = rotate(localDir, ship.angle);
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

function fireSingleBarrel(ship, cannonIndex, barrelIndex) {
    const m = getMuzzlePos(ship, cannonIndex, barrelIndex);
    const angle = Math.atan2(m.dir.y, m.dir.x);
    superweaponState.recoilOffset = Math.min(25, superweaponState.recoilOffset + 12);
    if (window.camera && window.camera.addShake) window.camera.addShake(8, 0.25);
    window.dispatchEvent(new CustomEvent('game_weapon_fired', { 
        detail: { weaponId: 'hexlance', x: m.x, y: m.y } 
    }));
    hexlanceProjectiles.push({
        x: m.x, y: m.y,
        vx: m.dir.x * superweaponState.projectileSpeed + ship.vel.x,
        vy: m.dir.y * superweaponState.projectileSpeed + ship.vel.y,
        life: 2.0, traveled: 0,
        beamWidth: superweaponState.beamWidth,
        angle: angle
    });
    if (window.spawnParticle) window.spawnParticle({ x: m.x, y: m.y }, { x: m.dir.x * 50, y: m.dir.y * 50 }, 0.08, '#ffffff', 60, true);
    if (window.spawnShockwave) window.spawnShockwave(m.x, m.y, { maxR: 80, maxLife: 0.12, w: 4, color: 'rgba(133, 193, 255,' });
    for(let i=0; i<12; i++) localParticles.push(new MainSpark(m.x, m.y, m.dir.x, m.dir.y));
    for (let i = 0; i < 60; i++) {
        const spread = (Math.random() - 0.5) * 1.4; 
        const sparkAngle = angle + spread;
        const speed = 1000 + Math.random() * 1500;
        localParticles.push(new BgSpark(m.x, m.y, Math.cos(sparkAngle) * speed + ship.vel.x, Math.sin(sparkAngle) * speed + ship.vel.y));
    }
}

function prepareSuperweaponSalvo(ship) {
    superweaponState.queue = [];
    const delay = superweaponState.shotDelay;
    const mounts = getActiveMounts(ship);
    let currentDelay = 0;
    
    // Dodajemy do kolejki każdą lufę każdej zainstalowanej broni!
    for (let cannonIndex = 0; cannonIndex < mounts.length; cannonIndex++) {
        superweaponState.queue.push({ cannonIndex, barrelIndex: 0, delay: currentDelay });
        currentDelay = delay;
        superweaponState.queue.push({ cannonIndex, barrelIndex: 1, delay: currentDelay });
    }
    superweaponState.cooldown = superweaponState.cooldownMax;
}

export function tryFireSuperweapon(ship) {
    if (!ship) return false;
    if (getActiveMounts(ship).length === 0) return false; // Brak broni, nie strzelaj
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
        const mounts = getActiveMounts(ship);
        
        // Ładowanie na każdej z luf
        for (let i = 0; i < mounts.length; i++) {
            const m = getMuzzlePos(ship, i, 0);
            for(let k=0; k<3; k++) spawnChargeEffect(m);
        }
        
        if (superweaponState.chargeProgress >= superweaponState.chargeTime) {
            superweaponState.charging = false;
            superweaponState.chargeProgress = 0;
            prepareSuperweaponSalvo(ship);
        }
    }
    if (superweaponState.queue.length > 0) {
        const nextShot = superweaponState.queue[0];
        if (nextShot.delay > 0 && nextShot.delay <= 0.22) {
             const m = getMuzzlePos(ship, nextShot.cannonIndex, nextShot.barrelIndex);
             for(let k=0; k<3; k++) spawnChargeEffect(m);
        }
        nextShot.delay -= dt;
        while (superweaponState.queue.length > 0 && superweaponState.queue[0].delay <= 0) {
            const shot = superweaponState.queue.shift();
            fireSingleBarrel(ship, shot.cannonIndex, shot.barrelIndex);
            if (superweaponState.queue.length > 0) {
                superweaponState.queue[0].delay += shot.delay; 
            }
        }
    }
    for (let i = hexlanceProjectiles.length - 1; i >= 0; i--) {
        const proj = hexlanceProjectiles[i];

        // Zapisujemy pozycję z poprzedniej klatki (żeby narysować linię cięcia)
        const prevX = proj.x;
        const prevY = proj.y;

        const moveX = proj.vx * dt;
        const moveY = proj.vy * dt;
        const stepDist = Math.hypot(moveX, moveY);

        proj.x += moveX;
        proj.y += moveY;
        proj.life -= dt;
        proj.traveled += stepDist;

        if (window.DestructorSystem && window.npcs) {
            const targets = [...window.npcs, ...(window.wrecks || [])];
            for (const t of targets) {
                if (!t.hexGrid || (t.dead && !t.isWreck)) continue;

                // BROADPHASE: Znajdź najbliższy punkt na linii lotu pocisku do środka statku
                const lenSq = moveX * moveX + moveY * moveY;
                let tParam = 0;
                if (lenSq > 0) {
                    tParam = ((t.x - prevX) * moveX + (t.y - prevY) * moveY) / lenSq;
                    tParam = Math.max(0, Math.min(1, tParam));
                }
                const closestX = prevX + tParam * moveX;
                const closestY = prevY + tParam * moveY;

                const distSq = (t.x - closestX) ** 2 + (t.y - closestY) ** 2;
                const hitR = (t.radius || 50) + 30; // Promień statku + margines

                if (distSq < hitR * hitR) {
                    // RAYCAST HIT! Pocisk przeciął statek.
                    // Krokujemy co 25 pikseli wzdłuż linii cięcia, żeby nie pominąć żadnego heksa
                    const steps = Math.max(1, Math.ceil(stepDist / 25));

                    for (let s = 0; s <= steps; s++) {
                        const frac = s / steps;
                        const testX = prevX + moveX * frac;
                        const testY = prevY + moveY * frac;

                        // Uderzamy z siłą 1500 DMG (przetnie heksy na wylot jak masło)
                        window.DestructorSystem.applyImpact(t, testX, testY, 15, { x: proj.vx * 50, y: proj.vy * 50 }, { radius: 35 });
                    }
                }
            }
        }

        if (proj.life <= 0 || proj.traveled > superweaponState.range) {
            hexlanceProjectiles.splice(i, 1);
        }
    }
    for (let i = localParticles.length - 1; i >= 0; i--) {
        const p = localParticles[i];
        p.update(dt);
        if (p.life <= 0) localParticles.splice(i, 1);
    }
}

export function drawSuperweapon(ctx, camera, ship, worldToScreen, aimPos, visualState = null) {
    drawHexlanceProjectiles(ctx, camera, worldToScreen);
    
    for (const p of localParticles) {
        p.draw(ctx, camera, worldToScreen);
    }
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
