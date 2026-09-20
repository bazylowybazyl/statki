import { initHexBody } from '../../src/game/destructor.js';

// Only raster input/drawing is stubbed. Hex generation, shard deformation,
// packed boundaries and destruction use the production implementation.
export function makeDestructorHull({ width = 320, height = 100, ...state } = {}) {
  const previousDocument = globalThis.document;
  const noop = () => {};
  const context = {
    drawImage: noop, save: noop, restore: noop, translate: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    clip: noop, fill: noop, clearRect: noop,
    getImageData(_x, _y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4).fill(255) };
    }
  };
  const entity = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    mass: 50000, noSplit: true, ...state
  };
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) };
    initHexBody(entity, { width, height });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  return entity;
}
