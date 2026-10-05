// Świat dema mostków na belkach: kadłuby ze sprite'ów gry (HullBodies — jak index.html: sprite →
// kanwa w rozmiarze renderu → createHull), układ z edytora (dysze, światła pozycyjne — gasną
// w agonii), mostki (shipBridgeRuntime → shipBridgeBeams.js), krok fizyki 120 Hz jak physicsStep
// gry (ruch → pociski → silnik belek → kadencja mostków co 3. podkrok) i agonia hulka → wrak
// (jak finishBridgeKill w index.html: cały ocalały kadłub zostaje wrakiem-łupem, bez wybuchu).
import { HullBodies } from '../../src/game/hullBodies.js';
import { getHullRenderSize } from '../../src/data/ships.js';
import { prewarmHexShipVisual } from '../../src/3d/hexShips3D.js';
import { SimClock } from '../../src/game/simClock.js';
import { stepDecay120 } from '../../src/game/stepDecay.js';
import { SHIP_EDITOR_DEFAULTS } from '../../src/data/hardpointEditorDefaults.js';
import { createNpcHardpointRuntime } from '../../src/game/npcHardpointRuntime.js';
import {
  BRIDGE_EVENT,
  BRIDGE_HULK_SEC,
  attachEntityBridges,
  beginBridgeHulk,
  isBridgeHulk,
  releaseShipBridges,
  stepBridgeHulk,
  updateShipBridges
} from '../../src/game/shipBridgeRuntime.js';
import { bridgeCellNode } from '../../src/game/shipBridgeBeams.js';
import { BRIDGE_DEMO_HULLS } from './kadluby.js';
import atlasUrl from '../../assets/capital_ship_rect_v1.png';
import bellatorUrl from '../../src/assets/ships/terranbattleship.png';
import skullUrl from '../../src/assets/ships/piratebattleship.png';
import custosUrl from '../../src/assets/ships/terranfrigate.png';
import hastaUrl from '../../src/assets/ships/terrandestroyer.png';
import citadellaUrl from '../../src/assets/ships/terrancarrier.png';
import colossusUrl from '../../src/assets/ships/terransupercapital.png';
import pirateFrigateUrl from '../../src/assets/ships/piratefrigate.png';
import pirateDestroyerUrl from '../../src/assets/ships/piratedestroyer.png';
import pirateCapitalUrl from '../../src/assets/ships/piratecapital.png';
import locoUrl from '../../assets/megafreighterfront.png';

// Adresy sprite'ów przez import (Vite — dev i build); ścieżki w kadluby.js są dla Node (testy).
const SPRITE_URLS = {
  atlas: atlasUrl, battleship: bellatorUrl, pirate_battleship: skullUrl, frigate: custosUrl, destroyer: hastaUrl,
  terran_carrier: citadellaUrl, terran_supercapital: colossusUrl, pirate_frigate: pirateFrigateUrl,
  pirate_destroyer: pirateDestroyerUrl, pirate_supercapital: pirateCapitalUrl, megafreighter: locoUrl
};

const assets = new Map();

/** Sprite'y kadłubów (raz): obraz PNG (tekstura skóry) i kanwa w rozmiarze renderu (fizyka). */
export async function loadHullAssets(keys) {
  await Promise.all(keys.map(async (key) => {
    if (assets.has(key)) return;
    const def = BRIDGE_DEMO_HULLS[key];
    const img = new Image();
    img.src = SPRITE_URLS[key];
    await img.decode();
    const size = getHullRenderSize(def.profile, img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(64, Math.round(size.w));
    canvas.height = Math.max(64, Math.round(size.h));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    assets.set(key, { img, canvas });
    prewarmHexShipVisual(img);
  }));
  return assets;
}

let _layout = null;
function layoutRuntime() {
  // Klucz localStorage celowo nieistniejący: demo pokazuje układ z KODU (hardpointEditorDefaults).
  if (!_layout) {
    _layout = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships, storageKey: 'mostkiWebgpu.noEditorSave' });
    _layout.refreshCache(true);
  }
  return _layout;
}

let _uid = 0;

/** Okręt NPC z kadłubem belkowym, dyszami i światłami z edytora oraz mostkami. */
export function createShip(key, o = {}) {
  const a = assets.get(key);
  const def = BRIDGE_DEMO_HULLS[key];
  if (!a || !def) throw new Error(`Brak kadłuba ${key}`);
  const kx = a.canvas.width / a.img.naturalWidth;
  const ky = a.canvas.height / a.img.naturalHeight;
  const e = {
    id: `mostek_${key}_${++_uid}`,
    x: Number(o.x) || 0, y: Number(o.y) || 0, vx: Number(o.vx) || 0, vy: Number(o.vy) || 0,
    angle: Number(o.angle) || 0, angVel: Number(o.angVel) || 0,
    mass: def.npc.mass, hp: 12000, maxHp: 12000,
    type: def.npc.type, isPirate: def.npc.isPirate, shipFrame: def.npc.shipFrame,
    isCapitalShip: true, faction: def.faction,
    __hardpointScaleX: kx, __hardpointScaleY: ky, __hardpointScale: (kx + ky) * 0.5,
    __hullKey: key, __label: o.label || def.label, displayName: o.label || def.label,
    visual: { spriteScale: 1 }
  };
  layoutRuntime().applyLayoutToNpc(e);
  HullBodies.createHull(e, a.canvas, { visualImage: a.img, hullProfileId: def.profile });
  if (!e.beamHull) throw new Error(`createHull bez kadłuba: ${key}`);
  attachEntityBridges(e, o.variant ? { variant: o.variant } : {});
  // Dysze na ciągu przelotowym (bez modelu lotu): agonia dławi je od tego poziomu.
  for (const t of e.visual?.mainThrusters || []) t.__throttle = o.throttle ?? 0.55;
  return e;
}

/**
 * Świat: okręty (żywe kadłuby z mostkami, hulki), wraki (window.wrecks — hullBodies dopisuje tam
 * wraki i odłamy), zegar symulacji, zdarzenia mostków.
 */
export class World {
  constructor({ onLog = null, onCommandLost = null } = {}) {
    this.onLog = onLog;
    this.onCommandLost = onCommandLost;
    this.ships = [];
    if (!Array.isArray(window.wrecks)) window.wrecks = [];
    this.wrecks = window.wrecks;
    this.time = 0;
    this.kills = 0;
    this._list = [];
    this._sub = 0;
    this._subDt = 0;
  }

  log(text, cls = '') { this.onLog?.(text, cls); }

  /** Wszystkie encje z kadłubem (okręty + wraki) — tablica współdzielona. */
  entities() {
    const L = this._list;
    L.length = 0;
    for (const s of this.ships) if (HullBodies.hasHull(s)) L.push(s);
    for (const w of this.wrecks) if (w && !w.dead && HullBodies.hasHull(w)) L.push(w);
    return L;
  }

  clear() {
    for (const s of this.ships) { releaseShipBridges(s); HullBodies.release(s); }
    for (const w of this.wrecks) HullBodies.release(w);
    this.ships.length = 0;
    this.wrecks.length = 0;
  }

  add(key, o) {
    const e = createShip(key, o);
    this.ships.push(e);
    return e;
  }

  /** Krok fizyki (120 Hz): ruch (hulk — dryf ze strumienia), pociski, silnik belek, mostki. */
  step(dt, gun = null) {
    this.time += dt;
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const e = this.ships[i];
      if (isBridgeHulk(e)) {
        if (stepBridgeHulk(e, dt, this.time)) this._finishKill(e);
        continue;
      }
      e.x += (e.vx || 0) * dt;
      e.y += (e.vy || 0) * dt;
      e.angle += (e.angVel || 0) * dt;
    }
    for (const w of this.wrecks) {
      if (!w || w.dead) continue;
      const f = stepDecay120(w.friction ?? 0.9986, dt);
      w.vx *= f; w.vy *= f;
      w.angVel = (w.angVel || 0) * f;
      w.x += (w.vx || 0) * dt;
      w.y += (w.vy || 0) * dt;
      w.angle += (w.angVel || 0) * dt;
    }
    SimClock.advance(dt);
    const list = this.entities();
    if (gun) gun.step(dt, list);
    HullBodies.step(dt, this.entities());
    // Kadencja jak updateHardpointIntegrity w grze: co 3. podkrok z akumulowanym dt.
    this._subDt += dt;
    if (++this._sub >= 3) {
      const acc = this._subDt;
      this._sub = 0;
      this._subDt = 0;
      for (const e of this.ships) {
        if (!e.bridgeState || e.dead) continue;
        const flags = updateShipBridges(e, acc, this.time);
        if (flags & BRIDGE_EVENT.COMMAND_LOST) this._commandLost(e);
        else if (flags & BRIDGE_EVENT.BRIDGE_LOST) this.log(`${e.__label}: MOSTEK ZNISZCZONY — dowodzi zapasowy`, 'warn');
      }
    }
    // wraki bez kadłuba (okruchy, zwolnione) — z listy
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (!w || w.dead || !HullBodies.hasHull(w)) this.wrecks.splice(i, 1);
    }
  }

  _commandLost(e) {
    beginBridgeHulk(e);
    this.kills++;
    const by = this.severedCells(e) > 0 ? 'odcięty z kawałkiem kadłuba' : 'zniszczony';
    this.log(`${e.__label}: UTRATA DOWODZENIA (mostek ${by}) — agonia ${BRIDGE_HULK_SEC.toFixed(0)} s`, 'bad');
    this.onCommandLost?.(e);
  }

  /** Komórki mostków encji żywe na INNYM ciele rodu (odłam) — mostek odcięty, nie zniszczony. */
  severedCells(e) {
    const st = e?.bridgeState;
    if (!st || !st.lineage) return 0;
    let n = 0;
    for (const w of this.wrecks) {
      const h = w?.beamHull;
      if (!h || h.dmgKey !== st.lineage || w.dead) continue;
      for (const b of st.bridges) {
        for (let k = 0; k < b.total; k++) if (bridgeCellNode(h, b.cellX[k], b.cellY[k]) >= 0) n++;
      }
    }
    return n;
  }

  // Koniec agonii (jak finishBridgeKill w grze): cały ocalały kadłub zostaje wrakiem, bez wybuchu.
  _finishKill(e) {
    e.dead = true;
    const idx = this.ships.indexOf(e);
    if (idx >= 0) this.ships.splice(idx, 1);
    const wreck = HullBodies.convertToWreck(e);
    releaseShipBridges(e);
    if (wreck) {
      wreck.__label = `${e.__label} (wrak)`;
      this.log(`${e.__label}: wrak — kadłub ${wreck.beamHull.body.activeNodes} węzłów (łup do holowania)`, '');
    }
  }
}
