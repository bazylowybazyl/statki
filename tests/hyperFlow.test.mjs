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

// ── kamera: lekkie pchnięcie zamiast kopu warpa (cameraRig.js — input.hyper) ─────────────────────────────

import { createCameraRig, cameraRigTune, stepCameraRigWarp, noteCameraRigWarp, CAMERA_WARP_PULSES, cameraWarpPulse } from '../src/game/cameraRig.js';

function rigRun(hyper) {
  const rig = createCameraRig();
  const tune = cameraRigTune;
  const w = { dt: 1 / 120, state: 'idle', charge: 0, dirX: 0, dirY: -1, enabled: true, suspend: false, exitAge: -1,
    exitSlow: 0.7, exitHalt: 1.35, rulon: false, zoomRef: 0, zoomBase: 0, arriving: false, arrivalDist: -1,
    arrivalDepthK: 0, viewW: 1920, viewH: 1080, hyper };
  const out = { maxShake: 0, maxLag: 0, minF: Infinity, maxF: 0 };
  // rozruch 3 s
  w.state = 'charging';
  for (let i = 0; i <= 360; i++) {
    w.charge = Math.min(1, i / 360);
    stepCameraRigWarp(rig, w, tune);
    out.maxShake = Math.max(out.maxShake, rig.warpShakePx);
  }
  w.state = 'active';
  noteCameraRigWarp(rig, 'kick');
  const holdLog = Math.log(tune.warpZoomOut);
  for (let i = 0; i < 360; i++) {
    stepCameraRigWarp(rig, w, tune);
    out.maxLag = Math.max(out.maxLag, rig.warpLagPx);
    out.minF = Math.min(out.minF, Math.exp(rig.warpZoomLog - holdLog));
  }
  // wyjście: stan schodzi do 'idle' (impuls wyjścia liczy zatrzask z lotu)
  w.state = 'idle';
  noteCameraRigWarp(rig, 'exit');
  for (let i = 0; i < 30; i++) {
    stepCameraRigWarp(rig, w, tune);
    out.maxF = Math.max(out.maxF, Math.exp(rig.warpZoomLog) / rig.warpHold);
  }
  return out;
}

test('kamera hipercruise\'u v2: cofnięcie × hyperKickScale, impulsy zoomu × hyperZoomPulse (także wyjście po zejściu do idle), bez drżenia rozruchu; warp bez zmian', () => {
  const warp = rigRun(false);
  const hyper = rigRun(true);
  const peak = cameraWarpPulse(0.112, CAMERA_WARP_PULSES.lagRise, CAMERA_WARP_PULSES.lagFall);
  assert.ok(Math.abs(warp.maxLag - cameraRigTune.warpKickPx * peak) < 2, `warp: ${warp.maxLag}`);
  assert.ok(Math.abs(hyper.maxLag - warp.maxLag * cameraRigTune.hyperKickScale) < 1e-6, `hipercruise: ${hyper.maxLag}`);
  assert.ok(hyper.maxLag < 50, 'pchnięcie, nie wyrzut');
  assert.ok(warp.maxShake > 3.9, 'warp: drżenie ładowania 4 px');
  assert.equal(hyper.maxShake, cameraRigTune.hyperChargeShakePx, 'hipercruise: bez drżenia rozruchu');
  const kickW = 1 - warp.minF;
  const kickH = 1 - hyper.minF;
  assert.ok(Math.abs(kickH - kickW * cameraRigTune.hyperZoomPulse) < 2e-3, `impuls zoomu przy starcie ${kickH} vs ${kickW}`);
  const exitW = warp.maxF - 1;
  const exitH = hyper.maxF - 1;
  assert.ok(exitW > 0.05, `warp: impuls wyjścia ${exitW}`);
  assert.ok(Math.abs(exitH - exitW * cameraRigTune.hyperZoomPulse) < 3e-3, `impuls wyjścia hipercruise'u ${exitH} vs ${exitW}`);
});

test('kamera hipercruise\'u v2: skala impulsu zapamiętana w chwili zdarzenia — wyjście hipercruise\'u przerwanego ładowaniem warpa i kop w oknie przylotu warpa', () => {
  const tune = cameraRigTune;
  const mk = () => ({ dt: 1 / 120, state: 'idle', charge: 0, dirX: 0, dirY: -1, enabled: true, suspend: false, exitAge: -1,
    exitSlow: 0.7, exitHalt: 1.35, rulon: false, zoomRef: 0, zoomBase: 0, arriving: false, arrivalDist: -1,
    arrivalDepthK: 0, viewW: 1920, viewH: 1080, hyper: false });
  // (1) hipercruise 'active' → w tej samej klatce ładowanie warpa (hyper: false): wyjście hipercruise'u w skali pchnięcia
  const rig = createCameraRig();
  const w = mk();
  w.state = 'active'; w.hyper = true;
  for (let i = 0; i < 120; i++) stepCameraRigWarp(rig, w, tune);
  noteCameraRigWarp(rig, 'exit');
  w.state = 'charging'; w.hyper = false; w.charge = 0;
  stepCameraRigWarp(rig, w, tune);
  assert.equal(rig.warpExitHyper, true, 'wyjście zapamiętało skalę hipercruise\'u');
  assert.equal(rig.warpHyper, false, 'stan riga przeszedł na warp');
  // (2) kop hipercruise'u przy stanie 'idle' riga (okno kadru przylotu warpa: hyperCam = false, w.hyper ze stanu automatu)
  const rig2 = createCameraRig();
  const w2 = mk();
  w2.hyper = true;
  stepCameraRigWarp(rig2, w2, tune);
  noteCameraRigWarp(rig2, 'kick');
  let lag = 0;
  for (let i = 0; i < 120; i++) { stepCameraRigWarp(rig2, w2, tune); lag = Math.max(lag, rig2.warpLagPx); }
  assert.equal(rig2.warpKickHyper, true);
  assert.ok(lag < tune.warpKickPx * 0.7 * tune.hyperKickScale + 1, `pchnięcie, nie kop warpa (${lag})`);
  // (3) warp gracza: pełny kop
  const rig3 = createCameraRig();
  const w3 = mk();
  w3.state = 'charging';
  stepCameraRigWarp(rig3, w3, tune);
  w3.state = 'active';
  noteCameraRigWarp(rig3, 'kick');
  let lag3 = 0;
  for (let i = 0; i < 120; i++) { stepCameraRigWarp(rig3, w3, tune); lag3 = Math.max(lag3, rig3.warpLagPx); }
  assert.equal(rig3.warpKickHyper, false);
  assert.ok(lag3 > tune.warpKickPx * 0.6, `warp: pełny kop (${lag3})`);
});

test('opływ: faza wzoru całkowana na CPU (zmiana prędkości nie przewija wzoru), przepływ ograniczony długością wzoru, zanik na brzegu kwadu', () => {
  const src = read('src/3d/warp/hyperFlow.js');
  assert.ok(!/U\.time/.test(src), 'bez czas × przepływ w shaderze');
  assert.match(src, /flowPh\.sheath = \(flowPh\.sheath \+ vS \* step\) % PHASE_WRAP;/);
  assert.match(src, /const vS = Math\.min\(v, T\.aliasK \* 3\.2 \* r\);/);
  assert.match(src, /x\.sub\(phase\)\.div\(lenA\)/);
  assert.match(src, /mul\(edge\)/, 'zanik do zera na brzegu kwadu');
  const T = HYPER_FLOW_TUNE;
  // druga oktawa (× 0,6 / 0,25 gęściej, faza × 1,15) przesuwa się ≤ ~¼ komórki szumu na klatkę przy 60 kl/s
  const perFrame = (T.aliasK * 1.15 / 60) * 0.6 * 4;
  assert.ok(perFrame <= 0.3, `${perFrame}`);
  // otoczka gaśnie z maskowaniem (najniższa widoczność dysz tej klatki)
  assert.match(src, /const sheathK = ship\.sheath \* ship\.cloakVis;/);
  const vfx = read('src/3d/engineVfxSystem.js');
  assert.match(vfx, /HyperFlow\.nozzle\(nozzleWorldX, nozzleWorldY, dirX, dirY, nozzleR \* cloakVis, cloakVis\)/);
  assert.match(vfx, /if \(hyper \|\| mode !== 'off'\) plume\.setHyper\(hyper\);/);
});
