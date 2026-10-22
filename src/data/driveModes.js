// src/data/driveModes.js
//
// JEDNA TABELA NAPĘDÓW (E5, docs/PLAN-ekonomia-rynki.md § 3.4) — gracz, NPC gry i ruch v2 liczą
// prędkości przelotu, hipercruise'u i warpa stąd. Moduł czysty (bez DOM, three i gry).
//
// Tryby (od najwolniejszego):
//   • BOJOWY    — limit bojowy kadłuba: SHIP_FLIGHT_SPECS (src/data/shipFlightSpecs.js; walka bez zmian);
//   • PRZELOT   — biegi × limit bojowy (CRUISE_DRIVE), NPC: cruiseBonus / travelSpeed klasy (CRUISE_BY_CLASS);
//   • HIPERCRUISE — przelot na silniku hipercruise (HYPERCRUISE_ENGINES, 20–40 tys. j/s): rozruch, rozpęd
//                 z klasy kadłuba (HYPERCRUISE_BY_CLASS), DA SIĘ PRZERWAĆ (przechwyt, blokada masy) —
//                 przejmuje odcinki 'drive' rozkazu TRAVEL TO (decyzja użytkownika 2026-10-03);
//   • WARP      — 260 tys. j/s, paliwo fuzyjne, nietykalny (WARP_DRIVE).
//
// Kontrakt E5 ↔ E8 (receptury): id silników `hypercruise_mk1..3` zostają; E5 stroi vmax w 20–40 tys. j/s
// i przyspieszenia per klasa kadłuba, E8 robi z silników towary.

/** Prędkość warpa [j/s] — jedna (strefy mnożą: WARP_DRIVE.zones). Gra: `WARP_SPEED` w index.html. */
export const WARP_SPEED = 260000;

export const WARP_DRIVE = Object.freeze({
  id: 'warp',
  label: 'WARP',
  speed: WARP_SPEED,
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
 * PRZELOT gracza (postawa pod ŚPM): biegi = mnożniki limitu bojowego kadłuba (Atlas 500 j/s →
 * 700 / 850 / 1000 / 1200 j/s; do 2026-10-21 1,5–3,0 → 750–1500). Dopalacz (Shift) gracza: limit
 * w walce i w PRZELOCIE — liczby kadłuba w PLAYER_HULL_DRIVE, bez wpisu 2× / 3,6× limitu bojowego.
 */
export const CRUISE_DRIVE = Object.freeze({
  id: 'cruise',
  label: 'PRZELOT',
  gearMuls: Object.freeze([1.4, 1.7, 2.0, 2.4]),
  boostMul: 2,
  cruiseBoostMul: 3.6
});

/**
 * PRZELOT NPC wg klasy lotu (src/data/shipFlightSpecs.js czyta stąd):
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

/** Dopalacz gracza per kadłub tabeli lotu [j/s]: walka / PRZELOT (Atlas: 1500 / 3000 do 2026-10-21). */
export const PLAYER_HULL_DRIVE = Object.freeze({
  atlas: Object.freeze({ boostSpeed: 1000, cruiseBoostSpeed: 1800, hypercruise: 'hypercruise_mk1' })
});

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
  minZone: 0.3,          // strefa przy planetach (jak warp) — niżej nie schodzi
  exitSpeed: 1000,       // [j/s] wyjście kończy się przy tej prędkości (dalej PRZELOT / regulator)
  massLockRange: 12000,  // [j.] wróg bliżej (bez mgły wojny — to zjawisko fizyczne; maskowanie chroni) — nie wejdzie / wypada
  interruptDecelMul: 4,  // wyjście wymuszone (przechwyt) hamuje × tyle — statek staje przy przechwytującym
  minLeg: 12000,         // [j.] odcinek 'drive' TRAVEL TO krótszy — sam PRZELOT (rozruch by się nie zwrócił)
  interruptible: true    // przechwyt: trafienie albo blokada masy przerywa hipercruise
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
 * Klasa ładowni ruchu v2 (VAN_CLASSES, traffic/shipmentOrders.js) → klasa lotu i silnik hipercruise. Propozycja E5:
 * lekkie vany Mk II (szybki drobnicowiec), reszta Mk I; Mk III — towar dla gracza i kurierów (E8).
 */
export const TRAFFIC_CLASS_DRIVE = Object.freeze({
  van: Object.freeze({ flightClass: 'frigate', hypercruise: 'hypercruise_mk2' }),
  hauler: Object.freeze({ flightClass: 'destroyer', hypercruise: 'hypercruise_mk1' }),
  bulk: Object.freeze({ flightClass: 'battleship', hypercruise: 'hypercruise_mk1' }),
  heavy: Object.freeze({ flightClass: 'carrier', hypercruise: 'hypercruise_mk1' }),
  mega: Object.freeze({ flightClass: 'supercapital', hypercruise: 'hypercruise_mk1' })
});

/** Klasa przewoźnika, z której liczą się kursy bez podanej klasy (typowy hauler 160 t). */
export const TRAFFIC_DEFAULT_CLASS = 'hauler';

/**
 * Napęd konwencjonalny ruchu v2 = PRZELOT frachtowca bez silnika hipercruise (i manewry przy portach):
 * 1200 j/s — jak 4. bieg PRZELOTU Atlasa (dawne 800 j/s z czasów, gdy gracz latał 1500).
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
