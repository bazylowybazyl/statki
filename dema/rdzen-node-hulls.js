// Kadłuby dema rdzenia w node (benchmark bez renderu, analiza masek, testy).
// Tylko dla node — przeglądarkowe demo ładuje sprite'y przez <img> i kanwę.
//
// Odtwarza ścieżkę gry 1:1 poza samym rastrem:
//   PNG → kanwa renderu getHullRenderSize (NPC: getNpcHexInitSource, gracz:
//   getPlayerHullRenderImage) → initHexBody(entity, kanwa).
// Raster przeglądarki (drawImage z wygładzaniem 'low' = dwuliniowe) zastępuje
// tu próbkowanie dwuliniowe w środkach pikseli; różnice dotyczą tylko heksów
// brzegowych (próg alfy 40) — liczbę heksów porównuje z przeglądarką demo.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHexBody } from '../src/game/destructor.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { HULLS, makeHullEntity } from './rdzen-hulls-data.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- PNG (8 bit, RGB/RGBA/paleta, bez przeplotu) ---------------------------
export function decodePng(buffer) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buffer[i] !== sig[i]) throw new Error('To nie jest PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`PNG: nieobsługiwany format (bit ${bitDepth}, przeplot ${interlace})`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`PNG: typ koloru ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`PNG: filtr ${filter}`);
      }
      cur[x] = r & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (colorType === 6) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = cur[i + 3]; }
      else if (colorType === 2) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255; }
      else if (colorType === 3) {
        const k = cur[i];
        out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
        out[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = cur[i + 1]; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = 255; }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}

// Dwuliniowe próbkowanie w środkach pikseli docelowych (drawImage 'low').
export function resampleBilinear(src, srcW, srcH, dstW, dstH) {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * dstW + x) * 4;
      const a = (y0 * srcW + x0) * 4, b = (y0 * srcW + x1) * 4, c = (y1 * srcW + x0) * 4, d = (y1 * srcW + x1) * 4;
      // premultiplied, jak kanwa: kolor przezroczystych pikseli nie przecieka
      const wa = (1 - tx) * (1 - ty) * src[a + 3], wb = tx * (1 - ty) * src[b + 3];
      const wc = (1 - tx) * ty * src[c + 3], wd = tx * ty * src[d + 3];
      const alpha = wa + wb + wc + wd;
      out[o + 3] = alpha;
      if (alpha > 0) {
        for (let k = 0; k < 3; k++) out[o + k] = (src[a + k] * wa + src[b + k] * wb + src[c + k] * wc + src[d + k] * wd) / alpha;
      }
    }
  }
  return out;
}

// Obraz „kanwy” rozumiany przez atrapę kontekstu: width/height + piksele.
export function makeRasterImage(rgba, width, height, label = '') {
  return { width, height, naturalWidth: width, naturalHeight: height, __rgba: rgba, __label: label };
}

function makeStubContext(canvas) {
  const noop = () => {};
  return {
    canvas,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, arc: noop, rect: noop,
    clip: noop, fill: noop, stroke: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    drawImage(img, a, b, c, d) {
      const src = img?.__rgba;
      if (!src) return;
      // drawImage(img, 0, 0, w, h) — jedyny wariant używany przez initHexBody
      const w = Number.isFinite(c) ? c : img.width;
      const h = Number.isFinite(d) ? d : img.height;
      canvas.__rgba = (w === img.width && h === img.height) ? src : resampleBilinear(src, img.width, img.height, w, h);
      canvas.__rgbaW = w;
      canvas.__rgbaH = h;
    },
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      const src = canvas.__rgba;
      if (src) {
        const sw = canvas.__rgbaW;
        for (let yy = 0; yy < h; yy++) {
          const sy = y + yy;
          if (sy < 0 || sy >= canvas.__rgbaH) continue;
          const row = src.subarray((sy * sw + x) * 4, (sy * sw + x + w) * 4);
          data.set(row, yy * w * 4);
        }
      }
      return { data, width: w, height: h };
    }
  };
}

function makeStubCanvas() {
  const canvas = { width: 0, height: 0, __rgba: null };
  canvas.getContext = () => (canvas.__ctx || (canvas.__ctx = makeStubContext(canvas)));
  return canvas;
}

let _documentInstalled = false;
// Atrapa document tylko dla kanw destruktora (initHexBody, spawnWreckEntity).
export function installCanvasDocument() {
  if (_documentInstalled || globalThis.document) return;
  globalThis.document = { createElement: () => makeStubCanvas() };
  _documentInstalled = true;
}

const _pngCache = new Map();
export function loadHullPng(hullId) {
  const def = HULLS[hullId];
  if (!def) throw new Error(`Nieznany kadłub ${hullId}`);
  if (_pngCache.has(hullId)) return _pngCache.get(hullId);
  const png = decodePng(readFileSync(resolve(repo, def.spritePath)));
  _pngCache.set(hullId, png);
  return png;
}

const _renderCache = new Map();
// Kanwa renderu jak w grze (rozmiar z getHullRenderSize). Obraz jest stały per
// kadłub — tak jak NPC_HEX_IMAGE_CACHE — więc szablon heksów liczy się raz.
export function getHullRenderRaster(hullId) {
  if (_renderCache.has(hullId)) return _renderCache.get(hullId);
  const def = HULLS[hullId];
  const png = loadHullPng(hullId);
  const size = getHullRenderSize(def.renderProfile, png.width, png.height);
  const rgba = resampleBilinear(png.data, png.width, png.height, size.w, size.h);
  const raster = makeRasterImage(rgba, size.w, size.h, hullId);
  const entry = { raster, png, size };
  _renderCache.set(hullId, entry);
  return entry;
}

/**
 * Nowy kadłub z prawdziwą siatką heksów. `asPlayer` = ścieżka gracza (pos/vel,
 * hull.val/max, isPlayer), inaczej NPC (x/y, hp/maxHp).
 */
export function buildNodeHull(hullId, options = {}) {
  installCanvasDocument();
  const { raster, png, size } = getHullRenderRaster(hullId);
  const entity = makeHullEntity(hullId, options);
  if (entity.isPlayer) { entity.w = size.w; entity.h = size.h; }
  initHexBody(entity, raster);
  if (!entity.hexGrid) throw new Error(`initHexBody nie zbudował siatki (${hullId})`);
  entity.__pngWidth = png.width;
  entity.__pngHeight = png.height;
  entity.__renderSize = size;
  return entity;
}

// Maska alfy PNG przeskalowana do siatki (do analizy głębokości i placementu).
export function getHullAlphaMask(hullId) {
  const { raster } = getHullRenderRaster(hullId);
  const n = raster.width * raster.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = raster.__rgba[i * 4 + 3] >= 40 ? 1 : 0;
  return { mask, width: raster.width, height: raster.height };
}
