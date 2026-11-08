// Geometria odłamków metalu (src/3d/metalDebrisGeometry.js) — pula odłamków kadłubów gry (hullDebris3D.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMetalDebrisGeometry } from '../src/3d/metalDebrisGeometry.js';

test('blacha i profil mają zamknięte przekroje, poprawne normalne i ograniczoną liczbę trójkątów', () => {
  for (const kind of ['plate', 'strut']) {
    const geometry = createMetalDebrisGeometry(kind);
    const p = geometry.attributes.position, n = geometry.attributes.normal, face = geometry.attributes.aFace;
    assert.ok(p.count / 3 <= 48, 'drobny debris musi pozostać tani');
    const edgeCounts = new Map();
    let volume = 0;
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      volume += a.dot(b.clone().cross(c)) / 6;
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(cross.length() > 1e-6, 'zdegenerowany trójkąt');
      cross.normalize();
      for (let j = 0; j < 3; j++) assert.ok(cross.dot(new THREE.Vector3().fromBufferAttribute(n, i + j)) > 0.999);
      const keys = [a, b, c].map(v => v.toArray().map(x => x.toFixed(6)).join(','));
      for (let j = 0; j < 3; j++) {
        const a = keys[j], b = keys[(j + 1) % 3], key = [a, b].sort().join('|');
        const edge = edgeCounts.get(key) || [0, 0];
        edge[0]++; edge[1] += a < b ? 1 : -1; edgeCounts.set(key, edge);
      }
    }
    assert.ok(volume > 0.001 && volume < 0.09, `niewłaściwa objętość ${kind}: ${volume}`);
    for (const [count, winding] of edgeCounts.values()) assert.deepEqual([count, winding], [2, 0], 'otwarta lub odwrócona krawędź');
    assert.ok(face.array.includes(0) && face.array.includes(1), 'brak podziału na lakier i przełom');
    geometry.dispose();
  }
});
