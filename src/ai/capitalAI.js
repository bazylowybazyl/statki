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

  const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
  
  const ax = sep.ax * 1.5 + (c * forwardAccel - s * sideAccel);
  const ay = sep.ay * 1.5 + (s * forwardAccel + c * sideAccel);

  npc.vx = (npc.vx || 0) + ax * dt;
  npc.vy = (npc.vy || 0) + ay * dt;

  const maxV = (npc.maxSpeed || 200) * speedBoost;
  const v = Math.hypot(npc.vx, npc.vy);
  if (v > maxV) {
    const scale = maxV / v;
    npc.vx *= scale;
    npc.vy *= scale;
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
      for (const loadout of group) {
        const def = loadout.weapon;
        if (!def) continue;

        // 1. ROZPOZNAWANIE KIERUNKU LUF NA BAZIE POZYCJI X/Y
        const localY = loadout.hp?.y || loadout.hp?.pos?.y || 0;
        let baseAngle = loadout.hp?.rot || loadout.hp?.pos?.rot;
        if (typeof baseAngle !== 'number') {
            if (localY > 15) baseAngle = Math.PI / 2; // Prawa burta - patrzy w prawo
            else if (localY < -15) baseAngle = -Math.PI / 2; // Lewa burta - patrzy w lewo
            else baseAngle = 0; // Środek - patrzy w przód
        }

        // 2. NAPRAWA AMUNICJI (null oznacza nieskończoność)
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

    // Main: mniejszy kąt strzału. Aux i Missile: 360 stopni.
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

function processAutonomousWeapons(npc, dt) {
  if (!npc) return;
  initAutonomousWeapons(npc);
  if (!npc.autoWeapons || npc.autoWeapons.length === 0) return;

  const npcs = window.npcs || [];
  const enemies = npc.friendly 
    ? npcs.filter(n => !n.dead && n.isPirate)
    : [window.ship, ...npcs.filter(n => !n.dead && n.friendly)].filter(Boolean);

  for (const weapon of npc.autoWeapons) {
    // Kąt spoczynkowy działa (np. prosto lub wzdłuż boku)
    const restAngle = (npc.angle || 0) + weapon.mountAngle;
    if (weapon.visualAngle === undefined) weapon.visualAngle = restAngle;

    weapon.cd -= dt;
    
    // Zabezpieczenie przed pustym magazynkiem (jeśli amunicja nie jest Infinity)
    if (weapon.ammo !== null && weapon.ammo <= 0) {
        // Wróć działem na pozycję zerową i ignoruj strzelanie
        let diff = window.wrapAngle(restAngle - weapon.visualAngle);
        weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
        continue;
    }

    const range = weapon.def.baseRange || 1000;
    const rangeSq = range * range;
    let bestTarget = null;
    let bestScore = -Infinity;

    // 1. Priorytetowe szukanie rakiet (Dla PD)
    if (weapon.prefers.includes('rocket') && window.bullets) {
      const myTeam = npc.friendly ? 'player' : 'npc';
      for (const b of window.bullets) {
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

    // 2. Szukanie statków
    for (const enemy of enemies) {
      const tx = enemy.pos ? enemy.pos.x : enemy.x;
      const ty = enemy.pos ? enemy.pos.y : enemy.y;
      const distSq = (tx - npc.x) ** 2 + (ty - npc.y) ** 2;
      if (distSq > rangeSq) continue;

      const absTargetAngle = Math.atan2(ty - npc.y, tx - npc.x);
      // Ograniczenie kąta sprawdza względem kąta montażu (żeby działa z lewej burty nie strzelały w prawo)
      const gunLookAngle = restAngle; 
      const angleDiff = Math.abs(window.wrapAngle(absTargetAngle - gunLookAngle));

      if (angleDiff > weapon.arc) continue;
      if (window.isLineOfFireBlocked?.(npc, enemy, range)) continue;

      const score = getTargetScoreForWeapon(weapon, enemy, false) - distSq * 0.001;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    // 3. Logika celowania lufy i strzału!
    if (bestTarget) {
      const tx = bestTarget.pos ? bestTarget.pos.x : bestTarget.x;
      const ty = bestTarget.pos ? bestTarget.pos.y : bestTarget.y;
      
      // Wyprzedzenie celu, żeby AI strzelało celniej
      const speed = weapon.def.baseSpeed || 1000;
      const lead = window.getLeadAim ? window.getLeadAim({x: npc.x, y: npc.y}, bestTarget, speed) : {x: tx, y: ty};
      const aimAngle = Math.atan2(lead.y - npc.y, lead.x - npc.x);
      
      // Obrót lufy w stronę celu (płynny)
      let diff = window.wrapAngle(aimAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 8 * dt);

      if (weapon.cd <= 0) {
        if (window.spawnBulletAdapter) {
          // Jako że wieżyczka się celuje, podajemy do strzału jej ZAKTUALIZOWANY KĄT
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
      // Wracanie lufy na miejsce, jeśli nie ma celu
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
    }
  }
}

// ============================================================================
// 3. MÓZGI NAWIGACYJNE
// ============================================================================

export function aiFrigate(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
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
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    
    const idealRange = npc.preferredRange || 750;
    const angleDiff = Math.abs(window.wrapAngle(targetAng - (npc.angle || 0)));

    if (dist < idealRange * 0.85) thrustNorm = -0.7; 
    else if (dist > idealRange * 1.15) {
      if (angleDiff < 0.9) thrustNorm = 0.9;
    } else {
      if (angleDiff < 0.5) thrustNorm = 0.25;
    }

    const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
    strafeNorm = Math.sin((performance.now() / 1000) * 0.7 + seed * 0.3) * 0.4;
  } else if (npc.home) {
    const patrolRadius = npc.home.r + 300;
    if (!npc.patrolAngle) npc.patrolAngle = Math.random() * Math.PI * 2;
    npc.patrolAngle += 0.2 * dt;
    const px = npc.home.x + Math.cos(npc.patrolAngle) * patrolRadius;
    const py = npc.home.y + Math.sin(npc.patrolAngle) * patrolRadius;
    targetAng = Math.atan2(py - npc.y, px - npc.x);
    if (Math.abs(window.wrapAngle(targetAng - (npc.angle||0))) < 0.8) thrustNorm = 0.4;
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
    if (freshTarget) npc.target = freshTarget;
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
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);

    const range = 800; 
    const wantRange = range * 0.8;
    const angleDiff = Math.abs(window.wrapAngle(targetAng - (npc.angle||0)));

    if (dist > range * 0.95 && npc.boostCd <= 0 && angleDiff < 0.4) {
      npc.boostT = npc.boostDur || 2.5;
      npc.boostCd = 10.0;
    }
    if (dist < wantRange * 0.9) npc.boostT = 0;

    if (dist < wantRange * 0.95) thrustNorm = -1.0; 
    else if (dist > wantRange * 1.05) {
      if (angleDiff < 0.7) thrustNorm = 1.0; 
    }

    if (dist < range * 1.1) {
      const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
      strafeNorm = Math.sin((performance.now() / 1000) * 0.55 + seed * 0.2) * 0.5;
      if (npc.boostT > 0) strafeNorm *= 1.5;
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, npc.boostT, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiBattleship(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
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

    const idealDist = 600; 
    
    const rightAng = toAng + Math.PI / 2;
    const leftAng = toAng - Math.PI / 2;

    const currentAng = npc.angle || 0;
    const diffNose = Math.abs(window.wrapAngle(toAng - currentAng));
    const diffRight = Math.abs(window.wrapAngle(rightAng - currentAng));
    const diffLeft = Math.abs(window.wrapAngle(leftAng - currentAng));

    if (dist < 750 && (Math.min(diffRight, diffLeft) + 0.2 < diffNose)) {
      targetAng = (diffRight <= diffLeft) ? rightAng : leftAng;
      
      thrustNorm = 0; 
      if (dist < idealDist * 0.8) strafeNorm = (diffRight <= diffLeft) ? 0.3 : -0.3; 
      else if (dist > idealDist * 1.1) strafeNorm = (diffRight <= diffLeft) ? -0.3 : 0.3; 
    } else {
      targetAng = toAng;
      if (dist < idealDist * 0.9) thrustNorm = -0.6; 
      else if (dist > idealDist * 1.15) {
        if (diffNose < 0.8) thrustNorm = 1.0;
      } else {
        if (diffNose < 0.5) thrustNorm = 0.3;
      }

      const seed = (npc.id && typeof npc.id === 'string') ? npc.id.charCodeAt(0) : Math.floor(Math.random() * 1000);
      strafeNorm = Math.sin((performance.now() / 1000) * 0.4 + seed * 0.2) * 0.35;
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  processAutonomousWeapons(npc, dt);
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;