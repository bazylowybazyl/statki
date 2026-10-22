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
  createBubble, updateBubble, clearBubble, releaseBubbleCourse, setBubblePorts, ACTOR_PHASE
} from './materializedFlight.js';
import { createRingObstaclesForNetwork } from './ringRouter.js';
import { getCourse, COURSE_STATUS } from './courseRegistry.js';
import { createParkingRegistry, placeFleetStock } from './portParking.js';
import { SYSTEM_MAP_PLANETS } from '../../data/systemMap.js';
import { haloRingKey } from '../haloRingPlanets.js';
import { computeHaloRingLayout } from '../../3d/haloRing/haloRingLayout.js';
import { BERTH_ROLE, hullFootprint } from './dockLayout.js';
import { getNode } from './travelNetwork.js';
import { settleCourseEvents } from './trafficDirector.js';
import {
  ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, COURSE_KIND_SHIFT, courseNumber
} from './trafficProtocol.js';
import { convoyOf } from './convoy.js';

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

const PHASE_INDEX = new Map(ACTOR_PHASES.map((phase, index) => [phase, index]));

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
    ...(options.flight || {})
  });
  const state = {
    world,
    bubble,
    ports,
    range: Number(options.range) > 0 ? Number(options.range) : BUBBLE_PORT_RANGE,
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

/** Czy fokus jest przy porcie bańki. */
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
  return false;
}

/**
 * Po zmianie rynków (`market-add` / `market-remove`, kryjówki misji): układy doków świata do indeksu portów
 * bańki (stanowiska nowych rynków dostają ścieżki pomostu / hangaru).
 */
export function refreshWorldBubblePorts(state) {
  setBubblePorts(state.bubble, state.world.docks);
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
  const near = !!focus?.active && focus.r > 0 && bubblePortNear(state, focus.x, focus.y);
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
 * (`placeFleetStock`, rejestr redy wojskowej portu). Woła rdzeń po każdym kroku świata. Okręty na redzie
 * (nadmiar) nie wchodzą — pady to hala, reda czeka na rysowanie postoju bez kursu.
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
    const result = placeFleetStock(layout, reg, own ? { [owner]: own } : {});
    for (const [shipId, spot] of result.placements) {
      if (spot.kind !== 'berth') continue;
      let id = stock.ids.get(shipId);
      if (id === undefined) stock.ids.set(shipId, id = -(++stock.seq));
      const size = hullFootprint(spot.hullId);
      stock.list.push({
        id, hullId: spot.hullId, factionId: spot.factionId, x: spot.x, y: spot.y, angle: spot.angle,
        berthId: spot.berthId, length: size.length, width: size.width
      });
    }
  }
  return stock.list.length;
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
  const total = n + (stock ? stock.length : 0);
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
  // Zapas floty na padach K-7 w promieniu fokusu: stoją (faza `docked`, prędkość 0), flaga STOCK, id ujemny.
  let m = n;
  if (stock) {
    const r2 = focus.r * focus.r;
    const docked = PHASE_INDEX.get(ACTOR_PHASE.DOCKED) ?? 2;
    for (let k = 0; k < stock.length; k++) {
      const s = stock[k];
      const dx = s.x - focus.x;
      const dy = s.y - focus.y;
      if (dx * dx + dy * dy > r2) continue;
      const o = m * ACTOR_STRIDE;
      const berth = index.berthById(s.berthId);
      data[o + ACTOR_FIELD.ID] = s.id;
      data[o + ACTOR_FIELD.X] = s.x;
      data[o + ACTOR_FIELD.Y] = s.y;
      data[o + ACTOR_FIELD.ANGLE] = s.angle;
      data[o + ACTOR_FIELD.VX] = 0;
      data[o + ACTOR_FIELD.VY] = 0;
      data[o + ACTOR_FIELD.ANG_VEL] = 0;
      data[o + ACTOR_FIELD.HULL] = index.hull(s.hullId);
      data[o + ACTOR_FIELD.FACTION] = index.faction(s.factionId);
      data[o + ACTOR_FIELD.PHASE] = docked;
      data[o + ACTOR_FIELD.FLAGS] = ACTOR_FLAG.STOCK;
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
  }
  state.count = m;
  state.stats.actors = n;
  state.stats.stock = m - n;
  return { data: data.slice(0, m * ACTOR_STRIDE), count: m };
}
