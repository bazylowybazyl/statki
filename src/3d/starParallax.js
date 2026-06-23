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
    parallaxMin: 0.01,
    parallaxMax: 0.028,
    sizeMul: 0.56,
    brightnessMul: 0.46,
    stretchMul: 0.22,
  }),
  Object.freeze({
    name: 'mid',
    share: 0.45,
    parallax: 0.095,
    parallaxMin: 0.055,
    parallaxMax: 0.18,
    sizeMul: 0.78,
    brightnessMul: 0.66,
    stretchMul: 0.58,
  }),
  Object.freeze({
    name: 'speed',
    share: 0.13,
    parallax: 1.35,
    parallaxMin: 1.02,
    parallaxMax: 1.78,
    sizeMul: 0.82,
    brightnessMul: 0.74,
    stretchMul: 1.75,
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

export function computeStarParallaxFactor(layer, random01) {
  const base = Math.max(0, Math.min(2.5, Number(layer?.parallax) || 0));
  const min = Math.max(0, Math.min(2.5, Number(layer?.parallaxMin) || base));
  const max = Math.max(min, Math.min(2.5, Number(layer?.parallaxMax) || base));
  const r = clamp01(random01);
  if (r <= 0) return min;
  if (r >= 1) return max;
  return min + (max - min) * r;
}

export function wrapStarOffset(value, wrapSize = DEFAULT_WRAP_SIZE) {
  const size = Math.max(1, Number(wrapSize) || DEFAULT_WRAP_SIZE);
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % size) + size) % size;
}

export function computeStarCameraOffset(cameraX, cameraY, layer, wrapSize = DEFAULT_WRAP_SIZE) {
  const parallax = Math.max(0, Math.min(2.5, Number(layer?.parallax) || 0));
  return {
    x: wrapStarOffset((Number(cameraX) || 0) * parallax, wrapSize),
    y: wrapStarOffset(-(Number(cameraY) || 0) * parallax, wrapSize),
  };
}
