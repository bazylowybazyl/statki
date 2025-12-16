import * as THREE from 'three';

// Konfiguracja
const TEX_SIZE = 8192; // Docelowa rozdzielczość
const CHUNK_SIZE = 256; // Rozmiar kawałka generowanego w jednej klatce (bezpieczne dla CPU)

let _bgCanvas = null;
let _bgContext = null;
let _bgTexture = null;
let _isGenerating = false;

// Deterministyczny generator liczb losowych (dla spójności gwiazd przy odświeżaniu)
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

const seed = 12345;
const random = mulberry32(seed);

// Funkcja rysująca gwiazdy tylko w danym obszarze (rect)
function drawStarsInChunk(ctx, x, y, w, h) {
    // Gęstość gwiazd - dostosuj wg uznania
    // Dla 8k chcemy ich sporo, ale bez przesady.
    // Powiedzmy 0.002 gwiazdy na piksel^2
    const area = w * h;
    const starCount = Math.floor(area * 0.0015); 

    for (let i = 0; i < starCount; i++) {
        // Losowa pozycja WĘWNĄTRZ chunka
        const lx = Math.floor(random() * w);
        const ly = Math.floor(random() * h);
        
        const px = x + lx;
        const py = y + ly;

        // Wielkość i jasność
        const size = random() < 0.9 ? 1 : (1 + random() * 1.5);
        const brightness = random();
        
        // Rysowanie
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        ctx.fillRect(px, py, size, size);
    }
}

// Funkcja rysująca mgławice (uproszczona wersja per-chunk)
function drawNebulaInChunk(ctx, x, y, w, h) {
    // Aby uniknąć widocznych szwów między chunkami przy mgławicach,
    // normalnie używa się noise 2D. Tutaj zrobimy bardzo delikatny
    // fill losowym kolorem o niskim alpha, żeby "zaszumieć" tło.
    // Prawdziwe proceduralne mgławice w chunkach wymagają biblioteki noise (np. simplex-noise).
    
    // Zamiast skomplikowanych gradientów, które mogą uciąć się na krawędzi,
    // nałożymy tu tylko delikatny szum tła.
    
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        // Bardzo subtelny fioletowo-niebieski szum
        if (random() > 0.98) {
            data[i] = 10 + random() * 20;     // R
            data[i + 1] = 20 + random() * 30; // G
            data[i + 2] = 40 + random() * 40; // B
            data[i + 3] = 15;                 // Alpha (bardzo niskie)
        }
    }
    ctx.putImageData(imageData, x, y);
}

// Główna korutyna generująca
function generateBackgroundChunks(onProgress, onComplete) {
    if (!_bgCanvas) {
        _bgCanvas = document.createElement('canvas');
        _bgCanvas.width = TEX_SIZE;
        _bgCanvas.height = TEX_SIZE;
        _bgContext = _bgCanvas.getContext('2d', { alpha: false }); // alpha: false oszczędza pamięć
        
        // Tło startowe
        _bgContext.fillStyle = '#020204';
        _bgContext.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }

    const cols = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const rows = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const totalChunks = cols * rows;
    
    let currentChunk = 0;

    function processNext() {
        if (currentChunk >= totalChunks) {
            // Koniec!
            _isGenerating = false;
            console.log(`[Tyro] Generowanie tła 8k zakończone.`);
            if (onComplete) onComplete(_bgCanvas);
            return;
        }

        const startTime = performance.now();

        // Przetwarzaj tyle chunków ile się da w 16ms (jedna klatka), żeby przyspieszyć
        while (performance.now() - startTime < 12 && currentChunk < totalChunks) {
            const col = currentChunk % cols;
            const row = Math.floor(currentChunk / cols);
            
            const x = col * CHUNK_SIZE;
            const y = row * CHUNK_SIZE;

            // 1. Mgławice (tło)
            // drawNebulaInChunk(_bgContext, x, y, CHUNK_SIZE, CHUNK_SIZE);

            // 2. Gwiazdy
            drawStarsInChunk(_bgContext, x, y, CHUNK_SIZE, CHUNK_SIZE);

            currentChunk++;
        }

        // Aktualizuj postęp
        const progress = currentChunk / totalChunks;
        if (onProgress) onProgress(progress);

        // Zaplanuj kolejną partię w następnej klatce
        requestAnimationFrame(processNext);
    }

    _isGenerating = true;
    processNext();
}

export function initSpaceBg(seedVal) {
    // Reset jeśli trzeba
    // seedVal - opcjonalnie do randoma
}

export function getBackgroundCanvas() {
    return _bgCanvas;
}

// Ta funkcja jest wywoływana przez Twój index.html
// Zmieniamy ją tak, by zwracała Promise lub przyjmowała callback, 
// ale żeby zachować kompatybilność z obecnym kodem w index.html,
// musimy obsłużyć to sprytnie.
export function resizeSpaceBg(w, h) {
    // Ta funkcja w Twoim kodzie chyba tylko resize'owała, 
    // ale teraz musimy zainicjować generowanie.
    
    if (_isGenerating || _bgTexture) return; // Już zrobione lub w trakcie

    console.log(`[Tyro] Start generowania tła ${TEX_SIZE}x${TEX_SIZE} w chunkach...`);

    // Znajdź element loadingu w DOM, żeby pokazać postęp
    const loadingEl = document.getElementById('loading-progress');
    const loadingBar = document.getElementById('loading-fill');

    generateBackgroundChunks(
        (progress) => {
            // Update UI
            const pct = Math.round(progress * 100);
            if (loadingEl) loadingEl.textContent = `${pct}% · Generowanie galaktyki`;
            if (loadingBar) loadingBar.style.width = `${pct}%`;
        },
        (canvas) => {
            // Done
            _bgTexture = new THREE.CanvasTexture(canvas);
            _bgTexture.colorSpace = THREE.SRGBColorSpace;
            _bgTexture.minFilter = THREE.LinearFilter;
            _bgTexture.magFilter = THREE.LinearFilter;
            _bgTexture.generateMipmaps = false; // Oszczędność pamięci
            
            // Tutaj musimy wstrzyknąć teksturę do Twojego mainScene3D, jeśli istnieje
            // Ale z tego co widzę w index.html, Ty używasz tego canvasa głównie do WarpLens?
            // Jeśli WarpLens potrzebuje 'canvas', to już go ma w _bgCanvas.
            
            // Jeśli używasz Three.js do tła:
            if (window.scene && !window.scene.background) {
                window.scene.background = _bgTexture;
            }
            
            console.log("[Tyro] Tekstura gotowa i załadowana.");
            
            // Ważne: Jeśli masz globalną funkcję do aktualizacji WarpLens
            if (window.configureWarpLensSource) {
                window.configureWarpLensSource();
            }
        }
    );
}

// API zgodne z Twoim kodem w index.html
export const setBgOptions = (opts) => {
    // opcje
};
