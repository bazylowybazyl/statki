/**
 * RDZEŃ RUCHU v2 — świat ruchu sterowany wiadomościami.
 *
 * Czysty handler: dostaje wiadomość (`handle`), odpowiada przez `post`. Nie wie,
 * czy siedzi w Web Workerze (`traffic.worker.js`), czy na głównym wątku
 * (tryb awaryjny `TrafficBridge`) — dlatego cały dyspozytor ze swoimi
 * callbackami (`getEconomy`, `onWreck`) i WeakMapami żyje tutaj w całości,
 * a przez granicę przechodzą wyłącznie dane: bufory i proste obiekty.
 *
 * Protokół i układ buforów: `trafficProtocol.js`.
 *
 * Koszt: krok świata (5 s gry) to przy ×60 śr. 12–18 ms, szczytowo ~80 ms —
 * na głównym wątku przycięcie klatki co 5 s, w workerze nic. Bańka i rynek
 * dokładają ułamek milisekundy na krok.
 */

import { RESOURCE_KEYS } from '../../data/resources.js';
import { FACTION_IDS } from '../../data/factions.js';
import { getDuress, resourcePrice } from '../stationEconomy.js';
import {
  COURSE_KIND, COURSE_STATUS, STAGE_KIND, getCourse, attachActor, detachActor,
  syncActorStageProgress, completeCurrentStage
} from './courseRegistry.js';
import { directorSnapshot, destroyCourse, settleCourseEvents } from './trafficDirector.js';
import { getNode } from './travelNetwork.js';
import { convoyOf } from './convoy.js';
import { summarizeWar } from './warDispatcher.js';
import { summarizePiracy } from './piracy.js';
import { summarizeScrappers } from './scrapperFleets.js';
import { summarizeShipyards } from './shipyards.js';
import { summarizeAgents } from './agentFleets.js';
import {
  buildTrafficWorld, advanceTrafficWorld, trafficWorldTime, applyWorldStockDelta,
  setWorldCapacityFromGame, destroyWorldStation
} from './trafficWorld.js';
import {
  TRAFFIC_MSG, TRAFFIC_PROTOCOL_VERSION, COURSE_STRIDE, COURSE_FIELD, COURSE_FLAG,
  COURSE_KIND_SHIFT, MARKET_STRIDE, MARKET_FIELD, courseNumber
} from './trafficProtocol.js';

/** Ile ostatnich wraków dyspozytora trzymać po wysłaniu do gry. */
const WRECK_LOG_LIMIT = 256;
/** O jaki ułamek promienia bańki musi przesunąć się fokus, żeby przebudować bańkę. */
const FOCUS_REPUBLISH_FRACTION = 0.25;

const KINDS = Object.freeze(Object.values(COURSE_KIND));

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : 0;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Tworzy rdzeń. `post(message, transfer)` wysyła odpowiedź — w workerze to
 * `self.postMessage`, w trybie awaryjnym odbiornik mostu.
 */
export function createTrafficCore(post, options = {}) {
  const now = typeof options.now === 'function' ? options.now : defaultNow;
  const send = typeof post === 'function' ? post : () => {};

  const core = {
    world: null,
    focus: { x: 0, y: 0, r: 0, active: false },
    published: { x: NaN, y: NaN, r: 0 },
    /** Ostatnia zastosowana zmiana zapasu z gry — gra odrzuca na jej podstawie potwierdzone. */
    stockSeq: 0,
    hulls: [],
    hullIndex: new Map(),
    hullsSent: 0,
    factionIndex: new Map(FACTION_IDS.map((id, index) => [id, index])),
    kindIndex: new Map(KINDS.map((kind, index) => [kind, index])),
    stationIndex: new Map(),
    berthIndex: new WeakMap(),
    /** Numer kursu → id, dla wiadomości z gry (`attach`, `destroyed`…). */
    courseIds: new Map(),
    wreckCursor: 0,
    warWreckSeq: 0,
    stationFactionsDirty: false,
    scratch: new Float64Array(COURSE_STRIDE * 256),
    segment: { x0: 0, y0: 0, x1: 0, y1: 0, t0: 0, dur: 0, dwell: false, mode: null },
    stats: { stepMs: 0, maxStepMs: 0, steps: 0, bubble: 0, queued: 0, berthed: 0 }
  };

  function handle(message) {
    const type = message?.type;
    try {
      switch (type) {
        case TRAFFIC_MSG.INIT: return init(message);
        case TRAFFIC_MSG.ADVANCE: return advance(message);
        case TRAFFIC_MSG.FOCUS: return focus(message);
        case TRAFFIC_MSG.STOCK: return stock(message);
        case TRAFFIC_MSG.CAPACITY: return capacity(message);
        case TRAFFIC_MSG.ATTACH: return attach(message);
        case TRAFFIC_MSG.DETACH: return detach(message);
        case TRAFFIC_MSG.PROGRESS: return progress(message);
        case TRAFFIC_MSG.STAGE_DONE: return stageDone(message);
        case TRAFFIC_MSG.DESTROYED: return destroyed(message);
        case TRAFFIC_MSG.STATION: return station(message);
        case TRAFFIC_MSG.CONFIG: return config(message);
        case TRAFFIC_MSG.SNAPSHOT: return snapshot(message);
        default: return undefined;
      }
    } catch (error) {
      send({
        type: TRAFFIC_MSG.ERROR,
        during: String(type || ''),
        message: String(error?.message || error),
        stack: String(error?.stack || '')
      });
      return undefined;
    }
  }

  // ============================================================
  // Wiadomości z gry
  // ============================================================

  function init(message) {
    const t0 = now();
    const world = buildTrafficWorld({
      seed: message.seed,
      economyScale: message.economyScale,
      capacityMultiplier: message.capacityMultiplier,
      piracyPressure: message.piracyPressure,
      piracyEnabled: message.piracyEnabled,
      origin: message.origin,
      planetAngles: message.planetAngles,
      planetScale: message.planetScale,
      sunRadius: message.sunRadius,
      stationSpecs: message.stations,
      ringPorts: message.ringPorts,
      directorOptions: {
        // Kurs z ciałem w grze rozstrzyga walka, nie kostka — patrz DIRECTOR_DEFAULTS.
        protectObserved: message.protectObserved !== false
      }
    });
    core.world = world;
    core.stationIndex = new Map(world.stations.map((entry, index) => [entry.id, index]));
    core.berthIndex = new WeakMap();
    for (const layout of world.docks.values()) {
      layout.berths.forEach((berth, index) => core.berthIndex.set(berth, index));
    }
    if (message.focus) setFocus(message.focus);
    const buildMs = now() - t0;

    send({
      type: TRAFFIC_MSG.READY,
      version: TRAFFIC_PROTOCOL_VERSION,
      clock: world.registry.clock,
      step: world.config.step,
      seed: message.seed ?? null,
      economyScale: world.config.economyScale,
      capacityMultiplier: world.config.capacityMultiplier,
      stations: world.stations.map(entry => {
        const node = getNode(world.network, entry.id);
        return {
          id: entry.id,
          name: entry.name,
          factionId: entry.factionId || null,
          x: entry.x,
          y: entry.y,
          moon: !!node?.moon,
          outpost: !!node?.outpost,
          derelict: !entry.factionId,
          parentId: node?.parentId || null,
          hasPort: world.docks.has(entry.id)
        };
      }),
      resources: [...RESOURCE_KEYS],
      factions: [...FACTION_IDS],
      kinds: [...KINDS],
      buildMs
    });
    // Rynek od razu, nie po pierwszych pięciu sekundach — terminal handlu
    // w grze ma co pokazać, zanim świat zrobi pierwszy krok.
    publishTick(0, 0);
  }

  function advance(message) {
    const world = core.world;
    if (!world) return;
    const dt = Math.max(0, finite(message.dt));
    if (!(dt > 0)) return;
    const t0 = now();
    const steps = advanceTrafficWorld(world, dt);
    if (!steps) return;
    const ms = now() - t0;
    core.stats.steps += steps;
    core.stats.stepMs = ms / steps;
    core.stats.maxStepMs = Math.max(core.stats.maxStepMs, core.stats.stepMs);
    publishTick(steps, ms);
  }

  function setFocus(spec) {
    const r = Math.max(0, finite(spec?.r));
    core.focus.x = finite(spec?.x);
    core.focus.y = finite(spec?.y);
    core.focus.r = r;
    core.focus.active = r > 0;
  }

  function focus(message) {
    setFocus(message);
    if (!core.world) return;
    const f = core.focus;
    const p = core.published;
    const moved = Math.hypot(f.x - p.x, f.y - p.y);
    // Bańka przebudowuje się sama co krok świata; między krokami tylko wtedy,
    // gdy gracz naprawdę przeleciał kawałek — w warpie to kilka razy na sekundę.
    if (!(moved <= f.r * FOCUS_REPUBLISH_FRACTION) || Math.abs(f.r - p.r) > p.r * FOCUS_REPUBLISH_FRACTION) {
      const bubble = buildBubble();
      send({ type: TRAFFIC_MSG.BUBBLE, ...bubble }, [bubble.data.buffer]);
    }
  }

  function stock(message) {
    if (!core.world) return;
    applyWorldStockDelta(core.world, String(message.stationId || ''), message.bag || {});
    const seq = finite(message.seq);
    if (seq > core.stockSeq) core.stockSeq = seq;
  }

  function capacity(message) {
    if (!core.world) return;
    setWorldCapacityFromGame(core.world, String(message.stationId || ''), message.capacity || {});
  }

  function resolveCourse(number) {
    const world = core.world;
    if (!world) return null;
    const num = finite(number, NaN);
    const id = core.courseIds.get(num);
    const known = id ? getCourse(world.registry, id) : null;
    if (known) return known;
    // Kurs, którego gra jeszcze nie dostała w bańce — rzadkie, więc wolno liniowo.
    return world.registry.active.find(course => courseNumber(course.id) === num) || null;
  }

  function attach(message) {
    const course = resolveCourse(message.course);
    if (course) attachActor(course, `game:${courseNumber(course.id)}`);
  }

  function detach(message) {
    const course = resolveCourse(message.course);
    if (!course) return;
    const value = Number(message.progress);
    detachActor(course, Number.isFinite(value) ? { stageProgress: value } : null);
  }

  function progress(message) {
    const course = resolveCourse(message.course);
    if (course) syncActorStageProgress(course, message.progress);
  }

  function stageDone(message) {
    const world = core.world;
    const course = resolveCourse(message.course);
    if (!world || !course) return;
    const events = [];
    completeCurrentStage(world.registry, course, events);
    // Dolot i koniec postoju rozlicza ta sama transakcja co zegar analityczny:
    // stanowisko, jednostka, dostawa, fracht.
    settleCourseEvents(world.director, events);
  }

  function destroyed(message) {
    const world = core.world;
    const course = resolveCourse(message.course);
    if (!world || !course) return;
    destroyCourse(world.director, course, {
      reason: message.reason || 'destroyed',
      byPirates: message.byPirates,
      x: Number(message.x),
      y: Number(message.y)
    });
  }

  function station(message) {
    const world = core.world;
    if (!world) return;
    if (message.destroyed) {
      destroyWorldStation(world, String(message.stationId || ''));
      core.stationFactionsDirty = true;
    }
  }

  function config(message) {
    const director = core.world?.director;
    if (!director) return;
    if (Number.isFinite(message.piracyPressure)) director.config.piracyPressure = message.piracyPressure;
    if (typeof message.piracyEnabled === 'boolean') director.config.piracyEnabled = message.piracyEnabled;
    if (typeof message.protectObserved === 'boolean') director.config.protectObserved = message.protectObserved;
  }

  function snapshot(message) {
    const world = core.world;
    send({
      type: TRAFFIC_MSG.SNAPSHOT_RESULT,
      requestId: message.requestId ?? null,
      snapshot: world ? {
        time: trafficWorldTime(world),
        steps: world.steps,
        director: directorSnapshot(world.director),
        shipyards: summarizeShipyards(world.shipyards),
        war: summarizeWar(world.war),
        piracy: summarizePiracy(world.piracy),
        scrappers: summarizeScrappers(world.scrappers),
        agents: summarizeAgents(world.agents),
        log: world.director.log.slice(-30),
        core: { ...core.stats, hulls: core.hulls.length, trackedCourses: core.courseIds.size }
      } : null
    });
  }

  // ============================================================
  // Wiadomości do gry
  // ============================================================

  function publishTick(steps, ms) {
    const world = core.world;
    const market = buildMarket();
    const bubble = buildBubble();
    const director = world.director;
    const message = {
      type: TRAFFIC_MSG.TICK,
      clock: world.registry.clock,
      time: trafficWorldTime(world),
      steps,
      stepMs: ms,
      stockSeq: core.stockSeq,
      stats: {
        active: world.registry.active.length,
        queued: core.stats.queued,
        berthed: core.stats.berthed,
        bubble: bubble.count,
        hauls: director.stats.hauls,
        mining: director.stats.mining,
        delivered: director.stats.delivered,
        lost: director.stats.lost,
        stranded: director.stats.stranded,
        stepMs: core.stats.stepMs,
        maxStepMs: core.stats.maxStepMs,
        totalSteps: core.stats.steps
      },
      market,
      bubble,
      wrecks: collectWrecks(),
      warWrecks: collectWarWrecks()
    };
    if (core.stationFactionsDirty) {
      core.stationFactionsDirty = false;
      message.stationFactions = world.stations.map(entry => entry.factionId || null);
    }
    send(message, [market.buffer, bubble.data.buffer]);
  }

  /**
   * Rynek: stacje × surowce × [zapas, pojemność, głód, bid, ask]. Nowy bufor
   * na każdy krok, bo odchodzi do gry jako transferable (w workerze po
   * wysłaniu jest odłączony) — 35 KB co pięć sekund gry.
   */
  function buildMarket() {
    const world = core.world;
    const resourceCount = RESOURCE_KEYS.length;
    const data = new Float64Array(world.stations.length * resourceCount * MARKET_STRIDE);
    world.stations.forEach((entry, stationIndex) => {
      const econ = world.getEconomy(entry.id);
      if (!econ) return;
      for (let r = 0; r < resourceCount; r++) {
        const key = RESOURCE_KEYS[r];
        const offset = (stationIndex * resourceCount + r) * MARKET_STRIDE;
        data[offset + MARKET_FIELD.STOCK] = finite(econ.resources?.[key]);
        data[offset + MARKET_FIELD.CAPACITY] = finite(econ.capacity?.[key]);
        data[offset + MARKET_FIELD.DURESS] = getDuress(econ, key);
        const price = resourcePrice(entry, econ, key);
        data[offset + MARKET_FIELD.BID] = finite(price?.bid);
        data[offset + MARKET_FIELD.ASK] = finite(price?.ask);
      }
    });
    return data;
  }

  /**
   * Kursy w bańce gracza: bieżący odcinek ruchu każdego kursu, który w ciągu
   * najbliższego kroku znajdzie się w promieniu fokusu. Liczymy odcinek, a nie
   * punkt, bo warp przelatuje przez bańkę szybciej niż w jeden krok — kurs
   * widziany tylko punktowo pojawiałby się i znikał między krokami.
   */
  function buildBubble() {
    const world = core.world;
    const { registry, network, director } = world;
    const f = core.focus;
    const time = trafficWorldTime(world);
    const clock = registry.clock;
    const horizon = world.config.step;
    const r2 = f.r * f.r;
    const seg = core.segment;
    const hullsBefore = core.hulls.length;
    let buffer = core.scratch;
    let count = 0;
    let queued = 0;
    let berthed = 0;

    for (const course of registry.active) {
      if (course.status !== COURSE_STATUS.ACTIVE) continue;
      if (course.blocked) queued++;
      else if (course.berthId) berthed++;
      const attached = !!course.actorId;
      if (!attached && !f.active) continue;
      if (!segmentOf(network, course, clock, seg)) continue;
      if (!attached && !segmentNear(seg, time, time + horizon, f.x, f.y, r2)) continue;

      if ((count + 1) * COURSE_STRIDE > buffer.length) {
        const bigger = new Float64Array(buffer.length * 2);
        bigger.set(buffer);
        buffer = core.scratch = bigger;
      }
      writeCourse(buffer, count * COURSE_STRIDE, course, seg, director);
      count++;
    }

    core.stats.bubble = count;
    core.stats.queued = queued;
    core.stats.berthed = berthed;
    core.published.x = f.x;
    core.published.y = f.y;
    core.published.r = f.r;
    pruneCourseIds(registry);

    const bubble = { clock, time, count, data: buffer.slice(0, count * COURSE_STRIDE) };
    if (core.hulls.length !== core.hullsSent || hullsBefore !== core.hulls.length) {
      bubble.hulls = [...core.hulls];
      core.hullsSent = core.hulls.length;
    }
    return bubble;
  }

  function writeCourse(buffer, offset, course, seg, director) {
    let num = courseNumber(course.id);
    if (!Number.isFinite(num)) num = -1;
    else core.courseIds.set(num, course.id);

    let flags = 0;
    if (seg.dur > 0 && (seg.x0 !== seg.x1 || seg.y0 !== seg.y1)) flags |= COURSE_FLAG.MOVING;
    if (course.blocked) flags |= COURSE_FLAG.BLOCKED;
    else if (course.berthId) flags |= COURSE_FLAG.BERTHED;
    if (seg.dwell) flags |= COURSE_FLAG.DWELL;
    if (seg.mode === 'warp') flags |= COURSE_FLAG.WARP;
    else if (seg.mode === 'gate') flags |= COURSE_FLAG.GATE;
    if (convoyOf(director.convoys, course.id)) flags |= COURSE_FLAG.CONVOY;
    if (course.payload?.agentId) flags |= COURSE_FLAG.AGENT;
    if (course.payload?.deadhead) flags |= COURSE_FLAG.DEADHEAD;
    if (course.actorId) flags |= COURSE_FLAG.ATTACHED;
    flags |= (core.kindIndex.get(course.kind) ?? 0) << COURSE_KIND_SHIFT;

    buffer[offset + COURSE_FIELD.ID] = num;
    buffer[offset + COURSE_FIELD.X0] = seg.x0;
    buffer[offset + COURSE_FIELD.Y0] = seg.y0;
    buffer[offset + COURSE_FIELD.X1] = seg.x1;
    buffer[offset + COURSE_FIELD.Y1] = seg.y1;
    buffer[offset + COURSE_FIELD.T0] = seg.t0;
    buffer[offset + COURSE_FIELD.DUR] = seg.dur;
    buffer[offset + COURSE_FIELD.FLAGS] = flags;
    buffer[offset + COURSE_FIELD.HULL] = hullIndexOf(course.unitClass);
    buffer[offset + COURSE_FIELD.FACTION] = core.factionIndex.get(course.factionId) ?? -1;
    buffer[offset + COURSE_FIELD.PORT] = course.portStationId
      ? (core.stationIndex.get(course.portStationId) ?? -1) : -1;
    buffer[offset + COURSE_FIELD.BERTH] = course.berthRef
      ? (core.berthIndex.get(course.berthRef) ?? -1) : -1;
  }

  function hullIndexOf(unitClass) {
    const key = String(unitClass || '');
    let index = core.hullIndex.get(key);
    if (index === undefined) {
      index = core.hulls.length;
      core.hulls.push(key);
      core.hullIndex.set(key, index);
    }
    return index;
  }

  /** Numery kursów, które już nie latają, wypadają z mapy — rośnie tylko do liczby aktywnych. */
  function pruneCourseIds(registry) {
    for (const [num, id] of core.courseIds) {
      const course = getCourse(registry, id);
      if (!course || course.status !== COURSE_STATUS.ACTIVE) core.courseIds.delete(num);
    }
  }

  /** Nowe wraki dyspozytora (przechwyty, zestrzelenia) — z pozycją i tym, co leciało. */
  function collectWrecks() {
    const world = core.world;
    const list = world.director.wrecks;
    const out = [];
    for (let i = core.wreckCursor; i < list.length; i++) {
      const wreck = list[i];
      const course = getCourse(world.registry, wreck.courseId);
      out.push({
        course: courseNumber(wreck.courseId),
        courseId: wreck.courseId,
        x: wreck.x,
        y: wreck.y,
        kind: wreck.kind,
        reason: wreck.reason || 'pirate',
        hull: course?.unitClass || null,
        factionId: course?.factionId || null,
        value: finite(course?.payload?.value),
        resourceId: course?.payload?.resourceId || null,
        units: finite(course?.payload?.units),
        orderId: wreck.orderId || null,
        clock: wreck.clock
      });
    }
    // Dyspozytor dopisuje wraki bez końca (to tylko rejestr do panelu) — po
    // wysłaniu do gry trzymamy ogon, żeby świat grany godzinami nie puchł.
    if (list.length > WRECK_LOG_LIMIT) list.splice(0, list.length - WRECK_LOG_LIMIT);
    core.wreckCursor = list.length;
    return out;
  }

  /** Nowe wraki okrętów z bitew — tych, po które latają złomiarze. */
  function collectWarWrecks() {
    const out = [];
    let newest = core.warWreckSeq;
    for (const wreck of core.world.war.wrecks) {
      const seq = courseNumber(wreck.id);
      if (!(seq > core.warWreckSeq)) continue;
      newest = Math.max(newest, seq);
      out.push({
        id: wreck.id, classId: wreck.classId, factionId: wreck.factionId || null,
        scrap: finite(wreck.scrap), value: finite(wreck.value), x: wreck.x, y: wreck.y
      });
    }
    core.warWreckSeq = newest;
    return out;
  }

  return {
    handle,
    /** Świat — dla testów i trybu awaryjnego; gra rozmawia przez `handle`. */
    get world() { return core.world; },
    get stats() { return { ...core.stats }; }
  };
}

// ============================================================
// Geometria odcinka
// ============================================================

/**
 * Bieżący odcinek ruchu kursu w czasie świata — te same reguły co
 * `courseWorldPosition`, tylko jako odcinek z czasem startu zamiast punktu.
 * Bez alokacji: pisze do `seg`.
 */
export function segmentOf(network, course, clock, seg) {
  const stage = course?.stages?.[course.stageIndex];
  if (!stage) return false;
  const elapsed = Math.max(0, Number(course.stageElapsed) || 0);

  if (stage.kind === STAGE_KIND.DWELL) {
    const at = stage.pos || stage.entryPos || getNode(network, stage.nodeId);
    if (!at) return false;
    const move = Number(stage.moveSeconds) || 0;
    const from = stage.fromPos;
    seg.dwell = true;
    seg.mode = null;
    if (move > 0 && from && elapsed < move) {
      seg.x0 = from.x; seg.y0 = from.y;
      seg.x1 = at.x; seg.y1 = at.y;
      seg.t0 = clock - elapsed;
      seg.dur = move;
    } else {
      seg.x0 = seg.x1 = at.x;
      seg.y0 = seg.y1 = at.y;
      seg.t0 = clock;
      seg.dur = 0;
    }
    return true;
  }

  const from = stage.fromPos || getNode(network, stage.fromId);
  const to = stage.toPos || getNode(network, stage.toId);
  if (!from || !to) return false;
  seg.dwell = false;
  seg.mode = stage.mode || null;
  seg.x0 = from.x; seg.y0 = from.y;
  seg.x1 = to.x; seg.y1 = to.y;
  seg.t0 = clock - elapsed;
  seg.dur = Math.max(0, Number(stage.seconds) || 0);
  return true;
}

/** Położenie na odcinku w chwili `time`. */
export function segmentPoint(seg, time, out) {
  const t = seg.dur > 0 ? Math.min(1, Math.max(0, (time - seg.t0) / seg.dur)) : 1;
  out.x = seg.x0 + (seg.x1 - seg.x0) * t;
  out.y = seg.y0 + (seg.y1 - seg.y0) * t;
  return out;
}

const pointA = { x: 0, y: 0 };
const pointB = { x: 0, y: 0 };

/** Czy kawałek odcinka przebyty w oknie [from, to] zbliża się do (fx, fy) na √r2. */
function segmentNear(seg, from, to, fx, fy, r2) {
  segmentPoint(seg, from, pointA);
  segmentPoint(seg, to, pointB);
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.min(1, Math.max(0, ((fx - pointA.x) * dx + (fy - pointA.y) * dy) / len2));
  const px = pointA.x + dx * t - fx;
  const py = pointA.y + dy * t - fy;
  return px * px + py * py <= r2;
}
