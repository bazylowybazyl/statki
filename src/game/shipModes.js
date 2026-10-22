// src/game/shipModes.js
//
// TRYBY OKRĘTU gracza (2026-10-03, decyzje użytkownika): koło pod ŚPM jak kombinezon w Crysis —
// przytrzymaj ŚPM, wskaż sektor, puść; szybkie stuknięcie ŚPM wraca do poprzedniego trybu. Czas NIE
// zwalnia przy otwartym kole. Tryby się wykluczają, a każdy przejmuje celownik:
//   • BOJOWY    — pierścień wież grupy w ręku (src/ui/weaponReticle.js);
//   • TARCZE    — wzmocnienie tarczy kosztem napędu (szybsza regeneracja, tarcza przyjmuje mniej, pole
//                 znacznie twardsze na przebicie i WIDOCZNE — domyślnie tarcza jest niewidoczna; lot
//                 i obrót wyraźnie wolniejsze — 2026-10-05, decyzja użytkownika);
//   • HIPERCRUISE (O) — przelot 20–40 tys. j/s z zimną bronią (src/game/flight/hypercruise.js; decyzja
//                 użytkownika 2026-10-22: PRZELOT i jego biegi usunięte, zastąpił je hipercruise) — automat
//                 w kleju gry, nie postawa: sektor koła włącza go jak klawisz O;
//   • MASKOWANIE (I), TORPEDY (8), WYDOBYCIE (N), FLOTA (G — RTS) — dawne osobne przełączniki gry.
//
// Moduł jest czysty (bez DOM i okna gry). Stan TARCZE / BOJOWY (postawa) żyje tutaj; tryby z własnym
// systemem (hipercruise, maskowanie, torpedy, wydobycie, RTS) odczytuje i przełącza klej w index.html
// (blok „TRYBY OKRĘTU”) — ich system zostaje źródłem prawdy (np. maskowanie pęka przy strzale).

export const SHIP_MODE_IDS = Object.freeze(['combat', 'shield', 'hypercruise', 'cloak', 'torpedo', 'mining', 'fleet']);

// Kolejność = sektory koła zgodnie z ruchem wskazówek, od góry.
export const SHIP_MODE_DEFS = Object.freeze({
  combat: Object.freeze({ id: 'combat', label: 'BOJOWY', key: '', stance: true }),
  shield: Object.freeze({ id: 'shield', label: 'TARCZE', key: '', stance: true }),
  hypercruise: Object.freeze({ id: 'hypercruise', label: 'HIPERCRUISE', key: 'O', stance: false }),
  cloak: Object.freeze({ id: 'cloak', label: 'MASKOWANIE', key: 'I', stance: false }),
  torpedo: Object.freeze({ id: 'torpedo', label: 'TORPEDY', key: '8', stance: false }),
  mining: Object.freeze({ id: 'mining', label: 'WYDOBYCIE', key: 'N', stance: false }),
  fleet: Object.freeze({ id: 'fleet', label: 'FLOTA', key: 'G', stance: false })
});

// Nastawy postaw (start do strojenia — user ocenia feel sam).
// turn — przyspieszenie kątowe, turnRate — sufit prędkości obrotu; shieldHardness — mnożnik twardości pola (próg przebicia heksów, src/3d/shield3D.js — twardość kadłuba
// × postawa); shieldShow — tarcza widoczna stale (siatka heksów), nie tylko w miejscu trafienia.
export const SHIP_STANCE_TUNE = Object.freeze({
  combat: Object.freeze({ speed: 1, thrust: 1, turn: 1, shieldRegen: 1, shieldDelay: 1, shieldTaken: 1, turnRate: 1, shieldHardness: 1, shieldShow: false, weaponsCold: false }),
  // TARCZE: tarcza ładuje się 2,5× szybciej, zaczyna 2× wcześniej, przyjmuje 35% mniej, pole 3× twardsze
  // na przebicie i widoczne; okręt znacznie wolniejszy (limit × 0,4, ciąg × 0,5) i mniej zwrotny (przyspieszenie
  // kątowe × 0,45, największa prędkość obrotu × 0,55).
  shield: Object.freeze({ speed: 0.4, thrust: 0.5, turn: 0.45, turnRate: 0.55, shieldRegen: 2.5, shieldDelay: 0.5, shieldTaken: 0.65, shieldHardness: 3, shieldShow: true, weaponsCold: false })
});

// Stuknięcie ŚPM krótsze niż to [s, czas rzeczywisty] bez wybranego sektora = poprzedni tryb.
export const SHIP_MODE_TAP = 0.22;
// Martwa strefa koła w px (środek = bez wyboru).
export const SHIP_MODE_DEADZONE = 34;

export function createShipModes() {
  return {
    stance: 'combat',     // postawa: combat / shield
    current: 'combat',    // tryb widoczny (klej gry rozstrzyga co klatkę: resolveShipMode)
    previous: 'combat',   // do stuknięcia ŚPM
    // x, y — środek rysunku koła; ox, oy — kursor w chwili wciśnięcia ŚPM (sektor = ruch myszy od tego punktu).
    wheel: { open: false, x: 0, y: 0, ox: 0, oy: 0, hover: -1, openedAt: 0 }
  };
}

export function isShipMode(id) {
  return Object.prototype.hasOwnProperty.call(SHIP_MODE_DEFS, id);
}

/** Nastawy postawy (combat dla trybów bez postawy — hipercruise, maskowanie, torpedy, wydobycie, flota). */
export function stanceTune(modes) {
  return SHIP_STANCE_TUNE[modes?.stance] || SHIP_STANCE_TUNE.combat;
}

/**
 * Tryb widoczny z systemów gry: flota (RTS) > wydobycie > torpedy > maskowanie > hipercruise > postawa.
 * `sys` — { fleet, mining, torpedo, cloak, hypercruise } (bool). Zapamiętuje poprzedni tryb przy zmianie.
 */
export function resolveShipMode(modes, sys) {
  let id = modes.stance;
  if (sys?.fleet) id = 'fleet';
  else if (sys?.mining) id = 'mining';
  else if (sys?.torpedo) id = 'torpedo';
  else if (sys?.cloak) id = 'cloak';
  else if (sys?.hypercruise) id = 'hypercruise';
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
