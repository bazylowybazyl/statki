"use strict";

import Scene from './scene.js'; // Twój stary system
import * as random from './random.js';
// Importujemy nowy system z pliku index.ts
import { Space2D } from './index.ts'; 

// Skala tła - 1.0 oznacza 1:1 pikseli (najostrzej), wyższe wartości oszczędzają wydajność
// Ustawiam 1.0, żeby było ładnie, bo i tak renderujemy to raz.
const TILE_SCALE = 1.0; 

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
  newSystemOpacity: 1.0, // Pełna widoczność na start
};

const parallaxState = {
  enabled: true,
  factorX: 0.05, // Prędkość paralaksy
  factorY: 0.05,
  smoothing: 0.2,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
};

function ensureOffscreenSize(w, h){
  // Renderujemy nieco większy obszar, żeby kafelki ładnie się zazębiały
  // Rozmiar tekstury tła (np. 1024x1024 lub ekran)
  const targetW = Math.max(1024, w); 
  const targetH = Math.max(1024, h);
  
  // 1. Stary system
  if (!oldOffGL) {
    oldOffGL = document.createElement('canvas');
  }
  if (oldOffGL.width !== targetW || oldOffGL.height !== targetH) {
    oldOffGL.width = targetW;
    oldOffGL.height = targetH;
    if(oldBg && oldBg.resize) oldBg.resize(targetW, targetH);
  }
}

export function initSpaceBg(seedStr = null){
  console.log('[TyroBackground] Inicjalizacja tła...');
  ensureOffscreenSize(innerWidth, innerHeight);
  
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));

  // A. Stary system
  if (!oldBg) oldBg = new Scene(oldOffGL);
  // Wymuś renderowanie starego tła
  oldBg.render(opts); 

  // B. Nowy system
  if (opts.newSystemEnabled) {
    if (!newBg) {
      newBg = new Space2D();
    }
    const w = oldOffGL.width;
    const h = oldOffGL.height;
    
    console.log(`[TyroBackground] Generowanie nowych mgławic (${w}x${h})...`);
    
    // Generujemy tło Space2D
    // Zwiększyłem jasność i gęstość, żeby było widać efekt!
    newOffGL = newBg.render(w, h, {
      backgroundStarBrightness: 0.0, // Gwiazdy wyłączone (masz swoje)
      backgroundStarDensity: 0.0,
      backgroundColor: [0, 0, 0],    // Czarne tło = przezroczystość w trybie 'screen'
      
      // Parametry mgławic - podkręcone dla widoczności
      nebulaDensity: 0.4,    
      nebulaLayers: 2,       
      nebulaFalloff: 3.0,
      // Kolory: fioletowo-niebieskie, jasne
      nebulaEmissiveLow: [0.0, 0.1, 0.2], 
      nebulaEmissiveHigh: [0.4, 0.2, 0.6], 
    });
    console.log('[TyroBackground] Nowe mgławice wygenerowane.');
  }
  return true;
}

export function resizeSpaceBg(w, h){
  ensureOffscreenSize(w, h);
  // Przy resize resetujemy paralaksę, żeby nie zgubić tła
  parallaxState.offsetX = 0;
  parallaxState.offsetY = 0;
  parallaxState.targetX = 0;
  parallaxState.targetY = 0;

  if(oldBg) oldBg.render(opts);
  
  if(newBg && opts.newSystemEnabled){
     // Regeneracja nowych mgławic przy zmianie rozmiaru
     const targetW = oldOffGL.width;
     const targetH = oldOffGL.height;
     newOffGL = newBg.render(targetW, targetH, {
        backgroundStarBrightness: 0.0,
        backgroundColor: [0, 0, 0],
        nebulaDensity: 0.4,
        nebulaLayers: 2,
     });
  }
}

export function drawSpaceBg(mainCtx, camera){
  if (!oldOffGL) return;

  const screenW = mainCtx.canvas.width;
  const screenH = mainCtx.canvas.height;
  const bgW = oldOffGL.width;
  const bgH = oldOffGL.height;

  // --- Obliczanie Paralaksy ---
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

  // --- MATEMATYKA NIESKOŃCZONEGO TŁA ---
  // Obliczamy przesunięcie modulo, żeby wiedzieć gdzie zacząć rysować
  // Używamy ((a % n) + n) % n, żeby modulo działało poprawnie dla liczb ujemnych
  let startX = -((parallaxState.offsetX % bgW + bgW) % bgW);
  let startY = -((parallaxState.offsetY % bgH + bgH) % bgH);

  // Jeśli startX/Y jest zbyt blisko krawędzi, może powstać dziura,
  // więc upewniamy się, że pokrywamy cały ekran
  
  // Rysujemy kafelki aż pokryjemy cały ekran
  for (let x = startX; x < screenW; x += bgW) {
    for (let y = startY; y < screenH; y += bgH) {
      
      // 1. Rysuj STARE tło (bazowe)
      // floor() zapobiega szparom między kafelkami przy skalowaniu
      mainCtx.drawImage(oldOffGL, Math.floor(x), Math.floor(y), Math.ceil(bgW)+1, Math.ceil(bgH)+1);

      // 2. Rysuj NOWE tło (nakładka)
      if (newOffGL && opts.newSystemEnabled) {
          mainCtx.save();
          // Tryb 'screen' dodaje jasność pikseli (czarny jest przezroczysty)
          mainCtx.globalCompositeOperation = 'screen'; 
          mainCtx.globalAlpha = opts.newSystemOpacity;
          mainCtx.drawImage(newOffGL, Math.floor(x), Math.floor(y), Math.ceil(bgW)+1, Math.ceil(bgH)+1);
          mainCtx.restore();
      }
    }
  }
}

// Helpers
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
