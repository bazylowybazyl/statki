import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCallInHullFrame,
  getCallInSpawnPolicy,
  normalizeCallInSpawnMode
} from '../src/game/callInSpawnPolicy.js';

test('call-in spawn mode normalizes to friendly by default', () => {
  assert.equal(normalizeCallInSpawnMode(), 'friendly');
  assert.equal(normalizeCallInSpawnMode('unknown'), 'friendly');
  assert.equal(normalizeCallInSpawnMode('Pirate'), 'pirate');
  assert.equal(normalizeCallInSpawnMode('DUMMY'), 'dummy');
});

test('friendly call-in joins support wing with AI enabled', () => {
  const policy = getCallInSpawnPolicy('friendly');

  assert.equal(policy.mode, 'friendly');
  assert.equal(policy.faction, 'terran');
  assert.equal(policy.friendly, true);
  assert.equal(policy.isPirate, false);
  assert.equal(policy.aiEnabled, true);
  assert.equal(policy.joinSupportWing, true);
  assert.equal(policy.registerFleet, true);
  assert.equal(policy.weaponFaction, 'terran');
});

test('pirate call-in is hostile and keeps combat AI enabled', () => {
  const policy = getCallInSpawnPolicy('pirate');

  assert.equal(policy.mode, 'pirate');
  assert.equal(policy.faction, 'pirate');
  assert.equal(policy.friendly, false);
  assert.equal(policy.isPirate, true);
  assert.equal(policy.aiEnabled, true);
  assert.equal(policy.joinSupportWing, false);
  assert.equal(policy.registerFleet, false);
  assert.equal(policy.weaponFaction, 'pirate');
});

test('dummy call-in is independent and has AI disabled', () => {
  const policy = getCallInSpawnPolicy('dummy');

  assert.equal(policy.mode, 'dummy');
  assert.equal(policy.faction, 'independent');
  assert.equal(policy.friendly, false);
  assert.equal(policy.isPirate, false);
  assert.equal(policy.aiEnabled, false);
  assert.equal(policy.joinSupportWing, false);
  assert.equal(policy.registerFleet, false);
  assert.equal(policy.weaponFaction, 'terran');
});

test('call-in hull frame follows selected side but preserves explicit pirate template hulls', () => {
  assert.equal(getCallInHullFrame('destroyer', getCallInSpawnPolicy('friendly')), 'terran_destroyer');
  assert.equal(getCallInHullFrame('destroyer', getCallInSpawnPolicy('pirate')), 'pirate_destroyer');
  assert.equal(getCallInHullFrame('battleship', getCallInSpawnPolicy('dummy')), 'terran_battleship');

  const friendlyPirateTemplate = getCallInSpawnPolicy('friendly', { pirate: true });
  assert.equal(getCallInHullFrame('battleship', friendlyPirateTemplate), 'pirate_battleship');

  assert.equal(getCallInHullFrame('carrier', getCallInSpawnPolicy('friendly')), 'terran_carrier');
  assert.equal(getCallInHullFrame('supercapital', getCallInSpawnPolicy('friendly')), 'terran_supercapital');
  assert.equal(getCallInHullFrame('carrier', getCallInSpawnPolicy('pirate')), null);
  assert.equal(getCallInHullFrame('supercapital', getCallInSpawnPolicy('pirate')), null);
  assert.equal(getCallInHullFrame('carrier', getCallInSpawnPolicy('pirate', { faction: 'terran' })), null);
  assert.equal(getCallInHullFrame('supercapital', getCallInSpawnPolicy('pirate', { faction: 'terran' })), null);
});

test('call-in hull frame separates independent Atlas from Terra Nova Colossus', () => {
  const independentPolicy = getCallInSpawnPolicy('dummy', { faction: 'independent' });

  assert.equal(getCallInHullFrame('atlas', independentPolicy), 'atlas');
  assert.equal(getCallInHullFrame('megafreighter', independentPolicy), 'megafreighter');
});
