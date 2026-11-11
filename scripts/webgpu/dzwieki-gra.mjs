// Scena dźwięków (`?scena=dzwieki`, blok „SCENA DŹWIĘKI” w index.html, reguła `dzwiek`) w PRAWDZIWEJ grze. Dźwięku nikt
// tu nie słyszy — harness sprawdza LICZNIKI warstwy dźwięku (`window.__dzwieki.statystyki()`): ile razy zagrał każdy
// dźwięk, ile głosów odrzucił limit, szczyt na szynie przed i po limiterze, liczba przesterów; do tego zapis gry
// zamknięty, piraci na miejscach, konsola bez błędów. Kroki gry tylko przez `__harness.step()` (tryb hold).
//
// Przebieg: tarcza wył. / wł. (panel), grupy 1–5 (klawisze, Ctrl+1 — auto), ogień automatyczny wież na piratów, grupa 2
// (Yamato) LPM na pancernik, 5 (Supernova), piraci strzelają (ich broń, rakiety w Atlasa → CIWS z syntezy, trafienia
// w tarczę i kadłub), taran fregaty przy burcie (pierwszy kontakt, tarcie, zgniot), cele zniszczalne (śmierć okrętów,
// wybuchy), odnowienie celów. Na końcu: dźwięki, które nie zagrały ani razu (z listą zdarzeń) i błędy konsoli.
//
//   node scripts/webgpu/dzwieki-gra.mjs [--baza http://localhost:5199] [--out .tmp/dzwieki/gra] [--query renderWorker=1]
//        [--rozmiar 1600x900] [--tryb scena|bronie|zwykla|stary|wojna] [--czas 25] [--zestawy id,id]
// `--tryb bronie` — scena z kolejnymi zestawami broni Atlasa (`DevScene.dzwiekiZestaw`, panel „Broń Atlasa”): na zestaw
// namiar na pancernik piratów, LPM grupami 1 / 2 / 3, flak — piraci strzelają (rakiety → flak), torpedy (8), superbronie
// (Mjolnir z postoju, Hexlance 4 dwa razy, odmowa: Mjolnir w ruchu); na końcu dźwięki uzbrojenia,
// które nie zagrały (`--zestawy` — tylko wybrane).
// `--tryb zwykla` — zwykła gra BEZ sceny (warstwa dźwięku gra od 2026-11-11): warstwa powstaje, liczniki rosną przy locie
//   (silnik MAIN), strzale i trafieniu (pancernik bez mózgu przed Atlasem), stary AudioSys nie ma efektów, zapis gry otwarty,
//   głośność główna po migracji; `--tryb stary` — `?dzwiek=stary`: warstwa nie powstaje, stary AudioSys ma swoje dźwięki;
// `--tryb wojna` — `?wojna` (dwie floty, `--czas` s gry): kontrola, że w dużej bitwie nic się nie sypie — błędy konsoli,
//   szczyt po limiterze, głosy, odrzucenia limitu (nie pomiar wydajności).
// `--baza` — serwer z .claude/launch.json (domyślnie „Vite Dev Server” na 5199); bez serwera: `--baza vite` (własny Vite).
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tabelaDzwiekowBroni } from '../../src/audio/dzwiekiBroni.js';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/dzwieki/gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

let server = null;
let base = args.baza || 'http://localhost:5199';
if (base === 'vite') ({ server, base } = await startVite(Number(args.port || 5461)));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))}).then(() => true)`, 600000);
const report = { url: null, etapy: [], koniec: null, brak: [], bledy: [], ostrzezeniaDzwiekow: [] };

const KEY = (k) => {
  const up = k.toUpperCase();
  return { key: k, code: /^[a-z]$/.test(k) ? `Key${up}` : `Digit${k}`, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
};
async function tap(k, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...KEY(k) });
  await step(2);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...KEY(k) });
  await step(2);
}
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });

const ZAGRAL = `(() => { const s = window.__dzwieki.statystyki(); const o = {}; for (const [k, v] of Object.entries(s.dzwieki)) o[k] = v.zagral; for (const [k, v] of Object.entries(s.zdarzenia)) o['@' + k] = v; return o; })()`;
async function etap(nazwa, fn) {
  const przed = await ev(ZAGRAL);
  const t0 = Date.now();
  await fn();
  const po = await ev(ZAGRAL);
  const nowe = {};
  const zdarzenia = {};
  for (const [k, v] of Object.entries(po)) {
    if (!(v > (przed[k] || 0))) continue;
    if (k.startsWith('@')) zdarzenia[k.slice(1)] = v - (przed[k] || 0);
    else nowe[k] = v - (przed[k] || 0);
  }
  const s = await ev('window.__dzwieki.statystyki()');
  const wpis = { nazwa, ms: Date.now() - t0, zagraly: nowe, zdarzenia, glosy: s.glosyAktywne, szczytPoDb: s.szczytPoDb, przester: s.przester };
  report.etapy.push(wpis);
  console.log(`[${nazwa}] ${Object.entries(nowe).map(([k, v]) => `${k}×${v}`).join(', ') || '(nic)'}  szczyt po ${s.szczytPoDb} dB`);
  return wpis;
}

const TRYB = args.tryb || 'scena';
const ZWYKLA = TRYB !== 'scena' && TRYB !== 'bronie';

/** Tryb `bronie`: etap na zestaw broni Atlasa; na końcu dźwięki uzbrojenia bez odtworzenia. */
async function etapyBroni() {
  const zestawy = args.zestawy ? String(args.zestawy).split(',') : ['scena', 'dzialka', 'plazma', 'szynowe', 'wiazki', 'flak', 'rakiety', 'superbronie'];
  const celPanc = `(() => { const b = window.SoundScene.pirates.find((q) => q.key === 'pirate_battleship' && !q.npc.dead) || window.SoundScene.pirates.find((q) => !q.npc.dead && !q.near); return b ? window.DevScene.pointerAt(b.npc.x, b.npc.y) : null; })()`;
  const stop = '(() => { const s = window.ship; s.vel.x = 0; s.vel.y = 0; s.angVel = 0; return true; })()';
  const lpm = async (p, kroki) => {
    await mouse('mouseMoved', p.x, p.y);
    await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
    for (let k = kroki; k > 0; k -= 60) { await ev(stop); await step(Math.min(60, k)); }
    await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
  };
  report.zestawy = {};
  for (const id of zestawy) {
    const wpis = await etap(`zestaw ${id}`, async () => {
      await ev('window.DevScene.dzwiekiOdnow()');
      const ok = await ev(`window.DevScene.dzwiekiZestaw(${JSON.stringify(id)})`);
      report.zestawy[id] = { ok, bron: (await ev('window.DevScene.dzwiekiState()')).bronId };
      await step(30);
      let p = await ev(celPanc);
      if (!p) return;
      await mouse('mouseMoved', p.x, p.y);
      await step(4);
      await tap('t');
      if (id === 'superbronie') {
        // odmowa: Mjolnir w ruchu (LPM grupy 2 przy prędkości) — przed strzałem z postoju (broń gotowa)
        await tap('2');
        p = await ev(celPanc);
        await mouse('mouseMoved', p.x, p.y);
        await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
        for (let i = 0; i < 6; i++) { await ev('(() => { const s = window.ship; s.vel.x = 240; s.vel.y = 0; return true; })()'); await step(10); }
        await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
        await ev(stop);
        await step(30);
      }
      for (const g of ['1', '2']) {
        await tap(g);
        p = await ev(celPanc);
        await lpm(p, id === 'superbronie' ? 300 : 240);
      }
      await tap('3');
      p = await ev(celPanc);
      await lpm(p, 30);
      for (let i = 0; i < 3; i++) await step(60);
      if (id === 'flak') {
        // torpedy — tryb 8 + LPM (po flaku)
        // flak piratów (niszczyciele) strzela do rakiet Atlasa (grupa 3), flak Atlasa — do rakiet piratów
        await ev('window.DevScene.dzwiekiPiraciStrzelaja(true)');
        for (let r = 0; r < 2; r++) {
          await tap('3');
          p = await ev(celPanc);
          await lpm(p, 30);
          for (let i = 0; i < 9; i++) await step(60);
        }
        await ev('window.DevScene.dzwiekiPiraciStrzelaja(false)');
        await tap('8');
        p = await ev(celPanc);
        await lpm(p, 60);
        for (let i = 0; i < 2; i++) await step(60);
        await tap('8');
      }
      if (id === 'superbronie') {
        // Hexlance: 4 — ładowanie 1,2 s, okno, 4 — strzał
        await ev(stop);
        await tap('4');
        for (let i = 0; i < 2; i++) await step(60);
        await tap('4');
        for (let i = 0; i < 2; i++) await step(60);
      }
      await step(60);
    });
    report.zestawy[id].zagraly = wpis.zagraly;
    report.zestawy[id].zdarzenia = wpis.zdarzenia;
  }
  const st = (await ev('window.DevScene.dzwiekiState()')).dzwieki;
  const nowe = Object.keys(tabelaDzwiekowBroni({ wystrzal: 0, specjalna: 3 }));
  report.bronieBrak = nowe.filter((k) => !(st.dzwieki[k]?.zagral > 0));
  report.odrzucone = Object.fromEntries(Object.entries(st.dzwieki).filter(([, v]) => v.odrzuconeLimit || v.odrzuconeOdstep).map(([k, v]) => [k, { limit: v.odrzuconeLimit || 0, odstep: v.odrzuconeOdstep || 0 }]));
  report.szczyt = { przedDb: st.szczytPrzedDb, poDb: st.szczytPoDb, przester: st.przester, glosyMax: st.glosyMax };
  report.ostrzezeniaDzwiekow = st.ostrzezenia;
  console.log(`dźwięki uzbrojenia: zagrało ${nowe.length - report.bronieBrak.length} / ${nowe.length}; nie zagrały: ${report.bronieBrak.join(', ') || '—'}`);
  console.log(`odmowy: ${st.zdarzenia.odmowa || 0}; szczyt po limiterze ${st.szczytPoDb} dB, przester ${st.przester}, głosy max ${st.glosyMax}`);
}
const CZAS = Number(args.czas || 25);
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4243};\n${INJECT}` });
  const dopisek = { scena: '&scena=dzwieki', bronie: '&scena=dzwieki', zwykla: '', stary: '&dzwiek=stary', wojna: '&wojna' }[TRYB] ?? '';
  const url = `${base}/index.html?dev=1${dopisek}${args.query ? `&${args.query}` : ''}`;
  report.url = url;
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  report.zapisZamknietyPrzedStartem = await ev('window.__SAVE_LOCKED === true');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (ZWYKLA) {
    const STAN = `(() => { const a = window.AudioSys; const w = window.__dzwieki; const s = w ? w.statystyki() : null;
      let opcje = null; try { opcje = { sc_audio: JSON.parse(localStorage.getItem('sc_audio') || 'null'), migracja: localStorage.getItem('sc_audio_glowna_v2') }; } catch {}
      return { warstwa: !!w, wczytane: !!w?.wczytane, scena: !!window.SoundScene?.active, panel: !!document.getElementById('dzwieki-panel'),
        zapisZamkniety: window.__SAVE_LOCKED === true, staryAudioSys: Object.keys(a?.sounds || {}), staryPetlaSilnika: !!window.ship?.engineSound,
        kontekst: a?.ctx?.state, opcje,
        zagraly: s ? Object.fromEntries(Object.entries(s.dzwieki).filter(([, v]) => v.zagral > 0).map(([k, v]) => [k, v.zagral])) : null,
        odrzucone: s ? Object.fromEntries(Object.entries(s.dzwieki).filter(([, v]) => v.odrzuconeLimit || v.odrzuconeOdstep).map(([k, v]) => [k, (v.odrzuconeLimit || 0) + (v.odrzuconeOdstep || 0)])) : null,
        zdarzenia: s?.zdarzenia || null, szczytPrzedDb: s?.szczytPrzedDb, szczytPoDb: s?.szczytPoDb, przester: s?.przester, glosyMax: s?.glosyMax, ostrzezenia: s?.ostrzezenia }; })()`;
    if (TRYB !== 'stary') await waitFor(cdp, '!!(window.__dzwieki && window.__dzwieki.wczytane)', 60000, 250);
    await ev('window.__harness.hold(true)');
    await step(30);
    report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
    report.start = await ev(STAN);
    console.log(`[${TRYB}] start:`, JSON.stringify({ warstwa: report.start.warstwa, staryAudioSys: report.start.staryAudioSys, staryPetlaSilnika: report.start.staryPetlaSilnika, zapisZamkniety: report.start.zapisZamkniety, opcje: report.start.opcje }));
    if (TRYB === 'wojna') {
      for (let i = 0; i < CZAS; i++) await step(60);
    } else {
      // lot (silnik MAIN), cel przed Atlasem (pancernik bez mózgu, `spawnCallInShip` w trybie dummy), namiar T, grupa 1 w ręku, LPM na cel
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY('w') });
      await step(60);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY('w') });
      await ev('(() => { const s = window.ship; s.vel.x = 0; s.vel.y = 0; return true; })()');
      report.cel = await ev(`(() => { const s = window.ship; const a = s.angle || 0; const x = s.pos.x + Math.cos(a) * 2600, y = s.pos.y + Math.sin(a) * 2600;
        const r = window.spawnCallInShip('battleship', { mode: 'dummy', spawnPos: { x, y }, pos: { x, y }, spawnAngle: a + Math.PI / 2, exitK: 0 });
        const n = Array.isArray(r) ? r[0] : r; return n ? { x: Math.round(n.x), y: Math.round(n.y) } : null; })()`);
      await step(30);
      if (report.cel) {
        const p = await ev(`window.DevScene.pointerAt(${report.cel.x}, ${report.cel.y})`);
        await mouse('mouseMoved', p.x, p.y);
        await step(4);
        await tap('t');
        await tap('1');
        await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
        for (let i = 0; i < 6; i++) await step(60);
        await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
      }
      for (let i = 0; i < 2; i++) await step(60);
    }
    report.koniec = await ev(STAN);
    console.log(`[${TRYB}] koniec:`, JSON.stringify(report.koniec));
    throw Object.assign(new Error(`koniec trybu ${TRYB}`), { koniec: true });
  }
  if (!await waitFor(cdp, '!!(window.SoundScene && window.SoundScene.active && window.__dzwieki && window.__dzwieki.wczytane)', 60000, 250)) throw new Error('scena dźwięków nie ruszyła');
  await ev('window.__harness.hold(true)');
  await step(30);
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  report.start = await ev('window.DevScene.dzwiekiState()');
  report.kontekst = report.start.dzwieki?.kontekst;
  console.log(`tryb ${report.tryb}, kontekst audio ${report.kontekst}, piraci ${report.start.pirates.length}, zapis zamknięty ${report.start.saveLocked}`);
  report.panel = await ev(`(() => { const p = document.getElementById('dzwieki-panel'); return p ? { wiersze: p.querySelectorAll('.dp-wiersz').length, widoczny: p.getBoundingClientRect().width > 0 } : null; })()`);
  report.wczytanie = await ev(`(() => { const s = window.__dzwieki.statystyki(); const o = {}; for (const [k, v] of Object.entries(s.dzwieki)) if (!v.synteza) o[k] = { wczytane: v.wczytane, warianty: v.warianty, wzmocnienieDb: v.wzmocnienieDb, pomiar: v.pomiar }; return o; })()`);
  await ev('window.__dzwieki.wyzerujStatystyki()');
  // Diagnostyka: kto i którą ścieżką zabił pirata (pułapka na polu `dead` — stos wywołań, flaga „niezniszczalny”).
  const PULAPKA = `(() => { window.__smierci = window.__smierci || []; for (const p of window.SoundScene.pirates) { const n = p.npc; if (n.__pulapka) continue; n.__pulapka = true; let v = !!n.dead;
    Object.defineProperty(n, 'dead', { configurable: true, get() { return v; }, set(x) { if (x && !v) window.__smierci.push({ key: p.key, hp: n.hp, niezniszczalny: n.__dzwiekiNiezniszczalny, t: +window.DevScene.simTime().toFixed(1),
      stos: String(new Error().stack).split(String.fromCharCode(10)).slice(2, 9).map((l) => l.trim().split(' ')[1] || l.trim()).join(' < ') }); v = x; } }); } return true; })()`;
  await ev(PULAPKA);
  await screenshotPng(cdp, join(out, '01-start.png'));

  if (TRYB === 'bronie') {
    await etapyBroni();
    throw Object.assign(new Error('koniec trybu bronie'), { koniec: true });
  }

  // Odsłuch z panelu (▶): kliknięcia w przycisk wiersza — każde gra osobno, poza limitem głosów sceny
  // (tarczaWl ma limit 1 głosu i odstęp 200 ms, a trzy szybkie kliknięcia mają dać trzy odtworzenia).
  report.odsluch = await ev(`(async () => {
    const klik = (id, n) => { const w = [...document.querySelectorAll('#dzwieki-panel .dp-wiersz')].find((e) => e.querySelector('.dp-nazwa')?.textContent.split(' ')[0] === id);
      const b = w?.querySelector('button.dp-play'); for (let i = 0; i < n; i++) b?.click(); return !!b; };
    const z = (id) => window.__dzwieki.statystyki().dzwieki[id]?.zagral || 0;
    const out = {};
    for (const [id, n] of [['tarczaWl', 3], ['tempestIon', 4], ['zgrzytPetla', 1], ['silnikMain', 1], ['gatling', 2]]) {
      const przed = z(id); const jest = klik(id, n); out[id] = { przycisk: jest, klikniec: n, zagral: z(id) - przed };
    }
    out.przyciski = document.querySelectorAll('#dzwieki-panel button.dp-play').length;
    out.wiersze = document.querySelectorAll('#dzwieki-panel .dp-wiersz').length;
    return out; })()`);
  console.log('odsłuch z panelu:', JSON.stringify(report.odsluch));
  await step(60);
  await ev('window.__dzwieki.wyzerujStatystyki()');

  await etap('tarcza wył. / wł.', async () => {
    await ev('window.DevScene.dzwiekiTarcza(false)');
    await step(60);
    await ev('window.DevScene.dzwiekiTarcza(true)');
    await step(90);
  });

  await etap('grupy 1–5 i Ctrl+1 (auto)', async () => {
    for (const k of ['1', '2', '3', '4', '5']) { await tap(k); await step(10); }
    await tap('1', 2); // Ctrl — auto grupy wł. / wył.
    await step(10);
    await tap('1', 2);
    await step(10);
    await tap('2');
  });

  await etap('silnik MAIN (W) i dysze SIDE (Q / E)', async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY('w') });
    await step(60);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY('w') });
    for (const k of ['q', 'e']) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY(k) });
      await step(20);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY(k) });
      await step(20);
    }
    await ev('(() => { const s = window.ship; s.vel.x = 0; s.vel.y = 0; s.angVel = 0; return true; })()');
  });

  await etap('ogień: wieże na auto + Yamato LPM na pancernik + Supernova (5)', async () => {
    // cel priorytetowy: pancernik piratów (namiar), kursor nad nim, LPM trzymany
    // Kursor nad pancernikiem piratów (DevScene.pointerAt — punkt świata → mysz gry), T — cel priorytetowy (namiar).
    const p = await ev(`(() => { const b = window.SoundScene.pirates.find((q) => q.key === 'pirate_battleship'); return b ? window.DevScene.pointerAt(b.npc.x, b.npc.y) : null; })()`);
    if (p) {
      await mouse('mouseMoved', p.x, p.y);
      await step(4);
      await tap('t');
      report.namiar = await ev('window.DevScene.dzwiekiState().locks');
      await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
    }
    for (let i = 0; i < 8; i++) await step(60);
    if (p) await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
    await tap('5');
    for (let i = 0; i < 4; i++) await step(60);
    // Rakiety manewrujące w ręku (3) i LPM w ten sam cel.
    await tap('3');
    if (p) {
      await ev(`(() => { const b = window.SoundScene.pirates.find((q) => q.key === 'pirate_battleship'); return window.DevScene.pointerAt(b.npc.x, b.npc.y); })()`);
      await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
      await step(30);
      await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
    }
    for (let i = 0; i < 6; i++) await step(60);
    await tap('2');
  });

  await etap('piraci strzelają (ich broń, rakiety → CIWS, tarcza, kadłub)', async () => {
    // Piraci od nowa: ogień Atlasa z poprzedniego etapu zdejmuje wieże małych okrętów (fregata laserowa traci
    // wszystkie — zwykła mechanika gniazd), a ten etap ma usłyszeć broń każdej kategorii.
    await ev('window.DevScene.dzwiekiOdnow()');
    await step(30);
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(true)');
    for (let i = 0; i < 6; i++) await step(60);
    // salwa Atlasa w pancernik (po przeładowaniu wyrzutni) — obrona punktowa piratów ma do czego strzelać
    await tap('3');
    const p = await ev(`(() => { const b = window.SoundScene.pirates.find((q) => q.key === 'pirate_battleship'); return window.DevScene.pointerAt(b.npc.x, b.npc.y); })()`);
    await mouse('mouseMoved', p.x, p.y);
    await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
    await step(30);
    await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
    await tap('2');
    for (let i = 0; i < 20; i++) await step(60);
    report.piraciPoOgniu = await ev(`window.SoundScene.pirates.map((q) => { const n = q.npc; const s = window.ship;
      return { key: q.key, dead: !!n.dead, hp: Math.round(n.hp), hulk: !!n.__bridgeHulk || !!n.bridgeHulk, d: Math.round(Math.hypot(n.x - s.pos.x, n.y - s.pos.y)), angToAtlas: +(((Math.atan2(s.pos.y - n.y, s.pos.x - n.x) - n.angle + 9 * Math.PI) % (2 * Math.PI)) - Math.PI).toFixed(2),
        bron: (n.autoWeapons || []).map((w) => [w.id, Math.round(window.weaponRangeFor ? 0 : 0), w.cachedTarget ? (w.cachedTarget === s ? 'atlas' : (w.cachedTarget.type || 'x')) : null]).slice(0, 6) }; })`);
    await ev('window.DevScene.dzwiekiTarcza(false)');
    for (let i = 0; i < 6; i++) await step(60);
    await ev('window.DevScene.dzwiekiPiraciStrzelaja(false)');
    await ev('window.DevScene.dzwiekiTarcza(true)');
    await step(30);
  });

  await etap('kadłub krytyczny (alarm)', async () => {
    await ev('(() => { window.ship.hull.val = window.ship.hull.max * 0.1; return true; })()');
    await step(60);
    await ev('(() => { window.ship.hull.val = window.ship.hull.max; return true; })()');
    await step(30);
  });

  await etap('taran fregaty przy burcie', async () => {
    // Atlas pchany burtą na fregatę przy burcie (pierwszy kontakt, tarcie, zgniot) — do pierwszego kontaktu szybko,
    // potem wolno (docisk i tarcie).
    const kontakt = () => ev('(window.__dzwieki.statystyki().zdarzenia.kontaktKadlubow || 0)');
    const k0 = await kontakt();
    let po = -1;
    for (let i = 0; i < 40; i++) {
      const szybko = po < 0;
      await ev(`(() => { const s = window.ship; const f = window.SoundScene.pirates.find((q) => q.near && !q.npc.dead)?.npc; if (!f) return false;
        const dx = f.x - s.pos.x, dy = f.y - s.pos.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const v = ${szybko ? 380 : 140}; s.vel.x = dx / d * v; s.vel.y = dy / d * v; return true; })()`);
      await step(10);
      if (po < 0 && (await kontakt()) > k0) po = i;
      if (po >= 0 && i - po > 12) break;
    }
    report.taranKontaktPo = po;
    await ev('(() => { const s = window.ship; s.vel.x = 0; s.vel.y = 0; return true; })()');
    await step(60);
  });

  await etap('malowanie celów (T trzymane, kursor po piratach)', async () => {
    const pts = await ev(`window.SoundScene.pirates.filter((q) => !q.npc.dead).map((q) => ({ x: q.npc.x, y: q.npc.y }))`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY('t') });
    await step(4);
    for (const w of pts) {
      const p = await ev(`window.DevScene.pointerAt(${w.x}, ${w.y})`);
      await mouse('mouseMoved', p.x, p.y);
      await step(8);
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY('t') });
    await step(10);
  });

  await etap('cele zniszczalne: śmierć okrętów', async () => {
    await ev('window.DevScene.dzwiekiNiezniszczalne(false)');
    await ev(`(() => { for (const p of window.SoundScene.pirates) if (p.npc && !p.npc.dead && !p.near) window.applyDamageToNPC ? window.applyDamageToNPC(p.npc, 1e9, 'default', { bypassShield: true }, true) : null; return true; })()`);
    for (let i = 0; i < 5; i++) await step(60);
  });

  await etap('odnów cele', async () => {
    await ev('window.DevScene.dzwiekiNiezniszczalne(true)');
    report.smierci = await ev('window.__smierci');
    await ev('window.DevScene.dzwiekiOdnow()');
    for (let i = 0; i < 3; i++) await step(60);
  });

  await screenshotPng(cdp, join(out, '02-koniec.png'));
  report.koniec = await ev('window.DevScene.dzwiekiState()');
  report.kopiaWyboru = await ev('window.__dzwieki.tekstWyboru()');
  const st = report.koniec.dzwieki;
  report.brak = Object.entries(st.dzwieki).filter(([, v]) => !(v.zagral > 0)).map(([k]) => k);
  report.odrzucone = Object.fromEntries(Object.entries(st.dzwieki).filter(([, v]) => v.odrzuconeLimit || v.odrzuconeOdstep).map(([k, v]) => [k, { limit: v.odrzuconeLimit || 0, odstep: v.odrzuconeOdstep || 0, przesuniete: v.przesuniete || 0 }]));
  report.ostrzezeniaDzwiekow = st.ostrzezenia;
  report.zapisy = await ev(`(() => ({ zamkniety: window.__SAVE_LOCKED === true }))()`);
  console.log(`zagrały: ${Object.entries(st.dzwieki).filter(([, v]) => v.zagral > 0).length} / ${Object.keys(st.dzwieki).length}; nie zagrały: ${report.brak.join(', ') || '—'}`);
  console.log(`szczyt przed limiterem ${st.szczytPrzedDb} dB, po ${st.szczytPoDb} dB, przester ${st.przester}, głosy max ${st.glosyMax}`);
} catch (err) {
  if (!err?.koniec) {
    report.wyjatek = String(err?.stack || err);
    console.error(err);
  }
} finally {
  report.bledy = logs.errors();
  report.dziennikDzwiekow = logs.all().filter((l) => /Dźwięki/.test(l));
  writeJson(join(out, ZWYKLA ? `wyniki-${TRYB}.json` : 'wyniki.json'), report);
  console.log(`błędy konsoli: ${report.bledy.length}${report.bledy.length ? '\n  ' + report.bledy.slice(0, 12).join('\n  ') : ''}`);
  console.log(`wyniki: ${join(out, 'wyniki.json')}`);
  await chrome.close?.();
  if (server) await server.close();
  process.exit(0);
}
