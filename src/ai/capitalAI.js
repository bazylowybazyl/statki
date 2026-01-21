export function aiFrigate(sim, npc, dt) {
  const AISPACE_GUNS_M = window.AISPACE_GUNS_M || {};
  const AISPACE_PD = window.AISPACE_PD || {};
  const AISPACE_MISSILES = window.AISPACE_MISSILES || {};
  const SIDE_ROCKET_TURN_RATE = window.SIDE_ROCKET_TURN_RATE || 6;

  npc.gunCD = Math.max(0, (npc.gunCD || 0) - dt);
  npc.pdCD = Math.max(0, (npc.pdCD || 0) - dt);
  npc.mslCD = Math.max(0, (npc.mslCD || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;

  if (!target || target.dead) {
    target = window.aiPickTarget?.(npc);
    npc.target = target;
  }

  let targetAng = npc.angle;
  let thrust = 0;
  let strafe = 0;
  let ax = 0;
  let ay = 0;

  if (target) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    targetAng = Math.atan2(dy, dx);

    const idealRange = npc.preferredRange || 750;
    const dist = Math.hypot(dx, dy);

    if (dist < idealRange * 0.85) thrust = -npc.accel * 0.7;
    else if (dist > idealRange * 1.15) thrust = npc.accel * 0.9;
    else thrust = npc.accel * 0.25;

    const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
    const time = performance.now() / 1000;
    strafe = Math.sin(time * 0.7 + seed * 0.3) * npc.accel * 0.4;

  } else {
    if (npc.home) {
      const patrolRadius = npc.home.r + 300;
      if (!npc.patrolAngle) npc.patrolAngle = Math.random() * Math.PI * 2;
      npc.patrolAngle += 0.2 * dt;
      const px = npc.home.x + Math.cos(npc.patrolAngle) * patrolRadius;
      const py = npc.home.y + Math.sin(npc.patrolAngle) * patrolRadius;
      const dx = px - npc.x;
      const dy = py - npc.y;
      targetAng = Math.atan2(dy, dx);
      thrust = npc.accel * 0.4;
    } else {
      npc.vx *= 0.95;
      npc.vy *= 0.95;
    }
  }

  const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
  ax += sep.ax;
  ay += sep.ay;

  npc.angle = window.clampTurnAngle(npc.angle, targetAng, npc.turn, dt);
  const c = Math.cos(npc.angle);
  const s = Math.sin(npc.angle);

  const totalAx = ax + (c * thrust - s * strafe);
  const totalAy = ay + (s * thrust + c * strafe);

  npc.vx += totalAx * dt;
  npc.vy += totalAy * dt;

  const v = Math.hypot(npc.vx, npc.vy);
  if (v > npc.maxSpeed) {
    const scale = npc.maxSpeed / v;
    npc.vx *= scale;
    npc.vy *= scale;
  }

  if (target) {
    const mainDef = AISPACE_GUNS_M[npc.mainGun] || AISPACE_GUNS_M.m_autocannon;
    const distSq = window.dist2(npc, target);

    if (npc.gunCD <= 0 && distSq < (mainDef.range * mainDef.range)) {
      const dx = target.x - npc.x;
      const dy = target.y - npc.y;
      const dot = (Math.cos(npc.angle) * dx + Math.sin(npc.angle) * dy) / Math.sqrt(distSq);

      if (dot > 0.8) {
        if (!window.isLineOfFireBlocked(npc, target, mainDef.range)) {
          window.spawnBulletAdapter(npc, target, mainDef, { type: mainDef.isBeam ? 'beam' : undefined });
          npc.gunCD = 1.0 / (mainDef.rps || 1.0);
        }
      }
    }

    const pdDef = AISPACE_PD[npc.pd];
    if (pdDef && npc.pdCD <= 0 && distSq < (pdDef.range * pdDef.range)) {
      const burst = pdDef.burst || 1;
      for (let i = 0; i < burst; i++) {
        window.spawnBulletAdapter(npc, target, pdDef, { type: 'ciws' });
      }
      npc.pdCD = 1.0 / (pdDef.rps || 8);
    }

    if (npc.msl && npc.mslAmmo > 0 && npc.mslCD <= 0 && distSq < 1400 * 1400) {
      const mslDef = AISPACE_MISSILES[npc.msl] || AISPACE_MISSILES.AS;
      const dir = { x: Math.cos(npc.angle), y: Math.sin(npc.angle) };
      window.bullets.push({
        x: npc.x, y: npc.y,
        vx: dir.x * mslDef.speed + npc.vx,
        vy: dir.y * mslDef.speed + npc.vy,
        life: mslDef.life || 5,
        r: 5,
        owner: npc.friendly ? 'player' : 'npc',
        damage: mslDef.dmg || 80,
        type: 'rocket',
        target: target,
        color: mslDef.color,
        turnRate: (mslDef.turn || SIDE_ROCKET_TURN_RATE) * Math.PI / 180,
        homingDelay: 0.3,
        explodeRadius: 50
      });
      npc.mslAmmo -= 1;
      npc.mslCD = 6.0;
    }
  }
}

export function aiDestroyer(sim, npc, dt) {
  const AISPACE_GUNS_M = window.AISPACE_GUNS_M || {};
  const AISPACE_PD = window.AISPACE_PD || {};

  npc.mCD = Math.max(0, (npc.mCD || 0) - dt);
  npc.pdCD = Math.max(0, (npc.pdCD || 0) - dt);
  npc.boostT = Math.max(0, (npc.boostT || 0) - dt);
  npc.boostCd = Math.max(0, (npc.boostCd || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (!target || target.dead) {
    target = window.aiPickTarget?.(npc);
    npc.target = target;
  }

  const gunDef = AISPACE_GUNS_M[npc.mGun] || AISPACE_GUNS_M.m_rail;
  let targetAng = npc.angle;
  let thrust = 0;
  let strafe = 0;
  let ax = 0;
  let ay = 0;

  if (target) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    const dist = Math.hypot(dx, dy);
    targetAng = Math.atan2(dy, dx);

    const range = gunDef.range || 800;
    const wantRange = range * 0.8;

    const ux = Math.cos(npc.angle);
    const uy = Math.sin(npc.angle);
    const dot = (dx / dist) * ux + (dy / dist) * uy;

    if (dist > range * 0.95 && npc.boostCd <= 0 && dot > 0.9) {
      npc.boostT = npc.boostDur || 2.5;
      npc.boostCd = 10.0;
    }
    if (dist < wantRange * 0.9) npc.boostT = 0;

    if (dist < wantRange * 0.95) thrust = -npc.accel * 1.2;
    else if (dist > wantRange * 1.05) thrust = npc.accel * 0.9;

    if (dist < range * 1.1) {
      const time = performance.now() / 1000;
      const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
      strafe = Math.sin(time * 0.55 + seed * 0.2) * npc.accel * 0.5;
      if (npc.boostT > 0) strafe *= 1.5;
    }

    const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
    ax += sep.ax * 1.2;
    ay += sep.ay * 1.2;

    if (npc.mCD <= 0 && dist < range && dot > 0.9) {
      if (!window.isLineOfFireBlocked(npc, target, range)) {
        window.spawnBulletAdapter(npc, target, gunDef, { type: 'rail' });
        npc.mCD = 1.0 / (gunDef.rps || 0.5);
      }
    }
  }

  const speedBoost = (npc.boostT > 0) ? 1.7 : 1.0;
  npc.angle = window.clampTurnAngle(npc.angle, targetAng, npc.turn * speedBoost, dt);

  const c = Math.cos(npc.angle);
  const s = Math.sin(npc.angle);

  const totalAx = ax + (c * thrust - s * strafe) * speedBoost;
  const totalAy = ay + (s * thrust + c * strafe) * speedBoost;

  npc.vx += totalAx * dt;
  npc.vy += totalAy * dt;

  const v = Math.hypot(npc.vx, npc.vy);
  const maxV = npc.maxSpeed * speedBoost;
  if (v > maxV) {
    const scale = maxV / v;
    npc.vx *= scale;
    npc.vy *= scale;
  }

  const pdDef = AISPACE_PD[npc.pd];
  if (pdDef && npc.pdCD <= 0 && target) {
    if (window.dist2(npc, target) < pdDef.range ** 2) {
      window.spawnBulletAdapter(npc, target, pdDef, { type: 'ciws' });
      npc.pdCD = 1.0 / (pdDef.rps || 9);
    }
  }
}

export function aiBattleship(sim, npc, dt) {
  const AISPACE_GUNS_M = window.AISPACE_GUNS_M || {};
  const AISPACE_BS_BROADSIDE = window.AISPACE_BS_BROADSIDE || {};
  const AISPACE_PD = window.AISPACE_PD || {};

  npc.broadLeftCD = Math.max(0, (npc.broadLeftCD || 0) - dt);
  npc.broadRightCD = Math.max(0, (npc.broadRightCD || 0) - dt);
  npc.pdCD = Math.max(0, (npc.pdCD || 0) - dt);
  npc.mCD = Math.max(0, (npc.mCD || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
    npc.retargetTimer = 1.5 + Math.random() * 0.5;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (!target || target.dead) {
    target = window.aiPickTarget?.(npc);
    npc.target = target;
  }

  const broadsideDef = AISPACE_BS_BROADSIDE;
  const mDef = AISPACE_GUNS_M.h_rapid;

  let targetAng = npc.angle;
  let thrust = 0;
  let strafe = 0;
  let ax = 0;
  let ay = 0;

  if (target) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    const dist = Math.hypot(dx, dy);
    const toAng = Math.atan2(dy, dx);

    const noseRange = mDef.range || 800;
    const idealDist = noseRange * 0.75;

    if (dist < idealDist * 0.9) thrust = -npc.accel * 0.5;
    else if (dist > idealDist * 1.15) thrust = npc.accel * 0.9;
    else thrust = npc.accel * 0.2;

    const time = performance.now() / 1000;
    const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
    strafe = Math.sin(time * 0.4 + seed * 0.2) * npc.accel * 0.35;

    const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
    ax += sep.ax * 1.5;
    ay += sep.ay * 1.5;

    const rightAng = toAng + Math.PI / 2;
    const leftAng = toAng - Math.PI / 2;

    const diffNose = Math.abs(window.wrapAngle(toAng - npc.angle));
    const diffRight = Math.abs(window.wrapAngle(rightAng - npc.angle));
    const diffLeft = Math.abs(window.wrapAngle(leftAng - npc.angle));

    const broadsideRange = broadsideDef.range || 650;
    let sideBetter = false;
    const minSideDiff = Math.min(diffRight, diffLeft);

    if (dist < broadsideRange * 1.05 && (minSideDiff + 0.2 < diffNose)) {
      sideBetter = true;
    }

    if (sideBetter) {
      if (diffRight <= diffLeft) targetAng = rightAng;
      else targetAng = leftAng;
    } else {
      targetAng = toAng;
    }

    const sideArc = 0.5;

    if (diffRight < sideArc && npc.broadRightCD <= 0 && dist < broadsideDef.range) {
      if (!window.isLineOfFireBlocked(npc, target, broadsideDef.range)) {
        for (let i = 0; i < 4; i++) {
          const offsetDist = (i - 1.5) * 25;
          const bx = npc.x + Math.cos(npc.angle) * offsetDist + Math.sin(npc.angle) * 20;
          const by = npc.y + Math.sin(npc.angle) * offsetDist - Math.cos(npc.angle) * 20;
          const fakeSource = { ...npc, x: bx, y: by };
          window.spawnBulletAdapter(fakeSource, target, broadsideDef, { type: 'plasma' });
        }
        npc.broadRightCD = 2.0;
      }
    }

    if (diffLeft < sideArc && npc.broadLeftCD <= 0 && dist < broadsideDef.range) {
      if (!window.isLineOfFireBlocked(npc, target, broadsideDef.range)) {
        for (let i = 0; i < 4; i++) {
          const offsetDist = (i - 1.5) * 25;
          const bx = npc.x + Math.cos(npc.angle) * offsetDist - Math.sin(npc.angle) * 20;
          const by = npc.y + Math.sin(npc.angle) * offsetDist + Math.cos(npc.angle) * 20;
          const fakeSource = { ...npc, x: bx, y: by };
          window.spawnBulletAdapter(fakeSource, target, broadsideDef, { type: 'plasma' });
        }
        npc.broadLeftCD = 2.0;
      }
    }

    if (diffNose < 0.3 && npc.mCD <= 0 && dist < mDef.range) {
      if (!window.isLineOfFireBlocked(npc, target, mDef.range)) {
        window.spawnBulletAdapter(npc, target, mDef, { type: 'rail' });
        npc.mCD = 1.0 / mDef.rps;
      }
    }
  }

  npc.angle = window.clampTurnAngle(npc.angle, targetAng, npc.turn, dt);
  const c = Math.cos(npc.angle);
  const s = Math.sin(npc.angle);

  ax += c * thrust - s * strafe;
  ay += s * thrust + c * strafe;

  npc.vx += ax * dt;
  npc.vy += ay * dt;

  const v = Math.hypot(npc.vx, npc.vy);
  if (v > npc.maxSpeed) {
    const sc = npc.maxSpeed / v;
    npc.vx *= sc;
    npc.vy *= sc;
  }

  const pdDef = AISPACE_PD[npc.pd] || AISPACE_PD.pd_laser;
  if (npc.pdCD <= 0 && target && window.dist2(npc, target) < pdDef.range ** 2) {
    const burst = pdDef.burst || 1;
    for (let i = 0; i < burst; i++) window.spawnBulletAdapter(npc, target, pdDef, { type: 'ciws' });
    npc.pdCD = 1.0 / (pdDef.rps || 10);
  }
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;
