import * as THREE from 'three';
import { refreshHexBodyCache, DESTRUCTOR_CONFIG, DestructorSystem } from '../game/destructor.js';
import { Core3D } from './core3d.js';
import { EngineVfxSystem } from './engineVfxSystem.js';
import { Weapon3DSystem } from './weapon3DSystem.js';
import {
  MAX_SHADER_SHIP_LIGHTS,
  buildCombinedShipLightShaderPayload,
  buildRoadLightWorldEmitters,
  buildShipLightShaderPayload
} from '../game/shipLightRuntime.js';

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
#define MAX_SHIP_LIGHTS ${MAX_SHADER_SHIP_LIGHTS}
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
uniform int uBillboardLighting;
uniform vec2 uSpriteSize;
uniform float uTime;
uniform int uShipLightCount;
uniform vec4 uShipLightData[MAX_SHIP_LIGHTS];
uniform vec4 uShipLightColor[MAX_SHIP_LIGHTS];
uniform vec4 uShipLightExtra[MAX_SHIP_LIGHTS];

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

  // --- MASKA OKLUZJI: Sylwetki zgĹ‚aszajÄ… siÄ™ jako BIAĹE (1.0), czyli blokery Ĺ›wiatĹ‚a ---
  if (uIsOcclusion == 1) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      return;
  }

  if (uBillboardLighting == 1) {
      gl_FragColor = vec4(color, alpha);
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

  vec2 fragPx = vSpriteUV * uSpriteSize;
  for (int i = 0; i < MAX_SHIP_LIGHTS; i++) {
    if (i >= uShipLightCount) break;
    vec4 lightData = uShipLightData[i];
    vec4 lightColor = uShipLightColor[i];
    vec4 lightExtra = uShipLightExtra[i];

    vec2 toFrag = fragPx - lightData.xy;
    float distPx = length(toFrag);
    float radiusPx = max(0.5, lightData.z);
    float power = max(0.0, lightData.w);
    vec3 lampColor = lightColor.rgb;
    float lightType = lightColor.a;

    float localPhase = clamp(lightData.x / max(1.0, uSpriteSize.x), 0.0, 1.0);
    float chase = fract(uTime * 0.42 - localPhase * 0.95);
    float chasePulse = smoothstep(0.0, 0.10, chase) * (1.0 - smoothstep(0.18, 0.42, chase));
    float sequenceMul = mix(0.62, 1.35, chasePulse);
    if (lightType > 0.5) sequenceMul = 1.0;

    float core = smoothstep(radiusPx, 0.0, distPx);
    float glow = smoothstep(radiusPx * 5.0, 0.0, distPx);
    finalColor += lampColor * power * sequenceMul * (core * 1.55 + glow * 0.42);

    if (lightType > 0.5) {
      vec2 dir = normalize(lightExtra.xy);
      float along = dot(toFrag, dir);
      float coneCos = clamp(lightExtra.w, -0.98, 0.999);
      float rangePx = max(radiusPx * 2.0, lightExtra.z);
      float frontMask = step(0.0, along);
      float rangeMask = 1.0 - smoothstep(rangePx * 0.18, rangePx, along);
      float angleCos = dot(normalize(toFrag + dir * 0.001), dir);
      float coneMask = smoothstep(coneCos, min(0.999, coneCos + 0.16), angleCos);
      float nearMask = 1.0 - smoothstep(radiusPx * 0.8, radiusPx * 2.2, distPx);
      float beam = frontMask * rangeMask * coneMask * (1.0 - nearMask);
      finalColor += lampColor * power * beam * 0.16;
    }
  }

  float stress = clamp(vStress / 20.0, 0.0, 1.0);
  vec3 stressGlow = vec3(1.0, 0.25, 0.05) * stress * uStressTint * 3.5;
  finalColor += stressGlow;

  gl_FragColor = vec4(finalColor, alpha);
}
`;

const DEBRIS_VERTEX_SHADER = `
attribute vec2 aGridPos;
attribute vec2 aStartPos;
attribute vec2 aStartVel;
attribute vec3 aRotationData;
attribute vec2 aTimeData;

uniform vec2 uSpriteSize;
uniform float uTime;

varying vec2 vSpriteUV;
varying float vAlpha;

void main() {
  float age = uTime - aTimeData.x;

  if (age < 0.0 || age > 5.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float k = 0.6;
  float distMul = (1.0 - exp(-k * age)) / k;

  vec2 currentPos = aStartPos + aStartVel * distMul;
  float currentAngle = aRotationData.x + aRotationData.y * age;
  float currentScale = aRotationData.z;

  vAlpha = aTimeData.y - (age * 0.2);
  if (vAlpha <= 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;

  float c = cos(currentAngle);
  float s = sin(currentAngle);
  vec2 scaledPos = position.xy * currentScale;
  vec2 rotatedPos = vec2(
    scaledPos.x * c - scaledPos.y * s,
    scaledPos.x * s + scaledPos.y * c
  );

  vec3 worldPosition = vec3(currentPos.x + rotatedPos.x, -(currentPos.y + rotatedPos.y), 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const DEBRIS_FRAGMENT_SHADER = `
uniform sampler2D uDamagedTex;
uniform vec3 uLightDir;
uniform float uDayAmbient;
uniform float uDayDiffuseMul;

varying vec2 vSpriteUV;
varying float vAlpha;

void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 || vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 color = texture2D(uDamagedTex, vSpriteUV);
  if (color.a < 0.01) discard;

  vec2 p = vSpriteUV * 2.0 - 1.0;
  vec3 normal = normalize(vec3(p.x * 0.45, -p.y * 0.45, 1.0));
  float NdotL = max(0.0, dot(normal, uLightDir));
  float lightMul = uDayAmbient + NdotL * uDayDiffuseMul;

  gl_FragColor = vec4(color.rgb * lightMul, color.a * vAlpha);
}
`;

const state = {
  entityMeshes: new Map(),
  dummy: new THREE.Object3D(),
  maxVisibleEntities: 18,
  midDistanceWorld: 2400,
  farDistanceWorld: 5200,
  lastTime: typeof performance !== 'undefined' ? performance.now() : 0,
  frameId: 0,
  hadRenderableLastFrame: false,
  validEntities: [],
  vfxEntities: [],
  visibleHexEntities: [],
  visibleVfxEntities: [],
  roadLightEmitters: [],
  staleEntities: [],
  validEntitySet: new Set(),
  weaponActiveEntities: new Set(),
  damageTintEnabled: true
};

const drawPerfScratch = {
  coreCallMs: 0,
  coreRenderMs: 0,
  composerMs: 0,
  blitMs: 0
};

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

// Tune-epoch: globalne wartości tuningu zmieniają się rzadko (panel debug),
// więc zamiast pisać 9 uniformów per statek per klatkę, sprawdzamy raz
// na klatkę czy się zmieniły i propagujemy do meshy tylko gdy trzeba.
let _tuneEpoch = 0;
const _tuneSnapshot = {
  terminatorStart: NaN,
  terminatorEnd: NaN,
  nightMin: NaN,
  nightBandStart: NaN,
  nightBandEnd: NaN,
  nightTintR: NaN,
  nightTintG: NaN,
  nightTintB: NaN,
  dayAmbient: NaN,
  dayDiffuseMul: NaN,
  specularMul: NaN
};
function refreshTuneEpoch() {
  const t = getShipLightTuning();
  if (
    t.terminatorStart !== _tuneSnapshot.terminatorStart ||
    t.terminatorEnd !== _tuneSnapshot.terminatorEnd ||
    t.nightMin !== _tuneSnapshot.nightMin ||
    t.nightBandStart !== _tuneSnapshot.nightBandStart ||
    t.nightBandEnd !== _tuneSnapshot.nightBandEnd ||
    t.nightTintR !== _tuneSnapshot.nightTintR ||
    t.nightTintG !== _tuneSnapshot.nightTintG ||
    t.nightTintB !== _tuneSnapshot.nightTintB ||
    t.dayAmbient !== _tuneSnapshot.dayAmbient ||
    t.dayDiffuseMul !== _tuneSnapshot.dayDiffuseMul ||
    t.specularMul !== _tuneSnapshot.specularMul
  ) {
    _tuneSnapshot.terminatorStart = t.terminatorStart;
    _tuneSnapshot.terminatorEnd = t.terminatorEnd;
    _tuneSnapshot.nightMin = t.nightMin;
    _tuneSnapshot.nightBandStart = t.nightBandStart;
    _tuneSnapshot.nightBandEnd = t.nightBandEnd;
    _tuneSnapshot.nightTintR = t.nightTintR;
    _tuneSnapshot.nightTintG = t.nightTintG;
    _tuneSnapshot.nightTintB = t.nightTintB;
    _tuneSnapshot.dayAmbient = t.dayAmbient;
    _tuneSnapshot.dayDiffuseMul = t.dayDiffuseMul;
    _tuneSnapshot.specularMul = t.specularMul;
    _tuneEpoch++;
  }
  return t;
}

function ensureShipLightPanelApi() { }

function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function getEntityScaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScale(entity) {
  return Math.max(getEntityScaleX(entity), getEntityScaleY(entity));
}

function usesBillboardLighting(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardLighting === true;
}

function usesBillboardOrientation(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardOrientation === true;
}

function isEntityInCull(entity, cull) {
  if (!cull) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  const r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  return (
    Math.abs(x - cull.x) <= cull.halfW + r &&
    Math.abs(y - cull.y) <= cull.halfH + r
  );
}

function getInterpolatedRenderPose(entity) {
  if (typeof window === 'undefined') return null;
  if (!window.ship || entity !== window.ship) return null;
  const pose = window.__interpShipPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

function getEntityLightPosition(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  return {
    x: interpPose ? interpPose.x : getEntityPosX(entity),
    y: interpPose ? interpPose.y : getEntityPosY(entity)
  };
}

function getEntityLightAngle(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  const baseAngle = interpPose ? interpPose.angle : (Number(entity?.angle) || 0);
  return baseAngle + (Number(entity?.capitalProfile?.spriteRotation) || 0);
}

const SHIP_LIGHT_TRANSFORM_OPTIONS = {
  getPosition: getEntityLightPosition,
  getAngle: getEntityLightAngle,
  getSpriteScaleX: getEntityScaleX,
  getSpriteScaleY: getEntityScaleY
};

const SHIP_LIGHT_EMITTER_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  maxEmitters: 64,
  out: null
};

function computeShardStress(shard) {
  if (shard && shard.deformation) {
    const def = shard.deformation;
    const target = shard.targetDeformation || def;
    const sx = (Number(target.x) || 0) - (Number(def.x) || 0);
    const sy = (Number(target.y) || 0) - (Number(def.y) || 0);
    const absX = sx < 0 ? -sx : sx;
    const absY = sy < 0 ? -sy : sy;
    const defStress = absX > absY ? absX + absY * 0.4 : absY + absX * 0.4;
    const velX = Math.abs(Number(shard.__velX) || 0) + Math.abs(Number(shard.__collVelX) || 0);
    const velY = Math.abs(Number(shard.__velY) || 0) + Math.abs(Number(shard.__collVelY) || 0);
    const velStress = (velX > velY ? velX + velY * 0.4 : velY + velX * 0.4) * 0.18;
    return defStress > velStress ? defStress : velStress;
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

function createManagedTexture(source, isLinearData = false) {
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
  texture.colorSpace = isLinearData ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createLightUniformArray() {
  return Array.from({ length: MAX_SHADER_SHIP_LIGHTS }, () => new THREE.Vector4());
}

function syncEntityLightUniforms(entity, data, grid, externalRoadLights = null) {
  const uniforms = data?.mesh?.material?.uniforms;
  if (!uniforms?.uShipLightCount) return;

  const payload = Array.isArray(externalRoadLights) && externalRoadLights.length
    ? buildCombinedShipLightShaderPayload(entity, grid, externalRoadLights, SHIP_LIGHT_TRANSFORM_OPTIONS)
    : buildShipLightShaderPayload(entity, grid, MAX_SHADER_SHIP_LIGHTS);
  uniforms.uTime.value = state.lastTime * 0.001;
  if (payload.signature === data.lightSignature) return;

  uniforms.uShipLightCount.value = payload.count;
  const dataUniforms = uniforms.uShipLightData.value;
  const colorUniforms = uniforms.uShipLightColor.value;
  const extraUniforms = uniforms.uShipLightExtra.value;

  for (let i = 0; i < MAX_SHADER_SHIP_LIGHTS; i++) {
    const light = payload.lights[i];
    if (!light) {
      dataUniforms[i].set(0, 0, 0, 0);
      colorUniforms[i].set(0, 0, 0, 0);
      extraUniforms[i].set(0, -1, 0, 0);
      continue;
    }
    const coneRad = Math.max(1, Math.min(179, Number(light.coneDeg) || 40)) * Math.PI / 360;
    dataUniforms[i].set(light.pos.x, light.pos.y, light.radiusPx, light.power);
    colorUniforms[i].set(
      light.color.r,
      light.color.g,
      light.color.b,
      light.kind === 'road' ? 1 : 0
    );
    extraUniforms[i].set(
      Number(light.dir?.x) || 0,
      Number(light.dir?.y) || -1,
      Number(light.rangePx) || 0,
      Math.cos(coneRad)
    );
  }

  data.lightSignature = payload.signature;
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

const GPU_DEBRIS_MAX = 10000;

class GpuDebrisPool {
  constructor(gridRef) {
    this.textureKey = gridRef.armorImage;
    this.currentIndex = 0;
    this.geometry = new THREE.CircleGeometry(25, 6);

    this.startPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.startVelArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.rotationArray = new Float32Array(GPU_DEBRIS_MAX * 3);
    this.timeArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.gridPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);

    this.geometry.setAttribute('aStartPos', new THREE.InstancedBufferAttribute(this.startPosArray, 2));
    this.geometry.setAttribute('aStartVel', new THREE.InstancedBufferAttribute(this.startVelArray, 2));
    this.geometry.setAttribute('aRotationData', new THREE.InstancedBufferAttribute(this.rotationArray, 3));
    this.geometry.setAttribute('aTimeData', new THREE.InstancedBufferAttribute(this.timeArray, 2));
    this.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(this.gridPosArray, 2));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uDamagedTex: { value: createManagedTexture(gridRef.damagedImage || gridRef.armorImage) },
        uSpriteSize: { value: new THREE.Vector2(gridRef.srcWidth || 1, gridRef.srcHeight || 1) },
        uTime: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0, 0, 1) },
        uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
        uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul }
      },
      vertexShader: DEBRIS_VERTEX_SHADER,
      fragmentShader: DEBRIS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, GPU_DEBRIS_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    Core3D.scene.add(this.mesh);
  }

  spawn(shard, worldX, worldY, vx, vy, angVel, startAngle, scale, globalTime) {
    const i = this.currentIndex;

    this.startPosArray[i * 2] = worldX;
    this.startPosArray[i * 2 + 1] = worldY;
    this.startVelArray[i * 2] = vx;
    this.startVelArray[i * 2 + 1] = vy;

    this.rotationArray[i * 3] = startAngle;
    this.rotationArray[i * 3 + 1] = angVel;
    this.rotationArray[i * 3 + 2] = scale * ((shard.radius || 20) / 25.0);

    this.timeArray[i * 2] = globalTime;
    this.timeArray[i * 2 + 1] = 1.0;

    this.gridPosArray[i * 2] = shard.gridX || shard.origGridX || 0;
    this.gridPosArray[i * 2 + 1] = shard.gridY || shard.origGridY || 0;

    const updateAttr = (name, stride) => {
      const attr = this.geometry.getAttribute(name);
      setAttrUpdateRange(attr, i * stride, stride);
      attr.needsUpdate = true;
    };

    updateAttr('aStartPos', 2);
    updateAttr('aStartVel', 2);
    updateAttr('aRotationData', 3);
    updateAttr('aTimeData', 2);
    updateAttr('aGridPos', 2);

    this.currentIndex = (this.currentIndex + 1) % GPU_DEBRIS_MAX;
    if (this.mesh.count < GPU_DEBRIS_MAX) this.mesh.count++;
  }

  dispose() {
    if (Core3D.scene && this.mesh) Core3D.scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.uniforms?.uDamagedTex?.value?.dispose?.();
    this.material?.dispose?.();
  }
}

const GpuDebrisManager = {
  pools: new Map(),
  globalTime: 0,

  spawn(shard, gridRef, wx, wy, vx, vy, drot, angle, scale) {
    const texKey = shard.img || shard.damagedImg;
    if (!texKey) return;

    let pool = this.pools.get(texKey);
    if (!pool) {
      pool = new GpuDebrisPool({
        armorImage: texKey,
        damagedImage: shard.damagedImg,
        srcWidth: texKey.width || gridRef.srcWidth,
        srcHeight: texKey.height || gridRef.srcHeight
      });
      this.pools.set(texKey, pool);
    }
    pool.spawn(shard, wx, wy, vx, vy, drot, angle, scale, this.globalTime);
  },

  updateTime(time) {
    this.globalTime = time;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    const camera = typeof window !== 'undefined' ? window.camera : null;
    for (const pool of this.pools.values()) {
      pool.material.uniforms.uTime.value = time;
      if (sun && camera && pool.mesh.count > 0) {
        const dx = sun.x - camera.x;
        const dy = -(sun.y - camera.y);
        // In-place: bez alokacji Vector3 per pool per klatkę
        pool.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
      }
    }
  },

  dispose() {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.globalTime = 0;
  }
};

if (typeof window !== 'undefined') {
  window.spawnGpuDebris = (shard, grid, wx, wy, vx, vy, drot, ang, scale) => {
    GpuDebrisManager.spawn(shard, grid, wx, wy, vx, vy, drot, ang, scale);
  };
}

function updateDebrisRendering() { }

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
  const geometry = new THREE.CircleGeometry(baseRadius * 1.04, 6);

  const armorSource = grid.armorImage || grid.cacheCanvas;
  const texture = createManagedTexture(armorSource);

  const damagedSource = grid.damagedImage || armorSource;
  const damagedTexture = createManagedTexture(damagedSource);

  let normalTexture = null;
  if (grid.normalMapImage) {
    normalTexture = createManagedTexture(grid.normalMapImage, true);
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
      uIsOcclusion: { value: 0 },
      uBillboardLighting: { value: usesBillboardLighting(entity) ? 1 : 0 },
      uTime: { value: 0 },
      uShipLightCount: { value: 0 },
      uShipLightData: { value: createLightUniformArray() },
      uShipLightColor: { value: createLightUniformArray() },
      uShipLightExtra: { value: createLightUniformArray() }
    },
    vertexShader: HEX_VERTEX_SHADER,
    fragmentShader: HEX_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const enableShadowCast = !entity?.isRingSegment;
  mesh.renderOrder = entity?.isRingSegment ? 0 : 10;
  mesh.castShadow = false;           // <-- CAŁKOWICIE WYŁĄCZONE RZUCANIE CIENIA
  mesh.customDepthMaterial = null;   // <-- CAŁKOWICIE WYŁĄCZONY MATERIAŁ DLA CIENI

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

  // Tuning uniformy: aplikuj tylko gdy epoka tuningu się zmieniła dla tego mesha.
  // _tuneEpoch jest odświeżany raz na klatkę w updateHexShips3D (refreshTuneEpoch()).
  if (data._tuneEpoch !== _tuneEpoch) {
    const tune = _tuneSnapshot;
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
    data._tuneEpoch = _tuneEpoch;
  }

  const sun = typeof window !== 'undefined' ? window.SUN : null;
  if (sun) {
    const dx = sun.x - ex;
    const dy = -(sun.y - ey);
    // In-place: bez alokacji Vector3 per klatkę per statek
    mesh.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
  }

  mesh.material.uniforms.uStressTint.value = state.damageTintEnabled ? 0.30 : 0.0;
  if (mesh.material.uniforms.uBillboardLighting) {
    mesh.material.uniforms.uBillboardLighting.value = usesBillboardLighting(entity) ? 1 : 0;
  }
  syncEntityLightUniforms(entity, data, grid, state.roadLightEmitters);
  const renderRotation = usesBillboardOrientation(entity) ? entityAngle : -entityAngle;
  mesh.material.uniforms.uRotation.value = renderRotation;

  mesh.position.set(ex, -ey, 0);
  mesh.rotation.set(0, 0, renderRotation);
  const scaleX = getEntityScaleX(entity);
  const scaleY = getEntityScaleY(entity);
  mesh.scale.set(scaleX, -scaleY, 1);
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

export function setHexDamageTintEnabled(enabled) {
  state.damageTintEnabled = enabled !== false;
  for (const [, data] of state.entityMeshes) {
    const uniforms = data?.mesh?.material?.uniforms;
    if (uniforms?.uStressTint) {
      uniforms.uStressTint.value = state.damageTintEnabled ? 0.30 : 0.0;
    }
  }
  return state.damageTintEnabled;
}

export function isHexDamageTintEnabled() {
  return state.damageTintEnabled !== false;
}

export function updateHexShips3D(viewCamera, entities = [], cullInfo = null) {
  if (!Core3D.isInitialized) return;

  const now = performance.now();
  state.lastTime = now;
  state.frameId++;

  Core3D.syncCamera(viewCamera);

  // Raz na klatkę: aktualizujemy migawkę globalnego tuningu, by per-mesh
  // updateEntityMesh mogło pominąć 9 zapisów uniformów gdy nic się nie zmieniło.
  refreshTuneEpoch();

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;

  const valid = state.validEntities;
  const vfxEntities = state.vfxEntities;
  const visibleHex = state.visibleHexEntities;
  const visibleVfx = state.visibleVfxEntities;
  const stale = state.staleEntities;
  const validSet = state.validEntitySet;
  const weaponActiveEntities = state.weaponActiveEntities;
  valid.length = 0;
  vfxEntities.length = 0;
  visibleHex.length = 0;
  visibleVfx.length = 0;
  stale.length = 0;
  validSet.clear();
  weaponActiveEntities.clear();
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    valid.push(entity);
    const hideHexVisual = entity.hideHexVisual === true || entity.visual?.hideHexMesh === true;
    if (hideHexVisual) {
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      continue;
    }
    if (entity.hexGrid) validSet.add(entity);
    weaponActiveEntities.add(entity);

    const visible = isEntityInCull(entity, cullInfo);
    if (!visible) {
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      continue;
    }

    visibleVfx.push(entity);
    if (!entity.hexGrid) continue;
    visibleHex.push(entity);
  }

  SHIP_LIGHT_EMITTER_OPTIONS.out = state.roadLightEmitters;
  buildRoadLightWorldEmitters(visibleHex, SHIP_LIGHT_EMITTER_OPTIONS);

  let hasRenderable = false;
  for (const entity of visibleHex) {
    let data = state.entityMeshes.get(entity);
    if (!data) data = createEntityMesh(entity);
    if (!data) continue;

    data.mesh.visible = true;
    updateEntityMesh(entity, data, camX, camY);
    hasRenderable = true;
  }

  for (const entity of visibleVfx) {
    const interpPose = getInterpolatedRenderPose(entity);
    const ex = interpPose ? interpPose.x : getEntityPosX(entity);
    const ey = interpPose ? interpPose.y : getEntityPosY(entity);
    const eAngle = interpPose ? interpPose.angle : (entity.angle || 0);
    const scale = getEntityScale(entity);
    Weapon3DSystem.syncWeapons(entity, ex, ey, eAngle, scale);
  }
  Weapon3DSystem.cleanupEntities(weaponActiveEntities);
  Weapon3DSystem.syncProjectiles((typeof window !== 'undefined' && Array.isArray(window.bullets)) ? window.bullets : []);

  GpuDebrisManager.updateTime(now * 0.001);
  updateDebrisRendering();

  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  vfxEntities.push(...visibleVfx);
  EngineVfxSystem.update(visibleVfx);

  state.hadRenderableLastFrame = hasRenderable || visibleHex.length > 0;
}

function resetDrawPerfScratch() {
  drawPerfScratch.coreCallMs = 0;
  drawPerfScratch.coreRenderMs = 0;
  drawPerfScratch.composerMs = 0;
  drawPerfScratch.blitMs = 0;
}

function addCoreDrawPerf(coreCallMs) {
  drawPerfScratch.coreCallMs += coreCallMs;
  const corePerf = Core3D.lastFramePerf;
  if (!corePerf) return;
  drawPerfScratch.coreRenderMs += Number(corePerf.renderTotalMs) || 0;
  drawPerfScratch.composerMs += Number(corePerf.composerMs) || 0;
}

function publishDrawPerfScratch() {
  if (typeof window !== 'undefined') {
    window.__hexShips3DLastDrawPerf = drawPerfScratch;
  }
}

export function drawHexShips3D(ctx, width, height) {
  resetDrawPerfScratch();
  if (!ctx || !Core3D.isInitialized) {
    publishDrawPerfScratch();
    return;
  }
  const src = Core3D.canvas;
  if (!src) {
    publishDrawPerfScratch();
    return;
  }

  const w = Math.max(1, Number(width) || ctx.canvas?.width || 1);
  const h = Math.max(1, Number(height) || ctx.canvas?.height || 1);
  const isSplit = typeof window !== 'undefined'
    && window.splitScreenMode && Core3D.activeCam2;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (isSplit) {
    const halfW = Math.floor(w / 2);
    const srcW = src.width;
    const srcH = src.height;
    // Crop center 50% of the full render — correct perspective for half-screen
    const srcCropX = Math.floor(srcW / 4);
    const srcCropW = Math.floor(srcW / 2);

    // P1 (left half)
    let tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, 0, 0, halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;

    // P2 (right half)
    tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam2);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, halfW, 0, w - halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;
  } else {
    const tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    const tBlit0 = performance.now();
    ctx.drawImage(src, 0, 0, w, h);
    drawPerfScratch.blitMs += performance.now() - tBlit0;
  }

  ctx.restore();
  publishDrawPerfScratch();
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
  GpuDebrisManager.dispose();
  EngineVfxSystem.disposeAll();
  Weapon3DSystem.disposeAll();
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}

