import test from 'node:test';
import assert from 'node:assert/strict';

import {
  voxelizeTriangles,
  buildVoxelBody,
  makeBoxTriangles,
  concatTriangleSets,
  triBoxOverlap,
  invertSymmetric3,
  packKey,
  extractTrianglesFromObject3D,
  extractSkinParts,
  bindSkinToLattice
} from '../src/game/voxelBody3D.js';

// Atrapa mesha ze wszystkimi atrybutami skóry (pozycja, normalna, UV) + indeksami.
function makeFakeSkinMesh(tris, matrixElements = null) {
  const vertCount = tris.length / 3;
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  for (let i = 0; i < vertCount; i++) {
    normals[i * 3] = 0; normals[i * 3 + 1] = 0; normals[i * 3 + 2] = 1;
    uvs[i * 2] = (i % 7) / 7;
    uvs[i * 2 + 1] = (i % 5) / 5;
  }
  const indices = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) indices[i] = i;
  const acc = (arr, stride) => ({
    count: vertCount,
    array: arr,
    getX: (i) => arr[i * stride],
    getY: (i) => arr[i * stride + 1],
    getZ: (i) => arr[i * stride + 2]
  });
  return {
    isMesh: true,
    visible: true,
    geometry: {
      attributes: { position: acc(tris, 3), normal: acc(normals, 3), uv: acc(uvs, 2) },
      index: { array: indices },
      groups: []
    },
    material: { color: { r: 0.3, g: 0.5, b: 0.7 }, map: null },
    matrixWorld: { elements: matrixElements || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    children: []
  };
}

// Atrapa mesha z atrybutem INTERLEAVED (jak GLTFLoader dla .glb):
// .array to cały przeplatany bufor (stride 8), a poprawne odczyty dają
// wyłącznie akcesory getX/getY/getZ. Sloty nie-pozycyjne wypełnione śmieciami,
// więc indeksowanie idx*3 po .array MUSI dać złe wyniki.
function makeFakeInterleavedMesh(tris, { visible = true } = {}) {
  const vertCount = tris.length / 3;
  const stride = 8;
  const inter = new Float32Array(vertCount * stride).fill(999);
  for (let i = 0; i < vertCount; i++) {
    inter[i * stride] = tris[i * 3];
    inter[i * stride + 1] = tris[i * 3 + 1];
    inter[i * stride + 2] = tris[i * 3 + 2];
  }
  return {
    isMesh: true,
    visible,
    geometry: {
      attributes: {
        position: {
          count: vertCount,
          array: inter,
          isInterleavedBufferAttribute: true,
          getX: (i) => inter[i * stride],
          getY: (i) => inter[i * stride + 1],
          getZ: (i) => inter[i * stride + 2]
        }
      },
      index: null,
      groups: []
    },
    material: { color: { r: 0.2, g: 0.4, b: 0.6 } },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    children: []
  };
}

// Sześcian przesunięty o 0.05, żeby ściany nie leżały idealnie na płaszczyznach
// kratownicy (unika dwuznacznych trafień stempla na styku komórek).
function offsetCubeTris(size = 2, off = 0.05) {
  return makeBoxTriangles(size, size, size, off, off, off);
}

test('makeBoxTriangles zwraca 12 trójkątów (108 floatów)', () => {
  const tris = makeBoxTriangles(1, 2, 3);
  assert.equal(tris.length, 108);
});

test('triBoxOverlap: trójkąt przecinający box i trójkąt odległy', () => {
  // trójkąt przez środek boxa o half=0.5
  assert.equal(triBoxOverlap(0.5, 0.5, 0.5, -1, 0, 0, 1, 0.2, 0, 0, -0.2, 0.3), true);
  // trójkąt daleko poza boxem
  assert.equal(triBoxOverlap(0.5, 0.5, 0.5, 10, 10, 10, 11, 10, 10, 10, 11, 10), false);
});

test('voxelizeTriangles: pełny sześcian ma powierzchnię i wnętrze', () => {
  const vox = voxelizeTriangles(offsetCubeTris(), null, { cellSize: 0.5, shellLayers: 0 });
  assert.ok(vox.cells.length >= 60, `za mało komórek: ${vox.cells.length}`);
  assert.ok(vox.cells.length <= 260, `za dużo komórek: ${vox.cells.length}`);
  const surface = vox.cells.filter((c) => c.surface);
  const interior = vox.cells.filter((c) => !c.surface);
  assert.ok(surface.length > 0, 'brak komórek powierzchni');
  assert.ok(interior.length > 0, 'flood fill nie wyznaczył wnętrza');
  // wnętrze nie może wyciec poza AABB sześcianu
  for (const c of vox.cells) {
    assert.ok(c.x > -1.6 && c.x < 1.7, `komórka poza bryłą: ${c.x}`);
  }
});

test('voxelizeTriangles: skorupa ma mniej komórek niż pełny wolumen', () => {
  const full = voxelizeTriangles(offsetCubeTris(3), null, { cellSize: 0.5, shellLayers: 0 });
  const shell = voxelizeTriangles(offsetCubeTris(3), null, { cellSize: 0.5, shellLayers: 2 });
  assert.ok(shell.cells.length < full.cells.length,
    `skorupa (${shell.cells.length}) nie jest mniejsza od pełnej (${full.cells.length})`);
});

test('voxelizeTriangles: kolory trójkątów trafiają do komórek powierzchni', () => {
  const sets = concatTriangleSets([
    { positions: offsetCubeTris(2), color: [0.9, 0.1, 0.2] }
  ]);
  const vox = voxelizeTriangles(sets.positions, sets.colors, { cellSize: 0.5, shellLayers: 0 });
  const surf = vox.cells.find((c) => c.surface);
  assert.ok(surf, 'brak powierzchni');
  assert.ok(Math.abs(surf.r - 0.9) < 1e-4, `zły kolor r: ${surf.r}`);
});

test('buildVoxelBody: recentrowanie do środka masy i sensowny tensor', () => {
  const vox = voxelizeTriangles(offsetCubeTris(2, 0.4), null, { cellSize: 0.5, shellLayers: 0 });
  const body = buildVoxelBody(vox, { cellMassBase: 10 });

  // środek masy komórek po recentrowaniu ≈ 0
  let mx = 0, my = 0, mz = 0, m = 0;
  for (const c of body.cells) {
    mx += c.x * c.mass; my += c.y * c.mass; mz += c.z * c.mass; m += c.mass;
  }
  assert.ok(Math.abs(mx / m) < 1e-9, `COM.x = ${mx / m}`);
  assert.ok(Math.abs(my / m) < 1e-9, `COM.y = ${my / m}`);
  assert.ok(Math.abs(mz / m) < 1e-9, `COM.z = ${mz / m}`);

  assert.ok(body.mass > 0);
  assert.ok(body.radius > 0.5);
  for (const v of body.invInertia) assert.ok(Number.isFinite(v));
  // dla sześcianu przekątna tensora ~równa, odwrotność dodatnia
  assert.ok(body.invInertia[0] > 0);
  assert.ok(Math.abs(body.invInertia[0] - body.invInertia[4]) / body.invInertia[0] < 0.35);
});

test('buildVoxelBody: totalMass skaluje masę całkowitą', () => {
  const vox = voxelizeTriangles(offsetCubeTris(), null, { cellSize: 0.5, shellLayers: 0 });
  const body = buildVoxelBody(vox, { totalMass: 5000 });
  assert.ok(Math.abs(body.mass - 5000) < 1e-6);
});

test('invertSymmetric3: odwraca macierz diagonalną', () => {
  const inv = invertSymmetric3([2, 0, 0, 0, 4, 0, 0, 0, 8]);
  assert.ok(Math.abs(inv[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(inv[4] - 0.25) < 1e-12);
  assert.ok(Math.abs(inv[8] - 0.125) < 1e-12);
});

test('extractTrianglesFromObject3D: ukryty ROOT nie blokuje ekstrakcji', () => {
  const tris = makeBoxTriangles(2, 2, 2);
  const root = {
    visible: false, // model referencyjny schowany w scenie — geometria ma się wyciągnąć
    children: [makeFakeInterleavedMesh(tris)],
    updateWorldMatrix() {}
  };
  const out = extractTrianglesFromObject3D(root);
  assert.equal(out.positions.length, tris.length, 'zła liczba trójkątów z ukrytego roota');
});

test('extractTrianglesFromObject3D: atrybuty interleaved czytane akcesorami', () => {
  const tris = makeBoxTriangles(2, 4, 6, 1, 2, 3);
  const root = { visible: true, children: [makeFakeInterleavedMesh(tris)], updateWorldMatrix() {} };
  const out = extractTrianglesFromObject3D(root);
  assert.equal(out.positions.length, tris.length);
  // wartości muszą się zgadzać 1:1 — indeksowanie .array dałoby 999-ki ze slotów przeplotu
  for (let i = 0; i < tris.length; i++) {
    assert.ok(Math.abs(out.positions[i] - tris[i]) < 1e-6, `pozycja[${i}]: ${out.positions[i]} != ${tris[i]}`);
  }
  assert.ok(Math.abs(out.colors[0] - 0.2) < 1e-6, 'kolor materiału nie przeniesiony');
});

test('extractTrianglesFromObject3D: ukryte DZIECKO jest pomijane', () => {
  const visibleTris = makeBoxTriangles(1, 1, 1);
  const root = {
    visible: true,
    children: [
      makeFakeInterleavedMesh(visibleTris),
      makeFakeInterleavedMesh(makeBoxTriangles(9, 9, 9), { visible: false })
    ],
    updateWorldMatrix() {}
  };
  const out = extractTrianglesFromObject3D(root);
  assert.equal(out.positions.length, visibleTris.length, 'ukryte dziecko trafiło do ekstrakcji');
});

test('interiorMode: żebra są gęstsze od pustej skorupy, rzadsze od litej bryły', () => {
  const tris = offsetCubeTris(6);
  const opts = { cellSize: 0.5, shellLayers: 2 };
  const shell = voxelizeTriangles(tris, null, { ...opts, interiorMode: 'shell' });
  const ribs = voxelizeTriangles(tris, null, { ...opts, interiorMode: 'ribs', ribStep: 4 });
  const full = voxelizeTriangles(tris, null, { ...opts, interiorMode: 'full' });

  assert.ok(ribs.cells.length > shell.cells.length,
    `żebra (${ribs.cells.length}) nie dodały komórek do skorupy (${shell.cells.length})`);
  assert.ok(ribs.cells.length < full.cells.length,
    `żebra (${ribs.cells.length}) nie są rzadsze od litej bryły (${full.cells.length})`);
});

test('interiorMode ribs: konstrukcja jest spójna ze skorupą (jedna wyspa)', async () => {
  // Belki oderwane od skorupy odpadłyby jako wraki przy pierwszym sprawdzeniu rozpadów.
  const { Destructor3D, createDestructor3DConfig } = await import('../src/game/destructor3D.js');
  const vox = voxelizeTriangles(offsetCubeTris(6), null, {
    cellSize: 0.5, shellLayers: 2, interiorMode: 'ribs', ribStep: 4
  });
  Destructor3D.init(createDestructor3DConfig(0.5));
  const body = Destructor3D.createBody(buildVoxelBody(vox, { cellMassBase: 10 }), {});
  const islands = Destructor3D.findIslands(body.grid);
  assert.equal(islands.length, 1, `konstrukcja rozpadła się na ${islands.length} wysp`);
});

test('extractSkinParts: wypieka pozycje i normalne do przestrzeni ekstrakcji', () => {
  const tris = makeBoxTriangles(2, 2, 2);
  // przesunięcie o (10,0,0) w macierzy świata musi wejść w pozycje
  const shifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  const root = { visible: true, children: [makeFakeSkinMesh(tris, shifted)], updateWorldMatrix() {} };
  const parts = extractSkinParts(root);

  assert.equal(parts.length, 1);
  const part = parts[0];
  assert.equal(part.positions.length, tris.length);
  assert.equal(part.normals.length, tris.length);
  assert.equal(part.uvs.length, (tris.length / 3) * 2);
  assert.equal(part.indices.length, tris.length / 3);
  for (let i = 0; i < tris.length; i += 3) {
    assert.ok(Math.abs(part.positions[i] - (tris[i] + 10)) < 1e-5, 'macierz świata nie wypieczona w pozycje');
  }
});

test('bindSkinToLattice: każdy wierzchołek trafia w ZAJĘTĄ komórkę', () => {
  // Wierzchołki skóry leżą dokładnie na granicy bryły — bez szukania najbliższej
  // zajętej komórki część z nich wskazywałaby pustkę i maska wycinałaby dziury
  // w nietkniętym kadłubie.
  const tris = makeBoxTriangles(3, 3, 3, 0.05, 0.05, 0.05);
  const vox = voxelizeTriangles(tris, null, { cellSize: 0.5, shellLayers: 0 });
  const root = { visible: true, children: [makeFakeSkinMesh(tris)], updateWorldMatrix() {} };
  const parts = extractSkinParts(root);

  const info = bindSkinToLattice(parts, vox.cells, {
    nx: vox.nx, ny: vox.ny, nz: vox.nz, cellSize: vox.cellSize, origin: vox.origin
  });
  assert.equal(info.unbound, 0, `${info.unbound} wierzchołków bez zajętej komórki`);

  const occupied = new Set(vox.cells.map((c) => packKey(c.ix, c.iy, c.iz)));
  const uv = parts[0].cellUV;
  assert.equal(uv.length, parts[0].positions.length);
  for (let v = 0; v < uv.length / 3; v++) {
    const i = Math.round(uv[v * 3] * vox.nx - 0.5);
    const j = Math.round(uv[v * 3 + 1] * vox.ny - 0.5);
    const k = Math.round(uv[v * 3 + 2] * vox.nz - 0.5);
    assert.ok(occupied.has(packKey(i, j, k)), `wierzchołek ${v} wskazuje pustą komórkę (${i},${j},${k})`);
  }
});

test('buildVoxelBody ze skórą: wierzchołki jadą do środka masy razem z komórkami', () => {
  const tris = makeBoxTriangles(3, 3, 3, 4, 5, 6); // bryła daleko od początku układu
  const vox = voxelizeTriangles(tris, null, { cellSize: 0.5, shellLayers: 0 });
  const root = { visible: true, children: [makeFakeSkinMesh(tris)], updateWorldMatrix() {} };
  const skinParts = extractSkinParts(root);
  const body = buildVoxelBody(vox, { cellMassBase: 10, skinParts });

  assert.ok(body.skin, 'brak danych skóry');
  assert.equal(body.skin.unbound, 0);
  assert.equal(body.skin.occupancy.length, vox.nx * vox.ny * vox.nz);
  assert.ok(body.skin.triangleCount > 0);

  // Po recentrowaniu środek chmury wierzchołków musi leżeć blisko zera — tak samo
  // jak komórki. Rozjazd oznaczałby skórę przesuniętą względem kratownicy.
  const p = body.skin.parts[0].positions;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < p.length; i += 3) { sx += p[i]; sy += p[i + 1]; sz += p[i + 2]; }
  const n = p.length / 3;
  assert.ok(Math.abs(sx / n) < 0.6, `skóra nie wyśrodkowana w X: ${sx / n}`);
  assert.ok(Math.abs(sy / n) < 0.6, `skóra nie wyśrodkowana w Y: ${sy / n}`);
  assert.ok(Math.abs(sz / n) < 0.6, `skóra nie wyśrodkowana w Z: ${sz / n}`);

  // occupancy musi zgadzać się z faktycznymi komórkami
  let occCount = 0;
  for (let i = 0; i < body.skin.occupancy.length; i++) if (body.skin.occupancy[i]) occCount++;
  assert.equal(occCount, vox.cells.length);
});

test('packKey: unikalne klucze dla różnych indeksów', () => {
  const seen = new Set();
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1023, 1023, 1023], [5, 7, 9]]) {
    const k = packKey(x, y, z);
    assert.ok(!seen.has(k));
    seen.add(k);
  }
});
