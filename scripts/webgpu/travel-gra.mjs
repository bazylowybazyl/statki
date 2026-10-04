// TRAVEL TO i warp „Nurt” (iteracja 3: rulon, lejek, wyjście = przylot jak u NPC) w PRAWDZIWEJ grze.
// Vite + headless Chrome z WebGPU (CDP). Gra swobodna: rozkaz TRAVEL TO na punkt ~400 tys. j. od
// statku (jak z mapy CIC) — obrót dziobu, ładowanie (rulon się zwija), skok, lot, wyjście (zwolnienie,
// wlot, hamowanie) w celu; potem wezwanie okrętu (wlot z daleka i hamowanie) i POWRÓT (odlot).
//
//   node scripts/webgpu/travel-gra.mjs [--out .tmp/travel] [--rozmiar 1600x900] [--dystans 400000]
//
// Wynik: <out>/*.png (fazy) i <out>/raport.json (próbki: faza podróży, stan warpa, rampa, prędkość,
// odległość do celu, rulon; błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/travel');
mkdirSync(out, { recursive: true });
const dystans = Number(args.dystans || 400000);

const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], zdjecia: [], bledy: [] };

const state = () => ev(`(async () => {
  const { RULON } = await import('/src/3d/warp/rulon.js');
  const s = window.ship, w = window.warp, n = window.travelNav, r = w.exitRamp;
  const t = n.target;
  return {
    faza: n.active ? n.phase : 'brak', warp: w.state, rampa: r ? (r.active ? 'aktywna' : 'koniec') + ':' + r.age.toFixed(2) : '-',
    v: Math.round(Math.hypot(s.vel.x, s.vel.y)), kat: +(s.angle).toFixed(3),
    doCelu: t ? Math.round(Math.hypot(t.x - s.pos.x, t.y - s.pos.y)) : null,
    x: Math.round(s.pos.x), y: Math.round(s.pos.y),
    rulonK: +RULON.k.value.toExponential(2), lejek: +RULON.field.value.toFixed(2),
    zoom: +window.camera.zoom.toFixed(4), osrodek: !!window.WarpNurt?.stats?.awake,
    rysunki: window.__rendererInfo?.calls ?? null, klatkaMs: +(window.Core3D?.lastFramePerf?.renderTotalMs ?? 0).toFixed(2)
  };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(22), JSON.stringify(s));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(3000);
  await ev(`(() => { window.DevFlags && (window.DevFlags.unlimitedWarp = true); return true; })()`);
  if (args.bezCullingu) {
    // A/B kosztu: culling bez poszerzenia na czas rulonu (RULON_STATE.cullMargin zawsze 0).
    await ev(`(async () => { const m = await import('/src/3d/warp/rulon.js'); Object.defineProperty(m.RULON_STATE, 'cullMargin', { get: () => 0, set: () => {} }); return true; })()`);
  }
  if (args.zoom) {
    // Oddalenie (np. --zoom 0.02 — Ziemia przy starcie w kadrze, widać jej zgięcie w rulonie).
    await ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${Number(args.zoom)}); c.targetZoom = ${Number(args.zoom)}; return true; })()`);
    await sleep(2500);
  }

  // Cel: ~dystans od statku, kierunek z najmniejszą liczbą studni po drodze (z boku dziobu — obrót przed skokiem).
  const goal = await ev(`(() => {
    const s = window.ship;
    const a = s.angle + 1.1;
    return { x: s.pos.x + Math.cos(a) * ${dystans}, y: s.pos.y + Math.sin(a) * ${dystans} };
  })()`);
  report.cel = goal;
  await shot('00-start');
  await ev(`window.setTravelTarget(${goal.x}, ${goal.y}, 'TEST')`);
  await sleep(200);
  report.debug = await ev('window.__travelDebug()');
  console.log('debug:', JSON.stringify(report.debug).slice(0, 1500));
  if (args.tylkoDebug) throw new Error('tylko debug');
  // Klatki faz: strona sama pauzuje grę w zadanej chwili (rAF), CDP robi zdjęcie i wznawia —
  // ładowanie trwa 0,8 s, a zwolnienie wyjścia 0,7 s (odpytywanie przez CDP by je przegapiło).
  const stops = [
    ['02-ladowanie-rulon', "w.state === 'charging' && w.charge / w.chargeTime >= 0.6"],
    ['03-skok', "w.state === 'active' && N.time - N.player.kickT > 0.3"],
    ['04-lot', "w.state === 'active' && N.time - N.player.kickT > 0.8"],
    ['05-wyjscie-zwolnienie', 'w.exitRamp && w.exitRamp.active && w.exitRamp.age > 0.35'],
    ['06-hamowanie', 'w.exitRamp && w.exitRamp.age > w.exitRamp.tBrake + 0.05'],
    ['07-po-zatrzymaniu', 'w.exitRamp && w.exitRamp.age > w.exitRamp.tHalt + 0.8']
  ];
  await ev(`(() => {
    const stops = ${JSON.stringify(stops)}.map(([name, cond]) => [name, new Function('w', 'N', 'return ' + cond)]);
    window.__stopAt = null;
    let i = 0;
    const tick = () => {
      if (i < stops.length && !window.__stopAt && stops[i][1](window.warp, window.WarpNurt)) {
        window.__stopAt = stops[i][0];
        i++;
        window.__setGamePaused(true);
      }
      if (i < stops.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  await shot('01-obrot');
  const t0 = Date.now();
  let taken = 0;
  while (Date.now() - t0 < 150000 && taken < stops.length) {
    const at = await ev('window.__stopAt');
    if (at) {
      await sleep(250);
      await shot(at);
      taken++;
      await ev('(() => { window.__stopAt = null; window.__setGamePaused(false); return true; })()');
    } else {
      report.probki.push({ t: (Date.now() - t0) / 1000, ...(await state()) });
    }
    await sleep(30);
  }
  for (let i = 0; i < 200; i++) { if ((await state()).faza === 'brak') break; await sleep(100); }
  const end = await state();
  report.koniec = end;
  const dx = goal.x - end.x;
  const dy = goal.y - end.y;
  report.bladCelu = Math.round(Math.hypot(dx, dy));
  console.log('koniec podróży — odległość od celu:', report.bladCelu, 'j.');

  // PRZELOT na biegach (QOL 2026-10-03): W trzymane 12 s — prędkość i bieg co sekundę.
  await ev(`window.setShipMode('cruise')`);
  const wKey = { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...wKey });
  report.przelot = [];
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const p = await ev(`({ t: ${i + 1}, v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)), bieg: window.shipModes.cruiseGear, tryb: window.shipModes.stance })`);
    report.przelot.push(p);
    console.log('przelot', JSON.stringify(p));
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...wKey });
  await shot('07b-przelot');
  await ev(`window.setShipMode('combat')`);

  // Wezwanie (wlot z daleka i hamowanie) i POWRÓT (odlot) w kadrze.
  // Oddalenie, wezwanie obok statku (w kadrze), klatki po zegarze efektu (WarpNurt.time).
  await ev('(() => { window.camera.targetZoom = 0.06; return true; })()');
  await sleep(1500);
  const callPos = await ev(`(() => { const s = window.ship, a = s.angle + 1.9; return { x: s.pos.x + Math.cos(a) * 1800, y: s.pos.y + Math.sin(a) * 1800 }; })()`);
  const call = await ev(`window.callInSupport('destroyer', { spawnPos: ${JSON.stringify(callPos)}, mode: 'friendly' })`);
  report.wezwanie = call;
  console.log('wezwanie:', JSON.stringify(call));
  const fxT = (k) => ev(`(() => { const r = window.WarpNurt.arrivals.find((q) => q.kind === 'arrival'); return r ? { now: window.WarpNurt.time, t: r.fx[${JSON.stringify(k)}] } : null; })()`);
  const waitFx = async (k, off) => {
    for (let i = 0; i < 400; i++) { const f = await fxT(k); if (!f || f.now >= f.t + off) return; await sleep(20); }
  };
  if (call?.planned) {
    await waitFx('t0', 1.0); await shot('08-wezwanie-zwiastun');
    await waitFx('tAppear', 0.25); await shot('09-wezwanie-wlot');
    await waitFx('tBrake', 0.05); await shot('10-wezwanie-hamowanie');
    await sleep(2500); await shot('11-wezwanie-stoi');
    report.powrot = await ev('window.returnSupportWingToEarth ? window.returnSupportWingToEarth() : 0');
    const dep = async () => ev(`(() => { const r = window.WarpNurt.arrivals.find((q) => q.kind === 'departure'); return r ? { now: window.WarpNurt.time, tDive: r.fx.tDive } : null; })()`);
    for (let i = 0; i < 1500; i++) { const d = await dep(); if (d && d.now >= d.tDive + 0.25) break; await sleep(20); }
    await shot('12-powrot-odlot');
  }
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
