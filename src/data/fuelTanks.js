// src/data/fuelTanks.js
//
// ZBIORNIKI PALIWA kadłubów w grze (decyzja użytkownika 2026-10-08, F14 audytu wybuchów: „każdy statek będzie miał
// zbiornik na paliwo — więc z pewnego miejsca”). Śmierć okrętu bez detonacji rdzenia reaktora to wybuch z gazu
// (`window.makeReactorBlow`, src/3d/explosions/) z MIEJSCA ZBIORNIKA, nie ze środka kadłuba — rozerwany zbiornik
// wyrzuca gaz strumieniami wzdłuż osi kadłuba (jak z rury). Zbiornik to samo MIEJSCE wybuchu i skala z pojemności —
// bez stanów i bez obrażeń (logika: src/game/fuelTank.js).
//
// Markery w przestrzeni PNG sprite'a jak rdzenie (src/data/reactorCores.js): (0,0) = środek, +X = dziób, y w dół;
// r — promień zbiornika [px PNG], capacity — pojemność [t paliwa]. Kadłub bez wpisu dostaje zbiornik z automatu
// (`autoFuelTankMarker` — głęboko w kadłubie, w części rufowej, z dala od komory reaktora), pojemność z powierzchni
// kadłuba. Edytor gniazd (`hpEditor.v1` → `ships[id].fuelTanks`, markery w px PNG z `r`) bierze górę.
//
// Klucz = id profilu renderu kadłuba (HULL_RENDER_PROFILES, getNpcHullRenderProfileId).

const tank = (m) => Object.freeze([Object.freeze(m)]);

export const FUEL_TANK_MARKERS = Object.freeze({
  // Atlas: rufowa sekcja napędu, burta przeciwna do komory reaktora (rdzeń: x −275, y 94).
  atlas: Object.freeze([Object.freeze({ id: 'atlas_fuel', x: -980, y: -20, r: 64, capacity: 820 })]),
  // Bellator i Iron Skull: za komorą reaktora (rdzeń przy środku), w trzonie rufy.
  terran_battleship: Object.freeze([Object.freeze({ id: 'bellator_fuel', x: -300, y: 0, r: 42, capacity: 540 })]),
  pirate_battleship: Object.freeze([Object.freeze({ id: 'skull_fuel', x: -330, y: 0, r: 48, capacity: 600 })]),
  // Kadłuby ruchu v2 (E13, 2026-10-22): zbiornik w części rufowej z dala od komory reaktora (tankowiec, rafineria,
  // statek z boją, ratownik — na namalowanym zbiorniku), r = 0,75–1,2 komórki (frachtowiec ciężki 2,5), pojemność
  // z automatu (pole kadłuba). Komórki w kadłubie, poza komorą — tests/trafficHullData.test.mjs.
  inter_station_shuttle: tank({ id: 'inter_station_shuttle_fuel', x: -20, y: -10, r: 160.9 }),
  container_ship: tank({ id: 'container_ship_fuel', x: -455, y: -10, r: 76.8 }),
  long_haul_freighter: tank({ id: 'long_haul_freighter_fuel', x: -420, y: 15, r: 59.1 }),
  heavy_freighter: tank({ id: 'heavy_freighter_fuel', x: -540, y: -20, r: 37 }),
  heavy_harvester: tank({ id: 'heavy_harvester_fuel', x: -420, y: -150, r: 73.9 }),
  belter: tank({ id: 'belter_fuel', x: -120, y: -20, r: 133.1 }),
  surveyor: tank({ id: 'surveyor_fuel', x: -180, y: -20, r: 124.7 }),
  refinery_tender: tank({ id: 'refinery_tender_fuel', x: -300, y: -20, r: 55.4 }),
  tanker: tank({ id: 'tanker_fuel', x: -250, y: -60, r: 49.5 }),
  salvage_hauler: tank({ id: 'salvage_hauler_fuel', x: 60, y: -20, r: 63.4 }),
  construction_tug: tank({ id: 'construction_tug_fuel', x: -110, y: -20, r: 110.9 }),
  smuggler: tank({ id: 'smuggler_fuel', x: -100, y: -20, r: 110.9 }),
  pirate_raider: tank({ id: 'pirate_raider_fuel', x: -400, y: -20, r: 92.4 }),
  distress_beacon_ship: tank({ id: 'distress_beacon_ship_fuel', x: 0, y: 115, r: 99.8 }),
  repair_drone: tank({ id: 'repair_drone_fuel', x: -30, y: 150, r: 180 }),
  bounty_hunter: tank({ id: 'bounty_hunter_fuel', x: -165, y: -5, r: 90.7 }),
  police_cutter: tank({ id: 'police_cutter_fuel', x: -440, y: -150, r: 133.1 }),
  rescue_ship: tank({ id: 'rescue_ship_fuel', x: -320, y: -180, r: 83.2 })
});

/**
 * Wybuch zbiornika: rozmiar `size` (jednostka makeReactorBlow — Atlas ≈ 280) ∝ √pojemności, profil wg klasy kadłuba
 * (FUEL_TANK_CLASS_BY_LENGTH — escort / cruiser / capital). Pojemność z automatu z powierzchni
 * kadłuba (FUEL_TANK_TUNE.capacityK / capacityExp).
 */
export const FUEL_TANK_TUNE = Object.freeze({
  sizePerSqrtCap: 9.8,       // size = 9,8 · √t (Atlas 820 t → ~280, Bellator 540 t → ~230)
  minSize: 70,
  maxSize: 460,
  // Automat: pojemność = capacityK · powierzchnia^capacityExp [j.²] — rośnie wolniej niż powierzchnia (zbiornik to nie
  // cały kadłub), więc wybuch rośnie mniej więcej z długością kadłuba: fregata ~100, niszczyciel ~130–145,
  // pancernik ~225, lotniskowiec ~270, supercapital ~330.
  capacityK: 0.75,
  capacityExp: 0.54,
  minCapacity: 40,
  maxCapacity: 2200,
  // Strumienie gazu z rozerwanego zbiornika (wzdłuż osi kadłuba; kierunki i czas bicia — explosionFx.js
  // JET_AXIS_*): zanik narzucenia prędkości per strumień [s] (velTau reżysera gazu ma 0,15 s dla kłębów — strumień
  // zbiornika bije dłużej, zanim zacznie się rwać).
  jetVelTau: 0.6,
  // PĘKNIĘCIE za życia okrętu (src/game/fuelTank.js — stepFuelTankRupture; prośba użytkownika 2026-10-15: „wybuchy dymu
  // przy taranowaniu, jeśli rozwalę fuel tank”): zbiornik wybucha, gdy martwy jest co najmniej taki ułamek jego komórek
  // (taran, zgniot, krater, rozpad; komórki odcięte z odłamem są całe). Pomiar `scripts/zbiornik-taran-sym.mjs`
  // (Atlas, 126 taranów): przy 0,5 zbiornik pęka w ~40% taranów, w ponad połowie z nich okręt przeżywa.
  ruptureDeadFrac: 0.5,
  // Śmierć po pęknięciu: do ruptureQuiet s po nim — bez drugiego wybuchu (wybuch zbiornika jest wybuchem śmierci),
  // później — wybuch resztek ze środka okrętu × afterRuptureSize.
  ruptureQuiet: 1.5,
  afterRuptureSize: 0.6
});

/**
 * Klasa kadłuba z jego długości w świecie gry [j.] (fregata ~190, niszczyciel ~290–360, pancernik ~620–720,
 * lotniskowiec, supercapital i Atlas > 1000) — pole `radius` encji bywa różnie liczone w ścieżkach spawnu.
 */
export const FUEL_TANK_CLASS_BY_LENGTH = Object.freeze([
  Object.freeze({ minLength: 520, id: 'capital' }),
  Object.freeze({ minLength: 230, id: 'cruiser' }),
  Object.freeze({ minLength: 0, id: 'escort' })
]);

export function fuelTankClassForLength(length) {
  const L = Number(length) || 0;
  for (const t of FUEL_TANK_CLASS_BY_LENGTH) if (L >= t.minLength) return t.id;
  return 'escort';
}

/** Profil wybuchu (EXPLOSION_PROFILES) dla klasy kadłuba. */
export const FUEL_TANK_PROFILE_BY_CLASS = Object.freeze({ escort: 'escort', cruiser: 'cruiser', capital: 'capital' });

/** Rozmiar wybuchu z pojemności zbiornika [t]. */
export function fuelTankBlastSize(capacity) {
  const T = FUEL_TANK_TUNE;
  const s = T.sizePerSqrtCap * Math.sqrt(Math.max(0, Number(capacity) || 0));
  return s < T.minSize ? T.minSize : (s > T.maxSize ? T.maxSize : s);
}

/** Pojemność automatu z powierzchni kadłuba [j.²]. */
export function fuelTankCapacityForArea(area) {
  const T = FUEL_TANK_TUNE;
  const c = T.capacityK * Math.pow(Math.max(0, Number(area) || 0), T.capacityExp);
  return c < T.minCapacity ? T.minCapacity : (c > T.maxCapacity ? T.maxCapacity : c);
}
