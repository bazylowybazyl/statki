// src/game/asteroidShapeRadius.js
//
// PROMIEŃ KSZTAŁTÓW SKAŁ (CPU, bez three) — mapy promienia banku kształtów (odczyt z GPU po
// pieczeniu: rockBank.js `setRadiusMapsFromBytes`) i zapytanie `radiusAt` dla fizyki skał
// (asteroidMining.js — masa, ruda, raycast, zderzenia ciał) i minerałów renderu. Jedno źródło
// arytmetyki dla obu stron szwu gra ↔ render (RW-25, docs/PLAN-render-worker.md): render piecze
// bank i oddaje grze same mapy (zdarzenie `bankRadius` — w trybie `inline` te same tablice,
// w workerze kopia przez postMessage), gra buduje z nich `ShapeRadius`.

// Mapowanie oktaedryczne (CPU) — kopia z rockShapes3D.js (rockBank.js re-eksportuje).
export function octEncodeCpu(x, y, z, out = { u: 0, v: 0 }) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let px = x / s;
  let py = y / s;
  if (z / s < 0) {
    const ox = px;
    px = (1 - Math.abs(py)) * (ox >= 0 ? 1 : -1);
    py = (1 - Math.abs(ox)) * (py >= 0 ? 1 : -1);
  }
  out.u = px * 0.5 + 0.5;
  out.v = py * 0.5 + 0.5;
  return out;
}

const _oct = { u: 0, v: 0 };

/**
 * Promień kształtu `shape` w kierunku (x, y, z) z mapy odczytu R × R (po normalizacji;
 * dwuliniowo). Brak mapy = 1.
 * @param {ArrayLike<Float32Array>|null} maps mapy promienia kształtów banku
 * @param {number} R bok mapy (readbackSize banku)
 */
export function shapeRadiusAt(maps, R, shape, x, y, z) {
  const map = maps && maps[shape];
  if (!map) return 1;
  const o = octEncodeCpu(x, y, z, _oct);
  const fx = o.u * (R - 1);
  const fy = o.v * (R - 1);
  const x0 = Math.min(R - 2, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(R - 2, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const a = map[y0 * R + x0];
  const b = map[y0 * R + x0 + 1];
  const c = map[(y0 + 1) * R + x0];
  const d = map[(y0 + 1) * R + x0 + 1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

/** Mapy promienia banku po stronie gry (zdarzenie `bankRadius`). */
export class ShapeRadius {
  /** @param {{ maps: ArrayLike<Float32Array>, size: number }} data */
  constructor({ maps, size }) {
    this.maps = maps;
    this.size = size;
    this.radiusAt = (shape, x, y, z) => shapeRadiusAt(this.maps, this.size, shape, x, y, z);
  }
}
