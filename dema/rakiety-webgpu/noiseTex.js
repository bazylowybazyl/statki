// dema/rakiety-webgpu/noiseTex.js
//
// Tekstury szumu pieczone RAZ na CPU (kafelkowe — próbkowanie z zawijaniem):
//   • curl3D: pole prędkości bez źródeł dla dymu — rotacja 2D funkcji prądu
//     ψ(x, y, t) (trzeci wymiar tekstury = czas), więc w każdym przekroju
//     czasowym pole jest bezdywergencyjne w płaszczyźnie gry: dym się kłębi
//     i wiruje, ale nie „zapada” w punkty ani nie rozbiega;
//   • noise3D: skalarny fBm (kule ognia, włókna mgławicy, łuki);
//   • noise2D: 4 kanały fBm (faktura kłębów dymu, erozja brzegów).
// Szum gradientowy z okresową siatką — próbkowanie trójliniowe na GPU jest
// tańsze niż liczenie szumu w każdym kroku każdej cząstki.

import * as THREE from 'three/webgpu';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Okresowy szum gradientowy 3D (Perlin) z tablicą permutacji. */
function makeGradNoise3(seed) {
  const rng = mulberry(seed);
  const perm = new Uint16Array(512);
  const p = new Uint16Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
    [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
  ];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const g = G[h % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  };
  // Okres P (w komórkach siatki) w każdej osi.
  return (x, y, z, P) => {
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
    const h = (a, b, c) => perm[perm[perm[a] + b] + c];
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const n000 = grad(h(X0, Y0, Z0), xf, yf, zf);
    const n100 = grad(h(X1, Y0, Z0), xf - 1, yf, zf);
    const n010 = grad(h(X0, Y1, Z0), xf, yf - 1, zf);
    const n110 = grad(h(X1, Y1, Z0), xf - 1, yf - 1, zf);
    const n001 = grad(h(X0, Y0, Z1), xf, yf, zf - 1);
    const n101 = grad(h(X1, Y0, Z1), xf - 1, yf, zf - 1);
    const n011 = grad(h(X0, Y1, Z1), xf, yf - 1, zf - 1);
    const n111 = grad(h(X1, Y1, Z1), xf - 1, yf - 1, zf - 1);
    const x00 = n000 + u * (n100 - n000);
    const x10 = n010 + u * (n110 - n010);
    const x01 = n001 + u * (n101 - n001);
    const x11 = n011 + u * (n111 - n011);
    const y0 = x00 + v * (x10 - x00);
    const y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  };
}

/** fBm okresowy na siatce N³: bazowy okres `cells` komórek, `oct` oktaw. */
function fbm3Grid(N, cells, oct, seed) {
  const noise = makeGradNoise3(seed);
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
          sum += amp * noise(x * k, y * k, z * k, P);
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

function make3D(data, N, format) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = format;
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

/**
 * Pole wirowe dymu: RG = (∂ψ/∂y, −∂ψ/∂x), znormalizowane do ~1 (RMS),
 * przekrój z = czas. Tekstura N³, okres 1 w UV.
 */
export function createCurlTexture(N = 64, seed = 0xC0FFEE) {
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
  return make3D(toHalf(vel), N, THREE.RGBAFormat);
}

/** Skalarny fBm 3D w [0, 1] (R) + drugi, niezależny (G), okres 1 w UV. */
export function createNoise3DTexture(N = 64, seed = 0xBADA55) {
  const a = fbm3Grid(N, 4, 4, seed);
  const b = fbm3Grid(N, 8, 3, seed ^ 0x5F3759DF);
  const data = new Float32Array(N * N * N * 4);
  for (let i = 0; i < N * N * N; i++) {
    data[i * 4] = Math.min(1, Math.max(0, a[i] * 0.9 + 0.5));
    data[i * 4 + 1] = Math.min(1, Math.max(0, b[i] * 0.9 + 0.5));
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 1;
  }
  return make3D(toHalf(data), N, THREE.RGBAFormat);
}

/** 4 kanały okresowego fBm 2D (faktura kłębów), [0, 1]. */
export function createNoise2DTexture(N = 256, seed = 0x1234) {
  const channels = [0, 1, 2, 3].map((c) => {
    const noise = makeGradNoise3(seed + c * 7919);
    const out = new Float32Array(N * N);
    const cells = [6, 8, 5, 10][c];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let amp = 1;
        let sum = 0;
        let norm = 0;
        let P = cells;
        for (let o = 0; o < 5; o++) {
          const k = P / N;
          sum += amp * noise(x * k, y * k, c * 3.1, P);
          norm += amp;
          amp *= 0.55;
          P *= 2;
        }
        out[y * N + x] = sum / norm;
      }
    }
    return out;
  });
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, channels[c][i] * 1.1 + 0.5)) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
