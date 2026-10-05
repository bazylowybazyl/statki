// Port WebGPU, zadanie 12-B: infrastruktura efektów GPU wpięta w Core3D (src/3d/fx/fxFrame.js) —
// klatka efektów (kolejność kroków, raz na klatkę, zegar, siatka świateł, światła efektów),
// kolejka źródeł zniekształceń (podzielony ekran, następna klatka), system oświetlenia renderera
// przed init(), „uber” ze źródłami efektów, warstwą DIST i siatką bezpieczeństwa NaN / Inf (WGSL
// budowany w Node), wpięcie w Core3D (źródło). Obraz na GPU: scripts/webgpu/efekty-kontrola.mjs.
// node --test tests/fxCore3D.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { texture } = await import('three/tsl');
const { FxFrame, FX_DISTORT_LAYER, FX_VIEW_MARGIN, FX_MAX_DT } = await import('../src/3d/fx/fxFrame.js');
const { GridLighting } = await import('../src/3d/fx/lightGrid.js');
const { SimClock } = await import('../src/game/simClock.js');
const { BloomGry, createPostUniforms, createUberPost, hdrBezpieczny } = await import('../src/3d/tsl/postGry.js');
const { DistortionField } = await import('../src/3d/fx/distortion.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const core = read('src/3d/core3d.js');
const bodyOf = (src, header) => {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `brak ${header}`);
  return src.slice(start, src.indexOf('\n  },', start));
};
const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

// Atrapa renderera: licznik klatek rAF i wywołań compute.
function fakeRenderer(frame = 1) {
  return { info: { frame, compute: { frameCalls: 0 } }, computed: [], compute(node, n) { this.computed.push([node, n]); this.info.compute.frameCalls++; } };
}
const cam = { x: 6_000_000, y: -2_000_000, zoom: 0.5 };

test('klatka efektów: raz na klatkę rAF, kolejność spawn → początek → przesunięcie → siatka → update', () => {
  const fx = new FxFrame();
  const r = fakeRenderer(7);
  fx.attach(r);
  const log = [];
  const kernel = { count: 32 };
  // żywa pula: przeskok początku po odjeździe kamery → kernel przesunięcia
  fx.origin.register({ shiftNode: kernel, isLive: () => true });
  fx.addStep({
    name: 'test',
    spawn: (ctx) => log.push(['spawn', ctx.origin.x]),
    lights: (ctx) => { log.push(['lights', ctx.grid.originX]); ctx.grid.addWorld(cam.x + 10, cam.y, 40, 300, 1, 1, 1); },
    update: (ctx) => log.push(['update', ctx.dt])
  });
  assert.equal(fx.frame(r, cam, null, 1920, 1080, false, 1000), true);
  assert.equal(fx.frame(r, cam, null, 1920, 1080, false, 1016), false, 'drugi render tej klatki (podzielony ekran) nic nie robi');
  assert.deepEqual(log.map((e) => e[0]), ['spawn', 'lights', 'update']);
  assert.equal(fx.origin.x, cam.x, 'początek przy kamerze (scena: x, −y świata)');
  assert.equal(fx.origin.y, -cam.y);
  assert.equal(log[1][1], fx.origin.x, 'siatka na początku pul');
  assert.equal(fx.stats.lights, 1);
  assert.ok(fx.stats.gridBuilt && fx.stats.gridItems > 0);
  // kamera odjeżdża o 30 tys. j. → przeskok, kernel wysłany RAZ, zanim kroki pul ruszą
  r.info.frame = 8;
  log.length = 0;
  const far = { ...cam, x: cam.x + 30_000 };
  fx.frame(r, far, null, 1920, 1080, false, 1016);
  assert.equal(r.computed.length, 1);
  assert.equal(r.computed[0][0], kernel);
  assert.equal(fx.stats.dispatches, 1, 'dispatche tej klatki (renderer.info.compute.frameCalls)');
  assert.equal(log[0][1], cam.x, 'spawn w starej ramie (przed przeskokiem)');
  close(log[2][1], 0.016, 1e-9, 'dt z zegara klatki');
  // zegar efektów: krok ≤ FX_MAX_DT (przestój karty nie przeskakuje efektów o sekundy)
  r.info.frame = 9;
  fx.frame(r, far, null, 1920, 1080, false, 5016);
  close(fx.dt, FX_MAX_DT, 1e-12);
  close(fx.time, 0.016 + FX_MAX_DT, 1e-9);
});

test('siatka świateł: kadr kamery (z zapasem, split = suma kadrów), pusta siatka bez budowy i wysyłki', () => {
  const fx = new FxFrame();
  const r = fakeRenderer(1);
  fx.frame(r, cam, null, 1920, 1080, false, 0);
  const hw = 960 / cam.zoom * (1 + FX_VIEW_MARGIN);
  close(fx.view.x0, cam.x - hw, 1e-6);
  close(fx.view.x1, cam.x + hw, 1e-6);
  assert.equal(fx.stats.gridBuilt, false, 'pusta siatka — bez budowy');
  // podzielony ekran: gracz 2 daleko w prawo → kadr obejmuje oba
  const cam2 = { x: cam.x + 20_000, y: cam.y + 5_000, zoom: 1 };
  r.info.frame = 2;
  fx.frame(r, cam, cam2, 1920, 1080, false, 16);
  close(fx.view.x1, cam2.x + 960 * (1 + FX_VIEW_MARGIN), 1e-6);
  close(fx.view.y1, cam2.y + 540 * (1 + FX_VIEW_MARGIN), 1e-6);
  // światło → budowa; potem jedna budowa czyszcząca i znów nic
  fx.lights.point(cam.x, cam.y, 1, 1, 1, 2, 200, 40);
  r.info.frame = 3;
  fx.frame(r, cam, null, 1920, 1080, false, 32);
  assert.equal(fx.stats.lights, 1);
  assert.equal(fx.stats.gridBuilt, true);
  r.info.frame = 4;
  fx.frame(r, cam, null, 1920, 1080, false, 48);
  assert.equal(fx.stats.gridBuilt, true, 'klatka po świetle czyści listy komórek');
  assert.equal(fx.grid.stats.items, 0);
  r.info.frame = 5;
  fx.frame(r, cam, null, 1920, 1080, false, 64);
  assert.equal(fx.stats.gridBuilt, false);
});

test('światła efektów: błysk z tej klatki świeci od wieku 0 (starzenie po zapisie), gaśnie po życiu', () => {
  SimClock.reset();
  const fx = new FxFrame();
  const r = fakeRenderer(1);
  fx.frame(r, cam, null, 1920, 1080, false, 0);
  // błysk 1,0 moc, zanik (1 − u)², życie 0,1 s — zgłoszony przed renderem klatki
  fx.lights.flash(cam.x, cam.y, 1, 1, 1, 1, 300, 0.1, 2, 0, 40);
  r.info.frame = 2;
  fx.frame(r, cam, null, 1920, 1080, false, 50);
  const L = fx.grid.lights;
  close(L[4], 1, 1e-6, 'pełna moc w klatce narodzin');
  r.info.frame = 3;
  fx.frame(r, cam, null, 1920, 1080, false, 100);
  close(L[4], (1 - 0.05 / 0.1) ** 2, 1e-4, 'wiek = dt poprzedniej klatki');
  r.info.frame = 4;
  fx.frame(r, cam, null, 1920, 1080, false, 150);
  assert.equal(fx.stats.lights, 0, 'wygasł');
});

// Bez obiektów na klatkę / światło. Zostaje pakowanie liczb double przez V8 przy wywołaniach
// nieinlinowanych (uniform.value = liczba, argumenty addWorld) — kilkanaście B na światło, ~150 B
// stałe na klatkę; próg łapie alokację obiektu na światło (≥ 40 B × 18 świateł na klatkę).
test('klatka efektów ze światłami i źródłami: bez obiektów na klatkę (zakresy wysyłki siatki na stałe)', async () => {
  const v8 = await import('node:v8');
  const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
  const allocatedBytes = (fn, n) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = newSpaceUsed();
      for (let i = 0; i < n; i++) fn(i);
      const delta = newSpaceUsed() - before;
      if (delta >= 0) return delta;
    }
    return Infinity;
  };
  const fx = new FxFrame();
  const r = fakeRenderer(1);
  fx.attach(r);
  const step = { name: 'swiatla', lights: (ctx) => { for (let k = 0; k < 16; k++) ctx.grid.addWorld(cam.x + k * 40, cam.y, 60, 300, 1, 0.5, 0.2, 0.5); } };
  fx.addStep(step);
  let t = 0;
  const frame = (i) => {
    r.info.frame++;
    t += 16;
    if ((i & 7) === 0) fx.lights.flash(cam.x, cam.y + 50, 1, 1, 1, 2, 250, 0.2, 2, 0.3, 40);
    fx.lights.point(cam.x - 60, cam.y, 1, 0.8, 0.5, 1, 200, 30);
    fx.distortionSources().shock(cam.x, cam.y, 200, 40, 6);
    fx.frame(r, cam, null, 1920, 1080, false, t);
    fx.commitDistortion(cam, 1920, 1080, false, r.info.frame);
  };
  for (let i = 0; i < 20000; i++) frame(i);
  assert.ok(fx.stats.gridBuilt && fx.stats.lights >= 17);
  const base = allocatedBytes(() => {}, 3000);
  const used = allocatedBytes(frame, 3000);
  assert.ok((used - base) / 3000 < 700, `klatka efektów: ${((used - base) / 3000).toFixed(0)} B na klatkę (18 świateł, 1 źródło)`);
  assert.deepEqual(fx.grid.lightNode.value.updateRanges, [{ start: 0, count: fx.stats.lights * 16 }]);
});

test('zniekształcenia: kolejka żyje do końca klatki (podzielony ekran), zgłoszenie po renderze zaczyna nową', () => {
  const fx = new FxFrame();
  const F = fx.distortionSources();
  // nagłówek ważny od startu (rozmiar ≥ 1 — „uber” dzieli przez rozmiar)
  assert.deepEqual(F.array[1].toArray().slice(0, 2), [1, 1]);
  F.shock(cam.x, cam.y, 200, 40, 10);
  assert.equal(fx.commitDistortion(cam, 1920, 1080, false, 1), 1);
  assert.equal(fx.commitDistortion({ ...cam, x: cam.x + 100 }, 1920, 1080, false, 1), 1, 'druga połowa ekranu tej klatki');
  close(F.array[2].x, -100 * cam.zoom, 1e-9, 'rzut na kamerę drugiego renderu');
  // następna klatka bez zgłoszeń → zero źródeł
  assert.equal(fx.commitDistortion(cam, 1920, 1080, false, 2), 0);
  // zgłoszenie po renderze kasuje starą kolejkę
  fx.distortionSources().implode(cam.x, cam.y, 100, 5);
  fx.distortionSources().heat(cam.x, cam.y, 80, 3);
  assert.equal(fx.commitDistortion(cam, 1920, 1080, false, 3), 2);
  // wyłączone (wolna kamera, tło menu): 0 źródeł i włącznik 0
  fx.distortionSources().shock(cam.x, cam.y, 200, 40, 10);
  assert.equal(fx.commitDistortion(cam, 1920, 1080, true, 4), 0);
  assert.equal(F.array[0].z, 0);
  assert.equal(fx.stats.distortSources, 0);
});

test('kroki: rozgrzewka przy gotowym urządzeniu (raz), rejestracja po starcie rozgrzewa od razu', () => {
  const fx = new FxFrame();
  const r = fakeRenderer(1);
  fx.attach(r);
  let warm = 0;
  const a = { name: 'a', warm: () => warm++ };
  fx.addStep(a);
  assert.equal(warm, 0, 'urządzenie jeszcze niegotowe');
  fx.warmAll();
  assert.equal(warm, 1);
  fx.warmAll();
  assert.equal(warm, 1, 'raz');
  const b = { name: 'b', warm: (ctx) => { warm += 10; assert.equal(ctx.renderer, r); } };
  fx.addStep(b);
  assert.equal(warm, 11);
  // kernele przesunięcia pul (zerowe przesunięcie nic nie zmienia) — rozgrzane przy warmAll
  const kernel = { count: 8 };
  const fx2 = new FxFrame();
  const r2 = fakeRenderer(1);
  fx2.attach(r2);
  fx2.origin.register({ shiftNode: kernel, isLive: () => true });
  fx2.warmAll();
  assert.deepEqual(r2.computed, [[kernel, 1]]);
  // pula zarejestrowana PO warmAll (iskry pasa na ekranie ładowania, zadanie 11): jej kernel rozgrzewa
  // rejestracja kroku; uniform przesunięcia na czas rozgrzewki zero, potem wraca
  const late = { count: 4 };
  fx2.origin.register({ shiftNode: late, isLive: () => true });
  fx2.origin.shift.value.set(3, 4, 5, 6);
  let seen = null;
  const compute = r2.compute;
  r2.compute = function (node, n) { if (node === late) seen = fx2.origin.shift.value.toArray(); return compute.call(this, node, n); };
  fx2.addStep({ name: 'pas', warm: () => {} });
  assert.deepEqual(r2.computed.at(-1), [late, 1]);
  assert.deepEqual(seen, [0, 0, 0, 0]);
  assert.deepEqual(fx2.origin.shift.value.toArray(), [3, 4, 5, 6]);
  fx.removeStep(a);
  assert.deepEqual(fx.steps, [b]);
});

test('system oświetlenia: GridLighting „optIn” ustawiany PRZED renderer.init() (three r183 łapie go w init)', () => {
  const fx = new FxFrame();
  const r = { info: { frame: 0 } };
  fx.attach(r);
  assert.ok(r.lighting instanceof GridLighting);
  assert.equal(r.lighting.mode, 'optIn');
  assert.equal(r.lighting.grid, fx.grid);
  // three r183: Renderer.init() tworzy RenderLists(this.lighting) — późniejsza podmiana nic nie zmienia
  const three = readFileSync(new URL('../node_modules/three/src/renderers/common/Renderer.js', import.meta.url), 'utf8');
  assert.match(three, /this\._renderLists = new RenderLists\( this\.lighting \);/, 'three łapie lighting w init — sprawdź, czy dalej trzeba ustawiać przed init');
  const init = bodyOf(core, '  async _initGpu() {');
  assert.ok(init.indexOf('this.fx?.attach(renderer, this);') > 0);
  assert.ok(init.indexOf('this.fx?.attach(renderer, this);') < init.indexOf('await renderer.init();'), 'attach przed init');
  assert.ok(init.indexOf('this.fx?.warmAll();') > init.indexOf('this.gpuReady = true;'), 'rozgrzewka kroków przy gotowym urządzeniu');
});

// ── „uber” (WGSL w Node) ──────────────────────────────────────────────────────
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

test('„uber” 12-B: blok źródeł zniekształceń i warstwa DIST w gałęzi, stara ścieżka nietknięta, siatka NaN / Inf', () => {
  const rt = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const dist = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, format: THREE.RGFormat });
  const bloom = new BloomGry(hdrBezpieczny(texture(rt.texture)), 0.85, 0.4, 0.9);
  const F = new DistortionField({ name: 'fxDistort' });
  const m = new THREE.NodeMaterial();
  m.fragmentNode = createUberPost({ sceneTexture: rt.texture, bloomTexture: bloom.getTextureNode(), uniforms: createPostUniforms(), distortion: F.node, distortionLayer: dist.texture });
  const w = buildWGSL(m);
  // bufory uniformów: obiekt + 2 tablice gorącego powietrza + blok mgły wojny + blok źródeł + grupa renderu (rulon warpa)
  // (limit 12)
  assert.equal((w.match(/var<uniform>/g) || []).length, 6);
  assert.equal((w.match(/var<uniform> fxDistort\b/g) || []).length, 1);
  assert.equal((w.match(/texture_2d<f32>/g) || []).length, 3, 'scena, bloom, warstwa DIST');
  assert.doesNotMatch(w, /textureSample\(/, 'wszystkie odczyty z poziomem 0 (gałęzie zależne od piksela)');
  // gałąź efektów tylko przy źródłach albo warstwie; bez nich dawna ścieżka dysz
  assert.match(w, /if \( \( \( fxDistort\.value\[ 0u \]\.x > 0\.5 \) \|\| nodeVar\d+ \) \) \{/);
  assert.match(w, /for \( var distortItem : i32 = 0; distortItem < i32\( nodeVar\d+\.x \)/);
  assert.match(w, /\} else \{\s*if \( \( dot\( nodeVar3, nodeVar3 \) > 1e-12 \) \) \{/, 'else = stara gałąź dysz (02)');
  // warstwa DIST: px osi sceny → UV (x ujemne, y bez zmiany — y ekranu w dół), rozmiar z nagłówka
  assert.match(w, /vec2<f32>\( \( - nodeVar\d+\.x \), nodeVar\d+\.y \) \/ nodeVar\d+ \)/);
  assert.match(w, /= max\( fxDistort\.value\[ 1u \]\.xy, vec2<f32>\( 1\.0, 1\.0 \) \);/);
  // aberracja warstwy ×1,12 / ×0,88 (±0,12 · przesunięcie) z sufitem LAYER_ABER_MAX_PX (poniżej — × 1, bit w bit jak
  // wcześniej); na heksach-ekranach maskowania (B / A warstwy) zamiast niej stałe rozszczepienie
  assert.match(w, /(nodeVar\d+) = \( nodeVar\d+ \* vec2<f32>\( 0\.12 \) \);\s*\1 = \( \1 \* vec2<f32>\( min\( 1\.0, \( 2\.5 \/ max\( length\( \( \1 \* nodeVar\d+ \) \), 0\.000001 \) \) \) \) \);/);
  // (refrakcja maskowania — B < 0 — bez rozszczepienia: × 0)
  assert.match(w, /if \( \( nodeVar\d+\.z < -0\.0002 \) \) \{/);
  assert.match(w, /\( \( nodeVar\d+ \* vec2<f32>\( \( 1\.0 - nodeVar\d+ \) \) \) \* vec2<f32>\( nodeVar\d+ \) \) \+ vec2<f32>\( \( \( nodeVar\d+ \* 1\.2 \) \/ nodeVar\d+\.x \), 0\.0 \)/);
  // siatka bezpieczeństwa: czysta funkcja, bity wykładnika, na KAŻDYM odczycie sceny
  const safe = fnBody(w, 'hdrBezpieczny');
  assert.match(safe, /fn hdrBezpieczny \( c : vec4<f32> \) -> vec4<f32>/);
  assert.match(safe, /bitcast<vec4<u32>>\( c \)/);
  assert.equal((safe.match(/& 2139095040u \) == 2139095040u/g) || []).length, 4);
  assert.doesNotMatch(safe, /object\.|render\.|NodeBuffer|fxDistort/, 'bez uniformów (setLayout — błąd r183)');
  const sceneReads = (w.match(/textureSampleLevel\( nodeUniform(\d+), nodeUniform\d+_sampler/g) || []);
  assert.ok(sceneReads.length >= 7);
  assert.equal((w.match(/= hdrBezpieczny\( nodeVar\d+ \);/g) || []).length, 8, 'każdy odczyt sceny: ścieżka efektów (3 + 1) i dawna ścieżka dysz (3 + 1)');
});

test('„uber” bez bloku efektów (np. testy 02) — kod jak przed 12-B, siatka NaN tylko na odczycie sceny', () => {
  const rt = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const m = new THREE.NodeMaterial();
  m.fragmentNode = createUberPost({ sceneTexture: rt.texture, bloomTexture: null, uniforms: createPostUniforms() });
  const w = buildWGSL(m);
  assert.equal((w.match(/var<uniform>/g) || []).length, 5);   // + blok mgły wojny, grupa renderu (rulon warpa)
  assert.doesNotMatch(w, /fxDistort|distortItem/);
  assert.equal((w.match(/texture_2d<f32>/g) || []).length, 1);
});

test('Core3D: wpięcie klatki efektów, zniekształceń, warstwy DIST i rozgrzewki (źródło)', () => {
  const render = bodyOf(core, '\n  render() {');
  const at = (s) => render.indexOf(s);
  assert.ok(at('this._beginRenderInfo();') > 0 && at('this._runFxFrame(freePerspective);') > at('this._beginRenderInfo();'), 'klatka efektów po wyzerowaniu liczników');
  assert.ok(at('this._runFxFrame(freePerspective);') < at('this._runScenePass(pass, freePerspective)'), 'przed passami scen');
  assert.ok(at('this._renderFxDistortion(freePerspective || t.fxDistortion === false);') > at('this._runScenePass(pass, freePerspective)'));
  assert.ok(at('this._renderFxDistortion(') < at('this._renderPost();'), 'źródła i warstwa przed postem');
  const backdrop = bodyOf(core, '\n  renderBackdrop(camera) {');
  assert.match(backdrop, /this\._renderFxDistortion\(true\);\s*this\._updatePostUniforms\(false, 0\);/, 'tło menu bez zniekształceń');
  const dist = bodyOf(core, '  _renderFxDistortion(off) {');
  assert.match(dist, /camera\.layers\.set\(FX_DISTORT_LAYER\);/);
  assert.match(dist, /renderer\.setRenderTarget\(target\);/);
  assert.match(dist, /u\.uDistLayerOn\.value = layerOn \? 1 : 0;/);
  assert.match(dist, /fx\.distortLayerActive === true/, 'tylko gdy właściciel zgłosił zawartość');
  const create = bodyOf(core, '  _createPost(renderer) {');
  assert.equal((create.match(/distortion, distortionLayer \}\)\)/g) || []).length, 2, 'oba pipeline’y postu z blokiem i warstwą');
  const prewarm = bodyOf(core, '  prewarmPass(object3d, layer = 0, opts = {}) {');
  assert.match(prewarm, /if \(layer === FX_DISTORT_LAYER && this\.distortionTarget\) renderer\.setRenderTarget\(this\.distortionTarget\);/, 'warstwa DIST rozgrzewana na własnym celu (inny klucz pipeline’u)');
  assert.match(bodyOf(core, '  resize(w, h) {'), /resizeRenderTarget\(this\.distortionTarget, bufW, bufH, readyRenderer\)/);
  assert.equal(FX_DISTORT_LAYER, 10, 'warstwa 8 = nowy warp, 9 = tło menu');
});
