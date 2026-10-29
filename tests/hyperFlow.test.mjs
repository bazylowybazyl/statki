// HIPERCRUISE v2 (2026-10-29, zgłoszenie użytkownika: „popraw efekt hypercruise — obecnie za mocno drga i robi kołowe haze …
// skupiamy się na silnikach … dać [haze] większego z silników i efekt à la opływowy, aerodynamiczny haze wzdłuż statku
// w dół — żeby oddać prędkość”): opływ na warstwie DIST (src/3d/warp/hyperFlow.js), A/B dawnego wyglądu
// (src/3d/warp/hyperLook.js — `?hcStary=1`), większe gorące powietrze dysz (engineVfxSystem.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

import { hyperFlowEnvelope, HyperFlow, HyperFlowInternals, HYPER_FLOW_TUNE, HYPER_FLOW_NOZZLE_CAP } from '../src/3d/warp/hyperFlow.js';
import { hyperLegacyLookOn, setHyperLegacyLook, HYPER_LOOK } from '../src/3d/warp/hyperLook.js';
import { FX_DISTORT_LAYER } from '../src/3d/fx/fxFrame.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('A/B: `?hcStary=1` przywraca dawny wygląd hipercruise\'u (adres strony, wymuszenie z testów)', () => {
  assert.equal(hyperLegacyLookOn(''), false);
  assert.equal(hyperLegacyLookOn('?dev=1&hcStary=1'), true);
  assert.equal(hyperLegacyLookOn('?hcStary=10'), false);
  assert.equal(hyperLegacyLookOn('?hcStary=1&renderWorker=1'), true);
  setHyperLegacyLook(true);
  try { assert.equal(hyperLegacyLookOn(''), true); } finally { setHyperLegacyLook(null); }
  assert.equal(hyperLegacyLookOn(''), false);
});

test('obwiednia opływu: rozruch — sama struga dysz, lot — otoczka rośnie z prędkością, wyjście — gaśnie od siły z lotu', () => {
  const hold = { sheath: 0, wake: 0 };
  const out = { sheath: 0, wake: 0 };
  const T = HYPER_FLOW_TUNE;
  // rozruch: bez otoczki, struga rośnie z ładowaniem do spoolWake
  hyperFlowEnvelope('charging', 0, -1e9, -1e9, 0.2, 0, 20000, hold, out);
  assert.equal(out.sheath, 0);
  assert.equal(out.wake, 0, 'początek rozruchu — nic');
  hyperFlowEnvelope('charging', 0, -1e9, -1e9, 1, 0, 20000, hold, out);
  assert.ok(Math.abs(out.wake - T.spoolWake) < 1e-12);
  // lot: tuż po kopie otoczka 0 (prędkość ~0), struga nie słabsza niż w rozruchu
  hyperFlowEnvelope('warp', 10, 10, -1e9, 1, 0, 20000, hold, out);
  assert.equal(out.sheath, 0);
  assert.ok(out.wake >= T.spoolWake * 0.55 - 1e-12);
  // pełna prędkość po narastaniu: obie siły 1
  hyperFlowEnvelope('warp', 20, 10, -1e9, 1, 20000, 20000, hold, out);
  assert.ok(Math.abs(out.sheath - 1) < 1e-12 && Math.abs(out.wake - 1) < 1e-12, JSON.stringify(out));
  // monotonicznie z prędkością
  let prev = -1;
  for (let v = 0; v <= 20000; v += 1000) {
    hyperFlowEnvelope('warp', 20, 10, -1e9, 1, v, 20000, hold, out);
    assert.ok(out.sheath >= prev - 1e-12);
    prev = out.sheath;
  }
  // wyjście: od siły z lotu do zera w exitFade s
  hyperFlowEnvelope('warp', 20, 10, -1e9, 1, 20000, 20000, hold, out);
  hyperFlowEnvelope('exit', 30, 10, 30, 0, 0, 20000, hold, out);
  assert.ok(Math.abs(out.sheath - 1) < 1e-12, 'pierwsza klatka wyjścia — siła z lotu');
  hyperFlowEnvelope('exit', 30 + T.exitFade * 0.5, 10, 30, 0, 0, 20000, hold, out);
  assert.ok(out.sheath > 0.2 && out.sheath < 0.8);
  hyperFlowEnvelope('exit', 30 + T.exitFade + 0.01, 10, 30, 0, 0, 20000, hold, out);
  assert.equal(out.sheath, 0);
  assert.equal(out.wake, 0);
  hyperFlowEnvelope('idle', 40, 10, 30, 0, 0, 20000, hold, out);
  assert.equal(out.sheath + out.wake, 0);
});

// ── WGSL w Node (bez GPU) ────────────────────────────────────────────────────────────────────

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => (wgsl.match(/@location\( ?\d+ ?\) [A-Za-z_]+ : /g) || []).length;

test('materiał opływu: WGSL w limitach, mieszanie One/One (DIST sumuje przesunięcia), bez głębi, bez pow', () => {
  const { makeFlowMaterial, STRIDE } = HyperFlowInternals;
  const noise = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  noise.needsUpdate = true;
  const mat = makeFlowMaterial(noise);
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.setIndex(base.index);
  g.setAttribute('position', base.getAttribute('position'));
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(STRIDE * 2), STRIDE, 1);
  for (const [name, off] of [['iFlowA', 0], ['iFlowB', 4], ['iFlowC', 8]]) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, off));
  g.instanceCount = 2;
  const mesh = new THREE.Mesh(g, mat);
  const w = buildMesh(mesh);
  assert.ok(vertexInputs(w.vertex) <= 8, 'najwyżej 8 buforów wierzchołków');
  assert.ok(uniformBuffers(w.vertex) <= 12 && uniformBuffers(w.fragment) <= 12);
  assert.ok(!/\bpow\(/.test(w.fragment), 'bez pow() — NaN w HalfFloat');
  assert.equal(mat.blending, THREE.CustomBlending);
  assert.equal(mat.blendSrc, THREE.OneFactor);
  assert.equal(mat.blendDst, THREE.OneFactor);
  assert.equal(mat.blendSrcAlpha, THREE.OneFactor);
  assert.equal(mat.blendDstAlpha, THREE.OneFactor);
  assert.equal(mat.depthTest, false);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.forceSinglePass, true);
  // B = A = 0 (kanały maskowania): wyjście vec4(przesunięcie, 0, 0)
  assert.match(w.fragment, /vec4<f32>\s*\(\s*[^;]*,\s*0\.0\s*,\s*0\.0\s*\)/);
});

test('moduł: warstwa DIST, rozgrzewka z wariantem instancji, zgłoszenie warstwy z kroku efektów, nie z WarpNurt.update', () => {
  const src = read('src/3d/warp/hyperFlow.js');
  assert.match(src, /mesh\.layers\.set\(FX_DISTORT_LAYER\)/);
  assert.match(src, /Core3D\.warmup\?\.add\(\{[\s\S]*?layer: FX_DISTORT_LAYER, phase: 'loading',[\s\S]*?variant: WARIANT_INSTANCJI/);
  assert.match(src, /update\(\) \{ if \(HyperFlow\._commit\(\)\) Core3D\.setDistortLayerActive\(true\); \}/);
  assert.ok(!/Math\.random|window\.|document\./.test(src.replace(/\/\/.*$/gm, '')), 'render w workerze: bez window / DOM / Math.random');
  assert.equal(FX_DISTORT_LAYER, 10);
  const nurt = read('src/3d/warp/warpNurt.js');
  assert.match(nurt, /HyperFlow\.setShip\(pose\.x, pose\.y, pose\.angle, g\.length, g\.width, env\.sheath, env\.wake, g\.cruise, t, zoom\)/);
  assert.ok(!/setDistortLayerActive/.test(nurt), 'flagę DIST kasuje start klatki efektów — zgłoszenie z kroku');
  const vfx = read('src/3d/engineVfxSystem.js');
  assert.match(vfx, /if \(hyperHaze && isPlayerEntity && nozzleR > 0\) HyperFlow\.nozzle\(/);
  assert.ok(HYPER_FLOW_NOZZLE_CAP >= 8, 'Atlas ma 5 dysz MAIN, drednot więcej');
});

test('gorące powietrze dysz w hipercruisie: większy stożek, źródło cofnięte pod prąd; poza hipercruise\'em bez zmian', () => {
  const H = HYPER_LOOK.haze;
  assert.ok(H.radius > 1.4 && H.radius < 3, 'stożek 1,4–3× dłuższy i szerszy');
  assert.ok(H.radius * H.strength > 1, 'więcej gorącego powietrza niż dawniej (siła × rozmiar)');
  const vfx = read('src/3d/engineVfxSystem.js');
  assert.match(vfx, /Core3D\.pushHeatHazeWorld\(nozzleWorldX - dirX \* back, nozzleWorldY - dirY \* back, -4, nozzleR \* H\.radius,/);
  assert.match(vfx, /Core3D\.pushHeatHazeWorld\(nozzleWorldX, nozzleWorldY, -4, nozzleR \* \(plume \? 1 : p\.widthMul\), hazeK, dirX, dirY\);/);
});

test('partia: bez statku nic nie rysuje; setShip bez siły nie uzbraja (dysze z tej klatki odpadają)', () => {
  assert.equal(HyperFlow._commit(), false);
  assert.equal(HyperFlow.setShip(0, 0, 0, 2000, 400, 0, 0, 0, 0, 0.1), false);
  HyperFlow.nozzle(0, 0, 0, -1, 30);
  assert.equal(HyperFlow._commit(), false);
});
