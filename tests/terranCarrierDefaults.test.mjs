import assert from 'node:assert/strict';
import test from 'node:test';

import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

test('terran carrier editor defaults include full hardpoints engines and lights', () => {
  const carrier = SHIP_EDITOR_DEFAULTS.ships.terran_carrier;
  assert.equal(carrier.label, 'Citadella');
  assert.equal(carrier.frontAxis, '+X');

  const counts = carrier.hardpoints.reduce((acc, hp) => {
    acc[hp.type] = (acc[hp.type] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, {
    aux: 17,
    special: 2,
    main: 10,
    hangar: 11
  });
  assert.equal(carrier.hardpoints.length, 40);
  assert.equal(carrier.engines.main.length, 6);
  assert.equal(carrier.engines.side.length, 4);
  assert.equal(carrier.lights.position.length, 6);
  assert.equal(carrier.lights.road.length, 0);
  assert.equal(carrier.lights.flood.length, 5);

  assert.deepEqual(
    carrier.engines.main.find(engine => engine.id === 'm_dqyb8h8'),
    {
      id: 'm_dqyb8h8',
      x: -805.9,
      y: -14.37,
      deg: 90,
      offsetX: 0,
      offsetY: 0,
      mount: 'rear_left',
      gimbalMinDeg: -45,
      gimbalMaxDeg: 45,
      vfxLengthMin: 10,
      vfxLengthMax: 179
    }
  );
  assert.deepEqual(
    carrier.engines.side.find(engine => engine.id === 'm_dmlbakg'),
    {
      id: 'm_dmlbakg',
      x: 310.04,
      y: -280.27,
      deg: 180,
      offsetX: 0,
      offsetY: 0,
      mount: 'upper_left',
      gimbalMinDeg: -90,
      gimbalMaxDeg: 90,
      vfxWidthMin: 25,
      vfxWidthMax: 227,
      vfxLengthMin: 49,
      vfxLengthMax: 354
    }
  );
  assert.equal(carrier.lights.position[0].id, 'nav_bow_l');
  assert.equal(carrier.lights.position[0].color, '#ff2b2b');
});
