// src/game/shipModes.js
//
// TRYBY OKRĘTU gracza (2026-10-03, decyzje użytkownika): koło pod ŚPM jak kombinezon w Crysis —
// przytrzymaj ŚPM, wskaż sektor, puść; szybkie stuknięcie ŚPM wraca do poprzedniego trybu. Czas NIE
// zwalnia przy otwartym kole. Tryby się wykluczają, a każdy przejmuje celownik:
//   • BOJOWY    — pierścień wież grupy w ręku (src/ui/weaponReticle.js);
//   • TARCZE    — wzmocnienie tarczy kosztem napędu (szybsza regeneracja, tarcza przyjmuje mniej, wolniejszy lot);
//   • PRZELOT   — szybki lot z zimną bronią na BIEGACH (QOL 2026-10-03: biegi przeniesione z warpa —
//                 warp ma jedną prędkość): 4 biegi do 3× limitu bojowego (Atlas 500 → 1500 j/s), bieg
//                 w górę sam przy gazie pod limitem biegu, Ctrl w dół; wieże milczą, tarcza wolniej;
//   • MASKOWANIE (I), TORPEDY (8), WYDOBYCIE (N), FLOTA (G — RTS) — dawne osobne przełączniki gry.
//
// Moduł jest czysty (bez DOM i okna gry). Stan TARCZE / PRZELOT / BOJOWY (postawa) żyje tutaj; tryby
// z własnym systemem (maskowanie, torpedy, wydobycie, RTS) odczytuje i przełącza klej w index.html
// (blok „TRYBY OKRĘTU”) — ich system zostaje źródłem prawdy (np. maskowanie pęka przy strzale).

export const SHIP_MODE_IDS = Object.freeze(['combat', 'shield', 'cruise', 'cloak', 'torpedo', 'mining', 'fleet']);

// Kolejność = sektory koła zgodnie z ruchem wskazówek, od góry.
export const SHIP_MODE_DEFS = Object.freeze({
  combat: Object.freeze({ id: 'combat', label: 'BOJOWY', key: '', stance: true }),
  shield: Object.freeze({ id: 'shield', label: 'TARCZE', key: '', stance: true }),
  cruise: Object.freeze({ id: 'cruise', label: 'PRZELOT', key: '', stance: true }),
  cloak: Object.freeze({ id: 'cloak', label: 'MASKOWANIE', key: 'I', stance: false }),
  torpedo: Object.freeze({ id: 'torpedo', label: 'TORPEDY', key: '8', stance: false }),
  mining: Object.freeze({ id: 'mining', label: 'WYDOBYCIE', key: 'N', stance: false }),
  fleet: Object.freeze({ id: 'fleet', label: 'FLOTA', key: 'G', stance: false })
});

// Nastawy postaw (start do strojenia — user ocenia feel sam).
export const SHIP_STANCE_TUNE = Object.freeze({
  combat: Object.freeze({ speed: 1, thrust: 1, turn: 1, shieldRegen: 1, shieldDelay: 1, shieldTaken: 1, weaponsCold: false }),
  // TARCZE: tarcza ładuje się 2,5× szybciej, zaczyna 2× wcześniej i przyjmuje 35% mniej; okręt wolniejszy.
  shield: Object.freeze({ speed: 0.6, thrust: 0.75, turn: 0.75, shieldRegen: 2.5, shieldDelay: 0.5, shieldTaken: 0.65, weaponsCold: false }),
  // PRZELOT: limit z biegu (CRUISE_GEARS — speed to bieg 1), ciąg × 1,6; wieże milczą, tarcza ładuje się o połowę wolniej.
  cruise: Object.freeze({ speed: 1.5, thrust: 1.6, turn: 0.85, shieldRegen: 0.5, shieldDelay: 1, shieldTaken: 1, weaponsCold: true })
});

/**
 * Biegi PRZELOTU (QOL 2026-10-03, decyzja usera: „biegi przeniesiemy do trybu cruise — Atlas rozpędzi
 * się do 1500 j/s”): mnożniki limitu bojowego kadłuba (Atlas 500 j/s → 750 / 1000 / 1250 / 1500).
 * upAt — bieg w górę, gdy prędkość ≥ tyle × limit biegu przy gazie; downAt — w dół bez gazu poniżej
 * tyle × limit biegu niżej; cooldown [s] między zmianami.
 */
export const CRUISE_GEARS = Object.freeze({ muls: Object.freeze([1.5, 2.0, 2.5, 3.0]), upAt: 0.94, downAt: 0.6, throttle: 0.35, cooldown: 0.6 });

/** Mnożnik limitu bojowego dla biegu PRZELOTU (1..N). */
export function cruiseGearMul(gear) {
  const m = CRUISE_GEARS.muls;
  return m[Math.max(0, Math.min(m.length - 1, (gear | 0) - 1))];
}

/**
 * Krok automatu biegów PRZELOTU: modes.cruiseGear / modes.cruiseShiftCd. speed — prędkość [j/s],
 * baseLimit — limit bojowy kadłuba [j/s], throttle — gaz 0..1. Zwraca 'up' | 'down' | null.
 */
export function stepCruiseGear(modes, speed, baseLimit, throttle, dt) {
  if (!modes || modes.stance !== 'cruise') return null;
  const G = CRUISE_GEARS;
  modes.cruiseShiftCd = Math.max(0, (Number(modes.cruiseShiftCd) || 0) - Math.max(0, Number(dt) || 0));
  if (modes.cruiseShiftCd > 0) return null;
  const gear = Math.max(1, Math.min(G.muls.length, modes.cruiseGear | 0 || 1));
  const base = Math.max(1, Number(baseLimit) || 1);
  const v = Math.max(0, Number(speed) || 0);
  if (throttle > G.throttle && gear < G.muls.length && v >= base * cruiseGearMul(gear) * G.upAt) {
    modes.cruiseGear = gear + 1;
    modes.cruiseShiftCd = G.cooldown;
    return 'up';
  }
  if (throttle < 0.08 && gear > 1 && v < base * cruiseGearMul(gear - 1) * G.downAt) {
    modes.cruiseGear = gear - 1;
    modes.cruiseShiftCd = G.cooldown;
    return 'down';
  }
  return null;
}

/** Ręczna redukcja biegu PRZELOTU (Ctrl). */
export function shiftCruiseGearDown(modes) {
  if (!modes || modes.stance !== 'cruise' || (modes.cruiseGear | 0) <= 1) return false;
  modes.cruiseGear = (modes.cruiseGear | 0) - 1;
  modes.cruiseShiftCd = CRUISE_GEARS.cooldown;
  return true;
}

// Stuknięcie ŚPM krótsze niż to [s, czas rzeczywisty] bez wybranego sektora = poprzedni tryb.
export const SHIP_MODE_TAP = 0.22;
// Martwa strefa koła w px (środek = bez wyboru).
export const SHIP_MODE_DEADZONE = 34;

export function createShipModes() {
  return {
    stance: 'combat',     // postawa: combat / shield / cruise
    current: 'combat',    // tryb widoczny (klej gry rozstrzyga co klatkę: resolveShipMode)
    previous: 'combat',   // do stuknięcia ŚPM
    cruiseGear: 1,        // bieg PRZELOTU (CRUISE_GEARS)
    cruiseShiftCd: 0,
    // x, y — środek rysunku koła; ox, oy — kursor w chwili wciśnięcia ŚPM (sektor = ruch myszy od tego punktu).
    wheel: { open: false, x: 0, y: 0, ox: 0, oy: 0, hover: -1, openedAt: 0 }
  };
}

export function isShipMode(id) {
  return Object.prototype.hasOwnProperty.call(SHIP_MODE_DEFS, id);
}

/** Nastawy postawy (combat dla trybów bez postawy — maskowanie, torpedy, wydobycie, flota). */
export function stanceTune(modes) {
  return SHIP_STANCE_TUNE[modes?.stance] || SHIP_STANCE_TUNE.combat;
}

/**
 * Tryb widoczny z systemów gry: flota (RTS) > wydobycie > torpedy > maskowanie > postawa.
 * `sys` — { fleet, mining, torpedo, cloak } (bool). Zapamiętuje poprzedni tryb przy zmianie.
 */
export function resolveShipMode(modes, sys) {
  let id = modes.stance;
  if (sys?.fleet) id = 'fleet';
  else if (sys?.mining) id = 'mining';
  else if (sys?.torpedo) id = 'torpedo';
  else if (sys?.cloak) id = 'cloak';
  if (id !== modes.current) {
    modes.previous = modes.current;
    modes.current = id;
  }
  return id;
}

/** Sektor koła pod wektorem (dx, dy) od środka [px]; -1 w martwej strefie. Sektor 0 u góry. */
export function shipModeFromWheelVector(dx, dy, count = SHIP_MODE_IDS.length, deadzone = SHIP_MODE_DEADZONE) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (x * x + y * y < deadzone * deadzone) return -1;
  const step = (Math.PI * 2) / count;
  const a = Math.atan2(y, x) + Math.PI / 2;
  return ((Math.round(a / step) % count) + count) % count;
}

export function openShipModeWheel(modes, x, y, now, ox = x, oy = y) {
  const w = modes.wheel;
  w.open = true;
  w.x = x;
  w.y = y;
  w.ox = ox;
  w.oy = oy;
  w.hover = -1;
  w.openedAt = now;
}

/**
 * Puszczenie ŚPM: zwraca id trybu do włączenia albo null. Sektor pod kursorem wygrywa; bez sektora
 * krótkie stuknięcie = poprzedni tryb.
 */
export function releaseShipModeWheel(modes, now) {
  const w = modes.wheel;
  if (!w.open) return null;
  w.open = false;
  if (w.hover >= 0) {
    const id = SHIP_MODE_IDS[w.hover];
    w.hover = -1;
    return id && id !== modes.current ? id : null;
  }
  if (now - w.openedAt < SHIP_MODE_TAP && modes.previous !== modes.current) return modes.previous;
  return null;
}
