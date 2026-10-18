// Światło objętościowe pasa asteroid (src/3d/asteroids/volumetrics.js, 2026-10-18, docs/AUDYT-render-worker-2026-10-17.md
// § 7.5): kernel `plastry` (wątek na kolumnę × plaster, całkowanie po barierze grupy) obok dawnego kernela (wątek na
// kolumnę). Bit w bit sprawdza odczyt tekstury z GPU (scripts/webgpu/pas-swiatlo-gra.mjs); tu: podział wątków (lustro
// CPU), WGSL obu kerneli zbudowany w Node (ta sama pętla świateł, bariera w jednolitym przepływie, limity WebGPU),
// wybór kernela i liczby wątków w `compute()`.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { uniform } = await import('three/tsl');
const { LightGrid } = await import('../src/3d/fx/lightGrid.js');
const { ShadowAtlas } = await import('../src/3d/asteroids/spotShadows.js');
const {
  VolumeLight, VOLUME_LIGHT_TUNE, volumeSliceThread, volumeSliceThreads
} = await import('../src/3d/asteroids/volumetrics.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };

function makeVolume(calls = []) {
  const grid = new LightGrid({ name: 'fxGrid' });
  grid.shadows = new ShadowAtlas();
  const fieldMap = {
    origin: uniform(new THREE.Vector2()), invSize: uniform(new THREE.Vector2(1, 1)),
    texture: new THREE.DataTexture(new Uint16Array(16), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType)
  };
  const renderer = { compute(node, count) { calls.push({ node, count }); } };
  return new VolumeLight({ renderer, grid, fieldMap, parent: new THREE.Group(), layer: 0 });
}

function wgsl(node) {
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}

test('podział wątków kernela „plastry”: każda kolumna dostaje wszystkie plastry raz, w jednej grupie roboczej', () => {
  for (const [columns, nz, cols, per] of [[1, 40, 4, 1], [7, 40, 4, 1], [73515, 40, 4, 1], [1001, 40, 8, 2], [1001, 40, 32, 8], [101, 33, 6, 3], [64, 64, 4, 1]]) {
    const threads = volumeSliceThreads(columns, nz, cols, per);
    const wg = cols * nz / per;
    assert.ok(wg <= 256);
    assert.equal(threads % wg, 0, 'pełne grupy');
    assert.ok(threads >= columns * nz / per && threads - columns * nz / per < wg, 'bez nadmiaru ponad jedną grupę');
    const seen = new Map();
    for (let id = 0; id < threads; id++) {
      const t = volumeSliceThread(id, nz, cols, per);
      assert.equal(t.wg, wg);
      assert.equal(t.lane, id % wg);
      if (t.column >= columns) continue;
      let col = seen.get(t.column);
      if (!col) seen.set(t.column, col = { kz: new Set(), group: t.group, colLocal: t.colLocal });
      assert.equal(t.group, col.group, `kolumna ${t.column}: wszystkie plastry w jednej grupie (bariera)`);
      assert.equal(t.colLocal, col.colLocal);
      assert.equal(t.column, t.group * cols + t.colLocal, 'kolumnę całkuje wątek o miejscu colLocal tej grupy');
      for (const k of t.kz) { assert.ok(k >= 0 && k < nz && !col.kz.has(k), 'plaster raz'); col.kz.add(k); }
    }
    assert.equal(seen.size, columns, 'każda kolumna');
    for (const col of seen.values()) assert.equal(col.kz.size, nz);
  }
});

test('WGSL: kernel „plastry” — grupa kolumny × NZ, bariera w jednolitym przepływie, ta sama pętla świateł co dawny', () => {
  const v = makeVolume();
  const NZ = v.NZ;
  const oldCs = wgsl(v.node);
  const cs = wgsl(v.nodeSlices);
  assert.match(oldCs, /@workgroup_size\( 64, 1, 1 \)/);
  assert.doesNotMatch(oldCs, /workgroupBarrier|var<workgroup>/);
  const cols = VOLUME_LIGHT_TUNE.cols, per = VOLUME_LIGHT_TUNE.per;
  const WG = cols * NZ / per;
  assert.ok(WG <= 256, 'limit wątków grupy WebGPU (256)');
  assert.match(cs, new RegExp(`@workgroup_size\\( ${WG}, 1, 1 \\)`));
  assert.match(cs, new RegExp(`var<workgroup> \\w+\\s*: array< vec4<f32>, ${cols * NZ} >`));
  assert.match(cs, new RegExp(`var<workgroup> \\w+\\s*: array< f32, ${cols * NZ} >`));
  assert.ok(cols * NZ * (16 + 4) <= 16384, 'pamięć grupy ≤ 16 KiB');
  // bariera raz, w głównym przepływie (wcięcie jednego poziomu), żadnego `return` przed nią
  const lines = cs.split('\n');
  const bi = lines.findIndex((l) => l.includes('workgroupBarrier()'));
  assert.ok(bi > 0 && lines.filter((l) => l.includes('workgroupBarrier()')).length === 1);
  assert.match(lines[bi], /^\tworkgroupBarrier\(\);/, 'bariera poza gałęzią');
  const main = lines.slice(lines.findIndex((l) => l.startsWith('fn main(')), bi).join('\n');
  assert.doesNotMatch(main, /\breturn\b/, 'bez wcześniejszego wyjścia przed barierą');
  // wkład światła do rozproszenia plastra — ta sama linia WGSL (z dokładnością do numerów zmiennych) w obu kernelach
  const accLine = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l.includes('render.fxGridGain')).map((l) => l.replace(/nodeVar\d+/g, 'v').replace(/nodeUniform\d+/g, 'u'));
  assert.deepEqual(accLine(cs), accLine(oldCs));
  assert.equal(accLine(cs).length, 1);
  // całkowanie: jeden wątek kolumny (plaster 0), NZ zapisów tekstury w pętli
  assert.match(cs, new RegExp(`for \\( var kzI : i32 = 0; kzI < ${NZ}; kzI \\+\\+ \\)`));
  assert.equal((cs.match(/textureStore\(/g) || []).length, 1);
  assert.ok((cs.match(/var<uniform>/g) || []).length <= 12);
});

test('compute(): kernel z przełącznika, liczba wątków z liczby kolumn; rozgrzewka obu kerneli', () => {
  const calls = [];
  const v = makeVolume(calls);
  calls.length = 0;
  v.update({ camX: 0, camY: 0, zoom: 0.2, viewW: 1920, viewH: 1080, time: 0, originX: 0, originY: 0 });
  const cols = v.stats.columns;
  assert.ok(cols > 1000);
  const keep = VOLUME_LIGHT_TUNE.slices;
  try {
    VOLUME_LIGHT_TUNE.slices = true;
    v.compute();
    VOLUME_LIGHT_TUNE.slices = false;
    v.compute();
  } finally {
    VOLUME_LIGHT_TUNE.slices = keep;
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].node, v.nodeSlices);
  assert.equal(calls[0].count, volumeSliceThreads(cols, v.NZ, VOLUME_LIGHT_TUNE.cols, VOLUME_LIGHT_TUNE.per));
  assert.equal(calls[1].node, v.node);
  assert.equal(calls[1].count, cols);
  assert.deepEqual(v.computeNodes(), [v.node, v.nodeSlices]);
  assert.equal(VOLUME_LIGHT_TUNE.slices, true, 'domyślnie kernel „plastry”');
  // wyłączony ośrodek — bez dispatchu
  calls.length = 0;
  v.setVisible(false);
  v.update({ camX: 0, camY: 0, zoom: 0.2, viewW: 1920, viewH: 1080, time: 0, originX: 0, originY: 0 });
  v.compute();
  assert.equal(calls.length, 0);
});
