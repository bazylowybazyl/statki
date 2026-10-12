// Porównanie CPU ↔ GPU na tej samej scenie taranu (ta sama strona, te same obrazy).
//   node scripts/belki-gpu-zgodnosc.mjs [--speed 800] [--res 120] [--pose 90] [--dummy atlas] [--t "0.25,0.5,1,2,3"]
//     [--warianty "lokalny=;pelny=solver=pelny;ref=@dema/destruktor2d-webgpu-ref.html"] [--cpu 0]
//   --warianty: warianty GPU „nazwa=parametry strony” rozdzielone „;” (parametry po „@strona?” albo samo zapytanie);
//               domyślnie jeden: bieżące demo bez parametrów. --cpu 0 — bez silnika CPU.
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs } from './webgpu/wspolne.mjs';

const args = parseArgs();
const speed = Number(args.speed || 800), res = Number(args.res || 120), pose = Number(args.pose || 90);
const dummy = args.dummy || 'atlas';
const marks = (args.t || '0.25,0.5,1,2,3').split(',').map(Number);
const withCpu = args.cpu !== '0';
const variants = (args.warianty || 'gpu=').split(';').filter(Boolean).map((v) => {
  const eq = v.indexOf('=');
  const name = v.slice(0, eq), spec = v.slice(eq + 1);
  let page = 'dema/destruktor2d-webgpu.html', q = spec;
  if (spec.startsWith('@')) { const [p, qq] = spec.slice(1).split('?'); page = p; q = qq || ''; }
  return { name, page, q };
});
const { server, base } = await startVite(5392);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ["--enable-webgpu-developer-features"] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const fmt = (b) => b ? `v=(${b.vx.toFixed(1)},${b.vy.toFixed(1)}) w=${(b.w ?? 0).toFixed(4)} akt=${b.active} disp=${b.dispMean.toFixed(3)}/${b.dispMax.toFixed(2)}` : '—';
const results = {};
try {
  for (const v of variants) {
    await cdp.send('Page.navigate', { url: `${base}/${v.page}${v.q ? '?' + v.q : ''}` });
    await waitFor(cdp, '!!(window.__gpu2d && (window.__gpu2d.started || window.__gpu2d.error))', 120000, 300);
    const script = `(async () => {
      const G = window.__gpu2d; G.setLoop(false);
      G.setPaused(true);
      const out = { gpu: [] };
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
      out.local = G.world.localStats ? G.world.localStats() : null;
      if (${withCpu && v === variants[0]}) {
        const m = await import('/dema/destruktor2d-webgpu/cpuReference.js');
        const atlasHull = await G.loadHull('atlas');
        const dummyHull = await G.loadHull('${dummy}');
        for (const local of [false, true]) {
          const sim = m.createCpuRam({ atlasHull, dummyHull, cellSize: 1800 / ${res}, frames: 2, bulkheads: 8, speed: ${speed},
            pose: ${pose} * Math.PI / 180, massMul: 1, local, cfg: { crushStrength: 300000, globalBreakMul: 0.6 } });
          let st = 0, ms = 0, n = 0;
          const key = local ? 'cpuLocal' : 'cpuFull';
          out[key] = [];
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
      }
      return out;
    })()`;
    const r = await evaluate(cdp, script, 1800000);
    results[v.name] = r.gpu;
    results[v.name].ms = r.gpuMsPerStep;
    results[v.name].local = r.local;
    if (r.cpuFull) { results.cpuFull = r.cpuFull; results.cpuFull.ms = r.cpuFullMs; results.cpuLocal = r.cpuLocal; results.cpuLocal.ms = r.cpuLocalMs; }
  }
  const keys = Object.keys(results);
  for (let k = 0; k < marks.length; k++) {
    console.log(`\n=== t = ${marks[k]} s ===`);
    for (const key of keys) {
      const r = results[key][k];
      const bodies = r.bodies;
      const wrecks = bodies.filter((b) => b.wreck && !b.dead).length;
      console.log(`${key.padEnd(9)} zerwania=${String(r.broken).padStart(5)} wraki=${wrecks}${r.nan ? ' NaN=' + r.nan : ''}`);
      console.log(`   Atlas: ${fmt(bodies[0])}`);
      console.log(`   kukła: ${fmt(bodies[1])}`);
    }
  }
  console.log('\nms/krok: ' + keys.map((k) => `${k} ${results[k].ms.toFixed(3)}`).join(', '));
  for (const k of keys) if (results[k].local) console.log(`obszar ${k}: ${JSON.stringify(results[k].local)}`);
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
