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

const TILE_SCALE = 1.0; 
let finalCanvas = null; 
let newBg = null;

// --- STAN GUI ---
const guiState = {
  seed: 'statki',
  resolution: 2048,
  
  // Twoje ustawienia ("The Best"):
  scale: 0.0024,
  falloff: 300,
  density: 0.5,
  layers: 1360,
  lightFalloff: 500.0,
  
  // Kolory gwiazd oświetlających (R, G, B)
  colors: {
    base: [0.1, 0.4, 1.0], 
    var:  [0.2, 0.3, 0.5]  
  },
  
  // Stan okna
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
  inpSeed.addEventListener('change', e => { guiState.seed = e.target.value; redraw(); });
  
  const btnRandSeed = document.createElement('button');
  btnRandSeed.textContent = "RND";
  btnRandSeed.style.cssText = "background:#246; color:#fff; border:1px solid #468; cursor:pointer;";
  btnRandSeed.addEventListener('click', () => {
    guiState.seed = Math.random().toString(36).slice(2, 9);
    inpSeed.value = guiState.seed;
    redraw();
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
    range.addEventListener('change', () => redraw()); // Redraw on release
    
    // Zapisz referencję do aktualizacji z kodu
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

  // --- Resolution ---
  const rowRes = document.createElement('div');
  rowRes.style.cssText = "margin-top:8px; display:flex; align-items:center; justify-content:space-between;";
  const lblRes = document.createElement('span'); lblRes.textContent = "Rozdzielczość:";
  const selRes = document.createElement('select');
  selRes.style.cssText = "background:#000; color:#fff; border:1px solid #468;";
  [1024, 2048, 4096].forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r + "px";
    if(r === guiState.resolution) opt.selected = true;
    selRes.appendChild(opt);
  });
  selRes.addEventListener('change', e => {
    guiState.resolution = Number(e.target.value);
    redraw();
  });
  rowRes.appendChild(lblRes);
  rowRes.appendChild(selRes);
  root.appendChild(rowRes);

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
  redraw();
}

function redraw() {
  const status = document.getElementById('nebula-gui');
  if(status) status.style.opacity = "0.5";
  setTimeout(() => {
    initSpaceBg(guiState.seed);
    if(status) status.style.opacity = "1.0";
  }, 10);
}

// --- LOGIKA RENDEROWANIA ---

const parallaxState = {
  enabled: true, factorX: 0.05, factorY: 0.05, smoothing: 0.2,
  offsetX: 0, offsetY: 0, targetX: 0, targetY: 0,
};

function ensureFinalCanvas(w, h){
  const size = guiState.resolution;
  const targetW = Math.max(size, w); 
  const targetH = Math.max(size, h);
  if (!finalCanvas) finalCanvas = document.createElement('canvas');
  if (finalCanvas.width !== targetW || finalCanvas.height !== targetH) {
    finalCanvas.width = targetW; finalCanvas.height = targetH;
    return true; 
  }
  return false;
}

export function initSpaceBg(seedStr = null){
  createGUI();
  ensureFinalCanvas(innerWidth, innerHeight);
  
  if (seedStr) guiState.seed = String(seedStr);
  const seed = guiState.seed;

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');
  const prng = Alea(seed);

  // Tło
  ctx.fillStyle = '#000000'; 
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // --- GEN GWIAZD ---
    const stars = [];
    // Ilość gwiazd zależna od skali (jak w demo)
    const nStars = Math.min(64, 1 + Math.round(prng() * (w * h) * guiState.scale * guiState.scale));
    
    const sceneOffset = [prng() * 10000000 - 5000000, prng() * 10000000 - 5000000];
    sceneOffset[0] -= 0.5 * w;
    sceneOffset[1] -= 0.5 * h;

    for (let i = 0; i < nStars; i++) {
        const color = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
        const intensity = 0.5 * prng(); 
        color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;

        stars.push({
            position: [
                sceneOffset[0] + prng() * w, 
                sceneOffset[1] + prng() * h, 
                prng() * 500
            ],
            color: color,
            falloff: 256,
            diffractionSpikeFalloff: 1024,
            diffractionSpikeScale: 4 + 4 * prng(),
        });
    }

    const backgroundColor = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
    const bgInt = 0.5 * prng();
    backgroundColor[0] *= bgInt; backgroundColor[1] *= bgInt; backgroundColor[2] *= bgInt;

    const newCanvas = newBg.render(w, h, {
      stars,
      offset: sceneOffset,
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
    
    ctx.globalCompositeOperation = 'source-over'; 
    ctx.drawImage(newCanvas, 0, 0);
  }
  return true;
}

export function resizeSpaceBg(w, h){
  parallaxState.offsetX = 0; parallaxState.offsetY = 0;
  if (w > finalCanvas.width || h > finalCanvas.height) initSpaceBg(guiState.seed);
}

export function drawSpaceBg(mainCtx, camera){
  if (!finalCanvas) return;
  const screenW = mainCtx.canvas.width; const screenH = mainCtx.canvas.height;
  const bgW = finalCanvas.width; const bgH = finalCanvas.height;

  // --- FIX: CENTROWANIE I ZOOM ---
  
  // Zoom
  const zoom = camera ? (camera.zoom || 1.0) : 1.0;
  // Paralaksa zoomu (tło skaluje się trochę wolniej dla efektu głębi)
  const drawScale = Math.max(0.001, Math.pow(zoom, 0.6)); 
  
  const tileW = bgW * drawScale;
  const tileH = bgH * drawScale;

  // Paralaksa ruchu
  if (parallaxState.enabled && camera) {
    const smooth = Math.max(0, Math.min(1, parallaxState.smoothing));
    parallaxState.targetX = (camera.x||0) * parallaxState.factorX;
    parallaxState.targetY = (camera.y||0) * parallaxState.factorY;
    if (smooth === 0) {
      parallaxState.offsetX = parallaxState.targetX; parallaxState.offsetY = parallaxState.targetY;
    } else {
      parallaxState.offsetX += (parallaxState.targetX - parallaxState.offsetX) * smooth;
      parallaxState.offsetY += (parallaxState.targetY - parallaxState.offsetY) * smooth;
    }
  }
  
  // Obliczamy punkt startowy tak, aby środek ekranu (W/2, H/2) był punktem odniesienia
  const halfW = screenW / 2;
  const halfH = screenH / 2;

  // Obliczamy przesunięcie w przestrzeni ekranu
  const panX = parallaxState.offsetX * drawScale;
  const panY = parallaxState.offsetY * drawScale;

  // Punkt, w którym "zaczepiona" jest siatka (środek ekranu minus przesunięcie)
  const anchorX = halfW - panX;
  const anchorY = halfH - panY;

  // Obliczamy fazę (resztę z dzielenia), żeby wiedzieć gdzie zacząć rysować kafelki
  const phaseX = ((anchorX % tileW) + tileW) % tileW;
  const phaseY = ((anchorY % tileH) + tileH) % tileH;

  // Startujemy jeden kafelek wcześniej, żeby na pewno pokryć lewą/górną krawędź
  const startX = phaseX - tileW;
  const startY = phaseY - tileH;

  for (let x = startX; x < screenW; x += tileW) {
    for (let y = startY; y < screenH; y += tileH) {
      // Używamy Math.ceil/floor żeby uniknąć linii między kaflami
      mainCtx.drawImage(finalCanvas, Math.floor(x), Math.floor(y), Math.ceil(tileW)+1, Math.ceil(tileH)+1);
    }
  }
}

// Zmienna globalna dla konsoli
window.Nebula = guiState;

let opts = { newSystemEnabled: true };
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ guiState.seed = String(seed); }
export function setParallaxOptions(partial){ if(partial) Object.assign(parallaxState, partial); }
export function getBackgroundCanvas(){ return finalCanvas; }
export function getBackgroundSampleDescriptor(){ 
  return finalCanvas ? { 
    canvas: finalCanvas, 
    tileWidth: finalCanvas.width, 
    tileHeight: finalCanvas.height, 
    offsetX: parallaxState.offsetX, 
    offsetY: parallaxState.offsetY, 
    parallaxEnabled: true 
  } : null; 
}
