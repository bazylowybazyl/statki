// Pole asteroid przy 5120 × 1440 (2026-10-29) — fragmenty skał to większość pracy karty w polu (sonda FLATB / FLATP
// w scripts/webgpu/gpu-pas-gra.mjs). Poprawki bez zmiany obrazu:
//  • kolejka koszyków LOD skał od największych na ekranie (rockLayers.js ROCK_LOD_ORDER) — test głębi odrzuca
//    zasłonięte fragmenty mniejszych; pasma tła bliższe pierwsze;
//  • znaczek głębi skał gry przed passem tła (Core3D.addPassDepthStamp, asteroidBelt._createPlayStamp,
//    RockDepthStampMaterial) — skały tła, płaty mgły i zasłona nie liczą fragmentów pod skałami gry;
//  • zasłona pola po skałach tła z testem głębi (beltVeil.js).
// Obraz na GPU (bufor sceny w pauzie wobec kontroli) i koszt: gpu-pas-gra.mjs --obrazAB L0,Z0,V0 --ab L0,Z0,V0.
// node --test tests/pasZnaczekGlebi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const ctx2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three/webgpu');
const { LightGrid, GridLighting } = await import('../src/3d/fx/lightGrid.js');
const { RockShapeBankGPU, ROCK_LODS } = await import('../src/3d/asteroids/rockBank.js');
const { createRockShared, RockNodeMaterial, RockShadowMaterial, RockDepthStampMaterial } = await import('../src/3d/asteroids/rockMaterial.js');
const { ROCK_LOD_ORDER, rockBucketOrder, RockSet } = await import('../src/3d/asteroids/rockLayers.js');
const { BeltVeil, VEIL_RENDER_ORDER, VEIL_RENDER_ORDER_OLD, VEIL_CLIP_Z } = await import('../src/3d/asteroids/beltVeil.js');
const { DUST_SLICES } = await import('../src/3d/asteroids/fog.js');
const { getBeltMedium } = await import('../src/3d/asteroids/beltMedium.js');
const { AsteroidBelt, PLAY_STAMP_SHRINK } = await import('../src/3d/asteroids/asteroidBelt.js');
const { Core3D } = await import('../src/3d/core3d.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// --- otoczenie pasa bez GPU (jak tests/miningRenderTSL.test.mjs) ---
const bank = new RockShapeBankGPU({ count: 40 });
bank.targetA = bank._makeArrayTarget(THREE.HalfFloatType, true);
bank.targetB = bank._makeArrayTarget(THREE.UnsignedByteType, true);
const noise = new THREE.Storage3DTexture(8, 8, 8);
const shared = createRockShared(bank, noise);
shared.noise = noise;
shared.volume = getBeltMedium();
const grid = new LightGrid();
const playMaterial = new RockNodeMaterial({ shared });
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;
wgsl.lighting = new GridLighting(grid, { mode: 'optIn' });
function buildMesh(mesh) {
  const b = wgsl.backend.createNodeBuilder(mesh, wgsl);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const rockGeo = () => {
  const set = new RockSet({ parent: new THREE.Group(), bank, material: playMaterial, name: 'test' });
  return set.buckets.lods[0].geo;
};

// --- kolejka koszyków LOD ---

test('kolejka koszyków LOD: największe na ekranie pierwsze, warstwy tła bliższe pierwsze, zasłona po skałach, mgła po zasłonie', () => {
  assert.equal(ROCK_LOD_ORDER.bigFirst, true);
  const n = ROCK_LODS.length;
  // koszyk ostatni (największe skały) = baza, LOD 0 = baza + (n − 1) · step
  assert.equal(rockBucketOrder(2, n - 1, n), 2);
  assert.ok(rockBucketOrder(2, 0, n) > rockBucketOrder(2, 1, n));
  const maxOffset = (n - 1) * ROCK_LOD_ORDER.step;
  const belt = stripComments(read('src/3d/asteroids/asteroidBelt.js'));
  const m = belt.match(/const RENDER_ORDER = Object\.freeze\(\{ rocks: 1, minerals: -70, backRocks: (\d+(?:\.\d+)?), backBandStep: (\d+(?:\.\d+)?) \}\);/);
  assert.ok(m, 'RENDER_ORDER z bazą i odstępem pasm tła');
  const base = Number(m[1]);
  const step = Number(m[2]);
  assert.ok(maxOffset < step, 'koszyki warstwy nie wchodzą na następne pasmo');
  assert.match(belt, /renderOrder: RENDER_ORDER\.backRocks \+ i \* RENDER_ORDER\.backBandStep/);
  const lastRock = base + 2 * step + maxOffset;
  assert.ok(VEIL_RENDER_ORDER > lastRock, `zasłona (${VEIL_RENDER_ORDER}) po wszystkich skałach tła (${lastRock})`);
  const fogMin = Math.min(...DUST_SLICES.map((d, i) => (d.fg ? Infinity : 10 + (DUST_SLICES.length - 1 - i))));
  assert.ok(VEIL_RENDER_ORDER < fogMin, 'głębokie płaty mgły po zasłonie (jak dawniej)');
  // koszyki RockSet / warstwy: renderOrder wg LOD, A/B w biegu bez nowych materiałów
  const set = new RockSet({ parent: new THREE.Group(), bank, material: playMaterial, renderOrder: 1, name: 'kolejka' });
  const orders = set.buckets.lods.map((L) => L.mesh.renderOrder);
  for (let i = 1; i < orders.length; i++) assert.ok(orders[i] < orders[i - 1], `LOD ${i} przed LOD ${i - 1}`);
  ROCK_LOD_ORDER.bigFirst = false;
  try {
    set.buckets.applyOrder();
    assert.deepEqual(set.buckets.lods.map((L) => L.mesh.renderOrder), orders.map(() => 1), 'dawna kolejka: renderOrder warstwy');
  } finally {
    ROCK_LOD_ORDER.bigFirst = true;
    set.buckets.applyOrder();
  }
  assert.deepEqual(set.buckets.lods.map((L) => L.mesh.renderOrder), orders);
});

// --- znaczek głębi skał gry ---

test('RockDepthStampMaterial: wierzchołek skał gry pomniejszony uniformem, z = 0 w przestrzeni obcięcia, bez koloru', () => {
  const geo = rockGeo();
  const stampMat = new RockDepthStampMaterial(playMaterial, PLAY_STAMP_SHRINK);
  assert.equal(stampMat.colorWrite, false);
  assert.equal(stampMat.depthWrite, true);
  assert.equal(stampMat.depthTest, true);
  assert.equal(stampMat.lights, false);
  assert.equal(stampMat.L, playMaterial.L, 'uniformy warstwy gry (zoom, próg pikseli, zanik pola)');
  assert.ok(PLAY_STAMP_SHRINK < 1 && PLAY_STAMP_SHRINK >= 0.9);
  const stamp = buildMesh(new THREE.Mesh(geo, stampMat));
  assert.match(stamp.vertex, /rockStampShrink/, 'pomniejszenie uniformem');
  // wyjście wierzchołka: vec4(x, y, 0, w) rzutu kamery
  assert.match(stamp.vertex, /vec4<f32>\(\s*[\w.]+\.x,\s*[\w.]+\.y,\s*0\.0,\s*[\w.]+\.w\s*\)/, 'z = 0 (najbliżej) przy w rzutu');
  // materiały skał i map cienia — wierzchołek bez pomniejszenia (ten sam WGSL co przed znaczkiem)
  const rock = buildMesh(new THREE.Mesh(geo, playMaterial));
  const shadow = buildMesh(new THREE.Mesh(geo, new RockShadowMaterial(playMaterial)));
  for (const s of [rock.vertex, shadow.vertex]) assert.doesNotMatch(s, /rockStampShrink/);
  assert.ok(stamp.fragment.length > 0);
});

function fakeBelt() {
  const lod = () => ({ geo: rockGeo(), mesh: { name: 'kosz', visible: false } });
  const belt = Object.create(AsteroidBelt.prototype);
  belt.playLayer = { enabled: true, buckets: { lods: [lod(), lod()] }, moonBuckets: { lods: [lod()] } };
  belt.root = new THREE.Group();
  belt.root.position.set(1234, -567, 0);
  belt.root.updateMatrixWorld(true);
  belt.ready = true;
  belt.active = true;
  belt._frameActive = true;
  belt._stamp = belt._createPlayStamp(playMaterial);
  return belt;
}

test('znaczek pasa: koszyki gry (te same geometrie), widoczność i położenie pola co render, wyłączniki', () => {
  const belt = fakeBelt();
  const st = belt._stamp;
  assert.equal(st.pairs.length, 3, 'koszyki skał i księżyców');
  const lods = [...belt.playLayer.buckets.lods, ...belt.playLayer.moonBuckets.lods];
  st.pairs.forEach(([src, dst], i) => {
    assert.equal(src, lods[i].mesh);
    assert.equal(dst.geometry, lods[i].geo, 'geometria i instancje koszyka bez kopii');
    assert.equal(dst.material, st.material);
  });
  assert.ok(st.scene.isScene && st.material instanceof RockDepthStampMaterial);
  // puste koszyki — bez znaczka
  assert.equal(st.active(), false);
  belt.playLayer.buckets.lods[1].mesh.visible = true;
  assert.equal(st.active(), true);
  assert.deepEqual(st.pairs.map((p) => p[1].visible), [false, true, false], 'widoczność jak koszyki gry');
  assert.deepEqual(st.group.matrix.elements, belt.root.matrixWorld.elements, 'grupa znaczka na początku pola');
  // wyłączniki: pole nieaktywne, warstwa gry ukryta, A/B
  belt.active = false;
  assert.equal(st.active(), false);
  belt.active = true;
  belt.playLayer.enabled = false;
  assert.equal(st.active(), false);
  belt.playLayer.enabled = true;
  belt.stampEnabled = false;
  assert.equal(st.active(), false);
  belt.stampEnabled = true;
  assert.equal(st.active(), true);
});

test('znaczek pasa: rejestracja przed passem tła i rozgrzewka (scena znaczka, kamera passa gry)', () => {
  const belt = stripComments(read('src/3d/asteroids/asteroidBelt.js'));
  assert.match(belt, /Core3D\.addPassDepthStamp\('bg', this\._stamp\)/);
  assert.match(belt, /Core3D\.prewarmPass\(this\._stamp\.scene, 0, \{ ortho: true \}\)/);
});

// --- Core3D: znaczki głębi w passie ---

function fakeCore() {
  const log = [];
  const renderer = {
    autoClear: false, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    setClearColor() {},
    clear(c, d, s) { log.push(['clear', c, d, s]); },
    render(scene, cam) { log.push(['render', scene.name, cam.name, this.autoClear, this.autoClearColor, cam.layers.mask]); }
  };
  const cam = (name) => ({ name, layers: { mask: 1, set(l) { this.mask = 1 << l; } } });
  const ortho = cam('ortho');
  const persp = cam('persp');
  const c = Object.create(Core3D);
  c.renderer = renderer;
  c.scene = { name: 'scena' };
  c._renderInfoBefore = { calls: 0, triangles: 0, points: 0, lines: 0 };
  c._readRenderInfoInto = () => {};
  c._addRenderInfoDelta = () => {};
  c.getPassCamera = (isOrtho) => (isOrtho ? ortho : persp);
  c._passHooks = null;
  c._passStamps = null;
  c.stampStats = { renders: 0 };
  return { c, log, ortho };
}
const bgPass = { name: 'bg', bucket: 'bg', layer: 1, ortho: false, clearColor: true, clearDepth: true, enabled: true };

test('Core3D: znaczek głębi przed passem — pierwszy render z czyszczeniem, kamera passa gry (warstwa 0), potem scena', () => {
  const { c, log, ortho } = fakeCore();
  let on = true;
  const stamp = { scene: { name: 'znaczek' }, active: () => on };
  c.addPassDepthStamp('bg', stamp);
  c.addPassDepthStamp('bg', stamp);   // drugi raz — bez duplikatu
  ortho.layers.mask = 0b100;
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, [
    ['render', 'znaczek', 'ortho', true, true, 1],      // czyszczenie koloru i głębi z PIERWSZYM renderem passa
    ['render', 'scena', 'persp', false, true, 2]        // scena tła bez czyszczenia (głębia znaczka zostaje)
  ]);
  assert.equal(ortho.layers.mask, 0b100, 'warstwy kamery gry przywrócone');
  assert.equal(c.stampStats.renders, 1);
  // nieaktywny znaczek / A/B / kamery 3D (wspólna głębia) — sama scena z czyszczeniem
  log.length = 0;
  on = false;
  c._runScenePass(bgPass, false);
  on = true;
  c.depthStamps = false;
  c._runScenePass(bgPass, false);
  c.depthStamps = true;
  c._runScenePass(bgPass, true);
  assert.deepEqual(log, [
    ['render', 'scena', 'persp', true, true, 2],
    ['render', 'scena', 'persp', true, true, 2],
    ['render', 'scena', 'persp', true, true, 2]
  ]);
  // dawne czyszczenie (A/B clearInPass = false): renderer.clear, potem znaczek i scena bez czyszczenia
  log.length = 0;
  c.clearInPass = false;
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, [
    ['clear', true, true, true],
    ['render', 'znaczek', 'ortho', false, true, 1],
    ['render', 'scena', 'persp', false, true, 2]
  ]);
  c.removePassDepthStamp('bg', stamp);
  assert.equal(c._passStamps.bg.length, 0);
});

// --- zasłona ---

test('zasłona: po skałach tła z testem głębi tuż przed daleką płaszczyzną; A/B — dawny kwad', () => {
  const veil = new BeltVeil({ parent: new THREE.Group(), layer: 1 });
  assert.equal(veil.mesh.renderOrder, VEIL_RENDER_ORDER);
  assert.equal(veil.material.depthTest, true);
  assert.equal(veil.material.depthWrite, false);
  assert.equal(veil.u.clipZ.value, VEIL_CLIP_Z);
  // skały tła: głębia perspektywy przy bliskiej płaszczyźnie 100 j. i dalekiej 500 tys. — daleko poniżej VEIL_CLIP_Z
  const depth = (d, n = 100, f = 500000) => (f * (d - n)) / (d * (f - n));
  assert.ok(depth(34250 + 26000) < VEIL_CLIP_Z && depth(65000 + 26000) < VEIL_CLIP_Z, 'skała tła przy oddaleniu przed zasłoną');
  assert.ok(VEIL_CLIP_Z < 1, 'w bryle obcinania (z ≤ w)');
  const { vertex } = buildMesh(veil.mesh);
  assert.match(vertex, /clipZ|nodeUniform/, 'z kwadu z uniformu');
  veil.setDepthCull(false);
  assert.equal(veil.mesh.renderOrder, VEIL_RENDER_ORDER_OLD);
  assert.equal(veil.material.depthTest, false);
  assert.equal(veil.u.clipZ.value, 0.5);
  veil.setDepthCull(true);
  assert.equal(veil.mesh.renderOrder, VEIL_RENDER_ORDER);
  assert.equal(veil.material.depthTest, true);
});
