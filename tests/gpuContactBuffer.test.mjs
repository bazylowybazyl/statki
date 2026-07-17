import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuContactBuffer } from '../src/physics/gpuContactBuffer.js';
import { MAX_GPU_CONTACTS } from '../src/physics/protocol.js';
import { PhysicsKernel } from '../src/physics/physicsKernel.js';

test('GPU contact records preserve integer identities and validate tick/body revisions', () => {
  const contacts = new GpuContactBuffer({ capacity: 8 });
  contacts.beginWrite(44);
  contacts.push({
    bodyA: 7, bodyB: 9, shardA: 120001, shardB: 130002,
    tickId: 44, revisionA: 3, revisionB: 8,
    toi: 0.375, pointX: 12.5, pointY: -8, normalX: 1, normalY: 0, penetration: 2.25
  });
  contacts.publish();
  const record = {};
  assert.equal(contacts.readRecord(0, record), true);
  assert.equal(record.shardA, 120001);
  assert.equal(record.shardB, 130002);
  assert.ok(Math.abs(record.toi - 0.375) < 1e-6);
  assert.equal(contacts.validate(0, 44, (body) => body === 7 ? 3 : 8), true);
  assert.equal(contacts.validate(0, 43, () => 0), false);
});

test('contact overflow is explicit and queues the pair for safe OBB separation/retry', () => {
  const contacts = new GpuContactBuffer({ capacity: 2, overflowPairCapacity: 4 });
  contacts.beginWrite(10);
  assert.equal(contacts.push({ bodyA: 1, bodyB: 2, tickId: 10 }), true);
  assert.equal(contacts.push({ bodyA: 3, bodyB: 4, tickId: 10 }), true);
  assert.equal(contacts.push({ bodyA: 8, bodyB: 7, tickId: 10 }), false);
  assert.equal(contacts.overflow, true);
  assert.equal(contacts.dropped, 1);
  assert.equal(contacts.overflowPairs.count, 1);
  assert.equal(contacts.overflowPairs.bodyA[0], 7);
  assert.equal(contacts.overflowPairs.bodyB[0], 8);
});

test('the full 8192-record readback buffer is small and bounded', () => {
  const contacts = new GpuContactBuffer({ capacity: MAX_GPU_CONTACTS });
  assert.ok(contacts.memoryBytes < 1024 * 1024);
});

test('physics owner rejects stale GPU records and safely separates overflow pairs', () => {
  const kernel = new PhysicsKernel({ maxBodies: 8, maxProjectiles: 16, hexCapacity: 64, sharedArena: false });
  const a = kernel.spawnBody({ x: 0, radius: 20, mass: 100 });
  const b = kernel.spawnBody({ x: 10, radius: 20, mass: 100 });
  const contacts = new GpuContactBuffer({ capacity: 1 });
  contacts.beginWrite(5);
  contacts.push({ bodyA: a, bodyB: b, shardA: 0xffffffff, shardB: 0xffffffff, tickId: 5, revisionA: 0, revisionB: 0, normalX: 1, penetration: 3 });
  contacts.push({ bodyA: a, bodyB: b, tickId: 5 });
  contacts.publish();
  const before = kernel.bodyX[b] - kernel.bodyX[a];
  const result = kernel.consumeGpuContacts(contacts, 5);
  assert.deepEqual(result, { accepted: 1, stale: 0, overflowPairs: 1 });
  assert.ok(kernel.bodyX[b] - kernel.bodyX[a] > before);

  assert.equal(kernel.consumeGpuContacts(contacts, 6).stale, 1);
});
