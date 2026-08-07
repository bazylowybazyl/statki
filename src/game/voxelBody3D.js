/**
 * voxelBody3D — wokselizacja modeli 3D (.glb / dowolny THREE.Object3D / surowe trójkąty)
 * do siatki sześciennej pod silnik destrukcji destructor3D.
 *
 * Zasada jak initHexBody() w destructor.js, tylko w 3D:
 *  - zamiast kanału alpha sprite'a → stempel trójkątów (SAT trójkąt–sześcian),
 *  - zamiast heksów 2D → komórki sześcienne (6 sąsiadów),
 *  - flood fill od zewnątrz wyznacza wnętrze (odporny na drobne nieszczelności),
 *  - opcjonalna skorupa (shellLayers) zamiast pełnego wolumenu — mniej komórek,
 *  - kolor komórki zbierany z materiału/tekstury trafionych trójkątów,
 *  - tensor bezwładności liczony wprost z mas komórek (dokładny, przeliczalny po splicie).
 *
 * Moduł celowo NIE importuje three — trójkąty przyjmuje jako płaskie tablice,
 * a adapter extractTrianglesFromObject3D działa na duck-typingu (testowalne w node).
 */

// 6 sąsiadów siatki sześciennej (odpowiednik 6 sąsiadów heksa).
export const VOXEL_NEIGHBOR_OFFSETS = Object.freeze([
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1]
]);

// Pakowanie indeksu komórki do klucza SMI: po 10 bitów na oś (max 1023).
export const LATTICE_AXIS_MAX = 1023;

export function packKey(ix, iy, iz) {
  return ix | (iy << 10) | (iz << 20);
}

// ---------------------------------------------------------------------------
// SAT trójkąt–AABB (Akenine-Möller, wersja generyczna po 3 wierzchołkach).
// Wierzchołki podawane już w układzie środka boxa.
// ---------------------------------------------------------------------------
function axisSeparates(axX, axY, axZ, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const p0 = ax * axX + ay * axY + az * axZ;
  const p1 = bx * axX + by * axY + bz * axZ;
  const p2 = cx * axX + cy * axY + cz * axZ;
  let mn = p0, mx = p0;
  if (p1 < mn) mn = p1; else if (p1 > mx) mx = p1;
  if (p2 < mn) mn = p2; else if (p2 > mx) mx = p2;
  const rad = hx * Math.abs(axX) + hy * Math.abs(axY) + hz * Math.abs(axZ);
  return mn > rad || mx < -rad;
}

export function triBoxOverlap(hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  // 1) AABB trójkąta vs box
  if (Math.min(ax, bx, cx) > hx || Math.max(ax, bx, cx) < -hx) return false;
  if (Math.min(ay, by, cy) > hy || Math.max(ay, by, cy) < -hy) return false;
  if (Math.min(az, bz, cz) > hz || Math.max(az, bz, cz) < -hz) return false;

  // 2) 9 osi z iloczynów krawędzi trójkąta i osi boxa
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
  const e1x = cx - bx, e1y = cy - by, e1z = cz - bz;
  const e2x = ax - cx, e2y = ay - cy, e2z = az - cz;

  // Oś X × e → (0, -ez, ey); Y × e → (ez, 0, -ex); Z × e → (-ey, ex, 0)
  if (axisSeparates(0, -e0z, e0y, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(e0z, 0, -e0x, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(-e0y, e0x, 0, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;

  if (axisSeparates(0, -e1z, e1y, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(e1z, 0, -e1x, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(-e1y, e1x, 0, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;

  if (axisSeparates(0, -e2z, e2y, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(e2z, 0, -e2x, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;
  if (axisSeparates(-e2y, e2x, 0, hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz)) return false;

  // 3) Płaszczyzna trójkąta vs box
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const d = nx * ax + ny * ay + nz * az;
  const rad = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
  return Math.abs(d) <= rad;
}

// ---------------------------------------------------------------------------
// Wokselizacja: stempel powierzchni + flood fill od zewnątrz + warstwy skorupy.
// positions: Float32Array/array 9 floatów na trójkąt (przestrzeń świata modelu)
// colors:    opcjonalna tablica 3 floatów na trójkąt (r,g,b w 0..1)
// ---------------------------------------------------------------------------
export function voxelizeTriangles(positions, colors, opts = {}) {
  const cellSize = Math.max(1e-6, Number(opts.cellSize) || 1);
  const shellLayers = Math.max(0, opts.shellLayers === undefined ? 2 : (opts.shellLayers | 0));
  const maxCells = Math.max(1000, Number(opts.maxCells) || 120000);
  const interiorColorMul = Number.isFinite(opts.interiorColorMul) ? opts.interiorColorMul : 0.55;
  // 'shell' — tylko skorupa, wnętrze puste (przebicie odsłania pustkę)
  // 'ribs'  — skorupa + kratownica belek w głębi (wygląda jak konstrukcja statku)
  // 'full'  — pełny wolumen
  const interiorMode = opts.interiorMode || 'shell';
  const ribStep = Math.max(2, opts.ribStep === undefined ? 4 : (opts.ribStep | 0));

  const triCount = Math.floor(positions.length / 9);
  if (triCount <= 0) throw new Error('voxelizeTriangles: brak trójkątów');

  // AABB wejścia
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < triCount * 9; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // Margines 1 komórki z każdej strony — flood fill startuje z gwarantowanej pustki.
  const originX = minX - cellSize;
  const originY = minY - cellSize;
  const originZ = minZ - cellSize;
  const nx = Math.min(LATTICE_AXIS_MAX, Math.ceil((maxX - originX) / cellSize) + 2);
  const ny = Math.min(LATTICE_AXIS_MAX, Math.ceil((maxY - originY) / cellSize) + 2);
  const nz = Math.min(LATTICE_AXIS_MAX, Math.ceil((maxZ - originZ) / cellSize) + 2);
  const total = nx * ny * nz;
  if (total > 24_000_000) {
    throw new Error(`voxelizeTriangles: siatka ${nx}x${ny}x${nz} za duża — zwiększ cellSize`);
  }

  const OCC_EMPTY = 0, OCC_SURFACE = 1, OCC_OUTSIDE = 2, OCC_INTERIOR = 3;
  const occ = new Uint8Array(total);
  const hasColors = !!colors && colors.length >= triCount * 3;
  const colR = new Float32Array(total);
  const colG = new Float32Array(total);
  const colB = new Float32Array(total);
  const colW = new Float32Array(total);

  const idx = (ix, iy, iz) => ix + iy * nx + iz * nx * ny;
  const half = cellSize * 0.5 * 1.0001;

  // --- 1) Stempel powierzchni ---
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

    const tMinX = Math.min(ax, bx, cx), tMaxX = Math.max(ax, bx, cx);
    const tMinY = Math.min(ay, by, cy), tMaxY = Math.max(ay, by, cy);
    const tMinZ = Math.min(az, bz, cz), tMaxZ = Math.max(az, bz, cz);

    const i0 = Math.max(0, Math.floor((tMinX - originX) / cellSize));
    const i1 = Math.min(nx - 1, Math.floor((tMaxX - originX) / cellSize));
    const j0 = Math.max(0, Math.floor((tMinY - originY) / cellSize));
    const j1 = Math.min(ny - 1, Math.floor((tMaxY - originY) / cellSize));
    const k0 = Math.max(0, Math.floor((tMinZ - originZ) / cellSize));
    const k1 = Math.min(nz - 1, Math.floor((tMaxZ - originZ) / cellSize));

    const tr = hasColors ? colors[t * 3] : 0.62;
    const tg = hasColors ? colors[t * 3 + 1] : 0.65;
    const tb = hasColors ? colors[t * 3 + 2] : 0.70;

    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const ccx = originX + (i + 0.5) * cellSize;
          const ccy = originY + (j + 0.5) * cellSize;
          const ccz = originZ + (k + 0.5) * cellSize;
          if (!triBoxOverlap(
            half, half, half,
            ax - ccx, ay - ccy, az - ccz,
            bx - ccx, by - ccy, bz - ccz,
            cx - ccx, cy - ccy, cz - ccz
          )) continue;
          const id = idx(i, j, k);
          occ[id] = OCC_SURFACE;
          colR[id] += tr; colG[id] += tg; colB[id] += tb; colW[id] += 1;
        }
      }
    }
  }

  // --- 2) Flood fill pustki od granic siatki ---
  const queue = new Int32Array(total);
  let qHead = 0, qTail = 0;
  const pushIfEmpty = (i, j, k) => {
    const id = idx(i, j, k);
    if (occ[id] === OCC_EMPTY) {
      occ[id] = OCC_OUTSIDE;
      queue[qTail++] = id;
    }
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pushIfEmpty(i, j, 0); pushIfEmpty(i, j, nz - 1); }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { pushIfEmpty(i, 0, k); pushIfEmpty(i, ny - 1, k); }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { pushIfEmpty(0, j, k); pushIfEmpty(nx - 1, j, k); }

  const strideY = nx, strideZ = nx * ny;
  while (qHead < qTail) {
    const id = queue[qHead++];
    const iz = (id / strideZ) | 0;
    const rem = id - iz * strideZ;
    const iy = (rem / strideY) | 0;
    const ix = rem - iy * strideY;
    if (ix > 0 && occ[id - 1] === OCC_EMPTY) { occ[id - 1] = OCC_OUTSIDE; queue[qTail++] = id - 1; }
    if (ix < nx - 1 && occ[id + 1] === OCC_EMPTY) { occ[id + 1] = OCC_OUTSIDE; queue[qTail++] = id + 1; }
    if (iy > 0 && occ[id - strideY] === OCC_EMPTY) { occ[id - strideY] = OCC_OUTSIDE; queue[qTail++] = id - strideY; }
    if (iy < ny - 1 && occ[id + strideY] === OCC_EMPTY) { occ[id + strideY] = OCC_OUTSIDE; queue[qTail++] = id + strideY; }
    if (iz > 0 && occ[id - strideZ] === OCC_EMPTY) { occ[id - strideZ] = OCC_OUTSIDE; queue[qTail++] = id - strideZ; }
    if (iz < nz - 1 && occ[id + strideZ] === OCC_EMPTY) { occ[id + strideZ] = OCC_OUTSIDE; queue[qTail++] = id + strideZ; }
  }

  // Co nie zalane i nie powierzchnia → wnętrze bryły.
  for (let id = 0; id < total; id++) {
    if (occ[id] === OCC_EMPTY) occ[id] = OCC_INTERIOR;
  }

  // --- 3) Głębokość od powierzchni zewnętrznej (BFS wielożródłowy po bryle) ---
  // depth=1: komórka bryły przylegająca do OUTSIDE. Kolor dziedziczony w głąb.
  const depth = new Int16Array(total);
  qHead = 0; qTail = 0;
  for (let id = 0; id < total; id++) {
    if (occ[id] !== OCC_SURFACE && occ[id] !== OCC_INTERIOR) continue;
    const iz = (id / strideZ) | 0;
    const rem = id - iz * strideZ;
    const iy = (rem / strideY) | 0;
    const ix = rem - iy * strideY;
    const touchesOutside =
      (ix > 0 && occ[id - 1] === OCC_OUTSIDE) || (ix < nx - 1 && occ[id + 1] === OCC_OUTSIDE) ||
      (iy > 0 && occ[id - strideY] === OCC_OUTSIDE) || (iy < ny - 1 && occ[id + strideY] === OCC_OUTSIDE) ||
      (iz > 0 && occ[id - strideZ] === OCC_OUTSIDE) || (iz < nz - 1 && occ[id + strideZ] === OCC_OUTSIDE);
    if (touchesOutside) {
      depth[id] = 1;
      queue[qTail++] = id;
    }
  }
  while (qHead < qTail) {
    const id = queue[qHead++];
    const d = depth[id];
    const iz = (id / strideZ) | 0;
    const rem = id - iz * strideZ;
    const iy = (rem / strideY) | 0;
    const ix = rem - iy * strideY;
    const visit = (nid) => {
      const o = occ[nid];
      if ((o === OCC_SURFACE || o === OCC_INTERIOR) && depth[nid] === 0) {
        depth[nid] = d + 1;
        // Wnętrze bez własnego koloru dziedziczy przyciemniony kolor rodzica.
        if (colW[nid] === 0 && colW[id] > 0) {
          const w = colW[id];
          colR[nid] = (colR[id] / w) * interiorColorMul;
          colG[nid] = (colG[id] / w) * interiorColorMul;
          colB[nid] = (colB[id] / w) * interiorColorMul;
          colW[nid] = 1;
        }
        queue[qTail++] = nid;
      }
    };
    if (ix > 0) visit(id - 1);
    if (ix < nx - 1) visit(id + 1);
    if (iy > 0) visit(id - strideY);
    if (iy < ny - 1) visit(id + strideY);
    if (iz > 0) visit(id - strideZ);
    if (iz < nz - 1) visit(id + strideZ);
  }

  // --- 4) Budowa listy komórek ---
  const cells = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = idx(i, j, k);
        const o = occ[id];
        if (o !== OCC_SURFACE && o !== OCC_INTERIOR) continue;
        // Skorupa: odetnij wnętrze głębsze niż shellLayers (0 = pełny wolumen).
        // Belki: komórka w głębi zostaje, gdy leży na przecięciu DWÓCH płaszczyzn
        // siatki belek — daje to belki wzdłuż wszystkich trzech osi. Każda belka
        // dobiega do powierzchni, więc struktura jest spójna ze skorupą i nie
        // odpada jako osobna wyspa przy pierwszym sprawdzeniu rozpadów.
        if (shellLayers > 0 && depth[id] > shellLayers && interiorMode !== 'full') {
          if (interiorMode !== 'ribs') continue;
          let aligned = 0;
          if (i % ribStep === 0) aligned++;
          if (j % ribStep === 0) aligned++;
          if (k % ribStep === 0) aligned++;
          if (aligned < 2) continue;
        }

        const w = colW[id];
        const surface = (o === OCC_SURFACE);
        cells.push({
          ix: i, iy: j, iz: k,
          x: originX + (i + 0.5) * cellSize,
          y: originY + (j + 0.5) * cellSize,
          z: originZ + (k + 0.5) * cellSize,
          surface,
          depth: depth[id],
          coverage: surface ? 0.85 : 1.0,
          r: w > 0 ? colR[id] / w : 0.42,
          g: w > 0 ? colG[id] / w : 0.44,
          b: w > 0 ? colB[id] / w : 0.48
        });
        if (cells.length > maxCells) {
          throw new Error(`voxelizeTriangles: ponad ${maxCells} komórek — zwiększ cellSize lub shellLayers`);
        }
      }
    }
  }

  return {
    cells,
    nx, ny, nz,
    cellSize,
    origin: { x: originX, y: originY, z: originZ },
    aabb: { minX, minY, minZ, maxX, maxY, maxZ }
  };
}

// ---------------------------------------------------------------------------
// SKÓRA: oryginalna geometria modelu zachowana obok kratownicy.
//
// Renderer pokazuje mesh .glb (pełne tekstury), a kratownica pod spodem prowadzi
// fizykę. Skóra jedzie po polu deformacji komórek (FFD) i znika tam, gdzie komórki
// zginęły — to 3D-owy odpowiednik tego, co destructor 2D robi ze sprite'em pancerza
// (deformacja przesuwa obraz, `destination-out` wycina dziury).
// ---------------------------------------------------------------------------

// Ogólne odwrócenie 3x3 (górny minor mat4) + transpozycja → macierz normalnych.
function normalMatrixFromMat4(e) {
  const a = e[0], b = e[4], c = e[8];
  const d = e[1], f = e[5], g = e[9];
  const h = e[2], i = e[6], j = e[10];
  const A = f * j - g * i;
  const B = g * h - d * j;
  const C = d * i - f * h;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = 1 / det;
  // (M⁻¹)ᵀ — od razu w układzie wierszowym do mnożenia n' = N·n
  return [
    A * inv, B * inv, C * inv,
    (c * i - b * j) * inv, (a * j - c * h) * inv, (b * h - a * i) * inv,
    (b * g - c * f) * inv, (c * d - a * g) * inv, (a * f - b * d) * inv
  ];
}

/**
 * Wyciąga geometrię skóry z modelu three (duck-typing, bez importu three).
 * Pozycje i normalne są WYPIECZONE do przestrzeni ekstrakcji — tej samej,
 * w której powstają komórki — więc shader nie musi znać hierarchii modelu.
 * Zwraca listę części: jedna na (mesh × grupa materiału).
 */
export function extractSkinParts(root) {
  if (typeof root?.updateWorldMatrix === 'function') root.updateWorldMatrix(true, true);

  const meshes = [];
  (function walk(obj, isRoot) {
    if (!obj) return;
    if (!isRoot && obj.visible === false) return;
    if (obj.isMesh && obj.geometry?.attributes?.position) meshes.push(obj);
    const children = obj.children;
    if (Array.isArray(children)) for (const ch of children) walk(ch, false);
  })(root, true);

  const parts = [];
  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    const nrmAttr = geom.attributes.normal || null;
    const uvAttr = geom.attributes.uv || null;
    const count = posAttr.count;
    const e = mesh.matrixWorld?.elements || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const nm = normalMatrixFromMat4(e);

    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    for (let v = 0; v < count; v++) {
      const x = posAttr.getX(v), y = posAttr.getY(v), z = posAttr.getZ(v);
      positions[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      positions[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      positions[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];

      let nx = 0, ny = 0, nz = 1;
      if (nrmAttr) { nx = nrmAttr.getX(v); ny = nrmAttr.getY(v); nz = nrmAttr.getZ(v); }
      let tx = nm[0] * nx + nm[1] * ny + nm[2] * nz;
      let ty = nm[3] * nx + nm[4] * ny + nm[5] * nz;
      let tz = nm[6] * nx + nm[7] * ny + nm[8] * nz;
      const len = Math.hypot(tx, ty, tz) || 1;
      normals[v * 3] = tx / len;
      normals[v * 3 + 1] = ty / len;
      normals[v * 3 + 2] = tz / len;

      if (uvAttr) {
        uvs[v * 2] = uvAttr.getX(v);
        uvs[v * 2 + 1] = uvAttr.getY(v);
      }
    }

    const index = geom.index ? geom.index.array : null;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = (geom.groups && geom.groups.length > 0)
      ? geom.groups
      : [{ start: 0, count: index ? index.length : count, materialIndex: 0 }];

    for (const group of groups) {
      const material = materials[Math.min(group.materialIndex || 0, materials.length - 1)] || materials[0];
      let indices;
      if (index) {
        const end = Math.min(index.length, group.start + group.count);
        indices = index.slice(group.start, end);
      } else {
        const end = Math.min(count, group.start + group.count);
        indices = new Uint32Array(end - group.start);
        for (let k = 0; k < indices.length; k++) indices[k] = group.start + k;
      }
      // positions/normals/uvs są WSPÓŁDZIELONE między grupami tego samego mesha —
      // renderer może z tego zrobić jeden zestaw atrybutów GPU.
      parts.push({ positions, normals, uvs, indices, material: material || null });
    }
  }
  return parts;
}

// Posortowane offsety kuli do szukania najbliższej zajętej komórki.
const BIND_OFFSETS_CACHE = Object.create(null);
function getBindOffsets(radius) {
  const r = Math.max(0, radius | 0);
  let arr = BIND_OFFSETS_CACHE[r];
  if (arr) return arr;
  const list = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        list.push([dx, dy, dz, dx * dx + dy * dy + dz * dz]);
      }
    }
  }
  list.sort((a, b) => a[3] - b[3]);
  arr = new Int16Array(list.length * 3);
  for (let i = 0; i < list.length; i++) {
    arr[i * 3] = list[i][0];
    arr[i * 3 + 1] = list[i][1];
    arr[i * 3 + 2] = list[i][2];
  }
  BIND_OFFSETS_CACHE[r] = arr;
  return arr;
}

/**
 * Wiąże każdy wierzchołek skóry z NAJBLIŻSZĄ ZAJĘTĄ komórką i zapisuje jej
 * znormalizowane współrzędne tekstury 3D (atrybut aCellUV).
 *
 * Dlaczego najbliższa zajęta, a nie po prostu komórka pod wierzchołkiem:
 * wierzchołki skóry leżą DOKŁADNIE na granicy bryły, więc zaokrąglenie w dół
 * potrafi wskazać komórkę na zewnątrz (pustą). Maska dziur czytana z takiej
 * komórki wycinałaby losowe fragmenty nietkniętego kadłuba.
 *
 * Wiązanie jest po indeksach kratownicy (ix,iy,iz), które NIE zmieniają się przy
 * rozpadach — dlatego ta sama skóra obsługuje rodzica i każdy wrak.
 */
export function bindSkinToLattice(parts, occupiedCells, lattice) {
  const { nx, ny, nz, cellSize, origin } = lattice;
  const occupied = new Set();
  for (const c of occupiedCells) occupied.add(packKey(c.ix, c.iy, c.iz));

  const offsets = getBindOffsets(5);
  let unbound = 0;

  for (const part of parts) {
    if (part.cellUV) continue; // części współdzielą tablice wierzchołków — licz raz
    const count = part.positions.length / 3;
    const cellUV = new Float32Array(count * 3);

    for (let v = 0; v < count; v++) {
      const px = part.positions[v * 3];
      const py = part.positions[v * 3 + 1];
      const pz = part.positions[v * 3 + 2];
      const bi = Math.floor((px - origin.x) / cellSize);
      const bj = Math.floor((py - origin.y) / cellSize);
      const bk = Math.floor((pz - origin.z) / cellSize);

      let fi = bi, fj = bj, fk = bk, found = false;
      for (let o = 0; o < offsets.length; o += 3) {
        const ci = bi + offsets[o];
        const cj = bj + offsets[o + 1];
        const ck = bk + offsets[o + 2];
        if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) continue;
        if (!occupied.has(packKey(ci, cj, ck))) continue;
        fi = ci; fj = cj; fk = ck;
        found = true;
        break;
      }
      if (!found) unbound++;

      cellUV[v * 3] = (Math.min(nx - 1, Math.max(0, fi)) + 0.5) / nx;
      cellUV[v * 3 + 1] = (Math.min(ny - 1, Math.max(0, fj)) + 0.5) / ny;
      cellUV[v * 3 + 2] = (Math.min(nz - 1, Math.max(0, fk)) + 0.5) / nz;
    }

    // Rozdaj wynik wszystkim częściom dzielącym tę samą tablicę wierzchołków.
    for (const other of parts) {
      if (other.positions === part.positions) other.cellUV = cellUV;
    }
  }

  return { unbound };
}

// ---------------------------------------------------------------------------
// buildVoxelBody — recentrowanie do środka masy + masa + tensor bezwładności.
// Zwraca dane gotowe dla destructor3D.createBody (pozycje lokalne wzgl. COM).
// ---------------------------------------------------------------------------
export function buildVoxelBody(vox, opts = {}) {
  const cellMassBase = Number.isFinite(opts.cellMassBase) ? opts.cellMassBase : 10;
  const totalMass = Number.isFinite(opts.totalMass) && opts.totalMass > 0 ? opts.totalMass : null;
  const cells = vox.cells;
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('buildVoxelBody: brak komórek');

  let massSum = 0;
  for (const c of cells) massSum += cellMassBase * c.coverage;
  const massScale = totalMass ? totalMass / massSum : 1;

  // Środek masy
  let comX = 0, comY = 0, comZ = 0, mSum = 0;
  for (const c of cells) {
    const m = cellMassBase * c.coverage * massScale;
    comX += c.x * m; comY += c.y * m; comZ += c.z * m; mSum += m;
  }
  comX /= mSum; comY /= mSum; comZ /= mSum;

  // Tensor bezwładności o środku masy (masy punktowe + korekta sześcianu).
  const cs = vox.cellSize;
  const cubeTerm = (cs * cs) / 6;
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  const outCells = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const m = cellMassBase * c.coverage * massScale;
    const px = c.x - comX, py = c.y - comY, pz = c.z - comZ;
    ixx += m * (py * py + pz * pz + cubeTerm);
    iyy += m * (px * px + pz * pz + cubeTerm);
    izz += m * (px * px + py * py + cubeTerm);
    ixy -= m * px * py;
    ixz -= m * px * pz;
    iyz -= m * py * pz;
    outCells[i] = {
      ix: c.ix, iy: c.iy, iz: c.iz,
      x: px, y: py, z: pz,
      surface: c.surface,
      depth: c.depth,
      coverage: c.coverage,
      mass: m,
      r: c.r, g: c.g, b: c.b
    };
  }

  const inertia = [ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz];
  const invInertia = invertSymmetric3(inertia);

  let radius = 0;
  for (const c of outCells) {
    const d = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
    if (d > radius) radius = d;
  }

  // Skóra: wiązanie liczymy w przestrzeni SPRZED recentrowania (tam żyje vox.origin),
  // a dopiero potem przesuwamy wierzchołki o ten sam wektor co komórki — dzięki temu
  // mesh i kratownica zostają zgodne, a mapowanie (pozycja → komórka) jest wspólne.
  let skin = null;
  const skinParts = opts.skinParts;
  if (Array.isArray(skinParts) && skinParts.length > 0) {
    const bindInfo = bindSkinToLattice(skinParts, cells, {
      nx: vox.nx, ny: vox.ny, nz: vox.nz,
      cellSize: cs,
      origin: vox.origin
    });

    const shifted = new Set();
    for (const part of skinParts) {
      if (shifted.has(part.positions)) continue;
      shifted.add(part.positions);
      const p = part.positions;
      for (let i = 0; i < p.length; i += 3) {
        p[i] -= comX;
        p[i + 1] -= comY;
        p[i + 2] -= comZ;
      }
    }

    let vertexCount = 0;
    let triangleCount = 0;
    const counted = new Set();
    for (const part of skinParts) {
      triangleCount += part.indices.length / 3;
      if (counted.has(part.positions)) continue;
      counted.add(part.positions);
      vertexCount += part.positions.length / 3;
    }

    // Mapa PIERWOTNEJ zajętości kratownicy. Maska dziur potrzebuje trzech stanów,
    // nie dwóch: „komórka żywa", „komórka zginęła" i „komórki tu nigdy nie było".
    // Bez tego trzeciego stanu wrak (który stracił komórki drugiej połowy) nie
    // umiałby odróżnić własnej krawędzi rozłamu od pustki poza kadłubem i
    // renderowałby całą skórę rodzica.
    const occupancy = new Uint8Array(vox.nx * vox.ny * vox.nz);
    for (const c of cells) {
      occupancy[c.ix + c.iy * vox.nx + c.iz * vox.nx * vox.ny] = 1;
    }

    skin = {
      parts: skinParts,
      occupancy,
      dims: { x: vox.nx, y: vox.ny, z: vox.nz },
      vertexCount,
      triangleCount,
      unbound: bindInfo.unbound
    };
  }

  return {
    cells: outCells,
    nx: vox.nx, ny: vox.ny, nz: vox.nz,
    cellSize: cs,
    latticeMin: {
      x: vox.origin.x - comX,
      y: vox.origin.y - comY,
      z: vox.origin.z - comZ
    },
    mass: mSum,
    inertia,
    invInertia,
    radius: radius + cs,
    skin
  };
}

// Odwrócenie symetrycznej macierzy 3x3 (row-major 9). Przy degeneracji fallback
// na przekątną — lepszy słaby moment niż NaN w solverze.
export function invertSymmetric3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5];
  const f = m[8];
  const A = d * f - e * e;
  const B = c * e - b * f;
  const C = b * e - c * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return [
      a > 1e-9 ? 1 / a : 0, 0, 0,
      0, d > 1e-9 ? 1 / d : 0, 0,
      0, 0, f > 1e-9 ? 1 / f : 0
    ];
  }
  const inv = 1 / det;
  const D = a * f - c * c;
  const E = b * c - a * e;
  const F = a * d - b * b;
  return [
    A * inv, B * inv, C * inv,
    B * inv, D * inv, E * inv,
    C * inv, E * inv, F * inv
  ];
}

// ---------------------------------------------------------------------------
// Pomocnik: trójkąty prostopadłościanu (12 tris = 108 floatów) — do testów
// i proceduralnych statków w demo bez three.
// ---------------------------------------------------------------------------
export function makeBoxTriangles(w, h, d, cx = 0, cy = 0, cz = 0) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  // 8 wierzchołków
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const quads = [
    [0, 3, 2, 1], // -Z
    [4, 5, 6, 7], // +Z
    [0, 1, 5, 4], // -Y
    [3, 7, 6, 2], // +Y
    [0, 4, 7, 3], // -X
    [1, 2, 6, 5]  // +X
  ];
  const out = new Float32Array(quads.length * 2 * 9);
  let o = 0;
  for (const q of quads) {
    const [i0, i1, i2, i3] = q;
    for (const tri of [[i0, i1, i2], [i0, i2, i3]]) {
      for (const vi of tri) {
        out[o++] = v[vi][0];
        out[o++] = v[vi][1];
        out[o++] = v[vi][2];
      }
    }
  }
  return out;
}

export function concatTriangleSets(sets) {
  let totalPos = 0;
  let totalTris = 0;
  for (const s of sets) {
    totalPos += s.positions.length;
    totalTris += s.positions.length / 9;
  }
  const positions = new Float32Array(totalPos);
  const colors = new Float32Array(totalTris * 3);
  let po = 0, co = 0;
  for (const s of sets) {
    positions.set(s.positions, po);
    po += s.positions.length;
    const tris = s.positions.length / 9;
    const r = s.color?.[0] ?? 0.62, g = s.color?.[1] ?? 0.65, b = s.color?.[2] ?? 0.7;
    for (let t = 0; t < tris; t++) {
      colors[co++] = r; colors[co++] = g; colors[co++] = b;
    }
  }
  return { positions, colors };
}

// ---------------------------------------------------------------------------
// Adapter three (duck-typing, bez importu): ekstrakcja trójkątów w przestrzeni
// świata + kolor per trójkąt (tekstura próbkowana w centroidzie UV × color).
// ---------------------------------------------------------------------------
export function extractTrianglesFromObject3D(root, opts = {}) {
  const sampleTextures = opts.sampleTextures !== false;
  if (typeof root?.updateWorldMatrix === 'function') root.updateWorldMatrix(true, true);

  const positions = [];
  const colors = [];
  const samplerCache = new Map();

  const getSampler = (material) => {
    const img = material?.map?.image;
    if (!sampleTextures || !img || typeof document === 'undefined') return null;
    let sampler = samplerCache.get(material.map);
    if (sampler !== undefined) return sampler;
    try {
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      sampler = { data, size, flipY: material.map.flipY !== false };
    } catch {
      sampler = null; // CORS/format — fallback na kolor materiału
    }
    samplerCache.set(material.map, sampler);
    return sampler;
  };

  const meshes = [];
  // Widoczność respektujemy tylko dla DZIECI — sam root może być ukryty
  // (np. model referencyjny schowany w scenie), a i tak chcemy jego geometrię.
  (function walk(obj, isRoot) {
    if (!obj) return;
    if (!isRoot && obj.visible === false) return;
    if (obj.isMesh && obj.geometry?.attributes?.position) meshes.push(obj);
    const children = obj.children;
    if (Array.isArray(children)) for (const ch of children) walk(ch, false);
  })(root, true);

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    const uvAttr = geom.attributes.uv || null;
    const index = geom.index ? geom.index.array : null;
    const e = mesh.matrixWorld?.elements || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // GLB często ma atrybuty INTERLEAVED — .array to cały przeplatany bufor,
    // indeksowanie idx*3 czyta śmieci. Akcesory getX/getY/getZ obsługują
    // offset+stride obu wariantów (BufferAttribute i InterleavedBufferAttribute).
    const posByAccessor = typeof posAttr.getX === 'function';
    const uvByAccessor = !!uvAttr && typeof uvAttr.getX === 'function';
    const pArr = posAttr.array;
    const vertCount = index ? index.length : posAttr.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = (geom.groups && geom.groups.length > 0)
      ? geom.groups
      : [{ start: 0, count: vertCount, materialIndex: 0 }];

    for (const group of groups) {
      const material = materials[Math.min(group.materialIndex || 0, materials.length - 1)] || materials[0];
      const baseR = material?.color?.r ?? 0.7;
      const baseG = material?.color?.g ?? 0.7;
      const baseB = material?.color?.b ?? 0.72;
      const sampler = material ? getSampler(material) : null;
      const end = Math.min(vertCount, group.start + group.count);

      for (let vi = group.start; vi + 2 < end; vi += 3) {
        let triR = baseR, triG = baseG, triB = baseB;
        let u = 0, vSum = 0;
        for (let k = 0; k < 3; k++) {
          const rawIdx = index ? index[vi + k] : (vi + k);
          if (rawIdx === undefined) { triR = -1; break; }
          let x, y, z;
          if (posByAccessor) {
            x = posAttr.getX(rawIdx);
            y = posAttr.getY(rawIdx);
            z = posAttr.getZ(rawIdx);
          } else {
            const p = rawIdx * 3;
            x = pArr[p]; y = pArr[p + 1]; z = pArr[p + 2];
          }
          positions.push(
            e[0] * x + e[4] * y + e[8] * z + e[12],
            e[1] * x + e[5] * y + e[9] * z + e[13],
            e[2] * x + e[6] * y + e[10] * z + e[14]
          );
          if (sampler && uvAttr) {
            if (uvByAccessor) {
              u += uvAttr.getX(rawIdx);
              vSum += uvAttr.getY(rawIdx);
            } else {
              u += uvAttr.array[rawIdx * 2];
              vSum += uvAttr.array[rawIdx * 2 + 1];
            }
          }
        }
        if (triR < 0) break;
        if (sampler && uvAttr) {
          const su = ((u / 3) % 1 + 1) % 1;
          let sv = ((vSum / 3) % 1 + 1) % 1;
          if (sampler.flipY) sv = 1 - sv;
          const px = Math.min(sampler.size - 1, (su * sampler.size) | 0);
          const py = Math.min(sampler.size - 1, (sv * sampler.size) | 0);
          const o = (py * sampler.size + px) * 4;
          triR = (sampler.data[o] / 255) * baseR;
          triG = (sampler.data[o + 1] / 255) * baseG;
          triB = (sampler.data[o + 2] / 255) * baseB;
        }
        colors.push(triR, triG, triB);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors)
  };
}
