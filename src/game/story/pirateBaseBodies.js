/**
 * Baza piratów jako CIAŁA ŚWIATA (docs/PLAN-zniszczenia-swiata-3d.md F2, jak dawny suchy dok): kawałki bazy
 * (pirateBaseLayout.chunks) w bańce gracza stają się PŁASKIMI, ZAKOTWICZONYMI ciałami silnika belek
 * (src/game/worldBodies.js). Osobne MIEJSCE na budowlę (habitat, paliwo, magazyn, pomosty) — trafienia liczą punkty
 * swojej budowli (byt stacji ma `_worldSite`). Taran = zderzenie kadłubów: bęben habitatu to „rura” (ściana, grodzie,
 * pierścień) — gnie się i pęka pod Atlasem; pomosty pękają między rzadkimi kotwicami.
 *
 * Kawałek = raster z góry brył przecinających płaszczyznę gry (pirateDryDockChunks.js — wspólne narzędzia brył
 * budowli Z7, wiersze odwrócone jak w doku), kotwice wg rodzaju, materiał. Część techniczna nad bębnem i dysk
 * mieszkalny pod nim to DUCHY (raster wszystkich brył, rzadka kratownica, ciałem dopiero w rozpadzie — implozja).
 * Układ bazy: x wzdłuż osi, z w poprzek; gra: toGame(x, z) (pirateBaseSite.placePirateBase), kurs ciała = place.axis.
 * Bez three i DOM.
 */

import { dryDockChunkSolids, dryDockPlanarSolids, dryDockTopRaster } from '../../3d/portBuildings/pirateDryDockChunks.js';
import { WORLD_BODY_TUNE } from '../worldBodies.js';
import { HullBodies } from '../hullBodies.js';

/** Materiał kawałków (gęstość × kadłuba 1,19; pancerz zderzeń — Atlas 16, fregata 1). */
export const PIRATE_BASE_BODY_MATERIAL = Object.freeze({
  drum: Object.freeze({ density: 2.4, armor: 5 }),
  core: Object.freeze({ density: 3.2, armor: 10 }),
  pier: Object.freeze({ density: 2.2, armor: 3 }),
  tank: Object.freeze({ density: 1.6, armor: 2 }),
  manifold: Object.freeze({ density: 2.6, armor: 6 }),
  warehouse: Object.freeze({ density: 2.2, armor: 4 }),
  annex: Object.freeze({ density: 1.4, armor: 1.5 }),
  tech: Object.freeze({ density: 1.2, armor: 1 }),
  disc: Object.freeze({ density: 1.2, armor: 1 })
});

// Duchy (nad / pod płaszczyzną gry): raster wszystkich brył, komórka GHOST_CELL, raster GHOST_UPP j./piksel.
const GHOST_CELL = 45;
const GHOST_UPP = 15;
// Podział skóry (najdłuższa krawędź trójkąta w rzucie [komórki]): bęben i pomosty gną się przy taranie — gęsto.
const SKIN_EDGE_CELLS = Object.freeze({ drum: 3, core: 4, pier: 3, tank: 3, manifold: 3, warehouse: 4, annex: 3, tech: 3, disc: 4 });
// Rzadkie fundamenty: kotwica co tyle komórek kratownicy (worldBodies.anchorComponents).
const PIN_GRID_CELLS = Object.freeze({ core: 6, manifold: 8, warehouse: 10 });
const PLANE_BAND = 4;

/** Kotwice kawałka w układzie bazy: (x, z) → true = węzeł trzyma się reszty budowli (invMass 0). */
export function pirateBasePinTest(layout, chunk, cs = WORLD_BODY_TUNE.cellSize) {
  const H = layout.habitat;
  const near = 1.6 * cs;
  switch (chunk.kind) {
    case 'drum':
      // pierścień wewnętrzny trzyma się szybu (ściana zewnętrzna i grodzie swobodne — taran je gnie i rwie)
      return (x, z) => Math.hypot(x, z) <= H.innerR + near * 0.5;
    case 'core':
      return (x, z) => Math.hypot(x, z) <= H.coreR * 0.6;
    case 'pier': {
      // końce przy węzłach (rozwidlenie, bęben, zbiorniki) i rzadkie podpory co ~1/3 odcinka na osi pomostu
      const p = layout.piers.find((q) => q.chunks.includes(chunk.id));
      if (!p) return () => false;
      const parts = p.chunks.length;
      const i = p.chunks.indexOf(chunk.id);
      const s0 = (p.len * i) / parts;
      const s1 = (p.len * (i + 1)) / parts;
      const step = (s1 - s0) / 3;
      return (x, z) => {
        const s = (x - p.ax) * p.ux + (z - p.az) * p.uz;
        const o = (x - p.ax) * p.nx + (z - p.az) * p.nz;
        if (Math.abs(o) > p.halfW * 0.5) return false;
        if (s < s0 + near || s > s1 - near) return true;
        const k = Math.round((s - s0) / step) * step + s0;
        return Math.abs(s - k) <= cs * 0.6;
      };
    }
    case 'tank': {
      const t = layout.tanks.find((q) => q.chunk === chunk.id);
      return (x, z) => !!t && Math.hypot(x - t.x, z - t.z) <= t.r * 0.35;
    }
    case 'manifold': {
      const m = layout.manifold;
      return (x, z) => Math.abs(x - m.x) <= m.w * 0.2 && Math.abs(z - m.z) <= m.d * 0.2;
    }
    case 'warehouse': {
      const w = layout.warehouse;
      return (x, z) => z < w.z - w.d / 2 + near;
    }
    case 'annex': {
      const a = layout.warehouse.annex;
      return (x, z) => Math.abs(x - a.x) <= a.w * 0.25 && Math.abs(z - a.z) <= a.d * 0.25;
    }
    default:
      return () => false;
  }
}

/** Raster kawałka do ciała (jak dryDockChunkRaster): bryły w płaszczyźnie gry z góry (duch: wszystkie), wiersze odwrócone. */
export function pirateBaseChunkRaster(layout, scene, chunkId, { upp = WORLD_BODY_TUNE.rasterUpp, palette = null, band = PLANE_BAND, all = false } = {}) {
  const solids = all ? dryDockChunkSolids(layout, scene, [chunkId]) : dryDockPlanarSolids(layout, scene, [chunkId], { band });
  if (!solids.length) return null;
  const r = dryDockTopRaster(solids, { unitsPerPx: upp, palette });
  const W = r.width, Hh = r.height, src = r.data;
  const data = new Uint8ClampedArray(W * Hh * 4);
  for (let row = 0; row < Hh; row++) data.set(src.subarray((Hh - 1 - row) * W * 4, (Hh - row) * W * 4), row * W * 4);
  let any = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { any = true; break; }
  if (!any) return null;
  return { image: { width: W, height: Hh, data }, upp: r.unitsPerPx, cx: r.x0 + r.worldW / 2, cz: r.z1 - r.worldH / 2 };
}

const _rasters = new WeakMap();
function cachedRaster(layout, scene, chunkId, palette) {
  let m = _rasters.get(layout);
  if (!m) _rasters.set(layout, m = new Map());
  if (!m.has(chunkId)) {
    const ghost = !!layout.chunkById.get(chunkId)?.ghost;
    m.set(chunkId, pirateBaseChunkRaster(layout, scene, chunkId, ghost ? { palette, all: true, upp: GHOST_UPP } : { palette }) || false);
  }
  return m.get(chunkId);
}
const cellOf = (c) => (c.ghost ? GHOST_CELL : WORLD_BODY_TUNE.cellSize);

/** Rastry wszystkich kawałków i szablony kratownic (ekran ładowania). Zwraca liczbę kawałków. */
export function prebuildPirateBaseBodies(layout, scene, palette = null) {
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
 * Miejsca worldBodies dla bazy — jedno na budowlę: { habitat, fuel, warehouse, piers } → { id, owner, pieces, … }.
 * base — PirateBase3D (layout, scene, style), place — placePirateBase(…), owners — { habitat, fuel, warehouse, piers }
 * (byty stacji). hooks: { onLive(piece, live), onLost(piece) }.
 */
export function createPirateBaseSites(owners, base, place, hooks = {}) {
  const layout = base.layout;
  const scene = base.scene;
  const palette = base.style?.palette || null;
  const sites = {};
  for (const structure of Object.keys(layout.structures)) {
    const owner = owners[structure] || null;
    const pieces = [];
    const corner = { x: 0, y: 0 };
    for (const id of layout.structures[structure]) {
      const c = layout.chunkById.get(id);
      const b = c.box;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [hx, hz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]) {
        place.toGame(hx, hz, corner);
        if (corner.x < x0) x0 = corner.x; if (corner.x > x1) x1 = corner.x;
        if (corner.y < y0) y0 = corner.y; if (corner.y > y1) y1 = corner.y;
      }
      const pinHub = pirateBasePinTest(layout, c);
      let raster = null;
      pieces.push({
        id: c.id, kind: c.kind, label: c.label, group: c.group, weight: c.weight, chunk: c, structure,
        bounds: { x0, y0, x1, y1 },
        material: PIRATE_BASE_BODY_MATERIAL[c.kind] || null,
        ghost: !!c.ghost,
        cellSize: cellOf(c),
        skinEdgeCells: SKIN_EDGE_CELLS[c.kind] || 4,
        pinGridCells: PIN_GRID_CELLS[c.kind] || 0,
        build() {
          if (raster === null) raster = cachedRaster(layout, scene, c.id, palette);
          if (!raster) return null;
          const g = place.toGame(raster.cx, raster.cz, {});
          return { image: raster.image, upp: raster.upp, x: g.x, y: g.y, angle: place.axis };
        },
        pins(sx, sy) {
          if (!raster) return false;
          return pinHub(raster.cx + sx, raster.cz - sy);
        },
        rasterCenter() { return raster ? { x: raster.cx, z: raster.cz } : null; },
        available() { return !(base.isChunkGone ? base.isChunkGone(c.id) : false); }
      });
    }
    sites[structure] = {
      id: `pbase:${structure}:${owner?.id || 'PB'}`,
      owner, structure, base, place, pieces,
      onLive: hooks.onLive || null,
      onLost: hooks.onLost || null
    };
  }
  return sites;
}
