import test from 'node:test';
import assert from 'node:assert/strict';
import { migratePirateSpriteLayout } from '../src/data/pirateSpriteMigration.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

test('legacy preset mounts follow the new artwork without changing IDs or loadouts', () => {
  const saved = { hardpoints: [{ id: 'm_bcebjuk', type: 'main', x: -100, y: -70, mount: 'rail' }] };
  const migrated = migratePirateSpriteLayout('pirate_destroyer', saved);
  const expected = SHIP_EDITOR_DEFAULTS.ships.pirate_destroyer.hardpoints[0];
  assert.equal(migrated.hardpoints[0].x, expected.x);
  assert.equal(migrated.hardpoints[0].y, expected.y);
  assert.equal(migrated.hardpoints[0].mount, 'rail');
  assert.equal(migrated.hardpoints[0].id, saved.hardpoints[0].id);
  assert.equal(saved.hardpoints[0].x, -100, 'migration must not mutate the input');
  assert.strictEqual(migratePirateSpriteLayout('pirate_destroyer', migrated), migrated);
});

test('custom markers retain normalized position and empty arrays remain intentional', () => {
  const saved = {
    hardpoints: [{ id: 'custom', x: 140.8, y: -153.6, type: 'aux', rot: 33 }],
    engines: { main: [], side: [{ id: 'side', x: 0, y: -153.6, offsetX: 28.16 }] },
    cores: [{ id: 'reactor', x: 0, y: 0, r: 20 }],
    lights: { position: [{ id: 'light', x: 140.8, y: 0, color: '#ff0000' }] }
  };
  const migrated = migratePirateSpriteLayout('pirate_frigate', saved);
  assert.ok(Math.abs(migrated.hardpoints[0].x - 97.1) < 1e-9);
  assert.ok(Math.abs(migrated.hardpoints[0].y + 80.9) < 1e-9);
  assert.equal(migrated.hardpoints[0].rot, 33);
  assert.deepEqual(migrated.engines.main, []);
  assert.ok(Math.abs(migrated.engines.side[0].offsetX - 19.42) < 1e-9);
  assert.equal(migrated.lights.position[0].color, '#ff0000');
  assert.strictEqual(migratePirateSpriteLayout('battleship', saved), saved);
});

test('current defaults survive save/reload without being rescaled', () => {
  for (const id of ['pirate_battleship', 'pirate_destroyer', 'pirate_frigate']) {
    const saved = JSON.parse(JSON.stringify(SHIP_EDITOR_DEFAULTS.ships[id]));
    assert.equal(saved.spriteRevision, 2);
    assert.strictEqual(migratePirateSpriteLayout(id, saved), saved);
  }
});
