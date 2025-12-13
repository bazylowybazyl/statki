// --- SHIELD SYSTEM MODULE ---
// Logika zaawansowanej tarczy energetycznej z efektem heksagonów i deformacji.

const CONFIG = {
    baseColor: '#00aaff',
    hitColor: '#ffffff',
    baseAlpha: 0.15,
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

// Rejestracja trafienia w tarczę
export function registerShieldImpact(entity, bulletX, bulletY, damage) {
    if (!entity.shield) return;
    
    // Upewnij się, że lista impacts istnieje
    if (!entity.shield.impacts) entity.shield.impacts = [];

    // Kąt trafienia względem środka statku
    const originX = entity.x !== undefined ? entity.x : (entity.pos?.x ?? 0);
    const originY = entity.y !== undefined ? entity.y : (entity.pos?.y ?? 0);
    const dx = bulletX - originX;
    const dy = bulletY - originY;
    const angle = Math.atan2(dy, dx); // World angle

    // Normalizacja względem obrotu statku (żeby efekt "przykleił się" do miejsca trafienia gdy statek skręca)
    // Ale w tym systemie trzymamy kąt świata i korygujemy przy rysowaniu, lub trzymamy kąt lokalny.
    // Prościej: trzymajmy kąt świata trafienia, a przy rysowaniu odejmijmy obrót statku? 
    // Nie, tarcza zazwyczaj jest sferą wokół statku. Jeśli statek się obraca, czy tarcza też?
    // W Twoim kodzie tarcza jest elipsą (width/height), więc obraca się ze statkiem.
    // Zapiszmy kąt lokalny.
    const localAngle = angle - (entity.angle || 0);

    entity.shield.impacts.push({
        localAngle: localAngle, // Kąt względem dziobu
        life: 1.0,
        intensity: Math.min(1.5, damage / 20), // Skala błysku zależna od dmg
        deformation: CONFIG.deformPower * (damage / 40)
    });
}

// Aktualizacja stanu efektów (zanikanie)
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
    if (!shield || shield.val <= 0 || !shield.max) return;
    
    // Jeśli brak trafień i tarcza pełna, nie rysuj (lub rysuj bardzo słabą)
    const impacts = shield.impacts || [];
    // Rysujemy zawsze cieniutką obwódkę, żeby gracz wiedział że wróg ma tarczę
    const baseAlpha = CONFIG.baseAlpha * (shield.val / shield.max);
    
    // Wymiary tarczy (zgodne z obrotem statku)
    const length = (entity.w || entity.radius * 2) * CONFIG.shieldScale;
    const width = (entity.h || entity.radius * 2) * CONFIG.shieldScale; // Dla koła w=h
    
    // Pozycja na ekranie
    const originX = entity.x !== undefined ? entity.x : (entity.pos?.x ?? 0);
    const originY = entity.y !== undefined ? entity.y : (entity.pos?.y ?? 0);
    const screenX = (originX - cam.x) * cam.zoom + ctx.canvas.width / 2;
    const screenY = (originY - cam.y) * cam.zoom + ctx.canvas.height / 2;
    const zoom = cam.zoom;

    // Promienie ekranowe
    const rx = (length / 2) * zoom;
    const ry = (width / 2) * zoom;
    const maxR = Math.max(rx, ry);

    // Optymalizacja: Nie rysuj jeśli poza ekranem
    if (screenX < -maxR || screenX > W + maxR || screenY < -maxR || screenY > H + maxR) return;

    // --- KROK 1: Obliczanie kształtu (Deformacja) ---
    const segments = 60; // Mniej segmentów niż w demo dla wydajności
    const path = new Path2D();
    const rotation = entity.angle || 0;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(rotation);

    // Budowanie ścieżki
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 - Math.PI; // -PI do PI
        
        // Promień elipsy w danym kącie
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        // Wzór na promień elipsy we współrzędnych biegunowych
        let r = (rx * ry) / Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);

        // Deformacja od uderzeń
        let totalDeform = 0;
        
        // Dodaj lekkie falowanie (idle wobble)
        const time = performance.now() / 1000;
        totalDeform -= Math.sin(theta * 6 + time * 3) * (1.5 * zoom); 

        for (const imp of impacts) {
            // Oblicz różnicę kątów (uwzględniając cykliczność koła)
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

    // --- KROK 2: Wypełnienie bazowe (Fresnel) ---
    ctx.globalCompositeOperation = 'source-over'; // Standardowe mieszanie
    // Używamy clip, żeby gradient nie wyszedł poza zdeformowany kształt
    ctx.save();
    ctx.clip(path);
    
    // Gradient imitujący sferę/elipsoidę
    const grad = ctx.createRadialGradient(0, 0, maxR * 0.6, 0, 0, maxR);
    const col = hexToRgb(CONFIG.baseColor);
    grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`); // Środek przezroczysty
    grad.addColorStop(0.8, `rgba(${col.r}, ${col.g}, ${col.b}, ${baseAlpha * 0.3})`);
    grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, ${baseAlpha})`);
    
    ctx.fillStyle = grad;
    ctx.fill();

    // --- KROK 3: Efekt Hexów (Tylko przy trafieniach) ---
    if (impacts.length > 0 && hexGridTexture && sCtx) {
        // Czyścimy TYLKO obszar roboczy wokół statku na sharedFxCanvas
        // To kluczowa optymalizacja! Nie czyść całego 1920x1080.
        // Pracujemy w lokalnym układzie sCtx, ale musimy zmapować to na pozycję ekranową.
        // Dla uproszczenia tutaj: użyjmy translate na sCtx tak samo jak na głównym.
        
        sCtx.save();
        sCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        // Czyścimy tylko bounding box statku
        const clearSize = maxR * 2.5; 
        sCtx.clearRect(screenX - clearSize/2, screenY - clearSize/2, clearSize, clearSize);
        
        sCtx.translate(screenX, screenY);
        sCtx.rotate(rotation);

        // 1. Rysujemy "światła" w miejscach trafień na kanale alfa
        for (const imp of impacts) {
            const flashX = Math.cos(imp.localAngle) * rx;
            const flashY = Math.sin(imp.localAngle) * ry;
            
            const hitGrad = sCtx.createRadialGradient(flashX, flashY, 0, flashX, flashY, 120 * CONFIG.hitSpread * zoom);
            const intensity = imp.life * CONFIG.hexAlpha * 2.0; 
            hitGrad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
            hitGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
            
            sCtx.fillStyle = hitGrad;
            sCtx.beginPath();
            sCtx.arc(flashX, flashY, 120 * CONFIG.hitSpread * zoom, 0, Math.PI*2);
            sCtx.fill();
        }

        // 2. Nakładamy wzór heksagonów (maskowanie: destination-in)
        // Wzór wycina to, co narysowaliśmy wyżej (czyli białe plamy zamieniają się w hexy)
        sCtx.globalCompositeOperation = 'destination-in';
        
        // Przesuwanie tekstury w czasie (animacja pola)
        const time = performance.now() / 1000;
        const pat = sCtx.createPattern(hexGridTexture, 'repeat');
        const matrix = new DOMMatrix();
        // Skalujemy wzór heksów razem z zoomem kamery, żeby nie robiły się maciupeńkie przy oddaleniu
        const hexZoom = Math.max(0.5, zoom); 
        matrix.scaleSelf(hexZoom, hexZoom);
        matrix.translateSelf(time * 20, time * 10); 
        pat.setTransform(matrix);

        sCtx.fillStyle = pat;
        // Wypełniamy tylko bounding box
        sCtx.fillRect(-clearSize/2, -clearSize/2, clearSize, clearSize);
        
        sCtx.restore();

        // 3. Rysujemy wynik (gotowe świecące heksy) na głównym canvasie
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; // Dodawanie światła
        // Ponieważ sCtx rysowaliśmy w tych samych współrzędnych ekranowych, po prostu kopiujemy fragment
        // Uwaga: ctx jest teraz w transformacji (rotate/translate).
        // Musimy to cofnąć, żeby narysować fragment z sCtx (który jest w screen-space)
        // Albo po prostu narysować image w 0,0, bo sCtx ma te same wymiary co canvas.
        // Ale to narysuje CAŁY sCtx. Żeby było szybko, wytnijmy kawałek.
        
        ctx.resetTransform(); // Resetujemy transformację głównego ctx na chwilę
        
        const sx = screenX - clearSize/2;
        const sy = screenY - clearSize/2;
        
        // Zabezpieczenie przed ujemnymi koordynatami (drawImage nie lubi ujemnych source)
        // Ale tu source to sCtx (canvas), a dest to ctx.
        ctx.drawImage(sharedFxCanvas, sx, sy, clearSize, clearSize, sx, sy, clearSize, clearSize);
        
        ctx.restore(); // Przywraca transformację statku (dla krawędzi)
    }
    
    ctx.restore(); // Koniec clipa

    // --- KROK 4: Krawędź (Stroke) ---
    ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${baseAlpha * 1.5})`;
    ctx.lineWidth = 1.5 * zoom;
    ctx.stroke(path);

    // Krawędź trafienia (błysk na obwodzie)
    if (impacts.length > 0) {
        ctx.globalCompositeOperation = 'lighter';
        for (const imp of impacts) {
            ctx.beginPath();
            const spreadRad = CONFIG.hitSpread * 0.8;
            let drawing = false;
            
            // Rysujemy łuk w miejscu trafienia
            // (uproszczona wersja rysowania po punktach ścieżki dla wydajności)
            const startAng = imp.localAngle - spreadRad;
            const endAng = imp.localAngle + spreadRad;
            
            // Rysujemy po elipsie aproksymowanej
            // Dla prostoty użyjmy stroke z gradientem lub po prostu jaśniejszy kolor
            // Ale musimy podążać za "ścieżką" (path). Path2D nie pozwala łatwo iterować.
            // Ponieważ mamy już 'path' zdefiniowane w KROKU 1, możemy po prostu narysować je całe
            // ale używając maski? Nie, za wolne.
            // Po prostu narysujmy jeszcze raz całą ścieżkę jaśniejszym kolorem z niskim alpha, 
            // jeśli jest trafienie. To da efekt "wzbudzenia" całej tarczy.
            
            ctx.strokeStyle = CONFIG.hitColor;
            ctx.lineWidth = 2.5 * zoom * imp.life;
            ctx.globalAlpha = imp.life * 0.7;
            ctx.stroke(path);
        }
    }

    ctx.restore();
}

// --- UTILS ---

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// Generowanie tekstury heksagonalnej (seamless)
function generateHexTexture(colorHex, scale) {
    const tileW = 3 * scale; 
    const tileH = Math.round(Math.sqrt(3) * scale);
    
    const s_x = scale;
    const s_y = tileH / Math.sqrt(3);

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
