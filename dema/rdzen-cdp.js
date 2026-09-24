// Narzędzia node dla dema rdzenia: Vite (dev server) + headless Chrome przez
// DevTools Protocol (WebSocket z Node 22, bez zależności). Wzorzec:
// scripts/halo-ring-shots.mjs. Uruchamiają i sprzątają WŁASNE procesy.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, reject) => this.pending.set(id, { ok, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

export async function evaluate(cdp, expression, timeout = 120000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

export async function startVite(port = 5260) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false } });
  await server.listen();
  const base = `http://localhost:${server.httpServer.address().port}`;
  return { server, base };
}

/**
 * @param {object} o { width, height, gpu: 'd3d11' | 'swiftshader', webgpu: bool }
 */
export async function startChrome(o = {}) {
  if (!CHROME) throw new Error('Nie znaleziono chrome.exe');
  const W = o.width || 1920;
  const H = o.height || 1080;
  const profile = join(tmpdir(), `rdzen-cdp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(profile, { recursive: true });
  const dbgPort = 9400 + Math.floor(Math.random() * 500);
  const gpuFlags = o.gpu === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  const args = [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    ...gpuFlags, '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    ...(o.webgpu !== false ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'] : []),
    `--window-size=${W},${H}`, 'about:blank'
  ];
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* czekam */ }
    if (!target) await sleep(250);
  }
  if (!target) { chrome.kill(); throw new Error('Chrome nie wystartował'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  const logs = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${msg.params.type}] ${text}`.slice(0, 3000));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return {
    cdp, logs,
    async close() { try { ws.close(); } catch { /* */ } try { chrome.kill(); } catch { /* */ } }
  };
}

export async function navigateAndWait(cdp, url, readyExpr, timeoutMs = 120000) {
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(200);
    try { if (await evaluate(cdp, readyExpr)) return true; } catch { /* ładuje się */ }
  }
  return false;
}
