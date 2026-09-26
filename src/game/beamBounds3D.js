// Bounds of the deforming node cloud, independent of the visual GLB mesh.
// Exact: min/max and the farthest active node, O(N).
export function updateBeamBounds(body) {
  const b = body._localBounds ||= new Float64Array(6);
  const mm = body._boundsMinMax ||= new Float64Array(6);
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
  mm[0] = minX; mm[1] = minY; mm[2] = minZ; mm[3] = maxX; mm[4] = maxY; mm[5] = maxZ;
  setBoundsFromMinMax(b, mm);
  body._boundsR2 = r2;
  body.radius = Math.sqrt(r2) + body.cellSize;
  body._boundsTick = -1;
}

function setBoundsFromMinMax(b, mm) {
  b[0] = (mm[0] + mm[3]) * 0.5; b[1] = (mm[1] + mm[4]) * 0.5; b[2] = (mm[2] + mm[5]) * 0.5;
  b[3] = (mm[3] - mm[0]) * 0.5; b[4] = (mm[4] - mm[1]) * 0.5; b[5] = (mm[5] - mm[2]) * 0.5;
}

/**
 * Obrys rośnie o punkt (układ ciała) — nigdy nie maleje. Zgniot, trafienie i solver lokalny
 * ruszają garść węzłów, a pełne przeliczenie wszystkich po każdym kontakcie kosztowało ~5%
 * taranu. Obrys zostaje zachowawczy (zawiera każdy węzeł), więc testy par, zasięgu i promieni
 * odrzucają najwyżej mniej; dokładny wraca w updateBeamBounds (wyrównanie środka, przebudowa,
 * krok pełnego solvera, naprawa).
 */
export function extendBeamBounds(body, x, y, z) {
  const mm = body._boundsMinMax;
  let grew = false;
  if (x < mm[0]) { mm[0] = x; grew = true; }
  if (x > mm[3]) { mm[3] = x; grew = true; }
  if (y < mm[1]) { mm[1] = y; grew = true; }
  if (y > mm[4]) { mm[4] = y; grew = true; }
  if (z < mm[2]) { mm[2] = z; grew = true; }
  if (z > mm[5]) { mm[5] = z; grew = true; }
  if (grew) {
    setBoundsFromMinMax(body._localBounds, mm);
    body._boundsTick = -1;
  }
  const r2 = x * x + y * y + z * z;
  if (r2 > body._boundsR2) {
    body._boundsR2 = r2;
    body.radius = Math.sqrt(r2) + body.cellSize;
  }
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
