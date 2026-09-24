// Demo mostków — symulacja walki wierna grze (bez DOM, bez three).
//
// Odtwarza ścieżkę strzału i obrażeń z index.html, żeby demo i benchmark
// liczyły DOKŁADNIE to, co gra — bez własnego modelu obrażeń:
//   fireWeaponCore            ~8175  (obrażenia, prędkość, rozrzut, promień pocisku)
//   wiązka (raymarch heksów)  ~8239–8611
//   bulletsAndCollisionsStep  ~18488 (sweepImpact → tarcza → applyImpact + pula)
//   applyDamageToNPC          ~18097 (tarcza, pula HP, śmierć)
//   enforceNpcHexIntegrityBalance ~18179 (sufit HP z heksów, ^2,2 / gracz ^2,35)
//   updateEntityHardpointIntegrity ~4473 (sonda 5 punktów, 2 pudła, 14% puli)
//   tryTriggerCriticalReactorBlow ~18033 (tylko jako informacja: szansa wybuchu)
//   rocketSystem3D._onHit / _applyBlastDamage (rakiety 3D: TYLKO pula, zero heksów)
// Zmieniając te miejsca w grze, zaktualizuj lustro tutaj (docs/PORT-mostki.md).

import { DESTRUCTOR_CONFIG, DestructorSystem, getHexStructuralState } from '../src/game/destructor.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { stepProjectileKinematics } from '../src/game/projectileTrajectory.js';
import { stepDecay120 } from '../src/game/stepDecay.js';
import {
  BRIDGE_EVENT,
  commandLossAge,
  noteBridgeHit,
  prepareWindowWave,
  stepCommandLossDrift,
  updateShipBridges
} from '../src/game/shipBridge.js';

export const PHYS_DT = 1 / 120;

// Stałe gry (index.html) — lustro, nie źródło prawdy.
export const GAME_RULES = Object.freeze({
  npcHexLossExponent: 2.2,
  playerHexLossExponent: 2.35,
  hardpointProbeEverySec: 0.08,
  hardpointProbeRadius: 14,
  lostChecksToDestroy: 2,
  npcHullFracTotal: 0.14,
  playerHullFracTotal: 0.18,
  minHullDamage: 2,
  ciwsHullFactor: 0.2,
  integrityEverySubsteps: 3
});

// Pule kadłubów w grze (src/data/ships.js SUPPORT_SHIP_TEMPLATES; gracz:
// src/game/shipEntity.js hull 12000 i BASE_PLAYER_PROFILE tarcza 18000).
export const HULL_POOLS = Object.freeze({
  battleship: { hp: 12000, shield: 7200, regenRate: 320, regenDelay: 5.2, rules: 'npc' },
  pirate_battleship: { hp: 12000, shield: 7200, regenRate: 320, regenDelay: 5.2, rules: 'npc' },
  atlas: { hp: 12000, shield: 18000, regenRate: 150, regenDelay: 2.5, rules: 'player' }
});

// Mulberry32 — deterministyczny rozrzut (gra używa Math.random).
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segmentCircleToi(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a <= 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// ---------------------------------------------------------------------------
// Bronie
// ---------------------------------------------------------------------------

/** Parametry strzału broni tak, jak liczy je fireWeaponCore (bez modyfikatorów statku). */
export function resolveWeapon(weaponId) {
  const w = MASTER_WEAPONS[weaponId];
  if (!w) return null;
  const category = w.category;
  let kind = 'bullet';
  if (category === 'beam') kind = 'beam';
  else if (category === 'rocket' && !w.forceCanvas) kind = 'rocket3d';
  else if (category === 'flak') kind = 'flak';
  const barrels = Math.max(1, Math.round(Number(w.barrelsPerShot) || 1));
  return {
    id: w.id,
    def: w,
    name: w.name,
    category,
    kind,
    damage: w.baseDamage || 10,
    speed: w.baseSpeed || 1000,
    range: w.baseRange || 1000,
    cooldown: w.cooldown || 1,
    spread: w.spread || 0,
    burst: w.burstCount || 1,
    barrels,
    // Promień pocisku: fireWeaponCore (bulletRadius → torpeda 10 → L 6 → M 4 → reszta 2).
    radius: w.bulletRadius || (category === 'torpedo' ? 10 : (w.size === 'L' ? 6 : (w.size === 'M' ? 4 : 2))),
    size: w.size || 'M',
    vfxColor: w.vfxColor
  };
}

// Zestaw broni dema i benchmarku: min. autocannon, rail, ciężkie działo /
// special, wiązka, rakieta i torpeda (brief).
export const DEMO_WEAPONS = Object.freeze([
  'heavy_autocannon',
  'heavy_autocannon_l',
  'railgun_mk2',
  'tempest_ion_l',
  'armata_mk1',
  'special_valkyrie_railgun',
  'special_yamato_cannon',
  'beam_pulse',
  'beam_continuous',
  'siege_torpedo',
  'missile_rack'
]);

// ---------------------------------------------------------------------------
// Symulacja
// ---------------------------------------------------------------------------

export function createCombatSim({ seed = 1, stepDt = PHYS_DT } = {}) {
  return {
    rng: makeRng(seed),
    time: 0,
    stepDt,
    entities: [],     // lista destruktora: cele + wraki
    targets: [],
    bullets: [],      // obiekty jak window.bullets gry (render: Weapon3DSystem.syncProjectiles)
    rockets: [],      // rakiety 3D (tylko pula HP — jak rocketSystem3D)
    integrityAcc: 0,
    integrityTick: 0,
    hooks: {},        // onFire, onHullHit, onShieldHit, onBeam, onKill, onBridgeLost
    stats: { shots: 0, hullHits: 0, shieldHits: 0, misses: 0, probeMisses: 0, probeRescued: 0 },
    fixHitProbe: true,
    poolHitMul: 1
  };
}

/** Uzbraja encję z hexGrid w pulę HP/tarczę gry i dopina do symulacji. */
export function addCombatTarget(sim, entity, opts = {}) {
  const pool = HULL_POOLS[opts.hullKey] || HULL_POOLS.battleship;
  const shieldOn = opts.shield === true;
  entity.maxHp = pool.hp;
  entity.hp = pool.hp;
  entity.shield = {
    val: shieldOn ? pool.shield : 0,
    max: pool.shield,
    regenRate: pool.regenRate,
    regenDelay: pool.regenDelay,
    regenTimer: 0,
    enabled: shieldOn
  };
  entity.combat = {
    rules: opts.rules || pool.rules,
    hullKey: opts.hullKey,
    dead: false,
    deathCause: null,
    deathAt: -1,
    killShot: -1,
    aliveAtKill: 1,
    critChanceWithoutFix: 0,
    powered: true,
    ceilingDamage: 0,
    hardpointDamage: 0,
    hardpointsLost: 0,
    damageTaken: 0,
    hullHits: 0,
    shieldAbsorbed: 0,
    cmdVx: Number(entity.vx) || 0,
    cmdVy: Number(entity.vy) || 0,
    cmdAngVel: Number(entity.angVel) || 0,
    hpProbeTimer: 0
  };
  for (const hp of entity.editorHardpoints || []) { hp.destroyed = false; hp.__supportMisses = 0; }
  if (!sim.targets.includes(entity)) sim.targets.push(entity);
  if (!sim.entities.includes(entity)) sim.entities.push(entity);
  return entity;
}

export function shieldBlocking(entity) {
  const s = entity?.shield;
  return !!s && s.enabled === true && s.val > 0;
}

/** Szansa losowego wybuchu reaktora, którą gra dałaby przy tej śmierci (tryTriggerCriticalReactorBlow). */
export function reactorBlowChance(aliveRatio, overkillRatio = 0, chainDepth = 0) {
  const severity = Math.max(Math.max(0, overkillRatio), Math.max(0, Math.min(1, aliveRatio)));
  const gate = chainDepth > 0 ? 0.72 : 0.48;
  if (severity < gate) return 0;
  const norm = Math.max(0, Math.min(1, (severity - gate) / Math.max(0.0001, 1 - gate)));
  return Math.min(0.26 + norm * 0.52, 0.78);
}

function killTarget(sim, target, cause, overkill = 0) {
  const c = target.combat;
  if (!c || c.dead) return;
  c.dead = true;
  c.deathCause = cause;
  c.deathAt = sim.time;
  c.killShot = sim.stats.shots;
  const state = getHexStructuralState(target);
  c.aliveAtKill = state ? state.ratio : 0;
  c.critChanceWithoutFix = reactorBlowChance(c.aliveAtKill, overkill / Math.max(1, target.maxHp));
  c.powered = false;
  if (cause === 'bridge') prepareWindowWave(target);
  sim.hooks.onKill?.(target, cause);
}

/** Pula HP: applyDamageToNPC / applyDamageToPlayer. Zwraca obrażenia zadane kadłubowi. */
export function applyPoolDamage(sim, target, dmg, cause = 'default', opts = {}) {
  const c = target?.combat;
  if (!c || c.dead || !(dmg > 0)) return 0;
  let remaining = dmg;
  if (!opts.bypassShield && shieldBlocking(target)) {
    const s = target.shield;
    s.regenTimer = s.regenDelay;
    const absorbed = Math.min(s.val, remaining);
    s.val -= absorbed;
    remaining -= absorbed;
    c.shieldAbsorbed += absorbed;
  }
  if (remaining <= 0) return 0;
  target.hp -= remaining;
  c.damageTaken += remaining;
  if (opts.bucket === 'ceiling') c.ceilingDamage += remaining;
  if (opts.bucket === 'hardpoint') c.hardpointDamage += remaining;
  if (target.hp <= 0) killTarget(sim, target, opts.deathCause || 'pool', -target.hp);
  return remaining;
}

// Sufit HP z heksów (enforceNpcHexIntegrityBalance).
function enforceHexCeiling(sim, target) {
  const c = target.combat;
  if (!c || c.dead || !target.hexGrid) return;
  const state = getHexStructuralState(target);
  if (!state || state.total <= 0) return;
  const exp = c.rules === 'player' ? GAME_RULES.playerHexLossExponent : GAME_RULES.npcHexLossExponent;
  const cap = Math.max(0, target.maxHp * Math.pow(Math.max(0, Math.min(1, state.ratio)), exp));
  if (target.hp > cap + 0.25) applyPoolDamage(sim, target, target.hp - cap, 'default', { bypassShield: true, bucket: 'ceiling', deathCause: 'ceiling' });
  if (!c.dead && state.active <= 0 && target.hp > 0) applyPoolDamage(sim, target, target.hp + 1, 'default', { bypassShield: true, deathCause: 'hexes' });
}

// Sonda hardpointów (isHardpointHexSupported + updateEntityHardpointIntegrity).
function hardpointWorld(entity, hp, out) {
  const kx = Number(entity.__hardpointScaleX) || 1;
  const ky = Number(entity.__hardpointScaleY) || 1;
  const a = Number(entity.angle) || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lx = hp.x * kx;
  const ly = hp.y * ky;
  out.x = entity.x + lx * c - ly * s;
  out.y = entity.y + lx * s + ly * c;
  return out;
}
const _hpw = { x: 0, y: 0 };

function isHardpointSupported(entity, hp) {
  const p = hardpointWorld(entity, hp, _hpw);
  if (DestructorSystem.probeImpact(entity, p.x, p.y)) return true;
  const u = ((Number(entity.__hardpointScaleX) || 1) + (Number(entity.__hardpointScaleY) || 1)) * 0.5;
  const r = GAME_RULES.hardpointProbeRadius * u;
  return DestructorSystem.probeImpact(entity, p.x + r, p.y) || DestructorSystem.probeImpact(entity, p.x - r, p.y) ||
    DestructorSystem.probeImpact(entity, p.x, p.y + r) || DestructorSystem.probeImpact(entity, p.x, p.y - r);
}

function updateHardpointIntegrity(sim, target, dt) {
  const c = target.combat;
  const list = target.editorHardpoints;
  if (!c || c.dead || !Array.isArray(list) || !list.length) return;
  c.hpProbeTimer -= dt;
  if (c.hpProbeTimer > 0) return;
  c.hpProbeTimer = GAME_RULES.hardpointProbeEverySec;
  const frac = c.rules === 'player' ? GAME_RULES.playerHullFracTotal : GAME_RULES.npcHullFracTotal;
  for (const hp of list) {
    if (hp.destroyed) continue;
    if (isHardpointSupported(target, hp)) { hp.__supportMisses = 0; continue; }
    hp.__supportMisses = (hp.__supportMisses | 0) + 1;
    if (hp.__supportMisses < GAME_RULES.lostChecksToDestroy) continue;
    hp.destroyed = true;
    c.hardpointsLost++;
    const dmg = Math.max(GAME_RULES.minHullDamage, (target.maxHp * frac) / list.length);
    applyPoolDamage(sim, target, dmg, 'default', { bypassShield: true, bucket: 'hardpoint', deathCause: 'hardpoints' });
    if (c.dead) return;
  }
}

/** Blok integralności gry (co 3. podkrok z akumulowanym dt): hardpointy, sufit, mostki. */
export function runIntegrity(sim, dt, { immediate = false } = {}) {
  for (const t of sim.targets) {
    const c = t.combat;
    if (!c) continue;
    if (!c.dead) {
      updateHardpointIntegrity(sim, t, dt);
      if (!c.dead) enforceHexCeiling(sim, t);
    }
    const st = t.bridgeState;
    if (!st) continue;
    if (!st.commandLost) {
      if (immediate) st.probeTimer = 0;
      const flags = updateShipBridges(t, immediate ? 1 : dt, sim.time);
      if (flags & BRIDGE_EVENT.BRIDGE_LOST) sim.hooks.onBridgeLost?.(t, flags);
    }
    // Utrata dowodzenia (także wykryta poza kadencją, evaluateShipBridges) =
    // kill. sim.bridgeKills = false (benchmark): mostek nie zabija, mierzymy pulę.
    if (st.commandLost && !c.dead && sim.bridgeKills !== false) killTarget(sim, t, 'bridge');
  }
}

// ---------------------------------------------------------------------------
// Strzał
// ---------------------------------------------------------------------------

function hitEntities(sim) {
  return sim.entities;
}

/**
 * Wystrzał jak fireWeaponCore: rozrzut, salwa (burstCount), pocisk / wiązka /
 * rakieta 3D. `from` = { x, y, vx, vy } lufy, `aim` = punkt celowania (świat).
 */
export function fireWeapon(sim, weaponId, from, aim, opts = {}) {
  const w = typeof weaponId === 'string' ? resolveWeapon(weaponId) : weaponId;
  if (!w || w.kind === 'flak') return 0;
  const baseAngle = Math.atan2(aim.y - from.y, aim.x - from.x);
  let fired = 0;
  const count = w.burst * (opts.barrels ? w.barrels : 1);
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (sim.rng() - 0.5) * w.spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    sim.stats.shots++;
    fired++;
    if (w.kind === 'beam') {
      resolveBeam(sim, w, from.x, from.y, dx, dy, opts.source || null);
    } else if (w.kind === 'rocket3d') {
      sim.rockets.push({
        x: from.x, y: from.y, px: from.x, py: from.y,
        vx: dx * w.speed, vy: dy * w.speed,
        speed: w.speed, damage: w.damage, weapon: w, target: opts.target || null,
        life: w.range / Math.max(1, w.speed), traveled: 0, source: opts.source || null,
        // Obiekt do renderu jak pocisk 'rocket' (Weapon3DSystem) — lot 2D.
        visual: { type: 'rocket', vfxKey: w.id, r: 5, weaponSize: w.size, color: w.vfxColor }
      });
    } else {
      sim.bullets.push({
        x: from.x, y: from.y, px: from.x, py: from.y,
        vx: dx * w.speed + (from.vx || 0) * 0.2,
        vy: dy * w.speed + (from.vy || 0) * 0.2,
        life: w.range / Math.max(w.speed, 1),
        r: w.radius,
        owner: 'player',
        damage: w.damage,
        type: w.category,
        weaponSize: w.size,
        color: w.vfxColor,
        source: opts.source || null,
        penetration: w.def.penetration || 0,
        vfxKey: w.id,
        noHit: opts.noHit === true
      });
    }
    sim.hooks.onFire?.(w, from, dx, dy);
  }
  return fired;
}

// Trafienie w kadłub heksowy: tarcza → applyImpact + pula (bulletsAndCollisionsStep).
//
// POPRAWKA SONDY (sim.fixHitProbe, domyślnie włączona): applyImpact szuka heksa
// SAM, sondą w oknie ±3 komórki wokół punktu i promieniem 2 × hitRadius heksa.
// Detektor trafienia (sweepImpact pocisku, raymarch wiązki) znajduje heks
// inną miarą, więc gra traci trafienia w dwóch sytuacjach:
//   1. wiązka zatrzymuje się √90 ≈ 9,5 px od środka heksa, a heks brzegu ma
//      promień sondy 5,5–7 px — cienki brzeg kadłuba jest dla wiązki niezniszczalny;
//   2. seria w jedno miejsce wgniata heks o kilka komórek (CPU bez WebGPU nie
//      relaksuje wgnieceń dużych kadłubów) — sweep go widzi, sonda już nie.
// W obu przypadkach pula HP spada, a heksy stoją. Poprawka: gdy sonda nie
// trafi, uderzenie idzie w heks, który znalazł detektor (w grze: applyImpact
// z opts.shard — docs/PORT-mostki.md). sim.fixHitProbe = false = gra dziś.
// Emulacja proponowanej poprawki: applyImpact(..., { shard }) — ten sam kod
// co DestructorSystem.applyImpact (destructor.js ~2763), tylko heks trafienia
// podaje detektor (sweep / raymarch), a nie sonda po oknie kratownicy.
function applyImpactOnShard(entity, shard, worldX, worldY, damage, vx, vy) {
  const D = DestructorSystem;
  const a = Number(entity.angle) || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = Math.max(0.0001, Number(entity.visual?.spriteScaleX) || Number(entity.visual?.spriteScale) || 1);
  const sy = Math.max(0.0001, Number(entity.visual?.spriteScaleY) || Number(entity.visual?.spriteScale) || 1);
  const dx = worldX - entity.x;
  const dy = worldY - entity.y;
  const localX = (dx * c + dy * s) / sx;
  const localY = (-dx * s + dy * c) / sy;
  let forceX = (vx * c + vy * s) / sx;
  let forceY = (-vx * s + vy * c) / sy;
  if (Math.hypot(forceX, forceY) < 0.001) {
    const g = entity.hexGrid;
    const fx = (shard.gridX - g.srcWidth * 0.5) - localX;
    const fy = (shard.gridY - g.srcHeight * 0.5) - localY;
    const fm = Math.hypot(fx, fy) || 1;
    forceX = (fx / fm) * Math.max(10, damage * 0.4);
    forceY = (fy / fm) * Math.max(10, damage * 0.4);
  }
  const damageScale = Math.max(0.35, damage / 80);
  D.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
  D.distributeStructuralDamage(entity, localX, localY, forceX * 0.05 * damageScale, forceY * 0.05 * damageScale, 1.0, DESTRUCTOR_CONFIG.bendingRadius);
  if (!shard.active || shard.isDebris) return true;
  shard.hp -= Math.max(1, damage * 0.9);
  if (shard.hp <= 0 && !shard.isDebris) {
    D.destroyShard(entity, shard);
    if (!entity.noSplit && damage >= (DESTRUCTOR_CONFIG.splitDamageThreshold ?? 200)) D.splitQueue.push(entity);
  }
  return true;
}

function applyHullHit(sim, target, hitX, hitY, dmg, vx, vy, type, shard = null) {
  const c = target.combat;
  if (shieldBlocking(target)) {
    const s = target.shield;
    const absorbed = Math.min(s.val, dmg);
    s.val -= absorbed;
    s.regenTimer = s.regenDelay || 3;
    if (c) c.shieldAbsorbed += absorbed;
    sim.stats.shieldHits++;
    sim.hooks.onShieldHit?.(target, hitX, hitY, dmg);
    return 'shield';
  }
  let ok = DestructorSystem.applyImpact(target, hitX, hitY, dmg, { x: vx, y: vy });
  if (!ok) {
    sim.stats.probeMisses++;
    if (sim.fixHitProbe !== false && shard && shard.active && !shard.isDebris) {
      ok = applyImpactOnShard(target, shard, hitX, hitY, dmg, vx, vy);
      sim.stats.probeRescued++;
    }
  }
  noteBridgeHit(target, hitX, hitY, vx, vy, sim.time);
  if (c) {
    c.hullHits++;
    // sim.poolHitMul — eksperyment balansu: ile obrażeń trafienia w kadłub
    // schodzi z puli HP (gra: 1). Przy 1 pula kończy walkę po utracie 1–5%
    // heksów, więc mostek nie ma z czym konkurować (benchmark).
    applyPoolDamage(sim, target, dmg * (sim.poolHitMul ?? 1), type);
  }
  sim.stats.hullHits++;
  sim.hooks.onHullHit?.(target, hitX, hitY, vx, vy, dmg, ok);
  return 'hull';
}

const _sweepHit = { t: 0, x: 0, y: 0, shard: null };

// Pierwszy kadłub na odcinku (broadphase po promieniu + sweepImpact heksów).
function sweepFirstHull(sim, x0, y0, x1, y1, radius, source) {
  let best = null;
  let bestT = Infinity;
  const list = hitEntities(sim);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || !e.hexGrid || e === source || e.isCollidable === false) continue;
    const broad = segmentCircleToi(x0, y0, x1, y1, e.x, e.y, (Number(e.radius) || 0) + radius);
    if (broad < 0) continue;
    const sweep = DestructorSystem.sweepImpact(e, x0, y0, x1, y1, radius);
    if (!sweep || sweep.t >= bestT) continue;
    bestT = sweep.t;
    best = e;
    _sweepHit.t = sweep.t;
    _sweepHit.x = sweep.worldX;
    _sweepHit.y = sweep.worldY;
    _sweepHit.shard = sweep.hitShard;
  }
  return best;
}

/** Krok pocisków (bulletsAndCollisionsStep dla kadłubów heksowych). */
export function stepBullets(sim, dt) {
  const list = sim.bullets;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    stepProjectileKinematics(b, dt);
    if (b.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
    if (b.noHit) continue;
    const target = sweepFirstHull(sim, b.px, b.py, b.x, b.y, Number(b.r) || 0, b.source);
    if (!target) continue;
    const dmg = b.type === 'ciws' ? b.damage * GAME_RULES.ciwsHullFactor : b.damage;
    applyHullHit(sim, target, _sweepHit.x, _sweepHit.y, dmg, b.vx, b.vy, b.type, _sweepHit.shard);
    // Kadłub heksowy zatrzymuje każdy pocisk (shouldRemoveProjectileAfterImpact).
    list[i] = list[list.length - 1];
    list.pop();
  }
}

/** Rakiety 3D: lot + zapalnik; obrażenia TYLKO w pulę (rocketSystem3D._onHit). */
export function stepRockets(sim, dt) {
  const list = sim.rockets;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const t = r.target && !r.target.combat?.dead ? r.target : null;
    if (t) {
      const dx = t.x - r.x;
      const dy = t.y - r.y;
      const d = Math.hypot(dx, dy) || 1;
      r.vx = dx / d * r.speed;
      r.vy = dy / d * r.speed;
    }
    r.px = r.x; r.py = r.y;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.life -= dt;
    r.traveled += r.speed * dt;
    let detonate = r.life <= 0;
    if (t) {
      const fuse = Math.max(98, (Number(t.radius) || 0) * 0.9);
      if (Math.hypot(t.x - r.x, t.y - r.y) <= fuse && r.traveled >= Math.max(90, fuse * 1.1)) {
        applyPoolDamage(sim, t, r.damage * (sim.poolHitMul ?? 1), 'rocket');
        sim.hooks.onRocketHit?.(t, r);
        detonate = true;
      }
    }
    if (detonate) { list[i] = list[list.length - 1]; list.pop(); }
  }
}

// Wiązka: raymarch po heksach jak w fireWeaponCore (krok 4,5 j., okno 3×3
// komórek, promień trafienia √90 px siatki), potem applyImpact z prędkością
// uderzenia max(800, zasięg) i obrażenia w pulę.
function beamTargetRadius(e) {
  const g = e.hexGrid;
  const s = Math.max(0.0001, e.visual?.spriteScale || 1);
  const hw = g.srcWidth * 0.5 * s;
  const hh = g.srcHeight * 0.5 * s;
  return Math.max(20, Number(e.radius) || 20, Math.max(hw, hh) + Math.min(hw, hh) * 0.45);
}

export function resolveBeam(sim, w, sx, sy, dirX, dirY, source) {
  const range = w.range;
  let hitDist = range;
  let hitEntity = null;
  const R = 5;
  const spacing = R * 1.5;
  const hexH = Math.sqrt(3) * R;
  const hitRadSq = Math.max(90, (R * 1.45) * (R * 1.45));
  const step = Math.max(4, Math.min(12, R * 0.9));
  let hitShard = null;
  const cands = [];
  for (const e of hitEntities(sim)) {
    if (!e || !e.hexGrid || e === source || e.isCollidable === false) continue;
    const checkR = shieldBlocking(e) ? beamTargetRadius(e) : beamTargetRadius(e);
    const fx = e.x - sx;
    const fy = e.y - sy;
    const t = fx * dirX + fy * dirY;
    if (t < -checkR || t > hitDist + checkR) continue;
    const cxp = sx + dirX * t;
    const cyp = sy + dirY * t;
    const d2 = (e.x - cxp) ** 2 + (e.y - cyp) ** 2;
    if (d2 > checkR * checkR) continue;
    const inside = Math.sqrt(checkR * checkR - d2);
    cands.push({ e, tEnter: Math.max(0, t - inside), tExit: t + inside });
  }
  cands.sort((a, b) => a.tEnter - b.tEnter);
  for (const cand of cands) {
    if (cand.tEnter > hitDist) break;
    const e = cand.e;
    if (shieldBlocking(e)) { hitDist = cand.tEnter; hitEntity = e; break; }
    const g = e.hexGrid;
    const scale = Math.max(0.0001, e.visual?.spriteScale || 1);
    const a = Number(e.angle) || 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const gcx = g.srcWidth * 0.5;
    const gcy = g.srcHeight * 0.5;
    const pX = g.pivot ? g.pivot.x : 0;
    const pY = g.pivot ? g.pivot.y : 0;
    let found = false;
    for (let tt = cand.tEnter; tt <= cand.tExit; tt += step) {
      if (tt > hitDist) break;
      const tx = sx + dirX * tt;
      const ty = sy + dirY * tt;
      const dx = tx - e.x;
      const dy = ty - e.y;
      const gx = (dx * ca + dy * sa) / scale + gcx + pX;
      const gy = (-dx * sa + dy * ca) / scale + gcy + pY;
      const ac = Math.round(gx / spacing);
      const ar = Math.round(gy / hexH);
      for (let dr = -1; dr <= 1 && !found; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const hc = ac + dc;
          const hr = ar + dr;
          if (hc < 0 || hr < 0 || hc >= g.cols || hr >= g.rows) continue;
          const shard = g.grid[hc + hr * g.cols];
          if (!shard || !shard.active || shard.isDebris) continue;
          const ssx = shard.gridX + (shard.deformation?.x || 0);
          const ssy = shard.gridY + (shard.deformation?.y || 0);
          if ((ssx - gx) ** 2 + (ssy - gy) ** 2 < hitRadSq) { found = true; hitShard = shard; break; }
        }
      }
      if (found) { hitDist = tt; hitEntity = e; break; }
    }
    if (found) break;
  }
  const ex = sx + dirX * hitDist;
  const ey = sy + dirY * hitDist;
  sim.hooks.onBeam?.(w, sx, sy, ex, ey, hitEntity);
  if (!hitEntity) { sim.stats.misses++; return null; }
  const impactSpeed = Math.max(800, Number(w.def.baseRange) || 2000);
  applyHullHit(sim, hitEntity, ex, ey, w.damage, dirX * impactSpeed, dirY * impactSpeed, 'beam', hitShard);
  return hitEntity;
}

/**
 * Natychmiastowy strzał dla benchmarku: pocisk przelatuje cały odcinek w jednym
 * sweepie (cel stoi w miejscu — wynik jak kolejne sweepy kroków fizyki gry).
 */
export function fireInstant(sim, w, from, aim, source = null) {
  const baseAngle = Math.atan2(aim.y - from.y, aim.x - from.x);
  let result = null;
  const count = w.burst;
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (sim.rng() - 0.5) * w.spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    sim.stats.shots++;
    if (w.kind === 'beam') {
      result = resolveBeam(sim, w, from.x, from.y, dx, dy, source) ? 'hull' : 'miss';
      continue;
    }
    if (w.kind === 'rocket3d') {
      const t = sim.targets.find((e) => e.combat && !e.combat.dead) || null;
      if (t) applyPoolDamage(sim, t, w.damage * (sim.poolHitMul ?? 1), 'rocket');
      result = t ? 'pool' : 'miss';
      continue;
    }
    const len = Math.min(w.range, Math.hypot(aim.x - from.x, aim.y - from.y) * 2 + 4000);
    const x1 = from.x + dx * len;
    const y1 = from.y + dy * len;
    const target = sweepFirstHull(sim, from.x, from.y, x1, y1, w.radius, source);
    if (!target) { sim.stats.misses++; result = 'miss'; continue; }
    const dmg = w.category === 'ciws' ? w.damage * GAME_RULES.ciwsHullFactor : w.damage;
    result = applyHullHit(sim, target, _sweepHit.x, _sweepHit.y, dmg, dx * w.speed, dy * w.speed, w.category, _sweepHit.shard);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Krok świata
// ---------------------------------------------------------------------------

function integrateTarget(t, dt, now) {
  const c = t.combat;
  if (c && c.powered && !c.dead) {
    // Napęd trzyma zadany ruch (dryf i obrót ustawiane w demie).
    t.vx = c.cmdVx; t.vy = c.cmdVy; t.angVel = c.cmdAngVel;
  } else if (t.bridgeState?.commandLost) {
    // Hulk: resztkowy ruch, reakcja wyrzutu atmosfery, bardzo słabe tłumienie.
    stepCommandLossDrift(t, dt, now);
  } else if (c && c.dead) {
    // Zniszczony pulą: w grze to już wrak (createWreckage) — tarcie wraku.
    const k = stepDecay120(0.9986, dt);
    t.vx *= k; t.vy *= k; t.angVel *= k;
  }
  t.x += (t.vx || 0) * dt;
  t.y += (t.vy || 0) * dt;
  t.angle += (t.angVel || 0) * dt;
}

function integrateWreck(w, dt) {
  w.x += (w.vx || 0) * dt;
  w.y += (w.vy || 0) * dt;
  w.angle = (w.angle || 0) + (w.angVel || 0) * dt;
  const k = stepDecay120(Number(w.friction) || 0.9986, dt);
  w.vx *= k; w.vy *= k; w.angVel *= k;
  if (w.pos) { w.pos.x = w.x; w.pos.y = w.y; }
}

function regenShields(sim, dt) {
  for (const t of sim.targets) {
    const s = t.shield;
    if (!s || !s.enabled || t.combat?.dead) continue;
    if (s.regenTimer > 0) { s.regenTimer -= dt; continue; }
    if (s.val < s.max) s.val = Math.min(s.max, s.val + s.regenRate * dt);
  }
}

// Wrak bez heksów znika, jak w grze (index.html ~20692: despawn wraku bez
// heksów). Siatka bez żywych heksów wywraca też HullShadowSdf.acquire
// (docs/PORT-mostki.md, „Znalezione po drodze”).
function despawnEmptyWrecks(sim) {
  const list = sim.entities;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e?.isWreck || e.hexGrid?.activeStructuralCount > 0) continue;
    list.splice(i, 1);
    DestructorSystem.recycleWreck?.(e);
  }
}

/** Jeden krok fizyki 120 Hz — kolejność jak physicsStep gry. */
export function stepWorld(sim, dt = sim.stepDt, opts = {}) {
  sim.time += dt;
  for (const e of sim.entities) {
    if (!e || e.dead) continue;
    if (e.isWreck) integrateWreck(e, dt);
    else integrateTarget(e, dt, sim.time);
  }
  DestructorSystem.update(dt, sim.entities);
  if (opts.bullets !== false) {
    stepBullets(sim, dt);
    stepRockets(sim, dt);
  }
  despawnEmptyWrecks(sim);
  regenShields(sim, dt);
  sim.integrityAcc += dt;
  sim.integrityTick++;
  if (sim.integrityTick % GAME_RULES.integrityEverySubsteps === 0) {
    runIntegrity(sim, sim.integrityAcc);
    sim.integrityAcc = 0;
  }
}

/** Praca wizualna destruktora raz na klatkę (updateVisuals). */
export function stepVisuals(sim, frameDt) {
  DestructorSystem.updateVisuals(frameDt, sim.entities);
}

/** Wiek sekwencji utraty dowodzenia celu (s) albo -1. */
export function targetCommandAge(t, now) {
  return commandLossAge(t, now);
}
