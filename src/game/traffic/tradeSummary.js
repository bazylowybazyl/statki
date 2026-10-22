/**
 * KOMPUTER HANDLOWY (E7, docs/BRIEF-ruch-v2.md § 2.3) — agregat z warstwy rekordów: którędy płynie
 * towar, jak gęsto i za ile go kupić albo sprzedać w portach. Nie rysuje statków: liczy się z kursów
 * i notowań, które i tak istnieją, na żądanie gry (`trade-summary`), nie co tick.
 *
 *   routes         trasy z ładunkiem teraz w powietrzu (nadawca → odbiorca): kursy, tony, wartość,
 *                  główny towar; najgęstsze pierwsze
 *   ports          porty: pozycja, frakcja, ruch (kursy wychodzące / przychodzące), najlepsze zakupy
 *                  (oferta sprzedaży, najniższa cena wobec wartości bazowej) i najlepsze sprzedaże
 *                  (skup z miejscem, najwyższa cena wobec wartości)
 *   resources      tony w drodze wg towaru
 *   opportunities  najlepsze okazje handlowe teraz (ten sam rachunek co kupcy, ładownia 380 t)
 */

import { RESOURCES } from '../../data/resources.js';
import { isDerelict } from '../../data/factions.js';
import { getActiveCourses } from './courseRegistry.js';
import { findTradeOpportunities, restockTarget } from './tradeMarket.js';
import { inboundUnits } from './marketBook.js';

const ROUTE_LIMIT = 40;
const PORT_PICKS = 3;
const OPPORTUNITY_LIMIT = 10;

function round(value, digits = 0) {
  const k = 10 ** digits;
  return Math.round((Number(value) || 0) * k) / k;
}

/**
 * Oferta portu dla kupca (gracz, kupcy): `out.sell` — ile sprzeda ponad rezerwę na własne potrzeby
 * (`offerFloor`), `out.buy` — ile skupi do celu uzupełnienia (`restockTarget`) licząc z towarem w drodze;
 * port, który towaru nie używa (`wanted === false`), nie skupuje. `price` — notowanie (`resourcePrice`
 * + `wanted`, `demandRate`, `restockFloor` z `snapshotMarket`). Bez alokacji, gdy podano `out`.
 */
export function portOfferFromQuote(price, inbound = 0, out = { sell: 0, buy: 0 }) {
  out.sell = 0;
  out.buy = 0;
  if (!price) return out;
  const cap = Number(price.capacity) || 0;
  const stored = Math.max(0, Number(price.stored) || 0);
  out.sell = cap > 0 ? Math.max(0, Math.floor(stored - (price.offerFloor || 0) * cap)) : Math.floor(stored);
  if (price.wanted !== false && cap > 0) {
    const coming = Math.max(0, Number(inbound) || 0);
    const room = Math.max(0, Number(price.room) || 0) - coming;
    out.buy = Math.max(0, Math.floor(Math.min(room, restockTarget(price) - (stored + coming))));
  }
  return out;
}

export function summarizeTrade(world) {
  const { registry, director } = world;
  const book = director?.book;
  const routes = new Map();
  const inFlight = {};
  const traffic = new Map();
  const bump = (id, field) => {
    let entry = traffic.get(id);
    if (!entry) traffic.set(id, entry = { out: 0, in: 0 });
    entry[field]++;
  };
  let mining = 0;
  let miningTons = 0;

  for (const course of getActiveCourses(registry)) {
    const payload = course.payload;
    if (!payload) continue;
    if (payload.harvest) {
      mining++;
      for (const amount of Object.values(payload.harvest)) miningTons += Number(amount) || 0;
      continue;
    }
    if (!payload.resourceId || !(payload.units > 0)) continue;
    const from = String(course.originId || '');
    const to = String(payload.targetStationId || course.destinationId || '');
    if (!from || !to) continue;
    bump(from, 'out');
    bump(to, 'in');
    const key = `${from}>${to}`;
    let route = routes.get(key);
    if (!route) routes.set(key, route = { from, to, courses: 0, tons: 0, value: 0, goods: {} });
    const mass = Number(payload.mass) || (RESOURCES[payload.resourceId]?.mass || 1) * payload.units;
    route.courses++;
    route.tons += mass;
    route.value += Number(payload.value) || 0;
    route.goods[payload.resourceId] = (route.goods[payload.resourceId] || 0) + payload.units;
    inFlight[payload.resourceId] = (inFlight[payload.resourceId] || 0) + mass;
  }

  const routeList = [...routes.values()].sort((a, b) => b.tons - a.tons).slice(0, ROUTE_LIMIT).map(route => {
    let main = null;
    for (const [id, units] of Object.entries(route.goods)) {
      const tons = units * (RESOURCES[id]?.mass || 1);
      if (!main || tons > main.tons) main = { id, tons };
    }
    return {
      from: route.from, to: route.to, courses: route.courses,
      tons: round(route.tons), value: round(route.value), main: main?.id || null
    };
  });

  const ports = [];
  for (const station of world.stations) {
    if (!station || isDerelict(station)) continue;
    const quote = book?.quotes?.get(station.id);
    const buys = [];
    const sells = [];
    for (const [id, price] of quote?.prices || []) {
      const value = Number(RESOURCES[id]?.value) || 0;
      if (!(value > 0)) continue;
      const offer = portOfferFromQuote(price, book ? inboundUnits(book, station.id, id) : 0);
      if (offer.sell > 0) buys.push({ id, price: round(price.ask, 1), units: offer.sell, ratio: price.ask / value });
      if (offer.buy > 0) sells.push({ id, price: round(price.bid, 1), units: offer.buy, ratio: price.bid / value });
    }
    buys.sort((a, b) => a.ratio - b.ratio);
    sells.sort((a, b) => b.ratio - a.ratio);
    const strip = list => list.slice(0, PORT_PICKS).map(({ id, price, units, ratio }) => ({ id, price, units, ratio: round(ratio, 2) }));
    const flow = traffic.get(station.id) || { out: 0, in: 0 };
    ports.push({
      id: station.id, name: station.name || station.id, factionId: station.factionId || null,
      x: station.x, y: station.y, out: flow.out, in: flow.in,
      buy: strip(buys), sell: strip(sells)
    });
  }

  const opportunities = book?.quotes?.size
    ? findTradeOpportunities(book.quotes, { holdCapacity: 380, limit: OPPORTUNITY_LIMIT }).map(o => ({
      id: o.resourceId, from: o.source.id, to: o.target.id, units: o.units,
      buy: round(o.buyPrice, 1), sell: round(o.sellPrice, 1), gross: round(o.gross)
    }))
    : [];

  const resources = Object.entries(inFlight).map(([id, tons]) => ({ id, tons: round(tons) }))
    .sort((a, b) => b.tons - a.tons);

  return {
    routes: routeList,
    ports,
    resources,
    opportunities,
    mining: { courses: mining, tons: round(miningTons) },
    totals: {
      courses: routeList.reduce((sum, route) => sum + route.courses, 0),
      routes: routes.size,
      tons: round(Object.values(inFlight).reduce((sum, tons) => sum + tons, 0))
    }
  };
}
