// src/ai/capitalAI.js

// ============================================================================
// 1. SYSTEM AUTOPILOTA (Ruch i fizyka - KIEROWCA)
// ============================================================================

function applyCapitalAutopilot(npc, thrustNorm, strafeNorm, desiredAngle, boostT, dt) {
  npc.desiredAngle = desiredAngle;
  const speedBoost = (boostT > 0) ? 1.7 : 1.0;

  const forwardAccel = thrustNorm * npc.accel * speedBoost;
  const sideAccel = strafeNorm * npc.accel * speedBoost;

  const c = Math.cos(npc.angle);
  const s = Math.sin(npc.angle);

  const sep = window.applySeparationForces?.(npc, 0, 0) || { ax: 0, ay: 0 };
  
  const ax = sep.ax * 1.5 + (c * forwardAccel - s * sideAccel);
  const ay = sep.ay * 1.5 + (s * forwardAccel + c * sideAccel);

  npc.vx += ax * dt;
  npc.vy += ay * dt;

  const maxV = npc.maxSpeed * speedBoost;
  const v = Math.hypot(npc.vx, npc.vy);
  if (v > maxV) {
    const scale = maxV / v;
    npc.vx *= scale;
    npc.vy *= scale;
  }
}

// ============================================================================
// 2. NIEZALEŻNY SYSTEM UZBROJENIA (Wieżyczki - STRZELCY)
// ============================================================================

function initAutonomousWeapons(npc) {
  if (npc._weaponsInit) return;
  npc._weaponsInit = true;
  npc.autoWeapons = [];

  const AISPACE_GUNS_M = window.AISPACE_GUNS_M || {};
  const AISPACE_PD = window.AISPACE_PD || {};
  const AISPACE_MISSILES = window.AISPACE_MISSILES || {};
  const AISPACE_BS = window.AISPACE_BS_BROADSIDE || {};

  // GŁÓWNE DZIAŁO (Mocno skupione na przodzie)
  const mGunId = npc.mGun || npc.mainGun;
  if (mGunId && AISPACE_GUNS_M[mGunId]) {
    npc.autoWeapons.push({
      id: 'main_front',
      def: AISPACE_GUNS_M[mGunId],
      type: AISPACE_GUNS_M[mGunId].isBeam ? 'beam' : 'rail',
      cd: 0,
      mountAngle: 0, // Zwrócone do przodu
      arc: 0.35,     // Wąski stożek ostrzału (~20 stopni)
      prefers: ['battleship', 'destroyer', 'frigate']
    });
  }

  // POINT DEFENSE (Dookólne, 360 stopni)
  if (npc.pd && AISPACE_PD[npc.pd]) {
    npc.autoWeapons.push({
      id: 'pd_omni',
      def: AISPACE_PD[npc.pd],
      type: 'ciws',
      cd: 0,
      mountAngle: 0,
      arc: Math.PI * 2, // Pełne 360 stopni
      prefers: ['rocket', 'fighter']
    });
  }

  // RAKIETY (Skierowane do przodu, ale z szerokim kątem)
  if (npc.msl && AISPACE_MISSILES[npc.msl]) {
    npc.autoWeapons.push({
      id: 'missile_front',
      def: AISPACE_MISSILES[npc.msl],
      type: 'rocket',
      cd: 0,
      ammo: npc.mslAmmo || 0,
      mountAngle: 0,
      arc: 1.2, // Dość szeroki stożek na odpalenie
      prefers: ['battleship', 'destroyer', 'frigate', 'fighter']
    });
  }

  // BROADSIDES (Tylko Battleship - Lewa i Prawa burta)
  if (npc.type === 'battleship') {
    npc.autoWeapons.push({
      id: 'broadside_left',
      def: AISPACE_BS,
      type: 'plasma',
      cd: 0,
      mountAngle: -Math.PI / 2, // Lewa strona statku
      arc: 0.25,                // Bardzo wąski stożek burtowy
      prefers: ['battleship', 'destroyer'],
      isBroadside: true
    });
    npc.autoWeapons.push({
      id: 'broadside_right',
      def: AISPACE_BS,
      type: 'plasma',
      cd: 0,
      mountAngle: Math.PI / 2, // Prawa strona statku
      arc: 0.25,               // Bardzo wąski stożek burtowy
      prefers: ['battleship', 'destroyer'],
      isBroadside: true
    });
  }
}

// Funkcja pomocnicza: ocena priorytetu celu dla konkretnej broni
function getTargetScoreForWeapon(weapon, target, isRocket = false) {
  if (!target) return -1;
  const kind = isRocket ? 'rocket' : (window.getUnitKind?.(target) || 'other');
  
  // Jeśli broń w ogóle nie lubi tego typu celów, dajemy mały priorytet
  const prefIndex = weapon.prefers.indexOf(kind);
  let score = 0;

  if (prefIndex !== -1) {
    score += (10 - prefIndex) * 100; // Im wyżej na liście preferencji, tym lepiej
  } else {
    // Jeśli to broń główna, a cel to np. myśliwiec - niech strzela tylko w ostateczności
    if (weapon.id.includes('main') && kind === 'fighter') score -= 500;
  }
  return score;
}

function processAutonomousWeapons(npc, dt) {
  initAutonomousWeapons(npc);

  const npcs = window.npcs || [];
  const enemies = npc.friendly 
    ? npcs.filter(n => !n.dead && n.isPirate)
    : [window.ship, ...npcs.filter(n => !n.dead && n.friendly)].filter(Boolean);

  for (const weapon of npc.autoWeapons) {
    weapon.cd -= dt;
    if (weapon.cd > 0) continue;
    if (weapon.ammo !== undefined && weapon.ammo <= 0) continue;

    const range = weapon.def.range || 800;
    const rangeSq = range * range;
    let bestTarget = null;
    let bestScore = -Infinity;

    // 1. SKANOWANIE RAKIET (Tylko jeśli broń preferuje rakiety - np. PD)
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

    // 2. SKANOWANIE STATKÓW
    for (const enemy of enemies) {
      const distSq = (enemy.x - npc.x) ** 2 + (enemy.y - npc.y) ** 2;
      if (distSq > rangeSq) continue;

      // Sprawdzamy kąt (Arc of Fire)
      const absTargetAngle = Math.atan2(enemy.y - npc.y, enemy.x - npc.x);
      // Gdzie faktycznie patrzy lufa (Kąt statku + offset montażu broni)
      const gunLookAngle = npc.angle + weapon.mountAngle;
      
      const angleDiff = Math.abs(window.wrapAngle(absTargetAngle - gunLookAngle));

      // Jeśli cel jest poza polem widzenia wieżyczki - ignoruj
      if (angleDiff > weapon.arc) continue;

      // Jeśli linia strzału jest zablokowana przez sojusznika - ignoruj
      if (window.isLineOfFireBlocked?.(npc, enemy, range)) continue;

      const score = getTargetScoreForWeapon(weapon, enemy, false) - distSq * 0.001;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    // 3. ODPALENIE BRONI
    if (bestTarget) {
      // Obsługa salwy burtowej (Broadside) - puszcza 4 pociski z lekkim offsetem
      if (weapon.isBroadside) {
        for (let i = 0; i < 4; i++) {
          const offsetDist = (i - 1.5) * 25;
          // Przesunięcie lufy wzg. statku
          const bx = npc.x + Math.cos(npc.angle) * offsetDist + Math.cos(npc.angle + weapon.mountAngle) * 20;
          const by = npc.y + Math.sin(npc.angle) * offsetDist + Math.sin(npc.angle + weapon.mountAngle) * 20;
          const fakeSource = { ...npc, x: bx, y: by, angle: npc.angle + weapon.mountAngle };
          
          window.spawnBulletAdapter(fakeSource, bestTarget, weapon.def, { type: weapon.type, useHardpoint: false });
        }
      } 
      // Rakiety
      else if (weapon.type === 'rocket') {
        const dir = { x: Math.cos(npc.angle + weapon.mountAngle), y: Math.sin(npc.angle + weapon.mountAngle) };
        window.bullets.push({
          x: npc.x, y: npc.y,
          vx: dir.x * (weapon.def.speed||300) + npc.vx,
          vy: dir.y * (weapon.def.speed||300) + npc.vy,
          life: weapon.def.life || 5, r: 5,
          owner: npc.friendly ? 'player' : 'npc',
          damage: weapon.def.dmg || 80,
          type: 'rocket',
          target: bestTarget,
          color: weapon.def.color,
          turnRate: (weapon.def.turn || window.SIDE_ROCKET_TURN_RATE || 6) * Math.PI / 180,
          homingDelay: 0.3, explodeRadius: 50
        });
        if (weapon.ammo !== undefined) weapon.ammo -= 1;
      } 
      // Standardowe wieżyczki (Main, CIWS)
      else {
        const burst = weapon.def.burst || 1;
        for (let i = 0; i < burst; i++) {
          window.spawnBulletAdapter(npc, bestTarget, weapon.def, { type: weapon.type });
        }
      }

      // Przeładowanie
      weapon.cd = weapon.def.rps ? (1.0 / weapon.def.rps) : 2.0;
    }
  }
}

// ============================================================================
// 3. MÓZGI NAWIGACYJNE (Tylko ruch statków)
// ============================================================================

export function aiFrigate(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) npc.target = freshTarget;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;

  let targetAng = npc.angle;
  let thrustNorm = 0;
  let strafeNorm = 0;

  if (target && !target.dead) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    
    const idealRange = npc.preferredRange || 750;
    const angleDiff = Math.abs(window.wrapAngle(targetAng - npc.angle));

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
    if (Math.abs(window.wrapAngle(targetAng - npc.angle)) < 0.8) thrustNorm = 0.4;
  }

  // 1. Ruch
  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  
  // 2. Autonomiczne strzelanie
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

  let targetAng = npc.angle;
  let thrustNorm = 0;
  let strafeNorm = 0;

  if (target && !target.dead) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    targetAng = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);

    // Destroyer lubi skracać dystans, żeby wejść w walkę średniodystansową
    const range = 800; 
    const wantRange = range * 0.8;
    const angleDiff = Math.abs(window.wrapAngle(targetAng - npc.angle));

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

  // 1. Ruch
  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, npc.boostT, dt);

  // 2. Autonomiczne strzelanie
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

  let targetAng = npc.angle;
  let thrustNorm = 0;
  let strafeNorm = 0;

  // Główny cel nawigacji (statek orientuje się pod "Broadside" względem najgroźniejszego celu)
  if (target && !target.dead) {
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    const dist = Math.hypot(dx, dy);
    const toAng = Math.atan2(dy, dx);

    const idealDist = 600; // Preferowany dystans dla pancernika (aby móc bić z broadside'a)
    
    const rightAng = toAng + Math.PI / 2;
    const leftAng = toAng - Math.PI / 2;

    const diffNose = Math.abs(window.wrapAngle(toAng - npc.angle));
    const diffRight = Math.abs(window.wrapAngle(rightAng - npc.angle));
    const diffLeft = Math.abs(window.wrapAngle(leftAng - npc.angle));

    // Battleship ustawia się bokiem, gdy jest wystarczająco blisko
    if (dist < 750 && (Math.min(diffRight, diffLeft) + 0.2 < diffNose)) {
      targetAng = (diffRight <= diffLeft) ? rightAng : leftAng;
      
      thrustNorm = 0; // Utrzymuj pozycję do ostrzału
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

  // 1. Ruch
  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);

  // 2. Autonomiczne strzelanie
  processAutonomousWeapons(npc, dt);
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;
