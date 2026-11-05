// WGSL obrazu wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2.2, § 4.1), budowany w Node bez GPU: limit buforów storage, dostęp i osłona uN.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createWokseleSolver } from '../dema/woksele-zawalenia/solver.js';
import { createWokseleObraz } from '../dema/woksele-zawalenia/obraz.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const wgsl = (k) => {
  const b = renderer.backend.createNodeBuilder(k, renderer);
  b.build();
  return b.computeShader;
};

const solver = createWokseleSolver();
const camera = new THREE.PerspectiveCamera(32, 1, 20, 700000);
const obraz = createWokseleObraz({ solver, camera });

test('kObraz i kGruz: najwyżej 8 buforów storage (§ 2.2), kObraz czyta solver tylko do odczytu', () => {
  const kod = wgsl(obraz.kernele.kObraz);
  const ile = (kod.match(/var<storage/g) || []).length;
  assert.ok(ile <= 8, `kObraz ma ${ile} buforów storage`);
  assert.match(kod, /var<storage, read> \w*[wW]okWez/);
  assert.match(kod, /var<storage, read> \w*[wW]okMaska/);
  assert.match(kod, /var<storage, read> \w*[wW]okWiaz/);
  assert.match(kod, /atomicAdd/);
  assert.ok((wgsl(obraz.kernele.kGruz).match(/var<storage/g) || []).length <= 8);
});

test('kObraz: osłona uN i limit wzrostu dObraz są w kodzie, bez literału NaN ani Infinity', () => {
  const kod = wgsl(obraz.kernele.kObraz);
  assert.match(kod, /uLimD/);
  assert.doesNotMatch(kod, /Infinity|NaN/);
});
