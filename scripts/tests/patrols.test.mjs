/**
 * Testy patroli.
 *
 * Sedno: bezpieczeństwo szlaku ma być wielkością EKONOMICZNĄ, nie ustawieniem.
 * Patrol kosztuje, jest finansowany z handlu, który chroni, i znika, gdy
 * zabraknie pieniędzy. Bez tego byłby darmowy — a wtedy nie byłoby czego
 * rozbijać i gracz nie miałby żadnej dźwigni na gospodarkę.
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  PATROL_MODEL, laneKey, createPatrolRegistry, collectLevy, budgetOf,
  recordLaneLoss, planPatrols, patrolStrength, patrolMultiplier, summarizePatrols
} from '../../src/game/traffic/patrols.js';

const TN = 'terra_nova';

export function run() {
  const t = createSuite('patrols');

  // ----------------------------------------------------------
  t.section('Szlak jest nieskierowany');

  t.equal('A→B i B→A to ten sam szlak', laneKey('earth', 'mars'), laneKey('mars', 'earth'));
  t.check('różne szlaki mają różne klucze', laneKey('earth', 'mars') !== laneKey('earth', 'venus'));

  // ----------------------------------------------------------
  t.section('Patrole płaci handel, który chronią');

  const registry = createPatrolRegistry();
  t.equal('na start bez środków', budgetOf(registry, TN), 0);

  const oplata = collectLevy(registry, TN, 100_000);
  t.close('opłata to ułamek wartości dostawy', oplata, 100_000 * PATROL_MODEL.levyRate);
  t.close('budżet rośnie', budgetOf(registry, TN), oplata);
  t.equal('bez frakcji nie ma opłaty', collectLevy(registry, null, 100_000), 0);

  // ----------------------------------------------------------
  t.section('Frakcja pilnuje tam, gdzie TRACI');

  // Trzy szlaki, straty tylko na jednym — patrol ma pójść właśnie tam.
  recordLaneLoss(registry, 'mercury', 'earth', 40_000);
  recordLaneLoss(registry, 'venus', 'earth', 500);

  collectLevy(registry, TN, 500_000);
  const plan = planPatrols(registry, { laneFaction: () => TN });

  t.check('szlak ze stratami dostaje osłonę', plan.funded.includes(laneKey('mercury', 'earth')));
  t.check('szlak bez strat nie dostaje nic', !plan.funded.includes(laneKey('venus', 'earth')));
  t.equal('siła startowa to jeden', patrolStrength(registry, 'mercury', 'earth'), 1);
  t.equal('drobne straty nie uzasadniają wydatku', patrolStrength(registry, 'venus', 'earth'), 0);

  // ----------------------------------------------------------
  t.section('Osłona zbija ryzyko, ale nie do zera');

  const bezOslony = patrolMultiplier(registry, 'venus', 'earth');
  const zOslona = patrolMultiplier(registry, 'mercury', 'earth');
  t.equal('szlak bez patrolu bez zmian', bezOslony, 1);
  t.check('patrolowany jest bezpieczniejszy', zOslona < 1);
  // Gdyby patrol czynił trasę nietykalną, opłacałoby się pilnować jednej linii
  // i wozić tylko nią — cała mapa zwinęłaby się do jednego odcinka.
  t.check('ale nigdy nietykalny', zOslona > 0);
  t.note(`mnożnik ryzyka na patrolowanym szlaku: ${zOslona.toFixed(2)}`);

  // ----------------------------------------------------------
  t.section('Uporczywe straty wzmacniają patrol');

  for (let i = 0; i < 4; i++) {
    recordLaneLoss(registry, 'mercury', 'earth', 30_000);
    collectLevy(registry, TN, 400_000);
    planPatrols(registry, { laneFaction: () => TN });
  }
  const silny = patrolStrength(registry, 'mercury', 'earth');
  t.check('patrol rośnie, gdy mimo niego boli', silny > 1);
  t.check('ale nie w nieskończoność', silny <= PATROL_MODEL.maxStrength);
  t.check('silniejszy patrol zbija mocniej',
    patrolMultiplier(registry, 'mercury', 'earth') < zOslona);

  // ----------------------------------------------------------
  t.section('Bez pieniędzy nie ma osłony');

  const biedna = createPatrolRegistry();
  recordLaneLoss(biedna, 'earth', 'mars', 90_000);
  const bezSrodkow = planPatrols(biedna, { laneFaction: () => TN });
  t.equal('bez budżetu nikt nie funduje patrolu', bezSrodkow.funded.length, 0);

  // Patrol znika, gdy frakcja przestaje płacić za utrzymanie.
  const chudy = createPatrolRegistry();
  recordLaneLoss(chudy, 'earth', 'mars', 90_000);
  collectLevy(chudy, TN, 100_000);
  planPatrols(chudy, { laneFaction: () => TN });
  t.equal('patrol powstał', patrolStrength(chudy, 'earth', 'mars'), 1);

  chudy.budgets.set(TN, 0);
  const rozwiazane = planPatrols(chudy, { laneFaction: () => TN });
  t.equal('bez środków patrol się rozwiązuje', patrolStrength(chudy, 'earth', 'mars'), 0);
  t.check('i jest to odnotowane', rozwiazane.disbanded.length > 0);

  // ----------------------------------------------------------
  t.section('Pamięć strat wygasa');

  const pamiec = createPatrolRegistry();
  recordLaneLoss(pamiec, 'a', 'b', 10_000);
  const przed = pamiec.losses.get(laneKey('a', 'b'));
  planPatrols(pamiec, { laneFaction: () => null });
  const po = pamiec.losses.get(laneKey('a', 'b'));
  t.check('dawna napaść przestaje uzasadniać wydatek', po < przed);

  for (let i = 0; i < 40; i++) planPatrols(pamiec, { laneFaction: () => null });
  t.equal('w końcu znika zupełnie', pamiec.losses.get(laneKey('a', 'b')), undefined);

  // ----------------------------------------------------------
  t.section('Podsumowanie');

  const raport = summarizePatrols(registry);
  t.check('raport wylicza szlaki', raport.count >= 1);
  t.check('zna łączną siłę', raport.totalStrength >= raport.count);
  t.check('pokazuje, gdzie boli najbardziej', raport.hotspots.length > 0);
  t.check('i ile zostało w kasie', typeof raport.budgets[TN] === 'number');
  t.check('liczy wydatki', raport.stats.spent > 0);

  return t.results;
}

runIfMain(import.meta.url, run);
