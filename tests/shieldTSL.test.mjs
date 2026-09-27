// Port WebGPU tarcz (zadanie 14): materiały TSL (src/3d/shield3D.tsl.js — kopuła „sfera”
// i tarcza-obrys; src/3d/shieldImpactFx.js — wstęgi i bańki trafień) zamiast GLSL.
// Bez GPU: WGSL budowany w Node przez WGSLNodeBuilder (renderer bez init, atrapa kanwy —
// jak haloRingTSL.test), klucz materiału liczony kodem three (RenderObject), pakowanie
// wartości per obiekt wywołane tak, jak robi to klatka węzłów przy rysowaniu obiektu.
// Parzystość z GLSL tagu na GPU i test uniformArray per obiekt na prawdziwym GPU:
// scripts/webgpu/tarcze-parzystosc.mjs.
// node --test tests/shieldTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import RenderObject from 'three/src/renderers/common/RenderObject.js';
import {
  SHIELD_GRAPH_KEYS, SHIELD_MAX_HITS, SHIELD_TSL_STATS, ShieldNodeMaterial, getShieldGraph
} from '../src/3d/shield3D.tsl.js';
import {
  buildHullShieldGeometryForTools, createHullShieldMaterialForTools, createSphereShieldMaterialForTools, getShieldMaterialStats
} from '../src/3d/shield3D.js';
import { ShieldImpactFX } from '../src/3d/shieldImpactFx.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;

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

function profile(maxR, minR = maxR * 0.45, n = 32) {
  const bins = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    bins[i] = (maxR * minR) / Math.hypot(minR * Math.cos(t), maxR * Math.sin(t));
  }
  return { bins, binCount: n, maxR, minR, pad: 20 };
}

test('graf na wariant: tarcze dzielą węzły, klucz programu i klucz materiału obiektu renderu', () => {
  const pA = profile(220);
  const pB = profile(640, 300);
  const hullA = new THREE.Mesh(buildHullShieldGeometryForTools(pA), createHullShieldMaterialForTools(pA));
  const hullB = new THREE.Mesh(buildHullShieldGeometryForTools(pB), createHullShieldMaterialForTools(pB));
  hullB.material.uniforms.uLife.value = 0.2;
  hullB.material.uniforms.uColor.value.set(0xff8800);
  const sphereA = new THREE.Mesh(new THREE.SphereGeometry(1.8, 32, 32), createSphereShieldMaterialForTools());
  const sphereB = new THREE.Mesh(sphereA.geometry, createSphereShieldMaterialForTools());

  assert.ok(hullA.material instanceof ShieldNodeMaterial && hullA.material.isNodeMaterial);
  assert.equal(hullA.material.fragmentNode, hullB.material.fragmentNode, 'ten sam graf obrysu');
  assert.equal(sphereA.material.fragmentNode, sphereB.material.fragmentNode, 'ten sam graf sfery');
  assert.notEqual(hullA.material.fragmentNode, sphereA.material.fragmentNode);
  assert.equal(hullA.material.customProgramCacheKey(), hullB.material.customProgramCacheKey());
  assert.notEqual(hullA.material.customProgramCacheKey(), sphereA.material.customProgramCacheKey());
  // Klucz stanu budowy (NodeBuilderState) = klucz materiału obiektu + otoczenie: inne profile
  // kadłuba (inna geometria, te same atrybuty) i inne wartości — jeden NodeBuilder na wariant.
  assert.equal(materialCacheKey(hullA), materialCacheKey(hullB));
  assert.equal(materialCacheKey(sphereA), materialCacheKey(sphereB));
  assert.notEqual(materialCacheKey(hullA), materialCacheKey(sphereA));
  // Każdy klucz czytany przez graf ma wartość w material.uniforms (inaczej onObjectUpdate rzuca).
  for (const key of SHIELD_GRAPH_KEYS.hull) assert.ok(hullA.material.uniforms[key], `obrys: brak ${key}`);
  for (const key of SHIELD_GRAPH_KEYS.sphere) assert.ok(sphereA.material.uniforms[key], `sfera: brak ${key}`);
});

test('stan renderu jak w WebGL: addytywnie, bez zapisu głębi, test głębi passa ortho, FrontSide, bez świateł', () => {
  for (const m of [createHullShieldMaterialForTools(profile(300)), createSphereShieldMaterialForTools()]) {
    assert.equal(m.transparent, true);
    assert.equal(m.blending, THREE.AdditiveBlending);
    assert.equal(m.depthWrite, false);
    assert.equal(m.depthTest, true, 'kadłuby z passa ortho zasłaniają tarczę');
    assert.equal(m.side, THREE.FrontSide);
    assert.equal(m.lights, false);
    assert.equal(m.isShaderMaterial, undefined, 'nie ShaderMaterial (zamiennik)');
  }
});

test('WGSL obrysu i sfery: jedna pętla po 24 trafieniach, szum jako jedna funkcja, jedna tablica trafień, ≤ 12 buforów', () => {
  const p = profile(300);
  for (const [name, mesh] of [
    ['obrys', new THREE.Mesh(buildHullShieldGeometryForTools(p), createHullShieldMaterialForTools(p))],
    ['sfera', new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 16), createSphereShieldMaterialForTools())]
  ]) {
    const { vertex, fragment } = buildWGSL(mesh);
    assert.equal((fragment.match(/for \( var i : i32 = 0; i < 24; i \+\+ \)/g) || []).length, 1, `${name}: Loop(24), nie 24 kopie`);
    assert.equal((fragment.match(/^fn shieldSnoise/gm) || []).length, 1, `${name}: szum simplex jako funkcja WGSL`);
    assert.equal((fragment.match(/array< vec4<f32>, 24 >/g) || []).length, 1, `${name}: trafienia w jednej tablicy vec4 (xyz, czas)`);
    assert.ok(uniformBuffers(fragment) <= 12 && uniformBuffers(vertex) <= 12, `${name}: limit 12 buforów uniformów na etap`);
    assert.match(fragment, /discard/, `${name}: odrzucanie odsłoniętych fragmentów`);
    // Fresnel: podstawa potęgi obcięta do ≥ 0 (NaN z pow przy MSAA + HalfFloat).
    assert.match(fragment, /pow\( max\( \( 1\.0 - (abs\( )?dot\( vShieldNormal, vShieldViewDir \)/, `${name}: pow z max(…, 0)`);
    assert.doesNotMatch(fragment + vertex, /sunShadow|sunVisibility/, `${name}: tarcze nie czytają maski słońca`);
  }
});

test('wartości per obiekt: węzły grafu czytają material.uniforms rysowanego obiektu, trafienia pakowane per obiekt', () => {
  const pA = profile(250);
  const pB = profile(500);
  const a = createHullShieldMaterialForTools(pA);
  const b = createHullShieldMaterialForTools(pB);
  // Graf zbudowany (setup alokuje bufor tablicy trafień).
  buildWGSL(new THREE.Mesh(buildHullShieldGeometryForTools(pA), a));
  const graph = getShieldGraph('hull');
  for (const [key, node] of Object.entries(graph.uniforms)) assert.equal(node.updateType, 'object', `${key}: onObjectUpdate`);
  assert.equal(graph.hits.updateType, 'object', 'tablica trafień: pakowanie OBJECT (domyślnie RENDER — jedna tablica na render)');

  a.uniforms.uLife.value = 0.9;
  b.uniforms.uLife.value = 0.1;
  b.uniforms.uColor.value.set(0x22ff44);
  a.uniforms.uHitPos.value[0].set(10, 20, 0); a.uniforms.uHitTime.value[0] = 5.5;
  b.uniforms.uHitPos.value[0].set(-30, 40, 0); b.uniforms.uHitTime.value[0] = 7.25;
  b.uniforms.uHitPos.value[23].set(1, 2, 3); b.uniforms.uHitTime.value[23] = 8;

  const frame = (material) => ({ material, object: null });
  graph.uniforms.uLife.update(frame(a));
  assert.equal(graph.uniforms.uLife.value, 0.9);
  graph.uniforms.uLife.update(frame(b));
  assert.equal(graph.uniforms.uLife.value, 0.1);
  graph.uniforms.uColor.update(frame(b));
  assert.equal(graph.uniforms.uColor.value, b.uniforms.uColor.value);
  graph.uniforms.uHitImpactRadius.update(frame(a));
  assert.equal(graph.uniforms.uHitImpactRadius.value, a.uniforms.uHitImpactRadius.value);

  const packed = graph.hits.value;
  assert.ok(packed instanceof Float32Array && packed.length === SHIELD_MAX_HITS * 4);
  graph.hits.update(frame(a));
  assert.deepEqual([...packed.subarray(0, 4)], [10, 20, 0, 5.5]);
  assert.equal(packed[23 * 4 + 3], -999);
  graph.hits.update(frame(b));
  assert.deepEqual([...packed.subarray(0, 4)], [-30, 40, 0, 7.25]);
  assert.deepEqual([...packed.subarray(92, 96)], [1, 2, 3, 8]);
});

test('spawn floty: nowe tarcze to lekkie materiały bez budowy NodeBuildera', () => {
  const before = getShieldMaterialStats();
  const mats = [];
  for (let i = 0; i < 30; i++) mats.push(createHullShieldMaterialForTools(profile(180 + i * 15)));
  const after = getShieldMaterialStats();
  assert.equal(after.materials.hull - before.materials.hull, 30);
  assert.equal(after.builds.hull, before.builds.hull, 'setup() (NodeBuilder) woła tylko budowa, nie konstruktor');
  assert.equal(SHIELD_TSL_STATS.builds.hull, after.builds.hull);
  assert.ok(mats.every((m) => m.fragmentNode === mats[0].fragmentNode));
});

test('wstęgi i bańki trafień: TSL, jedna warstwa tarcz, DoubleSide w jednym przejściu, WGSL w Node', () => {
  const scene = new THREE.Scene();
  ShieldImpactFX.init(scene);
  const root = scene.children.find((c) => c.isGroup);
  assert.ok(root, 'grupa efektu w scenie');
  for (const mesh of root.children) {
    const m = mesh.material;
    assert.ok(m.isNodeMaterial && !m.isShaderMaterial, `${m.name}: materiał węzłowy`);
    assert.equal(m.forceSinglePass, true, `${m.name}: DoubleSide + przezroczystość = jedno przejście (inaczej WebGPU rysuje dwa)`);
    assert.equal(m.side, THREE.DoubleSide);
    assert.equal(m.blending, THREE.AdditiveBlending);
    assert.equal(m.depthTest, false);
    assert.equal(m.depthWrite, false);
    assert.equal(typeof m.uniforms.uTime.value, 'number', `${m.name}: adapter uniformów`);
    const { vertex, fragment } = buildWGSL(mesh);
    assert.match(fragment, /discard/);
    assert.ok(uniformBuffers(vertex) <= 12 && uniformBuffers(fragment) <= 12);
    assert.doesNotMatch(vertex + fragment, /sunShadow|sunVisibility/);
  }
  const ribbons = root.children.find((c) => c.material.uniforms.uTrailScale);
  const { vertex } = buildWGSL(ribbons);
  // Instancje: dane cząstki z atrybutów instancji, pozycja lokalna względem grupy (float64 na CPU).
  for (const attr of ['iOrigin', 'iVel', 'iBirth', 'iLife', 'iShape', 'iWobble', 'iColor']) assert.match(vertex, new RegExp(`${attr} : `));
  assert.equal(typeof ShieldImpactFX.prewarm, 'function', 'rozgrzewka pul w passie tarcz');
});

test('pliki tarcz bez GLSL (port zamknięty)', () => {
  for (const file of ['src/3d/shield3D.js', 'src/3d/shield3D.tsl.js', 'src/3d/shieldImpactFx.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /gl_FragColor|gl_Position|void\s+main\s*\(|\bvarying\s+(vec|float)|\buniform\s+(float|vec[234])\b|ShaderMaterial\(/, `${file}: GLSL`);
  }
});
