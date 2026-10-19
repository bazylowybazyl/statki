// Harness strzału wiązką: fireWeaponCore wycięty z index.html, prawdziwe
// kadłuby na belkach (HullBodies), prawdziwe tarcze (shieldSystem) i sztuczny świat.
// Loguje wszystko, co strzał robi na zewnątrz (wiązka 2D, kratery w kadłubie — wpis 'hex',
// obrażenia, efekty tarczy, zdarzenie 3D), żeby porównywać ścieżki strzału
// scenariusz po scenariuszu. Gettery `window.npcs/stations/wrecks` liczą dostępy
// (szybka ścieżka PD nie może skanować świata).

import { MASTER_WEAPONS, shieldImpactClass } from '../../src/data/weapons.js';
import { isTargetAlive, targetPoint as scannerTargetPoint, getTargetX, getTargetY } from '../../src/game/scannerTargeting.js';
import { HullBodies } from '../../src/game/hullBodies.js';
import { isEntityShieldBlocking, getEntityShieldBlockingRadius, getEntityShieldRayEnter } from '../../shieldSystem.js';
import { spatialCellKey } from '../../src/game/spatialCellKey.js';
import { createPdBeamHit, resolvePdBeamHit } from '../../src/game/pdBeamFastPath.js';
import { isPointDefenseWeapon } from '../../src/ai/pointDefenseTargeting.js';
import { readIndexHtml, sliceFunction } from './indexSource.mjs';
import { CARRIER_SCOPE } from './carrierScope.mjs';
import { beamPassesAlly, projectilePassesAlly } from '../../src/game/friendlyFire.js';

// Pomocniki modułowe wiązki (po refaktorze) stoją między tym znacznikiem
// a fireWeaponCore; przed refaktorem znacznika nie ma i bierzemy samą funkcję.
export const BEAM_HELPERS_MARKER = '// --- Trafienia wiązek: pomocniki modułowe';
const FIRE_CORE_HEADER = 'window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {';

function extractFireRegion(html) {
  const fire = sliceFunction(html, FIRE_CORE_HEADER);
  const markerAt = html.indexOf(BEAM_HELPERS_MARKER);
  const fireAt = html.indexOf(FIRE_CORE_HEADER);
  if (markerAt < 0 || markerAt > fireAt) return fire;
  return html.slice(markerAt, fireAt) + fire;
}

const r1 = (v) => Math.round(v * 10) / 10;

export function createBeamHarness({ html = readIndexHtml(), extraScope = {} } = {}) {
  const log = [];
  const counters = { npcs: 0, stations: 0, wrecks: 0 };
  const world = { ship: null, npcs: [], stations: [], wrecks: [], platforms: [], ring: [] };
  let clock = 1000;
  const name = (e) => (e ? (e.__name || e.id || '?') : null);

  const win = {
    get npcs() { counters.npcs++; return world.npcs; },
    get stations() { counters.stations++; return world.stations; },
    get wrecks() { counters.wrecks++; return world.wrecks; },
    get ship() { return world.ship; },
    player2Ship: null,
    mercMission: { weaponPlatforms: world.platforms },
    __frameId: 1,
    getLeadAim: (from, target) => ({ x: target.x, y: target.y }),
    spawnWeaponImpactFromPreset: (type, color, scale, x, y) => log.push(['impactFx', type, r1(x), r1(y)]),
    // Stary kontrakt (przed szyną strzałów): zdarzenie DOM per strzał.
    dispatchEvent(ev) {
      logShot(ev.detail || {});
      return true;
    }
  };

  // Wiązka: [startX, startY, endX, endY, width, mode, emitterUid, kind] — kind ('continuous' |
  // 'pulse' | 'pd') wybiera efekt w WeaponFx (zadanie 17).
  function logShot(d) {
    const b = d.beam;
    log.push(['event', 'game_weapon_fired', d.weaponId, d.isBeam, d.beamMode,
      b ? [r1(b.startX), r1(b.startY), r1(b.endX), r1(b.endY), b.width, b.mode, b.emitterUid, b.kind] : null]);
  }

  class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }

  const scope = {
    ...CARRIER_SCOPE,
    window: win,
    MASTER_WEAPONS,
    isTargetAlive,
    scannerTargetPoint,
    getTargetX,
    getTargetY,
    shipModes: { wheel: { open: false } },
    mouse: { x: 0, y: 0 },
    isFlakWeapon: () => false,
    resolveFlakProfile: () => null,
    flakFuseTime: () => 0,
    FLAK_TUNING: {},
    mercMission: null,
    HullBodies,
    spatialCellKey,
    getEntityShieldBlockingRadius,
    getEntityShieldRayEnter,
    createPdBeamHit,
    resolvePdBeamHit,
    isPointDefenseWeapon,
    spawnLaserBeam: (a, b, w) => log.push(['beam2d', r1(a.x), r1(a.y), r1(b.x), r1(b.y), w]),
    // Krater: kadłub, punkt, obrażenia i źródło stempla mapy ran (id broni — szósty argument applyHexImpact).
    applyHexImpact: (e, x, y, dmg, vel, fxSource) => log.push(['hex', name(e), r1(x), r1(y), dmg, fxSource?.id ?? null]),
    noteBridgeHit: () => {},
    bridgeSimTime: 0,
    isEntityShieldBlocking,
    beamPassesAlly,
    projectilePassesAlly,
    registerShieldImpact: (e, x, y, dmg, cls) => log.push(['shieldFx', name(e), r1(x), r1(y), dmg, cls]),
    shieldImpactClass,
    applyDamageToPlayer: (d) => log.push(['dmgPlayer', d]),
    applyDamageToNPC: (e, d, src) => log.push(['dmgNpc', name(e), d, src]),
    applyDamageToStation: (e, d) => log.push(['dmgStation', name(e), d]),
    applyDamageToPlatform: (e, d) => log.push(['dmgPlatform', name(e), d]),
    CanvasVFX: { spawnWeaponImpactFromPreset: () => {} },
    triggerMercAggro: () => {},
    markPlayerDamage: () => {},
    performance: { now: () => clock },
    CustomEvent: FakeCustomEvent,
    // Szyna strzałów (src/game/weaponShotBus.js) — ten sam wpis w logu co zdarzenie.
    WeaponShotBus: {
      emit: (weaponId, shooter, x, y, isBeam, beamMode, beam) => logShot({ weaponId, shooter, x, y, isBeam, beamMode, beam })
    },
    ...extraScope
  };

  const fireWeaponCore = new Function('__scope',
    `with (__scope) {\n${extractFireRegion(html)}\nreturn window.fireWeaponCore;\n}`)(scope);

  return {
    world,
    log,
    counters,
    scope,
    fire(shooter, target, weaponId, muzzle) {
      log.length = 0;
      fireWeaponCore(shooter, target, weaponId, muzzle);
      clock += 16;
      win.__frameId += 1;
      return log.slice();
    }
  };
}

// Kadłub na belkach z tarczą (opcjonalnie) — prawdziwy HullBodies.createHull z pełnej płyty w×h.
function hullPlate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

export function makeHullTarget(name, { x, y, angle = 0, width = 160, height = 60, shield = 0, ...rest } = {}) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 50000, ...rest };
  HullBodies.createHull(e, hullPlate(width, height));
  e.__name = name;
  e.hp = 1000;
  e.maxHp = 1000;
  e.radius = Math.max(width, height) * 0.5;
  if (shield > 0) e.shield = { val: shield, max: shield, state: 'active', activationProgress: 1 };
  return e;
}

export function makeCircleTarget(name, { x, y, radius = 20, shield = 0, ...rest } = {}) {
  const e = { __name: name, x, y, radius, hp: 100, maxHp: 100, angle: 0, ...rest };
  if (shield > 0) e.shield = { val: shield, max: shield, state: 'active', activationProgress: 1 };
  return e;
}

// Deterministyczny Math.random na czas bloku.
export function withSeededRandom(seed, fn) {
  const saved = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}
