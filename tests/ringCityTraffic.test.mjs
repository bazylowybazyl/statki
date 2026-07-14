import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  SYNTHCITY_TRAFFIC_FAST_SPEED,
  SYNTHCITY_TRAFFIC_SPEED,
  createRingTrafficState,
  stepRingTrafficState,
  writeRingTrafficMatrix
} from '../src/3d/ringCityTraffic.js';

const layout = Object.freeze({
  inner: Object.freeze({ innerR: 1000, outerR: 1608 }),
  industrial: Object.freeze({ innerR: 1608, outerR: 2216 })
});

test('traffic preserves SynthCity speeds and deterministic typed-array state', () => {
  assert.equal(SYNTHCITY_TRAFFIC_SPEED, 72);
  assert.equal(SYNTHCITY_TRAFFIC_FAST_SPEED, 144);
  const a = createRingTrafficState(layout, { count: 32, seed: 9746 });
  const b = createRingTrafficState(layout, { count: 32, seed: 9746 });
  assert.deepEqual([...a.direction], [...b.direction]);
  assert.deepEqual([...a.variant], [...b.variant]);
  assert.deepEqual([...a.speed], [...b.speed]);
  assert.equal(createRingTrafficState(layout, { count: 0, seed: 1 }).count, 0);
});

test('sixty fixed steps travel the same tangential distance as one second', () => {
  const many = createRingTrafficState(layout, { count: 1, seed: 2 });
  const once = createRingTrafficState(layout, { count: 1, seed: 2 });
  for (const state of [many, once]) {
    state.direction[0] = 0;
    state.angle[0] = 1;
    state.speed[0] = SYNTHCITY_TRAFFIC_SPEED;
  }
  for (let i = 0; i < 60; i++) stepRingTrafficState(many, 1 / 60);
  stepRingTrafficState(once, 1);
  assert.ok(Math.abs(many.angle[0] - once.angle[0]) * many.surface.baseRadius < 0.01);
});

test('traffic wraps around the circumference and bounces inside ribbon width', () => {
  const state = createRingTrafficState(layout, { count: 2, seed: 4 });
  state.direction[0] = 0;
  state.angle[0] = Math.PI * 2 - 0.001;
  state.speed[0] = 144;
  state.direction[1] = 2;
  state.sourceRadius[1] = state.surface.sourceOuterRadius - 1;
  state.speed[1] = 144;
  stepRingTrafficState(state, 1);
  assert.ok(state.angle[0] >= 0 && state.angle[0] < Math.PI * 2);
  assert.equal(state.direction[1], 3);
  assert.ok(state.sourceRadius[1] >= state.surface.sourceInnerRadius);
  assert.ok(state.sourceRadius[1] <= state.surface.sourceOuterRadius);
});

test('traffic lanes snap to the 152/24 SynthCity road grid', () => {
  const state = createRingTrafficState(layout, { count: 256, seed: 19 });
  const width = state.surface.width;
  const ringDistance = (a, b, span) => {
    const d = Math.abs(a - b) % span;
    return Math.min(d, span - d);
  };
  for (let i = 0; i < state.count; i++) {
    if (state.direction[i] < 2) {
      const across = state.sourceRadius[i] - state.surface.sourceInnerRadius;
      let nearest = Infinity;
      for (let row = 0; row < 8; row++) {
        const center = ((row * 152 - 12) % width + width) % width;
        nearest = Math.min(nearest, ringDistance(across, center, width));
      }
      assert.ok(nearest <= 4.01);
    } else {
      const arc = state.angle[i] * state.surface.baseRadius;
      let nearest = Infinity;
      for (let col = 0; col < state.roadColumns; col++) {
        const center = ((col * state.roadPitch - 12) % state.surface.circumference + state.surface.circumference) % state.surface.circumference;
        nearest = Math.min(nearest, ringDistance(arc, center, state.surface.circumference));
      }
      assert.ok(nearest < 0.02);
    }
  }
});

test('vehicle model up axis points toward the planet and update reuses all buffers', () => {
  const state = createRingTrafficState(layout, { count: 4, seed: 8 });
  state.direction[0] = 0;
  state.angle[0] = Math.PI / 3;
  const matrix = new THREE.Matrix4();
  writeRingTrafficMatrix(state, 0, matrix);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
  const radial = new THREE.Vector3(Math.cos(state.angle[0]), Math.sin(state.angle[0]), 0);
  assert.ok(up.dot(radial) < -0.999999);

  const refs = {
    angle: state.angle,
    radius: state.sourceRadius,
    speed: state.speed,
    direction: state.direction,
    angleBuffer: state.angle.buffer
  };
  for (let i = 0; i < 1000; i++) stepRingTrafficState(state, 1 / 60);
  assert.equal(state.angle, refs.angle);
  assert.equal(state.sourceRadius, refs.radius);
  assert.equal(state.speed, refs.speed);
  assert.equal(state.direction, refs.direction);
  assert.equal(state.angle.buffer, refs.angleBuffer);
});
