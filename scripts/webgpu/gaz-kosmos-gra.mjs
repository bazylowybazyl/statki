// Gaz w otwartej przestrzeni (src/3d/spaceGas/, port dema gazy-transport — docs/PLAN-gazy-kosmos.md) w PRAWDZIWEJ grze:
// Vite + Chrome z WebGPU (CDP), gra swobodna, Atlas w gęstym polu pasa (miejsce „pole” dema asteroid). Kadry: postój,
// ciąg MAIN (strumień wycina pas w gazie, wał po bokach), kanał po zgaszeniu silnika, oddalenie — każdy z A/B bez gazu
// w tej samej klatce (wejście gry wyłączone: SpaceGasInputTune.enabled). Pipeline'y synchroniczne: strona (tryb off)
// i dziennik workera („[render.worker] pipeline sync”, tryb worker) — ma być 0; błędy konsoli strony i workera;
// koszt GPU z gazem i bez (tryb off — Core3D strony).
//
// Dalej: wybuch przy Atlasie (GameBlasts) i olbrzym pasa (raster przekroju — przeszkoda gazu), ciąg w stronę olbrzyma.
//
//   node scripts/webgpu/gaz-kosmos-gra.mjs [--out .tmp/gaz-kosmos] [--rozmiar 1600x900] [--zoom 0.35] [--query renderWorker=1]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/gaz-kosmos');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.35);
const query = args.query ? `&${args.query}` : '';
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

const { server, base } = await startVite(Number(args.port || 5462));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [], tryb: null };

// konsola workerów (render.worker: pipeline'y sync w klatkach, wyjątki modułów)
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId: msg.params.sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

// Pipeline'y strony utworzone SYNCHRONICZNIE (tryb off) — jak hala-pyl-gra.mjs.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}
(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
    const comp = pu.createComputePipeline;
    if (comp) pu.createComputePipeline = function (p, b) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: true, compute: true, nazwa: (p && p.computeProgram && p.computeProgram.name) || (p && p.name) || 'compute' });
      return comp.call(this, p, b);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
const gas = (on) => ev(`(() => { window.SpaceGasInputTune.enabled = ${on ? 'true' : 'false'}; return true; })()`);
const state = () => ev(`(() => {
  const s = window.ship, c = window.camera, g = window.SpaceGas;
  return { v: Math.round(Math.hypot(s.vel.x, s.vel.y)), zoom: +c.zoom.toFixed(3),
    gaz: report.tryb === 'off' && g ? { ...g.stats, cpuMs: +g.stats.cpuMs.toFixed(3), okno: g.sim ? [g.sim.ox, g.sim.oy] : null } : null,
    gpuMs: +(window.Core3D?.gpuFrameMs ?? 0).toFixed(3) };
})()`.replace('report.tryb', JSON.stringify(report.tryb)));

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(28), JSON.stringify(s));
}
// zrzut w pauzie + A/B bez gazu (ta sama klatka gry; wejście gry wyłączone → render chowa warstwy)
async function shotAB(name) {
  await pause(true);
  await sleep(400);
  await shot(name);
  await gas(false);
  await sleep(400);
  await shot(`${name}-bez`);
  await gas(true);
  await sleep(200);
  await pause(false);
}

const gpuAvg = () => ev(`(async () => {
  const r = [], c = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((q) => setTimeout(q, 50));
    const g = window.Core3D?.gpuFrameMs, k = window.Core3D?.gpuComputeMs;
    if (Number.isFinite(g) && g > 0) r.push(g);
    if (Number.isFinite(k) && k > 0) c.push(k);
  }
  const med = (v) => { v.sort((a, b) => a - b); return v.length ? +v[v.length >> 1].toFixed(3) : null; };
  return { render: med(r), compute: med(c) };
})()`, 60000);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib && !!window.camera && !!window.__beltWorld", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.pipesStart = await ev('window.__pipeRec.pipes.length');
  const workerStart = workerLogs.length;
  console.log('tryb:', report.tryb);

  // Atlas w gęstym polu (dema/asteroidy-webgpu/world.js — miejsca dema liczone z pola gry), trzymany w miejscu.
  report.miejsce = await ev(`(async () => {
    const Wd = await import('/dema/asteroidy-webgpu/world.js');
    const s = Wd.SPOTS.field;
    window.DevScene.teleport(s.x, s.y, -0.4);
    window.DevScene.syncCamera();
    window.__hold = { x: s.x, y: s.y, heading: -0.4, on: true };
    const tick = () => {
      const H = window.__hold;
      if (H.on) { const p = window.ship; p.pos.x = H.x; p.pos.y = H.y; p.vel.x = 0; p.vel.y = 0; p.angle = H.heading; if (p.angVel !== undefined) p.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { x: s.x, y: s.y };
  })()`);
  await setZoom(ZOOM);
  await sleep(5000);   // rozgrzanie pola (3 s × 4 czasu pola), mapy, odgazowanie
  await shotAB('01-postoj');

  await down('w');
  await sleep(3000);
  await shotAB('02-ciag-3s');
  if (report.tryb === 'off') {
    report.gpuZGazem = await gpuAvg();
    await gas(false);
    report.gpuBezGazu = await gpuAvg();
    await gas(true);
    await sleep(3500);
  }
  await up('w');
  await sleep(4000);
  await shotAB('03-kanal-po-4s');
  await sleep(12000);
  await shotAB('04-kanal-po-16s');
  // przelot: okręt puszczony — leci kursem, gaz przed dziobem i ślad za rufą
  await ev('(() => { window.__hold.on = false; return true; })()');
  await down('w');
  await sleep(4000);
  await shotAB('05-przelot');
  await up('w');
  await setZoom(0.1);
  await sleep(1500);
  await shotAB('06-oddalenie');

  // wybuch przy Atlasie (GameBlasts — jak śmierć okrętu): front wydmuchuje dziurę w gazie, wał na brzegu, wyrzut pyłu
  await setZoom(0.22);
  await ev(`(() => { const s = window.ship; window.__hold = { x: s.pos.x, y: s.pos.y, heading: s.angle, on: true };
    const a = s.angle + 1.2; window.GameBlasts.blast({ x: s.pos.x + Math.cos(a) * 2600, y: s.pos.y + Math.sin(a) * 2600, size: 420, profile: 'capital' }); return true; })()`);
  await sleep(700);
  await shotAB('07-wybuch-0.7s');
  await sleep(2500);
  await shotAB('08-wybuch-3s');

  // olbrzym pasa: Atlas przy brzegu najbliższego olbrzyma (raster przekroju — gaz opływa skałę)
  report.olbrzym = await ev(`(async () => {
    const G = window.__beltWorld.giants, s = window.ship;
    let best = null;
    for (const e of G.entries) { const d = Math.hypot(e.x - s.pos.x, e.y - s.pos.y); if (!best || d < best.d) best = { e, d }; }
    const e = best.e;
    const x = e.x - e.halfX - 2500, y = e.y;
    window.__hold = { x, y, heading: 0, on: true };
    window.DevScene.teleport(x, y, 0);
    window.DevScene.syncCamera();
    G.requestNear(x, y);
    const t0 = performance.now();
    while (!(e.giant && e.giant.ready) && performance.now() - t0 < 90000) await new Promise((q) => setTimeout(q, 250));
    return { id: e.id, ready: !!(e.giant && e.giant.ready), half: [Math.round(e.halfX), Math.round(e.halfY)] };
  })()`, 120000);
  console.log('olbrzym:', JSON.stringify(report.olbrzym));
  await setZoom(0.12);
  await sleep(6000);
  await shotAB('09-olbrzym');
  await down('w');
  await sleep(3000);
  await shotAB('10-olbrzym-ciag');
  await up('w');

  const pipes = await ev('window.__pipeRec.pipes');
  report.pipeline = {
    strona: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
    computeStrona: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa),
    worker: workerLogs.slice(workerStart).filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''))
  };
  console.log('pipeline sync po starcie:', JSON.stringify(report.pipeline));
  if (report.gpuZGazem) console.log('GPU klatka [ms]: z gazem', JSON.stringify(report.gpuZGazem), 'bez', JSON.stringify(report.gpuBezGazu));
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(e);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 40);
  report.bledyWorkera = workerLogs.filter((l) => /^\[(error|exception)\]|modFail|nie wyszł/.test(l)).slice(0, 40);
  if (report.bledyStrony.length) console.log('błędy strony:\n  ' + report.bledyStrony.join('\n  '));
  if (report.bledyWorkera.length) console.log('błędy workera:\n  ' + report.bledyWorkera.join('\n  '));
  writeJson(join(out, 'wynik.json'), report);
  await chrome.close();
  await server.close();
  console.log('gotowe:', out);
}
