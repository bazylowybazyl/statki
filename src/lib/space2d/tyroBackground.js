"use strict";

// Konfiguracja dostępnych plików tła (.png)
const BACKGROUNDS = {
  '16k': '/assets/nebula_16k.png', // Ultra
  '8k':  '/assets/nebula_8k.png',  // High
  '4k':  '/assets/nebula_4k.png',  // Medium (Domyślne)
  '2k':  '/assets/nebula_2k.png'   // Low
};

let currentImage = null;
let isLoaded = false;

// --- DOMYŚLNA KONFIGURACJA ---
const config = {
  // Tutaj ustalasz co wczytuje się na starcie gry:
  quality: '4k',      
  
  // Parametry wyświetlania
  parallaxFactor: 0.05, // 0.05 = Tło przesuwa się bardzo powoli (efekt dalekiej odległości)
  scale: 1.0,           // Skala obrazka (1.0 = oryginalny rozmiar pliku)
  brightness: 1.0       // Jasność (1.0 = normalna)
};

// --- PANEL STEROWANIA (window.Nebula) ---
window.Nebula = {
  // Zmiana jakości w locie (np. z menu opcji)
  setQuality: (quality) => {
    if (!BACKGROUNDS[quality]) {
      console.warn(`[Background] Nieznana jakość: ${quality}. Dostępne: 16k, 8k, 4k, 2k`);
      return;
    }
    config.quality = quality;
    console.log(`[Background] Zmieniam jakość na: ${quality}`);
    loadBackground();
  },

  // Ustawienie siły paralaksy
  setParallax: (val) => {
    config.parallaxFactor = val;
  },

  getConfig: () => config
};

function loadBackground() {
  isLoaded = false;
  const url = BACKGROUNDS[config.quality];
  
  console.log(`[Background] Ładowanie tła: ${url}`);
  
  const img = new Image();
  img.src = url;
  
  img.onload = () => {
    console.log(`[Background] Załadowano pomyślnie (${img.width}x${img.height})`);
    currentImage = img;
    isLoaded = true;
  };
  
  img.onerror = () => {
    console.error(`[Background] BŁĄD: Nie znaleziono pliku: ${url}`);
    // Fallback: jeśli 16k/8k zawiedzie, próbuj 4k
    if (config.quality === '16k' || config.quality === '8k') {
        console.warn('[Background] Próba wczytania niższej jakości (4k)...');
        window.Nebula.setQuality('4k');
    }
  };
}

// Inicjalizacja (wołana przy starcie gry)
export function initSpaceBg() {
  loadBackground();
  return true;
}

// Funkcja rysująca (wołana w pętli gry)
export function drawSpaceBg(ctx, camera) {
  // 1. Czyścimy ekran na czarno
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  
  ctx.fillStyle = '#050505'; 
  ctx.fillRect(0, 0, width, height);

  if (!isLoaded || !currentImage) return;

  // 2. Dane kamery
  const camX = camera ? (camera.x || 0) : 0;
  const camY = camera ? (camera.y || 0) : 0;
  
  // Środek ekranu
  const centerX = width / 2;
  const centerY = height / 2;

  // Rozmiar tła
  const bgW = currentImage.width * config.scale;
  const bgH = currentImage.height * config.scale;

  // 3. Obliczamy pozycję (Paralaksa)
  // Odejmujemy pozycję kamery pomnożoną przez mały czynnik.
  let drawX = centerX - (camX * config.parallaxFactor);
  let drawY = centerY - (camY * config.parallaxFactor);

  // Centrowanie środka obrazka w 0,0 świata gry (opcjonalne, ale zalecane)
  drawX -= bgW / 2;
  drawY -= bgH / 2;

  // 4. Rysowanie
  if (config.brightness !== 1.0) {
    ctx.save();
    ctx.globalAlpha = config.brightness;
    ctx.drawImage(currentImage, drawX, drawY, bgW, bgH);
    ctx.restore();
  } else {
    ctx.drawImage(currentImage, drawX, drawY, bgW, bgH);
  }
}

// Funkcje zachowane dla kompatybilności (puste, bo nie są już potrzebne)
export function resizeSpaceBg(w, h) {}
export function setBgOptions(opts) {}
export function setBgSeed(seed) {}
export function setParallaxOptions(opts) {}
export function getBackgroundCanvas() { return currentImage; }
export function getBackgroundSampleDescriptor() { return null; }
