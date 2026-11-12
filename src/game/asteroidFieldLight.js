// src/game/asteroidFieldLight.js
//
// Słońce przesłaniane przez gęste pola asteroid (mechanika pola).
//
// Słońce leży w płaszczyźnie gry, w środku układu — promień światła do punktu
// pasa biegnie RADIALNIE. Transmitancja T = exp(−τ), τ = całka ekstynkcji
// wzdłuż promienia od słońca do punktu, liczona w układzie biegunowym wokół
// słońca: dla każdego kąta jedna całka 1D po promieniu. Wejście do pola od
// strony słońca jest jasne, w głąb coraz ciemniej; za polem światło wraca na
// długości `recovery` (rozproszenie w pyle) — bez tego gęste pole rzucałoby
// cień przez pół układu, aż po Kuipera.
//
//   τ(r + Δr) = τ(r) · exp(−Δr / recovery) + σ(r) · Δr
//   σ = waga pasa · (sigmaBase + sigmaField · pole^fieldPower)
//
// Siatka biegunowa liczona leniwie w SEKTORACH kątowych (cache), tylko
// w oknach radialnych pasów (z zapasem na odbudowę); poza oknami T = 1.
// Źródło gęstości = AsteroidBeltField.sampleMacro — ten sam profil pasa
// i te same gęste pola co skały i mgła.
//
// Moduł bez three i DOM-u (testy: tests/asteroidFieldLight.test.mjs).
//
// Szew gra ↔ render (RW-25): siatkę liczy strona gry (src/game/beltWorld.js, ekran ładowania),
// render dostaje gotowe sektory (`exportSectors` → `adoptSectors` — dane w SharedArrayBuffer, gdy
// strona ma izolację COOP / COEP; w trybie `inline` te same tablice, w workerze bez kopii).

import { sharedTypedArray } from './sharedTyped.js';

// Głęboka noc (dema: nightKnee) — słońce przesiane przez pole gaśnie w rdzeniu szybciej
// niż transmitancja: poniżej T = 0,12 jasność ∝ T · smoothstep(0, 0,12, T). Tę wartość
// dostają materiały, mgła, zasłona, olbrzymy i maska słońca Core3D oraz platforma
// wydobywcza (sunT); logika — surowe T.
export const NIGHT_KNEE = 0.12;
export function nightKnee(t) {
  if (!(t < NIGHT_KNEE)) return t;
  const u = Math.max(0, t) / NIGHT_KNEE;
  return t * u * u * (3 - 2 * u);
}

export const FIELD_LIGHT_CONFIG = Object.freeze({
  // Ekstynkcja [1/j.] w rdzeniu pola (pole = 1) i w rzadkim pasie.
  // Środek gęstego pola ma być CAŁKOWICIE ciemny (user: jedyne światło to
  // reflektory i świecące skały). Z odbudową 70 tys. j.: 10 tys. j. w głąb
  // rdzenia → T ≈ 0,37, 30 tys. → ≈ 0,06, nasycenie σ·L = 7 (T ≈ 0,001).
  sigmaField: 1e-4,
  sigmaBase: 1.5e-7,
  fieldPower: 1.35,
  // Długość odbudowy światła za polem [j.]. Przy 170 tys. cień pola kładł się
  // na rzadki pas 200 tys. j. dalej (T ≈ 0,24 poza polami) — 70 tys. trzyma
  // mrok w polu i tuż za nim; w rdzeniu τ nasyca się przy σ·L ≈ 3,9 (T ≈ 0,02).
  recovery: 70000,
  // Rozdzielczość siatki biegunowej: krok radialny [j.] i kątowy [rad].
  dr: 3000,
  dTheta: 1 / 560,
  sectorColumns: 64,
  maxSectors: 24
});

const TWO_PI = Math.PI * 2;

export class FieldSunOcclusion {
  /**
   * @param {import('./asteroidBeltField.js').AsteroidBeltField} field
   * @param {object} [config] nadpisania FIELD_LIGHT_CONFIG
   */
  constructor(field, config = {}) {
    this.field = field;
    this.config = { ...FIELD_LIGHT_CONFIG, ...config };
    this.sunX = field.sunX;
    this.sunY = field.sunY;
    this.columns = Math.ceil(TWO_PI / this.config.dTheta);
    this.dTheta = TWO_PI / this.columns;
    this.sectorCount = Math.ceil(this.columns / this.config.sectorColumns);
    this.windows = this._buildWindows();
    this.rows = 0;
    for (const w of this.windows) {
      w.row0 = this.rows;
      w.rows = Math.max(2, Math.ceil((w.r1 - w.r0) / this.config.dr) + 1);
      this.rows += w.rows;
    }
    this._sectors = new Map();
    this._tick = 0;
    this.stats = { sectorsBuilt: 0, samples: 0, buildMs: 0 };
  }

  /** Okna radialne: zasięg pasów + miękka krawędź + odbudowa (4 długości). */
  _buildWindows() {
    const edge = this.field.edgeWorld;
    const tail = this.config.recovery * 4;
    const spans = [];
    for (const reg of this.field.regions) {
      // Populacja bez gęstych pól (NEA: fieldMul 0) prawie nie przesłania słońca (samo σ tła),
      // a jej okno 21–31 AU kosztowało +0,36 s ekranu ładowania i +2,8 MB — poza oknami T = 1.
      if (reg.fieldMul === 0) continue;
      if (reg.kind === 'ring') spans.push([reg.rInner - edge, reg.rOuter + edge + tail]);
      else spans.push([reg.rMid - reg.rHalf - edge, reg.rMid + reg.rHalf + edge + tail]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of spans) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([Math.max(0, a), b]);
    }
    return merged.map(([r0, r1]) => ({ r0, r1, row0: 0, rows: 0 }));
  }

  /** Ekstynkcja σ [1/j.] w punkcie świata. */
  extinctionAt(x, y) {
    const m = this.field.sampleMacro(x, y);
    if (!(m.weight > 0)) return 0;
    const c = this.config;
    // Obrzeże z wypełniacza (m.rim) celowo NIE przesłania: rzadkie skały przed
    // polem kładły się na 30–60 tys. j. i wejście od słońca było już w półmroku
    // (T 0,33) — mechanika „na początku jasno” zaczyna się na właściwym polu.
    // Wyrwa po wydobyciu (m.hole) rozrzedza pył jak skały; źródło gazu (m.gas — dziś 0) dołożyłoby swój.
    const dust = m.weight * (c.sigmaBase + c.sigmaField * Math.pow(Math.max(0, m.cluster), c.fieldPower)) * m.hole;
    return (dust + m.gas * c.sigmaField) * (this.field.densityScale ?? 1);
  }

  _sector(index) {
    let s = this._sectors.get(index);
    if (s) {
      s.tick = ++this._tick;
      return s;
    }
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const cols = this.config.sectorColumns;
    const data = sharedTypedArray(Float32Array, cols * this.rows).fill(1);
    const c = this.config;
    const decayPerStep = Math.exp(-c.dr / c.recovery);
    for (let k = 0; k < cols; k++) {
      const col = index * cols + k;
      if (col >= this.columns) break;
      const theta = col * this.dTheta - Math.PI;
      const cx = Math.cos(theta);
      const cy = Math.sin(theta);
      let tau = 0;
      let prevR = null;
      for (const w of this.windows) {
        // Między oknami σ = 0: tylko odbudowa światła.
        if (prevR !== null) tau *= Math.exp(-(w.r0 - prevR) / c.recovery);
        for (let i = 0; i < w.rows; i++) {
          const r = w.r0 + i * c.dr;
          const sigma = this.extinctionAt(this.sunX + cx * r, this.sunY + cy * r);
          this.stats.samples++;
          tau = tau * decayPerStep + sigma * c.dr;
          data[k * this.rows + w.row0 + i] = Math.exp(-tau);
        }
        prevR = w.r0 + (w.rows - 1) * c.dr;
      }
    }
    s = { data, tick: ++this._tick };
    this._sectors.set(index, s);
    this.stats.sectorsBuilt++;
    if (this._sectors.size > c.maxSectors) {
      let oldest = null;
      for (const [key, v] of this._sectors) if (!oldest || v.tick < oldest[1]) oldest = [key, v.tick];
      if (oldest && oldest[0] !== index) this._sectors.delete(oldest[0]);
    }
    if (typeof performance !== 'undefined') this.stats.buildMs += performance.now() - t0;
    return s;
  }

  _rowOf(r) {
    for (const w of this.windows) {
      if (r < w.r0) return -1;
      const f = (r - w.r0) / this.config.dr;
      if (f <= w.rows - 1) return w.row0 + f;
    }
    return -1;
  }

  _value(col, rowF) {
    const cols = this.config.sectorColumns;
    const c = ((col % this.columns) + this.columns) % this.columns;
    const s = this._sector(Math.floor(c / cols));
    const k = c % cols;
    const r0 = Math.floor(rowF);
    const t = rowF - r0;
    const base = k * this.rows;
    const a = s.data[base + r0];
    const b = t > 0 ? s.data[base + Math.min(this.rows - 1, r0 + 1)] : a;
    return a + (b - a) * t;
  }

  /** Transmitancja słońca w punkcie świata (1 = pełne słońce). */
  transmittance(x, y) {
    const dx = x - this.sunX;
    const dy = y - this.sunY;
    const r = Math.hypot(dx, dy);
    const rowF = this._rowOf(r);
    if (rowF < 0) return 1;
    const colF = (Math.atan2(dy, dx) + Math.PI) / this.dTheta;
    const c0 = Math.floor(colF);
    const t = colF - c0;
    const a = this._value(c0, rowF);
    const b = this._value(c0 + 1, rowF);
    return a + (b - a) * t;
  }

  /**
   * Cały układ naraz (ekran ładowania gry): wszystkie sektory, bez limitu
   * cache — potem żadnego liczenia w trakcie lotu. Oddaje wątek co ~sliceMs,
   * żeby strona żyła i pokazywała postęp.
   */
  async precomputeAll({ onProgress = null, sliceMs = 40 } = {}) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    this.config.maxSectors = Infinity;
    let sliceStart = t0;
    for (let s = 0; s < this.sectorCount; s++) {
      this._sector(s);
      const now = (typeof performance !== 'undefined') ? performance.now() : 0;
      if (now - sliceStart > sliceMs) {
        if (onProgress) onProgress((s + 1) / this.sectorCount);
        await new Promise((r) => setTimeout(r, 0));
        sliceStart = (typeof performance !== 'undefined') ? performance.now() : 0;
      }
    }
    if (onProgress) onProgress(1);
    this.precomputed = true;
    this.stats.precomputeMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    return this;
  }

  /**
   * Przeliczenie po zmianie gęstości w prostokącie świata (wyrwy — beltWorld.setHoles): kolumny kątowe przez
   * prostokąt, od jego pierwszego wiersza w dół promienia, aż wartości za prostokątem zbiegną się z dawnymi
   * (|ΔT| < tol przez 3 wiersze — dalej odbudowa światła i tak je wyrównuje). Dane sektorów W MIEJSCU: tablice są
   * w SharedArrayBuffer (worker renderu) albo wspólne z obrazem (`adoptSectors`), więc render widzi nowy cień bez
   * kopii. Liczy tylko policzone sektory (reszta policzy się sama z nową gęstością).
   * Zwraca { columns, samples, ms, x0, y0, x1, y1 } — prostokąt świata, w którym T zmieniła się o ≥ 0,002 (albo null).
   */
  recomputeRect(x0, y0, x1, y1, tol = 1e-4) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const c = this.config;
    const out = { columns: 0, samples: 0, ms: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    // Pasmo promieni i kątów prostokąta (wokół słońca).
    const px = [x0, x1, x1, x0];
    const py = [y0, y0, y1, y1];
    let rMax = 0;
    let a0 = Infinity;
    let a1 = -Infinity;
    const aRef = Math.atan2((y0 + y1) * 0.5 - this.sunY, (x0 + x1) * 0.5 - this.sunX);
    for (let i = 0; i < 4; i++) {
      const dx = px[i] - this.sunX;
      const dy = py[i] - this.sunY;
      rMax = Math.max(rMax, Math.sqrt(dx * dx + dy * dy));
      let a = Math.atan2(dy, dx) - aRef;
      a -= Math.round(a / TWO_PI) * TWO_PI;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
    }
    const cx0 = Math.max(this.sunX < x0 ? x0 - this.sunX : this.sunX > x1 ? this.sunX - x1 : 0, 0);
    const cy0 = Math.max(this.sunY < y0 ? y0 - this.sunY : this.sunY > y1 ? this.sunY - y1 : 0, 0);
    const rMin = Math.sqrt(cx0 * cx0 + cy0 * cy0);
    const inside = rMin === 0;
    const colA = inside ? 0 : Math.floor((aRef + a0 + Math.PI) / this.dTheta) - 1;
    const colB = inside ? this.columns - 1 : Math.ceil((aRef + a1 + Math.PI) / this.dTheta) + 1;
    const cols = c.sectorColumns;
    const decayPerStep = Math.exp(-c.dr / c.recovery);
    const rows = this.rows;
    for (let cc = colA; cc <= colB; cc++) {
      const col = ((cc % this.columns) + this.columns) % this.columns;
      const sector = this._sectors.get(Math.floor(col / cols));
      if (!sector) continue;
      const data = sector.data;
      const base = (col % cols) * rows;
      const theta = col * this.dTheta - Math.PI;
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      out.columns++;
      let started = false;
      let tau = 0;
      let calm = 0;
      let prevR = null;
      let prevRow = -1;
      let done = false;
      for (const w of this.windows) {
        if (done) break;
        if (w.r0 + (w.rows - 1) * c.dr < rMin - c.dr) { prevR = w.r0 + (w.rows - 1) * c.dr; prevRow = w.row0 + w.rows - 1; continue; }
        for (let i = 0; i < w.rows; i++) {
          const r = w.r0 + i * c.dr;
          if (!started) {
            if (r < rMin - c.dr) continue;
            started = true;
            // τ przed tym wierszem z zapisanej transmitancji (poprzedni wiersz okna albo koniec poprzedniego okna).
            if (i > 0) tau = -Math.log(Math.max(1e-30, data[base + w.row0 + i - 1]));
            else if (prevRow >= 0) tau = -Math.log(Math.max(1e-30, data[base + prevRow])) * Math.exp(-(w.r0 - prevR) / c.recovery);
          } else if (i === 0 && prevR !== null) {
            tau *= Math.exp(-(w.r0 - prevR) / c.recovery);
          }
          const sigma = this.extinctionAt(this.sunX + ux * r, this.sunY + uy * r);
          out.samples++;
          tau = tau * decayPerStep + sigma * c.dr;
          const T = Math.exp(-tau);
          const idx = base + w.row0 + i;
          const diff = Math.abs(T - data[idx]);
          data[idx] = T;
          if (diff >= 0.002) {
            const x = this.sunX + ux * r;
            const y = this.sunY + uy * r;
            if (x < out.x0) out.x0 = x;
            if (y < out.y0) out.y0 = y;
            if (x > out.x1) out.x1 = x;
            if (y > out.y1) out.y1 = y;
          }
          if (r > rMax) {
            calm = diff < tol ? calm + 1 : 0;
            if (calm >= 3) { done = true; break; }
          }
        }
        prevR = w.r0 + (w.rows - 1) * c.dr;
        prevRow = w.row0 + w.rows - 1;
      }
    }
    out.ms = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    this.stats.recomputeMs = (this.stats.recomputeMs || 0) + out.ms;
    if (!(out.x1 >= out.x0)) { out.x0 = out.y0 = out.x1 = out.y1 = null; }
    return out;
  }

  /** Pamięć siatki biegunowej [B] (do diagnostyki). */
  get memoryBytes() {
    let b = 0;
    for (const s of this._sectors.values()) b += s.data.byteLength;
    return b;
  }

  /** Czy sektor punktu jest już policzony (bez liczenia). */
  isReady(x, y) {
    const colF = (Math.atan2(y - this.sunY, x - this.sunX) + Math.PI) / this.dTheta;
    const c = Math.floor(colF);
    const cols = this.config.sectorColumns;
    return this._sectors.has(Math.floor((((c % this.columns) + this.columns) % this.columns) / cols))
      && this._sectors.has(Math.floor(((((c + 1) % this.columns) + this.columns) % this.columns) / cols));
  }

  /** Dolicza sektory wokół punktu (rozgrzanie przed wjazdem kamery). */
  prefetch(x, y, radius = 0) {
    const r = Math.hypot(x - this.sunX, y - this.sunY);
    const span = r > 1 ? Math.min(Math.PI, radius / r) : Math.PI;
    const theta = Math.atan2(y - this.sunY, x - this.sunX) + Math.PI;
    const c0 = Math.floor((theta - span) / this.dTheta);
    const c1 = Math.ceil((theta + span) / this.dTheta);
    const cols = this.config.sectorColumns;
    for (let c = c0; c <= c1 + cols; c += cols) {
      const cc = ((c % this.columns) + this.columns) % this.columns;
      this._sector(Math.floor(cc / cols));
    }
  }

  /**
   * Mapa kartezjańska transmitancji dla GPU (Core3D, skały tła, mgła):
   * prostokąt w układzie SCENY (x, −y świata), nx × ny tekseli, wiersz j
   * rośnie z +y sceny. Wynik 0..255 (R8).
   */
  buildSceneMap(x0, y0, w, h, nx, ny, out = new Uint8Array(nx * ny)) {
    for (let j = 0; j < ny; j++) {
      const ys = y0 + (j + 0.5) * (h / ny);
      for (let i = 0; i < nx; i++) {
        const xs = x0 + (i + 0.5) * (w / nx);
        const T = this.transmittance(xs, -ys);
        out[j * nx + i] = Math.max(0, Math.min(255, Math.round(T * 255)));
      }
    }
    return out;
  }

  clear() {
    this._sectors.clear();
  }

  /** Policzone sektory [{ index, data }] (dane w SharedArrayBuffer, gdy dostępny) — dla renderu. */
  exportSectors() {
    const out = [];
    for (const [index, s] of this._sectors) out.push({ index, data: s.data });
    return out;
  }

  /**
   * Gotowe sektory innego egzemplarza tej samej siatki (to samo pole i konfiguracja) — render
   * nie liczy cienia pól drugi raz. Po `precomputed` źródła bez limitu cache (jak precomputeAll).
   */
  adoptSectors(list, { precomputed = true } = {}) {
    for (let i = 0; i < list.length; i++) {
      const { index, data } = list[i];
      if (!(data && data.length === this.config.sectorColumns * this.rows)) continue;
      this._sectors.set(index, { data, tick: ++this._tick });
    }
    if (precomputed) {
      this.config.maxSectors = Infinity;
      this.precomputed = true;
    }
    return this;
  }
}
