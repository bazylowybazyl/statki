// Analiza rozmieszczenia rdzeni (node): mapa głębokości maski kadłuba,
// odstęp od hardpointów/dysz, środek masy, najlepsze wolne miejsca.
//   node dema/rdzen-analyze.js            → .tmp/rdzen/placement-*.png + placement.json
// Wszystkie liczby w px SIATKI (skala renderu kadłuba = jednostki świata przy
// spriteScale 1), pozycje rdzeni w px PNG (jak w edytorze).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { HULLS, HULL_IDS, expandCandidate } from './rdzen-hulls-data.js';
import { getHullAlphaMask, getHullRenderRaster } from './rdzen-node-hulls.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repo, '.tmp/rdzen');
mkdirSync(outDir, { recursive: true });

// Dokładna transformata odległości (Felzenszwalb–Huttenlocher), piksele wnętrza
// → odległość do najbliższego piksela tła.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function distanceTransform(mask, w, h) {
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
  }
  return grid;
}

// --- mały koder PNG (RGB) do obrazków z adnotacjami ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePngRgb(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function markersOf(key) {
  const cfg = SHIP_EDITOR_DEFAULTS.ships[key] || {};
  const hp = (cfg.hardpoints || []).map((m) => ({ x: m.x, y: m.y, kind: m.type }));
  const eng = [...(cfg.engines?.main || []), ...(cfg.engines?.side || [])].map((m) => ({ x: m.x, y: m.y, kind: 'engine' }));
  return { hp, eng };
}

function analyzeHull(hullId) {
  const def = HULLS[hullId];
  const { mask, width: w, height: h } = getHullAlphaMask(hullId);
  const { png } = getHullRenderRaster(hullId);
  const sx = w / png.width;
  const sy = h / png.height;
  const uni = (sx + sy) / 2;
  const dist = distanceTransform(mask, w, h);
  const toGrid = (p) => ({ gx: p.x * sx + w / 2, gy: p.y * sy + h / 2 });
  const toPng = (gx, gy) => ({ x: (gx - w / 2) / sx, y: (gy - h / 2) / sy });

  let cxSum = 0, cySum = 0, area = 0, maxDepth = 0, maxAt = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      cxSum += x; cySum += y; area++;
      if (dist[i] > maxDepth) { maxDepth = dist[i]; maxAt = { gx: x, gy: y }; }
    }
  }
  const centroid = { gx: cxSum / area, gy: cySum / area };
  const { hp, eng } = markersOf(def.editorKey);
  const hpG = hp.map((m) => ({ ...m, ...toGrid(m) }));
  const engG = eng.map((m) => ({ ...m, ...toGrid(m) }));
  const nearest = (gx, gy, list) => {
    let best = Infinity, which = null;
    for (const m of list) {
      const d = Math.hypot(m.gx - gx, m.gy - gy);
      if (d < best) { best = d; which = m; }
    }
    return { d: best, which };
  };
  const depthAt = (gx, gy) => {
    const x = Math.round(gx), y = Math.round(gy);
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return dist[y * w + x];
  };
  const evaluate = (p) => {
    const g = toGrid(p);
    const nh = nearest(g.gx, g.gy, hpG);
    const ne = nearest(g.gx, g.gy, engG);
    return {
      png: { x: +p.x.toFixed(1), y: +p.y.toFixed(1) },
      grid: { x: +(g.gx - w / 2).toFixed(1), y: +(g.gy - h / 2).toFixed(1) },
      depth: +depthAt(g.gx, g.gy).toFixed(1),
      toCentroid: +Math.hypot(g.gx - centroid.gx, g.gy - centroid.gy).toFixed(1),
      nearestHardpoint: nh.which ? { d: +nh.d.toFixed(1), type: nh.which.kind, png: { x: nh.which.x, y: nh.which.y } } : null,
      nearestEngine: ne.which ? { d: +ne.d.toFixed(1), png: { x: ne.which.x, y: ne.which.y } } : null
    };
  };

  // Najlepsze wolne miejsca: głębokość ograniczona odstępem od hardpointów
  // i dysz (miejsce musi pomieścić komorę r ≈ 26 px siatki i margines).
  const clearance = 45;
  const scored = [];
  const step = 4;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const dh = nearest(x, y, hpG).d;
      const de = nearest(x, y, engG).d;
      const free = Math.min(dh, de);
      const depth = dist[i];
      if (free < clearance) continue;
      scored.push({ x, y, depth, free, score: Math.min(depth, free * 0.8) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const picks = [];
  for (const s of scored) {
    if (picks.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > 90)) picks.push(s);
    if (picks.length >= 6) break;
  }
  const best = picks.map((s) => evaluate(toPng(s.x, s.y)));

  const candidates = (def.candidates || []).flatMap((c) => expandCandidate(c).map((m) => ({ id: m.id, label: c.label, ...evaluate(m), rGrid: +(m.r * uni).toFixed(1) })));

  // obrazek: głębokość jako jasność, tło ciemne, hardpointy czerwone, dysze
  // pomarańczowe, kandydaci zieloni (okrąg = komora), środek masy biały krzyż
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? Math.min(255, 40 + dist[i] * (215 / Math.max(1, maxDepth))) : 8;
    rgb[i * 3] = v * 0.55; rgb[i * 3 + 1] = v * 0.7; rgb[i * 3 + 2] = v;
  }
  const put = (x, y, r, g, b) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  };
  const disc = (cx, cy, rad, col) => {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) put(cx + x, cy + y, ...col);
  };
  const ring = (cx, cy, rad, col) => {
    const n = Math.max(24, Math.round(rad * 6));
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; put(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, ...col); }
  };
  for (const m of hpG) disc(m.gx, m.gy, 3, [255, 60, 60]);
  for (const m of engG) disc(m.gx, m.gy, 3, [255, 160, 40]);
  for (const b of best) ring(b.grid.x + w / 2, b.grid.y + h / 2, 6, [255, 255, 120]);
  for (const c of candidates) { ring(c.grid.x + w / 2, c.grid.y + h / 2, c.rGrid, [80, 255, 120]); disc(c.grid.x + w / 2, c.grid.y + h / 2, 2, [80, 255, 120]); }
  for (let k = -6; k <= 6; k++) { put(centroid.gx + k, centroid.gy, 255, 255, 255); put(centroid.gx, centroid.gy + k, 255, 255, 255); }
  writeFileSync(resolve(outDir, `placement-${hullId}.png`), encodePngRgb(rgb, w, h));

  return {
    hull: hullId,
    grid: { w, h, scale: { x: +sx.toFixed(4), y: +sy.toFixed(4) } },
    centroidPng: toPng(centroid.gx, centroid.gy),
    maxDepth: +maxDepth.toFixed(1),
    maxDepthAtPng: maxAt ? toPng(maxAt.gx, maxAt.gy) : null,
    bestFree: best,
    candidates
  };
}

const report = HULL_IDS.map(analyzeHull);
writeFileSync(resolve(outDir, 'placement.json'), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n== ${r.hull}  siatka ${r.grid.w}x${r.grid.h}  skala ${r.grid.scale.x}/${r.grid.scale.y}  max głęb. ${r.maxDepth} @ png (${r.maxDepthAtPng.x.toFixed(0)}, ${r.maxDepthAtPng.y.toFixed(0)})  środek masy png (${r.centroidPng.x.toFixed(0)}, ${r.centroidPng.y.toFixed(0)})`);
  for (const c of r.candidates) {
    console.log(`  kandydat ${c.id.padEnd(14)} png (${c.png.x}, ${c.png.y}) r=${c.rGrid}px  głęb. ${c.depth}  hp ${c.nearestHardpoint?.d} (${c.nearestHardpoint?.type})  dysza ${c.nearestEngine?.d}  do śr. masy ${c.toCentroid}`);
  }
  for (const b of r.bestFree) {
    console.log(`  wolne       png (${b.png.x}, ${b.png.y})  głęb. ${b.depth}  hp ${b.nearestHardpoint?.d} (${b.nearestHardpoint?.type})  dysza ${b.nearestEngine?.d}  do śr. masy ${b.toCentroid}`);
  }
}
