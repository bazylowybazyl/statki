// Łuki i iskry przy ranach zasilanej części kadłuba (src/3d/powerArcsFx3D.js) w PRAWDZIWEJ grze:
//   • Bellator Terra Novy (NPC, PRACA) z kraterami (HullBodies.impact w węzłach wnętrza), kadr bliski — zrzuty klatek,
//     w których poszły łuki (cały kadr i wycinek 2×), zrzut pokazowy przy podniesionym tempie (`--pokaz 0` — bez);
//   • ten sam okręt WYŁĄCZONY (ShipPower.off → gaszenie 2 s → WYŁ.): 10 s bez łuków, zrzuty; po włączeniu (rozruch 5 s)
//     łuki wracają;
//   • koszt CPU modułu na klatkę (µs: owinięcie PowerArcsFx3D.update — na stronie albo w workerze renderu), pipeline'y
//     synchroniczne strony i workera (ma być 0), błędy konsoli.
//
//   node scripts/webgpu/luki-ran-gra.mjs [--out .tmp/webgpu/luki-ran-gra] [--port 5366] [--query renderWorker=1] [--pokaz 0]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5366);
const query = args.query ? `&${args.query}` : '';
const worker = /renderWorker=1/.test(args.query || '');
const out = resolve(repo, args.out || `.tmp/webgpu/luki-ran-gra${worker ? '-worker' : ''}`);
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const SHIP = { x: DEEP.x + 200, y: DEEP.y - 1400 };

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
let rwSession = null;
let rwId = 990000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget' && /render.worker/.test(msg.params.targetInfo?.url || '')) rwSession = msg.params.sessionId;
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

/** Wyrażenie w sesji workera renderu (odpowiedź przez cdp.pending — Cdp nie podaje słuchaczom wiadomości bez metody). */
function evalWorker(expr, timeout = 20000) {
  if (!rwSession) return Promise.resolve('brak sesji workera renderu');
  const id = ++rwId;
  return new Promise((res) => {
    const timer = setTimeout(() => { cdp.pending.delete(id); res('limit czasu'); }, timeout);
    cdp.pending.set(id, {
      ok: (r) => { clearTimeout(timer); res(r?.result?.value ?? r?.exceptionDetails?.exception?.description ?? null); },
      reject: (e) => { clearTimeout(timer); res(String(e && e.message || e)); }
    });
    cdp.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', sessionId: rwSession, params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
}

// Moduł łuków tam, gdzie rysuje się obraz (strona w trybie off, worker w trybie gracza): `fn` — ciało funkcji z `P`
// (PowerArcsFx3D) i `T` (POWER_ARCS_TUNE), zwraca JSON.
async function inArcs(fn) {
  const body = `const P = m.PowerArcsFx3D, T = m.POWER_ARCS_TUNE; return JSON.stringify((() => { ${fn} })());`;
  const r = worker
    ? await evalWorker(`import(new URL('../3d/powerArcsFx3D.js', self.location.href).href).then((m) => { ${body} }).catch((e) => String(e && e.stack || e))`)
    : await ev(`import('/src/3d/powerArcsFx3D.js').then((m) => { ${body} }).catch((e) => String(e && e.stack || e))`);
  try { return JSON.parse(r); } catch { return r; }
}
// Zegar ściany: na stronie harness podmienia performance.now na czas wirtualny (realNow — prawdziwy), w workerze — zwykły.
const WRAP = `if (!P.__orig) { P.__orig = P.update; P.__t = { sum: 0, n: 0, max: 0, sumArc: 0, nArc: 0, sumIdle: 0, nIdle: 0 };
  const clock = (globalThis.__harness && globalThis.__harness.realNow) || performance.now.bind(performance);
  P.update = function (a, b) { const t = clock(); this.__orig(a, b); const d = (clock() - t) * 1000; const q = this.__t;
    q.sum += d; q.n++; if (d > q.max) q.max = d; if (this.stats.frameArcs > 0) { q.sumArc += d; q.nArc++; } else { q.sumIdle += d; q.nIdle++; } }; }
  return true;`;
const resetCost = () => inArcs('const q = P.__t; for (const k in q) q[k] = 0; return true;');
const readCost = () => inArcs(`const q = P.__t, s = P.stats; return { klatek: q.n, srednioUs: +(q.sum / Math.max(1, q.n)).toFixed(1), maksUs: +q.max.toFixed(1),
  zLukiemUs: +(q.sumArc / Math.max(1, q.nArc)).toFixed(1), klatekZLukiem: q.nArc, bezLukuUs: +(q.sumIdle / Math.max(1, q.nIdle)).toFixed(1),
  luki: s.arcs, powtorne: s.restrikes, iskry: s.sparks, swiatla: s.lights, przeglady: s.scans, okrety: s.hulls, brzegi: s.edges, maksWKlatce: s.maxFrameArcs };`);
const arcsTotal = async () => { const r = await inArcs('return P.stats.arcs;'); return Number(r) || 0; };

const result = { tryb: args.query || 'off', kroki: {}, zrzuty: [], bledyAsercji: [] };
const check = (ok, what) => { if (!ok) result.bledyAsercji.push(what); console.log(ok ? 'OK  ' : 'BŁĄD', what); };
const shot = async (name, crop = true) => {
  await ev('window.__harness.frames(3)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  result.zrzuty.push(name);
  if (crop) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 400, y: 225, width: 800, height: 450, scale: 2 } });
    writeFileSync(join(out, `${name}-2x.png`), Buffer.from(data, 'base64'));
    result.zrzuty.push(`${name}-2x`);
  }
};
const stepN = (n) => ev(`window.__harness.step(${n})`, 300000);

/** Kroki pojedynczo, zrzut w klatkach z nowym łukiem (do `want` zrzutów, najwyżej `maxSteps`). */
async function shotsWithArcs(prefix, want, maxSteps) {
  let got = 0;
  let last = await arcsTotal();
  for (let k = 0; k < maxSteps && got < want; k++) {
    await stepN(1);
    const now = await arcsTotal();
    if (now > last) {
      got++;
      await shot(`${prefix}-${String(got).padStart(2, '0')}`);
    }
    last = now;
  }
  return got;
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1717};\n${INJECT}` });
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
  if (worker && !rwSession) console.log('UWAGA: brak sesji workera renderu (CDP)');

  // Atlas w głębokim kosmosie, Bellator Terra Novy (sojusznik, PRACA) 1,4 km obok — uśpiony jak w fabule (bez AI i walki;
  // cel ćwiczebny „dummy” byłby celem broni AUTO Atlasa i dostawałby nowe rany w trakcie przebiegu).
  result.kroki.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x5ea7);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    ship.angle = 0; if (ship.vel) { ship.vel.x = 0; ship.vel.y = 0; }
    const before = new Set(npcs);
    spawnCallInShip('battleship', { mode: 'friendly', pos: { x: ${SHIP.x}, y: ${SHIP.y} }, spawnPos: { x: ${SHIP.x}, y: ${SHIP.y} }, spawnAngle: 0.35 });
    const bel = npcs.find((n) => !before.has(n));
    if (bel) { bel.ai = null; bel.combatDisabled = true; bel.command = null; bel.target = null; bel.forceTarget = null; }
    window.__Luki = { bel };
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    await H.step(60);
    return { bel: !!bel, hull: !!(bel && bel.beamHull), x: bel && bel.x, y: bel && bel.y };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.kroki.scena));
  if (!result.kroki.scena.hull) throw new Error('Bellator bez kadłuba belkowego');
  check(await inArcs(WRAP) === true, `pomiar kosztu w ${worker ? 'workerze' : 'stronie'}`);

  // Kratery w węzłach wnętrza (8 żywych sąsiadów) — jak trafienia ciężkiej broni.
  result.kroki.kratery = await ev(`(async () => { const e = window.__Luki.bel, HB = window.HullBodies, h = e.beamHull;
    const b = h.body, s = b.nodeStore, d = b.dims, cs = b.cellSize;
    const at = new Map(); for (let i = 0; i < s.count; i++) if (s.active[i]) at.set(s.ix[i] + s.iy[i] * d.x, i);
    const spots = [[0.32, 0.5, 2.2], [0.58, 0.38, 1.8], [0.74, 0.6, 1.6], [0.48, 0.66, 1.5]];
    const res = [];
    for (const [fx, fy, cr] of spots) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < s.count; i++) {
        if (!s.active[i]) continue;
        let full = true;
        for (let oy = -1; oy <= 1 && full; oy++) for (let ox = -1; ox <= 1; ox++) if (!at.has(s.ix[i] + ox + (s.iy[i] + oy) * d.x)) { full = false; break; }
        if (!full) continue;
        const dd = (s.ix[i] - fx * d.x) ** 2 + (s.iy[i] - fy * d.y) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best < 0) continue;
      const p = HB.nodeWorld(h, best, { x: 0, y: 0 });
      res.push(HB.impact(e, p.x, p.y, 1e6, null, { craterRadius: cr * cs }));
      for (let i = 0; i < s.count; i++) if (s.active[i]) at.set(s.ix[i] + s.iy[i] * d.x, i); else at.delete(s.ix[i] + s.iy[i] * d.x);
    }
    await window.__harness.step(2);
    return { trafienia: res, wezly: b.activeNodes, z: s.count, cs, dims: d, x: e.x, y: e.y };
  })()`);
  console.log('kratery', JSON.stringify(result.kroki.kratery));
  const B = result.kroki.kratery;
  await ev(`window.__harness.scene.cam(${B.x}, ${B.y}, 1.0)`);
  await ev('window.__harness.frames(4)');

  // 1. PRACA, tempo domyślne: zrzuty klatek z łukami, potem koszt na 10 s.
  const got = await shotsWithArcs('1-praca-luki', 4, 600);
  check(got >= 3, `zrzuty z łukami w pracy (${got})`);
  await resetCost();
  const a0 = await arcsTotal();
  await stepN(600);
  result.kroki.praca = await readCost();
  result.kroki.praca.lukiW10s = (await arcsTotal()) - a0;
  console.log('praca 10 s', JSON.stringify(result.kroki.praca));
  check(result.kroki.praca.lukiW10s > 0, `łuki w pracy: ${result.kroki.praca.lukiW10s} / 10 s`);
  check(result.kroki.praca.maksWKlatce <= 3, `budżet klatki (${result.kroki.praca.maksWKlatce} ≤ 3)`);

  // 2. Pokaz: tempo podniesione (sam obraz do oceny — nie ustawienie gry).
  if (args.pokaz !== '0') {
    await inArcs('T.rateMin = 18; T.rateMax = 18; return true;');
    await stepN(20);
    await shot('2-pokaz-tempo-18');
    await stepN(7);
    await shot('2-pokaz-tempo-18b');
    await inArcs('T.rateMin = 0.35; T.rateMax = 2.2; return true;');
  }

  // 3. Wyłączony: gaszenie 2 s → WYŁ., 10 s bez łuków; zrzuty w tych samych odstępach.
  await ev('(() => { window.ShipPower.off(window.__Luki.bel); return true; })()');
  await stepN(150);
  const st = await ev('window.ShipPower.state(window.__Luki.bel)');
  check(st === 0, `Bellator WYŁ. (stan ${st})`);
  const off0 = await arcsTotal();
  for (let k = 0; k < 4; k++) { await stepN(150); await shot(`3-wylaczony-${String(k + 1).padStart(2, '0')}`); }
  const offArcs = (await arcsTotal()) - off0;
  result.kroki.wylaczony = { luki: offArcs };
  check(offArcs === 0, `wyłączony okręt nie iskrzy (${offArcs} łuków / 10 s)`);

  // 4. Włączony: rozruch 5 s (bez łuków do PRACY), potem łuki wracają.
  await ev('(() => { window.ShipPower.on(window.__Luki.bel); return true; })()');
  const on0 = await arcsTotal();
  await stepN(290);
  const duringStartup = (await arcsTotal()) - on0;
  check(duringStartup === 0, `rozruch bez łuków (${duringStartup})`);
  await stepN(60);
  const st2 = await ev('window.ShipPower.state(window.__Luki.bel)');
  check(st2 === 2, `po rozruchu PRACA (stan ${st2})`);
  const back = await shotsWithArcs('4-po-wlaczeniu', 1, 600);
  check(back >= 1, 'po włączeniu łuki wracają');

  result.pipelineStrona = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))`));
  console.log('pipeline sync strona:', result.pipelineStrona.length, result.pipelineStrona.slice(0, 12));
} finally {
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => /\[error\]|\[exception\]/.test(l)).slice(0, 40);
  const syncLines = workerLogs.filter((l) => /pipeline sync/.test(l));
  result.pipelineWorker = syncLines.length;
  result.pipelineWorkerLista = syncLines.slice(0, 20);
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length, 'pipeline sync workera:', syncLines.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', String(e).slice(0, 300));
  console.log('asercje nieudane:', result.bledyAsercji.length);
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  await chrome.close();
  await server.close();
}
