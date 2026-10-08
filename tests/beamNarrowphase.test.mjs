import test from 'node:test';
import assert from 'node:assert/strict';

// Narrowphase silnika belek (audyt wydajności 2026-10-07 § 5.5): skan tylko po kandydatach z obszaru
// nakładania, siatka węzłów żyjąca do zmiany kształtu, pominięcie kolejnej iteracji pary bez styku,
// para co k-ty krok z haka pairFilter. Kontakty, ich kolejność i kursor jak przy pełnym przeglądzie.
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';

const CS = 0.5;
const BOX = buildBeamStructure(voxelizeTriangles(makeBoxTriangles(4, 2, 3, 0.05, 0.05, 0.05), null, { cellSize: CS, shellLayers: 0 }),
  { cellMassBase: 10, frameStride: 1, bulkheadEvery: 8 });
const BAR = buildBeamStructure(voxelizeTriangles(makeBoxTriangles(6, 1, 1, 0.05, 0.05, 0.05), null, { cellSize: CS, shellLayers: 0 }),
  { cellMassBase: 10, frameStride: 1, bulkheadEvery: 8 });

function fresh(overrides = {}) {
  const cfg = createBeamConfig(CS);
  Object.assign(cfg, overrides);
  D.init(cfg);
  D.onDebris = null;
  D.pairFilter = null;
  D.onContact = null;
  return cfg;
}

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const quat = () => { const x = rnd() - 0.5, y = rnd() - 0.5, z = rnd() - 0.5, w = rnd() - 0.5, n = Math.hypot(x, y, z, w); return { x: x / n, y: y / n, z: z / n, w: w / n }; };
const unit = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); return { x: r * Math.cos(a), y: r * Math.sin(a), z }; };

// Węzły iterowanego ciała, które mają węzeł drugiego bliżej niż contactDist (świat), w kolejności skanu
// od kursora; `near` — odległość leży w pasie zaokrągleń wokół progu (pomijane w porównaniu).
function bruteForce(A, B, start) {
  const iter = A.activeNodes > B.activeNodes ? B : A, holder = iter === A ? B : A;
  const cd = (A.cellSize + B.cellSize) * (D.config.nodeRadius / D.config.cellSize);
  const world = (b, i) => {
    const m = D._refreshRot(b), s = b.nodeStore;
    return [m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i] + b.pos.x, m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i] + b.pos.y,
      m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i] + b.pos.z];
  };
  const hs = holder.nodeStore, hw = [];
  for (let h = 0; h < hs.count; h++) if (hs.active[h]) hw.push(world(holder, h));
  const is = iter.nodeStore, total = is.count, order = [], near = new Set();
  for (let k = 0; k < total; k++) {
    const i = (start + k) % total;
    if (!is.active[i]) continue;
    const p = world(iter, i);
    let best = Infinity;
    for (const q of hw) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    if (Math.abs(best - cd) < 1e-6) near.add(i);
    else if (best < cd) order.push(i);
  }
  return { iter, order, near };
}

test('kandydaci z obszaru nakładania: kontakty, kolejność skanu i kursor jak pełny przegląd (świat 7 mln j.)', () => {
  let withContacts = 0, truncated = 0;
  for (let trial = 0; trial < 60; trial++) {
    const maxContacts = trial % 3 === 0 ? 8 : 10000;
    fresh({ maxContacts, separationPercent: 0 });
    const base = { x: 7e6 + rnd() * 1e5, y: -3e6 + rnd() * 1e5, z: rnd() * 1e3 };
    const A = D.createBody(cloneBeamStructure(trial % 2 ? BOX : BAR), { position: base, quaternion: quat() });
    const B = D.createBody(cloneBeamStructure(BOX), { quaternion: quat() });
    // Odstęp środków: od głębokiego nałożenia do ledwie nachodzących sfer.
    const dir = unit(), dist = (A.radius + B.radius) * (0.15 + rnd() * 0.7);
    B.pos.x = base.x + dir.x * dist; B.pos.y = base.y + dir.y * dist; B.pos.z = base.z + dir.z * dist;
    const iter = A.activeNodes > B.activeNodes ? B : A;
    iter._contactCursor = (rnd() * iter.nodeStore.count) | 0;
    const start = iter._contactCursor % iter.nodeStore.count;
    const ref = bruteForce(A, B, start);
    const c0 = D.perf.contacts;
    const n = D.collideBodies(A, B, 1 / 120, true);
    assert.equal(n, D.perf.contacts - c0, 'collideBodies zwraca liczbę kontaktów');
    const got = Array.from((iter === A ? A._contacts : B._contacts).slice(0, n));
    const expected = ref.order.slice(0, Math.max(8, maxContacts));
    // Węzły w pasie zaokrągleń wokół progu mogą wejść albo nie — porównanie bez nich.
    assert.deepEqual(got.filter((i) => !ref.near.has(i)), expected.filter((i) => !ref.near.has(i)), `próba ${trial}`);
    if (n > 0) withContacts++;
    if (ref.order.length > Math.max(8, maxContacts) && !ref.near.size) {
      truncated++;
      assert.equal(iter._contactCursor, got[got.length - 1] + 1, 'kursor za ostatnim kontaktem limitu');
    }
  }
  assert.ok(withContacts > 20 && truncated > 3, `próby ze stykiem ${withContacts}, z limitem ${truncated}`);
});

test('siatka węzłów żyje między krokami do zmiany kształtu (solver, zgniot, widok, zniszczenie węzła)', () => {
  fresh({ localSolver: true });
  // Narożniki na skos: pudła nachodzą na siebie z marginesem styku (para dochodzi do skanu), najbliższe
  // węzły 0,45·√2 ≈ 0,64 > contactDist 0,55.
  const A = D.createBody(cloneBeamStructure(BOX), { position: { x: 0, y: 0, z: 0 } });
  const B = D.createBody(cloneBeamStructure(BOX), { position: { x: 4.45, y: 1.95, z: 0 } });
  const bodies = [A, B];
  const np0 = D.perf.narrowphasePairs;
  for (let k = 0; k < 3; k++) D.update(1 / 120, bodies);      // solver lokalny usypia nieruszone bryły
  assert.ok(A.isSleeping && B.isSleeping);
  assert.equal(D.perf.narrowphasePairs - np0 >= 1, true);
  assert.equal(bruteForce(A, B, 0).order.length, 0, 'para bez styku');
  const holder = A.activeNodes > B.activeNodes ? A : B;
  const built = D._refreshHash(holder), tick = holder._hashTick;
  for (let k = 0; k < 10; k++) D.update(1 / 120, bodies);
  assert.equal(holder._hashTick, tick, 'śpiący gospodarz bez styku nie przebudowuje siatki co krok');
  assert.equal(D._refreshHash(holder), built);
  // Zapis przez widok węzła (kod spoza silnika) — siatka widzi nowe położenie.
  const s = holder.nodeStore, i = s.count - 1, view = holder.nodes[i];
  view.x += 40;
  const g = D._refreshHash(holder);
  assert.notEqual(holder._hashTick, -1);
  assert.equal(g.maxX, s.x[i], 'granice siatki z bieżących położeń');
  const cell = Math.floor(s.x[i] / holder.cellSize) - g.i0 + g.nx * ((Math.floor(s.y[i] / holder.cellSize) - g.j0) +
    g.ny * (Math.floor(s.z[i] / holder.cellSize) - g.k0));
  let found = false;
  for (let h = g.heads[cell]; h >= 0; h = s.hashNext[h]) if (h === i) found = true;
  assert.ok(found, 'przesunięty węzeł w swoim kubełku');
  // Zniszczenie węzła unieważnia siatkę.
  D.destroyNode(holder, i);
  assert.equal(holder._hashTick, -1);
  const g2 = D._refreshHash(holder);
  assert.ok(g2.maxX < s.x[i], 'martwy węzeł wypada z granic');
});

test('para bez styku: druga iteracja kolizji pominięta, para ze stykiem liczona w obu', () => {
  fresh({ collisionIterations: 2 });
  // Pręty narożnikami na skos: pudła nachodzą na siebie z marginesem styku, węzły dalej niż contactDist.
  const far = [D.createBody(cloneBeamStructure(BAR), { position: { x: 0, y: 0, z: 0 } }),
    D.createBody(cloneBeamStructure(BAR), { position: { x: 6.45, y: 1.45, z: 0 } })];
  assert.equal(bruteForce(far[0], far[1], 0).order.length, 0, 'pręty bez styku');
  const touching = [D.createBody(cloneBeamStructure(BOX), { position: { x: 100, y: 0, z: 0 } }),
    D.createBody(cloneBeamStructure(BOX), { position: { x: 103.6, y: 0, z: 0 }, velocity: { x: -40, y: 0, z: 0 } })];
  const bodies = [...far, ...touching];
  const calls = new Map();
  const orig = D.collideBodies;
  D.collideBodies = function (A, B, dt, doDamage) {
    const key = A === far[0] || B === far[0] ? 'bez styku' : 'styk';
    const n = orig.call(this, A, B, dt, doDamage);
    const e = calls.get(key) || { calls: 0, contacts: 0 };
    e.calls++; e.contacts += n;
    calls.set(key, e);
    return n;
  };
  try {
    D.update(1 / 120, bodies);
  } finally { D.collideBodies = orig; }
  assert.deepEqual(calls.get('bez styku'), { calls: 1, contacts: 0 }, 'para bez styku: jedna iteracja');
  assert.equal(calls.get('styk').calls, 2, 'para ze stykiem: obie iteracje');
  assert.ok(calls.get('styk').contacts > 0);
});

test('pairFilter → k: para liczona co k-ty krok (faza z id ciał) z krokiem k · dt; true / 1 = co krok', () => {
  fresh({ collisionIterations: 1 });
  const A = D.createBody(cloneBeamStructure(BOX), { position: { x: 0, y: 0, z: 0 } });
  const B = D.createBody(cloneBeamStructure(BOX), { position: { x: 3.9, y: 0.1, z: 0 } });
  const seen = [];
  const orig = D.collideBodies;
  D.collideBodies = function (a, b, dt, doDamage) { seen.push({ tick: this._tick, dt }); return orig.call(this, a, b, dt, doDamage); };
  try {
    for (const k of [true, 1, 4]) {
      D.pairFilter = () => k;
      seen.length = 0;
      for (let s = 0; s < 12; s++) { A.pos.x = 0; B.pos.x = 3.9; A.vel.x = B.vel.x = 0; D.update(1 / 120, [A, B]); }
      if (k === 4) {
        assert.equal(seen.length, 3, 'co 4. krok');
        for (const c of seen) {
          assert.equal((c.tick + A.id + B.id) % 4, 0, 'faza z id ciał');
          assert.equal(c.dt, 4 / 120, 'krok × 4');
        }
      } else {
        assert.equal(seen.length, 12, `${k}: co krok`);
        assert.ok(seen.every((c) => c.dt === 1 / 120));
      }
    }
  } finally { D.collideBodies = orig; D.pairFilter = null; }
});
