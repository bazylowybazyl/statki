import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAR_SYSTEM_ID, SOL_SYSTEM, STAR_SYSTEMS, getStarSystem, resolveStarSystemId, globalBodyId, systemHome
} from '../src/data/starSystems.js';
import { SYSTEM_MAP_CONSTANTS, SYSTEM_MAP_PLANETS, SYSTEM_MAP_MOONS, buildSystemMap } from '../src/data/systemMap.js';
import { PLAYER_HOME_BERTHS } from '../src/game/traffic/trafficProtocol.js';
import { DEFAULT_SYSTEM_ID } from '../src/game/playerSave.js';

test('Układ Słoneczny w rejestrze: geometria z systemMap.js, gwiazda, dom gracza', () => {
  assert.equal(DEFAULT_STAR_SYSTEM_ID, 'sol');
  assert.equal(DEFAULT_SYSTEM_ID, DEFAULT_STAR_SYSTEM_ID, 'zapis gracza i rejestr: ten sam układ domyślny');
  assert.equal(STAR_SYSTEMS.sol, SOL_SYSTEM);
  assert.equal(SOL_SYSTEM.planets, SYSTEM_MAP_PLANETS);
  assert.equal(SOL_SYSTEM.moons, SYSTEM_MAP_MOONS);
  assert.equal(SOL_SYSTEM.star.r, SYSTEM_MAP_CONSTANTS.sunRadius);
  assert.equal(SOL_SYSTEM.label, 'SOL');
  assert.ok(SOL_SYSTEM.handmade);
  const home = systemHome(SOL_SYSTEM);
  assert.ok(SOL_SYSTEM.planets.some(p => p.id === home.planetId), 'planeta domu jest w układzie');
  assert.deepEqual([...PLAYER_HOME_BERTHS], [...home.berthIds], 'worker ruchu bierze stanowisko domowe z rejestru');
  assert.ok(home.berthIds.every(id => id.startsWith(`${home.stationId}:`)), 'stanowisko domowe w porcie domu');
  assert.ok(Object.isFrozen(SOL_SYSTEM) && Object.isFrozen(SOL_SYSTEM.star) && Object.isFrozen(SOL_SYSTEM.home));
});

test('buildSystemMap z planet układu daje te same orbity co tabela domyślna', () => {
  const angleFor = (def, i) => i * 0.5;
  const a = buildSystemMap(140, { angleFor });
  const b = buildSystemMap(140, { angleFor, planets: SOL_SYSTEM.planets, sunRadius: SOL_SYSTEM.star.r });
  assert.deepEqual(b, a);
});

test('wybór układu przy starcie strony: adres, zapis, domyślny; nieznany → domyślny z powodem', () => {
  assert.deepEqual(resolveStarSystemId('', null), { id: 'sol', source: 'default', rejected: null });
  assert.deepEqual(resolveStarSystemId('?uklad=sol', null), { id: 'sol', source: 'url', rejected: null });
  assert.deepEqual(resolveStarSystemId('?uklad=SOL', null), { id: 'sol', source: 'url', rejected: null });
  assert.deepEqual(resolveStarSystemId('', 'sol'), { id: 'sol', source: 'save', rejected: null });
  assert.deepEqual(resolveStarSystemId('?uklad=nieznany', 'sol'), { id: 'sol', source: 'save', rejected: 'nieznany' });
  assert.deepEqual(resolveStarSystemId('', 'kepler-9'), { id: 'sol', source: 'default', rejected: 'kepler-9' });
  const systems = { sol: SOL_SYSTEM, test: { ...SOL_SYSTEM, id: 'test' } };
  assert.deepEqual(resolveStarSystemId('?uklad=test', 'sol', systems), { id: 'test', source: 'url', rejected: null });
  assert.deepEqual(resolveStarSystemId('', 'test', systems), { id: 'test', source: 'save', rejected: null });
});

test('getStarSystem i globalny identyfikator ciała', () => {
  assert.equal(getStarSystem('sol'), SOL_SYSTEM);
  assert.equal(getStarSystem(' Sol '), SOL_SYSTEM);
  assert.equal(getStarSystem('toString'), null, 'tylko własne klucze rejestru');
  assert.equal(getStarSystem(null), null);
  assert.equal(globalBodyId('sol', 'earth'), 'sol:earth');
  assert.equal(globalBodyId(null, 'mars'), 'sol:mars');
  assert.equal(systemHome(null), null);
});
