// KAPSUŁY RATUNKOWE w PRAWDZIWEJ grze (E22, reguła `kapsuly-ratunkowe`): okręt frakcji przy Ziemi ginie, po chwili
// wystrzeliwuje kapsuły, które lecą do zatoki ringu (płyta tylko tranzytem) i tam znikają; pirat — bez kapsuł.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu. Kamera jedzie za kapsułami (gracz
// teleportowany obok — inaczej kapsuły dalej niż 40 tys. j. przechodzą w rozliczenie bez obrazu).
//
//   node scripts/webgpu/kapsuly-gra.mjs [--query renderWorker=1] [--out .tmp/kapsuly] [--port 5467]
//        [--kadlub freighter-large] [--etapy smierc,pirat,ruch]
//
// Wynik: <out>/raport.json, zrzuty <out>/*.png (śmierć, wyrzut, silniki, lot, dolot), pipeline'y synchroniczne
// workera i strony (ma być 0), błędy.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/kapsuly');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const HULL = args.kadlub || 'freighter-large';
const STAGES = new Set(String(args.etapy || 'smierc,pirat').split(','));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5467));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 20) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, kadlub: HULL, etapy: {} };
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
const ZOOM = (z) => `(() => { const c = window.camera; c.minZoom = 0.003; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; window.DevScene?.syncCamera?.(); return true; })()`;
// Stan kapsuł: liczba, stany, środek, pozostała trasa, cel, statystyki; płyta ringu pod kapsułami.
const POD_STATE = `(() => {
  const E = window.EscapePods, p = E.pool, hw = window.__haloWorld;
  let cx = 0, cy = 0, n = 0, pend = 0, slab = 0, maxLeft = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.state[i] === 0) { pend++; continue; }
    cx += p.x[i]; cy += p.y[i]; n++;
    if (hw && hw.pointInSlab(p.x[i], p.y[i])) slab++;
    let left = 0, px = p.x[i], py = p.y[i];
    const base = i * p.wpCap * 3;
    for (let k = p.wpAt[i]; k < p.wpCount[i]; k++) { const qx = p.wp[base + k * 3], qy = p.wp[base + k * 3 + 1]; left += Math.hypot(qx - px, qy - py); px = qx; py = qy; }
    maxLeft = Math.max(maxLeft, left);
  }
  const t0 = p.count ? p.target[0] : -1;
  return { kapsul: p.count, wKadlubie: pend, wLocie: n, srodek: n ? { x: cx / n, y: cy / n } : null, wPlycie: slab,
    pozostalo: Math.round(maxLeft), cel: E.stationId(t0), punktow: p.count ? p.wpCount[0] : 0, tranzyt: E.transit, stats: E.stats };
})()`;
const FOLLOW = (dist) => `(() => { const p = window.EscapePods.pool; let cx = 0, cy = 0, vx = 0, vy = 0, n = 0;
  for (let i = 0; i < p.count; i++) { if (p.state[i] === 0) continue; cx += p.x[i]; cy += p.y[i]; vx += p.vx[i]; vy += p.vy[i]; n++; }
  if (!n) return null; cx /= n; cy /= n; vx /= n; vy /= n;
  // Bez DevScene.syncCamera — kasuje przejście kamery fabularnej (PortCargo.look).
  window.DevScene.teleport(cx + ${dist}, cy, Math.PI); window.ship.vel.x = vx; window.ship.vel.y = vy;
  return { x: cx, y: cy, v: Math.hypot(vx, vy) }; })()`;

// Okręt frakcji `faction` (kadłub DEV_HULL_SPAWNS) `dist` j. przed graczem, bokiem do kamery.
const SPAWN = (key, faction, dist, mode = 'dummy') => `(() => {
  const s = window.ship;
  const npc = window.spawnDevHull(${JSON.stringify(key)}, { pos: { x: s.pos.x + Math.cos(s.angle) * ${dist}, y: s.pos.y + Math.sin(s.angle) * ${dist} },
    spawnAngle: s.angle + Math.PI / 2, mode: ${JSON.stringify(mode)} });
  if (!npc) return null;
  npc.factionId = ${JSON.stringify(faction)};
  window.__podNpc = npc;
  return { id: npc.id, x: npc.x, y: npc.y, faction: npc.factionId, pirate: npc.isPirate };
})()`;
// Kamera fabularna nad okrętem / kapsułą `i` (−1 — środek kapsuł w locie), kadr `h` j. wysokości.
const LOOK_NPC = (h) => `(() => { const n = window.__podNpc; return n ? window.PortCargo.look(n.x, n.y, ${h}) : false; })()`;
// `ahead` [s] — punkt kapsuły przewidziany wprzód (kadr stoi, kapsuła leci).
const LOOK_POD = (i, h, ahead = 0) => `(() => { const p = window.EscapePods.pool; let cx = 0, cy = 0, n = 0;
  for (let k = 0; k < p.count; k++) { if (p.state[k] === 0 || (${i} >= 0 && k !== ${i})) continue; cx += p.x[k] + p.vx[k] * ${ahead}; cy += p.y[k] + p.vy[k] * ${ahead}; n++; }
  if (!n) return false; return window.PortCargo.look(cx / n, cy / n, ${h}); })()`;
const KILL = `(() => { const npc = window.__podNpc; if (!npc) return null;
  const hull = !!npc.beamHull; window.applyDamageToNPC(npc, 1e7, 'default', {}, false);
  return { dead: !!npc.dead, belki: hull, kapsul: window.EscapePods.count, statki: window.EscapePods.stats.ships }; })()`;

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4243};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&trafficSeed=7${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  await ev('window.__harness.hold(true)');
  await ev('window.DevScene.preloadHullSprites()');
  console.log('tryb', report.tryb);

  // Miejsce: 72 tys. j. od Ziemi po stronie zatok (poza ringiem i redą), dziobem w bok.
  report.miejsce = await ev(`(() => {
    const earth = window.TrafficV2.getStation('earth');
    const berths = window.TrafficV2.tables.bubblePorts.earth;
    const b = berths.find((x) => x.hall !== 'K-7') || berths[0];
    const a = Math.atan2(b.y - earth.y, b.x - earth.x) + 0.5;
    const x = earth.x + Math.cos(a) * 72000, y = earth.y + Math.sin(a) * 72000;
    window.DevScene.teleport(x, y, a + Math.PI / 2);
    return { x, y, zatoka: b.id, ziemia: { x: earth.x, y: earth.y } };
  })()`);
  await ev(ZOOM(0.5));
  await waitGame(1);

  if (STAGES.has('smierc')) {
    // Okręt 6 tys. j. przed graczem (Atlas poza kadrem), kamera fabularna (PortCargo.look z ?dev) nad wrakiem.
    const st = { spawn: await ev(SPAWN(HULL, 'terra_nova', 6000)) };
    // Kadłub na belkach buduje się ze sprite'a (drawNPCPretty) — kilka klatek.
    for (let k = 0; k < 20 && !(await ev('!!window.__podNpc?.beamHull')); k++) await waitGame(0.25);
    await ev(LOOK_NPC(2600));
    await waitGame(0.6);
    await screenshotPng(cdp, join(out, '00-przed.png'));
    st.kill = await ev(KILL);
    await waitGame(0.35);
    await screenshotPng(cdp, join(out, '01-smierc.png'));
    st.poSmierci = await ev(POD_STATE);
    await ev(LOOK_NPC(1500));
    await waitGame(1.6);
    st.wyrzut = await ev(POD_STATE);
    await screenshotPng(cdp, join(out, '02-wyrzut.png'));
    await waitGame(0.8);
    await screenshotPng(cdp, join(out, '03-wyrzut-2.png'));
    await waitGame(1.4);
    st.silniki = await ev(POD_STATE);
    await screenshotPng(cdp, join(out, '03b-silniki.png'));
    // Zbliżenie: kapsuła 0 zatrzymana na czas zrzutu (kamera fabularna dojeżdża ~1 s), potem ruch przywrócony.
    const frozen = await ev(`(() => { const p = window.EscapePods.pool; if (!p.count) return null;
      const s = { vx: p.vx[0], vy: p.vy[0], st: p.state[0], t: p.timer[0] };
      p.vx[0] = 0; p.vy[0] = 0; p.state[0] = 1; p.timer[0] = 1e6; window.__podFreeze = s; return s; })()`);
    for (const [h, name] of [[90, '04-kapsula-zblizenie'], [260, '04a-kapsula-kadr-260']]) {
      await ev(LOOK_POD(0, h));
      await waitGame(1.2);
      await screenshotPng(cdp, join(out, `${name}.png`));
    }
    if (frozen) await ev(`(() => { const p = window.EscapePods.pool, s = window.__podFreeze;
      p.vx[0] = s.vx; p.vy[0] = s.vy; p.state[0] = 2; p.timer[0] = 0; return true; })()`);
    await ev(LOOK_POD(-1, 2000, 1));
    await waitGame(1);
    await screenshotPng(cdp, join(out, '04b-kapsuly-kadr.png'));
    // Lot: gracz jedzie z boku kapsuł (5 tys. j. — poza kadrem), kamera nad nimi; zrzut co ~10 s, aż znikną.
    const rows = [];
    let shot = 0;
    let maxSlab = 0;
    for (let t = 0; t < 240; t += 2) {
      await ev(FOLLOW(5000));
      await ev(LOOK_POD(-1, 3200));
      await waitGame(2);
      const s = await ev(POD_STATE);
      maxSlab = Math.max(maxSlab, s.wPlycie);
      rows.push({ t: t + 2, kapsul: s.kapsul, wLocie: s.wLocie, pozostalo: s.pozostalo, wPlycie: s.wPlycie, srodek: s.srodek });
      const near = s.pozostalo > 0 && s.pozostalo < 6000 && !st.dolotZrzut;
      if ((t % 12 === 10 && shot < 5) || near) {
        if (near) { st.dolotZrzut = true; await ev(LOOK_POD(-1, 9000, 1)); await waitGame(1); }
        await screenshotPng(cdp, join(out, `05-lot-${String(t + 2).padStart(3, '0')}${near ? '-dolot' : ''}.png`));
        shot++;
      }
      if (!s.kapsul) break;
    }
    st.przebieg = rows;
    st.maxWPlycie = maxSlab;
    st.koniec = await ev(POD_STATE);
    await screenshotPng(cdp, join(out, '06-po-dolocie.png'));
    await ev('window.PortCargo.lookEnd()');
    report.etapy.smierc = st;
    console.log('śmierć:', JSON.stringify({ kill: st.kill, wyrzut: { kapsul: st.wyrzut.kapsul, wLocie: st.wyrzut.wLocie, cel: st.wyrzut.cel, punktow: st.wyrzut.punktow },
      silniki: { wLocie: st.silniki.wLocie, punktow: st.silniki.punktow }, czas: rows.length * 2, wPlycie: maxSlab, stats: st.koniec.stats }));
  }

  if (STAGES.has('pirat')) {
    const before = await ev('window.EscapePods.stats.ships');
    const sp = await ev(SPAWN('pirate_raider', 'pirates', 1600, 'pirate'));
    for (let k = 0; k < 20 && !(await ev('!!window.__podNpc?.beamHull')); k++) await waitGame(0.25);
    const kill = await ev(KILL);
    await waitGame(3);
    report.etapy.pirat = { spawn: sp, kill, statkiPrzed: before, statkiPo: await ev('window.EscapePods.stats.ships'), kapsul: await ev('window.EscapePods.count') };
    console.log('pirat:', JSON.stringify(report.etapy.pirat));
  }

  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
  report.rozgrzewka = await ev(`(() => { const w = window.Core3D?.warmup; return w?.stats ? { ciezkie: (w.stats.ciezkie || []).slice(0, 8) } : null; })()`);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(report.blad);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  report.kapsulyWorker = workerLogs.filter((l) => /kapsu/i.test(l)).slice(0, 10);
  console.log('pipeline sync workera: start', report.syncStart?.length ?? '-', '| koniec', report.syncKoniec?.length ?? '-');
  console.log('pipeline sync strony: start', report.syncStronaStart?.length ?? '-', '| koniec', report.syncStronaKoniec?.length ?? '-');
  console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('  ', l.slice(0, 300));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
clearTimeout(guard);
process.exit(0);
