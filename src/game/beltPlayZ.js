// src/game/beltPlayZ.js
//
// Głębokość skał pasma PLAY (gry) pod płaszczyzną: czubek skały pod z = 0 — kadłuby (z ≈ 0)
// zawsze nad skałą; skały z minerałami sięgają dalej (czubki kryształów ~1,6 promienia).
// Jedno źródło dla rozgrywki (platforma wydobywcza — src/game/beltWorld.js) i obrazu
// (warstwa PLAY, burza, przelot NEA — src/3d/asteroids/asteroidBelt.js). Typy z minerałami =
// klucze MINERAL_RECIPES w src/3d/asteroids/minerals.js (zgodność pilnuje tests/beltWorld.test.mjs).

import { ROCK_TYPE_INDEX } from './asteroidRockKinds.js';

export const MINERAL_ROCK_TYPE_IDS = Object.freeze([
  'crystal', 'ice', 'uran', 'silicon', 'energy', 'carbon', 'basalt', 'metal', 'platinum', 'carbon_ice'
]);

const MINERAL_TYPE_SET = new Set(MINERAL_ROCK_TYPE_IDS.map((id) => ROCK_TYPE_INDEX[id]));

/** z środka skały pasma PLAY (rekord pola: r, type, sx, sy, sz). */
export function beltPlayZ(rock) {
  return -rock.r * (MINERAL_TYPE_SET.has(rock.type) ? 1.62 : 1.45) * Math.max(rock.sx, rock.sy, rock.sz);
}
