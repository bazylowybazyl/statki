// src/data/trafficHulls.js
//
// Kadłuby ruchu v2 (docs/PLAN-ruch-v2-w-grze.md § 3.1 i § 5, zadanie Z4).
//
// Kurs ruchu zna tylko `unitClass`: klasę z gry (`freighter-medium`), kadłub
// statku firmy albo kupca (`container_ship`, `heavy_freighter`) albo rolę
// (`raider`, `tug`, `warfleet`). Tu klasa dostaje profil kadłuba
// (HULL_RENDER_PROFILES) i sprite. Bez tego każda klasa bez profilu spadała
// w dokach na obrys kontenerowca (dockLayout.hullFootprint), a render proxy
// w bańce nie miałby czego narysować.
//
// Czyste dane bez DOM i Three — czyta je render proxy (src/3d/shipProxyBatch3D.js),
// a gabaryty może brać i worker ruchu. Sprite'y przez `new URL(literał,
// import.meta.url)`: Vite dołącza plik do builda, w node to ścieżka file://.
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE, getHullRenderSize } from './ships.js';

/**
 * Kadłuby, które ruch v2 umie narysować.
 *   sprite  URL obrazka
 *   png     [szer., wys.] płótna PNG — rozmiar w grze bez czekania na obraz
 *           (getHullRenderSize), pilnuje go test z nagłówkiem pliku
 *   main    dysze MAIN [x, y, d] w pikselach PNG od środka płótna (+x dziób,
 *           +y prawa burta = dół obrazka, jak markery edytora), d = średnica
 *           wylotu; zmierzone na sprite'ach 2026-09-26 (rufa = lewa krawędź)
 *   editorKey  zamiast `main`: dysze i rozmiar silników z danych edytora
 *           (SHIP_EDITOR_DEFAULTS, ENGINE_FX_DEFAULTS) jak u NPC
 *   fx      palety silników, gdy inne niż zapasowe (ENGINE_FX_FALLBACK)
 */
const PIRATE_FX = Object.freeze({ mainPalette: 'rakieta', warpPalette: 'crimson' });

export const TRAFFIC_HULLS = Object.freeze({
  inter_station_shuttle: Object.freeze({
    sprite: new URL('../../assets/inter_station_shuttle.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-448, -114, 70], [-448, 104, 70]]
  }),
  container_ship: Object.freeze({
    sprite: new URL('../../assets/container_ship.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-785, -156, 68], [-814, -12, 90], [-785, 132, 68]]
  }),
  long_haul_freighter: Object.freeze({
    sprite: new URL('../../assets/long_haul_freighter.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-786, -148, 68], [-805, -18, 95], [-786, 114, 68]]
  }),
  // TODO AGENT: sprite zastępczy (frachtowiec dalekiego zasięgu w skali 1800 j.,
  // jak HALO_PLAYER_HULLS w haloPortHulls.js). Własny `assets/ships/heavy_freighter.png`
  // z Z11 już jest — po przyjęciu przez użytkownika podmienić tu i w haloPortHulls
  // (obrys kolizji z alfy, 4 dysze zamiast 3).
  heavy_freighter: Object.freeze({
    sprite: new URL('../../assets/long_haul_freighter.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-786, -148, 68], [-805, -18, 95], [-786, 114, 68]]
  }),
  // Jeden sprite całego składu (2760 j.) — tyle, ile widać z daleka i w porcie.
  // TODO AGENT (Z13): pełny NPC megafrachtowca to pociąg z megafreighterTrain.js
  // (lokomotywa + wagony + ogon); awans proxy → NPC musi wybrać jedno z dwóch.
  megafreighter: Object.freeze({
    sprite: new URL('../../assets/megafreighter.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-822, -197, 60], [-822, -116, 60], [-848, -20, 66], [-822, 77, 60], [-822, 157, 60]]
  }),
  heavy_harvester: Object.freeze({
    sprite: new URL('../../assets/heavy_harvester.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-797, -193, 74], [-838, -96, 43], [-827, -24, 51], [-837, 50, 44], [-797, 145, 74]]
  }),
  belter: Object.freeze({
    sprite: new URL('../../assets/belter.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-594, -161, 85], [-591, -22, 76], [-594, 116, 85]]
  }),
  surveyor: Object.freeze({
    sprite: new URL('../../assets/surveyor.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-740, -43, 60], [-740, 29, 60]]
  }),
  refinery_tender: Object.freeze({
    sprite: new URL('../../assets/refinery_tender.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-757, -186, 84], [-758, -18, 117], [-757, 150, 84]]
  }),
  tanker: Object.freeze({
    sprite: new URL('../../assets/tanker.png', import.meta.url).href,
    png: [1780, 884],
    main: [[-784, -153, 69], [-806, -17, 97], [-784, 121, 69]]
  }),
  salvage_hauler: Object.freeze({
    sprite: new URL('../../assets/salvage_hauler.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-789, -149, 65], [-808, -16, 97], [-789, 118, 65]]
  }),
  construction_tug: Object.freeze({
    sprite: new URL('../../assets/construction_tug.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-727, -132, 77], [-728, -18, 71], [-727, 97, 77]]
  }),
  // TODO AGENT: rejder to okręt bojowy — przed awansem proxy do pełnego NPC (Z13)
  // mostek wg docs/BRIEF-mostek-nowego-kadluba.md (strefa, model, paleta).
  pirate_raider: Object.freeze({
    sprite: new URL('../../assets/pirate_raider.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-784, -122, 68], [-778, -2, 64], [-784, 118, 68]],
    fx: PIRATE_FX
  }),
  smuggler: Object.freeze({
    sprite: new URL('../../assets/smuggler.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-732, -111, 73], [-730, -11, 50], [-732, 89, 73]],
    fx: PIRATE_FX
  }),
  repair_drone: Object.freeze({
    sprite: new URL('../../assets/repair_drone.png', import.meta.url).href,
    png: [1536, 1024],
    main: [[-320, -116, 80], [-320, 34, 80]]
  }),
  distress_beacon_ship: Object.freeze({
    sprite: new URL('../../assets/distress_beacon_ship.png', import.meta.url).href,
    png: [1774, 887],
    main: [[-560, -72, 77], [-560, 98, 77]]
  }),
  // Okręty Terra Novy: role bez własnych sprite'ów (łowca, policja, wojna) i zapas
  // okrętów frakcji w halach K-7 / na redzie wojskowej (shipyards.WARSHIP_CLASSES,
  // portParking.placeFleetStock).
  terran_frigate: Object.freeze({
    sprite: new URL('../assets/ships/terranfrigate.png', import.meta.url).href,
    png: [2400, 1792],
    editorKey: 'frigate'
  }),
  terran_destroyer: Object.freeze({
    sprite: new URL('../assets/ships/terrandestroyer.png', import.meta.url).href,
    png: [768, 573],
    editorKey: 'destroyer'
  }),
  terran_battleship: Object.freeze({
    sprite: new URL('../assets/ships/terranbattleship.png', import.meta.url).href,
    png: [1158, 714],
    editorKey: 'battleship'
  }),
  terran_carrier: Object.freeze({
    sprite: new URL('../assets/ships/terrancarrier.png', import.meta.url).href,
    png: [1672, 941],
    editorKey: 'terran_carrier'
  }),
  // Okręty piratów: suchy dok misji 1 (demo dema/suchy-dok-piratow.html — okręty w stanowiskach i eskorta
  // wylatująca z hali jako proxy); w grze te kadłuby mają pełni NPC (index.html, HULL_SPRITE_PATHS_BY_ID).
  pirate_frigate: Object.freeze({
    sprite: new URL('../assets/ships/piratefrigate.png', import.meta.url).href,
    png: [1942, 809],
    editorKey: 'pirate_frigate'
  }),
  pirate_destroyer: Object.freeze({
    sprite: new URL('../assets/ships/piratedestroyer.png', import.meta.url).href,
    png: [1840, 854],
    editorKey: 'pirate_destroyer'
  }),
  pirate_battleship: Object.freeze({
    sprite: new URL('../assets/ships/piratebattleship.png', import.meta.url).href,
    png: [1727, 911],
    editorKey: 'pirate_battleship'
  })
});

/**
 * Klasy i role kursów, które nie są same id kadłuba. Klasa będąca kadłubem
 * z TRAFFIC_HULLS (statki firm: `hullForVanClass`, kupcy: `agentFleets`)
 * rozwiązuje się na siebie.
 */
export const TRAFFIC_UNIT_HULLS = Object.freeze({
  // Kursy bez przypisanego statku — przewozy i wyprawy górnicze (trafficDirector
  // unitClassFor → cargoFleet.pickVanClass). Sylwetki jak vany w index.html
  // (FREIGHTER_HULL_BY_TYPE) poza `capital`: klasy heavy i mega (≥ 380 t) to
  // ciężki frachtowiec, jak statki firm (transportCompanies.hullForVanClass).
  'freighter-small': 'inter_station_shuttle',
  'freighter-medium': 'container_ship',
  'freighter-large': 'long_haul_freighter',
  'freighter-capital': 'heavy_freighter',
  // Piractwo (piracy.js): rejd i przemyt.
  raider: 'pirate_raider',
  smuggler: 'smuggler',
  // Łowca nagród frakcji (piracy.js, kurs PATROL). TODO AGENT: własny sprite
  // `assets/ships/bounty_hunter.png` z Z11 (profil 440 × 150) jest w repo, ale
  // niezarejestrowany — kadłub bojowy, więc najpierw mostek; do tego czasu fregata.
  hunter: 'terran_frigate',
  // Złomiarze (scrapperFleets.js): holownik po wrak — tnie albo holuje.
  tug: 'salvage_hauler',
  // Wyprawa wojenna (warDispatcher.js): jeden kurs = cała flota. TODO AGENT:
  // rodziny frakcyjne z Z11 (mars_/inner_/belt_/outer_destroyer…, z mostkami)
  // i szyk kilku proxy na kurs; dziś jeden niszczyciel Terra Novy.
  warfleet: 'terran_destroyer',
  // Role, których ruch v2 jeszcze nie wystawia — mapowania tymczasowe.
  // TODO AGENT: kuter `assets/ships/police_cutter.png` z Z11 (300 × 110, bojowy → mostek).
  police: 'terran_frigate',
  // TODO AGENT: `assets/ships/rescue_ship.png` z Z11 (400 × 150, cywilny, bez mostka).
  rescue: 'distress_beacon_ship'
});

/** Klasa spoza rejestru: obrys jak w dockLayout.hullFootprint (kontenerowiec). */
export const TRAFFIC_FALLBACK_HULL = 'container_ship';

/** Id kadłuba dla klasy kursu (zawsze kadłub z TRAFFIC_HULLS). */
export function resolveTrafficHullId(unitClass) {
  const key = String(unitClass || '');
  const mapped = TRAFFIC_UNIT_HULLS[key];
  if (mapped) return mapped;
  return TRAFFIC_HULLS[key] ? key : TRAFFIC_FALLBACK_HULL;
}

/** Czy klasa kursu ma w rejestrze własny kadłub (bez zapasowego obrysu). */
export function isKnownTrafficUnitClass(unitClass) {
  const key = String(unitClass || '');
  return !!(TRAFFIC_UNIT_HULLS[key] || TRAFFIC_HULLS[key]);
}

/** Profil kadłuba klasy kursu (HULL_RENDER_PROFILES). */
export function trafficHullProfile(unitClass) {
  return HULL_RENDER_PROFILES[resolveTrafficHullId(unitClass)];
}

/**
 * Gabaryty klasy kursu w jednostkach świata — ten sam wzór co
 * dockLayout.hullFootprint (długość × 0,6, 2 × promień × 0,6), tylko klasa
 * przechodzi przez rejestr zamiast spadać na kontenerowiec.
 */
export function trafficHullFootprint(unitClass) {
  const profile = trafficHullProfile(unitClass);
  return {
    length: profile.length * HULL_RENDER_WORLD_SCALE,
    width: profile.radius * 2 * HULL_RENDER_WORLD_SCALE
  };
}

/**
 * Płaszczyzna sprite'a w grze { w, h } (j. świata) — getHullRenderSize z płótnem
 * PNG, jak kadłub pełnego NPC z tego obrazka (index.html, getNpcHexInitSource).
 */
export function trafficHullRenderSize(hullId) {
  const hull = TRAFFIC_HULLS[hullId];
  if (!hull) return null;
  return getHullRenderSize(hullId, hull.png[0], hull.png[1]);
}
