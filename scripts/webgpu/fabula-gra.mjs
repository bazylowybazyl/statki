// Fabuła w PRAWDZIWEJ grze (2026-09-30, src/game/story/): Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/fabula-gra.mjs [--intro] [--faza approach|ram|defences|shipyard|counter|return]
//        [--kadry 0,2,4,6,8,10,12,14] [--rozmiar 1600x900] [--out .tmp/fabula] [--czas 20]
//
// --intro (domyślnie): nowa gra w trybie kampanii — kadry lotu kamery w stałych chwilach toru (StoryGame.cine.devTime),
//   odprawa w doku (dialog), wysunięcie ze stanowiska, kamera gry z celem i samouczkiem.
// --faza X: skok dev (?story=X) — stan świata i kadry fazy co --krok s przez --czas s (raport: cele, liczniki grupy).
// Wynik: <out>/*.png, <out>/raport.json (fazy, cele, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/fabula');
const faza = args.faza || null;
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5372));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { faza, kadry: [], bledy: [] };

const KEYS = {
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
};
const tap = async (k) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
};

const state = () => ev(`(() => {
  const S = window.StoryGame, s = window.ship;
  const d = S.dialogue?.current;
  return {
    faza: S.phase || null, kino: S.cine.mode, t: +(S.cine.t || 0).toFixed(2), dl: +(S.cine.duration || 0).toFixed(2),
    zamrozony: S.worldFrozen, blokada: S.blocksInput, pasy: S.letterbox,
    dialog: d ? { kto: d.who, tryb: d.mode, nr: d.index, z: d.count } : null,
    cel: S.ui.objective ? S.ui.objective.text + (S.ui.objective.progress ? ' [' + S.ui.objective.progress() + ']' : '') : null,
    podpowiedz: S.ui.hint ? S.ui.hint.spec.title + (S.ui.hint.done ? ' ✓' : '') : null,
    statek: s ? { x: Math.round(s.pos.x), y: Math.round(s.pos.y), kat: +(s.angle || 0).toFixed(3), v: Math.round(Math.hypot(s.vel.x, s.vel.y)) } : null,
    maskowanie: s?.cloak ? s.cloak.state : null,
    npc: (window.npcs || []).filter((n) => n && !n.dead && n.__storyTag).reduce((a, n) => { a[n.__storyTag] = (a[n.__storyTag] || 0) + 1; return a; }, {}),
    klatka: window.__frameId || 0
  };
})()`);

async function shot(name, extra = null) {
  await sleep(Number(args.czekaj || 700));
  const st = await state();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st, ...(extra || {}) });
  console.log(name.padEnd(22), JSON.stringify(st));
}

try {
  const url = `${base}/index.html?dev=1${faza ? `&story=${faza}` : ''}`;
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  // Tło menu gotowe (kamera kinowa menu — początek lotu intro).
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await sleep(1500);
  await screenshotPng(cdp, join(out, '00-menu.png'));
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await screenshotPng(cdp, join(out, '01-nowa-gra.png'));
  report.menu = await ev(`(() => [...document.querySelectorAll('#menu-gamemode-view .menu-chip')].map((b) => b.textContent + (b.classList.contains('active') ? '*' : '')).join(' '))()`);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);

  if (!faza) {
    // Lot intro w TLE MENU (MenuBackdrop3D.fly) — kadry w stałych chwilach toru (devTime), potem do końca.
    if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu w tle menu');
    const dur = await ev('window.__menuBackdrop.flight.duration');
    report.czasToru = dur;
    const times = String(args.kadry || '').split(',').filter(Boolean).map(Number);
    const list = times.length ? times : [0.1, 1.2, 2.4, 3.6, 4.8, 6.0, 7.2, 8.4, 9.6, dur - 0.05];
    let i = 0;
    for (const t of list) {
      if (!(t <= dur)) continue;
      await ev(`(() => { window.__menuBackdrop.flight.devTime = ${t}; return true; })()`);
      await shot(`10-lot-${String(i++).padStart(2, '0')}-t${t.toFixed(1)}`);
    }
    await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 60; S.REVEAL_DELAY_SEC = 0; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
    // Gra startuje w ostatnim kadrze lotu: kamera 2D, dach zamknięty, potem otwarcie (spowolnione — stałe chwile).
    if (!await waitFor(cdp, '!!window.StoryGame.reveal', 60000, 100)) throw new Error('gra nie ruszyła po locie');
    await shot('14-przenikanie');
    await sleep(1400);
    await ev(`(() => { window.StoryGame.reveal.t = 0; return true; })()`);
    await shot('15-ciecie-dach-zamkniety');
    await ev(`(() => { window.StoryGame.reveal.t = 30; return true; })()`);
    await shot('16-dach-w-polowie');
    await ev(`(() => { window.StoryGame.reveal.t = 60; return true; })()`);
    await waitFor(cdp, '!window.StoryGame.reveal', 20000, 100);
    await shot('17-dach-otwarty');
    await waitFor(cdp, '!!window.StoryGame.dialogue.current', 20000, 200);
    await sleep(2500);
    await shot('20-odprawa-1');
    // Przewijanie odprawy klawiszem (nakładka łapie Spację przed grą).
    for (let k = 0; k < 12; k++) {
      const d = await ev('(() => { const d = window.StoryGame.dialogue; return d.active && d.mode === "scene"; })()');
      if (!d) break;
      await tap('space');
      await sleep(250);
      if (k === 3) await shot('21-odprawa-2');
    }
    await shot('30-wysuniecie-a');
    await sleep(4000);
    await shot('31-wysuniecie-b');
    await waitFor(cdp, "window.StoryGame.phase === 'undock' && !window.StoryGame.lock", 40000, 300);
    await sleep(1200);
    await shot('32-oddanie-kamery');
    await waitFor(cdp, '!window.StoryGame.cinematic', 20000, 300);
    await sleep(800);
    await shot('40-gra-cel');
  } else {
    if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase', 300000, 400)) throw new Error('gra nie ruszyła');
    const czas = Number(args.czas || 20);
    const krok = Number(args.krok || 4);
    await sleep(2500);
    // --zoom 0.03: oddalony kadr (cała stocznia / bitwa)
    if (args.zoom) await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom)}; return true; })()`);
    // --stocznia: kamera RTS nad środkiem stoczni, bez HUD-u (układ rzędu, wieżyczek, eskorty)
    if (args.stocznia) {
      await ev(`(() => {
        const S = window.StoryGame, site = S.site, c = window.camera;
        if (!site) return false;
        if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
        const mx = (site.building.x + site.rowStart.x + site.rowEnd.x) / 3, my = (site.building.y + site.rowStart.y + site.rowEnd.y) / 3;
        c.x = c.targetX = mx; c.y = c.targetY = my; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom || 0.08)};
        document.getElementById('cockpit-ui-host')?.classList.add('hidden');
        return true;
      })()`);
    }
    // --eval "(() => …)()": dowolny kod przed kadrami (diagnostyka)
    if (args.eval) { report.eval = await ev(String(args.eval)); console.log('eval:', JSON.stringify(report.eval)); }
    for (let t = 0; t <= czas; t += krok) {
      await shot(`faza-${faza}-${String(t).padStart(3, '0')}`);
      if (t + krok <= czas) await sleep(krok * 1000);
    }
  }
  report.bledy = logs.errors().slice(0, 80);
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
