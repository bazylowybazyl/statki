// Zrzuty i pomiary modelu 3D mostka (src/3d/bridge3D.js): Vite + headless
// Chrome przez CDP (bez zależności — WebSocket z Node 22), wzorzec
// dema/mostki-shots.js.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-shots.js
//   node ... dema/mostki3d-shots.js --only bellator,atlas --size 1600x900
//   node ... dema/mostki3d-shots.js --smoke        (czy demo wstaje bez błędów)
//   node ... dema/mostki3d-shots.js --only bench   (174 okręty: draw calle, ms)
//
// Wyniki: .tmp/mostki3d/*.png, results.json (statystyki, pasma HDR, błędy).

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
const outDir = resolve(repo, args.out || '.tmp/mostki3d');
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

async function evaluate(cdp, expression, timeout = 300000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

async function shot(cdp, name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(png.data, 'base64'));
}

// Kadry: zbliżenie na model, cały kadłub, uszkodzony, hulk, wrak.
const HULLS = {
  bellator: { key: 'battleship', close: 5.0, far: 0.9, gun: 'rufa' },
  ironskull: { key: 'pirate_battleship', close: 5.0, far: 0.9, gun: 'skos' },
  atlas: { key: 'atlas', close: 3.2, far: 0.45, gun: 'rufa', dmgWeapon: 'armata_mk1', dmgIntegrity: 0.85, quickKill: true },
  // Reszta floty. killDirect — strefa niszczona wprost (killBridge), bez
  // tysięcy strzałów w wielkie mostki; małe kadłuby dostają ostrzał.
  custos: { key: 'frigate', close: 12, far: 5.5, gun: 'rufa', dmgIntegrity: 0.75 },
  hasta: { key: 'destroyer', close: 9, far: 3.6, gun: 'rufa', dmgIntegrity: 0.8 },
  citadella: { key: 'terran_carrier', close: 5.5, far: 0.95, gun: 'rufa', dmgIntegrity: 0.85, killDirect: true },
  colossus: { key: 'terran_supercapital', close: 2.4, far: 0.62, gun: 'rufa', dmgWeapon: 'armata_mk1', dmgIntegrity: 0.9, killDirect: true },
  // Zbliżenia ≤ 12: powyżej ~14 warstwa FG (okna) wypada przed near kamery perspektywicznej.
  pirate_frigate: { key: 'pirate_frigate', close: 12, far: 5.5, gun: 'rufa', dmgIntegrity: 0.75 },
  pirate_destroyer: { key: 'pirate_destroyer', close: 9, far: 2.8, gun: 'skos', dmgIntegrity: 0.8 },
  megafreighter: { key: 'megafreighter', close: 1.9, far: 0.36, gun: 'rufa', dmgWeapon: 'armata_mk1', dmgIntegrity: 0.9, killDirect: true }
};

const NO_OVERLAYS = { zone: false, bridgeHexes: false, hardpoints: false, grid: false, info: false, aim: false };

function hullScene(id, h) {
  const k = JSON.stringify(h.key);
  const steps = [
    ['setup', { hull: h.key, gun: h.gun, drift: 0, spin: 0, overlays: NO_OVERLAYS, returnFire: false }],
    ['frames', 20],
    ['eval', `window.__mostki.zoomModel(${k}, ${h.close}, 0)`], ['frames', 4], ['shot', `${id}_1_caly_zblizenie`],
    ['windows', `${id}_okna`],
    ['hdr', `${id}_powierzchnia`],
    ['eval', `window.__mostki.model3d(false)`], ['frames', 2], ['shot', `${id}_0_szczeliny_zblizenie`],
    ['eval', `window.__mostki.model3d(true)`],
    ['eval', `window.__mostki.zoomShip(${k}, ${h.far}, 0)`], ['frames', 4], ['shot', `${id}_1_caly_kadlub`]
  ];
  if (h.key === 'atlas') {
    steps.push(['eval', `window.__mostki.zoomModel(${k}, 5.0, 1)`], ['frames', 4], ['shot', `${id}_1_zapasowy_zblizenie`]);
  }
  steps.push(
    ['eval', `window.__mostki.damageBridge(${k}, { weapon: '${h.dmgWeapon || 'heavy_autocannon'}', integrity: ${h.dmgIntegrity || 0.8}, maxShots: 3000 })`, 'uszkodzenie'],
    ['frames', 30],
    ['eval', `window.__mostki.zoomModel(${k}, ${h.close}, 0)`], ['frames', 4], ['shot', `${id}_2_uszkodzony_zblizenie`],
    ['eval', `window.__mostki.zoomShip(${k}, ${h.far}, 0)`], ['frames', 4], ['shot', `${id}_2_uszkodzony_kadlub`]
  );
  if (h.quickKill) {
    // Atlas: najpierw pada rufowy — okna gasną falą od wyrwy, zapasowy dowodzi.
    steps.push(
      ['eval', `(window.__mostki.killBridge(${k}, 0), window.__mostki.stats().targets)`, 'rufowy padł'],
      ['eval', `window.__mostki.zoomShip(${k}, ${h.far}, 0)`], ['advance', 1.6], ['shot', `${id}_2b_rufowy_padl_zapasowy_dowodzi`],
      ['eval', `(window.__mostki.killBridge(${k}, 1), window.__mostki.stats().targets)`, 'utrata dowodzenia']
    );
  } else if (h.killDirect) {
    steps.push(['eval', `(window.__mostki.killBridge(${k}), window.__mostki.stats().targets)`, 'utrata dowodzenia']);
  } else {
    steps.push(['eval', `window.__mostki.shootBridge(${k}, 'heavy_autocannon', 5000)`, 'utrata dowodzenia']);
  }
  steps.push(
    ['eval', `window.__mostki.zoomModel(${k}, ${h.close}, ${h.quickKill ? 1 : 0})`],
    ['advance', 0.3], ['shot', `${id}_3_hulk_t0.3`],
    ['advance', 1.2], ['shot', `${id}_3_hulk_t1.5`],
    ['eval', `window.__mostki.zoomShip(${k}, ${h.far}, 0)`], ['frames', 1], ['shot', `${id}_3_hulk_t1.5_kadlub`],
    ['advance', 3.0], ['eval', `window.__mostki.zoomModel(${k}, ${h.close}, 0)`], ['frames', 2], ['shot', `${id}_4_wrak_t4.5`],
    ['eval', `window.__mostki.zoomModel(${k}, ${h.far}, 0)`], ['frames', 1], ['shot', `${id}_4_wrak_t4.5_kadlub`],
    ['eval', `window.__mostki.bridge3D()`, 'model'],
    ['stats', `${id}`]
  );
  return { id, steps };
}

// Wolna kamera (free3d): wysokość modelu widoczna pod kątem.
function freeScene() {
  const steps = [];
  for (const [id, h] of Object.entries(HULLS)) {
    const k = JSON.stringify(h.key);
    steps.push(
      ['setup', { hull: h.key, gun: h.gun, drift: 0, spin: 0, overlays: NO_OVERLAYS, returnFire: false }],
      ['frames', 10],
      ['eval', `window.__mostki.freeCam(${k}, { dist: ${h.key === 'atlas' ? 260 : 150}, elevDeg: 32, azDeg: 215 })`], ['frames', 3], ['shot', `${id}_5_free3d_rufa`],
      ['eval', `window.__mostki.freeCam(${k}, { dist: ${h.key === 'atlas' ? 260 : 150}, elevDeg: 24, azDeg: 30 })`], ['frames', 3], ['shot', `${id}_5_free3d_dziob`],
      ['eval', 'window.__mostki.orthoCam()']
    );
  }
  return { id: 'free3d', steps };
}

// 174 okręty: koszt CPU, draw calle, GPU — z modelem i bez.
// Mieszana flota ze wszystkimi rodzajami mostków (174 okręty, 2026-09-25).
const FLEET_174 = {
  frigate: 40, pirate_frigate: 32, destroyer: 30, pirate_destroyer: 30, battleship: 14, pirate_battleship: 14,
  terran_carrier: 6, terran_supercapital: 4, atlas: 3, megafreighter: 1
};

const BENCH = { id: 'bench', steps: [
  ['bench', 'bitwa_174'],
  ['shot', 'bitwa_174_flota'],
  ['bench', 'bitwa_174_mieszana', FLEET_174],
  ['shot', 'bitwa_174_mieszana']
] };

const SCENES = [
  ...Object.entries(HULLS).map(([id, h]) => hullScene(id, h)),
  freeScene(),
  BENCH
];

async function run() {
  const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5251, strictPort: false } });
  await server.listen();
  const base = `http://localhost:${server.httpServer.address().port}`;
  const profile = join(tmpdir(), `mostki3d-shots-${Date.now()}`);
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
        results.logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2500));
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
    results.gpu = await evaluate(cdp, `(() => { const gl = document.getElementById('webgl-layer').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null, timer: !!(gl && gl.getExtension('EXT_disjoint_timer_query_webgl2')) }; })()`);
    await evaluate(cdp, 'window.__mostki.clock.paused = false, true');
    await sleep(1500);
    results.boot = await evaluate(cdp, 'window.__mostki.stats()');
    results.boot3d = await evaluate(cdp, 'window.__mostki.bridge3D()');
    console.log('demo wstało:', JSON.stringify(results.gpu), 'błędy:', results.boot.errors.length, 'logi:', results.logs.length);
    console.log('model 3D:', JSON.stringify(results.boot3d.stats));
    if (args.smoke) {
      await evaluate(cdp, 'window.__mostki.freeze(true), window.__mostki.setup({ hull: "all", overlays: { zone: false, bridgeHexes: false, hardpoints: false, info: false, aim: false } }), window.__mostki.advance(0.3), true');
      await shot(cdp, 'smoke');
      for (const [key, zoom] of [['battleship', 5], ['pirate_battleship', 5], ['atlas', 3.2]]) {
        await evaluate(cdp, `window.__mostki.zoomModel(${JSON.stringify(key)}, ${zoom}, 0), window.__mostki.renderFrames(2), true`);
        await shot(cdp, `smoke_${key}`);
      }
      results.smoke3d = await evaluate(cdp, 'window.__mostki.bridge3D()');
      return;
    }
    if (args.eval) {
      const value = await evaluate(cdp, args.eval, 900000);
      console.log(JSON.stringify(value, null, 1));
      if (args.shot) await shot(cdp, args.shot);
      return;
    }
    await evaluate(cdp, 'window.__mostki.freeze(true), true');
    for (const scene of SCENES) {
      if (only && !only.has(scene.id)) continue;
      const rec = { shots: [], hdr: {}, evals: {}, stats: {} };
      for (const [op, a, b] of scene.steps) {
        if (op === 'setup') await evaluate(cdp, `window.__mostki.freeze(true), window.__mostki.setup(${JSON.stringify(a)})`);
        else if (op === 'frames') await evaluate(cdp, `window.__mostki.advance(${a / 60}, { fire: false })`);
        else if (op === 'advance') await evaluate(cdp, `window.__mostki.advance(${a}, { fire: false })`);
        else if (op === 'eval') {
          const v = await evaluate(cdp, a);
          if (b) { rec.evals[b] = v; console.log(`  ${b}: ${JSON.stringify(v).slice(0, 400)}`); }
        } else if (op === 'shot') {
          await evaluate(cdp, 'window.__mostki.renderFrames(1), true');
          await shot(cdp, a);
          rec.shots.push(a);
          console.log(`  zrzut ${a}`);
        } else if (op === 'windows') {
          const r = await evaluate(cdp, 'window.__mostki.measureWindows3D()');
          rec.hdr[a] = r;
          console.log(`  OKNA ${a}: pikseli ${r.windowPixels}, >0,9: ${r.windowPixelsOver09}, max ${r.maxWithWindows.toFixed(2)}, p50 ${r.p50.toFixed(2)} p90 ${r.p90.toFixed(2)} p99 ${r.p99.toFixed(2)}; powierzchnia bez okien max ${r.surfaceMax.toFixed(2)}, >0,9: ${r.surfacePixelsOver09}`);
        } else if (op === 'hdr') {
          const h = await evaluate(cdp, 'window.__mostki.measureHDR({ x: 1600 * 0.25, y: 900 * 0.25, w: 800, h: 450 })');
          rec.hdr[a] = h;
          console.log(`  HDR ${a}: max ${h.max.toFixed(2)} p99 ${h.p99.toFixed(2)} p999 ${h.p999.toFixed(2)} >0,9: ${(h.overFraction * 100).toFixed(2)}% NaN ${h.nanOrInf}`);
        } else if (op === 'stats') rec.stats[a] = await evaluate(cdp, 'window.__mostki.stats()');
        else if (op === 'bench') {
          const r = await evaluate(cdp, `window.__mostki.bench174(${b ? JSON.stringify({ counts: b }) : ''})`, 900000);
          rec.evals[a] = r;
          console.log(`  BENCH ${a}: okrętów ${r.ships}, rekordów ${r.records}; podpięcie ${r.adoptRecords} rekordów w jednej klatce: ${r.adoptMs} ms`);
          for (const v of r.views) {
            console.log(`   zoom ${v.zoom}: model: update ${v.on.updateMs} ms (p90 ${v.on.updateP90}), render ${v.on.drawMs} ms, hexShips ${v.on.hexMs} ms, klatka ${v.on.frameMs} ms, GPU ${v.on.gpuMs} ms (${v.on.gpuSamples}), ortho ${v.on.orthoCalls}, fg ${v.on.fgCalls}, instancji ${v.on.instances}, emiterów ${v.on.emitters}, calli modelu ${v.on.drawCalls}`);
            console.log(`             bez:   update ${v.off.updateMs} ms, render ${v.off.drawMs} ms, hexShips ${v.off.hexMs} ms, klatka ${v.off.frameMs} ms, GPU ${v.off.gpuMs} ms (${v.off.gpuSamples}), ortho ${v.off.orthoCalls}, fg ${v.off.fgCalls}`);
          }
        }
      }
      results.scenes[scene.id] = rec;
    }
  } finally {
    results.finalErrors = cdp ? await evaluate(cdp, 'window.__mostki ? window.__mostki.stats().errors : []').catch(() => []) : [];
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
    try { ws?.close(); } catch { /* */ }
    chrome.kill();
    await server.close();
    console.log(`logi konsoli: ${results.logs.length}, błędy dema: ${(results.finalErrors || []).length} → ${join(outDir, 'results.json')}`);
    if (results.logs.length) console.log(results.logs.slice(0, 8).join('\n'));
    if ((results.finalErrors || []).length) console.log(results.finalErrors.slice(0, 4).join('\n'));
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
