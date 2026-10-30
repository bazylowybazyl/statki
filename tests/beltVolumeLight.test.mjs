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

test('drabina kolumny ośrodka: przy ruchu zoomu siatka froxeli stoi w świecie (przeskok tylko na stopniu, histereza)', () => {
  const v = makeVolume();
  const at = (zoom, camX = 15000.3, camY = -9000.7) => {
    v.update({ camX, camY, zoom, viewW: 5120, viewH: 1440, time: 0, originX: 0, originY: 0 });
    return { cell: v.U.cell.value.x, x0: v.medium.U.origin.value.x, y0: v.medium.U.origin.value.y, fine: v.U.fine.value };
  };
  const keep = VOLUME_LIGHT_TUNE.cellLadder;
  try {
    VOLUME_LIGHT_TUNE.cellLadder = true;
    const a = at(0.341);
    const needAt = (z) => Math.max(v.cfg.cellPx / z, 2 * (2560 / z) * 1.08 / (v.NX - 3), 2 * (720 / z) * 1.08 / (v.NY - 3));
    const need = needAt(0.341);
    assert.ok(a.cell >= need - 1e-9 && a.cell < need * 1.1, `kolumna ${a.cell} pokrywa kadr (potrzebna ${need})`);
    assert.ok(Math.abs(Math.log2(a.cell) * 8 - Math.round(Math.log2(a.cell) * 8)) < 1e-9, 'stopień 2^(j/8)');
    // sprężyna zoomu po ząbku kółka: kilka klatek po < 1% — kolumna i róg siatki bez zmian (dawniej przesunięcie fazy)
    for (const z of [0.3405, 0.3401, 0.3398, 0.3402]) {
      const b = at(z);
      assert.equal(b.cell, a.cell);
      // róg siatki to wielokrotność kolumny (początek kadru może przejść o całą kolumnę) — kolumny w tych samych miejscach
      const ph = (x) => Math.abs(x / a.cell - Math.round(x / a.cell));
      assert.ok(ph(b.x0) < 1e-9 && ph(b.y0) < 1e-9 && Math.abs(b.x0 - a.x0) <= a.cell + 1e-9);
      assert.ok(b.fine >= 0 && b.fine <= 1);
    }
    // oddalenie: stopień w górę od razu (pokrycie kadru), powrót w dół dopiero z histerezą
    const far = at(0.341 / 1.2);
    assert.ok(far.cell > a.cell);
    assert.equal(at(0.341 / 1.2 * 1.02).cell, far.cell, 'histereza');
    assert.equal(at(0.341).cell, a.cell);
    // A/B: bez drabiny — kolumna wprost z kadru (dawniej)
    VOLUME_LIGHT_TUNE.cellLadder = false;
    assert.ok(Math.abs(at(0.341).cell - need) < 1e-9);
    assert.notEqual(at(0.3405).cell, at(0.341).cell);
  } finally {
    VOLUME_LIGHT_TUNE.cellLadder = keep;
  }
  assert.equal(VOLUME_LIGHT_TUNE.cellLadder, true, 'domyślnie drabina');
});

// SIATKA KOLUMN W UKŁADZIE SCENY (2026-10-29, zgłoszenie „snopy front i pomocnicze drżą”): początek pola (Core3D.fx.origin,
// FxPoolOrigin) jest lepki — przy żywym pasie przeskakuje po 20 tys. j. drogi kamery o całkowitą liczbę jednostek, a kolumna
// 2^(j/8) j. go nie dzieli. Siatka kolumn względem początku przeskakiwała wtedy w świecie o (przeskok mod kolumna) — ~pół
// kolumny (5,3 px przy zoomie 0,45) jednym szarpnięciem smug reflektorów, cieni skał w smudze i włókien.
test('siatka kolumn ośrodka stoi w świecie przy przeskokach początku pola (A/B VOLUME_LIGHT_TUNE.worldAnchor)', async (t) => {
  const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
  const run = (v, frames) => {
    const vol = makeVolume();
    const origin = new FxPoolOrigin();
    origin.register({ isLive: () => true });            // pas aktywny (asteroidBelt: isLive: () => this.active)
    const zoom = 0.45;
    let camX = 1.6e6 + 1234.567;
    const camY = 345.678;
    let prev = NaN;
    let jumps = 0;
    let maxJump = 0;
    let maxDrift = 0;
    let cell = 0;
    for (let f = 0; f < frames; f++) {
      camX += v / 240;
      origin.update(camX, -camY, f / 240, f / 240, f / 240);
      const ox = origin.x;
      const oy = -origin.y;                              // jak asteroidBelt: ox = origin.x, oy = −origin.y (świat gry)
      // kadr 1920 × 1080 przy teksturze ośrodka atrapy (kanwa 640 px: 196 × 112 kolumn) daje kolumnę jak w grze przy
      // 5120 × 1440 (508 × 146) — 24,7 j. przy zoomie 0,45
      vol.update({ camX: camX - ox, camY: -(camY - oy), zoom, viewW: 1920, viewH: 1080, time: f / 240, originX: ox, originY: oy, fade: 1 });
      cell = vol.U.cell.value.x;
      // róg siatki w świecie: lokalny róg (float32 uniformu) + początek; faza = reszta z kolumny
      const xs = ox + vol.medium.U.origin.value.x;
      const ys = -oy + vol.medium.U.origin.value.y;
      const phase = ((xs % cell) + cell) % cell;
      const phaseY = ((ys % cell) + cell) % cell;
      if (prev === prev) {
        let d = Math.abs(phase - prev);
        d = Math.min(d, cell - d);
        if (d > 1e-3) { jumps++; maxJump = Math.max(maxJump, d); } else maxDrift = Math.max(maxDrift, d);
      }
      prev = phase;
      // y sceny: ta sama zasada (kamera stoi w y — faza stała w obu wariantach poza przeskokami)
      if (VOLUME_LIGHT_TUNE.worldAnchor) assert.ok(Math.min(phaseY, cell - phaseY) < 2e-3, `faza y ${phaseY}`);
    }
    return { jumps, maxJump, maxDrift, cell, rebases: origin.rebases };
  };
  const keep = VOLUME_LIGHT_TUNE.worldAnchor;
  try {
    assert.equal(keep, true, 'domyślnie siatka w układzie sceny');
    // PRZELOT 3000 j/s przez 30 s (4 przeskoki) i hipercruise w pasie 24 tys. j/s przez 4 s
    for (const [v, frames] of [[3000, 240 * 30], [24000, 240 * 4]]) {
      const r = run(v, frames);
      assert.ok(r.rebases >= 4, `przeskoki początku: ${r.rebases}`);
      assert.equal(r.jumps, 0, `v ${v}: siatka kolumn bez przeskoków w świecie (największy ${r.maxJump})`);
      VOLUME_LIGHT_TUNE.worldAnchor = false;
      const old = run(v, frames);
      VOLUME_LIGHT_TUNE.worldAnchor = true;
      assert.equal(old.jumps, old.rebases, `v ${v}: dawniej przeskok siatki na każdym przeskoku początku`);
      if (v === 3000) assert.ok(old.maxJump > 0.3 * old.cell, `dawniej ${old.maxJump.toFixed(2)} j. z kolumny ${old.cell.toFixed(2)}`);
      t.diagnostic(`v ${v} j/s: ${r.rebases} przeskoków początku — siatka kolumn bez skoku (dawniej ${old.maxJump.toFixed(2)} j. = ${(old.maxJump * 0.45).toFixed(2)} px na przeskok)`);
    }
  } finally {
    VOLUME_LIGHT_TUNE.worldAnchor = keep;
  }
});
