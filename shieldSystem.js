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
    shieldScale: 1.4     // Tarcza 40% większa od kadłuba
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

    if (!Number.isFinite(bulletX) || !Number.isFinite(bulletY)) return;

    // Kąt uderzenia w świecie gry
    const dx = bulletX - entity.x;
    const dy = bulletY - entity.y;
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
        
        // Nie rysuj jeśli tarcza nie ma MaxHP (np. asteroidy)
        if (!shield.max || shield.max <= 0) return;
        
        // Nie rysuj całkowicie wyczerpanej tarczy, chyba że właśnie oberwała
        const impacts = shield.impacts || [];
        if (shield.val <= 1 && impacts.length === 0) return;

        // 1. POZYCJA NA EKRANIE
        const screenX = (entity.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
        const screenY = (entity.y - cam.y) * cam.zoom + ctx.canvas.height / 2;

        // Culling (nie rysuj tego co poza ekranem)
        if (screenX < -500 || screenX > ctx.canvas.width + 500 || screenY < -500 || screenY > ctx.canvas.height + 500) return;

        // Pobranie wymiarów (W JEDNOSTKACH ŚWIATA)
        const { rx, ry } = getShieldDimensions(entity);

        // Obliczanie Alpha
        const hpFactor = Math.max(0, Math.min(1, shield.val / shield.max));
        const time = performance.now() / 1000;
        const pulse = Math.sin(time * 3.0) * 0.05;
        
        // Bazowa widoczność zależna od HP + minimalna widoczność
        // ZWIĘKSZYŁEM minAlpha, żebyś widział tarczę nawet jak jest słaba
        let alpha = Math.max(0.15, (CONFIG.baseAlpha + pulse) * hpFactor);
        
        // Tarcza jaśnieje przy trafieniu
        if (impacts.length > 0) alpha = Math.min(0.9, alpha + 0.4);

        // Obsługa dodatkowej rotacji sprite'a (dla Capital Ships)
        let visualAngle = entity.angle || 0;
        if (entity.capitalProfile && Number.isFinite(entity.capitalProfile.spriteRotation)) {
            visualAngle += entity.capitalProfile.spriteRotation;
        }

        ctx.save();
        
        // 2. TRANSFORMACJA (Kluczowy moment naprawy)
        ctx.translate(screenX, screenY);
        // SKALUJEMY KONTEKST, NIE PROMIEŃ!
        // Dzięki temu rx/ry są w jednostkach świata, a canvas sam je zmniejsza przy oddaleniu.
        ctx.scale(cam.zoom, cam.zoom);
        ctx.rotate(visualAngle);

        // 3. RYSOWANIE ŚCIEŻKI (Path)
        const path = new Path2D();
        const segments = 40; // Ilość segmentów elipsy
        
        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;
            
            // Standardowa elipsa
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            
            // Promień elipsy w danym kącie
            const rBase = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
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

            const finalR = Math.max(5, r - deform);
            const px = cos * finalR;
            const py = sin * finalR;

            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);
        }
        path.closePath();

        // 4. WYPEŁNIENIE
        ctx.globalCompositeOperation = 'lighter';
        
        const maxR = Math.max(rx, ry);
        const col = hexToRgb(CONFIG.baseColor);
        
        // Gradient
        const grad = ctx.createRadialGradient(0, 0, maxR * 0.5, 0, 0, maxR * 1.15);
        grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
        grad.addColorStop(0.7, `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha * 0.3})`);
        grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha})`);
        
        ctx.fillStyle = grad;
        ctx.fill(path);

        // 5. HEX PATTERN (Wzór plastra miodu)
        // Rysujemy tylko, jeśli tarcza jest mocna LUB obrywa
        if ((impacts.length > 0 || hpFactor > 0.8) && hexGridTexture) {
            ctx.save();
            ctx.clip(path);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = CONFIG.hexAlpha * alpha;

            const pat = ctx.createPattern(hexGridTexture, 'repeat');
            if (pat) {
                const matrix = new DOMMatrix();
                // Ważne: Skalujemy teksturę w dół, bo rysujemy w powiększonym świecie
                // Jeśli tego nie zrobimy, heksy będą ogromne przy zoomie.
                const hexSizeFix = 0.5; 
                matrix.translateSelf(0, time * 20); 
                matrix.scaleSelf(hexSizeFix, hexSizeFix);
                pat.setTransform(matrix);
                
                ctx.fillStyle = pat;
                const bounds = maxR * 2.5;
                ctx.fillRect(-bounds/2, -bounds/2, bounds, bounds);
            }
            ctx.restore();
        }

        // 6. OBRYS (Krawędź)
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha * 2.0})`;
        ctx.lineWidth = 2.5; // Stała grubość linii w świecie gry
        ctx.stroke(path);

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
            }
        }

        ctx.restore();

    } catch (e) {
        // Cichy catch, żeby błąd graficzny nie wywalił pętli gry
    }
}
