// src/game/destructorGpuSoftBody.js

const WORKGROUP_SIZE = 64;
const SHARD_STRIDE_FLOATS = 8;
const SHARD_STRIDE_BYTES = SHARD_STRIDE_FLOATS * 4;

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

function safeUnmap(buffer) {
  if (!buffer) return;
  try { if (buffer.mapState === 'mapped') buffer.unmap(); } catch { }
}

function createSoftBodyShader(device) {
  const code = `
struct ShardData {
  defX: f32,    
  defY: f32,    
  velX: f32,    
  velY: f32,    
  origX: f32,   
  origY: f32,   
  hp: f32,
  flags: f32    
};

struct Params {
  k: f32,
  maxDeform: f32,
  damping: f32,
  count: f32,
  yieldPoint: f32,
  tearThreshold: f32,
  _pad1: f32,
  _pad2: f32
};

@group(0) @binding(0) var<storage, read> inShards: array<ShardData>;
@group(0) @binding(1) var<storage, read_write> outShards: array<ShardData>;
@group(0) @binding(2) var<storage, read> neighbors: array<i32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= u32(params.count)) { return; }

  var me = inShards[idx];
  if (me.flags < 0.5 || me.hp <= 0.0) {
    outShards[idx] = me;
    return;
  }

  let stiffness = max(0.0, params.k);
  var totalForceX = 0.0;
  var totalForceY = 0.0;
  var newHp = me.hp;

  var myPosX = me.origX + me.defX;
  var myPosY = me.origY + me.defY;
  
  let nBase = idx * 6u;
  var activeNeighbors = 0.0;
  var maxStretch = 0.0;

  for (var i = 0u; i < 6u; i = i + 1u) {
    let nIdx = neighbors[nBase + i];
    if (nIdx >= 0) {
      let n = inShards[u32(nIdx)];
      if (n.flags >= 0.5 && n.hp > 0.0) {
        activeNeighbors = activeNeighbors + 1.0;
        
        let nPosX = n.origX + n.defX;
        let nPosY = n.origY + n.defY;
        
        // restLength bazuje na absolutnym, niezmiennym gridzie! Nie da się go oszukać!
        let expectedDx = n.origX - me.origX;
        let expectedDy = n.origY - me.origY;
        let restLength = length(vec2<f32>(expectedDx, expectedDy));
        
        if (restLength > 0.001) {
            let expDirX = expectedDx / restLength;
            let expDirY = expectedDy / restLength;
            let actualDx = nPosX - myPosX;
            let actualDy = nPosY - myPosY;

            let projLength = actualDx * expDirX + actualDy * expDirY;
            var diff = projLength - restLength;
            
            var forceMag = diff * stiffness;

            var bulgeForceX = 0.0;
            var bulgeForceY = 0.0;

            if (projLength < 0.0) {
                forceMag = forceMag * 8.0; 
                if (-diff > maxStretch) { maxStretch = -diff; }
            } else if (diff < 0.0) {
                // KOMPRESJA (Wgniecenie materiału)
                forceMag = forceMag * 4.5; 
                if (-diff > maxStretch) { maxStretch = -diff; } 
                
                // WYBĄBLENIE MATERIAŁU (Buckling effect)
                // Jeśli sprężyna jest ściśnięta o więcej niż 15% swojej długości, materiał ucieka na boki
                if (diff < -restLength * 0.15) {
                    // Wektor prostopadły do sprężyny
                    let perpX = -expDirY;
                    let perpY = expDirX;
                    
                    // Sprawdzamy, w którą stronę heks już jest lekko odchylony, by tam go kontynuować wypychać
                    let lateralOffset = actualDx * perpX + actualDy * perpY;
                    var bulgeDir = sign(lateralOffset);
                    if (bulgeDir == 0.0) { bulgeDir = 1.0; } // Domyślny kierunek jeśli jest idealnie na wprost
                    
                    // Im mocniej ściśnięty, tym drastyczniej ucieka w bok
                    let bulgeMag = (-diff) * stiffness * 2.2; 
                    bulgeForceX = perpX * bulgeDir * bulgeMag;
                    bulgeForceY = perpY * bulgeDir * bulgeMag;
                }
            } else {
                // ROZCIĄGANIE
                forceMag = forceMag * 0.9; 
                if (diff > maxStretch) { maxStretch = diff; }
            }

            // Aplikujemy główną siłę sprężystości oraz nową siłę wybąblania
            totalForceX = totalForceX + expDirX * forceMag + bulgeForceX;
            totalForceY = totalForceY + expDirY * forceMag + bulgeForceY;

            let relVelX = n.velX - me.velX;
            let relVelY = n.velY - me.velY;
            let axialVel = relVelX * expDirX + relVelY * expDirY;
            let perpX = -expDirY;
            let perpY = expDirX;
            let shearVel = relVelX * perpX + relVelY * perpY;

            let axialTransfer = axialVel * 0.30; 
            let shearTransfer = shearVel * 0.15; 

            totalForceX = totalForceX + expDirX * axialTransfer + perpX * shearTransfer;
            totalForceY = totalForceY + expDirY * axialTransfer + perpY * shearTransfer;
        }
      }
    }
  }

  let neighborNorm = sqrt(max(1.0, activeNeighbors));
  totalForceX = totalForceX / neighborNorm;
  totalForceY = totalForceY / neighborNorm;

  var nextVelX = (me.velX + totalForceX) * params.damping;
  var nextVelY = (me.velY + totalForceY) * params.damping;
  
  if (activeNeighbors < 2.0) {
     nextVelX = nextVelX * 0.1;
     nextVelY = nextVelY * 0.1;
  }

  let velLen = length(vec2<f32>(nextVelX, nextVelY));
  if (velLen > 180.0) {
      nextVelX = (nextVelX / velLen) * 180.0;
      nextVelY = (nextVelY / velLen) * 180.0;
  }

  var nextDefX = me.defX + nextVelX;
  var nextDefY = me.defY + nextVelY;
  let newDefLen = length(vec2<f32>(nextDefX, nextDefY));
  
  // GWARANTOWANE RWANIE MATERIAŁU
  if (maxStretch > params.tearThreshold || newDefLen > params.maxDeform) {
      newHp = 0.0; 
  } 

  if (abs(nextVelX) < 0.03 && abs(nextVelY) < 0.03 && abs(nextDefX - me.defX) < 0.03) {
     nextVelX = 0.0;
     nextVelY = 0.0;
  }

  // origX/Y wracają nietknięte. Siatka kadłuba pozostaje zwarta do momentu pęknięcia!
  outShards[idx] = ShardData(nextDefX, nextDefY, nextVelX, nextVelY, me.origX, me.origY, newHp, me.flags);
}
`;
  return device.createShaderModule({ code });
}

export const DestructorGpuSoftBody = {
  active: false,
  ready: false,
  device: null,
  initPromise: null,
  pipeline: null,
  bindLayout: null,

  entityStates: new Map(),
  _resultsQueue: [],
  _paramsScratch: new Float32Array(8),
  _maxQueueLen: 96,
  _droppedReadbacks: 0,
  _tickId: 0,
  _arrayPool: [],

  _getFloatArray(size) {
    if (this._arrayPool.length > 0) {
      const arr = this._arrayPool.pop();
      if (arr && arr.length === size) return arr;
    }
    return new Float32Array(size);
  },

  _supportsWebGPU() { return typeof navigator !== 'undefined' && !!navigator.gpu; },

  async _init() {
    if (!this._supportsWebGPU()) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.bindLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
        ]
      });
      this.pipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindLayout] }),
        compute: { module: createSoftBodyShader(this.device), entryPoint: 'main' }
      });
      this.active = true;
      this.ready = true;
      return true;
    } catch (error) {
      return false;
    }
  },

  _ensureInit() {
    if (this.ready && this.active) return;
    if (this.initPromise) return;
    this.initPromise = this._init().finally(() => { this.initPromise = null; });
  },

  _buildNeighborData(shards) {
    const count = shards.length;
    const data = new Int32Array(count * 6);
    data.fill(-1);
    const indexMap = new Map();
    for (let i = 0; i < count; i++) indexMap.set(shards[i], i);

    for (let i = 0; i < count; i++) {
      const shard = shards[i];
      if (!Array.isArray(shard.neighbors)) continue;
      const base = i * 6;
      const nCount = Math.min(6, shard.neighbors.length);
      for (let n = 0; n < nCount; n++) {
        const idx = indexMap.get(shard.neighbors[n]);
        if (Number.isInteger(idx)) data[base + n] = idx;
      }
    }
    return data;
  },

  _ensureEntityState(entity, count) {
    const shardsRef = entity.hexGrid.shards;
    let state = this.entityStates.get(entity);

    if (state && (state.count !== count || state.shardsRef !== shardsRef)) {
      this._destroyState(state);
      this.entityStates.delete(entity);
      state = null;
    }

    if (!state) {
      const shardBytes = count * SHARD_STRIDE_BYTES;
      state = {
        count,
        shardsRef,
        isComputing: false,
        dispatchCooldown: 0,
        idleFrames: 0,
        shardData: new Float32Array(count * SHARD_STRIDE_FLOATS),
        shardInBuffer: this.device.createBuffer({ size: shardBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        shardOutBuffer: this.device.createBuffer({ size: shardBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        neighborBuffer: this.device.createBuffer({ size: count * 6 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        paramsBuffer: this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        readbackBuffer: this.device.createBuffer({ size: shardBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        bindGroup: null
      };

      const neighborData = this._buildNeighborData(shardsRef);
      this.device.queue.writeBuffer(state.neighborBuffer, 0, neighborData);

      state.bindGroup = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: state.shardInBuffer } },
          { binding: 1, resource: { buffer: state.shardOutBuffer } },
          { binding: 2, resource: { buffer: state.neighborBuffer } },
          { binding: 3, resource: { buffer: state.paramsBuffer } }
        ]
      });
      this.entityStates.set(entity, state);
    }
    return state;
  },

  _destroyState(state) {
    if (!state) return;
    try {
      state.shardInBuffer?.destroy();
      state.shardOutBuffer?.destroy();
      state.neighborBuffer?.destroy();
      state.paramsBuffer?.destroy();
      state.readbackBuffer?.destroy();
    } catch { }
  },

  _cleanup(activeSet) {
    for (const [entity, state] of this.entityStates) {
      if (!activeSet.has(entity) || entity.dead || !entity.hexGrid) {
        if (!state.isComputing) {
          this._destroyState(state);
          this.entityStates.delete(entity);
        }
      }
    }
  },

  _isEntityHot(entity, sampleLimit, threshold) {
    const shards = entity?.hexGrid?.shards;
    if (!Array.isArray(shards) || shards.length === 0) return false;

    const count = shards.length;
    const limit = Math.max(8, sampleLimit | 0);
    const step = Math.max(1, Math.floor(count / limit));
    const defThreshold = Math.max(0.02, threshold);
    const velThreshold = Math.max(0.02, defThreshold * 0.8);

    let sampled = 0;
    for (let i = 0; i < count && sampled < limit; i += step, sampled++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;
      const tx = Math.abs(Number(s.targetDeformation?.x) || 0);
      const ty = Math.abs(Number(s.targetDeformation?.y) || 0);
      const dx = Math.abs(Number(s.deformation?.x) || 0);
      const dy = Math.abs(Number(s.deformation?.y) || 0);
      const vx = Math.abs(Number(s.__velX) || 0);
      const vy = Math.abs(Number(s.__velY) || 0);
      const cvx = Math.abs(Number(s.__collVelX) || 0);
      const cvy = Math.abs(Number(s.__collVelY) || 0);
      if (tx > defThreshold || ty > defThreshold || dx > defThreshold || dy > defThreshold || vx > velThreshold || vy > velThreshold || cvx > velThreshold || cvy > velThreshold) {
        return true;
      }
    }
    return false;
  },

  _dispatch(entity, state, k, damping, config) {
    state.isComputing = true;
    const shards = state.shardsRef;
    const count = state.count;
    const data = state.shardData;

    for (let i = 0; i < count; i++) {
      const s = shards[i];
      const base = i * SHARD_STRIDE_FLOATS;
      data[base + 0] = Number(s?.targetDeformation?.x) || 0;
      data[base + 1] = Number(s?.targetDeformation?.y) || 0;
      // Merge collision velocity into GPU upload, then consume it
      data[base + 2] = (Number(s?.__velX) || 0) + (Number(s?.__collVelX) || 0);
      data[base + 3] = (Number(s?.__velY) || 0) + (Number(s?.__collVelY) || 0);
      if (s) { s.__collVelX = 0; s.__collVelY = 0; }
      data[base + 4] = Number(s?.gridX) || 0;
      data[base + 5] = Number(s?.gridY) || 0;
      data[base + 6] = Number(s?.hp) || 0;
      data[base + 7] = (s?.active && !s?.isDebris) ? 1.0 : 0.0;
    }

    // Mass-based damping: bigger ships get stronger damping so waves die faster
    const massDampMul = 0.55 + 0.45 * Math.min(1.0, 100 / count);
    const effectiveDamping = damping * massDampMul;

    this._paramsScratch[0] = Math.max(0, Number(k) || 0);
    this._paramsScratch[1] = Math.max(1, Number(config?.maxDeform) || 200);
    this._paramsScratch[2] = Math.max(0.1, effectiveDamping);
    this._paramsScratch[3] = count;
    this._paramsScratch[4] = Number(config?.yieldPoint) || 50;
    this._paramsScratch[5] = Number(config?.tearThreshold) || 150;
    this._paramsScratch[6] = 0;
    this._paramsScratch[7] = 0;

    this.device.queue.writeBuffer(state.shardInBuffer, 0, data);
    this.device.queue.writeBuffer(
      state.paramsBuffer,
      0,
      this._paramsScratch.buffer,
      this._paramsScratch.byteOffset,
      this._paramsScratch.byteLength
    );

    const shardBytes = count * SHARD_STRIDE_BYTES;
    const workgroups = Math.ceil(count / WORKGROUP_SIZE);
    // Multi-iteration: 3 compute passes per dispatch for faster wave propagation
    const GPU_ITERS = 3;
    const encoder = this.device.createCommandEncoder();
    for (let iter = 0; iter < GPU_ITERS; iter++) {
      if (iter > 0) {
        // Ping-pong: copy output back to input for next iteration
        encoder.copyBufferToBuffer(state.shardOutBuffer, 0, state.shardInBuffer, 0, shardBytes);
      }
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, state.bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }

    encoder.copyBufferToBuffer(state.shardOutBuffer, 0, state.readbackBuffer, 0, shardBytes);
    this.device.queue.submit([encoder.finish()]);

    this._readback(entity, state, count);
  },

  async _readback(entity, state, count) {
    try {
      await state.readbackBuffer.mapAsync(GPUMapMode.READ, 0, count * SHARD_STRIDE_BYTES);
      const mapped = state.readbackBuffer.getMappedRange(0, count * SHARD_STRIDE_BYTES);
      const floatCount = count * SHARD_STRIDE_FLOATS;
      const copiedData = this._getFloatArray(floatCount);
      copiedData.set(new Float32Array(mapped));
      state.readbackBuffer.unmap();
      if (this._resultsQueue.length < this._maxQueueLen) {
        this._resultsQueue.push({ entity, count, data: copiedData, shardsRef: state.shardsRef });
      } else {
        this._droppedReadbacks = (this._droppedReadbacks || 0) + 1;
        this._arrayPool.push(copiedData);
      }
    } catch (e) {
      safeUnmap(state.readbackBuffer);
    } finally {
      state.isComputing = false;
    }
  },

  _applyResult(res) {
    const { entity, count, data, shardsRef } = res;
    this._debugAppliedCount = (this._debugAppliedCount || 0) + 1;

    if (entity.dead || !entity.hexGrid || entity.hexGrid.shards !== shardsRef) {
      this._arrayPool.push(data);
      return;
    }

    const shards = entity.hexGrid.shards;
    const safeCount = Math.min(count, shards.length);
    let anyChanges = false;

    for (let i = 0; i < safeCount; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;

      const base = i * SHARD_STRIDE_FLOATS;
      const tx = data[base + 0];
      const ty = data[base + 1];
      const vx = data[base + 2];
      const vy = data[base + 3];
      const newHp = data[base + 6];

      if (Math.abs(s.targetDeformation.x - tx) > 0.001 || Math.abs(s.targetDeformation.y - ty) > 0.001) {
        s.targetDeformation.x = s.targetDeformation.x * 0.4 + tx * 0.6;
        s.targetDeformation.y = s.targetDeformation.y * 0.4 + ty * 0.6;
        anyChanges = true;
      }

      s.__velX = vx;
      s.__velY = vy;

      if (newHp <= 0 && s.hp > 0) {
        if (window.DestructorSystem) {
          window.DestructorSystem.destroyShard(entity, s, { x: vx, y: vy });
          if (!entity.noSplit && window.DestructorSystem.splitQueue.indexOf(entity) === -1) {
            window.DestructorSystem.splitQueue.push(entity);
          }
        } else {
          s.hp = 0;
        }
        anyChanges = true;
      }
    }

    if (anyChanges) entity.hexGrid.meshDirty = true;
    this._arrayPool.push(data);
  },

  tick(entities, config, dt) {
    this._ensureInit();
    this._tickId = (this._tickId + 1) | 0;

    const applyPerTick = Math.max(2, Math.min(32, Number(config?.gpuSoftBodyApplyPerTick) || 16));
    const applyBudgetMs = Math.max(0.2, Math.min(2.5, Number(config?.gpuSoftBodyApplyBudgetMs) || 0.9));
    const applyStart = nowMs();
    let appliedThisTick = 0;
    while (this._resultsQueue.length > 0 && appliedThisTick < applyPerTick) {
      if (appliedThisTick > 0 && (nowMs() - applyStart) >= applyBudgetMs) break;
      const nextRes = this._resultsQueue.pop();
      if (!nextRes) break;
      this._applyResult(nextRes);
      appliedThisTick++;
    }
    while (this._resultsQueue.length > this._maxQueueLen) {
      const dropped = this._resultsQueue.pop();
      if (dropped?.data) this._arrayPool.push(dropped.data);
    }

    if (!this.ready || !this.active || (config?.gpuSoftBody | 0) !== 1) return;

    const list = Array.isArray(entities) ? entities : [];
    this._cleanup(new Set(list));

    const tension = Number(config.softBodyTension) || 0.15;
    if (tension <= 0) return;

    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : (1 / 120);
    const k = 1 - Math.exp(-tension * step * 120);
    const dampingBase = Math.min(0.999, Math.max(0.7, Number(config?.gpuPropagationDamping) || 0.92));
    const damping = Math.pow(dampingBase, step * 60);

    const minShards = Math.max(16, Number(config.gpuSoftBodyMinShards) || 64);
    const hotThreshold = Math.max(0.02, Number(config?.gpuSoftBodyHotThreshold) || 0.06);
    const hotSampleLimit = Math.max(8, Math.min(96, Number(config?.gpuSoftBodyHotSampleLimit) || 36));
    let dispatchPerTick = Math.max(1, Math.min(3, Number(config?.gpuSoftBodyDispatchPerTick) || 2));
    const queueBackpressureLimit = Math.max(16, Number(config?.gpuSoftBodyQueueLimit) || this._maxQueueLen);
    this._maxQueueLen = queueBackpressureLimit;
    const queueRatio = this._resultsQueue.length / Math.max(1, queueBackpressureLimit);
    if (queueRatio > 0.55) dispatchPerTick = 0;
    else if (queueRatio > 0.35) dispatchPerTick = Math.min(dispatchPerTick, 1);
    let dispatchesThisFrame = 0;

    for (const entity of list) {
      if (dispatchPerTick <= 0) break;
      if (this._resultsQueue.length >= queueBackpressureLimit) break;
      if (!entity?.hexGrid?.shards || entity.dead) continue;
      if (entity?.isRingSegment) continue;
      const count = entity.hexGrid.shards.length;
      if (count < minShards) continue;

      const grid = entity.hexGrid;
      if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;

      const state = this._ensureEntityState(entity, count);

      if (state.isComputing) continue;
      if (state.dispatchCooldown > 0) {
        state.dispatchCooldown--;
        continue;
      }

      if (!this._isEntityHot(entity, hotSampleLimit, hotThreshold)) {
        state.idleFrames = Math.min(120, (state.idleFrames | 0) + 1);
        state.dispatchCooldown = Math.min(24, 2 + ((state.idleFrames / 2) | 0));
        continue;
      }
      state.idleFrames = 0;

      let dispatchInterval = Math.max(
        1,
        Number(config?.gpuSoftBodyDispatchInterval) ||
        (count >= 512 ? 3 : count >= 256 ? 2 : 1)
      );
      if (queueRatio > 0.2) dispatchInterval += 1;
      if (queueRatio > 0.35) dispatchInterval += 1;
      if ((this._tickId % dispatchInterval) !== 0) continue;

      this._dispatch(entity, state, k, damping, config);
      state.dispatchCooldown = Math.max(0, dispatchInterval - 1);
      dispatchesThisFrame++;

      if (dispatchesThisFrame >= dispatchPerTick) break;
    }
  }
};
