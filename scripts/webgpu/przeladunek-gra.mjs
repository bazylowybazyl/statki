// PRZEŁADUNEK W PORTACH w PRAWDZIWEJ grze (E12, docs/E12-przeladunek.md): ładownie frachtowców ruchu przy
// stanowiskach zatok Ziemi, rój dronów, stoły i taśmociągi, luk Atlasa z ładunkiem gracza; błędy konsoli, pipeline'y
// synchroniczne workera renderu i koszt (A/B z `?przeladunek=0` — przebiegi PO KOLEI, ten sam build).
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/przeladunek-gra.mjs [--query renderWorker=1] [--flaga przeladunek=0]
//        [--out .tmp/e12/po] [--rozgrzewka 2400] [--postoj 70] [--koszt 1] [--kosztPoza 1] [--cienie 1] [--koniec 1]
//
// Przebieg: start → świat ruchu rozgrzany `--rozgrzewka` s (gospodarka startuje od zera) → gracz przy zatoce
// Ziemi → czekanie na frachtowiec przy stanowisku zatoki (kadłub z ładownią; najlepiej świeżo po przechwycie) →
// kadr kamery nad stanowiskiem (gracz zostaje na zewnątrz) → zrzuty co kilka sekund postoju (wrota, rój, taśmy) →
// szeroki kadr zatoki → luk Atlasa: gracz na wolnym polu MEGA z ładunkiem (`berth-hold` otwiera luk) → koszt
// (worker renderu CPU / GPU w kadrze zatoki; drugi przebieg z `--flaga przeladunek=0` daje „przed”; `--kosztPoza 1` —
// jeszcze kadr daleko od zatok po zwolnieniu slotów roju: koszt ma być 0). Pomiar w workerze dopisuje stan puli roju
// (sloty, sloty w pracy, kroki symulacji w klatce). `--cienie 1` — na 7. etapie postoju zrzuty A/B siły cieni dronów (4 i 0,
// klatka po klatce; tryb worker). `--rozgrzewkaStat 1` — statystyki rejestru rozgrzewki workera (grupy, wpisy E12).
// Wynik: <out>/raport.json, zrzuty <out>/*.png, dziennik workerów <out>/worker.log.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/e12/po');
mkdirSync(out, { recursive: true });
const extra = [args.query || 'renderWorker=1', args.flaga || ''].filter(Boolean).join('&');
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
// Sesja workera renderu (diagnostyka: statystyki obrazu przeładunku liczone w workerze).
let rwSession = null;
let rwId = 990000;
/** Stan puli roju w sesji workera renderu (sloty, w pracy, kroki w klatce) albo null. */
async function poolStats() {
  try {
    const r = await evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D().pool; return JSON.stringify(p ? { slots: p.stats.slots, working: p.stats.working, steps: p.stats.steps } : null); }).catch((e) => String(e))`);
    return typeof r === 'string' && r.startsWith('{') ? JSON.parse(r) : r;
  } catch (e) { return String(e); }
}
function evalWorker(expr, timeout = 20000) {
  if (!rwSession) return Promise.resolve('brak sesji workera renderu');
  const id = ++rwId;
  // Odpowiedź z id przechodzi przez cdp.pending (Cdp nie podaje słuchaczom wiadomości bez metody).
  return new Promise((res) => {
    const timer = setTimeout(() => { cdp.pending.delete(id); res('limit czasu'); }, timeout);
    cdp.pending.set(id, {
      ok: (r) => { clearTimeout(timer); res(r?.result?.value ?? r?.exceptionDetails?.exception?.description ?? null); },
      reject: (e) => { clearTimeout(timer); res(String(e && e.message || e)); }
    });
    cdp.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', sessionId: rwSession, params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
}
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget' && /render.worker/.test(msg.params.targetInfo?.url || '')) rwSession = msg.params.sessionId;
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
const CARGO_HULLS = ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter'];
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
  if (args.rozgrzewkaStat && report.tryb === 'worker') {
    // Rejestr rozgrzewki workera: grupy (CPU po modułach) i wpisy przeładunku / roju (czas od startu wpisu do pipeline'ów).
    const ws = await evalWorker(`import(new URL('../3d/core3d.js', self.location.href).href).then((m) => { const s = m.Core3D.warmup.stats; return import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((pc) => { const p = pc.sharedPortCargo3D().pool; return JSON.stringify({ flush: s.flush, e12: (s.lista || []).filter((r) => /przeładun|rój/.test(r.nazwa)), pula: p ? { ensureMs: p.stats.ensureMs, warmMs: p.stats.warmMs } : null, fx: s.grupy && s.grupy['Core3D.fx'] }); }); }).catch((e) => String(e))`, 30000);
    report.rozgrzewka = ws;
    console.log('rozgrzewka workera:', String(ws).slice(0, 3000));
  }
  await ev('window.__harness.hold(true)');
  report.przeladunek = await ev('({ on: window.PortCargo.on })');
  console.log('tryb', report.tryb, extra, JSON.stringify(report.przeladunek));

  const tw0 = Date.now();
  // Świat z własną rozgrzewką (E15 — godzina ruchu w workerze, bańka stoi do jej końca): czekamy na koniec. Własna
  // rozgrzewka harnessu (`advance`) szła wtedy do kolejki świata PO niej — świat przewijał się potem szybciej niż gra
  // i statki opuszczały stanowiska w kilka sekund.
  const ownWarmup = await ev('!!(window.TrafficV2.warmup && window.TrafficV2.warmup.total > 0)');
  if (ownWarmup) {
    if (!await waitFor(cdp, '!window.TrafficV2.warmup.active && window.TrafficV2.warmup.seconds >= window.TrafficV2.warmup.total', 600000, 500)) throw new Error('rozgrzewka świata (E15) nie skończyła się');
    console.log('rozgrzewka świata (E15)', await ev('window.TrafficV2.warmup.total'), 's w', Date.now() - tw0, 'ms');
  } else {
    await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
    if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
    console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');
  }

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

  if (args.dwa) {
    // Dwa duże statki na polach MEGA jednej zatoki naraz (zgłoszenie 2026-10-26: „jeden rozładowywany, drugi stał
    // bezczynny i wyleciał”): kadr na oba pola, co kilka sekund zrzut i stan każdego — kontrakt E12 (tryb, wypełnienie),
    // przeładunek w ramce, slot roju (tak / nie i dlaczego), wrota.
    const { ACTOR_FLAG } = await import('../../src/game/traffic/trafficProtocol.js');
    const flagNames = (f) => Object.entries(ACTOR_FLAG).filter(([, v]) => typeof v === 'number' && v > 0 && v < 1 << 12 && (f & v)).map(([k]) => k);
    const giantsAt = () => ev(`(() => {
      const tb = window.TrafficBubble; const bays = new Map();
      for (const a of tb.list) {
        if (!a.alive || !a.berthId || !/-MG\\d+$/.test(a.berthId) || !(a.phase === 'docked' || a.phase === 'capture') || a.length < ${Number(args.dlugosc || 1500)}) continue;
        const bay = a.berthId.slice(0, a.berthId.lastIndexOf('-'));
        if (!bays.has(bay)) bays.set(bay, []);
        bays.get(bay).push({ id: a.id, unit: a.unitClass, hull: a.hullId, berth: a.berthId, phase: a.phase, dock: +a.dockTime.toFixed(1), x: a.cx, y: a.cy, len: a.length });
      }
      return [...bays].filter(([, l]) => l.length >= 2).map(([bay, l]) => ({ bay, list: l }));
    })()`);
    let pair = null;
    const SEARCH2 = Number(args.szukaj || 300);
    for (let k = 0; k < SEARCH2 && !pair; k++) {
      // Para, w której jeden statek właśnie zadokował (widać cały jego postój), drugi — jak najwcześniej w swoim.
      const found = (await giantsAt()).filter((p) => Math.min(...p.list.map((x) => x.dock)) < 6);
      found.sort((a, b) => Math.max(...a.list.map((x) => x.dock)) - Math.max(...b.list.map((x) => x.dock)));
      pair = found[0] || null;
      if (!pair) await waitGame(1);
    }
    report.dwa = { para: pair, probki: [] };
    console.log('dwa olbrzymy:', JSON.stringify(pair));
    if (pair) {
      const cx = pair.list.reduce((s, a) => s + a.x, 0) / pair.list.length;
      const cy = pair.list.reduce((s, a) => s + a.y, 0) / pair.list.length;
      const span = Math.max(...pair.list.map((a) => Math.hypot(a.x - cx, a.y - cy)));
      await ev(`(() => {
        const earth = window.TrafficV2.getStation('earth');
        const dx = ${cx} - earth.x, dy = ${cy} - earth.y, d = Math.hypot(dx, dy) || 1;
        window.devTeleportTo(${cx} + dx / d * 7000, ${cy} + dy / d * 7000, { angle: Math.atan2(-dy, -dx), quiet: true });
        window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
      const vh = Math.max(2600, span * 2 + 2400);
      await ev(`window.PortCargo.look(${cx}, ${cy}, ${vh})`);
      const ids = pair.list.map((a) => a.id);
      const N = Number(args.probki || 16);
      for (let i = 0; i < N; i++) {
        await waitGame(i ? Number(args.co || 6) : 0.6);
        const st = await ev(`(() => { const f = window.PortCargo.frame; const out = [];
          for (const id of ${JSON.stringify(ids)}) {
            const a = window.TrafficBubble.byId.get(id); const c = f._cargo.get(id);
            const op = f.ops.slice(0, f.opCount).find((o) => o.seed === id);
            out.push({ id, unit: a ? a.unitClass : null, phase: a ? a.phase : 'zniknął', dock: a ? +a.dockTime.toFixed(1) : null, flags: a ? a.flags : 0,
              kontrakt: c ? { mode: c.mode, fill: +c.fill.toFixed(2), dwell: c.dwell, move: +c.move.toFixed(1) } : null,
              op: op ? { mode: op.mode, fill: +op.fill.toFixed(2), capture: op.capture } : null });
          }
          return { t: +window.TrafficV2.time.toFixed(1), ops: f.opCount, statki: out, liveSlots: f.liveSlots }; })()`);
        if (report.tryb === 'worker') {
          const d = await evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D(); const ids = ${JSON.stringify(ids)};
            const slots = p.pool ? p.pool.slots.filter((x) => x.active) : [];
            return JSON.stringify({ sloty: slots.map((x) => ({ key: x.key, hull: x.hull, mode: x.mode, started: x.started, finished: x.finished, frozen: x.frozen, drones: x.drones, done: x.planner ? x.planner.stats.done : null, total: x.planner ? x.planner.stats.total : null })),
              wrota: ids.map((id) => { const c = p.cutForRef({ courseId: id }); return c ? +(c.door || 0).toFixed(2) : 0; }), stats: { ops: p.stats.ops, live: p.stats.live, clock: p.stats.clock, containers: p.stats.containers } }); }).catch((e) => String(e))`);
          try { st.obraz = JSON.parse(d); } catch { st.obraz = d; }
        }
        for (const s of st.statki) s.flagi = flagNames(s.flags);
        report.dwa.probki.push(st);
        console.log('próbka', i, JSON.stringify({ t: st.t, statki: st.statki.map((s) => [s.id, s.unit, s.phase, s.dock, s.flagi.join('|'), s.kontrakt && `${s.kontrakt.mode}:${s.kontrakt.fill}`, s.op ? 'op' : '-']),
          sloty: st.obraz && st.obraz.sloty ? st.obraz.sloty.map((x) => [x.key, x.hull, x.drones, `${x.done}/${x.total}`, x.started ? (x.finished ? 'koniec' : 'praca') : 'start']) : null, wrota: st.obraz && st.obraz.wrota }));
        await screenshotPng(cdp, join(out, `60-dwa-${String(i).padStart(2, '0')}.png`));
        if (st.statki.every((s) => s.phase !== 'docked' && s.phase !== 'capture')) break;
      }
    }
    report.syncKoniec = syncWorker();
    report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|[vite]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
    report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]')).slice(0, 20);
    console.log('pipeline sync workera: start', report.syncStart.length, '| koniec', report.syncKoniec.length - report.syncStart.length);
    console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
    for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 4)) console.log('  ', l.slice(0, 300));
    throw new Error('dwa — koniec');
  }

  if (args.proba) {
    // Wystarczalność roju: pełne postoje od zera (`PortCargo.probe`) na polach zatoki w kadrze, kadłub × tryb przy
    // wypełnieniu `--wypelnienie` (1); co 2 s gry postęp wieży slotu (przeniesione / wszystkie), na końcu okna — tabela.
    const { trafficHullFootprint } = await import('../../src/data/trafficHulls.js');
    const ALL = ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter'];
    const spec = String(args.proba);
    const items = (spec === 'unload' || spec === 'load' ? ALL.map((h) => `${h}:${spec}`) : spec.split(','))
      .map((s) => { const [hull, mode, fill] = s.split(':'); return { hull, mode: mode || 'unload', fill: Number(fill || args.wypelnienie || 1), move: Number(args.move || 0), halfBeam: trafficHullFootprint(hull).width / 2 }; });
    const bay = await ev(`(() => {
      const berths = window.TrafficV2.tables.bubblePorts.earth.filter((x) => x.hall === 'ZATOKA');
      const mg = berths.find((x) => /-MG1$/.test(x.id)); const pre = mg.id.slice(0, mg.id.lastIndexOf('-'));
      const list = berths.filter((x) => x.id.startsWith(pre));
      const cx = list.reduce((s, b) => s + b.x, 0) / list.length, cy = list.reduce((s, b) => s + b.y, 0) / list.length;
      const span = Math.max(...list.map((b) => Math.hypot(b.x - cx, b.y - cy)));
      const earth = window.TrafficV2.getStation('earth');
      const dx = cx - earth.x, dy = cy - earth.y, d = Math.hypot(dx, dy) || 1;
      window.devTeleportTo(cx + dx / d * 9000, cy + dy / d * 9000, { angle: Math.atan2(-dy, -dx), quiet: true });
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      return { bay: pre, cx, cy, span, pola: list.map((b) => b.id) };
    })()`);
    const vh = Math.max(3000, bay.span * 2.4 + 1500);
    await ev(`window.PortCargo.look(${bay.cx}, ${bay.cy}, ${vh})`);
    await waitGame(1);
    if (args.krokiMax && report.tryb === 'worker') {
      // Harness przesuwa grę szybciej, niż worker renderuje — pula (maxSteps kroków na klatkę workera) zostaje w tyle.
      // Wyższy limit na czas próby = tempo roju jak w grze przy ≥ 30 kl./s workera (wiersz „zegar roju” ~1).
      report.krokiMax = await evalWorker(`import(new URL('../3d/swarm/swarmBerthPool.js', self.location.href).href).then((m) => { m.SWARM_POOL_TUNE.maxSteps = ${Number(args.krokiMax)}; return m.SWARM_POOL_TUNE.maxSteps; })`);
    }
    const t0 = await ev(`window.PortCargo.probe(${JSON.stringify(items)})`);
    // `--rt 1`: gra porcjami po 4 klatki z przerwą ~60 ms (bliżej czasu rzeczywistego). Do pomiaru wystarczalności lepsze
    // `--krokiMax 64` przy zwykłych krokach — wiersz „zegar roju” ma być ≈ 1.
    const stepProbe = async (sec) => {
      if (!args.rt) return waitGame(sec);
      for (let left = Math.round(sec * 60); left > 0; left -= 4) {
        await ev(`window.__harness.step(${Math.min(4, left)}).then(() => true)`);
        await new Promise((r) => setTimeout(r, 60));
      }
    };
    const res = new Map();
    // Zegar roju względem czasu gry (×4): pula robi najwyżej maxSteps kroków na klatkę workera — gdy worker renderuje
    // wolniej niż harness przesuwa grę, rój zwalnia (w grze przy ≥ 30 kl./s workera — nie) i próba zaniża wynik.
    let simT0 = null; let simDt0 = 0; let simLag = null;
    const maxDwell = Math.max(...items.map((it) => (it.mode === 'load' ? 90 : 120)));
    for (let k = 0, shot = 0; ; k++) {
      await stepProbe(2);
      const dt = (await ev('window.TrafficV2.time')) - t0;
      const d = await evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D();
        return JSON.stringify({ simT: p.pool && p.pool.sim ? p.pool.sim.time : null, slots: p.pool ? p.pool.slots.filter((x) => x.active && x.key >= 800000).map((x) => ({ key: x.key, hull: x.hull, mode: x.mode, drones: x.drones, started: x.started, finished: x.finished, frozen: x.frozen, units: x.units, cut: p.pool.stats.unitsCut, done: x.planner ? x.planner.stats.done : null, total: x.planner ? x.planner.stats.total : null })) : [] }); }).catch((e) => String(e))`);
      let slots = [];
      try {
        const r = JSON.parse(d);
        slots = r.slots;
        // Tylko odcinki, w których rój pracował na obu końcach (krok stoi, gdy żaden slot nie pracuje).
        const busy = slots.some((s) => s.started && !s.finished);
        if (r.simT != null && busy && simT0 != null) {
          simLag = simLag || { swarm: 0, gra: 0 };
          simLag.swarm = +(simLag.swarm + r.simT - simT0).toFixed(2);
          simLag.gra = +(simLag.gra + dt - simDt0).toFixed(2);
        }
        simT0 = busy ? r.simT : null;
        simDt0 = dt;
      } catch {}
      for (const s of slots) {
        const r = res.get(s.key) || { hull: s.hull, mode: s.mode, drones: s.drones, units: s.units, total: s.total, done: 0, koniecRoju: null };
        r.done = Math.max(r.done, s.done || 0);
        r.total = s.total || r.total;
        if (s.finished && r.koniecRoju == null) r.koniecRoju = +dt.toFixed(1);
        res.set(s.key, r);
      }
      if (k % 10 === 0) {
        console.log('próba', +dt.toFixed(1), JSON.stringify(slots.map((s) => [s.key - 800000, s.hull, s.mode, s.drones, `${s.done}/${s.total}`, s.started ? (s.finished ? 'koniec' : 'praca') : 'start'])));
        await screenshotPng(cdp, join(out, `70-proba-${String(shot++).padStart(2, '0')}.png`));
      }
      if (dt > maxDwell + 2) break;
    }
    await ev('window.PortCargo.probe(null)');
    report.proba = { bay, items, zegar: simLag, wyniki: [...res].map(([key, r]) => ({ i: key - 800000, ...r, proc: r.total ? +(100 * r.done / r.total).toFixed(1) : null })) };
    console.log('zegar roju [s] / czas gry × 4:', JSON.stringify(simLag), simLag && simLag.gra > 0 ? (simLag.swarm / (4 * simLag.gra)).toFixed(3) : '');
    console.log('wystarczalność:');
    for (const r of report.proba.wyniki) console.log(`  ${r.hull} ${r.mode}: drony ${r.drones}, ${r.done}/${r.total} (${r.proc}%), koniec roju ${r.koniecRoju ?? '—'} s`);
    report.syncKoniec = syncWorker();
    report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|[vite]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
    report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]')).slice(0, 20);
    console.log('pipeline sync workera: start', report.syncStart.length, '| koniec', report.syncKoniec.length - report.syncStart.length);
    console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
    for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 4)) console.log('  ', l.slice(0, 300));
    throw new Error('proba — koniec');
  }

  // Frachtowiec przy stanowisku zatoki: świeżo zadokowany (wrota przed otwarciem), kadłub z większą ładownią
  // przed promem; po `--szukaj` s — najkrótszy postój, jaki jest.
  const PRIO = { container_ship: 0, long_haul_freighter: 1, heavy_freighter: 2, megafreighter: 2, inter_station_shuttle: 3 };
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
    // Gracz obok zatoki celu (7 tys. j. na zewnątrz portu): bańka ruchu żyje wokół GRACZA (E15 — bańka 100 tys. j.,
    // reda), a podgląd kadru przenosi tylko kamerę — cel na drugim końcu portu wypadał z bańki po kilku sekundach.
    report.przy = await ev(`(() => {
      const earth = window.TrafficV2.getStation('earth');
      const dx = ${target.x} - earth.x, dy = ${target.y} - earth.y, d = Math.hypot(dx, dy) || 1;
      window.devTeleportTo(${target.x} + dx / d * 7000, ${target.y} + dy / d * 7000, { angle: Math.atan2(-dy, -dx), quiet: true });
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      return { d: Math.round(d) };
    })()`);
    // Kadr nad stanowiskiem: wysokość kadru ~1,3 długości pola (statek i plac po obu burtach).
    const vh = Math.max(700, target.len * 2.6);
    await ev(`window.PortCargo.look(${target.x}, ${target.y}, ${vh})`);
    await waitGame(0.5);
    const seq = [];
    const t0 = await ev('window.TrafficV2.time');
    if (args.koniec && report.tryb === 'worker') {
      // Koniec postoju klatka po klatce: od zamrożenia wieży (wrota się zamykają) albo końca roju do odlotu + 3 s,
      // zbliżenie co 0,25 s (50-koniec-NNN.png) — skok obrazu widać w różnicy sąsiednich klatek.
      const slotState = async () => {
        const r = await evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D().pool; const s = p && p.slots.find((x) => x.active && x.key === ${target.id}); const rb = p && p.sim && p.sim.readback; const sd = p && p.sim ? p.sim.statusData : null; const ph = {}; if (s && sd) for (let i = 0; i < s.drones; i++) { const k = sd[(s.dBase + i) * 4] | 0; ph[k] = (ph[k] || 0) + 1; } return JSON.stringify(s ? { frozen: s.frozen, finished: s.finished, holdHidden: s.holdHidden, drain: s.drain, done: s.planner ? s.planner.stats.done : null, total: s.planner ? s.planner.stats.total : null, drones: s.drones, rbFrame: rb ? rb.frame : null, from: s.statusFrom, fazy: ph, working: p.stats.working, steps: p.stats.steps, cut: (() => { const c = m.sharedPortCargo3D().cutForRef({ courseId: ${target.id} }); return c ? { door: +(c.door || 0).toFixed(2), skin: +(c.skin || 0).toFixed(2) } : null; })() } : { cut: (() => { const c = m.sharedPortCargo3D().cutForRef({ courseId: ${target.id} }); return c ? { door: +(c.door || 0).toFixed(2), skin: +(c.skin || 0).toFixed(2) } : null; })() }); })`);
        try { return JSON.parse(r); } catch { return null; }
      };
      await ev(`window.PortCargo.look(${target.x}, ${target.y}, ${Math.max(380, target.len * 0.62)})`);
      const end = [];
      let capturing = false;
      let after = -1;
      for (let k = 0, n = 0; k < 600 && n < 160; k++) {
        const a = await ev(`(() => { const a = window.TrafficBubble.byId.get(${target.id}); return a ? { phase: a.phase, dock: +a.dockTime.toFixed(2) } : null; })()`);
        const s = await slotState();
        if (!capturing && s && (s.frozen || s.finished)) capturing = true;
        if (!capturing && k % 10 === 0) console.log('koniec: czekam', JSON.stringify(a), JSON.stringify(s));
        if (capturing) {
          await screenshotPng(cdp, join(out, `50-koniec-${String(n).padStart(3, '0')}.png`));
          end.push({ n, ...(a || {}), slot: s });
          n++;
          if (!a || a.phase === 'undock') { if (after < 0) after = n; if (n - after > 12) break; }
        }
        await waitGame(capturing ? 0.25 : 1);
      }
      report.etapy.koniec = end;
      console.log('koniec:', JSON.stringify(end.filter((e, i) => i % 8 === 0 || i === end.length - 1)));
    }
    for (let i = 0; i <= (args.koniec ? -1 : 14); i++) {
      const st = await ev(`(() => { const a = window.TrafficBubble.byId.get(${target.id}); const f = window.PortCargo.frame;
        const op = f.ops.slice(0, f.opCount).find((o) => o.seed === ${target.id});
        return { t: +(window.TrafficV2.time - ${t0}).toFixed(1), dock: a ? +a.dockTime.toFixed(1) : null, phase: a ? a.phase : null,
          op: op ? { mode: op.mode, fill: +op.fill.toFixed(2), res: op.resourceId, dock: +op.dockTime.toFixed(1) } : null,
          ops: f.opCount, yards: f.yardCount,
          naStanowisku: window.TrafficBubble.list.filter((b) => b.berthId === ${JSON.stringify(target.berth)}).map((b) => [b.id, b.hullId, b.phase, +b.dockTime.toFixed(1)]),
          liczba: window.TrafficBubble.list.length }; })()`);
      if (args.diag && report.tryb === 'worker') st.diag = await evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D(); return JSON.stringify({ stats: p.stats, pool: p.pool ? { st: p.pool.stats, slots: p.pool.slots.filter((x) => x.active).map((x) => ({ k: x.k, key: x.key, started: x.started, finished: x.finished, drones: x.drones, units: x.units, done: x.planner ? x.planner.stats.done : null, total: x.planner ? x.planner.stats.total : null })) } : null }); }).catch((e) => String(e && e.stack || e))`);
      else if (args.diag) st.diag = await ev(`import('/src/3d/cargo/portCargo3D.js').then((m) => { const p = m.sharedPortCargo3D(); return { stats: { ...p.stats }, pool: p.pool ? { ...p.pool.stats, slots: p.pool.slots.filter((x) => x.active).map((x) => ({ k: x.k, key: x.key, started: x.started, finished: x.finished, drones: x.drones, units: x.units, done: x.planner ? x.planner.stats.done : null, total: x.planner ? x.planner.stats.total : null })) } : null }; }).catch((e) => String(e && e.stack || e))`);
      seq.push(st);
      // Na zmianę: zbliżenie (statek i plac po burtach) i szerszy kadr pola.
      const close = (i % 2) === 0;
      await ev(`window.PortCargo.look(${target.x}, ${target.y}, ${close ? Math.max(380, target.len * 0.62) : Math.max(900, target.len * 1.6)})`);
      await waitGame(0.6);
      await screenshotPng(cdp, join(out, `10-postoj-${String(i).padStart(2, '0')}${close ? '-blisko' : ''}.png`));
      if (args.cienie && i === 6 && report.tryb === 'worker') {
        const setShadow = (v) => evalWorker(`import(new URL('../3d/cargo/portCargo3D.js', self.location.href).href).then((m) => { const p = m.sharedPortCargo3D().pool; if (!p || !p.shadows) return 'brak'; p.shadows.strength.value = ${v}; return 'ok'; })`);
        for (const v of [4, 0]) {
          report.cienie = await setShadow(v);
          await waitGame(1 / 60);
          await screenshotPng(cdp, join(out, `15-cienie-${v}.png`));
        }
        await setShadow(0.5);
      }
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
    const costRun = async () => {
      const rows = [];
      const pool = report.tryb === 'worker' ? await poolStats() : null;
      for (let i = 0; i < 20; i++) {
        await waitGame(0.25);
        rows.push(await ev(`(() => { const h = window.RenderWorkerHost; if (h && h.readStats) h.readStats(); const st = h ? h.stats : null;
          const f = window.PortCargo.frame;
          return { gpu: st ? st[0] : (window.Core3D.gpuFrameMs || 0), gpuCompute: st ? st[1] : (window.Core3D.gpuComputeMs || 0), cpu: st ? st[6] : 0, cpuUpd: st ? st[4] : 0, fx: st ? st[11] : 0, ops: f.opCount, yards: f.yardCount }; })()`));
      }
      const avg = (k) => +(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rows.length).toFixed(3);
      return { gpuMs: avg('gpu'), gpuComputeMs: avg('gpuCompute'), cpuWorkerMs: avg('cpu'), cpuUpdateMs: avg('cpuUpd'), fxMs: avg('fx'), przeladunkow: avg('ops'), pol: avg('yards'), pula: pool };
    };
    for (const vh of String(args.kosztKadr || '9000,2600').split(',').map(Number)) {
    await ev(`window.PortCargo.look(${c.x}, ${c.y}, ${vh})`);
    await waitGame(2);
    report.koszt = await costRun();
    report.kosztKadry[vh] = report.koszt;
    console.log('koszt kadr', vh, JSON.stringify(report.koszt));
    await screenshotPng(cdp, join(out, `30-koszt-kadr-${vh}.png`));
    }
    if (args.kosztPoza) {
      // Daleko od zatok (ten sam port w tle bańki): sloty roju zwalniają się po missingGrace + taśmie (do ~12 s gry).
      await ev(`window.PortCargo.look(${c.x} + 150000, ${c.y}, 2600)`);
      await waitGame(15);
      report.kosztPoza = await costRun();
      console.log('koszt poza portem', JSON.stringify(report.kosztPoza));
    }
  }
  if (args.tylkoKoszt) {
    // Błędy i pipeline'y też w samym pomiarze kosztu (wyjątek w klatce strony zamraża obraz — liczby byłyby fałszywe).
    report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|[vite]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
    report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]')).slice(0, 20);
    report.syncKoniec = syncWorker();
    console.log('pipeline sync workera: start', report.syncStart.length, '| koniec', report.syncKoniec.length - report.syncStart.length);
    console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
    for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 4)) console.log('  ', l.slice(0, 300));
    throw new Error('tylko koszt — koniec');
  }

  // Luk Atlasa: gracz na wolnym polu MEGA zatoki z ładunkiem i otwartym terminalem stacji — luk się otwiera,
  // kontenery z ładunku (sam postój — berth-hold — luku nie otwiera: domyślnie zamknięty, 2026-10-26).
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
  await waitGame(2);
  report.atlas.doorPostoj = await ev('window.PortCargo.playerDoor');
  await ev(`window.openStationUI((window.stations || []).find((s) => s.id === 'earth'), 'trade')`);
  await waitGame(9);
  report.atlas.door = await ev('window.PortCargo.playerDoor');
  report.atlas.held = await ev('window.TrafficBubble.held.slice()');
  await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.55; window.DevScene?.syncCamera?.(); return true; })()`);
  await waitGame(1);
  await screenshotPng(cdp, join(out, '40-luk-atlasa.png'));
  await ev('window.closeStationUI()');
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
