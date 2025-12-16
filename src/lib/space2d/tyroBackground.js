"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

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

// Cache kafelków
const chunks = new Map(); 
const CACHE_LIMIT = 40; 
let newBg = null;

// --- STAN GUI ---
const guiState = {
  seed: 'statki',
  
  // Twoje ustawienia:
  resolution: 2048, 
  scale: 0.0024,
  falloff: 300,
  density: 0.5,
  layers: 200, // Zmniejszyłem startowo do 200 dla szybkości, w grze możesz dać 1360
  lightFalloff: 500.0,
  
  isVisible: true,

  redraw: () => {
    console.log(`[Nebula] Czyszczenie cache...`);
    chunks.clear(); // Wymusza regenerację widocznych kafelków
  },
  
  randomize: () => {
    guiState.seed = Math.random().toString(36).slice(2, 9);
    chunks.clear();
  }
};

// --- GUI ---
function createGUI() {
  if (document.getElementById('nebula-gui')) return;
  const root = document.createElement('div');
  root.id = 'nebula-gui';
  root.style.cssText = `position:fixed;top:10px;left:10px;width:260px;background:rgba(10,15,20,0.9);color:#bde;border:1px solid #357;border-radius:6px;padding:10px;font-family:monospace;font-size:11px;z-index:100000;`;
  
  const header = document.createElement('div');
  header.textContent = "NEBULA GENERATOR (F9)";
  header.style.textAlign = "center";
  root.appendChild(header);

  const addSlider = (label, key, min, max, step) => {
    const row = document.createElement('div');
    row.style.cssText = "display:flex;align-items:center;margin:4px 0;";
    const txt = document.createElement('span'); txt.textContent = label; txt.style.width = "70px";
    const inp = document.createElement('input'); 
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = guiState[key]; inp.style.flex = "1";
    const val = document.createElement('span'); val.textContent = guiState[key]; val.style.width = "40px"; val.style.textAlign = "right";
    
    inp.addEventListener('input', e => { guiState[key] = Number(e.target.value); val.textContent = guiState[key]; });
    inp.addEventListener('change', () => guiState.redraw());
    row.append(txt, inp, val); root.appendChild(row);
  };

  addSlider("Scale", "scale", 0.0001, 0.005, 0.0001);
  addSlider("Falloff", "falloff", 10, 1500, 10);
  addSlider("Density", "density", 0.1, 2.0, 0.1);
  addSlider("Light", "lightFalloff", 50, 1000, 10);
  addSlider("Layers", "layers", 10, 2000, 10);

  const btnRand = document.createElement('button');
  btnRand.textContent = "Random Seed";
  btnRand.style.cssText = "width:100%;margin-top:10px;padding:5px;cursor:pointer;";
  btnRand.addEventListener('click', guiState.randomize);
  root.appendChild(btnRand);

  document.body.appendChild(root);
  window.addEventListener('keydown', e => {
    if(e.code === 'F9') { guiState.isVisible = !guiState.isVisible; root.style.display = guiState.isVisible ? 'block' : 'none'; }
  });
}

// --- GENEROWANIE KAFELKA ---
function generateChunk(cx, cy) {
    if (!newBg) newBg = new Space2D();
    
    const size = guiState.resolution;
    // Pozycja w świecie gry
    const worldX = cx * size;
    const worldY = cy * size;
    
    // Seed zależny od pozycji kafelka (deterministyczny)
    const chunkPrng = Alea(guiState.seed + "_" + cx + "_" + cy);
    const prng = Alea(guiState.seed);

    // --- GWIAZDY ---
    const stars = [];
    const nStars = Math.min(64, 1 + Math.round(chunkPrng() * (size * size) * guiState.scale * guiState.scale * 0.000001)); 

    for (let i = 0; i < 40; i++) { 
        const color = blackBodyColors[Math.floor(chunkPrng() * blackBodyColors.length)].slice();
        const intensity = 0.5 + chunkPrng() * 0.5; 
        color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;

        stars.push({
            // FIX: Gwiazdy muszą być w GLOBALNYCH współrzędnych, bo shader używa globalnego offsetu!
            position: [
                worldX + chunkPrng() * size, 
                worldY + chunkPrng() * size, 
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

    // Render WebGL
    const webglCanvas = newBg.render(size, size, {
      stars,
      offset: [worldX, worldY], // GLOBALNY OFFSET
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

    // Kopiujemy wynik WebGL do statycznego obrazka (Snapshot)
    const snapshot = document.createElement('canvas');
    snapshot.width = size; snapshot.height = size;
    const ctx = snapshot.getContext('2d');
    
    // Tło bezpieczeństwa (Żeby nigdy nie było pusto)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    
    ctx.drawImage(webglCanvas, 0, 0);
    return snapshot;
}

// --- INIT ---
export function initSpaceBg(seedStr = null){
  createGUI();
  if (seedStr) guiState.seed = String(seedStr);
  chunks.clear();
  return true;
}

export function resizeSpaceBg(w, h){}

// --- RYSOWANIE (Dynamiczne) ---
export function drawSpaceBg(mainCtx, camera){
  // 1. CZYŚCIMY EKRAN NA CZARNO
  // Jeśli to zadziała, stary background CSS powinien zniknąć.
  mainCtx.fillStyle = '#000000';
  mainCtx.fillRect(0, 0, mainCtx.canvas.width, mainCtx.canvas.height);

  // Ustawienia kamery
  const camX = camera ? (camera.x || 0) : 0;
  const camY = camera ? (camera.y || 0) : 0;
  const zoom = camera ? (camera.zoom || 1.0) : 1.0;

  const screenW = mainCtx.canvas.width; 
  const screenH = mainCtx.canvas.height;
  const halfW = screenW / 2;
  const halfH = screenH / 2;

  const CHUNK_SIZE = guiState.resolution;
  
  // Paralaksa zoomu
  const drawScale = Math.max(0.001, Math.pow(zoom, 0.6)); 
  const tileDrawSize = CHUNK_SIZE * drawScale;

  // Przesuwamy tło wolniej niż kamerę (paralaksa)
  const viewCenterX = camX * 0.8; 
  const viewCenterY = camY * 0.8;

  // Obliczamy widoczny obszar w świecie kafelków
  const worldLeft = viewCenterX - (halfW / drawScale);
  const worldTop  = viewCenterY - (halfH / drawScale);
  const worldRight = viewCenterX + (halfW / drawScale);
  const worldBottom = viewCenterY + (halfH / drawScale);

  const startCol = Math.floor(worldLeft / CHUNK_SIZE);
  const endCol   = Math.floor(worldRight / CHUNK_SIZE);
  const startRow = Math.floor(worldTop / CHUNK_SIZE);
  const endRow   = Math.floor(worldBottom / CHUNK_SIZE);

  // Garbage Collector dla kafelków
  if (chunks.size > CACHE_LIMIT) {
      for (const key of chunks.keys()) {
          const [cx, cy] = key.split('_').map(Number);
          if (cx < startCol - 2 || cx > endCol + 2 || cy < startRow - 2 || cy > endRow + 2) {
              chunks.delete(key);
          }
      }
  }

  // Rysujemy kafelki (generując brakujące)
  for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
          const key = `${col}_${row}`;
          let chunk = chunks.get(key);

          // Lazy load
          if (!chunk) {
              chunk = generateChunk(col, row);
              chunks.set(key, chunk);
          }

          const worldX = col * CHUNK_SIZE;
          const worldY = row * CHUNK_SIZE;
          
          const screenX = (worldX - viewCenterX) * drawScale + halfW;
          const screenY = (worldY - viewCenterY) * drawScale + halfH;

          // +2px na łączenia
          mainCtx.drawImage(chunk, 
              Math.floor(screenX), Math.floor(screenY), 
              Math.ceil(tileDrawSize)+2, Math.ceil(tileDrawSize)+2
          );
      }
  }

  // --- DEBUG: CZERWONY KRZYŻ ---
  // Jeśli to widzisz, funkcja drawSpaceBg działa!
  mainCtx.save();
  mainCtx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
  mainCtx.lineWidth = 2;
  mainCtx.beginPath();
  mainCtx.moveTo(halfW - 20, halfH); mainCtx.lineTo(halfW + 20, halfH);
  mainCtx.moveTo(halfW, halfH - 20); mainCtx.lineTo(halfW, halfH + 20);
  mainCtx.stroke();
  mainCtx.restore();
}

window.Nebula = guiState;
let opts = { newSystemEnabled: true };
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ guiState.seed = String(seed); chunks.clear(); }
export function setParallaxOptions(partial){ }
export function getBackgroundCanvas(){ return null; }
export function getBackgroundSampleDescriptor(){ return null; }
