// Pamięć szumu mgły wojny (2026-10-17, src/3d/fog/fogOfWarPost.js — FogNoiseCache): kernel compute liczy szum mgły
// (chmury, welon, smugi) raz na 4 × 4 px bufora, „uber” czyta go dwuliniowo. Tu: kratka obejmuje każdy piksel
// z dokładnymi wagami filtra, teksele pominięte w kręgu wzroku nie są czytane przez piksele z mgłą, błąd interpolacji
// przy najdalszym zoomie z pamięcią < 1,5e-3 (lustro CPU szumu), WGSL kernela i postu, warunki w Core3D.
// node --test tests/fogNoiseCache.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const {
  FOG_CACHE_STEP, FOG_CACHE_MIN_ZOOM, FOG_EDGE_FRAC, FOG_TILE_WORLD, FogNoiseCache, fogCacheSizeFor
} = await import('../src/3d/fog/fogOfWarPost.js');
const { createPostUniforms, createUberPost } = await import('../src/3d/tsl/postGry.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const S = FOG_CACHE_STEP;

// Środek teksela x w px bufora (od lewej): X = S·x − S/2; piksel X → t = X / S + 1 (środki tekseli na x + ½).
const texelCenter = (i) => i * S - S / 2;
const texelCoord = (X) => X / S + 1;

test('kratka: każdy piksel czyta 4 teksele wewnątrz pamięci, wagi filtra to wielokrotności 1/8 (dokładne w 8 bitach)', () => {
  assert.equal(S, 4);
  for (const [w, h] of [[5120, 1440], [1920, 1080], [1601, 899], [7, 3], [1, 1]]) {
    const [cw, ch] = fogCacheSizeFor(w, h);
    for (const [n, c] of [[w, cw], [h, ch]]) {
      for (let x = 0; x < n; x++) {
        const t = texelCoord(x + 0.5) - 0.5;   // filtr: teksele floor(t − ½) i +1
        const i0 = Math.floor(t);
        assert.ok(i0 >= 0 && i0 + 1 <= c - 1, `piksel ${x} z ${n}: teksele ${i0}, ${i0 + 1} poza 0…${c - 1}`);
        const frac = t - i0;
        assert.equal(Math.round(frac * 8), frac * 8, 'waga = k / 8');
        // środek teksela ↔ współrzędna: t(X_c) = i + ½
        assert.equal(texelCoord(texelCenter(i0)), i0 + 0.5);
      }
    }
  }
  assert.deepEqual(fogCacheSizeFor(5120, 1440), [1282, 362]);
});

// Lustro gałęzi kręgów (fogCircles): s = max (r − d) / max(0,22 r, 1); zapas pominięcia w kernelu = 1,5·S / zoom · max 1/w.
function circlesAt(circles, x, y) {
  let s = -1e9, invW = 0;
  for (const c of circles) {
    const w = Math.max(c.r * FOG_EDGE_FRAC, 1);
    s = Math.max(s, (c.r - Math.hypot(x - c.x, y - c.y)) / w);
    invW = Math.max(invW, 1 / w);
  }
  return { s, invW };
}

test('teksele bez szumu (głęboko w kręgu wzroku) nie są czytane przez piksele z mgłą (zapas Lipschitza)', () => {
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const W = 160, H = 96;
  const [cw, ch] = fogCacheSizeFor(W, H);
  let fogged = 0, skipped = 0;
  for (let k = 0; k < 40; k++) {
    const zoom = 0.03 + rnd() * 0.5;
    const n = 1 + Math.floor(rnd() * 5);
    const circles = [];
    for (let i = 0; i < n; i++) {
      circles.push({ x: (rnd() - 0.5) * W / zoom * 1.4, y: (rnd() - 0.5) * H / zoom * 1.4, r: (0.05 + rnd() * 0.6) * W / zoom });
    }
    const computed = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const fx = texelCenter(x) - W / 2, fy = H / 2 - texelCenter(y);
      const { s, invW } = circlesAt(circles, fx / zoom, fy / zoom);
      const margin = invW * S * 1.5 / zoom;
      computed[y * cw + x] = s < 1.75 + margin ? 1 : 0;
      if (!computed[y * cw + x]) skipped++;
    }
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const X = px + 0.5, Y = py + 0.5;
      const { s } = circlesAt(circles, (X - W / 2) / zoom, (H / 2 - Y) / zoom);
      if (!(s < 1.75)) continue;
      fogged++;
      const ix = Math.floor(texelCoord(X) - 0.5), iy = Math.floor(texelCoord(Y) - 0.5);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        assert.equal(computed[(iy + dy) * cw + ix + dx], 1, `piksel z mgłą (${px}, ${py}) czyta pominięty teksel`);
      }
    }
  }
  assert.ok(fogged > 50000 && skipped > 5000, `przypadki: ${fogged} pikseli z mgłą, ${skipped} tekseli pominiętych`);
});

// Lustro CPU szumu mgły (fowHashU / fowHash01 / fowTile / makeFowFbm): ten sam hasz całkowity i ta sama interpolacja.
function hashU(px, py) {
  const qx = Math.imul(px >>> 0, 1597334673) >>> 0;
  const qy = Math.imul(py >>> 0, 3812015801) >>> 0;
  let h = Math.imul((qx ^ qy) >>> 0, 1597334673) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
function hash01(cx, cy, period, salt) {
  const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
  return (hashU((wx + salt) >>> 0, (wy + Math.imul(salt, 7)) >>> 0) & 0xFFFFFF) / 16777215;
}
function tile(x, y, period, salt) {
  const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const m0 = hash01(cx, cy, period, salt) + (hash01(cx + 1, cy, period, salt) - hash01(cx, cy, period, salt)) * ux;
  const m1 = hash01(cx, cy + 1, period, salt) + (hash01(cx + 1, cy + 1, period, salt) - hash01(cx, cy + 1, period, salt)) * ux;
  return m0 + (m1 - m0) * uy;
}
const fbm = (base, salt, oct) => (x, y) => {
  let s = 0, amp = 0.5, n = 0, per = base;
  for (let o = 0; o < oct; o++) { s += tile(x * per, y * per, per, salt + o * 131) * amp; n += amp; amp *= 0.5; per *= 2; }
  return s / n;
};
const cloudF = fbm(10, 17, 5), warpF = fbm(4, 911, 3), veilF = fbm(3, 4421, 2), wispF = fbm(36, 2741, 3);
function noise(rx, ry, bA, bB) {
  const ax = bA[0] + rx / FOG_TILE_WORLD, ay = bA[1] + ry / FOG_TILE_WORLD;
  const bx = bB[0] + rx / FOG_TILE_WORLD, by = bB[1] + ry / FOG_TILE_WORLD;
  const wx = warpF(bx, by) - 0.5, wy = warpF(bx + 0.37, by + 0.71) - 0.5;
  return [cloudF(ax + wx * 0.07, ay + wy * 0.07), veilF(bx + 0.13, by + 0.29), wispF(bx + wx * 0.05, by + wy * 0.05)];
}

test('błąd interpolacji pamięci < 1,5e-3 przy najdalszym zoomie z pamięcią (oczko szumu ≥ 37 px)', () => {
  assert.ok(FOG_CACHE_MIN_ZOOM >= 0.03);
  const W = 192, H = 128;
  const [cw, ch] = fogCacheSizeFor(W, H);
  const maxErr = [0, 0, 0];
  for (const [bA, bB] of [[[0.31, 0.77], [0.52, 0.13]], [[0.91, 0.05], [0.08, 0.64]]]) {
    const zoom = FOG_CACHE_MIN_ZOOM;
    const cache = [];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      cache.push(noise((texelCenter(x) - W / 2) / zoom, (H / 2 - texelCenter(y)) / zoom, bA, bB));
    }
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const X = px + 0.5, Y = py + 0.5;
      const d = noise((X - W / 2) / zoom, (H / 2 - Y) / zoom, bA, bB);
      const tx = texelCoord(X) - 0.5, ty = texelCoord(Y) - 0.5;
      const ix = Math.floor(tx), iy = Math.floor(ty), wx = tx - ix, wy = ty - iy;
      for (let k = 0; k < 3; k++) {
        const c = (i, j) => cache[j * cw + i][k];
        const v = (c(ix, iy) * (1 - wx) + c(ix + 1, iy) * wx) * (1 - wy) + (c(ix, iy + 1) * (1 - wx) + c(ix + 1, iy + 1) * wx) * wy;
        maxErr[k] = Math.max(maxErr[k], Math.abs(v - d[k]));
      }
    }
  }
  for (const e of maxErr) assert.ok(e < 1.5e-3, `błąd ${e}`);
});

// WGSL w Node (renderer bez init — jak tests/webgpuPost.test.mjs).
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const fnBody = (wgsl, name) => (wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`)) || [''])[0];

test('WGSL: kernel pamięci (szum, pominięcie w kręgu, zapis z zaokrągleniem) i „uber” z obiema gałęziami szumu', () => {
  const uniforms = createPostUniforms();
  const cache = new FogNoiseCache(uniforms);
  const b = renderer.backend.createNodeBuilder(cache.kernel, renderer);
  b.build();
  const k = b.computeShader;
  for (const name of ['fowCloud', 'fowWarp', 'fowVeil', 'fowWisp', 'fowTile']) {
    assert.ok(fnBody(k, name).length > 0, `kernel bez fn ${name}`);
    assert.doesNotMatch(fnBody(k, name), /\bobject\.|\brender\.|NodeBuffer|fogOfWar\./, `${name} czyta uniform`);
  }
  assert.equal((k.match(/textureStore\(/g) || []).length, 1);
  assert.match(k, /texture_storage_2d<rgba16float, write>/);
  assert.match(k, /exp2\(/, 'zapis f16 z ½ odstępu liczb (sroundF16)');
  assert.match(k, /for \( var fogI : i32 = 0; fogI < object\.nodeUniform\d+; fogI \+\+ \)/, 'koła wzroku — pominięcie tekseli w kręgu');

  const rt = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const material = new THREE.NodeMaterial();
  material.fragmentNode = createUberPost({ sceneTexture: rt.texture, bloomTexture: null, uniforms });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const pb = renderer.backend.createNodeBuilder(mesh, renderer);
  pb.material = material;
  pb.scene = new THREE.Scene();
  pb.camera = new THREE.PerspectiveCamera();
  pb.context.material = material;
  pb.build();
  const post = pb.fragmentShader;
  // obie gałęzie w jednym grafie (uniform uFogCacheOn): odczyt pamięci (poziom 0) i szum na piksel (kamery 3D, rulon)
  assert.ok(fnBody(post, 'fowCloud').length > 0, 'szum na piksel zostaje w „uber”');
  assert.equal((post.match(/fowCloud\( /g) || []).length, 1, 'jedno wywołanie chmur na piksel (gałąź bez pamięci)');
  // odczyt pamięci: t = (px + bufW / 2) / 4 + 1, poziom 0
  const cacheReads = post.split('\n').filter((l) => /textureSampleLevel\(/.test(l) && /\/ 4\.0 \) \+ 1\.0 \)/.test(l));
  assert.equal(cacheReads.length, 1, 'jeden odczyt pamięci szumu na piksel');
  assert.match(cacheReads[0], /, 0\.0 \);$/);
  assert.doesNotMatch(post, /textureSample\(/);
  cache.dispose();
});

test('Core3D: pamięć szumu tylko kamera z góry bez rulonu i od FOG_CACHE_MIN_ZOOM, w passie compute bloomu, rozgrzana przy urządzeniu', () => {
  const core = read('src/3d/core3d.js');
  const i = core.indexOf('_updateFogUniforms(freePerspective) {');
  const body = core.slice(i, core.indexOf('\n  },', i));
  assert.match(body, /const useCache = !!cache && u\.uFogOn\.value === 1 && !v\.persp && !rulonActive\(\) && this\.fogNoiseCache !== false &&\s+v\.zoom >= FOG_CACHE_MIN_ZOOM;/);
  assert.match(body, /u\.uFogCacheOn\.value = useCache \? 1 : 0;/);
  // kernel w passie compute bloomu tuż przed „uber” (jedno zgłoszenie do kolejki mniej), bez bloomu — sam
  assert.match(body, /this\._fogKernelDue = useCache \? cache\.prepare\(this\.renderer, v\.bufW, v\.bufH\) : null;/);
  const ip = core.indexOf('  _renderPost() {');
  const post = core.slice(ip, core.indexOf('\n  },', ip));
  assert.match(post, /if \(!bezBloomu && this\.bloomPass\) this\.bloomPass\.render\(this\.renderer, fogKernel\);\s+else if \(fogKernel\) this\.renderer\.compute\(fogKernel\);/);
  assert.match(read('src/3d/tsl/bloomCompute.js'), /render\(renderer, extra = null\) \{/);
  assert.match(core, /this\._fogCache = uniforms\.uFogCache \? new FogNoiseCache\(uniforms\) : null;/);
  assert.match(core, /w\.run\('Core3D: mgła wojny — pamięć szumu \(compute\)', \(\) => cache\.update\(this\.renderer, 1, 1\)\)/);
  // mgła wyłączona — pamięć też
  const off = body.slice(0, body.indexOf('const v = _fogView;'));
  assert.match(off, /u\.uFogCacheOn\.value = 0;/);
});
