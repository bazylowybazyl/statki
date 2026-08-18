/**
 * FIRMY TRANSPORTOWE — kto właściwie wozi.
 *
 * Do tej pory kurs powstawał znikąd: dyspozytor stwierdzał niedobór i statek
 * pojawiał się u nadawcy. To jest wygodne i całkowicie nieprawdziwe. Naprawdę
 * ktoś musi MIEĆ tam wolną jednostkę — a jeśli nie ma, ktoś musi ją tam
 * przygnać pustą i za to zapłacić.
 *
 * Stąd bierze się najciekawsza rzecz w logistyce: PUSTY POWRÓT. Po rozładunku
 * statek stoi tam, gdzie skończył. Ma trzy wyjścia i wszystkie kosztują:
 *   - czekać na ładunek powrotny (za darmo, ale traci czas)
 *   - wrócić pusty tam, gdzie jest praca (płaci paliwo, nic nie zarabia)
 *   - stać na parkingu, aż zrobi się opłacalnie
 *
 * Bogata firma wybiera pusty powrót, bo stać ją na trzymanie floty w ruchu.
 * Biedna musi czekać na ładunek — i przez to jest wolniejsza, co pogłębia
 * różnicę. Dokładnie jak w transporcie ciężarowym.
 *
 * Skutek uboczny jest cenny: jednostki gromadzą się w portach IMPORTOWYCH
 * (Ziemia odbiera 55% tonażu) i znikają z eksportowych. Bez pustych powrotów
 * ruch dusi się sam z siebie po kilkudziesięciu minutach.
 */

import { VAN_CLASSES } from '../cargoFleet.js';

export const SHIP_STATE = Object.freeze({
  /** Stoi w wolumenie postojowym i czeka na zlecenie. */
  PARKED: 'parked',
  /** Na kursie — wiozącym albo pustym. */
  BUSY: 'busy',
  /** Zajmuje stanowisko: załadunek, rozładunek, obsługa. */
  BERTHED: 'berthed'
});

/**
 * Polityka firmy. To jest jedyne miejsce, w którym „bogaty" i „biedny" różnią
 * się zachowaniem — reszta modułu jest dla wszystkich taka sama.
 */
export const COMPANY_POLICY = Object.freeze({
  /** Duża firma: flota ma się kręcić, postój jest droższy niż paliwo. */
  AGGRESSIVE: 'aggressive',
  /** Średnia: wraca pusto tylko na krótkich dystansach. */
  BALANCED: 'balanced',
  /** Mała: czeka na ładunek powrotny, bo na pusty kurs jej nie stać. */
  FRUGAL: 'frugal'
});

const POLICY_PROFILE = Object.freeze({
  [COMPANY_POLICY.AGGRESSIVE]: { idleCostPerSecond: 0.9, minCapitalRatio: 1.5, maxWaitSeconds: 240 },
  [COMPANY_POLICY.BALANCED]: { idleCostPerSecond: 0.35, minCapitalRatio: 3, maxWaitSeconds: 900 },
  [COMPANY_POLICY.FRUGAL]: { idleCostPerSecond: 0.1, minCapitalRatio: 8, maxWaitSeconds: 3600 }
});

let sequence = 1;

// ============================================================
// Firmy i floty
// ============================================================

export function createCompany(spec = {}) {
  const policy = POLICY_PROFILE[spec.policy] ? spec.policy : COMPANY_POLICY.BALANCED;
  return {
    id: String(spec.id || `firma-${sequence++}`),
    name: String(spec.name || spec.id || 'Przewoźnik'),
    factionId: spec.factionId ?? null,
    homeStationId: String(spec.homeStationId || ''),
    policy,
    profile: POLICY_PROFILE[policy],
    capital: Math.max(0, Number(spec.capital) || 0),
    ships: [],
    ledger: { revenue: 0, fuel: 0, fees: 0, deadheads: 0, losses: 0, jobs: 0, waited: 0 }
  };
}

/**
 * Dokłada jednostkę do floty. Klasa bierze się z `VAN_CLASSES`, więc firmy
 * używają tych samych statków co reszta gry — nic nowego nie wymyślamy.
 */
export function addShip(company, spec = {}) {
  const vanClass = VAN_CLASSES.find(cls => cls.id === spec.vanClassId) || VAN_CLASSES[1];
  const ship = {
    id: String(spec.id || `${company.id}-s${company.ships.length + 1}`),
    companyId: company.id,
    vanClassId: vanClass.id,
    hullId: spec.hullId || hullForVanClass(vanClass.id),
    capacity: vanClass.capacity,
    state: SHIP_STATE.PARKED,
    stationId: String(spec.stationId || company.homeStationId || ''),
    berthId: null,
    parkingSlot: Number(spec.parkingSlot) || 0,
    courseId: null,
    idleSince: Number(spec.idleSince) || 0,
    trips: 0,
    deadheads: 0
  };
  company.ships.push(ship);
  return ship;
}

/** Sylwetka cywilna dobrana do klasy ładowni. Nie mieszamy z okrętami bojowymi. */
export function hullForVanClass(vanClassId) {
  if (vanClassId === 'van') return 'inter_station_shuttle';
  if (vanClassId === 'bulk') return 'long_haul_freighter';
  // Ciężkie klasy sięgają po kadłuby, które wymagają stanowisk `capital`
  // i `mega` — dopiero one wypełniają największe gniazda w dokach.
  if (vanClassId === 'heavy') return 'heavy_freighter';
  if (vanClassId === 'mega') return 'megafreighter';
  return 'container_ship';
}

export function createFleetRegistry() {
  return { companies: [], shipsById: new Map() };
}

export function registerCompany(registry, company) {
  registry.companies.push(company);
  for (const ship of company.ships) registry.shipsById.set(ship.id, ship);
  return company;
}

export function getShip(registry, shipId) {
  return registry.shipsById.get(String(shipId)) || null;
}

export function getCompany(registry, companyId) {
  return registry.companies.find(company => company.id === String(companyId)) || null;
}

// ============================================================
// Dobór jednostki
// ============================================================

/**
 * Szuka wolnej jednostki STOJĄCEJ u nadawcy, zdolnej unieść ładunek.
 * Zwraca najciaśniejszą pasującą — duży frachtowiec ma zostać na duży ładunek.
 */
export function findParkedShip(registry, stationId, requiredCapacity = 0) {
  const station = String(stationId);
  let best = null;
  for (const company of registry.companies) {
    for (const ship of company.ships) {
      if (ship.state !== SHIP_STATE.PARKED || ship.stationId !== station) continue;
      if (ship.capacity < requiredCapacity) continue;
      if (!best || ship.capacity < best.ship.capacity) best = { ship, company };
    }
  }
  return best;
}

/**
 * Kandydaci do pustego przelotu po ładunek: jednostki stojące GDZIE INDZIEJ.
 * Zwraca posortowane po odległości od miejsca, w którym są potrzebne.
 */
export function findDeadheadCandidates(registry, network, targetStationId, requiredCapacity = 0) {
  const target = network?.nodes?.get(String(targetStationId));
  if (!target) return [];
  const out = [];
  for (const company of registry.companies) {
    for (const ship of company.ships) {
      if (ship.state !== SHIP_STATE.PARKED || ship.stationId === String(targetStationId)) continue;
      if (ship.capacity < requiredCapacity) continue;
      const from = network.nodes.get(ship.stationId);
      if (!from) continue;
      out.push({ ship, company, distance: Math.hypot(target.x - from.x, target.y - from.y) });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Czy firmę stać na pusty przelot — i czy jej się to opłaca.
 *
 * Rachunek jest ten sam co u przewoźnika drogowego: pusty kurs kosztuje paliwo
 * i nic nie przynosi, ale statek stojący bezczynnie też kosztuje. Różnica
 * między firmami siedzi w `idleCostPerSecond`: bogata wycenia swój przestój
 * wysoko, więc woli jechać; biedna wycenia go nisko, więc czeka.
 *
 * `minCapitalRatio` jest bezpiecznikiem: nie wolno wydać na pusty przelot
 * ułamka kapitału, który firmę wywróci.
 */
export function shouldDeadhead(company, options = {}) {
  const profile = company.profile || POLICY_PROFILE[COMPANY_POLICY.BALANCED];
  const cost = Math.max(0, Number(options.cost) || 0);
  const idleSeconds = Math.max(0, Number(options.expectedIdleSeconds) || 0);

  if (cost > 0 && company.capital < cost * profile.minCapitalRatio) {
    return { go: false, reason: 'za mały kapitał', cost, idleValue: 0 };
  }
  if (idleSeconds > profile.maxWaitSeconds) {
    return { go: true, reason: 'przestój ponad limit', cost, idleValue: Infinity };
  }
  const idleValue = idleSeconds * profile.idleCostPerSecond;
  return {
    go: idleValue > cost,
    reason: idleValue > cost ? 'przestój droższy niż paliwo' : 'taniej poczekać',
    cost,
    idleValue
  };
}

/**
 * Ile jednostka spodziewa się czekać na ładunek w danym porcie.
 *
 * Prosta miara zamiast prognozy: ile statków już tu stoi wobec tego, ile kursów
 * stąd wychodzi. Port, z którego nic nie wyjeżdża, a stoi w nim pięć statków,
 * to klasyczna pułapka pustego powrotu.
 */
export function expectedIdleSeconds(registry, stationId, outboundPerHour, options = {}) {
  const station = String(stationId);
  let waiting = 0;
  for (const company of registry.companies) {
    for (const ship of company.ships) {
      if (ship.state === SHIP_STATE.PARKED && ship.stationId === station) waiting++;
    }
  }
  const rate = Math.max(0.01, Number(outboundPerHour) || 0.01);
  const horizon = Number(options.horizonSeconds) || 3600;
  return ((waiting + 1) / rate) * horizon;
}

// ============================================================
// Cykl życia jednostki
// ============================================================

export function assignShipToCourse(ship, courseId) {
  if (!ship || ship.state !== SHIP_STATE.PARKED) return false;
  ship.state = SHIP_STATE.BUSY;
  ship.courseId = String(courseId);
  return true;
}

/** Jednostka dotarła i stoi wolna w nowym porcie. */
export function releaseShipAt(ship, stationId, now = 0, options = {}) {
  if (!ship) return false;
  ship.state = SHIP_STATE.PARKED;
  ship.stationId = String(stationId);
  ship.courseId = null;
  ship.berthId = null;
  ship.idleSince = Number(now) || 0;
  if (options.completedTrip) ship.trips++;
  if (options.deadhead) ship.deadheads++;
  return true;
}

/** Jednostka przepadła razem z ładunkiem. Firma traci majątek trwały. */
export function loseShip(registry, company, ship, value = 0) {
  if (!company || !ship) return false;
  const index = company.ships.indexOf(ship);
  if (index >= 0) company.ships.splice(index, 1);
  registry.shipsById.delete(ship.id);
  company.ledger.losses += Math.max(0, Number(value) || 0);
  return true;
}

// ============================================================
// Księgowość
// ============================================================

export function billFreight(company, amount) {
  if (!company) return;
  company.capital += Math.max(0, Number(amount) || 0);
  company.ledger.revenue += Math.max(0, Number(amount) || 0);
  company.ledger.jobs++;
}

export function billCost(company, amount, kind = 'fuel') {
  if (!company) return;
  const value = Math.max(0, Number(amount) || 0);
  company.capital -= value;
  if (kind === 'fees') company.ledger.fees += value;
  else company.ledger.fuel += value;
}

export function billDeadhead(company, amount) {
  if (!company) return;
  billCost(company, amount, 'fuel');
  company.ledger.deadheads++;
}

// ============================================================
// Odtwarzanie floty
// ============================================================

/** Cennik jednostek. Firma bez kapitału nie odkupi tego, co straciła. */
export const SHIP_PRICE = Object.freeze({ van: 4_000, hauler: 9_000, bulk: 18_000 });

/**
 * Firma dokupuje jednostkę, jeśli ma z czego i jeśli flota jej się skurczyła.
 *
 * Bez tego piractwo jest jednokierunkowe: każdy przechwyt trwale zmniejsza liczbę
 * statków w układzie i po godzinie nie ma czym wozić (zmierzone: 27 z 38 jednostek
 * przepadło, dyspozytor odmówił 593 razy z braku statku). Z odkupem powstaje
 * właściwa pętla — bogata firma odrabia straty, biedna wykrusza się z rynku.
 *
 * `reserveRatio` pilnuje, żeby nie wydać ostatniego grosza: zakup musi zostawić
 * zapas na paliwo, inaczej firma kupuje statek, którym nie ma za co polecieć.
 */
export function maintainFleet(company, options = {}) {
  const target = Math.max(0, Number(options.targetShips) || 0);
  if (company.ships.length >= target) return null;

  const reserveRatio = Number(options.reserveRatio) || 2.5;
  // Od najtańszej klasy: lepiej mieć trzy szutle niż czekać na frachtowiec.
  for (const vanClassId of ['van', 'hauler', 'bulk']) {
    const price = SHIP_PRICE[vanClassId];
    if (company.capital < price * reserveRatio) continue;
    company.capital -= price;
    company.ledger.fuel += 0;
    return addShip(company, {
      vanClassId,
      stationId: options.stationId || company.homeStationId,
      idleSince: options.now || 0
    });
  }
  return null;
}

/** Migawka do panelu: kto zarabia, kto stoi, kto wozi powietrze. */
export function summarizeCompanies(registry) {
  return registry.companies.map(company => {
    let parked = 0;
    let busy = 0;
    for (const ship of company.ships) {
      if (ship.state === SHIP_STATE.PARKED) parked++;
      else busy++;
    }
    return {
      id: company.id,
      name: company.name,
      policy: company.policy,
      capital: Math.round(company.capital),
      ships: company.ships.length,
      parked,
      busy,
      trips: company.ledger.jobs,
      deadheads: company.ledger.deadheads,
      revenue: Math.round(company.ledger.revenue),
      spent: Math.round(company.ledger.fuel + company.ledger.fees)
    };
  }).sort((a, b) => b.capital - a.capital);
}
