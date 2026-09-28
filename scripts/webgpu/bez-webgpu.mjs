// Gra bez WebGPU (zadanie 23, krok 8): menu pokazuje „Gra wymaga przeglądarki z WebGPU”, przyciski startu
// wyłączone, Core3D.ready → false, bez renderera (gra nie startuje na zapasie WebGL2 — PLAN §12 p. 2).
//
//   node scripts/webgpu/bez-webgpu.mjs [--wariant flagi|bez-api|bez-adaptera|wszystkie] [--port 5352]
//        [--root <drzewo gry>] [--png katalog]
//
// Warianty (Chrome bez flag włączających WebGPU, które startChrome dokłada domyślnie):
//   flagi         — --disable-webgpu --disable-features=WebGPU --disable-gpu (Chrome 153 zostawia `navigator.gpu`,
//                   ale bez procesu GPU nie daje adaptera; z flagami startChrome włączającymi WebGPU —
//                   --enable-unsafe-webgpu — samo --disable-webgpu nie działa: adapter i renderer powstają);
//   bez-api       — przeglądarka bez WebGPU: `navigator.gpu` = undefined (skrypt przed skryptami strony);
//   bez-adaptera  — WebGPU jest, ale bez adaptera (czarna lista sterownika): requestAdapter() → null.
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5352);
const serveRoot = args.root ? resolve(args.root) : repo;
const WARIANTY = {
  flagi: { flagi: ['--disable-webgpu', '--disable-features=WebGPU', '--disable-gpu'], skrypt: '' },
  'bez-api': { flagi: [], skrypt: `Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });` },
  'bez-adaptera': { flagi: [], skrypt: `if (navigator.gpu) { const g = Object.getPrototypeOf(navigator.gpu); g.requestAdapter = async () => null; }` }
};
const wybrane = !args.wariant || args.wariant === 'wszystkie' ? Object.keys(WARIANTY) : String(args.wariant).split(',');

async function startServer() {
  if (serveRoot === repo) return startVite(port);
  const { createServer } = await import('vite');
  const srv = await createServer({ root: serveRoot, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await srv.listen();
  return { server: srv, base: `http://localhost:${srv.httpServer.address().port}` };
}

const { server, base } = await startServer();
let ok = true;
try {
  for (const nazwa of wybrane) {
    const w = WARIANTY[nazwa];
    if (!w) throw new Error(`nieznany wariant ${nazwa}`);
    const chrome = await startChrome({ width: 1280, height: 720, webgpu: false, extraArgs: w.flagi });
    const logs = await attachLogs(chrome);
    const { cdp } = chrome;
    const ev = (e, t = 60000) => evaluate(cdp, e, t);
    const wynik = {};
    try {
      if (w.skrypt) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: w.skrypt });
      await cdp.send('Page.navigate', { url: `${base}/index.html` });
      // Core3D.ready (obietnica) rozstrzyga się po requestAdapter — bez adaptera false, menu dokłada komunikat
      wynik.komunikatPo = await waitFor(cdp, '!!document.getElementById("mm-webgpu-required")', 30000, 250) ? 'jest' : 'brak po 30 s';
      await sleep(1000);
      Object.assign(wynik, await ev(`(async () => {
        const txt = document.body.innerText || '';
        const ready = await Promise.race([window.Core3D?.ready, new Promise((ok) => setTimeout(() => ok('czeka'), 3000))]);
        return {
          navigatorGpu: !!navigator.gpu,
          ready,
          gpuReady: window.Core3D?.gpuReady,
          renderer: !!window.Core3D?.renderer,
          komunikat: /Gra wymaga przeglądarki z WebGPU/.test(txt),
          przyciskiWylaczone: ['btn-new-game', 'btn-mode-single', 'btn-mode-split'].every((id) => !document.getElementById(id) || document.getElementById(id).disabled)
        }; })()`));
      wynik.bledy = logs.errors().filter((l) => !/favicon/.test(l)).slice(0, 10);
      wynik.ostrzezenia = logs.all().filter((l) => /WebGPU/.test(l)).slice(0, 5);
      if (args.png) { const dir = resolve(args.png); mkdirSync(dir, { recursive: true }); await screenshotPng(cdp, join(dir, `bez-webgpu-${nazwa}.png`)); }
      // Oczekiwane tam, gdzie przeglądarka naprawdę nie ma WebGPU (albo adaptera): komunikat, bez renderera.
      const bezGpu = !wynik.navigatorGpu || nazwa === 'bez-adaptera' || wynik.ready === false;
      wynik.ocena = bezGpu
        ? (wynik.komunikat && wynik.ready === false && !wynik.renderer && wynik.przyciskiWylaczone ? 'OK' : 'BŁĄD')
        : 'WebGPU dostępne mimo flag — wariant niemiarodajny';
      if (wynik.ocena === 'BŁĄD') ok = false;
    } finally {
      await chrome.close();
    }
    console.log(`== ${nazwa}: ${wynik.ocena} | navigator.gpu ${wynik.navigatorGpu}, ready ${wynik.ready}, renderer ${wynik.renderer}, komunikat ${wynik.komunikat}, przyciski wyłączone ${wynik.przyciskiWylaczone}${wynik.bledy.length ? ' | konsola: ' + [...new Set(wynik.bledy)].join(' ; ') : ''}`);
  }
} catch (err) {
  console.log('BŁĄD', err?.stack || err);
  ok = false;
} finally {
  await server.close();
}
process.exit(ok ? 0 : 1);
