// Oś czasu taranu na GPU: ms/krok, podkroki, obszar solvera lokalnego, kandydaci, zerwania — co --co kroków.
//   node scripts/belki-gpu-os.mjs [--res 1800] [--kroki 360] [--co 12] [--q "solver=pelny"] [--strona dema/…html]
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs } from './webgpu/wspolne.mjs';

const args = parseArgs();
const res = Number(args.res || 1800), steps = Number(args.kroki || 360), every = Number(args.co || 12);
const page = args.strona || 'dema/destruktor2d-webgpu.html';
const { server, base } = await startVite(5397);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ['--enable-webgpu-developer-features'] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
try {
  await cdp.send('Page.navigate', { url: `${base}/${page}${args.q ? '?' + args.q : ''}` });
  await waitFor(cdp, '!!(window.__gpu2d && (window.__gpu2d.started || window.__gpu2d.error))', 180000, 300);
  const r = await evaluate(cdp, `(async () => {
    const G = window.__gpu2d;
    G.setLoop(false);
    const reset = () => G.reset({ scene: 'ram', ramSpeed: 800, res: ${res}, pose: 90, dummy: 'atlas', wall: 0 });
    await reset(); G.setLoop(false);
    await G.benchSteps(20, { batch: 2 });
    await reset(); G.setLoop(false);
    const r = await G.benchSteps(${steps}, { batch: 2 });
    const s = await G.readSummary();
    return { times: r.times, end: { broken: s.counters[1], bodies: s.bodies.filter((b) => !b.dead).length, wrecks: s.bodies.filter((b) => b.wreck && !b.dead).length } };
  })()`, 1800000);
  let total = 0;
  for (let k = 0; k < r.times.length; k += every / 2) {
    const w = r.times.slice(k, k + every / 2);
    if (!w.length) break;
    const ms = w.reduce((a, x) => a + x.ms, 0) / w.length;
    const mx = Math.max(...w.map((x) => x.ms));
    const last = w[w.length - 1];
    const l = last.local;
    console.log(`t ${(last.tick / 120).toFixed(2)} s  ms/krok ${ms.toFixed(2).padStart(6)} (maks ${mx.toFixed(1).padStart(5)})  podkroki ${last.substeps}` +
      (l ? `  A ${String(l.maxA).padStart(7)}  A∪F ${String(l.maxS).padStart(7)}  belki ${String(l.maxBeams).padStart(8)}  kand ${String(l.maxCand).padStart(7)}` : '') +
      `  zerwania ${last.broken}  kontakty ${last.contacts}`);
  }
  for (const x of r.times) total += x.ms;
  console.log(`średnio ${(total / r.times.length).toFixed(2)} ms/krok; koniec: ${JSON.stringify(r.end)}`);
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
