// HUTA — ścieżki (czysta matematyka): łamana z zaokrąglonymi narożnikami, próbkowana po długości. Po ścieżkach jadą
// kadzie, bryłki rudy na przenośnikach, kręgi na samotoku placu i ciężarówki. Punkt: [x, z] albo [x, z, y] (y — wysokość
// K-7, liczona liniowo po długości między punktami łamanej).

/**
 * @param {Array<number[]>} pts   wierzchołki łamanej
 * @param {object} o   closed — pętla; radius — promień zaokrąglenia narożników; step — krok próbkowania łuku [j.]
 * @returns {{ length: number, closed: boolean, at(d: number, out?: object): {x, z, y, h}, nearest(x: number, z: number): number, points: number[][] }}
 */
export function makePath(pts, { closed = false, radius = 0, step = 30 } = {}) {
  const n = pts.length;
  const out = [];           // [x, z, y]
  const yOf = (p) => (p.length > 2 ? p[2] : 0);
  for (let i = 0; i < n; i++) {
    const B = pts[i];
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!(radius > 0) || !hasPrev || !hasNext) { out.push([B[0], B[1], yOf(B)]); continue; }
    const A = pts[(i - 1 + n) % n];
    const C = pts[(i + 1) % n];
    let ux = B[0] - A[0];
    let uz = B[1] - A[1];
    let wx = C[0] - B[0];
    let wz = C[1] - B[1];
    const la = Math.hypot(ux, uz);
    const lc = Math.hypot(wx, wz);
    if (la < 1e-6 || lc < 1e-6) { out.push([B[0], B[1], yOf(B)]); continue; }
    ux /= la; uz /= la; wx /= lc; wz /= lc;
    const cross = ux * wz - uz * wx;
    const dot = Math.max(-1, Math.min(1, ux * wx + uz * wz));
    const phi = Math.acos(dot);                       // kąt skrętu
    if (phi < 0.02) { out.push([B[0], B[1], yOf(B)]); continue; }
    let t = radius * Math.tan(phi / 2);
    const tMax = Math.min(la, lc) * 0.49;
    const r = t > tMax ? radius * (tMax / t) : radius;
    if (t > tMax) t = tMax;
    const sgn = cross > 0 ? 1 : -1;
    // środek łuku: od punktu styczności prostopadle do u, po stronie skrętu
    const p1x = B[0] - ux * t;
    const p1z = B[1] - uz * t;
    const ox = p1x + (-uz) * sgn * r;
    const oz = p1z + ux * sgn * r;
    const a0 = Math.atan2(p1z - oz, p1x - ox);
    const k = Math.max(2, Math.ceil((r * phi) / step));
    for (let j = 0; j <= k; j++) {
      const a = a0 + sgn * phi * (j / k);
      out.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r, yOf(B)]);
    }
  }
  if (closed) out.push(out[0].slice());
  const m = out.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  const length = cum[m - 1];
  let hint = 0;

  function at(d, o = {}) {
    if (closed) d = ((d % length) + length) % length;
    else d = d < 0 ? 0 : d > length ? length : d;
    let i = hint;
    if (i >= m - 1) i = m - 2;
    while (i > 0 && cum[i] > d) i--;
    while (i < m - 2 && cum[i + 1] < d) i++;
    hint = i;
    const a = out[i];
    const b = out[i + 1];
    const seg = cum[i + 1] - cum[i];
    const f = seg > 1e-9 ? (d - cum[i]) / seg : 0;
    o.x = a[0] + (b[0] - a[0]) * f;
    o.z = a[1] + (b[1] - a[1]) * f;
    o.y = a[2] + (b[2] - a[2]) * f;
    o.h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return o;
  }

  /** Odległość po ścieżce punktu najbliższego (x, z). */
  function nearest(x, z) {
    let best = Infinity;
    let bd = 0;
    for (let i = 0; i < m - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz;
      let f = l2 > 1e-12 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const px = a[0] + dx * f;
      const pz = a[1] + dz * f;
      const q = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (q < best) { best = q; bd = cum[i] + (cum[i + 1] - cum[i]) * f; }
    }
    return bd;
  }

  return { length, closed, at, nearest, points: out };
}

/** Odległość do przodu po pętli: z `from` do `to` (0…length). */
export function loopAhead(from, to, length) {
  return (((to - from) % length) + length) % length;
}
