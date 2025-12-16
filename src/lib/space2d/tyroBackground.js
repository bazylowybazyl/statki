"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

// KOLORY GWIAZD TYRO
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

let finalCanvas = null; 
let newBg = null;

// --- STAN GUI ---
const guiState = {
  seed: 'statki',
  
  // Konfiguracja
  resolutionMult: 3, // Mnożnik ekranu
  
  // Parametry
  scale: 0.0022,
  falloff: 300,
  density: 0.5,
  layers: 1360,
  lightFalloff: 500.0,
  
  // Ile gwiazd (mnożnik gęstości)
  starDensity: 1.0, 
  
  isVisible: true,

  redraw: () => {
    console.log(`[Nebula] Przerysowywanie...`);
    setTimeout(() => initSpaceBg(window.Nebula.seed), 50);
  },
  
  randomize: () => {
    guiState.seed = Math.random().toString(36).slice(2, 9);
    guiState.redraw();
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

  addSlider("Size (xScreen)", "resolutionMult", 1, 6, 1);
  addSlider("Scale", "scale", 0.0001, 0.005, 0.0001);
  addSlider("Falloff", "falloff", 10, 1500, 10);
  addSlider("Density", "density", 0.1, 2.0, 0.1);
  addSlider("Light", "lightFalloff", 50, 1000, 10);
  addSlider("Layers", "layers", 10, 2000, 10);
  addSlider("Stars", "starDensity", 0.1, 3.0, 0.1);

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

function ensureFinalCanvas(w, h){
  const mult = guiState.resolutionMult || 3;
  const targetW = Math.ceil(w * mult);
  const targetH = Math.ceil(h * mult);
  if (!finalCanvas) finalCanvas = document.createElement('canvas');
  if (finalCanvas.width !== targetW || finalCanvas.height !== targetH) {
    finalCanvas.width = targetW; finalCanvas.height = targetH;
    return true; 
  }
  return false;
}

// --- INIT (GENEROWANIE) ---
export function initSpaceBg(seedStr = null){
  createGUI();
  if (seedStr) guiState.seed = String(seedStr);
  
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  ensureFinalCanvas(screenW, screenH);
  
  const w = finalCanvas.width;
  const h = finalCanvas.height;
  
  if (!newBg) newBg = new Space2D();
  const prng = Alea(guiState.seed);

  // 1. GENERUJEMY OFFSET RAZ
  // To jest pozycja "kamery" w szumie proceduralnym.
  const randomOffset = [prng() * 1000000, prng() * 1000000];

  // 2. GENERUJEMY GWIAZDY Z UWZGLĘDNIENIEM OFFSETU
  const stars = [];
  // Gęstość gwiazd zależna od powierzchni
  const pixelArea = w * h;
  const baseStarCount = Math.floor(pixelArea / 12000); 
  const nStars = Math.floor(baseStarCount * guiState.starDensity);

  console.log(`[Tyro] Generowanie ${w}x${h}. Gwiazd: ${nStars}. Offset: ${randomOffset}`);

  for (let i = 0; i < nStars; i++) { 
      const color = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
      const intensity = 0.5 + prng() * 0.5; 
      color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;

      stars.push({
          position: [
              // FIX: Dodajemy offset do pozycji gwiazdy!
              // Dzięki temu gwiazda jest w tym samym miejscu co szum mgławicy.
              randomOffset[0] + prng() * w, 
              randomOffset[1] + prng() * h, 
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

  // 3. RENDERUJEMY TŁO
  const webglCanvas = newBg.render(w, h, {
    stars,
    offset: randomOffset, // Przekazujemy ten sam offset
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

  const ctx = finalCanvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(webglCanvas, 0, 0);
  
  return true;
}

export function resizeSpaceBg(w, h){}

// --- RYSOWANIE ---
export function drawSpaceBg(mainCtx, camera){
  if (!finalCanvas) return;

  const screenW = mainCtx.canvas.width; 
  const screenH = mainCtx.canvas.height;
  
  const camX = camera ? (camera.x || 0) : 0;
  const camY = camera ? (camera.y || 0) : 0;
  const zoom = camera ? (camera.zoom || 1.0) : 1.0;

  const bgW = finalCanvas.width;
  const bgH = finalCanvas.height;

  const drawScale = Math.max(0.001, Math.pow(zoom, 0.6)); 
  const tileDrawW = bgW * drawScale;
  const tileDrawH = bgH * drawScale;

  const halfW = screenW / 2;
  const halfH = screenH / 2;

  // Przesunięcie
  const viewCenterX = camX * 0.8; 
  const viewCenterY = camY * 0.8;

  const anchorX = halfW - (viewCenterX * drawScale);
  const anchorY = halfH - (viewCenterY * drawScale);

  const phaseX = ((anchorX % tileDrawW) + tileDrawW) % tileDrawW;
  const phaseY = ((anchorY % tileDrawH) + tileDrawH) % tileDrawH;

  const startX = phaseX - tileDrawW;
  const startY = phaseY - tileDrawH;

  for (let x = startX; x < screenW; x += tileDrawW) {
      for (let y = startY; y < screenH; y += tileDrawH) {
          mainCtx.drawImage(finalCanvas, 
              Math.floor(x), Math.floor(y), 
              Math.ceil(tileDrawW)+1, Math.ceil(tileDrawH)+1
          );
      }
  }
}

window.Nebula = guiState;
let opts = { newSystemEnabled: true };
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ guiState.seed = String(seed); initSpaceBg(); }
export function setParallaxOptions(partial){ }
export function getBackgroundCanvas(){ return finalCanvas; }
export function getBackgroundSampleDescriptor(){ return null; }
