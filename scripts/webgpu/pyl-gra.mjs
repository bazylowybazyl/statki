// Pył kosmiczny i poświata dysz na pyle (src/3d/dust/, 2026-10-05) w PRAWDZIWEJ grze: Vite + headless Chrome
// z WebGPU (CDP). Gra swobodna, Atlas w otwartej przestrzeni (z dala od Ziemi i ringu): postój, lot 500 j/s
// i dopalacz 1500 j/s przy kilku zoomach, A/B bez pyłu i bez poświaty dysz, błysk i ogień, kamery 3D (pościg,
// z góry 3D, taktyczna), pas asteroid, Ziemia, seria klatek lotu (GIF), pipeline'y synchroniczne pyłu (ma być 0).
// Klatki w locie: gra zatrzymana pauzą tuż przed zrzutem — smugi stoją jak zatrzymana klatka.
//
//   node scripts/webgpu/pyl-gra.mjs [--out .tmp/pyl] [--rozmiar 1600x900] [--zoomy 0.2,0.45,0.9] [--seria 0]
//                                   [--miejsce otwarte|start] [--kamery 0] [--pas 0]
//
// Wynik: <out>/*.png, <out>/seria/*.png (gdy --seria N > 0) i <out>/raport.json (prędkość, widoczność pyłu,
// błędy konsoli, pipeline'y).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/pyl');
mkdirSync(out, { recursive: true });
const ZOOMY = String(args.zoomy || '0.2,0.45,0.9').split(',').map(Number);
const SERIA = Number(args.seria || 0);

const { server, base } = await startVite(Number(args.port || 5393));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [], bledy: [] };

// Pipeline'y utworzone SYNCHRONICZNIE (materiał bez rozgrzewki = przestój w klatce) — jak suchy-dok-gra.mjs.
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

const KEYS = {
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 },
  shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }
};
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);

const state = () => ev(`(() => {
  const s = window.ship, c = window.camera, d = window.SpaceDust3D;
  return { v: Math.round(Math.hypot(s.vel.x, s.vel.y)), zoom: +c.zoom.toFixed(3),
    pyl: d ? { widocznosc: +d.stats.vis.toFixed(3), kamera: Math.round(d.stats.speed), drobin: d.stats.instances,
      tryb: d.stats.mode, dysze: d.stats.plumes, ortho: !!d.meshes.ortho?.visible, fg: !!d.meshes.fg?.visible,
      k3d: !!d.meshes.free?.visible } : null,
    dysze: (() => { const F = window.EngineFrame, k = F ? F.indexOf(s) : -1;
      return k < 0 ? null : { rozrzut: Math.round(F.spread[k]), R: Math.round(F.radius[k]), moc: +F.power[k].toFixed(2), dysz: F.nozzles[k] }; })(),
    rysunki: window.__rendererInfo?.calls ?? null, klatkaMs: +(window.Core3D?.lastFramePerf?.renderTotalMs ?? 0).toFixed(2) };
})()`);

async function shot(name, dir = out) {
  await screenshotPng(cdp, join(dir, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(26), JSON.stringify(s));
}
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
const dust = (on) => ev(`(() => { window.OPTIONS.spaceDust = '${on ? 'on' : 'off'}'; return true; })()`);
// Lot: zrzut przy zatrzymanej grze (pauza stopuje prędkość smug w miejscu), potem lot dalej.
async function flyShot(name) {
  await pause(true);
  await sleep(250);
  await shot(name);
  await pause(false);
  await sleep(400);
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.start = await state();
  report.startPos = await ev('({ x: window.ship.pos.x, y: window.ship.pos.y })');
  console.log('start:', JSON.stringify(report.start));

  if ((args.miejsce || 'otwarte') === 'otwarte') {
    await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x + 260000, s.pos.y - 180000, -0.6); window.DevScene.syncCamera(); return true; })()`);
    await sleep(1500);
  }
  for (const z of ZOOMY) {
    await setZoom(z);
    await sleep(600);
    await shot(`z${z}-postoj`);
  }
  await down('w');
  await sleep(4500);
  for (const z of ZOOMY) {
    await setZoom(z);
    await sleep(700);
    await flyShot(`z${z}-lot`);
  }
  // A/B: ta sama chwila lotu bez pyłu (opcja menu)
  await setZoom(ZOOMY[Math.min(1, ZOOMY.length - 1)]);
  await sleep(700);
  await pause(true);
  await sleep(250);
  await shot(`z${ZOOMY[Math.min(1, ZOOMY.length - 1)]}-lot-bez-pylu-A`);
  await dust(false);
  await sleep(250);
  await shot(`z${ZOOMY[Math.min(1, ZOOMY.length - 1)]}-lot-bez-pylu-B`);
  await dust(true);
  // A/B poświaty dysz: pył bez stożków dysz (ta sama klatka)
  await sleep(250);
  await ev(`(() => { window.__plumeGain = window.SpaceDustTune.plume.gain; window.SpaceDustTune.plume.gain = 0; return true; })()`);
  await sleep(250);
  await shot(`z${ZOOMY[Math.min(1, ZOOMY.length - 1)]}-lot-bez-poswiaty-dysz`);
  await ev(`(() => { window.SpaceDustTune.plume.gain = window.__plumeGain; return true; })()`);
  await pause(false);
  await down('shift');
  await sleep(5000);
  for (const z of ZOOMY) {
    await setZoom(z);
    await sleep(700);
    await flyShot(`z${z}-dopalacz`);
  }
  if (SERIA > 0) {
    // Seria klatek lotu (GIF): skręt w trakcie dopalacza — smugi zmieniają kierunek.
    const dir = join(out, 'seria');
    mkdirSync(dir, { recursive: true });
    await setZoom(ZOOMY[Math.min(1, ZOOMY.length - 1)]);
    await sleep(600);
    for (let i = 0; i < SERIA; i++) {
      await pause(true);
      await sleep(120);
      await screenshotPng(cdp, join(dir, `${String(i).padStart(3, '0')}.png`));
      await pause(false);
      await sleep(70);
    }
  }
  await up('shift');
  await sleep(2500);

  // Światło efektów na pyle: błysk w siatce świateł przed dziobem (jak trafienie ciężkiego działa), potem ogień
  // grupy w ręku (LPM w kursor przed dziobem) — drobiny w zasięgu błysków jaśnieją.
  const zMid = ZOOMY[Math.min(1, ZOOMY.length - 1)];
  await setZoom(zMid);
  await sleep(500);
  await pause(true);
  await ev(`(() => {
    const s = window.ship, a = s.angle;
    const x = s.pos.x + Math.cos(a) * 1300, y = s.pos.y + Math.sin(a) * 1300;
    window.Core3D.fx.lights.flash(x, y, 1.0, 0.75, 0.5, 16, 1400, 6, 1, 0, 60);
    return true;
  })()`);
  await sleep(300);
  await shot(`z${zMid}-blysk`);
  await pause(false);
  const aim = await ev(`(() => {
    const s = window.ship, a = s.angle, c = window.camera;
    const x = s.pos.x + Math.cos(a) * 2600, y = s.pos.y + Math.sin(a) * 2600;
    return { x: (x - c.x) * c.zoom + window.innerWidth / 2, y: (y - c.y) * c.zoom + window.innerHeight / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aim.x, y: aim.y });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aim.x, y: aim.y, button: 'left', clickCount: 1 });
  await sleep(1400);
  await flyShot(`z${zMid}-ogien`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aim.x, y: aim.y, button: 'left', clickCount: 1 });

  // Kamery 3D (K): pył w sześcianie wokół kamery perspektywy, poświata dysz w świecie.
  if (args.kamery !== '0') {
    for (const [mode, name] of [['chase', 'kamera-poscig'], ['top', 'kamera-zgory3d'], ['tactical', 'kamera-taktyczna']]) {
      await ev(`(() => window.Game3D?.setCamera?.('${mode}'))()`);
      await sleep(2200);
      if (mode !== 'chase') {
        await flyShot(name);
        continue;
      }
      // A/B pościgu: ta sama klatka bez pyłu (co w kadrze kamery 3D jest pyłem)
      await pause(true);
      await sleep(250);
      await shot(name);
      await dust(false);
      await sleep(250);
      await shot(`${name}-bez-pylu`);
      await dust(true);
      await pause(false);
      await sleep(400);
    }
    await ev(`(() => window.Game3D?.setCamera?.('classic'))()`);
    await sleep(800);
  }
  await up('w');

  // Pas asteroid (gęste pole sceny 5 dema): w polu siatka świateł ma reflektory statków — pył w ich stożkach.
  if (args.pas !== '0') {
    await ev(`(async () => {
      const W = await import('/dema/asteroidy-webgpu/world.js');
      const s = W.SPOTS.field;
      window.DevScene.teleport(s.x, s.y, -0.4); window.DevScene.syncCamera();
      return true;
    })()`);
    await sleep(2500);
    await down('w');
    await sleep(3500);
    await setZoom(zMid);
    await sleep(700);
    await flyShot(`z${zMid}-pas`);
    await up('w');
  }

  // Przy Ziemi (miejsce startu): pył na tle planety i ringu.
  if (report.start) {
    await ev(`(() => { window.DevScene.teleport(${report.startPos.x}, ${report.startPos.y}, -2.4); window.DevScene.syncCamera(); return true; })()`);
    await sleep(1500);
    await down('w');
    await down('shift');
    await sleep(4000);
    await setZoom(zMid);
    await sleep(700);
    await flyShot(`z${zMid}-ziemia`);
    await up('shift');
    await up('w');
  }

  report.pipeline = await ev(`(() => {
    const p = window.__pipeRec?.pipes || [];
    const dustSync = p.filter((x) => x.sync && /spaceDust|SpaceDust/.test(x.nazwa));
    return { wszystkie: p.length, sync: p.filter((x) => x.sync).length, syncPyl: dustSync.length, listaPyl: dustSync.map((x) => x.nazwa) };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().filter((l) => !/favicon/.test(l)).slice(0, 80);
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
