// Harmonogram compute gazu (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md § 7.4): pamięć objętości światła i
// zajętości kolumn (GasGrid.lightCache — bez podkroku i bez zmiany wejść kernele gasLight / gasOccupancy dałyby to samo)
// i krok siatek w locie (GasGridSet.stagger — lista kroku „fine” / „coarse” zlecona 1–2 klatki później). Stan symulacji
// ma zostać ten sam: każda lista kroku dostaje te same uniformy (dt, ziarno, czas, domeny, źródła), co bez przesunięcia.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid } = await import('../src/3d/gas/gasGrid.js');
const { GasGridSet } = await import('../src/3d/gas/gasGridSet.js');

function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}

// Atrapa renderera: na każde zlecenie listy — siatka, nazwy węzłów i migawka uniformów kroku W CHWILI zlecenia.
function recorder(grids) {
  const calls = [];
  return {
    calls,
    frame: 0,
    compute(list) {
      const L = Array.isArray(list) ? list : [list];
      const gi = grids.findIndex((g) => g.curlNode === L.find((n) => n.name === 'gasCurl') || g.lightNode === L[0] || g.clearNode === L[0] || g.occNode === L.at(-1));
      const U = grids[gi].U;
      const s0 = U.srcC.array[0];
      calls.push({ frame: this.frame, grid: gi, names: L.map((n) => n.name).join(','), counts: L.map((n) => n.count).join(','),
        u: [U.dt.value, U.seed.value, U.time.value, U.activeCount.value, s0.x, s0.y, s0.z, U.act.array[0].x].join(',') });
    }
  };
}

function makeSet() {
  const grids = [
    new GasGrid({ N: 8, NZ: 4, slots: 2, jacobi: 3, noise3D: noiseTex(), rng: rng(1) }),
    new GasGrid({ N: 12, NZ: 6, slots: 2, jacobi: 5, noise3D: noiseTex(), rng: rng(2) }),
    new GasGrid({ N: 6, NZ: 4, slots: 3, jacobi: 3, noise3D: noiseTex(), rng: rng(3) })
  ];
  return new GasGridSet(grids);
}

// Scenariusz: 240 kl/s, krok fizyki co 4 klatki (czasem co 3 i co 5), źródła w każdej klatce kroku, nowa domena w środku.
function run(stagger) {
  const set = makeSet();
  set.stagger = stagger;
  const R = recorder(set.grids);
  const gaps = [4, 4, 3, 4, 5, 4, 2, 4, 4, 1, 4];
  let gi = 0, next = 0;
  set.acquire(0, 0, 0, 4, { size: 32, life: 99, tier: 0 });
  set.acquire(0, 0, 0, 4, { size: 48, life: 99, tier: 1 });
  set.acquire(0, 0, 0, 4, { size: 24, life: 99, tier: 2 });
  for (let f = 0; f < 60; f++) {
    R.frame = f;
    const step = f === next;
    if (step) next = f + gaps[gi++ % gaps.length];
    if (f === 25) set.acquire(500, 0, 0, 4, { size: 48, life: 99, tier: 1 });   // nowa domena „fine” (zerowanie)
    if (step) for (let t = 0; t < 3; t++) set.source(set.base[t], 0, 0, 0, 0, 0, 0, 2, f, f * 2, f * 3, 0, 0, 0, 0, 0, 0.5);
    set.simulate(R, step ? 1 / 60 : 0);
  }
  for (let f = 60; f < 63; f++) { R.frame = f; set.simulate(R, 0); }   // kroki w locie z ostatniej klatki kroku
  return R.calls;
}

test('krok w locie: każda lista kroku z tymi samymi uniformami co bez przesunięcia, „fine” / „coarse” 1–2 klatki później', () => {
  const a = run(false), b = run(true);
  for (const gi of [0, 1, 2]) {
    const A = a.filter((c) => c.grid === gi && c.names.includes('gasCurl'));
    const B = b.filter((c) => c.grid === gi && c.names.includes('gasCurl'));
    assert.equal(B.length, A.length, `siatka ${gi}: tyle samo kroków`);
    for (let i = 0; i < A.length; i++) {
      assert.equal(B[i].names, A[i].names, `siatka ${gi}, krok ${i}: lista`);
      assert.equal(B[i].counts, A[i].counts, `siatka ${gi}, krok ${i}: wątki`);
      assert.equal(B[i].u, A[i].u, `siatka ${gi}, krok ${i}: uniformy w chwili zlecenia`);
      const d = B[i].frame - A[i].frame;
      assert.ok(d >= 0 && d <= gi, `siatka ${gi}, krok ${i}: przesunięcie ${d} klatek`);
    }
  }
  const sh = (gi) => b.filter((c) => c.grid === gi && c.names.includes('gasCurl')).filter((c, i) =>
    c.frame !== a.filter((x) => x.grid === gi && x.names.includes('gasCurl'))[i].frame).length;
  assert.equal(sh(0), 0, 'siatka podstawowa bez przesunięcia');
  assert.ok(sh(1) > 5 && sh(2) > 5, `„fine” i „coarse” przesunięte (${sh(1)}, ${sh(2)})`);
  // klatka z zerowaniem nowej domeny — bez przesunięcia (obraz nie może pokazać starej zawartości slotu)
  const clr = b.find((c) => c.grid === 1 && c.frame >= 25 && c.names.startsWith('gasClear'));
  assert.equal(clr?.frame, 25, 'zerowanie nowej domeny zlecone w klatce jej zajęcia');
});

test('pamięć światła: bez podkroku i bez zmian — bez gasLight / gasOccupancy; zmiana słońca, nowa domena, podkrok — liczone', () => {
  const g = new GasGrid({ N: 8, NZ: 4, slots: 3, jacobi: 3, noise3D: noiseTex(), rng: rng(5) });
  const R = recorder([g]);
  g.acquire(0, 0, 0, 4, { size: 32, life: 99 });
  g.simulate(R, 1 / 60);
  assert.ok(R.calls[0].names.endsWith('gasLight,gasOccupancy'));
  g.simulate(R, 0);
  g.simulate(R, 0);
  assert.equal(R.calls.length, 1, 'klatki bez podkroku — bez zleceń');
  assert.equal(g.stats.lightSkipped, 2);
  g.sunDir.set(0, 0, 1);
  g.simulate(R, 0);
  assert.equal(R.calls.at(-1).names, 'gasLight,gasOccupancy', 'zmiana kierunku słońca');
  g.simulate(R, 0);
  assert.equal(R.calls.length, 2);
  g.acquire(500, 0, 0, 4, { size: 32, life: 99 });
  g.simulate(R, 0);
  assert.equal(R.calls.at(-1).names, 'gasClear,gasLight,gasOccupancy', 'nowa domena: zerowanie i światło');
  g.tune.glowFar = (g.tune.glowFar || 0) + 1;
  g.simulate(R, 0);
  assert.equal(R.calls.at(-1).names, 'gasLight,gasOccupancy', 'zmiana strojenia światła');
  g.simulate(R, 1 / 60);
  assert.ok(R.calls.at(-1).names.includes('gasCurl') && R.calls.at(-1).names.endsWith('gasLight,gasOccupancy'), 'podkrok');
});
