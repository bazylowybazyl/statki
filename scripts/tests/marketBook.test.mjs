/**
 * API rynku (`src/game/traffic/marketBook.js`, `marketStock.js`): zapas, popyt konsumentów spoza
 * receptur, rezerwacje towaru w drodze, oferty sprzedaży i zamówienia skupu.
 *
 * Pilnuje, że wszyscy uczestnicy rynku (planista, kupcy, gracz, stocznie, wojna, złomiarze,
 * paser) zmieniają magazyn tymi samymi regułami i że nowy konsument zgłoszony przez
 * `declareDemand` od razu pojawia się w skupie — bez kodu planisty.
 */

import {
  stockOf, takeStock, putStock, moveStock, declareDemand, createMarketBook, openMarket,
  reserveInbound, inboundUnits, inboundDueWithin, hasSellOffer, sellOfferUnits, takeSellOffer,
  buyOrderUnits, postQuotes, requote
} from '../../src/game/traffic/marketBook.js';
import { SHIPMENT_STATUS } from '../../src/game/traffic/shipmentOrders.js';
import { stationWantsResource } from '../../src/game/stationEconomy.js';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import { createSuite, runIfMain } from './harness.mjs';

function makeEcon(resources = {}, capacity = 1000) {
  const econ = { resources: {}, capacity: {} };
  for (const id of RESOURCE_KEYS) {
    econ.resources[id] = resources[id] || 0;
    econ.capacity[id] = capacity;
  }
  return econ;
}

export function run() {
  const t = createSuite('marketBook');

  t.section('1. Zapas: jedne reguły przyjęcia i wydania');
  const econ = { resources: { steel: 50 }, capacity: { steel: 100 } };
  t.equal('wydanie zwraca, ile zeszło', takeStock(econ, 'steel', 20), 20);
  t.equal('magazyn schudł', stockOf(econ, 'steel'), 30);
  t.equal('wydanie ponad zapas bierze tylko to, co jest', takeStock(econ, 'steel', 80), 30);
  t.equal('magazyn nie schodzi poniżej zera', stockOf(econ, 'steel'), 0);
  t.equal('przyjęcie do pojemności', putStock(econ, 'steel', 150), 100);
  t.equal('nadmiar ponad magazyn nie wchodzi', stockOf(econ, 'steel'), 100);
  const bezLimitu = { resources: { steel: 5 }, capacity: { steel: 0 } };
  t.equal('pojemność 0 = bez limitu', putStock(bezLimitu, 'steel', 1e6), 1e6);
  t.equal('moveStock: ujemna zmiana to wydanie', moveStock(econ, 'steel', -40), -40);
  t.equal('moveStock: dodatnia to przyjęcie', moveStock(econ, 'steel', 10), 10);
  t.equal('bez magazynu nic się nie dzieje', putStock(null, 'steel', 5), 0);

  t.section('2. Popyt konsumenta spoza receptur');
  const port = { id: 'port-x', factionId: FACTION.TERRA_NOVA };
  t.check('bez zgłoszenia stacja bez przemysłu nie chce podzespołu', !stationWantsResource(port, 'hull_plate'));
  declareDemand(port, 'hull_plate', { floor: 12 });
  declareDemand(port, 'hull_plate', { floor: 4 });
  t.check('po zgłoszeniu skup widzi towar', stationWantsResource(port, 'hull_plate'));
  t.equal('zgłoszenie jest idempotentne', port.extraDemand.filter(id => id === 'hull_plate').length, 1);
  t.equal('większa porcja wygrywa', port.restockFloor.hull_plate, 12);

  t.section('3. Rezerwacje towaru w drodze');
  const stations = [
    { id: 'a', factionId: FACTION.TERRA_NOVA, extraDemand: ['steel'] },
    { id: 'b', factionId: FACTION.TERRA_NOVA, extraDemand: ['steel'] }
  ];
  const economies = { a: makeEcon({ steel: 900 }), b: makeEcon({ steel: 0 }) };
  const book = createMarketBook({
    config: { economyScale: 1, inventorySafetyFill: 0.25, inboundOvershoot: 1.15 },
    getEconomy: id => economies[id] || null
  });
  const courses = [
    { destinationId: 'b', remaining: 100, payload: { resourceId: 'steel', units: 40 } },
    { destinationId: 'a', remaining: 50, payload: { targetStationId: 'b', harvest: { steel: 10 } } }
  ];
  const orders = [
    { status: SHIPMENT_STATUS.AWAITING_UNLOAD, targetStationId: 'b', cargo: { steel: 5 } },
    { status: SHIPMENT_STATUS.DELIVERED, targetStationId: 'b', cargo: { steel: 99 } }
  ];
  openMarket(book, stations, { courses, orders, withQuotes: true });
  t.equal('kursy, urobek i czekający rozładunek są w drodze', inboundUnits(book, 'b', 'steel'), 55);
  t.equal('w ciągu 60 s dotrze urobek i rozładunek', inboundDueWithin(book, 'b', 'steel', 60), 15);
  reserveInbound(book, 'b', 'steel', 20, 30);
  t.equal('nowa transakcja w tym ticku rezerwuje od razu', inboundUnits(book, 'b', 'steel'), 75);

  t.section('4. Oferty sprzedaży i zamówienia skupu');
  t.check('pełny magazyn wystawia ofertę sprzedaży', hasSellOffer(book, 'steel'));
  const spare = sellOfferUnits(book, 'a', 'steel');
  t.check('oferta to zapas ponad rezerwę producenta', spare > 0 && spare < 900);
  takeSellOffer(book, book.sellers.get('a'), 'steel', 50);
  t.equal('transakcja zdejmuje towar z oferty', sellOfferUnits(book, 'a', 'steel'), spare - 50);
  const pilny = book.buyers.find(entry => entry.station.id === 'b' && entry.id === 'steel');
  t.check('pusty magazyn ma zamówienie skupu poniżej zapasu roboczego', !!pilny && pilny.belowSafety);
  t.equal('pierwsze zamówienie stali to najpustszy odbiorca', book.buyers.find(entry => entry.id === 'steel')?.station.id, 'b');
  const zamowienie = buyOrderUnits(book, stations[1], 'steel', 0);
  // Dostawa „od ręki” (0 s): liczy się tylko to, co dotrze do tego czasu — czekający rozładunek (5).
  t.equal('zamówienie pokrywa zapas roboczy minus to, co dotrze przed dostawą', zamowienie, 245);
  // Za 60 s dotrze też urobek i rezerwacja z tego ticku (35), ale stacja przez ten czas zużywa stal.
  const za60 = buyOrderUnits(book, stations[1], 'steel', 60);
  t.check('dostawa za 60 s liczy towar, który dotrze wcześniej', za60 < zamowienie && za60 >= 215);
  t.equal('notowania z otwarcia rynku mają towar w drodze', book.quotes.get('b')?.prices.get('steel')?.inbound, 55);
  t.check('notowanie ma cenę', book.quotes.get('b').prices.get('steel').bid > 0);
  const przed = book.quotes.get('b').prices.get('steel').inbound;
  requote(book, 'b', 'steel', 10);
  t.equal('notowanie po transakcji widzi więcej w drodze', book.quotes.get('b').prices.get('steel').inbound, przed + 10);
  t.check('postQuotes przelicza od nowa', postQuotes(book, stations).get('b').prices.get('steel').inbound === 75);

  return t.results;
}

runIfMain(import.meta.url, run);
