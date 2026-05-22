import {
  LIGHT_KINDS,
  normalizeLightsBlock
} from '../ui/shipLightEditorModel.js';

export const MAX_SHADER_SHIP_LIGHTS = 32;
export const MAX_EXTERNAL_ROAD_SHADER_LIGHTS = 8;
const EPSILON = 1e-6;

function round2(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(num) * 100) / 100;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampLightLimit(value, fallback = MAX_SHADER_SHIP_LIGHTS) {
  const num = Number(value);
  const limit = Number.isFinite(num) ? num : fallback;
  return Math.max(0, Math.min(MAX_SHADER_SHIP_LIGHTS, Math.floor(limit)));
}

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function expandHex(value, fallback = '#ffffff') {
  const raw = String(value || fallback || '#ffffff').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return expandHex(fallback, '#ffffff');
}

export function hexToRgb01(value, fallback = '#ffffff') {
  const hex = expandHex(value, fallback);
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255
  };
}

export function getEntityLightScale(entity) {
  const scaleXRaw = Number(entity?.__hardpointScaleX);
  const scaleYRaw = Number(entity?.__hardpointScaleY);
  const uniformRaw = Number(entity?.__hardpointScale);
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : uniform;
  const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : uniform;
  return {
    x: scaleX,
    y: scaleY,
    uniform: (scaleX + scaleY) * 0.5
  };
}

export function getEntityLights(entity) {
  const direct = entity?.editorLights || entity?.visual?.lights || entity?.capitalProfile?.lights || entity?.profile?.lights;
  return normalizeLightsBlock(direct);
}

function lightDirection(deg) {
  const rad = normalizeDeg(deg, 90) * Math.PI / 180;
  const x = Math.sin(rad);
  const y = -Math.cos(rad);
  return {
    x: Math.abs(x) < 1e-12 ? 0 : round2(x),
    y: Math.abs(y) < 1e-12 ? 0 : round2(y)
  };
}

function directionalScale(dir, scale) {
  const sx = Number(scale?.x) || 1;
  const sy = Number(scale?.y) || 1;
  const dx = (Number(dir?.x) || 0) * sx;
  const dy = (Number(dir?.y) || 0) * sy;
  const len = Math.hypot(dx, dy);
  return Number.isFinite(len) && len > 0 ? len : (Number(scale?.uniform) || 1);
}

function getScaledLightLocal(marker, scale) {
  const scaleX = Number(scale?.x) || 1;
  const scaleY = Number(scale?.y) || 1;
  return {
    x: (Number(marker?.x) || 0) * scaleX,
    y: (Number(marker?.y) || 0) * scaleY
  };
}

function normalizeVec2(x, y, fallbackX = 1, fallbackY = 0) {
  const len = Math.hypot(Number(x) || 0, Number(y) || 0);
  if (!Number.isFinite(len) || len <= EPSILON) {
    return { x: fallbackX, y: fallbackY };
  }
  return {
    x: round2(x / len),
    y: round2(y / len)
  };
}

function getEntityPosition(entity, options = {}) {
  const custom = typeof options.getPosition === 'function' ? options.getPosition(entity) : null;
  const x = Number(custom?.x);
  const y = Number(custom?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return {
    x: Number.isFinite(Number(entity?.pos?.x)) ? Number(entity.pos.x) : (Number(entity?.x) || 0),
    y: Number.isFinite(Number(entity?.pos?.y)) ? Number(entity.pos.y) : (Number(entity?.y) || 0)
  };
}

function getEntityAngle(entity, options = {}) {
  if (typeof options.getAngle === 'function') {
    const custom = Number(options.getAngle(entity));
    if (Number.isFinite(custom)) return custom;
  }
  return (Number(entity?.angle) || 0) + (Number(entity?.capitalProfile?.spriteRotation) || 0);
}

function getEntitySpriteScale(entity, options = {}) {
  const customX = typeof options.getSpriteScaleX === 'function' ? Number(options.getSpriteScaleX(entity)) : NaN;
  const customY = typeof options.getSpriteScaleY === 'function' ? Number(options.getSpriteScaleY(entity)) : NaN;
  const uniformRaw = Number(entity?.visual?.spriteScale);
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  const scaleXRaw = Number(entity?.visual?.spriteScaleX);
  const scaleYRaw = Number(entity?.visual?.spriteScaleY);
  const x = Number.isFinite(customX) && customX > 0
    ? customX
    : (Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : uniform);
  const y = Number.isFinite(customY) && customY > 0
    ? customY
    : (Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : uniform);
  return {
    x,
    y,
    uniform: (x + y) * 0.5
  };
}

function getEntityRadiusWorld(entity, grid, spriteScale, options = {}) {
  if (typeof options.getRadius === 'function') {
    const custom = Number(options.getRadius(entity));
    if (Number.isFinite(custom) && custom > 0) return custom;
  }
  const raw = Number(entity?.radius ?? entity?.r);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const width = Math.max(1, Number(grid?.srcWidth) || 1) * (Number(spriteScale?.x) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1) * (Number(spriteScale?.y) || 1);
  return Math.max(16, Math.hypot(width, height) * 0.5);
}

function worldToEntitySpritePixels(worldX, worldY, entity, grid, options = {}) {
  const pos = getEntityPosition(entity, options);
  const angle = getEntityAngle(entity, options);
  const spriteScale = getEntitySpriteScale(entity, options);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = (Number(worldX) || 0) - pos.x;
  const dy = (Number(worldY) || 0) - pos.y;
  const localScaledX = dx * c + dy * s;
  const localScaledY = -dx * s + dy * c;
  const localX = localScaledX / Math.max(EPSILON, spriteScale.x);
  const localY = localScaledY / Math.max(EPSILON, spriteScale.y);
  const width = Math.max(1, Number(grid?.srcWidth) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1);
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  return {
    x: round2(localX + width * 0.5 + pivotX),
    y: round2(localY + height * 0.5 + pivotY)
  };
}

function worldDirToEntitySpriteDir(dir, entity, options = {}) {
  const angle = getEntityAngle(entity, options);
  const spriteScale = getEntitySpriteScale(entity, options);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const worldX = Number(dir?.x) || 0;
  const worldY = Number(dir?.y) || 0;
  const localScaledX = worldX * c + worldY * s;
  const localScaledY = -worldX * s + worldY * c;
  return normalizeVec2(
    localScaledX / Math.max(EPSILON, spriteScale.x),
    localScaledY / Math.max(EPSILON, spriteScale.y),
    1,
    0
  );
}

function packLight(marker, kind, grid, scale) {
  const width = Math.max(1, Number(grid?.srcWidth) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1);
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const scaleUniform = Number(scale?.uniform) || 1;
  const local = getScaledLightLocal(marker, scale);
  const color = hexToRgb01(marker?.color, kind === LIGHT_KINDS.POSITION ? '#ff2b2b' : '#ffffff');
  const dir = kind === LIGHT_KINDS.ROAD ? lightDirection(marker?.deg) : { x: 0, y: -1 };
  const rangeScale = kind === LIGHT_KINDS.ROAD ? directionalScale(dir, scale) : scaleUniform;

  return {
    id: marker?.id || '',
    kind,
    pos: {
      x: round2(local.x + width * 0.5 + pivotX),
      y: round2(local.y + height * 0.5 + pivotY)
    },
    color,
    radiusPx: round2(clamp(marker?.radius, 1, 48, kind === LIGHT_KINDS.POSITION ? 4 : 14) * scaleUniform),
    power: round2(clamp(marker?.power, 0.05, 20, kind === LIGHT_KINDS.POSITION ? 0.8 : 3)),
    dir,
    rangePx: round2(clamp(marker?.range, 50, 4000, 800) * rangeScale),
    coneDeg: round2(clamp(marker?.coneDeg, 8, 160, 40))
  };
}

export function buildShipLightShaderPayload(entity, grid, maxLights = MAX_SHADER_SHIP_LIGHTS) {
  const lights = getEntityLights(entity);
  const scale = getEntityLightScale(entity);
  const out = [];
  const limit = clampLightLimit(maxLights);

  const pushKind = (kind) => {
    const markers = Array.isArray(lights?.[kind]) ? lights[kind] : [];
    for (let i = 0; i < markers.length && out.length < limit; i++) {
      out.push(packLight(markers[i], kind, grid, scale));
    }
  };

  pushKind(LIGHT_KINDS.POSITION);
  pushKind(LIGHT_KINDS.ROAD);

  const signatureParts = [
    Number(grid?.srcWidth) || 1,
    Number(grid?.srcHeight) || 1,
    Number(grid?.pivot?.x) || 0,
    Number(grid?.pivot?.y) || 0,
    scale.x,
    scale.y
  ];
  for (const light of out) {
    signatureParts.push(
      light.id,
      light.kind,
      light.pos.x,
      light.pos.y,
      light.color.r,
      light.color.g,
      light.color.b,
      light.radiusPx,
      light.power,
      light.dir.x,
      light.dir.y,
      light.rangePx,
      light.coneDeg
    );
  }

  return {
    count: out.length,
    lights: out,
    signature: signatureParts.join('|')
  };
}

export function buildRoadLightWorldEmitters(entities, options = {}) {
  const out = Array.isArray(options.out) ? options.out : [];
  if (options.clear !== false) out.length = 0;
  const list = Array.isArray(entities) ? entities : [];
  const maxEmitters = Math.max(0, Math.floor(Number(options.maxEmitters) || 256));

  for (let entityIndex = 0; entityIndex < list.length && out.length < maxEmitters; entityIndex++) {
    const entity = list[entityIndex];
    if (!entity || entity.dead) continue;
    const lights = getEntityLights(entity);
    const roads = Array.isArray(lights?.road) ? lights.road : [];
    if (!roads.length) continue;

    const hardpointScale = getEntityLightScale(entity);
    const spriteScale = getEntitySpriteScale(entity, options);
    const pos = getEntityPosition(entity, options);
    const angle = getEntityAngle(entity, options);
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    for (let i = 0; i < roads.length && out.length < maxEmitters; i++) {
      const marker = roads[i];
      const local = getScaledLightLocal(marker, hardpointScale);
      const dirLocal = lightDirection(marker?.deg);
      const scaledDir = normalizeVec2(
        dirLocal.x * spriteScale.x,
        dirLocal.y * spriteScale.y,
        1,
        0
      );
      const worldDir = normalizeVec2(
        scaledDir.x * c - scaledDir.y * s,
        scaledDir.x * s + scaledDir.y * c,
        1,
        0
      );
      const scaledLocalX = local.x * spriteScale.x;
      const scaledLocalY = local.y * spriteScale.y;
      const spriteDirectionalScale = directionalScale(dirLocal, spriteScale);
      const rangePx = clamp(marker?.range, 50, 4000, 800) * directionalScale(dirLocal, hardpointScale);
      const radiusPx = clamp(marker?.radius, 1, 48, 14) * (Number(hardpointScale?.uniform) || 1);

      out.push({
        owner: entity,
        ownerId: entity?.id || entity?.uid || entity?.name || `entity${entityIndex}`,
        id: marker?.id || `road${i}`,
        x: round2(pos.x + scaledLocalX * c - scaledLocalY * s),
        y: round2(pos.y + scaledLocalX * s + scaledLocalY * c),
        dir: worldDir,
        color: hexToRgb01(marker?.color, '#ffffff'),
        radiusWorld: round2(radiusPx * (Number(spriteScale?.uniform) || 1)),
        power: round2(clamp(marker?.power, 0.05, 20, 3)),
        rangeWorld: round2(rangePx * spriteDirectionalScale),
        coneDeg: round2(clamp(marker?.coneDeg, 8, 160, 40))
      });
    }
  }

  return out;
}

function roadEmitterAffectsTarget(emitter, entity, grid, options = {}) {
  const targetPos = getEntityPosition(entity, options);
  const targetScale = getEntitySpriteScale(entity, options);
  const targetRadius = getEntityRadiusWorld(entity, grid, targetScale, options);
  const dx = targetPos.x - (Number(emitter?.x) || 0);
  const dy = targetPos.y - (Number(emitter?.y) || 0);
  const dirX = Number(emitter?.dir?.x) || 0;
  const dirY = Number(emitter?.dir?.y) || 0;
  const along = dx * dirX + dy * dirY;
  const range = Math.max(1, Number(emitter?.rangeWorld) || 1);
  if (along < -targetRadius || along > range + targetRadius) return false;

  const distSq = dx * dx + dy * dy;
  const perpSq = Math.max(0, distSq - along * along);
  const halfRad = clamp(emitter?.coneDeg, 8, 160, 40) * Math.PI / 360;
  const coneRadius = Math.max(0, along) * Math.tan(halfRad) + targetRadius;
  return perpSq <= coneRadius * coneRadius;
}

function packExternalRoadLightForTarget(emitter, entity, grid, options = {}) {
  const targetScale = getEntitySpriteScale(entity, options);
  const dir = worldDirToEntitySpriteDir(emitter?.dir, entity, options);
  const directionalTargetScale = directionalScale(dir, targetScale);
  return {
    id: `external:${emitter?.ownerId || 'ship'}:${emitter?.id || 'road'}`,
    kind: LIGHT_KINDS.ROAD,
    external: true,
    pos: worldToEntitySpritePixels(emitter?.x, emitter?.y, entity, grid, options),
    color: emitter?.color || hexToRgb01('#ffffff'),
    radiusPx: round2(Math.max(0.5, (Number(emitter?.radiusWorld) || 1) / Math.max(EPSILON, targetScale.uniform))),
    power: round2(clamp(emitter?.power, 0.05, 20, 3)),
    dir,
    rangePx: round2(Math.max(1, (Number(emitter?.rangeWorld) || 1) / Math.max(EPSILON, directionalTargetScale))),
    coneDeg: round2(clamp(emitter?.coneDeg, 8, 160, 40))
  };
}

export function buildCombinedShipLightShaderPayload(entity, grid, externalRoadLights = [], options = {}) {
  const maxLights = clampLightLimit(options?.maxLights);
  const payload = buildShipLightShaderPayload(entity, grid, maxLights);
  const emitters = Array.isArray(externalRoadLights) ? externalRoadLights : [];
  if (!emitters.length || payload.count >= maxLights) return payload;

  const candidates = [];
  for (let i = 0; i < emitters.length; i++) {
    const emitter = emitters[i];
    if (!emitter || emitter.owner === entity) continue;
    if (!roadEmitterAffectsTarget(emitter, entity, grid, options)) continue;

    const targetPos = getEntityPosition(entity, options);
    const dx = targetPos.x - (Number(emitter.x) || 0);
    const dy = targetPos.y - (Number(emitter.y) || 0);
    candidates.push({
      score: dx * dx + dy * dy,
      light: packExternalRoadLightForTarget(emitter, entity, grid, options)
    });
  }

  if (!candidates.length) return payload;
  candidates.sort((a, b) => a.score - b.score);

  const externalLimit = Math.max(0, Math.min(
    MAX_EXTERNAL_ROAD_SHADER_LIGHTS,
    Number(options?.maxExternalRoadLights) || MAX_EXTERNAL_ROAD_SHADER_LIGHTS,
    maxLights - payload.count
  ));
  const signatureParts = [payload.signature, 'external'];
  for (let i = 0; i < candidates.length && i < externalLimit; i++) {
    const light = candidates[i].light;
    payload.lights.push(light);
    signatureParts.push(
      light.id,
      light.pos.x,
      light.pos.y,
      light.dir.x,
      light.dir.y,
      light.rangePx,
      light.radiusPx,
      light.power,
      light.coneDeg
    );
  }

  payload.count = payload.lights.length;
  payload.signature = signatureParts.join('|');
  return payload;
}
