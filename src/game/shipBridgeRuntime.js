// Mostki w grze — klej między index.html a shipBridge.js.
//
// Który kadłub ma mostki i w jakim układzie, podpięcie po initHexBody, hulk po
// utracie dowodzenia (agonia: bez AI, broni i ciągu, tylko dryf; po
// BRIDGE_KILL_TIMELINE.sequenceEnd gra zamienia go we wrak) i stan wizualny
// hulka. Bez DOM i bez three — ścieżki śmierci (wrak, reputacja, gracz) zostają
// w index.html. Integracja: docs/PORT-mostki.md.

import {
  BRIDGE_EVENT,
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  applyCommandLossVisuals,
  attachShipBridges,
  bridgePngToWorld,
  commandLossAge,
  getBridgeAimPoint,
  noteBridgeHit,
  releaseShipBridges,
  stepCommandLossDrift,
  updateShipBridges
} from './shipBridge.js';

export { BRIDGE_EVENT, bridgePngToWorld, getBridgeAimPoint, noteBridgeHit, updateShipBridges, releaseShipBridges };

/** Długość agonii hulka [s] — od utraty dowodzenia do zamiany we wrak. */
export const BRIDGE_HULK_SEC = BRIDGE_KILL_TIMELINE.sequenceEnd;

// Klucz mostków = klucz edytora hardpointów (ten sam sprite). Gracz ma własne
// id kadłubów (playerHullCatalog: carrier, supercapital, corvus na sprite'cie
// Custosa), profile renderu mają prefiks terran_.
const BRIDGE_HULL_ALIASES = Object.freeze({
  player: 'atlas',
  terran_frigate: 'frigate',
  corvus: 'frigate',
  terran_destroyer: 'destroyer',
  terran_battleship: 'battleship',
  carrier: 'terran_carrier',
  supercapital: 'terran_supercapital'
});

/** Klucz gracza / profilu renderu → klucz BRIDGE_LAYOUT_PROPOSALS. */
export function normalizeBridgeHullKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return null;
  return BRIDGE_HULL_ALIASES[k] || k;
}

/**
 * Klucz kadłuba z mostkami dla NPC — to samo mapowanie co
 * getEditorShipIdForNpc w npcHardpointRuntime.js (hardpointy i mostki muszą
 * pochodzić z tego samego sprite'a). Gracz podaje klucz jawnie (activeHullId).
 * Megafrachtowiec: mostek ma tylko lokomotywa — wagony i moduł ogonowy to
 * osobne encje ładunku (towTrainRole), ich utrata nie zabija składu.
 */
export function resolveBridgeHullKey(entity) {
  if (!entity) return null;
  const type = String(entity.type || '').toLowerCase();
  if (type.startsWith('megafreighter')) {
    return (type === 'megafreighter' || type === 'megafreighter_front') ? 'megafreighter' : null;
  }
  const frame = normalizeBridgeHullKey(entity.shipFrame);
  if (frame && BRIDGE_LAYOUT_PROPOSALS[frame]) return frame;
  if (type === 'atlas') return 'atlas';
  if (type === 'supercapital') return 'terran_supercapital';
  if (type === 'carrier') return 'terran_carrier';
  if (type === 'battleship') return entity.isPirate ? 'pirate_battleship' : 'battleship';
  if (type === 'destroyer') return entity.isPirate ? 'pirate_destroyer' : 'destroyer';
  if (type.includes('frigate')) return entity.isPirate ? 'pirate_frigate' : 'frigate';
  return null;
}

/** Układ stref dla kadłuba (px PNG) albo null, gdy kadłub mostków nie ma. */
export function resolveBridgeLayout(key, variant = null) {
  const entry = key ? BRIDGE_LAYOUT_PROPOSALS[key] : null;
  if (!entry) return null;
  return entry.variants[variant || entry.defaultVariant] || null;
}

/**
 * Po initHexBody: znakuje heksy stref i nakłada pancerz. `bridges` — lista z
 * konfiguracji edytora (gdy kiedyś będzie), inaczej domyślny wariant z
 * BRIDGE_LAYOUT_PROPOSALS. Skala stref = skala hardpointów (render px / PNG px).
 */
export function attachEntityBridges(entity, { key: keyIn = null, bridges = null, variant = null } = {}) {
  if (!entity) return null;
  const key = keyIn != null ? normalizeBridgeHullKey(keyIn) : resolveBridgeHullKey(entity);
  const list = Array.isArray(bridges) && bridges.length ? bridges : resolveBridgeLayout(key, variant);
  if (!list || !entity.hexGrid) {
    if (entity.bridgeState) releaseShipBridges(entity);
    return null;
  }
  return attachShipBridges(entity, list, {
    scaleX: entity.__hardpointScaleX,
    scaleY: entity.__hardpointScaleY,
    windowColor: BRIDGE_LAYOUT_PROPOSALS[key]?.windowColor,
    hullKey: key
  });
}

/** Hulk = statek po utracie dowodzenia, jeszcze nie wrak. */
export function isBridgeHulk(entity) {
  return entity?.bridgeState?.commandLost === true;
}

/**
 * Chwila utraty dowodzenia: zapamiętuje ciąg dysz (dławienie zaczyna od tego
 * poziomu) i gasi tarczę — bez zasilania pole nie wstaje.
 */
export function beginBridgeHulk(entity) {
  if (!entity) return;
  const main = entity.visual?.mainThrusters;
  let sum = 0;
  let n = 0;
  if (Array.isArray(main)) {
    for (let i = 0; i < main.length; i++) {
      const v = Number(main[i]?.__throttle);
      if (Number.isFinite(v)) { sum += v; n++; }
    }
  }
  entity.__bridgeBaseThrottle = Math.max(0.35, Math.min(1, n ? sum / n : 0.6));
  const shield = entity.shield;
  if (shield) {
    shield.val = 0;
    shield.regenTimer = Number.POSITIVE_INFINITY;
  }
}

/**
 * Krok fizyki hulka ZAMIAST AI i modelu lotu: reakcja strumienia atmosfery,
 * tłumienie (semantyka stepDecay120) i całkowanie ruchu. Zwraca true, gdy
 * agonia się skończyła — wtedy index.html robi z hulka wrak.
 */
export function stepBridgeHulk(entity, dt, nowSec) {
  if (!isBridgeHulk(entity)) return false;
  stepCommandLossDrift(entity, dt, nowSec);
  const vx = Number(entity.vx);
  const vy = Number(entity.vy);
  const w = Number(entity.angVel);
  entity.vx = Number.isFinite(vx) ? vx : 0;
  entity.vy = Number.isFinite(vy) ? vy : 0;
  entity.angVel = Number.isFinite(w) ? w : 0;
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;
  entity.angle = (Number(entity.angle) || 0) + entity.angVel * dt;
  return commandLossAge(entity, nowSec) >= BRIDGE_HULK_SEC;
}

/**
 * Raz na klatkę renderu, przed updateHexShips3D: dławienie dysz i gaśnięcie
 * świateł pozycyjnych hulków (dane czytane przez EngineVfxSystem / ShipLights3D).
 */
export function applyBridgeHulkVisuals(entities, nowSec) {
  if (!Array.isArray(entities)) return;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!isBridgeHulk(e) || e.dead) continue;
    applyCommandLossVisuals(e, nowSec, { baseThrottle: e.__bridgeBaseThrottle ?? 0.6 });
  }
}
