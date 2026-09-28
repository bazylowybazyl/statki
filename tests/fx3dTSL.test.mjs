// Port WebGPU, zadanie 12-B: bank cząstek Fx3D (src/3d/fxParticles3D.js) w TSL — cztery grafy
// wierzchołków (BB, PLUME, CROSS, WASH) i jeden fragmentu wspólne dla systemów, tekstura per obiekt
// (FxMapNode), wysyłka tylko żywej części atrybutów bez alokacji. WGSL budowany w Node (bez GPU).
// Nośnik (dym z lufy leci z okrętem) — tests/carrierVelocity.test.mjs. Obraz: silniki.mjs (iskry MAIN).
// node --test tests/fx3dTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const ctx2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three/webgpu');
const { Core3D } = await import('../src/3d/core3d.js');
const { Fx3D, sp } = await import('../src/3d/fxParticles3D.js');
const { SimClock } = await import('../src/game/simClock.js');

Core3D.isInitialized = true;
Core3D.scene = new THREE.Scene();
Fx3D.ensure();

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function build(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = Core3D.scene;
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return b;
}

const QUADS = ['smoke', 'vapor', 'glow', 'star', 'wash', 'plume', 'cross'];

test('Fx3D bez GLSL: 7 materiałów węzłowych na czterech wspólnych grafach, łuki i iskry wbudowane', () => {
  const src = readFileSync(new URL('../src/3d/fxParticles3D.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /new\s+(THREE\.)?(Raw)?ShaderMaterial\s*\(|gl_Position|gl_FragColor|texture2D|\/\* glsl \*\//);
  for (const k of QUADS) {
    const m = Fx3D[k].mat;
    assert.equal(m.isFxQuadMaterial, true, k);
    assert.equal(m.isNodeMaterial, true, k);
    assert.equal(m.name, `Fx3D:${k}`);
    assert.equal(m.depthTest, false); assert.equal(m.depthWrite, false); assert.equal(m.transparent, true);
    assert.equal(m.side, THREE.FrontSide);
  }
  assert.equal(Fx3D.smoke.mat.blending, THREE.NormalBlending, 'dym zakrywa (mieszanie normalne)');
  for (const k of ['vapor', 'glow', 'star', 'wash', 'plume', 'cross']) assert.equal(Fx3D[k].mat.blending, THREE.AdditiveBlending, k);
  // wspólny graf = ten sam klucz programu (jeden NodeBuilder na wariant, PLAN §3)
  const key = (k) => Fx3D[k].mat.customProgramCacheKey();
  assert.equal(key('vapor'), key('smoke'));
  assert.equal(key('glow'), key('smoke'));
  assert.equal(key('star'), key('smoke'));
  const keys = new Set(['smoke', 'wash', 'plume', 'cross'].map(key));
  assert.equal(keys.size, 4, 'BB, WASH, PLUME, CROSS — cztery grafy');
  assert.equal(Fx3D.wash.mat.fragmentNode, Fx3D.plume.mat.fragmentNode, 'jeden graf fragmentu');
  assert.equal(Fx3D.smoke.mat.fragmentNode, Fx3D.cross.mat.fragmentNode);
  assert.ok(Fx3D.spark.mat.isLineBasicMaterial && Fx3D.arcs.mat.isLineBasicMaterial, 'łuki i iskry konwertuje biblioteka WebGPU');
  assert.equal(Fx3D.spark.mat.name, 'Fx3D:sparks');
});

test('WGSL banku: modelViewMatrix × pozycja względem początku, ≤ 6 buforów wierzchołków, fragment jak dawny BB_FRAG', () => {
  for (const k of ['smoke', 'plume', 'cross', 'wash']) {
    const b = build(Fx3D[k].mesh);
    const vs = b.vertexShader;
    const fs = b.fragmentShader;
    const mainArgs = (vs.match(/fn main \(([\s\S]*?)\) ->/) || vs.match(/fn main\(([\s\S]*?)\) ->/) || ['', ''])[1];
    const inputs = (mainArgs.match(/@location\( \d+ \)/g) || []).length;
    assert.ok(inputs <= 6, `${k}: ${inputs} atrybutów (limit 8 buforów wierzchołków)`);
    assert.match(vs, /iPos : vec3<f32>/);
    assert.match(vs, /modelViewMatrix = /, `${k}: macierz modelu-widoku z kontekstu (highPrecision w grze)`);
    assert.match(vs, /render\.cameraProjectionMatrix \*/);
    // fragment: tekstura obiektu × barwa, odrzucenie przy alfie < 0,002, bez buforów uniformów
    assert.match(fs, /textureSample\( nodeUniform\d+, nodeUniform\d+_sampler, nodeVarying\d+ \)/);
    assert.match(fs, /< 0\.002 \) \) \{\s*discard;/);
    assert.match(fs, /output\.color = vec4<f32>\( \( vFxCol \* nodeVar\d+\.xyz \), nodeVar\d+ \);/);
    assert.equal((fs.match(/var<uniform>/g) || []).length, 0);
    assert.equal((fs.match(/texture_2d<f32>/g) || []).length, 1);
  }
  const bb = build(Fx3D.glow.mesh).vertexShader;
  assert.match(bb, /cos\( iData\.y \)/, 'obrót bilboardu w widoku');
  const plume = build(Fx3D.plume.mesh).vertexShader;
  assert.match(plume, /cross\( nodeVar\d+, nodeVar\d+ \)/, 'jęzor obrócony ku kamerze');
  assert.match(plume, /render\.cameraPosition - object\.nodeUniform\d+/, 'kierunek do kamery: różnica dużych liczb najpierw');
  const cross = build(Fx3D.cross.mesh).vertexShader;
  assert.match(cross, /render\.cameraViewMatrix \* vec4<f32>\( normalize\( iDir \), 0\.0 \)/, 'mat3(viewMatrix) · kierunek');
});

test('tekstura per obiekt: FxMapNode bierze uniforms.map.value rysowanego materiału (brak → biała zastępcza)', () => {
  const node = Fx3D.smoke.mat.fragmentNode;
  // węzeł tekstury w grafie fragmentu
  let map = null;
  node.traverse?.((n) => { if (n.constructor?.type === 'FxMapNode') map = n; });
  if (!map) {
    const b = build(Fx3D.smoke.mesh);
    map = [...b.updateNodes].find((n) => n.constructor?.type === 'FxMapNode');
  }
  assert.ok(map, 'FxMapNode w grafie');
  assert.equal(map.updateType, THREE.NodeUpdateType.OBJECT, 'aktualizacja per obiekt (texture().onObjectUpdate w r183 nie działa)');
  map.updateType = THREE.NodeUpdateType.NONE;
  assert.equal(map.updateType, THREE.NodeUpdateType.OBJECT, 'setup TextureNode nie zdejmie aktualizacji');
  map.update({ material: Fx3D.glow.mat });
  assert.equal(map.value, Fx3D.glow.mat.uniforms.map.value);
  map.update({ material: Fx3D.cross.mat });
  assert.equal(map.value, Fx3D.cross.mat.uniforms.map.value);
  map.update({ material: { uniforms: {} } });
  assert.ok(map.value.isDataTexture, 'zastępcza');
  assert.deepEqual(Array.from(map.value.image.data), [255, 255, 255, 255]);
});

const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
function allocatedBytes(fn, n) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn(i);
    const delta = newSpaceUsed() - before;
    if (delta >= 0) return delta;
  }
  return Infinity;
}

test('wysyłka tylko żywej części atrybutów (zakres na stałe), bez alokacji na klatkę', () => {
  SimClock.reset();
  Fx3D.reset();
  const o = sp();
  o.life = 1e6; o.drag = 0.5;
  for (let i = 0; i < 40; i++) { o.x = i; Fx3D.glow.spawn(o); }
  const pos = new THREE.Vector3(0, 0, 15);
  const vel = new THREE.Vector3(100, 0, 0);
  for (let i = 0; i < 25; i++) Fx3D.spark.spawn(pos, vel, 1e6, 0.5, 5, [2, 1.5, 1]);
  Fx3D.update(1 / 60);
  const iPos = Fx3D.glow.bufs.iPos;
  assert.deepEqual(iPos.updateRanges, [{ start: 0, count: 40 * 3 }]);
  iPos.clearUpdateRanges();
  assert.deepEqual(iPos.updateRanges, [{ start: 0, count: 40 * 3 }], 'three czyści listę po wysyłce — tu zostaje (bez push na klatkę)');
  assert.deepEqual(Fx3D.spark.posAttr.updateRanges, [{ start: 0, count: 25 * 6 }]);
  assert.equal(Fx3D.glow.geo.instanceCount, 40);
  // Alokacja stała (~20 B na klatkę — tak samo przed portem, nie zależy od liczby cząstek); nic na cząstkę.
  const frame = () => Fx3D.update(1 / 60);
  for (let i = 0; i < 3000; i++) frame();
  const empty = () => {};
  const used = allocatedBytes(frame, 2000) - allocatedBytes(empty, 2000);
  for (let i = 0; i < 400; i++) { o.x = i; Fx3D.glow.spawn(o); Fx3D.spark.spawn(pos, vel, 1e6, 0.5, 5, [2, 1.5, 1]); }
  for (let i = 0; i < 3000; i++) frame();
  const used10 = allocatedBytes(frame, 2000) - allocatedBytes(empty, 2000);
  assert.ok(used < 96 * 1024 && used10 < 96 * 1024, `Fx3D.update: ${used} B / ${used10} B (×10 cząstek) na 2000 klatek`);
  assert.ok(used10 < used + 32 * 1024, `alokacja rośnie z liczbą cząstek: ${used} → ${used10}`);
  Fx3D.reset();
  SimClock.reset();
});
