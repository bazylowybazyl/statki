// Kafle gorącego powietrza (2026-10-17, src/3d/tsl/postGry.js — heatHazeTileMask): „uber” przegląda źródła tylko
// w kaflach 32 × 32 px z bitem źródła. Tu: każdy piksel, w którym pętla źródeł daje niezerowy wkład (te same warunki
// co shader: stożek dyszy, koło izotropowe), leży w kaflu z bitem tego źródła; WGSL postu czyta maskę przed pętlą;
// Core3D buduje maski i wysyła zakres kafli.
// node --test tests/heatHazeTiles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { HEAT_TILE_PX, HEAT_TILE_CAP, MAX_HEAT_HAZE_SOURCES, createPostUniforms, createUberPost, heatHazeTileMask } =
  await import('../src/3d/tsl/postGry.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Lustro warunków pętli „uber” (bez szumu): czy źródło i daje w pikselu (uvGl) niezerowy wkład.
function contributes(src, dirs, i, aspect, ux, uy) {
  const R = Math.max(0.0001, Math.fround(src[i * 4 + 2]));
  const px = (ux - src[i * 4]) * aspect, py = uy - src[i * 4 + 1];
  const dx = dirs[i * 2], dy = dirs[i * 2 + 1];
  if (dx * dx + dy * dy > 0.25) {
    const along = (px * dx + py * dy) / R;
    if (along < 0.4 || along > 7.2) return false;
    const across = (px * -dy + py * dx) / R;
    const halfW = 1.25 + (2.6 - 1.25) * Math.min(1, Math.max(0, along / 7));
    const aw = Math.abs(across) / halfW;
    if (aw >= 1) return false;
    // maska: exp · (1 − smoothstep(0,85; 1,25; halfW / 1,8)) · smoothstep(0,4; 1,6; along) · (1 − smoothstep(0,55; 1; aw))
    return along > 0.4 && aw < 1;
  }
  const maxExt = R * 3.4;
  if (Math.abs(px) > maxExt || Math.abs(py) > maxExt) return false;
  const t = Math.hypot(px, py) / R;
  return t < 1 && t > 0;
}

test('maska kafli: każdy piksel z wkładem źródła leży w kaflu z jego bitem (dysze pod każdym kątem, izotropowe, brzegi)', () => {
  let seed = 777;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = new Uint32Array(HEAT_TILE_CAP);
  let checked = 0;
  for (const [W, H] of [[640, 360], [333, 517], [1000, 200]]) {
    const aspect = W / H;
    for (let k = 0; k < 12; k++) {
      const count = 1 + Math.floor(rnd() * MAX_HEAT_HAZE_SOURCES);
      const src = new Float32Array(MAX_HEAT_HAZE_SOURCES * 4), dirs = new Float32Array(MAX_HEAT_HAZE_SOURCES * 2);
      for (let i = 0; i < count; i++) {
        src[i * 4] = rnd() * 1.2 - 0.1; src[i * 4 + 1] = rnd() * 1.2 - 0.1;
        src[i * 4 + 2] = (2 + rnd() * 40) / H; src[i * 4 + 3] = 1;
        if (rnd() < 0.7) { const a = rnd() * Math.PI * 2; dirs[i * 2] = Math.cos(a); dirs[i * 2 + 1] = Math.sin(a); }
      }
      const n = heatHazeTileMask(out, src, dirs, count, aspect, W, H);
      const tx = Math.ceil(W / HEAT_TILE_PX);
      assert.equal(n, tx * Math.ceil(H / HEAT_TILE_PX));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ux = (x + 0.5) / W, uy = 1 - (y + 0.5) / H;   // uvGl (v od dołu), piksel y od góry
        const word = out[Math.floor(y / HEAT_TILE_PX) * tx + Math.floor(x / HEAT_TILE_PX)];
        for (let i = 0; i < count; i++) {
          if (!contributes(src, dirs, i, aspect, ux, uy)) continue;
          checked++;
          assert.ok((word >>> i) & 1, `piksel (${x}, ${y}) z wkładem źródła ${i} w kaflu bez bitu`);
        }
      }
    }
  }
  assert.ok(checked > 20000, `sprawdzone piksele z wkładem: ${checked}`);
});

test('maska kafli: źródło poza ekranem nie zapala kafli, za dużo kafli = bez kafli (0)', () => {
  const out = new Uint32Array(HEAT_TILE_CAP);
  const src = new Float32Array([-0.5, 0.5, 4 / 1440, 1]), dirs = new Float32Array([1, 0]);
  assert.equal(heatHazeTileMask(out, src, dirs, 1, 5120 / 1440, 5120, 1440), 160 * 45);
  assert.equal(out.subarray(0, 160 * 45).some((v) => v !== 0), false);
  assert.equal(heatHazeTileMask(new Uint32Array(10), src, dirs, 1, 1, 5120, 1440), 0);
});

test('WGSL „uber”: maska kafla (screenCoordinate / 32) przed pętlą źródeł, bit źródła na początku iteracji', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const rt = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const material = new THREE.NodeMaterial();
  material.fragmentNode = createUberPost({ sceneTexture: rt.texture, bloomTexture: null, uniforms: createPostUniforms() });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  const w = b.fragmentShader;
  assert.match(w, /var<storage, read> heatTiles : heatTilesStruct;/);
  assert.match(w, /heatMask = 4294967295u;/);
  assert.match(w, /floor\( \( fragCoord\.xy \/ vec2<f32>\( 32\.0 \) \) \)/, 'kafel z pozycji piksela / 32');
  assert.match(w, /if \( \( heatMask != 0u \) \) \{\s*for \( var i : i32 = 0; i < object\.nodeUniform\d+; i \+\+ \) \{\s*if \( \( \( \( heatMask >> u32\( i \) \) & 1u \) == 0u \) \) \{\s*continue;/);
});

test('Core3D: maski kafli w _updatePostUniforms (zakres wysyłki, A/B heatHazeTiles, bez kafli przy 0 źródeł)', () => {
  const core = read('src/3d/core3d.js');
  const i = core.indexOf('  _updatePostUniforms(heatOn, sourceCount, nowSec) {');
  const body = core.slice(i, core.indexOf('\n  },', i));
  assert.match(body, /if \(heatOn && count > 0 && this\.heatHazeTiles !== false && target/);
  assert.match(body, /n = heatHazeTileMask\(tiles\.value\.array, this\.heatHazeSources, this\.heatHazeDirs, count, u\.uAspect\.value, W, H\);/);
  assert.match(body, /zbierzZakres\(tiles\.value, 0, n\);/);
  assert.match(body, /if \(!\(n > 0\)\) grid\.value\.z = 0;/);
  // uAspect liczony przed maskami (te same wartości co w shaderze)
  assert.ok(body.indexOf('u.uAspect.value =') < body.indexOf('heatHazeTileMask('));
});
