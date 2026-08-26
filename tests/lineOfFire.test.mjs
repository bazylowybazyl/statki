import assert from 'node:assert/strict';
import test from 'node:test';

import { isFriendlyLineOfFireBlocked } from '../src/ai/lineOfFire.js';

const shooter = { x: 0, y: 0, friendly: true };
const target = { x: 1000, y: 0, friendly: false };

test('line of fire is blocked by an allied hull crossing the shot segment', () => {
  const ally = { x: 500, y: 10, radius: 40, friendly: true };
  const query = () => ({ buffer: [ally], count: 1 });

  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 1200, query, [], null), true);
});

test('line of fire ignores enemies and allies outside the shot corridor', () => {
  const enemy = { x: 400, y: 0, radius: 100, friendly: false };
  const distantAlly = { x: 500, y: 300, radius: 40, friendly: true };
  const query = () => ({ buffer: [enemy, distantAlly], count: 2 });

  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 1200, query, [], null), false);
});

test('line of fire reads player positions stored in pos', () => {
  const player = { pos: { x: 400, y: 0 }, radius: 50, friendly: true };
  const query = () => ({ buffer: [player], count: 1 });

  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 1200, query, [], player), true);
});

test('line of fire spatial query covers the whole segment plus capital padding', () => {
  let queryArgs = null;
  const query = (x, y, radius) => {
    queryArgs = { x, y, radius };
    return { buffer: [], count: 0 };
  };

  isFriendlyLineOfFireBlocked(shooter, target, 800, query, [], null);

  assert.deepEqual(queryArgs, { x: 400, y: 0, radius: 1600 });
});

test('line of fire fallback scans player and NPC list without a grid', () => {
  const ally = { x: 300, y: 0, radius: 30, friendly: true };
  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 1200, null, [ally], null), true);
});
