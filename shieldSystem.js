// --- SHIELD SYSTEM MODULE ---
// Wersja Standalone: Sama oblicza pozycję na ekranie.
// Naprawia: Niewidoczną tarczę (rysowanie w złym miejscu) i słabą widoczność.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.2,      // Zwiększone dla lepszej widoczności
    minAlpha: 0.1,       // Minimalna widoczność (nawet przy 1% HP)
    hexAlpha: 0.6,
    hexScale: 24,
    hitDecayTime: 0.6,
    hitSpread: 0.8,
    deformPower: 8,
    shieldScale: 1.6
};

// Cache tekstury
let hexGridTexture = null;
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
    const s = Math.max(4, scale || 16);
    const tileW = 3 * s;
    const tileH = Math.sqrt(3) * s; 
    
    const cvs = document.createElement('canvas');
    cvs.width = Math.ceil(tileW);
    cvs.height = Math.ceil(tileH * 2);
    const c = cvs.getContext('2d');
    
    c.strokeStyle = colorHex || '#00aaff';
    c.lineWidth = Math.max(1, s * 0.1); 
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = 0.8;

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

    drawHexPart(0, 0);
    drawHexPart(tileW, 0);
    drawHexPart(tileW * 0.5, tileH);
    drawHexPart(0, tileH * 2);
    drawHexPart(tileW, tileH * 2);

    c.stroke();
    return cvs;
}

// --- INIT ---
export function initShieldSystem(width, height) {
    resizeShieldSystem(width, height);
    if (!hexGridTexture) {
        hexGridTexture = generateHexTexture(CONFIG.baseColor, CONFIG.hexScale);
    }
}

export function resizeShieldSystem(width, height) {
    W = width;
    H = height;
}

// --- LOGIC ---

export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity || !entity.shield) return;
    if (!entity.shield.impacts) entity.shield.impacts = [];

    if (!Number.isFinite(bulletX) || !Number.isFinite(bulletY) || !Number.isFinite(damage)) return;

    const dx = bulletX - entity.x;
    const dy = bulletY - entity.y;
    let angle = Math.atan2(dy, dx);
    if (!Number.isFinite(angle)) angle = 0;

    const localAngle = angle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle,
        life: 1.0,
        intensity: Math.min(2.0, Math.max(0.5, damage / 15)),
        deformation: CONFIG.deformPower * (damage / 50)
    });
}

export function updateShieldFx(entity, dt) {
    if (!entity.shield || !entity.shield.impacts) return;
    for (let i = entity.shield.impacts.length - 1; i >= 0; i--) {
        const imp = entity.shield.impacts[i];
        imp.life -= dt / CONFIG.hitDecayTime;
        if (imp.life <= 0) {
            entity.shield.impacts.splice(i, 1);
        }
    }
}

// --- RENDER ---

export function drawShield(ctx, entity, cam) {
    try {
        const shield = entity.shield;
        // Rysujemy nawet przy małym HP, żebyś widział efekt
        if (!shield || shield.max <= 0) return;
        if (shield.val <= 0.1 && (!shield.impacts || shield.impacts.length === 0)) return;

        const hpFactor = Math.max(0, Math.min(1, shield.val / shield.max));
        const impacts = shield.impacts || [];

        // 1. OBLICZANIE POZYCJI EKRANOWEJ
        // To jest kluczowe: Przeliczamy pozycję ze świata gry na ekran
        const screenX = (entity.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
        const screenY = (entity.y - cam.y) * cam.zoom + ctx.canvas.height / 2;

        // Culling (optymalizacja)
        const cullR = 300 * cam.zoom;
        if (screenX < -cullR || screenX > ctx.canvas.width + cullR ||
            screenY < -cullR || screenY > ctx.canvas.height + cullR) return;

        // Wymiary
        const baseW = (Number.isFinite(entity.w) && entity.w > 0) ? entity.w : (entity.radius * 2 || 40);
        const baseH = (Number.isFinite(entity.h) && entity.h > 0) ? entity.h : (entity.radius * 2 || 40);

        // Skalowanie tarczy względem zoomu kamery
        const rx = (baseW / 2) * CONFIG.shieldScale * cam.zoom;
        const ry = (baseH / 2) * CONFIG.shieldScale * cam.zoom;
        
        const time = performance.now() / 1000;
        const pulse = Math.sin(time * 2.0) * 0.05;
        
        // Gwarantujemy minimalną widoczność (CONFIG.minAlpha)
        let alpha = Math.max(CONFIG.minAlpha, (CONFIG.baseAlpha + pulse) * hpFactor);
        
        // Zwiększ widoczność przy trafieniu
        const hitIntensity = impacts.reduce((sum, imp) => sum + imp.life, 0);
        const activeAlpha = Math.min(0.8, alpha + hitIntensity * 0.3);

        ctx.save();
        
        // 2. TRANSFORMACJA CONTEXTU
        ctx.translate(screenX, screenY);
        ctx.rotate(entity.angle || 0);
        // Nie robimy ctx.scale(zoom), bo już przeskalowaliśmy rx/ry wyżej (dla lepszej kontroli obrysu)

        // 3. RYSOWANIE KSZTAŁTU
        const segments = 40; 
        const path = new Path2D();

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            
            const rBase = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
            let r = rBase;

            let totalDeform = 0;
            totalDeform -= Math.sin(theta * 6 + time * 3) * (2 * cam.zoom); 

            for (const imp of impacts) {
                let diff = Math.abs(theta - imp.localAngle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff; 

                if (diff < CONFIG.hitSpread) {
                    const normalizedDist = diff / CONFIG.hitSpread;
                    const waveShape = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                    const deform = (imp.deformation || 5) * cam.zoom * imp.life * waveShape * (imp.intensity || 1);
                    if (Number.isFinite(deform)) {
                        totalDeform += deform;
                    }
                }
            }

            const finalR = Math.max(2 * cam.zoom, r - totalDeform);
            const px = cos * finalR;
            const py = sin * finalR;

            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);
        }
        path.closePath();

        // 4. WYPEŁNIENIE
        ctx.globalCompositeOperation = 'lighter';
        
        const maxR = Math.max(rx, ry);
        if (maxR > 0) {
            const col = hexToRgb(CONFIG.baseColor);
            const grad = ctx.createRadialGradient(0, 0, maxR * 0.6, 0, 0, maxR * 1.1);
            grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
            grad.addColorStop(0.8, `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha * 0.5})`);
            grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha})`);
            ctx.fillStyle = grad;
            ctx.fill(path);
        }

        // 5. HEX PATTERN
        if ((impacts.length > 0 || shield.val > shield.max * 0.9) && hexGridTexture) {
            ctx.save();
            ctx.clip(path);
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = CONFIG.hexAlpha * (impacts.length > 0 ? 1 : 0.3) * activeAlpha;

            const pat = ctx.createPattern(hexGridTexture, 'repeat');
            if (pat) {
                const matrix = new DOMMatrix();
                // Przesuwamy i skalujemy pattern
                const hexZoom = Math.max(0.3, cam.zoom * 0.7);
                matrix.translateSelf(0, time * 20); 
                matrix.scaleSelf(hexZoom, hexZoom);
                pat.setTransform(matrix);
                
                ctx.fillStyle = pat;
                ctx.fillRect(-maxR * 1.5, -maxR * 1.5, maxR * 3, maxR * 3);
            }
            ctx.restore();
        }

        // 6. STROKE
        ctx.globalCompositeOperation = 'lighter';
        const col = hexToRgb(CONFIG.baseColor);
        ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha * 1.5})`;
        ctx.lineWidth = Math.max(1, 2.5 * cam.zoom * hpFactor);
        ctx.stroke(path);

        // 7. FLASH (TRAFIENIA)
        if (impacts.length > 0) {
            ctx.globalCompositeOperation = 'source-over';
            for (const imp of impacts) {
                const cos = Math.cos(imp.localAngle);
                const sin = Math.sin(imp.localAngle);
                const rHit = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
                
                ctx.beginPath();
                ctx.fillStyle = CONFIG.hitColor;
                ctx.globalAlpha = imp.life * 0.9;
                ctx.arc(cos * rHit, sin * rHit, 20 * imp.intensity * cam.zoom, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();

    } catch (e) {
        console.warn("Shield render error:", e);
        ctx.restore();
    }
}
