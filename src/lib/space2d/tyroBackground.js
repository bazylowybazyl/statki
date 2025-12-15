"use strict";

import { Space2D } from './index.ts';

const TILE_SCALE = 1.0; 
let finalCanvas = null; 
let newBg = null;

// GLOBALNE PARAMETRY, KTÓRE MOŻESZ ZMIENIAĆ W KONSOLI
window.Nebula = {
  // Oświetlenie: Im MNIEJ, tym JAŚNIEJ i szerzej. Im WIĘCEJ, tym ciemniej i punktowo.
  // 2.0 = Biały ekran (za jasno)
  // 400.0 = Domyślnie
  // 2000.0 = Ciemno
  lightFalloff: 400.0,
  
  // Gęstość chmur
  density: 0.5,
  
  // Kolory
  emissiveLow: [0.1, 0.0, 0.2],  // Ciemny fiolet
  emissiveHigh: [0.6, 0.2, 0.8], // Jasny róż
  
  // Funkcja do odświeżenia tła po zmianie parametrów
  redraw: () => {
    console.log('[Nebula] Odświeżanie...');
    initSpaceBg(window.Nebula.seed || 'statki');
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
  window.Nebula.seed = opts.seed; // Zapisz seed dla redraw()

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // Generujemy jasne gwiazdy do oświetlenia
    const lightSources = [];
    for(let i=0; i<50; i++) {
        lightSources.push({
            position: [Math.random()*4000 - 2000, Math.random()*4000 - 2000, Math.random()*500],
            color: [2.0, 2.0, 3.0] // Bardzo jasne źródła światła
        });
    }

    const newCanvas = newBg.render(w, h, {
      stars: lightSources,
      backgroundStarBrightness: 0.0, 
      backgroundColor: [0, 0, 0], 
      
      // UŻYWAMY PARAMETRÓW Z KONSOLI
      lightFalloff: window.Nebula.lightFalloff,
      nebulaDensity: window.Nebula.density,
      nebulaEmissiveLow: window.Nebula.emissiveLow,
      nebulaEmissiveHigh: window.Nebula.emissiveHigh,
      
      nebulaLayers: 3,        
      nebulaFalloff: 2.5,     
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
// Reszta helperów...
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ opts.seed = String(seed); }
export function setParallaxOptions(partial){ if(partial) Object.assign(parallaxState, partial); }
export function getBackgroundCanvas(){ return finalCanvas; }
export function getBackgroundSampleDescriptor(){ return finalCanvas ? { canvas: finalCanvas, tileWidth: finalCanvas.width, tileHeight: finalCanvas.height, offsetX: parallaxState.offsetX, offsetY: parallaxState.offsetY, parallaxEnabled: true } : null; }
