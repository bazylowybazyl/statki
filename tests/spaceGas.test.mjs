// GAZ W OTWARTEJ PRZESTRZENI — port dema dema/gazy-transport-webgpu.html (docs/PLAN-gazy-kosmos.md).
// GK-1: rdzeń pola (src/3d/spaceGas/spaceGasSim.js) — WGSL budowany w Node, limity wiązań, „ten sam graf = ten sam kod”
// (pułapka 35), lustra CPU (szum, profil źródła), reguły okna (przesunięcie tylko w klatce z krokiem, przenikanie obrazu).
// node --test tests/spaceGas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { vec4, smoothstep } = await import('three/tsl');
const { SpaceGasSim, srcShapeCpu, SPACE_GAS_SUB, SPACE_GAS_SRC } = await import('../src/3d/spaceGas/spaceGasSim.js');
const { fbm, gnoiseCpu, fbmCpu } = await import('../src/3d/spaceGas/spaceGasNoise.js');
const { GAS_HULL_REC, GAS_HULL_MASK } = await import('../src/3d/gas/gasObstacleLayout.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const wgsl = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };

// pole dalekie testu: ławica z fbm (jak scena mgły dema)
const farEnv = (q, U) => {
  const w = q.sub(U.windOff).div(6500.0);
  return vec4(smoothstep(0.0, 0.3, fbm(w, 4)).mul(2.0), 0.0, 0.0, 0.0);
};
const makeSim = (o = {}) => new SpaceGasSim({ farEnv, N: 32, maxSources: 8, maxRocks: 4, maxHulls: 4, ...o });

test('GK-1: kernele budują się w Node; storage ≤ 7 na kernel (zapas do limitu 8), uniformy ≤ 12 na etap', () => {
  const sim = makeSim();
  const names = ['init', 'shift', 'shiftCopy', 'curl', 'advect', 'react', 'div', 'jacAB', 'jacBA', 'project0', 'project1'];
  const ks = sim.kernels();
  assert.equal(ks.length, names.length);
  ks.forEach((k, i) => {
    const code = wgsl(k);
    const storage = (code.match(/var<storage/g) || []).length;
    const uniforms = (code.match(/var<uniform>/g) || []).length;
    assert.ok(storage <= 7, `${names[i]}: ${storage} buforów storage`);
    assert.ok(uniforms <= 12, `${names[i]}: ${uniforms} buforów uniformów`);
  });
  // kAdvect i kProject — 7 (dawniej 8 z flagB)
  assert.equal((wgsl(sim.kAdvect).match(/var<storage/g) || []).length, 7);
  assert.equal((wgsl(sim.kProject[0]).match(/var<storage/g) || []).length, 7);
  assert.doesNotMatch(wgsl(sim.kAdvect), /FlagB/i, 'bez bufora flagB');
});

test('GK-1: ten sam graf = ten sam kod (pułapka 35: tylko gnoise z layoutem)', () => {
  const a = makeSim({ name: 'gazA' });
  const b = makeSim({ name: 'gazA' });
  for (const [ka, kb] of [[a.kAdvect, b.kAdvect], [a.kInit, b.kInit], [a.kShift, b.kShift]]) {
    assert.equal(wgsl(ka), wgsl(kb));
  }
  const code = wgsl(a.kAdvect);
  assert.deepEqual(code.match(/^fn \w+/gm), ['fn spaceGasNoise', 'fn main'], 'jedna funkcja z layoutem (szum), reszta wklejona');
  assert.doesNotMatch(code, /fn fbm/, 'fbm wklejana');
});

test('lustro CPU szumu: zakres i ciągłość', () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 0.731) % 97 - 40, y = (i * 1.913) % 83 - 30;
    const v = gnoiseCpu(x, y);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    assert.ok(Math.abs(gnoiseCpu(x + 1e-4, y) - v) < 1e-2, 'ciągły');
  }
  assert.ok(lo > -1.5 && hi < 1.5 && hi - lo > 1.2);
  assert.equal(gnoiseCpu(3, 7), 0, 'węzeł siatki — 0');
  assert.ok(Math.abs(fbmCpu(1.3, 2.7, 5)) < 1.2);
});

test('lustro CPU profilu źródła: stożek, kula, front wybuchu', () => {
  const o = {};
  // stożek wzdłuż +x: na osi w połowie długości (przed zanikiem) — pełny profil, prędkość wzdłuż osi
  srcShapeCpu(200, 0, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, SPACE_GAS_SRC.cone, 300], o);
  assert.ok(o.prof > 0.99 && o.cmp > 0.99 && o.tx > 0 && Math.abs(o.ty) < 1e-9);
  assert.ok(o.near > 0.4 && o.near < 1, 'źródło gaśnie ku zasięgowi 300');
  srcShapeCpu(200, 300, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, 0, 300], o);
  assert.ok(o.prof < 0.05 && o.ty > 0, 'z boku — słabo, prędkość rozchyla pióropusz na boki');
  srcShapeCpu(-500, 0, [0, 0, 1, 0], [1000, 100, 0.2, 2000], [8, 0, 0, 300], o);
  assert.equal(o.prof, 0, 'za wylotem nic');
  // kula
  srcShapeCpu(0, 0, [0, 0, 1, 0], [200, 0, 0, 160], [2, 0, SPACE_GAS_SRC.ball, 0], o);
  assert.equal(o.prof, 1);
  // front: na pierścieniu pełny, prędkość na zewnątrz
  srcShapeCpu(500, 0, [0, 0, 1, 0], [500, 100, 0, 1400], [10, 0, SPACE_GAS_SRC.front, 0], o);
  assert.ok(o.prof === 1 && o.cmp === 1 && o.tx > 1399);
  srcShapeCpu(700, 0, [0, 0, 1, 0], [500, 100, 0, 1400], [10, 0, SPACE_GAS_SRC.front, 0], o);
  assert.equal(o.prof, 0);
});

test('okno: przesunięcie tylko w klatce z krokiem; start i teleport = init; przenikanie obrazu poprzedni → bieżący', () => {
  const sim = makeSim();
  const lists = [];
  const r = { compute(L) { lists.push(L.map((k) => k.name)); } };
  const C = sim.cell;
  // start: init + krok, obraz w teksturze 1, poprzedni = init (0)
  sim.frame(r, 0.001, 0, 0);
  assert.equal(lists.length, 1);
  assert.equal(lists[0][0], 'spaceGasInit');
  assert.ok(lists[0].includes('spaceGasProject1'));
  assert.equal(sim.image.cur, 1);
  assert.equal(sim.image.prev, 0);
  assert.equal(sim.ox, -16);
  // klatka bez kroku: kamera odjechała o 3 komórki — okno stoi, brak dispatchy
  sim.frame(r, 0.001, 3 * C, 0);
  assert.equal(lists.length, 1);
  assert.equal(sim.ox, -16, 'bez kroku okno stoi (drżenie dema 2026-10-13)');
  const w1a = sim.image.w1;
  // krok: przesunięcie razem z krokiem, nowy obraz w teksturze 0
  sim.frame(r, SPACE_GAS_SUB, 3 * C, 0);
  assert.deepEqual(lists[1].slice(0, 2), ['spaceGasShift', 'spaceGasShiftCopy']);
  assert.equal(sim.U.shift.value.x, 3);
  assert.equal(sim.ox, -13);
  assert.equal(sim.image.cur, 0);
  assert.equal(sim.image.origin[0].x, -13 * C, 'tekstura bieżąca — nowy róg');
  assert.equal(sim.image.origin[1].x, -16 * C, 'tekstura poprzednia — róg z jej kroku');
  assert.ok(w1a >= 0 && w1a <= 1 && sim.image.w1 >= 0 && sim.image.w1 <= 1);
  // teleport dalej niż okno = init
  sim.frame(r, SPACE_GAS_SUB, 1e6, 0);
  assert.equal(lists.at(-1)[0], 'spaceGasInit');
  // Jacobi: nieparzysta liczba iteracji kończy w prsB (rzut czyta prsB)
  const L = lists[1];
  assert.equal(L.filter((n) => n === 'spaceGasJacobiAB').length, 16);
  assert.equal(L.filter((n) => n === 'spaceGasJacobiBA').length, 15);
  // pauza: dt 0 — nic
  const n0 = lists.length;
  sim.frame(r, 0, 1e6, 0);
  assert.equal(lists.length, n0);
});

test('rozgrzanie sceny: × 4 czasu pola, najwyżej 8 kroków na klatkę', () => {
  const sim = makeSim();
  let steps = 0;
  const r = { compute(L) { steps += L.filter((n) => n.name.startsWith('spaceGasProject')).length; } };
  sim.requestReset(1);
  sim.frame(r, 0.05, 0, 0);
  assert.equal(steps, 8);
  assert.ok(sim.warmLeft < 1);
});

test('rozgrzewka: puste dispatche wszystkich kerneli z live = 0, potem live wraca', () => {
  const sim = makeSim();
  let seen = null, live = null;
  sim.warm({ compute(L) { seen = L.length; live = sim.U.live.value; } });
  assert.equal(seen, 11);
  assert.equal(live, 0);
  assert.equal(sim.U.live.value, 1);
  assert.match(wgsl(sim.kAdvect), /return;/, 'wyjście przy live = 0');
});

test('kadłub z rekordu GAS_HULL_REC: macierz świat → teksle, maska do pasma (tylko przy zmianie wersji)', () => {
  const sim = makeSim();
  const R = GAS_HULL_REC;
  const F = new Float64Array(R.stride);
  F[R.ax] = 1000; F[R.ay] = 500; F[R.ex] = 1; F[R.ey] = 0; F[R.fx] = 0; F[R.fy] = 1;
  F[R.x0] = -320; F[R.y0] = -80; F[R.tx] = 10; F[R.ty] = 5; F[R.vx] = 100; F[R.w] = 0.1; F[R.reach] = 330;
  F[R.uid] = 7; F[R.ver] = 1;
  for (let k = 0; k < GAS_HULL_MASK.words; k++) F[R.mask + k] = 0xffffffff >>> 0;
  sim.beginInputs();
  assert.ok(sim.addHullRecord(F, 0, R, 900, 400));
  const A = sim.U.hullA.array[0], B = sim.U.hullB.array[0];
  // punkt świata = kotwica → teksel (32, 16) (środek maski)
  const relx = 0, rely = 0;
  assert.equal(A.z * relx + A.w * rely + B.z, 32);
  assert.equal(B.x * relx + B.y * rely + B.w, 16);
  assert.equal(A.x, 100, 'kotwica względem kotwicy sceny');
  assert.equal(sim.hullMaskData[0], 255);
  assert.ok(sim._maskDirty);
  sim._maskDirty = false;
  sim.beginInputs();
  sim.addHullRecord(F, 0, R, 900, 400);
  assert.equal(sim._maskDirty, false, 'ta sama wersja maski — bez wysyłki');
});
