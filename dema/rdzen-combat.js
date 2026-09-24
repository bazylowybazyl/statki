// Replika ścieżki trafienia gry dla dema rdzenia i benchmarku (bez DOM/three).
// Źródła 1:1 (index.html, numery przybliżone):
//   fireWeaponCore (~8175)             → fireWeapon
//   bulletsAndCollisionsStep (~18488)  → stepBullets (gałąź kadłubów heksowych)
//   raymarch wiązki (~8385)            → fireBeam (findBeamHexShard, heks do applyImpact)
//   applyHexImpact (~8241)             → applyHexImpact (heks z sweep/raymarchu)
//   rocketSystem3D _onHit/_applyBlastDamage → rakiety 3D: TYLKO pula HP
//   applyDamageToNPC (~18097) / applyDamageToPlayer (~17653) → applyHullDamage
//   enforceNpcHexIntegrityBalance (~18179) → enforceHexCap
//   applyAoeExplosionDamage (~17676)   → applyCoreBlast (+ NOWY krater heksów)
// Obrażenia bez własnego modelu: te same liczby co w grze, applyImpact
// z prędkością pocisku jako siłą, pełne obrażenia w pulę HP za każde trafienie.
import { DestructorSystem, DESTRUCTOR_CONFIG, getHexStructuralState } from '../src/game/destructor.js';
// Przestrzeń nazw: findBeamHexShard jest nowym eksportem (poprawka heksów-duchów
// w drzewie roboczym). Import nazwany wywaliłby demo na starszym destruktorze.
import * as DestructorModule from '../src/game/destructor.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { stepProjectileKinematics, shouldRemoveProjectileAfterImpact } from '../src/game/projectileTrajectory.js';
import { barrelsPerShotOf, SALVO_STEP } from '../src/game/weaponController.js';
import { segmentCircleToi } from '../src/physics/physicsKernel.js';
import {
  applyBlastHexDamage,
  applyBlastCoreShock,
  coreBlastFalloff,
  markCoreChainExposure,
  CORE_DEFAULTS
} from '../src/game/shipCore.js';

export function entityX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : Number(e?.x) || 0; }
export function entityY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : Number(e?.y) || 0; }

export function setEntityPos(e, x, y) {
  if (e.pos) { e.pos.x = x; e.pos.y = y; }
  e.x = x; e.y = y;
}

export function makeRng(seed = 1) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { segmentCircleToi };

// Kod gry po poprawce heksów-duchów (probeDriftCap, findBeamHexShard, heks
// podawany do applyImpact). Na starszym destruktorze — dawne ścieżki.
const gameFindBeamHexShard = typeof DestructorModule.findBeamHexShard === 'function' ? DestructorModule.findBeamHexShard : null;
export const GAME_HAS_DRIFT_PROBES = 'probeDriftCap' in DESTRUCTOR_CONFIG;

// Tryb sond trafień na czas przebiegu. 'game' = konfiguracja bez zmian (jak gra),
// 'legacy' = A/B sprzed poprawki heksów-duchów (probeDriftCap 0, solver co
// klatkę; wiązka i pociski bez podawania heksa — ctx.legacyProbes), 'wide' =
// moje dawne przybliżenie poprawki, tylko na destruktorze bez probeDriftCap.
// Zwraca funkcję przywracającą; rusza wyłącznie klucze, które już istnieją.
export function applyProbeMode(mode = 'game') {
  const keys = ['probeDriftCap', 'gpuSoftBodyHz', 'collisionSearchRadius'];
  const prev = {};
  for (const k of keys) if (k in DESTRUCTOR_CONFIG) prev[k] = DESTRUCTOR_CONFIG[k];
  if (mode === 'legacy') {
    if ('probeDriftCap' in prev) DESTRUCTOR_CONFIG.probeDriftCap = 0;
    if ('gpuSoftBodyHz' in prev) DESTRUCTOR_CONFIG.gpuSoftBodyHz = 0;
  } else if (mode === 'wide' && !GAME_HAS_DRIFT_PROBES) {
    DESTRUCTOR_CONFIG.collisionSearchRadius = 10;
  }
  return () => { for (const k of Object.keys(prev)) DESTRUCTOR_CONFIG[k] = prev[k]; };
}

// applyImpact z heksem, który trafienie już znalazło (index.html applyHexImpact):
// wspólne opcje bez alokacji, referencja zerowana po wywołaniu.
const _hexImpactOpts = { shard: null };
export function applyHexImpact(entity, x, y, damage, vel, shard) {
  if (!shard) return DestructorSystem.applyImpact(entity, x, y, damage, vel);
  _hexImpactOpts.shard = shard;
  try {
    return DestructorSystem.applyImpact(entity, x, y, damage, vel, _hexImpactOpts);
  } finally {
    _hexImpactOpts.shard = null;
  }
}

export function isShieldUp(entity) {
  return !!entity?.shield && entity.shieldEnabled !== false && (Number(entity.shield.val) || 0) > 0;
}

// ---------------------------------------------------------------------------
// Pula HP (kopia logiki gry, bez efektów ubocznych UI/frakcji)
// ---------------------------------------------------------------------------

/**
 * @returns {{absorbed:number, hull:number, killed:boolean}}
 * hooks.onKilled(entity, cause, overkill) wołane raz, przy przejściu przez zero.
 */
export function applyHullDamage(entity, dmg, cause = 'default', opts = {}, hooks = null) {
  const out = { absorbed: 0, hull: 0, killed: false };
  if (!entity || entity.dead || entity.isWreck || !(dmg > 0)) return out;
  let remaining = dmg;
  if (!opts.bypassShield && isShieldUp(entity)) {
    const absorbed = Math.min(entity.shield.val, remaining);
    entity.shield.val -= absorbed;
    remaining -= absorbed;
    out.absorbed = absorbed;
  }
  if (remaining <= 0) return out;
  out.hull = remaining;
  // Demo: „pula HP wyłączona” — trafienia liczą się w statystykach, ale nie
  // zabijają, żeby dało się oglądać sam mechanizm rdzenia.
  if (entity.__hpImmune) {
    entity.__hullDamageTaken = (entity.__hullDamageTaken || 0) + remaining;
    return out;
  }
  if (entity.isPlayer) {
    const prev = entity.hull.val;
    entity.hull.val = Math.max(0, entity.hull.val - remaining);
    entity.__hullDamageTaken = (entity.__hullDamageTaken || 0) + remaining;
    if (prev > 0 && entity.hull.val <= 0 && !entity.__attritionDown) {
      entity.__attritionDown = true;
      out.killed = true;
      hooks?.onKilled?.(entity, cause, remaining - prev);
    }
  } else {
    entity.hp -= remaining;
    entity.__hullDamageTaken = (entity.__hullDamageTaken || 0) + remaining;
    if (entity.hp <= 0 && !entity.__attritionDown) {
      entity.__attritionDown = true;
      out.killed = true;
      hooks?.onKilled?.(entity, cause, -entity.hp);
    }
  }
  return out;
}

// Sufit z heksów: maxHp × ratio^2,2 (NPC) / ^2,35 (gracz), jak enforceNpcHexIntegrityBalance.
export function enforceHexCap(entity, hooks = null) {
  if (!entity?.hexGrid || entity.dead || entity.isWreck || entity.__attritionDown || entity.__hpImmune) return;
  const state = getHexStructuralState(entity);
  if (!state || state.total <= 0) return;
  if (entity.isPlayer) {
    const cap = Math.max(0, entity.hull.max * Math.pow(Math.max(0, Math.min(1, state.ratio)), 2.35));
    if (entity.hull.val > cap + 0.25) applyHullDamage(entity, entity.hull.val - cap, 'hexcap', { bypassShield: true }, hooks);
    if (state.active <= 0 && entity.hull.val > 0) applyHullDamage(entity, entity.hull.val + 1, 'hexcap', { bypassShield: true }, hooks);
  } else {
    const cap = Math.max(0, Math.max(1, entity.maxHp) * Math.pow(Math.max(0, Math.min(1, state.ratio)), 2.2));
    if (entity.hp > cap + 0.25) applyHullDamage(entity, entity.hp - cap, 'hexcap', { bypassShield: true }, hooks);
    if (state.active <= 0 && entity.hp > 0) applyHullDamage(entity, entity.hp + 1, 'hexcap', { bypassShield: true }, hooks);
  }
}

// ---------------------------------------------------------------------------
// Strzał (fireWeaponCore bez modyfikatorów statku)
// ---------------------------------------------------------------------------

export function weaponDef(weaponId) {
  return MASTER_WEAPONS[weaponId] || null;
}

// Rakiety 3D (rocketSystem3D) latają poza tablicą pocisków i nie ruszają heksów:
// _onHit i _applyBlastDamage wołają tylko applyDamageToNPC/Player.
export function isRocket3D(weapon) {
  return weapon?.category === 'rocket' && !weapon.forceCanvas;
}

export function bulletRadiusFor(weapon) {
  return weapon.bulletRadius || (weapon.category === 'torpedo' ? 10 : (weapon.size === 'L' ? 6 : (weapon.size === 'M' ? 4 : 2)));
}

/**
 * Jeden spust: zwraca tablicę „wystrzałów” do wykonania teraz i z opóźnieniem
 * salwy (lufy 2..n co SALVO_STEP), bez jittera — benchmark jest deterministyczny.
 */
export function planTrigger(weaponId) {
  const weapon = weaponDef(weaponId);
  if (!weapon) return [];
  const barrels = weapon.category === 'beam' ? 1 : barrelsPerShotOf(weapon);
  const out = [];
  for (let b = 0; b < barrels; b++) out.push(b * SALVO_STEP);
  return out;
}

/**
 * Wystrzał z działa demo. gun: { x, y, source } ; aim: punkt celowania.
 * Zwraca opis: pociski dodane do `bullets`, trafienie wiązki, rakiety.
 */
export function fireWeapon(ctx, gun, weaponId, aimX, aimY) {
  const weapon = weaponDef(weaponId);
  if (!weapon) return null;
  const rng = ctx.rng || Math.random;
  const damage = weapon.baseDamage || 10;
  const speed = weapon.baseSpeed || 1000;
  const range = weapon.baseRange || 1000;
  const burstCount = weapon.burstCount || 1;
  const spread = weapon.spread || 0;
  const baseAngle = Math.atan2(aimY - gun.y, aimX - gun.x);
  const result = { weapon, bullets: 0, beam: null, rockets: 0 };
  for (let i = 0; i < burstCount; i++) {
    const angle = baseAngle + (rng() - 0.5) * spread;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    if (weapon.category === 'beam') {
      result.beam = fireBeam(ctx, gun, weapon, dirX, dirY, range, damage);
      continue;
    }
    if (isRocket3D(weapon)) {
      ctx.rockets.push(makeRocket3D(gun, weapon, dirX, dirY, damage, aimX, aimY, ctx.rocketTarget || null));
      result.rockets++;
      continue;
    }
    ctx.bullets.push({
      x: gun.x, y: gun.y, px: gun.x, py: gun.y,
      vx: dirX * speed, vy: dirY * speed,
      life: range / Math.max(speed, 1),
      r: bulletRadiusFor(weapon),
      owner: 'player',
      damage,
      type: weapon.category,
      weaponSize: weapon.size || 'M',
      color: weapon.vfxColor,
      source: gun.source || null,
      penetration: weapon.penetration || 0,
      explodeRadius: weapon.explodeRadius || weapon.explosionRadius || 0,
      target: (weapon.category === 'rocket' || weapon.category === 'torpedo') ? (ctx.homingTarget || null) : null,
      turnRate: weapon.turnRate ? (weapon.turnRate * Math.PI / 180) : 0,
      homingDelay: weapon.homingDelay || 0,
      vfxKey: weapon.id,
      forceCanvas: !!weapon.forceCanvas
    });
    result.bullets++;
  }
  return result;
}

// Raymarch wiązki jak w fireWeaponCore: krok 4,5 j., promień trafienia
// max(90, (r·1,45)²); pierwsza tarcza albo pierwszy heks zatrzymuje.
export function fireBeam(ctx, gun, weapon, dirX, dirY, range, damage) {
  const targets = ctx.targets;
  const hexR = Math.max(2, Number(DESTRUCTOR_CONFIG.gridDivisions) || 10);
  const hexSpacing = hexR * 1.5;
  const hexHeight = Math.sqrt(3) * hexR;
  const hitRadSq = Math.max(90, (hexR * 1.45) * (hexR * 1.45));
  const step = Math.max(4, Math.min(12, hexR * 0.9));
  let hitDist = range;
  let hitEntity = null;
  let hitShardFound = null;
  let hitShield = false;
  const potential = [];
  // Gra po poprawce heksów-duchów: findBeamHexShard (3×3 + zmierzony dryf,
  // najbliższy heks wg pozycji WIZUALNEJ), a ten heks idzie do applyImpact.
  // ctx.legacyProbes = dawne 3×3 bez podawania heksa (A/B sprzed poprawki).
  // Destruktor bez findBeamHexShard: dawne 3×3; ctx.driftAwareProbes = moje
  // wcześniejsze przybliżenie poprawki (okno z zapasem na dryf).
  const useGameSearch = !!gameFindBeamHexShard && !ctx.legacyProbes;
  for (const pt of targets) {
    if (!pt || pt.dead || pt === gun.source) continue;
    const grid = pt.hexGrid;
    let radius = Math.max(20, Number(pt.radius) || 20);
    if (grid?.srcWidth) {
      const s = Math.max(0.0001, pt.visual?.spriteScale || 1);
      const halfW = grid.srcWidth * 0.5 * s;
      const halfH = grid.srcHeight * 0.5 * s;
      radius = Math.max(radius, Math.max(halfW, halfH) + Math.min(halfW, halfH) * 0.45);
    }
    const fx = entityX(pt) - gun.x;
    const fy = entityY(pt) - gun.y;
    const t = fx * dirX + fy * dirY;
    if (t < -radius || t > hitDist + radius) continue;
    const cx = gun.x + dirX * t;
    const cy = gun.y + dirY * t;
    const d2 = (entityX(pt) - cx) ** 2 + (entityY(pt) - cy) ** 2;
    if (d2 > radius * radius) continue;
    const inside = Math.sqrt(radius * radius - d2);
    potential.push({ pt, tEnter: Math.max(0, t - inside), tExit: t + inside });
  }
  potential.sort((a, b) => a.tEnter - b.tEnter);
  for (const hit of potential) {
    if (hit.tEnter > hitDist) break;
    const pt = hit.pt;
    const grid = pt.hexGrid;
    if (!grid?.grid) continue;
    const scale = Math.max(0.0001, pt.visual?.spriteScale || 1);
    const rRot = pt.visual?.spriteRotation || pt.capitalProfile?.spriteRotation || 0;
    const angle = (pt.angle || 0) + rRot;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const ptX = entityX(pt);
    const ptY = entityY(pt);
    const cx = grid.srcWidth * 0.5;
    const cy = grid.srcHeight * 0.5;
    const pX = grid.pivot ? grid.pivot.x : 0;
    const pY = grid.pivot ? grid.pivot.y : 0;
    const cellR = (!useGameSearch && !ctx.legacyProbes && ctx.driftAwareProbes)
      ? 1 + Math.ceil((Number(grid._maxHexDrift) || 0) / hexSpacing)
      : 1;
    let found = false;
    for (let testT = hit.tEnter; testT <= hit.tExit; testT += step) {
      if (testT > hitDist) break;
      const tx = gun.x + dirX * testT;
      const ty = gun.y + dirY * testT;
      const dx = tx - ptX;
      const dy = ty - ptY;
      const lx = (dx * cosA + dy * sinA) / scale;
      const ly = (-dx * sinA + dy * cosA) / scale;
      const gx = lx + cx + pX;
      const gy = ly + cy + pY;
      let hex = null;
      if (useGameSearch) {
        hex = gameFindBeamHexShard(grid, gx, gy, hitRadSq);
      } else {
        const ac = Math.round(gx / hexSpacing);
        const ar = Math.round(gy / hexHeight);
        for (let dr = -cellR; dr <= cellR && !hex; dr++) {
          for (let dc = -cellR; dc <= cellR; dc++) {
            const hc = ac + dc;
            const hr = ar + dr;
            if (hc < 0 || hr < 0 || hc >= grid.cols || hr >= grid.rows) continue;
            const shard = grid.grid[hc + hr * grid.cols];
            if (!shard || !shard.active || shard.isDebris) continue;
            const sx = shard.gridX + (shard.deformation?.x || 0);
            const sy = shard.gridY + (shard.deformation?.y || 0);
            if ((sx - gx) ** 2 + (sy - gy) ** 2 < hitRadSq) { hex = shard; break; }
          }
        }
      }
      if (hex) {
        hitDist = testT;
        hitEntity = pt;
        hitShardFound = useGameSearch ? hex : null;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  const endX = gun.x + dirX * hitDist;
  const endY = gun.y + dirY * hitDist;
  const beam = { startX: gun.x, startY: gun.y, endX, endY, hit: hitEntity, shield: false, width: weapon.size === 'L' ? 12 : 5, mode: weapon.beamMode || 'pulse' };
  if (!hitEntity) return beam;
  if (isShieldUp(hitEntity)) {
    hitShield = true;
    beam.shield = true;
    const absorbed = Math.min(hitEntity.shield.val, damage);
    hitEntity.shield.val -= absorbed;
    ctx.stats && (ctx.stats.shieldHits = (ctx.stats.shieldHits || 0) + 1);
    ctx.hooks?.onShieldHit?.(hitEntity, endX, endY, damage);
    return beam;
  }
  if (!hitShield && hitEntity.hexGrid) {
    const impactSpeed = Number.isFinite(weapon.baseSpeed) ? weapon.baseSpeed : Math.max(800, Number(weapon.baseRange) || 2000);
    applyHexImpact(hitEntity, endX, endY, damage, { x: dirX * impactSpeed, y: dirY * impactSpeed }, hitShardFound);
  }
  applyHullDamage(hitEntity, damage, 'beam', {}, ctx.hooks);
  recordHit(ctx, hitEntity, damage);
  ctx.hooks?.onHullHit?.(hitEntity, endX, endY, weapon, damage);
  return beam;
}

function recordHit(ctx, entity, damage) {
  if (!ctx.stats) return;
  ctx.stats.hullHits = (ctx.stats.hullHits || 0) + 1;
  ctx.stats.hullDamage = (ctx.stats.hullDamage || 0) + damage;
  if (entity === ctx.primary) {
    ctx.stats.primaryHits = (ctx.stats.primaryHits || 0) + 1;
    ctx.stats.primaryDamage = (ctx.stats.primaryDamage || 0) + damage;
  }
}

// ---------------------------------------------------------------------------
// Pociski 2D (bulletsAndCollisionsStep, gałąź kadłubów heksowych i wraków)
// ---------------------------------------------------------------------------

export function stepBullets(ctx, dt) {
  const bullets = ctx.bullets;
  const targets = ctx.targets;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    stepProjectileKinematics(b, dt);
    if ((b.type === 'rocket' || b.type === 'torpedo') && b.homingDelay <= 0 && b.target && !b.target.dead) {
      const tx = entityX(b.target);
      const ty = entityY(b.target);
      const speed = Math.hypot(b.vx, b.vy);
      const current = Math.atan2(b.vy, b.vx);
      let diff = Math.atan2(ty - b.y, tx - b.x) - current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = (b.turnRate || 0) * dt;
      const turn = Math.abs(diff) < maxTurn ? diff : Math.sign(diff) * maxTurn;
      b.vx = Math.cos(current + turn) * speed;
      b.vy = Math.sin(current + turn) * speed;
    }
    if (b.life <= 0) { bullets.splice(i, 1); continue; }

    let hitEntity = null;
    let hitShard = null;
    let hitT = Infinity;
    let hitX = b.x;
    let hitY = b.y;
    const bulletR = Number(b.r) || 0;
    for (let k = 0; k < targets.length; k++) {
      const t = targets[k];
      if (!t || (t.dead && !t.isWreck) || t.isCollidable === false) continue;
      if (b.source && b.source === t) continue;
      if (!t.hexGrid) continue;
      const broad = segmentCircleToi(b.px, b.py, b.x, b.y, entityX(t), entityY(t), (Number(t.radius) || 0) + bulletR);
      if (broad < 0) continue;
      const sweep = DestructorSystem.sweepImpact(t, b.px, b.py, b.x, b.y, bulletR);
      if (!sweep || sweep.t >= hitT) continue;
      hitT = sweep.t;
      hitEntity = t;
      hitShard = sweep.hitShard || null;
      hitX = sweep.worldX;
      hitY = sweep.worldY;
    }
    if (!hitEntity) continue;

    const rawDmg = Number.isFinite(b.damage) ? b.damage : 0;
    const isCiws = b.type === 'ciws';
    const dmg = isCiws ? rawDmg * 0.2 : rawDmg;
    // Tarcza blokuje kadłub całkowicie, dopóki ma HP (gra: shieldActive && hexHit).
    if (!hitEntity.isWreck && isShieldUp(hitEntity)) {
      const absorbed = Math.min(hitEntity.shield.val, dmg);
      hitEntity.shield.val -= absorbed;
      if (ctx.stats) ctx.stats.shieldHits = (ctx.stats.shieldHits || 0) + 1;
      ctx.hooks?.onShieldHit?.(hitEntity, hitX, hitY, dmg);
      bullets.splice(i, 1);
      continue;
    }
    // Gra (index.html ~18987): obrażenia w heks trafiony przez sweep; wariant
    // „sprzed poprawki” (ctx.legacyProbes) szukał go ponownie sondą w punkcie.
    applyHexImpact(hitEntity, hitX, hitY, dmg, { x: b.vx, y: b.vy }, ctx.legacyProbes ? null : hitShard);
    if (!hitEntity.isWreck) {
      applyHullDamage(hitEntity, dmg, b.type, {}, ctx.hooks);
      recordHit(ctx, hitEntity, dmg);
    }
    ctx.hooks?.onHullHit?.(hitEntity, hitX, hitY, weaponDef(b.vfxKey), dmg, b);
    if (shouldRemoveProjectileAfterImpact(b, true)) bullets.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Rakiety 3D: lot kinematyczny do punktu, zapalnik zbliżeniowy od ŚRODKA celu
// (fuse = max(hitRadius, promień celu × 0,9)), obrażenia tylko w pulę HP.
// ---------------------------------------------------------------------------

function makeRocket3D(gun, weapon, dirX, dirY, damage, aimX, aimY, target) {
  const speed = Math.max(400, Number(weapon.baseSpeed) || 1200);
  const blastRadius = Math.max(24, Number(weapon.explodeRadius) || Number(weapon.explosionRadius) || 48);
  return {
    x: gun.x, y: gun.y, vx: dirX * speed, vy: dirY * speed, speed,
    turnRate: Math.max(25, Number(weapon.turnRate) || 180) * Math.PI / 180,
    life: Math.max(3000, Number(weapon.baseRange) || 12000) / speed,
    damage, blastRadius, target, aimX, aimY, age: 0, source: gun.source || null, weapon
  };
}

export function stepRockets3D(ctx, dt) {
  const rockets = ctx.rockets;
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.age += dt;
    r.life -= dt;
    const target = r.target && !r.target.dead ? r.target : null;
    const tx = target ? entityX(target) : r.aimX;
    const ty = target ? entityY(target) : r.aimY;
    const cur = Math.atan2(r.vy, r.vx);
    let diff = Math.atan2(ty - r.y, tx - r.x) - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-r.turnRate * dt, Math.min(r.turnRate * dt, diff));
    r.vx = Math.cos(cur + turn) * r.speed;
    r.vy = Math.sin(cur + turn) * r.speed;
    const x0 = r.x, y0 = r.y;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    let detonate = r.life <= 0;
    let direct = null;
    if (target) {
      const segX = r.x - x0, segY = r.y - y0;
      const lenSq = segX * segX + segY * segY;
      let t = lenSq > 1e-9 ? ((tx - x0) * segX + (ty - y0) * segY) / lenSq : 1;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(tx - (x0 + segX * t), ty - (y0 + segY * t));
      const fuse = Math.max(98, (Number(target.radius) || 0) * 0.9);
      if (r.age >= 0.18 && d <= fuse) { detonate = true; direct = target; r.x = x0 + segX * t; r.y = y0 + segY * t; }
    }
    if (!detonate) continue;
    rockets.splice(i, 1);
    if (direct) {
      if (isShieldUp(direct)) {
        const absorbed = Math.min(direct.shield.val, r.damage);
        direct.shield.val -= absorbed;
      } else {
        applyHullDamage(direct, r.damage, 'rocket', {}, ctx.hooks);
        recordHit(ctx, direct, r.damage);
      }
    }
    for (const e of ctx.targets) {
      if (!e || e.dead || e.isWreck || e === direct) continue;
      const er = Math.max(Number(e.radius) || 0, (Number(e.w) || 0) * 0.5, (Number(e.h) || 0) * 0.5);
      const eff = r.blastRadius + er * 0.65;
      const d = Math.hypot(entityX(e) - r.x, entityY(e) - r.y);
      if (d > eff) continue;
      const falloff = Math.max(0, Math.min(1, 1 - d / Math.max(1, eff)));
      applyHullDamage(e, r.damage * (0.35 + falloff * 0.65), 'rocket', {}, ctx.hooks);
    }
    ctx.hooks?.onRocketBlast?.(r, direct);
  }
}

// ---------------------------------------------------------------------------
// Wybuch rdzenia: AoE HP jak dziś + krater heksów od strony wybuchu (nowe)
// ---------------------------------------------------------------------------

/**
 * @param blast  wynik computeCoreBlast
 * @param source kadłub, który wybuchł (pomijany)
 */
export function applyCoreBlast(ctx, blast, x, y, source, time = 0) {
  const affected = [];
  const depthNext = (blast.chainDepth | 0) + 1;
  // Znacznik łańcucha PRZED falą: rdzeń, który wejdzie w stopienie od tej fali
  // (w najbliższym kroku), dostaje głębokość depthNext.
  for (const e of ctx.targets) {
    if (!e || e === source || e.dead || e.isWreck) continue;
    const d = Math.hypot(entityX(e) - x, entityY(e) - y);
    if (d < blast.aoeRadius + (Number(e.radius) || 0)) markCoreChainExposure(e, depthNext, time, ctx.chainWindowSec ?? CORE_DEFAULTS.chainWindowSec);
  }
  applyBlastCoreShock(blast, x, y, ctx.targets, source);
  for (const e of ctx.targets) {
    if (!e || e === source || e.dead) continue;
    const ex = entityX(e);
    const ey = entityY(e);
    const d = Math.hypot(ex - x, ey - y);
    // krater liczy spadek od punktu KADŁUBA, HP od środka (jak gra)
    if (e.hexGrid && blast.hexDamage > 0) {
      const reach = blast.aoeRadius + (Number(e.radius) || 0);
      if (d < reach && applyBlastHexDamage(e, blast, x, y)) affected.push(e);
    }
    if (e.isWreck) continue;
    const t = coreBlastFalloff(d, blast.aoeRadius);
    if (t <= 0) continue;
    if (e.isPlayer) {
      const total = blast.aoeDamage * t * 0.65;
      const closeness = Math.max(0, 1 - d / (blast.aoeRadius * 0.4));
      const bypass = total * (0.15 + closeness * 0.45);
      applyHullDamage(e, total - bypass, 'aoe_explosion', { bypassShield: false }, ctx.hooks);
      applyHullDamage(e, bypass, 'aoe_explosion', { bypassShield: true }, ctx.hooks);
    } else {
      applyHullDamage(e, blast.aoeDamage * t, 'aoe_explosion', { bypassShield: false }, ctx.hooks);
    }
    if (!affected.includes(e)) affected.push(e);
  }
  return affected;
}
