// src/game/weaponController.js
// Per-ship weapon controller for split-screen P1/P2 independence
// Extracts firing logic from index.html into reusable instances
import { getMountedWeaponAim, mountedWeaponBase, stepMountedWeaponAim } from './weaponAim.js';
import { Turret2D } from '../vfx/turret2D.js';

const AIM_GROUPS = ['main', 'missile', 'special', 'special_missile'];
const EMPTY_WEAPONS = [];
const _aimBase = { x: 0, y: 0 };
const _aimPoint = { x: 0, y: 0 };
const _muzzleOffset = { x: 0, y: 0 };

// OPTYMALIZACJA: Pre-alokowany obiekt, używany wielokrotnie podczas wyliczania Muzzle.
// Zabija to powstawanie setek tysięcy obiektów na sekundę dla Garbage Collectora.
const _muzzleScratch = {
  pos: { x: 0, y: 0 },
  dir: { x: 0, y: 0 },
  baseVel: { x: 0, y: 0 },
  emitterUid: ''
};

function targetIsAlive(target) {
  if (typeof window !== 'undefined' && typeof window.isTargetAlive === 'function') return window.isTargetAlive(target);
  return !!(target && !target.dead && !target.destroyed && !target.removed);
}

function targetIsLockable(target) {
  if (typeof window !== 'undefined' && typeof window.isLockableTarget === 'function') return window.isLockableTarget(target);
  if (typeof window !== 'undefined' && typeof window.isHostileNpc === 'function') return window.isHostileNpc(target);
  return targetIsAlive(target);
}

function targetX(target) {
  if (typeof window !== 'undefined' && typeof window.getTargetX === 'function') return window.getTargetX(target);
  if (Number.isFinite(Number(target?.pos?.x))) return Number(target.pos.x);
  return Number(target?.worldX ?? target?.x) || 0;
}

function targetY(target) {
  if (typeof window !== 'undefined' && typeof window.getTargetY === 'function') return window.getTargetY(target);
  if (Number.isFinite(Number(target?.pos?.y))) return Number(target.pos.y);
  return Number(target?.worldY ?? target?.y) || 0;
}

/* ============================================================================
   SALWA WIELOLUFOWA
   `barrelsPerShot` z karty broni mówi, ile luf wypluwa JEDNO naciśnięcie.
   Broń główna respektowała to od zawsze (`triggerRailVolley` układa kolejkę
   z `shotGap`), ale zaczepy `special` strzelały z jednej lufy i cyklowały —
   trzylufowa bateria Yamato oddawała pojedynczy strzał zamiast salwy.

   Odstęp 85 ms to tryb 'ripple' z dema `muzzle-fx-3-lufy`. Salwowe 14 ms
   wychodziło poniżej jednej klatki przy 60 fps, więc trzy lufy czytały się
   jak jeden strzał. Na 85 ms każda dostaje własne 5 klatek — wychodzi
   bum-bum-bum, a nie bum.

   Do tego jitter: bez niego każda salwa ma identyczny rytm i po trzecim
   strzale słychać metronom. Jitter jest mniejszy od odstępu, więc lufy
   nigdy nie wyprzedzają się nawzajem.

   UWAGA BALANSOWA: jedno naciśnięcie wypuszcza teraz tyle pocisków, ile luf,
   więc obrażenia na strzał rosną `barrelsPerShot` razy przy tym samym
   przeładowaniu. Dla broni na amunicję koszt nadąża sam (`weaponAmmoPerShot`
   mnoży przez `barrelsPerShot`), ale Yamato jest w profilu `plasma`
   (`ammo: null`), a `energyCost` nigdzie nie jest egzekwowane — ta salwa
   nie kosztuje nic ponad dłuższy cooldown, jeśli się go nie podniesie.
   ========================================================================== */
export const SALVO_STEP = 0.085;
export const SALVO_JITTER = 0.035;

export function barrelsPerShotOf(weapon) {
  const n = Math.round(Number(weapon?.barrelsPerShot));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Kolejkuje lufy 1..n-1 na hardpoincie; lufę `start` odpala wołający od razu. */
export function queueSalvoBarrels(hp, weaponId, start, barrels) {
  if (!hp) return;
  // Zawsze od zera: przeładowanie blokuje kolejne naciśnięcie w trakcie salwy,
  // więc cokolwiek tu jeszcze wisi, jest resztką po przezbrojeniu zaczepu.
  const queue = hp.salvo || (hp.salvo = []);
  queue.length = 0;
  if (barrels <= 1) return;
  for (let b = 1; b < barrels; b++) {
    queue.push({ t: b * SALVO_STEP + Math.random() * SALVO_JITTER, barrel: start + b, wid: weaponId });
  }
}

/**
 * Opróżnia kolejkę salwy hardpointu; `fire(barrelIndex)` oddaje strzał.
 * Broń podmieniona w trakcie salwy kasuje resztę — inaczej pozostałe lufy
 * wystrzeliłyby z nowego działa.
 */
export function drainSalvoQueue(hp, weaponId, dt, fire) {
  const queue = hp?.salvo;
  if (!queue || !queue.length) return;
  let i = 0;
  while (i < queue.length) {
    const shot = queue[i];
    if (shot.wid !== weaponId) { queue.splice(i, 1); continue; }
    shot.t -= dt;
    if (shot.t > 0) { i++; continue; }
    queue.splice(i, 1);
    fire(shot.barrel);
  }
}

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
    this.prevMainTrigger = false;
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

  get specialMissileWeapons() {
    return this.weapons[window.HP?.SPECIAL_MISSILE || 'special_missile'] || [];
  }

  get builtInWeapons() {
    return this.weapons[window.HP?.BUILTIN || 'builtin'] || [];
  }

  get auxWeapons() {
    return this.weapons[window.HP?.AUX || 'aux'] || [];
  }

  updateAim(dt) {
    const mouse = this.getMouseRef();
    const mouseWorld = this.screenToWorldFn(mouse.x, mouse.y);
    const ship = this.ship;
    const targets = this.lockedTargets || EMPTY_WEAPONS;
    const fallback = this.lockedTarget;
    for (const group of AIM_GROUPS) {
      const loadouts = this.weapons[group] || EMPTY_WEAPONS;
      for (let i = 0; i < loadouts.length; i++) {
        const loadout = loadouts[i];
        if (!loadout?.weapon || !loadout.hp || loadout.hp.destroyed) continue;
        const weapon = loadout.weapon;
        const state = getMountedWeaponAim(ship, loadout);
        const range = (weapon.baseRange || weapon.range || 1000) * (ship.modifiers?.range || 1);
        // Stable round-robin assignment, shared by aiming and firing. No random
        // target switch at the instant of a shot, and no temporary target arrays.
        let count = 0;
        for (let j = 0; j < targets.length; j++) {
          const target = targets[j];
          if (!targetIsAlive(target)) continue;
          if (group === 'main' && Math.hypot(targetX(target) - ship.pos.x, targetY(target) - ship.pos.y) > range) continue;
          count++;
        }
        state.target = targets.length === 0 && targetIsAlive(fallback) ? fallback : null;
        if (count > 0) {
          let ordinal = i % count;
          for (let j = 0; j < targets.length; j++) {
            const target = targets[j];
            if (!targetIsAlive(target)) continue;
            if (group === 'main' && Math.hypot(targetX(target) - ship.pos.x, targetY(target) - ship.pos.y) > range) continue;
            if (ordinal-- === 0) { state.target = target; break; }
          }
        }
        mountedWeaponBase(ship, loadout.hp, _aimBase);
        let aimPoint = mouseWorld;
        if (state.target) {
          if (weapon.category !== 'beam' && typeof window.getLeadAim === 'function') {
            aimPoint = window.getLeadAim(_aimBase, state.target,
              (weapon.baseSpeed || 1000) * (ship.modifiers?.projectileSpeed || 1));
          } else {
            _aimPoint.x = targetX(state.target);
            _aimPoint.y = targetY(state.target);
            aimPoint = _aimPoint;
          }
        }
        stepMountedWeaponAim(state, _aimBase, aimPoint, dt, ship.turret);
      }
    }
  }

  computeMountedMuzzle(loadout, barrelIndex = 0) {
    const ship = this.ship;
    const state = getMountedWeaponAim(ship, loadout);
    mountedWeaponBase(ship, loadout.hp, _muzzleScratch.pos);
    Turret2D.writeMuzzleOffset(ship, loadout.weapon, barrelIndex, _muzzleOffset);
    const c = Math.cos(state.angle);
    const s = Math.sin(state.angle);
    _muzzleScratch.pos.x += _muzzleOffset.x * c - _muzzleOffset.y * s;
    _muzzleScratch.pos.y += _muzzleOffset.x * s + _muzzleOffset.y * c;
    _muzzleScratch.dir.x = c;
    _muzzleScratch.dir.y = s;
    _muzzleScratch.baseVel.x = ship.vel?.x || ship.vx || 0;
    _muzzleScratch.baseVel.y = ship.vel?.y || ship.vy || 0;
    return _muzzleScratch;
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
    let maxCooldown = 0;

    for (let i = 0; i < mainWeapons.length; i++) {
      if (specificWeaponIdx !== -1 && i !== specificWeaponIdx) continue;

      const weaponData = mainWeapons[i]?.weapon;
      if (!weaponData) continue;

      if (!mainWeapons[i].hp) continue;
      const aim = getMountedWeaponAim(ship, mainWeapons[i]);

      const barrelsPerShot = Number.isFinite(Number(weaponData.barrelsPerShot))
        ? Math.max(1, Math.round(Number(weaponData.barrelsPerShot)))
        : (weaponData.size === 'L' ? 1 : 2);
        
      // Zwraca wskaźnik na mutowalny obiekt _muzzleScratch
      const muzzle = this.computeMountedMuzzle(mainWeapons[i], barIndex);
      const baseEmitterUid = `${this.owner}_main_${i}_${weaponData.id || 'x'}`;
      muzzle.emitterUid = barrelsPerShot > 1 ? `${baseEmitterUid}:b${barIndex}` : baseEmitterUid;

      const targetToPass = targetIsAlive(aim.target) ? aim.target : null;
      if (this.autoFire && this.lockedTargets.length && !targetToPass) continue;
      const cd = window.fireWeaponCore(ship, targetToPass, weaponData.id, muzzle);

      // Muzzle flash VFX
      // Armata i Tempest Ion mają własny błysk 3D z dema
      // (src/3d/muzzleFx3D.js) — kanwowy rozbłysk pod nim to druga
      // warstwa tego samego efektu w tym samym punkcie.
      const CanvasVFX = window.CanvasVFX;
      const rich3D = window.MuzzleFX3D?.handles(weaponData.id) === true;
      if (CanvasVFX && !rich3D && weaponData.category !== 'beam') {
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
    const aim = getMountedWeaponAim(ship, loadout);
    const target = targetIsAlive(aim.target) ? aim.target : null;
    const weapon = loadout?.weapon;
    const hp = loadout?.hp;
    if (!weapon || !hp) return false;

    if (!this._consumeMissileAmmo(loadout)) return;
    
    // Zwraca wskaźnik na mutowalny obiekt _muzzleScratch
    const muzzle = this.computeMountedMuzzle(loadout);
    muzzle.emitterUid = `${this.owner}_missile_${weapon.id || 'x'}_${hp.id || 'hp'}`;
    
    const cd = window.fireWeaponCore(ship, target, weapon.id, muzzle);
    hp.missileCd = Math.max(0.01, Number(cd) || Number(weapon.cooldown) || 0.25);
    return true;
  }

  // ==================== SPECIAL WEAPONS ====================

  // Jeden strzał z jednej lufy zaczepu `special`. Cel i kąt liczymy
  // W CHWILI STRZAŁU, nie kolejkowania — wieżyczka obraca się w trakcie salwy,
  // a cel może w tym czasie zginąć.
  fireSpecialBarrel(loadout, hp, slot, barrelIndex, emitterPrefix, multiBarrel) {
    const ship = this.ship;
    const weapon = loadout?.weapon;
    if (!weapon || !ship || ship.dead) return 0;
    const aim = getMountedWeaponAim(ship, loadout);
    const target = targetIsAlive(aim.target) ? aim.target : null;
    this.computeMountedMuzzle(loadout, barrelIndex);
    const base = `${this.owner}_${emitterPrefix}:${hp?.id || slot}`;
    _muzzleScratch.emitterUid = multiBarrel ? `${base}:b${barrelIndex}` : base;
    return Number(window.fireWeaponCore(ship, target, weapon.id, _muzzleScratch)) || 0;
  }

  tryFireSpecialWeapons() {
    const standardSpecials = this.specialWeapons;
    const specialMissiles = this.specialMissileWeapons;
    if (standardSpecials.length === 0 && specialMissiles.length === 0) return false;

    const ship = this.ship;
    let fired = false;

    const groups = [standardSpecials, specialMissiles];
    for (let g = 0; g < groups.length; g++) {
      const specials = groups[g];
      const emitterPrefix = g === 0 ? 'special' : 'special_missile';
      for (let i = 0; i < specials.length; i++) {
        const loadout = specials[i];
        const weapon = loadout?.weapon;
        if (!weapon || weapon.id === 'hexlance_siege') continue;

        const hp = loadout?.hp;
        const hpPos = hp?.pos || hp;
        if (!hp || !hpPos) continue;

        const cdLeft = Math.max(0, Number(hp.specialCd) || 0);
        if (cdLeft > 0) continue;

        // Salwa: `barrelsPerShot` luf na jedno naciśnięcie. Pierwsza idzie
        // od razu, reszta z kolejki w `updateCooldowns`.
        const aim = getMountedWeaponAim(ship, loadout);
        const barrels = barrelsPerShotOf(weapon);
        const start = Number(aim.nextBarrel) || 0;
        aim.nextBarrel = start + barrels;

        const cd = this.fireSpecialBarrel(loadout, hp, i, start, emitterPrefix, barrels > 1);
        hp.specialCd = Math.max(0.01, cd || Number(weapon.cooldown) || 0.25);
        queueSalvoBarrels(hp, weapon.id, start, barrels);
        fired = true;
      }
    }

    return fired;
  }

  tryFireBuiltInWeapons() {
    const builtins = this.builtInWeapons;
    if (builtins.length === 0) return false;
    if (this.owner !== 'player') return false;

    const hasHexlance = builtins.some(loadout => loadout?.weapon?.id === 'hexlance_siege');
    if (!hasHexlance) return false;
    return !!window.Superweapon?.tryFireSuperweapon(this.ship);
  }

  // ==================== UPDATE (called every frame) ====================

  update(dt) {
    const ship = this.ship;
    if (!ship || ship.destroyed) return;

    this.updateAim(window.warp?.state === 'active' ? 0 : dt);
    const mouseRef = this.getMouseRef();
    const warpBusy = window.warp?.isBusy?.() || false;
    const stationOpen = window.stationUI?.open || false;

    // Rail cooldowns
    this.rail.cd[0] = Math.max(0, this.rail.cd[0] - dt);
    this.rail.cd[1] = Math.max(0, this.rail.cd[1] - dt);
    const requiredBarrels = Math.max(1, this.rail.barrelsPerShot || 2);
    const secondaryReady = requiredBarrels < 2 || this.rail.cd[1] <= 0;

    // Sterowanie bronią ma osobny sygnał. LPM należy wyłącznie do celownika.
    const hasTargets = this.lockedTargets && this.lockedTargets.length > 0;
    const mainTrigger = !!mouseRef.fireMain;
    if (mainTrigger && !this.prevMainTrigger && hasTargets) {
      this.autoFire = !this.autoFire;
      if (typeof window.pushZoneMessage === 'function') {
         window.pushZoneMessage(this.autoFire ? 'AUTO-FIRE: ON' : 'AUTO-FIRE: OFF', 1.5);
      }
    }
    this.prevMainTrigger = mainTrigger;

    // Turn off autofire if no targets
    if (!hasTargets) {
      this.autoFire = false;
    }

    // Main weapon trigger (klawisz/pad OR autoFire with range check)
    const canAutoFire = this.autoFire && hasTargets && this._hasAnyTargetInRange();
    const wantsToFire = (!stationOpen && mainTrigger && !hasTargets) || canAutoFire;
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
    const specialGroups = [this.specialWeapons, this.specialMissileWeapons];
    for (let g = 0; g < specialGroups.length; g++) {
      const specials = specialGroups[g];
      const emitterPrefix = g === 0 ? 'special' : 'special_missile';
      for (let i = 0; i < specials.length; i++) {
        const loadout = specials[i];
        const hp = loadout?.hp;
        if (!hp) continue;
        // Reszta salwy wielolufowej. Domknięcie powstaje TYLKO gdy kolejka
        // coś trzyma — czyli przez ~30 ms po strzale, a nie co klatkę.
        if (hp.salvo && hp.salvo.length) {
          drainSalvoQueue(hp, loadout?.weapon?.id, dt,
            (barrel) => this.fireSpecialBarrel(loadout, hp, i, barrel, emitterPrefix, true));
        }
        if (typeof hp.specialCd === 'number') {
          hp.specialCd = Math.max(0, hp.specialCd - dt);
        }
      }
    }

    // Validate locked targets
    const lt = this.lockedTarget;
    if (lt && !targetIsLockable(lt)) this.lockedTarget = null;
    
    // OPTYMALIZACJA: In-place filtering dla locked targets (bez alokacji)
    let validCount = 0;
    for (let i = 0; i < this._lockedTargets.length; i++) {
        const t = this._lockedTargets[i];
        if (targetIsLockable(t)) {
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
        if (!targetIsLockable(t)) continue;
        if (Math.hypot(targetX(t) - ship.pos.x, targetY(t) - ship.pos.y) <= maxRng) return true;
    }
    return false;
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

}
