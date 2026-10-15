// src/render/bodyColor.js
//
// Średni kolor obrazu kadłuba — barwa smugi dalekiego kadłuba i zimnego wraku. Wspólny dla renderu
// (hexBodyImpostorBatch.js computeAverageBodyColor → THREE.Color) i gry (src/game/coldWreckView.js: smuga zimnego
// wraku na belkach liczona przy zamrażaniu, RW-31). Bez three i `window`; płótno 2D z `document` (wątek główny),
// a bez niego z `OffscreenCanvas` (worker renderu).
//
// Liczony RAZ na obraz (audyt FPS 2026-10-11): wraki dziedziczą obraz rodu (hullBodies.js), a każdy nowy wrak liczył
// średnią od nowa — płótno, drawImage całego sprite'a i getImageData (szczyty 0,8–1,1 ms/kl w końcówce bitwy).
// Pamiętany tylko udany wynik (obraz jeszcze bez rozmiaru albo bez treści — następne wołanie spróbuje znowu).

const _rgbBySource = new WeakMap();

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * Średni kolor sprite'a {r, g, b} w [0, 1] (tylko piksele o alfie ≥ 64 — przezroczyste tło zjadałoby barwę do
 * czerni) albo null. Wynik z pamięci jest wspólny — tylko do odczytu. `useCache = false` — liczy od nowa (A/B).
 */
export function averageImageRGB(source, useCache = true) {
  if (!source || typeof source !== 'object') return null;
  if (useCache) {
    const cached = _rgbBySource.get(source);
    if (cached !== undefined) return cached;
  }
  const width = source.naturalWidth || source.width || 0;
  const height = source.naturalHeight || source.height || 0;
  if (!width || !height) return null;

  // NIGDY nie wołamy getContext/getImageData na źródle. `grid.cacheCanvas` to ten sam canvas, z którego leci
  // tekstura pancerza — pobranie z niego kontekstu 2D z `willReadFrequently` (albo samo getImageData) każe
  // przeglądarce przenieść backing store do pamięci CPU i od tej pory KAŻDY upload tekstury z tego canvasa jest
  // wolny, na stałe. Kopiujemy do własnego bufora 32 × 32 i czytamy tylko jego.
  const canvas = makeCanvas(Math.min(32, width), Math.min(32, height));
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try { ctx.drawImage(source, 0, 0, canvas.width, canvas.height); }
  catch (_) { return null; }

  let data;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
  catch (_) { return null; }

  const stride = Math.max(1, Math.floor((canvas.width * canvas.height) / 1024));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < canvas.width * canvas.height; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 64) continue;
    r += data[o]; g += data[o + 1]; b += data[o + 2];
    n++;
  }
  if (n === 0) return null;
  const rgb = { r: (r / n) / 255, g: (g / n) / 255, b: (b / n) / 255 };
  if (useCache) _rgbBySource.set(source, rgb);
  return rgb;
}
