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
// Promień świata gry w jednostkach logicznych.
// Neptun jest na ok. 360 000. Dajemy 450 000 dla bezpieczeństwa.
// To oznacza: "Gdy gracz przeleci 450 000 jednostek, tło przesunie się do samej krawędzi".
const WORLD_RADIUS_LIMIT = 450000;

const config = {
  quality: '4k',      
  scale: 1.0,       // Bazowy zoom obrazka (1.0 = dopasuj do ekranu z zapasem)
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

  // --- MATEMATYKA "SMART PARALLAX" ---

  // 2. Ustalanie minimalnej skali, żeby obrazek ZAWSZE zakrywał ekran
  // Nawet jak zrobisz zoom out w oknie 4K, tło musi być większe.
  // Dajemy mnożnik 1.15, żeby mieć 15% zapasu na ruchy paralaksy.
  const minScaleW = (sw / currentImage.width) * 1.15;
  const minScaleH = (sh / currentImage.height) * 1.15;
  
  // Wybieramy większą skalę, żeby nie było pasów ani w pionie, ani w poziomie
  // Dodatkowo uwzględniamy zoom kamery, ale BARDZO delikatnie (pow 0.1),
  // żeby tło było "daleko" i prawie się nie przybliżało.
  const camZoomFactor = Math.pow(camera.zoom || 1.0, 0.1); 
  const baseScale = Math.max(minScaleW, minScaleH);
  
  // Ostateczna wielkość rysowanego obrazka
  const drawW = currentImage.width * baseScale * config.scale * camZoomFactor;
  const drawH = currentImage.height * baseScale * config.scale * camZoomFactor;

  // 3. Obliczamy "Slack" (Luz)
  // Ile pikseli obrazka wystaje poza ekran? To jest nasz budżet na ruch.
  const slackX = (drawW - sw) / 2;
  const slackY = (drawH - sh) / 2;

  // 4. Pozycja kamery względem środka świata (Słońca)
  // Jeśli nie znasz środka świata, zakładamy 0,0.
  // W Twojej grze Słońce jest chyba na WORLD.w/2, WORLD.h/2, 
  // ale kamera.x/y to pozycje absolutne. 
  // Przyjmijmy, że (0,0) to środek logiczny dla paralaksy.
  let camX = camera.x || 0;
  let camY = camera.y || 0;

  // (Opcjonalnie: Centrowanie na Słońcu, jeśli masz dostęp do zmiennej WORLD)
  // const centerX = (window.WORLD?.w || 0) / 2;
  // const centerY = (window.WORLD?.h || 0) / 2;
  // camX -= centerX; 
  // camY -= centerY;

  // 5. Obliczamy przesunięcie (Clamp)
  // Mapujemy pozycję gracza (-450k do +450k) na dostępny luz (-slack do +slack).
  // Clampujemy pozycję kamery, żeby tło nigdy nie uciekło, nawet jak wylecisz poza mapę.
  const progressX = Math.max(-1, Math.min(1, camX / WORLD_RADIUS_LIMIT));
  const progressY = Math.max(-1, Math.min(1, camY / WORLD_RADIUS_LIMIT));

  const offsetX = -progressX * slackX;
  const offsetY = -progressY * slackY;

  // 6. Rysowanie
  // Środek ekranu + offset - połowa obrazka
  const x = (sw / 2) + offsetX - (drawW / 2);
  const y = (sh / 2) + offsetY - (drawH / 2);

  ctx.save();
  if (config.brightness !== 1.0) ctx.globalAlpha = config.brightness;
  
  // Rysujemy RAZ (bez pętli)
  ctx.drawImage(currentImage, x, y, drawW, drawH);
  
  ctx.restore();
}

// Helpers
export function resizeSpaceBg(w, h) {}
export function setBgOptions(opts) {}
export function setBgSeed(seed) {}
export function setParallaxOptions(opts) {}
export function getBackgroundCanvas() { return currentImage; }
export function getBackgroundSampleDescriptor() { return null; }
