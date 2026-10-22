/**
 * RYNEK — gdzie jest marża.
 *
 * Dyspozytor frakcyjny (`trafficDirector`) jest PLANISTĄ: przesuwa towar tam,
 * gdzie go brakuje, i cena go nie obchodzi. Ten moduł robi coś dokładnie
 * odwrotnego — nie interesuje go, czego komu brakuje, tylko gdzie kupić tanio
 * i sprzedać drogo.
 *
 * To są dwa różne algorytmy dające dwa różne obrazy nieba, i mają istnieć obok
 * siebie: ruch frakcyjny jest gęsty, przewidywalny i wozi masówkę po rdzeniu;
 * ruch agentowy jest rzadki, oportunistyczny, wozi drobnicę i zapuszcza się
 * tam, gdzie inni nie chcą — bo tam właśnie płacą najwięcej.
 *
 * Skutek uboczny jest cenny dla piractwa: tłustymi celami stają się agenci,
 * którzy w niebezpieczne rejony wchodzą Z WYBORU, licząc na marżę.
 */

import { RESOURCES, RESOURCE_KEYS } from '../../data/resources.js';
import {
  resourcePrice, stationWantsResource, fillForScarcity, PRICE_MODEL
} from '../stationEconomy.js';
import { isDerelict, areFactionsHostile } from '../../data/factions.js';

/** Minimalna marża w procentach, poniżej której nie warto ruszać się z portu. */
export const MIN_MARGIN_RATIO = 0.12;

/** Notowanie jednego surowca z dopisanym towarem w drodze i popytem stacji. */
function quoteOf(station, econ, resourceId, inbound, demandRate) {
  const price = resourcePrice(station, econ, resourceId);
  if (!price) return null;
  price.inbound = Math.max(0, Number(inbound) || 0);
  /** Planowe zużycie stacji, sztuk na sekundę gry — od niego zależy, ile skupuje. */
  price.demandRate = Math.max(0, Number(demandRate) || 0);
  /** Dolny próg skupu w sztukach — stocznia chce kilka porcji na budowę (`restockFloor`). */
  price.restockFloor = Math.max(0, Number(station?.restockFloor?.[resourceId]) || 0);
  // Skup liczy się tylko u tego, kto towaru UŻYWA. Pusty magazyn księżyca
  // bez stoczni wycenia płyty kadłuba na 1,7× bazy, ale nikt ich tam nie zje —
  // kupiec woziłby towar w martwy punkt.
  price.wanted = stationWantsResource(station, resourceId);
  return price;
}

/**
 * Zbiera notowania wszystkich czynnych stacji.
 *
 * Liczone raz i podawane dalej, bo agent porównuje każdą parę stacji — bez
 * migawki byłoby to `stacje² × surowce` wywołań wyceny na każdą decyzję.
 *
 * `options.inbound(stationId, resourceId)` — ile już leci do stacji. Bez tego
 * każdy kupiec w tym samym ticku widzi ten sam pusty magazyn i wszyscy wiozą
 * tam naraz, aż rozładunek ucina nadmiar.
 * `options.demandRate(stationId, resourceId)` — planowe zużycie, sztuk/s.
 */
export function snapshotMarket(stations, getEconomy, options = {}) {
  const resources = options.resources || RESOURCE_KEYS;
  const inbound = typeof options.inbound === 'function' ? options.inbound : null;
  const demandRate = typeof options.demandRate === 'function' ? options.demandRate : null;
  const quotes = new Map();

  for (const station of stations) {
    if (!station || isDerelict(station)) continue;
    const econ = getEconomy(station.id);
    if (!econ) continue;
    const byResource = new Map();
    for (const resourceId of resources) {
      const price = quoteOf(station, econ, resourceId,
        inbound ? inbound(station.id, resourceId) : 0,
        demandRate ? demandRate(station.id, resourceId) : 0);
      if (price) byResource.set(resourceId, price);
    }
    quotes.set(station.id, { station, econ, prices: byResource });
  }
  return quotes;
}

/**
 * Przelicza jedno notowanie po transakcji w tym samym ticku: magazyn nadawcy
 * już schudł, a do odbiorcy doszedł towar w drodze.
 */
export function refreshQuote(quotes, stationId, resourceId, inboundDelta = 0) {
  const quote = quotes?.get(stationId);
  const old = quote?.prices.get(resourceId);
  if (!quote?.econ || !old) return null;
  const price = quoteOf(quote.station, quote.econ, resourceId,
    (old.inbound || 0) + (Number(inboundDelta) || 0), old.demandRate);
  if (price) quote.prices.set(resourceId, price);
  return price;
}

/**
 * Do jakiego zapełnienia producent sprzedaje, gdy kupiec płaci `bidPrice`.
 *
 * Cena rezerwacji producenta to jego własna cena żądania przy zapasie PO
 * sprzedaży. Sprzedaje tak długo, jak skup przebija ją o marżę — więc głodna
 * stocznia (przyduszenie ×2,6) wyciąga towar aż do zapasu roboczego, a stacja
 * zaledwie chudsza od nadawcy nie wyciągnie nic. Pierwszeństwa własnej stoczni
 * nie ma: jest tylko to, kto płaci więcej.
 */
export function sellDownToFill(ask, bidPrice, minRatio = MIN_MARGIN_RATIO) {
  const unitAsk = (ask.unitMarket || 0) * (1 + PRICE_MODEL.spread / 2);
  if (!(unitAsk > 0)) return 1;
  const fill = fillForScarcity(bidPrice / ((1 + minRatio) * unitAsk));
  return Math.max(ask.offerFloor || 0, fill);
}

/**
 * Do jakiego zapełnienia odbiorca skupuje, gdy nadawca żąda `askPrice` —
 * licząc z towarem już w drodze. Lustro `sellDownToFill`.
 */
export function buyUpToFill(bid, askPrice, minRatio = MIN_MARGIN_RATIO) {
  // Krzywa BEZ przyduszenia. Przyduszenie podnosi cenę — to ono ściąga
  // kupców — ale nie zwiększa potrzeby: z nim w krzywej głodna stocznia
  // skupowała do ~97% magazynu.
  const duress = Math.max(1, Number(bid.duress) || 1);
  const unitBid = (bid.unitMarket || 0) / duress * (1 - PRICE_MODEL.spread / 2);
  if (!(unitBid > 0)) return 0;
  return fillForScarcity(askPrice * (1 + minRatio) / unitBid);
}

/**
 * Na ile sekund planowego zużycia stacja skupuje towar od kupców.
 *
 * Ułamek magazynu nie nadaje się na miarę potrzeby, bo magazyny różnych
 * towarów obracają się w zupełnie innym tempie: przy gospodarce ×60
 * i halach ×4 magazyn rudy Ziemi to ~1,3 h jej zużycia, a magazyn płyt
 * kadłuba stoczni Merkurego — ~24 h. Liczone od pojemności, głodna stocznia
 * skupowała tysiące najdroższych podzespołów, zanim kupiec spojrzał na płyty.
 */
export const RESTOCK_SECONDS = 7200;
/** Najmniejszy zapas, do którego stacja skupuje towar bez planowego zużycia. */
export const RESTOCK_MIN_FILL = 0.02;

/**
 * Do ilu sztuk (z towarem w drodze) stacja skupuje, zanim zabraknie jej potrzeby.
 *
 * Nie mniej niż `restockFloor` stacji: stocznia zużywa podzespół PORCJAMI
 * (krążownik bierze dwa napędy ciężkie naraz), a dla rzadkich towarów dwie
 * godziny planowego zużycia to mniej niż jedna porcja — stocznia schodziła
 * wtedy do zera po każdej stępce i czekała na kupca (Westa, Uran: do 40 min).
 */
export function restockTarget(bid) {
  const cap = Math.max(0, Number(bid.capacity) || 0);
  const byRate = (bid.demandRate || 0) * RESTOCK_SECONDS + cap * RESTOCK_MIN_FILL;
  return Math.min(cap, Math.max(byRate, Number(bid.restockFloor) || 0));
}

/**
 * Ile sztuk przejdzie między parą notowań przy marży `minRatio`. Dla notowań
 * bez składników krzywej (stare testy, ręczne migawki) — dawne `available`
 * i `room`.
 */
export function tradableUnits(ask, bid, minRatio = MIN_MARGIN_RATIO) {
  let offered = ask.available;
  if (Number.isFinite(ask.stored) && ask.capacity > 0) {
    offered = ask.stored - sellDownToFill(ask, bid.bid, minRatio) * ask.capacity;
  }
  let room = bid.room - (bid.inbound || 0);
  if (Number.isFinite(bid.stored) && bid.capacity > 0) {
    // Przyduszona stacja skupuje do pełnej potrzeby niezależnie od ceny
    // nadawcy — płaci dopłatą za głód. Pozostałe tyle, ile każe krzywa, ale
    // nie ponad potrzebę.
    const position = bid.stored + (bid.inbound || 0);
    const target = restockTarget(bid);
    const limit = (bid.duress || 1) > 1
      ? target
      : Math.min(target, buyUpToFill(bid, ask.ask, minRatio) * bid.capacity);
    room = Math.min(room, limit - position);
  }
  return { offered: Math.max(0, offered), room: Math.max(0, room) };
}

/**
 * Szuka najlepszych okazji handlowych.
 *
 * Marża to `bid` u odbiorcy minus `ask` u nadawcy — czyli to, co zostaje po
 * rozstępie obu portów. Filtr `MIN_MARGIN_RATIO` odcina okazje, które zjada
 * paliwo; ostateczną decyzję i tak podejmuje agent, bo tylko on zna koszt
 * SWOJEJ trasy i ryzyko, jakie jest gotów przyjąć.
 *
 * Zwraca listę posortowaną po zysku na kurs, nie po marży procentowej —
 * 5% na tysiącu ton bije 60% na dwóch sztukach.
 */
export function findTradeOpportunities(quotes, options = {}) {
  const holdCapacity = Math.max(1, Number(options.holdCapacity) || 160);
  const minRatio = Number.isFinite(options.minMargin) ? options.minMargin : MIN_MARGIN_RATIO;
  const limit = Math.max(1, Math.floor(options.limit || 12));
  // Ograniczenie do wskazanych portów nadania. Bez niego lista jest globalnym
  // topem po zysku brutto — te same kilkanaście tłustych par dla wszystkich —
  // i kupiec stojący gdzie indziej NIGDY nie widzi okazji u siebie pod nosem.
  const sourceIds = options.sourceIds ? new Set([...options.sourceIds].map(String)) : null;
  const out = [];

  for (const [sourceId, source] of quotes) {
    if (sourceIds && !sourceIds.has(String(sourceId))) continue;
    for (const [targetId, target] of quotes) {
      if (sourceId === targetId) continue;
      // Nikt nie wozi towaru wprost do frakcji, z którą jest w stanie wojny.
      if (areFactionsHostile(source.station.factionId, target.station.factionId)) continue;

      for (const [resourceId, ask] of source.prices) {
        const bid = target.prices.get(resourceId);
        if (!bid || bid.wanted === false) continue;

        const marginPerUnit = bid.bid - ask.ask;
        if (marginPerUnit <= 0) continue;
        if (marginPerUnit / Math.max(ask.ask, 1e-6) < minRatio) continue;

        // Ile przejdzie, zanim ceny obu stron zejdą się na marżę — a nie
        // „nadwyżka ponad 70%”, której producent ze stocznią nigdy nie miał.
        const { offered, room } = tradableUnits(ask, bid, minRatio);
        if (offered <= 0 || room <= 0) continue;

        const def = RESOURCES[resourceId];
        const byHold = Math.floor(holdCapacity / Math.max(def.mass, 1e-6));
        const units = Math.floor(Math.min(offered, room, byHold));
        if (units <= 0) continue;

        out.push({
          resourceId,
          source: source.station,
          target: target.station,
          units,
          mass: units * def.mass,
          buyPrice: ask.ask,
          sellPrice: bid.bid,
          marginPerUnit,
          marginRatio: marginPerUnit / ask.ask,
          /** Zysk brutto z kursu, PRZED kosztem trasy i ryzykiem. */
          gross: marginPerUnit * units
        });
      }
    }
  }

  out.sort((a, b) => b.gross - a.gross);
  return out.slice(0, limit);
}

/**
 * Czy okazja przetrwa zderzenie z rzeczywistością.
 *
 * Sama marża nic nie znaczy — kurs kosztuje paliwo, opłaty i czas, a na trasie
 * można stracić cały ładunek. To jest ta sama funkcja kosztu, którą wybiera się
 * napęd, tylko po drugiej stronie: tam minimalizujemy koszt dostarczenia,
 * tutaj maksymalizujemy to, co zostaje.
 */
export function netProfit(opportunity, route, options = {}) {
  if (!opportunity || !route) return null;
  // `extraCost` to wydatek spoza trasy — dziś opłacenie eskorty. `risk`
  // i `lossShare` pozwalają wołającemu podstawić SWOJE ryzyko zamiast ryzyka
  // samotnego statku: karawana z osłoną jest trudniejsza do złapania i traci
  // przy przechwycie tylko część składu, nie wszystko.
  const cost = (route.cost?.total ?? 0) + Math.max(0, Number(options.extraCost) || 0);
  const risk = Number.isFinite(options.risk) ? options.risk : (route.interceptChance ?? 0);
  const lossShare = Number.isFinite(options.lossShare)
    ? Math.max(0, Math.min(1, options.lossShare))
    : 1;
  // Przy przechwycie przepada nie tylko marża, ale i towar, za który zapłacono.
  const stake = opportunity.buyPrice * opportunity.units;
  const expectedLoss = risk * lossShare * (stake + opportunity.gross);
  const net = opportunity.gross - cost - expectedLoss;

  return {
    gross: opportunity.gross,
    routeCost: cost,
    lossShare,
    expectedLoss,
    net,
    risk,
    /** Zysk na sekundę — porównuje kursy o różnej długości. */
    perSecond: route.seconds > 0 ? net / route.seconds : net,
    worth: net > (Number(options.minProfit) || 0)
  };
}
