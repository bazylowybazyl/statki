// Misja 1 w PRAWDZIWEJ grze: zegar startów i herszt w BAZIE PIRATÓW (2026-10-11; dawniej parking suchego doku) —
// Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/wodowanie-gra.mjs [--czas 150] [--zoom 0.045] [--out .tmp/wodowanie] [--rozmiar 1600x900] [--profil 20]
//
// Skok dev ?story=defences (alarm po taranie rzędu przy ramieniu A), kamera RTS nad środkiem bazy (cała baza w kadrze).
// Co sekundę: stan każdego okrętu z załogą (w stanowisku / przy działach / wystartował — odległość od stanowiska przy
// pomoście), okręty w remoncie zniszczone, drony, kawałki bazy odpadłe, cel misji, baner, podpowiedź, mostek herszta
// (supercapital w zatoce przy zbiornikach).
// Po pierwszym starcie od pomostu: herszt do 60% punktów (przyspiesza starty), potem do 30% (ucieczka i skok).
// Atlas trzymany przy życiu (tarcza i kadłub doładowywane) — sprawdzamy misję, nie przeżycie.
// Omijanie budowli (reguła flota-ai, „OMIJANIE BUDOWLI I TRASY”): co 100 ms czasu rzeczywistego — czy herszt i okręty
// z załogą po starcie (poza trasą wylotu z doku) stoją środkiem w bryle stojącego kawałka bazy (`dock.chunkAt`);
// `wBryle` w próbkach — liczniki narastająco (ma być 0); `trasy` — budowy grafu tras i grafy (`staticRouteStats`).
// --profil N: profil CPU przez N s od ucieczki herszta (trasy wokół bazy są wtedy najbardziej zajęte) — ms na klatkę
// funkcji tras i omijania (raport `profil`; plik .cpuprofile w <out> — dalej `scripts/webgpu/profil-analiza.mjs`).
// Wynik: <out>/*.png, <out>/raport.json (próbki, zdarzenia, błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wodowanie');
const czas = Number(args.czas || 150);
const profS = Number(args.profil || 0);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5374));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], zdarzenia: [], bledy: [] };

const SAMPLE = `(() => {
  const S = window.StoryGame, site = S.site, dock = site?.dock;
  const hub = (e) => { const p = e.pos || e; return dock ? dock.toHub(p.x, p.y) : { x: 0, z: 0 }; };
  const berths = dock ? dock.layout.berths : [];
  const one = (e) => {
    if (!e) return null;
    const h = hub(e);
    const b = Number.isInteger(e.__dockBerth) ? berths[e.__dockBerth] : null;
    const st = e.dead || !(e.hp > 0) ? 'zniszczony' : e.__storyLaunched ? 'wystartował' : (e.ai && !e.combatDisabled ? 'przy działach' : 'w stanowisku');
    return { id: e.__berthId || null, st, od_stanowiska: b ? Math.round(Math.hypot(h.x - b.x, h.z - b.z)) : null,
      v: Math.round(Math.hypot(e.vx || e.vel?.x || 0, e.vy || e.vel?.y || 0)), hp: +(e.hp / (e.maxHp || 1)).toFixed(2) };
  };
  const boss = site?.flagship;
  const bridge = S.ui.markers.get('bridge');
  const bp = boss ? (boss.pos || boss) : null;
  return {
    t: +S.runner.time.toFixed(1), faza: S.phase,
    cel: S.ui.objective ? S.ui.objective.text + (S.ui.objective.progress ? ' [' + S.ui.objective.progress() + ']' : '') : null,
    baner: S.ui.banner?.text || null, podpowiedz: S.ui.hint?.spec?.title || null,
    zaloga: (site?.crewList || []).map(one),
    remontZniszczone: (site?.repairList || []).filter((e) => e && (e.dead || !(e.hp > 0))).length,
    drony: (site?.droneList || []).filter((e) => e && !e.dead).length,
    eskorta: (site?.defenderList || []).filter((e) => e !== boss && !e.dead).length,
    herszt: boss ? { ...one(boss), uciekl: !!boss.warpedOut, skok: !!boss.__warpReturn, mostek: bridge ? Math.round(Math.hypot(bridge.x - bp.x, bridge.y - bp.y)) : null } : null,
    odpadle: window.__baseBroken?.() || [],
    wBryle: window.__baseIntrusion ? { ...window.__baseIntrusion } : null,
    trasy: window.staticRouteStats ? window.staticRouteStats() : null,
    cele: S.ui.targets.size,
    atlas: { tarcza: Math.round(window.ship.shield?.val || 0), kadlub: +(window.HullBodies?.structuralState?.(window.ship)?.ratio ?? 1).toFixed(2) }
  };
})()`;
const camCenter = (zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera, d = site.dock;
  const p = d.toGame(d.layout.center.x, d.layout.center.z);
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  return true;
})()`);
// Profil CPU (--profil): start przy ucieczce herszta, stop po profS s; klatki z licznika renderu.
let prof = null;
const profStart = async () => {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  prof = { t0: Date.now(), f0: await ev('window.__frameId') };
  await cdp.send('Profiler.start');
};
const profStop = async () => {
  const { profile } = await cdp.send('Profiler.stop');
  const klatki = (await ev('window.__frameId')) - prof.f0;
  const plik = join(out, `wodowanie-${Date.now()}.cpuprofile`);
  writeFileSync(plik, JSON.stringify(profile));
  report.profil = { s: +((Date.now() - prof.t0) / 1000).toFixed(1), klatki, plik, msNaKlatke: profileSummary(profile, klatki),
    trasy: await ev('window.staticRouteStats ? window.staticRouteStats() : null') };
  console.log('profil:', JSON.stringify(report.profil));
  prof = null;
};

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=defences` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active && window.StoryGame.phase === 'defences'", 300000, 400)) throw new Error('brak fazy defences');
  // Atlas przy życiu; kawałki bazy odpadłe (rozbite albo schowane bryły — nie ciała w bańce gracza)
  await ev(`(() => {
    window.__baseBroken = () => { return window.PirateBase ? window.PirateBase.broken() : []; };
    setInterval(() => { const s = window.ship; if (s?.shield) s.shield.val = s.shield.max; if (s && s.maxHp) s.hp = s.maxHp; }, 250);
    const I = window.__baseIntrusion = { herszt: 0, zaloga: 0, probki: 0 };
    setInterval(() => {
      const site = window.StoryGame.site;
      const d = site?.dock;
      if (!d) return;
      I.probki++;
      const broken = window.__baseBroken();
      const inBase = (e) => {
        if (!e || e.dead || !e.__storyLaunched || e.__dockLaunching) return false;
        const p = e.pos || e;
        const c = d.chunkAt(p.x, p.y);
        return !!c && !broken.includes(c);
      };
      if (inBase(site.flagship)) I.herszt++;
      for (const e of site.crewList || []) if (inBase(e)) I.zaloga++;
    }, 100);
    return true;
  })()`);
  const zoom = Number(args.zoom || 0.045);
  await camCenter(zoom);
  const t0 = Date.now();
  let n = 0;
  let rushed = false;
  let fled = false;
  let lastLaunched = 0;
  while ((Date.now() - t0) / 1000 < czas) {
    await sleep(1000);
    const p = await ev(SAMPLE);
    report.probki.push(p);
    if (prof && Date.now() - prof.t0 >= profS * 1000) await profStop();
    const launched = p.zaloga.filter((x) => x?.st === 'wystartował').length;
    if (launched > lastLaunched) {
      report.zdarzenia.push({ t: p.t, co: `start #${launched}`, baner: p.baner, okret: p.zaloga.filter((x) => x?.st === 'wystartował').map((x) => x.id) });
      await screenshotPng(cdp, join(out, `start-${launched}-t${Math.round(p.t)}.png`));
      lastLaunched = launched;
    }
    if (n % 10 === 0) {
      console.log(JSON.stringify({ t: p.t, cel: p.cel, baner: p.baner, starty: launched, drony: p.drony, odpadle: p.odpadle.length, herszt: p.herszt, budowyGrafu: p.trasy ? p.trasy.builds : null }));
      await screenshotPng(cdp, join(out, `t${String(Math.round(p.t)).padStart(3, '0')}.png`));
    }
    // herszt: po pierwszym starcie — 60% (przyspieszenie), 6 s później 30% (ucieczka)
    if (!rushed && launched >= 1 && p.herszt) {
      rushed = true;
      await ev(`(() => { const b = window.StoryGame.site.flagship; b.hp = b.maxHp * 0.6; return true; })()`);
      report.zdarzenia.push({ t: p.t, co: 'herszt 60%' });
    } else if (rushed && !fled && p.herszt && report.zdarzenia.find((z) => z.co === 'herszt 60%').t + 6 <= p.t) {
      fled = true;
      if (profS > 0) await profStart();
      await ev(`(() => { const b = window.StoryGame.site.flagship; b.hp = b.maxHp * 0.3; return true; })()`);
      report.zdarzenia.push({ t: p.t, co: 'herszt 30%' });
      await sleep(1500);
      // kadr na herszta z mostkiem
      await ev(`(() => { const b = window.StoryGame.site.flagship, c = window.camera, q = b.pos || b; c.x = c.targetX = q.x; c.y = c.targetY = q.y; c.zoom = c.targetZoom = c.zoomBase = 0.18; return true; })()`);
      await sleep(800);
      await screenshotPng(cdp, join(out, 'herszt-ucieka-mostek.png'));
      report.zdarzenia.push({ co: 'herszt — stan', ...(await ev(SAMPLE)).herszt });
      await camCenter(zoom);
    }
    if (p.herszt?.uciekl && !report.zdarzenia.some((z) => z.co === 'herszt uciekł')) report.zdarzenia.push({ t: p.t, co: 'herszt uciekł', baner: p.baner });
    n++;
  }
  if (prof) await profStop();
  await screenshotPng(cdp, join(out, 'koniec.png'));
  report.koniec = await ev(SAMPLE);
  report.bledy = logs.errors().slice(0, 80);
  console.log('zdarzenia:', JSON.stringify(report.zdarzenia, null, 1));
  console.log('koniec:', JSON.stringify(report.koniec));
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}

// Łączny czas funkcji (najwyższe wystąpienia, bez rekursji) na klatkę — trasy wokół budowli, omijanie, takt AI;
// `loop` dla skali. Funkcja = nazwa + plik (inne moduły mają własne `plan`).
function profileSummary(profile, frames) {
  const FNS = [['loop', 'index.html'], ['npcStep', 'index.html'], ['npcAiMaintenance', 'index.html'], ['rebuildWreckIndex', 'aiWreckIndex.js'],
    ['pirateBaseObstacles', 'pirateBaseWorld.js'], ['capitalArriveControls', 'capitalAI.js'], ['capitalCommandSteer', 'capitalAI.js'],
    ['capitalObstacleSpeedCap', 'capitalAI.js'], ['considerWrecks', 'capitalAI.js'], ['staticRouteAim', 'staticRoutes.js'],
    ['buildGraph', 'staticRoutes.js'], ['plan', 'staticRoutes.js']];
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { n, self: 0, total: 0, parent: null });
  for (const v of nodes.values()) for (const c of (v.n.children || [])) nodes.get(c).parent = v;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
  const totalOf = (v) => { let t = v.self; for (const c of (v.n.children || [])) t += totalOf(nodes.get(c)); v.total = t; return t; };
  for (const v of nodes.values()) if (!v.parent) totalOf(v);
  const is = (v, [name, file]) => v.n.callFrame.functionName === name && v.n.callFrame.url.includes(file);
  const res = {};
  for (const fn of FNS) {
    let ms = 0;
    for (const v of nodes.values()) {
      if (!is(v, fn)) continue;
      let top = true;
      for (let q = v.parent; q; q = q.parent) if (is(q, fn)) { top = false; break; }
      if (top) ms += v.total;
    }
    res[fn[0]] = +(ms / Math.max(1, frames)).toFixed(4);
  }
  return res;
}
