// src/game/sensorSystem.js
//
// Czujniki gracza: źródła (statek, sondy, drony, stacje czujników), poziom świadomości NPC (`_sensorAwareness` —
// radar kokpitu, CIC, znaczniki krawędzi) i duchy kontaktów. Od 2026-10-04 także MGŁA WOJNY (src/game/fogOfWar.js):
// z mgłą włączoną świadomość = WZROK strony gracza (Atlas, sojusznicy, drony, sondy, stacje) — w zasięgu wzroku
// TRACKED, poza nim duch, potem HIDDEN; `hides(byt)` pyta render, celowanie i HUD. Bez mgły — dawne koło 18 km.
import {
  FOG_KIND, advanceFogClock, clearFogArea, clearMassSignature, collectFogSources, createFogState, createFogWorld,
  exportFogWorld, fogHides, fogPointVisible, getMassSignature, isMassSignatureResolved, revealFogArea, revealFogEntity,
  setMassSignature, stepFogEntities, stepMassSignatures, visionRangeOf
} from './fogOfWar.js';

const fogState = createFogState();
const fogWorld = createFogWorld();

export const SENSOR_CONFIG = {
  shipPassiveRange: 18000,
  shipActiveScanRange: 10000,
  probeRange: 30000,
  probeLifetime: 120,
  probeDeployCooldown: 8,
  maxProbes: 5,
  stationRange: 45000,
  sizeModifiers: { fighter: 0.5, frigate: 0.7, destroyer: 0.85, battleship: 1.0, capital: 1.3, station: 1.5 },
  fog: { fadeDistance: 2000, hiddenAlpha: 0.92, ghostDuration: 8, ghostFadeTime: 3 },
  AWARENESS: { HIDDEN: 0, GHOST: 1, DETECTED: 2, TRACKED: 3 }
};

// --- OBJECT POOLS (ZERO GC ALOCATIONS PER FRAME) ---
const sensorSources = [];
let activeSourceCount = 0;
const ghostContacts = new Map();
const deployedProbes = [];
let probeCooldownTimer = 0;

function getNextSensorSource() {
  if (activeSourceCount >= sensorSources.length) {
    sensorSources.push({ x: 0, y: 0, range: 0, type: '' });
  }
  return sensorSources[activeSourceCount++];
}

// Wykrywalność celu (mnożnik zasięgu czujnika). Eksportowane, bo ten sam
// współczynnik liczy wspólny obraz sytuacji AI (src/ai/fleetAwareness.js) —
// flota NPC i mgła wojny gracza widzą według jednej tabeli.
export function getEntitySizeModifier(entity) {
  if (entity.isCapitalShip) return SENSOR_CONFIG.sizeModifiers.capital;
  const type = String(entity.type || '').toLowerCase();
  if (type in SENSOR_CONFIG.sizeModifiers) return SENSOR_CONFIG.sizeModifiers[type];
  const r = entity.radius || entity.r || 14;
  if (r >= 100) return SENSOR_CONFIG.sizeModifiers.battleship;
  if (r >= 40) return SENSOR_CONFIG.sizeModifiers.frigate;
  if (r >= 20) return SENSOR_CONFIG.sizeModifiers.destroyer;
  return SENSOR_CONFIG.sizeModifiers.fighter;
}

function computeEntityVisibility(entity) {
  const sizeMod = getEntitySizeModifier(entity);
  let bestAwareness = SENSOR_CONFIG.AWARENESS.HIDDEN;
  let bestDist = Infinity;

  for (let i = 0; i < activeSourceCount; i++) {
    const src = sensorSources[i];
    const dx = entity.x - src.x;
    const dy = entity.y - src.y;
    const distSq = dx * dx + dy * dy;
    const effectiveRange = src.range * sizeMod;

    if (distSq <= (effectiveRange * 0.75) ** 2) {
      if (SENSOR_CONFIG.AWARENESS.TRACKED > bestAwareness) {
        bestAwareness = SENSOR_CONFIG.AWARENESS.TRACKED;
        bestDist = Math.sqrt(distSq);
      }
    } else if (distSq <= effectiveRange * effectiveRange) {
      if (SENSOR_CONFIG.AWARENESS.DETECTED > bestAwareness) {
        bestAwareness = SENSOR_CONFIG.AWARENESS.DETECTED;
        bestDist = Math.sqrt(distSq);
      }
    }
  }
  entity._sensorAwareness = bestAwareness;
  entity._sensorDist = bestDist;
}

export const SensorSystem = {
  AWARENESS: SENSOR_CONFIG.AWARENESS,
  config: SENSOR_CONFIG,

  init() {
    activeSourceCount = 0;
    ghostContacts.clear();
    deployedProbes.length = 0;
    probeCooldownTimer = 0;
    // mgła: strefy, sygnatury i zegar od nowa (włączenie zostaje — ustawia je start gry)
    fogState.time = 0;
    fogState.sourceCount = 0;
    fogState.reveals.length = 0;
    fogState.masses.length = 0;
    fogWorld.count = 0;
    fogWorld.massCount = 0;
  },

  // ---------------------------------------------------------------- MGŁA WOJNY (fogOfWar.js)
  fog: fogState,
  fogWorld,
  FOG_KIND,
  /** Mgła włączona (opcja nowej gry / konsola). */
  get fogEnabled() { return !!fogState.enabled; },
  setFogEnabled(on) {
    fogState.enabled = !!on;
    fogWorld.on = !!on;
  },
  /** Czy mgła chowa byt (render, celowanie, HUD). Gracz i sojusznicy nigdy. */
  hides(entity) {
    return fogHides(fogState, entity, typeof window !== 'undefined' ? window.ship : null);
  },
  /** Czy punkt świata leży w zasięgu wzroku strony gracza (bez mgły — zawsze). */
  pointVisible(x, y, margin = 0) {
    return !fogState.enabled || fogPointVisible(fogState, x, y, margin);
  },
  visionRangeOf,
  revealArea(id, x, y, r, sec) { return revealFogArea(fogState, id, x, y, r, sec); },
  clearArea(id) { clearFogArea(fogState, id); },
  revealEntity(entity, sec) { revealFogEntity(fogState, entity, sec); },
  setMassSignature(id, spec) { return setMassSignature(fogState, id, spec); },
  clearMassSignature(id) { clearMassSignature(fogState, id); },
  getMassSignature(id) { return getMassSignature(fogState, id); },
  isMassResolved(id) { return isMassSignatureResolved(fogState, id); },
  getMassSignatures() { return fogState.masses; },

  getProbes() { return deployedProbes; },
  getGhosts() { return ghostContacts; },
  getProbeCooldown() { return probeCooldownTimer; },

  deployProbe(x, y) {
    if (probeCooldownTimer > 0) return false;
    if (deployedProbes.length >= SENSOR_CONFIG.maxProbes) deployedProbes.shift();
    deployedProbes.push({ x, y, range: SENSOR_CONFIG.probeRange, age: 0, lifetime: SENSOR_CONFIG.probeLifetime, pulsePhase: 0 });
    probeCooldownTimer = SENSOR_CONFIG.probeDeployCooldown;
    return true;
  },

  // extra: { player2, wrecks } — gracz 2 (podzielony ekran) widzi dla strony, wraki znane od zobaczenia.
  update(dt, ship, npcs, infrastructure, stations, frameCount, extra = null) {
    if (probeCooldownTimer > 0) probeCooldownTimer = Math.max(0, probeCooldownTimer - dt);

    for (let i = deployedProbes.length - 1; i >= 0; i--) {
      const p = deployedProbes[i];
      p.age += dt;
      p.pulsePhase = (p.pulsePhase + dt * 0.8) % (Math.PI * 2);
      if (p.lifetime > 0 && p.age >= p.lifetime) deployedProbes.splice(i, 1);
    }

    activeSourceCount = 0; // Resetujemy pulę (zamiast alokować nowe tablice)

    const fogOn = !!fogState.enabled;
    if (ship && !ship.dead) {
      const src = getNextSensorSource();
      // z mgłą koło statku = zasięg wzroku kadłuba (to samo, co rysuje mgła)
      src.x = ship.pos.x; src.y = ship.pos.y; src.range = fogOn ? visionRangeOf(ship) : SENSOR_CONFIG.shipPassiveRange; src.type = 'ship';
    }

    for (let i=0; i<deployedProbes.length; i++) {
      const src = getNextSensorSource();
      src.x = deployedProbes[i].x; src.y = deployedProbes[i].y; src.range = deployedProbes[i].range; src.type = 'probe';
    }

    if (window.SpotterDroneSystem) {
      window.SpotterDroneSystem.populateSensorSources(getNextSensorSource);
    }

    if (infrastructure) {
      infrastructure.forEach((list) => {
        for (let i=0; i<list.length; i++) {
          if (list[i].buildingId === 'sensor_station' && list[i].status === 'completed') {
            const src = getNextSensorSource();
            src.x = list[i].worldPos.x; src.y = list[i].worldPos.y; src.range = SENSOR_CONFIG.stationRange; src.type = 'infrastructure';
          }
        }
      });
    }

    for (const [id, ghost] of ghostContacts) {
      ghost.age += dt;
      if (ghost.age >= ghost.maxAge) ghostContacts.delete(id);
    }

    // Mgła wojny: źródła wzroku (statek, P2, sojusznicy, drony, sondy, stacje czujników, przyjazne stacje, strefy
    // fabuły) → flagi bytów, sygnatury masy, świat mgły dla Core3D.
    if (fogOn) {
      advanceFogClock(fogState, dt);
      collectFogSources(fogState, {
        player: ship, player2: extra?.player2 || null, npcs, stations, extra: sensorSources, extraCount: activeSourceCount
      });
    }
    stepFogEntities(fogState, { player: ship, npcs, stations, wrecks: extra?.wrecks || null });
    stepMassSignatures(fogState, dt);
    exportFogWorld(fogState, fogWorld);

    if (!npcs) return;

    for (let i=0; i<npcs.length; i++) {
      const npc = npcs[i];
      if (!npc || npc.dead) continue;

      if (npc.friendly) {
        npc._sensorAwareness = SENSOR_CONFIG.AWARENESS.TRACKED;
        npc._sensorDist = 0;
        continue;
      }

      if (fogOn) {
        // świadomość = wzrok strony gracza (mgła); duch z ostatnią pozycją jak dawniej
        npc._sensorAwareness = npc.__fogVisible === true ? SENSOR_CONFIG.AWARENESS.TRACKED : SENSOR_CONFIG.AWARENESS.HIDDEN;
        npc._sensorDist = 0;
      } else {
        computeEntityVisibility(npc);
      }

      const npcId = npc.id || npc._sensorId || (npc._sensorId = Math.random().toString(36).substr(2, 9));

      if (npc._sensorAwareness >= SENSOR_CONFIG.AWARENESS.DETECTED) {
        ghostContacts.delete(npcId);
        npc._lastKnownX = npc.x;
        npc._lastKnownY = npc.y;
        npc._lastSensorAwareness = npc._sensorAwareness;
      } else {
        if (!ghostContacts.has(npcId) && (npc._lastSensorAwareness || 0) >= SENSOR_CONFIG.AWARENESS.DETECTED) {
          ghostContacts.set(npcId, {
            x: npc._lastKnownX || npc.x,
            y: npc._lastKnownY || npc.y,
            type: npc.type,
            subType: npc.subType,
            radius: npc.radius || npc.r || 14,
            age: 0,
            maxAge: SENSOR_CONFIG.fog.ghostDuration,
            isCapital: !!npc.isCapitalShip,
          });
        }
      }
    }
  },

  getVisibility(entity) {
    if (!entity) return { awareness: SENSOR_CONFIG.AWARENESS.HIDDEN, sensorDist: Infinity };
    return { 
      awareness: entity._sensorAwareness || SENSOR_CONFIG.AWARENESS.HIDDEN, 
      sensorDist: entity._sensorDist || Infinity 
    };
  },

  isVisible(entity) { return (entity?._sensorAwareness || 0) >= SENSOR_CONFIG.AWARENESS.DETECTED; },
  isTargetable(entity) { 
    if (entity && entity.friendly) return true;
    return (entity?._sensorAwareness || 0) >= SENSOR_CONFIG.AWARENESS.TRACKED; 
  },

  getSensorSources() { return sensorSources.slice(0, activeSourceCount); },

  // ... [Pozostałe metody drawFogOfWar, drawSensorRanges, drawGhosts, drawProbes bez zmian]
  drawFogOfWar(ctx, cam, W, H, worldToScreen) {
    if (activeSourceCount === 0) return;
    ctx.save();
    if (!this._fogCanvas || this._fogCanvas.width !== W || this._fogCanvas.height !== H) {
      this._fogCanvas = document.createElement('canvas');
      this._fogCanvas.width = W;
      this._fogCanvas.height = H;
      this._fogCtx = this._fogCanvas.getContext('2d');
    }
    const fctx = this._fogCtx;
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = `rgba(4, 8, 18, ${SENSOR_CONFIG.fog.hiddenAlpha})`;
    fctx.fillRect(0, 0, W, H);
    fctx.globalCompositeOperation = 'destination-out';
    for (let i=0; i<activeSourceCount; i++) {
      const src = sensorSources[i];
      const scr = worldToScreen(src.x, src.y, cam);
      const screenRange = src.range * cam.zoom;
      const grad = fctx.createRadialGradient(scr.x, scr.y, screenRange * 0.6, scr.x, scr.y, screenRange);
      grad.addColorStop(0, 'rgba(0,0,0,1)');   
      grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');    
      fctx.fillStyle = grad;
      fctx.beginPath(); fctx.arc(scr.x, scr.y, screenRange, 0, Math.PI * 2); fctx.fill();
    }
    fctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._fogCanvas, 0, 0);
    ctx.restore();
  },
  drawSensorRanges(ctx, cam, worldToScreen) {
    ctx.save(); ctx.globalAlpha = 0.15; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
    for (let i=0; i<activeSourceCount; i++) {
      const src = sensorSources[i];
      const scr = worldToScreen(src.x, src.y, cam);
      const screenRange = src.range * cam.zoom;
      switch (src.type) {
        case 'ship': ctx.strokeStyle = '#4a9eff'; break;
        case 'probe': ctx.strokeStyle = '#14b8a6'; break;
        case 'drone': ctx.strokeStyle = '#38bdf8'; break;
        case 'infrastructure': ctx.strokeStyle = '#f59e0b'; break;
        default: ctx.strokeStyle = '#6b7280';
      }
      ctx.beginPath(); ctx.arc(scr.x, scr.y, screenRange, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  },
  drawGhosts(ctx, cam, worldToScreen, time) { /* Wnętrze bez zmian */ },
  drawProbes(ctx, cam, worldToScreen, time) { /* Wnętrze bez zmian */ }
};