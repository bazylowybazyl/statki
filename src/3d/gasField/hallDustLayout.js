// src/3d/gasField/hallDustLayout.js
//
// PYŁ W HALACH K-7 (etap 1 gazów w grze, wymagania użytkownika 2026-10-07) — część CZYSTA: bez three,
// DOM i Core3D (testy node). Wspólna dla strony gry (wybór hali i pakowanie wejścia klatki —
// src/game/hallDustInput.js) i renderu (krok efektów — hallDust.js).
//
// Układ hali (createK7Layout): x w poprzek (±halfWidth), z w głąb — od ściany tylnej (backZ) do bramy
// G-01 (frontZ). DOMENA symulacji = obrys hali z zapasem przy ścianach i pasem PRÓŻNI za bramą (pył
// wydmuchany z hali rozwiewa się tam i gaśnie). Komórka h [j.] stała, wymiary siatki to wielokrotności
// 8 (liczba komórek dzieli się przez 64 — rozmiar grupy roboczej compute).
//
// RASTR komórek (RGBA8; wiersz = z, kolumna = x — jak tekstury symulacji):
//   R — przeszkoda (ściany z bramami, przypory, rdzeń operacyjny, ładunki, słupki — k7SolidList, te same
//       bryły co kolizje hali): gaz ich nie przenika (rzut ciśnienia), pyłu w nich nie ma;
//   G — pył zalegający na pokładzie na starcie (szum wartości; więcej przy ścianach i w kątach);
//   B — wnętrze hali (1) / próżnia za bramami (0);
//   A — odległość od przeszkody [komórki × 4, do 255].
import { createK7Layout, k7SolidList } from '../haloRing/haloPortK7Layout.js';

export const HALL_DUST_MAX_SHIPS = 16;
/** Stanowiska capital hali w bloku obsługi (kolejność createK7Layout: C-01…C-04). */
export const HALL_DUST_SERVICE_BERTHS = 4;
/**
 * Pola stanowiska w bloku obsługi: rygiel złączy, ramię paliwowe nad wlewem, przepływ, upust, zajęte (0 / 1),
 * wysięgnik ze złączką na wlewie (haloPortK7Layout.K7_SERVICE_KEYS).
 */
export const HALL_DUST_SERVICE = Object.freeze({ lock: 0, extension: 1, flow: 2, vent: 3, occupied: 4, seat: 5, stride: 6 });

/**
 * Maska OBRYSU kadłuba w rekordzie okrętu (src/game/hullFootprint.js — z żywych węzłów siatki belek): w × h
 * teksli w układzie kadłuba, bit k = wiersz (Y) · w + kolumna (X), słowa 32-bitowe (w double dokładne).
 * Brzeg maski (1 teksel z każdej strony) jest pusty — próbka liniowa obcięta do brzegu nie wycieka.
 */
export const HALL_DUST_MASK = Object.freeze({ w: 64, h: 32, words: 64 });

/**
 * Rekord okrętu w wejściu klatki (od HALL_DUST_IN.header co HALL_DUST_IN.stride). Układ KADŁUBA = układ ciała
 * silnika belek względem kotwicy encji (X ku dziobowi obrazu, Y w górę obrazu) — w nim leży maska obrysu.
 * Kadłub rozcina gaz kształtem okrętu (zgłoszenie użytkownika 2026-10-07: dawniej obrócone pudło).
 */
export const HALL_DUST_SHIP = Object.freeze({
  cx: 0, cz: 1,      // kotwica kadłuba [j. hali]
  ex: 2, ez: 3,      // oś X kadłuba w układzie hali (jednostkowa)
  fx: 4, fz: 5,      // oś Y kadłuba w układzie hali (jednostkowa)
  x0: 6, y0: 7,      // róg maski w układzie kadłuba [j.]
  tx: 8, ty: 9,      // bok teksla maski [j.]
  vx: 10, vz: 11,    // prędkość kotwicy [j/s w układzie hali]
  w: 12,             // prędkość kątowa [rad/s, w orientacji hali]
  reach: 13,         // najdalszy róg maski od kotwicy [j.]
  mask: 16,          // HALL_DUST_MASK.words słów maski
  stride: 16 + HALL_DUST_MASK.words
});

/**
 * Układ tablicy WEJŚCIA KLATKI (Float64Array, pisze src/game/hallDustInput.js po stronie gry, czyta krok
 * efektów hallDust.js) — stały, bez referencji do encji. Okręty — rekordy HALL_DUST_SHIP. Blok obsługi
 * (od `service`): pozy przewodów paliwowych stanowisk capital (HALL_DUST_SERVICE) — z nich źródła gazu.
 */
export const HALL_DUST_IN = Object.freeze({
  serial: 0,     // numer klatki gry (rośnie przy każdym pakowaniu)
  dt: 1,         // krok czasu gry [s] (pauza, sceny fabuły = 0)
  active: 2,     // 1 = kamera przy hali (jest co liczyć), 0 = symulacja stoi
  hall: 3,       // klucz hali (pierścień · 16 + numer hali + 1; 0 = brak) — zmiana = czyszczenie stanu
  p0x: 4, p0y: 5, ax: 6, ay: 7, bx: 8, by: 9,   // hala (x, z) → gra: p0 + x·a + z·b (double)
  sunX: 10, sunY: 11,                          // kierunek do Słońca w układzie hali (0, 0 = brak)
  ships: 12,     // liczba okrętów w tablicy
  viewHalf: 13,  // pół przekątnej kadru [j.] (zanik obrazu przy oddaleniu)
  clock: 14,     // zegar migania świateł hali [s] (k7BeaconClock — ten sam co w shaderze hali)
  lamps: 15,     // poziom lamp hali (uHallLights.x: dzień 0,22 … noc 0,72)
  header: 16,
  stride: HALL_DUST_SHIP.stride,
  service: 16 + HALL_DUST_SHIP.stride * HALL_DUST_MAX_SHIPS,
  size: 16 + HALL_DUST_SHIP.stride * HALL_DUST_MAX_SHIPS + HALL_DUST_SERVICE_BERTHS * HALL_DUST_SERVICE.stride
});

/**
 * Uniformy kadłuba `s` dla pola gazu (gasField2D: bodyA, bodyB, bodyC — 12 liczb od `o`): kotwica [komórki
 * domeny], macierz K i przesunięcie (komórki względem kotwicy → teksle maski: q = K · rel + off), prędkość
 * [komórki/s], prędkość kątowa [rad/s]. Jedno źródło dla kroku efektów i lustra CPU (hallBodySolidCpu).
 */
export function hallBodyUniforms(IN, s, dom, out, o = 0) {
  const S = HALL_DUST_SHIP;
  const b = HALL_DUST_IN.header + s * HALL_DUST_IN.stride;
  const h = dom.h;
  const ex = IN[b + S.ex], ez = IN[b + S.ez], fx = IN[b + S.fx], fz = IN[b + S.fz];
  const det = ex * fz - fx * ez;
  const id = Math.abs(det) > 1e-12 ? 1 / det : 0;
  const tx = IN[b + S.tx] > 0 ? IN[b + S.tx] : 1;
  const ty = IN[b + S.ty] > 0 ? IN[b + S.ty] : 1;
  const kx = (h / tx) * id, ky = (h / ty) * id;
  // hala = [e f] · kadłub → kadłub = [e f]⁻¹ · hala; teksel = (kadłub − róg) / bok teksla
  out[o] = (IN[b + S.cx] - dom.x0) / h;
  out[o + 1] = (IN[b + S.cz] - dom.z0) / h;
  out[o + 2] = fz * kx;
  out[o + 3] = -fx * kx;
  out[o + 4] = -ez * ky;
  out[o + 5] = ex * ky;
  out[o + 6] = -IN[b + S.x0] / tx;
  out[o + 7] = -IN[b + S.y0] / ty;
  out[o + 8] = IN[b + S.vx] / h;
  out[o + 9] = IN[b + S.vz] / h;
  out[o + 10] = IN[b + S.w];
  out[o + 11] = 0;
  return out;
}

/** Bit maski obrysu okrętu `s` (i — kolumna X, j — wiersz Y, obcięte do maski). */
export function hallMaskBit(IN, s, i, j) {
  const M = HALL_DUST_MASK;
  const ci = i < 0 ? 0 : i > M.w - 1 ? M.w - 1 : i;
  const cj = j < 0 ? 0 : j > M.h - 1 ? M.h - 1 : j;
  const k = cj * M.w + ci;
  const word = IN[HALL_DUST_IN.header + s * HALL_DUST_IN.stride + HALL_DUST_SHIP.mask + (k >>> 5)];
  return (word >>> (k & 31)) & 1;
}

const _bu = new Float64Array(12);

/**
 * LUSTRO CPU testu kadłuba w kernelu adwekcji (gasField2D.js): czy punkt (px, py) [komórki domeny] jest komórką
 * stałą okrętu `s` — maska próbkowana liniowo (jak tekstura masek z filtrem liniowym, obcięta do pasma okrętu),
 * próg 0,5. Zmiana testu w kernelu = zmiana tutaj (tests/hallDust.test.mjs).
 */
export function hallBodySolidCpu(IN, s, dom, px, py) {
  const M = HALL_DUST_MASK;
  const U = hallBodyUniforms(IN, s, dom, _bu);
  const rx = px - U[0], ry = py - U[1];
  const qx = U[2] * rx + U[3] * ry + U[6];
  const qy = U[4] * rx + U[5] * ry + U[7];
  if (!(qx > 0 && qx < M.w && qy > 0 && qy < M.h)) return false;
  const u = Math.min(M.w - 0.5, Math.max(0.5, qx)) - 0.5;
  const v = Math.min(M.h - 0.5, Math.max(0.5, qy)) - 0.5;
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const fu = u - i0, fv = v - j0;
  const a = hallMaskBit(IN, s, i0, j0) * (1 - fu) + hallMaskBit(IN, s, i0 + 1, j0) * fu;
  const c = hallMaskBit(IN, s, i0, j0 + 1) * (1 - fu) + hallMaskBit(IN, s, i0 + 1, j0 + 1) * fu;
  return a * (1 - fv) + c * fv > 0.5;
}

export const HALL_DUST_GRID = Object.freeze({
  cell: 28,       // bok komórki [j.]: Atlas 1800 × 806 = 64 × 29 komórek, ściana 88 j. = 3 komórki
  margin: 320,    // zapas domeny za ścianami bocznymi i tylną [j.]
  vacuum: 1700    // pas próżni za bramą G-01 [j.]
});

/** Domena symulacji w układzie hali: komórka h, wymiary siatki nx × ny, róg (x0, z0), rozmiar w × d [j.]. */
export function hallDustDomain(layout = createK7Layout(), grid = HALL_DUST_GRID) {
  const h = grid.cell;
  const xMin = -layout.halfWidth - grid.margin;
  const xMax = layout.halfWidth + grid.margin;
  const zMin = layout.backZ - layout.wallThickness * 0.5 - grid.margin;
  const zMax = layout.frontZ + grid.vacuum;
  const nx = Math.ceil((xMax - xMin) / h / 8) * 8;
  const ny = Math.ceil((zMax - zMin) / h / 8) * 8;
  const w = nx * h;
  const d = ny * h;
  const x0 = (xMin + xMax) * 0.5 - w * 0.5;
  const z0 = zMin;
  return Object.freeze({ h, nx, ny, x0, z0, w, d, x1: x0 + w, z1: z0 + d });
}

/** Odległość punktu hali (x, z) od prostokąta domeny [j.] (0 w środku). */
export function hallDomainDistance(dom, x, z) {
  const dx = x < dom.x0 ? dom.x0 - x : (x > dom.x1 ? x - dom.x1 : 0);
  const dz = z < dom.z0 ? dom.z0 - z : (z > dom.z1 ? z - dom.z1 : 0);
  return Math.sqrt(dx * dx + dz * dz);
}

function insidePolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 131);
    norm += amp;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Rastr komórek domeny (RGBA8, nagłówek pliku). Deterministyczny (szum z haszu, bez Math.random).
 * @returns {{ data: Uint8Array, solid: number, inside: number, nx: number, ny: number }}
 */
export function rasterizeHallCells(layout = createK7Layout(), dom = hallDustDomain(layout), { seed = 0x5eed7 } = {}) {
  const { nx, ny, h, x0, z0 } = dom;
  const n = nx * ny;
  const solid = new Uint8Array(n);
  const clampI = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  for (const s of k7SolidList(layout)) {
    // pudło: środek (x, z), w wzdłuż kąta, d w poprzek (jak K7CollisionWorld.addBox)
    const ca = Math.cos(s.angle || 0);
    const sa = Math.sin(s.angle || 0);
    const hw = s.w * 0.5;
    const hd = s.d * 0.5;
    const r = Math.hypot(hw, hd);
    const i0 = clampI(Math.floor((s.x - r - x0) / h), nx - 1);
    const i1 = clampI(Math.ceil((s.x + r - x0) / h), nx - 1);
    const j0 = clampI(Math.floor((s.z - r - z0) / h), ny - 1);
    const j1 = clampI(Math.ceil((s.z + r - z0) / h), ny - 1);
    for (let j = j0; j <= j1; j++) {
      const cz = z0 + (j + 0.5) * h - s.z;
      for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * h - s.x;
        const u = cx * ca + cz * sa;
        const v = -cx * sa + cz * ca;
        if (Math.abs(u) <= hw && Math.abs(v) <= hd) solid[j * nx + i] = 1;
      }
    }
  }
  // Odległość od przeszkody (fazowana 1 / √2, dwa przebiegi) [komórki].
  const dist = new Float32Array(n);
  const BIG = 1e6;
  for (let k = 0; k < n; k++) dist[k] = solid[k] ? 0 : BIG;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + D1);
      if (j > 0) {
        d = Math.min(d, dist[k - nx] + D1);
        if (i > 0) d = Math.min(d, dist[k - nx - 1] + D2);
        if (i < nx - 1) d = Math.min(d, dist[k - nx + 1] + D2);
      }
      dist[k] = d;
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let d = dist[k];
      if (i < nx - 1) d = Math.min(d, dist[k + 1] + D1);
      if (j < ny - 1) {
        d = Math.min(d, dist[k + nx] + D1);
        if (i < nx - 1) d = Math.min(d, dist[k + nx + 1] + D2);
        if (i > 0) d = Math.min(d, dist[k + nx - 1] + D2);
      }
      dist[k] = d;
    }
  }
  const data = new Uint8Array(n * 4);
  const poly = layout.footprint;
  let solidN = 0;
  let insideN = 0;
  for (let j = 0; j < ny; j++) {
    const z = z0 + (j + 0.5) * h;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + (i + 0.5) * h;
      const isSolid = solid[k] === 1;
      const inside = !isSolid && insidePolygon(poly, x, z);
      let dirt = 0;
      if (inside) {
        // kłęby kurzu (fBm ~900 j.) × drobny szum; przy ścianach i w kątach go przybywa (sprzątanie nie sięga)
        const big = fbm(x / 900, z / 900, seed);
        const fine = valueNoise(x / 260, z / 260, seed + 7);
        const near = Math.exp(-(dist[k] * h) / 520);
        const s = big * big * (3 - 2 * big);
        dirt = clamp01((0.22 + 0.78 * s) * (0.5 + 0.5 * near) * (0.75 + 0.5 * fine));
        insideN++;
      }
      if (isSolid) solidN++;
      const o = k * 4;
      data[o] = isSolid ? 255 : 0;
      data[o + 1] = Math.round(dirt * 255);
      data[o + 2] = inside ? 255 : 0;
      data[o + 3] = Math.min(255, Math.round(dist[k] * 4));
    }
  }
  return { data, solid: solidN, inside: insideN, nx, ny };
}
