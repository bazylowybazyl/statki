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

// Gwiazdy leżą w płaszczyźnie gry, więc oddalenie kamery mnożyło ich liczbę na
// ekranie (1/zoom²) — w skoku rozciągnięte smugi zlewały się w kurtynę (user
// 2026-09-26: „jak oddalisz kamerę, gwiazdy się kumulują”). Poniżej tego zoomu
// wzór gwiazd rozszerza się razem z kadrem: gęstość na ekranie zostaje taka jak
// przy STAR_ZOOM_REF (zoom widoku skoku); w zwykłym zakresie gry nic się nie zmienia.
export const STAR_ZOOM_REF = 0.065;

/** Mnożnik położeń gwiazd względem kamery przy danym zoomie (≥ 1). */
export function starZoomCompensation(zoom, ref = STAR_ZOOM_REF) {
  const z = Number(zoom);
  if (!(z > 0)) return 1;
  return Math.max(1, (Number(ref) || STAR_ZOOM_REF) / z);
}

/**
 * Kamera gwiazd (przesunięcie wzoru): całkuje ruch kamery gry podzielony przez
 * kompensację zoomu k — na ekranie gwiazdy przesuwają się tak samo jak bez
 * kompensacji, a zmiana zoomu nie przesuwa wzoru. maxStep > 0 ogranicza krok
 * (widok skoku: przy prędkości warpa paralaksa to szum). sc = { x, y, lx, ly }
 * — stan trzymany przez wołającego, (cx, cy) — kamera gry (świat, y w dół).
 */
export function advanceStarCamera(sc, cx, cy, k = 1, maxStep = 0) {
  const x = Number(cx) || 0;
  const y = Number(cy) || 0;
  if (!Number.isFinite(sc.lx) || !Number.isFinite(sc.ly)) {
    sc.x = x;
    sc.y = y;
    sc.lx = x;
    sc.ly = y;
    return sc;
  }
  let dx = x - sc.lx;
  let dy = y - sc.ly;
  sc.lx = x;
  sc.ly = y;
  const step = Number(maxStep) || 0;
  if (step > 0) {
    const d = Math.hypot(dx, dy);
    if (d > step) {
      dx *= step / d;
      dy *= step / d;
    }
  }
  const kk = Math.max(1e-6, Number(k) || 1);
  sc.x += dx / kk;
  sc.y += dy / kk;
  return sc;
}
