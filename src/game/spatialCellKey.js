// Collision-free numeric pairing for signed 2D cell coordinates. Unlike the
// common XOR hash, (+x,+y) and (-x,-y) cannot alias to the same Map bucket.
export function spatialCellKey(cx, cy) {
  const x = cx >= 0 ? cx * 2 : -cx * 2 - 1;
  const y = cy >= 0 ? cy * 2 : -cy * 2 - 1;
  const sum = x + y;
  return (sum * (sum + 1)) * 0.5 + y;
}
