// src/3d/hullSurfaceWorker.js
//
// Worker wypieku mapy powierzchni kadłuba (src/3d/hullSurfaceBake.js) — poza wątkiem gry: sprite
// Atlasa (3747 × 1677) w mapie 1536 px to ~0,3 s rachunków. Wejście: ImageBitmap już w rozmiarze
// mapy (createImageBitmap z resize — skalowanie też poza wątkiem gry) albo gotowe RGBA.
// Wyjście: RGBA8 mapy (bufor przekazany, bez kopii).
import { bakeHullSurfaceField } from './hullSurfaceBake.js';

self.onmessage = (event) => {
  const { id, bitmap, rgba, w, h, pxPerTexel, options } = event.data || {};
  try {
    let pixels = rgba ? new Uint8ClampedArray(rgba) : null;
    if (!pixels && bitmap) {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      pixels = ctx.getImageData(0, 0, w, h).data;
      if (typeof bitmap.close === 'function') bitmap.close();
    }
    if (!pixels) throw new Error('brak pikseli');
    const data = bakeHullSurfaceField(pixels, w, h, pxPerTexel, options || {});
    self.postMessage({ id, ok: true, data: data.buffer, w, h }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
