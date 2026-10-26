// Ślady światła skał w skoku i łuki deflektora (src/3d/asteroids/warpTrails.js; DECYZJE-2 S2 / S3, 2026-10-26): jedna
// partia kwadów (jeden rysunek), addytywny premultiplied, forceSinglePass, bez zapisu głębi, graf raz na moduł (ten sam
// WGSL), WGSL buduje się w Node w limitach r183, bez `pow`, varyingi z clampem; bufor instancji bez alokacji.
// node --test tests/warpTrails.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three/webgpu');
const {
  WarpTrailBatch, createWarpTrailMaterial, createWarpTrailGeometry, warpTrailUniforms, WARP_TRAIL_FLOATS, WARP_TRAIL_SEGMENTS,
  WARP_TRAIL_KIND, WARP_TRAIL_RENDER_ORDER, warpTrailIntensity
} = await import('../src/3d/asteroids/warpTrails.js');

function build(mesh) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mesh.material;
  const t0 = performance.now();
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader, ms: performance.now() - t0 };
}
const count = (s, re) => (s.match(re) || []).length;

test('materiał: addytywny premul (ONE, ONE), forceSinglePass, bez głębi, bez świateł, wspólny graf', () => {
  const a = createWarpTrailMaterial();
  const b = createWarpTrailMaterial();
  for (const m of [a, b]) {
    assert.equal(m.transparent, true);
    assert.equal(m.depthWrite, false);
    assert.equal(m.depthTest, true);
    assert.equal(m.forceSinglePass, true);
    assert.equal(m.side, THREE.DoubleSide);
    assert.equal(m.blending, THREE.CustomBlending);
    assert.equal(m.blendSrc, THREE.OneFactor);
    assert.equal(m.blendDst, THREE.OneFactor);
    assert.equal(m.premultipliedAlpha, false);
    assert.equal(m.lights, false);
  }
  assert.equal(a.positionNode, b.positionNode, 'wspólne węzły wierzchołków');
  assert.equal(a.fragmentNode, b.fragmentNode, 'wspólne węzły fragmentu');
  assert.equal(warpTrailUniforms(), warpTrailUniforms(), 'uniformy raz na moduł');
});

test('WGSL w Node: limity r183 (≤ 12 buforów uniformów, ≤ 8 buforów wierzchołków), bez pow, varyingi z clampem, ten sam program', () => {
  const b1 = new WarpTrailBatch({});
  const b2 = new WarpTrailBatch({});
  const w1 = build(b1.mesh);
  const w2 = build(b2.mesh);
  assert.equal(w1.fragment, w2.fragment, 'ten sam WGSL fragmentu');
  assert.equal(w1.vertex, w2.vertex, 'ten sam WGSL wierzchołków');
  assert.ok(count(w1.vertex, /var<uniform>/g) <= 12 && count(w1.fragment, /var<uniform>/g) <= 12);
  // bufory wierzchołków: pozycja + jeden bufor instancji z przeplotem
  const g = b1.geo;
  const buffers = new Set();
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name];
    buffers.add(at.isInterleavedBufferAttribute ? at.data : at);
  }
  assert.equal(buffers.size, 2, 'pozycja + instancje (12 liczb z przeplotem)');
  assert.doesNotMatch(w1.fragment + w1.vertex, /\bpow\s*\(/, 'bez pow (NaN przy ujemnej podstawie)');
  // varyingi czytane we fragmencie z clampem (NaN / nadmiar nie rozlewa bloomu)
  for (const v of ['vTrailS', 'vTrailHead', 'vTrailCol']) assert.match(w1.fragment, new RegExp(`clamp\\( ${v}`), `clamp ${v}`);
  assert.match(w1.fragment, /clamp\( abs\( vTrailSide \)/);
  assert.match(w1.fragment, /clamp\( vTrailKind/);
  assert.match(w1.fragment, /vec4<f32>\( max\(/, 'wyjście ≥ 0');
  // bez if / select w wierzchołkach — rodzaj instancji maską (pułapka 39)
  assert.doesNotMatch(w1.vertex, /\bif\b|select\(/);
  assert.ok(w1.ms < 400, `budowa ${w1.ms.toFixed(0)} ms`);
});

test('partia: ślady i łuki w jednym buforze, liczba instancji = zakres wysyłki, pojemność bez alokacji', () => {
  const batch = new WarpTrailBatch({ capacity: 4 });
  assert.equal(batch.mesh.renderOrder, WARP_TRAIL_RENDER_ORDER);
  assert.ok(WARP_TRAIL_RENDER_ORDER > -0.5 && WARP_TRAIL_RENDER_ORDER < 2, 'po zasłonie, przed skałami tła');
  assert.equal(batch.mesh.frustumCulled, false);
  const data = batch.data;
  batch.begin();
  assert.ok(batch.addTrail(1, 2, -300, 0, 1, 2000, 60, 0.05, 0.3, 0.2, 0.1));
  assert.ok(batch.addGlint(5, 6, -200, 1, 0, 400, 8, 25, 1.2, 2, 2.4));
  assert.equal(batch.addTrail(0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1), false, 'długość 0 — pominięty');
  batch.addTrail(0, 0, -1, 0, 1, 10, 1, 2, 1, 1, 1);
  batch.addTrail(0, 0, -1, 0, 1, 10, 1, 0.1, 1, 1, 1);
  assert.equal(batch.addTrail(0, 0, -1, 0, 1, 10, 1, 0.1, 1, 1, 1), false, 'pełna partia');
  assert.equal(batch.stats.dropped, 1);
  assert.equal(data[11], WARP_TRAIL_KIND.TRAIL);
  assert.equal(data[WARP_TRAIL_FLOATS + 11], WARP_TRAIL_KIND.GLINT);
  assert.equal(data[WARP_TRAIL_FLOATS + 7], 25, 'strzałka łuku');
  assert.equal(data[2 * WARP_TRAIL_FLOATS + 7], 1, 'głowa śladu ≤ 1');
  batch.commit(1712.7, 14600);
  assert.equal(batch.geo.instanceCount, 4);
  assert.equal(batch.mesh.visible, true);
  assert.equal(batch.buffer.updateRanges[0].count, 4 * WARP_TRAIL_FLOATS);
  assert.equal(batch.data, data, 'ten sam bufor');
  batch.hide();
  assert.equal(batch.mesh.visible, false);
  assert.equal(batch.geo.instanceCount, 0);
  const geo = createWarpTrailGeometry();
  assert.equal(geo.index.count, WARP_TRAIL_SEGMENTS * 6, 'pasek z odcinkami (łuk gnie wierzchołki)');
});

test('głowa śladu: HDR tylko tuż za brzegiem skały (≤ pół promienia, ≤ headGlow śladu), długość głowy nie rośnie z promieniem', () => {
  const gain = 1; const headGain = 5; const glow = 0.05;
  // Głowa (s = h) pełna, ogon (1 − s)², za głową zero dodatku (zwarty nośnik).
  for (const h of [0.01, 0.1, 0.3, 0.6, 1]) {
    assert.ok(Math.abs(warpTrailIntensity(h, h, gain, headGain, glow) - ((1 - h) ** 2 * gain + headGain)) < 1e-9, `głowa ${h}`);
    const g = Math.min(0.5 * h, glow);
    for (let s = h + g; s <= 1; s += 0.01) {
      assert.ok(Math.abs(warpTrailIntensity(s, h, gain, headGain, glow) - (1 - s) ** 2 * gain) < 1e-9, `za głową tylko ogon (h ${h}, s ${s.toFixed(2)})`);
    }
    // ciągła i nierosnąca za brzegiem skały
    let prev = Infinity;
    for (let s = h; s <= 1; s += 0.002) {
      const I = warpTrailIntensity(s, h, gain, headGain, glow);
      assert.ok(I <= prev + 1e-9, 'nierosnąca');
      prev = I;
    }
  }
  // Długość głowy za brzegiem [× długość śladu] = min(h / 2, glow): mała skała — pół promienia, duża — stały ułamek.
  const hdrLen = (h, c) => {
    let last = h;
    for (let s = h; s <= 1; s += 1e-4) if (warpTrailIntensity(s, h, gain, headGain, glow) * c > 0.9) last = s;
    return last - h;
  };
  assert.ok(hdrLen(0.02, 0.8) <= 0.01 + 1e-4, 'mała skała: ≤ pół promienia');
  assert.ok(hdrLen(0.3, 0.8) <= glow + 1e-4 && hdrLen(0.6, 0.8) <= glow + 1e-4, 'duża skała: ≤ headGlow śladu');
  // Ogon pod progiem bloomu przy najjaśniejszej barwie palety (0,8).
  assert.ok(warpTrailIntensity(0.06, 0, gain, headGain, glow) * 0.8 < 0.9);
});

test('WGSL fragmentu śladu = lustro CPU (głowa min(h / 2, headGlow), zanik (1 − x)², bez exp i pow)', () => {
  const w = build(new WarpTrailBatch({}).mesh);
  assert.match(w.fragment, /max\( min\( \( \w+ \* 0\.5 \), \w+\.\w+ \), 0\.0001 \)/, 'długość głowy min(h / 2, headGlow)');
  assert.doesNotMatch(w.fragment, /exp\s*\(|pow\s*\(/);
  const U = warpTrailUniforms();
  assert.equal(U.headGlow.value, 0.05);
  const batch = new WarpTrailBatch({});
  batch.setLook(1, 5, 0.3, 0.07);
  assert.equal(U.headGlow.value, 0.07);
  batch.setLook(1, 5, 0.3, 0.05);
});
