// src/3d/hallGas3d/hallGas3dLayout.js
//
// GAZ I PYŁ HALI K-7 v2 (prawdziwa wolumetria, docs/BRIEF-gaz-hali-3d.md, plan docs/PLAN-3d-gaz.md, demo dema/3d-gaz.html) — część CZYSTA:
// bez three, DOM i Core3D (testy node). Domena siatki 3D hali, wysokości K-7, wokselizacja przeszkód (udział zajętości
// komórki), wzór startowy kurzu na pokładzie, układ rekordów strumieni i LUSTRA CPU formuł kerneli (hallGas3dGrid.js).
//
// Układ hali (createK7Layout): x w poprzek (±halfWidth), z w głąb — od ściany tylnej (backZ) do bramy G-01 (frontZ),
// y = wysokość K-7 nad pokładem (kadłub 48–116, lot 76, dach 711). SIATKA: komórka sześcienna h [j.]; osie tekstur 3D:
// x tekstury = x hali (nx), y tekstury = z hali — głąb (nd), z tekstury = wysokość (nh warstw od pokładu). Prędkości
// w komórkach/s: (vx — x hali, vd — z hali, vy — w górę). Domena = obrys hali z zapasem przy ścianach, pas PRÓŻNI za
// bramą (gaz, który wyleci, ginie — brief § 13 pkt 5) i jedna warstwa nad dachem (wypływ przez otwarty dach).
import { createK7Layout, K7_HEIGHTS, K7_ABOVE_SCALE } from '../haloRing/haloPortK7Layout.js';

/** Siatka domyślna (decyzja brief § 13 pkt 1, pomiar E0 — docs/PLAN-3d-gaz.md). */
export const HALL_GAS3D_GRID = Object.freeze({
  cell: 56,        // bok komórki [j.] — pomiar E0 (docs/PLAN-3d-gaz.md): 48 j. — szkielet 0,52 ms, 56 j. — 0,37 ms, 64 j. — 0,27 ms
  margin: 320,     // zapas domeny za ścianami bocznymi i tylną [j.] (przypory na zewnątrz ścian: 59 + 75 j.)
  vacuum: 1700,    // pas próżni za bramą G-01 [j.] (fartuch 1180 j.)
  top: 768,        // wysokość domeny [j.]: dach 711–793 — warstwa nad dachem dla wypływu przez otwarty dach
  roofY: 720       // spód dachu w gazie [j.] (hala: height 720) — warstwy wyżej to dach (zamknięty) albo otwór
});

/** Wysokości K-7 w gazie (kadłub 48–116, lot 76). */
export const HALL_GAS3D_HULL = Object.freeze({ y0: K7_HEIGHTS.hullBottom, y1: K7_HEIGHTS.hullTop, flightY: K7_HEIGHTS.flightY });

/**
 * Domena siatki 3D w układzie hali dla komórki `cell` [j.]: wymiary nx × nd × nh (x, głąb, wysokość), róg (x0, z0),
 * rozmiar w × d × top [j.], liczba komórek i dispatch compute (wielokrotność 64 — grupy robocze; kernele mają strażnika
 * zakresu). nx i nd — wielokrotności 8 (pole pokładu 2× drobniejsze dzieli się przez 16).
 */
export function hallGas3dDomain(layout = createK7Layout(), cell = HALL_GAS3D_GRID.cell, grid = HALL_GAS3D_GRID) {
  const h = cell;
  const xMin = -layout.halfWidth - grid.margin;
  const xMax = layout.halfWidth + grid.margin;
  const zMin = layout.backZ - layout.wallThickness * 0.5 - grid.margin;
  const zMax = layout.frontZ + grid.vacuum;
  const nx = Math.ceil((xMax - xMin) / h / 8) * 8;
  const nd = Math.ceil((zMax - zMin) / h / 8) * 8;
  const nh = Math.ceil(grid.top / h);
  const w = nx * h;
  const d = nd * h;
  const x0 = (xMin + xMax) * 0.5 - w * 0.5;
  const z0 = zMin;
  const cells = nx * nd * nh;
  return Object.freeze({
    h, nx, nd, nh, x0, z0, w, d, top: nh * h, x1: x0 + w, z1: z0 + d, cells,
    dispatch: Math.ceil(cells / 64) * 64,
    // pole kurzu na pokładzie: komórka h / 2
    deckNx: nx * 2, deckNd: nd * 2, deckCells: nx * nd * 4,
    roofLayer: Math.floor(grid.roofY / h)
  });
}

/** Wysokość K-7 → z sceny (lustro haloPortK7Layout.k7HeightToZ — pod szczytem kadłuba 1:1, wyżej × K7_ABOVE_SCALE). */
export function hallGas3dHeightToZ(y) {
  const d = y - K7_HEIGHTS.hullTop;
  return d > 0 ? d * K7_ABOVE_SCALE : d;
}

/** z sceny → wysokość K-7 (odwrotność hallGas3dHeightToZ). */
export function hallGas3dZToHeight(z) {
  return z <= 0 ? z + K7_HEIGHTS.hullTop : K7_HEIGHTS.hullTop + z / K7_ABOVE_SCALE;
}

/** Pamięć GPU siatki [B]: tekstury 3D RGBA16F (8 B / komórkę) × `tex3`, bufory f32 / u32 (4 B) × `buf`, pokład. */
export function hallGas3dMemory(dom, { tex3 = 8, statTex = 1, buf = 4, deckTex = 2 } = {}) {
  return dom.cells * 8 * tex3 + dom.cells * 4 * statTex + dom.cells * 4 * buf + dom.deckCells * 8 * deckTex;
}
