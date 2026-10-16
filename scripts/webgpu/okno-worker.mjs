// Tryb worker w PRAWDZIWYM oknie (vsync, bez headless): gra swobodna, N s gry, rozkład okresów rAF strony, złożenia
// obrazu workera na sekundę, chybienia pierścienia nakładek, opóźnienie strony → złożenie (lastPosted − lastComposed).
//   node scripts/webgpu/okno-worker.mjs [--czas 20] [--query renderWorker=1] [--zoom 0.45]
import { createServer } from 'vite';
import { parseArgs, startChrome, waitFor, evaluate, sleep, repo } from './wspolne.mjs';
const args = parseArgs();
const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5390, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1280, height: 720, headless: false, renderMode: 'worker' });
const { cdp } = chrome;
const ev = (e) => evaluate(cdp, e, 60000);
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0'); } catch (_) {}" });
  await cdp.send('Page.navigate', { url: `${base}/index.html?${args.query || 'renderWorker=1'}` });
  if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 120000, 100)) throw new Error('menu');
  await sleep(1500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); setTimeout(() => document.getElementById('btn-mode-single')?.click(), 600); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId | 0) > 60', 120000, 100)) throw new Error('gra');
  if (args.zoom) await ev(`(() => { window.camera.targetZoom = ${Number(args.zoom)}; return true; })()`);
  await sleep(2000);
  const sec = Number(args.czas || 20);
  const r = await ev(`new Promise((ok) => {
    const H = window.RenderWorkerHost, per = [], lagK = [];
    const c0 = H ? H.composed : 0, m0 = H ? H.ring.misses : 0, t0 = performance.now();
    let last = t0;
    const f = (t) => { per.push(t - last); last = t; if (H) lagK.push(H.lastPostedK - H.ring.lastComposed);
      if (t - t0 < ${sec} * 1000) requestAnimationFrame(f); else {
        per.sort((a, b) => a - b); const q = (p) => +per[Math.min(per.length - 1, Math.floor(p * per.length))].toFixed(2);
        lagK.sort((a, b) => a - b);
        ok({ klatki: per.length, okresP50: q(0.5), okresP95: q(0.95), okresP99: q(0.99), okresMaks: q(1), ponad25: per.filter((x) => x > 25).length,
          zlozeniaNaS: H ? +((H.composed - c0) / ${sec}).toFixed(1) : null, chybienia: H ? H.ring.misses - m0 : null,
          zaleganieStronP50: lagK.length ? lagK[lagK.length >> 1] : null, zaleganieMaks: lagK.length ? lagK[lagK.length - 1] : null,
          tryb: window.__renderModeBoot && window.__renderModeBoot.mode, bledy: H ? H.errors.slice(0, 5) : [] });
      } };
    requestAnimationFrame(f);
  })`);
  console.log(JSON.stringify(r));
} catch (err) { console.error(String(err)); }
await chrome.close(); await server.close(); process.exit(0);
