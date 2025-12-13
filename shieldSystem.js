// --- SHIELD SYSTEM MODULE ---
// Wersja poprawiona: Dostosowana do renderowania wewnątrz przetransformowanego kontekstu (ctx).
// Naprawia błędy: "kręcenie się" tarczy, smużenie (przez błędy JS), znikające paski HP.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.15,
    hexAlpha: 0.5,       // Zmniejszona alpha dla heksów, żeby nie zasłaniały statku
    hexScale: 24,        // Większa skala heksów dla lepszej widoczności
    hitDecayTime: 0.6,
    hitSpread: 0.8,
    deformPower: 8,      // Siła wgniecenia przy uderzeniu
    shieldScale: 1.6     // Mnożnik rozmiaru tarczy (1.6 = tarcza jest 60% większa od kadłuba)
};

// Cache tekstury heksagonalnej
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

// Generowanie tekstury heksagonalnej (pattern)
function generateHexTexture(colorHex, scale) {
    const s = Math.max(4, scale || 16);
    // Wzór heksagonalny wymaga specyficznych proporcji, aby się kafelkował (seamless)
    const tileW = 3 * s;
    const tileH = Math.sqrt(3) * s; 
    
    // Tworzymy canvas o rozmiarze jednego kafelka (z małym marginesem bezpieczeństwa)
    const cvs = document.createElement('canvas');
    cvs.width = Math.ceil(tileW);
    cvs.height = Math.ceil(tileH * 2); // Podwójna wysokość dla przesunięcia rzędów
    const c = cvs.getContext('2d');
    
    c.strokeStyle = colorHex || '#00aaff';
    c.lineWidth = Math.max(1, s * 0.1); 
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = 0.8;

    // Rysowanie heksagonów
    c.beginPath();
    // Rysujemy fragmenty heksów, które po powieleniu utworzą siatkę
    // (Uproszczona wersja "plastra miodu")
    
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

    // Rysujemy w układzie przesuniętym
    drawHexPart(0, 0);
    drawHexPart(tileW, 0);
    drawHexPart(tileW * 0.5, tileH); // Środek
    drawHexPart(0, tileH * 2);
    drawHexPart(tileW, tileH * 2);

    c.stroke();
    return cvs;
}

// --- INIT ---
export function initShieldSystem(width, height) {
    resizeShieldSystem(width, height);
    // Regeneracja tekstury tylko jeśli nie istnieje
    if (!hexGridTexture) {
        hexGridTexture = generateHexTexture(CONFIG.baseColor, CONFIG.hexScale);
    }
}

export function resizeShieldSystem(width, height) {
    W = width;
    H = height;
    // Tutaj nie musimy już zarządzać offscreen canvasem dla pełnego ekranu,
    // ponieważ rysujemy bezpośrednio w kontekście obiektu.
}

// --- LOGIC ---

export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity || !entity.shield) return;
    if (!entity.shield.impacts) entity.shield.impacts = [];

    // Zabezpieczenie przed NaN
    if (!Number.isFinite(bulletX) || !Number.isFinite(bulletY) || !Number.isFinite(damage)) return;

    // Obliczamy kąt uderzenia w świecie gry
    const dx = bulletX - entity.x;
    const dy = bulletY - entity.y;
    let angle = Math.atan2(dy, dx);
    
    if (!Number.isFinite(angle)) angle = 0;

    // Konwertujemy na kąt LOKALNY względem obrotu statku.
    // Dzięki temu, gdy statek się obraca, uderzenie "obraca się" razem z tarczą.
    const localAngle = angle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle,
        life: 1.0,
        intensity: Math.min(2.0, Math.max(0.5, damage / 15)), // Skalowanie jasności od obrażeń
        deformation: CONFIG.deformPower * (damage / 50)
    });
}

export function updateShieldFx(entity, dt) {
    if (!entity.shield || !entity.shield.impacts) return;

    // Aktualizacja czasu życia efektów uderzeń
    for (let i = entity.shield.impacts.length - 1; i >= 0; i--) {
        const imp = entity.shield.impacts[i];
        imp.life -= dt / CONFIG.hitDecayTime;
        if (imp.life <= 0) {
            entity.shield.impacts.splice(i, 1);
        }
    }
}

// --- RENDER ---

/**
 * Rysuje tarczę.
 * UWAGA: Ta funkcja zakłada, że `ctx` jest już przesunięty (translate), 
 * obrócony (rotate) i przeskalowany (scale) do pozycji statku.
 * Rysujemy względem punktu (0,0).
 */
export function drawShield(ctx, entity, cam) {
    try {
        const shield = entity.shield;
        // Warunki wyjścia: brak tarczy, zniszczona tarcza, brak HP tarczy
        if (!shield || shield.val <= 1 || !shield.max) return;

        const hpFactor = Math.max(0, Math.min(1, shield.val / shield.max));
        const impacts = shield.impacts || [];

        // Bezpieczne pobieranie wymiarów (z fallbackiem)
        // Używamy width/height bezpośrednio, bo ctx jest już przeskalowany zoomem w index.html
        // Ale shieldScale jest stałą konfiguracyjną tarczy.
        const baseW = (Number.isFinite(entity.w) && entity.w > 0) ? entity.w : (entity.radius * 2 || 40);
        const baseH = (Number.isFinite(entity.h) && entity.h > 0) ? entity.h : (entity.radius * 2 || 40);

        // Promienie elipsy tarczy (lokalne)
        const rx = (baseW / 2) * CONFIG.shieldScale;
        const ry = (baseH / 2) * CONFIG.shieldScale;
        
        // Czas do animacji (pulsowanie)
        const time = performance.now() / 1000;
        
        // Bazowa przezroczystość: zależy od naładowania tarczy + pulsowanie "idle"
        // Jeśli tarcza jest słaba, jest mniej widoczna.
        const pulse = Math.sin(time * 2.0) * 0.05;
        const alpha = Math.max(0.05, Math.min(0.8, (CONFIG.baseAlpha + pulse) * hpFactor));

        // Jeśli są aktywne uderzenia, tarcza jaśnieje
        const hitIntensity = impacts.reduce((sum, imp) => sum + imp.life, 0);
        const activeAlpha = Math.min(0.8, alpha + hitIntensity * 0.2);

        // KROK 1: Budowanie ścieżki (kształtu) tarczy z deformacjami
        // Rysujemy wokół (0,0), bo ctx jest już ustawiony na środku statku
        const segments = 40; 
        const path = new Path2D();

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2 - Math.PI;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            
            // Promień elipsy w danym kącie (współrzędne biegunowe elipsy)
            const rBase = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
            let r = rBase;

            // Deformacja od uderzeń
            let totalDeform = 0;
            // Lekkie falowanie spoczynkowe
            totalDeform -= Math.sin(theta * 6 + time * 3) * (1.5); 

            for (const imp of impacts) {
                // Obliczamy odległość kątową od miejsca trafienia
                let diff = Math.abs(theta - imp.localAngle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff; // Normalizacja do 0..PI

                // Jeśli wierzchołek jest w zasięgu fali uderzeniowej
                if (diff < CONFIG.hitSpread) {
                    const normalizedDist = diff / CONFIG.hitSpread;
                    // Funkcja kształtu fali (cosinusoidalna górka)
                    const waveShape = (Math.cos(normalizedDist * Math.PI) + 1) / 2;
                    // Siła wgniecenia
                    const deform = (imp.deformation || 5) * imp.life * waveShape * (imp.intensity || 1);
                    if (Number.isFinite(deform)) {
                        totalDeform += deform;
                    }
                }
            }

            // Odejmujemy deformację od promienia (wgniecenie do środka)
            const finalR = Math.max(5, r - totalDeform);
            const px = cos * finalR;
            const py = sin * finalR;

            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);
        }
        path.closePath();

        // KROK 2: Wypełnienie (Gradient + Hex Pattern)
        ctx.save();
        
        // A. Wypełnienie bazowe (Gradient radialny)
        // Używamy 'lighter' dla efektu energii
        ctx.globalCompositeOperation = 'lighter';
        
        // Tworzymy gradient pasujący do elipsy (z grubsza)
        const maxR = Math.max(rx, ry);
        // Zabezpieczenie przed błędem gradientu (promień musi być > 0)
        if (maxR > 0) {
            const col = hexToRgb(CONFIG.baseColor);
            const grad = ctx.createRadialGradient(0, 0, maxR * 0.6, 0, 0, maxR * 1.1);
            grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`); // Środek pysty
            grad.addColorStop(0.8, `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha * 0.5})`);
            grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha})`);
            
            ctx.fillStyle = grad;
            // Rysujemy gradient przycięty do kształtu tarczy
            ctx.fill(path);
        }

        // B. Efekt siatki (Hex Grid) - tylko przy trafieniach lub dużej mocy
        // Rysujemy to tylko jeśli są impakty, żeby oszczędzać CPU,
        // albo jeśli tarcza jest bardzo mocna.
        if ((impacts.length > 0 || shield.val > shield.max * 0.9) && hexGridTexture) {
            ctx.save();
            ctx.clip(path); // Przycinamy do kształtu tarczy
            
            // Ustawiamy tryb mieszania tak, by siatka była widoczna na tarczy
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = CONFIG.hexAlpha * (impacts.length > 0 ? 1 : 0.3); // Jaśniej przy trafieniu

            // Tworzymy pattern
            const pat = ctx.createPattern(hexGridTexture, 'repeat');
            if (pat) {
                // Przesuwamy pattern w czasie (animacja)
                const matrix = new DOMMatrix();
                matrix.translateSelf(0, time * 10); 
                // Skalujemy pattern, żeby był niezależny od zoomu kamery (opcjonalne)
                // Tutaj zostawiamy domyślnie, bo ctx jest już przeskalowany.
                pat.setTransform(matrix);
                
                ctx.fillStyle = pat;
                // Rysujemy prostokąt pokrywający całą tarczę
                ctx.fillRect(-maxR * 1.5, -maxR * 1.5, maxR * 3, maxR * 3);
            }
            ctx.restore(); // Koniec clipa
        }

        // KROK 3: Krawędź (Stroke)
        ctx.globalCompositeOperation = 'lighter';
        const col = hexToRgb(CONFIG.baseColor);
        ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${activeAlpha * 1.5})`;
        ctx.lineWidth = Math.max(1.5, 2.5 * hpFactor); // Grubsza linia gdy pełna tarcza
        ctx.stroke(path);

        // KROK 4: Rozbłyski w miejscu trafień (Impact Flash)
        if (impacts.length > 0) {
            ctx.globalCompositeOperation = 'source-over';
            for (const imp of impacts) {
                // Wyliczamy pozycję na obwodzie elipsy
                const cos = Math.cos(imp.localAngle);
                const sin = Math.sin(imp.localAngle);
                const rHit = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
                
                // Rysujemy jasną plamę w miejscu uderzenia
                ctx.beginPath();
                ctx.fillStyle = CONFIG.hitColor;
                ctx.globalAlpha = imp.life * 0.9;
                ctx.arc(cos * rHit, sin * rHit, 15 * imp.intensity, 0, Math.PI * 2);
                ctx.fill();
                
                // Dodatkowy łuk na obwodzie
                ctx.beginPath();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.arc(0, 0, rHit, imp.localAngle - 0.3, imp.localAngle + 0.3);
                ctx.stroke();
            }
        }

        ctx.restore(); // Koniec głównego save()

    } catch (e) {
        // Awaryjne przywrócenie stanu w razie błędu, żeby nie popsuć reszty renderowania
        console.warn("Shield render error:", e);
        ctx.restore();
    }
}
