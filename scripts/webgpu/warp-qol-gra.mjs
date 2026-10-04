// Rzeczywiste wejścia gracza + HUD i automatyczne wyjście ręcznego warpa.
// node scripts/webgpu/warp-qol-gra.mjs [--out .tmp/warp-qol] [--tylkoPowrot]
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs(), out = resolve(repo, args.out || '.tmp/warp-qol');
mkdirSync(out, { recursive: true });
const { server, base } = await startVite(5383);
const chrome = await startChrome({ width: 1600, height: 900 });
const { cdp } = chrome, logs = await attachLogs(chrome);
const ev = (e) => evaluate(cdp, e);
const report = { cases: [] };
const key = (type, key, code, n) => cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, nativeVirtualKeyCode: n });
const tap9 = async () => { await key('keyDown', '9', 'Digit9', 57); await key('keyUp', '9', 'Digit9', 57); };
const state = () => ev(`(() => {
  const s = window.ship, n = window.travelNav, w = window.warp, c = window.warpCourse;
  return { warp: w.state, nav: n.active, target: n.target, leg: n.leg, aim: c.aim,
    auto: c.autoExit, angle: w.chargeAngle, ramp: !!w.exitRamp?.active,
    pos: { x: s.pos.x, y: s.pos.y }, speed: Math.hypot(s.vel.x, s.vel.y) };
})()`);

async function prepare(degrees) {
  await ev(`(() => {
    window.__setGamePaused(true);
    const x = window.WORLD.w * 0.1, y = window.WORLD.h * 0.1;
    window.devTeleportTo(x, y, { angle: 1, quiet: true });
    window.setTravelTarget(x + 500000, y, 'TEST WARP');
    window.DevFlags.unlimitedWarp = true;
    window.__setGamePaused(false);
  })()`);
  // Prawdziwy obrót ręczny przerywa TRAVEL TO, ale zachowuje jego cel.
  await key('keyDown', 'd', 'KeyD', 68);
  assert.ok(await waitFor(cdp, '!window.travelNav.active && !!window.travelNav.target', 10000, 50));
  await key('keyUp', 'd', 'KeyD', 68);
  await ev(`(() => {
    window.__setGamePaused(true);
    window.ship.vel.x = window.ship.vel.y = 0;
    const l = window.travelNav.leg, p = window.ship.pos;
    window.ship.angle = Math.atan2(l.y - p.y, l.x - p.x) + ${degrees} * Math.PI / 180;
    window.ship.angVel = 0;
  })()`);
  assert.equal((await state()).leg.kind, 'warp');
  await sleep(150);
}

async function flight(degrees, shift = false) {
  await prepare(degrees);
  await screenshotPng(cdp, join(out, `kurs-${degrees}.png`));
  if (shift) await key('keyDown', 'Shift', 'ShiftLeft', 16); else await tap9();
  const charge = await state();
  assert.equal(charge.warp, 'charging');
  assert.equal(charge.auto, true);
  assert.equal(charge.nav, false);
  assert.ok(charge.target);
  await sleep(150);
  await screenshotPng(cdp, join(out, `ladowanie-${degrees}.png`));
  await ev('window.__setGamePaused(false)');
  assert.ok(await waitFor(cdp, "window.warp.state === 'active'", 20000, 25));
  assert.ok(await waitFor(cdp, '!!window.warp.exitRamp?.active', 20000, 25));
  assert.ok(await waitFor(cdp, '!window.warp.exitRamp?.active', 20000, 25));
  if (shift) await key('keyUp', 'Shift', 'ShiftLeft', 16);
  const end = await state();
  const miss = Math.hypot(end.pos.x - charge.aim.x, end.pos.y - charge.aim.y);
  assert.ok(miss < 6000, `minięcie ${miss}`);
  assert.equal(end.nav, false);
  assert.ok(end.speed < 1);
  report.cases.push({ degrees, shift, charge, end, miss });
  console.log(`Kurs ${degrees}° (${shift ? 'Shift' : '9'}): zatrzymanie ${Math.round(miss)} j. od punktu`);
}

async function returnToK7() {
  await ev(`(() => {
    window.__setGamePaused(true);
    window.StoryGame.beginNewGame({ startPhase: 'return', tutorial: false });
    window.__warpHudFrames = 0;
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (String(text).startsWith('WARP ·')) window.__warpHudFrames++;
      return original.call(this, text, ...args);
    };
    window.__setGamePaused(false);
  })()`);
  assert.ok(await waitFor(cdp, "window.StoryGame.phase === 'return' && !!window.StoryGame.ui.course", 60000, 100));
  // Rzeczywisty punkt powrotu z misji, 30 tys. j. przed halą (jeszcze poza progiem dokowania).
  await ev(`(() => {
    const S = window.StoryGame, api = S._api(), home = api.dock.approachPoint(), earth = S._earth();
    const a = Math.atan2(home.y - earth.y, home.x - earth.x);
    window.__k7Home = home;
    window.devTeleportTo(home.x + Math.cos(a) * 30000, home.y + Math.sin(a) * 30000, { quiet: true, angle: a + Math.PI });
    api.nav.setCourse(home.x, home.y, 'Ziemia — hala K-7');
    window.__setGamePaused(false);
  })()`);
  await key('keyDown', 'd', 'KeyD', 68);
  assert.ok(await waitFor(cdp, '!window.travelNav.active && !!window.travelNav.leg', 10000, 50));
  await key('keyUp', 'd', 'KeyD', 68);
  await ev(`(() => {
    window.__setGamePaused(true);
    const p = window.ship.pos, t = window.__k7Home;
    window.ship.angle = Math.atan2(t.y - p.y, t.x - p.x);
    window.ship.angVel = 0;
    window.__warpHudFrames = 0;
  })()`);
  report.returnApproach = { ...await state(), debug: await ev('window.__travelDebug()') };
  assert.equal(report.returnApproach.leg.kind, 'drive');
  await sleep(250);
  assert.equal(await ev('window.__warpHudFrames'), 0, 'dolot do K-7 bez HUD warpa mimo kursu na cel');
  await screenshotPng(cdp, join(out, 'k7-dolot-bez-warpa.png'));
  await tap9();
  assert.equal((await state()).aim, null, 'wolny skok nie blokuje licznika na K-7');
  await sleep(200);
  assert.equal(await ev('window.__warpHudFrames'), 0);
  await tap9();
  // Doprowadzenie fazy powrotu do doku i zakończenia misji.
  await ev(`(() => {
    const S = window.StoryGame, p = window.__k7Home;
    window.devTeleportTo(p.x, p.y, { quiet: true });
    S._api().nav.setCourse(p.x, p.y, 'Ziemia — hala K-7');
    window.__setGamePaused(false);
  })()`);
  assert.ok(await waitFor(cdp, '!!window.StoryGame.lock && !!window.StoryGame.dialogue.active', 20000, 50));
  const dock = await ev(`({ target: window.travelNav.target, aim: window.warpCourse.aim,
    course: window.StoryGame.ui.course, marker: window.StoryGame.ui.markers.has('course') })`);
  assert.equal(dock.target, null); assert.equal(dock.aim, null);
  assert.equal(dock.course, null); assert.equal(dock.marker, false);
  await ev('window.StoryGame.dialogue.skip()');
  assert.ok(await waitFor(cdp, "window.StoryGame.phase === 'done' && !window.StoryGame.blocksInput", 20000, 50));
  await sleep(250);
  assert.equal(await ev('window.__warpHudFrames'), 0, 'po misji licznik nie wraca');
  await screenshotPng(cdp, join(out, 'k7-po-misji.png'));
  report.cases.push({ name: 'powrot-K7', dock, end: await state(), warpHudFrames: await ev('window.__warpHudFrames') });
  console.log('K-7: dolot bez HUD warpa; po dokowaniu i zakończeniu misji cel / licznik skasowane');
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  assert.ok(await waitFor(cdp, '!!(window.__menuBackdrop?.ready && window.ship)', 240000, 500));
  await ev("document.getElementById('btn-new-game')?.click()");
  await sleep(900);
  await ev("document.querySelector('[data-story-campaign=\"0\"]')?.click(); document.getElementById('btn-mode-single')?.click()");
  assert.ok(await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400));
  await sleep(2500);
  if (!args.tylkoPowrot) {
  await flight(5);
  await flight(-5, true);
  await prepare(-65);
  await screenshotPng(cdp, join(out, 'obrot-w-prawo.png'));
  await prepare(5.1);
  await tap9();
  const charge = await state();
  assert.equal(charge.auto, false);
  assert.ok(charge.target);
  await sleep(150);
  await screenshotPng(cdp, join(out, 'poza-kursem.png'));
  await tap9();
  assert.equal((await state()).warp, 'idle');
  assert.ok((await state()).target);
  report.cases.push({ degrees: 5.1, charge, cancelled: await state() });
  }
  await returnToK7();
  // Znane błędy zasobów przy starcie tej wersji gry zachowujemy osobno w raporcie.
  const knownAssetError = (e) => /\/favicon\.ico\)/.test(e)
    || (/\[AudioSys\]/.test(e) && /'shieldHit'/.test(e) && /EncodingError/.test(e));
  const errors = logs.errors();
  report.knownAssetErrors = errors.filter(knownAssetError);
  report.errors = errors.filter(e => !knownAssetError(e));
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  console.log('HUD, granica ±5°, przejęcie celu, 9 / Shift i anulowanie: OK');
} finally {
  writeJson(join(out, 'wyniki.json'), report);
  await chrome.close();
  await server.close();
}
