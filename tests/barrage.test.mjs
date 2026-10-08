import test from 'node:test';
import assert from 'node:assert/strict';
import { planBarrageTargets } from '../src/game/barrage.js';
import { MASTER_WEAPONS, rocketSalvoSize } from '../src/data/weapons.js';

const getX = (e) => e.x;
const getY = (e) => e.y;
const ship = (x, y, hp = 1000) => ({ x, y, hp, shield: { val: 0 } });
const base = { radius: 6000, spacing: 1500, getX, getY };

test('Supernova Barrage: salwa 4 głowic z polem barrage', () => {
  const w = MASTER_WEAPONS.supernova_missile;
  assert.equal(rocketSalvoSize(w), 4);
  assert.equal(w.ammo, 2, 'magazynek: 2 salwy po 4');
  assert.ok(w.barrage && w.barrage.radius > w.explosionRadius && w.barrage.spacing >= w.explosionRadius);
});

test('każda głowica na inny okręt grupy, pierwsza w cel salwy', () => {
  const a = ship(0, 0), b = ship(2500, 0), c = ship(0, 2600), d = ship(-2400, -300);
  const out = planBarrageTargets({ ...base, count: 4, primary: a, cx: 0, cy: 0, candidates: [a, b, c, d] });
  assert.equal(out[0], a);
  assert.equal(new Set(out).size, 4);
});

test('okręty w zasięgu jednego wybuchu i poza promieniem grupy nie dostają osobnej głowicy', () => {
  const a = ship(0, 0, 5000), near = ship(600, 0), far = ship(20000, 0), b = ship(3000, 0, 200);
  const out = planBarrageTargets({ ...base, count: 4, primary: a, cx: 0, cy: 0, candidates: [a, near, far, b] });
  assert.ok(!out.includes(near) && !out.includes(far));
  assert.equal(out[1], b);
  // Reszta — w okręt o największej potrzebie (cel salwy).
  assert.equal(out[2], a);
  assert.equal(out[3], b);
});

test('sam cel: wszystkie głowice w niego', () => {
  const a = ship(0, 0);
  const out = planBarrageTargets({ ...base, count: 4, primary: a, cx: 0, cy: 0, candidates: [a] });
  assert.deepEqual(out, [a, a, a, a]);
});

test('salwa w punkt bez wroga: punkty na okręgu wokół celu', () => {
  const point = { x: 100, y: 200, dead: false, _isPositionTarget: true };
  const out = planBarrageTargets({ ...base, count: 4, primary: null, point, cx: 100, cy: 200, candidates: [] });
  assert.equal(out[0], point);
  for (let i = 1; i < 4; i++) {
    assert.ok(out[i]._isPositionTarget);
    assert.ok(Math.abs(Math.hypot(out[i].x - 100, out[i].y - 200) - 1500) < 1e-6);
  }
});
