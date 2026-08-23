/**
 * FLOTY AGENTOWE — ruch, który leci po marżę, nie po niedobór.
 *
 * Dyspozytor frakcyjny jest PLANISTĄ: wozi tam, gdzie brakuje, i cena go nie
 * obchodzi. Agent jest KUPCEM: nie obchodzi go, czego komu brakuje, tylko gdzie
 * kupić tanio i sprzedać drogo. Ten sam świat, ta sama flota, te same doki —
 * inne pytanie zadawane co kurs.
 *
 * Skutki są widoczne w obrazie nieba i o to chodzi:
 *   ruch frakcyjny  — gęsty, przewidywalny, masówka po rdzeniu, niska wartość
 *   ruch agentowy   — rzadki, oportunistyczny, drobnica, wysoka wartość,
 *                     zapuszcza się tam, gdzie inni nie chcą, bo tam płacą
 *
 * Dzięki temu tłustymi celami stają się agenci, którzy w niebezpieczne rejony
 * wchodzą Z WYBORU. To jest dużo lepszy fundament piractwa niż przechwytywanie
 * losowego wozu z rudą — a przy tym samo się reguluje: piraci podnoszą premię
 * za ryzyko, premia podnosi wymaganą marżę, a to wypycha agentów albo do
 * uzbrojenia się, albo do zostania w domu.
 */

import { RESOURCES } from '../../data/resources.js';
import { resourcePrice } from '../stationEconomy.js';
import { snapshotMarket, findTradeOpportunities, netProfit } from './tradeMarket.js';
import { chooseRoute } from './travelNetwork.js';
import { convoyInterceptChance, escortCost, ESCORT_MODEL } from './convoy.js';

/**
 * Profile agentów. Różnica sprowadza się do JEDNEJ rzeczy — ile ryzyka wolno
 * przyjąć — a z niej wynika wszystko inne: gdzie latają i po co.
 */
export const AGENT_PROFILE = Object.freeze({
  /** Drobny handlarz. Nie stać go na stratę, więc trzyma się bezpiecznych tras. */
  CAUTIOUS: 'cautious',
  /** Kupiec. Liczy i ryzykuje, gdy się opłaca. */
  TRADER: 'trader',
  /** Śmiałek. Uzbrojony, wchodzi tam, gdzie marża jest największa. */
  BOLD: 'bold'
});

const PROFILES = Object.freeze({
  [AGENT_PROFILE.CAUTIOUS]: { maxRisk: 0.08, minProfit: 200, escortPower: 0, boldness: 0.6 },
  [AGENT_PROFILE.TRADER]: { maxRisk: 0.25, minProfit: 600, escortPower: 1, boldness: 1 },
  [AGENT_PROFILE.BOLD]: { maxRisk: 0.6, minProfit: 1500, escortPower: 3, boldness: 1.8 }
});

/**
 * DOMY HANDLOWE — karawany, nie pojedyncze statki.
 *
 * Samotny kupiec z jedną ładownią jest poprawny, ale robi z handlu prywatnego
 * szum: wozi tyle co zwykły frachtowiec, ginie po cichu i nie ma na czym
 * polować. Prawdziwy handel dalekobieżny wygląda inaczej — kilka dużych
 * frachtowców pod jednym szyldem, opłacona ochrona i jeden wielki manifest.
 *
 * Karawana korzysta z tych samych konwojów co ruch frakcyjny (`convoy.js`):
 * jeden rzut na przechwyt dla całej grupy, częściowa strata, osłona zbijająca
 * ryzyko. Różnica jest taka, że dom handlowy NIE PYTA, czy mu się opłaca
 * konwojować — on lata razem z definicji, bo to jeden właściciel i jeden towar.
 *
 * Skutki, o które chodzi:
 *   • jest na co polować — pełna karawana to kilkadziesiąt tysięcy CR w jednym
 *     miejscu, warte rejdu, a nie przypadkowej zasadzki
 *   • duży trade — ładownia całej grupy pozwala wziąć okazję, której samotny
 *     statek nie ruszy, więc na rubieżach dzieje się coś poza masówką
 *   • ochrona jest RACHUNKIEM: kosztuje co kurs, ale zbija i szansę przechwytu,
 *     i wielkość straty, więc dom handlowy sam decyduje, na ile go stać
 */
export const CARAVAN_ROLES = Object.freeze([
  { profile: 'bold', ships: 4, escorts: 3, hold: 900, hull: 'heavy_freighter', capital: 320_000,
    name: 'Kompania' },
  { profile: 'trader', ships: 3, escorts: 2, hold: 900, hull: 'heavy_freighter', capital: 220_000,
    name: 'Dom Handlowy' },
  { profile: 'cautious', ships: 5, escorts: 4, hold: 380, hull: 'long_haul_freighter', capital: 180_000,
    name: 'Gildia' }
]);

const CARAVAN_NAMES = [
  'Wschodnia', 'Merkurego', 'Złotego Szlaku', 'Trzech Bram', 'Kuipera',
  'Pod Kotwicą', 'Sześciu Pieczęci', 'Białego Lodu', 'Perseusza', 'Zefira'
];

let sequence = 1;

export function createAgentRegistry() {
  return {
    agents: [],
    stats: { hauls: 0, digs: 0, profit: 0, losses: 0, idle: 0, stranded: 0 }
  };
}

export function createAgent(spec = {}) {
  const profileId = PROFILES[spec.profile] ? spec.profile : AGENT_PROFILE.TRADER;
  return {
    id: String(spec.id || `agent-${sequence++}`),
    name: String(spec.name || `Wolny kupiec ${sequence}`),
    profile: profileId,
    ...PROFILES[profileId],
    capital: Math.max(0, Number(spec.capital) || 20_000),
    /** Ładownia JEDNEGO frachtowca. Karawana wozi tyle razy więcej, ile ma statków. */
    holdCapacity: Math.max(1, Number(spec.holdCapacity) || 380),
    /** Ile frachtowców leci w karawanie TERAZ. 1 = samotny wilk. */
    ships: Math.max(1, Math.floor(Number(spec.ships)) || 1),
    /** Do ilu odbudowuje się po stratach, jeśli ma z czego. */
    targetShips: Math.max(1, Math.floor(Number(spec.ships)) || 1),
    /** Siła opłaconej ochrony. Nadpisuje wartość z profilu, jeśli podana. */
    escortPower: Math.max(0, Number(spec.escorts ?? PROFILES[profileId].escortPower) || 0),
    hullId: String(spec.hullId || 'long_haul_freighter'),
    stationId: String(spec.stationId || ''),
    /** Kurs prowadzący. `null` = karawana stoi w porcie i szuka okazji. */
    courseId: null,
    /** Wszystkie kursy karawany — po jednym na frachtowiec. */
    courseIds: [],
    ledger: { trades: 0, digs: 0, revenue: 0, spent: 0, lost: 0, escorts: 0 }
  };
}

export function registerAgent(registry, agent) {
  registry.agents.push(agent);
  return agent;
}

// ============================================================
// Karawana
// ============================================================

/** Ładownia całej grupy — to ona decyduje, jak dużą okazję da się wziąć. */
export function caravanCapacity(agent) {
  return Math.max(1, agent.holdCapacity * Math.max(1, agent.ships || 1));
}

/** Czy karawana jest w drodze. Pojedynczy `courseId` zostaje dla samotników. */
export function agentIsBusy(agent) {
  return !!agent?.courseId || (agent?.courseIds?.length > 0);
}

/**
 * Szansa, że grupa zostanie przechwycona — nie ta, która dotyczy samotnika.
 *
 * Ten sam rachunek co w `convoy.js`, świadomie ten sam: widoczność rośnie
 * z pierwiastkiem liczebności, osłona ją dzieli. Bez tego dom handlowy
 * odrzucałby te trasy, po których lata WŁAŚNIE DLATEGO, że kupił sobie ochronę.
 */
export function caravanRisk(agent, soloChance) {
  const ships = Math.max(1, agent?.ships || 1);
  const power = Math.max(0, agent?.escortPower || 0);
  if (ships <= 1 && power <= 0) return soloChance;
  return convoyInterceptChance({ courseIds: new Array(ships).fill('x'), escortPower: power }, soloChance);
}

/** Jaka część ładunku przepada przy udanym przechwycie. Samotnik traci wszystko. */
export function caravanLossShare(agent) {
  const ships = Math.max(1, agent?.ships || 1);
  if (ships <= 1) return 1;
  return Math.max(
    ESCORT_MODEL.minLossFraction,
    ESCORT_MODEL.baseLossFraction - Math.max(0, agent?.escortPower || 0) * ESCORT_MODEL.escortSaveFactor
  );
}

/** Ile kosztuje ochrona na tej trasie. Płatne co kurs, nie raz na zawsze. */
export function caravanEscortCost(agent, seconds) {
  return escortCost(Math.max(0, agent?.escortPower || 0), Math.max(0, Number(seconds) || 0));
}

/**
 * Cennik frachtowców kupieckich. Karawana to kapitał trwały — jej odbudowa jest
 * tym samym mechanizmem, co `maintainFleet` u przewoźników.
 */
export const CARAVAN_SHIP_PRICE = Object.freeze({
  inter_station_shuttle: 4_000,
  container_ship: 9_000,
  long_haul_freighter: 18_000,
  heavy_freighter: 46_000,
  megafreighter: 120_000
});

/**
 * Dom handlowy odkupuje stracony frachtowiec, jeśli go na to stać.
 *
 * Bez tego piractwo jest jednokierunkowe: każdy przechwyt trwale zmniejsza
 * karawanę i po kilku godzinach wszystkie schodzą do jednego statku, czyli
 * z powrotem do samotnych wilków. `reserveRatio` pilnuje, żeby zakup nie zjadł
 * kapitału obrotowego — kupiec bez gotówki nie ma za co kupić TOWARU, a wtedy
 * nowy statek i tak stoi.
 */
export function maintainCaravan(agent, options = {}) {
  if (!agent || agentIsBusy(agent)) return false;
  const target = Math.max(1, Number(options.targetShips) || agent.targetShips || 1);
  if ((agent.ships || 1) >= target) return false;
  const price = Number(options.price)
    || CARAVAN_SHIP_PRICE[agent.hullId]
    || CARAVAN_SHIP_PRICE.long_haul_freighter;
  const reserveRatio = Number(options.reserveRatio) || 3;
  if (agent.capital < price * reserveRatio) return false;
  agent.capital -= price;
  agent.ledger.spent += price;
  agent.ships = (agent.ships || 1) + 1;
  return true;
}

/** Wiąże karawanę z jej kursami. */
export function attachCourses(agent, courseIds) {
  if (!agent) return 0;
  agent.courseIds = [...courseIds];
  agent.courseId = agent.courseIds[0] || null;
  return agent.courseIds.length;
}

/**
 * Wypisuje jeden kurs z karawany — po dolocie albo po zestrzeleniu.
 * Zwraca `true`, gdy wróciła CAŁA grupa i dom handlowy może szukać nowej okazji.
 *
 * Bez tego rozróżnienia karawana zwalniałaby się przy pierwszym dolocie, a jej
 * pozostałe statki leciałyby dalej jako niczyje — i drugi zakup poszedłby
 * z kapitału, który jeszcze jest w powietrzu.
 */
export function releaseCourse(agent, courseId) {
  if (!agent) return false;
  const id = String(courseId || '');
  const index = agent.courseIds?.indexOf(id) ?? -1;
  if (index >= 0) agent.courseIds.splice(index, 1);
  if (!agent.courseIds?.length) {
    agent.courseId = null;
    return true;
  }
  if (agent.courseId === id) agent.courseId = agent.courseIds[0];
  return false;
}

// ============================================================
// Szukanie zarobku
// ============================================================

/**
 * Najlepsza okazja handlowa dla tego agenta.
 *
 * Kluczowe: agent NIE bierze największej marży, tylko największy zysk NETTO po
 * odjęciu trasy i ryzyka — i odrzuca wszystko powyżej swojego progu ryzyka.
 * Dlatego ostrożny handlarz zostaje w rdzeniu, a śmiałek leci na rubieże, gdzie
 * spread jest największy właśnie dlatego, że mało kto tam zagląda.
 */
export function findBestTrade(agent, quotes, network, options = {}) {
  if (!agent || agentIsBusy(agent)) return null;
  const hold = caravanCapacity(agent);
  // Dwie listy, bo jedna nie wystarcza. Globalny top po zysku brutto to te same
  // kilkanaście tłustych par dla całego układu — kupiec dostawał z niej wyłącznie
  // kursy przez pół systemu i nigdy nie widział towaru w porcie, w którym stoi.
  // Zmierzone przy samej liście globalnej: wszystkie 54 karawany jednocześnie
  // w drodze i 64 domknięte kursy na 90 minut.
  //
  // Ładownia jest CAŁEJ karawany: dom handlowy bierze okazję, której samotny
  // frachtowiec nie ruszy, i to jest cały sens latania grupą.
  const okazje = [
    ...findTradeOpportunities(quotes, { holdCapacity: hold, limit: 12, sourceIds: [agent.stationId] }),
    ...findTradeOpportunities(quotes, { holdCapacity: hold, limit: options.scan ?? 20 })
  ];

  let best = null;
  for (const okazja of okazje) {
    // Agent musi mieć czym zapłacić ZA TOWAR — to jest różnica wobec przewoźnika,
    // który wozi cudze i ryzykuje tylko statkiem.
    const stake = okazja.buyPrice * okazja.units;
    if (stake > agent.capital) continue;

    // Kupiec stoi tam, gdzie skończył poprzedni kurs. Okazja u kogoś innego
    // nadal jest okazją — trzeba tam tylko dolecieć PUSTO i za to zapłacić.
    // Ten sam rachunek, którym przewoźnik decyduje o pustym powrocie.
    //
    // Bez tego kupiec był przykuty do jednego portu: albo na zawsze do
    // macierzystego (zmierzone: 6558 odmów „brak okazji" na 191 kursów), albo —
    // po dopuszczeniu przeprowadzki — do portu IMPORTOWEGO, w którym właśnie
    // rozładował i w którym z definicji nie ma czego kupić.
    const dojazd = okazja.source.id === agent.stationId ? null
      : chooseRoute(network, agent.stationId, okazja.source.id, {
        mass: 0, value: 0, piracyPressure: options.piracyPressure ?? 1
      });
    if (!dojazd && okazja.source.id !== agent.stationId) continue;

    const route = chooseRoute(network, okazja.source.id, okazja.target.id, {
      mass: okazja.mass,
      value: okazja.sellPrice * okazja.units,
      piracyPressure: options.piracyPressure ?? 1
    });
    if (!route) continue;
    // Progiem jest ryzyko GRUPY, nie samotnika — inaczej opłacona ochrona nic
    // by nie zmieniała i dom handlowy odrzucałby dokładnie te trasy, dla
    // których ją kupił.
    const ryzyko = caravanRisk(agent, route.interceptChance);
    if (ryzyko > agent.maxRisk) continue;

    // Pusty dolot wydłuża kurs, więc wchodzi do zysku NA SEKUNDĘ — inaczej
    // okazja na drugim końcu układu wygrywałaby z równie dobrą u sąsiada.
    const zysk = netProfit(okazja, { ...route, seconds: route.seconds + (dojazd?.seconds || 0) }, {
      minProfit: agent.minProfit,
      risk: ryzyko,
      lossShare: caravanLossShare(agent),
      // Ochrona kosztuje co kurs. Bez tego składnika eskorta byłaby darmowym
      // dobrem i każdy dom handlowy miałby jej maksimum.
      extraCost: caravanEscortCost(agent, route.seconds) + (dojazd?.cost.total || 0)
    });
    if (!zysk.worth) continue;
    if (!best || zysk.perSecond > best.profit.perSecond) {
      best = { opportunity: okazja, route, approach: dojazd, profit: zysk };
    }
  }
  return best;
}

/**
 * Najlepsza wyprawa górnicza dla agenta.
 *
 * Górnik frakcyjny leci po to, czego brakuje JEGO stacji. Agent leci po to, co
 * jest RZADKIE I DROGIE — czyli sprawdza, kto najlepiej płaci, i dopiero potem
 * patrzy, gdzie to wykopać. Stąd wyprawy po rudę uranu na Kuiper: 8,5 mln
 * jednostek od rdzenia, ale nikt inny tego nie ma.
 */
export function findBestDig(agent, quotes, network, options = {}) {
  if (!agent || agentIsBusy(agent)) return null;
  const fields = network.fields || [];
  let best = null;

  for (const field of fields) {
    for (const resourceId of Object.keys(field.yields || {})) {
      const def = RESOURCES[resourceId];
      if (!def) continue;
      const units = Math.floor(caravanCapacity(agent) / Math.max(def.mass, 1e-6));
      if (units <= 0) continue;

      // Kto zapłaci najwięcej za to, co da się tu wykopać.
      let kupiec = null;
      for (const [, quote] of quotes) {
        const cena = quote.prices.get(resourceId);
        if (!cena || cena.room < units) continue;
        if (!kupiec || cena.bid > kupiec.cena.bid) kupiec = { station: quote.station, cena };
      }
      if (!kupiec) continue;

      const route = chooseRoute(network, field.id, kupiec.station.id, {
        mass: units * def.mass,
        value: kupiec.cena.bid * units,
        piracyPressure: options.piracyPressure ?? 1
      });
      if (!route) continue;
      const ryzyko = caravanRisk(agent, route.interceptChance);
      if (ryzyko > agent.maxRisk) continue;

      // Wykopane nic nie kosztuje poza czasem i paliwem — cała cena to zysk.
      const brutto = kupiec.cena.bid * units;
      const netto = brutto - route.cost.total - caravanEscortCost(agent, route.seconds)
        - ryzyko * caravanLossShare(agent) * brutto;
      const sekundy = (route.seconds || 1) + (field.extractionSeconds || 600);
      if (netto <= agent.minProfit) continue;

      const perSecond = netto / sekundy;
      if (!best || perSecond > best.perSecond) {
        best = { field, resourceId, units, buyer: kupiec.station, route, netto, perSecond };
      }
    }
  }
  return best;
}

// ============================================================
// Rozliczenia
// ============================================================

/** Agent płaci za towar i zabiera go z magazynu stacji. */
export function buyCargo(agent, econ, resourceId, units, unitPrice) {
  if (!agent || !econ?.resources) return false;
  const stan = Number(econ.resources[resourceId]) || 0;
  const koszt = unitPrice * units;
  if (stan < units || agent.capital < koszt) return false;
  econ.resources[resourceId] = stan - units;
  agent.capital -= koszt;
  agent.ledger.spent += koszt;
  return true;
}

/** Agent sprzedaje towar stacji. Zwraca utarg. */
export function sellCargo(agent, econ, resourceId, units, unitPrice) {
  if (!agent || !econ?.resources) return 0;
  const cap = Number(econ.capacity?.[resourceId]);
  const stan = Number(econ.resources[resourceId]) || 0;
  const zmiesci = Number.isFinite(cap) ? Math.min(units, Math.max(0, cap - stan)) : units;
  if (zmiesci <= 0) return 0;
  econ.resources[resourceId] = stan + zmiesci;
  const utarg = unitPrice * zmiesci;
  agent.capital += utarg;
  agent.ledger.revenue += utarg;
  return utarg;
}

/**
 * Agent stracił ładunek i statek. Kapitał zostaje — z niego się odbuduje.
 *
 * `courseId` jest opcjonalny i ma znaczenie dla karawan: przepada JEDEN statek
 * z grupy, a nie cała wyprawa. Bez niego pierwszy zestrzelony frachtowiec
 * zwalniał dom handlowy do nowego zakupu, choć reszta jego towaru wciąż leciała.
 */
export function recordLoss(registry, agent, value = 0, courseId = null) {
  if (!agent) return;
  agent.ledger.lost += Math.max(0, Number(value) || 0);
  registry.stats.losses++;
  if (courseId) {
    releaseCourse(agent, courseId);
    // Utracony frachtowiec nie wraca — karawana kurczy się na kolejny kurs.
    agent.ships = Math.max(1, (agent.ships || 1) - 1);
    return;
  }
  agent.courseId = null;
  if (agent.courseIds) agent.courseIds.length = 0;
}

export function getAgent(registry, agentId) {
  const id = String(agentId || '');
  return registry?.agents.find(agent => agent.id === id) || null;
}

/** Migawka do panelu: kto zarabia, kto stoi, kto się dorobił. */
export function summarizeAgents(registry) {
  const rows = registry.agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    profile: agent.profile,
    capital: Math.round(agent.capital),
    station: agent.stationId,
    ships: agent.ships || 1,
    targetShips: agent.targetShips || 1,
    escorts: agent.escortPower || 0,
    busy: agentIsBusy(agent),
    trades: agent.ledger.trades,
    digs: agent.ledger.digs,
    zysk: Math.round(agent.ledger.revenue - agent.ledger.spent)
  })).sort((a, b) => b.capital - a.capital);

  return {
    count: rows.length,
    busy: rows.filter(row => row.busy).length,
    capital: rows.reduce((sum, row) => sum + row.capital, 0),
    /** Ile z nich to karawany, a ile samotnych wilków. */
    caravans: rows.filter(row => row.ships > 1).length,
    hulls: rows.reduce((sum, row) => sum + row.ships, 0),
    escorts: rows.reduce((sum, row) => sum + row.escorts, 0),
    rows,
    stats: { ...registry.stats }
  };
}

/**
 * Buduje rynek prywatnych kupców: garść domów handlowych i długi ogon
 * samotnych wilków.
 *
 * Istnieje po to, żeby demo i skrypt pomiarowy zaczynały z DOKŁADNIE tym samym
 * rynkiem. Wcześniej obie strony miały własną pętlę tworzącą agentów i już się
 * rozjechały — a wtedy liczba zmierzona w konsoli nie mówi nic o tym, co widać
 * na ekranie.
 *
 * Karawan jest mało i tak ma być: to one wożą duże ładunki i to one są warte
 * rejdu. Samotne wilki zostają, bo drobnica na krótkich trasach nie utrzyma
 * ochrony i nie powinna jej mieć.
 */
export function buildMerchants(registry, ports, economyScale = 1, options = {}) {
  const activePorts = Array.isArray(ports) && ports.length ? ports : ['earth'];
  const scale = Math.max(0.1, Number(economyScale) || 1);
  const soloCount = Math.max(4, Math.round((options.soloPerScale ?? 6) * Math.sqrt(scale)));
  const caravanCount = Math.max(2, Math.round((options.caravansPerScale ?? 1) * Math.sqrt(scale)));
  const soloMix = options.soloMix
    || [AGENT_PROFILE.CAUTIOUS, AGENT_PROFILE.TRADER, AGENT_PROFILE.TRADER, AGENT_PROFILE.BOLD];
  const caravans = [];
  const solo = [];

  for (let i = 0; i < caravanCount; i++) {
    const role = CARAVAN_ROLES[i % CARAVAN_ROLES.length];
    caravans.push(registerAgent(registry, createAgent({
      name: `${role.name} ${CARAVAN_NAMES[i % CARAVAN_NAMES.length]}`,
      profile: role.profile,
      capital: role.capital,
      holdCapacity: role.hold,
      ships: role.ships,
      escorts: role.escorts,
      hullId: role.hull,
      stationId: activePorts[i % activePorts.length]
    })));
  }

  for (let i = 0; i < soloCount; i++) {
    const profile = soloMix[i % soloMix.length];
    const bold = profile === AGENT_PROFILE.BOLD;
    solo.push(registerAgent(registry, createAgent({
      name: `Kupiec ${i + 1}`,
      profile,
      capital: bold ? 120_000 : 45_000,
      holdCapacity: bold ? 900 : 380,
      hullId: bold ? 'heavy_freighter' : 'long_haul_freighter',
      stationId: activePorts[(i + caravanCount) % activePorts.length]
    })));
  }

  return {
    caravans,
    solo,
    agents: registry.agents,
    hulls: registry.agents.reduce((sum, agent) => sum + (agent.ships || 1), 0)
  };
}

/** Notowania — wygodne opakowanie, żeby wołający nie znał `tradeMarket`. */
export function marketSnapshot(stations, getEconomy) {
  return snapshotMarket(stations, getEconomy);
}

/** Cena, po której agent kupi u siebie w porcie — do wyceny startowej. */
export function localAsk(station, econ, resourceId) {
  return resourcePrice(station, econ, resourceId)?.ask ?? null;
}
