import test from 'node:test';
import assert from 'node:assert/strict';
import { BeamCrashBenchmark } from '../src/game/beamCrashBenchmark.js';

test('benchmark reports wall-clock FPS and lost simulation time, then freezes the result', () => {
  const b = new BeamCrashBenchmark(1000);
  b.start();
  for (let i = 0; i < 20; i++) b.record(50, 40, 10, 20, 3, 2);
  assert.equal(b.running, false);
  assert.equal(b.finished, true);
  assert.equal(b.fps, 20);
  assert.equal(b.simulationRate, 0.8);
  assert.equal(b.droppedMs, 200);
  assert.equal(b.physicsMs / b.frames, 20);
  assert.equal(b.syncMs / b.frames, 3);
  assert.equal(b.renderMs / b.frames, 2);
  b.record(500, 40, 460, 20, 3, 2);
  assert.equal(b.wallMs, 1000);
});

test('p95 distinguishes recurring stalls from a single worst frame and a repeat clears all measurements', () => {
  const b = new BeamCrashBenchmark(10000);
  const storage = b.samples;
  b.start();
  for (let i = 0; i < 93; i++) b.record(4, 4, 0, 1, 1, 1);
  for (let i = 0; i < 6; i++) b.record(30, 30, 0, 10, 2, 1);
  b.record(200, 40, 160, 30, 4, 2);
  b.finish();
  assert.equal(b.p95, 30);
  assert.equal(b.maxFrameMs, 200);
  b.start();
  assert.equal(b.samples, storage, 'repeats reuse the frame buffer');
  assert.equal(b.frames + b.wallMs + b.simMs + b.droppedMs + b.p95 + b.maxFrameMs, 0);
  assert.equal(b.physicsMs + b.syncMs + b.renderMs, 0);
  assert.equal(b.finished, false);
  assert.equal(b.running, true);
});
