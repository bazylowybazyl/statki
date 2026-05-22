const DEFAULT_WRAP_SIZE = 220000;

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export const STAR_PARALLAX_LAYERS = Object.freeze([
  Object.freeze({
    name: 'deep',
    share: 0.42,
    parallax: 0.018,
    sizeMul: 0.56,
    brightnessMul: 0.46,
    stretchMul: 0.22,
  }),
  Object.freeze({
    name: 'mid',
    share: 0.43,
    parallax: 0.095,
    sizeMul: 0.78,
    brightnessMul: 0.66,
    stretchMul: 0.58,
  }),
  Object.freeze({
    name: 'speed',
    share: 0.15,
    parallax: 0.28,
    sizeMul: 1.06,
    brightnessMul: 0.88,
    stretchMul: 1.22,
  }),
]);

export function pickStarParallaxLayer(random01) {
  const r = clamp01(random01);
  let cursor = 0;
  for (let i = 0; i < STAR_PARALLAX_LAYERS.length; i++) {
    const layer = STAR_PARALLAX_LAYERS[i];
    cursor += layer.share;
    if (r <= cursor) return layer;
  }
  return STAR_PARALLAX_LAYERS[STAR_PARALLAX_LAYERS.length - 1];
}

export function wrapStarOffset(value, wrapSize = DEFAULT_WRAP_SIZE) {
  const size = Math.max(1, Number(wrapSize) || DEFAULT_WRAP_SIZE);
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % size) + size) % size;
}

export function computeStarCameraOffset(cameraX, cameraY, layer, wrapSize = DEFAULT_WRAP_SIZE) {
  const parallax = Math.max(0, Math.min(1, Number(layer?.parallax) || 0));
  return {
    x: wrapStarOffset((Number(cameraX) || 0) * parallax, wrapSize),
    y: wrapStarOffset(-(Number(cameraY) || 0) * parallax, wrapSize),
  };
}
