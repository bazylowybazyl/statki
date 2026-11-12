// src/render/frameLimiter.js — LIMIT KLATEK (Opcje → Grafika, 2026-10-29): które wywołania rAF rysują klatkę.
//
// Po co: przy 5120 × 1440 i 240 kl/s karta pracuje na pełnym obciążeniu i hałasuje; limit 120 przy ekranie 240 Hz to
// ~połowa pracy GPU. Pętla gry strony (index.html, `loop()`) i tło menu (MenuBackdrop3D — na stronie w trybie off,
// w workerze w trybie worker) wołają `tick(znacznik rAF)` w KAŻDYM wywołaniu rAF; false = klatka pominięta (bez wejścia,
// fizyki, migawki i rysunku — worker renderuje tylko nowe strony migawki, więc karta liczy tylko klatki narysowane).
//
// Okres ekranu z ostatnich 64 odstępów rAF (od 8 odstępów): MEDIANA SKUPISKA NAJKRÓTSZYCH — odstępy krótsze niż
// 1,5 × drugi najkrótszy. Znaczniki rAF leżą na siatce vsync: klatka spóźniona daje odstęp 2–3 okresów (poza
// skupiskiem), więc okres zostaje okresem ekranu także wtedy, gdy klatki narysowane często chybiają vsynca (percentyl
// spadał wtedy do 2 okresów i takt się rozjeżdżał); mediana zamiast minimum — drgania znaczników (headless z taktem:
// ±0,1 ms) nie zaniżają okresu (minimum dawało 247 Hz przy 241 Hz); drugi najkrótszy — pojedynczy fałszywie krótki
// odstęp nie wyznacza skupiska.
// Tryby (`mode`):
//   'off'   — bez limitu: każda klatka;
//   'every' — ekran nie szybszy niż limit (+3%) albo okres jeszcze nieznany — każda klatka;
//   'nth'   — częstotliwość ekranu ≈ wielokrotność limitu (±3%: 240 Hz → 120 / 60, 239,76 Hz → 60): co N-ta klatka
//             ekranu, licząc vsynce od ostatniej narysowanej z czasu (round(odstęp / okres) ≥ N) — równy takt także
//             po chybionej klatce. Akumulator czasu przy 239,76 Hz i limicie 60 co ~2 s rysowałby po 3 vsyncach;
//   'acc'   — inna częstotliwość (144 Hz przy limicie 60, 240 Hz przy 144): akumulator czasu, klatka na vsyncu
//             najbliższym chwili należnej (próg: interwał − pół okresu) — średnio dokładnie limit, odstępy 2–3 okresy;
//   'time'  — bez VSync (Electron, opcja grafiki: rAF bez taktu ekranu) — akumulator z progiem 0,5 ms; `waitMs` mówi,
//             ile czekać do następnej klatki (pętla gry bez rAF — budzik src/render/frameWake.js); odstęp 0
//             (wywołania szybciej niż rozdzielczość zegara) = czas nie płynie, bez klatki.
// `stats.hist[k]` — odstępy kolejnych narysowanych klatek w okresach ekranu (narzędzia: równy takt = jeden kubełek).
// `bypass` (funkcja → true) — wywołanie bez limitu i bez zmiany stanu: harness narzędzi z zegarem wirtualnym (znaczniki
// rAF stoją albo skaczą o krok — co N-ta klatka zatrzymałaby obraz); podaje go strona (moduły renderu nie czytają okna).
// `forceNext()` — najbliższe wywołanie rysuje i liczy od siebie (zmiana rozmiaru okna wyczyściła kanwę).
// Czysty moduł (bez DOM, three i window) — strona i worker. Bez alokacji w `tick`.

export const FRAME_LIMIT_TUNE = {
  samples: 64,        // odstępy rAF w oknie okresu ekranu
  minSamples: 8,      // mniej — okres nieznany (tryb 'every')
  tolerance: 0.03,    // wielokrotność ±3% → co N-ta klatka; ekran ≤ limit · 1,03 → każda
  maxGapMs: 100,      // dłuższy odstęp (karta w tle, pauza rAF, przycięcie) — poza oknem, limit od nowa
  timeSlackMs: 0.5    // tryb 'time': klatka rysowana do 0,5 ms przed chwilą należną
};

const HIST = 16;

export class FrameLimiter {
  /** @param {{ fps?: number, vsync?: boolean, tune?: typeof FRAME_LIMIT_TUNE }} [o] */
  constructor({ fps = 0, vsync = true, tune = FRAME_LIMIT_TUNE } = {}) {
    this.tune = tune;
    this.fps = 0;
    this.vsync = true;
    this.periodMs = 0;     // okres rAF (ekranu) [ms]; 0 — nieznany
    this.mode = 'off';
    this.every = 1;        // N w trybie 'nth'
    this._gaps = new Float64Array(tune.samples);
    this._sorted = new Float64Array(tune.samples);
    this._gapN = 0;
    this._last = NaN;      // poprzednie wywołanie (znacznik rAF)
    this._lastDraw = NaN;  // ostatnia narysowana klatka
    this._acc = 0;         // tryby 'acc' / 'time': czas od chwili należnej poprzedniej klatki
    this._force = false;   // forceNext
    this.bypass = null;    // () => boolean — true: wywołanie bez limitu (zegar wirtualny harnessu)
    this.stats = { ticks: 0, drawn: 0, hist: new Int32Array(HIST) };
    this.setFps(fps);
    this.setVsync(vsync);
  }

  /** Limit [kl/s]; 0 (albo nie liczba) — bez limitu. */
  setFps(fps) {
    const v = Number(fps);
    const f = Number.isFinite(v) && v > 0 ? v : 0;
    if (f === this.fps) return;
    this.fps = f;
    this._lastDraw = NaN;
    this._acc = 0;
    this._pickMode();
  }

  /** VSync tego uruchomienia; false — klatek nie taktuje ekran (limit czasem). */
  setVsync(on) {
    const v = on !== false;
    if (v === this.vsync) return;
    this.vsync = v;
    this._lastDraw = NaN;
    this._acc = 0;
    this._pickMode();
  }

  get intervalMs() { return this.fps > 0 ? 1000 / this.fps : 0; }
  get hz() { return this.periodMs > 0 ? 1000 / this.periodMs : 0; }

  /** Każde wywołanie rAF (`now` — znacznik rAF): true — rysuj tę klatkę. */
  tick(now) {
    if (this.bypass !== null && this.bypass()) return true;
    const st = this.stats;
    st.ticks++;
    const gap = now - this._last;
    this._last = now;
    if (gap > 0 && gap <= this.tune.maxGapMs) this._addGap(gap);
    const mode = this.mode;
    const since = now - this._lastDraw;   // NaN — jeszcze bez narysowanej klatki
    const force = this._force;
    this._force = false;
    let draw;
    if (mode === 'off' || mode === 'every') draw = true;
    else if (force || !(gap >= 0) || gap > this.tune.maxGapMs || !(since >= 0)) {
      // pierwsze wywołanie, przerwa (karta w tle), zegar cofnięty albo forceNext — rysuj i licz od tej klatki
      draw = true;
      this._acc = 0;
    } else if (mode === 'nth') {
      draw = Math.round(since / this.periodMs) >= this.every;
    } else {
      // odstęp 0 (wywołania szybciej niż rozdzielczość zegara — budzik bez VSync) = czas nie płynie: bez klatki
      const I = 1000 / this.fps;
      const slack = mode === 'time' ? this.tune.timeSlackMs : 0.5 * this.periodMs;
      const acc = Math.min(this._acc + gap, I + Math.max(this.periodMs, this.tune.timeSlackMs));
      draw = acc >= I - slack - 1e-6;
      this._acc = draw ? acc - I : acc;
    }
    if (draw) {
      const P = this.periodMs;
      if (P > 0 && since >= 0) {
        const k = Math.round(since / P);
        st.hist[k >= HIST ? HIST - 1 : k]++;
      }
      this._lastDraw = now;
      st.drawn++;
    }
    return draw;
  }

  /** Najbliższe wywołanie `tick` rysuje bez limitu i liczy takt od siebie (kanwa wyczyszczona zmianą rozmiaru okna). */
  forceNext() { this._force = true; }

  /** Wywołanie rAF bez decyzji (pętla wejścia w menu): sam okres ekranu — notka w opcjach jeszcze przed grą. */
  observe(now) {
    const gap = now - this._last;
    this._last = now;
    if (gap > 0 && gap <= this.tune.maxGapMs) this._addGap(gap);
  }

  /**
   * Tryb 'time' (bez VSync): ile ms od `now` do następnej klatki (bez `now` — od ostatniego `tick`; po klatce
   * narysowanej `now` = jej koniec). Inne tryby — 0 (następne wywołanie rAF przychodzi z taktem ekranu).
   */
  waitMs(now = this._last) {
    if (this.mode !== 'time') return 0;
    const since = now - this._last;
    const w = 1000 / this.fps - this.tune.timeSlackMs - this._acc - (since > 0 ? since : 0);
    return w > 0 ? w : 0;
  }

  /** Krótki opis stanu (PerfHUD): cel limitu i takt. */
  describe() {
    const hz = this.periodMs > 0 ? `${Math.round(this.hz)} Hz` : '? Hz';
    const fps = Math.round(this.fps);
    switch (this.mode) {
      case 'off': return this.vsync ? `bez limitu · ekran ${hz}` : 'bez limitu · bez VSync';
      case 'every': return `${fps} · ekran ${hz} — każda klatka`;
      case 'nth': return `${fps} · co ${this.every}. klatka ekranu ${hz}`;
      case 'acc': return `${fps} · ekran ${hz} — takt nierówny`;
      default: return `${fps} · bez VSync — zegar`;
    }
  }

  _addGap(gap) {
    const g = this._gaps;
    g[this._gapN % g.length] = gap;
    this._gapN++;
    const n = Math.min(this._gapN, g.length);
    // pierwsze oszacowanie od razu, potem co 8 odstępów
    if (n < this.tune.minSamples || (this.periodMs > 0 && (this._gapN & 7) !== 0)) return;
    const s = this._sorted;
    for (let i = 0; i < n; i++) {
      const v = g[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
      s[j + 1] = v;
    }
    const edge = 1.5 * s[1];
    let k = 2;
    while (k < n && s[k] < edge) k++;
    const p = s[(k - 1) >> 1];
    if (p !== this.periodMs) {
      this.periodMs = p;
      this._pickMode();
    }
  }

  _pickMode() {
    const f = this.fps;
    let mode = 'every', every = 1;
    if (!(f > 0)) mode = 'off';
    else if (!this.vsync) mode = 'time';
    else if (this.periodMs > 0) {
      // klatek ekranu na klatkę limitu
      const r = 1000 / (this.periodMs * f);
      const n = Math.round(r);
      const tol = this.tune.tolerance;
      if (r <= 1 + tol) mode = 'every';
      else if (Math.abs(r - n) <= tol * n) { mode = 'nth'; every = n; }
      else mode = 'acc';
    }
    if (mode !== this.mode && (mode === 'acc' || mode === 'time')) this._acc = 0;
    this.mode = mode;
    this.every = every;
  }
}
