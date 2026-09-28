// src/3d/warp/palette.js
//
// Barwy warpa „Nurt” z palet plazmy WARP gry (src/data/engineFx.js,
// WARP_PLASMA_PALETTES — te same, z których pali warpPlume3D): rdzeń, ciało,
// otoczka i poświata w barwach LINIOWYCH (jak THREE.Color.setHex przy
// włączonym zarządzaniu kolorem). Czysty moduł (bez three) — testy w Node.
// Wzory 1:1 z dema (dema/warp-webgpu/hulls.js: warpPalette, heatColor).

import { WARP_PLASMA_PALETTES } from '../../data/engineFx.js';

const srgbToLinear = (c) => (c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

function hexLin(hex) {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255)
  ];
}

const _cache = new Map();

/** Barwy plazmy WARP z palety gry (liniowo): { id, core, body, outer, glow } — obiekt współdzielony (nie zmieniać). */
export function warpPalette(id) {
  const key = String(id || '');
  let out = _cache.get(key);
  if (out) return out;
  const pal = WARP_PLASMA_PALETTES.find((p) => p.id === key) || WARP_PLASMA_PALETTES[0];
  out = Object.freeze({
    id: pal.id,
    core: Object.freeze(hexLin(pal.core[0])),
    body: Object.freeze(hexLin(pal.body[2])),
    outer: Object.freeze(hexLin(pal.outer[1])),
    glow: Object.freeze(hexLin(pal.glow[1]))
  });
  _cache.set(key, out);
  return out;
}

/** Paleta encji: blok engineFx z edytora albo zapas silników (piraci karmazyn, reszta magenta). */
export function entityWarpPaletteId(entity) {
  const id = entity?.visual?.engineFx?.warpPalette || entity?.__engineFxFallback?.warpPalette;
  if (id) return id;
  return (entity?.isPirate || entity?.pirate || entity?.faction === 'pirate') ? 'crimson' : 'magenta';
}

/** Barwa szwu (linia frontu na kadłubie, HDR): (rdzeń·0,7 + ciało·0,3)·6 — jak w demie. */
export function seamColor(pal, out) {
  for (let i = 0; i < 3; i++) out[i] = (pal.core[i] * 0.7 + pal.body[i] * 0.3) * 6.0;
  return out;
}

/** Żar kadłuba: 1 = biel, 0,55 = pomarańcz, 0,25 = wiśnia (liniowo, HDR) — heatColor z dema. */
export function heatColor(h, out) {
  const k = Math.max(0, Math.min(1, h));
  const r = Math.min(1, k * 2.4);
  const g = Math.max(0, Math.min(1, (k - 0.28) * 1.7));
  const b = Math.max(0, Math.min(1, (k - 0.62) * 2.2));
  const I = k * k * 1.5 + k * 0.25;
  out[0] = r * I;
  out[1] = g * g * I;
  out[2] = b * b * I * 0.9;
  return out;
}
