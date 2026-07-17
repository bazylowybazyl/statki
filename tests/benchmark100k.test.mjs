import test from 'node:test';
import assert from 'node:assert/strict';
import { run100kBenchmark } from '../src/benchmark/benchmark100k.js';

test('deterministic 100k scenario fills the arena, sustains hull contact and stays in memory budget', () => {
  const result = run100kBenchmark({ warmupTicks: 2, measuredTicks: 12, projectileCount: 500 });
  assert.equal(result.totalHexes, 100000);
  assert.equal(result.activeHexes, 100000);
  assert.equal(result.bodies, 12);
  assert.equal(result.contactTicks, 14);
  assert.equal(result.commandBacklog, 0);
  assert.ok(result.projectilesRemaining > 0);
  assert.ok(result.structuralCpuBytes <= 48 * 1024 * 1024);
  assert.ok(result.estimatedGpuStructuralBytes <= 48 * 1024 * 1024);
});
