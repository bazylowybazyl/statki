// src/3d/warp/bloomKnee.js
//
// Kolano bloomu efektów „Nurtu” (szczeliny, błyski, smugi, szew i żar kadłuba).
// Demo (dema/warp-webgpu/post.js) liczy bloom BloomNode BEZ kompozytu ×3 dawnego passu WebGL,
// który gra zachowuje (BLOOM_ZGODNOSC_WEBGL, src/3d/tsl/postGry.js) — ta sama barwa HDR daje
// w grze 3× mocniejszą poświatę (brzegi szczelin i błyski obrastały białą mgłą).
// Bloom bierze CAŁY teksel ponad progiem, więc kolano działa na luminancji:
//   ≤ próg     — bez zmian (wszystko pod progiem wygląda jak w demie),
//   nadmiar    — ×1/3: poświata jasnych rdzeni (≫ próg) wraca w pobliże energii z dema,
//                a rdzeń po ACES zmienia się o kilka procent (8 → 3,3: 1,00 → 0,95).
// Teksele tuż nad progiem dalej dają ~3× (próg bramkuje cały teksel) — kompromis.
// Barwa (proporcje rgb) zostaje. Ośrodka nie dotyczy (drobiny pod progiem, sumy gęstych
// obszarów bloomują jak w grze).

import { dot, max, vec3 } from 'three/tsl';
import { BLOOM_DEFAULTS } from '../bloomConfig.js';
import { BLOOM_ZGODNOSC_WEBGL } from '../tsl/postGry.js';

export const WARP_KNEE_THRESHOLD = BLOOM_DEFAULTS.threshold;
export const WARP_KNEE_SLOPE = 1 / BLOOM_ZGODNOSC_WEBGL;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Kolano w TSL (rgb HDR, liniowe) → rgb. */
export function warpBloomKnee(rgb) {
  const lum = dot(rgb, vec3(LUMA_R, LUMA_G, LUMA_B)).toVar();
  const over = max(lum.sub(WARP_KNEE_THRESHOLD), 0.0);
  const k = lum.sub(over.mul(1 - WARP_KNEE_SLOPE)).div(max(lum, 1e-4));
  return rgb.mul(k);
}

/** Lustro CPU (testy): współczynnik, przez który kolano mnoży rgb. */
export function warpBloomKneeScale(r, g, b) {
  const lum = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  if (!(lum > WARP_KNEE_THRESHOLD)) return 1;
  return (lum - (lum - WARP_KNEE_THRESHOLD) * (1 - WARP_KNEE_SLOPE)) / lum;
}
