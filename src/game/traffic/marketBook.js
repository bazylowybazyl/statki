/**
 * API RYNKU — jedno źródło zapasu, ceny i zleceń dla wszystkich, którzy handlują w ruchu v2
 * (E2b, docs/PLAN-ekonomia-rynki.md § 3.1 „Jeden model handlu”).
 *
 * Handlują: przewoźnicy frakcji (planista dyspozytora), kupcy (`agentFleets` + `tradeMarket`),
 * gracz (terminal → most `stockDelta` → `applyStockDelta`), stocznie (licytacja podzespołów),
 * wojna (amunicja), złomiarze i paser piratów. Każdy z nich czyta rynek i zmienia zapas tutaj:
 *
 *   ZAPAS     `takeStock` / `putStock` — jedyne mutacje magazynu stacji poza księgowością
 *             zleceń przewoźników (`shipmentOrders.js`: załadunek i atomowy rozładunek partii).
 *   KSIĘGA    `createMarketBook` — stan rynku liczony RAZ na tick (`openMarket`):
 *             notowania `resourcePrice` z towarem w drodze (`quotes`), oferty sprzedaży (zapas ponad
 *             rezerwę producenta — `sellers`) i zamówienia skupu (zapas poniżej celu — `buyers`,
 *             wg pilności), rezerwacje towaru w drodze (`inbound`, `inboundSchedule`).
 *   POPYT     `declareDemand` — konsument spoza receptur (stocznia, port wojenny, stacja gracza)
 *             zgłasza towar i porcję; `stationWantsResource` i skup widzą go bez kodu planisty.
 *
 * Kolejność w ticku (`tickDirector`): rozliczenia kursów → produkcja → `openMarket` → wysyłki.
 * Transakcja w tym samym ticku przesuwa księgę od razu (`reserveInbound`, `takeSellOffer`,
 * `requote`), więc następny kupujący widzi chudszego sprzedawcę i towar już lecący do odbiorcy.
 *
 * AGENT: moduł nie zna kursów ani firm — rezerwacje przebudowuje z listy kursów i zleceń, które
 * podaje wołający. Nowy uczestnik rynku = te same funkcje, nie nowy indeks w dyspozytorze.
 */

import { RESOURCES } from '../../data/resources.js';
import {
  getStationSurpluses, stationWantsResource, stationNetRates, stationConsumptionRates
} from '../stationEconomy.js';
import { FACTION, isDerelict } from '../../data/factions.js';
import { SHIPMENT_STATUS } from './shipmentOrders.js';
import { snapshotMarket, refreshQuote } from './tradeMarket.js';

// ============================================================
// Zapas — reguły w `marketStock.js` (bez importów: te same funkcje stosuje most gry do kopii rynku)
// ============================================================

export { stockOf, takeStock, putStock, moveStock } from './marketStock.js';

// ============================================================
// Popyt konsumentów spoza receptur
// ============================================================

/**
 * Konsument spoza receptur zgłasza towar: stocznia (podzespoły okrętów), port wojenny
 * (amunicja), stacja gracza. `stationWantsResource` widzi tylko wsad receptur i zużycie
 * bytowe — bez zgłoszenia transport i kupcy nie wiedzą, że tam trzeba wozić.
 *
 * `options.floor` — najmniejsza porcja (sztuki), do której stacja skupuje towar, nawet gdy
 * planowe zużycie na 2 h jest mniejsze (`restockTarget`): stocznia zużywa podzespół porcjami.
 * Zgłoszenie jest trwałe i idempotentne; większa porcja wygrywa.
 */
export function declareDemand(station, resourceId, options = {}) {
  if (!station || !RESOURCES[resourceId]) return false;
  const wants = station.extraDemand || [];
  if (!wants.includes(resourceId)) station.extraDemand = [...wants, resourceId];
  const floor = Number(options.floor);
  if (floor > 0) {
    const floors = { ...(station.restockFloor || {}) };
    floors[resourceId] = Math.max(Number(floors[resourceId]) || 0, floor);
    station.restockFloor = floors;
  }
  return true;
}

// ============================================================
// Księga rynku (raz na tick)
// ============================================================

/**
 * Księga rynku dyspozytora. `config` to obiekt konfiguracji dyspozytora (czytany na bieżąco:
 * `economyScale`, `inventorySafetyFill`, `inboundOvershoot`), `getEconomy(stationId)` — magazyn.
 */
export function createMarketBook(options = {}) {
  return {
    config: options.config || {},
    getEconomy: typeof options.getEconomy === 'function' ? options.getEconomy : () => null,
    /** Rezerwacje: `stacja:surowiec` → sztuki w drodze. */
    inbound: new Map(),
    /** Rezerwacje: `stacja:surowiec` → dostawy `{ units, eta }`, do kontroli zapasu w czasie. */
    inboundSchedule: new Map(),
    /** Oferty sprzedaży: `stacja` → `{ station, spare: Map surowiec → sztuki }`. */
    sellers: new Map(),
    /** Zamówienia skupu wg pilności: `{ station, id, fill, value, secondsToSafety, belowSafety, demandIntensity }`. */
    buyers: [],
    /** Pierwsze nieobsłużone zamówienie skupu w tym ticku. */
    cursor: 0,
    /** Surowce, które ktokolwiek ma na zbyciu. */
    surplus: new Set(),
    /** `stacja` → nominalne saldo zasobów/s przy skali gospodarki 1. */
    demandRates: new Map(),
    /** `stacja` → planowe zużycie brutto/s przy skali 1 — potrzeba w skupie kupców. */
    useRates: new Map(),
    /** Notowania `resourcePrice` z towarem w drodze i popytem: `stacja` → `{ station, econ, prices }`. */
    quotes: new Map()
  };
}

/**
 * Otwiera rynek na tick: rezerwacje z kursów i zleceń, oferty i zamówienia, a z `withQuotes`
 * notowania dla kupców i stoczni. `courses` — aktywne kursy (payload `resourceId`/`units`
 * albo `harvest`, `targetStationId`), `orders` — aktywne zlecenia przewoźników (czekające
 * na rozładunek nadal są w drodze).
 */
export function openMarket(book, stations, options = {}) {
  rebuildReservations(book, options.courses || [], options.orders || []);
  postOffers(book, stations);
  if (options.withQuotes) postQuotes(book, stations);
}

// ---------- rezerwacje (towar w drodze) ----------

function addReservation(book, stationId, resourceId, units, eta) {
  const amount = Math.max(0, Number(units) || 0);
  if (!(amount > 0)) return;
  const key = `${stationId}:${resourceId}`;
  book.inbound.set(key, (book.inbound.get(key) || 0) + amount);
  const arrivals = book.inboundSchedule.get(key) || [];
  arrivals.push({ units: amount, eta: Math.max(0, Number(eta) || 0) });
  book.inboundSchedule.set(key, arrivals);
}

/**
 * Przelicza rezerwacje „co jest w drodze i dokąd” — RAZ na tick.
 *
 * Liczone przy każdej próbie wysyłki (osiem prób na wysyłkę) dawało O(kursy × próby) —
 * przy kilku tysiącach kursów główny koszt całej warstwy. Jedno przejście na tick
 * wystarcza, bo w obrębie ticku zmienia je tylko `reserveInbound`.
 */
export function rebuildReservations(book, courses, orders) {
  book.inbound.clear();
  book.inboundSchedule.clear();
  for (const course of courses) {
    const payload = course.payload;
    if (!payload) continue;
    const target = payload.targetStationId || course.destinationId;
    if (payload.resourceId && payload.units > 0) {
      addReservation(book, target, payload.resourceId, payload.units, course.remaining);
    }
    if (payload.harvest) {
      for (const [id, amount] of Object.entries(payload.harvest)) {
        addReservation(book, target, id, amount, course.remaining);
      }
    }
  }
  // Kurs może już być zamknięty, a atomowy rozładunek nadal czekać na miejsce.
  // Taki manifest wciąż jest w drodze i nie wolno zamówić duplikatu.
  for (const order of orders) {
    if (order?.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) continue;
    for (const [id, amount] of Object.entries(order.cargo || {})) {
      addReservation(book, order.targetStationId, id, amount, 0);
    }
  }
}

/** Nowa transakcja w tym ticku: towar leci do `stationId` i dotrze za `eta` s. */
export function reserveInbound(book, stationId, resourceId, units, eta = 0) {
  addReservation(book, stationId, resourceId, units, eta);
}

/** Ile sztuk danego surowca jest już w drodze do danej stacji. */
export function inboundUnits(book, stationId, resourceId) {
  return book.inbound.get(`${stationId}:${resourceId}`) || 0;
}

/** Ile z towaru w drodze dotrze nie później niż za `seconds`. */
export function inboundDueWithin(book, stationId, resourceId, seconds) {
  const arrivals = book.inboundSchedule.get(`${stationId}:${resourceId}`) || [];
  const horizon = Math.max(0, Number(seconds) || 0) + 1e-6;
  let units = 0;
  for (const arrival of arrivals) {
    if (arrival.eta <= horizon) units += Math.max(0, Number(arrival.units) || 0);
  }
  return units;
}

// ---------- oferty sprzedaży i zamówienia skupu ----------

/** Nominalny import potrzebny stacji na sekundę przy aktualnej skali gospodarki. */
export function plannedDemandPerSecond(book, station, resourceId) {
  let rates = book.demandRates.get(String(station.id));
  if (!rates) {
    rates = stationNetRates(station);
    book.demandRates.set(String(station.id), rates);
  }
  const net = Number(rates?.[resourceId]) || 0;
  return Math.max(0, -net) * Math.max(0, Number(book.config.economyScale) || 0);
}

/**
 * Oferty sprzedaży i zamówienia skupu — RAZ na tick.
 *
 * Sprzedaż: nadwyżka ponad zapas roboczy producenta (`getStationSurpluses`). Skup: każdy
 * zasób o stałym popycie (receptury, zużycie bytowe, `declareDemand`) — zamówienie musi
 * pojawić się PRZED zejściem poniżej zapasu roboczego; konkretny sprzedawca i jego ETA
 * rozstrzygają dopiero przy wysyłce (`buyOrderUnits`), czy już trzeba wysłać.
 */
export function postOffers(book, stations) {
  book.sellers.clear();
  book.buyers.length = 0;
  book.surplus.clear();
  book.demandRates.clear();
  book.useRates.clear();

  for (const station of stations) {
    // Opuszczona stacja NIE JEST uczestnikiem rynku. Nie ma załogi, nie ma
    // przemysłu i nikt tam niczego nie zamawia.
    //
    // Bez tego warunku Neptun zasysał cały ruch układu: jego gospodarka nigdy
    // nie chodzi, więc magazyny stoją na zerze, a `stationWantsResource` i tak
    // odpowiada „tak" dla tlenu, polimeru, stali i paliwa, bo to zużycie bytowe.
    // Zapełnienie 0% czyniło go wiecznie najpilniejszym odbiorcą w całym układzie.
    if (isDerelict(station) || station.factionId === FACTION.PIRATES) continue;
    const econ = book.getEconomy(station.id);
    if (!econ) continue;
    book.demandRates.set(String(station.id), stationNetRates(station));
    book.useRates.set(String(station.id), stationConsumptionRates(station));

    const spare = new Map();
    for (const surplus of getStationSurpluses(station, econ, 20)) {
      spare.set(surplus.id, surplus.spare);
      book.surplus.add(surplus.id);
    }
    if (spare.size) book.sellers.set(station.id, { station, spare });

    for (const [id, def] of Object.entries(RESOURCES)) {
      if (!stationWantsResource(station, id)) continue;
      const capacity = Number(econ.capacity?.[id]);
      if (!(capacity > 0)) continue;
      const stored = Math.max(0, Number(econ.resources?.[id]) || 0);
      const fill = stored / capacity;
      const demand = plannedDemandPerSecond(book, station, id);
      const safety = capacity * Math.min(1, Math.max(0,
        Number(book.config.inventorySafetyFill) || 0));
      if (!(demand > 0) && stored >= safety) continue;
      const secondsToSafety = demand > 0
        ? (stored - safety) / demand
        : (stored < safety ? -Infinity : Infinity);
      book.buyers.push({
        station, id, fill, value: def.value, secondsToSafety,
        belowSafety: stored < safety,
        demandIntensity: demand / capacity
      });
    }
  }
  // Poniżej zapasu roboczego najpierw ratujemy najpustszy i najszybciej
  // zużywany magazyn. Powyżej niego wygrywa najkrótszy czas do progu.
  book.buyers.sort((a, b) => {
    if (a.belowSafety !== b.belowSafety) return a.belowSafety ? -1 : 1;
    if (a.belowSafety) {
      return a.fill - b.fill || b.demandIntensity - a.demandIntensity;
    }
    return a.secondsToSafety - b.secondsToSafety || b.demandIntensity - a.demandIntensity;
  });
  book.cursor = 0;
}

/** Czy ktokolwiek ma ten surowiec na zbyciu. Jeśli tak, taniej go kupić niż kopać. */
export function hasSellOffer(book, resourceId) {
  return book.surplus.has(resourceId);
}

/** Ile sprzedawca ma jeszcze na zbyciu w tym ticku. */
export function sellOfferUnits(book, stationId, resourceId) {
  return book.sellers.get(stationId)?.spare.get(resourceId) || 0;
}

/** Transakcja zdjęła `units` z oferty sprzedaży — następny kupujący w tym ticku widzi mniej. */
export function takeSellOffer(book, seller, resourceId, units) {
  if (!seller) return;
  const spare = seller.spare.get(resourceId) || 0;
  seller.spare.set(resourceId, Math.max(0, spare - units));
}

/**
 * Ile jeszcze należy przywieźć stacji, aby pozycja magazynowa pokryła lot i zapas — wielkość
 * zamówienia skupu dla dostawy o czasie `leadSeconds`.
 *
 * `stored + inbound` jest pozycją magazynową. Cel zawiera stały zapas roboczy
 * oraz planowane zużycie przez CAŁY czas dostawy. Poprzedni regulator patrzył
 * wyłącznie na brak do 25% magazynu; dla 29-minutowej trasy Merkury→Ziemia
 * narzucał przez to przepływ mniejszy niż połowa zapotrzebowania Ziemi.
 */
export function buyOrderUnits(book, station, resourceId, leadSeconds = 0) {
  const econ = book.getEconomy(station.id);
  const capacity = Number(econ?.capacity?.[resourceId]);
  if (!(capacity > 0)) return 0;

  const stored = Math.max(0, Number(econ.resources?.[resourceId]) || 0);
  const safetyFill = Math.min(1, Math.max(0,
    Number(book.config.inventorySafetyFill) || 0));
  const leadMargin = Math.max(1, Number(book.config.inboundOvershoot) || 1);
  const demand = plannedDemandPerSecond(book, station, resourceId);
  const lead = Math.max(0, Number(leadSeconds) || 0);
  const due = inboundDueWithin(book, station.id, resourceId, lead);
  // Liczy się zapas przewidywany W CHWILI przybycia kandydata. Późniejszy,
  // daleki kurs nie może blokować pilnej dostawy tylko dlatego, że też jest
  // zapisany jako "inbound". Ujemnego zapasu nie ma — utraconego popytu nie
  // próbujemy fizycznie upchnąć później do magazynu.
  const projectedAtArrival = Math.max(0, stored + due - demand * lead * leadMargin);
  const safety = capacity * safetyFill;
  // Wiele wysyłek z jednego dużego ticku ma praktycznie ten sam ETA. Ich suma
  // nie może przekroczyć pojemności, bo rozładunek jest atomowy i nadmiar
  // przeszedłby w AWAITING_UNLOAD bez aktywnego kursu.
  const pipelineRoom = Math.max(0, capacity - inboundUnits(book, station.id, resourceId));
  return Math.max(0, Math.min(pipelineRoom,
    Math.ceil(safety - projectedAtArrival - 1e-9)));
}

// ---------- notowania (cena) ----------

/**
 * Notowania `resourcePrice` wszystkich czynnych stacji z towarem w drodze i popytem brutto
 * (sztuk/s przy bieżącej skali) — wejście kupców (`findTradeOpportunities`) i licytacji stoczni.
 */
export function postQuotes(book, stations) {
  book.quotes = snapshotMarket(stations, id => book.getEconomy(id), {
    inbound: (stationId, resourceId) => inboundUnits(book, stationId, resourceId),
    // Potrzeba skupu to zużycie BRUTTO, nie saldo planu — patrz `stationConsumptionRates`.
    demandRate: (stationId, resourceId) =>
      Math.max(0, Number(book.useRates.get(String(stationId))?.[resourceId]) || 0)
        * Math.max(0, Number(book.config.economyScale) || 0)
  });
  return book.quotes;
}

/** Przelicza notowanie po transakcji w tym ticku (chudszy nadawca, towar w drodze do odbiorcy). */
export function requote(book, stationId, resourceId, inboundDelta = 0) {
  return refreshQuote(book.quotes, stationId, resourceId, inboundDelta);
}
