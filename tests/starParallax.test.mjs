import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function loadStarParallax() {
  try {
    return await import('../src/3d/starParallax.js');
  } catch (err) {
    assert.fail(`expected star parallax helper module to exist: ${err.code || err.message}`);
  }
}

test('star parallax layers move slower than world-space asteroids', async () => {
  const {
    STAR_PARALLAX_LAYERS,
    computeStarCameraOffset,
  } = await loadStarParallax();

  assert.equal(STAR_PARALLAX_LAYERS.length, 3);
  assert.ok(
    Math.max(...STAR_PARALLAX_LAYERS.map((layer) => layer.parallax)) <= 0.3,
    'even the speed layer should stay visually behind world-space asteroid motion'
  );

  const cameraTravel = 10000;
  const offsets = STAR_PARALLAX_LAYERS.map((layer) =>
    computeStarCameraOffset(cameraTravel, -cameraTravel, layer, 220000)
  );

  assert.ok(offsets[0].x < offsets[1].x);
  assert.ok(offsets[1].x < offsets[2].x);
  assert.ok(offsets[2].x <= cameraTravel * 0.3);
  assert.ok(offsets[2].y <= cameraTravel * 0.3);
});

test('planet star shader uses per-star parallax and warp stretch attributes', () => {
  const source = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /starSpeed:\s*0\.9/);
  assert.match(source, /attribute\s+float\s+parallaxFactor\s*;/);
  assert.match(source, /attribute\s+float\s+layerStretchMul\s*;/);
  assert.doesNotMatch(source, /attribute\s+float\s+speedResponse\s*;/);
  assert.doesNotMatch(source, /uniform\s+float\s+speedFactor\s*;/);
  assert.match(source, /geo\.setAttribute\('parallaxFactor'/);
});

test('normal flight speed does not drive warp stretch in the star shader', () => {
  const source = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /max\s*\(\s*warpFactor\s*,\s*speedFactor\s*\*\s*speedResponse\s*\)/);
  assert.match(source, /float\s+stretch\s*=\s*1\.0\s*\+\s*\(\s*warpFactor\s*\*\s*stretchStrength\s*\*\s*layerStretchMul\s*\)/);
});

test('warp star streak keeps the star head anchored at the original point', () => {
  const source = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');

  assert.match(source, /uniform\s+vec2\s+viewportSize\s*;/);
  assert.match(source, /vec4\s+clipPosition\s*=\s*projectionMatrix\s*\*\s*mvPosition\s*;/);
  assert.match(source, /clipPosition\.xy\s*-=\s*screenOffset\s*;/);
  assert.match(source, /gl_Position\s*=\s*clipPosition\s*;/);
  assert.match(source, /uv\.x\s*=\s*\(\s*uv\.x\s*-\s*0\.5\s*\)\s*\/\s*vStretch\s*;/);
  assert.doesNotMatch(source, /\(\s*stretch\s*-\s*1\.0\s*\)\s*\*\s*0\.5/);
  assert.doesNotMatch(source, /mvPosition\.xy\s*-=\s*moveDir/);
  assert.doesNotMatch(source, /uv\.x\s*\*=\s*\(1\.0\s*\/\s*vStretch\)/);
});
