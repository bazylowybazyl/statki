// Zadanie 23 portu WebGPU (duża bitwa): wysyłka bufora uniformów jednym zapisem zamiast zapisu na uniform
// (Core3D._coalesceUniformUploads). three r183 (WebGPUBindingUtils.updateBinding) woła queue.writeBuffer
// osobno dla KAŻDEGO zmienionego uniformu — bitwa ~300 zapisów na klatkę. Scalony zakres [min, max) wysyła
// też bajty pomiędzy zmianami — muszą być na GPU takie same jak w kopii CPU. Test: prawdziwe UniformsGroup
// i WebGPUBindingUtils three na „GPU” z tablicy bajtów — po każdym kroku losowych zmian bufor GPU ścieżki
// scalonej = bufor GPU ścieżki three, bajt w bajt. Bez GPU.
// node --test tests/scalanieUniformow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import UniformsGroup from 'three/src/renderers/common/UniformsGroup.js';
import {
  NumberNodeUniform, Vector2NodeUniform, Vector3NodeUniform, Vector4NodeUniform, Matrix3NodeUniform, Matrix4NodeUniform, ColorNodeUniform
} from 'three/src/renderers/common/nodes/NodeUniform.js';
import WebGPUBindingUtils from 'three/src/renderers/webgpu/utils/WebGPUBindingUtils.js';

globalThis.window = globalThis.window || {};
const { Core3D } = await import('../src/3d/core3d.js');

// „GPU”: bufor = tablica bajtów, writeBuffer kopiuje wycinek (semantyka WebGPU dla tablic typowanych:
// dataOffset i size w elementach).
function makeBackend(counter) {
  const data = new WeakMap();
  return {
    get: (o) => { let d = data.get(o); if (!d) data.set(o, (d = {})); return d; },
    device: {
      queue: {
        writeBuffer(buf, bufferOffset, arr, dataOffset = 0, size) {
          counter.calls++;
          const el = arr.BYTES_PER_ELEMENT || 1;
          const n = size === undefined ? arr.length - dataOffset : size;
          const src = new Uint8Array(arr.buffer, arr.byteOffset + dataOffset * el, n * el);
          buf.bytes.set(src, bufferOffset);
        }
      }
    }
  };
}

function makeGroup() {
  const g = new UniformsGroup('test');
  // uniformy jak z NodeBuildera (NodeUniform: nazwa, wartość, typ) — też int / uint (widoki Int32 / Uint32 bufora)
  const nu = (name, value, type) => ({ name, value, type });
  const u = {
    t: new NumberNodeUniform(nu('t', 0, 'float')),
    a: new Vector2NodeUniform(nu('a', new THREE.Vector2(), 'vec2')),
    i: new NumberNodeUniform(nu('i', 0, 'int')),
    p: new Vector3NodeUniform(nu('p', new THREE.Vector3(), 'vec3')),
    q: new Vector4NodeUniform(nu('q', new THREE.Vector4(), 'vec4')),
    c: new ColorNodeUniform(nu('c', new THREE.Color(0, 0, 0), 'color')),
    n: new Matrix3NodeUniform(nu('n', new THREE.Matrix3(), 'mat3')),
    s: new NumberNodeUniform(nu('s', 0, 'uint')),
    m: new Matrix4NodeUniform(nu('m', new THREE.Matrix4(), 'mat4')),
    k: new NumberNodeUniform(nu('k', 0, 'float'))
  };
  for (const x of Object.values(u)) g.addUniform(x);
  return { g, u };
}

test('scalony zapis uniformów = zapisy three, bajt w bajt (losowe zmiany, 300 kroków)', () => {
  const cntA = { calls: 0 };
  const cntB = { calls: 0 };
  const beA = makeBackend(cntA);
  const beB = makeBackend(cntB);
  const utilsA = new WebGPUBindingUtils(beA);
  const utilsB = new WebGPUBindingUtils(beB);
  // ścieżka B: scalanie z Core3D (instalacja na obiekcie narzędzi jak w _configureRenderer)
  const core = Object.create(Core3D);
  core.uniformUploadStats = { merged: 0, savedWrites: 0 };
  core._coalesceUniformUploads({ backend: { bindingUtils: utilsB } });
  assert.equal(utilsB.__core3dUniformCoalesce, true);
  const A = makeGroup();
  const B = makeGroup();
  const len = A.g.byteLength;
  beA.get(A.g).buffer = { bytes: new Uint8Array(len) };
  beB.get(B.g).buffer = { bytes: new Uint8Array(len) };
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const keys = Object.keys(A.u);
  for (let step = 0; step < 300; step++) {
    // zmiana losowego podzbioru uniformów tymi samymi wartościami w obu grupach
    for (const k of keys) {
      if (rnd() < 0.55) continue;
      const v = (rnd() - 0.5) * 1000;
      for (const G of [A, B]) {
        const x = G.u[k];
        const val = x.getValue();
        if (typeof val === 'number') x.nodeUniform.value = x.getType() === 'float' ? v : Math.abs(Math.round(v));
        else if (val.isMatrix4 || val.isMatrix3) { const e = val.elements; for (let i = 0; i < e.length; i++) e[i] = v + i; }
        else if (val.isColor) val.setRGB(v, v * 0.5, -v);
        else if (val.isVector4) val.set(v, -v, v * 2, 1);
        else if (val.isVector3) val.set(v, v + 1, v - 1);
        else val.set(v, -v);
      }
    }
    for (const [G, U] of [[A, utilsA], [B, utilsB]]) {
      if (G.g.update()) U.updateBinding(G.g);
      G.g.clearUpdateRanges();
    }
    assert.deepEqual(beB.get(B.g).buffer.bytes, beA.get(A.g).buffer.bytes, `krok ${step}: GPU jak w three`);
  }
  assert.ok(cntB.calls < cntA.calls / 2, `mniej zapisów: ${cntB.calls} vs ${cntA.calls}`);
  assert.ok(core.uniformUploadStats.merged > 0 && core.uniformUploadStats.savedWrites > 0);
});

test('jeden zakres i pełna wysyłka (bez zakresów) — ścieżka three; instalacja raz', () => {
  const calls = [];
  const utils = {
    backend: { get: () => ({ buffer: {} }), device: { queue: { writeBuffer: () => calls.push('scalone') } } },
    updateBinding: () => calls.push('three')
  };
  const core = Object.create(Core3D);
  core.uniformUploadStats = { merged: 0, savedWrites: 0 };
  core._coalesceUniformUploads({ backend: { bindingUtils: utils } });
  const patched = utils.updateBinding;
  core._coalesceUniformUploads({ backend: { bindingUtils: utils } });
  assert.equal(utils.updateBinding, patched, 'bez podwójnej instalacji');
  utils.updateBinding({ updateRanges: [], buffer: new Float32Array(8) });
  utils.updateBinding({ updateRanges: [{ start: 0, count: 4 }], buffer: new Float32Array(8) });
  utils.updateBinding({ updateRanges: [{ start: 4, count: 1 }, { start: 0, count: 2 }], buffer: new Float32Array(8) });
  assert.deepEqual(calls, ['three', 'three', 'scalone']);
});

// 2026-10-07 (koszt renderu w bitwie): pełna wysyłka tablicy uniformów (NodeUniformBuffer, uniformArray) przy
// każdym rysunku / dispatchu — ta sama treść drugi raz bez zapisu. Stan „GPU” po każdym kroku = ścieżka three.
test('tablica uniformów: powtórna wysyłka tej samej treści pominięta, GPU bajt w bajt jak w three', async () => {
  const { default: NodeUniformBuffer } = await import('three/src/renderers/common/nodes/NodeUniformBuffer.js');
  const cntA = { calls: 0 };
  const cntB = { calls: 0 };
  const beA = makeBackend(cntA);
  const beB = makeBackend(cntB);
  const utilsA = new WebGPUBindingUtils(beA);
  const utilsB = new WebGPUBindingUtils(beB);
  const core = Object.create(Core3D);
  core.uniformUploadStats = { merged: 0, savedWrites: 0, skippedFull: 0, skippedBytes: 0 };
  core._coalesceUniformUploads({ backend: { bindingUtils: utilsB } });
  const makeBuf = () => {
    const nodeUniform = {
      value: new Float32Array(64), updateRanges: [],
      addUpdateRange(start, count) { this.updateRanges.push({ start, count }); },
      clearUpdateRanges() { this.updateRanges.length = 0; }
    };
    return new NodeUniformBuffer(nodeUniform, { name: 'object' });
  };
  const A = makeBuf();
  const B = makeBuf();
  assert.equal(B.isNodeUniformBuffer, true);
  beA.get(A).buffer = { bytes: new Uint8Array(256) };
  beB.get(B).buffer = { bytes: new Uint8Array(256) };
  let seed = 777;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let step = 0; step < 400; step++) {
    const roll = rnd();
    for (const X of [A, B]) {
      const arr = X.buffer;
      if (roll < 0.35) { /* ta sama treść — kolejny dispatch / rysunek */ }
      else if (roll < 0.7) arr[step % 64] = (step % 7) - 3;                               // jedna liczba
      else if (roll < 0.8) arr[step % 64] = step % 2 ? -0 : 0;                             // ±0 (bity!)
      else if (roll < 0.85) arr[(step * 5) % 64] = NaN;
      else if (roll < 0.95) { arr[3] = step; X.addUpdateRange(0, 8); }                      // wysyłka zakresem
      else { /* przebudowa wiązania: nowy bufor GPU (zera) */ }
    }
    if (roll >= 0.95) {
      beA.get(A).buffer = { bytes: new Uint8Array(256) };
      beB.get(B).buffer = { bytes: new Uint8Array(256) };
    }
    utilsA.updateBinding(A); A.clearUpdateRanges();
    utilsB.updateBinding(B); B.clearUpdateRanges();
    assert.deepEqual(beB.get(B).buffer.bytes, beA.get(A).buffer.bytes, `krok ${step}: GPU jak w three`);
  }
  assert.ok(core.uniformUploadStats.skippedFull > 60, `pominięte: ${core.uniformUploadStats.skippedFull}`);
  assert.ok(cntB.calls < cntA.calls, `mniej zapisów: ${cntB.calls} vs ${cntA.calls}`);
});
