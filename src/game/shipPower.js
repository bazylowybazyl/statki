// src/game/shipPower.js
//
// STAN ZASILANIA OKRĘTU (2026-11-11, prośba użytkownika: „możliwość włączenia / wyłączenia statku oraz wizualnie pokazać
// i rozróżniać włączony statek od wyłączonego; wyłączony będzie miał mniejszą sygnaturę radarową”).
//
// Decyzje użytkownika 2026-11-11: wyłączenie gasi WSZYSTKO NARAZ (silniki MAIN i SIDE, tarcza, broń z obroną punktową,
// systemy F, aktywny skan, start myśliwców, drony); sygnatura spada TAK SZYBKO JAK GASZENIE („ktoś cię goni, wchodzisz
// w chmurę gazową, wyłączasz i jest cisza”); NPC dostaje tę samą opcję, ale żaden mózg jej dziś nie używa.
//
//   PRACA ──wyłącz──▶ GASZENIE (shutdownTime: systemy gasną od razu, światła falą do reaktora, sygnatura spada) ──▶ WYŁ.
//     ▲                                                                                                            │
//     └──── ROZRUCH (startupTime: reaktor, fala światła od reaktora, okna mostka, reflektory, lampy, silniki) ◀──włącz
//
// Rozgrywka (czyta gra): systemy (broń, tarcza, F, skan, hangary, drony) tylko w PRACY — `shipPowerOn`; silniki od
// `enginesAt` rozruchu — `powerAllowsEngines`; sygnatura × `powerSignatureMul`, moc czujników × `powerSensorMul`.
// Obraz (czyta render): `shipPowerLook(state, t, out)` — kanały świateł z SAMEGO stanu i czasu fazy (do workera idą dwie
// liczby encji, kanały liczy ta sama funkcja po obu stronach).
//
// Stan na encji: `entity.shipPower` (stały kształt). Encja BEZ stanu = PRACA (NPC, stare zapisy, dema). Czas = czas gry.
// Bez three i DOM (testy node; render importuje moduł jako klasa A — czyste funkcje).

export const POWER_OFF = 0;
export const POWER_STARTUP = 1;
export const POWER_ON = 2;
export const POWER_SHUTDOWN = 3;

/** Strojenie (konsola: window.ShipPowerTune). Czasy [s] czasu gry, progi obrazu — ułamki fazy. */
export const SHIP_POWER_TUNE = {
  shutdownTime: 2.0,     // GASZENIE: systemy od razu, światła falą, sygnatura spada do offSignature
  startupTime: 5.0,      // ROZRUCH: koszt wyłączenia — broń i tarcza dopiero na końcu
  offSignature: 0.3,     // sygnatura wyłączonego okrętu (× klasa kadłuba)
  offSensors: 0.6,       // moc czujników wyłączonego (tylko bierne, jak cisza w sensorDetection)
  enginesAt: 0.7,        // ułamek rozruchu, od którego silniki dają się odpalić (ster)
  // ROZRUCH (ułamek u = t / startupTime):
  reactorAt: [0.0, 0.25], // rdzeń reaktora rozjarza się
  waveAt: [0.12, 0.62],   // fala światła od reaktora po kadłubie (front 0 → 1 długości od reaktora)
  bridgeAt: [0.38, 0.7],  // okna mostka
  floodAt: [0.5, 0.86],   // reflektory i lampy pokładowe migoczą jak świetlówki
  navAt: 0.8,             // lampy nawigacyjne zaczynają mrugać
  // GASZENIE (ułamek u = t / shutdownTime):
  offWaveAt: [0.0, 0.78], // fala gaśnie od krańców do reaktora
  offBridgeAt: [0.62, 1], // okna mostka gasną ostatnie
  offNavAt: 0.08,         // lampy nawigacyjne gasną od razu
  emergency: 0.22,        // czerwone lampy awaryjne mostka przy wyłączonym (jasność względna)
  waveEdge: 0.12          // miękkość czoła fali (ułamek długości)
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const ramp = (u, a, b) => smooth((u - a) / Math.max(1e-4, b - a));

/** Nowy stan zasilania (domyślnie PRACA). */
export function createShipPower(on = true) {
  return {
    state: on ? POWER_ON : POWER_OFF,
    t: 0,        // czas w bieżącym stanie [s]
    serial: 0    // rośnie przy każdym wejściu w ROZRUCH albo GASZENIE (HUD, dźwięk, obraz: jedno zdarzenie na przejście)
  };
}

/** Stan zasilania encji (tworzy go przy pierwszym użyciu). */
export function shipPowerOf(entity, on = true) {
  if (!entity) return null;
  if (!entity.shipPower) entity.shipPower = createShipPower(on);
  return entity.shipPower;
}

/** Stan (POWER_*) — encja bez stanu = PRACA. */
export function powerStateOf(entity) {
  const s = entity?.shipPower;
  return s ? s.state : POWER_ON;
}

/** Systemy okrętu (broń, PD, tarcza, F, skan, hangary, drony) pracują — tylko w PRACY (encja bez stanu też). */
export function shipPowerOn(entity) {
  const s = entity?.shipPower;
  return !s || s.state === POWER_ON;
}

/** Okręt wyłączony albo w trakcie gaszenia (do zatrzymania pracy, która nie może trwać). */
export function shipPowerDown(entity) {
  const s = entity?.shipPower;
  return !!s && (s.state === POWER_OFF || s.state === POWER_SHUTDOWN);
}

/** Silniki dają się odpalić / pracują: PRACA albo ROZRUCH od `enginesAt`. */
export function powerAllowsEngines(entity, T = SHIP_POWER_TUNE) {
  const s = entity?.shipPower;
  if (!s || s.state === POWER_ON) return true;
  if (s.state === POWER_STARTUP) return s.t >= T.enginesAt * T.startupTime;
  return false;
}

/**
 * Mnożnik sygnatury 0..1: PRACA i ROZRUCH — 1 (rozruch reaktora słychać od razu), GASZENIE — spada gładko do
 * offSignature w czasie gaszenia, WYŁ. — offSignature.
 */
export function powerSignatureMul(entity, T = SHIP_POWER_TUNE) {
  const s = entity?.shipPower;
  if (!s) return 1;
  switch (s.state) {
    case POWER_OFF: return T.offSignature;
    case POWER_SHUTDOWN: return 1 + (T.offSignature - 1) * smooth(s.t / Math.max(1e-3, T.shutdownTime));
    default: return 1;
  }
}

/** Mnożnik mocy czujników: wyłączony (i w gaszeniu) — tylko bierne. */
export function powerSensorMul(entity, T = SHIP_POWER_TUNE) {
  return shipPowerDown(entity) ? T.offSensors : 1;
}

/** Ułamek bieżącej fazy 0..1 (HUD). PRACA — 1, WYŁ. — 0. */
export function powerSequenceProgress(entity, T = SHIP_POWER_TUNE) {
  const s = entity?.shipPower;
  if (!s) return 1;
  if (s.state === POWER_STARTUP) return Math.min(1, s.t / Math.max(1e-3, T.startupTime));
  if (s.state === POWER_SHUTDOWN) return Math.min(1, s.t / Math.max(1e-3, T.shutdownTime));
  return s.state === POWER_ON ? 1 : 0;
}

/** Sekundy do końca ROZRUCHU (0 poza rozruchem). */
export function powerStartupLeft(entity, T = SHIP_POWER_TUNE) {
  const s = entity?.shipPower;
  if (!s || s.state !== POWER_STARTUP) return 0;
  return Math.max(0, T.startupTime - s.t);
}

/** Napis HUD: null w PRACY, inaczej „WYŁ.” / „ROZRUCH” / „GASZENIE”. */
export function powerHudLabel(entity) {
  switch (powerStateOf(entity)) {
    case POWER_OFF: return 'WYŁ.';
    case POWER_STARTUP: return 'ROZRUCH';
    case POWER_SHUTDOWN: return 'GASZENIE';
    default: return null;
  }
}

/**
 * WYŁĄCZ. Z PRACY — pełne gaszenie; z ROZRUCHU — gaszenie od bieżącego poziomu świateł (bez skoku obrazu).
 * Zwraca true, gdy coś się zmieniło.
 */
export function powerDownShip(entity, T = SHIP_POWER_TUNE) {
  const s = shipPowerOf(entity);
  if (!s) return false;
  if (s.state === POWER_ON) {
    s.state = POWER_SHUTDOWN; s.t = 0; s.serial++;
    return true;
  }
  if (s.state === POWER_STARTUP) {
    const lit = ramp(s.t / Math.max(1e-3, T.startupTime), T.waveAt[0], T.waveAt[1]);
    s.state = POWER_SHUTDOWN; s.serial++;
    s.t = (1 - lit) * T.offWaveAt[1] * T.shutdownTime;
    return true;
  }
  return false;
}

/**
 * WŁĄCZ. Z WYŁ. — pełny rozruch; z GASZENIA — rozruch „ciepły” (reaktor jeszcze pracuje: od końca fazy reaktora).
 * Zwraca true, gdy sekwencja ruszyła.
 */
export function powerUpShip(entity, T = SHIP_POWER_TUNE) {
  const s = shipPowerOf(entity);
  if (!s) return false;
  if (s.state === POWER_OFF) {
    s.state = POWER_STARTUP; s.t = 0; s.serial++;
    return true;
  }
  if (s.state === POWER_SHUTDOWN) {
    s.state = POWER_STARTUP; s.serial++;
    s.t = T.reactorAt[1] * T.startupTime;
    return true;
  }
  return false;
}

/** Przełącznik: PRACA / ROZRUCH → wyłącz, WYŁ. / GASZENIE → włącz. */
export function toggleShipPower(entity, T = SHIP_POWER_TUNE) {
  const st = powerStateOf(entity);
  return (st === POWER_ON || st === POWER_STARTUP) ? powerDownShip(entity, T) : powerUpShip(entity, T);
}

/** Stan od razu (start w doku, sceny, zapis), bez sekwencji. */
export function setShipPowerState(entity, state) {
  const s = shipPowerOf(entity);
  if (!s) return;
  s.state = state === POWER_ON || state === POWER_STARTUP || state === POWER_SHUTDOWN ? state : POWER_OFF;
  s.t = 0;
}

/** Krok automatu (czas gry): ROZRUCH → PRACA, GASZENIE → WYŁ. Zwraca nowy stan, gdy się zmienił, inaczej −1. */
export function stepShipPower(entity, dt, T = SHIP_POWER_TUNE) {
  const s = entity?.shipPower;
  if (!s || !(dt > 0)) return -1;
  s.t += dt;
  if (s.state === POWER_STARTUP && s.t >= T.startupTime) { s.state = POWER_ON; s.t = 0; return POWER_ON; }
  if (s.state === POWER_SHUTDOWN && s.t >= T.shutdownTime) { s.state = POWER_OFF; s.t = 0; return POWER_OFF; }
  return -1;
}

/**
 * KANAŁY ŚWIATEŁ z samego stanu i czasu fazy (gra i render — ta sama funkcja). Pisze do `out` (bez alokacji):
 *   front     — czoło fali: lampa w odległości d (0 = reaktor, 1 = najdalszy kraniec) świeci przy d ≤ front
 *               (`powerWaveAt(front, d)`); PRACA > 1, WYŁ. < 0
 *   reactor   — żar rdzenia reaktora 0..1
 *   bridge    — okna mostka 0..1 (normalne, białe)
 *   flood     — reflektory i lampy pokładowe 0..1 (w rozruchu z migotaniem `floodFlicker`)
 *   flicker   — 1, gdy reflektory w fazie migotania (render dokłada własny wzór na lampę)
 *   nav       — lampy nawigacyjne 0 / 1 (mrugają tylko przy 1)
 *   emergency — czerwone lampy awaryjne mostka 0..1 (wyłączony, koniec gaszenia, początek rozruchu)
 *   level     — ogólny poziom świateł 0..1 (dla odbiorców bez fali)
 * Stan spoza listy (lub −1) = PRACA.
 */
export function shipPowerLook(state, t, out, T = SHIP_POWER_TUNE) {
  const o = out || {};
  switch (state) {
    case POWER_OFF:
      o.front = -1; o.reactor = 0; o.bridge = 0; o.flood = 0; o.flicker = 0; o.nav = 0;
      o.emergency = T.emergency; o.level = 0;
      return o;
    case POWER_STARTUP: {
      const u = t / Math.max(1e-3, T.startupTime);
      const w = ramp(u, T.waveAt[0], T.waveAt[1]);
      o.front = -T.waveEdge + w * (1 + 2 * T.waveEdge);
      o.reactor = ramp(u, T.reactorAt[0], T.reactorAt[1]);
      o.bridge = ramp(u, T.bridgeAt[0], T.bridgeAt[1]);
      o.flood = ramp(u, T.floodAt[0], T.floodAt[1]);
      o.flicker = u >= T.floodAt[0] && u < T.floodAt[1] ? 1 : 0;
      o.nav = u >= T.navAt ? 1 : 0;
      o.emergency = T.emergency * (1 - o.bridge);
      o.level = w;
      return o;
    }
    case POWER_SHUTDOWN: {
      const u = t / Math.max(1e-3, T.shutdownTime);
      const w = 1 - ramp(u, T.offWaveAt[0], T.offWaveAt[1]);
      o.front = -T.waveEdge + w * (1 + 2 * T.waveEdge);
      o.reactor = 1 - ramp(u, 0.3, 1);
      o.bridge = 1 - ramp(u, T.offBridgeAt[0], T.offBridgeAt[1]);
      o.flood = w;
      o.flicker = 0;
      o.nav = u < T.offNavAt ? 1 : 0;
      o.emergency = T.emergency * (1 - o.bridge);
      o.level = w;
      return o;
    }
    default:
      o.front = 2; o.reactor = 1; o.bridge = 1; o.flood = 1; o.flicker = 0; o.nav = 1; o.emergency = 0; o.level = 1;
      return o;
  }
}

/** Jasność lampy w odległości d (0 = reaktor, 1 = kraniec) przy czole fali `front` (miękki brzeg). */
export function powerWaveAt(front, d, T = SHIP_POWER_TUNE) {
  return smooth((front - d) / Math.max(1e-4, T.waveEdge) + 0.5);
}

/**
 * Migotanie świetlówki w rozruchu 0..1 dla lampy `seed` (deterministyczne — bez Math.random): krótkie zaniki, coraz
 * rzadsze ku końcowi fazy (`u` — postęp fazy migotania 0..1).
 */
export function floodFlicker(t, seed, u) {
  const k = Math.floor(t * 17 + seed * 7.13);
  const h = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  return r < 0.55 * (1 - u) ? 0.08 : 1;
}

if (typeof window !== 'undefined') window.ShipPowerTune = SHIP_POWER_TUNE;
