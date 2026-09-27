// Ringi-archetypy (Mars = ECUMENE, Jowisz = Fable; Z6 2026-09-27) — rama
// ringu i zapis instancji. Czysta matematyka, bez Three (testy node).
//
// Układ lokalny ringu jak w silniku Halo: oś ringu = Z, planeta w (0, 0, 0),
// habitat na zewnątrz (σ = +1). Punkt ringu = (θ, z, h): kąt w płaszczyźnie
// XY, z w poprzek wstęgi, h — wysokość nad podłogą PROMIENIOWO NA ZEWNĄTRZ
// (w demach h rosło ku osi; tu habitat patrzy w kosmos jak ring Ziemi).
//
// Rama bryły: X = styczna (ku rosnącemu θ), Y = góra (od planety),
// Z = X × Y = −oś (prawoskrętna; w demach Z = +oś przy górze ku osi). Bryły
// symetryczne w Z (skrzynki, walce) wyglądają jak w demach.

export const ARCH_TAU = Math.PI * 2;

export const wrapAngle = (a) => ((a % ARCH_TAU) + ARCH_TAU) % ARCH_TAU;

// Punkt ringu → układ lokalny.
export function archPoint(R, theta, z, h, out = {}) {
  const r = R + h;
  out.x = r * Math.cos(theta);
  out.y = r * Math.sin(theta);
  out.z = z;
  return out;
}

// Macierz 4×4 (kolumnowo, jak THREE.Matrix4.elements) bryły w ramie ringu:
// środek podstawy w (θ, z, h), skala (sx wzdłuż, sy w górę, sz w poprzek),
// obrót yaw wokół góry. Zapis do `out` od `o` (bufor instancji).
export function archMatrix(R, theta, z, h, sx, sy, sz, yaw, out, o = 0) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // styczna, góra, −oś
  let xx = -s;
  let xy = c;
  let xz = 0;
  const ux = c;
  const uy = s;
  let zx = 0;
  let zy = 0;
  let zz = -1;
  if (yaw) {
    const cy = Math.cos(yaw);
    const sy_ = Math.sin(yaw);
    const nxx = xx * cy - zx * sy_;
    const nxy = xy * cy - zy * sy_;
    const nxz = xz * cy - zz * sy_;
    const nzx = xx * sy_ + zx * cy;
    const nzy = xy * sy_ + zy * cy;
    const nzz = xz * sy_ + zz * cy;
    xx = nxx; xy = nxy; xz = nxz;
    zx = nzx; zy = nzy; zz = nzz;
  }
  const r = R + h;
  out[o] = xx * sx; out[o + 1] = xy * sx; out[o + 2] = xz * sx; out[o + 3] = 0;
  out[o + 4] = ux * sy; out[o + 5] = uy * sy; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = zx * sz; out[o + 9] = zy * sz; out[o + 10] = zz * sz; out[o + 11] = 0;
  out[o + 12] = r * c; out[o + 13] = r * s; out[o + 14] = z; out[o + 15] = 1;
  return out;
}

// Belka od p0 do p1 (punkty lokalne {x, y, z}) o przekroju w × w: oś Y bryły
// wzdłuż belki, podstawa w p0 (bryła z podstawą na y = 0, jak w demach).
export function archBeamMatrix(p0, p1, w, out, o = 0) {
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  let dz = p1.z - p0.z;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  dx /= len; dy /= len; dz /= len;
  // dowolna prostopadła (stabilnie): jeśli belka prawie wzdłuż Z, bierz X
  let ax = 0;
  let ay = 0;
  let az = 1;
  if (Math.abs(dz) > 0.9) { ax = 1; az = 0; }
  // X = a × d, Z = X × d … (prawoskrętnie: X × Y = Z, Y = d)
  let xx = ay * dz - az * dy;
  let xy = az * dx - ax * dz;
  let xz = ax * dy - ay * dx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const zx = xy * dz - xz * dy;
  const zy = xz * dx - xx * dz;
  const zz = xx * dy - xy * dx;
  out[o] = xx * w; out[o + 1] = xy * w; out[o + 2] = xz * w; out[o + 3] = 0;
  out[o + 4] = dx * len; out[o + 5] = dy * len; out[o + 6] = dz * len; out[o + 7] = 0;
  out[o + 8] = zx * w; out[o + 9] = zy * w; out[o + 10] = zz * w; out[o + 11] = 0;
  out[o + 12] = p0.x; out[o + 13] = p0.y; out[o + 14] = p0.z; out[o + 15] = 1;
  return out;
}

// Bryła w ramie punktu (θ0, rF) przesunięta o x wzdłuż stycznej tej ramy
// i y promieniowo (proste bryły doków — jak push() planu dachu Halo): środek
// podstawy (x, y, z0), wymiary (sx wzdłuż, sy promieniowo, sz = z1 − z0 w osi).
// Tu oś Y bryły = oś ringu (Z), żeby wysokość bryły szła w z świata.
export function archDockBox(theta, rF, x, yc, z0, sx, sy, sz, out, o = 0) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // X = styczna, Y = +oś, Z = X × Y = (c, s, 0)·… → promień na zewnątrz
  out[o] = -s * sx; out[o + 1] = c * sx; out[o + 2] = 0; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = 0; out[o + 6] = sz; out[o + 7] = 0;
  out[o + 8] = c * sy; out[o + 9] = s * sy; out[o + 10] = 0; out[o + 11] = 0;
  const r = rF + yc;
  out[o + 12] = r * c - s * x; out[o + 13] = r * s + c * x; out[o + 14] = z0; out[o + 15] = 1;
  return out;
}

// Zbieracz instancji jednego rodzaju geometrii: macierz 16 + barwa (liniowa)
// + atrybut aInst (rodzaj materiału, ziarno, parametry). Bez Three — Three
// buduje z tego InstancedMesh (archMaterials.js).
export class ArchBatch {
  constructor(name = '') {
    this.name = name;
    this.m = [];
    this.c = [];
    this.a = [];
    this.count = 0;
  }
  push16(src, color, kind = 0, seed = 0, p1 = 0, p2 = 0) {
    for (let i = 0; i < 16; i++) this.m.push(src[i]);
    this.c.push(color[0], color[1], color[2]);
    this.a.push(kind, seed, p1, p2);
    this.count++;
    return this;
  }
  // dopisanie innej partii (ta sama bryła i materiał → jedno wywołanie)
  append(other) {
    if (!other?.count) return this;
    for (const v of other.m) this.m.push(v);
    for (const v of other.c) this.c.push(v);
    for (const v of other.a) this.a.push(v);
    this.count += other.count;
    return this;
  }
}

// Rura / belka wzdłuż ringu jako odcinki-skrzynki (cięciwy) — w partii
// konstrukcji zamiast osobnej siatki torusa (jedno wywołanie mniej na stronę).
// h — wysokość osi rury nad podłogą, z — położenie w poprzek, r — pół przekroju.
export function archRingTubeBoxes(batch, R, h, z, r, segs, color, kind = 0, p1 = 0.3) {
  const m = new Array(16);
  const dA = (Math.PI * 2) / segs;
  const chord = 2 * (R + h) * Math.sin(dA * 0.5) * 1.02;
  for (let i = 0; i < segs; i++) {
    archMatrix(R, (i + 0.5) * dA, z, h - r, chord, 2 * r, 2 * r, 0, m);
    batch.push16(m, color, kind, 0, p1, 0);
  }
  return batch;
}

// sRGB hex → liniowe [r, g, b] (barwy dem są w sRGB)
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export function archHex(hex) {
  return [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
}
// HSL → RGB bez dekodowania gamma (THREE.Color.setHSL w przestrzeni roboczej,
// czyli liniowej — tak liczą barwy dema Fable).
export function archHslLinear(h, s, l) {
  return archHslRaw(h, s, l);
}
function archHslRaw(h, s, l) {
  const hue2 = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  const hh = ((h % 1) + 1) % 1;
  if (s === 0) return [l, l, l];
  const q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2(p, q, hh + 1 / 3), hue2(p, q, hh), hue2(p, q, hh - 1 / 3)];
}
export function archHsl(h, s, l) {
  // HSL w sRGB → liniowe
  const hue2 = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  const hh = ((h % 1) + 1) % 1;
  let r;
  let g;
  let b;
  if (s === 0) { r = g = b = l; } else {
    const q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2(p, q, hh + 1 / 3);
    g = hue2(p, q, hh);
    b = hue2(p, q, hh - 1 / 3);
  }
  return [lin(r), lin(g), lin(b)];
}

// Generator ziarnisty jak w demach (mulberry32).
export function archRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const modp = (a, n) => ((a % n) + n) % n;
