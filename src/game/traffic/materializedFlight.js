/**
 * BAŃKA MATERIALIZACJI — warstwa 3.
 *
 * Rekord kursu wie tylko, skąd dokąd i w ile. To wystarcza gospodarce, ale nie
 * wystarcza oku: prosta między punktami z jednostajną prędkością wygląda jak
 * przesuwanie znaczników po mapie, a nie jak lot.
 *
 * Ten moduł zamienia rekordy w promieniu obserwatora w LEKKIE STATKI (proxy,
 * poza `npcs[]`): z bezwładnością, ograniczonym skrętem, rozbiegiem i hamowaniem.
 * Poza promieniem wracają do rekordu z zachowanym postępem, więc koszt zależy
 * od promienia, a nie od liczby statków w układzie.
 *
 * Kto ma rację przy rozbieżności: **encja**. Prawdziwy lot z rozpędzaniem nigdy
 * nie trafia w sekundę co do sekundy rozkładu, więc gdy statek dolatuje, etap
 * domyka się na jego warunkach (`completeCurrentStage`), a nie zegara.
 *
 * Statek leci po ŚCIEŻCE (bufor punktów, `portPaths.js`), nie do punktu:
 *   - przy ringu „Halo” trasę układa `ringRouter.js` — płyta ringu tylko przez
 *     tranzyty, dookoła planety łukiem za halami, w strefie portu promieniowo;
 *   - w porcie: punkt czekania → brama / wylot → pas albo aleja → skręt → pole
 *     STOP; przechwyt w oknie stanowiska (jak `PortDocking`: capital 145 × 180,
 *     reszta 70 × 55, ≤ 30 j./s, ≤ 7°) i 1,1 s dociągnięcia pozy;
 *   - wyjście: odłączenie obsługi (sekwencja K-7), tyłem ze stanowiska,
 *     korytarzem do ujścia, w bok od osi i w górę do lejka;
 *   - kolejka portu: lot na miejsce oczekiwania (pozycja z dyspozytora albo
 *     haka `holdPose`), postój dziobem od planety.
 *
 * Kurs dziobu przy stanowisku bierze się ze STANOWISKA (`course.berthId` w
 * indeksie portów, zapasowo `course.berthRef`) — rekord trzyma tylko x, y.
 *
 * Pułapki, których tu pilnujemy:
 *   - ujemne `dt` zerowane, a duże dodatnie dzielone na stabilne podkroki
 *   - przyspieszenie DUŻE wobec prędkości przelotowej, inaczej statek pełznie
 *   - separacja WYŁĄCZONA w porcie i przy stanowiskach, bo blokuje dokowanie
 *   - kolejność w korytarzu portu bez cykli (zakleszczenie = zamrożony kurs):
 *     wchodzący czeka przed ujściem na wychodzącego, wychodzący czeka tylko na
 *     wchodzących już „zobowiązanych”, w korytarzu po jednej osi; każde
 *     czekanie ma limit czasu, a zawieszony statek — strażnika postępu
 *   - zero alokacji na krok: ścieżki w buforach, siatka separacji w tablicach
 *     typowanych, lista encji gęsta
 *
 * Interfejs rekordów jest wstrzykiwalny (`createBubble({ records })`) — bańka
 * w grze z workerem ruchu (Z13) podmienia `attach/detach/sync/complete` na
 * wiadomości protokołu, a sam lot zostaje ten sam.
 */

import {
  currentStage, stageProgress, STAGE_KIND, COURSE_STATUS,
  completeCurrentStage, syncActorStageProgress, attachActor, detachActor
} from './courseRegistry.js';
import { DRIVE_MODES, getNode } from './travelNetwork.js';
import { hullFootprint } from './dockLayout.js';
import { needsService } from './portControl.js';
import {
  PATH_STRIDE, WP, createPath, pathReset, pathFinalize, pathApplyCornerSpeeds, pathAddFlags,
  pathPointAt, pathFind, createPortIndex, addPortLayout, findPortEntry, findPortEntryAt,
  portApproachPoint, writeInbound, writeOutbound, berthCaptureOk, inPortCap,
  CAPTURE_DEFAULTS, PORT_PATH_SPEED
} from './portPaths.js';
import { routeRing, ringAt, isRingCorePoint, ringFunnelPoint } from './ringRouter.js';

const TAU = Math.PI * 2;
const S = PATH_STRIDE;
// Pola punktu ścieżki (lustro portPaths.js).
const PV = 2;
const PF = 3;
const PS = 4;
const PORTISH = WP.PORT | WP.PRECISE | WP.TRANSIT;
/** Wewnętrzny znacznik ostatniego punktu wyjścia z portu (poza flagami `WP`). */
const OUT_END = 1 << 12;

// ============================================================
// Model lotu
// ============================================================

export const FLIGHT_DEFAULTS = Object.freeze({
  /**
   * Przyspieszenie jako ułamek prędkości przelotowej na sekundę.
   *
   * Rozbieg to `v²/2a`. Przy 0,6 statek o prędkości 800 rozpędza się na 530
   * jednostkach — niezauważalnie wobec milionów jednostek trasy. Zbyt małe
   * przyspieszenie było zmierzoną pułapką prototypu pasowego: statek pełzł
   * przez pół drogi, a wyglądało to na brak przepustowości doku. Duże kadłuby
   * dostają mniej (`accelScale`, nigdy więcej niż 1).
   */
  accelRatio: 0.6,
  /** Hamowanie mocniejsze od rozbiegu — statek ma zdążyć stanąć przy stanowisku. */
  brakeRatio: 0.9,
  /** Maksymalna prędkość kątowa kadłuba ~300 j. (mniejsze szybciej, większe wolniej). */
  turnRate: 0.9,
  /** Kąt (cos), powyżej którego dziób jest „na kursie” i wolno dodać pełny ciąg. */
  alignedDot: 0.35,
  /** Promień, w którym jednostki się rozpychają. Tylko w swobodnym locie. */
  separationRadius: 900,
  separationStrength: 0.55,
  /** Ile encji wolno utrzymywać naraz. Bańka ma być ograniczona, nie nieskończona. */
  maxActors: 400,
  /** Poza tym ułamkiem promienia bańki encja wraca do rekordu (histereza). */
  releaseMargin: 1.25,
  /** Wyprzedzenie punktu celowania [s] i jego granice w swobodnym locie [j.]. */
  lookAheadTime: 1.2,
  lookAheadMin: 180,
  lookAheadMax: 4000,
  /** Wyprzedzenie w porcie i tranzycie — krótkie, żeby trzymać oś alei. */
  portLookAheadMax: 320,
  /**
   * Prędkość, z jaką statek mija koniec przelotu, gdy dalej czeka go postój
   * w porcie bez przydziału — dyspozytor przydziela miejsce dopiero po
   * dolocie, więc zatrzymanie w punkcie przylotu byłoby widocznym szarpnięciem.
   */
  arrivalSpeed: 300,
  /** Po tylu sekundach tuż przy polu STOP przechwyt jest wymuszany. */
  captureTimeout: 25,
  /** Bez postępu na ścieżce tyle sekund → nowa ścieżka; drugi raz → wymuszenie. */
  stuckTimeout: 45,
  /**
   * Najdłuższe czekanie przed korytarzem portu i na wyjście z niego [s] — siatka
   * bezpieczeństwa: reguły korytarza nie mają cykli, więc limit nie powinien
   * się nigdy odpalać (capital wycofuje się z pasa K-7 ~50 s).
   */
  corridorWaitMax: 90,
  undockWaitMax: 60,
  /** Kurs odrzucony przy materializacji (ścieżka poza bańką) — przerwa [s]. */
  materializeCooldown: 2,
  /** Obrót na redzie / w kolejce względem obrotu w porcie. */
  holdTurnRatio: 0.5
});

/** Faza encji — dla renderu (dysze, suwnice) i dla logiki kroku. */
export const ACTOR_PHASE = Object.freeze({
  /** Lot po ścieżce: przelot, podejście do portu, wyjście z niego. */
  FLY: 'fly',
  /** Przechwyt: 1,1 s dociągania pozy na pole STOP (napęd zablokowany). */
  CAPTURE: 'capture',
  /** Przy stanowisku — obsługa (dźwigi K-7 wg `dockTime`). */
  DOCKED: 'docked',
  /** Odłączanie obsługi przed wyjściem (sekwencja K-7), napęd zablokowany. */
  UNDOCK: 'undock',
  /** Kolejka portu / czekanie na przydział — postój bez naliczania obsługi. */
  HOLD: 'hold',
  /** Postój w punkcie bez stanowiska (pole wydobycia, węzeł bez doków). */
  STATION: 'station'
});

const END_PASS = 0;
const END_STOP = 1;
const END_BERTH = 2;
const END_HOLD = 3;

const STEP_MOVING = 0;
const STEP_REACHED = 1;
const STEP_BERTH = 2;

const CORRIDOR_NONE = 0;
const IN_OUTSIDE = 1;
const IN_COMMITTED = 2;
const OUT_WAIT = 3;
const OUT_MOVING = 4;

const SEP_BUCKETS = 1024;

const DEFAULT_RECORDS = Object.freeze({
  attach: attachActor,
  detach: detachActor,
  sync: syncActorStageProgress,
  complete: completeCurrentStage
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function wrapPi(a) {
  let v = a;
  if (v > Math.PI || v < -Math.PI) v -= TAU * Math.round(v / TAU);
  return v;
}

/** Klasa jednostki → gabaryty z prawdziwych kadłubów gry. */
function actorSize(unitClass) {
  const size = hullFootprint(unitClass);
  return { length: Math.max(40, size.length), width: Math.max(20, size.width) };
}

/** Prędkość przelotowa etapu — warp leci swoją, reszta konwencjonalną. */
function cruiseFor(stage) {
  if (stage?.kind !== STAGE_KIND.TRAVEL) return DRIVE_MODES.conventional.speed;
  const speed = DRIVE_MODES[stage?.mode]?.speed;
  return Number.isFinite(speed) && speed > 0 ? speed : DRIVE_MODES.conventional.speed;
}

// ============================================================
// Bańka
// ============================================================

/**
 * Opcje: wszystko z `FLIGHT_DEFAULTS` oraz
 *   `rings`    — przeszkody-ringi (`createRingObstacle`, `createRingObstaclesForNetwork`),
 *   `docks`    — układy doków stacji (Map stationId → układ, jak `director.docks`)
 *                albo gotowy indeks `ports` (`createPortIndex`),
 *   `holdPose` — `(course, stage, out) → bool`: miejsce i kurs w kolejce portu
 *                (bez niego: pozycja z dyspozytora, dziób od planety),
 *   `records`  — `{ attach, detach, sync, complete }` zamiast courseRegistry.
 */
export function createBubble(options = {}) {
  const { rings = null, ports = null, docks = null, holdPose = null, records = null, ...rest } = options;
  return {
    config: { ...FLIGHT_DEFAULTS, ...rest },
    /** `courseId` → encja. */
    actors: new Map(),
    /** Te same encje w gęstej tablicy — pętle kroku bez iteratorów Map. */
    list: [],
    rings: Array.isArray(rings) ? rings : [],
    ports: ports?.entries instanceof Map ? ports : createPortIndex(docks || ports || null),
    holdPose: typeof holdPose === 'function' ? holdPose : null,
    records: { ...DEFAULT_RECORDS, ...(records || {}) },
    pathPool: [],
    /** `courseId` → czas bańki, do którego kurs się nie materializuje. */
    cooldown: new Map(),
    clock: 0,
    frame: 0,
    sep: { heads: new Int32Array(SEP_BUCKETS), next: new Int32Array(64), cx: new Int32Array(64), cy: new Int32Array(64) },
    corridors: { stamp: new Int32Array(64), inbound: new Int32Array(64), outbound: new Int32Array(64) },
    portList: [],
    stats: {
      materialized: 0, released: 0, docked: 0, captured: 0, forcedCaptures: 0,
      replans: 0, forcedStages: 0, waits: 0
    }
  };
}

/** Podmienia ringi (np. po przesunięciu planet albo zmianie układu). */
export function setBubbleRings(bubble, rings) {
  bubble.rings = Array.isArray(rings) ? rings : [];
}

/** Rejestruje układy doków stacji (Map stationId → układ) w indeksie portów bańki. */
export function setBubblePorts(bubble, docks) {
  if (!docks) return;
  const iterable = docks instanceof Map ? docks.entries() : Object.entries(docks);
  for (const [stationId, layout] of iterable) addPortLayout(bubble.ports, stationId, layout);
}

function takePath(bubble) {
  return bubble.pathPool.pop() || createPath(96);
}

function createActor(bubble, course) {
  const cfg = bubble.config;
  const size = actorSize(course.unitClass);
  const L = size.length;
  const k = clamp(Math.pow(312 / L, 0.55), 0.3, 1.45);
  return {
    courseId: course.id,
    kind: course.kind,
    unitClass: course.unitClass,
    factionId: course.factionId ?? null,
    length: L,
    width: size.width,
    /** Obrót w swobodnym locie i w porcie [rad/s] (liczby modelu K-7). */
    turnFree: cfg.turnRate * k,
    turnPort: cfg.turnRate * k * 0.66,
    accelScale: clamp(Math.pow(312 / L, 0.35), 0.35, 1),
    accelPort: clamp(135 - 0.03 * L, 45, 130),
    portCap: inPortCap(size),
    /** Dopuszczalne wyniesienie z osi tranzytu (prześwit ±570 minus pół szerokości). */
    transitTol: Math.max(25, ((bubble.rings[0]?.transitHalfWidth ?? 570) - size.width * 0.5) * 0.6),
    x: 0,
    y: 0,
    angle: 0,
    /** Prędkość wzdłuż dziobu: ujemna = cofanie (wycofanie ze stanowiska). */
    speed: 0,
    cruise: DRIVE_MODES.conventional.speed,
    mode: null,
    /** Poza z początku ostatniego `updateBubble` — interpolacja renderu. */
    prevX: 0,
    prevY: 0,
    prevAngle: 0,
    vx: 0,
    vy: 0,
    angVel: 0,
    /** −1…1: ciąg główny (+) / wsteczny (−) w tym kroku — dla dysz. */
    throttle: 0,
    stageIndex: course.stageIndex,
    docked: false,
    blocked: !!course.blocked,
    dwell: 0,
    distance: 0,
    phase: ACTOR_PHASE.FLY,
    phaseTime: 0,
    /** Czas od przechwytu (sekwencja dźwigów K-7 w renderze). */
    dockTime: 0,
    path: takePath(bubble),
    wp: 1,
    s: 0,
    bestS: 0,
    pathStart: 0,
    pathS0: 0,
    endKind: END_STOP,
    /** Stanowisko docelowe (wejście) i to, przy którym stoi / z którego wychodzi. */
    entry: null,
    dockedEntry: null,
    holdAngle: 0,
    /** Poza i prędkość w chwili przechwytu (start dociągania 1,1 s). */
    fromX: 0,
    fromY: 0,
    fromAngle: 0,
    captureSpeed: 0,
    sigBerth: null,
    sigBlocked: false,
    sigPosX: NaN,
    sigPosY: NaN,
    corridorIn: 0,
    corridorOut: 0,
    waitIndex: -1,
    cornerIndex: -1,
    outIndex: -1,
    inGateX: 0,
    inGateY: 0,
    inOutX: 0,
    inOutY: 0,
    outGateX: 0,
    outGateY: 0,
    outOutX: 0,
    outOutY: 0,
    corridorState: CORRIDOR_NONE,
    depth: 0,
    speedCap: Infinity,
    waiting: false,
    waitTime: 0,
    undockHold: false,
    stuckTime: 0,
    stuckCount: 0,
    stuckS: 0,
    nearTime: 0,
    slot: -1
  };
}

function addActor(bubble, actor) {
  actor.slot = bubble.list.length;
  bubble.list.push(actor);
  bubble.actors.set(actor.courseId, actor);
}

function removeActor(bubble, actor) {
  const list = bubble.list;
  const at = actor.slot;
  if (at >= 0 && at < list.length && list[at] === actor) {
    const last = list.pop();
    if (last !== actor) {
      list[at] = last;
      last.slot = at;
    }
  }
  actor.slot = -1;
  bubble.actors.delete(actor.courseId);
  freeBerth(actor);
  if (actor.path) {
    bubble.pathPool.push(actor.path);
    actor.path = null;
  }
}

function freeBerth(actor) {
  const entry = actor.dockedEntry;
  if (entry && entry.occupant === actor) entry.occupant = null;
}

// ============================================================
// Rekord → miejsce
// ============================================================

/**
 * Gdzie rekord jest TERAZ (prosta etapu, dojście w porcie) — do decyzji o
 * materializacji. Tanie i bez alokacji; właściwe miejsce encji liczy się już
 * po ścieżce (z objazdem ringu).
 */
function recordPosition(network, course, out) {
  const stage = currentStage(course);
  if (!stage) return false;
  if (stage.kind === STAGE_KIND.DWELL) {
    const at = stage.pos || stage.entryPos || getNode(network, stage.nodeId);
    if (!at) return false;
    const move = Number(stage.moveSeconds) || 0;
    const from = stage.fromPos;
    if (move > 0 && from) {
      const t = clamp((Number(course.stageElapsed) || 0) / move, 0, 1);
      out.x = from.x + (at.x - from.x) * t;
      out.y = from.y + (at.y - from.y) * t;
    } else {
      out.x = at.x;
      out.y = at.y;
    }
    return true;
  }
  const to = stage.toPos || getNode(network, stage.toId);
  if (!to) return false;
  const from = stage.fromPos || getNode(network, stage.fromId) || to;
  const t = stageProgress(course);
  out.x = from.x + (to.x - from.x) * t;
  out.y = from.y + (to.y - from.y) * t;
  return true;
}

const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0, angle: 0, index: 1 };
const _hold = { x: 0, y: 0, angle: 0 };
const _pose = { along: 0, across: 0, angle: 0 };
const _rec = { x: 0, y: 0 };

/** Punkt abstrakcyjny (środek planety z ringiem) → lejek w stronę `towards`. */
function resolveCore(bubble, x, y, tx, ty, out) {
  const rings = bubble.rings;
  if (rings.length && isRingCorePoint(rings, x, y)) {
    ringFunnelPoint(ringAt(rings, x, y), tx, ty, out);
    return out;
  }
  out.x = x;
  out.y = y;
  return out;
}

/** Czy postój to obsługa w porcie znanym bańce (dyspozytor przydzieli miejsce). */
function isPortDwell(bubble, stage) {
  return needsService(stage, bubble.ports.layouts);
}

// ============================================================
// Planowanie ścieżki
// ============================================================

/**
 * Początek ścieżki: encja przy stanowisku startuje z pola i dostaje wyjście
 * (tyłem, korytarzem, w bok od osi) — faza UNDOCK; reszta rusza z miejsca.
 */
function beginPath(bubble, actor) {
  const path = actor.path;
  actor.waitIndex = -1;
  actor.cornerIndex = -1;
  actor.outIndex = -1;
  actor.corridorIn = 0;
  actor.corridorOut = 0;
  actor.waiting = false;
  const e = actor.dockedEntry;
  const atBerth = e && (actor.phase === ACTOR_PHASE.DOCKED || actor.phase === ACTOR_PHASE.CAPTURE
    || actor.phase === ACTOR_PHASE.UNDOCK);
  if (atBerth) {
    if (actor.phase !== ACTOR_PHASE.UNDOCK) {
      actor.phase = ACTOR_PHASE.UNDOCK;
      actor.phaseTime = 0;
      actor.waitTime = 0;
    }
    actor.x = e.x;
    actor.y = e.y;
    actor.angle = e.angle;
    actor.speed = 0;
    actor.docked = false;
    pathReset(path, e.x, e.y);
    if (writeOutbound(e, path, actor) > 0) pathAddFlags(path, path.count - 1, OUT_END);
    actor.corridorOut = e.corridor;
    actor.outGateX = e.gateX;
    actor.outGateY = e.gateY;
    actor.outOutX = e.outX;
    actor.outOutY = e.outY;
    return;
  }
  pathReset(path, actor.x, actor.y);
}

function lastX(path) { return path.data[(path.count - 1) * S]; }
function lastY(path) { return path.data[(path.count - 1) * S + 1]; }

/** Domyka ścieżkę i przelicza indeksy punktów portu po `pathFinalize`. */
function finishPath(bubble, actor) {
  const path = actor.path;
  pathFinalize(path);
  pathApplyCornerSpeeds(path, actor.turnFree, actor.turnPort, actor.transitTol);
  actor.wp = 1;
  actor.s = 0;
  actor.bestS = 0;
  actor.pathS0 = 0;
  actor.stuckTime = 0;
  actor.stuckS = 0;
  actor.stuckCount = 0;
  actor.nearTime = 0;
  // Koniec wyjścia z portu i punkty wejścia (czekanie, skręt w stanowisko).
  actor.outIndex = actor.corridorOut ? pathFind(path, OUT_END, 1) : -1;
  if (actor.corridorIn) {
    actor.waitIndex = pathFind(path, WP.WAIT, actor.outIndex > 0 ? actor.outIndex + 1 : 1);
    const corner = pathFind(path, WP.PRECISE, actor.waitIndex > 0 ? actor.waitIndex + 1 : 1);
    actor.cornerIndex = corner > 0 ? corner : path.count - 1;
  }
}

/** Ścieżka etapu przelotu z obecnego stanu encji. */
function planTravel(bubble, network, course, stage, actor) {
  const to = stage.toPos || getNode(network, stage.toId);
  const path = actor.path;
  beginPath(bubble, actor);
  if (!to) {
    finishPath(bubble, actor);
    actor.endKind = END_STOP;
    return;
  }
  const ax = lastX(path);
  const ay = lastY(path);
  resolveCore(bubble, to.x, to.y, ax, ay, _p);
  const ex = _p.x;
  const ey = _p.y;

  // Koniec przelotu: stop albo przelot dalej — zależy od tego, co po nim.
  const next = course.stages?.[course.stageIndex + 1] || null;
  let vEnd = 0;
  let fEnd = WP.STOP;
  if (next) {
    const brake = actor.cruise * bubble.config.brakeRatio * actor.accelScale;
    if (next.kind === STAGE_KIND.TRAVEL) {
      vEnd = Math.min(actor.cruise, cruiseFor(next));
      fEnd = 0;
    } else if (next.pos) {
      const dist = Math.hypot(next.pos.x - ex, next.pos.y - ey);
      if (dist > actor.length * 3 + 600) {
        vEnd = Math.min(actor.cruise, Math.sqrt(2 * brake * dist));
        fEnd = 0;
      }
    } else if (isPortDwell(bubble, next)) {
      vEnd = Math.min(actor.cruise, bubble.config.arrivalSpeed);
      fEnd = 0;
    }
  }
  routeRing(path, bubble.rings, ax, ay, ex, ey, vEnd, fEnd);
  actor.endKind = fEnd & WP.STOP ? END_STOP : END_PASS;
  finishPath(bubble, actor);
}

/** Znacznik celu postoju — zmiana (przydział, kolejka) każe liczyć ścieżkę od nowa. */
function markSignature(actor, course, stage) {
  actor.sigBerth = course.berthId ?? course.berthRef ?? null;
  actor.sigBlocked = !!course.blocked;
  actor.sigPosX = stage.pos ? stage.pos.x : NaN;
  actor.sigPosY = stage.pos ? stage.pos.y : NaN;
}

function signatureChanged(actor, course, stage) {
  if ((course.berthId ?? course.berthRef ?? null) !== actor.sigBerth) return true;
  if (!!course.blocked !== actor.sigBlocked) return true;
  const px = stage.pos ? stage.pos.x : NaN;
  const py = stage.pos ? stage.pos.y : NaN;
  if (px !== actor.sigPosX && !(px !== px && actor.sigPosX !== actor.sigPosX)) return true;
  if (py !== actor.sigPosY && !(py !== py && actor.sigPosY !== actor.sigPosY)) return true;
  return false;
}

/** Miejsce i kurs w kolejce portu: hak `holdPose`, inaczej punkt z dyspozytora dziobem od planety. */
function holdTarget(bubble, network, course, stage, out) {
  if (bubble.holdPose && bubble.holdPose(course, stage, out)) return true;
  const at = stage.pos || stage.entryPos;
  if (!at) return false;
  out.x = at.x;
  out.y = at.y;
  const node = getNode(network, stage.nodeId);
  out.angle = node ? Math.atan2(at.y - node.y, at.x - node.x) : NaN;
  return true;
}

/**
 * Ścieżka postoju z obecnego stanu encji: na stanowisko (podejście → korytarz
 * → pole STOP), do kolejki, na miejsce postoju bez doku — albo zostań.
 */
function planDwell(bubble, network, course, stage, actor) {
  markSignature(actor, course, stage);
  actor.blocked = !!course.blocked;
  const path = actor.path;
  const entry = course.blocked ? null : findPortEntry(bubble.ports, course);
  if (entry) {
    actor.entry = entry;
    if (actor.dockedEntry === entry && (actor.phase === ACTOR_PHASE.DOCKED || actor.phase === ACTOR_PHASE.CAPTURE)) {
      return;
    }
    beginPath(bubble, actor);
    portApproachPoint(entry, actor, _p);
    routeRing(path, bubble.rings, lastX(path), lastY(path), _p.x, _p.y,
      Math.min(actor.portCap, PORT_PATH_SPEED.approach), WP.WAIT);
    // Pas: punkt czekania leży dalej niż punkt podejścia — ten zostaje w szkielecie;
    // aleja i pomost: punkt czekania TO punkt podejścia.
    writeInbound(entry, path, actor, entry.lane ? 0 : 1);
    actor.corridorIn = entry.corridor;
    actor.inGateX = entry.gateX;
    actor.inGateY = entry.gateY;
    actor.inOutX = entry.outX;
    actor.inOutY = entry.outY;
    actor.endKind = END_BERTH;
    if (actor.phase !== ACTOR_PHASE.UNDOCK) setPhase(actor, ACTOR_PHASE.FLY);
    finishPath(bubble, actor);
    return;
  }
  actor.entry = null;

  if (course.blocked) {
    if (!holdTarget(bubble, network, course, stage, _hold)) {
      stayHere(bubble, actor, ACTOR_PHASE.HOLD);
      return;
    }
    resolveCore(bubble, _hold.x, _hold.y, actor.x, actor.y, _p);
    beginPath(bubble, actor);
    routeRing(path, bubble.rings, lastX(path), lastY(path), _p.x, _p.y, 0, WP.STOP | WP.HOLD);
    actor.holdAngle = Number.isFinite(_hold.angle) ? _hold.angle : actor.angle;
    actor.endKind = END_HOLD;
    if (actor.phase !== ACTOR_PHASE.UNDOCK) setPhase(actor, ACTOR_PHASE.FLY);
    finishPath(bubble, actor);
    return;
  }

  // Postój w porcie bez przydziału: dyspozytor da miejsce za chwilę — czekaj
  // tam, gdzie jesteś, zamiast lecieć do punktu przylotu.
  if (!stage.pos && isPortDwell(bubble, stage)) {
    if (actor.phase === ACTOR_PHASE.DOCKED || actor.phase === ACTOR_PHASE.CAPTURE) return;
    stayHere(bubble, actor, ACTOR_PHASE.HOLD);
    return;
  }

  const at = stage.pos || stage.entryPos || getNode(network, stage.nodeId);
  if (!at) {
    stayHere(bubble, actor, ACTOR_PHASE.STATION);
    return;
  }
  resolveCore(bubble, at.x, at.y, actor.x, actor.y, _p);
  const tol = Math.max(actor.length * 1.5, 80);
  if (actor.phase !== ACTOR_PHASE.UNDOCK && !actor.dockedEntry
    && Math.hypot(_p.x - actor.x, _p.y - actor.y) < tol) {
    stayHere(bubble, actor, ACTOR_PHASE.STATION);
    return;
  }
  beginPath(bubble, actor);
  routeRing(path, bubble.rings, lastX(path), lastY(path), _p.x, _p.y, 0, WP.STOP);
  actor.endKind = END_STOP;
  if (actor.phase !== ACTOR_PHASE.UNDOCK) setPhase(actor, ACTOR_PHASE.FLY);
  finishPath(bubble, actor);
}

/** Postój bez ścieżki (kolejka bez miejsca, punkt bez doku, czekanie na przydział). */
function stayHere(bubble, actor, phase) {
  pathReset(actor.path, actor.x, actor.y);
  pathFinalize(actor.path);
  actor.wp = 1;
  actor.endKind = phase === ACTOR_PHASE.HOLD ? END_HOLD : END_STOP;
  actor.holdAngle = actor.angle;
  actor.corridorIn = 0;
  actor.waitIndex = -1;
  actor.cornerIndex = -1;
  if (actor.phase !== ACTOR_PHASE.UNDOCK) setPhase(actor, phase);
}

function setPhase(actor, phase) {
  if (actor.phase !== phase) {
    actor.phase = phase;
    actor.phaseTime = 0;
  }
  actor.docked = phase === ACTOR_PHASE.DOCKED || phase === ACTOR_PHASE.STATION || phase === ACTOR_PHASE.HOLD;
}

/** Ustawia encję na ułamku `t` ścieżki (materializacja w miejscu rekordu). */
function placeOnPath(bubble, actor, t) {
  const path = actor.path;
  const total = path.count > 1 ? path.data[(path.count - 1) * S + PS] : 0;
  const s = clamp(t, 0, 1) * total;
  if (path.count > 1) {
    pathPointAt(path, s, _q);
    actor.x = _q.x;
    actor.y = _q.y;
    actor.angle = wrapPi(_q.angle);
    actor.wp = _q.index;
  }
  actor.s = s;
  actor.bestS = s;
  actor.stuckS = s;
  // Encja przejmuje bieg w ruchu, a nie od zera — inaczej każdy statek
  // wchodzący w bańkę gwałtownie zwalniałby na oczach gracza. Profil
  // hamowania nie pozwala przy tym przekroczyć tego, z czego da się stanąć.
  const flags = path.count > 1 ? path.data[actor.wp * S + PF] : 0;
  const v = speedProfile(bubble, actor, actor.wp, s, path.count - 1, (flags & PORTISH) !== 0);
  actor.speed = (flags & WP.REVERSE) ? -v : v;
}

// ============================================================
// Materializacja i zwolnienie
// ============================================================

/**
 * Tworzy encję dla kursu tam, gdzie rekord faktycznie doleciał — ale na
 * ŚCIEŻCE, nie na prostej rekordu: prosta z punktu przylotu do stanowiska po
 * drugiej stronie planety biegnie przez ring i planetę, ścieżka je okrąża.
 */
function materialize(bubble, network, course, focus, inner) {
  if (course.actorId) return null;
  const stage = currentStage(course);
  if (!stage) return null;
  const actor = createActor(bubble, course);
  actor.cruise = cruiseFor(stage);
  actor.mode = stage.mode || null;
  const ok = stage.kind === STAGE_KIND.TRAVEL
    ? placeTravel(bubble, network, course, stage, actor)
    : placeDwell(bubble, network, course, stage, actor);
  const dx = actor.x - focus.x;
  const dy = actor.y - focus.y;
  if (!ok || dx * dx + dy * dy > inner * inner) {
    bubble.pathPool.push(actor.path);
    bubble.cooldown.set(course.id, bubble.clock + bubble.config.materializeCooldown);
    return null;
  }
  if (!bubble.records.attach(course, `bubble:${course.id}`)) {
    bubble.pathPool.push(actor.path);
    return null;
  }
  if (actor.dockedEntry && !actor.dockedEntry.occupant) actor.dockedEntry.occupant = actor;
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.prevAngle = actor.angle;
  addActor(bubble, actor);
  bubble.stats.materialized++;
  return actor;
}

function placeTravel(bubble, network, course, stage, actor) {
  const to = stage.toPos || getNode(network, stage.toId);
  if (!to) return false;
  const from = stage.fromPos || getNode(network, stage.fromId);
  const prev = course.stages?.[course.stageIndex - 1] || null;
  // Etap zaczyna się NA stanowisku: przydział jeszcze trwa (`berthId`) albo
  // `fromPos` wskazuje pole stanowiska.
  let entry = null;
  if (prev && prev.kind === STAGE_KIND.DWELL) entry = findPortEntry(bubble.ports, course);
  if (!entry && from && stage.fromPos) {
    entry = findPortEntryAt(bubble.ports, prev?.nodeId ?? stage.fromId, from.x, from.y, 5)
      || findPortEntryAt(bubble.ports, stage.fromId, from.x, from.y, 5);
  }
  if (entry) {
    actor.dockedEntry = entry;
    actor.phase = ACTOR_PHASE.UNDOCK;
    actor.phaseTime = 0;
    actor.x = entry.x;
    actor.y = entry.y;
    actor.angle = entry.angle;
  } else {
    const sx = from ? from.x : to.x;
    const sy = from ? from.y : to.y;
    resolveCore(bubble, sx, sy, to.x, to.y, _p);
    actor.x = _p.x;
    actor.y = _p.y;
    actor.angle = Math.atan2(to.y - sy, to.x - sx);
    actor.phase = ACTOR_PHASE.FLY;
  }
  planTravel(bubble, network, course, stage, actor);
  const t = stageProgress(course);
  if (t > 0 || actor.phase !== ACTOR_PHASE.UNDOCK) {
    if (actor.phase === ACTOR_PHASE.UNDOCK) {
      // Rekord już ruszył — encja nie odłącza się drugi raz.
      actor.phase = ACTOR_PHASE.FLY;
      if (entry && entry.occupant === null) entry.occupant = actor;
    }
    placeOnPath(bubble, actor, t);
  }
  actor.docked = false;
  return true;
}

function placeDwell(bubble, network, course, stage, actor) {
  const entry = course.blocked ? null : findPortEntry(bubble.ports, course);
  const move = Number(stage.moveSeconds) || 0;
  const elapsed = Number(course.stageElapsed) || 0;
  const moving = !!stage.fromPos && move > 0 && elapsed < move;
  actor.dwell = Math.max(0, elapsed);
  if (entry && !moving) {
    markSignature(actor, course, stage);
    actor.entry = entry;
    actor.dockedEntry = entry;
    actor.x = entry.x;
    actor.y = entry.y;
    actor.angle = entry.angle;
    actor.speed = 0;
    actor.dockTime = elapsed;
    pathReset(actor.path, entry.x, entry.y);
    pathFinalize(actor.path);
    setPhase(actor, ACTOR_PHASE.DOCKED);
    return true;
  }
  if (moving) {
    const from = resolveCore(bubble, stage.fromPos.x, stage.fromPos.y,
      (stage.pos || stage.fromPos).x, (stage.pos || stage.fromPos).y, _rec);
    actor.x = from.x;
    actor.y = from.y;
    actor.phase = ACTOR_PHASE.FLY;
    planDwell(bubble, network, course, stage, actor);
    if (actor.path.count > 1) placeOnPath(bubble, actor, elapsed / move);
    return true;
  }
  const at = course.blocked
    ? (holdTarget(bubble, network, course, stage, _hold) ? _hold : null)
    : (stage.pos || stage.entryPos || getNode(network, stage.nodeId));
  if (!at) return false;
  resolveCore(bubble, at.x, at.y, at.x + 1, at.y, _p);
  actor.x = _p.x;
  actor.y = _p.y;
  if (course.blocked && Number.isFinite(_hold.angle)) actor.angle = _hold.angle;
  markSignature(actor, course, stage);
  stayHere(bubble, actor, course.blocked || (!stage.pos && isPortDwell(bubble, stage))
    ? ACTOR_PHASE.HOLD : ACTOR_PHASE.STATION);
  return true;
}

function travelFraction(actor) {
  const path = actor.path;
  if (!path || path.count < 2) return 1;
  const total = path.data[(path.count - 1) * S + PS];
  const span = total - actor.pathS0;
  const f = span > 1e-9 ? (actor.bestS - actor.pathS0) / span : 1;
  return actor.pathStart + (1 - actor.pathStart) * clamp(f, 0, 1);
}

function release(bubble, network, course, actor) {
  if (course) {
    const stage = currentStage(course);
    let fraction = stageProgress(course);
    if (stage?.kind === STAGE_KIND.TRAVEL && actor.stageIndex === course.stageIndex) {
      fraction = actor.phase === ACTOR_PHASE.UNDOCK ? Math.min(fraction, travelFraction(actor)) : travelFraction(actor);
    }
    bubble.records.detach(course, { stageProgress: fraction, x: actor.x, y: actor.y, angle: actor.angle });
  }
  removeActor(bubble, actor);
  bubble.stats.released++;
}

// ============================================================
// Sterowanie
// ============================================================

/**
 * Sufit prędkości z profilu hamowania: przed każdym punktem ścieżki statek
 * musi zdążyć zejść do jego `vmax` (koniec ze stopem → 0, pole STOP → `berth`).
 *
 * Profil jest DYSKRETNY: przy kroku dt i hamowaniu b statek jadący dokładnie
 * po nim staje w punkcie co do jednostki — ciągłe √(2·b·d) przestrzeliwało
 * stop o ~b·dt² na krok. Bez dt (materializacja) profil jest ciągły.
 */
function speedProfile(bubble, actor, i, s, stopIdx, precise, dt = 0) {
  const path = actor.path;
  const d = path.data;
  const n = path.count;
  const cfg = bubble.config;
  const brakeFree = actor.cruise * cfg.brakeRatio * actor.accelScale;
  const bPort = actor.accelPort;
  let vmax = precise ? Math.min(actor.cruise, actor.portCap) : actor.cruise;
  if (n < 2) return 0;
  for (let j = i; j < n; j++) {
    const oj = j * S;
    const dist = d[oj + PS] - s;
    const fj = d[oj + PF];
    let vj = d[oj + PV];
    if (j === stopIdx) {
      if (actor.waiting && j === actor.waitIndex) vj = 0;
      else if (j === n - 1) vj = (fj & WP.BERTH) ? vj : (fj & (WP.STOP | WP.HOLD)) ? 0 : vj;
    }
    // Punkty portu (i punkt czekania przed nim) hamuje się łagodnie — statek
    // zwalnia wcześnie, jak przy wejściu do portu, a nie tuż przed bramą.
    const bj = (fj & (PORTISH | WP.WAIT)) ? bPort : brakeFree;
    if (vj < vmax) {
      const h = bj * dt * 0.5;
      const lim = Math.sqrt(h * h + vj * vj + 2 * bj * (dist > 0 ? dist : 0)) - h;
      if (lim < vmax) vmax = lim;
    }
    if (j >= stopIdx) break;
    if (2 * bPort * dist > vmax * vmax) break;
  }
  return vmax;
}

/**
 * Krok lotu po ścieżce: śledzenie odcinka z wyprzedzeniem (pure pursuit),
 * ograniczony obrót, profil hamowania, cofanie na odcinkach REVERSE.
 */
function followPath(bubble, actor, dt) {
  const cfg = bubble.config;
  const path = actor.path;
  const d = path.data;
  const n = path.count;
  if (n < 2) {
    settle(actor, dt, actor.accelPort, actor.angle, 0);
    actor.distance = 0;
    return STEP_REACHED;
  }
  const stopIdx = actor.waiting && actor.waitIndex > 0 && actor.waitIndex < n ? actor.waitIndex : n - 1;
  let i = actor.wp < 1 ? 1 : actor.wp;
  if (i > n - 1) i = n - 1;

  // Punkty już minięte (rzut na odcinek). Zmiana kierunku jazdy wymaga dojazdu.
  while (i < stopIdx) {
    const o = i * S;
    const p = o - S;
    const len = d[o + PS] - d[p + PS];
    const ux = (d[o] - d[p]) / len;
    const uy = (d[o + 1] - d[p + 1]) / len;
    const rem = len - ((actor.x - d[p]) * ux + (actor.y - d[p + 1]) * uy);
    const flip = ((d[o + PF] ^ d[o + S + PF]) & WP.REVERSE) !== 0;
    // Wejście w odcinek precyzyjny zalicza się dopiero W punkcie — inaczej
    // statek gubi sufit prędkości narożnika i wpada w tranzyt bokiem.
    const entry = (d[o + PF] & PORTISH) === 0 && (d[o + S + PF] & PORTISH) !== 0;
    const pass = flip ? 4 : entry ? 6 : Math.max(8, Math.min(len * 0.45, Math.abs(actor.speed) * 0.35 + 6));
    if (rem <= pass) i++;
    else break;
  }
  actor.wp = i;

  const o = i * S;
  const p = o - S;
  const x0 = d[p];
  const y0 = d[p + 1];
  const len = d[o + PS] - d[p + PS];
  const ux = (d[o] - x0) / len;
  const uy = (d[o + 1] - y0) / len;
  const along = (actor.x - x0) * ux + (actor.y - y0) * uy;
  const flags = d[o + PF];
  const reverse = (flags & WP.REVERSE) !== 0;
  const precise = (flags & PORTISH) !== 0;
  const alongC = along < 0 ? 0 : along > len ? len : along;
  const s = d[p + PS] + alongC;
  actor.s = s;
  if (s > actor.bestS) actor.bestS = s;
  actor.distance = d[(n - 1) * S + PS] - s;

  // Punkt celowania: `look` dalej po ścieżce. Nie przechodzi przez zmianę
  // kierunku jazdy ani przez punkt stopu — tam ciągnie się prosta odcinka,
  // żeby dziób wyrównał się do osi, a nie celował w punkt tuż obok.
  const vAbs = Math.abs(actor.speed);
  const look = precise
    ? clamp(vAbs, Math.max(24, actor.length * 0.12), cfg.portLookAheadMax)
    : clamp(vAbs * cfg.lookAheadTime, Math.max(cfg.lookAheadMin, actor.length * 0.6), cfg.lookAheadMax);
  let tx;
  let ty;
  {
    let j = i;
    let a0 = alongC;
    let left = look;
    for (;;) {
      const oj = j * S;
      const pj = oj - S;
      const lj = d[oj + PS] - d[pj + PS];
      // Twardy punkt: stop, zmiana kierunku jazdy albo wejście z lotu swobodnego
      // w odcinek precyzyjny (tranzyt, port) — celowanie nie ścina tam rogu.
      const hard = j >= stopIdx || (j < n - 1 && (((d[oj + PF] ^ d[oj + S + PF]) & WP.REVERSE) !== 0
        || (!precise && (d[oj + S + PF] & PORTISH) !== 0)));
      if (left <= lj - a0 || hard) {
        // Przy punkcie twardym cel może wyjść za odcinek — na przedłużeniu osi.
        const k = (a0 + left) / lj;
        tx = d[pj] + (d[oj] - d[pj]) * k;
        ty = d[pj + 1] + (d[oj + 1] - d[pj + 1]) * k;
        break;
      }
      left -= lj - a0;
      j++;
      a0 = 0;
    }
  }

  // Kurs.
  const dxT = tx - actor.x;
  const dyT = ty - actor.y;
  let desired = dxT * dxT + dyT * dyT > 1 ? Math.atan2(dyT, dxT) : Math.atan2(uy, ux);
  if (reverse) desired += Math.PI;
  let over = 0;
  if (i === stopIdx && along > len) {
    over = along - len;
    desired = Math.atan2(uy, ux) + (reverse ? Math.PI : 0);
  }
  const omega = precise ? actor.turnPort : actor.turnFree;
  const err = wrapPi(desired - actor.angle);
  const maxTurn = omega * dt;
  const turn = err > maxTurn ? maxTurn : err < -maxTurn ? -maxTurn : err;
  actor.angle = wrapPi(actor.angle + turn);
  actor.angVel = dt > 0 ? turn / dt : 0;

  // Prędkość: profil hamowania, sufit korytarza, wyrównanie dziobu.
  let vmax = speedProfile(bubble, actor, i, s, stopIdx, precise, dt);
  if (actor.speedCap < vmax) vmax = actor.speedCap;
  // Bez przeskoczenia punktu stopu / zmiany kierunku w jednym kroku.
  const hardHere = i === stopIdx || (i < n - 1 && ((flags ^ d[o + S + PF]) & WP.REVERSE) !== 0);
  if (hardHere && dt > 0) {
    const endV = i === stopIdx && i === n - 1 && (flags & WP.BERTH) ? d[o + PV] : 0;
    const remNow = len - along;
    const lim = Math.max(endV, (remNow > 0 ? remNow : 0) / dt + (i === stopIdx ? 0 : 2));
    if (lim < vmax) vmax = lim;
  }
  const a = Math.abs(wrapPi(desired - actor.angle));
  let align = 1;
  if (precise) {
    // W porcie i tranzycie długi kadłub najpierw się obraca, potem jedzie:
    // przy 20° odchyłki dziób 2,7-tys. megafrachtowca zamiata ~470 j. w bok.
    if (a > 0.6) align = 0.08;
    else if (a > 0.1) align = 1 - (a - 0.1) / 0.5 * 0.92;
  } else {
    const alignedAt = Math.acos(clamp(cfg.alignedDot, -1, 1));
    if (a > 2.0) align = 0;
    else if (a > alignedAt) align = 0.15;
    else if (a > 0.35) align = 1 - (a - 0.35) / Math.max(1e-6, alignedAt - 0.35) * 0.85;
  }
  let desiredSpeed = vmax * align;
  if (reverse) desiredSpeed = -desiredSpeed;
  if (over > 0) {
    const back = Math.min(40, Math.sqrt(2 * actor.accelPort * over), over / Math.max(dt, 1e-6));
    desiredSpeed = reverse ? back : -back;
  }

  const accel = precise ? actor.accelPort : actor.cruise * cfg.accelRatio * actor.accelScale;
  const brake = precise ? actor.accelPort : actor.cruise * cfg.brakeRatio * actor.accelScale;
  const v0 = actor.speed;
  const speedingUp = v0 >= 0 ? desiredSpeed > v0 && desiredSpeed > 0 : desiredSpeed < v0 && desiredSpeed < 0;
  const lim = (speedingUp ? accel : brake) * dt;
  const dv = desiredSpeed - v0;
  const v = v0 + (dv > lim ? lim : dv < -lim ? -lim : dv);
  actor.throttle = accel > 0 && dt > 0 ? clamp((v - v0) / (accel * dt), -1, 1) * (v >= 0 ? 1 : -1) : 0;
  actor.speed = v;
  const c = Math.cos(actor.angle);
  const sn = Math.sin(actor.angle);
  actor.vx = c * v;
  actor.vy = sn * v;
  actor.x += actor.vx * dt;
  actor.y += actor.vy * dt;

  // Postęp po ruchu — rekord ma widzieć, gdzie statek JEST, nie gdzie był.
  // (`distance` zostaje sprzed ruchu: z niej liczony był sufit prędkości.)
  const alongNow = (actor.x - x0) * ux + (actor.y - y0) * uy;
  const sNow = d[p + PS] + (alongNow < 0 ? 0 : alongNow > len ? len : alongNow);
  actor.s = sNow;
  if (sNow > actor.bestS) actor.bestS = sNow;

  // Koniec ścieżki.
  if (i === stopIdx && stopIdx === n - 1 && !actor.waiting) {
    const rem = len - alongNow;
    if (flags & WP.BERTH) return STEP_BERTH;
    if (flags & (WP.STOP | WP.HOLD)) {
      return Math.abs(rem) <= Math.max(12, actor.length * 0.05) && Math.abs(v) <= 10 ? STEP_REACHED : STEP_MOVING;
    }
    if (rem <= Math.max(actor.length * 1.5, Math.abs(v) * dt * 2)) return STEP_REACHED;
  }
  return STEP_MOVING;
}

/** Wyhamowanie w miejscu i obrót na zadany kurs (postój, kolejka). */
function settle(actor, dt, brake, targetAngle, turnRate) {
  const v0 = actor.speed;
  const lim = brake * dt;
  const v = Math.abs(v0) <= lim ? 0 : v0 - Math.sign(v0) * lim;
  actor.speed = v;
  actor.throttle = 0;
  const c = Math.cos(actor.angle);
  const s = Math.sin(actor.angle);
  actor.vx = c * v;
  actor.vy = s * v;
  actor.x += actor.vx * dt;
  actor.y += actor.vy * dt;
  if (turnRate > 0 && Number.isFinite(targetAngle)) {
    const err = wrapPi(targetAngle - actor.angle);
    const max = turnRate * dt;
    const turn = err > max ? max : err < -max ? -max : err;
    actor.angle = wrapPi(actor.angle + turn);
    actor.angVel = dt > 0 ? turn / dt : 0;
  } else {
    actor.angVel = 0;
  }
}

// ============================================================
// Korytarze portu
// ============================================================

function ensureCorridorCapacity(bubble, id) {
  const c = bubble.corridors;
  if (id < c.stamp.length) return;
  let size = c.stamp.length;
  while (size <= id) size *= 2;
  const grow = (old) => { const next = new Int32Array(size); next.set(old); return next; };
  c.stamp = grow(c.stamp);
  c.inbound = grow(c.inbound);
  c.outbound = grow(c.outbound);
}

/**
 * Stan korytarzy portu na ten krok. Zasady (bez cykli czekania):
 *   - wchodzący przed punktem czekania staje, gdy korytarzem wychodzi inny
 *     albo jego stanowisko nadal jest zajęte przez encję bańki;
 *   - wychodzący po odłączeniu czeka tylko na wchodzących już za punktem
 *     czekania — ci nigdy nie czekają na nikogo;
 *   - w jednym kierunku korytarzem jedzie się gęsiego (kolejność po osi),
 *     przeciwne kierunki się nie hamują.
 * Każde czekanie ma limit czasu — kurs nie zamarznie nawet przy błędzie.
 */
function updateCorridors(bubble, dt) {
  const list = bubble.list;
  const cfg = bubble.config;
  const cor = bubble.corridors;
  const port = bubble.portList;
  port.length = 0;
  const F = ++bubble.frame;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    a.speedCap = Infinity;
    a.corridorState = CORRIDOR_NONE;
    // Stanowisko wolne, gdy wychodzący odjechał z pola.
    const docked = a.dockedEntry;
    if (docked && a.phase === ACTOR_PHASE.FLY) {
      const far = Math.max(docked.capture.along * 2, a.length * 0.75);
      if ((a.x - docked.x) ** 2 + (a.y - docked.y) ** 2 > far * far) {
        if (docked.occupant === a) docked.occupant = null;
        a.dockedEntry = null;
      }
    }
    let c = 0;
    if (a.phase === ACTOR_PHASE.UNDOCK && a.corridorOut) {
      a.corridorState = OUT_WAIT;
      c = a.corridorOut;
    } else if (a.phase === ACTOR_PHASE.FLY) {
      if (a.outIndex > 0 && a.wp <= a.outIndex && a.corridorOut) {
        a.corridorState = OUT_MOVING;
        c = a.corridorOut;
      } else if (a.waitIndex > 0 && a.corridorIn) {
        if (a.wp <= a.waitIndex) a.corridorState = IN_OUTSIDE;
        else if (a.wp <= a.cornerIndex) a.corridorState = IN_COMMITTED;
        if (a.corridorState) c = a.corridorIn;
      }
    }
    if (!c) continue;
    ensureCorridorCapacity(bubble, c);
    if (cor.stamp[c] !== F) {
      cor.stamp[c] = F;
      cor.inbound[c] = 0;
      cor.outbound[c] = 0;
    }
    if (a.corridorState === IN_COMMITTED) cor.inbound[c]++;
    else if (a.corridorState === OUT_MOVING) cor.outbound[c]++;
    // Głębokość w korytarzu: dodatnia za ujściem (w środku), ujemna przed nim.
    if (a.corridorState === OUT_MOVING || a.corridorState === OUT_WAIT) {
      a.depth = -((a.x - a.outGateX) * a.outOutX + (a.y - a.outGateY) * a.outOutY);
    } else {
      a.depth = -((a.x - a.inGateX) * a.inOutX + (a.y - a.inGateY) * a.inOutY);
    }
    if (a.corridorState !== OUT_WAIT) port.push(a);
  }

  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (a.corridorState === IN_OUTSIDE) {
      const c = a.corridorIn;
      const busy = (cor.stamp[c] === F && cor.outbound[c] > 0)
        || (!!a.entry && !!a.entry.occupant && a.entry.occupant !== a);
      if (busy && a.waitTime < cfg.corridorWaitMax) {
        if (!a.waiting) bubble.stats.waits++;
        a.waiting = true;
        if (Math.abs(a.speed) < 5) a.waitTime += dt;
      } else {
        a.waiting = false;
        if (!busy) a.waitTime = 0;
      }
    } else {
      a.waiting = false;
    }
    if (a.corridorState === OUT_WAIT) {
      const c = a.corridorOut;
      a.undockHold = cor.stamp[c] === F && cor.inbound[c] > 0 && a.waitTime < cfg.undockWaitMax;
    } else {
      a.undockHold = false;
    }
  }

  // Gęsiego: za encją przed sobą w tym samym korytarzu i kierunku.
  for (let i = 0; i < port.length; i++) {
    const a = port[i];
    const outbound = a.corridorState === OUT_MOVING;
    const c = outbound ? a.corridorOut : a.corridorIn;
    const ox = outbound ? a.outOutX : a.inOutX;
    const oy = outbound ? a.outOutY : a.inOutY;
    for (let j = 0; j < port.length; j++) {
      if (i === j) continue;
      const b = port[j];
      const bOut = b.corridorState === OUT_MOVING;
      if (bOut !== outbound) continue;
      if ((bOut ? b.corridorOut : b.corridorIn) !== c) continue;
      // Wchodzący: przed nim ten, kto głębiej; wychodzący: ten, kto bliżej ujścia.
      const ahead = outbound ? a.depth - b.depth : b.depth - a.depth;
      if (ahead <= 0) continue;
      const rx = b.x - a.x;
      const ry = b.y - a.y;
      const lateral = Math.abs(rx * oy - ry * ox);
      if (lateral > (a.width + b.width) * 0.5 + 120) continue;
      const gap = ahead - (a.length + b.length) * 0.5 - 80;
      const cap = gap > 0 ? gap * 0.7 + 4 : 0;
      if (cap < a.speedCap) a.speedCap = cap;
    }
  }
}

// ============================================================
// Separacja (swobodny lot)
// ============================================================

function freeFlying(actor) {
  if (actor.phase !== ACTOR_PHASE.FLY || !actor.path || actor.path.count < 2) return false;
  const flags = actor.path.data[actor.wp * S + PF];
  return (flags & (PORTISH | WP.WAIT)) === 0;
}

function sepHash(cx, cy) {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & (SEP_BUCKETS - 1);
}

/**
 * Miękkie rozpychanie w swobodnym locie.
 *
 * Świadomie NIE jest to ORCA: ta nie ma bezwładności i nie kolejkuje, więc przy
 * wąskim przejściu tworzy napierający łuk zamiast linii. Tu wystarczy delikatne
 * odsunięcie, żeby jednostki nie nakładały się w kadrze — kolejkowanie w porcie
 * załatwiają korytarze, nie unikanie.
 *
 * Siatka w tablicach typowanych (kubełki z haszu komórki), sąsiedztwo 3 × 3 —
 * bez kluczy-napisów i tablic na krok. Każda para liczona raz.
 */
function separate(bubble, dt) {
  const { separationRadius, separationStrength } = bubble.config;
  if (separationRadius <= 0) return;
  const list = bubble.list;
  const n = list.length;
  if (n < 2) return;
  const sep = bubble.sep;
  if (sep.next.length < n) {
    let size = sep.next.length;
    while (size < n) size *= 2;
    sep.next = new Int32Array(size);
    sep.cx = new Int32Array(size);
    sep.cy = new Int32Array(size);
  }
  const { heads, next, cx, cy } = sep;
  heads.fill(-1);
  const cell = separationRadius;
  let any = 0;
  for (let k = 0; k < n; k++) {
    const a = list[k];
    if (!freeFlying(a)) { next[k] = -2; continue; }
    const gx = Math.floor(a.x / cell);
    const gy = Math.floor(a.y / cell);
    cx[k] = gx;
    cy[k] = gy;
    const h = sepHash(gx, gy);
    next[k] = heads[h];
    heads[h] = k;
    any++;
  }
  if (any < 2) return;
  const r2 = separationRadius * separationRadius;
  for (let k = 0; k < n; k++) {
    if (next[k] === -2) continue;
    const a = list[k];
    const gx = cx[k];
    const gy = cy[k];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const hx = gx + ox;
        const hy = gy + oy;
        for (let j = heads[sepHash(hx, hy)]; j >= 0; j = next[j]) {
          if (j <= k || cx[j] !== hx || cy[j] !== hy) continue;
          const b = list[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq >= r2 || distanceSq < 1e-6) continue;
          const distance = Math.sqrt(distanceSq);
          const push = (separationRadius - distance) / separationRadius
            * separationStrength * Math.min(a.cruise, b.cruise) * dt;
          const nx = dx / distance;
          const ny = dy / distance;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }
}

// ============================================================
// Krok encji
// ============================================================

/** Nowy etap w rekordzie → nowa ścieżka z obecnego stanu encji. */
function enterStage(bubble, network, course, actor) {
  const stage = currentStage(course);
  actor.stageIndex = course.stageIndex;
  if (!stage) return;
  actor.cruise = cruiseFor(stage);
  actor.mode = stage.mode || null;
  actor.dwell = Math.max(0, Number(course.stageElapsed) || 0);
  actor.pathStart = 0;
  if (stage.kind === STAGE_KIND.DWELL) planDwell(bubble, network, course, stage, actor);
  else {
    planTravel(bubble, network, course, stage, actor);
    if (actor.phase !== ACTOR_PHASE.UNDOCK) setPhase(actor, ACTOR_PHASE.FLY);
  }
}

/** Domyka bieżący etap. Zwraca true, gdy kurs się skończył (encja do usunięcia). */
function finishStage(bubble, network, registry, course, actor, events) {
  if (bubble.records.complete(registry, course, events)) return true;
  enterStage(bubble, network, course, actor);
  return false;
}

/** Postój naliczany: obsługa przy stanowisku albo w punkcie bez doku. */
function accrueDwell(bubble, network, registry, course, stage, actor, dt, events) {
  if (course.blocked) return false;
  actor.dwell += dt;
  const seconds = Math.max(0, Number(stage.seconds) || 0);
  bubble.records.sync(course, seconds > 0 ? actor.dwell / seconds : 1);
  if (actor.dwell >= seconds) {
    actor.dwell = 0;
    bubble.stats.docked++;
    return finishStage(bubble, network, registry, course, actor, events);
  }
  return false;
}

function startCapture(bubble, actor, entry) {
  actor.phase = ACTOR_PHASE.CAPTURE;
  actor.phaseTime = 0;
  actor.fromX = actor.x;
  actor.fromY = actor.y;
  actor.fromAngle = actor.angle;
  actor.captureSpeed = actor.speed;
  actor.speed = 0;
  actor.vx = 0;
  actor.vy = 0;
  actor.angVel = 0;
  actor.throttle = 0;
  actor.docked = false;
  actor.dockedEntry = entry;
  actor.dockTime = 0;
  if (!entry.occupant || entry.occupant === actor) entry.occupant = actor;
  bubble.stats.captured++;
}

/**
 * Jeden krok encji. Zwraca true, gdy encję trzeba usunąć (kurs zamknięty).
 */
function stepActor(bubble, network, registry, course, actor, dt, events) {
  let stage = currentStage(course);
  if (!stage) return false;

  // Zmiana etapu w rekordzie spoza bańki (np. odblokowanie stanowiska) musi
  // przełożyć się na nowy cel encji, inaczej statek leciałby do poprzedniego punktu.
  if (actor.stageIndex !== course.stageIndex) {
    enterStage(bubble, network, course, actor);
    stage = currentStage(course);
    if (!stage) return false;
  }
  actor.blocked = !!course.blocked;
  if (stage.kind === STAGE_KIND.DWELL && signatureChanged(actor, course, stage)) {
    bubble.stats.replans++;
    actor.dwell = Math.max(0, Number(course.stageElapsed) || 0);
    planDwell(bubble, network, course, stage, actor);
  }

  switch (actor.phase) {
    case ACTOR_PHASE.CAPTURE: {
      const e = actor.dockedEntry;
      actor.phaseTime += dt;
      const T = CAPTURE_DEFAULTS.settleSeconds;
      const t = clamp(actor.phaseTime / T, 0, 1);
      const f = t * t * (3 - 2 * t);
      actor.x = actor.fromX + (e.x - actor.fromX) * f;
      actor.y = actor.fromY + (e.y - actor.fromY) * f;
      actor.angle = wrapPi(actor.fromAngle + wrapPi(e.angle - actor.fromAngle) * f);
      actor.dockTime += dt;
      if (actor.phaseTime >= T) {
        actor.x = e.x;
        actor.y = e.y;
        actor.angle = e.angle;
        setPhase(actor, ACTOR_PHASE.DOCKED);
        // Dojście z punktu przylotu było w rekordzie częścią postoju
        // (`moveSeconds`); lot encji je zastąpił, więc przy stanowisku zostaje
        // tylko obsługa — tyle, ile rekord by przy nim stał.
        if (stage.kind === STAGE_KIND.DWELL) {
          const moveCredit = Math.min(Number(stage.moveSeconds) || 0, Number(stage.seconds) || 0);
          if (moveCredit > actor.dwell) actor.dwell = moveCredit;
        }
      }
      return false;
    }
    case ACTOR_PHASE.DOCKED: {
      actor.dockTime += dt;
      actor.speed = 0;
      actor.vx = 0;
      actor.vy = 0;
      actor.throttle = 0;
      if (stage.kind !== STAGE_KIND.DWELL) {
        enterStage(bubble, network, course, actor);
        return false;
      }
      return accrueDwell(bubble, network, registry, course, stage, actor, dt, events);
    }
    case ACTOR_PHASE.STATION: {
      settle(actor, dt, actor.accelPort, actor.angle, 0);
      if (stage.kind !== STAGE_KIND.DWELL) {
        enterStage(bubble, network, course, actor);
        return false;
      }
      return accrueDwell(bubble, network, registry, course, stage, actor, dt, events);
    }
    case ACTOR_PHASE.HOLD: {
      settle(actor, dt, actor.accelPort, actor.holdAngle, actor.turnPort * bubble.config.holdTurnRatio);
      if (stage.kind !== STAGE_KIND.DWELL) enterStage(bubble, network, course, actor);
      return false;
    }
    case ACTOR_PHASE.UNDOCK: {
      actor.phaseTime += dt;
      actor.speed = 0;
      actor.vx = 0;
      actor.vy = 0;
      const e = actor.dockedEntry;
      const need = e?.sequence?.undock ?? 4.2;
      if (actor.phaseTime < need) return false;
      if (actor.undockHold) {
        actor.waitTime += dt;
        return false;
      }
      actor.waitTime = 0;
      actor.phase = ACTOR_PHASE.FLY;
      actor.phaseTime = 0;
      actor.docked = false;
      return false;
    }
    default:
      break;
  }

  // Lot po ścieżce.
  actor.phaseTime += dt;
  const result = followPath(bubble, actor, dt);

  // Strażnik postępu: liczy się droga po ścieżce, nie prędkość — statek, który
  // krąży wokół punktu, jedzie, a nie posuwa się. Czekanie przed korytarzem
  // jest postojem zamierzonym. Pierwszy alarm przeskakuje punkt, drugi wymusza.
  if (actor.bestS > actor.stuckS + 1 || actor.waiting) {
    if (actor.bestS > actor.stuckS + 1) actor.stuckS = actor.bestS;
    actor.stuckTime = 0;
  } else {
    actor.stuckTime += dt;
  }
  let forced = false;
  if (actor.stuckTime > bubble.config.stuckTimeout) {
    actor.stuckTime = 0;
    if (++actor.stuckCount >= 2 || actor.wp >= actor.path.count - 1) forced = true;
    else actor.wp++;
  }

  if (stage.kind === STAGE_KIND.TRAVEL) {
    bubble.records.sync(course, travelFraction(actor));
    if (result === STEP_REACHED) return finishStage(bubble, network, registry, course, actor, events);
    if (forced) {
      bubble.stats.forcedStages++;
      actor.stuckCount = 0;
      return finishStage(bubble, network, registry, course, actor, events);
    }
    return false;
  }

  // Postój: dolot do stanowiska / kolejki / punktu.
  if (actor.endKind === END_BERTH && actor.entry) {
    const e = actor.entry;
    if (result === STEP_BERTH || actor.wp === actor.path.count - 1) {
      if (berthCaptureOk(e, actor.x, actor.y, actor.angle, actor.speed, actor.angVel, _pose)) {
        startCapture(bubble, actor, e);
        return false;
      }
      // Tuż przy polu, wolno, a okno wciąż nie łapie — po limicie wymuszamy.
      const cap = e.capture;
      if (Math.abs(_pose.along) < cap.along * 3 && Math.abs(_pose.across) < cap.across * 3
        && Math.abs(actor.speed) < 40) {
        actor.nearTime += dt;
        if (actor.nearTime > bubble.config.captureTimeout) {
          bubble.stats.forcedCaptures++;
          startCapture(bubble, actor, e);
          return false;
        }
      }
    }
    if (forced) {
      bubble.stats.forcedCaptures++;
      actor.stuckCount = 0;
      startCapture(bubble, actor, e);
    }
    return false;
  }
  if (result === STEP_REACHED || forced) {
    actor.stuckCount = 0;
    if (forced) bubble.stats.forcedStages++;
    if (actor.endKind === END_HOLD) setPhase(actor, ACTOR_PHASE.HOLD);
    else setPhase(actor, ACTOR_PHASE.STATION);
  }
  return false;
}

// ============================================================
// Krok bańki
// ============================================================

/**
 * Jeden krok warstwy 3.
 *
 * `focus` to punkt obserwacji (w grze: statek gracza; w demie: środek kadru),
 * `radius` to promień bańki. Poza nim rekordy wracają do rachunku analitycznego.
 */
export function updateBubble(bubble, network, registry, activeCourses, focus, radius, dt) {
  // Ujemna wartość — cofnięty zegar albo zaległy callback — liczyłaby cały lot
  // wstecz. Dodatniego czasu nie wolno jednak odrzucać: przy tempie symulacji
  // `dt` regularnie przekracza 0,25 s. Całość przeintegrujemy niżej w stabilnych
  // podkrokach nie większych niż ćwierć sekundy.
  const rawDt = Number(dt);
  const elapsed = Number.isFinite(rawDt) ? Math.max(0, rawDt) : 0;
  const config = bubble.config;
  const inner = Math.max(1, radius);
  const outer = inner * config.releaseMargin;
  const events = [];
  const list = bubble.list;

  // 0. Poza z początku kroku — render interpoluje między nią a bieżącą.
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    a.prevX = a.x;
    a.prevY = a.y;
    a.prevAngle = a.angle;
  }

  // 1. Zwolnij to, co wyszło poza bańkę albo przestało być aktywne.
  for (let k = list.length - 1; k >= 0; k--) {
    const a = list[k];
    const course = activeCourses.get(a.courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE) {
      removeActor(bubble, a);
      continue;
    }
    const dx = a.x - focus.x;
    const dy = a.y - focus.y;
    if (dx * dx + dy * dy > outer * outer) release(bubble, network, course, a);
  }

  // 2. Zmaterializuj rekordy, które weszły w bańkę.
  bubble.clock += elapsed;
  if (bubble.cooldown.size > 512) {
    for (const [id, until] of bubble.cooldown) if (until <= bubble.clock) bubble.cooldown.delete(id);
  }
  if (list.length < config.maxActors) {
    for (const course of activeCourses.values()) {
      if (list.length >= config.maxActors) break;
      if (course.actorId || bubble.actors.has(course.id)) continue;
      if (course.status !== COURSE_STATUS.ACTIVE) continue;
      if (!recordPosition(network, course, _rec)) continue;
      const dx = _rec.x - focus.x;
      const dy = _rec.y - focus.y;
      if (dx * dx + dy * dy > inner * inner) continue;
      const until = bubble.cooldown.get(course.id);
      if (until !== undefined && until > bubble.clock) continue;
      materialize(bubble, network, course, focus, inner);
    }
  }

  if (elapsed <= 0) return events;

  // 3. Prowadź encje. Duży krok dzielimy zamiast obcinać: fizyka zachowuje
  // stabilność kroku 0,25 s, ale postój i lot zużywają całe przekazane `dt`.
  let remaining = elapsed;
  while (remaining > 0) {
    const step = Math.min(0.25, remaining);
    remaining -= step;
    updateCorridors(bubble, step);
    for (let k = list.length - 1; k >= 0; k--) {
      const a = list[k];
      const course = activeCourses.get(a.courseId);
      if (!course || course.status !== COURSE_STATUS.ACTIVE) {
        removeActor(bubble, a);
        continue;
      }
      if (stepActor(bubble, network, registry, course, a, step, events)) removeActor(bubble, a);
    }
    separate(bubble, step);
  }
  return events;
}

/**
 * Zwalnia CAŁĄ bańkę, oddając postęp rekordom.
 *
 * Musi istnieć jako osobna operacja, bo samo wyczyszczenie mapy encji zostawia
 * kursom przypięte `actorId` — a kurs z przypiętą encją nie liczy się analitycznie
 * i zostałby zamrożony na zawsze. Wywoływane przy oddaleniu widoku i przy
 * przebudowie świata.
 */
export function clearBubble(bubble, network, activeCourses) {
  if (!bubble) return 0;
  let released = 0;
  const list = bubble.list;
  for (let k = list.length - 1; k >= 0; k--) {
    const a = list[k];
    release(bubble, network, activeCourses?.get(a.courseId) || null, a);
    released++;
  }
  // Encje dodane do mapy z pominięciem listy (stary kod zewnętrzny).
  for (const actor of [...bubble.actors.values()]) {
    release(bubble, network, activeCourses?.get(actor.courseId) || null, actor);
    released++;
  }
  bubble.actors.clear();
  list.length = 0;
  return released;
}

/** Encje do narysowania (nowa tablica — wygodna, ale alokuje). */
export function getActors(bubble) {
  return bubble ? [...bubble.actors.values()] : [];
}

/**
 * Encje bez alokacji — WEWNĘTRZNA gęsta tablica bańki: tylko do odczytu
 * i tylko do następnego `updateBubble` (kolejność się zmienia przy zwolnieniach).
 */
export function getActorList(bubble) {
  return bubble ? bubble.list : [];
}

/**
 * Poza do renderu między dwoma krokami bańki: `alpha` 0 = początek ostatniego
 * `updateBubble`, 1 = stan bieżący (bańka krokowana raz na klatkę → 1).
 */
export function actorRenderPose(actor, alpha, out = {}) {
  const t = clamp(Number(alpha), 0, 1);
  out.x = actor.prevX + (actor.x - actor.prevX) * t;
  out.y = actor.prevY + (actor.y - actor.prevY) * t;
  out.angle = actor.prevAngle + wrapPi(actor.angle - actor.prevAngle) * t;
  return out;
}
