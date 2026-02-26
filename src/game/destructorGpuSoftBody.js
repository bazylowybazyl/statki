// src/game/destructorGpuSoftBody.js

const WORKGROUP_SIZE = 64;
const SHARD_STRIDE_FLOATS = 8; // Expanded: defX, defY, velX, velY, origX, origY, hp, flags
const SHARD_STRIDE_BYTES = SHARD_STRIDE_FLOATS * 4;

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

function safeUnmap(buffer) {
  if (!buffer) return;
  try { if (buffer.mapState === 'mapped') buffer.unmap(); } catch {}
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

  // 1. ZRYWANIE SMYCZY (PLASTYCZNOSC) I TLUMIENIE (DISSIPATION)
  let defLen = length(vec2<f32>(me.defX, me.defY));
  
  // ZABOJCA GUMY:
  // Kiedy smycz jest za mocna (0.15), nie dopuszcza do przekroczenia yieldPoint.
  // Zmniejszamy moc wracania do 2% - statek po wgnieceniu minimalnie "odstresowuje" blache,
  // ale nie wraca natychmiast jak guma.
  var leashStiffness = stiffness * 0.02; 
  
  var localDamping = params.damping;

  if (defLen > params.yieldPoint) {
      // True GPU plasticity: bake excess deformation into base grid.
      let excess = defLen - params.yieldPoint;
      let ratio = excess / defLen;
      let tx = me.defX * ratio;
      let ty = me.defY * ratio;
      
      me.origX = me.origX + tx; // Persist structural change
      me.origY = me.origY + ty;
      me.defX = me.defX - tx;
      me.defY = me.defY - ty;
      
      myPosX = me.origX + me.defX;
      myPosY = me.origY + me.defY;
      
      leashStiffness = 0.0; 
      localDamping = localDamping * 0.65;
  }
  
  totalForceX = totalForceX - (me.defX * leashStiffness);
  totalForceY = totalForceY - (me.defY * leashStiffness);

  // 2. Neighbor pushback (bulging)
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
        
        let expectedDx = n.origX - me.origX;
        let expectedDy = n.origY - me.origY;
        let restLength = length(vec2<f32>(expectedDx, expectedDy));
        
        let actualDx = nPosX - myPosX;
        let actualDy = nPosY - myPosY;
        let currentLength = length(vec2<f32>(actualDx, actualDy));
        
        if (currentLength > 0.001 && restLength > 0.001) {
            let dotProd = expectedDx * actualDx + expectedDy * actualDy;
            var forceMag = 0.0;
            let dirX = actualDx / currentLength;
            let dirY = actualDy / currentLength;

            // Compression-driven attenuation: transmit impact, not full energy.
            let diff = currentLength - restLength;
            let compression = max(0.0, -diff);
            let compressionRatio = clamp(compression / (restLength + 0.001), 0.0, 1.0);
            let tensionRatio = clamp(max(0.0, diff) / (restLength + 0.001), 0.0, 1.0);

            let relVelX = n.velX - me.velX;
            let relVelY = n.velY - me.velY;
            let relVelMag = length(vec2<f32>(relVelX, relVelY));
            let impactDrive = clamp(relVelMag / 8.0, 0.0, 1.0);
            let propagationRatio = max(compressionRatio, impactDrive * 0.85);

            let axialVel = relVelX * dirX + relVelY * dirY;

            // 1. MAIN AXIAL SPRING
            if (dotProd < 0.0) {
                let stretch = currentLength + restLength;
                if (stretch > maxStretch) { maxStretch = stretch; }
                forceMag = stretch * stiffness * 4.5;
            } else {
                if (diff > maxStretch) { maxStretch = diff; }
                forceMag = diff * stiffness;
                if (diff < 0.0) {
                    forceMag = forceMag * 2.0;
                }
            }

            // Keep first impact wave alive, but still attenuate per edge.
            if (diff > 0.0) {
                forceMag = forceMag * (0.65 + (0.25 * (1.0 - tensionRatio)));
            }
            let edgeAtten = 0.70 + propagationRatio * 0.25;
            forceMag = forceMag * edgeAtten;

            // Dashpot along spring axis (dissipates oscillation each hop).
            forceMag = forceMag - (axialVel * stiffness * 0.10);

            forceMag = clamp(forceMag, -12.0, 12.0);
            totalForceX = totalForceX + dirX * forceMag;
            totalForceY = totalForceY + dirY * forceMag;

            // 2. TRANSVERSE SHEAR WAVE (damped)
            let perpX = -dirY;
            let perpY = dirX;
            let shearVel = relVelX * perpX + relVelY * perpY;

            let axialTransfer = clamp(axialVel * stiffness * 0.24 * propagationRatio, -8.0, 8.0);
            let shearTransfer = clamp(shearVel * stiffness * 0.40 * propagationRatio, -6.0, 6.0);

            totalForceX = totalForceX + dirX * axialTransfer + perpX * shearTransfer;
            totalForceY = totalForceY + dirY * axialTransfer + perpY * shearTransfer;
        }
      }
    }
  }

  // Safety: recompute defLen after updates to avoid runaway tearing
  // Normalize accumulated force so 6-neighbor clusters do not amplify energy.
  let neighborNorm = sqrt(max(1.0, activeNeighbors));
  totalForceX = totalForceX / neighborNorm;
  totalForceY = totalForceY / neighborNorm;

  if (maxStretch > params.tearThreshold || length(vec2<f32>(me.defX, me.defY)) > params.maxDeform) {
      newHp = 0.0; 
  }

  // 4. INTEGRACJA PEDU
  var nextVelX = (me.velX + totalForceX) * localDamping;
  var nextVelY = (me.velY + totalForceY) * localDamping;

  // Damp small residual ripples away from strong impact zones.
  let calmFactor = clamp(defLen / max(1.0, params.yieldPoint), 0.0, 1.0);
  let rippleDamp = 0.94 + calmFactor * 0.05;
  nextVelX = nextVelX * rippleDamp;
  nextVelY = nextVelY * rippleDamp;
  
  if (activeNeighbors < 2.0) {
     nextVelX = nextVelX * 0.2;
     nextVelY = nextVelY * 0.2;
  }

  let velLen = length(vec2<f32>(nextVelX, nextVelY));
  if (velLen > 30.0) {
      nextVelX = (nextVelX / velLen) * 30.0;
      nextVelY = (nextVelY / velLen) * 30.0;
  }

  var nextDefX = me.defX + nextVelX;
  var nextDefY = me.defY + nextVelY;

  if (abs(nextVelX) < 0.03 && abs(nextVelY) < 0.03 && abs(nextDefX - me.defX) < 0.03) {
     nextVelX = 0.0;
     nextVelY = 0.0;
  }

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
      console.warn('[DestructorGpuSoftBody] init failed:', error);
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
    } catch {}
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

  _dispatch(entity, state, k, damping, config) {
    state.isComputing = true;
    const shards = state.shardsRef;
    const count = state.count;
    const data = state.shardData;

    for (let i = 0; i < count; i++) {
      const s = shards[i];
      const base = i * SHARD_STRIDE_FLOATS;
      // Load data into expanded shard buffer
      data[base + 0] = Number(s?.targetDeformation?.x) || 0;
      data[base + 1] = Number(s?.targetDeformation?.y) || 0;
      data[base + 2] = Number(s?.__velX) || 0; // Impact velocity X
      data[base + 3] = Number(s?.__velY) || 0;
      data[base + 4] = Number(s?.gridX) || 0;  // Base position X (stiffness anchor)
      data[base + 5] = Number(s?.gridY) || 0;
      data[base + 6] = Number(s?.hp) || 0;
      data[base + 7] = (s?.active && !s?.isDebris) ? 1.0 : 0.0;
    }

    this._paramsScratch[0] = Math.max(0, Number(k) || 0);
    this._paramsScratch[1] = Math.max(1, Number(config?.maxDeform) || 200);
    this._paramsScratch[2] = Math.max(0.1, Number(damping) || 0.6);
    this._paramsScratch[3] = count;
    this._paramsScratch[4] = Number(config?.yieldPoint) || 50;
    this._paramsScratch[5] = Number(config?.tearThreshold) || 150;
    this._paramsScratch[6] = 0;
    this._paramsScratch[7] = 0;

    this.device.queue.writeBuffer(state.shardInBuffer, 0, data);
    this.device.queue.writeBuffer(state.paramsBuffer, 0, this._paramsScratch);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
    pass.end();
    
    encoder.copyBufferToBuffer(state.shardOutBuffer, 0, state.readbackBuffer, 0, count * SHARD_STRIDE_BYTES);
    this.device.queue.submit([encoder.finish()]);

    this._readback(entity, state, count);
  },

  async _readback(entity, state, count) {
    try {
      await state.readbackBuffer.mapAsync(GPUMapMode.READ, 0, count * SHARD_STRIDE_BYTES);
      const mapped = state.readbackBuffer.getMappedRange(0, count * SHARD_STRIDE_BYTES);
      const copiedData = new Float32Array(mapped).slice(); 
      state.readbackBuffer.unmap();
      
      this._resultsQueue.push({ entity, count, data: copiedData, shardsRef: state.shardsRef });
    } catch (e) {
      safeUnmap(state.readbackBuffer);
    } finally {
      state.isComputing = false;
    }
  },

  _applyResult(res) {
    const { entity, count, data, shardsRef } = res;
    
    // Live Patch Counter
    this._debugAppliedCount = (this._debugAppliedCount || 0) + 1;

    if (entity.dead || !entity.hexGrid || entity.hexGrid.shards !== shardsRef) return;
    
    const shards = entity.hexGrid.shards;
    const safeCount = Math.min(count, shards.length);
    let anyChanges = false;

    for (let i = 0; i < safeCount; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;
      
      const base = i * SHARD_STRIDE_FLOATS;
      const tx = data[base + 0]; // defX
      const ty = data[base + 1]; // defY
      const vx = data[base + 2]; // velX
      const vy = data[base + 3]; // velY
      const ox = data[base + 4]; // origX (Nowy, wygnieciony stan!)
      const oy = data[base + 5]; // origY 
      const newHp = data[base + 6];
      
      if (Math.abs(s.targetDeformation.x - tx) > 0.001 || Math.abs(s.targetDeformation.y - ty) > 0.001) {
        s.targetDeformation.x = tx;
        s.targetDeformation.y = ty;
        s.__velX = vx;
        s.__velY = vy;
        anyChanges = true;
      }

      // Sync baked plastic state from GPU to CPU
      if (Math.abs(s.gridX - ox) > 0.001 || Math.abs(s.gridY - oy) > 0.001) {
        s.gridX = ox;
        s.gridY = oy;
        anyChanges = true;
      }
      
      if (newHp <= 0 && s.hp > 0) {
        if (window.DestructorSystem) {
          window.DestructorSystem.destroyShard(entity, s, { x: vx, y: vy });
        } else {
          s.hp = 0;
        }
        anyChanges = true;
      }
    }

    if (anyChanges) {
      entity.hexGrid.meshDirty = true;
    }
  },

  tick(entities, config, dt) {
    this._ensureInit();

    while (this._resultsQueue.length > 0) {
      this._applyResult(this._resultsQueue.shift());
    }

    if (!this.ready || !this.active || (config?.gpuSoftBody | 0) !== 1) return;

    const list = Array.isArray(entities) ? entities : [];
    this._cleanup(new Set(list));

    const tension = Number(config.softBodyTension) || 0.15;
    if (tension <= 0) return;
    
    // K controls spring stiffness; smaller timestep means gentler per-frame push.
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : (1 / 120);
    const k = 1 - Math.exp(-tension * step * 120); 
    
    // Propagation damping (base^frames). Higher = longer wave travel.
    const dampingBase = Math.min(0.999, Math.max(0.7, Number(config?.gpuPropagationDamping) || 0.92));
    const damping = Math.pow(dampingBase, step * 60); 
    
    const minShards = Math.max(16, Number(config.gpuSoftBodyMinShards) || 64);
    let dispatchesThisFrame = 0;

    for (const entity of list) {
      if (!entity?.hexGrid?.shards || entity.dead) continue;
      const count = entity.hexGrid.shards.length;
      if (count < minShards) continue; 

      const grid = entity.hexGrid;
      if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;

      const state = this._ensureEntityState(entity, count);
      
      if (state.isComputing) continue;

      this._dispatch(entity, state, k, damping, config);
      dispatchesThisFrame++;
      
      if (dispatchesThisFrame >= 4) break; 
    }

    // Logger
    const now = nowMs();
    if (!this._debugLastLog) this._debugLastLog = now;
    if (now - this._debugLastLog > 1000) {
      if (dispatchesThisFrame > 0 || (this._debugAppliedCount || 0) > 0) {
        console.log(`[WebGPU Crush Live] Sent: ${dispatchesThisFrame} | Applied: ${this._debugAppliedCount || 0}`);
      }
      this._debugLastLog = now;
      this._debugAppliedCount = 0;
    }
  }
};




