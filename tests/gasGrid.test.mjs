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

test('źródła i kadłuby-przeszkody trafiają do domeny w komórkach (niezależnie od położenia świata — float32)', async () => {
  const { GAS_HULL_REC } = await import('../src/3d/gas/gasGrid.js');
  for (const off of [0, 7.3e6]) {
    const g = makeGrid();
    const R = fakeRenderer();
    const s = g.acquire(off + 10, 20, 30, 4, { size: 32 });
    const h = g.slots[s].h;
    g.source(s, off + 10, 20, 30, off + 14, 20, 30, 3, 5, 6, 7, 8, 16, 0, 0, 40, 0.5);
    const rec = new Float64Array(GAS_HULL_REC.stride);
    rec[GAS_HULL_REC.ax] = off + 10; rec[GAS_HULL_REC.ay] = 24; rec[GAS_HULL_REC.ex] = 1; rec[GAS_HULL_REC.fy] = 1;
    rec[GAS_HULL_REC.tx] = 1; rec[GAS_HULL_REC.ty] = 1; rec[GAS_HULL_REC.vy] = 32; rec[GAS_HULL_REC.reach] = 2; rec[GAS_HULL_REC.uid] = 1;
    g.hull(rec, 0);
    rec[GAS_HULL_REC.ax] = off + 9999; rec[GAS_HULL_REC.uid] = 2;
    g.hull(rec, 0);   // poza domeną — pominięty
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
    assert.equal(g.stats.hulls, 1);
    const HC = g.U.hullC.array[0];
    assert.ok(Math.abs(HC.y - 32 / h) < 1e-9);
    assert.ok(Math.abs(g.U.hullA.array[0].y - (8 + 4 / h)) < 1e-6, 'kotwica kadłuba w komórkach domeny');
    // Lista aktywnych: slot, zakresy źródeł i kadłubów (4 vec4 na domenę).
    const a0 = g.U.act.array[0], a1 = g.U.act.array[1];
    assert.deepEqual([a0.x, a0.y, a0.z, a0.w, a1.x], [s, 0, 1, 0, 1]);
    assert.equal(g._srcN, 0, 'źródła klatki skasowane po kroku');
    assert.equal(g._hullN, 0, 'kadłuby klatki skasowane po kroku');
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

test('F15 (2026-10-08): domena przedłużona w trakcie wygaszania odżywa RAMPĄ (bez skoku obrazu), zanik dymu gaśnie tak samo', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const s = g.acquire(0, 0, 0, 5, { size: 32, life: 0.5 });
  const slot = g.slots[s];
  for (let i = 0; i < 60; i++) g.simulate(R, 1 / 60);   // 0,5 s po końcu życia — w połowie wygaszania
  assert.ok(slot.active && slot.fade > 0.55 && slot.fade < 0.75, `fade ${slot.fade}`);
  const extra0 = slot.extraDecay;
  assert.ok(extra0 > 1.2);
  g.keepAlive(s, g.time + 3);   // scalenie wybuchu / ognisko
  let prev = slot.fade;
  for (let i = 0; i < 40; i++) {
    g.simulate(R, 1 / 60);
    assert.ok(slot.fade - prev <= 2 / 60 + 1e-9, 'obraz wraca najwyżej 2/s');
    assert.ok(slot.fade >= prev, 'i nie spada');
    prev = slot.fade;
  }
  assert.equal(slot.fade, 1, 'po ~0,3 s pełny obraz');
  assert.equal(slot.extraDecay, 0, 'zanik dodatkowy wygaszony');
  // Ponowny koniec życia: krzywa w dół od miejsca, w którym stała, do zwolnienia domeny.
  for (let i = 0; i < 400 && slot.active; i++) {
    const f = slot.fade;
    g.simulate(R, 1 / 60);
    if (slot.active) assert.ok(slot.fade <= f + 1e-9);
  }
  assert.equal(slot.active, false);
});

// Lustro CPU adwekcji prędkości kerneli gasAdvect + gasReact (2D, ten sam schemat): RK2 wstecz, v̂ = v(pb) ZAPISANE na
// siatce (velC), ṽ = v̂ z siatki w punkcie do przodu p + v·dt, mc = v̂ + ½(v − ṽ), obcięcie do min / max komórek wokół pb
// (w 3D — 8, tu 4). v̂ liczone „w locie” w punkcie do przodu (pierwsza wersja F4) dawało v(p) i korekcję ≈ 0.
function advectVel2D(N, vx, vy, dt, mc) {
  const at = (A, x, y) => {
    x = Math.min(N - 0.5, Math.max(0.5, x)) - 0.5; y = Math.min(N - 0.5, Math.max(0.5, y)) - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return (A[y0 * N + x0] * (1 - fx) + A[y0 * N + x1] * fx) * (1 - fy) + (A[y1 * N + x0] * (1 - fx) + A[y1 * N + x1] * fx) * fy;
  };
  const back = (x, y) => {
    const ux = at(vx, x, y), uy = at(vy, x, y);
    const mx = x - ux * dt * 0.5, my = y - uy * dt * 0.5;
    return [x - at(vx, mx, my) * dt, y - at(vy, mx, my) * dt, ux, uy];
  };
  // 2a: v̂ na siatce
  const hx = new Float64Array(N * N), hy = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const [bx, by] = back(i + 0.5, j + 0.5);
    hx[j * N + i] = at(vx, bx, by); hy[j * N + i] = at(vy, bx, by);
  }
  if (!mc) return [hx, hy];
  // 2b: korekcja z obcięciem
  const ox = new Float64Array(N * N), oy = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const px = i + 0.5, py = j + 0.5;
    const [bx, by, ux, uy] = back(px, py);
    const tx = at(hx, px + ux * dt, py + uy * dt), ty = at(hy, px + ux * dt, py + uy * dt);
    const cx = hx[j * N + i] + 0.5 * (ux - tx), cy = hy[j * N + i] + 0.5 * (uy - ty);
    const b0x = Math.floor(bx - 0.5) + 0.5, b0y = Math.floor(by - 0.5) + 0.5;
    let lx = Infinity, ux2 = -Infinity, ly = Infinity, uy2 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const sx = at(vx, b0x + (k & 1), b0y + (k >> 1)), sy = at(vy, b0x + (k & 1), b0y + (k >> 1));
      lx = Math.min(lx, sx); ux2 = Math.max(ux2, sx); ly = Math.min(ly, sy); uy2 = Math.max(uy2, sy);
    }
    ox[j * N + i] = Math.min(ux2, Math.max(lx, cx)); oy[j * N + i] = Math.min(uy2, Math.max(ly, cy));
  }
  return [ox, oy];
}

test('F4 (2026-10-08): MacCormack prędkości z obcięciem — bez nowych ekstremów i NaN, wir żyje dłużej niż przy semi-Lagrange', () => {
  const N = 48, dt = 1 / 60;
  const run = (mc) => {
    let vx = new Float64Array(N * N), vy = new Float64Array(N * N);
    // Unoszenie (12,37 kom./s) + słaby wir z OSTRYM brzegiem (rdzeń Rankine'a ucięty — najgorszy przypadek dla 2. rzędu
    // bez obcięcia: oscylacje); wir płynie przez środek domeny, z dala od brzegów.
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i + 0.5 - N * 0.3, y = j + 0.5 - N / 2, r = Math.hypot(x, y);
      const w = r < 5 ? 0.3 : 0;
      vx[j * N + i] = 12.37 - y * w;
      vy[j * N + i] = x * w;
    }
    let vmax0 = 0;
    for (let k = 0; k < N * N; k++) vmax0 = Math.max(vmax0, Math.abs(vx[k]), Math.abs(vy[k]));
    // energia zaburzenia (wiru) względem unoszenia
    const pert = () => { let e = 0; for (let k = 0; k < N * N; k++) e += (vx[k] - 12.37) ** 2 + vy[k] ** 2; return e; };
    const e0 = pert();
    for (let s = 0; s < 90; s++) {
      [vx, vy] = advectVel2D(N, vx, vy, dt, mc);
      for (let k = 0; k < N * N; k++) {
        assert.ok(Number.isFinite(vx[k]) && Number.isFinite(vy[k]), 'NaN');
        assert.ok(Math.abs(vx[k]) <= vmax0 + 1e-9 && Math.abs(vy[k]) <= vmax0 + 1e-9, 'obcięcie: bez nowych ekstremów');
      }
    }
    return pert() / e0;
  };
  const sl = run(false), mc = run(true);
  assert.ok(mc <= 1.02, `energia wiru nie rośnie (${mc})`);
  assert.ok(mc > 2 * sl, `MacCormack zachowuje wir (≥ 2× semi-Lagrange) (${mc.toFixed(3)} vs ${sl.toFixed(3)})`);
});

test('F4/F7/F9 (2026-10-08): v̂ zapisane w adwekcji, korekcja prędkości i siły w reakcji (bez nowego dispatchu); domyślnie dawne zachowanie', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const cs = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };
  const stores = (code) => (code.match(/textureStore\(/g) || []).length;
  const adv = cs(g.advectNode), react = cs(g.reactNode);
  assert.equal(stores(adv), 3, 'adwekcja: φ̂ (denB), pozycja spoczynkowa (restB), v̂ (velC)');
  assert.equal(stores(react), 2, 'reakcja: prędkość (velB) i skalary (denC)');
  // Najwyżej 4 tekstury storage na kernel (limit wiązań), 12 buforów uniformów na etap.
  for (const code of [adv, react]) {
    assert.ok((code.match(/texture_storage_3d/g) || []).length <= 4);
    assert.ok((code.match(/var<uniform>/g) || []).length <= 12);
  }
  // Lista kroku bez nowych kerneli (tylko nowa tekstura velC).
  const R = fakeRenderer();
  g.acquire(0, 0, 0, 5, { size: 32 });
  g.tune.velMacCormack = 1;
  g.simulate(R, 1 / 60);
  assert.deepEqual(R.calls[0].slice(1, 5).map((c) => c.name), ['gasCurl', 'gasAdvect', 'gasReact', 'gasDivergence']);
  // Domyślne strojenie = dawne zachowanie (dema i dym wraków bez zmian); gra włącza w tuneGasForSpace.
  const T = createGasTuning();
  assert.equal(T.velMacCormack, 0);
  assert.equal(T.contraction, 0);
  assert.equal(T.sponge, 0);
  assert.deepEqual([T.dragFrontLo, T.dragFrontHi], [0, 0]);
});

test('F4 (poprawki przeglądu): WGSL gasReact — ṽ z velC (v̂ w p i w punkcie do przodu), obcięcie z velA wokół punktu wstecz, siły z φ̂ fp32 (denA w pb)', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const samples = (node) => {
    const b = renderer.backend.createNodeBuilder(node, renderer);
    b.build();
    const code = b.computeShader;
    const out = {};
    for (const gr of b.getBindings()) for (const bd of gr.bindings) {
      if (bd.texture?.name) out[bd.texture.name] = code.split(`textureSampleLevel( ${bd.name},`).length - 1;
    }
    return out;
  };
  const r = samples(g.reactNode);
  // velA: RK2 wstecz (2) + v w pb (1, w — udział komórek stałych) + obcięcie MacCormacka (8) + flaga komórek stałych w punkcie
  // do przodu (1 — freeSample ṽ skalarów, poprawki etapu C pkt 6); velC: v̂ w p i w punkcie do przodu; denB: φ̂ w p i do
  // przodu; denA: φ w p (1) + obcięcie skalarów (8) + φ̂ fp32 w pb dla sił (1). Kernel czytający velA zamiast velC w
  // punkcie do przodu (korekcja ≈ 0 — błąd pierwszej wersji F4) albo bez obcięcia zmienia te liczby.
  assert.deepEqual([r.gasVelA, r.gasVelC, r.gasDenB, r.gasDenA], [12, 2, 2, 10], JSON.stringify(r));
  const a = samples(g.advectNode);
  assert.equal(a.gasVelC ?? 0, 0, 'adwekcja nie próbkuje velC (tylko zapisuje v̂)');
});

test('F8 (poprawki przeglądu): narzucenie prędkości źródła gaśnie po velHold do velFloor (τ = velTau); velTau 0 — stałe', () => {
  const run = (velTau) => {
    const g = makeGrid({ N: 16, slots: 2 });
    const d = new GasExplosions({ grid: g, rng: rng(5) });
    d.tune.velTau = velTau;
    const slot = g.acquire(0, 0, 0, 5, { size: 32, life: 9 });
    d.jet(slot, 0, 0, 0, 1, 0, 0, 1, 3, 40, 2, { velBlend: 36, rampIn: 0.04, rampOut: 0, tau: 0, flicker: 0 });
    const vb = [];
    for (let i = 0; i < 60; i++) {
      d.update(1 / 60);
      vb.push(g._srcN ? g._src[14] : NaN);
      g._srcN = 0;
    }
    return vb;
  };
  const fixed = run(0);
  assert.ok(fixed.every((v) => v === 36), 'velTau 0 — narzucenie stałe');
  const ramp = run(0.15);
  assert.equal(ramp[2], 36, 'przed velHold pełne');
  for (let i = 5; i < 60; i++) assert.ok(ramp[i] <= ramp[i - 1] + 1e-9, 'maleje');
  assert.ok(ramp[59] < 7 && ramp[59] >= 6, `do velFloor 6/s (${ramp[59]})`);
});

test('F7 (poprawki przeglądu): kurczenie — stygnąca komórka bez spalania ma ujemny cel dywergencji (rzut zasysa), paląca rozpręża; contraction 0 = dawny cel', async () => {
  const { gasReactWCpu, gasRhsCpu } = await import('../src/3d/gas/gasGrid.js');
  const T = { ...createGasTuning(), contraction: 0.3 };
  // Rzut ciśnienia dąży do div v = cel, cel = div − rhs (przy rhs = 0).
  const target = (w, smoke, Tn) => -gasRhsCpu(0, w, smoke, Tn);
  const cooling = gasReactWCpu(0, 4, T.contraction);     // nie pali się, stygnie 4/s
  assert.equal(cooling, -4);
  assert.ok(target(cooling, 0, T) < 0, 'stygnący gaz: cel ujemny (kurczenie)');
  assert.ok(Math.abs(target(cooling, 0, T) + 0.3 * 4) < 1e-12, 'skala: contraction · tempo stygnięcia');
  const burning = gasReactWCpu(6, 4, T.contraction);     // pali się — tempo spalania, bez kurczenia
  assert.equal(burning, 6);
  assert.ok(target(burning, 0, T) > 0, 'spalanie: rozprężanie');
  // contraction 0: kanał w = tempo spalania (≥ 0), cel jak przed etapem A.
  const T0 = { ...T, contraction: 0 };
  assert.equal(gasReactWCpu(0, 4, 0), 0);
  assert.equal(target(gasReactWCpu(2, 4, 0), 1.5, T0), 2 * T0.expansion + 1.5 * T0.disperse);
  // WGSL: kernel dywergencji czyta kanał w z denC i ma uniform kurczenia obok rozprężania i rozpraszania.
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const b = renderer.backend.createNodeBuilder(g.divNode, renderer);
  b.build();
  const struct = b.computeShader.match(/struct objectStruct \{([^}]*)\}/);
  assert.ok(struct && (struct[1].match(/nodeUniform\d+ : f32/g) || []).length >= 4, 'warm, expansion, disperse, contraction');
});

// ── Etap B (2026-10-09): światła siatki Core3D.fx.grid w marszu dymu (F3), daleki blask własnego ognia (F10),
// otoczenie ze strefy nieba ────────────────────────────────────────────────────────────────────────────────
test('F3: bryły z lightGrid czytają siatkę świateł w marszu (bufory storage siatki w WGSL, pętla co N gęstych próbek); bez siatki i pełnoekranowo — bez pętli', async () => {
  const { LightGrid } = await import('../src/3d/fx/lightGrid.js');
  const { GAS_LIGHT_OWNER_BASE } = await import('../src/3d/gas/gasVolume.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const frag = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = mesh.material;
    b.build();
    return b.fragmentShader;
  };
  const g = makeGrid({ N: 16, NZ: 8, slots: 2 });
  const lit = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex(), lightGrid: new LightGrid({ name: 'fxGrid' }) });
  const M = lit.createMeshes({ name: 'GasLit', ambientVisibility: () => THREE.float ? undefined : undefined });
  for (const mesh of [M.back, M.front]) {
    const w = frag(mesh);
    assert.match(w, /var<storage, read> fxGridLights/, `${mesh.name}: bufor świateł siatki`);
    assert.match(w, /var<storage, read> fxGridIndex/, `${mesh.name}: indeks komórek siatki`);
    assert.match(w, /for \( var gridItem : u32/, `${mesh.name}: pętla po światłach komórki`);
    assert.ok(w.indexOf('for ( var gridItem') > w.indexOf('for ( var gstep'), 'pętla świateł WEWNĄTRZ marszu');
    assert.ok(w.includes(`+ ${GAS_LIGHT_OWNER_BASE}.0`), 'właściciel świateł domeny (światło własnego wybuchu)');
    assert.ok((w.match(/var<uniform>/g) || []).length <= 12, 'bufory uniformów');
    assert.ok((w.match(/var<storage/g) || []).length <= 4, 'bufory storage etapu fragmentów');
  }
  // Licznik i ostatnia wartość zadeklarowane PRZED pętlą marszu (pułapka 29 — inaczej zerowane co krok).
  const wb = frag(M.back);
  const loopAt = wb.indexOf('for ( var gstep');
  const head = wb.slice(0, loopAt);
  assert.ok(/nodeVar\d+ = vec3<f32>\( 0\.0, 0\.0, 0\.0 \);\s*nodeVar\d+ = 0;/.test(head), 'światło i licznik przypisane przed marszem');
  // Bez siatki (dym wraków, dema) i przebieg pełnoekranowy (dema) — bez pętli i bez buforów siatki.
  const plain = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const P = plain.createMeshes({ name: 'GasPlain' });
  assert.doesNotMatch(frag(P.back), /fxGrid/);
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = lit.node(null);
  const b = renderer.backend.createNodeBuilder(new THREE.Mesh(new THREE.PlaneGeometry(), mat), renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mat;
  b.build();
  assert.doesNotMatch(b.fragmentShader, /fxGrid/, 'pełnoekranowy (dema) bez zmian');
  // Przełącznik (A/B tej samej klatki) i otoczenie — uniformy, bez przebudowy materiału.
  lit.gridEnabled = false; lit.ambientScale = 0.55; lit.syncLook();
  assert.equal(lit.U.gridOn.value, 0);
  assert.equal(lit.U.ambientK.value, 0.55);
  lit.gridEnabled = true; lit.syncLook();
  assert.equal(lit.U.gridOn.value, 1);
  assert.equal(plain.U.gridOn.value, 1, 'domyślnie');
  plain.syncLook();
  assert.equal(plain.U.gridOn.value, 0, 'bez siatki — wyłączone');
});

test('F3/F10: lustro CPU świateł siatki w dymie — kolano ogranicza jasność, własne światło domeny tylko w dalekim polu', async () => {
  const { gasGridLightCpu, createGasLook, GAS_LIGHT_OWNER_BASE } = await import('../src/3d/gas/gasVolume.js');
  const L = createGasLook();
  const sum = (v) => v[0] + v[1] + v[2];
  // Kolano: jasność rośnie monotonicznie, ale nie przekracza 1 / kolano (suma kanałów) — dym przy dyszy nie bieleje.
  let prev = 0;
  for (const p of [0.1, 1, 10, 100, 1e4]) {
    const v = gasGridLightCpu([{ att: 1, col: [p, p, p], scatter: 0.5, owner: 0, x: 0.2 }], 0, L);
    assert.ok(sum(v) > prev && sum(v) < 1 / L.gridKnee + 1e-9, `moc ${p}`);
    prev = sum(v);
  }
  // Własna domena (slot 3): blisko ognia nic, w dalekim polu pełna waga; cudza domena — zawsze pełna.
  const own = GAS_LIGHT_OWNER_BASE + 3;
  const at = (x, owner, slot = 3) => sum(gasGridLightCpu([{ att: 0.5, col: [1, 0.6, 0.3], scatter: 0.25, owner, x }], slot, L));
  assert.equal(at(L.ownNear * 0.9, own), 0, 'bliskie pole własnego światła — emisja i blask z objętości');
  assert.ok(at(L.ownFar, own) > 0 && Math.abs(at(L.ownFar, own) - at(L.ownFar, own, 4)) < 1e-12, 'daleko — jak cudze');
  assert.ok(at(0.5, own) < at(0.5, own, 4), 'w przejściu słabiej niż w cudzej domenie');
  assert.ok(at(0.1, GAS_LIGHT_OWNER_BASE + 4) > 0, 'światło innego wybuchu oświetla dym od razu');
  assert.ok(at(0.1, 0) > 0, 'dysze, lufy, reflektory (właściciel 0)');
  // Rozpraszanie w ośrodku (L1.w): snop reflektora (0,8) mocniej niż lampa (0,05).
  const s = (sc) => sum(gasGridLightCpu([{ att: 0.02, col: [1, 1, 1], scatter: sc, owner: 0, x: 0.3 }], 0, L));
  assert.ok(s(0.8) > s(0.05));
  // Samocień: głębiej w obłoku (mniejsza przepuszczalność nad próbką) słabiej — obłok ma bryłę, nie świeci równo.
  const deep = (tr) => sum(gasGridLightCpu([{ att: 0.5, col: [3, 3, 3], scatter: 0.35, owner: 0, x: 0.3 }], 0, L, tr));
  assert.ok(deep(1) > deep(0.5) && deep(0.5) > deep(0.05));
  assert.ok(deep(0) <= deep(1) * (1 - L.gridShadow) + 1e-12);
});

test('F10: daleki pierścień blasku w objętości światła (6 osi) za uniformem glowFar — domyślnie 0 (dema, dym wraków), gra > 0', async () => {
  const { tuneGasForSpace } = await import('../src/3d/explosions/explosionFx.js');
  const { GLOW_FAR_RADIUS } = await import('../src/3d/gas/gasGrid.js');
  assert.equal(createGasTuning().glowFar, 0, 'domyślnie bez dalekiego blasku');
  const T = tuneGasForSpace(createGasTuning());
  assert.ok(T.glowFar > 1 && T.glowFar < 5, 'gra: daleki blask');
  assert.ok(GLOW_FAR_RADIUS > 4.5 && GLOW_FAR_RADIUS <= 12, 'dalej niż pierścień 4,5 komórki');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const b = renderer.backend.createNodeBuilder(g.lightNode, renderer);
  b.build();
  // 16 kroków ku słońcu + 14 kierunków × 2 promienie + 6 osi dalekiego pierścienia.
  assert.equal((b.computeShader.match(/textureSampleLevel/g) || []).length, 16 + 28 + 6);
  g.tune.glowFar = 2.5; g._syncTune();
  assert.equal(g.U.glowFar.value, 2.5);
});

test('E1: paleta ognia per domena — lustro CPU (fire 0 = ciało czarne, 1 = plazma Yamato: błękit, rdzeń biało-błękitny), WGSL brył z kanału instancji, bez nowych tekstur', async () => {
  const { gasFirePaletteCpu, GAS_FIRE_GLOW_BLUE } = await import('../src/3d/gas/gasCommon.js');
  for (const T of [0, 0.2, 0.5, 0.9, 1.4, 2.0, 2.6, 3.5]) {
    const a = gasFirePaletteCpu(T, 0), b = gasBlackbodyCpu(T);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) < 1e-12, `fire 0 = ciało czarne (T ${T})`);
  }
  for (const T of [0.6, 1.0, 1.6, 2.2]) {
    const c = gasFirePaletteCpu(T, 1);
    assert.ok(c[2] >= c[1] && c[1] > c[0], `plazma: niebieski > zielony > czerwony (T ${T})`);
  }
  const core = gasFirePaletteCpu(3.5, 1);
  assert.ok(core[0] > 0.6 && core[1] > 0.8 && core[2] > 0.95, 'gorące jądro biało-błękitne');
  const half = gasFirePaletteCpu(1.4, 0.5), bb = gasBlackbodyCpu(1.4), bl = gasFirePaletteCpu(1.4, 1);
  for (let c = 0; c < 3; c++) assert.ok(half[c] > Math.min(bb[c], bl[c]) - 1e-9 && half[c] < Math.max(bb[c], bl[c]) + 1e-9, 'mieszanie liniowe przystanków');
  const l = 0.2126 * GAS_FIRE_GLOW_BLUE[0] + 0.7152 * GAS_FIRE_GLOW_BLUE[1] + 0.0722 * GAS_FIRE_GLOW_BLUE[2];
  assert.ok(Math.abs(l - 1) < 0.01, 'blask w błękicie zachowuje luminancję');
  // WGSL: paleta z kanału w barwy domeny (instancja brył / domC przebiegu pełnoekranowego), przystanki przed marszem.
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid({ N: 16, NZ: 8, slots: 2 });
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const M = vol.createMeshes({ name: 'GasFire' });
  const b = renderer.backend.createNodeBuilder(M.back, renderer);
  b.material = M.back.material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = M.back.material;
  b.build();
  const w = b.fragmentShader;
  assert.ok(w.includes('0.72, 0.86, 1.0') || w.includes('0.72, 0.86, 1'), 'przystanek jądra plazmy w WGSL');
  const loopAt = w.indexOf('for ( var gstep');
  assert.ok(w.slice(0, loopAt).includes('0.03, 0.08, 0.5'), 'przystanki palety przed marszem (raz na fragment)');
  // bez nowych tekstur: paleta to stałe przystanki × kanał instancji (atlas gazu i szumy jak dawniej)
  assert.equal((w.match(/: texture_3d</g) || []).length, 5, 'atlas: denA, restA, lightT + szum i pole wirowe');
  // Kanał barwy domeny: w = paleta ognia (instancja), pakowany co klatkę.
  const s = g.slots[g.acquire(0, 0, 0, 10, { size: 160, fire: 1, tint: [0.9, 0.95, 1.1] })];
  vol.updateMeshes(0, 0, 0);
  assert.equal(M.attrs[2].array[3], 1, 'gasC.w = paleta ognia domeny');
  assert.equal(s.fire, 1);
});

test('E1: domena z krótkim życiem — własny czas wygaszania i stały zanik dymu (wylot działa); domyślnie dawne wartości', () => {
  const g = makeGrid();
  const r = fakeRenderer();
  const a = g.acquire(0, 0, 0, 10, { size: 160, life: 0.4, fadeTime: 0.5, baseDecay: 0.9 });
  const b = g.acquire(5000, 0, 0, 10, { size: 160, life: 0.4 });
  assert.equal(g.slots[a].fadeTime, 0.5);
  assert.equal(g.slots[a].baseDecay, 0.9);
  assert.equal(g.slots[b].fadeTime, 1.6, 'domyślnie dawne wygaszanie');
  assert.equal(g.slots[b].baseDecay, 0);
  assert.equal(g.slots[b].fire, 0);
  g.simulate(r, 0.1);
  assert.ok(Math.abs(g.slots[a].extraDecay - 0.9) < 1e-12, 'stały zanik dymu w życiu domeny');
  assert.equal(g.slots[b].extraDecay, 0);
  g.feed(a, g.time + 0.4);
  assert.ok(g.slots[a].extraDecay >= 0.9, 'zasilenie nie zeruje stałego zaniku');
  for (let i = 0; i < 10; i++) g.simulate(r, 0.1);   // do 1,1 s: zasilenie w 0,1 s, życie 0,4 + wygaszanie 0,5
  assert.equal(g.slots[a].active, false, 'domena wylotu wolna po życiu + 0,5 s');
  assert.equal(g.slots[b].active, true, 'domena wybuchu wygasza się 1,6 s');
});

test('E1: właściciel błysku w siatce świateł (FxLights.owner — błysk wylotu działa z domeną gazu); bez właściciela dawne wywołanie', async () => {
  const { FxLights } = await import('../src/3d/fx/fxLights.js');
  const L = new FxLights({ random: rng(3), carrier: null, clock: { now: () => 0 } });
  const calls = [];
  const grid = { addWorld(...a) { calls.push(a); return 0; } };
  L.flash(10, 20, 1, 0.5, 0.2, 5, 300, 0.2);
  L.owner = 30004;
  L.flash(30, 40, 1, 0.5, 0.2, 5, 300, 0.2);
  L.owner = 0;
  L.commit(grid, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 8, 'bez właściciela — dawne argumenty');
  assert.equal(calls[1][15], 30004, 'właściciel w L3.w siatki');
  assert.equal(calls[1][11], -2, 'stożek dookólny (OMNI)');
  // usuwanie błysku (zamiana z ostatnim) przenosi właściciela
  L.update(0.25);
  L.owner = 7; L.flash(0, 0, 1, 1, 1, 1, 100, 1); L.owner = 0; L.flash(0, 0, 1, 1, 1, 1, 100, 0.05);
  L.update(0.1);
  assert.equal(L.count, 1);
  assert.equal(L.fowner[0], 7);
});

test('E2: paleta ognia jako WIERSZ (fire 0 ciało czarne, 1 plazma — jak w E1, 2 wodór), przejście liniowe między sąsiednimi, WGSL z wierszem wodoru', async () => {
  const { gasFirePaletteCpu, GAS_FIRE_ROWS, GAS_FIRE_MAX, GAS_FIRE_GLOW_HYDROGEN, GAS_FIRE_STOPS } = await import('../src/3d/gas/gasCommon.js');
  assert.equal(GAS_FIRE_MAX, 2);
  assert.equal(GAS_FIRE_ROWS[1], GAS_FIRE_STOPS.blue);
  for (const T of [0.3, 1.0, 1.6, 2.4, 3.5]) {
    const h = gasFirePaletteCpu(T, 2), b = gasFirePaletteCpu(T, 1);
    assert.ok(h[2] >= h[1] && h[1] >= h[0], `wodór: niebieski ≥ zielony ≥ czerwony (T ${T})`);
    assert.ok(h[0] > b[0], 'wodór bledszy (więcej czerwieni) niż plazma');
    const m = gasFirePaletteCpu(T, 1.5);
    for (let c = 0; c < 3; c++) assert.ok(m[c] >= Math.min(h[c], b[c]) - 1e-9 && m[c] <= Math.max(h[c], b[c]) + 1e-9, 'przejście 1 → 2 liniowe');
  }
  const l = 0.2126 * GAS_FIRE_GLOW_HYDROGEN[0] + 0.7152 * GAS_FIRE_GLOW_HYDROGEN[1] + 0.0722 * GAS_FIRE_GLOW_HYDROGEN[2];
  assert.ok(Math.abs(l - 1) < 0.01, 'blask wodoru zachowuje luminancję');
  const g = makeGrid();
  const a = g.acquire(0, 0, 0, 10, { size: 160, fire: 2 });
  const b = g.acquire(5000, 0, 0, 10, { size: 160, fire: 7 });
  assert.equal(g.slots[a].fire, 2);
  assert.equal(g.slots[b].fire, GAS_FIRE_MAX, 'paleta przycięta do ostatniego wiersza');
  assert.equal(g.slots[a].ambient, 0, 'otoczenie domeny domyślnie 0 (wybuchy jak dawniej)');
  const c = g.acquire(9000, 0, 0, 10, { size: 160, ambient: 0.9 });
  assert.equal(g.slots[c].ambient, 0.9, 'otoczenie domeny (dym zapłonu w hali K-7)');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g2 = makeGrid({ N: 16, NZ: 8, slots: 2 });
  const vol = new GasVolume({ grid: g2, noise3D: noiseTex(), curl3D: noiseTex() });
  const M = vol.createMeshes({ name: 'GasFireH' });
  const bld = renderer.backend.createNodeBuilder(M.back, renderer);
  bld.material = M.back.material; bld.scene = new THREE.Scene(); bld.camera = new THREE.OrthographicCamera(); bld.context.material = M.back.material;
  bld.build();
  const w = bld.fragmentShader;
  const loopAt = w.indexOf('for ( var gstep');
  assert.ok(w.slice(0, loopAt).includes('0.88, 0.92, 1'), 'przystanek jądra wodoru przed marszem');
  assert.ok(/vGasB\.w/.test(w), 'otoczenie domeny z kanału w instancji (gasB.w — bez nowych buforów)');
  assert.equal((w.match(/: texture_3d</g) || []).length, 5, 'bez nowych tekstur');
});
