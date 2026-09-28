// Zrzuty dema warpa „Nurt” (dema/warp-webgpu.html) w tych samych chwilach co sceny warpa
// harnessu gry (zrzuty.mjs, sesja „warp”) — do zestawienia obok siebie (zadanie 22).
// Demo przewija oś deterministycznie (seek: kroki 1/240 s od początku sceny), bez paneli (?shot=1).
//
//   node scripts/webgpu/warp-demo-zrzuty.mjs [--out katalog] [--port 5356] [--rozmiar 1920x1080] [--kop]
//
// Chwile: ładowanie 75% (Ziemia → Jowisz), 0,2 s po kopnięciu, 1,5 s lotu, 0,1 i 0,75 s po wyjściu;
// przylot supercapitala: 0,5 s przed wyrzutem (zwiastun) i 0,15 s po; odlot: 0,15 s przed wejściem
// w szczelinę i 0,2 s po. Granice faz przylotu / odlotu dema szukane po nazwie fazy (state().phase).
// --kop (zadanie 22-B): zamiast tego sekwencja kamery wokół skoku i wyjścia — te same chwile co sesja
// „warp-kop” harnessu gry (zrzuty.mjs): ładowanie 90%, skok +0,05 / 0,117 / 0,25 / 0,5 / 1 / 2 s, wyjście
// +0,033 / 0,067 / 0,2 / 0,5 / 1 / 1,6 s → demo-kop-*.png (nazwy jak sceny gry z przedrostkiem „demo-”).
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5356);
const out = resolve(repo, args.out || '.tmp/webgpu/warp-demo');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const result = { zrzuty: {}, bledy: [] };

async function open(query) {
  await cdp.send('Page.navigate', { url: `${base}/dema/warp-webgpu.html?${query}&pause=1&shot=1` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__demo.ready)', 240000, 300)) throw new Error(`demo nie wstało (${query})`);
}

async function shot(name, t) {
  await ev(`(async () => { window.__demo.pause(true); window.__demo.seek(${t});
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r)); return true; })()`);
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await ev('(() => { const s = window.__demo.state(); return { t: +s.t.toFixed(3), phase: s.phase, drawCalls: s.drawCalls }; })()');
  result.zrzuty[name] = st;
  console.log(' ', name.padEnd(22), JSON.stringify(st));
}

// Granica fazy: najmniejsze t z przedziału [a, b], w którym faza spełnia warunek.
async function phaseEdge(a, b, test) {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) * 0.5;
    const ph = await ev(`(() => { window.__demo.seek(${mid}); return window.__demo.state().phase; })()`);
    if (test(ph)) hi = mid; else lo = mid;
  }
  return hi;
}

// Kop kamery (--kop, zadanie 22-B), scena 1: ładowanie 3 s od 0,8 s, SKOK w T.kick, WYJŚCIE w T.exit.
async function kopSequence() {
  await open('scene=trip&from=earth&to=jupiter');
  const T = await ev('window.__demo.state().T');
  result.T = T;
  const seq = [
    ['demo-kop-ladowanie', 0.8 + 0.9 * 3.0],
    ['demo-kop-skok-005', T.kick + 3 / 60], ['demo-kop-skok-012', T.kick + 7 / 60], ['demo-kop-skok-025', T.kick + 15 / 60],
    ['demo-kop-skok-05', T.kick + 0.5], ['demo-kop-skok-1', T.kick + 1], ['demo-kop-lot', T.kick + 2],
    ['demo-kop-wyjscie-003', T.exit + 2 / 60], ['demo-kop-wyjscie-007', T.exit + 4 / 60], ['demo-kop-wyjscie-02', T.exit + 0.2],
    ['demo-kop-wyjscie-05', T.exit + 0.5], ['demo-kop-wyjscie-1', T.exit + 1], ['demo-kop-wyjscie-16', T.exit + 1.6]
  ];
  for (const [name, t] of seq) await shot(name, t);
}

async function defaultSequence() {
  // Podróż Atlasa (scena 1): postój 0,8 s → ładowanie 3 s → SKOK (3,8 s) → przelot → WYJŚCIE.
  await open('scene=trip&from=earth&to=jupiter');
  const T = await ev('window.__demo.state().T');
  result.T = T;
  await shot('demo-ladowanie', 0.8 + 0.75 * 3.0);
  await shot('demo-skok', T.kick + 0.2);
  await shot('demo-lot', T.kick + 1.5);
  await shot('demo-wyjscie', T.exit + 0.1);
  await shot('demo-po-wyjsciu', T.exit + 0.75);

  // Przylot i odlot okrętu (scena 2, superkapitał): fazy po nazwach z dema.
  await open('scene=arrival&hull=supercapital');
  const burst = await phaseEdge(0.3, 6, (ph) => ph === 'wyrzut' || ph === 'po przylocie');
  const dive = await phaseEdge(8.8, 13, (ph) => ph === 'odlot');
  result.przylot = { wyrzut: +burst.toFixed(3), wejscie: +dive.toFixed(3) };
  await shot('demo-zwiastun', burst - 0.5);
  await shot('demo-przylot', burst + 0.15);
  await shot('demo-odlot-ladowanie', dive - 0.15);
  await shot('demo-odlot', dive + 0.2);
}

try {
  if (args.kop) await kopSequence();
  else await defaultSequence();
} catch (err) {
  result.bledy.push(String(err?.message || err));
  console.log('BŁĄD', err?.message || err);
} finally {
  result.logi = logs.errors().slice(0, 20);
  writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
console.log('gotowe:', out);
process.exit(result.bledy.length ? 1 : 0);
