// AI spatial grid — zero-alloc per query, rebuilt once per frame.
// Cell size 600 covers most AI query radii in 1-2 cells lookup.
//
// USAGE CONTRACT:
//   1. Call rebuildAIGrid(npcs, true) once at top of each AI step (npcStep).
//   2. Call queryAIGrid(x, y, radius) to get { buffer, count } of nearby entities.
//   3. CALLER MUST consume the returned buffer immediately. The buffer is shared
//      and reused on the next queryAIGrid call. NEVER call queryAIGrid recursively
//      while iterating a previous result.

import { spatialCellKey } from '../game/spatialCellKey.js';

const CELL_SIZE = 600;
const INV_CELL = 1 / CELL_SIZE;

// Reusable storage:
//  cells: Map<key, entity[]>  — cell arrays reused, not realloc'd
//  result: Entity[]           — single shared result buffer
const cells = new Map();
const result = [];
let resultCount = 0;
const queryResponse = { buffer: result, count: 0 };
let nextQueryId = 1;

export function rebuildAIGrid(entityList, includePlayer) {
  // Clear cell arrays in place (don't realloc)
  for (const arr of cells.values()) arr.length = 0;

  if (entityList && entityList.length) {
    for (let i = 0; i < entityList.length; i++) {
      const e = entityList[i];
      if (!e || e.dead) continue;
      const cx = Math.floor(e.x * INV_CELL);
      const cy = Math.floor(e.y * INV_CELL);
      const key = spatialCellKey(cx, cy);
      let arr = cells.get(key);
      if (!arr) { arr = []; cells.set(key, arr); }
      arr.push(e);
    }
  }

  if (includePlayer && typeof window !== 'undefined' && window.ship && !window.ship.dead && !window.ship.destroyed) {
    const ship = window.ship;
    const sx = ship.pos?.x ?? ship.x ?? 0;
    const sy = ship.pos?.y ?? ship.y ?? 0;
    const cx = Math.floor(sx * INV_CELL);
    const cy = Math.floor(sy * INV_CELL);
    const key = spatialCellKey(cx, cy);
    let arr = cells.get(key);
    if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(ship);
  }
}

// Returns shared result buffer + count. CALLER MUST consume immediately
// (next call invalidates the buffer). Zero allocation per query.
//
// For HUGE query radii (span > 8 cells, e.g. aiPickBestTarget at 20000u or
// long-range capital weapons), iterating the full per-cell box would do
// thousands of empty map lookups — strictly slower than just returning
// the full entity list. In that case we bail to "iterate all populated
// cells" which is O(N) over real entities and matches the old O(N) scan.
export function queryAIGrid(x, y, radius) {
  resultCount = 0;
  const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const minCx = Math.floor((x - extent) * INV_CELL);
  const maxCx = Math.floor((x + extent) * INV_CELL);
  const minCy = Math.floor((y - extent) * INV_CELL);
  const maxCy = Math.floor((y + extent) * INV_CELL);
  const queryId = nextQueryId++;

  if ((maxCx - minCx) > 16 || (maxCy - minCy) > 16) {
    // Full-list path: dump all populated cells. Caller will still range-check
    // each candidate, so the only cost vs. the targeted path is one extra
    // pass over irrelevant entities. Same complexity as the old O(N) scan.
    for (const arr of cells.values()) {
      for (let i = 0; i < arr.length; i++) {
        const entity = arr[i];
        if (entity._aiGridQueryId === queryId) continue;
        entity._aiGridQueryId = queryId;
        result[resultCount++] = entity;
      }
    }
    if (result.length > resultCount) result.length = resultCount;
    queryResponse.count = resultCount;
    return queryResponse;
  }

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const key = spatialCellKey(cx, cy);
      const arr = cells.get(key);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const entity = arr[i];
        if (entity._aiGridQueryId === queryId) continue;
        entity._aiGridQueryId = queryId;
        result[resultCount++] = entity;
      }
    }
  }
  // Trim residual stale references past the active count to allow GC.
  // Keep buffer length at exactly resultCount so callers using .length see right size.
  if (result.length > resultCount) result.length = resultCount;
  queryResponse.count = resultCount;
  return queryResponse;
}

if (typeof window !== 'undefined') {
  window.rebuildAIGrid = rebuildAIGrid;
  window.queryAIGrid = queryAIGrid;
}
