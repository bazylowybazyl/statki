// Pole asteroid przy 5120 × 1440 (2026-10-29) — fragmenty skał to większość pracy karty w polu (sonda FLATB / FLATP
// w scripts/webgpu/gpu-pas-gra.mjs). Poprawki bez zmiany obrazu:
//  • kolejka koszyków LOD skał od największych na ekranie (rockLayers.js ROCK_LOD_ORDER) — test głębi odrzuca
//    zasłonięte fragmenty mniejszych; pasma tła bliższe pierwsze;
//  • znaczek głębi skał gry przed passem tła (Core3D.addPassDepthStamp, asteroidBelt._createPlayStamp,
//    RockDepthStampMaterial) — skały tła, płaty mgły i zasłona nie liczą fragmentów pod skałami gry;
//  • zasłona pola po skałach tła z testem głębi (beltVeil.js).
// Poprawki przeglądu (2026-10-29): kolejka passa tła — okno renderOrder (−0,5; 0) należy do pasa (skały tła, potem
// zasłona — jedyna z tym renderOrder; każda inna rzecz tła ≥ 0 rysuje się na zasłonie jak przy dawnym kwadzie −0,5);
// A/B L0 przywraca DOKŁADNIE dawną kolejkę skał (tło 2, gra 1); znaczek tylko, gdy pass gry rysuje w tym renderze.
// Obraz na GPU (bufor sceny w pauzie wobec kontroli) i koszt: gpu-pas-gra.mjs --obrazAB L0,Z0,V0 --ab L0,Z0,V0;
// zasłona a obiekty passa tła (pole, port pasa, soczewka skoku): gpu-pas-gra.mjs --tloAB <katalog>.
// node --test tests/pasZnaczekGlebi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
const { ROCK_LOD_ORDER, rockBucketOrder, RockSet, RockLayer } = await import('../src/3d/asteroids/rockLayers.js');
const { BeltVeil, VEIL_RENDER_ORDER, VEIL_RENDER_ORDER_OLD, VEIL_CLIP_Z } = await import('../src/3d/asteroids/beltVeil.js');
const { DUST_SLICES } = await import('../src/3d/asteroids/fog.js');
const { getBeltMedium } = await import('../src/3d/asteroids/beltMedium.js');
const { AsteroidBelt, PLAY_STAMP_SHRINK, BELT_RENDER_ORDER } = await import('../src/3d/asteroids/asteroidBelt.js');
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
  // dawna kolejka: renderOrder sprzed 2026-10-29 (oldBase), domyślnie baza
  assert.equal(rockBucketOrder(-0.45, 0, n, { bigFirst: false, step: 0.01 }, 2), 2);
  assert.equal(rockBucketOrder(1, 0, n, { bigFirst: false, step: 0.01 }), 1);
  const maxOffset = (n - 1) * ROCK_LOD_ORDER.step;
  const R = BELT_RENDER_ORDER;
  const belt = stripComments(read('src/3d/asteroids/asteroidBelt.js'));
  assert.ok(maxOffset < R.backBandStep, 'koszyki warstwy nie wchodzą na następne pasmo');
  assert.match(belt, /renderOrder: RENDER_ORDER\.backRocks \+ i \* RENDER_ORDER\.backBandStep,\s*renderOrderOld: RENDER_ORDER\.backRocksOld,/);
  assert.match(belt, /renderOrder: RENDER_ORDER\.rocks, zOf: this\.playZ/, 'skały gry: renderOrder 1 (dawna kolejka ta sama baza)');
  const lastRock = R.backRocks + 2 * R.backBandStep + maxOffset;
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

// Kolejka passa tła (przegląd 2026-10-29): zasłona jest tam, gdzie dawny kwad (−0,5 — po niebie, PRZED każdą inną
// przezroczystą rzeczą tła), a skały tła idą przed nią w oknie (−0,5; 0). Inna rzecz tła z renderOrder w tym oknie
// weszłaby między skały i zasłonę — strażnik źródeł: liczbowe renderOrder z (−0,5; 0) tylko w module pasa.
test('kolejka passa tła: okno (−0,5; 0) — niebo i gwiazdy → skały tła → zasłona (bez remisu) → każda inna rzecz tła (≥ 0)', () => {
  const R = BELT_RENDER_ORDER;
  const n = ROCK_LODS.length;
  const rockMin = R.backRocks;
  const rockMax = R.backRocks + 2 * R.backBandStep + (n - 1) * ROCK_LOD_ORDER.step;
  // niebo (sfera −100000, czworokąt −1000, mgławica −999, jasne gwiazdy −998) i gwiazdy gry (−1) przed skałami tła
  assert.ok(VEIL_RENDER_ORDER_OLD === -0.5 && rockMin > VEIL_RENDER_ORDER_OLD && rockMin > -1, 'skały tła po niebie, gwiazdach i miejscu dawnego kwadu');
  assert.ok(rockMax < VEIL_RENDER_ORDER, 'zasłona po skałach tła (test głębi odrzuca ją pod nimi)');
  assert.ok(VEIL_RENDER_ORDER < 0, 'zasłona przed rzeczami tła bez renderOrder (0) i każdą z renderOrder ≥ 0 — jak dawny kwad');
  // każdy koszyk (skały i księżyce) różny od zasłony — bez remisu rozstrzyganego odległością
  for (let band = 0; band < 3; band++) {
    for (let lod = 0; lod < n; lod++) assert.notEqual(rockBucketOrder(R.backRocks + band * R.backBandStep, lod, n), VEIL_RENDER_ORDER);
  }
  // źródła: renderOrder liczbowe w oknie (−0,5; 0) poza pasem — żadnego (src/3d, src/vfx)
  const found = [];
  const re = /renderOrder\s*(?:=|:|\?\?)\s*(-?\d*\.?\d+)\b/g;
  for (const dir of ['src/3d', 'src/vfx']) {
    for (const f of readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })) {
      const rel = `${dir}/${String(f).replace(/\\/g, '/')}`;
      if (!rel.endsWith('.js') || rel.startsWith('src/3d/asteroids/')) continue;
      const src = stripComments(read(rel));
      for (const m of src.matchAll(re)) {
        const v = Number(m[1]);
        if (v > -0.5 && v < 0) found.push(`${rel}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(found, [], 'okno (−0,5; 0) passa tła należy do pasa (skały tła, zasłona)');
});

test('dawna kolejka (A/B L0 — setRockOrder(false)): DOKŁADNIE renderOrder sprzed 2026-10-29 w każdym koszyku skał i księżyców', () => {
  const R = BELT_RENDER_ORDER;
  assert.equal(R.backRocksOld, 2, 'skały tła przed 2026-10-29: renderOrder 2 (wszystkie pasma)');
  assert.equal(R.rocks, 1, 'skały gry: renderOrder 1 (jak przed 2026-10-29)');
  const field = { holeVersion: 0, bands: ['play', 'rubble', 'mid', 'deep'].map((id) => ({ id, octaves: [] })) };
  const parent = new THREE.Group();
  // jak AsteroidBelt._initGpu: warstwa gry i trzy pasma tła
  const layers = [new RockLayer({ parent, layer: 0, bank, material: playMaterial, field, bandIndex: 0, renderOrder: R.rocks })];
  for (let i = 0; i < 3; i++) {
    layers.push(new RockLayer({
      parent, layer: 1, bank, material: playMaterial, field, bandIndex: i + 1, perspective: true,
      renderOrder: R.backRocks + i * R.backBandStep, renderOrderOld: R.backRocksOld
    }));
  }
  const orders = () => layers.map((L) => [...L.buckets.lods, ...L.moonBuckets.lods].map((d) => d.mesh.renderOrder));
  const nowe = orders();
  // nowa kolejka: pasma tła w oknie przed zasłoną, bliższe pierwsze; koszyki od największych
  for (let i = 1; i < 4; i++) {
    for (const v of nowe[i]) assert.ok(v >= R.backRocks && v < VEIL_RENDER_ORDER, `pasmo ${i}: ${v} w oknie przed zasłoną`);
    if (i > 1) assert.ok(Math.min(...nowe[i]) > Math.max(...nowe[i - 1]), `pasmo ${i} po pasmie ${i - 1}`);
  }
  const belt = { layers };
  AsteroidBelt.prototype.setRockOrder.call(belt, false);
  try {
    const stare = orders();
    assert.deepEqual(stare[0], stare[0].map(() => 1), 'skały i księżyce gry: renderOrder 1');
    for (let i = 1; i < 4; i++) assert.deepEqual(stare[i], stare[i].map(() => 2), `pasmo tła ${i}: renderOrder 2 (skały i księżyce)`);
  } finally {
    AsteroidBelt.prototype.setRockOrder.call(belt, true);
  }
  assert.equal(ROCK_LOD_ORDER.bigFirst, true);
  assert.deepEqual(orders(), nowe, 'powrót do nowej kolejki');
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
  // pass gry rysuje w tym renderze (znaczek zasłania jego skała — _stampCoverRuns)
  c.renderPassOrtho = { name: 'ortho', enabled: true };
  c.perfToggles = { orthoPass: true };
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

// Przegląd 2026-10-29: znaczek leży pod skałą gry, którą rysuje pass GRY — bez niego (perfToggles.orthoPass = false →
// renderPassOrtho.enabled = false) pod niewidocznymi skałami gry w tle zostawały czarne dziury.
test('Core3D: znaczek głębi tylko, gdy pass gry rysuje w tym renderze (renderPassOrtho.enabled, perfToggles.orthoPass)', () => {
  const { c, log } = fakeCore();
  let asked = 0;
  const stamp = { scene: { name: 'znaczek' }, active: () => { asked++; return true; } };
  c.addPassDepthStamp('bg', stamp);
  const withStamp = [['render', 'znaczek', 'ortho', true, true, 1], ['render', 'scena', 'persp', false, true, 2]];
  const sceneOnly = [['render', 'scena', 'persp', true, true, 2]];
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, withStamp);
  // pass gry wyłączony (przełącznik passów — _applyPassToggles na starcie render())
  log.length = 0;
  c.renderPassOrtho.enabled = false;
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, sceneOnly, 'bez znaczka, czyszczenie ze sceną passa');
  c.renderPassOrtho.enabled = true;
  // przełącznik wydajności (perfToggles.orthoPass = false — także zanim _applyPassToggles go przeniesie)
  log.length = 0;
  c.perfToggles = { orthoPass: false };
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, sceneOnly);
  c.perfToggles = { orthoPass: true };
  // bez passa gry (Core3D przed init)
  log.length = 0;
  c.renderPassOrtho = null;
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, sceneOnly);
  assert.equal(asked, 1, 'active() znaczka pytane tylko, gdy pass gry rysuje');
  // znaczek wraca z passem gry
  log.length = 0;
  c.renderPassOrtho = { name: 'ortho', enabled: true };
  c._runScenePass(bgPass, false);
  assert.deepEqual(log, withStamp);
  // prawdziwy przełącznik: setPerfToggles({ orthoPass: false }) wyłącza pass gry (_applyPassToggles)
  const core = Object.create(Core3D);
  core.perfToggles = { ...Core3D.perfToggles };
  core.renderPassOrtho = { enabled: true };
  core.renderPassShields = { enabled: true };
  core.scene = null;
  core.renderer = null;
  core.setPerfToggles({ orthoPass: false });
  assert.equal(core.renderPassOrtho.enabled, false);
  assert.equal(core._stampCoverRuns(), false);
  core.setPerfToggles({ orthoPass: true });
  assert.equal(core.renderPassOrtho.enabled, true);
  assert.equal(core._stampCoverRuns(), true);
});

// --- zasłona ---

test('zasłona: po skałach tła z testem głębi tuż przed daleką płaszczyzną; A/B — dawny kwad', () => {
  const veil = new BeltVeil({ parent: new THREE.Group(), layer: 1 });
  assert.equal(veil.mesh.renderOrder, VEIL_RENDER_ORDER);
  assert.ok(VEIL_RENDER_ORDER > VEIL_RENDER_ORDER_OLD && VEIL_RENDER_ORDER < 0, 'okno dawnego kwadu: po niebie, przed rzeczami tła ≥ 0');
  assert.equal(veil.material.transparent, true, 'kolejka przezroczysta (renderOrder po skałach tła)');
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
