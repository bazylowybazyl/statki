// Porównanie CPU ↔ GPU na tej samej scenie taranu (ta sama strona, te same obrazy).
//   node scripts/belki-gpu-zgodnosc.mjs [--speed 800] [--res 120] [--pose 90] [--dummy atlas] [--t "0.25,0.5,1,2,3"]
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs } from './webgpu/wspolne.mjs';

const args = parseArgs();
const speed = Number(args.speed || 800), res = Number(args.res || 120), pose = Number(args.pose || 90);
const dummy = args.dummy || 'atlas';
const marks = (args.t || '0.25,0.5,1,2,3').split(',').map(Number);
const { server, base } = await startVite(5392);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ["--enable-webgpu-developer-features"] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const fmt = (b) => b ? `v=(${b.vx.toFixed(0)},${b.vy.toFixed(0)}) w=${(b.w ?? 0).toFixed(3)} akt=${b.active} disp=${b.dispMean.toFixed(2)}/${b.dispMax.toFixed(1)}` : '—';
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/destruktor2d-webgpu.html` });
  await waitFor(cdp, '!!(window.__gpu2d && window.__gpu2d.started)', 120000, 300);
  const script = `(async () => {
    const G = window.__gpu2d; G.setLoop(false);
    G.setPaused(true);
    const out = { gpu: [], cpuFull: [], cpuLocal: [] };
    const marks = ${JSON.stringify(marks)};
    await G.reset({ scene: 'ram', ramSpeed: ${speed}, res: ${res}, pose: ${pose}, dummy: '${dummy}', wall: 0 });
    G.setPaused(true);
    let step = 0;
    let gpuMs = 0, gpuSteps = 0;
    for (const t of marks) {
      const target = Math.round(t * 120);
      const r = await G.benchSteps(target - step);
      step = target;
      for (const x of r.times) { gpuMs += x.ms; gpuSteps++; }
      const s = await G.readSummary();
      out.gpu.push({ t, bodies: s.bodies.map((b) => ({ ...b, w: b.w })), broken: s.counters[1], killed: s.counters[3], nan: s.nan });
    }
    out.gpuMsPerStep = gpuMs / Math.max(1, gpuSteps);
    const m = await import('/dema/destruktor2d-webgpu/cpuReference.js');
    const atlasHull = await G.loadHull('atlas');
    const dummyHull = await G.loadHull('${dummy}');
    for (const local of [false, true]) {
      const sim = m.createCpuRam({ atlasHull, dummyHull, cellSize: 1800 / ${res}, frames: 2, bulkheads: 8, speed: ${speed},
        pose: ${pose} * Math.PI / 180, massMul: 1, local, cfg: { crushStrength: 300000, globalBreakMul: 0.6 } });
      let st = 0, ms = 0, n = 0;
      const key = local ? 'cpuLocal' : 'cpuFull';
      for (const t of marks) {
        const target = Math.round(t * 120);
        const times = sim.step(target - st);
        st = target;
        for (const x of times) { ms += x.ms; n++; }
        const s = sim.summary();
        out[key].push({ t, bodies: s.bodies, broken: s.beamsBroken });
      }
      out[key + 'Ms'] = ms / Math.max(1, n);
    }
    return out;
  })()`;
  const res2 = await evaluate(cdp, script, 900000);
  for (let k = 0; k < marks.length; k++) {
    console.log(`\n=== t = ${marks[k]} s ===`);
    for (const key of ['gpu', 'cpuFull', 'cpuLocal']) {
      const r = res2[key][k];
      const bodies = r.bodies;
      const wrecks = bodies.filter((b) => b.wreck && !b.dead).length;
      console.log(`${key.padEnd(9)} zerwania=${String(r.broken).padStart(5)} wraki=${wrecks}${r.nan ? ' NaN=' + r.nan : ''}`);
      console.log(`   Atlas: ${fmt(bodies[0])}`);
      console.log(`   kukła: ${fmt(bodies[1])}`);
    }
  }
  console.log(`\nms/krok: GPU ${res2.gpuMsPerStep.toFixed(3)} (czas karty), CPU pełny ${res2.cpuFullMs.toFixed(3)}, CPU lokalny ${res2.cpuLocalMs.toFixed(3)}`);
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
