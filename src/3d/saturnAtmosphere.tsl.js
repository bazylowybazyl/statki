// src/3d/saturnAtmosphere.tsl.js
//
// Żywa atmosfera Saturna — barwa dnia z przepływu (TSL). Gałąź grafu powierzchni planety: rodzaj 'saturn'
// w planet3d.assets.tsl.js (graf 'surface' 1:1, tylko próbka mapy dnia z przepływu). Silnik wspólny z Jowiszem
// (gasGiantAtmosphere.tsl.js — pasy, wiry, CZAPY POLARNE z sześciokątem płn.); model i zegar: saturnAtmosphere.js.
import { SATURN_MODEL, SATURN_UNIFORM_KEYS } from './saturnAtmosphere.js';
import { createGasGiantFlowDayColor } from './gasGiantAtmosphere.tsl.js';

export { SATURN_UNIFORM_KEYS };

/** Barwa mapy dnia Saturna z przepływu (rgb, liniowo) — wołane w Fn fragmentu grafu powierzchni. */
export const saturnFlowDayColor = createGasGiantFlowDayColor(SATURN_MODEL);
