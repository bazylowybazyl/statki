/**
 * BAŃKA MATERIALIZACJI — warstwa 3.
 *
 * Rekord kursu wie tylko, skąd dokąd i w ile. To wystarcza gospodarce, ale nie
 * wystarcza oku: prosta między punktami z jednostajną prędkością wygląda jak
 * przesuwanie znaczników po mapie, a nie jak lot.
 *
 * Ten moduł zamienia rekordy w promieniu obserwatora w PRAWDZIWE JEDNOSTKI:
 * z bezwładnością, ograniczonym skrętem, rozbiegiem i hamowaniem do zera przy
 * stanowisku. Poza promieniem wracają do rekordu z zachowanym postępem, więc
 * koszt zależy od promienia, a nie od liczby statków w układzie.
 *
 * Kto ma rację przy rozbieżności: **encja**. Prawdziwy lot z rozpędzaniem nigdy
 * nie trafia w sekundę co do sekundy rozkładu, więc gdy statek dolatuje, etap
 * domyka się na jego warunkach (`completeCurrentStage`), a nie zegara.
 *
 * Pułapki z briefu, których tu pilnujemy:
 *   - ujemne `dt` zerowane, a duże dodatnie dzielone na stabilne podkroki
 *   - przyspieszenie DUŻE wobec prędkości przelotowej, inaczej statek pełznie
 *   - separacja WYŁĄCZONA przy stanowiskach, bo blokuje dokowanie
 *   - punkt odgięcia idzie w przód i w bok, nigdy czysto w bok
 */

import {
  currentStage, stageProgress, STAGE_KIND, COURSE_STATUS,
  completeCurrentStage, syncActorStageProgress, attachActor, detachActor
} from './courseRegistry.js';
import { DRIVE_MODES, getNode } from './travelNetwork.js';
import { hullFootprint } from './dockLayout.js';

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
   * przez pół drogi, a wyglądało to na brak przepustowości doku.
   */
  accelRatio: 0.6,
  /** Hamowanie mocniejsze od rozbiegu — statek ma zdążyć stanąć przy stanowisku. */
  brakeRatio: 0.9,
  /** Maksymalna prędkość kątowa. Poniżej tego kąta wolno dodać ciąg. */
  turnRate: 0.9,
  alignedDot: 0.35,
  /** Promień, w którym jednostki się rozpychają. Tylko w strefach gęstych. */
  separationRadius: 900,
  separationStrength: 0.55,
  /** Ile encji wolno utrzymywać naraz. Bańka ma być ograniczona, nie nieskończona. */
  maxActors: 400,
  /** Poza tym ułamkiem promienia bańki encja wraca do rekordu (histereza). */
  releaseMargin: 1.25
});

/** Klasa jednostki → gabaryty z prawdziwych kadłubów gry. */
function actorSize(unitClass) {
  const size = hullFootprint(unitClass);
  return { length: Math.max(40, size.length), width: Math.max(20, size.width) };
}

/**
 * Końce etapu w jednostkach świata.
 *
 * Postój ma tylko `nodeId` i opcjonalne `pos` (stanowisko albo miejsce na
 * redzie), przelot ma `fromId`/`toId` i opcjonalne własne końce. Pominięcie
 * postoju zostawiało encję bez celu — dolatywała donikąd i nigdy nie dokowała.
 */
function stageEndpoints(network, stage) {
  if (!stage) return { from: null, to: null };
  if (stage.kind === STAGE_KIND.DWELL) {
    const at = stage.pos || getNode(network, stage.nodeId);
    return { from: at, to: at };
  }
  return {
    from: stage.fromPos || getNode(network, stage.fromId),
    to: stage.toPos || getNode(network, stage.toId)
  };
}

/** Prędkość przelotowa etapu — warp leci swoją, reszta konwencjonalną. */
function cruiseFor(stage) {
  const mode = DRIVE_MODES[stage?.mode];
  const speed = mode?.speed;
  return Number.isFinite(speed) && speed > 0 ? speed : DRIVE_MODES.conventional.speed;
}

// ============================================================
// Bańka
// ============================================================

export function createBubble(options = {}) {
  return {
    config: { ...FLIGHT_DEFAULTS, ...options },
    /** `courseId` → encja. */
    actors: new Map(),
    /** Siatka do separacji, przebudowywana raz na krok. */
    grid: new Map(),
    stats: { materialized: 0, released: 0, docked: 0 }
  };
}

/**
 * Tworzy encję dla kursu, ustawiając ją tam, gdzie rekord faktycznie doleciał.
 * Bez tego statek pojawiałby się na początku etapu i przelatywał drogę drugi raz.
 */
function materialize(bubble, network, course) {
  const stage = currentStage(course);
  if (!stage) return null;
  const { from, to } = stageEndpoints(network, stage);
  if (!to) return null;

  const t = stage.kind === STAGE_KIND.TRAVEL ? stageProgress(course) : 1;
  const origin = from || to;
  const x = origin.x + (to.x - origin.x) * t;
  const y = origin.y + (to.y - origin.y) * t;
  const heading = Math.atan2(to.y - origin.y, to.x - origin.x);
  const size = actorSize(course.unitClass);
  const cruise = cruiseFor(stage);

  const actor = {
    courseId: course.id,
    kind: course.kind,
    unitClass: course.unitClass,
    length: size.length,
    width: size.width,
    x,
    y,
    angle: Number.isFinite(heading) ? heading : 0,
    // Encja przejmuje bieg w ruchu, a nie od zera — inaczej każdy statek
    // wchodzący w bańkę gwałtownie zwalniałby na oczach gracza.
    speed: stage.kind === STAGE_KIND.TRAVEL ? cruise : 0,
    cruise,
    mode: stage.mode || null,
    stageIndex: course.stageIndex,
    docked: stage.kind === STAGE_KIND.DWELL,
    blocked: !!course.blocked,
    /** Postój przejmuje już naliczony czas rekordu zamiast zaczynać od zera. */
    dwell: stage.kind === STAGE_KIND.DWELL
      ? Math.max(0, Number(course.stageElapsed) || 0)
      : 0,
    /** Odległość do celu — używana przez render i przez decyzję o zwolnieniu. */
    distance: Math.hypot(to.x - x, to.y - y)
  };
  if (!attachActor(course, `bubble:${course.id}`)) return null;
  bubble.actors.set(course.id, actor);
  bubble.stats.materialized++;
  return actor;
}

function release(bubble, network, course, actor) {
  if (course) {
    const stage = currentStage(course);
    let fraction = stageProgress(course);
    if (stage?.kind === STAGE_KIND.TRAVEL) {
      const { from, to } = stageEndpoints(network, stage);
      if (from && to) {
        const total = Math.hypot(to.x - from.x, to.y - from.y);
        fraction = total > 1 ? 1 - Math.min(1, actor.distance / total) : 1;
      }
    }
    detachActor(course, { stageProgress: fraction, x: actor.x, y: actor.y, angle: actor.angle });
  }
  bubble.actors.delete(actor.courseId);
  bubble.stats.released++;
}

// ============================================================
// Sterowanie
// ============================================================

function shortestAngle(delta) {
  let value = delta;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/**
 * Kontroler dolotu: obróć się na cel, rozpędź, wyhamuj tak, żeby stanąć
 * dokładnie na miejscu. Ciąg dodajemy tylko wtedy, gdy dziób jest mniej więcej
 * na kursie — dzięki temu zakręt widać, zamiast dryfować bokiem.
 */
function steer(actor, targetX, targetY, dt, config, stopAtTarget) {
  const dx = targetX - actor.x;
  const dy = targetY - actor.y;
  const distance = Math.hypot(dx, dy);
  actor.distance = distance;
  if (distance < 1e-3) { actor.speed = 0; return 0; }

  const desired = Math.atan2(dy, dx);
  const turn = shortestAngle(desired - actor.angle);
  const maxTurn = config.turnRate * dt;
  actor.angle += Math.max(-maxTurn, Math.min(maxTurn, turn));

  const accel = actor.cruise * config.accelRatio;
  const brake = actor.cruise * config.brakeRatio;
  // Hamowanie zaczyna się dokładnie tam, gdzie musi: v²/2a od celu.
  const arrival = stopAtTarget ? Math.sqrt(Math.max(0, 2 * brake * distance)) : actor.cruise;
  const aligned = Math.cos(turn) > config.alignedDot;
  const target = Math.min(actor.cruise, arrival) * (aligned ? 1 : 0.15);

  const delta = target - actor.speed;
  actor.speed += Math.max(-brake * dt, Math.min(accel * dt, delta));
  if (actor.speed < 0) actor.speed = 0;

  actor.x += Math.cos(actor.angle) * actor.speed * dt;
  actor.y += Math.sin(actor.angle) * actor.speed * dt;
  return distance;
}

/**
 * Miękkie rozpychanie w strefach gęstych.
 *
 * Świadomie NIE jest to ORCA: ta nie ma bezwładności i nie kolejkuje, więc przy
 * wąskim przejściu tworzy napierający łuk zamiast linii. Tu wystarczy delikatne
 * odsunięcie, żeby jednostki nie nakładały się w kadrze — kolejkowanie załatwia
 * rozkład stanowisk, nie unikanie.
 *
 * Zaparkowane i stojące przy stanowisku są POMIJANE: separacja przy odstępie
 * stanowisk mniejszym niż jej promień blokuje dokowanie na amen.
 */
function separate(bubble, dt) {
  const { separationRadius, separationStrength } = bubble.config;
  if (separationRadius <= 0) return;

  const grid = bubble.grid;
  grid.clear();
  const cell = separationRadius;
  for (const actor of bubble.actors.values()) {
    if (actor.docked) continue;
    const key = `${Math.floor(actor.x / cell)}:${Math.floor(actor.y / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = []);
    bucket.push(actor);
  }

  for (const bucket of grid.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i];
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq >= separationRadius * separationRadius || distanceSq < 1e-6) continue;
        const distance = Math.sqrt(distanceSq);
        const push = (separationRadius - distance) / separationRadius
          * separationStrength * a.cruise * dt;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
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

  // 1. Zwolnij to, co wyszło poza bańkę albo przestało być aktywne.
  for (const [courseId, actor] of bubble.actors) {
    const course = activeCourses.get(courseId);
    if (!course || course.status !== COURSE_STATUS.ACTIVE) {
      bubble.actors.delete(courseId);
      continue;
    }
    if (Math.hypot(actor.x - focus.x, actor.y - focus.y) > outer) {
      release(bubble, network, course, actor);
    }
  }

  // 2. Zmaterializuj rekordy, które weszły w bańkę.
  if (bubble.actors.size < config.maxActors) {
    for (const course of activeCourses.values()) {
      if (bubble.actors.size >= config.maxActors) break;
      if (bubble.actors.has(course.id) || course.actorId) continue;
      const stage = currentStage(course);
      if (!stage) continue;
      const { from, to } = stageEndpoints(network, stage);
      if (!to) continue;
      const t = stage.kind === STAGE_KIND.TRAVEL ? stageProgress(course) : 1;
      const origin = from || to;
      const x = origin.x + (to.x - origin.x) * t;
      const y = origin.y + (to.y - origin.y) * t;
      if (Math.hypot(x - focus.x, y - focus.y) > inner) continue;
      materialize(bubble, network, course);
    }
  }

  if (elapsed <= 0) return events;

  // 3. Prowadź encje. Duży krok dzielimy zamiast obcinać: fizyka zachowuje
  // stabilność kroku 0,25 s, ale postój i lot zużywają całe przekazane `dt`.
  let remaining = elapsed;
  while (remaining > 0) {
    const step = Math.min(0.25, remaining);
    remaining -= step;

    for (const [courseId, actor] of bubble.actors) {
      const course = activeCourses.get(courseId);
      if (!course) { bubble.actors.delete(courseId); continue; }

      const stage = currentStage(course);
      if (!stage) continue;

      // Zmiana etapu w rekordzie (np. odblokowanie stanowiska) musi przełożyć się
      // na nowy cel encji, inaczej statek leciałby do poprzedniego punktu.
      if (actor.stageIndex !== course.stageIndex) {
        actor.stageIndex = course.stageIndex;
        actor.cruise = cruiseFor(stage);
        actor.mode = stage.mode || null;
        actor.docked = stage.kind === STAGE_KIND.DWELL;
        actor.dwell = Math.max(0, Number(course.stageElapsed) || 0);
      }
      actor.blocked = !!course.blocked;

      const { from, to } = stageEndpoints(network, stage);
      if (!to) continue;

      if (stage.kind === STAGE_KIND.DWELL) {
        // Postój: dolatujemy do stanowiska i STAJEMY.
        //
        // Kluczowe jest to „stajemy": kontroler dolotu sterowany co klatkę
        // przestrzeliwuje cel o ułamek jednostki, zawraca, przestrzeliwuje znowu —
        // i statek kręci się w kółko w nieskończoność. Po dolocie odcinamy
        // sterowanie i przypinamy go do miejsca.
        const progiel = Math.max(actor.length, 60);
        const dystans = Math.hypot(to.x - actor.x, to.y - actor.y);
        if (actor.docked && dystans < progiel * 1.5) {
          actor.x = to.x;
          actor.y = to.y;
          actor.speed = 0;
          actor.distance = 0;
        } else {
          actor.docked = steer(actor, to.x, to.y, step, config, true) < progiel;
        }
        if (actor.docked && !course.blocked) {
          actor.dwell = (actor.dwell || 0) + step;
          const seconds = Math.max(0, Number(stage.seconds) || 0);
          syncActorStageProgress(course, seconds > 0 ? actor.dwell / seconds : 1);
          if (actor.dwell >= stage.seconds) {
            actor.dwell = 0;
            bubble.stats.docked++;
            if (completeCurrentStage(registry, course, events)) {
              bubble.actors.delete(courseId);
              continue;
            }
          }
        }
        continue;
      }

      // Przelot. Hamujemy do zera tylko wtedy, gdy zaraz po nim jest postój —
      // w środku trasy statek ma przelatywać punkt, a nie zatrzymywać się na nim.
      const next = course.stages[course.stageIndex + 1];
      const stopHere = !next || next.kind === STAGE_KIND.DWELL;
      const distance = steer(actor, to.x, to.y, step, config, stopHere);
      actor.docked = false;

      if (from) {
        const total = Math.hypot(to.x - from.x, to.y - from.y);
        const left = Math.hypot(to.x - actor.x, to.y - actor.y);
        syncActorStageProgress(course, total > 1 ? 1 - Math.min(1, left / total) : 1);
      }

      const reached = stopHere
        ? distance < Math.max(actor.length * 1.5, 80)
        : distance < Math.max(actor.length * 3, actor.speed * step * 2);
      if (reached) {
        if (from) {
          actor.x = to.x;
          actor.y = to.y;
        }
        if (completeCurrentStage(registry, course, events)) {
          bubble.actors.delete(courseId);
          continue;
        }
        actor.dwell = 0;
      }
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
  for (const actor of [...bubble.actors.values()]) {
    release(bubble, network, activeCourses?.get(actor.courseId) || null, actor);
    released++;
  }
  bubble.actors.clear();
  return released;
}

/** Encje do narysowania. */
export function getActors(bubble) {
  return bubble ? [...bubble.actors.values()] : [];
}
