// Światła nawigacyjne w PRAWDZIWEJ grze (src/data/shipNavLights.js, src/3d/tsl/navBlink.js): Atlas gracza z sąsiadami
// po obu burtach na zatrzymanym zegarze. Kadry w chwili pełnego błysku Atlasa i między błyskami; pomiar obrazu: na kadłubie
// sąsiada z lewej burty przybywa czerwieni, z prawej zieleni tylko w błysku; styl ostrzegawczy na Atlasie; zoom daleki;
// flota w bitwie (lampy nie migają równo). Pipeline'y tworzone w klatkach — oczekiwane 0, błędy konsoli / WebGPU.
//
//   node scripts/webgpu/lampy-gra.mjs [--out .tmp/webgpu/lampy-gra] [--port 5362] [--query renderWorker=1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';
import { readPng } from './png.mjs';

const args = parseArgs();
const port = Number(args.port || 5362);
const query = args.query ? `&${args.query}` : '';
const out = resolve(repo, args.out || '.tmp/webgpu/lampy-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
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

const result = { tryb: args.query || 'off', pomiary: {}, zrzuty: [] };

// Zegar stoi; skok do chwili `u` cyklu lampy Atlasa, kilka przerysowań w tej samej chwili, zrzut.
const shotAt = async (name, u) => {
  const t = await ev(`(async () => { const H = window.__harness; const s = window.__LampyScene;
    const now = window.__frameNowMs;
    const code = s.Nav.navBlinkCode(s.pattern(), s.Nav.navPhaseOf(ship));
    const id = Math.floor(code);
    const P = s.Nav.NAV_BLINK_PATTERNS[id].period;
    const x = (now * 0.001) / P + (code - id);
    let du = ${u} - (x - Math.floor(x));
    if (du < 0.02) du += 1;
    await H.step(1, du * P * 1000);
    await H.frames(3);
    return { t: window.__frameNowMs * 0.001, jasnosc: s.Nav.navBlinkValue(window.__frameNowMs * 0.001, code) };
  })()`);
  const file = join(out, `${name}.png`);
  await screenshotPng(cdp, file);
  result.zrzuty.push(name);
  console.log('zrzut', name, 'jasność lampy Atlasa', t.jasnosc.toFixed(3));
  return { file, ...t };
};

// Średnie R / G / B prostokąta kadru [px].
function meanRgb(file, r) {
  const img = readPng(file);
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = Math.max(0, r.y0); y < Math.min(img.height, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(img.width, r.x1); x++) {
      const i = (y * img.width + x) * 4;
      R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; n++;
    }
  }
  return { r: R / Math.max(1, n), g: G / Math.max(1, n), b: B / Math.max(1, n) };
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await new Promise((r) => setTimeout(r, 1500));
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Atlas w głębokim kosmosie, Bellator przy lewej burcie, Citadella przy prawej — stoją; gracz bez broni.
  result.pomiary.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x5eac); S.hideHud(true);
    const Nav = await import('/src/data/shipNavLights.js');
    const Run = await import('/src/game/shipLightRuntime.js');
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    ship.angle = 0; if (ship.vel) { ship.vel.x = 0; ship.vel.y = 0; }
    if (window.fireControl) window.fireControl.posture = 'hold';
    const spawn = (key, x, y) => { const before = new Set(npcs); spawnCallInShip(key, { mode: 'dummy', pos: { x, y }, spawnPos: { x, y }, spawnAngle: 0 }); return npcs.find((n) => !before.has(n)); };
    const port = spawn('battleship', ${DEEP.x} - 150, ${DEEP.y} - 760);
    const stbd = spawn('carrier', ${DEEP.x} + 100, ${DEEP.y} + 950);
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    await H.step(30);
    window.__LampyScene = { Nav, Run, port, stbd, pattern: () => Run.getEntityLights(ship).position[0]?.blink || 0 };
    const block = Run.getEntityLights(ship);
    return { lampyAtlasa: block.position.length, reflektory: block.road.length + block.flood.length, lampyBellatora: Run.getEntityLights(port).position.length, lampyCitadelli: Run.getEntityLights(stbd).position.length, fazaAtlasa: Nav.navPhaseOf(ship), fazaBellatora: Nav.navPhaseOf(port), fazaCitadelli: Nav.navPhaseOf(stbd) };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.pomiary.scena));

  await ev(`(async () => { window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42); await window.__harness.frames(3); return true; })()`);
  const pos = await ev(`(() => { const s = window.__LampyScene; return { port: { x: s.port.x, y: s.port.y }, stbd: { x: s.stbd.x, y: s.stbd.y } }; })()`);
  // Kawałki kadłubów sąsiadów od strony Atlasa: rufa Bellatora, dziób Citadelli [px, zoom 0,42, środek kadru = Atlas].
  const px = (p, dx0, dy0, dx1, dy1) => {
    const sx = 800 + (p.x - DEEP.x) * 0.42, sy = 450 + (p.y - DEEP.y) * 0.42;
    return { x0: Math.round(sx + dx0), y0: Math.round(sy + dy0), x1: Math.round(sx + dx1), y1: Math.round(sy + dy1) };
  };
  const rects = { port: px(pos.port, -100, 25, 100, 70), stbd: px(pos.stbd, -40, -190, 40, -90) };
  result.pomiary.prostokaty = rects;

  const flash = await shotAt('1-blysk', 0.025);
  const dark = await shotAt('2-przerwa', 0.6);
  const m = {
    blysk: { sasiadLewy: meanRgb(flash.file, rects.port), sasiadPrawy: meanRgb(flash.file, rects.stbd) },
    przerwa: { sasiadLewy: meanRgb(dark.file, rects.port), sasiadPrawy: meanRgb(dark.file, rects.stbd) }
  };
  result.pomiary.oswietlenie = m;
  const gain = (a, b, k) => a[k] - b[k];
  console.log('sąsiad z lewej burty: przyrost R', gain(m.blysk.sasiadLewy, m.przerwa.sasiadLewy, 'r').toFixed(2), 'G', gain(m.blysk.sasiadLewy, m.przerwa.sasiadLewy, 'g').toFixed(2));
  console.log('sąsiad z prawej burty: przyrost R', gain(m.blysk.sasiadPrawy, m.przerwa.sasiadPrawy, 'r').toFixed(2), 'G', gain(m.blysk.sasiadPrawy, m.przerwa.sasiadPrawy, 'g').toFixed(2));

  // Zbliżenie na dziób Atlasa, drugi błysk „blink blink”.
  await ev(`(async () => { window.__harness.scene.cam(${DEEP.x} + 640, ${DEEP.y}, 1.15); await window.__harness.frames(3); return true; })()`);
  await shotAt('3-dziob-blysk', 0.025);
  await shotAt('4-dziob-przerwa', 0.6);
  await shotAt('5-dziob-drugi-blysk', 0.155);

  // Daleko: lampy dalej widać (min. rozmiar billboardu).
  await ev(`(async () => { window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.14); await window.__harness.frames(3); return true; })()`);
  await shotAt('6-daleko-blysk', 0.025);

  // Styl ostrzegawczy na Atlasie (statki konstrukcyjne): burty na przemian.
  await ev(`(async () => { DevScene.navStyl('warning'); window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42); await window.__harness.step(2); await window.__harness.frames(3); return window.__LampyScene.pattern(); })()`);
  await shotAt('7-zolte-lewa', 0.1);
  await shotAt('8-zolte-prawa', 0.6);
  await ev(`(async () => { DevScene.navStyl('aviation'); await window.__harness.step(2); return true; })()`);

  result.pipelineStrona = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))`));
  console.log('pipeline sync strona:', result.pipelineStrona.length, result.pipelineStrona.slice(0, 12));
} finally {
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => /\[error\]|\[exception\]/.test(l)).slice(0, 40);
  const syncLines = workerLogs.filter((l) => /pipeline sync/.test(l));
  result.pipelineWorker = syncLines.length;
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length, 'pipeline sync workera:', syncLines.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', String(e).slice(0, 300));
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  await chrome.close();
  await server.close();
}
