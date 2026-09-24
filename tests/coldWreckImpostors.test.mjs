import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareColdWreckImpostor, pushColdWreckImpostors } from '../src/3d/coldWreckImpostors.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function fakeBatch(capacity, used = 0) {
  const pushed = [];
  return {
    MAX_IMPOSTORS: capacity,
    pushed,
    getCount: () => used + pushed.length,
    pushRaw(...args) {
      if (used + pushed.length >= capacity) return false;
      pushed.push(args);
      return true;
    }
  };
}

function coldAt(x, y, halfW = 40, halfH = 20) {
  const snapshot = { extent: { halfW, halfH, cx: 0, cy: 0 }, color: { r: 0.2, g: 0.3, b: 0.4 } };
  prepareColdWreckImpostor(snapshot, x, y, 0, 1, 1);
  return { x, y, _coldSnapshot: snapshot };
}

test('smuga zimnego wraku = smuga gorącego: to samo przekształcenie co updateEntityMesh', () => {
  const snapshot = { extent: { halfW: 30, halfH: 12, cx: 10, cy: -4 }, color: { r: 0.5, g: 0.25, b: 0.125 } };
  const ex = 1000, ey = -250, angle = 0.6, sx = 2, sy = 3;
  const rot = -angle;
  const imp = prepareColdWreckImpostor(snapshot, ex, ey, rot, sx, sy);
  // updateEntityMesh: offX = cx·sx, offY = -cy·sy; x = ex + offX·cos − offY·sin; y = −ey + offX·sin + offY·cos.
  const offX = 10 * sx;
  const offY = 4 * sy;
  assert.ok(Math.abs(imp.x - (ex + offX * Math.cos(rot) - offY * Math.sin(rot))) < 1e-9);
  assert.ok(Math.abs(imp.y - (-ey + offX * Math.sin(rot) + offY * Math.cos(rot))) < 1e-9);
  assert.equal(imp.halfW, 60);
  assert.equal(imp.halfH, 36);
  assert.equal(imp.rot, rot);
  assert.deepEqual([imp.r, imp.g, imp.b], [0.5, 0.25, 0.125]);
  assert.equal(imp.wy, -imp.y, 'środek do cullingu w układzie świata');
  assert.equal(snapshot.impostor, imp);
});

test('tylko zimne w kadrze trafiają do batcha, z kryciem „tła”', () => {
  const list = [coldAt(0, 0), coldAt(900, 0), coldAt(5000, 0), coldAt(0, -3000), { x: 1, y: 1, _coldSnapshot: null }];
  const batch = fakeBatch(100);
  const cull = { x: 0, y: 0, drawHalfW: 1000, drawHalfH: 800, halfW: 3000, halfH: 2400 };
  const pushed = pushColdWreckImpostors(batch, list, cull, 0.7);
  assert.equal(pushed, 2);
  assert.deepEqual(batch.pushed.map(args => args[0]), [0, 900]);
  assert.ok(batch.pushed.every(args => args.length === 9 && args[8] === 0.7));
});

test('pełny batch: culling po odległości od środka kadru, nie wyjątek', () => {
  const list = [];
  for (let i = 0; i < 12; i++) list.push(coldAt((i % 2 ? 1 : -1) * i * 50, 0));
  const cull = { x: 0, y: 0, drawHalfW: 5000, drawHalfH: 5000 };
  const batch = fakeBatch(20, 15); // 15 zajmują gorące wraki — zostaje 5
  const pushed = pushColdWreckImpostors(batch, list, cull, 0.7);
  assert.equal(pushed, 5);
  const xs = batch.pushed.map(args => Math.abs(args[0])).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 50, 100, 150, 200], 'najbliższe środkowi');
  assert.equal(pushColdWreckImpostors(fakeBatch(20, 20), list, cull, 0.7), 0, 'brak miejsca = nic');
  // Drugi raz (bufor odległości już jest) — ten sam wynik.
  const again = fakeBatch(20, 15);
  pushColdWreckImpostors(again, list, cull, 0.7);
  assert.deepEqual(again.pushed.map(args => Math.abs(args[0])).sort((a, b) => a - b), xs);
});

test('hexShips3D: przebieg zimnych przed flush batcha, bez listy encji; eksporty dla zamrażania', () => {
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /export function updateHexShips3D\(viewCamera, entities = \[\], cullInfo = null, coldWrecks = null\)/);
  assert.match(hex, /pushColdWreckImpostors\(HexBodyImpostorBatch, coldWrecks, cullInfo, COLD_WRECK_CONFIG\.impostorOpacity\);[\s\S]*?HexBodyImpostorBatch\.flush\(\);/);
  assert.match(hex, /export function isColdFreezeVisuallySafe\(entity\)/);
  assert.match(hex, /export function captureColdWreckImpostor\(entity, snapshot\)/);
  const batch = read('src/3d/hexBodyImpostorBatch.js');
  assert.match(batch, /pushRaw\(x, y, rot, halfW, halfH, r, g, b, opacity\) \{/);
  assert.match(batch, /push\(p\) \{\s*return this\.pushRaw\(/);
});
