// src/data/driveModes.js
//
// JEDNA TABELA NAPĘDÓW (E5, docs/PLAN-ekonomia-rynki.md § 3.4) — gracz, NPC gry i ruch v2 liczą
// prędkości przelotu, hipercruise'u i warpa stąd. Moduł czysty (bez DOM, three i gry).
//
// Tryby (od najwolniejszego; decyzje użytkownika 2026-10-22 — PRZELOT gracza zniknął, zastąpił go hipercruise):
//   • BOJOWY    — limit bojowy kadłuba: SHIP_FLIGHT_SPECS (src/data/shipFlightSpecs.js — nieokrągłe liczby wokół
//                 klasy, Atlas 507 j/s) + dopalacz (Shift, PLAYER_HULL_DRIVE — Atlas 1137 j/s);
//                 NPC: cruiseBonus / travelSpeed klasy (CRUISE_BY_CLASS) — dojazd i szyk bez wroga;
//   • HIPERCRUISE — przelot na silniku hipercruise (HYPERCRUISE_ENGINES, 20–40 tys. j/s): rozruch, rozpęd
//                 z klasy kadłuba (HYPERCRUISE_BY_CLASS), DA SIĘ PRZERWAĆ (przechwyt, blokada masy) —
//                 jedyny napęd odcinków 'drive' rozkazu TRAVEL TO (krótkie: skrócony rozruch — HYPERCRUISE_TUNE);
//   • WARP      — napęd warp Mk I / II / III (WARP_DRIVES: 100 / 175 / 250 tys. j/s), paliwo fuzyjne, nietykalny.
//
// Kontrakt E5 ↔ E8 (receptury): id silników `hypercruise_mk1..3` i napędów `warp_mk1..3` zostają; E5 stroi
// prędkości i przyspieszenia per klasa kadłuba, E8 robi z nich towary.

/**
 * NAPĘDY WARP (towary E8 — id stałe; decyzja użytkownika 2026-10-22: 100–250 tys. j/s zależnie od napędu).
 * speed — prędkość w przestrzeni międzyplanetarnej (strefy mnożą: WARP_ZONES); gracz: skok z celem trwa
 * jak w demie „Nurt” przeskalowany do prędkości napędu (warpDrive.js: warpTripTuneFor).
 */
export const WARP_DRIVES = Object.freeze({
  warp_mk1: Object.freeze({ id: 'warp_mk1', label: 'Napęd warp Mk I', short: 'MK I', speed: 100000 }),
  warp_mk2: Object.freeze({ id: 'warp_mk2', label: 'Napęd warp Mk II', short: 'MK II', speed: 175000 }),
  warp_mk3: Object.freeze({ id: 'warp_mk3', label: 'Napęd warp Mk III', short: 'MK III', speed: 250000 })
});
export const WARP_DRIVE_IDS = Object.freeze(Object.keys(WARP_DRIVES));

/** Napęd warp po id albo null. */
export function warpDriveDef(driveId) {
  return WARP_DRIVES[String(driveId || '')] || null;
}

/** Prędkość warpa napędu [j/s]; nieznany id — Mk II. */
export function warpDriveSpeed(driveId) {
  return (warpDriveDef(driveId) || WARP_DRIVES.warp_mk2).speed;
}

/** Prędkość odniesienia skoku (demo „Nurt”: 260 tys. j/s) — skala czasu podróży warpem. */
export const WARP_REF_SPEED = 260000;

/** Wspólne liczby warpa (wszystkie napędy). */
export const WARP_DRIVE = Object.freeze({
  id: 'warp',
  label: 'WARP',
  // Ładowanie (gra: warp.chargeTime) i narzut wejścia / wyjścia (rampa przylotu) w rachunku ruchu v2.
  chargeTime: 0.8,
  overheadSeconds: 4,
  zones: Object.freeze({ belt: 0.8, planet: 0.3 }),
  interruptible: false,
  fuelId: 'fusion_fuel',
  // Skalibrowane wobec ŁADOWNI: typowy kurs w rdzeniu (~1 mln j.) to ~17 t paliwa fuzyjnego przy
  // ładowni haulera 160 t (src/game/traffic/travelNetwork.js — dawna wersja 1/4000 zabijała warp).
  fuelPerUnit: 1 / 60_000,
  risk: 0
});

/**
 * Dopalacz gracza (Shift) bez wpisu kadłuba: × limit bojowy. PRZELOTU gracza nie ma (2026-10-22), więc
 * jest jeden limit dopalacza.
 */
export const BOOST_DRIVE = Object.freeze({ boostMul: 2.24 });

/**
 * Przelot NPC wg klasy lotu (src/data/shipFlightSpecs.js czyta stąd):
 *   cruiseBonus — dodatek do limitu bojowego bez wroga w pobliżu („zero-flux boost” Starsectora);
 *   travelSpeed — limit dojazdu do formacji za szybkim liderem (bez wroga w pobliżu).
 */
export const CRUISE_BY_CLASS = Object.freeze({
  frigate: Object.freeze({ cruiseBonus: 450, travelSpeed: 3200 }),
  destroyer: Object.freeze({ cruiseBonus: 450, travelSpeed: 3000 }),
  battleship: Object.freeze({ cruiseBonus: 450, travelSpeed: 2600 }),
  carrier: Object.freeze({ cruiseBonus: 450, travelSpeed: 2400 }),
  supercapital: Object.freeze({ cruiseBonus: 450, travelSpeed: 2200 })
});

/**
 * Napędy gracza per kadłub tabeli lotu: dopalacz [j/s] (Atlas 1137 — decyzja 2026-10-22: 1000–1200,
 * nieokrągło), silnik hipercruise, napęd warp. Kadłub bez wpisu — NPC_CLASS_DRIVE swojej klasy.
 */
export const PLAYER_HULL_DRIVE = Object.freeze({
  atlas: Object.freeze({ boostSpeed: 1137, hypercruise: 'hypercruise_mk1', warp: 'warp_mk2' })
});

/**
 * Domyślne napędy NPC i kadłubów gracza wg klasy lotu (propozycja E5; jak w składzie okrętów E8 —
 * WARSHIP_CLASSES: Mk I fregata i niszczyciel, Mk II krążownik, Mk III nosiciel).
 */
export const NPC_CLASS_DRIVE = Object.freeze({
  frigate: Object.freeze({ hypercruise: 'hypercruise_mk1', warp: 'warp_mk1' }),
  destroyer: Object.freeze({ hypercruise: 'hypercruise_mk1', warp: 'warp_mk1' }),
  battleship: Object.freeze({ hypercruise: 'hypercruise_mk2', warp: 'warp_mk2' }),
  carrier: Object.freeze({ hypercruise: 'hypercruise_mk3', warp: 'warp_mk3' }),
  supercapital: Object.freeze({ hypercruise: 'hypercruise_mk3', warp: 'warp_mk3' })
});

/** Napędy kadłuba gracza: { hypercruise, warp } (wpis kadłuba, potem klasa lotu, potem Mk I / Mk II). */
export function playerHullDrives(specId, flightClass) {
  const hull = PLAYER_HULL_DRIVE[specId] || null;
  const cls = NPC_CLASS_DRIVE[flightClass] || null;
  return {
    hypercruise: hull?.hypercruise || cls?.hypercruise || 'hypercruise_mk1',
    warp: hull?.warp || cls?.warp || 'warp_mk2'
  };
}

/**
 * SILNIKI HIPERCRUISE (towary E8 — id stałe). vmax [j/s] w przestrzeni międzyplanetarnej (strefy mnożą
 * jak warp: pas × 0,8, okolice planet × 0,3); accelMul — mnożnik rozpędu klasy kadłuba (mocniejszy
 * silnik rozpędza się do wyższej prędkości w podobnym czasie); fuelPerUnit — wodór na jednostkę drogi
 * (ruch v2; gracz bez osobnego zbiornika).
 */
export const HYPERCRUISE_ENGINES = Object.freeze({
  hypercruise_mk1: Object.freeze({ id: 'hypercruise_mk1', label: 'Hipernapęd Mk I', short: 'MK I', vmax: 20000, accelMul: 1, fuelPerUnit: 1 / 30_000 }),
  hypercruise_mk2: Object.freeze({ id: 'hypercruise_mk2', label: 'Hipernapęd Mk II', short: 'MK II', vmax: 30000, accelMul: 1.3, fuelPerUnit: 1 / 26_000 }),
  hypercruise_mk3: Object.freeze({ id: 'hypercruise_mk3', label: 'Hipernapęd Mk III', short: 'MK III', vmax: 40000, accelMul: 1.6, fuelPerUnit: 1 / 22_000 })
});
export const HYPERCRUISE_ENGINE_IDS = Object.freeze(Object.keys(HYPERCRUISE_ENGINES));

/**
 * Hipercruise wg klasy lotu kadłuba:
 *   accelTime — s rozpędu silnikiem Mk I od 0 do 20 tys. j/s (przyspieszenie = 20 000 / accelTime × accelMul);
 *   decelMul  — hamowanie / wyjście względem rozpędu (wyjście z 20 tys. j/s Atlasa: ~6 s, ~60 tys. j.);
 *   spool     — s rozruchu (ładowanie przed rozpędem; warp ładuje się 0,8 s, ale kosztuje paliwo fuzyjne);
 *   turnMul   — prędkość obrotu w hipercruisie × limit obrotu tabeli lotu.
 */
export const HYPERCRUISE_BY_CLASS = Object.freeze({
  frigate: Object.freeze({ accelTime: 5, decelMul: 2, spool: 2.0, turnMul: 0.5 }),
  destroyer: Object.freeze({ accelTime: 7, decelMul: 2, spool: 2.5, turnMul: 0.5 }),
  battleship: Object.freeze({ accelTime: 9, decelMul: 2, spool: 3.0, turnMul: 0.5 }),
  carrier: Object.freeze({ accelTime: 11, decelMul: 2, spool: 3.5, turnMul: 0.5 }),
  supercapital: Object.freeze({ accelTime: 12, decelMul: 2, spool: 4.0, turnMul: 0.5 })
});

/** Wspólne strojenie hipercruise'u (gracz). */
export const HYPERCRUISE_TUNE = Object.freeze({
  refVmax: 20000,        // [j/s] prędkość, do której liczy się accelTime klasy
  // Strefa przy planetach (decyzja użytkownika 2026-10-22: × 0,6 zamiast warpowego × 0,3 — Luna ~60 s); automat
  // przycina mnożnik strefy do tego minimum (pas × 0,8 zostaje). Warp ma własne strefy (WARP_DRIVE.zones).
  minZone: 0.6,
  exitSpeed: 1000,       // [j/s] wyjście kończy się przy tej prędkości (dalej regulator do limitu bojowego)
  massLockRange: 12000,  // [j.] wróg bliżej (bez mgły wojny — to zjawisko fizyczne; maskowanie chroni) — nie wejdzie / wypada
  interruptDecelMul: 4,  // wyjście wymuszone (przechwyt) hamuje × tyle — statek staje przy przechwytującym
  // Odcinki 'drive' TRAVEL TO (propozycja E5 2026-10-22, PRZELOTU nie ma): krótsze niż minLeg — autopilot bojowy
  // (hipercruise skończyłby się, zanim ruszy: wychodzi `stopMargin` ~4 km przed punktem); od minLeg do shortLeg —
  // hipercruise ze SKRÓCONYM rozruchem (spool × odcinek / shortLeg, nie mniej niż minSpool s); dłuższe — pełny.
  minLeg: 6000,          // [j.]
  shortLeg: 30000,       // [j.]
  minSpool: 1.0,         // [s]
  interruptible: true,   // przechwyt: trafienie albo blokada masy przerywa hipercruise
  // WYGLĄD: wychylenie dysz MAIN przy A/D w locie (gimbal −26° × moment — thrusterModel.js) × tyle W OBRAZIE dysz
  // (engineVfxSystem.js — fizyka bierze prawdziwy kąt); zgłoszenie użytkownika 2026-10-23: plazma „wyginała się” na boki
  nozzleGimbal: 0.2
});

/** Klasa lotu → wpis HYPERCRUISE_BY_CLASS (nieznana — superkapitał). */
export function hypercruiseClass(flightClass) {
  return HYPERCRUISE_BY_CLASS[flightClass] || HYPERCRUISE_BY_CLASS.supercapital;
}

/** Silnik hipercruise po id albo null (statek bez silnika nie ma trybu). */
export function hypercruiseEngine(engineId) {
  return HYPERCRUISE_ENGINES[String(engineId || '')] || null;
}

/**
 * Parametry hipercruise'u silnika na kadłubie klasy `flightClass`: { engineId, vmax, accel, decel, spool,
 * turnMul } albo null (bez silnika).
 */
export function hypercruiseSpec(engineId, flightClass) {
  const engine = hypercruiseEngine(engineId);
  if (!engine) return null;
  const cls = hypercruiseClass(flightClass);
  const accel = (HYPERCRUISE_TUNE.refVmax / Math.max(0.5, cls.accelTime)) * engine.accelMul;
  return {
    engineId: engine.id,
    vmax: engine.vmax,
    accel,
    decel: accel * cls.decelMul,
    spool: cls.spool,
    turnMul: cls.turnMul,
    fuelPerUnit: engine.fuelPerUnit
  };
}

/**
 * Czas przelotu odcinka `distance` profilem trapezowym: rozpęd `accel` do `vmax`, hamowanie `decel`
 * do zera, plus stały narzut (rozruch). Krótki odcinek — trójkąt (bez osiągnięcia vmax).
 */
export function trapezoidSeconds(distance, vmax, accel, decel, overhead = 0) {
  const d = Math.max(0, Number(distance) || 0);
  const v = Math.max(1, Number(vmax) || 1);
  const a = Math.max(1e-6, Number(accel) || 1e-6);
  const b = Math.max(1e-6, Number(decel) || a);
  const ramp = v * v / (2 * a) + v * v / (2 * b);
  if (d >= ramp) return overhead + v / a + v / b + (d - ramp) / v;
  // trójkąt: szczyt v' z d = v'²/2a + v'²/2b
  const vp = Math.sqrt(2 * d * a * b / (a + b));
  return overhead + vp / a + vp / b;
}

/** Prędkość szczytowa profilu trapezowego na odcinku (≤ vmax). */
export function trapezoidPeak(distance, vmax, accel, decel) {
  const d = Math.max(0, Number(distance) || 0);
  const a = Math.max(1e-6, Number(accel) || 1e-6);
  const b = Math.max(1e-6, Number(decel) || a);
  return Math.min(Math.max(0, Number(vmax) || 0), Math.sqrt(2 * d * a * b / (a + b)));
}

// ============================================================
// Ruch v2 (src/game/traffic/travelNetwork.js — DRIVE_MODES)
// ============================================================

/**
 * Klasa ładowni ruchu v2 (VAN_CLASSES, traffic/shipmentOrders.js) → klasa lotu, silnik hipercruise i napęd warp. Propozycja E5:
 * hipercruise — lekkie vany Mk II (szybki drobnicowiec), reszta Mk I; warp — vany i haulery Mk I, bulk i heavy
 * Mk II, megafrachtowiec Mk III (duży kadłub unosi duży napęd).
 */
export const TRAFFIC_CLASS_DRIVE = Object.freeze({
  van: Object.freeze({ flightClass: 'frigate', hypercruise: 'hypercruise_mk2', warp: 'warp_mk1' }),
  hauler: Object.freeze({ flightClass: 'destroyer', hypercruise: 'hypercruise_mk1', warp: 'warp_mk1' }),
  bulk: Object.freeze({ flightClass: 'battleship', hypercruise: 'hypercruise_mk1', warp: 'warp_mk2' }),
  heavy: Object.freeze({ flightClass: 'carrier', hypercruise: 'hypercruise_mk1', warp: 'warp_mk2' }),
  mega: Object.freeze({ flightClass: 'supercapital', hypercruise: 'hypercruise_mk1', warp: 'warp_mk3' })
});

/** Klasa przewoźnika, z której liczą się kursy bez podanej klasy (typowy hauler 160 t). */
export const TRAFFIC_DEFAULT_CLASS = 'hauler';

/**
 * Napęd konwencjonalny ruchu v2 = PRZELOT frachtowca bez silnika hipercruise (i manewry przy portach):
 * 1200 j/s (dawne 800 j/s z czasów, gdy gracz latał 1500; PRZELOTU gracza nie ma od 2026-10-22).
 */
export const TRAFFIC_CONVENTIONAL = Object.freeze({
  id: 'conventional',
  label: 'konwencjonalny',
  speed: 1200,
  fuelId: 'hydrogen',
  fuelPerUnit: 1 / 40_000,
  /** Pełna ekspozycja na przechwyt — cała trasa pirata. */
  risk: 1
});

/**
 * Hipercruise w ruchu v2: prędkość i czas z silnika klasy; wodór (więcej na jednostkę drogi niż
 * PRZELOT); ryzyko 1 — hipercruise DA SIĘ PRZERWAĆ (piraci przechwytują na odcinku), więc wybór warp /
 * hipercruise zostaje rachunkiem paliwo fuzyjne ↔ strata oczekiwana, jak dawny warp / konwencjonalny.
 */
export function trafficHypercruiseMode(vanClass = TRAFFIC_DEFAULT_CLASS) {
  const cls = TRAFFIC_CLASS_DRIVE[vanClass] || TRAFFIC_CLASS_DRIVE[TRAFFIC_DEFAULT_CLASS];
  const spec = hypercruiseSpec(cls.hypercruise, cls.flightClass);
  return Object.freeze({
    id: 'hypercruise',
    label: 'hipercruise',
    engineId: spec.engineId,
    speed: spec.vmax,
    accel: spec.accel,
    decel: spec.decel,
    overheadSeconds: spec.spool,
    fuelId: 'hydrogen',
    fuelPerUnit: spec.fuelPerUnit,
    risk: 1
  });
}

/**
 * Rozruch hipercruise'u na odcinek TRAVEL TO długości `distance` [j.]: pełny `spool` od shortLeg, krócej na krótkich
 * odcinkach (krótki rozpęd zamiast dawnego PRZELOTU), nie mniej niż minSpool.
 */
export function hypercruiseLegSpool(spool, distance, tune = HYPERCRUISE_TUNE) {
  const full = Math.max(0, Number(spool) || 0);
  const k = Math.min(1, Math.max(0, Number(distance) || 0) / Math.max(1, tune.shortLeg));
  return Math.min(full, Math.max(tune.minSpool, full * k));
}

/** Warp w ruchu v2 dla klasy ładowni: prędkość z napędu klasy, paliwo i ryzyko wspólne (WARP_DRIVE). */
export function trafficWarpMode(vanClass = TRAFFIC_DEFAULT_CLASS) {
  const cls = TRAFFIC_CLASS_DRIVE[vanClass] || TRAFFIC_CLASS_DRIVE[TRAFFIC_DEFAULT_CLASS];
  return Object.freeze({
    id: 'warp',
    label: 'warp',
    driveId: cls.warp,
    speed: warpDriveSpeed(cls.warp),
    /** Ładowanie i rampa wyjścia — skok nigdy nie trwa zero. */
    overheadSeconds: WARP_DRIVE.overheadSeconds,
    fuelId: WARP_DRIVE.fuelId,
    fuelPerUnit: WARP_DRIVE.fuelPerUnit,
    /** Nietykalny z założenia. Dopóki nie ma disruptorów, to jest zero. */
    risk: WARP_DRIVE.risk
  });
}
