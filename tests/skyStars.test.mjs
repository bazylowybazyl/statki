// Gwiazdy tła w rozdzielczości ekranu (src/3d/skyStars.tsl.js): gęstość z jasności gładkiej tekstury,
// materiał mgławicy gry i płat mgławicy w niebie menu budują się do WGSL z polem gwiazd (bez GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { texture, uniform, uv } from 'three/tsl';
import { SKY_STARS_TUNE, skyStarDensityCpu } from '../src/3d/skyStars.tsl.js';
import { uniformsAdapter } from '../src/3d/tsl/uniformy.js';
import { createNebulaMaterial } from '../src/3d/planet3d.assets.tsl.js';
import { createMenuSkyMaterial } from '../src/3d/menuBackdrop3D.tsl.js';

test('gęstość gwiazd: tło nieba → rdzeń pasa, monotonicznie, w granicach', () => {
  const T = SKY_STARS_TUNE;
  assert.ok(Math.abs(skyStarDensityCpu(0) - T.densBg) < 1e-12, 'puste niebo: gęstość tła');
  assert.ok(Math.abs(skyStarDensityCpu(T.lumCore) - 1) < 1e-12, 'rdzeń pasa: pełna gęstość');
  let prev = -1;
  for (let i = 0; i <= 200; i++) {
    const d = skyStarDensityCpu(i / 1000);
    assert.ok(d >= prev - 1e-12 && d <= T.densMax, String(d));
    prev = d;
  }
  for (const G of T.grids) {
    assert.ok(G.fmax > G.fmin && G.fmin > 0 && G.sigma >= 0.45, 'profil nie węższy niż ~pół piksela');
    assert.ok(G.near === 2 || G.near === 3);
    // 2 × 2 sięga pół komórki od piksela — przy najmniejszym powiększeniu (pxRef) profil musi się zmieścić
    if (G.near === 2) assert.ok(0.5 * G.cell / T.pxRef >= 2 * G.sigma, `komórka ${G.cell} za mała na profil`);
  }
});

function buildFragment(material) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}

const tex = () => {
  const t = new THREE.DataTexture(new Uint8Array([10, 10, 10, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
};

test('materiał mgławicy gry: gwiazdy ekranowe, jasność strefy, powrót przez acesGryInv', () => {
  const u = uniformsAdapter({ map: texture(tex(), uv()), warpFactor: uniform(0.0), brightness: uniform(1.0) });
  const fs = buildFragment(createNebulaMaterial(u));
  for (const name of ['skyStarHash', 'skyStarErf', 'skyStarTint', 'acesGry', 'acesGryInv']) assert.match(fs, new RegExp(name), name);
  const ubo = (fs.match(/var<uniform>/g) || []).length;
  assert.ok(ubo <= 12, `${ubo} buforów uniformów`);
});

test('niebo menu: płat mgławicy z tymi samymi gwiazdami ekranowymi', () => {
  const { material } = createMenuSkyMaterial({ nebulaMap: tex() });
  const fs = buildFragment(material);
  for (const name of ['skyStarHash', 'skyStarErf', 'acesGryInv']) assert.match(fs, new RegExp(name), name);
});
