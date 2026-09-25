// Test modelu 3D mostka w SAMEJ grze (index.html) — headless Chrome przez CDP,
// bez zależności (WebSocket z Node 22). Nowa gra → modele na Atlasie gracza →
// ciężka flota piracka obok gracza → zniszczenie mostka pirata → hulk → po 4 s
// model na wraku. Zrzuty .tmp/mostki3d/gra_*.png, wynik na konsoli.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-gra.js
//
// Gracz startuje w cieniu Ziemi — kadry są ciemne; wygląd ocenia demo
// (dema/mostki3d-shots.js), tu sprawdzamy haki i przejście na wrak.
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, '.tmp/mostki3d');
mkdirSync(outDir, { recursive: true });
const W = 1600; const H = 900;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(JSON.stringify(msg.error))); else ok(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    });
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, fail) => this.pending.set(id, { ok, fail })); }
  on(fn) { this.handlers.push(fn); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(cdp, expression, timeout = 120000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}
async function shot(cdp, name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(png.data, 'base64'));
  console.log('zrzut', name);
}

const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5261, strictPort: false } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const dbgPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(tmpdir(), 'gra-mostki3d-' + Date.now())}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu-vsync', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const logs = [];
let ws;
try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* */ }
    if (!target) await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(`[error] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${base}/index.html?reset` });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    await sleep(300);
    try { ready = await evaluate(cdp, '!!(window.ship && window.Bridge3D && document.getElementById("btn-new-game"))'); } catch { ready = false; }
  }
  console.log('gra wczytana:', ready, 'Bridge3D.ready:', await evaluate(cdp, 'window.Bridge3D.ready'));
  await evaluate(cdp, 'document.getElementById("btn-new-game").click(), true');
  await sleep(800);
  await evaluate(cdp, 'document.getElementById("btn-mode-single").click(), true');
  await sleep(9000);
  const s1 = await evaluate(cdp, `(() => { const s = window.ship; return { hull: s.bridgeState ? s.bridgeState.hullKey : null, bridges: s.bridgeState ? s.bridgeState.bridges.map(b => b.id + ':' + b.total) : null, model3D: s.bridgeState ? s.bridgeState.model3D : null, stats: window.Bridge3D.stats, zoom: window.camera ? window.camera.zoom : null }; })()`);
  console.log('gracz:', JSON.stringify(s1));
  await shot(cdp, 'gra_0_gracz');
  // Piraci: flota ciężka przy najbliższej stacji, pancerniki przeniesione obok gracza.
  const s2 = await evaluate(cdp, `(() => {
    const s = window.ship;
    const st = (window.stations || []).slice().sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y))[0];
    window.spawnPirateHeavyFleet(st);
    const bs = window.npcs.filter(n => n.isPirate && n.type === 'battleship' && !n.dead);
    const spots = [[-1330, -120], [1330, -120], [0, -720]];
    bs.forEach((n, i) => { const p = spots[i % 3]; n.x = s.pos.x + p[0]; n.y = s.pos.y + p[1]; n.angle = 0; n.vx = 0; n.vy = 0; n.angVel = 0; n.state = 'idle'; n.warpData = null; n.isCollidable = true; });
    return { station: st ? st.name || st.id : null, battleships: bs.length };
  })()`);
  console.log('piraci:', JSON.stringify(s2));
  await evaluate(cdp, '(() => { const c = window.camera; if (!c) return false; c.zoom = 0.62; c.targetZoom = 0.62; c.manualZoom = true; return true; })()');
  await sleep(5000);
  const s3 = await evaluate(cdp, `(() => { const bs = window.npcs.filter(n => n.isPirate && n.type === 'battleship' && !n.dead); return { withBridge: bs.filter(n => n.bridgeState).length, model3D: bs.map(n => n.bridgeState ? n.bridgeState.model3D : null), stats: window.Bridge3D.stats, records: window.Bridge3D.records.map(r => r.kind.name + '@' + (r.host.isWreck ? 'wrak' : (r.host === window.ship ? 'gracz' : 'npc'))) }; })()`);
  console.log('po spawnie:', JSON.stringify(s3));
  await shot(cdp, 'gra_1_piraci');
  // Mostek pierwszego pirata: niszczymy heksy strefy (jak tunel) → hulk → po 4 s wrak.
  const s4 = await evaluate(cdp, `(() => {
    const n = window.npcs.find(n => n.isPirate && n.type === 'battleship' && !n.dead && n.bridgeState);
    if (!n) return { none: true };
    const b = n.bridgeState.bridges[0];
    const need = Math.ceil(b.total * b.def.killFrac) + 2;
    for (let i = 0; i < need; i++) { const sh = b.shards[i]; if (sh && sh.active) window.DestructorSystem.destroyShard(n, sh); }
    window.__testPirate = n;
    return { id: n.id, killed: need, total: b.total };
  })()`);
  console.log('mostek pirata:', JSON.stringify(s4));
  await sleep(1500);
  const s5 = await evaluate(cdp, `(() => { const n = window.__testPirate; if (!n) return null; return { commandLost: !!(n.bridgeState && n.bridgeState.commandLost), dead: n.dead, stats: window.Bridge3D.stats }; })()`);
  console.log('hulk?', JSON.stringify(s5));
  await shot(cdp, 'gra_2_hulk');
  await sleep(6000);
  const s6 = await evaluate(cdp, `(() => { const n = window.__testPirate; if (!n) return null; return { dead: n.dead, hasBridgeState: !!n.bridgeState, wrecks: (window.wrecks || []).length, records: window.Bridge3D.records.map(r => r.kind.name + '@' + (r.host.isWreck ? 'wrak' : (r.host === window.ship ? 'gracz' : 'npc')) + ':row' + r.row) }; })()`);
  console.log('po agonii:', JSON.stringify(s6));
  await shot(cdp, 'gra_3_wrak');

  // Reszta floty z mostkami (2026-09-25): Terra Nova, piraci, lokomotywa
  // megafrachtowca. Okręty obok gracza, kamera z daleka; sprawdzamy klucz
  // mostka, strefę i model na każdym typie.
  const s7 = await evaluate(cdp, `(() => {
    const s = window.ship;
    const st = (window.stations || []).slice().sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y))[0];
    const before = new Set(window.npcs);
    window.spawnSupportShip('frigate_laser', { mode: 'friendly' });
    window.spawnSupportShip('destroyer', { mode: 'friendly' });
    window.spawnFriendlyCarrier();
    window.spawnFriendlySupercapital();
    window.spawnPirateSquad(st, 'frigate_laser', 1);
    window.spawnPirateSquad(st, 'destroyer', 1);
    window.spawnMegafreighterTrain({ mode: 'friendly' });
    const fresh = window.npcs.filter((n) => !before.has(n) && !n.dead);
    const spots = { frigate: [-1500, -1150], destroyer: [-650, -1150], carrier: [-1300, 1350], supercapital: [900, 1450] };
    const pirateSpots = { frigate: [300, -1150], destroyer: [1200, -1150] };
    for (const n of fresh) {
      const type = String(n.type || '');
      const key = type.includes('frigate') ? 'frigate' : type;
      const p = (n.isPirate ? pirateSpots : spots)[key];
      if (!p) continue;
      n.x = s.pos.x + p[0]; n.y = s.pos.y + p[1];
      if (n.pos) { n.pos.x = n.x; n.pos.y = n.y; }
      n.angle = 0; n.vx = 0; n.vy = 0; n.angVel = 0; n.state = 'idle'; n.warpData = null;
    }
    window.__fleetTest = fresh;
    return fresh.map((n) => n.type + (n.isPirate ? '/pirat' : ''));
  })()`);
  console.log('flota:', JSON.stringify(s7));
  await evaluate(cdp, '(() => { const c = window.camera; if (!c) return false; c.zoom = 0.3; c.targetZoom = 0.3; c.manualZoom = true; return true; })()');
  await sleep(9000);
  const s8 = await evaluate(cdp, `(() => (window.__fleetTest || []).filter((n) => !n.dead).map((n) => ({
    type: n.type + (n.isPirate ? '/pirat' : ''),
    hex: !!n.hexGrid,
    key: n.bridgeState ? n.bridgeState.hullKey : null,
    bridges: n.bridgeState ? n.bridgeState.bridges.map((b) => b.id + ':' + b.total) : null,
    model3D: n.bridgeState ? n.bridgeState.model3D : null,
    records: (n.__bridge3D || []).map((r) => r.kind.name + ':row' + r.row + 'x' + r.rowCount)
  })))()`);
  console.log('flota po podpięciu:');
  for (const r of s8) console.log('  ', JSON.stringify(r));
  console.log('Bridge3D:', JSON.stringify(await evaluate(cdp, 'window.Bridge3D.stats')));
  await shot(cdp, 'gra_4_flota');
} finally {
  console.log('logi błędów:', logs.length);
  for (const l of logs.slice(0, 12)) console.log('  ', l);
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  await server.close();
}
