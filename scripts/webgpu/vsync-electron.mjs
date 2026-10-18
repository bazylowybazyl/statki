// VSync w Electronie (Opcje → Grafika → VSync; electron/main.js + electron/preload.js, AGENTS.md § „Opcje grafiki”):
// gra z buildu Vite w prawdziwym Electronie z repo, profil i plik ustawień startu w %TEMP% (zapisów gracza nie rusza).
// Przebieg: start z VSync wł. → menu (okresy rAF strony) [→ gra swobodna] → Opcje: „Wył.” (plik uruchomienie.json,
// informacja o restarcie) → „Uruchom ponownie” (prawdziwe app.relaunch) → nowy proces: hullfallApp.vsync === false,
// menu [i gra] bez limitu klatek (rAF strony, złożenia obrazu workera na s) → Opcje: „Wł.” → restart → takt ekranu.
//   node scripts/webgpu/vsync-electron.mjs [--dist <katalog buildu>] [--czas 5] [--rozmiar 1600x900] [--gra 1]
// Bez --dist: build gry do .tmp/vsync-electron/dist (~1–2 min). Okno wychodzi na ekran (vsync wymaga widocznego okna),
// bez fokusu. Wynik: .tmp/vsync-electron/wynik.json.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, sleep, repo } from './wspolne.mjs';
import { Cdp, evaluate } from '../../dema/rdzen-cdp.js';

const args = parseArgs();
const OUT = resolve(repo, '.tmp/vsync-electron');
const SEC = Number(args.czas || 5);
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const GAME = args.gra !== '0';
mkdirSync(OUT, { recursive: true });

async function buildGame(outDir) {
  const { build } = await import('vite');
  console.log(`build gry → ${outDir}`);
  const t0 = Date.now();
  await build({ root: repo, logLevel: 'warn', configFile: join(repo, 'vite.config.js'), build: { outDir, emptyOutDir: true } });
  console.log(`build: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// Kopia electron/main.js (i preload.js) z podmianami: build z katalogu narzędzia, profil w %TEMP%, bez migracji
// zapisów, okno zadanego rozmiaru pokazane bez fokusu, bez dławienia zasłoniętego okna.
function prepareApp(dist, profile) {
  let src = readFileSync(join(repo, 'electron/main.js'), 'utf8');
  const sub = (from, to) => {
    if (!src.includes(from)) throw new Error(`electron/main.js: brak fragmentu „${from.slice(0, 60)}” — skrypt do poprawy`);
    src = src.replace(from, to);
  };
  sub("const DIST_ROOT = path.resolve(__dirname, '../dist');", `const DIST_ROOT = ${JSON.stringify(dist)};`);
  sub("const USER_DATA_DIR = path.join(app.getPath('documents'), 'HULLFALL');", `const USER_DATA_DIR = ${JSON.stringify(profile)};`);
  sub('migrateLegacySaves();\n', '// narzędzie: bez migracji zapisów\n');
  sub("const { app, BrowserWindow, ipcMain, net, protocol, session } = require('electron');",
    "const { app, BrowserWindow, ipcMain, net, protocol, session } = require('electron');\napp.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');");
  sub('    width: 1280,\n    height: 800,', `    width: ${W},\n    height: ${H},\n    useContentSize: true,\n    show: false,`);
  sub('      webSecurity: true,', '      webSecurity: true,\n      backgroundThrottling: false,');
  sub('win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);', 'win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);\n  win.showInactive();');
  const appDir = join(tmpdir(), `vsync-electron-${Date.now()}`);
  mkdirSync(join(appDir, 'electron'), { recursive: true });
  writeFileSync(join(appDir, 'electron', 'main.js'), src);
  writeFileSync(join(appDir, 'electron', 'preload.js'), readFileSync(join(repo, 'electron/preload.js'), 'utf8'));
  writeFileSync(join(appDir, 'electron', 'package.json'), JSON.stringify({ name: 'vsync-pomiar', main: 'main.js' }));
  return join(appDir, 'electron');
}

async function connect(port, timeoutMs = 60000) {
  let target = null;
  for (const t0 = Date.now(); !target && Date.now() - t0 < timeoutMs;) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.url.startsWith('app://'));
    } catch { /* proces startuje */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Electron nie wystartował');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  const logs = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
  });
  const closed = new Promise((ok) => ws.addEventListener('close', ok));
  await cdp.send('Runtime.enable');
  return { cdp, ws, logs, closed };
}

const ev = (s, e, ms = 60000) => evaluate(s.cdp, e, ms);
async function waitFor(s, expr, timeoutMs = 120000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs;) {
    try { if (await ev(s, `!!(${expr})`, 10000)) return true; } catch { /* strona się wczytuje */ }
    await sleep(200);
  }
  return false;
}

// okresy rAF strony przez `sec` s + złożenia obrazu workera na sekundę
const measure = (s, sec) => ev(s, `new Promise((ok) => {
  const H = window.RenderWorkerHost, per = [];
  const c0 = H ? H.composed : 0, t0 = performance.now();
  let last = t0;
  const f = (t) => { per.push(t - last); last = t;
    if (t - t0 < ${sec} * 1000) requestAnimationFrame(f); else {
      const n = per.length; per.sort((a, b) => a - b);
      const q = (p) => +per[Math.min(n - 1, Math.floor(p * n))].toFixed(2);
      ok({ rafNaS: +(n / ((t - t0) / 1000)).toFixed(1), okresP50: q(0.5), okresP95: q(0.95), okresMaks: q(1),
        zlozeniaNaS: H ? +((H.composed - c0) / ((t - t0) / 1000)).toFixed(1) : null });
    } };
  requestAnimationFrame(f);
})`, (sec + 30) * 1000);

const state = (s) => ev(s, `(() => {
  const vis = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden; };
  const act = (v) => document.querySelector('[data-gfx-vsync="' + v + '"]')?.classList.contains('active') || false;
  return { app: window.hullfallApp ? { vsync: window.hullfallApp.vsync, vsyncSaved: window.hullfallApp.vsyncSaved, portable: window.hullfallApp.portable } : null,
    quality: window.GraphicsQuality?.vsync || null, setting: window.GraphicsQuality?.settings?.vsync,
    chipOn: act('on'), chipOff: act('off'), chipsDisabled: !!document.querySelector('[data-gfx-vsync="on"]')?.disabled,
    pendingNote: vis('[data-gfx-vsync-pending]'), pendingText: document.querySelector('[data-gfx-vsync-pending-text]')?.textContent || '',
    topNote: vis('[data-gfx-restart]'), topText: document.querySelector('[data-gfx-restart-text]')?.textContent || '',
    pacing: window.RenderWorkerHost ? window.RenderWorkerHost.pacing : null, mode: window.__renderModeBoot?.mode };
})()`);

async function waitMenu(s) {
  if (!await waitFor(s, 'window.__menuBackdrop && window.__menuBackdrop.ready && window.GraphicsQuality', 180000)) throw new Error('menu nie wstało');
  await sleep(1500);
}

async function startFreeGame(s) {
  await ev(s, `(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-new-game')?.click();
    setTimeout(() => document.getElementById('btn-mode-single')?.click(), 600); return true; })()`);
  if (!await waitFor(s, '(window.__frameId | 0) > 120', 240000)) throw new Error('gra nie wstała');
  await sleep(3000);
}

// klik chipa VSync w Opcjach i „Uruchom ponownie” w informacji pola → nowy proces (ten sam port debugowania z argv)
async function toggleAndRelaunch(s, port, value) {
  await ev(s, `(() => { document.getElementById('btn-options')?.click(); return true; })()`);
  await sleep(400);
  await ev(s, `(() => { document.querySelector('[data-gfx-vsync="${value}"]')?.click(); return true; })()`);
  await sleep(500);
  const before = await state(s);
  const launchFile = existsSync(join(profile, 'uruchomienie.json')) ? JSON.parse(readFileSync(join(profile, 'uruchomienie.json'), 'utf8')) : null;
  await ev(s, `(() => { document.querySelector('[data-gfx-vsync-pending] [data-gfx-reload]')?.click(); return true; })()`);
  const t0 = Date.now();
  await Promise.race([s.closed, sleep(20000)]);
  await sleep(1000);
  const next = await connect(port, 90000);
  return { before, launchFile, relaunchMs: Date.now() - t0, next };
}

const dist = args.dist ? resolve(args.dist) : join(OUT, 'dist');
if (!args.dist) await buildGame(dist);
const profile = join(tmpdir(), `vsync-electron-profil-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const appDir = prepareApp(dist, profile);
const exe = join(repo, 'node_modules/electron/dist/electron.exe');
const port = 9700 + Math.floor(Math.random() * 200);
const env = { ...process.env };
delete env.HULLFALL_VSYNC;
delete env.PORTABLE_EXECUTABLE_FILE;
const result = { date: new Date().toISOString(), window: `${W}x${H}`, sec: SEC, phases: {} };
let s = null;
let first = null;
try {
  first = spawn(exe, [`--remote-debugging-port=${port}`, appDir], { stdio: 'ignore', env });
  s = await connect(port);
  await waitMenu(s);
  result.phases.vsyncOn = { state: await state(s), menu: await measure(s, SEC) };
  console.log('VSync wł. — menu:', JSON.stringify(result.phases.vsyncOn));
  const off = await toggleAndRelaunch(s, port, 'off');
  s = off.next;
  await waitMenu(s);
  result.phases.toggleOff = { before: off.before, launchFile: off.launchFile, relaunchMs: off.relaunchMs };
  console.log('klik „Wył.”:', JSON.stringify(result.phases.toggleOff));
  result.phases.vsyncOff = { state: await state(s), menu: await measure(s, SEC) };
  console.log('VSync wył. — menu:', JSON.stringify(result.phases.vsyncOff));
  if (GAME) {
    await startFreeGame(s);
    result.phases.vsyncOff.game = await measure(s, SEC);
    result.phases.vsyncOff.gameState = await state(s);
    console.log('VSync wył. — gra:', JSON.stringify(result.phases.vsyncOff.game), JSON.stringify(result.phases.vsyncOff.gameState));
    // powrót do menu przed grą: przeładowanie strony w tym samym procesie (preload czyta plik startu od nowa;
    // „Uruchom ponownie” działa tylko przed startem gry)
    await ev(s, `(() => { setTimeout(() => location.reload(), 50); return true; })()`).catch(() => {});
    await sleep(3000);
    await waitMenu(s);
    result.phases.vsyncOff.afterReload = await state(s);
  }
  const on = await toggleAndRelaunch(s, port, 'on');
  s = on.next;
  await waitMenu(s);
  result.phases.toggleOn = { before: on.before, launchFile: on.launchFile, relaunchMs: on.relaunchMs };
  result.phases.vsyncOnAgain = { state: await state(s), menu: await measure(s, SEC) };
  console.log('klik „Wł.” → VSync wł. — menu:', JSON.stringify(result.phases.vsyncOnAgain));
  if (GAME) {
    await startFreeGame(s);
    result.phases.vsyncOnAgain.game = await measure(s, SEC);
    console.log('VSync wł. — gra:', JSON.stringify(result.phases.vsyncOnAgain.game));
  }
  result.logs = s.logs.filter((l) => /error|exception|VSync|grafika/i.test(l)).slice(-30);
} catch (err) {
  result.error = String(err && err.stack || err);
  console.error(result.error);
} finally {
  writeFileSync(join(OUT, 'wynik.json'), JSON.stringify(result, null, 1));
  console.log(`→ ${join(OUT, 'wynik.json')}`);
  if (s) {
    try { await Promise.race([ev(s, 'window.close(), true', 3000), sleep(3000)]); } catch { /* */ }
    try { s.ws.close(); } catch { /* */ }
  }
  await sleep(3000);
  // pierwszy proces (dziecko narzędzia) — gdyby przebieg urwał się przed restartem
  if (first && first.exitCode === null) { try { first.kill(); } catch { /* */ } }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* zostaje w %TEMP% */ }
  try { rmSync(resolve(appDir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* */ }
}
process.exit(result.error ? 1 : 0);
