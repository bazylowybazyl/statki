// Benchmark mostków w Node — bez przeglądarki, deterministycznie.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-bench-node.js
//   node ... dema/mostki-bench-node.js --hulls battleship --weapons railgun_mk2 --dirs burta
//   node ... dema/mostki-bench-node.js --sens battleship        (siatka armorMul × killFrac)
//   node ... dema/mostki-bench-node.js --atlas                 (Atlas: wszystkie warianty mostka)
//
// Wyniki: .tmp/mostki/bench-*.json i .md. Kadłuby buduje ten sam kod co
// demo (mostki-hulls.js → initHexBody); PNG dekodujemy sami (zlib), a skalowanie
// do rozmiaru renderu uśrednia piksele jak drawImage z wygładzaniem. Siatka
// może różnić się od przeglądarki pojedynczymi heksami brzegu (próg alfy) —
// liczby heksów obu ścieżek wypisuje raport.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { HULLS, buildHullEntity, hullRenderSize, bridgeVariants } from './mostki-hulls.js';
import {
  BENCH_WEAPONS,
  BENCH_DIRECTIONS,
  formatBenchMarkdown,
  formatSensitivityMarkdown,
  runBenchPlan,
  sensitivityPlan,
  standardPlan
} from './mostki-bench.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));

// ---------------------------------------------------------------------------
// PNG (RGBA 8 bit, bez przeplotu — tak zapisane są sprite'y kadłubów)
// ---------------------------------------------------------------------------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('to nie PNG');
  let off = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0; let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error(`nieobsługiwany PNG ct=${colorType} bd=${bitDepth} il=${interlace}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[p++];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

// Pomniejszenie uśrednianiem pól (≈ drawImage z wygładzaniem przy skali ~0,5).
function resampleBox(src, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy; const y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx; const x1 = x0 + sx;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1) && yy < src.height; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1) && xx < src.width; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const wgt = wx * wy;
          const o = (yy * src.width + xx) * 4;
          const al = src.data[o + 3] / 255;
          r += src.data[o] * al * wgt; g += src.data[o + 1] * al * wgt; b += src.data[o + 2] * al * wgt;
          a += src.data[o + 3] * wgt; wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      const alpha = wsum > 0 ? a / wsum : 0;
      const k = alpha > 0 ? 255 / (alpha * wsum) : 0;
      out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = alpha;
    }
  }
  return { width: w, height: h, data: out };
}

// Rozciągnięcie o ułamek piksela (initHexBody zaokrągla rozmiar do parzystego
// i rysuje obraz w tym prostokącie) — dwuliniowo, jak drawImage.
function resampleBilinear(src, w, h) {
  if (src.width === w && src.height === h) return src.data;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(src.height - 1, (y + 0.5) * src.height / h - 0.5));
    const y0 = Math.floor(fy); const y1 = Math.min(src.height - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(src.width - 1, (x + 0.5) * src.width / w - 0.5));
      const x0 = Math.floor(fx); const x1 = Math.min(src.width - 1, x0 + 1); const tx = fx - x0;
      for (let ch = 0; ch < 4; ch++) {
        const a = src.data[(y0 * src.width + x0) * 4 + ch];
        const b = src.data[(y0 * src.width + x1) * 4 + ch];
        const c = src.data[(y1 * src.width + x0) * 4 + ch];
        const d = src.data[(y1 * src.width + x1) * 4 + ch];
        out[(y * w + x) * 4 + ch] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    }
  }
  return out;
}

// Atrapa DOM tylko dla rastrów (jak tests/helpers/destructorHull.mjs):
// getImageData zwraca prawdziwe piksele obrazu przeskalowane do celu.
export function installCanvasShim() {
  const noop = () => {};
  globalThis.document = {
    createElement: () => {
      const canvas = { width: 1, height: 1, _img: null };
      const ctx = {
        save: noop, restore: noop, translate: noop, beginPath: noop, moveTo: noop, lineTo: noop,
        closePath: noop, clip: noop, fill: noop, clearRect: noop, fillRect: noop, stroke: noop,
        set globalCompositeOperation(_v) {}, get globalCompositeOperation() { return 'source-over'; },
        drawImage(img, x, y, w, h) { if (img && img.__rgba) canvas._img = { img, w: w ?? img.width, h: h ?? img.height }; },
        getImageData(_x, _y, w, h) {
          const d = canvas._img;
          if (!d) return { data: new Uint8ClampedArray(w * h * 4) };
          return { data: resampleBilinear(d.img.__rgba, w, h) };
        }
      };
      canvas.getContext = () => ctx;
      return canvas;
    }
  };
}

const imageCache = new Map();
export function renderImageFor(key) {
  if (imageCache.has(key)) return imageCache.get(key);
  const h = HULLS[key];
  const png = decodePng(readFileSync(fileURLToPath(h.png)));
  const size = hullRenderSize(key);
  const small = resampleBox(png, size.w, size.h);
  const img = { width: size.w, height: size.h, __rgba: small };
  imageCache.set(key, img);
  return img;
}

// ---------------------------------------------------------------------------

async function main() {
  installCanvasShim();
  const env = {
    makeHull: (key) => buildHullEntity(key, { renderImage: renderImageFor(key) })
  };
  const outDir = resolve(repo, '.tmp/mostki');
  mkdirSync(outDir, { recursive: true });
  const weaponNames = Object.fromEntries(Object.entries(MASTER_WEAPONS).map(([k, v]) => [k, v.name]));

  for (const key of Object.keys(HULLS)) {
    const e = env.makeHull(key);
    console.log(`${key}: render ${e.hexGrid.srcWidth}×${e.hexGrid.srcHeight}, heksów ${e.hexGrid.shards.length}, siatka ${e.hexGrid.cols}×${e.hexGrid.rows}`);
  }

  const t0 = Date.now();
  const progress = (i, n, rec) => {
    const b = rec.bridge ? `${rec.bridge.shots}` : (rec.mode === 'bridge' ? `>${rec.shots}` : '—');
    const p = rec.pool ? `${rec.pool.shots}(${rec.pool.cause})` : `>${rec.shots}`;
    console.log(`[${i}/${n}] ${rec.hullKey} ${rec.variant || ''} ${rec.weaponId} ${rec.dir} ${rec.mode}: mostek ${b} | pula ${p} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  };

  if (args.sens) {
    const hullKey = args.sens === '1' ? 'battleship' : args.sens;
    const rows = await runBenchPlan(env, sensitivityPlan({
      hullKey,
      weaponId: args.weapon || 'railgun_mk2',
      dir: args.dir || 'burta',
      variant: args.variant || null,
      killFracs: args.fracs ? args.fracs.split(',').map(Number) : undefined,
      armorMuls: args.armors ? args.armors.split(',').map(Number) : undefined,
      poolHitMul: args.pool ? Number(args.pool) : 1
    }), { onProgress: progress });
    const tag = `${hullKey}-${args.weapon || 'railgun_mk2'}-${args.dir || 'burta'}${args.pool ? `-pula${args.pool}` : ''}`;
    writeFileSync(resolve(outDir, `sens-${tag}.json`), JSON.stringify(rows, null, 1));
    const md = formatSensitivityMarkdown(rows, { title: `Czułość: ${hullKey}, ${weaponNames[args.weapon || 'railgun_mk2']}, ${args.dir || 'burta'}` });
    writeFileSync(resolve(outDir, `sens-${tag}.md`), md + '\n');
    console.log(md);
    return;
  }

  const plan = standardPlan({
    hulls: args.hulls ? args.hulls.split(',') : (args.atlas ? ['atlas'] : undefined),
    weapons: args.weapons ? args.weapons.split(',') : BENCH_WEAPONS,
    dirs: args.dirs ? args.dirs.split(',') : Object.keys(BENCH_DIRECTIONS),
    atlasVariants: args.atlas ? Object.keys(bridgeVariants('atlas')) : undefined,
    armorMul: args.armor ? Number(args.armor) : undefined,
    killFrac: args.kill ? Number(args.kill) : undefined,
    maxShots: args.max ? Number(args.max) : undefined,
    visuals: !!args.visuals,
    fixHitProbe: !args.nofix,
    poolHitMul: args.pool ? Number(args.pool) : undefined
  });
  const rows = await runBenchPlan(env, plan, { onProgress: progress });
  const tag = args.tag || ((args.atlas ? 'atlas' : 'all') + (args.nofix ? '-bez-poprawki' : '') + (args.pool ? `-pula${args.pool}` : ''));
  writeFileSync(resolve(outDir, `bench-${tag}.json`), JSON.stringify(rows, null, 1));
  const md = formatBenchMarkdown(rows, { weaponNames, title: `Benchmark mostków (${tag})` });
  writeFileSync(resolve(outDir, `bench-${tag}.md`), md + '\n');
  console.log(md);
  console.log(`czas: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
