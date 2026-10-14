// Pola siłowe bram K-7 i nadproże nad okrętem w bramie (prośba użytkownika 2026-10-13) w PRAWDZIWEJ grze: Vite +
// headless Chrome z WebGPU (CDP), gra swobodna, hala 0 K-7 Ziemi.
//   A. DMUCH W POLE — Atlas w hali dziobem do ściany tylnej, rufą ku bramie G-01, trzymany w miejscu, ciąg MAIN:
//      strumień niesie pył ku bramie i rozbija go o pole siłowe (wiruje). Ten sam przebieg BEZ pól (A/B fizyki:
//      HallDustTune.forceFields = false — pył wylatuje na próżnię).
//   B. W BRAMIE — Atlas stoi w otworze G-01: nadproże (zestaw FG hali) nad kadłubem, światła pola na kadłubie.
//   C. WYLOT — Atlas rusza od pasa C-01 przez bramę: pył pchany dziobem i ciągiem, kadłub przebija pole.
// Zrzuty przy zatrzymanej grze (pauza zatrzymuje symulację), stan pyłu (HallDust.stats), pipeline'y utworzone
// synchronicznie po starcie gry (ma być 0).
//
//   node scripts/webgpu/hala-pole-gra.mjs [--out .tmp/hala-pole] [--rozmiar 1600x900] [--zoom 0.26] [--sceny A,B,C]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/hala-pole');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.26);
const SCENES = new Set(String(args.sceny || 'A,B,C').split(','));

const { server, base } = await startVite(Number(args.port || 5396));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [], bledy: [] };

// Pipeline'y utworzone SYNCHRONICZNIE (materiał bez rozgrzewki = przestój w klatce) — jak hala-pyl-gra.mjs.
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
  }, 10);
  window.__pipeRec = R;
})();` });

const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
const state = () => ev(`(() => {
  const s = window.ship, d = window.HallDust;
  return { v: Math.round(Math.hypot(s.vel.x, s.vel.y)), pola: !!window.HallDustTune?.forceFields,
    pyl: d ? { active: d.stats.active, jets: d.stats.jets, bodies: d.stats.bodies, lights: d.stats.lights, sleeping: d.stats.sleeping } : null };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(34), JSON.stringify(s));
}
// zrzut w pauzie (symulacja stoi) i powrót do gry
async function still(name) {
  await pause(true);
  await sleep(350);
  await shot(name);
  await pause(false);
}

// Okręt w punkcie hali 0 Ziemi (x, z hali), dziób wzdłuż ±z hali; hold — pozycja i prędkość trzymane co klatkę.
const place = (x, z, nose, hold) => ev(`(async () => {
  const m = await import('/src/game/hallDustInput.js');
  const e = window.__haloRings.entries.find((q) => q.key === 'earth');
  const a = m.hallToGameAffine(e.collider.place, e.collider.registry.halls[0].frame, {});
  const gx = a.p0x + ${x} * a.ax + ${z} * a.bx, gy = a.p0y + ${x} * a.ay + ${z} * a.by;
  const heading = Math.atan2(${nose} * a.by, ${nose} * a.bx);
  window.DevScene.teleport(gx, gy, heading);
  window.DevScene.syncCamera();
  const H = window.__hold || (window.__hold = {});
  Object.assign(H, { x: gx, y: gy, heading, on: ${hold ? 'true' : 'false'} });
  if (!H.loop) {
    H.loop = true;
    const tick = () => {
      if (H.on) { const s = window.ship; s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return { gx, gy, heading };
})()`);
const fields = (on) => ev(`(() => { window.HallDustTune.forceFields = ${on ? 'true' : 'false'}; return true; })()`);
const clearDust = () => ev('(() => { window.HallDust.sim.requestClear(); return true; })()');

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
  report.uklad = await ev(`(async () => {
    const m = await import('/src/3d/haloRing/haloPortK7Layout.js');
    const l = m.createK7Layout();
    return { frontZ: l.frontZ, pola: m.k7ForceFieldList(l).map((f) => ({ id: f.gateId, length: f.length })) };
  })()`);
  const FZ = report.uklad.frontZ;

  if (SCENES.has('A')) {
    // A. rufą ku bramie (dziób −z hali), rufa ~500 j. przed licem pola; ciąg MAIN 5,5 s — z polami i bez
    for (const on of [true, false]) {
      const tag = on ? 'A-pole' : 'A-bez-pola';
      await fields(on);
      await place(-810, FZ - 1450, -1, true);
      await setZoom(ZOOM);
      await clearDust();
      await sleep(2500);
      await shot(`${tag}-00-postoj`);
      await down('w');
      for (const [t, name] of [[1500, '01-ciag-1.5s'], [1500, '02-ciag-3s'], [2500, '03-ciag-5.5s']]) {
        await sleep(t);
        await still(`${tag}-${name}`);
      }
      await up('w');
      await sleep(2500);
      await still(`${tag}-04-po-ciagu-2.5s`);
      await sleep(3500);
      await still(`${tag}-05-po-ciagu-6s`);
    }
    await fields(true);
  }

  if (SCENES.has('B')) {
    // B. okręt stoi w otworze G-01 (środek kadłuba na osi muru): nadproże nad kadłubem
    await place(-810, FZ, 1, true);
    await setZoom(ZOOM);
    await sleep(1500);
    await still('B-01-w-bramie');
    await setZoom(0.6);
    await sleep(700);
    await still('B-02-w-bramie-zblizenie');
  }

  if (SCENES.has('C')) {
    // C. wylot: od pasa C-01 dziobem ku bramie, ciąg MAIN; okręt przebija pole
    await place(-810, FZ - 2300, 1, false);
    await setZoom(ZOOM);
    await clearDust();
    await sleep(2000);
    await down('w');
    for (const [t, name] of [[2500, 'C-01-rozped'], [1500, 'C-02-dziob-w-polu'], [1200, 'C-03-kadlub-w-polu'], [1500, 'C-04-rufa-w-polu'], [1800, 'C-05-za-brama']]) {
      await sleep(t);
      await still(name);
    }
    await up('w');
  }

  const pipes = await ev('window.__pipeRec.pipes');
  report.pipeline = { wszystkie: pipes.length, syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync).map((p) => p.nazwa) };
  console.log('pipeline:', JSON.stringify(report.pipeline));
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
