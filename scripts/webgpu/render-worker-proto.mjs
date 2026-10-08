// Pomiar prototypu RW-02 (docs/PLAN-render-worker.md § 3.8, § 4; raport docs/webgpu/RW-02-PROTOTYP.md):
// dema/render-worker-proto.html — render three r183 / WebGPU w dedykowanym workerze i kompozycja z kanwą 2D.
//
// Jedna strona na rozdzielczość, warianty przełączane w biegu NA PRZEMIAN (kolejność odwracana co komórkę),
// w każdej komórce siatki (S, D): rozgrzewka, okno pomiaru (podsumowanie liczy strona: window.__rw.endWindow),
// czas zadań wątku głównego z CDP (Performance.getMetrics), potem zrzuty rogu ekranu (Page.captureScreenshot
// z wycinkiem) — kod paskowy numeru klatki obrazu 3D (wiersz 0–11 px) i nakładki (wiersz 14–25 px) → para
// (k nakładki, k obrazu 3D) NA EKRANIE i jej rozjazd w px (historia kamer i statków-sond w stronie).
// Sesje workerów przez Target.setAutoAttach (flatten): możliwości i licznik klatek z wnętrza workera.
// Przed każdą komórką: kontrola tła (obce bezgłowe przeglądarki, skrypty node scripts/…, .tmp/…).
//
//   node scripts/webgpu/render-worker-proto.mjs [--rozdz 1080,4k] [--S 2.5,3.5,4.5] [--D 4,8,12]
//        [--warianty 0,A,B1,B2,B2p,B2c,B3] [--okno 3] [--rozgrzewka 1.2] [--zrzuty 12] [--powtorzenia 1]
//        [--hz 240] [--petla zegar|raf] [--out .tmp/rw02/siatka] [--czekaj 1]
//   node scripts/webgpu/render-worker-proto.mjs --electron 1 [--rozdz 1080] …   (Electron 44 z repo, app://, COOP/COEP)
//   node scripts/webgpu/render-worker-proto.mjs --tabele .tmp/rw02/<katalog>/wyniki.json   (same tabele raportu)
//   node scripts/webgpu/render-worker-proto.mjs --core3d 1   (próba prawdziwego Core3D w workerze z podkładkami)
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startChrome, startVite, evaluate, sleep, waitFor, attachLogs, parseArgs, repo } from './wspolne.mjs';
import { Cdp } from '../../dema/rdzen-cdp.js';
import { decodePng } from './png.mjs';

const args = parseArgs();
const list = (v, def) => String(v ?? def).split(',').map((x) => x.trim()).filter(Boolean);
const RES = list(args.rozdz, '1080,4k').map((r) => (r === '4k' ? [3840, 2160] : r === '1440' ? [2560, 1440] : r === '720' ? [1280, 720] : [1920, 1080]));
const S_LIST = list(args.S, '2.5,3.5,4.5').map(Number);
const D_LIST = list(args.D, '4,8,12').map(Number);
const VARIANTS = list(args.warianty, '0,A,B1,B2,B2p,B2c,B2cr,B2cp,B3');
const WINDOW_S = Number(args.okno ?? 3);
const WARM_S = Number(args.rozgrzewka ?? 1.2);
const SHOTS = Number(args.zrzuty ?? 12);
const REPS = Number(args.powtorzenia ?? 1);
const HZ = Number(args.hz ?? 240);
const LOOP = args.petla || 'zegar';
const ELECTRON = args.electron === '1';
const WAIT_BG = args.czekaj !== '0';
const TABLES_ONLY = args.tabele ? resolve(repo, args.tabele) : null;
const OUT = TABLES_ONLY ? resolve(TABLES_ONLY, '..') : resolve(repo, args.out || `.tmp/rw02/${ELECTRON ? 'electron' : 'siatka'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`);
mkdirSync(OUT, { recursive: true });
const EXTRA_QUERY = args.query || '';

// ── tło maszyny ───────────────────────────────────────────────────────────────────────────────────────────────
const MY_PIDS = new Set([process.pid]);
function foreignLoad() {
  try {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='node.exe' OR Name='electron.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 });
    const rows = out.split(/\r?\n/).filter(Boolean).map((l) => {
      const [pid, ppid, ...rest] = l.split('|');
      return { pid: Number(pid), ppid: Number(ppid), cmd: rest.join('|') };
    });
    // własne: ten proces i jego potomkowie (Chrome / Electron uruchomione przez skrypt)
    const mine = new Set(MY_PIDS);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; }
    }
    const busy = rows.filter((r) => !mine.has(r.pid) && (
      (/chrome\.exe/i.test(r.cmd) && /--headless|--remote-debugging-port/.test(r.cmd) && !/--type=/.test(r.cmd))
      || (/node(\.exe)?"?\s/i.test(r.cmd) && /scripts[\\/]|\.tmp[\\/]|dema[\\/].*\.(m?js)/.test(r.cmd) && !/vite[\\/]bin/.test(r.cmd))
      || (/electron\.exe/i.test(r.cmd) && /--remote-debugging-port/.test(r.cmd) && !/--type=/.test(r.cmd))));
    return busy.map((r) => `${r.pid}: ${r.cmd.slice(0, 160)}`);
  } catch (err) {
    return [`(kontrola tła nieudana: ${err.message})`];
  }
}
async function waitQuiet(tag) {
  for (let i = 0; i < 60; i++) {
    const busy = foreignLoad();
    if (!busy.length || !WAIT_BG) {
      if (busy.length) console.log(`  [tło ${tag}] ${busy.length} obcych procesów:\n    ${busy.join('\n    ')}`);
      return busy;
    }
    console.log(`  [tło ${tag}] czekam — obce procesy:\n    ${busy.join('\n    ')}`);
    await sleep(20000);
  }
  return foreignLoad();
}

// ── CDP: sesje workerów (flatten) ─────────────────────────────────────────────────────────────────────────────
function sendSession(cdp, sessionId, method, params = {}) {
  const id = ++cdp.id;
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((ok, reject) => cdp.pending.set(id, { ok, reject }));
}
async function evalSession(cdp, sessionId, expression) {
  const res = await sendSession(cdp, sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}
function trackWorkers(cdp) {
  const workers = new Map();
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = msg.params;
      workers.set(sessionId, targetInfo);
      sendSession(cdp, sessionId, 'Runtime.runIfWaitingForDebugger').catch(() => {});
    } else if (msg.method === 'Target.detachedFromTarget') {
      workers.delete(msg.params.sessionId);
    }
  });
  return workers;
}

// ── zrzut rogu i odczyt kodów paskowych ───────────────────────────────────────────────────────────────────────
const BAR = { X0: 8, CELL_W: 6, BITS: 24, Y_3D: 6, Y_OV: 20 };
function readBarcode(img, y) {
  let k = 0;
  for (let i = 0; i < BAR.BITS; i++) {
    const x = BAR.X0 + i * BAR.CELL_W + 2;
    const o = (y * img.width + x) * 4;
    const lum = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
    if (lum > 128) k |= 1 << i;
  }
  return k;
}
async function cornerPair(cdp) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 160, height: 28, scale: 1 } });
  const img = decodePng(Buffer.from(data, 'base64'));
  return { k3: readBarcode(img, BAR.Y_3D), k2: readBarcode(img, BAR.Y_OV) };
}

// ── jeden przebieg strony (rozdzielczość) ─────────────────────────────────────────────────────────────────────
async function runPage(cdp, W, H, results, tag) {
  const cells = [];
  for (const S of S_LIST) for (const D of D_LIST) cells.push([S, D]);
  for (let rep = 0; rep < REPS; rep++) {
    for (let ci = 0; ci < cells.length; ci++) {
      const [S, D] = cells[ci];
      const bg = await waitQuiet(`${tag} S=${S} D=${D}`);
      const order = (ci + rep) % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
      for (const v of order) {
        await evaluate(cdp, `window.__rw.setVariant(${JSON.stringify(v)})`, 60000);
        await evaluate(cdp, `window.__rw.setLoad(${S}, ${D})`);
        await sleep(WARM_S * 1000);
        const m0 = (await cdp.send('Performance.getMetrics')).metrics;
        await evaluate(cdp, 'window.__rw.beginWindow()');
        await sleep(WINDOW_S * 1000);
        const s = await evaluate(cdp, 'window.__rw.endWindow()');
        const m1 = (await cdp.send('Performance.getMetrics')).metrics;
        const met = {};
        for (const x of m1) {
          const y = m0.find((z) => z.name === x.name);
          met[x.name] = x.value - (y ? y.value : 0);
        }
        s.cdp = { taskMsPerSec: met.TaskDuration * 1000 / (s.durMs / 1000), scriptMsPerSec: met.ScriptDuration * 1000 / (s.durMs / 1000) };
        // pary na ekranie (zrzuty rogu)
        const pairs = [];
        for (let i = 0; i < SHOTS; i++) {
          try {
            const p = await cornerPair(cdp);
            const pe = await evaluate(cdp, `window.__rw.pairError(${p.k2}, ${p.k3})`);
            pairs.push({ ...p, err: pe.mean, errMax: pe.max });
          } catch (err) {
            pairs.push({ error: String(err.message || err) });
          }
          await sleep(37 + (i * 13) % 50);
        }
        s.shots = pairs;
        s.rep = rep;
        s.bg = bg.length;
        results.push(s);
        const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
        const ok = pairs.filter((p) => p.k3 != null && !p.error);
        const mism = ok.filter((p) => p.k3 !== p.k2).length;
        console.log(`  ${tag} S=${S} D=${D} ${v.padEnd(3)} | obraz ${f(s.display.fps, 0)} kl/s, wątek gł. ${f(s.mainFps, 0)} kl/s `
          + `${f(s.main.perFrame.mean, 2)} ms/kl, zad. ${f(s.cdp.taskMsPerSec, 0)} ms/s | opóźn. ${f(s.display.latComposed.mean)} / p95 ${f(s.display.latComposed.p95)} ms `
          + `| rozjazd ${f(s.display.err.mean)} / p95 ${f(s.display.err.p95)} px | ekran: ${mism}/${ok.length} par różnych | odstęp p95 ${f(s.display.interval.p95)} p99 ${f(s.display.interval.p99)}`
          + (s.worker ? ` | worker ${f(s.worker.total.mean, 2)} ms (render ${f(s.worker.render.mean, 2)}), ttib ${f(s.worker.ttib.mean, 3)}, GPU ${f(s.worker.gpu.mean, 2)}` : ` | render ${f(s.main.render0.mean, 2)}, kopia ${f(s.main.drawImage0.mean, 3)}, GPU ${f(s.main.gpu0.mean, 2)}`));
        writeFileSync(join(OUT, 'wyniki.json'), JSON.stringify({ meta, results }, null, 1));
      }
    }
  }
}

// ── Electron: build demo + kopia electron/main.js z podmianami (ten sam schemat app:// i nagłówki) ────────────
async function buildDemo(outDir) {
  const { build } = await import('vite');
  await build({
    root: repo, logLevel: 'warn', configFile: join(repo, 'vite.config.js'),
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { proto: join(repo, 'dema/render-worker-proto.html') } } },
    worker: { format: 'es' }
  });
}
function electronMain(distRoot, userData, query, W, H) {
  let src = readFileSync(join(repo, 'electron/main.js'), 'utf8');
  const sub = (from, to) => {
    if (!src.includes(from)) throw new Error(`electron/main.js: brak fragmentu „${from.slice(0, 60)}” — skrypt do poprawy`);
    src = src.replace(from, to);
  };
  sub("const DIST_ROOT = path.resolve(__dirname, '../dist');", `const DIST_ROOT = ${JSON.stringify(distRoot)};`);
  sub("const USER_DATA_DIR = path.join(app.getPath('documents'), 'HULLFALL');", `const USER_DATA_DIR = ${JSON.stringify(userData)};`);
  sub('migrateLegacySaves();\n', '// pomiar RW-02: bez migracji zapisów\n');
  sub("const { app, BrowserWindow, net, protocol } = require('electron');",
    "const { app, BrowserWindow, net, protocol } = require('electron');\n// pomiar RW-02: okno w tle nie traci klatek (zasłonięte okno Windows = ukryte)\napp.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');");
  sub('    width: 1280,\n    height: 800,', `    width: ${W},\n    height: ${H},\n    useContentSize: true,\n    show: false,`);
  sub('      webSecurity: true,', '      webSecurity: true,\n      backgroundThrottling: false,');
  sub('win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);', `win.loadURL(\`\${APP_SCHEME}://\${APP_HOST}/dema/render-worker-proto.html?${query}\`);\n  win.showInactive();`);
  return src;
}
async function startElectron(W, H, query) {
  const base = join(tmpdir(), `rw02-electron-${Date.now()}`);
  const dist = join(base, 'dist');
  const userData = join(base, 'profil');
  mkdirSync(userData, { recursive: true });
  console.log(`build dema → ${dist}`);
  await buildDemo(dist);
  const mainFile = join(base, 'electron', 'main.js');
  mkdirSync(join(base, 'electron'), { recursive: true });
  writeFileSync(mainFile, electronMain(dist, userData, query, W, H));
  writeFileSync(join(base, 'electron', 'package.json'), JSON.stringify({ name: 'rw02-pomiar', main: 'main.js' }));
  const exe = join(repo, 'node_modules/electron/dist/electron.exe');
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, join(base, 'electron')], { stdio: 'ignore' });
  MY_PIDS.add(proc.pid);
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.url.startsWith('app://'));
    } catch { /* start */ }
    if (!target) await sleep(250);
  }
  if (!target) { proc.kill(); throw new Error('Electron nie wystartował'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  const logs = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return {
    cdp, logs, url: target.url,
    close: async () => {
      // zamknięcie okna przez stronę; Browser.close na sesji strony Electronu nie odpowiada — bez czekania na odpowiedź
      try { await Promise.race([evaluate(cdp, 'window.close(), true', 3000), sleep(3000)]); } catch { /* */ }
      try { ws.close(); } catch { /* */ }
      const exited = new Promise((ok) => { if (proc.exitCode !== null) ok(); else proc.once('exit', ok); });
      await Promise.race([exited, sleep(4000)]);
      try { proc.kill(); } catch { /* */ }
      await sleep(500);
      try { rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* zostaje w %TEMP% */ }
    }
  };
}

// ── start ─────────────────────────────────────────────────────────────────────────────────────────────────────
const meta = {
  date: new Date().toISOString(), electron: ELECTRON, hz: HZ, loop: LOOP, window: WINDOW_S, warm: WARM_S, shots: SHOTS,
  S: S_LIST, D: D_LIST, variants: VARIANTS, reps: REPS, res: RES.map((r) => r.join('x')), query: EXTRA_QUERY, pages: []
};
let results = [];
// ── próba prawdziwego Core3D w workerze (dema/render-worker-proto.html?core3d=1) ─────────────────────────────
if (args.core3d === '1') {
  const vite = await startVite(5600 + Math.floor(Math.random() * 200));
  const chrome = await startChrome({ width: 1920, height: 1080 });
  const logs = await attachLogs(chrome);
  try {
    // --dok 1: od startu także document.createElement('canvas') → OffscreenCanvas (poza podkładkami z zadania)
    const tag = args.dok === '1' ? '-dok' : '';
    await chrome.cdp.send('Page.navigate', { url: `${vite.base}/dema/render-worker-proto.html?core3d=1${tag ? '&dok=1' : ''}` });
    const ok = await waitFor(chrome.cdp, 'window.__rw && window.__rw.core3d', 180000, 500);
    const rep = ok ? await evaluate(chrome.cdp, 'window.__rw.core3d') : null;
    const { data } = await chrome.cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `core3d${tag}.png`), Buffer.from(data, 'base64'));
    const all = { report: rep, logs: logs.all().slice(-80), pageErrors: await evaluate(chrome.cdp, 'window.__rw && window.__rw.errors') };
    writeFileSync(join(OUT, `core3d${tag}.json`), JSON.stringify(all, null, 1));
    if (!rep) console.log('Core3D: brak raportu (limit czasu)');
    else {
      console.log(`podkładki: ${rep.shims.join('; ')}`);
      for (const st of rep.steps) console.log(`${st.ok ? 'OK ' : 'BŁĄD'} ${st.name}${st.err ? ` — ${st.err}` : ''}${st.ms != null ? ` (${st.ms.toFixed(0)} ms)` : ''}`);
      for (const m of rep.modules) console.log(`  import ${m.ok ? 'OK  ' : 'BŁĄD'} ${m.path}${m.err ? ` — ${m.err}` : ''}`);
    }
    console.log(`\nlogi strony (ostatnie):\n${logs.all().slice(-25).join('\n')}\n→ ${join(OUT, `core3d${tag}.json`)}`);
  } finally {
    await chrome.close();
    await vite.server.close();
  }
  process.exit(0);
}
if (TABLES_ONLY) {
  const j = JSON.parse(readFileSync(TABLES_ONLY, 'utf8'));
  results = j.results;
  Object.assign(meta, j.meta);
}
if (!TABLES_ONLY) {
console.log(`RW-02: ${ELECTRON ? 'Electron' : 'headless Chrome'}, ${RES.map((r) => r.join('×')).join(', ')}, S ${S_LIST}, D ${D_LIST}, warianty ${VARIANTS}, okno ${WINDOW_S} s → ${OUT}`);
const vite = ELECTRON ? null : await startVite(5400 + Math.floor(Math.random() * 200));
try {
  for (const [W, H] of RES) {
    await waitQuiet(`${W}×${H} start`);
    const query = `hz=${HZ}&petla=${LOOP}&S=${S_LIST[0]}&D=${D_LIST[0]}&wariant=${VARIANTS[0]}${EXTRA_QUERY ? '&' + EXTRA_QUERY : ''}`;
    const host = ELECTRON ? await startElectron(W, H, query) : await startChrome({ width: W, height: H });
    const cdp = host.cdp;
    const logs = ELECTRON ? null : await attachLogs(host);
    const workers = trackWorkers(cdp);
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    if (!ELECTRON) await cdp.send('Page.navigate', { url: `${vite.base}/dema/render-worker-proto.html?${query}` });
    const ready = await waitFor(cdp, 'window.__rw && window.__rw.ready', 90000);
    const page = { W, H, ready, caps: null, workers: [], size: null, errors: [] };
    meta.pages.push(page);
    if (!ready) {
      page.errors = ELECTRON ? host.logs.slice(-30) : logs.errors().slice(-30);
      console.log(`strona nie wstała (${W}×${H}):\n${page.errors.join('\n')}`);
      await host.close();
      continue;
    }
    page.caps = await evaluate(cdp, 'window.__rw.caps');
    page.size = await evaluate(cdp, '({ innerWidth, innerHeight, dpr: devicePixelRatio, W: window.__rw.W, H: window.__rw.H })');
    // z wnętrza workerów (sesje flatten): możliwości i stan pętli
    for (const [sid, info] of workers) {
      try {
        const wv = await evalSession(cdp, sid, `(() => { const s = globalThis.__rwWorker; return { url: location.href.slice(-60), gpu: !!navigator.gpu, raf: typeof requestAnimationFrame === 'function', offscreen: typeof OffscreenCanvas === 'function', coi: self.crossOriginIsolated, frames: s ? s.frames : null, rafN: s ? s.rafN : null, mode: s ? s.mode : null, errors: s ? s.errors.slice(-3) : null }; })()`);
        page.workers.push({ type: info.type, ...wv });
      } catch (err) {
        page.workers.push({ type: info.type, error: String(err.message || err) });
      }
    }
    console.log(`${W}×${H}: ${JSON.stringify(page.caps)}\n  workery: ${JSON.stringify(page.workers)}`);
    await runPage(cdp, W, H, results, `${W}×${H}`);
    page.errors = ELECTRON ? host.logs.filter((l) => /error|exception/i.test(l)).slice(-20) : logs.errors().slice(-20);
    page.pageErrors = await evaluate(cdp, 'window.__rw.errors');
    await host.close();
  }
} finally {
  if (vite) await vite.server.close();
  writeFileSync(join(OUT, 'wyniki.json'), JSON.stringify({ meta, results }, null, 1));
}
}

// ── tabele (średnie po powtórzeniach) ─────────────────────────────────────────────────────────────────────────
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '–');
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const lines = [];
for (const [W, H] of (TABLES_ONLY ? [...new Set(results.map((r) => `${r.W}x${r.H}`))].map((k) => k.split('x').map(Number)) : RES)) {
  lines.push(`\n### ${W}×${H}\n`);
  lines.push('| S | D | wariant | obraz 3D [kl/s] | wątek gł. [kl/s] | wątek gł. [ms/kl] | zadania wątku gł. [ms/s] | składanie [ms] | warstwa nakładek [ms] | worker [ms/kl] | ttib [ms] | GPU [ms] | opóźn. gotowa śr./p95 [ms] | opóźn. złożona śr./p95 [ms] | rozjazd śr./p95/maks. [px] | pary różne (ekran) | odstęp p50/p95/p99 [ms] |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const S of meta.S) for (const D of meta.D) for (const v of meta.variants) {
    const rs = results.filter((r) => r.W === W && r.H === H && r.S === S && r.D === D && r.variant === v);
    if (!rs.length) continue;
    const A = (fn) => avg(rs.map(fn).filter(Number.isFinite));
    const shots = rs.flatMap((r) => r.shots).filter((p) => p.k3 != null && !p.error);
    const mism = shots.filter((p) => p.k3 !== p.k2).length;
    lines.push(`| ${f(S)} | ${D} | ${v} | ${f(A((r) => r.display.fps), 0)} | ${f(A((r) => r.mainFps), 0)} | ${f(A((r) => r.main.perFrame.mean), 2)} | ${f(A((r) => r.cdp.taskMsPerSec), 0)} `
      + `| ${f(A((r) => r.main.compose.mean), 3)} | ${f(A((r) => r.main.overlayBitmap.mean), 3)} | ${f(A((r) => r.worker?.total.mean), 2)} | ${f(A((r) => r.worker?.ttib.mean), 3)} `
      + `| ${f(A((r) => (r.worker ? r.worker.gpu.mean : r.main.gpu0?.mean)), 2)} `
      + `| ${f(A((r) => r.display.latReady.mean))} / ${f(A((r) => r.display.latReady.p95))} | ${f(A((r) => r.display.latComposed.mean))} / ${f(A((r) => r.display.latComposed.p95))} `
      + `| ${f(A((r) => r.display.err.mean))} / ${f(A((r) => r.display.err.p95))} / ${f(A((r) => r.display.errMax.max))} | ${mism}/${shots.length} `
      + `| ${f(A((r) => r.display.interval.p50))} / ${f(A((r) => r.display.interval.p95))} / ${f(A((r) => r.display.interval.p99))} |`);
  }
}
writeFileSync(join(OUT, 'tabele.md'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'raport-tabele.md'), reportTables().join('\n') + '\n');
console.log(`\nwyniki: ${join(OUT, 'wyniki.json')}\ntabele: ${join(OUT, 'tabele.md')}, ${join(OUT, 'raport-tabele.md')}`);

// Tabele do raportu (docs/webgpu/RW-02-PROTOTYP.md): średnie okien (po powtórzeniach), pary z ekranu łącznie.
function reportTables() {
  const resList = [...new Set(results.map((r) => `${r.W}x${r.H}`))].map((k) => k.split('x').map(Number));
  const Ss = [...new Set(results.map((r) => r.S))].sort((a, b) => a - b);
  const Ds = [...new Set(results.map((r) => r.D))].sort((a, b) => a - b);
  const Vs = meta.variants.filter((v) => results.some((r) => r.variant === v));
  const sel = (W, H, fn) => results.filter((r) => r.W === W && r.H === H && fn(r));
  const A = (rs, fn) => avg(rs.map(fn).filter(Number.isFinite));
  const physMsPerSec = (r) => r.main.phys.mean * r.mainFps;
  const out = [];
  for (const [W, H] of resList) {
    out.push(`\n#### ${W}×${H} — obraz 3D [kl/s] (wątek główny [kl/s] w nawiasie dla wariantów z workerem)\n`);
    out.push(`| S [ms] | D [ms] | ${Vs.join(' | ')} | zysk najlepszego B2* / 0 |`);
    out.push(`|---|---|${Vs.map(() => '---|').join('')}---|`);
    for (const S of Ss) for (const D of Ds) {
      const cells = Vs.map((v) => {
        const rs = sel(W, H, (r) => r.S === S && r.D === D && r.variant === v);
        const fps = A(rs, (r) => r.display.fps);
        return v === '0' ? f(fps, 0) : `${f(fps, 0)} (${f(A(rs, (r) => r.mainFps), 0)})`;
      });
      const f0 = A(sel(W, H, (r) => r.S === S && r.D === D && r.variant === '0'), (r) => r.display.fps);
      const best = Math.max(...Vs.filter((v) => v.startsWith('B2')).map((v) => A(sel(W, H, (r) => r.S === S && r.D === D && r.variant === v), (r) => r.display.fps)).filter(Number.isFinite));
      out.push(`| ${f(S)} | ${D} | ${cells.join(' | ')} | ${f(best / f0, 2)}× |`);
    }
    out.push(`\n#### ${W}×${H} — koszt wątku głównego (średnio po komórkach S × D)\n`);
    out.push('| wariant | JS poza fizyką [ms / klatkę wątku gł.] | zadania wątku gł. poza fizyką [ms/s] (CDP) | to samo na klatkę obrazu 3D [ms] | składanie przy przyjściu klatki [ms] | bitmapa warstwy nakładek [ms] |');
    out.push('|---|---|---|---|---|---|');
    for (const v of Vs) {
      const rs = sel(W, H, (r) => r.variant === v);
      const busy = A(rs, (r) => r.cdp.taskMsPerSec - physMsPerSec(r));
      const perImg = A(rs, (r) => (r.cdp.taskMsPerSec - physMsPerSec(r)) / r.display.fps);
      out.push(`| ${v} | ${f(A(rs, (r) => r.main.perFrame.mean), 2)} | ${f(busy, 0)} | ${f(perImg, 2)} | ${f(A(rs, (r) => r.main.compose.mean), 3)} (p95 ${f(A(rs, (r) => r.main.compose.p95), 3)}) | ${f(A(rs, (r) => r.main.overlayBitmap.mean), 3)} (p95 ${f(A(rs, (r) => r.main.overlayBitmap.p95), 3)}) |`);
    }
    out.push(`\n#### ${W}×${H} — koszt workera na klatkę (średnio po komórkach; D odjęte)\n`);
    out.push('| wariant | praca 3D bez D [ms] | w tym render (passy, bloom, post) [ms] | transferToImageBitmap śr. / p95 [ms] | postMessage bitmapy [ms] | GPU (znaczniki) [ms] | rysunki |');
    out.push('|---|---|---|---|---|---|---|');
    for (const v of Vs) {
      const rs = sel(W, H, (r) => r.variant === v);
      if (v === '0') {
        out.push(`| 0 (wątek gł.) | ${f(A(rs, (r) => r.main.render0.mean), 2)} + kopia ${f(A(rs, (r) => r.main.drawImage0.mean), 3)} | ${f(A(rs, (r) => r.main.render0.mean), 2)} | – | – | ${f(A(rs, (r) => r.main.gpu0?.mean), 2)} | ${f(A(rs, (r) => r.main.drawCalls0), 0)} |`);
        continue;
      }
      out.push(`| ${v} | ${f(A(rs, (r) => r.worker.total.mean - r.worker.D.mean), 2)} | ${f(A(rs, (r) => r.worker.render.mean), 2)} | ${f(A(rs, (r) => r.worker.ttib.mean), 3)} / ${f(A(rs, (r) => r.worker.ttib.p95), 3)} | ${f(A(rs, (r) => r.worker.post.mean), 3)} | ${f(A(rs, (r) => r.worker.gpu.mean), 2)} | ${f(A(rs, (r) => r.worker.drawCalls.mean), 0)} |`);
    }
    out.push(`\n#### ${W}×${H} — opóźnienie: migawka k opublikowana → klatka k złożona, śr. / p95 [ms] (gotowa — w nawiasie)\n`);
    out.push(`| S [ms] | D [ms] | ${Vs.join(' | ')} |`);
    out.push(`|---|---|${Vs.map(() => '---|').join('')}`);
    for (const S of Ss) for (const D of Ds) {
      const cells = Vs.map((v) => {
        const rs = sel(W, H, (r) => r.S === S && r.D === D && r.variant === v);
        return `${f(A(rs, (r) => r.display.latComposed.mean))} / ${f(A(rs, (r) => r.display.latComposed.p95))} (${f(A(rs, (r) => r.display.latReady.mean))})`;
      });
      out.push(`| ${f(S)} | ${D} | ${cells.join(' | ')} |`);
    }
    out.push(`\n#### ${W}×${H} — rozjazd znacznika 2D względem obiektu 3D tej samej encji [px]\n`);
    out.push(`| wariant | z dziennika: śr. / p95 / maks. | ${Ds.map((D) => `D = ${D}: śr. / p95`).join(' | ')} | pary różne na zrzutach ekranu | rozjazd par ze zrzutów śr. / maks. |`);
    out.push(`|---|---|${Ds.map(() => '---|').join('')}---|---|`);
    for (const v of Vs) {
      const rs = sel(W, H, (r) => r.variant === v);
      const shots = rs.flatMap((r) => r.shots).filter((p) => p.k3 != null && !p.error);
      const mism = shots.filter((p) => p.k3 !== p.k2);
      const errs = shots.map((p) => p.err).filter(Number.isFinite);
      const byD = Ds.map((D) => {
        const q = rs.filter((r) => r.D === D);
        return `${f(A(q, (r) => r.display.err.mean))} / ${f(A(q, (r) => r.display.err.p95))}`;
      });
      const mx = rs.map((r) => r.display.errMax.max).filter(Number.isFinite);
      out.push(`| ${v} | ${f(A(rs, (r) => r.display.err.mean))} / ${f(A(rs, (r) => r.display.err.p95))} / ${f(mx.length ? Math.max(...mx) : NaN)} | ${byD.join(' | ')} | ${mism.length}/${shots.length} (${f(100 * mism.length / Math.max(1, shots.length), 0)}%) | ${f(avg(errs))} / ${f(errs.length ? Math.max(...errs) : NaN)} |`);
    }
    out.push(`\n#### ${W}×${H} — odstępy między klatkami obrazu 3D, p50 / p95 / p99 [ms]\n`);
    out.push(`| przypadek | ${Vs.join(' | ')} |`);
    out.push(`|---|${Vs.map(() => '---|').join('')}`);
    const cases = [
      ['worker wolniejszy (S = 2,5, D = 12)', (r) => r.S === 2.5 && r.D === 12],
      ['wątek gł. wolniejszy (S = 4,5, D = 4)', (r) => r.S === 4.5 && r.D === 4],
      ['S = 3,5, D = 8', (r) => r.S === 3.5 && r.D === 8],
      ['wszystkie komórki (średnia)', () => true]
    ];
    for (const [name, fn] of cases) {
      const cells = Vs.map((v) => {
        const rs = sel(W, H, (r) => fn(r) && r.variant === v);
        return `${f(A(rs, (r) => r.display.interval.p50))} / ${f(A(rs, (r) => r.display.interval.p95))} / ${f(A(rs, (r) => r.display.interval.p99))}`;
      });
      out.push(`| ${name} | ${cells.join(' | ')} |`);
    }
  }
  return out;
}
