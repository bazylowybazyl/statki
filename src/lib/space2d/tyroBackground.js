"use strict";

const BACKGROUNDS = {
  '8k':  '/assets/nebula_8k.png',
  '4k':  '/assets/nebula_4k.png',
  '2k':  '/assets/nebula_2k.png'
};

let currentImage = null;
let isLoaded = false;
let debugLogTimer = 0; // Do dławienia logów w konsoli

const config = {
  quality: '4k',
  scale: 1.0,
  brightness: 1.0,
  // WYŁĄCZAMY PARALAKSĘ DLA TESTU:
  // Tło będzie "przyklejone" do ekranu jak tapeta
  testMode: true 
};

window.Nebula = {
  setQuality: (quality) => {
    config.quality = quality;
    loadBackground();
  },
  getConfig: () => config
};

function loadBackground() {
  isLoaded = false;
  const url = BACKGROUNDS[config.quality];
  console.log(`[Tyro] Ładowanie: ${url}`);
  
  const img = new Image();
  img.src = url;
  img.onload = () => {
    console.log(`[Tyro] ZAŁADOWANO: ${img.width}x${img.height}`);
    currentImage = img;
    isLoaded = true;
  };
  img.onerror = () => {
    console.error(`[Tyro] BŁĄD PLIKU: ${url}`);
  };
}

export function initSpaceBg() {
  loadBackground();
  return true;
}

export function drawSpaceBg(ctx, camera) {
  // 1. Tło bezpieczeństwa (Ciemny fiolet, żeby odróżnić od czerni canvasa)
  const sw = ctx.canvas.width;
  const sh = ctx.canvas.height;
  ctx.fillStyle = '#0a000a'; 
  ctx.fillRect(0, 0, sw, sh);

  if (!isLoaded || !currentImage) {
      // Jeśli obrazka nie ma, rysujemy czerwony X na środku
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0,0); ctx.lineTo(sw, sh);
      ctx.moveTo(sw,0); ctx.lineTo(0, sh);
      ctx.stroke();
      return;
  }

  // Środek ekranu
  const cx = sw / 2;
  const cy = sh / 2;

  // Wymiary obrazka
  const imgW = currentImage.width * config.scale;
  const imgH = currentImage.height * config.scale;

  // POZYCJA RYSOWANIA
  let drawX, drawY;

  if (config.testMode) {
      // TRYB TESTOWY: Idealnie na środku ekranu, ignoruje kamerę
      drawX = cx - (imgW / 2);
      drawY = cy - (imgH / 2);
  } else {
      // TRYB DOCELOWY (Paralaksa)
      // Tu wkleimy poprawioną matematykę, jak test zadziała
      drawX = 0; 
      drawY = 0;
  }

  // DIAGNOSTYKA (Loguje co 100 klatek)
  debugLogTimer++;
  if (debugLogTimer > 100) {
      console.log(`[Tyro Draw] Ekran: ${sw}x${sh} | Obraz: ${imgW}x${imgH} | Rysuję na: ${Math.floor(drawX)}, ${Math.floor(drawY)}`);
      debugLogTimer = 0;
  }

  // RYSOWANIE
  ctx.save();
  if (config.brightness !== 1.0) ctx.globalAlpha = config.brightness;
  
  try {
      ctx.drawImage(currentImage, drawX, drawY, imgW, imgH);
      
      // Rysujemy zieloną ramkę wokół obrazka, żebyś widział gdzie on jest
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 4;
      ctx.strokeRect(drawX, drawY, imgW, imgH);
      
  } catch (e) {
      console.error("[Tyro] Błąd drawImage:", e);
  }
  
  ctx.restore();
}

// Helpers
export function resizeSpaceBg(w, h) {}
export function setBgOptions(opts) {}
export function setBgSeed(seed) {}
export function setParallaxOptions(opts) {}
export function getBackgroundCanvas() { return currentImage; }
export function getBackgroundSampleDescriptor() { return null; }
