import { triBoxOverlap } from '../game/voxelBody3D.js';

// Indeks komórka -> trójkąty liczony raz, przed zderzeniem. Trójkąt może
// przecinać wiele komórek (także bez wierzchołka wewnątrz danej komórki).
export function prepareSkinChunks(skin) {
  if (skin._chunks) return skin._chunks;
  const { x: nx, y: ny, z: nz } = skin.dims;
  const total = nx * ny * nz;
  skin._nodeCount = skin.occupancy.reduce((sum, x) => sum + (x ? 1 : 0), 0);
  skin._chunks = skin.parts.map(part => {
    const offsets = new Uint32Array(total + 1);
    const links = [];
    const uv = part.cellUV, indices = part.indices;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ax = uv[a] * nx, ay = uv[a + 1] * ny, az = uv[a + 2] * nz;
      const bx = uv[b] * nx, by = uv[b + 1] * ny, bz = uv[b + 2] * nz;
      const cx = uv[c] * nx, cy = uv[c + 1] * ny, cz = uv[c + 2] * nz;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy)));
      const z0 = Math.max(0, Math.floor(Math.min(az, bz, cz))), z1 = Math.min(nz - 1, Math.floor(Math.max(az, bz, cz)));
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cell = x + y * nx + z * nx * ny;
        if (!skin.occupancy[cell]) continue;
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        if (!triBoxOverlap(0.50001, 0.50001, 0.50001,
          ax - px, ay - py, az - pz, bx - px, by - py, bz - pz, cx - px, cy - py, cz - pz)) continue;
        offsets[cell + 1]++;
        links.push(cell, i / 3);
      }
    }
    for (let i = 1; i <= total; i++) offsets[i] += offsets[i - 1];
    const cursor = offsets.slice();
    const triangles = new Uint32Array(links.length / 2);
    for (let i = 0; i < links.length; i += 2) triangles[cursor[links[i]]++] = links[i + 1];
    return { offsets, triangles, marks: new Uint32Array(indices.length / 3), stamp: 0,
      selected: new indices.constructor(indices.length), count: 0 };
  });
  return skin._chunks;
}

// Wspólny bufor roboczy; kopia do indeksu GPU powstaje tylko przy zmianie
// przynależności węzłów, nigdy przy samym ruchu lub wgniataniu kadłuba.
export function selectSkinChunk(skin, partIndex, nodes) {
  const chunk = prepareSkinChunks(skin)[partIndex];
  if (++chunk.stamp >= 0xffffffff) { chunk.marks.fill(0); chunk.stamp = 1; }
  const nx = skin.dims.x, nxy = nx * skin.dims.y;
  const source = skin.parts[partIndex].indices;
  // Magazyn węzłów ciała (beamStore3D) albo tablica obiektów { ix, iy, iz, active }.
  const store = nodes && nodes.ix instanceof Int32Array ? nodes : null;
  const total = store ? store.count : nodes.length;
  let count = 0;
  for (let k = 0; k < total; k++) {
    let cell;
    if (store) {
      if (!store.active[k]) continue;
      cell = store.ix[k] + store.iy[k] * nx + store.iz[k] * nxy;
    } else {
      const n = nodes[k];
      if (!n.active) continue;
      cell = n.ix + n.iy * nx + n.iz * nxy;
    }
    for (let i = chunk.offsets[cell]; i < chunk.offsets[cell + 1]; i++) {
      const triangle = chunk.triangles[i];
      if (chunk.marks[triangle] === chunk.stamp) continue;
      chunk.marks[triangle] = chunk.stamp;
      const t = triangle * 3;
      chunk.selected[count++] = source[t];
      chunk.selected[count++] = source[t + 1];
      chunk.selected[count++] = source[t + 2];
    }
  }
  chunk.count = count;
  return chunk;
}
