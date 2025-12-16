// src/lib/space2d/tyroBackground.js
import * as THREE from 'three';

const TEX_SIZE = 8192;
const CHUNK_SIZE = 256; 

let _bgCanvas = null;
let _bgContext = null;
let _bgTexture = null;
let _isGenerating = false;

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

function drawStarsInChunk(ctx, x, y, w, h) {
    const area = w * h;
    const starCount = Math.floor(area * 0.0015); 

    for (let i = 0; i < starCount; i++) {
        const lx = Math.floor(random() * w);
        const ly = Math.floor(random() * h);
        const px = x + lx;
        const py = y + ly;
        const size = random() < 0.9 ? 1 : (1 + random() * 1.5);
        const brightness = random();
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        ctx.fillRect(px, py, size, size);
    }
}

// Funkcja startująca generowanie "Live"
export function startLiveGeneration(sceneRef, onProgress, onComplete) {
    if (_isGenerating || (_bgTexture && _bgTexture.userData.ready)) return;

    console.log(`[Tyro] Start generowania tła LIVE ${TEX_SIZE}x${TEX_SIZE}...`);

    // 1. Inicjalizacja Canvasa (jeśli nie istnieje)
    if (!_bgCanvas) {
        _bgCanvas = document.createElement('canvas');
        _bgCanvas.width = TEX_SIZE;
        _bgCanvas.height = TEX_SIZE;
        _bgContext = _bgCanvas.getContext('2d', { alpha: false });
        
        // Tło startowe (czarne)
        _bgContext.fillStyle = '#020204';
        _bgContext.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }

    // 2. Inicjalizacja Tekstury (Natychmiast!)
    if (!_bgTexture) {
        _bgTexture = new THREE.CanvasTexture(_bgCanvas);
        _bgTexture.colorSpace = THREE.SRGBColorSpace;
        _bgTexture.minFilter = THREE.LinearFilter;
        _bgTexture.magFilter = THREE.LinearFilter;
        _bgTexture.generateMipmaps = false; 
        _bgTexture.userData = { ready: false }; // Flaga gotowości
    }

    // 3. Przypisz czarną teksturę do sceny OD RAZU
    if (sceneRef) {
        sceneRef.background = _bgTexture;
    }

    // 4. Pętla generowania chunków
    const cols = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const rows = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const totalChunks = cols * rows;
    let currentChunk = 0;
    _isGenerating = true;

    function processNextFrame() {
        if (currentChunk >= totalChunks) {
            _isGenerating = false;
            _bgTexture.userData.ready = true;
            _bgTexture.needsUpdate = true; // Ostatni update
            console.log(`[Tyro] Generowanie tła zakończone.`);
            if (onComplete) onComplete();
            return;
        }

        const startTime = performance.now();

        // Rób chunki przez max 12ms na klatkę (żeby gra miała 60 FPS)
        while (performance.now() - startTime < 12 && currentChunk < totalChunks) {
            const col = currentChunk % cols;
            const row = Math.floor(currentChunk / cols);
            const x = col * CHUNK_SIZE;
            const y = row * CHUNK_SIZE;

            // Rysuj gwiazdy na canvasie
            drawStarsInChunk(_bgContext, x, y, CHUNK_SIZE, CHUNK_SIZE);
            currentChunk++;
        }

        // KLUCZOWE: Powiedz GPU, że tekstura się zmieniła
        // Robimy to raz na klatkę, a nie co chunk, dla wydajności
        if (_bgTexture) {
            _bgTexture.needsUpdate = true;
        }

        // Raportuj postęp do UI
        const progress = currentChunk / totalChunks;
        if (onProgress) onProgress(progress);

        // Kolejna klatka
        requestAnimationFrame(processNextFrame);
    }

    processNextFrame();
}

export function getBackgroundCanvas() {
    return _bgCanvas;
}

// Placeholder dla kompatybilności starego kodu
export function resizeSpaceBg(w, h) {
    // Nic nie rób automatycznie, czekamy na startLiveGeneration
}

export const setBgOptions = (opts) => {};
