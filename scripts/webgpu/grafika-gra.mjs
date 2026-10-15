// Opcje grafiki (2026-10-15, src/game/graphicsQuality.js) w PRAWDZIWEJ grze: presety Niska / Średnia / Wysoka / Ultra
// przełączane na żywo na tej samej zatrzymanej klatce — zrzut, rozmiar bufora 3D, koszt GPU (mediana
// Core3D.gpuFrameMs), pipeline'y utworzone SYNCHRONICZNIE po przełączeniu (ma być 0 — przełączenie bez kompilacji).
// Zrzuty przy skali renderu ≠ 100% pokazują zgodność obrazu 3D z nakładkami 2D (wieżyczki kanwy na kadłubach,
// mgła wojny, cień planety na ringu) — kadr kamery z kanwy CSS, nie z bufora.
//
//   node scripts/webgpu/grafika-gra.mjs [--sceny mgla,ziemia,bitwa] [--presety high,low,medium,ultra,high] [--koszt 1] [--menu 1]
//        [--start niska] [--atrapa intel:gen-12lp] [--dyn 1] [--out .tmp/grafika-gra] [--port 5391]
//
// --start <preset> — strona z ?grafika=<preset> (MSAA tego presetu od startu; bez zapisu w profilu, bez doboru).
// Bez --start profil jest czysty = PIERWSZE uruchomienie: preset dobiera graphicsAutoPreset.js z adaptera (raport
// `auto`: prawdziwy opis adaptera, wybór, próbki celu sceny od startu, zapis). --atrapa <producent>:<architektura> —
// atrapa opisu adaptera dla reguł (np. intel:gen-12lp → Niska z MSAA wył. od pierwszej klatki).
// --dyn 1 — rozdzielczość dynamiczna na zatrzymanej klatce ostatniej sceny: docelowe FPS z konsoli
// (DynamicResTune.targetFps 10000 — skala schodzi do dna drabiny, potem 2 — wraca), skala i bufor co krok,
// pipeline'y synchroniczne (ma być 0).
// Wynik: <out>/<scena>-<preset>.png, <out>/raport.json.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/grafika-gra');
mkdirSync(out, { recursive: true });
const sceny = new Set((args.sceny || 'mgla,ziemia,bitwa').split(',').filter(Boolean));
const presety = (args.presety || 'high,low,medium,ultra,high').split(',').filter(Boolean);
const doCost = String(args.koszt || '0') === '1';
const startPreset = args.start || '';
const fake = args.atrapa ? (() => { const [vendor, architecture = ''] = String(args.atrapa).split(':'); return { vendor, architecture }; })() : null;
const doDyn = String(args.dyn || '0') === '1';
const DEEP = { x: 6210000, y: 5330000 };
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const PIPE_HOOK = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 16384) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port: Number(args.port || 5391), strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { start: startPreset || null, sceny: [] };

const syncCount = () => ev('window.__pipeRec.pipes.filter((p) => p.sync).length');
const state = () => ev(`(() => ({ preset: GraphicsQuality.preset, px: +Core3D.pixelRatio.toFixed(3), pxScale: +Core3D.pxScale.toFixed(3),
  bufor: [Core3D.composerTarget.width, Core3D.composerTarget.height], kanwa: [Core3D.canvas.width, Core3D.canvas.height],
  msaa: Core3D.composerTarget.samples, bloom: Core3D.perfToggles.bloom, bloomSkala: +Core3D._getBloomConfig().resolutionScale.toFixed(2), bloomPass: Core3D.bloomPass ? +Core3D.bloomPass.resolutionScale.toFixed(2) : null,
  heat: Core3D.perfToggles.heatHaze, smugi: Core3D.shadowShaftsQuality, planety: OPTIONS.planetQuality,
  gaz: { fine: window.__explosions?.tune?.fineGas, budzet: window.__explosions?.tune?.marchBudget },
  swiatlaSide: window.SideJetTune?.maxLights, wyloty: WeaponFx.muzzlePerFrame, pylHal: window.HallDustTune?.enabled }))()`);

async function gpuMedian(n = 30) {
  const v = [];
  for (let i = 0; i < n; i++) {
    await ev('window.__harness.frames(2)');
    const x = await ev('window.Core3D?.gpuFrameMs ?? 0');
    if (x > 0) v.push(x);
  }
  v.sort((a, b) => a - b);
  return v.length ? +v[v.length >> 1].toFixed(3) : null;
}

async function shoot(scene) {
  const rows = [];
  for (const p of presety) {
    const s0 = await syncCount();
    await ev(`(() => { GraphicsQuality.apply('${p}'); return true; })()`);
    await ev('window.__harness.frames(6)');
    const st = await state();
    const sync = (await syncCount()) - s0;
    await screenshotPng(cdp, join(out, `${scene}-${p}.png`));
    const row = { preset: p, ...st, pipelineSync: sync };
    if (doCost) row.gpuMs = await gpuMedian();
    rows.push(row);
    console.log(`${scene}-${p}`.padEnd(16), JSON.stringify(row));
  }
  report.sceny.push({ scena: scene, wiersze: rows });
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_HOOK });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\ntry { localStorage.setItem('sc_ships3d', '0'); localStorage.setItem('sc_weapons3d', '0'); } catch {}\n${INJECT}` });
  if (fake) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__GFX_AUTO_FAKE = ${JSON.stringify(fake)};` });
  const q = startPreset ? `&grafika=${encodeURIComponent(startPreset)}` : '';
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${q}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.GraphicsQuality)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  report.menu = await state();
  console.log('menu', JSON.stringify(report.menu));
  // Dobór przy pierwszym uruchomieniu: co wybrano, z czego, czy MSAA presetu było w celu sceny od startu.
  report.auto = await ev(`(() => ({ adapter: window.__gfxAdapter || null, atrapa: window.__GFX_AUTO_FAKE || null,
    wybor: window.__gfxAuto ? { preset: window.__gfxAuto.preset, tier: window.__gfxAuto.tier, powody: window.__gfxAuto.label } : null,
    info: GraphicsQuality.auto, preset: GraphicsQuality.preset, msaaBoot: Core3D.msaaBoot, msaaCel: Core3D.composerTarget.samples,
    ekran: [screen.width, screen.height], pamiec: navigator.deviceMemory ?? null,
    zapis: JSON.parse(localStorage.getItem('sc_gfx') || 'null'), zapisAuto: JSON.parse(localStorage.getItem('sc_gfx_auto') || 'null') }))()`);
  console.log('auto', JSON.stringify(report.auto));
  if (String(args.menu || '0') === '1') {
    // Panel Opcje: preset, potem pojedyncza zmiana (→ „Własna”), z powrotem preset startu.
    const click = (sel) => ev(`(() => { document.querySelector('${sel}')?.click(); return true; })()`);
    await click('#btn-options');
    await new Promise((r) => setTimeout(r, 700));
    await screenshotPng(cdp, join(out, 'opcje-start.png'));
    await click('[data-gfx-preset="ultra"]');
    await new Promise((r) => setTimeout(r, 300));
    await screenshotPng(cdp, join(out, 'opcje-ultra.png'));
    await click('[data-gfx-bloom="half"]');
    await click('[data-gfx-msaa="0"]');
    await new Promise((r) => setTimeout(r, 300));
    report.panel = await ev(`(() => ({ preset: GraphicsQuality.preset, wlasna: !document.querySelector('[data-gfx-preset="custom"]').hidden,
      restart: !document.querySelector('[data-gfx-restart]').hidden, zapis: JSON.parse(localStorage.getItem('sc_gfx') || 'null') }))()`);
    console.log('panel', JSON.stringify(report.panel));
    await screenshotPng(cdp, join(out, 'opcje-wlasna.png'));
    await click(`[data-gfx-preset="${report.menu.preset}"]`);
    await click('[data-gfx-msaa="4"]');
    await click('#btn-options-back');
    await new Promise((r) => setTimeout(r, 400));
  }
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  report.syncPoStarcie = await syncCount();
  report.syncLista = await ev('window.__pipeRec.pipes.filter((p) => p.sync).map((p) => p.nazwa).slice(0, 30)');
  console.log('pipeline sync po starcie:', report.syncPoStarcie);
  await ev('window.__harness.hold(true)');
  await ev('(() => { window.__harness.scene.hideHud(true); window.__harness.reseed(0xb17b); return true; })()');
  if (doCost) await ev('(() => { Core3D.gpuTimerSampleEvery = 1; return true; })()');

  await ev(`(async () => { await window.__harness.step(4); window.__setGamePaused && window.__setGamePaused(true); return true; })()`);
  if (sceny.has('mgla')) {
    // Mgła wojny: krąg wzroku Atlasa (18 km) w kadrze — brzeg kręgu w tym samym miejscu ekranu przy każdej skali.
    await ev(`(() => { window.setFogOfWar?.(true); window.__harness.scene.cam(ship.pos.x + 9000, ship.pos.y, 0.022); return true; })()`);
    await ev('window.__harness.frames(10)');
    await shoot('mgla');
  }
  if (sceny.has('ziemia')) {
    // Ziemia z ringiem: tarcza planety, ring w passie ortho, cień planety na ringu (maska słońca), poświata limbu.
    await ev(`(() => { window.setFogOfWar?.(false); const e = planets.find((p) => p.id === 'earth' || p.name === 'earth');
      window.__harness.scene.cam(e.x, e.y, 110 / Math.max(1, e.r)); return true; })()`);
    await ev('window.__harness.frames(30)');
    await shoot('ziemia');
  }
  if (sceny.has('bitwa')) {
    await ev(`(() => { const s = ship; DevScene.teleport(${DEEP.x}, ${DEEP.y}, -0.6); if (window.fireControl) window.fireControl.posture = 'free';
      window.__setGamePaused && window.__setGamePaused(false);
      const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
      spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(2600, -300), spawnAngle: Math.PI });
      spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(2200, 900), spawnAngle: Math.PI });
      spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1300), spawnAngle: 0 });
      return true; })()`);
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness;
      for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2); return true; })()`, 400000);
    await ev('window.__harness.step(150)');
    await ev(`(() => { window.__setGamePaused && window.__setGamePaused(true); window.__harness.scene.cam(ship.pos.x + 1100, ship.pos.y + 300, 0.32); return true; })()`);
    await ev('window.__harness.frames(4)');
    await shoot('bitwa');
  }
  if (doDyn) {
    // Rozdzielczość dynamiczna na zatrzymanej klatce: zegar sterownika = zegar klatek (harness.step — 1/60 s na
    // klatkę), próbki czasu GPU co klatkę. Budżet 0,1 ms (10 000 FPS; zatrzymana klatka bitwy to ~0,8 ms GPU) — przeciążenie: 1 → 0,85 → 0,75 → 0,67;
    // potem 2 FPS — zapas: z powrotem w górę.
    const dynState = () => ev(`(() => ({ ...GraphicsQuality.dynamic, px: +Core3D.pixelRatio.toFixed(3),
      bufor: [Core3D.composerTarget.width, Core3D.composerTarget.height], gpuMs: +Core3D.gpuFrameMs.toFixed(3),
      probki: Core3D.gpuFrameSamples, notka: document.querySelector('[data-gfx-dyn-now]')?.textContent || '' }))()`);
    const s0 = await syncCount();
    await ev('(() => { Core3D.gpuTimerSampleEvery = 1; GraphicsQuality.apply({ dynamicRes: "60" }); DynamicResTune.targetFps = 10000; return true; })()');
    report.dyn = { wDol: [], wGore: [] };
    let shotLow = false;
    for (let i = 0; i < 16; i++) {
      await ev('window.__harness.step(30)');
      const d = await dynState();
      report.dyn.wDol.push(d);
      if (!shotLow && d.level === d.levels.length - 1) { shotLow = true; await screenshotPng(cdp, join(out, 'dyn-dno.png')); }
    }
    await ev('(() => { DynamicResTune.targetFps = 2; return true; })()');
    for (let i = 0; i < 32; i++) {
      await ev('window.__harness.step(30)');
      report.dyn.wGore.push(await dynState());
    }
    await ev('(() => { DynamicResTune.targetFps = 0; GraphicsQuality.apply({ dynamicRes: "off" }); return true; })()');
    await ev('window.__harness.step(2)');
    report.dyn.koniec = await dynState();
    report.dyn.pipelineSync = (await syncCount()) - s0;
    const seq = (a) => a.map((d) => d.scale).filter((v, i, x) => i === 0 || v !== x[i - 1]);
    console.log('dyn w dół', JSON.stringify(seq(report.dyn.wDol)), 'w górę', JSON.stringify(seq(report.dyn.wGore)),
      'koniec', report.dyn.koniec.scale, 'bufor dna', JSON.stringify(report.dyn.wDol[report.dyn.wDol.length - 1].bufor),
      'pipeline sync', report.dyn.pipelineSync);
  }
  report.pipeline = await ev(`(() => { const p = window.__pipeRec.pipes; const s = p.filter((x) => x.sync);
    return { wszystkie: p.length, sync: s.length, lista: s.map((x) => x.nazwa).slice(0, 40) }; })()`);
  console.log('pipeline', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().filter((l) => !/favicon\.ico/.test(l)).slice(0, 40);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
