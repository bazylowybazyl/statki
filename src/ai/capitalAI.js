// src/ai/capitalAI.js

// ============================================================================
// 1. SYSTEM AUTOPILOTA (Ruch i fizyka - KIEROWCA)
// ============================================================================

function applyCapitalAutopilot(npc, thrustNorm, strafeNorm, desiredAngle, boostT, dt) {
  npc.desiredAngle = desiredAngle;
  const speedBoost = (boostT > 0) ? 1.7 : 1.0;

  const forwardAccel = thrustNorm * (npc.accel || 150) * speedBoost;
  const sideAccel = strafeNorm * (npc.accel || 150) * speedBoost;

  const c = Math.cos(npc.angle || 0);
  const s = Math.sin(npc.angle || 0);

  let ax = c * forwardAccel - s * sideAccel;
  let ay = s * forwardAccel + c * sideAccel;

  if (window.applySeparationForces) {
    const sep = window.applySeparationForces(npc, 0, 0); // Dodaje separację
    ax += sep.ax;
    ay += sep.ay;
  }

  npc.vx = (npc.vx || 0) + ax * dt;
  npc.vy = (npc.vy || 0) + ay * dt;

  const maxV = (npc.maxSpeed || 200) * speedBoost;
  const v = Math.hypot(npc.vx, npc.vy);

  if (v > maxV) {
    const dampFactor = 0.96 + Math.min(0.03, (npc.mass || 0) / 5000000 * 0.03);
    npc.vx *= dampFactor;
    npc.vy *= dampFactor;
  }
}

// ============================================================================
// 2. NIEZALEŻNY SYSTEM UZBROJENIA (Zintegrowany z Hardpointami)
// ============================================================================

function initAutonomousWeapons(npc) {
  if (npc.autoWeapons !== undefined && npc._weaponsInit) return;

  npc._weaponsInit = true;
  npc.autoWeapons = [];

  if (npc.weapons) {
    const addWeaponsFromGroup = (group, arc, prefers) => {
      if (!group || !Array.isArray(group)) return;
      for (let i = 0; i < group.length; i++) {
        const loadout = group[i];
        const def = loadout.weapon;
        if (!def || loadout?.hp?.destroyed || !loadout?.hp?.mount) continue;

        const localY = loadout.hp?.y || loadout.hp?.pos?.y || 0;
        let baseAngle = loadout.hp?.rot || loadout.hp?.pos?.rot;
        if (typeof baseAngle !== 'number') {
          if (localY > 15) baseAngle = Math.PI / 2;
          else if (localY < -15) baseAngle = -Math.PI / 2;
          else baseAngle = 0;
        }

        let startAmmo = null;
        if (loadout.hp?.maxAmmo != null) startAmmo = loadout.hp.maxAmmo;
        else if (def.ammo != null) startAmmo = def.ammo;

        npc.autoWeapons.push({
          id: def.id,
          def: def,
          type: def.category,
          cd: Math.random() * 2,
          ammo: startAmmo,
          hpOffset: loadout.hp,
          mountAngle: baseAngle,
          arc: arc,
          prefers: prefers
        });
      }
    };

    addWeaponsFromGroup(npc.weapons.main, 0.55, ['battleship', 'destroyer', 'frigate']);
    addWeaponsFromGroup(npc.weapons.aux, Math.PI * 2, ['rocket', 'fighter']);
    addWeaponsFromGroup(npc.weapons.missile, 1.2, ['battleship', 'destroyer', 'frigate', 'fighter']);
  }
}

function getTargetScoreForWeapon(weapon, target, isRocket = false) {
  if (!target) return -1;
  const kind = isRocket ? 'rocket' : (window.getUnitKind?.(target) || 'other');

  const prefIndex = weapon.prefers.indexOf(kind);
  let score = 0;

  if (prefIndex !== -1) {
    score += (10 - prefIndex) * 100;
  } else {
    if (weapon.type === 'rail' && kind === 'fighter') score -= 500;
  }
  return score;
}

const SUBSYSTEM_PRIORITY = ['main', 'missile', 'aux', 'special', 'hangar'];
const SUBSYSTEM_RESCAN_INTERVAL = 1.5;

function getSubsystemWorldPos(target, hp) {
  if (window.getEntityHardpointWorldPos) {
    return window.getEntityHardpointWorldPos(target, hp);
  }
  const tx = target.pos ? target.pos.x : (target.x || 0);
  const ty = target.pos ? target.pos.y : (target.y || 0);
  const hpScale = (Number.isFinite(target.__hardpointScale) && target.__hardpointScale > 0)
    ? target.__hardpointScale : 1;
  const localX = (Number(hp.x) || Number(hp.pos?.x) || 0) * hpScale;
  const localY = (Number(hp.y) || Number(hp.pos?.y) || 0) * hpScale;
  const spriteRot = (target === window.ship) ? 0 : (Number(target.capitalProfile?.spriteRotation) || 0);
  const angle = (Number(target.angle) || 0) + spriteRot;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
}

function getEngineWorldPos(target) {
  const offsets = target.capitalProfile?.engineOffsets;
  if (Array.isArray(offsets) && offsets.length > 0) {
    const eng = offsets[Math.floor(Math.random() * offsets.length)];
    const r = target.radius || 100;
    const localX = (eng.x || 0) * r;
    const localY = (eng.y || 0) * r;
    const spriteRot = Number(target.capitalProfile?.spriteRotation) || 0;
    const angle = (Number(target.angle) || 0) + spriteRot;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = target.pos ? target.pos.x : (target.x || 0);
    const ty = target.pos ? target.pos.y : (target.y || 0);
    return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
  }
  if (target.engines?.main?.vfxOffset) {
    const off = target.engines.main.vfxOffset;
    const hpScale = (Number.isFinite(target.__hardpointScale) && target.__hardpointScale > 0)
      ? target.__hardpointScale : 1;
    const localX = (off.x || 0) * hpScale;
    const localY = (off.y || 0) * hpScale;
    const spriteRot = Number(target.capitalProfile?.spriteRotation) || 0;
    const angle = (Number(target.angle) || 0) + spriteRot;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = target.pos ? target.pos.x : (target.x || 0);
    const ty = target.pos ? target.pos.y : (target.y || 0);
    return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
  }
  return null;
}

function pickTargetSubsystem(weapon, target) {
  if (!target) return null;
  const hps = target.editorHardpoints || target.hardpoints;
  if (!Array.isArray(hps) || hps.length === 0) {
    const engPos = getEngineWorldPos(target);
    return engPos ? { type: 'engine', worldPos: engPos } : null;
  }

  const weaponHps = [];
  for (let i = 0; i < hps.length; i++) {
    const hp = hps[i];
    if (hp.destroyed || !hp.mount) continue;
    if (SUBSYSTEM_PRIORITY.includes(hp.type || '')) {
      weaponHps.push(hp);
    }
  }

  if (weaponHps.length > 0) {
    weaponHps.sort((a, b) => {
      return SUBSYSTEM_PRIORITY.indexOf(a.type || '') - SUBSYSTEM_PRIORITY.indexOf(b.type || '');
    });
    const pool = weaponHps.slice(0, Math.min(3, weaponHps.length));
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const worldPos = getSubsystemWorldPos(target, chosen);
    if (worldPos) return { type: 'weapon', hp: chosen, worldPos };
  }

  const engPos = getEngineWorldPos(target);
  if (engPos) return { type: 'engine', worldPos: engPos };

  return null;
}

const _leadAimScratch = { x: 0, y: 0 };

function processAutonomousWeapons(npc, dt) {
  if (!npc) return;
  initAutonomousWeapons(npc);
  if (!npc.autoWeapons || npc.autoWeapons.length === 0) return;

  const tWeap0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  const npcs = window.npcs || [];

  for (let wIdx = 0; wIdx < npc.autoWeapons.length; wIdx++) {
    const weapon = npc.autoWeapons[wIdx];
    const hpRef = weapon.hpOffset;
    if (hpRef && (hpRef.destroyed || !hpRef.mount || (weapon.id && hpRef.mount !== weapon.id))) {
      continue;
    }
    const restAngle = (npc.angle || 0) + weapon.mountAngle;
    if (weapon.visualAngle === undefined) weapon.visualAngle = restAngle;

    weapon.cd -= dt;

    if (weapon.ammo !== null && weapon.ammo <= 0) {
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
      continue;
    }

    const range = weapon.def.baseRange || 1000;
    const rangeSq = range * range;
    weapon.scanCd = Math.max(0, (weapon.scanCd || 0) - dt);
    let bestTarget = weapon.cachedTarget || null;
    let bestScore = -Infinity;

    const mustRescan =
      weapon.scanCd <= 0 ||
      !bestTarget ||
      bestTarget.dead ||
      (bestTarget.x == null && bestTarget.pos?.x == null);

    if (mustRescan) {
      bestTarget = null;

      if (weapon.prefers.includes('rocket') && window.bullets) {
        const myTeam = npc.friendly ? 'player' : 'npc';
        for (let i = 0; i < window.bullets.length; i++) {
          const b = window.bullets[i];
          if (b.type === 'rocket' && b.owner !== myTeam) {
            const distSq = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
            if (distSq <= rangeSq) {
              const score = getTargetScoreForWeapon(weapon, b, true) - distSq * 0.001;
              if (score > bestScore) {
                bestScore = score;
                bestTarget = b;
              }
            }
          }
        }
      }

      // IN-PLACE FILTERING for enemies
      const checkAndScoreTarget = (enemy) => {
        const tx = enemy.pos ? enemy.pos.x : enemy.x;
        const ty = enemy.pos ? enemy.pos.y : enemy.y;
        const distSq = (tx - npc.x) ** 2 + (ty - npc.y) ** 2;
        if (distSq > rangeSq) return;

        const absTargetAngle = Math.atan2(ty - npc.y, tx - npc.x);
        const angleDiff = Math.abs(window.wrapAngle(absTargetAngle - restAngle));

        if (angleDiff > weapon.arc) return;
        if (window.isLineOfFireBlocked?.(npc, enemy, range)) return;

        const score = getTargetScoreForWeapon(weapon, enemy, false) - distSq * 0.001;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = enemy;
        }
      };

      if (!npc.friendly && window.ship && !window.ship.dead) {
          checkAndScoreTarget(window.ship);
      }

      // Spatial grid query — only iterate entities within weapon range
      // instead of full O(N) NPC scan. Cell hash returns local candidates.
      if (window.queryAIGrid) {
        const __wq = window.queryAIGrid(npc.x, npc.y, range);
        const __wbuf = __wq.buffer;
        const __wn = __wq.count;
        for (let i = 0; i < __wn; i++) {
          const enemy = __wbuf[i];
          if (!enemy || enemy.dead || enemy === npc) continue;
          if (enemy === window.ship) continue; // already scored above
          if (npc.friendly && !enemy.isPirate) continue;
          if (!npc.friendly && enemy.friendly === false && enemy !== window.ship) continue;
          checkAndScoreTarget(enemy);
        }
      } else {
        for (let i = 0; i < npcs.length; i++) {
          const enemy = npcs[i];
          if (!enemy || enemy.dead) continue;
          if (npc.friendly && !enemy.isPirate) continue;
          if (!npc.friendly && enemy.friendly === false && enemy !== window.ship) continue;
          checkAndScoreTarget(enemy);
        }
      }

      weapon.cachedTarget = bestTarget || null;
      weapon.scanCd = 0.12 + Math.random() * 0.08;
    }

    if (bestTarget) {
      const tx = bestTarget.pos ? bestTarget.pos.x : bestTarget.x;
      const ty = bestTarget.pos ? bestTarget.pos.y : bestTarget.y;

      weapon._subsystemTimer = (weapon._subsystemTimer || 0) - dt;
      if (!weapon._subsystem || weapon._subsystemTimer <= 0 || weapon._subsystemTarget !== bestTarget) {
        weapon._subsystem = pickTargetSubsystem(weapon, bestTarget);
        weapon._subsystemTarget = bestTarget;
        weapon._subsystemTimer = SUBSYSTEM_RESCAN_INTERVAL + Math.random() * 1.0;
      }

      let aimX = tx;
      let aimY = ty;
      if (weapon._subsystem?.worldPos) {
        if (weapon._subsystem.hp) {
          const freshPos = getSubsystemWorldPos(bestTarget, weapon._subsystem.hp);
          if (freshPos) { aimX = freshPos.x; aimY = freshPos.y; }
        } else if (weapon._subsystem.type === 'engine') {
          const freshPos = getEngineWorldPos(bestTarget);
          if (freshPos) { aimX = freshPos.x; aimY = freshPos.y; }
        }
      }

      const speed = weapon.def.baseSpeed || 1000;
      const subTarget = {
        x: aimX, y: aimY,
        vx: bestTarget.vx ?? bestTarget.vel?.x ?? 0,
        vy: bestTarget.vy ?? bestTarget.vel?.y ?? 0
      };
      
      const lead = window.getLeadAim ? window.getLeadAim({ x: npc.x, y: npc.y }, subTarget, speed, _leadAimScratch) : { x: aimX, y: aimY };
      const aimAngle = Math.atan2(lead.y - npc.y, lead.x - npc.x);

      let diff = window.wrapAngle(aimAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 8 * dt);

      if (weapon.cd <= 0) {
        if (window.spawnBulletAdapter) {
          window.spawnBulletAdapter(npc, bestTarget, weapon.def, {
            type: weapon.type,
            hp: weapon.hpOffset,
            angleOverride: weapon.visualAngle
          });
        }
        weapon.cd = weapon.def.cooldown || 2.0;
        if (weapon.ammo !== null && weapon.ammo > 0) weapon.ammo -= 1;
      }
    } else {
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
    }
  }

  if (typeof performance !== 'undefined') {
    window.__aiWeaponScanMs = (window.__aiWeaponScanMs || 0) + (performance.now() - tWeap0);
  }
}

// ============================================================================
// 3. MÓZGI NAWIGACYJNE
// ============================================================================

export function aiFrigate(sim, npc, dt) {
  const guardian = (npc.supportData?.leader && !npc.supportData.leader.dead)
    ? npc.supportData.leader
    : window.ship;
  const guardX = guardian?.pos?.x ?? guardian?.x ?? npc.x;
  const guardY = guardian?.pos?.y ?? guardian?.y ?? npc.y;
  const distToGuard = Math.hypot(npc.x - guardX, npc.y - guardY);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    let bestTarget = null;
    let bestScore = -Infinity;
    const pdRange = 1200;

    if (window.bullets) {
      const myTeam = npc.friendly ? 'player' : 'npc';
      for (let i = 0; i < window.bullets.length; i++) {
        const b = window.bullets[i];
        if ((b.type === 'rocket' || b.type === 'torpedo') && b.owner !== myTeam) {
          const d2 = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
          if (d2 < pdRange * pdRange) {
            const score = 2000 - d2 * 0.001;
            if (score > bestScore) { bestScore = score; bestTarget = b; }
          }
        }
      }
    }

    if (!bestTarget) {
      const freshTarget = window.aiPickTarget?.(npc);
      if (freshTarget) {
        const d2 = ((freshTarget.pos?.x ?? freshTarget.x) - npc.x) ** 2 +
                    ((freshTarget.pos?.y ?? freshTarget.y) - npc.y) ** 2;
        if (d2 < pdRange * pdRange) bestTarget = freshTarget;
      }
    }

    npc.target = bestTarget || null;
    npc.retargetTimer = 0.3 + Math.random() * 0.2;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

  const leashRange = 2000;
  if (distToGuard > leashRange) {
    target = null;
    npc.target = null;
  }

  if (target && !target.dead) {
    const tx = target.pos ? target.pos.x : target.x;
    const ty = target.pos ? target.pos.y : target.y;
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);

    const idealRange = 500;
    const angleDiff = Math.abs(window.wrapAngle(targetAng - (npc.angle || 0)));

    if (dist < idealRange * 0.7) thrustNorm = -0.6;
    else if (dist > idealRange * 1.3) {
      if (angleDiff < 0.9) thrustNorm = 0.8;
    } else {
      if (angleDiff < 0.5) thrustNorm = 0.2;
    }

    npc._dodgeTimer = (npc._dodgeTimer || 0) - dt;
    if (npc._dodgeTimer <= 0 && window.bullets) {
      const myTeam = npc.friendly ? 'player' : 'npc';
      for (let i = 0; i < window.bullets.length; i++) {
        const b = window.bullets[i];
        if ((b.type === 'rocket' || b.type === 'torpedo') && b.owner !== myTeam) {
          const bdx = npc.x - b.x;
          const bdy = npc.y - b.y;
          const bd = Math.hypot(bdx, bdy);
          if (bd < 800) {
            const bAng = Math.atan2(b.vy || 0, b.vx || 0);
            const toMe = Math.atan2(bdy, bdx);
            if (Math.abs(window.wrapAngle(bAng - toMe)) < 0.5) {
              npc._dodgeDir = (Math.random() > 0.5) ? 1 : -1;
              npc._dodgeTimer = 0.5;
              break;
            }
          }
        }
      }
    }
    if (npc._dodgeTimer > 0) {
      strafeNorm = (npc._dodgeDir || 1) * 0.6;
    }
  } else {
    const dx = guardX - npc.x;
    const dy = guardY - npc.y;
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    const escortDist = 400;

    if (dist > escortDist) {
      const angleDiff = Math.abs(window.wrapAngle(targetAng - (npc.angle || 0)));
      if (angleDiff < 0.8) thrustNorm = Math.min(0.8, dist / 1000);
    } else if (dist < escortDist * 0.5) {
      thrustNorm = -0.3;
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiDestroyer(sim, npc, dt) {
  npc.boostT = Math.max(0, (npc.boostT || 0) - dt);
  npc.boostCd = Math.max(0, (npc.boostCd || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) {
      if (freshTarget !== npc.target) {
        npc._orbitDir = (Math.random() > 0.5) ? 1 : -1;
      }
      npc.target = freshTarget;
    }
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;

  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

  if (target && !target.dead) {
    const tx = target.pos ? target.pos.x : target.x;
    const ty = target.pos ? target.pos.y : target.y;
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    const toAng = Math.atan2(dy, dx);

    const idealRange = 900;
    const orbitDir = npc._orbitDir || 1;

    if (dist > 1800 && npc.boostCd <= 0) {
      npc.boostT = npc.boostDur || 2.5;
      npc.boostCd = 12.0;
      npc._orbitDir = -orbitDir;
    }

    if (dist > idealRange * 2) {
      targetAng = toAng;
      const angleDiff = Math.abs(window.wrapAngle(toAng - (npc.angle || 0)));
      thrustNorm = (angleDiff < 0.7) ? 1.0 : 0.3;
    } else {
      targetAng = toAng + (Math.PI / 2) * orbitDir;
      thrustNorm = 0.7;

      const distError = (dist - idealRange) / idealRange;
      strafeNorm = Math.max(-0.5, Math.min(0.5, distError * 1.5)) * orbitDir;
    }

    if (dist < idealRange * 0.5) {
      npc.boostT = 0;
      targetAng = toAng;
      thrustNorm = -0.8;
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, npc.boostT, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiBattleship(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) {
      if (freshTarget !== npc.target) {
        npc._orbitDir = null; 
        npc._orbitFlipTimer = 15 + Math.random() * 5;
      }
      npc.target = freshTarget;
    }
    npc.retargetTimer = 1.5 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;

  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

  if (target && !target.dead) {
    const tx = target.pos ? target.pos.x : target.x;
    const ty = target.pos ? target.pos.y : target.y;
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    const toAng = Math.atan2(dy, dx);

    const idealRange = 1200;

    if (npc._orbitDir == null) {
      const rightAng = toAng + Math.PI / 2;
      const leftAng = toAng - Math.PI / 2;
      const currentAng = npc.angle || 0;
      const diffRight = Math.abs(window.wrapAngle(rightAng - currentAng));
      const diffLeft = Math.abs(window.wrapAngle(leftAng - currentAng));
      npc._orbitDir = (diffRight <= diffLeft) ? 1 : -1;
    }

    npc._orbitFlipTimer = (npc._orbitFlipTimer || 15) - dt;
    if (npc._orbitFlipTimer <= 0) {
      npc._orbitDir = -(npc._orbitDir);
      npc._orbitFlipTimer = 15 + Math.random() * 5;
    }

    const orbitDir = npc._orbitDir;

    if (dist > idealRange * 2.5) {
      targetAng = toAng;
      const angleDiff = Math.abs(window.wrapAngle(toAng - (npc.angle || 0)));
      thrustNorm = (angleDiff < 0.8) ? 0.8 : 0.2;
    } else {
      targetAng = toAng + (Math.PI / 2) * orbitDir;
      thrustNorm = 0.4;

      if (dist < idealRange * 0.85) {
        strafeNorm = -0.4 * orbitDir; 
      } else if (dist > idealRange * 1.15) {
        strafeNorm = 0.4 * orbitDir; 
      }
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  processAutonomousWeapons(npc, dt);
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;