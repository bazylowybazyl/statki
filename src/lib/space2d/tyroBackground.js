"use strict";

import Scene from './scene.js'; 
import * as random from './random.js';
import { Space2D } from './index.ts'; 

const TILE_SCALE = 1.0; 

let finalCanvas = null; 
let newBg = null;

let opts = {
  // Wyłączamy wszystko ze starego systemu dla testu
  renderPointStars: false,
  renderStars: false,
  renderNebulae: false,
  renderSun: false,
  shortScale: true,
  seed: 'statki',
  
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

// Helper: Generuje losowe "lampy" (gwiazdy), które oświetlą mgławicę
function generateLightingStars(count) {
  const stars = [];
  for(let i=0; i<count; i++) {
    stars.push({
      // Rozrzucamy je w 3D
      position: [Math.random()*4000 - 2000, Math.random()*4000 - 2000, Math.random()*500],
      // Jasny, biało-niebieski kolor światła
      color: [1.5, 1.5, 2.0],
      // Parametry fizyczne dla shadera
      falloff: 1,
      diffractionSpikeFalloff: 0,
      diffractionSpikeScale: 0
    });
  }
  return stars;
}

export function initSpaceBg(seedStr = null){
  console.log('[TyroBackground] Generowanie tła...');
  ensureFinalCanvas(innerWidth, innerHeight);
  
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));
  
  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');

  // 1. ZAMALOWANIE TŁA NA CZARNO (Zabija stare mgławice z CSS)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // Generujemy listę gwiazd-źródeł światła
    const lightSources = generateLightingStars(50);

    console.log('[TyroBackground] Generowanie Space2D z oświetleniem...');
    const newCanvas = newBg.render(w, h, {
      // Przekazujemy gwiazdy, żeby mgławica miała co odbijać!
      stars: lightSources,
      
      // Wyłączamy renderowanie samych kropek gwiazd (chcemy tylko mgławicę)
      backgroundStarBrightness: 0.0, 
      backgroundStarDensity: 0.0,
      backgroundColor: [0, 0, 0], 
      
      // Konfiguracja wyglądu mgławicy (z wwwtyro demo)
      nebulaDensity: 0.4,     
      nebulaLayers: 3,        
      nebulaFalloff: 3.0,     
      
      // Kolory - fiolet/niebieski
      nebulaEmissiveLow: [0.0, 0.0, 0.1], 
      nebulaEmissiveHigh: [0.3, 0.1, 0.4], 
      
      // Kluczowe: ALBEDO (odbicie światła gwiazd)
      nebulaAlbedoLow: [0.1, 0.1, 0.3],
      nebulaAlbedoHigh: [0.8, 0.8, 1.0],
    });

    // Rysujemy wynik
    ctx.drawImage(newCanvas, 0, 0);
    console.log('[TyroBackground] Gotowe.');
  }
  
  return true;
}

export function resizeSpaceBg(w, h){
  // Reset paralaksy przy resize
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

  // Paralaksa
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

  // Kafelkowanie bez szwów
  const shiftX = -((parallaxState.offsetX % bgW + bgW) % bgW);
  const shiftY = -((parallaxState.offsetY % bgH + bgH) % bgH);

  for (let x = shiftX; x < screenW; x += bgW) {
    for (let y = shiftY; y < screenH; y += bgH) {
      // Używamy Math.ceil/floor żeby uniknąć linii między kaflami
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
