/**
 * Suchy dok piratów jako CIAŁA ŚWIATA (docs/PLAN-zniszczenia-swiata-3d.md F2; misja 1 — budynek stoczni):
 * kawałki doku (39 grup renderu — pirateDryDockLayout.chunks) w bańce gracza stają się PŁASKIMI, ZAKOTWICZONYMI
 * ciałami silnika belek (src/game/worldBodies.js). Taran bram i ogrodzenia to zwykłe zderzenie kadłubów (dawny
 * stepDryDockRam — prostokąt kadłuba × bryła i „kawałek wylatuje” — zostaje tylko dla kawałków statycznych),
 * pociski orzą węzły, Hexlance przechodzi przez cienkie bramy i grzęźnie w trzonie.
 *
 * Kawałek = raster z góry jego brył przecinających płaszczyznę gry (pirateDryDockChunks.dryDockPlanarSolids →
 * dryDockTopRaster, wiersze ODWRÓCONE: obraz w górę = −z układu — inaczej ciało wychodzi lustrem względem bryły
 * 3D), kotwice wg rodzaju kawałka (gdzie bryła trzyma się reszty budowli) i materiał (gęstość, pancerz zderzeń).
 * Dach hali (R-1…R-3, nad płaszczyzną gry) to DUCH (worldBodies — ghost): raster WSZYSTKICH brył pasa dachu,
 * rzadsza kratownica (GHOST_CELL), ciałem dopiero w rozpadzie (pęka na odłamy jak reszta, bez kolizji i broni).
 * Układ doku: x wzdłuż trzonu, z w poprzek; gra: toGame(x, z) = O + U·x + N·z (shipyardLayout.placeDryDock),
 * kurs ciała = place.axis.
 * Bez three i DOM.
 */

import { dryDockChunkSolids, dryDockPlanarSolids, dryDockTopRaster } from '../../3d/portBuildings/pirateDryDockChunks.js';
import { WORLD_BODY_TUNE } from '../worldBodies.js';
import { HullBodies } from '../hullBodies.js';

/** Materiał kawałków (gęstość × kadłuba 1,19; pancerz zderzeń — Atlas 16, fregata 1). */
export const DRYDOCK_BODY_MATERIAL = Object.freeze({
  spine: Object.freeze({ density: 3.2, armor: 10 }),
  collar: Object.freeze({ density: 2.8, armor: 8 }),
  wall: Object.freeze({ density: 2.4, armor: 6 }),
  hallgate: Object.freeze({ density: 2.4, armor: 6 }),
  tower: Object.freeze({ density: 2.4, armor: 6 }),
  frame: Object.freeze({ density: 2.2, armor: 3 }),
  fence: Object.freeze({ density: 1.6, armor: 1.2 }),
  gate: Object.freeze({ density: 1.4, armor: 0.8 }),
  roof: Object.freeze({ density: 1.2, armor: 1 })
});

// Kawałki bez brył w płaszczyźnie gry — DUCHY (dach): ciało tylko w rozpadzie, raster wszystkich brył, komórka
// GHOST_CELL (pas dachu 4,6 × 1,3 km: przy 15 j. ~22 tys. węzłów, przy 45 j. ~2,5 tys.), raster GHOST_UPP j./piksel
// (3 piksele na komórkę jak reszta).
const GHOST = new Set(['roof']);
const GHOST_CELL = 45;
const GHOST_UPP = 15;

// Podział skóry (src/3d/worldBodies3D.js, portBuildingSkin3D.js): najdłuższa krawędź trójkąta w rzucie [komórki].
// Bramy, ogrodzenie i pylony gną się przy taranie najbardziej widocznie — gęsto; trzon i ściany hali to setki brył
// (co 2 komórki: ~0,5 mln wierzchołków i 100–160 ms wypieku na odcinek trzonu) — rzadko.
const SKIN_EDGE_CELLS = Object.freeze({ spine: 6, collar: 4, wall: 4, hallgate: 4, tower: 3, frame: 2, fence: 2, gate: 2, roof: 2 });

// Ciało = bryły, które PRZECINAJĄ płaszczyznę gry (±4 j.). Domyślny pas dema (±25) brał rękawy trapów trzonu
// (y −56…−8, pod płaszczyzną — sięgają w tor taranu do dziobów okrętów parkingu, z ≈ 950): Atlas na torze bramy
// miażdżył je razem z pokładem trzonu, a dawniej przelatywał nad nimi.
const PLANE_BAND = 4;

// Ściany hali: krawędź i odcinek (jak add() w createPirateDryDockLayout).
const WALL_EDGES = Object.freeze({
  'H-W1': [4, 0, 0.5], 'H-W2': [4, 0.5, 1], 'H-E1': [2, 0.5, 1], 'H-E2': [2, 0, 0.5],
  'H-SW': [5, 0, 1], 'H-SE': [1, 0, 1], 'H-G1': [0, 0, 1]
});
const BUTTRESS_STEP = 390;
// Rzadkie fundamenty masywnych kawałków (trzon, złącza): kotwica co tyle komórek kratownicy w obu osiach
// (worldBodies.anchorComponents — w indeksach kratownicy).
const PIN_GRID_CELLS = Object.freeze({ spine: 8, collar: 8 });

/**
 * Kotwice kawałka w układzie doku: (x, z) → true = węzeł trzyma się reszty budowli (invMass 0).
 * cs — komórka ciała (j.).
 */
export function dryDockPinTest(layout, chunk, cs = WORLD_BODY_TUNE.cellSize) {
  const S = layout.spec;
  const box = chunk.box;
  const near = 1.6 * cs;
  switch (chunk.kind) {
    case 'spine': {
      // oś kręgosłupa trzonu (wąski pas nad stępką) — fundament. Szeroki pas kotwic (cała nadbudowa ±220) robił
      // z trzonu ścianę z masą ∞: Hexlance stawał w nim po kilku komórkach bez jednego wgniecenia. Do tego rzadka
      // siatka fundamentów (PIN_GRID_CELLS — worldBodies.anchorComponents): pokład trzonu to osobne bryły rastra
      // połączone wąskimi mostkami — bez niej kilka chybionych pocisków odrywało płyty po 200–300 węzłów (gra
      // 2026-10-05: wieże Atlasa po alarmie).
      const k = Math.min(S.keelHalfDepth, 60);
      return (x, z) => Math.abs(z) <= k;
    }
    case 'frame': {
      const pyl = layout.parking.pylons.filter((p) => p.chunk === chunk.id);
      const r = S.parking.pylon * 0.35;
      return (x, z) => pyl.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 <= r * r);
    }
    case 'gate': {
      const g = layout.parking.gates.find((q) => q.chunk === chunk.id);
      if (g?.axis === 'z') {
        // brama taranowa: końce przy pylonach ram
        const z0 = layout.parking.gateZ0, z1 = layout.parking.gateZ1;
        return (x, z) => z < z0 + near || z > z1 - near;
      }
      // brama stanowiska: końce przy słupach ogrodzenia
      return (x, z) => x < box.x0 + near || x > box.x1 - near;
    }
    case 'fence': {
      const posts = layout.parking.posts.filter((p) => p.chunk === chunk.id);
      const r = S.parking.post * 0.5;
      return (x, z) => x < box.x0 + near || x > box.x1 - near ||
        posts.some((p) => Math.abs(x - p.x) <= r && Math.abs(z - p.z) <= r);
    }
    case 'wall':
    case 'hallgate': {
      const w = WALL_EDGES[chunk.id];
      const e = w ? layout.hall.edges[w[0]] : null;
      if (!e) return (x, z) => false;
      const s0 = e.length * w[1], s1 = e.length * w[2];
      return (x, z) => {
        const t = (x - e.a[0]) * e.ux + (z - e.a[1]) * e.uz;
        if (t < s0 + near || t > s1 - near) return true;
        // przypory co ~390 j. (jak ściany K-7): pas ± komórka
        const k = Math.round(t / BUTTRESS_STEP) * BUTTRESS_STEP;
        return Math.abs(t - k) <= cs * 0.9;
      };
    }
    case 'collar': {
      const backZ = layout.hall.backZ;
      return (x, z) => z > backZ - 60;
    }
    case 'tower': {
      const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
      const hx = (box.x1 - box.x0) * 0.3, hz = (box.z1 - box.z0) * 0.3;
      return (x, z) => Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz;
    }
    default:
      return (x, z) => false;
  }
}

/**
 * Raster kawałka do ciała: bryły w płaszczyźnie gry z góry, wiersze odwrócone (wiersz 0 = najmniejsze z — obraz
 * w górę = −z, zgodnie z kursem ciała place.axis). all — WSZYSTKIE bryły kawałka (duch: dach nad płaszczyzną).
 * Wynik: { image: { width, height, data }, upp, cx, cz } (środek obrazu w układzie doku) albo null (kawałek bez
 * brył w płaszczyźnie).
 */
export function dryDockChunkRaster(layout, scene, chunkId, { upp = WORLD_BODY_TUNE.rasterUpp, palette = null, band = PLANE_BAND, all = false } = {}) {
  const solids = all ? dryDockChunkSolids(layout, scene, [chunkId]) : dryDockPlanarSolids(layout, scene, [chunkId], { band });
  if (!solids.length) return null;
  const r = dryDockTopRaster(solids, { unitsPerPx: upp, palette });
  const W = r.width, H = r.height, src = r.data;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let row = 0; row < H; row++) {
    data.set(src.subarray((H - 1 - row) * W * 4, (H - row) * W * 4), row * W * 4);
  }
  let any = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { any = true; break; }
  if (!any) return null;
  return { image: { width: W, height: H, data }, upp: r.unitsPerPx, cx: r.x0 + r.worldW / 2, cz: r.z1 - r.worldH / 2 };
}

// Rastry kawałków — raz na układ doku (nie zależą od miejsca doku w grze). Ekran ładowania liczy je z wyprzedzeniem
// razem z szablonami kratownic (prebuildPirateDryDockBodies): pierwszy szablon kratownicy obrazu to 10–40 ms,
// budowa ciała w bańce z gotowym szablonem — 1–3 ms (bez przestojów kroku przy zbliżaniu się do doku).
const _rasters = new WeakMap();
function cachedRaster(layout, scene, chunkId, palette) {
  let m = _rasters.get(layout);
  if (!m) _rasters.set(layout, m = new Map());
  if (!m.has(chunkId)) {
    const ghost = GHOST.has(layout.chunkById.get(chunkId)?.kind);
    m.set(chunkId, dryDockChunkRaster(layout, scene, chunkId, ghost ? { palette, all: true, upp: GHOST_UPP } : { palette }) || false);
  }
  return m.get(chunkId);
}
const cellOf = (c) => GHOST.has(c.kind) ? GHOST_CELL : WORLD_BODY_TUNE.cellSize;

/**
 * Rastry wszystkich kawałków i szablony kratownic HullBodies (ta sama skala i komórka co budowa ciała w
 * worldBodies._buildPiece) — ekran ładowania (src/3d/pirateDryDockGame.js). Zwraca liczbę kawałków.
 */
export function prebuildPirateDryDockBodies(layout, scene, palette = null) {
  let n = 0;
  for (const c of layout.chunks) {
    const r = cachedRaster(layout, scene, c.id, palette);
    if (!r) continue;
    HullBodies.structureFor(r.image, r.upp, cellOf(c) / r.upp);
    n++;
  }
  return n;
}

/**
 * Miejsce worldBodies dla doku: { id, owner, pieces, onLive, onLost }. dock — bryła PirateDryDock3D (layout, scene,
 * style), place — shipyardLayout.placeDryDock(…). hooks: { onLive(piece, live), onLost(piece) }.
 */
export function createPirateDryDockSite(station, dock, place, hooks = {}) {
  const layout = dock.layout;
  const scene = dock.scene;
  const palette = dock.style?.palette || null;
  const pieces = [];
  const corner = { x: 0, y: 0 };
  for (const c of layout.chunks) {
    const b = c.box;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [hx, hz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]) {
      place.toGame(hx, hz, corner);
      if (corner.x < x0) x0 = corner.x; if (corner.x > x1) x1 = corner.x;
      if (corner.y < y0) y0 = corner.y; if (corner.y > y1) y1 = corner.y;
    }
    const pinHub = dryDockPinTest(layout, c);
    let raster = null;   // po pierwszym build(): raster z pamięci układu albo false
    const piece = {
      id: c.id,
      kind: c.kind,
      label: c.label,
      group: c.group,
      weight: c.weight,
      chunk: c,
      bounds: { x0, y0, x1, y1 },
      material: DRYDOCK_BODY_MATERIAL[c.kind] || null,
      ghost: GHOST.has(c.kind),
      cellSize: cellOf(c),
      skinEdgeCells: SKIN_EDGE_CELLS[c.kind] || 4,
      pinGridCells: PIN_GRID_CELLS[c.kind] || 0,
      build() {
        if (raster === null) raster = cachedRaster(layout, scene, c.id, palette);
        if (!raster) return null;
        const g = place.toGame(raster.cx, raster.cz, {});
        return { image: raster.image, upp: raster.upp, x: g.x, y: g.y, angle: place.axis };
      },
      // obraz od środka: x w prawo (+x doku), y w GÓRĘ obrazu (−z doku)
      pins(sx, sy) {
        if (!raster) return false;
        return pinHub(raster.cx + sx, raster.cz - sy);
      },
      /** Środek rastra w układzie doku (render: ten sam obraz, który dostało ciało). */
      rasterCenter() { return raster ? { x: raster.cx, z: raster.cz } : null; },
      /** Kawałek stoi na miejscu (nie odpadł po staremu — animacja statyki — i nie jest schowany). */
      available() { return !(dock.isChunkGone ? dock.isChunkGone(c.id) : false); }
    };
    pieces.push(piece);
  }
  return {
    id: `drydock:${station?.id || 'PD'}`,
    owner: station || null,
    dock,
    place,
    pieces,
    onLive: hooks.onLive || null,
    onLost: hooks.onLost || null
  };
}
