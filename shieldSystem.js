// --- SHIELD SYSTEM MODULE ---
// Logika zaawansowanej tarczy energetycznej z efektem heksagonów i deformacji.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.15,     // Bazowa widoczność (zwiększana przez pulsowanie)
    hexAlpha: 0.85,
    hexScale: 16,        // Skala wzoru heksagonalnego
    hitDecayTime: 0.6,   // Czas znikania trafienia
    hitSpread: 1.0,      // Rozlew efektu trafienia
    deformPower: 5,      // Siła wgniecenia
    shieldScale: 1.4     // Mnożnik rozmiaru tarczy względem kadłuba
};

// Cache
let hexGridTexture = null;
let sharedFxCanvas = null;
let sCtx = null;
let W = 0, H = 0;

// --- UTILS ---

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 170, b: 255 }; // Fallback na niebieski
}

// Generowanie tekstury heksagonalnej (seamless)
function generateHexTexture(colorHex, scale) {
    const tileW = 3 * scale; 
    const tileH = Math.round(Math.sqrt(3) * scale);
    
    const s_x = scale;
    const s_y = tileH / Math.sqrt(3);

    // Mały bufor wystarczy do patternu
    const cols = Math.ceil(256 / tileW);
    const rows = Math.ceil(256 / tileH);
    const width = cols * tileW;
    const height = rows * tileH;

    const cvs = document.createElement('canvas');
    cvs.width = width;
    cvs.height = height;
    const c = cvs.getContext('2d');
    
    c.strokeStyle = colorHex;
    c.lineWidth = Math.max(1, scale * 0.15); 
    c.lineCap = 'round';
    c.globalAlpha = 1.0;

    const xStep = 1.5 * s_x;
    const yStep = tileH;

    c.beginPath();
    for (let col = -1; col <= cols * 2; col++) {
        for (let row = -1; row <= rows; row++) {
            const xOffset = col * xStep;
            const yOffset = row * yStep + (col % 2 === 0 ? 0 : yStep / 2);
            
            for (let i = 0; i < 6; i++) {
                const angle = 2 * Math.PI / 6 * i;
                const x = xOffset + s_x * Math.cos(angle);
                const y = yOffset + s_y * Math.sin(angle);
                if (i === 0) c.moveTo(x, y);
                else c.lineTo(x, y);
            }
            c.closePath();
        }
    }
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
    // Tworzymy współdzielony canvas do efektów (offscreen)
    if (!sharedFxCanvas) {
        sharedFxCanvas = document.createElement('canvas');
        sCtx = sharedFxCanvas.getContext('2d', { alpha: true });
    }
    if (sharedFxCanvas.width !== width || sharedFxCanvas.height !== height) {
        sharedFxCanvas.width = width;
        sharedFxCanvas.height = height;
    }
}

// --- LOGIC ---

export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity.shield) return;
    if (!entity.shield.impacts) entity.shield.impacts = [];

    // Kąt trafienia w świecie gry
    const dx = bulletX - entity.x;
    const dy = bulletY - entity.y;
    const angle = Math.atan2(dy, dx); 

    // Konwersja na kąt lokalny (względem obrotu statku)
    // Dzięki temu uderzenie "obraca się" razem ze statkiem
    const localAngle = angle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle, 
        life: 1.0,
        intensity: Math.min(1.5, Math.max(0.5, damage / 20)),
        deformation: CONFIG.deformPower * (damage / 40)
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
    const shield = entity.shield;
    // Nie rysuj jeśli tarcza nie istnieje, jest zniszczona lub ma 0 maxHP
    if (!shield || shield.val <= 0 || !shield.max) return;
    
    const impacts = shield.impacts || [];
    const hpFactor = shield.val / shield.max;

    // Obliczanie wymiarów (z fallbackiem dla statków bez w/h)
    const baseW = entity.w || entity.radius * 2 || 40;
    const baseH = entity.h || entity.radius * 2 || 40;
    
    // Wymiary tarczy w świecie gry
    const length = baseW * CONFIG.shieldScale;
    const width = baseH * CONFIG.shieldScale;
    
    // Pozycja na ekranie
    const screenX = (entity.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
    const screenY = (entity.y - cam.y) * cam.zoom + ctx.canvas.height / 2;
    const zoom = cam.zoom;

    // Promienie ekranowe
    const rx = (length / 2) * zoom;
    const ry = (width / 2) * zoom;
    const maxR = Math.max(rx, ry);

    // Culling - nie rysuj poza ekranem
    if (screenX < -maxR || screenX > W + maxR || screenY < -maxR || screenY > H + maxR) return;

    // --- Efekt "życia" tarczy (pulsowanie) ---
    const time = performance.now() / 1000;
    const pulse = Math.sin(time * 2.5) * 0.05;
    // Bazowa widoczność zależna od stanu naładowania + puls
    const currentAlpha = Math.max(0.05, (CONFIG.baseAlpha + pulse) * hpFactor);

    // --- KROK 1: Obliczanie kształtu (Deformacja) ---
    const segments = 45; // Optymalizacja: mniej segmentów
    const path = new Path2D();
    const rotation = entity.angle || 0;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(rotation);

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 - Math.PI; 
        
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        // Promień elipsy w danym kącie
        let r = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);

        // Deformacja
        let totalDeform = 0;
        // Idle wobble
        totalDeform -= Math.sin(theta * 5 + time * 3) * (1.5 * zoom); 

        for (const imp of impacts) {
            let diff = Math.abs(theta - imp.localAngle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            
            if (diff < CONFIG.hitSpread) {
                const normalizedDist = diff / CONFIG.hitSpread;
                const waveShape = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                const power = imp.deformation * zoom * imp.life * waveShape * imp.intensity;
                totalDeform += power;
            }
        }

        const finalR = Math.max(0, r - totalDeform);
        const px = cos * finalR;
        const py = sin * finalR;

        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
    }
    path.closePath();

    // --- KROK 2: Wypełnienie bazowe (Lighter blending = Energy look) ---
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.clip(path);
    
    const col = hexToRgb(CONFIG.baseColor);
    const grad = ctx.createRadialGradient(0, 0, maxR * 0.5, 0, 0, maxR);
    
    // Delikatny środek, mocniejsza krawędź
    grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
    grad.addColorStop(0.7, `rgba(${col.r}, ${col.g}, ${col.b}, ${currentAlpha * 0.4})`);
    grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${currentAlpha * 1.2})`);
    
    ctx.fillStyle = grad;
    ctx.fill();

    // --- KROK 3: Efekt Hexów (Tylko przy trafieniach) ---
    if (impacts.length > 0 && hexGridTexture && sCtx) {
        // Obszar roboczy do wyczyszczenia (kwadrat wokół tarczy)
        // Musi być całkowity i parzysty dla wydajności
        const clearSize = Math.ceil(maxR * 2.5);
        
        // Zapisz stan offscreen canvasa
        sCtx.save();
        // Reset transformacji, żeby czyścić w układzie ekranu (absolutnym)
        sCtx.setTransform(1, 0, 0, 1, 0, 0); 
        
        // Czyścimy tylko prostokąt, w którym będziemy rysować
        // Uwaga: używamy screenX/Y jako środka
        const drawX = screenX;
        const drawY = screenY;
        
        sCtx.clearRect(drawX - clearSize/2, drawY - clearSize/2, clearSize, clearSize);
        
        // Ustawiamy transformację taką samą jak statku
        sCtx.translate(drawX, drawY);
        sCtx.rotate(rotation);

        // 1. Rysujemy "światła" (maski) w miejscach trafień
        for (const imp of impacts) {
            const flashX = Math.cos(imp.localAngle) * rx;
            const flashY = Math.sin(imp.localAngle) * ry;
            
            const spreadPx = 120 * CONFIG.hitSpread * zoom;
            const hitGrad = sCtx.createRadialGradient(flashX, flashY, 0, flashX, flashY, spreadPx);
            
            const intensity = imp.life * CONFIG.hexAlpha * 2.5; // Mocniejszy błysk
            hitGrad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
            hitGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
            
            sCtx.fillStyle = hitGrad;
            sCtx.beginPath();
            sCtx.arc(flashX, flashY, spreadPx, 0, Math.PI*2);
            sCtx.fill();
        }

        // 2. Nakładamy wzór heksagonów (destination-in wycina wszystko poza wzorem)
        sCtx.globalCompositeOperation = 'destination-in';
        
        const pat = sCtx.createPattern(hexGridTexture, 'repeat');
        const matrix = new DOMMatrix();
        // Skalujemy hexy zależnie od zoomu, żeby nie znikały
        const hexZoom = Math.max(0.5, zoom);
        matrix.scaleSelf(hexZoom, hexZoom);
        matrix.translateSelf(time * 20, time * 10); // Animacja przesuwu
        pat.setTransform(matrix);

        sCtx.fillStyle = pat;
        sCtx.fillRect(-clearSize/2, -clearSize/2, clearSize, clearSize);
        sCtx.restore();

        // 3. Kopiujemy gotowy efekt na główny canvas
        // Jesteśmy wewnątrz ctx.translate/rotate, więc musimy to uwzględnić
        // Najbezpieczniej: zresetować transformację głównego ctx na moment rysowania obrazka
        ctx.restore(); // Wychodzimy z clipa i transformacji statku
        ctx.save();    // Nowy save dla blitowania
        
        ctx.globalCompositeOperation = 'lighter';
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset do układu ekranu
        
        // Rysujemy wycinek z sharedFxCanvas odpowiadający pozycji statku
        const sx = drawX - clearSize/2;
        const sy = drawY - clearSize/2;
        
        ctx.drawImage(sharedFxCanvas, sx, sy, clearSize, clearSize, sx, sy, clearSize, clearSize);
        
        ctx.restore(); 
        
        // Musimy przywrócić transformację statku dla rysowania obrysu (Step 4)
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(rotation);
    } else {
        ctx.restore(); // Zamknięcie clipa jeśli nie było hexów
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(rotation);
    }

    // --- KROK 4: Krawędź (Stroke) ---
    // Ponownie używamy lighter dla efektu energetycznego
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${currentAlpha * 2.5})`;
    ctx.lineWidth = 1.5 * zoom;
    ctx.stroke(path);

    // Jasne błyski na krawędzi w miejscu trafienia
    if (impacts.length > 0) {
        for (const imp of impacts) {
            ctx.beginPath();
            // Mały łuk w miejscu trafienia
            const arcLen = CONFIG.hitSpread * 0.5; 
            
            // Rysowanie całego obwodu jest prostsze i wygląda dobrze jako "wzbudzenie"
            ctx.strokeStyle = CONFIG.hitColor;
            ctx.lineWidth = 2.5 * zoom * imp.life;
            ctx.globalAlpha = imp.life * 0.8;
            ctx.stroke(path); 
        }
    }

    ctx.restore();
}
