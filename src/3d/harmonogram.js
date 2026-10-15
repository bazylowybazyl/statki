// src/3d/harmonogram.js
//
// Praca w tle i następna klatka w modułach renderu (RW-35, docs/PLAN-render-worker.md § 2.9). Jedyne miejsce
// warstwy renderu, które sięga po requestIdleCallback / requestAnimationFrame — z wykryciem: na wątku głównym
// zachowanie jak dawniej, w workerze (bez requestIdleCallback) — zapas wołającego (dawne gałęzie setTimeout).
// Strażnik tests/szewRenderu.test.mjs nie liczy tego pliku do DOM (lista MODULY_Z_WYKRYCIEM).

/**
 * requestIdleCallback(fn, options), gdy środowisko je ma; inaczej `fallback()` (wołający decyduje, jak dawniej:
 * setTimeout z opóźnieniem, wywołanie od razu…), a bez `fallback` — setTimeout(fn(null), 16).
 */
export function requestIdle(fn, options, fallback) {
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === 'function') return ric.call(globalThis, fn, options);
  if (fallback) return fallback();
  return setTimeout(() => fn(null), 16);
}

/** Czy środowisko ma requestIdleCallback (wybór strategii wołającego). */
export function hasIdleCallback() {
  return typeof globalThis.requestIdleCallback === 'function';
}

/** requestAnimationFrame (wątek główny i worker w Chromium); bez niego setTimeout 16 ms. */
export function requestFrame(fn) {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === 'function') return raf.call(globalThis, fn);
  return setTimeout(() => fn(performance.now()), 16);
}

/** cancelAnimationFrame dla uchwytu z requestFrame. */
export function cancelFrame(id) {
  const caf = globalThis.cancelAnimationFrame;
  if (typeof caf === 'function' && typeof globalThis.requestAnimationFrame === 'function') caf.call(globalThis, id);
  else clearTimeout(id);
}
