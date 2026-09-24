// Reguła celowania obrony punktowej (PD).
//
// PD = broń na gnieździe `aux`: CIWS, laser PD, flak. Domyślny cel PD to
// rakiety/torpedy i myśliwce. Kadłuby (fregata i wyżej, także gracz) tylko
// wtedy, gdy właściciel ma PD CHIP — i zawsze niżej w kolejce niż rakiety
// i myśliwce. Dawniej kadłub spoza `prefers` dostawał wynik 0 zamiast
// odrzucenia, więc tysiące luf PD w bitwie mieliły kadłuby za 20% obrażeń
// i produkowały ~90% wszystkich pocisków (docs/AUDYT-wydajnosc-bitwa-2026-09-24.md, 2.1).

import { PD_CHIP_ID } from '../data/chips.js';

export { PD_CHIP_ID };

// Wynik kadłuba dla PD z chipem. Musi przegrać z każdą rakietą i myśliwcem
// niezależnie od dystansu: AI liczy wynik = preferencja − d²·0,001, a zasięg
// PD sięga 5 200 u (flak_capital), czyli kary do ~27 000. Milion to zapas.
export const PD_HULL_SCORE = -1e6;

export function isPointDefenseWeapon(def) {
  return String(def?.mountType || '').toLowerCase() === 'aux';
}

// `kind` jak z getUnitKind (index.html) albo 'rocket' dla pocisku.
export function isPointDefenseTargetKind(kind) {
  return kind === 'rocket' || kind === 'fighter';
}

export function pdCanTargetKind(kind, hullsAllowed) {
  return isPointDefenseTargetKind(kind) || hullsAllowed === true;
}
