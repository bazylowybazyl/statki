// src/game/hullDesign/workships/index.js
//
// KREATOR KADŁUBÓW — REJESTR STATKÓW ROBOCZYCH (złomowanie; zestaw: ./workKit.js, osprzęt dla gry:
// ../hullDesignWorkRig.js). Każdy plik eksportuje `{ key, label, cls: [mostek, rdzeń], make }` (albo null — preset
// w budowie, pomijany). HD_PRESETS (src/game/hullDesign/hullDesignPresets.js) dokłada je sam w grupie 'work' („Statki
// robocze”), a hullDesignPreset() podaje `cls` do applySystemSlots — nowy statek = nowy plik + import tutaj.
// Kolejność = kolejność procesu złomowania: tnie i ładuje → zjada → miele → rafinuje → wywozi → podnosi.

import zlomiarz from './zlomiarz.js';
import paszcza from './paszcza.js';
import mlyn from './mlyn.js';
import rafineria from './rafineria.js';
import rampowiec from './rampowiec.js';
import dzwig from './dzwig.js';

export const HD_WORKSHIPS = Object.freeze([zlomiarz, paszcza, mlyn, rafineria, rampowiec, dzwig].filter(Boolean));
/** Klucz → { label, make, group } dla HD_PRESETS (grupa „Statki robocze”). */
export const HD_WORKSHIP_PRESETS = Object.freeze(Object.fromEntries(HD_WORKSHIPS.map((f) => [f.key, Object.freeze({ label: f.label, make: f.make, group: 'work' })])));
/** Klucz → [poziom mostka, poziom rdzenia] (applySystemSlots — opts.cls). */
export const HD_WORKSHIP_CLASS = Object.freeze(Object.fromEntries(HD_WORKSHIPS.map((f) => [f.key, f.cls])));
/** Klucze presetów statków roboczych (kolejność rejestru). */
export const HD_WORKSHIP_KEYS = Object.freeze(HD_WORKSHIPS.map((f) => f.key));
