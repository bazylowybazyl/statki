// Kadłuby i układy scen dema rdzenia (przeglądarka). Ścieżka jak w grze:
//   NPC:   sprite → kanwa getHullRenderSize (getNpcHexInitSource) → initHexBody,
//          hexGrid.visualImage = sprite (drawNPCPretty), prewarmHexShipVisual;
//   gracz: sprite → kanwa renderu (getPlayerHullRenderImage) → initHexBody,
//          visualImage = sprite + flagi odświeżenia (shipSprite.onload).
import { initHexBody } from '../src/game/destructor.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { prewarmHexShipVisual } from '../src/3d/hexShips3D.js';
import { attachShipCores } from '../src/game/shipCore.js';
import { HULLS, REACTOR_COLORS, makeHullEntity } from './rdzen-hulls-data.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import bellatorUrl from '../src/assets/ships/terranbattleship.png';
import skullUrl from '../src/assets/ships/piratebattleship.png';

const SPRITE_URLS = { atlas: atlasUrl, battleship: bellatorUrl, pirate_battleship: skullUrl };
const assets = new Map();

export async function loadHullAssets() {
  await Promise.all(Object.keys(SPRITE_URLS).map(async (id) => {
    if (assets.has(id)) return;
    const def = HULLS[id];
    const img = new Image();
    img.src = SPRITE_URLS[id];
    await img.decode();
    const size = getHullRenderSize(def.renderProfile, img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    assets.set(id, { img, canvas, size });
  }));
  return assets;
}

export function getHullAsset(id) {
  return assets.get(id) || null;
}

export function reactorColorFor(entity) {
  return REACTOR_COLORS[entity?.faction] || REACTOR_COLORS.terran;
}

/**
 * @param {string} hullId
 * @param {object} o { x, y, angle, markers, killMode, coreConfig, shieldOn, label, asPlayer }
 */
export function createShip(hullId, o = {}) {
  const a = assets.get(hullId);
  if (!a) throw new Error(`Brak sprite'a ${hullId}`);
  const e = makeHullEntity(hullId, { ...o, noSplit: false });
  if (e.isPlayer) { e.w = a.size.w; e.h = a.size.h; }
  initHexBody(e, a.canvas);
  if (!e.hexGrid) throw new Error(`initHexBody bez siatki: ${hullId}`);
  e.hexGrid.visualImage = a.img;
  if (e.isPlayer) {
    e.hexGrid.meshDirty = true;
    e.hexGrid.meshDirtyAll = true;
    e.hexGrid.textureDirty = true;
    e.hexGrid.cacheDirty = true;
    e.hexGrid.gpuTextureNeedsUpdate = true;
  }
  prewarmHexShipVisual(a.img);
  e.__pngWidth = a.img.naturalWidth;
  e.__pngHeight = a.img.naturalHeight;
  e.__renderSize = a.size;
  e.__spawn = { x: e.x, y: e.y, angle: e.angle };
  const markers = o.markers || HULLS[hullId].cores;
  attachShipCores(e, markers, {
    pngWidth: e.__pngWidth,
    pngHeight: e.__pngHeight,
    killMode: o.killMode,
    config: o.coreConfig || null,
    color: reactorColorFor(e)
  });
  return e;
}

// Buduje ciało jak createShip, ale bez prewarm/visualImage — dla benchmarku
// w przeglądarce (niewidoczne encje, deterministyczne).
export function buildBrowserHull(hullId, o = {}) {
  const a = assets.get(hullId);
  const e = makeHullEntity(hullId, o);
  if (e.isPlayer) { e.w = a.size.w; e.h = a.size.h; }
  initHexBody(e, a.canvas);
  e.__pngWidth = a.img.naturalWidth;
  e.__pngHeight = a.img.naturalHeight;
  return e;
}

// Układy: [{ hullId, x, y, angle, label }], kamera { x, y, zoom } dobiera demo.
export const SCENES = Object.freeze({
  battleship: { label: 'Bellator', ships: [{ hullId: 'battleship', x: 0, y: 0, angle: 0 }] },
  pirate_battleship: { label: 'Iron Skull', ships: [{ hullId: 'pirate_battleship', x: 0, y: 0, angle: 0 }] },
  atlas: { label: 'Atlas (gracz)', ships: [{ hullId: 'atlas', x: 0, y: 0, angle: 0 }] },
  trio: {
    label: 'Trzy obok siebie',
    ships: [
      { hullId: 'battleship', x: -1480, y: 0, angle: 0 },
      { hullId: 'pirate_battleship', x: -520, y: 0, angle: 0 },
      { hullId: 'atlas', x: 1000, y: 0, angle: 0 }
    ]
  },
  // Ciasno: dwa Bellatory rufa w rufę (rdzenie ~380 j. od siebie), nad i pod
  // nimi Iron Skulle — AoE, krater od strony wybuchu i fala na komory.
  formation: {
    label: 'Formacja',
    ships: [
      { hullId: 'battleship', x: 0, y: 0, angle: 0, label: 'Bellator A' },
      { hullId: 'battleship', x: -720, y: 0, angle: Math.PI, label: 'Bellator B' },
      { hullId: 'pirate_battleship', x: -330, y: 480, angle: 0, label: 'Iron Skull C' },
      { hullId: 'pirate_battleship', x: -330, y: -480, angle: 0, label: 'Iron Skull D' }
    ]
  }
});

export function sceneBounds(ships) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of ships) {
    const r = Number(s.radius) || 300;
    minX = Math.min(minX, s.x - r); maxX = Math.max(maxX, s.x + r);
    minY = Math.min(minY, s.y - r); maxY = Math.max(maxY, s.y + r);
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}
