import { spatialCellKey } from './spatialCellKey.js';

export const BULLET_SPATIAL_CELL_SIZE = 1000;

let nextQueryId = 1;

/**
 * Broad-phase grid for projectile collisions.
 *
 * Entities are inserted into every cell touched by their collision radius.
 * Queries can therefore be as small as the projectile or blast radius without
 * missing a large hull whose centre lives in a neighbouring cell.
 */
export class BulletSpatialGrid {
  constructor(cellSize = BULLET_SPATIAL_CELL_SIZE) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('BulletSpatialGrid cellSize must be positive');
    }
    this.cellSize = cellSize;
    this.cellInv = 1 / cellSize;
    this.cells = new Map();
    this._activeCells = [];
    this._resultBuffer = [];
    this._resultCount = 0;
  }

  _hash(cx, cy) {
    return spatialCellKey(cx, cy);
  }

  clear() {
    for (let i = 0; i < this._activeCells.length; i++) this._activeCells[i].length = 0;
    this._activeCells.length = 0;
  }

  insert(entity, radius = entity?._blkMaxR ?? entity?.radius ?? entity?.r ?? 0) {
    if (!entity) return;
    const x = Number(entity.x);
    const y = Number(entity.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    const minCx = Math.floor((x - extent) * this.cellInv);
    const maxCx = Math.floor((x + extent) * this.cellInv);
    const minCy = Math.floor((y - extent) * this.cellInv);
    const maxCy = Math.floor((y + extent) * this.cellInv);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this._hash(cx, cy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        if (cell.length === 0) this._activeCells.push(cell);
        cell.push(entity);
      }
    }
  }

  getPotentialTargets(x, y, radius = 0) {
    const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    return this._queryBounds(x - extent, y - extent, x + extent, y + extent);
  }

  getPotentialTargetsAlongSegment(x0, y0, x1, y1, radius = 0) {
    const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    return this._queryBounds(
      Math.min(x0, x1) - extent,
      Math.min(y0, y1) - extent,
      Math.max(x0, x1) + extent,
      Math.max(y0, y1) + extent
    );
  }

  _queryBounds(minX, minY, maxX, maxY) {
    const minCx = Math.floor(minX * this.cellInv);
    const maxCx = Math.floor(maxX * this.cellInv);
    const minCy = Math.floor(minY * this.cellInv);
    const maxCy = Math.floor(maxY * this.cellInv);
    const queryId = nextQueryId++;
    this._resultCount = 0;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = this.cells.get(this._hash(cx, cy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const entity = cell[i];
          if (entity._bulletGridQueryId === queryId) continue;
          entity._bulletGridQueryId = queryId;
          this._resultBuffer[this._resultCount++] = entity;
        }
      }
    }

    if (this._resultBuffer.length > this._resultCount) {
      this._resultBuffer.length = this._resultCount;
    }
    return this._resultCount;
  }
}
