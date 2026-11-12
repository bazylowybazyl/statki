// Zrzuty dema zasięgu radarów (dema/radar-zasiegi.html — propozycje wyglądu, docs/PLAN-zasieg-czujnikow.md):
// każda propozycja w kadrze CIC i taktycznym (Atlas 3,5 km przed brzegiem strefy czaty), w strefie, w cichej pracy
// i we fregacie zwiadu; błędy konsoli.
//
//   node scripts/webgpu/radar-zasiegi-demo.mjs [--out .tmp/radar-zasiegi] [--rozmiar 1600x900] [--tylko kontur,hud]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/radar-zasiegi');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
mkdirSync(out, { recursive: true });

const VARIANTS = ['kontur', 'strefy', 'izolinie', 'hud', 'mgla'];
const { server, base } = await startVite(Number(args.port || 5423));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 60000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };

async function shot(name, set, sec = 0) {
  const full = { ...set, follow: !set.cam };
  await ev(`(() => { const R = window.RadarZasiegi; R.set(${JSON.stringify(full)}); R.run(${sec}); R.set({ pause: true }); })()`);
  await sleep(250);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = await ev('window.RadarZasiegi.state()');
  console.log('zrzut', name.padEnd(28), JSON.stringify(report.zrzuty[name]));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/radar-zasiegi.html?t=20` });
  if (!await waitFor(cdp, '!!window.RadarZasiegi', 120000, 250)) throw new Error('demo nie wstało');
  await sleep(500);
  const want = (k) => !only || only.has(k);
  for (let v = 0; v < VARIANTS.length; v++) {
    const k = VARIANTS[v];
    if (!want(k)) continue;
    const n = `${v + 1}-${k}`;
    await shot(`${n}-cic`, { variant: v, preset: 'cic', x: 0, y: 0, silent: false, hull: 'atlas', cam: { x: 68000, y: 18000 } }, 1);
    await shot(`${n}-taktyczny`, { variant: v, preset: 'taktyczny', x: 2000, y: 4000, silent: false, hull: 'atlas' }, 1);
    await shot(`${n}-w-strefie`, { variant: v, preset: 'taktyczny', x: 16000, y: 2000, silent: false, hull: 'atlas' }, 1);
  }
  if (want('cisza')) {
    await shot('6-izolinie-cisza-cic', { variant: 2, preset: 'cic', x: 0, y: 0, silent: true, hull: 'atlas', cam: { x: 68000, y: 18000 } }, 1);
    await shot('7-kontur-fregata-cisza-cic', { variant: 0, preset: 'cic', x: 0, y: 0, silent: true, hull: 'scout', cam: { x: 68000, y: 18000 } }, 1);
    await shot('8-kontur-prawda-cic', { variant: 0, preset: 'cic', x: 0, y: 0, silent: false, hull: 'atlas', truth: true, cam: { x: 68000, y: 18000 } }, 1);
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
