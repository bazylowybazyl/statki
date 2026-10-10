// WYPOSAŻENIE w misji startowej (D2 / D8 planu fitowania, docs/PLAN-fitowanie.md) w PRAWDZIWEJ grze: kampania →
// lot intro przewinięty → odprawa przewinięta → panel stanowiska K-7 z przyciskami ODDOKUJ i WYPOSAŻENIE. Sprawdza:
//  1) start kampanii na karcie UNIWERSALNA, komplety pozostałych kart w hangarze (karty „W HANGARZE … · 0 CR”),
//  2) WYPOSAŻENIE (klik myszą) otwiera terminal portu Ziemi na zakładce kart, panel stanowiska chowa się pod nim,
//  3) zmiana karty w doku (SNAJPER), Enter w terminalu nie odcumowuje,
//  4) po zamknięciu terminala panel wraca, ODDOKUJ (klik myszą) rusza odcumowanie, karta zostaje (kampania jej nie
//     cofa), błędy konsoli.
//
//   node scripts/webgpu/wyposazenie-kampania-gra.mjs [--out .tmp/wyposazenie-kampania] [--rozmiar 1920x1080] [--port 5399]
//
// Wynik: <out>/*.png, <out>/raport.json; kod wyjścia 1 przy niespełnionym sprawdzeniu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wyposazenie-kampania');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5399));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H }, sprawdzenia: [] };
const check = (name, ok, detail) => {
  report.sprawdzenia.push({ name, ok: !!ok, detail });
  console.log(ok ? 'OK  ' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
};

const key = async (code, keyName, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
};
// Klik myszą CDP w środek elementu (jak gracz).
async function clickEl(selector) {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width }; })()`);
  if (!r || !r.w) return false;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return true;
}

const MAIN = `window.Game.player.hardpoints.filter((h) => h.type === 'main').reduce((m, h) => { if (h.mount) m[h.mount] = (m[h.mount] || 0) + 1; return m; }, {})`;
const PANEL = `(() => {
  const c = document.querySelector('#story-root .st-cmd');
  const alt = c?.querySelector('.st-cmd-alt');
  return { on: !!c?.classList.contains('on'), alt: alt && !alt.hidden ? alt.textContent : null, btn: c?.querySelector('.st-cmd-btn')?.textContent || null };
})()`;

let failed = false;
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { try { localStorage.removeItem('loadout'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.PlayerFit)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  // Lot intro w tle menu: przewinięty na koniec, odsłonięcie dachu skrócone; odprawa przewinięta Spacją.
  if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu w tle menu');
  await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 1.2; S.REVEAL_DELAY_SEC = 0.2; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
  if (!await waitFor(cdp, '!!window.StoryGame.dialogue.current', 120000, 200)) throw new Error('brak odprawy');
  await sleep(1500);
  for (let k = 0; k < 20; k++) {
    if (!await ev('(() => { const d = window.StoryGame.dialogue; return d.active && d.mode === "scene"; })()')) break;
    await key('Space', ' ', 32);
    await sleep(220);
  }
  if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !!window.StoryGame.ui.action", 30000, 200)) throw new Error('brak panelu ODDOKUJ');
  await sleep(1500);

  // ---------- 1) start kampanii ----------
  const start = await ev(`({ main: ${MAIN}, fit: window.PlayerFit.state(), panel: ${PANEL} })`);
  report.start = start;
  check('kampania: UNIWERSALNA (15× Tempest Ciężki), komplety w hangarze',
    JSON.stringify(start.main) === '{"tempest_ion_l":15}' && start.fit.hullPresets.atlas === 'universal' && start.fit.kitsGranted, start);
  check('panel stanowiska: ODDOKUJ + WYPOSAŻENIE', start.panel.on && start.panel.alt === 'WYPOSAŻENIE' && /ODDOKUJ/.test(start.panel.btn || ''), start.panel);
  await screenshotPng(cdp, join(out, '01-panel-stanowiska.png'));

  // ---------- 2) WYPOSAŻENIE z panelu ----------
  check('klik WYPOSAŻENIE', await clickEl('#story-root .st-cmd-alt'));
  await sleep(1200);
  const opened = await ev(`(() => ({
    terminal: window.isStationUIOpen(),
    karty: !!document.querySelector('#tab-mechanic-html.active.fit-mode'),
    panel: ${PANEL},
    cel: !!document.querySelector('#story-root .st-objective.on'),
    stopki: [...document.querySelectorAll('#tab-mechanic-html .fit-cards > .fit-card .fit-card-foot')].map((f) => f.textContent.replace(/\\s+/g, ' ').trim())
  }))()`);
  report.terminal = opened;
  check('terminal portu na zakładce kart, panel stanowiska i cel misji schowane pod terminalem',
    opened.terminal && opened.karty && !opened.panel.on && !opened.cel, opened);
  check('karty z kompletów: wszystkie w hangarze, 0 CR', opened.stopki.slice(1, 4).every((t) => /W HANGARZE 45\/45 · 0 CR/.test(t)), opened.stopki);
  await screenshotPng(cdp, join(out, '02-wyposazenie-w-doku.png'));

  // ---------- 3) SNAJPER, Enter nie odcumowuje ----------
  const sniper = await ev(`(async () => {
    const card = [...document.querySelectorAll('#tab-mechanic-html .fit-cards > .fit-card')].find((c) => c.querySelector('.fit-card-name')?.textContent.trim() === 'SNAJPER');
    card.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);
  await key('Enter', 'Enter', 13);   // terminal: ZASTOSUJ wybranej karty; panel stanowiska — nic
  await sleep(600);
  const afterEnter = await ev(`({ main: ${MAIN}, fit: window.PlayerFit.state(), system: window.playerShipSystem()?.id, pressed: !!window.StoryGame.ui.action?.pressed, lock: !!window.StoryGame.lock })`);
  report.snajper = afterEnter;
  check('SNAJPER w doku (Enter w terminalu = ZASTOSUJ), bez odcumowania',
    sniper && JSON.stringify(afterEnter.main) === '{"lance_rail_l":15}' && afterEnter.system === 'maneuver'
      && afterEnter.fit.hullPresets.atlas === 'sniper' && !afterEnter.pressed && afterEnter.lock, afterEnter);
  await screenshotPng(cdp, join(out, '03-snajper-w-doku.png'));

  // ---------- 4) zamknięcie, ODDOKUJ ----------
  await ev('window.closeStationUI()');
  await sleep(1200);
  const back = await ev(PANEL);
  check('po zamknięciu terminala panel stanowiska wraca', back.on && back.alt === 'WYPOSAŻENIE', back);
  await screenshotPng(cdp, join(out, '04-panel-po-terminalu.png'));
  check('klik ODDOKUJ', await clickEl('#story-root .st-cmd-btn'));
  await sleep(3500);
  const undock = await ev(`({ pressed: !!window.StoryGame.ui.action?.pressed || !window.StoryGame.ui.action, phase: window.StoryGame.phase, main: ${MAIN}, karta: window.PlayerFit.state().hullPresets.atlas })`);
  report.oddokuj = undock;
  check('ODDOKUJ rusza odcumowanie, karta SNAJPER zostaje', undock.pressed && JSON.stringify(undock.main) === '{"lance_rail_l":15}' && undock.karta === 'sniper', undock);
  await screenshotPng(cdp, join(out, '05-odcumowanie.png'));

  report.bledy = logs.errors().filter((line) => !/favicon\.ico/.test(line));   // 404 favicon z serwera dev — nie gra
  console.log(`błędy konsoli: ${report.bledy.length}`);
  for (const line of report.bledy.slice(0, 20)) console.log('  ', line);
  check('konsola bez błędów', report.bledy.length === 0, report.bledy.slice(0, 5));
} catch (err) {
  failed = true;
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  try { await screenshotPng(cdp, join(out, '99-blad.png')); } catch { /* */ }
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
const bad = report.sprawdzenia.filter((c) => !c.ok);
console.log(`sprawdzenia: ${report.sprawdzenia.length - bad.length}/${report.sprawdzenia.length} OK → ${out}`);
process.exit(failed || bad.length ? 1 : 0);
