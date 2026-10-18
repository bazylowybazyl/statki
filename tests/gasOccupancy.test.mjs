// Pomijanie pustej przestrzeni w marszu gazu (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md § 7.4): zajętość
// kolumn domeny (kernel gasOccupancy, lustro gasOccupancyCpu) i zakres kroków marszu (GasVolume._occRange, lustro
// gasOccRangeCpu). Obraz ma zostać bit w bit: każda próbka pełnego marszu, która przekracza próg gęstości (próbka
// trójliniowa z przycięciem jak na GPU), musi leżeć w [kStart, kEnd) — poza nim marsz robi tylko gałąź pustą.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid, gasOccupancyCpu, GAS_OCC_THRESHOLD, GAS_OCC_PACK } = await import('../src/3d/gas/gasGrid.js');
const { GasVolume, gasOccRangeCpu } = await import('../src/3d/gas/gasVolume.js');

const f = Math.fround;
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Pole gęstości domeny N × N × NZ: [dym, temperatura] na teksel — kilka kul (jak kula ognia i kłęby) + szum przy progach.
function makeField(N, NZ, r) {
  const d = new Float32Array(N * N * NZ * 2);
  const blobs = Math.floor(r() * 4);
  for (let b = 0; b < blobs; b++) {
    const cx = r() * N, cy = r() * N, cz = r() * NZ, rad = 1 + r() * N * 0.25, amp = r() < 0.3 ? 0.004 : 1 + r() * 3;
    for (let z = 0; z < NZ; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const q = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2) / (rad * rad);
      if (q < 1) { const i = ((z * N + y) * N + x) * 2; d[i] += amp * (1 - q) * r(); d[i + 1] += amp * 0.5 * (1 - q) * r(); }
    }
  }
  // pojedyncze teksle tuż przy progach (zapas połowy progu marszu)
  for (let k = 0; k < 6; k++) { const i = Math.floor(r() * N * N * NZ) * 2; d[i] = [0.0014, 0.0016, 0.0029, 0.0031, 0.01][k % 5]; }
  return { N, NZ, d, at: (x, y, z) => { const i = ((z * N + y) * N + x) * 2; return [d[i], d[i + 1]]; } };
}

// Próbka trójliniowa jak sprzęt: współrzędna teksela c − 0,5, przycięcie do krawędzi (x, y), z przycięte w marszu.
function trilinear(F, px, py, qz) {
  const { N, NZ } = F;
  const cx = px - 0.5, cy = py - 0.5, cz = qz - 0.5;
  const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
  const fx = cx - x0, fy = cy - y0, fz = cz - z0;
  let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    if (w === 0) continue;
    const x = Math.min(N - 1, Math.max(0, x0 + dx)), y = Math.min(N - 1, Math.max(0, y0 + dy)), z = Math.min(NZ - 1, Math.max(0, z0 + dz));
    const v = F.at(x, y, z);
    s += w * (v[0] + v[1]);
  }
  return s;
}

const tap = (v, N) => Math.min(N - 1, Math.max(0, Math.floor(v - 0.5)));

// Jeden odcinek promienia jak w GasVolume._march (t narasta w f32) — zwraca kroki z próbką ponad progiem i zakres z zajętości.
function marchCase(F, ro, rd, tmin, tmax, h, bmin, stepCells, jitter) {
  const { N, NZ } = F;
  const span = f(tmax - tmin);
  const nSteps = Math.min(150, Math.max(2, Math.trunc(span / f(h * stepCells)) + 1));
  const dtW = f(span / nSteps);
  let t = f(tmin + f(dtW * jitter));
  const dense = [];
  for (let k = 0; k < nSteps; k++) {
    const pc = [0, 1, 2].map((a) => f(f(f(ro[a] + f(rd[a] * t)) - bmin[a]) / h));
    const qz = Math.min(NZ - 0.5, Math.max(0.5, pc[2]));
    if (trilinear(F, pc[0], pc[1], qz) > 0.003) dense.push(k);
    t = f(t + dtW);
  }
  const pA = [0, 1, 2].map((a) => f((ro[a] + rd[a] * tmin - bmin[a]) / h));
  const pB = [0, 1, 2].map((a) => f((ro[a] + rd[a] * tmax - bmin[a]) / h));
  let range = [0, nSteps];
  if (tap(pA[0], N) === tap(pB[0], N) && tap(pA[1], N) === tap(pB[1], N)) {
    const code = gasOccupancyCpu(F.at, N, NZ, tap(pA[0], N), tap(pA[1], N));
    range = gasOccRangeCpu(code, { x: pA[0], y: pA[1], z: pA[2] }, rd[2] / h, tmin, dtW, jitter, nSteps, NZ);
  }
  return { dense, range, nSteps };
}

test('zajętość kolumny: zakres z teksli kolumny i sąsiadów +x, +y, +xy (przyciętych), kod −1 / zlo · 64 + zhi', () => {
  const F = makeField(8, 6, () => 0);   // puste pole (r() = 0 → bez kul; szum progu trafia w teksel 0)
  F.d.fill(0);
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 3, 3), -1, 'pusta kolumna');
  const put = (x, y, z, v) => { F.d[((z * 8 + y) * 8 + x) * 2] = v; };
  put(4, 3, 2, 1);
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 3, 3), 2 * GAS_OCC_PACK + 2, 'sąsiad +x');
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 4, 3), 2 * GAS_OCC_PACK + 2, 'własna kolumna');
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 5, 3), -1, 'sąsiad −x nie liczy się (teksel i obejmuje kolumny i, i + 1)');
  put(7, 7, 5, GAS_OCC_THRESHOLD);
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 7, 7), -1, 'równo progowi — pusta');
  put(7, 7, 5, GAS_OCC_THRESHOLD * 1.01);
  put(7, 7, 0, 0.5);
  assert.equal(gasOccupancyCpu(F.at, 8, 6, 7, 7), 0 * GAS_OCC_PACK + 5, 'brzeg domeny: sąsiedzi przycięci');
});

test('zakres kroków z zajętości obejmuje KAŻDĄ próbkę pełnego marszu ponad progiem (losowe pola, promienie pionowe, obie warstwy)', () => {
  const r = rng(20261018);
  let cases = 0, skipped = 0, total = 0, emptyCols = 0;
  for (let fi = 0; fi < 40; fi++) {
    const N = [8, 12, 16][fi % 3], NZ = [6, 8, 12][fi % 3];
    const F = makeField(N, NZ, r);
    const h = 0.5 + r() * 3, bmin = [r() * 100 - 50, r() * 100 - 50, -NZ * h * 0.5];
    for (let k = 0; k < 120; k++) {
      // promień kamery z góry: rd = (0, 0, −1) (czasem z drobnym przechyłem), start nad pudłem
      const tilt = r() < 0.2 ? 1e-7 * (r() - 0.5) : 0;
      const rd = [tilt, -tilt, -1];
      const ro = [bmin[0] + r() * N * h * 1.05 - 0.02 * N * h, bmin[1] + r() * N * h * 1.05 - 0.02 * N * h, bmin[2] + NZ * h * 3];
      const tTop = ro[2] - (bmin[2] + NZ * h), tBot = ro[2] - bmin[2], tPlane = ro[2] - (bmin[2] + NZ * h * 0.5);
      for (const [a, b] of [[tTop, tPlane], [tPlane, tBot], [tTop, tBot]]) {
        const stepCells = [0.6, 0.96, 1.5][Math.floor(r() * 3)];
        const { dense, range, nSteps } = marchCase(F, ro, rd, a, b, h, bmin, stepCells, r());
        cases++; total += nSteps; skipped += nSteps - (range[1] - range[0]);
        if (range[1] === 0) emptyCols++;
        for (const s of dense) assert.ok(s >= range[0] && s < range[1], `pole ${fi}, krok ${s} poza zakresem [${range}] (gęste: ${dense})`);
      }
    }
  }
  // test ma sens tylko, gdy coś się pomija
  assert.ok(skipped / total > 0.3 && emptyCols > 100, `pominięte ${(skipped / total * 100).toFixed(0)}% kroków, puste kolumny ${emptyCols} / ${cases}`);
});

test('kamera 3D (promień przez kilka kolumn) — pełny zakres; odcinek bez wysokości z — pełny zakres', () => {
  const r = rng(7);
  const F = makeField(12, 8, r);
  const h = 2, bmin = [0, 0, -8];
  const { range, nSteps } = marchCase(F, [3, 3, 40], [0.3, 0.2, -0.93], 34, 50, h, bmin, 0.6, 0.4);
  assert.deepEqual(range, [0, nSteps]);
  assert.deepEqual(gasOccRangeCpu(2 * GAS_OCC_PACK + 3, { x: 1, y: 1, z: 4 }, 0, 0, 1, 0.5, 20, 8), [0, 20]);
  assert.deepEqual(gasOccRangeCpu(-1, { x: 1, y: 1, z: 4 }, -0.5, 0, 1, 0.5, 20, 8), [0, 0], 'pusta kolumna — bez kroków');
});

test('WGSL: kernel zajętości (R32F, textureLoad atlasu bez filtra) i marsz brył z zajętością; przebieg pełnoekranowy bez niej', () => {
  const noise = () => { const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1); t.type = THREE.HalfFloatType; return t; };
  const g = new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noise() });
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b0 = renderer.backend.createNodeBuilder(g.occNode, renderer);
  b0.build();
  assert.match(b0.computeShader, /texture_storage_2d<r32float, write>/);
  assert.equal((b0.computeShader.match(/textureLoad\(/g) || []).length, 4, 'cztery kolumny bez próbkowania');
  const vol = new GasVolume({ grid: g, noise3D: noise(), curl3D: noise() });
  const M = vol.createMeshes({ layer: 0, name: 'GasOcc' });
  for (const mesh of [M.back, M.front]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = mesh.material;
    b.build();
    const fs = b.fragmentShader;
    assert.match(fs, /textureLoad\( \w+, vec2<i32>/, `${mesh.name}: teksel zajętości kolumny`);
    assert.match(fs, /for \( var gstep : i32 = 0; gstep < \w+; gstep \+\+ \)/, `${mesh.name}: pętla do kEnd`);
    assert.match(fs, /if \( \( gstep < \w+ \) \)/, `${mesh.name}: kroki przed kStart bez odczytu`);
    assert.ok((fs.match(/var<uniform>/g) || []).length <= 12);
  }
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = vol.node(null);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), mat);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mat;
  b.build();
  assert.doesNotMatch(b.fragmentShader, /vec2<i32>/, 'przebieg pełnoekranowy dem — bez zajętości');
  // przełącznik A/B: uniform, nie przebudowa materiału
  vol.skipEmpty = false; vol.syncLook();
  assert.equal(vol.U.occOn.value, 0);
  vol.skipEmpty = true; vol.syncLook();
  assert.equal(vol.U.occOn.value, 1);
});
