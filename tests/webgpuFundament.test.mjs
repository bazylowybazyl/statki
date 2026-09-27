// Port WebGPU, zadanie 01 (docs/webgpu/zadania/01-fundament.md): fundament renderu.
// Core3D na WebGPURenderer (tylko WebGPU, bez zapasu WebGL2), wspólne pomocniki TSL
// (src/3d/tsl/: adapter uniformów, magentowy zamiennik ShaderMaterial, ACES gry i
// sRGB), zegar GPU ze znaczników czasu, osłona pipeline'ów w kompilacji, strona
// z import map i komunikatem „Gra wymaga przeglądarki z WebGPU”. Bez GPU — graf,
// źródła i zachowanie na atrapach.
// node --test tests/webgpuFundament.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const WEBGPU = await import('three/webgpu');
const THREE = await import('three');
const { uniform, uniformArray, texture } = await import('three/tsl');
const { uniformsAdapter, uniformNode, makeUniforms } = await import('../src/3d/tsl/uniformy.js');
const { ZamiennikMaterial, installPlaceholders, placeholderName, getPlaceholderStats } = await import('../src/3d/tsl/zamiennik.js');
const { acesGry, linearDoSrgb, acesGryCpu, linearDoSrgbCpu } = await import('../src/3d/tsl/kolorGry.js');
const { Core3D, GPU_REQUIRED_LIMITS } = await import('../src/3d/core3d.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const core = read('src/3d/core3d.js');

test('jeden rdzeń klas: three, three/webgpu i three/tsl na tych samych klasach', () => {
  assert.equal(THREE.Mesh, WEBGPU.Mesh);
  assert.equal(THREE.Texture, WEBGPU.Texture);
  assert.equal(THREE.REVISION, WEBGPU.REVISION);
});

test('adapter uniformów: uniform/texture z .value bez zmian, uniformArray .value → node.array', () => {
  const vecs = [new THREE.Vector4(), new THREE.Vector4(1, 2, 3, 4)];
  const tex = new THREE.Texture();
  const nodes = { uF: uniform(0.25), uV: uniform(new THREE.Vector2(1, 2)), uArr: uniformArray(vecs, 'vec4'), uTex: texture(tex) };
  const u = uniformsAdapter(nodes);
  // kod gry: material.uniforms.X.value = … / .value.set(…)
  u.uF.value = 0.75;
  u.uV.value.set(3, 4);
  assert.equal(nodes.uF.value, 0.75);
  assert.equal(nodes.uV.value.y, 4);
  assert.equal(u.uTex, nodes.uTex, 'texture() ma .value — wpis bez opakowania');
  // uniformArray: .value to spakowany Float32Array węzła — adapter oddaje tablicę gry
  assert.equal(u.uArr.value, vecs);
  u.uArr.value[1].set(5, 6, 7, 8);
  assert.equal(nodes.uArr.array[1].w, 8);
  assert.equal(uniformNode(u.uArr), nodes.uArr);
  assert.equal(uniformNode(u.uF), nodes.uF);
  // makeUniforms: wartości startowe → węzły opakowane adapterem
  const m = makeUniforms({ uTime: 0, uOn: true, uDir: new THREE.Vector2(0, 1), uMap: tex, uL: [new THREE.Vector4()], uS: [1, 2] });
  assert.equal(m.uTime.value, 0);
  assert.equal(m.uOn.value, 1);
  assert.equal(m.uDir.value.y, 1);
  assert.equal(m.uMap.value, tex);
  assert.equal(m.uL.node.getElementType(), 'vec4');
  assert.equal(m.uS.node.getElementType(), 'float');
  assert.throws(() => makeUniforms({ uX: 'napis' }), TypeError);
});

test('zamiennik: magenta dla ShaderMaterial i RawShaderMaterial, rejestracja idempotentna, nazwa jak w spisie', () => {
  const z = new ZamiennikMaterial();
  assert.ok(z instanceof WEBGPU.NodeMaterial);
  assert.equal(z.isPlaceholder, true);
  assert.equal(z.type, 'ZamiennikMaterial');
  assert.equal(z.lights, false);
  const lib = { classes: new Map(), adds: 0, getMaterialNodeClass(t) { return this.classes.get(t) || null; }, addMaterial(c, t) { this.adds++; this.classes.set(t, c); } };
  assert.equal(installPlaceholders({ library: lib }), true);
  assert.equal(lib.classes.get('ShaderMaterial'), ZamiennikMaterial);
  assert.equal(lib.classes.get('RawShaderMaterial'), ZamiennikMaterial);
  installPlaceholders({ library: lib });
  assert.equal(lib.adds, 2, 'druga rejestracja nie dubluje (three ostrzega „Redefinition”)');
  assert.equal(installPlaceholders({}), false);
  assert.equal(placeholderName(new THREE.ShaderMaterial({ name: 'HaloTerrain' })), 'HaloTerrain');
  assert.equal(placeholderName(new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uB: { value: 0 }, uC: { value: 0 }, uD: { value: 0 } } })), 'uA+uB+uC');
  assert.deepEqual(Object.keys(getPlaceholderStats()).sort(), ['builds', 'names']);
  // Harness liczy zamienniki: na WebGPU każdy ShaderMaterial w scenie (też przed pierwszą budową).
  const harness = read('scripts/webgpu/harness-strona.js');
  assert.match(harness, /webgpu && \(m\.isShaderMaterial === true \|\| m\.isRawShaderMaterial === true\)/);
});

test('kolor gry: ACES Narkowicza bez ÷0,6 i LinearTosRGB — lustra CPU, funkcje TSL z layoutem', () => {
  // Punkt kontrolny spike'u (SPIKE 4a): tło (0,05; 0,05; 0,1) → 59, 59, 99.
  assert.equal(Math.round(linearDoSrgbCpu(acesGryCpu(0.05)) * 255), 59);
  assert.equal(Math.round(linearDoSrgbCpu(acesGryCpu(0.1)) * 255), 99);
  // Addytywny kwad kalibracji (0,2; 0,6; 1,2) — piksele zrzutu WebGPU 150, 214, 236 (±1: bufor
  // HalfFloat i 8 bitów kanwy).
  const quad = [0.2, 0.6, 1.2].map((v) => linearDoSrgbCpu(acesGryCpu(v)) * 255);
  [150, 214, 236].forEach((px, i) => assert.ok(Math.abs(quad[i] - px) <= 1.5, `kanał ${i}: ${quad[i]} vs ${px}`));
  assert.equal(acesGryCpu(0), 0);
  assert.equal(acesGryCpu(1e6), 1, 'obcięte do 1');
  assert.ok(Number.isFinite(linearDoSrgbCpu(-0.5)), 'ujemne wejście bez NaN');
  assert.equal(acesGry.shaderNode.layout.name, 'acesGry');
  assert.equal(linearDoSrgb.shaderNode.layout.name, 'linearDoSrgb');
  // Post: RenderPipeline bez transformacji three (ACES gry to inna krzywa niż acesFilmicToneMapping).
  assert.match(core, /return vec4\(linearDoSrgb\(acesGry\(scene\.rgb\)\), scene\.a\);/);
  assert.match(core, /post\.outputColorTransform = false;/);
});

test('Core3D: tylko WebGPURenderer z limitami adaptera, bez zapasu WebGL2, konfiguracja jak na WebGL', () => {
  assert.match(core, /import \* as THREE from 'three\/webgpu';/);
  assert.doesNotMatch(core, /three\/addons\/postprocessing|EffectComposer|UnrealBloomPass|ShaderPass|FullScreenQuad/);
  assert.doesNotMatch(core, /WebGLRenderer|WebGLRenderTarget|capabilities|getContext\(|EXT_disjoint_timer_query/);
  // Adapter PRZED rendererem; brak adaptera = komunikat, renderer nie powstaje.
  const initGpu = core.slice(core.indexOf('async _initGpu() {'), core.indexOf('\n  },', core.indexOf('async _initGpu() {')));
  const adapterAt = initGpu.indexOf('gpu.requestAdapter(');
  const rendererAt = initGpu.indexOf('new THREE.WebGPURenderer(');
  assert.ok(adapterAt > 0 && rendererAt > adapterAt, 'adapter przed rendererem');
  assert.match(initGpu, /if \(!adapter\) return this\._failGpu\('brak adaptera'\);/);
  assert.match(initGpu, /canvas: this\.canvas, alpha: true, antialias: false, trackTimestamp: true, requiredLimits/);
  assert.match(initGpu, /renderer\._getFallback = null;/);
  assert.match(initGpu, /if \(renderer\.backend\?\.isWebGPUBackend !== true\) return this\._failGpu/);
  assert.match(initGpu, /renderer\.info\.autoReset = false;/);
  for (const limit of ['maxTextureDimension2D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage', 'maxInterStageShaderVariables',
    'maxVertexAttributes', 'maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxColorAttachmentBytesPerSample',
    'maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize']) {
    assert.ok(GPU_REQUIRED_LIMITS.includes(limit), limit);
  }
  const cfg = core.slice(core.indexOf('_configureRenderer(renderer) {'), core.indexOf('\n  },', core.indexOf('_configureRenderer(renderer) {')));
  for (const line of ['renderer.highPrecision = true;', 'renderer.outputColorSpace = THREE.LinearSRGBColorSpace;',
    'renderer.toneMapping = THREE.NoToneMapping;', 'renderer.info.autoReset = false;', 'installPlaceholders(renderer);',
    'this._guardPendingPipelines(renderer);']) {
    assert.ok(cfg.includes(line), line);
  }
  // Cele: RenderTarget, scena HalfFloat MSAA 4, halo z próbkami sceny, maska RGBA8, refrakcja w połowie.
  assert.match(core, /const rt = new THREE\.RenderTarget\(w0, h0, \{\s*format: THREE\.RGBAFormat, type: THREE\.HalfFloatType,\s*depthBuffer: true, stencilBuffer: false, samples: 4\s*\}\);/);
  assert.match(core, /this\.planetHaloTarget = new THREE\.RenderTarget\([\s\S]*?samples: rt\.samples/);
  assert.match(core, /rt\.samples = targetSamples;\s*rt\.dispose\(\);/, 'setMsaaEnabled: samples + dispose (SPIKE 17)');
});

test('Core3D przed urządzeniem: isInitialized osobno od gpuReady, ready = Promise, render bramkowany', () => {
  assert.ok(Core3D.ready instanceof Promise);
  assert.equal(Core3D.gpuReady, false);
  assert.match(core, /render\(\) \{\s*if \(!this\.isInitialized \|\| !this\.gpuReady\) return;/);
  assert.match(core, /renderBackdrop\(camera\) \{\s*if \(!this\.isInitialized \|\| !this\.gpuReady \|\| !camera\) return;/);
  // isInitialized = true po części synchronicznej (moduły od razu dokładają obiekty), urządzenie w tle.
  const init = core.slice(core.indexOf('\n  init(canvasElement) {'), core.indexOf('async _initGpu() {'));
  assert.ok(init.indexOf('this.isInitialized = true;') < init.indexOf('this._initGpu()'), 'isInitialized przed startem urządzenia');
  assert.equal(Core3D.getMaxAnisotropy(), 16, 'anizotropia znana przed urządzeniem (tekstury planet)');
  // Bez urządzenia: resize tylko zapamiętuje (renderer powstanie później).
  const fake = Object.assign(Object.create(Core3D), { isInitialized: true, renderer: null, composerTarget: null, sunShadowTarget: null, refractionTarget: null, planetHaloTarget: null });
  assert.doesNotThrow(() => fake.resize(800, 600));
  assert.equal(fake.width, 800);
});

test('Core3D: bez martwego splitu w jednym renderze — dwa renderSingle w drawHexShips3D', () => {
  assert.doesNotMatch(core, /renderSplitScreen|_renderDirect|makeSplitScreenRenderPass|setScissorTest|setViewport\(/);
  const hex = read('src/3d/hexShips3D.js');
  const draw = hex.slice(hex.indexOf('export function drawHexShips3D('));
  assert.equal((draw.slice(0, draw.indexOf('\n}\n')).match(/Core3D\.renderSingle\(/g) || []).length, 3, 'split: 2× renderSingle + pojedynczy widok');
});

test('zegar GPU: jedno zapytanie w locie, wynik do gpuFrameMs, mapa znaczników three czyszczona', async () => {
  let resolveNext = null;
  let calls = 0;
  const pool = { timestamps: new Map([['r:1:3:f5', 0.1]]) };
  const renderer = {
    info: { frame: 1 },
    backend: { trackTimestamp: true, timestampQueryPool: { render: pool, compute: null } },
    resolveTimestampsAsync(type) { calls++; assert.equal(type, 'render'); return new Promise((r) => { resolveNext = r; }); }
  };
  const core3d = Object.assign(Object.create(Core3D), { renderer, gpuFrameMs: 0, _gpuTimerPending: { render: false, compute: false }, _gpuTimerFrame: -1 });
  // Handlery przypina init() (raz, bez domknięć per klatka) — w teście tak samo.
  core3d._onGpuRenderTimestamp = (ms) => core3d._handleGpuTimestamp('render', ms);
  core3d._onGpuTimestampError = () => { core3d._gpuTimerPending.render = false; };
  assert.match(core, /this\._onGpuRenderTimestamp = \(ms\) => this\._handleGpuTimestamp\('render', ms\);/);
  core3d._gpuTimerPoll();
  core3d._gpuTimerPoll();
  assert.equal(calls, 1, 'drugie zapytanie dopiero po rozwiązaniu pierwszego');
  resolveNext(1.25);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(core3d.gpuFrameMs, 1.25);
  assert.equal(pool.timestamps.size, 0, 'mapa uid → ms nie rośnie bez końca');
  core3d._gpuTimerPoll();
  assert.equal(calls, 2);
  // Bez cechy timestamp-query nic nie pytamy (three ostrzegałby co klatkę).
  renderer.backend.trackTimestamp = false;
  resolveNext(0.5);
  await new Promise((r) => setTimeout(r, 0));
  core3d._gpuTimerPoll();
  assert.equal(calls, 2);
  // Podzielony ekran: pytanie dopiero po drugim renderSingle klatki.
  renderer.backend.trackTimestamp = true;
  window.splitScreenMode = true;
  try {
    renderer.info.frame = 9;
    core3d._gpuTimerAfterRender();
    assert.equal(calls, 2, 'pierwsza połówka klatki — bez pytania');
    core3d._gpuTimerAfterRender();
    assert.equal(calls, 3, 'druga połówka — pytanie o pełną klatkę');
  } finally {
    window.splitScreenMode = false;
  }
  // Źródło: PerfHUD czyta gpuFrameMs i stan znaczników (bez rozszerzenia WebGL).
  const hud = read('src/ui/perfHud.js');
  assert.match(hud, /window\.Core3D\?\.gpuTimerSupported/);
  assert.doesNotMatch(hud, /_gpuTimerExt/);
});

test('osłona pipeline\'ów w kompilacji: rysunek czeka, aż createRenderPipelineAsync odda obiekt', () => {
  const pipelines = new Map();
  const drawn = [];
  const backend = {
    get(o) { if (!pipelines.has(o)) pipelines.set(o, {}); return pipelines.get(o); },
    draw(renderObject) { drawn.push(renderObject.id); return 'narysowane'; }
  };
  Core3D._guardPendingPipelines({ backend });
  const pending = { id: 'kompiluje', pipeline: {} };
  const ready = { id: 'gotowy', pipeline: {} };
  const broken = { id: 'błąd', pipeline: {} };
  backend.get(ready.pipeline).pipeline = {};
  backend.get(broken.pipeline).error = true;
  assert.equal(backend.draw(pending, null), undefined);
  assert.equal(backend.draw(ready, null), 'narysowane');
  backend.draw(broken, null);
  assert.deepEqual(drawn, ['gotowy', 'błąd'], 'błąd walidacji zostaje przy dawnej ścieżce (three sam go pomija)');
  const once = backend.draw;
  Core3D._guardPendingPipelines({ backend });
  assert.equal(backend.draw, once, 'osłona zakładana raz');
});

test('odrzucony createRenderPipelineAsync (three r183 go połyka) ląduje w konsoli raz na etykietę', async () => {
  // Zadanie 04: 9 buforów wierzchołków > maxVertexBuffers (8) — GPUPipelineError szedł do pustego
  // catch w WebGPUPipelineUtils, pipeline zostawał „w budowie”, a osłona po cichu pomijała rysunek.
  const device = {
    createRenderPipelineAsync(d) { return d.ok ? Promise.resolve({ gpu: true }) : Promise.reject(new Error('Vertex buffer count (9) exceeds the maximum number of vertex buffers (8).')); }
  };
  const backend = { device, get() { return {}; }, draw() { } };
  Core3D._guardPendingPipelines({ backend });
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    assert.deepEqual(await device.createRenderPipelineAsync({ ok: true, label: 'dobry' }), { gpu: true });
    for (let i = 0; i < 2; i++) await assert.rejects(device.createRenderPipelineAsync({ label: 'renderPipeline_zly' }), /maximum number of vertex buffers/);
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1, 'raz na etykietę');
  assert.match(errors[0], /pipeline „renderPipeline_zly” nie powstał: Vertex buffer count \(9\)/);
});

test('rozgrzewka passa: compileAsync na celu sceny, kamera passa z warstwą, bez cullingu, bez blokowania', () => {
  const body = core.slice(core.indexOf('prewarmPass(object3d, layer = 0, opts = {}) {'), core.indexOf('getMaxAnisotropy() {'));
  assert.match(body, /renderer\.setRenderTarget\(this\.composerTarget\);/);
  assert.match(body, /camera\.layers\.set\(layer\);/);
  assert.match(body, /o\.frustumCulled = false;/);
  assert.match(body, /renderer\.compileAsync\(object3d, camera, object3d\.isScene \? null : this\.scene\)/);
  assert.match(body, /return this\.ready\.then\(/, 'przed urządzeniem czeka na Core3D.ready');
  // Wywołania modułów: bez synchronicznego renderer.compile.
  for (const [file, call] of [['src/3d/hexShips3D.js', 'Core3D.prewarmPass(Core3D.scene, 0);'], ['src/3d/shield3D.js', 'Core3D.prewarmPass(probe, 7);'],
    ['src/3d/weapon3DSystem.js', 'Core3D.prewarmPass(Core3D.scene, 0);']]) {
    const src = read(file);
    assert.ok(src.includes(call), `${file}: ${call}`);
    assert.doesNotMatch(src, /renderer\.compile\(/, `${file}: synchroniczne compile`);
  }
});

test('strona: import map three/webgpu i three/tsl, Vite prebundluje razem, komunikat bez WebGPU', () => {
  const html = read('index.html');
  assert.match(html, /"three\/webgpu": "\.\/node_modules\/three\/build\/three\.webgpu\.js"/);
  assert.match(html, /"three\/tsl": "\.\/node_modules\/three\/build\/three\.tsl\.js"/);
  assert.match(read('vite.config.js'), /optimizeDeps: \{\s*include: \['three', 'three\/webgpu', 'three\/tsl'\]/);
  assert.match(html, /note\.textContent = 'Gra wymaga przeglądarki z WebGPU';/);
  assert.match(html, /Core3D\.ready\?\.then\(\(ok\) => \{ if \(!ok\) showWebGpuRequired\(\); \}\);/);
  const start = html.slice(html.indexOf('async function startGame() {'));
  assert.match(start.slice(0, 300), /if \(Core3D\.gpuUnsupported\) \{ showWebGpuRequired\(\); return; \}/);
});

test('jeden renderer: modelBaker usunięty, w src żadnego WebGLRenderer poza overlayem (do zadania 20)', () => {
  assert.equal(existsSync(new URL('../src/3d/modelBaker.js', import.meta.url)), false);
  assert.doesNotMatch(read('src/ui/devTools.js'), /modelBaker|ModelBaker|btn-load-glb/);
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.m?js$/.test(name) && /new THREE\.WebGLRenderer\(|new WebGLRenderer\(/.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  walk(root);
  assert.deepEqual(offenders.map((p) => p.slice(root.length + 1).replace(/\\/g, '/')), ['effects3d/overlay.js']);
});
