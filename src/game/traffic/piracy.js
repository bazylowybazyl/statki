/**
 * PIRACTWO JAKO GOSPODARKA — nie jako rzut kostką.
 *
 * Do tej pory przechwyt był czystą probabilistyką: `rollPiracy` losował, kurs
 * znikał, ładunek przepadał w próżnię. Piractwo nie miało ani adresu, ani
 * kosztu, ani sposobu, żeby je powstrzymać — nie dało się go zwalczyć, bo nie
 * było czego zwalczać.
 *
 * Tutaj powstaje pętla, w której każdy element ma powód ekonomiczny:
 *
 *   PRZECHWYT  → łup ląduje w najbliższej kryjówce, zamiast wyparować
 *   PASER      → kryjówka sprzedaje łup poniżej ceny, bo nie ma wyboru
 *   PRZEMYTNIK → kupuje tanio u pirata, sprzedaje drogo na rynku legalnym;
 *                to jedyny sposób, w jaki łup zamienia się w kredyty
 *   REJDER     → kryjówka kupuje za te kredyty kolejne rejdy
 *   ŁOWCA      → frakcje płacą nagrodę za ubitego rejdera; nagroda rośnie
 *                z tego, ile na danym szlaku tracą
 *
 * Konsekwencja, o którą chodzi: **piractwo da się zdusić od strony pieniędzy.**
 * Zabij przemytników, a łup gnije w kryjówce i rejdów nie ma za co wysyłać.
 * Zabij rejderów, a szlak jest bezpieczny, dopóki kryjówki nie odłożą na nowe.
 *
 * Rejder jest KURSEM, tak samo jak kampania wojenna i frachtowiec — leci przez
 * tę samą sieć, można go spotkać i zestrzelić.
 */

import {
  COURSE_KIND, launchCourse, travelStage, dwellStage, DWELL_REASON, getCourse
} from './courseRegistry.js';
import { RESOURCES } from '../../data/resources.js';

export const PIRACY_MODEL = Object.freeze({
  /**
   * Ile z przechwyconego ładunku faktycznie trafia do kryjówki.
   *
   * Nie wszystko: część idzie z dymem przy abordażu. To jest powód, dla
   * którego piractwo jest dla gospodarki układu stratą netto, a nie
   * przesunięciem — tona zrabowana jest mniej warta niż tona dowieziona.
   */
  lootRecovery: 0.55,
  /** Po jakiej cenie paser oddaje łup. Nie ma wyboru, więc oddaje tanio. */
  fenceDiscount: 0.42,
  /** Ile kredytów kosztuje wysłanie jednego rejdu. */
  raidCost: 2600,
  /** Ile trwa rejd na szlaku, zanim rejder wróci do kryjówki. */
  raidSeconds: 900,
  /** O ile rejder podnosi ryzyko na pilnowanym przez siebie szlaku. */
  raidThreatMultiplier: 2.4,
  /** Ile rejdów naraz może utrzymać jedna kryjówka. */
  maxRaidsPerNest: 3,
  /** Co ile sekund kryjówki i przemytnicy podejmują decyzje. */
  decisionSeconds: 120,

  /** Ile ładowni ma przemytnik. Mniej niż frachtowiec — liczy się prędkość. */
  smugglerHold: 90,
  /** Ilu przemytników naraz obsługuje jedną kryjówkę. */
  maxSmugglersPerNest: 4,
  /** Marża, poniżej której przemyt się nie opłaca mimo taniego zakupu. */
  smugglerMinMargin: 0.25,
  /**
   * Szansa wpadki przemytnika na czystym szlaku i mnożnik od siły patroli.
   *
   * Przemytnik nie ginie od piratów — ginie od kontroli. Bez tego ryzyka
   * przemyt jest darmowym pieniądzem: zmierzone 159 kursów, zero wpadek,
   * 894 tys. CR utargu kryjówek z niczego.
   *
   * To jest miejsce, w którym danina frakcji na patrole zaczyna działać
   * DWA razy: raz chroniąc własne konwoje, drugi raz dusząc przemyt.
   */
  smugglerCatchBase: 0.08,
  smugglerCatchPerPatrol: 0.11,

  /**
   * Jaki ułamek strat frakcji zasila pulę nagród.
   *
   * Odpowiednik daniny 4%, z której finansują się patrole — z tą różnicą, że
   * patrol liczy się od DOWIEZIONEJ wartości, a nagroda od STRACONEJ. Frakcja,
   * która nic nie traci, nie płaci za łowców.
   */
  bountyFromLosses: 0.18,
  /** Ile kosztuje wysłanie łowcy. */
  hunterCost: 3400,
  /** Szansa, że łowca dopadnie rejdera na szlaku. */
  hunterSuccess: 0.55,
  /** Ile trwa polowanie. */
  huntSeconds: 780
});

export function createPiracyState(options = {}) {
  return {
    config: { ...PIRACY_MODEL, ...(options.config || {}) },
    /** Kryjówki: id → { stationId, loot: {}, credits, raids: [], smugglers: [] }. */
    nests: new Map(),
    /** Aktywne rejdy: { courseId, nestId, fromId, toId }. */
    raids: [],
    /** Aktywne polowania: { courseId, factionId, raidCourseId }. */
    hunts: [],
    /** Kursy przemytnicze: { courseId, nestId, resourceId, units, buy, sell }. */
    smuggles: [],
    /** Pula nagród frakcji: frakcja → kredyty. */
    bounties: new Map(),
    sinceDecision: 0,
    stats: {
      looted: 0, lootValue: 0, fenced: 0, fencedValue: 0,
      raidsLaunched: 0, raidsKilled: 0, huntsLaunched: 0,
      smugglesRun: 0, smugglesCaught: 0, smuggleProfit: 0
    }
  };
}

// ============================================================
// Kryjówki i łup
// ============================================================

export function registerNest(piracy, spec = {}) {
  const id = String(spec.stationId || spec.id || '');
  if (!id) return null;
  const nest = {
    id,
    stationId: id,
    x: Number(spec.x) || 0,
    y: Number(spec.y) || 0,
    loot: {},
    credits: Number(spec.credits) || 0
  };
  piracy.nests.set(id, nest);
  return nest;
}

function nearestNest(piracy, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const nest of piracy.nests.values()) {
    const d = Math.hypot((nest.x || 0) - (x || 0), (nest.y || 0) - (y || 0));
    if (d < bestDist) { bestDist = d; best = nest; }
  }
  return best;
}

/**
 * Łup z przechwyconego kursu trafia do najbliższej kryjówki.
 *
 * Wołane z `strikeCourse`. Wcześniej ładunek po prostu znikał, więc piractwo
 * nic nikomu nie dawało — było podatkiem od transportu, nie stroną w grze.
 */
export function depositLoot(piracy, course, x, y) {
  const nest = nearestNest(piracy, x, y);
  if (!nest) return null;

  const payload = course?.payload;
  const resourceId = payload?.resourceId;
  const units = Number(payload?.units) || 0;
  if (!resourceId || units <= 0) return null;

  const zdobyte = units * piracy.config.lootRecovery;
  nest.loot[resourceId] = (nest.loot[resourceId] || 0) + zdobyte;
  const wartosc = (RESOURCES[resourceId]?.value || 0) * zdobyte;

  piracy.stats.looted += zdobyte;
  piracy.stats.lootValue += wartosc;
  return { nestId: nest.id, resourceId, units: zdobyte, value: wartosc };
}

/** Ile wart jest cały łup kryjówki po cenie pasera. */
export function nestLootValue(nest, config = PIRACY_MODEL) {
  let value = 0;
  for (const [id, qty] of Object.entries(nest.loot)) {
    value += (RESOURCES[id]?.value || 0) * qty * config.fenceDiscount;
  }
  return value;
}

// ============================================================
// Zagrożenie na szlaku
// ============================================================

/**
 * Mnożnik ryzyka na odcinku. Odpowiednik `patrolMultiplier`, tylko w drugą
 * stronę: patrol zbija ryzyko, rejder je podnosi.
 *
 * To jest miejsce, w którym piractwo przestaje być tłem — szlak pilnowany
 * przez rejdera jest MIERZALNIE gorszy, a gdy rejder zginie, wraca do normy.
 */
export function laneThreat(piracy, fromId, toId) {
  if (!piracy?.raids?.length) return 1;
  let mnoznik = 1;
  for (const raid of piracy.raids) {
    const zgodny = (raid.fromId === fromId && raid.toId === toId)
      || (raid.fromId === toId && raid.toId === fromId);
    if (zgodny) mnoznik *= piracy.config.raidThreatMultiplier;
  }
  return mnoznik;
}

// ============================================================
// Krok
// ============================================================

const courseById = getCourse;

/** Kryjówki zamieniają kredyty na rejdy, ale tylko gdy mają na czym zarobić. */
function launchRaids(piracy, options, events) {
  const { stations, registry, rng } = options;
  const config = piracy.config;

  for (const nest of piracy.nests.values()) {
    const wPolu = piracy.raids.filter(r => r.nestId === nest.id).length;
    if (wPolu >= config.maxRaidsPerNest) continue;
    if (nest.credits < config.raidCost) continue;

    // Rejd idzie tam, gdzie coś jeździ. Bez celu w postaci prawdziwego szlaku
    // piraci wisieliby w próżni i nikogo nie spotkali.
    const cele = stations.filter(s => s.factionId && s.factionId !== 'pirates');
    if (cele.length < 2) continue;
    const a = cele[Math.floor((rng ? rng() : Math.random()) * cele.length)];
    const b = cele[Math.floor((rng ? rng() : Math.random()) * cele.length)];
    if (!a || !b || a.id === b.id) continue;

    const course = registry ? launchCourse(registry, {
      kind: COURSE_KIND.RAID,
      factionId: 'pirates',
      originId: nest.id,
      destinationId: nest.id,
      unitClass: 'raider',
      stages: [
        travelStage(nest.id, a.id, { seconds: 240, distance: 0 }),
        dwellStage(a.id, config.raidSeconds, DWELL_REASON.HOLD, { x: a.x, y: a.y }),
        travelStage(a.id, nest.id, { seconds: 240, distance: 0 })
      ],
      fuelCapacity: 0
    }) : null;
    if (registry && !course) continue;

    nest.credits -= config.raidCost;
    piracy.raids.push({
      courseId: course?.id || `rejd-${piracy.stats.raidsLaunched}`,
      nestId: nest.id, fromId: a.id, toId: b.id
    });
    piracy.stats.raidsLaunched++;
    events.push({ type: 'raid', nestId: nest.id, fromId: a.id, toId: b.id });
  }
}

/**
 * Przemytnicy: kupują łup u pasera, sprzedają na rynku legalnym.
 *
 * To jedyna droga, którą łup staje się kredytami — bez przemytników kryjówka
 * siedzi na stosie towaru i nie ma za co wysłać nikogo w pole. Dlatego walka
 * z przemytem jest skuteczniejsza niż walka z samymi rejdami.
 */
function dispatchSmugglers(piracy, options, events) {
  const { stations, registry, getEconomy, priceAt } = options;
  const config = piracy.config;

  for (const nest of piracy.nests.values()) {
    const wPolu = piracy.smuggles.filter(s => s.nestId === nest.id).length;
    if (wPolu >= config.maxSmugglersPerNest) continue;

    // Najcenniejsza pozycja w składzie idzie pierwsza.
    let best = null;
    for (const [resourceId, qty] of Object.entries(nest.loot)) {
      if (qty < 1) continue;
      const wartosc = (RESOURCES[resourceId]?.value || 0);
      if (!best || wartosc * qty > best.wartosc * best.qty) best = { resourceId, qty, wartosc };
    }
    if (!best) continue;

    const buy = best.wartosc * config.fenceDiscount;
    let target = null;
    let bestSell = 0;
    for (const station of stations) {
      if (!station.factionId || station.factionId === 'pirates') continue;
      const sell = typeof priceAt === 'function'
        ? priceAt(station, best.resourceId)
        : best.wartosc;
      if (sell > bestSell) { bestSell = sell; target = station; }
    }
    if (!target || bestSell <= 0) continue;
    if ((bestSell - buy) / Math.max(buy, 1e-6) < config.smugglerMinMargin) continue;

    const units = Math.min(best.qty, config.smugglerHold);
    const course = registry ? launchCourse(registry, {
      kind: COURSE_KIND.HAUL,
      factionId: 'pirates',
      originId: nest.id,
      destinationId: target.id,
      unitClass: 'smuggler',
      payload: { resourceId: best.resourceId, units, value: units * bestSell, smuggler: true },
      stages: [
        travelStage(nest.id, target.id, { seconds: 420, distance: 0 }),
        dwellStage(target.id, 90, DWELL_REASON.SERVICE, { x: target.x, y: target.y })
      ],
      fuelCapacity: 0
    }) : null;
    if (registry && !course) continue;

    nest.loot[best.resourceId] -= units;
    if (nest.loot[best.resourceId] < 0.001) delete nest.loot[best.resourceId];
    piracy.smuggles.push({
      courseId: course?.id || `przemyt-${piracy.stats.smugglesRun}`,
      nestId: nest.id, resourceId: best.resourceId, units,
      buy: buy * units, sell: bestSell * units, targetId: target.id
    });
    events.push({ type: 'smuggle', nestId: nest.id, resourceId: best.resourceId, units });
  }
}

/** Frakcje wystawiają łowców za pieniądze z puli nagród. */
function launchHunters(piracy, options, events) {
  const { stations, registry } = options;
  const config = piracy.config;

  for (const [factionId, pula] of piracy.bounties) {
    if (pula < config.hunterCost) continue;
    // Poluje się na rejdera, nie na kryjówkę — kryjówki są celem wojska.
    const cel = piracy.raids.find(r => !piracy.hunts.some(h => h.raidCourseId === r.courseId));
    if (!cel) continue;
    const baza = stations.find(s => s.factionId === factionId);
    if (!baza) continue;

    const course = registry ? launchCourse(registry, {
      kind: COURSE_KIND.PATROL,
      factionId,
      originId: baza.id,
      destinationId: baza.id,
      unitClass: 'hunter',
      stages: [
        travelStage(baza.id, cel.fromId, { seconds: 300, distance: 0 }),
        dwellStage(cel.fromId, config.huntSeconds, DWELL_REASON.HOLD),
        travelStage(cel.fromId, baza.id, { seconds: 300, distance: 0 })
      ],
      fuelCapacity: 0
    }) : null;
    if (registry && !course) continue;

    piracy.bounties.set(factionId, pula - config.hunterCost);
    piracy.hunts.push({
      courseId: course?.id || `lowca-${piracy.stats.huntsLaunched}`,
      factionId, raidCourseId: cel.courseId
    });
    piracy.stats.huntsLaunched++;
    events.push({ type: 'hunt', factionId, raidCourseId: cel.courseId });
  }
}

/** Frakcja odkłada na nagrody z tego, ile straciła. */
export function recordPirateLoss(piracy, factionId, value) {
  if (!factionId || !(value > 0)) return;
  const teraz = piracy.bounties.get(factionId) || 0;
  piracy.bounties.set(factionId, teraz + value * piracy.config.bountyFromLosses);
}

export function tickPiracy(piracy, dt, options = {}) {
  const { registry, getEconomy } = options;
  const rng = options.rng || Math.random;
  const events = [];
  const config = piracy.config;

  // 1. Polowania — rozstrzygnięcie przed rejdami, żeby ubity rejder nie zdążył
  //    wrócić i od razu wypłynąć jeszcze raz.
  for (let i = piracy.hunts.length - 1; i >= 0; i--) {
    const hunt = piracy.hunts[i];
    const course = courseById(registry, hunt.courseId);
    if (course && course.status === 'active') continue;
    piracy.hunts.splice(i, 1);
    if (course && course.status !== 'done') continue;

    if (rng() >= config.hunterSuccess) continue;
    const idx = piracy.raids.findIndex(r => r.courseId === hunt.raidCourseId);
    if (idx < 0) continue;
    const raid = piracy.raids[idx];
    piracy.raids.splice(idx, 1);
    const raidCourse = courseById(registry, raid.courseId);
    if (raidCourse) raidCourse.status = 'wrecked';
    piracy.stats.raidsKilled++;
    events.push({ type: 'raid-killed', factionId: hunt.factionId, nestId: raid.nestId });
  }

  // 2. Rejdy, które wróciły.
  for (let i = piracy.raids.length - 1; i >= 0; i--) {
    const raid = piracy.raids[i];
    const course = courseById(registry, raid.courseId);
    if (course && course.status === 'active') continue;
    piracy.raids.splice(i, 1);
  }

  // 3. Przemyt, który dotarł albo wpadł.
  for (let i = piracy.smuggles.length - 1; i >= 0; i--) {
    const run = piracy.smuggles[i];
    const course = courseById(registry, run.courseId);
    if (course && course.status === 'active') continue;
    piracy.smuggles.splice(i, 1);

    const nest = piracy.nests.get(run.nestId);
    // Wpadka: albo kurs został rozbity, albo złapała go kontrola na miejscu.
    const patrol = typeof options.patrolStrength === 'function'
      ? options.patrolStrength(run.nestId, run.targetId) : 0;
    const szansaWpadki = Math.min(0.85, config.smugglerCatchBase
      + config.smugglerCatchPerPatrol * Math.max(0, patrol));
    if ((course && course.status !== 'done') || rng() < szansaWpadki) {
      piracy.stats.smugglesCaught++;
      // Towar przepada razem z utargiem — kryjówka zostaje z niczym.
      events.push({ type: 'smuggle-caught', nestId: run.nestId, value: run.sell });
      continue;
    }
    // Towar wchodzi na rynek legalny, kryjówka dostaje kredyty. To jest ten
    // moment, w którym łup staje się pieniądzem i wraca jako kolejny rejd.
    const econ = typeof getEconomy === 'function' ? getEconomy(run.targetId) : null;
    if (econ?.resources) {
      const cap = Number(econ.capacity?.[run.resourceId]) || 0;
      const teraz = Number(econ.resources[run.resourceId]) || 0;
      econ.resources[run.resourceId] = cap > 0 ? Math.min(cap, teraz + run.units) : teraz + run.units;
    }
    if (nest) nest.credits += run.sell;
    piracy.stats.smugglesRun++;
    piracy.stats.fenced += run.units;
    piracy.stats.fencedValue += run.sell;
    piracy.stats.smuggleProfit += run.sell - run.buy;
    events.push({ type: 'smuggled', nestId: run.nestId, value: run.sell });
  }

  piracy.sinceDecision += Math.max(0, Number(dt) || 0);
  if (piracy.sinceDecision < config.decisionSeconds) return events;
  piracy.sinceDecision = 0;

  if (options.stations?.length) {
    launchRaids(piracy, options, events);
    dispatchSmugglers(piracy, options, events);
    launchHunters(piracy, options, events);
  }
  return events;
}

export function summarizePiracy(piracy) {
  const nests = [...piracy.nests.values()].map(nest => ({
    id: nest.id,
    credits: Math.round(nest.credits),
    lootValue: Math.round(nestLootValue(nest, piracy.config)),
    items: Object.keys(nest.loot).length
  }));
  return {
    nests,
    raids: piracy.raids.length,
    hunts: piracy.hunts.length,
    smuggles: piracy.smuggles.length,
    bounties: Math.round([...piracy.bounties.values()].reduce((a, b) => a + b, 0)),
    stats: { ...piracy.stats }
  };
}
