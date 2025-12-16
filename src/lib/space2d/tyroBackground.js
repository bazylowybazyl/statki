// src/lib/space2d/tyroBackground.js
import * as THREE from 'three';

// Ustawienia
const TEX_SIZE = 8192;     // Rozdzielczość 8K
const CHUNK_SIZE = 256;    // Wielkość jednego kafelka (kwadratu)
const DEBUG_CHUNKS = false; // <--- ZMIEŃ NA TRUE, JEŚLI CHCESZ WIDZIEĆ KOLOROWE KWADRATY PODCZAS ŁADOWANIA

let _bgCanvas = null;
let _bgContext = null;
let _bgTexture = null;
let _isGenerating = false;

// Deterministyczny generator liczb (dla spójności gwiazd)
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

// --- ALGORYTM SPIRALI (Kluczowa zmiana) ---
// Zwraca listę indeksów chunków posortowaną od środka na zewnątrz
function generateSpiralIndices(cols, rows) {
    const indices = [];
    const total = cols * rows;
    
    // Startujemy w samym środku siatki
    let x = Math.floor(cols / 2);
    let y = Math.floor(rows / 2);
    
    // Dodajemy środek jako pierwszy
    if (x >= 0 && x < cols && y >= 0 && y < rows) {
        indices.push(y * cols + x);
    }

    // Kierunki ruchu: 0=Prawo, 1=Dół, 2=Lewo, 3=Góra
    // (W Canvasie Y rośnie w dół, więc "Dół" to y++)
    const deltas = [
        { dx: 1, dy: 0 }, // Prawo
        { dx: 0, dy: 1 }, // Dół
        { dx: -1, dy: 0}, // Lewo
        { dx: 0, dy: -1}  // Góra
    ];

    let dir = 0;       // Aktualny kierunek
    let steps = 1;     // Długość boku spirali (rośnie co 2 zmiany kierunku)
    let stepsTaken = 0;
    let turnCounter = 0;

    // Pętla generująca kolejne kafelki
    // Zabezpieczenie 'safe' przed nieskończoną pętlą
    for (let safe = 0; safe < total * 2; safe++) {
        if (indices.length >= total) break;

        // Wykonaj krok
        x += deltas[dir].dx;
        y += deltas[dir].dy;
        stepsTaken++;

        // Jeśli jesteśmy wewnątrz obrazka, dodaj do listy
        if (x >= 0 && x < cols && y >= 0 && y < rows) {
            indices.push(y * cols + x);
        }

        // Czy czas na zakręt?
        if (stepsTaken >= steps) {
            stepsTaken = 0;
            dir = (dir + 1) % 4; // Obrót
            turnCounter++;
            
            // Co drugi zakręt wydłużamy krok (sekwencja: 1, 1, 2, 2, 3, 3...)
            if (turnCounter % 2 === 0) {
                steps++;
            }
        }
    }
    
    return new Int32Array(indices);
}

function drawStarsInChunk(ctx, x, y, w, h) {
    // Debug: Pokaż, który chunk jest rysowany (kolorowe tło)
    if (DEBUG_CHUNKS) {
        const r = Math.floor(random() * 50);
        const g = Math.floor(random() * 50);
        const b = Math.floor(random() * 100) + 50; // Niebieskawy
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, w, h);
    }

    // --- ZWIĘKSZONE GWIAZDY ---
    // Dla 8k musimy rysować większe gwiazdy, żeby było je widać
    // Normalnie 1px, tutaj damy 2-5px
    const area = w * h;
    const starCount = Math.floor(area * 0.0025); // Gęstość

    for (let i = 0; i < starCount; i++) {
        const lx = Math.floor(random() * w);
        const ly = Math.floor(random() * h);
        const px = x + lx;
        const py = y + ly;
        
        // Wielkość gwiazd skalowana pod 8k
        const sizeBase = random();
        let size = 1.5; 
        if (sizeBase > 0.98) size = 5.5;      // Bardzo jasne
        else if (sizeBase > 0.90) size = 3.5; // Średnie
        else size = 2.0;                      // Małe (ale wciąż 2px)

        const brightness = 0.4 + random() * 0.6;
        
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        
        // Rysujemy kółka zamiast prostokątów (ładniejsze przy skalowaniu)
        ctx.beginPath();
        ctx.arc(px, py, size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function startLiveGeneration(sceneRef, onProgress, onComplete) {
    if (_isGenerating || (_bgTexture && _bgTexture.userData.ready)) return;

    console.log(`[Tyro] Start generowania tła LIVE ${TEX_SIZE}x${TEX_SIZE} (Spiral Mode)...`);

    // 1. Setup Canvas
    if (!_bgCanvas) {
        _bgCanvas = document.createElement('canvas');
        _bgCanvas.width = TEX_SIZE;
        _bgCanvas.height = TEX_SIZE;
        _bgContext = _bgCanvas.getContext('2d', { alpha: false });
        
        // Czarne tło na start
        _bgContext.fillStyle = '#000000';
        _bgContext.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }

    // 2. Setup Texture
    if (!_bgTexture) {
        _bgTexture = new THREE.CanvasTexture(_bgCanvas);
        _bgTexture.colorSpace = THREE.SRGBColorSpace;
        _bgTexture.minFilter = THREE.LinearFilter;
        _bgTexture.magFilter = THREE.LinearFilter;
        _bgTexture.generateMipmaps = false; 
        _bgTexture.userData = { ready: false };
    }

    // 3. Przypisz do sceny
    if (sceneRef) {
        sceneRef.background = _bgTexture;
    } else {
        console.warn("[Tyro] Brak sceny 3D. Generuję w pamięci.");
    }

    // 4. Oblicz kolejność (SPIRALA)
    const cols = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const rows = Math.ceil(TEX_SIZE / CHUNK_SIZE);
    const totalChunks = cols * rows;
    
    // Tu generujemy "mapę drogową" dla generatora
    const chunkIndices = generateSpiralIndices(cols, rows);

    let processedCount = 0;
    _isGenerating = true;

    function processNextFrame() {
        if (processedCount >= chunkIndices.length) {
            _isGenerating = false;
            _bgTexture.userData.ready = true;
            _bgTexture.needsUpdate = true;
            console.log(`[Tyro] Generowanie tła zakończone.`);
            if (onComplete) onComplete();
            return;
        }

        const startTime = performance.now();

        // 12ms budżetu na klatkę
        while (performance.now() - startTime < 12 && processedCount < chunkIndices.length) {
            // Pobierz indeks z naszej spiralnej listy
            const spiralIndex = chunkIndices[processedCount];
            
            const col = spiralIndex % cols;
            const row = Math.floor(spiralIndex / cols);
            const x = col * CHUNK_SIZE;
            const y = row * CHUNK_SIZE;

            drawStarsInChunk(_bgContext, x, y, CHUNK_SIZE, CHUNK_SIZE);
            processedCount++;
        }

        if (_bgTexture) {
            _bgTexture.needsUpdate = true;
        }

        const progress = processedCount / totalChunks;
        if (onProgress) onProgress(progress);

        requestAnimationFrame(processNextFrame);
    }

    processNextFrame();
}

export function getTexture() {
    return _bgTexture;
}

export function getBackgroundCanvas() {
    return _bgCanvas;
}

export function resizeSpaceBg(w, h) {}
export const setBgOptions = (opts) => {};
