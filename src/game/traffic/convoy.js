/**
 * KONWOJE I ESKORTY.
 *
 * Konwój to WIĄZANIE kursów, nie byt zamiast nich. Kurs zostaje atomem — jeden
 * statek, jeden manifest, jedno stanowisko w doku — bo na nim stoi cała
 * księgowość ładunku i cały przydział stanowisk. Konwój dokłada do tego trzy
 * rzeczy, których pojedynczy kurs mieć nie może:
 *
 *   1. WSPÓLNĄ PULĘ RYZYKA — rzut na przechwyt idzie raz na grupę, nie raz na
 *      statek. Dopiero wtedy okręt osłony ma czego pilnować.
 *   2. CZĘŚCIOWĄ STRATĘ — przechwycony konwój traci część składu, a nie całość.
 *      „Zestrzelisz jeden, tracisz jego część, reszta ucieka" (SPEC-ekonomia §10).
 *   3. WSPÓLNY ROZKŁAD — grupa leci razem, więc widać ją jako grupę.
 *
 * Decyzja o konwojowaniu jest EKONOMICZNA, nie regułowa — ta sama funkcja
 * kosztu, którą wybiera się napęd:
 *
 *     konwojuj, gdy   zaoszczędzona strata  >  koszt eskorty
 *
 * Dzięki temu samotne szutle na krótkich, bezpiecznych trasach zostają, bo są
 * racjonalne — a nie dlatego, że ktoś tak zaprogramował. I podniesienie presji
 * piratów samo zamienia układ w świat konwojów.
 */

/** Ile ryzyka zdejmuje jednostka siły eskorty. Dobrane tak, żeby dwie osłony
 *  mniej więcej połowiły szansę przechwytu, a nie czyniły konwoju nietykalnym. */
export const ESCORT_MODEL = Object.freeze({
  /** `chance / (1 + power × factor)` */
  protectionFactor: 0.55,
  /** Ułamek składu tracony przy przechwycie konwoju bez osłony. */
  baseLossFraction: 0.55,
  /** Każda jednostka siły eskorty ratuje część z tego. */
  escortSaveFactor: 0.28,
  /** Minimalna strata przy udanym przechwycie — coś zawsze przepada. */
  minLossFraction: 0.12,
  /** Koszt utrzymania jednej osłony na sekundę lotu. */
  escortCostPerSecond: 0.45,
  /** Poniżej tylu statków konwój nie ma sensu — to po prostu grupa. */
  minSize: 2
});

export function createConvoyRegistry() {
  return {
    convoys: new Map(),
    /** `courseId` → `convoyId`, żeby nie przemiatać wszystkich grup. */
    byCourse: new Map(),
    nextId: 1,
    stats: { formed: 0, intercepted: 0, shipsLost: 0, shipsSaved: 0 }
  };
}

/**
 * Wiąże kursy w konwój. Zwraca `null`, gdy grupa jest za mała — dwa statki
 * lecące przypadkiem tą samą trasą to jeszcze nie konwój.
 */
export function formConvoy(registry, courses, options = {}) {
  const members = (courses || []).filter(course => course && !registry.byCourse.has(course.id));
  if (members.length < (options.minSize ?? ESCORT_MODEL.minSize)) return null;

  const convoy = {
    id: `konwoj-${registry.nextId++}`,
    courseIds: members.map(course => course.id),
    leaderId: members[0].id,
    /** Siła osłony. Zero = konwój bez eskorty, nadal korzystny przez wspólny rzut. */
    escortPower: Math.max(0, Number(options.escortPower) || 0),
    escortIds: Array.isArray(options.escortIds) ? [...options.escortIds] : [],
    fromId: members[0].originId,
    toId: members[0].destinationId,
    formedAt: Number(options.now) || 0,
    /** Konwój rozwiązuje się przy porcie — dok przyjmuje statki, nie grupy. */
    disbanded: false
  };

  registry.convoys.set(convoy.id, convoy);
  for (const course of members) {
    registry.byCourse.set(course.id, convoy.id);
    course.convoyId = convoy.id;
  }
  registry.stats.formed++;
  return convoy;
}

export function convoyOf(registry, courseId) {
  const id = registry?.byCourse.get(String(courseId));
  return id ? registry.convoys.get(id) || null : null;
}

/** Wypisuje kurs z konwoju — po dolocie, zestrzeleniu albo rozwiązaniu grupy. */
export function detachCourse(registry, courseId) {
  const id = String(courseId);
  const convoyId = registry.byCourse.get(id);
  if (!convoyId) return false;
  registry.byCourse.delete(id);
  const convoy = registry.convoys.get(convoyId);
  if (!convoy) return true;
  const index = convoy.courseIds.indexOf(id);
  if (index >= 0) convoy.courseIds.splice(index, 1);
  if (convoy.leaderId === id) convoy.leaderId = convoy.courseIds[0] || null;
  if (!convoy.courseIds.length) disbandConvoy(registry, convoy);
  return true;
}

export function disbandConvoy(registry, convoy) {
  if (!convoy || convoy.disbanded) return false;
  convoy.disbanded = true;
  for (const courseId of convoy.courseIds) registry.byCourse.delete(courseId);
  convoy.courseIds = [];
  registry.convoys.delete(convoy.id);
  return true;
}

// ============================================================
// Ryzyko
// ============================================================

/**
 * Szansa przechwytu CAŁEGO konwoju.
 *
 * Grupa jest większym i lepiej widocznym celem, więc bazowe ryzyko rośnie —
 * ale rośnie WOLNIEJ niż liczba statków, bo to jeden rzut zamiast wielu.
 * Osłona zbija je dodatkowo.
 */
export function convoyInterceptChance(convoy, soloChance, options = {}) {
  const size = Math.max(1, convoy?.courseIds.length || 1);
  const model = { ...ESCORT_MODEL, ...(options.model || {}) };
  // Widoczność rośnie z pierwiastkiem wielkości: dziesięć statków nie jest
  // dziesięć razy łatwiejsze do znalezienia niż jeden.
  const visibility = Math.sqrt(size);
  const raw = 1 - Math.pow(1 - Math.max(0, Math.min(1, soloChance)), visibility);
  const power = Math.max(0, convoy?.escortPower || 0);
  return raw / (1 + power * model.protectionFactor);
}

/**
 * Rozstrzyga przechwyt konwoju: kto przepada, kto ucieka.
 *
 * Nigdy nie ginie całość — to jest sens konwojowania. Bez osłony traci się
 * ponad połowę składu, każda jednostka eskorty ratuje kolejny kawałek, ale
 * coś zawsze przepada.
 */
export function resolveConvoyInterception(registry, convoy, options = {}) {
  if (!convoy || !convoy.courseIds.length) return { lost: [], survived: [] };
  const model = { ...ESCORT_MODEL, ...(options.model || {}) };
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;

  const power = Math.max(0, convoy.escortPower || 0);
  const fraction = Math.max(
    model.minLossFraction,
    model.baseLossFraction - power * model.escortSaveFactor
  );

  const size = convoy.courseIds.length;
  const lossCount = Math.max(1, Math.min(size, Math.round(size * fraction)));

  // Straty rozkładają się losowo po składzie — nikt nie jest z góry bezpieczny.
  const order = [...convoy.courseIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const lost = order.slice(0, lossCount);
  const survived = order.slice(lossCount);

  registry.stats.intercepted++;
  registry.stats.shipsLost += lost.length;
  registry.stats.shipsSaved += survived.length;
  return { lost, survived, lossFraction: fraction };
}

// ============================================================
// Decyzja: konwojować czy nie
// ============================================================

/** Koszt utrzymania osłony na tej trasie. */
export function escortCost(escortPower, seconds, options = {}) {
  const model = { ...ESCORT_MODEL, ...(options.model || {}) };
  return Math.max(0, escortPower) * Math.max(0, seconds) * model.escortCostPerSecond;
}

/**
 * Czy opłaca się zebrać konwój z osłoną.
 *
 * Porównuje oczekiwaną stratę przy locie solo z oczekiwaną stratą w konwoju
 * plus koszt eskorty. Ta sama arytmetyka, która rozdziela napędy — i tak samo
 * jak tam, wynik zależy od WARTOŚCI ładunku, nie od jego rodzaju.
 */
export function shouldConvoy(options = {}) {
  const size = Math.max(1, Math.floor(options.size) || 1);
  const soloChance = Math.max(0, Math.min(1, Number(options.soloChance) || 0));
  const value = Math.max(0, Number(options.cargoValue) || 0);
  const seconds = Math.max(0, Number(options.seconds) || 0);
  const power = Math.max(0, Number(options.escortPower) || 0);
  const model = { ...ESCORT_MODEL, ...(options.model || {}) };

  if (size < (options.minSize ?? model.minSize)) {
    return { go: false, reason: 'za mała grupa', saved: 0, cost: 0 };
  }

  // Solo: każdy statek ryzykuje osobno, więc strata skaluje się liniowo.
  const lossSolo = soloChance * value * size;

  const grouped = { courseIds: new Array(size).fill('x'), escortPower: power };
  const groupChance = convoyInterceptChance(grouped, soloChance, { model });
  const lossFraction = Math.max(
    model.minLossFraction,
    model.baseLossFraction - power * model.escortSaveFactor
  );
  const lossConvoy = groupChance * value * size * lossFraction;

  const cost = escortCost(power, seconds, { model });
  const saved = lossSolo - lossConvoy;

  return {
    go: saved > cost,
    saved,
    cost,
    lossSolo,
    lossConvoy,
    groupChance,
    lossFraction,
    reason: saved > cost ? 'osłona tańsza niż straty' : 'straty tańsze niż osłona'
  };
}

/** Migawka do panelu: ile grup, jak duże, jak strzeżone. */
export function summarizeConvoys(registry) {
  const convoys = [...registry.convoys.values()];
  const sizes = convoys.map(convoy => convoy.courseIds.length);
  return {
    count: convoys.length,
    ships: sizes.reduce((sum, value) => sum + value, 0),
    largest: sizes.length ? Math.max(...sizes) : 0,
    escorted: convoys.filter(convoy => convoy.escortPower > 0).length,
    stats: { ...registry.stats }
  };
}
