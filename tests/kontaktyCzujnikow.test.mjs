// Demo wyglądu KONTAKTU czujników (dema/kontakty-czujnikow.html): WGSL czterech propozycji i tła buduje się w Node,
// bez pow (ujemna podstawa = NaN), jeden blok kontaktów o stałej nazwie, graf raz na propozycję.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  createContactBlock, createContactMesh, createSpaceBackdrop, KONTAKT_STYLES, KONTAKT_MAX, KONTAKT_HDR
} from '../dema/kontakty-czujnikow/kontaktyTSL.js';

function build(renderer, mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return b;
}

test('propozycje kontaktu: WGSL w Node, bez pow, wspólny blok kontaktów', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const block = createContactBlock();
  assert.equal(block.array.length, KONTAKT_HDR + 2 * KONTAKT_MAX);
  const names = new Set();
  for (const style of KONTAKT_STYLES) {
    const mesh = createContactMesh(style, block);
    const t0 = performance.now();
    const b = build(renderer, mesh);
    const ms = performance.now() - t0;
    assert.ok(b.fragmentShader.length > 200, style);
    assert.doesNotMatch(b.fragmentShader, /\bpow\(/, `${style}: bez pow`);
    assert.match(b.fragmentShader, /kontaktyCzujnikow/, `${style}: blok o stałej nazwie`);
    assert.ok(ms < 2000, `${style}: budowa ${ms.toFixed(0)} ms`);
    names.add(mesh.material.name);
  }
  assert.equal(names.size, KONTAKT_STYLES.length);
  const core = { scene: new THREE.Scene(), pixelRatio: 1, pxScale: 1 };
  const bg = createSpaceBackdrop(core);
  const b = build(renderer, bg.mesh);
  assert.doesNotMatch(b.fragmentShader, /\bpow\(/);
  assert.ok(bg.mesh.layers.isEnabled(1));
});
