// =============================================================================
// SPOTTER DRONE SYSTEM
// =============================================================================
// Autonomous recon drones that:
// - Fly to designated position
// - Provide sensor coverage (integrated with SensorSystem)
// - Can be destroyed by enemies
// - Show PiP (Picture-in-Picture) camera view
// =============================================================================

const DRONE_CONFIG = {
  maxDrones: 3,
  speed: 40000,            // max world units per second
  accel: 26000,            // smooth acceleration toward cruise speed
  brakeAccel: 42000,       // stronger braking so drone can settle on target
  turnRate: 2.5,           // radians per second
  hp: 80,
  sensorRange: 25000,
  pipSize: { w: 280, h: 200 },
  pipMargin: 16,
  pipZoom: 0.25,           // zoom level for the PiP view
  deployRange: 80000,      // max distance from ship to deploy
  lifetime: 90,            // seconds before drone runs out of fuel (0 = infinite)
  cooldown: 5,             // seconds between drone launches
  arriveRadius: 300,
};

const drones = [];
let droneCooldown = 0;
let droneIdCounter = 0;
let activePipDrone = null; // which drone's PiP is showing

export const SpotterDroneSystem = {
  config: DRONE_CONFIG,

  getDrones() { return drones; },
  getActivePip() { return activePipDrone; },
  getCooldown() { return droneCooldown; },

  init() {
    drones.length = 0;
    droneCooldown = 0;
    droneIdCounter = 0;
    activePipDrone = null;
  },

  /**
   * Deploy a drone toward target world position.
   * @returns {boolean} success
   */
  deploy(shipX, shipY, targetX, targetY) {
    if (droneCooldown > 0) return false;
    if (drones.length >= DRONE_CONFIG.maxDrones) {
      // Destroy oldest
      drones.shift();
    }

    const id = 'drone_' + (++droneIdCounter);
    const angle = Math.atan2(targetY - shipY, targetX - shipX);

    drones.push({
      id,
      x: shipX,
      y: shipY,
      targetX, targetY,
      angle,
      speed: 0,
      hp: DRONE_CONFIG.hp,
      maxHp: DRONE_CONFIG.hp,
      sensorRange: DRONE_CONFIG.sensorRange,
      age: 0,
      lifetime: DRONE_CONFIG.lifetime,
      state: 'transit',    // 'transit' | 'station' | 'returning' | 'destroyed'
      pulsePhase: 0,
      dead: false,
    });

    droneCooldown = DRONE_CONFIG.cooldown;
    if (!activePipDrone || activePipDrone.dead) {
      activePipDrone = drones[drones.length - 1];
    }

    return true;
  },

  /**
   * Cycle PiP to next alive drone.
   */
  cyclePip() {
    const alive = drones.filter(d => !d.dead);
    if (alive.length === 0) { activePipDrone = null; return; }
    const idx = alive.indexOf(activePipDrone);
    activePipDrone = alive[(idx + 1) % alive.length];
  },

  /**
   * Recall all drones.
   */
  recallAll(shipX, shipY) {
    for (const d of drones) {
      if (d.dead) continue;
      d.state = 'returning';
      d.targetX = shipX;
      d.targetY = shipY;
    }
  },

  /**
   * Update all drones.
   */
  update(dt, ship, npcs) {
    if (droneCooldown > 0) droneCooldown = Math.max(0, droneCooldown - dt);

    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i];
      if (d.dead) { drones.splice(i, 1); continue; }

      d.age += dt;
      d.pulsePhase = (d.pulsePhase + dt) % (Math.PI * 2);

      // Fuel check
      if (d.lifetime > 0 && d.age >= d.lifetime) {
        d.dead = true;
        if (activePipDrone === d) this.cyclePip();
        continue;
      }

      // Movement
      if (d.state === 'transit' || d.state === 'returning') {
        const dx = d.targetX - d.x;
        const dy = d.targetY - d.y;
        const dist = Math.hypot(dx, dy);
        const arriveRadius = DRONE_CONFIG.arriveRadius;

        if (dist < arriveRadius && d.speed < 1200) {
          d.speed = 0;
          if (d.state === 'transit') {
            d.state = 'station';
          } else {
            // Returned — remove drone
            d.dead = true;
            if (activePipDrone === d) this.cyclePip();
            continue;
          }
        } else {
          // Steer toward target
          const desired = Math.atan2(dy, dx);
          const diff = wrapAngle(desired - d.angle);
          const maxTurn = DRONE_CONFIG.turnRate * dt;
          d.angle += Math.abs(diff) < maxTurn ? diff : Math.sign(diff) * maxTurn;

          const turnPenalty = Math.max(0.2, Math.cos(Math.min(Math.abs(diff), Math.PI * 0.5)));
          const maxApproachSpeed = Math.sqrt(Math.max(0, 2 * DRONE_CONFIG.brakeAccel * Math.max(0, dist - arriveRadius)));
          const desiredSpeed = Math.min(DRONE_CONFIG.speed * turnPenalty, maxApproachSpeed);

          if (d.speed < desiredSpeed) {
            d.speed = Math.min(desiredSpeed, d.speed + DRONE_CONFIG.accel * dt);
          } else {
            d.speed = Math.max(desiredSpeed, d.speed - DRONE_CONFIG.brakeAccel * dt);
          }

          d.x += Math.cos(d.angle) * d.speed * dt;
          d.y += Math.sin(d.angle) * d.speed * dt;
        }
      }

      // Station keeping — slight orbit
      if (d.state === 'station') {
        d.angle += 0.1 * dt;
        d.x = d.targetX + Math.cos(d.age * 0.3) * 150;
        d.y = d.targetY + Math.sin(d.age * 0.3) * 150;
      }

      // Check for damage from nearby hostile NPCs (simplified — they shoot at drone)
      if (npcs) {
        for (const npc of npcs) {
          if (!npc || npc.dead || npc.friendly) continue;
          const dist = Math.hypot(npc.x - d.x, npc.y - d.y);
          // NPCs within 2000u will try to shoot down the drone
          if (dist < 2000 && Math.random() < 0.005) { // ~0.5% per frame per NPC
            d.hp -= 15;
            if (d.hp <= 0) {
              d.dead = true;
              if (activePipDrone === d) this.cyclePip();
            }
          }
        }
      }
    }

    // Clean up dead PiP reference
    if (activePipDrone && activePipDrone.dead) {
      this.cyclePip();
    }
  },

  /**
   * Get sensor sources from drones (to register with SensorSystem).
   */
  populateSensorSources(getNextSourceFn) {
    for (let i=0; i<drones.length; i++) {
      const d = drones[i];
      if (!d.dead) {
        const src = getNextSourceFn();
        src.x = d.x; src.y = d.y; src.range = d.sensorRange; src.type = 'drone';
      }
    }
  },

  /**
   * Draw drones on main canvas.
   */
  drawDrones(ctx, cam, worldToScreen, gameTime) {
    for (const d of drones) {
      if (d.dead) continue;
      const scr = worldToScreen(d.x, d.y, cam);
      const isActive = d === activePipDrone;
      const pulse = 0.6 + 0.4 * Math.sin(d.pulsePhase * 3);

      ctx.save();
      ctx.translate(scr.x, scr.y);
      ctx.rotate(d.angle);

      // Drone body — small triangle
      const size = Math.max(4, 8 * cam.zoom);
      ctx.fillStyle = isActive ? '#38bdf8' : '#94a3b8';
      ctx.strokeStyle = isActive ? '#7dd3fc' : '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(size * 1.5, 0);
      ctx.lineTo(-size, size * 0.8);
      ctx.lineTo(-size * 0.5, 0);
      ctx.lineTo(-size, -size * 0.8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      ctx.restore();

      // Sensor range indicator (subtle)
      if (isActive) {
        ctx.save();
        ctx.globalAlpha = 0.08 * pulse;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(scr.x, scr.y, d.sensorRange * cam.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // State label
      ctx.save();
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = isActive ? '#38bdf8' : '#64748b';
      ctx.globalAlpha = 0.7;
      const stateLabel = d.state === 'transit' ? 'TRANSIT' : d.state === 'station' ? 'ON STATION' : 'RTB';
      ctx.fillText(stateLabel, scr.x, scr.y + 14);

      // HP bar
      if (d.hp < d.maxHp) {
        const barW = 20, barH = 2;
        const hpR = d.hp / d.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(scr.x - barW/2, scr.y - 10, barW, barH);
        ctx.fillStyle = hpR > 0.5 ? '#4ade80' : '#ef4444';
        ctx.fillRect(scr.x - barW/2, scr.y - 10, barW * hpR, barH);
      }
      ctx.restore();
    }
  },

  /**
   * Draw PiP camera view for the active drone.
   */
  drawPiP(ctx, W, H, cam, npcs, worldToScreen, drawWorldCallback) {
    if (!activePipDrone || activePipDrone.dead) return;
    const d = activePipDrone;

    const pipW = DRONE_CONFIG.pipSize.w;
    const pipH = DRONE_CONFIG.pipSize.h;
    const pipX = W - pipW - DRONE_CONFIG.pipMargin;
    const pipY = DRONE_CONFIG.pipMargin;

    // PiP background
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 24, 0.9)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.fillRect(pipX, pipY, pipW, pipH);
    ctx.strokeRect(pipX, pipY, pipW, pipH);

    // Clip to PiP area
    ctx.beginPath();
    ctx.rect(pipX, pipY, pipW, pipH);
    ctx.clip();

    // Draw entities visible from drone's perspective
    const droneCam = {
      x: d.x,
      y: d.y,
      zoom: DRONE_CONFIG.pipZoom,
    };

    // Simple rendering: draw nearby NPCs as dots
    const pipCx = pipX + pipW / 2;
    const pipCy = pipY + pipH / 2;

    // Grid lines
    ctx.strokeStyle = 'rgba(30, 80, 140, 0.2)';
    ctx.lineWidth = 0.5;
    const gridStep = 2000 * DRONE_CONFIG.pipZoom;
    if (gridStep > 8) {
      for (let gx = pipX; gx < pipX + pipW; gx += gridStep) {
        ctx.beginPath(); ctx.moveTo(gx, pipY); ctx.lineTo(gx, pipY + pipH); ctx.stroke();
      }
      for (let gy = pipY; gy < pipY + pipH; gy += gridStep) {
        ctx.beginPath(); ctx.moveTo(pipX, gy); ctx.lineTo(pipX + pipW, gy); ctx.stroke();
      }
    }

    // Range ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const rangeR = d.sensorRange * DRONE_CONFIG.pipZoom;
    ctx.beginPath();
    ctx.arc(pipCx, pipCy, Math.min(rangeR, pipW * 0.45), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw NPCs within drone sensor range
    if (npcs) {
      for (const npc of npcs) {
        if (!npc || npc.dead) continue;
        const dx = npc.x - d.x;
        const dy = npc.y - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist > d.sensorRange) continue;

        const sx = pipCx + dx * DRONE_CONFIG.pipZoom;
        const sy = pipCy + dy * DRONE_CONFIG.pipZoom;

        if (sx < pipX || sx > pipX + pipW || sy < pipY || sy > pipY + pipH) continue;

        const size = Math.max(3, (npc.radius || 14) * DRONE_CONFIG.pipZoom * 0.5);
        const color = npc.friendly ? '#4ade80' : '#ef4444';

        ctx.fillStyle = color;
        if (npc.isCapitalShip || (npc.radius || 0) > 80) {
          // Diamond for capitals
          ctx.beginPath();
          ctx.moveTo(sx, sy - size); ctx.lineTo(sx + size, sy);
          ctx.lineTo(sx, sy + size); ctx.lineTo(sx - size, sy);
          ctx.closePath(); ctx.fill();
        } else {
          // Dot for smaller ships
          ctx.beginPath();
          ctx.arc(sx, sy, size, 0, Math.PI * 2);
          ctx.fill();
        }

        // Type label
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fillText((npc.type || '?').toUpperCase(), sx, sy + size + 8);
        ctx.globalAlpha = 1;
      }
    }

    // Drone crosshair at center
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pipCx - 8, pipCy); ctx.lineTo(pipCx + 8, pipCy);
    ctx.moveTo(pipCx, pipCy - 8); ctx.lineTo(pipCx, pipCy + 8);
    ctx.stroke();

    ctx.restore();

    // PiP header
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 24, 0.85)';
    ctx.fillRect(pipX, pipY, pipW, 18);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`DRONE ${d.id.split('_')[1]} — ${d.state.toUpperCase()}`, pipX + 6, pipY + 13);

    // Fuel bar
    if (d.lifetime > 0) {
      const fuel = 1 - d.age / d.lifetime;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(pipX + pipW - 54, pipY + 4, 48, 8);
      ctx.fillStyle = fuel > 0.3 ? '#14b8a6' : '#ef4444';
      ctx.fillRect(pipX + pipW - 54, pipY + 4, 48 * fuel, 8);
    }

    // HP indicator
    ctx.fillStyle = d.hp > d.maxHp * 0.5 ? '#4ade80' : '#ef4444';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`HP:${d.hp}/${d.maxHp}`, pipX + pipW - 58, pipY + 13);

    ctx.restore();
  },
};

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

window.SpotterDroneSystem = SpotterDroneSystem;
