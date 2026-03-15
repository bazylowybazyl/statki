// =============================================================================
// SIEGE MODE — Artillery Camera + Radar Targeting System
// =============================================================================
// - LPM: przesuwa kamerę (im dalej od centrum ekranu, tym szybciej)
// - Auto-targeting: kontakty widoczne na ekranie są automatycznie namierzane
// - PPM: odpala rakiety/torpedy w namierzone cele
// - LPM+fire: bronie siege (railgun/działa) strzelają w obszar artyleryjski
// =============================================================================

const SIEGE_CONFIG = {
  // Camera
  defaultZoom: 0.035,
  minZoom: 0.008,
  maxZoom: 0.15,
  zoomSpeed: 1.12,
  // Mouse-drag camera pan
  mousePanSensitivity: 25,    // world units per pixel offset from center, per frame
  mousePanDeadzone: 30,       // pixels from center — no movement
  mousePanMaxSpeed: 40000,    // max world units/sec camera pan
  // Gamepad
  padPanSpeed: 15000,

  // Auto-targeting
  lockBoxSize: 18,            // screen pixels — half-size of lock square
  lockMaxTargets: 8,          // max simultaneous radar locks
  lockFadeIn: 0.3,            // seconds to fully lock a target
  lockFadeOut: 0.5,           // seconds to lose lock after leaving screen

  // Artillery fire zone (siege guns — LPM)
  fireZoneW: 3000,            // world units — fire zone rectangle width
  fireZoneH: 1800,            // world units — fire zone rectangle height
  fireZoneGrowRate: 400,      // world units/sec spread growth per shot
  fireZoneShrinkRate: 800,    // world units/sec spread recovery
  fireZoneMaxGrow: 1500,      // max extra spread from firing

  // Visual
  overlayColor: 'rgba(0, 255, 80, 0.06)',
  gridColor: 'rgba(0, 255, 80, 0.12)',
  reticleColor: '#00ff55',
  reticleHostile: '#ff4444',
  rangeRingColor: 'rgba(0, 255, 80, 0.08)',
  textColor: '#88ffaa',
  scanlineAlpha: 0.03,
  gridSpacing: 5000,
  lockSquareColor: '#ff4444',
  lockSquareLockedColor: '#ffaa00',
  lockSquareFullColor: '#ffffff',
  fireZoneColor: 'rgba(255, 170, 68, 0.35)',
  fireZoneBorderColor: '#ffaa44',
};

// Radar lock entry
function createLockEntry(npc) {
  return {
    target: npc,
    lockProgress: 0,     // 0..1, 1 = fully locked
    age: 0,
    screenX: 0,
    screenY: 0,
    inView: true,
  };
}

function createSiegeState() {
  return {
    active: false,
    camX: 0,
    camY: 0,
    camZoom: SIEGE_CONFIG.defaultZoom,
    transitionAlpha: 0,
    // Mouse-drag panning
    mouseDragging: false,
    mouseAnchorX: 0,          // screen pixel where LPM was pressed
    mouseAnchorY: 0,
    // Radar locks
    locks: [],                // array of lock entries
    // Fire zone (siege guns)
    fireZoneActive: false,    // true when LPM held → showing fire rectangle
    fireZoneWorldX: 0,
    fireZoneWorldY: 0,
    fireZoneSpread: 0,        // extra spread from firing
    // Missile fire feedback
    fireTimer: 0,
    // Cached viewport bounds (world)
    _vpWorldLeft: 0,
    _vpWorldRight: 0,
    _vpWorldTop: 0,
    _vpWorldBot: 0,
    _padState: null,
  };
}

const p1Siege = createSiegeState();
const p2Siege = createSiegeState();

export const SiegeMode = {
  config: SIEGE_CONFIG,
  p1: p1Siege,
  p2: p2Siege,

  getState(playerIdx) {
    return playerIdx === 1 ? p2Siege : p1Siege;
  },

  toggle(playerIdx, ship) {
    const s = this.getState(playerIdx);
    if (s.active) {
      s.active = false;
      s.locks = [];
      s.mouseDragging = false;
      s.fireZoneActive = false;
      return false;
    }
    s.active = true;
    const range = 30000;
    s.camX = ship.pos.x + Math.cos(ship.angle) * range;
    s.camY = ship.pos.y + Math.sin(ship.angle) * range;
    s.camZoom = SIEGE_CONFIG.defaultZoom;
    s.locks = [];
    s.transitionAlpha = 0;
    s.mouseDragging = false;
    s.fireZoneActive = false;
    s.fireZoneSpread = 0;
    return true;
  },

  zoom(playerIdx, direction) {
    const s = this.getState(playerIdx);
    if (!s.active) return;
    const f = direction > 0 ? (1 / SIEGE_CONFIG.zoomSpeed) : SIEGE_CONFIG.zoomSpeed;
    s.camZoom = Math.max(SIEGE_CONFIG.minZoom, Math.min(SIEGE_CONFIG.maxZoom, s.camZoom * f));
  },

  // === MOUSE-DRAG CAMERA PAN ===
  onMouseDown(playerIdx, screenX, screenY, button, vpX, vpY, vpW, vpH) {
    const s = this.getState(playerIdx);
    if (!s.active) return false;
    if (button === 0) {
      // LPM — start drag pan
      s.mouseDragging = true;
      s.mouseAnchorX = screenX;
      s.mouseAnchorY = screenY;
      return true;
    }
    if (button === 2) {
      // PPM — fire missiles at all locked targets
      this._fireMissiles(playerIdx, s);
      return true;
    }
    return false;
  },

  onMouseUp(playerIdx, button) {
    const s = this.getState(playerIdx);
    if (!s.active) return;
    if (button === 0) {
      s.mouseDragging = false;
    }
  },

  // === FIRE MISSILES AT LOCKED TARGETS ===
  _fireMissiles(playerIdx, s) {
    const fullyLocked = s.locks.filter(l => l.lockProgress >= 1.0 && l.target && !l.target.dead);
    if (fullyLocked.length === 0) return;

    s.fireTimer = 1.0;

    // Fire at each locked target via fireWeaponCore
    const ship = playerIdx === 1 ? window.player2Ship : window.ship;
    if (!ship) return;

    for (const lock of fullyLocked) {
      const t = lock.target;
      const tx = t.x ?? t.pos?.x ?? 0;
      const ty = t.y ?? t.pos?.y ?? 0;

      // Find a missile/torpedo weapon to fire
      const HP = window.HP;
      const weapons = ship.weapons;
      if (!weapons || !HP) continue;

      const missileSlots = weapons[HP.MISSILE] || [];
      for (const loadout of missileSlots) {
        if (!loadout?.weapon || !loadout?.hp) continue;
        const hp = loadout.hp;
        if (hp.ammo !== undefined && hp.ammo <= 0) continue;
        if (hp.missileCd > 0) continue;

        // Fire this missile at the target
        if (window.fireWeaponCore) {
          window.fireWeaponCore(ship, t, loadout.weapon.id, {
            x: ship.pos.x, y: ship.pos.y,
            angle: Math.atan2(ty - ship.pos.y, tx - ship.pos.x),
          });
          if (hp.ammo !== undefined) hp.ammo--;
          hp.missileCd = loadout.weapon.cooldown || 2.0;
        }
        break; // one missile per target per click
      }
    }
  },

  // === FIRE SIEGE GUNS AT AREA ===
  fireSiegeGuns(playerIdx) {
    const s = this.getState(playerIdx);
    if (!s.active) return;

    const ship = playerIdx === 1 ? window.player2Ship : window.ship;
    if (!ship) return;

    // Fire zone center = camera center
    s.fireZoneWorldX = s.camX;
    s.fireZoneWorldY = s.camY;
    s.fireZoneActive = true;
    s.fireTimer = 1.5;
    s.fireZoneSpread = Math.min(SIEGE_CONFIG.fireZoneMaxGrow,
      s.fireZoneSpread + SIEGE_CONFIG.fireZoneGrowRate);

    // Fire siege weapons (SPECIAL + MAIN category 'rail' with long range)
    const HP = window.HP;
    const weapons = ship.weapons;
    if (!weapons || !HP) return;

    const specials = weapons[HP.SPECIAL] || [];
    for (const loadout of specials) {
      if (!loadout?.weapon || !loadout?.hp) continue;
      const hp = loadout.hp;
      if (hp.specialCd > 0) continue;

      // Random point in fire zone rectangle
      const zoneW = SIEGE_CONFIG.fireZoneW + s.fireZoneSpread;
      const zoneH = SIEGE_CONFIG.fireZoneH + s.fireZoneSpread * 0.6;
      const targetPos = {
        x: s.camX + (Math.random() - 0.5) * zoneW,
        y: s.camY + (Math.random() - 0.5) * zoneH,
      };

      if (window.fireWeaponCore) {
        window.fireWeaponCore(ship, targetPos, loadout.weapon.id, {
          x: ship.pos.x, y: ship.pos.y,
          angle: Math.atan2(targetPos.y - ship.pos.y, targetPos.x - ship.pos.x),
        });
        hp.specialCd = loadout.weapon.cooldown || 6.0;
      }
    }
  },

  /**
   * Update siege mode each physics tick
   */
  update(dt, playerIdx, ship, keys, mouseRef, camRef, npcs, padState) {
    const s = this.getState(playerIdx);
    if (!s.active) {
      s.transitionAlpha = Math.max(0, s.transitionAlpha - dt * 5);
      return;
    }

    s.transitionAlpha = Math.min(1, s.transitionAlpha + dt * 4);

    // === Mouse-drag camera pan ===
    if (s.mouseDragging && mouseRef) {
      const vpCx = (s._vpCenterX || 0);
      const vpCy = (s._vpCenterY || 0);
      const dx = mouseRef.x - vpCx;
      const dy = mouseRef.y - vpCy;
      const dist = Math.hypot(dx, dy);

      if (dist > SIEGE_CONFIG.mousePanDeadzone) {
        const strength = Math.min(1, (dist - SIEGE_CONFIG.mousePanDeadzone) / 300);
        const speed = strength * SIEGE_CONFIG.mousePanMaxSpeed / Math.max(0.01, s.camZoom);
        const nx = dx / dist;
        const ny = dy / dist;
        s.camX += nx * speed * dt;
        s.camY += ny * speed * dt;
      }
    }

    // === Gamepad pan (left stick) ===
    if (padState) {
      const deadzone = 0.15;
      let panX = 0, panY = 0;
      if (Math.abs(padState.lx) > deadzone) panX = padState.lx;
      if (Math.abs(padState.ly) > deadzone) panY = padState.ly;
      const speed = SIEGE_CONFIG.padPanSpeed / Math.max(0.01, s.camZoom);
      s.camX += panX * speed * dt;
      s.camY += panY * speed * dt;
    }

    // === Keyboard pan (WASD) — only if NOT mouse dragging ===
    if (keys && !s.mouseDragging) {
      let panX = 0, panY = 0;
      if (keys['w'] || keys['arrowup']) panY -= 1;
      if (keys['s'] || keys['arrowdown']) panY += 1;
      if (keys['a'] || keys['arrowleft']) panX -= 1;
      if (keys['d'] || keys['arrowright']) panX += 1;
      if (panX || panY) {
        const speed = 20000 / Math.max(0.01, s.camZoom);
        s.camX += panX * speed * dt;
        s.camY += panY * speed * dt;
      }
    }

    // === Viewport bounds (world coords) ===
    const vpW = s._vpW || 800;
    const vpH = s._vpH || 600;
    s._vpWorldLeft = s.camX - vpW / 2 / s.camZoom;
    s._vpWorldRight = s.camX + vpW / 2 / s.camZoom;
    s._vpWorldTop = s.camY - vpH / 2 / s.camZoom;
    s._vpWorldBot = s.camY + vpH / 2 / s.camZoom;

    // === AUTO-TARGETING: radar lock on visible contacts ===
    if (npcs) {
      // Mark all locks as not-in-view initially
      for (const lock of s.locks) lock.inView = false;

      for (const npc of npcs) {
        if (!npc || npc.dead || npc.friendly) continue;
        const nx = npc.x ?? npc.pos?.x ?? 0;
        const ny = npc.y ?? npc.pos?.y ?? 0;

        // Check if in viewport bounds
        const inView = nx >= s._vpWorldLeft && nx <= s._vpWorldRight &&
                        ny >= s._vpWorldTop && ny <= s._vpWorldBot;

        // Find existing lock
        let lock = s.locks.find(l => l.target === npc);

        if (inView) {
          if (!lock) {
            // New contact — start locking
            if (s.locks.length < SIEGE_CONFIG.lockMaxTargets) {
              lock = createLockEntry(npc);
              s.locks.push(lock);
            }
          }
          if (lock) {
            lock.inView = true;
            lock.age += dt;
            lock.lockProgress = Math.min(1, lock.lockProgress + dt / SIEGE_CONFIG.lockFadeIn);
          }
        } else if (lock) {
          // Out of view — fade out lock
          lock.lockProgress -= dt / SIEGE_CONFIG.lockFadeOut;
        }
      }

      // Remove dead/faded locks
      for (let i = s.locks.length - 1; i >= 0; i--) {
        const l = s.locks[i];
        if (l.lockProgress <= 0 || !l.target || l.target.dead) {
          s.locks.splice(i, 1);
        }
      }
    }

    // Fire zone spread recovery
    s.fireZoneSpread = Math.max(0, s.fireZoneSpread - SIEGE_CONFIG.fireZoneShrinkRate * dt);
    if (s.fireZoneSpread <= 0) s.fireZoneActive = false;

    // Fire timer countdown
    if (s.fireTimer > 0) s.fireTimer = Math.max(0, s.fireTimer - dt);
  },

  /**
   * Draw siege mode overlay
   */
  draw(ctx, playerIdx, ship, camRef, vpX, vpY, vpW, vpH, gameTime, npcs) {
    const s = this.getState(playerIdx);
    if (s.transitionAlpha <= 0) return;

    // Cache viewport info for update()
    s._vpW = vpW;
    s._vpH = vpH;
    s._vpCenterX = vpX + vpW / 2;
    s._vpCenterY = vpY + vpH / 2;

    const alpha = s.transitionAlpha;
    const zoom = s.camZoom;

    const w2s = (wx, wy) => ({
      x: (wx - s.camX) * zoom + vpX + vpW / 2,
      y: (wy - s.camY) * zoom + vpY + vpH / 2,
    });

    ctx.save();
    ctx.globalAlpha = alpha;

    // === Background tint ===
    ctx.fillStyle = SIEGE_CONFIG.overlayColor;
    ctx.fillRect(vpX, vpY, vpW, vpH);

    // === Scanlines ===
    ctx.globalAlpha = alpha * SIEGE_CONFIG.scanlineAlpha;
    ctx.fillStyle = '#000';
    for (let y = vpY; y < vpY + vpH; y += 3) {
      ctx.fillRect(vpX, y, vpW, 1);
    }
    ctx.globalAlpha = alpha;

    // === Grid ===
    const gridSpacing = SIEGE_CONFIG.gridSpacing;
    const worldLeft = s._vpWorldLeft;
    const worldRight = s._vpWorldRight;
    const worldTop = s._vpWorldTop;
    const worldBot = s._vpWorldBot;

    ctx.strokeStyle = SIEGE_CONFIG.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gStartX = Math.floor(worldLeft / gridSpacing) * gridSpacing;
    const gStartY = Math.floor(worldTop / gridSpacing) * gridSpacing;
    for (let gx = gStartX; gx <= worldRight; gx += gridSpacing) {
      const sx = w2s(gx, 0).x;
      ctx.moveTo(sx, vpY); ctx.lineTo(sx, vpY + vpH);
    }
    for (let gy = gStartY; gy <= worldBot; gy += gridSpacing) {
      const sy = w2s(0, gy).y;
      ctx.moveTo(vpX, sy); ctx.lineTo(vpX + vpW, sy);
    }
    ctx.stroke();

    // === Range rings from ship ===
    const shipScreen = w2s(ship.pos.x, ship.pos.y);
    const distToShip = Math.hypot(s.camX - ship.pos.x, s.camY - ship.pos.y);
    ctx.strokeStyle = SIEGE_CONFIG.rangeRingColor;
    ctx.lineWidth = 1;
    const ringSpacing = 20000;
    const maxRingDist = distToShip + 60000;
    for (let r = ringSpacing; r <= maxRingDist; r += ringSpacing) {
      const rPx = r * zoom;
      if (rPx < 20) continue;
      ctx.beginPath();
      ctx.arc(shipScreen.x, shipScreen.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = SIEGE_CONFIG.textColor;
      ctx.font = '10px monospace';
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillText(`${(r / 1000).toFixed(0)}km`, shipScreen.x + rPx + 4, shipScreen.y - 4);
      ctx.globalAlpha = alpha;
    }

    // === Ship position indicator ===
    ctx.fillStyle = '#44ff88';
    ctx.globalAlpha = alpha * 0.7;
    const sa = Math.atan2(s.camY - ship.pos.y, s.camX - ship.pos.x);
    ctx.save();
    ctx.translate(shipScreen.x, shipScreen.y);
    ctx.rotate(sa);
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;

    // === Draw NPC contacts + radar lock squares ===
    if (npcs) {
      for (const npc of npcs) {
        if (!npc || npc.dead) continue;
        const nx = npc.x ?? npc.pos?.x ?? 0;
        const ny = npc.y ?? npc.pos?.y ?? 0;
        const ns = w2s(nx, ny);
        if (ns.x < vpX - 40 || ns.x > vpX + vpW + 40 ||
            ns.y < vpY - 40 || ns.y > vpY + vpH + 40) continue;

        const isHostile = !npc.friendly;
        const sz = Math.max(4, (npc.radius || 100) * zoom);

        // Diamond marker (all contacts)
        ctx.strokeStyle = isHostile ? SIEGE_CONFIG.reticleHostile : '#44ff88';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ns.x, ns.y - sz);
        ctx.lineTo(ns.x + sz, ns.y);
        ctx.lineTo(ns.x, ns.y + sz);
        ctx.lineTo(ns.x - sz, ns.y);
        ctx.closePath();
        ctx.stroke();

        // NPC label
        ctx.fillStyle = isHostile ? '#ff6666' : '#66ff99';
        ctx.font = '10px monospace';
        ctx.fillText(npc.name || npc.type || 'CONTACT', ns.x + sz + 4, ns.y - 2);
        const npcDist = Math.hypot(nx - ship.pos.x, ny - ship.pos.y);
        ctx.fillText(`${(npcDist / 1000).toFixed(1)}km`, ns.x + sz + 4, ns.y + 10);
      }
    }

    // === RADAR LOCK SQUARES (auto-targeting) ===
    const boxSz = SIEGE_CONFIG.lockBoxSize;
    for (const lock of s.locks) {
      const t = lock.target;
      if (!t || t.dead) continue;
      const tx = t.x ?? t.pos?.x ?? 0;
      const ty = t.y ?? t.pos?.y ?? 0;
      const ts = w2s(tx, ty);

      const prog = lock.lockProgress;
      const locked = prog >= 1.0;

      // Animate lock square size
      const animSz = boxSz * (1 + (1 - prog) * 1.5); // starts big, shrinks to box size

      // Color by lock state
      ctx.strokeStyle = locked ? SIEGE_CONFIG.lockSquareFullColor : SIEGE_CONFIG.lockSquareLockedColor;
      ctx.lineWidth = locked ? 2 : 1;
      ctx.globalAlpha = alpha * Math.min(1, prog * 2);

      // Draw lock square
      ctx.strokeRect(ts.x - animSz, ts.y - animSz, animSz * 2, animSz * 2);

      if (locked) {
        // Corner ticks for fully locked
        const tl = 6;
        ctx.beginPath();
        ctx.moveTo(ts.x - animSz, ts.y - animSz + tl);
        ctx.lineTo(ts.x - animSz, ts.y - animSz);
        ctx.lineTo(ts.x - animSz + tl, ts.y - animSz);

        ctx.moveTo(ts.x + animSz - tl, ts.y - animSz);
        ctx.lineTo(ts.x + animSz, ts.y - animSz);
        ctx.lineTo(ts.x + animSz, ts.y - animSz + tl);

        ctx.moveTo(ts.x + animSz, ts.y + animSz - tl);
        ctx.lineTo(ts.x + animSz, ts.y + animSz);
        ctx.lineTo(ts.x + animSz - tl, ts.y + animSz);

        ctx.moveTo(ts.x - animSz + tl, ts.y + animSz);
        ctx.lineTo(ts.x - animSz, ts.y + animSz);
        ctx.lineTo(ts.x - animSz, ts.y + animSz - tl);
        ctx.stroke();

        // "LOCKED" label
        ctx.fillStyle = '#ffffff';
        ctx.font = '9px monospace';
        ctx.fillText('LOCKED', ts.x - animSz, ts.y - animSz - 4);
      } else {
        // Lock progress bar
        ctx.fillStyle = SIEGE_CONFIG.lockSquareLockedColor;
        const barW = animSz * 2 * prog;
        ctx.fillRect(ts.x - animSz, ts.y + animSz + 3, barW, 2);
      }

      ctx.globalAlpha = alpha;
    }

    // === FIRE ZONE rectangle (siege guns area) ===
    if (s.fireZoneActive) {
      const fzW = (SIEGE_CONFIG.fireZoneW + s.fireZoneSpread) * zoom;
      const fzH = (SIEGE_CONFIG.fireZoneH + s.fireZoneSpread * 0.6) * zoom;
      const fzS = w2s(s.fireZoneWorldX, s.fireZoneWorldY);

      ctx.fillStyle = SIEGE_CONFIG.fireZoneColor;
      ctx.fillRect(fzS.x - fzW / 2, fzS.y - fzH / 2, fzW, fzH);

      ctx.strokeStyle = SIEGE_CONFIG.fireZoneBorderColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(fzS.x - fzW / 2, fzS.y - fzH / 2, fzW, fzH);
      ctx.setLineDash([]);

      // Corner crosses
      ctx.lineWidth = 1;
      const c = 8;
      for (const [cx, cy] of [
        [fzS.x - fzW / 2, fzS.y - fzH / 2],
        [fzS.x + fzW / 2, fzS.y - fzH / 2],
        [fzS.x - fzW / 2, fzS.y + fzH / 2],
        [fzS.x + fzW / 2, fzS.y + fzH / 2],
      ]) {
        ctx.beginPath();
        ctx.moveTo(cx - c, cy); ctx.lineTo(cx + c, cy);
        ctx.moveTo(cx, cy - c); ctx.lineTo(cx, cy + c);
        ctx.stroke();
      }

      // "FIRE ZONE" label
      ctx.fillStyle = SIEGE_CONFIG.fireZoneBorderColor;
      ctx.font = '11px monospace';
      ctx.fillText('STREFA OSTRZAŁU', fzS.x - fzW / 2, fzS.y - fzH / 2 - 6);
    }

    // === Center reticle ===
    const cx = vpX + vpW / 2;
    const cy = vpY + vpH / 2;
    const chSize = 30;
    const chGap = 8;

    ctx.strokeStyle = SIEGE_CONFIG.reticleColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - chSize, cy); ctx.lineTo(cx - chGap, cy);
    ctx.moveTo(cx + chGap, cy); ctx.lineTo(cx + chSize, cy);
    ctx.moveTo(cx, cy - chSize); ctx.lineTo(cx, cy - chGap);
    ctx.moveTo(cx, cy + chGap); ctx.lineTo(cx, cy + chSize);
    ctx.stroke();

    ctx.fillStyle = SIEGE_CONFIG.reticleColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    // === HUD text ===
    ctx.font = '12px monospace';
    ctx.fillStyle = SIEGE_CONFIG.textColor;
    const hudX = vpX + 16;
    const hudY = vpY + 30;

    const lockedCount = s.locks.filter(l => l.lockProgress >= 1).length;
    const totalLocks = s.locks.length;

    ctx.fillText('SIEGE MODE', hudX, hudY);
    ctx.fillText(`RNG: ${(distToShip / 1000).toFixed(1)} km`, hudX, hudY + 16);
    ctx.fillText(`BRG: ${(((Math.atan2(s.camY - ship.pos.y, s.camX - ship.pos.x) * 180 / Math.PI) + 360) % 360).toFixed(0)}°`, hudX, hudY + 32);
    ctx.fillText(`TGT: ${lockedCount}/${totalLocks} LOCKED`, hudX, hudY + 48);

    // ETA
    if (distToShip > 1000) {
      const etaRail = distToShip / 25000;
      const etaTorp = distToShip / 600;
      ctx.fillStyle = SIEGE_CONFIG.textColor;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillText(`ETA Rail: ${etaRail.toFixed(1)}s  Torp: ${etaTorp.toFixed(1)}s`, hudX, vpY + vpH - 20);
      ctx.globalAlpha = alpha;
    }

    // Fire flash feedback
    if (s.fireTimer > 0) {
      ctx.fillStyle = `rgba(255, 255, 200, ${s.fireTimer * 0.15})`;
      ctx.fillRect(vpX, vpY, vpW, vpH);
    }

    // Controls label
    ctx.font = '13px monospace';
    ctx.fillStyle = SIEGE_CONFIG.reticleColor;
    ctx.textAlign = 'center';
    ctx.fillText('[ Y ] ZAMKNIJ  |  LPM PRZESUŃ  |  PPM RAKIETY  |  SCROLL ZOOM', vpX + vpW / 2, vpY + vpH - 40);
    if (lockedCount > 0) {
      ctx.fillStyle = '#ffaa44';
      ctx.fillText(`${lockedCount} ${lockedCount === 1 ? 'CEL NAMIERZONY' : 'CELE NAMIERZONE'} — PPM ABY ODPALIĆ`, vpX + vpW / 2, vpY + vpH - 58);
    }
    ctx.textAlign = 'left';

    ctx.restore();
  },

  isActive(playerIdx) {
    return this.getState(playerIdx).active;
  },

  getSiegeCamera(playerIdx, vpX, vpY, vpW, vpH) {
    const s = this.getState(playerIdx);
    if (!s.active || s.transitionAlpha < 0.5) return null;
    return {
      x: s.camX,
      y: s.camY,
      zoom: s.camZoom,
      viewportX: vpX,
      viewportY: vpY,
      viewportW: vpW,
      viewportH: vpH,
    };
  },
};
