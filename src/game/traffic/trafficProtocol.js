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
 *   berth-hold { berths: [id…] }      stanowiska zajęte przez gracza (pełny zbiór; [] = żadne) —
 *              dyspozytor ich nie przydziela, kurs w podejściu przenosi na inne (E6)
 *
 *   BAŃKA W WORKERZE (E6, docs/PLAN-ekonomia-rynki.md § 3.5): lot materializowany
 *   (`materializedFlight.js`) liczy się TU, obok rekordów kursów — gra nie
 *   odtwarza kursów. Po każdym `advance` worker wysyła `actors` (bufor
 *   `ACTOR_FIELD`), gra liczy na nim trafienia i taran, a zniszczenie zgłasza
 *   `destroyed` (kurs → wrak z ładunkiem, `strikeCourse`). `attach` / `detach` /
 *   `progress` / `stage-done` zostają dla encji prowadzonych przez grę (awans
 *   do pełnego NPC — później).
 *
 *   GRACZ NA RYNKU I ZAPIS (E7) — `economySave.js`, `tradeSummary.js`
 *   init.restore         zapis ekonomii (`exportEconomyState`) nakładany na świeży świat; magazyny
 *                        rynków, których jeszcze nie ma (stacja gracza), po ich `market-add`
 *   economy-save    { requestId }   stan do zapisu gry
 *   trade-summary   { requestId }   agregat dla komputera handlowego (trasy, porty, okazje)
 *
 *   RYNKI (E1, docs/PLAN-ekonomia-rynki.md § 3.1) — `src/game/traffic/markets.js`
 *   market-add      { def }                  nowy rynek (MarketDef, `src/data/markets.js`)
 *   market-building { stationId, role }      budynek przemysłu na rynku
 *   market-owner    { stationId, factionId } nowy właściciel (null = opuszczony)
 *   market-remove   { stationId }            rynek znika ze świata
 *   Po każdej zmianie worker od razu wysyła `tick` z nową tabelą `stations`
 *   i `berths` — indeksy rynku i `PORT` kursów liczą się od tej tabeli.
 *
 * WORKER → GRA
 *   ready      { version, clock, step, seed, economyScale, capacityMultiplier,
 *                stations, resources, factions, kinds, berths, buildMs }
 *              `berths`: { stationId: [id stanowiska…] } — `BERTH` kursu to
 *              indeks w liście jego portu (`PORT`), id jak w układach gry.
 *   tick       { clock, steps, stepMs, stats, stockSeq, market, bubble,
 *                wrecks, warWrecks, stationFactions?, stations?, berths? }
 *              po każdym kroku świata; `stations` i `berths` (jak w `ready`)
 *              tylko po zmianie listy rynków — przed `market` z nowym układem
 *   bubble     { clock, count, data, hulls? }            po przesunięciu fokusu
 *   actors     { time, count, data, hulls?, ms, docks?, undocked? }   po każdym `advance` (E6): encje
 *              bańki — `ACTOR_FIELD`, `time` = czas mostu, w którym pozy są ważne;
 *              `docks` — postoje przy stanowisku, które się zaczęły albo zmieniły
 *              (`DockRecord` niżej), `undocked` — numery kursów, których postój się skończył
 *              (odłączenie, zniknięcie z bańki). Tylko zmiany — stan trzyma most (`actorDocks`).
 *   snapshot-result { requestId, snapshot }
 *   economy-save-result  { requestId, state }     (E7)
 *   trade-summary-result { requestId, summary }   (E7)
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

  // Rynki (E1) — `markets.js`.
  MARKET_ADD: 'market-add',
  MARKET_BUILDING: 'market-building',
  MARKET_OWNER: 'market-owner',
  MARKET_REMOVE: 'market-remove',

  // Bańka w workerze (E6).
  BERTH_HOLD: 'berth-hold',
  ACTORS: 'actors',

  // Gracz na rynku i zapis (E7).
  ECONOMY_SAVE: 'economy-save',
  ECONOMY_SAVE_RESULT: 'economy-save-result',
  TRADE_SUMMARY: 'trade-summary',
  TRADE_SUMMARY_RESULT: 'trade-summary-result',

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
  /** Indeks w `ready.berths[stacja portu]` albo −1 (w kolejce / w drodze). */
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
 * Encja bańki (E6): poza lekkiego statku w chwili `actors.time` (czas mostu).
 * Gra ekstrapoluje ją do swojego czasu (wiadomość przychodzi klatkę po
 * `advance`, który ją policzył): `VX`, `VY`, `ANG_VEL` to ruch FAKTYCZNY
 * ostatniego kroku bańki (z rozpychaniem, dociąganiem przechwytu i cofaniem —
 * nie sama prędkość wzdłuż dziobu), `AX`, `AY` — przyspieszenie z dwóch kroków.
 * Ekstrapolacja drugiego rzędu trzyma skok pozy przy nowym buforze poniżej
 * jednostki (przy 240 Hz obraz nie drga co klatkę fizyki).
 *
 * `LENGTH` × `WIDTH` to obrys kadłuba (`trafficHullFootprint`) — ten sam,
 * którym bańka mieści statek na stanowisku; gra liczy na nim trafienia.
 * `PORT` / `BERTH` jak w kursie: stanowisko, na które statek leci (`APPROACH`),
 * przy którym stoi (faza `capture` / `docked` / `undock`) albo z którego
 * właśnie wychodzi (`LEAVING`); −1, gdy żadne.
 */
export const ACTOR_STRIDE = 20;
export const ACTOR_FIELD = Object.freeze({
  /** Numer kursu (`courseNumber`) — ten sam, który gra odsyła w `destroyed`. */
  ID: 0,
  X: 1,
  Y: 2,
  ANGLE: 3,
  VX: 4,
  VY: 5,
  ANG_VEL: 6,
  /** Indeks w tabeli `hulls` (wspólna z buforem kursów). */
  HULL: 7,
  FACTION: 8,
  /** Indeks w `ACTOR_PHASES`. */
  PHASE: 9,
  FLAGS: 10,
  /** −1…1: przyspieszenie wzdłuż dziobu (dysze główne / wsteczne). */
  THROTTLE: 11,
  LENGTH: 12,
  WIDTH: 13,
  PORT: 14,
  BERTH: 15,
  /** Czas od przechwytu na stanowisku [s] (sekwencja obsługi). */
  DOCK_TIME: 16,
  /** Prędkość wzdłuż dziobu (ujemna = cofanie) i przelotowa etapu — dysze. */
  SPEED: 17,
  /** Przyspieszenie faktyczne [j./s²] — ekstrapolacja drugiego rzędu w grze. */
  AX: 18,
  AY: 19
});

/**
 * Postój statku przy stanowisku (kontrakt E6 ↔ E12 — przeładunek: ładownie, roje dronów, taśmociągi):
 *   { id, berthId, stationId, mode, cargo, fill, t0, dur, hull, unitClass }
 *   id        — numer kursu (= `ACTOR_FIELD.ID` encji),
 *   berthId   — id stanowiska jak w `ready.berths` / układach doków gry,
 *   mode      — powód postoju (`DWELL_REASON`): 'load' | 'unload' | 'extract' | 'refuel' | 'service' | 'hold',
 *   cargo     — { towar: ilość } w jednostkach ŚWIATA ruchu (zapas × skala gospodarki): to, co statek
 *               wyładowuje ('unload') albo bierze ('load'); urobek wyprawy — cały worek; pusty przelot,
 *               patrol — {},
 *   (Obok, w każdej wiadomości `actors`: `cargo` — Float32Array rekordów przeładunku encji przy stanowisku,
 *   krok `ACTOR_CARGO_STRIDE` — `bubbleCargo.js`, kontrakt E12 przyjęty przez orkiestratora; null bez rekordów.)
 *   fill      — 0…1: masa ładunku (`payload.mass`) / ładowność klasy kursu (`VAN_CLASSES[].capacity`, ta sama
 *               skala co masa); null — klasa bez ładowni (okręty, rejdery) albo kurs bez masy (pusty → 0),
 *   t0, dur   — obsługa przy stanowisku w CZASIE MOSTU: od `t0` (koniec przechwytu) przez `dur` s
 *               (postęp = (czas − t0) / dur; dojście w porcie nie wchodzi),
 *   hull      — id kadłuba proxy (`resolveTrafficHullId`), unitClass — klasa kursu.
 */
export const DOCK_MODES = Object.freeze(['load', 'unload', 'extract', 'refuel', 'service', 'hold']);

/** Fazy encji w kolejności indeksów `ACTOR_FIELD.PHASE` (= wartości `ACTOR_PHASE`). */
export const ACTOR_PHASES = Object.freeze(['fly', 'capture', 'docked', 'undock', 'hold', 'station']);

export const ACTOR_FLAG = Object.freeze({
  /** Etap warpu — dysze na dopalaczu, bez plazmy. */
  WARP: 1,
  /** Leci na przydzielone stanowisko (`PORT` / `BERTH`). */
  APPROACH: 2,
  /** Wychodzi ze stanowiska `PORT` / `BERTH` (pole jeszcze nie wolne). */
  LEAVING: 4,
  CONVOY: 8,
  AGENT: 16,
  DEADHEAD: 32,
  /**
   * Okręt z zapasu floty frakcji portu na padzie hali K-7 (`placeFleetStock`, Z2) — BEZ kursu: stoi,
   * `ID` ujemny (nie numer kursu), nie przyjmuje obrażeń i nie idzie do `destroyed`.
   */
  STOCK: 64
});

/**
 * Rynek: stacje × surowce × pola, w kolejności tabel `stations` i `resources`
 * z `ready`. `BID`/`ASK` to ceny przy neutralnej reputacji — gra, która zna
 * reputację gracza, liczy swoje z `resourcePrice` na kopii magazynu.
 */
export const MARKET_STRIDE = 7;
export const MARKET_FIELD = Object.freeze({
  STOCK: 0,
  CAPACITY: 1,
  /** Sekundy głodu (`econ.duress`) — trzeci składnik ceny. */
  DURESS: 2,
  BID: 3,
  ASK: 4,
  /** Oferta portu dla kupca (gracz): ile sprzeda ponad rezerwę na własne potrzeby (E7, `portOfferFromQuote`). */
  SELL: 5,
  /** …i ile skupi do celu uzupełnienia, licząc z towarem w drodze (0 — ma dość, −1 — port towaru nie używa). */
  BUY: 6
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

/**
 * PAS W EKONOMII (E3, docs/PLAN-ekonomia-rynki.md § 3.3) — uszczuplenie pasa i wyrwy
 * (`traffic/miningFields.js`). Osobna tabela, bo `TRAFFIC_MSG` rozbudowuje rynek.
 *
 * GRA → WORKER
 *   belt-mined { x, y, tons }       urobek platformy gracza (ładownia) w punkcie świata gry —
 *                                   ten sam rejestr uszczuplenia co wyprawy NPC
 * WORKER → GRA
 *   belt-holes { holes, full }      zmienione wyrwy `[{ id, x, y, r, depth }]` (depth 0 = usunięta);
 *                                   `full` — pełna lista (po `ready`), inaczej tylko zmiany od ostatniej
 */
export const BELT_MSG = Object.freeze({
  MINED: 'belt-mined',
  HOLES: 'belt-holes'
});
