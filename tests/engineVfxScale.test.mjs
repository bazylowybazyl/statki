import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEngineVfxClassScale,
  getEngineVfxScaleForHullId
} from '../src/3d/engineVfxScale.js';

test('engine VFX grows monotonically with the hull class', () => {
  const frigate = getEngineVfxScaleForHullId('terran_frigate');
  const destroyer = getEngineVfxScaleForHullId('terran_destroyer');
  const battleship = getEngineVfxScaleForHullId('terran_battleship');
  const carrier = getEngineVfxScaleForHullId('terran_carrier');
  const supercapital = getEngineVfxScaleForHullId('terran_supercapital');
  const atlas = getEngineVfxScaleForHullId('atlas');

  assert.ok(frigate < destroyer);
  assert.ok(destroyer < battleship);
  assert.ok(battleship < carrier);
  assert.ok(carrier < supercapital);
  assert.ok(supercapital < atlas);
  assert.equal(atlas, 1);
  assert.ok(Math.abs(frigate - Math.sqrt(320 / 3000)) < 1e-9);
});

test('engine VFX resolves entity classes and supports a bounded visual override', () => {
  assert.equal(getEngineVfxClassScale({ type: 'frigate_pd' }), getEngineVfxScaleForHullId('terran_frigate'));
  assert.equal(getEngineVfxClassScale({ activeHullId: 'battleship' }), getEngineVfxScaleForHullId('terran_battleship'));
  assert.equal(getEngineVfxClassScale({ visual: { engineVfxClassScale: 0.5 } }), 0.5);
  assert.equal(getEngineVfxClassScale({ visual: { engineVfxClassScale: 99 } }), 1.25);
});
