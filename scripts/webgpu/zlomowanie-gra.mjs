// ZŁOMOWANIE JAKO PROCES w PRAWDZIWEJ grze (reguła `zlomowanie`, scena `?scena=holowanie`): narzędzie idzie za
// pierwszym cięciem sceny — fazy pracy złomiarza (podawanie wraku, cięcie rzazem, mielenie w paszczy), zbliżenia
// każdej fazy, film GIF kadru pracy, liczba kawałków i węzłów w czasie, pipeline'y synchroniczne i błędy konsoli.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/zlomowanie-gra.mjs [--query renderWorker=1] [--out .tmp/zlomowanie] [--port 5487]
//        [--limit-gry 260] [--film 1] [--kadr 1900] [--szer 1920] [--wys 820] [--kamera scena]
//
// `--kamera scena` — bez kamery narzędzia: zrzuty pokazują kadr, który scena sama ustawia nad pracą (to widzi gracz).
//
// Wynik: <out>/raport.json, zrzuty <out>/*.png, film <out>/ciecie.gif.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/zlomowanie');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const GAME_LIMIT = Number(args['limit-gry'] || 260);
const FILM = args.film !== '0';
const WIDTH = Number(args.szer || 1920);
const HEIGHT = Number(args.wys || 820);
/** Wysokość kadru zbliżenia [j. świata]. */
const VIEW_H = Number(args.kadr || 1900);
const SCENE_CAM = args.kamera === 'scena';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5487));
const chrome = await startChrome({ width: WIDTH, height: HEIGHT });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { query, zrzuty: [], fazy: [], probki: [] };
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
const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))}).then(() => true)`, 600000);
let gameT = 0;
const shot = async (name, opis) => {
  const file = join(out, `${name}.png`);
  await screenshotPng(cdp, file);
  report.zrzuty.push({ plik: file, opis, t: Math.round(gameT * 10) / 10 });
  console.log(`  zrzut ${name} (t=${gameT.toFixed(1)} s): ${opis}`);
};
/** Kamera nad punktem (wysokość kadru h j.) — zostaje tam (film pracy). */
const lookAt = (p, h) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, 0.003); c.manualZoom = true;
  c.x = c.targetX = ${p.x}; c.y = c.targetY = ${p.y}; c.zoom = c.targetZoom = c.zoomBase = ${(HEIGHT / h).toFixed(4)};
  c.zoomVel = 0; window.DevScene.syncCamera(); return true; })()`);
/** Stan prac cięcia: złomiarz, faza procesu, kawałki wraku. */
const state = () => ev(`(() => {
  const ts = window.TrafficSalvage, tb = window.TrafficBubble, br = window.TrafficV2;
  if (!ts || !tb || !br) return null;
  const jobs = [];
  for (const [id, j] of ts.jobs) {
    const a = tb.byId.get(id); const S = j.scrap; const rec = ts.reported.get(j.gid);
    let pieces = 0, nodes = 0;
    if (rec) for (const w of [rec.wreck, ...rec.extras]) if (w && !w.dead) { pieces++; nodes += w.beamHull?.body?.activeNodes || 0; }
    jobs.push({ id, gid: j.gid, kind: j.kind, active: !!j.active, rope: !!j.rope,
      tug: a ? { x: Math.round(a.cx), y: Math.round(a.cy), kat: +a.ca.toFixed(3), dl: a.length, faza: a.phase } : null,
      pieces, nodes,
      scrap: S ? { faza: S.phase, linia: S.line, linii: S.plan ? S.plan.lines.length : 0, sekcji: S.plan ? S.plan.sections : 0, tempo: +S.rate.toFixed(2),
        pos: Number.isFinite(S.posErr) ? Math.round(S.posErr) : null, kat: Number.isFinite(S.angErr) ? +S.angErr.toFixed(3) : null,
        czlon: Math.round(S.seg), palniki: S.arms.map((m) => m.torch), kolejka: S.queue.length, cs: S.cs, stats: { ...S.stats } } : null,
      praca: (() => { const w = br.actorWorks.get(id); return w ? { t0: +w.t0.toFixed(1), dur: +w.dur.toFixed(1), teraz: +br.time.toFixed(1) } : null; })() });
  }
  return { jobs, scena: window.TowScene ? window.TowScene.phase : null, wraki: (window.wrecks || []).length,
    obraz: window.TrafficWork3D && window.TrafficWork3D.stats ? { ...window.TrafficWork3D.stats } : null };
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  const url = `${base}/index.html?dev=1&trafficSeed=7&scena=holowanie${query}`;
  report.url = url.replace(base, 'http://localhost:5173');
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  if (!await waitFor(cdp, '!!(window.TowScene && window.TowScene.active)', 30000, 200)) throw new Error('scena nie ruszyła');
  if (!await waitFor(cdp, '!(window.TrafficV2.warmup && window.TrafficV2.warmup.active)', 300000, 500)) throw new Error('rozgrzewka świata nie skończyła się');
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  await ev('window.__harness.hold(true)');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  console.log(`tryb ${report.tryb}, ${report.url}`);

  // 1) Scena do kolejki wraków.
  for (let i = 0; i < 240; i++) {
    const s = await ev('window.TowScene.phase');
    if (s === 'kolejka' || s === 'praca') break;
    await step(30); gameT += 0.5;
  }
  await step(60); gameT += 1;
  await shot('0-plac', 'plac wraków w kadrze sceny');
  report.zgloszenia = await ev('[...window.TrafficSalvage.reported.values()].map((r) => ({ gid: r.gid, r: Math.round(r.wreck.radius || 0), wezly: r.wreck.beamHull?.body?.activeNodes ?? null, rola: r.spec?.classId, hol: !!r.spec?.towable }))');

  // 2) Pierwsze cięcie: fazy procesu, zbliżenia, film.
  const filmDir = join(out, 'klatki');
  if (FILM) mkdirSync(filmDir, { recursive: true });
  let follow = null;          // numer kursu złomiarza, za którym idzie kamera
  let last = '';
  let frames = 0, lastFrame = -1;
  const seen = {};
  for (; gameT < GAME_LIMIT;) {
    await step(15); gameT += 0.25;
    const s = await state();
    if (!s) break;
    const job = follow != null ? s.jobs.find((j) => j.id === follow) : s.jobs.find((j) => j.scrap);
    if (!job) { if (follow != null && seen.done) break; continue; }
    if (follow == null) {
      follow = job.id;
      report.praca = { kurs: job.id, gid: job.gid, zlomiarz: job.tug, postoj: job.praca, wezly0: job.nodes };
      console.log(`  cięcie: kurs ${job.id}, wrak ${job.gid}, ${job.nodes} węzłów, postój ${JSON.stringify(job.praca)}`);
    }
    const S = job.scrap;
    if (!S) continue;
    // Kamera: przed dziobem złomiarza (miejsce pracy), kadr VIEW_H.
    if (job.tug && !SCENE_CAM) {
      const f = job.tug.dl * 0.62;
      await lookAt({ x: job.tug.x + Math.cos(job.tug.kat) * f, y: job.tug.y + Math.sin(job.tug.kat) * f }, VIEW_H);
    }
    const tag = `${S.faza}:${S.linia}`;
    if (tag !== last) {
      last = tag;
      report.fazy.push({ t: gameT, faza: S.faza, linia: S.linia, kawalki: job.pieces, wezly: job.nodes, tempo: S.tempo, stats: S.stats });
      console.log(`  t=${gameT.toFixed(1)} ${tag} kawałki ${job.pieces} węzły ${job.nodes} tempo ${S.tempo} ${JSON.stringify(S.stats)}`);
    }
    if (Math.round(gameT * 4) % 8 === 0) report.probki.push({ t: gameT, faza: S.faza, kawalki: job.pieces, wezly: job.nodes, wraki: s.wraki, obraz: s.obraz });
    await step(2); gameT += 2 / 60;
    if (S.faza === 'feed' && !seen.feed && S.pos != null && S.pos > 60) { seen.feed = gameT; await shot('1-podawanie', `wiązki obracają i dosuwają wrak do dziobu (błąd pozycji ${S.pos} j., kąta ${S.kat} rad)`); }
    if (S.faza === 'cut' && S.palniki.some((p) => p > 0)) {
      seen.cutT = seen.cutT || gameT;
      if (!seen.cut && gameT - seen.cutT > 1.2) { seen.cut = gameT; await shot('2-ciecie', `dwa wysięgniki tną wrak w poprzek, linia ${S.linia + 1} z ${S.linii} (człon ${S.czlon} j.)`); }
      if (!seen.cut2 && S.linia >= 1 && gameT - seen.cutT > 2) { seen.cut2 = gameT; await shot('4-ciecie-kolejne', `kolejna linia (${S.linia + 1} z ${S.linii})`); }
    }
    if (S.faza === 'chew') {
      seen.chewT = seen.chewT || gameT;
      if (!seen.chew && gameT - seen.chewT > 1.5) { seen.chew = gameT; await shot('3-mielenie', `odcięta sekcja w paszczy, reszta wraku czeka (kawałków ${job.pieces})`); }
    }
    if (S.faza === 'done' && !seen.done) { seen.done = gameT; await step(60); gameT += 1; await shot('5-koniec', 'wrak zmielony, wysięgniki złożone'); }
    if (FILM && !seen.done && frames < 400 && Math.floor(gameT * 2) !== lastFrame) {
      lastFrame = Math.floor(gameT * 2);
      await screenshotPng(cdp, join(filmDir, `k${String(frames++).padStart(4, '0')}.png`));
    }
    if (seen.done && !s.jobs.find((j) => j.id === follow)) break;
    if (seen.done && gameT - seen.done > 25) break;
  }
  report.sekwencja = seen;
  if (FILM && frames > 1) report.film = { ...gif(out, 'ciecie', filmDir, 110), klatek: frames };
  if (!SCENE_CAM) await ev('window.DevScene.holowanieKadr()');
  await step(6);
  await shot('6-kadr-sceny', 'kadr sceny na końcu przebiegu');
  report.koniec = await state();
  report.dziennik = await ev('window.TrafficSalvage.log.slice(-60)');
  report.stats = await ev('({ ...window.TrafficSalvage.stats })');
  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  console.log(`sekwencja ${JSON.stringify(seen)}`);
  console.log(`sync worker ${report.syncKoniec.length} (start ${report.syncStart.length}), strona ${report.syncStronaKoniec.length}; błędy strony ${report.bledyStrony.length}, workera ${report.bledyWorkera.length}`);
  for (const l of [...new Set(report.syncKoniec)].slice(0, 12)) console.log('   sync:', l.slice(0, 200));
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('   ', l.slice(0, 300));
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(report.blad);
  try { await shot('blad', 'kadr w chwili błędu'); } catch {}
} finally {
  writeJson(join(out, 'raport.json'), report);
  try { await chrome.close(); } catch {}
  try { await server.close(); } catch {}
}
process.exit(report.blad ? 1 : 0);

/** Klatki z katalogu → GIF (Pillow, gdy jest). */
function gif(dirOut, name, dir, frameMs) {
  const file = join(dirOut, `${name}.gif`);
  const py = `import sys, glob
from PIL import Image
fs = sorted(glob.glob(sys.argv[1] + '/*.png'))
ims = [Image.open(f).convert('RGB').resize((960, 410)).convert('P', palette=Image.ADAPTIVE, colors=160) for f in fs]
ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=${frameMs}, loop=0, optimize=True)
`;
  const pyFile = join(dirOut, '_gif.py');
  writeFileSync(pyFile, py);
  const r = spawnSync('python', [pyFile, dir, file], { encoding: 'utf8' });
  return { gif: r.status === 0 ? file : null, blad: r.status === 0 ? null : (r.stderr || '').slice(0, 400) };
}
