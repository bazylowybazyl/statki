// Zasięg radarów (2026-11-03): suma kół pokrycia dla UI — łuki brzegu, skupiska, krawędź najbliżej punktu
// (src/game/sensorCoverage.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../src/game/sensorCoverage.js');

const TAU = Math.PI * 2;

function build(circles) {
  const cov = C.createCoverage(2);
  C.beginCoverage(cov);
  circles.forEach(([x, y, r], i) => C.addCoverageCircle(cov, x, y, r, i));
  C.buildCoverage(cov);
  return cov;
}

function arcLenSum(cov) {
  let s = 0;
  for (let k = 0; k < cov.arcN; k++) s += (cov.arcA1[k] - cov.arcA0[k]) * cov.r[cov.arcCircle[k]];
  return s;
}

// LCG — testy bez Math.random
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('dwa rozłączne koła: dwa skupiska, dwa pełne okręgi', () => {
  const cov = build([[0, 0, 10], [100, 0, 20]]);
  assert.equal(cov.clusterN, 2);
  assert.equal(cov.arcN, 2);
  for (let k = 0; k < 2; k++) assert.ok(Math.abs(cov.arcA1[k] - cov.arcA0[k] - TAU) < 1e-12);
  assert.equal(cov.clusterTopY[cov.cluster[1]], -20);
});

test('dwa zachodzące równe koła: jeden obrys, długość brzegu jak ze wzoru', () => {
  const r = 10, d = 12;
  const cov = build([[0, 0, r], [d, 0, r]]);
  assert.equal(cov.clusterN, 1);
  assert.equal(cov.clusterCount[0], 2);
  assert.equal(cov.arcN, 2);
  const h = Math.acos(d / (2 * r));
  assert.ok(Math.abs(arcLenSum(cov) - 2 * (TAU - 2 * h) * r) < 1e-9);
  // łuk koła 0 przechodzi przez kąt π (lewy bok), łuk koła 1 przez kąt 0 — zszyty z dwóch kawałków [0, …] i […, 2π]
  const k1 = cov.arcCircle[0] === 1 ? 0 : 1;
  assert.ok(cov.arcA0[k1] < TAU && cov.arcA1[k1] > TAU, 'łuk przez kąt 0 jest jednym łukiem');
});

test('koło zawarte w innym: bez łuków, liczy się do skupiska; to samo koło dwa razy — jedno zostaje', () => {
  const cov = build([[0, 0, 50], [10, 5, 20], [0, 0, 50]]);
  assert.equal(cov.clusterN, 1);
  assert.equal(cov.clusterCount[0], 3);
  assert.deepEqual([...cov.alive.subarray(0, 3)], [1, 0, 0]);
  assert.equal(cov.arcN, 1);
  assert.equal(C.coverageCountAt(cov, 10, 5), 3);
});

test('losowe koła: łuki leżą na brzegu sumy, brzeg nie ma dziur (zgodność z siatką próbek)', () => {
  const rand = rng(12345);
  for (let trial = 0; trial < 20; trial++) {
    const circles = [];
    const n = 3 + Math.floor(rand() * 25);
    for (let i = 0; i < n; i++) circles.push([rand() * 200, rand() * 200, 5 + rand() * 45]);
    const cov = build(circles);
    const inside = (x, y) => circles.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
    const strictlyInside = (x, y, skip) => circles.some(([cx, cy, r], i) => i !== skip && (x - cx) ** 2 + (y - cy) ** 2 < (r - 1e-6) ** 2);
    for (let k = 0; k < cov.arcN; k++) {
      const i = cov.arcCircle[k];
      const [cx, cy, r] = circles[i];
      for (const f of [0.1, 0.5, 0.9]) {
        const a = cov.arcA0[k] + (cov.arcA1[k] - cov.arcA0[k]) * f;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        assert.ok(!strictlyInside(x, y, i), `łuk ${k} w środku innego koła (próba ${trial})`);
        assert.ok(!inside(cx + Math.cos(a) * (r + 1e-3), cy + Math.sin(a) * (r + 1e-3)), 'tuż za łukiem — poza sumą');
      }
    }
    // każdy punkt brzegu każdego koła, który nie leży w innych kołach, należy do któregoś łuku
    for (let i = 0; i < n; i++) {
      const [cx, cy, r] = circles[i];
      for (let s = 0; s < 64; s++) {
        const a = (s + 0.5) / 64 * TAU;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (circles.some(([qx, qy, qr], j) => j !== i && (x - qx) ** 2 + (y - qy) ** 2 <= (qr + 1e-6) ** 2)) continue;
        let on = false;
        for (let k = 0; k < cov.arcN && !on; k++) {
          if (cov.arcCircle[k] !== i) continue;
          let b = a - cov.arcA0[k];
          b -= Math.floor(b / TAU) * TAU;
          on = b <= cov.arcA1[k] - cov.arcA0[k] + 1e-9;
        }
        assert.ok(on, `odsłonięty punkt brzegu koła ${i} bez łuku (próba ${trial})`);
      }
    }
    // skupiska = składowe spójności grafu „koła zachodzą”
    const comp = circles.map((_, i) => i);
    const f = (i) => (comp[i] === i ? i : (comp[i] = f(comp[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const [ax, ay, ar] = circles[i], [bx, by, br] = circles[j];
      if ((ax - bx) ** 2 + (ay - by) ** 2 < (ar + br) ** 2) comp[f(i)] = f(j);
    }
    assert.equal(cov.clusterN, new Set(circles.map((_, i) => f(i))).size);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      assert.equal(cov.cluster[i] === cov.cluster[j], f(i) === f(j));
    }
  }
});

test('krawędź najbliżej punktu: w środku, na zewnątrz, w szwie dwóch kół', () => {
  const out = {};
  let cov = build([[0, 0, 100]]);
  C.nearestCoverageEdge(cov, 30, 40, out);
  assert.ok(out.inside);
  assert.ok(Math.abs(out.dist - 50) < 1e-9);
  assert.ok(Math.abs(out.x - 60) < 1e-9 && Math.abs(out.y - 80) < 1e-9);
  C.nearestCoverageEdge(cov, 0, -150, out);
  assert.ok(!out.inside);
  assert.ok(Math.abs(out.dist - 50) < 1e-9);
  // dwa koła: punkt w szwie — najbliższa krawędź to wierzchołek szwu, nie zakryty łuk wewnątrz sumy
  cov = build([[0, 0, 10], [12, 0, 10]]);
  C.nearestCoverageEdge(cov, 6, 0, out);
  assert.ok(out.inside);
  assert.ok(Math.abs(out.dist - Math.sqrt(100 - 36)) < 1e-9, `dist ${out.dist}`);
  const empty = build([]);
  C.nearestCoverageEdge(empty, 0, 0, out);
  assert.equal(out.arc, -1);
  assert.equal(out.inside, false);
});

test('koła z błędnymi danymi odpadają; bufory rosną', () => {
  const cov = C.createCoverage(1);
  C.beginCoverage(cov);
  assert.equal(C.addCoverageCircle(cov, 0, 0, 0), -1);
  assert.equal(C.addCoverageCircle(cov, NaN, 0, 5), -1);
  for (let i = 0; i < 300; i++) C.addCoverageCircle(cov, i * 30, 0, 10, i);
  C.buildCoverage(cov);
  assert.equal(cov.n, 300);
  assert.equal(cov.clusterN, 300);
  assert.equal(cov.arcN, 300);
  assert.equal(cov.tag[299], 299);
});

test('flota w kupie: koła mniejszych czujników leżą w kole okrętu flagowego — jeden łuk', () => {
  const rand = rng(7);
  const cov = C.createCoverage();
  C.beginCoverage(cov);
  C.addCoverageCircle(cov, 0, 0, 58500);
  for (let i = 0; i < 40; i++) C.addCoverageCircle(cov, (rand() - 0.5) * 8000, (rand() - 0.5) * 8000, 23400 + rand() * 15000);
  C.buildCoverage(cov);
  assert.equal(cov.clusterN, 1);
  assert.equal(cov.clusterCount[0], 41);
  assert.equal(cov.arcN, 1);
});

test('grupy znaczników: bliskie punkty w jednej grupie, kotwica = pierwszy', () => {
  const g = C.createPointGroups(1);
  const xs = [0, 5, 100, 104, 300, 3];
  const ys = [0, 0, 0, 3, 0, 4];
  C.groupPoints(g, xs, ys, xs.length, 10);
  assert.equal(g.n, 3);
  assert.deepEqual([...g.groupOf.subarray(0, 6)], [0, 0, 1, 1, 2, 0]);
  assert.equal(g.count[0], 3);
  assert.ok(Math.abs(g.cx[0] - 8 / 3) < 1e-12);
  assert.equal(g.ax[1], 100);
});
