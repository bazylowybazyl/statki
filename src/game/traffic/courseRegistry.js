/**
 * REJESTR KURSÓW — warstwa rekordów ruchu.
 *
 * Kurs to jedna wyprawa jakiejś jednostki: „zawieź rudę z Merkurego na Ziemię",
 * „poleć w pas, wykop uran, wróć", „dowieź paliwo do stacji tankowania".
 * Każdy kurs ma powód ekonomiczny — nie ma tu ruchu dekoracyjnego. Kiedy pirat
 * zestrzeli górników, stacja naprawdę dostaje mniej rudy.
 *
 * Kurs jest REKORDEM, nie encją. Postęp liczy się analitycznie, bo pojedynczy
 * przelot trwa 23–49 minut (patrz `scripts/analiza-ruchu.mjs`) i gracz i tak go
 * nie ogląda. Fizyczny statek pojawia się tylko wtedy, gdy gracz jest blisko —
 * i wtedy to ON prowadzi zegar, a rekord tylko przejmuje wynik.
 *
 * PODZIAŁ ODPOWIEDZIALNOŚCI — ten moduł prowadzi RUCH, nie księgowość ładunku.
 * Własność partii, atomowe przejścia i niezmiennik „jeden właściciel" zostają
 * w `cargoFleet.js`, które ma to przetestowane. Kurs trzyma tylko referencję do
 * zlecenia (`payload.orderId`) i nigdy nie rusza cudzego manifestu.
 *
 * Moduł jest czystą logiką: bez DOM-u, bez Three.js, bez znajomości gracza.
 */

// ============================================================
// Słownik pojęć
// ============================================================

/**
 * Rodzaje kursów. Każdy istnieje dlatego, że coś w gospodarce się bez niego
 * nie domyka — nie dlatego, że „niebo ma być pełne".
 */
export const COURSE_KIND = Object.freeze({
  /** Przewóz towaru między stacjami. Najliczniejszy: 5190 t/h na 24 kierunkach. */
  HAUL: 'haul',
  /** Wyprawa górnicza: stacja → pole → stacja. Jedyne źródło rudy uranu. */
  MINE: 'mine',
  /** Dowóz paliwa. Bez niego stacje tankowania są tylko dekoracją. */
  TANKER: 'tanker',
  /** Holownik po wrak. Sprząta pobojowisko i odzyskuje ładunek. */
  TUG: 'tug',
  /** Patrol frakcyjny. Kosztuje frakcję, obniża ryzyko na pilnowanym odcinku. */
  PATROL: 'patrol',
  /**
   * Wyprawa wojenna. Leci przez tę samą sieć co frachtowce, więc może zostać
   * przechwycona po drodze — flota stracona przed bitwą jest stracona tak samo.
   */
  WAR: 'war',
  /**
   * Rejd piracki. Podnosi ryzyko na szlaku, po którym krąży, więc da się go
   * znaleźć i zestrzelić — piractwo przestaje być samym rzutem kostką.
   */
  RAID: 'raid'
});

const VALID_KINDS = new Set(Object.values(COURSE_KIND));

/**
 * Stan kursu. Trzy sposoby na niedolecenie odpowiadają wprost trybom awarii
 * z briefu: pirat, wroga frakcja, brak paliwa. Zator NIE jest trybem awarii —
 * potrafi tylko opóźnić, przez wydłużenie etapu postoju.
 */
export const COURSE_STATUS = Object.freeze({
  ACTIVE: 'active',
  DONE: 'done',
  WRECKED: 'wrecked',
  STRANDED: 'stranded'
});

/** Rodzaj etapu: przelot albo postój. Wszystko inne da się z tych dwóch złożyć. */
export const STAGE_KIND = Object.freeze({
  TRAVEL: 'travel',
  DWELL: 'dwell'
});

/**
 * Po co statek stoi. Rozróżnienie ma znaczenie dla piractwa: `HOLD` i `QUEUE`
 * to jedyne momenty, w których konwój jest jednocześnie wolny i przewidywalny.
 */
export const DWELL_REASON = Object.freeze({
  LOAD: 'load',
  UNLOAD: 'unload',
  EXTRACT: 'extract',
  REFUEL: 'refuel',
  SERVICE: 'service',
  /** Pochłanianie opóźnienia przy węźle — patrz SPEC-kolejkowanie-slotowe. */
  HOLD: 'hold'
});

const EPSILON = 1e-6;

// ============================================================
// Budowa planu
// ============================================================

function stableId(value) {
  const raw = value && typeof value === 'object' ? value.id : value;
  return raw == null ? '' : String(raw).trim().toLowerCase();
}

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function point(value) {
  if (!value) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Etap przelotu. `seconds` i `fuel` liczy warstwa sieci, nie ten moduł.
 *
 * `fromPos`/`toPos` pozwalają przypiąć etapowi WŁASNE końce zamiast środków
 * węzłów. To jest konieczne wszędzie tam, gdzie węzeł nie jest punktem: pole
 * wydobywcze to pierścień o szerokości pół miliona jednostek, a stanowisko
 * w doku leży kilkadziesiąt tysięcy od środka stacji. Bez tego wszyscy górnicy
 * lecą w to samo miejsce, a statki teleportują się na orbitę postojową.
 */
export function travelStage(fromId, toId, options = {}) {
  return {
    kind: STAGE_KIND.TRAVEL,
    fromId: stableId(fromId),
    toId: stableId(toId),
    fromPos: point(options.fromPos),
    toPos: point(options.toPos),
    mode: String(options.mode || 'conventional'),
    distance: nonNegative(options.distance),
    seconds: nonNegative(options.seconds),
    fuel: nonNegative(options.fuel),
    /** Mnożnik ryzyka odcinka — warp ma 0, kolejka pod bramą sporo powyżej 1. */
    risk: nonNegative(options.risk, 1)
  };
}

/**
 * Etap postoju w węźle. Obsługa, tankowanie, wydobycie, pochłanianie opóźnienia.
 *
 * `entryPos` to punkt, w którym kurs KOŃCZY dolot — brama wjazdowa do portu.
 * `fromPos` i `moveSeconds` opisują dojście z tej bramy na przydzielone miejsce
 * (stanowisko albo orbitę oczekiwania) i pozwalają interpolować je na mapie.
 *
 * Bez tego dojścia zmiana miejsca była SKOKIEM: postój ma jedną pozycję, więc
 * podmiana `pos` w chwili zwolnienia doku przenosiła statek natychmiast. Widać
 * to było wprost — statki teleportowały się z orbity oczekiwania do stanowiska.
 */
export function dwellStage(nodeId, seconds, reason = DWELL_REASON.SERVICE, pos = null, options = {}) {
  return {
    kind: STAGE_KIND.DWELL,
    nodeId: stableId(nodeId),
    pos: point(pos),
    entryPos: point(options.entryPos),
    fromPos: point(options.fromPos),
    moveSeconds: nonNegative(options.moveSeconds),
    seconds: nonNegative(seconds),
    reason: String(reason),
    risk: reason === DWELL_REASON.HOLD ? 1 : 0
  };
}

/**
 * Ustawia nowe miejsce postoju wraz z dojściem do niego.
 *
 * Wywołuje to dyspozytor portu: przy przydziale miejsca w kolejce i ponownie,
 * gdy zwolni się stanowisko. Statek nie przeskakuje — leci z miejsca, w którym
 * właśnie jest, przez `seconds` sekund.
 */
export function moveDwellTo(course, stage, pos, seconds = 0) {
  if (!stage || stage.kind !== STAGE_KIND.DWELL) return false;
  const cel = point(pos);
  if (!cel) return false;
  const skad = stage.pos || stage.entryPos;
  stage.fromPos = skad ? { ...skad } : null;
  stage.pos = cel;
  stage.moveSeconds = nonNegative(seconds);
  // Dojście liczy się od nowa, więc zegar postoju startuje od zera. Obsługa
  // przy stanowisku i tak zaczyna się dopiero po dolocie.
  if (course) course.stageElapsed = 0;
  return true;
}

/**
 * Wydłuża etap w locie — statek zwalnia, zamiast stać pod portem.
 *
 * To jest pochłanianie opóźnienia z SPEC-kolejkowania: czas dokłada się tam,
 * gdzie nic nie kosztuje (otwarta przestrzeń), a nie tam, gdzie kosztuje
 * najwięcej (tłok przy stanowiskach).
 */
export function extendStage(course, stage, extraSeconds) {
  const dodatek = nonNegative(extraSeconds);
  if (!course || !stage || dodatek <= 0) return 0;
  stage.seconds = nonNegative(stage.seconds) + dodatek;
  course.duration = nonNegative(course.duration) + dodatek;
  course.remaining = Math.max(0, course.duration - course.elapsed);
  course.eta = nonNegative(course.eta) + dodatek;
  return dodatek;
}

function stageIsValid(stage) {
  if (!stage || typeof stage !== 'object') return false;
  if (stage.kind === STAGE_KIND.TRAVEL) return !!stage.fromId && !!stage.toId;
  if (stage.kind === STAGE_KIND.DWELL) return !!stage.nodeId;
  return false;
}

/** Gdzie kurs fizycznie jest na danym etapie — potrzebne do materializacji. */
export function stageLocation(stage) {
  if (!stage) return null;
  return stage.kind === STAGE_KIND.DWELL ? stage.nodeId : stage.toId;
}

export function planDuration(stages) {
  let total = 0;
  for (const stage of stages || []) total += nonNegative(stage?.seconds);
  return total;
}

export function planFuel(stages) {
  let total = 0;
  for (const stage of stages || []) total += nonNegative(stage?.fuel);
  return total;
}

// ============================================================
// Rejestr
// ============================================================

export function createCourseRegistry(options = {}) {
  const registry = {
    courses: [],
    nextId: 1,
    clock: 0,
    /** Licznik zdarzeń zamkniętych kursów — do panelu i do strojenia. */
    tally: { done: 0, wrecked: 0, stranded: 0, launched: 0 }
  };
  // Indeksy runtime: te same obiekty, bez kopiowania. Kursy zakończone zostają
  // w `courses` dla historii, ale nie obciążają gorącej pętli.
  Object.defineProperty(registry, 'active', {
    value: [], writable: true, configurable: true, enumerable: false
  });
  // Wyszukiwanie po identyfikatorze. Do 2026-09-01 ten indeks NIE ISTNIAŁ,
  // a mimo to trzy moduły go czytały (`registry?.byId?.get?.(id)` w piractwie,
  // dyspozytorze wojennym i u złomiarzy) — zawsze spadając na `courses.find()`,
  // czyli liniowe przejście po całej historii, co tick, dla każdej kampanii,
  // rejdu, przemytu i holownika. Optional chaining sprawiło, że brak indeksu
  // nigdy nie dał sygnału.
  //
  Object.defineProperty(registry, 'byId', {
    value: new Map(), writable: true, configurable: true, enumerable: false
  });
  // KARENCJA DLA DOMKNIĘTYCH — dwie generacje identyfikatorów do usunięcia.
  //
  // Bez niej `keepHistory: false` zacierał WYNIK kursu: rekord znikał w chwili
  // zamknięcia, a wołający dostawał `null`. Cała czwórka pytających — wojna,
  // rejdy, przemyt i złomiarze — czyta to samo `if (course && course.status
  // !== 'done')`, więc brak rekordu wpadał w gałąź „doleciał". Skutek:
  // kampania rozbita po drodze i tak rozgrywała bitwę pod celem, a holownik
  // zestrzelony w polu meldował udany odzysk.
  //
  // Wszyscy czterej pytają RAZ NA TICK, zaraz po `advanceCourses`. Dwie
  // generacje dają każdemu pełny tick zapasu, a zużycie pamięci ogranicza się
  // do kursów domkniętych w dwóch ostatnich krokach — więc tryb, który powstał
  // po to, żeby nic nie rosło, nadal nic nie gromadzi.
  Object.defineProperty(registry, 'closing', {
    value: { current: new Set(), previous: new Set() },
    writable: true, configurable: true, enumerable: false
  });
  registry.keepHistory = options.keepHistory !== false;
  return registry;
}

/**
 * Przesuwa karencję o jedną generację: to, co czekało na usunięcie od
 * poprzedniego ticku, znika z indeksu naprawdę.
 */
function retireClosed(registry) {
  const closing = registry.closing;
  if (!closing) return;
  for (const id of closing.previous) registry.byId.delete(id);
  closing.previous = closing.current;
  closing.current = new Set();
}

function nextCourseId(registry, kind) {
  const id = `${kind}-${String(registry.nextId).padStart(5, '0')}`;
  registry.nextId++;
  return id;
}

/**
 * Zakłada kurs. Zwraca `null`, jeśli plan jest niespójny — walidacja kończy się
 * PRZED jakąkolwiek mutacją, żeby nieudane zgłoszenie nie zostawiało śmieci.
 *
 * `fuel` jest na razie licznikiem: kurs go zużywa i potrafi przez niego stanąć,
 * ale nie zdejmuje paliwa z magazynu stacji. Wpięcie w bilans dopiero po pomiarze,
 * ile to naprawdę jest — inaczej rozstroiłoby skalibrowaną gospodarkę.
 */
export function launchCourse(registry, spec = {}) {
  if (!registry || !Array.isArray(registry.courses)) return null;
  const kind = String(spec.kind || '');
  if (!VALID_KINDS.has(kind)) return null;

  const stages = Array.isArray(spec.stages) ? spec.stages.filter(stageIsValid) : [];
  if (!stages.length || stages.length !== (spec.stages?.length || 0)) return null;

  const fuelCapacity = nonNegative(spec.fuelCapacity);
  const fuel = Math.min(fuelCapacity, nonNegative(spec.fuel, fuelCapacity));
  const now = nonNegative(spec.now, registry.clock);
  const duration = planDuration(stages);

  const course = {
    id: String(spec.id || nextCourseId(registry, kind)),
    kind,
    status: COURSE_STATUS.ACTIVE,
    factionId: spec.factionId ?? null,
    /** Klasa jednostki z gry (`freighter-small` itd.) — nie wymyślamy nowych. */
    unitClass: String(spec.unitClass || ''),
    originId: stableId(spec.originId) || stages[0].fromId || stages[0].nodeId,
    destinationId: stableId(spec.destinationId) || stageLocation(stages[stages.length - 1]),

    stages,
    stageIndex: 0,
    stageElapsed: 0,
    elapsed: 0,
    duration,
    remaining: duration,

    fuel,
    fuelCapacity,
    fuelBurned: 0,

    /** Wstrzymany przez brak wolnego stanowiska — patrz `advanceCourse`. */
    blocked: false,
    holdSeconds: 0,
    berthId: null,
    berthRef: null,

    /** Referencja do zlecenia w cargoFleet. Manifestu NIE kopiujemy. */
    payload: spec.payload ? { ...spec.payload } : null,
    escortIds: Array.isArray(spec.escortIds) ? [...spec.escortIds] : [],

    launchedAt: now,
    eta: now + duration,
    closedAt: null,
    closedReason: null,

    /** Wiązanie z encją fizyczną w bańce wokół gracza. */
    actorId: null,
    viewState: null
  };

  registry.courses.push(course);
  registry.active.push(course);
  registry.byId.set(course.id, course);
  registry.tally.launched++;
  return course;
}

/**
 * Kurs po identyfikatorze — jedyne miejsce, w którym wolno go szukać.
 *
 * Zwraca także kursy ZAMKNIĘTE, dopóki trzyma je historia. To jest istotne dla
 * wołających, którzy pytają o wynik: kampania wojenna, rejd, przemyt i holownik
 * sprawdzają po fakcie, czy kurs dotarł, czy został rozbity po drodze.
 */
export function getCourse(registry, courseId) {
  return registry?.byId?.get(String(courseId || '')) || null;
}

export function getActiveCourses(registry) {
  return registry?.active || [];
}

// ============================================================
// Postęp
// ============================================================

export function currentStage(course) {
  return course?.stages?.[course.stageIndex] || null;
}

/** Ułamek przebyty w bieżącym etapie — do interpolacji pozycji. */
export function stageProgress(course) {
  const stage = currentStage(course);
  if (!stage) return 1;
  const seconds = nonNegative(stage.seconds);
  if (seconds <= EPSILON) return 1;
  return Math.min(1, nonNegative(course.stageElapsed) / seconds);
}

function closeCourse(registry, course, status, reason, now) {
  course.status = status;
  course.closedAt = now;
  course.closedReason = reason || null;
  course.remaining = 0;
  course.actorId = null;
  const index = registry.active.indexOf(course);
  if (index >= 0) registry.active.splice(index, 1);
  if (status === COURSE_STATUS.DONE) registry.tally.done++;
  else if (status === COURSE_STATUS.WRECKED) registry.tally.wrecked++;
  else if (status === COURSE_STATUS.STRANDED) registry.tally.stranded++;
  if (!registry.keepHistory) {
    const historyIndex = registry.courses.indexOf(course);
    if (historyIndex >= 0) registry.courses.splice(historyIndex, 1);
    // Z indeksu NIE usuwamy od razu — rekord musi przeżyć tyle, żeby pytający
    // zdążył odczytać, czy kurs doleciał, czy został rozbity. Patrz karencja
    // przy `createCourseRegistry`.
    registry.closing.current.add(course.id);
  }
}

/**
 * Domyka bieżący etap: rozlicza paliwo i przechodzi do następnego.
 * Zwraca `true`, gdy kurs właśnie się skończył.
 *
 * Wydzielone, bo domykać etap potrafią dwa źródła: zegar analityczny oraz
 * fizyka zmaterializowanej encji, która doleciała na miejsce wcześniej albo
 * później niż przewidywał rozkład.
 */
function settleStage(registry, course, stage, events) {
  course.stageElapsed = 0;

  if (stage.kind === STAGE_KIND.TRAVEL) {
    course.fuel = Math.max(0, course.fuel - stage.fuel);
    course.fuelBurned += stage.fuel;
  } else if (stage.reason === DWELL_REASON.REFUEL) {
    course.fuel = course.fuelCapacity;
  }

  course.stageIndex++;
  if (course.stageIndex >= course.stages.length) {
    closeCourse(registry, course, COURSE_STATUS.DONE, 'arrived', registry.clock);
    events.push({ type: 'done', courseId: course.id, course });
    return true;
  }
  return false;
}

/**
 * Domyka etap NA ŻĄDANIE — używa tego bańka materializacji, gdy fizyczny statek
 * faktycznie doleciał. Encja jest wtedy autorytetem, nie rozkład: prawdziwy lot
 * z rozpędzaniem i hamowaniem nigdy nie trafia w sekundę co do sekundy.
 */
export function completeCurrentStage(registry, course, events = []) {
  const stage = currentStage(course);
  if (!stage || course.status !== COURSE_STATUS.ACTIVE) return false;
  // Zegar kursu ma zgadzać się z tym, co encja faktycznie przeleciała.
  course.elapsed += Math.max(0, nonNegative(stage.seconds) - nonNegative(course.stageElapsed));
  const closed = settleStage(registry, course, stage, events);
  course.remaining = Math.max(0, course.duration - course.elapsed);
  return closed;
}

/**
 * Synchronizuje zegar rekordu z postępem encji fizycznej w bieżącym etapie.
 *
 * Analityczny zegar jest wyłączony, gdy kurs ma `actorId`, ale scheduler nadal
 * czyta `elapsed` i `remaining`. Bez tej synchronizacji ETA zastygało na cały
 * czas obserwowania portu. Postęp jest monotoniczny: chwilowe odgięcie toru lub
 * separacja nie mogą cofnąć kursu.
 */
export function syncActorStageProgress(course, progress) {
  if (!course || !course.actorId || course.status !== COURSE_STATUS.ACTIVE) return false;
  const stage = currentStage(course);
  const value = Number(progress);
  if (!stage || !Number.isFinite(value)) return false;

  const next = nonNegative(stage.seconds) * Math.max(0, Math.min(1, value));
  const previous = nonNegative(course.stageElapsed);
  if (next > previous) {
    const delta = next - previous;
    course.stageElapsed = next;
    course.elapsed = nonNegative(course.elapsed) + delta;
  }
  course.remaining = Math.max(0, course.duration - course.elapsed);
  return true;
}

/**
 * Przesuwa jeden kurs o `dt`. Może przeskoczyć kilka etapów w jednym wywołaniu,
 * bo przy przewijaniu czasu krok bywa większy niż postój przy stanowisku.
 *
 * Zwraca listę zdarzeń — wejście w etap, brak paliwa, koniec kursu.
 */
function advanceCourse(registry, course, dt, events) {
  // Po materializacji zegar prowadzi fizyka encji, nie ten rachunek.
  if (course.actorId) return;

  // Kurs wstrzymany czeka na wolne stanowisko. Czas płynie, postęp nie —
  // i z tego bierze się kolejka pod portem. Bez tego stanowiska były tylko
  // ozdobą: postój leciał dalej niezależnie od tego, czy jest gdzie stanąć.
  if (course.blocked) {
    course.holdSeconds = (course.holdSeconds || 0) + dt;
    // Dojście na przydzielone miejsce biegnie MIMO wstrzymania: statek leci na
    // swoją pozycję w kolejce i dopiero tam czeka. Zamrożenie całego etapu
    // zostawiało go w bramie wjazdowej — wyglądało to jak zwis w połowie ruchu.
    const czekajacy = currentStage(course);
    const dojscie = nonNegative(czekajacy?.moveSeconds);
    if (dojscie > 0 && course.stageElapsed < dojscie) {
      course.stageElapsed = Math.min(dojscie, nonNegative(course.stageElapsed) + dt);
    }
    return;
  }

  let left = dt;
  let guard = course.stages.length * 2 + 8;

  while (left > EPSILON && course.status === COURSE_STATUS.ACTIVE && guard-- > 0) {
    const stage = currentStage(course);
    if (!stage) {
      closeCourse(registry, course, COURSE_STATUS.DONE, 'plan-complete', registry.clock);
      events.push({ type: 'done', courseId: course.id, course });
      return;
    }

    // Paliwo sprawdzamy na WEJŚCIU w etap, nie w połowie. Statek, który nie ma
    // czym dolecieć, nie startuje — zostaje tam, gdzie jest, i czeka na tankowiec.
    if (stage.kind === STAGE_KIND.TRAVEL && course.stageElapsed <= EPSILON) {
      if (course.fuelCapacity > 0 && stage.fuel > course.fuel + EPSILON) {
        closeCourse(registry, course, COURSE_STATUS.STRANDED, 'out-of-fuel', registry.clock);
        events.push({ type: 'stranded', courseId: course.id, course, nodeId: stage.fromId });
        return;
      }
      events.push({ type: 'stage', courseId: course.id, course, stage });
    }

    const stageSeconds = nonNegative(stage.seconds);
    const stageLeft = stageSeconds - course.stageElapsed;

    if (left < stageLeft - EPSILON) {
      course.stageElapsed += left;
      course.elapsed += left;
      left = 0;
      break;
    }

    // Etap się domyka: dopalamy resztę i przechodzimy dalej.
    const consumed = Math.max(0, stageLeft);
    course.elapsed += consumed;
    left -= consumed;
    if (settleStage(registry, course, stage, events)) return;
  }

  course.remaining = Math.max(0, course.duration - course.elapsed);
}

/**
 * Tick całej warstwy. Nie zna gracza ani renderu, więc dostawy dochodzą także
 * wtedy, gdy w pobliżu nie ma żadnej zmaterializowanej encji.
 */
export function advanceCourses(registry, dt, options = {}) {
  if (!registry) return [];
  const delta = Math.max(0, Number(dt) || 0);
  registry.clock = nonNegative(registry.clock) + delta;

  const events = Array.isArray(options.events) ? options.events : [];
  events.length = 0;
  if (delta <= 0) return events;

  // Karencja przesuwa się RAZ NA TICK i przed jakimkolwiek zamknięciem, żeby
  // to, co domknie się za chwilę, dostało pełną generację zapasu.
  retireClosed(registry);

  for (let i = registry.active.length - 1; i >= 0; i--) {
    const course = registry.active[i];
    if (!course || course.status !== COURSE_STATUS.ACTIVE) {
      registry.active.splice(i, 1);
      continue;
    }
    advanceCourse(registry, course, delta, events);
  }

  if (typeof options.onEvent === 'function') {
    for (const event of events) options.onEvent(event);
  }
  return events;
}

// ============================================================
// Przerwanie kursu
// ============================================================

/**
 * Kurs kończy się wrakiem. Sam ładunek przechodzi we władanie wraku przez
 * `wreckShipmentOrder` w `cargoFleet.js` — tutaj tylko zamykamy ruch i mówimy,
 * GDZIE to się stało, żeby było gdzie postawić wrak i wysłać holownik.
 */
export function wreckCourse(registry, course, reason = 'pirate') {
  if (!registry || !course || course.status !== COURSE_STATUS.ACTIVE) return null;
  const stage = currentStage(course);
  const at = {
    stageIndex: course.stageIndex,
    progress: stageProgress(course),
    fromId: stage?.fromId || stage?.nodeId || course.originId,
    toId: stage?.toId || stage?.nodeId || course.destinationId
  };
  closeCourse(registry, course, COURSE_STATUS.WRECKED, reason, registry.clock);
  return at;
}

/** Tankowiec dotarł do unieruchomionego kursu — wraca do gry od bieżącego etapu. */
export function refuelCourse(registry, course, amount = Infinity) {
  if (!course || course.status !== COURSE_STATUS.STRANDED) return false;
  course.fuel = Math.min(course.fuelCapacity, course.fuel + nonNegative(amount, course.fuelCapacity));
  const stage = currentStage(course);
  if (stage?.kind === STAGE_KIND.TRAVEL && stage.fuel > course.fuel + EPSILON) return false;
  course.status = COURSE_STATUS.ACTIVE;
  course.closedAt = null;
  course.closedReason = null;
  course.remaining = Math.max(0, course.duration - course.elapsed);
  if (!registry.active.includes(course)) registry.active.push(course);
  // Wznowienie musi przywrócić kurs WSZĘDZIE, skąd zdjęło go zamknięcie.
  // Przy `keepHistory: false` dotankowany kurs znów lata, ale nie było go już
  // ani w historii, ani w indeksie — czyli `getCourse` nie widziało żywego,
  // aktywnego rekordu.
  if (!registry.courses.includes(course)) registry.courses.push(course);
  registry.byId.set(course.id, course);
  // Kurs znów lata, więc nie wolno go usunąć z indeksu przy najbliższym
  // przesunięciu karencji — wypisujemy go z obu generacji.
  registry.closing.current.delete(course.id);
  registry.closing.previous.delete(course.id);
  registry.tally.stranded = Math.max(0, registry.tally.stranded - 1);
  return true;
}

// ============================================================
// Bańka materializacji
// ============================================================

/**
 * Wiąże kurs z encją fizyczną. Od tej chwili zegar prowadzi fizyka — rekord
 * przestaje się liczyć analitycznie, żeby postęp nie biegł dwa razy.
 */
export function attachActor(course, actorId) {
  if (!course || course.status !== COURSE_STATUS.ACTIVE) return false;
  const id = String(actorId || '').trim();
  if (!id || (course.actorId && course.actorId !== id)) return false;
  course.actorId = id;
  return true;
}

/**
 * Odwiązuje encję i przepisuje jej postęp z powrotem na rekord. Bez tego kurs
 * cofnąłby się do stanu sprzed materializacji — dokładnie ten błąd kosztował
 * w poprzednim podejściu wyciek ładunku.
 */
export function detachActor(course, snapshot = null) {
  if (!course || !course.actorId) return false;
  const stage = currentStage(course);
  const progress = Number(snapshot?.stageProgress);
  if (stage && Number.isFinite(progress)) {
    const clamped = Math.max(0, Math.min(1, progress));
    const before = course.elapsed - course.stageElapsed;
    course.stageElapsed = nonNegative(stage.seconds) * clamped;
    course.elapsed = before + course.stageElapsed;
    course.remaining = Math.max(0, course.duration - course.elapsed);
  }
  course.viewState = snapshot ? { ...snapshot } : null;
  course.actorId = null;
  return true;
}

// ============================================================
// Podsumowania dla UI i strojenia
// ============================================================

/** Agregat dla „komputera handlowego": natężenie na kierunkach, bez encji. */
export function summarizeFlows(registry) {
  const lanes = new Map();
  for (const course of getActiveCourses(registry)) {
    const stage = currentStage(course);
    if (!stage || stage.kind !== STAGE_KIND.TRAVEL) continue;
    const key = `${stage.fromId}>${stage.toId}`;
    const lane = lanes.get(key) || { fromId: stage.fromId, toId: stage.toId, count: 0, byKind: {} };
    lane.count++;
    lane.byKind[course.kind] = (lane.byKind[course.kind] || 0) + 1;
    lanes.set(key, lane);
  }
  return [...lanes.values()].sort((a, b) => b.count - a.count);
}

export function countByStatus(registry) {
  const counts = { active: 0, done: 0, wrecked: 0, stranded: 0 };
  for (const course of registry?.courses || []) {
    if (counts[course.status] !== undefined) counts[course.status]++;
  }
  return counts;
}
