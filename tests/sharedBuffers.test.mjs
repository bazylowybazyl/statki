import test from 'node:test';
import assert from 'node:assert/strict';

import { SpscFloat64Ring, TripleFloat32Buffer } from '../src/physics/sharedBuffers.js';

test('SPSC ring preserves fixed records and reports overflow', () => {
  const ring = new SpscFloat64Ring({ capacity: 4, stride: 3, shared: false });
  assert.equal(ring.push([1, 2, 3]), true);
  assert.equal(ring.push([4, 5, 6]), true);
  assert.equal(ring.push([7, 8, 9]), true);
  assert.equal(ring.push([10, 11, 12]), false);
  assert.equal(ring.dropped, 1);

  const out = new Float64Array(3);
  assert.equal(ring.pop(out), true);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
  assert.equal(ring.push([10, 11, 12]), true);
  assert.equal(ring.size, 3);
});

test('triple buffer publishes only complete pages', () => {
  const snapshots = new TripleFloat32Buffer({ length: 4, shared: false });
  const write = snapshots.beginWrite();
  write.page.set([10, 20, 30, 40]);
  snapshots.publish(write.pageIndex, 77);
  const latest = snapshots.readLatest();
  assert.equal(latest.tick, 77);
  assert.equal(latest.sequence, 1);
  assert.deepEqual(Array.from(latest.page), [10, 20, 30, 40]);
});
