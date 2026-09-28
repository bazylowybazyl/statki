// src/game/asteroidMining.js
//
// FIZYKA WYDOBYCIA SKAŁ: kopanie laserem drona, cięcie piłą, wysadzanie
// ładunkiem, rozpad na odłamy i ich zbieranie. Bez three i DOM-u — gra i demo
// (dema/asteroidy-webgpu) wołają ten sam moduł; render czyta z ciał siatki
// komórek (zapełnienie, ruda) i ich położenie.
//
// Model (prośba użytkownika 2026-09-27: „ciąć, wykopywać, dostać się do rdzenia,
// wysadzić rdzeń i łapać odłamki; skały inne niż stal — kruche jak lód albo
// mocne jak tytan; jedne potrzebują mniejszego ładunku, inne większego”):
//
//  • Skała do wydobycia to SIATKA KOMÓREK w jej własnym układzie (układ obiektu
//    skały z banku kształtów × promień, z rozciągnięciem — ten sam, w którym
//    materiał skał liczy vRockObjP). Komórka ma zapełnienie (0 … 1, gładki brzeg:
//    powierzchnia = poziom 0,5), udział rudy (skład warstw: skorupa → płaszcz →
//    rdzeń + żyły) i trzy wiązania do sąsiadów +x, +y, +z (bit = zerwane).
//  • Kopanie zdejmuje OBJĘTOŚĆ (j.³/s ∝ moc / twardość) z komórek w zasięgu
//    wiązki; zdjęta masa × udział rudy = urobek (tony rudy, reszta to skała
//    płonna). Z wierzchu mało rudy, w rdzeniu prawie czysta.
//  • Ładunek: strefa zmiażdżenia (pył, przepada) i strefa spękań o zasięgu
//    zależnym od energii, odporności i kruchości (asteroidMaterials.chargeReach).
//    Strefa, która nie sięga powierzchni = ładunek za słaby: w środku zostaje
//    pustka, skała słabnie (następny ładunek sięga dalej). Przebicie: strefa
//    dzieli się na bryły Voronoi (drobne przy ładunku i w kruchym materiale,
//    duże dalej i w twardym), wiązania między bryłami pękają, na brzegu strefy
//    tylko z szansą = kruchość (tytan zostaje z pękniętym kraterem, lód odpada).
//    Składowe spójne → nowe ciała (odłamy), małe → okruchy, najmniejsze → pył.
//    Odłamy lecą od ładunku (zasłonięte przez resztę skały — w stronę wylotu).
//  • Ruch: ciało sztywne 6DoF (środek masy, kwaternion układu skały, prędkości),
//    lekkie tłumienie; skały leżą pod płaszczyzną gry (wierzch ≤ layerTop).
//    Zderzenia odłamów: punkty powierzchni jednego ciała w polu zapełnienia
//    drugiego (po czasie `graceTime` od rozpadu).
//  • Zbieranie: wiązka ściągająca ciągnie odłamy i okruchy lżejsze niż jej
//    udźwig; złapane oddają rudę (tony surowca gry) i skałę płonną.
//
// UKŁAD: przestrzeń skał = układ sceny BEZ przesunięcia początku: X = x świata
// gry, Y = −y, Z = z (w górę, do kamery). Kwaterniony skał pola (qx..qw, oś
// obrotu, faza) działają w tym układzie tak jak w shaderze skał.
//
// API: `new AsteroidMining({ radiusAt })`, `activate(rock, { z, time })`,
// `raycast`, `laser`, `slice`, `detonate`, `tractor`, `step(dt)`, `probe`,
// `summary`; `bodies` / `pebbles` do renderu (body.version rośnie przy zmianie
// siatki). Stałe i materiały: asteroidMaterials.js. Testy:
// tests/asteroidMining.test.mjs.

import { hash32, mulberry32 } from './asteroidBeltField.js';
import { ROCK_TYPES, ROCK_TYPE_INDEX } from './asteroidRockKinds.js';
import { MINING_CONFIG, rockMaterial, oreResourceOf, HIDDEN_CORE_TYPES } from './asteroidMaterials.js';

// ---------------------------------------------------------------------------
// Matematyka (kwaterniony [x, y, z, w])

export function quatMul(a, b, out = [0, 0, 0, 1]) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** v' = q v q* */
export function quatRotate(q, x, y, z, out) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** v' = q* v q */
export function quatRotateInv(q, x, y, z, out) {
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

// Math.hypot alokuje w V8 (~30–40 B na wywołanie) — w krokach symulacji sqrt.
function quatNormalize(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  return q;
}

/** q += ½ (ω, 0) q dt — ω w układzie świata. */
function quatIntegrate(q, wx, wy, wz, dt) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const h = 0.5 * dt;
  q[0] = qx + h * (wx * qw + wy * qz - wz * qy);
  q[1] = qy + h * (wy * qw + wz * qx - wx * qz);
  q[2] = qz + h * (wz * qw + wx * qy - wy * qx);
  q[3] = qw - h * (wx * qx + wy * qy + wz * qz);
  return quatNormalize(q);
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash01(a, b = 0, c = 0, d = 0) {
  return hash32(a, b, c, d) / 4294967296;
}

// Szum wartości 3D (żyły rudy) — okresowy nie musi być, liczony raz przy budowie.
function vnoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (dx, dy, dz) => hash32(seed, ix + dx + 4096, iy + dy + 4096, iz + dz + 4096) / 4294967296;
  const a = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * ux;
  const b = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * ux;
  const c = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * ux;
  const d = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * ux;
  const e = a + (b - a) * uy;
  const f = c + (d - c) * uy;
  return e + (f - e) * uz;
}

// Kierunki próbkowania (Fibonacci) do obrysu skały i głębokości pod powierzchnią.
function fibonacciDirs(n) {
  const out = new Float64Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const a = i * ga;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = Math.sin(a) * r;
    out[i * 3 + 2] = z;
  }
  return out;
}
const DIRS_EXTENT = fibonacciDirs(1200);
const DIRS_DEPTH = fibonacciDirs(48);

// ---------------------------------------------------------------------------
// Urobek

/** Pusty licznik urobku: { ore: { [surowiec]: t }, waste: t, lost: t }. */
export function createYield() {
  return { ore: Object.create(null), waste: 0, lost: 0 };
}

function addYield(out, res, oreT, wasteT, lostT = 0) {
  if (!out) return;
  if (oreT > 0 && res) out.ore[res] = (out.ore[res] || 0) + oreT;
  else if (oreT > 0) wasteT += oreT;
  out.waste += wasteT;
  out.lost += lostT;
}

/** Suma rudy w urobku (wszystkie surowce) [t]. */
export function yieldOreTotal(y) {
  let s = 0;
  for (const k in y.ore) s += y.ore[k];
  return s;
}

// ---------------------------------------------------------------------------
// Ciało skały

let _bodyIds = 1000000;

export class RockBody {
  constructor(o) {
    this.id = o.id ?? _bodyIds++;
    this.sourceId = o.sourceId ?? 0;
    this.generation = o.generation ?? 0;
    this.parentId = o.parentId ?? 0;
    // Wygląd (materiał skał): typ, kształt z banku, ziarno, rozciągnięcie, promień.
    this.type = o.type;
    this.typeId = ROCK_TYPES[o.type] || 'rock';
    this.material = o.material || rockMaterial(o.type);
    this.oreTypeId = o.oreTypeId ?? null;
    this.oreRes = oreResourceOf(this.oreTypeId);
    this.shape = o.shape ?? 0;
    this.seed = o.seed ?? 0;
    this.r = o.r;
    this.sx = o.sx ?? 1; this.sy = o.sy ?? 1; this.sz = o.sz ?? 1;
    this.sunT = o.sunT ?? 1;
    // Siatka (układ skały).
    this.cs = o.cs;
    this.nx = o.nx; this.ny = o.ny; this.nz = o.nz;
    this.gx = o.gx; this.gy = o.gy; this.gz = o.gz;
    const n = this.nx * this.ny * this.nz;
    this.fill = o.fill || new Float32Array(n);
    this.ore = o.ore || new Uint8Array(n);
    this.bonds = o.bonds || new Uint8Array(n);
    // Zapełnienie z chwili przejęcia skały (×255): render odróżnia wyciętą ścianę
    // (orig > fill) od pierwotnej powierzchni skały.
    this.orig = o.orig || new Uint8Array(n);
    // Rdzeń (układ skały): środek i promienie stref — do skanera.
    this.core = o.core || null;
    // Ciało sztywne (przestrzeń skał): środek masy, prędkość, układ skały, obrót.
    this.p = [0, 0, 0];
    this.v = [0, 0, 0];
    this.q = o.q ? o.q.slice() : [0, 0, 0, 1];
    this.w = o.w ? o.w.slice() : [0, 0, 0];
    this.com = [0, 0, 0];
    this.mass = 0;
    this.oreMass = 0;
    this.inertia = new Float64Array(9);
    this.boundR = 0;
    this.solidCells = 0;
    this.cellMass = this.cs * this.cs * this.cs * this.material.density * (o.tonnesPerVolume ?? MINING_CONFIG.tonnesPerVolume);
    // Stan.
    this.version = 1;
    this.massDirty = true;
    this.splitDirty = false;
    this.removedSinceCheck = 0;
    this.damage = o.damage ?? 0;
    this.age = 0;
    this.grace = 0;
    this.surfacePts = null;
    this.alive = true;
    this.anchored = !!o.anchored;
    // Uśpienie (MINING_CONFIG.sleep*): czas w spoczynku i stan.
    this.sleep = 0;
    this.asleep = false;
    this._lastSplitAt = -1e9;
    this._massAt = -1e9;
    // Ostatni punkt kopania (układ skały) i czas systemu — żar świeżego cięcia.
    this.hot = [0, 0, 0, -1e9];
    // Licznik urobku ostatniego kopania (drobinki odłupane laserem trafiają tam).
    this.digOut = null;
    this.dirtyBox = null;
    this._dirtyArr = null;
    this.userData = null;
  }

  index(i, j, k) { return i + this.nx * (j + this.ny * k); }

  /** Zapełnienie (trójliniowo) w punkcie układu skały; poza siatką 0. */
  // Zwarta forma (bajtkod < 460 B — V8 wkleja ją w raycast i gradient; większa zwracała
  // liczbę przez stertę przy każdej próbce marszu promienia lasera).
  sample(lx, ly, lz) {
    const cs = this.cs;
    const fx = (lx - this.gx) / cs, fy = (ly - this.gy) / cs, fz = (lz - this.gz) / cs;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    const nx = this.nx, ny = this.ny;
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx - 1 || j0 >= ny - 1 || k0 >= this.nz - 1) return 0;
    const tx = fx - i0, ty = fy - j0;
    const f = this.fill, sz = nx * ny;
    const b = i0 + nx * j0 + sz * k0, c = b + nx;
    const c0 = f[b] + (f[b + 1] - f[b]) * tx;
    const c1 = c0 + (f[c] + (f[c + 1] - f[c]) * tx - c0) * ty;
    const d0 = f[b + sz] + (f[b + sz + 1] - f[b + sz]) * tx;
    const d1 = d0 + (f[c + sz] + (f[c + sz + 1] - f[c + sz]) * tx - d0) * ty;
    return c1 + (d1 - c1) * (fz - k0);
  }

  /** Udział rudy (0 … 1) najbliższej komórki. */
  sampleOre(lx, ly, lz) {
    const i = Math.round((lx - this.gx) / this.cs);
    const j = Math.round((ly - this.gy) / this.cs);
    const k = Math.round((lz - this.gz) / this.cs);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return 0;
    return this.ore[this.index(i, j, k)] / 255;
  }

  /** Gradient zapełnienia (układ skały) — normalna powierzchni to −grad. */
  gradient(lx, ly, lz, out) {
    const h = this.cs * 0.5;
    out[0] = this.sample(lx + h, ly, lz) - this.sample(lx - h, ly, lz);
    out[1] = this.sample(lx, ly + h, lz) - this.sample(lx, ly - h, lz);
    out[2] = this.sample(lx, ly, lz + h) - this.sample(lx, ly, lz - h);
    return out;
  }

  /** Początek układu skały w przestrzeni (środek pierwotnej skały). */
  origin(out) {
    quatRotate(this.q, this.com[0], this.com[1], this.com[2], out);
    out[0] = this.p[0] - out[0];
    out[1] = this.p[1] - out[1];
    out[2] = this.p[2] - out[2];
    return out;
  }

  worldToLocal(x, y, z, out) {
    const o = this.origin(_t0);
    return quatRotateInv(this.q, x - o[0], y - o[1], z - o[2], out);
  }

  localToWorld(x, y, z, out) {
    const o = this.origin(_t0);
    quatRotate(this.q, x, y, z, out);
    out[0] += o[0]; out[1] += o[1]; out[2] += o[2];
    return out;
  }

  /** Masa, środek masy (układ skały — sam układ zostaje w miejscu), bezwładność, obrys. */
  recomputeMass() {
    // Jeden przegląd siatki: masa, ruda, momenty (względem środka siatki) i pudełko
    // pełnych komórek; najdalsza pełna komórka od środka masy — drugi przegląd tylko
    // w tym pudełku (gra woła to po kopaniu co massRecomputeInterval).
    const { nx, ny, nz, cs, fill, ore } = this;
    let m = 0, mo = 0, sx = 0, sy = 0, sz = 0, solid = 0;
    let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
    let bi0 = nx, bj0 = ny, bk0 = nz, bi1 = -1, bj1 = -1, bk1 = -1;
    for (let k = 0, idx = 0; k < nz; k++) {
      const z = this.gz + k * cs;
      for (let j = 0; j < ny; j++) {
        const y = this.gy + j * cs;
        for (let i = 0; i < nx; i++, idx++) {
          const f = fill[idx];
          if (f <= 0) continue;
          const x = this.gx + i * cs;
          const fx = f * x, fy = f * y, fz = f * z;
          m += f; sx += fx; sy += fy; sz += fz;
          sxx += fx * x; syy += fy * y; szz += fz * z; sxy += fx * y; sxz += fx * z; syz += fy * z;
          mo += f * ore[idx];
          if (f >= 0.5) {
            solid++;
            if (i < bi0) bi0 = i; if (i > bi1) bi1 = i;
            if (j < bj0) bj0 = j; if (j > bj1) bj1 = j;
            if (k < bk0) bk0 = k; if (k > bk1) bk1 = k;
          }
        }
      }
    }
    const old = _t1;
    this.origin(old);
    this.solidCells = solid;
    if (m <= 1e-9) {
      this.mass = 0; this.oreMass = 0; this.boundR = 0;
      this.massDirty = false;
      return;
    }
    const cx = sx / m, cy = sy / m, cz = sz / m;
    // Momenty względem środka masy (twierdzenie Steinera); + sześcian komórki.
    const cube = cs * cs / 6;
    const cxx = sxx - m * cx * cx, cyy = syy - m * cy * cy, czz = szz - m * cz * cz;
    const ixx = cyy + czz + m * cube, iyy = cxx + czz + m * cube, izz = cxx + cyy + m * cube;
    const ixy = -(sxy - m * cx * cy), ixz = -(sxz - m * cx * cz), iyz = -(syz - m * cy * cz);
    let r2 = 0;
    for (let k = bk0; k <= bk1; k++) {
      const z = this.gz + k * cs - cz;
      for (let j = bj0; j <= bj1; j++) {
        const y = this.gy + j * cs - cy;
        const row = nx * (j + ny * k);
        for (let i = bi0; i <= bi1; i++) {
          if (fill[row + i] < 0.5) continue;
          const x = this.gx + i * cs - cx;
          const d = x * x + y * y + z * z;
          if (d > r2) r2 = d;
        }
      }
    }
    const cm = this.cellMass;
    const I = this.inertia;
    I[0] = ixx * cm; I[1] = ixy * cm; I[2] = ixz * cm;
    I[3] = ixy * cm; I[4] = iyy * cm; I[5] = iyz * cm;
    I[6] = ixz * cm; I[7] = iyz * cm; I[8] = izz * cm;
    this.mass = m * cm;
    this.oreMass = (mo / 255) * cm;
    this.com[0] = cx; this.com[1] = cy; this.com[2] = cz;
    this.boundR = Math.sqrt(r2) + cs * 0.9;
    // Układ skały w miejscu: nowy środek masy = początek + R · com; prędkość punktu
    // ciała sztywnego w nowym środku.
    const rc = quatRotate(this.q, cx, cy, cz, _t2);
    const np0 = old[0] + rc[0], np1 = old[1] + rc[1], np2 = old[2] + rc[2];
    const dx = np0 - this.p[0], dy = np1 - this.p[1], dz = np2 - this.p[2];
    this.v[0] += this.w[1] * dz - this.w[2] * dy;
    this.v[1] += this.w[2] * dx - this.w[0] * dz;
    this.v[2] += this.w[0] * dy - this.w[1] * dx;
    this.p[0] = np0; this.p[1] = np1; this.p[2] = np2;
    this.massDirty = false;
    this.surfacePts = null;
  }

  /** Punkty powierzchni (układ skały) do zderzeń: pełne komórki z pustym sąsiadem, przerzedzone. */
  surfacePoints(max = 96) {
    if (this.surfacePts) return this.surfacePts;
    const { nx, ny, nz, fill } = this;
    const list = [];
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const idx = i + nx * (j + ny * k);
          if (fill[idx] < 0.5) continue;
          if (fill[idx - 1] >= 0.5 && fill[idx + 1] >= 0.5 && fill[idx - nx] >= 0.5 && fill[idx + nx] >= 0.5
            && fill[idx - nx * ny] >= 0.5 && fill[idx + nx * ny] >= 0.5) continue;
          list.push(idx);
        }
      }
    }
    const step = Math.max(1, Math.ceil(list.length / max));
    const pts = [];
    for (let s = 0; s < list.length; s += step) {
      const idx = list[s];
      const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
      pts.push(this.gx + i * this.cs, this.gy + j * this.cs, this.gz + k * this.cs);
    }
    this.surfacePts = new Float64Array(pts);
    return this.surfacePts;
  }

  _touch(i0, j0, k0, i1, j1, k1) {
    this.version++;
    this.massDirty = true;
    // Punkty powierzchni (zderzenia) odświeża recomputeMass — przegląd całej siatki
    // przy każdym kopnięciu lasera kosztował ~0,3 ms na krok przy styku dwóch ciał.
    // Zmiana siatki (kopanie, cięcie, wybuch) budzi ciało.
    this.asleep = false;
    this.sleep = 0;
    const b = this.dirtyBox;
    if (!b) {
      // Render zeruje dirtyBox po wysłaniu zmian — tablica wraca (bez nowej na kopnięcie).
      const a = this._dirtyArr || (this._dirtyArr = [0, 0, 0, 0, 0, 0]);
      a[0] = i0; a[1] = j0; a[2] = k0; a[3] = i1; a[4] = j1; a[5] = k1;
      this.dirtyBox = a;
    } else {
      if (i0 < b[0]) b[0] = i0; if (j0 < b[1]) b[1] = j0; if (k0 < b[2]) b[2] = k0;
      if (i1 > b[3]) b[3] = i1; if (j1 > b[4]) b[4] = j1; if (k1 > b[5]) b[5] = k1;
    }
  }
}

const _t0 = [0, 0, 0];
const _t1 = [0, 0, 0];
const _t2 = [0, 0, 0];
const _t3 = [0, 0, 0];
const _t4 = [0, 0, 0];
// Scratch kroku (zderzenia, trafienia) — gra woła step / raycast / tractor co krok fizyki.
const _n0 = [0, 0, 0];
const _g0 = [0, 0, 0];
const _one = [null];
const NO_EVENTS = Object.freeze([]);

// ---------------------------------------------------------------------------
// System wydobycia

export class AsteroidMining {
  /**
   * @param {object} o
   * @param {(shape:number, x:number, y:number, z:number) => number} o.radiusAt promień kształtu banku w kierunku (jednostkowym, układ obiektu)
   * @param {object} [o.config] nadpisania MINING_CONFIG
   * @param {number} [o.seed]
   */
  constructor({ radiusAt, config = null, seed = 1 } = {}) {
    this.radiusAt = radiusAt || (() => 1);
    this.cfg = { ...MINING_CONFIG, ...(config || {}) };
    this.seed = seed >>> 0;
    this.bodies = [];
    this.pebbles = [];
    this.events = [];
    // Druga tablica zdarzeń (drainEvents zamienia je miejscami — bez tablicy na krok).
    this._drained = [];
    // Złapane przez wiązkę w ostatnim wywołaniu tractor() (tablica wielokrotnego użytku).
    this._got = [];
    this.time = 0;
    this._eventSeq = 1;
    // Id ciał i okruchów z licznika systemu (losowania zależą od id — determinizm).
    this._nextId = 1;
    this._scratchLabels = null;
    this._scratchRegion = null;
    this._queue = null;
    this.stats = { blasts: 0, splits: 0, collected: 0, bodies: 0, pebbles: 0, lastLabelMs: 0, lastBlastMs: 0, lastBuildMs: 0 };
  }

  // -------------------------------------------------------------------------
  // Przejęcie skały pola

  /**
   * Buduje ciało z rekordu skały pola (AsteroidBeltField: x, y, r, shape, type,
   * seed, sx..sz, qx..qw, ax..az, spin, phase, id). z = z sceny środka skały
   * (warstwa gry: zOf), time = czas obrotu skały (ta sama faza co w shaderze).
   */
  activate(rock, { z = 0, time = 0, sunT = 1, anchored = false } = {}) {
    const t0 = nowMs();
    const cfg = this.cfg;
    const mat = rockMaterial(rock.type);
    const comp = mat.composition;
    const rng = mulberry32(hash32(this.seed, rock.id >>> 0, Math.floor(rock.id / 4294967296) >>> 0, 0x5A1));
    const r = rock.r;
    const s = [rock.sx ?? 1, rock.sy ?? 1, rock.sz ?? 1];
    const shape = rock.shape ?? 0;
    const radiusAt = this.radiusAt;
    // Obrys w układzie skały.
    const ext = [0, 0, 0];
    for (let d = 0; d < DIRS_EXTENT.length; d += 3) {
      const dx = DIRS_EXTENT[d], dy = DIRS_EXTENT[d + 1], dz = DIRS_EXTENT[d + 2];
      const R = radiusAt(shape, dx, dy, dz) * r;
      const ax = Math.abs(dx * R * s[0]), ay = Math.abs(dy * R * s[1]), az = Math.abs(dz * R * s[2]);
      if (ax > ext[0]) ext[0] = ax; if (ay > ext[1]) ext[1] = ay; if (az > ext[2]) ext[2] = az;
    }
    const longest = 2 * Math.max(ext[0], ext[1], ext[2]);
    let cs = Math.max(cfg.minCellSize, longest / cfg.cellsAcross);
    for (let a = 0; a < 3; a++) cs = Math.max(cs, (2 * ext[a]) / (cfg.maxCellsPerAxis - 4));
    const dims = ext.map((e) => Math.min(cfg.maxCellsPerAxis, Math.ceil((2 * e) / cs) + 4));
    const [nx, ny, nz] = dims;
    const gx = -((nx - 1) / 2) * cs, gy = -((ny - 1) / 2) * cs, gz = -((nz - 1) / 2) * cs;
    const n = nx * ny * nz;
    const fill = new Float32Array(n);
    const ore = new Uint8Array(n);
    const orig = new Uint8Array(n);
    // Skład: rdzeń przesunięty lekko od środka, płaszcz ~1,9 promienia rdzenia.
    let oreTypeId = comp.coreType || (mat.id === 'rock' ? null : mat.id);
    let crust = comp.crust, mantle = comp.mantle, coreOre = comp.core, veins = comp.veins;
    if (mat.id === 'rock' && comp.hiddenCore && rng() < comp.hiddenCore) {
      oreTypeId = HIDDEN_CORE_TYPES[Math.floor(rng() * HIDDEN_CORE_TYPES.length)];
      crust = 0; mantle = 0.1; coreOre = 0.85; veins = 0.1;
    }
    const meanR = r * Math.cbrt(s[0] * s[1] * s[2]);
    const cDir = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
    const cl = Math.hypot(cDir[0], cDir[1], cDir[2]) || 1;
    const cOff = rng() * 0.18 * meanR;
    const core = {
      x: (cDir[0] / cl) * cOff, y: (cDir[1] / cl) * cOff, z: (cDir[2] / cl) * cOff,
      r: meanR * (comp.coreRadius[0] + rng() * (comp.coreRadius[1] - comp.coreRadius[0])),
      mantle: 0,
      oreTypeId
    };
    core.mantle = core.r * 1.9;
    const veinSeed = hash32(rock.id >>> 0, 0x7E1, this.seed);
    const veinScale = 1 / (0.33 * meanR);
    const invS = [1 / (r * s[0]), 1 / (r * s[1]), 1 / (r * s[2])];
    for (let k = 0, idx = 0; k < nz; k++) {
      const pz = gz + k * cs;
      for (let j = 0; j < ny; j++) {
        const py = gy + j * cs;
        for (let i = 0; i < nx; i++, idx++) {
          const px = gx + i * cs;
          const ux = px * invS[0], uy = py * invS[1], uz = pz * invS[2];
          const L = Math.sqrt(ux * ux + uy * uy + uz * uz);
          let sd;
          if (L < 1e-9) sd = r;
          else {
            const dx = ux / L, dy = uy / L, dz = uz / L;
            const R = radiusAt(shape, dx, dy, dz);
            const perUnit = r * Math.sqrt(dx * dx * s[0] * s[0] + dy * dy * s[1] * s[1] + dz * dz * s[2] * s[2]);
            sd = (R - L) * perUnit;
          }
          const f = Math.min(1, Math.max(0, 0.5 + sd / cs));
          fill[idx] = f;
          orig[idx] = Math.round(f * 255);
          if (f <= 0) continue;
          const ddx = px - core.x, ddy = py - core.y, ddz = pz - core.z;
          const dc = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          const tCore = 1 - smoothstep(core.r * 0.85, core.r * 1.1, dc);
          const tMantle = 1 - smoothstep(core.mantle * 0.8, core.mantle * 1.15, dc);
          let o = crust + (mantle - crust) * tMantle + (coreOre - mantle) * tCore;
          if (veins > 0) {
            const nv = vnoise3(px * veinScale, py * veinScale, pz * veinScale, veinSeed);
            const vein = 1 - smoothstep(0, 0.05, Math.abs(nv - 0.5));
            o += veins * vein * (0.35 + 0.65 * tMantle) * (1 - tCore);
          }
          // Wietrzenie: tuż pod powierzchnią rudy mniej.
          if (sd < 1.5 * cs) o *= 0.5 + 0.5 * Math.max(0, sd) / (1.5 * cs);
          ore[idx] = Math.round(Math.min(1, Math.max(0, o)) * 255);
        }
      }
    }
    const spinAng = (rock.phase ?? 0) + (rock.spin ?? 0) * time;
    const sa = Math.sin(spinAng * 0.5), ca = Math.cos(spinAng * 0.5);
    const ax = rock.ax ?? 0, ay = rock.ay ?? 0, az = rock.az ?? 1;
    const qSpin = [ax * sa, ay * sa, az * sa, ca];
    const q = quatNormalize(quatMul(qSpin, [rock.qx ?? 0, rock.qy ?? 0, rock.qz ?? 0, rock.qw ?? 1]));
    const spin = rock.spin ?? 0;
    const body = new RockBody({
      id: this._nextId++, sourceId: rock.id ?? 0, type: rock.type, material: mat, oreTypeId, shape, seed: rock.seed ?? 0,
      r, sx: s[0], sy: s[1], sz: s[2], sunT,
      cs, nx, ny, nz, gx, gy, gz, fill, ore, orig, core, q, w: [ax * spin, ay * spin, az * spin],
      tonnesPerVolume: cfg.tonnesPerVolume, anchored
    });
    // Układ skały zaczepiony w środku skały pola: p = początek + R · com po przeliczeniu masy.
    body.p[0] = rock.x; body.p[1] = -rock.y; body.p[2] = z;
    body.com[0] = 0; body.com[1] = 0; body.com[2] = 0;
    body.recomputeMass();
    this.bodies.push(body);
    this.stats.lastBuildMs = nowMs() - t0;
    this.stats.bodies = this.bodies.length;
    return body;
  }

  /** Usuwa ciało bez urobku (np. skała wraca do pola). */
  release(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    body.alive = false;
    this.stats.bodies = this.bodies.length;
  }

  // -------------------------------------------------------------------------
  // Zapytania

  /**
   * Promień (przestrzeń skał) w ciała: najbliższe trafienie powierzchni.
   * Zwraca { body, t, x, y, z, nx, ny, nz, ore } albo null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 1e6, only = null, out = null) {
    let best = null;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // `out` — obiekt trafienia wielokrotnego użytku (gra: wiązki dronów co krok fizyki).
    this._hitOut = out;
    let list = this.bodies;
    if (only) { _one[0] = only; list = _one; }
    for (let bi = 0; bi < list.length; bi++) {
      const b = list[bi];
      if (!b.alive || b.mass <= 0) continue;
      // Kula obrysu.
      const cx = b.p[0] - ox, cy = b.p[1] - oy, cz = b.p[2] - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      const R = b.boundR + b.cs * 2;
      if (d2 > R * R) continue;
      const th = Math.sqrt(R * R - d2);
      let t0 = Math.max(0, tc - th);
      const t1 = Math.min(maxDist, tc + th);
      if (t0 > t1) continue;
      const lo = b.worldToLocal(ox, oy, oz, _t3);
      const ld = quatRotateInv(b.q, dx, dy, dz, _t4);
      const lox = lo[0], loy = lo[1], loz = lo[2], ldx = ld[0], ldy = ld[1], ldz = ld[2];
      const step = b.cs * 0.4;
      // Marsz od wejścia w kulę obrysu (pierwsza próbka w t0 — start w środku skały = trafienie
      // w t0), potem bisekcja; próbkowanie w jednym miejscu pętli (V8 wkleja sample —
      // liczby zwracane z niewklejonego wywołania to obiekty na stercie, gra woła to co krok).
      let prevT = t0;
      let hitT = -1;
      for (let t = t0; t <= t1 || t === t0; t += step) {
        if (b.sample(lox + ldx * t, loy + ldy * t, loz + ldz * t) >= 0.5) {
          if (t === t0) { hitT = t0; break; }
          let a = prevT, c = t;
          for (let it = 0; it < 6; it++) {
            const m = (a + c) * 0.5;
            if (b.sample(lox + ldx * m, loy + ldy * m, loz + ldz * m) >= 0.5) c = m; else a = m;
          }
          hitT = c;
          break;
        }
        prevT = t;
      }
      if (hitT >= 0 && (!best || hitT < best.t)) best = this._hit(b, hitT, lox, loy, loz, ldx, ldy, ldz, ox, oy, oz, dx, dy, dz);
    }
    _one[0] = null;
    this._hitOut = null;
    return best;
  }

  _hit(b, t, lox, loy, loz, ldx, ldy, ldz, ox, oy, oz, dx, dy, dz) {
    const lx = lox + ldx * t, ly = loy + ldy * t, lz = loz + ldz * t;
    const g = b.gradient(lx, ly, lz, _g0);
    let gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
    if (gl < 1e-9) { g[0] = -ldx; g[1] = -ldy; g[2] = -ldz; gl = 1; }
    const nw = quatRotate(b.q, -g[0] / gl, -g[1] / gl, -g[2] / gl, _n0);
    const h = this._hitOut || {};
    h.body = b; h.t = t; h.x = ox + dx * t; h.y = oy + dy * t; h.z = oz + dz * t;
    h.nx = nw[0]; h.ny = nw[1]; h.nz = nw[2]; h.ore = b.sampleOre(lx, ly, lz); h.lx = lx; h.ly = ly; h.lz = lz;
    return h;
  }

  /**
   * Skład w punkcie (przestrzeń skał): udział rudy, strefa, głębokość pod
   * powierzchnią, odległość do rdzenia. Do skanera / HUD-u.
   */
  probe(body, x, y, z) {
    const l = body.worldToLocal(x, y, z, [0, 0, 0]);
    const c = body.core;
    const dc = c ? Math.hypot(l[0] - c.x, l[1] - c.y, l[2] - c.z) : Infinity;
    return {
      ore: body.sampleOre(l[0], l[1], l[2]),
      zone: !c ? 'skorupa' : dc < c.r ? 'rdzeń' : dc < c.mantle ? 'płaszcz' : 'skorupa',
      coreDistance: c ? Math.max(0, dc - c.r) : Infinity,
      depth: this._depthAt(body, l[0], l[1], l[2]).depth
    };
  }

  /** Podsumowanie ciała do HUD-u: masa, ruda, rdzeń (przestrzeń skał), materiał. */
  summary(body) {
    if (body.massDirty) body.recomputeMass();
    const c = body.core;
    let coreWorld = null;
    if (c) coreWorld = body.localToWorld(c.x, c.y, c.z, [0, 0, 0]);
    return {
      id: body.id, type: body.typeId, oreType: body.oreTypeId, oreRes: body.oreRes,
      mass: body.mass, ore: body.oreMass, generation: body.generation,
      hardness: body.material.hardness, toughness: body.material.toughness, brittleness: body.material.brittleness,
      core: c ? { x: coreWorld[0], y: coreWorld[1], z: coreWorld[2], r: c.r, mantle: c.mantle } : null,
      damage: body.damage
    };
  }

  // Najmniejsza odległość do pustego miejsca (fill < 0,5) — kierunki Fibonacciego.
  _depthAt(b, lx, ly, lz) {
    if (b.sample(lx, ly, lz) < 0.5) return { depth: 0, vx: 0, vy: 0, vz: 1 };
    const maxD = b.boundR * 2 + b.cs * 4;
    const step = b.cs * 0.5;
    let best = maxD, bx = 0, by = 0, bz = 1;
    for (let d = 0; d < DIRS_DEPTH.length; d += 3) {
      const dx = DIRS_DEPTH[d], dy = DIRS_DEPTH[d + 1], dz = DIRS_DEPTH[d + 2];
      for (let t = step; t < best; t += step) {
        if (b.sample(lx + dx * t, ly + dy * t, lz + dz * t) < 0.5) {
          if (t < best) { best = t; bx = dx; by = dy; bz = dz; }
          break;
        }
      }
    }
    return { depth: best, vx: bx, vy: by, vz: bz };
  }

  // -------------------------------------------------------------------------
  // Kopanie i cięcie

  /**
   * Zdejmuje `volume` [j.³] z komórek w kuli (układ skały) o promieniu `radius`
   * (jądro (1 − d²/R²)²). Zwraca zdjętą objętość; urobek do `out`.
   */
  dig(body, lx, ly, lz, radius, volume, out = null) {
    const cs = body.cs;
    const { nx, ny, nz, fill, ore } = body;
    const i0 = Math.max(0, Math.floor((lx - radius - body.gx) / cs));
    const i1 = Math.min(nx - 1, Math.ceil((lx + radius - body.gx) / cs));
    const j0 = Math.max(0, Math.floor((ly - radius - body.gy) / cs));
    const j1 = Math.min(ny - 1, Math.ceil((ly + radius - body.gy) / cs));
    const k0 = Math.max(0, Math.floor((lz - radius - body.gz) / cs));
    const k1 = Math.min(nz - 1, Math.ceil((lz + radius - body.gz) / cs));
    if (i0 > i1 || j0 > j1 || k0 > k1 || volume <= 0) return 0;
    const R2 = radius * radius;
    let sumW = 0;
    for (let k = k0; k <= k1; k++) {
      const dz = body.gz + k * cs - lz;
      for (let j = j0; j <= j1; j++) {
        const dy = body.gy + j * cs - ly;
        for (let i = i0; i <= i1; i++) {
          const dx = body.gx + i * cs - lx;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R2) continue;
          const idx = i + nx * (j + ny * k);
          if (fill[idx] <= 0) continue;
          const u = 1 - d2 / R2;
          sumW += u * u * (0.55 + 0.9 * hash01(idx, body.id, 0xD16));
        }
      }
    }
    if (sumW <= 0) return 0;
    const perW = volume / (cs * cs * cs) / sumW;
    let removed = 0, oreT = 0, wasteT = 0, solidLost = 0;
    const cm = body.cellMass;
    for (let k = k0; k <= k1; k++) {
      const dz = body.gz + k * cs - lz;
      for (let j = j0; j <= j1; j++) {
        const dy = body.gy + j * cs - ly;
        for (let i = i0; i <= i1; i++) {
          const dx = body.gx + i * cs - lx;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R2) continue;
          const idx = i + nx * (j + ny * k);
          const f = fill[idx];
          if (f <= 0) continue;
          // Nierówne wybieranie (ziarno skały): ściany otworu chropowate, nie gładki lej.
          const u = 1 - d2 / R2;
          const take = Math.min(f, perW * u * u * (0.55 + 0.9 * hash01(idx, body.id, 0xD16)));
          if (take <= 0) continue;
          const nf = f - take;
          fill[idx] = nf < 1e-4 ? 0 : nf;
          if (f >= 0.5 && nf < 0.5) solidLost++;
          removed += take;
          const mass = take * cm;
          const o = ore[idx] / 255;
          oreT += mass * o;
          wasteT += mass * (1 - o);
        }
      }
    }
    if (removed > 0) {
      addYield(out, body.oreRes, oreT, wasteT);
      if (out) body.digOut = out;
      // Świeże cięcie (żar w renderze): punkt kopania w układzie skały i czas.
      body.hot[0] = lx; body.hot[1] = ly; body.hot[2] = lz; body.hot[3] = this.time;
      body._touch(i0, j0, k0, i1, j1, k1);
      body.removedSinceCheck += solidLost;
      if (body.removedSinceCheck >= this.cfg.splitCheckCells) body.splitDirty = true;
    }
    return removed * cs * cs * cs;
  }

  /**
   * Laser drona: trafienie (przestrzeń skał) i kierunek wiązki; zdejmuje
   * objętość ∝ moc / twardość, punkt kopania wchodzi pod powierzchnię wzdłuż
   * wiązki, więc otwór pogłębia się w stronę, w którą świeci dron.
   */
  laser(body, hx, hy, hz, dx, dy, dz, power, dt, out = null, radius = this.cfg.laserRadius) {
    const cfg = this.cfg;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const bite = radius * cfg.laserBite;
    const l = body.worldToLocal(hx + (dx / L) * bite, hy + (dy / L) * bite, hz + (dz / L) * bite, _t3);
    const vol = (power * cfg.digVolumeRate / (0.2 + body.material.hardness)) * dt;
    return this.dig(body, l[0], l[1], l[2], radius, vol, out);
  }

  /**
   * Piła (drut między dronami): wycina szczelinę `kerf` w płaszczyźnie
   * (punkt i normalna w przestrzeni skał), opcjonalnie tylko w pasie
   * [from, to] wzdłuż `sweep` (przesuw piły). Materiał szczeliny to pył
   * (przepada). Po przecięciu na wylot skała się rozpada (bez odrzutu,
   * połówki lekko się rozsuwają).
   */
  slice(body, px, py, pz, nx, ny, nz, kerf, sweep = null, out = null) {
    const cs = body.cs;
    const lp = body.worldToLocal(px, py, pz, [0, 0, 0]);
    const nl = quatRotateInv(body.q, nx, ny, nz, [0, 0, 0]);
    const nlen = Math.hypot(nl[0], nl[1], nl[2]) || 1;
    nl[0] /= nlen; nl[1] /= nlen; nl[2] /= nlen;
    let sl = null, from = -Infinity, to = Infinity;
    if (sweep) {
      sl = quatRotateInv(body.q, sweep.x, sweep.y, sweep.z, [0, 0, 0]);
      const sll = Math.hypot(sl[0], sl[1], sl[2]) || 1;
      sl[0] /= sll; sl[1] /= sll; sl[2] /= sll;
      from = sweep.from; to = sweep.to;
    }
    const half = Math.max(kerf, cs * 1.2) * 0.5;
    const { fill, ore, bonds } = body;
    const cm = body.cellMass;
    let lost = 0;
    let oreLost = 0;
    let bi0 = Infinity, bj0 = Infinity, bk0 = Infinity, bi1 = -1, bj1 = -1, bk1 = -1;
    // Wiersz po wierszu (x): płaszczyzna i pas przesuwu to przedziały x — przegląd
    // tylko komórek przy szczelinie (piła woła slice co klatkę; cała siatka to ~200 tys.).
    const lim = half + cs;
    const nxC = body.nx;
    for (let k = 0; k < body.nz; k++) {
      const z = body.gz + k * cs - lp[2];
      for (let j = 0; j < body.ny; j++) {
        const y = body.gy + j * cs - lp[1];
        let iLo = 0, iHi = nxC - 1;
        const cN = y * nl[1] + z * nl[2];
        if (Math.abs(nl[0]) > 1e-6) {
          const a = (-lim - cN) / nl[0], c = (lim - cN) / nl[0];
          iLo = Math.max(iLo, Math.ceil((Math.min(a, c) + lp[0] - body.gx) / cs));
          iHi = Math.min(iHi, Math.floor((Math.max(a, c) + lp[0] - body.gx) / cs));
        } else if (Math.abs(cN) > lim) continue;
        if (sl) {
          const cS = y * sl[1] + z * sl[2];
          if (Math.abs(sl[0]) > 1e-6) {
            const a = (from - cS) / sl[0], c = (to - cS) / sl[0];
            iLo = Math.max(iLo, Math.ceil((Math.min(a, c) + lp[0] - body.gx) / cs) - 1);
            iHi = Math.min(iHi, Math.floor((Math.max(a, c) + lp[0] - body.gx) / cs) + 1);
          } else if (cS < from || cS > to) continue;
        }
        for (let i = iLo; i <= iHi; i++) {
          const idx = i + nxC * (j + body.ny * k);
          if (fill[idx] <= 0) continue;
          const x = body.gx + i * cs - lp[0];
          const dn = x * nl[0] + y * nl[1] + z * nl[2];
          if (Math.abs(dn) > half + cs) continue;
          if (sl) {
            const ds = x * sl[0] + y * sl[1] + z * sl[2];
            if (ds < from || ds > to) continue;
          }
          // Wiązania przecinające płaszczyznę (sąsiad +x/+y/+z po drugiej stronie).
          if (i + 1 < body.nx && Math.sign(dn) !== Math.sign(dn + cs * nl[0])) bonds[idx] |= 1;
          if (j + 1 < body.ny && Math.sign(dn) !== Math.sign(dn + cs * nl[1])) bonds[idx] |= 2;
          if (k + 1 < body.nz && Math.sign(dn) !== Math.sign(dn + cs * nl[2])) bonds[idx] |= 4;
          if (Math.abs(dn) <= half) {
            const f = fill[idx];
            lost += f * cm;
            oreLost += f * cm * (ore[idx] / 255);
            fill[idx] = 0;
          }
          if (i < bi0) bi0 = i; if (j < bj0) bj0 = j; if (k < bk0) bk0 = k;
          if (i > bi1) bi1 = i; if (j > bj1) bj1 = j; if (k > bk1) bk1 = k;
        }
      }
    }
    if (bi1 < 0) return { lost: 0, bodies: [] };
    addYield(out, body.oreRes, 0, 0, lost);
    body._touch(bi0, bj0, bk0, bi1, bj1, bk1);
    const res = this._splitNow(body, (piece) => {
      // Połówki rozsuwają się wolno wzdłuż normalnej (od strony środka masy).
      const side = Math.sign((piece.p[0] - px) * nx + (piece.p[1] - py) * ny + (piece.p[2] - pz) * nz) || 1;
      const push = 6 + 30 * Math.min(1, 1000 / Math.max(1, piece.mass));
      piece.v[0] += nx * side * push; piece.v[1] += ny * side * push; piece.v[2] += nz * side * push;
      piece.asleep = false;
      piece.sleep = 0;
    });
    return { lost, oreLost, bodies: res.bodies, pebbles: res.pebbles };
  }

  // -------------------------------------------------------------------------
  // Ładunek

  /**
   * Detonacja ładunku energii `energy` w punkcie (przestrzeń skał) ciała.
   * Zwraca { outcome: 'contained' | 'breach', energy, rc, rf, depth, coupling,
   *          crushed, bodies, pebbles, dust, x, y, z }.
   */
  detonate(body, x, y, z, energy, out = null) {
    const t0 = nowMs();
    const cfg = this.cfg;
    const m = body.material;
    const cs = body.cs;
    const l = body.worldToLocal(x, y, z, [0, 0, 0]);
    const inside = body.sample(l[0], l[1], l[2]) >= 0.5;
    const dep = this._depthAt(body, l[0], l[1], l[2]);
    const coupling = inside
      ? Math.min(1, cfg.surfaceCoupling + (1 - cfg.surfaceCoupling) * dep.depth / (cfg.embedCells * cs))
      : cfg.surfaceCoupling;
    const E = Math.max(0, energy) * coupling * m.volatile;
    const rc = cfg.crushK * Math.cbrt(E / (0.2 + m.hardness));
    const rf = cfg.fractureK * Math.cbrt(E / (0.15 + m.toughness)) * (0.6 + 1.2 * m.brittleness) * Math.cbrt(1 + body.damage);
    const rng = mulberry32(hash32(this.seed, body.id, this._eventSeq++, 0xB1A5));
    const res = {
      outcome: 'contained', energy: E, rc, rf, depth: dep.depth, coupling,
      crushed: 0, lostCrush: 0, fines: 0, gravel: [], bodies: [], pebbles: [], dust: 0, x, y, z, body
    };
    this.stats.blasts++;
    if (rf < dep.depth) {
      // Ładunek za słaby: skorupa trzyma, skała pęka w środku i słabnie (następny
      // sięga dalej). Rudy nie ubywa — gruz zostaje w skale.
      body.damage += cfg.containedDamage * (rf / Math.max(1, dep.depth));
      body.version++;
      this.events.push({ kind: 'blast', outcome: 'contained', x, y, z, energy: E, rc, rf, body });
      this.stats.lastBlastMs = nowMs() - t0;
      return res;
    }
    // 1) Strefa zmiażdżenia: drobnica przepada jako pył, reszta leci jako żwir.
    const crush = this._crush(body, l[0], l[1], l[2], rc, out);
    res.crushed = crush.mass;
    const fines = crush.mass * m.fines;
    addYield(out, null, 0, 0, fines);
    res.fines = fines;
    const gravel = this._gravel(body, l, rc, crush.mass - fines, crush.ore * (1 - m.fines), E, m, rng);
    for (const g of gravel) this.pebbles.push(g);
    res.gravel = gravel;
    // Żwir, który nie zmieścił się w puli okruchów, też przepada.
    let gravelMass = 0;
    for (const g of gravel) gravelMass += g.mass;
    const overflow = Math.max(0, crush.mass - fines - gravelMass);
    if (overflow > 1e-9) addYield(out, null, 0, 0, overflow);
    res.lostCrush = fines + overflow;
    res.outcome = 'breach';
    // 2) Bryły Voronoi w strefie spękań.
    const seeds = this._fractureSeeds(body, l, rf, m, rng);
    const region = this._assignRegions(body, l, rf, seeds, m, rng);
    // 3) Pęknięcia: między bryłami zawsze, na brzegu strefy z szansą = kruchość.
    this._breakBonds(body, region, m, rng);
    // 4) Rozpad z odrzutem od ładunku (zasłonięte odłamy — w stronę wylotu).
    const vent = quatRotate(body.q, dep.vx, dep.vy, dep.vz, [0, 0, 0]);
    const kick = (piece, isRemainder) => this._blastKick(piece, isRemainder, x, y, z, E, rc, rf, m, vent, body, region, rng);
    const split = this._splitNow(body, kick, region);
    res.bodies = split.bodies;
    res.pebbles = split.pebbles;
    res.dust = split.dust;
    if (split.dust > 0) addYield(out, body.oreRes, 0, 0, split.dust);
    this.events.push({ kind: 'blast', outcome: 'breach', x, y, z, energy: E, rc, rf, body, pieces: split.bodies.length + split.pebbles.length });
    this.stats.lastBlastMs = nowMs() - t0;
    return res;
  }

  _crush(body, lx, ly, lz, rc, out) {
    const cs = body.cs;
    const { nx, ny, nz, fill, ore } = body;
    const i0 = Math.max(0, Math.floor((lx - rc - body.gx) / cs)), i1 = Math.min(nx - 1, Math.ceil((lx + rc - body.gx) / cs));
    const j0 = Math.max(0, Math.floor((ly - rc - body.gy) / cs)), j1 = Math.min(ny - 1, Math.ceil((ly + rc - body.gy) / cs));
    const k0 = Math.max(0, Math.floor((lz - rc - body.gz) / cs)), k1 = Math.min(nz - 1, Math.ceil((lz + rc - body.gz) / cs));
    let lost = 0, oreT = 0;
    const cm = body.cellMass;
    const R2 = rc * rc;
    for (let k = k0; k <= k1; k++) {
      const dz = body.gz + k * cs - lz;
      for (let j = j0; j <= j1; j++) {
        const dy = body.gy + j * cs - ly;
        for (let i = i0; i <= i1; i++) {
          const dx = body.gx + i * cs - lx;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R2) continue;
          const idx = i + nx * (j + ny * k);
          const f = fill[idx];
          if (f <= 0) continue;
          // Gładki brzeg krateru: pełne zmiażdżenie w środku, zanik na ostatniej komórce.
          const edge = Math.min(1, (rc - Math.sqrt(d2)) / cs);
          const take = f * Math.max(0.35, edge);
          fill[idx] = f - take < 0.02 ? 0 : f - take;
          lost += take * cm;
          oreT += take * cm * (ore[idx] / 255);
        }
      }
    }
    if (lost > 0) body._touch(i0, j0, k0, i1, j1, k1);
    void out;
    return { mass: lost, ore: oreT };
  }

  // Żwir ze strefy zmiażdżenia: (1 − drobnica) masy w kilku okruchach lecących
  // od ładunku (ruda zmiażdżonego rdzenia da się jeszcze wyłapać).
  _gravel(body, l, rc, massT, oreT, E, m, rng) {
    const cfg = this.cfg;
    const n = Math.max(2, Math.min(cfg.gravelMax, Math.round(2 + 2.5 * Math.log2(1 + massT / 3))));
    const out = [];
    const room = cfg.maxPebbles - this.pebbles.length;
    if (room <= 0 || massT <= 0) return out;
    const count = Math.min(n, room);
    const weights = [];
    let wsum = 0;
    for (let i = 0; i < count; i++) { const w = 0.3 + rng() * rng() * 2; weights.push(w); wsum += w; }
    const o = body.origin([0, 0, 0]);
    for (let i = 0; i < count; i++) {
      let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const rr = rc * (0.2 + 0.6 * rng());
      const lw = quatRotate(body.q, l[0] + dx * rr, l[1] + dy * rr, l[2] + dz * rr, [0, 0, 0]);
      const dw = quatRotate(body.q, dx, dy, dz, [0, 0, 0]);
      const mass = (massT * weights[i]) / wsum;
      const vol = mass / (body.material.density * cfg.tonnesPerVolume);
      const speed = Math.min(cfg.blastSpeedMax, cfg.blastSpeed * Math.pow(E, 0.45) * m.blast * (1.2 + 0.6 * rng()));
      const u1 = rng(), u2 = rng(), u3 = rng();
      const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
      const spin = (speed / (Math.cbrt(vol) + 40)) * cfg.blastSpin;
      out.push({
        id: this._nextId++, sourceId: body.sourceId, parentId: body.id,
        type: body.type, typeId: body.typeId, oreRes: body.oreRes, oreTypeId: body.oreTypeId,
        p: [o[0] + lw[0], o[1] + lw[1], o[2] + lw[2]],
        v: [body.v[0] + dw[0] * speed, body.v[1] + dw[1] * speed, body.v[2] + dw[2] * speed],
        q: [s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2), s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3)],
        w: [(rng() - 0.5) * spin, (rng() - 0.5) * spin, (rng() - 0.5) * spin],
        r: Math.cbrt((3 * vol) / (4 * Math.PI)),
        mass,
        oreMass: (oreT * weights[i]) / wsum,
        shape: Math.floor(rng() * 40),
        seed: rng(),
        grace: cfg.graceTime,
        age: 0,
        alive: true,
        gravel: true,
        sleep: 0,
        asleep: false
      });
    }
    return out;
  }

  // Ziarna brył: próbkowanie rzutkami o zmiennym odstępie (drobno przy ładunku
  // i w kruchym materiale, grubo dalej), tylko wewnątrz skały.
  _fractureSeeds(body, l, rf, m, rng) {
    const cs = body.cs;
    const cfg = this.cfg;
    const minS = cfg.minSeedCells * cs;
    // Rozmiar brył jak w modelu Kuza–Rama: rośnie z zasięgiem strefy, ale gdy
    // strefa jest większa niż skała, nadmiar energii na objętość rozdrabnia
    // (bryły ∝ nadmiar^−0,8) — większy ładunek na małej skale = drobnica.
    if (body.massDirty) body.recomputeMass();
    const ext = body.boundR + Math.hypot(l[0] - body.com[0], l[1] - body.com[1], l[2] - body.com[2]);
    const reach = Math.min(rf, ext);
    const excess = Math.max(1, rf / Math.max(1, ext));
    const s0 = Math.max(minS, (reach * (cfg.seedSpacing[0] - cfg.seedSpacing[1] * m.brittleness)) / Math.pow(excess, 0.8));
    const spacing = (d) => Math.max(minS, s0 * (cfg.seedNear + (1 - cfg.seedNear) * Math.min(1, d / reach)));
    // Oczekiwana liczba: ∫ 4πd² / s(d)³ po kuli zasięgu w skale — z grubsza, próbek 6× więcej.
    let expected = 0;
    for (let t = 0; t < 16; t++) {
      const d = ((t + 0.5) / 16) * reach;
      expected += (4 * Math.PI * d * d * (reach / 16)) / Math.pow(spacing(d), 3);
    }
    const tries = Math.min(12000, Math.max(64, Math.ceil(expected * 6)));
    const seeds = [];
    const cell = Math.max(s0, 2 * cs);
    const hash = new Map();
    const key = (a, b, c) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);
    for (let n = 0; n < tries && seeds.length < cfg.maxSeeds; n++) {
      const dx = (rng() * 2 - 1) * reach, dy = (rng() * 2 - 1) * reach, dz = (rng() * 2 - 1) * reach;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > reach) continue;
      const px = l[0] + dx, py = l[1] + dy, pz = l[2] + dz;
      if (body.sample(px, py, pz) < 0.5) continue;
      const sp = spacing(d) * 0.85;
      const ci = Math.floor(px / cell), cj = Math.floor(py / cell), ck = Math.floor(pz / cell);
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) {
        for (let b = -1; b <= 1 && ok; b++) {
          for (let c = -1; c <= 1 && ok; c++) {
            const list = hash.get(key(ci + a, cj + b, ck + c));
            if (!list) continue;
            for (const si of list) {
              const s = seeds[si];
              const ex = s[0] - px, ey = s[1] - py, ez = s[2] - pz;
              if (ex * ex + ey * ey + ez * ez < sp * sp) { ok = false; break; }
            }
          }
        }
      }
      if (!ok) continue;
      const k = key(ci, cj, ck);
      const list = hash.get(k);
      if (list) list.push(seeds.length); else hash.set(k, [seeds.length]);
      seeds.push([px, py, pz]);
    }
    if (!seeds.length) seeds.push([l[0], l[1], l[2]]);
    seeds.cell = cell;
    seeds.hash = hash;
    seeds.key = key;
    return seeds;
  }

  // Bryła (1..n) dla pełnych komórek strefy spękań; 0 = reszta skały.
  // Łupliwość (kryształ): odległość liczona z przewagą osi łupliwości — płytki.
  _assignRegions(body, l, rf, seeds, m, rng) {
    const n = body.nx * body.ny * body.nz;
    if (!this._scratchRegion || this._scratchRegion.length < n) this._scratchRegion = new Int32Array(n);
    const region = this._scratchRegion;
    region.fill(0, 0, n);
    const cs = body.cs;
    const { nx, ny, nz, fill } = body;
    let cvx = rng() * 2 - 1, cvy = rng() * 2 - 1, cvz = rng() * 2 - 1;
    const cvl = Math.hypot(cvx, cvy, cvz) || 1;
    cvx /= cvl; cvy /= cvl; cvz /= cvl;
    const clv = m.cleavage * 3;
    const i0 = Math.max(0, Math.floor((l[0] - rf - body.gx) / cs)), i1 = Math.min(nx - 1, Math.ceil((l[0] + rf - body.gx) / cs));
    const j0 = Math.max(0, Math.floor((l[1] - rf - body.gy) / cs)), j1 = Math.min(ny - 1, Math.ceil((l[1] + rf - body.gy) / cs));
    const k0 = Math.max(0, Math.floor((l[2] - rf - body.gz) / cs)), k1 = Math.min(nz - 1, Math.ceil((l[2] + rf - body.gz) / cs));
    const { cell, hash, key } = seeds;
    const R2 = rf * rf;
    const jag = 0.22;
    for (let k = k0; k <= k1; k++) {
      const pz = body.gz + k * cs;
      for (let j = j0; j <= j1; j++) {
        const py = body.gy + j * cs;
        for (let i = i0; i <= i1; i++) {
          const idx = i + nx * (j + ny * k);
          if (fill[idx] < 0.5) continue;
          const px = body.gx + i * cs;
          const ex = px - l[0], ey = py - l[1], ez = pz - l[2];
          if (ex * ex + ey * ey + ez * ez > R2) continue;
          const ci = Math.floor(px / cell), cj = Math.floor(py / cell), ck = Math.floor(pz / cell);
          let best = -1, bd = Infinity;
          for (let a = -1; a <= 1; a++) {
            for (let b = -1; b <= 1; b++) {
              for (let c = -1; c <= 1; c++) {
                const list = hash.get(key(ci + a, cj + b, ck + c));
                if (!list) continue;
                for (const si of list) {
                  const s = seeds[si];
                  const dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz;
                  const dn = dx * cvx + dy * cvy + dz * cvz;
                  let d2 = dx * dx + dy * dy + dz * dz + clv * dn * dn;
                  d2 *= 1 + jag * (hash01(idx, si, 0x3F) - 0.5);
                  if (d2 < bd) { bd = d2; best = si; }
                }
              }
            }
          }
          if (best < 0) {
            // Ziarno dalej niż sąsiedztwo siatki — pełne wyszukiwanie (rzadkie).
            for (let si = 0; si < seeds.length; si++) {
              const s = seeds[si];
              const dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bd) { bd = d2; best = si; }
            }
          }
          region[idx] = best + 1;
        }
      }
    }
    return region;
  }

  _breakBonds(body, region, m, rng) {
    void rng;
    const { nx, ny, nz, fill, bonds } = body;
    const pEdge = 0.2 + 0.8 * m.brittleness;
    const sxy = nx * ny;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + nx * (j + ny * k);
          if (fill[idx] < 0.5) continue;
          const ra = region[idx];
          // +x, +y, +z
          for (let a = 0; a < 3; a++) {
            let nb;
            if (a === 0) { if (i + 1 >= nx) continue; nb = idx + 1; }
            else if (a === 1) { if (j + 1 >= ny) continue; nb = idx + nx; }
            else { if (k + 1 >= nz) continue; nb = idx + sxy; }
            if (fill[nb] < 0.5) continue;
            const rb = region[nb];
            if (ra === rb) continue;
            if (ra > 0 && rb > 0) bonds[idx] |= (1 << a);
            else if (hash01(idx, a, body.id, 0xED6E) < pEdge) bonds[idx] |= (1 << a);
          }
        }
      }
    }
  }

  _blastKick(piece, isRemainder, x, y, z, E, rc, rf, m, vent, parent, region, rng) {
    const cfg = this.cfg;
    piece.asleep = false;
    piece.sleep = 0;
    let dx = piece.p[0] - x, dy = piece.p[1] - y, dz = piece.p[2] - z;
    let d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) { dx = vent[0]; dy = vent[1]; dz = vent[2]; d = 1; }
    dx /= d; dy /= d; dz /= d;
    if (!isRemainder) {
      // Odłam za resztą skały (pełne komórki strefy 0 na drodze) leci w stronę wylotu.
      if (this._blocked(parent, piece.p, dx, dy, dz, region)) {
        dx += vent[0] * 1.6; dy += vent[1] * 1.6; dz += vent[2] * 1.6;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
    }
    // Rozrzut kierunku.
    dx += (rng() - 0.5) * 0.4; dy += (rng() - 0.5) * 0.4; dz += (rng() - 0.5) * 0.4;
    const ll = Math.hypot(dx, dy, dz) || 1;
    dx /= ll; dy /= ll; dz /= ll;
    const near = Math.min(1.6, Math.max(0.3, rf / (d + rc)));
    const massK = Math.pow(Math.max(1, piece.mass) / 200, -0.12);
    let speed = cfg.blastSpeed * Math.pow(E, 0.45) * m.blast * near * massK;
    if (isRemainder) speed *= 0.12;
    speed = Math.min(cfg.blastSpeedMax, speed);
    piece.v[0] += dx * speed; piece.v[1] += dy * speed; piece.v[2] += dz * speed;
    // Obrót wokół osi prostopadłej do kierunku lotu.
    let ax = rng() - 0.5, ay = rng() - 0.5, az = rng() - 0.5;
    const dp = ax * dx + ay * dy + az * dz;
    ax -= dp * dx; ay -= dp * dy; az -= dp * dz;
    const al = Math.hypot(ax, ay, az) || 1;
    const spin = (speed / ((piece.boundR || piece.r || 50) + 40)) * cfg.blastSpin * (0.3 + 0.7 * rng()) * (isRemainder ? 0.2 : 1);
    piece.w[0] += (ax / al) * spin; piece.w[1] += (ay / al) * spin; piece.w[2] += (az / al) * spin;
  }

  // Czy odcinek od środka odłamu wzdłuż kierunku przechodzi przez resztę skały (strefa 0)?
  _blocked(parent, p, dx, dy, dz, region) {
    if (!region) return false;
    const l = parent.worldToLocal(p[0], p[1], p[2], _t3);
    const ld = quatRotateInv(parent.q, dx, dy, dz, _t4);
    const cs = parent.cs;
    const { nx, ny, nz, fill } = parent;
    const maxT = parent.boundR * 2;
    for (let t = cs; t < maxT; t += cs * 0.75) {
      const i = Math.round((l[0] + ld[0] * t - parent.gx) / cs);
      const j = Math.round((l[1] + ld[1] * t - parent.gy) / cs);
      const k = Math.round((l[2] + ld[2] * t - parent.gz) / cs);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
      const idx = i + nx * (j + ny * k);
      if (fill[idx] >= 0.5 && region[idx] === 0) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Spójność i rozpad

  _label(body) {
    const t0 = nowMs();
    const { nx, ny, nz, fill, bonds } = body;
    const n = nx * ny * nz;
    if (!this._scratchLabels || this._scratchLabels.length < n) this._scratchLabels = new Int32Array(n);
    if (!this._queue || this._queue.length < n) this._queue = new Int32Array(n);
    const labels = this._scratchLabels;
    labels.fill(0, 0, n);
    const queue = this._queue;
    const comps = [];
    const sxy = nx * ny;
    let next = 1;
    for (let start = 0; start < n; start++) {
      if (fill[start] < 0.5 || labels[start]) continue;
      const label = next++;
      let head = 0, tail = 0;
      queue[tail++] = start;
      labels[start] = label;
      let count = 0, fillSum = 0, oreSum = 0;
      let i0 = nx, j0 = ny, k0 = nz, i1 = -1, j1 = -1, k1 = -1;
      let hasRemainder = false;
      while (head < tail) {
        const idx = queue[head++];
        const i = idx % nx, j = ((idx / nx) | 0) % ny, k = (idx / sxy) | 0;
        count++;
        fillSum += fill[idx];
        oreSum += fill[idx] * body.ore[idx];
        if (this._scratchRegion && this._regionActive && this._scratchRegion[idx] === 0) hasRemainder = true;
        if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
        const b = bonds[idx];
        if (i + 1 < nx && !(b & 1)) { const q = idx + 1; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
        if (i > 0 && !(bonds[idx - 1] & 1)) { const q = idx - 1; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
        if (j + 1 < ny && !(b & 2)) { const q = idx + nx; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
        if (j > 0 && !(bonds[idx - nx] & 2)) { const q = idx - nx; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
        if (k + 1 < nz && !(b & 4)) { const q = idx + sxy; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
        if (k > 0 && !(bonds[idx - sxy] & 4)) { const q = idx - sxy; if (!labels[q] && fill[q] >= 0.5) { labels[q] = label; queue[tail++] = q; } }
      }
      comps.push({ label, count, fillSum, oreSum, i0, j0, k0, i1, j1, k1, hasRemainder });
    }
    // Komórki brzegu (0 < fill < 0,5): do składowej pełnego sąsiada (gładka powierzchnia).
    if (comps.length > 1) {
      for (let pass = 0; pass < 2; pass++) {
        for (let idx = 0; idx < n; idx++) {
          const f = fill[idx];
          if (f <= 0 || f >= 0.5 || labels[idx]) continue;
          const i = idx % nx, j = ((idx / nx) | 0) % ny, k = (idx / sxy) | 0;
          // Tylko sąsiedzi przypisani w POPRZEDNICH przejściach (> 0): jedna warstwa na przejście.
          let lab = 0;
          if (i + 1 < nx && labels[idx + 1] > 0) lab = labels[idx + 1];
          else if (i > 0 && labels[idx - 1] > 0) lab = labels[idx - 1];
          else if (j + 1 < ny && labels[idx + nx] > 0) lab = labels[idx + nx];
          else if (j > 0 && labels[idx - nx] > 0) lab = labels[idx - nx];
          else if (k + 1 < nz && labels[idx + sxy] > 0) lab = labels[idx + sxy];
          else if (k > 0 && labels[idx - sxy] > 0) lab = labels[idx - sxy];
          if (lab) {
            labels[idx] = -lab;
            const c = comps[lab - 1];
            c.fillSum += f;
            c.oreSum += f * body.ore[idx];
          }
        }
        // Druga warstwa brzegu widzi pierwszą (znak ujemny = przypisana w tym przejściu).
        for (let idx = 0; idx < n; idx++) if (labels[idx] < 0) labels[idx] = -labels[idx];
      }
    }
    comps.sort((a, b) => b.fillSum - a.fillSum);
    this.stats.lastLabelMs = nowMs() - t0;
    return { labels, comps };
  }

  /**
   * Rozpad ciała na składowe spójne: największa zostaje w ciele, reszta →
   * odłamy (nowe ciała), okruchy albo pył. kick(piece, isRemainder) dokłada
   * prędkość (wybuch). Zwraca { bodies, pebbles, dust }.
   */
  _splitNow(body, kick = null, region = null, opts = null) {
    const cfg = this.cfg;
    const vaporizeBelow = opts?.vaporizeBelow ?? 0;
    const sink = opts?.sink ?? null;
    this._regionActive = !!region;
    const { labels, comps } = this._label(body);
    this._regionActive = false;
    body.removedSinceCheck = 0;
    body.splitDirty = false;
    const out = { bodies: [], pebbles: [], dust: 0 };
    if (comps.length === 0) {
      // Nic pełnego nie zostało (np. wszystko zmiażdżone): resztki brzegu to pył.
      let rest = 0;
      for (let i = 0; i < body.fill.length; i++) { rest += body.fill[i]; body.fill[i] = 0; }
      out.dust = rest * body.cellMass;
      body.recomputeMass();
      body.alive = false;
      this.bodies.splice(this.bodies.indexOf(body), 1);
      return out;
    }
    if (comps.length === 1) {
      if (kick && region) kick(body, comps[0].hasRemainder);
      return out;
    }
    const keep = comps[0];
    if (body.massDirty) body.recomputeMass();
    const parentV = body.v.slice();
    const parentW = body.w.slice();
    const parentCom = body.com.slice();
    for (let c = 1; c < comps.length; c++) {
      const comp = comps[c];
      if (comp.count < vaporizeBelow) {
        // Urobek (np. laser): ruda i skała płonna do licznika kopiącego.
        const m = comp.fillSum * body.cellMass;
        const o = (comp.oreSum / 255) * body.cellMass;
        addYield(sink, body.oreRes, o, m - o);
        out.collected = (out.collected || 0) + m;
        this._clearComponent(body, labels, comp);
        continue;
      }
      // Składowe od największej: bryły z siatką (limit na rozpad i w ogóle), reszta → okruchy.
      if (comp.count >= cfg.pebbleMaxCells && out.bodies.length < cfg.maxNewBodies
        && this.bodies.length + out.bodies.length < cfg.maxBodies) {
        const piece = this._extractBody(body, labels, comp, parentV, parentW, parentCom);
        out.bodies.push(piece);
      } else if (comp.fillSum >= cfg.dustFill && this.pebbles.length + out.pebbles.length < cfg.maxPebbles) {
        out.pebbles.push(this._extractPebble(body, labels, comp, parentV, parentW, parentCom));
      } else {
        out.dust += comp.fillSum * body.cellMass;
        this._clearComponent(body, labels, comp);
      }
    }
    body.recomputeMass();
    body._touch(keep.i0, keep.j0, keep.k0, keep.i1, keep.j1, keep.k1);
    body.version++;
    if (kick) {
      kick(body, keep.hasRemainder || !region);
      for (const b of out.bodies) kick(b, false);
      for (const p of out.pebbles) kick(p, false);
    }
    for (const b of out.bodies) { b.grace = cfg.graceTime; this.bodies.push(b); }
    for (const p of out.pebbles) { p.grace = cfg.graceTime; this.pebbles.push(p); }
    body.grace = cfg.graceTime;
    this.stats.splits++;
    this.stats.bodies = this.bodies.length;
    this.stats.pebbles = this.pebbles.length;
    if (out.bodies.length || out.pebbles.length) this.events.push({ kind: 'split', body, pieces: out.bodies.length + out.pebbles.length });
    return out;
  }

  _clearComponent(body, labels, comp) {
    const { nx, ny } = body;
    for (let k = comp.k0 - 1; k <= comp.k1 + 1; k++) {
      if (k < 0 || k >= body.nz) continue;
      for (let j = comp.j0 - 1; j <= comp.j1 + 1; j++) {
        if (j < 0 || j >= ny) continue;
        for (let i = comp.i0 - 1; i <= comp.i1 + 1; i++) {
          if (i < 0 || i >= nx) continue;
          const idx = i + nx * (j + ny * k);
          if (labels[idx] === comp.label) { body.fill[idx] = 0; body.ore[idx] = 0; body.bonds[idx] = 0; }
        }
      }
    }
  }

  _extractBody(parent, labels, comp, parentV, parentW, parentCom) {
    const m = 2;
    const i0 = Math.max(0, comp.i0 - m), j0 = Math.max(0, comp.j0 - m), k0 = Math.max(0, comp.k0 - m);
    const i1 = Math.min(parent.nx - 1, comp.i1 + m), j1 = Math.min(parent.ny - 1, comp.j1 + m), k1 = Math.min(parent.nz - 1, comp.k1 + m);
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1;
    const n = nx * ny * nz;
    const fill = new Float32Array(n);
    const ore = new Uint8Array(n);
    const bonds = new Uint8Array(n);
    const orig = new Uint8Array(n);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const src = (i + i0) + parent.nx * ((j + j0) + parent.ny * (k + k0));
          const dst = i + nx * (j + ny * k);
          // Pierwotne zapełnienie całego wycinka (też komórek innych odłamów):
          // powierzchnia pęknięcia to ściana „wycięta” (orig > fill), nie brzeg skały.
          orig[dst] = parent.orig[src];
          if (labels[src] !== comp.label) continue;
          fill[dst] = parent.fill[src];
          ore[dst] = parent.ore[src];
          bonds[dst] = parent.bonds[src];
          parent.fill[src] = 0; parent.ore[src] = 0; parent.bonds[src] = 0;
        }
      }
    }
    const piece = new RockBody({
      id: this._nextId++, sourceId: parent.sourceId, generation: parent.generation + 1, parentId: parent.id,
      type: parent.type, material: parent.material, oreTypeId: parent.oreTypeId, shape: parent.shape, seed: parent.seed,
      r: parent.r, sx: parent.sx, sy: parent.sy, sz: parent.sz, sunT: parent.sunT,
      cs: parent.cs, nx, ny, nz,
      gx: parent.gx + i0 * parent.cs, gy: parent.gy + j0 * parent.cs, gz: parent.gz + k0 * parent.cs,
      fill, ore, bonds, orig, core: parent.core, q: parent.q, w: parentW, damage: parent.damage,
      tonnesPerVolume: this.cfg.tonnesPerVolume
    });
    // Ten sam układ skały co rodzic: p = początek rodzica + R · com (po przeliczeniu).
    // Rodzic przelicza masę dopiero po wszystkich odłamach — początek z parentCom.
    quatRotate(parent.q, parentCom[0], parentCom[1], parentCom[2], _t2);
    const ox = parent.p[0] - _t2[0], oy = parent.p[1] - _t2[1], oz = parent.p[2] - _t2[2];
    piece.p[0] = ox; piece.p[1] = oy; piece.p[2] = oz;
    piece.com[0] = 0; piece.com[1] = 0; piece.com[2] = 0;
    piece.v[0] = parentV[0]; piece.v[1] = parentV[1]; piece.v[2] = parentV[2];
    piece.w[0] = 0; piece.w[1] = 0; piece.w[2] = 0;
    piece.recomputeMass();
    // Prędkość punktu rodzica (ruch + obrót wokół środka masy rodzica) w środku odłamu.
    const rx = piece.p[0] - parent.p[0], ry = piece.p[1] - parent.p[1], rz = piece.p[2] - parent.p[2];
    piece.v[0] = parentV[0] + parentW[1] * rz - parentW[2] * ry;
    piece.v[1] = parentV[1] + parentW[2] * rx - parentW[0] * rz;
    piece.v[2] = parentV[2] + parentW[0] * ry - parentW[1] * rx;
    piece.w[0] = parentW[0]; piece.w[1] = parentW[1]; piece.w[2] = parentW[2];
    return piece;
  }

  _extractPebble(parent, labels, comp, parentV, parentW, parentCom) {
    let m = 0, mo = 0, cx = 0, cy = 0, cz = 0;
    const cs = parent.cs;
    const { nx, ny } = parent;
    for (let k = comp.k0 - 1; k <= comp.k1 + 1; k++) {
      if (k < 0 || k >= parent.nz) continue;
      for (let j = comp.j0 - 1; j <= comp.j1 + 1; j++) {
        if (j < 0 || j >= ny) continue;
        for (let i = comp.i0 - 1; i <= comp.i1 + 1; i++) {
          if (i < 0 || i >= nx) continue;
          const idx = i + nx * (j + ny * k);
          if (labels[idx] !== comp.label) continue;
          const f = parent.fill[idx];
          m += f; mo += f * parent.ore[idx] / 255;
          cx += f * (parent.gx + i * cs); cy += f * (parent.gy + j * cs); cz += f * (parent.gz + k * cs);
          parent.fill[idx] = 0; parent.ore[idx] = 0; parent.bonds[idx] = 0;
        }
      }
    }
    cx /= m; cy /= m; cz /= m;
    quatRotate(parent.q, parentCom[0], parentCom[1], parentCom[2], _t2);
    const ox = parent.p[0] - _t2[0], oy = parent.p[1] - _t2[1], oz = parent.p[2] - _t2[2];
    const wc = quatRotate(parent.q, cx, cy, cz, [0, 0, 0]);
    const px = ox + wc[0], py = oy + wc[1], pz = oz + wc[2];
    const rx = px - parent.p[0], ry = py - parent.p[1], rz = pz - parent.p[2];
    const vol = m * cs * cs * cs;
    const rng = mulberry32(hash32(parent.id, comp.label, 0x9EB));
    // Orientacja okruchu: dowolna (rysowany kształtem z banku).
    const u1 = rng(), u2 = rng(), u3 = rng();
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    const peb = {
      id: this._nextId++, sourceId: parent.sourceId, parentId: parent.id,
      type: parent.type, typeId: parent.typeId, oreRes: parent.oreRes, oreTypeId: parent.oreTypeId,
      p: [px, py, pz],
      v: [parentV[0] + parentW[1] * rz - parentW[2] * ry, parentV[1] + parentW[2] * rx - parentW[0] * rz, parentV[2] + parentW[0] * ry - parentW[1] * rx],
      q: [s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2), s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3)],
      w: [0, 0, 0],
      r: Math.cbrt((3 * vol) / (4 * Math.PI)),
      mass: m * parent.cellMass,
      oreMass: mo * parent.cellMass,
      shape: Math.floor(rng() * 40),
      seed: rng(),
      grace: 0,
      age: 0,
      alive: true,
      gravel: false,
      sleep: 0,
      asleep: false
    };
    return peb;
  }

  // -------------------------------------------------------------------------
  // Ruch, zderzenia, zbieranie

  /** Krok symulacji: masa po kopaniu, rozpady po cięciu, ruch, zderzenia. */
  step(dt) {
    if (!(dt > 0)) return;
    const cfg = this.cfg;
    this.time += dt;
    // Kopia listy tylko przy rozpadzie do sprawdzenia (rozpad dopisuje i usuwa ciała);
    // sprawdzenie ciała najczęściej co splitCheckInterval (etykietowanie całej siatki).
    const every = cfg.splitCheckInterval || 0;
    let splitPending = false;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (b.splitDirty && this.time - b._lastSplitAt >= every) { splitPending = true; break; }
    }
    if (splitPending) {
      for (const b of this.bodies.slice()) {
        if (b.splitDirty && b.alive && this.time - b._lastSplitAt >= every) {
          b._lastSplitAt = this.time;
          if (b.massDirty) b.recomputeMass();
          // Drobinki odłupane laserem (mniejsze niż 3 okruchy) zbierają drony — do urobku kopania.
          this._splitNow(b, null, null, { vaporizeBelow: this.cfg.pebbleMaxCells * 3, sink: b.digOut || null });
        }
      }
    }
    const lin = Math.exp(-cfg.linearDamping * dt);
    const ang = Math.exp(-cfg.angularDamping * dt);
    // Skała zakotwiczona (platforma wydobywcza trzyma ją w miejscu): ruch i obrót gasną.
    const hold = Math.exp(-cfg.anchorDamping * dt);
    this._contactDamp = Math.exp(-(cfg.contactSpin || 0) * dt);
    const massEvery = cfg.massRecomputeInterval || 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (b.massDirty && this.time - b._massAt >= massEvery) { b.recomputeMass(); b._massAt = this.time; }
      b.age += dt;
      if (b.grace > 0) b.grace -= dt;
      if (b.asleep) continue;
      b.p[0] += b.v[0] * dt; b.p[1] += b.v[1] * dt; b.p[2] += b.v[2] * dt;
      quatIntegrate(b.q, b.w[0], b.w[1], b.w[2], dt);
      const kl = b.anchored ? hold : (b.generation > 0 || b.age > 0.5 ? lin : 1);
      const ka = b.anchored ? hold : (b.generation > 0 ? ang : 1);
      b.v[0] *= kl; b.v[1] *= kl; b.v[2] *= kl;
      b.w[0] *= ka; b.w[1] *= ka; b.w[2] *= ka;
      this._layerBounds(b.p, b.v, b.boundR * 0.7);
      this._sleepCheck(b, dt);
    }
    for (let i = 0; i < this.pebbles.length; i++) {
      const p = this.pebbles[i];
      p.age += dt;
      if (p.grace > 0) p.grace -= dt;
      if (p.asleep) continue;
      p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
      quatIntegrate(p.q, p.w[0], p.w[1], p.w[2], dt);
      p.v[0] *= lin; p.v[1] *= lin; p.v[2] *= lin;
      p.w[0] *= ang; p.w[1] *= ang; p.w[2] *= ang;
      this._layerBounds(p.p, p.v, p.r);
      this._sleepCheck(p, dt);
    }
    this._collide();
  }

  // Spoczynek przez sleepTime → uśpienie (bez ruchu; zderzenia śpiących ze sobą pomijane).
  _sleepCheck(o, dt) {
    const cfg = this.cfg;
    const v2 = o.v[0] * o.v[0] + o.v[1] * o.v[1] + o.v[2] * o.v[2];
    const w2 = o.w[0] * o.w[0] + o.w[1] * o.w[1] + o.w[2] * o.w[2];
    if (v2 < cfg.sleepSpeed * cfg.sleepSpeed && w2 < cfg.sleepSpin * cfg.sleepSpin) {
      o.sleep += dt;
      if (o.sleep >= cfg.sleepTime) {
        o.asleep = true;
        o.v[0] = 0; o.v[1] = 0; o.v[2] = 0;
        o.w[0] = 0; o.w[1] = 0; o.w[2] = 0;
      }
    } else {
      o.sleep = 0;
    }
  }

  /** Budzi ciało albo okruch (kod gry, który sam rusza obiektem). */
  wake(o) {
    if (!o) return;
    o.asleep = false;
    o.sleep = 0;
  }

  _layerBounds(p, v, r) {
    const cfg = this.cfg;
    const top = p[2] + r;
    if (top > cfg.layerTop) {
      p[2] -= top - cfg.layerTop;
      if (v[2] > 0) v[2] = -v[2] * cfg.restitution;
    }
    if (p[2] - r < cfg.layerFloor) {
      p[2] = cfg.layerFloor + r;
      if (v[2] < 0) v[2] = -v[2] * cfg.restitution;
    }
  }

  _collide() {
    const cfg = this.cfg;
    const B = this.bodies;
    const P = this.pebbles;
    // Ciało–ciało: punkty powierzchni lżejszego w polu cięższego.
    for (let a = 0; a < B.length; a++) {
      const A = B[a];
      for (let c = a + 1; c < B.length; c++) {
        const C = B[c];
        if (A.grace > 0 || C.grace > 0) continue;
        if (A.asleep && C.asleep) continue;
        const dx = C.p[0] - A.p[0], dy = C.p[1] - A.p[1], dz = C.p[2] - A.p[2];
        const R = A.boundR + C.boundR;
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        if (A.mass < C.mass) this._bodyContact(A, C, cfg);
        else this._bodyContact(C, A, cfg);
      }
    }
    // Okruch–ciało: środek okruchu w polu ciała.
    for (let pi = 0; pi < P.length; pi++) {
      const p = P[pi];
      if (p.grace > 0) continue;
      for (let bi = 0; bi < B.length; bi++) {
        const b = B[bi];
        if (p.asleep && b.asleep) continue;
        const dx = p.p[0] - b.p[0], dy = p.p[1] - b.p[1], dz = p.p[2] - b.p[2];
        const R = b.boundR + p.r;
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        const l = b.worldToLocal(p.p[0], p.p[1], p.p[2], _t3);
        const f = b.sample(l[0], l[1], l[2]);
        if (f < 0.3) continue;
        const g = b.gradient(l[0], l[1], l[2], _t4);
        const gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
        if (gl < 1e-6) continue;
        const nw = quatRotate(b.q, -g[0] / gl, -g[1] / gl, -g[2] / gl, _n0);
        const depth = (f - 0.3) * b.cs + p.r * 0.3;
        this._resolve(p, b, nw, depth, cfg.restitution);
        this._contactSpin(p);
      }
    }
    // Okruch–okruch: kule. Zamiatanie wzdłuż x — okruchy posortowane po x przez
    // wstawianie w miejscu (między krokami lista jest prawie posortowana: O(n) zamiast
    // O(n²) par przy 500 okruchach po kilku wybuchach).
    let maxR = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      if (q.r > maxR) maxR = q.r;
      const x = q.p[0];
      let j = i - 1;
      while (j >= 0 && P[j].p[0] > x) { P[j + 1] = P[j]; j--; }
      P[j + 1] = q;
    }
    for (let a = 0; a < P.length; a++) {
      const A = P[a];
      if (A.grace > 0) continue;
      const reach = (A.r + maxR) * 0.85;
      const ax = A.p[0];
      for (let c = a + 1; c < P.length; c++) {
        const C = P[c];
        const dx = C.p[0] - ax;
        if (dx > reach) break;
        if (C.grace > 0 || (A.asleep && C.asleep)) continue;
        const dy = C.p[1] - A.p[1], dz = C.p[2] - A.p[2];
        const R = (A.r + C.r) * 0.85;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        _n0[0] = dx / d; _n0[1] = dy / d; _n0[2] = dz / d;
        this._resolve(C, A, _n0, R - d, cfg.restitution);
        this._contactSpin(A);
        this._contactSpin(C);
      }
    }
  }

  _bodyContact(light, heavy, cfg) {
    const pts = light.surfacePoints();
    let nx = 0, ny = 0, nz = 0, depth = 0, hits = 0;
    const w = _t1;
    for (let s = 0; s < pts.length; s += 3) {
      light.localToWorld(pts[s], pts[s + 1], pts[s + 2], w);
      const l = heavy.worldToLocal(w[0], w[1], w[2], _t3);
      const f = heavy.sample(l[0], l[1], l[2]);
      if (f < 0.5) continue;
      const g = heavy.gradient(l[0], l[1], l[2], _t4);
      const gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
      if (gl < 1e-6) continue;
      const nwv = quatRotate(heavy.q, -g[0] / gl, -g[1] / gl, -g[2] / gl, _t2);
      nx += nwv[0]; ny += nwv[1]; nz += nwv[2];
      depth = Math.max(depth, (f - 0.5) * heavy.cs + heavy.cs * 0.25);
      hits++;
    }
    if (!hits) return;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-9) return;
    _n0[0] = nx / nl; _n0[1] = ny / nl; _n0[2] = nz / nl;
    this._resolve(light, heavy, _n0, depth, cfg.restitution);
    this._contactSpin(light);
    this._contactSpin(heavy);
  }

  // Tarcie w styku: obrót czuwającego obiektu gaśnie (contactSpin).
  _contactSpin(o) {
    if (o.asleep) return;
    const k = this._contactDamp ?? 1;
    o.w[0] *= k; o.w[1] *= k; o.w[2] *= k;
  }

  // Rozsunięcie i impuls wzdłuż normalnej n (od b do a). Śpiący obiekt przy spoczynkowym
  // styku działa jak nieruchomy (rozsuwa się tylko czuwający); budzi go dopiero uderzenie.
  _resolve(a, b, n, depth, e) {
    let ima = a.mass > 0 ? 1 / a.mass : 0;
    let imb = b.mass > 0 ? 1 / b.mass : 0;
    if (a.asleep || b.asleep) {
      const rv0 = (a.v[0] - b.v[0]) * n[0] + (a.v[1] - b.v[1]) * n[1] + (a.v[2] - b.v[2]) * n[2];
      if (rv0 < -2 * this.cfg.sleepSpeed) {
        a.asleep = false; a.sleep = 0;
        b.asleep = false; b.sleep = 0;
      } else {
        if (a.asleep) ima = 0;
        if (b.asleep) imb = 0;
      }
    }
    const sum = ima + imb;
    if (sum <= 0) return;
    const corr = Math.min(depth, 60) / sum;
    a.p[0] += n[0] * corr * ima; a.p[1] += n[1] * corr * ima; a.p[2] += n[2] * corr * ima;
    b.p[0] -= n[0] * corr * imb; b.p[1] -= n[1] * corr * imb; b.p[2] -= n[2] * corr * imb;
    const rv = (a.v[0] - b.v[0]) * n[0] + (a.v[1] - b.v[1]) * n[1] + (a.v[2] - b.v[2]) * n[2];
    if (rv >= 0) return;
    const j = (-(1 + e) * rv) / sum;
    a.v[0] += n[0] * j * ima; a.v[1] += n[1] * j * ima; a.v[2] += n[2] * j * ima;
    b.v[0] -= n[0] * j * imb; b.v[1] -= n[1] * j * imb; b.v[2] -= n[2] * j * imb;
  }

  /**
   * Wiązka ściągająca: ciała i okruchy w promieniu `radius` od punktu (przestrzeń
   * skał), nie cięższe niż `capacity` [t], lecą do punktu; bliżej niż `capture`
   * trafiają do ładowni. Zwraca listę złapanych { kind, ore, oreRes, waste }, urobek do `out`.
   */
  tractor(tx, ty, tz, radius, capacity, capture, dt, out = null, pull = 1, maxOre = Infinity) {
    // Tablica złapanych wielokrotnego użytku (ważna do następnego wywołania) — gra
    // woła wiązkę co krok fizyki; zdarzenie zbiórki dostaje kopię (rzadko).
    const got = this._got;
    got.length = 0;
    const T = this._tr || (this._tr = { tx: 0, ty: 0, tz: 0, radius: 0, capacity: 0, capture: 0, want: 0, k: 0, pull: 1 });
    T.tx = tx; T.ty = ty; T.tz = tz; T.radius = radius; T.capacity = capacity; T.capture = capture;
    T.k = 1 - Math.exp(-2.2 * dt * pull);
    T.pull = pull;
    // maxOre — ile rudy [t] może jeszcze wejść (ładownia gry): odłam z większą rudą
    // nie jest łapany (czeka przy punkcie wiązki), skała płonna bez rudy — zawsze.
    let allowance = maxOre;
    for (let i = this.pebbles.length - 1; i >= 0; i--) {
      const p = this.pebbles[i];
      if (this._pullOne(p, p.mass, p.r) && p.oreMass <= allowance + 1e-9) {
        allowance -= p.oreMass;
        this.pebbles.splice(i, 1);
        p.alive = false;
        const waste = p.mass - p.oreMass;
        addYield(out, p.oreRes, p.oreMass, waste);
        got.push({ kind: 'pebble', ore: p.oreMass, oreRes: p.oreRes, waste, x: p.p[0], y: p.p[1], z: p.p[2] });
      }
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.massDirty) b.recomputeMass();
      if (this._pullOne(b, b.mass, b.boundR) && b.oreMass <= allowance + 1e-9) {
        allowance -= b.oreMass;
        this.bodies.splice(i, 1);
        b.alive = false;
        const waste = b.mass - b.oreMass;
        addYield(out, b.oreRes, b.oreMass, waste);
        got.push({ kind: 'body', ore: b.oreMass, oreRes: b.oreRes, waste, x: b.p[0], y: b.p[1], z: b.p[2], body: b });
      }
    }
    if (got.length) {
      this.stats.collected += got.length;
      this.stats.bodies = this.bodies.length;
      this.stats.pebbles = this.pebbles.length;
      this.events.push({ kind: 'collect', items: got.slice() });
    }
    return got;
  }

  // Wiązka na jednym obiekcie (parametry wywołania w this._tr): true = w zasięgu chwytu.
  _pullOne(o, mass, rr) {
    const T = this._tr;
    const dx = T.tx - o.p[0], dy = T.ty - o.p[1], dz = T.tz - o.p[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > T.radius + rr || mass > T.capacity) return false;
    if (d < T.capture + rr * 0.5) return true;
    const want = Math.min(900, 60 + d * 1.2) * T.pull;
    const k = T.k;
    o.asleep = false;
    o.sleep = 0;
    o.v[0] += ((dx / d) * want - o.v[0]) * k;
    o.v[1] += ((dy / d) * want - o.v[1]) * k;
    o.v[2] += ((dz / d) * want - o.v[2]) * k;
    if (o.w) { o.w[0] *= 1 - k * 0.5; o.w[1] *= 1 - k * 0.5; o.w[2] *= 1 - k * 0.5; }
    return false;
  }

  /**
   * Zdarzenia od ostatniego wywołania (wybuchy, rozpady, zbiórka) — dla efektów.
   * Zwrócona tablica jest ważna do NASTĘPNEGO wywołania (dwie tablice na zmianę —
   * gra drenuje co krok fizyki bez nowej tablicy na krok).
   */
  drainEvents() {
    const e = this.events;
    if (e.length === 0) return NO_EVENTS;
    const next = this._drained;
    next.length = 0;
    this.events = next;
    this._drained = e;
    return e;
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export { ROCK_TYPE_INDEX };
