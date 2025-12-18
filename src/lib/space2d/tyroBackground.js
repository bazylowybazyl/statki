"use strict";

// Konfiguracja plików
const BACKGROUNDS = {
  '8k':  '/assets/nebula_8k.png',
  '4k':  '/assets/nebula_4k.png',
  '2k':  '/assets/nebula_2k.png'
};

let currentImage = null;
let isLoaded = false;

// --- SZACUNKOWY ROZMIAR ŚWIATA ---
// Musimy wiedzieć, gdzie jest "koniec mapy", żeby dopasować przesuw.
// Neptun jest na ok. 120 000, dajemy zapas do 180 000.
const WORLD_RADIUS = 180000; 

// --- KONFIGURACJA ---
const config = {
  quality: '4k',      
  
  // Czy automatycznie obliczać bezpieczną paralaksę?
  // TRUE: Tło nigdy się nie skończy, ale przesuwa się bardzo wolno.
  // FALSE: Używa suwaka 'manualParallax', ale możesz wylecieć poza tło.
  smartParallax: true, 
  
  manualParallax: 0.05, // Używane tylko gdy smartParallax = false
  
  scale: 1.0,           // Skala obrazka (Zoom)
  brightness: 1.0
};

// --- PANEL STEROWANIA ---
window.Nebula = {
  setQuality: (quality) => {
    if (!BACKGROUNDS[quality]) {
      console.warn(`[Background] Brak opcji: ${quality}`);
      return;
    }
    config.quality = quality;
    console.log(`[Background] Jakość: ${quality}`);
    loadBackground();
  },
  
  // Przełącznik trybu Smart
  toggleSmart: (val) => { config.smartParallax = !!val; },
  
  // Manualne sterowanie (jeśli wyłączysz Smart)
  setParallax: (val) => { config.manualParallax = val; },
  
  getConfig: () => config
};

function loadBackground() {
  isLoaded = false;
  const url = BACKGROUNDS[config.quality];
  console.log(`[Background] Ładowanie: ${url}`);
  
  const img = new Image();
  img.src = url;
  img.onload = () => {
    console.log(`[Background] Gotowe (${img.width}x${img.height})`);
    currentImage = img;
    isLoaded = true;
  };
  img.onerror = () => {
    console.error(`[Background] Błąd pliku: ${url}`);
    if (config.quality !== '4k') window.Nebula.setQuality('4k');
  };
}

export function initSpaceBg() {
  loadBackground();
  return true;
}

// --- RYSOWANIE (Jeden Kafel + Smart Parallax) ---
export function drawSpaceBg(ctx, camera) {
  // 1. Czyścimy tło
  const screenW = ctx.canvas.width;
  const screenH = ctx.canvas.height;
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, screenW, screenH);

  if (!isLoaded || !currentImage) return;

  const camX = camera.x || 0;
  const camY = camera.y || 0;
  
  // Środek ekranu
  const halfW = screenW / 2;
  const halfH = screenH / 2;

  // 2. Skalowanie
  // Tło jest w "nieskończoności", więc nie powinno się zoomować tak mocno jak gra.
  // Ustawiamy sztywną skalę lub minimalną reakcję na zoom.
  // Tutaj: Stała wielkość (najlepsza jakość) lub lekki zoom.
  const bgScale = config.scale; 
  
  const imgW = currentImage.width * bgScale;
  const imgH = currentImage.height * bgScale;

  // 3. Obliczanie Paralaksy (The Smart Part)
  let pFactorX = 0;
  let pFactorY = 0;

  if (config.smartParallax) {
      // Obliczamy ile mamy zapasu obrazka poza ekranem
      const availableX = (imgW / 2) - halfW;
      const availableY = (imgH / 2) - halfH;

      // Jeśli obrazek jest mniejszy niż ekran -> skaluj go w górę!
      if (availableX <= 0 || availableY <= 0) {
          // Force scale up to fit screen
          const fitScale = Math.max(screenW / currentImage.width, screenH / currentImage.height) * 1.05;
          // Rysuj statycznie na środku
          ctx.drawImage(currentImage, halfW - (currentImage.width*fitScale)/2, halfH - (currentImage.height*fitScale)/2, currentImage.width*fitScale, currentImage.height*fitScale);
          return;
      }

      // Obliczamy współczynnik: [Zapas Pikseli] / [Promień Świata]
      // To nam daje idealną prędkość przesuwania.
      pFactorX = availableX / WORLD_RADIUS;
      pFactorY = availableY / WORLD_RADIUS;
  } else {
      // Tryb ręczny (ryzyko czarnych pasów)
      pFactorX = config.manualParallax;
      pFactorY = config.manualParallax;
  }

  // 4. Przesunięcie
  // Jeśli jesteśmy na Słońcu (0,0) -> offset jest 0 -> środek obrazka na środku ekranu.
  // Jeśli lecimy w prawo (+X) -> tło przesuwa się w lewo (-X) o wyliczony czynnik.
  const shiftX = -camX * pFactorX;
  const shiftY = -camY * pFactorY;

  const drawX = halfW + shiftX - (imgW / 2);
  const drawY = halfH + shiftY - (imgH / 2);

  // 5. Rysowanie
  if (config.brightness !== 1.0) {
    ctx.save();
    ctx.globalAlpha = config.brightness;
    ctx.drawImage(currentImage, drawX, drawY, imgW, imgH);
    ctx.restore();
  } else {
    ctx.drawImage(currentImage, drawX, drawY, imgW, imgH);
  }
}

// Funkcje kompatybilności
export function resizeSpaceBg(w, h) {}
export function setBgOptions(opts) {}
export function setBgSeed(seed) {}
export function setParallaxOptions(opts) {}
export function getBackgroundCanvas() { return currentImage; }
export function getBackgroundSampleDescriptor() { 
    if (!currentImage) return null;
    return { canvas: currentImage, tileWidth: currentImage.width, tileHeight: currentImage.height, offsetX:0, offsetY:0, parallaxEnabled:true };
}
