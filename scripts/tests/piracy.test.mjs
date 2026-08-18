/**
 * Testy piractwa jako GOSPODARKI.
 *
 * Wcześniej przechwyt był czystym rzutem kostką: kurs znikał, ładunek parował,
 * a piractwa nie dało się zwalczać, bo nie było czego. Te testy pilnują pętli,
 * która to zastąpiła — i każdego miejsca, w którym da się ją przeciąć.
 *
 *   łup → paser → przemytnik → kredyty → rejd → większe ryzyko na szlaku
 *                     ↑ kontrola             ↑ łowca nagród
 */

import { createSuite, runIfMain } from './harness.mjs';
import { FACTION } from '../../src/data/factions.js';
import { RESOURCE_KEYS, RESOURCES } from '../../src/data/resources.js';
import {
  PIRACY_MODEL, createPiracyState, registerNest, depositLoot, nestLootValue,
  laneThreat, tickPiracy, recordPirateLoss, summarizePiracy
} from '../../src/game/traffic/piracy.js';
import { COURSE_KIND, createCourseRegistry } from '../../src/game/traffic/courseRegistry.js';

const stacje = () => ([
  { id: 'earth', factionId: FACTION.TERRA_NOVA, x: 0, y: 0 },
  { id: 'mars', factionId: FACTION.MARS, x: 500000, y: 0 },
  { id: 'gniazdo', factionId: FACTION.PIRATES, x: 2000000, y: 0 }
]);

/** Stały rng zwracałby ten sam port jako start i cel — rejd by nie wypłynął. */
const naprzemienny = () => { let i = 0; return () => [0.1, 0.9][i++ % 2]; };

const kurs = (resourceId, units, value) => ({
  factionId: FACTION.TERRA_NOVA,
  payload: { resourceId, units, value }
});

export function run() {
  const t = createSuite('piracy');

  // ----------------------------------------------------------
  t.section('Łup ląduje w kryjówce, a nie w próżni');

  const piracy = createPiracyState();
  registerNest(piracy, { stationId: 'gniazdo', x: 2000000, y: 0 });
  registerNest(piracy, { stationId: 'daleka', x: 90000000, y: 0 });

  const lup = depositLoot(piracy, kurs('steel', 100, 5000), 2000100, 0);
  t.check('łup gdzieś trafił', !!lup);
  t.equal('do NAJBLIŻSZEJ kryjówki', lup.nestId, 'gniazdo');
  t.check('nie cały — część idzie z dymem', lup.units < 100);
  t.check('ale znaczna część zostaje', lup.units > 40);
  t.check('kryjówka ma towar', piracy.nests.get('gniazdo').loot.steel > 0);
  t.check('paser wycenia poniżej rynku',
    nestLootValue(piracy.nests.get('gniazdo'))
    < RESOURCES.steel.value * piracy.nests.get('gniazdo').loot.steel);

  t.check('kurs bez ładunku nic nie daje',
    depositLoot(piracy, { payload: {} }, 0, 0) === null);
  t.check('bez kryjówek nie ma gdzie odłożyć',
    depositLoot(createPiracyState(), kurs('steel', 10, 100), 0, 0) === null);

  // ----------------------------------------------------------
  t.section('Rejder podnosi ryzyko na SWOIM szlaku');

  const p2 = createPiracyState();
  t.equal('bez rejdów szlak jest czysty', laneThreat(p2, 'earth', 'mars'), 1);
  p2.raids.push({ courseId: 'r1', nestId: 'gniazdo', fromId: 'earth', toId: 'mars' });
  t.check('z rejderem gorzej', laneThreat(p2, 'earth', 'mars') > 1);
  t.check('działa w obie strony', laneThreat(p2, 'mars', 'earth') > 1);
  t.equal('inny szlak bez zmian', laneThreat(p2, 'earth', 'venus'), 1);
  p2.raids.push({ courseId: 'r2', nestId: 'gniazdo', fromId: 'earth', toId: 'mars' });
  t.check('dwa rejdery gorzej niż jeden',
    laneThreat(p2, 'earth', 'mars') > PIRACY_MODEL.raidThreatMultiplier);

  // ----------------------------------------------------------
  t.section('Kryjówka wysyła rejd tylko za pieniądze');

  const p3 = createPiracyState();
  const nest = registerNest(p3, { stationId: 'gniazdo', x: 0, y: 0 });
  const reg3 = createCourseRegistry({ keepHistory: false });
  const opts3 = { stations: stacje(), registry: reg3, rng: naprzemienny() };

  tickPiracy(p3, PIRACY_MODEL.decisionSeconds + 1, opts3);
  t.equal('bez kasy nie ma rejdu', p3.raids.length, 0);

  nest.credits = PIRACY_MODEL.raidCost * 10;
  tickPiracy(p3, PIRACY_MODEL.decisionSeconds + 1, opts3);
  t.check('z kasą rejd wypływa', p3.raids.length > 0);
  t.check('i kosztuje', nest.credits < PIRACY_MODEL.raidCost * 10);
  t.equal('rejd jest kursem', reg3.courses[0].kind, COURSE_KIND.RAID);
  t.check('nie więcej niż limit', p3.raids.length <= PIRACY_MODEL.maxRaidsPerNest);

  // ----------------------------------------------------------
  t.section('Przemytnik zamienia łup w kredyty');

  const p4 = createPiracyState();
  const nest4 = registerNest(p4, { stationId: 'gniazdo', x: 0, y: 0 });
  nest4.loot.steel = 200;
  const reg4 = createCourseRegistry({ keepHistory: false });
  const econ = {
    resources: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 0])),
    capacity: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 5000]))
  };
  const opts4 = {
    stations: stacje(), registry: reg4, rng: () => 0.99,
    getEconomy: () => econ,
    priceAt: () => RESOURCES.steel.value
  };

  tickPiracy(p4, PIRACY_MODEL.decisionSeconds + 1, opts4);
  t.check('przemytnik wyruszył', p4.smuggles.length > 0);
  t.check('łup zszedł ze składu', nest4.loot.steel < 200);

  for (const c of reg4.courses) c.status = 'done';
  const kasaPrzed = nest4.credits;
  tickPiracy(p4, 1, opts4);
  t.check('kryjówka dostała kredyty', nest4.credits > kasaPrzed);
  t.check('towar wszedł na rynek legalny', econ.resources.steel > 0);
  t.check('odnotowane', p4.stats.smugglesRun > 0);

  // Kontrola na szlaku łapie przemytnika — to jest ten sam pieniądz frakcji,
  // który chroni jej konwoje, działający po raz drugi.
  const p5 = createPiracyState();
  const nest5 = registerNest(p5, { stationId: 'gniazdo', x: 0, y: 0 });
  nest5.loot.steel = 200;
  const reg5 = createCourseRegistry({ keepHistory: false });
  const opts5 = {
    stations: stacje(), registry: reg5, rng: () => 0.01,
    getEconomy: () => econ, priceAt: () => RESOURCES.steel.value,
    patrolStrength: () => 8
  };
  tickPiracy(p5, PIRACY_MODEL.decisionSeconds + 1, opts5);
  for (const c of reg5.courses) c.status = 'done';
  const kasaPrzed5 = nest5.credits;
  tickPiracy(p5, 1, opts5);
  t.check('przy silnej kontroli przemytnik wpada', p5.stats.smugglesCaught > 0);
  t.equal('i nic nie zarabia', nest5.credits, kasaPrzed5);

  // ----------------------------------------------------------
  t.section('Nagroda rośnie z tego, ile frakcja traci');

  const p6 = createPiracyState();
  t.equal('kto nie traci, nie płaci', p6.bounties.get(FACTION.TERRA_NOVA), undefined);
  recordPirateLoss(p6, FACTION.TERRA_NOVA, 100000);
  t.check('strata zasila pulę', p6.bounties.get(FACTION.TERRA_NOVA) > 0);
  t.check('ale tylko ułamkiem', p6.bounties.get(FACTION.TERRA_NOVA) < 100000);
  recordPirateLoss(p6, null, 5000);
  t.equal('kurs bez frakcji nikomu nie płaci', p6.bounties.size, 1);

  // ----------------------------------------------------------
  t.section('Łowca przecina pętlę');

  // Rejd musi być PRAWDZIWY — rejd bez kursu w rejestrze jest osierocony
  // i `tickPiracy` słusznie go sprząta, zanim ktokolwiek zdąży na niego polować.
  const p7 = createPiracyState();
  const nest7 = registerNest(p7, { stationId: 'gniazdo', x: 0, y: 0 });
  nest7.credits = PIRACY_MODEL.raidCost * 4;
  const reg7 = createCourseRegistry({ keepHistory: false });
  const opts7 = { stations: stacje(), registry: reg7, rng: naprzemienny() };
  tickPiracy(p7, PIRACY_MODEL.decisionSeconds + 1, opts7);
  t.check('rejd w polu', p7.raids.length > 0);
  const rejdId = p7.raids[0].courseId;

  p7.bounties.set(FACTION.TERRA_NOVA, PIRACY_MODEL.hunterCost * 3);
  tickPiracy(p7, PIRACY_MODEL.decisionSeconds + 1, opts7);
  t.check('łowca wyruszył', p7.hunts.length > 0);
  t.check('pula zmalała', p7.bounties.get(FACTION.TERRA_NOVA) < PIRACY_MODEL.hunterCost * 3);
  t.check('jeden łowca na jeden rejd',
    p7.hunts.filter(h => h.raidCourseId === rejdId).length === 1);

  const rejdowPrzed = p7.raids.length;
  const zagrozeniePrzed = laneThreat(p7, p7.raids[0].fromId, p7.raids[0].toId);
  const lowcaKurs = reg7.courses.find(c => c.unitClass === 'hunter');
  lowcaKurs.status = 'done';
  p7.config.hunterSuccess = 1; // rozstrzygamy trafienie, nie losowość
  tickPiracy(p7, 1, { ...opts7, rng: () => 0 });
  t.equal('rejder ubity', p7.stats.raidsKilled, 1);
  t.equal('i zniknął ze szlaku', p7.raids.length, rejdowPrzed - 1);
  t.check('kurs rejdera oznaczony jako rozbity',
    reg7.courses.find(c => c.id === rejdId)?.status === 'wrecked');
  t.check('zagrożenie na tym szlaku spadło',
    laneThreat(p7, 'earth', 'mars') < zagrozeniePrzed || zagrozeniePrzed === 1);

  // Nieudane polowanie nie kasuje rejdera.
  const p8 = createPiracyState();
  const nest8 = registerNest(p8, { stationId: 'gniazdo', x: 0, y: 0 });
  nest8.credits = PIRACY_MODEL.raidCost * 4;
  const reg8 = createCourseRegistry({ keepHistory: false });
  const opts8 = { stations: stacje(), registry: reg8, rng: naprzemienny() };
  tickPiracy(p8, PIRACY_MODEL.decisionSeconds + 1, opts8);
  p8.bounties.set(FACTION.TERRA_NOVA, PIRACY_MODEL.hunterCost * 2);
  tickPiracy(p8, PIRACY_MODEL.decisionSeconds + 1, opts8);
  const lowca8 = reg8.courses.find(c => c.unitClass === 'hunter');
  lowca8.status = 'done';
  p8.config.hunterSuccess = 0; // pudło
  tickPiracy(p8, 1, { ...opts8, rng: () => 0.99 });
  t.equal('pudło nie zabija', p8.stats.raidsKilled, 0);
  t.check('rejdery nadal w polu', p8.raids.length > 0);

  // ----------------------------------------------------------
  t.section('Raport');

  const raport = summarizePiracy(p4);
  t.check('raport zna kryjówki', raport.nests.length === 1);
  t.check('i ich stan kasy', Number.isFinite(raport.nests[0].credits));
  t.check('i wartość łupu', Number.isFinite(raport.nests[0].lootValue));

  return t.results;
}

runIfMain(import.meta.url, run);
