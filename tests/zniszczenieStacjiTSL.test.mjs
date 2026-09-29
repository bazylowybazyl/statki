// Port WebGPU zniszczenia stacji (zadanie 16): materiały rozpadu w TSL (src/vfx/shatterMaterial.js —
// trójkąty i implozja, dawny GLSL z shatterMaterial.js i destruction3D.js), cięcie kawałków skorupy
// maską TSL (zamiast material.clippingPlanes, których WebGPURenderer nie czyta), cień klonów materiałów
// GLB na węzłach oryginału, pule odłamków paneli.
// Bez GPU: WGSL budowany w Node (renderer bez init, atrapa kanwy — jak shieldTSL.test), klucz materiału
// liczony kodem three (RenderObject), wartości per obiekt wołane tak, jak robi to klatka węzłów.
// Obraz na GPU: scripts/webgpu/zrzuty.mjs, sesja „stacja” (baza z tagu); klatki rozpadu:
// scripts/webgpu/rozpad-stacji.mjs.
// node --test tests/zniszczenieStacjiTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import RenderObject from 'three/src/renderers/common/RenderObject.js';
import {
  SHATTER_GRAPH_KEYS, SHATTER_TSL_INTERNALS, SHATTER_TSL_STATS, ShatterNodeMaterial,
  createImplodeMaterial, createShatterMaterial, getShatterGraph
} from '../src/vfx/shatterMaterial.js';
import { bakeShatterGeometry } from '../src/vfx/shatterShaderBake.js';
import { DESTRUCTION_TSL_INTERNALS, Destruction3D } from '../src/vfx/destruction3D.js';
import { PanelShardManager } from '../src/vfx/panelShardManager.js';
import { Core3D } from '../src/3d/core3d.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true; // jak Core3D: modelViewMatrix składany na CPU w double
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => ((wgsl.match(/fn main\(([\s\S]*?)\)\s*->/) || [])[1]?.match(/@location\(/g) || []).length;

// Klucz materiału obiektu renderu (część NodeBuilderState: program + stan + geometria) — kod three.
function materialCacheKey(mesh) {
  const fake = {
    object: mesh, material: mesh.material, geometry: mesh.geometry,
    renderer: { backend: { isWebGPUBackend: true } },
    clippingContextCacheKey: '', context: { id: 1 },
    getGeometryCacheKey: RenderObject.prototype.getGeometryCacheKey
  };
  return RenderObject.prototype.getMaterialCacheKey.call(fake);
}

function texture() {
  const t = new THREE.DataTexture(new Uint8Array([200, 100, 50, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

test('graf rozpadu raz: materiały dzielą węzły, klucz programu i klucz materiału obiektu renderu', () => {
  const geoA = bakeShatterGeometry(new THREE.BoxGeometry(10, 10, 10));
  const geoB = bakeShatterGeometry(new THREE.TorusGeometry(40, 8, 12, 24));
  const a = new THREE.Mesh(geoA, createShatterMaterial({ map: texture(), fragmentDrift: 600 }));
  const b = new THREE.Mesh(geoB, createShatterMaterial({ map: null, color: new THREE.Color(0.2, 0.3, 0.4), spin: 5 }));
  assert.ok(a.material instanceof ShatterNodeMaterial && a.material.isNodeMaterial);
  assert.equal(a.material.vertexNode, b.material.vertexNode, 'ten sam graf wierzchołków');
  assert.equal(a.material.fragmentNode, b.material.fragmentNode, 'ten sam graf fragmentów');
  assert.equal(a.material.customProgramCacheKey(), b.material.customProgramCacheKey());
  // Inne mapy, kolory, parametry i geometrie (te same atrybuty) — jeden NodeBuilder.
  assert.equal(materialCacheKey(a), materialCacheKey(b));

  const i1 = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), createImplodeMaterial({ startTime: 1 }));
  const i2 = new THREE.Mesh(new THREE.BoxGeometry(9, 2, 3), createImplodeMaterial({ startTime: 7, duration: 2, color: new THREE.Color(1, 0, 0) }));
  assert.equal(i1.material.vertexNode, i2.material.vertexNode);
  assert.equal(materialCacheKey(i1), materialCacheKey(i2));
  assert.notEqual(i1.material.customProgramCacheKey(), a.material.customProgramCacheKey());

  // Każdy klucz czytany przez graf ma wartość w material.uniforms (inaczej onObjectUpdate rzuca).
  for (const key of SHATTER_GRAPH_KEYS.shatter) assert.ok(a.material.uniforms[key], `rozpad: brak ${key}`);
  for (const key of SHATTER_GRAPH_KEYS.implode) assert.ok(i1.material.uniforms[key], `implozja: brak ${key}`);
  assert.ok('tDiffuse' in a.material.uniforms);
});

test('stan renderu jak ShaderMaterial w WebGL: przezroczysty, bez zapisu głębi, jeden draw, bez świateł i cięcia', () => {
  const s = createShatterMaterial();
  const i = createImplodeMaterial();
  for (const m of [s, i]) {
    assert.equal(m.transparent, true);
    assert.equal(m.depthWrite, false);
    assert.equal(m.depthTest, true);
    assert.equal(m.forceSinglePass, true, 'WebGPU rysowałby przezroczysty DoubleSide dwa razy');
    assert.equal(m.lights, false);
    assert.equal(m.fog, false);
    assert.equal(m.isShaderMaterial, undefined, 'nie ShaderMaterial (zamiennik)');
    // Pass cienia (Renderer._getShadowNodes): `map !== null` = mapa — undefined dawało texture(undefined).
    assert.equal(m.map, null);
    assert.equal(m.alphaMap, null);
    assert.equal(m.colorNode, null, 'barwa w fragmentNode — pass cienia bez alfy materiału (jak MeshDepthMaterial)');
    assert.equal(m.positionNode, null, 'pozycja w vertexNode — cień nieprzesuniętej bryły (jak WebGL)');
    assert.equal(m.setupClipping(), null, 'ShaderMaterial w WebGL: clipping = false');
  }
  assert.equal(s.side, THREE.DoubleSide);
  assert.equal(i.side, THREE.FrontSide);
});

test('WGSL rozpadu: pozycja przez modelViewMatrix (highPrecision), potęgi mnożeniem, smoothstep odwrócony wzorem, ≤ 12 buforów', () => {
  const mesh = new THREE.Mesh(bakeShatterGeometry(new THREE.BoxGeometry(10, 10, 10)), createShatterMaterial({ map: texture() }));
  const { vertex, fragment } = buildWGSL(mesh);
  // highPrecision: macierz model-widok z CPU (double), nie cameraViewMatrix · modelWorldMatrix na GPU.
  assert.doesNotMatch(vertex, /cameraViewMatrix \* object\./, 'modelViewMatrix składany na GPU omija highPrecision');
  assert.match(vertex, /modelViewMatrix = highpModelViewMatrix;/);
  assert.match(vertex, /cameraProjectionMatrix \* \( modelViewMatrix \* vec4<f32>\(/);
  // exp(-pow(x, 2)) — mnożenie (pow z ujemną podstawą w WGSL = NaN, FXC w bazie mnożył).
  assert.doesNotMatch(vertex, /\bpow\(/);
  assert.match(vertex, /exp\( \( - \( nodeVar\d+ \* nodeVar\d+ \) \) \)/);
  // smoothstep(0.20, 0.0, t) i (0.24, 0.0, localT) — stałe krawędzie low ≥ high to w WGSL błąd shadera.
  assert.doesNotMatch(vertex, /smoothstep\( 0\.2(4)?, 0\.0,/);
  assert.match(vertex, /\( 0\.0 - 0\.2 \)/);
  assert.match(vertex, /\( 0\.0 - 0\.24 \)/);
  // Niewidoczny trójkąt poza obcięciem jak gl_Position = vec4(0, 0, 9999, 1).
  assert.match(vertex, /vec4<f32>\( 0\.0, 0\.0, 9999\.0, 1\.0 \)/);
  assert.match(vertex, /cross\(/);
  // Atrybuty: pozycja, uv, aCentroid, aRandom3 (limit 8 buforów wierzchołków).
  assert.equal(vertexInputs(vertex), 4);
  for (const a of ['aCentroid', 'aRandom3', 'uv', 'position']) assert.match(vertex, new RegExp(`${a} : vec`));
  // Fragment: discard przy alfie < 0,005, próbka mapy tylko przy uHasTexture (warunek z uniformu).
  assert.match(fragment, /if \( \( vShatterAlpha < 0\.005 \) \) \{\s*discard;/);
  assert.match(fragment, /if \( \( object\.nodeUniform\d+ > 0\.5 \) \) \{\s*nodeVar\d+ = textureSample\(/);
  assert.match(fragment, /vec3<f32>\( 1\.0, 0\.42, 0\.06 \)/);
  assert.ok(uniformBuffers(vertex) <= 12 && uniformBuffers(fragment) <= 12, 'limit 12 buforów uniformów na etap');
  assert.doesNotMatch(vertex + fragment, /sunShadow|sunVisibility/, 'rozpad nie czytał maski słońca w WebGL');
});

test('WGSL implozji: szum sin-hash jak GLSL, normalne z atrybutu, discard przy alfie < 0,01', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), createImplodeMaterial({ startTime: 0 }));
  const { vertex, fragment } = buildWGSL(mesh);
  assert.match(vertex, /fract\( \( sin\( dot\( \( position \* vec3<f32>\( 0\.01 \) \), vec3<f32>\( 12\.9898, 78\.233, 45\.164 \) \) \) \* 43758\.5453 \) \)/);
  assert.match(vertex, /normal : vec3<f32>/);
  assert.equal(vertexInputs(vertex), 2);
  assert.doesNotMatch(vertex, /cameraViewMatrix \* object\./);
  assert.match(vertex, /modelViewMatrix = highpModelViewMatrix;/);
  assert.match(fragment, /if \( \( vImplodeAlpha < 0\.01 \) \) \{\s*discard;/);
  assert.match(fragment, /\* vec3<f32>\( 1\.5 \)/);
});

test('wartości per obiekt: węzły grafu czytają material.uniforms rysowanego obiektu, mapa per obiekt', () => {
  const texA = texture();
  const a = createShatterMaterial({ map: texA, fragmentDrift: 111, spin: 2 });
  const b = createShatterMaterial({ map: null, fragmentDrift: 222, color: new THREE.Color(0.1, 0.2, 0.3) });
  buildWGSL(new THREE.Mesh(bakeShatterGeometry(new THREE.BoxGeometry(4, 4, 4)), a));
  const graph = getShatterGraph('shatter');
  for (const [key, node] of Object.entries(graph.uniforms)) assert.equal(node.updateType, 'object', `${key}: onObjectUpdate`);
  a.uniforms.uShatterTime.value = 12.5;
  b.uniforms.uShatterTime.value = 40;
  const frame = (material) => ({ material, object: null });
  graph.uniforms.uFragmentDrift.update(frame(a));
  assert.equal(graph.uniforms.uFragmentDrift.value, 111);
  graph.uniforms.uFragmentDrift.update(frame(b));
  assert.equal(graph.uniforms.uFragmentDrift.value, 222);
  graph.uniforms.uShatterTime.update(frame(a));
  assert.equal(graph.uniforms.uShatterTime.value, 12.5);
  graph.uniforms.uBaseColor.update(frame(b));
  assert.equal(graph.uniforms.uBaseColor.value, b.uniforms.uBaseColor.value);
  graph.uniforms.uHasTexture.update(frame(a));
  assert.equal(graph.uniforms.uHasTexture.value, 1);
  graph.uniforms.uHasTexture.update(frame(b));
  assert.equal(graph.uniforms.uHasTexture.value, 0);

  // Tekstura per obiekt (texture().onObjectUpdate() w r183 nie działa — węzeł ze stałym OBJECT).
  const texNode = graph.diffuse;
  assert.ok(texNode?.isTextureNode && texNode.objectKey === 'tDiffuse', 'węzeł tekstury tDiffuse w grafie');
  assert.equal(texNode.updateType, 'object');
  texNode.update(frame(a));
  assert.equal(texNode.value, texA);
  texNode.update(frame(b));
  assert.equal(texNode.value, SHATTER_TSL_INTERNALS.PLACEHOLDER_DIFFUSE, 'bez mapy — zastępcza, nie tekstura poprzedniego obiektu');
});

test('rozpad wielu meshy: lekkie materiały bez budowy NodeBuildera, klon z własnymi uniformami', () => {
  const before = { ...SHATTER_TSL_STATS.builds };
  const mats = [];
  for (let i = 0; i < 40; i++) mats.push(createShatterMaterial({ fragmentDrift: 100 + i }));
  assert.equal(SHATTER_TSL_STATS.builds.shatter, before.shatter, 'setup() (NodeBuilder) woła tylko budowa, nie konstruktor');
  assert.ok(mats.every((m) => m.vertexNode === mats[0].vertexNode && m.fragmentNode === mats[0].fragmentNode));
  const c = mats[3].clone();
  assert.ok(c instanceof ShatterNodeMaterial);
  assert.equal(c.vertexNode, mats[3].vertexNode);
  assert.notEqual(c.uniforms, mats[3].uniforms);
  assert.notEqual(c.uniforms.uBaseColor.value, mats[3].uniforms.uBaseColor.value);
  assert.equal(c.uniforms.uFragmentDrift.value, 103);
  c.uniforms.uShatterTime.value = 99;
  assert.equal(mats[3].uniforms.uShatterTime.value, -9999);
});

test('cięcie kawałków skorupy: maska TSL odrzuca to co clippingPlanes w WebGL (suma płaszczyzn, cień bez cięcia)', () => {
  const { shellClipViewPlane, getShellClipNodes, createShellClipContext } = DESTRUCTION_TSL_INTERNALS;
  const root = new THREE.Group();
  const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  root.add(meshA, meshB);
  const local = [new THREE.Plane(new THREE.Vector3(1, 0.2, 0).normalize(), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0.1).normalize(), 0)];
  const ctx = createShellClipContext(root, local);
  const nodes = getShellClipNodes();
  assert.equal(meshA.material.maskNode, nodes.mask, 'jeden wspólny węzeł maski');
  assert.equal(meshB.material.maskNode, nodes.mask);
  assert.equal(meshA.material.maskShadowNode, nodes.shadowMask, 'cień bez cięcia (clipShadows = false)');
  assert.equal(meshA.userData.__shellClip, ctx);
  assert.equal(meshA.frustumCulled, false);
  assert.ok(meshA.material.clippingPlanes === null || meshA.material.clippingPlanes === undefined || meshA.material.clippingPlanes.length === 0,
    'bez material.clippingPlanes (WebGPU ich nie czyta, a pole wchodzi do klucza materiału)');

  // Płaszczyzny świata daleko od początku (świat gry 5–10 mln j.), kamera patrzy z góry jak pass FG.
  const origin = new THREE.Vector3(9654200, -8138100, -100);
  ctx.worldPlanes[0].setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0.2, 0.05).normalize(), origin);
  ctx.worldPlanes[1].setFromNormalAndCoplanarPoint(new THREE.Vector3(-0.3, -1, 0.1).normalize(), origin);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 100, 500000);
  camera.position.set(origin.x + 300, origin.y - 200, 2141);
  camera.lookAt(origin.x + 300, origin.y - 200, 0);
  camera.updateMatrixWorld(true);
  const v0 = shellClipViewPlane(meshA, camera, 0).clone();
  const v1 = shellClipViewPlane(meshA, camera, 1).clone();
  let rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  let kept = 0;
  for (let i = 0; i < 2000; i++) {
    const pw = new THREE.Vector3(origin.x + (rand() - 0.5) * 800, origin.y + (rand() - 0.5) * 800, -100 + (rand() - 0.5) * 300);
    const pv = pw.clone().applyMatrix4(camera.matrixWorldInverse);
    // TSL: zostaje, gdy positionView·v.xyz ≤ v.w dla obu płaszczyzn.
    const d0 = ctx.worldPlanes[0].distanceToPoint(pw);
    const d1 = ctx.worldPlanes[1].distanceToPoint(pw);
    if (Math.abs(d0) < 1e-3 || Math.abs(d1) < 1e-3) continue;
    const keepTsl = pv.dot(new THREE.Vector3(v0.x, v0.y, v0.z)) <= v0.w && pv.dot(new THREE.Vector3(v1.x, v1.y, v1.z)) <= v1.w;
    // WebGL (clipIntersection = false): fragment odrzucony, gdy leży za KTÓRĄKOLWIEK płaszczyzną.
    const keepGl = d0 >= 0 && d1 >= 0;
    assert.equal(keepTsl, keepGl, `punkt ${i}`);
    if (keepGl) kept++;
  }
  assert.ok(kept > 200 && kept < 1800, 'próbki po obu stronach');
  // Obiekt bez kontekstu cięcia — płaszczyzna, która nic nie tnie.
  const plain = new THREE.Mesh();
  const never = shellClipViewPlane(plain, camera, 0);
  assert.ok(!(0 > never.w), 'bez cięcia');
});

test('klony materiałów GLB (wygaszenie bryły, kawałki skorupy) rzucają cień węzłami oryginału', () => {
  const { shareShadowNodes, fadeClone, shellPieceClone } = DESTRUCTION_TSL_INTERNALS;
  const prev = Core3D.renderer;
  Core3D.renderer = renderer;
  try {
    const src = new THREE.MeshStandardMaterial({ map: texture() });
    const fade = fadeClone(src);
    assert.equal(fade.transparent, true);
    assert.equal(fade.depthWrite, false);
    const piece = shellPieceClone(src);
    assert.ok(piece.maskNode && piece.maskShadowNode, 'maska cięcia na klonie kawałka');
    const base = renderer._getShadowNodes(src);
    assert.ok(base.colorNode, 'materiał z mapą ma węzły cienia (alfa mapy)');
    assert.equal(renderer._getShadowNodes(fade).colorNode, base.colorNode, 'klon wygaszenia — węzły oryginału');
    assert.equal(renderer._getShadowNodes(piece).colorNode, base.colorNode, 'klon kawałka — węzły oryginału (maska cienia = prawda)');
    // Inna mapa — bez współdzielenia (alfa innej tekstury).
    const other = src.clone();
    other.map = texture();
    shareShadowNodes(other, src);
    assert.notEqual(renderer._getShadowNodes(other).colorNode, base.colorNode);
  } finally {
    Core3D.renderer = prev;
  }
});

test('rozgrzewka: trzymacz ma układ geometrii wypieku (klucz programu) bez jej wierzchołków', () => {
  const { geometryLayoutKey, layoutGeometry } = DESTRUCTION_TSL_INTERNALS;
  const baked = bakeShatterGeometry(new THREE.TorusGeometry(30, 6, 16, 32));
  const holder = layoutGeometry(baked);
  assert.equal(geometryLayoutKey(holder), geometryLayoutKey(baked));
  assert.equal(holder.attributes.position.count, 3);
  const a = new THREE.Mesh(baked, createShatterMaterial());
  const b = new THREE.Mesh(holder, createShatterMaterial());
  assert.equal(materialCacheKey(a), materialCacheKey(b), 'ten sam klucz stanu budowy — rozgrzewka trafia w cache');
  const indexed = new THREE.BoxGeometry(2, 2, 2);
  const h2 = layoutGeometry(indexed);
  assert.ok(h2.index && h2.index.count === 3);
  assert.equal(geometryLayoutKey(h2), geometryLayoutKey(indexed));
});

test('pule odłamków paneli: czerń jak w WebGL (vertexColors bez atrybutu color), puste i niewidoczne', () => {
  const scene = new THREE.Scene();
  const mgr = new PanelShardManager(scene);
  assert.equal(mgr._allPools.length, 8);
  for (const pool of mgr._allPools) {
    const m = pool.mesh.material;
    assert.equal(m.color.getHex(), 0x000000, 'WebGL: kolor × atrybut color (brak = 0) × instanceColor = czerń');
    assert.equal(m.vertexColors, true);
    assert.equal(pool.mesh.geometry.hasAttribute('color'), false);
    assert.equal(pool.mesh.count, 0);
    assert.equal(pool.mesh.visible, false);
    assert.equal(pool.mesh.layers.mask, 1 << 2, 'warstwa FG');
  }
  assert.equal(typeof mgr.prewarm, 'function');
  mgr.disposeAll();
});

test('pliki zadania 16 bez GLSL (port zamknięty)', () => {
  for (const file of ['src/vfx/shatterMaterial.js', 'src/vfx/destruction3D.js', 'src/vfx/panelShardManager.js',
    'src/vfx/shatterShaderBake.js', 'src/vfx/destructionDebrisManager.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /gl_FragColor|gl_Position|void\s+main\s*\(|\bvarying\s+(vec|float)|\buniform\s+(float|vec[234]|sampler2D)\b|ShaderMaterial\(|\/\* glsl \*\//, `${file}: GLSL`);
  }
  assert.doesNotMatch(read('src/vfx/destruction3D.js'), /mat\.clippingPlanes\s*=/, 'cięcie maską TSL, nie material.clippingPlanes');
});

// Zadanie 25a: rozgrzewka rozpadu przez rejestr Core3D.warmup — pass sceny (wpis zwykły) i pass MAPY CIENIA
// (`shadow: true` → Core3D.prewarmShadowPass, w tle, w kontekście passa cienia gry; dawniej trzymacze rysowane w
// mapie cienia FG: 8 pipeline'ów synchronicznie i 18 budów w pierwszych klatkach każdej sesji). Zapas rysunkiem
// (gdy droga w tle niedostępna) — najwyżej jeden trzymacz w scenie naraz (zadanie 23: wszystkie naraz ~80 ms).
test('rozgrzewka rozpadu przez rejestr: pass cienia w tle (shadow: true), zapas rysunkiem najwyżej jeden naraz', () => {
  const src = read('src/vfx/destruction3D.js');
  const warm = src.slice(src.indexOf('function _queueWarm('), src.indexOf('function _makeHolderSafe('));
  assert.match(warm, /reg\.add\(\{ name: [^\n]*objects: \(\) => _keepHolder\(_makeHolderSafe\(makeHolder\)\) \}\);/);
  const q = src.slice(src.indexOf('function _queueShadowWarm('), src.indexOf('function _queueShadowFallback('));
  assert.match(q, /shadow: true,/);
  assert.match(q, /fallback: _queueShadowFallback/);
  assert.match(q, /holder\.castShadow = true;/);
  assert.doesNotMatch(src, /requestIdleCallback/, 'bez własnej kolejki w wolnych chwilach — rejestr');
  const step = src.slice(src.indexOf('function _stepShadowWarm() {'), src.indexOf('// Klon materiału jak w _beginRootFade'));
  assert.ok(step.indexOf('_shadowWarmPending.length === 0') < step.indexOf('_shadowFallbackQueue.shift()'), 'sprawdzenie przed zdjęciem z kolejki');
  assert.match(read('src/vfx/panelShardManager.js'), /reg\.add\(\{\s*name: 'rozpad stacji: pule odłamków paneli'/);

  // zapas: kolejka trzymaczy, w scenie najwyżej jeden (2 klatki na warstwie 31), potem następny
  const { queueShadowFallback, stepShadowWarm, warmStats } = DESTRUCTION_TSL_INTERNALS;
  const scene = new THREE.Scene();
  Destruction3D.init({ scene });
  const a = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const b = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  queueShadowFallback(a);
  queueShadowFallback(b);
  queueShadowFallback(a);
  assert.equal(warmStats().shadowFallbackQueued, 2, 'bez duplikatów');
  stepShadowWarm();
  assert.equal(a.parent, scene);
  assert.equal(b.parent, null, 'drugi czeka');
  assert.equal(a.layers.mask >>> 0, 2 ** 31, 'warstwa 31');
  assert.equal(a.castShadow, true);
  stepShadowWarm();
  assert.equal(b.parent, null, 'pierwszy jeszcze w scenie (2 klatki)');
  stepShadowWarm();
  assert.equal(a.parent, null, 'zdjęty bez dispose');
  assert.equal(b.parent, scene, 'następny po zdjęciu poprzedniego');
  stepShadowWarm();
  stepShadowWarm();
  assert.equal(b.parent, null);
  assert.deepEqual([warmStats().shadowPending, warmStats().shadowFallbackQueued], [0, 0]);
  Destruction3D.dispose();
});

// Zadanie 25a: trzymacze passa sceny (wygaszenie, kawałek skorupy) po PODPISIE materiału — pola klucza materiału
// obiektu renderu three (bez uuid, nazwy, wersji, opacity, userData; kolor = obiekt bez treści; tekstura = mapowanie,
// filtry, zawijanie), liczby dokładnie. Strzałki stacji pirackiej: 64 materiały różniące się barwą → jeden trzymacz.
test('podpis materiału trzymaczy rozpadu: ten sam klucz materiału three = jeden trzymacz passa sceny', () => {
  const { materialSignature } = DESTRUCTION_TSL_INTERNALS;
  const a = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4, name: 'a' });
  const b = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.4, name: 'b', opacity: 0.5 });
  b.userData.x = 1;
  assert.equal(materialSignature(a), materialSignature(b), 'barwa, nazwa, opacity, userData, uuid — bez wpływu');
  const c = a.clone();
  c.roughness = 0.5;
  assert.notEqual(materialSignature(a), materialSignature(c), 'liczby dokładnie (zachowawczo)');
  const d = a.clone();
  d.transparent = true;
  assert.notEqual(materialSignature(a), materialSignature(d), 'przezroczystość');
  const e = a.clone();
  e.map = new THREE.Texture();
  assert.notEqual(materialSignature(a), materialSignature(e), 'mapa');
  const f = e.clone();
  f.map = new THREE.Texture();
  assert.equal(materialSignature(e), materialSignature(f), 'inna tekstura, te same próbkowanie i zawijanie');
  f.map.wrapS = THREE.RepeatWrapping;
  assert.notEqual(materialSignature(e), materialSignature(f), 'zawijanie tekstury');
  assert.notEqual(materialSignature(a), materialSignature(new THREE.MeshBasicMaterial()), 'typ materiału');
  const src = read('src/vfx/destruction3D.js');
  assert.match(src, /_queueWarm\(`fade\|\$\{sig\}`/);
  assert.match(src, /_queueWarm\(`kawalek\|\$\{sig\}`/);
  assert.match(src, /_queueShadowWarm\(`fade-cien\|\$\{mat\}`/, 'pass cienia per materiał (węzły cienia z mapą)');
});

// Zadanie 24: kawałek skorupy (Destruction3D.detachChunk → podział fragmentu) dostaje WŁASNE klony
// geometrii i materiałów bryły. Flaga zasobu szablonu GLB (stations3D.js) nie może na nie przejść —
// BufferGeometry.copy dzieli userData ze źródłem — inaczej DestructionDebrisManager nigdy ich nie
// zwalniał (cała bryła stacji na kawałek, przy każdym rozpadzie).
test('klony kawałka skorupy nie dziedziczą flagi zasobu szablonu i idą do zwolnienia', async () => {
  const { cloneShellHierarchy } = DESTRUCTION_TSL_INTERNALS;
  const { DebrisManager } = await import('../src/vfx/destructionDebrisManager.js');
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData.__sharedTemplateAsset = true;
  const material = new THREE.MeshStandardMaterial();
  material.userData.__sharedTemplateAsset = true;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  const piece = cloneShellHierarchy(root);
  const mesh = piece.children[0];
  assert.notEqual(mesh.geometry, geometry, 'kawałek ma własną geometrię');
  assert.notEqual(mesh.material, material, 'kawałek ma własny materiał');
  assert.equal(mesh.geometry.userData.__sharedTemplateAsset, undefined, 'geometria kawałka bez flagi szablonu');
  assert.equal(mesh.material.userData.__sharedTemplateAsset, undefined, 'materiał kawałka bez flagi szablonu');
  assert.equal(geometry.userData.__sharedTemplateAsset, true, 'szablon zachowuje flagę');
  assert.equal(material.userData.__sharedTemplateAsset, true);
  const disposed = [];
  for (const o of [geometry, material, mesh.geometry, mesh.material]) o.addEventListener('dispose', () => disposed.push(o));
  const scene = new THREE.Scene();
  scene.add(piece);
  const dm = new DebrisManager();
  dm.register(piece, scene, 1);
  dm.update(2);
  assert.deepEqual(disposed, [mesh.geometry, mesh.material], 'zwolnione klony kawałka, szablon nietknięty');
  geometry.dispose();
  material.dispose();
});
