// Kadłuby belkowe z PRAWDZIWYCH sprite'ów do testów mostków na belkach (src/game/shipBridgeBeams.js):
// obraz w rozmiarze renderu (getHullRenderSize — to samo, co gra robi płótnem w getNpcHexInitSource),
// HullBodies.createHull, obraz PNG jako `visualImage` (skala stref PNG → render jak w grze).
// Wymaga globalThis.window przed importem hullBodies (window.wrecks).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPng } from '../../scripts/webgpu/png.mjs';
import { getHullRenderSize } from '../../src/data/ships.js';
import { BRIDGE_DEMO_HULLS } from '../../dema/mostki-webgpu/kadluby.js';
import { resizeBox } from './reactorHulls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const _cache = new Map();

/** Obraz fizyki kadłuba (rozmiar renderu) + PNG (naturalWidth/Height jak obraz przeglądarki). */
export function bridgeHullImage(key) {
  if (_cache.has(key)) return _cache.get(key);
  const def = BRIDGE_DEMO_HULLS[key];
  if (!def) throw new Error(`nieznany kadłub ${key}`);
  const png = readPng(join(ROOT, def.sprite));
  const size = getHullRenderSize(def.profile, png.width, png.height);
  const w = Math.max(64, Math.round(size.w)), h = Math.max(64, Math.round(size.h));
  const out = {
    image: resizeBox(png, w, h),
    visual: { naturalWidth: png.width, naturalHeight: png.height, width: png.width, height: png.height },
    pngWidth: png.width,
    pngHeight: png.height,
    def
  };
  _cache.set(key, out);
  return out;
}

/** Encja NPC z kadłubem belkowym (bez mostków — montuje je test). */
export function makeBridgeShip(HullBodies, key, x = 0, y = 0, angle = 0) {
  const { image, visual, def } = bridgeHullImage(key);
  const e = {
    x, y, vx: 0, vy: 0, angle, angVel: 0, mass: def.npc.mass, hp: 12000, maxHp: 12000,
    type: def.npc.type, isPirate: def.npc.isPirate, shipFrame: def.npc.shipFrame, __hullKey: key
  };
  HullBodies.createHull(e, image, { visualImage: visual });
  return e;
}
