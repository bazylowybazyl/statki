// src/game/weaponController.js
// Per-ship weapon controller for split-screen P1/P2 independence
// Extracts firing logic from index.html into reusable instances

// OPTYMALIZACJA: Pre-alokowany obiekt, używany wielokrotnie podczas wyliczania Muzzle.
// Zabija to powstawanie setek tysięcy obiektów na sekundę dla Garbage Collectora.
const _muzzleScratch = {
  pos: { x: 0, y: 0 },
  dir: { x: 0, y: 0 },
  baseVel: { x: 0, y: 0 },
  emitterUid: ''
};

export class WeaponController {
  constructor({ ship, getMouseRef, getLockedTarget, setLockedTarget, getLockedTargets, owner, screenToWorldFn }) {
    this.ship = ship;
    this.getMouseRef = getMouseRef;         // () => mouse or mouse2
    this.getLockedTarget = getLockedTarget; // () => lockedTarget or lockedTarget2
    this.setLockedTarget = setLockedTarget; // (t) => set locked target
    this.getLockedTargets = getLockedTargets; // () => lockedTargets or []
    this.owner = owner;                     // 'player' or 'player2'
    this.screenToWorldFn = screenToWorldFn; // screenToWorld function

    // Rail (main weapon) state
    this.rail = {
      cd: [0, 0],
      cdMax: 0.15,
      shotGap: 0.08,
      burstGap: 0.2,
      burstsPerClick: 1,
      barrelsPerShot: 2,
      queue: [],
      nextStart: 0,
      behaviorId: 'default',
    };
    this.railTimer = 0;

    // Missile state
    this.rocketCooldown = 0;
    this.nextRocketIndexLeft = 0;
    this.nextRocketIndexRight = 0;
    this.nextRocketIndexAny = 0;

    // Locked targets
    this._lockedTargets = [];

    // Autofire state
    this.autoFire = false;
    this.prevMouseLeft = false;
  }

  get lockedTarget() { return this.getLockedTarget(); }
  set lockedTarget(t) { this.setLockedTarget(t); }

  get lockedTargets() { return this.getLockedTargets ? this.getLockedTargets() : this._lockedTargets; }

  /** Get weapons dict. P1 parses Game.player.weapons, P2 uses ship.weapons */
  get weapons() {
    return this.ship.weapons || {};
  }

  get mainWeapons() {
    return this.weapons[window.HP?.MAIN || 'main'] || [];
  }

  get missileWeapons() {
    return this.weapons[window.HP?.MISSILE || 'missile'] || [];
  }

  get specialWeapons() {
    return this.weapons[window.HP?.SPECIAL || 'special'] || [];
  }

  get builtInWeapons() {
    return this.weapons[window.HP?.BUILTIN || 'builtin'] || [];
  }

  get auxWeapons() {
    return this.weapons[window.HP?.AUX || 'aux'] || [];
  }

  // ==================== MAIN WEAPONS ====================

  triggerRailVolley() {
    const mainWeapons = this.mainWeapons;
    if (!mainWeapons.length) return;
    if (this.rail.queue.length) return;

    const start = this.rail.nextStart;
    this.rail.nextStart ^= 1;
    const barrels = Math.max(1, this.rail.barrelsPerShot || 2);
    
    // OPTYMALIZACJA: brak tablic lokalnych, szybsze mapowanie luf
    const order0 = start;
    const order1 = barrels === 1 ? -1 : 1 - start;

    for (let b = 0; b < this.rail.burstsPerClick; b++) {
      const baseDelay = b * ((barrels === 1 ? 1 : 2) * this.rail.shotGap + this.rail.burstGap);
      for (let idx = 0; idx < barrels; idx++) {
        const barrelBaseTime = baseDelay + idx * this.rail.shotGap;
        const currentBarrel = idx === 0 ? order0 : order1;
        
        for (let w = 0; w < mainWeapons.length; w++) {
          this.rail.queue.push({
            timer: barrelBaseTime + Math.random() * 0.12,
            barrel: currentBarrel,
            weaponIndex: w,
            ignoreCD: true
          });
        }
      }
    }
  }

  fireRailBarrel(barIndex, specificWeaponIdx = -1) {
    const mainWeapons = this.mainWeapons;
    if (!mainWeapons.length) return;

    const ship = this.ship;
    const turrets = [ship.turret, ship.turret2, ship.turret3, ship.turret4];
    let maxCooldown = 0;

    for (let i = 0; i < mainWeapons.length; i++) {
      if (specificWeaponIdx !== -1 && i !== specificWeaponIdx) continue;

      const weaponData = mainWeapons[i]?.weapon;
      if (!weaponData) continue;

      const hpOffset = mainWeapons[i]?.hp?.pos;
      const turretIndex = hpOffset ? this._getNearestTurretIndex(hpOffset, turrets) : (i % turrets.length);
      const t = turrets[turretIndex];
      const aimAngle = t?.angle ?? ship.angle;
      const muzzleOffset = hpOffset || t?.offset;

      const barrelsPerShot = Number.isFinite(Number(weaponData.barrelsPerShot))
        ? Math.max(1, Math.round(Number(weaponData.barrelsPerShot)))
        : (weaponData.size === 'L' ? 1 : 2);
        
      // Zwraca wskaźnik na mutowalny obiekt _muzzleScratch
      const muzzle = this._computeMainMuzzle(muzzleOffset, aimAngle, barIndex, barrelsPerShot);
      const baseEmitterUid = `${this.owner}_main_${i}_${weaponData.id || 'x'}`;
      muzzle.emitterUid = barrelsPerShot > 1 ? `${baseEmitterUid}:b${barIndex}` : baseEmitterUid;

      let targetToPass = this.lockedTarget;
      if (this.autoFire && this.lockedTargets && this.lockedTargets.length > 0) {
        const rng = weaponData.baseRange || 1000;
        const fmRangeScale = (this.owner === 'player' && typeof window.getFiringModeModifiers === 'function') ? (window.getFiringModeModifiers()?.rangeMul || 1.0) : 1.0;
        const actualRng = rng * fmRangeScale;
        
        // OPTYMALIZACJA: Wyszukiwanie celu w locie (bez alokacji z filter)
        let validTargets = [];
        for(let j=0; j<this.lockedTargets.length; j++) {
           const ltar = this.lockedTargets[j];
           if (Math.hypot(ltar.x - ship.pos.x, ltar.y - ship.pos.y) <= actualRng) validTargets.push(ltar);
        }
        if (validTargets.length > 0) {
            targetToPass = validTargets[Math.floor(Math.random() * validTargets.length)];
        } else {
            continue; // Cannot fire this individual weapon, out of range
        }
      }

      const cd = window.fireWeaponCore(ship, targetToPass, weaponData.id, muzzle);

      // Turret recoil
      const recoilKick = weaponData.category === 'beam' ? 6 : 12;
      const recoilMax = 18;
      if (t && Array.isArray(t.recoil)) {
        const idx = barIndex % 2;
        t.recoil[idx] = Math.min(t.recoil[idx] + recoilKick, recoilMax);
      } else if (t) {
        t.recoil = Math.min(t.recoil + recoilKick, recoilMax);
      }

      // Muzzle flash VFX
      const CanvasVFX = window.CanvasVFX;
      if (CanvasVFX && weaponData.category !== 'beam') {
        const isHeavy = (weaponData.size === 'L' || weaponData.size === 'Capital');
        const muzzleScale = isHeavy ? 1.8 : 1.0;
        if (weaponData.category === 'torpedo') {
          CanvasVFX.spawnArmataMuzzle(muzzle.pos, muzzle.dir, ship.vel, muzzleScale * 1.5);
        } else if (weaponData.category === 'superweapon' || weaponData.id === 'siege_railgun') {
          CanvasVFX.spawnRailMuzzle(muzzle.pos, muzzle.dir, ship.vel, muzzleScale * 2.0);
        } else if (weaponData.category === 'armata' || weaponData.category === 'plasma') {
          CanvasVFX.spawnArmataMuzzle(muzzle.pos, muzzle.dir, ship.vel, muzzleScale);
        } else if (weaponData.category === 'autocannon') {
          CanvasVFX.spawnAutocannonMuzzle(muzzle.pos, muzzle.dir, ship.vel, muzzleScale);
        } else {
          CanvasVFX.spawnRailMuzzle(muzzle.pos, muzzle.dir, ship.vel, muzzleScale);
        }
      }

      maxCooldown = Math.max(maxCooldown, cd || this.rail.cdMax);
    }

    this.rail.cd[barIndex] = maxCooldown || this.rail.cdMax;
  }

  // ==================== MISSILES ====================

  fireRocket(side) {
    const missileWeapons = this.missileWeapons;
    if (!missileWeapons.length) return;

    const loadout = this._selectMissileLoadout(side);
    if (!loadout) return;

    const ship = this.ship;
    const target = (this.lockedTarget && !this.lockedTarget.dead) ? this.lockedTarget : null;
    const weapon = loadout?.weapon;
    const hp = loadout?.hp;
    if (!weapon || !hp) return false;

    if (!this._consumeMissileAmmo(loadout)) return;
    
    // Zwraca wskaźnik na mutowalny obiekt _muzzleScratch
    const muzzle = this._computeMissileMuzzle(hp);
    muzzle.emitterUid = `${this.owner}_missile_${weapon.id || 'x'}_${hp.id || 'hp'}`;
    
    const cd = window.fireWeaponCore(ship, target, weapon.id, muzzle);
    hp.missileCd = Math.max(0.01, Number(cd) || Number(weapon.cooldown) || 0.25);
    return true;
  }

  // ==================== SPECIAL WEAPONS ====================

  tryFireSpecialWeapons() {
    const specials = this.specialWeapons;
    const builtins = this.builtInWeapons;
    if (specials.length === 0 && builtins.length === 0) return false;

    const ship = this.ship;
    let fired = false;

    // Hexlance (only for P1 for now — Superweapon system is global)
    if (this.owner === 'player') {
      const hasHexlance = builtins.some(l => l?.weapon?.id === 'hexlance_siege');
      if (hasHexlance && window.Superweapon?.tryFireSuperweapon(ship)) fired = true;
    }

    const target = (this.lockedTarget && !this.lockedTarget.dead) ? this.lockedTarget : null;
    const mouseRef = this.getMouseRef();
    const mouseWorld = this.screenToWorldFn(mouseRef.x, mouseRef.y);
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    const shipVel = ship.vel || { x: ship.vx || 0, y: ship.vy || 0 };

    for (let i = 0; i < specials.length; i++) {
      const loadout = specials[i];
      const weapon = loadout?.weapon;
      if (!weapon || weapon.id === 'hexlance_siege') continue;

      const hp = loadout?.hp;
      const hpPos = hp?.pos || hp;
      if (!hp || !hpPos) continue;

      const cdLeft = Math.max(0, Number(hp.specialCd) || 0);
      if (cdLeft > 0) continue;

      const localX = Number(hpPos.x) || 0;
      const localY = Number(hpPos.y) || 0;
      const muzzleX = ship.pos.x + (localX * c - localY * s);
      const muzzleY = ship.pos.y + (localX * s + localY * c);
      const dx = mouseWorld.x - muzzleX;
      const dy = mouseWorld.y - muzzleY;
      const len = Math.hypot(dx, dy) || 1;

      // Recycle the scratch object for special weapons too
      _muzzleScratch.pos.x = muzzleX;
      _muzzleScratch.pos.y = muzzleY;
      _muzzleScratch.dir.x = dx / len;
      _muzzleScratch.dir.y = dy / len;
      _muzzleScratch.baseVel.x = shipVel.x || 0;
      _muzzleScratch.baseVel.y = shipVel.y || 0;
      _muzzleScratch.emitterUid = `${this.owner}_special:${hp?.id || i}`;

      const cd = window.fireWeaponCore(ship, target, weapon.id, _muzzleScratch);
      hp.specialCd = Math.max(0.01, Number(cd) || Number(weapon.cooldown) || 0.25);
      fired = true;
    }

    return fired;
  }

  // ==================== UPDATE (called every frame) ====================

  update(dt) {
    const ship = this.ship;
    if (!ship || ship.destroyed) return;

    const mouseRef = this.getMouseRef();
    const warpBusy = window.warp?.isBusy?.() || false;
    const stationOpen = window.stationUI?.open || false;

    // Rail cooldowns
    this.rail.cd[0] = Math.max(0, this.rail.cd[0] - dt);
    this.rail.cd[1] = Math.max(0, this.rail.cd[1] - dt);
    const requiredBarrels = Math.max(1, this.rail.barrelsPerShot || 2);
    const secondaryReady = requiredBarrels < 2 || this.rail.cd[1] <= 0;

    // Process mouse click for toggle
    const hasTargets = this.lockedTargets && this.lockedTargets.length > 0;
    if (mouseRef.left && !this.prevMouseLeft && hasTargets) {
      this.autoFire = !this.autoFire;
      if (typeof window.pushZoneMessage === 'function') {
         window.pushZoneMessage(this.autoFire ? 'AUTO-FIRE: ON' : 'AUTO-FIRE: OFF', 1.5);
      }
    }
    this.prevMouseLeft = mouseRef.left;

    // Turn off autofire if no targets
    if (!hasTargets) {
      this.autoFire = false;
    }

    // Main weapon trigger (mouse.left / mouse2.left OR autoFire with range check)
    const canAutoFire = this.autoFire && hasTargets && this._hasAnyTargetInRange();
    const wantsToFire = (!stationOpen && mouseRef.left && !hasTargets) || canAutoFire;
    if (wantsToFire && this.rail.queue.length === 0 &&
        this.rail.cd[0] <= 0 && secondaryReady && !warpBusy) {
      this.triggerRailVolley();
    }

    // Process rail queue
    for (const q of this.rail.queue) q.timer -= dt;
    let firedSomething = true;
    while (firedSomething) {
      firedSomething = false;
      for (let i = 0; i < this.rail.queue.length; i++) {
        const q = this.rail.queue[i];
        const canFire = q.ignoreCD || this.rail.cd[q.barrel] <= 0;
        if (q.timer <= 0 && canFire && !warpBusy) {
          this.fireRailBarrel(q.barrel, q.weaponIndex);
          this.rail.queue.splice(i, 1);
          firedSomething = true;
          break;
        }
      }
    }
    this.railTimer = (requiredBarrels > 1)
      ? Math.min(this.rail.cd[0], this.rail.cd[1])
      : this.rail.cd[0];

    // Rocket cooldown + trigger (mouse.right / mouse2.right)
    this.rocketCooldown = Math.max(0, this.rocketCooldown - dt);
    for (const loadout of this.missileWeapons) {
      const hp = loadout?.hp;
      if (hp && typeof hp.missileCd === 'number') hp.missileCd = Math.max(0, hp.missileCd - dt);
    }
    const hasMissiles = this.missileWeapons.length > 0;
    if (!stationOpen && mouseRef.right && !warpBusy && hasMissiles && this.rocketCooldown <= 0) {
      const mouseWorld = this.screenToWorldFn(mouseRef.x, mouseRef.y);
      const local = window.rotateInv
        ? window.rotateInv({ x: mouseWorld.x - ship.pos.x, y: mouseWorld.y - ship.pos.y }, ship.angle)
        : { y: 0 };
      const side = (local.y >= 0) ? 'right' : 'left';
      if (this.fireRocket(side)) this.rocketCooldown = 0.11; // ROCKET_FIRE_INTERVAL
    }

    // Special weapon cooldowns
    for (const s of this.specialWeapons) {
      if (s?.hp && typeof s.hp.specialCd === 'number') {
        s.hp.specialCd = Math.max(0, s.hp.specialCd - dt);
      }
    }

    // Validate locked targets
    const isHostile = window.isHostileNpc || (() => true);
    const lt = this.lockedTarget;
    if (lt && (!isHostile(lt) || lt.dead)) this.lockedTarget = null;
    
    // OPTYMALIZACJA: In-place filtering dla locked targets (bez alokacji)
    let validCount = 0;
    for (let i = 0; i < this._lockedTargets.length; i++) {
        const t = this._lockedTargets[i];
        if (isHostile(t) && !t.dead) {
            this._lockedTargets[validCount++] = t;
        }
    }
    this._lockedTargets.length = validCount;
  }

  // ==================== PRIVATE HELPERS ====================

  _hasAnyTargetInRange() {
    if (!this.lockedTargets || !this.lockedTargets.length) return false;
    let maxRng = 0;
    const fmRangeScale = (this.owner === 'player' && typeof window.getFiringModeModifiers === 'function') ? (window.getFiringModeModifiers()?.rangeMul || 1.0) : 1.0;
    for (let i = 0; i < this.mainWeapons.length; i++) {
        const w = this.mainWeapons[i]?.weapon;
        if (w && (w.baseRange * fmRangeScale) > maxRng) maxRng = w.baseRange * fmRangeScale;
    }
    const ship = this.ship;
    for (const t of this.lockedTargets) {
        if (Math.hypot(t.x - ship.pos.x, t.y - ship.pos.y) <= maxRng) return true;
    }
    return false;
  }

  _getNearestTurretIndex(offset, turrets) {
    if (!offset || !turrets.length) return -1;
    let bestIndex = 0, bestDist = Infinity;
    for (let i = 0; i < turrets.length; i++) {
      const t = turrets[i];
      if (!t?.offset) continue;
      const dx = offset.x - t.offset.x;
      const dy = offset.y - t.offset.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestIndex = i; }
    }
    return bestIndex;
  }

  _computeMainMuzzle(offset, angle, barIndex, barrelsPerShot) {
    const spriteScale = this.ship.visual?.spriteScale || 1;
    const forwardLen = Math.min((this.ship.h * spriteScale) * 0.40, 52 * spriteScale);
    const offsetFrac = barrelsPerShot === 1 ? 0 : (Math.min(barIndex, barrelsPerShot - 1) / (barrelsPerShot - 1) - 0.5) * 2;
    const lateralOffset = (5 * spriteScale) * offsetFrac; // gap * 0.5 uproszczony
    
    const fX = Math.cos(angle);
    const fY = Math.sin(angle);
    
    // Obrot offsetu
    const c = Math.cos(this.ship.angle);
    const s = Math.sin(this.ship.angle);
    const offX = offset ? (offset.x * c - offset.y * s) : 0;
    const offY = offset ? (offset.x * s + offset.y * c) : 0;
    
    _muzzleScratch.pos.x = this.ship.pos.x + offX + fX * forwardLen + (-fY) * lateralOffset;
    _muzzleScratch.pos.y = this.ship.pos.y + offY + fY * forwardLen + fX * lateralOffset;
    _muzzleScratch.dir.x = fX;
    _muzzleScratch.dir.y = fY;
    _muzzleScratch.baseVel.x = this.ship.vel.x;
    _muzzleScratch.baseVel.y = this.ship.vel.y;
    
    return _muzzleScratch;
  }

  _selectMissileLoadout(side) {
    const entries = this.missileWeapons;
    const available = entries.filter(e => {
      const hp = e?.hp;
      return hp?.mount && !hp?.destroyed && (hp.ammo === null || hp.ammo > 0) && ((Number(hp.missileCd) || 0) <= 0);
    });
    if (!available.length) return null;
    const coord = (entry) => {
      const pos = entry?.hp?.pos;
      if (!pos) return 0;
      const y = Number(pos.y) || 0;
      return Math.abs(y) > 1e-3 ? y : (Number(pos.x) || 0);
    };
    let pool = available;
    let cursorKey = 'nextRocketIndexAny';
    if (side === 'left') {
      const preferred = available.filter(e => coord(e) <= 0);
      if (preferred.length) pool = preferred;
      cursorKey = 'nextRocketIndexLeft';
    } else if (side === 'right') {
      const preferred = available.filter(e => coord(e) >= 0);
      if (preferred.length) pool = preferred;
      cursorKey = 'nextRocketIndexRight';
    }
    const idx = Math.max(0, Number(this[cursorKey]) || 0);
    const selected = pool[idx % pool.length] || pool[0] || null;
    this[cursorKey] = pool.length > 0 ? ((idx + 1) % pool.length) : 0;
    return selected;
  }

  _consumeMissileAmmo(loadout) {
    const hp = loadout?.hp;
    if (!hp) return false;
    if (typeof hp.ammo === 'number') {
      if (hp.ammo <= 0) return false;
      hp.ammo = Math.max(0, hp.ammo - 1);
    }
    return true;
  }

  _computeMissileMuzzle(hp) {
    const hpPos = hp?.pos || hp || { x: 0, y: 0 };
    const localX = Number(hpPos.x) || 0;
    const localY = Number(hpPos.y) || 0;
    const c = Math.cos(this.ship.angle || 0);
    const s = Math.sin(this.ship.angle || 0);
    
    _muzzleScratch.pos.x = this.ship.pos.x + (localX * c - localY * s);
    _muzzleScratch.pos.y = this.ship.pos.y + (localX * s + localY * c);
    _muzzleScratch.dir.x = c;
    _muzzleScratch.dir.y = s;
    _muzzleScratch.baseVel.x = this.ship.vel?.x || this.ship.vx || 0;
    _muzzleScratch.baseVel.y = this.ship.vel?.y || this.ship.vy || 0;
    
    return _muzzleScratch;
  }
}
