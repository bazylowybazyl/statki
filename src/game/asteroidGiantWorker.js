// src/game/asteroidGiantWorker.js
//
// Worker: liczy kawałek (plastry z) siatki SDF olbrzyma — asteroidGiants.js.
// Plan budowany od nowa z (preset, seed) — deterministyczny, identyczny jak
// w wątku głównym. Wynik (Uint8Array) wraca jako transferable.

import { buildGiantPlan, giantGridDims, fillGiantGrid } from './asteroidGiants.js';

const plans = new Map();

self.onmessage = (e) => {
  const { job, presetId, seed, z0, z1 } = e.data;
  try {
    const key = `${presetId}:${seed}`;
    let plan = plans.get(key);
    if (!plan) {
      plan = buildGiantPlan(presetId, seed);
      plans.set(key, plan);
    }
    const dims = giantGridDims(plan);
    const slab = new Uint8Array(dims.nx * dims.ny * (z1 - z0));
    fillGiantGrid(plan, slab, dims, z0, z1, z0);
    self.postMessage({ job, z0, z1, slab }, [slab.buffer]);
  } catch (err) {
    self.postMessage({ job, error: String(err && err.stack || err) });
  }
};
