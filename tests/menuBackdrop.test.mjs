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
import { HaloRingWorld } from '../src/game/haloRingWorld.js';
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
import { MENU_SHOT, MenuBackdrop3D } from '../src/3d/menuBackdrop3D.js';
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
  const game = new HaloRingGame({ world: new HaloRingWorld({ planets: [EARTH] }), renderer: {}, scene: fakeScene() });
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
  const early = new HaloRingGame({ world: new HaloRingWorld({ planets: [EARTH] }), renderer: {}, scene: fakeScene() });
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
  // do chwili, gdy host skończy rozgrzewkę: ring niegotowy, bryły poza grupą. Czekamy na hak (oba wywołania idą
  // w jednym zadaniu — prewarmParts); limit ~30 s tylko na wypadek, gdy nie przyjdzie wcale — budowa ringu na
  // obciążonej maszynie trwa dłużej niż dawne 200 × 5 ms
  for (let i = 0; i < 6000 && warmCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
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
  const game = new HaloRingGame({ world: new HaloRingWorld({ planets: [EARTH] }), renderer: fakeRenderer(), scene: fakeScene(), quality: 'low' });
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
  // wielki gryz (earthBite.tsl.js): kula z wycięciem, łata i poświata z wcięciem budują WGSL
  for (const pitMode of [1, 2]) {
    const m = createMenuEarthMaterial(ring, tex, { pitMode, shared: earth.uniforms });
    assert.match(buildWGSL(m.material).fragment, /fn earthBiteCoords \(/, `pitMode ${pitMode}`);
    assert.equal(m.uniforms.uBite, earth.uniforms.uBite, 'środek gryzu wspólny z kulą');
  }
  assert.match(buildWGSL(createMenuAtmosphereMaterial(ring, layout.planetRadius + 1250, { bite: true }).material).fragment, /fn earthBiteCoords \(/);
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

test('Ziemia tła 2026-10-31: gryz z elektrownią KOREK w kadrze na starcie, słońce gry — lot intro bez przesuwania słońca', async () => {
  // gryz na starcie: azymut środka gryzu w układzie ringu (siatka obrócona o π/2 wokół X, doba wokół Y) = azymut kamery
  // + biteAzimuthOffsetDeg, doba niesie go przez środek tarczy (wolniej niż dawniej: ~4 min na 50°)
  const { earthBiteFrame } = await import('../src/3d/earthBiteShape.js');
  const { EARTH_BITE } = await import('../src/data/earthBite.js');
  const { HALO_STATION_ANGLE } = await import('../src/3d/haloRing/haloRingConfig.js');
  const { menuBiteSpin, menuEarthAxis, menuEarthBase } = await import('../src/3d/menuBackdrop3D.js');
  const { earthSpinQuaternion } = await import('../src/3d/earthSpin.js');
  const { C } = earthBiteFrame(EARTH_BITE);
  const axis = menuEarthAxis();
  const base = menuEarthBase(axis);
  const group = new THREE.Group();
  group.rotation.x = Math.PI / 2;
  const earth = new THREE.Object3D();
  group.add(earth);
  const biteRing = (spin) => {
    earthSpinQuaternion(spin, axis, base, earth.quaternion);
    group.updateMatrixWorld(true);
    return new THREE.Vector3(C[0], C[1], C[2]).applyMatrix4(earth.matrixWorld);
  };
  const DEG = Math.PI / 180;
  const spin0 = menuBiteSpin(MENU_SHOT, axis);
  const p = biteRing(spin0);
  const want = HALO_STATION_ANGLE + (MENU_SHOT.hallAzimuthOffsetDeg + MENU_SHOT.biteAzimuthOffsetDeg) * DEG;
  const d = Math.atan2(Math.sin(Math.atan2(p.y, p.x) - want), Math.cos(Math.atan2(p.y, p.x) - want));
  assert.ok(Math.abs(d) < 1e-9, `gryz ${(Math.atan2(p.y, p.x) / DEG).toFixed(2)}° zamiast ${(want / DEG).toFixed(2)}°`);
  // środek elektrowni celuje w środek ringu (zgłoszenie 2026-10-31): oś obrotu tła przechylona o szerokość gryzu (10°),
  // środek gryzu na równiku obrotu — w płaszczyźnie ringu (z = 0) przy każdym kącie doby; bez gryzu oś = biegun
  assert.ok(Math.abs(Math.acos(axis.y) / DEG - EARTH_BITE.lat) < 1e-9, 'przechył osi = szerokość gryzu');
  assert.ok(Math.abs(axis.dot(new THREE.Vector3(C[0], C[1], C[2]))) < 1e-12);
  for (const s of [spin0, spin0 + 0.7, spin0 + 2.5, 5]) assert.ok(Math.abs(biteRing(s).z) < 1e-9, `kąt doby ${s}`);
  const b0 = menuEarthBase(new THREE.Vector3(0, 1, 0));
  assert.ok(Math.abs(Math.abs(b0.w) - 1) < 1e-12, 'oś = biegun: baza tożsamościowa (dawne rotation.y = kąt doby)');
  // elektrownia z osią ringu tła: przekaźnik odbiornik → ring wzdłuż osi gryzu (prosto w ścianę ringu, środek wstęgi),
  // liny wind omijają Ziemię i kończą się na szynie wokół osi tła, odbiornik z iglicami przed czaszą terminala
  const { createPlantLook } = await import('../src/3d/earthBitePlant.js');
  const { hubRelayDir } = await import('../src/3d/earthBitePlantOrbital.js');
  const { elevatorLayout } = await import('../src/3d/earthBitePlantElevators.js');
  const { PLANT_LAYOUT, plantRingAxis } = await import('../src/3d/earthBitePlantFrame.js');
  const look = createPlantLook({ ringAxis: axis.toArray(), hubRadius: 1.04 });
  assert.ok(plantRingAxis(look).distanceTo(axis) < 1e-12 && plantRingAxis(createPlantLook()).y > 0.999999, 'gra: oś bieguna');
  const relay = hubRelayDir(look, EARTH_BITE.radiusR);
  assert.ok(relay.y > 0.999999, `przekaźnik wzdłuż osi gryzu: ${relay.toArray()}`);
  const lay = elevatorLayout(look, EARTH_BITE.radiusR);
  assert.ok(lay.bundles.length >= 6 && lay.bundles.every((bd) => bd.clearsEarth), 'liny omijają Ziemię');
  assert.ok(lay.rail.axO.distanceTo(axis) < 1e-12);
  assert.ok(Math.abs(lay.terminal.obj.T.dot(axis)) < 1e-9, 'koniec przekaźnika w płaszczyźnie ringu');
  const tipR = look.hubRadius + look.hubSpireH;
  assert.ok(lay.terminal.obj.dish.length() - look.elevTermDishR - tipR > 0.008, 'iglice odbiornika przed czaszą terminala');
  assert.ok(tipR < PLANT_LAYOUT.ringInnerR - 0.02);
  // na prawo od środka tarczy, z dala od hali K-7 (kadr końca lotu intro z góry nad halą — bez gryzu); doba niesie go
  // ku brzegowi — na tarczy (< 75° od środka) kilka minut
  assert.ok(MENU_SHOT.biteAzimuthOffsetDeg > 0 && MENU_SHOT.biteAzimuthOffsetDeg <= 30, 'gryz w kadrze, na prawo od środka');
  assert.ok(Math.abs(MENU_SHOT.biteAzimuthOffsetDeg + MENU_SHOT.hallAzimuthOffsetDeg) >= 30, 'gryz ≥ 30° od hali K-7');
  assert.ok(MENU_SHOT.earthSpin > 0 && (75 - MENU_SHOT.biteAzimuthOffsetDeg) * DEG / MENU_SHOT.earthSpin > 240, 'kilka minut na tarczy');
  // ta sama Ziemia: stop() oddaje grze kąt doby i chmur (DirectPlanet.setSpin — tylko doba wokół osi ringu)
  assert.match(read('src/3d/menuBackdrop3D.js'), /const sg = this\._gameSpinAtCut\(o\);\s*this\._gameEarth\?\.setSpin\?\.\(sg, sg \+ o\.cloudSpin - o\.spin\)/);
  // kąt doby gry przy cięciu: grunt tła pod halą K-7 trafia pod halę w grze (Ziemia gry: Rx(π/2) · Ry(kąt))
  const fake = Object.create(MenuBackdrop3D.prototype);
  fake._q = new THREE.Quaternion();
  fake._p = new THREE.Vector3();
  fake.ring = null;
  const cutObj = { earthGroup: group, earth };
  for (const s of [spin0, spin0 + 1.3]) {
    earthSpinQuaternion(s, axis, base, earth.quaternion);
    const sg = fake._gameSpinAtCut(cutObj);
    const g = new THREE.Group();
    g.rotation.x = Math.PI / 2;
    const ge = new THREE.Object3D();
    ge.rotation.y = sg;
    g.add(ge);
    g.updateMatrixWorld(true);
    group.updateMatrixWorld(true);
    const hall = new THREE.Vector3(Math.cos(HALO_STATION_ANGLE), Math.sin(HALO_STATION_ANGLE), 0);
    const ground = hall.clone().applyMatrix4(new THREE.Matrix4().copy(earth.matrixWorld).invert());   // grunt tła pod halą
    const inGame = ground.applyMatrix4(ge.matrixWorld);
    const dAz = Math.atan2(inGame.y, inGame.x) - HALO_STATION_ANGLE;
    assert.ok(Math.abs(Math.atan2(Math.sin(dAz), Math.cos(dAz))) < 1e-9, 'długość pod halą zgodna');
    assert.ok(Math.abs(inGame.z) < Math.sin(EARTH_BITE.lat * DEG) + 1e-9, 'szerokość różni się o ≤ przechył');
  }
  // oś tła = biegun: dokładnie kąt doby tła
  earth.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
  const sgY = fake._gameSpinAtCut(cutObj);
  assert.ok(Math.abs(Math.atan2(Math.sin(sgY - 0.9), Math.cos(sgY - 0.9))) < 1e-9, String(sgY));
  const planets = read('src/3d/planet3d.assets.js');
  assert.match(planets, /setSpin\(spin, cloudSpin = spin\) \{\n\s+if \(!this\._spinAxis \|\| !Number\.isFinite\(spin\)\) return;/);
  // elektrownia w gryzie: własny egzemplarz tła (dziecko kuli, oś obrotu = oś ringu), bez maski słońca gry, warstwa tła
  // (traverse po dodaniu — rozgrzewka Core3D.warmup.now obejmuje jej siatki), zwolniona w stop()
  const src = read('src/3d/menuBackdrop3D.js');
  assert.match(src, /plant = new EarthBitePlant\(\{[\s\S]{0,200}uSunShadowRecv: \{ value: 0 \}\s*\}, \{ look \}\)/);
  assert.match(src, /ringAxis: axis\.toArray\(\)/);
  assert.match(src, /plant\.attachRing\(axis\)/);
  assert.match(src, /earthSpinQuaternion\(o\.spin, o\.axis, o\.base, o\.earth\.quaternion\)/);
  const at = (re) => src.search(re);
  assert.ok(at(/earth\.add\(plant\.group\)/) > 0 && at(/earth\.add\(plant\.group\)/) < at(/obj\.traverse\(\(o\) => o\.layers\.set\(MENU_BACKDROP_LAYER\)\)/));
  assert.match(src, /o\.plant\?\.dispose\(\)/);
  assert.match(src, /o\.plant\.update\(dt\)/);
  // słońce gry: menu świeci słońcem ringu z gry (gameSunLocal), talerz tylko w A/B
  assert.equal(MENU_SHOT.gameSun, true);
  assert.match(src, /this\.sunLocal\.az = gs \? gs\.az : az \+ s\.sunOffsetDeg \* DEG/);
  const game = new HaloRingGame({ world: new HaloRingWorld({ planets: [EARTH] }), renderer: {}, scene: fakeScene() });
  const out = { az: 0, el: 0 };
  const sun = { x: EARTH.x - 4e6, y: EARTH.y + 1e6 };
  assert.equal(game.gameSunLocal('earth', sun, out), out, 'bez alokacji w klatce tła');
  assert.ok(Math.abs(out.el - HALO_GAME.sunElevationDeg * DEG) < 1e-12);
  const bd = new MenuBackdrop3D({ haloRings: game });
  globalThis.SUN = sun;
  try {
    assert.equal(bd._gameSun(), bd._gameSunOut);
    assert.equal(bd._gameSun().az, out.az);
    bd.shot.gameSun = false;
    assert.equal(bd._gameSun(), null, 'dawny talerz');
  } finally { delete globalThis.SUN; }
  // lot intro z menu: menuSun = gameSun → słońce stoi przez cały tor (zgłoszenie: cieniowanie zmieniało się w locie)
  const { menuIntroFlight } = await import('../src/game/story/introCamera.js');
  const keys = [{ t: 0, eye: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: 30 },
    { t: 5, eye: { x: 1, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: 30 }];
  const plan = menuIntroFlight({ keys, menuSun: { az: out.az, el: out.el }, gameSun: { az: out.az, el: out.el } });
  for (const w of [0, 0.3, 0.5, 0.75, 1]) {
    const s = plan.sun(w);
    assert.ok(Math.abs(s.az - out.az) < 1e-12 && Math.abs(s.el - out.el) < 1e-12, `w ${w}`);
  }
});

test('index.html: tło po initHaloRings, rozgrzewka na ekranie ładowania, ring wraca do gry przed jej pierwszą klatką', () => {
  const html = read('index.html');
  assert.match(html, /initHaloRings\(\);\s*applyHaloRingDevSpawn\(\);\s*startMenuBackdrop\(\);/);
  const start = html.slice(html.indexOf('async function startGame('));
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

test('limit klatek tła menu (2026-10-29): zegar wirtualny harnessu omija limit jak pętla gry, po zmianie rozmiaru okna klatka od razu', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;   // _frame zamawia następną klatkę — w teście woła ją pętla niżej
  try {
    const bd = new MenuBackdrop3D();
    bd.running = true;
    bd.active = true;
    const dts = [];
    bd.renderFrame = (dt) => { dts.push(dt); };
    let virtual = false;
    bd.setFrameLimit(120, true, () => virtual);
    const V = 1000 / 240;
    let t = 1000;
    for (let i = 0; i < 200; i++, t += V) bd._frame(t);
    assert.ok(dts.length >= 100 && dts.length <= 106, `co 2. klatka ekranu po rozbiegu: ${dts.length}`);
    assert.ok(Math.abs(dts[dts.length - 1] - 2 * V / 1000) < 1e-9, 'dt klatki obejmuje pominiętą');
    // zegar wirtualny harnessu ('frozen' — znaczniki stoją): każda klatka tła, jak pętla gry (FrameLimiter.bypass)
    virtual = true;
    dts.length = 0;
    for (let i = 0; i < 10; i++) bd._frame(t);
    assert.equal(dts.length, 10);
    // zegar 'real': limit wraca; zmiana rozmiaru okna (strona, tryb off) — klatka zaraz po narysowanej
    virtual = false;
    dts.length = 0;
    while (!dts.length) bd._frame(t += V);
    bd._frame(t += V);
    assert.equal(dts.length, 1, 'bez wymuszenia — w takcie limitu');
    bd._frame(t += V);
    assert.equal(dts.length, 2);
    bd.forceNextFrame();
    bd._frame(t += V);
    assert.equal(dts.length, 3, 'forceNextFrame — klatka od razu');
    bd._frame(t += V);
    assert.equal(dts.length, 3, 'następna znów w takcie limitu');
    // pełnomocnik trybu worker nie podaje ominięcia — limiter bez bypass
    bd.setFrameLimit(120, true);
    assert.equal(bd._limiter.bypass, null);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
  }
});
