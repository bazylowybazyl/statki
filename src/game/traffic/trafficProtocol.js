/**
 * PROTOKÓŁ RUCHU v2 — gra ↔ worker (`traffic.worker.js`, `trafficCore.js`).
 *
 * Same stałe, bez logiki i bez importów: most w grze (`src/game/trafficBridge.js`)
 * czyta z nich układ buforów, a nie ciągnie za sobą całej symulacji — w trybie
 * workera główny wątek nie ładuje dyspozytora wcale.
 *
 * GRA → WORKER
 *   init       { seed, economyScale, capacityMultiplier, piracyPressure,
 *                origin, planetAngles, planetScale, sunRadius,
 *                stations: { id: { factionId?, capacity?, stock? } }, focus? }
 *              `capacity` i `stock` w jednostkach gry (skala 1) — worker sam
 *              mnoży przez skalę (`worldCapacityFromGame`); `stock` tylko dla
 *              stacji opuszczonych (resztki po mieszkańcach).
 *   advance    { dt }                 co klatkę z krokami fizyki; pauza = brak
 *   focus      { x, y, r }            środek i promień bańki (~10 Hz)
 *   stock      { seq, stationId, bag, reason }   handel, rozbiórka wraku
 *   capacity   { stationId, capacity }           pojemności z budynków gry
 *   attach     { course }             encja w grze przejmuje zegar kursu
 *   detach     { course, progress }   oddaje go z postępem etapu (0…1)
 *   progress   { course, progress }   postęp przypiętej encji w etapie
 *   stage-done { course }             encja domknęła etap (dolot, koniec postoju)
 *   destroyed  { course, x?, y?, reason?, byPirates? }   statek zginął w grze
 *   station    { stationId, destroyed: true }
 *   config     { piracyPressure?, piracyEnabled?, protectObserved? }
 *   snapshot   { requestId }          podsumowanie dla konsoli
 *   (zarezerwowane dla Z13 + portu Z2: berth-hold / berth-release gracza)
 *
 * WORKER → GRA
 *   ready      { version, clock, step, seed, economyScale, capacityMultiplier,
 *                stations, resources, factions, kinds, hulls, buildMs }
 *   tick       { clock, steps, stepMs, stats, stockSeq, market, bubble,
 *                wrecks, warWrecks, stationFactions? }   po każdym kroku świata
 *   bubble     { clock, count, data, hulls? }            po przesunięciu fokusu
 *   snapshot-result { requestId, snapshot }
 *   error      { message, stack, during }
 *
 * `course` w wiadomościach to NUMER kursu — część liczbowa jego id
 * (`haul-00012` → 12), unikalna w rejestrze, bo wszystkie rodzaje biorą ją
 * z jednego licznika.
 */

export const TRAFFIC_PROTOCOL_VERSION = 1;

export const TRAFFIC_MSG = Object.freeze({
  INIT: 'init',
  ADVANCE: 'advance',
  FOCUS: 'focus',
  STOCK: 'stock',
  CAPACITY: 'capacity',
  ATTACH: 'attach',
  DETACH: 'detach',
  PROGRESS: 'progress',
  STAGE_DONE: 'stage-done',
  DESTROYED: 'destroyed',
  STATION: 'station',
  CONFIG: 'config',
  SNAPSHOT: 'snapshot',

  READY: 'ready',
  TICK: 'tick',
  BUBBLE: 'bubble',
  SNAPSHOT_RESULT: 'snapshot-result',
  ERROR: 'error'
});

/**
 * Kurs w bańce: jeden BIEŻĄCY odcinek ruchu, który gra interpoluje sama.
 *
 *   t = DUR > 0 ? clamp((czas − T0) / DUR, 0, 1) : 1
 *   x = X0 + (X1 − X0) · t
 *
 * `czas` to czas świata ruchu po stronie gry (`TrafficBridge.time`, suma
 * wysłanych `advance`). Odcinek to etap przelotu albo dojście w porcie
 * (brama → kolejka → stanowisko); postój bez dojścia ma DUR = 0.
 */
export const COURSE_STRIDE = 12;
export const COURSE_FIELD = Object.freeze({
  ID: 0,
  X0: 1,
  Y0: 2,
  X1: 3,
  Y1: 4,
  T0: 5,
  DUR: 6,
  FLAGS: 7,
  /** Indeks w tabeli `hulls` (klasa jednostki z gry, np. `container_ship`). */
  HULL: 8,
  /** Indeks w `factions` albo −1. */
  FACTION: 9,
  /** Indeks stacji portu w `stations` albo −1 — gdy kurs ma przydział w porcie. */
  PORT: 10,
  /** Indeks stanowiska w `docks.berths` tego portu albo −1 (w kolejce / w drodze). */
  BERTH: 11
});

export const COURSE_FLAG = Object.freeze({
  /** Odcinek ma ruch (DUR > 0 i różne końce). */
  MOVING: 1,
  /** Czeka w kolejce portu na stanowisko. */
  BLOCKED: 2,
  /** Stoi (albo dochodzi) na przydzielonym stanowisku. */
  BERTHED: 4,
  /** Etap postoju (załadunek, rozładunek, wydobycie), nie przelotu. */
  DWELL: 8,
  WARP: 16,
  GATE: 32,
  /** Członek konwoju. */
  CONVOY: 64,
  /** Kurs niezależnego kupca. */
  AGENT: 128,
  /** Pusty przelot po pracę. */
  DEADHEAD: 256,
  /** Zegar prowadzi encja w grze (`attach`). */
  ATTACHED: 512
});

/** `(flags >>> COURSE_KIND_SHIFT) & COURSE_KIND_MASK` = indeks w `kinds`. */
export const COURSE_KIND_SHIFT = 12;
export const COURSE_KIND_MASK = 15;

/**
 * Rynek: stacje × surowce × pola, w kolejności tabel `stations` i `resources`
 * z `ready`. `BID`/`ASK` to ceny przy neutralnej reputacji — gra, która zna
 * reputację gracza, liczy swoje z `resourcePrice` na kopii magazynu.
 */
export const MARKET_STRIDE = 5;
export const MARKET_FIELD = Object.freeze({
  STOCK: 0,
  CAPACITY: 1,
  /** Sekundy głodu (`econ.duress`) — trzeci składnik ceny. */
  DURESS: 2,
  BID: 3,
  ASK: 4
});

/** Indeks rekordu rynku dla stacji `s` i surowca `r`. */
export function marketOffset(stationIndex, resourceIndex, resourceCount) {
  return (stationIndex * resourceCount + resourceIndex) * MARKET_STRIDE;
}

/** Numer kursu z jego id (`haul-00012` → 12); `NaN`, gdy id ma inny kształt. */
export function courseNumber(courseId) {
  const id = String(courseId || '');
  const dash = id.lastIndexOf('-');
  if (dash < 0) return NaN;
  const tail = id.slice(dash + 1);
  return /^\d+$/.test(tail) ? Number(tail) : NaN;
}
