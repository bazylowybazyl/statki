import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIGHTER_SQUADRON_DEFS,
  addHangarSquadronMount,
  getDefaultFighterSquadronId,
  getFighterSquadronDef,
  getHangarModuleIdForSquadron,
  getHangarSquadronCapacity,
  getSquadronIdForHangarModule,
  normalizeHangarSquadronMounts
} from '../src/data/fighterSquadrons.js';
import { SUPPORT_SHIP_TEMPLATES } from '../src/data/ships.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

test('hangar size maps to squadron capacity', () => {
  assert.equal(getHangarSquadronCapacity('S'), 1);
  assert.equal(getHangarSquadronCapacity('M'), 1);
  assert.equal(getHangarSquadronCapacity('L'), 2);
  assert.equal(getHangarSquadronCapacity('Capital'), 2);
  assert.equal(getHangarSquadronCapacity('unknown'), 1);
});

test('fighter squadron catalog exposes distinct flight stats and weapons', () => {
  const interceptor = getFighterSquadronDef('interceptor');
  const multirole = getFighterSquadronDef('multirole');
  const strike = getFighterSquadronDef('strike');

  assert.equal(getDefaultFighterSquadronId(), 'multirole');
  assert.equal(interceptor.weaponId, 'laser_pd_mk1');
  assert.equal(multirole.weaponId, 'ciws_mk1');
  assert.equal(strike.weaponId, 'ciws_mk2');

  assert.ok(interceptor.maxSpeed > multirole.maxSpeed);
  assert.ok(interceptor.turn > multirole.turn);
  assert.ok(strike.hp > interceptor.hp);
  assert.ok(strike.missileAmmo < multirole.missileAmmo);

  for (const def of Object.values(FIGHTER_SQUADRON_DEFS)) {
    assert.equal(def.squadSize, 9);
    assert.ok(def.accel > 0);
    assert.ok(def.maxSpeed > 0);
    assert.ok(def.turn > 0);
  }
});

test('unknown squadron ids fall back to the default multirole squadron', () => {
  assert.equal(getFighterSquadronDef('missing').id, 'multirole');
  assert.equal(getFighterSquadronDef().id, 'multirole');
});

test('fighter squadrons are mountable hangar inventory items', () => {
  assert.equal(MASTER_WEAPONS.fighter_bay.squadronId, 'multirole');

  for (const squadronId of Object.keys(FIGHTER_SQUADRON_DEFS)) {
    const itemId = `fighter_squad_${squadronId}`;
    const item = MASTER_WEAPONS[itemId];

    assert.ok(item, `${itemId} should exist in MASTER_WEAPONS`);
    assert.equal(item.mountType, 'hangar');
    assert.equal(item.category, 'hangar');
    assert.equal(item.size, 'S');
    assert.equal(item.squadronId, squadronId);
  }
});

test('hangar squadron mount helpers normalize legacy and enforce capacity', () => {
  assert.equal(getHangarModuleIdForSquadron('interceptor'), 'fighter_squad_interceptor');
  assert.equal(getSquadronIdForHangarModule('fighter_squad_strike'), 'strike');
  assert.equal(getSquadronIdForHangarModule('fighter_bay'), 'multirole');
  assert.equal(getSquadronIdForHangarModule('unknown'), null);

  assert.deepEqual(
    normalizeHangarSquadronMounts(['fighter_bay', 'unknown', 'fighter_squad_interceptor'], 3),
    ['fighter_squad_multirole', 'fighter_squad_interceptor']
  );

  assert.deepEqual(
    addHangarSquadronMount(['fighter_squad_multirole'], 'fighter_squad_interceptor', 2),
    ['fighter_squad_multirole', 'fighter_squad_interceptor']
  );

  assert.deepEqual(
    addHangarSquadronMount(['fighter_squad_multirole'], 'fighter_squad_interceptor', 1),
    ['fighter_squad_multirole']
  );
});

test('support and pirate fighter templates reuse squadron flight stats', () => {
  assert.deepEqual(SUPPORT_SHIP_TEMPLATES.fighter.stats, {
    hp: FIGHTER_SQUADRON_DEFS.multirole.hp,
    accel: FIGHTER_SQUADRON_DEFS.multirole.accel,
    maxSpeed: FIGHTER_SQUADRON_DEFS.multirole.maxSpeed,
    turn: FIGHTER_SQUADRON_DEFS.multirole.turn,
    radius: FIGHTER_SQUADRON_DEFS.multirole.radius,
    mass: FIGHTER_SQUADRON_DEFS.multirole.mass,
    separationRange: FIGHTER_SQUADRON_DEFS.multirole.separationRange
  });
  assert.equal(SUPPORT_SHIP_TEMPLATES.fighter.count, FIGHTER_SQUADRON_DEFS.multirole.squadSize);

  assert.deepEqual(SUPPORT_SHIP_TEMPLATES.interceptor.stats, {
    hp: FIGHTER_SQUADRON_DEFS.interceptor.hp,
    accel: FIGHTER_SQUADRON_DEFS.interceptor.accel,
    maxSpeed: FIGHTER_SQUADRON_DEFS.interceptor.maxSpeed,
    turn: FIGHTER_SQUADRON_DEFS.interceptor.turn,
    radius: FIGHTER_SQUADRON_DEFS.interceptor.radius,
    mass: FIGHTER_SQUADRON_DEFS.interceptor.mass,
    separationRange: FIGHTER_SQUADRON_DEFS.interceptor.separationRange
  });
  assert.equal(SUPPORT_SHIP_TEMPLATES.interceptor.count, FIGHTER_SQUADRON_DEFS.interceptor.squadSize);
});
