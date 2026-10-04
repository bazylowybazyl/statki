// Zrzuty wariantów wyglądu w PRAWDZIWEJ grze (opcje nowej gry „Statki 2D / 3D”, „Bronie 2D / 3D”,
// src/game/visualMode.js + src/3d/ships3d/shipModels3DGame.js; 2026-09-30): Vite + headless Chrome z GPU
// (CDP). Panel „Nowa gra” z przełącznikami, start pojedynczej gry, mała bitwa obok gracza (sojusznicy
// i piraci), kratery na pancerniku, PAUZA — i każdy wariant przełączany w locie (window.setVisualMode) na
// tej samej zatrzymanej klatce: cała bitwa i zbliżenie. Na końcu (bez pauzy) ciąg W — struga MAIN.
//
//   node scripts/webgpu/modele3d-gra.mjs [--warianty 2d2d,3d3d,3d2d,2d3d] [--kamery chase,orbit,cinema,tactical,top] [--out .tmp/modele3d]
//        [--rozmiar 1600x900] [--czekaj 2500]
//
// Wynik: <out>/menu.png, <out>/<wariant>-<scena>.png, <out>/raport.json (błędy konsoli, statystyki modeli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const variants = (args.warianty || '2d2d,3d3d,3d2d,2d3d').split(',').filter(Boolean);
const out = resolve(repo, args.out || '.tmp/modele3d');
const waitMs = Number(args.czekaj || 2500);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5362));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { warianty: {}, bledy: [] };

const KEYS = {
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 }
};
const key = (k, down) => cdp.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', ...KEYS[k] });
const tap = async (k) => { await key(k, true); await sleep(80); await key(k, false); };
// Kamera RTS w punkcie (jak harness-strona.js cam): encja 'ship' / 'cel' (uszkodzony pancernik) i stały zoom.
const cam = (who, z) => ev(`(() => {
  const e = ${JSON.stringify(who)} === 'cel' ? window.__ranyCel : window.ship;
  const x = e ? (e.pos ? e.pos.x : e.x) : window.ship.pos.x, y = e ? (e.pos ? e.pos.y : e.y) : window.ship.pos.y;
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = x; c.y = c.targetY = y; c.manualZoom = true; c.zoom = c.targetZoom = ${z};
  window.DevScene?.syncCamera?.();
  return true;
})()`);
const shipCam = (z) => ev(`(() => {
  const c = window.camera; c.mode = 'ship'; c.focusStation = null;
  c.x = c.targetX = window.ship.pos.x; c.y = c.targetY = window.ship.pos.y;
  c.manualZoom = true; c.zoom = c.targetZoom = ${z}; window.DevScene?.syncCamera?.(); return true;
})()`);

async function shot(v, sc, info = null) {
  await sleep(waitMs);
  const stan = await ev(`(async () => {
    const m = await import('/src/3d/ships3d/shipModels3DGame.js');
    const info = window.__rendererInfo;
    return { modele: m.shipModels3DStats(), zoom: +(window.camera.zoom || 0).toFixed(3), drawCalls: info?.calls ?? null };
  })()`);
  await screenshotPng(cdp, join(out, `${v}-${sc}.png`));
  (report.warianty[v] ||= { sceny: {} }).sceny[sc] = { info, ...stan };
  console.log(v, sc.padEnd(10), JSON.stringify({ info, ...stan }));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
  // Menu „Nowa gra” z przełącznikami (3D / 3D — zrzut z aktywnymi chipami).
  await ev(`(() => { window.setVisualMode(true, true); document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(1200);
  await screenshotPng(cdp, join(out, 'menu.png'));
  report.menu = await ev(`(() => [...document.querySelectorAll('#menu-gamemode-view .menu-chip')].map((b) => b.textContent + (b.classList.contains('active') ? '*' : '')).join(' '))()`);
  await ev(`(() => { window.setVisualMode(false, false); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 40', 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(1500);
  // Mała bitwa obok gracza: sojusznicy (pancernik, niszczyciele) i piraci (pancernik, niszczyciel).
  report.spawn = await ev(`(async () => {
    const s = window.ship; let n = 0; const errs = [];
    const put = (k, mode, x, y, a) => {
      try {
        const r = window.spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a });
        n += Array.isArray(r) ? r.length : (r ? 1 : 0);
      } catch (err) { errs.push(k + '/' + mode + ': ' + String(err?.message || err)); }
    };
    put('battleship', 'friendly', -700, 1500, 0);
    put('destroyer', 'friendly', 900, 1400, 0);
    put('destroyer', 'friendly', 900, -1300, 0);
    put('pirate_battleship', 'pirate', 3600, 300, Math.PI);
    put('destroyer', 'pirate', 3400, -1300, Math.PI);
    return { n, errs };
  })()`);
  console.log('spawn:', JSON.stringify(report.spawn));
  await cam('ship', 0.12);
  // Kadłuby powstają leniwie (budżet na klatkę) — czekamy na pancerniki.
  await waitFor(cdp, `(window.npcs || []).filter((n) => n && n.beamHull && /battleship/.test(String(n.type || ''))).length >= 2`, 30000, 300);
  await sleep(2500);
  // Kratery na najbliższym pancerniku.
  report.rany = await ev(`(async () => {
    const { HullBodies } = await import('/src/game/hullBodies.js');
    const s = window.ship;
    let best = null, bd = Infinity;
    for (const n of window.npcs || []) {
      if (!n || n.dead || !n.beamHull || n.isWreck) continue;
      if (!/battleship/.test(String(n.type || ''))) continue;
      const d = Math.hypot((n.pos ? n.pos.x : n.x) - s.pos.x, (n.pos ? n.pos.y : n.y) - s.pos.y);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return { brak: true, typy: (window.npcs || []).map((n) => n && n.type + (n.beamHull ? '+' : '')).join(',') };
    const a = best.angle || 0, c = Math.cos(a), sn = Math.sin(a), r = (best.radius || 300) * 0.55;
    const bx = best.pos ? best.pos.x : best.x, by = best.pos ? best.pos.y : best.y;
    const before = best.beamHull.body.activeNodes;
    for (const f of [-0.75, -0.3, 0.15, 0.6]) {
      HullBodies.impact(best, bx + c * r * f, by + sn * r * f, 2600, { x: -sn * 400, y: c * 400 }, { craterRadius: 40 });
    }
    window.__ranyCel = best;
    return { typ: best.type, pirat: !!best.isPirate, odleglosc: Math.round(bd), wezly: [before, best.beamHull.body.activeNodes] };
  })()`);
  console.log('rany:', JSON.stringify(report.rany));
  await sleep(600);
  if (!args['bez-pauzy']) await tap('space'); // pauza: wszystkie warianty na tej samej klatce (--bez-pauzy: walka trwa)
  report.pauza = await ev('(() => !!window.PAUSED)()');
  console.log('pauza:', report.pauza);

  for (const v of variants) {
    const label = await ev(`(() => window.setVisualMode(${v.startsWith('3d')}, ${v.endsWith('3d')}))()`);
    (report.warianty[v] ||= { sceny: {} }).opis = label;
    await cam('ship', 0.07);
    await shot(v, 'bitwa');
    await cam('ship', 0.4);
    await shot(v, 'atlas');
    await cam('cel', 0.55);
    await shot(v, 'rany');
  }
  // Kamery 3D (src/game/game3D.js) na tej samej klatce: --kamery chase,orbit,cinema,tactical,top
  for (const k of String(args.kamery || '').split(',').filter(Boolean)) {
    await ev(`(() => { window.setVisualMode(false, false); const c = window.camera; c.mode = 'ship'; c.manualZoom = true; c.zoom = c.targetZoom = 0.18; window.Game3D.setCamera(${JSON.stringify(k)}); window.Game3D.focusEntity = ${args.fokus === 'cel' ? 'window.__ranyCel' : 'null'}; if (${JSON.stringify(args.odleglosc || '')}) c.zoom = c.targetZoom = Number(${JSON.stringify(args.odleglosc || '0.18')}); window.Game3D.rig.first = true; return true; })()`);
    await shot(`kamera-${k}`, 'bitwa');
  }
  if (args.kamery) await ev(`(() => { window.Game3D.setCamera('classic'); return true; })()`);
  // Dowolny kod w stronie po wariantach (diagnostyka): --eval "(async () => …)()"
  if (args.eval) { report.eval = await ev(String(args.eval)); console.log('eval:', JSON.stringify(report.eval)); }
  // A/B jasności modeli (mapa otoczenia) na tej samej klatce: --env 2.5,4
  for (const env of String(args.env || '').split(',').filter(Boolean)) {
    await ev(`(async () => { window.setVisualMode(true, true); const m = await import('/src/3d/ships3d/shipModels3DGame.js'); return m.setShipModels3DLook({ env: ${Number(env)} }); })()`);
    await cam('ship', 0.4);
    await shot(`3d3d-env${env}`, 'atlas');
  }
  // Ciąg (bez pauzy): struga MAIN przy modelu i przy sprite'cie.
  if (!args['bez-pauzy']) await tap('space');
  await shipCam(0.3);
  for (const v of ['2d2d', '3d3d']) {
    await ev(`(() => window.setVisualMode(${v.startsWith('3d')}, ${v.endsWith('3d')}))()`);
    await key('w', true);
    await shot(v, 'ciag');
    await key('w', false);
  }
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
