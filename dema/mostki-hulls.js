// Demo mostków — katalog kadłubów i budowa encji jak w grze (bez DOM).
//
// Kadłub powstaje tą samą drogą co NPC w grze (drawNPCPretty ~21832):
// rozmiar renderu z getHullRenderSize, skala hardpointów = render / PNG,
// układ z edytora (createNpcHardpointRuntime.applyLayoutToNpc — hardpointy,
// silniki, światła), potem initHexBody na obrazie renderu. Obraz dostarcza
// wołający: w przeglądarce kanwa, w Node (benchmark) zdekodowany PNG.

import { initHexBody } from '../src/game/destructor.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { BRIDGE_LAYOUT_PROPOSALS, attachShipBridges } from '../src/game/shipBridge.js';

export const HULLS = Object.freeze({
  battleship: Object.freeze({
    key: 'battleship',
    label: 'Bellator',
    faction: 'Terra',
    png: new URL('../src/assets/ships/terranbattleship.png', import.meta.url).href,
    pngW: 1158,
    pngH: 714,
    profile: 'terran_battleship',
    npc: { type: 'battleship', isPirate: false, shipFrame: 'terran_battleship', mass: 50000, rammingMass: 8000 }
  }),
  pirate_battleship: Object.freeze({
    key: 'pirate_battleship',
    label: 'Iron Skull',
    faction: 'Piraci',
    png: new URL('../src/assets/ships/piratebattleship.png', import.meta.url).href,
    pngW: 1727,
    pngH: 911,
    profile: 'pirate_battleship',
    npc: { type: 'battleship', isPirate: true, shipFrame: 'pirate_battleship', mass: 50000, rammingMass: 8000 }
  }),
  atlas: Object.freeze({
    key: 'atlas',
    label: 'Atlas',
    faction: 'Gracz',
    png: new URL('../assets/capital_ship_rect_v1.png', import.meta.url).href,
    pngW: 3747,
    pngH: 1677,
    profile: 'atlas',
    // Atlas jest statkiem gracza; w demie jedzie ścieżką NPC (typ 'atlas'
    // → klucz edytora 'atlas'), a pula i reguły są gracza (HULL_POOLS).
    npc: { type: 'atlas', isPirate: false, shipFrame: 'atlas', mass: 800000, rammingMass: 800000 }
  }),
  // Reszta floty z mostkami (docs/PORT-mostki.md §2, §8).
  frigate: Object.freeze({
    key: 'frigate',
    label: 'Custos',
    faction: 'Terra',
    png: new URL('../src/assets/ships/terranfrigate.png', import.meta.url).href,
    pngW: 2400,
    pngH: 1792,
    profile: 'terran_frigate',
    npc: { type: 'frigate', isPirate: false, shipFrame: 'terran_frigate', mass: 10000, rammingMass: 1200 }
  }),
  destroyer: Object.freeze({
    key: 'destroyer',
    label: 'Hasta',
    faction: 'Terra',
    png: new URL('../src/assets/ships/terrandestroyer.png', import.meta.url).href,
    pngW: 768,
    pngH: 573,
    profile: 'terran_destroyer',
    npc: { type: 'destroyer', isPirate: false, shipFrame: 'terran_destroyer', mass: 25000, rammingMass: 5000 }
  }),
  terran_carrier: Object.freeze({
    key: 'terran_carrier',
    label: 'Citadella',
    faction: 'Terra',
    png: new URL('../src/assets/ships/terrancarrier.png', import.meta.url).href,
    pngW: 1672,
    pngH: 941,
    profile: 'terran_carrier',
    npc: { type: 'carrier', isPirate: false, shipFrame: 'terran_carrier', mass: 200000, rammingMass: 60000 }
  }),
  terran_supercapital: Object.freeze({
    key: 'terran_supercapital',
    label: 'Colossus',
    faction: 'Terra',
    png: new URL('../src/assets/ships/terransupercapital.png', import.meta.url).href,
    pngW: 1672,
    pngH: 941,
    profile: 'terran_supercapital',
    npc: { type: 'supercapital', isPirate: false, shipFrame: 'terran_supercapital', mass: 400000, rammingMass: 120000 }
  }),
  pirate_frigate: Object.freeze({
    key: 'pirate_frigate',
    label: 'Fregata piratów',
    faction: 'Piraci',
    png: new URL('../src/assets/ships/piratefrigate.png', import.meta.url).href,
    pngW: 1942,
    pngH: 809,
    profile: 'pirate_frigate',
    npc: { type: 'frigate', isPirate: true, shipFrame: 'pirate_frigate', mass: 10000, rammingMass: 1200 }
  }),
  pirate_destroyer: Object.freeze({
    key: 'pirate_destroyer',
    label: 'Niszczyciel piratów',
    faction: 'Piraci',
    png: new URL('../src/assets/ships/piratedestroyer.png', import.meta.url).href,
    pngW: 1840,
    pngH: 854,
    profile: 'pirate_destroyer',
    npc: { type: 'destroyer', isPirate: true, shipFrame: 'pirate_destroyer', mass: 25000, rammingMass: 5000 }
  }),
  megafreighter: Object.freeze({
    key: 'megafreighter',
    label: 'Megafrachtowiec (lokomotywa)',
    faction: 'Cywilni',
    png: new URL('../assets/megafreighterfront.png', import.meta.url).href,
    pngW: 1672,
    pngH: 941,
    profile: 'megafreighter',
    // Lokomotywa składu: typ modułu jak w grze (configureMegafreighterModule).
    npc: { type: 'megafreighter_front', isPirate: false, shipFrame: 'megafreighter', mass: 900000, rammingMass: 900000 }
  })
});

export const HULL_ORDER = Object.freeze(['atlas', 'battleship', 'pirate_battleship', 'frigate', 'destroyer', 'terran_carrier', 'terran_supercapital', 'pirate_frigate', 'pirate_destroyer', 'megafreighter']);

/** Rozmiar obrazu renderu (tak jak getNpcHexInitSource w grze). */
export function hullRenderSize(key) {
  const h = HULLS[key];
  const size = getHullRenderSize(h.profile, h.pngW, h.pngH);
  return { w: Math.max(64, size.w), h: Math.max(64, size.h), scaleX: Math.max(64, size.w) / h.pngW, scaleY: Math.max(64, size.h) / h.pngH };
}

let _layoutRuntime = null;
function layoutRuntime() {
  // Klucz localStorage celowo nieistniejący: demo pokazuje układ z KODU
  // (hardpointEditorDefaults), nie zapis edytora gracza (hpEditor.v1).
  if (!_layoutRuntime) {
    _layoutRuntime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships, storageKey: 'mostkiDemo.noEditorSave' });
    _layoutRuntime.refreshCache(true);
  }
  return _layoutRuntime;
}

/** Warianty mostków danego kadłuba (propozycje z shipBridge.js). */
export function bridgeVariants(key) {
  return BRIDGE_LAYOUT_PROPOSALS[key]?.variants || {};
}

export function defaultBridgeVariant(key) {
  return BRIDGE_LAYOUT_PROPOSALS[key]?.defaultVariant || Object.keys(bridgeVariants(key))[0];
}

/**
 * Buduje encję kadłuba. `renderImage` — obraz w rozmiarze renderu (to samo,
 * co gra podaje do initHexBody), `visualImage` — oryginalny PNG (tekstura 3D).
 * Nie podpina mostków — robi to attachHullBridges (edytor przestawia strefy).
 */
export function buildHullEntity(key, { renderImage, visualImage = null, x = 0, y = 0, angle = 0 } = {}) {
  const h = HULLS[key];
  if (!h) throw new Error(`nieznany kadłub ${key}`);
  const size = hullRenderSize(key);
  const e = {
    id: `mostki_${key}_${Math.random().toString(36).slice(2, 7)}`,
    x, y, vx: 0, vy: 0, angle, angVel: 0,
    type: h.npc.type,
    isPirate: h.npc.isPirate,
    shipFrame: h.npc.shipFrame,
    mass: h.npc.mass,
    rammingMass: h.npc.rammingMass,
    friction: 0.99,
    isCapitalShip: true,
    noSplit: false,
    __hardpointScaleX: size.scaleX,
    __hardpointScaleY: size.scaleY,
    __hardpointScale: (size.scaleX + size.scaleY) * 0.5,
    hullKey: key,
    displayName: h.label
  };
  layoutRuntime().applyLayoutToNpc(e);
  initHexBody(e, renderImage);
  if (!e.hexGrid) throw new Error(`initHexBody nie zbudował siatki dla ${key}`);
  if (visualImage) e.hexGrid.visualImage = visualImage;
  e.w = size.w;
  e.h = size.h;
  return e;
}

/** Podpina mostki wariantu (albo własnej listy z edytora) do świeżej encji. */
export function attachHullBridges(entity, list, opts = {}) {
  const key = entity.hullKey;
  return attachShipBridges(entity, list, {
    scaleX: entity.__hardpointScaleX,
    scaleY: entity.__hardpointScaleY,
    windowColor: BRIDGE_LAYOUT_PROPOSALS[key]?.windowColor,
    hullKey: key,
    ...opts
  });
}
