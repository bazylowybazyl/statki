// Profil CPU WYBRANYCH klatek gry (zadanie 23): pierwsze klatki po starcie, klatka pierwszego wejścia
// w pole / w pobliże Marsa itp. — przestoje, których mediana nie widzi. Harness zrzutów (zegar, ziarna)
// + CDP Profiler przez console.profile / console.profileEnd owinięte wokół wywołań rAF strony: profil
// dokładnie jednej klatki (Profiler.consoleProfileFinished), bez szumu ekranu ładowania.
//
//   node scripts/webgpu/profil-klatek.mjs [--klatki 1,2,9] [--po "<js po starcie gry>"] [--port 5348] [--out plik.json]
//        [--root <drzewo gry>] [--glebia 4] [--query "haloTest=mars&haloAt=port"] [--prog 30]
//
// --klatki: numery klatek gry (__frameId przed klatką: 0 = pierwsza klatka gry) do profilu;
// --po:     JS w stronie po starcie gry (np. teleport do Marsa), potem profil kolejnych --klatki od tej chwili
//           (numery liczone od klatki po wykonaniu --po: 0 = pierwsza klatka po nim);
// --query:  dodatkowe parametry adresu gry (np. start przy porcie Marsa: haloTest=mars&haloAt=port);
// --prog:   z --po — zamiast stałych numerów profil KAŻDEJ klatki z listy, ale wypisane tylko te ≥ prog ms
//           (przestoje w pierwszych klatkach po zdarzeniu);
// wynik: czas klatki, self-time funkcji i drzewo od góry (ms) na klatkę.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5348);
const klatki = String(args.klatki || '0,1,2,8,9').split(',').map(Number).filter(Number.isFinite);
const glebia = Math.max(1, Number(args.glebia || 4));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const serveRoot = args.root ? resolve(args.root) : repo;
async function startServer() {
  if (serveRoot === repo) return startVite(port);
  const { createServer } = await import('vite');
  const srv = await createServer({ root: serveRoot, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await srv.listen();
  return { server: srv, base: `http://localhost:${srv.httpServer.address().port}` };
}

// Owinięcie rAF strony: profil klatek o numerach z listy (względem bazy __frameId).
const HOOK = `(() => {
  const want = new Set(window.__profilKlatki || []);
  const base = () => window.__profilBaza || 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const f = (window.__frameId | 0) - base();
    // tylko pętla gry (loop w index.html) — nie tło menu i inne rAF
    const on = cb.name === 'loop' && window.__profilWlaczony && want.has(f) && !window.__profilZrobione?.has(f);
    const t0 = performance.now();
    if (on) console.profile('klatka-' + f);
    try { cb(ts); } finally {
      if (on) { console.profileEnd('klatka-' + f); (window.__profilZrobione ||= new Set()).add(f); (window.__profilCzasy ||= {})[f] = (window.__harness ? window.__harness.realNow() : performance.now()) - (window.__harness ? 0 : 0); }
    }
  });
  return true; })()`;

const { server, base } = await startServer();
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const profile = new Map();
cdp.on((msg) => {
  if (msg.method === 'Profiler.consoleProfileFinished') profile.set(msg.params.title, msg.params.profile);
});
const wynik = { klatki, root: serveRoot, when: new Date().toISOString(), profile: {} };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${args.query ? '&' + args.query : ''}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.__profilKlatki = ${JSON.stringify(klatki)}; window.__profilWlaczony = ${args.po ? 'false' : 'true'}; return true; })()`);
  await ev(HOOK);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (args.po) {
    if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y');
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; ${args.po}; window.__profilBaza = (window.__frameId | 0); window.__profilZrobione = new Set(); window.__profilWlaczony = true; return true; })()`);
    const last = Math.max(...klatki);
    await waitFor(cdp, `(window.__frameId | 0) - window.__profilBaza > ${last + 2}`, 120000, 100);
  }
  await sleep(1500);
  for (const f of klatki) {
    const p = profile.get(`klatka-${f}`);
    if (!p) { console.log(`klatka ${f}: brak profilu`); continue; }
    const a = analyze(p);
    wynik.profile[f] = a;
    if (args.prog && a.ms < Number(args.prog)) { console.log(`klatka ${f}: ${a.ms} ms`); continue; }
    console.log(`\n== klatka ${f}: ${a.ms} ms (próbki: ${a.samples})`);
    for (const l of a.drzewo.slice(0, 60)) console.log('  ' + l);
    console.log('  -- self:');
    for (const [v, k] of a.self.slice(0, 15)) console.log(`    ${v}  ${k}`);
  }
  wynik.bledy = logs.errors().slice(0, 20);
} catch (err) {
  wynik.blad = String(err?.stack || err);
  console.log('BŁĄD', wynik.blad);
} finally {
  await chrome.close();
  await server.close();
}
if (args.out) {
  const out = resolve(repo, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(wynik, null, 2) + '\n');
  console.log('zapisano', out);
}
process.exit(wynik.blad ? 1 : 0);

function analyze(profile) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  const { samples, timeDeltas } = profile;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const d = (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000; nodes.get(samples[i]).self += d; sum += d; }
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  const roots = [...nodes.values()].filter((n) => !n.parent);
  for (const r of roots) totalOf(r);
  const nameOf = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const self = new Map();
  for (const n of nodes.values()) { const k = nameOf(n); self.set(k, (self.get(k) || 0) + n.self); }
  const out = [];
  const walk = (list, d, indent) => {
    const by = new Map();
    for (const n of list) for (const cid of (n.children || [])) {
      const c = nodes.get(cid), k = nameOf(c);
      const e = by.get(k) || { total: 0, self: 0, kids: [] };
      e.total += c.total; e.self += c.self; e.kids.push(c); by.set(k, e);
    }
    for (const [k, e] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) {
      if (e.total < 0.5) continue;
      out.push(`${indent}${e.total.toFixed(1)}  ${k}  [self ${e.self.toFixed(1)}]`);
      if (d > 1) walk(e.kids, d - 1, indent + '  ');
    }
  };
  walk(roots, glebia + 2, '');
  return {
    ms: +sum.toFixed(1), samples: samples.length,
    self: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [+v.toFixed(2), k]),
    drzewo: out
  };
}
