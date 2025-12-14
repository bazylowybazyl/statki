// --- SHIELD SYSTEM MODULE ---
// Wersja: Playground Port (Smooth + Penetration Break)
// Status: Przywrócono logikę i wygląd 1:1 z Twojego Shield Playground.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.15,     // Subtelna baza jak w playground
    hexAlpha: 0.65,      // Wyraźne heksy
    hexScale: 11,        // Skala 11 (idealna z playground)
    hitDecayTime: 0.6,
    hitSpread: 1.0,      // Szeroka fala uderzeniowa
    deformPower: 9,      // Siła deformacji
    shieldScale: 2.0,    // Tarcza 2x większa od kadłuba
    activationDuration: 0.45,
    deactivationDuration: 0.55,
    breakDuration: 0.8
};

// Cache tekstury
let hexGridTexture = null;
let hexPattern = null;
let shieldCanvas = null; // Offscreen canvas do efektów maskowania
let sCtx = null;
let W = 0, H = 0;

// --- UTILS (Z Playground) ---

function hexToRgb(hex) {
    if (typeof hex !== 'string') return { r: 0, g: 170, b: 255 };
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 170, b: 255 };
}

function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const n = Math.max(0, Math.min(1, x)) - 1;
    return 1 + c3 * Math.pow(n, 3) + c1 * Math.pow(n, 2);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// --- TEXTURE GENERATOR (Seamless z Playground) ---
function generateHexTexture(colorHex, scale) {
    // Logika z Playground dla idealnego tilingu
    const tileW = 3 * scale; 
    const tileH = Math.round(Math.sqrt(3) * scale); 
    
    const s_x = scale;
    const s_y = tileH / Math.sqrt(3);

    // Canvas musi obejmować pełny kafel powtarzalny
    const width = Math.ceil(tileW);
    const height = Math.ceil(tileH * 2);

    const cvs = document.createElement('canvas');
    cvs.width = width;
    cvs.height = height;
    const c = cvs.getContext('2d');
    
    c.strokeStyle = colorHex || '#00aaff';
    c.lineWidth = Math.max(1, scale * 0.15); 
    c.lineCap = 'round';
    c.globalAlpha = 1.0;

    const xStep = 1.5 * s_x;
    const yStep = tileH;

    c.beginPath();
    // Rysujemy siatkę z lekkim marginesem, żeby złapać krawędzie
    for (let col = -1; col <= 2; col++) {
        for (let row = -1; row <= 3; row++) {
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

// --- INIT & RESIZE ---

export function initShieldSystem(width, height) {
    resizeShieldSystem(width, height);
    if (!hexGridTexture) {
        hexGridTexture = generateHexTexture(CONFIG.baseColor, CONFIG.hexScale);
    }
}

export function resizeShieldSystem(width, height) {
    W = width;
    H = height;
    // Offscreen canvas dla patternu (żeby go ładnie obracać)
    if (!shieldCanvas) {
        shieldCanvas = document.createElement('canvas');
        sCtx = shieldCanvas.getContext('2d');
    }
}

function ensureShieldCanvasSize(size) {
    // Zwiększamy bufor, żeby przy zoomie pattern był ostry
    const needed = Math.ceil(size);
    if (shieldCanvas.width < needed || shieldCanvas.height < needed) {
        shieldCanvas.width = needed;
        shieldCanvas.height = needed;
    }
}

function getEntityPosition(entity) {
    if (!entity) return { x: 0, y: 0 };
    const x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
    const y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
    return { x: x || 0, y: y || 0 };
}

function ensureShieldRuntime(shield) {
    shield.state = shield.state || (shield.val > 0 ? 'activating' : 'off');
    shield.activationProgress = Number.isFinite(shield.activationProgress) ? shield.activationProgress : 0;
    shield.currentAlpha = Number.isFinite(shield.currentAlpha) ? shield.currentAlpha : 0;
    shield.breakTimer = Number.isFinite(shield.breakTimer) ? shield.breakTimer : 0;
    shield.energyShotTimer = Number.isFinite(shield.energyShotTimer) ? shield.energyShotTimer : 0;
    shield.energyShotDuration = 0.5;
    shield.impacts = shield.impacts || [];
}

// --- LOGIC ---

export function triggerEnergyShot(entity) {
    if (!entity || !entity.shield) return;
    const shield = entity.shield;
    ensureShieldRuntime(shield);

    if (shield.state === 'off' || shield.state === 'deactivating') {
        shield.state = 'active';
        shield.activationProgress = 1.0;
        shield.currentAlpha = 1.0;
    }
    
    // Leczenie + boost wizualny
    if (Number.isFinite(shield.max)) {
        shield.val = Math.min(shield.max, shield.val + shield.max * 0.5);
    }
    shield.energyShotTimer = shield.energyShotDuration;
}

function breakShield(shield) {
    ensureShieldRuntime(shield);
    if (shield.state === 'breaking') return;
    
    shield.state = 'breaking';
    shield.breakTimer = CONFIG.breakDuration;
    shield.val = 0;
    shield.currentAlpha = 1.0;
}

export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity || !entity.shield) return;
    ensureShieldRuntime(entity.shield);
    const shield = entity.shield;

    if (shield.state === 'off' || shield.state === 'breaking') return;

    const pos = getEntityPosition(entity);
    
    // Obliczamy kąt w świecie
    const dx = bulletX - pos.x;
    const dy = bulletY - pos.y;
    const worldAngle = Math.atan2(dy, dx);
    
    // Konwersja na kąt lokalny względem obrotu statku
    // Dzięki temu fala "przykleja się" do tarczy gdy statek się obraca
    const localAngle = worldAngle - (entity.angle || 0);

    shield.impacts.push({
        localAngle: localAngle,
        life: 1.0,
        intensity: Math.min(2.5, Math.max(0.5, damage / 10)),
        deformation: CONFIG.deformPower // Siła wgniecenia
    });

    // Iskry (korzystamy z silnika gry spawnParticle)
    if (typeof window.spawnParticle === 'function') {
        const { rx, ry } = getShieldDimensions(entity);
        // Punkt uderzenia na elipsie
        const impactRot = (entity.angle || 0) + localAngle;
        const cos = Math.cos(impactRot);
        const sin = Math.sin(impactRot);
        const rHit = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
        const hitX = pos.x + cos * rHit;
        const hitY = pos.y + sin * rHit;

        // Iskry jak w playground (białe, szybkie)
        for (let i = 0; i < 5; i++) {
            const spread = (Math.random() - 0.5) * 1.5;
            const dir = impactRot + spread;
            const speed = 100 + Math.random() * 200;
            // spawnParticle(pos, vel, life, color, size, flash)
            window.spawnParticle(
                { x: hitX, y: hitY },
                { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
                0.3 + Math.random() * 0.2,
                CONFIG.hitColor, // Białe iskry
                2.5,
                true
            );
        }
    }

    if (shield.val <= 0 && shield.state !== 'breaking') {
        breakShield(shield);
    }
}

export function updateShieldFx(entity, dt) {
    if (!entity.shield) return;
    const shield = entity.shield;
    ensureShieldRuntime(shield);

    // Energy shot timer
    if (shield.energyShotTimer > 0) {
        shield.energyShotTimer -= dt;
    }

    // State machine
    if (shield.state === 'activating') {
        shield.activationProgress += dt / CONFIG.activationDuration;
        if (shield.activationProgress >= 1.0) {
            shield.state = 'active';
            shield.activationProgress = 1.0;
        }
    } 
    else if (shield.state === 'deactivating') {
        shield.activationProgress -= dt / CONFIG.deactivationDuration;
        if (shield.activationProgress <= 0) {
            shield.state = 'off';
            shield.activationProgress = 0;
            shield.currentAlpha = 0;
        }
    }
    else if (shield.state === 'breaking') {
        shield.breakTimer -= dt;
        // Miganie przy pękaniu
        shield.currentAlpha = (shield.breakTimer / CONFIG.breakDuration) * (Math.random() > 0.5 ? 1 : 0.2);
        if (shield.breakTimer <= 0) {
            shield.state = 'off';
            shield.currentAlpha = 0;
        }
    }
    else if (shield.state === 'off' && shield.val > 1) {
        // Auto-reaktywacja jeśli HP wróciło
        shield.state = 'activating';
        shield.activationProgress = 0;
    }

    // Aktualizacja uderzeń
    for (let i = shield.impacts.length - 1; i >= 0; i--) {
        const imp = shield.impacts[i];
        imp.life -= dt / CONFIG.hitDecayTime;
        if (imp.life <= 0) shield.impacts.splice(i, 1);
    }
}

function getShieldDimensions(entity) {
    // Logika wymiarów z gry
    let w = entity.w || (entity.radius * 2) || 40;
    let h = entity.h || (entity.radius * 2) || 40;

    if (entity.capitalProfile) {
        const baseR = entity.radius || 20;
        const len = baseR * (entity.capitalProfile.lengthScale || 3.2);
        const wid = baseR * (entity.capitalProfile.widthScale || 1.2);
        w = Math.max(w, len);
        h = Math.max(h, wid);
    } 
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

// --- RENDER (Core logic from Playground) ---

export function drawShield(ctx, entity, cam) {
    const shield = entity.shield;
    if (!shield || shield.state === 'off') return;
    ensureShieldRuntime(shield);

    // Pozycja i Zoom
    const pos = getEntityPosition(entity);
    const screenX = (pos.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
    const screenY = (pos.y - cam.y) * cam.zoom + ctx.canvas.height / 2;

    // Culling
    if (screenX < -500 || screenX > ctx.canvas.width + 500 || screenY < -500 || screenY > ctx.canvas.height + 500) return;

    // Wymiary
    const { rx, ry } = getShieldDimensions(entity);
    const time = performance.now() / 1000;

    // --- LOGIKA ANIMACJI (Playground style) ---
    
    // Alive Effect (pulsowanie)
    const pulse = Math.sin(time * 2) * 0.03; 
    let baseAlpha = clamp(CONFIG.baseAlpha + pulse, 0.05, 0.4);
    let currentAlpha = shield.currentAlpha;
    let scaleModifier = 1.0;

    // Energy Shot Effect
    let energyShotIntensity = 0;
    if (shield.energyShotTimer > 0) {
        const t = shield.energyShotTimer / shield.energyShotDuration;
        energyShotIntensity = Math.sin(t * Math.PI);
        baseAlpha += energyShotIntensity * 0.6;
        scaleModifier += energyShotIntensity * 0.15;
    }

    // Activation Bubble Logic
    let activationDeform = 0;
    if (shield.state === 'activating') {
        const progress = Math.min(1, shield.activationProgress);
        scaleModifier = easeOutBack(progress);
        const noise = Math.sin(time * 20) * Math.cos(time * 15 + Math.PI/2);
        activationDeform = noise * (1 - progress) * 15; 
        baseAlpha = Math.max(baseAlpha, 0.3);
    }

    let jitterScale = 1.0;
    if (shield.state === 'deactivating') {
        scaleModifier *= shield.activationProgress; // Shrink
        if (Math.random() < 0.2) jitterScale = 0.9 + Math.random() * 0.2;
    }

    // Rotacja wizualna (dla Capital Ships)
    let visualAngle = entity.angle || 0;
    if (entity.capitalProfile && Number.isFinite(entity.capitalProfile.spriteRotation)) {
        visualAngle += entity.capitalProfile.spriteRotation;
    }

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.scale(cam.zoom, cam.zoom); // Skalowanie świata
    ctx.scale(jitterScale * scaleModifier, jitterScale * scaleModifier); // Animacja tarczy
    ctx.rotate(visualAngle);

    // --- KROK 1: Obliczanie kształtu tarczy (Deformacja) ---
    // WAŻNE: 120 segmentów dla idealnej gładkości (było 40 w zepsutej wersji)
    const segments = 120;
    const path = new Path2D();
    const points = []; // Do rysowania obwódki falującej

    const breakJitter = (shield.state === 'breaking') ? 10 : 0;
    let shouldBreak = false; // Flag penetracji

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 - Math.PI; 
        
        // Promień elipsy w danym kącie
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        let r = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
        
        let totalDeform = 0;
        
        // Edge Wobble (Idle)
        const wobble = Math.sin(theta * 6 + time * 3) * 1.5 + Math.cos(theta * 4 - time * 2) * 1.5;
        totalDeform -= wobble;

        // Activation Wobble
        if (shield.state === 'activating') {
            const angleNoise = Math.sin(theta * 5 + time * 20) * Math.cos(theta * 3 - time * 10);
            totalDeform -= angleNoise * activationDeform;
        }

        // Impacts Deformations
        for (const imp of shield.impacts) {
            // Korekta kąta uderzenia do układu lokalnego (wizualnego)
            // imp.localAngle jest względem entity.angle.
            // visualAngle to entity.angle + spriteRotation.
            // theta jest w układzie visualAngle.
            // Musimy dopasować imp.localAngle do theta.
            const spriteRot = (entity.capitalProfile?.spriteRotation || 0);
            const impAngleVisual = imp.localAngle - spriteRot;

            let diff = Math.abs(theta - impAngleVisual);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            
            if (diff < CONFIG.hitSpread) {
                const normalizedDist = diff / CONFIG.hitSpread;
                const waveShape = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                const power = (imp.deformation || CONFIG.deformPower) * imp.life * waveShape * imp.intensity;
                totalDeform += power;
            }
        }
        
        if (breakJitter > 0) totalDeform += (Math.random() - 0.5) * breakJitter;

        // --- PENETRATION CHECK (Kluczowe z Playground) ---
        // Jeśli deformacja wgniecie tarczę do środka -> PĘKNIĘCIE
        let deformedR = r - totalDeform;
        if (deformedR <= 5 && shield.state === 'active') { // 5px marginesu bezpieczeństwa
            shouldBreak = true;
            deformedR = 0; 
        } else {
            deformedR = Math.max(0, deformedR); 
        }

        const px = Math.cos(theta) * deformedR;
        const py = Math.sin(theta) * deformedR;
        
        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
        points.push({x: px, y: py});
    }
    path.closePath();

    // Trigger logicznego pęknięcia (poza renderem, ale wywołany stanem)
    if (shouldBreak) {
        breakShield(shield);
    }

    // --- KROK 2: Rysowanie Wypełnienia ---
    ctx.save();
    ctx.clip(path);

    const isBreaking = shield.state === 'breaking';
    const showHex = (shield.impacts.length > 0 || isBreaking || shield.state === 'activating' || energyShotIntensity > 0.1);
    const col = hexToRgb(isBreaking ? '#ffffff' : CONFIG.baseColor);

    // A. Fresnel (Baza - Gładka)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseAlpha * currentAlpha; 
    
    const maxR = Math.max(rx, ry);
    const grad = ctx.createRadialGradient(0, 0, maxR * 0.5, 0, 0, maxR);
    grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
    grad.addColorStop(0.8, `rgba(${col.r}, ${col.g}, ${col.b}, 0.2)`);
    grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0.8)`);
    
    ctx.fillStyle = grad;
    // Rysujemy po całym bounding boxie
    ctx.fillRect(-maxR*1.5, -maxR*1.5, maxR*3, maxR*3);

    // B. HEX PATTERN (Tylko przy aktywności)
    if (showHex && hexGridTexture) {
        // Przygotuj offscreen canvas jeśli za mały
        // Skalujemy pattern względem zoomu, żeby nie był gigantyczny na ekranie
        const patternScale = 0.5; // Stała skala patternu dla ostrości
        const bounds = maxR * 2.5;
        const pxBounds = Math.max(128, bounds * patternScale); 
        ensureShieldCanvasSize(pxBounds);

        // Pattern Draw
        const matrix = new DOMMatrix();
        matrix.scaleSelf(patternScale, patternScale);
        matrix.translateSelf(time * 15, time * 10); // Przesuwanie tła
        
        if (!hexPattern) {
            hexPattern = sCtx.createPattern(hexGridTexture, 'repeat');
        }
        
        if (hexPattern) {
            hexPattern.setTransform(matrix);
            sCtx.globalCompositeOperation = 'source-over';
            sCtx.clearRect(0, 0, shieldCanvas.width, shieldCanvas.height);
            
            // Rysujemy pattern w offscreen
            sCtx.fillStyle = hexPattern;
            sCtx.fillRect(0, 0, shieldCanvas.width, shieldCanvas.height);
            
            // Maskowanie uderzeniami (Local Flash)
            if (shield.impacts.length > 0 && !isBreaking) {
                // Czyścimy pattern tam gdzie NIE ma uderzeń (maska odwrotna)
                // W playground było to inaczej, tutaj zrobimy prościej:
                // Rysujemy pattern z alpha zależną od stanu
            }
            
            // Rysujemy pattern na tarczy
            const hexAlpha = isBreaking ? 0.8 : CONFIG.hexAlpha;
            ctx.globalAlpha = hexAlpha * currentAlpha;
            ctx.globalCompositeOperation = 'source-over'; // Nakładamy na gradient
            // Draw image skaluje canvas z patternem
            ctx.drawImage(shieldCanvas, -bounds/2, -bounds/2, bounds, bounds);
        }
    }

    // C. Energy Flash (Cała tarcza na biało przy strzale/break)
    if (energyShotIntensity > 0.01 || isBreaking) {
        const flashInt = isBreaking ? (shield.breakTimer/CONFIG.breakDuration) : energyShotIntensity;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = flashInt * 0.6;
        ctx.fill(path); // Wypełnij jeszcze raz na biało
    }

    ctx.restore(); // Koniec clipa

    // --- KROK 3: Krawędzie (Stroke) ---
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const rimAlpha = Math.min(1, baseAlpha * 2.5 * currentAlpha);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${rimAlpha})`;
    ctx.stroke(path);

    // Highlight edge during activation
    if (shield.state === 'activating') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.6)`; 
        ctx.stroke(path);
    }

    // --- KROK 4: IMPACT RIMS (Fale na obwodzie) ---
    ctx.globalCompositeOperation = 'lighter';
    for (const imp of shield.impacts) {
        ctx.beginPath();
        const spreadRad = CONFIG.hitSpread * 0.8;
        let drawing = false;
        
        // Korekta kąta dla rysowania fali
        const spriteRot = (entity.capitalProfile?.spriteRotation || 0);
        const impAngleVisual = imp.localAngle - spriteRot;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;
            let diff = Math.abs(theta - impAngleVisual);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;

            if (diff < spreadRad) {
                if (!drawing) {
                    ctx.moveTo(points[i].x, points[i].y);
                    drawing = true;
                } else {
                    ctx.lineTo(points[i].x, points[i].y);
                }
            } else {
                drawing = false;
            }
        }
        
        const strokeColor = isBreaking ? '#ffffff' : CONFIG.hitColor;
        ctx.lineCap = 'round';
        ctx.lineWidth = 3 * imp.life; 
        ctx.strokeStyle = strokeColor;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = 10 * imp.life; // Glow
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // --- KROK 5: IMPACT SPOT (Świetlisty punkt zamiast bąbla) ---
        // Rysujemy to tutaj, w kontekście transformacji
        if (imp.life > 0.1) {
            const hitR = Math.max(rx, ry); // Uproszczenie dla gradientu
            const cos = Math.cos(impAngleVisual);
            const sin = Math.sin(impAngleVisual);
            // Pozycja na zdeformowanej krawędzi (przybliżona)
            // Używamy oryginalnego promienia elipsy minus deformacja w centrum uderzenia
            const rBase = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
            const rDef = rBase - (imp.deformation || 0) * imp.life * imp.intensity;
            const lx = cos * rDef;
            const ly = sin * rDef;

            // Gradient radialny (Światło)
            const spotSize = 40 * imp.intensity;
            const gSpot = ctx.createRadialGradient(lx, ly, 0, lx, ly, spotSize);
            gSpot.addColorStop(0, CONFIG.hitColor);
            gSpot.addColorStop(0.3, `rgba(${col.r}, ${col.g}, ${col.b}, 0.5)`);
            gSpot.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
            
            ctx.fillStyle = gSpot;
            ctx.beginPath();
            ctx.arc(lx, ly, spotSize, 0, Math.PI*2);
            ctx.fill();
        }
    }
    
    ctx.restore(); // Koniec stroke composite
    ctx.restore(); // Koniec transformacji
}
