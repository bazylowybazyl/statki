// src/game/cometNucleusWorker.js
//
// Worker: powierzchnia i siatka pola odległości jądra komety (cometNucleus.js) — ~0,2–0,3 s CPU na jądro,
// poza wątkiem gry. Wejście: { job, nucleus, opts }, wyjście: tablice jako transferable.

import { buildNucleusAssets } from './cometNucleus.js';

self.onmessage = (e) => {
  const { job, nucleus, opts } = e.data;
  try {
    const { surface, grid } = buildNucleusAssets(nucleus, opts || {});
    const transfer = [surface.positions.buffer, surface.normals.buffer, surface.ao.buffer, surface.indices.buffer,
      surface.outline.buffer, grid.data.buffer];
    self.postMessage({ job, surface, grid }, transfer);
  } catch (err) {
    self.postMessage({ job, error: String((err && err.stack) || err) });
  }
};
