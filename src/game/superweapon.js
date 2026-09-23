/**
 * Moduł Superbroni (Hexlance) - W pełni zintegrowany z Hardpointami
 */

import { MASTER_WEAPONS } from '../data/weapons.js';
import { RailgunFX3D } from '../3d/railgunFx3D.js';

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
const HEXLANCE_DEF = MASTER_WEAPONS?.hexlance_siege || {};

function getHexlanceStat(key, fallback) {
    const value = Number(HEXLANCE_DEF?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function syncSuperweaponProfile() {
    superweaponState.cooldownMax = getHexlanceStat('cooldown', 6.0);
    superweaponState.chargeTime = getHexlanceStat('chargeTime', 1.2);
    superweaponState.projectileSpeed = getHexlanceStat('baseSpeed', 12000);
    superweaponState.range = getHexlanceStat('baseRange', 60000);
    superweaponState.damage = getHexlanceStat('baseDamage', 9999);
    superweaponState.shotDelay = getHexlanceStat('burstDelay', 0.12);
}

export const superweaponState = {
    cooldown: 0,
    cooldownMax: getHexlanceStat('cooldown', 6.0),
    chargeTime: getHexlanceStat('chargeTime', 1.2),
    charging: false,
    chargeProgress: 0,
    armed: false,
    armedTimer: 0,
    armedDuration: 5.0,
    projectileSpeed: getHexlanceStat('baseSpeed', 12000),
    beamWidth: 8,
    range: getHexlanceStat('baseRange', 60000),
    damage: getHexlanceStat('baseDamage', 9999), 
    queue: [],
    shotDelay: getHexlanceStat('burstDelay', 0.12),
    recoilOffset: 0,
    recoilRecovery: 100
};
syncSuperweaponProfile();

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

function getMuzzlePos(ship, cannonIndex) {
    const mounts = getActiveMounts(ship);
    const hp = mounts[cannonIndex]?.hp || mounts[cannonIndex] || null;
    const hpPos = hp?.pos || hp || { x: 0, y: 0, rot: 90 };
    const off = { x: Number(hpPos.x) || 0, y: Number(hpPos.y) || 0 };
    const pivotOffset = rotate(off, ship.angle);
    const pivotPos = { x: ship.pos.x + pivotOffset.x, y: ship.pos.y + pivotOffset.y };
    const localDir = editorDegToForward(Number.isFinite(Number(hpPos.rot)) ? Number(hpPos.rot) : 90);
    const dir = rotate(localDir, ship.angle);
    return {
        x: pivotPos.x,
        y: pivotPos.y,
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

function fireSingleMount(ship, cannonIndex) {
    const m = getMuzzlePos(ship, cannonIndex);
    const angle = Math.atan2(m.dir.y, m.dir.x);
    const fx3d = RailgunFX3D.available;
    superweaponState.recoilOffset = Math.min(25, superweaponState.recoilOffset + 12);
    if (window.camera && window.camera.addShake) window.camera.addShake(fx3d ? 14 : 8, fx3d ? 0.4 : 0.25);
    window.dispatchEvent(new CustomEvent('game_weapon_fired', {
        detail: { weaponId: 'hexlance', x: m.x, y: m.y }
    }));
    const projectileLife = Math.max(8, (superweaponState.range / Math.max(1, superweaponState.projectileSpeed)) + 2);
    const proj = {
        x: m.x, y: m.y,
        vx: m.dir.x * superweaponState.projectileSpeed + (ship.vel?.x || 0),
        vy: m.dir.y * superweaponState.projectileSpeed + (ship.vel?.y || 0),
        life: projectileLife, traveled: 0,
        beamWidth: superweaponState.beamWidth,
        angle: angle,
        // Smuga 3D: uchwyt emitera, odstęp między fontannami na rzazie
        // i cele, w które pocisk już wszedł (rozbłysk wejścia raz na kadłub).
        slug: null, cutCd: 0, bitten: null
    };
    hexlanceProjectiles.push(proj);
    if (fx3d) {
        RailgunFX3D.fire(m.x, m.y, m.dir.x, m.dir.y, 1);
        // Smuga startuje z lufy, nie ze środka pierwszego kroku — inaczej po
        // wystrzale zostaje dziura długości jednej klatki lotu (200 jednostek).
        proj.slug = RailgunFX3D.beginSlug(m.x, m.y, m.dir.x, m.dir.y, Math.hypot(proj.vx, proj.vy));
    }
    // Cały stary rozbłysk 2D — biała cząstka kanwy, pierścień uderzeniowy
    // i iskry — zostaje WYŁĄCZNIE jako zapas, gdy warstwa 3D jest niedostępna.
    // Recepta z dema ma własną flarę, krzyż i lancę plazmy w tym samym
    // punkcie; kanwa dokładała pod nią drugą białą plamę i obręcz.
    if (fx3d) return;
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
    
    // Built-in fires directly from the hardpoint pivot, one shot per mount.
    for (let cannonIndex = 0; cannonIndex < mounts.length; cannonIndex++) {
        superweaponState.queue.push({ cannonIndex, delay: currentDelay });
        currentDelay += delay;
    }
    superweaponState.cooldown = superweaponState.cooldownMax;
}

export function tryFireSuperweapon(ship) {
    syncSuperweaponProfile();
    if (!ship) return false;
    if (getActiveMounts(ship).length === 0) return false; // Brak broni, nie strzelaj
    if (superweaponState.queue.length > 0) return false;
    if (superweaponState.charging) return false;

    if (superweaponState.armed) {
        superweaponState.armed = false;
        superweaponState.armedTimer = 0;
        prepareSuperweaponSalvo(ship);
        return true;
    }

    if (superweaponState.cooldown > 0) return false;
    superweaponState.charging = true;
    superweaponState.chargeProgress = 0;
    return true;
}

export function updateSuperweapon(dt, ship, aimPos) {
    syncSuperweaponProfile();
    globalTime += dt;
    if (superweaponState.recoilOffset > 0) {
        superweaponState.recoilOffset = Math.max(0, superweaponState.recoilOffset - superweaponState.recoilRecovery * dt);
    }
    if (superweaponState.cooldown > 0 && !superweaponState.charging && !superweaponState.armed && superweaponState.queue.length === 0) {
        superweaponState.cooldown = Math.max(0, superweaponState.cooldown - dt);
    }
    if (superweaponState.charging) {
        superweaponState.chargeProgress += dt;
        const mounts = getActiveMounts(ship);
        const chargeU = superweaponState.chargeProgress / Math.max(0.05, superweaponState.chargeTime);

        // Ładowanie na każdym built-in hardpoincie
        for (let i = 0; i < mounts.length; i++) {
            const m = getMuzzlePos(ship, i);
            // RailgunFX3D pokazuje energię biegnącą szynami w głąb kadłuba;
            // stary efekt zasysał cząstki do lufy i dublowałby się z nią.
            if (RailgunFX3D.available) RailgunFX3D.charge(m.x, m.y, m.dir.x, m.dir.y, dt, chargeU);
            else for(let k=0; k<3; k++) spawnChargeEffect(m);
        }

        if (superweaponState.chargeProgress >= superweaponState.chargeTime) {
            superweaponState.charging = false;
            superweaponState.chargeProgress = superweaponState.chargeTime;
            superweaponState.armed = true;
            superweaponState.armedTimer = superweaponState.armedDuration;
        }
    }
    if (superweaponState.armed) {
        superweaponState.armedTimer = Math.max(0, superweaponState.armedTimer - dt);
        if (superweaponState.armedTimer <= 0) {
            superweaponState.armed = false;
            superweaponState.chargeProgress = 0;
        }
    }
    if (superweaponState.queue.length > 0) {
        const nextShot = superweaponState.queue[0];
        if (nextShot.delay > 0 && nextShot.delay <= 0.22) {
             const m = getMuzzlePos(ship, nextShot.cannonIndex);
             if (RailgunFX3D.available) RailgunFX3D.charge(m.x, m.y, m.dir.x, m.dir.y, dt, 1);
             else for(let k=0; k<3; k++) spawnChargeEffect(m);
        }
        nextShot.delay -= dt;
        while (superweaponState.queue.length > 0 && superweaponState.queue[0].delay <= 0) {
            const shot = superweaponState.queue.shift();
            fireSingleMount(ship, shot.cannonIndex);
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
        if (proj.cutCd > 0) proj.cutCd -= dt;

        // Smuga świata idzie za pociskiem: emiter dostaje CAŁY przebyty odcinek,
        // więc próbki lądują co ~120 jednostek niezależnie od długości klatki.
        if (proj.slug) {
            RailgunFX3D.stepSlug(proj.slug, prevX, prevY, proj.x, proj.y,
                proj.vx, proj.vy, proj.vx, proj.vy);
        }

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

                    let biteX = 0, biteY = 0, bitFrac = -1;
                    for (let s = 0; s <= steps; s++) {
                        const frac = s / steps;
                        const testX = prevX + moveX * frac;
                        const testY = prevY + moveY * frac;

                        // Uderzamy z siłą 1500 DMG (przetnie heksy na wylot jak masło)
                        const bit = window.DestructorSystem.applyImpact(t, testX, testY, 15, { x: proj.vx * 50, y: proj.vy * 50 }, { radius: 35 });
                        // Pierwszy krok, który trafił w heks, a nie w powietrze
                        // wokół kadłuba — tam sypią iskry, nie na obwiedni.
                        if (bit && bitFrac < 0) { bitFrac = frac; biteX = testX; biteY = testY; }
                    }
                    // Hexlance nie wybucha, tylko TNIE. Pełny rozbłysk (krzyż +
                    // lanca) należy się WEJŚCIU w dany kadłub, raz na cel; dalej
                    // sypie już sam rzaz, dławiony odstępem, żeby cięcie przez
                    // pancernik nie zamieniło się w stroboskop.
                    if (bitFrac >= 0 && RailgunFX3D.available) {
                        if (!proj.bitten) proj.bitten = new Set();
                        if (!proj.bitten.has(t)) {
                            proj.bitten.add(t);
                            proj.cutCd = 0.05;
                            RailgunFX3D.impact(biteX, biteY, proj.vx, proj.vy, 0.85);
                        } else if (proj.cutCd <= 0) {
                            proj.cutCd = 0.05;
                            RailgunFX3D.kerf(biteX, biteY, proj.vx, proj.vy, 0.7);
                        }
                    }
                }
            }
        }

        if (proj.life <= 0 || proj.traveled > superweaponState.range) {
            // Historia smugi gaśnie dalej sama; zwalniamy tylko slot żywej głowy.
            if (proj.slug) RailgunFX3D.endSlug(proj.slug, proj.x, proj.y, proj.vx, proj.vy);
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
    // Smuga i głowica pocisku żyją w 3D (RailgunFX3D). Kanwa dorysowuje tylko
    // te pociski, które nie dostały emitera 3D — dwa ślady na jednym pocisku
    // rozjeżdżałyby się przy każdej zmianie zoomu.
    drawHexlanceProjectiles(ctx, camera, worldToScreen);

    for (const p of localParticles) {
        p.draw(ctx, camera, worldToScreen);
    }
}

function drawHexlanceProjectiles(ctx, camera, worldToScreen) {
    // Gdy każdy pocisk w locie ma emiter 3D, kanwa nie ma tu nic do roboty —
    // wychodzimy przed save()/shadowBlur, żeby nie dotykać stanu kontekstu.
    let pending = 0;
    for (const proj of hexlanceProjectiles) if (!proj.slug) pending++;
    if (!pending) return;

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
        if (proj.slug) continue;                 // ten pocisk rysuje RailgunFX3D
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
