/**
 * Frakcje: macierz wrogości, progi reputacji, rozlewanie skutków, własność stacji.
 *
 * Najważniejsze, czego pilnuje: SYMETRIA I KOMPLETNOŚĆ macierzy wrogości.
 * Klucze normalizuje `stanceKey` alfabetycznie i wpisy trzymane ręcznie
 * w odwrotnej kolejności już raz cicho spadły na 'neutral' — trzy z sześciu par
 * nie istniały, a test na jedną z nich przeszedł przypadkiem, bo oczekiwana
 * wartość równała się domyślnej. Dlatego sprawdzamy tu KAŻDĄ parę wprost.
 */

import {
  FACTION,
  FACTIONS,
  FACTION_IDS,
  REPUTATION_EVENTS,
  areFactionsHostile,
  applyReputationChange,
  canDockWithFaction,
  createInitialReputation,
  getDefaultStationFaction,
  getFactionPriceMultiplier,
  getFactionStance,
  isDerelict,
  isFactionHostileToPlayer,
  normalizeFaction,
  resolveStanding
} from '../../src/data/factions.js';
import { createSuite, runIfMain } from './harness.mjs';

export function run() {
  const t = createSuite('factions');

  t.section('1. Macierz wrogości — każda para wprost');
  const expectedStances = [
    [FACTION.TERRA_NOVA, FACTION.BELT_UNION, 'neutral'],
    [FACTION.TERRA_NOVA, FACTION.OUTER_CONSORTIUM, 'ally'],
    [FACTION.BELT_UNION, FACTION.OUTER_CONSORTIUM, 'neutral'],
    [FACTION.PIRATES, FACTION.TERRA_NOVA, 'hostile'],
    [FACTION.PIRATES, FACTION.BELT_UNION, 'hostile'],
    [FACTION.PIRATES, FACTION.OUTER_CONSORTIUM, 'hostile']
  ];
  for (const [a, b, expected] of expectedStances) {
    t.equal(`${a} ↔ ${b}`, getFactionStance(a, b), expected);
  }

  t.section('2. Symetria — kolejność argumentów nie może niczego zmieniać');
  for (const a of FACTION_IDS) {
    for (const b of FACTION_IDS) {
      if (a >= b) continue;
      t.check(`${a}/${b} symetryczne`, getFactionStance(a, b) === getFactionStance(b, a));
    }
  }
  t.check('ta sama frakcja to sojusz', getFactionStance(FACTION.PIRATES, FACTION.PIRATES) === 'ally');
  t.check('brak właściciela jest neutralny', getFactionStance(null, FACTION.TERRA_NOVA) === 'neutral');
  t.check('areFactionsHostile zgodne ze stance', areFactionsHostile(FACTION.PIRATES, FACTION.TERRA_NOVA));

  t.section('3. Progi reputacji');
  const thresholds = [
    [-100, 'hostile'], [-60, 'hostile'], [-50, 'hostile'],
    [-49, 'unfriendly'], [-20, 'unfriendly'],
    [-14, 'neutral'], [0, 'neutral'], [14, 'neutral'],
    [15, 'friendly'], [49, 'friendly'],
    [50, 'allied'], [100, 'allied']
  ];
  for (const [value, expected] of thresholds) {
    t.equal(`rep ${String(value).padStart(4)}`, resolveStanding(value).id, expected);
  }

  t.section('4. Stan startowy');
  const rep = createInitialReputation();
  t.equal('Terra Nova zaczyna życzliwie', resolveStanding(rep[FACTION.TERRA_NOVA]).id, 'friendly');
  t.equal('piraci zaczynają wrogo', resolveStanding(rep[FACTION.PIRATES]).id, 'hostile');
  t.check('piraci atakują od startu', isFactionHostileToPlayer(FACTION.PIRATES, rep));
  t.check('Terra Nova nie atakuje od startu', !isFactionHostileToPlayer(FACTION.TERRA_NOVA, rep));
  t.check('dok Terra Nova otwarty', canDockWithFaction(FACTION.TERRA_NOVA, rep));
  t.check('dok piracki zamknięty', !canDockWithFaction(FACTION.PIRATES, rep));
  t.check('opuszczony dok wpuszcza każdego', canDockWithFaction(null, rep));

  t.section('5. Rozlewanie reputacji na sojuszników i wrogów');
  const spill = createInitialReputation();
  const tnBefore = spill[FACTION.TERRA_NOVA];
  const kzBefore = spill[FACTION.OUTER_CONSORTIUM];
  const pirBefore = spill[FACTION.PIRATES];
  const upBefore = spill[FACTION.BELT_UNION];
  applyReputationChange(spill, FACTION.TERRA_NOVA, REPUTATION_EVENTS.killedShip);
  t.equal('poszkodowany traci pełną karę', spill[FACTION.TERRA_NOVA], tnBefore - 6);
  t.equal('sojusznik traci połowę', spill[FACTION.OUTER_CONSORTIUM], kzBefore - 3);
  t.equal('wróg poszkodowanego zyskuje ćwiartkę', spill[FACTION.PIRATES], pirBefore + 1.5);
  t.equal('neutralny bez zmian', spill[FACTION.BELT_UNION], upBefore);

  t.section('6. Eskalacja — piractwo ma kosztować');
  const escalation = createInitialReputation();
  let kills = 0;
  while (canDockWithFaction(FACTION.TERRA_NOVA, escalation) && kills < 200) {
    applyReputationChange(escalation, FACTION.TERRA_NOVA, REPUTATION_EVENTS.killedShip);
    kills++;
  }
  t.check('doki zamykają się po skończonej liczbie zabójstw', kills > 0 && kills < 200, `(${kills})`);
  t.check('patrole atakują po zamknięciu doków', isFactionHostileToPlayer(FACTION.TERRA_NOVA, escalation));
  t.check('piraci w tym czasie się ocieplają', escalation[FACTION.PIRATES] > pirBefore);
  t.note(`${kills} zestrzelonych jednostek Terra Nova → dok zamknięty (rep ${escalation[FACTION.TERRA_NOVA].toFixed(1)})`);

  t.section('7. Ceny wg nastawienia');
  t.equal('sojusznik kupuje taniej', getFactionPriceMultiplier(FACTION.TERRA_NOVA, { [FACTION.TERRA_NOVA]: 50 }), 0.9);
  t.equal('nieprzychylny płaci narzut', getFactionPriceMultiplier(FACTION.TERRA_NOVA, { [FACTION.TERRA_NOVA]: -20 }), 1.12);
  t.equal('neutralny bez modyfikatora', getFactionPriceMultiplier(FACTION.TERRA_NOVA, { [FACTION.TERRA_NOVA]: 0 }), 1);
  t.equal('brak właściciela bez modyfikatora', getFactionPriceMultiplier(null, {}), 1);

  t.section('8. Własność stacji');
  t.equal('Ziemia → Terra Nova', getDefaultStationFaction('earth'), FACTION.TERRA_NOVA);
  // Rdzeń rozdzielony na trzy frakcje 2026-08-14: wojna potrzebuje terytoriów,
  // a jedna frakcja obejmująca pół układu nie ma się z kim bić o nic.
  t.equal('Mars → Stocznie Marsjańskie', getDefaultStationFaction('mars'), FACTION.MARS);
  t.equal('Merkury → Konsorcjum Wewnętrzne',
    getDefaultStationFaction('mercury'), FACTION.INNER_CONSORTIUM);
  t.equal('Wenus → Konsorcjum Wewnętrzne',
    getDefaultStationFaction('venus'), FACTION.INNER_CONSORTIUM);
  t.equal('Jowisz → Konsorcjum', getDefaultStationFaction('jupiter'), FACTION.OUTER_CONSORTIUM);
  // Rdzeń MUSI startować pokojowo — przez te trzy płynie 78% tonażu układu.
  t.check('Ziemia i Mars handlują', !areFactionsHostile(FACTION.TERRA_NOVA, FACTION.MARS));
  t.check('Ziemia i Konsorcjum Wewn. handlują',
    !areFactionsHostile(FACTION.TERRA_NOVA, FACTION.INNER_CONSORTIUM));
  t.check('Mars i Konsorcjum Wewn. handlują',
    !areFactionsHostile(FACTION.MARS, FACTION.INNER_CONSORTIUM));
  t.check('piraci wrodzy stoczni', areFactionsHostile(FACTION.PIRATES, FACTION.MARS));
  t.equal('Neptun bez właściciela (opuszczona)', getDefaultStationFaction('neptune'), null);
  t.check('isDerelict wykrywa brak właściciela', isDerelict({ factionId: null }));
  t.check('isDerelict false dla Terra Nova', !isDerelict({ factionId: FACTION.TERRA_NOVA }));

  t.section('9. Spójność danych');
  for (const id of FACTION_IDS) {
    const faction = FACTIONS[id];
    t.check(`${id}: ma nazwę, skrót i kolor`, !!faction.name && !!faction.short && !!faction.color);
    const overlap = (faction.demands || []).filter(r => (faction.supplies || []).includes(r));
    t.check(`${id}: nie żąda tego, co sam produkuje`, overlap.length === 0, `(${overlap.join(', ')})`);
  }
  t.equal('normalizeFaction odrzuca nieznane', normalizeFaction('nieistniejaca'), null);
  t.equal('normalizeFaction nie myli planety z frakcją', normalizeFaction('earth'), null);
  t.equal('normalizeFaction ignoruje wielkość liter', normalizeFaction('TERRA_NOVA'), FACTION.TERRA_NOVA);

  return t.results;
}

runIfMain(import.meta.url, run);
