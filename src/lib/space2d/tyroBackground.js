"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea'; // Musimy zaimportować Alea tutaj, żeby działać jak main.ts

// Skopiowane kolory "Black Body" z utility/black-body.ts
const blackBodyColors = [
  [255, 204, 153], [255, 208, 158], [255, 212, 163], [255, 216, 168], [255, 220, 174], [255, 224, 180],
  [255, 228, 186], [255, 232, 192], [255, 236, 199], [255, 240, 205], [255, 244, 212], [255, 248, 220],
  [255, 252, 227], [255, 255, 235], [255, 255, 243], [255, 255, 251], [255, 255, 255], [250, 251, 255],
  [244, 247, 255], [239, 243, 255], [234, 239, 255], [229, 236, 255], [225, 232, 255], [221, 229, 255],
  [217, 226, 255], [213, 222, 255], [209, 219, 255], [206, 216, 255], [203, 213, 255], [200, 210, 255],
  [197, 208, 255], [194, 205, 255], [192, 203, 255], [189, 200, 255], [187, 198, 255], [185, 196, 255]
].map(c => [c[0]/255, c[1]/255, c[2]/255]); // Normalizacja do 0.0-1.0

const TILE_SCALE = 1.0; 
let finalCanvas = null; 
let newBg = null;

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
  console.log('[TyroBackground] Generowanie proceduralne (styl Demo)...');
  ensureFinalCanvas(innerWidth, innerHeight);
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? 'statki'));

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');
  
  // 1. Inicjalizacja PRNG
  const prng = Alea(opts.seed);

  // 2. Generowanie parametrów jak w main.ts
  const scale = 0.001 + prng() * 0.001;
  const near = 0;
  const far = 500;
  // Demo używa 1000 warstw, my damy 60 dla wydajności (ale wystarczy dla efektu)
  const layers = 60; 

  // Generowanie GWIAZD (klucz do oświetlenia)
  const stars = [];
  const nStars = Math.min(64, 1 + Math.round(prng() * (w * h) * scale * scale));
  
  // Offset sceny (losowe miejsce w kosmosie)
  const sceneOffset = [prng() * 10000000 - 5000000, prng() * 10000000 - 5000000];

  for (let i = 0; i < nStars; i++) {
    // Losowy kolor gwiazdy
    const color = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
    const intensity = 0.5 * prng(); // Jasność
    color[0] *= intensity; color[1] *= intensity; color[2] *= intensity;
    
    stars.push({
      position: [
          sceneOffset[0] + prng() * w, 
          sceneOffset[1] + prng() * h, 
          near + prng() * (far - near)
      ],
      color,
      falloff: 256,
      diffractionSpikeFalloff: 1024,
      diffractionSpikeScale: 4 + 4 * prng(),
    });
  }

  // Kolor tła
  const backgroundColor = blackBodyColors[Math.floor(prng() * blackBodyColors.length)].slice();
  const bgInt = 0.5 * prng();
  backgroundColor[0] *= bgInt; backgroundColor[1] *= bgInt; backgroundColor[2] *= bgInt;

  // Renderowanie
  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    console.log('[TyroBackground] Renderowanie...');
    const newCanvas = newBg.render(w, h, {
      stars,
      scale,
      offset: sceneOffset, // Kluczowe: offset zgodny z gwiazdami
      backgroundColor,
      
      // Parametry mgławicy (losowane jak w demo)
      nebulaLacunarity: 1.8 + 0.2 * prng(),
      nebulaGain: 0.5,
      nebulaAbsorption: 1.0,
      nebulaFalloff: 256 + prng() * 1024, // To jest ten duży falloff z dema!
      nebulaNear: near,
      nebulaFar: far,
      nebulaLayers: layers,
      nebulaDensity: (50 + prng() * 100) / layers,
      
      // Albedo - to daje kolory chmur (losowe RGB)
      nebulaAlbedoLow: [prng(), prng(), prng()],
      nebulaAlbedoHigh: [prng(), prng(), prng()],
      nebulaAlbedoScale: prng() * 8,
      
      // Wyłączona emisja (tylko odbicie światła)
      nebulaEmissiveLow: [0, 0, 0],
      nebulaEmissiveHigh: [0, 0, 0]
    });
    
    // Rysowanie na finalnym płótnie
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(newCanvas, 0, 0);
    console.log('[TyroBackground] Gotowe.');
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
