// src/game/playerCrew.js
//
// ZAŁOGA GRACZA, KABINY I KONTRAKTY ROTACYJNE (workforce, E16 W6 — docs/PROPOZYCJA-workforce.md § 6, D10, D11).
// Czyste funkcje nad stanem `PLAYER.crew` = `{ mode, count, contracts }` (bez DOM, three i świata ruchu — klej
// w index.html, blok „KADRY”; zapis w `src/game/playerSave.js`):
//  - `mode` — 'faction' (przydział frakcji: pełny skład kadłuba) albo 'own' (po zdradzie: `count` ludzi);
//  - `contracts` — ludzie w kabinach na kontraktach rotacyjnych `{ fromId, units, paid, secondsLeft }`: wzięci
//    w źródle (cena `ask`), oddani w porcie, który ich przyjmuje (cena `bid`); kontrakt wygasa po
//    `WORKFORCE_CONTRACT_SECONDS` czasu gry od zaokrętowania (ludzi nie da się trzymać na zapas) — wtedy wracają do
//    domu sami, a gracz traci, co zapłacił.
// Skutek załogi (D11): tylko tempo napraw roju R i przeładowania wież (`crewEffects`); lot i celność bez zmian.

import {
  PLAYER_CREW_COMPLEMENT, PLAYER_CREW_DEFAULT_COMPLEMENT, PLAYER_CREW_MODE, PLAYER_CREW_TUNE,
  HULL_PASSENGER_CABINS
} from '../data/playerCrew.js';
import { WORKFORCE_CONTRACT_SECONDS } from '../data/workforce.js';

/** Najwięcej osobnych kontraktów w kabinach (zapis i UI) — starsze o tym samym źródle łączą się. */
const MAX_CONTRACTS = 32;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Skład załogi kadłuba gracza (osoby). */
export function crewComplement(hullId) {
  const n = PLAYER_CREW_COMPLEMENT[String(hullId || '')];
  return n > 0 ? n : PLAYER_CREW_DEFAULT_COMPLEMENT;
}

/** Pojemność kabin kadłuba (osoby); 0 — kadłub nie ma gniazda KABINY. */
export function cabinSlotCapacity(hullId) {
  const n = HULL_PASSENGER_CABINS[String(hullId || '')];
  return n > 0 ? n : 0;
}

/** Stan startowy: przydział frakcji, kabiny puste. */
export function createPlayerCrew() {
  return { mode: PLAYER_CREW_MODE.FACTION, count: 0, contracts: [] };
}

/** Ludzie na pokładzie (załoga) przy kadłubie `hullId`. */
export function crewOnBoard(crew, hullId) {
  const complement = crewComplement(hullId);
  if (!crew || crew.mode !== PLAYER_CREW_MODE.OWN) return complement;
  return Math.max(0, Math.min(complement, Math.floor(finite(crew.count))));
}

/**
 * Skutek załogi (D11): `ratio` — obsada okrętu (0…1), `repair` — tempo pracy roju R, `reload` — tempo przeładowania
 * wież (1 = pełna załoga). Liniowo od `PLAYER_CREW_TUNE.*Min` przy pustej załodze. Bez alokacji, gdy podano `out`.
 */
export function crewEffects(crew, hullId, out = { ratio: 1, repair: 1, reload: 1 }) {
  const ratio = crewOnBoard(crew, hullId) / crewComplement(hullId);
  const r = Math.max(0, Math.min(1, ratio));
  out.ratio = r;
  out.repair = PLAYER_CREW_TUNE.repairMin + (1 - PLAYER_CREW_TUNE.repairMin) * r;
  out.reload = PLAYER_CREW_TUNE.reloadMin + (1 - PLAYER_CREW_TUNE.reloadMin) * r;
  return out;
}

/**
 * ZDRADA (fabuła, później — hak `PlayerCrew.betray()`): przydział frakcji przepada, zostają lojalni
 * (`betrayalFloor` składu bieżącego kadłuba). Drugi raz nic nie zmienia.
 */
export function betrayCrew(crew, hullId) {
  if (!crew || crew.mode === PLAYER_CREW_MODE.OWN) return false;
  crew.mode = PLAYER_CREW_MODE.OWN;
  crew.count = Math.ceil(crewComplement(hullId) * PLAYER_CREW_TUNE.betrayalFloor);
  return true;
}

/**
 * Czy w porcie da się werbować: tylko własna załoga (po zdradzie), tylko ośrodek ludności (`port.source`), nie u dawnej
 * frakcji, nie u piratów i nie w porcie opuszczonym. `port` — `{ factionId, source, pirate }`. `{ ok, reason }`.
 */
export function recruitCheck(crew, port, hullId) {
  if (!crew || crew.mode !== PLAYER_CREW_MODE.OWN) return { ok: false, reason: 'Załogę okrętu przydziela frakcja' };
  if (!port || !port.factionId) return { ok: false, reason: 'Port bez załogi — nie ma kogo werbować' };
  if (port.pirate) return { ok: false, reason: 'Piraci nie oddają ludzi' };
  if (port.factionId === PLAYER_CREW_TUNE.formerFaction) return { ok: false, reason: 'Porty dawnej frakcji odmawiają werbunku' };
  if (!port.source) return { ok: false, reason: 'Werbunek tylko w ośrodkach ludności' };
  if (crewOnBoard(crew, hullId) >= crewComplement(hullId)) return { ok: false, reason: 'Załoga w pełnym składzie' };
  return { ok: true, reason: null };
}

/** Werbunek `units` osób (po sprawdzeniu `recruitCheck` i zapłacie): zwraca, ilu przyjęto (do składu kadłuba). */
export function recruitCrew(crew, hullId, units) {
  if (!crew || crew.mode !== PLAYER_CREW_MODE.OWN) return 0;
  const room = Math.max(0, crewComplement(hullId) - crewOnBoard(crew, hullId));
  const n = Math.max(0, Math.min(room, Math.floor(finite(units))));
  crew.count = crewOnBoard(crew, hullId) + n;
  return n;
}

/** Ludzie w kabinach (osoby na kontraktach). */
export function passengersAboard(crew) {
  let sum = 0;
  for (const c of crew?.contracts || []) sum += Math.max(0, finite(c.units));
  return sum;
}

/** Wolne miejsca w kabinach przy pojemności `capacity`. */
export function cabinRoom(crew, capacity) {
  return Math.max(0, Math.floor(finite(capacity)) - passengersAboard(crew));
}

/** Kontrakt, który wygaśnie najwcześniej (sekundy) albo `Infinity`, gdy kabiny puste. */
export function nextContractExpiry(crew) {
  let min = Infinity;
  for (const c of crew?.contracts || []) if (c.units > 0 && c.secondsLeft < min) min = c.secondsLeft;
  return min;
}

/** Zaokrętowanie `units` osób ze źródła `fromId` po cenie `paid` za osobę (po zapłacie): kontrakt na `T`. */
export function boardContract(crew, { fromId, units, paid }) {
  const n = Math.max(0, Math.floor(finite(units)));
  if (!crew || !(n > 0)) return 0;
  if (!Array.isArray(crew.contracts)) crew.contracts = [];
  crew.contracts.push({
    fromId: String(fromId || ''), units: n, paid: Math.max(0, finite(paid)), secondsLeft: WORKFORCE_CONTRACT_SECONDS
  });
  if (crew.contracts.length > MAX_CONTRACTS) crew.contracts.splice(0, crew.contracts.length - MAX_CONTRACTS);
  return n;
}

/**
 * Wyokrętowanie do `units` osób (port przyjmuje tylu): najpierw najstarsze kontrakty (najbliżej wygaśnięcia).
 * Zwraca liczbę osób zdjętych z kabin.
 */
export function disembarkContracts(crew, units) {
  let left = Math.max(0, Math.floor(finite(units)));
  if (!crew?.contracts?.length || !left) return 0;
  crew.contracts.sort((a, b) => a.secondsLeft - b.secondsLeft);
  let moved = 0;
  for (const c of crew.contracts) {
    if (!left) break;
    const n = Math.min(left, c.units);
    c.units -= n;
    left -= n;
    moved += n;
  }
  crew.contracts = crew.contracts.filter(c => c.units > 0);
  return moved;
}

/**
 * Upływ czasu gry `dt` [s] (pauza = brak wywołań): kontrakty, którym minął czas, wygasają — ludzie wracają do domu
 * sami, gracz traci zapłatę. Zwraca liczbę osób z wygasłych kontraktów (0 — nic nie wygasło).
 */
export function tickContracts(crew, dt) {
  const list = crew?.contracts;
  if (!list?.length || !(dt > 0)) return 0;
  let expired = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    c.secondsLeft -= dt;
    if (c.secondsLeft > 0) continue;
    expired += c.units;
    list.splice(i, 1);
  }
  return expired;
}

/** Stan do zapisu gracza (`buildPlayerSave`). */
export function serializePlayerCrew(crew) {
  return {
    mode: crew?.mode === PLAYER_CREW_MODE.OWN ? PLAYER_CREW_MODE.OWN : PLAYER_CREW_MODE.FACTION,
    count: Math.max(0, Math.floor(finite(crew?.count))),
    contracts: (crew?.contracts || [])
      .filter(c => c && c.units > 0 && c.secondsLeft > 0)
      .map(c => ({
        fromId: String(c.fromId || ''), units: Math.floor(c.units),
        paid: Math.round(finite(c.paid) * 100) / 100, secondsLeft: Math.round(finite(c.secondsLeft) * 10) / 10
      }))
  };
}

/** Stan z zapisu (tolerancyjnie: brak pola, śmieci → przydział frakcji, puste kabiny). */
export function parsePlayerCrew(raw) {
  const crew = createPlayerCrew();
  if (!raw || typeof raw !== 'object') return crew;
  if (raw.mode === PLAYER_CREW_MODE.OWN) crew.mode = PLAYER_CREW_MODE.OWN;
  crew.count = Math.max(0, Math.floor(finite(raw.count)));
  for (const c of Array.isArray(raw.contracts) ? raw.contracts : []) {
    const units = Math.floor(finite(c?.units));
    const secondsLeft = Math.min(WORKFORCE_CONTRACT_SECONDS, finite(c?.secondsLeft));
    if (!(units > 0) || !(secondsLeft > 0)) continue;
    crew.contracts.push({ fromId: String(c.fromId || ''), units, paid: Math.max(0, finite(c.paid)), secondsLeft });
  }
  if (crew.contracts.length > MAX_CONTRACTS) crew.contracts.splice(0, crew.contracts.length - MAX_CONTRACTS);
  return crew;
}
