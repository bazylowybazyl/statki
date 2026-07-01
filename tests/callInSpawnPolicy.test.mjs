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
  assert.equal(policy.friendly, false);
  assert.equal(policy.isPirate, true);
  assert.equal(policy.aiEnabled, true);
  assert.equal(policy.joinSupportWing, false);
  assert.equal(policy.registerFleet, false);
  assert.equal(policy.weaponFaction, 'pirate');
});

test('dummy call-in is hostile-looking but has AI disabled', () => {
  const policy = getCallInSpawnPolicy('dummy');

  assert.equal(policy.mode, 'dummy');
  assert.equal(policy.friendly, false);
  assert.equal(policy.isPirate, true);
  assert.equal(policy.aiEnabled, false);
  assert.equal(policy.joinSupportWing, false);
  assert.equal(policy.registerFleet, false);
  assert.equal(policy.weaponFaction, 'pirate');
});

test('call-in hull frame follows selected side but preserves explicit pirate template hulls', () => {
  assert.equal(getCallInHullFrame('destroyer', getCallInSpawnPolicy('friendly')), 'terran_destroyer');
  assert.equal(getCallInHullFrame('destroyer', getCallInSpawnPolicy('pirate')), 'pirate_destroyer');
  assert.equal(getCallInHullFrame('battleship', getCallInSpawnPolicy('dummy')), 'pirate_battleship');

  const friendlyPirateTemplate = getCallInSpawnPolicy('friendly', { pirate: true });
  assert.equal(getCallInHullFrame('battleship', friendlyPirateTemplate), 'pirate_battleship');

  assert.equal(getCallInHullFrame('carrier', getCallInSpawnPolicy('pirate')), 'capital_carrier');
  assert.equal(getCallInHullFrame('supercapital', getCallInSpawnPolicy('dummy')), 'supercapital');
});
