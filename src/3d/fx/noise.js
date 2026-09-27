// src/3d/fx/noise.js
//
// Tekstury szumu warstwy efektów — pieczone RAZ na CPU, kafelkowe (próbkowanie z
// `RepeatWrapping` bez szwów), wspólne dla wszystkich systemów (jedno źródło zamiast
// kopii w demach). Algorytmy i ziarna 1:1 z dem, więc obraz efektów się nie zmienia
// (dane bit w bit — test `fxInfra`):
//   • tile2D   — dema/bronie-webgpu/noise.js: 4 niezależne fbm szumu wartości, RGBA8
//                256² (R, G — kłęby dymu / ogień / przepływ, B — drobny detal,
//                A — wolne zmiany, maski);
//   • cloud2D  — dema/rakiety-webgpu/noiseTex.js: 4 kanały fbm szumu gradientowego,
//                RGBA8 256² (faktura kłębów dymu, erozja brzegów);
//   • noise3D  — tamże: skalarny fbm 3D (R) + drugi niezależny (G), RGBA16F 64³
//                (kule ognia, włókna mgławicy, łuki);
//   • curl3D   — tamże: pole wirowe dymu RG = (∂ψ/∂y, −∂ψ/∂x) (B = ψ), bez źródeł
//                w płaszczyźnie gry, przekrój z = czas, RGBA16F 64³.
//
// Duplikatów obrazu nie scalamy na siłę (PLAN §3): tile2D i cloud2D to różne szumy
// (wartości vs gradient) i zostają osobno. Dane (`bake*`) są czystymi funkcjami bez
// three — można je piec w workerze; `create*Texture` owija je w tekstury three, a
// `fxNoise` trzyma jedną wspólną instancję każdej (leniwie, przy pierwszym użyciu).
// Koszt pieczenia (Node 22, Ryzen 7800X3D, zimny JIT): tile2D ~17 ms, cloud2D ~70 ms,
// noise3D ~100 ms, curl3D ~50 ms — do rozgrzewki (ekran ładowania), nie w klatce.

import * as THREE from 'three/webgpu';

// ---------------------------------------------------------------------------
// tile2D — szum wartości (dema/bronie-webgpu/noise.js)

function makeLattice(period, seed) {
  const n = period * period;
  const v = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    v[i] = s / 4294967296;
  }
  return v;
}

function valueNoiseTile(lat, period, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const w = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = lat[y0 * period + x0];
  const b = lat[y0 * period + x1];
  const c = lat[y1 * period + x0];
  const d = lat[y1 * period + x1];
  return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
}

function fbmValueChannel(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  const lats = [];
  for (let o = 0; o < octaves; o++) lats.push(makeLattice(basePeriod << o, seed + o * 7919));
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        const p = basePeriod << o;
        a += valueNoiseTile(lats[o], p, (x / size) * p, (y / size) * p) * amp;
        norm += amp;
        amp *= 0.5;
      }
      const v = a / norm;
      out[y * size + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // Rozciągnięcie do pełnego zakresu [0, 1] (fbm skupia się wokół 0,5).
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
  return out;
}

/** Dane tile2D: RGBA8 (size² × 4). */
export function bakeTile2D(size = 256) {
  const r = fbmValueChannel(size, 4, 4, 1234567);
  const g = fbmValueChannel(size, 4, 4, 7654321);
  const b = fbmValueChannel(size, 16, 3, 2468013);
  const a = fbmValueChannel(size, 2, 2, 1357911);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Szum gradientowy 3D (dema/rakiety-webgpu/noiseTex.js)

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 12 kierunków gradientu (x, y, z) — spłaszczone, bez tablic tablic.
const GRAD = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1,
  1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
]);

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(h, x, y, z) {
  const g = (h % 12) * 3;
  return GRAD[g] * x + GRAD[g + 1] * y + GRAD[g + 2] * z;
}

/** Tablica permutacji (512) szumu gradientowego — tasowanie Fishera–Yatesa z mulberry. */
function makePerm(seed) {
  const rng = mulberry(seed);
  const perm = new Uint16Array(512);
  const p = new Uint16Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

/** Okresowy szum gradientowy 3D (Perlin), okres P komórek w każdej osi. */
function gradNoise3(perm, x, y, z, P) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const X0 = ((xi % P) + P) % P;
  const Y0 = ((yi % P) + P) % P;
  const Z0 = ((zi % P) + P) % P;
  const X1 = (X0 + 1) % P;
  const Y1 = (Y0 + 1) % P;
  const Z1 = (Z0 + 1) % P;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const n000 = grad(perm[perm[perm[X0] + Y0] + Z0], xf, yf, zf);
  const n100 = grad(perm[perm[perm[X1] + Y0] + Z0], xf - 1, yf, zf);
  const n010 = grad(perm[perm[perm[X0] + Y1] + Z0], xf, yf - 1, zf);
  const n110 = grad(perm[perm[perm[X1] + Y1] + Z0], xf - 1, yf - 1, zf);
  const n001 = grad(perm[perm[perm[X0] + Y0] + Z1], xf, yf, zf - 1);
  const n101 = grad(perm[perm[perm[X1] + Y0] + Z1], xf - 1, yf, zf - 1);
  const n011 = grad(perm[perm[perm[X0] + Y1] + Z1], xf, yf - 1, zf - 1);
  const n111 = grad(perm[perm[perm[X1] + Y1] + Z1], xf - 1, yf - 1, zf - 1);
  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

/** fBm okresowy na siatce N³: bazowy okres `cells` komórek, `oct` oktaw. */
function fbm3Grid(N, cells, oct, seed) {
  const perm = makePerm(seed);
  const out = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let amp = 1;
        let sum = 0;
        let norm = 0;
        let P = cells;
        for (let o = 0; o < oct; o++) {
          const k = P / N;
          sum += amp * gradNoise3(perm, x * k, y * k, z * k, P);
          norm += amp;
          amp *= 0.5;
          P *= 2;
        }
        out[(z * N + y) * N + x] = sum / norm;
      }
    }
  }
  return out;
}

function toHalf(arr) {
  const h = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) h[i] = THREE.DataUtils.toHalfFloat(arr[i]);
  return h;
}

/**
 * Dane curl3D (float32, N³ × 4): RG = (∂ψ/∂y, −∂ψ/∂x) znormalizowane do RMS 1,
 * B = ψ, A = 0. Tekstura N³, okres 1 w UV.
 */
export function bakeCurl3D(N = 64, seed = 0xC0FFEE) {
  const psi = fbm3Grid(N, 4, 3, seed);
  const vel = new Float32Array(N * N * N * 4);
  let sum2 = 0;
  const idx = (x, y, z) => (((z + N) % N) * N + ((y + N) % N)) * N + ((x + N) % N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dpy = (psi[idx(x, y + 1, z)] - psi[idx(x, y - 1, z)]) * 0.5;
        const dpx = (psi[idx(x + 1, y, z)] - psi[idx(x - 1, y, z)]) * 0.5;
        const o = idx(x, y, z) * 4;
        vel[o] = dpy;
        vel[o + 1] = -dpx;
        vel[o + 2] = psi[idx(x, y, z)];
        vel[o + 3] = 0;
        sum2 += dpy * dpy + dpx * dpx;
      }
    }
  }
  const rms = Math.sqrt(sum2 / (N * N * N)) || 1;
  for (let i = 0; i < N * N * N; i++) {
    vel[i * 4] /= rms;
    vel[i * 4 + 1] /= rms;
  }
  return vel;
}

/** Dane noise3D (float32, N³ × 4): R, G — dwa niezależne fBm w [0, 1], B = 0, A = 1. */
export function bakeNoise3D(N = 64, seed = 0xBADA55) {
  const a = fbm3Grid(N, 4, 4, seed);
  const b = fbm3Grid(N, 8, 3, seed ^ 0x5F3759DF);
  const data = new Float32Array(N * N * N * 4);
  for (let i = 0; i < N * N * N; i++) {
    data[i * 4] = Math.min(1, Math.max(0, a[i] * 0.9 + 0.5));
    data[i * 4 + 1] = Math.min(1, Math.max(0, b[i] * 0.9 + 0.5));
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 1;
  }
  return data;
}

/** Dane cloud2D: RGBA8 (N² × 4), 4 kanały okresowego fBm 2D w [0, 1]. */
export function bakeCloud2D(N = 256, seed = 0x1234) {
  const data = new Uint8Array(N * N * 4);
  const CELLS = [6, 8, 5, 10];
  for (let c = 0; c < 4; c++) {
    const perm = makePerm(seed + c * 7919);
    const cells = CELLS[c];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let amp = 1;
        let sum = 0;
        let norm = 0;
        let P = cells;
        for (let o = 0; o < 5; o++) {
          const k = P / N;
          sum += amp * gradNoise3(perm, x * k, y * k, c * 3.1, P);
          norm += amp;
          amp *= 0.55;
          P *= 2;
        }
        // Float32 jak tablica kanału w demie (zaokrąglenie przed skalą 1,1 + 0,5).
        const v = Math.fround(sum / norm);
        data[(y * N + x) * 4 + c] = Math.round(Math.min(1, Math.max(0, v * 1.1 + 0.5)) * 255);
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tekstury three

function make2D(data, N) {
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function make3D(data, N) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** tile2D jako tekstura (RGBA8, mipmapy, zawijanie) — szum dema broni. */
export function createTile2DTexture(size = 256) {
  const tex = make2D(bakeTile2D(size), size);
  tex.name = 'fxNoiseTile2D';
  return tex;
}

/** cloud2D jako tekstura (RGBA8, mipmapy, zawijanie) — faktura dymu dema rakiet. */
export function createCloud2DTexture(N = 256, seed = 0x1234) {
  const tex = make2D(bakeCloud2D(N, seed), N);
  tex.name = 'fxNoiseCloud2D';
  return tex;
}

/** noise3D jako tekstura 3D (RGBA16F, liniowa, zawijanie). */
export function createNoise3DTexture(N = 64, seed = 0xBADA55) {
  const tex = make3D(toHalf(bakeNoise3D(N, seed)), N);
  tex.name = 'fxNoise3D';
  return tex;
}

/** curl3D jako tekstura 3D (RGBA16F, liniowa, zawijanie). */
export function createCurl3DTexture(N = 64, seed = 0xC0FFEE) {
  const tex = make3D(toHalf(bakeCurl3D(N, seed)), N);
  tex.name = 'fxNoiseCurl3D';
  return tex;
}

/**
 * Wspólne tekstury szumu warstwy efektów (jedna instancja każdej, pieczona przy
 * pierwszym użyciu). Systemy biorą je stąd zamiast piec własne kopie.
 */
export const fxNoise = {
  _tile2D: null,
  _cloud2D: null,
  _noise3D: null,
  _curl3D: null,
  tile2D() { return this._tile2D || (this._tile2D = createTile2DTexture()); },
  cloud2D() { return this._cloud2D || (this._cloud2D = createCloud2DTexture()); },
  noise3D() { return this._noise3D || (this._noise3D = createNoise3DTexture()); },
  curl3D() { return this._curl3D || (this._curl3D = createCurl3DTexture()); },
  /** Pieczenie wszystkich z góry (rozgrzewka / ekran ładowania). */
  bakeAll() { this.tile2D(); this.cloud2D(); this.noise3D(); this.curl3D(); return this; },
  dispose() {
    for (const k of ['_tile2D', '_cloud2D', '_noise3D', '_curl3D']) {
      if (this[k]) { this[k].dispose(); this[k] = null; }
    }
  }
};
