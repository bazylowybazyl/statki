// Gaz na siatce 3D (src/3d/gas/, plan docs/PLAN-zniszczenia-swiata-3d.md § 12): logika CPU (domeny,
// pakowanie źródeł do komórek, lista kerneli kroku, cykl życia, reżyser wybuchów, haki zniszczeń) na atrapie
// renderera oraz budowa WGSL kerneli i obrazu w Node (WebGPURenderer bez init — bez GPU).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid, createGasTuning } = await import('../src/3d/gas/gasGrid.js');
const { GasVolume } = await import('../src/3d/gas/gasVolume.js');
const { GasExplosions } = await import('../src/3d/gas/gasExplosions.js');
const { gasBlackbodyCpu } = await import('../src/3d/gas/gasCommon.js');

function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}
// Atrapa renderera: zapisuje listy compute (węzeł + liczba wątków w chwili wywołania).
function fakeRenderer() {
  const calls = [];
  return { calls, compute(list) { const L = Array.isArray(list) ? list : [list]; calls.push(L.map((n) => ({ name: n.name, count: n.count }))); } };
}
const makeGrid = (o = {}) => new GasGrid({ N: 16, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(7), ...o });

test('domena: rozmiar komórki z boku, dokładanie do żywej domeny, nowa poza nią, zabieranie najstarszej', () => {
  const g = makeGrid();
  const a = g.acquire(100, 0, 0, 10, { size: 40, life: 5 });
  assert.equal(a, 0);
  assert.equal(g.slots[0].h, 40 / 16);
  // Wybuch blisko środka żywej domeny — ta sama domena, dłuższe życie.
  const b = g.acquire(102, 1, 0, 2, { life: 9 });
  assert.equal(b, 0);
  assert.equal(g.slots[0].until, 9);
  // Daleko — nowa.
  assert.equal(g.acquire(400, 0, 0, 10, { size: 40 }), 1);
  assert.equal(g.acquire(800, 0, 0, 10, { size: 40 }), 2);
  // Pełna pula: zabiera domenę o najkrótszym życiu.
  g.slots[1].until = 0.5;
  assert.equal(g.acquire(1200, 0, 0, 10, { size: 40 }), 1);
  assert.equal(g.stats.dropped, 1);
  // reuse: false — osobna domena mimo żywej w tym miejscu (płonący wrak z własnym nośnikiem).
  g.release(2);
  const c = g.acquire(1202, 0, 0, 2, { reuse: false, size: 10, carrier: [5, 0, 0] });
  assert.equal(c, 2, 'wolna domena, nie dokładanie do domeny 1 w tym samym miejscu');
  assert.deepEqual([g.slots[c].vx, g.slots[c].vy, g.slots[c].vz], [5, 0, 0]);
});

test('krok: zerowanie nowej domeny, podkroki [wiry, adwekcja, reakcja, dywergencja, Jacobi×K, rzut], światło; wątki = N³ · aktywne', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  g.acquire(0, 0, 0, 5, { size: 32 });
  g.acquire(500, 0, 0, 5, { size: 32 });
  g.simulate(R, 1 / 60);
  const L = R.calls[0];
  const names = L.map((c) => c.name);
  assert.equal(names[0], 'gasClear', 'nowe domeny zerowane przed krokiem');
  assert.deepEqual(names.slice(1, 5), ['gasCurl', 'gasAdvect', 'gasReact', 'gasDivergence']);
  assert.equal(names.filter((n) => n.startsWith('gasJacobi')).length, 5);
  assert.equal(names.at(-2), 'gasProject');
  assert.equal(names.at(-1), 'gasLight');
  for (const c of L) assert.equal(c.count, 16 ** 3 * 2);
  // Następna klatka bez zerowania; długa klatka — podkroki (najwyżej maxSubsteps).
  g.simulate(R, 0.05);
  const L2 = R.calls[1].map((c) => c.name);
  assert.equal(L2.includes('gasClear'), false);
  assert.equal(L2.filter((n) => n === 'gasAdvect').length, 3);
  assert.ok(Math.abs(g.U.dt.value - 0.05 / 3) < 1e-9);
  // 144 Hz: jeden podkrok krótszy (źródła klatki nie giną).
  g.simulate(R, 1 / 144);
  assert.equal(R.calls[2].filter((c) => c.name === 'gasAdvect').length, 1);
  // Pauza (dt 0): bez kroków, światło liczy się dalej.
  g.simulate(R, 0);
  assert.deepEqual(R.calls[3].map((c) => c.name), ['gasLight']);
});

test('źródła i przeszkody trafiają do domeny w komórkach (niezależnie od położenia świata — float32)', () => {
  for (const off of [0, 7.3e6]) {
    const g = makeGrid();
    const R = fakeRenderer();
    const s = g.acquire(off + 10, 20, 30, 4, { size: 32 });
    const h = g.slots[s].h;
    g.source(s, off + 10, 20, 30, off + 14, 20, 30, 3, 5, 6, 7, 8, 16, 0, 0, 40, 0.5);
    g.obstacle(off + 10, 20 + 4, 30, 2, 0, 32, 0, 1);
    g.obstacle(off + 9999, 0, 0, 2, 0, 0, 0, 1); // poza domeną — pominięta
    g.simulate(R, 1 / 60);
    const A = g.U.srcA.array[0], B = g.U.srcB.array[0], C = g.U.srcC.array[0], D = g.U.srcD.array[0];
    assert.deepEqual([A.x, A.y, A.z].map((v) => +v.toFixed(6)), [8, 8, 8], 'środek domeny = komórka N/2');
    assert.ok(Math.abs(A.w - 3 / h) < 1e-9);
    assert.ok(Math.abs(B.x - (8 + 4 / h)) < 1e-6);
    assert.equal(B.w, 40);
    assert.deepEqual([C.x, C.y, C.z], [5, 6, 7]);
    assert.ok(Math.abs(C.w - 8 / h) < 1e-9, 'prędkość promieniowa [komórki/s]');
    assert.ok(Math.abs(D.x - 16 / h) < 1e-9);
    assert.equal(g.stats.sources, 1);
    assert.equal(g.stats.obstacles, 1);
    const O = g.U.obsB.array[0];
    assert.ok(Math.abs(O.y - 32 / h) < 1e-9);
    // Lista aktywnych: slot, zakresy źródeł i przeszkód.
    const a0 = g.U.act.array[0], a1 = g.U.act.array[1];
    assert.deepEqual([a0.x, a0.y, a0.z, a0.w, a1.x], [s, 0, 1, 0, 1]);
    assert.equal(g._srcN, 0, 'źródła klatki skasowane po kroku');
  }
});

test('cykl życia domeny: wygaszanie po końcu życia, potem wolna; nośnik przesuwa domenę', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const s = g.acquire(0, 0, 0, 5, { size: 32, life: 1, carrier: [10, 0, 0] });
  for (let i = 0; i < 60; i++) g.simulate(R, 1 / 60);
  assert.ok(Math.abs(g.slots[s].cx - 10) < 1e-6, 'domena jedzie z nośnikiem');
  for (let i = 0; i < 30; i++) g.simulate(R, 1 / 60);
  assert.ok(g.slots[s].active && g.slots[s].fade < 1 && g.slots[s].extraDecay > 0, 'wygasa');
  for (let i = 0; i < 120; i++) g.simulate(R, 1 / 60);
  assert.equal(g.slots[s].active, false);
  assert.equal(g.live, false);
});

test('reżyser: wybuch budowli rozpisany na źródła w czasie (kłęby, smugi, ogniska), haki obrazu', () => {
  const g = makeGrid({ N: 16, slots: 4 });
  const R = fakeRenderer();
  const ev = [];
  const d = new GasExplosions({
    grid: g, rng: rng(3),
    hooks: {
      onFlash: () => ev.push('flash'), onLight: () => ev.push('light'), onSparks: () => ev.push('sparks'),
      onShock: () => ev.push('shock'), onDebris: () => ev.push('debris')
    }
  });
  const slot = d.building(0, 0, 0, 10, [0, 1, 0], { puffs: 3, trails: 2, secondaries: 1, fires: 1 });
  assert.ok(slot >= 0);
  assert.deepEqual(ev.filter((e) => e !== 'debris'), ['flash', 'light', 'sparks', 'shock']);
  assert.equal(ev.filter((e) => e === 'debris').length, 2, 'łeb odłamka na smugę');
  d.update(1 / 60);
  const first = g._srcN;
  assert.ok(first >= 2, 'rdzeń i smugi od razu');
  g.simulate(R, 1 / 60);
  // Smuga leci: pozycja emitera zmienia się z czasem.
  const trail = d.emitters.find((e) => e.alive && e.trail);
  const x0 = trail.x;
  for (let i = 0; i < 20; i++) { d.update(1 / 60); g.simulate(R, 1 / 60); }
  assert.notEqual(trail.x, x0);
  // Ognisko pali się długo (domena żyje), kłęby rdzenia gasną po ~0,2 s.
  for (let i = 0; i < 120; i++) { d.update(1 / 60); g.simulate(R, 1 / 60); }
  const alive = d.emitters.filter((e) => e.alive);
  assert.ok(alive.length >= 1 && alive.every((e) => e.flicker > 0 || e.t1 - e.t0 > 1), 'zostały ogniska');
  assert.ok(g.slots[slot].active);
  assert.ok(d.stats.explosions >= 2, 'wybuch wtórny');
});

test('barwa ciała czarnego (lustro CPU): ciemna czerwień → pomarańcz → biel, bez zieleni powyżej czerwieni', () => {
  const c = (T) => gasBlackbodyCpu(T, [0, 0, 0]).map((v) => +v.toFixed(3));
  assert.deepEqual(c(0), [0, 0, 0]);
  const o = c(1.2), y = c(2.0), w = c(3.0);
  assert.ok(o[0] >= o[1] && o[1] >= o[2]);
  assert.ok(y[1] > o[1] && w[2] > y[2], 'gorętszy — jaśniejszy w zieleni i błękicie');
  assert.ok(w[0] === 1 && w[2] > 0.5);
});

test('WGSL: kernele gazu i obraz budują się w Node (bez GPU), atlas 3D jako storage + próbkowanie', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const buildCompute = (node) => {
    const b = renderer.backend.createNodeBuilder(node, renderer);
    b.build();
    return b.computeShader;
  };
  for (const node of [g.curlNode, g.advectNode, g.reactNode, g.divNode, g.jacAB, g.jacBA, g.projectNode, g.clearNode, g.lightNode]) {
    const cs = buildCompute(node);
    assert.match(cs, /texture_storage_3d<rgba16float, write>/, `${node.name}: zapis do atlasu RGBA16F`);
    // Limit 12 buforów uniformów na etap (agents.md).
    assert.ok((cs.match(/var<uniform>/g) || []).length <= 12, `${node.name}: bufory uniformów`);
  }
  assert.match(buildCompute(g.advectNode), /textureSampleLevel/, 'adwekcja próbkuje atlas trójliniowo');
  // Obraz objętościowy: materiał pełnoekranowy z węzłem marszu.
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = vol.node(null);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), mat);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mat;
  b.build();
  assert.match(b.fragmentShader, /texture_3d<f32>/);
  assert.ok((b.fragmentShader.match(/var<uniform>/g) || []).length <= 12);
});

test('płaska domena (gra z góry, NZ < N): atlas NZ warstw na domenę, wątki = N²·NZ, środek w komórce NZ/2, bryły w passie sceny', () => {
  const g = makeGrid({ N: 16, NZ: 8, slots: 2 });
  assert.equal(g.NZ, 8);
  assert.equal(g.denA.image.depth, 8 * 2, 'atlas: NZ warstw na domenę');
  const R = fakeRenderer();
  const s = g.acquire(0, 0, 0, 4, { size: 32 });
  const h = g.slots[s].h;
  assert.equal(h, 2);
  // Pion: pół NZ komórek (bez marginesu) — punkt nad płaską domeną leży poza nią.
  assert.equal(g.contains(s, 0, 0, h * 3.9, 0), true);
  assert.equal(g.contains(s, 0, 0, h * 4.1, 0), false);
  g.source(s, 0, 0, 0, 0, 0, 0, 3, 5, 6, 7, 0, 0, 0, 0, 0, 0.5);
  g.simulate(R, 1 / 60);
  // Dawniej N³ na domenę — połowa wątków kończyła się od razu (strażnik activeCount).
  for (const c of R.calls[0]) assert.equal(c.count, 16 * 16 * 8, `${c.name}: wątki`);
  const A = g.U.srcA.array[0];
  assert.deepEqual([A.x, A.y, A.z], [8, 8, 4], 'środek domeny = komórka (N/2, N/2, NZ/2)');
  // Bryły instancji: pudło N·h × N·h × NZ·h wokół domeny, względem początku sceny (double na CPU).
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const M = vol.createMeshes({ layer: 0, renderOrderBack: 1, renderOrderFront: 26, name: 'GasTest' });
  assert.equal(M.back.material.transparent, false, 'tył w kolejce nieprzezroczystej (przed kadłubami)');
  assert.equal(M.front.material.transparent, true);
  assert.equal(M.back.material.rulonBend, false);
  assert.equal(vol.updateMeshes(-10, 5, 0), 1);
  const a = M.attrs[0].array;
  assert.deepEqual([a[0], a[1], a[2], a[3]], [0 - 8 * h + 10, 0 - 8 * h - 5, -4 * h, h]);
  assert.equal(M.back.visible && M.front.visible, true);
  // WGSL obu warstw buduje się w Node (kamera ortho gry).
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  for (const mesh of [M.back, M.front]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = mesh.material;
    b.build();
    assert.match(b.fragmentShader, /texture_3d<f32>/, `${mesh.name}: marsz próbkuje atlas`);
    assert.ok((b.fragmentShader.match(/var<uniform>/g) || []).length <= 12, `${mesh.name}: bufory uniformów`);
  }
});

test('strojenie: wartości startowe w rozsądnych zakresach (rozprężanie ~0,5, ogień ∝ T² z progiem)', () => {
  const t = createGasTuning();
  assert.ok(t.expansion > 0.2 && t.expansion < 1.5, 'rozprężanie > 1,5 wypełniało domenę sześcianem');
  assert.equal(t.jacobi, undefined);
  assert.ok(t.fireGain > 0.2 && t.fireGain < 1.5);
  assert.ok(t.drag > 0.5);
});
