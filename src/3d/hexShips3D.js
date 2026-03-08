import * as THREE from 'three';
import { refreshHexBodyCache, DESTRUCTOR_CONFIG, DestructorSystem } from '../game/destructor.js';
import { Core3D } from './core3d.js';
import { EngineVfxSystem } from './engineVfxSystem.js';
import { Weapon3DSystem } from './weapon3DSystem.js';

const HEX_VERTEX_SHADER = `
attribute vec2 aGridPos;
attribute float aStress;
attribute float aHPRatio;

uniform vec2 uSpriteSize;

varying vec2 vSpriteUV;
varying float vStress;
varying float vHPRatio;

void main() {
  vStress = aStress;
  vHPRatio = aHPRatio;
  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const HEX_FRAGMENT_SHADER = `
uniform sampler2D uSprite;
uniform sampler2D uDamagedTex;
uniform sampler2D uNormalMap;
uniform int uHasNormalMap;
uniform float uArmorThreshold;
uniform float uStressTint;
uniform vec3 uLightDir;
uniform float uRotation;
uniform float uTerminatorStart;
uniform float uTerminatorEnd;
uniform float uNightMin;
uniform float uNightBandStart;
uniform float uNightBandEnd;
uniform vec3 uNightTint;
uniform float uDayAmbient;
uniform float uDayDiffuseMul;
uniform float uSpecularMul;
uniform int uIsDebris;
uniform int uIsOcclusion;

varying vec2 vSpriteUV;
varying float vStress;
varying float vHPRatio;

void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 ||
      vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 armor = texture2D(uSprite, vSpriteUV);
  vec4 damaged = texture2D(uDamagedTex, vSpriteUV);

  vec3 color = damaged.rgb;
  float alpha = damaged.a;

  float armorAlpha = 0.0;
  if (vHPRatio > uArmorThreshold) {
    armorAlpha = (vHPRatio - uArmorThreshold) / max(0.0001, 1.0 - uArmorThreshold);
  }

  if (armorAlpha > 0.01 && armor.a > 0.0) {
    float appliedArmorAlpha = armorAlpha * armor.a;
    color = mix(color, armor.rgb, appliedArmorAlpha);
    alpha = max(alpha, appliedArmorAlpha);
  }

  if (uIsDebris == 1) {
     alpha *= vHPRatio; 
  }

  if (alpha < 0.01) discard;

  // --- MASKA OKLUZJI: Sylwetki zgłaszają się jako BIAŁE (1.0), czyli blokery światła ---
  if (uIsOcclusion == 1) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      return;
  }

  vec3 localNormal;
  if (uHasNormalMap == 1) {
    vec4 nTex = texture2D(uNormalMap, vSpriteUV);
    localNormal = normalize(nTex.rgb * 2.0 - 1.0);
  } else {
    vec2 p = vSpriteUV * 2.0 - 1.0;
    localNormal = normalize(vec3(p.x * 0.45, -p.y * 0.45, 1.0));
  }

  float c = cos(uRotation);
  float s = sin(uRotation);
  vec3 worldNormal = normalize(vec3(
      localNormal.x * c - localNormal.y * s,
      localNormal.x * s + localNormal.y * c,
      localNormal.z
  ));

  float NdotL = dot(worldNormal, uLightDir);
  float dayDiffuse = max(0.0, NdotL);
  float lightMul = uDayAmbient + dayDiffuse * uDayDiffuseMul;
  color *= lightMul;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(uLightDir + viewDir);
  float spec = pow(max(dot(worldNormal, halfVector), 0.0), 32.0);
  float litMask = smoothstep(-0.02, 0.08, NdotL);
  color += vec3(spec * uSpecularMul * litMask);

  float isGlowing = step(0.6, color.b) * step(color.r, 0.5);
  vec3 finalColor = color + (color * isGlowing * 1.5); 

  float stress = clamp(vStress / 20.0, 0.0, 1.0);
  vec3 stressGlow = vec3(1.0, 0.25, 0.05) * stress * uStressTint * 3.5;
  finalColor += stressGlow;

  gl_FragColor = vec4(finalColor, alpha);
}
`;

const state = {
  entityMeshes: new Map(),
  debrisMeshes: new Map(),
  dummy: new THREE.Object3D(),
  maxVisibleEntities: 18,
  midDistanceWorld: 2400,
  farDistanceWorld: 5200,
  lastTime: typeof performance !== 'undefined' ? performance.now() : 0,
  frameId: 0,
  hadRenderableLastFrame: false,
  validEntities: [],
  vfxEntities: [],
  staleEntities: [],
  validEntitySet: new Set(),
  weaponActiveEntities: new Set()
};

const debrisBucketsPool = new Map();

const SHIP_LIGHT_DEFAULTS = Object.freeze({
  terminatorStart: -0.08,
  terminatorEnd: 0.20,
  nightMin: 0.10,
  nightBandStart: -0.25,
  nightBandEnd: 0.02,
  nightTintR: 0.015,
  nightTintG: 0.025,
  nightTintB: 0.045,
  dayAmbient: 0.24,
  dayDiffuseMul: 1.18,
  specularMul: 0.30
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function getShipLightTuning() {
  if (typeof window === 'undefined') return SHIP_LIGHT_DEFAULTS;
  if (!window.__shipLightTune) window.__shipLightTune = { ...SHIP_LIGHT_DEFAULTS };
  return window.__shipLightTune;
}

function ensureShipLightPanelApi() { }

function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function getEntityScale(entity) {
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getInterpolatedRenderPose(entity) {
  if (typeof window === 'undefined') return null;
  if (!window.ship || entity !== window.ship) return null;
  const pose = window.__interpShipPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

function computeShardStress(shard) {
  if (shard && shard.deformation) {
    const sx = shard.deformation.x;
    const sy = shard.deformation.y;
    return Math.sqrt(sx * sx + sy * sy);
  }
  return 0;
}

function setAttrUpdateRange(attr, start, count) {
  if (!attr) return;
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (typeof attr.addUpdateRange === 'function' && Number.isFinite(count) && count > 0) {
      attr.addUpdateRange(start, count);
    }
    return;
  }
  if (!attr.updateRange) attr.updateRange = { offset: 0, count: -1 };
  attr.updateRange.offset = start;
  attr.updateRange.count = count;
}

function createManagedTexture(source) {
  if (!source) return null;
  const isCanvas =
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);
  const texture = isCanvas ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  const width = Number(source?.width ?? source?.naturalWidth ?? 0) || 0;
  const height = Number(source?.height ?? source?.naturalHeight ?? 0) || 0;
  const isPowerOfTwo = width > 0 && height > 0 && THREE.MathUtils.isPowerOfTwo(width) && THREE.MathUtils.isPowerOfTwo(height);
  const isWebGL2 = !!Core3D?.renderer?.capabilities?.isWebGL2;
  const canUseMipmaps = isWebGL2 || isPowerOfTwo;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = canUseMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = canUseMipmaps;
  if (canUseMipmaps && Core3D?.renderer?.capabilities?.getMaxAnisotropy) {
    const maxAnisotropy = Core3D.renderer.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.max(1, Math.min(4, maxAnisotropy || 1));
  } else {
    texture.anisotropy = 1;
  }
  texture.needsUpdate = true;
  return texture;
}

function disposeMeshData(data) {
  if (!data) return;
  if (Core3D.scene && data.mesh) {
    Core3D.scene.remove(data.mesh);
  }
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  data.texture?.dispose?.();
  data.damagedTexture?.dispose?.();
  data.normalTexture?.dispose?.();
}

const DEBRIS_MAX_COUNT = 1500;

function getDebrisMeshForTexture(shard, grid) {
  const textureKey = grid.armorImage;
  if (!textureKey) return null;

  let data = state.debrisMeshes.get(textureKey);

  if (!data) {
    const baseRadius = Math.max(2, Number(shard?.radius) || 20);
    const geometry = new THREE.CircleGeometry(baseRadius * 1.08, 6);

    const texture = createManagedTexture(grid.armorImage || grid.cacheCanvas);
    const damagedTexture = createManagedTexture(grid.damagedImage || grid.armorImage);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSprite: { value: texture },
        uDamagedTex: { value: damagedTexture },
        uNormalMap: { value: null },
        uHasNormalMap: { value: 0 },
        uArmorThreshold: { value: DESTRUCTOR_CONFIG.armorThreshold || 0.4 },
        uStressTint: { value: 0.0 },
        uLightDir: { value: new THREE.Vector3(0, 0, 1) },
        uRotation: { value: 0.0 },
        uSpriteSize: { value: new THREE.Vector2(grid.srcWidth || 1, grid.srcHeight || 1) },
        uTerminatorStart: { value: SHIP_LIGHT_DEFAULTS.terminatorStart },
        uTerminatorEnd: { value: SHIP_LIGHT_DEFAULTS.terminatorEnd },
        uNightMin: { value: SHIP_LIGHT_DEFAULTS.nightMin },
        uNightBandStart: { value: SHIP_LIGHT_DEFAULTS.nightBandStart },
        uNightBandEnd: { value: SHIP_LIGHT_DEFAULTS.nightBandEnd },
        uNightTint: { value: new THREE.Vector3(SHIP_LIGHT_DEFAULTS.nightTintR, SHIP_LIGHT_DEFAULTS.nightTintG, SHIP_LIGHT_DEFAULTS.nightTintB) },
        uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
        uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul },
        uSpecularMul: { value: SHIP_LIGHT_DEFAULTS.specularMul },
        uIsDebris: { value: 1 },
        uIsOcclusion: { value: 0 }
      },
      vertexShader: HEX_VERTEX_SHADER,
      fragmentShader: HEX_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.InstancedMesh(geometry, material, DEBRIS_MAX_COUNT);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.customDepthMaterial = null;

    const initialArray = mesh.instanceMatrix.array;
    for (let i = 0; i < DEBRIS_MAX_COUNT; i++) {
      const offset = i * 16;
      initialArray[offset + 0] = 0.0;
      initialArray[offset + 5] = 0.0;
      initialArray[offset + 10] = 1.0;
      initialArray[offset + 15] = 1.0;
    }

    const gridPosArray = new Float32Array(DEBRIS_MAX_COUNT * 2);
    const stressArray = new Float32Array(DEBRIS_MAX_COUNT);
    const hpArray = new Float32Array(DEBRIS_MAX_COUNT);

    mesh.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(gridPosArray, 2));
    mesh.geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArray, 1));
    mesh.geometry.setAttribute('aHPRatio', new THREE.InstancedBufferAttribute(hpArray, 1));

    mesh.geometry.getAttribute('aGridPos').setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.getAttribute('aHPRatio').setUsage(THREE.DynamicDrawUsage);

    Core3D.scene.add(mesh);

    data = {
      mesh,
      texture,
      damagedTexture,
      gridPosAttr: mesh.geometry.getAttribute('aGridPos'),
      stressAttr: mesh.geometry.getAttribute('aStress'),
      hpAttr: mesh.geometry.getAttribute('aHPRatio'),
      cx: (grid.srcWidth || 0) * 0.5,
      cy: (grid.srcHeight || 0) * 0.5
    };
    state.debrisMeshes.set(textureKey, data);
  }

  return data;
}

function updateDebrisRendering() {
  for (const bucket of debrisBucketsPool.values()) {
    bucket.shards.length = 0;
  }

  const allDebris = DestructorSystem.debris || [];

  for (const shard of allDebris) {
    if (!shard.active || !shard.isDebris) continue;
    const textureKey = shard.img || shard.damagedImg;
    if (!textureKey) continue;

    let bucket = debrisBucketsPool.get(textureKey);
    if (!bucket) {
      bucket = { shards: [], gridRef: null };
      debrisBucketsPool.set(textureKey, bucket);
    }
    bucket.shards.push(shard);

    if (!bucket.gridRef) {
      bucket.gridRef = {
        armorImage: textureKey,
        srcWidth: textureKey.width || 512,
        srcHeight: textureKey.height || 512
      };
    }
  }

  for (const [key, data] of state.debrisMeshes) {
    data.mesh.count = 0;
  }

  for (const [textureKey, bucket] of debrisBucketsPool) {
    if (bucket.shards.length === 0) continue;
    const data = getDebrisMeshForTexture(bucket.shards[0], bucket.gridRef);
    if (!data) continue;

    const mesh = data.mesh;
    const shards = bucket.shards;
    const drawCount = Math.min(shards.length, DEBRIS_MAX_COUNT);

    mesh.count = drawCount;
    const instanceArray = mesh.instanceMatrix.array;

    for (let i = 0; i < drawCount; i++) {
      const shard = shards[i];
      const offset = i * 16;
      data.gridPosAttr.array[i * 2] = shard.gridX;
      data.gridPosAttr.array[i * 2 + 1] = shard.gridY;
      data.hpAttr.array[i] = Math.max(0, shard.alpha);
      data.stressAttr.array[i] = computeShardStress(shard);

      const s = (shard.scale || 1.0);
      const c = Math.cos(-shard.angle);
      const sn = Math.sin(-shard.angle);

      instanceArray[offset + 0] = c * s;
      instanceArray[offset + 4] = -sn * s;
      instanceArray[offset + 1] = sn * s;
      instanceArray[offset + 5] = c * s;
      instanceArray[offset + 12] = shard.worldX;
      instanceArray[offset + 13] = -shard.worldY;
    }

    mesh.instanceMatrix.needsUpdate = true;
    data.gridPosAttr.needsUpdate = true;
    data.hpAttr.needsUpdate = true;
    data.stressAttr.needsUpdate = true;

    const sun = typeof window !== 'undefined' ? window.SUN : null;
    if (sun && drawCount > 0) {
      const dx = sun.x - shards[0].worldX;
      const dy = -(sun.y - shards[0].worldY);
      const lightVec = new THREE.Vector3(dx, dy, 600).normalize();
      mesh.material.uniforms.uLightDir.value.copy(lightVec);
    }
  }
}

const HEX_SHADOW_DEPTH_VERTEX = `
attribute vec2 aGridPos;
uniform vec2 uSpriteSize;
varying vec2 vSpriteUV;
#include <common>
#include <morphtarget_pars_vertex>
void main() {
  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const HEX_SHADOW_DEPTH_FRAGMENT = `
#include <packing>
uniform sampler2D uDamagedTex;
varying vec2 vSpriteUV;
void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 ||
      vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;
  float alpha = texture2D(uDamagedTex, vSpriteUV).a;
  if (alpha < 0.15) discard;
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}
`;

function createHexShadowDepthMaterial(damagedTexture, spriteWidth, spriteHeight) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDamagedTex: { value: damagedTexture },
      uSpriteSize: { value: new THREE.Vector2(spriteWidth || 1, spriteHeight || 1) }
    },
    vertexShader: HEX_SHADOW_DEPTH_VERTEX,
    fragmentShader: HEX_SHADOW_DEPTH_FRAGMENT,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true
  });
  mat.depthPacking = THREE.RGBADepthPacking;
  return mat;
}

function createEntityMesh(entity) {
  if (!entity?.hexGrid || !Array.isArray(entity.hexGrid.shards)) return null;

  refreshHexBodyCache(entity);

  const grid = entity.hexGrid;
  const shards = grid.shards;
  const count = shards.length;
  if (count <= 0) return null;

  const baseRadius = Math.max(2, Number(shards[0]?.radius) || 20);
  const geometry = new THREE.CircleGeometry(baseRadius * 1.08, 6);

  const armorSource = grid.armorImage || grid.cacheCanvas;
  const texture = createManagedTexture(armorSource);

  const damagedSource = grid.damagedImage || armorSource;
  const damagedTexture = createManagedTexture(damagedSource);

  let normalTexture = null;
  if (grid.normalMapImage) {
    normalTexture = createManagedTexture(grid.normalMapImage);
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSprite: { value: texture },
      uDamagedTex: { value: damagedTexture },
      uNormalMap: { value: normalTexture },
      uHasNormalMap: { value: normalTexture ? 1 : 0 },
      uArmorThreshold: { value: Number.isFinite(DESTRUCTOR_CONFIG.armorThreshold) ? DESTRUCTOR_CONFIG.armorThreshold : 0.4 },
      uStressTint: { value: 0.30 },
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uRotation: { value: 0.0 },
      uSpriteSize: { value: new THREE.Vector2(grid.srcWidth || 1, grid.srcHeight || 1) },
      uTerminatorStart: { value: SHIP_LIGHT_DEFAULTS.terminatorStart },
      uTerminatorEnd: { value: SHIP_LIGHT_DEFAULTS.terminatorEnd },
      uNightMin: { value: SHIP_LIGHT_DEFAULTS.nightMin },
      uNightBandStart: { value: SHIP_LIGHT_DEFAULTS.nightBandStart },
      uNightBandEnd: { value: SHIP_LIGHT_DEFAULTS.nightBandEnd },
      uNightTint: { value: new THREE.Vector3(SHIP_LIGHT_DEFAULTS.nightTintR, SHIP_LIGHT_DEFAULTS.nightTintG, SHIP_LIGHT_DEFAULTS.nightTintB) },
      uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
      uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul },
      uSpecularMul: { value: SHIP_LIGHT_DEFAULTS.specularMul },
      uIsDebris: { value: 0 },
      uIsOcclusion: { value: 0 }
    },
    vertexShader: HEX_VERTEX_SHADER,
    fragmentShader: HEX_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const enableShadowCast = !entity?.isRingSegment;
  mesh.renderOrder = entity?.isRingSegment ? 0 : 10;
  mesh.castShadow = enableShadowCast;
  mesh.customDepthMaterial = enableShadowCast
    ? createHexShadowDepthMaterial(damagedTexture, grid.srcWidth || 1, grid.srcHeight || 1)
    : null;

  const initialArray = mesh.instanceMatrix.array;
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    initialArray[offset + 0] = 1.0;
    initialArray[offset + 5] = 1.0;
    initialArray[offset + 10] = 1.0;
    initialArray[offset + 15] = 1.0;
  }

  const gridPosArray = new Float32Array(count * 2);
  const stressArray = new Float32Array(count);
  const hpArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const shard = shards[i];
    if (typeof shard?.gridX === 'number' && typeof shard?.gridY === 'number') {
      gridPosArray[i * 2] = shard.gridX;
      gridPosArray[i * 2 + 1] = shard.gridY;
    } else {
      const cx = (grid.srcWidth || 0) * 0.5;
      const cy = (grid.srcHeight || 0) * 0.5;
      gridPosArray[i * 2] = (shard?.lx || 0) + cx;
      gridPosArray[i * 2 + 1] = (shard?.ly || 0) + cy;
    }
    stressArray[i] = computeShardStress(shard);
    const maxHp = shard?.maxHp || 0;
    const hp = shard?.hp || 0;
    hpArray[i] = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  }

  mesh.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(gridPosArray, 2));
  mesh.geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArray, 1));
  mesh.geometry.setAttribute('aHPRatio', new THREE.InstancedBufferAttribute(hpArray, 1));
  mesh.geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.getAttribute('aHPRatio').setUsage(THREE.DynamicDrawUsage);

  Core3D.scene.add(mesh);

  const data = {
    mesh,
    texture,
    damagedTexture,
    normalTexture,
    damagedRef: grid.damagedImage || null,
    normalMapRef: grid.normalMapImage || null,
    stressAttr: mesh.geometry.getAttribute('aStress'),
    hpAttr: mesh.geometry.getAttribute('aHPRatio'),
    shardsRef: shards,
    shardCount: count,
    srcWidth: grid.srcWidth || 1,
    srcHeight: grid.srcHeight || 1,
    pivotX: Number(grid?.pivot?.x) || 0,
    pivotY: Number(grid?.pivot?.y) || 0,
    needsInstanceRefresh: true
  };
  state.entityMeshes.set(entity, data);
  return data;
}

function updateEntityMesh(entity, data, camX, camY) {
  if (!entity?.hexGrid || !data?.mesh) return;
  const grid = entity.hexGrid;
  const shards = grid.shards;
  const mesh = data.mesh;
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;

  const needsRebuild =
    data.shardCount < shards.length ||
    data.srcWidth !== (grid.srcWidth || 1) ||
    data.srcHeight !== (grid.srcHeight || 1) ||
    data.damagedRef !== (grid.damagedImage || null) ||
    data.normalMapRef !== (grid.normalMapImage || null);

  if (needsRebuild) {
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
    data = createEntityMesh(entity);
    if (!data) return;
  } else if (data.shardsRef !== shards) {
    const gridPosAttr = data.mesh.geometry.getAttribute('aGridPos');
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;

    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      gridPosAttr.array[i * 2] = (typeof shard.gridX === 'number') ? shard.gridX : ((shard.lx || 0) + cx);
      gridPosAttr.array[i * 2 + 1] = (typeof shard.gridY === 'number') ? shard.gridY : ((shard.ly || 0) + cy);
    }
    gridPosAttr.needsUpdate = true;
    data.shardsRef = shards;
    data.needsInstanceRefresh = true;
  }

  if (pivotX !== data.pivotX || pivotY !== data.pivotY) {
    data.pivotX = pivotX;
    data.pivotY = pivotY;
    data.needsInstanceRefresh = true;
  }

  const interpPose = getInterpolatedRenderPose(entity);
  const ex = interpPose ? interpPose.x : getEntityPosX(entity);
  const ey = interpPose ? interpPose.y : getEntityPosY(entity);
  const entityAngle = interpPose ? interpPose.angle : (entity.angle || 0);

  if (!!grid.cacheDirty) {
    refreshHexBodyCache(entity);
    data.texture.needsUpdate = true;
    grid.textureDirty = false;
    grid.cacheDirty = false;
    grid.gpuTextureNeedsUpdate = false;
  } else if (!!grid.textureDirty || !!grid.gpuTextureNeedsUpdate) {
    data.texture.needsUpdate = true;
    grid.textureDirty = false;
    grid.gpuTextureNeedsUpdate = false;
  }

  if (!!grid.meshDirty || data.needsInstanceRefresh) {
    const stressAttr = data.stressAttr;
    const hpAttr = data.hpAttr;

    const instanceArray = mesh.instanceMatrix.array;
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;
    mesh.count = shards.length;

    const hasRange =
      Number.isFinite(grid.meshDirtyStart) &&
      Number.isFinite(grid.meshDirtyEnd) &&
      grid.meshDirtyStart >= 0 &&
      grid.meshDirtyEnd >= grid.meshDirtyStart;

    const fullRefresh = data.needsInstanceRefresh || !!grid.meshDirtyAll || !hasRange;

    let start = 0;
    let end = shards.length - 1;

    if (!fullRefresh) {
      start = Math.max(0, grid.meshDirtyStart | 0);
      end = Math.min(shards.length - 1, grid.meshDirtyEnd | 0);
      if (end < start) {
        start = 0;
        end = shards.length - 1;
      }
    }

    for (let i = start; i <= end; i++) {
      const shard = shards[i];
      const offset = i * 16;

      if (shard && shard.active && !shard.isDebris) {
        const deform = shard.deformation;
        const gx = shard.gridX + (deform ? deform.x : 0);
        const gy = shard.gridY + (deform ? deform.y : 0);

        const localX = gx - cx - data.pivotX;
        const localY = gy - cy - data.pivotY;

        instanceArray[offset + 12] = localX;
        instanceArray[offset + 13] = localY;

        instanceArray[offset + 0] = 1.0;
        instanceArray[offset + 5] = 1.0;

        stressAttr.array[i] = computeShardStress(shard);
        const maxHp = shard.maxHp;
        const hp = shard.hp;
        hpAttr.array[i] = (maxHp > 0) ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
      } else {
        instanceArray[offset + 0] = 0.0;
        instanceArray[offset + 5] = 0.0;
        instanceArray[offset + 12] = 0.0;
        instanceArray[offset + 13] = 0.0;

        stressAttr.array[i] = 0;
        hpAttr.array[i] = 0;
      }
    }

    if (fullRefresh) {
      setAttrUpdateRange(mesh.instanceMatrix, 0, -1);
      setAttrUpdateRange(stressAttr, 0, -1);
      setAttrUpdateRange(hpAttr, 0, -1);
    } else {
      const count = Math.max(0, end - start + 1);
      setAttrUpdateRange(mesh.instanceMatrix, start * 16, count * 16);
      setAttrUpdateRange(stressAttr, start, count);
      setAttrUpdateRange(hpAttr, start, count);
    }

    mesh.instanceMatrix.needsUpdate = true;
    stressAttr.needsUpdate = true;
    hpAttr.needsUpdate = true;
    data.needsInstanceRefresh = false;
    grid.meshDirty = false;
    grid.meshDirtyAll = false;
    grid.meshDirtyStart = -1;
    grid.meshDirtyEnd = -1;
  }

  const tune = getShipLightTuning();
  mesh.material.uniforms.uTerminatorStart.value = clamp(tune.terminatorStart, -1.0, 0.9);
  mesh.material.uniforms.uTerminatorEnd.value = clamp(tune.terminatorEnd, -0.8, 1.0);
  mesh.material.uniforms.uNightMin.value = clamp(tune.nightMin, 0.0, 0.8);
  mesh.material.uniforms.uNightBandStart.value = clamp(tune.nightBandStart, -1.0, 0.8);
  mesh.material.uniforms.uNightBandEnd.value = clamp(tune.nightBandEnd, -0.8, 1.0);
  mesh.material.uniforms.uNightTint.value.set(
    clamp(tune.nightTintR, 0.0, 0.3),
    clamp(tune.nightTintG, 0.0, 0.3),
    clamp(tune.nightTintB, 0.0, 0.3)
  );
  mesh.material.uniforms.uDayAmbient.value = clamp(tune.dayAmbient, 0.0, 1.0);
  mesh.material.uniforms.uDayDiffuseMul.value = clamp(tune.dayDiffuseMul, 0.0, 3.0);
  mesh.material.uniforms.uSpecularMul.value = clamp(tune.specularMul, 0.0, 1.5);

  const sun = typeof window !== 'undefined' ? window.SUN : null;
  if (sun) {
    const dx = sun.x - ex;
    const dy = -(sun.y - ey);
    const lightVec = new THREE.Vector3(dx, dy, 600).normalize();
    mesh.material.uniforms.uLightDir.value.copy(lightVec);
  }

  mesh.material.uniforms.uRotation.value = -entityAngle;

  mesh.position.set(ex, -ey, 0);
  mesh.rotation.set(0, 0, -entityAngle);
  const scale = getEntityScale(entity);
  mesh.scale.set(scale, -scale, 1);
}

export function initHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  ensureShipLightPanelApi();
  return true;
}

export function prewarmHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  Weapon3DSystem.prewarmShaders();
  return true;
}

export function resizeHexShips3D(width, height) {
  if (Core3D.isInitialized) Core3D.resize(width, height);
}

export function updateHexShips3D(viewCamera, entities = []) {
  if (!Core3D.isInitialized) return;

  const now = performance.now();
  state.lastTime = now;
  state.frameId++;

  Core3D.syncCamera(viewCamera);

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;

  const valid = state.validEntities;
  const vfxEntities = state.vfxEntities;
  const stale = state.staleEntities;
  const validSet = state.validEntitySet;
  const weaponActiveEntities = state.weaponActiveEntities;
  valid.length = 0;
  vfxEntities.length = 0;
  stale.length = 0;
  validSet.clear();
  weaponActiveEntities.clear();
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    vfxEntities.push(entity);
    if (!entity.hexGrid) continue;
    valid.push(entity);
    validSet.add(entity);
  }

  let hasRenderable = false;
  for (const entity of valid) {
    let data = state.entityMeshes.get(entity);
    if (!data) data = createEntityMesh(entity);
    if (!data) continue;

    data.mesh.visible = true;
    updateEntityMesh(entity, data, camX, camY);
    hasRenderable = true;
  }

  for (const entity of vfxEntities) {
    const interpPose = getInterpolatedRenderPose(entity);
    const ex = interpPose ? interpPose.x : getEntityPosX(entity);
    const ey = interpPose ? interpPose.y : getEntityPosY(entity);
    const eAngle = interpPose ? interpPose.angle : (entity.angle || 0);
    const scale = getEntityScale(entity);
    Weapon3DSystem.syncWeapons(entity, ex, ey, eAngle, scale);
    weaponActiveEntities.add(entity);
  }
  Weapon3DSystem.cleanupEntities(weaponActiveEntities);
  Weapon3DSystem.syncProjectiles((typeof window !== 'undefined' && Array.isArray(window.bullets)) ? window.bullets : []);

  updateDebrisRendering();

  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  EngineVfxSystem.update(vfxEntities);

  state.hadRenderableLastFrame = hasRenderable || valid.length > 0;
}

export function drawHexShips3D(ctx, width, height) {
  if (!ctx || !Core3D.isInitialized) return;
  Core3D.render();

  const src = Core3D.canvas;
  if (!src) return;

  const w = Math.max(1, Number(width) || ctx.canvas?.width || 1);
  const h = Math.max(1, Number(height) || ctx.canvas?.height || 1);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
}

export function invalidateHexShipEntity3D(entity) {
  if (!entity) return false;
  const data = state.entityMeshes.get(entity);
  if (!data) return false;
  disposeMeshData(data);
  state.entityMeshes.delete(entity);
  return true;
}

export function disposeHexShips3D() {
  for (const [, data] of state.entityMeshes) disposeMeshData(data);
  state.entityMeshes.clear();
  for (const [, data] of state.debrisMeshes) disposeMeshData(data);
  state.debrisMeshes.clear();
  debrisBucketsPool.clear();
  EngineVfxSystem.disposeAll();
  Weapon3DSystem.disposeAll();
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}
