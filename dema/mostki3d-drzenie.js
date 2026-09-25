// Pomiar drżenia modelu 3D mostka względem kadłuba (src/3d/bridge3D.js):
// Vite + headless Chrome przez CDP, demo mostków. Wzorzec: dema/mostki3d-shots.js.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-drzenie.js
//   node ... dema/mostki3d-drzenie.js --only atlas_7M_z2,bellator_7M_z2 --frames 24
//
// Metoda: statek na współrzędnych jak w grze (5–10 mln j.) albo przy zerze,
// kamera co klatkę o DOKŁADNIE 1 px po przekątnej. Obraz rysowany precyzyjnie
// jest wtedy tym samym obrazem przesuniętym o k px, więc po odsunięciu okna
// odczytu o k px każde resztkowe przesunięcie modelu to drżenie. Przesunięcie
// liczy Lucas–Kanade na masce „piksele, które zmienia sam model” (klatka
// z modelem minus bez). Kadłub rysuje tylko głębię (cień modelu i tak pada
// tylko na niego), bloom/promienie/żar wyłączone przez Core3D.setPerfToggles
// (sam zapis do perfToggles passów NIE przełącza) — przejścia ekranowe
// same zmieniają się przy przesunięciu o 1 px. Jasność = RGB × alfa (tak
// widać kanwę na ekranie; samo RGB półprzezroczystego tła to śmieci).
//
// Wyniki: .tmp/mostki3d/drzenie/*.png (klatka 0, mapa różnic), drzenie.json.
// Przed poprawką precyzji (2026-09-24): RMS 0,3–1,0 px, max do 1,7 px przy
// 7–10 mln j.; po: ≤ 0,03 px — tyle co przy zerze.

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
const outDir = resolve(repo, args.out || '.tmp/mostki3d/drzenie');
mkdirSync(outDir, { recursive: true });
const W = 1600;
const H = 900;
const FRAMES = Math.max(4, Number(args.frames) || 16);
const only = args.only ? new Set(args.only.split(',')) : null;

// Start gracza w grze leży ok. (7,08 mln; 6,29 mln); 9,9 mln — krok float32 = 1 j.
const CASES = [
  { id: 'atlas_0_z2', hull: 'atlas', zoom: 2 },
  { id: 'atlas_7M_z2', hull: 'atlas', zoom: 2, far: [7075238.77, 6289731.51] },
  { id: 'atlas_7M_z1', hull: 'atlas', zoom: 1, far: [7075238.77, 6289731.51] },
  { id: 'atlas_zapasowy_7M_z2', hull: 'atlas', zoom: 2, index: 1, far: [7075238.77, 6289731.51] },
  { id: 'atlas_9.9M_z2', hull: 'atlas', zoom: 2, far: [9874885.3, 8289731.4] },
  { id: 'bellator_7M_z2', hull: 'battleship', zoom: 2, far: [7075238.77, 6289731.51] },
  { id: 'ironskull_7M_z2', hull: 'pirate_battleship', zoom: 2, far: [7075238.77, 6289731.51] }
];

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
async function evaluate(cdp, expression, timeout = 240000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

// --- w stronie dema ----------------------------------------------------------
async function probe(opts) {
  const { Core3D } = await import('/src/3d/core3d.js');
  const api = window.__mostki;
  const T = Core3D.perfToggles;
  // Tło zostaje (setPerfToggles z bgPass: false zatrzymuje odświeżanie dema) —
  // maska „z przełączenia modelu” i tak je pomija.
  const toggles = ['bloom', 'shadowShafts', 'heatHaze'];
  const saved = Object.fromEntries(toggles.map((k) => [k, T[k] !== false]));
  Core3D.setPerfToggles(Object.fromEntries(toggles.map((k) => [k, false])));
  api.clock.paused = true;
  api.setup({ hull: opts.hull, spin: 0, drift: 0, shield: false,
    overlays: { grid: false, hardpoints: false, bridgeHexes: false, zone: false, aim: false, info: false } });
  api.model3d(true);
  const t = api.sim.targets.find((e) => e.hullKey === opts.hull);
  const sun = window.SUN;
  const sun0 = sun ? { x: sun.x, y: sun.y } : null;
  if (opts.far) {
    // Słońce jedzie ze statkiem — to samo oświetlenie co przy zerze.
    const dx = opts.far[0] - t.x;
    const dy = opts.far[1] - t.y;
    t.x += dx; t.y += dy;
    if (sun) { sun.x += dx; sun.y += dy; }
  }
  api.renderFrames(4);
  api.zoomModel(opts.hull, opts.zoom, opts.index || 0);
  api.renderFrames(4);
  const hidden = [];
  Core3D.scene.traverse((o) => {
    const m = o.material;
    if (o.isMesh && m && m.uniforms && (m.uniforms.uStressTint || m.uniforms.uLacquerEye) && m.colorWrite !== false) {
      m.colorWrite = false;
      hidden.push(m);
    }
  });
  const c = document.getElementById('c');
  const g = c.getContext('2d', { willReadFrequently: true });
  const RW = 360;
  const RH = 260;
  const R = { x: Math.round(c.width / 2 - RW / 2), y: Math.round(c.height / 2 - RH / 2) };
  const lumOf = (d) => {
    const L = new Float32Array(RW * RH);
    for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3] / 255;
    return L;
  };
  const base = { x: api.cam.x, y: api.cam.y };
  api.model3d(false); api.renderFrames(1);
  const Loff = lumOf(g.getImageData(R.x, R.y, RW, RH).data);
  api.model3d(true); api.renderFrames(2);
  const Lon = lumOf(g.getImageData(R.x, R.y, RW, RH).data);
  const frames = [];
  let firstImg = null;
  for (let k = 0; k < opts.frames; k++) {
    api.cam.x = base.x + k / opts.zoom;
    api.cam.y = base.y + k / opts.zoom;
    api.renderFrames(1);
    const img = g.getImageData(R.x - k, R.y - k, RW, RH);
    if (!firstImg) firstImg = img;
    frames.push(lumOf(img.data));
  }
  for (const m of hidden) m.colorWrite = true;
  Core3D.setPerfToggles(saved);
  if (sun && sun0) { sun.x = sun0.x; sun.y = sun0.y; }

  const mask = new Uint8Array(RW * RH);
  let maskN = 0;
  for (let y = 2; y < RH - 2; y++) {
    for (let x = 2; x < RW - 2; x++) {
      const i = y * RW + x;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(Lon[i + dy * RW + dx] - Loff[i + dy * RW + dx]) > 4) { any = true; break; }
        }
      }
      if (any) { mask[i] = 1; maskN++; }
    }
  }
  const L0 = frames[0];
  const sample = (L, x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (xx, yy) => L[Math.max(0, Math.min(RH - 1, yy)) * RW + Math.max(0, Math.min(RW - 1, xx))];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const res = [];
  for (let k = 1; k < frames.length; k++) {
    const Lk = frames[k];
    // Najpierw przesunięcie całkowite (SSD), potem Lucas–Kanade: Lk(x + δ) ≈ L0(x).
    let best = [0, 0];
    let bestE = Infinity;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        let e = 0;
        for (let y = 4; y < RH - 4; y++) {
          for (let x = 4; x < RW - 4; x++) {
            const i = y * RW + x;
            if (!mask[i]) continue;
            const d = Lk[(y + oy) * RW + x + ox] - L0[i];
            e += d * d;
          }
        }
        if (e < bestE) { bestE = e; best = [ox, oy]; }
      }
    }
    let dx = best[0];
    let dy = best[1];
    for (let it = 0; it < 6; it++) {
      let a = 0; let b = 0; let cc = 0; let ex = 0; let ey = 0;
      for (let y = 4; y < RH - 4; y++) {
        for (let x = 4; x < RW - 4; x++) {
          const i = y * RW + x;
          if (!mask[i]) continue;
          const gx = (sample(Lk, x + dx + 1, y + dy) - sample(Lk, x + dx - 1, y + dy)) * 0.5;
          const gy = (sample(Lk, x + dx, y + dy + 1) - sample(Lk, x + dx, y + dy - 1)) * 0.5;
          const e = sample(Lk, x + dx, y + dy) - L0[i];
          a += gx * gx; b += gx * gy; cc += gy * gy; ex += gx * e; ey += gy * e;
        }
      }
      const det = a * cc - b * b;
      if (Math.abs(det) < 1e-9) break;
      const ux = (cc * ex - b * ey) / det;
      const uy = (a * ey - b * ex) / det;
      dx -= ux; dy -= uy;
      if (Math.hypot(ux, uy) < 1e-3) break;
    }
    let mad = 0;
    let n = 0;
    for (let y = 4; y < RH - 4; y++) {
      for (let x = 4; x < RW - 4; x++) {
        const i = y * RW + x;
        if (!mask[i]) continue;
        mad += Math.abs(Lk[i] - L0[i]);
        n++;
      }
    }
    res.push({ k, dx: +dx.toFixed(3), dy: +dy.toFixed(3), mad: +(mad / Math.max(1, n)).toFixed(3) });
  }
  const mags = res.map((r) => Math.hypot(r.dx, r.dy));
  // Skok między kolejnymi klatkami — to oko widzi jako drżenie.
  const steps = res.map((r, i) => (i ? Math.hypot(r.dx - res[i - 1].dx, r.dy - res[i - 1].dy) : mags[0]));
  const summary = {
    shipX: t.x,
    shipY: t.y,
    maskPx: maskN,
    shiftRmsPx: +Math.sqrt(mags.reduce((q, v) => q + v * v, 0) / mags.length).toFixed(3),
    shiftMaxPx: +Math.max(...mags).toFixed(3),
    stepMaxPx: +Math.max(...steps).toFixed(3),
    madMean: +(res.reduce((q, r) => q + r.mad, 0) / res.length).toFixed(3)
  };
  // Klatka 0 (na czarnym) i mapa różnic ostatniej klatki (czerwony jaśniej,
  // zielony ciemniej, niebieski — maska).
  const cv = document.createElement('canvas');
  cv.width = RW;
  cv.height = RH;
  const cx = cv.getContext('2d');
  const d0 = firstImg.data;
  for (let j = 0; j < d0.length; j += 4) {
    const al = d0[j + 3] / 255;
    d0[j] *= al; d0[j + 1] *= al; d0[j + 2] *= al; d0[j + 3] = 255;
  }
  cx.putImageData(firstImg, 0, 0);
  const png = cv.toDataURL('image/png').split(',')[1];
  const Ln = frames[frames.length - 1];
  const dimg = new ImageData(RW, RH);
  for (let j = 0; j < Ln.length; j++) {
    const d = Ln[j] - L0[j];
    dimg.data[j * 4] = d > 0 ? Math.min(255, d * 8) : 0;
    dimg.data[j * 4 + 1] = d < 0 ? Math.min(255, -d * 8) : 0;
    dimg.data[j * 4 + 2] = mask[j] ? 90 : 0;
    dimg.data[j * 4 + 3] = 255;
  }
  cx.putImageData(dimg, 0, 0);
  const diff = cv.toDataURL('image/png').split(',')[1];
  return { summary, frames: res, png, diff };
}

// --- przebieg -----------------------------------------------------------------
const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5291, strictPort: false } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const dbgPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(tmpdir(), 'mostki3d-drzenie-' + Date.now())}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
  '--disable-gpu-vsync', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });
const logs = [];
const results = [];
let ws;
try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find((x) => x.type === 'page'); } catch { /* Chrome jeszcze wstaje */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Chrome nie wystartował');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[wyjątek] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(`[błąd] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${base}/dema/mostki-demo.html` });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    await sleep(300);
    try { ready = await evaluate(cdp, '!!(window.__mostki && window.__mostki.ready)'); } catch { ready = false; }
  }
  if (!ready) throw new Error('demo mostków nie wstało');
  console.log('przypadek                   RMS px   max px   skok px   różnica');
  for (const cs of CASES) {
    if (only && !only.has(cs.id)) continue;
    const r = await evaluate(cdp, `(${probe.toString()})(${JSON.stringify({ ...cs, frames: FRAMES })})`);
    writeFileSync(join(outDir, `${cs.id}.png`), Buffer.from(r.png, 'base64'));
    writeFileSync(join(outDir, `${cs.id}_roznica.png`), Buffer.from(r.diff, 'base64'));
    const s = r.summary;
    console.log(`${cs.id.padEnd(26)} ${s.shiftRmsPx.toFixed(3).padStart(7)}  ${s.shiftMaxPx.toFixed(3).padStart(7)}  ${s.stepMaxPx.toFixed(3).padStart(8)}  ${s.madMean.toFixed(2).padStart(8)}`);
    results.push({ ...cs, ...s, frames: r.frames });
  }
} finally {
  writeFileSync(join(outDir, 'drzenie.json'), JSON.stringify({ frames: FRAMES, results, logs }, null, 1));
  console.log(`logi błędów: ${logs.length} → ${join(outDir, 'drzenie.json')}`);
  for (const l of logs.slice(0, 12)) console.log('  ', l);
  try { ws?.close(); } catch { /* już zamknięty */ }
  chrome.kill();
  await server.close();
}
