// PRZEŁADUNEK W PORTACH w PRAWDZIWEJ grze (E12, docs/E12-przeladunek.md): ładownie frachtowców ruchu przy
// stanowiskach zatok Ziemi, rój dronów, stoły i taśmociągi, luk Atlasa z ładunkiem gracza; błędy konsoli, pipeline'y
// synchroniczne workera renderu i koszt (A/B z `?przeladunek=0` — przebiegi PO KOLEI, ten sam build).
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/przeladunek-gra.mjs [--query renderWorker=1] [--flaga przeladunek=0] [--demo 1]
//        [--out .tmp/e12/po] [--rozgrzewka 2400] [--postoj 70] [--koszt 1]
//
// Przebieg: start → świat ruchu rozgrzany `--rozgrzewka` s (gospodarka startuje od zera) → gracz przy zatoce
// Ziemi → czekanie na frachtowiec przy stanowisku zatoki (kadłub z ładownią; najlepiej świeżo po przechwycie) →
// kadr kamery nad stanowiskiem (gracz zostaje na zewnątrz) → zrzuty co kilka sekund postoju (wrota, rój, taśmy) →
// szeroki kadr zatoki → luk Atlasa: gracz na wolnym polu MEGA z ładunkiem (`berth-hold` otwiera luk) → koszt
// (worker renderu CPU / GPU w kadrze zatoki; drugi przebieg z `--flaga przeladunek=0` daje „przed”).
// `--demo 1` — przeładunek z ziarna kursu (`?przeladunekDemo=1`), gdy worker ruchu nie wystawia kontraktu E6.
// Wynik: <out>/raport.json, zrzuty <out>/*.png, dziennik workerów <out>/worker.log.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/e12/po');
mkdirSync(out, { recursive: true });
const extra = [args.query || 'renderWorker=1', args.flaga || '', args.demo ? 'przeladunekDemo=1' : ''].filter(Boolean).join('&');
const WARM = Number(args.rozgrzewka || 2400);
const DWELL = Number(args.postoj || 70);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5471));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 25) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query: extra, etapy: {} };
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sessionId = msg.params.sessionId;
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 4000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 4000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const syncWorker = () => workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));

async function waitGame(seconds) {
  let left = Math.max(1, Math.round(seconds * 60));
  while (left > 0) {
    const n = Math.min(120, left);
    await ev(`window.__harness.step(${n}).then(() => true)`, 600000);
    left -= n;
  }
}
const CARGO_HULLS = ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter'];
// Statki ruchu przy stanowiskach zatok z kadłubem z ładownią (faza, zegar postoju, stanowisko).
const dockedFreighters = () => ev(`(() => {
  const tb = window.TrafficBubble; const hulls = ${JSON.stringify(CARGO_HULLS)};
  const f = window.PortCargo.frame;
  return tb.list.filter((a) => a.alive && a.berthId && !a.berthId.includes(':K7-') && hulls.includes(a.hullId)
    && (a.phase === 'docked' || a.phase === 'capture')).map((a) => ({ id: a.id, hull: a.hullId, berth: a.berthId, phase: a.phase,
    dock: +a.dockTime.toFixed(1), x: a.cx, y: a.cy, a: a.ca, len: a.length }));
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&trafficSeed=7&${extra}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  report.syncStart = syncWorker();
  await ev('window.__harness.hold(true)');
  report.przeladunek = await ev('({ on: window.PortCargo.on })');
  console.log('tryb', report.tryb, extra, JSON.stringify(report.przeladunek));

  const tw0 = Date.now();
  await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
  if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');

  // Gracz przy zatoce Z-01 (7 tys. j. na zewnątrz — poza płytą ringu), kadr nad zatoką.
  const spot = await ev(`(() => {
    const berths = window.TrafficV2.tables.bubblePorts.earth;
    const earth = window.TrafficV2.getStation('earth');
    const b = berths.find((x) => x.hall === 'ZATOKA') || berths[0];
    const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
    const x = b.x + dx / d * 7000, y = b.y + dy / d * 7000;
    window.devTeleportTo(x, y, { angle: Math.atan2(-dy, -dx), quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { x, y, berth: b.id, bx: b.x, by: b.y };
  })()`);
  report.spot = spot;
  await waitGame(3);

  // Frachtowiec przy stanowisku zatoki: świeżo zadokowany (wrota przed otwarciem), kadłub z większą ładownią
  // przed promem; po `--szukaj` s — najkrótszy postój, jaki jest.
  const PRIO = { container_ship: 0, long_haul_freighter: 1, heavy_freighter: 2, inter_station_shuttle: 3 };
  let target = null;
  const SEARCH = args.tylkoKoszt ? 0 : Number(args.szukaj || 150);
  for (let k = 0; k < SEARCH && !target; k++) {
    const list = await dockedFreighters();
    const fresh = list.filter((a) => a.dock < 4 && (args.kadlub ? a.hull === args.kadlub : (PRIO[a.hull] < 3 || k > SEARCH * 0.6)))
      .sort((a, b) => (PRIO[a.hull] - PRIO[b.hull]) || (a.dock - b.dock));
    target = fresh[0] || (k >= SEARCH - 1 ? list.sort((a, b) => a.dock - b.dock)[0] : null) || null;
    if (!target) await waitGame(1);
  }
  report.cel = target;
  console.log('cel:', JSON.stringify(target));
  if (target) {
    // Kadr nad stanowiskiem: wysokość kadru ~1,3 długości pola (statek i plac po obu burtach).
    const vh = Math.max(700, target.len * 2.6);
    await ev(`window.PortCargo.look(${target.x}, ${target.y}, ${vh})`);
    await waitGame(0.5);
    const seq = [];
    const t0 = await ev('window.TrafficV2.time');
    for (let i = 0; i <= 14; i++) {
      const st = await ev(`(() => { const a = window.TrafficBubble.byId.get(${target.id}); const f = window.PortCargo.frame;
        const op = f.ops.slice(0, f.opCount).find((o) => o.seed === ${target.id});
        return { t: +(window.TrafficV2.time - ${t0}).toFixed(1), dock: a ? +a.dockTime.toFixed(1) : null, phase: a ? a.phase : null,
          op: op ? { mode: op.mode, fill: +op.fill.toFixed(2), res: op.resourceId, dock: +op.dockTime.toFixed(1) } : null,
          ops: f.opCount, yards: f.yardCount }; })()`);
      seq.push(st);
      // Na zmianę: zbliżenie (statek i plac po burtach) i szerszy kadr pola.
      const close = (i % 2) === 0;
      await ev(`window.PortCargo.look(${target.x}, ${target.y}, ${close ? Math.max(380, target.len * 0.62) : Math.max(900, target.len * 1.6)})`);
      await waitGame(0.6);
      await screenshotPng(cdp, join(out, `10-postoj-${String(i).padStart(2, '0')}${close ? '-blisko' : ''}.png`));
      if (st.phase && st.phase !== 'docked' && st.phase !== 'capture' && i > 2) break;
      await waitGame(DWELL / 14);
    }
    report.etapy.postoj = seq;
    console.log('postój:', JSON.stringify(seq.map((s) => [s.t, s.dock, s.phase, s.op && s.op.mode])));
    // Szeroki kadr zatoki: kilka statków przy stanowiskach.
    await ev(`window.PortCargo.look(${target.x}, ${target.y}, 3200)`);
    await waitGame(1.5);
    await screenshotPng(cdp, join(out, '20-zatoka.png'));
  }

  // Koszt: szeroki kadr zatok (pola, statki przy stanowiskach — `--kosztKadr` j. wysokości) — worker renderu CPU / GPU,
  // liczby z PerfHUD workera. Drugi przebieg z `--flaga przeladunek=0` w tym samym miejscu daje „przed”.
  if (args.koszt !== '0') {
    const c = target || { x: spot.bx, y: spot.by };
    report.kosztKadry = {};
    for (const vh of String(args.kosztKadr || '9000,2600').split(',').map(Number)) {
    await ev(`window.PortCargo.look(${c.x}, ${c.y}, ${vh})`);
    await waitGame(2);
    const costRun = async () => {
      const rows = [];
      for (let i = 0; i < 20; i++) {
        await waitGame(0.25);
        rows.push(await ev(`(() => { const h = window.RenderWorkerHost; if (h && h.readStats) h.readStats(); const st = h ? h.stats : null;
          const f = window.PortCargo.frame;
          return { gpu: st ? st[0] : (window.Core3D.gpuFrameMs || 0), cpu: st ? st[6] : 0, ops: f.opCount, yards: f.yardCount }; })()`));
      }
      const avg = (k) => +(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rows.length).toFixed(3);
      return { gpuMs: avg('gpu'), cpuWorkerMs: avg('cpu'), przeladunkow: avg('ops'), pol: avg('yards') };
    };
    report.koszt = await costRun();
    report.kosztKadry[vh] = report.koszt;
    console.log('koszt kadr', vh, JSON.stringify(report.koszt));
    await screenshotPng(cdp, join(out, `30-koszt-kadr-${vh}.png`));
    }
  }
  if (args.tylkoKoszt) throw new Error('tylko koszt — koniec');

  // Luk Atlasa: gracz na wolnym polu MEGA zatoki z ładunkiem — postój (berth-hold) otwiera luk, kontenery z ładunku.
  await ev(`window.PortCargo.lookEnd()`);
  report.atlas = await ev(`(() => {
    const mass = window.PortCargo.devCargo({ steel: 6, copper_ore: 4, chips: 2 });
    const tb = window.TrafficBubble;
    const busy = new Set(tb.list.filter((a) => a.berthId).map((a) => a.berthId));
    const b = window.TrafficV2.tables.bubblePorts.earth.find((x) => x.hall === 'ZATOKA' && !busy.has(x.id) && /MG\\d$/.test(x.id));
    if (!b) return { mass, berth: null };
    window.devTeleportTo(b.x, b.y, { angle: b.angle, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { mass, berth: b.id };
  })()`);
  await waitGame(9);
  report.atlas.door = await ev('window.PortCargo.playerDoor');
  report.atlas.held = await ev('window.TrafficBubble.held.slice()');
  await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.55; window.DevScene?.syncCamera?.(); return true; })()`);
  await waitGame(1);
  await screenshotPng(cdp, join(out, '40-luk-atlasa.png'));
  console.log('Atlas:', JSON.stringify(report.atlas));

  report.syncKoniec = syncWorker();
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|[vite]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]')).slice(0, 20);
  console.log('pipeline sync workera: start', report.syncStart.length, '| koniec', report.syncKoniec.length - report.syncStart.length,
    report.syncKoniec.slice(report.syncStart.length, report.syncStart.length + 8).join(' ; '));
  console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('  ', l.slice(0, 400));
} catch (err) {
  report.blad = String(err && err.stack || err);
  console.error(err);
} finally {
  clearTimeout(guard);
  writeJson(join(out, 'raport.json'), report);
  writeFileSync(join(out, 'worker.log'), workerLogs.join('\n'));
  try { await chrome.close(); } catch {}
  try { await server.close(); } catch {}
}
