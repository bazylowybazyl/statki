"use strict";

import { Space2D } from './index.ts';
import Alea from 'alea';

let finalCanvas = null; 
let newBg = null;

// --- PANEL STEROWANIA (KONSOLA) ---
// Dostępny pod: window.Nebula
window.Nebula = {
  // --- 1. ROZMIAR I JAKOŚĆ ---
  // Rozdzielczość tekstury tła.
  // 2048 = Standard. 4096 = Wysoka jakość (4K). 8192 = Ultra (może ciąć).
  resolution: 2048, 

  // Skala szumu (Zoom). 
  // Mniejsza liczba (0.0002) = wielkie chmury. Większa (0.002) = drobny pył.
  scale: 0.0005,
  
  // --- 2. WYGLĄD MGŁAWIC ---
  falloff: 40.0,       // 30-60 = gęste chmury. >100 = rzadkie.
  density: 0.5,        // Przezroczystość
  layers: 60,          // Głębia (ilość warstw)
  
  // --- 3. OŚWIETLENIE ---
  // Zasięg światła gwiazd (Im WIĘCEJ, tym MNIEJSZY zasięg / ciemniej).
  // 200 = Jasno. 1000 = Ciemno.
  lightFalloff: 200.0,
  
  // Kolory gwiazd oświetlających (R, G, B)
  colors: {
    base: [0.1, 0.4, 1.0], // Główny kolor (Niebieski)
    var:  [0.2, 0.3, 0.5]  // Zmienność (odcienie)
  },

  // --- 4. STEROWANIE ---
  seed: 'statki', // Aktualny seed
  
  // Przerysuj z obecnymi ustawieniami
  redraw: () => {
    console.log(`[Nebula] Przerysowywanie (Res: ${window.Nebula.resolution}px)...`);
    setTimeout(() => initSpaceBg(window.Nebula.seed), 10);
  },
  
  // Wylosuj nowy układ
  randomize: () => {
    const newSeed = Math.random().toString(36).slice(2, 8);
    console.log(`[Nebula] Nowy seed: "${newSeed}"`);
    window.Nebula.seed = newSeed;
    initSpaceBg(newSeed);
  }
};

// Konfiguracja wewnętrzna
let opts = {
  renderPointStars: false, renderStars: false, renderNebulae: false,
  newSystemEnabled: true, newSystemOpacity: 1.0, seed: 'statki'
};

const parallaxState = {
  enabled: true, factorX: 0.05, factorY: 0.05, smoothing: 0.2,
  offsetX: 0, offsetY: 0, targetX: 0, targetY: 0,
};

function ensureFinalCanvas(w, h){
  // Bierzemy rozdzielczość z obiektu konfiguracji window.Nebula
  const size = window.Nebula.resolution || 2048;
  const targetW = Math.max(size, w); 
  const targetH = Math.max(size, h);
  
  if (!finalCanvas) finalCanvas = document.createElement('canvas');
  
  // Jeśli rozmiar się zmienił (np. wpisałeś w konsoli resolution = 4096), to zmieniamy
  if (finalCanvas.width !== targetW || finalCanvas.height !== targetH) {
    finalCanvas.width = targetW; 
    finalCanvas.height = targetH;
    return true; // Wymaga przerysowania
  }
  return false;
}

export function initSpaceBg(seedStr = null){
  ensureFinalCanvas(innerWidth, innerHeight);
  
  opts.seed = String(seedStr ?? window.Nebula.seed);
  window.Nebula.seed = opts.seed; // Aktualizacja w panelu

  const w = finalCanvas.width;
  const h = finalCanvas.height;
  const ctx = finalCanvas.getContext('2d');
  const prng = Alea(opts.seed);

  // Tło
  ctx.fillStyle = '#000104'; 
  ctx.fillRect(0, 0, w, h);

  if (opts.newSystemEnabled) {
    if (!newBg) newBg = new Space2D();
    
    // Generowanie gwiazd na podstawie kolorów z panelu
    const stars = [];
    const nStars = 60; 
    
    const base = window.Nebula.colors.base;
    const vari = window.Nebula.colors.var;
    
    // Rozrzucamy gwiazdy po całej (ewentualnie powiększonej) przestrzeni
    // Ważne: obszar generowania gwiazd musi pasować do 'offsetu'
    const sceneOffset = [prng() * 500000 - 250000, prng() * 500000 - 250000];

    for(let i=0; i<nStars; i++) {
        // Boost jasności * 2.5
        const color = [
            Math.max(0, (base[0] + (prng()-0.5) * vari[0]) * 2.5),
            Math.max(0, (base[1] + (prng()-0.5) * vari[1]) * 2.5),
            Math.max(0, (base[2] + (prng()-0.5) * vari[2]) * 2.5)
        ];
        stars.push({
            position: [
                sceneOffset[0] + prng() * w, 
                sceneOffset[1] + prng() * h, 
                prng() * 600
            ],
            color: color,
            falloff: 256,
            diffractionSpikeFalloff: 1024,
            diffractionSpikeScale: 4 + 4 * prng(),
        });
    }

    const newCanvas = newBg.render(w, h, {
      stars,
      offset: sceneOffset,
      
      // Parametry z konsoli
      lightFalloff: window.Nebula.lightFalloff,
      nebulaFalloff: window.Nebula.falloff,
      nebulaDensity: window.Nebula.density,
      nebulaLayers: window.Nebula.layers,
      scale: window.Nebula.scale,
      
      // Stałe
      nebulaLacunarity: 2.2, 
      nebulaGain: 0.5,
      nebulaAbsorption: 1.0, 
      
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
  // Sprawdzamy czy okno nie przerosło tekstury (rzadkie przy 2048/4096)
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

// Helpers
export function setBgOptions(partial){ Object.assign(opts, partial || {}); }
export function setBgSeed(seed){ opts.seed = String(seed); }
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
