// Dźwięki obszarów gry (reguła `dzwiek`, „Dźwięki obszarów”; tabela src/audio/dzwiekiSwiata.js, reżyser
// src/game/dzwiekiObszarow.js) w PRAWDZIWEJ grze. Dźwięku nikt tu nie słyszy — harness sprawdza LICZNIKI warstwy
// (`window.__dzwieki.statystyki()`: ile razy zagrał każdy dźwięk) i reżysera obszarów (`window.__dzwiekiObszarow.stats`),
// na każdy etap: które dźwięki zagrały; na końcu: dźwięki obszarów bez odtworzenia i błędy konsoli.
//
// Zwykła gra (swobodna): tło mostka, klik (delegacja kliknięć), maskowanie Atlasa (I), hipercruise (O), warp (9 —
// ładowanie, skok, tunel, zejście). Potem scena `DevScene.dzwieki()`: przylot okrętu z warpa (przycisk panelu),
// stopienie i detonacja rdzenia pirata (przycisk panelu), piraci strzelają (rakiety w Atlasa — ostrzeżenie),
// silniki obcych okrętów (synteza). Kroki gry tylko przez `__harness.step()` (tryb hold).
//
//   node scripts/webgpu/dzwieki-obszary-gra.mjs [--baza http://localhost:5199] [--out .tmp/dzwieki/obszary] [--query renderWorker=1]
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';
import { DZWIEKI_SWIATA, SYNTEZA_SWIATA } from '../../src/audio/dzwiekiSwiata.js';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/dzwieki/obszary');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

let server = null;
let base = args.baza || 'http://localhost:5199';
if (base === 'vite') ({ server, base } = await startVite(Number(args.port || 5462)));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))}).then(() => true)`, 600000);
const report = { url: null, etapy: [], brak: [], bledy: [], ostrzezenia: [] };

const KEY = (k) => {
  const up = k.toUpperCase();
  return { key: k, code: /^[a-z]$/.test(k) ? `Key${up}` : `Digit${k}`, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
};
const keyDown = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY(k) });
const keyUp = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY(k) });
async function tap(k) { await keyDown(k); await step(2); await keyUp(k); await step(2); }

const ZAGRAL = `(() => { const s = window.__dzwieki.statystyki(); const o = {}; for (const [k, v] of Object.entries(s.dzwieki)) o[k] = v.zagral;
  const r = window.__dzwiekiObszarow?.stats || {}; for (const [k, v] of Object.entries(r)) o['@' + k] = v; return o; })()`;
async function etap(nazwa, fn) {
  const przed = await ev(ZAGRAL);
  let wynik = null;
  try { wynik = await fn(); } catch (e) { wynik = { blad: String(e?.message || e) }; }
  const po = await ev(ZAGRAL);
  const nowe = {};
  const zdarzenia = {};
  for (const [k, v] of Object.entries(po)) {
    if (!(v > (przed[k] || 0))) continue;
    if (k.startsWith('@')) zdarzenia[k.slice(1)] = v - (przed[k] || 0);
    else nowe[k] = v - (przed[k] || 0);
  }
  const s = await ev('window.__dzwieki.statystyki()');
  report.etapy.push({ nazwa, wynik, zagraly: nowe, zdarzenia, szczytPoDb: s.szczytPoDb, przester: s.przester });
  console.log(`[${nazwa}] ${Object.entries(nowe).map(([k, v]) => `${k}×${v}`).join(', ') || '(nic)'}  | reżyser: ${Object.entries(zdarzenia).map(([k, v]) => `${k}×${v}`).join(', ') || '—'}${wynik ? `  | ${JSON.stringify(wynik)}` : ''}`);
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4243};\n${INJECT}` });
  const url = `${base}/index.html?dev=1${args.query ? `&${args.query}` : ''}`;
  report.url = url;
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, '!!(window.__dzwieki && window.__dzwieki.wczytane && window.__dzwiekiObszarow)', 60000, 250)) throw new Error('warstwa dźwięku nie wstała');
  await ev('window.__harness.hold(true)');
  await step(30);
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  report.wczytanie = await ev(`(() => { const s = window.__dzwieki.statystyki(); const o = {}; const ids = ${JSON.stringify(Object.keys(DZWIEKI_SWIATA))};
    for (const k of ids) { const v = s.dzwieki[k]; o[k] = v ? { wczytane: v.wczytane, warianty: v.warianty, wzmocnienieDb: v.wzmocnienieDb } : null; } return o; })()`);
  await ev('window.__dzwieki.wyzerujStatystyki()');

  // --- zwykła gra
  await etap('tło mostka (2 s lotu)', async () => {
    await step(120);
    // pętla tła gra od startu gry (przed zerowaniem liczników) — liczy się stan bezwzględny: odtworzenia od zerowania ≥ 1
    return ev(`({ pauza: !!window.PAUSED, stacja: !!window.stationUI?.open, hala: window.__halaDzwieki?.stan?.presence ?? null,
      mostekGra: window.__dzwieki.statystyki().dzwieki.mostek?.zagral || 0, petle: window.__dzwieki.statystyki().petle })`);
  });
  await etap('klik (przycisk DOM)', async () => {
    await ev(`(() => { const b = document.createElement('button'); b.textContent = 'test'; b.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999';
      document.body.appendChild(b); b.click(); b.remove(); return true; })()`);
    await step(4);
  });
  await etap('maskowanie Atlasa (I, I)', async () => {
    const ma = await ev('!!window.ship.cloak');
    await tap('i'); await step(150);
    const st1 = await ev('window.ship.cloak?.state || null');
    await tap('i'); await step(90);
    const st2 = await ev('window.ship.cloak?.state || null');
    // zerwanie: pola stanu jak `breakCloak` z cloak.js (funkcja gry nie jest na window) — sprawdza wpięcie reżysera
    await step(600);
    await tap('i'); await step(150);
    await ev(`(() => { const c = window.ship.cloak; c.state = 'cooldown'; c.level = 0; c.cooldown = 1; c.lastBreak = { reason: 'fire', time: c.time, forced: true }; return true; })()`);
    await step(90);
    return { maskowanie: ma, stanPoWl: st1, stanPoWyl: st2 };
  });
  await etap('hipercruise (O, lot, O)', async () => {
    await tap('o');
    let st = [];
    for (let i = 0; i < 6; i++) { await step(60); st.push(await ev('window.hypercruise.state')); }
    await tap('o');
    for (let i = 0; i < 3; i++) { await step(60); st.push(await ev('window.hypercruise.state')); }
    return { stany: st };
  });
  await etap('warp (9 trzymane 4 s, puszczone)', async () => {
    await keyDown('9');
    const st = [];
    for (let i = 0; i < 8; i++) { await step(30); st.push(await ev('window.warp?.state || null')); }
    await keyUp('9');
    for (let i = 0; i < 6; i++) { await step(30); }
    await keyDown('9'); await step(3); await keyUp('9');
    for (let i = 0; i < 8; i++) { await step(30); }
    return { stany: st };
  });

  await etap('alarmy okrętu (ShipAlarmDev: kadłub, rakieta, mostek)', async () => {
    const ma = await ev('!!window.ShipAlarmDev');
    if (!ma) return { ShipAlarmDev: false };
    await ev('window.ShipAlarmDev.set(2, 2)'); await step(150);
    await ev('window.ShipAlarmDev.set(3, 2)'); await step(150);
    await ev('window.ShipAlarmDev.set(4, 2)'); await step(150);
    return { ShipAlarmDev: true };
  });
  // --- etapy 3–5 w zwykłej grze
  await etap('myśliwce (Z — start eskadr, 8 s lotu)', async () => {
    await tap('z');
    for (let i = 0; i < 8; i++) await step(60);
    const ile = await ev('(window.npcs || []).filter((n) => n && !n.dead && n.playerOwned && (n.fighter || n.type === "fighter" || n.type === "interceptor")).length');
    return { mysliwce: ile };
  });
  await etap('myśliwce (Z, Z — atak, powrót do hangarów, 25 s)', async () => {
    // Z kolejno: start (eskorta) → atak → powrót (lądowanie: window.landFighter)
    await tap('z'); await step(10);
    await tap('z');
    for (let i = 0; i < 25; i++) await step(60);
    return { wPowietrzu: await ev('(window.npcs || []).filter((n) => n && !n.dead && n.playerOwned && (n.fighter || n.type === "fighter" || n.type === "interceptor")).length') };
  });
  await etap('skan X i mapa CIC (M, M)', async () => {
    await tap('x'); await step(150);
    await tap('m'); await step(30);
    await tap('m'); await step(30);
  });
  await etap('menu pauzy (Esc, strzałki, Esc)', async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    const widoczne = await ev(`!!document.querySelector('#main-menu') && getComputedStyle(document.querySelector('#main-menu')).display !== 'none'`);
    for (const k of ['ArrowDown', 'ArrowDown']) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: 40 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: 40 });
      await sleep(100);
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    await step(10);
    return { menuWidoczne: widoczne };
  });
  await etap('panel stacji (otwarcie, zamknięcie)', async () => {
    const ok = await ev(`(() => { const st = (window.stations || [])[0]; if (!st) return false; window.openStationUI(st); return !!window.stationUI?.open; })()`);
    await step(10);
    await ev('window.closeStationUI()');
    await step(10);
    return { otwarty: ok };
  });
  await etap('holownik serwisowy (wezwanie, 40 s)', async () => {
    const r = await ev('JSON.stringify(window.callServiceTug({ target: window.ship }) || null)');
    for (let i = 0; i < 40; i++) await step(60);
    return { wezwanie: r };
  });
  // --- scena dźwięków (piraci, panel)
  await ev('window.DevScene.dzwieki()');
  if (!await waitFor(cdp, '!!(window.SoundScene && window.SoundScene.active && document.getElementById("dzwieki-panel"))', 60000, 250)) throw new Error('scena dźwięków nie ruszyła');
  await step(60);
  report.panel = await ev(`(() => { const p = document.getElementById('dzwieki-panel'); return { grupy: [...p.querySelectorAll('.dp-grupa')].map((g) => g.textContent), wiersze: p.querySelectorAll('.dp-wiersz').length }; })()`);
  const KLIK_PANELU = (napis) => `(() => { const b = [...document.querySelectorAll('#dzwieki-panel button')].find((x) => x.textContent === ${JSON.stringify(napis)}); if (!b) return false; b.click(); return true; })()`;
  await etap('przylot okrętu z warpa (panel)', async () => {
    const ok = await ev(KLIK_PANELU('przylot'));
    for (let i = 0; i < 10; i++) await step(60);
    return { przycisk: ok };
  });
  await etap('stopienie rdzenia pirata (panel)', async () => {
    const ok = await ev(KLIK_PANELU('stopienie'));
    for (let i = 0; i < 6; i++) await step(60);
    return { przycisk: ok };
  });
  await etap('drony naprawcze (tarcza wył., ogień piratów 6 s, panel R, 12 s, R)', async () => {
    // drony ruszają tylko do ran — kadłub Atlasa najpierw obrywa (scena trzyma go przy życiu)
    await ev('window.DevScene.dzwiekiTarcza(false)');
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(true)');
    for (let i = 0; i < 6; i++) await step(60);
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(false)');
    await ev('window.DevScene.dzwiekiTarcza(true)');
    const ok = await ev(KLIK_PANELU('R'));
    for (let i = 0; i < 12; i++) await step(60);
    await ev(KLIK_PANELU('R'));
    for (let i = 0; i < 6; i++) await step(60);
    return { przycisk: ok };
  });
  await etap('kapsuły ratunkowe (panel, 5 s)', async () => {
    const ok = await ev(KLIK_PANELU('wyrzut'));
    for (let i = 0; i < 5; i++) await step(60);
    return { przycisk: ok };
  });
  await etap('skan X (panel)', async () => {
    const ok = await ev(KLIK_PANELU('fala'));
    for (let i = 0; i < 3; i++) await step(60);
    return { przycisk: ok };
  });
  await etap('odsłuch ▶ dźwięków obszarów (panel)', async () => {
    return ev(`(() => { const ids = ${JSON.stringify([...Object.keys(DZWIEKI_SWIATA), ...Object.keys(SYNTEZA_SWIATA)])}; let n = 0;
      for (const id of ids) if (window.__dzwieki.odsluch(id)) n++; return { odsluch: n, z: ids.length }; })()`);
  });
  await etap('piraci strzelają (rakiety w Atlasa, silniki obcych) 12 s', async () => {
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(true)');
    for (let i = 0; i < 12; i++) await step(60);
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(false)');
    return { silnikiObcych: (await ev('window.__dzwieki.statystyki()')).dzwieki.silnikObcy?.zagral || 0 };
  });

  const s = await ev('window.__dzwieki.statystyki()');
  const wszystkie = [...Object.keys(DZWIEKI_SWIATA), ...Object.keys(SYNTEZA_SWIATA)];
  const zagraneGra = new Set();
  for (const e of report.etapy) if (!/odsłuch/.test(e.nazwa)) for (const k of Object.keys(e.zagraly)) zagraneGra.add(k);
  report.brak = wszystkie.filter((k) => !zagraneGra.has(k));
  report.ostrzezenia = s.ostrzezenia;
  report.reżyser = await ev('window.__dzwiekiObszarow.stats');
  report.szczytPoDb = s.szczytPoDb;
  report.przester = s.przester;
} catch (e) {
  report.bladHarnessu = String(e?.stack || e);
  console.error(e);
} finally {
  report.bledy = logs.errors ? logs.errors() : (chrome.logs || []).filter((l) => /\[(error|exception)\]/.test(l));
  writeJson(join(out, 'wyniki.json'), report);
  console.log(`\nDźwięki obszarów bez odtworzenia w grze (poza ▶): ${report.brak.join(', ') || '—'}`);
  console.log(`Ostrzeżenia warstwy: ${JSON.stringify(report.ostrzezenia || [])}`);
  console.log(`Błędy konsoli: ${report.bledy.length}${report.bledy.length ? '\n  ' + report.bledy.slice(0, 12).join('\n  ') : ''}`);
  console.log(`Wyniki: ${join(out, 'wyniki.json')}`);
  await chrome.close();
  if (server) server.close?.();
  await sleep(200);
}
