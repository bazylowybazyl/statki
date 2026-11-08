// ============================================================
// Fala floty przylatującej tunelem, front odwetu piratów i test odcinka przeciw bryłom budowli. Czysta geometria
// (świat gry, y w dół). Układ i plan bazy piratów: pirateBaseSite.js.
// ============================================================

export const SHIPYARD_TUNE = Object.freeze({
  // Front odwetu piratów od gracza: piraci formują szyk 2–5 km bliżej (pomiar: 6–9 km od gracza) — poza
  // zasięgiem swoich armat (3,5 km), w zasięgu rakiet i baterii Atlasa (Tempest L 6 km, Yamato 7 km).
  // 2026-10-07: 18 → 11 km po skróceniu zasięgów broni — przy 18 km piraci stali ~13 km od gracza przez
  // ~25 s ciszy (scripts/webgpu/zasiegi-gra.mjs).
  counterDistance: 11000
});

function pointInPts(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Pierwsze wejście odcinka (x0, y0) → (x1, y1) w bryły budowli (placePirateBase().hitShapes):
 * { t (0..1), x, y, chunk } albo null. Początek w bryle = trafienie w t = 0. Bez alokacji (out).
 * skip — zbiór kawałków, których już nie ma (odpadły, staranowane; `has(id)`) — pocisk przelatuje.
 */
export function dryDockSegmentHit(shapes, x0, y0, x1, y1, out = {}, skip = null) {
  const minX = x0 < x1 ? x0 : x1;
  const maxX = x0 < x1 ? x1 : x0;
  const minY = y0 < y1 ? y0 : y1;
  const maxY = y0 < y1 ? y1 : y0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let bestT = Infinity;
  let best = null;
  for (let s = 0; s < shapes.length; s++) {
    const sh = shapes[s];
    if (maxX < sh.x0 || minX > sh.x1 || maxY < sh.y0 || minY > sh.y1) continue;
    if (skip && skip.size && skip.has(sh.chunk)) continue;
    const pts = sh.pts;
    if (pointInPts(pts, x0, y0)) {
      if (0 < bestT) { bestT = 0; best = sh; }
      continue;
    }
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j].x;
      const ay = pts[j].y;
      const ex = pts[i].x - ax;
      const ey = pts[i].y - ay;
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const qx = ax - x0;
      const qy = ay - y0;
      const t = (qx * ey - qy * ex) / den;
      const u = (qx * dy - qy * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = sh; }
    }
  }
  if (!best) return null;
  out.t = bestT;
  out.x = x0 + dx * bestT;
  out.y = y0 + dy * bestT;
  out.chunk = best.chunk;
  return out;
}

/**
 * Szyk floty przylatującej tunelem: `counts` { battleship, destroyer, frigate }, front prostopadły do `facing`
 * (kurs floty), środek frontu w `center`. Okręty flagowe w pierwszym rzędzie, niszczyciele za nimi, fregaty
 * po skrzydłach i z tyłu. Zwraca [{ key, x, y, angle }] (kolejność: od najmniejszych — ostatni przylatuje flagowiec).
 */
export function planFleetWave(center, facing, counts, opts = {}) {
  const ux = Math.cos(facing), uy = Math.sin(facing);
  const nx = -uy, ny = ux;
  const out = [];
  const row = (keys, depth, spacing) => {
    const n = keys.length;
    for (let i = 0; i < n; i++) {
      const lat = (i - (n - 1) / 2) * spacing;
      out.push({ key: keys[i], x: center.x - ux * depth + nx * lat, y: center.y - uy * depth + ny * lat, angle: facing });
    }
  };
  const bs = Array(Math.max(0, counts.battleship | 0)).fill(opts.battleshipKey || 'battleship');
  const dd = Array(Math.max(0, counts.destroyer | 0)).fill(opts.destroyerKey || 'destroyer');
  const ffKeys = opts.frigateKeys || ['frigate_pd', 'frigate_laser'];
  const ff = Array.from({ length: Math.max(0, counts.frigate | 0) }, (_, i) => ffKeys[i % ffKeys.length]);
  // Kolejność przylotu: fregaty, niszczyciele, pancerniki (flagowce na końcu — jak planFleetArrival).
  row(ff, 2600, 700);
  row(dd, 1400, 1100);
  row(bs, 0, 1700);
  return out;
}
