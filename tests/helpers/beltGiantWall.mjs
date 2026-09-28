// Olbrzym pasa z siatką syntetyczną do testów kolizji (zadanie 21): lita ściana dla
// x lokalnego ≥ 0, próżnia po lewej (normalna SDF = (−1, 0)). Plan prawdziwego presetu
// (wymiary, pasmo SDF), siatka bez sekund liczenia bryły.

import { BeltGiants } from '../../src/game/asteroidBeltGiants.js';
import { buildGiantPlan, GiantRock } from '../../src/game/asteroidGiants.js';

export function wallGiant(presetId, seed, x, y) {
  const plan = buildGiantPlan(presetId, seed);
  const g = new GiantRock(plan, x, y);
  const { nx, ny, nz, ext } = g.dims;
  const v = plan.voxel;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const sdf = -(i * v - ext[0]);
        g.grid[(k * ny + j) * nx + i] = Math.max(1, Math.min(255, Math.round(128 + (sdf / g.band) * 127)));
      }
    }
  }
  g.ready = true;
  return g;
}

// GiantBuilder zastępczy: siatka od razu (bez workerów), licznik budów.
export function syncBuilderFactory(make, counter = { n: 0 }) {
  return () => ({
    build(id, seed, x, y) {
      counter.n++;
      const giant = make(id, seed, x, y);
      return { giant, promise: Promise.resolve(giant) };
    },
    dispose() {}
  });
}

// Pas z jednym olbrzymem-ścianą, zbudowanym od razu.
export function wallBeltGiants(presetId = 'arch', x = 0, y = 0, counter = { n: 0 }) {
  const giants = new BeltGiants({
    field: null,
    sites: [{ id: presetId, seed: 1, x, y }],
    createBuilder: syncBuilderFactory(wallGiant, counter)
  });
  giants.requestNear(x, y);
  return giants;
}
