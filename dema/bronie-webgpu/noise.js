// dema/bronie-webgpu/noise.js
//
// Kafelkowa tekstura szumu (RGBA8, 256²) liczona raz na CPU: cztery niezależne
// fbm szumu wartości, każda okresowa (siatka zawija się na brzegach), więc
// próbkowanie z `RepeatWrapping` nie ma szwów. Czytają ją shadery efektów
// (dym, ogień, opary, zniekształcenie, smugi) i compute (turbulencja dymu).
//   R — fbm 4 oktawy, podstawa 4 komórki (kłęby dymu, ogień)
//   G — fbm 4 oktawy, podstawa 4 komórki, inne ziarno (drugi składnik przepływu)
//   B — fbm 3 oktawy, podstawa 16 komórek (drobny detal, iskrzenie)
//   A — fbm 2 oktawy, podstawa 2 komórki (wolne zmiany, maski)

import * as THREE from 'three/webgpu';

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

function fbmChannel(size, basePeriod, octaves, seed) {
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

export function createNoiseTexture(size = 256) {
  const r = fbmChannel(size, 4, 4, 1234567);
  const g = fbmChannel(size, 4, 4, 7654321);
  const b = fbmChannel(size, 16, 3, 2468013);
  const a = fbmChannel(size, 2, 2, 1357911);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
