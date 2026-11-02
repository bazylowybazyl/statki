// Pole asteroid przy 5120 × 1440 (2026-10-29): praca karty bez znaczników czasu w Core3D.
//  • CZYSZCZENIE W PASSIE SCENY (_runScenePass): loadOp „clear” passa sceny (autoClear na czas jednego render())
//    zamiast renderer.clear — three r183 robi z clear() osobny pass z własnym zgłoszeniem i rozwiązaniem MSAA całego
//    celu. A/B: Core3D.clearInPass = false.
//  • ROZWIĄZANIE MSAA RAZ NA RENDER (_lastScenePass, _skipIntermediateResolves): passy sceny przed ostatnim bez
//    resolveTarget, rozwiązuje ostatni pass. A/B: Core3D.msaaResolveOnce = false.
// Obraz na GPU (bufor sceny w pauzie, wariant wobec kontroli) i koszt: scripts/webgpu/gpu-pas-gra.mjs --obrazAB CRoff
// --ab CRoff,C5off,R1off. Strażnik źródeł three r183 — łatka zależy od nazw i przepływu backendu.
// node --test tests/czyszczenieWPassie.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const { Core3D } = await import('../src/3d/core3d.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const core = read('src/3d/core3d.js');
const bodyOf = (src, header) => {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `brak ${header}`);
  return src.slice(start, src.indexOf('\n  },', start));
};

// Atrapa renderera: dziennik clear / render ze stanem autoClear w chwili renderu.
function fakeCore({ hooks = null, throwOnRender = false } = {}) {
  const log = [];
  const renderer = {
    autoClear: false, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    setClearColor(c, a) { log.push(['setClearColor', c, a]); },
    clear(c, d, s) { log.push(['clear', c, d, s]); },
    render() {
      log.push(['render', this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil]);
      if (throwOnRender) throw new Error('render padł');
    }
  };
  const core3 = Object.create(Core3D);
  core3.renderer = renderer;
  core3.scene = {};
  core3._renderInfoBefore = { calls: 0, triangles: 0, points: 0, lines: 0 };
  core3._readRenderInfoInto = () => {};
  core3._addRenderInfoDelta = () => {};
  core3.getPassCamera = () => ({ layers: { set() {} } });
  core3._passHooks = hooks;
  return { core: core3, renderer, log };
}
const pass = (name, clearColor, clearDepth = true) => ({ name, bucket: name, layer: 0, ortho: true, clearColor, clearDepth, enabled: true });

test('czyszczenie w passie: tło (kolor + głębia) i ortho (głębia) idą z renderem sceny, bez renderer.clear', () => {
  const { core: c, renderer, log } = fakeCore();
  c._runScenePass(pass('bg', true), false);
  c._runScenePass(pass('ortho', false), false);
  assert.deepEqual(log, [
    ['setClearColor', 0x000000, 0.0],
    ['render', true, true, true, true],
    ['render', true, false, true, false]
  ]);
  // stan renderera wrócił (Core3D.render trzyma autoClear = false przez całą klatkę)
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.autoClearColor, true);
  assert.equal(renderer.autoClearDepth, true);
  assert.equal(renderer.autoClearStencil, true);
});

test('czyszczenie w passie: pass bez czyszczenia (tarcze, warp) i wspólna głębia kamer 3D — render bez autoClear', () => {
  const { core: c, log } = fakeCore();
  c._runScenePass(pass('shields', false, false), false);
  c._runScenePass(pass('ortho', false), true);          // sharedDepth: kamery 3D, wspólna głębia passów
  c._runScenePass(pass('bg', true), true);              // tło czyści zawsze (pierwszy pass)
  assert.deepEqual(log, [
    ['render', false, true, true, true],
    ['render', false, true, true, true],
    ['setClearColor', 0x000000, 0.0],
    ['render', true, true, true, true]
  ]);
});

test('czyszczenie w passie: A/B clearInPass = false — dawne renderer.clear przed hakami i renderem', () => {
  const { core: c, log } = fakeCore();
  c.clearInPass = false;
  c._runScenePass(pass('bg', true), false);
  c._runScenePass(pass('ortho', false), false);
  c._runScenePass(pass('ortho', false), true);
  assert.deepEqual(log, [
    ['setClearColor', 0x000000, 0.0],
    ['clear', true, true, true],
    ['render', false, true, true, true],
    ['clear', false, true, false],
    ['render', false, true, true, true],
    ['render', false, true, true, true]
  ]);
});

test('czyszczenie w passie: haki passa widzą renderer bez autoClear (ich rysunki do własnych celów nie czyszczą)', () => {
  const seen = [];
  const hooks = { bg: [(cam, p) => seen.push(['hak', p.name])] };
  const { core: c, renderer, log } = fakeCore({ hooks });
  hooks.bg.push(() => seen.push(['autoClear w haku', renderer.autoClear]));
  c._runScenePass(pass('bg', true), false);
  assert.deepEqual(seen, [['hak', 'bg'], ['autoClear w haku', false]]);
  assert.deepEqual(log.at(-1), ['render', true, true, true, true]);
});

test('czyszczenie w passie: błąd renderu nie zostawia autoClear włączonego', () => {
  const { core: c, renderer } = fakeCore({ throwOnRender: true });
  assert.throws(() => c._runScenePass(pass('bg', true), false), /render padł/);
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.autoClearColor, true);
  assert.equal(renderer.autoClearStencil, true);
});

test('czyszczenie w passie: pełnoekranowy quad (halo planet) bez czyszczenia', () => {
  const { core: c, log } = fakeCore();
  let quad = 0;
  c._runScenePass({ name: 'halo', bucket: 'planets', enabled: true, quad: { render() { quad++; } } }, false);
  assert.equal(quad, 1);
  assert.deepEqual(log, []);
});

// --- rozwiązanie MSAA raz na render ---

function passChain() {
  const c = Object.create(Core3D);
  c.renderPassBg = pass('bg', true);
  c.renderPassPlanets = pass('planets', false);
  c.planetHaloPass = { name: 'halo', enabled: true, quad: {} };
  c.renderPassRingPlanets = pass('ringPlanets', false);
  c.renderPassWarp = pass('warp', false, false);
  c.renderPassOrtho = pass('ortho', false);
  c.renderPassShields = pass('shields', false, false);
  c.renderPassFg = pass('fg', false);
  c._scenePasses = [c.renderPassBg, c.renderPassPlanets, c.planetHaloPass, c.renderPassRingPlanets, c.renderPassWarp,
    c.renderPassOrtho, c.renderPassShields, c.renderPassFg];
  c.composerTarget = { samples: 4 };
  return c;
}

test('rozwiązanie MSAA: ostatni wykonywany pass sceny (aktywność warstw i przełączniki passów)', () => {
  const c = passChain();
  const act = { planets: false, halo: false, ringPlanets: false, shields: false, warp: false };
  assert.equal(c._lastScenePass(act), c.renderPassFg);
  c.renderPassFg.enabled = false;
  assert.equal(c._lastScenePass(act), c.renderPassOrtho, 'FG wyłączony — rozwiązuje ortho');
  assert.equal(c._lastScenePass({ ...act, shields: true }), c.renderPassShields, 'tarcze po ortho');
  c.renderPassFg.enabled = true;
  // bez MSAA i A/B — rozwiązanie w każdym passie (null)
  c.composerTarget = { samples: 0 };
  assert.equal(c._lastScenePass(act), null);
  c.composerTarget = { samples: 4 };
  c.msaaResolveOnce = false;
  assert.equal(c._lastScenePass(act), null);
});

function fakeBackend() {
  return {
    calls: 0,
    _getRenderPassDescriptor(renderContext, cfg = {}) {
      this.calls++;
      // jak three r183: deskryptor składany na nowo, widoki z pamięci celu
      return { colorAttachments: [{ view: 'msaa', resolveTarget: 'rozwiazanie', loadOp: cfg.loadOp || 'load', storeOp: 'store' }] };
    }
  };
}

test('rozwiązanie MSAA: łatka deskryptora zdejmuje resolveTarget tylko dla wskazanego celu', () => {
  const c = Object.create(Core3D);
  c.resolveStats = { skipped: 0 };
  c._resolveSkipTarget = null;
  const backend = fakeBackend();
  c._skipIntermediateResolves({ backend });
  c._skipIntermediateResolves({ backend });   // drugi raz — bez podwójnej łatki
  const scene = { name: 'composerTarget' };
  const other = { name: 'atlas' };
  // bez wskazania: jak three
  assert.equal(backend._getRenderPassDescriptor({ renderTarget: scene }, { loadOp: 'load' }).colorAttachments[0].resolveTarget, 'rozwiazanie');
  c._resolveSkipTarget = scene;
  const d = backend._getRenderPassDescriptor({ renderTarget: scene }, { loadOp: 'load' });
  assert.equal(d.colorAttachments[0].resolveTarget, undefined, 'pass sceny przed ostatnim bez rozwiązania');
  assert.equal(d.colorAttachments[0].storeOp, 'store', 'próbki zostają w celu MSAA');
  assert.equal(backend._getRenderPassDescriptor({ renderTarget: other }).colorAttachments[0].resolveTarget, 'rozwiazanie', 'inne cele bez zmian');
  assert.equal(c.resolveStats.skipped, 1);
  assert.equal(backend.calls, 3, 'jedno wywołanie three na deskryptor');
});

test('rozwiązanie MSAA: render() wskazuje cel sceny dla passów przed ostatnim i zdejmuje wskazanie po pętli', () => {
  const render = bodyOf(core, '\n  render() {');
  const at = (s) => render.indexOf(s);
  assert.ok(at('const resolvePass = this._lastScenePass(layerActivity);') > 0);
  assert.ok(at('const resolvePass = this._lastScenePass(layerActivity);') < at('for (const pass of this._scenePasses)'));
  const set = at('this._resolveSkipTarget = resolvePass !== null && pass !== resolvePass ? this.composerTarget : null;');
  assert.ok(set > at('for (const pass of this._scenePasses)') && set < at('this._runScenePass(pass, freePerspective);'),
    'wskazanie ustawione przed passem (po mapie cienia słońca passa)');
  assert.ok(at('this._resolveSkipTarget = null;') > at('this._runScenePass(pass, freePerspective);'), 'po pętli bez wskazania');
  assert.ok(at('this._resolveSkipTarget = null;') < at('this._renderPost();'), 'post czyta rozwiązany cel');
  assert.match(bodyOf(core, '  _configureRenderer(renderer) {'), /this\._skipIntermediateResolves\(renderer\);/);
  // tło menu: zwykłe rozwiązanie (wskazanie zdjęte przed jego renderem)
  assert.match(bodyOf(core, '\n  renderBackdrop(camera) {'), /this\._resolveSkipTarget = null;\s*renderer\.setRenderTarget\(this\.composerTarget\);/);
});

// --- strażnik źródeł three r183: na tym stoją obie łatki ---

test('three r183: deskryptor passa z resolveTarget z _getRenderPassDescriptor (beginRender i clear), autoClear → loadOp passa', () => {
  const backend = read('node_modules/three/src/renderers/webgpu/WebGPUBackend.js');
  const begin = backend.slice(backend.indexOf('\tbeginRender( renderContext ) {'), backend.indexOf('\tfinishRender( renderContext ) {'));
  assert.match(begin, /descriptor = this\._getRenderPassDescriptor\( renderContext, \{ loadOp: GPULoadOp\.Load \} \);/);
  assert.match(begin, /if \( renderContext\.clearColor \) \{[\s\S]*?colorAttachment\.loadOp = GPULoadOp\.Clear;/);
  assert.match(begin, /if \( renderContext\.clearDepth \) \{[\s\S]*?depthStencilAttachment\.depthLoadOp = GPULoadOp\.Clear;/);
  assert.match(begin, /const currentPass = encoder\.beginRenderPass\( descriptor \);/);
  const desc = backend.slice(backend.indexOf('\t_getRenderPassDescriptor( renderContext, colorAttachmentsConfig = {} ) {'), backend.indexOf('\tbeginRender( renderContext ) {'));
  assert.match(desc, /const descriptor = \{\s*colorAttachments: \[\]\s*\};/, 'deskryptor składany na nowo co pass');
  assert.match(desc, /resolveTarget: viewInfo\.resolveTarget,/);
  const clear = backend.slice(backend.indexOf('\tclear( color, depth, stencil, renderTargetContext = null ) {'));
  assert.match(clear, /const descriptor = this\._getRenderPassDescriptor\( renderTargetContext, clearConfig \);/);
  assert.match(clear, /const encoder = device\.createCommandEncoder\( \{ label: 'clear' \} \);[\s\S]*?device\.queue\.submit\(/, 'clear() = osobny pass ze zgłoszeniem');
  const bg = read('node_modules/three/src/renderers/common/Background.js');
  assert.match(bg, /if \( renderer\.autoClear === true \|\| forceClear === true \) \{[\s\S]*?renderContext\.clearColor = renderer\.autoClearColor === true;\s*renderContext\.clearDepth = renderer\.autoClearDepth === true;/);
  const contexts = read('node_modules/three/src/renderers/common/RenderContexts.js');
  assert.match(contexts, /renderState\.clearDepthValue = this\.renderer\.getClearDepth\(\);/, 'głębia czyszczenia passa = renderer.getClearDepth()');
});

// --- cele pomocnicze w klatce (2026-11-02, klatka workera): warstwa DIST i mapa gęstości dymu rakiet ---

function fakeRenderer(log) {
  return {
    autoClear: false, autoClearColor: true, autoClearDepth: true, autoClearStencil: true, info: { frame: 0 },
    getRenderTarget() { return null; }, setRenderTarget(t) { log.push(['target', t ? t.name : null]); },
    getClearColor(c) { return c; }, getClearAlpha() { return 1; },
    setClearColor(c, a) { log.push(['setClearColor', c, a]); },
    clear(c, d, s) { log.push(['clear', c, d, s]); },
    render() { log.push(['render', this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil]); }
  };
}

test('czyszczenie w passie: warstwa DIST czyści sam kolor w passie warstwy (głębia bez czyszczenia), A/B — dawne clear', async () => {
  const { CZYSZCZENIE_AB } = await import('../src/3d/czyszczenieWPassie.js');
  const run = () => {
    const log = [];
    const c = Object.create(Core3D);
    c.renderer = fakeRenderer(log);
    c.scene = {};
    c.fx = { commitDistortion() {}, distortLayerActive: true, stats: {}, post: {} };
    c._postUniforms = { uDistLayerOn: { value: 0 } };
    c.composerTarget = { width: 4, height: 4 };
    c.distortionTarget = { name: 'dist' };
    c._renderInfoBefore = {};
    c._readRenderInfoInto = () => {};
    c._addRenderInfoDelta = () => {};
    c.getPassCamera = () => ({ layers: { mask: 1, set() {} } });
    c._renderFxDistortion(false);
    return { log, r: c.renderer };
  };
  const { log, r } = run();
  assert.deepEqual(log, [['target', 'dist'], ['setClearColor', 0x000000, 0.0], ['render', true, true, false, false], ['target', null]]);
  assert.deepEqual([r.autoClear, r.autoClearColor, r.autoClearDepth, r.autoClearStencil], [false, true, true, true]);
  CZYSZCZENIE_AB.pomocnicze = false;
  try {
    assert.deepEqual(run().log.slice(1, 4), [['setClearColor', 0x000000, 0.0], ['clear', true, false, false], ['render', false, true, true, true]]);
  } finally {
    CZYSZCZENIE_AB.pomocnicze = true;
  }
});

test('czyszczenie w passie: mapa gęstości dymu rakiet — z cząstkami czyszczenie w passie, bez nich sam clear', async () => {
  const THREE = await import('three/webgpu');
  const { SmokeSystem } = await import('../src/3d/rockets/smoke.js');
  const { CZYSZCZENIE_AB } = await import('../src/3d/czyszczenieWPassie.js');
  const run = (highWater) => {
    const log = [];
    const self = {
      U: { dRect: { value: new THREE.Vector4() }, dStep: { value: new THREE.Vector2() }, sunDir: { value: new THREE.Vector3() } },
      densityCam: new THREE.OrthographicCamera(), densityMesh: {}, densityRT: { name: 'gestosc' }, densityScene: {}, highWater
    };
    SmokeSystem.prototype.renderDensity.call(self, fakeRenderer(log), -10, -10, 10, 10, new THREE.Vector3(1, 0, 0), 240);
    return log.filter((e) => e[0] === 'clear' || e[0] === 'render');
  };
  assert.deepEqual(run(50), [['render', true, true, false, false]]);
  assert.deepEqual(run(0), [['clear', true, false, false]]);
  CZYSZCZENIE_AB.pomocnicze = false;
  try {
    assert.deepEqual(run(50), [['clear', true, false, false], ['render', false, true, true, true]]);
  } finally {
    CZYSZCZENIE_AB.pomocnicze = true;
  }
});
