// src/game/fxRandomGame.js
//
// Strumień losowy GRY dla wizualiów i drobnej losowości liczonych na wątku głównym (RW-20, docs/PLAN-render-worker.md
// § 4): dźwięk strzału, cząstki kanwy (canvasParticleSystem, Hexlance kanwy), iskry zderzeń (collisionSparks), wyrzut
// dronów fabuły, plan przelotu NEA. Osobny od strumienia renderu (`fxRandom`, src/3d/fx/fxRandom.js), więc liczba
// losowań po stronie gry nie przesuwa efektów renderu (i odwrotnie) — w trybie worker każdy wątek ma swój ciąg.
// Nie zużywa `Math.random` gry. Harness (scripts/webgpu/harness-strona.js) ustawia ziarno obu strumieni.

import { FxRandom, FX_RANDOM_GAME_SEED } from '../render/fxRandomCore.js';

/** Strumień losowy gry (wizualia i drobna losowość wątku głównego). */
export const fxRandomGame = new FxRandom(FX_RANDOM_GAME_SEED);

if (typeof window !== 'undefined') window.fxRandomGame = fxRandomGame;
