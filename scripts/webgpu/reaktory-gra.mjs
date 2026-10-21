// Reaktory w obudowach NAD kadłubem w PRAWDZIWEJ grze (src/3d/reactor3D.js, reguła mostki-reaktor): flota Terra
// Novy (Custos, Hasta, Bellator, Citadella, Colossus), pancernik piratów i Atlas gracza — reaktor widoczny na
// wierzchu, obudowa zamknięta; potem Bellator: wyrwa w komorze (ODSŁONIĘTY — sektory pokrywy zdjęte), stopienie
// (ReactorGame.forceMeltdown — pęknięcia i żar), detonacja. Zrzuty, miejsca rdzeni (marker PNG, komora, obudowa),
// pipeline'y tworzone w klatkach (strona: __harness.pipes; worker: dziennik „[render.worker] pipeline sync”) —
// oczekiwane 0, błędy konsoli / WebGPU.
//
//   node scripts/webgpu/reaktory-gra.mjs [--out .tmp/webgpu/reaktory-gra] [--port 5361] [--query renderWorker=1]
//        [--tylko custos,hasta,...] [--bez-stopienia 1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5361);
const query = args.query ? `&${args.query}` : '';
const out = resolve(repo, args.out || '.tmp/webgpu/reaktory-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
// okręty: klucz szablonu wezwania, odstęp w szeregu, zoom zbliżenia na obudowę i zoom całego okrętu
const SHIPS = [
  { name: 'custos', key: 'frigate_pd', zoom: 4.2, whole: 1.6 },
  { name: 'hasta', key: 'destroyer', zoom: 3.2, whole: 1.1 },
  { name: 'bellator', key: 'battleship', zoom: 1.5, whole: 0.55 },
  { name: 'citadella', key: 'carrier', zoom: 1.3, whole: 0.33 },
  { name: 'colossus', key: 'supercapital', zoom: 1.0, whole: 0.24 },
  { name: 'pirat', key: 'pirate_battleship', zoom: 1.4, whole: 0.5 }
];
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
// konsola workera renderu (pipeline'y sync w klatkach)
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

const result = { tryb: args.query || 'off', zrzuty: [], okrety: {}, etapy: {} };
const shot = async (name) => {
  await ev('window.__harness.frames(3)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  result.zrzuty.push(name);
  console.log('zrzut', name);
};
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
  await ev(`(async () => {
    window.__RC = await import('/src/game/reactorCore.js');
    window.__RCG = await import('/src/game/reactorCoreGame.js');
    return true;
  })()`);

  // Szereg okrętów w głębokim kosmosie (dummy — stoją), gracz z boku.
  result.etapy.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x5eac); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y} + 9000, 0);
    if (window.fireControl) window.fireControl.posture = 'hold';
    const list = ${JSON.stringify(SHIPS)};
    const placed = {};
    let x = ${DEEP.x} - 6000;
    for (const s of list) {
      const before = new Set(npcs);
      spawnCallInShip(s.key, { mode: 'dummy', pos: { x, y: ${DEEP.y} }, spawnPos: { x, y: ${DEEP.y} }, spawnAngle: 0 });
      const e = npcs.find((n) => !before.has(n));
      if (e) { e.__harnessName = s.name; placed[s.name] = e; }
      x += s.name === 'colossus' ? 3200 : s.name === 'citadella' ? 2400 : 1600;
    }
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    await H.step(20);
    window.__R = placed;
    const rep = {};
    for (const [name, e] of Object.entries(placed)) {
      const c = e.reactorCores && e.reactorCores[0];
      const hull = __RC.reactorHull(e);
      rep[name] = c ? {
        typ: e.type, hullId: e.__reactorHullId, marker: c.marker, komora: Math.round(c.gridR * 10) / 10, komorek: c.cellX.length,
        automat: (() => { const img = hull?.visualImage; return hull ? __RCG.autoReactorMarker(e, Number(img?.naturalWidth || img?.width) || hull.srcWidth, Number(img?.naturalHeight || img?.height) || hull.srcHeight) : null; })(),
        komorka: hull ? hull.body.cellSize : null, obudowa: c.model, stan: c.state, niewazny: c.invalid
      } : { typ: e.type, hullId: e.__reactorHullId, brak: true };
    }
    return rep;
  })()`, 300000);
  console.log('rdzenie', JSON.stringify(result.etapy.scena, null, 1));
  result.okrety = result.etapy.scena;

  for (const s of SHIPS) {
    if (only && !only.has(s.name)) continue;
    const ok = await ev(`(async () => { const e = window.__R[${JSON.stringify(s.name)}]; if (!e || !e.reactorCores?.[0]) return false;
      const f = __RC.reactorCoreFrame(e.reactorCores[0], {});
      window.__harness.scene.cam(f.x, f.y, ${s.zoom}); await window.__harness.frames(3); return true; })()`);
    if (!ok) { console.log('brak', s.name); continue; }
    await shot(`${s.name}-a-obudowa`);
    if (s.name === 'bellator' && !args.query) {
      // A/B cienia obudowy na kadłubie (tryb off: strojenie modułu strony)
      await ev('window.__reactor3DTune.shadow = false');
      await shot(`${s.name}-a-obudowa-bez-cienia`);
      await ev('window.__reactor3DTune.shadow = true');
    }
    await ev(`(async () => { const e = window.__R[${JSON.stringify(s.name)}];
      window.__harness.scene.cam(e.x, e.y, ${s.whole}); await window.__harness.frames(3); return true; })()`);
    await shot(`${s.name}-b-okret`);
  }

  // Atlas gracza
  await ev(`(async () => { const c = ship.reactorCores && ship.reactorCores[0]; if (!c) return false;
    const f = __RC.reactorCoreFrame(c, {}); window.__harness.scene.cam(f.x, f.y, 1.1); await window.__harness.frames(3); return true; })()`);
  result.etapy.atlas = await ev(`(() => { const c = ship.reactorCores?.[0]; return c ? { marker: c.marker, komora: c.gridR, obudowa: c.model, stan: c.state } : null; })()`);
  await shot('atlas-a-obudowa');
  await ev(`(async () => { window.__harness.scene.cam(ship.pos.x, ship.pos.y, 0.3); await window.__harness.frames(3); return true; })()`);
  await shot('atlas-b-okret');

  const kStart = await ev('window.__harness.frameLog.n');
  const workerStart = workerLogs.length;
  if (!args['bez-stopienia']) {
    // Bellator: wyrwa w komorze (jak test exposedHull — krater w środku komory)
    result.etapy.odsloniecie = await ev(`(async () => { const e = window.__R.bellator, H = window.__harness; const c = e.reactorCores[0];
      const w = __RC.reactorCoreWorld(c, {});
      window.__harness.scene.cam(w.x, w.y, 1.5);
      HullBodies.impact(e, w.x + c.gridR * 0.5, w.y, 1, null, { craterRadius: c.gridR * 0.4 });
      await H.step(12);
      return { stan: c.state, martwe: c.deadCount, oslona: Math.round(c.integrity * 100) / 100 };
    })()`);
    console.log('odsłonięcie', JSON.stringify(result.etapy.odsloniecie));
    await shot('bellator-c-odsloniety');
    result.etapy.stopienie = await ev(`(async () => { const e = window.__R.bellator, H = window.__harness; const c = e.reactorCores[0];
      const ok = ReactorGame.forceMeltdown(e, 4, 'jet'); await H.step(2);
      return { ok, stan: c.state, czas: c.meltdownDuration };
    })()`);
    console.log('stopienie', JSON.stringify(result.etapy.stopienie));
    await ev('window.__harness.step(90)');
    await shot('bellator-d-stopienie-40');
    await ev('window.__harness.step(105)');
    await shot('bellator-e-stopienie-85');
    result.etapy.detonacja = await ev(`(async () => { const e = window.__R.bellator, H = window.__harness; const c = e.reactorCores[0];
      let f = 0; for (; f < 240 && c.state !== 'detonated'; f++) await H.step(1);
      await H.step(20);
      return { klatek: f, stan: c.state, martwy: !!e.dead };
    })()`);
    console.log('detonacja', JSON.stringify(result.etapy.detonacja));
    await shot('bellator-f-po-detonacji');
    // Pirat: stopienie przy zamkniętej pokrywie (pęknięcia przez kratę)
    await ev(`(async () => { const e = window.__R.pirat, H = window.__harness; const c = e.reactorCores[0]; const w = __RC.reactorCoreWorld(c, {});
      window.__harness.scene.cam(w.x, w.y, 1.4); ReactorGame.forceMeltdown(e, 5, 'orb'); await H.step(200); return true; })()`);
    await shot('pirat-c-stopienie');
  }
  await ev('window.__harness.step(10)');
  result.etapy.kompilacjeWKlatce = JSON.parse(await ev(`JSON.stringify(window.__harness.pipes.list.filter((p) => p.k >= ${kStart} && (p.budowa ? !p.poza : (p.sync || p.compute))).map((p) => (p.budowa ? 'budowa ' : p.compute ? '' : 'sync ') + p.nazwa + (p.ms ? ' ' + p.ms + ' ms' : '')))`));
  result.etapy.syncStronaCalosc = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))`));
  result.etapy.syncWorker = workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
  result.etapy.syncWorkerPoStarcie = workerLogs.slice(workerStart).filter((l) => l.includes('pipeline sync')).length;
  console.log('kompilacje w klatkach (strona, od etapu uszkodzeń):', result.etapy.kompilacjeWKlatce.length, result.etapy.kompilacjeWKlatce.slice(0, 12));
  console.log('pipeline sync strona (cała sesja):', result.etapy.syncStronaCalosc.length, result.etapy.syncStronaCalosc.slice(0, 12));
  console.log('pipeline sync worker (cała sesja):', result.etapy.syncWorker.length, result.etapy.syncWorker.slice(0, 12));
} finally {
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', e.slice(0, 300));
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(out, 'worker.log'), workerLogs.join('\n'));
  await chrome.close();
  await server.close();
}
