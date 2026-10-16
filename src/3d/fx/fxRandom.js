// src/3d/fx/fxRandom.js
//
// Generator losowy WARSTWY EFEKTÓW (mulberry32 z ziarnem). Efekty (receptury broni i
// rakiet, migotanie świateł, ziarna paczek GPU) nie zużywają `Math.random` gry:
//   • logika gry zostaje deterministyczna niezależnie od tego, ile efektów wysypano
//     (liczba i kolejność losowań `Math.random` nie zależy od obrazu — PLAN §7,
//     PROJEKT-BRONI §0.9: stare efekty kanwy wołane z fizyki rozjeżdżały sceny harnessu);
//   • sceny harnessu mają powtarzalne efekty: `fxRandom.seed(v)` razem z `H.reseed`
//     (harness ustawia to samo ziarno co `Math.random` — ten sam algorytm co
//     `scripts/webgpu/harness-strona.js`).
//
// Bez alokacji: stan to jedna liczba całkowita (int32), `next()` to kilka mnożeń. Klasa — src/render/fxRandomCore.js;
// wizualia liczone na wątku głównym losują z osobnego strumienia gry (src/game/fxRandomGame.js, RW-20).

export { FxRandom, FX_RANDOM_SEED } from '../../render/fxRandomCore.js';
import { FxRandom } from '../../render/fxRandomCore.js';

/** Wspólny generator warstwy efektów (jeden ciąg dla wszystkich modułów `src/3d/fx/`). */
export const fxRandom = new FxRandom();

// Harness (scripts/webgpu) sięga po generator z przeglądarki, jak po SimClock / ActiveCarrier.
if (typeof window !== 'undefined') window.fxRandom = fxRandom;
