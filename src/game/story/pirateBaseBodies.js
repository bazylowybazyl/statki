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

import { dryDockChunkSolids, dryDockPlanarSolids, dryDockTopRaster, dryDockSolidsToTriangles, dryDockSolidsBounds } from '../../3d/portBuildings/pirateDryDockChunks.js';
import { WORLD_BODY_TUNE } from '../worldBodies.js';
import { HullBodies } from '../hullBodies.js';
import { voxelizeTriangles, bridgeVoxelComponents } from '../voxelBody3D.js';
import { buildBeamStructure } from '../beamBody3D.js';

// BRYŁY 3D (docs/PORT-silnik-belek.md § „Ciała 3D”, decyzja użytkownika 2026-10-15: „silnik prawdziwie 3D”): wieża
// habitatu (szyja z głową — H-T) i sektory dysku mieszkalnego (D-1…8) to ciała 3D z wokselizacji brył sceny — wieża
// po zerwaniu szyi przewraca się (pirateBaseNeck.js), uderza bokiem w koronę bębna i spada na dysk, który pęka.
// cell — komórka [j.], interior / shellLayers / ribStep — wnętrze wokselizacji (skorupa + kratownica w głębi).
// gravity — umowna grawitacja habitatu (ku dyskowi, −z świata) [j/s²] dla odłamów i przewracanej wieży: dobrana tak,
// żeby przechył szedł powoli, a koniec był szybki (pomiar: scripts/destrukcja-taran-sym.mjs --tryb wieza).
export const PIRATE_BASE_SOLID = {
  tech: { cell: 45, interior: 'full', shellLayers: 1, ribStep: 3 },
  disc: { cell: 45, interior: 'ribs', shellLayers: 1, ribStep: 3 },
  gravity: 400
};
// Szyb habitatu (H-C, płaski) dla brył 3D sięga najwyżej tyle pod spód wieży: podstawa przewracanej wieży schodzi pod
// zawias (pół szyi × sin przechyłu) i nie może oprzeć się na szybie, zanim przegub pęknie.
const CORE_COLUMN_GAP = 220;
// Podpory dysku mieszkalnego (bryła 3D): kotwica pod spodem co tyle komórek w obu osiach poziomych.
const DISC_PIN_GRID = 6;

/** Materiał kawałków (gęstość × kadłuba 1,19; pancerz zderzeń — Atlas 16, fregata 1). */
export const PIRATE_BASE_BODY_MATERIAL = Object.freeze({
  drum: Object.freeze({ density: 2.4, armor: 5 }),
  core: Object.freeze({ density: 3.2, armor: 10 }),
  pier: Object.freeze({ density: 2.2, armor: 3 }),
  tank: Object.freeze({ density: 1.6, armor: 2 }),
  manifold: Object.freeze({ density: 2.6, armor: 6 }),
  warehouse: Object.freeze({ density: 2.2, armor: 4 }),
  annex: Object.freeze({ density: 1.4, armor: 1.5 }),
  // Wieża habitatu (H-T, bryła 3D — scenariusz szyi, 2026-10-15: „bok wieży ma się rozwalić, płaszczyć”): miękka
  // względem bębna i dysku — przy uderzeniu bokiem gniecie się wieża (zgniot dzieli się ∝ 1/pancerz²: 2,5 vs 5 → wieża
  // ~80%), dysk pęka lokalnie i odpada kawałkami (wisi na trzonie), wieża zostaje na nim.
  tech: Object.freeze({ density: 1.6, armor: 2.5 }),
  disc: Object.freeze({ density: 1.2, armor: 3 })
});

// Strojenie materiałów w locie (A/B — scripts/destrukcja-taran-sym.mjs --mat, konsola): { rodzaj: { density, armor } }.
export const PIRATE_BASE_MATERIAL_OVERRIDE = {};
export function pirateBaseMaterial(kind) {
  const base = PIRATE_BASE_BODY_MATERIAL[kind] || null;
  const o = PIRATE_BASE_MATERIAL_OVERRIDE[kind];
  return o ? { ...(base || {}), ...o } : base;
}

// Duchy (nad / pod płaszczyzną gry): raster wszystkich brył, komórka GHOST_CELL, raster GHOST_UPP j./piksel.
// 30 j. (dawniej 45): krater głowy w dysku nie jest kanciasty (pomiar kosztu — scripts/destrukcja-taran-sym.mjs --tryb szyja).
const GHOST_CELL = 30;
const GHOST_UPP = 15;
// Podział skóry (najdłuższa krawędź trójkąta w rzucie [komórki]): bęben i pomosty gną się przy taranie — gęsto.
const SKIN_EDGE_CELLS = Object.freeze({ drum: 3, core: 4, pier: 3, tank: 3, manifold: 3, warehouse: 4, annex: 3, tech: 3, disc: 4 });
// Rzadkie fundamenty: kotwica co tyle komórek kratownicy (worldBodies.anchorComponents). Szyb habitatu (H-C) bez
// siatki (audyt destruktora 2026-10-14, R8): trzymają go tylko kotwice osi (szyja do dysku i głowy) o skończonej
// wytrzymałości — szarża Atlasa je zrywa.
const PIN_GRID_CELLS = Object.freeze({ manifold: 8, warehouse: 10, disc: 8 });
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
      // szyb trzyma się szyi (rura neckR nad bębnem i trzon dysku pod nim) — kotwice na PIERŚCIENIU rury, nie w całym
      // środku (dawny dysk r ≤ 0,6 coreR: 292 kotwice — przy skończonej wytrzymałości kotwic taran nie zrywał szyi);
      // przebita ściana rury (utrata ≥ 8% z nich) = szyja zerwana (pirateBaseNeck.js)
      return (x, z) => { const r = Math.hypot(x, z); return r <= H.neckR && r >= H.neckR - near; };
    case 'tech':
      // głowa wisi na szyi (rura neckR) — kotwice w osi; scenariusz szyi zrywa je od razu (detachPiece)
      return (x, z) => Math.hypot(x, z) <= H.neckR;
    case 'disc':
      // dysk mieszkalny wisi na trzonie (stemR) pod bębnem; resztę trzyma rzadka siatka podpór (PIN_GRID_CELLS.disc)
      return (x, z) => Math.hypot(x, z) <= H.stemR * 0.5;
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

/** Kotwice BRYŁY 3D w układzie bazy (x, z poziomo, h — wysokość świata): (x, z, h) → true = węzeł trzyma się reszty. */
export function pirateBaseSolidPinTest(layout, chunk, cs, bottom = 0) {
  const H = layout.habitat;
  switch (chunk.kind) {
    case 'tech':
      // wieża stoi na szybie: kotwice w spodzie (nasada szyi, `bottom` — najniższa wysokość brył wieży) — zrywa je
      // scenariusz szyi
      return (x, z, h) => h <= bottom + 1.6 * cs && Math.hypot(x, z) <= H.neckR + 1.2 * cs;
    case 'disc': {
      // dysk mieszkalny wisi na trzonie (stemR) i rzadkiej siatce podpór pod spodem (co DISC_PIN_GRID komórek —
      // spadająca wieża gniecie dysk lokalnie i zostaje na nim; bez podpór sektor-wspornik łamał się przy trzonie)
      const g = DISC_PIN_GRID * cs;
      const onGrid = (v) => ((v % g) + g) % g < cs;
      return (x, z, h) => Math.hypot(x, z) <= H.stemR * 0.6 || (h <= bottom + 1.2 * cs && onGrid(x) && onGrid(z));
    }
    default:
      return () => false;
  }
}

// Bryła 3D kawałka (raz na układ — ekran ładowania): { structure, cx, cz, solids, bounds }. Układ wokselizacji F =
// (x − cx, −(z − cz), h) — x osi budowli, −z (jak obraz ciała płaskiego), wysokość świata; (cx, cz) — środek pudła.
const _solids3D = new WeakMap();
export function pirateBaseSolidOf(layout, scene, chunkId, palette = null) {
  let m = _solids3D.get(layout);
  if (!m) _solids3D.set(layout, m = new Map());
  if (m.has(chunkId)) return m.get(chunkId);
  const c = layout.chunkById.get(chunkId);
  const cfg = c && PIRATE_BASE_SOLID[c.kind];
  let out = false;
  if (cfg) {
    const solids = dryDockChunkSolids(layout, scene, [chunkId]);
    if (solids.length) {
      const bounds = dryDockSolidsBounds(solids);
      const cx = (c.box.x0 + c.box.x1) / 2, cz = (c.box.z0 + c.box.z1) / 2;
      const tri = dryDockSolidsToTriangles(solids, { palette, sides: 12, map: (v) => [v[0] - cx, -(v[2] - cz), v[1]] });
      const vox = voxelizeTriangles(tri.positions, tri.colors, {
        cellSize: cfg.cell, interiorMode: cfg.interior, shellLayers: cfg.shellLayers, ribStep: cfg.ribStep, maxCells: 400000
      });
      const bridged = bridgeVoxelComponents(vox);
      const structure = buildBeamStructure(vox, { bulkheadEvery: 0, frameStride: 2, maxFrameSpan: 14 });
      out = { structure, cx, cz, bounds, bridged, cells: vox.cells.length };
    }
  }
  m.set(chunkId, out);
  return out;
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
    if (PIRATE_BASE_SOLID[c.kind]) { if (pirateBaseSolidOf(layout, scene, c.id, palette)) n++; continue; }
    const r = cachedRaster(layout, scene, c.id, palette);
    if (!r) continue;
    HullBodies.structureFor(r.image, r.upp, cellOf(c) / r.upp);
    n++;
  }
  return n;
}

// Słup kawałka płaskiego dla brył 3D: zakres wysokości jego brył w płaszczyźnie gry (ściany bębna od dna po koronę,
// pomost od rękawów po balustradę); szyb habitatu przycięty pod spód wieży (CORE_COLUMN_GAP).
const _columns = new WeakMap();
function planarColumn(layout, scene, c) {
  let m = _columns.get(layout);
  if (!m) _columns.set(layout, m = new Map());
  if (m.has(c.id)) return m.get(c.id);
  let col = null;
  const solids = dryDockPlanarSolids(layout, scene, [c.id], { band: PLANE_BAND });
  if (solids.length) {
    const b = dryDockSolidsBounds(solids);
    col = { z0: Math.min(0, b.y0), z1: Math.max(0, b.y1) };
    if (c.kind === 'core') {
      const tech = layout.chunks.find((k) => k.kind === 'tech');
      const ts = tech ? dryDockChunkSolids(layout, scene, [tech.id]) : [];
      if (ts.length) col.z1 = Math.max(0, Math.min(col.z1, dryDockSolidsBounds(ts).y0 - CORE_COLUMN_GAP));
    }
  }
  m.set(c.id, col);
  return col;
}

// Kawałek-BRYŁA 3D (wieża, sektor dysku): ciało 3D z pirateBaseSolidOf, poza z place (obrót o −oś bazy wokół z).
function solidPiece(layout, scene, place, c, structure, palette, bounds, base) {
  const cfg = PIRATE_BASE_SOLID[c.kind];
  const half = -place.axis * 0.5;
  const quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  let nodes = -1;
  return {
    id: c.id, kind: c.kind, label: c.label, group: c.group, weight: c.weight, chunk: c, structure,
    bounds,
    material: pirateBaseMaterial(c.kind),
    ghost: !!c.ghost,
    solid3D: true,
    cellSize: cfg.cell,
    skinEdgeCells: SKIN_EDGE_CELLS[c.kind] || 3,
    pinGridCells: 0,
    build() { return null; },
    buildSolid() {
      const sol = pirateBaseSolidOf(layout, scene, c.id, palette);
      if (!sol) return null;
      const g = place.toGame(sol.cx, sol.cz, {});
      const pin = pirateBaseSolidPinTest(layout, c, cfg.cell, sol.bounds.y0);
      return {
        structure: sol.structure,
        position: { x: g.x, y: -g.y, z: 0 },
        quaternion: quat,
        pins: (fx, fy, fz) => pin(fx + sol.cx, sol.cz - fy, fz),
        gravity: { x: 0, y: 0, z: -PIRATE_BASE_SOLID.gravity }
      };
    },
    pins() { return false; },
    // Układ wokselizacji w układzie bazy (render: wypiek skóry 3D w tym samym układzie co konstrukcja).
    solidFrame() {
      const sol = pirateBaseSolidOf(layout, scene, c.id, palette);
      return sol ? { cx: sol.cx, cz: sol.cz, structure: sol.structure } : null;
    },
    rasterCenter() {
      const sol = pirateBaseSolidOf(layout, scene, c.id, palette);
      return sol ? { x: sol.cx, z: sol.cz } : null;
    },
    nodeCount() {
      if (nodes >= 0) return nodes;
      const sol = pirateBaseSolidOf(layout, scene, c.id, palette);
      nodes = sol ? sol.structure.nodeStore.count : 0;
      return nodes;
    },
    available() { return !(base.isChunkGone ? base.isChunkGone(c.id) : false); }
  };
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
      if (PIRATE_BASE_SOLID[c.kind]) {
        pieces.push(solidPiece(layout, scene, place, c, structure, palette, { x0, y0, x1, y1 }, base));
        continue;
      }
      const pinHub = pirateBasePinTest(layout, c);
      let raster = null;
      let nodes = -1;
      pieces.push({
        id: c.id, kind: c.kind, label: c.label, group: c.group, weight: c.weight, chunk: c, structure,
        bounds: { x0, y0, x1, y1 },
        material: pirateBaseMaterial(c.kind),
        ghost: !!c.ghost,
        cellSize: cellOf(c),
        skinEdgeCells: SKIN_EDGE_CELLS[c.kind] || 4,
        pinGridCells: PIN_GRID_CELLS[c.kind] || 0,
        column: planarColumn(layout, scene, c),
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
        // Węzły kawałka w szablonie kratownicy (ta sama konstrukcja co ciało — structureFor z pamięci po rastrze z
        // ekranu ładowania): suma budowli przelicza zgniot taranem na jej punkty (pirateBaseIntegrity.js).
        nodeCount() {
          if (nodes >= 0) return nodes;
          nodes = 0;
          const s = this.build();
          const st = s ? HullBodies.structureFor(s.image, s.upp, cellOf(c) / s.upp) : null;
          const ns = st?.nodeStore;
          if (ns) for (let i = 0; i < ns.count; i++) if (ns.active[i]) nodes++;
          return nodes;
        },
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
