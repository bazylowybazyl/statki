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
function valleyAxis(rng, L, ds, flowAngle = null) {
  const ext = L * 0.3;
  // kierunek spływu: z ziarna albo zadany (mapa miejsca na planecie — rzeka płynie tak jak na planecie)
  const rnd = rng.range(-0.5, 0.5) + (rng.chance(0.5) ? 0 : Math.PI);
  const ang = flowAngle == null ? rnd : flowAngle;
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
const pal = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ? hex(v) : null]));
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ROŚLINNOŚĆ (sRGB). `tajga` — z próbek zdjęć wzorca: las ciemny i chłodny, torfowisko stonowany oliwkowy beż. Pozostałe
// palety to ten sam krajobraz w innych barwach (decyzja użytkownika: „drzewa są nie tylko zielone” — czerwień, purpura,
// złoto). `accent` — drzewostany drugiego gatunku wśród lasu (kępy innej barwy), `mangrove` / `marsh` — las i trzciny
// strefy pływów przy morzu.
const VEG = {
  tajga: pal({
    forestA: '#253938', forestB: '#2f4540', forestC: '#3a4f43', riparian: '#1d3830', shrub: '#4d604e',
    fen: '#848a63', fenLight: '#9d9f76', fenWet: '#5f7559', grass: '#68805a', meadow: '#3b5d49', thicket: '#234a3a',
    heath: '#6d5142', terrace: '#a8a27d', accent: null, mangrove: '#1f3f33', marsh: '#5f7a55'
  }),
  tropik: pal({
    forestA: '#1c4426', forestB: '#27552c', forestC: '#356634', riparian: '#163c26', shrub: '#4c7a44',
    fen: '#8f9a5c', fenLight: '#a9ad6e', fenWet: '#5f8550', grass: '#86ad55', meadow: '#4a944a', thicket: '#2a6a3a',
    heath: '#7b6a40', terrace: '#b3a877', accent: '#a23a46', mangrove: '#174a34', marsh: '#6a9a4e'
  }),
  czerwona: pal({
    forestA: '#4a1820', forestB: '#66212a', forestC: '#84362c', riparian: '#38131f', shrub: '#8a4a3c',
    fen: '#b0946a', fenLight: '#c7ad7c', fenWet: '#8c6656', grass: '#c98248', meadow: '#b04e3a', thicket: '#76262e',
    heath: '#4f3550', terrace: '#bda67c', accent: '#d39a2e', mangrove: '#5a1626', marsh: '#a85a44'
  }),
  purpura: pal({
    forestA: '#34204a', forestB: '#48295e', forestC: '#63396a', riparian: '#281840', shrub: '#73507c',
    fen: '#a39a8a', fenLight: '#b9b09c', fenWet: '#7d6f8a', grass: '#b584a6', meadow: '#94508c', thicket: '#552a66',
    heath: '#3f4a5e', terrace: '#b5a892', accent: '#2f968f', mangrove: '#3a1a52', marsh: '#8a5a90'
  }),
  zlota: pal({
    forestA: '#5a3e12', forestB: '#765218', forestC: '#946c20', riparian: '#43370f', shrub: '#8c783a',
    fen: '#b3a97a', fenLight: '#c6bc8a', fenWet: '#8a8a58', grass: '#bfa64a', meadow: '#a4872c', thicket: '#6a5718',
    heath: '#5a3a2a', terrace: '#c0b085', accent: '#8f2a1e', mangrove: '#4a4212', marsh: '#9a8c3a'
  })
};
// WODA: ciemna (rzeka leśna, garbniki), muł (wielka rzeka niosąca osad), lodowa (rzeka z lodowca, mleczny błękit)
const WATER = {
  ciemna: pal({ river: '#2a221e', edge: '#3b3028', oxbow: '#1c2527', stream: '#1b3028', lake: '#1f2a2c' }),
  mul: pal({ river: '#a08261', edge: '#b59b79', oxbow: '#5f6a50', stream: '#6f6a52', lake: '#8f7d5f' }),
  lodowa: pal({ river: '#2a6aad', edge: '#69aedb', oxbow: '#2f5f8a', stream: '#3f77a8', lake: '#3a7ab4' })
};
const GROUND = pal({ sand: '#c9b890', gravel: '#c2c6ca', gravelDark: '#8e959d', mud: '#a3927a', mudDark: '#7d7362' });
const SEA = pal({ deep: '#0e2b4f', shelf: '#195b82', turq: '#3fb2bd', milky: '#cfe8dc' });

// STYLE RZEK (wzorce: zdjęcia satelitarne od użytkownika):
//   meandry — rzeka nizinna o ciasnych zakolach (symulacja wędrówki koryta);
//   wielka  — szeroka rzeka niosąca muł, z wyspami w rozszerzeniach koryta i jeziorami w dolinie zalewowej;
//   roztoki — rzeka roztokowa: szerokie żwirowe łożysko z plecionką wąskich niebieskich koryt;
//   delta   — ujście do morza: ramiona delty, lejkowate ujścia i potoki pływowe, namorzyny, smugi osadu w morzu.
const RIVER_STYLES = {
  meandry: { width: 120, iterations: 3200, water: 'ciemna' },
  wielka: { width: 900, iterations: 500, water: 'mul', islands: true },
  roztoki: { width: 110, bed: 850, iterations: 0, water: 'lodowa', braided: true },
  delta: { width: 480, iterations: 1500, water: 'mul', coast: true }
};
// udział torfowisk / polan w lesie zależnie od roślinności (tajga — dużo, las równikowy — mało)
const VEG_FEN = { tajga: 1, tropik: 0.4, czerwona: 0.7, purpura: 0.7, zlota: 0.8 };
export const TERRAIN_RIVERS = Object.freeze(Object.keys(RIVER_STYLES));
export const TERRAIN_VEGETATION = Object.freeze(Object.keys(VEG));
/**
 * Barwy krajobrazu palety (sRGB 0–255) dla PLANETY widzianej z daleka (planetGenSolid.tsl.js: `earthColor`) — planeta
 * maluje torfowiska, dolinę zalewową i wodę tymi samymi barwami co mapa terenu. `fenAmount` — udział torfowisk.
 */
export const terrainLandscape = (veg) => {
  const P = VEG[veg];
  return { forest: [...P.forestB], fen: mix3(P.fen, P.fenLight, 0.5), fenWet: [...P.fenWet], grass: [...P.grass], meadow: [...P.meadow], fenAmount: VEG_FEN[veg] };
};
/** Barwy wody i osadu (sRGB 0–255): ciemna woda leśna, muł wielkiej rzeki, mleczny błękit z lodowca, osad w morzu, piasek. */
export const TERRAIN_WATER = Object.freeze({
  dark: [27, 40, 48], mud: [150, 134, 88], ice: [...WATER.lodowa.edge], silt: [226, 190, 138], sand: [...GROUND.sand]
});
/** Barwa lasu palety (sRGB 0–255) — odniesienie dla odcienia z palety planety (`vegTint`, planetGenPlace.js). */
export const terrainForestColor = (veg) => [...VEG[veg].forestB];

// Ramiona delty: od wierzchołka delty ku morzu, z rozwidleniami; szerokość rośnie przy morzu (lejek pływowy).
function growDistributaries({ rng, apex, dcAt, flowAng, W, L, tideK }) {
  const out = [];
  const tideL = L * 0.07;
  // (krótko w morze: długie wały wyglądały jak palce wystające z brzegu)
  const seaExt = 250 + (1 - tideK) * 1500;
  const branch = (x0, y0, dir0, w, bias, depth) => {
    const xs = [];
    const ys = [];
    const ws = [];
    const step = Math.max(40, w * 0.5);
    let x = x0;
    let y = y0;
    let dir = dir0;
    let since = 0;
    let seaRun = 0;
    let ph = rng.range(0, 6.28);
    const splitLen = w * rng.range(5, 11);
    const seaMax = seaExt * rng.range(0.6, 1.2);
    let split = false;
    for (let it = 0; it < 6000; it++) {
      const dcv = dcAt(x, y);
      xs.push(x); ys.push(y);
      ws.push(w * (1 + tideK * 4.5 * Math.exp(-Math.max(0, dcv) / tideL)));
      if (dcv < 0) { seaRun += step; if (seaRun > seaMax) break; }
      if (x < -0.15 * L || y < -0.15 * L || x > 1.15 * L || y > 1.15 * L) break;
      // kurs: ku morzu z odchyleniem ramienia + łagodne wężykowanie
      let dA = flowAng + bias - dir;
      while (dA > Math.PI) dA -= 2 * Math.PI;
      while (dA < -Math.PI) dA += 2 * Math.PI;
      ph += step / (w * 3.2);
      dir += dA * 0.05 + Math.sin(ph) * 0.07 * (step / (w * 0.5));
      x += Math.cos(dir) * step;
      y += Math.sin(dir) * step;
      since += step;
      if (depth < 3 && since > splitLen && dcv > 150) { split = true; break; }
    }
    out.push({ xs, ys, ws, w, sea: seaRun });
    if (split) {
      const sp = rng.range(0.3, 0.55);
      const k = rng.range(0.62, 0.86);
      const side = rng.chance(0.5) ? 1 : -1;
      branch(x, y, dir + side * sp * 0.6, w * k, Math.max(-1.1, Math.min(1.1, bias + side * sp)), depth + 1);
      branch(x, y, dir - side * sp * 0.9, w * (1.5 - k), Math.max(-1.1, Math.min(1.1, bias - side * sp * 1.2)), depth + 1);
    }
  };
  branch(apex.x, apex.y, apex.dir, W, 0, 0);
  return out;
}

/**
 * Mapa terenu. `seed` — ziarno miejsca, `size` — bok rastra [teksele], `extentKm` — bok mapy [km], `river` — styl
 * rzeki (`TERRAIN_RIVERS`), `veg` — paleta roślinności (`TERRAIN_VEGETATION`), `riverWidthM` — szerokość koryta
 * (0 = ze stylu), `flowAngle` — kierunek spływu rzeki w układzie mapy [rad] (x — wschód, y — południe; null = z ziarna;
 * przy delcie morze leży po tej stronie), `vegTint` — mnożniki barw roślinności [r, g, b] (odcień z palety planety). Wynik: { size, extentKm, cellM, albedo (RGBA8 sRGB, wiersz 0 = północ), height [m], cover
 * (TERRAIN_COVER), river: { xs, ys, widthM } [m], sea (czy na mapie jest morze), stats }.
 */
export function generateTerrainMap({
  seed = 1, size = 1024, extentKm = 20, biome = 'tajga', river: riverStyle = 'meandry', veg = 'tajga', riverWidthM = 0,
  flowAngle = null, vegTint = null, now = () => performance.now()
} = {}) {
  if (!TERRAIN_MAP_BIOMES.includes(biome)) throw new Error(`mapa terenu: nieznany biom „${biome}”`);
  const RS = RIVER_STYLES[riverStyle];
  if (!RS) throw new Error(`mapa terenu: nieznany styl rzeki „${riverStyle}”`);
  if (!VEG[veg]) throw new Error(`mapa terenu: nieznana roślinność „${veg}”`);
  // odcień roślinności z palety PLANETY (mnożniki kanałów): mapa miejsca ma barwy z tej samej rodziny co planeta
  // widziana z orbity
  const P = vegTint
    ? Object.fromEntries(Object.entries(VEG[veg]).map(([k, c]) => [k, c ? [Math.min(255, c[0] * vegTint[0]), Math.min(255, c[1] * vegTint[1]), Math.min(255, c[2] * vegTint[2])] : null]))
    : VEG[veg];
  const WC = WATER[RS.water];
  const G0 = GROUND;
  const t0 = now();
  const N = size | 0;
  const L = extentKm * 1000;
  const cs = L / N;
  const W = riverWidthM > 0 ? riverWidthM : RS.width;
  const rng = makeRng(mix32(seed >>> 0, 0x7e44a1));
  const sd = (k) => mix32(seed >>> 0, k) | 0;
  const stats = {};
  const coast = !!RS.coast;
  const braided = !!RS.braided;
  const bed = braided ? RS.bed * (W / RS.width) : 0;

  // ── 1. oś doliny i rzeka ──
  const ds = W * 0.5;
  // odstęp węzłów osi rzeki głównej: wielka rzeka gęsto (współrzędne „wzdłuż / w poprzek” liczone od najbliższego
  // węzła skaczą na granicach między węzłami o ~odległość × kąt załamania — przy rzadkich węzłach wyspy i jeziora
  // były pocięte prostymi krawędziami, a brzeg koryta z kół wyglądał jak sznur korali)
  const pds = RS.islands ? W / 8 : ds;
  const axis = valleyAxis(rng, L, ds * 4, flowAngle);
  // odległość od osi doliny i podatność brzegu w kracie zgrubnej (obszar mapy z zapasem)
  const G = 192;
  const ext = L * 0.3;
  const span = L + 2 * ext;
  const beltW = braided ? bed * 1.5 : W * rng.range(9, 13);
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
  // kierunek spływu (oś biegnie od górnego do dolnego końca rzeki)
  let fdx = axis.xs[axis.xs.length - 1] - axis.xs[0];
  let fdy = axis.ys[axis.ys.length - 1] - axis.ys[0];
  { const fl = Math.sqrt(fdx * fdx + fdy * fdy) || 1; fdx /= fl; fdy /= fl; }
  // MORZE (styl delta): brzeg w poprzek spływu, z zatokami z szumu; dc — odległość w głąb lądu [m] (< 0 morze)
  const cN1 = coast ? noiseField(128, 2.2 * extentKm / 40, 3, sd(51)) : null;
  const cN2 = coast ? noiseField(256, 9 * extentKm / 40, 3, sd(52)) : null;
  const cN3 = coast ? noiseField(128, 5 * extentKm / 40, 3, sd(53)) : null;
  const coastOff = L * 0.1;
  const dcBase = (x, y) => coastOff - ((x - L / 2) * fdx + (y - L / 2) * fdy) + L * 0.1 * sample(cN1, x / L, y / L)
    + L * 0.05 * sample(cN3, x / L, y / L) + L * 0.018 * sample(cN2, x / L, y / L);
  const apexD = L * 0.24;
  const tideK = coast ? rng.range(0.25, 1.0) : 0;

  // raster „kiedy ostatnio płynęła tu rzeka” (0 — nigdy) i starorzecza
  const iterations = Math.max(1, RS.iterations);
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
  // teksele w kole o promieniu rM [m] wokół punktu: fn(indeks, odległość [m])
  const eachInDisc = (x, y, rM, fn) => {
    const cx = x / cs;
    const cy = y / cs;
    const r = rM / cs;
    if (cx < -r || cy < -r || cx > N + r || cy > N + r) return;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(N - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(N - 1, Math.ceil(cy + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.sqrt((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2) * cs;
        if (d <= rM) fn(yy * N + xx, d);
      }
    }
  };
  const tSim = now();
  let riv;
  if (braided || RS.islands) {
    // rzeka roztokowa i wielka rzeka: koryto idzie osią doliny z łagodnym kołysaniem (plecionkę koryt, wyspy i boczne
    // ramiona rysuje wzór we współrzędnych „wzdłuż / w poprzek”); wielka rzeka z symulacji meandrów wychodziła wężem
    // o równych pętlach — wzorzec to szerokie, łagodne koryto
    const a = resample(axis.xs, axis.ys, pds);
    const n = a.xs.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const tx = a.xs[i1] - a.xs[i0];
      const ty = a.ys[i1] - a.ys[i0];
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      const off = braided
        ? bed * (0.8 * vnoise(i * pds / (bed * 11), 0.5, sd(13)) + 0.3 * vnoise(i * pds / (bed * 3.7), 7.5, sd(14)))
        : W * (4.2 * vnoise(i * pds / (W * 13), 0.5, sd(13)) + 1.5 * vnoise(i * pds / (W * 5), 7.5, sd(14)));
      xs[i] = a.xs[i] - ty / tl * off;
      ys[i] = a.ys[i] + tx / tl * off;
      if (i) len += Math.sqrt((xs[i] - xs[i - 1]) ** 2 + (ys[i] - ys[i - 1]) ** 2);
    }
    riv = { xs, ys, cutoffs: 0, length: len };
  } else {
    riv = simulateMeanders({
      axis, W, ds, iterations, erod, rng, stampEvery: 6,
      onStamp: (it, xs, ys) => { for (let i = 0; i < xs.length; i++) stampDisc(lastChan, xs[i], ys[i], rc + 0.35, it + 1); },
      onCutoff: (it, xs, ys) => { for (let i = 0; i < xs.length; i++) stampDisc(oxIt, xs[i], ys[i], Math.max(0.8, rc * 0.8), it + 1); }
    });
  }
  stats.simMs = now() - tSim;
  stats.cutoffs = riv.cutoffs;
  const rx = riv.xs;
  const ry = riv.ys;
  const nR = rx.length;
  // styczne osi rzeki, rozszerzenia koryta (wielka rzeka), półszerokość łożyska (roztoki)
  const rtx = new Float32Array(nR);
  const rty = new Float32Array(nR);
  const wide = new Float32Array(nR);
  const bedHalf = new Float32Array(nR);
  for (let i = 0; i < nR; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(nR - 1, i + 1);
    const tx = rx[i1] - rx[i0];
    const ty = ry[i1] - ry[i0];
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    rtx[i] = tx / tl;
    rty[i] = ty / tl;
    wide[i] = RS.islands ? sstep(0.0, 0.5, vnoise(i * pds / (W * 9), 3.3, sd(15))) : 0;
    bedHalf[i] = braided ? bed * (0.55 + 0.75 * (0.5 + 0.5 * vnoise(i * pds / (bed * 5), 2.1, sd(16)))) : 0;
  }
  // delta: rzeka kończy się w wierzchołku delty, dalej ramiona
  let mainEnd = nR - 1;
  let arms = [];
  if (coast) {
    for (let i = 4; i < nR; i++) if (dcBase(rx[i], ry[i]) < apexD) { mainEnd = i; break; }
    const j = Math.max(0, mainEnd - 4);
    arms = growDistributaries({
      rng, apex: { x: rx[mainEnd], y: ry[mainEnd], dir: Math.atan2(ry[mainEnd] - ry[j], rx[mainEnd] - rx[j]) }, dcAt: dcBase,
      flowAng: Math.atan2(fdy, fdx), W, L, tideK
    });
  }
  // półszerokość koryta głównego w węźle (wielka rzeka: rozszerzenia z wyspami)
  const hwAt = (i) => W * 0.5 * (RS.islands ? 0.75 + 1.3 * wide[i] : 1);
  // rastry wody: wEdge — odległość do brzegu wody [m] (< 0 w wodzie, do +420 m od brzegu), dMain / iMain — odległość do
  // osi rzeki głównej i najbliższy jej węzeł (współrzędne „wzdłuż / w poprzek” dla wysp i plecionki koryt)
  const wEdge = new Float32Array(N * N).fill(1e6);
  const dMain = new Float32Array(N * N).fill(1e6);
  const iMain = new Int32Array(N * N).fill(-1);
  const BANK = 420;
  {
    const coordR = braided ? bed * 1.9 : (RS.islands ? W * 3.9 : W * 1.7);
    for (let i = 0; i <= mainEnd; i++) {
      const half = braided ? 0 : hwAt(i);
      const R = Math.max(coordR, half + BANK);
      eachInDisc(rx[i], ry[i], R, (k, d) => {
        if (!braided && d - half < wEdge[k]) wEdge[k] = d - half;
        if (d < dMain[k]) { dMain[k] = d; iMain[k] = i; }
      });
      // brzeg wody także z punktu w połowie odcinka (koła co pół szerokości koryta dawały falisty brzeg)
      if (!braided && !RS.islands && i < mainEnd) {
        eachInDisc((rx[i] + rx[i + 1]) * 0.5, (ry[i] + ry[i + 1]) * 0.5, half + BANK, (k, d) => { if (d - half < wEdge[k]) wEdge[k] = d - half; });
      }
    }
    // wielka rzeka: daleki zasięg współrzędnych (dolina zalewowa) z co czwartego węzła
    if (RS.islands) {
      for (let i = 0; i <= mainEnd; i += 4) eachInDisc(rx[i], ry[i], W * 6.8, (k, d) => { if (d < dMain[k]) { dMain[k] = d; iMain[k] = i; } });
    }
  }
  // wały i łachy ujściowe ramion wysunięte w morze (ląd przyrasta przy ujściach)
  const lev = coast ? new Float32Array(N * N).fill(1e6) : null;
  for (const arm of arms) {
    const n = arm.xs.length;
    let firstSea = n;
    for (let j = 0; j < n; j++) if (dcBase(arm.xs[j], arm.ys[j]) < 0) { firstSea = j; break; }
    for (let j = 0; j < n; j++) {
      const half = arm.ws[j] * 0.5;
      eachInDisc(arm.xs[j], arm.ys[j], half + BANK, (k, d) => { if (d - half < wEdge[k]) wEdge[k] = d - half; });
      if (j >= firstSea - 2) {
        const t = (n - 1 - j) / Math.max(1, n - firstSea);
        const lh = half + arm.w * (0.7 + 2.6 * (1 - tideK)) * sstep(0.0, 0.4, t);
        eachInDisc(arm.xs[j], arm.ys[j], lh, (k, d) => { if (d - lh < lev[k]) lev[k] = d - lh; });
      }
    }
  }
  // WIELKA RZEKA: dolina zalewowa jako pas wokół koryta („wiek” powierzchni rośnie z odległością od koryta — z niego
  // łuki dawnych koryt równoległe do rzeki i sukcesja roślin) oraz boczne ramiona, które odchodzą od koryta i wracają
  if (RS.islands) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        const im = iMain[k];
        if (im < 0) continue;
        const xm = (x + 0.5) * cs;
        const ym = (y + 0.5) * cs;
        const rxm = xm - rx[im];
        const rym = ym - ry[im];
        const sF = im * pds + rxm * rtx[im] + rym * rty[im];
        const nS = rtx[im] * rym - rty[im] * rxm;
        const hw = hwAt(im);
        const beltH = W * (4.2 + 1.6 * vnoise(sF / (W * 9), 6.6, sd(71)));
        const dE = Math.max(0, dMain[k] - hw);
        if (dE < beltH) {
          const age = Math.min(1, Math.max(0, dE / beltH + 0.1 * vnoise(xm / (W * 1.4), ym / (W * 1.4), sd(72))));
          lastChan[k] = Math.max(1, Math.round(iterations * (1 - age)));
        }
        for (let t = 0; t < 2; t++) {
          const on = sstep(-0.05, 0.3, vnoise(sF / (W * 13) + t * 7.7, 9.1 + t * 3.3, sd(73)));
          if (on < 0.02) continue;
          const nSide = W * 3.3 * vnoise(sF / (W * 8) + t * 31.7, 2.3 + t * 5.9, sd(74));
          const half = W * 0.17 * (0.7 + 0.6 * (0.5 + 0.5 * vnoise(sF / (W * 3), 4.4 + t, sd(75)))) * on;
          const we = Math.abs(nS - nSide) - half;
          if (we < wEdge[k]) wEdge[k] = we;
        }
      }
    }
  }
  // odległość w głąb lądu z przyrostem lądu przy ujściach
  const dcl = coast ? new Float32Array(N * N) : null;
  if (coast) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        dcl[k] = Math.max(dcBase((x + 0.5) * cs, (y + 0.5) * cs), -lev[k]);
      }
    }
  }
  // dolina zalewowa: miejsca, gdzie kiedykolwiek płynęła rzeka (wygładzony zasięg); roztoki: łożysko z terasą;
  // delta: tylko powyżej wierzchołka delty
  const ever = new Float32Array(N * N);
  for (let i = 0; i < ever.length; i++) {
    if (braided) {
      const im = iMain[i];
      ever[i] = im >= 0 ? 1 - sstep(bedHalf[im] + 60, bedHalf[im] + 520, dMain[i]) : 0;
    } else ever[i] = lastChan[i] ? (coast ? sstep(apexD * 0.55, apexD * 1.05, dcl[i]) : 1) : 0;
  }
  const plain = boxBlur(ever, N, Math.max(1, Math.round(W * 0.6 / cs)), 2);

  // ── 2. rzeźba [m] ──
  const nA = noiseField(256, 3.2 * extentKm / 20, 5, sd(21));
  const nB = noiseField(512, 14 * extentKm / 20, 4, sd(22));
  const nC = noiseField(256, 6 * extentKm / 20, 4, sd(23));
  const nD = noiseField(512, 30 * extentKm / 20, 3, sd(24));
  const height = new Float32Array(N * N);
  const floor = new Float32Array(N * N);       // udział dna doliny w tym miejscu 0…1
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
      if (coast) {
        // nizina delty opada do morza; morze: dno coraz głębsze od brzegu
        const dc = dcl[k];
        const low = sstep(0, apexD * 1.5, dc);
        h = mix(0.9 + 0.7 * sample(nD, u, v), h, low * low);
        if (dc < 0) h = -0.5 - Math.min(30, -dc * 0.004);
      }
      const wat = 1 - sstep(-W * 0.1, W * 0.12, wEdge[k]);
      h -= wat * 2.5;
      height[k] = h;
      floor[k] = p;
    }
  }

  // ── 3. cieki: spływ po rzeźbie; dno doliny, woda, morze i brzeg mapy to ujścia ──
  const tDr = now();
  const hd = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      hd[k] = (edge || floor[k] > 0.5 || wEdge[k] < 0 || (coast && dcl[k] < 0)) ? -1 : Math.max(1e-4, height[k] / 1000);
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
  let creek = null;
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
    // POTOKI PŁYWOWE (delta): cieki niziny przy morzu rozszerzają się ku ujściu — woda o szerokości z wielkości
    // zlewni i z bliskości morza
    if (coast) {
      creek = new Uint8Array(N * N);
      for (let i = 0; i < order.length; i++) {
        const c = order[i];
        if (!isStream[c]) continue;
        // (tylko większe cieki i blisko morza — każdy strumyk niziny jako potok pływowy dawał gęsty „system korzeni”)
        const dc = dcl[c];
        if (dc <= 0 || dc > apexD * 0.75 || flow[c] < tStream * 3) continue;
        const half = cs * (0.1 + 0.3 * Math.log2(flow[c] / (tStream * 3) + 1)) * (1 + 3.4 * Math.exp(-dc / 1500)) * (1 - sstep(apexD * 0.4, apexD * 0.75, dc));
        if (half < cs * 0.9) continue;
        // położenie = średnia z kilku komórek w dół cieku (ścieżka spływu idzie zygzakiem po ośmiu kierunkach siatki —
        // cienki potok rysowany wprost po niej wyglądał jak błyskawica)
        let sx = 0;
        let sy = 0;
        let cnt = 0;
        for (let q = c, j = 0; j < 6 && q >= 0 && hd[q] > 0; j++, q = rcv[q]) { const qy = (q / N) | 0; sx += q - qy * N + 0.5; sy += qy + 0.5; cnt++; }
        eachInDisc(sx / cnt * cs, sy / cnt * cs, half + 3 * cs, (k, d) => { if (d - half < wEdge[k]) { wEdge[k] = d - half; creek[k] = 1; } });
      }
    }
  }
  // STRUMIENIE wysoczyzny jako linie: położenie uśrednione z kilku komórek w dół cieku (ścieżka spływu idzie zygzakiem
  // po ośmiu kierunkach siatki — rysowana wprost wyglądała jak pęknięcia), grubość z wielkości zlewni
  const streamCov = new Float32Array(N * N);
  {
    const rcv = dr.receiver;
    const flow = dr.flow;
    const order = dr.order;
    for (let i = 0; i < order.length; i++) {
      const c = order[i];
      if (!isStream[c] || flow[c] < tStream * 2.5) continue;
      let sx = 0;
      let sy = 0;
      let cnt = 0;
      for (let q = c, j = 0; j < 7 && q >= 0 && hd[q] > 0; j++, q = rcv[q]) { const qy = (q / N) | 0; sx += q - qy * N + 0.5; sy += qy + 0.5; cnt++; }
      const r = cs * Math.min(1.5, 0.45 + 0.16 * Math.log2(flow[c] / (tStream * 2.5) + 1));
      const kMax = Math.min(0.85, 0.35 + 0.13 * Math.log2(flow[c] / (tStream * 2.5) + 1));
      eachInDisc(sx / cnt * cs, sy / cnt * cs, r + cs, (k, d) => {
        const cv = (1 - sstep(r - 0.6 * cs, r + 0.6 * cs, d)) * kMax;
        if (cv > streamCov[k]) streamCov[k] = cv;
      });
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
  // SMUGI OSADU W MORZU (delta): źródła = woda ujść przy brzegu, rozmyte w dwóch skalach; w barwach czytane
  // z przesunięciem (wiry, znoszenie wzdłuż brzegu)
  let plumeA = null;
  let plumeB = null;
  if (coast) {
    // (źródła tylko w ujściach RAMION delty, ważone szerokością — z potokami pływowymi smuga była równym pasem
    // wzdłuż całego brzegu)
    const src = new Float32Array(N * N);
    for (const arm of arms) {
      for (let j = 0; j < arm.xs.length; j++) {
        if (Math.abs(dcBase(arm.xs[j], arm.ys[j])) > 500) continue;
        const half = arm.ws[j] * 0.5;
        eachInDisc(arm.xs[j], arm.ys[j], half, (k) => { src[k] = 1; });
      }
    }
    plumeA = boxBlur(Float32Array.from(src), N, Math.max(2, Math.round(1100 / cs)), 4);
    plumeB = boxBlur(src, N, Math.max(4, Math.round(3600 / cs)), 4);
    let ma = 1e-6;
    let mb = 1e-6;
    for (let i = 0; i < plumeA.length; i++) { if (plumeA[i] > ma) ma = plumeA[i]; if (plumeB[i] > mb) mb = plumeB[i]; }
    for (let i = 0; i < plumeA.length; i++) { plumeA[i] /= ma; plumeB[i] /= mb; }
  }
  const rsample = (arr, fx, fy) => {
    const x = Math.min(N - 1.001, Math.max(0, fx));
    const y = Math.min(N - 1.001, Math.max(0, fy));
    const ix = x | 0;
    const iy = y | 0;
    const tx = x - ix;
    const ty = y - iy;
    const i = iy * N + ix;
    return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - ty) + (arr[i + N] * (1 - tx) + arr[i + N + 1] * tx) * ty;
  };

  // ── 4–5. pokrycie i barwy ──
  const tCol = now();
  const cover = new Uint8Array(N * N);
  const canopy = new Float32Array(N * N);       // wysokość koron [m] — do cienia skraju lasu
  const rgb = new Float32Array(N * N * 3);
  const nE = noiseField(512, 46 * extentKm / 20, 3, sd(25));     // drzewostany
  const nF = noiseField(256, 9 * extentKm / 20, 4, sd(26));      // okolice z torfowiskami
  const nG = noiseField(256, 15 * extentKm / 20, 3, sd(27));     // kępy drugiego gatunku drzew
  const itN = iterations;
  const cellI = (braided ? 120 : Math.min(W, 160)) * 3.3;         // oczko „plastra miodu” [m]
  const honeySeed = sd(41);
  const bs = sd(61);
  const driftS = rng.chance(0.5) ? 1 : -1;
  const put = (k, c, a) => { const o = k * 3; rgb[o] = mix(rgb[o], c[0], a); rgb[o + 1] = mix(rgb[o + 1], c[1], a); rgb[o + 2] = mix(rgb[o + 2], c[2], a); };
  let seaCells = 0;
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
      const dc = coast ? dcl[k] : 1e9;
      // MORZE: głębia → szelf → smugi osadu (turkus, przy ujściach mleczny)
      if (dc < 0) {
        const off = -dc;
        const wx = 1500 * vnoise(xm / 7000, ym / 7000, bs + 1) + 520 * vnoise(xm / 2200, ym / 2200, bs + 2);
        const wy = 1500 * vnoise(xm / 7000 + 31.7, ym / 7000 - 12.3, bs + 3) + 520 * vnoise(xm / 2200 - 8.1, ym / 2200 + 4.4, bs + 4);
        const dr2 = driftS * Math.min(off, 9000) * 0.5;
        const px = (xm + wx + fdy * dr2 - fdx * off * 0.15) / cs;
        const py = (ym + wy - fdx * dr2 - fdy * off * 0.15) / cs;
        const fil = 0.72 + 0.5 * (0.5 + 0.5 * vnoise((xm + wx * 1.6) / 1700, (ym + wy * 1.6) / 1700, bs + 5));
        let pl = (Math.min(1, rsample(plumeA, px, py) * 2.4) * 0.75 + Math.min(1, rsample(plumeB, px, py) * 1.7) * 0.5) * fil;
        pl = Math.min(1, pl + Math.exp(-off / 700) * 0.22 * (0.6 + 0.8 * (0.5 + 0.5 * vnoise(xm / 4000, ym / 4000, bs + 7))));
        const shelf = Math.exp(-off / 3500) * 0.75 + 0.12 * (0.5 + 0.5 * vnoise(xm / 9000, ym / 9000, bs + 6));
        let col = mix3(SEA.deep, SEA.shelf, Math.min(1, shelf));
        col = mix3(col, SEA.turq, sstep(0.04, 0.5, pl));
        col = mix3(col, SEA.milky, sstep(0.42, 1.0, pl) * 0.85);
        // osad rzeki tuż przy ujściu
        col = mix3(col, WC.edge, sstep(0.75, 1.0, pl) * Math.exp(-off / 1200) * 0.5);
        rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
        const t = 1 + grain * 0.02;
        rgb[o] *= t; rgb[o + 1] *= t; rgb[o + 2] *= t;
        cover[k] = TERRAIN_COVER.WATER;
        canopy[k] = 0;
        seaCells++;
        continue;
      }
      // LAS: płaty drzewostanów, jaśniej na suchych wyniesieniach, kępy drugiego gatunku (inna barwa koron)
      const st = sstep(-0.35, 0.45, e + c * 0.5);
      let fa = mix(P.forestA[0], P.forestB[0], st);
      let fb = mix(P.forestA[1], P.forestB[1], st);
      let fc = mix(P.forestA[2], P.forestB[2], st);
      const dry = sstep(0.15, 0.6, a + c * 0.4);
      fa = mix(fa, P.forestC[0], dry * 0.6); fb = mix(fb, P.forestC[1], dry * 0.6); fc = mix(fc, P.forestC[2], dry * 0.6);
      if (P.accent) {
        // (rzadkie kępy o miękkim brzegu — gęste, nasycone plamy wyglądały jak konfetti)
        const ac = sstep(0.4, 0.62, sample(nG, u, v) + e * 0.3 + dry * 0.15) * 0.55;
        fa = mix(fa, P.accent[0], ac); fb = mix(fb, P.accent[1], ac); fc = mix(fc, P.accent[2], ac);
      }
      rgb[o] = fa; rgb[o + 1] = fb; rgb[o + 2] = fc;
      let cov = TERRAIN_COVER.FOREST;
      let can = 15 + e * 3;
      let tex = 0.075;                               // siła ziarna koron
      // nachylenie wzgórz [m/m]
      const sx = (hSm[k + (x < N - 1 ? 1 : 0)] - hSm[k - (x > 0 ? 1 : 0)]) / (2 * cs);
      const sy = (hSm[k + (y < N - 1 ? N : 0)] - hSm[k - (y > 0 ? N : 0)]) / (2 * cs);
      const slope = Math.sqrt(sx * sx + sy * sy);
      const p = floor[k];
      // współrzędne względem osi rzeki głównej: s — wzdłuż [m], nS — w poprzek ze znakiem [m]
      const im = iMain[k];
      let sF = 0;
      let nS = 0;
      if (im >= 0) {
        const rxm = xm - rx[im];
        const rym = ym - ry[im];
        sF = im * pds + rxm * rtx[im] + rym * rty[im];
        nS = rtx[im] * rym - rty[im] * rxm;
      }
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
        // (nizina delty ma własne pokrycie — namorzyny i trzciny — torfowiska gasną ku morzu)
        const inland = coast ? sstep(apexD * 0.5, apexD * 1.3, dc) : 1;
        let fen = Math.max(wetLine * (0.6 + 0.4 * flat) * Math.min(1, VEG_FEN[veg] + 0.3), bogPlain * region * VEG_FEN[veg]) * inland;
        // brzeg torfowiska nierówny w skali kilkudziesięciu metrów (gładki obrys wyglądał jak plama farby)
        fen += (0.2 * vnoise(xm / 110, ym / 110, honeySeed + 21) + 0.12 * vnoise(xm / 45, ym / 45, honeySeed + 22)) * sstep(0.04, 0.4, fen) * (1 - sstep(0.75, 1.0, fen));
        // łęg wzdłuż większych strumieni
        const rip = (1 - sstep(0.5, 2.0, hnd + e * 0.5)) * (1 - small);
        if (rip > 0.01) { put(k, P.riparian, rip * 0.6); can = mix(can, 17, rip); }
        if (fen > 0.02) {
          // wyspy drzew w szerokim torfowisku („plaster miodu”): wnętrza nieregularnych komórek, jasne pasma
          // torfowiska = GRANICE komórek o zmiennej szerokości (wzór ze zdjęcia: ciasno upakowane ciemne wielokąty
          // o zaokrąglonych rogach, nie równe kółka)
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
          // (otoczka: wilgotna zieleń przechodząca w zarośla — na zdjęciu torfowisko ma zielone obrzeże, nie ostrą
          // granicę z lasem)
          // (wyspy drzew zostają ciemnym lasem — otoczka tylko na obrzeżu torfowiska)
          const shrubK = sstep(0.04, 0.42, fen) * (1 - f) * (1 - 0.8 * island);
          put(k, mix3(P.shrub, P.fenWet, sstep(0.15, 0.4, fen)), shrubK * 0.85);
          const tone = sstep(-0.3, 0.4, e + a * 0.6);
          const fenC = mix3(P.fen, P.fenLight, tone);
          const wet = sstep(0.2, 0.7, c - e * 0.4) * 0.5;
          put(k, mix3(fenC, P.fenWet, wet), f);
          can = mix(can, 0.4, f); can = mix(can, 4, shrubK * 0.8);
          tex = mix(tex, 0.03, f);
          if (f > 0.5) cov = TERRAIN_COVER.FEN; else if (shrubK > 0.5) cov = TERRAIN_COVER.SHRUB;
        }
        // strumień: ciemna linia z rastra `streamCov` (wygładzony bieg)
        const sc = streamCov[k];
        if (sc > 0.02) {
          put(k, WC.stream, sc);
          can = mix(can, 2, sc);
          if (sc > 0.6) cov = TERRAIN_COVER.WATER;
        }
      }
      // NIZINA DELTY: namorzyny (ciemny las pływów), trzcinowiska, jaśniejsze wały przy korytach, błota przy brzegu
      if (coast && dc < apexD * 1.3) {
        const dl = 1 - sstep(apexD * 0.35, apexD * 1.3, dc);
        const nearW = 1 - sstep(60, 900, wEdge[k]);
        const mg = dl * (0.6 + 0.4 * sstep(-0.2, 0.3, c + e * 0.4));
        put(k, P.mangrove, mg * 0.92);
        const marsh = dl * sstep(0.1, 0.45, fr + a * 0.35 - nearW * 0.4 + e * 0.15);
        put(k, P.marsh, marsh * 0.75);
        put(k, P.meadow, nearW * dl * 0.3);
        const flats = (1 - sstep(30, 300 + 320 * (0.5 + 0.5 * c), dc)) * (1 - 0.6 * sstep(-0.1, 0.3, e));
        put(k, mix3(G0.sand, G0.mud, tideK), flats * 0.88);
        can = mix(can, 9, mg); can = mix(can, 0.6, marsh * 0.75); can = mix(can, 0, flats);
        tex = mix(tex, 0.05, dl);
        if (flats > 0.5) cov = TERRAIN_COVER.SAND; else if (marsh > 0.5) cov = TERRAIN_COVER.MEADOW;
      }
      if (braided && im >= 0) {
        // RZEKA ROZTOKOWA: żwirowe łożysko, plecionka koryt = linie zera dwóch szumów rozciągniętych wzdłuż spływu
        // (łachy w kształcie soczewek), nurt główny, zarośnięte stare łachy przy brzegach łożyska, terasa wokół
        const Bh = bedHalf[im];
        const an = Math.abs(nS);
        // (brzeg łożyska i terasy nierówny — równoległe krawędzie wyglądały jak pas drogi)
        const wobB = 170 * vnoise(xm / 800, ym / 800, bs + 43) + 60 * vnoise(xm / 260, ym / 260, bs + 44);
        const terrK = (1 - sstep(Bh + 60, Bh + 620, an + wobB * 2.2)) * sstep(-0.25, 0.25, c + e * 0.4 + fr * 0.4);
        if (terrK > 0.01) {
          put(k, mix3(P.grass, P.meadow, sstep(-0.2, 0.3, e)), terrK * 0.85);
          put(k, P.shrub, terrK * sstep(0.1, 0.4, fr + e * 0.4) * 0.6);
          can = mix(can, 1.5, terrK);
          if (terrK > 0.5) cov = TERRAIN_COVER.MEADOW;
        }
        const inBed = 1 - sstep(Bh * 0.96, Bh * 1.04 + cs, an + wobB);
        if (inBed > 0.01) {
          const a_ = sF / (bed * 1.5);
          const b0 = nS / (bed * 0.22);
          const b_ = b0 + 0.9 * vnoise(a_ * 0.6, b0 * 0.25, bs + 9);
          const n1 = fbm(a_, b_, 3, bs + 11);
          const n2 = fbm(a_ * 1.9 + 5.3, b_ * 1.6 - 3.1, 3, bs + 23);
          const fade = 1 - sstep(Bh * 0.8, Bh * 0.97, an);
          const n3 = fbm(a_ * 3.3 - 7.1, b_ * 2.6 + 4.7, 2, bs + 29);
          const c1 = (1 - sstep(0.05, 0.1, Math.abs(n1))) * fade;
          const c2 = (1 - sstep(0.03, 0.065, Math.abs(n2))) * fade * 0.9;
          const c3 = (1 - sstep(0.02, 0.05, Math.abs(n3))) * fade * 0.7;
          const nMain = Bh * 0.55 * vnoise(sF / (bed * 2.6), 0.5, bs + 31);
          const wm = W * (1.0 + 0.6 * vnoise(sF / (bed * 1.3), 4.5, bs + 37));
          const cm = 1 - sstep(wm * 0.65, wm, Math.abs(nS - nMain));
          const water = Math.max(cm, c1, c2, c3);
          // łachy: jasny żwir, ciemniejszy i wilgotny przy korytach, smugi wzdłuż spływu
          const damp = (1 - sstep(0.07, 0.22, Math.abs(n1))) * 0.55 + 0.3 * (0.5 + 0.5 * vnoise(a_ * 7, b_ * 1.4, bs + 41));
          let col = mix3(G0.gravel, G0.gravelDark, Math.min(1, damp));
          const vb = sstep(0.15, 0.42, fbm(a_ * 0.5 + 9.2, b_ * 0.45 + 2.6, 2, bs + 47) + (an / Bh - 0.55) * 0.9) * (1 - water);
          col = mix3(col, mix3(P.shrub, P.meadow, 0.5 + 0.5 * e), vb * 0.9);
          col = mix3(col, mix3(WC.edge, WC.river, Math.max(cm, c1 * 0.7)), water);
          put(k, col, inBed);
          can = mix(can, vb * 3, inBed);
          tex = mix(tex, 0.035, inBed);
          if (inBed > 0.5) cov = water > 0.5 ? TERRAIN_COVER.WATER : (vb > 0.5 ? TERRAIN_COVER.SHRUB : TERRAIN_COVER.SAND);
        }
      } else if (p > 0.02) {
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
        if (fresh) { col = WC.edge; ch = 0; } else if (age < 0.02) { col = G0.sand; ch = 0; cov = TERRAIN_COVER.SAND; } else {
          const g1 = sstep(0.02, 0.06, age);                        // piasek → trawy
          const g2 = sstep(0.05, 0.16, age);                        // trawy → łąka
          // (granica łąka / las poszarpana kępami — gładkie przejście z wieku powierzchni wyglądało na malowane)
          const g3 = sstep(0.14, 0.5, age + c * 0.18 + e * 0.12 + 0.1 * vnoise(xm / 130, ym / 130, bs + 71));   // łąka → zarośla i las
          col = mix3(mix3(G0.sand, P.grass, g1), P.meadow, g2);
          // zarośla w obniżeniach, jaśniejsza trawa na grzędach
          const th = sstep(0.35, 0.75, (1 - ridge) * 0.45 + e * 0.6 + c * 0.3 + 0.25) * sstep(0.04, 0.2, age);
          col = mix3(col, P.thicket, th * 0.8);
          col = mix3(col, P.grass, ridge * (1 - th) * 0.1);
          // stare powierzchnie: las łęgowy, miejscami wrzosowiska i jasne suche tarasy
          col = mix3(col, mix3(P.riparian, P.forestB, 0.5), g3);
          const heath = sstep(0.2, 0.55, c + e * 0.3) * sstep(0.3, 0.6, age) * 0.7;
          col = mix3(col, P.heath, heath);
          const terr = sstep(0.25, 0.55, a - e * 0.3 - c * 0.4) * sstep(0.35, 0.7, age) * 0.7;
          col = mix3(col, P.terrace, terr);
          ch = mix(mix(0.4, 5, th), 14, g3 * (1 - heath) * (1 - terr));
          cov = g3 > 0.6 && heath < 0.4 && terr < 0.4 ? TERRAIN_COVER.FOREST : (th > 0.5 ? TERRAIN_COVER.SHRUB : TERRAIN_COVER.MEADOW);
          // wielka rzeka: jeziora w obniżeniach między łukami dawnych koryt (woda niosąca muł)
          // (plamy wydłużone wzdłuż rzeki, rzadko — woda w każdym obniżeniu między łukami dawała przerywane kreski
          // jak ścieg)
          if (RS.islands && im >= 0) {
            const ln = vnoise(sF / (W * 2.8), nS / (W * 0.75), bs + 63) + 0.5 * vnoise(sF / (W * 1.1) + 7.7, nS / (W * 0.4), bs + 64);
            const lk = sstep(0.62, 0.74, ln) * sstep(0.04, 0.12, age) * (1 - sstep(0.5, 0.8, age));
            if (lk > 0.01) { col = mix3(col, WC.lake, lk); ch = mix(ch, 0, lk); if (lk > 0.5) cov = TERRAIN_COVER.WATER; }
          }
        }
        put(k, col, fp);
        can = mix(can, ch, fp);
        tex = mix(tex, 0.045, fp);
        // starorzecza: młode — woda, stare — zarośnięte ciemne łuki
        const ox = oxIt[k];
        if (ox && lc <= ox + 8) {
          const oa = (itN - ox) / itN;
          const w = 1 - sstep(0.25, 0.55, oa);
          put(k, WC.oxbow, 0.9 * w);
          put(k, P.thicket, (1 - w) * 0.6);
          can = mix(can, 0, w);
          if (w > 0.5) cov = TERRAIN_COVER.WATER;
        }
      }
      // WODA rzeki, ramion delty i potoków pływowych
      if (!braided) {
        const we = wEdge[k];
        const wat = 1 - sstep(-cs * 0.7, cs * 0.7, we);
        if (wat > 0) {
          // (ramiona delty i potoki pływowe w jednej barwie — jaśniejszy brzeg przy wąskim korycie wyglądał jak krawężnik)
          const deep = coast ? 0.7 : sstep(0, W * 0.28, -we);
          let col = mix3(WC.edge, WC.river, deep);
          // smugi nurtu (osad): wzdłuż rzeki
          if (im >= 0) { const sk = vnoise(sF / (W * 5), nS / (W * 0.35), bs + 53); col = [col[0] * (1 + sk * 0.06), col[1] * (1 + sk * 0.06), col[2] * (1 + sk * 0.06)]; }
          // przy morzu woda rzeki jaśnieje ku barwie smug osadu; potoki pływowe — ciemna woda morska (jasne, cienkie
          // potoki wyglądały jak pęknięcia)
          if (coast) {
            col = mix3(col, mix3(SEA.turq, SEA.milky, 0.6), (1 - sstep(0, 3200, dc)) * 0.55);
            if (creek[k]) col = mix3(mix3(SEA.shelf, SEA.turq, 0.35), col, sstep(cs * 2.5, cs * 6, -we) * 0.5);
          }
          let land = 0;
          if (RS.islands && im >= 0 && we < 0 && Math.abs(nS) < hwAt(im)) {
            // WYSPY w rozszerzeniach koryta: soczewki wzdłuż nurtu, piaszczysty brzeg, w środku zarośla i las
            const A = wide[im];
            const hw = hwAt(im);
            const q = nS / hw;
            for (let t = 0; t < 2; t++) {
              // (soczewki krótkie i pękate: kształt z półfali szumu wzdłuż nurtu — długie cienkie wyspy wyglądały
              // jak ciemne szczeliny)
              const lens = vnoise(sF / (W * 2.3) + t * 17.3, 1.7 + t * 5.1, bs + 57);
              const th = (0.26 + 0.36 * A) * Math.sqrt(sstep(0.0, 0.45, lens)) * sstep(0.1, 0.32, A) * (t ? sstep(0.55, 0.8, A) : 1);
              if (th < 0.03) continue;
              const qo = (t ? -0.42 : 0.3) * (0.4 + 0.9 * vnoise(sF / (W * 6.5) + t * 3.1, 5.1, bs + 59)) * (1 - 0.6 * th);
              const dq = Math.abs(q - qo);
              const isl = 1 - sstep(th - 0.05, th, dq);
              if (isl > land) {
                land = isl;
                const core = 1 - sstep(th * 0.35, th * 0.9, dq + e * 0.05);
                const ic = mix3(mix3(G0.sand, WC.edge, 0.2), mix3(mix3(P.grass, P.meadow, 0.6), mix3(P.thicket, P.forestB, 0.5), sstep(0.35, 0.85, core + e * 0.2)), sstep(0.08, 0.4, core));
                col = mix3(col, ic, isl);
                can = mix(can, core * 12, isl);
                if (isl > 0.5) cov = core > 0.4 ? TERRAIN_COVER.FOREST : TERRAIN_COVER.SAND;
              }
            }
          }
          put(k, col, wat);
          can = mix(can, land > 0.5 ? can : -1, wat);
          tex = mix(tex, land > 0.5 ? 0.05 : 0.01, wat);
          if (wat > 0.5 && land <= 0.5) cov = TERRAIN_COVER.WATER;
        }
      }
      cover[k] = cov;
      // ziarno koron: szum co teksel i grudki kilku tekseli (korony i luki — bez tego las jest gładką plamą); te same
      // grudki falują WYSOKOŚĆ koron, więc cieniowanie daje lasowi fakturę oświetlonych i ocienionych kęp
      const clump = vnoise(x / 2.7, y / 2.7, 4177) * 0.6 + vnoise(x / 6.1, y / 6.1, 4178) * 0.4;
      canopy[k] = can + (can > 6 ? (clump * 3.2 + grain * 3.0) : 0);
      const t = 1 + (grain * 2 + clump * 1.3) * tex + e * 0.04;
      rgb[o] *= t; rgb[o + 1] *= t; rgb[o + 2] *= t;
    }
  }
  // cieniowanie: rzeźba (przesadzona — relief niziny to kilkadziesiąt metrów) i wysokość koron (skraj lasu); morze płaskie
  const albedo = new Uint8ClampedArray(N * N * 4);
  const canS = boxBlur(Float32Array.from(canopy), N, 1, 1);
  const lx = -0.62;
  const ly = -0.55;
  const lz = 0.56;
  const flatShade = lz;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const o = k * 3;
      const q = k * 4;
      let b = 1;
      if (!(coast && dcl[k] < 0)) {
        const xl = k - (x > 0 ? 1 : 0);
        const xr = k + (x < N - 1 ? 1 : 0);
        const yu = k - (y > 0 ? N : 0);
        const yd = k + (y < N - 1 ? N : 0);
        const gx = ((height[xr] - height[xl]) * 7 + (canS[xr] - canS[xl]) * 0.55) / (2 * cs);
        const gy = ((height[yd] - height[yu]) * 7 + (canS[yd] - canS[yu]) * 0.55) / (2 * cs);
        const il = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const sh = (-gx * lx - gy * ly + lz) * il;
        b = 1 + (sh - flatShade) * 0.75;
      }
      albedo[q] = rgb[o] * b;
      albedo[q + 1] = rgb[o + 1] * b;
      albedo[q + 2] = rgb[o + 2] * b;
      albedo[q + 3] = 255;
    }
  }
  stats.colorMs = now() - tCol;
  const straight = Math.sqrt((rx[nR - 1] - rx[0]) ** 2 + (ry[nR - 1] - ry[0]) ** 2);
  stats.sinuosity = riv.length / Math.max(1, straight);
  stats.streams = isStream.reduce((s, v) => s + v, 0);
  stats.arms = arms.length;
  stats.seaShare = seaCells / (N * N);
  stats.ms = now() - t0;
  return {
    size: N, extentKm, cellM: cs, biome, riverStyle, veg, seed, albedo, height, cover, sea: coast,
    river: { xs: rx, ys: ry, widthM: W }, stats
  };
}
