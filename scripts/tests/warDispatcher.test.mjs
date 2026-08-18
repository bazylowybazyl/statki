/**
 * Testy dyspozytora wojennego.
 *
 * Pilnują trzech rzeczy, z których każda była realnym błędem w tej sesji:
 *   • kampania musi POWSTAĆ (odcinki trasy mają inny kształt niż etapy kursu
 *     i `launchCourse` odrzucał każdą wyprawę po cichu)
 *   • bitwa musi KOSZTOWAĆ obie strony (bez garnizonu kryjówek atakujący
 *     wygrywał 10 na 10 i nie ginął ani jeden broniący się kadłub)
 *   • wrak musi dawać ZŁOM proporcjonalny do masy, bo to jedyne jego źródło
 */

import { createSuite, runIfMain } from './harness.mjs';
import { FACTION } from '../../src/data/factions.js';
import {
  WAR_MODEL, createWarState, tickWar, resolveBattle, scrapFromWreck,
  defenseAt, pickTarget, isRaiderNest, summarizeWar
} from '../../src/game/traffic/warDispatcher.js';
import {
  createShipyardRegistry, addShips, fleetPower, WARSHIP_CLASSES
} from '../../src/game/traffic/shipyards.js';
import { COURSE_KIND, createCourseRegistry } from '../../src/game/traffic/courseRegistry.js';

const stacje = () => ([
  { id: 'earth', factionId: FACTION.TERRA_NOVA, x: 0, y: 0 },
  { id: 'mars', factionId: FACTION.MARS, x: 5000, y: 0 },
  { id: 'gniazdo', factionId: FACTION.PIRATES, x: 20000, y: 0 }
]);

export function run() {
  const t = createSuite('warDispatcher');

  // ----------------------------------------------------------
  t.section('Złom z wraku');

  for (const id of Object.keys(WARSHIP_CLASSES)) {
    t.check(`${id} zostawia złom`, scrapFromWreck(id) > 0);
  }
  t.check('większy kadłub daje więcej złomu',
    scrapFromWreck('carrier') > scrapFromWreck('cruiser')
    && scrapFromWreck('cruiser') > scrapFromWreck('destroyer')
    && scrapFromWreck('destroyer') > scrapFromWreck('frigate'));
  t.check('nieznana klasa nie daje nic', scrapFromWreck('kanonierka') === 0);
  // Odzysk jest CZĘŚCIOWY — wrak to nie zwrot kosztów, tylko resztka.
  t.check('odzysk jest częściowy', WAR_MODEL.scrapRecovery > 0 && WAR_MODEL.scrapRecovery < 1);

  // ----------------------------------------------------------
  t.section('Kto się broni czym');

  const yards = createShipyardRegistry();
  addShips(yards, FACTION.TERRA_NOVA, 'frigate', 60);
  const st = stacje();
  const war = createWarState();

  t.check('kryjówka jest rozpoznana', isRaiderNest(st[2]));
  t.check('port planetarny nie jest kryjówką', !isRaiderNest(st[0]));
  t.check('frakcja broni się zapasem stoczni', defenseAt(yards, st, 'earth', war) > 0);
  t.equal('kryjówka bez garnizonu jest bezbronna', defenseAt(yards, st, 'gniazdo', war), 0);

  war.garrisons.set('gniazdo', 40);
  t.equal('garnizon zastępuje zapas stoczni', defenseAt(yards, st, 'gniazdo', war), 40);

  // ----------------------------------------------------------
  t.section('Kogo się atakuje');

  // Sojusznik nie jest celem, choćby był najsłabszy — to jest ta reguła, przez
  // którą świat bez pirackich baz nie miał żadnej wojny.
  const cel = pickTarget(war, yards, st, FACTION.TERRA_NOVA, 100);
  t.check('celem jest wróg', !!cel && cel.station.id === 'gniazdo');
  t.check('sojusznik nie jest celem', cel.station.factionId === FACTION.PIRATES);

  t.check('bez przewagi nie ma wyprawy',
    pickTarget(war, yards, st, FACTION.TERRA_NOVA, 10) === null);

  const zajety = createWarState();
  zajety.garrisons.set('gniazdo', 40);
  zajety.campaigns.push({ targetId: 'gniazdo' });
  t.check('jeden cel nie dostaje dwóch wypraw naraz',
    pickTarget(zajety, yards, st, FACTION.TERRA_NOVA, 100) === null);

  // ----------------------------------------------------------
  t.section('Bitwa kosztuje obie strony');

  const mocny = resolveBattle({ frigate: 50 }, 100, 20, () => 0.1);
  t.check('przewaga wygrywa', mocny.attackerWins);
  t.check('ale wygrany też traci', mocny.attackerLossRatio > 0);
  t.check('przegrany traci więcej', mocny.defenderLossRatio > mocny.attackerLossRatio);

  const slaby = resolveBattle({ frigate: 5 }, 10, 100, () => 0.99);
  t.check('słabszy przegrywa', !slaby.attackerWins);
  t.check('i płaci za to', slaby.attackerLossRatio > 0.2);

  t.check('straty nigdy nie są zerowe',
    resolveBattle({ frigate: 1 }, 1000, 1, () => 0).attackerLossRatio >= 0.05);
  t.check('pusta bitwa nie wybucha',
    resolveBattle({}, 0, 0).attackerLossRatio === 0);

  // ----------------------------------------------------------
  t.section('Pełny cykl: wyprawa → bitwa → wraki');

  const yards2 = createShipyardRegistry();
  // Flota musi przebić garnizon kryjówki razy wymagana przewaga, inaczej
  // dyspozytor słusznie zostaje w domu — patrz próg w `pickTarget`.
  addShips(yards2, FACTION.TERRA_NOVA, 'frigate', 200);
  addShips(yards2, FACTION.TERRA_NOVA, 'cruiser', 20);
  const registry = createCourseRegistry({ keepHistory: false });
  const st2 = stacje();
  const war2 = createWarState();
  const silaPrzed = fleetPower(yards2, FACTION.TERRA_NOVA);

  const start = tickWar(war2, WAR_MODEL.decisionSeconds + 1,
    { shipyards: yards2, stations: st2, registry });
  t.check('wyprawa wyruszyła', start.some(e => e.type === 'campaign'));
  t.check('kurs powstał w rejestrze', registry.courses.length > 0);
  t.equal('i jest kursem wojennym', registry.courses[0].kind, COURSE_KIND.WAR);
  t.check('zapas frakcji zmalał', fleetPower(yards2, FACTION.TERRA_NOVA) < silaPrzed);
  t.check('garnizon kryjówki odrósł', (war2.garrisons.get('gniazdo') || 0) > 0);

  // Kurs kończy się — rozstrzygamy starcie.
  registry.courses[0].status = 'done';
  const bitwa = tickWar(war2, 1, { shipyards: yards2, stations: st2, registry, rng: () => 0.1 });
  t.check('doszło do bitwy', bitwa.some(e => e.type === 'battle'));
  t.check('są wraki', war2.wrecks.length > 0);
  t.check('wraki niosą złom', war2.wrecks.every(w => w.scrap > 0));
  t.check('wraki NIE leżą w jednym punkcie',
    new Set(war2.wrecks.map(w => Math.round(w.x))).size > 1
    || war2.wrecks.length === 1);
  t.check('obrońca też stracił', war2.garrisons.get('gniazdo') < WAR_MODEL.raiderGarrison);
  t.check('ocalali wrócili do zapasu', fleetPower(yards2, FACTION.TERRA_NOVA) > 0);
  t.check('statystyki się zgadzają', war2.stats.battles === 1 && war2.stats.shipsLost > 0);

  const raport = summarizeWar(war2);
  t.check('raport liczy złom czekający na złomiarzy', raport.scrapWaiting > 0);
  t.equal('raport liczy wraki', raport.wrecks, war2.wrecks.length);

  // ----------------------------------------------------------
  t.section('Wyprawa rozbita w drodze też zostawia wraki');

  // Flota stracona przed bitwą jest stracona tak samo — to jest ta
  // konsekwencja, o którą chodziło w „wszystko co lata ma powód ekonomiczny".
  const yards3 = createShipyardRegistry();
  addShips(yards3, FACTION.TERRA_NOVA, 'frigate', 250);
  const reg3 = createCourseRegistry({ keepHistory: false });
  const war3 = createWarState();
  tickWar(war3, WAR_MODEL.decisionSeconds + 1,
    { shipyards: yards3, stations: stacje(), registry: reg3 });
  reg3.courses[0].status = 'wrecked';
  const strata = tickWar(war3, 1, { shipyards: yards3, stations: stacje(), registry: reg3 });
  t.check('przechwycona wyprawa jest odnotowana', strata.some(e => e.type === 'campaign-lost'));
  t.check('i zostawia złom', war3.wrecks.length > 0);
  t.equal('nie doszło do bitwy', war3.stats.battles, 0);

  return t.results;
}

runIfMain(import.meta.url, run);
