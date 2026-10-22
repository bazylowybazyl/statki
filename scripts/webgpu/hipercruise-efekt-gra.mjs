// EFEKT HIPERCRUISE'U w PRAWDZIWEJ grze (E5, decyzja użytkownika 2026-10-22: „obecny silnik warp będzie
// hypercruise”): zrzuty faz — rozruch, kop, lot, pełna prędkość, wyjście, po wyjściu — i dziennik prędkości.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna. Klatki faz: strona sama pauzuje grę w chwili spełnienia
// warunku (rAF), CDP robi zdjęcie i wznawia (odpytywanie przez CDP przegapiłoby krótkie fazy).
//
//   node scripts/webgpu/hipercruise-efekt-gra.mjs [--out .tmp/hipercruise-efekt] [--query renderWorker=1] [--rozmiar 1600x900]
//
// --query — doklejane do adresu (tryb gracza: renderWorker=1). Wynik: <out>/*.png i <out>/raport.json
// (fazy, prędkość, pipeline'y synchroniczne w trybie off — w workerze renderer jest poza stroną).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/hipercruise-efekt');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';

const { server, base } = await startVite(Number(args.port || 5395));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query: args.query || '', zdjecia: [], bledy: [] };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [], startIdx: -1 };
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

const state = () => ev(`(() => { const s = window.ship, h = window.hypercruise;
  return { hc: h ? h.state : null, v: Math.round(Math.hypot(s.vel.x, s.vel.y)), zoom: +window.camera.zoom.toFixed(4),
    tryb: window.__RENDER_MODE || null }; })()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(24), JSON.stringify(s));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(3000);
  await ev('(() => { if (window.__pipeRec) window.__pipeRec.startIdx = window.__pipeRec.pipes.length; return true; })()');
  // Kurs od najbliższej planety (bez płyty ringu i strefy planety po drodze), statek stoi.
  await ev(`(() => { const s = window.ship; let best = null, bd = Infinity;
    for (const p of window.planets) { if (!p) continue; const d = Math.hypot(s.pos.x - p.x, s.pos.y - p.y); if (d < bd) { bd = d; best = p; } }
    const a = best ? Math.atan2(s.pos.y - best.y, s.pos.x - best.x) : s.angle;
    window.devTeleportTo(s.pos.x, s.pos.y, { angle: a, quiet: true });
    s.vel.x = 0; s.vel.y = 0; s.angVel = 0; return true; })()`);
  await sleep(1500);
  await shot('00-przed');
  const stops = [
    ['01-rozruch', "h.state === 'spool' && h.t >= h.spoolNow * 0.6"],
    ['02-kop', "h.state === 'active' && h.t > 0.25"],
    ['03-lot', "h.state === 'active' && h.t > 3"],
    ['04-pelna', "h.state === 'active' && h.speed >= h.vcap - 1 && h.t > 13"],
    ['05-wyjscie', "h.state === 'drop' && h.t > 0.6"],
    ['06-po-wyjsciu', "h.state === 'idle' && window.__hcIdleAt && performance.now() - window.__hcIdleAt > 1500"]
  ];
  await ev(`(() => {
    const stops = ${JSON.stringify(stops)}.map(([name, cond]) => [name, new Function('h', 'return ' + cond)]);
    window.__stopAt = null;
    window.__hcIdleAt = 0;
    let i = 0, prev = 'idle';
    const tick = () => {
      const h = window.hypercruise;
      if (h.state === 'idle' && prev !== 'idle') window.__hcIdleAt = performance.now();
      prev = h.state;
      if (i < stops.length && !window.__stopAt && stops[i][1](h)) {
        window.__stopAt = stops[i][0];
        i++;
        window.__setGamePaused(true);
      }
      if (i < stops.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  const okey = { key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79 };
  const pressO = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...okey });
    await sleep(60);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...okey });
  };
  await pressO();
  const t0 = Date.now();
  let taken = 0;
  while (Date.now() - t0 < 180000 && taken < stops.length) {
    const at = await ev('window.__stopAt');
    if (at) {
      await sleep(350);
      await shot(at);
      taken++;
      await ev('(() => { window.__stopAt = null; window.__setGamePaused(false); return true; })()');
      if (at === '04-pelna') await pressO();   // wyjście ręczne
    }
    await sleep(40);
  }
  const pipes = await ev('(() => { const R = window.__pipeRec; return R ? R.pipes.slice(Math.max(0, R.startIdx)).filter((p) => p.sync).map((p) => p.nazwa) : null; })()');
  report.pipelineSyncPoStarcie = pipes;
  console.log('pipeline sync po starcie (tryb off):', pipes ? pipes.length : 'brak (renderer w workerze)', JSON.stringify((pipes || []).slice(0, 12)));
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(err);
} finally {
  report.bledy = logs.errors().slice(0, 40);
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
  process.exit(0);
}
