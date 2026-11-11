// Dźwięki hali K-7 (blok „DŹWIĘKI HALI K-7” w index.html, reżyser src/game/k7HallSound.js, reguła `dzwiek`) w PRAWDZIWEJ
// grze, w kampanii (misja 1: Atlas na C-01). Dźwięku nikt tu nie słyszy — harness czyta LICZNIKI: warstwy hali
// (`window.__halaDzwieki.warstwa().statystyki()` — co zagrało, wczytane pliki, wzmocnienia, szczyt szyny) i reżysera
// (`window.__halaDzwieki.stan.stats` — zdarzenia, komunikaty, obecność).
//
// Przebieg: lot intro i odprawa przewinięte → postój w doku (tło, pompownia, przepływ, zawory, status spikera) →
// ODDOKOWANIE (F) → sekwencja obsługi (upust, buch pary, serwa, zwolnienie zacisków, komunikaty) → W — wylot przez
// G-01 (obecność gaśnie) → pauza (cisza). Na etap: nowe odtworzenia i zdarzenia; na końcu dźwięki hali bez odtworzenia,
// ostrzeżenia warstwy i błędy konsoli.
//
//   node scripts/webgpu/hala-dzwieki-gra.mjs [--out .tmp/dzwieki/hala] [--query renderWorker=1] [--postoj 14]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/dzwieki/hala');
mkdirSync(out, { recursive: true });
const POSTOJ = Number(args.postoj || 14);

const { server, base } = await startVite(Number(args.port || 5462));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { etapy: [], brak: [], ostrzezenia: [], bledy: [] };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); localStorage.setItem('sc_audio', JSON.stringify({ master: 0.7, music: 0.5, sfx: 1 })); } catch (e) {}
})();` });

const KEYS = {
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 },
  f: { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
};
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const tap = async (k) => { await down(k); await sleep(80); await up(k); };

const LICZNIKI = `(() => {
  const H = window.__halaDzwieki; const L = H.warstwa();
  if (!L) return null;
  const s = L.statystyki(); const o = {};
  for (const [k, v] of Object.entries(s.dzwieki)) o[k] = v.zagral;
  for (const [k, v] of Object.entries(H.stan.stats.events)) o['@' + k] = v;
  return { o, obecnosc: +H.stan.presence.toFixed(3), wHali: H.stan.stats.inside, szczytPoDb: s.szczytPoDb, petle: s.petle, glosy: s.glosyAktywne, kontekst: s.kontekst };
})()`;
async function etap(nazwa, fn) {
  const przed = (await ev(LICZNIKI))?.o || {};
  const t0 = Date.now();
  await fn();
  const po = await ev(LICZNIKI);
  const nowe = {};
  const zdarzenia = {};
  for (const [k, v] of Object.entries(po?.o || {})) {
    if (!(v > (przed[k] || 0))) continue;
    if (k.startsWith('@')) zdarzenia[k.slice(1)] = v - (przed[k] || 0);
    else nowe[k] = v - (przed[k] || 0);
  }
  const wpis = { nazwa, s: +((Date.now() - t0) / 1000).toFixed(1), zagraly: nowe, zdarzenia, obecnosc: po?.obecnosc, wHali: po?.wHali, petle: po?.petle, szczytPoDb: po?.szczytPoDb, kontekst: po?.kontekst };
  report.etapy.push(wpis);
  console.log(`[${nazwa}]`.padEnd(22), JSON.stringify(wpis));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${args.query ? '&' + args.query : ''}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu w tle menu');
  await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 1.2; S.REVEAL_DELAY_SEC = 0.2; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
  if (!await waitFor(cdp, '!!window.StoryGame.dialogue.current', 120000, 200)) throw new Error('brak odprawy');
  if (!await waitFor(cdp, '!!(window.__halaDzwieki.warstwa() && window.__halaDzwieki.warstwa().wczytane)', 60000, 200)) throw new Error('warstwa hali nie wczytana');
  await etap('odprawa', async () => { await sleep(4000); });
  for (let k = 0; k < 16; k++) {
    const d = await ev('(() => { const d = window.StoryGame.dialogue; return d.active && d.mode === "scene"; })()');
    if (!d) break;
    await tap('space');
    await sleep(220);
  }
  if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !!window.StoryGame.ui.action", 30000, 200)) throw new Error('brak ODDOKOWANIA');
  await etap('postoj-w-doku', async () => { await sleep(POSTOJ * 1000); });
  await etap('oddokowanie', async () => {
    await tap('f');
    await sleep(15000);
  });
  report.blokadaPoOddokowaniu = await ev('!!window.StoryGame.lock');
  await etap('wylot-W', async () => {
    await down('w');
    await sleep(9000);
    await up('w');
    await sleep(3000);
  });
  await etap('pauza', async () => {
    await ev('window.__setGamePaused(true)');
    await sleep(1500);
  });
  report.pauza = await ev(LICZNIKI);
  await ev('window.__setGamePaused(false)');
  const s = await ev('window.__halaDzwieki.warstwa().statystyki()');
  report.koniec = { dzwieki: s.dzwieki, szczytPoDb: s.szczytPoDb, szczytPrzedDb: s.szczytPrzedDb, przester: s.przester, glosyMax: s.glosyMax, bledy: s.bledy };
  report.ostrzezenia = s.ostrzezenia;
  report.brak = Object.entries(s.dzwieki).filter(([, v]) => !v.zagral).map(([k]) => k);
  report.rezyser = await ev('JSON.parse(JSON.stringify(window.__halaDzwieki.stan.stats))');
  console.log('nie zagrały:', report.brak.join(', ') || '—');
  console.log('ostrzeżenia warstwy:', report.ostrzezenia);
  console.log('szczyt po limiterze [dBFS]:', s.szczytPoDb, 'przed:', s.szczytPrzedDb, 'przester:', s.przester);
  console.log('wzmocnienia [dB]:', JSON.stringify(Object.fromEntries(Object.entries(s.dzwieki).map(([k, v]) => [k, v.wzmocnienieDb]))));
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 12));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
