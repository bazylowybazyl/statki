// Przelot planetoidy bliskiej Ziemi (Apophis) w PRAWDZIWEJ grze (strumień E2, 2026-10-12 — src/game/neaFlyby.js,
// src/3d/neaFlyby3D.js): Vite + headless Chrome z WebGPU (CDP), gra swobodna z ?apophis (start po kilku s).
//
//   node scripts/webgpu/apophis-gra.mjs [--out .tmp/apophis] [--rozmiar 1600x900] [--koszt 1] [--kampania 1]
//
// --kampania 1: kampania z ?apophis — przelot nie może ruszyć (stan 'waiting', powód 'campaign') po 15 s gry.
// Kadry: komunikat startu (kamera statku), zbliżanie (skała ~12 tys. j. przed największym zbliżeniem, statek przy
// torze), mijanie (zbliżenie, dwa zoomy), radar (kamera statku, kopuła i pełny radar po Alt), po przelocie (pas znów
// śpi przy Ziemi). Raport: plan toru (zbliżenie, odstęp od księżyca Ziemi, odległość od gracza), stan pasa (budzony
// tylko przy skale w kadrze), radar (rekord ciała), pipeline'y utworzone SYNCHRONICZNIE po starcie gry (ma być 0),
// błędy konsoli. --koszt 1: czas GPU / CPU klatki — kadr na skale (pas obudzony) ↔ ten sam kadr po przelocie
// (pomiar wydajności — uzgodnij START / KONIEC z innymi sesjami).
// Wynik: <out>/*.png, <out>/raport.json.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/apophis');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { plan: null, kadry: [], stan: [], radar: null, bledy: [] };
const t0 = Date.now();
const note = (co, extra = {}) => { const z = { s: +((Date.now() - t0) / 1000).toFixed(1), co, ...extra }; report.kadry.push(z); console.log(JSON.stringify(z)); };

// Gra swobodna bez samouczka (kampania domyślna blokowałaby start — przelot jej nie dotyczy) i dziennik pipeline'ów.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const STATE = `(() => {
  const F = window.NeaFlyby, B = window.__asteroidBelt, s = window.ship, r = F.rock, p = F.plan;
  const set = window.NeaFlyby3D?.set;
  return {
    stan: F.state, t: +F.t.toFixed(2), tCA: p ? p.tCA : null,
    skala: p ? { x: Math.round(r.x), y: Math.round(r.y), v: Math.round(Math.hypot(r.vx, r.vy)) } : null,
    odStatku: p && s ? Math.round(Math.hypot(r.x - s.pos.x, r.y - s.pos.y)) : null,
    pasAktywny: !!B?.active, budzenie: !!F.wake.active,
    obraz: set ? { widoczny: set.enabled, rysowane: set.stats.drawn } : null,
    kamera: { x: Math.round(window.camera.x), y: Math.round(window.camera.y), zoom: +window.camera.zoom.toFixed(3) },
    gpu: window.Core3D?.gpuFrameMs ?? null
  };
})()`;
const state = async (tag) => { const st = await ev(STATE); report.stan.push({ tag, ...st }); console.log(tag, JSON.stringify(st)); return st; };
const shot = async (name) => { await screenshotPng(cdp, join(out, `${name}.png`)); note(`kadr ${name}`); };
// Kamera RTS w punkcie (jak harness-strona.js scene.cam) i kamera statku.
const cam = (x, y, zoom) => ev(`(() => { const c = window.camera; if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = ${zoom}; window.DevScene?.syncCamera?.(); return true; })()`);
const shipCam = (zoom) => ev(`(() => { const c = window.camera; if (c.mode === 'rts' && typeof c.exitRtsMode === 'function') c.exitRtsMode();
  c.mode = 'ship'; c.focusStation = null; c.x = c.targetX = window.ship.pos.x; c.y = c.targetY = window.ship.pos.y;
  c.manualZoom = true; c.zoom = c.targetZoom = ${zoom}; window.DevScene?.syncCamera?.(); return true; })()`);
const seek = (t) => ev(`(() => { window.NeaFlyby.seek(${t}, window.SimClock.sim); return true; })()`);
const KEY_ALT = { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18 };

try {
  if (args.kampania) {
    // Kampania z ?apophis: przelot NIE może ruszyć (sesja z kampanią — bramka 'campaign').
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&apophis` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.NeaFlyby)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
    await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
    await sleep(900);
    await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active", 300000, 300)) throw new Error('kampania nie ruszyła');
    // odprawa w doku zamraża świat (czas gry stoi) — 15 s prawdziwego czasu wystarczy, bramka i tak jest 'campaign'
    await sleep(15000);
    report.kampania = await ev(`({ stan: window.NeaFlyby.state, powod: window.NeaFlyby.reason, czasGry: +window.SimClock.sim.toFixed(1), fabula: window.StoryGame.phase })`);
    console.log('kampania', JSON.stringify(report.kampania));
    if (report.kampania.stan !== 'waiting') throw new Error('przelot ruszył w kampanii');
    throw Object.assign(new Error('koniec trybu kampanii'), { ok: true });
  }
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&apophis` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.NeaFlyby)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  // Przelot startuje kilka s CZASU GRY po pierwszej klatce (?apophis) — wtedy gra już biegnie (ekran ładowania za nami).
  if (!await waitFor(cdp, "window.NeaFlyby.state === 'active' && document.getElementById('loading')?.classList.contains('hidden')", 300000, 200)) throw new Error('przelot nie wystartował');
  if (await ev('!!window.StoryGame.active')) throw new Error('kampania w toku — przelot nie powinien ruszyć');
  report.pipesStart = await ev('window.__pipeRec.pipes.length');
  report.rozgrzewka = await ev(`(() => { const s = window.Core3D.warmup?.stats; const lista = (s?.lista || []).filter((r) => /NEA/.test(r.nazwa));
    const w = window.Core3D.warmup;
    return { lista, wpis: window.NeaFlyby3D?.warmState ?? null, zestaw: !!window.NeaFlyby3D?.set,
      kolejka: { ready: w?.ready, flushing: w?._flushing, scheduled: w?._scheduled, loadingOpen: w?._loadingOpen,
        pilne: (w?._urgent || []).map((e) => e.name + ':' + e.state), zwykle: (w?._normal || []).slice(0, 8).map((e) => e.name + ':' + e.state),
        czekajace: (w?._waiting || []).slice(0, 8).map((e) => e.name + ':' + e.state) } }; })()`);
  console.log('rozgrzewka', JSON.stringify(report.rozgrzewka));
  report.plan = await ev(`(() => {
    const F = window.NeaFlyby, p = F.plan, s = window.ship, e = window.planets.find((q) => q.id === 'earth');
    return { ok: p.ok, dCA: Math.round(p.dCA), predkosc: p.speed, tCA: p.tCA, czas: p.duration, kat: +p.phi.toFixed(3), zwrot: p.sign,
      odstepKsiezyc: Math.round(p.minMoon), odstepPlanety: Math.round(p.minPlanet), ksiezyc: p.moon ? { orbita: Math.round(p.moon.orbitR), r: Math.round(p.moon.r) } : null,
      najblizejGracza: Math.round(F.playerDist), graczOdZiemi: Math.round(Math.hypot(s.pos.x - e.x, s.pos.y - e.y)),
      zblizenie: { x: Math.round(p.cx), y: Math.round(p.cy) }, kierunek: [+p.dx.toFixed(4), +p.dy.toFixed(4)] };
  })()`);
  console.log('plan', JSON.stringify(report.plan));
  await sleep(600);
  await state('start');
  await shot('01-komunikat');

  // Statek przy torze: 7 tys. j. od punktu największego zbliżenia w stronę Ziemi, dziobem wzdłuż toru.
  const P = report.plan;
  const ex = await ev(`(() => { const e = window.planets.find((q) => q.id === 'earth'); return [e.x, e.y]; })()`);
  const rx = (P.zblizenie.x - ex[0]) / P.dCA, ry = (P.zblizenie.y - ex[1]) / P.dCA;
  const sx = P.zblizenie.x - rx * 7000, sy = P.zblizenie.y - ry * 7000;
  await ev(`(() => { window.DevScene.teleport(${sx}, ${sy}, ${Math.atan2(P.kierunek[1], P.kierunek[0])}); return true; })()`);

  // Kadry w PAUZIE (czas skały = czas renderu gry — stoi), kamera na żywej pozycji skały.
  const paused = (on) => ev(`(() => { window.__setGamePaused(${on}); return true; })()`);
  const rockCam = (zoom, back = 0) => ev(`(() => { const r = window.NeaFlyby.rock, p = window.NeaFlyby.plan; const c = window.camera;
    if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
    c.x = c.targetX = r.x - p.dx * ${back}; c.y = c.targetY = r.y - p.dy * ${back}; c.manualZoom = true; c.zoom = c.targetZoom = ${zoom};
    window.DevScene?.syncCamera?.(); return true; })()`);
  await seek(P.tCA - 6);
  await sleep(300);
  await paused(true);
  // kadr: środek między skałą a statkiem (oba w kadrze)
  await ev(`(() => { const r = window.NeaFlyby.rock, s = window.ship.pos, c = window.camera;
    if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
    c.x = c.targetX = (r.x + s.x) * 0.5; c.y = c.targetY = (r.y + s.y) * 0.5; c.manualZoom = true; c.zoom = c.targetZoom = 0.075;
    window.DevScene?.syncCamera?.(); return true; })()`);
  await sleep(900);
  await state('zblizanie');
  await shot('02-zblizanie');
  await paused(false);

  await seek(P.tCA);
  await sleep(200);
  await paused(true);
  await rockCam(0.22);
  await sleep(900);
  await state('mijanie');
  await shot('03-mijanie');
  await rockCam(0.7);
  await sleep(900);
  await state('mijanie-blisko');
  await shot('04-mijanie-blisko');
  await paused(false);

  // Radar: kamera statku, skała ~7 tys. j. od statku (zasięg radaru domyślnie 20 km).
  await seek(P.tCA - 1.5);
  await shipCam(0.45);
  await sleep(2600);
  await state('radar');
  await shot('05-radar');
  const tap = async (k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await sleep(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }); };
  await tap(KEY_ALT);   // pełny radar (w pauzie klawisze gry śpią)
  await sleep(900);
  const pick = await ev(`(() => {
    const r = window.cockpitUI?.radar, c = window.cockpitUI?.els?.radarCanvas;
    if (!r || !c) return null;
    const b = c.getBoundingClientRect();
    const p = (r.display.debugPicks?.() || []).find((q) => q.track.kind === 'body');
    return { rc: { x: b.left, y: b.top, w: b.width, h: b.height },
      body: p ? { x: b.left + p.x * b.width / c.width, y: b.top + p.y * b.height / c.height, kind: p.track.kind, aff: p.track.aff, name: p.track.name, cls: p.track.cls, dist: Math.round(p.track.dist || 0) } : null };
  })()`);
  report.radar = pick;
  console.log('radar', JSON.stringify(pick));
  if (pick?.body) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pick.body.x), y: Math.round(pick.body.y), button: 'none' });
    await sleep(500);
  }
  await shot('06-radar-alt');
  if (pick?.rc) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(pick.rc.x - 120), y: Math.round(pick.rc.y - 70), width: Math.round(pick.rc.w + 240), height: Math.round(pick.rc.h + 90), scale: 1 } });
    (await import('node:fs')).writeFileSync(join(out, '06b-radar-alt-tarcza.png'), Buffer.from(data, 'base64'));
  }
  await tap(KEY_ALT);

  if (args.koszt) {
    // Kadr na skale (pas obudzony przez przelot) ↔ ten sam kadr bez skały (budzenie wyłączone) — na przemian.
    const med = (a) => { a.sort((p, q) => p - q); return a.length ? +a[a.length >> 1].toFixed(3) : null; };
    const sample = async (n = 16) => {
      const g = [], c = [], b = [];
      for (let i = 0; i < n; i++) {
        await sleep(120);
        const s = await ev('({ g: window.Core3D.gpuFrameMs, c: window.__PH?.display?.frameMs, b: window.__asteroidBelt?.stats?.cpuMs })');
        if (Number.isFinite(s.g)) g.push(s.g);
        if (Number.isFinite(s.c)) c.push(s.c);
        if (Number.isFinite(s.b)) b.push(s.b);
      }
      return { gpuMs: med(g), klatkaMs: med(c), pasCpuMs: med(b) };
    };
    const koszt = [];
    for (let round = 0; round < 6; round++) {
      for (const on of round % 2 ? [false, true] : [true, false]) {
        await seek(P.tCA - 0.5);
        await paused(true);
        await ev(`(() => { window.NeaFlyby.wake.active = ${on}; window.NeaFlyby.rock.alive = ${on}; return true; })()`);
        await rockCam(0.22);
        await sleep(700);
        koszt.push({ skala: on, ...(await sample()), pas: await ev('!!window.__asteroidBelt.active') });
        await paused(false);
      }
    }
    const sum = (on, k) => med(koszt.filter((r) => r.skala === on).map((r) => r[k]).filter(Number.isFinite));
    report.kosztMediana = { zeSkala: { gpuMs: sum(true, 'gpuMs'), klatkaMs: sum(true, 'klatkaMs'), pasCpuMs: sum(true, 'pasCpuMs') },
      bezSkaly: { gpuMs: sum(false, 'gpuMs'), klatkaMs: sum(false, 'klatkaMs'), pasCpuMs: sum(false, 'pasCpuMs') } };
    console.log('koszt mediana', JSON.stringify(report.kosztMediana));
    await ev('(() => { window.NeaFlyby.wake.active = true; window.NeaFlyby.rock.alive = true; return true; })()');
    report.koszt = koszt;
    console.log('koszt', JSON.stringify(koszt));
  }

  // Po przelocie: skała znika, pas przy Ziemi znowu śpi.
  await seek(P.czas + 1);
  await shipCam(0.45);
  await sleep(1500);
  await state('po');
  await shot('07-po-przelocie');
  report.pipeline = await ev(`(() => {
    const all = window.__pipeRec.pipes;
    const after = all.slice(${report.pipesStart}).filter((p) => p.sync && !p.compute);
    return { wszystkie: all.length, syncPoStarcie: after.map((p) => p.nazwa) };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
} catch (err) {
  if (!err?.ok) {
    report.blad = String(err?.stack || err);
    console.error(err);
  }
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon\.ico|AudioSys|Unable to decode audio data|powerPreference/.test(l)).slice(0, 40);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close?.();
  server.kill?.();
}
