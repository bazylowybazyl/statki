// =============================================================================
// SENSOR SYSTEM & FOG OF WAR
// =============================================================================
// Manages entity visibility based on sensor ranges from:
// 1. Player ship (passive sensors)
// 2. Deployed sensor probes (map-placed)
// 3. Infrastructure sensor stations (on planets/stations)
// =============================================================================

// --- SENSOR CONSTANTS ---
export const SENSOR_CONFIG = {
  // Player ship passive sensor range
  shipPassiveRange: 18000,
  // Player ship active scan pulse range (existing SCAN_RANGE)
  shipActiveScanRange: 10000,

  // Deployed sensor probe
  probeRange: 30000,
  probeLifetime: 120,       // seconds before probe decays (0 = infinite for infrastructure)
  probeDeployCooldown: 8,   // seconds between deployments
  maxProbes: 5,

  // Infrastructure sensor station
  stationRange: 45000,

  // Detection modifiers by target size
  sizeModifiers: {
    fighter:     0.5,   // harder to detect — 50% of sensor range
    frigate:     0.7,
    destroyer:   0.85,
    battleship:  1.0,
    capital:     1.3,   // easier to detect — 130% of sensor range
    station:     1.5,
  },

  // Fog of war visual config
  fog: {
    fadeDistance: 2000,          // transition zone width (world units)
    hiddenAlpha: 0.92,          // fog opacity for fully hidden areas
    ghostDuration: 8,           // seconds a "ghost" contact persists after losing sensor
    ghostFadeTime: 3,           // seconds for ghost to fade out
  },

  // "Awareness" levels
  AWARENESS: {
    HIDDEN: 0,       // not visible at all
    GHOST: 1,        // last known position, fading
    DETECTED: 2,     // blip on sensors, no detail (type + approximate position)
    TRACKED: 3,      // full visibility, weapons can target
  }
};

// --- SENSOR SOURCE REGISTRY ---
const sensorSources = [];

// --- GHOST CONTACTS ---
// Map<entityId, { x, y, type, radius, age, maxAge, awareness }>
const ghostContacts = new Map();

// --- ENTITY VISIBILITY CACHE ---
// Map<entity, { awareness, sensorDist, ghostData }>
const visibilityCache = new Map();
let cacheFrame = -1;

// --- DEPLOYED PROBES ---
const deployedProbes = [];
let probeCooldownTimer = 0;

// --- PUBLIC API ---

export const SensorSystem = {
  AWARENESS: SENSOR_CONFIG.AWARENESS,
  config: SENSOR_CONFIG,

  /** Initialize / reset */
  init() {
    sensorSources.length = 0;
    ghostContacts.clear();
    visibilityCache.clear();
    deployedProbes.length = 0;
    probeCooldownTimer = 0;
    cacheFrame = -1;
  },

  /** Get deployed probes array (read-only) */
  getProbes() { return deployedProbes; },

  /** Get ghost contacts map */
  getGhosts() { return ghostContacts; },

  /** Get probe cooldown remaining */
  getProbeCooldown() { return probeCooldownTimer; },

  /** Deploy a sensor probe at world position */
  deployProbe(x, y) {
    if (probeCooldownTimer > 0) return false;
    if (deployedProbes.length >= SENSOR_CONFIG.maxProbes) {
      // remove oldest
      deployedProbes.shift();
    }
    deployedProbes.push({
      x, y,
      range: SENSOR_CONFIG.probeRange,
      age: 0,
      lifetime: SENSOR_CONFIG.probeLifetime,
      pulsePhase: 0,
    });
    probeCooldownTimer = SENSOR_CONFIG.probeDeployCooldown;
    return true;
  },

  /**
   * Update sensor system each frame.
   * @param {number} dt - delta time in seconds
   * @param {object} ship - player ship { pos: {x,y} }
   * @param {Array} npcs - all NPC entities
   * @param {Map} infrastructure - Game.infrastructure
   * @param {Array} stations - orbital stations
   * @param {number} frameCount - current frame number for cache invalidation
   */
  update(dt, ship, npcs, infrastructure, stations, frameCount) {
    // Update probe cooldown
    if (probeCooldownTimer > 0) probeCooldownTimer = Math.max(0, probeCooldownTimer - dt);

    // Update probe lifetimes
    for (let i = deployedProbes.length - 1; i >= 0; i--) {
      const p = deployedProbes[i];
      p.age += dt;
      p.pulsePhase = (p.pulsePhase + dt * 0.8) % (Math.PI * 2);
      if (p.lifetime > 0 && p.age >= p.lifetime) {
        deployedProbes.splice(i, 1);
      }
    }

    // Rebuild sensor source list
    sensorSources.length = 0;

    // 1. Player ship
    if (ship && !ship.dead) {
      sensorSources.push({
        x: ship.pos.x,
        y: ship.pos.y,
        range: SENSOR_CONFIG.shipPassiveRange,
        type: 'ship',
      });
    }

    // 2. Deployed probes
    for (const p of deployedProbes) {
      sensorSources.push({
        x: p.x, y: p.y,
        range: p.range,
        type: 'probe',
      });
    }

    // 3. Spotter drones
    if (window.SpotterDroneSystem) {
      for (const src of window.SpotterDroneSystem.getSensorSources()) {
        sensorSources.push(src);
      }
    }

    // 4. Infrastructure sensor stations
    if (infrastructure) {
      infrastructure.forEach((list) => {
        for (const inst of list) {
          if (inst.buildingId === 'sensor_station' && inst.status === 'completed') {
            sensorSources.push({
              x: inst.worldPos.x,
              y: inst.worldPos.y,
              range: SENSOR_CONFIG.stationRange,
              type: 'infrastructure',
            });
          }
        }
      });
    }

    // Update ghost contacts
    for (const [id, ghost] of ghostContacts) {
      ghost.age += dt;
      if (ghost.age >= ghost.maxAge) {
        ghostContacts.delete(id);
      }
    }

    // Compute visibility for all NPCs and update ghosts
    cacheFrame = frameCount;
    visibilityCache.clear();

    if (!npcs) return;

    for (const npc of npcs) {
      if (!npc || npc.dead) continue;

      // Friendly NPCs always visible
      if (npc.friendly) {
        visibilityCache.set(npc, {
          awareness: SENSOR_CONFIG.AWARENESS.TRACKED,
          sensorDist: 0,
          ghostData: null,
        });
        continue;
      }

      const result = computeEntityVisibility(npc);
      visibilityCache.set(npc, result);

      const npcId = npc.id || npc._sensorId || (npc._sensorId = Math.random().toString(36).substr(2, 9));

      if (result.awareness >= SENSOR_CONFIG.AWARENESS.DETECTED) {
        // Currently visible — update or remove ghost
        ghostContacts.delete(npcId);
      } else {
        // Not visible — create ghost from last known position if we had them before
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

      // Track last known state
      if (result.awareness >= SENSOR_CONFIG.AWARENESS.DETECTED) {
        npc._lastKnownX = npc.x;
        npc._lastKnownY = npc.y;
        npc._lastSensorAwareness = result.awareness;
      }
    }
  },

  /**
   * Get awareness level for an entity.
   * @returns {{ awareness: number, sensorDist: number, ghostData: object|null }}
   */
  getVisibility(entity) {
    if (!entity) return { awareness: SENSOR_CONFIG.AWARENESS.HIDDEN, sensorDist: Infinity, ghostData: null };
    const cached = visibilityCache.get(entity);
    if (cached) return cached;
    // Fallback: compute on the fly
    return computeEntityVisibility(entity);
  },

  /**
   * Check if entity should be rendered (DETECTED or TRACKED).
   */
  isVisible(entity) {
    return this.getVisibility(entity).awareness >= SENSOR_CONFIG.AWARENESS.DETECTED;
  },

  /**
   * Check if entity can be targeted by weapons (TRACKED only).
   */
  isTargetable(entity) {
    if (entity && entity.friendly) return true;
    return this.getVisibility(entity).awareness >= SENSOR_CONFIG.AWARENESS.TRACKED;
  },

  /**
   * Get fog alpha for a world position (0 = fully visible, 1 = fully fogged).
   */
  getFogAlpha(wx, wy) {
    let minNormDist = Infinity;
    for (const src of sensorSources) {
      const dist = Math.hypot(wx - src.x, wy - src.y);
      const normDist = dist / src.range;
      if (normDist < minNormDist) minNormDist = normDist;
    }
    if (minNormDist <= 0.85) return 0;
    if (minNormDist >= 1.0) return SENSOR_CONFIG.fog.hiddenAlpha;
    // Smooth transition in the 85%-100% range
    const t = (minNormDist - 0.85) / 0.15;
    return t * t * SENSOR_CONFIG.fog.hiddenAlpha;
  },

  /**
   * Get all sensor sources for rendering (circles on map, etc.)
   */
  getSensorSources() { return sensorSources; },

  /**
   * Draw fog of war overlay on 2D canvas.
   */
  drawFogOfWar(ctx, cam, W, H, worldToScreen) {
    if (sensorSources.length === 0) return;

    ctx.save();

    // Create a temporary canvas for the fog mask
    if (!this._fogCanvas || this._fogCanvas.width !== W || this._fogCanvas.height !== H) {
      this._fogCanvas = document.createElement('canvas');
      this._fogCanvas.width = W;
      this._fogCanvas.height = H;
      this._fogCtx = this._fogCanvas.getContext('2d');
    }

    const fctx = this._fogCtx;

    // Fill with fog
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = `rgba(4, 8, 18, ${SENSOR_CONFIG.fog.hiddenAlpha})`;
    fctx.fillRect(0, 0, W, H);

    // Cut out sensor circles using destination-out
    fctx.globalCompositeOperation = 'destination-out';

    for (const src of sensorSources) {
      const scr = worldToScreen(src.x, src.y, cam);
      const screenRange = src.range * cam.zoom;

      // Radial gradient: fully clear in center, fading at edges
      const grad = fctx.createRadialGradient(scr.x, scr.y, screenRange * 0.6, scr.x, scr.y, screenRange);
      grad.addColorStop(0, 'rgba(0,0,0,1)');    // fully cut out
      grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');     // no cut at edge

      fctx.fillStyle = grad;
      fctx.beginPath();
      fctx.arc(scr.x, scr.y, screenRange, 0, Math.PI * 2);
      fctx.fill();
    }

    fctx.globalCompositeOperation = 'source-over';

    // Draw the fog onto main canvas
    ctx.drawImage(this._fogCanvas, 0, 0);
    ctx.restore();
  },

  /**
   * Draw sensor range circles (debug / tactical overlay).
   */
  drawSensorRanges(ctx, cam, worldToScreen) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);

    for (const src of sensorSources) {
      const scr = worldToScreen(src.x, src.y, cam);
      const screenRange = src.range * cam.zoom;

      switch (src.type) {
        case 'ship': ctx.strokeStyle = '#4a9eff'; break;
        case 'probe': ctx.strokeStyle = '#14b8a6'; break;
        case 'drone': ctx.strokeStyle = '#38bdf8'; break;
        case 'infrastructure': ctx.strokeStyle = '#f59e0b'; break;
        default: ctx.strokeStyle = '#6b7280';
      }

      ctx.beginPath();
      ctx.arc(scr.x, scr.y, screenRange, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  },

  /**
   * Draw ghost contacts on screen.
   */
  drawGhosts(ctx, cam, worldToScreen, time) {
    if (ghostContacts.size === 0) return;

    ctx.save();
    for (const [, ghost] of ghostContacts) {
      const fadeStart = ghost.maxAge - SENSOR_CONFIG.fog.ghostFadeTime;
      let alpha = 1;
      if (ghost.age > fadeStart) {
        alpha = 1 - (ghost.age - fadeStart) / SENSOR_CONFIG.fog.ghostFadeTime;
      }
      alpha *= 0.5;

      const scr = worldToScreen(ghost.x, ghost.y, cam);
      const size = Math.max(8, (ghost.radius || 14)) * cam.zoom;

      // Pulsing ghost marker
      const pulse = 0.7 + 0.3 * Math.sin(time * 3);

      ctx.globalAlpha = alpha * pulse;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      // Diamond shape
      ctx.beginPath();
      ctx.moveTo(scr.x, scr.y - size);
      ctx.lineTo(scr.x + size, scr.y);
      ctx.lineTo(scr.x, scr.y + size);
      ctx.lineTo(scr.x - size, scr.y);
      ctx.closePath();
      ctx.stroke();

      // "LOST CONTACT" label
      if (size * cam.zoom > 3) {
        ctx.setLineDash([]);
        ctx.font = '9px monospace';
        ctx.fillStyle = '#ff4444';
        ctx.textAlign = 'center';
        ctx.fillText('LOST CONTACT', scr.x, scr.y + size + 12);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  },

  /**
   * Draw probe markers.
   */
  drawProbes(ctx, cam, worldToScreen, time) {
    ctx.save();
    for (const probe of deployedProbes) {
      const scr = worldToScreen(probe.x, probe.y, cam);
      const pulse = 0.6 + 0.4 * Math.sin(probe.pulsePhase);

      // Probe dot
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#14b8a6';
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Sweep ring
      ctx.globalAlpha = 0.25 * pulse;
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 1;
      const sweepR = 15 + 10 * pulse;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, sweepR, 0, Math.PI * 2);
      ctx.stroke();

      // Lifetime bar
      if (probe.lifetime > 0) {
        const remain = 1 - probe.age / probe.lifetime;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = remain > 0.3 ? '#14b8a6' : '#ef4444';
        ctx.fillRect(scr.x - 12, scr.y + 10, 24 * remain, 2);
      }
    }
    ctx.restore();
  },
};

// --- INTERNAL FUNCTIONS ---

function getEntitySizeModifier(entity) {
  if (entity.isCapitalShip) return SENSOR_CONFIG.sizeModifiers.capital;
  const type = String(entity.type || '').toLowerCase();
  if (type in SENSOR_CONFIG.sizeModifiers) return SENSOR_CONFIG.sizeModifiers[type];
  // Guess from radius
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

  for (const src of sensorSources) {
    const dist = Math.hypot(entity.x - src.x, entity.y - src.y);
    const effectiveRange = src.range * sizeMod;

    if (dist <= effectiveRange * 0.75) {
      // Full tracking — close enough for weapons lock
      if (SENSOR_CONFIG.AWARENESS.TRACKED > bestAwareness) {
        bestAwareness = SENSOR_CONFIG.AWARENESS.TRACKED;
        bestDist = dist;
      }
    } else if (dist <= effectiveRange) {
      // Detected — visible on sensors but not precise enough for weapons
      if (SENSOR_CONFIG.AWARENESS.DETECTED > bestAwareness) {
        bestAwareness = SENSOR_CONFIG.AWARENESS.DETECTED;
        bestDist = dist;
      }
    }
  }

  return {
    awareness: bestAwareness,
    sensorDist: bestDist,
    ghostData: null,
  };
}
