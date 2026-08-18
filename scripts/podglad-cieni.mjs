// Podgląd offline shadow shafts: rasteryzuje TĘ SAMĄ matematykę co pass
// i zapisuje PNG (podglad-cieni.png). buildHullSegments wycinane z żywego
// hexShips3D.js, pętla cienia przepisana 1:1 z GLSL w core3d.js.
//
//   node scripts/podglad-cieni.mjs
//
// Sylwetka testowa celowo jest "trudna": szeroki środek + wąska rufa i dziób
// — na takim kadłubie widać, czy okluder nie jest szerszy od statku (cień
// wychodzący z "jaja" zamiast spod burty).
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

var CRC_TABLE = null;

const shipsSrc = readFileSync('src/3d/hexShips3D.js', 'utf8');
const block = shipsSrc.slice(
  shipsSrc.indexOf('const HULL_SHAFT_SEGMENTS'),
  shipsSrc.indexOf('function getHullSegments')
);
const H = await import('data:text/javascript;base64,' + Buffer.from(
  block + '\nexport { buildHullSegments, HULL_SHAFT_SEGMENTS };'
).toString('base64'));

const coreSrc = readFileSync('src/3d/core3d.js', 'utf8');
const HULL_STRENGTH = Number(coreSrc.match(/const HULL_SHADOW_STRENGTH = ([\d.]+);/)[1]);
const HULL_LEN_MUL = 3.0;   // medium

// ── Sylwetka testowa: szeroki środek, wąska rufa, ostry dziób ──────────────
const SRC_W = 600, SRC_H = 220, HEX = 6;
function halfWidthAt(t) {
  if (t < 0.18) return 22;                     // rufa: wąski ogon
  if (t < 0.42) return 22 + (SRC_H * 0.5 - 22) * (t - 0.18) / 0.24;
  if (t < 0.62) return SRC_H * 0.5;            // śródokręcie: pełna szerokość
  return Math.max(10, SRC_H * 0.5 * (1 - (t - 0.62) / 0.38)); // dziób
}
const shards = [];
for (let gx = 0; gx <= SRC_W; gx += HEX * 1.5) {
  const half = halfWidthAt(gx / SRC_W);
  for (let gy = SRC_H * 0.5 - half; gy <= SRC_H * 0.5 + half; gy += HEX * 1.5) {
    shards.push({ gridX: gx, gridY: gy, radius: HEX });
  }
}
const grid = { srcWidth: SRC_W, srcHeight: SRC_H, pivot: { x: 0, y: 0 }, shards };
const hull = H.buildHullSegments(grid, shards, 1, 1);
console.log('pasma kadłuba:', hull.segs.map(s => ({
  u: `${s.u0.toFixed(0)}..${s.u1.toFixed(0)}`, vc: s.vc.toFixed(1), r: s.r.toFixed(1)
})), 'span:', hull.span.toFixed(0));

function worldSegments(px, py, ang) {
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  return hull.segs.map(seg => ({
    x1: px + seg.u0 * cosA - seg.vc * sinA,
    y1: py + seg.u0 * sinA + seg.vc * cosA,
    x2: px + seg.u1 * cosA - seg.vc * sinA,
    y2: py + seg.u1 * sinA + seg.vc * cosA,
    r: seg.r,
    span: hull.span
  }));
}

// ── Pętla cienia (1:1 z GLSL: hull loop w createShadowShaftsShader) ─────────
function shadowAt(px, py, seg, sunX, sunY) {
  let dx = sunX - px, dy = sunY - py;
  const sunDist = Math.hypot(dx, dy);
  if (sunDist < 1) return 0;
  dx /= sunDist; dy /= sunDist;

  const paX = seg.x1 - px, paY = seg.y1 - py;
  const pbX = seg.x2 - px, pbY = seg.y2 - py;
  const alongA = paX * dx + paY * dy;
  const alongB = pbX * dx + pbY * dy;
  if (alongA <= 0 && alongB <= 0) return 0;

  const perpA = dx * paY - dy * paX;
  const perpB = dx * pbY - dy * pbX;
  let perpMin, alongHit;
  if (perpA * perpB < 0) {
    const s = perpA / (perpA - perpB);
    perpMin = 0;
    alongHit = alongA + (alongB - alongA) * s;
  } else if (Math.abs(perpA) < Math.abs(perpB)) {
    perpMin = Math.abs(perpA); alongHit = alongA;
  } else {
    perpMin = Math.abs(perpB); alongHit = alongB;
  }
  if (perpMin > seg.r * 1.6) return 0;
  if (alongHit <= 0 || alongHit >= sunDist) return 0;

  const abX = seg.x2 - seg.x1, abY = seg.y2 - seg.y1;
  const segLen2 = Math.max(abX * abX + abY * abY, 0.0001);
  const h = Math.min(Math.max(((px - seg.x1) * abX + (py - seg.y1) * abY) / segLen2, 0), 1);
  const fx = px - (seg.x1 + abX * h), fy = py - (seg.y1 + abY * h);
  if (fx * fx + fy * fy <= seg.r * seg.r) return 0;

  const fallT = Math.min(Math.max(alongHit / Math.max(seg.span * HULL_LEN_MUL, 1), 0), 1);
  const fall = 1 - smoothstep(0.2, 1.0, fallT);
  const soft = seg.r * (0.12 + 0.35 * fallT);
  const edge = 1 - smoothstep(Math.max(seg.r - soft * 0.5, 0), seg.r + soft, perpMin);
  return edge * fall * HULL_STRENGTH;
}
function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

// ── Rasteryzacja: cztery orientacje kadłuba, jedno słońce ──────────────────
const W = 1200, HGT = 760, SCALE = 0.42;
const SUN = { x: 60000, y: -60000 };
const ships = [
  { x: -450, y: -350, ang: 0 },
  { x: 450, y: -350, ang: Math.PI * 0.25 },
  { x: -450, y: 400, ang: -Math.PI * 0.25 },
  { x: 450, y: 400, ang: Math.PI * 0.5 }
];

function hullMask(u, v) {
  const t = (u + SRC_W * 0.5) / SRC_W;
  if (t < 0 || t > 1) return false;
  return Math.abs(v) <= halfWidthAt(t);
}

const segs = ships.flatMap(s => worldSegments(s.x, s.y, s.ang));
const px = Buffer.alloc(W * HGT * 3);
for (let y = 0; y < HGT; y++) {
  for (let x = 0; x < W; x++) {
    const wx = (x - W / 2) / SCALE;
    const wy = (y - HGT / 2) / SCALE;
    let s = 0;
    for (const seg of segs) s = Math.max(s, shadowAt(wx, wy, seg, SUN.x, SUN.y));
    let r = 70, g = 84, b = 110;
    r = r * (1 - s) + r * 0.06 * s;
    g = g * (1 - s) + g * 0.10 * s;
    b = b * (1 - s) + b * 0.16 * s;
    for (const sh of ships) {
      const dx = wx - sh.x, dy = wy - sh.y;
      const c = Math.cos(-sh.ang), sn = Math.sin(-sh.ang);
      if (hullMask(dx * c - dy * sn, dx * sn + dy * c)) { r = 205; g = 210; b = 215; }
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
