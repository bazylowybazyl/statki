// Kadłuby belkowe z PRAWDZIWYCH sprite'ów do testów rdzenia (src/game/reactorCore.js): obraz
// w rozmiarze renderu (getHullRenderSize — to samo, co gra robi płótnem w getNpcHexInitSource),
// HullBodies.createHull i rdzenie z danych dema (dema/rdzen-hulls-data.js — markery PNG).
// Wymaga globalThis.window przed importem hullBodies (window.wrecks).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPng } from '../../scripts/webgpu/png.mjs';
import { getHullRenderSize } from '../../src/data/ships.js';
import { HULLS } from '../../dema/rdzen-hulls-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function resizeBox(img, tw, th) {
  const { width: sw, height: sh, data: src } = img;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sh / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sw / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * sw + xx) * 4, al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al; n++;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { width: tw, height: th, data: out };
}

const _cache = new Map();

/** Obraz fizyki kadłuba dema (rozmiar renderu) + rozmiar PNG. */
export function hullImage(hullId) {
  if (_cache.has(hullId)) return _cache.get(hullId);
  const def = HULLS[hullId];
  const png = readPng(join(ROOT, def.spritePath));
  const size = getHullRenderSize(def.renderProfile, png.width, png.height);
  const out = { image: resizeBox(png, size.w, size.h), pngWidth: png.width, pngHeight: png.height, def };
  _cache.set(hullId, out);
  return out;
}

/** Encja NPC z kadłubem belkowym z danych dema (bez rdzeni — montuje je test). */
export function makeBeamShip(HullBodies, hullId, x = 0, y = 0, angle = 0) {
  const { image, def } = hullImage(hullId);
  const e = {
    x, y, vx: 0, vy: 0, angle, angVel: 0, mass: def.mass, hp: def.hull, maxHp: def.hull,
    type: def.npcType, shipFrame: def.renderProfile, __hullId: hullId, faction: def.faction
  };
  HullBodies.createHull(e, image);
  return e;
}
