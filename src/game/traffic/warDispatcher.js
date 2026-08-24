/**
 * DYSPOZYTOR WOJENNY — odbiorca dla floty i źródło wraków.
 *
 * Domyka dziurę tej samej klasy, dla której powstały stocznie. Wtedy nikt nie
 * zużywał komponentów T2; teraz nikt nie zużywa GOTOWYCH OKRĘTÓW. Zmierzone
 * (`node scripts/symulacja-ruchu.mjs 240 1 4 60`): 662 zwodowane jednostki,
 * `takeShips` wywoływane wyłącznie w testach. Flota rosła w nieskończoność,
 * a razem z nią popyt na podzespoły, który nic nie równoważyło.
 *
 * Wojna jest tu POWODEM EKONOMICZNYM, nie dekoracją:
 *   • zużywa okręty, więc stocznia ma po co budować
 *   • robi wraki, a wrak to jedyne źródło złomu w całym układzie
 *     (deficyt 1342 szt/h — patrz `node scripts/analiza-ruchu.mjs`)
 *   • przegrana kampania to realna strata siły, więc odbudowa generuje
 *     konwoje z komponentami na trasach, na których czyhają piraci
 *
 * Kampania jest KURSEM, nie osobnym bytem. Dzięki temu leci przez tę samą
 * sieć tras co frachtowce, tak samo może zostać przechwycona po drodze i tak
 * samo widzi ją warstwa 3, gdy gracz jest w pobliżu.
 */

import { COURSE_KIND, launchCourse, travelStage } from './courseRegistry.js';
import { chooseRoute } from './travelNetwork.js';
import { areFactionsHostile, getFactionStance } from '../../data/factions.js';
import { RESOURCES } from '../../data/resources.js';
import { getStationIndustry, militaryScale } from '../stationEconomy.js';
import { WARSHIP_CLASSES, takeShips, returnShips, fleetPower } from './shipyards.js';

export const WAR_MODEL = Object.freeze({
  /** Co ile sekund frakcja w ogóle rozważa wyprawę. */
  decisionSeconds: 240,
  /**
   * Jaki ułamek zapasu wolno wysłać w jedną kampanię.
   *
   * Nie 100%: frakcja, która wysyła wszystko, po jednej przegranej przestaje
   * istnieć militarnie i wojna kończy się na pierwszym starciu. Ułamek
   * sprawia, że przegrana boli, ale zostawia z czym wracać.
   */
  commitFraction: 0.4,
  /** Minimalna przewaga nad obroną celu, żeby wyprawa miała sens. */
  minAdvantage: 1.25,
  /** Poniżej tylu punktów siły nie ma czym atakować. */
  minStrength: 8,
  /**
   * Ułamek siły, jaki traci strona przy starciu. Obrońca traci więcej, bo
   * bije się przy własnej stacji i nie może się wycofać — ale atakujący
   * nadkłada drogę i to jego straty są bezpowrotne (patrz `retreatFraction`).
   */
  attackerLoss: 0.34,
  defenderLoss: 0.46,
  /** Ilu ocalałych atakującego wraca do zapasu zamiast zostać na miejscu. */
  retreatFraction: 0.75,
  /** Ile masy kadłuba da się odzyskać z wraku jako złom. */
  scrapRecovery: 0.45,
  /**
   * Ile PODZESPOŁÓW wychodzi z wraku przyholowanego do doku.
   *
   * Wrak nie jest kupą złomu — `src/game/salvage.js` mówi to od dawna
   * („holowanie: wrak oddaje wszystko, z bronią w całości"), a dyspozytor
   * wojenny liczył z niego wyłącznie złom i dlatego zbieranie wychodziło
   * nieopłacalne. Rachunek na fregacie: 12,6 złomu = 38 CR wobec 3060 CR
   * w samych podzespołach.
   */
  towComponentRecovery: 0.28,
  /** Ile złomu zostaje po holowaniu — mniej, bo metal siedzi w częściach. */
  towScrapRatio: 0.35,
  /** Ile kampanii naraz może prowadzić jedna frakcja. */
  maxCampaignsPerFaction: 2,
  /**
   * Siła garnizonu kryjówki pirackiej i tempo jej odbudowy (punkty/godzinę).
   *
   * Piraci nie mają stoczni ani podzespołów — łatają zdobyczne kadłuby, więc
   * odbudowują się wolno i nigdy powyżej sufitu. Bez garnizonu rajd na
   * kryjówkę jest darmowy: zmierzone 10 bitew, 10 zwycięstw atakującego,
   * zero strat po stronie broniącej się i zero wraków z jej kadłubów.
   */
  raiderGarrison: 55,
  raiderRegenPerHour: 9,

  /**
   * Ile amunicji zjada JEDEN punkt siły w kampanii.
   *
   * To jest jedyne miejsce, w którym wojna kosztuje coś BIEŻĄCO. Okręt kupuje
   * się raz; amunicja znika przy każdym starciu i musi płynąć bez przerwy,
   * dopóki trwa wojna. Dzięki temu blokada amunicjowni jest realną bronią
   * ekonomiczną — flota stoi w porcie mimo pełnego zapasu kadłubów.
   *
   * Proporcje odpowiadają temu, czym te okręty naprawdę strzelają (patrz
   * `WARSHIP_CLASSES.build`): najwięcej kinetycznej, mniej flaku do osłony
   * przeciwlotniczej, garść pocisków na cele ciężkie.
   */
  ammoPerPower: Object.freeze({
    ammo_kinetic: 8,
    flak_shell: 2,
    // Pociski są drogie i produkuje się ich mało — flota strzela nimi do celów
    // twardych, nie zamiast dział. Przy 1 rakiecie na punkt siły jedna kampania
    // zjadała roczną produkcję amunicjowni.
    missile_round: 0.5,
    torpedo_round: 0.1
  }),
  /**
   * Poniżej tego pokrycia zapotrzebowania wyprawa w ogóle nie wypływa.
   *
   * Nie zero, bo flota z połową amunicji nadal może uderzyć — tylko słabiej.
   * Zero oznaczałoby, że jedna pusta skrzynia unieruchamia całą kampanię,
   * a to jest tak samo nieprawdziwe jak dzisiejszy brak kosztu.
   */
  minAmmoRatio: 0.35
});

/** Ile amunicji potrzebuje flota o zadanej sile. */
export function ammoForPower(power, config = WAR_MODEL) {
  const sila = Math.max(0, Number(power) || 0);
  const out = {};
  for (const [id, perPower] of Object.entries(config.ammoPerPower || {})) {
    const ile = perPower * sila;
    if (ile > 0) out[id] = ile;
  }
  return out;
}

/**
 * Zdejmuje amunicję z magazynu portu. Zwraca, JAKĄ CZĘŚĆ zapotrzebowania udało
 * się pokryć — bo od tego zależy, czy wyprawa w ogóle ma sens.
 *
 * Bierze proporcjonalnie do dostępności każdej pozycji: flota bez torped nadal
 * strzela z dział, tylko słabiej. Braki liczą się przez najgorzej zaopatrzoną
 * pozycję, więc jeden pusty magazyn realnie osłabia całość.
 */
export function drawAmmo(econ, power, config = WAR_MODEL) {
  const potrzeba = ammoForPower(power, config);
  const ids = Object.keys(potrzeba);
  if (!ids.length) return { ratio: 1, taken: {} };
  if (!econ?.resources) return { ratio: 0, taken: {} };

  // Pokrycie liczymy jako ŚREDNIĄ WAŻONĄ WARTOŚCIĄ, nie jako minimum po
  // pozycjach. Minimum brzmi ostrożnie, a znaczy „jedna pusta skrzynia torped
  // unieruchamia całą flotę" — zmierzone: 71 wypraw odwołanych z rzędu, zero
  // bitew przez cztery godziny, bo torpedy rozeszły się po innych portach.
  // Waga wartościowa mówi to, co trzeba: brak drogiej amunicji boli bardziej
  // niż brak taniej, ale niczego nie blokuje na zero.
  let waga = 0;
  let pokryte = 0;
  const taken = {};
  for (const id of ids) {
    const need = potrzeba[id];
    if (!(need > 0)) continue;
    const stan = Math.max(0, Number(econ.resources[id]) || 0);
    const wziete = Math.min(stan, need);
    const w = need * (RESOURCES[id]?.value || 1);
    waga += w;
    pokryte += w * (wziete / need);
    if (wziete > 0) {
      econ.resources[id] = stan - wziete;
      taken[id] = wziete;
    }
  }
  const ratio = waga > 0 ? Math.max(0, Math.min(1, pokryte / waga)) : 1;
  return { ratio, taken, needed: potrzeba };
}

/**
 * Zgłasza porcie zapotrzebowanie na amunicję.
 *
 * `stationWantsResource` widzi wyłącznie wsad receptur i zużycie bytowe, więc
 * bez tego haka transport NIE WIE, że do portu wojennego trzeba wozić skrzynie —
 * dokładnie ten sam problem, który miały stocznie z podzespołami.
 */
export function declareAmmoDemand(stations, config = WAR_MODEL) {
  const ids = Object.keys(config.ammoPerPower || {});
  if (!ids.length) return 0;
  let ile = 0;
  for (const station of stations || []) {
    if (!station?.factionId) continue;
    // Skrzynie wozi się tam, gdzie stacjonuje flota — czyli do ośrodków
    // przemysłowych. Kopalnia bez fabryki nie ma czym strzelać ani czego bronić.
    if (militaryScale(getStationIndustry(station)) <= 0) continue;
    const juz = new Set(station.extraDemand || []);
    for (const id of ids) juz.add(id);
    station.extraDemand = [...juz];
    ile++;
  }
  return ile;
}

/**
 * Ile złomu zostaje po zatopionym okręcie.
 *
 * Liczone z MASY podzespołów, nie z ich ceny — złom to metal, a nie wartość.
 * Dzięki temu nosiciel daje go kilkanaście razy więcej niż fregata, tak jak
 * kilkanaście razy więcej go kosztował.
 */
export function scrapFromWreck(classId, recovery = WAR_MODEL.scrapRecovery) {
  const cls = WARSHIP_CLASSES[classId];
  if (!cls) return 0;
  let mass = 0;
  for (const [resourceId, qty] of Object.entries(cls.build)) {
    mass += (RESOURCES[resourceId]?.mass || 0) * qty;
  }
  const scrapMass = RESOURCES.scrap?.mass || 1;
  return (mass * recovery) / scrapMass;
}

/**
 * Co da się wyjąć z wraku. Dwie ścieżki, tak jak w `salvage.js`.
 *
 *   'cut'  — cięcie w polu: szybko, sam złom, podzespoły przepadają.
 *            Nie da się odkręcić działa bez doku.
 *   'tow'  — holowanie do stacji: podzespoły w całości, złomu mniej,
 *            bo metal został w odzyskanych częściach.
 *
 * To rozróżnienie jest CAŁĄ treścią złomiarstwa. Bez niego zbieranie jest
 * jednym przyciskiem; z nim to decyzja: brać mało i szybko czy dużo i wolno.
 */
export function salvageManifest(classId, mode = 'tow', config = WAR_MODEL) {
  const cls = WARSHIP_CLASSES[classId];
  if (!cls) return { scrap: 0, components: {}, value: 0, mass: 0 };

  const components = {};
  let value = 0;
  let mass = 0;

  if (mode === 'tow') {
    for (const [resourceId, qty] of Object.entries(cls.build)) {
      const recovered = Math.floor(qty * config.towComponentRecovery);
      if (recovered <= 0) continue;
      components[resourceId] = recovered;
      value += (RESOURCES[resourceId]?.value || 0) * recovered;
      mass += (RESOURCES[resourceId]?.mass || 0) * recovered;
    }
  }

  const scrap = scrapFromWreck(classId, mode === 'tow'
    ? config.scrapRecovery * config.towScrapRatio
    : config.scrapRecovery);
  value += (RESOURCES.scrap?.value || 0) * scrap;
  mass += (RESOURCES.scrap?.mass || 0) * scrap;

  return { scrap, components, value, mass };
}

/** Ile wrak jest wart przy lepszej z dwóch ścieżek — wejście dla decyzji. */
export function wreckValue(classId, config = WAR_MODEL) {
  return Math.max(
    salvageManifest(classId, 'tow', config).value,
    salvageManifest(classId, 'cut', config).value
  );
}

export function createWarState(options = {}) {
  return {
    config: { ...WAR_MODEL, ...(options.config || {}) },
    /** Kampanie w drodze: { courseId, attacker, defender, targetId, ships, power }. */
    campaigns: [],
    /** Siła kryjówek pirackich — osobno od zapasu stoczni, bo ich nie mają. */
    garrisons: new Map(),
    /** Wraki czekające na złomiarzy: { id, x, y, scrap, factionId, classId }. */
    wrecks: [],
    sinceDecision: 0,
    nextWreckId: 1,
    log: [],
    stats: {
      launched: 0, battles: 0, attackerWins: 0, defenderWins: 0,
      shipsLost: 0, scrapCreated: 0, byClass: {},
      /** Wyprawy odwołane z braku amunicji i wartość spalonych skrzyń w CR. */
      abortedNoAmmo: 0, ammoSpent: 0, defenderNoAmmo: 0
    }
  };
}

// ============================================================
// Decyzja: czy i na kogo
// ============================================================

/**
 * Ile siły broni danej stacji.
 *
 * Zapas frakcji rozkłada się na jej stacje po równo. To uproszczenie, ale
 * niesie właściwą konsekwencję: frakcja z wieloma stacjami broni każdej
 * słabiej, więc rozrost terytorialny ma cenę.
 */
export function defenseAt(shipyards, stations, stationId, war = null) {
  const station = stations.find(s => s.id === stationId);
  if (!station?.factionId) return 0;
  // Kryjówka broni się garnizonem, nie zapasem stoczni — piraci jej nie mają.
  const garrison = war?.garrisons?.get(stationId);
  if (garrison !== undefined) return garrison;
  const own = stations.filter(s => s.factionId === station.factionId).length || 1;
  return fleetPower(shipyards, station.factionId) / own;
}

/** Czy stacja broni się garnizonem (kryjówka) zamiast flotą frakcji. */
export function isRaiderNest(station) {
  return station?.factionId === 'pirates';
}

/**
 * Wybiera cel wyprawy: najsłabiej broniona stacja wrogiej frakcji.
 *
 * Świadomie NIE bierze pod uwagę wartości celu — frakcje w tej symulacji nie
 * prowadzą wojny o zdobycz, tylko o to, żeby przeciwnik przestał produkować.
 * Gdy dojdzie zdobywanie stacji, tu wejdzie drugi składnik.
 */
export function pickTarget(war, shipyards, stations, attackerId, strength) {
  let best = null;
  let bestDefense = Infinity;

  for (const station of stations) {
    if (!station.factionId || station.factionId === attackerId) continue;
    if (!areFactionsHostile(attackerId, station.factionId)) continue;
    // Jedna kampania na cel — inaczej cała siła frakcji leci w to samo miejsce.
    if (war.campaigns.some(c => c.targetId === station.id)) continue;

    const defense = defenseAt(shipyards, stations, station.id, war);
    if (strength < defense * war.config.minAdvantage) continue;
    if (defense < bestDefense) { bestDefense = defense; best = station; }
  }
  return best ? { station: best, defense: bestDefense } : null;
}

// ============================================================
// Bitwa
// ============================================================

/**
 * Rozstrzyga starcie. Zwraca straty obu stron w sztukach.
 *
 * Model jest celowo prosty: o wyniku decyduje stosunek sił, a losowość tylko
 * go rozmywa. Chodzi o to, żeby przewaga liczyła się przewidywalnie — gracz
 * ma móc ocenić, czy warto uderzyć, zanim uderzy.
 *
 * Straty rozkładają się PROPORCJONALNIE do składu, więc flota fregat traci
 * fregaty, a nie „równowartość w nosicielach". To ma znaczenie dla złomu:
 * z dwudziestu fregat zostaje inna ilość metalu niż z dwóch krążowników.
 */
export function resolveBattle(attackerShips, attackerPower, defenderPower, rng = Math.random) {
  const config = WAR_MODEL;
  const total = attackerPower + defenderPower;
  if (total <= 0) return { attackerWins: false, attackerLossRatio: 0, defenderLossRatio: 0 };

  // Przewaga rozstrzyga, ale nie determinuje: 0,5 to rzut, 3:1 to niemal pewne.
  const edge = attackerPower / total;
  const roll = rng();
  const attackerWins = roll < edge;

  // Wygrany traci mniej, ale nigdy nic. Bitwa bez strat nie robi wraków.
  const attackerLossRatio = attackerWins
    ? config.attackerLoss * (1 - edge) * 1.4
    : config.attackerLoss * (0.6 + edge);
  const defenderLossRatio = attackerWins
    ? config.defenderLoss * (0.6 + (1 - edge))
    : config.defenderLoss * edge * 1.4;

  return {
    attackerWins,
    edge,
    attackerLossRatio: Math.min(1, Math.max(0.05, attackerLossRatio)),
    defenderLossRatio: Math.min(1, Math.max(0.05, defenderLossRatio))
  };
}

/** Zamienia ułamek strat na konkretne kadłuby, proporcjonalnie do składu. */
function shipsLost(ships, ratio) {
  const lost = {};
  for (const [classId, count] of Object.entries(ships || {})) {
    const n = Math.min(count, Math.round(count * ratio));
    if (n > 0) lost[classId] = n;
  }
  // Starcie zawsze kogoś kosztuje — inaczej małe potyczki nie robią wraków.
  if (!Object.keys(lost).length) {
    const first = Object.entries(ships || {}).find(([, count]) => count > 0);
    if (first) lost[first[0]] = 1;
  }
  return lost;
}

function emitWrecks(war, lost, factionId, x, y) {
  let scrap = 0;
  for (const [classId, count] of Object.entries(lost)) {
    for (let i = 0; i < count; i++) {
      const amount = scrapFromWreck(classId, war.config.scrapRecovery);
      scrap += amount;
      war.wrecks.push({
        id: `wrak-${war.nextWreckId++}`,
        classId, factionId, scrap: amount,
        /** Ile wart jest po przyholowaniu — od tego zależy, czy ktoś poleci. */
        value: wreckValue(classId, war.config),
        // Rozrzut wokół pobojowiska. Bez niego wraki układają się w punkt
        // i złomiarze lecą wszyscy w to samo miejsce — ten sam błąd, który
        // trzykrotnie wracał przy kursach, dokach i wrakach po piratach.
        x: x + (Math.random() - 0.5) * 4000,
        y: y + (Math.random() - 0.5) * 4000,
        claimed: false
      });
      war.stats.byClass[classId] = (war.stats.byClass[classId] || 0) + 1;
      war.stats.shipsLost++;
    }
  }
  war.stats.scrapCreated += scrap;
  return scrap;
}

// ============================================================
// Krok
// ============================================================

/**
 * Jeden krok wojny.
 *
 * `options`: { shipyards, stations, network, registry, rng, now }
 * Zwraca zdarzenia — wywołujący decyduje, co z nimi zrobić (log, VFX, dźwięk).
 */
export function tickWar(war, dt, options = {}) {
  const { shipyards, stations, network, registry } = options;
  if (!shipyards || !stations?.length) return [];
  const rng = options.rng || Math.random;
  const events = [];
  const step = Math.max(0, Number(dt) || 0);

  // 1. Kampanie w drodze — czy dotarły.
  for (let i = war.campaigns.length - 1; i >= 0; i--) {
    const campaign = war.campaigns[i];
    const course = registry?.byId?.get?.(campaign.courseId)
      || registry?.courses?.find(c => c.id === campaign.courseId);

    // Kurs zniknął z rejestru (dotarł albo został rozbity) — rozstrzygamy.
    if (!course || course.status !== 'active') {
      war.campaigns.splice(i, 1);

      // Wyprawa rozbita w drodze przez piratów nie dolatuje do bitwy, ale
      // i tak zostawia wraki. Flota zniszczona po drodze jest stracona tak
      // samo jak w bitwie — to jest ta konsekwencja, o którą chodziło.
      if (course && course.status === 'wrecked') {
        const scrap = emitWrecks(war, campaign.ships, campaign.attacker,
          course.wreckX ?? campaign.x ?? 0, course.wreckY ?? campaign.y ?? 0);
        events.push({ type: 'campaign-lost', attacker: campaign.attacker, scrap });
        continue;
      }

      const target = stations.find(s => s.id === campaign.targetId);
      if (!target?.factionId) continue;

      // Obrońca też pali amunicję — inaczej obrona byłaby darmowa i blokada
      // portu nie miałaby żadnego skutku militarnego.
      const surowaObrona = defenseAt(shipyards, stations, campaign.targetId, war);
      const zapasObroncy = typeof options.getEconomy === 'function' && !isRaiderNest(target)
        ? drawAmmo(options.getEconomy(target.id), surowaObrona, war.config)
        : { ratio: 1, taken: {} };
      if (zapasObroncy.ratio < war.config.minAmmoRatio) war.stats.defenderNoAmmo++;
      const defense = surowaObrona * (0.5 + 0.5 * zapasObroncy.ratio);
      war.stats.ammoSpent += Object.entries(zapasObroncy.taken)
        .reduce((sum, [id, qty]) => sum + qty * (RESOURCES[id]?.value || 0), 0);
      const wynik = resolveBattle(campaign.ships, campaign.power, defense, rng);

      const attackerLost = shipsLost(campaign.ships, wynik.attackerLossRatio);
      // Ginące okręty liczymy od SUROWEJ siły garnizonu: brak amunicji obniża
      // celność, nie liczbę kadłubów stojących w porcie.
      const zbite = surowaObrona * wynik.defenderLossRatio;

      let obronaStracona;
      if (isRaiderNest(target)) {
        // Kryjówka traci garnizon, nie okręty ze stoczni. Wraki liczymy po
        // sile — piraci latają zdobycznym, więc nie mają własnych klas.
        war.garrisons.set(campaign.targetId, Math.max(0, surowaObrona - zbite));
        obronaStracona = { frigate: Math.max(1, Math.round(zbite)) };
      } else {
        obronaStracona = takeShips(shipyards, target.factionId, zbite).ships;
      }

      const scrap = emitWrecks(war, attackerLost, campaign.attacker, target.x, target.y)
        + emitWrecks(war, obronaStracona, target.factionId, target.x, target.y);

      // Ocalali atakującego wracają — ale nie wszyscy. Odwrót też kosztuje.
      const ocalali = {};
      for (const [classId, count] of Object.entries(campaign.ships)) {
        const left = count - (attackerLost[classId] || 0);
        const wraca = Math.floor(left * war.config.retreatFraction);
        if (wraca > 0) ocalali[classId] = wraca;
      }
      returnShips(shipyards, campaign.attacker, ocalali);

      war.stats.battles++;
      if (wynik.attackerWins) war.stats.attackerWins++; else war.stats.defenderWins++;
      events.push({
        type: 'battle', attacker: campaign.attacker, defender: target.factionId,
        targetId: campaign.targetId, attackerWins: wynik.attackerWins, scrap
      });
    }
  }

  // 2. Nowe kampanie.
  // Kryjówki odbudowują garnizon — inaczej po pierwszej fali rajdów piractwo
  // znika z układu na dobre i wraz z nim znika źródło złomu.
  for (const station of stations) {
    if (!isRaiderNest(station)) continue;
    const teraz = war.garrisons.get(station.id) ?? war.config.raiderGarrison;
    war.garrisons.set(station.id,
      Math.min(war.config.raiderGarrison, teraz + (war.config.raiderRegenPerHour * step) / 3600));
  }

  war.sinceDecision += step;
  if (war.sinceDecision < war.config.decisionSeconds) return events;
  war.sinceDecision = 0;

  const factions = [...new Set(stations.map(s => s.factionId).filter(Boolean))];
  for (const attackerId of factions) {
    const trwajace = war.campaigns.filter(c => c.attacker === attackerId).length;
    if (trwajace >= war.config.maxCampaignsPerFaction) continue;

    const zapas = fleetPower(shipyards, attackerId);
    const dostepne = zapas * war.config.commitFraction;
    if (dostepne < war.config.minStrength) continue;

    const cel = pickTarget(war, shipyards, stations, attackerId, dostepne);
    if (!cel) continue;

    const baza = stations.find(s => s.factionId === attackerId);
    if (!baza) continue;

    const wyprawa = takeShips(shipyards, attackerId, dostepne);
    if (wyprawa.power <= 0) continue;

    // AMUNICJA. Flota bez skrzyń nie wypływa — i to jest ten moment, w którym
    // logistyka zaczyna decydować o wojnie, a nie tylko ją obsługiwać.
    const zaopatrzenie = typeof options.getEconomy === 'function'
      ? drawAmmo(options.getEconomy(baza.id), wyprawa.power, war.config)
      : { ratio: 1, taken: {} };
    if (zaopatrzenie.ratio < war.config.minAmmoRatio) {
      returnShips(shipyards, attackerId, wyprawa.ships);
      war.stats.abortedNoAmmo++;
      events.push({
        type: 'no-ammo', attacker: attackerId, stationId: baza.id,
        ratio: zaopatrzenie.ratio
      });
      continue;
    }

    const trasa = network ? chooseRoute(network, baza.id, cel.station.id, { mass: 0, value: 0 }) : null;
    const course = registry ? launchCourse(registry, {
      kind: COURSE_KIND.WAR,
      factionId: attackerId,
      originId: baza.id,
      destinationId: cel.station.id,
      unitClass: 'warfleet',
      // Odcinki trasy to `{ from, to }`, a kurs oczekuje etapów z `travelStage`.
      // Bez tego przemapowania `launchCourse` odrzucał KAŻDĄ wyprawę po cichu
      // i wojna nie zaczynała się mimo poprawnej decyzji dyspozytora.
      stages: trasa?.legs?.length
        ? trasa.legs.map(leg => travelStage(leg.from, leg.to, {
            seconds: leg.seconds, distance: leg.distance, mode: leg.mode
          }))
        : [travelStage(baza.id, cel.station.id, { seconds: 600, distance: 0 })],
      fuelCapacity: 0
    }) : null;

    if (registry && !course) { returnShips(shipyards, attackerId, wyprawa.ships); continue; }

    war.campaigns.push({
      courseId: course?.id || `kampania-${war.stats.launched}`,
      attacker: attackerId,
      targetId: cel.station.id,
      ships: wyprawa.ships,
      // Niedobór amunicji nie zabiera okrętów, tylko ich skuteczność: te same
      // kadłuby biją się słabiej, bo oszczędzają ogień.
      power: wyprawa.power * (0.5 + 0.5 * zaopatrzenie.ratio),
      ammoRatio: zaopatrzenie.ratio,
      ammoUsed: zaopatrzenie.taken,
      x: baza.x, y: baza.y
    });
    war.stats.ammoSpent += Object.entries(zaopatrzenie.taken)
      .reduce((sum, [id, qty]) => sum + qty * (RESOURCES[id]?.value || 0), 0);
    war.stats.launched++;
    events.push({
      type: 'campaign', attacker: attackerId, targetId: cel.station.id,
      power: wyprawa.power, defense: cel.defense
    });
  }

  return events;
}

/** Migawka do panelu. */
export function summarizeWar(war) {
  return {
    campaigns: war.campaigns.length,
    wrecks: war.wrecks.length,
    scrapWaiting: Math.round(war.wrecks.reduce((sum, w) => sum + (w.claimed ? 0 : w.scrap), 0)),
    stats: { ...war.stats, byClass: { ...war.stats.byClass } }
  };
}
