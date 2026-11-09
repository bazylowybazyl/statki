// src/3d/planetGen/planetGenNoise3D.js
//
// TEKSTURA SZUMU 3D (kafelkowana) dla objętości liczonych marszem promienia: chmury jako bryła
// (planetGenCloudVolume.tsl.js), zorza (planetGenShell.tsl.js) i cień kłębów na gruncie
// (planetGenSurfaceNear.tsl.js). Jedna próbka tekstury zamiast szumu liczonego
// w shaderze (szum gradientowy to ~40 działań z haszami na próbkę; marsz promienia bierze ich dziesiątki na piksel).
// Kanały (0…1): R — kłęby (szum gradientowy × odwrócony Worley, niskie częstości — kształt chmur), G — odwrócony
// Worley średni (erozja brzegów), B — odwrócony Worley drobny, A — gładki szum gradientowy (kurtyny zorzy, wiatr).
// Liczone raz na CPU z własnego haszu (bez Math.random — zasada żelazna 9), okres = 1 w każdej osi.
import * as THREE from 'three/webgpu';

const hash3 = (x, y, z, s) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
};

// Punkty komórek Worleya o okresie c (c³ punktów, współrzędne w komórce 0…1).
function cellPoints(c, seed) {
  const pts = new Float32Array(c * c * c * 3);
  for (let z = 0; z < c; z++) for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const i = ((z * c + y) * c + x) * 3;
    const h = hash3(x, y, z, seed);
    pts[i] = (h & 1023) / 1023;
    pts[i + 1] = ((h >>> 10) & 1023) / 1023;
    pts[i + 2] = ((h >>> 20) & 1023) / 1023;
  }
  return pts;
}
// Odwrócony Worley (1 przy punkcie komórki, 0 daleko), okres c komórek na jednostkę.
function worley(px, py, pz, c, pts) {
  const fx = px * c; const fy = py * c; const fz = pz * c;
  const ix = Math.floor(fx); const iy = Math.floor(fy); const iz = Math.floor(fz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = ((iz + dz) % c + c) % c;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = ((iy + dy) % c + c) % c;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ((ix + dx) % c + c) % c;
        const i = ((cz * c + cy) * c + cx) * 3;
        const ex = ix + dx + pts[i] - fx;
        const ey = iy + dy + pts[i + 1] - fy;
        const ez = iz + dz + pts[i + 2] - fz;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) best = d;
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best));
}
// Gradienty szumu gradientowego o okresie c.
function gradients(c, seed) {
  const g = new Float32Array(c * c * c * 3);
  for (let z = 0; z < c; z++) for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const i = ((z * c + y) * c + x) * 3;
    const h = hash3(x, y, z, seed);
    const u = ((h & 65535) / 65535) * 2 - 1;
    const t = ((h >>> 16) / 65535) * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    g[i] = s * Math.cos(t); g[i + 1] = s * Math.sin(t); g[i + 2] = u;
  }
  return g;
}
function perlin(px, py, pz, c, g) {
  const fx = px * c; const fy = py * c; const fz = pz * c;
  const ix = Math.floor(fx); const iy = Math.floor(fy); const iz = Math.floor(fz);
  const x = fx - ix; const y = fy - iy; const z = fz - iz;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(x); const v = fade(y); const w = fade(z);
  const at = (dx, dy, dz) => {
    const i = (((((iz + dz) % c + c) % c) * c + (((iy + dy) % c + c) % c)) * c + (((ix + dx) % c + c) % c)) * 3;
    return g[i] * (x - dx) + g[i + 1] * (y - dy) + g[i + 2] * (z - dz);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w) * 1.5;
}

/** Dane tekstury: Uint8Array(N³ · 4) — kanały jak w nagłówku pliku. */
export function buildCloudNoise(N = 64) {
  const out = new Uint8Array(N * N * N * 4);
  const W = [3, 6, 12, 24].map((c, i) => [c, cellPoints(c, 11 + i)]);
  const P = [3, 6, 12].map((c, i) => [c, gradients(c, 101 + i)]);
  const sat = (v) => Math.min(1, Math.max(0, v));
  for (let z = 0; z < N; z++) {
    const pz = (z + 0.5) / N;
    for (let y = 0; y < N; y++) {
      const py = (y + 0.5) / N;
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) / N;
        const w0 = worley(px, py, pz, W[0][0], W[0][1]);
        const w1 = worley(px, py, pz, W[1][0], W[1][1]);
        const w2 = worley(px, py, pz, W[2][0], W[2][1]);
        const w3 = worley(px, py, pz, W[3][0], W[3][1]);
        const pn = perlin(px, py, pz, P[0][0], P[0][1]) * 0.55 + perlin(px, py, pz, P[1][0], P[1][1]) * 0.3 + perlin(px, py, pz, P[2][0], P[2][1]) * 0.15;
        const wLow = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
        // kłęby: gładki szum podniesiony o odwrócony Worley (zaokrąglone „kalafiory”)
        const billow = sat((pn * 0.5 + 0.5) * 0.55 + wLow * 0.75 - 0.12);
        const i = ((z * N + y) * N + x) * 4;
        out[i] = Math.round(billow * 255);
        out[i + 1] = Math.round(sat(w1 * 0.625 + w2 * 0.25 + w3 * 0.125) * 255);
        out[i + 2] = Math.round(sat(w2 * 0.6 + w3 * 0.4) * 255);
        out[i + 3] = Math.round(sat(pn * 0.5 + 0.5) * 255);
      }
    }
  }
  return out;
}

let shared = null;
/** Wspólna tekstura szumu 3D (budowana przy pierwszym użyciu; ~0,2 s CPU przy 64³). */
export function cloudNoiseTexture(size = 64) {
  if (shared) return shared;
  const t = new THREE.Data3DTexture(buildCloudNoise(size), size, size, size);
  t.name = 'planetGenNoise3D';
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.wrapR = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  shared = t;
  return t;
}
