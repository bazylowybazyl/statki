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

let sequence = 1;

export function createAgentRegistry() {
  return {
    agents: [],
    stats: { hauls: 0, digs: 0, profit: 0, losses: 0, idle: 0 }
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
    /** Ładownia — agent to jedna jednostka albo mała grupa pod jednym szyldem. */
    holdCapacity: Math.max(1, Number(spec.holdCapacity) || 380),
    hullId: String(spec.hullId || 'long_haul_freighter'),
    stationId: String(spec.stationId || ''),
    /** Kurs, na którym obecnie jest. `null` = szuka okazji. */
    courseId: null,
    ledger: { trades: 0, digs: 0, revenue: 0, spent: 0, lost: 0 }
  };
}

export function registerAgent(registry, agent) {
  registry.agents.push(agent);
  return agent;
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
  if (!agent || agent.courseId) return null;
  const okazje = findTradeOpportunities(quotes, {
    holdCapacity: agent.holdCapacity,
    limit: options.scan ?? 20
  });

  let best = null;
  for (const okazja of okazje) {
    // Agent musi mieć czym zapłacić ZA TOWAR — to jest różnica wobec przewoźnika,
    // który wozi cudze i ryzykuje tylko statkiem.
    const stake = okazja.buyPrice * okazja.units;
    if (stake > agent.capital) continue;
    if (okazja.source.id !== agent.stationId && options.requireLocal !== false) continue;

    const route = chooseRoute(network, okazja.source.id, okazja.target.id, {
      mass: okazja.mass,
      value: okazja.sellPrice * okazja.units,
      piracyPressure: options.piracyPressure ?? 1
    });
    if (!route) continue;
    if (route.interceptChance > agent.maxRisk) continue;

    const zysk = netProfit(okazja, route, { minProfit: agent.minProfit });
    if (!zysk.worth) continue;
    if (!best || zysk.perSecond > best.profit.perSecond) {
      best = { opportunity: okazja, route, profit: zysk };
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
  if (!agent || agent.courseId) return null;
  const fields = network.fields || [];
  let best = null;

  for (const field of fields) {
    for (const resourceId of Object.keys(field.yields || {})) {
      const def = RESOURCES[resourceId];
      if (!def) continue;
      const units = Math.floor(agent.holdCapacity / Math.max(def.mass, 1e-6));
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
      if (!route || route.interceptChance > agent.maxRisk) continue;

      // Wykopane nic nie kosztuje poza czasem i paliwem — cała cena to zysk.
      const brutto = kupiec.cena.bid * units;
      const netto = brutto - route.cost.total - route.interceptChance * brutto;
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

/** Agent stracił ładunek i statek. Kapitał zostaje — z niego się odbuduje. */
export function recordLoss(registry, agent, value = 0) {
  if (!agent) return;
  agent.courseId = null;
  agent.ledger.lost += Math.max(0, Number(value) || 0);
  registry.stats.losses++;
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
    busy: !!agent.courseId,
    trades: agent.ledger.trades,
    digs: agent.ledger.digs,
    zysk: Math.round(agent.ledger.revenue - agent.ledger.spent)
  })).sort((a, b) => b.capital - a.capital);

  return {
    count: rows.length,
    busy: rows.filter(row => row.busy).length,
    capital: rows.reduce((sum, row) => sum + row.capital, 0),
    rows,
    stats: { ...registry.stats }
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
