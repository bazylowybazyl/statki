"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

const TILE_SCALE = 1.0; 
let finalCanvas = null; 
let newBg = null;

// --- PANEL STEROWANIA (KONSOLA) ---
window.Nebula = {
  // Wygląd chmur
  falloff: 60.0,       // Mniej = grubsze, puszyste. Więcej (np. 500) = cienkie nitki.
  density: 0.8,        // Gęstość gazu
  layers: 80,          // Więcej = ładniejsza głębia (ale dłuższy render!)
  scale: 0.001,        // Skala szumu (wielkość wzorów)
  
  // Kolory (r, g, b)
  starColorBase: [0.2, 0.6, 1.0], // Baza koloru gwiazd (Niebieski)
  starColorVar:  [0.2, 0.4, 0.5], // Zmienność losowa
  
  // Funkcja odświeżania
  redraw: () => {
    console.log('[Nebula] Przerysowywanie z nowymi parametrami...');
    // Mały timeout żeby UI nie zamarzło od razu po wciśnięciu Enter
    setTimeout(() => initSpaceBg(window.Nebula.seed), 10);
  },
  
  // Losuj nowe
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
  ctx.fillStyle = '#000205'; // Bardzo ciemny granat
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // 2. Generowanie GWIAZD (Lamp)
    // To one malują mgławicę na niebiesko!
    const stars = [];
    const nStars = 80; 
    
    // Używamy parametrów z konsoli do kolorów
    const base = window.Nebula.starColorBase;
    const vari = window.Nebula.starColorVar;

    const sceneOffset = [prng() * 1000000 - 500000, prng() * 1000000 - 500000];

    for(let i=0; i<nStars; i++) {
        // Losujemy kolor wokół bazy (np. różne odcienie niebieskiego)
        const color = [
            (base[0] + (prng()-0.5) * vari[0]) * 2.0, // *2.0 dla jasności
            (base[1] + (prng()-0.5) * vari[1]) * 2.0,
            (base[2] + (prng()-0.5) * vari[2]) * 2.0
        ];
        
        stars.push({
            position: [
                sceneOffset[0] + prng() * w, 
                sceneOffset[1] + prng() * h, 
                prng() * 500
            ],
            color: color
        });
    }

    console.log(`[TyroBackground] Render: falloff=${window.Nebula.falloff}, layers=${window.Nebula.layers}`);

    const newCanvas = newBg.render(w, h, {
      stars,
      offset: sceneOffset,
      
      // Parametry z konsoli
      nebulaFalloff: window.Nebula.falloff,
      nebulaDensity: window.Nebula.density / window.Nebula.layers * 40, // Skalowanie gęstości względem warstw
      nebulaLayers: window.Nebula.layers,
      scale: window.Nebula.scale,
      
      // Stałe "dobre" ustawienia
      nebulaLacunarity: 2.2, 
      nebulaGain: 0.5,
      nebulaAbsorption: 1.2, // Mocniejsze pochłanianie = lepszy kontrast
      
      // Kolory materiału (biały = odbija kolor gwiazdy 1:1)
      nebulaAlbedoLow: [1, 1, 1],
      nebulaAlbedoHigh: [1, 1, 1],
      nebulaAlbedoScale: 2.0,
      
      nebulaEmissiveLow: [0, 0, 0],
      nebulaEmissiveHigh: [0, 0, 0],
    });
    
    ctx.globalCompositeOperation = 'source-over'; // Wklej
    // ctx.globalCompositeOperation = 'screen';   // Alternatywa: mieszaj (jeśli chcesz jaśniej)
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
