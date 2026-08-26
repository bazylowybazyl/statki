import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { WeaponInventory, fillWeaponInventory } from '../src/game/weaponInventory.js';

test('developer fill tops up every weapon in the master catalog', () => {
  const inventory = new WeaponInventory({
    railgun_mk1: 2,
    railgun_mk2: 120
  });

  const changed = fillWeaponInventory(inventory, Object.values(MASTER_WEAPONS), 99);

  assert.equal(changed, Object.keys(MASTER_WEAPONS).length - 1);
  for (const weapon of Object.values(MASTER_WEAPONS)) {
    assert.ok(inventory.count(weapon.id) >= 99, `${weapon.id} should be available for loadout testing`);
  }
  assert.equal(inventory.count('railgun_mk2'), 120, 'a larger existing stock must not be reduced');
});

test('mechanic cheat control is gated behind the dev query flag', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.has\('dev'\)/);
  assert.match(source, /isMechanicDevMode\(\) \? '<button class="mechanic-tab-btn" id="mechanic-fill-weapons"/);
  assert.match(source, /getElementById\('mechanic-fill-weapons'\)\?\.addEventListener\('click', fillMechanicWeapons\)/);
});
