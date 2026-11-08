// GÓRNICY I ZŁOMIARZE NPC W BAŃCE w PRAWDZIWEJ grze (E24): górnik przy polu pasa (drony i lasery platformy),
// złomiarz tnie wrak cywila i holuje wrak okrętu po bitwie gracza przy Ziemi; zrzuty, film klatek (GIF), koszt
// klatki z obrazem pracy i bez (`TrafficBubble.hideRender` — A/B w tym samym przebiegu), pipeline'y synchroniczne.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/zlomiarze-gra.mjs [--query renderWorker=1] [--out .tmp/zlomiarze] [--port 5481]
//        [--rozgrzewka 1800] [--etapy gornik,ciecie,hol,koszt] [--postoj 75] [--film 1]
//
// `--postoj N` — postój złomiarza przy wraku [s] (wiadomość `config.scrappers` do workera: cięcie i zaczepienie w kadrze
// filmu; gospodarka tego przebiegu — tylko narzędzia). Wynik: <out>/raport.json, zrzuty <out>/*.png, film <out>/*.gif.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/zlomiarze');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const WARM = Number(args.rozgrzewka || 1800);
const STAGES = new Set(String(args.etapy || 'gornik,ciecie,hol,koszt').split(','));
const DWELL = Number(args.postoj || 75);
const FILM = args.film !== '0';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5481));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 40) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { query, etapy: {} };
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
/** Kroki gry, aż warunek (wyrażenie strony) będzie prawdziwy — co `every` s gry, najwyżej `limit` s. */
async function waitUntil(expr, limit, every = 1) {
  for (let t = 0; t <= limit; t += every) {
    if (await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return t;
    await waitGame(every);
  }
  return -1;
}
const ZOOM = (z) => `(() => { const c = window.camera; c.minZoom = 0.003; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; window.DevScene?.syncCamera?.(); return true; })()`;
const LOOK = (x, y, h) => `window.PortCargo.look(${x}, ${y}, ${h})`;
const snapshot = () => ev(`window.TrafficV2.requestSnapshot().then((s) => ({ time: s.time, work: s.work, scrappers: s.scrappers }))`);
// Stan pracy po stronie gry: rekordy pracy, encje, zgłoszenia, praca złomiarzy, ramka obrazu.
const workState = () => ev(`(() => {
  const br = window.TrafficV2, tb = window.TrafficBubble, ts = window.TrafficSalvage;
  const works = [...br.actorWorks.values()].map((r) => {
    const a = tb.byId.get(r.id);
    return { ...r, actor: a ? { phase: a.phase, hull: a.hullId, x: Math.round(a.cx), y: Math.round(a.cy), len: a.length } : null };
  });
  const jobs = [...ts.jobs.entries()].map(([id, j]) => ({ id, gid: j.gid, kind: j.kind, active: j.active, rope: !!j.rope,
    ropeLen: j.rope ? Math.round(j.rope.length) : null, wreck: j.wreck ? { x: Math.round(j.wreck.x), y: Math.round(j.wreck.y),
      dead: !!j.wreck.dead, nodes: j.wreck.beamHull?.body?.activeNodes ?? null, cold: !!j.wreck.isCold } : null }));
  return { works, jobs, reported: [...ts.reported.keys()], taken: [...ts.taken.entries()], stats: { ...ts.stats },
    frame: ts.frame.count, encji: tb.list.length, czas: br.time };
})()`);

/** Film: `n` klatek co `every` kroków fizyki, kadr śledzi punkt z wyrażenia `focusExpr` → GIF (Pillow, gdy jest). */
async function film(name, n, every, focusExpr, viewH) {
  if (!FILM) return null;
  const dir = join(out, `${name}-klatki`);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < n; i++) {
    const f = await ev(`(() => { try { return ${focusExpr}; } catch (e) { return null; } })()`);
    if (f) await ev(LOOK(f.x, f.y, viewH));
    await ev(`window.__harness.step(${every}).then(() => true)`, 600000);
    const file = join(dir, `${String(i).padStart(3, '0')}.png`);
    await screenshotPng(cdp, file);
    files.push(file);
  }
  const gif = join(out, `${name}.gif`);
  const py = `import sys, glob\nfrom PIL import Image\nfs = sorted(glob.glob(sys.argv[1] + '/*.png'))\nims = [Image.open(f).convert('RGB').resize((960, 540)) for f in fs]\nims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=${Math.round(every * 1000 / 60)}, loop=0, optimize=True)\n`;
  const pyFile = join(out, '_gif.py');
  writeFileSync(pyFile, py);
  const r = spawnSync('python', ['-I', pyFile, dir, gif], { encoding: 'utf8' });
  return { klatki: files.length, gif: r.status === 0 ? gif : null, blad: r.status === 0 ? null : (r.stderr || '').slice(0, 400) };
}

/** Koszt klatki: średni czas pętli i CPU workera renderu z obrazem pracy i bez (`hideRender`), na zmianę. */
async function costAB(label, seconds = 4) {
  const sample = async (hide) => {
    await ev(`(() => { window.TrafficBubble.hideRender = ${hide}; return true; })()`);
    await waitGame(0.5);
    const t0 = await ev('performance.now()');
    await waitGame(seconds);
    const t1 = await ev('performance.now()');
    const st = await ev(`(() => { const h = window.PerfHUD; const d = h && h.display ? h.display : null;
      const rw = window.RenderWorkerHost?.stats?.() || null;
      return { fps: d ? d.fps : null, rw }; })()`);
    return { ms: (t1 - t0) / (seconds * 60), ...st };
  };
  const rows = [];
  for (let k = 0; k < 2; k++) {
    rows.push({ obraz: true, ...(await sample(false)) });
    rows.push({ obraz: false, ...(await sample(true)) });
  }
  await ev('(() => { window.TrafficBubble.hideRender = false; return true; })()');
  const avg = (on) => rows.filter((r) => r.obraz === on).reduce((s, r) => s + r.ms, 0) / 2;
  return { etykieta: label, przebiegi: rows, msNaKrokZObrazem: avg(true), msNaKrokBez: avg(false) };
}

// Wrak gry obok gracza: okręt wezwania (`spawnCallInShip`, wrogi) albo kadłub cywila (`spawnDevHull`) zniszczony
// z puli punktów — `convertToWreck`, hak `onWreckSpawned` zgłasza go złomiarzom.
const MAKE_WRECK = (kind, dx, dy) => `(async () => {
  const H = window.__harness, s = window.ship;
  const pos = { x: s.pos.x + ${dx}, y: s.pos.y + ${dy} };
  const r = ${kind === 'civil'} ? window.spawnDevHull('freighter-large', { pos, mode: 'dummy' })
    : window.spawnCallInShip('destroyer', { mode: 'hostile', spawnPos: pos, spawnAngle: 0.4 });
  const npc = Array.isArray(r) ? r[0] : r;
  if (!npc) return { blad: 'brak NPC' };
  for (let i = 0; i < 40 && !npc.beamHull; i++) await H.step(2);
  const before = window.TrafficSalvage.stats.reported;
  npc.vx = 0; npc.vy = 0;
  window.applyDamageToNPC(npc, 1e12, 'default');
  await H.step(4);
  const w = window.wrecks.filter((x) => x.owner === npc || x.owner?.owner === npc).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0] || null;
  return { npc: npc.type, hull: npc.shipFrame, radius: Math.round(npc.radius || 0), wrak: w ? { x: Math.round(w.x), y: Math.round(w.y), r: Math.round(w.radius),
    nodes: w.beamHull?.body?.activeNodes ?? null } : null, before };
})()`;

async function scrapperRun(name, kind, wantMode) {
  // Gracz przy Ziemi, za ringiem (bańka portu), wrak 2,5 km przed dziobem.
  const at = await ev(`(() => { const earth = window.TrafficV2.getStation('earth');
    const a = ${kind === 'civil' ? 0.9 : 2.3};
    window.devTeleportTo(earth.x + Math.cos(a) * 64000, earth.y + Math.sin(a) * 64000, { angle: a + Math.PI, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0; return { x: window.ship.pos.x, y: window.ship.pos.y }; })()`);
  await ev(ZOOM(0.12));
  await waitGame(2);
  const made = await ev(MAKE_WRECK(kind, -2500, 0), 600000);
  console.log(name, 'wrak:', JSON.stringify(made));
  const r = { gracz: at, wrak: made };
  // Zgłoszenie (reportDelay 2 s) i holownik z portu (krok świata co 5 s).
  r.zgloszenieS = await waitUntil(`window.TrafficSalvage.stats.reported > ${made.before || 0}`, 15, 1);
  const gid = await ev(`Math.max(...window.TrafficSalvage.reported.keys())`);
  r.gid = gid;
  r.wyslanyS = await waitUntil(`window.__zlomSnap && window.__zlomSnap.some((w) => w.gid === ${gid})`, 1, 1);
  for (let t = 0; t < 30 && r.wyslanyS < 0; t++) {
    const s = await snapshot();
    const job = (s.work || []).find((w) => w.gid === gid);
    if (job) { r.wyslanyS = t * 2; r.kurs = job; break; }
    await waitGame(2);
  }
  console.log(name, 'kurs złomiarza:', JSON.stringify(r.kurs || null));
  if (!r.kurs) { r.blad = 'brak kursu złomiarza po wrak'; return r; }
  // Dolot: encja z rekordem pracy w fazie station przy wraku.
  const arrived = `[...window.TrafficV2.actorWorks.values()].some((w) => w.gid === ${gid} && window.TrafficBubble.byId.get(w.id)?.phase === 'station')`;
  const tug = `(() => { const w = [...window.TrafficV2.actorWorks.values()].find((x) => x.gid === ${gid});
    const a = w && window.TrafficBubble.byId.get(w.id); return a ? { x: a.cx, y: a.cy } : null; })()`;
  // W drodze: kadr co kilka sekund za holownikiem (zrzut dolotu).
  for (let t = 0; t < 240; t += 3) {
    if (await ev(`(() => { try { return ${arrived}; } catch (e) { return false; } })()`)) { r.dolotS = t; break; }
    if (t === 21) {
      const p = await ev(tug);
      if (p) { await ev(LOOK(p.x, p.y, 9000)); await waitGame(0.2); await screenshotPng(cdp, join(out, `${name}-1-dolot.png`)); }
    }
    await waitGame(3);
  }
  r.przyWraku = await workState();
  console.log(name, 'przy wraku po', r.dolotS, 's:', JSON.stringify(r.przyWraku.works.filter((w) => w.gid === gid)));
  const wr = made.wrak;
  if (wr) {
    await ev(LOOK(wr.x, wr.y, wantMode === 'cut' ? 2600 : 5200));
    await waitGame(2);
    await screenshotPng(cdp, join(out, `${name}-2-praca.png`));
    await waitGame(0.25);
    await screenshotPng(cdp, join(out, `${name}-2b-praca.png`));
  }
  // Film pracy: cięcie (wrak maleje) albo zaczepienie i odlot z wrakiem.
  const focus = wantMode === 'cut' ? `({ x: ${wr?.x ?? 0}, y: ${wr?.y ?? 0} })` : `(() => {
    const w = [...window.TrafficV2.actorWorks.values()].find((x) => x.gid === ${gid});
    const a = w && window.TrafficBubble.byId.get(w.id); if (!a) return null;
    const j = window.TrafficSalvage.jobs.get(w.id); const k = j && j.wreck ? j.wreck : null;
    return k ? { x: (a.cx + k.x) / 2, y: (a.cy + k.y) / 2 } : { x: a.cx, y: a.cy }; })()`;
  r.film = await film(`${name}-film`, 36, wantMode === 'cut' ? 60 : 30, focus, wantMode === 'cut' ? 2600 : 6000);
  r.wPracy = await workState();
  // Koniec pracy: cięcie — wrak znika; hol — odlot z wrakiem na linie, wrak znika z holownikiem.
  r.koniecS = await waitUntil(`window.TrafficSalvage.taken.has(${gid}) || !window.TrafficSalvage.reported.has(${gid})`, DWELL + 60, 2);
  r.poKoncu = await workState();
  if (wantMode === 'tow') {
    r.filmOdlot = await film(`${name}-odlot`, 30, 45, focus, 9000);
    await screenshotPng(cdp, join(out, `${name}-3-odlot.png`));
  } else {
    await ev(LOOK(wr?.x ?? 0, wr?.y ?? 0, 2600));
    await waitGame(1);
    await screenshotPng(cdp, join(out, `${name}-3-po-cieciu.png`));
  }
  r.wynik = await workState();
  r.snap = (await snapshot()).scrappers;
  await ev('window.PortCargo.lookEnd()');
  return r;
}

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
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  await ev('window.__harness.hold(true)');
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  console.log('tryb', report.tryb);
  // Krótszy postój złomiarzy (cięcie i zaczepienie w kadrze filmu).
  await ev(`(() => { window.TrafficV2._send({ type: 'config', scrappers: { cutSeconds: ${DWELL}, hookSeconds: ${DWELL} } }); return true; })()`);

  const tw0 = Date.now();
  await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
  if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');

  // 1) Górnik przy polu: wyprawa w etapie wydobycia z najdłuższą resztą postoju, gracz 2,5 km obok.
  if (STAGES.has('gornik')) {
    const g = {};
    const s = await snapshot();
    const mines = (s.work || []).filter((w) => w.kind === 'mine' && w.phase === 'work' && w.left > 120).sort((a, b) => b.left - a.left);
    g.wydobyc = mines.length;
    g.cel = mines[0] || null;
    console.log('górników w pracy', mines.length, JSON.stringify(g.cel));
    if (g.cel) {
      await ev(`(() => { window.devTeleportTo(${g.cel.x + 2600}, ${g.cel.y + 1200}, { angle: Math.PI, quiet: true });
        window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
      await ev(ZOOM(0.25));
      const id = g.cel.course;
      g.encjaS = await waitUntil(`window.TrafficV2.actorWorks.get(${id}) && window.TrafficBubble.byId.get(${id})?.phase === 'station'`, 40, 1);
      g.stan = await workState();
      const p = await ev(`(() => { const a = window.TrafficBubble.byId.get(${id}); return a ? { x: a.cx, y: a.cy, hull: a.hullId, len: a.length } : null; })()`);
      g.encja = p;
      if (p) {
        await ev(LOOK(p.x, p.y, 3200));
        await waitGame(1.5);
        await screenshotPng(cdp, join(out, 'gornik-1-kadr.png'));
        await ev(LOOK(p.x, p.y, 1600));
        await waitGame(0.6);
        await screenshotPng(cdp, join(out, 'gornik-2-blisko.png'));
        g.film = await film('gornik-film', 36, 15, `({ x: ${p.x}, y: ${p.y} })`, 2200);
        if (report.tryb === 'off') g.widok = await ev('(() => { const m = window.__asteroidBelt?.miningView; return m ? { ...m.stats } : null; })()');
        g.ramka = await ev('window.TrafficSalvage.frame.count');
        if (STAGES.has('koszt')) g.koszt = await costAB('górnik przy polu');
        await ev('window.PortCargo.lookEnd()');
      }
    }
    report.etapy.gornik = g;
  }

  // 2) Złomiarz tnie wrak cywila (frachtowiec — sam złom), 3) holuje wrak okrętu (niszczyciel wezwania).
  if (STAGES.has('ciecie')) report.etapy.ciecie = await scrapperRun('ciecie', 'civil', 'cut');
  if (STAGES.has('hol')) report.etapy.hol = await scrapperRun('hol', 'warship', 'tow');
  if (STAGES.has('koszt') && STAGES.has('hol')) report.etapy.kosztPort = await costAB('port Ziemi po holu');

  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(report.blad);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
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
