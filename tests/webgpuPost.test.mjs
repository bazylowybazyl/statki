// Port WebGPU, zadanie 02 (docs/webgpu/zadania/02-post-bloom-uber.md): post gry w TSL —
// bloom (BloomGry = BloomNode three + zgodność z dawnym passem bloomu WebGL), „uber” z gorącym
// powietrzem (src/3d/tsl/postGry.js), dwa RenderPipeline (z bloomem i bez), uniformy z
// pushHeatHazeWorld, kubełki PerfHUD, brama znaczników czasu GPU. Bez GPU: WGSL budowany w Node
// (WGSLNodeBuilder, renderer bez init — jak tests/haloRingTSL.test.mjs), Core3D na atrapach.
// node --test tests/webgpuPost.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { texture } = await import('three/tsl');
const { BLOOM_DEFAULTS } = await import('../src/3d/bloomConfig.js');
const { BloomGry, BLOOM_ZGODNOSC_WEBGL, MAX_HEAT_HAZE_SOURCES, createPostUniforms, createUberPost } = await import('../src/3d/tsl/postGry.js');
const { Core3D } = await import('../src/3d/core3d.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const readModule = (spec) => readFileSync(fileURLToPath(import.meta.resolve(spec)), 'utf8').replace(/\r\n/g, '\n');
const core = read('src/3d/core3d.js');
const bodyOf = (src, header) => {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `brak ${header}`);
  return src.slice(start, src.indexOf('\n  },', start));
};

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
const fnBody = (wgsl, name) => (wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`)) || [''])[0];

function makePost({ withBloom }) {
  const rt = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const bloom = new BloomGry(texture(rt.texture), 0.85, 0.4, 0.9);
  const material = new THREE.NodeMaterial();
  material.fragmentNode = createUberPost({ sceneTexture: rt.texture, bloomTexture: withBloom ? bloom.getTextureNode() : null, uniforms: createPostUniforms() });
  return { bloom, fragment: buildWGSL(material) };
}

test('bloom: BloomNode = algorytm dawnego passu WebGL (three r183), różnice kompozytu skompensowane', () => {
  const unreal = readModule('three/addons/postprocessing/UnrealBloomPass.js');
  const node = readModule('three/addons/tsl/display/BloomNode.js');
  // Ten sam algorytm: jądra 6…22 z tymi samymi współczynnikami, 5 mipów połówkowych, bloomFactors,
  // lerp promienia, cele HalfFloat, próg smoothstep(threshold, threshold + 0,01, luminancja)
  // (bramkuje cały teksel — model jasności dysz w renderBugfixGuards zostaje).
  for (const [name, src] of [['UnrealBloomPass', unreal], ['BloomNode', node]]) {
    assert.match(src, /const kernelSizeArray = \[ 6, 10, 14, 18, 22 \];/, name);
    assert.match(src, /coefficients\.push\( 0\.39894 \* Math\.exp\( - 0\.5 \* i \* i \/ \( sigma \* sigma \) \) \/ sigma \);/, name);
    assert.match(src, /\[ 1\.0, 0\.8, 0\.6, 0\.4, 0\.2 \]/, name);
    assert.match(src, /let resx = Math\.round\( width \/ 2 \);/, name);
    assert.match(src, /mirrorFactor/, name);
  }
  assert.match(unreal, /this\.highPassUniforms\[ 'smoothWidth' \]\.value = 0\.01;/);
  assert.match(node, /this\.smoothWidth = uniform\( 0\.01 \);/);
  assert.match(node, /smoothstep\( this\.threshold, this\.threshold\.add\( this\.smoothWidth \), v \)/);
  // Różnica 1: dawny kompozyt ×3,0 i alfa = max(rgb), dokładany blendem (ONE, ONE) — BloomNode bez ×3.
  assert.match(unreal, /vec3 bloom = 3\.0 \* bloomStrength \* \(/);
  assert.match(unreal, /float bloomAlpha = max\( bloom\.r, max\( bloom\.g, bloom\.b \) \);/);
  assert.match(unreal, /premultipliedAlpha: true,\s*blending: AdditiveBlending/);
  assert.match(node, /return sum\.mul\( this\.strength \);/, 'BloomNode dostał ×3 — zdejmij BLOOM_ZGODNOSC_WEBGL (postGry.js)');
  assert.equal(BLOOM_ZGODNOSC_WEBGL, 3);
  // Różnica 2: BloomNode liczy się raz na KLATKĘ i bierze rozmiar bufora rysowania co render.
  assert.match(node, /this\.updateBeforeType = NodeUpdateType\.FRAME;/);
  assert.match(node, /const size = renderer\.getDrawingBufferSize\( _size \);\s*this\.setSize\( size\.width, size\.height \);/);
  // bloomConfig.js bez zmian wartości (zgodność 1:1 z bazą WebGL)
  assert.deepEqual([BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold, BLOOM_DEFAULTS.resolutionScale], [0.85, 0.4, 0.9, 1.0]);
});

test('BloomGry: raz na render (podzielony ekran), rozmiar = bufor × resolutionScale, haki pomiaru wokół passów', () => {
  const { bloom } = makePost({ withBloom: true });
  assert.equal(bloom.updateBeforeType, THREE.NodeUpdateType.RENDER);
  // setup (budowa WGSL) utworzył materiały rozmycia — rozmiary mipów jak w dawnym passie
  bloom.setSize(1920, 1080);
  assert.deepEqual([bloom._renderTargetBright.width, bloom._renderTargetBright.height], [960, 540]);
  assert.deepEqual(bloom._renderTargetsHorizontal.map((r) => `${r.width}x${r.height}`), ['960x540', '480x270', '240x135', '120x68', '60x34']);
  bloom.resolutionScale = 0.5;
  bloom.setSize(1920, 1080);
  assert.deepEqual([bloom._renderTargetBright.width, bloom._renderTargetBright.height], [480, 270]);
  bloom.resolutionScale = 0;
  bloom.setSize(1920, 1080);
  assert.equal(bloom._renderTargetBright.width, 960, 'skala 0 / NaN = pełna (jak _getBloomConfig: 0,1…1)');
  // haki pomiaru: przed i po passach rodzica
  const parent = Object.getPrototypeOf(BloomGry.prototype);
  const orig = parent.updateBefore;
  const seq = [];
  parent.updateBefore = function () { seq.push('passy'); };
  try {
    bloom.onRenderBegin = () => seq.push('początek');
    bloom.onRenderEnd = () => seq.push('koniec');
    bloom.updateBefore({ renderer: null });
  } finally {
    parent.updateBefore = orig;
  }
  assert.deepEqual(seq, ['początek', 'passy', 'koniec']);
});

test('uber w TSL: pętla po źródłach z uniformu int, czyste funkcje szumu, clampy, dyspersja, 3 bufory uniformów', () => {
  const withBloom = makePost({ withBloom: true }).fragment;
  const noBloom = makePost({ withBloom: false }).fragment;
  // funkcje z layoutem są czyste (błąd r183: uniform w domknięciu czytałby cudzy slot)
  for (const name of ['hazeHash12', 'hazeNoise', 'acesGry', 'linearDoSrgb']) {
    const body = fnBody(withBloom, name);
    assert.ok(body.length > 0, `brak fn ${name}`);
    assert.doesNotMatch(body, /\bobject\.|\brender\.|\bframe\.|NodeBuffer/, `${name} czyta uniform`);
  }
  // hash12 z GLSL: fract(p.xyx · 0,1031), += dot(p3, p3.yzx + 33,33), fract((x + y) · z)
  assert.match(fnBody(withBloom, 'hazeHash12'), /\.xyx \* vec3<f32>\( 0\.1031 \)/);
  assert.match(fnBody(withBloom, 'hazeHash12'), /dot\( nodeVar0, \( nodeVar0\.yzx \+ vec3<f32>\( 33\.33 \) \) \)/);
  // pętla ograniczona uniformem (tablice zawsze po 24), gałąź dysza / izotropowe z continue
  assert.match(withBloom, /for \( var i : i32 = 0; i < object\.nodeUniform\d+; i \+\+ \)/);
  assert.match(withBloom, /array< vec4<f32>, 24 >[\s\S]*array< vec4<f32>, 24 >/, 'źródła vec4 i kierunki vec2 (dopełnione do vec4)');
  assert.ok((withBloom.match(/continue;/g) || []).length >= 5);
  // clampy przesunięć ±0,022 (izotropowe) i ±0,012 (dysze), dyspersja 0,82 / 1,22
  assert.match(withBloom, /clamp\( nodeVar\d+, vec2<f32>\( -0\.022, -0\.022 \), vec2<f32>\( 0\.022, 0\.022 \) \)/);
  assert.match(withBloom, /clamp\( nodeVar\d+, vec2<f32>\( -0\.012, -0\.012 \), vec2<f32>\( 0\.012, 0\.012 \) \)/);
  assert.match(withBloom, /vec2<f32>\( 0\.82 \)/);
  assert.match(withBloom, /vec2<f32>\( 1\.22 \)/);
  // WGSL: smoothstep ze stałymi krawędziami musi mieć low < high (błąd tworzenia shadera)
  const steps = [...withBloom.matchAll(/smoothstep\( (-?[\d.]+), (-?[\d.]+),/g)];
  assert.ok(steps.length >= 5);
  for (const m of steps) assert.ok(Number(m[1]) < Number(m[2]), m[0]);
  // odczyty w gałęziach zależnych od piksela — poziom 0 jawnie (bez wymogu jednolitego przepływu)
  assert.doesNotMatch(withBloom, /textureSample\(/);
  assert.match(withBloom, /textureSampleLevel\(/);
  // bufory uniformów: grupa obiektu + dwie tablice (limit 12 na etap)
  assert.equal((withBloom.match(/var<uniform>/g) || []).length, 3);
  assert.equal((noBloom.match(/var<uniform>/g) || []).length, 3);
  // tekstury: scena + bloom (jedno wiązanie na teksturę mimo 3 odczytów), bez macierzy UV tekstury
  assert.equal((withBloom.match(/texture_2d<f32>/g) || []).length, 2);
  assert.equal((noBloom.match(/texture_2d<f32>/g) || []).length, 1);
  assert.doesNotMatch(withBloom, /mat3x3<f32>/);
  // bloom × 3 (zgodność z dawnym passem), alfa + max(rgb) bloomu; wyjście ACES gry + sRGB
  assert.match(withBloom, /\* vec3<f32>\( 3\.0 \)/);
  assert.match(withBloom, /\.w \+ max\( nodeVar\d+\.x, max\( nodeVar\d+\.y, nodeVar\d+\.z \) \)/);
  assert.doesNotMatch(noBloom, /vec3<f32>\( 3\.0 \)/);
  assert.match(withBloom, /output\.color = vec4<f32>\( linearDoSrgb\( acesGry\( nodeVar\d+\.xyz \) \), nodeVar\d+\.w \);/);
  // UV kwadu WebGPU (v od góry) → źródła w UV z v od dołu, przesunięcie wraca z odwróconym y
  assert.match(withBloom, /vec2<f32>\( nodeVar0\.x, \( 1\.0 - nodeVar0\.y \) \)/);
  assert.match(withBloom, /vec2<f32>\( nodeVar\d+\.x, \( - nodeVar\d+\.y \) \)/);
});

test('Core3D: post = dwa RenderPipeline zbudowane raz, bez GLSL uber, uniformy postu przed postem', () => {
  assert.doesNotMatch(core, /UberPostShader|HEAT_HAZE: 1|#ifdef HEAT_HAZE|ShaderPass|texture2D\(tDiffuse/, 'GLSL „uber” usunięty (port w tsl/postGry.js)');
  const create = bodyOf(core, '  _createPost(renderer) {');
  // 12-B: wejście bloomu przez siatkę bezpieczeństwa NaN / Inf (hdrBezpieczny, postGry.js)
  assert.match(create, /new BloomGry\(hdrBezpieczny\(texture\(sceneTexture\)\), cfg\.strength, cfg\.radius, cfg\.threshold\)/);
  assert.match(create, /bloom\.onRenderBegin = this\._onBloomRenderBegin;/);
  assert.equal((create.match(/new THREE\.RenderPipeline\(/g) || []).length, 2);
  assert.match(create, /bloomTexture: bloom\.getTextureNode\(\)/);
  assert.match(create, /bloomTexture: null/);
  // render(): konfiguracja bloomu, uniformy „uber” z licznika źródeł, konsumpcja licznika, potem passy
  const render = bodyOf(core, '\n  render() {');
  const at = (s) => render.indexOf(s);
  assert.ok(at('this._gpuTimerGate();') > 0 && at('this._gpuTimerGate();') < at('this._beginRenderInfo();'));
  assert.ok(at('this._updatePostUniforms(heatEnabled, heatEnabled ? this.heatHazeCount : 0, nowSec);') > 0);
  assert.ok(at('this.heatHazeCount = 0;') > at('this._updatePostUniforms('));
  assert.match(render, /const heatEnabled = t\.heatHaze !== false && !freePerspective;/);
  assert.ok(at('this._renderPost();') > at('this._runScenePass(pass)'));
  // tło menu: bez źródeł
  assert.match(bodyOf(core, '\n  renderBackdrop(camera) {'), /this\._updatePostUniforms\(false, 0\);\s*renderer\.setRenderTarget\(null\);\s*this\._renderPost\(\);/);
  // przełączniki nie przebudowują pipeline'ów; resize nie woła setSize bloomu (sam bierze bufor)
  assert.doesNotMatch(bodyOf(core, '  setPerfToggles(next = {}) {'), /needsUpdate|RenderPipeline|_createPost/);
  assert.doesNotMatch(bodyOf(core, '  resize(w, h) {'), /bloomPass\.setSize/);
  assert.doesNotMatch(bodyOf(core, '  _applyPassToggles() {'), /bloomPass\.enabled/);
});

test('Core3D: pushHeatHazeWorld bez gałęzi splitu, uniformy uber (uHeatOn, licznik ≤ 24, zegar % 600)', () => {
  assert.doesNotMatch(bodyOf(core, '  pushHeatHazeWorld('), /splitScreenMode|activeCam2/);
  const fake = Object.assign(Object.create(Core3D), {
    isInitialized: true, width: 1920, height: 1080, cameraOrtho: {},
    heatHazeSources: new Float32Array(MAX_HEAT_HAZE_SOURCES * 4), heatHazeDirs: new Float32Array(MAX_HEAT_HAZE_SOURCES * 2),
    heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, perfToggles: { heatHaze: true },
    activeCam1: { x: 1000, y: -500, zoom: 1 }, activeCam2: { x: 90000, y: 90000, zoom: 1 },
    _postUniforms: createPostUniforms()
  });
  window.splitScreenMode = true;
  try {
    // dysza na środku kadru kamery gracza 1 (scena: y = −y gry), wydech w lewo
    assert.equal(fake.pushHeatHazeWorld(1000, 500, -4, 30, 1.2, -2, 0), true);
  } finally {
    window.splitScreenMode = false;
  }
  assert.equal(fake.heatHazeCount, 1, 'jedno źródło w UV całego kadru (split = dwa renderSingle pełnego kadru)');
  assert.ok(Math.abs(fake.heatHazeSources[0] - 0.5) < 1e-9 && Math.abs(fake.heatHazeSources[1] - 0.5) < 1e-9);
  assert.ok(Math.abs(fake.heatHazeSources[2] - 30 / 1080) < 1e-9, 'promień w jednostkach osi v');
  assert.deepEqual([fake.heatHazeDirs[0], fake.heatHazeDirs[1]], [-1, 0], 'kierunek znormalizowany');
  const U = fake._postUniforms;
  fake._updatePostUniforms(true, fake.heatHazeCount, 1234.5);
  assert.equal(U.uHeatOn.value, 1);
  assert.equal(U.uSourceCount.value, 1);
  assert.ok(Math.abs(U.uTime.value - 34.5) < 1e-9, 'zegar szumu zawinięty % 600');
  assert.equal(U.uAspect.value, 1920 / 1080);
  const s0 = U.uHeatSources.value[0];
  assert.ok(Math.abs(s0.x - 0.5) < 1e-6 && Math.abs(s0.y - 0.5) < 1e-6 && Math.abs(s0.w - 1.2) < 1e-6);
  assert.deepEqual([U.uHeatDirs.value[0].x, U.uHeatDirs.value[0].y], [-1, 0]);
  // perfToggles.heatHaze = false → uHeatOn 0 (dawny define), bez źródeł; zegar bez nowSec zostaje
  fake._updatePostUniforms(false, 0);
  assert.equal(U.uHeatOn.value, 0);
  assert.equal(U.uSourceCount.value, 0);
  assert.ok(Math.abs(U.uTime.value - 34.5) < 1e-9);
  fake._updatePostUniforms(true, 99, 0);
  assert.equal(U.uSourceCount.value, MAX_HEAT_HAZE_SOURCES, 'pętla nie wyjdzie poza tablicę');
  // wyłączone gorące powietrze nie zbiera źródeł
  fake.perfToggles.heatHaze = false;
  assert.equal(fake.pushHeatHazeWorld(1000, 500, -4, 30, 1, 0, 0), false);
});

test('Core3D: strojenie bloomu (bloomConfig.js / DevVFX.bloom) = uniformy węzła, bez przebudowy', () => {
  const bloom = new BloomGry(texture(new THREE.Texture()), 0, 0, 0);
  const fake = Object.assign(Object.create(Core3D), { bloomPass: bloom, bloomResolutionScale: 1 });
  const prev = window.DevVFX;
  try {
    window.DevVFX = undefined;
    fake._applyBloomPassConfig();
    assert.deepEqual([bloom.strength.value, bloom.radius.value, bloom.threshold.value, bloom.resolutionScale],
      [BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold, BLOOM_DEFAULTS.resolutionScale]);
    window.DevVFX = { bloom: { strength: 2, radius: 0.1, threshold: 1.2, resolutionScale: 0.5 } };
    fake._applyBloomPassConfig();
    assert.deepEqual([bloom.strength.value, bloom.radius.value, bloom.threshold.value, bloom.resolutionScale], [2, 0.1, 1.2, 0.5]);
    assert.equal(bloom.strength.isNode, true, 'węzeł uniformu zostaje (tuner nie nadpisuje go liczbą)');
  } finally {
    window.DevVFX = prev;
  }
  assert.doesNotMatch(read('src/ui/bloomTunerPanel.js'), /bloomPass\.strength = /);
});

test('Core3D._renderPost: pipeline z bloomem albo bez (perfToggles.bloom), passy bloomu w kubełku bloom, nie w post', () => {
  const info = { frame: 1, render: { drawCalls: 0, triangles: 0, points: 0, lines: 0 }, reset() {} };
  const fake = Object.assign(Object.create(Core3D), {
    renderer: { info }, lastFrameRenderInfo: null, perfToggles: { bloom: true },
    _renderInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 },
    _bloomInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 },
    _bloomInfoDelta: { calls: 0, triangles: 0, points: 0, lines: 0, ms: 0 }
  });
  const withBloom = { renders: 0, render() { this.renders++; fake._bloomRenderBegin(); info.render.drawCalls += 12; info.render.triangles += 12; fake._bloomRenderEnd(); info.render.drawCalls += 1; info.render.triangles += 1; } };
  const noBloom = { renders: 0, render() { this.renders++; info.render.drawCalls += 1; info.render.triangles += 1; } };
  fake._post = withBloom;
  fake._postBezBloomu = noBloom;
  fake._resetRenderInfoBuckets();
  fake._renderPost();
  assert.equal(withBloom.renders, 1);
  assert.deepEqual([fake.lastFrameRenderInfo.bloom.calls, fake.lastFrameRenderInfo.post.calls], [12, 1]);
  assert.deepEqual([fake.lastFrameRenderInfo.bloom.triangles, fake.lastFrameRenderInfo.post.triangles], [12, 1]);
  fake.perfToggles.bloom = false;
  fake._resetRenderInfoBuckets();
  fake._renderPost();
  assert.equal(noBloom.renders, 1);
  assert.deepEqual([fake.lastFrameRenderInfo.bloom.calls, fake.lastFrameRenderInfo.post.calls], [0, 1]);
});

test('zegar GPU: brama znaczników na granicy klatki — klatka bez pomiaru zamiast przepełnienia puli three', () => {
  let polls = 0;
  const pool = { maxQueries: 2048, currentQueryIndex: 0 };
  const backend = { trackTimestamp: true, timestampQueryPool: { render: pool } };
  const renderer = { info: { frame: 1 }, backend };
  const fake = Object.assign(Object.create(Core3D), { renderer, _gpuTimerPending: { render: false, compute: false }, _gpuTimerGateFrame: -1, _gpuTimestampFeature: true });
  // atrapa zlecenia: three zeruje pulę synchronicznie na starcie rozwiązywania
  fake._gpuTimerPollType = (type) => { polls++; backend.timestampQueryPool[type].currentQueryIndex = 0; fake._gpuTimerPending[type] = true; };
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls], [true, 0], 'miejsce jest — bez zmian');
  pool.currentQueryIndex = 1800; renderer.info.frame = 2;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls, pool.currentQueryIndex], [true, 1, 0], 'brak miejsca, bez zlecenia w locie — zlecenie od razu');
  pool.currentQueryIndex = 1800; renderer.info.frame = 3;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls], [false, 1], 'zlecenie w locie — klatka bez znaczników (initTimestampQuery nic nie dopisuje)');
  assert.equal(fake.gpuTimerSupported, true, 'PerfHUD dalej widzi cechę timestamp-query');
  fake._gpuTimerPending.render = false;
  fake._gpuTimerGate();
  assert.equal(backend.trackTimestamp, false, 'decyzja raz na klatkę rAF (drugi renderSingle tej klatki)');
  renderer.info.frame = 4;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls, pool.currentQueryIndex], [true, 2, 0], 'wynik przyszedł — pomiar wraca');
  // Zadanie 23: seria renderów w JEDNEJ klatce rAF (dema, narzędzia) — miejsce sprawdzane przy każdym
  // renderze (na jeden pełny render), nie tylko na granicy klatki.
  fake._gpuTimerPending.render = false;
  pool.currentQueryIndex = 1990;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls, pool.currentQueryIndex], [true, 3, 0], 'kolejny render tej klatki bez miejsca — zlecenie od razu');
  pool.currentQueryIndex = 1990;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, polls], [false, 3], 'zlecenie w locie — reszta klatki bez znaczników (zamiast przepełnienia)');
  pool.currentQueryIndex = 100;
  fake._gpuTimerGate();
  assert.equal(backend.trackTimestamp, false, 'do końca klatki bez znaczników');
  // Pula compute: własny znacznik puli, render dalej mierzony.
  const compute = { maxQueries: 2048, currentQueryIndex: 1900, trackTimestamp: true };
  backend.timestampQueryPool.compute = compute;
  fake._gpuTimerPending.render = false;
  fake._gpuTimerPending.compute = true;
  renderer.info.frame = 5;
  pool.currentQueryIndex = 0;
  fake._gpuTimerGate();
  assert.deepEqual([backend.trackTimestamp, compute.trackTimestamp], [true, false], 'compute bez miejsca i ze zleceniem w locie — bez znaczników compute');
  fake._gpuTimerPending.compute = false;
  renderer.info.frame = 6;
  fake._gpuTimerGate();
  assert.deepEqual([compute.trackTimestamp, compute.currentQueryIndex, polls], [true, 0, 4], 'compute bez miejsca, bez zlecenia — zlecenie od razu');
  // bez cechy timestamp-query brama nic nie włącza
  const noFeature = Object.assign(Object.create(Core3D), { renderer: { info: { frame: 9 }, backend: { trackTimestamp: false } }, _gpuTimestampFeature: false, _gpuTimerGateFrame: -1 });
  noFeature._gpuTimerGate();
  assert.equal(noFeature.renderer.backend.trackTimestamp, false);
  assert.match(bodyOf(core, '\n  renderBackdrop(camera) {'), /this\._gpuTimerGate\(\);/);
  assert.match(bodyOf(core, '  _configureRenderer(renderer) {'), /this\._gpuTimestampFeature = renderer\.backend\?\.trackTimestamp === true;/);
});
