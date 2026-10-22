// Doki portów bez ringu (E14) w prawdziwej grze: po jednym porcie każdego rodzaju budowli (krzyż, okrąg, koło z wlotem)
// — kadr z góry na całą budowlę ze statkami na stanowiskach, zbliżenie na stanowisko, w kole statek w szczelinie;
// do tego pipeline'y synchroniczne (strona i worker renderu), błędy konsoli i kolizja gracza z bryłą.
//
//   node scripts/webgpu/doki-portow-gra.mjs [--query renderWorker=1] [--out .tmp/e14] [--porty io,mercury,ceres]
//        [--rozgrzewka 2400] [--postoj 8] [--szczelina 240] [--krzyz 1800] [--krzyzMin 1] [--port 5463]
//
// Świat ruchu ziarno 7 rozgrzany `--rozgrzewka` s gry (kursy w portach), zegar krokowy harnessu (`__harness.step`).
// Gracz stoi poza dyskiem zapasu budowli, kamera w trybie `rts` nad środkiem budowli (zoom dobrany do dysku).
// Wynik: <out>/raport.json, zrzuty <out>/*.png, dziennik workerów <out>/worker.log.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/e14');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const WARM = Number(args.rozgrzewka || 2400);
const STAY = Number(args.postoj || 8);
const SLOT_WAIT = Number(args.szczelina || 240);
const PORTS = args.porty ? String(args.porty).split(',').map((s) => s.trim()).filter(Boolean) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5463));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 25) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, porty: {} };
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
const syncPage = () => ev(`(() => { const p = window.__harness && window.__harness.pipes; return p ? p.list.filter((e) => e.sync).map((e) => e.nazwa) : []; })()`);

async function waitGame(seconds) {
  let left = Math.max(1, Math.round(seconds * 60));
  while (left > 0) {
    const n = Math.min(120, left);
    await ev(`window.__harness.step(${n}).then(() => true)`, 600000);
    left -= n;
  }
}

// Kamera floty (`rts`) nad punktem gry w zadanym zoomie — gracz może stać gdzie indziej.
const CAMERA = (x, y, z) => `(() => { const c = window.camera; c.mode = 'rts'; c.transition = null; c.minZoom = 0.003;
  c.manualZoom = true; c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.zoom = c.targetZoom = c.zoomBase = ${z};
  window.DevScene?.syncCamera?.(); return true; })()`;

// Punkt lokalny budowli (u, v) → gra.
const LOCAL = `const toGame = (d, u, v) => ({ x: d.x + u * Math.cos(d.angle) - v * Math.sin(d.angle), y: d.y + u * Math.sin(d.angle) + v * Math.cos(d.angle) });
  const toLocal = (d, x, y) => { const dx = x - d.x, dy = y - d.y, c = Math.cos(d.angle), s = Math.sin(d.angle); return { u: dx * c + dy * s, v: -dx * s + dy * c }; };`;

// Stan statków bańki przy budowli: na stanowiskach tego portu, w drodze, w szczelinie koła.
const dockState = (id) => ev(`(() => { ${LOCAL}
  const d = window.PortDocks.docks.find((x) => x.stationId === ${JSON.stringify(id)});
  const tb = window.TrafficBubble;
  let docked = 0, near = 0, slot = null;
  const m = d.geometry.model;
  for (const a of tb.list) {
    const l = toLocal(d, a.cx ?? a.x, a.cy ?? a.y);
    const r = Math.hypot(l.u, l.v);
    if (r < d.keepR + 3000) near++;
    if (a.berthId && a.berthId.startsWith(${JSON.stringify(id)} + ':') && (a.phase === 'docked' || a.phase === 'capture')) docked++;
    if (d.kind === 'wheel' && l.u > m.Rin - 600 && l.u < m.Rout + 400 && Math.abs(l.v) < m.slotHalf && a.phase !== 'docked') {
      slot = { id: a.id, x: a.cx ?? a.x, y: a.cy ?? a.y, u: Math.round(l.u), v: Math.round(l.v), hull: a.hullId, phase: a.phase };
    }
  }
  return { docked, near, all: tb.list.length, slot, player: { x: window.ship.pos.x, y: window.ship.pos.y } };
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&trafficSeed=7${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubbleDocks)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  await ev('window.__harness.hold(true)');
  await waitGame(0.2);
  report.budowle = await ev(`(() => Object.fromEntries(window.PortDocks.docks.map((d) => [d.stationId,
    { rodzaj: d.kind, komplety: d.spec.repeats, stanowisk: d.geometry.berths.length, keepR: Math.round(d.keepR), styl: d.style,
      bryly: d.solids.length }])))()`);
  console.log('tryb', report.tryb, 'budowli', Object.keys(report.budowle).length);

  const tw0 = Date.now();
  await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
  if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');

  // Porty: z argumentu albo port każdego rodzaju z największą liczbą kursów przy stanowiskach (migawka dyspozytora).
  // Krzyże to małe porty (księżyce, kryjówki) — gdy żaden nie ma kursu przy stanowisku, świat ruchu idzie naprzód
  // po 60 s (najwyżej `--krzyz` s), aż któryś ma.
  const choose = () => ev(`(async () => {
    const snap = await window.TrafficV2.requestSnapshot();
    const find = (o, depth = 0) => { if (!o || typeof o !== 'object' || depth > 4) return null;
      if (Array.isArray(o.ports) && o.ports.length && o.ports[0] && 'berthed' in o.ports[0]) return o.ports;
      for (const v of Object.values(o)) { const r = find(v, depth + 1); if (r) return r; } return null; };
    const rows = find(snap) || [];
    const berthed = new Map(rows.map((r) => [r.stationId, r.berthed || 0]));
    const best = {};
    for (const d of window.PortDocks.docks) {
      const n = berthed.get(d.stationId) || 0;
      if (!best[d.kind] || n > best[d.kind].n) best[d.kind] = { id: d.stationId, n };
    }
    return best;
  })()`);
  let pick = PORTS;
  if (!pick) {
    let best = await choose();
    const CROSS_WAIT = Number(args.krzyz || 1800);
    const CROSS_MIN = Number(args.krzyzMin || 1);
    for (let t = 0; t < CROSS_WAIT && !(best.cross?.n >= CROSS_MIN); t += 60) {
      const c0 = await ev('window.TrafficV2.clock || 0');
      await ev(`(() => { for (let i = 0; i < 12; i++) window.TrafficV2.advance(5); return true; })()`);
      await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${c0 + 55}`, 120000, 200);
      best = await choose();
    }
    report.wyborKursy = best;
    pick = ['cross', 'round', 'wheel'].map((k) => best[k]?.id).filter(Boolean);
  }
  report.wybor = pick;
  let pi = 0;
  for (const id of pick) {
    pi++;
    // Gracz poza dyskiem zapasu, od strony węzła portu (tam przylatuje ruch); kamera nad środkiem budowli.
    const at = await ev(`(() => { ${LOCAL}
      const d = window.PortDocks.docks.find((x) => x.stationId === ${JSON.stringify(id)});
      if (!d) return null;
      const p = toGame(d, -(d.keepR + 3500), d.keepR * 0.6);
      window.devTeleportTo(p.x, p.y, { angle: d.angle, quiet: true });
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      return { kind: d.kind, x: d.x, y: d.y, keepR: d.keepR, angle: d.angle, gracz: { x: Math.round(window.ship.pos.x), y: Math.round(window.ship.pos.y) } };
    })()`);
    if (!at) { report.porty[id] = { brak: true }; continue; }
    const zoomAll = 380 / at.keepR;
    await ev(CAMERA(at.x, at.y, zoomAll));
    await waitGame(STAY);
    const s = await dockState(id);
    await ev(CAMERA(at.x, at.y, zoomAll));
    await waitGame(0.1);
    const tag = `${pi}-${at.kind}-${id}`;
    await screenshotPng(cdp, join(out, `${tag}-kadr.png`));
    // Zbliżenie: statek na stanowisku tego portu (albo czubek ramienia / ściana koła, gdy pusto).
    const near = await ev(`(() => { ${LOCAL}
      const d = window.PortDocks.docks.find((x) => x.stationId === ${JSON.stringify(id)});
      const a = window.TrafficBubble.list.find((e) => e.berthId && e.berthId.startsWith(${JSON.stringify(id)} + ':') && e.phase === 'docked');
      if (a) return { x: a.cx ?? a.x, y: a.cy ?? a.y, statek: a.hullId };
      const b = d.geometry.berths[Math.floor(d.geometry.berths.length / 3)];
      return { ...toGame(d, b.u, b.v), statek: null };
    })()`);
    await ev(CAMERA(near.x, near.y, Math.min(0.16, zoomAll * 4.5)));
    await waitGame(0.5);
    await screenshotPng(cdp, join(out, `${tag}-zblizenie.png`));
    report.porty[id] = { ...at, statki: s, zblizenie: near };
    console.log('port', id, at.kind, JSON.stringify(s));

    if (at.kind === 'wheel') {
      // Statek w szczelinie: czekanie (zegar krokowy) na encję między wewnętrzną a zewnętrzną krawędzią obręczy.
      let slot = null;
      for (let t = 0; t < SLOT_WAIT && !slot; t += 1) {
        await waitGame(1);
        slot = (await dockState(id)).slot;
      }
      report.porty[id].szczelina = slot;
      if (slot) {
        // Kamera na statku w szczelinie (ściany szczeliny po obu stronach kadru), potem szerzej: szczelina i wnętrze.
        await ev(CAMERA(slot.x, slot.y, 0.11));
        await waitGame(0.05);
        await screenshotPng(cdp, join(out, `${tag}-szczelina.png`));
        const c = await ev(`(() => { ${LOCAL} const d = window.PortDocks.docks.find((x) => x.stationId === ${JSON.stringify(id)});
          return toGame(d, d.geometry.model.Rin - 1500, 0); })()`);
        await ev(CAMERA(c.x, c.y, 0.045));
        await waitGame(0.05);
        await screenshotPng(cdp, join(out, `${tag}-szczelina-szerzej.png`));
        console.log('szczelina', JSON.stringify(slot));
      } else {
        console.log('szczelina: brak statku w', SLOT_WAIT, 's');
      }
    }
  }

  // Kolizja gracza z bryłą: gracz rozpędzony w ramię / obręcz / ścianę pierwszego portu — wypchnięty, bez przelotu.
  const first = pick[0];
  if (first) {
    report.kolizja = await ev(`(async () => { ${LOCAL}
      const d = window.PortDocks.docks.find((x) => x.stationId === ${JSON.stringify(first)});
      const s = d.solids[1] || d.solids[0];
      const cx = s.poly.reduce((t, p) => t + p.x, 0) / s.poly.length, cy = s.poly.reduce((t, p) => t + p.z, 0) / s.poly.length;
      const dx = cx - d.x, dy = cy - d.y, L = Math.hypot(dx, dy) || 1;
      window.devTeleportTo(cx + dx / L * 2500, cy + dy / L * 2500, { angle: Math.atan2(-dy, -dx), quiet: true });
      window.ship.vel.x = -dx / L * 600; window.ship.vel.y = -dy / L * 600;
      await window.__harness.step(300);
      return { bryla: s.tag, wBryle: window.PortDocks.pointInSolid(window.ship.pos.x, window.ship.pos.y),
        odSrodkaBryly: Math.round(Math.hypot(window.ship.pos.x - cx, window.ship.pos.y - cy)) };
    })()`, 300000);
    console.log('kolizja', JSON.stringify(report.kolizja));
  }

  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(report.blad);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  console.log('pipeline sync workera: start', report.syncStart?.length ?? '-', '| koniec', report.syncKoniec?.length ?? '-',
    (report.syncKoniec || []).slice(0, 6).join(' | '));
  console.log('pipeline sync strony (tryb off): start', report.syncStronaStart?.length ?? '-', '| koniec', report.syncStronaKoniec?.length ?? '-',
    (report.syncStronaKoniec || []).slice(report.syncStronaStart?.length || 0).slice(0, 6).join(' | '));
  console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('  ', l.slice(0, 300));
  writeFileSync(join(out, 'worker.log'), workerLogs.join('\n'));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
clearTimeout(guard);
process.exit(0);
