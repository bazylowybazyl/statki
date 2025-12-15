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

// Funkcja generująca seed jak w demo Tyro (22 znaki)
function generateSeed() {
  const alphanum = "abcdefghijklmnopqrstuvqxyz1234567890";
  let seed = "";
  for (let i = 0; i < 22; i++) {
    seed += alphanum[Math.floor(Math.random() * alphanum.length)];
  }
  return seed;
}

// --- PANEL STEROWANIA (KONSOLA) ---
window.Nebula = {
  // Ziarno losowości (zmiana tego zmienia cały układ)
  seed: 'o7y91x2t2ze6ctqtxhuom5', // Domyślny seed z Twojego linku

  // Rozdzielczość
  resolution: 2048, 
  
  // Opcja ręcznego nadpisywania (jeśli false, używamy logiki z demo)
  manualOverride: false,

  // Parametry ręczne (używane tylko gdy manualOverride = true)
  manualParams: {
      falloff: 60.0,
      density: 0.5,
      lightFalloff: 200.0,
      scale: 0.001
  },

  // Przerysowanie
  redraw: () => {
    console.log(`[Nebula] Przerysowywanie (${window.Nebula.resolution}px)...`);
    setTimeout(() => initSpaceBg(window.Nebula.seed), 10);
  },
  
  // Losuj nowe parametry (jak w demo)
  randomize: () => {
    const newSeed = generateSeed();
    console.log(`[Nebula] Wylosowano seed: "${newSeed}"`);
    window.Nebula.seed = newSeed;
    initSpaceBg(newSeed);
  },
  
  // Włącz tryb ręczny
  useManual: (enabled = true) => {
      window.Nebula.manualOverride = enabled;
      console.log(`[Nebula] Tryb ręczny: ${enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY (Demo style)'}`);
      window.Nebula.redraw();
  }
};

let opts = {
  renderPointStars: false, renderStars: false, renderNebulae: false,
  newSystemEnabled: true, newSystemOpacity: 1.0, seed: 'statki'
};

const parallaxState = {
  enabled: true, factorX: 0.05, factorY: 0.05, smoothing: 0.2,
  offsetX: 0, offsetY: 0, targetX: 0, targetY: 0,
};

function ensureFinalCanvas(w, h){
  const size = window.Nebula.resolution || 2048;
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
  ensureFinalCanvas(innerWidth, innerHeight);
  
  opts.seed = String(seedStr ?? window.Nebula.seed);
  window.Nebula.seed = opts.seed;

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');
  
  // Inicjalizacja PRNG tym samym seedem co w demo
  const prng = Alea(opts.seed);

  // 1. TŁO
  // Tyro też losuje kolor tła!
  const backgroundColor = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
  const bgIntensity = 0.5 * prng();
  backgroundColor[0] *= bgIntensity; backgroundColor[1] *= bgIntensity; backgroundColor[2] *= bgIntensity;

  ctx.fillStyle = `rgb(${backgroundColor[0]*255}, ${backgroundColor[1]*255}, ${backgroundColor[2]*255})`;
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // --- LOGIKA Z DEMO (utility/main.ts) ---
    
    // Skala (Zoom)
    const scale = 0.001 + prng() * 0.001;
    
    const near = 0;
    const far = 500;
    const layers = 60; // W demo jest więcej, ale 60 wystarczy dla wydajności w grze

    const sceneOffset = [prng() * 10000000 - 5000000, prng() * 10000000 - 5000000];
    sceneOffset[0] -= 0.5 * w;
    sceneOffset[1] -= 0.5 * h;

    // Generowanie gwiazd
    const stars = [];
    const nStars = Math.min(64, 1 + Math.round(prng() * (w * h) * scale * scale));

    for (let i = 0; i < nStars; i++) {
        const color = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
        const intensity = 0.5 * prng(); 
        
        color[0] *= intensity;
        color[1] *= intensity;
        color[2] *= intensity;

        stars.push({
            position: [
                sceneOffset[0] + prng() * w, 
                sceneOffset[1] + prng() * h, 
                near + prng() * (far - near)
            ],
            color: color,
            falloff: 256,
            diffractionSpikeFalloff: 1024,
            diffractionSpikeScale: 4 + 4 * prng(),
        });
    }

    // Parametry mgławicy (losowane)
    let nebulaLacunarity = 1.8 + 0.2 * prng();
    let nebulaGain = 0.5;
    let nebulaAbsorption = 1.0;
    // To jest kluczowe dla "nitek": losowy falloff w dużym zakresie
    let nebulaFalloff = 256 + prng() * 1024; 
    let nebulaDensity = (50 + prng() * 100) / layers;
    
    // Kolory mgławicy (Albedo) - losowe RGB
    let nebulaAlbedoLow = [prng(), prng(), prng()];
    let nebulaAlbedoHigh = [prng(), prng(), prng()];
    let nebulaAlbedoScale = prng() * 8;
    
    // Oświetlenie (nasz custom fix na jasność, Tyro ma to wbudowane w fizykę)
    let lightFalloff = 400.0;

    // OBSŁUGA MANUALNA (jeśli chcesz nadpisać demo swoimi ustawieniami)
    if (window.Nebula.manualOverride) {
        const m = window.Nebula.manualParams;
        nebulaFalloff = m.falloff;
        nebulaDensity = m.density;
        lightFalloff = m.lightFalloff;
        // Resztę można też podpiąć
    }

    console.log(`[Nebula] Render Seed="${opts.seed}" | Falloff=${nebulaFalloff.toFixed(0)}`);

    const newCanvas = newBg.render(w, h, {
      stars,
      scale,
      offset: sceneOffset,
      backgroundColor,
      
      nebulaLacunarity,
      nebulaGain,
      nebulaAbsorption,
      nebulaFalloff,
      nebulaNear: near,
      nebulaFar: far,
      nebulaLayers: layers,
      nebulaDensity,
      
      nebulaAlbedoLow,
      nebulaAlbedoHigh,
      nebulaAlbedoScale,
      
      nebulaEmissiveLow: [0, 0, 0],
      nebulaEmissiveHigh: [0, 0, 0],
      
      // Nasz parametr oświetlenia (dla bezpieczeństwa)
      lightFalloff: lightFalloff
    });
    
    ctx.globalCompositeOperation = 'source-over'; 
    ctx.drawImage(newCanvas, 0, 0);
  }
  return true;
}

export function resizeSpaceBg(w, h){
  parallaxState.offsetX = 0; parallaxState.offsetY = 0;
  if (w > finalCanvas.width || h > finalCanvas.height) initSpaceBg(opts.seed);
}

export function drawSpaceBg(mainCtx, camera){
  if (!finalCanvas) return;
  const screenW = mainCtx.canvas.width; const screenH = mainCtx.canvas.height;
  const bgW = finalCanvas.width; const bgH = finalCanvas.height;

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

  const shiftX = -((parallaxState.offsetX % bgW + bgW) % bgW);
  const shiftY = -((parallaxState.offsetY % bgH + bgH) % bgH);

  for (let x = shiftX; x < screenW; x += bgW) {
    for (let y = shiftY; y < screenH; y += bgH) {
      mainCtx.drawImage(finalCanvas, Math.floor(x), Math.floor(y), Math.ceil(bgW)+1, Math.ceil(bgH)+1);
    }
  }
}
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ opts.seed = String(seed); }
export function setParallaxOptions(partial){ if(partial) Object.assign(parallaxState, partial); }
export function getBackgroundCanvas(){ return finalCanvas; }
export function getBackgroundSampleDescriptor(){ return finalCanvas ? { canvas: finalCanvas, tileWidth: finalCanvas.width, tileHeight: finalCanvas.height, offsetX: parallaxState.offsetX, offsetY: parallaxState.offsetY, parallaxEnabled: true } : null; }
