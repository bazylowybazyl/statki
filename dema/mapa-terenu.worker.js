// Worker dema mapy terenu: generator (czysty JS) liczy poza wątkiem strony — przy 2048 × 2048 to kilka sekund.
import { generateTerrainMap } from '../src/3d/planetGen/planetGenTerrainMap.js';

self.onmessage = (ev) => {
  const { id, opts } = ev.data;
  try {
    const map = generateTerrainMap(opts);
    self.postMessage({ id, size: map.size, extentKm: map.extentKm, cellM: map.cellM, seed: map.seed, stats: map.stats, albedo: map.albedo.buffer }, [map.albedo.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
