// Tło menu głównego — Ziemia z ringiem „Halo” (2026-09-26; port WebGPU — zadanie 11): wypożyczenie ringu
// gry na czas menu (bez drugiego ringu), materiały tła w TSL (bez GLSL), rozgrzewka pipeline'ów na
// PRAWDZIWYCH obiektach — pieczenie map (te same materiały i cele co bake), bryły ringu przed podpięciem
// (hak prewarm budowy → Core3D.warmup), Ziemia i niebo przed pierwszą klatką menu — własna warstwa
// i render przez post Core3D, wpięcie w index.html, oraz halo (poświata limbu) Ziemi i Marsa w grze
// z tego samego modelu atmosfery co w menu. Bez GPU.
// node --test tests/menuBackdrop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { HaloRingGame, HALO_GAME } from '../src/3d/haloRing/haloRingGame.js';
import { createHaloRing } from '../src/3d/haloRing/index.js';
import { createArchRing } from '../src/3d/haloRing/arch/archRing.js';
import { HaloWorldMaps } from '../src/3d/haloRing/haloRingWorldGen.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { HALO_QUALITY } from '../src/3d/haloRing/haloRingConfig.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';
import { Core3D, MENU_BACKDROP_LAYER } from '../src/3d/core3d.js';
import { MENU_SHOT } from '../src/3d/menuBackdrop3D.js';
import { createMenuAtmosphereMaterial, createMenuEarthMaterial, createMenuSkyMaterial } from '../src/3d/menuBackdrop3D.tsl.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const fakeScene = () => ({ add() {}, remove() {} });

function fakeRing() {
  const calls = { layers: [], cuts: [] };
  return {
    calls,
    group: { visible: true },
    setLayers(map) { calls.layers.push({ ...map }); },
    setCutaway(index, cut) { calls.cuts.push([index, cut]); }
  };
}

// Atrapa renderera do budowy ringu Ziemi (jak tests/haloRingAsync.test.mjs): kompilacja, render, odczyt.
function fakeRenderer() {
  const calls = [];
  let target = null;
  return {
    calls,
    autoClear: true,
    async init() {},
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    async compileAsync(scene) { calls.push(['compile', target?.texture?.type, scene.children?.[0]?.material?.name]); },
    render(scene) { calls.push(['render', target?.texture?.type, scene.children?.[0]?.material?.name]); },
    async readRenderTargetPixelsAsync(rt, x, y, w, h) {
      calls.push(['read']);
      const rowElems = Math.ceil(w * 16 / 256) * 64;
      const out = new Float32Array((h - 1) * rowElems + w * 4);
      for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) out[r * rowElems + i * 4] = 50 + r;
      return out;
    }
  };
}

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgslRenderer = new THREE.WebGPURenderer({ canvas });
wgslRenderer.hasFeature = () => false;
function buildWGSL(material, geometry = new THREE.SphereGeometry(1, 8, 6)) {
  const b = wgslRenderer.backend.createNodeBuilder(new THREE.Mesh(geometry, material), wgslRenderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const linearTexture = () => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
};

test('showcase: menu dostaje ring gry, release oddaje go z warstwami gry, bez wycięć i schowany', () => {
  const game = new HaloRingGame({ planets: [EARTH], renderer: {}, scene: fakeScene() });
  const entry = game.entries[0];
  const ring = fakeRing();
  entry.ring = ring; // budowa ringu wymaga GPU — tu gotowy
  entry.sunAz = 1.23;
  assert.equal(game.showcaseRing('earth'), ring, 'ten sam ring co w grze (bez drugiego bake’u)');
  assert.equal(game.showcaseRing('venus'), null);
  game.releaseShowcase('earth');
  assert.deepEqual(ring.calls.layers.at(-1), { ...HALO_GAME.layers }, 'warstwy passów gry');
  assert.deepEqual(ring.calls.cuts, [[0, null], [1, null]]);
  assert.equal(ring.group.visible, false, 'widoczność ustawi pierwszy update() gry');
  assert.ok(Number.isNaN(entry.sunAz), 'słońce gry nałoży się przy pierwszym update()');
  // menu przerwane przed budową ringu: release bez wyjątku
  const early = new HaloRingGame({ planets: [EARTH], renderer: {}, scene: fakeScene() });
  assert.doesNotThrow(() => early.releaseShowcase('earth'));
  // bez drugiego ringu: tło bierze ring przez showcaseRing i oddaje releaseShowcase
  const src = read('src/3d/menuBackdrop3D.js');
  assert.match(src, /this\.haloRings\.showcaseRing\(this\.planetKey\)/);
  assert.match(src, /this\.haloRings\?\.releaseShowcase\(this\.planetKey\)/);
  assert.doesNotMatch(src, /createHaloRing|createArchRing/, 'tło nie buduje własnego ringu');
});

test('rozgrzewka pieczenia: HaloWorldMaps.init kompiluje TE SAME materiały bake’u na PRAWDZIWYCH celach przed pierwszym bake’iem', async () => {
  // Port WebGPU: klucz pipeline'u zależy od formatu celu (rgba16float / rgba8unorm / rgba32float),
  // więc kompilacja na kanwie nic nie daje; dawna scena rozgrzewki tła (createHaloBakeWarmup) usunięta.
  const renderer = fakeRenderer();
  const maps = new HaloWorldMaps(renderer, createHaloRingLayout({}), HALO_QUALITY.low);
  const compiled = [];
  const origCompile = renderer.compileAsync;
  renderer.compileAsync = async (scene, camera) => {
    compiled.push({ material: scene.children[0].material, target: renderer.getRenderTarget(), camera });
    return origCompile(scene, camera);
  };
  await maps.init();
  const calls = renderer.calls;
  const firstRender = calls.findIndex((c) => c[0] === 'render');
  assert.equal(compiled.length, 4, 'A (mapa i odczyt), B, C');
  assert.ok(calls.findLastIndex((c) => c[0] === 'compile') < firstRender, 'kompilacja przed bake');
  // te same instancje materiałów i scena bake'u (klucz pipeline'u = materiał + cel)
  assert.deepEqual(compiled.map((c) => c.material), [maps.materials.A, maps.materials.B, maps.materials.C, maps.materials.A]);
  assert.ok(compiled.every((c) => c.camera === maps.camera));
  assert.deepEqual(compiled.map((c) => c.target), [maps.low.A, maps.low.B, maps.low.C, maps.readTarget], 'prawdziwe cele bake’u i odczytu');
  assert.ok(maps.cpu, 'mapa CPU po odczycie');
  maps.dispose();
  const worldGen = read('src/3d/haloRing/haloRingWorldGen.js');
  assert.doesNotMatch(worldGen, /export function createHaloBakeWarmup/);
});

test('bryły ringu Ziemi: hak prewarm dostaje te obiekty, które potem trafiają do group — przed podpięciem, ready czeka na rozgrzewkę', async () => {
  const warmCalls = [];
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const ring = createHaloRing({
    renderer: fakeRenderer(), planetRadius: 37800, seed: 1337, quality: 'low',
    prewarm: (objects, opts) => {
      warmCalls.push({ objects, opts, attachedAtCall: ring.group.children.length, parents: objects.map((o) => o.parent) });
      return gate;
    }
  });
  // do chwili, gdy host skończy rozgrzewkę: ring niegotowy, bryły poza grupą
  for (let i = 0; i < 200 && warmCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(warmCalls.length >= 2, 'bryły + drugi stan dachu K-7');
  const main = warmCalls[0];
  assert.equal(main.attachedAtCall, 0, 'rozgrzewka PRZED podpięciem brył');
  assert.ok(main.parents.every((p) => p === null), 'obiekty jeszcze bez rodzica');
  assert.equal(typeof main.opts.alive, 'function');
  assert.equal(main.opts.alive(), true);
  assert.equal(ring.isReady, false);
  assert.equal(ring.group.children.length, 0);
  // dach hal K-7 w stanie „statek w hali”: wariant przełącza materiał i przywraca go
  const roof = warmCalls.find((c) => c.opts.variant);
  assert.ok(roof && roof.objects.length > 0);
  const mesh = roof.objects[0];
  const before = [mesh.material.transparent, mesh.material.depthWrite];
  const restore = roof.opts.variant.apply(mesh);
  assert.deepEqual([mesh.material.transparent, mesh.material.depthWrite], [true, false]);
  restore();
  assert.deepEqual([mesh.material.transparent, mesh.material.depthWrite], before);
  release(true);
  assert.equal(await ring.ready, true);
  assert.equal(ring.isReady, true);
  // te same obiekty są teraz w grupie ringu
  for (const o of main.objects) assert.equal(o.parent, ring.group);
  assert.equal(ring.group.children.length, main.objects.length);
  ring.dispose();
  assert.equal(main.opts.alive(), false, 'po dispose zadania rozgrzewki przepadają');
});

// Atrapa DOM dla budowy ringu-archetypu w Node (atlasy napisów K-7 i tablic rysowane na kanwie 2D).
function withFakeCanvasDocument(fn) {
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 8 })
      : k === 'getImageData' || k === 'createImageData' ? (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h })
        : () => {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  const prev = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx }) };
  try { return fn(); } finally { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; }
}

test('ring-archetyp (Mars): bryły w grupie dopiero po rozgrzewce, mapsReady = podpięte; bez haka od razu', async () => {
  const opts = { planetRadius: RING_PLANET_WORLD_RADII.mars, seed: HALO_RING_PLANETS.mars.seed, profile: 'mars', quality: 'low' };
  const createArch = (o) => withFakeCanvasDocument(() => createArchRing(o));
  const resolvers = [];
  const release = (v) => { for (const r of resolvers.splice(0)) r(v); };
  const warmed = [];
  const ring = createArch({ ...opts, prewarm: (objects, o) => { warmed.push({ objects, o }); return new Promise((r) => { resolvers.push(r); }); } });
  assert.equal(ring.group.children.length, 0, 'bryły czekają na rozgrzewkę');
  assert.equal(ring.mapsReady, false);
  assert.equal(ring.isReady, false);
  assert.ok(warmed[0].objects.length > 0 && ring.k7Halls.length === 4);
  assert.ok(warmed.some((w) => w.o.variant), 'dach K-7 w drugim stanie');
  assert.ok(Number.isFinite(ring.terrainHeightAt(ring.layout.radii.floorMid, 0, 0)), 'teren CPU od razu (plan na CPU)');
  release(true);
  for (const w of warmed) w.o.alive(); // wszystkie zadania jeszcze żywe
  assert.equal(await ring.ready, true);
  assert.equal(ring.mapsReady, true);
  assert.equal(ring.group.children.length, warmed[0].objects.length);
  ring.dispose();
  const plain = createArch(opts);
  assert.equal(plain.mapsReady, true, 'bez haka: jak dawniej, od razu');
  assert.ok(plain.group.children.length > 0);
  plain.dispose();
});

test('HaloRingGame: hak rozgrzewki idzie do Core3D.warmup (kamera ze wszystkimi warstwami); bez urządzenia — od razu', async () => {
  const src = read('src/3d/haloRing/haloRingGame.js');
  assert.match(src, /prewarm: \(objects, opts = \{\}\) => \(Core3D\.gpuReady && Core3D\.warmup\s*\n?\s*\? Core3D\.warmup\.now\(objects, \{ \.\.\.opts, layer: 'all' \}\)/);
  // w Node (bez urządzenia) ring buduje się bez rozgrzewki i zgłasza gotowość
  const game = new HaloRingGame({ planets: [EARTH], renderer: fakeRenderer(), scene: fakeScene(), quality: 'low' });
  const ring = game.showcaseRing('earth');
  assert.equal(await ring.ready, true);
  game.dispose();
});

test('materiały tła w TSL: Ziemia, poświata limbu i niebo budują WGSL (cień ringu z biblioteki ringu), bez GLSL', () => {
  const layout = createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII.earth, seed: HALO_RING_PLANETS.earth.seed, profile: 'earth' });
  const ring = { layout, uniforms: createHaloUniforms(layout) };
  const tex = { day: linearTexture(), night: linearTexture(), spec: linearTexture(), normal: linearTexture(), clouds: linearTexture() };
  const earth = createMenuEarthMaterial(ring, tex);
  const atm = createMenuAtmosphereMaterial(ring, layout.planetRadius + 1250);
  const sky = createMenuSkyMaterial({ nebulaMap: linearTexture(), sunCore: 10 });
  const E = buildWGSL(earth.material);
  const A = buildWGSL(atm.material);
  const S = buildWGSL(sky.material);
  // cień ringu na planecie i w poświacie: funkcja WGSL biblioteki ringu (parametry-uniformy)
  assert.match(E.fragment, /fn haloRingBlock \(/);
  assert.match(A.fragment, /fn haloRingBlock \(/);
  // chmury z gradientami nieprzesuniętego uv (bez szwu mipmap), pochodne w jednolitym przepływie
  assert.equal((E.fragment.match(/textureSampleGrad/g) || []).length, 2);
  // Fresnel (1 − cos)^5 mnożeniem — pow z ujemną podstawą to NaN w WGSL
  assert.doesNotMatch(E.fragment, /pow\([^)]*5\.0 \)/);
  // poświata: discard poza powłoką i za tarczą planety, stan jak dawny ShaderMaterial
  assert.match(A.fragment, /discard/);
  assert.equal(atm.material.side, THREE.BackSide);
  assert.equal(atm.material.blending, THREE.AdditiveBlending);
  assert.equal(atm.material.transparent, true);
  assert.equal(atm.material.depthWrite, false);
  // niebo: z = w (nieskończoność), bez testu głębi; mgławica z poziomu 0 (minFilter LinearFilter w WebGL =
  // sam poziom 0; three r183 na WebGPU i tak robi mipmapy) — próbka bez pochodnych, poprawna w gałęzi
  assert.match(S.vertex, /vec4<f32>\( (\w+)\.x, \1\.y, \1\.w, \1\.w \)/);
  assert.match(S.fragment, /textureSampleLevel\(/);
  assert.doesNotMatch(S.fragment, /textureSample\(|textureSampleGrad\(/);
  assert.equal(sky.material.side, THREE.BackSide);
  assert.equal(sky.material.depthTest, false);
  assert.equal(sky.material.depthWrite, false);
  // uniformy aktualizowane przez kod tła (.value)
  for (const k of ['uLocal', 'uCloudShift']) assert.ok(earth.uniforms[k] && 'value' in earth.uniforms[k]);
  for (const k of ['uSunDir', 'uSunCore', 'uStars', 'uNebulaGain', 'uNebC', 'uNebR', 'uNebU', 'uNebHalf']) assert.ok(sky.uniforms[k] && 'value' in sky.uniforms[k], k);
  // bez GLSL i ShaderMaterial w tle menu; biblioteka GLSL ringu nie jest czytana
  const src = read('src/3d/menuBackdrop3D.js') + read('src/3d/menuBackdrop3D.tsl.js');
  assert.doesNotMatch(src, /\/\* glsl \*\/|gl_FragColor|new THREE\.ShaderMaterial|RawShaderMaterial|from '[^']*haloRingGLSL\.js'/);
});

test('tło menu: własna warstwa i render przez post Core3D, bez własnego renderera; start czeka na ring i rozgrzewkę', () => {
  const core = read('src/3d/core3d.js');
  assert.equal(MENU_BACKDROP_LAYER, 9);
  for (const m of core.matchAll(/const\s+\w+_RENDER_LAYER\s*=\s*(\d+)/g)) {
    assert.notEqual(Number(m[1]), MENU_BACKDROP_LAYER, 'warstwa zajęta przez pass gry');
  }
  const body = core.slice(core.indexOf('renderBackdrop(camera) {'));
  // Port WebGPU: post to RenderPipeline (_renderPost — bloom, ACES gry + sRGB), ten sam co w grze.
  assert.match(body, /camera\.layers\.set\(MENU_BACKDROP_LAYER\)[\s\S]*?renderer\.setRenderTarget\(null\);\s*this\._renderPost\(\);/, 'scena → post jak w grze');
  assert.doesNotMatch(core, /_postPasses/);
  // Tło czeka na urządzenie WebGPU (bez niego: menu z komunikatem, tło CSS).
  assert.match(body.slice(0, body.indexOf('\n  },')), /if \(!this\.isInitialized \|\| !this\.gpuReady \|\| !camera\) return;/);
  const src = read('src/3d/menuBackdrop3D.js');
  assert.doesNotMatch(src, /new\s+THREE\.WebGLRenderer|new\s+THREE\.WebGPURenderer|EffectComposer|UnrealBloomPass/);
  assert.match(src, /Core3D\.renderBackdrop\(cam\)/);
  const startAsync = src.slice(src.indexOf('async _startAsync() {'), src.indexOf('\n  }\n', src.indexOf('async _startAsync() {')));
  const at = (re) => startAsync.search(re);
  // urządzenie → ring (showcase) → Ziemia i niebo w rejestrze rozgrzewki (kamera kinowa, warstwa tła) →
  // ring gotowy (bryły rozgrzane i podpięte) → rozgrzewka tła → dopiero wtedy pętla renderu
  assert.ok(at(/await Core3D\.ready/) >= 0 && at(/await Core3D\.ready/) < at(/showcaseRing/));
  assert.match(startAsync, /Core3D\.warmup\.now\(\[o\.earthGroup, o\.sky\], \{[\s\S]*?camera: this\.camera, layer: MENU_BACKDROP_LAYER, alive: \(\) => this\.running/);
  assert.ok(at(/Core3D\.warmup\.now/) > at(/this\._build\(ring\)/), 'rozgrzewka prawdziwych obiektów tła');
  assert.ok(at(/await ring\.ready/) > at(/Core3D\.warmup\.now/), 'Ziemia i niebo kompilują się w czasie budowy ringu');
  assert.ok(at(/await ownWarm/) > at(/await ring\.ready/));
  assert.ok(at(/this\._live = true/) > at(/await ownWarm/), 'pierwsza klatka menu po rozgrzewce');
  assert.doesNotMatch(src, /compileAsync|createHaloBakeWarmup/);
  // tekstury Ziemi pożyczone od planety gry — tło zwalnia tylko własne
  assert.match(src, /for \(const tex of this\._ownTextures\) tex\.dispose\(\)/);
  assert.doesNotMatch(src, /this\._textures\.[a-z]+\.dispose\(\)/);
});

test('ujęcie menu: kamera poza ringiem i halami K-7 także po najeździe przy starcie gry', () => {
  const hallReach = 43752 + 9000; // obwiednia ringu Ziemi + hale K-7 (HALO_GAME.hallReach)
  const closest = MENU_SHOT.distance * Math.min(1, MENU_SHOT.launchDistanceMul);
  assert.ok(closest > hallReach * 1.5, `najbliżej ${closest} j.`);
  assert.ok(MENU_SHOT.shiftX > 0 && MENU_SHOT.shiftX < 0.35, 'planeta po prawej, menu po lewej');
  // Fabuła (2026-09-30): kadr na stronę Ziemi z halą K-7 (kamera intro leci stamtąd prosto nad halę) — kołysanie
  // zamiast pełnego obrotu, hala zostaje po stronie kamery.
  assert.ok(MENU_SHOT.swayDeg > 0 && MENU_SHOT.swayDeg + Math.abs(MENU_SHOT.hallAzimuthOffsetDeg) < 45, 'K-7 w kadrze');
  assert.ok(MENU_SHOT.swayPeriodSec >= 30, 'powolne kołysanie talerza');
  // intro kamery (scena `menu` harnessu = 150 klatek po gotowości) bez zmian
  assert.equal(MENU_SHOT.introSeconds, 7.5);
});

test('index.html: tło po initHaloRings, rozgrzewka na ekranie ładowania, ring wraca do gry przed jej pierwszą klatką', () => {
  const html = read('index.html');
  assert.match(html, /initHaloRings\(\);\s*applyHaloRingDevSpawn\(\);\s*startMenuBackdrop\(\);/);
  const start = html.slice(html.indexOf('async function startGame()'));
  const stopAt = start.indexOf('stopMenuBackdrop();');
  const loopAt = start.indexOf('requestAnimationFrame(loop);');
  const flushAt = start.indexOf('await Core3D.warmup?.flush(');
  assert.ok(stopAt > 0 && stopAt < loopAt, 'stopMenuBackdrop przed requestAnimationFrame(loop)');
  assert.ok(flushAt > start.indexOf('await waitForPlanetsReady();') && flushAt < loopAt, 'reszta kolejki rozgrzewki przed pierwszą klatką gry');
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/main-menu\.css">/);
  // id, których szuka JS menu i skrypty dymne (scripts/dym-gry-belki.mjs)
  for (const id of ['main-menu', 'menu-home-view', 'menu-options-view', 'menu-gamemode-view', 'menu-credits-view',
    'menu-keybinds-view', 'btn-new-game', 'btn-mode-single', 'btn-mode-split', 'btn-continue', 'btn-load-game',
    'btn-options', 'btn-editor', 'btn-keybinds', 'btn-credits', 'btn-options-back', 'btn-gamemode-back',
    'btn-keybinds-back', 'btn-credits-back', 'mm-hint', 'screen-fade']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const key of ['low', 'medium', 'high', 'ultra']) assert.match(html, new RegExp(`data-planet-q="${key}"`));
  for (const key of ['master', 'music', 'sfx']) assert.match(html, new RegExp(`data-audio="${key}"`));
  assert.match(html, /'sc_audio'/, 'zapis głośności w kluczach resetu');
  assert.equal(typeof Core3D.warmup?.flush, 'function');
});

test('halo Ziemi i Marsa w grze: poświata limbu z modelu atmosfery menu, gaśnie do zera na brzegu', () => {
  const src = read('src/3d/planet3d.assets.js');
  // Port WebGPU (zadanie 05): shader poświaty limbu to graf TSL (buildRingAtmosphereGraph, planet3d.assets.tsl.js).
  const tsl = read('src/3d/planet3d.assets.tsl.js');
  const frag = tsl.slice(tsl.indexOf('function buildRingAtmosphereGraph()'), tsl.indexOf('// ── Graf: słońce'));
  assert.ok(frag.includes('fragmentNode'), 'brak grafu poświaty limbu');
  assert.match(frag, /Discard\(rho\.greaterThanEqual\(U\.uRa\)\.or\(alpha\.lessThanEqual\(0\.001\)\)\);/);
  assert.match(frag, /sqrt\(max\(U\.uRa\.mul\(U\.uRa\)\.sub\(rho\.mul\(rho\)\), 0\.0\)\)/, 'cięciwa przez powłokę → 0 na jej brzegu (bez kropkowanej krawędzi)');
  assert.match(frag, /exp\(h\.negate\(\)\.div\(U\.uHs\)\)/);
  assert.match(frag, /const alpha = max\(glow\.r, max\(glow\.g, glow\.b\)\)/, 'alfa = max(rgb) przy blendzie ONE/ONE');
  assert.match(frag, /blendSrc: THREE\.OneFactor, blendDst: THREE\.OneFactor/, 'blend ONE/ONE jak dawne premultipliedAlpha + Additive');
  assert.doesNotMatch(frag, /hash12|fragCoord|screenCoordinate/);
  assert.match(src, /if \(this\.isRingAnchored\) \{[^}]*createRingAtmosphere\(name, resolveRingPlanetWorldRadius\(this\.data\)\)/);
  assert.match(src, /RING_ATMOSPHERE_TUNE = Object\.freeze\(\{\s*earth: Object\.freeze\(\{ height: 1250/, 'wysokość powłoki jak w tle menu (R + 1250)');
  assert.match(src, /atmU\.uSunDir\.value\.set\(dx \/ len, dy \/ len, 0\)/, 'słońce w płaszczyźnie gry');
});
