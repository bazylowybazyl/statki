import { PhysicsKernel } from '../physicsKernel.js';
import { SpscFloat64Ring, TripleFloat32Buffer } from '../sharedBuffers.js';

let kernel = null;
let commandRing = null;
let aiCommandRing = null;
let snapshots = null;
let aiSnapshots = null;

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    commandRing = new SpscFloat64Ring({
      ...message.commandRing,
      initialize: false
    });
    const eventRing = new SpscFloat64Ring({
      ...message.eventRing,
      initialize: false
    });
    aiCommandRing = message.aiCommandRing
      ? new SpscFloat64Ring({ ...message.aiCommandRing, initialize: false })
      : null;
    snapshots = new TripleFloat32Buffer({
      ...message.snapshots,
      initialize: false
    });
    aiSnapshots = message.aiSnapshots
      ? new TripleFloat32Buffer({ ...message.aiSnapshots, initialize: false })
      : null;
    kernel = new PhysicsKernel({ ...message.kernelOptions, eventRing });
    self.postMessage({ type: 'ready' });
    return;
  }
  if (!kernel) return;
  if (message.type === 'spawn-body') {
    const slot = kernel.spawnBody(message.initial);
    self.postMessage({ type: 'body-spawned', requestId: message.requestId, slot, generation: slot >= 0 ? kernel.bodyGeneration[slot] : 0 });
    return;
  }
  if (message.type === 'attach-hex-body') {
    const record = kernel.attachHexBody(message.slot, message.initial);
    self.postMessage({ type: 'hex-body-attached', requestId: message.requestId, ok: !!record });
    return;
  }
  if (message.type === 'step') {
    kernel.drainCommands(commandRing);
    kernel.drainAiCommands(aiCommandRing);
    let tick = Number(message.tick) | 0;
    const count = Math.max(1, Number(message.count) | 0);
    for (let step = 0; step < count; step++) kernel.step(message.dt, tick + step, message.budgetPressure);
    const write = snapshots.beginWrite();
    const bodyCount = kernel.writeBodySnapshot(write.page);
    snapshots.publish(write.pageIndex, tick + count - 1, bodyCount);
    if (aiSnapshots) {
      const aiWrite = aiSnapshots.beginWrite();
      const aiCount = kernel.writeAiSnapshot(aiWrite.page);
      aiSnapshots.publish(aiWrite.pageIndex, tick + count - 1, aiCount);
    }
    if (((tick + count - 1) & 31) === 0) {
      self.postMessage({ type: 'perf', tick: tick + count - 1, ...kernel.perf });
    }
  }
};
