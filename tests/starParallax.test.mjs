import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function loadStarParallax() {
  try {
    return await import('../src/3d/starParallax.js');
  } catch (err) {
    assert.fail(`expected star parallax helper module to exist: ${err.code || err.message}`);
  }
}

test('star parallax layers keep distant depth while one speed layer outruns the ship', async () => {
  const {
    STAR_PARALLAX_LAYERS,
    computeStarCameraOffset,
  } = await loadStarParallax();

  assert.equal(STAR_PARALLAX_LAYERS.length, 3);
  const deepLayers = STAR_PARALLAX_LAYERS.filter((layer) => layer.name !== 'speed');
  const speedLayer = STAR_PARALLAX_LAYERS.find((layer) => layer.name === 'speed');

  assert.ok(deepLayers.every((layer) => layer.parallax <= 0.3));
  assert.ok(speedLayer, 'expected a dedicated speed layer');
  assert.ok(speedLayer.parallax > 1.0, 'speed layer should move faster than the ship/world camera');
  assert.ok(speedLayer.share <= 0.16, 'speed layer should stay sparse so it reads as velocity streaks');
  assert.ok(speedLayer.stretchMul >= 1.6, 'speed layer should stretch harder during warp');

  const cameraTravel = 10000;
  const offsets = STAR_PARALLAX_LAYERS.map((layer) =>
    computeStarCameraOffset(cameraTravel, -cameraTravel, layer, 220000)
  );

  assert.ok(offsets[0].x < offsets[1].x);
  assert.ok(offsets[1].x < offsets[2].x);
  assert.ok(offsets[0].x <= cameraTravel * 0.03);
  assert.ok(offsets[1].x <= cameraTravel * 0.3);
  assert.ok(offsets[2].x > cameraTravel);
  assert.ok(offsets[2].y > cameraTravel);
});

test('individual stars vary speed inside their parallax layer', async () => {
  const {
    STAR_PARALLAX_LAYERS,
    computeStarParallaxFactor,
  } = await loadStarParallax();

  for (const layer of STAR_PARALLAX_LAYERS) {
    assert.ok(layer.parallaxMin < layer.parallax);
    assert.ok(layer.parallaxMax > layer.parallax);
    assert.equal(computeStarParallaxFactor(layer, 0), layer.parallaxMin);
    assert.equal(computeStarParallaxFactor(layer, 1), layer.parallaxMax);
  }

  const deep = STAR_PARALLAX_LAYERS.find((layer) => layer.name === 'deep');
  const mid = STAR_PARALLAX_LAYERS.find((layer) => layer.name === 'mid');
  const speed = STAR_PARALLAX_LAYERS.find((layer) => layer.name === 'speed');

  assert.ok(deep.parallaxMax < mid.parallaxMin);
  assert.ok(mid.parallaxMax < 0.3);
  assert.ok(speed.parallaxMin > 1.0);
  assert.ok(speed.parallaxMax - speed.parallaxMin >= 0.6);
});

// Port WebGPU (zadanie 05): shader gwiazd to graf TSL (createStarMaterial w planet3d.assets.tsl.js) na kwadratach
// instancjonowanych — WebGPU rysuje punkty po 1 px. Strażnicy dawnych regexów GLSL pilnują tych samych wzorów
// w grafie (paralaksa per gwiazda, smugi tylko w skoku i przy biczu, głowa smugi w miejscu gwiazdy), a WGSL
// budowany w Node — że atrybuty gwiazd naprawdę trafiają do shadera wierzchołków.
const starSources = () => ({
  js: readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
  tsl: readFileSync(new URL('../src/3d/planet3d.assets.tsl.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
});
const starGraphSource = (tsl) => tsl.slice(tsl.indexOf('export function createStarMaterial(u)'));

async function buildStarWgsl() {
  const THREE = await import('three/webgpu');
  const { texture, uniform, uniformArray, vec2 } = await import('three/tsl');
  const { uniformsAdapter } = await import('../src/3d/tsl/uniformy.js');
  const { createStarMaterial, createStarGeometry, STAR_PLANET_MASK_CAP } = await import('../src/3d/planet3d.assets.tsl.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  renderer.highPrecision = true;
  const tex = new THREE.Texture();
  tex.image = { width: 1, height: 1 };
  const u = uniformsAdapter({
    pointTexture: texture(tex, vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2()),
    containerSize: uniform(220000), perspectiveScale: uniform(800), globalBrightness: uniform(1), warpFactor: uniform(0),
    moveDir: uniform(new THREE.Vector2(0, 1)), stretchStrength: uniform(20), zoomComp: uniform(1), exitWhipFactor: uniform(0),
    exitWhipStrength: uniform(1.75), viewportSize: uniform(new THREE.Vector2(1, 1)), thinningStrength: uniform(38), baseSizeMul: uniform(1.65),
    planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4()), 'vec4')
  });
  const f = (k) => new Float32Array(2 * k);
  const geometry = createStarGeometry({ starPos: f(3), size: f(1), brightness: f(1), color: f(3), parallaxFactor: f(1), layerSizeMul: f(1), layerBrightnessMul: f(1), layerStretchMul: f(1) }, 2);
  const material = createStarMaterial(u);
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader, geometry, material };
}

test('planet star shader uses per-star parallax and warp stretch attributes', async () => {
  const { js, tsl } = starSources();
  const graph = starGraphSource(tsl);

  // Dane gwiazd: paralaksa losowana per gwiazda w obrębie warstwy (nie stała warstwy), bez „prędkości” lotu.
  assert.doesNotMatch(js, /starSpeed:\s*0\.9/);
  assert.match(js, /computeStarParallaxFactor/);
  assert.match(js, /parallaxFactors\[i\]\s*=\s*computeStarParallaxFactor\(layer,\s*Math\.random\(\)\)/);
  assert.doesNotMatch(js, /parallaxFactors\[i\]\s*=\s*layer\.parallax/);
  assert.match(js, /createStarGeometry\(\{[\s\S]*?parallaxFactor: parallaxFactors,[\s\S]*?layerStretchMul: layerStretchMuls/);
  // Graf: atrybuty paralaksy i rozciągania warstwy, bez speedFactor / speedResponse.
  assert.match(graph, /attribute\('parallaxFactor', 'float'\)/);
  assert.match(graph, /attribute\('layerStretchMul', 'float'\)/);
  assert.doesNotMatch(tsl, /speedResponse|speedFactor/);
  assert.match(graph, /const layeredOffset = u\.cameraOffset\.mul\(aParallax\);/);

  // WGSL: atrybuty gwiazd są wejściem shadera wierzchołków (dane instancji w JEDNYM przeplecionym buforze).
  const { vertex, geometry } = await buildStarWgsl();
  for (const name of ['starPos', 'size', 'brightness', 'color', 'parallaxFactor', 'layerSizeMul', 'layerBrightnessMul', 'layerStretchMul']) {
    assert.match(vertex, new RegExp(`@location\\( ?\\d+ ?\\) ${name} :`), `atrybut ${name} w WGSL`);
  }
  const buffers = new Set(Object.values(geometry.attributes).map((a) => (a.isInterleavedBufferAttribute ? a.data : a)));
  assert.equal(buffers.size, 2, 'kwadrat + jeden bufor instancji (limit 8 buforów wierzchołków)');
});

test('normal flight speed does not drive warp stretch in the star shader', () => {
  const graph = starGraphSource(starSources().tsl);
  assert.doesNotMatch(graph, /max\(\s*u\.warpFactor\s*,\s*u\.speedFactor/);
  assert.match(graph, /const stretchDrive = max\(u\.warpFactor, u\.exitWhipFactor\.mul\(u\.exitWhipStrength\)\);/);
  assert.match(graph, /const stretch = float\(1\.0\)\.add\(stretchDrive\.mul\(u\.stretchStrength\)\.mul\(aLayerStretch\)\);/);
});

test('warp star streak keeps the star head anchored at the original point', () => {
  const graph = starGraphSource(starSources().tsl);
  // Głowa smugi w miejscu gwiazdy: środek punktu cofa się o pół boku wzdłuż kierunku skoku (viewportSize).
  assert.match(graph, /const safeViewport = max\(u\.viewportSize, vec2\(1\.0\)\);/);
  assert.match(graph, /const clipPosition = cameraProjectionMatrix\.mul\(mvPosition\)\.toVar\(\);/);
  assert.match(graph, /clipPosition\.assign\(vec4\(clipPosition\.xy\.sub\(screenOffset\), clipPosition\.zw\)\);/);
  assert.match(graph, /return vec4\(clipPosition\.xy\.add\(offset\), clipPosition\.zw\);/);
  assert.match(graph, /suv\.assign\(vec2\(suv\.x\.sub\(0\.5\)\.div\(vStretch\), suv\.y\)\);/);
  assert.doesNotMatch(graph, /stretch\.sub\(1\.0\)\.mul\(0\.5\)/);
  assert.doesNotMatch(graph, /mvPosition\.xy\.sub\(u\.moveDir/);
  // Kwadrat punktu z GL: bok gl_PointSize obcięty do ≥ 1 px (ALIASED_POINT_SIZE_RANGE w WebGL).
  assert.match(graph, /const quadSize = max\(pointSize, 1\.0\);/);
});

test('warp exit uses a short whip pulse and preserves the last warp direction', () => {
  const { js, tsl } = starSources();
  const graph = starGraphSource(tsl);
  assert.match(js, /exitWhipFactor: uniform\(0\.0\), exitWhipStrength: uniform\(1\.75\)/);
  assert.match(graph, /const vExitWhip = u\.exitWhipFactor;/);
  assert.match(graph, /const whipFlash = float\(1\.0\)\.add\(vExitWhip\.mul\(1\.25\)\)/);
  assert.match(js, /exitWhipTimer:\s*0/);
  assert.match(js, /exitWhipDuration:\s*0\.34/);
  assert.match(js, /this\.lastWarpState\s*===\s*'active'\s*&&\s*currentState\s*!==\s*'active'/);
  assert.match(js, /this\.exitWhipTimer\s*=\s*this\.exitWhipDuration\s*;/);
  assert.match(js, /Math\.pow\s*\(\s*whipT\s*,\s*2\.6\s*\)/);
  assert.match(js, /this\.uniforms\.exitWhipFactor\.value\s*=\s*exitWhipFactor\s*;/);
  assert.match(js, /lastWarpDirX/);
  assert.match(js, /if\s*\(\s*this\.exitWhipTimer\s*>\s*0\s*\)\s*\{\s*dx\s*=\s*this\.lastWarpDirX\s*;\s*dy\s*=\s*this\.lastWarpDirY\s*;/);
  assert.doesNotMatch(js, /this\.exitTimer\s*=\s*0\.8/);
});

test('oddalenie kamery nie zagęszcza gwiazd: wzór rośnie z kadrem poniżej zoomu odniesienia', async () => {
  const { STAR_ZOOM_REF, starZoomCompensation } = await loadStarParallax();
  // W zwykłym zakresie gry (i w widoku skoku przy domyślnym zoomie) bez zmian.
  assert.equal(starZoomCompensation(1), 1);
  assert.equal(starZoomCompensation(STAR_ZOOM_REF), 1);
  assert.equal(starZoomCompensation(0), 1, 'zły zoom — bez kompensacji');
  // Dalej: gwiazd na ekranie tyle co przy zoomie odniesienia (gęstość ~ (zoom·k)²).
  for (const zoom of [0.04, 0.02, 0.006]) {
    const k = starZoomCompensation(zoom);
    assert.ok(Math.abs(zoom * k - STAR_ZOOM_REF) < 1e-12, `zoom ${zoom}: skala wzoru na ekranie jak przy odniesieniu`);
  }
});

test('kamera gwiazd: ruch kamery podzielony przez kompensację, zmiana zoomu nie przesuwa wzoru, limit kroku', async () => {
  const { advanceStarCamera } = await loadStarParallax();
  const sc = { x: 0, y: 0, lx: NaN, ly: NaN };
  advanceStarCamera(sc, 5_000_000, 3_000_000, 1);
  assert.deepEqual([sc.x, sc.y], [5_000_000, 3_000_000], 'start od kamery gry');
  // k = 1: dokładnie jak dawniej (przesunięcie = kamera gry).
  advanceStarCamera(sc, 5_010_000, 2_990_000, 1);
  assert.deepEqual([sc.x, sc.y], [5_010_000, 2_990_000]);
  // k = 4: wzór 4× większy na ekranie, więc kamera gwiazd przesuwa się 4× mniej —
  // gwiazdy na ekranie jadą tak samo szybko jak bez kompensacji.
  advanceStarCamera(sc, 5_018_000, 2_990_000, 4);
  assert.equal(sc.x, 5_012_000);
  // Sama zmiana zoomu (kamera stoi) nie rusza wzoru.
  advanceStarCamera(sc, 5_018_000, 2_990_000, 2);
  assert.equal(sc.x, 5_012_000);
  // Limit kroku (widok skoku): najwyżej maxStep na krok, w kierunku ruchu.
  advanceStarCamera(sc, 5_118_000, 2_990_000, 1, 300);
  assert.equal(sc.x, 5_012_300);
  assert.equal(sc.y, 2_990_000);
});
