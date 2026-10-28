// WYGLĄD STATKÓW RUCHU v2 w PRAWDZIWEJ grze (E17): proxy bańki (ShipProxyBatch3D) kontra pełny kadłub NPC
// (na belkach, lakier, oświetlenie v2, lampy) — TEN SAM statek w tym samym miejscu i świetle. Vite + headless Chrome
// z WebGPU (CDP), zegar krokowy harnessu.
//
//   node scripts/webgpu/ruch-wyglad-gra.mjs [--query renderWorker=1] [--out .tmp/e17/<katalog>] [--port 5471]
//        [--sceny port,hala,reda,lot,awans] [--rozgrzewka 0] [--cele zapas,dok,reda,lot] [--px 560]
//
// Sceny (kamera w trybie `focus` nad punktem, gracz poza kadrem): port Ziemi z daleka (`01-port.png`), hala K-7
// z zapasem floty (`02-hala.png`, zbliżenie `02-hala-blisko.png`), reda (`03-reda.png`), statek w locie (`04-lot.png`).
// AWANS A/B (`--cele`): cel w kadrze (dłuższy bok ~`--px` px) jako proxy (`1N-<cel>-a-proxy.png`), wymuszony awans
// (kolejka `TrafficPromotion` — jak trafienie gracza), klatki przejścia (`1N-<cel>-przejscie-KK.png`), pełny NPC
// (`1N-<cel>-b-npc.png`), powrót do bańki (strojenie werdyktu: `calmSeconds` / `releaseRadius` 0 — `1N-<cel>-c-powrot.png`).
// `--rozgrzewka 0` (domyślnie) — zimny start jak u gracza: świat liczy tylko własną rozgrzewkę gry (E15, ~300 encji
// przy Ziemi); `N` — dodatkowo `TrafficV2.advance` N s przed scenami.
// KOSZT (`--sceny koszt`, tryb worker): worker renderu — GPU klatki, CPU aktualizacji modułów i całej klatki — z proxy
// i bez (`TrafficBubble.hideRender`) w kadrach `--kadry port,zatoki,hala` (`--probki 24` po 0,25 s gry). A/B wersji
// kodu — dwa przebiegi PO KOLEI, „przed” z `HULLFALL_AB_DIR=<katalog ze starymi plikami>` (vite.config.js).
// Wynik: <out>/raport.json (cele, pozy proxy / NPC, liczniki), zrzuty, pipeline'y synchroniczne, błędy konsoli.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/e17/wyglad');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const WARM = Number(args.rozgrzewka || 0);
const SCENES = new Set(String(args.sceny || 'port,hala,reda,lot,awans').split(','));
const TARGETS = String(args.cele || 'zapas,dok,reda,lot').split(',').filter(Boolean);
const TARGET_PX = Number(args.px || 560);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5471));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 25) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, sceny: {}, cele: {} };
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

async function step(n) {
  let left = Math.max(1, Math.round(n));
  while (left > 0) {
    const k = Math.min(120, left);
    await ev(`window.__harness.step(${k}).then(() => true)`, 600000);
    left -= k;
  }
}

// Kamera nad punktem świata (tryb `focus` kamery gry — rig gracza nie rusza kadru), zoom stały.
// Zoom trybu `focus` gra liczy z promienia „stacji” (computeStationFocusTarget: promień ~0,24 krótszego boku ekranu),
// środek kadru z `focusScreen*Ratio` — promień dobrany pod zadany zoom, punkt na środku ekranu.
const FOCUS_JS = (x, y, z) => `const c = window.camera; c.mode = 'focus'; c.focusScreenXRatio = 0.5; c.focusScreenYRatio = 0.5;
  const px = Math.max(180, Math.min(320, Math.min(window.W || 1600, window.H || 900) * 0.24));
  c.focusStation = { x: ${x}, y: ${y}, r: px / ${z} }; c.transition = null;
  c.minZoom = 0.003; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z};
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; window.DevScene?.syncCamera?.();`;
const FOCUS = (x, y, z) => `(() => { ${FOCUS_JS(x, y, z)} return true; })()`;
// Kamera po krokach (kontrola kadru w raporcie): zoom, granice zoomu gry, środek.
const CAM = '(() => { const c = window.camera; return { zoom: c.zoom, min: c.minZoom, max: c.maxZoom, mode: c.mode, x: Math.round(c.x), y: Math.round(c.y) }; })()';
// Gracz poza kadrem: `d` j. od punktu, prostopadle do osi `ang` (kadłub gracza nie zasłania celu, bańka zostaje przy porcie).
const PLAYER_AWAY = (x, y, d) => `(() => { window.devTeleportTo(${x} + ${d}, ${y} + ${d} * 0.35, { angle: 0, quiet: true });
  window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`;

// Encje bańki gry (TrafficBubble.list) — cele scen. Flagi: 1 WARP, 64 STOCK, 128 DEPARTED, 256 PARKED.
const PICK = {
  zapas: `(a) => a.alive && (a.flags & 64) && !(a.flags & 256) && a.phase === 'docked'`,
  dok: `(a) => a.alive && a.id >= 0 && !(a.flags & (1 | 64 | 128 | 256)) && a.phase === 'docked'`,
  reda: `(a) => a.alive && (a.flags & 256) && !(a.flags & 64)`,
  lot: `(a) => a.alive && a.id >= 0 && !(a.flags & (1 | 64 | 256)) && a.phase !== 'docked' && a.phase !== 'hold'
    && Math.hypot(a.vx, a.vy) > 60 && Math.hypot(a.vx, a.vy) < 1500 && a.length >= 250`
};
// Cel najbliżej punktu (domyślnie: hala K-7 nr 0 Ziemi), największy w kadrze przy remisie.
const usedIds = new Set();
const findTarget = (name, px, py) => ev(`(() => { const f = ${PICK[name]}; const used = new Set(${JSON.stringify([...usedIds])});
  const list = window.TrafficBubble.list.filter((a) => f(a) && !used.has(a.id) && !window.TrafficPromotion.alive.has(a.id));
  if (!list.length) return null;
  list.sort((a, b) => Math.hypot(a.cx - ${px}, a.cy - ${py}) - Math.hypot(b.cx - ${px}, b.cy - ${py}));
  const a = list[0];
  return { id: a.id, hull: a.hullId, cls: a.unitClass, x: a.cx, y: a.cy, ca: a.ca, len: a.length, wid: a.width, flags: a.flags,
    phase: a.phase, vx: a.vx, vy: a.vy, faction: a.factionId, n: list.length }; })()`);

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
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  // Rozgrzewka świata w grze (E15) — bańka milczy do jej końca.
  if (!await waitFor(cdp, '!(window.TrafficV2.warmup && window.TrafficV2.warmup.active)', 600000, 500)) throw new Error('rozgrzewka świata nie skończyła się');
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  await ev('window.__harness.hold(true)');
  // Broń gracza bez AUTO: wieże same biją wrogów w zasięgu (okręt po awansie ma urazę) — psuły kadry A/B i awans.
  await ev('(() => { const fc = window.fireControl; if (fc && fc.auto) for (const k of Object.keys(fc.auto)) fc.auto[k] = false; return true; })()');
  if (WARM > 0) {
    await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
    if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  }
  // Sprite'y kadłubów z góry (awans buduje kadłub na belkach ze sprite'a).
  for (let k = 0; k < 120; k++) { if (await ev('window.DevScene.preloadHullSprites()')) break; await step(5); }

  // Port Ziemi: gracz 7 tys. j. na zewnątrz od pierwszej zatoki (jak ruch-banka-gra.mjs), bańka otwiera się przy nim.
  const spot = await ev(`(() => {
    const berths = window.TrafficV2.tables.bubblePorts.earth;
    const earth = window.TrafficV2.getStation('earth');
    const b = berths.find((x) => x.hall === 'ZATOKA') || berths[0];
    const k7 = berths.find((x) => x.hall === 'K-7') || b;
    const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
    const x = b.x + dx / d * 7000, y = b.y + dy / d * 7000;
    window.devTeleportTo(x, y, { angle: Math.atan2(-dy, -dx), quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { x, y, earth: { x: earth.x, y: earth.y }, k7: { x: k7.x, y: k7.y, id: k7.id } };
  })()`);
  report.spot = spot;
  await ev(FOCUS(spot.x, spot.y, 0.045));
  await step(240);
  report.bańka = await ev(`(() => { const tb = window.TrafficBubble; let stock = 0, parked = 0, fly = 0;
    for (const a of tb.list) { if (a.flags & 64) stock++; else if (a.flags & 256) parked++; else fly++; }
    return { encji: tb.list.length, zapas: stock, postoj: parked, kursy: fly }; })()`);
  console.log('tryb', report.tryb, 'bańka', JSON.stringify(report.bańka));

  if (SCENES.has('port')) {
    await screenshotPng(cdp, join(out, '01-port.png'));
    report.sceny.port = { zoom: 0.045 };
  }
  if (SCENES.has('hala')) {
    const t = await findTarget('zapas', spot.k7.x, spot.k7.y);
    if (t) {
      await ev(PLAYER_AWAY(t.x, t.y, 9000));
      await ev(FOCUS(t.x, t.y, 0.12));
      await step(60);
      await screenshotPng(cdp, join(out, '02-hala.png'));
      t.kamera = await ev(CAM);
      await ev(FOCUS(t.x, t.y, Math.min(1.2, TARGET_PX / Math.max(t.len, t.wid))));
      await step(30);
      await screenshotPng(cdp, join(out, '02-hala-blisko.png'));
      t.kameraBlisko = await ev(CAM);
    }
    report.sceny.hala = t;
  }
  if (SCENES.has('reda')) {
    const r = await ev(`(() => { const list = window.TrafficBubble.list.filter((a) => (a.flags & 256) && !(a.flags & 64));
      if (!list.length) return null;
      let best = list[0], bestN = 0;
      for (const a of list) { let n = 0; for (const b of list) if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < 6000) n++; if (n > bestN) { best = a; bestN = n; } }
      return { x: best.cx, y: best.cy, n: bestN, all: list.length }; })()`);
    if (r) {
      await ev(PLAYER_AWAY(r.x, r.y, 14000));
      await ev(FOCUS(r.x, r.y, 0.09));
      await step(60);
      await screenshotPng(cdp, join(out, '03-reda.png'));
    }
    report.sceny.reda = r;
  }
  if (SCENES.has('lot')) {
    const t = await findTarget('lot', spot.x, spot.y);
    if (t) {
      const z = Math.min(1.2, TARGET_PX / Math.max(t.len, t.wid)) * 0.6;
      await ev(PLAYER_AWAY(t.x, t.y, 2.2 * 800 / z));
      // Kamera jedzie za statkiem: ogniskowanie co krok na pozie encji z bańki gry.
      for (let k = 0; k < 40; k++) {
        await ev(`(() => { const a = window.TrafficBubble.byId.get(${t.id}); if (!a) return false;
          ${FOCUS_JS('a.cx', 'a.cy', z)} return true; })()`);
        await step(1);
      }
      await screenshotPng(cdp, join(out, '04-lot.png'));
      t.kamera = await ev(CAM);
      t.zoomChciany = z;
    }
    report.sceny.lot = t;
  }

  if (SCENES.has('awans')) {
    let n = 10;
    for (const name of TARGETS) {
      n++;
      const at = name === 'zapas' ? spot.k7 : spot;
      const t = await findTarget(name, at.x, at.y);
      if (!t) { report.cele[name] = { brak: true }; console.log('awans', name, ': brak celu'); continue; }
      usedIds.add(t.id);
      const tag = `${n}-${name}`;
      const z = Math.min(1.2, TARGET_PX / Math.max(t.len, t.wid));
      await ev(PLAYER_AWAY(t.x, t.y, 2.2 * 800 / z));
      const follow = `(() => { const st = window.TrafficPromotion, npc = st && st.alive.get(${t.id});
        const a = window.TrafficBubble.byId.get(${t.id});
        const x = npc ? npc.x : a ? a.cx : ${t.x}, y = npc ? npc.y : a ? a.cy : ${t.y};
        ${FOCUS_JS('x', 'y', z)}
        return { x, y, angle: npc ? npc.angle : a ? a.ca : null, npc: !!npc, hull: !!(npc && npc.beamHull) }; })()`;
      await ev(follow);
      await step(60);
      const poseProxy = await ev(follow);
      await step(1);
      await screenshotPng(cdp, join(out, `${tag}-a-proxy.png`));
      // Awans jak po trafieniu gracza (onTrafficActorHit → requestTrafficPromotion).
      await ev(`(() => { const st = window.TrafficPromotion; if (st.alive.has(${t.id}) || st.queued.has(${t.id})) return false;
        st.queue.push(${t.id}); st.queued.add(${t.id}); st.stats.requested++; return true; })()`);
      const frames = [];
      let built = -1;
      for (let k = 0; k < 600 && built < 0; k++) {
        await step(1);
        const p = await ev(follow);
        if (p.hull) built = k;
        if (k < 3 || p.hull) {
          const f = `${tag}-przejscie-${String(k).padStart(3, '0')}.png`;
          await screenshotPng(cdp, join(out, f));
          frames.push({ k, ...p, f });
        }
      }
      for (let k = 1; k <= 3; k++) {
        await step(1);
        const p = await ev(follow);
        const f = `${tag}-przejscie-${String(built + k).padStart(3, '0')}.png`;
        await screenshotPng(cdp, join(out, f));
        frames.push({ k: built + k, ...p, f });
      }
      await step(90);
      const poseNpc = await ev(follow);
      await step(1);
      await screenshotPng(cdp, join(out, `${tag}-b-npc.png`));
      const npcInfo = await ev(`(() => { const npc = window.TrafficPromotion.alive.get(${t.id}); if (!npc) return null;
        return { type: npc.type, frame: npc.shipFrame, lights: !!(npc.editorLights || npc.visual?.lights),
          lightsN: npc.editorLights ? (npc.editorLights.position?.length || 0) + (npc.editorLights.road?.length || 0) + (npc.editorLights.flood?.length || 0) : 0,
          main: npc.visual?.mainThrusters?.length || 0, side: npc.visual?.torqueThrusters?.length || 0,
          hp: npc.hp, combat: !npc.combatDisabled }; })()`);
      // Powrót do bańki: werdykt `demote` od razu (koniec walki, gracz „daleko”).
      const tune0 = await ev(`(() => { const st = window.TrafficPromotion; const t0 = { ...st.tune };
        st.tune.calmSeconds = 0; st.tune.releaseRadius = 0; st.tune.ramCalmSeconds = 0; st.tune.ramReleaseRadius = 0;
        const npc = st.alive.get(${t.id}); if (npc) { npc._lastPlayerHit = -1e9; npc.__trafficPromotedAt = -1e9; }
        return t0; })()`);
      let back = -1;
      for (let k = 0; k < 600 && back < 0; k++) {
        await step(1);
        const p = await ev(`(() => ({ alive: window.TrafficPromotion.alive.has(${t.id}), bubble: !!window.TrafficBubble.byId.get(${t.id}) }))()`);
        if (!p.alive && p.bubble) back = k;
        if (back >= 0 || k < 2) {
          await ev(follow);
          const f = `${tag}-powrot-${String(k).padStart(3, '0')}.png`;
          await screenshotPng(cdp, join(out, f));
          frames.push({ k: `powrót ${k}`, ...p, f });
        }
      }
      await ev(`(() => { Object.assign(window.TrafficPromotion.tune, ${JSON.stringify(tune0)}); return true; })()`);
      await step(30);
      const poseBack = await ev(follow);
      await step(1);
      await screenshotPng(cdp, join(out, `${tag}-c-powrot.png`));
      report.cele[name] = { cel: t, zoom: z, poseProxy, poseNpc, poseBack, kadlubPoKlatkach: built, powrotPoKlatkach: back, npc: npcInfo, klatki: frames };
      console.log('awans', name, JSON.stringify({ hull: t.hull, id: t.id, built, back, npc: npcInfo }));
    }
  }

  if (SCENES.has('koszt')) {
    // Kadry: port z daleka (gracz nad zatoką, jak 01-port), zatoki z bliska (gracz w porcie), hala K-7 z zapasem floty
    // (gracz w hali — dach otwarty, lampy okrętów widać).
    const KADRY = String(args.kadry || 'port,zatoki,hala').split(',');
    const PROBKI = Number(args.probki || 24);
    const where = {
      port: { ...spot, zoom: 0.045 },
      zatoki: { x: spot.x, y: spot.y, zoom: 0.12 },
      hala: { x: spot.k7.x, y: spot.k7.y, zoom: 0.2 }
    };
    const sample = () => ev(`(() => { const h = window.RenderWorkerHost; if (!h) return null; if (h.readStats) h.readStats(); const s = h.stats;
      return { gpu: s[0], gpuN: s[2], upd: s[4], render: s[5], frame: s[6] }; })()`);
    const run = async (hide) => {
      await ev(`(() => { window.TrafficBubble.hideRender = ${hide}; return true; })()`);
      await step(90);
      const rows = [];
      let n0 = -1;
      for (let i = 0; i < PROBKI; i++) {
        await step(15);
        const r = await sample();
        if (!r) break;
        // GPU: tylko nowe próbki znaczników czasu (licznik)
        if (r.gpuN !== n0) { r.gpuNew = true; n0 = r.gpuN; }
        rows.push(r);
      }
      const avg = (k, f = () => true) => { const xs = rows.filter(f).map((r) => Number(r[k]) || 0); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null; };
      const med = (k) => { const xs = rows.map((r) => Number(r[k]) || 0).sort((a, b) => a - b); return xs.length ? +xs[xs.length >> 1].toFixed(3) : null; };
      return { gpuMs: avg('gpu', (r) => r.gpuNew), cpuUpdMs: avg('upd'), cpuRenderMs: avg('render'), cpuKlatkaMs: avg('frame'), cpuKlatkaMed: med('frame'), probek: rows.length };
    };
    report.koszt = {};
    for (const k of KADRY) {
      const w = where[k];
      if (!w) continue;
      await ev(`(() => { window.devTeleportTo(${w.x}, ${w.y}, { angle: 0, quiet: true }); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
      await ev(FOCUS(w.x, w.y, w.zoom));
      await step(120);
      const widac = await ev(`window.TrafficBubble.list.length`);
      const z = await run(false);
      await screenshotPng(cdp, join(out, `20-koszt-${k}.png`));
      const bez = await run(true);
      await ev('(() => { window.TrafficBubble.hideRender = false; return true; })()');
      report.koszt[k] = { encji: widac, zProxy: z, bezProxy: bez, kamera: await ev(CAM) };
      console.log('koszt', k, JSON.stringify(report.koszt[k]));
    }
  }

  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
  report.bledy = logs.errors().slice(0, 40);
  report.workerBledy = workerLogs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 40);
  console.log('pipeline sync (worker):', report.syncKoniec.length, 'strona:', report.syncStronaKoniec.length, 'błędy:', report.bledy.length + report.workerBledy.length);
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
} finally {
  writeJson(join(out, 'raport.json'), report);
  clearTimeout(guard);
  try { await chrome.close(); } catch {}
  try { await server.close(); } catch {}
}
process.exit(report.wyjatek ? 1 : 0);
