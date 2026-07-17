import test from 'node:test';
import assert from 'node:assert/strict';

import { AdaptiveSimulationScheduler, SIMULATION_TIER } from '../src/physics/adaptiveScheduler.js';
import { BODY_FLAGS } from '../src/physics/protocol.js';

test('critical bodies promote immediately and distant bodies demote with hysteresis', () => {
  const scheduler = new AdaptiveSimulationScheduler(4);
  scheduler.reset(0, 0, SIMULATION_TIER.VISIBLE);
  assert.equal(scheduler.classify(0, { flags: BODY_FLAGS.PLAYER }, 1), SIMULATION_TIER.CRITICAL);

  assert.equal(scheduler.classify(0, { flags: 0, distance: 20000, speed: 20 }, 2), SIMULATION_TIER.CRITICAL);
  assert.equal(scheduler.classify(0, { flags: 0, distance: 20000, speed: 20 }, 121), SIMULATION_TIER.CRITICAL);
  assert.equal(scheduler.classify(0, { flags: 0, distance: 20000, speed: 20 }, 122), SIMULATION_TIER.OFFSCREEN);
});

test('predicted contact promotes before collision and cadence matches its tier', () => {
  const scheduler = new AdaptiveSimulationScheduler(2);
  scheduler.reset(0, 0, SIMULATION_TIER.OFFSCREEN);
  assert.equal(scheduler.classify(0, { timeToContact: 0.4 }, 10), SIMULATION_TIER.CRITICAL);

  let steps = 0;
  for (let tick = 10; tick < 20; tick++) if (scheduler.shouldStep(0, tick)) steps++;
  assert.equal(steps, 10);
  assert.equal(scheduler.getPhysicsHz(0), 120);
  assert.equal(scheduler.getAiHz(0), 30);
});

test('budget pressure only degrades noncritical work', () => {
  const scheduler = new AdaptiveSimulationScheduler(2, { demotionDelaySeconds: 0 });
  scheduler.reset(0, 0, SIMULATION_TIER.VISIBLE);
  scheduler.reset(1, 0, SIMULATION_TIER.CRITICAL);
  assert.equal(scheduler.classify(0, { flags: BODY_FLAGS.VISIBLE, distance: 10000 }, 1, 1), SIMULATION_TIER.VISIBLE);
  assert.equal(scheduler.classify(0, { flags: BODY_FLAGS.VISIBLE, distance: 10000 }, 2, 1), SIMULATION_TIER.OFFSCREEN);
  assert.equal(scheduler.classify(1, { flags: BODY_FLAGS.PLAYER }, 1, 2), SIMULATION_TIER.CRITICAL);
});
