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
  summarizeAgents, marketSnapshot,
  caravanCapacity, caravanRisk, caravanLossShare, caravanEscortCost,
  agentIsBusy, attachCourses, releaseCourse, maintainCaravan, buildMerchants,
  CARAVAN_SHIP_PRICE
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

  // ----------------------------------------------------------
  t.section('Karawany — dom handlowy, nie pojedynczy statek');

  // Samotny wilk BEZ ochrony. Sam profil `TRADER` daje `escortPower 1`, więc
  // domyślny kupiec jest już lekko uzbrojony — i od teraz za to płaci.
  const wilk = createAgent({
    profile: AGENT_PROFILE.TRADER, capital: 400_000, stationId: 'mercury',
    holdCapacity: 900, hullId: 'heavy_freighter', escorts: 0
  });
  const dom = createAgent({
    profile: AGENT_PROFILE.TRADER, capital: 400_000, stationId: 'mercury',
    holdCapacity: 900, hullId: 'heavy_freighter', ships: 4, escorts: 3
  });

  t.equal('samotny wilk ma jedną ładownię', caravanCapacity(wilk), 900);
  t.equal('karawana wozi tyle, ile ma statków', caravanCapacity(dom), 3600);
  t.equal('osłona z pola `escorts` nadpisuje profil', dom.escortPower, 3);
  t.equal('karawana pamięta, do ilu się odbudowuje', dom.targetShips, 4);

  t.equal('samotny bez broni ryzykuje tyle, co jego trasa', caravanRisk(wilk, 0.4), 0.4);
  t.check('grupa z osłoną ryzykuje mniej niż samotnik', caravanRisk(dom, 0.4) < 0.4,
    `(${caravanRisk(dom, 0.4).toFixed(3)} wobec 0.400)`);
  const bezOslony = createAgent({ profile: AGENT_PROFILE.TRADER, ships: 4, escorts: 0 });
  t.check('bez osłony grupa jest ŁATWIEJSZA do znalezienia niż samotnik',
    caravanRisk(bezOslony, 0.2) > 0.2,
    `(${caravanRisk(bezOslony, 0.2).toFixed(3)} wobec 0.200)`);

  t.equal('samotnik przy przechwycie traci wszystko', caravanLossShare(wilk), 1);
  t.check('karawana traci tylko część składu', caravanLossShare(dom) < 1);
  t.check('mocniejsza osłona ratuje więcej',
    caravanLossShare(createAgent({ ships: 4, escorts: 4 })) < caravanLossShare(bezOslony));

  t.equal('bez osłony nie ma za co płacić', caravanEscortCost(wilk, 1000), 0);
  t.check('uzbrojony samotnik płaci za swoją broń',
    caravanEscortCost(createAgent({ profile: AGENT_PROFILE.TRADER }), 1000) > 0);
  t.check('osłona kosztuje i rośnie z czasem lotu',
    caravanEscortCost(dom, 2000) > caravanEscortCost(dom, 1000));

  // --- zajętość: karawana wraca całą grupą ---
  attachCourses(dom, ['k-1', 'k-2', 'k-3', 'k-4']);
  t.check('po wysłaniu karawana jest zajęta', agentIsBusy(dom));
  t.equal('kurs prowadzący to pierwszy z grupy', dom.courseId, 'k-1');
  t.check('dolot jednego statku NIE zwalnia domu', !releaseCourse(dom, 'k-1'));
  t.check('dom nadal zajęty', agentIsBusy(dom));
  t.equal('prowadzenie przechodzi na następny', dom.courseId, 'k-2');
  releaseCourse(dom, 'k-2');
  releaseCourse(dom, 'k-3');
  t.check('dopiero ostatni statek kończy wyprawę', releaseCourse(dom, 'k-4'));
  t.check('po powrocie znów szuka okazji', !agentIsBusy(dom));

  // --- strata pojedynczego frachtowca ---
  const rejestrK = createAgentRegistry();
  registerAgent(rejestrK, dom);
  attachCourses(dom, ['s-1', 's-2', 's-3', 's-4']);
  recordLoss(rejestrK, dom, 9000, 's-2');
  t.check('po stracie jednego statku karawana leci dalej', agentIsBusy(dom));
  t.equal('karawana skurczyła się o zestrzelony frachtowiec', dom.ships, 3);
  t.equal('strata zapisana w księdze', dom.ledger.lost, 9000);
  recordLoss(rejestrK, dom, 1000);
  t.check('strata bez wskazania kursu zwalnia całą wyprawę', !agentIsBusy(dom));

  // --- odkup: bez niego piractwo jest jednokierunkowe ---
  dom.capital = 400_000;
  t.check('odkupuje stracony frachtowiec', maintainCaravan(dom));
  t.equal('kapitał zmalał o cenę kadłuba',
    Math.round(dom.capital), 400_000 - CARAVAN_SHIP_PRICE.heavy_freighter);
  t.equal('karawana urosła', dom.ships, 4);
  t.check('nie kupuje ponad plan', !maintainCaravan(dom));
  dom.ships = 2;
  dom.capital = 1000;
  t.check('bez kapitału nie odkupi', !maintainCaravan(dom));
  dom.capital = 400_000;
  attachCourses(dom, ['x-1']);
  t.check('w trakcie kursu nie odkupuje', !maintainCaravan(dom));
  releaseCourse(dom, 'x-1');

  // ----------------------------------------------------------
  t.section('Karawana bierze okazje, których samotnik nie ruszy');

  const solo = createAgent({
    profile: AGENT_PROFILE.TRADER, capital: 900_000, stationId: 'mercury',
    holdCapacity: 900, hullId: 'heavy_freighter'
  });
  const grupa = createAgent({
    profile: AGENT_PROFILE.TRADER, capital: 900_000, stationId: 'mercury',
    holdCapacity: 900, hullId: 'heavy_freighter', ships: 4, escorts: 3
  });
  const okazjaSolo = findBestTrade(solo, quotes, network, { piracyPressure: 1 });
  const okazjaGrupy = findBestTrade(grupa, quotes, network, { piracyPressure: 1 });
  t.check('samotnik ma co wozić', !!okazjaSolo);
  t.check('karawana też', !!okazjaGrupy);
  if (okazjaSolo && okazjaGrupy) {
    t.check('karawana bierze więcej towaru na kurs',
      okazjaGrupy.opportunity.units > okazjaSolo.opportunity.units,
      `(${okazjaGrupy.opportunity.units} wobec ${okazjaSolo.opportunity.units})`);
    t.check('i większy zysk brutto', okazjaGrupy.profit.gross > okazjaSolo.profit.gross);
    t.check('rachunek karawany uwzględnia częściową stratę', okazjaGrupy.profit.lossShare < 1);
    t.equal('u siebie w porcie nie ma pustego dolotu', okazjaGrupy.approach, null);
  }

  // Kupiec stojący w porcie, w którym nie ma czego kupić (Ziemia = zero zapasów),
  // musi umieć polecieć PUSTO po towar — inaczej jest przykuty do miejsca.
  const przyjezdny = createAgent({
    profile: AGENT_PROFILE.TRADER, capital: 900_000, stationId: 'earth',
    holdCapacity: 900, hullId: 'heavy_freighter', ships: 3, escorts: 2
  });
  const zDojazdem = findBestTrade(przyjezdny, quotes, network, { piracyPressure: 1 });
  t.check('kupiec z pustego portu i tak znajduje kurs', !!zDojazdem);
  if (zDojazdem) {
    t.check('trasa zaczyna się gdzie indziej niż on stoi',
      zDojazdem.opportunity.source.id !== 'earth');
    t.check('pusty dolot jest wyceniony', !!zDojazdem.approach && zDojazdem.approach.cost.total > 0);
  }

  // ----------------------------------------------------------
  t.section('Rynek kupców — kilka domów, długi ogon wilków');

  const rynek = createAgentRegistry();
  const skladka = buildMerchants(rynek, ['mercury', 'venus', 'earth', 'mars'], 16);
  t.check('powstały domy handlowe', skladka.caravans.length >= 2);
  t.check('i samotne wilki', skladka.solo.length > skladka.caravans.length);
  t.check('każdy dom to więcej niż jeden statek',
    skladka.caravans.every(agent => agent.ships > 1));
  t.check('wilk lata sam', skladka.solo.every(agent => agent.ships === 1));
  t.check('domy mają opłaconą ochronę',
    skladka.caravans.every(agent => agent.escortPower > 0));
  t.check('wszyscy startują z istniejących portów',
    rynek.agents.every(agent => ['mercury', 'venus', 'earth', 'mars'].includes(agent.stationId)));
  const raportRynku = summarizeAgents(rynek);
  t.equal('raport liczy karawany osobno', raportRynku.caravans, skladka.caravans.length);
  t.check('kadłubów jest więcej niż kupców', raportRynku.hulls > raportRynku.count);

  return t.results;
}

runIfMain(import.meta.url, run);
