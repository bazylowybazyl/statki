// Malarz sprite'ów ciągników kosmicznych (bez zależności): każda część to warstwy pól odległości (SDF) w j. świata →
// mapa wysokości, albedo, maski malowania → PNG. Liczby (obrysy, przeguby, gniazda) z src/data/spaceTrucks.js.
//
//   node scripts/ciagniki-sprite.mjs [--podglad .tmp/ciagniki/podglad.png]
//
// Zapisuje do assets/ships/trucks/:
//   trucks_atlas.png    RGB = albedo × alfa (mnożone PRZEZ alfę w liniowym; mipmapy bez obwódek), A = pokrycie; sRGB
//   trucks_atlas_n.png  RG = normalna xy (+x dziób, +y dół obrazka), B = połysk; dane liniowe, A = 255
//   trucks_atlas_m.png  R = maska farby (paint), G = maska akcentu (accent), B = emisja okien; dane liniowe, A = 255
//   <część>.png         pojedyncze płótna z prostą alfą i wypalonym malowaniem domyślnym (kadłuby ruchu, galeria)
// Z rysunku kreatora kadłubów zrezygnowaliśmy po próbie: docs/PROPOZYCJA-ciagniki.md § 2.
import { deflateSync, crc32 as zcrc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRUCK_ATLAS, TRUCK_ATLAS_CELLS, TRUCK_LIVERIES, TRUCK_SPRITE_BOUNDS, TRUCK_TRACTORS, TRUCK_TRAILER, TRUCK_HAZMAT_PAINT,
  TRUCK_HOPPER_LOADS, truckHexLinear
} from '../src/data/spaceTrucks.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repo, 'assets/ships/trucks');
const P = TRUCK_ATLAS.pxPerUnit;
const SS = 2;

// ---------------------------------------------------------------------------
// Pomocniki: PNG, barwy, szum

function crc32(buf) {
  if (zcrc32) return zcrc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = 4; // Paeth
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? rgba[i - 4] : 0;
      const b = y > 0 ? rgba[i - stride] : 0;
      const c = x >= 4 && y > 0 ? rgba[i - stride - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      raw[row + 1 + x] = (rgba[i] - pr) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const lin = (hex) => truckHexLinear(hex, [0, 0, 0]);
const srgb = (v) => {
  const c = v <= 0 ? 0 : (v >= 1 ? 1 : v);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x, y, s = 0) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.15;
/** Komórki (kamienie hałdy): d — odległość do najbliższego punktu, id — hash komórki. */
function cells(x, y, s = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const hx = hash2(ix + i, iy + j, s);
      const hy = hash2(ix + i, iy + j, s + 7);
      const dx = ix + i + hx - x;
      const dy = iy + j + hy - y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; id = hx; }
    }
  }
  return { d: Math.sqrt(best), id };
}

// ---------------------------------------------------------------------------
// Pola odległości (x, y w j. świata, ujemne = wnętrze)

const sdBox = (cx, cy, hx, hy, r = 0) => (x, y) => {
  const dx = Math.abs(x - cx) - hx + r;
  const dy = Math.abs(y - cy) - hy + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
};
const sdCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const sdCapsule = (x0, y0, x1, y1, r0, r1 = r0) => {
  const bx = x1 - x0;
  const by = y1 - y0;
  const bb = bx * bx + by * by || 1;
  return (x, y) => {
    const ax = x - x0;
    const ay = y - y0;
    const t = clamp01((ax * bx + ay * by) / bb);
    return Math.hypot(ax - bx * t, ay - by * t) - (r0 + (r1 - r0) * t);
  };
};
/** Wielokąt (kolejność dowolna), `round` — zaokrąglenie narożników. */
const sdPoly = (pts, round = 0) => (x, y) => {
  let d = Infinity;
  let sign = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = x - ax;
    const wy = y - ay;
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1));
    const qx = wx - ex * t;
    const qy = wy - ey * t;
    d = Math.min(d, qx * qx + qy * qy);
    const c1 = y >= ay;
    const c2 = y < by;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d) - round;
};
const sdInter = (a, b) => (x, y) => Math.max(a(x, y), b(x, y));
const sdMinus = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const sdUnion = (a, b) => (x, y) => Math.min(a(x, y), b(x, y));

// ---------------------------------------------------------------------------
// Płótno warstw

const C = {
  void: lin('#0e1013'), g1: lin('#191b1f'), g2: lin('#2b2f35'), g3: lin('#444a51'), g4: lin('#6a7078'), g5: lin('#9aa0a6'),
  chrome: lin('#a3aab1'), paint: lin('#d6d6d6'), rubber: lin('#111214'), glass: lin('#10283a'), lampW: lin('#c3c9ce'),
  lampA: lin('#8a5c1e'), lampR: lin('#6e1a10'), black: lin('#0d0e10'), rust: lin('#6e5038')
};

class Sheet {
  constructor(bounds, pad = 0) {
    this.x0 = bounds[0];
    this.y0 = bounds[2];
    this.w = Math.ceil((bounds[1] - bounds[0]) * P) * SS;
    this.h = Math.ceil((bounds[3] - bounds[2]) * P) * SS;
    this.s = P * SS;
    const n = this.w * this.h;
    this.H = new Float32Array(n);
    this.A = new Float32Array(n);
    this.R = new Float32Array(n);
    this.G = new Float32Array(n);
    this.B = new Float32Array(n);
    this.P1 = new Float32Array(n);
    this.P2 = new Float32Array(n);
    this.EM = new Float32Array(n);
    this.GL = new Float32Array(n);
    this.pad = pad;
  }
  /** Rysuje warstwę: sd — pole, o: { z — wysokość wierzchu (bezwzględna) albo rel — nad tym, co pod spodem; bevel — fazka;
   *  color, paint, accent (0–1), gloss, em; tex(x, y) → dodatek do wysokości, shade(x, y) → mnożnik albedo; pick(x, y) → nadpisz styl }. */
  draw(sd, o = {}) {
    const { w, h, s, x0, y0 } = this;
    const bevel = o.bevel ?? 0.25;
    const color = o.color || C.g3;
    const paint = o.paint ?? 0;
    const accent = o.accent ?? 0;
    const gloss = o.gloss ?? 0.25;
    const em = o.em ?? 0;
    const hasZ = o.z !== undefined;
    const rel = o.rel ?? 0;
    const aa = 1 / s; // krawędź ~1 px próbki
    for (let py = 0; py < h; py++) {
      const y = y0 + (py + 0.5) / s;
      for (let px = 0; px < w; px++) {
        const x = x0 + (px + 0.5) / s;
        const d = sd(x, y);
        if (d > aa) continue;
        const c = clamp01(0.5 - d / (aa * 2));
        if (c <= 0) continue;
        const i = py * w + px;
        const t = clamp01(-d / Math.max(1e-3, bevel));
        const prof = Math.sqrt(1 - (1 - t) * (1 - t));
        const baseH = this.H[i];
        const top = hasZ ? o.z : baseH + rel;
        let H = baseH + (top - baseH) * prof;
        if (o.tex) H += o.tex(x, y) * prof;
        let r = color[0];
        let g = color[1];
        let b = color[2];
        if (o.shade) { const k = o.shade(x, y); r *= k; g *= k; b *= k; }
        this.H[i] = baseH + (H - baseH) * c;
        const a = this.A[i];
        // Pod spodem pustka (alfa < 1): barwa warstwy zastępuje, nie miesza się z czernią.
        const m = a > 0 ? c : 1;
        this.R[i] += (r - this.R[i]) * m;
        this.G[i] += (g - this.G[i]) * m;
        this.B[i] += (b - this.B[i]) * m;
        this.P1[i] += (paint - this.P1[i]) * m;
        this.P2[i] += (accent - this.P2[i]) * m;
        this.EM[i] += (em - this.EM[i]) * m;
        this.GL[i] += (gloss - this.GL[i]) * m;
        this.A[i] = a + (1 - a) * c;
      }
    }
    return this;
  }
  /** Rowek: obniża wysokość i przyciemnia. */
  groove(sd, o = {}) {
    const { w, h, s, x0, y0 } = this;
    const depth = o.depth ?? 0.18;
    const dark = o.dark ?? 0.5;
    const aa = 1 / s;
    for (let py = 0; py < h; py++) {
      const y = y0 + (py + 0.5) / s;
      for (let px = 0; px < w; px++) {
        const x = x0 + (px + 0.5) / s;
        const d = sd(x, y);
        if (d > aa) continue;
        const c = clamp01(0.5 - d / (aa * 2));
        const i = py * w + px;
        if (c <= 0 || this.A[i] <= 0) continue;
        this.H[i] -= depth * c;
        const k = 1 - (1 - dark) * c;
        this.R[i] *= k;
        this.G[i] *= k;
        this.B[i] *= k;
      }
    }
    return this;
  }
  /** Wynik w rozdzielczości P: premult liniowe albedo, alfa, normalna, połysk, maski. */
  bake() {
    const { w, h, s } = this;
    const n = w * h;
    // Otoczenie (wnęki) i krawędzie: rozmycie wysokości pudełkiem ~1,2 j.
    const blur = boxBlur(this.H, w, h, Math.round(1.2 * s));
    const blurTight = boxBlur(this.H, w, h, Math.round(0.35 * s));
    const wn = Math.floor(w / SS);
    const hn = Math.floor(h / SS);
    const out = {
      w: wn, h: hn,
      rgb: new Float32Array(wn * hn * 3), a: new Float32Array(wn * hn),
      nx: new Float32Array(wn * hn), ny: new Float32Array(wn * hn), gl: new Float32Array(wn * hn),
      p1: new Float32Array(wn * hn), p2: new Float32Array(wn * hn), em: new Float32Array(wn * hn)
    };
    for (let py = 0; py < h; py++) {
      const y = this.y0 + (py + 0.5) / s;
      for (let px = 0; px < w; px++) {
        const i = py * w + px;
        const a = this.A[i];
        if (a <= 0) continue;
        const x = this.x0 + (px + 0.5) / s;
        const ht = this.H[i];
        const l = px > 0 ? this.H[i - 1] : ht;
        const r = px < w - 1 ? this.H[i + 1] : ht;
        const u = py > 0 ? this.H[i - w] : ht;
        const d = py < h - 1 ? this.H[i + w] : ht;
        let nx = -(r - l) * s * 0.5;
        let ny = -(d - u) * s * 0.5;
        // Fazki rysują stromo: przy kamerze z góry normalna ściśnięta, żeby nie wypadała poza półkulę światła.
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= nl;
        ny *= nl;
        const cav = clamp01(1 - 0.34 * Math.max(0, blur[i] - ht));
        // Wypukłe krawędzie jaśniejsze (przetarcie farby), lekki brud smugami wzdłuż kadłuba.
        const edge = clamp01((ht - blurTight[i]) * 5);
        const dirt = 0.92 + 0.14 * fbm(x * 0.32, y * 0.9, 3);
        const k = cav * dirt * (1 + 0.5 * edge);
        const ox = px >> 1;
        const oy = py >> 1;
        const j = oy * wn + ox;
        const q = a / (SS * SS);
        out.rgb[j * 3] += this.R[i] * k * q;
        out.rgb[j * 3 + 1] += this.G[i] * k * q;
        out.rgb[j * 3 + 2] += this.B[i] * k * q;
        out.a[j] += q;
        out.nx[j] += nx * q;
        out.ny[j] += ny * q;
        out.gl[j] += this.GL[i] * q;
        out.p1[j] += this.P1[i] * q;
        out.p2[j] += this.P2[i] * q;
        out.em[j] += this.EM[i] * q;
      }
    }
    // Normalna, połysk i maski — bez mnożenia przez alfę (wypełnione do brzegu przez wagę pokrycia).
    for (let j = 0; j < wn * hn; j++) {
      const a = out.a[j];
      if (a <= 1e-4) continue;
      out.nx[j] /= a;
      out.ny[j] /= a;
      out.gl[j] /= a;
      out.p1[j] /= a;
      out.p2[j] /= a;
      out.em[j] /= a;
    }
    return out;
  }
}

function boxBlur(src, w, h, r) {
  const a = new Float32Array(src.length);
  const b = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) sum += src[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      a[row + x] = sum * norm;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += a[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      b[y * w + x] = sum * norm;
      sum += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
    }
  }
  return b;
}

/** Rysuje wg funkcji fabryki dla obu burt (y i −y). */
const both = (fn) => { fn(1); fn(-1); };

// ---------------------------------------------------------------------------
// Klocki wspólne ciągników

function gondola(S, x0, x1, y, r, o = {}) {
  // Gondola silnika: walec w kolorze kabiny z pasem, chromowany wylot, wlot z przodu.
  S.draw(sdCapsule(x0 + r, y, x1 - r, y, r), { z: o.z ?? 3.4, bevel: r, color: C.paint, paint: 1, gloss: 0.5 });
  S.draw(sdBox((x0 + x1) / 2, y, (x1 - x0) * 0.22, r * 0.98), { rel: 0.03, bevel: 0.05, color: C.g2, gloss: 0.3 });
  S.draw(sdBox(x1 - r * 0.9, y, r * 0.5, r * 0.9, 0.2), { rel: 0.05, bevel: 0.12, color: C.g1, gloss: 0.5 });
  // Wylot: kołnierz, stożek wnęki.
  S.draw(sdBox(x0 + 0.1, y, 0.55, r + 0.15, 0.2), { z: (o.z ?? 3.4) + 0.2, bevel: 0.25, color: C.chrome, gloss: 0.9 });
  S.draw(sdBox(x0 - 0.05, y, 0.25, r * 0.7, 0.1), { z: 1.2, bevel: 0.2, color: C.black, gloss: 0.2 });
}

function stack(S, x, y, r = 1.25) {
  // Pionowy komin: chromowany walec widziany z góry.
  S.draw(sdCircle(x, y, r + 0.3), { rel: 0.25, bevel: 0.2, color: C.g2 });
  S.draw(sdCircle(x, y, r), { z: 5.0, bevel: r, color: C.chrome, gloss: 1 });
  S.draw(sdCircle(x, y, r * 0.5), { z: 3.6, bevel: 0.2, color: C.black, gloss: 0.1 });
}

function mirror(S, x, y, sign) {
  S.draw(sdCapsule(x - 1.8, sign * (Math.abs(y) - 2), x, y, 0.22), { z: 3.2, bevel: 0.2, color: C.g3 });
  S.draw(sdBox(x, y, 0.55, 0.95, 0.2), { z: 3.6, bevel: 0.25, color: C.g1, gloss: 0.8 });
  S.draw(sdBox(x + 0.2, y, 0.25, 0.8, 0.1), { rel: 0.05, bevel: 0.05, color: C.chrome, gloss: 1 });
}

function fifthWheel(S, x) {
  // Siodło: tarcza z wycięciem w V ku rufie, zamek pod okiem dyszla.
  S.draw(sdCircle(x, 0, 4.3), { z: 1.5, bevel: 0.3, color: C.g2 });
  const plate = sdMinus(sdCircle(x, 0, 3.8), sdPoly([[x - 5, -2.2], [x - 5, 2.2], [x + 0.4, 0.5], [x + 0.4, -0.5]]));
  S.draw(plate, { z: 2.0, bevel: 0.3, color: C.g4, gloss: 0.7, shade: (px, py) => 0.86 + 0.28 * fbm(px * 1.4, py * 1.4, 5) });
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + 0.4;
    if (Math.cos(a) < -0.6) continue;
    S.draw(sdCircle(x + Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0.22), { rel: 0.06, bevel: 0.1, color: C.g2 });
  }
  S.draw(sdCircle(x, 0, 1.1), { z: 2.1, bevel: 0.25, color: C.g2, gloss: 0.8 });
}

function deck(S, t, x1, hw1) {
  const tl = t.tail;
  const poly = [];
  for (const [x, w] of tl) poly.push([x, -w]);
  poly.push([x1, -hw1], [x1, hw1]);
  for (let k = tl.length - 1; k >= 0; k--) poly.push([tl[k][0], tl[k][1]]);
  S.draw(sdPoly(poly, 0.2), { z: 1.0, bevel: 0.3, color: C.g2, gloss: 0.3 });
  // Ramy i poprzeczki.
  const x0 = tl[0][0];
  both((sg) => S.draw(sdBox((x0 + x1) / 2 + 0.2, sg * 4.2, (x1 - x0) / 2 - 0.6, 0.85, 0.15), { z: 1.45, bevel: 0.25, color: C.g3, gloss: 0.4 }));
  for (let x = x0 + 1.4; x < x1 - 0.5; x += 3.4) S.groove(sdBox(x, 0, 0.1, 7.5), { depth: 0.1, dark: 0.55 });
}

function roofLights(S, x, list) {
  for (const y of list) S.draw(sdBox(x, y, 0.42, 0.62, 0.18), { rel: 0.12, bevel: 0.12, color: C.lampA, gloss: 0.9, em: 0.2 });
}

function beaconBase(S, x, y = 0) {
  S.draw(sdCircle(x, y, 1.5), { rel: 0.15, bevel: 0.2, color: C.g1, gloss: 0.4 });
  S.draw(sdCircle(x, y, 1.0), { rel: 0.5, bevel: 0.8, color: C.lampA, gloss: 1, em: 0.15 });
}

function tailLamps(S, x, y) {
  S.draw(sdBox(x, y, 0.45, 1.1, 0.15), { rel: 0.15, bevel: 0.15, color: C.lampR, gloss: 0.9 });
}

function sideLamp(S, x, y, color) {
  S.draw(sdCircle(x, y, 0.55), { rel: 0.12, bevel: 0.2, color, gloss: 1 });
}

// ---------------------------------------------------------------------------
// Ciągniki

function tractorLight() {
  const t = TRUCK_TRACTORS.light;
  const S = new Sheet(t.bounds);
  deck(S, t, 2.5, 8.5);
  fifthWheel(S, t.hitchX);
  // Gondole krótkie, pylony do ramy.
  both((sg) => {
    S.draw(sdBox(1.2, sg * 8.4, 2.2, 1.6, 0.3), { z: 1.6, bevel: 0.3, color: C.g3 });
    gondola(S, t.nozzles[0][0], 6.5, sg * 10.2, 1.75, { z: 2.9 });
  });
  // Kabina: zaokrąglony van, kabina nad osią.
  const cab = sdPoly([[1, -8.5], [12.5, -8.5], [15.5, -6.4], [15.5, 6.4], [12.5, 8.5], [1, 8.5]], 0.4);
  S.draw(cab, { z: 3.7, bevel: 1.1, color: C.paint, paint: 1, gloss: 0.42 });
  // Zderzak i reflektory.
  S.draw(sdBox(15.3, 0, 0.55, 7.2, 0.3), { z: 2.6, bevel: 0.3, color: C.paint, accent: 1, paint: 0, gloss: 0.5 });
  both((sg) => S.draw(sdBox(15.25, sg * 5.6, 0.5, 1.2, 0.3), { z: 3.0, bevel: 0.25, color: C.lampW, gloss: 1, em: 0.7 }));
  // Szyba i szyby boczne.
  const glass = sdPoly([[10.4, -7.3], [12.4, -7.3], [14.1, -5.7], [14.1, 5.7], [12.4, 7.3], [10.4, 7.3]], 0.25);
  S.draw(glass, { z: 3.45, bevel: 0.2, color: C.glass, gloss: 1, em: 0.05 });
  S.draw(sdBox(12.3, 0, 1.9, 0.14), { rel: 0.02, bevel: 0.05, color: C.g1 });
  both((sg) => S.draw(sdBox(6.6, sg * 7.95, 2.9, 0.4, 0.1), { z: 3.45, bevel: 0.1, color: C.glass, gloss: 1, em: 0.1 }));
  // Dach: panel, wywietrznik, pas linii.
  S.draw(sdBox(5.8, 0, 3.9, 6.6, 0.8), { z: 4.15, bevel: 0.6, color: C.paint, paint: 1, gloss: 0.42 });
  both((sg) => S.draw(sdBox(5.8, sg * 5.2, 3.9, 0.75), { rel: 0.02, bevel: 0.04, color: C.paint, paint: 0, accent: 1, gloss: 0.5 }));
  S.draw(sdBox(7.8, 0, 1.0, 2.6, 0.3), { rel: 0.18, bevel: 0.15, color: C.g2, gloss: 0.3, tex: (x) => 0.04 * Math.sin(x * 26) });
  beaconBase(S, t.lights[4][0], 0);
  both((sg) => S.groove(sdBox(6.6, sg * 8.05, 3.6, 0.62, 0.15), { depth: 0.05, dark: 0.75 }));
  // Rufa kabiny, lusterka, lampy.
  S.draw(sdBox(1.2, 0, 0.4, 7.6), { rel: -0.3, bevel: 0.1, color: C.g2 });
  both((sg) => mirror(S, 11.8, sg * 10.6, sg));
  both((sg) => tailLamps(S, t.tail[0][0] + 0.3, sg * 4.2));
  both((sg) => sideLamp(S, 1.5, sg * 12.1, sg < 0 ? C.lampR : lin('#1c6a34')));
  return S;
}

function tractorStandard() {
  const t = TRUCK_TRACTORS.standard;
  const S = new Sheet(t.bounds);
  deck(S, t, 4.5, 9.2);
  fifthWheel(S, t.hitchX);
  // Zbiorniki siodłowe (walce paliwa) między kabiną a siodłem.
  both((sg) => S.draw(sdCapsule(-6.4, sg * 7.2, -1.2, sg * 7.2, 1.45), { z: 2.8, bevel: 1.45, color: C.g5, gloss: 0.9 }));
  both((sg) => {
    S.draw(sdBox(1.5, sg * 9.4, 3, 2, 0.3), { z: 1.6, bevel: 0.3, color: C.g3 });
    gondola(S, t.nozzles[0][0], 9.5, sg * 11.4, 2.25);
  });
  both((sg) => stack(S, 1.6, sg * 6.4, 1.15));
  // Kabina: sypialnia + przód.
  const cab = sdPoly([[3.6, -9.2], [17.2, -9.2], [20.5, -7], [20.5, 7], [17.2, 9.2], [3.6, 9.2]], 0.5);
  S.draw(cab, { z: 3.8, bevel: 1.1, color: C.paint, paint: 1, gloss: 0.42 });
  S.draw(sdBox(20.25, 0, 0.75, 7.9, 0.35), { z: 2.7, bevel: 0.3, color: C.chrome, gloss: 1 });
  both((sg) => S.draw(sdBox(20.2, sg * 6.4, 0.55, 1.35, 0.3), { z: 3.1, bevel: 0.25, color: C.lampW, gloss: 1, em: 0.8 }));
  S.draw(sdBox(19.8, 0, 0.25, 3.8), { rel: 0.1, bevel: 0.1, color: C.g1 });
  const glass = sdPoly([[15.4, -7.9], [17.4, -7.9], [19.3, -6.1], [19.3, 6.1], [17.4, 7.9], [15.4, 7.9]], 0.25);
  S.draw(glass, { z: 3.5, bevel: 0.2, color: C.glass, gloss: 1, em: 0.05 });
  S.draw(sdBox(17.3, 0, 2.1, 0.15), { rel: 0.03, bevel: 0.05, color: C.g1 });
  both((sg) => S.draw(sdBox(12, sg * 8.55, 2.4, 0.4, 0.1), { z: 3.5, bevel: 0.1, color: C.glass, gloss: 1, em: 0.1 }));
  // Dach sypialni z owiewką, daszek z lampkami, pas linii.
  S.draw(sdBox(9.4, 0, 5.2, 7.4, 1), { z: 4.7, bevel: 1.0, color: C.paint, paint: 1, gloss: 0.45 });
  both((sg) => S.draw(sdBox(9.4, sg * 6.0, 5.2, 0.85), { rel: 0.02, bevel: 0.04, color: C.paint, accent: 1, gloss: 0.5 }));
  S.draw(sdBox(14.7, 0, 0.8, 5.6, 0.3), { z: 4.5, bevel: 0.25, color: C.g2, gloss: 0.4 });
  roofLights(S, 14.7, [-4.2, -2.1, 0, 2.1, 4.2]);
  S.draw(sdBox(10.6, 0, 1.3, 3.0, 0.4), { rel: 0.16, bevel: 0.15, color: C.g2, gloss: 0.3, tex: (x) => 0.04 * Math.sin(x * 22) });
  beaconBase(S, t.lights[9][0], 0);
  S.groove(sdBox(5.5, 0, 0.09, 7.4), { depth: 0.12, dark: 0.55 });
  both((sg) => S.groove(sdBox(12, sg * 8.6, 3, 0.62, 0.15), { depth: 0.05, dark: 0.75 }));
  // Lusterka, lampy.
  both((sg) => mirror(S, 16.6, sg * 11.3, sg));
  both((sg) => tailLamps(S, t.tail[0][0] + 0.3, sg * 4.2));
  both((sg) => sideLamp(S, 0.5, sg * 14.3, sg < 0 ? C.lampR : lin('#1c6a34')));
  return S;
}

function tractorHeavy() {
  const t = TRUCK_TRACTORS.heavy;
  const S = new Sheet(t.bounds);
  deck(S, t, 2.5, 9.6);
  fifthWheel(S, t.hitchX);
  // Dwie gondole na burtę, wspólny pylon.
  both((sg) => {
    S.draw(sdBox(-1.2, sg * 10.6, 4.4, 3.6, 0.4), { z: 1.7, bevel: 0.3, color: C.g3 });
    gondola(S, t.nozzles[0][0], 5.5, sg * 13.8, 1.95);
    gondola(S, t.nozzles[1][0], 3.5, sg * 10.3, 1.55, { z: 2.9 });
  });
  both((sg) => stack(S, -3.2, sg * 7.0, 1.2));
  both((sg) => S.draw(sdCapsule(-8.8, sg * 7.2, -5.6, sg * 7.2, 1.2), { z: 2.6, bevel: 1.2, color: C.g5, gloss: 0.9 }));
  // Błotniki przy masce (półkula z lampą na czole).
  both((sg) => S.draw(sdCapsule(19, sg * 7.9, 28.6, sg * 7.5, 1.5, 1.3), { z: 2.6, bevel: 1.4, color: C.paint, paint: 1, gloss: 0.45 }));
  // Maska z reaktorem: wąska, wyżłobienia, wypust.
  const hood = sdPoly([[13, -7.2], [28, -6.0], [30, -5.2], [30, 5.2], [28, 6.0], [13, 7.2]], 0.3);
  S.draw(hood, { z: 3.2, bevel: 1.2, color: C.paint, paint: 1, gloss: 0.5 });
  // Kratka chłodnicy, zderzak-orurowanie.
  S.draw(sdBox(30.1, 0, 0.8, 4.4, 0.2), { z: 3.0, bevel: 0.25, color: C.chrome, gloss: 1, tex: (x, y) => 0.05 * Math.sin(y * 16) });
  S.draw(sdBox(31.0, 0, 0.42, 8.0, 0.3), { z: 2.4, bevel: 0.3, color: C.chrome, gloss: 1 });
  both((sg) => S.draw(sdBox(30.5, sg * 6.8, 0.55, 1.2, 0.3), { z: 2.9, bevel: 0.25, color: C.lampW, gloss: 1, em: 0.8 }));
  both((sg) => S.draw(sdBox(30.9, sg * 3, 0.35, 0.65, 0.2), { z: 3.1, bevel: 0.2, color: C.lampW, gloss: 1, em: 0.8 }));
  // Grzbiet maski: łopatki wentylacji i pas akcentu.
  S.draw(sdBox(21.5, 0, 7.8, 0.9, 0.2), { rel: 0.14, bevel: 0.2, color: C.paint, accent: 1, gloss: 0.6 });
  both((sg) => {
    for (let k = 0; k < 6; k++) {
      S.draw(sdBox(16.6 + k * 1.9, sg * 3.8, 0.45, 1.35, 0.1), { rel: -0.22, bevel: 0.12, color: C.g1, gloss: 0.3 });
    }
  });
  // Kabina za maską, sypialnia.
  const cab = sdPoly([[-1, -9.6], [14.2, -9.6], [16.2, -7.8], [16.2, 7.8], [14.2, 9.6], [-1, 9.6]], 0.5);
  S.draw(cab, { z: 4.1, bevel: 1.1, color: C.paint, paint: 1, gloss: 0.45 });
  const glass = sdPoly([[12.2, -8.1], [14, -8.1], [15.5, -6.8], [15.5, 6.8], [14, 8.1], [12.2, 8.1]], 0.25);
  S.draw(glass, { z: 3.75, bevel: 0.2, color: C.glass, gloss: 1, em: 0.05 });
  S.draw(sdBox(13.8, 0, 1.75, 0.15), { rel: 0.03, bevel: 0.05, color: C.g1 });
  both((sg) => S.draw(sdBox(9.4, sg * 8.95, 2.2, 0.4, 0.1), { z: 3.8, bevel: 0.1, color: C.glass, gloss: 1, em: 0.1 }));
  // Wysoka owiewka sypialni.
  S.draw(sdBox(5, 0, 6, 7.9, 1.4), { z: 5.4, bevel: 1.3, color: C.paint, paint: 1, gloss: 0.45 });
  both((sg) => S.draw(sdBox(5, sg * 6.4, 6, 0.95), { rel: 0.02, bevel: 0.04, color: C.paint, accent: 1, gloss: 0.5 }));
  S.draw(sdBox(11.1, 0, 0.8, 6.0, 0.3), { z: 5.1, bevel: 0.25, color: C.g2, gloss: 0.4 });
  roofLights(S, 11.1, [-4.6, -2.3, 0, 2.3, 4.6]);
  S.draw(sdBox(6.4, 0, 2, 3.4, 0.5), { rel: 0.18, bevel: 0.15, color: C.g2, gloss: 0.3, tex: (x) => 0.05 * Math.sin(x * 20) });
  beaconBase(S, t.lights[11][0], 0);
  S.groove(sdBox(-0.2, 0, 0.1, 8.4), { depth: 0.1, dark: 0.55 });
  both((sg) => mirror(S, 12.6, sg * 12.3, sg));
  both((sg) => tailLamps(S, t.tail[0][0] + 0.3, sg * 4.2));
  both((sg) => sideLamp(S, 1.5, sg * 15.9, sg < 0 ? C.lampR : lin('#1c6a34')));
  return S;
}

// ---------------------------------------------------------------------------
// Naczepa: rama z dyszlem

function trailerChassis() {
  const T = TRUCK_TRAILER;
  const S = new Sheet(T.bounds);
  const [bx0, bx1, hw] = T.body;
  // Zaczep tylny: wspornik i talerz (pod okiem dyszla następcy).
  S.draw(sdCapsule(bx0 + 1, 0, T.rearHitchX, 0, 1.1, 0.9), { z: 1.3, bevel: 0.5, color: C.g4, gloss: 0.5 });
  S.draw(sdCircle(T.rearHitchX, 0, 2.5), { z: 1.5, bevel: 0.35, color: C.g4, gloss: 0.7 });
  S.draw(sdCircle(T.rearHitchX, 0, 1.3), { z: 1.1, bevel: 0.2, color: C.g2 });
  // Dyszel: dwa zastrzały i oko.
  both((sg) => S.draw(sdCapsule(bx1 - 0.5, sg * 6.2, T.kingpinX - 0.8, sg * 0.5, 0.8, 0.6), { z: 1.6, bevel: 0.5, color: C.g3, gloss: 0.5 }));
  S.draw(sdCapsule(bx1 - 0.5, 0, T.kingpinX - 1, 0, 0.7), { z: 1.6, bevel: 0.45, color: C.g3, gloss: 0.5 });
  S.draw(sdCircle(T.kingpinX, 0, 2.2), { z: 2.3, bevel: 0.4, color: C.chrome, gloss: 1 });
  S.draw(sdCircle(T.kingpinX, 0, 1.15), { z: 1.6, bevel: 0.2, color: C.g1, gloss: 0.3 });
  S.draw(sdCircle(T.kingpinX, 0, 0.5), { z: 2.5, bevel: 0.2, color: C.chrome, gloss: 1 });
  // Podłużnice i poprzeczki (otwarta rama: pusta naczepa widać przez nią kosmos).
  const rail = (y, h, z, col) => S.draw(sdBox((bx0 + bx1) / 2, y, (bx1 - bx0) / 2, h, 0.1), { z, bevel: 0.25, color: col, gloss: 0.4 });
  for (let x = bx0 + 2.4; x < bx1 - 1; x += 4.45) {
    S.draw(sdBox(x, 0, 0.55, hw - 0.5, 0.1), { z: 0.9, bevel: 0.2, color: C.g2, gloss: 0.3 });
  }
  both((sg) => rail(sg * 3.4, 0.7, 1.15, C.g3));
  both((sg) => rail(sg * (hw - 0.65), 0.65, 1.7, C.paint));
  // Malowanie burt ramy linią (maska farby tylko na podłużnicy zewnętrznej).
  both((sg) => S.draw(sdBox((bx0 + bx1) / 2, sg * (hw - 0.65), (bx1 - bx0) / 2 - 0.1, 0.58, 0.1), { rel: 0.02, bevel: 0.08, color: C.paint, paint: 1, gloss: 0.5 }));
  // Czołownica, zderzak.
  S.draw(sdBox(bx1 - 0.6, 0, 0.7, hw, 0.15), { z: 1.9, bevel: 0.25, color: C.g3, gloss: 0.5 });
  S.draw(sdBox(bx0 + 0.45, 0, 0.55, hw, 0.15), { z: 1.9, bevel: 0.25, color: C.g2, gloss: 0.5 });
  // Pas ostrzegawczy na zderzaku.
  S.draw(sdBox(bx0 + 0.45, 0, 0.4, 3.9, 0.05), {
    rel: 0.03, bevel: 0.05, color: C.g5, gloss: 0.5,
    shade: (x, y) => (Math.sin((y + x) * 3.2) > 0 ? 0.95 : 0.1)
  });
  // Zamki kontenerowe (twist-locki) i wsporniki modułu.
  both((sg) => {
    for (const x of [-15.9, 0, 15.9]) S.draw(sdBox(x, sg * 7.9, 0.5, 0.5, 0.1), { z: 2.0, bevel: 0.15, color: C.chrome, gloss: 1 });
  });
  // Oprawy lamp.
  both((sg) => {
    S.draw(sdBox(bx1 - 0.6, sg * hw, 0.45, 0.45, 0.1), { z: 2.0, bevel: 0.15, color: C.lampA, gloss: 0.9 });
    S.draw(sdBox(0, sg * (hw + 0.15), 0.6, 0.35, 0.1), { z: 1.9, bevel: 0.12, color: C.lampA, gloss: 0.9 });
    S.draw(sdBox(bx0 + 0.4, sg * 8.1, 0.45, 0.8, 0.1), { z: 2.0, bevel: 0.15, color: C.lampR, gloss: 0.9 });
    S.draw(sdBox(bx0 + 0.4, sg * 5.6, 0.4, 0.5, 0.1), { z: 2.0, bevel: 0.15, color: C.lampA, gloss: 0.9 });
  });
  return S;
}

// ---------------------------------------------------------------------------
// Ładunek: moduł 2 × 2 kontenery

const MOD_HX = 16.125;
const MOD_HY = 8.125;

function containerBlock(S, cx, cy, o = {}) {
  // Dach kontenera 16 × 8: fałdy w poprzek, narożne odlewy, rama.
  const hx = 8 - 0.05;
  const hy = 4 - 0.05;
  const z = o.z ?? 3.2;
  S.draw(sdBox(cx, cy, hx, hy, 0.12), {
    z, bevel: 0.22, color: C.paint, paint: o.paint ?? 1, accent: 0, gloss: 0.35,
    tex: (x) => 0.055 * Math.sin((x - cx) * 5.4),
    shade: (x) => 0.94 + 0.06 * Math.sin((x - cx) * 5.4)
  });
  // Rama dachu (żebro wzdłużne przy krawędzi).
  S.groove(sdBox(cx, cy - hy + 0.55, hx - 0.6, 0.04), { depth: 0.06, dark: 0.72 });
  S.groove(sdBox(cx, cy + hy - 0.55, hx - 0.6, 0.04), { depth: 0.06, dark: 0.72 });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      S.draw(sdBox(cx + sx * (hx - 0.42), cy + sy * (hy - 0.38), 0.38, 0.34, 0.06), { rel: 0.03, bevel: 0.08, color: C.g2, paint: 0, gloss: 0.5 });
    }
  }
}

function moduleFrame(S) {
  // Podstawa: płyta nośna modułu i rama chwytu drona.
  S.draw(sdBox(0, 0, MOD_HX + 0.3, MOD_HY + 0.3, 0.2), { z: 2.4, bevel: 0.25, color: C.g2, gloss: 0.3 });
}

function moduleLugs(S) {
  // Uchwyty chwytu drona L na środku krawędzi i między kontenerami.
  for (const sy of [-1, 1]) S.draw(sdBox(0, sy * (MOD_HY - 0.18), 0.65, 0.34, 0.08), { rel: 0.08, bevel: 0.1, color: C.g5, paint: 0, gloss: 0.8 });
  for (const sx of [-1, 1]) S.draw(sdBox(sx * (MOD_HX - 0.18), 0, 0.34, 0.65, 0.08), { rel: 0.08, bevel: 0.1, color: C.g5, paint: 0, gloss: 0.8 });
}

function cargoStdA() {
  const S = new Sheet(TRUCK_SPRITE_BOUNDS.cargo_std_a);
  moduleFrame(S);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) containerBlock(S, sx * 8.03, sy * 4.03);
  // Malowanie linii: szeroki pas rufowy i wąski za nim + skośne pasy przy dziobie modułu.
  S.draw(sdBox(-10.6, 0, 2.3, MOD_HY - 0.1), { rel: 0.015, bevel: 0.03, color: C.paint, paint: 0, accent: 1, gloss: 0.4, tex: (x) => 0.055 * Math.sin((x + 8.03) * 5.4) });
  S.draw(sdBox(-6.9, 0, 0.5, MOD_HY - 0.1), { rel: 0.015, bevel: 0.03, color: C.paint, paint: 0, accent: 1, gloss: 0.4 });
  moduleLugs(S);
  return S;
}

function cargoStdB() {
  const S = new Sheet(TRUCK_SPRITE_BOUNDS.cargo_std_b);
  moduleFrame(S);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) containerBlock(S, sx * 8.03, sy * 4.03);
  // Malowanie: strzałka (szewrony) ku dziobowi na środku i wąskie pasy wzdłużne.
  for (const off of [0, 5.0]) {
    S.draw(sdPoly([[3.4 + off, -6.6], [8 + off, 0], [3.4 + off, 6.6], [1.2 + off, 6.6], [5.8 + off, 0], [1.2 + off, -6.6]], 0), {
      rel: 0.015, bevel: 0.03, color: C.paint, paint: 0, accent: 1, gloss: 0.4
    });
  }
  for (const sg of [-1, 1]) S.draw(sdBox(-8, sg * 5.9, 7, 0.45), { rel: 0.015, bevel: 0.03, color: C.paint, paint: 0, accent: 1, gloss: 0.4 });
  moduleLugs(S);
  return S;
}

function cargoHazmat() {
  const S = new Sheet(TRUCK_SPRITE_BOUNDS.cargo_hazmat);
  moduleFrame(S);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) containerBlock(S, sx * 8.03, sy * 4.03);
  // Pasy ostrzegawcze na końcach (czerń wypalona, reszta — farba instancji).
  for (const sx of [-1, 1]) {
    S.draw(sdBox(sx * (MOD_HX - 1.9), 0, 1.5, MOD_HY - 0.05), {
      rel: 0.02, bevel: 0.03, color: C.paint, paint: 1, gloss: 0.35,
      shade: (x, y) => (Math.sin((x - y) * 1.75) > 0 ? 0.055 : 1)
    });
  }
  // Romb ostrzegawczy (akcent) z czarną obwódką i znakiem.
  const diamond = (x, y, r) => sdPoly([[x + r, y], [x, y + r], [x - r, y], [x, y - r]], 0);
  for (const cx of [-5.6, 5.6]) {
    S.draw(diamond(cx, 0, 5.2), { rel: 0.04, bevel: 0.05, color: C.black, paint: 0, gloss: 0.4 });
    S.draw(diamond(cx, 0, 4.4), { rel: 0.02, bevel: 0.04, color: C.paint, paint: 0, accent: 1, gloss: 0.4 });
    S.draw(sdPoly([[cx + 2.0, 0.0], [cx - 1.3, -1.9], [cx - 1.3, 1.9]], 0.1), { rel: 0.02, bevel: 0.03, color: C.black, gloss: 0.3, accent: 0 });
  }
  moduleLugs(S);
  return S;
}

function cargoTank() {
  const S = new Sheet(TRUCK_SPRITE_BOUNDS.cargo_tank);
  // Rama ISO (otwarta): belki obwodowe, słupki w narożnikach.
  S.draw(sdBox(0, 0, MOD_HX + 0.3, MOD_HY + 0.3, 0.15), { z: 1.4, bevel: 0.2, color: C.g1, gloss: 0.2 });
  const frame = sdMinus(sdBox(0, 0, MOD_HX + 0.3, MOD_HY + 0.3, 0.15), sdBox(0, 0, MOD_HX - 0.7, MOD_HY - 0.7, 0.1));
  S.draw(frame, { z: 3.1, bevel: 0.25, color: C.g3, gloss: 0.4 });
  // Dwa walce płaszcza: profil walca (fazka = promień).
  for (const sy of [-1, 1]) {
    const cy = sy * 3.95;
    S.draw(sdCapsule(-13.4, cy, 13.4, cy, 3.45), {
      z: 5.6, bevel: 3.45, color: C.paint, paint: 1, gloss: 0.95,
      shade: (x, y) => 0.98 + 0.05 * fbm(x * 0.2, y * 0.2, 9)
    });
    // Opaski pierścieni i opaska linii.
    for (const x of [-9.5, 9.5]) S.groove(sdBox(x, cy, 0.22, 3.4), { depth: 0.08, dark: 0.45 });
    S.draw(sdInter(sdBox(0, cy, 3.1, 3.4), sdCapsule(-13.4, cy, 13.4, cy, 3.45)), { rel: 0.02, bevel: 0.05, color: C.paint, paint: 0, accent: 1, gloss: 0.8 });
    // Włazy.
    for (const x of [-5.6, 5.6]) {
      S.draw(sdCircle(x, cy, 1.05), { rel: 0.15, bevel: 0.2, color: C.g4, paint: 0, gloss: 0.8 });
      S.draw(sdCircle(x, cy, 0.5), { rel: 0.12, bevel: 0.2, color: C.chrome, paint: 0, gloss: 1 });
    }
  }
  // Kładka między walcami, zawory.
  S.draw(sdBox(0, 0, 14, 0.52), { z: 4.0, bevel: 0.12, color: C.g2, gloss: 0.3, tex: (x) => 0.03 * Math.sin(x * 12) });
  for (const x of [-12, 12]) S.draw(sdBox(x, 0, 0.7, 1.1, 0.25), { z: 4.3, bevel: 0.2, color: C.g5, gloss: 0.8 });
  // Narożne odlewy ramy.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) S.draw(sdBox(sx * (MOD_HX - 0.1), sy * (MOD_HY - 0.1), 0.65, 0.65, 0.08), { z: 3.3, bevel: 0.12, color: C.g2 });
  return S;
}

function cargoHopper() {
  const S = new Sheet(TRUCK_SPRITE_BOUNDS.cargo_hopper);
  S.draw(sdBox(0, 0, MOD_HX + 0.3, MOD_HY + 0.3, 0.2), { z: 2.0, bevel: 0.25, color: C.g2 });
  // Skrzynia: gruba burta (farba), wnętrze ze skośnymi ścianami.
  S.draw(sdBox(0, 0, MOD_HX + 0.1, MOD_HY + 0.1, 0.5), { z: 4.2, bevel: 0.4, color: C.paint, paint: 1, gloss: 0.3 });
  S.draw(sdBox(0, 0, MOD_HX - 1.0, MOD_HY - 1.0, 0.3), { z: 1.1, bevel: 1.2, color: C.g3, gloss: 0.2 });
  // Hałda: wypukła, z kamieniami (akcent = materiał ładunku).
  const heap = sdBox(0, 0, MOD_HX - 1.5, MOD_HY - 1.5, 2.2);
  S.draw(heap, {
    z: 2.2, bevel: 5.5, color: C.paint, paint: 0, accent: 1, gloss: 0.3,
    tex: (x, y) => {
      const c = cells(x * 0.85, y * 0.85, 21);
      return (0.5 - c.d) * 0.85 + (fbm(x * 0.5, y * 0.5, 2) - 0.5) * 1.6;
    },
    shade: (x, y) => {
      const c = cells(x * 0.85, y * 0.85, 21);
      return (0.5 + 0.7 * c.id) * smooth(0.62, 0.3, c.d) + 0.22;
    }
  });
  // Poprzeczki trzymające burty i nity.
  for (const x of [-7.8, 7.8]) S.draw(sdBox(x, 0, 0.42, MOD_HY + 0.1, 0.08), { z: 4.5, bevel: 0.15, color: C.paint, paint: 1, gloss: 0.35 });
  for (const sy of [-1, 1]) for (let x = -14.5; x <= 14.6; x += 2.9) S.draw(sdCircle(x, sy * (MOD_HY - 0.3), 0.14), { rel: 0.04, bevel: 0.1, color: C.g5 });
  // Pas akcentu nie na hałdzie — narożniki w barwie zaczepów.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) S.draw(sdBox(sx * (MOD_HX - 0.1), sy * (MOD_HY - 0.1), 0.6, 0.6, 0.1), { z: 4.4, bevel: 0.12, color: C.g2 });
  return S;
}

// ---------------------------------------------------------------------------
// Zapis

const PARTS = {
  tractor_light: tractorLight,
  tractor_standard: tractorStandard,
  tractor_heavy: tractorHeavy,
  trailer_chassis: trailerChassis,
  cargo_std_a: cargoStdA,
  cargo_std_b: cargoStdB,
  cargo_hazmat: cargoHazmat,
  cargo_tank: cargoTank,
  cargo_hopper: cargoHopper
};

const DEFAULT_LOOK = {
  tractor_light: TRUCK_LIVERIES[1], tractor_standard: TRUCK_LIVERIES[0], tractor_heavy: TRUCK_LIVERIES[2],
  trailer_chassis: TRUCK_LIVERIES[0], cargo_std_a: TRUCK_LIVERIES[0], cargo_std_b: TRUCK_LIVERIES[3],
  cargo_hazmat: TRUCK_HAZMAT_PAINT, cargo_tank: { paint: '#d9dde1', accent: TRUCK_LIVERIES[1].paint },
  cargo_hopper: { paint: TRUCK_LIVERIES[2].paint, accent: TRUCK_HOPPER_LOADS.ore }
};

const args = process.argv.slice(2);
const previewPath = args[0] === '--podglad' ? resolve(repo, args[1] || '.tmp/ciagniki/podglad.png') : null;

mkdirSync(OUT, { recursive: true });
const [AW, AH] = TRUCK_ATLAS.size;
const atlasA = Buffer.alloc(AW * AH * 4);
const atlasN = Buffer.alloc(AW * AH * 4);
const atlasM = Buffer.alloc(AW * AH * 4);
for (let i = 0; i < AW * AH; i++) {
  atlasN[i * 4] = atlasN[i * 4 + 1] = 128;
  atlasN[i * 4 + 3] = 255;
  atlasM[i * 4 + 3] = 255;
}
const baked = {};
for (const [name, make] of Object.entries(PARTS)) {
  const b = make().bake();
  baked[name] = b;
  const cell = TRUCK_ATLAS_CELLS[name];
  if (b.w !== cell.w || b.h !== cell.h) throw new Error(`${name}: ${b.w}×${b.h} kontra komórka ${cell.w}×${cell.h}`);
  // Komórka + wypełnienie marginesu kolumnami brzegu (mipmapy): normalne i maski z marginesem, albedo premult bez.
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const j = y * b.w + x;
      const o = ((cell.y + y) * AW + cell.x + x) * 4;
      atlasA[o] = Math.round(srgb(b.rgb[j * 3]) * 255);
      atlasA[o + 1] = Math.round(srgb(b.rgb[j * 3 + 1]) * 255);
      atlasA[o + 2] = Math.round(srgb(b.rgb[j * 3 + 2]) * 255);
      atlasA[o + 3] = Math.round(clamp01(b.a[j]) * 255);
      atlasN[o] = Math.round((b.nx[j] * 0.5 + 0.5) * 255);
      atlasN[o + 1] = Math.round((b.ny[j] * 0.5 + 0.5) * 255);
      atlasN[o + 2] = Math.round(clamp01(b.gl[j]) * 255);
      atlasM[o] = Math.round(clamp01(b.p1[j]) * 255);
      atlasM[o + 1] = Math.round(clamp01(b.p2[j]) * 255);
      atlasM[o + 2] = Math.round(clamp01(b.em[j]) * 255);
    }
  }
  // Pojedyncze płótno: prosta alfa, malowanie domyślne wypalone.
  const look = DEFAULT_LOOK[name];
  const p1 = truckHexLinear(look.paint);
  const p2 = truckHexLinear(look.accent);
  const rgba = Buffer.alloc(b.w * b.h * 4);
  for (let j = 0; j < b.w * b.h; j++) {
    const a = b.a[j];
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const m = (1 + (p1[c] - 1) * b.p1[j]) * (1 + (p2[c] - 1) * b.p2[j]);
      rgba[j * 4 + c] = Math.round(srgb((b.rgb[j * 3 + c] / a) * m) * 255);
    }
    rgba[j * 4 + 3] = Math.round(clamp01(a) * 255);
  }
  writeFileSync(join(OUT, `${name}.png`), encodePng(b.w, b.h, rgba));
}
writeFileSync(join(OUT, 'trucks_atlas.png'), encodePng(AW, AH, atlasA));
writeFileSync(join(OUT, 'trucks_atlas_n.png'), encodePng(AW, AH, atlasN));
writeFileSync(join(OUT, 'trucks_atlas_m.png'), encodePng(AW, AH, atlasM));
console.log('zapisano', OUT);

// ---------------------------------------------------------------------------
// Podgląd: wszystkie części oświetlone jak w partii (słońce, otoczenie, połysk) na ciemnym tle.
if (previewPath) {
  const L = (() => { const v = [-0.5, -0.45, 0.74]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
  const Hv = (() => { const v = [L[0], L[1], L[2] + 1]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
  const W = 1760;
  const H = 1000;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i * 4] = 8; px[i * 4 + 1] = 10; px[i * 4 + 2] = 14; px[i * 4 + 3] = 255; }
  const place = { tractor_light: [20, 20], tractor_standard: [430, 20], tractor_heavy: [930, 20], trailer_chassis: [20, 450], cargo_std_a: [680, 460], cargo_std_b: [1120, 460], cargo_hazmat: [20, 730], cargo_tank: [460, 730], cargo_hopper: [900, 730] };
  for (const [name, [ox, oy]] of Object.entries(place)) {
    const b = baked[name];
    const look = DEFAULT_LOOK[name];
    const p1 = truckHexLinear(look.paint);
    const p2 = truckHexLinear(look.accent);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const j = y * b.w + x;
        const a = b.a[j];
        if (a <= 0.003 || ox + x >= W || oy + y >= H) continue;
        const nz = Math.sqrt(Math.max(0, 1 - b.nx[j] * b.nx[j] - b.ny[j] * b.ny[j]));
        const nl = Math.max(0, b.nx[j] * L[0] + b.ny[j] * L[1] + nz * L[2]);
        const nh = Math.max(0, b.nx[j] * Hv[0] + b.ny[j] * Hv[1] + nz * Hv[2]);
        const spec = Math.pow(nh, 8 + 90 * b.gl[j]) * b.gl[j] * 0.8;
        const o = ((oy + y) * W + ox + x) * 4;
        for (let c = 0; c < 3; c++) {
          const m = (1 + (p1[c] - 1) * b.p1[j]) * (1 + (p2[c] - 1) * b.p2[j]);
          const lit = (b.rgb[j * 3 + c] * m) * (0.3 + 1.1 * nl) + (spec + b.em[j] * (c === 0 ? 1.2 : c === 1 ? 0.8 : 0.5)) * a;
          const bg = Math.pow(px[o + c] / 255, 2.2);
          px[o + c] = Math.round(srgb(lit + bg * (1 - a)) * 255);
        }
      }
    }
  }
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, encodePng(W, H, px));
  console.log('podgląd', previewPath);
}
