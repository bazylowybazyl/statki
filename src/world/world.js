export function createWorld({ width = 0, height = 0 } = {}) {
  return {
    w: width,
    h: height,
  };
}

export function setWorldSize(world, { width, height }) {
  if (!world || typeof world !== 'object') return;
  if (Number.isFinite(width)) world.w = width;
  if (Number.isFinite(height)) world.h = height;
}

export const WORLD = createWorld();

if (typeof window !== 'undefined' && typeof window.WORLD === 'undefined') {
  window.WORLD = WORLD;
}
