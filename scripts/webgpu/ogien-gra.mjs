// Kierowanie ogniem i lot Atlasa w PRAWDZIWEJ grze (2026-10-01, docs/BRIEF-kierowanie-ogniem.md):
// Vite + headless Chrome z WebGPU (CDP), wejście klawiszami i myszą jak od gracza.
//
//   node scripts/webgpu/ogien-gra.mjs --tryb lot    [--out .tmp/ogien] [--rozmiar 1600x900]
//   node scripts/webgpu/ogien-gra.mjs --tryb ogien  [--faza defences|counter] [--czas 40]
//
// --tryb lot:   gra swobodna; pomiar tabeli lotu — rozpędzanie (W), hamowanie (S), obrót (D), szarża (F).
// --tryb ogien: kampania ze skokiem dev do fazy; najpierw sam ogień autonomiczny (gracz nic nie robi),
//               potem cel priorytetowy (T) i salwy grupy w ręku (LPM trzymany na celu).
// Wynik: <out>/*.png i <out>/raport-<tryb>.json (próbki, liczniki, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const tryb = args.tryb || 'ogien';
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/ogien');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5373));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tryb, probki: [], bledy: [] };

const KEY = (k) => {
  const up = k.toUpperCase();
  return { key: k, code: /^[a-z]$/.test(k) ? `Key${up}` : `Digit${k}`, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
};
const keyDown = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY(k) });
const keyUp = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY(k) });
const tap = async (k) => { await keyDown(k); await sleep(60); await keyUp(k); };
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });

const flight = () => ev(`(() => {
  const s = window.ship, d = window.shipDriveState, b = window.ramBurn;
  return {
    v: +Math.hypot(s.vel.x, s.vel.y).toFixed(1), obrot: +((s.angVel || 0) * 180 / Math.PI).toFixed(2),
    kat: +((s.angle || 0) * 180 / Math.PI).toFixed(1), limit: d.speedLimit, zryw: !!b.active, ladunek: +b.charge.toFixed(2)
  };
})()`);

const combat = () => ev(`(() => {
  const S = window.StoryGame, site = S.site, fc = window.fireControl, s = window.ship;
  const alive = (l) => (l || []).filter((n) => n && !n.dead && n.hp > 0).length;
  const mine = (window.bullets || []).filter((b) => b && b.source === s);
  const by = {};
  for (const b of mine) by[b.vfxKey] = (by[b.vfxKey] || 0) + 1;
  return {
    faza: S.phase, wiezyczki: site ? alive(site.turretList) : null, eskorta: site ? alive(site.defenderList) : null,
    zaparkowane: site ? alive(site.parkedList) : null,
    wrogowie: (window.npcs || []).filter((n) => window.isHostileNpc(n)).length,
    kandydaci: fc.candidateCount, stat: { ...fc.stats }, wReku: fc.inHand, postawa: fc.posture, cisza: !!fc.storyHold,
    cele: (window.getPlayerLockedTarget() ? 1 : 0),
    spust: !!window.fcTrigger?.mouse, blokada: !!S.blocksInput,
    pociski: by, tarcza: Math.round(s.shield.val), kadlub: Math.round(s.hull.val),
    v: Math.round(Math.hypot(s.vel.x, s.vel.y))
  };
})()`);

async function shot(name, data) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.probki.push({ name, ...data });
  console.log(name.padEnd(26), JSON.stringify(data));
}

try {
  const faza = tryb === 'ogien' ? (args.faza || 'defences') : null;
  const url = `${base}/index.html?dev=1${faza ? `&story=${faza}` : ''}`;
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="${faza ? 1 : 0}"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła (brak kalibracji napędu)');
  await sleep(2500);
  report.fit = await ev(`(() => { const c = {}; for (const h of window.Game.player.hardpoints) { const k = h.type + ':' + (h.mount || (h.type === 'hangar' ? 'hangar' : 'PUSTE')); c[k] = (c[k] || 0) + 1; } return c; })()`);
  report.naped = await ev(`(() => { const d = window.shipDriveState; return { tryb: d.mode, limit: d.speedLimit, kalibracja: d.calib, hamulec: d.brakeAccel, bok: +d.sideForceScale.toFixed(3), moment: +d.turnAccelerationScale.toFixed(3), obrotMaks: +(2.5 * d.maxTurnSpeedScale * 180 / Math.PI).toFixed(1) }; })()`);
  console.log('napęd:', JSON.stringify(report.naped));
  console.log('fit:', JSON.stringify(report.fit));

  if (tryb === 'lot') {
    // Pusta przestrzeń, z dala od ringu Ziemi (ring jest przeszkodą — zryw wbiłby się w niego).
    await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x - 600000, s.pos.y - 600000, 0); return true; })()`);
    await sleep(800);
    await mouse('mouseMoved', W / 2, H / 2);
    await shot('lot-00-start', await flight());
    // Rozpędzanie.
    await keyDown('w');
    for (let t = 1; t <= 8; t++) { await sleep(1000); report.probki.push({ name: `W ${t} s`, ...(await flight()) }); console.log(`W ${t} s`, JSON.stringify(report.probki.at(-1))); }
    await keyUp('w');
    await shot('lot-01-predkosc', await flight());
    // Hamowanie.
    await keyDown('s');
    const t0 = Date.now();
    let stop = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const f = await flight();
      if (f.v < 25 && stop === null) { stop = (Date.now() - t0) / 1000; break; }
    }
    await keyUp('s');
    report.hamowanieDo25 = stop;
    console.log('hamowanie do 25 j/s [s]:', stop);
    // Obrót.
    await keyDown('d');
    for (let t = 1; t <= 4; t++) { await sleep(1000); report.probki.push({ name: `D ${t} s`, ...(await flight()) }); console.log(`D ${t} s`, JSON.stringify(report.probki.at(-1))); }
    await keyUp('d');
    const r0 = Date.now();
    let rstop = null;
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const f = await flight();
      if (Math.abs(f.obrot) < 0.3) { rstop = (Date.now() - r0) / 1000; break; }
    }
    report.obrotGasnie = rstop;
    console.log('obrót gaśnie po puszczeniu steru [s]:', rstop);
    // Szarża.
    await tap('f');
    for (let t = 1; t <= 26; t++) {
      await sleep(500);
      const f = await flight();
      report.probki.push({ name: `F ${(t * 0.5).toFixed(1)} s`, ...f });
      console.log(`F ${(t * 0.5).toFixed(1)} s`, JSON.stringify(f));
      if (t === 6) await screenshotPng(cdp, join(out, 'lot-02-szarza.png'));
    }
    await shot('lot-03-po-szarzy', await flight());
    await tap('f');
    await sleep(300);
    report.drugaSzarza = await flight();
    console.log('druga szarża od razu:', JSON.stringify(report.drugaSzarza));
  } else {
    if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase', 300000, 400)) throw new Error('fabuła nie ruszyła');
    await sleep(1500);
    await mouse('mouseMoved', W / 2, H / 2 - 200);
    const czas = Number(args.czas || 40);
    await shot('ogien-00-start', await combat());
    // 1) Sam ogień autonomiczny: gracz nic nie robi.
    for (let t = 4; t <= czas / 2; t += 4) {
      await sleep(4000);
      await shot(`ogien-auto-${String(t).padStart(2, '0')}`, await combat());
    }
    // 2) Cel priorytetowy pod T: kursor na najbliższym żywym wrogu.
    const pick = await ev(`(() => {
      const s = window.ship;
      const list = (window.npcs || []).filter((n) => window.isHostileNpc(n));
      list.sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y));
      const n = list.find((e) => { const p = window.worldToScreen(e.x, e.y, window.camera); return p.x > 40 && p.x < ${W} - 40 && p.y > 40 && p.y < ${H} - 40; });
      if (!n) return null;
      const p = window.worldToScreen(n.x, n.y, window.camera);
      return { x: Math.round(p.x), y: Math.round(p.y), typ: n.type, dystans: Math.round(Math.hypot(n.x - s.pos.x, n.y - s.pos.y)) };
    })()`);
    report.celPodKursorem = pick;
    console.log('cel pod kursorem:', JSON.stringify(pick));
    if (pick) {
      await mouse('mouseMoved', pick.x, pick.y);
      await sleep(400);
      await tap('t');
      await sleep(400);
      await shot('ogien-T-cel', await combat());
      // 3) Grupa w ręku: LPM trzymany na celu.
      await mouse('mousePressed', pick.x, pick.y, { button: 'left', buttons: 1, clickCount: 1 });
      await sleep(150);
      report.podKursorem = await ev(`(() => { const el = document.elementFromPoint(${pick.x}, ${pick.y}); return { el: el ? el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 60) : null, spust: !!window.fcTrigger?.mouse, tryb: window.shipModes?.current, blokada: !!window.StoryGame.blocksInput }; })()`);
      console.log('po wciśnięciu LPM:', JSON.stringify(report.podKursorem));
      for (let t = 2; t <= czas / 2; t += 2) {
        const p = await ev(`(() => { const t = window.getPlayerLockedTarget(); if (!t) return null; const p = window.worldToScreen(t.x, t.y, window.camera); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        if (p) await mouse('mouseMoved', p.x, p.y, { button: 'left', buttons: 1 });
        await sleep(2000);
        await shot(`ogien-LPM-${String(t).padStart(2, '0')}`, await combat());
      }
      await mouse('mouseReleased', pick.x, pick.y, { button: 'left', clickCount: 1 });
    }
  }
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, `raport-${tryb}.json`), report);
  await chrome.close();
  await server.close();
}
