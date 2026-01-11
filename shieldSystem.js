// --- SHIELD SYSTEM MODULE ---
// Wersja: Fixed Visuals (Smoothness + Original Impact FX)

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#00e5ff',
    baseAlpha: 0.35,
    hexAlpha: 0.55,       // Nieco wyraźniejsze heksy jak w oryginale
    hexScale: 30,         // Skala dopasowana do generatora seamless
    hitDecayTime: 0.6,
    hitSpread: 0.5,       // Szersze rozchodzenie się fali
    deformPower: 3,
    shieldScale: 1.5,
    activationDuration: 0.45,
    deactivationDuration: 0.55,
    breakDuration: 0.65
};

// Cache tekstury
let hexGridTexture = null;
let shieldCanvas = null; // Pomocniczy canvas do efektów maskowania
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

// Oryginalny generator tekstury (Seamless) - zapewnia idealne łączenia
function generateHexTexture(colorHex, scale) {
    const tileW = 3 * scale;
    const tileH = Math.round(Math.sqrt(3) * scale); // Zaokrąglenie dla pixel-perfect

    const s_x = scale;
    const s_y = tileH / Math.sqrt(3);

    const cols = 2; // Wystarczy mały fragment do powtarzania
    const rows = 2;
    const width = Math.ceil(tileW * 2);
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
    // Rysujemy z marginesem
    for (let col = -1; col <= 3; col++) {
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

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

function getEntityPosition(entity) {
    if (!entity) return { x: undefined, y: undefined };
    const x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
    const y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
    return { x, y };
}

function shouldRenderShield(entity) {
    if (!entity) return false;
    const type = String(entity.type || '').toLowerCase();

    if (entity.isCapitalShip || entity.capitalProfile) return true;
    if (type.includes('capital') || type.includes('battleship') || type.includes('destroyer') || type.includes('frigate') || type.includes('carrier')) return true;

    const w = Number.isFinite(entity.w) ? entity.w : 0;
    const h = Number.isFinite(entity.h) ? entity.h : 0;
    const fallbackRadius = Math.max(w, h) / 2;
    const r = Number.isFinite(entity.radius) ? entity.radius : fallbackRadius;
    return r >= 26; // Przybliżony próg od fregaty w górę
}

function ensureShieldCanvasSize(size) {
    if (!shieldCanvas) {
        shieldCanvas = document.createElement('canvas');
        sCtx = shieldCanvas.getContext('2d');
    }
    // Canvas pomocniczy nie musi być ogromny, bo skalujemy teksturę
    const needed = Math.min(1024, Math.ceil(size));
    if (shieldCanvas.width < needed || shieldCanvas.height < needed) {
        shieldCanvas.width = needed;
        shieldCanvas.height = needed;
    }
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
    if (!shieldCanvas) {
        shieldCanvas = document.createElement('canvas');
        sCtx = shieldCanvas.getContext('2d');
    }
}

// --- LOGIKA POMOCNICZA (Shield Runtime) ---

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

// --- UPDATE LOGIC ---

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

    // Konwersja na kąt lokalny
    const localAngle = worldAngle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle,
        life: 1.0,
        intensity: Math.min(2.5, Math.max(1.0, damage / 5)), // Zwiększona intensywność dla efektu
        deformation: CONFIG.deformPower
    });

    triggerEnergyFlash(entity.shield, damage / (entity.shield.max || 1));
    if (shouldBreak(entity.shield)) {
        breakShield(entity.shield);
    }
}

export function updateShieldFx(entity, dt) {
    if (!entity.shield) return;
    const shield = entity.shield;
    ensureShieldRuntime(shield);
    if (!shield.impacts) shield.impacts = [];

    // Logika stanów (skrócona dla czytelności - identyczna jak w Twoim pliku, działa OK)
    shield.sparkCooldown = Math.max(0, (shield.sparkCooldown || 0) - dt);

    if (shield.energyShotTimer > 0) shield.energyShotTimer = Math.max(0, shield.energyShotTimer - dt);

    if (shield.state === 'breaking') {
        shield.breakTimer += dt;
        if (shield.breakTimer >= CONFIG.breakDuration) {
            shield.state = 'off';
            shield.activationProgress = 0;
            shield.currentAlpha = 0;
        }
    }

    // Proste sterowanie stanem activation/deactivation
    if (shield.state === 'off' && shield.val > 1) {
        shield.state = 'activating';
        shield.activationProgress = 0;
    }
    if (shield.state === 'activating') {
        shield.activationProgress = Math.min(1, shield.activationProgress + dt / CONFIG.activationDuration);
        if (shield.activationProgress >= 1) shield.state = 'active';
    } else if (shield.state === 'active') {
        if (shield.val <= 0) shield.state = 'deactivating';
        shield.activationProgress = Math.min(1, shield.activationProgress + dt * 0.5);
    } else if (shield.state === 'deactivating') {
        shield.activationProgress = Math.max(0, shield.activationProgress - dt / CONFIG.deactivationDuration);
        if (shield.activationProgress <= 0.01) {
            shield.state = 'off';
            shield.currentAlpha = 0;
        }
    }

    // Cleanup impaktów
    for (let i = shield.impacts.length - 1; i >= 0; i--) {
        const imp = shield.impacts[i];
        imp.life -= dt / CONFIG.hitDecayTime;
        if (imp.life <= 0) shield.impacts.splice(i, 1);
    }
}

// --- HELPER WYMIARÓW ---
function getShieldDimensions(entity) {
    let w = entity.w || (entity.radius * 2) || 40;
    let h = entity.h || (entity.radius * 2) || 40;

    if (entity.capitalProfile) {
    const baseR = entity.radius || 20;
    const len = baseR * (entity.capitalProfile.lengthScale || 3.2);
    const wid = baseR * (entity.capitalProfile.widthScale || 1.2);

    // POPRAWKA: Aby tarcza była pionowa (zgodna z długim statkiem):
    // Szerokość (w) musi brać wartość 'wid' (węższą)
    // Wysokość (h) musi brać wartość 'len' (dłuższą)
    w = Math.max(w, wid); 
    h = Math.max(h, len);
    } else if (entity.fighter || entity.type === 'fighter') {
        const size = Math.max(w, h);
        w = size; h = size;
    }

    return {
        rx: (w / 2) * CONFIG.shieldScale,
        ry: (h / 2) * CONFIG.shieldScale
    };
}

function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const n = clamp(x, 0, 1) - 1;
    return 1 + c3 * Math.pow(n, 3) + c1 * Math.pow(n, 2);
}

// --- RENDER (TO JEST KLUCZOWA ZMIANA) ---

export function drawShield(ctx, entity, cam) {
    try {
        const shield = entity.shield;
        if (!shield) return;
        if (!shouldRenderShield(entity)) return;
        ensureShieldRuntime(shield);

        if (!shield.max || shield.max <= 0) return;
        if (shield.state === 'off') return;

        // 1. Setup pozycji
        const pos = getEntityPosition(entity);
        if (!Number.isFinite(pos.x)) return;

        const screenX = (pos.x - cam.x) * cam.zoom + ctx.canvas.width / 2;
        const screenY = (pos.y - cam.y) * cam.zoom + ctx.canvas.height / 2;

        // Culling
        if (screenX < -500 || screenX > ctx.canvas.width + 500 || screenY < -500 || screenY > ctx.canvas.height + 500) return;

        const { rx, ry } = getShieldDimensions(entity);
        const impacts = shield.impacts || [];

        // 2. Obliczanie zmiennych wizualnych
        const time = performance.now() / 1000;
        const hpFactor = clamp(shield.val / shield.max, 0, 1);

        let baseAlpha = CONFIG.baseAlpha + Math.sin(time * 2) * 0.03; // "Oddychanie"
        let scaleModifier = 1.0;

        // Efekty stanów
        if (shield.energyShotTimer > 0) {
            const t = clamp(shield.energyShotTimer / shield.energyShotDuration, 0, 1);
            const intensity = Math.sin(t * Math.PI);
            baseAlpha += intensity * 0.6;
            //scaleModifier += intensity * 0.15;
        }

        let activationDeform = 0;
        if (shield.state === 'activating') {
            const progress = clamp(shield.activationProgress, 0, 1);
            scaleModifier *= easeOutBack(progress);
            // Noise przy aktywacji
            activationDeform = Math.sin(time * 20) * Math.cos(time * 15) * (1 - progress) * 15;
            baseAlpha = Math.max(baseAlpha, 0.3);
        }

        const alpha = clamp(baseAlpha * (shield.currentAlpha || 1), 0, 1);
        if (alpha < 0.01) return;

        // Rotacja sprite'a
        let visualAngle = entity.angle || 0;
        if (entity.capitalProfile && Number.isFinite(entity.capitalProfile.spriteRotation)) {
            visualAngle += entity.capitalProfile.spriteRotation;
        }

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(cam.zoom * scaleModifier, cam.zoom * scaleModifier);
        ctx.rotate(visualAngle);

        // --- KROK 3: Generowanie kształtu (Zwiększona liczba segmentów!) ---
        const segments = 120; // FIX: 120 zamiast 40 = gładka tarcza
        const path = new Path2D();
        const points = []; // Cache punktów do rysowania iskier

        const breakJitter = (shield.state === 'breaking') ? 10 : 0;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;

            // Promień elipsy w tym kącie
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const rBase = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);

            let totalDeform = 0;

            // Wobble (falowanie krawędzi)
            const wobble = Math.sin(theta * 6 + time * 3) * 1.5 + Math.cos(theta * 4 - time * 2) * 1.5;
            totalDeform -= wobble;

            if (shield.state === 'activating') {
                totalDeform -= Math.sin(theta * 5 + time * 20) * activationDeform;
            }

            // Deformacja od uderzeń
            for (const imp of impacts) {
                // Korekta kąta impaktu względem rotacji wizualnej
                const angleCorrection = visualAngle - (entity.angle || 0);
                const correctedImpAngle = imp.localAngle - angleCorrection;

                let diff = Math.abs(theta - correctedImpAngle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;

                if (diff < CONFIG.hitSpread) {
                    const normalizedDist = diff / CONFIG.hitSpread;
                    const waveShape = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                    totalDeform += (imp.deformation || CONFIG.deformPower) * imp.life * waveShape * imp.intensity;
                }
            }

            if (breakJitter > 0) totalDeform += (Math.random() - 0.5) * breakJitter;

            const finalR = Math.max(0, rBase - totalDeform);
            const px = Math.cos(theta) * finalR;
            const py = Math.sin(theta) * finalR;

            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);

            points.push({ x: px, y: py });
        }
        path.closePath();

        // --- KROK 4: Wypełnienie (Gradient + Fresnel) ---
        ctx.save(); // Clip scope
        ctx.clip(path);

        const col = hexToRgb(CONFIG.baseColor);
        const hitCol = hexToRgb(CONFIG.hitColor);
        const isBreaking = shield.state === 'breaking';

        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;

        const maxR = Math.max(rx, ry);
        const grad = ctx.createRadialGradient(0, 0, maxR * 0.5, 0, 0, maxR);
        grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
        grad.addColorStop(0.8, `rgba(${col.r}, ${col.g}, ${col.b}, 0.2)`);
        grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0.8)`);

        ctx.fillStyle = grad;
        ctx.fillRect(-maxR * 1.5, -maxR * 1.5, maxR * 3, maxR * 3);

        // --- KROK 5: Hex Pattern (Tylko jeśli aktywny) ---
        const showHex = impacts.length > 0 || shield.state === 'activating' || isBreaking || shield.energyShotTimer > 0;

        if (showHex && hexGridTexture) {
            // Obliczamy widoczność hexów w zależności od stanu
            let hexIntensity = CONFIG.hexAlpha;
            if (isBreaking) hexIntensity = 1.0;
            else if (shield.state === 'activating') hexIntensity = 0.8;

            // Rysujemy hexy tam gdzie uderzenie (lokalnie)
            if (impacts.length > 0 && !isBreaking) {
                ensureShieldCanvasSize(maxR * 2.5);
                sCtx.clearRect(0, 0, shieldCanvas.width, shieldCanvas.height);
                sCtx.save();
                sCtx.translate(shieldCanvas.width / 2, shieldCanvas.height / 2);

                for (const imp of impacts) {
                    const angleCorrection = visualAngle - (entity.angle || 0);
                    const correctedImpAngle = imp.localAngle - angleCorrection;

                    const flashX = Math.cos(correctedImpAngle) * rx;
                    const flashY = Math.sin(correctedImpAngle) * ry;

                    const hitGrad = sCtx.createRadialGradient(flashX, flashY, 0, flashX, flashY, 150 * CONFIG.hitSpread);
                    hitGrad.addColorStop(0, `rgba(${hitCol.r}, ${hitCol.g}, ${hitCol.b}, ${imp.life * 2.0})`);
                    hitGrad.addColorStop(1, `rgba(${hitCol.r}, ${hitCol.g}, ${hitCol.b}, 0)`);
                    sCtx.fillStyle = hitGrad;
                    sCtx.beginPath();
                    sCtx.arc(flashX, flashY, 150 * CONFIG.hitSpread, 0, Math.PI * 2);
                    sCtx.fill();
                }

                // Maskowanie wzorem
                sCtx.globalCompositeOperation = 'source-in';
                const pat = sCtx.createPattern(hexGridTexture, 'repeat');
                const matrix = new DOMMatrix();
                matrix.scaleSelf(0.5, 0.5); // Skala hexów
                matrix.translateSelf(time * 20, time * 10);
                pat.setTransform(matrix);
                sCtx.fillStyle = pat;
                sCtx.fillRect(-shieldCanvas.width / 2, -shieldCanvas.height / 2, shieldCanvas.width, shieldCanvas.height);

                sCtx.restore();

                ctx.globalCompositeOperation = 'lighter';
                ctx.drawImage(shieldCanvas, -shieldCanvas.width / 2, -shieldCanvas.height / 2);
            }
            // Globalne hexy (np. przy pękaniu)
            else if (isBreaking || shield.state === 'activating') {
                const pat = ctx.createPattern(hexGridTexture, 'repeat');
                const matrix = new DOMMatrix();
                matrix.scaleSelf(0.5, 0.5);
                matrix.translateSelf(time * 50, 0); // Szybki ruch przy pękaniu
                pat.setTransform(matrix);
                ctx.globalAlpha = hexIntensity * alpha;
                ctx.fillStyle = pat;
                ctx.fillRect(-maxR * 2, -maxR * 2, maxR * 4, maxR * 4);
            }
        }
        ctx.restore(); // Koniec clipa

        // --- KROK 6: Krawędzie (Stroke) ---
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${baseAlpha * 2 * alpha})`;
        ctx.stroke(path);

        // --- KROK 7: FLASH (Efekt Uderzenia - Naprawiony!) ---
        // Zamiast kółek, rysujemy pogrubioną linię wzdłuż deformacji (Arc Lighting)
        if (impacts.length > 0) {
            ctx.globalCompositeOperation = 'lighter';

            for (const imp of impacts) {
                const angleCorrection = visualAngle - (entity.angle || 0);
                const correctedImpAngle = imp.localAngle - angleCorrection;

                ctx.beginPath();
                const spreadRad = CONFIG.hitSpread * 0.8;
                let drawing = false;

                // Przechodzimy po zapamiętanych punktach ścieżki
                for (let i = 0; i <= segments; i++) {
                    const theta = (i / segments) * Math.PI * 2 - Math.PI;
                    let diff = Math.abs(theta - correctedImpAngle);
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
                // Grubość zależna od czasu życia uderzenia
                ctx.lineWidth = 4 * imp.life * imp.intensity;
                ctx.strokeStyle = strokeColor;

                // Glow
                ctx.shadowColor = strokeColor;
                ctx.shadowBlur = 15 * imp.life;

                ctx.stroke();

                // Reset shadow dla następnych elementów
                ctx.shadowBlur = 0;
            }
        }

        ctx.restore();

    } catch (e) {
        console.error(e);
    }
}
