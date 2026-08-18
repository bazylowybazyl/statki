/**
 * Testy złomiarzy — zbierania wraków ODŁĄCZONEGO od przemysłu.
 *
 * Pilnują tego, co było źle postawione: zbieranie było sklejone z przetopem,
 * więc złom trafiał wyłącznie tam, gdzie stoi linia `recycling` (na Marsa).
 * Wysłanie holownika nie wymaga fabryki — wymaga stanowisk i statków.
 *
 * Drugi błąd, który pilnują: wrak liczony jako sama kupa złomu. Fregata to
 * 38 CR w złomie i 203 CR z podzespołami; nosiciel 589 wobec 9976. Przy
 * pierwszej wersji zbieranie wychodziło nieopłacalne z arytmetyki.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { FACTION } from '../../src/data/factions.js';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import {
  SCRAPPER_MODEL, createScrapperState, assessWreck,
  dispatchScrappers, tickScrappers, summarizeScrappers
} from '../../src/game/traffic/scrapperFleets.js';
import { salvageManifest, wreckValue, createWarState } from '../../src/game/traffic/warDispatcher.js';
import { COURSE_KIND, createCourseRegistry } from '../../src/game/traffic/courseRegistry.js';

export function run() {
  const t = createSuite('scrapperFleets');

  // ----------------------------------------------------------
  t.section('Wrak to nie kupa złomu');

  for (const id of ['frigate', 'destroyer', 'cruiser', 'carrier']) {
    const cut = salvageManifest(id, 'cut');
    const tow = salvageManifest(id, 'tow');
    t.check(`${id}: holowanie warte więcej niż cięcie`, tow.value > cut.value);
    t.check(`${id}: cięcie nie daje podzespołów`, Object.keys(cut.components).length === 0);
    t.check(`${id}: cięcie daje więcej złomu`, cut.scrap > tow.scrap);
  }
  t.check('duży wrak oddaje podzespoły, mały prawie nie',
    Object.keys(salvageManifest('carrier', 'tow').components).length
    > Object.keys(salvageManifest('frigate', 'tow').components).length);
  t.check('wartość wraku to lepsza z dwóch ścieżek',
    wreckValue('carrier') === salvageManifest('carrier', 'tow').value);
  t.check('nieznana klasa nie daje nic', wreckValue('kanonierka') === 0);

  // ----------------------------------------------------------
  t.section('Opłacalność zależy od odległości');

  const blisko = { classId: 'carrier', x: 1000, y: 0 };
  const daleko = { classId: 'carrier', x: 40_000_000, y: 0 };
  const port = { id: 'earth', factionId: FACTION.TERRA_NOVA, x: 0, y: 0 };

  t.check('bliski wrak się opłaca', !!assessWreck(blisko, port));
  t.check('bardzo daleki nie opłaca się nikomu', assessWreck(daleko, port) === null);
  // To, że taki wynik ISTNIEJE, jest treścią: pobojowisko, którego nikt nie
  // sprząta, zostaje na mapie jako łup dla gracza albo dla piratów.
  t.check('mała fregata daleko też odpada',
    assessWreck({ classId: 'frigate', x: 3_000_000, y: 0 }, port) === null);

  const bliskaOcena = assessWreck(blisko, port);
  t.check('ocena mówi którą ścieżką', ['tow', 'cut'].includes(bliskaOcena.mode));
  t.check('ocena niesie manifest', bliskaOcena.manifest.value > 0);
  t.check('ocena niesie zysk na sekundę', Number.isFinite(bliskaOcena.rate));

  // ----------------------------------------------------------
  t.section('Zbiera KAŻDA stacja z flotą, nie tylko ta z piecem');

  const war = createWarState();
  war.wrecks.push({ id: 'w1', classId: 'carrier', x: 2000, y: 0, scrap: 100, claimed: false });

  // Wenus nie ma roli `recycling` — i to jej nie powstrzymuje.
  const venus = { id: 'venus', factionId: FACTION.INNER_CONSORTIUM, x: 0, y: 0 };
  const scrappers = createScrapperState();
  const registry = createCourseRegistry({ keepHistory: false });
  const wyslane = dispatchScrappers(scrappers, { war, stations: [venus], registry });

  t.check('stacja bez przetopu i tak wysyła holownik', wyslane.length === 1);
  t.equal('kurs jest holowniczy', registry.courses[0].kind, COURSE_KIND.TUG);
  t.check('wrak zajęty', war.wrecks[0].claimed);
  t.check('drugi raz nikt po niego nie leci',
    dispatchScrappers(scrappers, { war, stations: [venus], registry }).length === 0);

  // Kryjówki pirackie nie sprzątają cudzych pobojowisk.
  const piraci = { id: 'gniazdo', factionId: FACTION.PIRATES, x: 0, y: 0 };
  const war2 = createWarState();
  war2.wrecks.push({ id: 'w2', classId: 'carrier', x: 2000, y: 0, claimed: false });
  t.check('piraci nie są złomiarzami',
    dispatchScrappers(createScrapperState(), { war: war2, stations: [piraci] }).length === 0);

  // ----------------------------------------------------------
  t.section('Łup trafia do magazynu');

  const econ = {
    resources: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 0])),
    capacity: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 5000]))
  };
  registry.courses[0].status = 'done';
  const zdarzenia = tickScrappers(scrappers, 1, {
    war, stations: [venus], registry, getEconomy: () => econ
  });

  t.check('odzysk odnotowany', zdarzenia.some(e => e.type === 'salvaged'));
  t.check('złom wpadł do magazynu', econ.resources.scrap > 0);
  t.check('podzespoły też', econ.resources.hull_plate > 0);
  t.equal('wrak zniknął z mapy', war.wrecks.length, 0);
  t.check('statystyki się zgadzają', scrappers.stats.recovered === 1);
  t.check('magazyn nie przepełnia się ponad pojemność',
    econ.resources.scrap <= econ.capacity.scrap);

  // ----------------------------------------------------------
  t.section('Przechwycony holownik oddaje wrak z powrotem');

  const war3 = createWarState();
  war3.wrecks.push({ id: 'w3', classId: 'cruiser', x: 3000, y: 0, claimed: false });
  const s3 = createScrapperState();
  const reg3 = createCourseRegistry({ keepHistory: false });
  dispatchScrappers(s3, { war: war3, stations: [venus], registry: reg3 });
  reg3.courses[0].status = 'wrecked';
  tickScrappers(s3, 1, { war: war3, stations: [venus], registry: reg3, getEconomy: () => econ });

  t.equal('wrak nadal leży', war3.wrecks.length, 1);
  // Wrak wraca do puli i zostaje od razu wzięty na nowo — dlatego sprawdzamy
  // PONOWNE wysłanie, nie flagę. Utrata holownika nie kasuje łupu.
  t.equal('ktoś leci po niego znowu', s3.stats.dispatched, 2);
  t.equal('i jest zajęty przez nowy kurs', s3.active.length, 1);
  t.equal('strata odnotowana', s3.stats.lost, 1);
  t.equal('nic nie odzyskano', s3.stats.recovered, 0);

  // ----------------------------------------------------------
  t.section('Limit holowników na stację');

  const war4 = createWarState();
  for (let i = 0; i < 10; i++) {
    war4.wrecks.push({ id: `w${i}`, classId: 'carrier', x: 2000 + i, y: 0, claimed: false });
  }
  const s4 = createScrapperState();
  dispatchScrappers(s4, { war: war4, stations: [venus] });
  t.equal('stacja nie wysyła więcej niż ma holowników',
    s4.active.length, SCRAPPER_MODEL.maxActivePerStation);
  t.check('reszta wraków czeka', war4.wrecks.filter(w => !w.claimed).length > 0);

  const raport = summarizeScrappers(s4);
  t.equal('raport liczy holowniki w polu', raport.active, s4.active.length);

  return t.results;
}

runIfMain(import.meta.url, run);
