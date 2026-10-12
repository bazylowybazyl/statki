// Ostrzał bez styku (laser albo rakiety co N kroków) — koszt GPU i skutek (zerwania, zniszczone węzły).
//   node scripts/belki-gpu-ostrzal.mjs [--res 1200] [--kroki 240] [--co 4] [--rodzaj 0|1]
//     [--warianty "lokalny=solver=lokalny;pelny=solver=pelny;ref=@dema/destruktor2d-webgpu-ref.html"]
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs } from './webgpu/wspolne.mjs';

const args = parseArgs();
const res = Number(args.res || 1200), steps = Number(args.kroki || 240), every = Number(args.co || 4), kind = Number(args.rodzaj || 0);
const variants = (args.warianty || 'lokalny=solver=lokalny;pelny=solver=pelny').split(';').filter(Boolean).map((v) => {
  const eq = v.indexOf('=');
  const name = v.slice(0, eq), spec = v.slice(eq + 1);
  let page = 'dema/destruktor2d-webgpu.html', q = spec;
  if (spec.startsWith('@')) { const [p, qq] = spec.slice(1).split('?'); page = p; q = qq || ''; }
  return { name, page, q };
});
const { server, base } = await startVite(5402);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ['--enable-webgpu-developer-features'] });
const logs = await attachLogs(chrome);
try {
  for (const v of variants) {
    await chrome.cdp.send('Page.navigate', { url: `${base}/${v.page}${v.q ? '?' + v.q : ''}` });
    await waitFor(chrome.cdp, '!!(window.__gpu2d && (window.__gpu2d.started || window.__gpu2d.error))', 180000, 300);
    const r = await evaluate(chrome.cdp, `(async () => {
      const G = window.__gpu2d; G.setLoop(false);
      const reset = () => G.reset({ scene: 'ram', ramSpeed: 0, res: ${res}, pose: 90, dummy: 'atlas', wall: 0 });
      await reset(); G.setLoop(false);
      await G.benchSteps(20, { batch: 2, fireEvery: ${every}, fireKind: ${kind} });
      await reset(); G.setLoop(false);
      const r = await G.benchSteps(${steps}, { batch: 2, fireEvery: ${every}, fireKind: ${kind} });
      const v = r.times.map((t) => t.ms).sort((a, b) => a - b);
      const s = await G.readSummary();
      return { mean: v.reduce((a, b) => a + b, 0) / v.length, p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1],
        broken: s.counters[1], killed: s.counters[3], hits: s.counters[${kind === 0 ? 4 : 5}], local: G.world.localStats ? G.world.localStats() : null };
    })()`, 1800000);
    console.log(`${v.name.padEnd(8)} ms/krok ${r.mean.toFixed(3)} p95 ${r.p95.toFixed(3)} maks ${r.max.toFixed(3)} | zerwania ${r.broken}, węzły zniszczone ${r.killed}, trafienia ${r.hits}` +
      (r.local ? ` | obszar A∪F maks ${r.local.maxS} śr. ${r.local.meanS}` : ''));
  }
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
