"use strict";

// --- KONFIGURACJA PLIKÓW ---
const BACKGROUNDS = {
  '8k':  '/assets/nebula_8k.png',
  '4k':  '/assets/nebula_4k.png',
  '2k':  '/assets/nebula_2k.png'
};

let currentImage = null;
let isLoaded = false;

// --- DEFINICJA ŚWIATA ---
// Zwiększyłem margines, żeby paralaksa była jeszcze subtelniejsza
const WORLD_RADIUS_LIMIT = 500000;

const config = {
  quality: '4k',      
  scale: 1.0,       // Bazowa skala
  brightness: 1.0
};

// --- API ---
window.Nebula = {
  setQuality: (quality) => {
    if (!BACKGROUNDS[quality]) return console.warn('Brak jakości:', quality);
    config.quality = quality;
    loadBackground();
  },
  getConfig: () => config
};

function loadBackground() {
  isLoaded = false;
  const url = BACKGROUNDS[config.quality];
  console.log(`[Tyro] Ładowanie Single-Image: ${url}`);
  
  const img = new Image();
  img.src = url;
  img.onload = () => {
    console.log(`[Tyro] Gotowe (${img.width}x${img.height})`);
    currentImage = img;
    isLoaded = true;
  };
  img.onerror = () => {
    console.error(`[Tyro] Błąd pliku: ${url}`);
    if (config.quality === '8k') window.Nebula.setQuality('4k');
  };
}

export function initSpaceBg() {
  loadBackground();
  return true;
}

export function drawSpaceBg(ctx, camera) {
  // 1. Tło bezpieczeństwa
  const sw = ctx.canvas.width;
  const sh = ctx.canvas.height;
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, sw, sh);

  if (!isLoaded || !currentImage) return;

  const halfW = sw / 2;
  const halfH = sh / 2;

  // 2. Obliczamy BAZOWE wymiary (bez zoomu kamery)
  // To jest kluczowe dla naprawy "pływania" przy zoomie.
  // Liczymy, gdzie tło powinno być w skali 1:1, a zoom nakładamy na końcu transformacją.
  
  const minScaleW = (sw / currentImage.width) * 1.15;
  const minScaleH = (sh / currentImage.height) * 1.15;
  const baseScale = Math.max(minScaleW, minScaleH) * config.scale;
  
  const baseW = currentImage.width * baseScale;
  const baseH = currentImage.height * baseScale;

  // 3. Obliczamy Slack (Luz) na podstawie bazowych wymiarów
  const slackX = (baseW - sw) / 2;
  const slackY = (baseH - sh) / 2;

  // 4. Pobieramy pozycję kamery
  // Zakładamy, że (0,0) to środek mapy (Słońce).
  const camX = camera.x || 0;
  const camY = camera.y || 0;

  // 5. Obliczamy postęp paralaksy (-1 do 1)
  const progressX = Math.max(-1, Math.min(1, camX / WORLD_RADIUS_LIMIT));
  const progressY = Math.max(-1, Math.min(1, camY / WORLD_RADIUS_LIMIT));

  // 6. Obliczamy przesunięcie
  // FIX 1: Usunąłem minus przy progressX, aby odwrócić kierunek paralaksy w poziomie.
  // Teraz lot w prawo przesuwa tło w lewo (poprawnie).
  const offsetX = progressX * slackX; 
  const offsetY = -progressY * slackY; // Y zostawiamy jak było (było OK)

  // 7. Rysowanie z Transformacją
  // FIX 2: Zamiast przeliczać współrzędne x/y ręcznie, używamy translate + scale.
  // Dzięki temu zoom (scale) wykonuje się względem obliczonego środka (translate).
  
  // Obliczamy współczynnik zoomu tła (bardzo delikatny)
  const camZoomFactor = Math.pow(camera.zoom || 1.0, 0.1); 

  ctx.save();
  
  // A. Ustawiamy środek rysowania w centrum ekranu + przesunięcie paralaksy
  ctx.translate(halfW + offsetX, halfH + offsetY);
  
  // B. Skalujemy "w miejscu"
  ctx.scale(camZoomFactor, camZoomFactor);
  
  // C. Opcjonalna jasność
  if (config.brightness !== 1.0) ctx.globalAlpha = config.brightness;
  
  // D. Rysujemy obrazek wycentrowany w punkcie (0,0) kontekstu
  ctx.drawImage(
      currentImage, 
      -baseW / 2, 
      -baseH / 2, 
      baseW, 
      baseH
  );
  
  ctx.restore();
}

// Helpers
export function resizeSpaceBg(w, h) {}
export function setBgOptions(opts) {}
export function setBgSeed(seed) {}
export function setParallaxOptions(opts) {}
export function getBackgroundCanvas() { return currentImage; }
export function getBackgroundSampleDescriptor() { return null; }
