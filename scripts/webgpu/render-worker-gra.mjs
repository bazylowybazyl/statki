// scripts/webgpu/render-worker-gra.mjs — gra w trybie `?renderWorker=1` (docs/PLAN-render-worker.md, RW-40 / RW-44):
// start (swobodna albo podzielony ekran), kilka sekund gry, stan workera z kanału zwrotnego i strony
// (`window.RenderWorkerHost`: złożenia, ostatnio odebrana / narysowana strona, błędy, CPU klatki workera), błędy
// konsoli strony i workera (sesje workerów przez Target.setAutoAttach), zrzut ekranu.
//   node scripts/webgpu/render-worker-gra.mjs [--start single|split] [--czas 10] [--out .tmp/rw40/gra] [--port 5352]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, evaluate, sleep, repo, startChrome, parseArgs, attachLogs, waitFor, screenshotPng } from './wspolne.mjs';

const args = parseArgs();
const START = args.start || 'single';
const SECONDS = Number(args.czas || 10);
const OUT = resolve(repo, args.out || '.tmp/rw40/gra');
const PORT = Number(args.port || 5352);
mkdirSync(OUT, { recursive: true });

const vite = await startVite(PORT);
const chrome = await startChrome({ width: 1600, height: 900 });
const { cdp, logs } = chrome;
await attachLogs(chrome);
const workerLogs = [];
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sid = msg.params.sessionId;
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.enable', sessionId: sid }));
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.runIfWaitingForDebugger', sessionId: sid }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: "try { localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0'); } catch (_) {}"
});
const report = { start: START, seconds: SECONDS };
try {
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/index.html?dev=1&renderWorker=1` });
  await waitFor(cdp, '!!(window.DevScene && window.Core3D && window.Core3D.isInitialized)', 120000);
  await waitFor(cdp, '!!window.RenderWorkerHost', 60000);
  await sleep(4000);
  if (START === 'split') await evaluate(cdp, '(() => { window.DevScene.startSplit(); return true; })()');
  else await evaluate(cdp, "(() => { document.getElementById('btn-mode-single')?.click(); return true; })()");
  const t0 = Date.now();
  const read = () => evaluate(cdp, `(() => {
    const h = window.RenderWorkerHost; if (!h) return null;
    h.readStats();
    const R = window.__rwRet || null;
    return { ready: h.ready, failed: h.failed, composed: h.composed, lastPosted: h.lastPostedK, lastCommitted: h.lastCommittedK,
      consumed: h.lastConsumed(), errors: h.errors.slice(0, 10), cpuFrame: h.stats[6], cpuUpdate: h.stats[4], cpuRender: h.stats[5],
      ring: { full: h.ring.full, misses: h.ring.misses, guardMax: h.ring.guardMax },
      game: { started: !!window.gameStarted, split: !!window.splitScreenMode } };
  })()`);
  const samples = [];
  while (Date.now() - t0 < SECONDS * 1000 + 8000) {
    await sleep(2000);
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...(await read()) });
  }
  report.samples = samples;
  await screenshotPng(cdp, join(OUT, `${START}.png`));
} catch (err) {
  report.error = String(err?.stack || err);
}
report.pageErrors = logs.filter((l) => /error|exception/i.test(l)).slice(0, 30);
report.workerLogs = workerLogs.slice(0, 40);
writeFileSync(join(OUT, `${START}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ last: report.samples?.[report.samples.length - 1], pageErrors: report.pageErrors.length, workerLogs: report.workerLogs.length, error: report.error }, null, 1));
await chrome.close();
await vite.close?.();
process.exit(0);
