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

import {
  COURSE_KIND, launchCourse, travelStage, dwellStage, DWELL_REASON, getCourse
} from './courseRegistry.js';
import { salvageManifest } from './warDispatcher.js';
import { putStock } from './marketBook.js';

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
  cruiseSpeed: 900,
  /**
   * Wraki GRY (E24, `wreck-report`): tyle holowników ponad `maxActivePerStation` stacja wysyła tylko po nie —
   * wrak po bitwie gracza nie czeka, aż wrócą holowniki z pobojowisk wojen w tle. Bez wraków gry nic się nie zmienia.
   */
  gameReserve: 2,
  /** Wrak gry bez lotu po niego przez tyle sekund świata wypada z rejestru (gra trzyma go dalej jako łup gracza). */
  gameWreckTtl: 3600,
  /** Najwyżej tyle wraków gry naraz w rejestrze — kolejne zgłoszenia przepadają. */
  maxGameWrecks: 64
});

export function createScrapperState(options = {}) {
  return {
    config: { ...SCRAPPER_MODEL, ...(options.config || {}) },
    /** Kursy w polu: { courseId, stationId, wreckId, mode, manifest, gid, taken }. */
    active: [],
    stats: {
      dispatched: 0, recovered: 0, lost: 0,
      cut: 0, towed: 0, scrap: 0, value: 0, components: {},
      /** Wraki gry (E24): zgłoszone, związane ze stratą garnizonu, zabrane przez gracza przed złomiarzem, przeterminowane. */
      gameReported: 0, gameLinked: 0, gameGone: 0, gameExpired: 0
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
  // Wrak gry (E24) niesie własne manifesty (ułamek kadłuba klasy); odłam i cywil — bez holu, sam złom.
  const own = wreck.salvage;
  const cut = own ? own.cut : salvageManifest(wreck.classId, 'cut');
  const tow = own ? own.tow : salvageManifest(wreck.classId, 'tow');
  const lot = dist / config.cruiseSpeed;

  // Cięcie: lecisz i wracasz pusty. Hol: wracasz wolniej I ciężej.
  const cutCost = dist * 2 * config.costPerUnit;
  // Składniki DODAJĄ się, nie mnożą: wolniej to jedno, ciężej to drugie.
  // Mnożone dawały nosicielowi mnożnik 10,5 i żaden wrak nie opłacał się
  // nikomu — 129 sztuk na mapie, jedna wyprawa, zero odzysku.
  const towCost = tow ? dist * config.costPerUnit
    * (1 + config.towSpeedPenalty + tow.mass / config.towMassScale) : Infinity;

  const cutTime = lot * 2 + config.cutSeconds;
  const towTime = lot * (1 + config.towSpeedPenalty) + config.hookSeconds;

  const cutProfit = cut.value - cutCost;
  const towProfit = tow ? tow.value - towCost : -Infinity;
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
    if (wreck.claimed || wreck.gone) continue;
    // Wrak gry (E24) ma holowniki rezerwy stacji ponad zwykły limit.
    const cap = config.maxActivePerStation + (wreck.game != null ? config.gameReserve : 0);

    let best = null;
    for (const station of stations) {
      // Kryjówki pirackie sprzątają po sobie same — nie wchodzą tu, bo
      // ich gospodarka to osobna sprawa (łup, nie przemysł).
      if (!station.factionId || station.factionId === 'pirates') continue;
      if ((wPolu.get(station.id) || 0) >= cap) continue;

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
      manifest: ocena.manifest,
      /** Wrak gry (E24): id po stronie gry i czy gra wie już, że praca się skończyła (`collectSalvageTaken`). */
      gid: wreck.game ?? null,
      taken: false
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
    const course = getCourse(registry, job.courseId);
    if (course && course.status === 'active') continue;

    scrappers.active.splice(i, 1);
    const wreckIndex = war?.wrecks?.findIndex(w => w.id === job.wreckId) ?? -1;
    const wreck = wreckIndex >= 0 ? war.wrecks[wreckIndex] : null;

    // Holownik przechwycony po drodze — wrak zostaje na mapie i wraca do puli
    // (wrak gry, który w tym czasie zabrał gracz, wypada z rejestru).
    if (course && course.status !== 'done') {
      if (wreck?.gone) dropWreckAt(war, wreckIndex);
      else if (wreck) wreck.claimed = false;
      scrappers.stats.lost++;
      events.push({ type: 'scrapper-lost', stationId: job.stationId, wreckId: job.wreckId });
      continue;
    }

    if (wreckIndex >= 0) dropWreckAt(war, wreckIndex);
    // Kurs zamknął się w tym kroku, zanim bańka zgłosiła koniec pracy — gra dowie się w `collectSalvageTaken`.
    if (job.gid != null && !job.taken) {
      job.taken = true;
      (scrappers.takenLate || (scrappers.takenLate = [])).push({ gid: job.gid, mode: job.mode, course: job.courseId });
    }
    // Wrak gry zabrał gracz, zanim złomiarz skończył — holownik wraca pusty.
    if (wreck?.gone) {
      events.push({ type: 'salvage-empty', stationId: job.stationId, wreckId: job.wreckId });
      continue;
    }

    const econ = typeof getEconomy === 'function' ? getEconomy(job.stationId) : null;
    if (econ?.resources) {
      putStock(econ, 'scrap', job.manifest.scrap);
      for (const [id, qty] of Object.entries(job.manifest.components)) putStock(econ, id, qty);
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

  if (war?.gameWrecks) expireGameWrecks(scrappers, war, registry?.clock);
  events.push(...dispatchScrappers(scrappers, options));
  return events;
}

// ============================================================
// Wraki GRY (E24): bitwy gracza w bańce → rejestr złomiarzy
// ============================================================

function dropWreckAt(war, index) {
  const wreck = war.wrecks[index];
  war.wrecks.splice(index, 1);
  if (wreck?.game != null) war.gameWrecks?.delete(wreck.game);
}

function gameWreckState(war) {
  if (!war.gameWrecks) {
    /** gid → wpis `war.wrecks`; `gameWreckLinks`: źródło ('course:N', 'entity:N') → zgłoszenie czekające na stratę garnizonu. */
    war.gameWrecks = new Map();
    war.gameWreckLinks = new Map();
    war.nextGameWreckId = 1;
  }
  return war;
}

function scaledManifest(manifest, k) {
  if (!(k < 1)) return manifest;
  const components = {};
  for (const [id, qty] of Object.entries(manifest.components)) {
    const n = Math.floor(qty * k);
    if (n > 0) components[id] = n;
  }
  return Object.freeze({
    scrap: manifest.scrap * k, components: Object.freeze(components),
    value: manifest.value * k, mass: manifest.mass * k
  });
}

/**
 * Manifesty wraku gry: ułamek `scale` kadłuba klasy; bez holu (`towable: false` — odłam, cywil) podzespoły przepadają,
 * hol nie wchodzi w rachunek i wrak się tnie (o ile cięcie się opłaca — `assessWreck`).
 */
export function gameWreckSalvage(classId, scale = 1, towable = true) {
  const k = Math.min(1, Math.max(0.02, Number(scale) || 0));
  const cut = scaledManifest(salvageManifest(classId, 'cut'), k);
  return { cut, tow: towable ? scaledManifest(salvageManifest(classId, 'tow'), k) : null };
}

function gameWreckRecord(war, spec, x, y, now) {
  const classId = String(spec.classId || 'frigate');
  const salvage = gameWreckSalvage(classId, spec.scale, spec.towable !== false);
  return {
    id: `wrak-g${war.nextGameWreckId++}`,
    classId, factionId: spec.factionId || null,
    scrap: salvage.cut.scrap,
    value: Math.max(salvage.cut.value, salvage.tow?.value || 0),
    x, y,
    claimed: false,
    game: spec.gid,
    salvage,
    reportedAt: Number(now) || 0
  };
}

/**
 * Zgłoszenia wraków gry (`wreck-report`). Wrak okrętu garnizonu albo zapasu floty (`source`, dla którego
 * `options.isLossSource` mówi „strata zapasu”) wiąże się ze stratą — `settleGarrisonLosses` stawia wrak rejestru
 * w miejscu wraku gry (`takeGameWreckLink`), bez drugiego. Reszta to nowe wpisy NA POCZĄTKU `war.wrecks` (złomiarze
 * oceniają je pierwsze). Zwraca liczbę nowych wpisów.
 */
export function reportGameWrecks(scrappers, war, list, options = {}) {
  if (!war || !Array.isArray(list)) return 0;
  gameWreckState(war);
  const config = scrappers?.config || SCRAPPER_MODEL;
  let added = 0;
  for (const spec of list) {
    const gid = spec?.gid;
    const x = Number(spec?.x);
    const y = Number(spec?.y);
    if (gid == null || !Number.isFinite(x) || !Number.isFinite(y) || war.gameWrecks.has(gid)) continue;
    const source = spec.source ? String(spec.source) : null;
    if (source) {
      const linked = war.wrecks.find(w => w.source === source && w.game == null);
      if (linked) {
        bindGameWreck(war, linked, { gid, x, y }, scrappers);
        continue;
      }
      if (typeof options.isLossSource === 'function' && options.isLossSource(source)) {
        war.gameWreckLinks.set(source, { gid, x, y, classId: spec.classId, at: Number(options.now) || 0 });
        continue;
      }
    }
    if (war.gameWrecks.size >= config.maxGameWrecks) continue;
    const wreck = gameWreckRecord(war, { ...spec, gid }, x, y, options.now);
    war.wrecks.unshift(wreck);
    war.gameWrecks.set(gid, wreck);
    if (scrappers) scrappers.stats.gameReported++;
    added++;
  }
  return added;
}

/**
 * Wpis rejestru dostał wrak gry (strata garnizonu ze zgłoszeniem): id gry i jego miejsce. Strata rozliczona PO
 * zgłoszeniu wiąże się w `settleGarrisonLosses` (`warDispatcher.js`, `war.gameWreckLinks`).
 */
export function bindGameWreck(war, wreck, link, scrappers = null) {
  if (!war || !wreck || !link) return;
  gameWreckState(war);
  wreck.game = link.gid;
  wreck.x = link.x;
  wreck.y = link.y;
  war.gameWrecks.set(link.gid, wreck);
  if (scrappers) scrappers.stats.gameLinked++;
}

/** Wrak gry przepadł albo zabrał go gracz (`wreck-gone`): bez holownika — z rejestru, z holownikiem — wraca pusty. */
export function forgetGameWrecks(scrappers, war, gids) {
  if (!war?.gameWrecks || !Array.isArray(gids)) return 0;
  let n = 0;
  for (const gid of gids) {
    for (const [key, link] of war.gameWreckLinks) if (link.gid === gid) war.gameWreckLinks.delete(key);
    const wreck = war.gameWrecks.get(gid);
    if (!wreck) continue;
    n++;
    if (scrappers) scrappers.stats.gameGone++;
    if (wreck.claimed) {
      wreck.gone = true;
      continue;
    }
    const index = war.wrecks.indexOf(wreck);
    if (index >= 0) dropWreckAt(war, index);
    else war.gameWrecks.delete(gid);
  }
  return n;
}

/** Niechciane wraki gry wypadają z rejestru po `gameWreckTtl` (gra trzyma je dalej jako łup gracza). */
function expireGameWrecks(scrappers, war, now) {
  if (!Number.isFinite(now)) return;
  const config = scrappers.config;
  for (const wreck of war.gameWrecks.values()) {
    if (wreck.claimed || !(now - (wreck.reportedAt || 0) > config.gameWreckTtl)) continue;
    const index = war.wrecks.indexOf(wreck);
    if (index >= 0) dropWreckAt(war, index);
    else war.gameWrecks.delete(wreck.game);
    scrappers.stats.gameExpired++;
  }
  // Zgłoszenie bez straty garnizonu w minutę (okręt jednak nie był z zapasu) — zwykły wrak gry.
  for (const [source, link] of war.gameWreckLinks) {
    if (!(now - link.at > 60)) continue;
    war.gameWreckLinks.delete(source);
    if (war.gameWrecks.has(link.gid) || war.gameWrecks.size >= config.maxGameWrecks) continue;
    const wreck = gameWreckRecord(war, { gid: link.gid, classId: link.classId }, link.x, link.y, now);
    war.wrecks.unshift(wreck);
    war.gameWrecks.set(link.gid, wreck);
    scrappers.stats.gameReported++;
  }
}

/**
 * Złomiarze, którzy skończyli postój przy wraku gry (cięcie gotowe albo wrak na haku) — gra usuwa wrak
 * (`salvage-taken`). Każda praca raz. `workStage` — indeks etapu postoju przy wraku w kursie TUG (1).
 */
export function collectSalvageTaken(scrappers, registry, workStage = 1) {
  let out = null;
  if (scrappers?.takenLate?.length) out = scrappers.takenLate.splice(0);
  for (const job of scrappers?.active || []) {
    if (job.gid == null || job.taken) continue;
    const course = getCourse(registry, job.courseId);
    if (!course) continue;
    const done = course.status === 'done' || (course.status === 'active' && course.stageIndex > workStage);
    if (!done) continue;
    job.taken = true;
    (out || (out = [])).push({ gid: job.gid, mode: job.mode, course: job.courseId });
  }
  return out;
}

/** Praca złomiarza po id kursu (rekord `works` bańki). */
export function scrapperJobFor(scrappers, courseId) {
  for (const job of scrappers?.active || []) if (job.courseId === courseId) return job;
  return null;
}

export function summarizeScrappers(scrappers) {
  return {
    active: scrappers.active.length,
    stats: { ...scrappers.stats, components: { ...scrappers.stats.components } }
  };
}
