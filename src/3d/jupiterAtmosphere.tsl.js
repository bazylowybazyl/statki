// src/3d/jupiterAtmosphere.tsl.js
//
// Żywa atmosfera Jowisza — barwa dnia z przepływu (TSL). Gałąź grafu powierzchni planety: rodzaj 'jupiter'
// w planet3d.assets.tsl.js to ten sam graf co 'surface' (oświetlenie, terminator, pas zachodu, cień ringu, bloom
// — 1:1), tylko próbka mapy dnia idzie przez `jupiterFlowDayColor`. Dane, pasy, wiry, zegar: jupiterAtmosphere.js.
// Od 2026-10-09 shader liczy wspólny silnik gazowych olbrzymów (gasGiantAtmosphere.tsl.js — opis kroków tam);
// Jowisz bez czap polarnych — WGSL jak dawniej.
import { JUPITER_MODEL, JUPITER_UNIFORM_KEYS } from './jupiterAtmosphere.js';
import { createGasGiantFlowDayColor } from './gasGiantAtmosphere.tsl.js';

/** Tekstura profilu wiatru (jedna na grę — jeden Jowisz). */
export function jupiterWindTexture() {
  return JUPITER_MODEL.windTexture();
}

export { JUPITER_UNIFORM_KEYS };

/**
 * Barwa mapy dnia Jowisza z przepływu (rgb, liniowo — jak próbka mapy sRGB). Wołane wewnątrz Fn fragmentu grafu
 * powierzchni: `dayTex` — węzeł tekstury dnia per obiekt (uv = uv siatki), `uv` — uv siatki, `st0` / `st1` —
 * pochodne uv policzone przed gałęziami, `U` — uniformy per obiekt (w tym JUPITER_UNIFORM_KEYS).
 */
export const jupiterFlowDayColor = createGasGiantFlowDayColor(JUPITER_MODEL);
