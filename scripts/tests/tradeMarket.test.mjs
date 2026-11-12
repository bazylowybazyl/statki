/**
 * Testy cen lokalnych i wyszukiwania marży.
 *
 * Cena miejscowa jest fundamentem ruchu agentowego: dopóki wszystkie stacje
 * wyceniały towar identycznie, nie było czego arbitrażować i handel mógł być
 * wyłącznie planowaniem niedoborów. Te testy pilnują, żeby różnica cen brała się
 * z tego, czego komu brakuje — a nie z wpisanej tabeli.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import {
  PRICE_MODEL, scarcityMultiplier, factionPriceProfile, resourcePrice
} from '../../src/game/stationEconomy.js';
import {
  snapshotMarket, findTradeOpportunities, netProfit, MIN_MARGIN_RATIO,
  tradableUnits, sellDownToFill, restockTarget, refreshQuote, RESTOCK_SECONDS, RESTOCK_MIN_FILL
} from '../../src/game/traffic/tradeMarket.js';

/** Stacja z jednym surowcem o zadanym zapełnieniu. */
function makeStation(id, factionId, stock = {}, capacity = 1000) {
  const station = { id, name: id, factionId };
  const econ = { resources: { ...stock }, capacity: {} };
  for (const key of Object.keys(RESOURCES)) {
    econ.capacity[key] = capacity;
    if (econ.resources[key] === undefined) econ.resources[key] = 0;
  }
  return { station, econ };
}

export function run() {
  const t = createSuite('tradeMarket');

  // ----------------------------------------------------------
  t.section('Mnożnik niedoboru');

  t.close('pusty magazyn = drogo', scarcityMultiplier(0), PRICE_MODEL.emptyMultiplier);
  t.close('pełny magazyn = tanio', scarcityMultiplier(1), PRICE_MODEL.fullMultiplier);
  t.close('połowa = środek', scarcityMultiplier(0.5),
    (PRICE_MODEL.emptyMultiplier + PRICE_MODEL.fullMultiplier) / 2);
  t.check('cena maleje monotonicznie z zapasem', scarcityMultiplier(0.2) > scarcityMultiplier(0.8));
  t.close('wartości spoza zakresu są przycinane', scarcityMultiplier(5), PRICE_MODEL.fullMultiplier);

  // ----------------------------------------------------------
  t.section('Profil frakcji');

  // Terra Nova żąda rudy żelaza, a dostarcza stal — te tablice były w kodzie
  // od początku z komentarzem „używane przy generowaniu tras handlowych",
  // ale nic ich nie czytało.
  t.check('frakcja dopłaca za to, czego chce',
    factionPriceProfile(FACTION.TERRA_NOVA, 'iron_ore') > 1);
  t.check('i przecenia to, czego ma w bród',
    factionPriceProfile(FACTION.TERRA_NOVA, 'hull_plate') < 1);
  // Rozdzielenie rdzenia dało trzy różne profile cenowe tam, gdzie wcześniej
  // był jeden — dopiero to tworzy spread wewnątrz układu wewnętrznego.
  t.check('Konsorcjum Wewnętrzne przecenia własne rudy',
    factionPriceProfile(FACTION.INNER_CONSORTIUM, 'iron_ore') < 1);
  t.check('a stocznia dopłaca za złom',
    factionPriceProfile(FACTION.MARS, 'scrap') > 1);
  t.equal('surowiec obojętny bez zmiany', factionPriceProfile(FACTION.TERRA_NOVA, 'ice'), 1);
  t.equal('brak frakcji = brak profilu', factionPriceProfile(null, 'iron_ore'), 1);

  // ----------------------------------------------------------
  t.section('Cena na stacji');

  const pelna = makeStation('pelna', FACTION.TERRA_NOVA, { iron_ore: 900 });
  const pusta = makeStation('pusta', FACTION.TERRA_NOVA, { iron_ore: 0 });
  const cenaPelna = resourcePrice(pelna.station, pelna.econ, 'iron_ore');
  const cenaPusta = resourcePrice(pusta.station, pusta.econ, 'iron_ore');

  t.note(`pełna: market ${cenaPelna.market.toFixed(1)} CR, pusta: ${cenaPusta.market.toFixed(1)} CR`);
  t.check('u głodnego drożej niż u sytego', cenaPusta.market > cenaPelna.market);
  t.check('stacja sprzedaje drożej, niż skupuje', cenaPelna.ask > cenaPelna.bid);
  t.check('rozstęp jest niewielki', (cenaPelna.ask - cenaPelna.bid) / cenaPelna.market < 0.2);
  t.check('pełna ma co oddać', cenaPelna.available > 0);
  t.equal('pusta nie ma nic na zbyciu', cenaPusta.available, 0);
  t.check('pusta ma dużo miejsca', cenaPusta.room > 900);
  t.equal('nieznany surowiec bez ceny', resourcePrice(pelna.station, pelna.econ, 'kawa'), null);

  // Reputacja dotyczy WYŁĄCZNIE gracza; przewoźnicy handlują po cenie frakcyjnej.
  const zRep = resourcePrice(pelna.station, pelna.econ, 'iron_ore', {
    reputation: { [FACTION.TERRA_NOVA]: 60 }
  });
  t.check('sojusznik kupuje taniej', zRep.ask < cenaPelna.ask);
  t.equal('cena odniesienia bez zmian', zRep.market, cenaPelna.market);

  // ----------------------------------------------------------
  t.section('Szukanie marży');

  // Skupuje tylko ten, kto towar zużywa — stacja bez przemysłu dostaje popyt
  // wprost, jak stocznia (`extraDemand`).
  pusta.station.extraDemand = ['iron_ore'];
  const stations = [pelna.station, pusta.station];
  const econs = new Map([['pelna', pelna.econ], ['pusta', pusta.econ]]);
  const quotes = snapshotMarket(stations, id => econs.get(id));
  t.equal('notowania obu stacji', quotes.size, 2);

  const okazje = findTradeOpportunities(quotes, { holdCapacity: 380 });
  t.check('znalazł okazję', okazje.length > 0);
  const najlepsza = okazje[0];
  t.equal('kupuje tam, gdzie pełno', najlepsza.source.id, 'pelna');
  t.equal('sprzedaje tam, gdzie pusto', najlepsza.target.id, 'pusta');
  t.check('marża dodatnia', najlepsza.marginPerUnit > 0);
  t.check('powyżej progu opłacalności', najlepsza.marginRatio >= MIN_MARGIN_RATIO);
  t.check('ładunek mieści się w ładowni', najlepsza.mass <= 380 + 1e-6);
  t.note(`${najlepsza.source.id}→${najlepsza.target.id}: ${najlepsza.units} szt., `
    + `marża ${najlepsza.marginPerUnit.toFixed(1)} CR/szt, brutto ${najlepsza.gross.toFixed(0)} CR`);

  // Dwie stacje o tym samym zapasie nie dają arbitrażu — cena bierze się
  // wyłącznie z różnicy, nie z tabeli.
  const bliznA = makeStation('a', FACTION.TERRA_NOVA, { iron_ore: 900 });
  const bliznB = makeStation('b', FACTION.TERRA_NOVA, { iron_ore: 900 });
  const rowne = snapshotMarket([bliznA.station, bliznB.station],
    id => (id === 'a' ? bliznA.econ : bliznB.econ));
  t.equal('równy zapas = brak okazji', findTradeOpportunities(rowne).length, 0);

  // Wrogie frakcje nie handlują wprost.
  const wrog = makeStation('wrog', FACTION.PIRATES, { iron_ore: 0 });
  wrog.station.extraDemand = ['iron_ore'];
  const zWrogiem = snapshotMarket([pelna.station, wrog.station],
    id => (id === 'pelna' ? pelna.econ : wrog.econ));
  t.equal('nie wozimy wprost do wroga', findTradeOpportunities(zWrogiem).length, 0);

  // Pusty magazyn bez popytu to nie odbiorca: kupiec woziłby towar w martwy punkt.
  const obojetna = makeStation('obojetna', FACTION.TERRA_NOVA, { iron_ore: 0 });
  const bezPopytu = snapshotMarket([pelna.station, obojetna.station],
    id => (id === 'pelna' ? pelna.econ : obojetna.econ));
  t.equal('stacja, która towaru nie zużywa, nie skupuje', findTradeOpportunities(bezPopytu).length, 0);

  // ----------------------------------------------------------
  t.section('Cena rezerwacji producenta');

  // Producent z zapasem 50% — poniżej dawnego progu nadwyżki 70% — sam używa
  // rudy. Głodny odbiorca z długim przyduszeniem przebija jego cenę, więc
  // producent sprzedaje, choć planista frakcji nic by nie wystawił.
  const producent = makeStation('producent', FACTION.TERRA_NOVA, { iron_ore: 500 });
  producent.station.extraDemand = ['iron_ore'];
  const glodny = makeStation('glodny', FACTION.TERRA_NOVA, { iron_ore: 0 });
  glodny.station.extraDemand = ['iron_ore'];
  glodny.econ.duress = { iron_ore: 7200 };
  const rynekRez = snapshotMarket([producent.station, glodny.station],
    id => (id === 'producent' ? producent.econ : glodny.econ),
    { demandRate: id => (id === 'glodny' ? 0.1 : 0) });
  const askP = rynekRez.get('producent').prices.get('iron_ore');
  const bidG = rynekRez.get('glodny').prices.get('iron_ore');
  t.equal('poniżej 70% planista nie ma nadwyżki', askP.available, 0);
  const ile = tradableUnits(askP, bidG);
  t.check('a rynek kupców ma — skup przebija cenę rezerwacji', ile.offered > 0);
  t.check('producent nie schodzi poniżej zapasu roboczego',
    askP.stored - ile.offered >= askP.capacity * PRICE_MODEL.offerFloorFill - 1e-6);
  t.check('niższa oferta skupu wyciąga mniej towaru',
    sellDownToFill(askP, 9) > sellDownToFill(askP, 12));
  t.close('potrzeba odbiorcy to zużycie na RESTOCK_SECONDS plus podłoga',
    restockTarget(bidG), 0.1 * RESTOCK_SECONDS + bidG.capacity * RESTOCK_MIN_FILL);
  t.check('skup nie przekracza potrzeby odbiorcy', ile.room <= restockTarget(bidG) + 1e-6);
  const okazjeRez = findTradeOpportunities(rynekRez, { holdCapacity: 380 });
  t.check('okazja producent→głodny istnieje',
    okazjeRez.some(o => o.source.id === 'producent' && o.target.id === 'glodny'));
  // Kupiec w tym samym ticku widzi już skutki poprzedniej transakcji.
  producent.econ.resources.iron_ore -= 50;
  refreshQuote(rynekRez, 'producent', 'iron_ore');
  const poZakupie = refreshQuote(rynekRez, 'glodny', 'iron_ore', 50);
  t.equal('towar w drodze trafia do notowania odbiorcy', poZakupie.inbound, 50);
  t.check('i zmniejsza dalszy skup', tradableUnits(rynekRez.get('producent').prices.get('iron_ore'),
    poZakupie).room < ile.room);

  // ----------------------------------------------------------
  t.section('Zysk netto — marża to nie wszystko');

  const tania = { cost: { total: 50 }, interceptChance: 0.02, seconds: 600 };
  const droga = { cost: { total: 5000 }, interceptChance: 0.02, seconds: 600 };
  const grozna = { cost: { total: 50 }, interceptChance: 0.9, seconds: 600 };

  const dobra = netProfit(najlepsza, tania);
  t.check('tania i bezpieczna trasa się opłaca', dobra.worth);
  t.check('koszt trasy zjada zysk', !netProfit(najlepsza, droga).worth);
  // Przy przechwycie przepada nie tylko marża, ale i towar, za który zapłacono.
  t.check('ryzyko zjada zysk', !netProfit(najlepsza, grozna).worth);
  t.check('oczekiwana strata rośnie z ryzykiem',
    netProfit(najlepsza, grozna).expectedLoss > netProfit(najlepsza, tania).expectedLoss);
  t.check('zysk na sekundę porównuje kursy o różnej długości',
    Math.abs(dobra.perSecond - dobra.net / 600) < 1e-9);
  t.equal('brak trasy = brak wyceny', netProfit(najlepsza, null), null);

  return t.results;
}

runIfMain(import.meta.url, run);
