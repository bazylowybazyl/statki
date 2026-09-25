// Zrzuty PRAWDZIWEJ gry z ringiem „Halo” (port 2026-09-25): Vite + headless
// Chrome (CDP), gra z ?dev&haloTest=<planeta>&haloAt=<port|hall|transit>,
// menu ukryte (render idzie też w pauzie), kamera ustawiana z konsoli.
//   node .tmp/halo-game-shots.mjs --out <katalog> [--cfg shots.json] [--q "haloAt=hall"]
// shots.json: [{ "id": "...", "js": "..." , "wait": 1500 }] — js wykonywany w stronie
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const outDir = resolve(args.out || join(repo, '.tmp', 'halo-game'));
mkdirSync(outDir, { recursive: true });
const [W, H] = (args.size || '1920x1080').split('x').map(Number);
const cfg = args.cfg ? JSON.parse(readFileSync(resolve(args.cfg), 'utf8')) : [
  { id: 'port_z045', js: "HaloRingDebug.zoom(0.45)" },
  { id: 'port_z02', js: "HaloRingDebug.zoom(0.2)" },
  { id: 'port_z1', js: "HaloRingDebug.zoom(1.0)" },
  { id: 'port_z007', js: "HaloRingDebug.zoom(0.07)" }
];
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5270, strictPort: false } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const dbgPort = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(tmpdir(), 'halo-game-' + Date.now())}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 120 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* */ }
  if (!target) await sleep(250);
}
if (!target) { console.log('CHROME: brak strony'); chrome.kill(); await server.close(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const text = m.params.args.map((a) => a.value ?? a.description).join(' ');
    if (/shader|WebGL|THREE|Halo|halo|ring|Ring/i.test(text) || m.params.type === 'error') logs.push(m.params.type.toUpperCase() + ' ' + text.slice(0, 400));
  }
});
const send = (method, params = {}) => new Promise((ok, no) => { const k = ++id; pending.set(k, { ok, no }); ws.send(JSON.stringify({ id: k, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const q = new URLSearchParams({ dev: '1', haloTest: args.planet || 'earth', haloAt: 'port', ...Object.fromEntries(new URLSearchParams(args.q || '')) });
const url = `${base}/index.html?${q}`;
console.log('URL', url);
await send('Page.navigate', { url });
let ready = false;
for (let i = 0; i < 400 && !ready; i++) {
  await sleep(250);
  try { ready = await ev('!!(window.__haloRings && window.Core3D && window.Core3D.isInitialized && window.ship)'); } catch { /* */ }
}
if (!ready) { console.log('TIMEOUT gry', logs.slice(0, 10)); ws.close(); chrome.kill(); await server.close(); process.exit(1); }
// start gry jednoosobowej (pętla rusza dopiero w startGame); statek stoi tam,
// gdzie postawił go haloTest (DOMContentLoaded)
await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
let started = false;
for (let i = 0; i < 960 && !started; i++) {
  await sleep(250);
  try { started = await ev('(window.__frameId || 0) > 30'); } catch { /* */ }
  if (!started && i % 40 === 39) {
    try { console.log('  start…', (i + 1) / 4 + ' s', await ev(`[document.getElementById('loading-progress')?.textContent, document.getElementById('loading')?.className, window.__frameId || 0].join(' | ')`)); } catch { /* */ }
  }
}
console.log('game started:', started);
if (args.goto) await ev(`(() => { HaloRingDebug.goto('${args.planet || 'earth'}', '${args.goto}'); return true; })()`);
await sleep(Number(args.warm || 4000));
console.log('WARMUP logs:', logs.slice(0, 12));
try {
  const diag = await ev(`(() => ({ frame: window.__frameId, paused: window.PAUSED, stats: window.HaloRingDebug?.stats?.(), halo: !!window.__haloRings, entries: window.__haloRings?.entries?.length, earth: (() => { const p = (window.planets || []).find((q) => String(q.id).toLowerCase() === 'earth'); return p ? [Math.round(p.x), Math.round(p.y)] : null; })() }))()`);
  console.log('DIAG', JSON.stringify(diag));
} catch (e) { console.log('DIAG ERR', String(e).slice(0, 300)); }
for (const shot of cfg) {
  logs.length = 0;
  try {
    await ev(`(() => { ${shot.js}; return true; })()`);
    await sleep(Number(shot.wait || 2500));
    const info = await ev(`(() => { const s = window.HaloRingDebug?.stats?.() || {}; const r = window.__rendererInfo || {}; return { rings: s.rings, visible: s.visible, updMs: +(s.updateMs || 0).toFixed(2), quality: s.quality, calls: r.calls, tris: r.triangles, cam: s.camera, ship: [Math.round(window.ship.pos.x), Math.round(window.ship.pos.y)], exp: window.__exp ? [Math.round(window.__exp.x), Math.round(window.__exp.y)] : null }; })()`);
    if (shot.post) info.post = await ev(`(() => (${shot.post}))()`);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${shot.id}.png`), Buffer.from(png.data, 'base64'));
    console.log(shot.id, JSON.stringify(info), logs.length ? logs.slice(0, 4) : '');
  } catch (e) {
    console.log(shot.id, 'ERR', String(e).slice(0, 400));
  }
}
ws.close();
chrome.kill();
await server.close();
process.exit(0);
