// Koziołkowanie skał tła (strumień D planu pasa, etap D2, 2026-10-12): funkcja TSL rockSpinQuat
// (src/3d/asteroids/rockSpin.tsl.js i kopia dema) — bez koziołkowania ten sam WGSL co dawne
// wyrażenie obrotu w rockMaterial.js; z koziołkowaniem graf buduje się (WebGPURenderer bez
// init, atrapa kanwy — wzór tests/miningRenderTSL.test.mjs).
// node --test tests/rockSpinTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };

const THREE = await import('three/webgpu');
const { attribute, uniform, vec3, vec4, sin, cos, positionGeometry } = await import('three/tsl');
const { quatMul, quatRotate } = await import('../src/3d/asteroids/tslCommon.js');
const { rockSpinQuat } = await import('../src/3d/asteroids/rockSpin.tsl.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;

function meshWith(spinFn) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const data = new Float32Array(12);
  const buf = new THREE.InstancedInterleavedBuffer(data, 12, 1);
  geo.setAttribute('iRot', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iSpin', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iShape', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  const mat = new THREE.NodeMaterial();
  const time = uniform(0).setName('rockSpinTime');
  const iRot = attribute('iRot', 'vec4');
  const iSpin = attribute('iSpin', 'vec4');
  const iShape = attribute('iShape', 'vec4');
  const q = spinFn(iRot, iSpin, iShape, time);
  mat.positionNode = quatRotate(q, positionGeometry);
  return new THREE.Mesh(geo, mat);
}

function build(mesh) {
  const b = wgsl.backend.createNodeBuilder(mesh, wgsl);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return b.vertexShader;
}

test('bez koziołkowania: ten sam WGSL co dawne wyrażenie obrotu (pasmo gry, minerały, wydobycie)', () => {
  const old = build(meshWith((iRot, iSpin, iShape, time) => {
    const ang = iShape.w.add(iSpin.w.mul(time)).mul(0.5).toVar();
    return quatMul(vec4(iSpin.xyz.mul(sin(ang)), cos(ang)), iRot).toVar();
  }));
  const now = build(meshWith((iRot, iSpin, iShape, time) => rockSpinQuat(iRot, iSpin, iShape, time, false)));
  const norm = (s) => s.replace(/nodeVar\d+/g, 'v').replace(/NodeBuffer_\d+/g, 'B');
  assert.equal(norm(now), norm(old));
});

test('z koziołkowaniem: graf buduje się, precesja tylko pod warunkiem udziału (select)', () => {
  const v = build(meshWith((iRot, iSpin, iShape, time) => rockSpinQuat(iRot, iSpin, iShape, time, true)));
  assert.ok(v.length > 200);
  assert.ok(/fract\(/.test(v), 'udział i tempo z ziarna (fract)');
  assert.ok(/select\(|if \(/.test(v), 'gałąź koziołkowania');
});

test('kopia dema = kopia gry (poza ścieżką importu)', () => {
  const game = readFileSync(new URL('../src/3d/asteroids/rockSpin.tsl.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const demo = readFileSync(new URL('../dema/asteroidy-webgpu/rockSpin.tsl.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = (s) => s.split('\n').filter((l) => !l.startsWith('// dema/') && !l.startsWith('// src/') && !l.includes('asteroidRotation.js')).join('\n');
  assert.equal(body(demo), body(game));
});
