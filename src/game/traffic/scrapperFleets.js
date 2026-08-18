/**
 * ZŁOMIARZE — zbieranie wraków ODŁĄCZONE od przemysłu.
 *
 * Zbieranie i przetop to dwie różne zdolności, a wcześniej były sklejone
 * w jeden archetyp: złom trafiał tylko tam, gdzie stała linia `recycling`
 * (czyli wyłącznie na Marsa). To było źle postawione. Wysłanie holownika po
 * wrak nie wymaga fabryki — wymaga stanowisk i statków. **Każda stacja
 * z flotą zbiera.** Przetop zostaje specjalizacją, więc złom zebrany tam,
 * gdzie nie ma pieca, staje się towarem i płynie do tych, którzy piec mają.
 *
 * Dwie ścieżki odzysku, wprost z `src/game/salvage.js`:
 *   CIĘCIE   — szybkie, sam złom, podzespoły przepadają
 *   HOLOWANIE — wolne, podzespoły w całości
 *
 * Wybór między nimi jest rachunkiem, nie ustawieniem. Wrak fregaty wart jest
 * 38 CR pocięty i 203 przyholowany; nosiciel odpowiednio 589 i 9976. Dlatego
 * po mały wrak nikt nie leci daleko, a po duży opłaca się wyprawa przez pół
 * układu — i to samo z siebie rozkłada złomiarzy po mapie.
 */

import { COURSE_KIND, launchCourse, travelStage, dwellStage, DWELL_REASON } from './courseRegistry.js';
import { salvageManifest } from './warDispatcher.js';

export const SCRAPPER_MODEL = Object.freeze({
  /**
   * Koszt dotarcia na jednostkę odległości, w kredytach.
   *
   * Skalibrowane tak, żeby wrak fregaty (203 CR) opłacał się z ~300 tys.
   * jednostek, a nosiciel (9976 CR) z odległości kilkunastu razy większej.
   * To jest liczba, która decyduje, czy pobojowisko sprząta się samo, czy
   * zostaje na mapie jako pole do zebrania przez gracza.
   */
  costPerUnit: 0.00068,
  /** Poniżej tego zysku nikt nie rusza silników. */
  minProfit: 40,
  /** Ile holowników naraz może mieć jedna stacja w polu. */
  maxActivePerStation: 4,
  /** Ile trwa samo cięcie wraku na miejscu. */
  cutSeconds: 260,
  /** Ile trwa zaczepienie i przygotowanie do holu — hol jest wolniejszy. */
  hookSeconds: 420,
  /** O ile wolniej leci się z wrakiem na haku. */
  towSpeedPenalty: 2.2,
  /**
   * Masa wraku, przy której hol kosztuje dwa razy tyle co pusty przelot.
   *
   * Bez tego składnika ciągnięcie nosiciela kosztuje tyle samo co fregaty
   * i holowanie wygrywa ZAWSZE — zmierzone: 112 wraków, 112 holem, zero
   * cięciem. Masa jest tym, co odróżnia obie ścieżki fizycznie.
   */
  towMassScale: 300,
  /** Prędkość przelotowa holownika (jedn./s) — wolniejszy niż frachtowiec. */
  cruiseSpeed: 900
});

export function createScrapperState(options = {}) {
  return {
    config: { ...SCRAPPER_MODEL, ...(options.config || {}) },
    /** Kursy w polu: { courseId, stationId, wreckId, mode, manifest }. */
    active: [],
    stats: {
      dispatched: 0, recovered: 0, lost: 0,
      cut: 0, towed: 0, scrap: 0, value: 0, components: {}
    }
  };
}

function distance(ax, ay, bx, by) {
  return Math.hypot((bx || 0) - (ax || 0), (by || 0) - (ay || 0));
}

/**
 * Czy i jak opłaca się zabrać ten wrak z tej stacji.
 *
 * Zwraca `null`, gdy nie opłaca się wcale — i to jest ważne, że taki wynik
 * w ogóle istnieje. Wrak, po którego nikt nie leci, zostaje na mapie i jest
 * łupem dla gracza albo dla piratów.
 */
export function assessWreck(wreck, station, config = SCRAPPER_MODEL) {
  const dist = distance(station.x, station.y, wreck.x, wreck.y);
  const cut = salvageManifest(wreck.classId, 'cut');
  const tow = salvageManifest(wreck.classId, 'tow');
  const lot = dist / config.cruiseSpeed;

  // Cięcie: lecisz i wracasz pusty. Hol: wracasz wolniej I ciężej.
  const cutCost = dist * 2 * config.costPerUnit;
  // Składniki DODAJĄ się, nie mnożą: wolniej to jedno, ciężej to drugie.
  // Mnożone dawały nosicielowi mnożnik 10,5 i żaden wrak nie opłacał się
  // nikomu — 129 sztuk na mapie, jedna wyprawa, zero odzysku.
  const towCost = dist * config.costPerUnit
    * (1 + config.towSpeedPenalty + tow.mass / config.towMassScale);

  const cutTime = lot * 2 + config.cutSeconds;
  const towTime = lot * (1 + config.towSpeedPenalty) + config.hookSeconds;

  const cutProfit = cut.value - cutCost;
  const towProfit = tow.value - towCost;
  if (cutProfit < config.minProfit && towProfit < config.minProfit) return null;

  // O wyborze decyduje zysk NA GODZINĘ HOLOWNIKA, nie na kurs — holowników
  // jest skończenie wielu, więc zajęcie jednego na długo ma koszt alternatywny.
  //
  // ZMIERZONE: przy tych liczbach hol wygrywa ZAWSZE i cięcie nie ma niszy.
  // Różnica wartości między ścieżkami (5x na fregacie, 17x na nosicielu) jest
  // większa niż jakakolwiek różnica kosztu i czasu; sprawdzone dla mnożnika
  // masy 120, 300 i 600 — za każdym razem zero cięć. To nie jest usterka
  // strojenia: dla FLOTY cięcie jest zdominowane i tak ma być. Cięcie to
  // opcja GRACZA, który stoi w ogniu i nie ma czym holować — dokładnie ten
  // przypadek modeluje `src/game/salvage.js`. Gdyby cięcie miało kiedyś
  // wygrywać u AI, musi dojść presja czasu: wrak psujący się albo zabierany
  // przez kogoś innego.
  const cutRate = cutProfit >= config.minProfit ? cutProfit / cutTime : -Infinity;
  const towRate = towProfit >= config.minProfit ? towProfit / towTime : -Infinity;

  return towRate >= cutRate
    ? { mode: 'tow', manifest: tow, profit: towProfit, rate: towRate, distance: dist }
    : { mode: 'cut', manifest: cut, profit: cutProfit, rate: cutRate, distance: dist };
}

/**
 * Wysyła holowniki do wraków.
 *
 * Wrak dostaje ten port, któremu opłaca się NAJBARDZIEJ — nie najbliższy.
 * Różnica wychodzi przy dużych wrakach: nosiciela opłaca się ściągnąć do
 * odległej stacji, jeśli tylko dowiezie się go w całości.
 */
export function dispatchScrappers(scrappers, options = {}) {
  const { war, stations, registry } = options;
  if (!war?.wrecks?.length || !stations?.length) return [];
  const config = scrappers.config;
  const events = [];

  const wPolu = new Map();
  for (const job of scrappers.active) {
    wPolu.set(job.stationId, (wPolu.get(job.stationId) || 0) + 1);
  }

  for (const wreck of war.wrecks) {
    if (wreck.claimed) continue;

    let best = null;
    for (const station of stations) {
      // Kryjówki pirackie sprzątają po sobie same — nie wchodzą tu, bo
      // ich gospodarka to osobna sprawa (łup, nie przemysł).
      if (!station.factionId || station.factionId === 'pirates') continue;
      if ((wPolu.get(station.id) || 0) >= config.maxActivePerStation) continue;

      const ocena = assessWreck(wreck, station, config);
      if (!ocena) continue;
      if (!best || ocena.rate > best.ocena.rate) best = { station, ocena };
    }
    if (!best) continue;

    const { station, ocena } = best;
    const praca = ocena.mode === 'cut' ? config.cutSeconds : config.hookSeconds;
    const lot = ocena.distance / config.cruiseSpeed;
    const powrot = ocena.mode === 'tow' ? lot * config.towSpeedPenalty : lot;

    const course = registry ? launchCourse(registry, {
      kind: COURSE_KIND.TUG,
      factionId: station.factionId,
      originId: station.id,
      destinationId: station.id,
      unitClass: 'tug',
      stages: [
        travelStage(station.id, wreck.id, {
          seconds: lot, distance: ocena.distance,
          fromPos: { x: station.x, y: station.y }, toPos: { x: wreck.x, y: wreck.y }
        }),
        dwellStage(wreck.id, praca, DWELL_REASON.SERVICE, { x: wreck.x, y: wreck.y }),
        travelStage(wreck.id, station.id, {
          seconds: powrot, distance: ocena.distance,
          fromPos: { x: wreck.x, y: wreck.y }, toPos: { x: station.x, y: station.y }
        })
      ],
      fuelCapacity: 0
    }) : null;
    if (registry && !course) continue;

    wreck.claimed = true;
    wPolu.set(station.id, (wPolu.get(station.id) || 0) + 1);
    scrappers.active.push({
      courseId: course?.id || `hol-${scrappers.stats.dispatched}`,
      stationId: station.id,
      wreckId: wreck.id,
      mode: ocena.mode,
      manifest: ocena.manifest
    });
    scrappers.stats.dispatched++;
    events.push({ type: 'scrapper', stationId: station.id, wreckId: wreck.id, mode: ocena.mode });
  }
  return events;
}

/**
 * Jeden krok złomiarzy: rozliczenie tych, którzy wrócili, i wysłanie nowych.
 *
 * `options`: { war, stations, registry, getEconomy }
 */
export function tickScrappers(scrappers, dt, options = {}) {
  const { war, registry, getEconomy } = options;
  const events = [];

  for (let i = scrappers.active.length - 1; i >= 0; i--) {
    const job = scrappers.active[i];
    const course = registry?.byId?.get?.(job.courseId)
      || registry?.courses?.find(c => c.id === job.courseId);
    if (course && course.status === 'active') continue;

    scrappers.active.splice(i, 1);
    const wreckIndex = war?.wrecks?.findIndex(w => w.id === job.wreckId) ?? -1;

    // Holownik przechwycony po drodze — wrak zostaje na mapie i wraca do puli.
    if (course && course.status !== 'done') {
      if (wreckIndex >= 0) war.wrecks[wreckIndex].claimed = false;
      scrappers.stats.lost++;
      events.push({ type: 'scrapper-lost', stationId: job.stationId, wreckId: job.wreckId });
      continue;
    }

    if (wreckIndex >= 0) war.wrecks.splice(wreckIndex, 1);

    const econ = typeof getEconomy === 'function' ? getEconomy(job.stationId) : null;
    if (econ?.resources) {
      const cap = id => Number(econ.capacity?.[id]) || 0;
      const wsyp = (id, amount) => {
        const teraz = Number(econ.resources[id]) || 0;
        econ.resources[id] = cap(id) > 0 ? Math.min(cap(id), teraz + amount) : teraz + amount;
      };
      wsyp('scrap', job.manifest.scrap);
      for (const [id, qty] of Object.entries(job.manifest.components)) wsyp(id, qty);
    }

    scrappers.stats.recovered++;
    scrappers.stats.scrap += job.manifest.scrap;
    scrappers.stats.value += job.manifest.value;
    if (job.mode === 'cut') scrappers.stats.cut++; else scrappers.stats.towed++;
    for (const [id, qty] of Object.entries(job.manifest.components)) {
      scrappers.stats.components[id] = (scrappers.stats.components[id] || 0) + qty;
    }
    events.push({
      type: 'salvaged', stationId: job.stationId, mode: job.mode,
      scrap: job.manifest.scrap, value: job.manifest.value
    });
  }

  events.push(...dispatchScrappers(scrappers, options));
  return events;
}

export function summarizeScrappers(scrappers) {
  return {
    active: scrappers.active.length,
    stats: { ...scrappers.stats, components: { ...scrappers.stats.components } }
  };
}
