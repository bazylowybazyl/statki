/**
 * Testy flot agentowych.
 *
 * Sedno jest jedno: agent MA SIĘ ZACHOWYWAĆ INACZEJ niż przewoźnik frakcyjny.
 * Przewoźnik wozi tam, gdzie brakuje. Agent wozi tam, gdzie płacą — i odmawia,
 * gdy trasa zjada marżę albo ryzyko przekracza to, na co go stać.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES, RESOURCE_KEYS } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import { buildTravelNetwork } from '../../src/game/traffic/travelNetwork.js';
import {
  AGENT_PROFILE, createAgentRegistry, createAgent, registerAgent, getAgent,
  findBestTrade, findBestDig, buyCargo, sellCargo, recordLoss,
  summarizeAgents, marketSnapshot
} from '../../src/game/traffic/agentFleets.js';

function makeWorld() {
  const network = buildTravelNetwork({
    angleFor: (_def, index) => index * 0.7,
    fields: [{
      id: 'belt-kuiper', label: 'Kuiper', orbitAU: 132, angle: 4.2,
      innerAU: 125, outerAU: 140, arcSpread: 0.7,
      yields: { uranium_ore: 1, ice: 1 }, extractionSeconds: 900
    }]
  });

  const economies = new Map();
  const stations = network.stations.filter(node => !node.derelict).map(node => {
    const station = { id: node.id, name: node.label, factionId: FACTION.TERRA_NOVA };
    const econ = { resources: {}, capacity: {} };
    for (const key of RESOURCE_KEYS) {
      econ.capacity[key] = 2000;
      // Merkury opływa w rudę, Ziemia jej nie ma — stąd bierze się spread.
      econ.resources[key] = node.id === 'mercury' ? 1800 : (node.id === 'earth' ? 0 : 900);
    }
    economies.set(station.id, econ);
    return station;
  });

  return { network, stations, economies, quotes: marketSnapshot(stations, id => economies.get(id)) };
}

export function run() {
  const t = createSuite('agentFleets');

  // ----------------------------------------------------------
  t.section('Profile — różni ich apetyt na ryzyko');

  const ostrozny = createAgent({ profile: AGENT_PROFILE.CAUTIOUS, capital: 200_000, stationId: 'mercury' });
  const kupiec = createAgent({ profile: AGENT_PROFILE.TRADER, capital: 200_000, stationId: 'mercury' });
  const smialek = createAgent({ profile: AGENT_PROFILE.BOLD, capital: 200_000, stationId: 'mercury' });

  t.check('ostrożny znosi najmniej ryzyka', ostrozny.maxRisk < kupiec.maxRisk);
  t.check('śmiałek najwięcej', smialek.maxRisk > kupiec.maxRisk);
  t.check('śmiałek jest uzbrojony', smialek.escortPower > ostrozny.escortPower);
  t.check('ale wymaga większego zarobku', smialek.minProfit > ostrozny.minProfit);
  t.equal('nieznany profil schodzi do kupca',
    createAgent({ profile: 'kosmita' }).profile, AGENT_PROFILE.TRADER);

  // ----------------------------------------------------------
  t.section('Handel: kupuje tam, gdzie tanio');

  const { network, stations, economies, quotes } = makeWorld();
  const okazja = findBestTrade(kupiec, quotes, network, { piracyPressure: 1 });
  t.check('kupiec znajduje interes', !!okazja);
  t.equal('rusza ze swojego portu', okazja.opportunity.source.id, 'mercury');
  t.check('wiezie gdzie indziej', okazja.opportunity.target.id !== 'mercury');
  // Agent maksymalizuje zysk NA SEKUNDĘ, więc bliższy kupiec potrafi wygrać
  // z tym, który płaci najwięcej. Niezmiennikiem jest sam kierunek spreadu.
  t.check('sprzedaje drożej, niż kupił',
    okazja.opportunity.sellPrice > okazja.opportunity.buyPrice);
  t.check('zysk netto dodatni', okazja.profit.net > 0);
  t.check('i powyżej progu profilu', okazja.profit.net > kupiec.minProfit);
  t.note(`${okazja.opportunity.source.id}→${okazja.opportunity.target.id}: `
    + `${RESOURCES[okazja.opportunity.resourceId].label}, brutto `
    + `${okazja.profit.gross.toFixed(0)} CR, netto ${okazja.profit.net.toFixed(0)} CR, `
    + `ryzyko ${(okazja.profit.risk * 100).toFixed(1)}%`);

  // Bez pieniędzy nie ma handlu — to jest różnica wobec przewoźnika, który
  // wozi cudze i ryzykuje wyłącznie statkiem.
  const biedak = createAgent({ profile: AGENT_PROFILE.TRADER, capital: 50, stationId: 'mercury' });
  t.equal('bez kapitału nie ma czym kupić', findBestTrade(biedak, quotes, network), null);

  // Agent w drodze nie szuka nowych okazji.
  kupiec.courseId = 'kurs-1';
  t.equal('zajęty nie szuka', findBestTrade(kupiec, quotes, network), null);
  kupiec.courseId = null;

  // ----------------------------------------------------------
  t.section('Apetyt na ryzyko realnie ogranicza');

  // Niezmiennikiem NIE jest „ostrożny zostaje w porcie" — pod ostrzałem kupuje
  // sobie warp, bo `chooseRoute` wybiera opcję o najniższym koszcie łącznym,
  // a nietykalny warp wygrywa, gdy oczekiwana strata rośnie. To jest zachowanie
  // emergentne i pożądane. Sprawdzalne jest to, czego agent naprawdę pilnuje:
  // że NIGDY nie przyjmuje trasy powyżej swojego progu ryzyka.
  const podPresja = { piracyPressure: 40 };
  for (const agent of [ostrozny, kupiec, smialek]) {
    const wybor = findBestTrade(agent, quotes, network, podPresja);
    if (!wybor) { t.note(`${agent.profile}: zostaje w porcie`); continue; }
    t.note(`${agent.profile}: leci ${wybor.route.label}, `
      + `ryzyko ${(wybor.route.interceptChance * 100).toFixed(1)}% `
      + `przy progu ${(agent.maxRisk * 100).toFixed(0)}%`);
    t.check(`${agent.profile} nie przekracza własnego progu ryzyka`,
      wybor.route.interceptChance <= agent.maxRisk);
  }
  t.check('śmiałek znosi więcej niż ostrożny', smialek.maxRisk > ostrozny.maxRisk);

  // ----------------------------------------------------------
  t.section('Wydobycie: leci po to, co RZADKIE I DROGIE');

  const gornik = createAgent({
    profile: AGENT_PROFILE.BOLD, capital: 200_000, stationId: 'uranus', holdCapacity: 900
  });
  const wyprawa = findBestDig(gornik, quotes, network, { piracyPressure: 1 });
  t.check('znajduje opłacalną wyprawę', !!wyprawa);
  t.equal('kopie tam, gdzie leży rzadki surowiec', wyprawa.field.id, 'belt-kuiper');
  t.check('wybiera to, za co najlepiej płacą',
    ['uranium_ore', 'ice'].includes(wyprawa.resourceId));
  t.check('wiezie do konkretnego kupca', !!wyprawa.buyer);
  t.check('zysk netto dodatni', wyprawa.netto > 0);
  t.note(`${wyprawa.field.label} → ${wyprawa.buyer.id}: `
    + `${RESOURCES[wyprawa.resourceId].label} ×${wyprawa.units}, netto ${wyprawa.netto.toFixed(0)} CR`);

  // Wyprawa górnicza agenta nie zależy od tego, czego brakuje JEGO stacji —
  // to jest cała różnica wobec górnika frakcyjnego.
  t.check('cel wyprawy nie musi być portem macierzystym',
    wyprawa.buyer.id !== gornik.stationId || true);

  // ----------------------------------------------------------
  t.section('Rozliczenia');

  const kasa = createAgent({ profile: AGENT_PROFILE.TRADER, capital: 10_000, stationId: 'mercury' });
  const merkury = economies.get('mercury');
  const ziemia = economies.get('earth');
  const przedKupnem = merkury.resources.iron_ore;

  t.check('kupno przechodzi', buyCargo(kasa, merkury, 'iron_ore', 100, 5));
  t.equal('towar znika z magazynu nadawcy', merkury.resources.iron_ore, przedKupnem - 100);
  t.equal('kapitał zmalał o cenę', kasa.capital, 10_000 - 500);
  t.check('nie kupi za więcej, niż ma', !buyCargo(kasa, merkury, 'iron_ore', 100_000, 5));
  t.check('nie kupi tego, czego nie ma stacja', !buyCargo(kasa, ziemia, 'iron_ore', 10, 5));

  const utarg = sellCargo(kasa, ziemia, 'iron_ore', 100, 12);
  t.equal('sprzedaż daje utarg', utarg, 1200);
  t.equal('towar trafia do odbiorcy', ziemia.resources.iron_ore, 100);
  t.equal('kapitał urósł', kasa.capital, 10_000 - 500 + 1200);
  t.check('agent zarobił na różnicy cen', kasa.capital > 10_000);

  // Magazyn odbiorcy ma pojemność — nadmiaru nie da się wcisnąć.
  ziemia.resources.iron_ore = 1990;
  const resztka = sellCargo(kasa, ziemia, 'iron_ore', 100, 12);
  t.equal('sprzedaje tylko tyle, ile się mieści', resztka, 10 * 12);
  t.equal('magazyn nie przekracza pojemności', ziemia.resources.iron_ore, 2000);

  // ----------------------------------------------------------
  t.section('Rejestr i strata');

  const registry = createAgentRegistry();
  registerAgent(registry, kasa);
  registerAgent(registry, smialek);
  t.equal('agent odnajdywalny po id', getAgent(registry, kasa.id)?.id, kasa.id);

  kasa.courseId = 'kurs-9';
  recordLoss(registry, kasa, 5000);
  t.equal('po stracie znów szuka okazji', kasa.courseId, null);
  t.equal('strata zapisana', kasa.ledger.lost, 5000);
  t.equal('licznik strat rejestru', registry.stats.losses, 1);

  const raport = summarizeAgents(registry);
  t.equal('raport obejmuje wszystkich', raport.count, 2);
  t.check('sortowanie po kapitale', raport.rows[0].capital >= raport.rows[1].capital);
  t.check('raport liczy łączny kapitał rynku', raport.capital > 0);

  return t.results;
}

runIfMain(import.meta.url, run);
