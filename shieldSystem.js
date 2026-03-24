const MAX_IMPACTS = 8;
const DEFAULT_ENERGY_SHOT_DURATION = 0.5;
const ACTIVATION_SPEED = 1.8;
const BREAK_DURATION = 0.28;
const IMPACT_DECAY = 2.4;
export const SHIELD_BLOCKING_ACTIVATION_THRESHOLD = 0.2;
export const SHIELD_REACTIVATION_HP_THRESHOLD = 0.2;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function ensureShield(shield) {
  if (!shield || !Number.isFinite(shield.max) || shield.max <= 0) return null;
  if (!Array.isArray(shield.impacts)) shield.impacts = [];
  if (!Number.isFinite(shield.energyShotDuration) || shield.energyShotDuration <= 0) {
    shield.energyShotDuration = DEFAULT_ENERGY_SHOT_DURATION;
  }
  if (!Number.isFinite(shield.energyShotTimer)) shield.energyShotTimer = 0;
  const threshold = Math.max(1, shield.max * SHIELD_REACTIVATION_HP_THRESHOLD);
  if (typeof shield.state !== 'string') shield.state = shield.val >= threshold ? 'active' : 'off';
  if (!Number.isFinite(shield.activationProgress)) shield.activationProgress = shield.state === 'off' ? 0 : 1;
  if (!Number.isFinite(shield.currentAlpha)) shield.currentAlpha = shield.activationProgress;
  return shield;
}

export function isShieldChargedEnoughToActivate(shield) {
  const st = ensureShield(shield);
  if (!st) return false;
  const threshold = Math.max(1, st.max * SHIELD_REACTIVATION_HP_THRESHOLD);
  return (Number(st.val) || 0) >= threshold;
}

function isGlobalShieldsForcedOff() {
  return !!(typeof window !== 'undefined' && window.DevFlags && window.DevFlags.globalShieldsOff);
}

export function isShieldSuppressed(entity) {
  if (!entity?.shield) return true;
  return isGlobalShieldsForcedOff() || !!entity._shieldForcedOff || !!entity.shield.forceOff;
}

export function getEntityShieldBlockingProgress(entity) {
  if (!entity?.shield || isShieldSuppressed(entity)) return 0;
  return getShieldBlockingProgress(entity.shield);
}

export function isEntityShieldBlocking(entity) {
  return getEntityShieldBlockingProgress(entity) > 0;
}

export function setEntityShieldForcedOff(entity, forced = true) {
  if (!entity?.shield) return false;
  entity._shieldForcedOff = !!forced;
  entity.shield.forceOff = !!forced;
  if (forced) {
    entity.shield.state = 'off';
    entity.shield.activationProgress = 0;
    entity.shield.currentAlpha = 0;
  }
  return true;
}

export function getShieldBlockingProgress(shield) {
  const st = ensureShield(shield);
  if (!st) return 0;
  if ((Number(st.val) || 0) <= 0) return 0;
  if (st.state === 'off' || st.state === 'breaking') return 0;
  const progress = clamp(st.activationProgress ?? (st.state === 'active' ? 1 : 0), 0, 1);
  if (progress < SHIELD_BLOCKING_ACTIVATION_THRESHOLD) return 0;
  return progress;
}

export function isShieldBlocking(shield) {
  return getShieldBlockingProgress(shield) > 0;
}

function getEntityPos(entity) {
  if (!entity) return { x: 0, y: 0 };
  const x = Number.isFinite(entity.x) ? entity.x : Number(entity?.pos?.x) || 0;
  const y = Number.isFinite(entity.y) ? entity.y : Number(entity?.pos?.y) || 0;
  return { x, y };
}

export function initShieldSystem() {
  return true;
}

export function resizeShieldSystem() {
  return true;
}

export function registerShieldImpact(entity, worldX, worldY, damage = 0) {
  const shield = ensureShield(entity?.shield);
  if (!shield) return false;

  const pos = getEntityPos(entity);
  const dx = (Number(worldX) || 0) - pos.x;
  const dy = (Number(worldY) || 0) - pos.y;
  const localAngle = Math.atan2(-dy, dx);

  const dmg = Math.max(0, Number(damage) || 0);
  const intensity = clamp(0.25 + dmg / 260, 0.2, 2.0);
  const deformation = clamp(2.5 + dmg / 120, 1.5, 8.0);

  shield.impacts.unshift({
    localAngle,
    intensity,
    life: 1.0,
    deformation,
    startTime: performance.now() / 1000
  });
  if (shield.impacts.length > MAX_IMPACTS) shield.impacts.length = MAX_IMPACTS;

  shield.currentAlpha = Math.max(Number(shield.currentAlpha) || 0, 0.85);
  if (shield.val > 0 && shield.state === 'off' && isShieldChargedEnoughToActivate(shield)) {
    shield.state = 'activating';
    shield.activationProgress = Math.max(0, Number(shield.activationProgress) || 0);
  }
  return true;
}

export function triggerEnergyShot(entity) {
  const shield = ensureShield(entity?.shield);
  if (!shield) return false;
  const bonus = Math.max(1, (Number(shield.max) || 0) * 0.5);
  shield.val = clamp((Number(shield.val) || 0) + bonus, 0, shield.max);
  const duration = Number(shield.energyShotDuration) || DEFAULT_ENERGY_SHOT_DURATION;
  shield.energyShotDuration = duration;
  shield.energyShotTimer = duration;
  if (!isShieldSuppressed(entity) && shield.val > 0 && shield.state === 'off' && isShieldChargedEnoughToActivate(shield)) {
    shield.state = 'activating';
    shield.activationProgress = 0;
    shield.currentAlpha = 0;
  }
  return true;
}

export function updateShieldFx(entity, dt) {
  const shield = ensureShield(entity?.shield);
  if (!shield) return;
  if (isShieldSuppressed(entity)) {
    shield.state = 'off';
    shield.activationProgress = 0;
    shield.currentAlpha = 0;
    return;
  }

  const step = Math.max(0, Number(dt) || 0);

  if (shield.energyShotTimer > 0) {
    shield.energyShotTimer = Math.max(0, shield.energyShotTimer - step);
  }

  const impacts = shield.impacts;
  if (impacts.length) {
    for (let i = impacts.length - 1; i >= 0; i--) {
      const impact = impacts[i];
      impact.life = Math.max(0, (Number(impact.life) || 0) - step * IMPACT_DECAY);
      if (impact.life <= 0.001) impacts.splice(i, 1);
    }
  }

  if ((Number(shield.val) || 0) <= 0) {
    if (shield.state !== 'off' && shield.state !== 'breaking') {
      shield.state = 'breaking';
      shield.__breakTimer = BREAK_DURATION;
    }
    if (shield.state === 'breaking') {
      shield.__breakTimer = Math.max(0, (Number(shield.__breakTimer) || BREAK_DURATION) - step);
      shield.activationProgress = Math.max(0, (Number(shield.activationProgress) || 0) - step * 3.8);
      shield.currentAlpha = shield.activationProgress;
      if (shield.__breakTimer <= 0) {
        shield.state = 'off';
        shield.activationProgress = 0;
        shield.currentAlpha = 0;
      }
    } else {
      shield.activationProgress = 0;
      shield.currentAlpha = 0;
    }
    return;
  }

  const chargedEnough = isShieldChargedEnoughToActivate(shield);

  if (shield.state === 'off' || shield.state === 'breaking') {
    if (!chargedEnough) {
      shield.state = 'off';
      shield.activationProgress = 0;
      shield.currentAlpha = 0;
      return;
    }
    shield.state = 'activating';
    shield.activationProgress = Math.max(0, Number(shield.activationProgress) || 0);
  }

  if (shield.state === 'activating' && !chargedEnough) {
    shield.state = 'off';
    shield.activationProgress = 0;
    shield.currentAlpha = 0;
    return;
  }

  if (shield.state === 'activating') {
    shield.activationProgress = Math.min(1, shield.activationProgress + step * ACTIVATION_SPEED);
    shield.currentAlpha = shield.activationProgress;
    if (shield.activationProgress >= 0.999) {
      shield.state = 'active';
      shield.activationProgress = 1;
      shield.currentAlpha = 1;
    }
  } else {
    shield.activationProgress = 1;
    shield.currentAlpha = Math.max(0.92, Number(shield.currentAlpha) || 1);
  }
}
