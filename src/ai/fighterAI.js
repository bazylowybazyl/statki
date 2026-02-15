const norm = v => {
  const L = Math.hypot(v.x, v.y);
  return L ? { x: v.x / L, y: v.y / L } : { x: 0, y: 0 };
};

function tryFireFighter(npc, target) {
  if (!target || target.dead) return;

  const AISPACE_GUNS = window.AISPACE_GUNS || {};
  const AISPACE_MISSILES = window.AISPACE_MISSILES || {};

  const gunDef = AISPACE_GUNS[npc.gun] || AISPACE_GUNS.laserS;
  if (!gunDef) return;

  const tx = target.pos ? target.pos.x : target.x;
  const ty = target.pos ? target.pos.y : target.y;
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);

  if (window.isLineOfFireBlocked?.(npc, target, gunDef.range)) {
    return;
  }

  const angleToTarget = Math.atan2(dy, dx);
  const myAngle = Number.isFinite(npc.angle) ? npc.angle : Math.atan2(npc.vy || 0, npc.vx || 0);
  const diff = Math.abs(window.wrapAngle(angleToTarget - myAngle));

  if (dist < (gunDef.range || 400) && diff < 0.5 && npc.gunCD <= 0) {
    window.spawnBulletAdapter(npc, target, gunDef);
    npc.gunCD = 1.0 / (gunDef.rps || 5);
  }

  if (npc.mslAmmo > 0 && npc.mslCD <= 0 && dist < 1200 && diff < 0.6) {
    if (Math.random() < 0.1) {
      const mslDef = AISPACE_MISSILES[npc.msl || 'AF'];
      if (!mslDef) return;
      const dir = norm({ x: dx, y: dy });
      const speed = mslDef.speed || 300;

      window.bullets.push({
        x: npc.x, y: npc.y,
        vx: dir.x * speed + npc.vx * 0.5,
        vy: dir.y * speed + npc.vy * 0.5,
        life: mslDef.life || 4,
        r: 4,
        owner: npc.friendly ? 'player' : 'npc',
        damage: mslDef.dmg || 40,
        type: 'rocket',
        target: target,
        color: mslDef.color || '#ffaa00',
        turnRate: (mslDef.turn || 6) * Math.PI / 180,
        homingDelay: 0.2,
        explodeRadius: 40
      });

      npc.mslAmmo--;
      npc.mslCD = 5.0;

      window.spawnParticle?.({ x: npc.x, y: npc.y }, { x: 0, y: 0 }, 0.5, '#ffffff', 5, true);
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

    npc.target = target || null;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }

  const isSquadWingman = (npc.squad && npc.squad.leader && npc.squad.leader !== npc);
  if (!target && npc.isPirate && !npc.guardStation && !isSquadWingman) {
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
        } else {
          npc.state = 'engage_formation';
        }
      }
    }
    else {
      if (npc.state === 'bombing') {
        if (distToTarget > 2500) npc.state = 'engage_formation';
      } else {
        if (distToTarget < 1500) npc.state = 'bombing';
        else npc.state = 'engage_formation';
      }
    }
  } else {
    npc.state = 'guard';
  }

  const smoothRotateToVelocity = (turnSpeed = 8.0) => {
    const speed = Math.hypot(npc.vx, npc.vy);
    if (speed > 10) {
      const desiredAngle = Math.atan2(npc.vy, npc.vx);
      npc.desiredAngle = desiredAngle;
    }
  };

  if (npc.state === 'engage_formation' && target) {
    const dirX = tx - npc.x;
    const dirY = ty - npc.y;
    const len = Math.hypot(dirX, dirY) || 1;

    const wantVx = (dirX / len) * npc.maxSpeed;
    const wantVy = (dirY / len) * npc.maxSpeed;

    const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 300);
    npc.vx = turned.vx;
    npc.vy = turned.vy;

    const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
    npc.vx += sep.ax * dt;
    npc.vy += sep.ay * dt;

    smoothRotateToVelocity(10.0);

    if (distToTarget < 1400) tryFireFighter(npc, target);
    return;
  }

  if (npc.state === 'dogfight3D' && target) {
    if (!npc.sub) npc.sub = 'merge';

    if (npc.sub === 'merge') {
      if (!npc._mergeInit) { npc._mergeInit = true; npc.subT = 0.7 + Math.random() * 0.5; }
      const lead = window.getLeadAim(npc, target, 500);
      const dx = lead.x - npc.x;
      const dy = lead.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantVx = (dx / len) * npc.maxSpeed * 1.15;
      const wantVy = (dy / len) * npc.maxSpeed * 1.15;
      const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 400);
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

      const wantVx = (nx * 0.3 + px * 1.2) * npc.maxSpeed;
      const wantVy = (ny * 0.3 + py * 1.2) * npc.maxSpeed;

      const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 450);
      npc.vx = turned.vx; npc.vy = turned.vy;
      npc.subT -= dt;
      if (npc.subT <= 0) { npc.sub = 'merge'; npc._mergeInit = false; }
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
    const lineLen = 1400;
    const wayX = tx + npc.bombardVec.x * lineLen * npc.bombardSide;
    const wayY = ty + npc.bombardVec.y * lineLen * npc.bombardSide;

    if (Math.hypot(wayX - npc.x, wayY - npc.y) < 250) npc.bombardSide *= -1;

    const dx = wayX - npc.x;
    const dy = wayY - npc.y;
    const len = Math.hypot(dx, dy) || 1;

    const wantVx = (dx / len) * npc.maxSpeed * 1.1;
    const wantVy = (dy / len) * npc.maxSpeed * 1.1;

    const turned = window.clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, 280);
    npc.vx = turned.vx;
    npc.vy = turned.vy;

    if (distToTarget < 1000) {
      const aimX = tx - npc.x;
      const aimY = ty - npc.y;
      const desiredAngle = Math.atan2(aimY, aimX);
      npc.desiredAngle = desiredAngle;
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
    npc.vx *= 0.98; npc.vy *= 0.98;
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

    const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
    npc.vx += sep.ax * dt;
    npc.vy += sep.ay * dt;

    if (!Number.isFinite(npc.desiredAngle)) {
      if (distToSpot > 50) smoothRotateToVelocity(6.0);
      else if (leader && !isLeader && Number.isFinite(leader.angle)) npc.desiredAngle = leader.angle;
    } else {
      // npc.desiredAngle ustawiane przez logikę (np. orbita) – zostawiamy, nie kasujemy.
    }
  }
}

window.runAdvancedFighterAI = runAdvancedFighterAI;
