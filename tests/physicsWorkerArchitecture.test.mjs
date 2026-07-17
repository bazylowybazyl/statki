import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const physicsWorker = readFileSync(new URL('../src/physics/workers/physics.worker.js', import.meta.url), 'utf8');
const aiWorker = readFileSync(new URL('../src/physics/workers/ai.worker.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/physics/physicsBridge.js', import.meta.url), 'utf8');

test('worker architecture has one physics owner and a separate pure AI worker', () => {
  assert.ok(physicsWorker.includes('new PhysicsKernel'));
  assert.ok(physicsWorker.includes('kernel.drainCommands'));
  assert.ok(physicsWorker.includes('writeBodySnapshot'));
  assert.ok(aiWorker.includes('new AiKernel'));
  assert.equal(physicsWorker.includes('document.'), false);
  assert.equal(aiWorker.includes('document.'), false);
  assert.equal(aiWorker.includes('window.'), false);
});

test('bridge uses lock-free rings and triple snapshots only when SAB is available', () => {
  assert.ok(bridge.includes('SpscFloat64Ring'));
  assert.ok(bridge.includes('TripleFloat32Buffer'));
  assert.ok(bridge.includes('crossOriginIsolated'));
  assert.equal(bridge.includes('Atomics.wait'), false);
});

test('legacy unconnected multithreading prototype is no longer imported by runtime code', () => {
  assert.equal(existsSync(new URL('../src/physics/PhysicsState.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/physics/PhysicsWorker.js', import.meta.url)), false);
  assert.equal(physicsWorker.includes('multithreading'), false);
  assert.equal(aiWorker.includes('multithreading'), false);
  assert.equal(bridge.includes('multithreading'), false);
});
