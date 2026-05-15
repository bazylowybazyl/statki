import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactLightMarker,
  createEmptyLights,
  normalizeLightMarker,
  normalizeLightsBlock
} from '../src/ui/shipLightEditorModel.js';

test('position lights normalize to small red bloom markers', () => {
  const light = normalizeLightMarker({
    id: 'p1',
    x: 12.345,
    y: -8.765,
    power: 0,
    radius: 99,
    color: 'not-a-color'
  }, 'position');

  assert.deepEqual(light, {
    id: 'p1',
    x: 12.35,
    y: -8.77,
    color: '#ff2b2b',
    power: 0.8,
    radius: 12,
    sequenceGroup: 'edge'
  });
});

test('road lights preserve direction and beam controls', () => {
  const light = normalizeLightMarker({
    x: -40,
    y: 25,
    deg: 450,
    color: '#ABCDEF',
    power: 7,
    radius: 18,
    range: 1400,
    coneDeg: 4
  }, 'road', () => 'generated');

  assert.deepEqual(light, {
    id: 'generated',
    x: -40,
    y: 25,
    deg: 90,
    color: '#abcdef',
    power: 7,
    radius: 18,
    range: 1400,
    coneDeg: 8
  });
});

test('lights block keeps supported marker groups only', () => {
  const lights = normalizeLightsBlock({
    position: [
      { id: 'ok', x: 1, y: 2 },
      { id: 'bad', x: 'nope', y: 2 }
    ],
    road: [
      { id: 'road', x: 3, y: 4, deg: -181 }
    ],
    alarm: [
      { id: 'later', x: 5, y: 6 }
    ]
  });

  assert.equal(lights.position.length, 1);
  assert.equal(lights.road.length, 1);
  assert.equal(lights.road[0].deg, 179);
  assert.equal(lights.alarm, undefined);
});

test('compact light markers keep the stored schema minimal and explicit', () => {
  const empty = createEmptyLights();
  assert.deepEqual(empty, { position: [], road: [] });

  const position = compactLightMarker({
    id: 'p',
    x: 10.004,
    y: 20.006,
    color: '#ff2b2b',
    power: 0.8,
    radius: 4,
    sequenceGroup: 'edge'
  }, 'position');

  const road = compactLightMarker({
    id: 'r',
    x: -10,
    y: -20,
    deg: -45,
    color: '#ffffff',
    power: 3,
    radius: 14,
    range: 800,
    coneDeg: 40
  }, 'road');

  assert.deepEqual(position, {
    id: 'p',
    x: 10,
    y: 20.01,
    color: '#ff2b2b',
    power: 0.8,
    radius: 4,
    sequenceGroup: 'edge'
  });
  assert.deepEqual(road, {
    id: 'r',
    x: -10,
    y: -20,
    deg: -45,
    color: '#ffffff',
    power: 3,
    radius: 14,
    range: 800,
    coneDeg: 40
  });
});
