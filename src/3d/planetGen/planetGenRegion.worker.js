// Worker: spływ wody REGIONU pod kamerą (planetGenRegion.js) — drzewo strumieni na siatce lokalnej, poza wątkiem obrazu.
// Wejście: { id, h (Float32Array N × N, ≤ 0 = ujście), N, seed, wander }. Wyjście: { id, data (Uint8Array RGBA), stats }.
import { computeDrainage } from './planetGenDrainage.js';

self.onmessage = (ev) => {
  const { id, h, N, seed, wander } = ev.data;
  try {
    const d = computeDrainage(h, null, N, N, { wrapX: false, rowWeight: false, plumes: false, seed, wander });
    self.postMessage({ id, data: d.data, stats: d.stats }, [d.data.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message ? e.message : e) });
  }
};
