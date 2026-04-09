// src/ai/fighterAI.js

const _turnScratch = { vx: 0, vy: 0 };
const _leadScratch = { x: 0, y: 0 };
const _normScratch = { x: 0, y: 0 };

const norm = (vX, vY, out = _normScratch) => {
  const L = Math.hypot(vX, vY);
  out.x = L ? vX / L : 0;
  out.y = L ? vY / L : 0;
  return out;
};

// Safe numeric hash for npc.id (string IDs like 'pirate_0' would cause NaN in arithmetic)
const _npcIdNum = (id) => {
  if (typeof id === 'number') return id;
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

function tryFireFighter(npc, target) {
  if (!target || target.dead) return;

  const MASTER_WEAPONS = window.MASTER_WEAPONS || {};
  const gunDef = MASTER_WEAPONS[npc.gun || 'ciws_mk1'];
  if (!gunDef) return;

  const tx = target.pos ? target.pos.x : target.x;
  const ty = target.pos ? target.pos.y : target.y;
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);

  if (window.isLineOfFireBlocked?.(npc, target, gunDef.baseRange)) {
    return;
  }

  const angleToTarget = Math.atan2(dy, dx);
  const myAngle = Number.isFinite(npc.angle) ? npc.angle : Math.atan2(npc.vy || 0, npc.vx || 0);
  const diff = Math.abs(window.wrapAngle(angleToTarget - myAngle));

  if (dist < (gunDef.baseRange || 400) * 0.95 && diff < 0.75 && npc.gunCD <= 0) {
    window.spawnBulletAdapter(npc, target, gunDef, { type: gunDef.category });
    npc.gunCD = gunDef.cooldown || 0.2;
  }

  if (npc.mslAmmo > 0 && npc.mslCD <= 0 && dist < 1200 && diff < 0.6) {
    if (Math.random() < 0.1) {
      const mslDef = MASTER_WEAPONS[npc.msl || 'missile_rack'];
      if (!mslDef) return;

      window.spawnBulletAdapter(npc, target, mslDef, { type: 'rocket' });
      npc.mslAmmo--;
      npc.mslCD = 5.0;

      if (window.spawnParticle) {
        window.spawnParticle({ x: npc.x, y: npc.y }, { x: 0, y: 0 }, 0.5, '#ffffff', 5, true);
      }
    }
  }
}

export function runAdvancedFighterAI(npc, dt) {
  const isSupport = npc.isSupportWing || !!npc.supportData;
  let order = 'engage';

  if (isSupport && window.SupportWing) {
    order = window.SupportWing.order || 'guard';
  }

  const SEARCH_RANGE = (order === 'engage' || npc.isPirate) ? 30000 : 6000;
  const DOGFIGHT_ENTER_DIST = 600;
  const DOGFIGHT_EXIT_DIST = 1100;

  npc.gunCD = Math.max(0, (npc.gunCD || 0) - dt);
  npc.mslCD = Math.max(0, (npc.mslCD || 0) - dt);
  npc.breakOffTimer = Math.max(0, (npc.breakOffTimer || 0) - dt);
  if (npc.state === 'dogfight3D') npc.dogfightTime = (npc.dogfightTime || 0) + dt;
  else npc.dogfightTime = 0;

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;

  if (target && target.dead) target = null;

  if (!target && npc.retargetTimer <= 0) {
    if (window.aiPickBestTarget) {
      target = window.aiPickBestTarget(npc, SEARCH_RANGE);
    } else if (window.aiPickTarget) {
      target = window.aiPickTarget(npc);
      if (target) {
        const tx = (target.pos && target.pos.x !== undefined) ? target.pos.x : target.x;
        const ty = (target.pos && target.pos.y !== undefined) ? target.pos.y : target.y;
        const dx = tx - npc.x;
        const dy = ty - npc.y;
        if (dx * dx + dy * dy > SEARCH_RANGE * SEARCH_RANGE) {
          target = null;
        }
      }
    }

    if (!target && npc.friendly && window.pickSquadTargets) {
      const squadTargets = window.pickSquadTargets();
      if (Array.isArray(squadTargets) && squadTargets.length > 0) {
        target = squadTargets[0];
      }
    }

    npc.target = target || null;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }

  const isSquadWingman = (npc.squad && npc.squad.leader && !npc.squad.leader.dead && npc.squad.leader !== npc);
  if (!target && !npc.friendly && !npc.guardStation && !isSquadWingman) {
    target = window.ship;
    npc.target = target;
  }

  let tx = 0;
  let ty = 0;
  let distToTarget = Infinity;
  let targetKind = 'unknown';

  if (target) {
    tx = (target.pos && target.pos.x !== undefined) ? target.pos.x : target.x;
    ty = (target.pos && target.pos.y !== undefined) ? target.pos.y : target.y;
    distToTarget = Math.hypot(tx - npc.x, ty - npc.y);
    targetKind = window.getUnitKind?.(target) || 'unknown';
  }

  if (target) {
    if (targetKind === 'fighter') {
      if (npc.state === 'dogfight3D') {
        if (distToTarget > DOGFIGHT_EXIT_DIST) npc.state = 'engage_formation';
      } else {
        if (distToTarget < DOGFIGHT_ENTER_DIST) {
          npc.state = 'dogfight3D';
          npc.sub = 'merge';
          npc.subT = 0;
          npc._mergeInit = false;
          npc.dogfightTime = 0;
          npc.dogfightMin = 0.8 + Math.random() * 0.6;
        } else {
          npc.state = 'engage_formation';
        }
      }
    }
    else {
      const targetR = target.radius || 50;
      if (npc.state === 'bombing') {
        if (distToTarget > 2500 + targetR) npc.state = 'engage_formation';
      } else {
        if (distToTarget < 1500 + targetR) npc.state = 'bombing';
        else npc.state = 'engage_formation';
      }
    }
  } else {
    npc.state = 'guard';
  }

  const smoothRotateToVelocity = (turnSpeed = 8.0) => {
    const speed = Math.hypot(npc.vx, npc.vy);
    if (speed > 10) {
      npc.desiredAngle = Math.atan2(npc.vy, npc.vx);
    }
  };

  if (npc.state === 'engage_formation' && target) {
    const dirX = tx - npc.x;
    const dirY = ty - npc.y;
    const len = Math.hypot(dirX, dirY) || 1;

    const wantVx = (dirX / len) * npc.maxSpeed;
    const wantVy = (dirY / len) * npc.maxSpeed;

    const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 300, _turnScratch);
    npc.vx = turned.vx;
    npc.vy = turned.vy;

    if (window.applySeparationForces) {
       const sep = window.applySeparationForces(npc, 0, 0); // Zwraca wbudowany obiekt w v53+
       npc.vx += sep.ax * dt;
       npc.vy += sep.ay * dt;
    }

    smoothRotateToVelocity(10.0);

    if (distToTarget < 1400) tryFireFighter(npc, target);
    return;
  }

  if (npc.state === 'dogfight3D' && target) {
    if (!npc.sub) npc.sub = 'merge';
    if (npc.sub === 'core') {
      let neighbors = 0;
      // Spatial grid query — only walks local cells (radius 220) instead of full NPC scan.
      if (window.queryAIGrid) {
        const __nq = window.queryAIGrid(npc.x, npc.y, 220);
        const __nbuf = __nq.buffer;
        const __nn = __nq.count;
        for (let i = 0; i < __nn; i++) {
          const other = __nbuf[i];
          if (!other || other === npc || other.dead) continue;
          if (other === window.ship) continue;
          const otherKind = window.getUnitKind?.(other) || other.type || '';
          if (otherKind !== 'fighter' && otherKind !== 'interceptor') continue;
          // Exact dist check — grid cells are 600u, query may overshoot
          const odx = other.x - npc.x;
          const ody = other.y - npc.y;
          if (odx * odx + ody * ody < 220 * 220) neighbors++;
        }
      } else {
        const allNpcs = window.npcs || [];
        for (let i = 0; i < allNpcs.length; i++) {
          const other = allNpcs[i];
          if (!other || other === npc || other.dead) continue;
          const otherKind = window.getUnitKind?.(other) || other.type || '';
          if (otherKind !== 'fighter' && otherKind !== 'interceptor') continue;
          const odx = other.x - npc.x;
          const ody = other.y - npc.y;
          if (odx * odx + ody * ody < 220 * 220) neighbors++;
        }
      }
      const canBreak = (npc.dogfightTime > (npc.dogfightMin || 1.0)) || neighbors > 5;
      if (canBreak && (neighbors > 3 || (Math.random() < 0.008 && npc.breakOffTimer <= 0))) {
        npc.sub = 'break_off';
        npc.subT = 1.5 + Math.random() * 0.7;
        const awayX = npc.x - tx;
        const awayY = npc.y - ty;
        const angle = Math.atan2(awayY, awayX) + (Math.random() - 0.5);
        npc.breakVector = { x: Math.cos(angle), y: Math.sin(angle) };
      }
    }

    if (npc.sub === 'break_off') {
      const breakVec = npc.breakVector || norm(npc.x - tx, npc.y - ty);
      const wantVx = breakVec.x * npc.maxSpeed * 1.2;
      const wantVy = breakVec.y * npc.maxSpeed * 1.2;
      const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 370, _turnScratch);
      npc.vx = turned.vx;
      npc.vy = turned.vy;
      npc.subT -= dt;
      if (npc.subT <= 0) {
        npc.sub = 'merge';
        npc._mergeInit = false;
        npc.breakOffTimer = 4.0;
        npc.dogfightTime = 0;
        npc.dogfightMin = 1.3 + Math.random() * 0.7;
      }
      tryFireFighter(npc, target);
      return;
    }

    if (npc.sub === 'merge') {
      if (!npc._mergeInit) { npc._mergeInit = true; npc.subT = 0.7 + Math.random() * 0.5; }
      const gunDef = (window.MASTER_WEAPONS || {})[npc.gun || 'ciws_mk1'];
      const gunSpeed = gunDef?.baseSpeed || 900;
      const lead = window.getLeadAim(npc, target, gunSpeed, _leadScratch);
      const dx = lead.x - npc.x;
      const dy = lead.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantVx = (dx / len) * npc.maxSpeed * 1.15;
      const wantVy = (dy / len) * npc.maxSpeed * 1.15;
      const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 400, _turnScratch);
      npc.vx = turned.vx; npc.vy = turned.vy;
      npc.subT -= dt;
      if (npc.subT <= 0 || distToTarget < 120) {
        npc.sub = 'slash'; npc.subT = 0.6; npc._slashSign = Math.random() > 0.5 ? 1 : -1;
      }
    }
    else if (npc.sub === 'slash') {
      const dx = tx - npc.x;
      const dy = ty - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const px = -ny * npc._slashSign;
      const py = nx * npc._slashSign;

      const wantVx = (nx * 0.85 + px * 0.45) * npc.maxSpeed;
      const wantVy = (ny * 0.85 + py * 0.45) * npc.maxSpeed;

      const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 450, _turnScratch);
      npc.vx = turned.vx; npc.vy = turned.vy;
      npc.subT -= dt;
      if (npc.subT <= 0) { npc.sub = 'core'; npc._mergeInit = false; }
    }
    else if (npc.sub === 'core') {
      const gunDef = (window.MASTER_WEAPONS || {})[npc.gun || 'ciws_mk1'];
      const gunSpeed = gunDef?.baseSpeed || 900;
      const aim = window.getLeadAim(npc, target, gunSpeed, _leadScratch);
      const dx = aim.x - npc.x;
      const dy = aim.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantVx = (dx / len) * npc.maxSpeed;
      const wantVy = (dy / len) * npc.maxSpeed;
      const timeNow = performance.now() * 0.001;
      const idNum = _npcIdNum(npc.id);
      const t = timeNow + (idNum % 17) * 0.13;
      const jrad = (4 * Math.PI / 180) * Math.sin(2 * Math.PI * 0.5 * t);
      const c = Math.cos(jrad);
      const s = Math.sin(jrad);
      const jvx = wantVx * c - wantVy * s;
      const jvy = wantVx * s + wantVy * c;
      const turned = window.clampTurnVec(npc.vx, npc.vy, jvx, jvy, dt, 370, _turnScratch);
      const swirl = Math.sin(timeNow * 2.0 + idNum * 0.37) * 0.10;
      const rx = -turned.vy;
      const ry = turned.vx;
      const mag = Math.hypot(turned.vx, turned.vy) || 1;
      npc.vx = turned.vx + (rx / mag) * npc.maxSpeed * swirl;
      npc.vy = turned.vy + (ry / mag) * npc.maxSpeed * swirl;

      if (distToTarget < 140) {
        const distSafe = Math.max(1, distToTarget);
        const nx = -(ty - npc.y) / distSafe;
        const ny = (tx - npc.x) / distSafe;
        npc.vx += nx * 110;
        npc.vy += ny * 110;
      }
    }

    smoothRotateToVelocity(12.0);
    tryFireFighter(npc, target);
    return;
  }

  if (npc.state === 'bombing' && target) {
    if (!npc.bombardVec || npc.lastTargetId !== target.id) {
      const a = Math.random() * 6.28;
      npc.bombardVec = { x: Math.cos(a), y: Math.sin(a) };
      npc.bombardSide = 1;
      npc.lastTargetId = target.id;
    }
    const targetR = target.radius || 50;
    const lineLen = 1400 + targetR;
    const wayX = tx + npc.bombardVec.x * lineLen * npc.bombardSide;
    const wayY = ty + npc.bombardVec.y * lineLen * npc.bombardSide;

    if (Math.hypot(wayX - npc.x, wayY - npc.y) < 250 + targetR) npc.bombardSide *= -1;

    const dx = wayX - npc.x;
    const dy = wayY - npc.y;
    const len = Math.hypot(dx, dy) || 1;

    const wantVx = (dx / len) * npc.maxSpeed * 1.1;
    const wantVy = (dy / len) * npc.maxSpeed * 1.1;

    const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 280, _turnScratch);
    npc.vx = turned.vx;
    npc.vy = turned.vy;

    if (distToTarget < 1000) {
      const aimX = tx - npc.x;
      const aimY = ty - npc.y;
      npc.desiredAngle = Math.atan2(aimY, aimX);
    } else {
      smoothRotateToVelocity(8.0);
    }

    tryFireFighter(npc, target);
    return;
  }

  let leader = null;
  if (npc.squad && npc.squad.leader && !npc.squad.leader.dead) {
    leader = npc.squad.leader;
  } else if (npc.supportData) {
    leader = npc.supportData.leader;
  }

  if (!leader && !npc.guardStation) {
    const home = npc.friendly ? window.ship : null;

    // Friendly fighters return to player ship; enemies chase player ship
    const chaseTarget = home?.pos ? home : (!npc.friendly && window.ship?.pos ? window.ship : null);
    if (chaseTarget?.pos) {
      const dx = chaseTarget.pos.x - npc.x;
      const dy = chaseTarget.pos.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantSpeed = Math.min(npc.maxSpeed * (npc.friendly ? 0.65 : 1.0), len * 1.4);
      const turned = window.clampTurnVec(
        npc.vx || 0,
        npc.vy || 0,
        (dx / len) * wantSpeed,
        (dy / len) * wantSpeed,
        dt,
        240,
        _turnScratch
      );
      npc.vx = turned.vx;
      npc.vy = turned.vy;
      if (npc.vx * npc.vx + npc.vy * npc.vy > 25) {
        npc.desiredAngle = Math.atan2(npc.vy, npc.vx);
      }
    } else {
      npc.vx *= 0.995;
      npc.vy *= 0.995;
    }
    return;
  }

  const isLeader = (leader === npc);
  let targetPos = null;

  if (isLeader && npc.isPirate && npc.guardStation) {
    const time = performance.now() / 1000;
    const radius = npc.guardOrbitRadius || 350;
    const speed = npc.guardOrbitSpeed || 0.3;
    const phase = npc.guardPhase || 0;
    const angle = phase + (time * speed);
    targetPos = {
      x: npc.guardStation.x + Math.cos(angle) * radius,
      y: npc.guardStation.y + Math.sin(angle) * radius
    };
    const tangentAngle = angle + (speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    npc.desiredAngle = tangentAngle;
  }
  else if (leader && !isLeader) {
    const offset = npc.formationOffset || { x: 0, y: 0 };
    const la = leader.angle || 0;
    const c = Math.cos(la);
    const s = Math.sin(la);
    targetPos = {
      x: leader.x + (offset.x * c - offset.y * s),
      y: leader.y + (offset.x * s + offset.y * c)
    };
  }
  else if (isLeader) {
    const pdx = window.ship.pos.x - npc.x;
    const pdy = window.ship.pos.y - npc.y;
    const plen = Math.hypot(pdx, pdy) || 1;
    npc.vx = (pdx / plen) * 150;
    npc.vy = (pdy / plen) * 150;
    smoothRotateToVelocity(5.0);
    return;
  }

  if (targetPos) {
    const dx = targetPos.x - npc.x;
    const dy = targetPos.y - npc.y;
    const distToSpot = Math.hypot(dx, dy);
    const kp = isLeader ? 2.0 : 3.0;
    let wantVx = dx * kp;
    let wantVy = dy * kp;
    const currentMax = isLeader ? (npc.maxSpeed * 0.6) : (npc.maxSpeed * 1.1);
    const speed = Math.hypot(wantVx, wantVy);
    if (speed > currentMax) {
      const scale = currentMax / speed;
      wantVx *= scale;
      wantVy *= scale;
    }
    npc.vx += (wantVx - npc.vx) * 4.0 * dt;
    npc.vy += (wantVy - npc.vy) * 4.0 * dt;

    if (window.applySeparationForces) {
       const sep = window.applySeparationForces(npc, 0, 0);
       npc.vx += sep.ax * dt;
       npc.vy += sep.ay * dt;
    }

    if (!Number.isFinite(npc.desiredAngle)) {
      if (distToSpot > 50) smoothRotateToVelocity(6.0);
      else if (leader && !isLeader && Number.isFinite(leader.angle)) npc.desiredAngle = leader.angle;
    }
  }
}

window.runAdvancedFighterAI = runAdvancedFighterAI;