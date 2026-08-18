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
