/**
 * destructorGpuSoftBody3D — port destructorGpuSoftBody.js (2D, 8 floatów/shard)
 * na komórki 3D: 12 floatów/komórkę (def xyz, vel xyz, orig xyz, hp, flags, pad),
 * 6 sąsiadów siatki sześciennej. Semantyka bez zmian:
 *  - sprężyny osiowe z restLength z pozycji PRISTINE (ox/oy/oz — nietykane bake'iem),
 *  - kompresja usztywniona ×3.2 + wybąblanie prostopadłe przy głębokim zgniocie,
 *  - transfer prędkości osiowy/ścinający, tłumienie, clamp prędkości,
 *  - rwanie materiału: maxStretch > tearThreshold lub |def| > maxDeform → hp=0,
 *  - asynchroniczny readback: lerp 0.35/0.65 do targetDeformation, pieczenie
 *    plastyczne powyżej yieldPoint do bkx/gx, guard repairStamp na nieświeże wyniki.
 */

const WORKGROUP_SIZE = 64;
const CELL_STRIDE_FLOATS = 12;
const CELL_STRIDE_BYTES = CELL_STRIDE_FLOATS * 4;

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

function safeUnmap(buffer) {
  if (!buffer) return;
  try { if (buffer.mapState === 'mapped') buffer.unmap(); } catch { }
}

function createSoftBodyShader(device) {
  const code = `
struct CellData {
  defX: f32, defY: f32, defZ: f32,
  velX: f32, velY: f32, velZ: f32,
  origX: f32, origY: f32, origZ: f32,
  hp: f32,
  flags: f32,
  _pad: f32
};

struct Params {
  k: f32,
  maxDeform: f32,
  damping: f32,
  count: f32,
  yieldPoint: f32,
  tearThreshold: f32,
  velClamp: f32,
  _pad2: f32
};

@group(0) @binding(0) var<storage, read> inCells: array<CellData>;
@group(0) @binding(1) var<storage, read_write> outCells: array<CellData>;
@group(0) @binding(2) var<storage, read> neighbors: array<i32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= u32(params.count)) { return; }

  var me = inCells[idx];
  if (me.flags < 0.5 || me.hp <= 0.0) {
    outCells[idx] = me;
    return;
  }

  let stiffness = max(0.0, params.k);
  var totalForce = vec3<f32>(0.0, 0.0, 0.0);
  var newHp = me.hp;

  let myPos = vec3<f32>(me.origX + me.defX, me.origY + me.defY, me.origZ + me.defZ);
  let myVel = vec3<f32>(me.velX, me.velY, me.velZ);

  let nBase = idx * 6u;
  var activeNeighbors = 0.0;
  var maxStretch = 0.0;

  for (var i = 0u; i < 6u; i = i + 1u) {
    let nIdx = neighbors[nBase + i];
    if (nIdx >= 0) {
      let n = inCells[u32(nIdx)];
      if (n.flags >= 0.5 && n.hp > 0.0) {
        activeNeighbors = activeNeighbors + 1.0;

        let nPos = vec3<f32>(n.origX + n.defX, n.origY + n.defY, n.origZ + n.defZ);

        // restLength z absolutnej, niezmiennej siatki pristine.
        let expected = vec3<f32>(n.origX - me.origX, n.origY - me.origY, n.origZ - me.origZ);
        let restLength = length(expected);

        if (restLength > 0.001) {
          let expDir = expected / restLength;
          let actual = nPos - myPos;

          var projLength = dot(actual, expDir);
          let minProj = restLength * 0.22;
          if (projLength < minProj) { projLength = minProj; }
          var diff = projLength - restLength;

          var forceMag = diff * stiffness;
          var bulgeForce = vec3<f32>(0.0, 0.0, 0.0);

          if (diff < 0.0) {
            // KOMPRESJA — usztywnienie + wybąblanie boczne
            forceMag = forceMag * 3.2;
            if (-diff > maxStretch) { maxStretch = -diff; }

            if (diff < -restLength * 0.12 && projLength > restLength * 0.45) {
              let lateral = actual - expDir * projLength;
              let latLen = length(lateral);
              var latDir = vec3<f32>(0.0, 0.0, 0.0);
              if (latLen > 0.0001) {
                latDir = lateral / latLen;
              } else {
                // brak przesunięcia bocznego — dowolna prostopadła
                var pick = vec3<f32>(1.0, 0.0, 0.0);
                if (abs(expDir.x) > 0.9) { pick = vec3<f32>(0.0, 1.0, 0.0); }
                latDir = normalize(cross(expDir, pick));
              }
              let bulgeMag = min((-diff) * stiffness * 0.8, restLength * stiffness * 0.45);
              bulgeForce = latDir * bulgeMag;
            }
          } else {
            // ROZCIĄGANIE
            forceMag = forceMag * 0.9;
            if (diff > maxStretch) { maxStretch = diff; }
          }

          totalForce = totalForce + expDir * forceMag + bulgeForce;

          // transfer prędkości: osiowy 0.30, ścinający 0.15
          let relVel = vec3<f32>(n.velX, n.velY, n.velZ) - myVel;
          let axialVel = dot(relVel, expDir);
          let shearVel = relVel - expDir * axialVel;
          totalForce = totalForce + expDir * (axialVel * 0.30) + shearVel * 0.15;
        }
      }
    }
  }

  let neighborNorm = sqrt(max(1.0, activeNeighbors));
  totalForce = totalForce / neighborNorm;

  var nextVel = (myVel + totalForce) * params.damping;
  if (activeNeighbors < 2.0) {
    nextVel = nextVel * 0.1;
  }

  let velLen = length(nextVel);
  if (velLen > params.velClamp) {
    nextVel = nextVel * (params.velClamp / velLen);
  }

  var nextDef = vec3<f32>(me.defX, me.defY, me.defZ) + nextVel;
  let newDefLen = length(nextDef);
  if (newDefLen > params.maxDeform) {
    nextDef = nextDef * (params.maxDeform / max(0.0001, newDefLen));
    newHp = 0.0;
  }

  // GWARANTOWANE RWANIE MATERIAŁU
  if (maxStretch > params.tearThreshold) {
    newHp = 0.0;
  }

  if (length(nextVel) < 0.03 && abs(nextDef.x - me.defX) < 0.03) {
    nextVel = vec3<f32>(0.0, 0.0, 0.0);
  }

  // orig wraca nietknięty — siatka pristine pozostaje zwarta do momentu pęknięcia.
  outCells[idx] = CellData(
    nextDef.x, nextDef.y, nextDef.z,
    nextVel.x, nextVel.y, nextVel.z,
    me.origX, me.origY, me.origZ,
    newHp, me.flags, 0.0
  );
}
`;
  return device.createShaderModule({ code });
}

export const DestructorGpuSoftBody3D = {
  active: false,
  ready: false,
  device: null,
  initPromise: null,
  pipeline: null,
  bindLayout: null,
  system: null,            // wstrzykiwany przez Destructor3D.init — destroyCell/splitQueue

  bodyStates: new Map(),
  _resultsQueue: [],
  _paramsScratch: new Float32Array(8),
  _maxQueueLen: 64,
  _tickId: 0,
  _cleanupStamp: 1,
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
    } catch {
      return false;
    }
  },

  _ensureInit() {
    if (this.ready && this.active) return;
    if (this.initPromise) return;
    this.initPromise = this._init().finally(() => { this.initPromise = null; });
  },

  _buildNeighborData(cells) {
    const count = cells.length;
    const data = new Int32Array(count * 6);
    data.fill(-1);
    const indexMap = new Map();
    for (let i = 0; i < count; i++) indexMap.set(cells[i], i);
    for (let i = 0; i < count; i++) {
      const cell = cells[i];
      const base = i * 6;
      const nCount = Math.min(6, cell.neighbors.length);
      for (let n = 0; n < nCount; n++) {
        const idx = indexMap.get(cell.neighbors[n]);
        if (Number.isInteger(idx)) data[base + n] = idx;
      }
    }
    return data;
  },

  _ensureBodyState(body, count) {
    const cellsRef = body.grid.cells;
    let state = this.bodyStates.get(body);
    if (state && (state.count !== count || state.cellsRef !== cellsRef)) {
      this._destroyState(state);
      this.bodyStates.delete(body);
      state = null;
    }
    if (!state) {
      const bytes = count * CELL_STRIDE_BYTES;
      state = {
        count,
        cellsRef,
        isComputing: false,
        dispatchCooldown: 0,
        idleFrames: 0,
        cellData: new Float32Array(count * CELL_STRIDE_FLOATS),
        inBuffer: this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        outBuffer: this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        neighborBuffer: this.device.createBuffer({ size: count * 6 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        paramsBuffer: this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        readbackBuffer: this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        bindGroup: null,
        repairStamp: 0
      };
      this.device.queue.writeBuffer(state.neighborBuffer, 0, this._buildNeighborData(cellsRef));
      state.bindGroup = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: state.inBuffer } },
          { binding: 1, resource: { buffer: state.outBuffer } },
          { binding: 2, resource: { buffer: state.neighborBuffer } },
          { binding: 3, resource: { buffer: state.paramsBuffer } }
        ]
      });
      this.bodyStates.set(body, state);
    }
    return state;
  },

  _destroyState(state) {
    if (!state) return;
    try {
      state.inBuffer?.destroy();
      state.outBuffer?.destroy();
      state.neighborBuffer?.destroy();
      state.paramsBuffer?.destroy();
      state.readbackBuffer?.destroy();
    } catch { }
  },

  _cleanup(activeStamp) {
    for (const [body, state] of this.bodyStates) {
      if ((body?._gpuActiveStamp | 0) !== (activeStamp | 0) || body.dead || !body.grid) {
        if (!state.isComputing) {
          this._destroyState(state);
          this.bodyStates.delete(body);
        }
      }
    }
  },

  _isBodyHot(body, sampleLimit, threshold) {
    if ((body._gpuForceAwakeFrames | 0) > 0) {
      body._gpuForceAwakeFrames--;
      return true;
    }
    const cells = body?.grid?.cells;
    if (!Array.isArray(cells) || cells.length === 0) return false;
    const count = cells.length;
    const limit = Math.max(8, sampleLimit | 0);
    const step = Math.max(1, Math.floor(count / limit));
    const defT = Math.max(1e-4, threshold);
    const velT = defT * 0.8;
    let sampled = 0;
    for (let i = 0; i < count && sampled < limit; i += step, sampled++) {
      const c = cells[i];
      if (!c || !c.active) continue;
      if (Math.abs(c.tx - c.dx) > defT || Math.abs(c.ty - c.dy) > defT || Math.abs(c.tz - c.dz) > defT) return true;
      if (Math.abs(c.vx) + Math.abs(c.cvx) > velT || Math.abs(c.vy) + Math.abs(c.cvy) > velT || Math.abs(c.vz) + Math.abs(c.cvz) > velT) return true;
    }
    return false;
  },

  _dispatch(body, state, k, damping, config) {
    state.isComputing = true;
    const cells = state.cellsRef;
    const count = state.count;
    const data = state.cellData;

    for (let i = 0; i < count; i++) {
      const c = cells[i];
      const base = i * CELL_STRIDE_FLOATS;
      // GPU dostaje deformację względem pristine (target + bake) i restLength z ox/oy/oz.
      data[base + 0] = c.tx + c.bkx;
      data[base + 1] = c.ty + c.bky;
      data[base + 2] = c.tz + c.bkz;
      data[base + 3] = c.vx + c.cvx;
      data[base + 4] = c.vy + c.cvy;
      data[base + 5] = c.vz + c.cvz;
      c.cvx = 0; c.cvy = 0; c.cvz = 0; // prędkość kolizyjna skonsumowana
      data[base + 6] = c.ox;
      data[base + 7] = c.oy;
      data[base + 8] = c.oz;
      data[base + 9] = c.hp;
      data[base + 10] = c.active ? 1.0 : 0.0;
      data[base + 11] = 0;
    }

    // większe ciała → mocniejsze tłumienie (fale gasną szybciej)
    const massDampMul = 0.75 + 0.25 * Math.min(1.0, 200 / count);
    this._paramsScratch[0] = Math.max(0, k);
    this._paramsScratch[1] = Math.max(0.001, config.maxDeform);
    this._paramsScratch[2] = Math.max(0.1, damping * massDampMul);
    this._paramsScratch[3] = count;
    this._paramsScratch[4] = config.yieldPoint;
    this._paramsScratch[5] = config.tearThreshold;
    this._paramsScratch[6] = Math.max(0.01, config.gpuVelClamp);
    this._paramsScratch[7] = 0;

    this.device.queue.writeBuffer(state.inBuffer, 0, data);
    this.device.queue.writeBuffer(state.paramsBuffer, 0, this._paramsScratch.buffer, this._paramsScratch.byteOffset, this._paramsScratch.byteLength);

    const bytes = count * CELL_STRIDE_BYTES;
    const workgroups = Math.ceil(count / WORKGROUP_SIZE);
    const forcedAwake = (body._gpuForceAwakeFrames | 0) > 0;
    let iters = 3;
    if (forcedAwake && count >= 2400) iters = 1;
    else if (forcedAwake && count >= 1400) iters = 2;

    const encoder = this.device.createCommandEncoder();
    for (let it = 0; it < iters; it++) {
      if (it > 0) encoder.copyBufferToBuffer(state.outBuffer, 0, state.inBuffer, 0, bytes);
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, state.bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    encoder.copyBufferToBuffer(state.outBuffer, 0, state.readbackBuffer, 0, bytes);
    this.device.queue.submit([encoder.finish()]);

    state.repairStamp = body._gpuRepairStamp | 0;
    this._readback(body, state, count);
  },

  async _readback(body, state, count) {
    try {
      await state.readbackBuffer.mapAsync(GPUMapMode.READ, 0, count * CELL_STRIDE_BYTES);
      const mapped = state.readbackBuffer.getMappedRange(0, count * CELL_STRIDE_BYTES);
      const copied = this._getFloatArray(count * CELL_STRIDE_FLOATS);
      copied.set(new Float32Array(mapped));
      state.readbackBuffer.unmap();
      this._resultsQueue.push({ body, count, data: copied, cellsRef: state.cellsRef, repairStamp: state.repairStamp });
    } catch {
      safeUnmap(state.readbackBuffer);
    } finally {
      state.isComputing = false;
    }
  },

  _applyResult(res) {
    const { body, count, data, cellsRef, repairStamp } = res;
    if (
      body.dead || !body.grid || body.grid.cells !== cellsRef ||
      (body._gpuRepairStamp | 0) !== (repairStamp | 0)
    ) {
      this._arrayPool.push(data);
      return;
    }

    const grid = body.grid;
    const cells = grid.cells;
    const safeCount = Math.min(count, cells.length);
    const yieldP = this._yieldPoint || 1;
    let anyChanges = false;

    for (let i = 0; i < safeCount; i++) {
      const c = cells[i];
      if (!c || !c.active) continue;
      const base = i * CELL_STRIDE_FLOATS;
      // deformacja wraca względem pristine — odejmij bake
      const txNew = data[base + 0] - c.bkx;
      const tyNew = data[base + 1] - c.bky;
      const tzNew = data[base + 2] - c.bkz;
      const vx = data[base + 3], vy = data[base + 4], vz = data[base + 5];
      const newHp = data[base + 9];

      if (Math.abs(c.tx - txNew) > 0.001 || Math.abs(c.ty - tyNew) > 0.001 || Math.abs(c.tz - tzNew) > 0.001) {
        c.tx = c.tx * 0.35 + txNew * 0.65;
        c.ty = c.ty * 0.35 + tyNew * 0.65;
        c.tz = c.tz * 0.35 + tzNew * 0.65;
        anyChanges = true;
      }

      // pieczenie plastyczne powyżej yieldPoint → bake do bk/g
      const defMag = Math.sqrt(c.tx * c.tx + c.ty * c.ty + c.tz * c.tz);
      if (defMag > yieldP) {
        const ratio = (defMag - yieldP) / defMag;
        const bx = c.tx * ratio, by = c.ty * ratio, bz = c.tz * ratio;
        c.bkx += bx; c.bky += by; c.bkz += bz;
        c.gx += bx; c.gy += by; c.gz += bz;
        c.dx -= bx; c.dy -= by; c.dz -= bz;
        c.tx -= bx; c.ty -= by; c.tz -= bz;
        anyChanges = true;
      }

      const oldVx = c.vx, oldVy = c.vy, oldVz = c.vz;
      c.vx = vx; c.vy = vy; c.vz = vz;
      if (Math.abs(oldVx - vx) > 0.03 || Math.abs(oldVy - vy) > 0.03 || Math.abs(oldVz - vz) > 0.03) anyChanges = true;

      if (newHp <= 0 && c.hp > 0) {
        const sys = this.system;
        if (sys) {
          sys.destroyCell(body, c);
          if (!body.noSplit && sys.splitQueue.indexOf(body) === -1) sys.splitQueue.push(body);
        } else {
          c.hp = 0;
          c.active = false;
        }
        anyChanges = true;
      }
    }

    if (anyChanges) {
      grid.meshDirty = true;
      grid.isSleeping = false;
      grid.sleepFrames = 0;
    }
    this._arrayPool.push(data);
  },

  tick(bodies, config, dt) {
    this._ensureInit();
    this._yieldPoint = Number(config?.yieldPoint) || 1;
    this._tickId = (this._tickId + 1) | 0;

    // aplikacja gotowych wyników (budżetowana)
    const applyStart = nowMs();
    let applied = 0;
    while (this._resultsQueue.length > 0 && applied < 16) {
      if (applied > 0 && (nowMs() - applyStart) >= 1.0) break;
      const res = this._resultsQueue.pop();
      if (!res) break;
      this._applyResult(res);
      applied++;
    }
    while (this._resultsQueue.length > this._maxQueueLen) {
      const dropped = this._resultsQueue.pop();
      if (dropped?.data) this._arrayPool.push(dropped.data);
    }

    if (!this.ready || !this.active || (config?.gpuSoftBody | 0) !== 1) return;

    const list = Array.isArray(bodies) ? bodies : [];
    let cleanupStamp = (this._cleanupStamp + 1) | 0;
    if (cleanupStamp <= 0) cleanupStamp = 1;
    this._cleanupStamp = cleanupStamp;
    for (const body of list) if (body) body._gpuActiveStamp = cleanupStamp;
    this._cleanup(cleanupStamp);

    const tension = Number(config.softBodyTension) || 0.15;
    if (tension <= 0) return;

    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : (1 / 120);
    const k = 1 - Math.exp(-tension * step * 120);
    const dampingBase = Math.min(0.999, Math.max(0.7, Number(config.gpuPropagationDamping) || 0.92));
    const damping = Math.pow(dampingBase, step * 60);
    const minCells = Math.max(16, config.gpuSoftBodyMinCells | 0);
    const hotThreshold = Math.max(1e-4, config.elasticSleepThreshold * 5);

    let dispatchPerTick = 2;
    const queueRatio = this._resultsQueue.length / Math.max(1, this._maxQueueLen);
    if (queueRatio > 0.55) dispatchPerTick = 0;
    else if (queueRatio > 0.35) dispatchPerTick = 1;
    let dispatches = 0;

    for (const body of list) {
      if (dispatchPerTick <= 0) break;
      if (this._resultsQueue.length >= this._maxQueueLen) break;
      if (!body?.grid?.cells || body.dead) continue;
      const count = body.grid.cells.length;
      if (count < minCells) continue;
      const grid = body.grid;
      if (grid.isSleeping && (grid.wakeHoldFrames | 0) <= 0) continue;

      const state = this._ensureBodyState(body, count);
      const forcedAwake = (body._gpuForceAwakeFrames | 0) > 0;
      if (state.isComputing) continue;
      if (!forcedAwake && state.dispatchCooldown > 0) {
        state.dispatchCooldown--;
        continue;
      }
      if (!this._isBodyHot(body, 36, hotThreshold)) {
        state.idleFrames = Math.min(120, (state.idleFrames | 0) + 1);
        state.dispatchCooldown = Math.min(24, 2 + ((state.idleFrames / 2) | 0));
        continue;
      }
      state.idleFrames = 0;

      let interval = count >= 2048 ? 3 : count >= 1024 ? 2 : 1;
      if (forcedAwake) interval = count >= 2400 ? 2 : 1;
      else {
        if (queueRatio > 0.2) interval += 1;
        if ((this._tickId % interval) !== 0) continue;
      }
      if (forcedAwake && (this._tickId % interval) !== 0) continue;

      this._dispatch(body, state, k, damping, config);
      state.dispatchCooldown = Math.max(0, interval - 1);
      dispatches++;
      if (dispatches >= dispatchPerTick) break;
    }
  },

  dispose() {
    for (const [, state] of this.bodyStates) this._destroyState(state);
    this.bodyStates.clear();
    this._resultsQueue.length = 0;
    this._arrayPool.length = 0;
  }
};
