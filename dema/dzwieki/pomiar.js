// Render offline, pomiar i eksport WAV dźwięków z dema/dzwieki.html.
//
// Pomiar: szczyt, głośność chwilowa (LUFS-M, okno 400 ms, filtr K z ITU-R BS.1770 dla 48 kHz),
// czas do −60 dBFS, środek ciężkości widma i udział pasm. Służy do wyrównania poziomów przepisów
// (każdy dźwięk ma `level` w dB) i do sprawdzenia, że nic nie przesterowuje ani nie daje NaN.
import { SoundEngine, paramDefaults } from './silnik.js';

export const MEASURE_SR = 48000;
export const REVERB_TAIL = 2.8;
// Rozbieg: kompresor szyny dochodzi do stanu ustalonego (na żywo zawsze w nim jest);
// wycinany z wyniku poza ostatnimi 20 ms.
const PREROLL = 0.5;

/**
 * Renderuje dźwięk offline. Dźwięk ciągły trzyma `hold` sekund (albo `def.wavHold`).
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSound(def, params = {}, opts = {}) {
  const { seed = 7, at = {}, bypassMaster = false, reverb = 0.5, sr = MEASURE_SR } = opts;
  const hold = opts.hold ?? def.wavHold ?? 2;
  const p = paramDefaults(def, params);
  const dur = PREROLL + def.length(p, hold) + REVERB_TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const E = new SoundEngine(ctx, { seed, realtime: false, bypassMaster, reverb });
  const t0 = PREROLL;
  const h = E.play(def, p, { pan: 0, dist: 0, ...at, t: t0 });
  if (h && def.hold) h.release(t0 + hold);
  E.pumpAll();
  const full = await ctx.startRendering();
  const skip = Math.floor((PREROLL - 0.02) * sr);
  const out = new AudioBuffer({ length: full.length - skip, numberOfChannels: full.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < full.numberOfChannels; c++) out.copyToChannel(full.getChannelData(c).subarray(skip), c);
  return out;
}

// Filtr K (BS.1770) dla 48 kHz: półka wysokich +4 dB, potem górnoprzepustowy RLB.
const K1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const K2 = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const BANDS = [[0, 100], [100, 500], [500, 2000], [2000, 8000], [8000, 24000]];

export function analyze(buf) {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const sr = buf.sampleRate;
  let peak = 0;
  let bad = 0;
  let clip = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i];
    const b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      bad++;
      continue;
    }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m >= 0.999) clip++;
    if (m > 0.001) last = i;
  }
  // głośność chwilowa: maksimum z okien 400 ms co 100 ms
  const kL = biquad(biquad(L, K1), K2);
  const kR = biquad(biquad(R, K1), K2);
  const ps = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + kL[i] * kL[i] + kR[i] * kR[i];
  const win = Math.min(n, Math.round(0.4 * sr));
  const hop = Math.round(0.1 * sr);
  let lufsM = -Infinity;
  for (let s = 0; s + win <= n; s += hop) {
    const ms = (ps[s + win] - ps[s]) / win;
    const l = -0.691 + 10 * Math.log10(ms + 1e-20);
    if (l > lufsM) lufsM = l;
  }
  // widmo średnie z ramek 4096 (Hann), tylko ramki powyżej −60 dBFS RMS
  const N = 4096;
  const pow = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s + N <= n; s += N) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = 0.5 * (L[s + i] + R[s + i]);
      e += v * v;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    if (e / N < 1e-6) continue;
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
  }
  let tot = 0;
  let cen = 0;
  const bands = BANDS.map(() => 0);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    tot += pow[k];
    cen += pow[k] * f;
    for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b][0] && f < BANDS[b][1]) bands[b] += pow[k];
  }
  return {
    peakDb: 20 * Math.log10(peak + 1e-12),
    lufsM,
    tail: last / sr,
    centroid: tot > 0 ? cen / tot : 0,
    bands: bands.map((b) => (tot > 0 ? Math.round((100 * b) / tot) : 0)),
    bad,
    clip,
    dur: n / sr,
  };
}

/** 16-bitowy WAV PCM. */
export function encodeWav(buf) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i] || 0));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([dv], { type: 'audio/wav' });
}
