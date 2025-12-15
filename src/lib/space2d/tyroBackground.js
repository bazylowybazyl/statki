"use strict";

import Scene from './scene.js'; 
import * as random from './random.js';
import { Space2D } from './index.ts'; 

// Skala 1.0 = pełna jakość
const TILE_SCALE = 1.0; 

let finalCanvas = null; 

let opts = {
  renderPointStars: false,
  renderStars: true,
  renderNebulae: true,
  renderSun: false,
  shortScale: true,
  seed: 'statki',
  
  // TEST: Tylko nowy system
  newSystemEnabled: true,
  newSystemOpacity: 1.0, 
};

const parallaxState = {
  enabled: true,
  factorX: 0.05,
  factorY: 0.05,
  smoothing: 0.2,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
};

function ensureFinalCanvas(w, h){
  const targetW = Math.max(2048, w); 
  const targetH = Math.max(2048, h);
  
  if (!finalCanvas) {
    finalCanvas = document.createElement('canvas');
  }
  
  if (finalCanvas.width !== targetW || finalCanvas.height !== targetH) {
    finalCanvas.width = targetW;
    finalCanvas.height = targetH;
    return true;
  }
  return false;
}

export function initSpaceBg(seedStr = null){
  console.log('[TyroBackground] Generowanie tła (TRYB TESTOWY: TYLKO NOWE MGŁAWICE)...');
  const needResize = ensureFinalCanvas(innerWidth, innerHeight);
  
  if (!needResize && finalCanvas.dataset.seed === seedStr) {
      return true;
  }

  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));
  finalCanvas.dataset.seed = opts.seed;

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');

  // --- KROK 1: CZYŚCIMY NA CZARNO (Zamiast starych gwiazd) ---
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  console.log('[TyroBackground] Stary system WYŁĄCZONY. Tło jest czarne.');

  // --- KROK 2: Generowanie Nowego Systemu ---
  if (opts.newSystemEnabled) {
    console.log('[TyroBackground] Generowanie Space2D...');
    const space2D = new Space2D();
    
    // Generujemy mgławice
    const newCanvas = space2D.render(w, h, {
      backgroundStarBrightness: 0.0, 
      backgroundStarDensity: 0.0,
      backgroundColor: [0, 0, 0], // Czarne tło mgławic
      
      // Parametry testowe - bardzo widoczne
      nebulaDensity: 0.5,     
      nebulaLayers: 2,        
      nebulaFalloff: 3.0,     
      // Bardzo jaskrawe kolory dla testu (fiolet/róż)
      nebulaEmissiveLow: [0.2, 0.0, 0.2], 
      nebulaEmissiveHigh: [0.8, 0.2, 0.8], 
    });

    // --- KROK 3: Rysowanie ---
    // Używamy 'source-over', żeby po prostu wkleić obrazek (bez mieszania)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.drawImage(newCanvas, 0, 0);
    
    console.log('[TyroBackground] Narysowano nowe mgławice na płótnie.');
  } else {
      console.warn('[TyroBackground] Nowy system jest wyłączony w opcjach!');
  }
  
  return true;
}

export function resizeSpaceBg(w, h){
  parallaxState.offsetX = 0;
  parallaxState.offsetY = 0;
  parallaxState.targetX = 0;
  parallaxState.targetY = 0;
  
  if (w > finalCanvas.width || h > finalCanvas.height) {
      initSpaceBg(opts.seed);
  }
}

export function drawSpaceBg(mainCtx, camera){
  if (!finalCanvas) return;

  const screenW = mainCtx.canvas.width;
  const screenH = mainCtx.canvas.height;
  const bgW = finalCanvas.width;
  const bgH = finalCanvas.height;

  if (parallaxState.enabled && camera) {
    const smooth = Math.max(0, Math.min(1, parallaxState.smoothing));
    const camX = camera.x || 0;
    const camY = camera.y || 0;
    
    parallaxState.targetX = camX * parallaxState.factorX;
    parallaxState.targetY = camY * parallaxState.factorY;

    if (smooth === 0) {
      parallaxState.offsetX = parallaxState.targetX;
      parallaxState.offsetY = parallaxState.targetY;
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
export function setParallaxOptions(partial){
  if (!partial) return;
  if (typeof partial.enabled === 'boolean') parallaxState.enabled = partial.enabled;
  if (partial.factor !== undefined) {
      if (typeof partial.factor === 'number') {
          parallaxState.factorX = partial.factor;
          parallaxState.factorY = partial.factor;
      }
  }
}
export function getBackgroundCanvas(){ return finalCanvas; }
export function getBackgroundSampleDescriptor(){
  if (!finalCanvas) return null;
  return {
    canvas: finalCanvas,
    tileWidth: finalCanvas.width,
    tileHeight: finalCanvas.height,
    offsetX: parallaxState.offsetX,
    offsetY: parallaxState.offsetY,
    parallaxEnabled: parallaxState.enabled
  };
}
