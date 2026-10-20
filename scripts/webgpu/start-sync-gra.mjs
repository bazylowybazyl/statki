// Pipeline'y SYNCHRONICZNE przy starcie gry — strona i WORKER renderu (2026-10-20, audyt
// docs/AUDYT-start-sync-worker-2026-10-20.md). `start-gry.mjs` liczy tylko stronę; w trybie worker grę rysuje
// worker, a jego pipeline'y sync w klatkach wypisuje dziennik workera („[render.worker] pipeline sync #n k=…:
// materiał @ obiekt”) — skrypt łapie konsolę workera przez CDP (`Target.setAutoAttach`, sesje płaskie).
//
//   node scripts/webgpu/start-sync-gra.mjs [--query renderWorker=1] [--ab <katalog oryginałów>] [--kolejnosc A,B,B,A]
//        [--stres <ms>] [--out .tmp/start-sync] [--port 5431]
//
// Przebieg: gra swobodna (bez kampanii), „Start” od razu po wstaniu strony (najgorszy przypadek: worker kończy kolejkę
// rozgrzewki razem z ekranem ładowania), potem 120 kroków harnessu. Wynik na przebieg: pipeline'y sync workera w klatkach
// (start, po 120 krokach) i strony (od wczytania, bez compute — w trybie off strona to render, z ekranem ładowania),
// czasy `flush` każdego przygotowania sceny workera (`[render.worker] przygotowanie …`), błędy.
// --ab: A/B wersji kodu w tym samym drzewie (vite.config.js: HULLFALL_AB_DIR — A = pliki z katalogu zamiast drzewa,
//   B = drzewo robocze), przebiegi w kolejności --kolejnosc (domyślnie ABBA), każdy na świeżym serwerze i profilu.
// --stres <ms>: każde zadanie kolejki rozgrzewki WORKERA dłuższe o <ms> (wolniejsza maszyna — kolejka nie zdąży przed
//   klatką zero): `Core3D.warmup._compileOne` z busy-wait, przez import modułu w sesji workera.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const AB = args.ab ? resolve(repo, args.ab) : null;
const order = String(args.kolejnosc || (AB ? 'A,B,B,A' : 'B')).split(',');
const query = args.query ? `&${args.query}` : '';
const stres = Math.max(0, Number(args.stres || 0));
const out = resolve(repo, args.out || '.tmp/start-sync');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const STRES_EXPR = `(async () => {
  const m = await import('/src/3d/core3d.js');
  const w = m.Core3D.warmup, orig = w._compileOne;
  w._compileOne = function (e, o) { const t = performance.now(); while (performance.now() - t < ${stres}); return orig.call(this, e, o); };
  console.log('[stres] kolejka rozgrzewki workera +${stres} ms na zadanie');
  return true;
})()`;
const results = [];

for (const [i, v] of order.entries()) {
  if (v === 'A' && AB) process.env.HULLFALL_AB_DIR = AB; else delete process.env.HULLFALL_AB_DIR;
  const { server, base } = await startVite(Number(args.port || 5431) + i);
  delete process.env.HULLFALL_AB_DIR;
  const chrome = await startChrome({ width: 1600, height: 900 });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 600000) => evaluate(cdp, e, t);
  const workerLogs = [];
  let msgId = 900000;
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget') {
      const sessionId = msg.params.sessionId;
      for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId }));
      // stres tylko w workerze renderu (inne workery gry — wypieki, olbrzymy pasa — bez Core3D)
      if (stres > 0 && /render\.worker/.test(msg.params.targetInfo?.url || '')) {
        cdp.ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.evaluate', sessionId, params: { expression: STRES_EXPR, awaitPromise: true } }));
      }
    }
    if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
      workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 4000));
    }
    if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
      workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 4000));
    }
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const syncWorker = () => workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
  const syncPage = () => ev(`(() => (window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))()`);
  const r = { wariant: v, przebieg: i, stres };
  const t0 = Date.now();
  try {
    await osobneLosowanieUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
      localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__harness && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
    await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
    r.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
    r.syncWorkerStart = syncWorker();
    r.syncStronaStart = await syncPage();
    await ev('window.__harness.hold(true)');
    await ev('window.__harness.step(120).then(() => true)');
    await sleep(1500);
    r.syncWorker120 = syncWorker();
    r.syncStrona120 = await syncPage();
    // przygotowania sceny workera: idle (menu), „Start”, po klatce zero — czas flush każdego
    r.flushWorker = workerLogs.filter((l) => l.includes('[render.worker] przygotowanie (afterFrame'))
      .map((l) => { const m = /afterFrame (true|false)\).*flush (\d+) ms/.exec(l); return m ? { poKlatceZero: m[1] === 'true', ms: Number(m[2]) } : null; }).filter(Boolean);
    r.stresWlaczony = workerLogs.some((l) => l.includes('[stres]'));
  } catch (e) {
    r.blad = String(e?.stack || e);
  } finally {
    r.s = Math.round((Date.now() - t0) / 1000);
    r.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 10);
    r.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 10);
    results.push(r);
    writeFileSync(join(out, `worker-${v}${i}.log`), workerLogs.join('\n'));
    console.log(`${v} ${i} (${r.tryb || '?'}${stres ? `, stres ${stres} ms${r.stresWlaczony ? '' : ' — NIE ZADZIAŁAŁ'}` : ''}): worker sync start ${r.syncWorkerStart?.length ?? '-'}, po 120 ${r.syncWorker120?.length ?? '-'}`
      + ` | strona sync ${r.syncStronaStart?.length ?? '-'}, po 120 ${r.syncStrona120?.length ?? '-'}`
      + ` | flush workera ${(r.flushWorker || []).map((f) => `${f.ms}${f.poKlatceZero ? '*' : ''}`).join(' / ') || '-'} ms | ${r.s} s`
      + (r.blad ? ` | BŁĄD ${r.blad.slice(0, 200)}` : '') + (r.bledyStrony.length || r.bledyWorkera.length ? ` | błędy: ${[...r.bledyStrony, ...r.bledyWorkera].slice(0, 3).join(' ; ')}` : ''));
    for (const [k, list] of [['worker', r.syncWorker120], ['strona', r.syncStrona120]]) if (list?.length) console.log(`   ${k}: ${list.join(' | ')}`);
    writeFileSync(join(out, 'wynik.json'), JSON.stringify(results, null, 1));
    await chrome.close();
    await server.close();
  }
}
console.log(`zapis: ${join(out, 'wynik.json')} (flush: * = przygotowanie po klatce zero)`);
process.exit(0);
