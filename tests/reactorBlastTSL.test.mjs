// Wybuch reaktora na WebGPU (src/3d/reactorBlast/, demo dema/rdzen-webgpu.html): nowe pule w TSL
// budowane w Node (WGSLNodeBuilder bez GPU, atrapa kanwy — jak tests/mostkiRdzenieTSL.test.mjs).
// Pilnuje: braku GLSL, limitów sprzętowych (≤ 12 buforów uniformów na etap, ≤ 8 buforów
// wierzchołków na pipeline), stanów mieszania (kula: „over” premultiplied — sadza przysłania
// kadłub; strumień i duszki: ONE/ONE z alfą celu bez zmian), barwy plazmy normowanej do
// maksimum (nie luminancji) i decyzji usera: fala z refrakcją dla reaktorów domyślnie WYŁ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

import { PlasmaFireballSystem, PLASMA_KIND_ORB } from '../src/3d/reactorBlast/plasmaFireballs.js';
import { PlasmaJetSystem } from '../src/3d/reactorBlast/plasmaJets.js';
import { ReactorBlastFx } from '../src/3d/reactorBlast/reactorBlastFx.js';
import { normalizePlasma, REACTOR_PLASMA } from '../src/3d/reactorBlast/palette.js';
import { fxNoise } from '../src/3d/fx/noise.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function build(mesh, camera = new THREE.OrthographicCamera()) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = camera;
  b.context.material = mesh.material;
  b.build();
  return b;
}
function vertexBuffers(mesh, b) {
  const set = new Set();
  for (const a of b.attributes) {
    const ga = mesh.geometry.getAttribute(a.name);
    if (ga) set.add(ga.isInterleavedBufferAttribute ? ga.data : ga);
  }
  return set.size;
}
const uniformBuffers = (code) => (code.match(/var<uniform>/g) || []).length;
function limits(label, mesh) {
  const b = build(mesh);
  assert.ok(uniformBuffers(b.vertexShader) <= 12, `${label}: bufory uniformów (wierzchołki) ${uniformBuffers(b.vertexShader)}`);
  assert.ok(uniformBuffers(b.fragmentShader) <= 12, `${label}: bufory uniformów (fragmenty) ${uniformBuffers(b.fragmentShader)}`);
  const vb = vertexBuffers(mesh, b);
  assert.ok(vb <= 8, `${label}: ${vb} buforów wierzchołków > 8`);
  return b;
}

test('wybuch reaktora: pliki bez GLSL i bez Math.random (wizualia losują z fxRandom)', () => {
  for (const p of ['src/3d/reactorBlast/reactorBlastFx.js', 'src/3d/reactorBlast/plasmaFireballs.js',
    'src/3d/reactorBlast/plasmaJets.js', 'src/3d/reactorBlast/palette.js']) {
    const src = read(p);
    assert.doesNotMatch(src, /gl_FragColor|gl_Position\s*=|new THREE\.ShaderMaterial|vertexShader:|fragmentShader:|#define\s/, p);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /Math\.random/, `${p}: Math.random`);
  }
});

test('kula plazmy: WGSL w limitach, mieszanie „over” premultiplied, maska słońca na sadzy', () => {
  const scene = new THREE.Scene();
  const pool = new PlasmaFireballSystem({ scene, noise3D: fxNoise.noise3D(), capacity: 8 });
  const m = pool.material;
  assert.equal(m.blending, THREE.CustomBlending);
  assert.equal(m.blendSrc, THREE.OneFactor);
  assert.equal(m.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(m.depthWrite, false);
  assert.equal(m.forceSinglePass, true);
  const b = limits('ReactorPlasmaFireball', pool.mesh);
  assert.match(b.fragmentShader, /texture_3d/, 'objętość z tekstury szumu 3D');
  assert.match(b.fragmentShader, /texture_2d/, 'maska słońca (sunVisibility) na sadzy');
  // Wpis roboczy → atrybuty instancji (rodzaj kuli w pf2.w).
  pool.begin();
  Object.assign(pool.s, { x: 1, y: 2, z: 3, R: 40, kind: PLASMA_KIND_ORB, r: 1, g: 0.5, b: 0.25 });
  pool.push();
  pool.s.R = 0;
  pool.push(); // promień 0 — pominięta
  pool.commit(0, 0, 0);
  assert.equal(pool.geo.instanceCount, 1);
  assert.equal(pool.a2.array[3], PLASMA_KIND_ORB);
  assert.equal(pool.a0.array[3], 40);
  assert.equal(pool.mesh.visible, true);
  pool.clear();
  assert.equal(pool.mesh.visible, false);
});

test('strumień plazmy: WGSL w limitach, ONE/ONE z alfą celu bez zmian, bez maski słońca', () => {
  const scene = new THREE.Scene();
  const pool = new PlasmaJetSystem({ scene, noise2D: fxNoise.tile2D(), capacity: 4 });
  const m = pool.material;
  assert.equal(m.blending, THREE.CustomBlending);
  assert.equal(m.blendSrc, THREE.OneFactor);
  assert.equal(m.blendDst, THREE.OneFactor);
  assert.equal(m.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(m.blendDstAlpha, THREE.OneFactor);
  limits('ReactorPlasmaJet', pool.mesh);
  pool.begin();
  Object.assign(pool.s, { x: 0, y: 0, len: 0, dx: 3, dy: 4, intensity: 1 });
  pool.push(); // długość 0 — pominięty
  pool.s.len = 500;
  pool.push();
  pool.commit(0, 0.5, 0, 0);
  assert.equal(pool.geo.instanceCount, 1);
  assert.ok(Math.abs(pool.a1.array[0] - 0.6) < 1e-6 && Math.abs(pool.a1.array[1] - 0.8) < 1e-6, 'kierunek znormalizowany');
});

test('barwa plazmy: największy kanał = 1 (czerwień piratów nie ucieka w róż przez ACES)', () => {
  for (const [name, c] of Object.entries(REACTOR_PLASMA)) {
    const n = normalizePlasma(c);
    assert.ok(Math.abs(Math.max(...n) - 1) < 1e-9, name);
    assert.ok(n.every((v) => v >= 0 && v <= 1), name);
  }
  const p = normalizePlasma(REACTOR_PLASMA.pirate);
  assert.equal(p[0], 1);
});

test('reżyser: krok klatki efektów Core3D, fala z refrakcją domyślnie WYŁ. (decyzja usera 2026-09-24)', () => {
  const steps = [];
  const core = { scene: new THREE.Scene(), fx: {}, addFxStep(s) { steps.push(s); } };
  const fx = new ReactorBlastFx(core, {});
  assert.equal(fx.opts.shock, false, 'fala tylko w supernowej rakiet');
  assert.equal(steps.length, 1);
  assert.equal(steps[0].name, 'reaktor-rdzen');
  assert.equal(typeof steps[0].update, 'function');
  assert.equal(typeof steps[0].warm, 'function', 'rozgrzewka przez krok (rejestr Core3D.warmup)');
  const names = fx.meshes.map((m) => m.name).sort();
  assert.deepEqual(names, ['ReactorGlow', 'ReactorPlasmaFireballs', 'ReactorPlasmaJets']);
  for (const m of fx.meshes) assert.equal(m.parent, core.scene);
});
