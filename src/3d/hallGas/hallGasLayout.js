// AGENT: wysokości i przeszkody bierzemy z K-7; osie tekstur = x, z hali, wysokość y.
import { createK7Layout } from '../haloRing/haloPortK7Layout.js';

export function hallGasDomain(h = 48) {
  const nx = Math.ceil(11520 / h / 8) * 8;
  const ny = Math.ceil(9216 / h / 8) * 8;
  const nz = Math.ceil(768 / h);
  return Object.freeze({ h, nx, ny, nz, x0: -nx * h / 2, z0: -160, w: nx * h, d: ny * h,
    height: nz * h, x1: nx * h / 2, z1: -160 + ny * h, cells: nx * ny * nz });
}

export const HALL_GAS_LAYOUT = createK7Layout();
