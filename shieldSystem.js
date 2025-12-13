// --- SHIELD SYSTEM MODULE ---
// Wersja: Correct World Space Scaling
// Naprawiono: Błąd "Double Scaling", który czynił tarczę mikroskopijną przy oddaleniu kamery.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.15,
    hexAlpha: 0.4,       // Nieco mniejsza alpha, by nie zasłaniać statku
    hexScale: 42,        // Dopasowane do skali świata gry
    hitDecayTime: 0.6,
    hitSpread: 0.8,
    deformPower: 12,
    shieldScale: 1.4,    // Tarcza 40% większa od kadłuba
    activationDuration: 0.45,
    deactivationDuration: 0.55,
    breakDuration: 0.65
};

// Cache tekstury i offscreen dla wzoru
let hexGridTexture = null;
let hexPattern = null;
let shieldCanvas = null;
let sCtx = null;
let W = 0, H = 0;

// --- UTILS ---

function hexToRgb(hex) {
    if (typeof hex !== 'string') return { r: 0, g: 170, b: 255 };
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 170, b: 255 };
}

function generateHexTexture(colorHex, scale) {
    const s = Math.max(10, scale); 
    const tileW = 3 * s;
    const tileH = Math.sqrt(3) * s; 
    
    const cvs = document.createElement('canvas');
    cvs.width = Math.ceil(tileW);
    cvs.height = Math.ceil(tileH * 2);
    const c = cvs.getContext('2d');
    
    // Rysowanie na offscreen canvasie
    c.strokeStyle = colorHex || '#00aaff';
    c.lineWidth = 2; 
    c.lineCap = 'round';
    c.globalAlpha = 0.9;

    c.beginPath();
    const drawHexPart = (offsetX, offsetY) => {
        for (let i = 0; i < 6; i++) {
            const angle = 2 * Math.PI / 6 * i;
            const x = offsetX + s * Math.cos(angle);
            const y = offsetY + s * Math.sin(angle);
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.closePath();
    };

    // Tiling
    drawHexPart(0, 0);
    drawHexPart(tileW, 0);
    drawHexPart(tileW * 0.5, tileH);
    drawHexPart(0, tileH * 2);
    drawHexPart(tileW, tileH * 2);

    c.stroke();
    return cvs;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

function getEntityPosition(entity) {
    if (!entity) return { x: undefined, y: undefined };
    const x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
    const y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
    return { x, y };
}

function ensureShieldCanvasSize(size) {
    if (!shieldCanvas) {
        shieldCanvas = document.createElement('canvas');
        sCtx = shieldCanvas.getContext('2d');
    }
    const clamped = Math.max(256, Math.min(2048, Math.ceil(size)));
    if (shieldCanvas.width !== clamped || shieldCanvas.height !== clamped) {
        shieldCanvas.width = clamped;
        shieldCanvas.height = clamped;
    }
}

function ensureHexPattern() {
    if (!hexGridTexture || !sCtx) return null;
    if (!hexPattern) {
        hexPattern = sCtx.createPattern(hexGridTexture, 'repeat');
    }
    return hexPattern;
}

function spawnShieldSparks(entity, count, radiusScale = 1, speedRange = [120, 220], color = '#dff5ff', life = 0.2, rimOnly = false) {
    if (typeof spawnParticle !== 'function') return;
    const pos = getEntityPosition(entity);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    const { rx, ry } = getShieldDimensions(entity);
    const rot = entity.angle || 0;

    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const rEdge = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
        const r = rimOnly ? rEdge * radiusScale : rEdge * radiusScale * (0.6 + Math.random() * 0.4);
        const lx = cos * r;
        const ly = sin * r;
        const worldX = pos.x + Math.cos(rot) * lx - Math.sin(rot) * ly;
        const worldY = pos.y + Math.sin(rot) * lx + Math.cos(rot) * ly;

        const dir = ang + rot;
        const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
        spawnParticle({ x: worldX, y: worldY }, { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed }, life, color, 2 + Math.random() * 1.5, true);
    }
}

function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const n = clamp(x, 0, 1) - 1;
    return 1 + c3 * Math.pow(n, 3) + c1 * Math.pow(n, 2);
}

function ensureShieldRuntime(shield) {
    shield.state = shield.state || (shield.val > 0 ? 'activating' : 'off');
    shield.activationProgress = Number.isFinite(shield.activationProgress) ? shield.activationProgress : 0;
    shield.currentAlpha = Number.isFinite(shield.currentAlpha) ? shield.currentAlpha : 0;
    shield.breakTimer = Number.isFinite(shield.breakTimer) ? shield.breakTimer : 0;
    shield.energyShotTimer = Number.isFinite(shield.energyShotTimer) ? shield.energyShotTimer : 0;
    shield.energyShotDuration = shield.energyShotDuration || 0.5;
    shield.prevEnergyShotTimer = Number.isFinite(shield.prevEnergyShotTimer) ? shield.prevEnergyShotTimer : 0;
    shield.activationSparked = Boolean(shield.activationSparked);
    shield.breakCracksSeeded = Boolean(shield.breakCracksSeeded);
    shield.sparkCooldown = Number.isFinite(shield.sparkCooldown) ? shield.sparkCooldown : 0;
}

function shouldBreak(shield) {
    return shield.val <= 0 && shield.max > 0 && shield.state !== 'breaking' && shield.state !== 'off';
}

function breakShield(shield) {
    ensureShieldRuntime(shield);
    shield.state = 'breaking';
    shield.breakTimer = 0;
    shield.activationProgress = 1;
    shield.currentAlpha = Math.max(shield.currentAlpha, 0.8);
    shield.energyShotTimer = Math.max(shield.energyShotTimer, shield.energyShotDuration);
    shield.breakCracksSeeded = false;
}

function triggerEnergyFlash(shield, magnitude = 1) {
    ensureShieldRuntime(shield);
    const bonus = clamp(magnitude * 0.15, 0.05, 0.3);
    shield.energyShotTimer = Math.min(shield.energyShotDuration, shield.energyShotTimer + bonus + 0.2);
}

export function triggerEnergyShot(entity) {
    if (!entity || !entity.shield) return;
    const shield = entity.shield;
    ensureShieldRuntime(shield);

    if (shield.state === 'off' || shield.state === 'deactivating') {
        shield.state = 'active';
        shield.activationProgress = Math.max(shield.activationProgress, 1);
        shield.currentAlpha = Math.max(shield.currentAlpha, 0.35);
    }

    if (Number.isFinite(shield.max)) {
        const boost = Math.max(0, 0.5 * shield.max);
        shield.val = clamp((shield.val ?? 0) + boost, 0, shield.max);
    }

    shield.energyShotTimer = Math.max(shield.energyShotTimer, shield.energyShotDuration);
    triggerEnergyFlash(shield, 1);
}

// --- INIT ---
export function initShieldSystem(width, height) {
    resizeShieldSystem(width, height);
    if (!hexGridTexture) {
        hexGridTexture = generateHexTexture(CONFIG.baseColor, CONFIG.hexScale);
        if (!shieldCanvas) {
            shieldCanvas = document.createElement('canvas');
            sCtx = shieldCanvas.getContext('2d');
        }
        hexPattern = sCtx?.createPattern(hexGridTexture, 'repeat');
    }
}

export function resizeShieldSystem(width, height) {
    W = width;
    H = height;
    if (!shieldCanvas) {
        shieldCanvas = document.createElement('canvas');
        sCtx = shieldCanvas.getContext('2d');
    }
    if (shieldCanvas) {
        const size = Math.max(256, Math.min(2048, Math.max(width, height)));
        if (shieldCanvas.width !== size || shieldCanvas.height !== size) {
            shieldCanvas.width = size;
            shieldCanvas.height = size;
        }
    }
}

// --- LOGIC ---

export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity || !entity.shield) return;
    if (!entity.shield.impacts) entity.shield.impacts = [];
    ensureShieldRuntime(entity.shield);

    if (!Number.isFinite(bulletX) || !Number.isFinite(bulletY)) return;

    const pos = getEntityPosition(entity);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

    // Kąt uderzenia w świecie gry
    const dx = bulletX - pos.x;
    const dy = bulletY - pos.y;
    const worldAngle = Math.atan2(dy, dx);
    
    // Konwersja na kąt lokalny (względem obrotu statku)
    // Dzięki temu efekt uderzenia "obraca się" razem ze statkiem
    const localAngle = worldAngle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle,
        life: 1.0,
        intensity: Math.min(2.5, Math.max(0.5, damage / 10)),
        deformation: CONFIG.deformPower
    });

    if (typeof spawnParticle === 'function') {
        const { rx, ry } = getShieldDimensions(entity);
        const pos = getEntityPosition(entity);
        const impactRot = (entity.angle || 0) + localAngle;
        const cos = Math.cos(impactRot);
        const sin = Math.sin(impactRot);
        const rHit = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
        const hitX = pos.x + cos * rHit;
        const hitY = pos.y + sin * rHit;
        for (let i = 0; i < 3; i++) {
            const jitter = (Math.random() - 0.5) * 0.3;
            const dir = impactRot + jitter;
            const speed = 120 + Math.random() * 140;
            spawnParticle({ x: hitX, y: hitY }, { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed }, 0.25, '#dff5ff', 2.1, true);
        }
    }

    triggerEnergyFlash(entity.shield, damage / (entity.shield.max || 1));
    if (shouldBreak(entity.shield)) {
        breakShield(entity.shield);
    }
}

export function updateShieldFx(entity, dt) {
    if (!entity.shield) return;
    ensureShieldRuntime(entity.shield);
    if (!entity.shield.impacts) entity.shield.impacts = [];

    entity.shield.sparkCooldown = Math.max(0, (entity.shield.sparkCooldown || 0) - dt);
    if (shouldBreak(entity.shield)) {
        breakShield(entity.shield);
    }

    if (entity.shield.energyShotTimer > 0) {
        entity.shield.energyShotTimer = Math.max(0, entity.shield.energyShotTimer - dt);
    }

    if (entity.shield.state === 'breaking') {
        entity.shield.breakTimer += dt;
        if (entity.shield.breakTimer >= CONFIG.breakDuration) {
            entity.shield.state = 'off';
            entity.shield.activationProgress = 0;
            entity.shield.currentAlpha = 0;
            entity.shield.breakCracksSeeded = false;
        }
    }

    if (entity.shield.state === 'off' && entity.shield.val > 1) {
        entity.shield.state = 'activating';
        entity.shield.activationProgress = 0;
        entity.shield.activationSparked = false;
    }

    if (entity.shield.state === 'activating') {
        entity.shield.activationProgress = Math.min(1, entity.shield.activationProgress + dt / CONFIG.activationDuration);
        if (entity.shield.activationProgress >= 1) {
            entity.shield.state = 'active';
        }
    } else if (entity.shield.state === 'active') {
        if (entity.shield.val <= 0) {
            entity.shield.state = 'deactivating';
        }
        entity.shield.activationProgress = Math.min(1, entity.shield.activationProgress + dt * 0.5);
    } else if (entity.shield.state === 'deactivating') {
        entity.shield.activationProgress = Math.max(0, entity.shield.activationProgress - dt / CONFIG.deactivationDuration);
        if (entity.shield.activationProgress <= 0.01) {
            entity.shield.state = 'off';
            entity.shield.currentAlpha = 0;
        }
    }

    if (entity.shield.state === 'breaking' && !entity.shield.breakCracksSeeded) {
        const cracks = 8;
        for (let i = 0; i < cracks; i++) {
            entity.shield.impacts.push({
                localAngle: Math.random() * Math.PI * 2,
                life: 0.9,
                intensity: 2.2 + Math.random() * 0.8,
                deformation: CONFIG.deformPower * 1.4
            });
        }
        entity.shield.breakCracksSeeded = true;
    }

    if (entity.shield.state === 'breaking' && entity.shield.sparkCooldown <= 0) {
        spawnShieldSparks(entity, 6, 1, [180, 320], '#f2fbff', 0.16, true);
        entity.shield.sparkCooldown = 0.08 + Math.random() * 0.05;
    }

    if (entity.shield.state === 'activating' && !entity.shield.activationSparked && entity.shield.activationProgress > 0.05) {
        spawnShieldSparks(entity, 14, 1, [140, 240], '#c8f3ff', 0.22, false);
        entity.shield.activationSparked = true;
    }

    if (!entity.shield.impacts) return;
    for (let i = entity.shield.impacts.length - 1; i >= 0; i--) {
        const imp = entity.shield.impacts[i];
        imp.life -= dt / CONFIG.hitDecayTime;
        if (imp.life <= 0) {
            entity.shield.impacts.splice(i, 1);
        }
    }

    if (entity.shield.energyShotTimer > 0 && entity.shield.prevEnergyShotTimer <= 0) {
        if (typeof spawnParticle === 'function') {
            const { rx, ry } = getShieldDimensions(entity);
            const pos = getEntityPosition(entity);
            for (let i = 0; i < 9; i++) {
                const angle = Math.random() * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const rEdge = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
                const rot = angle + (entity.angle || 0);
                const px = pos.x + Math.cos(rot) * rEdge;
                const py = pos.y + Math.sin(rot) * rEdge;
                const speed = 220 + Math.random() * 160;
                spawnParticle({ x: px, y: py }, { x: Math.cos(rot) * speed, y: Math.sin(rot) * speed }, 0.28, '#d2f7ff', 2.8, true);
            }
        }
    }

    entity.shield.prevEnergyShotTimer = entity.shield.energyShotTimer;
}

// --- HELPER WYMIARÓW ---
function getShieldDimensions(entity) {
    // Domyślne wymiary z fizyki
    let w = entity.w || (entity.radius * 2) || 40;
    let h = entity.h || (entity.radius * 2) || 40;

    // Specjalna obsługa Capital Ships (Carrier, Battleship) zdefiniowanych w index.html
    // Capital ships mają 'capitalProfile' który definiuje ich wizualny rozmiar
    if (entity.capitalProfile) {
        const baseR = entity.radius || 20;
        // lengthScale to długość (oś X w lokalnym układzie sprite'a)
        const len = baseR * (entity.capitalProfile.lengthScale || 3.2);
        // widthScale to szerokość
        const wid = baseR * (entity.capitalProfile.widthScale || 1.2);
        
        // Upewniamy się, że tarcza pokrywa cały sprite
        w = Math.max(w, len);
        h = Math.max(h, wid);
    } 
    // Obsługa małych statków (fightery), żeby tarcza była bardziej okrągła
    else if (entity.fighter || entity.type === 'fighter') {
        const size = Math.max(w, h);
        w = size;
        h = size;
    }

    return { 
        rx: (w / 2) * CONFIG.shieldScale, 
        ry: (h / 2) * CONFIG.shieldScale 
    };
}

// --- RENDER ---

export function drawShield(ctx, entity, cam) {
    try {
        const shield = entity.shield;
        if (!shield) return;
        ensureShieldRuntime(shield);

        // Nie rysuj jeśli tarcza nie ma MaxHP (np. asteroidy)
        if (!shield.max || shield.max <= 0) return;

        // Nie rysuj całkowicie wyczerpanej tarczy, chyba że właśnie oberwała albo trwa animacja stanu
        const impacts = shield.impacts || [];
        if (shield.val <= 1 && impacts.length === 0 && shield.energyShotTimer <= 0 && shield.currentAlpha <= 0.01 && shield.state === 'off') return;

        // 1. POZYCJA NA EKRANIE
        const pos = getEntityPosition(entity);
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

        const screenX = (pos.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
        const screenY = (pos.y - cam.y) * cam.zoom + ctx.canvas.height / 2;

        // Culling (nie rysuj tego co poza ekranem)
        if (screenX < -500 || screenX > ctx.canvas.width + 500 || screenY < -500 || screenY > ctx.canvas.height + 500) return;

        // Pobranie wymiarów (W JEDNOSTKACH ŚWIATA)
        const { rx, ry } = getShieldDimensions(entity);

        // Obliczanie Alpha / stanu
        const hpFactor = clamp(shield.val / shield.max, 0, 1);
        const time = performance.now() / 1000;
        const basePulse = Math.sin(time * 3.4) * 0.05;
        const edgeNoise = Math.sin(time * 7.3 + (shield.activationProgress || 0) * 5) * 0.02;

        const breakProgress = shield.state === 'breaking' ? clamp(shield.breakTimer / CONFIG.breakDuration, 0, 1) : 0;
        const activatingBoost = shield.state === 'activating' ? (1 - shield.activationProgress * 0.6) : 0;
        const deactivatingScale = shield.state === 'deactivating' ? clamp(shield.activationProgress, 0, 1) : 1;
        const energyFlash = shield.energyShotTimer > 0 ? clamp(shield.energyShotTimer / shield.energyShotDuration, 0, 1) : 0;

        const activationBubble = shield.state === 'activating'
            ? 1 + Math.sin(clamp(shield.activationProgress, 0, 1) * Math.PI) * 0.22
            : 1;
        const energyPulse = energyFlash > 0 ? Math.sin((1 - energyFlash) * Math.PI * 4 + time * 6) * 0.25 * energyFlash : 0;

        let targetAlpha = Math.max(0.12, (CONFIG.baseAlpha + basePulse + edgeNoise) * (0.25 + hpFactor * 0.75));
        targetAlpha += impacts.length > 0 ? 0.35 : 0;
        targetAlpha += energyFlash * 0.45 + energyPulse;
        if (shield.state === 'breaking') {
            targetAlpha += (1 - breakProgress) * 0.45;
            targetAlpha *= 0.85 + 0.25 * Math.sin(time * 35);
        }
        if (shield.state === 'activating') {
            targetAlpha += activatingBoost * 0.4 + (1 - shield.activationProgress) * 0.35;
        }
        targetAlpha *= deactivatingScale;
        targetAlpha = clamp(targetAlpha, 0, 1);

        shield.currentAlpha = lerp(shield.currentAlpha, targetAlpha, 0.2);
        const alpha = shield.currentAlpha;

        // Obsługa dodatkowej rotacji sprite'a (dla Capital Ships)
        let visualAngle = entity.angle || 0;
        if (entity.capitalProfile && Number.isFinite(entity.capitalProfile.spriteRotation)) {
            visualAngle += entity.capitalProfile.spriteRotation;
        }

        ctx.save();

        const energyScale = 1 + energyFlash * 0.18 + Math.sin(time * 6) * energyFlash * 0.05;
        const activationScale = (shield.state === 'activating'
            ? easeOutBack(shield.activationProgress)
            : (shield.state === 'deactivating'
                ? Math.max(0.1, shield.activationProgress)
                : (shield.state === 'breaking'
                    ? Math.max(0.65, 1 - breakProgress * 0.35)
                    : 1))) * activationBubble * energyScale;
        const jitter = shield.state === 'deactivating' ? (1 - clamp(shield.activationProgress, 0, 1)) * 3.5 : 0;
        
        // 2. TRANSFORMACJA (Kluczowy moment naprawy)
        ctx.translate(screenX, screenY);
        // SKALUJEMY KONTEKST, NIE PROMIEŃ!
        // Dzięki temu rx/ry są w jednostkach świata, a canvas sam je zmniejsza przy oddaleniu.
        ctx.scale(cam.zoom, cam.zoom);
        if (jitter > 0) {
            ctx.translate((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter);
        }
        ctx.rotate(visualAngle);

        // 3. RYSOWANIE ŚCIEŻKI (Path)
        const path = new Path2D();
        const segments = 40; // Ilość segmentów elipsy
        const rxScaled = rx * activationScale;
        const ryScaled = ry * activationScale;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;

            // Standardowa elipsa
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);

            // Promień elipsy w danym kącie
            const rBase = (rxScaled * ryScaled) / Math.sqrt((ryScaled * cos) ** 2 + (rxScaled * sin) ** 2);
            let r = rBase;

            // Deformacje
            let deform = 0;
            // Idle wobble (tylko jeśli tarcza ma energię)
            if (shield.val > 10) {
                deform -= Math.sin(theta * 6 + time * 4) * 2;
            }

            for (const imp of impacts) {
                // Korekta kąta uderzenia względem wizualnej rotacji statku
                const angleCorrection = visualAngle - (entity.angle || 0);
                const correctedImpAngle = imp.localAngle - angleCorrection;

                let diff = Math.abs(theta - correctedImpAngle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;

                if (diff < CONFIG.hitSpread) {
                    const normalizedDist = diff / CONFIG.hitSpread;
                    const wave = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                    deform += (imp.deformation || 10) * imp.life * wave * imp.intensity;
                }
            }

            const edgeNoiseWave = (Math.sin(theta * 8 + time * 2.3) + Math.cos(theta * 11 - time * 1.3)) * (0.35 + hpFactor * 0.35);
            const breakJitter = shield.state === 'breaking' ? Math.sin(time * 25 + theta * 9) * (1 - breakProgress) * 1.8 : 0;
            const activationFray = shield.state === 'activating' ? Math.sin(theta * 14 + time * 10) * (1 - shield.activationProgress) * 2.4 : 0;
            const energyRipple = energyFlash > 0 ? Math.sin(theta * 6 + time * 12) * energyFlash * 1.8 : 0;
            const finalR = Math.max(5, r - deform + edgeNoiseWave + breakJitter + activationFray + energyRipple);
            const px = cos * finalR;
            const py = sin * finalR;

            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);
        }
        path.closePath();

        // 4. WYPEŁNIENIE
        ctx.globalCompositeOperation = 'lighter';
        
        const maxR = Math.max(rxScaled, ryScaled);
        const col = hexToRgb(CONFIG.baseColor);

        // Gradient
        const grad = ctx.createRadialGradient(0, 0, maxR * 0.5, 0, 0, maxR * 1.15);
        grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
        grad.addColorStop(0.7, `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha * 0.35})`);
        grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha})`);

        ctx.fillStyle = grad;
        ctx.fill(path);

        // Global flash przy energii / breaku / aktywacji
        const flashAlpha = (energyFlash * 0.45) + (shield.state === 'breaking' ? (1 - breakProgress) * 0.35 : 0) + (shield.state === 'activating' ? (1 - shield.activationProgress) * 0.45 : 0);
        if (flashAlpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = clamp(flashAlpha, 0, 0.8);
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = CONFIG.hitColor;
            ctx.fill(path);
            ctx.restore();
        }

        // 5. HEX PATTERN (Wzór plastra miodu)
        // Rysujemy tylko, jeśli tarcza jest mocna LUB obrywa
        if ((impacts.length > 0 || hpFactor > 0.8 || shield.state === 'breaking' || shield.state === 'activating') && hexGridTexture) {
            ctx.save();
            ctx.clip(path);
            ctx.globalCompositeOperation = 'source-over';
            const hexStateAlpha = shield.state === 'breaking'
                ? (0.7 + 0.3 * Math.sin(time * 30))
                : (shield.state === 'activating' ? 1.2 : shield.state === 'deactivating' ? 0.6 : 1);
            ctx.globalAlpha = clamp(CONFIG.hexAlpha * alpha * hexStateAlpha, 0, 1);

            const pat = ensureHexPattern();
            const bounds = maxR * 2.5;
            const pxBounds = Math.max(120, bounds * cam.zoom);
            ensureShieldCanvasSize(pxBounds * 1.1);

            if (pat && sCtx && shieldCanvas) {
                const matrix = new DOMMatrix();
                const hexSizeFix = 0.5;
                const shiftSpeed = 18 + energyFlash * 24 + (shield.state === 'breaking' ? 12 : 0);
                const shiftX = Math.sin(time * 0.6) * 14;
                matrix.scaleSelf(hexSizeFix, hexSizeFix);
                matrix.translateSelf(shiftX, time * shiftSpeed);
                pat.setTransform(matrix);

                sCtx.setTransform(1, 0, 0, 1, 0, 0);
                sCtx.globalCompositeOperation = 'source-over';
                sCtx.clearRect(0, 0, shieldCanvas.width, shieldCanvas.height);
                sCtx.globalAlpha = 1;
                sCtx.fillStyle = pat;
                sCtx.fillRect(0, 0, shieldCanvas.width, shieldCanvas.height);

                ctx.drawImage(shieldCanvas, -bounds / 2, -bounds / 2, bounds, bounds);
            }
            ctx.restore();
        }

        // 6. OBRYS (Krawędź)
        ctx.globalCompositeOperation = 'lighter';
        const rimAlpha = clamp(alpha * 2.0 + (shield.state === 'activating' ? 0.5 : 0), 0, 1.2);
        ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${rimAlpha})`;
        ctx.lineWidth = 2.5; // Stała grubość linii w świecie gry
        ctx.stroke(path);
        if (shield.state === 'activating' && rimAlpha > 0.2) {
            ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${rimAlpha * 0.8})`;
            ctx.lineWidth = 4.2;
            ctx.stroke(path);
        }

        // 7. FLASH (Miejsce trafienia)
        if (impacts.length > 0) {
            ctx.globalCompositeOperation = 'source-over';
            for (const imp of impacts) {
                const angleCorrection = visualAngle - (entity.angle || 0);
                const correctedImpAngle = imp.localAngle - angleCorrection;

                const cos = Math.cos(correctedImpAngle);
                const sin = Math.sin(correctedImpAngle);
                
                // Punkt na obwodzie elipsy
                const rHit = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);

                ctx.beginPath();
                ctx.fillStyle = CONFIG.hitColor;
                ctx.globalAlpha = imp.life;
                // Błysk w miejscu uderzenia
                ctx.arc(cos * rHit, sin * rHit, 20 * imp.intensity, 0, Math.PI * 2);
                ctx.fill();

                const smearAlpha = clamp(imp.life * 0.85, 0, 1);
                if (smearAlpha > 0.01) {
                    ctx.save();
                    ctx.globalAlpha = smearAlpha;
                    ctx.fillStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.5)`;
                    ctx.beginPath();
                    ctx.ellipse(cos * rHit * 0.95, sin * rHit * 0.95, 26 * imp.intensity, 14 * imp.intensity, correctedImpAngle, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }
        }

        ctx.restore();

    } catch (e) {
        // Cichy catch, żeby błąd graficzny nie wywalił pętli gry
    }
}
