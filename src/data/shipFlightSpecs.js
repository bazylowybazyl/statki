// src/data/shipFlightSpecs.js
//
// Specyfikacje lotu okrętów NPC (w duchu Starsectora) — JEDYNE źródło prawdy
// o tym, jak kadłub przyspiesza, hamuje i skręca.
//
// Integrator (src/game/flight/shipFlightModel.js) egzekwuje te liczby co do
// joty, a pilot AI planuje z nich drogę hamowania i skręty. To celowo ta sama
// tabela po obu stronach: wcześniej prowadzenie WYNIKAŁO z geometrii dysz
// w edytorze, masy, bezwładności i tarcia, a pilot planował z innych liczb —
// fregata „420 u/s" osiągała realnie 109 u/s, a pancernik nie umiał zawrócić.
//
// Jednostki: prędkości u/s, przyspieszenia u/s², obrót w STOPNIACH (°/s, °/s²).
//   maxSpeed     — prędkość bojowa; twardy limit (nadmiar ścina governor z `decel`)
//   accel        — ciąg do przodu
//   decel        — hamowanie w DOWOLNYM kierunku (jak klawisz S w Starsectorze)
//   strafeAccel  — ciąg boczny; kadłuby bez dysz bocznych mają go mało
//                  i naturalnie „obracają się, żeby pchnąć" (turn-to-burn)
//   reverseAccel — ciąg wsteczny
//   turnRate     — maksymalna prędkość obrotu
//   turnAccel    — przyspieszenie kątowe (ile trwa rozkręcenie i wyhamowanie obrotu)
//   cruiseBonus  — dodatek do maxSpeed, gdy w pobliżu nie ma wroga — odpowiednik
//                  „zero-flux boost": płaski, więc ciężkim daje procentowo więcej
//   travelSpeed  — limit dojazdu do formacji za szybkim liderem (bez wroga w pobliżu)
//   boostSpeed   — limit dopalacza gracza (Shift) (driveBoostSpeed w driveTransmission.js; bez wpisu —
//                  BOOST_DRIVE.boostMul × maxSpeed z driveModes.js)
//   reverseSpeedFrac — ułamek maxSpeed przy cofaniu (ruch rufą naprzód). Okręt
//                  cofający się przed wrogiem jest wolniejszy od goniącego go
//                  dziobem — bez tego snajper uciekał przed brawlerem bez końca.
//                  Hulle dziedziczą go z klasy.
//
// Czasy orientacyjne (0→maxSpeed / zawrócenie o 180°):
//   fregata ~0,8 s / ~2,3 s · niszczyciel ~1,2 s / ~3,7 s · pancernik ~2 s / ~7 s
//   lotniskowiec ~2,7 s / ~10 s · superkapitał ~3,2 s / ~13,5 s

import { CRUISE_BY_CLASS, PLAYER_HULL_DRIVE } from './driveModes.js';

// Przelot NPC (cruiseBonus, travelSpeed) i dopalacz gracza idą z JEDNEJ tabeli napędów
// (src/data/driveModes.js, E5) — tu tylko walka: limit, ciąg, hamowanie, obrót. Limity bojowe są celowo
// NIEOKRĄGŁE wokół klasy (decyzja użytkownika 2026-10-22: Atlas ~500, ale nie równo — 507 j/s).
const C = CRUISE_BY_CLASS;

export const SHIP_FLIGHT_CLASS_DEFAULTS = Object.freeze({
  frigate: Object.freeze({
    maxSpeed: 1412, accel: 1750, decel: 2000, strafeAccel: 900, reverseAccel: 800,
    turnRate: 100, turnAccel: 200, ...C.frigate, reverseSpeedFrac: 0.6
  }),
  destroyer: Object.freeze({
    maxSpeed: 994, accel: 830, decel: 1000, strafeAccel: 380, reverseAccel: 360,
    turnRate: 60, turnAccel: 90, ...C.destroyer, reverseSpeedFrac: 0.5
  }),
  battleship: Object.freeze({
    maxSpeed: 643, accel: 325, decel: 400, strafeAccel: 95, reverseAccel: 120,
    turnRate: 30, turnAccel: 34, ...C.battleship, reverseSpeedFrac: 0.4
  }),
  carrier: Object.freeze({
    maxSpeed: 487, accel: 180, decel: 220, strafeAccel: 65, reverseAccel: 65,
    turnRate: 20, turnAccel: 17, ...C.carrier, reverseSpeedFrac: 0.4
  }),
  supercapital: Object.freeze({
    maxSpeed: 374, accel: 120, decel: 150, strafeAccel: 50, reverseAccel: 45,
    turnRate: 15, turnAccel: 10, ...C.supercapital, reverseSpeedFrac: 0.35
  })
});

// Klucz = id kadłuba (shipFrame / profil renderu z ships.js).
export const SHIP_FLIGHT_SPECS = Object.freeze({
  // Custos — dwie dysze boczne, zwrotna i szybka.
  terran_frigate: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1412, accel: 1750, decel: 2000, strafeAccel: 900, reverseAccel: 800,
    turnRate: 100, turnAccel: 200, ...C.frigate
  }),
  // Marauder — szybszy na prostej, gorzej hamuje i skręca.
  pirate_frigate: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1478, accel: 1800, decel: 1800, strafeAccel: 800, reverseAccel: 700,
    turnRate: 92, turnAccel: 180, ...C.frigate
  }),
  // Hasta.
  terran_destroyer: Object.freeze({
    flightClass: 'destroyer',
    maxSpeed: 994, accel: 830, decel: 1000, strafeAccel: 380, reverseAccel: 360,
    turnRate: 60, turnAccel: 90, ...C.destroyer
  }),
  // Reaver — bez dysz manewrowych w edytorze: słaby strafe.
  pirate_destroyer: Object.freeze({
    flightClass: 'destroyer',
    maxSpeed: 1067, accel: 860, decel: 900, strafeAccel: 300, reverseAccel: 320,
    turnRate: 55, turnAccel: 80, ...C.destroyer
  }),
  // Brak dysz bocznych — przestawia się dziobem, zamiast ślizgać bokiem.
  terran_battleship: Object.freeze({
    flightClass: 'battleship',
    maxSpeed: 643, accel: 325, decel: 400, strafeAccel: 80, reverseAccel: 120,
    turnRate: 30, turnAccel: 34, ...C.battleship
  }),
  // Iron Skull — ciężki taran: szybszy, ale ociężale hamuje i skręca.
  pirate_battleship: Object.freeze({
    flightClass: 'battleship',
    maxSpeed: 692, accel: 300, decel: 340, strafeAccel: 70, reverseAccel: 100,
    turnRate: 27, turnAccel: 30, ...C.battleship
  }),
  // Citadella.
  terran_carrier: Object.freeze({
    flightClass: 'carrier',
    maxSpeed: 487, accel: 180, decel: 220, strafeAccel: 70, reverseAccel: 65,
    turnRate: 20, turnAccel: 17, ...C.carrier
  }),
  capital_carrier: Object.freeze({
    flightClass: 'carrier',
    maxSpeed: 496, accel: 190, decel: 220, strafeAccel: 70, reverseAccel: 65,
    turnRate: 21, turnAccel: 18, ...C.carrier
  }),
  // Colossus — 13 dysz manewrowych: jak na swój tonaż przyzwoity strafe.
  terran_supercapital: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 374, accel: 120, decel: 150, strafeAccel: 55, reverseAccel: 45,
    turnRate: 15, turnAccel: 10, ...C.supercapital
  }),
  // Piracki supercapital — manewrowość ciężkiej jednostki tej samej klasy.
  pirate_supercapital: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 383, accel: 120, decel: 150, strafeAccel: 55, reverseAccel: 45,
    turnRate: 15, turnAccel: 10, ...C.supercapital
  }),
  // Atlas — te same liczby dla gracza i dla Atlasa-NPC (decyzja użytkownika 2026-10-01: jedna tabela;
  // limit bojowy ~500 j/s — od 2026-10-22 nieokrągłe 507; napęd gracza kalibruje się do tej tabeli — driveTransmission.js).
  atlas: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 507, accel: 160, decel: 200, strafeAccel: 70, reverseAccel: 60,
    turnRate: 18, turnAccel: 12, ...C.supercapital,
    // Dopalacz gracza (Shift): z tabeli napędów (driveModes.js — 1137 j/s od 2026-10-22; PRZELOTU nie ma).
    boostSpeed: PLAYER_HULL_DRIVE.atlas.boostSpeed
  }),
  // Okręty ruchu v2 po awansie do pełnego NPC (E13, src/game/trafficPromotion.js): klasa fregaty, liczby z fregat
  // floty — rajder jak Marauder, tylko cięższy (288 j.); przemytnik najszybszy na prostej, łowca zwrotny, kuter
  // policji krótki i hamujący najmocniej. Cywile ruchu zostają przy dawnym napędzie (ucieczka rozkazem `move`).
  pirate_raider: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1306, accel: 1500, decel: 1600, strafeAccel: 650, reverseAccel: 600,
    turnRate: 80, turnAccel: 150, ...C.frigate
  }),
  smuggler: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1531, accel: 1850, decel: 1700, strafeAccel: 700, reverseAccel: 650,
    turnRate: 90, turnAccel: 170, ...C.frigate
  }),
  bounty_hunter: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1447, accel: 1780, decel: 1900, strafeAccel: 850, reverseAccel: 750,
    turnRate: 96, turnAccel: 190, ...C.frigate
  }),
  police_cutter: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1389, accel: 1720, decel: 2150, strafeAccel: 950, reverseAccel: 850,
    turnRate: 104, turnAccel: 210, ...C.frigate
  }),
  // Holownik serwisowy (src/game/serviceTug.js) — 5 km, ale z mocnymi dyszami manewrowymi: trzyma pozycję przy
  // statku i wsuwa się pod niego bokiem (strafe), szybciej zawraca niż superkapitał tego tonażu.
  service_tug: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 514, accel: 170, decel: 230, strafeAccel: 110, reverseAccel: 90,
    turnRate: 16, turnAccel: 12, cruiseBonus: 450, travelSpeed: 2400
  })
});

// Kadłub gracza (PLAYER.activeHullId / rama) → wpis tabeli lotu. Kadłub bez wpisu (megafrachtowiec,
// nieznany) lata dawnym napędem trybów z driveTransmission.js.
const PLAYER_HULL_FLIGHT_SPEC = Object.freeze({
  atlas: 'atlas',
  frigate: 'terran_frigate',
  corvus: 'terran_frigate',
  destroyer: 'terran_destroyer',
  battleship: 'terran_battleship',
  carrier: 'terran_carrier',
  supercapital: 'terran_supercapital'
});

/** Id wpisu SHIP_FLIGHT_SPECS dla kadłuba gracza albo null. */
export function playerFlightSpecId(hullId) {
  const key = String(hullId || '').trim().toLowerCase();
  if (!key) return null;
  if (PLAYER_HULL_FLIGHT_SPEC[key]) return PLAYER_HULL_FLIGHT_SPEC[key];
  return SHIP_FLIGHT_SPECS[key] ? key : null;
}

/** Wpis tabeli lotu z uzupełnieniem domyślnych wartości klasy (stopnie jak w tabeli) albo null. */
export function playerFlightSpec(hullId) {
  const id = playerFlightSpecId(hullId);
  if (!id) return null;
  const hull = SHIP_FLIGHT_SPECS[id];
  const base = SHIP_FLIGHT_CLASS_DEFAULTS[hull.flightClass] || SHIP_FLIGHT_CLASS_DEFAULTS.battleship;
  return { id, ...base, ...hull };
}

// Wartości do szablonów w ships.js — żeby `accel/maxSpeed/turn` szablonu nie
// były drugą, rozjeżdżającą się kopią. `turn` w rad/s (tak czyta go stary kod).
export function flightTemplateStats(hullId) {
  const spec = SHIP_FLIGHT_SPECS[hullId];
  if (!spec) return null;
  return {
    accel: spec.accel,
    maxSpeed: spec.maxSpeed,
    turn: spec.turnRate * Math.PI / 180,
    turnAccel: spec.turnAccel * Math.PI / 180
  };
}
