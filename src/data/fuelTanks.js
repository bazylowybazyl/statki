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

export const FUEL_TANK_MARKERS = Object.freeze({
  // Atlas: rufowa sekcja napędu, burta przeciwna do komory reaktora (rdzeń: x −275, y 94).
  atlas: Object.freeze([Object.freeze({ id: 'atlas_fuel', x: -980, y: -20, r: 64, capacity: 820 })]),
  // Bellator i Iron Skull: za komorą reaktora (rdzeń przy środku), w trzonie rufy.
  terran_battleship: Object.freeze([Object.freeze({ id: 'bellator_fuel', x: -300, y: 0, r: 42, capacity: 540 })]),
  pirate_battleship: Object.freeze([Object.freeze({ id: 'skull_fuel', x: -330, y: 0, r: 48, capacity: 600 })])
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
  jetVelTau: 0.6
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
