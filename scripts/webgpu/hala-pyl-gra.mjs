// Pył w halach K-7 (src/3d/gasField/, gazy etap 1, 2026-10-07) w PRAWDZIWEJ grze: Vite + headless Chrome
// z WebGPU (CDP). Gra swobodna, Atlas na stanowisku C-01 hali K-7 Ziemi, rufą do ściany tylnej → ciąg MAIN:
// strumień podrywa kurz, pył uderza w ścianę i rozlewa się wzdłuż niej. Zrzuty przy zatrzymanej grze (pauza
// zatrzymuje też symulację — dt gry = 0), A/B bez pyłu w tej samej klatce, koszt GPU (Core3D.gpuFrameMs) z
// pyłem i bez, stan modułu (HallDust.stats), pipeline'y utworzone synchronicznie (ma być 0 dla pyłu).
//
//   node scripts/webgpu/hala-pyl-gra.mjs [--out .tmp/hala-pyl] [--rozmiar 1600x900] [--zoom 0.32] [--trzymaj 1]
//
// --trzymaj 1 (domyślnie): okręt trzymany w miejscu (prędkość zerowana co klatkę) — silnik dmucha w ścianę
// jak przy zacumowanym statku; 0 — okręt rusza ku bramie.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/hala-pyl');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.32);
const HOLD = String(args.trzymaj ?? '1') !== '0';

const { server, base } = await startVite(Number(args.port || 5394));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [], bledy: [] };

// Pipeline'y utworzone SYNCHRONICZNIE (materiał bez rozgrzewki = przestój w klatce) — jak pyl-gra.mjs.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
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
    const comp = pu.createComputePipeline;
    if (comp) pu.createComputePipeline = function (p, b) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: true, compute: true, nazwa: (p && p.computeProgram && p.computeProgram.name) || (p && p.name) || 'compute' });
      return comp.call(this, p, b);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

const state = () => ev(`(() => {
  const s = window.ship, c = window.camera, d = window.HallDust;
  return { v: Math.round(Math.hypot(s.vel.x, s.vel.y)), zoom: +c.zoom.toFixed(3),
    pyl: d ? { ...d.stats, cpuMs: +d.stats.cpuMs.toFixed(3) } : null,
    gpuMs: +(window.Core3D?.gpuFrameMs ?? 0).toFixed(3) };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(30), JSON.stringify(s));
}

// Mediana czasu GPU klatki przez ~3 s: render (Core3D.gpuFrameMs) i compute (Core3D.gpuComputeMs).
const gpuAvg = () => ev(`(async () => {
  const r = [], c = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((q) => setTimeout(q, 50));
    const g = window.Core3D?.gpuFrameMs, k = window.Core3D?.gpuComputeMs;
    if (Number.isFinite(g) && g > 0) r.push(g);
    if (Number.isFinite(k) && k > 0) c.push(k);
  }
  const med = (v) => { v.sort((a, b) => a - b); return v.length ? +v[v.length >> 1].toFixed(3) : null; };
  return { render: med(r), compute: med(c) };
})()`, 60000);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.pipesStart = await ev('window.__pipeRec.pipes.length');

  // Atlas na stanowisku C-01 hali 0 Ziemi (x = −810, z = 1900 w układzie hali), dziobem ku bramie G-01 (+z hali).
  const place = await ev(`(async () => {
    const m = await import('/src/game/hallDustInput.js');
    const e = window.__haloRings.entries.find((q) => q.key === 'earth');
    const owner = e.collider.registry.halls[0];
    const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
    const x = a.p0x - 810 * a.ax + 1900 * a.bx;
    const y = a.p0y - 810 * a.ay + 1900 * a.by;
    const heading = Math.atan2(a.by, a.bx);
    window.DevScene.teleport(x, y, heading);
    window.DevScene.syncCamera();
    window.__hold = { x, y, heading, on: ${HOLD ? 'true' : 'false'} };
    return { x, y, heading, w: window.ship.w, h: window.ship.h };
  })()`);
  report.place = place;
  console.log('miejsce:', JSON.stringify(place));
  // Trzymanie okrętu w miejscu: pozycja i prędkość co klatkę (silnik dmucha, okręt stoi — jak zacumowany).
  await ev(`(() => {
    const H = window.__hold;
    const tick = () => {
      if (H.on) { const s = window.ship; s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  await setZoom(ZOOM);
  await sleep(2500);
  await shot('00-postoj');

  await down('w');
  for (const [t, name] of [[700, '01-ciag-0.7s'], [800, '02-ciag-1.5s'], [1500, '03-ciag-3s'], [2500, '04-ciag-5.5s']]) {
    await sleep(t);
    await pause(true);
    await sleep(300);
    await shot(name);
    if (name === '03-ciag-3s') {
      // A/B: ta sama klatka bez pyłu
      await ev('(() => { window.HallDustTune.enabled = false; return true; })()');
      await sleep(300);
      await shot('03-ciag-3s-bez-pylu');
      await ev('(() => { window.HallDustTune.enabled = true; return true; })()');
      await sleep(200);
    }
    await pause(false);
  }
  // koszt GPU z pyłem i bez (gra biegnie, silnik dmucha)
  report.gpuZPylem = await gpuAvg();
  await ev('(() => { window.HallDustTune.enabled = false; return true; })()');
  report.gpuBezPylu = await gpuAvg();
  await ev('(() => { window.HallDustTune.enabled = true; return true; })()');
  await up('w');
  await sleep(2500);
  await pause(true);
  await sleep(300);
  await shot('05-po-ciagu-2.5s');
  await setZoom(0.12);
  await sleep(500);
  await shot('06-cala-hala');
  await pause(false);
  await sleep(6000);
  await pause(true);
  await sleep(300);
  await shot('07-cala-hala-opada');
  await pause(false);

  // Mikropomiar GPU symulacji (gra w pauzie): 30 podkroków po 1/60 s, czas do zakończenia pracy kolejki.
  await pause(true);
  await sleep(300);
  report.symulacja = await ev(`(async () => {
    const r = window.Core3D.renderer, sim = window.HallDust.sim, dev = r.backend.device;
    // Nachylenie: czas do zakończenia pracy kolejki dla 0 / 300 / 1000 podkroków naraz (onSubmittedWorkDone ma w
    // headless ~155 ms stałego opóźnienia — przy małej liczbie podkroków praca GPU w nim ginie); po 2 próby, minimum.
    const run = async (n) => {
      const v = [];
      for (let k = 0; k < 2; k++) {
        await dev.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) sim.step(r, 1 / 60);
        await dev.queue.onSubmittedWorkDone();
        v.push(performance.now() - t0);
      }
      v.sort((a, b) => a - b);
      return v[0];
    };
    const t = {};
    for (const n of [0, 300, 1000]) t[n] = +(await run(n)).toFixed(2);
    return { msDla: t, podkrokMs: +((t[1000] - t[300]) / 700).toFixed(3), komorek: sim.nx * sim.ny, jacobi: sim.jacobi, dispatchyNaPodkrok: sim.stats.dispatches };
  })()`, 120000);
  console.log('symulacja:', JSON.stringify(report.symulacja));
  await pause(false);

  const pipes = await ev('window.__pipeRec.pipes');
  report.pipeline = {
    wszystkie: pipes.length,
    // render: synchronicznie po starcie gry = przestój w klatce (ma być 0); compute three tworzy zawsze
    // synchronicznie — po starcie gry nie powinno być żadnego (rozgrzewka kroku na ekranie ładowania)
    syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
    computePoStarcie: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa),
    pylSync: pipes.filter((p) => p.sync && !p.compute && /HallDust|gasField/i.test(p.nazwa)).map((p) => p.nazwa)
  };
  console.log('pipeline:', JSON.stringify(report.pipeline));
  console.log('GPU klatka [ms]: z pyłem', JSON.stringify(report.gpuZPylem), 'bez', JSON.stringify(report.gpuBezPylu));
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 12));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
