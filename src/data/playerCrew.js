// src/data/playerCrew.js
//
// ZAŁOGA I KABINY GRACZA (workforce, E16 W6 — docs/PROPOZYCJA-workforce.md § 6, decyzje użytkownika D10, D11).
//
// Załoga: na starcie (oficer Terra Novy) daje ją frakcja — pełny skład, bez werbunku. Po zdradzie (fabuła, później;
// hak `PlayerCrew.betray()`) zostaje garstka lojalnych (`betrayalFloor` składu), a resztę gracz werbuje w NEUTRALNYCH
// ośrodkach ludności (nie u dawnej frakcji, nie u piratów) — z tego samego zapasu `workforce` rynku, po cenie kontraktu.
// Skutek niepełnej załogi (D11) to WYŁĄCZNIE tempo napraw (rój dronów R) i przeładowania wież; lot i celność bez zmian.
//
// Kabiny pasażerskie (D10): gniazdo KABINY w refit ręcznym (wzór: ZBIÓRKA) — część jak moduł (hangar ↔ gniazdo),
// pojemność w osobach z kadłuba (Atlas 300). Bez kabin terminal nie wyda kontraktu rotacyjnego. Kabiny mają własną
// przestrzeń — nie zabierają ton ładowni.
//
// Czyste dane (bez importów). Logika: src/game/playerCrew.js.

/** Skład załogi kadłuba gracza (osoby) — od niego liczy się obsada okrętu. */
export const PLAYER_CREW_COMPLEMENT = Object.freeze({
  atlas: 260,
  frigate: 40,
  corvus: 40,
  pirate_frigate: 35,
  destroyer: 90,
  pirate_destroyer: 80,
  battleship: 220,
  pirate_battleship: 200,
  carrier: 320,
  supercapital: 520,
  megafreighter: 60
});
/** Kadłub spoza tabeli. */
export const PLAYER_CREW_DEFAULT_COMPLEMENT = 60;

export const PLAYER_CREW_MODE = Object.freeze({
  /** Przydział frakcji (start kampanii, oficer Terra Novy): pełny skład, bez werbunku. */
  FACTION: 'faction',
  /** Własna załoga (po zdradzie): liczba ludzi, werbunek w neutralnych źródłach. */
  OWN: 'own'
});

export const PLAYER_CREW_TUNE = Object.freeze({
  /** Po zdradzie zostaje tyle składu (lojalni oficerowie). */
  betrayalFloor: 0.25,
  /** Dawna frakcja gracza — jej porty odmawiają werbunku po zdradzie. */
  formerFaction: 'terra_nova',
  /** Tempo napraw roju R przy pustej załodze (liniowo do 1 przy pełnym składzie). */
  repairMin: 0.4,
  /** Tempo przeładowania wież przy pustej załodze (liniowo do 1 przy pełnym składzie). */
  reloadMin: 0.7
});

/** Gniazdo KABINY: jedna część na kadłub (wzór: sprzęt ZBIÓRKI). */
export const PASSENGER_CABINS = Object.freeze({
  id: 'passenger_cabins',
  label: 'KABINY PASAŻERSKIE',
  short: 'KABINY',
  desc: 'przewóz ludzi na kontraktach rotacyjnych (karta KADRY) · własna przestrzeń, bez ton ładowni',
  price: 6000
});

/** Pojemność kabin kadłuba (osoby). Kadłub spoza tabeli albo 0 — gniazda nie ma (fregaty). */
export const HULL_PASSENGER_CABINS = Object.freeze({
  atlas: 300,
  destroyer: 40,
  pirate_destroyer: 40,
  battleship: 150,
  pirate_battleship: 120,
  carrier: 400,
  supercapital: 600,
  megafreighter: 1500
});

/** Ile osób na jedno kliknięcie w karcie KADRY (kontrakty i werbunek). */
export const PLAYER_CREW_STEP = 50;
