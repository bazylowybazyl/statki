// src/3d/planetGen/planetGenTerrainMap.js
//
// MAPA TERENU — trzeci poziom szczegółowości planety (po widoku z orbity i zbliżeniu): wycinek kilkudziesięciu
// kilometrów generowany na żądanie dla jednego MIEJSCA (cel ostrzału z orbity, strefa desantu). Planeta mówi, co tam
// jest (biom, rzeka, brzeg, rzeźba); tu powstaje krajobraz w skali, w której widać koryto rzeki, łachy, torfowiska
// i skraj lasu (teksel ~10–20 m). Zbliżenie planety tego nie pokaże: jego najdrobniejsza dana (komórka sieci
// rzecznej) ma kilkanaście kilometrów.
//
// Czysty JS (bez three, GPU i DOM) — działa w przeglądarce, w workerze i w Node (testy, zrzuty PNG). Wynik to
// warstwy rastrowe: barwa (albedo sRGB), wysokość, pokrycie terenu (klasy — także dla rozgrywki: woda, las, otwarty
// teren), oś rzeki i starorzecza. Losowość tylko z ziarna (planetGenRng.js).
//
// BIOM „tajga z rzeką nizinną” (wzorzec: zdjęcie satelitarne od użytkownika — ciemny, chłodny las, jasne beżowe
// torfowiska rozgałęzione wzdłuż cieków i w „plaster miodu”, rzeka o ciemnej wodzie w ciasnych zakolach, jasne łachy,
// soczyście zielona dolina z łukami dawnych koryt):
//   1. RZEKA — symulacja wędrówki koryta (model Howarda–Knutsona w postaci z meanderpy Z. Sylvestra): prędkość
//      przesuwania brzegu z krzywizny odcinka i ważonej krzywizny w górę rzeki; zakola rosną, wędrują i odcinają
//      się (starorzecza). Co kilka kroków koryto odciska się w rastrze „kiedy ostatnio płynęła tu rzeka” — z niego
//      wychodzą same: łachy (teren świeżo opuszczony po wewnętrznej stronie zakola), łuki dawnych koryt (pasy
//      równego wieku), zasięg doliny zalewowej o poszarpanym brzegu i sukcesja roślin od piasku do lasu.
//   2. RZEŹBA — łagodne wzgórza (szum), dno doliny tam, gdzie kiedykolwiek płynęła rzeka.
//   3. CIEKI — spływ wody po rzeźbie (planetGenDrainage.js w trybie mapy lokalnej): strumienie do rzeki i poza mapę.
//   4. TORFOWISKA — wysokość nad najbliższym ciekiem (mała = mokro): pasma wzdłuż drobnych cieków, szerokie płaty
//      na płaskim; wyspy drzew w komórkach („plaster miodu”); wzdłuż większych strumieni ciemny pas łęgu.
//   5. BARWY — klasy pokrycia z palety zdjęć + cieniowanie rzeźby i WYSOKOŚCI KORON (skraj lasu rzuca cień — to on
//      daje zdjęciom satelitarnym ostrość granic las / polana).
import { makeRng, mix32 } from './planetGenRng.js';
import { computeDrainage } from './planetGenDrainage.js';

/** Klasy pokrycia terenu (warstwa `cover`). */
export const TERRAIN_COVER = Object.freeze({ WATER: 0, SAND: 1, MEADOW: 2, SHRUB: 3, FOREST: 4, FEN: 5 });
export const TERRAIN_MAP_BIOMES = Object.freeze(['tajga']);

// ── Szum wartości 2D (krata z haszu, wygładzenie kwintyczne), wynik −1…1 ─────────────────────────────────────────
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27D4EB2D) ^ Math.imul(iy, 0x165667B1) ^ Math.imul(seed, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return ((a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy) * 2 - 1;
}
function fbm(x, y, oct, seed, gain = 0.5) {
  let f = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    f += amp * vnoise(x, y, seed + o * 131);
    norm += amp;
    amp *= gain;
    const nx = x * 1.62 + y * 1.18 + 3.7;
    y = (y * 1.62 - x * 1.18) - 1.3;
    x = nx;
  }
  return f / norm;
}
/** Pole szumu w kracie n × n (częstość = liczba fal na bok mapy); próbkowane dwuliniowo (`sample`). */
function noiseField(n, freq, oct, seed, gain = 0.5) {
  const f = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f[y * n + x] = fbm(x / n * freq, y / n * freq, oct, seed, gain);
  return { f, n };
}
function sample(F, u, v) {
  const n = F.n;
  let x = u * n - 0.5;
  let y = v * n - 0.5;
  if (x < 0) x = 0; else if (x > n - 1.001) x = n - 1.001;
  if (y < 0) y = 0; else if (y > n - 1.001) y = n - 1.001;
  const ix = x | 0;
  const iy = y | 0;
  const fx = x - ix;
  const fy = y - iy;
  const i = iy * n + ix;
  const f = F.f;
  return (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + n] * (1 - fx) + f[i + n + 1] * fx) * fy;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ── Symulacja wędrówki koryta ────────────────────────────────────────────────────────────────────────────────────
/**
 * Oś doliny: łagodny łuk od brzegu do brzegu mapy (z zapasem poza mapę — skutki końców osi zostają poza kadrem).
 * Wynik: punkty co `ds` [m].
 */
function valleyAxis(rng, L, ds) {
  const ext = L * 0.3;
  const ang = rng.range(-0.5, 0.5) + (rng.chance(0.5) ? 0 : Math.PI);
  const cx = L * rng.range(0.4, 0.6);
  const cy = L * rng.range(0.4, 0.6);
  const half = L * 0.75 + ext;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const bend = L * rng.range(-0.18, 0.18);
  const x0 = cx - dx * half;
  const y0 = cy - dy * half;
  const x1 = cx + dx * half;
  const y1 = cy + dy * half;
  const mx = cx - dy * bend;
  const my = cy + dx * bend;
  const n = Math.max(8, Math.round(2 * half / ds));
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    xs[i] = a * x0 + b * (2 * mx - (x0 + x1) / 2) + c * x1;
    ys[i] = a * y0 + b * (2 * my - (y0 + y1) / 2) + c * y1;
  }
  return { xs, ys };
}

function resample(xs, ys, ds) {
  const n = xs.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.sqrt((xs[i] - xs[i - 1]) ** 2 + (ys[i] - ys[i - 1]) ** 2);
  const total = cum[n - 1];
  const m = Math.max(4, Math.round(total / ds));
  const ox = new Float64Array(m + 1);
  const oy = new Float64Array(m + 1);
  let j = 0;
  for (let i = 0; i <= m; i++) {
    const s = total * i / m;
    while (j < n - 2 && cum[j + 1] < s) j++;
    const t = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    ox[i] = xs[j] + (xs[j + 1] - xs[j]) * t;
    oy[i] = ys[j] + (ys[j + 1] - ys[j]) * t;
  }
  return { xs: ox, ys: oy };
}

/**
 * Wędrówka koryta. `erod(x, y)` — podatność brzegu 0…1 (dolina: 1, poza pasem doliny maleje — rzeka nie wychodzi
 * w wysoczyznę). `onStamp(it, xs, ys)` co `stampEvery` kroków, `onCutoff(it, xs, ys)` przy odcięciu zakola.
 * Wynik: końcowa oś koryta { xs, ys } (punkty co `ds`).
 */
export function simulateMeanders({ axis, W, ds, iterations, erod, rng, stampEvery = 8, onStamp, onCutoff }) {
  // stałe modelu (meanderpy): Ω = −1, Γ = 2,5; α = 2·Cf / D, Cf = 0,011, głębokość D = 0,03 W
  const OMEGA = -1;
  const GAMMA = 2.5;
  const alpha = 2 * 0.011 / (0.03 * W);
  const win = Math.max(4, Math.ceil(6.0 / (alpha * ds)));
  const wts = new Float64Array(win + 1);
  for (let k = 0; k <= win; k++) wts[k] = Math.exp(-alpha * k * ds);
  // tempo: przesunięcie [m] na krok = rate · krzywizna; granica stateczności schematu jawnego to 2 ds² / π²
  const rate = 0.16 * ds * ds;
  const crit = 1.15 * W;
  const gap = Math.ceil(5 * crit / ds);
  // start: oś doliny z drobnym zaburzeniem (zalążki zakoli)
  let { xs, ys } = resample(axis.xs, axis.ys, ds);
  {
    const n = xs.length;
    // (zaburzenie na całej długości i od razu rzędu szerokości koryta: zakola rosną, wędrując w dół rzeki, więc
    // z małego zaburzenia odcinek przy górnym końcu zostawał prawie prosty)
    const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const nx0 = new Float64Array(n);
    const ny0 = new Float64Array(n);
    for (let i = 2; i < n - 2; i++) {
      const tx = xs[i + 1] - xs[i - 1];
      const ty = ys[i + 1] - ys[i - 1];
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      nx0[i] = -ty / tl;
      ny0[i] = tx / tl;
    }
    for (let i = 2; i < n - 2; i++) {
      const s = i * ds;
      const edge = Math.min(1, (i - 2) / 20, (n - 3 - i) / 20);
      const off = W * edge * (1.3 * Math.sin(s / (12 * W) * 6.283 + ph[0]) + 0.9 * Math.sin(s / (19.3 * W) * 6.283 + ph[1])
        + 0.7 * Math.sin(s / (8.1 * W) * 6.283 + ph[2]) + 0.6 * Math.sin(s / (31 * W) * 6.283 + ph[3]));
      xs[i] += nx0[i] * off;
      ys[i] += ny0[i] * off;
    }
  }
  let cutoffs = 0;
  for (let it = 0; it < iterations; it++) {
    const n = xs.length;
    const R0 = new Float64Array(n);
    const nxv = new Float64Array(n);
    const nyv = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const dx = (xs[i + 1] - xs[i - 1]) * 0.5;
      const dy = (ys[i + 1] - ys[i - 1]) * 0.5;
      const ddx = xs[i + 1] - 2 * xs[i] + xs[i - 1];
      const ddy = ys[i + 1] - 2 * ys[i] + ys[i - 1];
      const dl = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      R0[i] = rate * (dx * ddy - dy * ddx) / (dl * dl * dl);
      nxv[i] = dy / dl;
      nyv[i] = -dx / dl;
    }
    for (let i = 3; i < n - 3; i++) {
      let sum = 0;
      let wsum = 0;
      const lo = Math.max(1, i - win);
      for (let j = i, k = 0; j >= lo; j--, k++) { sum += R0[j] * wts[k]; wsum += wts[k]; }
      const R1 = (OMEGA * R0[i] + GAMMA * sum / wsum) * erod(xs[i], ys[i]);
      // (ograniczenie skoku: pojedynczy krok nie przestawia węzła dalej niż ¼ odstępu)
      const mv = Math.max(-0.25 * ds, Math.min(0.25 * ds, R1));
      xs[i] += mv * nxv[i];
      ys[i] += mv * nyv[i];
    }
    ({ xs, ys } = resample(xs, ys, ds));
    // odcięcia zakoli: dwa odległe wzdłuż rzeki węzły bliżej niż `crit`
    for (let guard = 0; guard < 12; guard++) {
      const m = xs.length;
      const cell = new Map();
      let cutI = -1;
      let cutJ = -1;
      for (let i = 0; i < m && cutI < 0; i++) {
        const gx = Math.floor(xs[i] / crit);
        const gy = Math.floor(ys[i] / crit);
        for (let oy = -1; oy <= 1 && cutI < 0; oy++) {
          for (let ox = -1; ox <= 1 && cutI < 0; ox++) {
            const list = cell.get((gx + ox) * 73856093 ^ (gy + oy) * 19349663);
            if (!list) continue;
            for (const j of list) {
              if (i - j < gap) continue;
              const d2 = (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2;
              if (d2 < crit * crit) { cutI = j; cutJ = i; break; }
            }
          }
        }
        const key = gx * 73856093 ^ gy * 19349663;
        const l = cell.get(key);
        if (l) l.push(i); else cell.set(key, [i]);
      }
      if (cutI < 0) break;
      if (onCutoff) onCutoff(it, xs.slice(cutI + 1, cutJ), ys.slice(cutI + 1, cutJ));
      const nx2 = new Float64Array(m - (cutJ - cutI - 1));
      const ny2 = new Float64Array(nx2.length);
      nx2.set(xs.subarray(0, cutI + 1));
      ny2.set(ys.subarray(0, cutI + 1));
      nx2.set(xs.subarray(cutJ), cutI + 1);
      ny2.set(ys.subarray(cutJ), cutI + 1);
      ({ xs, ys } = resample(nx2, ny2, ds));
      cutoffs++;
    }
    if (onStamp && (it % stampEvery === 0 || it === iterations - 1)) onStamp(it, xs, ys);
  }
  let len = 0;
  for (let i = 1; i < xs.length; i++) len += Math.sqrt((xs[i] - xs[i - 1]) ** 2 + (ys[i] - ys[i - 1]) ** 2);
  return { xs, ys, cutoffs, length: len };
}

// ── Pomocnicze rastry ────────────────────────────────────────────────────────────────────────────────────────────
function boxBlur(src, N, r, passes = 2) {
  let a = src;
  let b = new Float32Array(N * N);
  const k = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      const row = y * N;
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[row + Math.min(N - 1, Math.max(0, x))];
      for (let x = 0; x < N; x++) {
        b[row + x] = s * k;
        s += a[row + Math.min(N - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(N - 1, Math.max(0, y)) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = s * k;
        s += b[Math.min(N - 1, y + r + 1) * N + x] - b[Math.max(0, y - r) * N + x];
      }
    }
  }
  return a;
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// Paleta z próbek zdjęć wzorca (sRGB): las ciemny i chłodny, torfowisko stonowany oliwkowy beż, dolina soczysta zieleń
const PAL = {
  forestA: hex('#253938'), forestB: hex('#2f4540'), forestC: hex('#3a4f43'), riparian: hex('#1d3830'),
  shrub: hex('#4d604e'), fen: hex('#848a63'), fenLight: hex('#9d9f76'), fenWet: hex('#5f7559'),
  sand: hex('#c9b890'), grass: hex('#6f8a5a'), meadow: hex('#3d6a4c'), thicket: hex('#234d3b'),
  heath: hex('#6d5142'), terrace: hex('#a8a27d'),
  river: hex('#2a221e'), riverEdge: hex('#3b3028'), oxbow: hex('#1c2527'), stream: hex('#1b3028')
};

/**
 * Mapa terenu. `seed` — ziarno miejsca, `size` — bok rastra [teksele], `extentKm` — bok mapy [km], `riverWidthM` —
 * szerokość koryta. Wynik: { size, extentKm, cellM, albedo (RGBA8 sRGB, wiersz 0 = północ), height [m], cover
 * (TERRAIN_COVER), river: { xs, ys, widthM } [m], stats: { ms, sinuosity, cutoffs, … } }.
 */
export function generateTerrainMap({ seed = 1, size = 1024, extentKm = 20, biome = 'tajga', riverWidthM = 120, now = () => performance.now() } = {}) {
  if (!TERRAIN_MAP_BIOMES.includes(biome)) throw new Error(`mapa terenu: nieznany biom „${biome}”`);
  const t0 = now();
  const N = size | 0;
  const L = extentKm * 1000;
  const cs = L / N;
  const W = riverWidthM;
  const rng = makeRng(mix32(seed >>> 0, 0x7e44a1));
  const sd = (k) => mix32(seed >>> 0, k) | 0;
  const stats = {};

  // ── 1. rzeka ──
  const ds = W * 0.5;
  const axis = valleyAxis(rng, L, ds * 4);
  // odległość od osi doliny i podatność brzegu w kracie zgrubnej (obszar mapy z zapasem)
  const G = 192;
  const ext = L * 0.3;
  const span = L + 2 * ext;
  const beltW = W * rng.range(9, 13);
  const axDist = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const px = -ext + (gx + 0.5) / G * span;
      const py = -ext + (gy + 0.5) / G * span;
      let best = 1e18;
      for (let i = 0; i < axis.xs.length; i += 2) {
        const d2 = (axis.xs[i] - px) ** 2 + (axis.ys[i] - py) ** 2;
        if (d2 < best) best = d2;
      }
      axDist[gy * G + gx] = Math.sqrt(best);
    }
  }
  const AX = { f: axDist, n: G };
  const axisDistAt = (x, y) => sample(AX, (x + ext) / span, (y + ext) / span);
  const erodSeed = sd(11);
  const erod = (x, y) => {
    const d = axisDistAt(x, y);
    const k = 0.75 + 0.5 * vnoise(x / (W * 14), y / (W * 14), erodSeed);
    return k * (1 - 0.94 * sstep(beltW * 0.75, beltW * 1.45, d));
  };
  // raster „kiedy ostatnio płynęła tu rzeka” (0 — nigdy) i starorzecza
  const iterations = 3200;
  const lastChan = new Uint16Array(N * N);
  const oxIt = new Uint16Array(N * N);
  const rc = Math.max(1, W * 0.5 / cs);
  const stampDisc = (arr, x, y, r, val) => {
    const cx = x / cs;
    const cy = y / cs;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(N - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(N - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - cx;
        const dy = yy + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) arr[yy * N + xx] = val;
      }
    }
  };
  const tSim = now();
  const river = simulateMeanders({
    axis, W, ds, iterations, erod, rng, stampEvery: 6,
    onStamp: (it, xs, ys) => { for (let i = 0; i < xs.length; i++) stampDisc(lastChan, xs[i], ys[i], rc + 0.35, it + 1); },
    onCutoff: (it, xs, ys) => { for (let i = 0; i < xs.length; i++) stampDisc(oxIt, xs[i], ys[i], Math.max(0.8, rc * 0.8), it + 1); }
  });
  stats.simMs = now() - tSim;
  stats.cutoffs = river.cutoffs;
  // odległość od osi dzisiejszego koryta [m] (do 6 W)
  const dRiver = new Float32Array(N * N).fill(1e6);
  {
    const R = Math.ceil(6 * W / cs);
    for (let i = 0; i < river.xs.length; i++) {
      const cx = river.xs[i] / cs;
      const cy = river.ys[i] / cs;
      if (cx < -R || cy < -R || cx > N + R || cy > N + R) continue;
      const x0 = Math.max(0, Math.floor(cx - R));
      const x1 = Math.min(N - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, Math.floor(cy - R));
      const y1 = Math.min(N - 1, Math.ceil(cy + R));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const d = Math.sqrt((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2) * cs;
          const k = yy * N + xx;
          if (d < dRiver[k]) dRiver[k] = d;
        }
      }
    }
  }
  // dolina zalewowa: miejsca, gdzie kiedykolwiek płynęła rzeka (wygładzony zasięg)
  const ever = new Float32Array(N * N);
  for (let i = 0; i < ever.length; i++) ever[i] = lastChan[i] ? 1 : 0;
  const plain = boxBlur(ever, N, Math.max(1, Math.round(W * 0.6 / cs)), 2);

  // ── 2. rzeźba [m] ──
  const nA = noiseField(256, 3.2 * extentKm / 20, 5, sd(21));
  const nB = noiseField(512, 14 * extentKm / 20, 4, sd(22));
  const nC = noiseField(256, 6 * extentKm / 20, 4, sd(23));
  const nD = noiseField(512, 30 * extentKm / 20, 3, sd(24));
  const height = new Float32Array(N * N);
  const floor = new Float32Array(N * N);       // poziom dna doliny w tym miejscu (spadek wzdłuż mapy pomijalny)
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const k = y * N + x;
      const dAx = axisDistAt((x + 0.5) * cs, (y + 0.5) * cs);
      // wysoczyzna: łagodnie w górę od doliny + wzgórza
      const up = 4 + 26 * sstep(beltW * 0.6, beltW * 6, dAx) + (dAx / 1000) * 2.2;
      const hills = sample(nA, u, v) * 22 + sample(nB, u, v) * 7 + sample(nD, u, v) * 1.6;
      const hUp = Math.max(1.5, up + hills);
      const p = sstep(0.08, 0.55, plain[k]);
      // dno doliny: prawie płaskie, z drobną rzeźbą; koryto wcięte
      const hFloor = 0.6 * sample(nD, u, v) + 0.4;
      let h = mix(hUp, hFloor, p);
      const wat = 1 - sstep(W * 0.4, W * 0.62, dRiver[k]);
      h -= wat * 2.5;
      height[k] = h;
      floor[k] = p;
    }
  }

  // ── 3. cieki: spływ po rzeźbie; dno doliny i brzeg mapy to ujścia ──
  const tDr = now();
  const hd = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      hd[k] = (edge || floor[k] > 0.5) ? -1 : Math.max(1e-4, height[k] / 1000);
    }
  }
  const dr = computeDrainage(hd, null, N, N, { wrapX: false, rowWeight: false, keep: true, wander: 0.0012, seed: sd(31), now });
  stats.drainMs = now() - tDr;
  // próg strumienia: zlewnia ≥ ~0,35 km²; wysokość nad ciekiem i wielkość cieku, do którego spływa komórka
  const cellKm2 = cs * cs / 1e6;
  const tStream = 0.35 / cellKm2;
  const hand = new Float32Array(N * N);
  const sflow = new Float32Array(N * N).fill(1e9);
  const isStream = new Uint8Array(N * N);
  {
    const rcv = dr.receiver;
    const flow = dr.flow;
    const order = dr.order;
    for (let i = 0; i < order.length; i++) {
      const c = order[i];
      const r = rcv[c];
      if (flow[c] >= tStream) { isStream[c] = 1; hand[c] = 0; sflow[c] = flow[c]; continue; }
      if (r < 0 || hd[r] <= 0) { hand[c] = height[c] > 0 ? Math.min(height[c], 3) : 0; sflow[c] = 1e9; continue; }
      hand[c] = hand[r] + Math.max(0, height[c] - height[r]);
      sflow[c] = sflow[r];
    }
  }
  // wysokość nad ciekiem wygładzona: surowa skacze na działach wodnych między ścieżkami spływu (torfowiska
  // o brzegach z prostokątnych schodków) — wygładzona daje miękkie, zaokrąglone zasięgi
  const handS = boxBlur(Float32Array.from(hand), N, Math.max(1, Math.round(45 / cs)), 2);
  // „duży ciek” 0…1 (zlewnia cieku, do którego spływa komórka) — też wygładzony: surowy zmienia się skokiem na
  // granicach zlewni i pas łęgu wzdłuż strumieni miał kanciaste, schodkowe brzegi
  const bigRaw = new Float32Array(N * N);
  for (let i = 0; i < bigRaw.length; i++) bigRaw[i] = sstep(tStream * 6, tStream * 30, sflow[i]);
  const bigS = boxBlur(bigRaw, N, Math.max(1, Math.round(60 / cs)), 2);
  // nachylenie w skali wzgórz (z wygładzonej wysokości) — płaskie wierzchowiny i dna dolin
  const hSm = boxBlur(Float32Array.from(height), N, Math.max(2, Math.round(120 / cs)), 2);

  // ── 4–5. pokrycie i barwy ──
  const tCol = now();
  const cover = new Uint8Array(N * N);
  const canopy = new Float32Array(N * N);       // wysokość koron [m] — do cienia skraju lasu
  const rgb = new Float32Array(N * N * 3);
  const nE = noiseField(512, 46 * extentKm / 20, 3, sd(25));     // drzewostany
  const nF = noiseField(256, 9 * extentKm / 20, 4, sd(26));      // okolice z torfowiskami
  const itN = iterations;
  const cellI = W * 3.3;                                           // oczko „plastra miodu” [m]
  const honeySeed = sd(41);
  const put = (k, c, a) => { const o = k * 3; rgb[o] = mix(rgb[o], c[0], a); rgb[o + 1] = mix(rgb[o + 1], c[1], a); rgb[o + 2] = mix(rgb[o + 2], c[2], a); };
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const k = y * N + x;
      const o = k * 3;
      const xm = (x + 0.5) * cs;
      const ym = (y + 0.5) * cs;
      const grain = hash2(x, y, 977) - 0.5;
      const a = sample(nA, u, v);
      const c = sample(nC, u, v);
      const e = sample(nE, u, v);
      const fr = sample(nF, u, v);
      // LAS: ciemny, chłodny; płaty drzewostanów, jaśniej na suchych wyniesieniach
      const st = sstep(-0.35, 0.45, e + c * 0.5);
      let fa = mix(PAL.forestA[0], PAL.forestB[0], st);
      let fb = mix(PAL.forestA[1], PAL.forestB[1], st);
      let fc = mix(PAL.forestA[2], PAL.forestB[2], st);
      const dry = sstep(0.15, 0.6, a + c * 0.4);
      fa = mix(fa, PAL.forestC[0], dry * 0.6); fb = mix(fb, PAL.forestC[1], dry * 0.6); fc = mix(fc, PAL.forestC[2], dry * 0.6);
      rgb[o] = fa; rgb[o + 1] = fb; rgb[o + 2] = fc;
      let cov = TERRAIN_COVER.FOREST;
      let can = 15 + e * 3;
      let tex = 0.075;                               // siła ziarna koron
      // nachylenie wzgórz [m/m]
      const sx = (hSm[k + (x < N - 1 ? 1 : 0)] - hSm[k - (x > 0 ? 1 : 0)]) / (2 * cs);
      const sy = (hSm[k + (y < N - 1 ? N : 0)] - hSm[k - (y > 0 ? N : 0)]) / (2 * cs);
      const slope = Math.sqrt(sx * sx + sy * sy);
      const p = floor[k];
      if (p < 0.5) {
        // TORFOWISKA: mokro tuż nad drobnym ciekiem (pasma wzdłuż strumyków) i na płaskim; przy większych strumieniach
        // zamiast torfowiska ciemny łęg
        const hnd = handS[k];
        const small = 1 - bigS[k];
        const region = sstep(0.0, 0.4, fr + a * 0.3);
        const flat = 1 - sstep(0.005, 0.016, slope);
        // (poza okolicami torfowisk pasmo jest WĄSKIE i pełne — cienka jasna linia wzdłuż części strumyków; słabe
        // a szerokie pasmo dawało wszędzie plamy zarośli we wzór maskujący)
        const thin = sstep(0.0, 0.35, c + a * 0.3);
        const wetLine = (1 - sstep(0.12 + 1.5 * region, 0.5 + 4.5 * region, hnd + e * 0.6 * region)) * small * Math.max(region, thin);
        const bogPlain = flat * sstep(0.3, 0.6, fr + c * 0.35) * (1 - sstep(1.8, 5, hnd));
        // (pasma wzdłuż cieków wychodzą także poza okolice torfowisk — rozgałęzione jasne „żyłki” łączące płaty)
        let fen = Math.max(wetLine * (0.6 + 0.4 * flat), bogPlain * region);
        // łęg wzdłuż większych strumieni
        const rip = (1 - sstep(0.5, 2.0, hnd + e * 0.5)) * (1 - small);
        if (rip > 0.01) { put(k, PAL.riparian, rip * 0.6); can = mix(can, 17, rip); }
        if (fen > 0.02) {
          // wyspy drzew w szerokim torfowisku („plaster miodu”): komórki z zaokrąglonymi wyspami lasu
          // (wyspy = wnętrza nieregularnych komórek, jasne pasma torfowiska = GRANICE komórek o zmiennej szerokości:
          // wzór ze zdjęcia to ciasno upakowane ciemne wielokąty o zaokrąglonych rogach, nie równe kółka)
          let island = 0;
          if (fen > 0.3) {
            const wob = cellI * 0.55;
            const gx = (xm + wob * vnoise(xm / (cellI * 1.7), ym / (cellI * 1.7), honeySeed + 3)) / cellI;
            const gy = (ym + wob * vnoise(xm / (cellI * 1.7) + 9.1, ym / (cellI * 1.7) - 4.3, honeySeed + 5)) / cellI;
            const ix = Math.floor(gx);
            const iy = Math.floor(gy);
            let f1 = 9;
            let f2 = 9;
            let hv = 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const h1 = hash2(ix + ox, iy + oy, honeySeed);
                const h2 = hash2(ix + ox, iy + oy, honeySeed + 7);
                const d = Math.sqrt((ix + ox + 0.08 + 0.84 * h1 - gx) ** 2 + (iy + oy + 0.08 + 0.84 * h2 - gy) ** 2);
                if (d < f1) { f2 = f1; f1 = d; hv = hash2(ix + ox, iy + oy, honeySeed + 13); } else if (d < f2) f2 = d;
              }
            }
            // szerokość jasnych pasm rośnie ku otwartemu torfowisku; część komórek bez wyspy
            const open = sstep(0.1, 0.6, sample(nC, v, u) + 0.25 * e);
            const gapW = mix(0.05, 0.4, open) * (0.5 + 1.0 * hv);
            // (rogi wielokątów ścięte: wyspa sięga do ~0,6 odległości od środka komórki — zaokrąglone kształty)
            island = sstep(gapW, gapW + 0.07, f2 - f1 + e * 0.05) * (1 - sstep(0.46, 0.6, f1 + e * 0.04)) * (hv > 0.12 ? 1 : 0)
              * sstep(0.3, 0.55, fen) * (1 - 0.85 * sstep(0.45, 0.8, open)) * sstep(-0.1, 0.25, sample(nA, v, u));
          }
          const f = sstep(0.3, 0.8, fen + e * 0.08) * (1 - island);
          // brzeg torfowiska: szeroki pas zarośli (miękkie przejście do lasu); środek: jasny beż, miejscami jaśniejszy
          // albo wilgotniej zielony
          const shrubK = sstep(0.06, 0.4, fen) * (1 - f);
          put(k, PAL.shrub, shrubK * 0.8);
          const tone = sstep(-0.3, 0.4, e + a * 0.6);
          const fenC = [mix(PAL.fen[0], PAL.fenLight[0], tone), mix(PAL.fen[1], PAL.fenLight[1], tone), mix(PAL.fen[2], PAL.fenLight[2], tone)];
          const wet = sstep(0.2, 0.7, c - e * 0.4) * 0.5;
          fenC[0] = mix(fenC[0], PAL.fenWet[0], wet); fenC[1] = mix(fenC[1], PAL.fenWet[1], wet); fenC[2] = mix(fenC[2], PAL.fenWet[2], wet);
          put(k, fenC, f);
          can = mix(can, 0.4, f); can = mix(can, 4, shrubK * 0.8);
          tex = mix(tex, 0.03, f);
          if (f > 0.5) cov = TERRAIN_COVER.FEN; else if (shrubK > 0.5) cov = TERRAIN_COVER.SHRUB;
        }
        // strumień: cienka ciemna linia (szerokość poniżej teksela — krycie z wielkości zlewni)
        // (dopiero od większej zlewni i miękko: czarne kreski każdego strumyka wyglądały jak pęknięcia)
        if (isStream[k]) {
          const s = Math.min(0.7, 0.13 * Math.log2(dr.flow[k] / tStream + 1));
          if (s > 0.28) {
            put(k, PAL.stream, s);
            can = mix(can, 2, s);
            if (s > 0.6) cov = TERRAIN_COVER.WATER;
          }
        }
      }
      if (p > 0.02) {
        // DOLINA ZALEWOWA: sukcesja z wieku powierzchni (0 — rzeka była tu przed chwilą, 1 — na początku symulacji)
        const lc = lastChan[k];
        const age = lc ? (itN - lc) / itN : 1;
        const fp = sstep(0.1, 0.6, p);
        // łuki dawnych koryt: grzędy (jaśniej, sucho) i obniżenia (ciemniej, mokro) — pasy równego wieku
        const ridge = lc ? 0.5 + 0.5 * Math.sin(lc / 46 * 6.283 + e * 2.2 + c * 1.5) : 0.5;
        let col;
        let ch;
        // (łacha = teren opuszczony przez koryto kilkadziesiąt kroków temu; teren pod korytem z ostatnich kroków to
        // brzeg — bez tego piasek obrysowywał rzekę z obu stron także na prostych)
        const fresh = lc >= itN - 14;
        if (fresh) { col = PAL.riverEdge; ch = 0; } else if (age < 0.02) { col = PAL.sand; ch = 0; cov = TERRAIN_COVER.SAND; } else {
          const g1 = sstep(0.02, 0.06, age);                        // piasek → trawy
          const g2 = sstep(0.05, 0.16, age);                        // trawy → łąka
          const g3 = sstep(0.14, 0.5, age + c * 0.18 + e * 0.08);   // łąka → zarośla i las
          col = [mix(PAL.sand[0], PAL.grass[0], g1), mix(PAL.sand[1], PAL.grass[1], g1), mix(PAL.sand[2], PAL.grass[2], g1)];
          col = [mix(col[0], PAL.meadow[0], g2), mix(col[1], PAL.meadow[1], g2), mix(col[2], PAL.meadow[2], g2)];
          // zarośla w obniżeniach, jaśniejsza trawa na grzędach
          const th = sstep(0.35, 0.75, (1 - ridge) * 0.45 + e * 0.6 + c * 0.3 + 0.25) * sstep(0.04, 0.2, age);
          col = [mix(col[0], PAL.thicket[0], th * 0.8), mix(col[1], PAL.thicket[1], th * 0.8), mix(col[2], PAL.thicket[2], th * 0.8)];
          const lightR = ridge * (1 - th) * 0.1;
          col = [mix(col[0], PAL.grass[0], lightR), mix(col[1], PAL.grass[1], lightR), mix(col[2], PAL.grass[2], lightR)];
          // stare powierzchnie: las łęgowy, miejscami wrzosowiska i jasne suche tarasy
          const old = [mix(PAL.riparian[0], PAL.forestB[0], 0.5), mix(PAL.riparian[1], PAL.forestB[1], 0.5), mix(PAL.riparian[2], PAL.forestB[2], 0.5)];
          col = [mix(col[0], old[0], g3), mix(col[1], old[1], g3), mix(col[2], old[2], g3)];
          const heath = sstep(0.2, 0.55, c + e * 0.3) * sstep(0.3, 0.6, age) * 0.7;
          col = [mix(col[0], PAL.heath[0], heath), mix(col[1], PAL.heath[1], heath), mix(col[2], PAL.heath[2], heath)];
          const terr = sstep(0.25, 0.55, a - e * 0.3 - c * 0.4) * sstep(0.35, 0.7, age) * 0.7;
          col = [mix(col[0], PAL.terrace[0], terr), mix(col[1], PAL.terrace[1], terr), mix(col[2], PAL.terrace[2], terr)];
          ch = mix(mix(0.4, 5, th), 14, g3 * (1 - heath) * (1 - terr));
          cov = g3 > 0.6 && heath < 0.4 && terr < 0.4 ? TERRAIN_COVER.FOREST : (th > 0.5 ? TERRAIN_COVER.SHRUB : TERRAIN_COVER.MEADOW);
        }
        put(k, col, fp);
        can = mix(can, ch, fp);
        tex = mix(tex, 0.045, fp);
        // starorzecza: młode — woda, stare — zarośnięte ciemne łuki
        const ox = oxIt[k];
        if (ox && lc <= ox + 8) {
          const oa = (itN - ox) / itN;
          const w = 1 - sstep(0.25, 0.55, oa);
          put(k, PAL.oxbow, 0.9 * w + 0.0);
          put(k, PAL.thicket, (1 - w) * 0.6);
          can = mix(can, 0, w);
          if (w > 0.5) cov = TERRAIN_COVER.WATER;
        }
        // RZEKA: ciemna woda, nieco jaśniejsza przy brzegu
        const wat = 1 - sstep(W * 0.5 - cs * 0.7, W * 0.5 + cs * 0.7, dRiver[k]);
        if (wat > 0) {
          const edgeK = sstep(W * 0.22, W * 0.5, dRiver[k]);
          put(k, [mix(PAL.river[0], PAL.riverEdge[0], edgeK), mix(PAL.river[1], PAL.riverEdge[1], edgeK), mix(PAL.river[2], PAL.riverEdge[2], edgeK)], wat);
          can = mix(can, -1, wat);
          tex = mix(tex, 0.01, wat);
          if (wat > 0.5) cov = TERRAIN_COVER.WATER;
        }
      }
      cover[k] = cov;
      canopy[k] = can;
      // ziarno koron: szum co teksel i grudki kilku tekseli (korony i luki — bez tego las jest gładką plamą)
      const clump = vnoise(x / 2.7, y / 2.7, 4177) * 0.6 + vnoise(x / 6.1, y / 6.1, 4178) * 0.4;
      const t = 1 + (grain * 2 + clump * 1.3) * tex + e * 0.04;
      rgb[o] *= t; rgb[o + 1] *= t; rgb[o + 2] *= t;
    }
  }
  // cieniowanie: rzeźba (przesadzona — relief niziny to kilkadziesiąt metrów) i wysokość koron (skraj lasu)
  const albedo = new Uint8ClampedArray(N * N * 4);
  const canS = boxBlur(Float32Array.from(canopy), N, 1, 1);
  const lx = -0.62;
  const ly = -0.55;
  const lz = 0.56;
  const flatShade = lz;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const xl = k - (x > 0 ? 1 : 0);
      const xr = k + (x < N - 1 ? 1 : 0);
      const yu = k - (y > 0 ? N : 0);
      const yd = k + (y < N - 1 ? N : 0);
      const gx = ((height[xr] - height[xl]) * 7 + (canS[xr] - canS[xl]) * 0.55) / (2 * cs);
      const gy = ((height[yd] - height[yu]) * 7 + (canS[yd] - canS[yu]) * 0.55) / (2 * cs);
      const il = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const sh = (-gx * lx - gy * ly + lz) * il;
      const b = 1 + (sh - flatShade) * 0.75;
      const o = k * 3;
      const q = k * 4;
      albedo[q] = rgb[o] * b;
      albedo[q + 1] = rgb[o + 1] * b;
      albedo[q + 2] = rgb[o + 2] * b;
      albedo[q + 3] = 255;
    }
  }
  stats.colorMs = now() - tCol;
  let straight = 0;
  {
    const xs = river.xs;
    const ys = river.ys;
    straight = Math.sqrt((xs[xs.length - 1] - xs[0]) ** 2 + (ys[ys.length - 1] - ys[0]) ** 2);
  }
  stats.sinuosity = river.length / Math.max(1, straight);
  stats.streams = isStream.reduce((s, v) => s + v, 0);
  stats.ms = now() - t0;
  return { size: N, extentKm, cellM: cs, biome, seed, albedo, height, cover, river: { xs: river.xs, ys: river.ys, widthM: W }, stats };
}
