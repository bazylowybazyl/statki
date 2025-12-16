"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

// --- KONFIGURACJA ŚWIATA ---
const CHUNK_SIZE = 4096; // Rozmiar jednego kafla (zgodnie z życzeniem)
const RENDER_RADIUS = 1; // Ile kafli w każdą stronę (1 = 3x3 grid, 2 = 5x5 grid)

// Cache na wygenerowane kafelki { "x_y": Canvas }
const chunks = new Map();
let newBg = null;

// KOLORY GWIAZD (Tyro Style)
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

// --- PANEL STEROWANIA ---
window.Nebula = {
  seed: 'statki',
  
  // Twoje wybrane parametry:
  scale: 0.0024,
  falloff: 300,
  density: 0.5,
  lightFalloff: 500.0,
  layers: 1360,
  
  isVisible: true,

  redraw: () => {
    console.log(`[Nebula] Przerysowywanie gridu 3x3...`);
    setTimeout(() => initSpaceBg(window.Nebula.seed), 10);
  },
  
  randomize: () => {
    const newSeed = Math.random().toString(36).slice(2, 9);
    console.log(`[Nebula] Nowy seed: "${newSeed}"`);
    window.Nebula.seed = newSeed;
    initSpaceBg(newSeed);
  }
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
  inpSeed.value = window.Nebula.seed;
  inpSeed.style.cssText = "flex:1; background:#000; border:1px solid #468; color:#fff; padding:2px;";
  inpSeed.addEventListener('change', e => { window.Nebula.seed = e.target.value; window.Nebula.redraw(); });
  
  const btnRandSeed = document.createElement('button');
  btnRandSeed.textContent = "RND";
  btnRandSeed.style.cssText = "background:#246; color:#fff; border:1px solid #468; cursor:pointer;";
  btnRandSeed.addEventListener('click', window.Nebula.randomize);
  
  rowSeed.appendChild(inpSeed);
  rowSeed.appendChild(btnRandSeed);
  root.appendChild(rowSeed);

  // --- Sliders Helper ---
  const addSlider = (label, key, min, max, step) => {
    const row = document.createElement('div');
    row.style.cssText = "display:flex; align-items:center; margin-bottom:4px;";
    const txt = document.createElement('span'); txt.textContent = label; txt.style.width = "70px";
    const range = document.createElement('input');
    range.type = 'range'; range.min = min; range.max = max; range.step = step;
    range.value = window.Nebula[key];
    range.style.cssText = "flex:1; cursor:pointer;";
    const val = document.createElement('span'); val.textContent = window.Nebula[key]; val.style.cssText = "width:40px; text-align:right;";
    
    range.addEventListener('input', e => { window.Nebula[key] = Number(e.target.value); val.textContent = window.Nebula[key]; });
    range.addEventListener('change', () => window.Nebula.redraw());
    
    row.appendChild(txt); row.appendChild(range); row.appendChild(val);
    root.appendChild(row);
  };

  addSlider("Scale", "scale", 0.0001, 0.005, 0.0001);
  addSlider("Falloff", "falloff", 10, 1500, 10);
  addSlider("Density", "density", 0.1, 2.0, 0.1);
  addSlider("Light", "lightFalloff", 50, 1000, 10);
  addSlider("Layers", "layers", 10, 2000, 10);

  document.body.appendChild(root);

  window.addEventListener('keydown', e => {
    if (e.code === 'F9') {
      window.Nebula.isVisible = !window.Nebula.isVisible;
      root.style.display = window.Nebula.isVisible ? 'block' : 'none';
    }
  });
}

// --- GENERATOR KAFELKA ---
function generateChunk(cx, cy) {
    if (!newBg) newBg = new Space2D();
    
    // Obliczamy offset świata dla tego konkretnego kafelka
    const worldX = cx * CHUNK_SIZE;
    const worldY = cy * CHUNK_SIZE;
    
    const prng = Alea(window.Nebula.seed);
    const chunkPrng = Alea(window.Nebula.seed + "_" + cx + "_" + cy);

    // --- GEN GWIAZD DLA TEGO KAFELKA ---
    const stars = [];
    const nStars = Math.min(64, 1 + Math.round(chunkPrng() * (CHUNK_SIZE * CHUNK_SIZE) * window.Nebula.scale * window.Nebula.scale * 0.000001)); 
    // Uwaga: Skalujemy ilość gwiazd, bo CHUNK_SIZE jest duży

    for (let i = 0; i < 40; i++) { // Stała liczba gwiazd na chunk dla pewności
        const color = blackBodyColors[Math.floor(chunkPrng() * blackBodyColors.length)].slice();
        const intensity = 0.5 + chunkPrng() * 0.5; 
        color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;

        stars.push({
            // Gwiazdy pozycjonujemy wewnątrz kafelka (0..CHUNK_SIZE)
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

    // Renderujemy kafelek
    return newBg.render(CHUNK_SIZE, CHUNK_SIZE, {
      stars,
      // KLUCZOWE: Offset przesuwa szum proceduralny w odpowiednie miejsce we wszechświecie
      offset: [worldX, worldY],
      backgroundColor,
      
      scale: window.Nebula.scale,
      nebulaFalloff: window.Nebula.falloff,
      nebulaDensity: window.Nebula.density / window.Nebula.layers * 100, 
      nebulaLayers: window.Nebula.layers,
      lightFalloff: window.Nebula.lightFalloff,
      
      nebulaLacunarity: 1.8 + 0.2 * prng(),
      nebulaGain: 0.5,
      nebulaAbsorption: 1.0,
      
      nebulaAlbedoLow: [prng(), prng(), prng()],
      nebulaAlbedoHigh: [prng(), prng(), prng()],
      nebulaAlbedoScale: prng() * 8,
      
      nebulaEmissiveLow: [0, 0, 0],
      nebulaEmissiveHigh: [0, 0, 0],
    });
}

// --- INITIALIZACJA ---
export function initSpaceBg(seedStr = null){
  createGUI();
  if (seedStr) window.Nebula.seed = String(seedStr);
  
  chunks.clear();
  console.log(`[Tyro] Generowanie startowych kafelków (3x3) wokół (0,0)...`);
  
  // Generujemy statycznie 9 kafelków wokół punktu (0,0)
  for (let x = -RENDER_RADIUS; x <= RENDER_RADIUS; x++) {
      for (let y = -RENDER_RADIUS; y <= RENDER_RADIUS; y++) {
          const key = `${x}_${y}`;
          const chunk = generateChunk(x, y);
          chunks.set(key, chunk);
      }
  }
  console.log(`[Tyro] Wygenerowano ${chunks.size} kafelków.`);
  return true;
}

export function resizeSpaceBg(w, h){
  // Brak akcji przy resize w systemie kafelkowym
}

// --- RYSOWANIE ---
export function drawSpaceBg(mainCtx, camera){
  if (chunks.size === 0) return;

  const screenW = mainCtx.canvas.width; 
  const screenH = mainCtx.canvas.height;
  
  // Pobieramy dane kamery (domyślnie 0,0,1 jeśli brak)
  const camX = camera ? (camera.x || 0) : 0;
  const camY = camera ? (camera.y || 0) : 0;
  const zoom = camera ? (camera.zoom || 1.0) : 1.0;

  // Środek ekranu
  const halfW = screenW / 2;
  const halfH = screenH / 2;

  // Rysujemy wszystkie wygenerowane kafelki
  // (W przyszłości tu będzie logika sprawdzająca czy kafel jest na ekranie)
  for (const [key, canvas] of chunks) {
      const [cx, cy] = key.split('_').map(Number);
      
      // Pozycja kafelka w świecie gry (lewy górny róg)
      const worldX = cx * CHUNK_SIZE;
      const worldY = cy * CHUNK_SIZE;
      
      // Projekcja na ekran (World -> Screen)
      // (WorldPos - CameraPos) * Zoom + ScreenCenter
      const screenX = (worldX - camX) * zoom + halfW;
      const screenY = (worldY - camY) * zoom + halfH;
      
      // Rozmiar na ekranie
      const drawSize = CHUNK_SIZE * zoom;
      
      // Optymalizacja: Rysuj tylko jeśli widoczne (Frustum Culling)
      if (screenX + drawSize > 0 && screenX < screenW && 
          screenY + drawSize > 0 && screenY < screenH) {
          
          // Rysujemy bez szpar (+1 px na łączeniach)
          // Math.floor na pozycję zapobiega drżeniu
          mainCtx.drawImage(canvas, 
              Math.floor(screenX), 
              Math.floor(screenY), 
              Math.ceil(drawSize) + 1, 
              Math.ceil(drawSize) + 1
          );
      }
  }
}

// Experty API
let opts = { newSystemEnabled: true };
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ window.Nebula.seed = String(seed); initSpaceBg(); }
export function setParallaxOptions(partial){ }
export function getBackgroundCanvas(){ return null; }
export function getBackgroundSampleDescriptor(){ return null; }
