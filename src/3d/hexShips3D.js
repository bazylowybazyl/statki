import * as THREE from 'three';
import { refreshHexBodyCache } from '../game/destructor.js';
import { Core3D } from './core3d.js';
import { EngineVfxSystem } from './engineVfxSystem.js';

const HEX_VERTEX_SHADER = `
attribute vec2 aGridPos;
attribute float aStress;

uniform vec2 uSpriteSize;

varying vec2 vSpriteUV;
varying float vStress;

void main() {
  vStress = aStress;
  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const HEX_FRAGMENT_SHADER = `
uniform sampler2D uSprite;
uniform sampler2D uNormalMap;
uniform int uHasNormalMap;
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

varying vec2 vSpriteUV;
varying float vStress;

void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 ||
      vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 texel = texture2D(uSprite, vSpriteUV);
  if (texel.a < 0.01) discard;

  vec3 color = texel.rgb;

  vec3 localNormal;
  if (uHasNormalMap == 1) {
    vec4 nTex = texture2D(uNormalMap, vSpriteUV);
    localNormal = normalize(nTex.rgb * 2.0 - 1.0);
  } else {
    vec2 p = vSpriteUV * 2.0 - 1.0;
    localNormal = normalize(vec3(-p.x * 0.45, -p.y * 0.45, 1.0));
  }

  float c = cos(uRotation);
  float s = sin(uRotation);

  vec3 worldNormal = normalize(vec3(
      localNormal.x * c - localNormal.y * s,
      localNormal.x * s + localNormal.y * c,
      localNormal.z
  ));

  float NdotL = dot(worldNormal, uLightDir);
  float dayFactor = smoothstep(uTerminatorStart, uTerminatorEnd, NdotL);
  float dayDiffuse = max(0.0, NdotL);
  float dayLight = uDayAmbient + dayDiffuse * uDayDiffuseMul;
  float lightMul = mix(uNightMin, dayLight, dayFactor);
  color *= lightMul;

  float nightBand = 1.0 - smoothstep(uNightBandStart, uNightBandEnd, NdotL);
  color += uNightTint * nightBand;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(uLightDir + viewDir);
  float spec = pow(max(dot(worldNormal, halfVector), 0.0), 32.0);
  color += vec3(spec * uSpecularMul * dayFactor);

  float stress = clamp(vStress / 20.0, 0.0, 1.0);
  color = mix(color, vec3(1.0, 0.45, 0.1), stress * uStressTint);

  gl_FragColor = vec4(color, texel.a);
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
  hadRenderableLastFrame: false
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

function buildShipLightPanel() {
  if (typeof document === 'undefined') return null;
  const old = document.getElementById('ship-light-panel');
  if (old) old.remove();
  const tune = getShipLightTuning();
  const root = document.createElement('div');
  root.id = 'ship-light-panel';
  root.style.cssText = 'position:fixed;right:14px;top:14px;z-index:2147483647;width:320px;max-height:88vh;overflow:auto;background:rgba(8,12,22,.96);border:1px solid #2b3f67;border-radius:10px;padding:10px;color:#e8f1ff;font:12px/1.25 ui-monospace,Consolas,monospace;box-shadow:0 10px 30px rgba(0,0,0,.45)';
  const title = document.createElement('div');
  title.textContent = 'SHIP DAY/NIGHT';
  title.style.cssText = 'font-weight:700;margin-bottom:8px;color:#9fd0ff';
  root.appendChild(title);

  const addSlider = (label, key, min, max, step) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:112px 1fr 68px;gap:6px;align-items:center;margin:4px 0';
    const lbl = document.createElement('div');
    lbl.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(tune[key]);
    const num = document.createElement('input');
    num.type = 'number';
    num.min = String(min);
    num.max = String(max);
    num.step = String(step);
    num.value = String(tune[key]);
    num.style.cssText = 'width:68px;background:#0a1428;border:1px solid #2b3f67;color:#fff;border-radius:4px;padding:2px 4px;text-align:right';
    const apply = (raw) => {
      const v = clamp(raw, min, max);
      tune[key] = v;
      range.value = String(v);
      num.value = String(v);
    };
    range.addEventListener('input', () => apply(range.value));
    num.addEventListener('input', () => apply(num.value));
    row.append(lbl, range, num);
    root.appendChild(row);
  };

  addSlider('Term Start', 'terminatorStart', -1.0, 0.8, 0.01);
  addSlider('Term End', 'terminatorEnd', -0.6, 1.0, 0.01);
  addSlider('Night Min', 'nightMin', 0.0, 0.6, 0.01);
  addSlider('Night Band A', 'nightBandStart', -1.0, 0.4, 0.01);
  addSlider('Night Band B', 'nightBandEnd', -0.6, 0.8, 0.01);
  addSlider('Night Tint R', 'nightTintR', 0.0, 0.2, 0.001);
  addSlider('Night Tint G', 'nightTintG', 0.0, 0.2, 0.001);
  addSlider('Night Tint B', 'nightTintB', 0.0, 0.2, 0.001);
  addSlider('Day Ambient', 'dayAmbient', 0.0, 1.0, 0.01);
  addSlider('Day Diffuse', 'dayDiffuseMul', 0.0, 2.5, 0.01);
  addSlider('Specular', 'specularMul', 0.0, 1.0, 0.01);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const mkBtn = (text, fn) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = 'flex:1;background:#102344;border:1px solid #32558a;color:#fff;border-radius:6px;padding:6px 8px;cursor:pointer';
    btn.onclick = fn;
    return btn;
  };
  row.append(
    mkBtn('Copy JSON', async () => {
      const text = JSON.stringify(tune, null, 2);
      try { await navigator.clipboard.writeText(text); } catch {}
      console.log(text);
    }),
    mkBtn('Reset', () => {
      Object.assign(tune, SHIP_LIGHT_DEFAULTS);
      root.remove();
      buildShipLightPanel();
    }),
    mkBtn('Close', () => root.remove())
  );
  root.appendChild(row);
  document.body.appendChild(root);
  return root;
}

function ensureShipLightPanelApi() {
  if (typeof window === 'undefined') return;
  if (window.__shipLightPanel) return;
  window.__shipLightPanel = {
    open: () => buildShipLightPanel(),
    close: () => document.getElementById('ship-light-panel')?.remove(),
    reset: () => Object.assign(getShipLightTuning(), SHIP_LIGHT_DEFAULTS),
    status: () => ({ ...getShipLightTuning() })
  };
}

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
    const sx = Number(shard.deformation.x) || 0;
    const sy = Number(shard.deformation.y) || 0;
    return Math.hypot(sx, sy);
  }
  return 0;
}

function disposeMeshData(data) {
  if (!data) return;
  if (Core3D.scene && data.mesh) {
    Core3D.scene.remove(data.mesh);
  }
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  data.texture?.dispose?.();
  data.normalTexture?.dispose?.();
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

  const texture = new THREE.CanvasTexture(grid.cacheCanvas);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  let normalTexture = null;
  if (grid.normalMapImage) {
      normalTexture = new THREE.CanvasTexture(grid.normalMapImage);
      normalTexture.flipY = false;
      normalTexture.minFilter = THREE.LinearFilter;
      normalTexture.magFilter = THREE.LinearFilter;
      normalTexture.needsUpdate = true;
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSprite: { value: texture },
      uNormalMap: { value: normalTexture },
      uHasNormalMap: { value: normalTexture ? 1 : 0 },
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uRotation: { value: 0.0 },
      uSpriteSize: { value: new THREE.Vector2(grid.srcWidth || 1, grid.srcHeight || 1) },
      uStressTint: { value: 0.30 },
      uTerminatorStart: { value: SHIP_LIGHT_DEFAULTS.terminatorStart },
      uTerminatorEnd: { value: SHIP_LIGHT_DEFAULTS.terminatorEnd },
      uNightMin: { value: SHIP_LIGHT_DEFAULTS.nightMin },
      uNightBandStart: { value: SHIP_LIGHT_DEFAULTS.nightBandStart },
      uNightBandEnd: { value: SHIP_LIGHT_DEFAULTS.nightBandEnd },
      uNightTint: { value: new THREE.Vector3(SHIP_LIGHT_DEFAULTS.nightTintR, SHIP_LIGHT_DEFAULTS.nightTintG, SHIP_LIGHT_DEFAULTS.nightTintB) },
      uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
      uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul },
      uSpecularMul: { value: SHIP_LIGHT_DEFAULTS.specularMul }
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

  const gridPosArray = new Float32Array(count * 2);
  const stressArray = new Float32Array(count);
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
  }

  mesh.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(gridPosArray, 2));
  mesh.geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArray, 1));
  mesh.geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);

  Core3D.scene.add(mesh);

  const data = {
    mesh,
    texture,
    normalTexture,
    normalMapRef: grid.normalMapImage || null,
    stressAttr: mesh.geometry.getAttribute('aStress'),
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

  if (!!grid.textureDirty || !!grid.cacheDirty) {
    refreshHexBodyCache(entity);
    data.texture.needsUpdate = true;
    grid.textureDirty = false;
    grid.cacheDirty = false;
  } else if (!!grid.gpuTextureNeedsUpdate) {
    data.texture.needsUpdate = true;
    grid.gpuTextureNeedsUpdate = false;
  }

  if (!!grid.meshDirty || data.needsInstanceRefresh) {
    const stressAttr = data.stressAttr;
    const dummy = state.dummy;
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;
    mesh.count = shards.length;

    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      if (shard && shard?.active && !shard?.isDebris) {
        const gx = (Number(shard.gridX) || 0) + (Number(shard.deformation?.x) || 0);
        const gy = (Number(shard.gridY) || 0) + (Number(shard.deformation?.y) || 0);
        dummy.position.set(gx - cx - data.pivotX, gy - cy - data.pivotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        stressAttr.array[i] = computeShardStress(shard);
      } else {
        dummy.position.set(0, 0, -99999);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        stressAttr.array[i] = 0;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    stressAttr.needsUpdate = true;
    data.needsInstanceRefresh = false;
    grid.meshDirty = false;
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
  mesh.rotation.z = -entityAngle;
  const scale = getEntityScale(entity);
  mesh.scale.set(scale, -scale, 1);
}

export function initHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  ensureShipLightPanelApi();
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

  const valid = [];
  const vfxEntities = [];
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    vfxEntities.push(entity);
    if (!entity.hexGrid) continue;
    valid.push(entity);
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

  const validSet = new Set(valid);
  const stale = [];
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

export function disposeHexShips3D() {
  for (const [, data] of state.entityMeshes) {
    disposeMeshData(data);
  }
  state.entityMeshes.clear();
  EngineVfxSystem.disposeAll();
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}
