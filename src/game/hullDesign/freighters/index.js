// src/game/hullDesign/freighters/index.js
//
// KREATOR KADŁUBÓW — REJESTR FRACHTOWCÓW (presety statków cywilnych; zestaw: ./freighterKit.js). Każdy plik eksportuje
// `{ key, label, cls: [mostek, rdzeń], make }` (albo null — preset w budowie, pomijany). HD_PRESETS
// (src/game/hullDesign/hullDesignPresets.js) dokłada je sam, a hullDesignPreset() podaje `cls` do applySystemSlots, więc
// nowy frachtowiec = nowy plik + import tutaj. Kolejność = kolejność na liście presetów (od najmniejszego).

import prom from './prom.js';
import kurier from './kurier.js';
import kontenerowiec from './kontenerowiec.js';
import tankowiec from './tankowiec.js';
import masowiec from './masowiec.js';
import katamaran from './katamaran.js';
import megafrachtowiec from './megafrachtowiec.js';

export const HD_FREIGHTERS = Object.freeze([prom, kurier, kontenerowiec, tankowiec, masowiec, katamaran, megafrachtowiec].filter(Boolean));
/** Klucz → { label, make } dla HD_PRESETS (grupa „Cywilne”). */
export const HD_FREIGHTER_PRESETS = Object.freeze(Object.fromEntries(HD_FREIGHTERS.map((f) => [f.key, Object.freeze({ label: f.label, make: f.make, group: 'civil' })])));
/** Klucz → [poziom mostka, poziom rdzenia] (applySystemSlots — opts.cls). */
export const HD_FREIGHTER_CLASS = Object.freeze(Object.fromEntries(HD_FREIGHTERS.map((f) => [f.key, f.cls])));
