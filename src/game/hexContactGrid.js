// Lazy spatial index for cells that have moved out of their original slots.
// Typed buffers are reused; pristine hulls keep the cheaper static grid path.
export function getHexShardDrift(shard, deformScale) {
  const dx = Math.abs(shard.gridX - shard.origGridX) +
    Math.max(Math.abs(shard.deformation.x), Math.abs(shard.targetDeformation.x)) * deformScale;
  const dy = Math.abs(shard.gridY - shard.origGridY) +
    Math.max(Math.abs(shard.deformation.y), Math.abs(shard.targetDeformation.y)) * deformScale;
  return Math.max(dx, dy);
}

export function getHexContactGrid(grid, deformScale, cellSize, defaultRadius) {
  const shards = grid.shards;
  let index = grid._contactSpatialIndex;
  if (!index || index.next.length < shards.length) {
    let capacity = 16;
    while (capacity < shards.length) capacity *= 2;
    index = grid._contactSpatialIndex = {
      heads: new Int32Array(capacity * 2),
      next: new Int32Array(capacity),
      cellX: new Int32Array(capacity), cellY: new Int32Array(capacity),
      x: new Float64Array(capacity), y: new Float64Array(capacity),
      revision: -1, shards: null, builds: 0, candidateChecks: 0
    };
  }
  if (index.shards === shards && index.revision === grid.meshRevision &&
      index.deformScale === deformScale && index.cellSize === cellSize) return index;
  index.heads.fill(-1);
  index.mask = index.heads.length - 1;
  index.cellSize = cellSize;
  index.maxRadius = defaultRadius;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    const x = s.gridX + s.deformation.x * deformScale;
    const y = s.gridY + s.deformation.y * deformScale;
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
    const hash = ((cx * 73856093) ^ (cy * 19349663)) & index.mask;
    index.x[i] = x; index.y[i] = y;
    index.cellX[i] = cx; index.cellY[i] = cy;
    index.next[i] = index.heads[hash];
    index.heads[hash] = i;
    index.maxRadius = Math.max(index.maxRadius, Number(s.hitRadius) || defaultRadius);
  }
  index.shards = shards;
  index.revision = grid.meshRevision;
  index.deformScale = deformScale;
  index.builds++;
  return index;
}

export function findHexContact(index, x, y, scaleX, scaleY, otherRadius, defaultRadius) {
  const scale = Math.max(scaleX, scaleY);
  const radius = (otherRadius + index.maxRadius * scale) * 0.78;
  const minX = Math.floor((x - radius / scaleX) / index.cellSize);
  const maxX = Math.floor((x + radius / scaleX) / index.cellSize);
  const minY = Math.floor((y - radius / scaleY) / index.cellSize);
  const maxY = Math.floor((y + radius / scaleY) / index.cellSize);
  let best = null, bestDistSq = Infinity;
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const hash = ((cx * 73856093) ^ (cy * 19349663)) & index.mask;
      for (let i = index.heads[hash]; i >= 0; i = index.next[i]) {
        if (index.cellX[i] !== cx || index.cellY[i] !== cy) continue;
        const s = index.shards[i];
        if (!s.active || s.isDebris) continue;
        index.candidateChecks++;
        const dx = (x - index.x[i]) * scaleX;
        const dy = (y - index.y[i]) * scaleY;
        const d2 = dx * dx + dy * dy;
        const hitRadius = (otherRadius + (Number(s.hitRadius) || defaultRadius) * scale) * 0.78;
        if (d2 < hitRadius * hitRadius && d2 < bestDistSq) {
          best = s;
          bestDistSq = d2;
        }
      }
    }
  }
  return best;
}
