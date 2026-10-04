// Celownik broni, kompas łuków, sylwetka okrętu z wieżami i koło trybów pod ŚPM w PRAWDZIWEJ grze
// (2026-10-03 — przebudowa celownika: src/ui/weaponReticle.js, src/ui/turretPanel.js, src/game/shipModes.js).
// Vite + headless Chrome z WebGPU (CDP), wejście myszą i klawiszami jak od gracza.
//
//   node scripts/webgpu/celownik-gra.mjs [--faza defences] [--out .tmp/celownik] [--rozmiar 1600x900]
//
// Kolejno: kursor na wrogu, LPM trzymany (przeładowanie + kompas), kursor na trawersie (wieże poza łukiem),
// grupa 1 w ręku (działa), koło ŚPM (PRZELOT), stuknięcie ŚPM (powrót), TARCZE. Wynik: <out>/*.png
// i <out>/raport.json (tryb, stany wież, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/celownik');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5374));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], bledy: [] };

const KEY = (k) => {
  const up = k.toUpperCase();
  return { key: k, code: /^[a-z]$/.test(k) ? `Key${up}` : `Digit${k}`, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
};
const tap = async (k) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY(k) });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY(k) });
};
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });

const state = () => ev(`(() => {
  const fc = window.fireControl, m = window.shipModes, s = window.ship;
  const names = ['RELOAD', 'READY', 'TRAVERSE', 'NO_ARC', 'CHARGE', 'DOWN', 'IDLE'];
  const list = (g) => fc.turrets[g].slice(0, fc.turretCount[g]).map((t) => names[t.state] + (t.state === 0 ? ':' + t.progress.toFixed(2) : ''));
  return {
    tryb: m.current, postawa: m.stance, kolo: m.wheel.open, wReku: fc.inHand,
    special: list('special'), main: list('main').length,
    limit: +(window.shipDriveState.speedLimit * (window.shipDriveState.stanceLimit || 1)).toFixed(0),
    v: Math.round(Math.hypot(s.vel.x, s.vel.y)), tarcza: Math.round(s.shield.val)
  };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.probki.push({ name, ...s });
  console.log(name.padEnd(24), JSON.stringify(s));
}

// Punkt ekranu w kierunku `rel` [rad] od dziobu okrętu gracza, `px` pikseli ekranu od środka okrętu.
const shipPoint = (rel, px) => ev(`(() => {
  const s = window.ship, a = s.angle + ${rel}, d = ${px} / Math.max(1e-6, window.camera.zoom);
  const p = window.worldToScreen(s.pos.x + Math.cos(a) * d, s.pos.y + Math.sin(a) * d, window.camera);
  return { x: Math.round(Math.min(${W} - 20, Math.max(20, p.x))), y: Math.round(Math.min(${H} - 20, Math.max(20, p.y))) };
})()`);

try {
  const faza = args.faza || 'defences';
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${faza}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase && !window.StoryGame.blocksInput', 300000, 400)) throw new Error('fabuła nie ruszyła');
  await sleep(2000);
  report.fit = await ev(`(() => { const c = {}; for (const h of window.Game.player.hardpoints) { const k = h.type + ':' + (h.mount || 'PUSTE'); c[k] = (c[k] || 0) + 1; } return c; })()`);
  console.log('fit:', JSON.stringify(report.fit));

  // 1) Kursor przy dziobie — bateria w ręku sięga, wieże się obracają.
  let p = await shipPoint(0.35, 330);
  await mouse('mouseMoved', p.x, p.y);
  await sleep(2500);
  await shot('celownik-01-dziob');

  // 2) LPM trzymany: salwa, przeładowanie (czerwone segmenty), kompas łuków.
  await mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
  await sleep(1200);
  await shot('celownik-02-ogien');
  await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });

  // 3) Kursor na lewym trawersie: prawa bateria poza łukiem (szare segmenty).
  // Kamera idzie za kursorem (rig) — punkt liczony drugi raz po jej ustaleniu.
  for (let i = 0; i < 3; i++) {
    p = await shipPoint(-Math.PI / 2, 300);
    await mouse('mouseMoved', p.x, p.y);
    await sleep(1500);
  }
  await shot('celownik-03-trawers');

  // 4) Grupa 1 w ręku: działa (15 cienkich segmentów), kompas po zmianie grupy.
  await tap('1');
  await sleep(700);
  await shot('celownik-04-dziala');
  await tap('2');
  await sleep(300);

  // 5) Koło trybów: ŚPM trzymany, kursor w sektor PRZELOT, puszczenie.
  p = await shipPoint(0.2, 300);
  await mouse('mouseMoved', p.x, p.y);
  await sleep(300);
  await mouse('mousePressed', p.x, p.y, { button: 'middle', buttons: 4, clickCount: 1 });
  await sleep(200);
  const step = (Math.PI * 2) / 7;
  const a = -Math.PI / 2 + 2 * step;   // sektor 2 = PRZELOT
  await mouse('mouseMoved', Math.round(p.x + Math.cos(a) * 75), Math.round(p.y + Math.sin(a) * 75), { buttons: 4 });
  await sleep(300);
  await shot('celownik-05-kolo');
  await mouse('mouseReleased', Math.round(p.x + Math.cos(a) * 75), Math.round(p.y + Math.sin(a) * 75), { button: 'middle', clickCount: 1 });
  await sleep(1200);
  await shot('celownik-06-przelot');

  // 6) Stuknięcie ŚPM: poprzedni tryb (BOJOWY).
  await mouse('mouseMoved', p.x, p.y);
  await sleep(100);
  await mouse('mousePressed', p.x, p.y, { button: 'middle', buttons: 4, clickCount: 1 });
  await sleep(80);
  await mouse('mouseReleased', p.x, p.y, { button: 'middle', clickCount: 1 });
  await sleep(500);
  await shot('celownik-07-stukniecie');

  // 7) TARCZE z koła.
  const b = -Math.PI / 2 + 1 * step;
  await mouse('mouseMoved', p.x, p.y);
  await sleep(100);
  await mouse('mousePressed', p.x, p.y, { button: 'middle', buttons: 4, clickCount: 1 });
  await sleep(150);
  await mouse('mouseMoved', Math.round(p.x + Math.cos(b) * 75), Math.round(p.y + Math.sin(b) * 75), { buttons: 4 });
  await sleep(150);
  await mouse('mouseReleased', Math.round(p.x + Math.cos(b) * 75), Math.round(p.y + Math.sin(b) * 75), { button: 'middle', clickCount: 1 });
  await sleep(800);
  await shot('celownik-08-tarcze');

  // 8) Klawisz I — maskowanie przez wspólny automat, ponownie I — powrót.
  await tap('i');
  await sleep(200);
  report.maskowanie = await ev(`(() => { const c = window.ship.cloak; return c ? { stan: c.state, czas: +c.time.toFixed(2), energia: Math.round(c.energy), wlaczone: c.enabled, zerwane: c.lastBreak, tryb: window.shipModes.current } : null; })()`);
  console.log('maskowanie po I:', JSON.stringify(report.maskowanie));
  await sleep(1300);
  await shot('celownik-09-maskowanie');
  await tap('i');
  await sleep(600);
  report.poMaskowaniu = await state();

  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
