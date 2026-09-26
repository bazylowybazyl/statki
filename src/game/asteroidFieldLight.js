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
    return m.weight * (c.sigmaBase + c.sigmaField * Math.pow(Math.max(0, m.cluster), c.fieldPower)) * (this.field.densityScale ?? 1);
  }

  _sector(index) {
    let s = this._sectors.get(index);
    if (s) {
      s.tick = ++this._tick;
      return s;
    }
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const cols = this.config.sectorColumns;
    const data = new Float32Array(cols * this.rows).fill(1);
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
}
