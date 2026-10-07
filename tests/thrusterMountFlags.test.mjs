// Flagi mocowania dysz SIDE z pamięci (2026-10-07, koszt stanu dysz w bitwie): te same co wyrażenia na napisie
// mocowania (toLowerCase + endsWith / startsWith), także po zmianie `mount` / `side` w miejscu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ThrusterMountInternals as M } from '../src/game/flight/thrusterModel.js';

const MOUNTS = ['front_left', 'FRONT_LEFT', 'upper_right', 'rear_left', 'lower_right', 'center_left', 'center_right', 'Center_Right',
  'left', 'right', '', null, undefined, 0, 'rear_', 'front_left_x', '_left', '_right', 'side_l'];
const SIDES = ['left', 'right', '', null, undefined, 'LEFT'];

function expected(t) {
  const mount = String(t.mount || '').toLowerCase();
  let f = 0;
  if (mount.endsWith('_left') || t.side === 'left') f |= M.SIDE_MOUNT_LEFT;
  if (mount.endsWith('_right') || t.side === 'right') f |= M.SIDE_MOUNT_RIGHT;
  if (mount.startsWith('front_') || mount.startsWith('upper_')) f |= M.SIDE_MOUNT_FRONT;
  if (mount.startsWith('rear_') || mount.startsWith('lower_')) f |= M.SIDE_MOUNT_REAR;
  if (mount.startsWith('center_')) f |= M.SIDE_MOUNT_CENTER;
  if (!mount) f |= M.SIDE_MOUNT_NONE;
  return f;
}

test('flagi mocowania dyszy SIDE z pamięci = wyrażenia na napisie (także po zmianie w miejscu)', () => {
  let n = 0;
  for (const mount of MOUNTS) {
    for (const side of SIDES) {
      const t = { mount, side };
      assert.equal(M.sideMountFlags(t), expected(t));
      assert.equal(M.sideMountFlags(t), expected(t), 'z pamięci');
      for (const m2 of ['rear_right', '', 'upper_left']) {
        t.mount = m2;
        assert.equal(M.sideMountFlags(t), expected(t), `po zmianie mount → ${m2}`);
      }
      t.side = side === 'left' ? 'right' : 'left';
      assert.equal(M.sideMountFlags(t), expected(t), 'po zmianie side');
      n++;
    }
  }
  assert.ok(n > 100);
});
