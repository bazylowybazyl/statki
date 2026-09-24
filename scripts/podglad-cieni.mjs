// Podgląd offline shadow shafts kadłubów: rasteryzuje TĘ SAMĄ matematykę co
// pass i zapisuje PNG (podglad-cieni.png). Pieczenie SDF i marsz promienia
// z src/3d/hullShadowSdf.js (traceHullShadowCpu = lustro GLSL z passa).
//
//   node scripts/podglad-cieni.mjs
//
// Sylwetka testowa celowo jest "trudna": szeroki środek, wąska rufa, ostry
// dziób, boczne kolce i rozwidlony dziób — cień ma startować spod burty,
// obejmować kolce, przepuszczać światło przez widelec, a kadłub nie może
// rzucać cienia sam na siebie.
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import {
  HULL_SDF_LAYER_SIZE,
  HULL_SDF_OCCLUDER_FLOATS,
  bakeHullSdfLayer,
  packHullShaftOccluder,
  traceHullShadowCpu
} from '../src/3d/hullShadowSdf.js';

var CRC_TABLE = null;

const HULL_STRENGTH = 0.55;   // HULL_SHADOW_STRENGTH w core3d.js
const HULL_LEN_MUL = 3.0;     // medium
const HULL_STEPS = 24;        // medium

// ── Sylwetka testowa ───────────────────────────────────────────────────────
const SRC_W = 600, SRC_H = 220, HEX = 6;
function halfWidthAt(t) {
  if (t < 0.18) return 22;                     // rufa: wąski ogon
  if (t < 0.42) return 22 + (SRC_H * 0.5 - 22) * (t - 0.18) / 0.24;
  if (t < 0.62) return SRC_H * 0.5;            // śródokręcie: pełna szerokość
  return Math.max(10, SRC_H * 0.5 * (1 - (t - 0.62) / 0.38)); // dziób
}
// u, v względem środka sprite'a
function hullMask(u, v) {
  const t = (u + SRC_W * 0.5) / SRC_W;
  if (t < 0 || t > 1) return false;
  if (t > 0.82 && Math.abs(v) < 8) return false;                        // widelec dziobu
  if (Math.abs(u - 20) < 8 && Math.abs(v) < SRC_H * 0.5 + 18) return true;  // kolce burtowe
  return Math.abs(v) <= halfWidthAt(t);
}

const shards = [];
const hexH = Math.sqrt(3) * HEX;
for (let c = 0; c * HEX * 1.5 <= SRC_W + 40; c++) {
  for (let ro = 0; ro * hexH <= SRC_H + 60; ro++) {
    const gx = c * HEX * 1.5 - 20;
    const gy = ro * hexH + (c % 2 ? hexH * 0.5 : 0) - 30;
    if (hullMask(gx - SRC_W * 0.5, gy - SRC_H * 0.5)) shards.push({ gridX: gx, gridY: gy, radius: HEX, active: true });
  }
}
const grid = { srcWidth: SRC_W, srcHeight: SRC_H, pivot: { x: 0, y: 0 }, shards };
// Alfa „sprite'a” z tej samej sylwetki — w grze maskę heksów przycina alfa
// obrazu kadłuba (bez niej brzeg SDF to ząbki kół opisanych na heksach).
const alpha = { data: new Uint8Array(SRC_W * SRC_H), w: SRC_W, h: SRC_H };
for (let y = 0; y < SRC_H; y++) {
  for (let x = 0; x < SRC_W; x++) {
    alpha.data[y * SRC_W + x] = hullMask(x + 0.5 - SRC_W * 0.5, y + 0.5 - SRC_H * 0.5) ? 255 : 0;
  }
}
const layer = new Uint8Array(HULL_SDF_LAYER_SIZE * HULL_SDF_LAYER_SIZE);
const layout = bakeHullSdfLayer(grid, alpha, layer, 0, {});
console.log('heksów:', shards.length, 'siatka SDF:', `${layout.gw}×${layout.gh}`, 'teksel:', layout.texel.toFixed(2), 'px');

// ── Scena: cztery orientacje kadłuba, jedno słońce (współrzędne gry, y w dół)
const W = 1200, HGT = 760, SCALE = 0.42;
const SUN = { x: 60000, y: -60000 };
const ships = [
  { x: -450, y: -350, ang: 0 },
  { x: 450, y: -350, ang: Math.PI * 0.25 },
  { x: -450, y: 400, ang: -Math.PI * 0.25 },
  { x: 450, y: 400, ang: Math.PI * 0.5 }
];
// Okludery jak w hexShips3D: rotation.z mesha = -kąt, skala 1.
const packed = new Float32Array(ships.length * HULL_SDF_OCCLUDER_FLOATS);
ships.forEach((s, i) => packHullShaftOccluder(packed, i * HULL_SDF_OCCLUDER_FLOATS, s.x, s.y, -s.ang, 1, 1, layout, 0));

const px = Buffer.alloc(W * HGT * 3);
for (let y = 0; y < HGT; y++) {
  for (let x = 0; x < W; x++) {
    const wx = (x - W / 2) / SCALE;
    const wy = (y - HGT / 2) / SCALE;
    // pass liczy w three-space (y w górę)
    let dx = SUN.x - wx, dy = -SUN.y + wy;
    const sunDist = Math.hypot(dx, dy);
    dx /= sunDist; dy /= sunDist;
    let s = 0;
    for (let i = 0; i < ships.length; i++) {
      s = Math.max(s, traceHullShadowCpu(wx, -wy, dx, dy, sunDist, packed, i * HULL_SDF_OCCLUDER_FLOATS, layer,
        { steps: HULL_STEPS, lenMul: HULL_LEN_MUL }) * HULL_STRENGTH);
    }
    let r = 70, g = 84, b = 110;
    r = r * (1 - s) + r * 0.06 * s;
    g = g * (1 - s) + g * 0.10 * s;
    b = b * (1 - s) + b * 0.16 * s;
    for (const sh of ships) {
      const ddx = wx - sh.x, ddy = wy - sh.y;
      const c = Math.cos(-sh.ang), sn = Math.sin(-sh.ang);
      if (hullMask(ddx * c - ddy * sn, ddx * sn + ddy * c)) { r = 205; g = 210; b = 215; }
    }
    const o = (y * W + x) * 3;
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
}
writeFileSync('podglad-cieni.png', encodePNG(px, W, HGT));
console.log('zapisano podglad-cieni.png');

function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
