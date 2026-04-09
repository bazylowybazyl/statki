// AI spatial grid — zero-alloc per query, rebuilt once per frame.
// Cell size 600 covers most AI query radii in 1-2 cells lookup.
//
// USAGE CONTRACT:
//   1. Call rebuildAIGrid(npcs, true) once at top of each AI step (npcStep).
//   2. Call queryAIGrid(x, y, radius) to get { buffer, count } of nearby entities.
//   3. CALLER MUST consume the returned buffer immediately. The buffer is shared
//      and reused on the next queryAIGrid call. NEVER call queryAIGrid recursively
//      while iterating a previous result.

const CELL_SIZE = 600;
const INV_CELL = 1 / CELL_SIZE;

// Reusable storage:
//  cells: Map<key, entity[]>  — cell arrays reused, not realloc'd
//  result: Entity[]           — single shared result buffer
const cells = new Map();
const result = [];
let resultCount = 0;

export function rebuildAIGrid(entityList, includePlayer) {
  // Clear cell arrays in place (don't realloc)
  for (const arr of cells.values()) arr.length = 0;

  if (entityList && entityList.length) {
    for (let i = 0; i < entityList.length; i++) {
      const e = entityList[i];
      if (!e || e.dead) continue;
      const cx = Math.floor(e.x * INV_CELL);
      const cy = Math.floor(e.y * INV_CELL);
      const key = (cx * 73856093) ^ (cy * 19349663); // int hash, no string alloc
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
    const key = (cx * 73856093) ^ (cy * 19349663);
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
  const span = Math.ceil(radius * INV_CELL);

  if (span > 8) {
    // Full-list path: dump all populated cells. Caller will still range-check
    // each candidate, so the only cost vs. the targeted path is one extra
    // pass over irrelevant entities. Same complexity as the old O(N) scan.
    for (const arr of cells.values()) {
      for (let i = 0; i < arr.length; i++) {
        result[resultCount++] = arr[i];
      }
    }
    if (result.length > resultCount) result.length = resultCount;
    return { buffer: result, count: resultCount };
  }

  const cx = Math.floor(x * INV_CELL);
  const cy = Math.floor(y * INV_CELL);
  for (let ix = -span; ix <= span; ix++) {
    for (let iy = -span; iy <= span; iy++) {
      const key = ((cx + ix) * 73856093) ^ ((cy + iy) * 19349663);
      const arr = cells.get(key);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        result[resultCount++] = arr[i];
      }
    }
  }
  // Trim residual stale references past the active count to allow GC.
  // Keep buffer length at exactly resultCount so callers using .length see right size.
  if (result.length > resultCount) result.length = resultCount;
  return { buffer: result, count: resultCount };
}

if (typeof window !== 'undefined') {
  window.rebuildAIGrid = rebuildAIGrid;
  window.queryAIGrid = queryAIGrid;
}
