// Koszt kadłuba na belkach dla kadłubów ruchu v2 po awansie do NPC (E6, taran z awansem) — mikrobenchmark w Node
// na PRAWDZIWYM HullBodies: budowa kadłuba ze sprite'a ruchu w rozmiarze renderu (jak `getNpcHexInitSource` w grze:
// sprite przeskalowany do `getHullRenderSize`), węzły i belki, krok `HullBodies.step` w spoczynku i podczas taranu
// (drugi kadłub wjeżdża w burtę z `--v` j/s — zgniot, cięcie, rozpad).
//
//   node scripts/koszt-kadluba-ruchu.mjs [--kadluby megafreighter,heavy_freighter,long_haul_freighter,container_ship]
//        [--taranem heavy_freighter] [--v 450] [--powtorz 5] [--kroki 120]
//
// Wynik: tabela na stdout (budowa ms — mediana z `--powtorz`, węzły, belki, krok w spoczynku i w taranie — średnia
// i maks. ms na krok 60 Hz).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { TRAFFIC_HULLS } = await import('../src/data/trafficHulls.js');
const { getHullRenderSize } = await import('../src/data/ships.js');

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const HULLS = String(arg('kadluby', 'megafreighter,heavy_freighter,long_haul_freighter,container_ship')).split(',');
const RAMMER = String(arg('taranem', 'heavy_freighter'));
const V = Number(arg('v', 450));
const REPEAT = Math.max(1, Number(arg('powtorz', 5)) | 0);
const STEPS = Math.max(10, Number(arg('kroki', 120)) | 0);
const DT = 1 / 60;

// ------------------------------------------------------------------ PNG → RGBA (8 bit, bez przeplotu)
function decodePng(buf) {
  let pos = 8;
  let w = 0, h = 0, colorType = 0, depth = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; if (data[12]) throw new Error('PNG z przeplotem'); }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`głębia ${depth}`);
  const ch = { 6: 4, 2: 3, 0: 1, 4: 2, 3: 1 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) { out[i * 4] = px[i * 4]; out[i * 4 + 1] = px[i * 4 + 1]; out[i * 4 + 2] = px[i * 4 + 2]; out[i * 4 + 3] = px[i * 4 + 3]; }
    else if (ch === 3) { out[i * 4] = px[i * 3]; out[i * 4 + 1] = px[i * 3 + 1]; out[i * 4 + 2] = px[i * 3 + 2]; out[i * 4 + 3] = 255; }
    else if (colorType === 3) { const k = px[i]; out[i * 4] = palette[k * 3]; out[i * 4 + 1] = palette[k * 3 + 1]; out[i * 4 + 2] = palette[k * 3 + 2]; out[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { const g = px[i * ch]; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g; out[i * 4 + 3] = ch === 2 ? px[i * 2 + 1] : 255; }
  }
  return { width: w, height: h, data: out };
}

// Skalowanie dwuliniowe (gra: drawImage z wygładzaniem na kanwę rozmiaru renderu).
function resize(img, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  const sx = img.width / tw, sy = img.height / th;
  for (let y = 0; y < th; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5)); const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5)); const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c], p10 = img.data[(y0 * img.width + x1) * 4 + c];
        const p01 = img.data[(y1 * img.width + x0) * 4 + c], p11 = img.data[(y1 * img.width + x1) * 4 + c];
        out[(y * tw + x) * 4 + c] = (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy;
      }
    }
  }
  return { width: tw, height: th, data: out };
}

const images = new Map();
function hullImage(hullId) {
  if (images.has(hullId)) return images.get(hullId);
  const def = TRAFFIC_HULLS[hullId];
  if (!def) throw new Error('nieznany kadłub ruchu: ' + hullId);
  const src = decodePng(readFileSync(fileURLToPath(def.sprite)));
  const size = getHullRenderSize(hullId, src.width, src.height);
  const img = resize(src, Math.max(64, Math.round(size.w)), Math.max(64, Math.round(size.h)));
  images.set(hullId, img);
  return img;
}

HullBodies.init();

function makeEnt(hullId, x, y, angle) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 50000, visual: { spriteScale: 1 }, shipFrame: hullId, type: hullId, name: hullId };
  const t0 = performance.now();
  if (!HullBodies.createHull(e, hullImage(hullId), { hullProfileId: hullId })) throw new Error('kadłub: ' + hullId);
  e.__buildMs = performance.now() - t0;
  return e;
}

function stepAll(list, n) {
  const ms = [];
  for (let k = 0; k < n; k++) {
    for (const e of list) { e.x += e.vx * DT; e.y += e.vy * DT; e.angle += (e.angVel || 0) * DT; }
    const t0 = performance.now();
    HullBodies.step(DT, list);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return { avg: ms.reduce((s, v) => s + v, 0) / ms.length, p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1] };
}

const rows = [];
for (const hullId of HULLS) {
  const img = hullImage(hullId);
  const builds = [];
  let e = null;
  for (let r = 0; r < REPEAT; r++) {
    if (e) HullBodies.release(e);
    e = makeEnt(hullId, 0, 0, 0);
    builds.push(e.__buildMs);
  }
  builds.sort((a, b) => a - b);
  const body = e.beamHull.body;
  const nodes = body.activeNodes;
  const beams = body.beamStore?.count ?? body.beams?.length ?? null;
  // spoczynek (kilka kroków — ciało zasypia)
  const idle = stepAll([e], 60);
  // taran: drugi kadłub z burty, `V` j/s w środek
  const halfW = img.height * 0.5;
  const ram = makeEnt(RAMMER, 0, -(halfW + hullImage(RAMMER).width * 0.5 + 40), Math.PI / 2);
  ram.vx = 0; ram.vy = V;
  const hp0 = nodes;
  const hit = stepAll([e, ram], STEPS);
  rows.push({
    kadlub: hullId, obraz: `${img.width}×${img.height}`, budowaMs: +builds[Math.floor(builds.length / 2)].toFixed(1),
    wezly: nodes, belki: beams, spoczynekMs: +idle.avg.toFixed(3), taranSredniaMs: +hit.avg.toFixed(2), taranP95Ms: +hit.p95.toFixed(2),
    taranMaksMs: +hit.max.toFixed(2), wezlyPoTaranie: e.beamHull ? e.beamHull.body.activeNodes : 0, wrakow: window.wrecks.length
  });
  HullBodies.release(ram);
  HullBodies.release(e);
  window.wrecks.length = 0;
}
console.table(rows);
console.log(JSON.stringify(rows));
