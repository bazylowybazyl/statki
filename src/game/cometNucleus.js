// src/game/cometNucleus.js
//
// JĄDRO KOMETY — kształt (czysta logika, bez three): pole odległości z płatów (elipsoidy złączone gładko — 67P
// to dwa płaty na szyi), chropowatość z szumu wartości, kratery i doły; powierzchnia jako „sfera z sześcianu”
// (6 ścian × N², indeksy, normalne z gradientu pola — bez szwów na krawędziach ścian), zaciemnienie zagłębień
// (AO z pola) i OBRYS z góry (największy promień rzutu na płaszczyznę gry w koszykach kąta) — tego samego
// obrysu używają kolizje (cometField.js), więc kadłub nigdy nie wjeżdża w widoczną bryłę.
//
// Promień wzdłuż kierunku: marsz od zewnątrz do pierwszego wejścia w bryłę (najdalsza powierzchnia —
// przewężenia „zalewa”, ale z góry wygląda to tak samo, a siatka nie ma nawisów). Jednostki: promień jądra = 1;
// gra skaluje przez `def.nucleus.radius`. Orientacja `tilt` [rx, ry] wpieczona w wierzchołki.

function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Przygotowany kształt (kratery i jamy z ziarna) — wejście `nucleusSdf`. */
export function prepareNucleusShape(nucleus) {
  const rnd = mulberry32((nucleus.seed | 0) * 7919 + 13);
  const craters = [];
  const dirAt = () => {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), s * Math.sin(a), z];
  };
  // kratery uderzeniowe: misa z wałem (kind 0)
  for (let i = 0; i < (nucleus.craters | 0); i++) {
    const [x, y, z] = dirAt();
    const big = rnd();
    craters.push({ x, y, z, size: 0.1 + big * big * 0.3, depth: 0.04 + big * 0.06, kind: 0 });
  }
  // jamy aktywne (67P): strome ściany, płaskie dno, bez wału — źródła dżetów (kind 1)
  for (let i = 0; i < (nucleus.pits | 0); i++) {
    const [x, y, z] = dirAt();
    const big = rnd();
    craters.push({ x, y, z, size: 0.05 + big * 0.07, depth: 0.06 + big * 0.06, kind: 1 });
  }
  const lobes = nucleus.lobes.map((l) => ({ c: l.c.slice(), r: l.r.slice() }));
  let ext = 0;
  for (const l of lobes) ext = Math.max(ext, Math.hypot(l.c[0], l.c[1], l.c[2]) + Math.max(l.r[0], l.r[1], l.r[2]));
  const warp = Number(nucleus.warp) || 0;
  const terraceAmp = Number(nucleus.terraceAmp) || 0;
  const ridge = Number(nucleus.ridge) || 0;
  const rough = Number(nucleus.rough) || 0;
  return {
    lobes, craters,
    blend: Number(nucleus.blend) || 0.3,
    rough, warp, ridge,
    terraces: Math.max(1, Number(nucleus.terraces) || 5),
    terraceAmp,
    seed: nucleus.seed | 0,
    extent: ext + warp + terraceAmp + ridge + rough + 0.18
  };
}

function ellipsoidSd(px, py, pz, l) {
  const x = px - l.c[0], y = py - l.c[1], z = pz - l.c[2];
  const k0 = Math.hypot(x / l.r[0], y / l.r[1], z / l.r[2]);
  const k1 = Math.hypot(x / (l.r[0] * l.r[0]), y / (l.r[1] * l.r[1]), z / (l.r[2] * l.r[2]));
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(l.r[0], l.r[1], l.r[2]);
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Pole odległości jądra (promień = 1) w punkcie. */
export function nucleusSdf(shape, x0, y0, z0) {
  const s = shape.seed;
  // Wypaczenie domeny: nieregularna sylwetka (bez gładkich łuków elipsoid).
  let x = x0, y = y0, z = z0;
  if (shape.warp > 0) {
    const w2 = shape.warp * 2;
    x += (valueNoise3(x0 * 1.3 + 11.3, y0 * 1.3, z0 * 1.3, s + 101) - 0.5) * w2;
    y += (valueNoise3(x0 * 1.3, y0 * 1.3 + 7.1, z0 * 1.3, s + 102) - 0.5) * w2;
    z += (valueNoise3(x0 * 1.3, y0 * 1.3, z0 * 1.3 + 3.7, s + 103) - 0.5) * w2;
  }
  let d = ellipsoidSd(x, y, z, shape.lobes[0]);
  for (let i = 1; i < shape.lobes.length; i++) d = smin(d, ellipsoidSd(x, y, z, shape.lobes[i]), shape.blend);
  const len = Math.hypot(x0, y0, z0) || 1;
  const nx = x0 / len, ny = y0 / len, nz = z0 / len;
  let disp = 0;
  // Kratery (misa z wałem) i jamy aktywne (strome ściany, płaskie dno).
  for (let i = 0; i < shape.craters.length; i++) {
    const c = shape.craters[i];
    const cosA = nx * c.x + ny * c.y + nz * c.z;
    if (cosA < 0.8) continue;
    const a = Math.acos(Math.min(1, cosA)) / c.size;
    if (c.kind === 1) {
      if (a < 1.25) disp -= c.depth * (1 - smoothstepCpu(0.72, 1.18, a));
    } else if (a < 1) disp -= c.depth * (1 - a * a);
    else if (a < 1.6) disp += c.depth * 0.35 * Math.sin((a - 1) / 0.6 * Math.PI);
  }
  // Tarasy warstw (67P): poziomice szumu 3D skwantowane — płaskie półki i urwiska między nimi.
  if (shape.terraceAmp > 0) {
    const n = valueNoise3(x0 * 1.6, y0 * 1.6, z0 * 1.6, s + 7) * 0.7 + valueNoise3(x0 * 3.4, y0 * 3.4, z0 * 3.4, s + 8) * 0.3;
    const q = n * shape.terraces;
    const f = Math.floor(q);
    const t = (f + smoothstepCpu(0.78, 1.0, q - f)) / shape.terraces;
    disp += shape.terraceAmp * (t - 0.5) * 2;
  }
  // Grzbiety i urwiska (szum grzbietowy).
  if (shape.ridge > 0) {
    const r = 1 - Math.abs(2 * valueNoise3(x0 * 4.6, y0 * 4.6, z0 * 4.6, s + 9) - 1);
    disp += shape.ridge * (r * r - 0.35);
  }
  // Chropowatość: dwie oktawy szumu wartości (rumosz, głazy).
  if (shape.rough > 0) {
    const n = (valueNoise3(x0 * 7.3, y0 * 7.3, z0 * 7.3, s + 31) - 0.5) + (valueNoise3(x0 * 15.1, y0 * 15.1, z0 * 15.1, s + 62) - 0.5) * 0.5;
    disp += shape.rough * n * 1.33;
  }
  return d - disp;
}

function smoothstepCpu(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function rotateTilt(v, tx, ty) {
  // obrót wokół X o tx, potem wokół Y o ty
  const cx = Math.cos(tx), sx = Math.sin(tx), cy = Math.cos(ty), sy = Math.sin(ty);
  const y1 = v[1] * cx - v[2] * sx;
  const z1 = v[1] * sx + v[2] * cx;
  const x2 = v[0] * cy + z1 * sy;
  const z2 = -v[0] * sy + z1 * cy;
  v[0] = x2; v[1] = y1; v[2] = z2;
  return v;
}

/** Promień powierzchni wzdłuż kierunku jednostkowego (marsz od zewnątrz — krok z pola, ≤ 0,03 — i bisekcja). */
export function nucleusRadiusAlong(shape, dx, dy, dz) {
  let tHi = shape.extent;
  let t = tHi;
  while (t > 0.02) {
    const d = nucleusSdf(shape, dx * t, dy * t, dz * t);
    if (d < 0) break;
    tHi = t;
    t -= Math.min(0.03, Math.max(0.006, d * 0.6));
  }
  let lo = Math.max(0, t), hi = tHi;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) * 0.5;
    if (nucleusSdf(shape, dx * m, dy * m, dz * m) < 0) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

/**
 * Powierzchnia jądra: pozycje (promień = 1, po obrocie `tilt`), normalne, AO, indeksy, obrys z góry.
 * @param {object} nucleus wpis `def.nucleus`
 * @param {number} [N] podział ściany sześcianu
 * @param {number} [bins] koszyki kąta obrysu
 */
export function buildNucleusSurface(nucleus, N = 40, bins = 256) {
  const shape = prepareNucleusShape(nucleus);
  const tilt = nucleus.tilt || [0, 0];
  const verts = 6 * (N + 1) * (N + 1);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const ao = new Float32Array(verts);
  const idx = verts > 65535 ? new Uint32Array(6 * N * N * 6) : new Uint16Array(6 * N * N * 6);
  const outline = new Float32Array(bins);
  const FACES = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
  ];
  const v = [0, 0, 0];
  const e = 0.012;
  let vi = 0, ii = 0;
  for (let f = 0; f < 6; f++) {
    const [n, u, w] = FACES[f];
    const base = vi;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        // równomierniejsza siatka: tangens na ścianie sześcianu
        const a = Math.tan((i / N * 2 - 1) * Math.PI / 4);
        const b = Math.tan((j / N * 2 - 1) * Math.PI / 4);
        let dx = n[0] + u[0] * a + w[0] * b;
        let dy = n[1] + u[1] * a + w[1] * b;
        let dz = n[2] + u[2] * a + w[2] * b;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const r = nucleusRadiusAlong(shape, dx, dy, dz);
        const px = dx * r, py = dy * r, pz = dz * r;
        let gx = nucleusSdf(shape, px + e, py, pz) - nucleusSdf(shape, px - e, py, pz);
        let gy = nucleusSdf(shape, px, py + e, pz) - nucleusSdf(shape, px, py - e, pz);
        let gz = nucleusSdf(shape, px, py, pz + e) - nucleusSdf(shape, px, py, pz - e);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl; gy /= gl; gz /= gl;
        // AO: pole odległości w dwóch krokach wzdłuż normalnej (zagłębienia, szyja płatów)
        const o1 = nucleusSdf(shape, px + gx * 0.08, py + gy * 0.08, pz + gz * 0.08) / 0.08;
        const o2 = nucleusSdf(shape, px + gx * 0.22, py + gy * 0.22, pz + gz * 0.22) / 0.22;
        ao[vi] = Math.max(0.25, Math.min(1, 0.45 * o1 + 0.55 * o2));
        v[0] = px; v[1] = py; v[2] = pz;
        rotateTilt(v, tilt[0], tilt[1]);
        pos[vi * 3] = v[0]; pos[vi * 3 + 1] = v[1]; pos[vi * 3 + 2] = v[2];
        const rr = Math.hypot(v[0], v[1]);
        const bin = Math.floor(((Math.atan2(v[1], v[0]) / (Math.PI * 2)) + 1) % 1 * bins) % bins;
        if (rr > outline[bin]) outline[bin] = rr;
        v[0] = gx; v[1] = gy; v[2] = gz;
        rotateTilt(v, tilt[0], tilt[1]);
        nor[vi * 3] = v[0]; nor[vi * 3 + 1] = v[1]; nor[vi * 3 + 2] = v[2];
        vi++;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        const b = a + 1, c = a + N + 1, d = c + 1;
        // (u, w) ściany jest prawoskrętne względem normalnej zewnętrznej → (a, b, c) przeciwnie do wskazówek
        // zegara patrząc z zewnątrz (przód trójkąta)
        idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
        idx[ii++] = b; idx[ii++] = d; idx[ii++] = c;
      }
    }
  }
  // Obrys: koszyki bez wierzchołka i drobne wcięcia między wierzchołkami — maks. z sąsiadów (±2).
  const raw = outline.slice();
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let k = -2; k <= 2; k++) m = Math.max(m, raw[(b + k + bins) % bins]);
    outline[b] = m * 1.01;
  }
  let zMin = 0, zMax = 0;
  for (let k = 2; k < pos.length; k += 3) { zMin = Math.min(zMin, pos[k]); zMax = Math.max(zMax, pos[k]); }
  return { positions: pos, normals: nor, ao, indices: idx, outline, bins, zMin, zMax, vertexCount: verts };
}

function rotateTiltInv(v, tx, ty) {
  // odwrotność rotateTilt: wokół Y o −ty, potem wokół X o −tx
  const cx = Math.cos(tx), sx = Math.sin(tx), cy = Math.cos(ty), sy = Math.sin(ty);
  const x1 = v[0] * cy - v[2] * sy;
  const z1 = v[0] * sy + v[2] * cy;
  const y2 = v[1] * cx + z1 * sx;
  const z2 = -v[1] * sx + z1 * cx;
  v[0] = x1; v[1] = y2; v[2] = z2;
  return v;
}

/** Zakres pola odległości w siatce R8 (± promienia jądra = 1): 0 → −range, 255 → +range. */
export const NUCLEUS_SDF_RANGE = 0.35;

/**
 * Siatka pola odległości jądra w układzie BRYŁY (po obrocie `tilt` — tak jak wierzchołki) do cienia własnego
 * w shaderze: n³ wokseli R8 w sześcianie [−E, E]³ (E = zasięg kształtu), środki wokseli w (i + 0,5) / n —
 * jak próbkowanie liniowe tekstury 3D. Wartość = clamp(sdf / range · 0,5 + 0,5) · 255.
 */
export function bakeNucleusSdfGrid(nucleus, n = 48, shapeIn = null) {
  const shape = shapeIn || prepareNucleusShape(nucleus);
  const tilt = nucleus.tilt || [0, 0];
  const E = shape.extent;
  const range = NUCLEUS_SDF_RANGE;
  const data = new Uint8Array(n * n * n);
  const v = [0, 0, 0];
  let k = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        v[0] = -E + (x + 0.5) / n * 2 * E;
        v[1] = -E + (y + 0.5) / n * 2 * E;
        v[2] = -E + (z + 0.5) / n * 2 * E;
        rotateTiltInv(v, tilt[0], tilt[1]);
        const d = nucleusSdf(shape, v[0], v[1], v[2]);
        data[k++] = Math.round(Math.max(0, Math.min(1, d / range * 0.5 + 0.5)) * 255);
      }
    }
  }
  return { data, n, extent: E, range };
}

/** Odczyt siatki R8 (najbliższy woksel) — lustro CPU próbkowania w shaderze (testy). */
export function sampleNucleusSdfGrid(grid, x, y, z) {
  const { n, extent: E, range, data } = grid;
  const ix = Math.floor((x / E * 0.5 + 0.5) * n);
  const iy = Math.floor((y / E * 0.5 + 0.5) * n);
  const iz = Math.floor((z / E * 0.5 + 0.5) * n);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= n || iy >= n || iz >= n) return range;
  return (data[(iz * n + iy) * n + ix] / 255 - 0.5) * 2 * range;
}

/** Wszystko dla jednego jądra (worker i wątek główny bez workerów): powierzchnia + siatka pola. */
export function buildNucleusAssets(nucleus, { N = 44, bins = 256, gridN = 48 } = {}) {
  const surface = buildNucleusSurface(nucleus, N, bins);
  const grid = bakeNucleusSdfGrid(nucleus, gridN);
  return { surface, grid };
}

/** Promień obrysu z góry pod kątem `a` układu bryły (interpolacja koszyków). */
export function outlineRadiusAt(outline, a) {
  const bins = outline.length;
  let t = ((a / (Math.PI * 2)) % 1 + 1) % 1 * bins;
  const i0 = Math.floor(t) % bins;
  const i1 = (i0 + 1) % bins;
  t -= Math.floor(t);
  return outline[i0] + (outline[i1] - outline[i0]) * t;
}
