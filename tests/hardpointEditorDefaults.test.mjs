import test from 'node:test';
import assert from 'node:assert/strict';

import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

test('megafreighter has an explicit empty editor profile instead of inheriting Atlas markers', () => {
  const profile = SHIP_EDITOR_DEFAULTS.ships.megafreighter;

  assert.ok(profile);
  assert.deepEqual(profile.hardpoints, []);
  assert.deepEqual(profile.cores, []);
});
