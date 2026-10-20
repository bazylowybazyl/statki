// Pomiar floty Terra Novy w kreatorze kadłubów: IoU alfy projektu (preset z src/game/hullDesign/hullDesignPresets.js)
// i sprite'a gry w tym samym układzie (j. świata: dłuższy bok płótna = długość profilu × HULL_RENDER_WORLD_SCALE,
// x od środka pudła alfy ku dziobowi, y od osi symetrii w dół — jak sloty systemów i dawny obrys) oraz PODKŁAD do
// układania klocków: sprite z siatką j. świata (podpisy co dwie linie), kontury projektu (rama — turkus, pancerz —
// żółty, nadbudówka i mostek — pomarańcz), różnice (czerwień — sprite bez projektu, błękit — projekt bez sprite'a).
//
//   node scripts/kreator-tn-ab.mjs [--kadlub custos,hasta,bellator,citadella,colossus] [--out .tmp/kreator/tn]
//        [--px 10] [--krok 5] [--kadr x0,y0,x1,y1] [--bez-projektu] [--tylko-iou]
//   → <okręt>-podklad.png, wynik w konsoli i <out>/iou.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './webgpu/png.mjs';
import { buildHullField, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../src/data/ships.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return acc;
}, []));

/** Preset → sprite i profil renderu; px — domyślna skala podkładu [px/j.], krok siatki [j.]. */
export const TN_SPRITES = {
  custos: { profile: 'terran_frigate', sprite: 'src/assets/ships/terranfrigate.png', px: 10, krok: 5 },
  hasta: { profile: 'terran_destroyer', sprite: 'src/assets/ships/terrandestroyer.png', px: 6, krok: 10 },
  bellator: { profile: 'terran_battleship', sprite: 'src/assets/ships/terranbattleship.png', px: 2.4, krok: 20 },
  citadella: { profile: 'terran_carrier', sprite: 'src/assets/ships/terrancarrier.png', px: 1.45, krok: 25 },
  colossus: { profile: 'terran_supercapital', sprite: 'src/assets/ships/terransupercapital.png', px: 1, krok: 50 }
};

/** Sprite w układzie projektu: { png, s [j./px], cx, axis [px], at(x, y) → alfa 0..1 (dwuliniowo) }. */
export function tnSprite(key) {
  const def = TN_SPRITES[key];
  const png = readPng(join(repo, def.sprite));
  const { width: W, height: H, data } = png;
  const s = HULL_RENDER_PROFILES[def.profile].length * HULL_RENDER_WORLD_SCALE / Math.max(W, H);
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 8) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  const al = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3]);
  let axis = (by0 + by1) / 2, best = Infinity;
  for (let k = -120; k <= 120; k++) {
    const a = (by0 + by1) / 2 + k * 0.5;
    let err = 0, n = 0;
    for (let y = by0; y <= by1; y += 2) { const my = Math.round(2 * a - y); for (let x = bx0; x <= bx1; x += 4) { err += Math.abs(al(x, y) - al(x, my)); n++; } }
    if (err / n < best) { best = err / n; axis = a; }
  }
  const cx = (bx0 + bx1) / 2;
  const rgba = (x, y) => {
    // x, y [j.] → piksel sprite'a (dwuliniowo)
    const fx = cx + x / s - 0.5, fy = axis + y / s - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const out = [0, 0, 0, 0];
    for (const [ii, jj, w] of [[i, j, (1 - tx) * (1 - ty)], [i + 1, j, tx * (1 - ty)], [i, j + 1, (1 - tx) * ty], [i + 1, j + 1, tx * ty]]) {
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const o = (jj * W + ii) * 4;
      for (let c = 0; c < 4; c++) out[c] += data[o + c] * w;
    }
    return out;
  };
  return { png, W, H, s, cx, axis, rgba, box: [(bx0 - cx) * s, (by0 - axis) * s, (bx1 + 1 - cx) * s, (by1 + 1 - axis) * s] };
}

/** IoU alfy projektu (pole poziomu 0 < 0) i sprite'a (alfa > ½) na siatce pikseli sprite'a (+ pudło projektu). */
export function tnIoU(key, field, sp = tnSprite(key)) {
  const b = field.bounds;
  const x0 = Math.min(sp.box[0], b.minX), x1 = Math.max(sp.box[2], b.maxX), y0 = Math.min(sp.box[1], b.minY), y1 = Math.max(sp.box[3], b.maxY);
  let inter = 0, uni = 0, a = 0, d = 0;
  const step = sp.s;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const A = sp.rgba(x, y)[3] > 127.5, D = sampleHullField(field, 0, x, y) < 0;
      if (A) a++; if (D) d++;
      if (A && D) inter++;
      if (A || D) uni++;
    }
  }
  const px2 = step * step;
  return { iou: inter / Math.max(1, uni), spriteArea: a * px2, designArea: d * px2, onlySprite: (a - inter) * px2, onlyDesign: (d - inter) * px2 };
}

// ---------------------------------------------------------------------------
// Podkład: sprite + siatka + kontury projektu

const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '.': '000000000000010'
};
function text(img, str, x, y, col, k = 2) {
  let cx = x;
  for (const ch of String(str)) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r * 3 + c] !== '1') continue;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) put(img, cx + c * k + dx, y + r * k + dy, col, 1);
      }
    }
    cx += 4 * k;
  }
}
function put(img, x, y, col, a) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  for (let c = 0; c < 3; c++) img.data[o + c] = img.data[o + c] * (1 - a) + col[c] * a;
  img.data[o + 3] = 255;
}

export function tnUnderlay(key, field, opts = {}) {
  const sp = opts.sprite || tnSprite(key);
  const def = TN_SPRITES[key];
  const k = Number(opts.px) || def.px;
  const krok = Number(opts.krok) || def.krok;
  const box = opts.kadr || [sp.box[0] - krok, sp.box[1] - krok, sp.box[2] + krok, sp.box[3] + krok];
  const Wo = Math.round((box[2] - box[0]) * k), Ho = Math.round((box[3] - box[1]) * k);
  const img = { width: Wo, height: Ho, data: new Uint8ClampedArray(Wo * Ho * 4) };
  const fs = field ? [0, 1, 2, 3].map(() => new Float32Array(Wo * Ho)) : null;
  for (let j = 0; j < Ho; j++) {
    const y = box[1] + (j + 0.5) / k;
    for (let i = 0; i < Wo; i++) {
      const x = box[0] + (i + 0.5) / k;
      const [r, g, b, a] = sp.rgba(x, y);
      const o = (j * Wo + i) * 4;
      const al = a / 255;
      const dim = field ? 0.62 : 1;
      img.data[o] = 10 + (r * dim - 10) * al; img.data[o + 1] = 12 + (g * dim - 12) * al; img.data[o + 2] = 16 + (b * dim - 16) * al; img.data[o + 3] = 255;
      if (fs) {
        for (let L = 0; L < 4; L++) fs[L][j * Wo + i] = sampleHullField(field, L, x, y);
        const D = fs[0][j * Wo + i] < 0, A = al > 0.5;
        if (A && !D) put(img, i, j, [255, 40, 40], 0.35);
        if (D && !A) put(img, i, j, [60, 140, 255], 0.45);
      }
    }
  }
  // siatka j. świata
  const major = krok * 2;
  for (let gx = Math.ceil(box[0] / krok) * krok; gx <= box[2]; gx += krok) {
    const i = Math.round((gx - box[0]) * k);
    const isMajor = Math.abs(gx / major - Math.round(gx / major)) < 1e-6;
    for (let j = 0; j < Ho; j++) put(img, i, j, gx === 0 ? [255, 200, 80] : [160, 200, 220], gx === 0 ? 0.6 : (isMajor ? 0.28 : 0.12));
    if (isMajor) { text(img, gx, i + 3, 3, [255, 230, 150]); text(img, gx, i + 3, Ho - 14, [255, 230, 150]); }
  }
  for (let gy = Math.ceil(box[1] / krok) * krok; gy <= box[3]; gy += krok) {
    const j = Math.round((gy - box[1]) * k);
    const isMajor = Math.abs(gy / major - Math.round(gy / major)) < 1e-6;
    for (let i = 0; i < Wo; i++) put(img, i, j, gy === 0 ? [255, 200, 80] : [160, 200, 220], gy === 0 ? 0.6 : (isMajor ? 0.28 : 0.12));
    if (isMajor) text(img, gy, 3, j + 3, [255, 230, 150]);
  }
  // kontury poziomów projektu
  if (fs) {
    const cols = [[60, 240, 220], [255, 235, 60], [255, 150, 40], [255, 90, 200]];
    for (let L = 0; L < 4; L++) {
      const f = fs[L];
      for (let j = 0; j + 1 < Ho; j++) for (let i = 0; i + 1 < Wo; i++) {
        const v = f[j * Wo + i];
        if ((v < 0) !== (f[j * Wo + i + 1] < 0) || (v < 0) !== (f[(j + 1) * Wo + i] < 0)) put(img, i, j, cols[L], 0.95);
      }
    }
  }
  return img;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const keys = String(args.kadlub || Object.keys(TN_SPRITES).join(',')).split(',');
  const out = resolve(repo, args.out || '.tmp/kreator/tn');
  mkdirSync(out, { recursive: true });
  const res = {};
  for (const key of keys) {
    const sp = tnSprite(key);
    const design = hullDesignPreset(key);
    const field = args['bez-projektu'] ? null : buildHullField(design, { pipes: false });
    if (field) {
      const r = tnIoU(key, field, sp);
      const blocks = design.shapes.filter((s) => s.kind === 'block').length;
      res[key] = { ...r, blocks, castles: design.castles.length, parts: design.parts.length, modules: design.modules.length };
      console.log(`${key.padEnd(10)} IoU ${r.iou.toFixed(3)} · sprite ${Math.round(r.spriteArea)} j.² · projekt ${Math.round(r.designArea)} j.² · tylko sprite ${Math.round(r.onlySprite)} · tylko projekt ${Math.round(r.onlyDesign)} · klocki ${blocks} · kasztele ${design.castles.length}`);
    }
    if (!args['tylko-iou']) {
      const kadr = args.kadr ? String(args.kadr).split(',').map(Number) : null;
      writePng(join(out, `${key}-podklad.png`), tnUnderlay(key, field, { sprite: sp, px: args.px, krok: args.krok, kadr }));
    }
  }
  if (Object.keys(res).length) writeFileSync(join(out, 'iou.json'), JSON.stringify(res, null, 2) + '\n');
}
