import { getHullRenderSize, resolveHullRenderProfileId } from '../data/ships.js';
import { BELT_DEFINITIONS } from '../data/asteroidTypes.js';

// =============================================================================
// CIC — COMBAT INFORMATION CENTER
// =============================================================================
// Full-screen tactical overlay showing:
// - Radar sweep animation
// - Sensor contacts with NATO-style markers
// - Weapon range rings
// - Targeting queue
// - Long-range engagement controls
// =============================================================================

const CIC_CONFIG = {
  zoomDefault: 0.08,       // CIC map zoom (world units → screen)
  zoomMin: 0.0001,         // farther strategic overview before hitting CIC zoom-out limit
  zoomMax: 0.4,
  zoomSpeed: 0.0004,
  sweepSpeed: 0.6,          // radians per second
  sweepRange: 60000,        // radar sweep max range (world units)
  gridSpacing: 10000,       // world units between grid lines
  silhouetteMinPx: 18,
  colors: {
    bg: 'rgba(4, 12, 24, 0.95)',
    grid: 'rgba(30, 80, 140, 0.25)',
    gridMajor: 'rgba(40, 100, 170, 0.4)',
    sweep: 'rgba(80, 200, 255, 0.15)',
    sweepLine: 'rgba(80, 200, 255, 0.6)',
    friendly: '#4ade80',
    hostile: '#ef4444',
    unknown: '#fbbf24',
    selected: '#38bdf8',
    rangeRing: 'rgba(80, 160, 255, 0.2)',
    text: '#94a3b8',
    textBright: '#e2e8f0',
  }
};

const CIC_FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone']);
const CIC_SILHOUETTE_CACHE = new Map();
const CIC_SOURCE_IDS = new WeakMap();
let cicSourceIdSeq = 1;

function readPositiveNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function readSignedNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getEntityScaleX(entity) {
  return Math.max(
    0.0001,
    readPositiveNumber(entity?.visual?.spriteScaleX, readPositiveNumber(entity?.visual?.spriteScale, 1))
  );
}

function getEntityScaleY(entity) {
  return Math.max(
    0.0001,
    readPositiveNumber(entity?.visual?.spriteScaleY, readPositiveNumber(entity?.visual?.spriteScale, 1))
  );
}

function getEntitySpriteRotation(entity) {
  if (Number.isFinite(Number(entity?.visual?.spriteRotation))) return Number(entity.visual.spriteRotation);
  if (Number.isFinite(Number(entity?.capitalProfile?.spriteRotation))) return Number(entity.capitalProfile.spriteRotation);
  if (Number.isFinite(Number(entity?.profile?.spriteRotation))) return Number(entity.profile.spriteRotation);
  return 0;
}

function getEntityHullProfileId(entity) {
  const explicitId = String(entity?.activeHullId || entity?.shipFrame || entity?.shipId || '').trim().toLowerCase();
  if (explicitId) return resolveHullRenderProfileId(explicitId);

  const type = String(entity?.type || '').trim().toLowerCase();
  if (!type) return null;
  if (type.includes('battleship')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_battleship' : 'terran_battleship');
  if (type.includes('destroyer')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_destroyer' : 'terran_destroyer');
  if (type.includes('frigate')) return resolveHullRenderProfileId(entity?.isPirate ? 'pirate_frigate' : 'terran_frigate');
  if (type === 'supercapital') return resolveHullRenderProfileId('supercapital');
  if (type === 'carrier' || type === 'capital_carrier') return resolveHullRenderProfileId('capital_carrier');
  return null;
}

function getEntitySpriteSource(entity) {
  const direct = entity?.renderSpriteImage || entity?.spriteImage || entity?.sprite;
  if (direct && readPositiveNumber(direct.width || direct.naturalWidth, 0) > 0) return direct;
  if (entity?.capitalSprite?.ready && entity.capitalSprite.image) return entity.capitalSprite.image;
  const armorImage = entity?.hexGrid?.armorImage;
  if (armorImage && readPositiveNumber(armorImage.width || armorImage.naturalWidth, 0) > 0) return armorImage;
  const cacheCanvas = entity?.hexGrid?.cacheCanvas;
  if (cacheCanvas && readPositiveNumber(cacheCanvas.width, 0) > 0 && readPositiveNumber(cacheCanvas.height, 0) > 0) return cacheCanvas;
  return null;
}

function quantizeCicSize(value) {
  const px = Math.max(2, Number(value) || 2);
  const step = px >= 220 ? 10 : px >= 120 ? 8 : px >= 48 ? 4 : 2;
  return Math.max(2, Math.round(px / step) * step);
}

function getCicSourceId(source) {
  if (!source || typeof source !== 'object') return 'none';
  let id = CIC_SOURCE_IDS.get(source);
  if (!id) {
    id = `src_${cicSourceIdSeq++}`;
    CIC_SOURCE_IDS.set(source, id);
  }
  return id;
}

function getCicTintedSilhouette(source, width, height, tint) {
  if (!source) return null;
  const qW = quantizeCicSize(width);
  const qH = quantizeCicSize(height);
  const key = `${getCicSourceId(source)}|${qW}x${qH}|${tint}`;
  let cached = CIC_SILHOUETTE_CACHE.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = qW;
  canvas.height = qH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, qW, qH);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, qW, qH);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, qW, qH);
  ctx.globalCompositeOperation = 'source-over';
  CIC_SILHOUETTE_CACHE.set(key, canvas);
  return canvas;
}

function getEntityHullMetrics(entity, zoom) {
  const scaleX = getEntityScaleX(entity);
  const scaleY = getEntityScaleY(entity);

  let worldW = 0;
  let worldH = 0;

  const gridW = readPositiveNumber(entity?.hexGrid?.srcWidth, 0);
  const gridH = readPositiveNumber(entity?.hexGrid?.srcHeight, 0);
  if (gridW > 0 && gridH > 0) {
    worldW = gridW * scaleX;
    worldH = gridH * scaleY;
  }

  if (!(worldW > 0 && worldH > 0)) {
    const entityW = readPositiveNumber(entity?.w, 0);
    const entityH = readPositiveNumber(entity?.h, 0);
    if (entityW > 0 && entityH > 0) {
      worldW = entityW * scaleX;
      worldH = entityH * scaleY;
    }
  }

  if (!(worldW > 0 && worldH > 0)) {
    const profileId = getEntityHullProfileId(entity);
    if (profileId) {
      const source = getEntitySpriteSource(entity);
      const srcW = readPositiveNumber(source?.naturalWidth || source?.width, 0);
      const srcH = readPositiveNumber(source?.naturalHeight || source?.height, 0);
      const size = getHullRenderSize(profileId, srcW, srcH);
      worldW = readPositiveNumber(size?.w, worldW) * scaleX;
      worldH = readPositiveNumber(size?.h, worldH) * scaleY;
    }
  }

  if (!(worldW > 0 && worldH > 0)) {
    const baseR = Math.max(1, readPositiveNumber(entity?.radius, readPositiveNumber(entity?.r, 14)));
    if (entity?.capitalProfile) {
      worldW = Math.max(worldW, baseR * Math.max(1.2, readPositiveNumber(entity.capitalProfile.lengthScale, 3.2)));
      worldH = Math.max(worldH, baseR * Math.max(1.0, readPositiveNumber(entity.capitalProfile.widthScale, 1.2)));
    } else {
      worldW = Math.max(worldW, baseR * 2);
      worldH = Math.max(worldH, baseR * 2);
    }
  }

  return {
    worldW,
    worldH,
    drawW: worldW * zoom,
    drawH: worldH * zoom
  };
}

export function getCicEntityHullMetrics(entity, zoom) {
  return getEntityHullMetrics(entity, zoom);
}

function getContactPalette(isSelected, friendly, hostile) {
  if (isSelected) {
    return {
      marker: CIC_CONFIG.colors.selected,
      body: 'rgba(14, 34, 48, 0.96)',
      accent: 'rgba(56, 189, 248, 0.72)',
      glow: 'rgba(56, 189, 248, 0.52)'
    };
  }
  if (friendly) {
    return {
      marker: CIC_CONFIG.colors.friendly,
      body: 'rgba(10, 30, 18, 0.96)',
      accent: 'rgba(74, 222, 128, 0.64)',
      glow: 'rgba(74, 222, 128, 0.36)'
    };
  }
  if (hostile) {
    return {
      marker: CIC_CONFIG.colors.hostile,
      body: 'rgba(38, 12, 16, 0.96)',
      accent: 'rgba(239, 68, 68, 0.68)',
      glow: 'rgba(239, 68, 68, 0.36)'
    };
  }
  return {
    marker: CIC_CONFIG.colors.unknown,
    body: 'rgba(36, 30, 12, 0.96)',
    accent: 'rgba(251, 191, 36, 0.68)',
    glow: 'rgba(251, 191, 36, 0.34)'
  };
}

export function getCicPlacementGhostPalette({ player = false } = {}) {
  return player
    ? {
      marker: CIC_CONFIG.colors.selected,
      body: 'rgba(6, 34, 46, 0.54)',
      accent: 'rgba(126, 255, 226, 0.82)',
      glow: 'rgba(126, 255, 226, 0.56)'
    }
    : {
      marker: '#7aa8ff',
      body: 'rgba(10, 22, 48, 0.48)',
      accent: 'rgba(154, 188, 255, 0.72)',
      glow: 'rgba(122, 166, 255, 0.42)'
    };
}

function canDrawContactSilhouette(entity, contact, metrics, isSystemScale) {
  if (!entity || isSystemScale || contact?.isGhost) return false;
  if (entity.fighter || CIC_FIGHTER_TYPES.has(String(entity?.type || '').toLowerCase())) return false;
  const trackedAwareness = window.SensorSystem?.AWARENESS?.TRACKED || 3;
  if (Number.isFinite(Number(contact?.awareness)) && Number(contact.awareness) < trackedAwareness) return false;
  if (!getEntitySpriteSource(entity)) return false;
  return Math.max(metrics.drawW, metrics.drawH) >= CIC_CONFIG.silhouetteMinPx;
}

function drawShipSilhouette(ctx, entity, screenX, screenY, metrics, palette, accentAlpha = 0.22, options = {}) {
  const source = getEntitySpriteSource(entity);
  if (!source) return false;

  const drawW = Math.max(8, Number(metrics?.drawW) || 0);
  const drawH = Math.max(8, Number(metrics?.drawH) || 0);
  if (!(drawW > 0 && drawH > 0)) return false;

  const bodyCanvas = getCicTintedSilhouette(source, drawW, drawH, palette.body);
  if (!bodyCanvas) return false;
  const accentCanvas = getCicTintedSilhouette(source, drawW, drawH, palette.accent);

  ctx.save();
  ctx.translate(screenX, screenY);
  const angle = Number.isFinite(Number(options?.angle))
    ? Number(options.angle)
    : readSignedNumber(entity?.angle, 0);
  ctx.rotate(angle + getEntitySpriteRotation(entity));
  ctx.globalAlpha = readPositiveNumber(options?.alpha, 0.98);
  ctx.drawImage(bodyCanvas, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  if (accentCanvas) {
    ctx.globalAlpha = accentAlpha;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = Math.max(4, Math.min(18, Math.max(drawW, drawH) * 0.08));
    ctx.drawImage(accentCanvas, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  }
  ctx.restore();
  return true;
}

export function drawCicShipSilhouette(ctx, entity, screenX, screenY, metrics, palette, options = {}) {
  return drawShipSilhouette(
    ctx,
    entity,
    screenX,
    screenY,
    metrics,
    palette,
    readPositiveNumber(options?.accentAlpha, 0.22),
    options
  );
}

let cicActive = false;
let cicZoom = CIC_CONFIG.zoomDefault;
let cicTargetZoom = CIC_CONFIG.zoomDefault;  // smooth zoom target
let cicPanX = 0, cicPanY = 0; // offset from ship
let cicTargetPanX = 0, cicTargetPanY = 0; // smooth pan targets
let cicSweepAngle = 0;
let cicSelectedTarget = null;       // backward-compat alias → cicSelectedContacts[0]
let cicSelectedContacts = [];       // multi-select (contact objects, not entities)
let cicDragging = false;
let cicDragButton = -1;             // which button is dragging
let cicDragMoved = false;
let cicDragStart = { x: 0, y: 0 };
let cicMouseWorld = { x: 0, y: 0 };

// Box-select state (LMB rubber-band)
let cicBoxSelecting = false;
let cicBoxStart = { x: 0, y: 0 };  // screen coords
let cicBoxEnd   = { x: 0, y: 0 };  // screen coords

// System view blend: 0 = tactical, 1 = full system (derived from zoom level)
const SYSTEM_ZOOM_START = 0.006;  // start blending toward system view
const SYSTEM_ZOOM_FULL  = 0.0008; // fully in system view
let cicSystemBlend = 0;           // current blend factor (smoothed)

// Context menu state (right-click)
// items: array of { label, action: 'attack'|'move'|'cruise'|'drone'|'recallDrones'|null (disabled) }
let cicContextMenu = {
  open: false,
  screenX: 0, screenY: 0,
  worldX: 0, worldY: 0,
  targetEntity: null,   // non-null when opened on enemy contact
  items: [],
};

// WSAD pan keys currently held
const cicKeys = new Set();

// Contact list refreshed each frame
let cicContacts = [];

export const CICDisplay = {
  get active() { return cicActive; },

  toggle() {
    cicActive = !cicActive;
    if (cicActive) {
      cicPanX = 0; cicPanY = 0;
      cicTargetPanX = 0; cicTargetPanY = 0;
      cicZoom = CIC_CONFIG.zoomDefault;
      cicTargetZoom = CIC_CONFIG.zoomDefault;
      cicSelectedTarget = null;
      cicSelectedContacts = [];
      cicBoxSelecting = false;
      cicSystemBlend = 0;
    } else {
      cicKeys.clear();
    }
    return cicActive;
  },

  close() {
    cicActive = false;
    cicSystemBlend = 0;
    cicBoxSelecting = false;
    cicSelectedContacts = [];
    cicContextMenu.open = false;
    cicKeys.clear();
  },
  open() {
    cicActive = true;
    cicPanX = 0; cicPanY = 0;
    cicTargetPanX = 0; cicTargetPanY = 0;
    cicZoom = CIC_CONFIG.zoomDefault;
    cicTargetZoom = CIC_CONFIG.zoomDefault;
    cicSelectedContacts = [];
    cicSystemBlend = 0;
  },

  getSelectedTarget()  { return cicSelectedContacts[0]?.entity || cicSelectedTarget || null; },
  getSelectedTargets() { return cicSelectedContacts.map(c => c.entity).filter(Boolean); },

  /** Jump to system view (V key) — sets target zoom to system level */
  toggleSystemView() {
    if (!cicActive) return;
    if (cicSystemBlend > 0.5) {
      // Already in system view → animate back to tactical
      cicTargetZoom = CIC_CONFIG.zoomDefault;
      cicTargetPanX = 0;
      cicTargetPanY = 0;
    } else {
      // Jump to system view: compute zoom to fit outermost orbit
      const planets = window.planets;
      const SUN = window.SUN;
      const ship = window.ship;
      let maxOrbit = 100000;
      if (planets) {
        for (const pl of planets) {
          if (pl && pl.orbitRadius > maxOrbit) maxOrbit = pl.orbitRadius;
        }
      }
      const fitZoom = Math.min(window.innerWidth, window.innerHeight) * 0.42 / (maxOrbit * 1.2);
      cicTargetZoom = fitZoom;
      // Center on sun but offset so player stays in view (no hard re-center)
      if (SUN && ship) {
        const sunOffX = SUN.x - ship.pos.x;
        const sunOffY = SUN.y - ship.pos.y;
        // Lerp halfway toward sun — player stays roughly visible
        cicTargetPanX = sunOffX * 0.5;
        cicTargetPanY = sunOffY * 0.5;
      }
    }
  },

  get isSystemView() { return cicSystemBlend > 0.3; },

  /** WSAD key pressed — returns true if consumed */
  onKeyDown(code) {
    if (!cicActive) return false;
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
      cicKeys.add(code);
      return true;
    }
    return false;
  },

  /** WSAD key released */
  onKeyUp(code) {
    cicKeys.delete(code);
  },

  /** Handle mouse wheel in CIC — proportional zoom, continuous range */
  onWheel(deltaY) {
    if (!cicActive) return;
    const factor = 1 - deltaY * 0.0015;
    cicTargetZoom = Math.max(CIC_CONFIG.zoomMin, Math.min(CIC_CONFIG.zoomMax, cicTargetZoom * factor));
  },

  /** Handle mouse down in CIC */
  onMouseDown(x, y, button) {
    if (!cicActive) return false;

    // Any click closes the context menu first
    if (cicContextMenu.open && button !== 2) {
      const ITEM_H = 26, MENU_W = 160;
      const mx = cicContextMenu.screenX, my = cicContextMenu.screenY;
      const menuH = cicContextMenu.items.length * ITEM_H;
      if (x >= mx && x <= mx + MENU_W && y >= my && y <= my + menuH) {
        const idx = Math.floor((y - my) / ITEM_H);
        const item = cicContextMenu.items[idx];
        if (item && item.action) {
          const { worldX, worldY, targetEntity } = cicContextMenu;
          if (item.action === 'attack' && window.cicAttackOrder) {
            if (targetEntity) {
              window.cicAttackOrder(targetEntity);
            } else if (cicSelectedContacts.length > 0 && window.cicGroupAttackOrder) {
              window.cicGroupAttackOrder(cicSelectedContacts.map(c => c.entity).filter(Boolean));
            }
          } else if (item.action === 'move') {
            if (window.ship) window.ship.command = { type: 'moveTo', x: worldX, y: worldY };
          } else if (item.action === 'cruise') {
            if (window.setCruiseTarget) window.setCruiseTarget(worldX, worldY);
          } else if (item.action === 'drone') {
            const droneSystem = window.SpotterDroneSystem;
            const ship = window.ship;
            if (droneSystem && ship?.pos) {
              droneSystem.deploy(ship.pos.x, ship.pos.y, worldX, worldY);
            }
          } else if (item.action === 'recallDrones') {
            const droneSystem = window.SpotterDroneSystem;
            const ship = window.ship;
            if (droneSystem && ship?.pos) {
              droneSystem.recallAll(ship.pos.x, ship.pos.y);
            }
          }
        }
        cicContextMenu.open = false;
        return true;
      }
      cicContextMenu.open = false;
      return true;
    }

    // Right-click: context menu
    if (button === 2) {
      const W = window.innerWidth, H = window.innerHeight;
      const cx = W / 2, cy = H / 2;
      const shipX = (window.ship?.pos?.x || 0) + cicPanX;
      const shipY = (window.ship?.pos?.y || 0) + cicPanY;
      const worldX = shipX + (x - cx) / cicZoom;
      const worldY = shipY + (y - cy) / cicZoom;

      // Check if click is near a hostile contact
      let hitContact = null;
      for (const c of cicContacts) {
        if (c.isGhost || !c.entity || c.friendly) continue;
        const ddx = c.screenX - x, ddy = c.screenY - y;
        const hitRadius = Math.max(12, Number(c.hitRadius) || 20);
        if (ddx * ddx + ddy * ddy < hitRadius * hitRadius) { hitContact = c; break; }
      }

      cicContextMenu.worldX = worldX;
      cicContextMenu.worldY = worldY;
      cicContextMenu.screenX = x;
      cicContextMenu.screenY = y;
      cicContextMenu.targetEntity = hitContact?.entity || null;

      if (hitContact) {
        // Clicked directly on enemy → immediate attack, no menu
        cicContextMenu.open = false;
        if (window.cicAttackOrder) window.cicAttackOrder(hitContact.entity);
      } else {
        // Empty space → show context menu
        const hasSelected = cicSelectedContacts.length > 0;
        const droneSystem = window.SpotterDroneSystem;
        const hasDroneSystem = !!droneSystem;
        const hasActiveDrones = !!droneSystem?.getDrones?.().some(d => d && !d.dead);
        cicContextMenu.items = [
          { label: 'ATAK', action: hasSelected ? 'attack' : null },
          { label: 'RUCH', action: 'move' },
          { label: 'CRUISE TO', action: 'cruise' },
          { label: 'SEND DRONE', action: hasDroneSystem ? 'drone' : null },
          { label: 'RECALL DRONES', action: hasActiveDrones ? 'recallDrones' : null },
        ];
        cicContextMenu.open = true;
      }
      return true;
    }

    // Middle mouse: always pan
    if (button === 1) {
      cicDragging = true;
      cicDragButton = 1;
      cicDragMoved = false;
      cicDragStart = { x, y };
      return true;
    }

    // LMB: start box-select
    if (button === 0) {
      cicDragging = true;
      cicDragButton = 0;
      cicDragMoved = false;
      cicDragStart = { x, y };
      cicBoxStart = { x, y };
      cicBoxEnd = { x, y };
      cicBoxSelecting = false;
      return true;
    }
    return false;
  },

  /** Handle mouse move in CIC */
  onMouseMove(x, y, dx, dy) {
    if (!cicActive) return;
    if (cicDragging) {
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) cicDragMoved = true;

      if (cicDragButton === 1) {
        // MMB — pan
        const ddx = dx / cicZoom;
        const ddy = dy / cicZoom;
        cicPanX -= ddx;
        cicPanY -= ddy;
        cicTargetPanX = cicPanX;
        cicTargetPanY = cicPanY;
      } else if (cicDragButton === 0 && cicDragMoved) {
        // LMB drag — box-select
        cicBoxSelecting = true;
        cicBoxEnd = { x, y };
      }
    }
    // Update mouse world position
    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H / 2;
    const shipX = (window.ship?.pos?.x || 0) + cicPanX;
    const shipY = (window.ship?.pos?.y || 0) + cicPanY;
    cicMouseWorld.x = shipX + (x - cx) / cicZoom;
    cicMouseWorld.y = shipY + (y - cy) / cicZoom;
  },

  /** Handle mouse up in CIC */
  onMouseUp(x, y, button) {
    if (button === 0) {
      if (cicBoxSelecting) {
        // Finalize box-select: collect all contacts inside the rectangle
        const x0 = Math.min(cicBoxStart.x, cicBoxEnd.x);
        const x1 = Math.max(cicBoxStart.x, cicBoxEnd.x);
        const y0 = Math.min(cicBoxStart.y, cicBoxEnd.y);
        const y1 = Math.max(cicBoxStart.y, cicBoxEnd.y);
        cicSelectedContacts = cicContacts.filter(c =>
          !c.isGhost && c.entity &&
          c.screenX >= x0 && c.screenX <= x1 &&
          c.screenY >= y0 && c.screenY <= y1
        );
        cicSelectedTarget = cicSelectedContacts[0]?.entity || null;
      } else if (!cicDragMoved) {
        // Short click → point-select nearest contact within 15px
        cicSelectedContacts = [];
        const px = x || cicDragStart.x;
        const py = y || cicDragStart.y;
        for (const c of cicContacts) {
          if (c.isGhost) continue;
          const ddx = c.screenX - px, ddy = c.screenY - py;
          const hitRadius = Math.max(10, Number(c.hitRadius) || 15);
          if (ddx * ddx + ddy * ddy < hitRadius * hitRadius) {
            cicSelectedContacts = [c];
            break;
          }
        }
        cicSelectedTarget = cicSelectedContacts[0]?.entity || null;
      }
      cicBoxSelecting = false;
    }
    cicDragging = false;
    cicDragMoved = false;
    cicDragButton = -1;
  },

  /**
   * Update CIC state.
   */
  update(dt, ship, npcs, stations, SensorSystem) {
    if (!cicActive) return;

    cicSweepAngle = (cicSweepAngle + CIC_CONFIG.sweepSpeed * dt) % (Math.PI * 2);

    // WSAD camera pan — speed scales with visible area so it feels consistent at any zoom
    if (cicKeys.size > 0) {
      const panSpeed = 500 / cicZoom;
      if (cicKeys.has('KeyA')) cicTargetPanX -= panSpeed * dt;
      if (cicKeys.has('KeyD')) cicTargetPanX += panSpeed * dt;
      if (cicKeys.has('KeyW')) cicTargetPanY -= panSpeed * dt;
      if (cicKeys.has('KeyS')) cicTargetPanY += panSpeed * dt;
    }

    // Build contact list from sensor-visible entities
    cicContacts.length = 0;
    if (!ship || !npcs) return;

    for (const npc of npcs) {
      if (!npc || npc.dead) continue;
      const vis = SensorSystem.getVisibility(npc);
      if (vis.awareness < SensorSystem.AWARENESS.DETECTED) continue;

      cicContacts.push({
        entity: npc,
        x: npc.x,
        y: npc.y,
        type: npc.type || 'unknown',
        subType: npc.subType || '',
        friendly: !!npc.friendly,
        hostile: !npc.friendly,
        isCapital: !!npc.isCapitalShip,
        radius: npc.radius || npc.r || 14,
        hp: npc.hp,
        maxHp: npc.maxHp,
        shield: npc.shield,
        awareness: vis.awareness,
        distance: Math.hypot(npc.x - ship.pos.x, npc.y - ship.pos.y),
        screenX: 0, screenY: 0, // filled during draw
        hitRadius: 16,
      });
    }

    // Add ghost contacts
    for (const [, ghost] of SensorSystem.getGhosts()) {
      cicContacts.push({
        entity: null,
        x: ghost.x, y: ghost.y,
        type: ghost.type || 'unknown',
        friendly: false, hostile: true,
        isCapital: ghost.isCapital,
        radius: ghost.radius || 14,
        awareness: SensorSystem.AWARENESS.GHOST,
        distance: Math.hypot(ghost.x - ship.pos.x, ghost.y - ship.pos.y),
        isGhost: true,
        screenX: 0, screenY: 0,
        hitRadius: 16,
      });
    }

    // Sort by distance
    cicContacts.sort((a, b) => a.distance - b.distance);
  },

  /**
   * Draw the full CIC overlay.
   */
  draw(ctx, W, H, ship, SensorSystem, weapons, gameTime) {
    if (!cicActive || !ship) return;

    const cx = W / 2;
    const cy = H / 2;

    // ── Smooth zoom interpolation (logarithmic lerp for natural feel) ──
    const zoomRatio = cicTargetZoom / cicZoom;
    if (Math.abs(zoomRatio - 1) > 0.001) {
      cicZoom *= Math.pow(zoomRatio, 0.12); // smooth log-lerp
    } else {
      cicZoom = cicTargetZoom;
    }

    // ── System blend factor (0 = tactical, 1 = full system) ──
    const rawBlend = Math.max(0, Math.min(1,
      (SYSTEM_ZOOM_START - cicZoom) / (SYSTEM_ZOOM_START - SYSTEM_ZOOM_FULL)
    ));
    cicSystemBlend += (rawBlend - cicSystemBlend) * 0.1; // smooth blend

    // ── Smooth pan interpolation (no auto-centering — user controls pan freely) ──
    cicPanX += (cicTargetPanX - cicPanX) * 0.14;
    cicPanY += (cicTargetPanY - cicPanY) * 0.14;

    const isSystemScale = cicSystemBlend > 0.3;

    const shipX = ship.pos.x + cicPanX;
    const shipY = ship.pos.y + cicPanY;

    const toScreen = (wx, wy) => ({
      x: cx + (wx - shipX) * cicZoom,
      y: cy + (wy - shipY) * cicZoom,
    });

    ctx.save();
    ctx.resetTransform();

    // === BACKGROUND ===
    ctx.fillStyle = CIC_CONFIG.colors.bg;
    ctx.fillRect(0, 0, W, H);

    // === GRID (adaptive spacing based on zoom) ===
    let gridSpacing = CIC_CONFIG.gridSpacing;
    // At very far zoom, increase grid spacing so lines don't become invisible
    while (gridSpacing * cicZoom < 30) gridSpacing *= 5;
    const gridScreenSpacing = gridSpacing * cicZoom;

    if (gridScreenSpacing > 15) {
      ctx.strokeStyle = CIC_CONFIG.colors.grid;
      ctx.lineWidth = 0.5;

      const startWX = Math.floor((shipX - cx / cicZoom) / gridSpacing) * gridSpacing;
      const endWX = shipX + cx / cicZoom;
      const startWY = Math.floor((shipY - cy / cicZoom) / gridSpacing) * gridSpacing;
      const endWY = shipY + cy / cicZoom;

      const majorMul = gridSpacing * 5;
      for (let wx = startWX; wx <= endWX; wx += gridSpacing) {
        const sx = toScreen(wx, 0).x;
        const isMajor = Math.abs(wx % majorMul) < gridSpacing * 0.1;
        ctx.strokeStyle = isMajor ? CIC_CONFIG.colors.gridMajor : CIC_CONFIG.colors.grid;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      }
      for (let wy = startWY; wy <= endWY; wy += gridSpacing) {
        const sy = toScreen(0, wy).y;
        const isMajor = Math.abs(wy % majorMul) < gridSpacing * 0.1;
        ctx.strokeStyle = isMajor ? CIC_CONFIG.colors.gridMajor : CIC_CONFIG.colors.grid;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }
    }

    // === SOLAR SYSTEM: Sun, Planets, Orbits, Rings ===
    drawSolarSystem(ctx, W, H, toScreen, cicZoom, gameTime);

    // === RANGE RINGS (from ship center) ===
    const shipScr = toScreen(ship.pos.x, ship.pos.y);
    ctx.strokeStyle = CIC_CONFIG.colors.rangeRing;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    const ringDistances = [5000, 10000, 20000, 50000, 100000];
    for (const rd of ringDistances) {
      const sr = rd * cicZoom;
      if (sr < 20 || sr > W * 2) continue;
      ctx.beginPath();
      ctx.arc(shipScr.x, shipScr.y, sr, 0, Math.PI * 2);
      ctx.stroke();
      // Label
      ctx.fillStyle = CIC_CONFIG.colors.text;
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${(rd / 1000).toFixed(0)}k`, shipScr.x + sr + 4, shipScr.y - 3);
    }
    ctx.setLineDash([]);

    // === SENSOR RANGES ===
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const src of SensorSystem.getSensorSources()) {
      const sp = toScreen(src.x, src.y);
      const sr = src.range * cicZoom;
      switch (src.type) {
        case 'ship': ctx.strokeStyle = 'rgba(74,158,255,0.3)'; break;
        case 'probe': ctx.strokeStyle = 'rgba(20,184,166,0.3)'; break;
        case 'drone': ctx.strokeStyle = 'rgba(56,189,248,0.3)'; break;
        case 'infrastructure': ctx.strokeStyle = 'rgba(245,158,11,0.3)'; break;
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // === RADAR SWEEP ===
    const sweepR = CIC_CONFIG.sweepRange * cicZoom;
    if (sweepR > 10) {
      // Sweep cone (trailing fade) — arc-based for compatibility
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = CIC_CONFIG.colors.sweep;
      ctx.beginPath();
      ctx.moveTo(shipScr.x, shipScr.y);
      ctx.arc(shipScr.x, shipScr.y, sweepR, cicSweepAngle - 0.5, cicSweepAngle, false);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Sweep line
      ctx.strokeStyle = CIC_CONFIG.colors.sweepLine;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(shipScr.x, shipScr.y);
      ctx.lineTo(
        shipScr.x + Math.cos(cicSweepAngle) * sweepR,
        shipScr.y + Math.sin(cicSweepAngle) * sweepR
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // === DRONES ON CIC ===
    if (window.SpotterDroneSystem) {
      for (const d of window.SpotterDroneSystem.getDrones()) {
        if (d.dead) continue;
        const dp = toScreen(d.x, d.y);
        const isActivePip = d === window.SpotterDroneSystem.getActivePip();
        ctx.save();
        ctx.translate(dp.x, dp.y);
        ctx.rotate(d.angle);
        const ds = Math.max(5, 6);
        ctx.fillStyle = isActivePip ? '#38bdf8' : '#64748b';
        ctx.strokeStyle = isActivePip ? '#7dd3fc' : '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ds * 1.5, 0);
        ctx.lineTo(-ds, ds * 0.8);
        ctx.lineTo(-ds * 0.5, 0);
        ctx.lineTo(-ds, -ds * 0.8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        // Label
        ctx.font = '7px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.fillText('DRONE', dp.x, dp.y + 10);
      }
    }

    // === PLAYER SHIP ICON ===
    if (isSystemScale) {
      ctx.save();
      ctx.translate(shipScr.x, shipScr.y);
      // In system view: pulsing beacon dot
      const pulse = 0.6 + 0.4 * Math.sin(gameTime * 3);
      const beaconR = 4 + cicSystemBlend * 3;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = beaconR * 3 * pulse;
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, beaconR, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // Label
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('ATLAS', 0, beaconR + 14);
      ctx.restore();
    } else {
      const playerMetrics = getEntityHullMetrics(ship, cicZoom);
      const playerPalette = getContactPalette(true, true, false);
      if (!drawShipSilhouette(ctx, ship, shipScr.x, shipScr.y, playerMetrics, playerPalette, 0.28)) {
        ctx.save();
        ctx.translate(shipScr.x, shipScr.y);
        ctx.rotate(ship.angle || 0);
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        const ss = Math.max(8, 220 * cicZoom);
        ctx.beginPath();
        ctx.moveTo(ss * 1.2, 0);
        ctx.lineTo(-ss * 0.7, ss * 0.6);
        ctx.lineTo(-ss * 0.5, 0);
        ctx.lineTo(-ss * 0.7, -ss * 0.6);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // === CONTACTS ===
    for (const c of cicContacts) {
      const sp = toScreen(c.x, c.y);
      c.screenX = sp.x;
      c.screenY = sp.y;

      // Skip if off screen
      if (sp.x < -50 || sp.x > W + 50 || sp.y < -50 || sp.y > H + 50) continue;

      const isSelected = c.entity && cicSelectedContacts.some(s => s.entity === c.entity);
      const palette = getContactPalette(isSelected, c.friendly, c.hostile);
      const metrics = c.entity ? getEntityHullMetrics(c.entity, cicZoom) : null;
      const hullExtent = metrics ? Math.max(metrics.drawW, metrics.drawH) * 0.5 : 0;
      const size = Math.max(5, Math.min(14, c.radius * cicZoom * 2));
      const markerSize = Math.max(size, Math.min(28, hullExtent * 0.32));
      const iconSize = Math.max(markerSize, hullExtent);
      c.hitRadius = Math.max(14, Math.min(160, iconSize * 0.5 + 6));

      if (c.isGhost) {
        // Ghost: dashed diamond
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - markerSize); ctx.lineTo(sp.x + markerSize, sp.y);
        ctx.lineTo(sp.x, sp.y + markerSize); ctx.lineTo(sp.x - markerSize, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        continue;
      }

      const color = palette.marker;
      ctx.save();
      const drewSilhouette = canDrawContactSilhouette(c.entity, c, metrics, isSystemScale)
        ? drawShipSilhouette(ctx, c.entity, sp.x, sp.y, metrics, palette, isSelected ? 0.3 : 0.2)
        : false;
      const visualSize = drewSilhouette ? Math.max(markerSize, hullExtent * 0.5) : markerSize;

      // DETECTED: small diamond, no detail
      if (c.awareness === (window.SensorSystem?.AWARENESS?.DETECTED || 2)) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - markerSize); ctx.lineTo(sp.x + markerSize, sp.y);
        ctx.lineTo(sp.x, sp.y + markerSize); ctx.lineTo(sp.x - markerSize, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.font = '8px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(c.type.toUpperCase(), sp.x, sp.y + markerSize + 10);
      } else {
        if (!drewSilhouette) {
          // Fallback for contacts without a sprite silhouette.
          if (c.hostile) {
            ctx.fillStyle = color + '44';
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 2.5 : 1.5;
            const s2 = c.isCapital ? markerSize * 1.8 : markerSize;
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y - s2); ctx.lineTo(sp.x + s2, sp.y);
            ctx.lineTo(sp.x, sp.y + s2); ctx.lineTo(sp.x - s2, sp.y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          } else {
            ctx.fillStyle = color + '44';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, markerSize, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
          }
        }

        // Type label
        ctx.font = '9px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        const label = c.isCapital ? 'CAPITAL' : c.type.toUpperCase();
        ctx.fillText(label, sp.x, sp.y + visualSize + 11);

        // Distance
        ctx.fillStyle = CIC_CONFIG.colors.text;
        ctx.font = '8px monospace';
        ctx.fillText(`${(c.distance / 1000).toFixed(1)}k`, sp.x, sp.y + visualSize + 21);

        // HP bar for tracked targets
        if (c.hp != null && c.maxHp) {
          const barW = 24, barH = 3;
          const hpRatio = Math.max(0, c.hp / c.maxHp);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sp.x - barW / 2, sp.y - visualSize - 8, barW, barH);
          ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#fbbf24' : '#ef4444';
          ctx.fillRect(sp.x - barW / 2, sp.y - visualSize - 8, barW * hpRatio, barH);
        }
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = CIC_CONFIG.colors.selected;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const selR = visualSize + 8;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, selR, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // === BOX-SELECT RECTANGLE ===
    if (cicBoxSelecting) {
      const bx0 = Math.min(cicBoxStart.x, cicBoxEnd.x);
      const by0 = Math.min(cicBoxStart.y, cicBoxEnd.y);
      const bw  = Math.abs(cicBoxEnd.x - cicBoxStart.x);
      const bh  = Math.abs(cicBoxEnd.y - cicBoxStart.y);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillStyle   = 'rgba(56, 189, 248, 0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(bx0, by0, bw, bh);
      ctx.strokeRect(bx0, by0, bw, bh);
      ctx.setLineDash([]);
    }

    // === CONTEXT MENU ===
    if (cicContextMenu.open) {
      const ITEM_H = 26, MENU_W = 160;
      const mx = cicContextMenu.screenX;
      const my = cicContextMenu.screenY;
      const items = cicContextMenu.items;
      const menuH = items.length * ITEM_H;
      ctx.fillStyle = 'rgba(4, 12, 28, 0.95)';
      ctx.strokeStyle = 'rgba(80, 160, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.fillRect(mx, my, MENU_W, menuH);
      ctx.strokeRect(mx, my, MENU_W, menuH);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const iy = my + i * ITEM_H;
        if (i > 0) {
          ctx.strokeStyle = 'rgba(80, 160, 255, 0.25)';
          ctx.beginPath(); ctx.moveTo(mx, iy); ctx.lineTo(mx + MENU_W, iy); ctx.stroke();
        }
        const disabled = !item.action;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = disabled ? 'rgba(148, 163, 184, 0.35)' : '#94d4ff';
        ctx.fillText('▶ ' + item.label, mx + 10, iy + 17);
      }
    }

    // === CRUISE NAV MARKER ===
    if (window.cruiseNav?.active && window.cruiseNav.target) {
      const ct = window.cruiseNav.target;
      const ctScr = toScreen(ct.x, ct.y);
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      const cmk = 10;
      ctx.beginPath();
      ctx.moveTo(ctScr.x, ctScr.y - cmk);
      ctx.lineTo(ctScr.x + cmk, ctScr.y);
      ctx.lineTo(ctScr.x, ctScr.y + cmk);
      ctx.lineTo(ctScr.x - cmk, ctScr.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.fillText('CRUISE TARGET', ctScr.x, ctScr.y + cmk + 12);
      ctx.restore();
    }

    // === HUD OVERLAY ===
    // Top-left: CIC title
    ctx.fillStyle = CIC_CONFIG.colors.textBright;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(isSystemScale ? 'CIC — SYSTEM OVERVIEW' : 'COMBAT INFORMATION CENTER', 20, 30);

    // Contact count
    ctx.font = '11px monospace';
    ctx.fillStyle = CIC_CONFIG.colors.text;
    const hostileCount = cicContacts.filter(c => c.hostile && !c.isGhost).length;
    const ghostCount = cicContacts.filter(c => c.isGhost).length;
    ctx.fillText(`CONTACTS: ${cicContacts.length}  HOSTILE: ${hostileCount}  GHOSTS: ${ghostCount}`, 20, 50);

    // Zoom level
    const viewRadius = Math.round((W / 2) / cicZoom);
    const viewLabel = viewRadius > 50000 ? `${(viewRadius / 3000).toFixed(0)} AU` : `${(viewRadius / 1000).toFixed(0)}km`;
    ctx.fillText(`ZOOM: ${cicZoom.toFixed(4)}  VIEW: ±${viewLabel}`, 20, 66);

    // Probe status
    const probes = SensorSystem.getProbes();
    const probeCd = SensorSystem.getProbeCooldown();
    ctx.fillText(`PROBES: ${probes.length}/${SensorSystem.config.maxProbes}  CD: ${probeCd > 0 ? probeCd.toFixed(1) + 's' : 'READY'}`, 20, 82);

    // Drone status
    const DroneSystem = window.SpotterDroneSystem;
    if (DroneSystem) {
      const drones = DroneSystem.getDrones();
      const droneCd = DroneSystem.getCooldown();
      ctx.fillText(`DRONES: ${drones.length}/${DroneSystem.config.maxDrones}  CD: ${droneCd > 0 ? droneCd.toFixed(1) + 's' : 'READY'}`, 20, 98);
    }

    // Selected target info panel (bottom right) — shows first selected contact
    const _panelTarget = cicSelectedContacts[0]?.entity || null;
    if (_panelTarget && !_panelTarget.dead) {
      const t = _panelTarget;
      const panelX = W - 260;
      const panelY = H - 180;

      ctx.fillStyle = 'rgba(4, 12, 24, 0.85)';
      ctx.strokeStyle = CIC_CONFIG.colors.selected;
      ctx.lineWidth = 1;
      ctx.fillRect(panelX, panelY, 240, 160);
      ctx.strokeRect(panelX, panelY, 240, 160);

      ctx.fillStyle = CIC_CONFIG.colors.textBright;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TARGET DATA', panelX + 10, panelY + 20);

      ctx.font = '10px monospace';
      ctx.fillStyle = CIC_CONFIG.colors.text;
      const dist = Math.hypot(t.x - ship.pos.x, t.y - ship.pos.y);
      const lines = [
        `TYPE: ${(t.type || 'UNKNOWN').toUpperCase()}${t.subType ? ' / ' + t.subType.toUpperCase() : ''}`,
        `DIST: ${(dist / 1000).toFixed(1)}km (${dist.toFixed(0)}u)`,
        `HULL: ${t.hp?.toFixed(0) || '?'} / ${t.maxHp?.toFixed(0) || '?'}`,
        `SHLD: ${t.shield?.val?.toFixed(0) || '0'} / ${t.shield?.max?.toFixed(0) || '0'}`,
        `STAT: ${t.isCapitalShip ? 'CAPITAL' : t.friendly ? 'FRIENDLY' : 'HOSTILE'}`,
        `BEAR: ${((Math.atan2(t.y - ship.pos.y, t.x - ship.pos.x) * 180 / Math.PI + 360) % 360).toFixed(0)}°`,
      ];
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], panelX + 10, panelY + 40 + i * 16);
      }

      // Selection info
      ctx.fillStyle = '#38bdf8';
      const selCount = cicSelectedContacts.length;
      const hint = selCount > 1
        ? `${selCount} ZAZNACZONE  [PPM] ATAK`
        : '[PPM] ATAK / RUCH / CRUISE / DRONE';
      ctx.fillText(hint, panelX + 10, panelY + 148);
    }

    // Bottom center: key hints
    ctx.fillStyle = CIC_CONFIG.colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    if (isSystemScale) {
      ctx.fillText('[TAB] Zamknij    [V] Widok taktyczny    [SCROLL] Zoom    [WSAD/MMB] Pan    [LMB] Zaznacz    [PPM] Rozkaz', W / 2, H - 16);
    } else {
      ctx.fillText('[TAB] Zamknij    [V] Widok systemu    [SCROLL] Zoom    [WSAD/MMB] Pan    [LMB] Zaznacz/Box    [PPM] Atak/Ruch/Cruise/Drone', W / 2, H - 16);
    }

    ctx.restore();
  },
};

// =============================================================================
// SOLAR SYSTEM RENDERING FOR CIC
// =============================================================================

const PLANET_COLORS = {
  mercury: '#b0a090',
  venus:   '#e6c87a',
  earth:   '#4a90d9',
  mars:    '#c96840',
  jupiter: '#d4a56a',
  saturn:  '#c9b87a',
  uranus:  '#7ec8c8',
  neptune: '#4466bb',
};

// Kolory typów asteroid na CIC (NATO-style tactical contacts).
const ASTEROID_CIC_COLORS = {
  iron:    '#a87a55',
  copper:  '#d97742',
  silicon: '#8aa0b8',
  titan:   '#c8d0d6',
  crystal: '#b886d4',
  ice:     '#9ed2ec',
  uran:    '#5fc77e',
};

// Promień kropki na CIC zależnie od klasy rozmiaru asteroidy.
const ASTEROID_CIC_DOT = {
  S:   0.7,
  M:   1.1,
  L:   1.7,
  BIG: 2.6,
};

// =============================================================================
// ASTEROID RENDERING ON CIC
// =============================================================================

// Kolory regionów pasów - półprzezroczyste, dominujący skład.
const BELT_FILL = {
  main:    'rgba(168, 122, 85, 0.18)',   // brąz (iron/silicon/copper)
  kuiper:  'rgba(158, 210, 236, 0.18)',  // jasny błękit (ice/crystal/uran)
  greeks:  'rgba(168, 122, 85, 0.22)',   // brąz, gęściej (klaster)
  trojans: 'rgba(168, 122, 85, 0.22)',
  hildas:  'rgba(140, 160, 184, 0.18)',  // szary z błękitem (silicon-heavy)
};
const BELT_STROKE = {
  main:    'rgba(168, 122, 85, 0.50)',
  kuiper:  'rgba(158, 210, 236, 0.50)',
  greeks:  'rgba(168, 122, 85, 0.60)',
  trojans: 'rgba(168, 122, 85, 0.60)',
  hildas:  'rgba(140, 160, 184, 0.50)',
};
const BELT_LABEL = {
  main:    'MAIN BELT',
  kuiper:  'KUIPER BELT',
  greeks:  'GREEKS (L4)',
  trojans: 'TROJANS (L5)',
  hildas:  'HILDAS',
};

/**
 * Rysuje 5 pasów asteroid jako półprzezroczyste regiony. Geometria z BELT_DEFINITIONS.
 * Cel: pokazać "tutaj są asteroidy" bez renderowania 500k pojedynczych kropek.
 */
function drawAsteroidBeltRegions(ctx, sunScr, zoom, W, H) {
  if (!sunScr) return;
  const SUN = window.SUN;
  if (!SUN) return;
  // KRYTYCZNE: getAuToWorldUnits() nie jest wystawione na window. Faktyczna skala AU
  // jest w window.BASE_ORBIT (~40000 dla świata 10M u, nie 3000). Bez tego pasy są
  // ~13× za małe i wyglądają jak korona Słońca.
  const auToWorld = (typeof window.BASE_ORBIT === 'number' && window.BASE_ORBIT > 0)
    ? window.BASE_ORBIT
    : 3000;
  const planets = Array.isArray(window.planets) ? window.planets : [];
  const jupiter = planets.find(p => p && (p.id === 'jupiter' || p.name === 'jupiter'));

  ctx.save();
  ctx.lineWidth = 0.7;

  for (const belt of BELT_DEFINITIONS) {
    if (belt.shape === 'ring') {
      // Pierścień wokół Słońca - annulus przez fill('evenodd') z dwoma osobnymi
      // sub-paths (explicit moveTo). Wcześniejsza wersja używała thick stroke
      // z lineWidth = outerR-innerR. Przy default CIC zoom 0.08 to ~35000px
      // szerokość stroke = catastrophic perf (Canvas próbuje rasteryzować pas
      // szerszy niż ekran).
      const innerR = belt.innerAU * auToWorld * zoom;
      const outerR = belt.outerAU * auToWorld * zoom;
      if (outerR < 3) continue;

      // Annulus fill: outer disk minus inner disk via evenodd
      ctx.fillStyle = BELT_FILL[belt.id] || 'rgba(140,140,140,0.18)';
      ctx.beginPath();
      ctx.moveTo(sunScr.x + outerR, sunScr.y);
      ctx.arc(sunScr.x, sunScr.y, outerR, 0, Math.PI * 2);
      ctx.moveTo(sunScr.x + innerR, sunScr.y);
      ctx.arc(sunScr.x, sunScr.y, innerR, 0, Math.PI * 2);
      ctx.fill('evenodd');

      // Granice (cienki solid stroke - dashed był drogi i powodował dodatkowe state changes).
      ctx.strokeStyle = BELT_STROKE[belt.id] || 'rgba(140,140,140,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, innerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, outerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 0.7;

      // Etykieta przy szerokim widoku
      if (cicSystemBlend > 0.3 && outerR > 30) {
        const labelR = (innerR + outerR) / 2;
        const ly = sunScr.y - labelR;
        if (ly > 10 && ly < H - 10) {
          ctx.fillStyle = BELT_STROKE[belt.id];
          ctx.globalAlpha = 0.7;
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(BELT_LABEL[belt.id] || belt.id.toUpperCase(), sunScr.x, ly - 2);
          ctx.globalAlpha = 1;
        }
      }
    } else if (belt.shape === 'lagrange' && jupiter) {
      // Łuk wokół L4/L5 Jowisza
      const dx = jupiter.x - SUN.x;
      const dy = jupiter.y - SUN.y;
      const jR = Math.hypot(dx, dy);
      if (jR < 1) continue;
      const jAng = Math.atan2(dy, dx);
      const offset = belt.lagrange === 'L4' ? +Math.PI / 3 : -Math.PI / 3;
      const lagAng = jAng + offset;
      const spreadR = (belt.spreadAU || 6) * auToWorld;
      const innerR = (jR - spreadR / 2) * zoom;
      const outerR = (jR + spreadR / 2) * zoom;
      if (outerR < 3) continue;
      const halfArc = belt.arcSpread || 0.35;
      const angStart = lagAng - halfArc;
      const angEnd = lagAng + halfArc;

      ctx.fillStyle = BELT_FILL[belt.id];
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, outerR, angStart, angEnd);
      ctx.arc(sunScr.x, sunScr.y, innerR, angEnd, angStart, true);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = BELT_STROKE[belt.id];
      ctx.stroke();

      // Etykieta w środku klastra
      if (cicSystemBlend > 0.3) {
        const lx = sunScr.x + Math.cos(lagAng) * jR * zoom;
        const ly = sunScr.y + Math.sin(lagAng) * jR * zoom;
        if (lx > -50 && lx < W + 50 && ly > -20 && ly < H + 20) {
          ctx.fillStyle = BELT_STROKE[belt.id];
          ctx.globalAlpha = 0.8;
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(BELT_LABEL[belt.id], lx, ly - 8);
          ctx.globalAlpha = 1;
        }
      }
    } else if (belt.shape === 'triangle' && jupiter) {
      // 3 klastry w trójkącie wokół Słońca z Jowiszem w jednym wierzchołku
      const dx = jupiter.x - SUN.x;
      const dy = jupiter.y - SUN.y;
      const jAng = Math.atan2(dy, dx);
      const beltR = (belt.radiusAU || 42) * auToWorld;
      const spreadR = (belt.spreadAU || 3) * auToWorld;
      const innerR = (beltR - spreadR / 2) * zoom;
      const outerR = (beltR + spreadR / 2) * zoom;
      if (outerR < 3) continue;
      const halfArc = 0.32;

      ctx.fillStyle = BELT_FILL[belt.id];
      ctx.strokeStyle = BELT_STROKE[belt.id];

      for (let k = 0; k < 3; k++) {
        const ca = jAng + k * (Math.PI * 2 / 3);
        const angStart = ca - halfArc;
        const angEnd = ca + halfArc;
        ctx.beginPath();
        ctx.arc(sunScr.x, sunScr.y, outerR, angStart, angEnd);
        ctx.arc(sunScr.x, sunScr.y, innerR, angEnd, angStart, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      if (cicSystemBlend > 0.4) {
        // Etykieta przy jednym z klastrów (na 120° od Jowisza)
        const ca = jAng + (Math.PI * 2 / 3);
        const lx = sunScr.x + Math.cos(ca) * beltR * zoom;
        const ly = sunScr.y + Math.sin(ca) * beltR * zoom;
        if (lx > -50 && lx < W + 50 && ly > -20 && ly < H + 20) {
          ctx.fillStyle = BELT_STROKE[belt.id];
          ctx.globalAlpha = 0.7;
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(BELT_LABEL[belt.id], lx, ly - 6);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  ctx.restore();
}

/**
 * Rysuje pojedyncze asteroidy wyłącznie w zasięgu sensorów. Używa SensorSystem.getSensorSources().
 *
 * Optymalizacje krytyczne dla wydajności (przy 500k asteroid i 5 sondach):
 *   - Callback-based iteracja przez spatial.forEachInRadius - ZERO alokacji tablic
 *   - Dedup przez monotonic frame counter na asteroid._scanFrameId - ZERO alokacji Set
 *   - Stroke tylko dla BIG - oszczędza ~5µs/asteroidę na canvasie
 *   - fillRect dla małych kropek (r<2) zamiast ctx.arc - ~3× szybsze
 *   - Wczesne off-screen cull przed jakąkolwiek pracą canvasową
 */
function drawScannedAsteroids(ctx, asteroidField, toScreen, zoom, W, H) {
  const sources = window.SensorSystem?.getSensorSources?.() || [];
  if (sources.length === 0 || !asteroidField.spatial) return;

  // Frame counter dla dedup zamiast Set (zero alocation, ~3× szybciej)
  if (asteroidField._cicScanFrame === undefined) asteroidField._cicScanFrame = 0;
  const frameId = ++asteroidField._cicScanFrame;

  // KRYTYCZNE: toScreen() zwraca {x,y} nowy obiekt per call. Przy 5 sondach
  // w gęstym pasie to ~36k alokacji/klatkę = GC pressure = stutter przy każdym
  // otwarciu CIC (V8 GC pause). Inlinujemy projekcję - liczymy offsetX/Y raz.
  const _origin = toScreen(0, 0);
  const offsetX = _origin.x;
  const offsetY = _origin.y;
  // toScreen(wx, wy) = { x: offsetX + wx * zoom, y: offsetY + wy * zoom }

  ctx.save();
  ctx.lineWidth = 1;

  const cullX0 = -8, cullX1 = W + 8, cullY0 = -8, cullY1 = H + 8;
  let drawnCount = 0;
  let lastColor = null;
  let lastAlpha = -1;

  // Cap żeby first-frame stutter był bounded. ~2000 kropek wystarczy do wrażenia
  // "pełnego pola" w zasięgu skanera, więcej i tak nie rozróżnisz wzrokiem.
  const MAX_DRAWN = 2000;

  for (let s = 0; s < sources.length && drawnCount < MAX_DRAWN; s++) {
    const src = sources[s];
    if (!src || !(src.range > 0)) continue;
    const sx = src.x, sy = src.y, srange = src.range;
    const srange2 = srange * srange;

    asteroidField.spatial.forEachInRadius(sx, sy, srange, (a) => {
      if (drawnCount >= MAX_DRAWN) return;
      if (!a.alive || a._cicScanFrame === frameId) return;
      const dx = a.worldX - sx;
      const dy = a.worldY - sy;
      if (dx * dx + dy * dy > srange2) return;
      a._cicScanFrame = frameId;

      // Inline projection - ZERO alokacji obiektu per asteroid
      const scrX = offsetX + a.worldX * zoom;
      const scrY = offsetY + a.worldY * zoom;
      if (scrX < cullX0 || scrX > cullX1 || scrY < cullY0 || scrY > cullY1) return;

      const baseDot = ASTEROID_CIC_DOT[a.size] || 1.0;
      const physR = (a.scale * 0.5) * zoom;
      const r = physR > 9 ? 9 : (physR < baseDot ? baseDot : physR);
      const color = ASTEROID_CIC_COLORS[a.type] || '#8899aa';
      const alpha = a.hp < a.hpMax ? 0.65 : 0.9;

      if (color !== lastColor) { ctx.fillStyle = color; lastColor = color; }
      if (alpha !== lastAlpha) { ctx.globalAlpha = alpha; lastAlpha = alpha; }

      if (r < 1.5) {
        ctx.fillRect(scrX - r, scrY - r, r + r, r + r);
      } else {
        ctx.beginPath();
        ctx.arc(scrX, scrY, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (a.size === 'BIG' && r > 2) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(scrX - r - 2, scrY);
        ctx.lineTo(scrX + r + 2, scrY);
        ctx.moveTo(scrX, scrY - r - 2);
        ctx.lineTo(scrX, scrY + r + 2);
        ctx.stroke();
      }
      drawnCount++;
    });
  }

  // Info linijka u dołu
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#9ed2ec';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`AST SCAN: ${drawnCount} detected / ${asteroidField.count} total`, 20, H - 32);

  ctx.restore();
}

function drawSolarSystem(ctx, W, H, toScreen, zoom, gameTime) {
  const SUN = window.SUN;
  const planets = window.planets;
  if (!SUN || !planets) return;

  const isSystemScale = cicSystemBlend > 0.3;
  const sunScr = toScreen(SUN.x, SUN.y);

  // === SUN ===
  const blend = cicSystemBlend;
  const sunMinR = 3 + blend * 9;
  const sunScreenR = Math.max(sunMinR, SUN.r * zoom);
  // Sun glow
  ctx.save();
  const glowR = sunScreenR * (4 + blend * 2);
  const sunGlow = ctx.createRadialGradient(sunScr.x, sunScr.y, sunScreenR * 0.3, sunScr.x, sunScr.y, glowR);
  sunGlow.addColorStop(0, 'rgba(255, 220, 100, 0.35)');
  sunGlow.addColorStop(0.4, 'rgba(255, 180, 60, 0.12)');
  sunGlow.addColorStop(1, 'rgba(255, 140, 30, 0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunScr.x, sunScr.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Sun body
  const sunBody = ctx.createRadialGradient(sunScr.x, sunScr.y, 0, sunScr.x, sunScr.y, sunScreenR);
  sunBody.addColorStop(0, '#fff8e0');
  sunBody.addColorStop(0.5, '#ffe080');
  sunBody.addColorStop(1, '#ff9920');
  ctx.fillStyle = sunBody;
  ctx.beginPath();
  ctx.arc(sunScr.x, sunScr.y, sunScreenR, 0, Math.PI * 2);
  ctx.fill();

  // Sun label
  ctx.fillStyle = '#ffcc44';
  const sunLabelSize = Math.round(8 + blend * 4);
  ctx.font = blend > 0.5 ? `bold ${sunLabelSize}px monospace` : `${sunLabelSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('SOL', sunScr.x, sunScr.y + sunScreenR + 12 + blend * 4);
  ctx.restore();

  // === PLANET ORBITS & PLANETS ===
  for (const pl of planets) {
    if (!pl || !Number.isFinite(pl.x)) continue;

    const orbitR = pl.orbitRadius;
    const orbitScreenR = orbitR * zoom;
    const color = PLANET_COLORS[pl.id] || '#8899aa';

    // Orbit ring (only if large enough to see)
    if (orbitScreenR > 15 && orbitScreenR < W * 3) {
      ctx.save();
      ctx.strokeStyle = `rgba(60, 100, 160, ${0.15 + blend * 0.15})`;
      ctx.lineWidth = 0.7 + blend * 0.3;
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, orbitScreenR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Planet dot
    const plScr = toScreen(pl.x, pl.y);

    // Skip if off screen with margin
    if (plScr.x < -100 || plScr.x > W + 100 || plScr.y < -100 || plScr.y > H + 100) continue;

    const planetScreenR = Math.max(2, pl.r * zoom);
    const tacticalR = Math.max(3, Math.min(planetScreenR, 14));
    const systemR = Math.max(8, 10 * Math.sqrt(zoom * 500));
    const dotR = tacticalR + (systemR - tacticalR) * blend;

    ctx.save();

    // Planet glow
    const glowAlpha = 0.15 + blend * 0.1;
    const glowMul = 3 + blend;
    if (dotR > 3) {
      ctx.globalAlpha = glowAlpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = dotR * 2;
      const plGlow = ctx.createRadialGradient(plScr.x, plScr.y, dotR * 0.3, plScr.x, plScr.y, dotR * glowMul);
      plGlow.addColorStop(0, color);
      plGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = plGlow;
      ctx.beginPath();
      ctx.arc(plScr.x, plScr.y, dotR * glowMul, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // Planet body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(plScr.x, plScr.y, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Planet outline
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5 + blend * 0.3;
    ctx.lineWidth = 1 + blend;
    ctx.beginPath();
    ctx.arc(plScr.x, plScr.y, dotR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7 + blend * 0.2;
    const labelSize = Math.round(9 + blend * 4);
    ctx.font = blend > 0.5 ? `bold ${labelSize}px monospace` : `${labelSize}px monospace`;
    ctx.textAlign = 'center';
    const name = (pl.name || pl.id || '').toUpperCase();
    ctx.fillText(name, plScr.x, plScr.y + dotR + 12 + blend * 4);

    // Distance from player
    if (window.ship) {
      const dist = Math.hypot(pl.x - window.ship.pos.x, pl.y - window.ship.pos.y);
      ctx.font = `${Math.round(7 + blend * 3)}px monospace`;
      ctx.globalAlpha = 0.4 + blend * 0.2;
      const distLabel = dist > 10000
        ? `${(dist / 3000).toFixed(1)} AU`
        : `${(dist / 1000).toFixed(0)}km`;
      ctx.fillText(distLabel, plScr.x, plScr.y + dotR + 22 + blend * 6);
    }

    ctx.restore();

    // === PLANETARY ORBITAL ZONES (infrastructure ring, gravity well) ===
    const orbitRadii = window.planetOrbitRadii ? window.planetOrbitRadii(pl) : null;
    if (orbitRadii) {
      const innerR = orbitRadii.inner * zoom;
      const outerR = orbitRadii.outer * zoom;
      const gravR = orbitRadii.gravityWell * zoom;

      // Orbital zone band
      if (innerR > 3 && innerR < W * 3) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);

        ctx.beginPath();
        ctx.arc(plScr.x, plScr.y, innerR, 0, Math.PI * 2);
        ctx.stroke();

        if (outerR > 3 && outerR < W * 3) {
          ctx.beginPath();
          ctx.arc(plScr.x, plScr.y, outerR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Fill the zone band
        if (outerR > innerR) {
          ctx.globalAlpha = 0.03;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(plScr.x, plScr.y, outerR, 0, Math.PI * 2);
          ctx.arc(plScr.x, plScr.y, innerR, 0, Math.PI * 2, true);
          ctx.fill();
        }

        ctx.setLineDash([]);
        ctx.restore();
      }

      // Gravity well indicator
      if (gravR > 10 && gravR < W * 2) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = '#ff6644';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(plScr.x, plScr.y, gravR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  // === ASTEROID FIELD ===
  // Dwie fazy renderowania:
  //   1. PASY jako półprzezroczyste regiony (zawsze widoczne) - tylko "tutaj są asteroidy"
  //   2. POJEDYNCZE asteroidy tylko w zasięgu sensorów (statek/sondy/drony/stacje)
  // Bez tego CIC iterowałby 500k asteroid co klatkę przy widoku systemu.
  const asteroidField = window.asteroidField;
  if (asteroidField && asteroidField.count > 0) {
    drawAsteroidBeltRegions(ctx, sunScr, zoom, W, H);
    drawScannedAsteroids(ctx, asteroidField, toScreen, zoom, W, H);
  }

  // === STATIONS ===
  const stations = window.stations;
  if (stations) {
    for (const st of stations) {
      if (!st || !Number.isFinite(st.x)) continue;
      const stScr = toScreen(st.x, st.y);
      if (stScr.x < -50 || stScr.x > W + 50 || stScr.y < -50 || stScr.y > H + 50) continue;

      const stR = Math.max(2, (st.r || 120) * zoom);

      ctx.save();
      // Station marker — small square
      ctx.strokeStyle = '#60a5fa';
      ctx.fillStyle = 'rgba(96, 165, 250, 0.15)';
      ctx.lineWidth = 1;
      const sqSize = Math.max(3, Math.min(stR, 8));
      ctx.fillRect(stScr.x - sqSize, stScr.y - sqSize, sqSize * 2, sqSize * 2);
      ctx.strokeRect(stScr.x - sqSize, stScr.y - sqSize, sqSize * 2, sqSize * 2);

      // Station label (only if zoomed in enough)
      if (sqSize > 4) {
        ctx.fillStyle = '#60a5fa';
        ctx.globalAlpha = 0.5;
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STN', stScr.x, stScr.y + sqSize + 9);
      }
      ctx.restore();
    }
  }
}

window.CICDisplay = CICDisplay;
