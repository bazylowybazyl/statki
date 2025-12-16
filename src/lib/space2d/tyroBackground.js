"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

// KOLORY GWIAZD TYRO (Black Body Radiation)
const blackBodyColors = [
  [1.0, 0.0401, 0.003], [1.0, 0.0631, 0.003], [1.0, 0.086, 0.003], [1.0, 0.1085, 0.003], [1.0, 0.1303, 0.003],
  [1.0, 0.2097, 0.003], [1.0, 0.2272, 0.003], [1.0, 0.2484, 0.0061], [1.0, 0.2709, 0.0153], [1.0, 0.293, 0.0257],
  [1.0, 0.3577, 0.064], [1.0, 0.3786, 0.079], [1.0, 0.3992, 0.095], [1.0, 0.4195, 0.1119], [1.0, 0.4394, 0.1297],
  [1.0, 0.497, 0.1879], [1.0, 0.5155, 0.2087], [1.0, 0.5336, 0.2301], [1.0, 0.5515, 0.252], [1.0, 0.5689, 0.2745],
  [1.0, 0.6354, 0.3684], [1.0, 0.6511, 0.3927], [1.0, 0.6666, 0.4172], [1.0, 0.6817, 0.4419], [1.0, 0.6966, 0.4668],
  [1.0, 0.7661, 0.5928], [1.0, 0.7792, 0.618], [1.0, 0.7919, 0.6433], [1.0, 0.8044, 0.6685], [1.0, 0.8167, 0.6937],
  [1.0, 0.8847, 0.8424], [1.0, 0.8952, 0.8666], [1.0, 0.9055, 0.8907], [1.0, 0.9156, 0.9147], [1.0, 0.9254, 0.9384],
  [0.9917, 0.9458, 1.0], [0.9696, 0.9336, 1.0], [0.9488, 0.9219, 1.0], [0.929, 0.9107, 1.0], [0.9102, 0.9, 1.0],
  [0.8591, 0.8704, 1.0], [0.8437, 0.8614, 1.0], [0.8289, 0.8527, 1.0], [0.8149, 0.8443, 1.0], [0.8014, 0.8363, 1.0],
  [0.7423, 0.8002, 1.0], [0.7319, 0.7938, 1.0], [0.7219, 0.7875, 1.0], [0.7123, 0.7815, 1.0], [0.703, 0.7757, 1.0],
  [0.6617, 0.7492, 1.0], [0.6543, 0.7444, 1.0], [0.6471, 0.7397, 1.0], [0.6402, 0.7352, 1.0], [0.6335, 0.7308, 1.0],
  [0.5873, 0.6998, 1.0], [0.5823, 0.6964, 1.0], [0.5774, 0.693, 1.0], [0.5727, 0.6898, 1.0], [0.5681, 0.6866, 1.0],
  [0.5394, 0.6666, 1.0], [0.5357, 0.664, 1.0], [0.5322, 0.6615, 1.0], [0.5287, 0.659, 1.0], [0.5253, 0.6566, 1.0]
];

// --- KONFIGURACJA CHUNKÓW ---
const CHUNK_SIZE = 1024; // Rozmiar kafelka (piksele świata gry)
const CACHE_LIMIT = 50;  // Ile kafelków trzymać w pamięci (zabezpieczenie RAM)

let newBg = null;
const chunkCache = new Map(); // Cache wygenerowanych kafelków

// --- STAN GUI ---
const guiState = {
  seed: 'statki',
  
  // Twoje ustawienia ("The Best"):
  scale: 0.0022,
  falloff: 300,
  density: 0.5,
  layers: 1360,
  lightFalloff: 500.0,
  
  colors: {
    base: [0.1, 0.4, 1.0], 
    var:  [0.2, 0.3, 0.5]  
  },
  
  isVisible: true
};

// --- TWORZENIE GUI ---
function createGUI() {
  if (document.getElementById('nebula-gui')) return;

  const root = document.createElement('div');
  root.id = 'nebula-gui';
  root.style.cssText = `
    position: fixed; top: 10px; left: 10px; width: 260px;
    background: rgba(10, 15, 20, 0.9); color: #bde;
    border: 1px solid #357; border-radius: 6px;
    padding: 10px; font-family: monospace; font-size: 11px;
    z-index: 100000; box-shadow: 0 4px 16px rgba(0,0,0,0.8);
  `;

  const header = document.createElement('div');
  header.textContent = "NEBULA GENERATOR (F9)";
  header.style.cssText = "text-align:center; font-weight:bold; margin-bottom:8px; color:#fff;";
  root.appendChild(header);

  // --- Seed ---
  const rowSeed = document.createElement('div');
  rowSeed.style.cssText = "display:flex; gap:4px; margin-bottom:8px;";
  
  const inpSeed = document.createElement('input');
  inpSeed.value = guiState.seed;
  inpSeed.style.cssText = "flex:1; background:#000; border:1px solid #468; color:#fff; padding:2px;";
  inpSeed.addEventListener('change', e => { guiState.seed = e.target.value; clearCache(); });
  
  const btnRandSeed = document.createElement('button');
  btnRandSeed.textContent = "RND";
  btnRandSeed.style.cssText = "background:#246; color:#fff; border:1px solid #468; cursor:pointer;";
  btnRandSeed.addEventListener('click', () => {
    guiState.seed = Math.random().toString(36).slice(2, 9);
    inpSeed.value = guiState.seed;
    clearCache();
  });
  
  rowSeed.appendChild(inpSeed);
  rowSeed.appendChild(btnRandSeed);
  root.appendChild(rowSeed);

  // --- Sliders Helper ---
  const addSlider = (label, key, min, max, step) => {
    const row = document.createElement('div');
    row.style.cssText = "display:flex; align-items:center; margin-bottom:4px;";
    
    const txt = document.createElement('span');
    txt.textContent = label;
    txt.style.width = "70px";
    
    const range = document.createElement('input');
    range.type = 'range'; range.min = min; range.max = max; range.step = step;
    range.value = guiState[key];
    range.style.cssText = "flex:1; cursor:pointer;";
    
    const val = document.createElement('span');
    val.textContent = guiState[key];
    val.style.cssText = "width:40px; text-align:right;";
    
    range.addEventListener('input', e => {
      guiState[key] = Number(e.target.value);
      val.textContent = guiState[key];
    });
    range.addEventListener('change', () => clearCache()); // Po zmianie czyścimy cache, żeby przerysować
    
    guiState['_el_' + key] = { range, val };

    row.appendChild(txt);
    row.appendChild(range);
    row.appendChild(val);
    root.appendChild(row);
  };

  addSlider("Scale", "scale", 0.0001, 0.005, 0.0001);
  addSlider("Falloff", "falloff", 10, 1500, 10);
  addSlider("Density", "density", 0.1, 2.0, 0.1);
  addSlider("Light", "lightFalloff", 50, 1000, 10);
  addSlider("Layers", "layers", 10, 2000, 10);

  // --- Randomize Params Button ---
  const btnRandParams = document.createElement('button');
  btnRandParams.textContent = "Losuj Parametry (Tyro Style)";
  btnRandParams.style.cssText = "width:100%; margin-top:10px; padding:6px; background:#264; color:#fff; border:1px solid #486; cursor:pointer; font-weight:bold;";
  btnRandParams.addEventListener('click', randomizeParams);
  root.appendChild(btnRandParams);

  document.body.appendChild(root);

  // F9 Toggle
  window.addEventListener('keydown', e => {
    if (e.code === 'F9') {
      guiState.isVisible = !guiState.isVisible;
      root.style.display = guiState.isVisible ? 'block' : 'none';
    }
  });
}

function updateGUI() {
  for (const key in guiState) {
    const el = guiState['_el_' + key];
    if (el) {
      el.range.value = guiState[key];
      el.val.textContent = typeof guiState[key] === 'number' ? guiState[key].toFixed(4) : guiState[key];
    }
  }
}

function randomizeParams() {
  const prng = Alea(Math.random()); 
  guiState.scale = 0.001 + prng() * 0.001;
  guiState.falloff = Math.floor(256 + prng() * 1024);
  guiState.density = 0.5 + prng() * 0.5; 
  updateGUI();
  clearCache();
}

function clearCache() {
    chunkCache.clear();
    console.log('[Nebula] Cache wyczyszczony. Generowanie nowych chunków...');
}

// --- LOGIKA RENDEROWANIA (CHUNKING) ---

export function initSpaceBg(seedStr = null){
  createGUI();
  if (seedStr) guiState.seed = String(seedStr);
  if (!newBg) newBg = new Space2D();
  return true;
}

export function resizeSpaceBg(w, h){
  // W systemie chunkowym resize nie wymaga reinicjalizacji
}

// Funkcja generująca pojedynczy kafelek
function generateChunk(chunkX, chunkY) {
    if (!newBg) newBg = new Space2D();
    
    // Obliczamy światowe współrzędne rogu chunka
    // Uwaga: offset w shaderze przesuwa szum.
    // Musimy przekazać pozycję chunka jako offset.
    const worldX = chunkX * CHUNK_SIZE;
    const worldY = chunkY * CHUNK_SIZE;
    
    const prng = Alea(guiState.seed); // Seed ten sam dla spójności gwiazd
    
    // --- GEN GWIAZD ---
    const stars = [];
    // Generujemy gwiazdy tylko w obrębie tego chunka (plus margines)
    // Ale w tym systemie offset jest globalny, więc generujemy gwiazdy "lokalnie"
    // To uproszczenie: generujemy zestaw gwiazd, który jest powtarzany/przesuwany, 
    // LUB (lepiej) generujemy je proceduralnie w shaderze (ale shader Tyro używa listy).
    
    // Wariant "Tyro": Stała lista gwiazd przesunięta o offset chunka?
    // Nie, Tyro generuje gwiazdy raz dla całego widoku.
    // My musimy wygenerować gwiazdy, które "siedzą" w tym chunku.
    
    // UPROSZCZENIE DLA WYDAJNOŚCI: 
    // Generujemy losowe gwiazdy RELATYWNIE do chunka, używając koordynatów chunka jako seeda.
    const chunkPrng = Alea(guiState.seed + "_" + chunkX + "_" + chunkY);
    const nStars = Math.min(32, 1 + Math.round(chunkPrng() * (CHUNK_SIZE * CHUNK_SIZE) * guiState.scale * guiState.scale));
    
    for (let i = 0; i < nStars; i++) {
        const color = blackBodyColors[Math.floor(chunkPrng() * blackBodyColors.length)].slice();
        const intensity = 0.5 + chunkPrng() * 0.5; 
        color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;

        stars.push({
            // Pozycja lokalna wewnątrz chunka (0..CHUNK_SIZE)
            // Shader Nebula oczekuje pozycji ekranowej, więc to jest OK
            // jeśli przekażemy odpowiedni offset.
            position: [
                chunkPrng() * CHUNK_SIZE, 
                chunkPrng() * CHUNK_SIZE, 
                chunkPrng() * 500
            ],
            color: color,
            falloff: 256,
            diffractionSpikeFalloff: 1024,
            diffractionSpikeScale: 4 + 4 * chunkPrng(),
        });
    }

    const backgroundColor = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
    const bgInt = 0.5 * prng();
    backgroundColor[0] *= bgInt; backgroundColor[1] *= bgInt; backgroundColor[2] *= bgInt;

    // Renderujemy do canvasa
    const chunkCanvas = newBg.render(CHUNK_SIZE, CHUNK_SIZE, {
      stars,
      // OFFSET: To jest klucz do ciągłości!
      // Przekazujemy globalną pozycję chunka.
      offset: [worldX, worldY], 
      backgroundColor,
      
      scale: guiState.scale,
      nebulaFalloff: guiState.falloff,
      nebulaDensity: guiState.density / guiState.layers * 100, 
      nebulaLayers: guiState.layers,
      lightFalloff: guiState.lightFalloff,
      
      nebulaLacunarity: 1.8 + 0.2 * prng(),
      nebulaGain: 0.5,
      nebulaAbsorption: 1.0,
      
      nebulaAlbedoLow: [prng(), prng(), prng()],
      nebulaAlbedoHigh: [prng(), prng(), prng()],
      nebulaAlbedoScale: prng() * 8,
      
      nebulaEmissiveLow: [0, 0, 0],
      nebulaEmissiveHigh: [0, 0, 0],
    });
    
    return chunkCanvas;
}

export function drawSpaceBg(mainCtx, camera){
  if (!newBg) return;
  const screenW = mainCtx.canvas.width; const screenH = mainCtx.canvas.height;

  // Zoom i pozycja kamery
  const zoom = camera ? (camera.zoom || 1.0) : 1.0;
  // Przy "True Infinite" chcemy widzieć dokładnie to, co jest na tych współrzędnych
  const camX = camera ? camera.x : 0;
  const camY = camera ? camera.y : 0;

  // Obliczamy, jaki obszar świata (w pikselach gry) jest widoczny na ekranie
  const visibleW = screenW / zoom;
  const visibleH = screenH / zoom;
  
  const left = camX - visibleW / 2;
  const top = camY - visibleH / 2;
  const right = left + visibleW;
  const bottom = top + visibleH;

  // Obliczamy indeksy kafelków, które pokrywają ten obszar
  const startCol = Math.floor(left / CHUNK_SIZE);
  const endCol = Math.floor(right / CHUNK_SIZE);
  const startRow = Math.floor(top / CHUNK_SIZE);
  const endRow = Math.floor(bottom / CHUNK_SIZE);

  // Zarządzanie Cache (usuwamy stare kafelki, które są daleko)
  if (chunkCache.size > CACHE_LIMIT) {
      for (const [key, val] of chunkCache) {
          const [cx, cy] = key.split('_').map(Number);
          // Jeśli kafelek jest bardzo daleko od kamery, usuń
          if (cx < startCol - 2 || cx > endCol + 2 || cy < startRow - 2 || cy > endRow + 2) {
              chunkCache.delete(key);
          }
      }
  }

  // Rysowanie (z generowaniem brakujących)
  for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
          const key = `${col}_${row}`;
          let chunk = chunkCache.get(key);

          if (!chunk) {
              chunk = generateChunk(col, row);
              chunkCache.set(key, chunk);
          }

          // Pozycja kafelka na ekranie
          // (WorldPos - CameraPos) * Zoom + CenterOffset
          const worldX = col * CHUNK_SIZE;
          const worldY = row * CHUNK_SIZE;
          
          const screenX = (worldX - camX) * zoom + screenW / 2;
          const screenY = (worldY - camY) * zoom + screenH / 2;
          const drawSize = CHUNK_SIZE * zoom;

          // Rysujemy. Dodajemy +1 do rozmiaru, żeby załatać ewentualne mikroszczeliny przy zoomie
          mainCtx.drawImage(chunk, Math.floor(screenX), Math.floor(screenY), Math.ceil(drawSize)+1, Math.ceil(drawSize)+1);
      }
  }
}

// Globalne API
window.Nebula = guiState;

let opts = { newSystemEnabled: true };
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ guiState.seed = String(seed); clearCache(); }
export function setParallaxOptions(partial){ } // Niepotrzebne w trybie True Infinite
export function getBackgroundCanvas(){ return null; } // Brak jednego canvasa
export function getBackgroundSampleDescriptor(){ return null; }
