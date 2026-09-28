// Wybuch reaktora w Core3D (port WebGPU, zadanie 20): dawne dwa ShaderMaterial overlaya → TSL
// (src/effects3d/reactorblow.tsl.js), pule z materiałem raz na pulę, ruch analityczny,
// wysyłka zapisanego wycinka (src/effects3d/particlePool.js), fazy i losowania jak dawny efekt
// overlaya, początek pul przy wybuchu, światło rdzenia i rozbłysku do siatki świateł efektów,
// wygląd overlaya pod post gry (reactorLook). Grafy budowane do WGSL w Node.
// node --test tests/reactorBlow.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { ParticlePool } = await import('../src/effects3d/particlePool.js');
const {
  ReactorBlow3D, createReactorBlowFactory, REACTOR_BLOW_PROFILES, REACTOR_LOOK, REACTOR_LIGHT,
  REACTOR_FIRE_CAPACITY, REACTOR_SMOKE_CAPACITY
} = await import('../src/effects3d/reactorblow.js');
const { REACTOR_TYPE, REACTOR_SLAB_MIN_Z, REACTOR_SLAB_MAX_Z, reactorLookCpu, OVERLAY_BLOOM_SIGMA_PX } = await import('../src/effects3d/reactorblow.tsl.js');
const { acesGryCpu, linearDoSrgbCpu } = await import('../src/3d/tsl/kolorGry.js');
const { STATION_CHAIN_REACTOR_PROFILE } = await import('../src/effects3d/reactorProfiles/stationChainProfile.js');
const { STATION_CUT_REACTOR_PROFILE } = await import('../src/effects3d/reactorProfiles/stationCutProfile.js');
const { STATION_FINAL_REACTOR_PROFILE } = await import('../src/effects3d/reactorProfiles/stationFinalProfile.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);
const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
function allocatedBytes(fn, n) {
  let best = Infinity;
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn(i);
    const delta = newSpaceUsed() - before;
    if (delta >= 0 && delta < best) best = delta;
  }
  return best;
}

// Zegar: moduł czyta performance.now() (jak dawny efekt overlaya) — w testach sterowany.
let clockMs = 10000;
const realNow = performance.now.bind(performance);
performance.now = () => clockMs;
after(() => { performance.now = realNow; });

// Atrapa Core3D: scena, rejestr kroków, rozgrzewka.
function fakeCore() {
  return {
    scene: new THREE.Scene(),
    steps: [],
    prewarmed: [],
    addFxStep(step) { this.steps.push(step); return step; },
    prewarmPass(obj, layer) { this.prewarmed.push([obj, layer, obj.visible, obj.geometry.instanceCount]); return Promise.resolve(true); },
    fxDistortion() { return null; }
  };
}

// Jeden system na plik (pule 100 000 / 15 000 jak w grze).
const core = fakeCore();
const blow = new ReactorBlow3D(core);
const fire = blow.fire;
const ctx = { core, grid: null };

// --- pliki i materiały ------------------------------------------------------------------

test('pliki wybuchu bez GLSL i bez renderera (port WebGPU: TSL, GLSL usunięty w tym samym zadaniu)', () => {
  for (const p of ['src/effects3d/reactorblow.js', 'src/effects3d/reactorblow.tsl.js', 'src/effects3d/particlePool.js']) {
    const src = code(p);
    assert.doesNotMatch(src,/gl_FragColor|gl_Position|ShaderMaterial|vertexShader\s*:|fragmentShader\s*:|WebGLRenderer|WebGPURenderer|EffectComposer/, p);
  }
});

test('materiały: raz na pulę, NodeMaterial, addytywne bez zapisu głębi, FrontSide (płaskie kwady tyłem — jak w bazie)', () => {
  assert.equal(blow.fire.mesh.material, blow.fireMaterial);
  assert.equal(blow.smoke.mesh.material, blow.smokeMaterial);
  for (const m of [blow.fireMaterial, blow.smokeMaterial]) {
    assert.ok(m.isNodeMaterial && !m.isShaderMaterial, m.name);
    assert.equal(m.blending, THREE.CustomBlending);
    assert.equal(m.blendSrc, THREE.OneFactor);
    assert.equal(m.blendDst, THREE.OneFactor);
    assert.equal(m.blendSrcAlpha, THREE.ZeroFactor, 'alfa celu bez zmian');
    assert.equal(m.depthWrite, false);
    assert.equal(m.depthTest, false);
    assert.equal(m.side, THREE.FrontSide);
  }
  // Pule: Mesh z InstancedBufferGeometry (InstancedMesh wnosi uuid do klucza programu), warstwa 0
  // (pass ortho), kolejność jak w overlayu, bez obcinania kadrem, schowane do pierwszej cząstki.
  for (const [p, order] of [[blow.fire, 1000], [blow.smoke, 999]]) {
    assert.ok(!p.mesh.isInstancedMesh && p.mesh.geometry.isInstancedBufferGeometry);
    assert.ok(p.mesh.layers.isEnabled(0));
    assert.equal(p.mesh.renderOrder, order);
    assert.equal(p.mesh.frustumCulled, false);
    assert.equal(p.mesh.visible, false);
    assert.equal(p.mesh.geometry.instanceCount, 0);
  }
  assert.equal(blow.fire.capacity, REACTOR_FIRE_CAPACITY);
  assert.equal(blow.smoke.capacity, REACTOR_SMOKE_CAPACITY);
  assert.equal(REACTOR_FIRE_CAPACITY, 100000);
  assert.equal(REACTOR_SMOKE_CAPACITY, 15000);
  // Krok klatki efektów Core3D.
  assert.equal(core.steps.length, 1);
  assert.equal(core.steps[0].name, 'reaktor');
  for (const k of ['spawn', 'lights', 'update', 'warm']) assert.equal(typeof core.steps[0][k], 'function', k);
});

test('WGSL w Node: oba materiały się budują, limity pipeline\'u (≤ 8 buforów wierzchołków, ≤ 12 uniformów), highPrecision', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  renderer.highPrecision = true;
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
  for (const mesh of blow.meshes) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.OrthographicCamera();
    b.context.material = mesh.material;
    b.build();
    const uniforms = (code) => (code.match(/var<uniform>/g) || []).length;
    assert.ok(uniforms(b.vertexShader) <= 12 && uniforms(b.fragmentShader) <= 12, mesh.name);
    const buffers = new Set(b.attributes.map((a) => mesh.geometry.getAttribute(a.name)).filter(Boolean));
    assert.ok(buffers.size <= 8, `${mesh.name}: ${buffers.size} buforów wierzchołków`);
    // modelViewMatrix z CPU (double) — pozycje lokalne przy początku puli, bez drżenia float32.
    assert.match(b.vertexShader, /highpModelViewMatrix/, mesh.name);
    // Bez pow z ujemną podstawą (sin², smuga iskier): potęgi całkowite mnożeniem.
    assert.doesNotMatch(b.fragmentShader, /pow\( ?sin/, mesh.name);
    // Bez tekstur (efekt proceduralny).
    assert.doesNotMatch(b.fragmentShader, /texture_2d/, mesh.name);
  }
});

// --- profile i czasy ----------------------------------------------------------------------

test('profile i czasy bez zmian (dawna fabryka overlaya), fale i haze wyłączone', () => {
  const P = REACTOR_BLOW_PROFILES;
  assert.deepEqual(Object.keys(P).sort(), ['capital', 'chain', 'cruiser', 'cut', 'escort', 'fighter', 'final']);
  assert.equal(P.chain, STATION_CHAIN_REACTOR_PROFILE);
  assert.equal(P.cut, STATION_CUT_REACTOR_PROFILE);
  assert.equal(P.final, STATION_FINAL_REACTOR_PROFILE);
  const exp = {
    fighter: [0.05, 0.2, 1.5, 4.0, 0.15, 0, 20, 0.02],
    escort: [0.30, 1.3, 2.2, 7.0, 0.6, 22, 450, 0.06],
    cruiser: [0.55, 2.1, 2.9, 9.5, 0.9, 38, 1400, 0.08],
    capital: [0.8, 3.0, 3.5, 12.0, 1.2, 60, 4000, 0.1]
  };
  for (const [k, v] of Object.entries(exp)) {
    const p = P[k];
    assert.deepEqual([p.chargeTime, p.explosionDuration, p.chargeSizeMul, p.flashSizeMul, p.flashLife, p.spikeCount, p.sparkCount, p.sparkDelay], v, k);
  }
  assert.deepEqual([P.capital.sparkLifeMin, P.capital.sparkLifeMax, P.capital.sparkSpeedMinMul, P.capital.sparkSpeedMaxMul], [1.5, 4.0, 4.0, 14.0]);
  for (const [k, p] of Object.entries(P)) {
    assert.equal(p.shockwave3D, null, k);
    assert.equal(p.heatHaze, null, k);
    assert.ok(Object.isFrozen(p), k);
  }
});

// --- fazy, losowania, układ ---------------------------------------------------------------

// Dawny efekt overlaya (reactorblow.js sprzed zadania 20) w układzie overlaya: kolce i iskry.
function oldSpikesAndSparks(cfg, size, rnd) {
  const out = [];
  for (let i = 0; i < cfg.spikeCount; i++) {
    const speed = size * (cfg.spikeSpeedMinMul + rnd() * Math.max(0.001, cfg.spikeSpeedMaxMul - cfg.spikeSpeedMinMul));
    const angle = rnd() * Math.PI * 2;
    const vx = Math.cos(angle) * speed;
    const vy = (rnd() - 0.5) * speed * 0.15;
    const vz = Math.sin(angle) * speed;
    const s = size * (cfg.spikeSizeMinMul + rnd() * Math.max(0.001, cfg.spikeSizeMaxMul - cfg.spikeSizeMinMul));
    const life = cfg.spikeLifeMin + rnd() * Math.max(0.001, cfg.spikeLifeMax - cfg.spikeLifeMin);
    out.push([vx, vy, vz, s, life]);
  }
  const sparks = [];
  for (let i = 0; i < cfg.sparkCount; i++) {
    const speed = size * (cfg.sparkSpeedMinMul + rnd() * Math.max(0.001, cfg.sparkSpeedMaxMul - cfg.sparkSpeedMinMul));
    const angle = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    const vx = Math.sin(phi) * Math.cos(angle) * speed;
    const vy = Math.cos(phi) * speed;
    const vz = Math.sin(phi) * Math.sin(angle) * speed;
    const s = size * (cfg.sparkSizeMinMul + rnd() * Math.max(0.001, cfg.sparkSizeMaxMul - cfg.sparkSizeMinMul));
    const life = cfg.sparkLifeMin + rnd() * Math.max(0.001, cfg.sparkLifeMax - cfg.sparkLifeMin);
    sparks.push([vx, vy, vz, s, life]);
  }
  return { spikes: out, sparks };
}
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function frameAt(ms) {
  clockMs = ms;
  core.steps[0].spawn(ctx);
  core.steps[0].update(ctx);
}

test('wybuch: fazy i losowania jak dawny efekt overlaya (ta sama kolejność Math.random), układ overlay → scena', () => {
  blow.clear();
  const realRandom = Math.random;
  const x = 6123456.5, y = 5212345.25, size = 300;
  const cfg = REACTOR_BLOW_PROFILES.capital;
  try {
    Math.random = mulberry(0x20a2);
    clockMs = 10000;
    assert.equal(blow.spawn(x, y, size, 'capital'), true);
    // Rdzeń ładowania od razu, w środku wybuchu (lokalnie względem początku puli).
    assert.equal(fire.pool.highWater, 1);
    assert.equal(fire.mesh.position.x, Math.round(x));
    assert.equal(fire.mesh.position.y, Math.round(-y));
    close(fire.startPos[0] + fire.originX, x, 1e-3, 'x');
    close(fire.startPos[1] + fire.originY, -y, 1e-3, 'y (scena = −y gry)');
    assert.equal(fire.startPos[2], 5, 'wysokość wybuchu jak dawne expY');
    assert.equal(fire.dataInfo[3], REACTOR_TYPE.CORE);
    close(fire.dataInfo[1], cfg.chargeTime + 0.1, 1e-6);
    close(fire.dataInfo[2], size * cfg.chargeSizeMul, 1e-3);
    // Macierz świata liczona od razu (scena Core3D bez matrixWorldAutoUpdate).
    assert.equal(fire.mesh.matrixWorld.elements[12], Math.round(x));
    // Ładowanie: nic nowego, bez losowań.
    let calls = 0;
    const counted = mulberry(0x20a2);
    Math.random = () => { calls++; return counted(); };
    frameAt(10000 + 500);
    assert.equal(calls, 0);
    assert.equal(fire.pool.highWater, 1);
    // Rozbłysk: błysk, pierścień, fala (pula dymu), kolce — 5 losowań na kolec.
    frameAt(10000 + cfg.chargeTime * 1000 + 1);
    assert.equal(calls, 5 * cfg.spikeCount);
    assert.equal(fire.pool.highWater, 1 + 2 + cfg.spikeCount);
    assert.equal(blow.smoke.pool.highWater, 1);
    // Iskry po sparkDelay: 5 losowań na iskrę.
    frameAt(10000 + (cfg.chargeTime + cfg.sparkDelay) * 1000 + 1);
    assert.equal(calls, 5 * (cfg.spikeCount + cfg.sparkCount));
    assert.equal(fire.pool.highWater, 3 + cfg.spikeCount + cfg.sparkCount);
    // Te same liczby co dawny efekt (to samo ziarno): prędkość overlaya (vx, vy, vz) → scena (vx, −vz, vy).
    const ref = oldSpikesAndSparks(cfg, size, mulberry(0x20a2));
    const check = (slot, [vx, vy, vz, s, life], type) => {
      close(fire.startVel[slot * 3], vx, 1e-2);
      close(fire.startVel[slot * 3 + 1], -vz, 1e-2);
      close(fire.startVel[slot * 3 + 2], vy, 1e-2);
      close(fire.dataInfo[slot * 4 + 2], s, 1e-3);
      close(fire.dataInfo[slot * 4 + 1], life, 1e-5);
      assert.equal(fire.dataInfo[slot * 4 + 3], type);
    };
    for (let i = 0; i < cfg.spikeCount; i++) check(3 + i, ref.spikes[i], REACTOR_TYPE.SPIKE);
    for (const i of [0, 1, 2, 1000, cfg.sparkCount - 1]) check(3 + cfg.spikeCount + i, ref.sparks[i], REACTOR_TYPE.SPARK);
    assert.equal(fire.dataInfo[1 * 4 + 3], REACTOR_TYPE.CORE, 'błysk');
    assert.equal(fire.dataInfo[2 * 4 + 3], REACTOR_TYPE.RING, 'pierścień');
    // Koniec wybuchu po chargeTime + explosionDuration; cząstki dogasają (pula żyje do najdłuższej).
    frameAt(10000 + (cfg.chargeTime + cfg.explosionDuration) * 1000 + 5);
    assert.equal(blow.blasts.length, 0);
    assert.equal(fire.mesh.visible, true);
    frameAt(10000 + (cfg.chargeTime + cfg.sparkDelay + cfg.sparkLifeMax) * 1000 + 20);
    assert.equal(fire.mesh.visible, false, 'pusta pula schowana');
    assert.equal(fire.mesh.geometry.instanceCount, 0);
    assert.equal(fire.pool.highWater, 0, 'bezczynna pula wraca na start');
  } finally {
    Math.random = realRandom;
    blow.clear();
  }
});

test('kilka wybuchów w klatce: losowania od najnowszego do najstarszego (jak pętla wstecz ticku overlaya)', () => {
  blow.clear();
  const realRandom = Math.random;
  try {
    const seq = mulberry(7);
    Math.random = seq;
    clockMs = 20000;
    blow.spawn(0, 0, 100, 'fighter');
    blow.spawn(5000, 0, 100, 'fighter');
    // Oba wchodzą w rozbłysk i iskry w tej samej klatce: najpierw drugi (nowszy), potem pierwszy.
    frameAt(20000 + 100);
    const ref = mulberry(7);
    const cfg = REACTOR_BLOW_PROFILES.fighter;
    const second = oldSpikesAndSparks(cfg, 100, ref).sparks;
    const first = oldSpikesAndSparks(cfg, 100, ref).sparks;
    // Sloty: 2 rdzenie, potem nowszy: błysk + 20 iskier, starszy: błysk + 20 iskier.
    const base = 2;
    close(fire.startVel[(base + 1) * 3], second[0][0], 1e-2, 'nowszy pierwszy');
    close(fire.startVel[(base + 1 + 20 + 1) * 3], first[0][0], 1e-2, 'starszy po nim');
  } finally {
    Math.random = realRandom;
    blow.clear();
  }
});

test('początek puli przy wybuchu: przestawiany tylko w bezczynnej puli, pozycje lokalne dokładne przy 10 mln j.', () => {
  blow.clear();
  frameAt(30000);
  clockMs = 30000;
  blow.spawn(9876543.25, 7654321.5, 200, 'escort');
  const ox = fire.originX;
  const oy = fire.originY;
  assert.equal(ox, 9876543);
  assert.equal(oy, -7654321, 'Math.round(−7654321,5)');
  // Drugi wybuch 40 tys. j. dalej przy żywej puli — początek zostaje, pozycje lokalne float32 dokładne.
  blow.spawn(9876543.25 + 40000, 7654321.5, 200, 'escort');
  assert.equal(fire.originX, ox);
  close(fire.startPos[3] + ox, 9876543.25 + 40000, 0.01);
  blow.clear();
  // Po wygaśnięciu kolejny wybuch przestawia początek.
  frameAt(40000);
  clockMs = 40000;
  blow.spawn(100.4, 200.6, 50, 'fighter');
  assert.equal(fire.originX, 100);
  assert.equal(fire.originY, -201);
  blow.clear();
});

// --- pula: wysyłka wycinka ----------------------------------------------------------------

function makePool(capacity = 16) {
  const geo = new THREE.InstancedBufferGeometry();
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geo.setAttribute('a', a);
  geo.setAttribute('b', b);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const time = { value: 0 };
  return { pool: new ParticlePool({ mesh, attributes: [a, b], capacity, timeUniform: time }), mesh, a, b, time };
}
// three po zapisie atrybutu woła clearUpdateRanges() — tu wprost (potwierdzenie wysyłki).
const upload = (...attrs) => { for (const at of attrs) at.clearUpdateRanges(); };

test('pula: zakresy wysyłki na stałe, zawinięcie pierścienia = dwa wycinki, niepotwierdzony wycinek się sumuje', () => {
  const { pool, mesh, a, b, time } = makePool(16);
  assert.equal(a.updateRanges.length, 2);
  const r0 = a.updateRanges[0];
  for (let i = 0; i < 5; i++) pool.next();
  pool.keepAlive(10);
  const v0 = a.version;
  assert.equal(pool.flush(1), true);
  assert.equal(a.version, v0 + 1, 'needsUpdate');
  assert.deepEqual([r0.start, r0.count, a.updateRanges[1].count], [0, 15, 0]);
  assert.deepEqual([b.updateRanges[0].start, b.updateRanges[0].count], [0, 20]);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.geometry.instanceCount, 5);
  assert.equal(time.value, 1);
  // Siatka nie narysowana (brak potwierdzenia): kolejne 3 sloty dołączają do wycinka.
  for (let i = 0; i < 3; i++) pool.next();
  pool.flush(2);
  assert.deepEqual([r0.start, r0.count], [0, 24], 'wycinek skumulowany');
  upload(a, b);
  // Po potwierdzeniu: tylko nowe sloty; zawinięcie 14…17 → [14, 16) + [0, 2).
  for (let i = 0; i < 6; i++) pool.next();   // 8…13
  pool.flush(3); upload(a, b);
  for (let i = 0; i < 4; i++) pool.next();   // 14, 15, 0, 1
  pool.flush(4);
  assert.deepEqual([r0.start / 3, r0.count / 3, a.updateRanges[1].start, a.updateRanges[1].count / 3], [14, 2, 0, 2]);
  assert.equal(a.updateRanges.length, 2, 'bez nowych obiektów zakresu');
  assert.equal(a.updateRanges[0], r0);
  upload(a, b);
  // Wygaśnięcie: pula schowana, na start.
  assert.equal(pool.flush(11), false);
  assert.equal(mesh.visible, false);
  assert.equal(mesh.geometry.instanceCount, 0);
  assert.equal(pool.highWater, 0);
  assert.equal(pool.cursor, 0);
  assert.equal(pool.idle, true);
});

test('klatka wybuchu bez alokacji (stan ustalony: wybuch trwa, 4000 iskier w locie)', async () => {
  blow.clear();
  clockMs = 50000;
  blow.spawn(1000, 2000, 300, 'capital');
  frameAt(50000 + 1000);   // po rozbłysku i iskrach
  const grid = { n: 0, addWorld() { this.n++; return 0; } };
  const step = core.steps[0];
  const lightCtx = { core, grid };
  const attrs = fire.pool.attributes;
  // Klatka = kroki efektów + potwierdzenie wysyłki (three: clearUpdateRanges po zapisie atrybutu).
  const run = () => {
    step.spawn(lightCtx);
    step.lights(lightCtx);
    step.update(lightCtx);
    for (let k = 0; k < attrs.length; k++) attrs[k].clearUpdateRanges();
  };
  // Rozgrzewka V8: interpreter pudełkuje każdą liczbę zmiennoprzecinkową (~140 B na klatkę), a
  // TurboFan kompiluje współbieżnie — kod instaluje się dopiero, gdy wątek główny odda sterowanie
  // (stąd przerwa). Pomiar przy biegnącym zegarze (pełne ms — Smi, test sam nie pudełkuje liczb).
  const limit = 200 * 48;
  let bytes = Infinity;
  for (let round = 0; round < 6 && bytes >= limit; round++) {
    clockMs = 52001;
    for (let i = 0; i < 5000; i++) run();
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let i = 0; i < 100; i++) run();
    bytes = Math.min(bytes, allocatedBytes(() => { clockMs++; run(); }, 200));
  }
  // Jedyna alokacja: liczba w `uTime.value` (pole węzła uniformu three jest tagowane — pudełko
  // 16 B na klatkę, jak przy każdym uniformie float gry) + szum pomiaru (~2,5 kB obiektów
  // statystyk sterty).
  assert.ok(bytes < limit, `klatka wybuchu alokuje ${(bytes / 200).toFixed(1)} B`);
  assert.equal(blow.blasts.length, 1, 'wybuch żył przez cały pomiar');
  assert.equal(fire.mesh.visible, true);
  blow.clear();
});

// --- światło --------------------------------------------------------------------------------

test('światło rdzenia i rozbłysku → siatka świateł efektów (świat gry), gaśnie z alfą rdzenia', () => {
  blow.clear();
  const lights = [];
  const grid = { addWorld(x, y, z, range, r, g, b, scatter) { lights.push({ x, y, z, range, r, g, b, scatter }); return 0; } };
  const lctx = { core, grid };
  const cfg = REACTOR_BLOW_PROFILES.capital;
  clockMs = 60000;
  blow.spawn(-12345, 6789, 400, 'capital');
  core.steps[0].lights(lctx);
  assert.equal(lights.length, 1);
  assert.deepEqual([lights[0].x, lights[0].y, lights[0].z], [-12345, 6789, REACTOR_LIGHT.z]);
  close(lights[0].b, REACTOR_LIGHT.charge * REACTOR_LIGHT.color[2], 1e-9, 'pełna moc na starcie ładowania');
  close(lights[0].range, 400 * cfg.chargeSizeMul * 0.5 * REACTOR_LIGHT.rangeMul, 1e-6);
  // Rozbłysk: światło błysku (większy kwad, mocniejsze).
  frameAt(60000 + cfg.chargeTime * 1000 + 1);
  lights.length = 0;
  core.steps[0].lights(lctx);
  assert.equal(lights.length, 1);
  assert.ok(lights[0].b > REACTOR_LIGHT.charge, 'błysk mocniejszy od ładowania');
  // Po błysku (flashLife): bez światła.
  frameAt(60000 + (cfg.chargeTime + cfg.flashLife) * 1000 + 5);
  lights.length = 0;
  core.steps[0].lights(lctx);
  assert.equal(lights.length, 0);
  blow.clear();
});

// --- rozgrzewka -----------------------------------------------------------------------------

test('rozgrzewka: obie pule w passie ortho (warstwa 0), odsłonięte z ≥ 2 instancjami, stan przywrócony', () => {
  core.prewarmed.length = 0;
  core.steps[0].warm({ core });
  assert.equal(core.prewarmed.length, 2);
  for (const [obj, layer, vis, count] of core.prewarmed) {
    assert.equal(layer, 0);
    assert.equal(vis, true);
    assert.ok(count >= 2);
    assert.equal(obj.visible, false, 'przywrócone');
    assert.equal(obj.geometry.instanceCount, 0);
  }
});

// --- wygląd overlaya ------------------------------------------------------------------------

test('reactorLook: gra (ACES + sRGB) pokazuje to, co overlay (alfa · sRGB(ACES(1,2 · x))) — lustro CPU', () => {
  assert.ok(reactorLookCpu(0) === 0, 'F(0) = 0');
  let prev = 0;
  for (let i = 1; i <= 200; i++) {
    const x = i * 0.05;
    const y = reactorLookCpu(x);
    assert.ok(y >= prev - 1e-12, `monotoniczne (${x})`);
    prev = y;
    // Szara cząstka: obraz gry z wyjścia = obraz overlaya z wkładu.
    const game = linearDoSrgbCpu(acesGryCpu(y));
    const overlay = Math.min(1, 1.5 * x) * linearDoSrgbCpu(acesGryCpu(1.2 * x));
    if (overlay < 0.99) close(game, overlay, 2e-4, `x = ${x}`);
  }
  // Ciemne partie gasną mocniej niż liniowo (alfa ∝ wkład), jasne dochodzą do sufitu ACES (~7).
  assert.ok(reactorLookCpu(0.1) < 0.05);
  assert.ok(reactorLookCpu(50) < 7.5 && reactorLookCpu(50) > 5);
  // Kolor: alfa z największej składowej, wspólna dla wszystkich.
  const g = reactorLookCpu(0.2, 2.0);
  close(linearDoSrgbCpu(acesGryCpu(g)), linearDoSrgbCpu(acesGryCpu(0.24)), 2e-4);
});

test('strojenie wyglądu: domyślne REACTOR_LOOK w uniformach, rdzeń pod progiem bloomu gry', () => {
  const U = blow.U;
  assert.equal(U.uLook.value, REACTOR_LOOK.look);
  assert.equal(U.uHaloAmp.value, REACTOR_LOOK.haloAmp);
  assert.equal(U.uCap.value, REACTOR_LOOK.cap);
  assert.equal(U.uOutSpark.value, REACTOR_LOOK.outSpark);
  assert.equal(U.uOutSpike.value, REACTOR_LOOK.outSpike);
  assert.equal(U.uSparkGlow.value, REACTOR_LOOK.sparkGlow);
  assert.ok(REACTOR_LOOK.sparkGlowAge0 < REACTOR_LOOK.sparkGlowAge1, 'poświata iskier narasta z wiekiem');
  assert.ok(REACTOR_LOOK.sparkGlowMax > 0 && REACTOR_LOOK.sparkGlowMax <= 64, 'margines kwadu iskry ograniczony (koszt wypełnienia)');
  const threshold = Number(read('src/3d/bloomConfig.js').match(/threshold: ([0-9.]+),/)?.[1]);
  assert.ok(REACTOR_LOOK.cap < threshold, 'sufit rdzenia poniżej progu bloomu gry — poświatę liczy shader');
  assert.equal(OVERLAY_BLOOM_SIGMA_PX.length, 5);
  assert.ok(REACTOR_SLAB_MIN_Z < 5 && REACTOR_SLAB_MAX_Z > 5);
  // Podgląd płaskich kwadów (pierścień, fala — w bazie niewidoczne): obie strony, jeden przebieg.
  blow.setFlatVisible(true);
  assert.equal(blow.fireMaterial.side, THREE.DoubleSide);
  assert.equal(blow.fireMaterial.forceSinglePass, true);
  blow.setFlatVisible(false);
  assert.equal(blow.fireMaterial.side, THREE.FrontSide);
});

test('fabryka: spawn({ x, y, size, profile }) jak dawna, system na window.__reactorBlow3D', () => {
  const c2 = fakeCore();
  const spawn = createReactorBlowFactory(c2);
  assert.equal(typeof spawn, 'function');
  assert.ok(spawn.system instanceof ReactorBlow3D);
  assert.equal(globalThis.window.__reactorBlow3D, spawn.system);
  clockMs = 70000;
  assert.equal(spawn({ x: 10, y: 20, size: 100, profile: 'escort' }), true);
  assert.equal(spawn.system.blasts.length, 1);
  assert.equal(spawn({ x: NaN, y: 0 }), false);
  assert.equal(spawn({ x: 0, y: 0, size: 0 }), false);
  // Nieznany profil → capital (jak dawniej).
  spawn({ x: 0, y: 0, size: 10, profile: 'nieznany' });
  assert.equal(spawn.system.blasts[1].cfg, REACTOR_BLOW_PROFILES.capital);
  assert.throws(() => createReactorBlowFactory(null));
  globalThis.window.__reactorBlow3D = blow;
});
