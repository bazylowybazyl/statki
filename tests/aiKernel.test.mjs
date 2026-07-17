import test from 'node:test';
import assert from 'node:assert/strict';

import { AiKernel } from '../src/physics/aiKernel.js';
import { SpscFloat64Ring } from '../src/physics/sharedBuffers.js';
import { AI_COMMAND, AI_COMMAND_STRIDE, AI_SNAPSHOT_STRIDE, BODY_FLAGS } from '../src/physics/protocol.js';

function writeEntity(snapshot, record, data) {
  const offset = record * AI_SNAPSHOT_STRIDE;
  snapshot[offset] = data.id;
  snapshot[offset + 1] = data.generation || 1;
  snapshot[offset + 2] = data.team;
  snapshot[offset + 3] = data.flags || 0;
  snapshot[offset + 4] = data.x || 0;
  snapshot[offset + 5] = data.y || 0;
  snapshot[offset + 6] = data.vx || 0;
  snapshot[offset + 7] = data.vy || 0;
  snapshot[offset + 8] = data.angle || 0;
  snapshot[offset + 9] = data.target || 0;
  snapshot[offset + 10] = data.projectileSpeed || 600;
  snapshot[offset + 11] = data.turnRate || 1;
  snapshot[offset + 12] = data.weaponRange || 1200;
  snapshot[offset + 15] = data.importance || 0;
}

test('AI kernel emits deterministic control and fire commands without DOM state', () => {
  const commands = new SpscFloat64Ring({ capacity: 16, stride: AI_COMMAND_STRIDE, shared: false });
  const kernel = new AiKernel({ maxEntities: 8, commandRing: commands });
  const snapshot = new Float32Array(AI_SNAPSHOT_STRIDE * 2);
  writeEntity(snapshot, 0, { id: 10, team: 1, x: 0, y: 0, target: 20, weaponRange: 1000, flags: BODY_FLAGS.IN_CONTACT });
  writeEntity(snapshot, 1, { id: 20, team: 2, x: 500, y: 0 });
  const perf = kernel.step(snapshot, 2, 1);
  assert.equal(perf.decisions, 2);

  const out = new Float64Array(AI_COMMAND_STRIDE);
  assert.equal(commands.pop(out), true);
  assert.equal(out[0], AI_COMMAND.CONTROL);
  assert.equal(out[2], 10);
  assert.equal(out[6], 20);
  assert.equal(out[7], 1);
  assert.ok(out[4] >= 0);
});
