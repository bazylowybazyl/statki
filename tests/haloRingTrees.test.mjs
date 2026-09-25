// Gatunki drzew ringu (haloRingCity.makeTreeKit): geometria, budżet, nawinięcie — bez GPU.
// node --test tests/haloRingTrees.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { HALO_TREE_SPECIES, makeTreeKit } from '../src/3d/haloRing/haloRingCity.js';

function kit() {
  const g = makeTreeKit();
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const S = g.getAttribute('aSpecies');
  const v = (i) => [P.getX(i), P.getY(i), P.getZ(i)];
  const n = (i) => [N.getX(i), N.getY(i), N.getZ(i)];
  return { g, P, N, S, v, n, idx: Array.from(g.index.array) };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('drzewa: jedna geometria indeksowana — pień wspólny + 4 gatunki, w budżecie dawnego drzewa', () => {
  const { g, P, S, N, idx } = kit();
  assert.deepEqual([...HALO_TREE_SPECIES], ['broadleaf', 'conifer', 'poplar', 'palm']);
  // dawne drzewo: korona z ikosaedru bez indeksów (240) + pień (30) na instancję
  assert.ok(P.count <= 270, `wierzchołków ${P.count}`);
  assert.ok(g.index && idx.length % 3 === 0);
  for (const i of idx) assert.ok(i >= 0 && i < P.count);
  const counts = new Map();
  for (let i = 0; i < S.count; i++) counts.set(S.getX(i), (counts.get(S.getX(i)) || 0) + 1);
  assert.deepEqual([...counts.keys()].sort((a, b) => a - b), [-1, 0, 1, 2, 3]);
  for (let i = 0; i < N.count; i++) assert.ok(Math.abs(Math.hypot(N.getX(i), N.getY(i), N.getZ(i)) - 1) < 1e-5, 'normalna jednostkowa');
  // trójkąt należy do jednego gatunku (shader zwija gatunki niezależnie)
  for (let t = 0; t < idx.length; t += 3) {
    const s = S.getX(idx[t]);
    assert.ok(S.getX(idx[t + 1]) === s && S.getX(idx[t + 2]) === s, 'trójkąt z dwóch gatunków');
  }
});

test('drzewa: proporcje (korony w ułamkach wysokości, pień jednostkowy)', () => {
  const { P, S } = kit();
  const ext = new Map();
  for (let i = 0; i < P.count; i++) {
    const s = S.getX(i);
    const e = ext.get(s) || { zMin: Infinity, zMax: -Infinity, r: 0 };
    e.zMin = Math.min(e.zMin, P.getZ(i));
    e.zMax = Math.max(e.zMax, P.getZ(i));
    e.r = Math.max(e.r, Math.hypot(P.getX(i), P.getY(i)));
    ext.set(s, e);
  }
  const trunk = ext.get(-1);
  assert.ok(trunk.zMin === 0 && trunk.zMax === 1 && trunk.r <= 1 + 1e-5, `pień jednostkowy (r ${trunk.r})`);
  for (let s = 0; s < 4; s++) {
    const e = ext.get(s);
    assert.ok(e.zMin >= 0 && e.zMax <= 1.001, `${HALO_TREE_SPECIES[s]}: z ${e.zMin.toFixed(2)}..${e.zMax.toFixed(2)}`);
    assert.ok(e.r <= 0.5, `${HALO_TREE_SPECIES[s]}: promień ${e.r.toFixed(2)}`);
  }
  // sylwetki: topola najwęższa, palma z pióropuszem u szczytu, iglaste od nisko
  assert.ok(ext.get(2).r < 0.2, 'topola wąska');
  assert.ok(ext.get(3).zMin > 0.7, 'palma: liście tylko u szczytu');
  assert.ok(ext.get(1).zMin < 0.2 && ext.get(1).zMax >= 0.99, 'iglaste od dołu po czubek');
});

test('drzewa: nawinięcie zgodne z normalnymi (liście palmy zamknięte spodem — widać z obu stron)', () => {
  const { S, v, n, idx } = kit();
  let palmUp = 0;
  let palmDown = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const fn = cross(sub(v(b), v(a)), sub(v(c), v(a)));
    const na = n(a);
    const nb = n(b);
    const nc = n(c);
    const avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (S.getX(a) === 3) {
      if (fn[2] > 0) palmUp++;
      else palmDown++;
      continue;
    }
    assert.ok(dot(fn, avg) > 0, `gatunek ${S.getX(a)}: trójkąt ${t / 3} odwrócony`);
  }
  assert.ok(palmUp >= 35 && palmDown >= 14, `palma: wierzch ${palmUp}, spód ${palmDown}`);
});
