import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

import { Core3D } from '../src/3d/core3d.js';
import { ShipLights3D } from '../src/3d/shipLights3D.js';
import { NAV_LIGHT_CHASE } from '../src/game/shipLightRuntime.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const shipLightsSource = read('src/3d/shipLights3D.js');
const hexShipsSource = read('src/3d/hexShips3D.js');
const hullTslSource = read('src/3d/hexShips3D.tsl.js');
const coreSource = read('src/3d/core3d.js');

// WGSL w Node: renderer bez init (atrapa kanwy i limitów) — jak tests/hexShips3DShader.test.mjs.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

// Moduł tworzy mesh leniwie, gdy Core3D ma scenę (w Node bez GPU — atrapa stanu).
function nodeLights() {
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  ShipLights3D.dispose();
  assert.ok(ShipLights3D._ensure());
  return ShipLights3D;
}

test('nav light billboards render on the FG layer with additive HDR blending', () => {
  // Warstwa 2 = renderPassFg, addytywnie i HDR — przebijają cień planety.
  const L = nodeLights();
  try {
    assert.ok(L.mesh.layers.isEnabled(2) && !L.mesh.layers.isEnabled(0), 'warstwa FG');
    assert.ok(L.material.isNodeMaterial, 'materiał węzłowy (port WebGPU, zadanie 15)');
    assert.equal(L.material.blending, THREE.AdditiveBlending);
    assert.equal(L.material.depthTest, false);
    assert.equal(L.material.depthWrite, false);
    assert.equal(L.material.transparent, true);
    // Przezroczysty DoubleSide w WebGPU rysowałby dwa razy (WebGL ShaderMaterial: raz).
    assert.equal(L.material.side, THREE.DoubleSide);
    assert.equal(L.material.forceSinglePass, true);
    assert.equal(L.mesh.renderOrder, 52);
    // Wartości aktualizowane jak w ShaderMaterial (adapter material.uniforms).
    L.sync([{ x: 10, y: -20, haloWorld: 30, coreWorld: 3, intensity: 2, phase: 0.4, color: { r: 1, g: 0.2, b: 0.1 } }], 3.5);
    assert.equal(L.material.uniforms.uTime.value, 3.5);
    assert.equal(L.mesh.count, 1);
    // Zakres uploadu tylko żywych instancji (backend WebGPU respektuje zakresy atrybutów).
    assert.deepEqual(L.geometry.getAttribute('aParams').updateRanges.map((r) => [r.start, r.count]), [[0, 3]]);
    assert.notEqual(L.geometry.getAttribute('aParams').usage, THREE.DynamicDrawUsage, 'DynamicDrawUsage = pełny upload co render w WebGPU');
  } finally {
    ShipLights3D.dispose();
  }
});

test('nav lights are emitters: the sun shadow mask never dims them', () => {
  // Cień słońca to maska czytana przez oświetlane powierzchnie; quad mnożący
  // gotowy obraz (dawniej przed FG) gasił emisję warstwy 0 pod progiem bloomu.
  assert.ok(!/sunShadowUniforms|SUN_SHADOW_GLSL|sunVisibility/.test(shipLightsSource));
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.ok(scenePassList.includes('this.renderPassFg'), 'FG pass missing from the scene chain');
  assert.ok(!scenePassList.includes('this.shadowShaftsPass'), 'no image-multiply shadow pass in the scene chain');
  // Pass FG (runner Core3D, port WebGPU): warstwa 2, kamera perspektywy, własna głębia, ostatni w łańcuchu.
  assert.match(coreSource, /this\.renderPassFg = makeScenePass\('fg', 'fg', 2, false, false\);/);
  assert.ok(scenePassList.trim().endsWith('this.renderPassFg'), 'FG kładzie się na wierzchu sceny');
});

test('hull shader and billboard shader share the NAV_LIGHT_CHASE sequence', () => {
  // Obie strony biorą stałe z NAV_LIGHT_CHASE (billboardy i kadłub: węzły TSL —
  // shipLights3D.js, hexShips3D.tsl.js) — zmiana tempa/kierunku sekwencji w jednym
  // miejscu nie może rozjechać drugiego.
  assert.match(shipLightsSource, /fract\(U\.uTime\.mul\(NAV_LIGHT_CHASE\.speed\)\.add\(vParams\.x\.mul\(NAV_LIGHT_CHASE\.phaseGain\)\)\)/);
  assert.match(hullTslSource, /fract\(uTime\.mul\(NAV_LIGHT_CHASE\.speed\)\.add\(localPhase\.mul\(NAV_LIGHT_CHASE\.phaseGain\)\)\)/);
  // Znak "+" przy fazie = przebieg od dziobu (faza 1) ku rufie (faza 0).
  assert.doesNotMatch(hullTslSource, /NAV_LIGHT_CHASE\.speed\)\.sub\(localPhase/);
  assert.doesNotMatch(shipLightsSource, /NAV_LIGHT_CHASE\.speed\)\.sub\(/);
  for (const k of ['attack', 'hold', 'release', 'rest']) {
    assert.ok(hullTslSource.includes(`NAV_LIGHT_CHASE.${k}`), k);
    assert.ok(shipLightsSource.includes(`NAV_LIGHT_CHASE.${k}`), k);
  }
  // Stałe trafiają do WGSL billboardów (bez tekstu GLSL).
  const L = nodeLights();
  try {
    const { vertex, fragment } = buildWGSL(L.mesh);
    for (const k of ['speed', 'phaseGain', 'attack', 'hold', 'release', 'rest']) {
      assert.ok(fragment.includes(String(NAV_LIGHT_CHASE[k])), `${k} = ${NAV_LIGHT_CHASE[k]} w WGSL`);
    }
    // Pozycja instancji: macierz instancji three (bufor uniformów przy ≤ 1024 instancjach).
    assert.match(vertex, /mat4x4<f32>/);
    for (const stage of [vertex, fragment]) assert.ok((stage.match(/var<uniform>/g) || []).length <= 12);
  } finally {
    ShipLights3D.dispose();
  }
});

test('hexShips3D feeds visible ships into the nav light billboard sync', () => {
  // drawHex = statki w pudle RYSOWANIA (kadr + margines); visibleHex to
  // szersze pudło rozgrzania (9 ekranów), którego billboardy nie potrzebują.
  assert.match(hexShipsSource, /buildPositionLightWorldSprites\(drawHex/);
  assert.match(hexShipsSource, /ShipLights3D\.sync\(state\.navLightSprites/);
  assert.match(hexShipsSource, /ShipLights3D\.dispose\(\)/);
});
