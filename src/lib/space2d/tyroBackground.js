"use strict";

import Scene from './scene.js'; // Twój stary system
import * as random from './random.js';
// Importujemy nowy system z pliku index.ts w tym samym folderze
import { Space2D } from './index'; 

const TILE_SCALE = 1.5; // Rozmiar bufora

let oldBg = null;    // Stary system
let oldOffGL = null; // Canvas starego systemu

let newBg = null;    // Nowy system (Space2D)
let newOffGL = null; // Canvas nowego systemu

// Konfiguracja
let opts = {
  renderPointStars: false,
  renderStars: true,     // Gwiazdy ze starego systemu (widoczne)
  renderNebulae: true,   // Mgławice ze starego systemu (widoczne)
  renderSun: false,
  shortScale: true,
  seed: 'statki',
  
  // Nowy system (Space2D)
  newSystemEnabled: true,
  newSystemOpacity: 0.8, // Przezroczystość nowych mgławic
};

const parallaxState = {
  enabled: true,
  factorX: 0.045,
  factorY: 0.03,
  smoothing: 0.2,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
  tileWidth: 0,
  tileHeight: 0
};

function ensureOffscreenSize(w, h){
  const targetW = Math.max(1, Math.round((w || 0) * TILE_SCALE));
  const targetH = Math.max(1, Math.round((h || 0) * TILE_SCALE));
  
  // 1. Stary system
  if (!oldOffGL) {
    oldOffGL = document.createElement('canvas');
  }
  if (oldOffGL.width !== targetW || oldOffGL.height !== targetH) {
    oldOffGL.width = targetW;
    oldOffGL.height = targetH;
    if(oldBg) oldBg.clear?.();
  }

  // 2. Nowy system (tylko zapisujemy wymiary, render w init/resize)
  parallaxState.tileWidth = targetW;
  parallaxState.tileHeight = targetH;
}

export function initSpaceBg(seedStr = null){
  ensureOffscreenSize(innerWidth, innerHeight);
  
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));

  // A. Stary system
  if (!oldBg) oldBg = new Scene(oldOffGL);
  oldBg.render(opts); 

  // B. Nowy system
  if (opts.newSystemEnabled) {
    if (!newBg) {
      newBg = new Space2D();
    }
    const w = oldOffGL.width;
    const h = oldOffGL.height;
    
    // Generujemy tło Space2D
    newOffGL = newBg.render(w, h, {
      // Ukryte gwiazdy (służą tylko jako źródła światła dla mgławicy)
      backgroundStarBrightness: 0.0, 
      backgroundStarDensity: 0.05,
      // Czarne tło dla blendingu 'screen'
      backgroundColor: [0, 0, 0],
      // Wygląd mgławic
      nebulaDensity: 0.2,
      nebulaLayers: 3, 
      nebulaFalloff: 3.5,
      nebulaEmissiveLow: [0.0, 0.05, 0.1], 
      nebulaEmissiveHigh: [0.1, 0.0, 0.2], 
    });
  }
  return true;
}

export function resizeSpaceBg(w, h){
  ensureOffscreenSize(w, h);
  
  parallaxState.offsetX = 0;
  parallaxState.offsetY = 0;
  parallaxState.targetX = 0;
  parallaxState.targetY = 0;

  if(oldBg) oldBg.render(opts);
  
  if(newBg && opts.newSystemEnabled){
     const targetW = oldOffGL.width;
     const targetH = oldOffGL.height;
     newOffGL = newBg.render(targetW, targetH, {
        backgroundStarBrightness: 0.0,
        backgroundStarDensity: 0.05,
        backgroundColor: [0, 0, 0],
        nebulaDensity: 0.2,
        nebulaLayers: 3,
     });
  }
}

export function drawSpaceBg(mainCtx, camera){
  if (!oldOffGL) return;

  const screenW = mainCtx.canvas.width;
  const screenH = mainCtx.canvas.height;
  const bgW = oldOffGL.width;
  const bgH = oldOffGL.height;

  // Paralaksa
  let offsetX = 0;
  let offsetY = 0;

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
    offsetX = parallaxState.offsetX;
    offsetY = parallaxState.offsetY;
  }

  const shiftX = wrapOffset(offsetX, bgW);
  const shiftY = wrapOffset(offsetY, bgH);

  // Rysowanie wyśrodkowane z paralaksą
  const centerX = screenW / 2;
  const centerY = screenH / 2;
  const drawX = centerX - (bgW / 2) - shiftX;
  const drawY = centerY - (bgH / 2) - shiftY;

  // Pętla do pokrycia ekranu (safety wrap)
  for (let x = -1; x <= 0; x++) {
      for (let y = -1; y <= 0; y++) {
          let dx = drawX + (x * bgW);
          let dy = drawY + (y * bgH);
          
          if (dx < -bgW) dx += bgW;
          if (dx > screenW) dx -= bgW;
          if (dy < -bgH) dy += bgH;
          if (dy > screenH) dy -= bgH;

          // 1. Stare tło
          mainCtx.drawImage(oldOffGL, dx, dy);

          // 2. Nowe tło (nakładka)
          if (newOffGL && opts.newSystemEnabled) {
              mainCtx.save();
              mainCtx.globalCompositeOperation = 'screen'; 
              mainCtx.globalAlpha = opts.newSystemOpacity;
              mainCtx.drawImage(newOffGL, dx, dy);
              mainCtx.restore();
          }
      }
  }
}

function wrapOffset(value, max) {
  let val = value % max;
  if (val > max / 2) val -= max;
  if (val < -max / 2) val += max;
  return val;
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
export function getBackgroundCanvas(){ return oldOffGL; }
export function getBackgroundSampleDescriptor(){
  if (!oldOffGL) return null;
  return {
    canvas: oldOffGL,
    tileWidth: oldOffGL.width,
    tileHeight: oldOffGL.height,
    offsetX: parallaxState.offsetX,
    offsetY: parallaxState.offsetY,
    parallaxEnabled: parallaxState.enabled
  };
}
