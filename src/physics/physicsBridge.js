import { PhysicsKernel } from './physicsKernel.js';
import { AiKernel } from './aiKernel.js';
import { SpscFloat64Ring, TripleFloat32Buffer } from './sharedBuffers.js';
import {
  BODY_SNAPSHOT_STRIDE,
  AI_COMMAND_STRIDE,
  AI_SNAPSHOT_STRIDE,
  COMMAND_STRIDE,
  EVENT_STRIDE,
  PHYSICS_COMMAND,
  SIM_TICK_HZ
} from './protocol.js';

function canUseSharedWorker() {
  return typeof Worker === 'function' &&
    typeof SharedArrayBuffer === 'function' &&
    (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated === true);
}

export class PhysicsBridge {
  constructor(options = {}) {
    this.maxBodies = Math.max(8, Number(options.maxBodies) | 0 || 4096);
    this.useWorker = options.useWorker !== false && canUseSharedWorker();
    // The non-isolated browser fallback must not allocate SharedArrayBuffer.
    const useSharedBuffers = this.useWorker;
    this.commandRing = new SpscFloat64Ring({
      capacity: options.commandCapacity || 16384,
      stride: COMMAND_STRIDE,
      shared: useSharedBuffers
    });
    this.eventRing = new SpscFloat64Ring({
      capacity: options.eventCapacity || 16384,
      stride: EVENT_STRIDE,
      shared: useSharedBuffers
    });
    this.aiCommandRing = new SpscFloat64Ring({
      capacity: options.aiCommandCapacity || 8192,
      stride: AI_COMMAND_STRIDE,
      shared: useSharedBuffers
    });
    this.snapshots = new TripleFloat32Buffer({
      length: this.maxBodies * BODY_SNAPSHOT_STRIDE,
      shared: useSharedBuffers
    });
    this.aiSnapshots = new TripleFloat32Buffer({
      length: this.maxBodies * AI_SNAPSHOT_STRIDE,
      shared: useSharedBuffers
    });
    this.kernelOptions = {
      maxBodies: this.maxBodies,
      maxProjectiles: options.maxProjectiles || 65536,
      hexCapacity: options.hexCapacity || 131072,
      scheduler: options.scheduler
    };
    this.worker = null;
    this.aiWorker = null;
    this.kernel = null;
    this.aiKernel = null;
    this.ready = false;
    this.physicsReady = false;
    this.aiReady = false;
    this.requestId = 1;
    this.pending = new Map();
    this.eventScratch = new Float64Array(EVENT_STRIDE);
    this.commandScratch = new Float64Array(COMMAND_STRIDE);
    this.lastWorkerPerf = null;

    if (this.useWorker) this._startWorker();
    else {
      this.kernel = new PhysicsKernel({ ...this.kernelOptions, eventRing: this.eventRing, sharedArena: false });
      this.aiKernel = new AiKernel({ maxEntities: this.maxBodies, commandRing: this.aiCommandRing });
      this.physicsReady = true;
      this.aiReady = true;
      this.ready = true;
    }
  }

  _startWorker() {
    this.worker = new Worker(new URL('./workers/physics.worker.js', import.meta.url), { type: 'module', name: 'physics-owner' });
    this.worker.onmessage = (event) => this._onWorkerMessage(event.data || {}, 'physics');
    this.worker.onerror = (error) => {
      this.lastError = error;
    };
    this.worker.postMessage({
      type: 'init',
      commandRing: { buffer: this.commandRing.buffer, capacity: this.commandRing.capacity, stride: this.commandRing.stride },
      eventRing: { buffer: this.eventRing.buffer, capacity: this.eventRing.capacity, stride: this.eventRing.stride },
      snapshots: { buffer: this.snapshots.buffer, length: this.snapshots.length },
      aiCommandRing: { buffer: this.aiCommandRing.buffer, capacity: this.aiCommandRing.capacity, stride: this.aiCommandRing.stride },
      aiSnapshots: { buffer: this.aiSnapshots.buffer, length: this.aiSnapshots.length },
      kernelOptions: this.kernelOptions
    });
    this.aiWorker = new Worker(new URL('./workers/ai.worker.js', import.meta.url), { type: 'module', name: 'ai-control' });
    this.aiWorker.onmessage = (event) => this._onWorkerMessage(event.data || {}, 'ai');
    this.aiWorker.onerror = (error) => { this.lastAiError = error; };
    this.aiWorker.postMessage({
      type: 'init',
      commandRing: { buffer: this.aiCommandRing.buffer, capacity: this.aiCommandRing.capacity, stride: this.aiCommandRing.stride },
      snapshots: { buffer: this.aiSnapshots.buffer, length: this.aiSnapshots.length },
      kernelOptions: { maxEntities: this.maxBodies }
    });
  }

  _onWorkerMessage(message, owner) {
    if (message.type === 'ready') {
      if (owner === 'ai') this.aiReady = true;
      else this.physicsReady = true;
      this.ready = this.physicsReady && this.aiReady;
      return;
    }
    if (message.type === 'perf') {
      if (owner === 'ai') this.lastAiPerf = message;
      else this.lastWorkerPerf = message;
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.resolve(message);
  }

  _request(type, payload) {
    if (!this.useWorker) return Promise.resolve(null);
    const requestId = this.requestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ type, requestId, ...payload });
    });
  }

  async spawnBody(initial) {
    if (!this.useWorker) {
      const slot = this.kernel.spawnBody(initial);
      return { slot, generation: slot >= 0 ? this.kernel.bodyGeneration[slot] : 0 };
    }
    return this._request('spawn-body', { initial });
  }

  async attachHexBody(slot, initial) {
    if (!this.useWorker) return { ok: !!this.kernel.attachHexBody(slot, initial) };
    return this._request('attach-hex-body', { slot, initial });
  }

  enqueueCommand(type, slot, generation, payload = []) {
    const command = this.commandScratch;
    command.fill(0);
    command[0] = type;
    command[1] = this.snapshots.readLatest().tick;
    command[2] = slot;
    command[3] = generation;
    const count = Math.min(payload.length, command.length - 4);
    for (let field = 0; field < count; field++) command[field + 4] = Number(payload[field]) || 0;
    return this.commandRing.push(command);
  }

  setBodyState(slot, generation, state) {
    return this.enqueueCommand(PHYSICS_COMMAND.SET_BODY_STATE, slot, generation, [
      state.x, state.y, state.vx, state.vy, state.angle, state.angVel,
      state.flags, state.distance, state.timeToContact
    ]);
  }

  spawnProjectile(ownerSlot, initial) {
    return this.enqueueCommand(PHYSICS_COMMAND.SPAWN_PROJECTILE, ownerSlot, 0, [
      initial.x, initial.y, initial.vx, initial.vy, initial.radius,
      initial.damage, initial.life, initial.penetration
    ]);
  }

  step(tick, count = 1, budgetPressure = 0, dt = 1 / SIM_TICK_HZ) {
    if (this.useWorker) {
      if (!this.ready) return false;
      this.worker.postMessage({ type: 'step', tick, count, budgetPressure, dt });
      this.aiWorker.postMessage({ type: 'step', tick: tick + count - 1 });
      return true;
    }
    this.kernel.drainCommands(this.commandRing);
    this.kernel.drainAiCommands(this.aiCommandRing);
    for (let index = 0; index < count; index++) this.kernel.step(dt, tick + index, budgetPressure);
    const write = this.snapshots.beginWrite();
    const bodyCount = this.kernel.writeBodySnapshot(write.page);
    this.snapshots.publish(write.pageIndex, tick + count - 1, bodyCount);
    const aiWrite = this.aiSnapshots.beginWrite();
    const aiCount = this.kernel.writeAiSnapshot(aiWrite.page);
    this.aiSnapshots.publish(aiWrite.pageIndex, tick + count - 1, aiCount);
    this.lastAiPerf = this.aiKernel.step(aiWrite.page, aiCount, tick + count - 1);
    return true;
  }

  readLatestSnapshot() {
    return this.snapshots.readLatest();
  }

  drainEvents(visitor, limit = 4096) {
    let count = 0;
    while (count < limit && this.eventRing.pop(this.eventScratch)) {
      visitor(this.eventScratch);
      count++;
    }
    return count;
  }

  getStats() {
    const snapshot = this.snapshots.readLatest();
    return {
      mode: this.useWorker ? 'worker-sab' : 'main-fallback',
      ready: this.ready,
      snapshotSequence: snapshot.sequence,
      snapshotTick: snapshot.tick,
      bodyCount: snapshot.count,
      commandBacklog: this.commandRing.size,
      commandDropped: this.commandRing.dropped,
      eventBacklog: this.eventRing.size,
      eventDropped: this.eventRing.dropped,
      aiCommandBacklog: this.aiCommandRing.size,
      aiCommandDropped: this.aiCommandRing.dropped,
      workerPerf: this.lastWorkerPerf,
      aiPerf: this.lastAiPerf || null,
      error: this.lastError || this.lastAiError || null
    };
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    if (this.aiWorker) this.aiWorker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('PhysicsBridge disposed'));
    this.pending.clear();
    this.ready = false;
  }
}

export function createPhysicsBridge(options) {
  return new PhysicsBridge(options);
}
