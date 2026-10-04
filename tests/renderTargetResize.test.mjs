import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderTarget } from 'three/webgpu';
import Textures from '../node_modules/three/src/renderers/common/Textures.js';
import DataMap from '../node_modules/three/src/renderers/common/DataMap.js';
import { SampledTexture } from '../node_modules/three/src/renderers/common/SampledTexture.js';
import { resizeRenderTarget } from '../src/3d/renderTargetResize.js';

// Prawdziwy cykl życia Textures / RenderTarget / SampledTexture r183, bez urządzenia GPU.
function harness(count = 1) {
  const backend = new DataMap();
  backend.createTexture = (texture, options) => {
    backend.get(texture).texture = { mipLevelCount: options.levels, width: options.width, height: options.height };
  };
  backend.destroyTexture = (texture) => { backend.delete(texture); };
  const textures = new Textures({}, backend, { memory: { textures: 0 } });
  let inits = 0;
  const renderer = { initRenderTarget: (target) => { inits++; textures.updateRenderTarget(target); } };
  const target = new RenderTarget(1600, 900, { count, depthBuffer: false, generateMipmaps: false });
  renderer.initRenderTarget(target);
  const bindings = target.textures.map((t, i) => new SampledTexture(`tex${i}`, t));
  for (const b of bindings) b.update();
  return { backend, textures, renderer, target, bindings, inits: () => inits };
}

test('r183: zwykłe setSize usuwa zasób, ale stare wiązanie nie widzi zmiany (regresja mipLevelCount)', () => {
  const h = harness();
  h.target.setSize(1000, 600);
  assert.equal(h.backend.get(h.target.texture).texture, undefined);
  assert.equal(h.bindings[0].update(), false, 'wiążący shader nie odtworzy zasobu');
});

test('resize: nieaktywny cel ma zasób przed postem, a wszystkie istniejące wiązania widzą zmianę', () => {
  const h = harness(2), originalTextures = [...h.target.textures];
  for (const [w, ht] of [[1000, 600], [1, 1], [1600, 900], [1350, 780]]) {
    resizeRenderTarget(h.target, w, ht, h.renderer);
    assert.deepEqual(h.target.textures, originalTextures, 'bez nowych obiektów / grafów shaderów');
    for (const b of h.bindings) {
      const gpu = h.backend.get(b.texture).texture;
      assert.equal(gpu.width, w); assert.equal(gpu.height, ht);
      assert.equal(gpu.mipLevelCount, 1);
      assert.equal(b.update(), true);
    }
    assert.equal(h.textures.info.memory.textures, 2, 'kolejne resize nie gromadzą tekstur');
  }
  assert.equal(h.inits(), 5, 'odtworzenie dokładnie raz na zmianę rozmiaru');
  h.target.dispose();
});

test('ten sam rozmiar nie zwalnia zasobu i nie zmienia wersji wiązań', () => {
  const h = harness(), gpu = h.backend.get(h.target.texture).texture;
  resizeRenderTarget(h.target, 1600, 900, h.renderer);
  assert.equal(h.backend.get(h.target.texture).texture, gpu);
  assert.equal(h.bindings[0].update(), false);
  assert.equal(h.inits(), 1);
  h.target.dispose();
});

test('resize przed gotowością GPU: bez inicjalizacji, wersja wymusza późniejsze odtworzenie', () => {
  const h = harness();
  resizeRenderTarget(h.target, 900, 520);
  assert.equal(h.inits(), 1);
  assert.equal(h.bindings[0].update(), true);
  h.textures.updateTexture(h.target.texture);
  assert.equal(h.backend.get(h.target.texture).texture.width, 900);
  resizeRenderTarget(null, 1, 1, h.renderer);
  h.target.dispose();
});
