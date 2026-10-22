// Uderzenia w planetoidę pod bazą piratów (2026-10-19): kontrakt fizyki z obrazem (src/game/story/pirateRockImpacts.js →
// rekord ROCK_IMPACT → src/3d/pirateRockImpactFx.js), głębokie domeny gazu (GasSlot.deep — pass tła, kula-przeszkoda,
// bez statyki i kadłubów), lustra CPU (łuk balistyczny, cień kuli, cięcie promienia kulą), budowa WGSL w Node.
// node --test tests/pirateRockImpacts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { RC, RenderCommandWriter, RenderCommandReader } = await import('../src/render/renderCommands.js');
const { ROCK_IMPACT_CODE, ROCK_IMPACT_REC, ROCK_EVENT, ROCK_BODY_KINDS, ROCK_FOOT_BINS } = await import('../src/render/rockImpactRecord.js');
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
  // pola nazwane + tablica promieni obrysu od FR (ROCK_FOOT_BINS słów) — bez dziur i nakładek
  const idx = Object.entries(ROCK_IMPACT_REC).filter(([k]) => k !== 'WORDS' && k !== 'FR').map(([, v]) => v);
  for (let k = 0; k < ROCK_FOOT_BINS; k++) idx.push(ROCK_IMPACT_REC.FR + k);
  idx.sort((a, b) => a - b);
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
  assert.equal(e.fn, 0, 'bez obrysu — fn = 0 (obraz bierze koło z rozmiaru)');
  // obrys bryły (pył na boki): środek rzutu, kierunek kąta 0 (⊥ normalnej, jednostkowy) i profil promieni przez rekord
  clock = 11;
  const fr = Array.from({ length: ROCK_FOOT_BINS }, (_, k) => 300 + 20 * k);
  assert.equal(RI.rockImpact({ id: 'dysk', kind: 'disc', x: 3.2e6, y: -1.4e6, z: -9000, nx: 0, ny: 0, nz: 1, speed: 900, size: 700,
    fx: 3.2e6 + 150, fy: -1.4e6 - 40, fz: -9000, ux: 2, uy: 0, uz: 0.5, fr }), true);
  const f = got.at(-1);
  assert.equal(f.fx, 3.2e6 + 150); assert.equal(f.fy, -1.4e6 - 40); assert.equal(f.fz, -9000);
  assert.equal(f.fn, ROCK_FOOT_BINS);
  for (let k = 0; k < ROCK_FOOT_BINS; k++) assert.equal(f.fr[k], fr[k], `promień ${k}`);
  assert.ok(Math.abs(f.ux - 1) < 1e-12 && Math.abs(f.uy) < 1e-12 && Math.abs(f.uz) < 1e-12, 'kierunek kąta 0 ⊥ normalnej');
  got.pop();
  // same zera — bez obrysu
  clock = 11.6;
  RI.rockImpact({ id: 'dysk', kind: 'disc', x: 3.2e6, y: -1.4e6, z: -9000, nx: 0, ny: 0, nz: 1, speed: 2000, mass: 1e9, size: 700,
    fx: 3.2e6, fy: -1.4e6, fz: -9000, ux: 1, uy: 0, uz: 0, fr: new Array(ROCK_FOOT_BINS).fill(0) });
  assert.equal(got.at(-1).fn, 0);
  got.pop();
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

test('ślady uderzeń na skale: lustro reguły (lód na dnie i w promieniach, ciemny wał), addScar w układzie siatki kuli, scalanie, sufit', async () => {
  const { PirateRock3D, pirateRockScarCpu, PIRATE_ROCK_SCAR_CAP } = await import('../src/3d/pirateRock3D.js');
  const { portModuleFrame } = await import('../src/3d/portBuildings/portModuleTraffic.js');
  const c0 = pirateRockScarCpu(0, 1, 1), cRim = pirateRockScarCpu(1.0, 0, 1), cRay = pirateRockScarCpu(1.3, 1, 1), cFar = pirateRockScarCpu(3, 1, 1);
  assert.ok(c0.ice > 0.6 && c0.dark === 0, 'dno — lód');
  assert.ok(cRim.dark > 0.2 && cRim.ice < c0.ice, 'wał — ciemniejszy');
  assert.ok(cRay.ice > cRim.ice, 'promień za wałem — lód');
  assert.equal(pirateRockScarCpu(1.3, 0, 1).ice < cRay.ice, true, 'między promieniami — bez lodu');
  assert.deepEqual(cFar, { ice: 0, dark: 0 });
  const prevWarn = console.warn; console.warn = () => {};
  const RL = createPirateRockLayout();
  const r = new PirateRock3D(RL);
  console.warn = prevWarn;
  r.setFrame(portModuleFrame(4.2e6, -1.3e6, 0.7), { x: 4.2e6, y: 1.3e6 });
  r.mesh.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(1, 0, 0).applyMatrix4(r.mesh.matrixWorld);   // stopa windy (lon 0, lat 0) w scenie
  assert.equal(r.addScar(p.x, p.y, p.z, 600, 1), true);
  const A = r._scarA.array, B = r._scarB.array;
  assert.equal(r._scarCount, 1);
  assert.ok(Math.abs(A[0].x - 1) < 1e-6 && Math.abs(A[0].y) < 1e-6 && Math.abs(A[0].z) < 1e-6, 'kierunek w układzie siatki kuli');
  assert.ok(Math.abs(A[0].w - 600 / RL.R) < 1e-9, 'promień kątowy');
  assert.ok(Math.abs(B[0].w - Math.cos(A[0].w * 2.7)) < 1e-9, 'próg zasięgu pętli');
  // bliski ślad — scalenie (bez nowego wpisu, większy)
  const q = new THREE.Vector3(1, 0.01, 0).normalize().applyMatrix4(r.mesh.matrixWorld);
  r.addScar(q.x, q.y, q.z, 500, 0.8);
  assert.equal(r._scarCount, 1);
  assert.ok(A[0].w > 600 / RL.R);
  // sufit: kolejne ślady w różnych miejscach — najwyżej PIRATE_ROCK_SCAR_CAP
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const w = new THREE.Vector3(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.53).normalize().applyMatrix4(r.mesh.matrixWorld);
    r.addScar(w.x, w.y, w.z, 300 + i * 10, 0.5 + (i % 3) * 0.3);
  }
  assert.equal(r._scarCount, PIRATE_ROCK_SCAR_CAP);
  assert.equal(r._scarN.value, PIRATE_ROCK_SCAR_CAP);
  r.clearScars();
  assert.equal(r._scarN.value, 0);
  // materiał skały ma własny graf barwy (colorNode) — WGSL z pętlą po śladach
  const b = buildMesh(r.mesh);
  assert.match(b.fragmentShader, /pirateRockScarA/);
});

test('kontrakt: deepBlast — wybuch w głębi bez skały (rekord BLAST, kierunek opcjonalny, odstęp na ciało)', () => {
  const { writer, reader } = inlineStream();
  RI.installPirateRockImpacts(writer, { clock: () => clock, place: () => place });
  RI.resetPirateRockImpacts();
  const got = [];
  setRockImpactHost({ onEvent(type, e) { got.push({ type, ...e }); return true; } });
  installRockImpactCommands(reader, null);
  clock = 50;
  assert.equal(RI.deepBlast({ id: 'przebicie', kind: 'tower', x: 3.2e6, y: -1.4e6, z: -800, size: 800, nx: 0, ny: 0.3, nz: -0.95,
    speed: 1800, vx: 10, vy: -20, vz: -300 }), true);
  const e = got[0];
  assert.equal(e.type, ROCK_EVENT.BLAST);
  assert.equal(e.kind, 'tower'); assert.equal(e.z, -800); assert.equal(e.size, 800); assert.equal(e.speed, 1800);
  assert.ok(Math.abs(Math.hypot(e.nx, e.ny, e.nz) - 1) < 1e-12, 'kierunek znormalizowany');
  assert.equal(e.vz, -300, 'nośnik bez zmian');
  clock = 50.1;
  assert.equal(RI.deepBlast({ id: 'przebicie', x: 3.2e6, y: -1.4e6, z: -800, size: 800 }), false, 'odstęp wybuchów ciała');
  clock = 50.5;
  assert.equal(RI.deepBlast({ id: 'przebicie', x: 3.2e6, y: -1.4e6, z: -800 }), true);
  const e2 = got[1];
  assert.equal(e2.nx, 0); assert.equal(e2.ny, 0); assert.equal(e2.nz, 0, 'bez kierunku — kulisty (zera, nie normalna skały)');
  assert.equal(e2.size, 700, 'domyślny promień');
  assert.equal(e2.speed, 0);
  assert.equal(RI.deepBlast({ id: 'x', x: 0, y: NaN, z: 0 }), false);
  assert.equal(RI.PirateRockImpacts.blast, RI.deepBlast);
  setRockImpactHost(null);
});

test('RockImpactFx: dopasowanie zasięgu gazu do elipsoidy domeny (_fitAlong / _fitSpeed) — pióropusz nie wbija się w sufit', () => {
  const fx = new RockImpactFx({ layer: 1 });
  fx.setRock(0, 0, -24000, 16000);
  // pudło 96 × 96 × 36 komórek po h = 50: półosie 2400 (x, y) i 900 (z)
  const s = { h: 50, n: 96, nz: 36, cx: 0, cy: 0, cz: 0 };
  assert.ok(Math.abs(fx._fitAlong(s, 0, 0, 0, 1, 0, 0, 0.8) - 1920) < 1e-9);
  assert.ok(Math.abs(fx._fitAlong(s, 0, 0, 0, 0, 0, 1, 0.8) - 720) < 1e-9);
  assert.ok(Math.abs(fx._fitAlong(s, 0, 0, -300, 0, 0, 1, 0.8) - 1020) < 1e-9, 'punkt pod środkiem — więcej miejsca w górę');
  assert.equal(fx._fitAlong(s, 0, 0, 2000, 0, 0, 1, 0.8), 0, 'punkt poza elipsoidą');
  const T = fx.tune;
  assert.equal(fx._fitSpeed(1000, 0.4, 100, 1e6), 1000, 'dużo miejsca — prędkość bez zmian');
  const v = fx._fitSpeed(1000, 0.4, 100, 900);
  assert.ok(Math.abs(v - (0.8 * 900 - 100) / (0.4 + T.gasCoast)) < 1e-9);
  assert.equal(fx._fitSpeed(1000, 0.4, 100, 50), 120, 'najmniej 0,12 × prędkość');
  // uderzenie wieży w szczyt (normalna +z): strumienie z domeny o geometrii deepDomain (szerokość 5,6 R, środek wyżej o
  // gasUpShift × wysokość) mieszczą zasięg (len + v · (czas + coast)) w 0,8 elipsoidy — albo stoją na dolnej granicy
  const jets = [];
  const gas = {
    grid: { slots: [], time: 0, feed() {} },
    director: { jet(slot, x, y, z, dx, dy, dz, r, len, speed, dur) { jets.push({ x, y, z, dx, dy, dz, len, speed, dur }); }, puff() {} },
    deepDomain(x, y, z, R, o) {
      const h = R * o.domainScale / 96;
      this.grid.slots[0] = { active: true, deep: true, tag: o.tag, h, n: 96, nz: 36, cx: x, cy: -y, cz: z + o.upShift * 36 * h };
      return 0;
    },
    setDeepSun() {}
  };
  fx.getGas = () => gas;
  fx.onEvent(ROCK_EVENT.IMPACT, { id: 1, kind: 'tower', x: 0, y: 0, z: -8000, nx: 0, ny: 0, nz: 1, speed: 1900, slide: 0, mass: 1e6, size: 1280, energy: 1e12, vx: 0, vy: 0, vz: -1900 });
  assert.ok(jets.length >= 12, `strumieni ${jets.length}`);
  const sl = gas.grid.slots[0];
  for (const j of jets) {
    const l = Math.hypot(j.dx, j.dy, j.dz);
    const avail = fx._fitAlong(sl, j.x, j.y, j.z, j.dx / l, j.dy / l, j.dz / l, 0.85);
    const reach = j.len + j.speed * (j.dur + T.gasCoast);
    assert.ok(reach <= 0.8 * avail + 1e-6, `zasięg ${reach.toFixed(0)} > ${(0.8 * avail).toFixed(0)}`);
  }
  // pył NA BOKI (2026-10-19): bez pióropusza wzdłuż normalnej — strumienie ≥ 63° od niej (dz ≤ 0,45)
  for (const j of jets) {
    const l = Math.hypot(j.dx, j.dy, j.dz);
    assert.ok(j.dz / l < 0.45, `strumień ${Math.round(Math.acos(j.dz / l) * 180 / Math.PI)}° od normalnej`);
  }
});

test('RockImpactFx: pył z KRAWĘDZI obrysu bryły na zewnątrz (gaz i cząstki poza obrysem, błysk pod bryłą)', () => {
  const fx = new RockImpactFx({ layer: 1 });
  fx.setRock(0, 0, -24000, 16000);
  const src = [];
  const gas = {
    grid: { slots: [], time: 0, feed() {} },
    director: {
      jet(slot, x, y, z, dx, dy, dz, r) { src.push({ kind: 'jet', x, y, z, dx, dy, dz, r }); },
      puff(slot, x, y, z, r, delay, dur, fuel, radial, o) { src.push({ kind: 'puff', x, y, z, r, dx: o.dir[0], dy: o.dir[1], dz: o.dir[2] }); }
    },
    deepDomain(x, y, z, R, o) {
      const h = R * o.domainScale / 96;
      this.grid.slots[0] = { active: true, deep: true, tag: o.tag, h, n: 96, nz: 36, cx: x, cy: -y, cz: z + o.upShift * 36 * h };
      src.push({ kind: 'domain', x, y, z, R });
      return 0;
    },
    setDeepSun() {}
  };
  fx.getGas = () => gas;
  // leżąca wieża z okrągłą głową: obrys = koło r 880 (głowa, środek w obrysie przesunięty o 600 j. wzdłuż +x) ∪ pas
  // 2 × 1300 na 2 × 220 (szyja wzdłuż osi x) — profil biegunowy jak z fizyki (największy promień w wycinku)
  const inShape = (x, y) => Math.hypot(x - 600, y) <= 880 || (Math.abs(x) <= 1300 && Math.abs(y) <= 220);
  const K = ROCK_FOOT_BINS;
  const fr = new Array(K).fill(0);
  for (let px = -1400; px <= 1500; px += 10) for (let py = -900; py <= 900; py += 10) {
    if (!inShape(px, py)) continue;
    let a = Math.atan2(py, px); if (a < 0) a += Math.PI * 2;
    const k = Math.min(K - 1, Math.floor(a / (Math.PI * 2) * K));
    fr[k] = Math.max(fr[k], Math.hypot(px, py));
  }
  // środek obrysu w grze (200, 0); scena: x = x gry, y = −y gry (oś u = +x, v = n × u = +y sceny)
  fx.onEvent(ROCK_EVENT.IMPACT, { id: 1, kind: 'tower', x: 1300, y: 0, z: -8000, nx: 0, ny: 0, nz: 1, speed: 1900, slide: 0, mass: 1e6,
    size: 1600, energy: 1e12, vx: 0, vy: 0, vz: -1900, fx: 200, fy: 0, fz: -8000, ux: 1, uy: 0, uz: 0, fn: K, fr });
  const dom = src.find((s) => s.kind === 'domain');
  assert.ok(dom && Math.abs(dom.x - 200) < 1e-6, 'domena na środku obrysu');
  assert.ok(dom.R >= Math.max(...fr), 'obłok obejmuje obrys');
  // poza PRAWDZIWYM kształtem (koło głowy i pas szyi — bez prostokątnej ramki) i ku zewnątrz od środka obrysu
  const outside = (x, y) => !inShape(x - 200, y);
  let n = 0, nearRound = 0;
  for (const s of src) {
    if (s.kind === 'domain') continue;
    n++;
    assert.ok(outside(s.x, s.y), `${s.kind} w obrysie: ${s.x.toFixed(0)}, ${s.y.toFixed(0)}`);
    assert.ok((s.x - 200) * s.dx + s.y * s.dy > 0, `${s.kind} leci pod bryłę`);
    const l = Math.hypot(s.dx, s.dy, s.dz);
    assert.ok(s.dz / l < 0.45, `${s.kind} ${Math.round(Math.acos(s.dz / l) * 180 / Math.PI)}° od normalnej`);
    // źródło przy głowie: kula źródła styka się z okręgiem głowy od zewnątrz (okrąg + margines), nie z rogiem prostokątnej
    // obwiedni (róg ~1245 j. od środka głowy)
    if (s.x > 1000) {
      const dHead = Math.hypot(s.x - 800, s.y) - s.r;
      assert.ok(dHead < 1200, `${s.kind} przy głowie ${dHead.toFixed(0)} j. od jej środka (róg obwiedni?)`);
      nearRound++;
    }
  }
  assert.ok(n >= 18, `źródeł gazu ${n}`);
  assert.ok(nearRound >= 3, `źródła wokół okrągłej głowy: ${nearRound}`);
  // cząstki: odłamki, pył, pierścień i kłęby — poza obrysem (pozycje względem środka skały); błysk i żar — w punkcie styku
  const A = fx.alpha.arr;
  let inside = 0, count = 0;
  for (let i = 0; i < fx.alpha.used; i++) {
    const o = i * 20;
    if (A[o + 3] > 1e8) continue;
    count++;
    if (!outside(A[o], A[o + 1])) inside++;
  }
  assert.ok(count > 50, `cząstek ${count}`);
  assert.equal(inside, 0, 'cząstki pyłu spod obrysu');
  const B = fx.add.arr;
  let flash = 0;
  for (let i = 0; i < fx.add.used; i++) if (Math.abs(B[i * 20 + 9] - 4) < 0.5) { flash++; assert.ok(Math.abs(B[i * 20] - 1300) < 1e-3, 'błysk w punkcie styku'); }
  assert.ok(flash >= 1);
});

test('RockImpactFx: wybuch w głębi (BLAST) — gaz w domenie głębokiej z nośnikiem, odłamki lądują na kuli skały, błysk', () => {
  const fx = new RockImpactFx({ layer: 1 });
  fx.setRock(0, 0, -24000, 16000);
  const calls = [];
  const gas = {
    grid: { slots: [], time: 0, feed() {} },
    director: { jet() { calls.push('jet'); }, puff() { calls.push('puff'); } },
    deepDomain(x, y, z, R, o) {
      calls.push({ x, y, z, R, o });
      const h = R * o.domainScale / 96;
      this.grid.slots[0] = { active: true, deep: true, tag: o.tag, h, n: 96, nz: 36, cx: x, cy: -y, cz: z };
      return 0;
    },
    setDeepSun() {}
  };
  fx.getGas = () => gas;
  const e = { id: 7, kind: 'tower', x: 1200, y: -300, z: -800, nx: 0, ny: 0, nz: -1, speed: 1800, slide: 0, mass: 0, size: 800, energy: 0, vx: 0, vy: 40, vz: -200 };
  assert.equal(fx.onEvent(ROCK_EVENT.BLAST, e), true);
  assert.equal(fx.stats.blasts, 1);
  const d = calls.find((c) => typeof c === 'object');
  assert.ok(d, 'domena głęboka');
  assert.equal(d.x, 1200); assert.equal(d.y, -300); assert.equal(d.z, -800); assert.equal(d.R, 800);
  assert.equal(d.o.ground.r, 16000, 'kula skały (promień skały, nie odległość punktu)');
  assert.deepEqual(d.o.carrier, [0, 40, -200], 'nośnik w układzie gry');
  assert.ok(!d.o.up, 'wybuch bez przesunięcia domeny');
  assert.ok(calls.filter((c) => c === 'jet').length >= 8, 'strumienie na wszystkie strony + wzdłuż ruchu');
  assert.ok(calls.filter((c) => c === 'puff').length >= 2, 'gorąca kula i kłąb');
  // odłamki: lądowanie na kuli skały (16 000), nie na kuli przez punkt wybuchu
  const A = fx.alpha.arr;
  let chunks = 0;
  for (let i = 0; i < fx.alpha.used; i++) {
    if (A[i * 20 + 9] !== RIP.CHUNK) continue;
    chunks++;
    const tl = A[i * 20 + 7];
    assert.ok(tl > 0 && tl <= 9, `lądowanie ${tl}`);
  }
  assert.ok(chunks > 100, `odłamki: ${chunks}`);
  assert.ok(fx.add.used >= 40, 'iskry i błysk');
  // bez kierunku — kulisty, nadal działa
  assert.equal(fx.onEvent(ROCK_EVENT.BLAST, { ...e, nx: 0, ny: 0, nz: 0 }), true);
});
