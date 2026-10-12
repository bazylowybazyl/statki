// GAZ-GPT na gospodarzu dok-k7-webgpu: jeden Core3D, Atlas, automat, lot i kamery hali.
import { Core3D } from '../src/3d/core3d.js';
import { HallGasBenchmark } from '../src/3d/hallGas/hallGasBenchmark.js';
const params = new URLSearchParams(location.search);
window.__dokExtension = {
  async init(dok) {
    const benchmark = new HallGasBenchmark(Number(params.get('komorka') || 48));
    window.__gaz = { name: 'GAZ-GPT', stage: 'E0', benchmark, on: false, dok };
    Core3D.addFxStep({ name: 'gaz hali E0', update: (ctx) => { if (window.__gaz.on) benchmark.step(ctx.renderer); },
      warm: (ctx) => benchmark.warm(ctx.renderer) });
    await Core3D.warmup.flush();
  }
};
await import('./dok-k7-webgpu.js');
