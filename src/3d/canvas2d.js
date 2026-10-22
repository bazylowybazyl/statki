// src/3d/canvas2d.js
//
// Kanwy 2D i obrazy w modułach renderu bez DOM (RW-35, docs/PLAN-render-worker.md § 2.9): ten sam kod na wątku
// głównym i w workerze renderu.
//   - kanwa: zawsze OffscreenCanvas (tekstury proceduralne, atlasy napisów, odczyt pikseli obrazu); w Node (testy)
//     atrapa `document.createElement` testów albo null — jak dawne `typeof document === 'undefined'`;
//   - obraz z pliku: ImageBitmap z fetch + createImageBitmap z `premultiplyAlpha: 'none'` (alfa bez mnożenia — jak
//     `<img>` przy wysyłce `copyExternalImageToTexture` z premultipliedAlpha: false) i domyślną konwersją przestrzeni
//     barw (jak dekodowanie `<img>`; THREE.ImageBitmapLoader wymusza 'none' — inne piksele przy profilu ICC / gAMA);
//     `texture.flipY` WebGPU honoruje także dla ImageBitmap (WebGPUTextureUtils._copyImageToTexture → flipY kopii);
//   - rozmiar i gotowość obrazu dowolnego źródła (HTMLImageElement, ImageBitmap, kanwa).
import * as THREE from 'three';

/**
 * Nowa kanwa 2D: OffscreenCanvas (przeglądarka, worker). Bez niego (Node) — atrapa `document.createElement` testów,
 * a bez atrapy null (jak dawne `typeof document === 'undefined'`).
 */
export function createCanvas2D(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return null;
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Rozmiar obrazu w px: naturalny (`<img>`, wideo) albo width / height (ImageBitmap, kanwa). */
export function imageSize(image) {
  const w = Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0;
  const h = Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0;
  return { w, h };
}

/** Obraz gotowy do rysowania: `<img>` wczytany (complete), niezerowy rozmiar. */
export function isImageReady(image) {
  if (!image) return false;
  if (image.complete === false) return false;
  const { w, h } = imageSize(image);
  return w > 0 && h > 0;
}

/** Kanwa (OffscreenCanvas albo element kanwy) jako źródło tekstury (CanvasTexture). */
export function isCanvasSource(source) {
  if (!source) return false;
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) return true;
  return typeof source.getContext === 'function' && typeof source.width === 'number' && source.nodeName === 'CANVAS';
}

const BITMAP_OPTIONS = Object.freeze({ premultiplyAlpha: 'none', colorSpaceConversion: 'default' });

/**
 * Obraz z adresu jako ImageBitmap (Promise). `resize` — { width, height } (opcjonalnie): dekodowanie od razu do
 * mniejszego rozmiaru (np. mapa 8192 × 4096 dla dalekiej planety → 4096 × 2048 — czwarta część pamięci GPU).
 */
export function loadImageBitmap(url, resize = null) {
  const opts = resize && resize.width > 0 && resize.height > 0
    ? { ...BITMAP_OPTIONS, resizeWidth: resize.width | 0, resizeHeight: resize.height | 0, resizeQuality: 'high' }
    : BITMAP_OPTIONS;
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`obraz ${url}: HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => createImageBitmap(blob, opts));
}

/**
 * Tekstura z pliku — zamiennik `new THREE.TextureLoader().load(url, onLoad, undefined, onError)`: tekstura od razu,
 * obraz (ImageBitmap) i `needsUpdate` po wczytaniu, potem `onLoad(tekstura)`.
 */
export function loadTexture(url, onLoad, onError) {
  const texture = new THREE.Texture();
  loadImageBitmap(url).then((bitmap) => {
    texture.image = bitmap;
    texture.needsUpdate = true;
    if (onLoad) onLoad(texture);
  }, (err) => {
    if (onError) onError(err);
    else console.error(`[canvas2d] tekstura ${url}:`, err);
  });
  return texture;
}
