import {
  HULL_RENDER_PROFILE_ALIASES,
  HULL_RENDER_PROFILES,
  getHullRenderSize,
  resolveHullRenderProfileId
} from './src/data/ships.js';

const MAX_IMPACTS = 16;
const DEFAULT_ENERGY_SHOT_DURATION = 0.5;
const ACTIVATION_SPEED = 1.8;
const BREAK_DURATION = 0.28;
const IMPACT_DECAY = 2.4;
const DEFAULT_SHIELD_DIMENSION = 40;
export const SHIELD_RADIUS_MARGIN = 1.15;
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
  if (!Number.isFinite(shield._impactSeq)) shield._impactSeq = 0;
  const threshold = Math.max(1, shield.max * SHIELD_REACTIVATION_HP_THRESHOLD);
  if (typeof shield.state !== 'string') shield.state = shield.val >= threshold ? 'active' : 'off';
  if (!Number.isFinite(shield.activationProgress)) shield.activationProgress = shield.state === 'off' ? 0 : 1;
  if (!Number.isFinite(shield.currentAlpha)) shield.currentAlpha = shield.activationProgress;
  return shield;
}

function readPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolveKnownHullProfileId(rawHullId) {
  const raw = String(rawHullId || '').trim().toLowerCase();
  if (!raw) return null;
  if (!HULL_RENDER_PROFILES[raw] && !HULL_RENDER_PROFILE_ALIASES[raw]) return null;
  return resolveHullRenderProfileId(raw);
}

function resolveShieldHullProfileId(entity) {
  if (!entity) return null;
  const type = String(entity.type || '').trim().toLowerCase();
  if (entity.fighter || type.includes('fighter') || type.includes('interceptor')) return null;

  const explicit =
    resolveKnownHullProfileId(entity.shipFrame) ||
    resolveKnownHullProfileId(entity.activeHullId) ||
    resolveKnownHullProfileId(entity.shipId);
  if (explicit) return explicit;

  const pirate = !!entity.isPirate;
  if (type === 'battleship') return pirate ? 'pirate_battleship' : 'terran_battleship';
  if (type === 'destroyer') return pirate ? 'pirate_destroyer' : 'terran_destroyer';
  if (type.includes('frigate')) return pirate ? 'pirate_frigate' : 'terran_frigate';
  if (type === 'supercapital') return 'supercapital';
  if (type === 'carrier' || type === 'capital_carrier' || entity.isCapitalShip) return 'capital_carrier';
  return null;
}

function getEntityScaleX(entity) {
  const visual = entity?.visual;
  return (
    readPositiveNumber(visual?.spriteScaleX) ||
    readPositiveNumber(visual?.spriteScale) ||
    1
  );
}

function getEntityScaleY(entity) {
  const visual = entity?.visual;
  return (
    readPositiveNumber(visual?.spriteScaleY) ||
    readPositiveNumber(visual?.spriteScale) ||
    1
  );
}

function getExplicitShieldMaxDimension(entity) {
  const w = readPositiveNumber(entity?.w);
  const h = readPositiveNumber(entity?.h);
  if (w > 0 || h > 0) {
    const radiusDim = readPositiveNumber(entity?.radius) * 2 || DEFAULT_SHIELD_DIMENSION;
    return Math.max(w || radiusDim, h || radiusDim);
  }

  const spriteW = readPositiveNumber(entity?.spriteW) ||
    readPositiveNumber(entity?.renderSpriteImage?.width) ||
    readPositiveNumber(entity?.renderSpriteImage?.naturalWidth);
  const spriteH = readPositiveNumber(entity?.spriteH) ||
    readPositiveNumber(entity?.renderSpriteImage?.height) ||
    readPositiveNumber(entity?.renderSpriteImage?.naturalHeight);
  if (spriteW > 0 || spriteH > 0) {
    return Math.max(
      (spriteW || DEFAULT_SHIELD_DIMENSION) * getEntityScaleX(entity),
      (spriteH || DEFAULT_SHIELD_DIMENSION) * getEntityScaleY(entity)
    );
  }

  return 0;
}

function getHexGridShieldMaxDimension(entity) {
  const grid = entity?.hexGrid;
  const w = readPositiveNumber(grid?.srcWidth);
  const h = readPositiveNumber(grid?.srcHeight);
  if (w <= 0 && h <= 0) return 0;
  return Math.max(
    (w || DEFAULT_SHIELD_DIMENSION) * getEntityScaleX(entity),
    (h || DEFAULT_SHIELD_DIMENSION) * getEntityScaleY(entity)
  );
}

function getHullProfileShieldMaxDimension(entity) {
  const hullProfileId = resolveShieldHullProfileId(entity);
  if (!hullProfileId) return 0;
  const size = getHullRenderSize(hullProfileId);
  return Math.max(
    readPositiveNumber(size?.w),
    readPositiveNumber(size?.h),
    readPositiveNumber(size?.length)
  );
}

function getCapitalProfileShieldMaxDimension(entity) {
  const profile = entity?.capitalProfile;
  if (!profile) return 0;
  const baseR = readPositiveNumber(entity?.radius) || 20;
  const lengthScale = readPositiveNumber(profile.lengthScale) || 3.2;
  const widthScale = readPositiveNumber(profile.widthScale) || 1.2;
  return Math.max(baseR * lengthScale, baseR * widthScale);
}

// ============================================================
// Radialny profil tarczy (obrys kadłuba)
// Statki z hexGrid dostają tarczę-obramówkę dopasowaną do sylwetki:
// r(θ) w binach kątowych w klatce statku (przestrzeń "grid-local" po skali,
// y w dół jak w świecie). Encje bez hexGrid (stacje, budowle, myśliwce,
// przyszłe generatory osłon) zostają na klasycznej kolistej bańce.
// ============================================================
const SHIELD_PROFILE_BINS = 96;
const TWO_PI = Math.PI * 2;

// SpatialGrid trzyma proxy gracza (_realEntity) — profil i kąty liczymy
// zawsze na prawdziwej encji (flagi isPlayer/visual + cache profilu).
function unwrapShieldEntity(entity) {
  return entity?._realEntity || entity;
}

export function entityUsesHullShield(rawEntity) {
  const entity = unwrapShieldEntity(rawEntity);
  if (!entity?.shield || !entity?.hexGrid) return false;
  if (!Array.isArray(entity.hexGrid.shards) || entity.hexGrid.shards.length === 0) return false;
  if (entity.isRingSegment || entity.isAsteroidHex || entity.isWreck) return false;
  if (entity.visual?.preserveBillboardOrientation === true) return false;
  return true;
}

// Kąt wizualny kadłuba — lustrzane odbicie destructorowego getEntityHexAngle
// (visualRotationOffset ma domyślnie 0 i nie jest tu dostępny bez cyklu importów).
export function getShieldHullAngle(rawEntity) {
  const entity = unwrapShieldEntity(rawEntity);
  const base = Number(entity?.angle) || 0;
  if (entity?.isPlayer) return base;
  const r =
    (entity?.visual && typeof entity.visual.spriteRotation === 'number') ? entity.visual.spriteRotation
      : (entity?.capitalProfile && typeof entity.capitalProfile.spriteRotation === 'number') ? entity.capitalProfile.spriteRotation
        : (entity?.profile && typeof entity.profile.spriteRotation === 'number') ? entity.profile.spriteRotation
          : 0;
  return base + (Number.isFinite(r) ? r : 0);
}

function buildShieldProfile(entity) {
  const grid = entity.hexGrid;
  const shards = grid.shards;
  const sx = getEntityScaleX(entity);
  const sy = getEntityScaleY(entity);
  const n = SHIELD_PROFILE_BINS;
  const bins = new Float32Array(n);

  const shardLx = (s) => (Number.isFinite(s.origLx) ? s.origLx : (Number(s.lx) || 0));
  const shardLy = (s) => (Number.isFinite(s.origLy) ? s.origLy : (Number(s.ly) || 0));

  let maxRawR = 0;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const x = shardLx(s) * sx;
    const y = shardLy(s) * sy;
    const r = Math.sqrt(x * x + y * y);
    if (r > maxRawR) maxRawR = r;
  }
  if (maxRawR <= 0) return null;

  // Odstęp pola od pancerza: promień heksa + składnik proporcjonalny do rozmiaru.
  const hexR = (Number(shards[0]?.radius) || 6) * Math.max(sx, sy);
  const pad = hexR * 1.6 + clamp(maxRawR * 0.06, 6, 42);

  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const x = shardLx(s) * sx;
    const y = shardLy(s) * sy;
    const r = Math.sqrt(x * x + y * y);
    const outer = r + pad;
    const theta = Math.atan2(y, x);
    // Kątowe pokrycie sharda: tarcza ma być ciągła, więc shard "maluje"
    // wszystkie biny w swoim stożku kątowym.
    const half = Math.min(Math.PI * 0.5, Math.atan2(hexR * 1.35 + pad * 0.35, Math.max(r, 1)));
    const c0 = Math.floor(((theta - half) / TWO_PI) * n);
    const c1 = Math.ceil(((theta + half) / TWO_PI) * n);
    for (let b = c0; b <= c1; b++) {
      const idx = ((b % n) + n) % n;
      if (outer > bins[idx]) bins[idx] = outer;
    }
  }

  // Puste biny (teoretycznie niemożliwe dla spójnego kadłuba) — wypełnij sąsiadami.
  for (let i = 0; i < n; i++) {
    if (bins[i] > 0) continue;
    const prev = bins[(i - 1 + n) % n];
    const next = bins[(i + 1) % n];
    bins[i] = Math.max(prev, next, pad);
  }

  // Dylatacja (max z sąsiadów) usuwa pojedyncze wcięcia między binami,
  // potem lekkie wygładzenie krzywej.
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    tmp[i] = Math.max(bins[(i - 1 + n) % n], bins[i], bins[(i + 1) % n]);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      bins[i] = tmp[(i - 1 + n) % n] * 0.25 + tmp[i] * 0.5 + tmp[(i + 1) % n] * 0.25;
    }
    tmp.set(bins);
  }

  // maxR/minR skanem po gładkiej krzywej (Catmull-Rom może minimalnie
  // przestrzelić wartości binów) — maxR musi zostać twardą obwiednią.
  const profile = { bins, binCount: n, maxR: 0, minR: Infinity, pad };
  const samples = n * 4;
  for (let i = 0; i < samples; i++) {
    const r = sampleShieldProfileRadius(profile, (i / samples) * TWO_PI);
    if (r > profile.maxR) profile.maxR = r;
    if (r < profile.minR) profile.minR = r;
  }
  return profile;
}

export function getEntityShieldProfile(rawEntity) {
  const entity = unwrapShieldEntity(rawEntity);
  if (!entityUsesHullShield(entity)) return null;
  const grid = entity.hexGrid;
  const sx = getEntityScaleX(entity);
  const sy = getEntityScaleY(entity);
  const cache = entity._shieldProfileCache;
  if (cache && cache.grid === grid && cache.sx === sx && cache.sy === sy) {
    return cache.profile;
  }
  const profile = buildShieldProfile(entity);
  entity._shieldProfileCache = { grid, sx, sy, profile };
  return profile;
}

// Gładka interpolacja Catmull-Rom po binach (domknięta krzywa) — ta sama
// funkcja obsługuje wizual (geometrię tarczy) i gameplay (blokowanie),
// żeby obrys nigdy się nie rozjechał.
export function sampleShieldProfileRadius(profile, gridAngle) {
  if (!profile) return 0;
  const n = profile.binCount;
  const bins = profile.bins;
  let t = gridAngle % TWO_PI;
  if (t < 0) t += TWO_PI;
  const f = (t / TWO_PI) * n;
  const fi = Math.floor(f);
  const u = f - fi;
  const i1 = fi % n;
  const i0 = (i1 - 1 + n) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;
  const p0 = bins[i0], p1 = bins[i1], p2 = bins[i2], p3 = bins[i3];
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  );
}

// Kierunek świata (dx, dy — y w dół) -> kąt w klatce profilu.
export function shieldGridAngleTowards(rawEntity, worldX, worldY) {
  const entity = unwrapShieldEntity(rawEntity);
  const pos = getEntityPos(entity);
  const dx = (Number(worldX) || 0) - pos.x;
  const dy = (Number(worldY) || 0) - pos.y;
  const a = getShieldHullAngle(entity);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.atan2(-dx * s + dy * c, dx * c + dy * s);
}

// Promień tarczy w kierunku punktu świata (bez progresu aktywacji).
export function getEntityShieldRadiusTowards(entity, worldX, worldY) {
  const profile = getEntityShieldProfile(entity);
  if (!profile) return getEntityShieldBaseRadius(entity);
  return sampleShieldProfileRadius(profile, shieldGridAngleTowards(entity, worldX, worldY));
}

// Promień blokujący (z progresem aktywacji) w kierunku punktu świata.
export function getEntityShieldBlockingRadiusTowards(entity, worldX, worldY) {
  const progress = getEntityShieldBlockingProgress(entity);
  if (progress <= 0) return 0;
  return getEntityShieldRadiusTowards(entity, worldX, worldY) * progress;
}

export function getEntityShieldMaxDimension(entity) {
  const fromHexGrid = getHexGridShieldMaxDimension(entity);
  if (fromHexGrid > 0) return fromHexGrid;

  const explicit = getExplicitShieldMaxDimension(entity);
  if (explicit > 0) {
    if (entity?.fighter || entity?.type === 'fighter') return explicit;
    return Math.max(explicit, getCapitalProfileShieldMaxDimension(entity));
  }

  const fromHullProfile = getHullProfileShieldMaxDimension(entity);
  if (fromHullProfile > 0) return fromHullProfile;

  const fromCapitalProfile = getCapitalProfileShieldMaxDimension(entity);
  if (fromCapitalProfile > 0) return fromCapitalProfile;

  const radiusDim = readPositiveNumber(entity?.radius) * 2;
  if (radiusDim > 0) return radiusDim;
  return DEFAULT_SHIELD_DIMENSION;
}

export function getEntityShieldBaseRadius(entity) {
  if (!entity?.shield) return 0;
  // Tarcza-obrys: promień obwiedni = maksimum profilu (dla bramek zgrubnych).
  const profile = getEntityShieldProfile(entity);
  if (profile) return profile.maxR;
  return getEntityShieldMaxDimension(entity) * 0.5 * SHIELD_RADIUS_MARGIN;
}

export function getEntityShieldBlockingRadius(entity) {
  const progress = getEntityShieldBlockingProgress(entity);
  if (progress <= 0) return 0;
  return getEntityShieldBaseRadius(entity) * progress;
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

export function registerShieldImpact(rawEntity, worldX, worldY, damage = 0) {
  const entity = unwrapShieldEntity(rawEntity);
  const shield = ensureShield(entity?.shield);
  if (!shield) return false;

  const pos = getEntityPos(entity);
  const dx = (Number(worldX) || 0) - pos.x;
  const dy = (Number(worldY) || 0) - pos.y;
  const localAngle = Math.atan2(-dy, dx);

  // Kąt w klatce profilu (dla tarczy-obrysu w 3D).
  const hullAngle = getShieldHullAngle(entity);
  const ca = Math.cos(hullAngle);
  const sa = Math.sin(hullAngle);
  const gridAngle = Math.atan2(-dx * sa + dy * ca, dx * ca + dy * sa);

  const dmg = Math.max(0, Number(damage) || 0);
  const intensity = clamp(0.25 + dmg / 260, 0.2, 2.0);
  const deformation = clamp(2.5 + dmg / 120, 1.5, 8.0);

  shield.impacts.unshift({
    id: ++shield._impactSeq,
    localAngle,
    gridAngle,
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
