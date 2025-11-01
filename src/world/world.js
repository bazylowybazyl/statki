export function createWorld({ width = 240000, height = 160000 } = {}) {
  return {
    w: width,
    h: height,
  };
}

export const WORLD = createWorld();

if (typeof window !== 'undefined' && typeof window.WORLD === 'undefined') {
  window.WORLD = WORLD;
}
