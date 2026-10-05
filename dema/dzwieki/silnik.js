// Silnik syntezy dźwięków — demo dema/dzwieki.html.
//
// Bez plików audio: każdy dźwięk składa się na żywo z oscylatorów, szumów, filtrów i obwiedni
// (Web Audio). Moduł nie dotyka DOM — działa na AudioContext (na żywo) i OfflineAudioContext
// (pomiar, eksport WAV), więc da się go wpiąć do gry bez zmian.
//
// Głos (Voice) = jeden dźwięk z łańcuchem przestrzennym: odległość (filtr dolnoprzepustowy,
// głośność, więcej pogłosu z daleka) i panorama. Szyna: głosy → suma → kompresor → miękki
// ogranicznik → głośność → analizator → wyjście; pogłos (splot z wyliczoną odpowiedzią
// impulsową) dostaje wysyłkę z każdego głosu.
//
// Dźwięk ciągły (silnik, wiązka, seria) zwraca uchwyt (Handle): `set(nazwa, wartość)` zmienia
// parametr na żywo, `release(t)` wygasza. Zdarzenia powtarzalne (strzały serii, losowe zdarzenia
// tła) planuje pętla `E.loop` — na żywo z wyprzedzeniem LOOKAHEAD, offline od razu do końca.
//
// Losowość: własny generator (mulberry32), nigdy Math.random — w grze Math.random to sekwencja
// rozgrywki (AGENTS.md); wariacja dźwięków ma osobny strumień jak wizualia (fxRandom).

const NOISE_SECONDS = 4;
const LOOKAHEAD = 0.15; // s — pętle zdarzeń planują tyle naprzód (zegar JS co ~25 ms)
const REVERB_SECONDS = 2.6;
const BASIC_WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle']);
// Makeup DynamicsCompressor (próg −10 dB, kolano 8, 3:1) w stanie ustalonym: +2,5 dB
// (pomiar offline: cichy dźwięk z szyną i bez). Kompresor dochodzi do niego po ~0,5 s od startu
// kontekstu — render offline ma rozbieg (pomiar.js). Zmiana nastaw kompresora = nowy pomiar.
const COMP_TRIM = 0.748;
// współczynniki sinusów kolejnych harmonicznych (indeks 0 = składowa stała)
const WAVES = {
  warm: [0, 1, 0.5, 0.3, 0.16, 0.08, 0.04],
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const dbToGain = (db) => Math.pow(10, db / 20);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parametry dźwięku: wartości domyślne z definicji nadpisane podanymi. */
export function paramDefaults(def, params = {}) {
  const p = {};
  for (const q of def.params || []) p[q.id] = params[q.id] ?? q.value;
  return p;
}

// ---------------------------------------------------------------------------------------------
// Bufory szumu (raz na kontekst): biały, różowy, brązowy, trzaski. Pętle bez szwu.

function normalizeRms(a, rms) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  const k = rms / Math.sqrt(s / a.length || 1);
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

function normalizePeak(a, peak) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  const k = peak / (m || 1);
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

function buildNoise(ctx, seed) {
  const rnd = mulberry32(seed);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * NOISE_SECONDS);
  const fade = Math.floor(sr * 0.05);
  // Pętla bez szwu: początek bufora przenika się z dalszym ciągiem końca.
  const seamless = (fill) => {
    const raw = new Float32Array(n + fade);
    fill(raw);
    const out = raw.slice(0, n);
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      out[i] = raw[i] * Math.sqrt(w) + raw[n + i] * Math.sqrt(1 - w);
    }
    return out;
  };
  const white = seamless((a) => {
    for (let i = 0; i < a.length; i++) a[i] = rnd() * 2 - 1;
  });
  const pink = seamless((a) => {
    // filtr Paula Kelleta: −3 dB na oktawę
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < a.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  });
  const brown = seamless((a) => {
    // całka szumu z upływem: −6 dB na oktawę powyżej ~150 Hz
    let y = 0;
    for (let i = 0; i < a.length; i++) {
      y = (y + 0.02 * (rnd() * 2 - 1)) / 1.02;
      a[i] = y;
    }
  });
  const crackle = seamless((a) => {
    // rzadkie trzaski: impulsy Poissona (~90 na s), amplitudy z długim ogonem, krótkie zaniki
    a.fill(0);
    let i = 0;
    for (;;) {
      i += 1 + Math.floor((-Math.log(1 - rnd()) / 90) * sr);
      if (i >= a.length) break;
      const amp = Math.pow(rnd(), 2.2) * (rnd() < 0.5 ? -1 : 1);
      const len = 4 + Math.floor(rnd() * rnd() * 90);
      for (let k = 0; k < len && i + k < a.length; k++) {
        a[i + k] += amp * (rnd() * 2 - 1) * Math.exp(-k / (len * 0.3));
      }
    }
  });
  normalizeRms(white, 0.3);
  normalizeRms(pink, 0.3);
  normalizeRms(brown, 0.3);
  normalizePeak(crackle, 1);
  const out = {};
  for (const [name, data] of [['white', white], ['pink', pink], ['brown', brown], ['crackle', crackle]]) {
    const b = ctx.createBuffer(1, n, sr);
    b.copyToChannel(data, 0);
    out[name] = b;
  }
  return out;
}

// Odpowiedź impulsowa pogłosu: gęsty szum z zanikiem (−60 dB na końcu), ogon ciemnieje,
// kilka wyraźnych wczesnych odbić (metal kadłuba). Kanały zdekorelowane.
function buildImpulse(ctx, seconds, seed) {
  const rnd = mulberry32(seed);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const taps = [
    [[0.011, 0.5], [0.019, -0.38], [0.029, 0.32], [0.043, -0.26], [0.061, 0.2]],
    [[0.013, 0.48], [0.023, -0.4], [0.031, 0.3], [0.047, -0.24], [0.067, 0.18]],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fc = 900 + 9000 * Math.exp(-t * 2.2);
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      y = (1 - a) * (rnd() * 2 - 1) + a * y;
      d[i] = y * Math.exp((-t * 6.9) / seconds) * Math.min(1, t / 0.012);
    }
    for (const [tt, g] of taps[ch]) {
      const k = Math.floor(tt * sr);
      for (let j = 0; j < 32 && k + j < n; j++) d[k + j] += g * Math.exp(-j / 6) * (j % 2 ? -0.5 : 1);
    }
    buf.copyToChannel(d, ch);
  }
  return buf;
}

// Miękki ogranicznik: liniowo do 0,8, potem tanh do 1. Przed nim ×0,5, więc krzywa obejmuje ±2.
function softClipCurve() {
  const n = 4096;
  const k = 0.8;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    const y = ax <= k ? ax : k + (1 - k) * Math.tanh((ax - k) / (1 - k));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------

export class SoundEngine {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{ seed?: number, realtime?: boolean, bypassMaster?: boolean, reverb?: number }} [opts]
   *   realtime: false — OfflineAudioContext: pętle zdarzeń planowane od razu (`pumpAll`).
   *   bypassMaster: true — bez kompresora i ogranicznika (pomiar poziomów przepisów).
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.realtime = opts.realtime !== false;
    this.rand = mulberry32(opts.seed ?? 0x5eed);
    this.space = { dist: 0, pan: 0 }; // domyślna pozycja dźwięków bez własnej
    this.voices = new Set();
    this.handles = new Set();
    this.jobs = new Set();
    this._timer = 0;
    this._pumping = false;
    this._curves = new Map();
    this._waves = new Map();
    this.buffers = buildNoise(ctx, 0x9e3779b9);
    this._buildBus(opts.bypassMaster === true);
    this.setReverb(opts.reverb ?? 0.5);
  }

  _buildBus(bypass) {
    const c = this.ctx;
    this.sfx = c.createGain();
    this.reverbIn = c.createGain();
    this.convolver = c.createConvolver();
    this.convolver.buffer = buildImpulse(c, REVERB_SECONDS, 0x1234567);
    this.reverbOut = c.createGain();
    this.mix = c.createGain();
    this.sfx.connect(this.mix);
    this.reverbIn.connect(this.convolver);
    this.convolver.connect(this.reverbOut);
    this.reverbOut.connect(this.mix);
    this.master = c.createGain();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    // poniżej ~25 Hz nic nie słychać, a taki bas zjada zapas głośności (kompresor pompuje)
    this.hpf = c.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 25;
    this.hpf.Q.value = 0.7;
    this.mix.connect(this.hpf);
    if (bypass) {
      this.hpf.connect(this.master);
    } else {
      // klej: łagodna kompresja sumy (bitwa nie zlewa się w ścianę), potem miękki ogranicznik
      this.comp = c.createDynamicsCompressor();
      // atak 12 ms: transjent (trzask wylotu) przechodzi, kompresor ścisza dopiero korpus huku;
      // szczyty łapie miękki ogranicznik
      this.comp.threshold.value = -10;
      this.comp.knee.value = 8;
      this.comp.ratio.value = 3;
      this.comp.attack.value = 0.012;
      this.comp.release.value = 0.25;
      // DynamicsCompressor sam dokłada wzmocnienie (makeup); `trim` je znosi, żeby cichy dźwięk
      // przechodził bez zmian, a kompresor tylko ściszał głośne szczyty
      this.trim = c.createGain();
      this.trim.gain.value = COMP_TRIM;
      this.clipIn = c.createGain();
      this.clipIn.gain.value = 0.5;
      this.clip = c.createWaveShaper();
      this.clip.curve = softClipCurve();
      this.clip.oversample = '4x';
      this.hpf.connect(this.comp);
      this.comp.connect(this.trim);
      this.trim.connect(this.clipIn);
      this.clipIn.connect(this.clip);
      this.clip.connect(this.master);
    }
    this.master.connect(this.analyser);
    this.analyser.connect(c.destination);
  }

  setVolume(v) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setReverb(v) {
    this.reverbOut.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Czas startu nowego dźwięku (na żywo — z zapasem na planowanie). */
  now() {
    return this.realtime ? this.ctx.currentTime + 0.03 : 0.02;
  }

  /** x ± amt·x (wariacja). */
  vary(x, amt) {
    return x * (1 + (this.rand() * 2 - 1) * amt);
  }

  /** Liczba równomiernie z [a, b). */
  pick(a, b) {
    return a + (b - a) * this.rand();
  }

  // Odległość 0 (przy kamerze) … 1 (daleko): ciszej, ciemniej, więcej pogłosu.
  distGain(d) {
    return 1 / (1 + 4 * d * d);
  }

  distCutoff(d) {
    return 900 + 19000 * Math.pow(1 - d, 2.4);
  }

  reverbSend(d) {
    return 0.18 + 0.6 * d;
  }

  /** Wzmocnienie, z jakim szum biały (RMS 0,3) po wąskim filtrze pasmowym (f, Q) ma RMS ≈ target. */
  nbGain(f, Q, target = 0.1) {
    return target / (0.3 * Math.sqrt(Math.min(1, f / (Q * this.sr * 0.5))));
  }

  curve(kind, k) {
    const key = kind + ':' + k;
    let c = this._curves.get(key);
    if (c) return c;
    const n = 2048;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = kind === 'stairs' ? Math.round(x * k) / k : Math.tanh(k * x) / Math.tanh(k);
    }
    this._curves.set(key, c);
    return c;
  }

  /** Fala z harmonicznymi (PeriodicWave, raz na kontekst).
   *  'warm' — sinus z 2.–6. harmoniczną: bas uderzeń słychać też na małych głośnikach
   *  (brakujący ton podstawowy), a podstawa ma mniejszy szczyt niż czysty sinus. */
  wave(name) {
    let w = this._waves.get(name);
    if (w) return w;
    const H = WAVES[name];
    w = this.ctx.createPeriodicWave(new Float32Array(H.length), Float32Array.from(H));
    this._waves.set(name, w);
    return w;
  }

  /** Zatrzymuje automatykę parametru w chwili t, trzymając bieżącą wartość. */
  hold(param, t) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else param.cancelScheduledValues(t);
  }

  voice(at, opts) {
    return new Voice(this, at || {}, opts || {});
  }

  handle(voice) {
    const h = new Handle(this, voice);
    this.handles.add(h);
    return h;
  }

  /**
   * Odtwarza dźwięk z katalogu. `at`: { pan, dist, t, gain, reverb } (brak — pozycja `space`).
   * Zwraca uchwyt dźwięku ciągłego albo null.
   */
  play(def, params, at = {}) {
    const p = paramDefaults(def, params);
    const a = { ...at };
    a.gain = (a.gain ?? 1) * dbToGain(def.level ?? 0);
    if (def.ui) {
      a.dist = 0;
      a.pan = a.pan ?? 0;
      a.reverb = 0;
    }
    return def.play(this, p, a) || null;
  }

  /**
   * Pętla zdarzeń: fn(czas) planuje jedno zdarzenie i zwraca czas następnego (albo null).
   * Z uchwytem — kończy się na `release`.
   */
  loop(h, t0, fn) {
    const job = { next: t0, fn, until: h ? h.releaseAt : Infinity };
    if (h) h.jobs.push(job);
    this.jobs.add(job);
    if (this.realtime && !this._pumping) {
      this._pump(this.ctx.currentTime + LOOKAHEAD);
      this._arm();
    }
  }

  _pump(horizon) {
    this._pumping = true;
    const guardMax = this.realtime ? 512 : 100000;
    // karta w tle: zegar JS dławiony do ~1 Hz — zaległych zdarzeń nie nadrabiamy (seria zagrałaby
    // naraz jednym głośnym zlepkiem), pętla rusza od teraz
    const late = this.realtime ? this.ctx.currentTime + 0.005 : -Infinity;
    for (const j of this.jobs) {
      if (j.next != null && j.next < late) j.next = late;
      let guard = 0;
      while (j.next != null && j.next < horizon && j.next < j.until && guard++ < guardMax) j.next = j.fn(j.next);
      if (j.next == null || j.next >= j.until) this.jobs.delete(j);
    }
    this._pumping = false;
    if (!this.jobs.size && this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
  }

  _arm() {
    if (this._timer || !this.jobs.size) return;
    this._timer = setInterval(() => this._pump(this.ctx.currentTime + LOOKAHEAD), 25);
  }

  /** Offline: planuje wszystkie zdarzenia pętli do końca renderu. */
  pumpAll() {
    const end = this.ctx.length / this.sr;
    for (const j of this.jobs) if (j.until > end) j.until = end;
    this._pump(end);
  }

  /** Wycisza wszystko natychmiast (krótkie wygaszenie bez trzasku). */
  stopAll() {
    const t = this.ctx.currentTime;
    for (const h of [...this.handles]) h.release(t);
    for (const v of [...this.voices]) v.kill(t);
    this.jobs.clear();
  }
}

// ---------------------------------------------------------------------------------------------

class Handle {
  constructor(E, voice) {
    this.E = E;
    this.voice = voice;
    this.params = Object.create(null);
    this.fns = [];
    this.jobs = [];
    this.released = false;
    this.releaseAt = Infinity;
  }

  onRelease(fn) {
    this.fns.push(fn);
    return this;
  }

  set(name, value) {
    const f = this.params[name];
    if (f) f(value, this.E.realtime ? this.E.ctx.currentTime + 0.01 : this.E.now());
  }

  release(t) {
    if (this.released) return;
    this.released = true;
    const tr = t ?? this.E.now();
    this.releaseAt = tr;
    for (const j of this.jobs) j.until = tr;
    for (const f of this.fns) f(tr);
    this.E.handles.delete(this);
  }
}

// ---------------------------------------------------------------------------------------------

class Voice {
  constructor(E, at, opts) {
    const c = E.ctx;
    this.E = E;
    this.c = c;
    this.t = at.t ?? E.now();
    this.end = this.t;
    this.nodes = [];
    this.srcs = [];
    this.alive = 0;
    this.started = false;
    this.open = true;
    this.dead = false;
    this.parent = opts.parent || null;
    this.in = this.node(c.createGain());
    if (this.parent) {
      this.in.connect(this.parent.in);
    } else {
      const dist = clamp(at.dist ?? E.space.dist, 0, 1);
      this.dLp = this.node(c.createBiquadFilter());
      this.dLp.type = 'lowpass';
      this.dLp.Q.value = 0.5;
      this.dLp.frequency.value = E.distCutoff(dist);
      this.dVol = this.node(c.createGain());
      this.dVol.gain.value = E.distGain(dist) * (at.gain ?? 1);
      this.dPan = this.node(c.createStereoPanner());
      this.dPan.pan.value = clamp(at.pan ?? E.space.pan, -1, 1);
      this.dSend = this.node(c.createGain());
      this.dSend.gain.value = E.reverbSend(dist) * (at.reverb ?? 1);
      this.in.connect(this.dLp);
      this.dLp.connect(this.dVol);
      this.dVol.connect(this.dPan);
      this.dPan.connect(E.sfx);
      this.dPan.connect(this.dSend);
      this.dSend.connect(E.reverbIn);
    }
    E.voices.add(this);
  }

  node(n) {
    this.nodes.push(n);
    return n;
  }

  /** Mnożnik wysyłki na pogłos (dźwięk „w kadłubie” vs sucho). */
  wet(k) {
    if (this.dSend) this.dSend.gain.value *= k;
    return this;
  }

  // ---- źródła

  src(s, t0 = this.t, offset = 0) {
    s._t0 = t0;
    s._off = offset;
    this.srcs.push(s);
    this.nodes.push(s);
    if (this.started) this._startSrc(s);
    return s;
  }

  /** Źródło zatrzyma się samo w chwili t (zamiast na końcu głosu). */
  endOf(s, t) {
    s._end = t;
    if (this.started && !this.dead) {
      try {
        s.stop(t);
      } catch (_) {
        /* źródło już zatrzymane */
      }
    }
    return s;
  }

  osc(type, f, t0 = this.t) {
    const o = this.c.createOscillator();
    if (BASIC_WAVES.has(type)) o.type = type;
    else o.setPeriodicWave(this.E.wave(type));
    o.frequency.setValueAtTime(f, t0);
    return this.src(o, t0);
  }

  noise(kind = 'white', rate = 1, t0 = this.t) {
    const s = this.c.createBufferSource();
    s.buffer = this.E.buffers[kind];
    s.loop = true;
    s.playbackRate.setValueAtTime(rate, t0);
    return this.src(s, t0, this.E.rand() * (NOISE_SECONDS - 0.2));
  }

  // ---- przetwarzanie

  filter(type, f, Q = 0.707, t0 = this.t) {
    const b = this.node(this.c.createBiquadFilter());
    b.type = type;
    b.frequency.setValueAtTime(f, t0);
    b.Q.setValueAtTime(Q, t0);
    return b;
  }

  lp(f, Q = 0.707, t0) {
    return this.filter('lowpass', f, Q, t0);
  }

  hp(f, Q = 0.707, t0) {
    return this.filter('highpass', f, Q, t0);
  }

  bp(f, Q = 1, t0) {
    return this.filter('bandpass', f, Q, t0);
  }

  peak(f, Q, db, t0 = this.t) {
    const b = this.filter('peaking', f, Q, t0);
    b.gain.setValueAtTime(db, t0);
    return b;
  }

  gain(v = 0) {
    const g = this.node(this.c.createGain());
    g.gain.value = v;
    return g;
  }

  shaper(drive = 2, kind = 'tanh') {
    const w = this.node(this.c.createWaveShaper());
    w.curve = this.E.curve(kind, Math.round(drive * 10) / 10);
    w.oversample = '2x';
    return w;
  }

  /** Podwarstwa z własną panoramą (względem panoramy głosu), opcjonalnie stłumiona i ściszona. */
  sub({ pan = 0, lp = 0, gain = 1 } = {}) {
    const p = this.node(this.c.createStereoPanner());
    p.pan.value = clamp(pan, -1, 1);
    let tail = p;
    if (lp) {
      const f = this.lp(lp, 0.6);
      tail.connect(f);
      tail = f;
    }
    if (gain !== 1) {
      const g = this.gain(gain);
      tail.connect(g);
      tail = g;
    }
    tail.connect(this.in);
    return p;
  }

  chain(...ns) {
    for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
    return ns[ns.length - 1];
  }

  // ---- obwiednie

  until(tAbs) {
    if (tAbs > this.end) this.end = tAbs;
  }

  /** Atak liniowy do szczytu, zanik wykładniczy do −80 dB w czasie `d`. */
  ad(param, t0, peak, a, d) {
    if (!(peak > 0)) return;
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    param.exponentialRampToValueAtTime(peak * 1e-4, t0 + a + d);
    param.setValueAtTime(0, t0 + a + d + 0.002);
    this.until(t0 + a + d + 0.01);
  }

  /** Obwiednia z punktów [czas względem t0, wartość, 's' | 'l' | 'e']. */
  env(param, t0, pts, extend = false) {
    for (const [dt, v, k] of pts) {
      const tt = t0 + dt;
      if (k === 'e') param.exponentialRampToValueAtTime(Math.max(v, 1e-6), tt);
      else if (k === 'l') param.linearRampToValueAtTime(v, tt);
      else param.setValueAtTime(v, tt);
      if (extend) this.until(tt + 0.01);
    }
  }

  // ---- klocki

  /** Uderzenie: fala ze spadkiem częstotliwości f0 → f1 w `sweep`, zanik w `decay`.
   *  drive > 0 — przester tanh po obwiedni (harmoniczne słychać na małych głośnikach,
   *  ciszej = czyściej, jak w prawdziwym nasyceniu). */
  thump(t0, f0, f1, sweep, decay, peak, { type = 'warm', drive = 0, attack = 0.0015, out = this.in } = {}) {
    if (!(peak > 0)) return null;
    const o = this.osc(type, f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + sweep);
    const a = this.gain(0);
    this.endOf(o, t0 + attack + decay + 0.01);
    if (drive > 0) {
      this.ad(a.gain, t0, 1, attack, decay);
      const g = this.gain(peak);
      this.chain(o, a, this.shaper(drive), g, out);
      return g;
    }
    this.ad(a.gain, t0, peak, attack, decay);
    this.chain(o, a, out);
    return a;
  }

  /** Wybuch szumu przez filtr; f1 > 0 — przemiatanie częstotliwości f → f1 w czasie `sweep`. */
  burst(t0, kind, { type = 'bandpass', f = 1000, f1 = 0, sweep = 0.1, Q = 0.707, attack = 0.002, decay = 0.2, peak = 0.5, rate = 1, out = this.in } = {}) {
    if (!(peak > 0)) return null;
    const s = this.noise(kind, rate, t0);
    const b = this.filter(type, f, Q, t0);
    if (f1 > 0) b.frequency.exponentialRampToValueAtTime(f1, t0 + sweep);
    const a = this.gain(0);
    this.ad(a.gain, t0, peak, attack, decay);
    this.endOf(s, t0 + attack + decay + 0.01);
    this.chain(s, b, a, out);
    return a;
  }

  /** Trzaski (iskrzenie, ogień, rwanie blachy). */
  crackle(t0, { rate = 1, f = 2500, Q = 0.7, attack = 0.01, decay = 0.5, peak = 0.3, out = this.in } = {}) {
    return this.burst(t0, 'crackle', { type: 'bandpass', f, Q, attack, decay, peak, rate, out });
  }

  /** Drgania własne (metal): sinusy o niecałkowitych stosunkach, każdy z własnym zanikiem. */
  modal(t0, f0, ratios, amps, decays, peak, { out = this.in, detune = 0 } = {}) {
    for (let i = 0; i < ratios.length; i++) {
      const f = f0 * ratios[i] * (1 + detune * (this.E.rand() * 2 - 1));
      if (f > 16000 || !(amps[i] > 0)) continue;
      const o = this.osc('sine', f, t0);
      const a = this.gain(0);
      this.ad(a.gain, t0, peak * amps[i], 0.0008, decays[i]);
      this.endOf(o, t0 + decays[i] + 0.012);
      this.chain(o, a, out);
    }
  }

  /** Brzęk metalu: klik uderzenia + kilka drgań własnych płyty. */
  clank(t0, f0, peak, { decay = 1, out = this.in } = {}) {
    const R = [1, 2.32, 3.87, 5.21, 6.9];
    const A = [1, 0.7, 0.5, 0.36, 0.22];
    const D = [0.32, 0.2, 0.14, 0.1, 0.07].map((d) => d * decay);
    this.modal(t0, f0, R, A, D, peak * 0.55, { out, detune: 0.01 });
    this.burst(t0, 'white', { type: 'bandpass', f: Math.min(f0 * 6, 9000), Q: 1.2, attack: 0.0004, decay: 0.03, peak: peak * 0.9, out });
  }

  /** Jęk konstrukcji: piła przez wąski filtr; harmoniczne przesuwają się przez rezonans. */
  groan(t0, { f = 55, res = 420, dur = 0.8, peak = 0.2, out = this.in } = {}) {
    const E = this.E;
    const o = this.osc('sawtooth', f, t0);
    o.frequency.linearRampToValueAtTime(f * E.pick(0.8, 1.25), t0 + dur);
    const lfo = this.osc('sine', E.pick(3, 7), t0);
    const lg = this.gain(f * 0.06);
    this.chain(lfo, lg);
    lg.connect(o.frequency);
    const b = this.bp(res, 14, t0);
    b.frequency.linearRampToValueAtTime(res * E.pick(0.7, 1.4), t0 + dur);
    const a = this.gain(0);
    this.env(a.gain, t0, [[0, 0, 's'], [dur * 0.25, peak * 10, 'l'], [dur, peak * 0.01, 'e']], true);
    this.endOf(o, t0 + dur + 0.01);
    this.endOf(lfo, t0 + dur + 0.01);
    this.chain(o, b, a, out);
  }

  /** Krótki ton (interfejs, czujniki). */
  beep(t0, f, dur, peak, { type = 'sine', out = this.in, lp = 0 } = {}) {
    const o = this.osc(type, f, t0);
    const a = this.gain(0);
    this.env(a.gain, t0, [[0, 0, 's'], [0.003, peak, 'l'], [Math.max(0.004, dur - 0.012), peak, 'l'], [dur, 0, 'l']], true);
    this.endOf(o, t0 + dur + 0.005);
    if (lp) this.chain(o, this.lp(lp, 0.7, t0), a, out);
    else this.chain(o, a, out);
  }

  // ---- cykl życia

  start() {
    if (this.started) return this;
    this.started = true;
    for (const s of this.srcs) this._startSrc(s);
    return this;
  }

  _startSrc(s) {
    s.start(s._t0, s._off || 0);
    this.alive++;
    s.onended = () => {
      if (--this.alive <= 0 && !this.open) this._cleanup();
    };
    if (s._end != null) s.stop(s._end);
  }

  /** Dźwięk jednorazowy: start i koniec po ostatniej obwiedni. */
  finish(extra = 0.05) {
    this.start();
    this.stop(this.end + extra);
    return this;
  }

  stop(t) {
    if (!this.open) return;
    this.open = false;
    for (const s of this.srcs) {
      const te = s._end != null ? Math.min(s._end, t) : t;
      try {
        s.stop(te);
      } catch (_) {
        /* już zatrzymane */
      }
    }
    if (this.alive <= 0) this._cleanup();
  }

  kill(t) {
    if (this.dead) return;
    if (!this.started) {
      this.open = false;
      this._cleanup();
      return;
    }
    const g = this.dVol ? this.dVol.gain : this.in.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(0, t, 0.012);
    this.open = false;
    for (const s of this.srcs) {
      try {
        s.stop(t + 0.1);
      } catch (_) {
        /* już zatrzymane */
      }
    }
  }

  _cleanup() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch (_) {
        /* już odłączony */
      }
    }
    this.E.voices.delete(this);
  }
}
