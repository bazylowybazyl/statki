import { AiKernel } from '../aiKernel.js';
import { SpscFloat64Ring, TripleFloat32Buffer } from '../sharedBuffers.js';

let kernel = null;
let snapshots = null;

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    const commandRing = new SpscFloat64Ring({ ...message.commandRing, initialize: false });
    snapshots = new TripleFloat32Buffer({ ...message.snapshots, initialize: false });
    kernel = new AiKernel({ ...message.kernelOptions, commandRing });
    self.postMessage({ type: 'ready' });
    return;
  }
  if (!kernel || message.type !== 'step') return;
  const latest = snapshots.readLatest();
  const perf = kernel.step(latest.page, latest.count, Number(message.tick) | 0);
  if ((Number(message.tick) & 31) === 0) self.postMessage({ type: 'perf', ...perf });
};
