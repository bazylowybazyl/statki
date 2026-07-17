import { BODY_FLAGS, SIM_TICK_HZ } from './protocol.js';

export const SIMULATION_TIER = Object.freeze({
  CRITICAL: 0,
  NEAR: 1,
  VISIBLE: 2,
  OFFSCREEN: 3,
  SLEEP: 4
});

export const TIER_HZ = Object.freeze([120, 60, 30, 15, 0]);
export const AI_TIER_HZ = Object.freeze([30, 30, 15, 5, 0]);

const DEFAULT_OPTIONS = Object.freeze({
  nearDistance: 6000,
  promotionTimeToContact: 0.5,
  recentContactSeconds: 1,
  demotionDelaySeconds: 1,
  sleepSpeed: 1.5,
  sleepAngularSpeed: 0.01,
  sleepDelaySeconds: 1.5
});

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function dueIntervalForTier(tier) {
  const hz = TIER_HZ[tier] || 0;
  return hz > 0 ? Math.max(1, Math.round(SIM_TICK_HZ / hz)) : 0x7fffffff;
}

export class AdaptiveSimulationScheduler {
  constructor(capacity, options = {}) {
    this.capacity = Math.max(1, Number(capacity) | 0);
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tier = new Uint8Array(this.capacity);
    this.desiredTier = new Uint8Array(this.capacity);
    this.nextDueTick = new Uint32Array(this.capacity);
    this.demoteAfterTick = new Uint32Array(this.capacity);
    this.recentContactUntilTick = new Uint32Array(this.capacity);
    this.stableSinceTick = new Uint32Array(this.capacity);
    this.lastStepTick = new Uint32Array(this.capacity);
    this.tier.fill(SIMULATION_TIER.VISIBLE);
    this.desiredTier.fill(SIMULATION_TIER.VISIBLE);
  }

  reset(index, tick = 0, tier = SIMULATION_TIER.VISIBLE) {
    this.tier[index] = clamp(Number(tier) | 0, SIMULATION_TIER.CRITICAL, SIMULATION_TIER.SLEEP);
    this.desiredTier[index] = this.tier[index];
    this.nextDueTick[index] = Number(tick) >>> 0;
    this.demoteAfterTick[index] = 0;
    this.recentContactUntilTick[index] = 0;
    this.stableSinceTick[index] = Number(tick) >>> 0;
    this.lastStepTick[index] = Number(tick) >>> 0;
  }

  markContact(index, tick) {
    const hold = Math.max(1, Math.round(this.options.recentContactSeconds * SIM_TICK_HZ));
    this.recentContactUntilTick[index] = (Number(tick) + hold) >>> 0;
    this._setTier(index, SIMULATION_TIER.CRITICAL, tick);
  }

  classify(index, metrics, tick, budgetPressure = 0) {
    const flags = Number(metrics?.flags) | 0;
    const distance = Math.max(0, Number(metrics?.distance) || 0);
    const speed = Math.max(0, Number(metrics?.speed) || 0);
    const angularSpeed = Math.abs(Number(metrics?.angularSpeed) || 0);
    const timeToContact = Number(metrics?.timeToContact);
    const isCritical = (flags & (
      BODY_FLAGS.PLAYER |
      BODY_FLAGS.IMPORTANT |
      BODY_FLAGS.IN_CONTACT |
      BODY_FLAGS.LOCKED_TARGET
    )) !== 0 ||
      this.recentContactUntilTick[index] >= tick ||
      (Number.isFinite(timeToContact) && timeToContact >= 0 && timeToContact <= this.options.promotionTimeToContact);

    let desired;
    if (isCritical) {
      desired = SIMULATION_TIER.CRITICAL;
      this.stableSinceTick[index] = tick >>> 0;
    } else if ((flags & BODY_FLAGS.VISIBLE) !== 0 && distance <= this.options.nearDistance) {
      desired = SIMULATION_TIER.NEAR;
      this.stableSinceTick[index] = tick >>> 0;
    } else if ((flags & BODY_FLAGS.VISIBLE) !== 0) {
      desired = SIMULATION_TIER.VISIBLE;
      this.stableSinceTick[index] = tick >>> 0;
    } else if ((flags & BODY_FLAGS.MISSION) !== 0) {
      desired = SIMULATION_TIER.OFFSCREEN;
      this.stableSinceTick[index] = tick >>> 0;
    } else {
      const stable = speed <= this.options.sleepSpeed && angularSpeed <= this.options.sleepAngularSpeed;
      if (!stable) this.stableSinceTick[index] = tick >>> 0;
      const sleepDelay = Math.max(1, Math.round(this.options.sleepDelaySeconds * SIM_TICK_HZ));
      desired = stable && tick - this.stableSinceTick[index] >= sleepDelay
        ? SIMULATION_TIER.SLEEP
        : SIMULATION_TIER.OFFSCREEN;
    }

    if (budgetPressure > 0.85 && desired > SIMULATION_TIER.CRITICAL && desired < SIMULATION_TIER.SLEEP) {
      desired = Math.min(SIMULATION_TIER.OFFSCREEN, desired + 1);
    }
    if (budgetPressure > 1.1 && desired === SIMULATION_TIER.OFFSCREEN && (flags & BODY_FLAGS.MISSION) === 0) {
      desired = SIMULATION_TIER.SLEEP;
    }

    this.desiredTier[index] = desired;
    const current = this.tier[index];
    if (desired < current) {
      this._setTier(index, desired, tick);
    } else if (desired > current) {
      const delay = Math.max(1, Math.round(this.options.demotionDelaySeconds * SIM_TICK_HZ));
      if (this.demoteAfterTick[index] === 0) this.demoteAfterTick[index] = (tick + delay) >>> 0;
      if (tick >= this.demoteAfterTick[index]) this._setTier(index, desired, tick);
    } else {
      this.demoteAfterTick[index] = 0;
    }
    return this.tier[index];
  }

  _setTier(index, tier, tick) {
    this.tier[index] = tier;
    this.demoteAfterTick[index] = 0;
    const interval = dueIntervalForTier(tier);
    const earliest = (Number(tick) + Math.min(interval, 1)) >>> 0;
    if (this.nextDueTick[index] > earliest || tier === SIMULATION_TIER.CRITICAL) {
      this.nextDueTick[index] = Number(tick) >>> 0;
    }
  }

  shouldStep(index, tick) {
    const tier = this.tier[index];
    if (tier === SIMULATION_TIER.SLEEP) return false;
    if (tick < this.nextDueTick[index]) return false;
    const interval = dueIntervalForTier(tier);
    this.nextDueTick[index] = (tick + interval) >>> 0;
    return true;
  }

  consumeStepDt(index, tick, baseDt = 1 / SIM_TICK_HZ) {
    const lastTick = this.lastStepTick[index];
    this.lastStepTick[index] = Number(tick) >>> 0;
    const elapsedTicks = lastTick > 0 ? Math.max(1, tick - lastTick) : 1;
    return elapsedTicks * baseDt;
  }

  getPhysicsHz(index) {
    return TIER_HZ[this.tier[index]] || 0;
  }

  getAiHz(index) {
    return AI_TIER_HZ[this.tier[index]] || 0;
  }
}
