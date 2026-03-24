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
  zoomMin: 0.0002,         // far enough to see full solar system at any resolution
  zoomMax: 0.4,
  zoomSpeed: 0.0004,
  sweepSpeed: 0.6,          // radians per second
  sweepRange: 60000,        // radar sweep max range (world units)
  gridSpacing: 10000,       // world units between grid lines
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
// items: array of { label, action: 'attack'|'move'|'cruise'|null (disabled) }
let cicContextMenu = {
  open: false,
  screenX: 0, screenY: 0,
  worldX: 0, worldY: 0,
  targetEntity: null,   // non-null when opened on enemy contact
  items: [],
};

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
    }
    return cicActive;
  },

  close() {
    cicActive = false;
    cicSystemBlend = 0;
    cicBoxSelecting = false;
    cicSelectedContacts = [];
    cicContextMenu.open = false;
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
        if (ddx * ddx + ddy * ddy < 400) { hitContact = c; break; } // 20px radius
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
        cicContextMenu.items = [
          { label: 'ATAK', action: hasSelected ? 'attack' : null },
          { label: 'RUCH', action: 'move' },
          { label: 'CRUISE TO', action: 'cruise' },
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
          if (ddx * ddx + ddy * ddy < 225) {
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
    ctx.save();
    ctx.translate(shipScr.x, shipScr.y);
    if (isSystemScale) {
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
    } else {
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
    }
    ctx.restore();

    // === CONTACTS ===
    for (const c of cicContacts) {
      const sp = toScreen(c.x, c.y);
      c.screenX = sp.x;
      c.screenY = sp.y;

      // Skip if off screen
      if (sp.x < -50 || sp.x > W + 50 || sp.y < -50 || sp.y > H + 50) continue;

      const isSelected = c.entity && cicSelectedContacts.some(s => s.entity === c.entity);
      const size = Math.max(5, Math.min(14, c.radius * cicZoom * 2));

      if (c.isGhost) {
        // Ghost: dashed diamond
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - size); ctx.lineTo(sp.x + size, sp.y);
        ctx.lineTo(sp.x, sp.y + size); ctx.lineTo(sp.x - size, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        continue;
      }

      // Determine color
      let color = CIC_CONFIG.colors.unknown;
      if (c.friendly) color = CIC_CONFIG.colors.friendly;
      else if (c.hostile) color = CIC_CONFIG.colors.hostile;
      if (isSelected) color = CIC_CONFIG.colors.selected;

      ctx.save();

      // DETECTED: small diamond, no detail
      if (c.awareness === (window.SensorSystem?.AWARENESS?.DETECTED || 2)) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - size); ctx.lineTo(sp.x + size, sp.y);
        ctx.lineTo(sp.x, sp.y + size); ctx.lineTo(sp.x - size, sp.y);
        ctx.closePath(); ctx.stroke();
        ctx.font = '8px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(c.type.toUpperCase(), sp.x, sp.y + size + 10);
      } else {
        // TRACKED: full marker
        // NATO-style: hostile = diamond filled, friendly = circle, capital = larger
        if (c.hostile) {
          ctx.fillStyle = color + '44';
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          const s2 = c.isCapital ? size * 1.8 : size;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y - s2); ctx.lineTo(sp.x + s2, sp.y);
          ctx.lineTo(sp.x, sp.y + s2); ctx.lineTo(sp.x - s2, sp.y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = color + '44';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, size, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }

        // Type label
        ctx.font = '9px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        const label = c.isCapital ? 'CAPITAL' : c.type.toUpperCase();
        ctx.fillText(label, sp.x, sp.y + size + 11);

        // Distance
        ctx.fillStyle = CIC_CONFIG.colors.text;
        ctx.font = '8px monospace';
        ctx.fillText(`${(c.distance / 1000).toFixed(1)}k`, sp.x, sp.y + size + 21);

        // HP bar for tracked targets
        if (c.hp != null && c.maxHp) {
          const barW = 24, barH = 3;
          const hpRatio = Math.max(0, c.hp / c.maxHp);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sp.x - barW / 2, sp.y - size - 8, barW, barH);
          ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#fbbf24' : '#ef4444';
          ctx.fillRect(sp.x - barW / 2, sp.y - size - 8, barW * hpRatio, barH);
        }
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = CIC_CONFIG.colors.selected;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const selR = size + 8;
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
        : '[PPM] ATAK / RUCH / CRUISE';
      ctx.fillText(hint, panelX + 10, panelY + 148);
    }

    // Bottom center: key hints
    ctx.fillStyle = CIC_CONFIG.colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    if (isSystemScale) {
      ctx.fillText('[TAB] Zamknij    [V] Widok taktyczny    [SCROLL] Zoom    [MMB] Pan    [LMB] Zaznacz    [PPM] Rozkaz', W / 2, H - 16);
    } else {
      ctx.fillText('[TAB] Zamknij    [V] Widok systemu    [SCROLL] Zoom    [MMB] Pan    [LMB] Zaznacz/Box    [PPM] Atak/Ruch/Cruise', W / 2, H - 16);
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

  // === ASTEROID BELT ===
  if (window.ASTEROID_BELT) {
    const belt = window.ASTEROID_BELT;
    const innerR = belt.inner * zoom;
    const outerR = belt.outer * zoom;

    if (innerR > 8 && innerR < W * 4) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = '#8899aa';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, innerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, outerR, 0, Math.PI * 2);
      ctx.stroke();

      // Fill belt band
      ctx.globalAlpha = 0.02;
      ctx.fillStyle = '#8899aa';
      ctx.beginPath();
      ctx.arc(sunScr.x, sunScr.y, outerR, 0, Math.PI * 2);
      ctx.arc(sunScr.x, sunScr.y, innerR, 0, Math.PI * 2, true);
      ctx.fill();

      // Label
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#8899aa';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ASTEROID BELT', sunScr.x, sunScr.y - (innerR + outerR) / 2 - 6);

      ctx.setLineDash([]);
      ctx.restore();
    }
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
