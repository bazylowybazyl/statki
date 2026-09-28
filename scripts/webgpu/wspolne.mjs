// Wspólne pomocniki narzędzi portu WebGPU (scripts/webgpu/*): bez zależności poza
// Vite z repo. Na bazie dema/rdzen-cdp.js — dokłada domeny Log i Network (błędy
// walidacji WebGPU / WGSL i 404 przychodzą przez Log.entryAdded, nie przez console),
// statyczny serwer plików (ścieżka import map bez Vite) i parser argumentów.
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, evaluate, sleep, repo, Cdp, closeChrome } from '../../dema/rdzen-cdp.js';

export { startVite, evaluate, sleep, repo };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));

/**
 * Headless Chrome jak w dema/rdzen-cdp.js (te same flagi GPU), plus dodatkowe
 * argumenty (np. '--enable-dawn-features=use_dxc') i stały port debugowania.
 * @param {{ width?: number, height?: number, extraArgs?: string[], webgpu?: boolean }} o
 */
export async function startChrome(o = {}) {
  if (!CHROME) throw new Error('Nie znaleziono chrome.exe');
  const W = o.width || 1920;
  const H = o.height || 1080;
  const profile = join(tmpdir(), `webgpu-cdp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(profile, { recursive: true });
  const dbgPort = 9400 + Math.floor(Math.random() * 500);
  const args = [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    // webgpu: false — bez flag włączających WebGPU (zadanie 23: sprawdzenie gry w Chrome bez WebGPU)
    ...(o.webgpu !== false ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'] : []),
    ...(o.extraArgs || []),
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
  if (!target) { await closeChrome(chrome, null, profile); throw new Error('Chrome nie wystartował'); }
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
    close: () => closeChrome(chrome, ws, profile) // usuwa też profil z %TEMP% (rdzen-cdp.js)
  };
}

/** --nazwa wartość / --nazwa=wartość / --flaga (wartość '1'). Wartość zaczynająca się od „--” tylko przez „=”. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    out[a.slice(2)] = next !== undefined && !next.startsWith('--') ? next : '1';
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8', '.ktx2': 'image/ktx2'
};

/** Statyczny serwer katalogu repo (bez transformacji — import map rozwiązuje przeglądarka). */
export async function startStaticServer(port = 5330, root = repo) {
  const server = createHttpServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cache-Control': 'no-store'
      });
      createReadStream(p).pipe(res);
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });
  await new Promise((ok) => server.listen(port, ok));
  const base = `http://localhost:${server.address().port}`;
  return { server, base, close: () => new Promise((ok) => server.close(ok)) };
}

/**
 * Logi strony: console (z rdzen-cdp) + Log.entryAdded (walidacja WebGPU, błędy
 * zasobów) + nieudane żądania sieci. Zwraca funkcje do czytania i czyszczenia.
 */
export async function attachLogs(chrome) {
  const { cdp, logs } = chrome;
  const net = [];
  cdp.on((msg) => {
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push(`[log:${e.level}] ${e.source}: ${e.text}${e.url ? ` (${e.url})` : ''}`.slice(0, 3000));
    } else if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) net.push(`[http ${r.status}] ${r.url}`);
    } else if (msg.method === 'Network.loadingFailed') {
      if (!msg.params.canceled) net.push(`[net] ${msg.params.errorText} ${msg.params.type || ''}`);
    }
  });
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  return {
    all: () => [...logs, ...net],
    clear: () => { logs.length = 0; net.length = 0; },
    // Błędy blokujące: wyjątki, console.error, walidacja WebGPU/WGSL, ostrzeżenia three, 404.
    errors: () => [...logs, ...net].filter((l) => /^\[(error|exception|log:error|http|net)\]|\[log:error\]/.test(l)
      || /WebGPU|WGSL|GPUValidationError|Invalid (Render|Compute|Bind|Texture|Buffer|Shader|Sampler|Pipeline)|THREE\.(WebGPURenderer|Renderer|NodeMaterial)/.test(l))
  };
}

/**
 * UUID three z osobnego strumienia losowego (tryb „--uuid osobne” w zrzuty.mjs).
 * generateUUID three woła Math.random() 4× na każdy Object3D, materiał, teksturę, geometrię —
 * a WebGPURenderer także na każdy węzeł TSL (tysiące przy imporcie three/webgpu i przy budowie
 * materiałów). Na wspólnym Math.random z ziarnem (harness-strona.js) przesuwało to losowania
 * gry: świat generowany przy ładowaniu (kąty planet → pozycja statku przy Ziemi) i przebieg
 * scen z nowymi materiałami (wraki, warp) wychodziły inne niż w bazie WebGL. Podmiana idzie
 * w odpowiedzi serwera (CDP Fetch, gra i tag bez zmian): cztery `dN = Math.random() * 0xffffffff | 0`
 * z generateUUID (w paczce Vite `4294967295`) biorą window.__harnessUuidRandom.
 * Wołać PRZED Page.navigate. Zwraca licznik { skrypty, podmienione } do kontroli.
 */
export async function osobneLosowanieUuid(cdp) {
  const WZOR = /(\bd[0-3]\s*=\s*)Math\.random\(\)(\s*\*\s*(?:0xffffffff|4294967295)\s*\|\s*0)/g;
  const stat = { skrypty: 0, podmienione: 0 };
  const dalej = (requestId) => cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
  cdp.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const p = msg.params;
    (async () => {
      stat.skrypty++;
      let body = null;
      if (p.responseStatusCode === 200) {
        try {
          const r = await cdp.send('Fetch.getResponseBody', { requestId: p.requestId });
          body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
        } catch { body = null; }
      }
      if (!body || !body.includes('Math.random()')) return dalej(p.requestId);
      let n = 0;
      const out = body.replace(WZOR, (m, head, tail) => { n++; return `${head}(globalThis.__harnessUuidRandom || Math.random)()${tail}`; });
      // generateUUID ma dokładnie cztery losowania — inna liczba = nie ten kod, zostaw plik.
      if (n !== 4) return dalej(p.requestId);
      stat.podmienione++;
      const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
      await cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers,
        body: Buffer.from(out, 'utf8').toString('base64') }).catch(() => dalej(p.requestId));
    })();
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Script', requestStage: 'Response' }] });
  return stat;
}

/** Czeka, aż wyrażenie w stronie da prawdę. */
export async function waitFor(cdp, expr, timeoutMs = 120000, stepMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evaluate(cdp, expr, 30000)) return true; } catch { /* strona się ładuje */ }
    await sleep(stepMs);
  }
  return false;
}

export async function screenshotPng(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

export function writeJson(file, obj) {
  const p = resolve(repo, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}
