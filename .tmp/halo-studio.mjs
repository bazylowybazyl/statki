// Studio ujęć: jeden bake, wiele kadrów (strojenie presetów dema ringu).
//   node .tmp/halo-studio.mjs --cfg plik.json --out katalog [--facing in]
// plik.json: [{ "id": "a", "js": "..." }]  (js wykonywany w stronie przed zrzutem)
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
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const [W, H] = (args.size || '1920x1080').split('x').map(Number);
const cfg = JSON.parse(readFileSync(resolve(args.cfg), 'utf8'));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5260, strictPort: false } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const dbgPort = 9900 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(tmpdir(), 'halo-studio-' + Date.now())}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* */ }
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
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
const q = new URLSearchParams({ shot: '1', quality: args.quality || 'high', seed: '1337', preset: '1', ...(args.facing ? { facing: args.facing } : {}), ...Object.fromEntries(new URLSearchParams(args.q || '')) });
await send('Page.navigate', { url: `${base}/dema/halo_ring_demo.html?${q}` });
let ready = false;
for (let i = 0; i < 600 && !ready; i++) { await sleep(200); try { ready = await ev('!!(window.__halo && window.__halo.ready)'); } catch { /* */ } }
if (!ready) { console.log('TIMEOUT', logs); process.exit(1); }
for (const shot of cfg) {
  logs.length = 0;
  if (shot.dump) {
    try {
      const val = await ev(`(() => { const H = window.__halo; const h = H.helpers; ${shot.dump} })()`);
      writeFileSync(join(outDir, `${shot.id}.json`), JSON.stringify(val));
      console.log(shot.id, 'dump ok');
    } catch (e) { console.log(shot.id, 'ERR', String(e).slice(0, 400)); }
    continue;
  }
  try {
    const info = await ev(`(() => { const H = window.__halo; const h = H.helpers; ${shot.js}; H.renderFrames(4); const hdr = H.measureHDR(240); const st = H.stats(); return { preset: st.preset, max: +hdr.max.toFixed(2), nan: hdr.nanOrInf, calls: st.calls, tris: st.triangles, ms: st.ms ?? st.frameMs ?? null, fl: H.flight.game ? H.flight.berthState : null }; })()`);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${shot.id}.png`), Buffer.from(png.data, 'base64'));
    console.log(shot.id, JSON.stringify(info), logs.length ? logs.slice(0, 3) : '');
  } catch (e) {
    console.log(shot.id, 'ERR', String(e).slice(0, 400));
  }
}
ws.close();
chrome.kill();
await server.close();
process.exit(0);
