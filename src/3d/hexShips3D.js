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
uniform float uStressTint;

varying vec2 vSpriteUV;
varying float vStress;

void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 ||
      vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 texel = texture2D(uSprite, vSpriteUV);
  if (texel.a < 0.01) discard;

  float stress = clamp(vStress / 20.0, 0.0, 1.0);
  texel.rgb = mix(texel.rgb, vec3(1.0, 0.45, 0.1), stress * uStressTint);
  gl_FragColor = texel;
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

function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function getEntityScale(entity) {
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function computeShardStress(shard) {
  if (shard && shard.deformation) {
    const sx = Number(shard.deformation.x) || 0;
    const sy = Number(shard.deformation.y) || 0;
    return Math.hypot(sx, sy);
  }
  if (!shard?.verts || !shard?.baseVerts || shard.verts.length !== shard.baseVerts.length) return 0;
  let maxDistSq = 0;
  for (let i = 0; i < shard.verts.length; i++) {
    const v = shard.verts[i];
    const b = shard.baseVerts[i];
    const dx = (v?.x || 0) - (b?.x || 0);
    const dy = (v?.y || 0) - (b?.y || 0);
    const d2 = dx * dx + dy * dy;
    if (d2 > maxDistSq) maxDistSq = d2;
  }
  return Math.sqrt(maxDistSq);
}

function disposeMeshData(data) {
  if (!data) return;
  if (Core3D.scene && data.mesh) {
    Core3D.scene.remove(data.mesh);
  }
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  data.texture?.dispose?.();
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
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSprite: { value: texture },
      uSpriteSize: { value: new THREE.Vector2(grid.srcWidth || 1, grid.srcHeight || 1) },
      uStressTint: { value: 0.30 }
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

  // Dodajemy do głównej sceny Core3D!
  Core3D.scene.add(mesh);

  const data = {
    mesh,
    texture,
    stressAttr: mesh.geometry.getAttribute('aStress'),
    shardsRef: shards,
    shardCount: count,
    srcWidth: grid.srcWidth || 1,
    srcHeight: grid.srcHeight || 1,
    needsInstanceRefresh: true
  };
  state.entityMeshes.set(entity, data);
  return data;
}

function getEntityUpdateStride(entity, distWorld) {
  if (entity?.isPlayer) return 1;
  if (distWorld > state.farDistanceWorld) return 4;
  if (distWorld > state.midDistanceWorld) return 2;
  return 1;
}

function updateEntityMesh(entity, data, camX, camY) {
  if (!entity?.hexGrid || !data?.mesh) return;
  const grid = entity.hexGrid;
  const shards = grid.shards;

  const needsRebuild =
    data.shardsRef !== shards ||
    data.shardCount !== shards.length ||
    data.srcWidth !== (grid.srcWidth || 1) ||
    data.srcHeight !== (grid.srcHeight || 1);

  if (needsRebuild) {
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
    data = createEntityMesh(entity);
    if (!data) return;
  }

  const mesh = data.mesh;
  const ex = getEntityPosX(entity);
  const ey = getEntityPosY(entity);
  const distWorld = Math.hypot(ex - camX, ey - camY);
  const stride = getEntityUpdateStride(entity, distWorld);

  const shouldProcessMesh = !!grid.meshDirty && (state.frameId % stride === 0);
  const shouldProcessTexture = (!!grid.textureDirty || !!grid.cacheDirty) && (state.frameId % stride === 0);
  const shouldPushGpuTexture = !!grid.gpuTextureNeedsUpdate && (state.frameId % stride === 0);

  if (shouldProcessTexture) {
    refreshHexBodyCache(entity);
    data.texture.needsUpdate = true;
    grid.textureDirty = false;
    grid.cacheDirty = false;
    grid.gpuTextureNeedsUpdate = false;
  } else if (shouldPushGpuTexture) {
    data.texture.needsUpdate = true;
    grid.gpuTextureNeedsUpdate = false;
  }

  if (shouldProcessMesh || data.needsInstanceRefresh) {
    const stressAttr = data.stressAttr;
    const dummy = state.dummy;
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;
    const pivotX = grid.pivot?.x || 0;
    const pivotY = grid.pivot?.y || 0;

    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      if (shard?.active && !shard?.isDebris) {
        const gx = (Number(shard.gridX) || 0) + (Number(shard.deformation?.x) || 0);
        const gy = (Number(shard.gridY) || 0) + (Number(shard.deformation?.y) || 0);
        dummy.position.set(gx - cx - pivotX, gy - cy - pivotY, 0);
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

  // CZYSTE WSPÓŁRZĘDNE: Core3D obsługuje kamerę za nas. 
  // Podajemy pozycje bez przeliczania kamery!
  mesh.position.set(ex, -ey, 0);
  mesh.rotation.z = -(entity.angle || 0);
  const scale = getEntityScale(entity);
  mesh.scale.set(scale, -scale, 1);
}

export function initHexShips3D({ canvas = null } = {}) {
  // Podpinamy główny Core3D do canvasa podanego z zewnątrz (offscreen w tym przypadku)
  if (!Core3D.isInitialized) {
    Core3D.init(canvas);
  }
  return true;
}

export function resizeHexShips3D(width, height) {
  if (Core3D.isInitialized) Core3D.resize(width, height);
}

function isEntityVisibleInCamera(entity, camX, camY, halfWWorld, halfHWorld, marginWorld) {
  const ex = getEntityPosX(entity);
  const ey = getEntityPosY(entity);
  const dx = ex - camX;
  const dy = ey - camY;
  const radius = Math.max(100, Number(entity?.radius) || 140);
  return (
    Math.abs(dx) <= halfWWorld + radius + marginWorld &&
    Math.abs(dy) <= halfHWorld + radius + marginWorld
  );
}

export function updateHexShips3D(viewCamera, entities = []) {
  if (!Core3D.isInitialized) return;

  const now = performance.now();
  const dt = (now - state.lastTime) / 1000;
  state.lastTime = now;
  state.frameId++;

  Core3D.syncCamera(viewCamera);

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;
  const camZoom = Math.max(0.0001, Number(viewCamera?.zoom) || 1);
  const halfWWorld = Core3D.width / (2 * camZoom);
  const halfHWorld = Core3D.height / (2 * camZoom);
  const marginWorld = 260 / camZoom;

  const valid = [];
  const visible = [];
  
  for (const entity of entities) {
    if (!entity || entity.dead || !entity.hexGrid) continue;
    valid.push(entity);
    if (!isEntityVisibleInCamera(entity, camX, camY, halfWWorld, halfHWorld, marginWorld)) continue;
    const dx = getEntityPosX(entity) - camX;
    const dy = getEntityPosY(entity) - camY;
    visible.push({ entity, distSq: dx * dx + dy * dy });
  }

  visible.sort((a, b) => a.distSq - b.distSq);
  const selected = visible.slice(0, Math.max(1, state.maxVisibleEntities));
  const selectedSet = new Set(selected.map(v => v.entity));
  const validSet = new Set(valid);

  let hasRenderable = false;
  for (const entity of valid) {
    let data = state.entityMeshes.get(entity);
    if (!data && selectedSet.has(entity)) {
      data = createEntityMesh(entity);
    }
    if (!data) continue;
    if (selectedSet.has(entity)) {
      data.mesh.visible = true;
      updateEntityMesh(entity, data, camX, camY);
      hasRenderable = true;
    } else {
      data.mesh.visible = false;
    }
  }

  const stale = [];
  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  // --- AKTUALIZACJA SILNIKÓW 3D ---
  EngineVfxSystem.update(dt, valid);

  state.hadRenderableLastFrame = hasRenderable || valid.length > 0;
}

export function drawHexShips3D(ctx, width, height) {
  if (!ctx || !Core3D.isInitialized || !state.hadRenderableLastFrame) return;

  // Renderujemy serce Core3D!
  Core3D.render();

  // Ponieważ gra nadal składa warstwy ręcznie w Canvasie 2D (przez drawImage), 
  // pobieramy wynik z pamięci i nakładamy na ekran:
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
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}