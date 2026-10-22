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
 * Zawężenie fali 3: bańka żyje tylko przy portach z `BUBBLE_PORTS` (dziś
 * Ziemia) — fokus dalej niż `BUBBLE_PORT_RANGE` od węzła portu zwalnia
 * wszystkie encje do rekordów. Kandydaci do materializacji to kursy z bufora
 * bańki rdzenia (`buildBubble`: w promieniu fokusu w horyzoncie kroku świata)
 * — bez przeglądu tysięcy aktywnych kursów co klatkę.
 *
 * Stanowiska gracza (`berth-hold`): dyspozytor ich nie przydziela, a kurs,
 * który na takie stanowisko dopiero leci, dostaje inne (`setPlayerBerthHolds`
 * w dyspozytorze); statek, który już wszedł w korytarz albo stoi na polu,
 * zostaje — gra widzi go w rejestrze jako zajęte.
 */

import {
  createBubble, updateBubble, clearBubble, releaseBubbleCourse, ACTOR_PHASE
} from './materializedFlight.js';
import { createRingObstaclesForNetwork } from './ringRouter.js';
import { getCourse, COURSE_STATUS } from './courseRegistry.js';
import { getNode } from './travelNetwork.js';
import { settleCourseEvents } from './trafficDirector.js';
import {
  ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, COURSE_KIND_SHIFT, courseNumber
} from './trafficProtocol.js';
import { convoyOf } from './convoy.js';

/** Porty, przy których bańka działa (fala 3: jeden port). */
export const BUBBLE_PORTS = Object.freeze(['earth']);
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
  const bubble = createBubble({
    rings: createRingObstaclesForNetwork(world.network, world.docks),
    docks: world.docks,
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
    stats: { ms: 0, maxMs: 0, actors: 0, events: 0, candidates: 0 }
  };
  // `updateBubble` czyta kursy jak z mapy: po id (encje) i przegląd kandydatów.
  state.view = {
    get: (id) => getCourse(world.registry, id),
    values: () => state.candidates
  };
  return state;
}

/** Czy fokus jest przy porcie bańki. */
export function bubblePortNear(state, x, y) {
  const network = state.world.network;
  const r2 = state.range * state.range;
  for (let i = 0; i < state.ports.length; i++) {
    const node = getNode(network, state.ports[i]);
    if (!node) continue;
    const dx = node.x - x;
    const dy = node.y - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
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
export function packWorldBubble(state, index, kindIndex = null) {
  const list = state.bubble.list;
  const n = list.length;
  let data = state.data;
  if (n * ACTOR_STRIDE > data.length) {
    let size = data.length;
    while (size < n * ACTOR_STRIDE) size *= 2;
    data = state.data = new Float64Array(size);
  }
  const director = state.world.director;
  for (let k = 0; k < n; k++) {
    const a = list[k];
    const o = k * ACTOR_STRIDE;
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
    data[o + ACTOR_FIELD.VX] = a.vx;
    data[o + ACTOR_FIELD.VY] = a.vy;
    data[o + ACTOR_FIELD.ANG_VEL] = a.angVel;
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
  }
  state.count = n;
  state.stats.actors = n;
  return { data: data.slice(0, n * ACTOR_STRIDE), count: n };
}
