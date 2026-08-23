/**
 * DYSPOZYTOR RUCHU — spina gospodarkę z kursami.
 *
 * To tutaj „wszystko, co lata, ma powód ekonomiczny" przestaje być deklaracją.
 * Dyspozytor patrzy, czego brakuje, wystawia kurs, wybiera napęd rachunkiem
 * kosztów i rozlicza skutek: dostawa powiększa magazyn, wrak go nie powiększa.
 * Zestrzelona flota górnicza to realnie mniej rudy na stacji, nie animacja.
 *
 * Trzy źródła kursów:
 *   PRZEWÓZ    — nadwyżka u jednego, niedobór u drugiego (`planShipment`)
 *   WYDOBYCIE  — surowce, których nie robi żadna stacja: ruda uranu z Kuipera
 *   TANKOWANIE — dowóz paliwa tam, gdzie kursy stają z pustym zbiornikiem
 *
 * Księgowość ładunku zostaje w `cargoFleet.js` — ten moduł tylko ją wywołuje,
 * nigdy nie dotyka magazynów wprost. Dzięki temu niezmiennik „jedna partia,
 * jeden właściciel" pilnują wciąż te same, przetestowane funkcje.
 */

import { RESOURCES, getBagMass, getBagValue } from '../../data/resources.js';
import {
  createShipmentOrder, tryDeliverShipmentOrder, wreckShipmentOrder,
  getBlockedPairs, blockRoute, tickCooldowns, pickVanClass, VAN_CLASSES,
  SHIPMENT_STATUS
} from '../cargoFleet.js';
import {
  runStationEconomy, ECONOMY_CYCLE_SECONDS, getStationDeficits, getStationSurpluses,
  stationWantsResource, stationNetRates
} from '../stationEconomy.js';
import { FACTION, areFactionsHostile, isDerelict } from '../../data/factions.js';
import {
  COURSE_KIND, DWELL_REASON,
  launchCourse, advanceCourses, getActiveCourses, currentStage, stageProgress,
  travelStage, dwellStage, wreckCourse, STAGE_KIND
} from './courseRegistry.js';
import { laneThreat, depositLoot, recordPirateLoss } from './piracy.js';
import {
  chooseRoute, getNode, DRIVE_MODES, interceptChance, randomFieldSpot, approachPoint
} from './travelNetwork.js';
import {
  SHIP_STATE, shouldDeadhead, expectedIdleSeconds,
  assignShipToCourse, releaseShipAt, loseShip, billFreight, billCost, billDeadhead,
  getShip, getCompany, maintainFleet
} from './transportCompanies.js';
import { findBerth, reserveBerth, releaseBerth } from './dockLayout.js';
import {
  createConvoyRegistry, formConvoy, convoyOf, detachCourse,
  convoyInterceptChance, resolveConvoyInterception, escortCost, shouldConvoy,
  summarizeConvoys
} from './convoy.js';
import {
  marketSnapshot, findBestTrade, buyCargo, sellCargo, recordLoss, getAgent,
  agentIsBusy, attachCourses, releaseCourse, caravanEscortCost, maintainCaravan
} from './agentFleets.js';
import {
  createPatrolRegistry, collectLevy, recordLaneLoss, planPatrols,
  patrolMultiplier, summarizePatrols
} from './patrols.js';

/** Ile trwa załadunek i rozładunek. Wchodzi w plan jako etap, nie jako kara. */
const LOAD_SECONDS = 90;
const UNLOAD_SECONDS = 120;

export const DIRECTOR_DEFAULTS = Object.freeze({
  /** Co ile sekund gry dyspozytor próbuje wystawić kolejny kurs. */
  dispatchInterval: 12,
  /** Górny limit kursów w powietrzu. Pomiar mówi, że potrzeba ~50–80. */
  maxActiveCourses: 120,
  /** Mnożnik aktywności piratów. 0 = spokój, 1 = model bazowy. */
  piracyPressure: 1,
  /** Ile ton wyciąga jedna wyprawa górnicza. */
  miningYieldUnits: 120,
  /** Czy piraci w ogóle polują. Wyłączenie pokazuje bilans bez strat. */
  piracyEnabled: true,
  /**
   * Ile razy dyspozytor szuka innej pary, gdy najlepsza jest już obsłużona.
   *
   * `planShipment` zwraca zawsze JEDNĄ, globalnie najlepszą parę. Bez ponawiania
   * z pominięciem obsłużonych dyspozytor odbija się od tego samego zlecenia
   * i przepustowość spada o połowę (zmierzone: 19 kursów/h przy potrzebnych 39).
   */
  dispatchAttempts: 8,
  /** Margines prognozowanego zużycia podczas całej trasy. */
  inboundOvershoot: 1.15,
  /** Zapas roboczy, który ma zostać po pokryciu zużycia w czasie dostawy. */
  inventorySafetyFill: 0.25,
  /**
   * Do ilu jednostek firma odbudowuje flotę. Pomiar mówi, że układ potrzebuje
   * 30–40 statków JEDNOCZEŚNIE W LOCIE przy kursach trwających 20–50 minut,
   * więc łączna flota musi być wyraźnie większa niż liczba kursów na godzinę.
   */
  targetFleetPerCompany: 16,
  /**
   * Ile kursów wolno trzymać na redzie portu NADANIA, liczone jako ułamek jego
   * stanowisk.
   *
   * To jest zawór, bez którego eksport się zatyka: dyspozytor wystawiał
   * z Merkurego dziesiątki kursów naraz, wszystkie czekały na załadunek, a że
   * każdy liczy się jako „towar w drodze" do odbiorcy, żadne NOWE zlecenie już
   * nie powstawało. Ziemia głodowała przy pełnym parkingu pod Merkurym.
   *
   * Przepustowość portu i tak wyznaczają stanowiska — kolejka dłuższa niż one
   * niczego nie przyspiesza, tylko zamraża towar w rekordach.
   */
  loadQueueRatio: 0.6,
  /**
   * Ile pustych przerzutów wolno wystawić na jeden cykl gospodarczy.
   *
   * To jest tempo, w jakim rynek naprawia rozjechany rozkład floty. Za mało —
   * eksporterzy stoją bez statków mimo pełnych magazynów; za dużo — połowa
   * ruchu to przeloty bez ładunku.
   */
  rebalancePerCycle: 12,
  /** Czy kursy wolno wiązać w konwoje. Wyłączenie pokazuje świat samych solistów. */
  convoysEnabled: true,
  /** Górny rozmiar grupy — większa przestaje mieścić się w jednym porcie naraz. */
  maxConvoySize: 8,
  /** Co która wysyłka należy do agentów. 4 = jedna na cztery. */
  agentShare: 4,
  /**
   * Mnożnik przepustowości gospodarki.
   *
   * Liczby w `stationEconomy.js` są skalibrowane pod tempo rozgrywki, nie pod
   * gęstość nieba: dają 5190 t/h, czyli ~39 kursów na godzinę i kilkadziesiąt
   * statków w locie. Żeby nieba było widać setki albo tysiące jednostek, popyt
   * musi urosnąć — a nie da się go „dorysować", bo wtedy ruch przestaje mieć
   * powód.
   *
   * Skalowanie jest LINIOWE i symetryczne: mnożymy produkcję, zużycie i
   * pojemność magazynów tym samym czynnikiem, więc bilans zostaje nietknięty,
   * a rośnie wyłącznie tonaż. Wielkość ładowni się nie zmienia, więc N× większy
   * przepływ to N× więcej kursów.
   */
  economyScale: 1
});

// ============================================================
// Stan
// ============================================================

export function createDirector(network, registry, options = {}) {
  const config = { ...DIRECTOR_DEFAULTS, ...options };
  // Sufit kursów musi rosnąć razem z gospodarką, inaczej stała wartość ucina
  // ruch przy każdej większej skali i wygląda to jak brak popytu.
  if (options.maxActiveCourses === undefined) {
    config.maxActiveCourses = Math.round(DIRECTOR_DEFAULTS.maxActiveCourses * Math.max(1, config.economyScale));
  }
  return {
    network,
    registry,
    config,
    /** Stan floty z cargoFleet — trzyma zlecenia i karencje par. */
    fleet: options.fleet,
    /** Firmy transportowe i ich jednostki. Bez tego kurs powstaje znikąd. */
    companies: options.companies || null,
    /** `Map` stacja → układ doków z `dockLayout.js`. */
    docks: options.docks || new Map(),
    /** `getEconomy(stationId)` → { resources, capacity }. Dostarcza wołający. */
    getEconomy: options.getEconomy,
    /**
     * Gospodarka piracka z `piracy.js`. Bez niej przechwyt nadal działa,
     * tylko ładunek wyparowuje zamiast trafić do kryjówki — czyli tak, jak
     * było, zanim piractwo dostało adres.
     */
    piracy: options.piracy || null,
    /** Opcjonalna integracja świata gry z wrakiem po przechwycie. */
    onWreck: typeof options.onWreck === 'function' ? options.onWreck : null,
    dispatchTimer: 0,
    economyTimer: 0,
    /** Ile kursów wyszło z danego portu — wejście do wyceny pustego powrotu. */
    outboundTally: new Map(),
    /** `stacja:surowiec` → sztuki w drodze. Przeliczany raz na tick. */
    inbound: new Map(),
    /** `stacja:surowiec` → dostawy `{ units, eta }`, do kontroli zapasu w czasie. */
    inboundSchedule: new Map(),
    /** `stacja` → nominalne saldo zasobów/s przy skali gospodarki 1. */
    demandRates: new Map(),
    /** Surowce dostępne u kogokolwiek na zbyciu. Też raz na tick. */
    surplus: new Set(),
    /** `stacja` → ile kursów stoi tam na redzie, czekając na stanowisko. */
    portQueue: new Map(),
    /** `stacja` → ile razy zabrakło tam jednostki do wywiezienia towaru. */
    shipShortage: new Map(),
    /** Konwoje: wiązanie kursów we wspólną pulę ryzyka. */
    convoys: createConvoyRegistry(),
    /** Niezależni kupcy i górnicy — ruch po marżę, nie po niedobór. */
    agents: options.agents || null,
    /** Patrole: bezpieczeństwo szlaku jako wielkość ekonomiczna. */
    patrols: createPatrolRegistry(),
    /** Migawka rynku: sprzedający z zapasem i kupujący wg pilności. */
    market: { sellers: new Map(), buyers: [], cursor: 0 },
    /** Notowania cen — wejście dla agentów, przeliczane raz na tick. */
    quotes: new Map(),
    /** `stacja` → jednostki stojące w porcie, posortowane po ładowni. */
    parked: new Map(),
    /** Wraki czekające na holownik: { nodeId, orderId, at }. */
    wrecks: [],
    /**
     * Runtime-only pamięć rozliczonych zdarzeń kursów.
     *
     * `done` może przyjść z zegara analitycznego albo z fizycznej bańki. WeakMap
     * pozwala bezpiecznie podać to samo zdarzenie drugi raz bez podwójnego
     * rozładunku, naliczenia frachtu lub zwolnienia jednostki, a nie zatrzymuje
     * zakończonych rekordów w pamięci.
     */
    settledCourseEvents: new WeakMap(),
    log: [],
    stats: {
      hauls: 0, mining: 0, delivered: 0, lost: 0, lostValue: 0, stranded: 0,
      deadheads: 0, noShip: 0
    }
  };
}

// ============================================================
// Jednostki i stanowiska
// ============================================================

/** Ile kursów na godzinę wychodzi z portu — do wyceny przestoju. */
function outboundRate(director, stationId) {
  const clockHours = Math.max(0.05, director.registry.clock / 3600);
  return (director.outboundTally.get(String(stationId)) || 0) / clockHours;
}

function countOutbound(director, stationId) {
  const key = String(stationId);
  director.outboundTally.set(key, (director.outboundTally.get(key) || 0) + 1);
}

/**
 * Wysyła jednostkę PUSTĄ tam, gdzie jest praca — jeśli firmę na to stać
 * i jeśli jej się to opłaca. To jest odpowiednik pustego powrotu w transporcie
 * ciężarowym i jedyny mechanizm, który przywraca statki do portów eksportowych.
 *
 * Bez niego jednostki gromadzą się na Ziemi (55% importu układu) i ruch zamiera
 * przy pełnych magazynach nadawców.
 */
function tryDeadhead(director, targetStationId, requiredCapacity) {
  const { registry, network, companies } = director;
  if (!companies) return null;

  // Kandydatów bierzemy z indeksu portów, nie z przemiatania całej floty:
  // najbliższa wolna jednostka z każdego innego portu wystarczy, a jest ich
  // tyle, ile stacji — nie tyle, ile statków.
  const target = getNode(network, targetStationId);
  if (!target) return null;
  const candidates = [];
  for (const [stationId, bucket] of director.parked) {
    if (stationId === String(targetStationId) || !bucket.length) continue;
    // Najpierw szukamy klasy, która udźwignie czekający ładunek. Jeśli jej nie
    // ma, wraca największy dostępny statek — nie blokujemy całego eksportera
    // tylko dlatego, że idealny kadłub stoi gdzie indziej.
    const exact = bucket.find(item => item.ship.capacity >= requiredCapacity);
    const fallback = bucket[bucket.length - 1];
    const minimumUseful = Math.min(Math.max(0, Number(requiredCapacity) || 0),
      VAN_CLASSES[1]?.capacity || 0);
    const entry = exact || (fallback?.ship.capacity >= minimumUseful ? fallback : null);
    const from = getNode(network, stationId);
    if (!entry || !from) continue;
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    // Port zatkany bezczynną flotą jest „bliżej" niż wynika z odległości.
    // Sam dystans kazał brać najbliższą jednostkę, przez co Mars — stocznia,
    // która importuje wszystko i nie eksportuje nic — zbierał 1292 statki
    // i nikt ich stamtąd nie ściągał.
    candidates.push({ ...entry, distance, waga: distance / (1 + Math.log1p(bucket.length)) });
  }
  candidates.sort((a, b) => a.waga - b.waga);

  for (const candidate of candidates.slice(0, 4)) {
    const route = chooseRoute(network, candidate.ship.stationId, targetStationId, {
      mass: 0, value: 0, piracyPressure: director.config.piracyPressure
    });
    if (!route) continue;

    const idle = expectedIdleSeconds(companies, candidate.ship.stationId,
      outboundRate(director, candidate.ship.stationId));
    const verdict = shouldDeadhead(candidate.company, {
      cost: route.cost.total,
      expectedIdleSeconds: idle
    });
    if (!verdict.go) continue;

    const course = launchCourse(registry, {
      kind: COURSE_KIND.HAUL,
      unitClass: candidate.ship.hullId,
      factionId: candidate.company.factionId,
      stages: stagesFromRoute(route, candidate.ship.stationId, targetStationId, {
        loadSeconds: 30,
        unloadSeconds: 30,
        ...manoeuvrePoints(director, candidate.ship.stationId, targetStationId)
      }),
      fuelCapacity: fuelCapacityFor(route),
      originId: candidate.ship.stationId,
      destinationId: targetStationId,
      // Pusty przelot: bez zlecenia i bez ładunku, ale z pełnym kosztem paliwa.
      payload: { deadhead: true, shipId: candidate.ship.id, mode: route.id, mass: 0, value: 0 },
      now: registry.clock
    });
    if (!course) continue;

    assignShipToCourse(candidate.ship, course.id);
    const bucket = director.parked.get(candidate.ship.stationId);
    const at = bucket ? bucket.findIndex(item => item.ship === candidate.ship) : -1;
    if (at >= 0) bucket.splice(at, 1);
    billDeadhead(candidate.company, route.cost.total);
    countOutbound(director, candidate.ship.stationId);
    director.stats.deadheads++;
    note(director, `PUSTY POWRÓT: ${candidate.company.name} ${candidate.ship.stationId}`
      + `→${targetStationId} (${verdict.reason})`);
    return course;
  }
  return null;
}

/**
 * PLANOWE PRZERZUTY PUSTYCH JEDNOSTEK.
 *
 * Pusty powrót wyzwalany dopiero wtedy, gdy kurs nie znajdzie statku, dowozi
 * do portu eksportowego dokładnie tyle, żeby było „prawie zero" — i nigdy nie
 * odbudowuje równowagi. Zmierzone po 5 godzinach: Mars 1555 zaparkowanych,
 * Ziemia 868, a Merkury — największy eksporter układu — **5**, przy 18 tys.
 * ton rudy leżących u niego na zbyciu.
 *
 * Przyczyna jest strukturalna, nie przypadkowa: Ziemia i Mars to importerzy,
 * więc każda dostawa zostawia tam jednostkę na stałe. Prawdziwi przewoźnicy
 * rozwiązują to tak samo — przerzucają flotę tam, gdzie jest ładunek, zanim
 * ktokolwiek o niego poprosi.
 *
 * Uruchamiane rzadko (raz na cykl gospodarczy), bo to decyzja dyspozytorska,
 * nie odruch. Każdy przerzut nadal przechodzi przez `shouldDeadhead`, więc małej
 * firmy na to nie stać i różnica między przewoźnikami zostaje.
 */
function rebalanceFleet(director) {
  const braki = [...director.shipShortage.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!braki.length) return;

  const limit = Math.max(1, Math.round(director.config.rebalancePerCycle));
  let wyslane = 0;

  for (const [stationId, count] of braki) {
    if (wyslane >= limit) break;
    // Ile jednostek brakuje — nie wysyłamy więcej, niż port zdoła obsłużyć.
    const potrzeba = Math.min(count, limit - wyslane, Math.max(1, Math.round(limit / braki.length)));
    for (let i = 0; i < potrzeba; i++) {
      // Planowy rebalans nie zna jeszcze konkretnego manifestu, ale powinien
      // sprowadzać co najmniej zwykłe haulery. Vany 60 t nie domykają strumienia
      // masowych rud przy skali gospodarki ×60.
      if (!tryDeadhead(director, stationId, VAN_CLASSES[1]?.capacity || 0)) break;
      wyslane++;
    }
  }

  // Sygnał wygasa, żeby stary brak nie napędzał przerzutów w nieskończoność.
  for (const [key, count] of director.shipShortage) {
    const next = Math.floor(count * 0.5);
    if (next <= 0) director.shipShortage.delete(key);
    else director.shipShortage.set(key, next);
  }
}

/**
 * Pilnuje, żeby stojący kurs faktycznie zajmował stanowisko w doku, a lecący
 * żadnego nie blokował.
 *
 * Rezerwacja następuje dopiero przy WEJŚCIU w postój, nie przy wysyłce.
 * Rezerwowanie z drugiego końca układu blokuje stanowisko na cały czas dolotu
 * i przepustowość doku spada kilkukrotnie — to zmierzona pułapka z prototypu
 * pasowego, nie przypuszczenie.
 */
function syncBerths(director) {
  if (!director.docks?.size) return;
  director.portQueue.clear();

  for (const course of getActiveCourses(director.registry)) {
    const stage = currentStage(course);
    // Stanowisko należy się temu, kto ma w porcie sprawę: załadunek, rozładunek,
    // obsługę. `EXTRACT` odpada, bo dzieje się w polu, a `HOLD` — bo z definicji
    // jest CZEKANIEM przy węźle, nie postojem przy nabrzeżu. Bez tego drugiego
    // warunku rejder piracki i łowca nagród, których postój to właśnie `HOLD`,
    // cumowali w porcie swojego celu i zajmowali stanowiska frachtowcom.
    const wantsBerth = stage?.kind === STAGE_KIND.DWELL
      && stage.reason !== DWELL_REASON.EXTRACT
      && stage.reason !== DWELL_REASON.HOLD
      && director.docks.has(stage.nodeId);

    if (!wantsBerth) {
      if (course.berthRef) {
        releaseBerth(course.berthRef, director.registry.clock);
        course.berthRef = null;
        course.berthId = null;
      }
      course.blocked = false;
      continue;
    }
    if (course.berthRef) continue;

    const layout = director.docks.get(stage.nodeId);
    const pick = findBerth(layout, course.unitClass, director.registry.clock, { freeOnly: true });
    if (!pick) {
      // Port pełny: kurs STOI, a nie udaje, że się obsługuje. Stąd bierze się
      // kolejka pod stacją — wcześniej stanowiska były ozdobą, bo postój leciał
      // dalej niezależnie od tego, czy jest gdzie stanąć.
      course.blocked = true;
      director.portQueue.set(stage.nodeId, (director.portQueue.get(stage.nodeId) || 0) + 1);
      if (!stage.pos) {
        // Reda: każdy czekający dostaje WŁASNE miejsce.
        //
        // Kąt liczony z czasu startu układał je w jedną kupę, bo dyspozytor
        // wystawia kursy paczkami — kilkanaście w tym samym ticku miało wtedy
        // identyczny kąt. Hash identyfikatora daje stabilny, ale rozrzucony
        // rozkład, a dwa pasma zapobiegają nakładaniu się przy dużej kolejce.
        const node = getNode(director.network, stage.nodeId);
        if (node) {
          const seed = hashId(course.id);
          const angle = (seed % 3600) / 3600 * Math.PI * 2;
          const band = 1.02 + ((seed >> 12) % 5) * 0.045;
          stage.pos = approachPoint(node, layout, angle, band);
        }
      }
      continue;
    }
    course.blocked = false;
    reserveBerth(pick.berth, course.id, director.registry.clock + stage.seconds);
    course.berthRef = pick.berth;
    course.berthId = pick.berth.id;
    // Statek stoi PRZY STANOWISKU, nie w środku planety.
    stage.pos = { x: pick.berth.x, y: pick.berth.y };
  }
}

/** Zwalnia stanowisko i jednostkę po zamknięciu kursu. */
function closeCourseResources(director, course, options = {}) {
  if (course.berthRef) {
    releaseBerth(course.berthRef, director.registry.clock);
    course.berthRef = null;
  }
  if (!director.companies || !course.payload?.shipId) return;
  const ship = getShip(director.companies, course.payload.shipId);
  if (!ship) return;

  if (options.lost) {
    const company = getCompany(director.companies, ship.companyId);
    loseShip(director.companies, company, ship, course.payload?.value || 0);
    return;
  }
  releaseShipAt(ship, options.stationId || course.destinationId, director.registry.clock, {
    completedTrip: !course.payload.deadhead,
    deadhead: !!course.payload.deadhead
  });
}

function note(director, text) {
  director.log.push({ at: director.registry.clock, text });
  if (director.log.length > 200) director.log.shift();
}

// ============================================================
// Budowa planu z wybranej trasy
// ============================================================

/**
 * Przekłada wariant trasy z `travelNetwork` na etapy dla rejestru kursów.
 * Postoje na końcach są częścią planu, bo to one wyznaczają przepustowość
 * stanowisk — a przepustowość jest zadana wprost, nie emergentna.
 */
/** Ile trwa manewr od stanowiska do punktu odejścia. Krótko, ale widocznie. */
const MANOEUVRE_SECONDS = 70;

/**
 * Buduje plan kursu razem z manewrami przy obu portach.
 *
 * Sam przelot to prosta między punktami — w próżni nic nie każe lecieć inaczej
 * i tak ma być. Ale wyjście z portu i wejście do niego prostą ze ŚRODKA PLANETY
 * wyglądało jak teleportacja: statek pojawiał się na orbicie postojowej znikąd.
 * Dlatego trasa zaczyna się i kończy w punktach manewrowych na obrzeżu portu,
 * a dojście do stanowiska jest osobnym, krótkim etapem.
 */
export function stagesFromRoute(route, originId, destinationId, options = {}) {
  const depart = options.departPoint || null;
  const arrive = options.arrivePoint || null;
  const stages = [];

  stages.push(dwellStage(originId, options.loadSeconds ?? LOAD_SECONDS, DWELL_REASON.LOAD, options.originBerthPos));
  if (depart) {
    stages.push(travelStage(originId, originId, {
      mode: 'conventional',
      fromPos: options.originBerthPos || options.originPos,
      toPos: depart,
      seconds: MANOEUVRE_SECONDS,
      risk: 0
    }));
  }

  const legs = route.legs;
  legs.forEach((leg, index) => {
    stages.push(travelStage(leg.from, leg.to, {
      mode: leg.mode,
      distance: leg.distance,
      seconds: leg.seconds,
      fuel: leg.fuel,
      risk: leg.risk,
      fromPos: index === 0 ? depart : null,
      toPos: index === legs.length - 1 ? arrive : null
    }));
  });

  if (arrive) {
    stages.push(travelStage(destinationId, destinationId, {
      mode: 'conventional',
      fromPos: arrive,
      toPos: options.destinationPos,
      seconds: MANOEUVRE_SECONDS,
      risk: 0
    }));
  }
  stages.push(dwellStage(destinationId, options.unloadSeconds ?? UNLOAD_SECONDS, DWELL_REASON.UNLOAD));
  return stages;
}

/**
 * Próbuje zawiązać konwój wokół świeżo wystawionego kursu.
 *
 * Kandydatami są kursy, które NIE ODLECIAŁY jeszcze z tego samego portu w to
 * samo miejsce — czyli stoją pod załadunkiem. Grupowanie czegokolwiek, co już
 * jest w drodze, wymagałoby zawracania, a to nie ma sensu ekonomicznego.
 *
 * Siła osłony rośnie z wielkością grupy, ale rachunek `shouldConvoy` decyduje,
 * czy w ogóle warto: tania masówka na krótkiej trasie zostaje bez eskorty.
 */
function tryFormConvoy(director, course, route) {
  const { convoys, registry, config } = director;
  if (!config.convoysEnabled) return null;
  if (convoyOf(convoys, course.id)) return null;

  const kandydaci = [course];
  for (const other of getActiveCourses(registry)) {
    if (other === course || other.convoyId) continue;
    if (other.originId !== course.originId || other.destinationId !== course.destinationId) continue;
    // Tylko te, które jeszcze nie ruszyły — kurs w drodze nie dołączy do grupy.
    if (other.stageIndex > 0) continue;
    kandydaci.push(other);
    if (kandydaci.length >= config.maxConvoySize) break;
  }
  if (kandydaci.length < 2) return null;

  const wartosc = kandydaci.reduce((sum, entry) => sum + (Number(entry.payload?.value) || 0), 0);
  const sila = Math.max(1, Math.min(4, Math.round(kandydaci.length / 3)));
  const werdykt = shouldConvoy({
    size: kandydaci.length,
    soloChance: route.interceptChance || 0,
    cargoValue: wartosc / kandydaci.length,
    seconds: route.seconds || 0,
    escortPower: sila
  });
  if (!werdykt.go) return null;

  const konwoj = formConvoy(convoys, kandydaci, { escortPower: sila, now: registry.clock });
  if (!konwoj) return null;

  // Osłonę ktoś musi opłacić — koszt dzieli się na uczestników grupy.
  const koszt = escortCost(sila, route.seconds || 0) / kandydaci.length;
  for (const entry of kandydaci) {
    const company = getCompany(director.companies, entry.payload?.companyId);
    if (company) billCost(company, koszt, 'fees');
  }
  note(director, `KONWÓJ ${kandydaci.length} jednostek ${course.originId}→${course.destinationId}`
    + ` (osłona ×${sila})`);
  return konwoj;
}

/**
 * Kurs agenta — ruch po marżę, nie po niedobór.
 *
 * Różni się od frakcyjnego trzema rzeczami: agent PŁACI za towar z własnego
 * kapitału (więc ryzykuje nie tylko statkiem), wybiera cel po zysku na sekundę,
 * a nie po pilności cudzego głodu, i sam odmawia trasy powyżej swojego progu
 * ryzyka. Reszta — kurs, stanowiska, konwoje, bańka — jest wspólna.
 */
function dispatchAgent(director, stations) {
  const { agents, registry, config } = director;
  if (!agents?.agents.length) return { ok: false, reason: 'brak agentów' };

  const wolni = agents.agents.filter(agent => !agentIsBusy(agent));
  if (!wolni.length) return { ok: false, reason: 'wszyscy w drodze' };
  const agent = wolni[Math.floor(Math.random() * wolni.length)];

  // Notowania liczone RAZ na tick, nie przy każdej próbie: to 28 surowców
  // × wszystkie stacje, a agent pyta o nie kilka razy na sekundę gry.
  const okazja = findBestTrade(agent, director.quotes, director.network, {
    piracyPressure: config.piracyPressure
  });
  if (!okazja) { agents.stats.idle++; return { ok: false, reason: 'brak opłacalnej okazji' }; }

  const { opportunity, route } = okazja;
  const sourceEcon = director.getEconomy(opportunity.source.id);
  // Towar przechodzi na własność agenta JUŻ TERAZ — od tej chwili to jego
  // pieniądze lecą przez pas, nie cudze.
  if (!buyCargo(agent, sourceEcon, opportunity.resourceId, opportunity.units, opportunity.buyPrice)) {
    return { ok: false, reason: 'towar zniknął albo brakło kapitału' };
  }

  // Ładunek rozkłada się na frachtowce karawany. KURS ZOSTAJE ATOMEM — jeden
  // statek, jeden manifest, jedno stanowisko w doku — a z grupy robi się konwój,
  // bo to on niesie wspólny rzut na przechwyt i częściową stratę.
  const statki = Math.max(1, Math.min(agent.ships || 1, opportunity.units));
  const naStatek = Math.floor(opportunity.units / statki);
  const reszta = opportunity.units - naStatek * statki;
  const masaSztuki = opportunity.mass / Math.max(1, opportunity.units);
  const punkty = manoeuvrePoints(director, opportunity.source.id, opportunity.target.id);
  // Pusty dolot po towar, jeśli karawana stoi gdzie indziej. Leci NAPRAWDĘ,
  // nie tylko w rachunku — inaczej frachtowce pojawiałyby się u nadawcy znikąd.
  const dojazd = okazja.approach;
  const kursy = [];

  for (let i = 0; i < statki; i++) {
    const units = naStatek + (i < reszta ? 1 : 0);
    if (units <= 0) continue;
    const course = launchCourse(registry, {
      kind: COURSE_KIND.HAUL,
      unitClass: agent.hullId,
      factionId: opportunity.source.factionId ?? null,
      stages: [
        ...(dojazd?.legs || []).map(leg => travelStage(leg.from, leg.to, { ...leg })),
        ...stagesFromRoute(route, opportunity.source.id, opportunity.target.id, punkty)
      ],
      // Zbiornik MUSI objąć oba odcinki. Liczony wyłącznie dla trasy z ładunkiem
      // nie starczał na pusty dolot i kurs stawał bez paliwa na PIERWSZYM etapie:
      // zmierzone w debugu — 13 z 18 kursów agentowych `stranded` na etapie 0,
      // co zamrażało domy handlowe na zawsze (paliwo sprawdza się na wejściu
      // w etap, więc statek nawet nie ruszał).
      fuelCapacity: fuelCapacityFor(route) + (dojazd ? fuelCapacityFor(dojazd) : 0),
      originId: opportunity.source.id,
      destinationId: opportunity.target.id,
      payload: {
        agentId: agent.id,
        resourceId: opportunity.resourceId,
        units,
        mass: units * masaSztuki,
        value: opportunity.sellPrice * units,
        unitPrice: opportunity.sellPrice,
        mode: route.id
      },
      now: registry.clock
    });
    if (course) kursy.push(course);
  }

  if (!kursy.length) {
    // Żaden kurs się nie zawiązał — towar wraca, inaczej wyparuje z gospodarki.
    sellCargo(agent, sourceEcon, opportunity.resourceId, opportunity.units, opportunity.buyPrice);
    return { ok: false, reason: 'plan kursu odrzucony' };
  }

  // Gdyby część kursów odpadła, ich towar wraca na rynek. Inaczej agent
  // zapłaciłby za ładunek, którego nikt nie wiezie.
  const wyslane = kursy.reduce((sum, course) => sum + course.payload.units, 0);
  if (wyslane < opportunity.units) {
    sellCargo(agent, sourceEcon, opportunity.resourceId,
      opportunity.units - wyslane, opportunity.buyPrice);
  }

  attachCourses(agent, kursy.map(course => course.id));
  // Karawana leci razem Z DEFINICJI: to jeden właściciel i jeden towar, więc
  // nie pytamy `shouldConvoy` — ta funkcja rozstrzyga, czy OBCYM kursom opłaca
  // się zebrać w grupę. Osłona jest już wliczona w rachunek okazji.
  if (kursy.length > 1) {
    formConvoy(director.convoys, kursy, {
      escortPower: agent.escortPower,
      now: registry.clock
    });
  }
  // Ochrona kosztuje co kurs. To jest ta pozycja, przez którą dom handlowy
  // musi wozić drogo — na eskortę przy masówce nikogo nie stać.
  const koszt = caravanEscortCost(agent, route.seconds);
  if (koszt > 0) {
    agent.capital -= koszt;
    agent.ledger.spent += koszt;
    agent.ledger.escorts = (agent.ledger.escorts || 0) + koszt;
  }

  agent.ledger.trades++;
  agents.stats.hauls++;
  countOutbound(director, opportunity.source.id);
  note(director, `${kursy.length > 1 ? 'KARAWANA' : 'AGENT'} ${agent.name}: `
    + `${opportunity.source.id}→${opportunity.target.id} `
    + `${RESOURCES[opportunity.resourceId].label} ×${wyslane}`
    + (kursy.length > 1 ? ` w ${kursy.length} statkach (osłona ×${agent.escortPower})` : '')
    + ` (+${Math.round(okazja.profit.net)} CR)`);
  return { ok: true, course: kursy[0], courses: kursy, agent };
}

/** Stabilny hash identyfikatora — rozrzuca pozycje bez losowości między klatkami. */
function hashId(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Kąt manewru dobierany per kurs, żeby statki nie wchodziły jednym korytarzem. */
function manoeuvreAngle(director) {
  return (director.registry.nextId * 2.399963) % (Math.PI * 2);
}

/** Komplet punktów manewrowych dla trasy między dwoma portami. */
function manoeuvrePoints(director, originId, destinationId) {
  const origin = getNode(director.network, originId);
  const destination = getNode(director.network, destinationId);
  if (!origin || !destination) return {};
  const angle = manoeuvreAngle(director);
  // Odejście po stronie celu, podejście po stronie nadawcy — statek okrąża port
  // zamiast wychodzić i wchodzić tą samą prostą.
  const toTarget = Math.atan2(destination.y - origin.y, destination.x - origin.x);
  return {
    departPoint: approachPoint(origin, director.docks.get(originId), toTarget + (angle % 0.6) - 0.3),
    arrivePoint: approachPoint(destination, director.docks.get(destinationId), toTarget + Math.PI + (angle % 0.6) - 0.3),
    originPos: { x: origin.x, y: origin.y },
    destinationPos: { x: destination.x, y: destination.y }
  };
}

function unitClassFor(mass) {
  return pickVanClass(mass).npcType;
}

/**
 * Przelicza indeks „co jest w drodze i dokąd" — RAZ na tick.
 *
 * Wcześniej liczyło się to przez przemiatanie wszystkich kursów przy KAŻDEJ
 * próbie wysyłki (osiem prób na wysyłkę), czyli O(kursy × próby). Przy kilkunastu
 * kursach to nie miało znaczenia, przy kilku tysiącach jest to główny koszt
 * całej warstwy. Jedno przejście na tick wystarcza, bo w obrębie ticku nic
 * poza dyspozytorem tego nie zmienia.
 */
function rebuildInboundIndex(director) {
  const index = director.inbound;
  index.clear();
  director.inboundSchedule.clear();
  const add = (target, resourceId, units, eta) => {
    const amount = Math.max(0, Number(units) || 0);
    if (!(amount > 0)) return;
    const key = `${target}:${resourceId}`;
    index.set(key, (index.get(key) || 0) + amount);
    const arrivals = director.inboundSchedule.get(key) || [];
    arrivals.push({ units: amount, eta: Math.max(0, Number(eta) || 0) });
    director.inboundSchedule.set(key, arrivals);
  };
  for (const course of getActiveCourses(director.registry)) {
    const payload = course.payload;
    if (!payload) continue;
    const target = payload.targetStationId || course.destinationId;
    if (payload.resourceId && payload.units > 0) {
      add(target, payload.resourceId, payload.units, course.remaining);
    }
    if (payload.harvest) {
      for (const [id, amount] of Object.entries(payload.harvest)) {
        add(target, id, amount, course.remaining);
      }
    }
  }
  // Kurs może już być zamknięty, ale atomowy rozładunek nadal czekać
  // na miejsce. Taki manifest wciąż jest inbound i nie wolno zamówić duplikatu.
  for (const order of director.fleet?.activeOrders || []) {
    if (order?.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) continue;
    for (const [id, amount] of Object.entries(order.cargo || {})) {
      add(order.targetStationId, id, amount, 0);
    }
  }
}

/** Ile sztuk danego surowca jest już w drodze do danej stacji. */
function inboundUnits(director, stationId, resourceId) {
  return director.inbound.get(`${stationId}:${resourceId}`) || 0;
}

/** Dopisuje nowy kurs do indeksu jeszcze w tym samym ticku dyspozytora. */
function bumpInbound(director, stationId, resourceId, units, eta = 0) {
  const amount = Math.max(0, Number(units) || 0);
  if (!(amount > 0)) return;
  const key = `${stationId}:${resourceId}`;
  director.inbound.set(key, (director.inbound.get(key) || 0) + amount);
  const arrivals = director.inboundSchedule.get(key) || [];
  arrivals.push({ units: amount, eta: Math.max(0, Number(eta) || 0) });
  director.inboundSchedule.set(key, arrivals);
}

/** Ile z już wystawionych ładunków dotrze nie później niż kandydat. */
function inboundDueWithin(director, stationId, resourceId, seconds) {
  const arrivals = director.inboundSchedule.get(`${stationId}:${resourceId}`) || [];
  const horizon = Math.max(0, Number(seconds) || 0) + 1e-6;
  let units = 0;
  for (const arrival of arrivals) {
    if (arrival.eta <= horizon) units += Math.max(0, Number(arrival.units) || 0);
  }
  return units;
}

/** Nominalny import potrzebny stacji na sekundę przy aktualnej skali gospodarki. */
function plannedDemandPerSecond(director, station, resourceId) {
  let rates = director.demandRates.get(String(station.id));
  if (!rates) {
    rates = stationNetRates(station);
    director.demandRates.set(String(station.id), rates);
  }
  const net = Number(rates?.[resourceId]) || 0;
  return Math.max(0, -net) * Math.max(0, Number(director.config.economyScale) || 0);
}

/** Pełny czas od rozpoczęcia załadunku do końca rozładunku. */
function shipmentLeadSeconds(route) {
  return Math.max(0, Number(route?.seconds) || 0)
    + LOAD_SECONDS + UNLOAD_SECONDS + MANOEUVRE_SECONDS * 2;
}

/**
 * Ile jeszcze należy wysłać, aby pozycja magazynowa pokryła lot i zapas.
 *
 * `stored + inbound` jest pozycją magazynową. Cel zawiera stały zapas roboczy
 * oraz planowane zużycie przez CAŁY czas dostawy. Poprzedni regulator patrzył
 * wyłącznie na brak do 25% magazynu; dla 29-minutowej trasy Merkury→Ziemia
 * narzucał przez to przepływ mniejszy niż połowa zapotrzebowania Ziemi.
 */
function requiredInboundUnits(director, station, resourceId, leadSeconds = 0) {
  const econ = director.getEconomy(station.id);
  const capacity = Number(econ?.capacity?.[resourceId]);
  if (!(capacity > 0)) return 0;

  const stored = Math.max(0, Number(econ.resources?.[resourceId]) || 0);
  const safetyFill = Math.min(1, Math.max(0,
    Number(director.config.inventorySafetyFill) || 0));
  const leadMargin = Math.max(1, Number(director.config.inboundOvershoot) || 1);
  const demand = plannedDemandPerSecond(director, station, resourceId);
  const lead = Math.max(0, Number(leadSeconds) || 0);
  const due = inboundDueWithin(director, station.id, resourceId, lead);
  // Liczy się zapas przewidywany W CHWILI przybycia kandydata. Późniejszy,
  // daleki kurs nie może blokować pilnej dostawy tylko dlatego, że też jest
  // zapisany jako "inbound". Ujemnego zapasu nie ma — utraconego popytu nie
  // próbujemy fizycznie upchnąć później do magazynu.
  const projectedAtArrival = Math.max(0, stored + due - demand * lead * leadMargin);
  const safety = capacity * safetyFill;
  // Wiele wysyłek z jednego dużego ticku ma praktycznie ten sam ETA. Ich suma
  // nie może przekroczyć pojemności, bo rozładunek jest atomowy i nadmiar
  // przeszedłby w AWAITING_UNLOAD bez aktywnego kursu.
  const pipelineRoom = Math.max(0, capacity - inboundUnits(director, station.id, resourceId));
  return Math.max(0, Math.min(pipelineRoom,
    Math.ceil(safety - projectedAtArrival - 1e-9)));
}

/** Ile brakuje stacji do progu niedoboru. Zwraca 0, gdy nie brakuje nic. */
function missingUnits(director, station, resourceId) {
  const econ = director.getEconomy(station.id);
  if (!econ) return 0;
  const deficit = getStationDeficits(station, econ, 16).find(entry => entry.id === resourceId);
  return deficit ? Math.max(0, deficit.missing) : 0;
}

/**
 * Doładowuje przesyłkę do pełnej ładowni.
 *
 * `planShipment` wysyła dokładnie tyle, ile brakuje do progu niedoboru — a próg
 * bywa mały, więc powstawały kursy typu „płyta kadłuba ×3" lecące 40 minut
 * z ładownią na 380 ton. Skoro statek i tak leci, ma lecieć pełny: to podnosi
 * przepustowość bez dokładania ani jednego kursu.
 *
 * Ograniczenia są dwa i oba twarde: nadwyżka nadawcy (nie zabieramy mu zapasu
 * roboczego) oraz WOLNE MIEJSCE u odbiorcy pomniejszone o to, co już leci —
 * rozładunek jest all-or-nothing, więc przeładowany kurs utknąłby pod stacją.
 */
function topUpShipment(director, shipment) {
  const resourceId = shipment.resourceId;
  const def = RESOURCES[resourceId];
  const sourceEcon = director.getEconomy(shipment.source.id);
  const targetEcon = director.getEconomy(shipment.target.id);
  if (!def || !sourceEcon || !targetEcon) return shipment;

  const spare = getStationSurpluses(shipment.source, sourceEcon, 16)
    .find(entry => entry.id === resourceId)?.spare ?? shipment.units;
  const capacity = Number(targetEcon.capacity?.[resourceId]);
  const stored = Number(targetEcon.resources?.[resourceId]) || 0;
  const free = Number.isFinite(capacity)
    ? Math.max(0, capacity - stored - inboundUnits(director, shipment.target.id, resourceId))
    : Infinity;

  const biggestHold = Math.max(...VAN_CLASSES.map(cls => cls.capacity));
  const byHold = Math.floor(biggestHold / Math.max(def.mass, 1e-6));
  const units = Math.floor(Math.min(spare, free, byHold));
  if (!(units > shipment.units)) return shipment;
  return { ...shipment, units, vanClass: pickVanClass(units * def.mass) };
}

/** Czy warto jeszcze cokolwiek wysyłać, czy pozycja magazynowa już wystarcza. */
function needsMore(director, station, resourceId, leadSeconds = 0) {
  return requiredInboundUnits(director, station, resourceId, leadSeconds) > 0;
}

/** Wyprawa po złoże zachowuje prosty limit brak→inbound; jej trasa jest w obie strony. */
function needsMoreMining(director, station, resourceId) {
  const missing = missingUnits(director, station, resourceId);
  if (missing <= 0) return false;
  return inboundUnits(director, station.id, resourceId)
    < missing * Math.max(1, Number(director.config.inboundOvershoot) || 1);
}

/**
 * Migawka rynku: co kto oddaje i czego komu brakuje — liczona RAZ na tick.
 *
 * `planShipment` z `cargoFleet.js` przelicza nadwyżki i niedobory dla każdej
 * pary stacji przy każdym wywołaniu. Przy kilkunastu kursach to nie miało
 * znaczenia; przy skali, na której w locie jest kilkaset jednostek, dyspozytor
 * wołany 25 razy na tick spędzał na tym 7 z 13 ms. Tutaj liczymy to raz i
 * zdejmujemy nadwyżkę lokalnie, więc kolejne wysyłki w tym samym ticku widzą
 * już pomniejszony zapas.
 */
function rebuildMarket(director, stations) {
  const market = director.market;
  market.sellers.clear();
  market.buyers.length = 0;
  director.surplus.clear();
  director.demandRates.clear();

  for (const station of stations) {
    // Opuszczona stacja NIE JEST uczestnikiem rynku. Nie ma załogi, nie ma
    // przemysłu i nikt tam niczego nie zamawia.
    //
    // Bez tego warunku Neptun zasysał cały ruch układu: jego gospodarka nigdy
    // nie chodzi, więc magazyny stoją na zerze, a `stationWantsResource` i tak
    // odpowiada „tak" dla tlenu, polimeru, stali i paliwa, bo to zużycie bytowe.
    // Zapełnienie 0% czyniło go wiecznie najpilniejszym odbiorcą w całym układzie.
    if (isDerelict(station) || station.factionId === FACTION.PIRATES) continue;
    const econ = director.getEconomy(station.id);
    if (!econ) continue;
    director.demandRates.set(String(station.id), stationNetRates(station));

    const spare = new Map();
    for (const surplus of getStationSurpluses(station, econ, 20)) {
      spare.set(surplus.id, surplus.spare);
      director.surplus.add(surplus.id);
    }
    if (spare.size) market.sellers.set(station.id, { station, spare });

    // Zamówienie musi pojawić się PRZED przekroczeniem dawnego progu 25%.
    // Dlatego rynek widzi wszystkie zasoby o stałym popycie; konkretny sprzedawca
    // i jego ETA dopiero w `nextShipment` rozstrzygają, czy trzeba już wysłać.
    for (const [id, def] of Object.entries(RESOURCES)) {
      if (!stationWantsResource(station, id)) continue;
      const capacity = Number(econ.capacity?.[id]);
      if (!(capacity > 0)) continue;
      const stored = Math.max(0, Number(econ.resources?.[id]) || 0);
      const fill = stored / capacity;
      const demand = plannedDemandPerSecond(director, station, id);
      const safety = capacity * Math.min(1, Math.max(0,
        Number(director.config.inventorySafetyFill) || 0));
      if (!(demand > 0) && stored >= safety) continue;
      const secondsToSafety = demand > 0
        ? (stored - safety) / demand
        : (stored < safety ? -Infinity : Infinity);
      market.buyers.push({
        station, id, fill, value: def.value, secondsToSafety,
        belowSafety: stored < safety,
        demandIntensity: demand / capacity
      });
    }
  }
  // Poniżej zapasu roboczego najpierw ratujemy najpustszy i najszybciej
  // zużywany magazyn. Powyżej niego wygrywa najkrótszy czas do progu.
  market.buyers.sort((a, b) => {
    if (a.belowSafety !== b.belowSafety) return a.belowSafety ? -1 : 1;
    if (a.belowSafety) {
      return a.fill - b.fill || b.demandIntensity - a.demandIntensity;
    }
    return a.secondsToSafety - b.secondsToSafety || b.demandIntensity - a.demandIntensity;
  });
  market.cursor = 0;
}

/** Czy ktokolwiek ma ten surowiec na zbyciu. Jeśli tak, taniej go kupić niż kopać. */
function anyStationHasSurplus(director, _stations, resourceId) {
  return director.surplus.has(resourceId);
}

/**
 * Indeks jednostek stojących w portach, przebudowywany raz na tick.
 *
 * Przeszukiwanie całej floty przy każdej próbie wysyłki to O(statki × próby) —
 * przy 3600 jednostkach i 200 próbach na tick jest to 700 tys. operacji.
 * Kubełki są posortowane po ładowni, więc można wyjąć najmniejszą jednostkę,
 * która mieści planowany ładunek. Dzięki temu vany nie rozdrabniają masówki,
 * a duży frachtowiec nie marnuje się na paczkę mieszczącą się w szutli.
 */
function rebuildParkedIndex(director) {
  const index = director.parked;
  index.clear();
  if (!director.companies) return;
  for (const company of director.companies.companies) {
    for (const ship of company.ships) {
      if (ship.state !== SHIP_STATE.PARKED) continue;
      let bucket = index.get(ship.stationId);
      if (!bucket) index.set(ship.stationId, bucket = []);
      bucket.push({ ship, company });
    }
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.ship.capacity - b.ship.capacity);
  }
}

/** Czy port nadania ma już dłuższą kolejkę do załadunku, niż uniesie. */
function portIsBacklogged(director, stationId) {
  const layout = director.docks?.get(String(stationId));
  if (!layout) return false;
  const limit = Math.max(1, Math.round(layout.berths.length * director.config.loadQueueRatio));
  return (director.portQueue.get(String(stationId)) || 0) >= limit;
}

/**
 * Wyjmuje best-fit: najmniejszą jednostkę mieszczącą planowany ładunek.
 *
 * Samo `shift()` zawsze brało vana 60 t, nawet gdy do przewiezienia czekały
 * tysiące ton rudy. W rezultacie duże kadłuby stały, a Merkury wysyłał sześć
 * razy więcej kursów niż trzeba. Gdy brakuje właściwej klasy, bierzemy
 * największą dostępną — część dostawy jest lepsza niż kolejny pusty tick.
 */
function takeParkedShip(director, stationId, desiredCapacity = 0) {
  const bucket = director.parked.get(String(stationId));
  if (!bucket?.length) return null;
  const desired = Math.max(0, Number(desiredCapacity) || 0);
  let index = desired > 0
    ? bucket.findIndex(item => item.ship.capacity >= desired)
    : 0;
  if (index < 0) {
    index = bucket.length - 1;
    const minimumUseful = Math.min(desired, VAN_CLASSES[1]?.capacity || 0);
    if (bucket[index].ship.capacity < minimumUseful) return null;
  }
  return bucket.splice(index, 1)[0] || null;
}

/** Oddaje jednostkę do puli, gdy wysyłka nie doszła do skutku. */
function returnParkedShip(director, crew) {
  if (!crew) return;
  const bucket = director.parked.get(crew.ship.stationId);
  if (!bucket) return;
  const index = bucket.findIndex(item => item.ship.capacity > crew.ship.capacity);
  if (index < 0) bucket.push(crew);
  else bucket.splice(index, 0, crew);
}

/**
 * Wybiera następne zlecenie z migawki rynku.
 *
 * Idzie po potrzebach od najpilniejszej i dla każdej szuka sprzedawcy, który
 * ma zapas i nie jest z nim w stanie wojny. Trasa powstaje już tutaj, bo jej ETA
 * jest częścią decyzji o wielkości zapasu w drodze.
 */
function nextShipment(director, blocked = new Set()) {
  const market = director.market;
  const biggestHold = Math.max(...VAN_CLASSES.map(cls => cls.capacity));

  while (market.cursor < market.buyers.length) {
    const buyerIndex = market.cursor;
    const buyer = market.buyers[market.cursor++];
    const def = RESOURCES[buyer.id];
    if (!def) continue;

    let bestReady = null;
    let bestShipless = null;
    for (const seller of market.sellers.values()) {
      if (seller.station.id === buyer.station.id) continue;
      if (blocked.has(`${seller.station.id}>${buyer.station.id}`)) continue;
      if (portIsBacklogged(director, seller.station.id)) continue;
      const spare = seller.spare.get(buyer.id) || 0;
      if (spare <= 0) continue;
      if (areFactionsHostile(seller.station.factionId, buyer.station.factionId)) continue;
      if (!stationWantsResource(buyer.station, buyer.id)) continue;

      const byHold = Math.floor(biggestHold / Math.max(def.mass, 1e-6));
      const candidateUnits = Math.floor(Math.min(spare, byHold));
      if (candidateUnits <= 0) continue;

      const candidateMass = candidateUnits * def.mass;
      const route = chooseRoute(director.network, seller.station.id, buyer.station.id, {
        mass: candidateMass,
        value: candidateUnits * (Number(def.value) || 0),
        piracyPressure: director.config.piracyPressure
      });
      if (!route) continue;

      const required = requiredInboundUnits(director, buyer.station, buyer.id,
        shipmentLeadSeconds(route));
      const units = Math.floor(Math.min(candidateUnits, required));
      if (units <= 0) continue;

      const candidate = {
        source: seller.station,
        target: buyer.station,
        resourceId: buyer.id,
        units,
        vanClass: pickVanClass(units * def.mass),
        route,
        sellerState: seller,
        buyerIndex
      };
      const hasShip = !director.companies
        || (director.parked.get(String(seller.station.id))?.length || 0) > 0;
      if (hasShip) {
        if (!bestReady || route.seconds < bestReady.route.seconds) bestReady = candidate;
      } else if (!bestShipless || route.seconds < bestShipless.route.seconds) {
        bestShipless = candidate;
      }
    }
    if (bestReady) return bestReady;
    if (bestShipless) return bestShipless;
  }
  return null;
}

/** Zbiornik dobrany do trasy: statek startuje z zapasem, nie na styk. */
function fuelCapacityFor(route, margin = 1.35) {
  let needed = 0;
  for (const leg of route.legs) needed += Number(leg.fuel) || 0;
  return Math.max(1, needed * margin);
}

// ============================================================
// Przewóz
// ============================================================

/**
 * Wystawia jeden kurs przewozowy. Zwraca `{ ok, reason }`, żeby panel prototypu
 * mógł powiedzieć, DLACZEGO nic nie poleciało — najczęstszy powód to brak
 * rozbieżności magazynów, a nie usterka.
 */
export function dispatchHaul(director, stations) {
  const { registry, network, fleet, config } = director;
  if (getActiveCourses(registry).length >= config.maxActiveCourses) {
    return { ok: false, reason: 'limit kursów w powietrzu' };
  }

  // Szukamy pary, której nie obsługujemy już z nadmiarem. `planShipment` zwraca
  // zawsze tę samą, najlepszą — więc obsłużone trzeba mu wprost odejmować.
  const blocked = getBlockedPairs(fleet);
  let shipment = null;
  let crew = null;
  // Port, w którym był ładunek, ale zabrakło statku. Zapamiętujemy pierwszy taki,
  // żeby po nieudanym obiegu wysłać tam pusty przelot.
  let shipless = null;

  for (let attempt = 0; attempt < config.dispatchAttempts; attempt++) {
    const candidate = nextShipment(director, blocked);
    if (!candidate) break;
    if (blocked.has(`${candidate.source.id}>${candidate.target.id}`)) continue;
    // Port nadania ma już tyle do załadowania, ile uniesie — kolejny kurs tylko
    // zamroziłby towar na redzie i zablokował wystawienie zlecenia komu innemu.
    if (portIsBacklogged(director, candidate.source.id)) continue;
    if (!director.companies) { shipment = candidate; break; }

    // Brak jednostki u nadawcy NIE MOŻE zjadać próby wysyłki — inaczej jeden
    // pusty port blokuje cały dyspozytor (zmierzone: 523 odmowy przy 33 statkach
    // stojących bezczynnie gdzie indziej). Schodzimy na następną potrzebę.
    const found = takeParkedShip(director, candidate.source.id,
      candidate.units * Math.max(RESOURCES[candidate.resourceId]?.mass || 1, 1e-6));
    if (!found) {
      if (!shipless) shipless = candidate;
      director.stats.noShip++;
      // Zapamiętujemy, GDZIE zabrakło jednostki — to jest sygnał dla przerzutów.
      const key = candidate.source.id;
      director.shipShortage.set(key, (director.shipShortage.get(key) || 0) + 1);
      continue;
    }
    // Ładunek dobieramy DO STATKU, a nie statek do ładunku: bierzemy tyle,
    // ile ta konkretna jednostka uniesie.
    const perUnit = Math.max(RESOURCES[candidate.resourceId]?.mass || 1, 1e-6);
    const capacityUnits = Math.min(candidate.units, Math.floor(found.ship.capacity / perUnit));
    if (capacityUnits <= 0) { returnParkedShip(director, found); continue; }
    const exactMass = capacityUnits * perUnit;
    const exactRoute = chooseRoute(network, candidate.source.id, candidate.target.id, {
      mass: exactMass,
      value: capacityUnits * (Number(RESOURCES[candidate.resourceId]?.value) || 0),
      piracyPressure: director.config.piracyPressure
    });
    if (!exactRoute) {
      returnParkedShip(director, found);
      blockRoute(fleet, candidate.source, candidate.target);
      continue;
    }
    const required = requiredInboundUnits(director, candidate.target, candidate.resourceId,
      shipmentLeadSeconds(exactRoute));
    const units = Math.min(capacityUnits, required);
    if (units <= 0) { returnParkedShip(director, found); continue; }
    shipment = {
      ...candidate, units, route: exactRoute,
      vanClass: pickVanClass(units * perUnit)
    };
    crew = found;
    break;
  }

  if (!shipment) {
    if (shipless) {
      // Kandydat był liczony pod największą ładownię, ale pusty powrót ma
      // sprowadzić DOWOLNY statek. Wymaganie megafrachtowca sprawiało, że setki
      // vanów stały u importerów, gdy Merkury nie miał czym wysłać rudy.
      const desiredCapacity = shipless.units
        * Math.max(RESOURCES[shipless.resourceId]?.mass || 1, 1e-6);
      const sent = tryDeadhead(director, shipless.source.id, desiredCapacity);
      if (sent) return { ok: false, reason: 'brak jednostki — wysłano pusty przelot' };
    }
    return { ok: false, reason: 'brak nieobsłużonej pary nadwyżka→niedobór' };
  }

  const manifest = { [shipment.resourceId]: shipment.units };
  const mass = getBagMass(manifest);
  const value = getBagValue(manifest);

  const route = shipment.route || chooseRoute(network, shipment.source.id, shipment.target.id, {
    mass, value, piracyPressure: director.config.piracyPressure
  });
  if (!route) {
    returnParkedShip(director, crew);
    blockRoute(fleet, shipment.source, shipment.target);
    return { ok: false, reason: `brak trasy ${shipment.source.id}→${shipment.target.id}` };
  }

  // Zlecenie powstaje PRZED kursem: to ono zdejmuje towar z magazynu nadawcy
  // atomowo. Kurs bez zlecenia woziłby powietrze.
  const sourceEcon = director.getEconomy(shipment.source.id);
  const fullLeadSeconds = shipmentLeadSeconds(route);
  const order = createShipmentOrder(fleet, {
    sourceStationId: shipment.source.id,
    targetStationId: shipment.target.id,
    resourceId: shipment.resourceId,
    units: shipment.units,
    vanClassId: crew?.ship.vanClassId || shipment.vanClass.id,
    factionId: shipment.source.factionId
  }, sourceEcon, {
    id: `${shipment.source.id}>${shipment.target.id}`,
    fromStationId: shipment.source.id,
    toStationId: shipment.target.id,
    mode: 'warp',
    distance: route.distance,
    durationSeconds: fullLeadSeconds
  }, { travelSeconds: fullLeadSeconds, now: registry.clock });

  if (!order) {
    returnParkedShip(director, crew);
    return { ok: false, reason: 'towar zniknął między planowaniem a załadunkiem' };
  }

  const course = launchCourse(registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: crew ? crew.ship.hullId : unitClassFor(mass),
    factionId: crew ? crew.company.factionId : (shipment.source.factionId ?? null),
    stages: stagesFromRoute(route, shipment.source.id, shipment.target.id,
      manoeuvrePoints(director, shipment.source.id, shipment.target.id)),
    fuelCapacity: fuelCapacityFor(route),
    originId: shipment.source.id,
    destinationId: shipment.target.id,
    payload: {
      orderId: order.id, mass, value,
      resourceId: shipment.resourceId, units: shipment.units, mode: route.id,
      shipId: crew?.ship.id || null,
      companyId: crew?.company.id || null,
      // Fracht płacony przewoźnikowi. Marża nad kosztem trasy — to z niej firma
      // odkłada kapitał, który później pozwala jej na pusty powrót.
      freight: route.cost.total * 1.35
    },
    now: registry.clock
  });

  if (!course) {
    // Kurs się nie zawiązał — towar musi wrócić, inaczej wyparuje z gospodarki.
    wreckShipmentOrder(order, `void:${order.id}`, sourceEcon, registry.clock);
    returnParkedShip(director, crew);
    return { ok: false, reason: 'plan kursu odrzucony' };
  }

  // Dopiero udany kurs rezerwuje nadwyżkę i pozycję magazynową. Dzięki temu
  // następna wysyłka w tym samym ticku widzi dokładnie to, co już leci.
  if (shipment.sellerState) {
    const spare = shipment.sellerState.spare.get(shipment.resourceId) || 0;
    shipment.sellerState.spare.set(shipment.resourceId, Math.max(0, spare - shipment.units));
  }
  bumpInbound(director, shipment.target.id, shipment.resourceId, shipment.units,
    shipmentLeadSeconds(route));
  if (Number.isInteger(shipment.buyerIndex)) {
    // Ten sam pilny odbiorca może dostać kilka statków w jednym dużym kroku
    // czasu; `requiredInboundUnits` przesunie kursor dalej po osiągnięciu celu.
    director.market.cursor = Math.min(director.market.cursor, shipment.buyerIndex);
  }

  if (crew) {
    assignShipToCourse(crew.ship, course.id);
    billCost(crew.company, route.cost.fuel);
    if (route.cost.gate > 0) billCost(crew.company, route.cost.gate, 'fees');
  }
  countOutbound(director, shipment.source.id);
  tryFormConvoy(director, course, route);
  director.stats.hauls++;
  note(director, `${shipment.source.id}→${shipment.target.id}: `
    + `${RESOURCES[shipment.resourceId].label} ×${shipment.units} (${route.label})`);
  return { ok: true, course, order, route };
}

// ============================================================
// Wydobycie
// ============================================================

/**
 * Kursy górnicze po to, czego NIE ROBI ŻADNA STACJA. Pomiar wskazał dwa takie
 * surowce i razem to 16% całego popytu: ruda uranu (tylko Kuiper) i złom
 * (tylko gracz). Bez wypraw po uran stoi łańcuch pręty → rdzenie → stocznia.
 */
export function dispatchMining(director, stations) {
  const { registry, network, config } = director;
  if (getActiveCourses(registry).length >= config.maxActiveCourses) {
    return { ok: false, reason: 'limit kursów w powietrzu' };
  }

  let best = null;
  for (const station of stations) {
    if (isDerelict(station) || station.factionId === FACTION.PIRATES) continue;
    const econ = director.getEconomy(station.id);
    if (!econ) continue;
    for (const deficit of getStationDeficits(station, econ, 8)) {
      const field = network.fields.find(candidate => candidate.yields?.[deficit.id] > 0);
      if (!field) continue;
      // Kopie się tylko to, czego NIE DA SIĘ KUPIĆ. Jeśli ktokolwiek w układzie
      // ma nadwyżkę, tańszy i szybszy jest przewóz — a wyprawa górnicza po rudę,
      // której pełno u sąsiada, wypychała przewozy do zera (zmierzone: 0 kursów
      // handlowych na 158 wypraw).
      if (anyStationHasSurplus(director, stations, deficit.id)) continue;
      if (!needsMoreMining(director, station, deficit.id)) continue;
      if (!best || deficit.fill < best.deficit.fill) best = { station, field, deficit };
    }
  }
  if (!best) return { ok: false, reason: 'nie ma czego kopać — wszystko da się kupić' };

  const units = director.config.miningYieldUnits;
  const mass = (RESOURCES[best.deficit.id]?.mass || 1) * units;
  const outbound = chooseRoute(network, best.station.id, best.field.id, {
    mass: 0, value: 0, piracyPressure: director.config.piracyPressure
  });
  const inbound = chooseRoute(network, best.field.id, best.station.id, {
    mass, value: (RESOURCES[best.deficit.id]?.value || 0) * units,
    piracyPressure: director.config.piracyPressure
  });
  if (!outbound || !inbound) return { ok: false, reason: 'pole poza zasięgiem' };

  // Każda wyprawa kopie GDZIE INDZIEJ. Pole to wycinek pasa o szerokości setek
  // tysięcy jednostek, a trzymanie jego środka ustawiało wszystkich górników
  // w jedną kolumnę lecącą w ten sam punkt.
  const spot = randomFieldSpot(best.field);
  const out = manoeuvrePoints(director, best.station.id, best.field.id);
  const back = manoeuvrePoints(director, best.field.id, best.station.id);

  const stages = [
    dwellStage(best.station.id, LOAD_SECONDS, DWELL_REASON.SERVICE),
    travelStage(best.station.id, best.station.id, {
      mode: 'conventional', fromPos: out.originPos, toPos: out.departPoint,
      seconds: MANOEUVRE_SECONDS, risk: 0
    }),
    ...outbound.legs.map((leg, index) => travelStage(leg.from, leg.to, {
      ...leg,
      fromPos: index === 0 ? out.departPoint : null,
      toPos: index === outbound.legs.length - 1 ? spot : null
    })),
    dwellStage(best.field.id, best.field.extractionSeconds, DWELL_REASON.EXTRACT, spot),
    ...inbound.legs.map((leg, index) => travelStage(leg.from, leg.to, {
      ...leg,
      fromPos: index === 0 ? spot : null,
      toPos: index === inbound.legs.length - 1 ? back.arrivePoint : null
    })),
    travelStage(best.station.id, best.station.id, {
      mode: 'conventional', fromPos: back.arrivePoint, toPos: back.destinationPos,
      seconds: MANOEUVRE_SECONDS, risk: 0
    }),
    dwellStage(best.station.id, UNLOAD_SECONDS, DWELL_REASON.UNLOAD)
  ];

  const course = launchCourse(registry, {
    kind: COURSE_KIND.MINE,
    unitClass: unitClassFor(mass),
    factionId: best.station.factionId ?? null,
    stages,
    fuelCapacity: fuelCapacityFor(outbound) + fuelCapacityFor(inbound),
    originId: best.station.id,
    destinationId: best.station.id,
    // Wyprawa górnicza wraca z towarem, którego nikt wcześniej nie posiadał —
    // nie ma zlecenia, więc ładunek dopisuje się dopiero przy powrocie.
    payload: {
      harvest: { [best.deficit.id]: units },
      mass,
      resourceId: best.deficit.id,
      targetStationId: best.station.id,
      fieldId: best.field.id,
      mode: inbound.id
    },
    now: registry.clock
  });
  if (!course) return { ok: false, reason: 'plan wyprawy odrzucony' };

  bumpInbound(director, best.station.id, best.deficit.id, units, course.duration);
  director.stats.mining++;
  note(director, `wyprawa: ${best.station.id} → ${best.field.label} po `
    + `${RESOURCES[best.deficit.id].label} ×${units}`);
  return { ok: true, course };
}

// ============================================================
// Piractwo
// ============================================================

/**
 * Losuje przechwyty na odcinkach odsłoniętych. Warp ma `risk = 0`, więc
 * przelatuje przez tę pętlę nietknięty — nietykalność wynika z modelu, nie
 * z osobnego wyjątku.
 */
function rollPiracy(director, dt) {
  const { registry, config } = director;
  if (!config.piracyEnabled || config.piracyPressure <= 0) return;

  const active = getActiveCourses(registry);
  // Konwoje losują RAZ na grupę. Bez tego wiązanie kursów niczego by nie
  // zmieniało — pięć statków w szyku dostawałoby pięć osobnych rzutów,
  // czyli dokładnie tyle samo co pięciu solistów, a osłona nie miałaby
  // gdzie się wpiąć.
  const rozliczone = new Set();

  for (let i = active.length - 1; i >= 0; i--) {
    const course = active[i];
    if (rozliczone.has(course.id)) continue;
    const stage = currentStage(course);
    if (!stage || stage.kind !== STAGE_KIND.TRAVEL || !(stage.risk > 0)) continue;
    if (course.kind === COURSE_KIND.PATROL) continue;

    const mode = DRIVE_MODES[stage.mode];
    const exposure = (mode?.speed || 0) * dt * stage.risk;
    if (!(exposure > 0)) continue;
    // Patrol na szlaku zbija ryzyko — to jedyne miejsce, w którym pieniądze
    // frakcji przekładają się na bezpieczeństwo transportu.
    const oslona = patrolMultiplier(director.patrols, stage.fromId, stage.toId);
    // Rejder krążący po tym odcinku podnosi ryzyko — dokładne przeciwieństwo
    // patrolu. Dzięki temu szlak da się realnie oczyścić, zabijając rejdera,
    // zamiast tylko przeczekać złą passę losowania.
    const zagrozenie = director.piracy ? laneThreat(director.piracy, stage.fromId, stage.toId) : 1;
    const solo = interceptChance(exposure, director.network.config, config.piracyPressure)
      * oslona * zagrozenie;

    const konwoj = convoyOf(director.convoys, course.id);
    if (konwoj) {
      for (const id of konwoj.courseIds) rozliczone.add(id);
      if (Math.random() >= convoyInterceptChance(konwoj, solo)) continue;
      // Przechwyt konwoju: część składu przepada, reszta ucieka.
      const wynik = resolveConvoyInterception(director.convoys, konwoj);
      for (const id of wynik.lost) {
        const ofiara = active.find(entry => entry.id === id);
        if (ofiara) strikeCourse(director, ofiara);
      }
      note(director, `PRZECHWYT KONWOJU ${konwoj.fromId}→${konwoj.toId}: `
        + `przepadło ${wynik.lost.length}, uszło ${wynik.survived.length}`);
      continue;
    }

    if (Math.random() >= solo) continue;
    strikeCourse(director, course);
    note(director, `PRZECHWYT: ${course.originId}→${course.destinationId}`);
  }
}

/**
 * Zamyka kurs jako przechwycony: wrak, strata jednostki, wpis do statystyk.
 *
 * Wydzielone, bo przechwyt ma teraz dwa źródła — pojedynczy rzut na solistę
 * i rozstrzygnięcie ataku na konwój, w którym przepada tylko część składu.
 */
function strikeCourse(director, course) {
  const { registry, fleet } = director;
  // Pozycję bierzemy PRZED zamknięciem kursu i z faktycznego etapu, a nie
  // z linii między środkami węzłów. Pole wydobywcze ma setki tysięcy jednostek
  // szerokości, więc wraki liczone po środkach układały się w jeden sznurek
  // zamiast rozsypywać się tam, gdzie naprawdę zginęli górnicy.
  const spot = courseWorldPosition(director.network, course);
  const at = wreckCourse(registry, course, 'pirate');
  const orderId = course.payload?.orderId;
  // Przewoźnik traci nie tylko ładunek, ale i statek — to jest ta strata,
  // która decyduje o tym, czy małą firmę stać jeszcze na cokolwiek.
  closeCourseResources(director, course, { lost: true });
  detachCourse(director.convoys, course.id);
  if (course.payload?.agentId && director.agents) {
    // Przepada JEDEN frachtowiec z karawany, nie cała wyprawa — reszta grupy
    // leci dalej i dom handlowy zwolni się dopiero, gdy wróci ostatni statek.
    recordLoss(director.agents, getAgent(director.agents, course.payload.agentId),
      course.payload.value || 0, course.id);
  }
  if (orderId) {
    // Kurs zniknął, więc order nie może dalej udawać `IN_TRANSIT`: taki duch
    // pozostawał w pozycji magazynowej i na zawsze blokował wysyłkę zastępczą.
    const order = fleet?.orders?.find(candidate => candidate.id === orderId);
    if (order) {
      wreckShipmentOrder(order, `wreck:${course.id}`, null, registry.clock);
      removeActiveShipmentOrder(fleet, order);
    }
    if (director.onWreck) director.onWreck(course, at, order || null);
  }
  // Ładunek nie wyparowuje — ląduje w najbliższej kryjówce. Bez tego piractwo
  // jest podatkiem od transportu, a nie stroną, która ma z czego żyć.
  if (director.piracy) {
    depositLoot(director.piracy, course, spot?.x, spot?.y);
    recordPirateLoss(director.piracy, course.factionId, Number(course.payload?.value) || 0);
  }
  director.stats.lost++;
  director.stats.lostValue += Number(course.payload?.value) || 0;
  // Frakcja pilnuje tam, gdzie traci — bez tego zapisu patrol nie ma się
  // na czym oprzeć i pilnowałby wszystkiego po równo, czyli niczego.
  recordLaneLoss(director.patrols, at?.fromId || course.originId,
    at?.toId || course.destinationId, course.payload?.value || 0);
  director.wrecks.push({
    at,
    x: spot?.x ?? null,
    y: spot?.y ?? null,
    kind: course.kind,
    orderId: orderId || null,
    courseId: course.id,
    clock: registry.clock
  });
}

// ============================================================
// Tick
// ============================================================

function courseEventSettlementKey(event, course) {
  if (event?.type === 'done') return 'done';
  if (event?.type === 'stranded') {
    return `stranded:${course.closedAt ?? 'open'}:${event.nodeId || course.stageIndex}`;
  }
  return null;
}

/** Usuwa rekord wyłącznie z indeksu aktywnych zleceń; historia `orders` zostaje. */
function removeActiveShipmentOrder(fleet, order) {
  const active = fleet?.activeOrders;
  if (!Array.isArray(active) || !order) return false;
  const index = active.indexOf(order);
  if (index < 0) return false;
  active.splice(index, 1);
  return true;
}

/**
 * Ponawia atomowy rozładunek zleceń, których kurs już dotarł do odbiorcy.
 *
 * Fracht i opłata patrolowa są rozliczane przez zdarzenie `done`, dokładnie raz.
 * Retry dotyka wyłącznie cargo oraz statystyki udanej dostawy, dzięki czemu nie
 * może drugi raz zapłacić przewoźnikowi ani zasilić budżetu patroli.
 */
function retryAwaitingUnloadOrders(director) {
  const active = director?.fleet?.activeOrders;
  if (!Array.isArray(active) || !active.length) return 0;

  let delivered = 0;
  for (let index = active.length - 1; index >= 0; index--) {
    const order = active[index];
    // Udana dostawa rozliczona bezpośrednio przez `done` mogła pozostawić stary
    // wpis w indeksie. Usuwamy go bez ponownego naliczania statystyk.
    if (order?.status === SHIPMENT_STATUS.DELIVERED) {
      active.splice(index, 1);
      continue;
    }
    if (order?.status !== SHIPMENT_STATUS.AWAITING_UNLOAD) continue;

    const econ = director.getEconomy(order.targetStationId);
    const result = tryDeliverShipmentOrder(order, econ, director.registry.clock);
    if (!result.changed) continue;

    active.splice(index, 1);
    director.stats.delivered++;
    delivered++;
  }
  return delivered;
}

/**
 * Rozlicza zdarzenia zakończonych kursów niezależnie od źródła ich postępu.
 *
 * Zegar analityczny zwraca zdarzenia z `advanceCourses`, a fizyczna bańka z
 * `updateBubble`. Oba źródła muszą przejść przez tę samą transakcję: zwolnić
 * stanowisko i jednostkę, a dopiero potem dopisać dostawę. Funkcja jest
 * idempotentna, bo integracja widoku może bezpiecznie przekazać tę samą paczkę
 * ponownie po zmianie właściciela zegara.
 */
export function settleCourseEvents(director, events) {
  if (!director || !Array.isArray(events) || !events.length) return 0;
  if (!(director.settledCourseEvents instanceof WeakMap)) {
    director.settledCourseEvents = new WeakMap();
  }

  const { registry, fleet } = director;
  let settled = 0;

  for (const event of events) {
    const course = event?.course;
    if (!course || typeof course !== 'object') continue;
    const key = courseEventSettlementKey(event, course);
    if (!key) continue;

    let seen = director.settledCourseEvents.get(course);
    if (!seen) {
      seen = new Set();
      director.settledCourseEvents.set(course, seen);
    }
    if (seen.has(key)) continue;
    // Znacznik ustawiamy przed skutkami, żeby ponowne wejście z callbacku nie
    // zdołało rozliczyć tego samego kursu drugi raz.
    seen.add(key);

    if (event.type === 'done') {
      // Dok przyjmuje statki, nie grupy — konwój rozwiązuje się przy porcie.
      detachCourse(director.convoys, course.id);
      closeCourseResources(director, course);
      // Pusty przelot niczego nie dowozi — jego jedynym skutkiem jest to, że
      // jednostka stoi teraz tam, gdzie jest praca.
      if (course.payload?.deadhead) { settled++; continue; }
      if (course.payload?.agentId) {
        // Agent sprzedaje towar, który wcześniej KUPIŁ — dopiero tu widać,
        // czy jego rachunek się spiął.
        const agent = getAgent(director.agents, course.payload.agentId);
        const econ = director.getEconomy(course.destinationId);
        if (agent) {
          sellCargo(agent, econ, course.payload.resourceId,
            course.payload.units, course.payload.unitPrice);
          // Karawana zwalnia się dopiero po ostatnim statku: wcześniejszy zakup
          // szedłby z kapitału, który jeszcze leci w ładowniach.
          //
          // Wraz z ostatnim statkiem kupiec PRZENOSI SIĘ do portu, w którym
          // wylądował. Bez tego agent był przykuty do portu macierzystego na
          // zawsze i szukał okazji wyłącznie u siebie: zmierzone 6558 odmów
          // „brak opłacalnej okazji" na 191 kursów, a jedna z ośmiu karawan
          // nie wypłynęła ani razu przez całe 90 minut.
          if (releaseCourse(agent, course.id)) {
            agent.stationId = String(course.destinationId || agent.stationId);
          }
          director.agents.stats.profit += Number(course.payload.value) || 0;
          director.stats.delivered++;
        }
        settled++;
        continue;
      }
      // Opłata od dostarczonego towaru zasila patrole frakcji odbiorcy.
      collectLevy(director.patrols, course.factionId, course.payload?.value || 0);
      if (course.payload?.companyId) {
        billFreight(getCompany(director.companies, course.payload.companyId), course.payload.freight);
      }
      if (course.payload?.orderId) {
        const econ = director.getEconomy(course.destinationId);
        const order = fleet.orders.find(candidate => candidate.id === course.payload.orderId);
        if (order && tryDeliverShipmentOrder(order, econ, registry.clock).changed) {
          removeActiveShipmentOrder(fleet, order);
          director.stats.delivered++;
        }
      } else if (course.payload?.harvest) {
        // Wyprawa górnicza wnosi do gospodarki surowiec spoza przemysłu stacji.
        const econ = director.getEconomy(course.payload.targetStationId);
        if (econ?.resources) {
          for (const [id, amount] of Object.entries(course.payload.harvest)) {
            const cap = Number(econ.capacity?.[id]);
            const next = (Number(econ.resources[id]) || 0) + amount;
            econ.resources[id] = Number.isFinite(cap) ? Math.min(cap, next) : next;
          }
          director.stats.delivered++;
        }
      }
      settled++;
    } else if (event.type === 'stranded') {
      director.stats.stranded++;
      // Unieruchomiony kurs czeka na tankowiec, ale dom handlowy nie może na
      // niego czekać w nieskończoność — inaczej jedna pomyłka paliwowa zamraża
      // kupca do końca biegu. Zwalniamy jego zajętość; gdy tankowiec kiedyś
      // dotrze, utarg i tak wpłynie na konto właściciela.
      if (course.payload?.agentId && director.agents) {
        const agent = getAgent(director.agents, course.payload.agentId);
        if (agent && releaseCourse(agent, course.id)) {
          agent.stationId = String(currentStage(course)?.fromId || agent.stationId);
        }
        director.agents.stats.stranded = (director.agents.stats.stranded || 0) + 1;
      }
      note(director, `bez paliwa: ${course.originId}→${course.destinationId}`);
      settled++;
    }
  }

  return settled;
}

/**
 * Jeden krok całej warstwy. Kolejność ma znaczenie: najpierw gospodarka
 * produkuje, potem kursy się przesuwają i rozliczają, a dopiero na końcu
 * dyspozytor patrzy na świeży stan magazynów i wystawia nowe zlecenia.
 */
export function tickDirector(director, dt, stations) {
  const { registry, fleet, config } = director;
  const events = advanceCourses(registry, dt);
  settleCourseEvents(director, events);

  rollPiracy(director, dt);
  syncBerths(director);
  tickCooldowns(fleet, dt);

  // Gospodarka stacji chodzi własnym cyklem, niezależnie od tego, czy ktoś patrzy.
  director.economyTimer += dt;
  while (director.economyTimer >= ECONOMY_CYCLE_SECONDS) {
    director.economyTimer -= ECONOMY_CYCLE_SECONDS;
    const cycles = Math.max(0.01, config.economyScale);
    for (const station of stations) {
      const econ = director.getEconomy(station.id);
      if (econ) runStationEconomy(station, econ, cycles);
    }
  }

  // Produkcja i zużycie mogły właśnie zwolnić miejsce w magazynie. Ładunek,
  // który fizycznie już dotarł, ma pierwszeństwo przed wystawieniem nowych kursów.
  retryAwaitingUnloadOrders(director);

  // Firmy odbudowują floty i przerzucają puste jednostki raz na cykl gospodarczy
  // — to są decyzje dyspozytorskie, a nie odruchy.
  if (director.companies && director.economyTimer < dt) {
    rebalanceFleet(director);
    planPatrols(director.patrols, {
      now: registry.clock,
      // Szlak pilnuje ta frakcja, do której należy port docelowy.
      laneFaction: (fromId, toId) => stations.find(st => st.id === toId)?.factionId
        || stations.find(st => st.id === fromId)?.factionId || null
    });
    for (const company of director.companies.companies) {
      const bought = maintainFleet(company, {
        targetShips: config.targetFleetPerCompany,
        stationId: company.homeStationId,
        now: registry.clock
      });
      if (bought) {
        director.companies.shipsById.set(bought.id, bought);
        note(director, `${company.name} kupuje jednostkę (${bought.vanClassId})`);
      }
    }
    // To samo dla domów handlowych: bez odkupu każdy przechwyt trwale skraca
    // karawanę i po kilku godzinach wszystkie schodzą do jednego statku.
    for (const agent of director.agents?.agents || []) {
      if (maintainCaravan(agent)) {
        note(director, `${agent.name} odkupuje frachtowiec (${agent.ships}/${agent.targetShips})`);
      }
    }
  }

  // Indeksy przeliczane raz na tick, tuż przed fazą wysyłek — to one czynią
  // dyspozytora liniowym wobec liczby kursów i floty zamiast kwadratowym.
  rebuildInboundIndex(director);
  rebuildMarket(director, stations);
  rebuildParkedIndex(director);
  if (director.agents) director.quotes = marketSnapshot(stations, id => director.getEconomy(id));

  // Odstęp wysyłek skaluje się z gospodarką: N× większy przepływ przy tej samej
  // ładowni to N× więcej kursów, więc dyspozytor musi wystawiać je N× częściej.
  const interval = Math.max(0.05, config.dispatchInterval / Math.max(1, config.economyScale));
  director.dispatchTimer += dt;
  while (director.dispatchTimer >= interval) {
    director.dispatchTimer -= interval;
    // Najpierw handel, dopiero potem kopanie. Odwrotna kolejność wygląda
    // rozsądnie („bez uranu stoi łańcuch"), ale wyprawy zawsze mają co robić,
    // więc przewozy nigdy nie dochodziły do głosu.
    // Co którąś wysyłkę oddajemy agentom. Ich ruch jest rzadszy z natury —
    // czekają na marżę, a nie na czyjś niedobór.
    director.agentTurn = (director.agentTurn || 0) + 1;
    if (director.agents && director.agentTurn % config.agentShare === 0) {
      if (dispatchAgent(director, stations).ok) continue;
    }
    if (!dispatchHaul(director, stations).ok) dispatchMining(director, stations);
  }

  return events;
}

/**
 * Gdzie kurs jest w tej chwili w jednostkach świata.
 *
 * Interpolacja po bieżącym etapie — to jest dokładnie ta sama liczba, której
 * potrzebuje bańka materializacji, żeby postawić encję tam, gdzie rekord
 * naprawdę doleciał. Postój zwraca pozycję węzła.
 */
export function courseWorldPosition(network, course) {
  const stage = currentStage(course);
  if (!stage) return null;

  if (stage.kind === STAGE_KIND.DWELL) {
    // Własna pozycja etapu wygrywa ze środkiem węzła: statek stoi przy swoim
    // stanowisku albo w swoim miejscu wydobycia, a nie w środku planety.
    const at = stage.pos || getNode(network, stage.nodeId);
    return at ? { x: at.x, y: at.y, moving: false, mode: null, blocked: !!course.blocked } : null;
  }

  const from = stage.fromPos || getNode(network, stage.fromId);
  const to = stage.toPos || getNode(network, stage.toId);
  if (!from || !to) return null;
  const t = stageProgress(course);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    moving: true,
    mode: stage.mode
  };
}

/** Migawka do panelu prototypu. */
export function directorSnapshot(director) {
  const active = getActiveCourses(director.registry);
  const byKind = {};
  const byMode = {};
  let queued = 0;
  let berthed = 0;
  for (const course of active) {
    byKind[course.kind] = (byKind[course.kind] || 0) + 1;
    const mode = course.payload?.mode || currentStage(course)?.mode || '—';
    byMode[mode] = (byMode[mode] || 0) + 1;
    if (course.blocked) queued++;
    else if (course.berthId) berthed++;
  }
  return {
    clock: director.registry.clock,
    active: active.length,
    byKind,
    byMode,
    /** Ile kursów stoi na redzie, bo port nie ma wolnego stanowiska. */
    queued,
    convoys: summarizeConvoys(director.convoys),
    patrols: summarizePatrols(director.patrols),
    /** Ile jest obsługiwanych przy stanowiskach. */
    berthed,
    wrecks: director.wrecks.length,
    stats: { ...director.stats },
    tally: { ...director.registry.tally }
  };
}
