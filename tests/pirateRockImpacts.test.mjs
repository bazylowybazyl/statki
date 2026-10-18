// Uderzenia w planetoidę pod bazą piratów (2026-10-19): kontrakt fizyki z obrazem (src/game/story/pirateRockImpacts.js →
// rekord ROCK_IMPACT → src/3d/pirateRockImpactFx.js), głębokie domeny gazu (GasSlot.deep — pass tła, kula-przeszkoda,
// bez statyki i kadłubów), lustra CPU (łuk balistyczny, cień kuli, cięcie promienia kulą), budowa WGSL w Node.
// node --test tests/pirateRockImpacts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { RC, RenderCommandWriter, RenderCommandReader } = await import('../src/render/renderCommands.js');
const { ROCK_IMPACT_CODE, ROCK_IMPACT_REC, ROCK_EVENT, ROCK_BODY_KINDS } = await import('../src/render/rockImpactRecord.js');
const RI = await import('../src/game/story/pirateRockImpacts.js');
const { createPirateRockLayout } = await import('../src/3d/portBuildings/pirateRockLayout.js');
const { placePirateBase } = await import('../src/game/story/pirateBaseSite.js');
const { RockImpactFx, installRockImpactCommands, setRockImpactHost, RIP } = await import('../src/3d/pirateRockImpactFx.js');
const { GasGrid } = await import('../src/3d/gas/gasGrid.js');
const { GasVolume, gasGroundLitCpu, gasSphereClipCpu } = await import('../src/3d/gas/gasVolume.js');
const { ExplosionFx } = await import('../src/3d/explosions/explosionFx.js');
const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
const { SimClock } = await import('../src/game/simClock.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const buildCompute = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };
function buildMesh(mesh, camera = new THREE.PerspectiveCamera()) {
  const mat = mesh.material;
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = camera; b.context.material = mat;
  b.build();
  return b;
}
function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}

// Strumień inline: pisarz + czytelnik z dyspozycją po każdym rekordzie (jak RenderCommands w trybie inline).
function inlineStream() {
  const writer = new RenderCommandWriter({ capacity: 1024 });
  const reader = new RenderCommandReader(writer.buffer, {});
  writer.onGrow = (b) => reader.adopt(b);
  writer.setInlineSink(() => reader.drain());
  return { writer, reader };
}

const place = placePirateBase({ x: 3.2e6, y: -1.4e6 }, 0.7);
let clock = 0;

test('rekord ROCK_IMPACT: kod 112 w zakresie „świat”, unikalny w RC, układ pól bez dziur', () => {
  assert.equal(RC.ROCK_IMPACT, ROCK_IMPACT_CODE);
  assert.equal(ROCK_IMPACT_CODE, 112);
  const vals = Object.values(RC);
  assert.equal(vals.filter((v) => v === 112).length, 1, 'kod unikalny');
  const idx = Object.entries(ROCK_IMPACT_REC).filter(([k]) => k !== 'WORDS').map(([, v]) => v).sort((a, b) => a - b);
  assert.deepEqual(idx, Array.from({ length: ROCK_IMPACT_REC.WORDS }, (_, i) => i));
  assert.deepEqual([...ROCK_BODY_KINDS], ['other', 'tower', 'disc', 'drum', 'core', 'debris', 'cable']);
});

test('kontrakt: rockImpact / rockScrape / rockSettle → rekord → dekoder → obraz (pola bit w bit, rodzaj ciała z napisu)', () => {
  const { writer, reader } = inlineStream();
  RI.installPirateRockImpacts(writer, { clock: () => clock, place: () => place });
  RI.resetPirateRockImpacts();
  const got = [];
  const host = { onEvent(type, e) { got.push({ type, ...e }); return true; } };
  setRockImpactHost(host);
  installRockImpactCommands(reader, null);
  clock = 10;
  const ok = RI.rockImpact({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, nx: 0.1, ny: -0.2, nz: 0.97, speed: 1800,
    slide: 240, mass: 5e7, size: 900, vx: 100, vy: 50, vz: -1700 });
  assert.equal(ok, true);
  assert.equal(got.length, 1);
  const e = got[0];
  assert.equal(e.type, ROCK_EVENT.IMPACT);
  assert.equal(e.kind, 'tower');
  assert.equal(e.x, 3.21e6); assert.equal(e.y, -1.39e6); assert.equal(e.z, -9000);
  const nl = Math.hypot(0.1, -0.2, 0.97);
  assert.ok(Math.abs(e.nx - 0.1 / nl) < 1e-12 && Math.abs(e.nz - 0.97 / nl) < 1e-12, 'normalna znormalizowana');
  assert.equal(e.speed, 1800); assert.equal(e.slide, 240); assert.equal(e.size, 900);
  assert.equal(e.energy, 0.5 * 5e7 * (1800 * 1800 + 240 * 240), 'energia z masy i prędkości, gdy jej nie podano');
  assert.equal(e.vz, -1700);
  // szorowanie: odstęp na ciało (scrapeGap), osiadanie raz
  clock = 10.1;
  assert.equal(RI.rockScrape({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, slide: 300, size: 700 }), false, 'zaraz po uderzeniu — kłąb uderzenia jest');
  clock = 10.35;
  assert.equal(RI.rockScrape({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, slide: 300, size: 700 }), true);
  clock = 10.4;
  assert.equal(RI.rockScrape({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, slide: 300, size: 700 }), false, 'odstęp szorowania');
  assert.equal(RI.rockSettle({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, size: 700 }), true);
  assert.equal(RI.rockSettle({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, size: 700 }), false, 'osiadanie raz');
  assert.deepEqual(got.map((g) => g.type), [ROCK_EVENT.IMPACT, ROCK_EVENT.SCRAPE, ROCK_EVENT.SETTLE]);
  // drugie uderzenie tego samego ciała za wcześnie — odrzucone, chyba że dużo mocniejsze
  clock = 10.5;
  assert.equal(RI.rockImpact({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, speed: 600, mass: 5e7, size: 900 }), true, 'po osiadaniu nowe uderzenie wchodzi (odstęp od pierwszego > impactGap)');
  clock = 10.6;
  assert.equal(RI.rockImpact({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, speed: 650, mass: 5e7, size: 900 }), false, 'odstęp uderzeń');
  assert.equal(RI.rockImpact({ id: 'wieza', kind: 'tower', x: 3.21e6, y: -1.39e6, z: -9000, speed: 2500, mass: 5e7, size: 900 }), true, 'dużo mocniejsze — przechodzi');
  // błędne zdarzenie: bez punktu styku
  const inv = RI.PirateRockImpacts.stats.invalid;
  assert.equal(RI.rockImpact({ id: 'x', x: NaN, y: 0, z: 0 }), false);
  assert.equal(RI.PirateRockImpacts.stats.invalid, inv + 1);
  setRockImpactHost(null);
});

test('kontrakt: normalna bez wartości — z położenia skały (kula, na zewnątrz); rockEventAt — punkt na powierzchni i normalna', () => {
  const { writer, reader } = inlineStream();
  RI.installPirateRockImpacts(writer, { clock: () => clock, place: () => place });
  RI.resetPirateRockImpacts();
  const got = [];
  setRockImpactHost({ onEvent(type, e) { got.push({ ...e }); return true; } });
  installRockImpactCommands(reader, null);
  const L = createPirateRockLayout();
  const c = RI.pirateRockCenterGame({});
  assert.ok(c && Math.abs(c.z - L.center[1]) < 1e-9);
  // punkt nad środkiem skały (+z) — normalna (0, 0, 1)
  clock = 50;
  RI.rockImpact({ id: 'n', kind: 'debris', x: c.x, y: c.y, z: c.z + L.R, speed: 500, size: 60 });
  assert.ok(Math.abs(got[0].nz - 1) < 1e-9 && Math.abs(got[0].nx) < 1e-9);
  // rockEventAt: punkt (e, n) leży na kuli R, normalna od środka, z — wysokość tarasu dla (0, 0)
  const ev = RI.rockEventAt({ e: 0, n: 0, size: 500, speed: 1000 });
  assert.ok(Math.abs(ev.z - L.foot[1]) < 1e-6, 'stopa windy: wysokość tarasu');
  for (const [e0, n0] of [[-3600, 0], [1200, -2500], [5000, 4000]]) {
    const q = RI.rockEventAt({ e: e0, n: n0, size: 300, speed: 800, slide: 200, dirE: 1, dirN: 0 });
    const dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z;
    const r = Math.hypot(dx, dy, dz);
    assert.ok(Math.abs(r - L.R) < 1e-3, `(${e0}, ${n0}) na kuli: ${r}`);
    assert.ok(Math.abs(q.nx - dx / r) < 1e-9 && Math.abs(q.ny - dy / r) < 1e-9 && Math.abs(q.nz - dz / r) < 1e-9, 'normalna od środka');
    // prędkość: ku skale (−normalna · speed) + poślizg styczny
    const vn = q.vx * q.nx + q.vy * q.ny + q.vz * q.nz;
    assert.ok(Math.abs(vn + 800) < 1e-6);
    const vt = Math.hypot(q.vx + q.nx * 800, q.vy + q.ny * 800, q.vz + q.nz * 800);
    assert.ok(Math.abs(vt - 200) < 1e-6, 'poślizg styczny');
  }
  setRockImpactHost(null);
});

test('demo upadku: zaplanowane zdarzenia schodzą krokiem w czasie gry', () => {
  const { writer, reader } = inlineStream();
  RI.installPirateRockImpacts(writer, { clock: () => clock, place: () => place });
  RI.resetPirateRockImpacts();
  const got = [];
  setRockImpactHost({ onEvent(type) { got.push(type); return true; } });
  installRockImpactCommands(reader, null);
  clock = 100;
  RI.demoRockFall();
  RI.stepPirateRockImpacts();
  assert.equal(got.length, 1, 'wieża od razu');
  for (let t = 0; t < 9; t += 1 / 60) { clock = 100 + t; RI.stepPirateRockImpacts(); }
  assert.ok(got.filter((t) => t === ROCK_EVENT.IMPACT).length >= 30, `uderzenia: ${got.length}`);
  assert.ok(got.includes(ROCK_EVENT.SCRAPE) && got.includes(ROCK_EVENT.SETTLE));
  setRockImpactHost(null);
});

test('łuk balistyczny: czas lądowania na kuli (Newton) zgodny z całkowaniem stałej grawitacji ku środkowi', () => {
  const R = 16000, g = 400;
  for (const [th, sp] of [[0.6, 300], [0.9, 800], [0.3, 1500], [1.2, 150]]) {
    // punkt na kuli w kierunku (0.2, 0.1, 1) (znormalizowany), wyrzut w płaszczyźnie (n, t1)
    const n = [0.2, 0.1, 1]; const nl = Math.hypot(...n); n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const t1 = [1, 0, -n[0] / n[2]]; const tl = Math.hypot(...t1); t1[0] /= tl; t1[1] /= tl; t1[2] /= tl;
    const p0 = n.map((v) => v * (R + 8));
    const v0 = [0, 1, 2].map((i) => (n[i] * Math.cos(th) + t1[i] * Math.sin(th)) * sp);
    const t = RockImpactFx.landTime(p0[0], p0[1], p0[2], v0[0], v0[1], v0[2], g, R, 60);
    const gd = p0.map((v) => -v / Math.hypot(...p0));
    const pt = [0, 1, 2].map((i) => p0[i] + v0[i] * t + 0.5 * g * t * t * gd[i]);
    assert.ok(Math.abs(Math.hypot(...pt) - R) < 0.5, `|p(t)| = R: ${Math.hypot(...pt)} (θ ${th}, v ${sp})`);
    // przed lądowaniem nad powierzchnią
    const tm = t * 0.5;
    const pm = [0, 1, 2].map((i) => p0[i] + v0[i] * tm + 0.5 * g * tm * tm * gd[i]);
    assert.ok(Math.hypot(...pm) > R, 'w połowie lotu nad skałą');
    // oszacowanie płaskie (2 v_n / g) — ten sam rząd
    const flat = 2 * sp * Math.cos(th) / g;
    assert.ok(t > flat * 0.9 && t < flat * 1.6, `czas ${t} vs płaski ${flat}`);
  }
  // wyrzut w dół z 10 j. nad skałą: 200 t² + 50 t − 10 = 0 → t ≈ 0,131 s
  assert.ok(Math.abs(RockImpactFx.landTime(0, 0, 16010, 0, 0, -50, 400, 16000) - (-50 + Math.sqrt(2500 + 8000)) / 400) < 1e-4);
});

test('lustra CPU: cień kuli (słońce z płaszczyzny gry) i cięcie promienia kulą', () => {
  const R = 16000, w = 90, sun = [1, 0, 0];
  assert.equal(gasGroundLitCpu([0, 0, R + 500], sun, R, w), 1, 'nad szczytem — oświetlony (słońce poziomo, promień mija kulę)');
  assert.equal(gasGroundLitCpu([R + 10, 0, 0], sun, R, w), 1, 'po stronie słońca');
  assert.equal(gasGroundLitCpu([-R - 10, 0, 0], sun, R, w), 0, 'za skałą — cień');
  const t = gasGroundLitCpu([-2000, 0, R + 20], sun, R, w);
  assert.ok(t > 0.4, 'tuż za terminatorem, nad powierzchnią — półcień / światło');
  // promień z góry w szczyt: przecięcie na wysokości R
  const tc = gasSphereClipCpu([0, 0, R + 9000], [0, 0, -1], [0, 0, 0], R);
  assert.ok(Math.abs(tc - 9000) < 1e-6);
  assert.equal(gasSphereClipCpu([0, 0, R + 9000], [1, 0, 0], [0, 0, 0], R), Infinity, 'mija kulę');
  assert.equal(gasSphereClipCpu([0, 0, R - 10], [0, 0, -1], [0, 0, 0], R), Infinity, 'start w kuli — bez cięcia');
});

test('GasGrid: domena głęboka — kula-przeszkoda w komórkach (uniform gasGround), test 3D komórki stałej, bez rastra i kadłubów', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(3), maxHulls: 8, hullBands: 3 });
  // kula promienia 1000 pod domeną: powierzchnia na z = −20 (domena h = 8, środek z = 0)
  const s = g.acquire(0, 0, 0, 30, { size: 128, now: 0, reuse: false, deep: true, ground: { x: 0, y: 0, z: -1020, r: 1000 }, baseDecay: -0.9 });
  const sl = g.slots[s];
  assert.equal(sl.deep, true); assert.equal(sl.noStatics, true); assert.equal(sl.noHulls, true);
  assert.equal(sl.baseDecay, -0.4, 'zanik dodatkowy ≥ −0,4');
  assert.equal(g._needsRaster(sl, 0), false, 'bez rastra statyki');
  // statyka i kadłub w miejscu domeny — domena głęboka ich nie bierze
  g.setStatics(1, new Float64Array([0, 0, 1, 0, 30, 30]), 1);
  const hull = new Float64Array(64).fill(0);
  g.hull(hull, 0);
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(g.stats.hulls, 0, 'bez kadłubów-przeszkód');
  assert.equal(g.stats.masked, 0, 'bez rastra');
  const G = g.U.ground.array[sl.index];
  const h = sl.h;
  assert.ok(Math.abs(G.w - 1000 / h) < 1e-9, 'promień w komórkach');
  assert.ok(Math.abs(G.z - ((-1020 - sl.cz) / h + 4)) < 1e-9, 'środek w komórkach (z od dołu domeny)');
  // komórka (8, 8, z): stała poniżej powierzchni (z świata < −20 → z komórki < (−20 − cz)/h + 4 = 1,5)
  assert.equal(g.solidCpu(sl.index, 8, 8, null, 1.0), 1, 'pod powierzchnią — stała');
  assert.equal(g.solidCpu(sl.index, 8, 8, null, 3.0), 0, 'nad powierzchnią — gaz');
  assert.equal(g.solidCpu(sl.index, 8, 8, null), 0, 'bez z — test 2D jak dawniej (kula pominięta)');
  // zwykła domena: kula wyzerowana
  const s2 = g.acquire(5000, 0, 0, 30, { size: 128, now: 0, reuse: false });
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(g.U.ground.array[g.slots[s2].index].w, 0);
  assert.equal(g.slots[s2].deep, false); assert.equal(g.slots[s2].noStatics, false);
  // ogólne przepusty: noStatics / noHulls bez domeny głębokiej (domena nad płaszczyzną — głowa wieży)
  const s3 = g.acquire(-5000, 0, 0, 30, { size: 128, now: 0, reuse: false, noStatics: true, noHulls: true });
  assert.equal(g.slots[s3].deep, false);
  assert.ok(g.slots[s3].noStatics && g.slots[s3].noHulls);
  assert.equal(g._needsRaster(g.slots[s3], 0), false);
});

test('WGSL: reakcja czyta gasGround (≤ 12 buforów uniformów), rzut ma ściany w osi z; bryły głębokie i cząstki budują się', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 2, jacobi: 5, noise3D: noiseTex(), rng: rng(5), maxHulls: 8, hullBands: 3 });
  const react = buildCompute(g.reactNode);
  assert.match(react, /gasGround/);
  assert.ok((react.match(/var<uniform>/g) || []).length <= 12, `bufory uniformów reakcji: ${(react.match(/var<uniform>/g) || []).length}`);
  const proj = buildCompute(g.projectNode);
  assert.ok((proj.match(/var<uniform>/g) || []).length <= 12);
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const deep = vol.createDeepMeshes({ layer: 1 });
  assert.equal(deep.out.mesh.layers.mask, 1 << 1, 'pass tła');
  assert.equal(deep.out.mesh.material.depthTest, true);
  assert.equal(deep.in.mesh.material.depthTest, false);
  assert.equal(deep.out.mesh.material.side, THREE.FrontSide);
  assert.equal(deep.in.mesh.material.side, THREE.BackSide);
  for (const m of [deep.out.mesh, deep.in.mesh]) {
    const b = buildMesh(m);
    assert.ok((b.fragmentShader.match(/var<uniform>/g) || []).length <= 12, 'bufory uniformów marszu');
    const vb = Object.keys(m.geometry.attributes).length;
    assert.ok(vb <= 8, `bufory wierzchołków: ${vb}`);
  }
  // cząstki uderzeń: obie partie (zwykła i addytywna) budują się, jeden bufor z przeplotem + pozycja
  const fx = new RockImpactFx({ layer: 1 });
  for (const m of fx.warmupMeshes()) {
    const b = buildMesh(m);
    assert.ok(b.vertexShader.length > 0 && b.fragmentShader.length > 0);
    assert.ok((b.vertexShader.match(/var<uniform>/g) || []).length <= 12);
  }
});

test('GasVolume: instancje domen głębokich tylko w bryłach tła (kamera w pudle — wariant „in”), zwykłe tylko w ortho / FG', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(9), maxHulls: 8, hullBands: 3 });
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  vol.createMeshes({});
  vol.createDeepMeshes({});
  g.acquire(0, 0, 0, 30, { size: 128, now: 0, reuse: false });
  g.acquire(3000, 0, -9000, 30, { size: 128, now: 0, reuse: false, deep: true, ground: { x: 3000, y: 0, z: -26000, r: 16000 } });
  g.acquire(-3000, 0, -9000, 30, { size: 128, now: 0, reuse: false, deep: true });
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(vol.updateMeshes(0, 0, 0), 1, 'zwykła domena — bryły ortho / FG');
  assert.equal(vol.updateDeepMeshes(0, 0, 0, 0, 8000), 2, 'głębokie — bryły tła');
  assert.equal(vol.deepMeshes.out.geo.instanceCount, 2);
  assert.equal(vol.deepMeshes.in.geo.instanceCount, 0);
  const D = vol.deepMeshes.out.attrs[3].array;
  assert.deepEqual([D[0], D[1], D[2], D[3]], [3000, 0, -26000, 16000], 'kula-przeszkoda względem początku sceny');
  assert.deepEqual([D[4], D[5], D[6], D[7]], [0, 0, 0, 0], 'bez kuli — zera');
  // kamera w pudle drugiej domeny głębokiej
  vol.updateDeepMeshes(0, 0, -3000, 0, -9000);
  assert.equal(vol.deepMeshes.in.geo.instanceCount, 1);
  assert.equal(vol.deepMeshes.out.geo.instanceCount, 1);
});

function fakeCore() {
  const cameraOrtho = new THREE.OrthographicCamera(-800, 800, 450, -450, 1, 400000);
  cameraOrtho.position.set(0, 0, 150000);
  cameraOrtho.updateMatrixWorld();
  const field = { shock() { return true; }, heat() { return true; } };
  return {
    scene: new THREE.Scene(), steps: [], activeCam1: { x: 0, y: 0, zoom: 0.3 }, composerTarget: { width: 1600, height: 900 },
    cameraOrtho, cameraPersp: new THREE.PerspectiveCamera(35, 16 / 9, 100, 5e5),
    isFreePerspectiveCamera() { return false; }, fxDistortion() { return field; },
    addFxStep(step) { this.steps.push(step); return step; },
    fx: { origin: new FxPoolOrigin({ name: 'testOrigin' }), view: { x0: -3000, y0: -1700, x1: 3000, y1: 1700 }, removeStep() {} }
  };
}

test('ExplosionFx.deepDomain: domena tła w świecie gry (y odbite), zapas wolnych domen, rzut perspektywy; wybuch w płaszczyźnie jej nie scala', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { clock: () => SimClock.sim, grid: { slots: 2, fineSlots: 1, coarseSlots: 3, lazy: false } });
  assert.ok(fx._deepSets.length >= 1 && fx._deepSets[0].out.mesh.layers.mask === 1 << 1, 'bryły głębokie w passie tła');
  // punkt pod kamerą 9 km w dół: rzut z góry — skala k < 1, ppu mniejsze niż w płaszczyźnie
  const pr = fx._deepProject(1000, 500, -9000, {});
  assert.ok(pr.k > 0 && pr.k < 1);
  assert.ok(Math.abs(pr.x - 1000 * pr.k) < 1e-9 && Math.abs(pr.y - 500 * pr.k) < 1e-9);
  assert.ok(fx._pxPerUnitZ(0, 0, -9000) < fx._pxPerUnit(0, 0));
  const slot = fx.deepDomain(1000, 500, -9000, 900, {
    up: [0, 0, 1], ground: { x: 1000, y: 500, z: -25000, r: 16000 }, tag: 10, life: 7, baseDecay: -0.38, tint: [2, 2, 2], reserve: 1
  });
  assert.ok(slot >= 0, 'domena głęboka');
  const s = fx.grid.slots[slot];
  assert.equal(s.deep, true); assert.equal(s.tag, 10);
  assert.equal(s.cx, 1000); assert.equal(s.cy, -500 + 0, 'scena: y odbite');
  assert.ok(s.cz > -9000, 'środek domeny podniesiony wzdłuż „up”');
  assert.equal(s.gy, -500, 'kula w scenie'); assert.equal(s.gr, 16000);
  assert.ok(Math.abs(s.baseDecay + 0.38) < 1e-12);
  // wybuch w płaszczyźnie gry nad domeną głęboką nie dokłada się do niej
  assert.equal(fx._fitSlot(1000, 500, 200, 0, 0), -1);
  // prostokąty domen dla kadłubów — bez domeny głębokiej
  const out = new Float64Array(64);
  assert.equal(fx.domainRects(out), 0);
  // zapas: przy jednej wolnej domenie (reserve 1) — odmowa
  let n = 0;
  while (fx.deepDomain(3000 + n * 4000, 0, -9000, 900, { reserve: 1, inView: false }) >= 0 && n < 20) n++;
  let free = 0;
  for (const sl of fx.grid.slots) if (!sl.active) free++;
  assert.equal(free, 1, 'jedna wolna domena zostaje dla wybuchów');
  // klatka: bryły tła dostają instancje domen głębokich
  SimClock.sim += 1 / 60;
  const ctx = { renderer: { compute() {} }, core, origin: core.fx.origin, view: core.fx.view, grid: { addWorld() { return 0; } } };
  core.steps[0].spawn(ctx); core.steps[0].update(ctx);
  assert.equal(fx.stats.deepDomains, n + 1);
});

test('RockImpactFx: uderzenie emituje cząstki (odłamki z lądowaniem, pył, pierścień, iskry, błysk) i woła gaz; pierścienie bez alokacji wyników', () => {
  const fx = new RockImpactFx({ layer: 1 });
  fx.setRock(0, 0, -24000, 16000);
  const calls = [];
  const gas = {
    grid: { slots: [], time: 0, feed() {} },
    director: { jet() { calls.push('jet'); }, puff() { calls.push('puff'); } },
    deepDomain(x, y, z, R, o) { calls.push(['deep', x, y, z, R, o.ground.r, o.tag]); this.grid.slots[0] = { active: true, deep: true, tag: o.tag, h: R * 4.4 / 96, n: 96, nz: 36, cx: x, cy: -y, cz: z }; return 0; },
    setDeepSun() {}
  };
  fx.getGas = () => gas;
  const e = { id: 1, kind: 'tower', x: 0, y: 0, z: -8000, nx: 0, ny: 0, nz: 1, speed: 1900, slide: 200, mass: 1e6, size: 900, energy: 1e12, vx: 200, vy: 0, vz: -1900 };
  assert.equal(fx.onEvent(ROCK_EVENT.IMPACT, e), true);
  assert.ok(fx.alpha.used > 100, `pył i odłamki: ${fx.alpha.used}`);
  assert.ok(fx.add.used > 10, `iskry, błysk, żar: ${fx.add.used}`);
  const deep = calls.find((c) => Array.isArray(c) && c[0] === 'deep');
  assert.ok(deep, 'głęboka domena gazu');
  assert.equal(deep[3], -8000); assert.equal(deep[6], 10, 'tag uderzeń');
  assert.ok(Math.abs(deep[5] - 16000) < 1e-6, 'kula-przeszkoda przez punkt styku');
  assert.ok(calls.filter((c) => c === 'jet').length >= 12, 'pióropusz, stożek, pierścień');
  // odłamki: czas lądowania > 0 i skończony, rodzaj CHUNK
  const A = fx.alpha.arr;
  let chunks = 0;
  for (let i = 0; i < fx.alpha.used; i++) {
    if (A[i * 20 + 9] !== RIP.CHUNK) continue;
    chunks++;
    const tl = A[i * 20 + 7];
    assert.ok(tl > 0 && tl < 30, `lądowanie ${tl}`);
  }
  assert.ok(chunks > 50);
  // małe uderzenie (odłam): bez domeny gazu — same cząstki (ciało poniżej gasMinSize; w żywym obłoku uderzeń tym bardziej)
  const before = calls.length;
  fx.onEvent(ROCK_EVENT.IMPACT, { ...e, kind: 'debris', size: 60, speed: 400, slide: 0 });
  assert.ok(calls.slice(before).every((c) => !(Array.isArray(c) && c[0] === 'deep')), 'małe — bez nowej domeny');
  fx.onEvent(ROCK_EVENT.IMPACT, { ...e, kind: 'drum', size: 260, speed: 900, slide: 0, x: 400 });
  assert.ok(calls.slice(before).every((c) => !(Array.isArray(c) && c[0] === 'deep')), 'średnie w żywym obłoku — scalone, bez nowej domeny');
  // szorowanie dokłada pył do żywej domeny uderzeń (scalanie)
  const nb = calls.length;
  fx.onEvent(ROCK_EVENT.SCRAPE, { ...e, slide: 420, speed: 0, size: 700 });
  assert.ok(calls.slice(nb).includes('puff'), 'pył szorowania w gazie');
  fx.update(1 / 60, 1, 0);
  assert.equal(fx.alpha.mesh.visible, true);
  fx.reset();
  fx.update(1 / 60, 1, 0);
  assert.equal(fx.alpha.mesh.visible, false);
});
