// Zrzuty i pomiary dema mostków: Vite + headless Chrome przez CDP (bez
// zależności — WebSocket z Node 22). Wzorzec: scripts/halo-ring-shots.mjs.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-shots.js
//   node ... dema/mostki-shots.js --only zones,seq --size 1600x900
//   node ... dema/mostki-shots.js --smoke        (tylko: czy demo wstaje bez błędów)
//
// Wyniki: .tmp/mostki/*.png, results.json (statystyki, histogramy HDR, błędy).

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repo, args.out || '.tmp/mostki');
mkdirSync(outDir, { recursive: true });
const [W, H] = (args.size || '1600x900').split('x').map(Number);
const only = args.only ? new Set(args.only.split(',')) : null;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  on(fn) { this.handlers.push(fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, expression, timeout = 180000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

async function shot(cdp, name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(png.data, 'base64'));
}

// Scenariusze: setup → akcje → zrzut (+ pomiar).
const SCENES = [
  { id: 'zones', steps: [
    ['setup', { hull: 'all', overlays: { zone: true, bridgeHexes: true, hardpoints: true, info: false, aim: false }, returnFire: false }],
    ['frames', 30], ['shot', 'strefy_wszystkie']
  ] },
  ...['battleship', 'pirate_battleship', 'atlas'].map((hull) => ({ id: `zone_${hull}`, steps: [
    ['setup', { hull, overlays: { zone: true, bridgeHexes: true, hardpoints: true, info: false, aim: false, grid: false }, returnFire: false }],
    ['frames', 20], ['shot', `strefa_${hull}`],
    ['zoomBridge', hull, 3.0], ['frames', 20], ['shot', `strefa_${hull}_zoom`],
    ['setup', { hull, overlays: { zone: false, bridgeHexes: false, hardpoints: false, info: false, aim: false }, returnFire: false }],
    ['zoomBridge', hull, 3.0], ['frames', 20], ['shot', `okna_${hull}`],
    ['hdr', `okna_${hull}`, hull], ['windows', `okna_${hull}`, hull]
  ] })),
  { id: 'dig', steps: [
    ['setup', { hull: 'battleship', weapon: 'armata_mk1', gun: 'rufa', lock: true, overlays: { zone: true, bridgeHexes: true, info: true, aim: true }, returnFire: true }],
    ['advance', 6, true], ['shot', 'ostrzal_bellator_rufa_6s'],
    ['advance', 30, true, 'fast'], ['shot', 'ostrzal_bellator_rufa_36s'],
    ['stats', 'dig']
  ] },
  { id: 'seq', steps: [
    // Czysty kill od rufy: działko ciężkie, lock na mostek (pula wyłączona na
    // czas ostrzału — shootBridge), potem kadry sekwencji utraty dowodzenia.
    ['setup', { hull: 'battleship', weapon: 'heavy_autocannon', gun: 'rufa', drift: 40, spin: 1.5, overlays: { zone: false, bridgeHexes: false, hardpoints: false, grid: false, info: false, aim: false }, returnFire: true }],
    ['advance', 1.0, false],
    ['zoomShip', 'battleship', 1.25, -60], ['frames', 2], ['shot', 'smierc_0_przed'],
    ['shootBridge2', 'battleship', 'heavy_autocannon'],
    ['zoomShip', 'battleship', 1.25, -60],
    ['advance', 0.05, false], ['shot', 'smierc_1_t0.05'],
    ['hdr', 'wyrzut_t0.05', null],
    ['advance', 0.3, false], ['shot', 'smierc_2_t0.35'],
    ['hdr', 'wyrzut_t0.35', null],
    ['advance', 0.6, false], ['shot', 'smierc_3_t0.95'],
    ['advance', 1.0, false], ['shot', 'smierc_4_t1.95'],
    ['advance', 2.0, false], ['shot', 'smierc_5_t3.95'],
    ['setup', { hull: 'battleship', gun: 'rufa', overlays: { info: true, zone: true, bridgeHexes: true } }], ['shootBridge2', 'battleship', 'heavy_autocannon'], ['advance', 0.6, false], ['shot', 'smierc_hud'],
    ['stats', 'seq']
  ] },
  { id: 'seq_pirate', steps: [
    ['setup', { hull: 'pirate_battleship', gun: 'skos', drift: 25, spin: -1, overlays: { zone: false, bridgeHexes: false, hardpoints: false, grid: false, info: false, aim: false }, returnFire: true }],
    ['zoomBridge', 'pirate_battleship', 1.6], ['advance', 0.5, false], ['shot', 'pirat_0_przed'],
    ['shootBridge', 'pirate_battleship'], ['advance', 0.3, false], ['shot', 'pirat_1_t0.3'],
    ['advance', 1.2, false], ['shot', 'pirat_2_t1.5']
  ] },
  { id: 'seq_atlas', steps: [
    ['setup', { hull: 'atlas', variant: 'rufowy_z_zapasowym', gun: 'burta', drift: 0, spin: 0, overlays: { zone: true, bridgeHexes: false, hardpoints: false, grid: false, info: true, aim: false }, returnFire: true }],
    ['frames', 10], ['shot', 'atlas_0_przed'],
    ['shootBridgeOne', 'atlas', 0], ['advance', 0.4, false], ['shot', 'atlas_1_glowny_stracony'],
    ['shootBridgeOne', 'atlas', 1], ['advance', 1.0, false], ['shot', 'atlas_2_oba_stracone'],
    ['stats', 'atlas']
  ] },
  { id: 'far', steps: [
    ['setup', { hull: 'all', overlays: { zone: false, info: false, aim: false }, zoom: 0.18 }],
    ['frames', 20], ['shot', 'z_daleka'], ['hdr', 'z_daleka_calosc', null]
  ] }
];

async function run() {
  const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5241, strictPort: false } });
  await server.listen();
  const base = `http://localhost:${server.httpServer.address().port}`;
  const profile = join(tmpdir(), `mostki-shots-${Date.now()}`);
  const dbgPort = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-webgpu',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--hide-scrollbars',
    `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });
  const results = { size: [W, H], scenes: {}, logs: [] };
  let cdp = null;
  let ws = null;
  try {
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* czekam na Chrome */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome nie wystartował');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok) => ws.addEventListener('open', ok));
    cdp = new Cdp(ws);
    cdp.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        results.logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 1500));
      }
      if (msg.method === 'Runtime.exceptionThrown') results.logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/dema/mostki-demo.html?shot=1&hull=battleship` });
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      await sleep(200);
      try { ready = await evaluate(cdp, '!!(window.__mostki && window.__mostki.ready)'); } catch { ready = false; }
    }
    if (!ready) throw new Error('demo nie wstało (timeout)');
    results.gpu = await evaluate(cdp, `(() => { const gl = window.__mostki && document.getElementById('webgl-layer').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null, webgpu: !!navigator.gpu }; })()`);
    await evaluate(cdp, 'window.__mostki.clock.paused = false, true');
    await sleep(1500);
    results.boot = await evaluate(cdp, 'window.__mostki.stats()');
    console.log('demo wstało:', JSON.stringify(results.gpu), 'błędy:', results.boot.errors.length, 'logi:', results.logs.length);
    if (args.smoke) {
      await shot(cdp, 'smoke');
      return;
    }
    if (args.eval) {
      // Debug: dowolne wyrażenie w stronie (np. --eval "window.__mostki.stats()").
      const value = await evaluate(cdp, args.eval, 900000);
      console.log(JSON.stringify(value, null, 1));
      if (args.shot) await shot(cdp, args.shot);
      return;
    }
    // Sterujemy symulacją ręcznie (deterministyczne klatki).
    await evaluate(cdp, 'window.__mostkiFreeze = true, true');
    for (const scene of SCENES) {
      if (only && !only.has(scene.id)) continue;
      const rec = { shots: [], hdr: {}, stats: {} };
      for (const [op, a, b, c] of scene.steps) {
        if (op === 'setup') await evaluate(cdp, `window.__mostki.freeze(true), window.__mostki.setup(${JSON.stringify(a)})`);
        else if (op === 'frames') await evaluate(cdp, `window.__mostki.advance(${a / 60}, { fire: false })`);
        // Każda klatka renderowana: cząstki Fx3D i wyrzut mostka starzeją się/
        // emitują tylko w renderFrame (bez tego kadry pokazują „zamrożony” opar).
        else if (op === 'advance') await evaluate(cdp, `window.__mostki.advance(${a}, { fire: ${b ? 'true' : 'false'}, render: ${c === 'fast' ? 'false' : 'true'} })`);
        else if (op === 'zoomBridge') await evaluate(cdp, `window.__mostki.zoomBridge(${JSON.stringify(a)}, ${b})`);
        else if (op === 'zoomShip') await evaluate(cdp, `window.__mostki.zoomShip(${JSON.stringify(a)}, ${b}, ${c || 0})`);
        else if (op === 'shootBridge2') {
          const r = await evaluate(cdp, `window.__mostki.shootBridge(${JSON.stringify(a)}, ${JSON.stringify(b)}, 3000)`);
          console.log(`  ostrzał mostka ${a} (${b}): ${r.shots} pocisków, utrata dowodzenia: ${r.commandLost}`);
        }
        else if (op === 'killBridge') await evaluate(cdp, `window.__mostki.killBridge(${JSON.stringify(a)})`);
        else if (op === 'killBridgeOne') await evaluate(cdp, `window.__mostki.killBridge(${JSON.stringify(a)}, ${b})`);
        else if (op === 'shootBridge') {
          const r = await evaluate(cdp, `window.__mostki.shootBridge(${JSON.stringify(a)})`);
          console.log(`  ostrzał mostka ${a}: ${r.shots} pocisków, utrata dowodzenia: ${r.commandLost}`);
        } else if (op === 'shootBridgeOne') {
          // Działko, nie Valkyrie: impulsy Valkyrie po poprawce sondy rozrywają
          // kadłub Atlasa w poprzek (docs/PORT-mostki.md) — tu ma być czysty kill.
          const r = await evaluate(cdp, `window.__mostki.shootBridge(${JSON.stringify(a)}, 'heavy_autocannon', 5000, ${b})`);
          console.log(`  ostrzał mostka ${a}[${b}]: ${r.shots} pocisków, padł: ${r.bridgeDead}, utrata dowodzenia: ${r.commandLost}`);
        } else if (op === 'windows') {
          const r = await evaluate(cdp, `window.__mostki.measureWindows(${JSON.stringify(b)})`);
          rec.hdr[`${a}_okna`] = r;
          console.log(`  OKNA ${a}: pikseli okien ${r.windowPixels}, >0,9: ${r.windowPixelsOver09}, max ${r.maxWithWindows.toFixed(2)}, p50 ${r.p50.toFixed(2)} p90 ${r.p90.toFixed(2)} p99 ${r.p99.toFixed(2)}; kadłub >0,9 bez okien: ${r.hullPixelsOver09WithoutWindows}`);
        }
        else if (op === 'shot') { await evaluate(cdp, 'window.__mostki.renderFrames(1), true'); await shot(cdp, a); rec.shots.push(a); console.log(`  zrzut ${a}`); }
        else if (op === 'hdr') {
          const expr = b ? `window.__mostki.measureHDR(window.__mostki.bridgeRect(${JSON.stringify(b)}))` : 'window.__mostki.measureHDR(null)';
          rec.hdr[a] = await evaluate(cdp, expr);
          const h = rec.hdr[a];
          console.log(`  HDR ${a}: max ${h.max.toFixed(2)} p99 ${h.p99.toFixed(2)} p999 ${h.p999.toFixed(2)} >0,9: ${(h.overFraction * 100).toFixed(2)}% NaN ${h.nanOrInf}`);
        } else if (op === 'stats') rec.stats[a] = await evaluate(cdp, 'window.__mostki.stats()');
      }
      results.scenes[scene.id] = rec;
    }
    if (args.bench) {
      console.log('benchmark w przeglądarce…');
      results.bench = await evaluate(cdp, `window.__mostki.runBench({ hulls: ['battleship', 'pirate_battleship', 'atlas'], weapons: ['heavy_autocannon', 'special_valkyrie_railgun'], dirs: ['burta', 'rufa'], maxShots: 3000 })`, 900000);
    }
  } finally {
    results.finalErrors = cdp ? await evaluate(cdp, 'window.__mostki ? window.__mostki.stats().errors : []').catch(() => []) : [];
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
    try { ws?.close(); } catch { /* */ }
    chrome.kill();
    await server.close();
    console.log(`logi konsoli: ${results.logs.length}, błędy dema: ${(results.finalErrors || []).length} → ${join(outDir, 'results.json')}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
