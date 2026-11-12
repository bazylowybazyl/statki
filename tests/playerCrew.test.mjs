import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PLAYER_CREW_COMPLEMENT, PLAYER_CREW_MODE, PLAYER_CREW_TUNE, HULL_PASSENGER_CABINS, PASSENGER_CABINS
} from '../src/data/playerCrew.js';
import { WORKFORCE_CONTRACT_SECONDS } from '../src/data/workforce.js';
import {
  createPlayerCrew, crewComplement, crewOnBoard, crewEffects, cabinSlotCapacity, betrayCrew, recruitCheck, recruitCrew,
  passengersAboard, cabinRoom, nextContractExpiry, boardContract, disembarkContracts, tickContracts,
  serializePlayerCrew, parsePlayerCrew
} from '../src/game/playerCrew.js';
import { buildPlayerSave, parsePlayerSave } from '../src/game/playerSave.js';
import { readIndexHtml } from './helpers/indexSource.mjs';

// Załoga i kabiny gracza (workforce W6, docs/PROPOZYCJA-workforce.md § 6, D10, D11): czysta logika
// (src/game/playerCrew.js), zapis gracza i klej w index.html (blok „ZAŁOGA I KABINY GRACZA”).

test('dane: każdy kadłub gracza ma skład załogi; Atlas wozi 300 osób w kabinach (D10)', () => {
  // Kadłuby gracza z katalogu (src/data/playerHullCatalog.js importuje sprite'y — czytany jako tekst).
  const catalog = readFileSync(new URL('../src/data/playerHullCatalog.js', import.meta.url), 'utf8');
  const hulls = [...catalog.matchAll(/^\s+id: '([a-z_]+)',/gm)].map(m => m[1]);
  assert.ok(hulls.includes('atlas') && hulls.length >= 10, `kadłuby: ${hulls.join(', ')}`);
  for (const id of hulls) assert.ok(PLAYER_CREW_COMPLEMENT[id] > 0, `skład ${id}`);
  assert.equal(HULL_PASSENGER_CABINS.atlas, 300);
  assert.equal(cabinSlotCapacity('atlas'), 300);
  assert.equal(cabinSlotCapacity('frigate'), 0, 'fregata bez kabin');
  assert.ok(PASSENGER_CABINS.price > 0);
});

test('przydział frakcji: pełny skład na każdym kadłubie, skutek 1, bez werbunku', () => {
  const crew = createPlayerCrew();
  assert.equal(crew.mode, PLAYER_CREW_MODE.FACTION);
  assert.equal(crewOnBoard(crew, 'atlas'), crewComplement('atlas'));
  assert.equal(crewOnBoard(crew, 'carrier'), crewComplement('carrier'));
  assert.deepEqual(crewEffects(crew, 'atlas'), { ratio: 1, repair: 1, reload: 1 });
  const mars = { factionId: 'mars_yards', source: true, pirate: false };
  assert.equal(recruitCheck(crew, mars, 'atlas').ok, false, 'załogę przydziela frakcja');
});

test('zdrada: zostają lojalni, naprawy i przeładowanie wolniej (D11), werbunek tylko w neutralnych źródłach', () => {
  const crew = createPlayerCrew();
  assert.ok(betrayCrew(crew, 'atlas'));
  assert.equal(betrayCrew(crew, 'atlas'), false, 'drugi raz nic');
  const floor = Math.ceil(crewComplement('atlas') * PLAYER_CREW_TUNE.betrayalFloor);
  assert.equal(crewOnBoard(crew, 'atlas'), floor);
  const fx = crewEffects(crew, 'atlas');
  assert.ok(fx.repair < 1 && fx.repair >= PLAYER_CREW_TUNE.repairMin);
  assert.ok(fx.reload < 1 && fx.reload > fx.repair, 'przeładowanie dławione słabiej niż naprawy');
  const earth = { factionId: PLAYER_CREW_TUNE.formerFaction, source: true };
  const venus = { factionId: 'inner_consortium', source: false };
  const nest = { factionId: 'pirates', source: false, pirate: true };
  const mars = { factionId: 'mars_yards', source: true };
  assert.match(recruitCheck(crew, earth, 'atlas').reason, /dawnej frakcji/);
  assert.match(recruitCheck(crew, venus, 'atlas').reason, /ośrodkach ludności/);
  assert.match(recruitCheck(crew, nest, 'atlas').reason, /Piraci/);
  assert.match(recruitCheck(crew, { factionId: null }, 'atlas').reason, /bez załogi/);
  assert.equal(recruitCheck(crew, mars, 'atlas').ok, true);
  assert.equal(recruitCrew(crew, 'atlas', 50), 50);
  assert.equal(recruitCrew(crew, 'atlas', 1e6), crewComplement('atlas') - floor - 50, 'do pełnego składu');
  assert.equal(crewOnBoard(crew, 'atlas'), crewComplement('atlas'));
  assert.equal(recruitCheck(crew, mars, 'atlas').ok, false, 'pełny skład');
  assert.deepEqual(crewEffects(crew, 'atlas'), { ratio: 1, repair: 1, reload: 1 });
  // Mniejszy kadłub: obsada przycięta do jego składu.
  assert.equal(crewOnBoard(crew, 'frigate'), crewComplement('frigate'));
});

test('kontrakty w kabinach: zaokrętowanie, oddanie najstarszych, wygaśnięcie po T, zapis', () => {
  const crew = createPlayerCrew();
  assert.equal(passengersAboard(crew), 0);
  assert.equal(cabinRoom(crew, 300), 300);
  boardContract(crew, { fromId: 'earth', units: 200, paid: 11 });
  tickContracts(crew, 600);
  boardContract(crew, { fromId: 'mars', units: 80, paid: 9.6 });
  assert.equal(passengersAboard(crew), 280);
  assert.equal(cabinRoom(crew, 300), 20);
  assert.equal(nextContractExpiry(crew), WORKFORCE_CONTRACT_SECONDS - 600);
  assert.equal(disembarkContracts(crew, 150), 150);
  assert.deepEqual(crew.contracts.map(c => [c.fromId, c.units]), [['earth', 50], ['mars', 80]], 'najpierw najstarszy');
  assert.equal(tickContracts(crew, WORKFORCE_CONTRACT_SECONDS - 600 - 1), 0);
  assert.equal(tickContracts(crew, 2), 50, 'kontrakt z Ziemi wygasł');
  assert.equal(passengersAboard(crew), 80);
  const back = parsePlayerCrew(JSON.parse(JSON.stringify(serializePlayerCrew(crew))));
  assert.equal(back.mode, PLAYER_CREW_MODE.FACTION);
  assert.equal(passengersAboard(back), 80);
  assert.ok(Math.abs(back.contracts[0].secondsLeft - crew.contracts[0].secondsLeft) < 0.1);
  assert.deepEqual(parsePlayerCrew(null), createPlayerCrew(), 'brak pola — przydział frakcji');
  assert.deepEqual(parsePlayerCrew({ mode: 'own', count: -5, contracts: [{ units: 'x' }, { units: 9, secondsLeft: -1 }] }).contracts, []);
});

test('zapis gracza: załoga i ludzie w kabinach przeżywają F5, stary zapis bez pola — przydział frakcji', () => {
  const crew = createPlayerCrew();
  betrayCrew(crew, 'atlas');
  recruitCrew(crew, 'atlas', 30);
  boardContract(crew, { fromId: 'jupiter', units: 120, paid: 14 });
  const save = buildPlayerSave({ worldSeed: 7, player: { x: 10, y: 20, credits: 500, crew } });
  const { save: loaded } = parsePlayerSave(JSON.stringify(save), { worldSeed: 7 });
  assert.equal(loaded.player.crew.mode, PLAYER_CREW_MODE.OWN);
  assert.equal(crewOnBoard(loaded.player.crew, 'atlas'), crewOnBoard(crew, 'atlas'));
  assert.equal(passengersAboard(loaded.player.crew), 120);
  const old = buildPlayerSave({ worldSeed: 7, player: { x: 1, y: 1 } });
  delete old.player.crew;
  assert.equal(parsePlayerSave(old, { worldSeed: 7 }).save.player.crew.mode, PLAYER_CREW_MODE.FACTION);
});

test('klej w grze: rój R, przeładowanie (źródło crew), zapis, kabiny w WYPOSAŻENIU, karta KADRY', () => {
  const src = readIndexHtml();
  assert.ok(/workRate: \(\) => crewEffects\(PLAYER\.crew, PLAYER\.activeHullId, _crewFx\)\.repair/.test(src), 'rój R z załogi');
  assert.ok(/setModifierSource\(ship, 'crew', _crewMods\)/.test(src), 'przeładowanie przez setModifierSource');
  assert.ok(/crew: PLAYER\.crew\b/.test(src) && /PLAYER\.crew = p\.crew \|\| createPlayerCrew\(\)/.test(src), 'zapis gracza');
  assert.ok(/hullCabins: \{ \.\.\.\(PLAYER\.hullCabins \|\| \{\}\) \}/.test(src), 'kabiny w zapisie wyposażenia');
  assert.ok(/tickPlayerCrew\(steps \* PHYS_DT\)/.test(src), 'kontrakty wygasają z czasem gry');
  assert.ok(/adjustStationStock\(station, 'workforce', -n\)/.test(src) && /adjustStationStock\(station, 'workforce', moved\)/.test(src),
    'kontrakty i werbunek przez most (jedna ekonomia)');
  assert.ok(src.includes('pane.appendChild(buildCrewShipCard());'), 'karta KADRY: twój okręt');
  // Zdrada z fabuły (misja przyszła): api skryptu → zależność bloku FABUŁA → ta sama droga co hak konsoli.
  const story = readFileSync(new URL('../src/game/story/storyGame.js', import.meta.url), 'utf8');
  assert.ok(/crew: \{\s*betray: \(\) => !!d\.betrayCrew\?\.\(\)/.test(story), 'api.crew.betray w storyGame');
  assert.ok(/betrayCrew: \(\) => \{[\s\S]{0,120}window\.PlayerCrew\.betray\(\)/.test(src), 'zależność betrayCrew w bloku FABUŁA');
});
