/**
 * PATROLE — bezpieczeństwo szlaku jako wielkość ekonomiczna.
 *
 * Do tej pory `piracyPressure` był globalnym suwakiem: cały układ był tak samo
 * groźny i nic nie dało się z tym zrobić. Patrole zamieniają to w wielkość
 * LOKALNĄ i EMERGENTNĄ — frakcja płaci za osłonę szlaku, osłona zbija tam
 * ryzyko, a pieniądze biorą się z opłaty od przewiezionego towaru.
 *
 * Domyka to pętlę, której brakowało: rozbijesz patrole → presja rośnie →
 * fracht ucieka na bramy i warp → rosną koszty → ceny się przesuwają. Gracz
 * dostaje dźwignię na gospodarkę, która nie jest osobną mechaniką, tylko
 * skutkiem strzelania do tego, co lata.
 *
 * Frakcja nie pilnuje wszystkiego po równo — pilnuje tam, gdzie TRACI. Patrol
 * idzie na szlak z największymi stratami, bo tylko tam się zwraca.
 */

import {
  COURSE_KIND, COURSE_STATUS, DWELL_REASON, launchCourse, travelStage, dwellStage, getCourse
} from './courseRegistry.js';
import { berthFits, berthRole, BERTH_ROLE } from './dockLayout.js';
import { getNode } from './travelNetwork.js';
import { WARSHIP_CLASSES, readyShips } from './shipyards.js';
import { TRAFFIC_CONVENTIONAL } from '../../data/driveModes.js';

export const PATROL_MODEL = Object.freeze({
  /** Ułamek wartości dostawy odkładany na patrole. To jest podatek od handlu. */
  levyRate: 0.04,
  /**
   * Koszt utrzymania jednostki siły patrolu przez jeden cykl gospodarczy (20 s).
   *
   * Skalibrowane wobec WPŁYWÓW, nie z sufitu: przy 4% opłaty od handlu układ
   * odkłada ~80 tys. CR na godzinę, a cykli jest 180. Pierwsza wersja (900)
   * kosztowała 162 tys. CR/h za jeden punkt siły — patrole powstawały i ginęły
   * w tym samym cyklu (zmierzone: 55 ufundowanych, 55 rozwiązanych, zero
   * stojących). Przy 60 CR układ utrzymuje kilkanaście punktów osłony.
   */
  upkeepPerCycle: 60,
  /** Jak mocno jednostka siły zbija ryzyko: `chance / (1 + siła × factor)`. */
  suppressionFactor: 0.8,
  /** Maksymalna siła na jednym szlaku — patrol nie czyni trasy nietykalną. */
  maxStrength: 5,
  /** Ile cykli pamiętamy straty. Stare napaści przestają uzasadniać wydatek. */
  lossMemory: 0.6,
  /** Poniżej tylu strat na szlaku patrol się nie zwraca. */
  minLossToFund: 2_000
});

/** Klucz szlaku jest NIESKIEROWANY — patrol pilnuje trasy w obie strony. */
export function laneKey(fromId, toId) {
  const a = String(fromId || '');
  const b = String(toId || '');
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function createPatrolRegistry() {
  return {
    /** `frakcja` → odłożone środki na osłonę. */
    budgets: new Map(),
    /** `szlak` → { strength, factionId, fundedAt }. */
    lanes: new Map(),
    /** `szlak` → wartość strat w ostatnich cyklach. */
    losses: new Map(),
    stats: { funded: 0, disbanded: 0, levy: 0, spent: 0, suppressed: 0 }
  };
}

// ============================================================
// Pieniądze
// ============================================================

/**
 * Opłata od dostarczonego towaru. Patrole są finansowane z handlu, który
 * chronią — bez tego byłyby darmowe, a wtedy nie byłoby czego rozbijać.
 */
export function collectLevy(registry, factionId, value, options = {}) {
  const id = String(factionId || '');
  if (!id) return 0;
  const rate = Number(options.levyRate ?? PATROL_MODEL.levyRate);
  const kwota = Math.max(0, Number(value) || 0) * rate;
  registry.budgets.set(id, (registry.budgets.get(id) || 0) + kwota);
  registry.stats.levy += kwota;
  return kwota;
}

export function budgetOf(registry, factionId) {
  return registry.budgets.get(String(factionId || '')) || 0;
}

/** Zapisuje, gdzie frakcja traci towar. To jest wejście dla decyzji o patrolu. */
export function recordLaneLoss(registry, fromId, toId, value) {
  // Szlak „sam do siebie" to odcinek manewrowy przy porcie, nie trasa. Patrol
  // na nim jest wyrzuconym pieniądzem — a przy stratach liczonych bez tego
  // filtra `earth ↔ earth` potrafił zebrać najsilniejszą osłonę w układzie.
  if (!fromId || !toId || String(fromId) === String(toId)) return null;
  const key = laneKey(fromId, toId);
  registry.losses.set(key, (registry.losses.get(key) || 0) + Math.max(0, Number(value) || 0));
  return key;
}

// ============================================================
// Decyzja: gdzie postawić patrol
// ============================================================

/**
 * Rozdziela budżet frakcji na szlaki o największych stratach.
 *
 * Uruchamiane raz na cykl gospodarczy. Utrzymanie schodzi z budżetu, a patrol
 * bez pieniędzy jest rozwiązywany — bezpieczeństwo nie jest darmowe i nie trwa
 * wiecznie samo z siebie.
 */
export function planPatrols(registry, options = {}) {
  const model = { ...PATROL_MODEL, ...(options.model || {}) };
  const laneFaction = typeof options.laneFaction === 'function' ? options.laneFaction : () => null;
  const wynik = { funded: [], disbanded: [] };

  // 1. Utrzymanie już istniejących. Kto nie płaci, ten traci osłonę.
  for (const [key, lane] of [...registry.lanes]) {
    const koszt = lane.strength * model.upkeepPerCycle;
    const budzet = budgetOf(registry, lane.factionId);
    if (budzet < koszt) {
      registry.lanes.delete(key);
      registry.stats.disbanded++;
      wynik.disbanded.push(key);
      continue;
    }
    registry.budgets.set(lane.factionId, budzet - koszt);
    registry.stats.spent += koszt;
  }

  // 2. Nowe patrole tam, gdzie strat jest najwięcej.
  const wgStrat = [...registry.losses.entries()]
    .filter(([key, value]) => value >= model.minLossToFund && !registry.lanes.has(key))
    .sort((a, b) => b[1] - a[1]);

  for (const [key] of wgStrat) {
    const [fromId, toId] = key.split('|');
    const factionId = laneFaction(fromId, toId);
    if (!factionId) continue;
    const koszt = model.upkeepPerCycle;
    if (budgetOf(registry, factionId) < koszt) continue;

    registry.budgets.set(factionId, budgetOf(registry, factionId) - koszt);
    registry.stats.spent += koszt;
    registry.stats.funded++;
    registry.lanes.set(key, { strength: 1, factionId, fundedAt: options.now || 0, fromId, toId });
    wynik.funded.push(key);
  }

  // 3. Wzmocnienie tam, gdzie MIMO PATROLU nadal boli.
  //
  // Świeżo postawiony patrol pomijamy: wzmacnianie go tymi samymi stratami,
  // które właśnie uzasadniły jego powstanie, robiło z jednej dużej napaści
  // od razu patrol trzeciego stopnia. Osłona musi najpierw dostać cykl, żeby
  // pokazać, czy wystarcza.
  const swieze = new Set(wynik.funded);
  for (const [key, lane] of registry.lanes) {
    if (swieze.has(key)) continue;
    if (lane.strength >= model.maxStrength) continue;
    const straty = registry.losses.get(key) || 0;
    if (straty < model.minLossToFund * (lane.strength + 1)) continue;
    const koszt = model.upkeepPerCycle;
    if (budgetOf(registry, lane.factionId) < koszt) continue;
    registry.budgets.set(lane.factionId, budgetOf(registry, lane.factionId) - koszt);
    registry.stats.spent += koszt;
    lane.strength++;
  }

  // 4. Pamięć strat wygasa — dawna napaść przestaje uzasadniać wydatek.
  for (const [key, value] of [...registry.losses]) {
    const next = value * model.lossMemory;
    if (next < 1) registry.losses.delete(key);
    else registry.losses.set(key, next);
  }

  return wynik;
}

// ============================================================
// Wpływ na ryzyko
// ============================================================

export function patrolStrength(registry, fromId, toId) {
  return registry?.lanes.get(laneKey(fromId, toId))?.strength || 0;
}

/**
 * Mnożnik ryzyka na szlaku. 1 = brak osłony, mniej = patrolowane.
 *
 * Patrol NIGDY nie sprowadza ryzyka do zera — inaczej opłacałoby się pilnować
 * jednej trasy i wozić tylko nią, a cała mapa zwinęłaby się do jednej linii.
 */
export function patrolMultiplier(registry, fromId, toId, options = {}) {
  const model = { ...PATROL_MODEL, ...(options.model || {}) };
  const strength = patrolStrength(registry, fromId, toId);
  if (strength <= 0) return 1;
  registry.stats.suppressed++;
  return 1 / (1 + strength * model.suppressionFactor);
}

/** Migawka do panelu: gdzie stoi osłona i kto za nią płaci. */
export function summarizePatrols(registry) {
  const lanes = [...registry.lanes.entries()].map(([key, lane]) => ({
    key,
    fromId: lane.fromId,
    toId: lane.toId,
    strength: lane.strength,
    factionId: lane.factionId
  })).sort((a, b) => b.strength - a.strength);

  return {
    count: lanes.length,
    totalStrength: lanes.reduce((sum, lane) => sum + lane.strength, 0),
    lanes,
    budgets: Object.fromEntries([...registry.budgets].map(([id, value]) => [id, Math.round(value)])),
    hotspots: [...registry.losses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    stats: { ...registry.stats }
  };
}

// ============================================================
// Rotacja garnizonu: okręty frakcji w porcie wojskowym
// ============================================================
//
// K-7 to port wojskowy (decyzja użytkownika), a do 2026-10-22 jego hale stały
// puste: zapas okrętów frakcji był liczbą w stoczni, a jedyne kursy wojskowe
// (kampanie) nie miały postoju w żadnym porcie — pomiar na ziarnie 7: przez
// 60 min zajętych 0 ze 112 stanowisk K-7 Ziemi.
//
// Rotacja to WIDOK garnizonu, który i tak stoi przy porcie: okręt wraca
// z patrolu wokół portu, staje na stanowisku wojskowym (postój i tankowanie),
// wylatuje z powrotem. Okręty NIE schodzą z zapasu frakcji — obrona portu
// i kampanie liczą się dokładnie jak wcześniej, więc rotacja nie zmienia ani
// wojny, ani bilansu. Liczba okrętów w rotacji idzie za zapasem frakcji
// (`dutyShare`) i nie przekracza części stanowisk wojskowych (`berthShare`) —
// port nie jest zawalony całą flotą naraz, a kolejka wojskowa nie rośnie.

export const GARRISON_MODEL = Object.freeze({
  /** Jaka część gotowej floty frakcji jest jednocześnie w rotacji przez porty. */
  dutyShare: 0.3,
  /** Ile stanowisk wojskowych mieszczących okręt może zająć rotacja jednego portu. */
  berthShare: 0.6,
  /** Postój i tankowanie przy stanowisku, sekundy gry. */
  serviceSeconds: 1200,
  /** Jak daleko od portu kończy się i zaczyna odcinek patrolu, j. świata. */
  patrolRadius: 250_000,
  /** Co ile sekund gry dowództwo uzupełnia rotację. */
  decisionSeconds: 60,
  /** Ile okrętów najwyżej wchodzi do jednego portu na decyzję — przyloty się rozkładają. */
  launchesPerDecision: 4,
  /** Ilu ocalałych z kampanii wraca do portu domowego kursem (reszta — tylko do zapasu). */
  returnCap: 6
});

/** Najmniejszy okręt wojenny — stanowisko, na które on nie wejdzie, nie liczy się dla rotacji. */
const SMALLEST_WARSHIP_HULL = 'terran_frigate';

export function createGarrisonState(options = {}) {
  return {
    config: { ...GARRISON_MODEL, ...(options.config || {}) },
    /** Kursy w rotacji: { courseId, factionId, stationId, kind: 'rotation' | 'return' }. */
    visits: [],
    sinceDecision: 0,
    /**
     * Własny strumień losowości i własne id kursów. Rotacja nie zmienia
     * gospodarki, więc nie może też przesuwać losowań ani numeracji świata —
     * inaczej każdy bieg rozjeżdżałby się chaotycznie od pierwszej wizyty.
     */
    rngState: (Number(options.seed) >>> 0) || 0x4741524e,
    nextId: 1,
    stats: { rotations: 0, returns: 0 }
  };
}

/** Losowanie rotacji (mulberry32 na stanie garnizonu) — patrz `rngState`. */
function garrisonRandom(garrison) {
  garrison.rngState = (garrison.rngState + 0x6D2B79F5) >>> 0;
  let x = garrison.rngState;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** Stanowiska wojskowe portu, na które wejdzie okręt wojenny. */
export function militaryWarshipBerths(layout) {
  if (!layout?.berths) return 0;
  let count = 0;
  for (const berth of layout.berths) {
    if (berthRole(berth) === BERTH_ROLE.MILITARY && berthFits(berth.cls, SMALLEST_WARSHIP_HULL)) count++;
  }
  return count;
}

/** Porty domowe frakcji, które mają stanowiska wojskowe — tylko tam stoi garnizon. */
export function garrisonPorts(stations, docks, factionId) {
  const out = [];
  for (const station of stations || []) {
    if (!factionId || station.factionId !== factionId) continue;
    const berths = militaryWarshipBerths(docks?.get?.(station.id));
    if (berths > 0) out.push({ station, berths });
  }
  return out;
}

/** Klasa okrętu do kursu: losowo, ale w proporcji do tego, co frakcja ma w zapasie. */
function pickVisitingClass(fleet, rng) {
  let total = 0;
  for (const count of Object.values(fleet || {})) total += Math.max(0, count);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const [classId, count] of Object.entries(fleet)) {
    roll -= Math.max(0, count);
    if (roll < 0) return classId;
  }
  return Object.keys(fleet)[0] || null;
}

/** Etapy wizyty: dolot z patrolu, postój i tankowanie przy stanowisku, wylot na patrol. */
function visitStages(node, patrolPos, entryPos, config) {
  const seconds = config.patrolRadius / TRAFFIC_CONVENTIONAL.speed;
  const leg = { seconds, distance: config.patrolRadius, risk: 0 };
  return [
    travelStage(node.id, node.id, { ...leg, fromPos: patrolPos, toPos: entryPos }),
    // Stanowisko przydziela dyspozytor portu (rola `military` — kurs PATROL).
    dwellStage(node.id, config.serviceSeconds, DWELL_REASON.REFUEL, null, { entryPos }),
    travelStage(node.id, node.id, { ...leg, fromPos: entryPos, toPos: patrolPos })
  ];
}

/** Gdzie dolot kończy się na obrzeżu portu — jak manewry frachtowców, nie w środku planety. */
const PORT_ENTRY_RADIUS = 30_000;

function launchVisit(garrison, registry, network, port, factionId, classId, kind, rng, fromPos = null) {
  const node = getNode(network, port.station.id);
  const hull = WARSHIP_CLASSES[classId]?.hull;
  if (!node || !hull) return null;
  // Powrót z kampanii przylatuje od strony bitwy, rotacja — z dowolnego kierunku patrolu.
  const angle = fromPos
    ? Math.atan2(fromPos.y - node.y, fromPos.x - node.x)
    : rng() * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radius = garrison.config.patrolRadius;
  const patrolPos = { x: node.x + cos * radius, y: node.y + sin * radius };
  const entryPos = { x: node.x + cos * PORT_ENTRY_RADIUS, y: node.y + sin * PORT_ENTRY_RADIUS };
  const course = launchCourse(registry, {
    id: `garrison-${String(garrison.nextId++).padStart(5, '0')}`,
    kind: COURSE_KIND.PATROL,
    factionId,
    unitClass: hull,
    originId: port.station.id,
    destinationId: port.station.id,
    stages: visitStages(node, patrolPos, entryPos, garrison.config),
    fuelCapacity: 0,
    payload: { garrison: kind, classId }
  });
  if (!course) return null;
  garrison.visits.push({ courseId: course.id, factionId, stationId: port.station.id, kind });
  if (kind === 'return') garrison.stats.returns++;
  else garrison.stats.rotations++;
  return course;
}

/**
 * Ocalali z kampanii wracają do portu domowego na postój i tankowanie.
 * Do zapasu frakcji wracają jak wcześniej (`returnShips` w `tickWar`) —
 * kurs tylko pokazuje powrót floty w hali K-7. `fromPos` to miejsce bitwy.
 */
export function launchCampaignReturn(garrison, options, factionId, ships, fromPos) {
  const { stations, docks, network, registry } = options;
  const rng = () => garrisonRandom(garrison);
  if (!garrison || !registry || !network) return 0;
  const ports = garrisonPorts(stations, docks, factionId);
  if (!ports.length) return 0;
  let launched = 0;
  for (const [classId, count] of Object.entries(ships || {})) {
    for (let i = 0; i < count && launched < garrison.config.returnCap; i++) {
      const port = ports[Math.floor(rng() * ports.length)];
      if (launchVisit(garrison, registry, network, port, factionId, classId, 'return', rng, fromPos)) launched++;
    }
  }
  return launched;
}

/**
 * Jeden krok rotacji. `options`: { shipyards, stations, docks, network, registry, rng }.
 * Uzupełnia rotację każdego portu wojskowego do celu: udział portu w stanowiskach
 * frakcji × `dutyShare` gotowej floty, najwyżej `berthShare` stanowisk portu.
 */
export function tickGarrison(garrison, dt, options = {}) {
  const { shipyards, stations, docks, network, registry } = options;
  if (!garrison || !shipyards || !registry || !network || !docks) return;
  const rng = () => garrisonRandom(garrison);

  for (let i = garrison.visits.length - 1; i >= 0; i--) {
    const course = getCourse(registry, garrison.visits[i].courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE) garrison.visits.splice(i, 1);
  }

  garrison.sinceDecision += Math.max(0, Number(dt) || 0);
  if (garrison.sinceDecision < garrison.config.decisionSeconds) return;
  garrison.sinceDecision = 0;

  const active = new Map();
  for (const visit of garrison.visits) {
    active.set(visit.stationId, (active.get(visit.stationId) || 0) + 1);
  }

  for (const [factionId, fleet] of shipyards.fleets) {
    const ports = garrisonPorts(stations, docks, factionId);
    if (!ports.length) continue;
    const ready = readyShips(shipyards, factionId);
    const onDuty = Math.floor(ready * garrison.config.dutyShare);
    if (onDuty <= 0) continue;
    const totalBerths = ports.reduce((sum, port) => sum + port.berths, 0);
    for (const port of ports) {
      const target = Math.min(
        Math.floor(port.berths * garrison.config.berthShare),
        Math.round(onDuty * port.berths / totalBerths));
      let missing = target - (active.get(port.station.id) || 0);
      for (let n = 0; n < garrison.config.launchesPerDecision && missing > 0; n++, missing--) {
        const classId = pickVisitingClass(fleet, rng);
        if (!classId) break;
        if (!launchVisit(garrison, registry, network, port, factionId, classId, 'rotation', rng)) break;
      }
    }
  }
}

/** Migawka do panelu i pomiarów. */
export function summarizeGarrison(garrison) {
  const byStation = {};
  for (const visit of garrison?.visits || []) {
    byStation[visit.stationId] = (byStation[visit.stationId] || 0) + 1;
  }
  return { visits: garrison?.visits.length || 0, byStation, stats: { ...(garrison?.stats || {}) } };
}
