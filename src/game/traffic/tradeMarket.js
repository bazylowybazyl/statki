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
import { resourcePrice } from '../stationEconomy.js';
import { isDerelict, areFactionsHostile } from '../../data/factions.js';

/** Minimalna marża w procentach, poniżej której nie warto ruszać się z portu. */
export const MIN_MARGIN_RATIO = 0.12;

/**
 * Zbiera notowania wszystkich czynnych stacji.
 *
 * Liczone raz i podawane dalej, bo agent porównuje każdą parę stacji — bez
 * migawki byłoby to `stacje² × surowce` wywołań wyceny na każdą decyzję.
 */
export function snapshotMarket(stations, getEconomy, options = {}) {
  const resources = options.resources || RESOURCE_KEYS;
  const quotes = new Map();

  for (const station of stations) {
    if (!station || isDerelict(station)) continue;
    const econ = getEconomy(station.id);
    if (!econ) continue;
    const byResource = new Map();
    for (const resourceId of resources) {
      const price = resourcePrice(station, econ, resourceId);
      if (price) byResource.set(resourceId, price);
    }
    quotes.set(station.id, { station, prices: byResource });
  }
  return quotes;
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
  const out = [];

  for (const [sourceId, source] of quotes) {
    for (const [targetId, target] of quotes) {
      if (sourceId === targetId) continue;
      // Nikt nie wozi towaru wprost do frakcji, z którą jest w stanie wojny.
      if (areFactionsHostile(source.station.factionId, target.station.factionId)) continue;

      for (const [resourceId, ask] of source.prices) {
        if (ask.available <= 0) continue;
        const bid = target.prices.get(resourceId);
        if (!bid || bid.room <= 0) continue;

        const marginPerUnit = bid.bid - ask.ask;
        if (marginPerUnit <= 0) continue;
        if (marginPerUnit / Math.max(ask.ask, 1e-6) < minRatio) continue;

        const def = RESOURCES[resourceId];
        const byHold = Math.floor(holdCapacity / Math.max(def.mass, 1e-6));
        const units = Math.floor(Math.min(ask.available, bid.room, byHold));
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
  const cost = route.cost?.total ?? 0;
  const risk = route.interceptChance ?? 0;
  // Przy przechwycie przepada nie tylko marża, ale i towar, za który zapłacono.
  const stake = opportunity.buyPrice * opportunity.units;
  const expectedLoss = risk * (stake + opportunity.gross);
  const net = opportunity.gross - cost - expectedLoss;

  return {
    gross: opportunity.gross,
    routeCost: cost,
    expectedLoss,
    net,
    risk,
    /** Zysk na sekundę — porównuje kursy o różnej długości. */
    perSecond: route.seconds > 0 ? net / route.seconds : net,
    worth: net > (Number(options.minProfit) || 0)
  };
}
