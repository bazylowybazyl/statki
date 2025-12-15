"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

const TILE_SCALE = 1.0; 
let finalCanvas = null; 
let newBg = null;

// --- PANEL STEROWANIA (KONSOLA) ---
window.Nebula = {
  // Wygląd chmur
  falloff: 60.0,       // Mniej (30-60) = grube chmury. Więcej (256+) = cienkie nitki.
  density: 0.8,        // Gęstość gazu
  layers: 40,          // Ilość warstw (dla głębi)
  scale: 0.0008,       // Zoom szumu
  
  // Kolory (r, g, b)
  starColorBase: [0.2, 0.6, 1.0], // Baza koloru gwiazd (Niebieski)
  starColorVar:  [0.2, 0.4, 0.5], // Zmienność losowa
  
  redraw: () => {
    console.log('[Nebula] Przerysowywanie...');
    setTimeout(() => initSpaceBg(window.Nebula.seed), 10);
  },
  randomize: () => {
    initSpaceBg(Math.random().toString(36));
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
  const targetW = Math.max(2048, w); const targetH = Math.max(2048, h);
  if (!finalCanvas) finalCanvas = document.createElement('canvas');
  if (finalCanvas.width !== targetW || finalCanvas.height !== targetH) {
    finalCanvas.width = targetW; finalCanvas.height = targetH;
    return true;
  }
  return false;
}

export function initSpaceBg(seedStr = null){
  ensureFinalCanvas(innerWidth, innerHeight);
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? 'statki'));
  window.Nebula.seed = opts.seed;

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');
  const prng = Alea(opts.seed);

  // 1. TŁO
  ctx.fillStyle = '#000205'; 
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    const stars = [];
    const nStars = 80; 
    
    const base = window.Nebula.starColorBase;
    const vari = window.Nebula.starColorVar;

    const sceneOffset = [prng() * 1000000 - 500000, prng() * 1000000 - 500000];

    for(let i=0; i<nStars; i++) {
        const color = [
            (base[0] + (prng()-0.5) * vari[0]) * 2.0,
            (base[1] + (prng()-0.5) * vari[1]) * 2.0,
            (base[2] + (prng()-0.5) * vari[2]) * 2.0
        ];
        
        stars.push({
            position: [
                sceneOffset[0] + prng() * w, 
                sceneOffset[1] + prng() * h, 
                prng() * 500
            ],
            color: color,
            // --- FIX: BRAKUJĄCE PARAMETRY GWIAZD ---
            falloff: 256,
            diffractionSpikeFalloff: 1024,
            diffractionSpikeScale: 4 + 4 * prng(),
        });
    }

    console.log(`[TyroBackground] Render: falloff=${window.Nebula.falloff}, layers=${window.Nebula.layers}`);

    const newCanvas = newBg.render(w, h, {
      stars,
      offset: sceneOffset,
      
      // Parametry z konsoli
      nebulaFalloff: window.Nebula.falloff,
      nebulaDensity: window.Nebula.density / window.Nebula.layers * 40,
      nebulaLayers: window.Nebula.layers,
      scale: window.Nebula.scale,
      
      nebulaLacunarity: 2.2, 
      nebulaGain: 0.5,
      nebulaAbsorption: 1.2,
      
      nebulaAlbedoLow: [1, 1, 1],
      nebulaAlbedoHigh: [1, 1, 1],
      nebulaAlbedoScale: 2.0,
      
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
