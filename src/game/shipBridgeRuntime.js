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

/**
 * Klucz kadłuba z mostkami dla NPC — to samo mapowanie co
 * getEditorShipIdForNpc w npcHardpointRuntime.js (hardpointy i mostki muszą
 * pochodzić z tego samego sprite'a). Gracz podaje klucz jawnie (activeHullId).
 */
export function resolveBridgeHullKey(entity) {
  if (!entity) return null;
  const frame = String(entity.shipFrame || '').toLowerCase();
  if (frame === 'atlas') return 'atlas';
  const type = String(entity.type || '').toLowerCase();
  if (type === 'atlas') return 'atlas';
  if (type === 'battleship') return entity.isPirate ? 'pirate_battleship' : 'battleship';
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
export function attachEntityBridges(entity, { key = resolveBridgeHullKey(entity), bridges = null, variant = null } = {}) {
  if (!entity) return null;
  const list = Array.isArray(bridges) && bridges.length ? bridges : resolveBridgeLayout(key, variant);
  if (!list || !entity.hexGrid) {
    if (entity.bridgeState) releaseShipBridges(entity);
    return null;
  }
  return attachShipBridges(entity, list, {
    scaleX: entity.__hardpointScaleX,
    scaleY: entity.__hardpointScaleY,
    windowColor: BRIDGE_LAYOUT_PROPOSALS[key]?.windowColor
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
