// Zadanie 23 portu WebGPU (wydajność CPU): bloom w jednym passie compute (src/3d/tsl/bloomCompute.js) zamiast
// 12 renderów BloomNode. Ten sam algorytm co BloomNode three r183 (= dawny UnrealBloomPass WebGL): rozmiary
// celów, jądra, współczynniki, kolejność działań; WGSL kerneli budowany w Node (bez GPU). Parzystość na GPU
// (wyjście compute vs BloomGry bit w bit): scripts/webgpu/bloom-parzystosc.mjs.
// node --test tests/bloomCompute.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { BloomGryCompute, BLOOM_MIPY, rozmiaryBloomu, wspolczynnikiJadra } = await import('../src/3d/tsl/bloomCompute.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const readModule = (spec) => readFileSync(fileURLToPath(import.meta.resolve(spec)), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const buildCompute = (node) => {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
};

test('rozmiary i jądra jak BloomNode three r183 (BloomGry.setSize + BloomNode.setSize)', () => {
  assert.deepEqual(rozmiaryBloomu(1920, 1080, 1).map((r) => r.join('x')), ['960x540', '480x270', '240x135', '120x68', '60x34']);
  assert.deepEqual(rozmiaryBloomu(1920, 1080, 0.5)[0], [480, 270]);
  assert.deepEqual(rozmiaryBloomu(1920, 1080, 0)[0], [960, 540], 'skala 0 / NaN = pełna (jak _getBloomConfig: 0,1…1)');
  assert.equal(BLOOM_MIPY, 5);
  const node = readModule('three/addons/tsl/display/BloomNode.js');
  // strażnik: three zmieni algorytm — zmień kernele (bloomCompute.js) razem z nim
  assert.match(node, /const kernelSizeArray = \[ 6, 10, 14, 18, 22 \];/);
  assert.match(node, /coefficients\.push\( 0\.39894 \* Math\.exp\( - 0\.5 \* i \* i \/ \( sigma \* sigma \) \) \/ sigma \);/);
  assert.match(node, /let resx = Math\.round\( width \/ 2 \);/);
  assert.match(node, /const bloomFactors = uniformArray\( \[ 1\.0, 0\.8, 0\.6, 0\.4, 0\.2 \] \);/);
  assert.match(node, /const alpha = smoothstep\( this\.threshold, this\.threshold\.add\( this\.smoothWidth \), v \);/);
  assert.match(node, /return sum\.mul\( this\.strength \);/);
  const c = wspolczynnikiJadra(6);
  const sigma = 2;
  assert.equal(c.length, 6);
  assert.equal(c[3], 0.39894 * Math.exp(-0.5 * 9 / (sigma * sigma)) / sigma);
});

test('12 kerneli w jednej liście: próg, 5 × (poziom, pion), kompozyt — WGSL z próbkowaniem poziomu 0 i zapisem do celu', () => {
  const src = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType });
  const bloom = new BloomGryCompute(src.texture, 0.85, 0.4, 0.9);
  const k = bloom._kernels;
  assert.equal(k.length, 12);
  assert.deepEqual(k.map((n) => n.name), ['bloomProg', 'bloomPoziom0', 'bloomPion0', 'bloomPoziom1', 'bloomPion1', 'bloomPoziom2', 'bloomPion2',
    'bloomPoziom3', 'bloomPion3', 'bloomPoziom4', 'bloomPion4', 'bloomKompozyt']);
  const prog = buildCompute(k[0]);
  assert.match(prog, /fn hdrBezpieczny/, 'wejście przez siatkę bezpieczeństwa HDR');
  assert.match(prog, /textureSampleLevel\(/);
  assert.match(prog, /textureStore\(/);
  assert.match(prog, /smoothstep\(/);
  const poziom = buildCompute(k[1]);
  // pętla jądra 1…5 (jądro 6), przesunięcie direction · invSize · i, suma (lewo + prawo) · w
  assert.match(poziom, /for \( var i : i32 = 1; i < 6; i \+\+ \)/);
  assert.equal((poziom.match(/textureSampleLevel\(/g) || []).length, 3, 'środek + dwie próbki w pętli');
  const pion4 = buildCompute(k[10]);
  assert.match(pion4, /for \( var i : i32 = 1; i < 22; i \+\+ \)/);
  const komp = buildCompute(k[11]);
  assert.match(komp, /fn lerpBloomFactor/);
  assert.equal((komp.match(/textureSampleLevel\(/g) || []).length, 5, 'pięć mipów');
  // rozmiary z bufora rysowania × skala, liczba wątków = piksele celu
  const fake = { getDrawingBufferSize: (v) => v.set(1920, 1080) };
  bloom._resize(fake);
  assert.equal(k[0].count, 960 * 540);
  assert.equal(k[9].count, 60 * 34);
  assert.equal(k[11].count, 960 * 540);
  assert.deepEqual([bloom._h[3].image.width, bloom._h[3].image.height], [120, 68]);
  assert.equal(bloom._invSize[1].value.x, 1 / 480);
  bloom.resolutionScale = 0.5;
  bloom._resize(fake);
  assert.deepEqual([bloom._bright.image.width, bloom._bright.image.height], [480, 270]);
  // jeden pass compute: render() woła renderer.compute z CAŁĄ listą, haki wokół
  const seq = [];
  bloom.onRenderBegin = () => seq.push('początek');
  bloom.onRenderEnd = () => seq.push('koniec');
  bloom.render({ getDrawingBufferSize: fake.getDrawingBufferSize, compute: (list) => seq.push(Array.isArray(list) ? list.length : 'jeden') });
  assert.deepEqual(seq, ['początek', 12, 'koniec']);
  // cele: rgba16float, filtr liniowy, bez mipmap
  for (const t of [bloom._bright, ...bloom._h, ...bloom._v]) {
    assert.equal(t.type, THREE.HalfFloatType);
    assert.equal(t.minFilter, THREE.LinearFilter);
    assert.equal(t.magFilter, THREE.LinearFilter);
    assert.equal(t.generateMipmaps, false);
  }
});

test('Core3D: bloom compute przed „uber”, wejście = bufor sceny, kubełek bloom z haków', () => {
  const core = read('src/3d/core3d.js');
  assert.match(core, /const bloom = new BloomGryCompute\(sceneTexture, cfg\.strength, cfg\.radius, cfg\.threshold\);/);
  assert.match(core, /bloomTexture: bloom\.getTextureNode\(\)/);
  const post = core.slice(core.indexOf('  _renderPost() {'), core.indexOf('\n  },', core.indexOf('  _renderPost() {')));
  assert.ok(post.indexOf('this.bloomPass.render(this.renderer)') >= 0 && post.indexOf('this.bloomPass.render(this.renderer)') < post.indexOf('post.render();'), 'bloom przed postem');
  assert.doesNotMatch(core, /_takeBloomOutOfPost/, 'bloom nie leży już w renderze postu');
});
