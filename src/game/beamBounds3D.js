// Bounds of the deforming node cloud, independent of the visual GLB mesh.
export function updateBeamBounds(body) {
  const b = body._localBounds ||= new Float64Array(6);
  const s = body.nodeStore, x = s.x, y = s.y, z = s.z, active = s.active;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, r2 = 0;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const nx = x[i], ny = y[i], nz = z[i];
    minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
    minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
    minZ = Math.min(minZ, nz); maxZ = Math.max(maxZ, nz);
    r2 = Math.max(r2, nx * nx + ny * ny + nz * nz);
  }
  if (minX === Infinity) minX = minY = minZ = maxX = maxY = maxZ = 0;
  b[0] = (minX + maxX) * 0.5; b[1] = (minY + maxY) * 0.5; b[2] = (minZ + maxZ) * 0.5;
  b[3] = (maxX - minX) * 0.5; b[4] = (maxY - minY) * 0.5; b[5] = (maxZ - minZ) * 0.5;
  body.radius = Math.sqrt(r2) + body.cellSize;
  body._boundsTick = -1;
}

export function worldBeamBounds(body, tick) {
  // Position is applied by the caller: contact separation can move it mid-step.
  const w = body._worldBounds ||= new Float64Array(6);
  if (body._boundsTick === tick) return w;
  const b = body._localBounds, m = body._rot;
  for (let i = 0; i < 3; i++) {
    const r = i * 3;
    w[i] = m[r] * b[0] + m[r + 1] * b[1] + m[r + 2] * b[2];
    w[i + 3] = Math.abs(m[r]) * b[3] + Math.abs(m[r + 1]) * b[4] + Math.abs(m[r + 2]) * b[5];
  }
  body._boundsTick = tick;
  return w;
}

export function beamBoundsOverlap(A, B, padding, tick) {
  const a = worldBeamBounds(A, tick), b = worldBeamBounds(B, tick);
  return Math.abs(A.pos.x - B.pos.x + a[0] - b[0]) <= a[3] + b[3] + padding &&
    Math.abs(A.pos.y - B.pos.y + a[1] - b[1]) <= a[4] + b[4] + padding &&
    Math.abs(A.pos.z - B.pos.z + a[2] - b[2]) <= a[5] + b[5] + padding;
}
