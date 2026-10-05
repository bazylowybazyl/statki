// src/game/hullMounts.js
//
// MOCOWANIA NA KADŁUBIE BELKOWYM — lampy (shipLightRuntime.js: pozycyjne, reflektory `road` i `flood`, ich
// grupy i billboardy; src/3d/fx/lightGrid.js) i dysze MAIN / SIDE (src/3d/engineVfxSystem.js) leżą w pikselach
// sprite'a WŁAŚCICIELA i jadą z jego pozą. Po rozpadzie kadłuba (hullBodies.js) odpadła część jest osobną
// encją-wrakiem rodu (`dmgKey`), a jej lampy i dysze zostawały na rodzicu: świeciły nad dryfującym wrakiem,
// potem z pustej przestrzeni (i oświetlały inne okręty).
//
// Model jak u mostków (shipBridgeBeams.js): mocowanie → KOMÓRKA siatki belek (ix, iy) z siatki SPOCZYNKOWEJ
// konstrukcji kadłuba (rany i rozpad jej nie ruszają; komórka jest tożsamością wspólną dla kadłuba, jego wraków
// i odłamów). Mocowanie żyje, dopóki ta komórka jest żywym węzłem BIEŻĄCEGO ciała właściciela — odcięte
// z odłamem albo zestrzelone gaśnie. Mocowanie na brzegu sprite'a (lampy obrysu, wyloty dysz), którego komórka
// nie ma węzła (próg alfy), bierze najbliższą komórkę z węzłem w promieniu HULL_MOUNT.bindReachCells; dalej —
// niezwiązane (świeci jak dawniej, dopóki ciało żyje).
//
// Koszt: wiązanie raz na zestaw mocowań i ród kadłuba; żywotność od nowa tylko przy zmianie ciała (to samo
// ciało i ta sama liczba żywych węzłów = ten sam stan — klucz jak evaluateBeamBridges); na klatkę O(1).
//
// UKŁADY: punkt mocowania w px RENDERU sprite'a od jego środka (x ku dziobowi, y w dół obrazu — offsety dysz,
// lampy × skala hardpointów); siatka belek = ciało − latticeMin (j. świata, Y w górę), jak beamImageToLattice.

import { HullBodies } from './hullBodies.js';

const D = HullBodies.engine;

export const HULL_MOUNT = Object.freeze({
  // Promień szukania komórki z węzłem dla mocowania, którego komórka węzła nie ma [komórki siatki].
  bindReachCells: 2
});

/** Kadłub belkowy encji (rekord należący do niej, z ciałem) albo null. */
export function mountHullOf(entity) {
  const h = entity?.beamHull;
  return h && h.entity === entity && h.body ? h : null;
}

// Siatka spoczynkowa (1 = komórka miała węzeł) — jedna na konstrukcję (flota jednego typu ją dzieli).
const _restByStructure = new WeakMap();

function restOccupancy(hull) {
  const body = hull.body, d = body.dims;
  let structure = null;
  try {
    structure = hull.image ? HullBodies.structureFor(hull.image, hull.scale, hull.cellPx) : null;
  } catch {
    structure = null;
  }
  if (structure && structure.dims && structure.dims.x === d.x && structure.dims.y === d.y) {
    let rest = _restByStructure.get(structure);
    if (!rest) {
      rest = new Uint8Array(d.x * d.y);
      const s = structure.nodeStore;
      for (let i = 0; i < s.count; i++) {
        if (s.iz[i] === 0 && s.active[i]) rest[s.ix[i] + s.iy[i] * d.x] = 1;
      }
      _restByStructure.set(structure, rest);
    }
    return rest;
  }
  // Bez konstrukcji: magazyn ciała (węzły martwe zostają w nim do zagęszczenia po rozpadzie).
  const rest = new Uint8Array(d.x * d.y);
  const s = body.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.iz[i] === 0) rest[s.ix[i] + s.iy[i] * d.x] = 1;
  return rest;
}

/**
 * Komórka (ix + iy · dims.x) pod punktem sprite'a (px renderu od środka, x ku dziobowi, y w dół obrazu) albo
 * najbliższa komórka z węzłem spoczynkowym w promieniu HULL_MOUNT.bindReachCells; −1 — poza kadłubem.
 */
export function bindHullMount(hull, sx, sy, rest) {
  const body = hull.body, cs = body.cellSize, d = body.dims;
  const fx = (hull.anchorDX + sx * hull.scale) / cs;
  const fy = (hull.anchorDY - sy * hull.scale) / cs;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return -1;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  if (ix >= 0 && iy >= 0 && ix < d.x && iy < d.y && rest[ix + iy * d.x]) return ix + iy * d.x;
  const R = HULL_MOUNT.bindReachCells;
  const r = Math.ceil(R);
  let best = -1, bestD2 = R * R;
  for (let y = Math.max(0, iy - r); y <= Math.min(d.y - 1, iy + r); y++) {
    for (let x = Math.max(0, ix - r); x <= Math.min(d.x - 1, ix + r); x++) {
      if (!rest[x + y * d.x]) continue;
      const ex = x + 0.5 - fx, ey = y + 0.5 - fy;
      const d2 = ex * ex + ey * ey;
      if (d2 < bestD2) { bestD2 = d2; best = x + y * d.x; }
    }
  }
  return best;
}

/** Zestaw mocowań encji (lampy jednego bloku, dysze jednego układu). */
export function createHullMountSet() {
  return {
    lineage: 0,          // ród kadłuba, dla którego są wiązania (dmgKey)
    body: null,          // ciało i liczba jego żywych węzłów przy ostatniej ocenie
    active: -1,
    count: 0,
    cells: new Int32Array(0),   // komórka mocowania (−1 = niezwiązane)
    alive: new Uint8Array(0),
    dead: 0,             // ile mocowań zgasło
    version: 0           // rośnie przy każdej zmianie `alive` (i przy nowym wiązaniu)
  };
}

/**
 * Wiązanie od nowa: `count` mocowań kadłuba `hull`. Zwraca siatkę spoczynkową dla bindHullMount — wołający
 * wpisuje `set.cells[i] = bindHullMount(hull, sx, sy, siatka)`, potem refreshHullMountSet.
 */
export function beginHullMountBind(set, hull, count) {
  if (set.cells.length < count) {
    set.cells = new Int32Array(count);
    set.alive = new Uint8Array(count);
  }
  set.count = count;
  set.lineage = hull.dmgKey;
  set.body = null;
  set.active = -1;
  set.cells.fill(-1, 0, count);
  set.alive.fill(1, 0, count);
  set.dead = 0;
  set.version++;
  return restOccupancy(hull);
}

/**
 * Żywotność mocowań od nowa, gdy ciało kadłuba się zmieniło (inne ciało albo inna liczba żywych węzłów).
 * Martwe ciało gasi wszystko. Zwraca true, gdy zmieniła się któraś pozycja `alive`.
 */
export function refreshHullMountSet(set, hull) {
  const body = hull.body;
  const active = body.dead ? 0 : body.activeNodes;
  if (set.body === body && set.active === active) return false;
  set.body = body;
  set.active = active;
  const n = set.count, cells = set.cells, alive = set.alive;
  const lattice = active > 0 ? D._latticeIndex(body).cells : null;
  const live = body.nodeStore.active;
  let changed = false, dead = 0;
  for (let k = 0; k < n; k++) {
    const c = cells[k];
    let a = 1;
    if (!lattice) a = 0;
    else if (c >= 0) {
      const i = lattice[c];
      a = i >= 0 && live[i] ? 1 : 0;
    }
    if (a !== alive[k]) { alive[k] = a; changed = true; }
    if (!a) dead++;
  }
  set.dead = dead;
  if (changed) set.version++;
  return changed;
}
