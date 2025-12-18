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
// Zmniejszamy limit: im mniejsza liczba, tym SZYBCIEJ przesuwa się tło (większa czułość paralaksy).
// Przy 100k wykorzystasz szybciej ten "zapas" obrazka, który masz.
const WORLD_RADIUS_LIMIT = 100000;

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
  // Liczymy, gdzie tło powinno być w skali 1:1
  const minScaleW = (sw / currentImage.width) * 1.15;
  const minScaleH = (sh / currentImage.height) * 1.15;
  const baseScale = Math.max(minScaleW, minScaleH) * config.scale;
  
  const baseW = currentImage.width * baseScale;
  const baseH = currentImage.height * baseScale;

  // 3. Obliczamy Slack (Luz) na podstawie bazowych wymiarów
  const slackX = (baseW - sw) / 2;
  const slackY = (baseH - sh) / 2;

  // 4. Pobieramy pozycję kamery
  // FIX: Pobieramy wymiary świata z globalnego obiektu WORLD (jeśli istnieje),
  // aby wycentrować paralaksę na środku mapy (Słońcu), a nie na współrzędnych 0,0.
  const worldW = window.WORLD ? window.WORLD.w : 0;
  const worldH = window.WORLD ? window.WORLD.h : 0;
  
  // Odejmujemy połowę świata, aby (0,0) dla paralaksy wypadło na środku mapy gry
  const camX = (camera.x || 0) - (worldW / 2);
  const camY = (camera.y || 0) - (worldH / 2);

  // 5. Obliczamy postęp paralaksy (-1 do 1)
  const progressX = Math.max(-1, Math.min(1, camX / WORLD_RADIUS_LIMIT));
  const progressY = Math.max(-1, Math.min(1, camY / WORLD_RADIUS_LIMIT));

  // 6. Obliczamy przesunięcie
  // Minus przy X zapewnia, że tło przesuwa się przeciwnie do ruchu statku
  const offsetX = -progressX * slackX; 
  const offsetY = -progressY * slackY; 

  // 7. Rysowanie z Transformacją
  const camZoomFactor = Math.pow(camera.zoom || 1.0, 0.1); 

  ctx.save();
  
  // A. Najpierw ustawiamy punkt odniesienia na ŚRODEK EKRANU.
  ctx.translate(halfW, halfH);
  
  // B. Skalujemy (Zoomujemy)
  ctx.scale(camZoomFactor, camZoomFactor);
  
  // C. Dopiero teraz przesuwamy o paralaksę.
  ctx.translate(offsetX, offsetY);
  
  // D. Opcjonalna jasność
  if (config.brightness !== 1.0) ctx.globalAlpha = config.brightness;
  
  // E. Rysujemy obrazek wycentrowany względem punktu (0,0)
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
