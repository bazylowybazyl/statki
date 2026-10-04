// src/3d/reactorBlast/palette.js
//
// Barwy i skale wybuchu reaktora (reżyser: reactorBlastFx.js). Barwy LINIOWE; jasności wg
// planu pasm HDR gry (próg bloomu 0,9 bramkuje pełną wartością, ACES bieli > ~1,5):
//   • nad progiem tylko małe i krótkie: biały rdzeń błysku, świeża plazma, nić strumienia,
//     iskry, łuki, linia anamorficzna (6–30);
//   • ciała efektów (plazma, ogień, oświetlony dym) 0,4–1,3 — barwa frakcji zostaje barwą;
//   • halo błysku i otoczki 0,2–0,7 (pod progiem — inaczej bloom zalewa kadr).
// Jednostki: j. świata gry, sekundy.

import { lin, SMOKE_KIND } from '../rockets/palette.js';

/** Barwa plazmy reaktora wg frakcji (jak REACTOR_COLORS dema rdzenia: ciało w paśmie barwy). */
export const REACTOR_PLASMA = Object.freeze({
  terran: Object.freeze([0.22, 0.72, 1.0]),
  pirate: Object.freeze([1.0, 0.16, 0.34]),
  player: Object.freeze([0.62, 0.42, 1.0])
});

/**
 * Barwa plazmy do shaderów: największy kanał = 1 (shader mnoży ją przez pasmo). Normowanie do
 * luminancji dawało nasyconej czerwieni piratów kanał R × 2,6 — ciało plazmy przechodziło przez
 * ACES w róż i biel; przy normowaniu do maksimum barwa zostaje barwą.
 */
export function normalizePlasma(c, out = [0, 0, 0]) {
  const m = Math.max(1e-3, c[0], c[1], c[2]);
  out[0] = c[0] / m; out[1] = c[1] / m; out[2] = c[2] / m;
  return out;
}

/**
 * Paleta dymu „opary metalu i plazmy” (wolne miejsce 7 puli dymu rakiet — PAL_CAP 8):
 * zimny szary, świeży gaz świeci błękitną bielą, stygnie przez pomarańcz, gęsty i długi.
 */
export const REACTOR_VAPOR_PALETTE = Object.freeze({
  albedo: Object.freeze(lin('#7d8189', 0.92)), drag: 1.35,
  hot: Object.freeze([2.4, 2.6, 3.0]), warm: Object.freeze([1.1, 0.34, 0.07]), tempTau: 0.22,
  turb: 74, turbScale: 320, fadeTau: 4.4, stretch: 0.2
});
export const SMOKE_SOOT = SMOKE_KIND.SOOT;
export const SMOKE_DEBRIS = SMOKE_KIND.DEBRIS;
export const SMOKE_VAPOR = SMOKE_KIND.VAPOR;

/** Skala efektów wg klasy rdzenia (liczby cząstek, wstrząs; rozmiary idą z promienia kadłuba). */
export const CLASS_FX = Object.freeze({
  escort: Object.freeze({ count: 0.5, life: 0.72, shake: 0.5 }),
  cruiser: Object.freeze({ count: 0.75, life: 0.86, shake: 0.75 }),
  capital: Object.freeze({ count: 1, life: 1, shake: 1 })
});

/**
 * Obraz wariantu detonacji: kula (× promień wybuchu), bryły (lumps — przedział), iskry,
 * płonące odłamki, dym, błysk, fala; crack — plazma bije z pęknięć (przełamanie, rozerwanie).
 */
export const VARIANT_FX = Object.freeze({
  shatter: Object.freeze({ fireball: 1.0, lumps: [4, 7], sparks: 1.0, frags: 1.0, smoke: 1.0, flash: 1.0, shock: 1.0, crack: 0.35 }),
  halves: Object.freeze({ fireball: 0.62, lumps: [2, 3], sparks: 0.8, frags: 0.75, smoke: 0.8, flash: 0.8, shock: 0.8, crack: 1 }),
  thirds: Object.freeze({ fireball: 0.68, lumps: [3, 4], sparks: 0.85, frags: 0.8, smoke: 0.85, flash: 0.85, shock: 0.85, crack: 1 }),
  hole: Object.freeze({ fireball: 0.86, lumps: [3, 5], sparks: 0.9, frags: 0.8, smoke: 1.0, flash: 0.9, shock: 0.9, crack: 0 }),
  jet: Object.freeze({ fireball: 0.42, lumps: [1, 2], sparks: 0.45, frags: 0.4, smoke: 0.5, flash: 0.55, shock: 0.5, crack: 0 }),
  orb: Object.freeze({ fireball: 0.36, lumps: [1, 2], sparks: 0.4, frags: 0.35, smoke: 0.45, flash: 0.5, shock: 0.45, crack: 0 }),
  'orb-burst': Object.freeze({ fireball: 0.8, lumps: [2, 3], sparks: 0.55, frags: 0.45, smoke: 0.6, flash: 0.75, shock: 0.6, crack: 0 })
});

// Iskry i żar: gorąca biel, złoto, pomarańcz (HDR boost daje pula iskier).
export const SPARK_HOT = Object.freeze([1.0, 0.92, 0.8]);
export const SPARK_GOLD = Object.freeze(lin('#ffb347'));
export const SPARK_WARM = Object.freeze(lin('#ff6a1a'));
export const EMBER_LIGHT = Object.freeze([1.0, 0.55, 0.22]);
// Odłamki rozgrzane do czerwoności (pula DEBRIS broni): żar → blacha.
export const CHUNK_HOT = Object.freeze([2.2, 1.05, 0.34]);
export const CHUNK_STEEL = Object.freeze([0.3, 0.3, 0.33]);
export const CHUNK_DARK = Object.freeze([0.22, 0.21, 0.2]);
export const FIRE_HOT = Object.freeze([2.6, 1.3, 0.42]);
export const FIRE_COOL = Object.freeze([0.8, 0.18, 0.03]);
export const FIRE_DIM = Object.freeze([1.25, 0.6, 0.2]);
