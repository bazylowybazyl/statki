/**
 * beamSprite2D — kadłub 2D ze sprite'a gry jako konstrukcja WĘZŁÓW i BELEK.
 *
 * Odpowiednik initHexBody z destructor.js, ale zamiast heksów z punktami HP
 * powstaje ta sama konstrukcja co z wokselizacji GLB (buildBeamStructure):
 * siatka ma jedną warstwę, komórka = kwadrat sprite'a pokryty alfą.
 *  - poszycie: belki między komórkami obrysu (pęka pierwsze),
 *  - wnętrze: pokład, 8 sąsiadów (osie + przekątne — płyta sztywna na ścinanie),
 *  - wręgi: struty w poprzek kadłuba, od burty do burty,
 *  - grodzie: usztywnione przekroje co N kolumn wzdłuż długości kadłuba.
 *
 * Układ lokalny: +X = dziób (sprite'y gry mają dziób w prawo), +Y = lewa burta
 * (wiersz 0 obrazu to góra, czyli +Y), z = 0. Moduł nie importuje three —
 * obraz przyjmuje jako { width, height, data: RGBA } (ImageData albo tablica).
 */

import { buildBeamStructure } from './beamBody3D.js';

export const SPRITE_2D_DEFAULTS = Object.freeze({
  cellsAlong: 120,     // komórek na długość kadłuba (oś X obrazu)
  alphaCutoff: 40,     // jak initHexBody w grze
  minCoverage: 0.2,    // udział kryjących próbek, od którego komórka jest kadłubem
  samples: 5,          // próbek na oś komórki
  frameStride: 2,
  bulkheadEvery: 8
});

const AXIS_4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);

/**
 * Próbkuje alfę sprite'a na siatce komórek. Zwraca wejście dla buildBeamStructure
 * (format wyniku voxelizeTriangles z nz = 1) plus mapowanie obrazu dla skóry.
 * worldLength — długość kadłuba w jednostkach świata (szerokość obrazu).
 */
export function sampleSpriteLattice(image, opts = {}) {
  const W = Math.max(1, image?.width | 0);
  const H = Math.max(1, image?.height | 0);
  const data = image?.data;
  if (!data || data.length < W * H * 4) throw new Error('sampleSpriteLattice: brak danych RGBA obrazu');

  const worldLength = Number(opts.worldLength) > 0 ? Number(opts.worldLength) : W;
  const nx = Math.max(2, Math.round(Number(opts.cellsAlong) || SPRITE_2D_DEFAULTS.cellsAlong));
  const pitch = W / nx;                              // piksele obrazu na komórkę
  const ny = Math.max(1, Math.ceil(H / pitch - 1e-9));
  const cellSize = worldLength / nx;
  const cutoff = Number.isFinite(opts.alphaCutoff) ? opts.alphaCutoff : SPRITE_2D_DEFAULTS.alphaCutoff;
  const minCoverage = Number.isFinite(opts.minCoverage) ? opts.minCoverage : SPRITE_2D_DEFAULTS.minCoverage;
  const k = Math.max(1, Math.min(16, (Number(opts.samples) || SPRITE_2D_DEFAULTS.samples) | 0));

  // Środek siatki w (0, 0); komórka (ix, iy) ma środek origin + (i + 0,5) · cs.
  const origin = { x: -nx * cellSize * 0.5, y: -ny * cellSize * 0.5, z: -cellSize * 0.5 };
  const solidMask = new Uint8Array(nx * ny);
  const coverage = new Float32Array(nx * ny);
  const color = new Float32Array(nx * ny * 3);

  for (let iy = 0; iy < ny; iy++) {
    // iy rośnie w górę (+Y), wiersze obrazu w dół: komórka iy = pas wierszy od góry.
    const rowTop = (ny - 1 - iy) * pitch;
    for (let ix = 0; ix < nx; ix++) {
      const colLeft = ix * pitch;
      let hits = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < k; sy++) {
        const py = Math.floor(rowTop + (sy + 0.5) * pitch / k);
        if (py < 0 || py >= H) continue;             // poza obrazem = przezroczyste
        for (let sx = 0; sx < k; sx++) {
          const px = Math.min(W - 1, Math.floor(colLeft + (sx + 0.5) * pitch / k));
          const o = (py * W + px) * 4;
          if (data[o + 3] < cutoff) continue;
          hits++;
          r += data[o]; g += data[o + 1]; b += data[o + 2];
        }
      }
      const cov = hits / (k * k);
      if (cov < minCoverage) continue;
      const id = ix + iy * nx;
      solidMask[id] = 1;
      coverage[id] = cov;
      color[id * 3] = r / hits / 255;
      color[id * 3 + 1] = g / hits / 255;
      color[id * 3 + 2] = b / hits / 255;
    }
  }

  // Głębokość od obrysu (BFS po 4 sąsiadach); obrys = komórka z pustym sąsiadem.
  const depth = new Int16Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  const solid = (x, y) => x >= 0 && y >= 0 && x < nx && y < ny && solidMask[x + y * nx] === 1;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!solid(ix, iy)) continue;
      for (const [dx, dy] of AXIS_4) {
        if (solid(ix + dx, iy + dy)) continue;
        depth[ix + iy * nx] = 1;
        queue[tail++] = ix + iy * nx;
        break;
      }
    }
  }
  while (head < tail) {
    const id = queue[head++];
    const ix = id % nx, iy = (id / nx) | 0;
    for (const [dx, dy] of AXIS_4) {
      const x = ix + dx, y = iy + dy;
      if (!solid(x, y) || depth[x + y * nx] !== 0) continue;
      depth[x + y * nx] = depth[id] + 1;
      queue[tail++] = x + y * nx;
    }
  }

  const cells = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const id = ix + iy * nx;
      if (!solidMask[id]) continue;
      cells.push({
        ix, iy, iz: 0,
        x: origin.x + (ix + 0.5) * cellSize,
        y: origin.y + (iy + 0.5) * cellSize,
        z: 0,
        surface: depth[id] === 1,
        depth: depth[id],
        coverage: coverage[id],
        r: color[id * 3], g: color[id * 3 + 1], b: color[id * 3 + 2]
      });
    }
  }

  return {
    cells, solidMask,
    nx, ny, nz: 1,
    cellSize,
    origin,
    pixelPitch: pitch,
    width: W,
    height: H
  };
}

/**
 * Konstrukcja węzłów i belek z obrazu sprite'a. Wynik jak buildBeamStructure
 * plus `spriteSkin` — opis mapowania obrazu dla renderera (wspólny dla kopii
 * kadłuba i jego wraków, bo węzły zachowują indeksy siatki ix/iy).
 * opts.textureSource — obraz, z którego renderer zrobi teksturę (może mieć
 * inną rozdzielczość niż obraz próbkowany; UV są znormalizowane).
 */
export function buildSpriteBeamStructure(image, opts = {}) {
  const lattice = sampleSpriteLattice(image, opts);
  if (lattice.cells.length === 0) throw new Error('buildSpriteBeamStructure: sprite nie ma kryjących komórek');
  const frameStride = opts.frameStride === undefined ? SPRITE_2D_DEFAULTS.frameStride : opts.frameStride;
  const bulkheadEvery = opts.bulkheadEvery === undefined ? SPRITE_2D_DEFAULTS.bulkheadEvery : opts.bulkheadEvery;
  const structure = buildBeamStructure(lattice, {
    frameStride,
    bulkheadEvery,
    // Wręg idzie w poprzek kadłuba i ma sięgnąć przeciwległej burty (kadłub 2D to pełna płyta).
    maxFrameSpan: Number.isFinite(opts.maxFrameSpan) ? opts.maxFrameSpan : lattice.ny + 2,
    frameAxes: [0, 1, 0],
    frameToOppositeWall: true,
    cellMassBase: opts.cellMassBase
  });
  structure.spriteSkin = {
    key: opts.key || null,
    image: opts.textureSource || null,
    tint: opts.tint || null,
    width: lattice.width,
    height: lattice.height,
    pixelPitch: lattice.pixelPitch,
    nx: lattice.nx,
    ny: lattice.ny,
    cellSize: lattice.cellSize
  };
  structure.planar = true;
  return structure;
}
