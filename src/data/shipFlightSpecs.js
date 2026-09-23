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
//   reverseSpeedFrac — ułamek maxSpeed przy cofaniu (ruch rufą naprzód). Okręt
//                  cofający się przed wrogiem jest wolniejszy od goniącego go
//                  dziobem — bez tego snajper uciekał przed brawlerem bez końca.
//                  Hulle dziedziczą go z klasy.
//
// Czasy orientacyjne (0→maxSpeed / zawrócenie o 180°):
//   fregata ~0,8 s / ~2,3 s · niszczyciel ~1,2 s / ~3,7 s · pancernik ~2 s / ~7 s
//   lotniskowiec ~2,7 s / ~10 s · superkapitał ~3,2 s / ~13,5 s

export const SHIP_FLIGHT_CLASS_DEFAULTS = Object.freeze({
  frigate: Object.freeze({
    maxSpeed: 1400, accel: 1750, decel: 2000, strafeAccel: 900, reverseAccel: 800,
    turnRate: 100, turnAccel: 200, cruiseBonus: 450, travelSpeed: 3200, reverseSpeedFrac: 0.6
  }),
  destroyer: Object.freeze({
    maxSpeed: 1000, accel: 830, decel: 1000, strafeAccel: 380, reverseAccel: 360,
    turnRate: 60, turnAccel: 90, cruiseBonus: 450, travelSpeed: 3000, reverseSpeedFrac: 0.5
  }),
  battleship: Object.freeze({
    maxSpeed: 650, accel: 325, decel: 400, strafeAccel: 95, reverseAccel: 120,
    turnRate: 30, turnAccel: 34, cruiseBonus: 450, travelSpeed: 2600, reverseSpeedFrac: 0.4
  }),
  carrier: Object.freeze({
    maxSpeed: 480, accel: 180, decel: 220, strafeAccel: 65, reverseAccel: 65,
    turnRate: 20, turnAccel: 17, cruiseBonus: 450, travelSpeed: 2400, reverseSpeedFrac: 0.4
  }),
  supercapital: Object.freeze({
    maxSpeed: 380, accel: 120, decel: 150, strafeAccel: 50, reverseAccel: 45,
    turnRate: 15, turnAccel: 10, cruiseBonus: 450, travelSpeed: 2200, reverseSpeedFrac: 0.35
  })
});

// Klucz = id kadłuba (shipFrame / profil renderu z ships.js).
export const SHIP_FLIGHT_SPECS = Object.freeze({
  // Custos — dwie dysze boczne, zwrotna i szybka.
  terran_frigate: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1400, accel: 1750, decel: 2000, strafeAccel: 900, reverseAccel: 800,
    turnRate: 100, turnAccel: 200, cruiseBonus: 450, travelSpeed: 3200
  }),
  // Marauder — szybszy na prostej, gorzej hamuje i skręca.
  pirate_frigate: Object.freeze({
    flightClass: 'frigate',
    maxSpeed: 1500, accel: 1800, decel: 1800, strafeAccel: 800, reverseAccel: 700,
    turnRate: 92, turnAccel: 180, cruiseBonus: 450, travelSpeed: 3200
  }),
  // Hasta.
  terran_destroyer: Object.freeze({
    flightClass: 'destroyer',
    maxSpeed: 1000, accel: 830, decel: 1000, strafeAccel: 380, reverseAccel: 360,
    turnRate: 60, turnAccel: 90, cruiseBonus: 450, travelSpeed: 3000
  }),
  // Reaver — bez dysz manewrowych w edytorze: słaby strafe.
  pirate_destroyer: Object.freeze({
    flightClass: 'destroyer',
    maxSpeed: 1080, accel: 860, decel: 900, strafeAccel: 300, reverseAccel: 320,
    turnRate: 55, turnAccel: 80, cruiseBonus: 450, travelSpeed: 3000
  }),
  // Brak dysz bocznych — przestawia się dziobem, zamiast ślizgać bokiem.
  terran_battleship: Object.freeze({
    flightClass: 'battleship',
    maxSpeed: 650, accel: 325, decel: 400, strafeAccel: 80, reverseAccel: 120,
    turnRate: 30, turnAccel: 34, cruiseBonus: 450, travelSpeed: 2600
  }),
  // Iron Skull — ciężki taran: szybszy, ale ociężale hamuje i skręca.
  pirate_battleship: Object.freeze({
    flightClass: 'battleship',
    maxSpeed: 700, accel: 300, decel: 340, strafeAccel: 70, reverseAccel: 100,
    turnRate: 27, turnAccel: 30, cruiseBonus: 450, travelSpeed: 2600
  }),
  // Citadella.
  terran_carrier: Object.freeze({
    flightClass: 'carrier',
    maxSpeed: 480, accel: 180, decel: 220, strafeAccel: 70, reverseAccel: 65,
    turnRate: 20, turnAccel: 17, cruiseBonus: 450, travelSpeed: 2400
  }),
  capital_carrier: Object.freeze({
    flightClass: 'carrier',
    maxSpeed: 500, accel: 190, decel: 220, strafeAccel: 70, reverseAccel: 65,
    turnRate: 21, turnAccel: 18, cruiseBonus: 450, travelSpeed: 2400
  }),
  // Colossus — 13 dysz manewrowych: jak na swój tonaż przyzwoity strafe.
  terran_supercapital: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 380, accel: 120, decel: 150, strafeAccel: 55, reverseAccel: 45,
    turnRate: 15, turnAccel: 10, cruiseBonus: 450, travelSpeed: 2200
  }),
  // Atlas jako NPC (gracz lata własnym napędem z driveTransmission.js).
  atlas: Object.freeze({
    flightClass: 'supercapital',
    maxSpeed: 400, accel: 130, decel: 160, strafeAccel: 60, reverseAccel: 50,
    turnRate: 16, turnAccel: 11, cruiseBonus: 450, travelSpeed: 2200
  })
});

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
