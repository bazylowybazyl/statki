/**
 * BAŃKA W WORKERZE RUCHU (E6, docs/PLAN-ekonomia-rynki.md § 3.5) — warstwa 3
 * ruchu v2 przy graczu, liczona obok rekordów kursów.
 *
 * Lot lekkich statków (`materializedFlight.js`) chodzi TU, a nie w grze: bańka
 * potrzebuje całego kursu (następny etap, czas postoju, przydział stanowiska,
 * kolejka), a dolot i koniec postoju rozlicza ta sama transakcja co zegar
 * analityczny (`settleCourseEvents`) — w tym samym kroku, bez rundy wiadomości.
 * Gra dostaje po każdym `advance` bufor póz (`ACTOR_FIELD`) i liczy na nim
 * trafienia, taran i rejestr stanowisk; zniszczenie odsyła `destroyed`.
 *
 * Bańka żyje przy portach (każdy rynek z dokami świata: ringi K-7 i zatoki
 * Ziemi, Marsa i Jowisza, pomosty planet, księżyców i małych ciał, hangary
 * kryjówek) — fokus dalej niż `BUBBLE_PORT_RANGE` od każdego portu zwalnia
 * wszystkie encje do rekordów; `options.ports` zawęża listę (testy). Kandydaci do materializacji to kursy z bufora
 * bańki rdzenia (`buildBubble`: w promieniu fokusu w horyzoncie kroku świata)
 * — bez przeglądu tysięcy aktywnych kursów co klatkę.
 *
 * Zapas floty (`placeFleetStock`, Z2): okręty frakcji portu bez kursów stoją na padach hal K-7 (stanowiska
 * wojskowe) — hale żyją, zanim przylecą kursy wojskowe. Rozstawienie liczy się przy każdym kroku świata
 * (rejestr pamięta przydział — okręt nie skacze między padami), kurs i gracz mają pierwszeństwo do padu.
 *
 * Stanowiska gracza (`berth-hold`): dyspozytor ich nie przydziela, a kurs,
 * który na takie stanowisko dopiero leci, dostaje inne (`setPlayerBerthHolds`
 * w dyspozytorze); statek, który już wszedł w korytarz albo stoi na polu,
 * zostaje — gra widzi go w rejestrze jako zajęte.
 */

import {
  createBubble, updateBubble, clearBubble, releaseBubbleCourse, setBubblePorts, ACTOR_PHASE, VAN_CLASS_OF_UNIT,
  dropDepartedActor
} from './materializedFlight.js';
import { createRingObstaclesForNetwork } from './ringRouter.js';
import { getCourse, COURSE_STATUS, COURSE_KIND, STAGE_KIND, DWELL_REASON, stageProgress } from './courseRegistry.js';
import { scrapperJobFor } from './scrapperFleets.js';
import {
  createParkingRegistry, placeFleetStock, syncParking, reserveParkingSpot, buildDockOrbitParking, renameParkedShip
} from './portParking.js';
import { portEntryForBerth } from './portPaths.js';
import { SHIP_STATE, getShip, getCompany, loseShip, releaseShipAt } from './transportCompanies.js';
import { settleGarrisonLosses } from './warDispatcher.js';
import { createGarrisonState } from './patrols.js';
import { SYSTEM_MAP_PLANETS } from '../../data/systemMap.js';
import { haloRingKey } from '../haloRingPlanets.js';
import { computeHaloRingLayout } from '../../3d/haloRing/haloRingLayout.js';
import { BERTH_ROLE, hullFootprint } from './dockLayout.js';
import { getNode } from './travelNetwork.js';
import { settleCourseEvents, destroyCourse } from './trafficDirector.js';
import {
  ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, COURSE_KIND_SHIFT, courseNumber
} from './trafficProtocol.js';
import { convoyOf } from './convoy.js';
import { VAN_CLASSES } from './shipmentOrders.js';
import { ACTOR_CARGO_STRIDE, writeBubbleCargo } from './bubbleCargo.js';
import { RESOURCES, RESOURCE_KEYS } from '../../data/resources.js';

/** Przyspieszenie w buforze najwyżej tyle [j./s²] — skok prędkości (przechwyt, zmiana etapu) to nie rozpęd. */
const ACCEL_LIMIT = 200_000;

function clampAccel(a) {
  return a > ACCEL_LIMIT ? ACCEL_LIMIT : a < -ACCEL_LIMIT ? -ACCEL_LIMIT : a;
}

function wrapAngle(a) {
  const TAU = Math.PI * 2;
  return a - TAU * Math.round(a / TAU);
}

/** Porty bańki domyślnie: wszystkie rynki z dokami (`null` = `world.docks`; lista id — zawężenie). */
export const BUBBLE_PORTS = null;
/**
 * Fokus dalej od węzła portu → bańka pusta. Ring Ziemi z portem i redą sięga
 * ~60 tys. j. od środka, bańka ma 60 tys. promienia — 180 tys. obejmuje cały
 * port z każdej strony i podejścia do niego, a nie sięga Księżyca.
 */
export const BUBBLE_PORT_RANGE = 180_000;
/**
 * Promień fokusu przy portach i w studni planety (E15) — gra prosi o 60 tys. j. (`TRAFFIC_V2_BUBBLE_RADIUS`),
 * przy porcie bańka bierze co najmniej tyle: statki w podejściu i odlocie widać dłużej, reda i orbita postojowa
 * mieszczą się całe. Liczba z pomiaru kosztu (`docs/E15-widoczny-ruch.md`); górny limit encji — `maxActors`
 * lotu (400) plus postój (`PARKED_VISIBLE_SLOTS`).
 */
export const BUBBLE_PORT_FOCUS_RADIUS = 100_000;
/**
 * Reda przy ringu (E15): statek firmy widać, gdy jego slot jest wśród tylu pierwszych w kolejności zapełniania
 * pasma strefy (zwarty blok przy kotwicy strefy) — przy Ziemi ≤ 8 stref × 5 klas × N. Dalsze sloty stoją
 * w rekordzie bez obrazu. Widoczność zależy od slotu, nie od gracza — statek nie miga przy ruchu kamery.
 */
export const PARKED_VISIBLE_SLOTS = 4;
/**
 * Najwyżej tyle encji w buforze `actors` — tyle mieści blok migawki obrazu (`TRAFFIC_BLOCK.CAP` w
 * `src/render/blocks/trafficBlock.js`, strażnik w `tests/workerBubble.test.mjs`). Lot ma swój limit (`maxActors`
 * 400), encje bez kursu (zapas floty, postój) biorą resztę, w tej kolejności.
 */
export const BUBBLE_ENTITY_LIMIT = 512;
/** Nowy statek nie dostaje slotu redy bliżej gracza niż głębokość slotu + tyle [j.] (gracz ma pierwszeństwo). */
const PARKED_PLAYER_CLEARANCE = 1500;

const PHASE_INDEX = new Map(ACTOR_PHASES.map((phase, index) => [phase, index]));
const PHASE_DOCKED = PHASE_INDEX.get(ACTOR_PHASE.DOCKED) ?? 2;
const PHASE_HOLD = PHASE_INDEX.get(ACTOR_PHASE.HOLD) ?? 4;

/**
 * Stan bańki rdzenia. `world` — świat ruchu (`buildTrafficWorld`).
 * Ringi i indeks portów powstają raz; po zmianie rynków `refreshPorts`.
 */
export function createWorldBubble(world, options = {}) {
  const ports = Array.isArray(options.ports) ? options.ports : BUBBLE_PORTS;
  // `null` = wszystkie porty świata, czytane na żywo (rynki dochodzą w biegu — `refreshWorldBubblePorts`).
  const wells = planetWells(world);
  const bubble = createBubble({
    rings: createRingObstaclesForNetwork(world.network, world.docks),
    docks: world.docks,
    zoneAt: (x, y) => planetZoneAt(wells, x, y),
    departTarget: (course, actor, out) => departToParking(state, course, actor, out),
    ...(options.flight || {})
  });
  const state = {
    world,
    bubble,
    ports,
    /** Studnie planet `[x, y, r²] × n` — bańka żyje w nich także z dala od portu (E15). */
    wells,
    range: Number(options.range) > 0 ? Number(options.range) : BUBBLE_PORT_RANGE,
    /** Promień fokusu przy portach (`bubbleFocusRadius`); 0 — tylko promień gry (testy). */
    portRadius: options.portRadius !== undefined ? Math.max(0, Number(options.portRadius) || 0) : BUBBLE_PORT_FOCUS_RADIUS,
    /**
     * Postój bez kursu (E15, `refreshParkedShips`): plany i rejestry redy / orbity per port (`null` — port
     * bez widocznego postoju: hangar kryjówki), widoczne statki (`list`), pokazane w ostatnim rozstawieniu
     * (`shown`: `shipId` → wpis — oddanie pozy kursowi), odloty lecące na swój slot (`departing`: `shipId` →
     * encja), porty przy fokusie, ostatni fokus (pierwszeństwo gracza).
     */
    parked: {
      regs: new Map(), list: [], shown: new Map(), departing: new Map(), ports: new Set(),
      byStation: new Map(), focus: { x: 0, y: 0, active: false }, handoffs: 0
    },
    /** Kursy, które bańka może zmaterializować (z `buildBubble` rdzenia). */
    candidates: [],
    view: null,
    active: false,
    data: new Float64Array(ACTOR_STRIDE * 64),
    count: 0,
    /** `dt` ostatniego kroku bańki — ruch faktyczny encji w buforze. */
    lastDt: 0,
    /** Postoje przy stanowisku wysłane do gry: numer kursu → podpis (kontrakt `DockRecord`, E12). */
    docksSent: new Map(),
    /** Zapas floty na padach K-7: rejestry postoju (port → rejestr), okręty na padach, stałe id ujemne. */
    stock: { regs: new Map(), list: [], ids: new Map(), seq: 0 },
    stats: { ms: 0, maxMs: 0, actors: 0, events: 0, candidates: 0 }
  };
  // `updateBubble` czyta kursy jak z mapy: po id (encje) i przegląd kandydatów.
  state.view = {
    get: (id) => getCourse(world.registry, id),
    values: () => state.candidates
  };
  return state;
}

/**
 * Studnie grawitacyjne planet — strefa „planet_gravity” gry (`planetOrbitRadii` w index.html): planeta z ringiem
 * — obwiednia ringu + 12 tys. j.; z `orbitZone` — `gravity`; reszta — `max(2,2 r, r + 1500) + 10 000`,
 * r = `baseR × planetScale` (te same liczby, z których gra skaluje planety). Płaska lista `[x, y, r²]`.
 */
export function planetWells(world) {
  const scale = Number(world.placement?.planetScale) || 1;
  const out = [];
  for (const planet of SYSTEM_MAP_PLANETS) {
    const node = world.network.nodes.get(planet.id);
    if (!node) continue;
    const r = planet.baseR * scale;
    let well;
    if (haloRingKey(planet)) well = computeHaloRingLayout(planet).outerRadius + 12000;
    else if (planet.orbitZone?.gravity) well = planet.orbitZone.gravity;
    else well = Math.max(r * 2.2, r + 1500) + 10000;
    out.push(node.x, node.y, well * well);
  }
  return out;
}

/** Mnożnik strefy warpa w punkcie: w studni planety 0,3 (`zonePropsForId` gry), poza nią 1. */
export function planetZoneAt(wells, x, y) {
  for (let i = 0; i < wells.length; i += 3) {
    const dx = x - wells[i];
    const dy = y - wells[i + 1];
    if (dx * dx + dy * dy <= wells[i + 2]) return PLANET_ZONE_WARP;
  }
  return 1;
}

/** Strefa planety gry (`planet_gravity`): warp ×0,3, hipercruise ×max(0,6, 0,3) — `applyZone` w bańce. */
const PLANET_ZONE_WARP = 0.3;

/** Id portów bańki: lista z opcji albo wszystkie rynki z dokami świata (bez kopii — iterator mapy). */
export function bubblePortIds(state) {
  return state.ports || state.world.docks.keys();
}

/** Czy fokus jest przy porcie bańki albo w studni grawitacyjnej planety (E15). */
export function bubblePortNear(state, x, y) {
  const network = state.world.network;
  const r2 = state.range * state.range;
  for (const id of bubblePortIds(state)) {
    const node = getNode(network, id);
    if (!node) continue;
    const dx = node.x - x;
    const dy = node.y - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return !!state.wells && planetZoneAt(state.wells, x, y) !== 1;
}

// ============================================================
// Miejsca pracy (E24): górnicy przy polu, złomiarze przy wraku
// ============================================================

/**
 * Fokus bliżej miejsca pracy niż tyle [j.] → bańka żyje także z dala od portów (pola pasa, wraki po bitwie gracza
 * w głębi): górnika i złomiarza widać przy robocie. Promień fokusu zostaje promieniem gry (`bubbleFocusRadius`
 * daje szerszy tylko przy porcie i w studni).
 */
export const WORK_SITE_RANGE = 120_000;

const _site = { x: 0, y: 0 };

/** Indeks etapu pracy kursu: postój wydobycia wyprawy MINE, postój przy wraku kursu TUG; −1, gdy brak. */
export function workStageIndex(course) {
  const stages = course?.stages;
  if (!stages) return -1;
  if (course.kind === COURSE_KIND.MINE) {
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      if (s.kind === STAGE_KIND.DWELL && s.reason === DWELL_REASON.EXTRACT) return i;
    }
    return -1;
  }
  if (course.kind === COURSE_KIND.TUG) {
    for (let i = 0; i < stages.length; i++) if (stages[i].kind === STAGE_KIND.DWELL) return i;
  }
  return -1;
}

/**
 * Miejsce pracy kursu w rekordzie: do końca postoju — punkt pracy (wydobycie, wrak), w przelocie powrotnym — pozycja
 * rekordu na odcinku (holownik z wrakiem odlatuje, a bańka nie gaśnie mu pod nosem). Zwraca false poza tymi etapami.
 */
function workSiteOf(course, out) {
  const w = workStageIndex(course);
  if (w < 0) return false;
  const i = course.stageIndex;
  if (i <= w) {
    const p = course.stages[w].pos;
    if (!p) return false;
    out.x = p.x;
    out.y = p.y;
    return true;
  }
  if (i !== w + 1) return false;
  const s = course.stages[i];
  if (s.kind !== STAGE_KIND.TRAVEL || !s.fromPos || !s.toPos) return false;
  const t = stageProgress(course);
  out.x = s.fromPos.x + (s.toPos.x - s.fromPos.x) * t;
  out.y = s.fromPos.y + (s.toPos.y - s.fromPos.y) * t;
  return true;
}

/** Miejsca pracy wypraw górniczych i złomiarzy (`[x, y] × n`) — po każdym kroku świata (rdzeń). */
export function refreshWorkSites(state) {
  const sites = state.workSites || (state.workSites = []);
  sites.length = 0;
  const active = state.world.registry?.active;
  if (!active) return 0;
  for (let i = 0; i < active.length; i++) {
    const c = active[i];
    if (c.kind !== COURSE_KIND.MINE && c.kind !== COURSE_KIND.TUG) continue;
    if (!workSiteOf(c, _site)) continue;
    sites.push(_site.x, _site.y);
  }
  return sites.length / 2;
}

/** Czy fokus jest przy miejscu pracy (`WORK_SITE_RANGE`). */
export function workSiteNear(state, x, y) {
  const sites = state.workSites;
  if (!sites?.length) return false;
  const r2 = WORK_SITE_RANGE * WORK_SITE_RANGE;
  for (let i = 0; i < sites.length; i += 2) {
    const dx = sites[i] - x;
    const dy = sites[i + 1] - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/**
 * Przegląd miejsc pracy do narzędzi (`snapshot.work`, na żądanie): wyprawy górnicze i złomiarze z etapem ('approach',
 * 'work', 'haul'), punktem pracy, resztą postoju i wrakiem gry. Bez wpływu na świat.
 */
export function describeWorkSites(state, limit = 600) {
  const out = [];
  const active = state?.world?.registry?.active || [];
  for (let i = 0; i < active.length && out.length < limit; i++) {
    const c = active[i];
    if (c.kind !== COURSE_KIND.MINE && c.kind !== COURSE_KIND.TUG) continue;
    const w = workStageIndex(c);
    const p = w >= 0 ? c.stages[w].pos : null;
    if (!p) continue;
    const phase = c.stageIndex < w ? 'approach' : c.stageIndex === w ? 'work' : c.stageIndex === w + 1 ? 'haul' : null;
    if (!phase) continue;
    const job = c.kind === COURSE_KIND.TUG ? scrapperJobFor(state.world.scrappers, c.id) : null;
    out.push({
      course: courseNumber(c.id), id: c.id, kind: c.kind === COURSE_KIND.MINE ? 'mine' : (job?.mode || 'tow'), phase,
      x: p.x, y: p.y, left: phase === 'work' ? Math.max(0, (Number(c.stages[w].seconds) || 0) - (Number(c.stageElapsed) || 0)) : null,
      gid: job?.gid ?? null, unitClass: c.unitClass || null
    });
  }
  return out;
}

/** Bańka żyje: port, studnia planety albo miejsce pracy (E24). */
export function bubbleAlive(state, x, y) {
  return bubblePortNear(state, x, y) || workSiteNear(state, x, y);
}

/**
 * Zmiany pracy encji (`WorkRecord`, `trafficProtocol.js`): górnik w etapie wydobycia, złomiarz przy wraku (cięcie,
 * zaczepianie) i z wrakiem na linie (przelot powrotny po holu). Nowe albo zmienione → `works`, zakończone →
 * `unworked`. Podpis zmienia też wejście encji w fazę `station` — wtedy koniec postoju liczy się z jej `dwell`
 * (bańka nalicza postój od przylotu encji). `time` — czas mostu. Zwraca `null`, gdy nic się nie zmieniło.
 */
export function collectWorkChanges(state, time) {
  const sent = state.worksSent || (state.worksSent = new Map());
  const list = state.bubble.list;
  const seen = state._workSeen || (state._workSeen = new Set());
  seen.clear();
  const registry = state.world.registry;
  const scrappers = state.world.scrappers;
  let works = null;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (a.departed || !a.courseId) continue;
    const course = getCourse(registry, a.courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE) continue;
    if (course.kind !== COURSE_KIND.MINE && course.kind !== COURSE_KIND.TUG) continue;
    const w = workStageIndex(course);
    if (w < 0) continue;
    const job = course.kind === COURSE_KIND.TUG ? scrapperJobFor(scrappers, course.id) : null;
    const kind = course.kind === COURSE_KIND.MINE ? 'mine' : (job?.mode === 'cut' ? 'cut' : 'tow');
    let phase;
    if (course.stageIndex === w) phase = 'work';
    else if (kind === 'tow' && course.stageIndex === w + 1) phase = 'haul';
    else continue;
    const num = courseNumber(a.courseId);
    if (!Number.isFinite(num)) continue;
    seen.add(num);
    const gid = job?.gid ?? null;
    const atSpot = phase === 'work' && a.phase === ACTOR_PHASE.STATION ? 1 : 0;
    const sig = `${kind}|${phase}|${course.stageIndex}|${gid}|${atSpot}`;
    if (sent.get(num) === sig) continue;
    sent.set(num, sig);
    const stage = course.stages[w];
    const p = stage.pos || { x: a.x, y: a.y };
    let t0 = 0;
    let dur = 0;
    if (phase === 'work') {
      dur = Math.max(0, Number(stage.seconds) || 0);
      const tEnd = time + Math.max(0, dur - (Number(a.dwell) || 0));
      t0 = tEnd - dur;
    }
    (works || (works = [])).push({ id: num, kind, phase, x: p.x, y: p.y, t0, dur, gid });
  }
  let unworked = null;
  for (const num of sent.keys()) {
    if (seen.has(num)) continue;
    sent.delete(num);
    (unworked || (unworked = [])).push(num);
  }
  return works || unworked ? { works, unworked } : null;
}

/**
 * Promień bańki dla fokusu gry (E15): przy porcie i w studni planety co najmniej `BUBBLE_PORT_FOCUS_RADIUS`,
 * gdzie indziej — promień gry.
 */
export function bubbleFocusRadius(state, x, y, r) {
  const want = Math.max(0, Number(r) || 0);
  if (!state || !(want > 0) || !(state.portRadius > want)) return want;
  return bubblePortNear(state, x, y) ? state.portRadius : want;
}

/**
 * Po zmianie rynków (`market-add` / `market-remove`, kryjówki misji): układy doków świata do indeksu portów
 * bańki (stanowiska nowych rynków dostają ścieżki pomostu / hangaru). Plany postoju liczą się od nowa.
 */
export function refreshWorldBubblePorts(state) {
  setBubblePorts(state.bubble, state.world.docks);
  state.parked.regs.clear();
}

/** Kandydaci do materializacji — kursy aktywne z bufora bańki rdzenia. */
export function setBubbleCandidates(state, courses, count = courses.length) {
  const list = state.candidates;
  list.length = 0;
  for (let i = 0; i < count; i++) {
    const course = courses[i];
    if (course && course.status === COURSE_STATUS.ACTIVE) list.push(course);
  }
  state.stats.candidates = list.length;
}

/**
 * Krok bańki o `dt` czasu świata (ten sam, który poszedł do `advanceTrafficWorld`).
 * `focus` — `{ x, y, r, active }` rdzenia. Zdarzenia kursów (dolot, koniec
 * postoju) rozlicza dyspozytor od razu. Zwraca liczbę zdarzeń — rdzeń po
 * niezerowej odświeża kandydatów (nowe kursy, np. odlot po rozładunku).
 */
export function stepWorldBubble(state, focus, dt, now = null) {
  const world = state.world;
  const t0 = now ? now() : 0;
  const near = !!focus?.active && focus.r > 0 && bubbleAlive(state, focus.x, focus.y);
  let events = 0;
  if (!near) {
    if (state.bubble.list.length) clearBubble(state.bubble, world.network, state.view);
    state.active = false;
  } else {
    state.active = true;
    state.lastDt = dt;
    const out = updateBubble(state.bubble, world.network, world.registry, state.view, focus, focus.r, dt);
    if (out.length) {
      settleCourseEvents(world.director, out);
      events = out.length;
    }
  }
  if (now) {
    const ms = now() - t0;
    state.stats.ms = ms;
    if (ms > state.stats.maxMs) state.stats.maxMs = ms;
  }
  state.stats.events += events;
  return events;
}

/** Zwalnia wszystkie encje do rekordów (przebudowa świata, wyłączenie bańki). */
export function releaseWorldBubble(state) {
  if (state.bubble.list.length) clearBubble(state.bubble, state.world.network, state.view);
  state.active = false;
  state.count = 0;
}

/**
 * Kurs przejmuje gra (`attach`: awans do NPC) — encja bańki wraca do rekordu z postępem, a bańka nie
 * zmaterializuje go znowu, dopóki gra trzyma przypięcie (`course.actorId`). Zwraca true, gdy encja była.
 */
export function releaseWorldBubbleCourse(state, course) {
  return releaseBubbleCourse(state?.bubble, state?.world?.network, course);
}

/**
 * Zapas okrętów frakcji portu (`world.shipyards.fleets` właściciela portu) rozstawiony na padach hal K-7
 * (`placeFleetStock`, rejestr redy wojskowej portu). Woła rdzeń po każdym kroku świata. Nadmiar stoi na redzie
 * wojskowej (E15: encja STOCK + PARKED, faza `hold`); chmura przelewu i hangar — bez obrazu.
 */
export function refreshFleetStock(state) {
  const world = state.world;
  const stock = state.stock;
  stock.list.length = 0;
  const fleets = world.shipyards?.fleets;
  if (!fleets) return 0;
  for (const portId of bubblePortIds(state)) {
    const layout = world.docks.get(portId);
    // Pady hal K-7 są tylko w portach z ringiem (Ziemia, Mars, Jowisz).
    if (!layout?.hasRing) continue;
    const plan = world.parking?.get(portId);
    const owner = world.stations.find((s) => s.id === portId)?.factionId || null;
    if (!layout || !plan || !owner) continue;
    let reg = stock.regs.get(portId);
    if (!reg) stock.regs.set(portId, reg = createParkingRegistry(plan, { role: BERTH_ROLE.MILITARY }));
    const own = fleets.get(owner);
    const result = placeFleetStock(layout, reg, own ? { [owner]: own } : {}, homeStockOptions(world.director, layout));
    for (const [shipId, spot] of result.placements) {
      const reda = spot.kind === 'reda';
      if (spot.kind !== 'berth' && !reda) continue;
      const size = hullFootprint(spot.hullId);
      stock.list.push({
        id: entityId(state, shipId), hullId: spot.hullId, factionId: spot.factionId, x: spot.x, y: spot.y,
        angle: spot.angle, berthId: reda ? null : spot.berthId, length: size.length, width: size.width,
        flags: reda ? ACTOR_FLAG.STOCK | ACTOR_FLAG.PARKED : ACTOR_FLAG.STOCK, phase: reda ? PHASE_HOLD : PHASE_DOCKED,
        shipId: null, fleetShipId: shipId, classId: spot.classId || null, portId
      });
    }
  }
  return stock.list.length;
}

/**
 * Hale stanowisk domowych gracza w porcie (`director.homeBerths`, `init.homeBerths`) → opcje `placeFleetStock`:
 * zapas floty zapełnia je pierwsze (hala Atlasa na starcie kampanii — pełna okrętów frakcji). Brak — `undefined`.
 */
function homeStockOptions(director, layout) {
  const home = director?.homeBerths;
  if (!home?.size) return undefined;
  let docks = null;
  for (const berth of layout.berths) if (home.has(berth.id)) (docks || (docks = new Set())).add(berth.dockId);
  return docks ? { homeDocks: docks } : undefined;
}

// ============================================================
// Encje bez kursu przejęte przez grę (E6, 2026-10-23): taran i ogień — nietykalnych nie ma
// ============================================================

/**
 * Encja bańki bez kursu po id z bufora: zapas floty (`stock`, id ujemny), postój statku firmy (`parked`, id ujemny),
 * odlot po końcu kursu (`departed`, numer zamkniętego kursu). Null — nie ma jej w bańce.
 */
export function resolveBubbleEntity(state, id) {
  const num = Number(id);
  if (!Number.isFinite(num)) return null;
  const world = state.world;
  if (num < 0) {
    for (const e of state.stock.list) {
      if (e.id === num) return { kind: 'stock', id: num, fleetShipId: e.fleetShipId, factionId: e.factionId, classId: e.classId, portId: e.portId };
    }
    for (const e of state.parked.list) {
      if (e.id !== num) continue;
      const ship = getShip(world.companies, e.shipId);
      return ship ? { kind: 'parked', id: num, ship } : null;
    }
    return null;
  }
  for (const a of state.bubble.list) {
    if (!a.departed || courseNumber(a.courseId) !== num) continue;
    const course = getCourse(world.registry, a.courseId);
    const shipId = course?.payload?.shipId;
    return {
      kind: 'departed', id: num, actor: a, ship: shipId ? getShip(world.companies, shipId) : null,
      factionId: course?.factionId || null, courseKind: course?.kind || null, x: a.x, y: a.y
    };
  }
  return null;
}

/**
 * Gra przejęła encję bez kursu jako pełny NPC (`on`) albo oddała ją (`!on`). Statek firmy (postój, odlot) schodzi
 * z puli dyspozytora na czas walki: `BUSY` bez kursu (`gameHold`) — firma nie da mu kursu, a postój go nie
 * pokazuje (inaczej po nowym kursie statek byłby w grze dwa razy); oddany wraca na postój w swoim porcie. Odlot
 * znika z bańki (NPC jest teraz statkiem). Zapas floty zostaje w zapasie — encję ukrywa gra. Zwraca true, gdy
 * encja jest (była) przejęta.
 */
export function holdBubbleEntity(state, id, on) {
  const held = state.held || (state.held = new Map());
  const num = Number(id);
  if (!on) {
    const ref = held.get(num);
    held.delete(num);
    const ship = ref?.ship;
    if (ship?.gameHold) {
      ship.gameHold = false;
      if (ship.state === SHIP_STATE.BUSY && !ship.courseId) {
        releaseShipAt(ship, ship.stationId, state.world.registry.clock);
      }
    }
    return !!ref;
  }
  if (held.has(num)) return true;
  const ref = resolveBubbleEntity(state, num);
  if (!ref) return false;
  if (ref.actor) dropDepartedActor(state.bubble, ref.actor);
  if (ref.ship) {
    state.parked?.departing?.delete(String(ref.ship.id));
    if (ref.ship.state === SHIP_STATE.PARKED) {
      ref.ship.state = SHIP_STATE.BUSY;
      ref.ship.courseId = null;
      ref.ship.gameHold = true;
    }
  }
  held.set(num, ref);
  return true;
}

/**
 * Encja bez kursu zniszczona w grze. Zapas floty i okręt garnizonu w odlocie → strata z zapasu frakcji
 * (`settleGarrisonLosses` od razu: zapas klasy −1, wrak ze złomem jak po bitwie); zniszczony okręt zapasu
 * przejmuje miejsce i id encji okrętu o ostatnim numerze (ten znika z liczności) — pad zniszczonego zostaje pusty.
 * Statek firmy (postój, odlot) → firma traci statek (`loseShip`); kurs, który zdążył dostać, ginie z nim
 * (`destroyCourse`). Zwraca opis straty albo null.
 */
export function loseBubbleEntity(state, id, info = {}) {
  const world = state.world;
  const num = Number(id);
  const ref = state.held?.get(num) || resolveBubbleEntity(state, num);
  state.held?.delete(num);
  if (!ref) return null;
  const x = Number.isFinite(Number(info.x)) ? Number(info.x) : (ref.x ?? 0);
  const y = Number.isFinite(Number(info.y)) ? Number(info.y) : (ref.y ?? 0);
  if (ref.actor) dropDepartedActor(state.bubble, ref.actor);
  if (ref.ship) {
    const ship = ref.ship;
    ship.gameHold = false;
    state.parked?.departing?.delete(String(ship.id));
    const course = ship.courseId ? getCourse(world.registry, ship.courseId) : null;
    if (course && course.status === COURSE_STATUS.ACTIVE) {
      destroyCourse(world.director, course, { reason: info.reason || 'player', x, y });
    } else {
      loseShip(world.companies, getCompany(world.companies, ship.companyId), ship, 0);
    }
    return { kind: ref.kind, shipId: String(ship.id) };
  }
  const garrisonCourse = ref.kind === 'departed' && (ref.courseKind === 'patrol' || ref.courseKind === 'war');
  if (ref.kind === 'stock' || garrisonCourse) {
    const war = world.war;
    if (!war || !world.shipyards || !ref.factionId) return null;
    const garrison = war.garrison || (war.garrison = createGarrisonState());
    garrison.losses.push({
      factionId: ref.factionId, classId: ref.classId || null, stationId: ref.portId || null, x, y,
      reason: info.reason || 'player',
      // Wrak gry tej encji (E24, `wreck-report` ze źródłem `entity:<id>`) staje się wrakiem tej straty.
      source: `entity:${num}`
    });
    const events = [];
    settleGarrisonLosses(war, world.shipyards, world.rng, events);
    const lost = events[0] || null;
    if (ref.kind === 'stock' && lost) handOverStockSpot(state, ref, lost.classId);
    return { kind: ref.kind, classId: lost?.classId || null, factionId: ref.factionId };
  }
  return { kind: ref.kind };
}

/** Po stracie okrętu zapasu: zniknął ostatni numer klasy — zniszczony bierze jego miejsce i id encji. */
function handOverStockSpot(state, ref, classId) {
  const fleet = state.world.shipyards?.fleets?.get(String(ref.factionId));
  if (!fleet || classId !== ref.classId) return;
  const lastId = `${ref.factionId}:${classId}:${(Number(fleet[classId]) || 0) + 1}`;
  const lostId = ref.fleetShipId;
  if (!lostId || lastId === lostId) return;
  for (const reg of state.stock.regs.values()) renameParkedShip(reg, lastId, lostId);
  const ids = state.stock.ids;
  const lastEntity = ids.get(lastId);
  if (lastEntity !== undefined) ids.set(lostId, lastEntity);
  else ids.delete(lostId);
  ids.delete(lastId);
}

/** Stałe id ujemne encji bez kursu (zapas floty, postój) — po id statku, jedno źródło dla obu list. */
function entityId(state, shipId) {
  const stock = state.stock;
  let id = stock.ids.get(shipId);
  if (id === undefined) stock.ids.set(shipId, id = -(++stock.seq));
  return id;
}

// ============================================================
// Postój bez kursu (E15): reda przy ringu, orbita postojowa przy budowli doku
// ============================================================

/**
 * Rejestr postoju cywilnego portu (leniwie): port z ringiem — reda świata (`world.parking`, strefy cywilne);
 * port z budowlą doku E14 — orbita postojowa za dyskiem zapasu (`buildDockOrbitParking`, z dala od ścieżek
 * bańki); reszta (hangar kryjówki) — `null`, statki w hangarze bez obrazu jak dotąd.
 */
function parkedRegistry(state, portId) {
  const regs = state.parked.regs;
  if (regs.has(portId)) return regs.get(portId);
  const world = state.world;
  const layout = world.docks.get(portId);
  let plan = null;
  if (layout?.hasRing) plan = world.parking?.get(portId) || null;
  else if (layout?.model) {
    plan = buildDockOrbitParking(layout, getNode(world.network, portId), { keepOut: dockKeepOut(state, portId, layout) });
  }
  const focus = state.parked.focus;
  const reg = plan ? createParkingRegistry(plan, {
    role: BERTH_ROLE.CIVIL,
    mode: 'reda',
    hangarCapacity: Infinity,
    // Gracz ma pierwszeństwo do miejsca: slot pod nim nie idzie nowemu statkowi.
    isFree: (slot, cls) => {
      if (!focus.active) return true;
      const dx = slot.x - focus.x;
      const dy = slot.y - focus.y;
      const clear = cls.depth + PARKED_PLAYER_CLEARANCE;
      return dx * dx + dy * dy > clear * clear;
    }
  }) : null;
  regs.set(portId, reg);
  return reg;
}

/** Odcinek drogi odlotu i lejka za budowlą [j.] — tyle wolnego od orbity postojowej. */
const DOCK_LANE_REACH = 12000;

/**
 * Odcinki ruchu bańki przy budowli doku (E14) dla orbity postojowej: ścieżki wejścia i wyjścia każdego stanowiska,
 * lejek (promieniowo od środka budowli przez lejek — ostatni odcinek trasy z przestrzeni) i odlot (promieniowo
 * przez koniec wylotu — `beginDeparture`). Płaska lista `[ax, ay, bx, by] × n`.
 */
function dockKeepOut(state, portId, layout) {
  const index = state.bubble.ports;
  const m = layout.model;
  const out = [];
  const ray = (x, y) => {
    const dx = x - m.x;
    const dy = y - m.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    out.push(x, y, x + dx / d * DOCK_LANE_REACH, y + dy / d * DOCK_LANE_REACH);
  };
  const polyline = (pts, n) => {
    for (let k = 0; k + 1 < n; k++) out.push(pts[k * 4], pts[k * 4 + 1], pts[(k + 1) * 4], pts[(k + 1) * 4 + 1]);
  };
  for (const berth of layout.berths || []) {
    const ref = index.berths.get(String(berth.id));
    const entry = portEntryForBerth(index, berth, ref?.dock || null, portId);
    if (!entry || entry.kind !== 'model') continue;
    polyline(entry.inbound, entry.inboundCount);
    if (entry.outbound) polyline(entry.outbound, entry.outboundCount);
    if (entry.funnelX === entry.funnelX) {
      out.push(entry.funnelX, entry.funnelY, entry.inbound[0], entry.inbound[1]);
      ray(entry.funnelX, entry.funnelY);
    } else ray(entry.inbound[0], entry.inbound[1]);
    const k = (entry.outboundCount || 0) - 1;
    if (k >= 0) ray(entry.outbound[k * 4], entry.outbound[k * 4 + 1]);
  }
  return out;
}

/** Czy miejsce postoju ma obraz: reda przy ringu — pierwsze sloty pasma strefy; orbita — każdy slot. */
function parkedSpotVisible(reg, spot) {
  if (!spot || spot.kind !== 'reda') return false;
  return !reg.plan?.hasRing || spot.index < PARKED_VISIBLE_SLOTS;
}

/**
 * Statki firm stojące bez kursu w portach przy fokusie (E15) → rejestry postoju (`syncParking` — stabilnie:
 * statek stoi na swoim slocie, dopóki nie odleci) i lista encji bańki (`PARKED`, id ujemny). Woła rdzeń po
 * kroku świata i przy wejściu bańki w port. Statek pokazany ostatnio, który dostał kurs, oddaje kursowi pozę
 * (`viewState.handoff`) — encja kursu zaczyna lot z miejsca na redzie, w tym samym buforze, bez mignięcia.
 */
export function refreshParkedShips(state, focus) {
  const world = state.world;
  const parked = state.parked;
  const f = parked.focus;
  f.active = !!focus?.active && focus.r > 0;
  f.x = Number(focus?.x) || 0;
  f.y = Number(focus?.y) || 0;
  const previous = parked.shown;
  const shown = new Map();
  parked.list.length = 0;
  const near = parked.ports;
  near.clear();
  if (f.active) {
    const r2 = state.range * state.range;
    for (const id of bubblePortIds(state)) {
      const node = getNode(world.network, id);
      if (!node) continue;
      const dx = node.x - f.x;
      const dy = node.y - f.y;
      if (dx * dx + dy * dy <= r2 && parkedRegistry(state, id)) near.add(id);
    }
  }

  if (near.size) {
    const byStation = parked.byStation;
    for (const list of byStation.values()) list.length = 0;
    const factions = new Map();
    for (const company of world.companies?.companies || []) {
      for (const ship of company.ships) {
        if (ship.state !== SHIP_STATE.PARKED || !near.has(ship.stationId)) continue;
        let list = byStation.get(ship.stationId);
        if (!list) byStation.set(ship.stationId, list = []);
        list.push(ship);
        factions.set(ship.id, company.factionId || null);
      }
    }
    for (const portId of near) {
      const reg = parkedRegistry(state, portId);
      const ships = byStation.get(portId) || [];
      syncParking(reg, ships);
      for (const ship of ships) {
        const spot = reg.byShip.get(String(ship.id));
        if (!parkedSpotVisible(reg, spot)) continue;
        const size = hullFootprint(ship.hullId);
        const entry = {
          id: entityId(state, ship.id), hullId: ship.hullId, factionId: factions.get(ship.id) ?? null,
          x: spot.x, y: spot.y, angle: spot.angle, berthId: null, length: size.length, width: size.width,
          flags: ACTOR_FLAG.PARKED, phase: PHASE_HOLD, shipId: String(ship.id)
        };
        parked.list.push(entry);
        shown.set(entry.shipId, entry);
      }
    }
  }

  // Statek z redy dostał kurs: encja kursu startuje z miejsca postoju (oddanie pozy jak po awansie, E6).
  for (const [shipId, entry] of previous) {
    if (shown.has(shipId)) continue;
    const ship = getShip(world.companies, shipId);
    if (!ship || ship.state === SHIP_STATE.PARKED || !ship.courseId) continue;
    const course = getCourse(world.registry, ship.courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE || course.actorId || course.viewState) continue;
    course.viewState = {
      handoff: true, stageIndex: course.stageIndex, x: entry.x, y: entry.y, angle: entry.angle, speed: 0
    };
    parked.handoffs++;
  }
  parked.shown = shown;
  return parked.list.length;
}

/**
 * Statek w odlocie na swój slot dostał nowy kurs, zanim doleciał (dyspozytor daje go często przy rozliczeniu
 * rozładunku): kurs przejmuje pozę encji odlotu, a ta znika — przed krokiem bańki, w którym kurs się
 * materializuje (ten sam bufor, jeden statek). Kurs spoza kandydatów bańki czeka (odlot leci dalej). Woła rdzeń
 * przed każdym krokiem bańki; zwraca liczbę oddanych póz.
 */
export function handoffDepartures(state) {
  const parked = state?.parked;
  if (!parked?.departing.size) return 0;
  const world = state.world;
  let n = 0;
  for (const [shipId, actor] of parked.departing) {
    if (!(actor.slot >= 0) || !actor.departed) {
      parked.departing.delete(shipId);
      continue;
    }
    const ship = getShip(world.companies, shipId);
    if (!ship || ship.state === SHIP_STATE.PARKED || !ship.courseId) continue;
    const course = getCourse(world.registry, ship.courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE || course.actorId) {
      // Kurs już ma encję albo nie żyje — odlot nie ma kogo zasłaniać.
      dropDepartedActor(state.bubble, actor);
      parked.departing.delete(shipId);
      continue;
    }
    if (!state.candidates.includes(course)) continue;
    course.viewState = {
      handoff: true, stageIndex: course.stageIndex, x: actor.x, y: actor.y, angle: actor.angle,
      speed: Math.abs(actor.speed) || 0
    };
    parked.handoffs++;
    dropDepartedActor(state.bubble, actor);
    parked.departing.delete(shipId);
    n++;
  }
  return n;
}

/**
 * Hak odlotu (`departTarget`, E15): statek firmy, którego kurs skończył się przy stanowisku tego portu, leci na
 * swoje miejsce postoju (rezerwacja w rejestrze, `reserveParkingSpot`) — o ile miejsce ma obraz. Do jego końca
 * statek postoju w buforze jest zasłonięty (`departing`), potem stoi dokładnie tam, gdzie encja znikła.
 */
function departToParking(state, course, actor, out) {
  const shipId = course?.payload?.shipId;
  const portId = actor?.dockedEntry?.stationId;
  if (!shipId || !portId || String(course.destinationId || '') !== portId) return false;
  const reg = parkedRegistry(state, portId);
  const ship = reg ? getShip(state.world.companies, shipId) : null;
  if (!ship) return false;
  const spot = reserveParkingSpot(reg, ship);
  if (!parkedSpotVisible(reg, spot)) return false;
  out.x = spot.x;
  out.y = spot.y;
  out.angle = spot.angle;
  state.parked.departing.set(String(shipId), actor);
  return true;
}

/**
 * Zmiany postojów przy stanowisku (kontrakt `DockRecord` z `trafficProtocol.js`, przeładunek E12): nowe albo
 * zmienione → `docks`, zakończone → `undocked`. `time` — czas mostu (`trafficWorldTime`). Zwraca `null`, gdy
 * nic się nie zmieniło (wiadomość bez pól).
 */
export function collectDockChanges(state, time, hullOf) {
  const sent = state.docksSent;
  const list = state.bubble.list;
  const seen = state._dockSeen || (state._dockSeen = new Set());
  seen.clear();
  let docks = null;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (a.phase !== ACTOR_PHASE.DOCKED || !a.dockedEntry?.berthId) continue;
    const course = getCourse(state.world.registry, a.courseId);
    const stage = course?.stages?.[course.stageIndex];
    if (!stage || stage.kind !== 'dwell') continue;
    const num = courseNumber(a.courseId);
    if (!Number.isFinite(num)) continue;
    seen.add(num);
    const seconds = Math.max(0, Number(stage.seconds) || 0);
    const sig = `${course.stageIndex}|${a.dockedEntry.berthId}|${seconds}`;
    if (sent.get(num) === sig) continue;
    sent.set(num, sig);
    // Obsługa przy stanowisku: od przechwytu do końca postoju; dojście w porcie (`moveSeconds`) zastąpił lot.
    // Kolejny postój przy tym samym stanowisku (bez przechwytu, bez kredytu dojścia) zaczyna się teraz.
    const moveCredit = Math.min(Number(stage.moveSeconds) || 0, seconds);
    const tEnd = time + Math.max(0, seconds - a.dwell);
    const t0 = Math.min(time, tEnd - Math.max(0, seconds - moveCredit));
    const dur = tEnd - t0;
    (docks || (docks = [])).push({
      id: num,
      berthId: a.dockedEntry.berthId,
      stationId: course.portStationId || stage.nodeId || null,
      mode: stage.reason || 'service',
      cargo: cargoOf(course),
      fill: fillOf(course),
      t0,
      dur,
      hull: hullOf ? hullOf(a.unitClass) : a.unitClass,
      unitClass: a.unitClass
    });
  }
  let undocked = null;
  for (const num of sent.keys()) {
    if (seen.has(num)) continue;
    sent.delete(num);
    (undocked || (undocked = [])).push(num);
  }
  return docks || undocked ? { docks, undocked } : null;
}

/**
 * Zmiany manifestów ładunku encji (kontenery-łup K1, `docs/PROPOZYCJA-kontenery-lup.md` § 3.1): gra musi wiedzieć,
 * co wiezie encja, ZANIM ta zginie — rekord wraku (`tick.wrecks`) przychodzi dopiero po kroku świata (do 5 s).
 * Encja z kursem w locie z ładunkiem → `manifests: [{ id, cargo, mass, value }]` (nowa albo zmieniona); encja,
 * która zniknęła z bańki albo nie wiezie już nic (rozładunek, odlot) → `unmanifested: [id]`. Promy z ludźmi,
 * puste przeloty i wyprawa górnicza przed urobkiem manifestu nie mają. Zwraca `null`, gdy nic się nie zmieniło.
 */
export function collectManifestChanges(state) {
  const sent = state.manifestsSent || (state.manifestsSent = new Map());
  const list = state.bubble.list;
  const seen = state._manifestSeen || (state._manifestSeen = new Set());
  seen.clear();
  let manifests = null;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (a.departed || !a.courseId) continue;
    const course = getCourse(state.world.registry, a.courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE) continue;
    const p = course.payload;
    if (!p || p.passengers || p.deadhead) continue;
    // Wyprawa górnicza: urobek dopisuje się po etapie wydobycia (`extract.booked`) — wcześniej ładownia jest pusta.
    if (p.harvest && p.extract && !p.extract.booked) continue;
    // Masa z kursu, a bez niej (przemytnik — `piracy.js`) z towarów; sygnatura liczbowa bez budowy obiektów.
    const mass = payloadMass(p);
    if (!(mass > 0)) continue;
    const sig = payloadSignature(p, mass);
    if (sig === 0) continue;
    // Numer kursu na encji (napis → liczba tylko przy zmianie kursu).
    if (a._manifestOf !== a.courseId) { a._manifestOf = a.courseId; a._manifestNum = courseNumber(a.courseId); }
    const num = a._manifestNum;
    if (!Number.isFinite(num)) continue;
    seen.add(num);
    if (sent.get(num) === sig) continue;
    sent.set(num, sig);
    // Ładunek (obiekt) dopiero przy zmianie.
    (manifests || (manifests = [])).push({ id: num, cargo: cargoOf(course), mass, value: Number(p.value) || 0 });
  }
  let unmanifested = null;
  for (const num of sent.keys()) {
    if (seen.has(num)) continue;
    sent.delete(num);
    (unmanifested || (unmanifested = [])).push(num);
  }
  return manifests || unmanifested ? { manifests, unmanifested } : null;
}

const RES_ORDER = new Map(RESOURCE_KEYS.map((id, i) => [id, i + 1]));

/** Masa ładunku kursu [t]: `payload.mass`, a gdy jej brak — sztuki × masa sztuki towaru (bez alokacji). */
function payloadMass(p) {
  const m = Number(p.mass);
  if (m > 0) return m;
  let sum = 0;
  if (p.harvest && typeof p.harvest === 'object') {
    for (const id in p.harvest) {
      const n = Number(p.harvest[id]);
      if (n > 0) sum += n * (Number(RESOURCES[id]?.mass) || 1);
    }
    return sum;
  }
  const n = Number(p.units);
  return p.resourceId && n > 0 ? n * (Number(RESOURCES[p.resourceId]?.mass) || 1) : 0;
}

/** Krok sygnatury: towar i sztuki (setne) wmieszane w `h`. */
function sigMix(h, id, n) {
  return (Math.imul(h ^ (RES_ORDER.get(id) || 0), 0x9e3779b1) + Math.round(n * 100)) | 0;
}

/** Liczbowa sygnatura ładunku kursu (towary, sztuki, masa) — 0, gdy pusty. Bez alokacji. */
function payloadSignature(p, mass) {
  let h = 0;
  let any = false;
  if (p.harvest && typeof p.harvest === 'object') {
    for (const id in p.harvest) {
      const n = Number(p.harvest[id]);
      if (n > 0) { h = sigMix(h, id, n); any = true; }
    }
  } else if (p.resourceId) {
    const n = Number(p.units);
    if (n > 0) { h = sigMix(h, p.resourceId, n); any = true; }
  }
  if (!any) return 0;
  // Bez zera (zero = „brak ładunku”); masa w setnych tony.
  return ((Math.imul(h, 31) + Math.round(mass * 100)) | 0) || 1;
}


/** Ładunek kursu w jednostkach świata ruchu: przewóz / kupiec / przemyt — jeden towar, wyprawa — worek urobku. */
function cargoOf(course) {
  const p = course?.payload;
  if (!p) return {};
  if (p.harvest && typeof p.harvest === 'object') {
    const out = {};
    for (const [id, n] of Object.entries(p.harvest)) if (Number(n) > 0) out[id] = Number(n);
    return out;
  }
  if (p.resourceId && Number(p.units) > 0) return { [p.resourceId]: Number(p.units) };
  return {};
}

/**
 * Kontrakt przeładunku E12 (`bubbleCargo.js`, pole `cargo` wiadomości `actors`): rekord na encję przy stanowisku
 * (przechwyt, postój, odłączanie — `dockedEntry`) w postoju LOAD / UNLOAD z ładunkiem. Co wiadomość, obok `data`
 * (bez zmiany `ACTOR_STRIDE`). `resourceIndex(id)` — indeks w tabeli `ready.resources`. Zwraca kopię albo null.
 */
export function packBubbleCargo(state, resourceIndex) {
  const list = state.bubble.list;
  let buf = state.cargoBuf || (state.cargoBuf = new Float32Array(ACTOR_CARGO_STRIDE * 32));
  let n = 0;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (!a.dockedEntry) continue;
    if (a.phase !== ACTOR_PHASE.CAPTURE && a.phase !== ACTOR_PHASE.DOCKED && a.phase !== ACTOR_PHASE.UNDOCK) continue;
    const course = getCourse(state.world.registry, a.courseId);
    const num = courseNumber(a.courseId);
    if (!course || !Number.isFinite(num)) continue;
    if ((n + 1) * ACTOR_CARGO_STRIDE > buf.length) {
      const grown = new Float32Array(buf.length * 2);
      grown.set(buf);
      buf = state.cargoBuf = grown;
    }
    n += writeBubbleCargo(buf, n, num, course, resourceIndex);
  }
  return n ? buf.slice(0, n * ACTOR_CARGO_STRIDE) : null;
}

const HOLD_BY_VAN_CLASS = new Map(VAN_CLASSES.map((c) => [c.id, c.capacity]));

/**
 * Wypełnienie ładowni 0…1: masa ładunku / ładowność klasy kursu (`payload.vanClassId` albo klasa z kadłuba —
 * `VAN_CLASS_OF_UNIT`); null — klasa bez ładowni (okręty, rejdery, holowniki).
 */
function fillOf(course) {
  const p = course?.payload;
  const cls = p?.vanClassId || VAN_CLASS_OF_UNIT[course?.unitClass];
  const hold = cls ? HOLD_BY_VAN_CLASS.get(cls) : 0;
  if (!(hold > 0)) return null;
  const mass = Number(p?.mass) || 0;
  return mass > 0 ? Math.min(1, mass / hold) : 0;
}

/** Encja bańki przy kursie `courseId` albo null. */
export function bubbleActorOf(state, courseId) {
  return state?.bubble?.actors?.get(String(courseId || '')) || null;
}

/**
 * Czy kurs da się jeszcze przenieść na inne stanowisko: encja nie weszła w
 * korytarz portu (punkt czekania za nią) i nie stoi przy stanowisku. Kurs bez
 * encji — gdy rekord nie stoi już na polu (dojście w porcie trwa).
 */
export function courseCanLeaveBerth(state, course) {
  const actor = bubbleActorOf(state, course?.id);
  if (actor) {
    if (actor.phase === ACTOR_PHASE.CAPTURE || actor.phase === ACTOR_PHASE.DOCKED
      || actor.phase === ACTOR_PHASE.UNDOCK) return false;
    if (actor.waitIndex > 0 && actor.wp > actor.waitIndex) return false;
    return true;
  }
  const stage = course?.stages?.[course.stageIndex];
  if (!stage) return false;
  const move = Number(stage.moveSeconds) || 0;
  return move > 0 && (Number(course.stageElapsed) || 0) < move;
}

/**
 * Pakuje encje do bufora `ACTOR_FIELD`. `index` — `{ hull(unitClass),
 * faction(id), station(id), berth(berthRef), courseId(num, id) }` z rdzenia
 * (te same tabele co bufor kursów). Zwraca `{ data, count }` (data = kopia
 * do przekazania).
 */
export function packWorldBubble(state, index, kindIndex = null, focus = null) {
  const list = state.bubble.list;
  const n = list.length;
  const stock = state.active && focus ? state.stock.list : null;
  const parked = state.active && focus ? state.parked.list : null;
  const total = n + (stock ? stock.length : 0) + (parked ? parked.length : 0);
  let data = state.data;
  if (total * ACTOR_STRIDE > data.length) {
    let size = data.length;
    while (size < total * ACTOR_STRIDE) size *= 2;
    data = state.data = new Float64Array(size);
  }
  const director = state.world.director;
  const dt = state.lastDt;
  for (let k = 0; k < n; k++) {
    const a = list[k];
    const o = k * ACTOR_STRIDE;
    // Ruch faktyczny kroku (poza z początku `updateBubble` → bieżąca): średnia prędkość kroku `u`, przyspieszenie
    // z dwóch kroków, prędkość na końcu kroku ≈ u + a·dt/2. Prędkość wzdłuż dziobu nie widzi rozpychania,
    // dociągania przechwytu ani zmian kierunku — gra skakałaby przy każdym nowym buforze.
    let vx = a.vx;
    let vy = a.vy;
    let w = a.angVel;
    let ax = 0;
    let ay = 0;
    if (dt > 0) {
      const ux = (a.x - a.prevX) / dt;
      const uy = (a.y - a.prevY) / dt;
      if (a.effSeen) {
        ax = clampAccel((ux - a.effVx) / dt);
        ay = clampAccel((uy - a.effVy) / dt);
      }
      a.effVx = ux;
      a.effVy = uy;
      a.effSeen = true;
      vx = ux + ax * dt * 0.5;
      vy = uy + ay * dt * 0.5;
      w = wrapAngle(a.angle - a.prevAngle) / dt;
    }
    let num = courseNumber(a.courseId);
    if (!Number.isFinite(num)) num = -1;
    else index.courseId(num, a.courseId);
    const course = getCourse(state.world.registry, a.courseId);
    let flags = 0;
    if (a.mode === 'warp') flags |= ACTOR_FLAG.WARP;
    if (a.departed) flags |= ACTOR_FLAG.DEPARTED;
    let berthEntry = null;
    if (a.dockedEntry && (a.phase === ACTOR_PHASE.CAPTURE || a.phase === ACTOR_PHASE.DOCKED
      || a.phase === ACTOR_PHASE.UNDOCK)) {
      berthEntry = a.dockedEntry;
    } else if (a.dockedEntry && a.phase === ACTOR_PHASE.FLY) {
      berthEntry = a.dockedEntry;
      flags |= ACTOR_FLAG.LEAVING;
    } else if (a.entry && course?.berthRef) {
      berthEntry = a.entry;
      flags |= ACTOR_FLAG.APPROACH;
    }
    if (course) {
      if (director?.convoys && convoyOf(director.convoys, course.id)) flags |= ACTOR_FLAG.CONVOY;
      if (course.payload?.agentId) flags |= ACTOR_FLAG.AGENT;
      if (course.payload?.deadhead) flags |= ACTOR_FLAG.DEADHEAD;
      if (kindIndex) flags |= (kindIndex.get(course.kind) ?? 0) << COURSE_KIND_SHIFT;
    }
    data[o + ACTOR_FIELD.ID] = num;
    data[o + ACTOR_FIELD.X] = a.x;
    data[o + ACTOR_FIELD.Y] = a.y;
    data[o + ACTOR_FIELD.ANGLE] = a.angle;
    data[o + ACTOR_FIELD.VX] = vx;
    data[o + ACTOR_FIELD.VY] = vy;
    data[o + ACTOR_FIELD.ANG_VEL] = w;
    data[o + ACTOR_FIELD.HULL] = index.hull(a.unitClass);
    data[o + ACTOR_FIELD.FACTION] = index.faction(a.factionId);
    data[o + ACTOR_FIELD.PHASE] = PHASE_INDEX.get(a.phase) ?? 0;
    data[o + ACTOR_FIELD.FLAGS] = flags;
    data[o + ACTOR_FIELD.THROTTLE] = a.throttle;
    data[o + ACTOR_FIELD.LENGTH] = a.length;
    data[o + ACTOR_FIELD.WIDTH] = a.width;
    const berth = berthEntry?.berthId ? index.berthById(berthEntry.berthId) : null;
    data[o + ACTOR_FIELD.PORT] = berth ? berth.port : -1;
    data[o + ACTOR_FIELD.BERTH] = berth ? berth.index : -1;
    data[o + ACTOR_FIELD.DOCK_TIME] = a.dockTime;
    data[o + ACTOR_FIELD.SPEED] = a.speed;
    data[o + ACTOR_FIELD.AX] = ax;
    data[o + ACTOR_FIELD.AY] = ay;
  }
  // Encje bez kursu w promieniu fokusu: zapas floty na padach K-7 (STOCK, faza `docked`) i na redzie wojskowej
  // (STOCK + PARKED), statki firm na redzie / orbicie postojowej (PARKED, faza `hold`). Stoją, id ujemny.
  let m = n;
  if (stock) m = packStanding(state, stock, data, m, index, focus);
  const s0 = m;
  if (parked) m = packStanding(state, parked, data, m, index, focus);
  state.count = m;
  state.stats.actors = n;
  state.stats.stock = s0 - n;
  state.stats.parked = m - s0;
  return { data: data.slice(0, m * ACTOR_STRIDE), count: m };
}

/** Encje stojące bez kursu (`refreshFleetStock`, `refreshParkedShips`) od pozycji `m` bufora; zwraca nowe `m`. */
function packStanding(state, items, data, m, index, focus) {
  const r2 = focus.r * focus.r;
  const departing = state.parked.departing;
  for (let k = 0; k < items.length && m < BUBBLE_ENTITY_LIMIT; k++) {
    const s = items[k];
    const dx = s.x - focus.x;
    const dy = s.y - focus.y;
    if (dx * dx + dy * dy > r2) continue;
    // Statek leci jeszcze na swój slot (odlot po kursie) — stanie tu, gdy encja odlotu zniknie.
    if (s.shipId && departing.size) {
      const a = departing.get(s.shipId);
      if (a && a.slot >= 0 && a.departed) continue;
    }
    const o = m * ACTOR_STRIDE;
    const berth = s.berthId ? index.berthById(s.berthId) : null;
    data[o + ACTOR_FIELD.ID] = s.id;
    data[o + ACTOR_FIELD.X] = s.x;
    data[o + ACTOR_FIELD.Y] = s.y;
    data[o + ACTOR_FIELD.ANGLE] = s.angle;
    data[o + ACTOR_FIELD.VX] = 0;
    data[o + ACTOR_FIELD.VY] = 0;
    data[o + ACTOR_FIELD.ANG_VEL] = 0;
    data[o + ACTOR_FIELD.HULL] = index.hull(s.hullId);
    data[o + ACTOR_FIELD.FACTION] = index.faction(s.factionId);
    data[o + ACTOR_FIELD.PHASE] = s.phase;
    data[o + ACTOR_FIELD.FLAGS] = s.flags;
    data[o + ACTOR_FIELD.THROTTLE] = 0;
    data[o + ACTOR_FIELD.LENGTH] = s.length;
    data[o + ACTOR_FIELD.WIDTH] = s.width;
    data[o + ACTOR_FIELD.PORT] = berth ? berth.port : -1;
    data[o + ACTOR_FIELD.BERTH] = berth ? berth.index : -1;
    data[o + ACTOR_FIELD.DOCK_TIME] = 0;
    data[o + ACTOR_FIELD.SPEED] = 0;
    data[o + ACTOR_FIELD.AX] = 0;
    data[o + ACTOR_FIELD.AY] = 0;
    m++;
  }
  return m;
}
