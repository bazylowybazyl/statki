// Profil GPU na kernel (każdy dispatch we własnym przebiegu ze znacznikami czasu).
//   node scripts/belki-gpu-profil.mjs [--q "gs=0"]
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs } from './webgpu/wspolne.mjs';

const args = parseArgs();
const { server, base } = await startVite(5396);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ['--enable-webgpu-developer-features'] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const CASES = [
  { name: 'taran-120 (styk)', reset: `{ scene: 'ram', ramSpeed: 800, res: 120, wall: 0 }`, skip: 60, steps: 120 },
  { name: 'taran-480 (styk)', reset: `{ scene: 'ram', ramSpeed: 800, res: 480, wall: 0 }`, skip: 60, steps: 60 },
  { name: 'flota+tarany-120', reset: `{ scene: 'fleet-ram', res: 120, pairs: 6 }`, skip: 30, steps: 120 },
  { name: 'flota+tarany-240', reset: `{ scene: 'fleet-ram', res: 240, pairs: 6 }`, skip: 30, steps: 60 }
];
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/destruktor2d-webgpu.html${args.q ? '?' + args.q : ''}` });
  await waitFor(cdp, '!!(window.__gpu2d && window.__gpu2d.started)', 120000, 300);
  for (const c of CASES) {
    const r = await evaluate(cdp, `(async () => {
      const G = window.__gpu2d;
      G.setLoop(false);
      await G.reset(${c.reset});
      G.setLoop(false);
      const w = G.world;
      await G.benchSteps(${c.skip}, { batch: 2 });
      w.profile = true;
      w.profileAcc = {};
      let substeps = 0;
      for (let k = 0; k < ${c.steps}; k++) {
        const r = await G.benchSteps(1, { batch: 1 });
        substeps += r.times[0]?.substeps || 0;
        await w.collectProfile();
      }
      w.profile = false;
      return { acc: w.profileAcc, substeps, nodes: w.nodeCount, beams: w.beamCount };
    })()`, 900000);
    const rows = Object.entries(r.acc).map(([name, a]) => ({ name, perStep: a.ms / c.steps, perCall: a.ms / a.calls, calls: a.calls / c.steps }));
    rows.sort((a, b) => b.perStep - a.perStep);
    const total = rows.reduce((s, x) => s + x.perStep, 0);
    console.log(`\n=== ${c.name}: ${r.nodes} węzłów, ${r.beams} belek, podkroków/krok ${(r.substeps / c.steps).toFixed(2)}, suma ${total.toFixed(3)} ms/krok`);
    for (const x of rows) {
      console.log(`  ${x.name.padEnd(14)} ${x.perStep.toFixed(4).padStart(8)} ms/krok  ${(x.perStep / total * 100).toFixed(1).padStart(5)}%  ${x.perCall.toFixed(4)} ms × ${x.calls.toFixed(1)}`);
    }
  }
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
