// DZIELNICE RINGU — zestaw wspólny, TWORZYWO: rejestrator brył RUCHOMYCH procesu (czyste dane, bez three).
//
// Zestaw budowli portowych rysuje bryły stałe (i do 63 grup ruchomych na budowlę), ale nie zmienia barwy ani żaru
// w biegu. Proces produkcji potrzebuje tysięcy drobnych rzeczy, które jadą, spadają, rosną i stygną: bryłki rudy,
// kopce, ciekły metal, kęsiska stygnące od białego żaru, kręgi, ładunek na naczepach, ciężarówki. Wtyczka dzielnicy
// zapisuje je co klatkę przez `api.tworzywo` (ten rejestrator), gospodarz rysuje partią (kit/tworzywo3d.js).
//
// Układ jak w budowlach: x, z — układ dzielnicy, y — wysokość K-7 (płaszczyzna lotu y = 116; nad nią ×0,42).
// Instancja (TW_STRIDE = 16): środek xyz, skala pionowa | rozmiar xyz, żar | kwaternion | barwa rgb, tryb.
// Tryb: 0 — mat (ruda, kopiec), 1 — metal (połysk), 2 — lampa (świeci barwą × żar). Żar 0…1 w trybach 0 i 1 to
// żar ciała: ciemna czerwień → pomarańcz → biało-żółty (HDR, zbiera go bloom).
import { K7_ABOVE_SCALE, k7HeightToZ } from '../../../src/3d/haloRing/haloPortK7Layout.js';

export const TW_STRIDE = 16;
export const TW_SHAPES = Object.freeze(['box', 'cyl', 'cone']);
export const TW_SETS = Object.freeze(['bg', 'fg']);
export const TW_MODE = Object.freeze({ mat: 0, metal: 1, lamp: 2 });
const SQ = Math.SQRT1_2;
void K7_ABOVE_SCALE;

export class TworzywoRecorder {
  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.data = {};
    this.count = {};
    for (const set of TW_SETS) for (const shape of TW_SHAPES) { this.data[`${set}_${shape}`] = new Float32Array(capacity * TW_STRIDE); this.count[`${set}_${shape}`] = 0; }
    this.dropped = 0;
  }

  begin() { for (const k in this.count) this.count[k] = 0; }

  total() { let n = 0; for (const k in this.count) n += this.count[k]; return n; }

  _put(key, cx, cy, cz, vs, sx, sy, sz, qx, qy, qz, qw, col, heat, mode) {
    const n = this.count[key];
    if (n >= this.capacity) { this.dropped++; return; }
    const a = this.data[key];
    const o = n * TW_STRIDE;
    a[o] = cx; a[o + 1] = cy; a[o + 2] = cz; a[o + 3] = vs;
    a[o + 4] = sx; a[o + 5] = sy; a[o + 6] = sz; a[o + 7] = heat;
    a[o + 8] = qx; a[o + 9] = qy; a[o + 10] = qz; a[o + 11] = qw;
    a[o + 12] = col[0]; a[o + 13] = col[1]; a[o + 14] = col[2]; a[o + 15] = mode;
    this.count[key] = n + 1;
  }

  /** Prostopadłościan: środek (x, y, z), `len` wzdłuż kursu `heading` (kąt od +x ku +z), `h` w pionie, `wid` w poprzek. */
  box(set, x, y, z, len, h, wid, heading, col, heat = 0, mode = 0) {
    const z0 = k7HeightToZ(y - h / 2);
    const z1 = k7HeightToZ(y + h / 2);
    const a = -heading / 2;
    this._put(`${set}_box`, x, (z0 + z1) / 2, z, 1, len, Math.max(0.5, z1 - z0), wid, 0, Math.sin(a), 0, Math.cos(a), col, heat, mode);
  }

  /** Walec o osi pionowej: środek (x, y, z), promień r, wysokość h. */
  cyl(set, x, y, z, r, h, col, heat = 0, mode = 0) {
    const z0 = k7HeightToZ(y - h / 2);
    const z1 = k7HeightToZ(y + h / 2);
    this._put(`${set}_cyl`, x, (z0 + z1) / 2, z, 1, r, Math.max(0.5, z1 - z0), r, 0, 0, 0, 1, col, heat, mode);
  }

  /** Walec leżący (krąg, rolka, rura): oś wzdłuż kursu `heading`, promień r, długość `len`. */
  roll(set, x, y, z, r, len, heading, col, heat = 0, mode = 0) {
    const a = -heading / 2;
    const sy = Math.sin(a);
    const cy = Math.cos(a);
    const vs = (k7HeightToZ(y + r) - k7HeightToZ(y - r)) / (2 * r);
    this._put(`${set}_cyl`, x, k7HeightToZ(y), z, vs, r, len, r, sy * SQ, sy * SQ, cy * SQ, cy * SQ, col, heat, mode);
  }

  /** Stożek (kopiec): środek bryły (x, y, z), promień podstawy r, wysokość h, szpic w górę. */
  cone(set, x, y, z, r, h, col, heat = 0, mode = 0) {
    const z0 = k7HeightToZ(y - h / 2);
    const z1 = k7HeightToZ(y + h / 2);
    this._put(`${set}_cone`, x, (z0 + z1) / 2, z, 1, r, Math.max(0.5, z1 - z0), r, 0, 0, 0, 1, col, heat, mode);
  }
}
