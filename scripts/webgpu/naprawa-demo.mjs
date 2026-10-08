// Zrzuty dema roju dronów naprawczych (dema/naprawa-webgpu.html) w headless Chrome z GPU (CDP), klatki z zegarem
// ręcznym (?test=1 → __naprawa.runFrames): kadr po otwarciu (drony startują), praca po kilku sekundach, zbliżenie
// spawania, statek w ruchu, A/B łata ↔ farba po naprawie, ostrzał dronów, błędy konsoli.
//
//   node scripts/webgpu/naprawa-demo.mjs [--out .tmp/naprawa/demo] [--rozmiar 1600x900]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/naprawa/demo');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5401));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };

async function shot(name, opis) {
  await ev('window.__naprawa.runFrames(2, 60)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev('window.__naprawa.stats()')) };
  delete report.zrzuty[name].warmup;
  console.log('zrzut', name.padEnd(22), JSON.stringify(report.zrzuty[name]));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/naprawa-webgpu.html?test=1` });
  if (!await waitFor(cdp, '!!(window.__naprawa && (window.__naprawa.ready || window.__naprawa.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__naprawa.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await shot('00-otwarcie', 'Po otwarciu: Atlas z kraterami i odciętą rufą, drony startują');
  await ev('window.__naprawa.runFrames(60 * 6, 60)');
  await shot('01-praca', 'Drony przy pracy (6 s)');
  await ev('window.__naprawa.act("2")');
  await ev('window.__naprawa.runFrames(40, 60)');
  await shot('02-zblizenie', 'Zbliżenie: dron z płytą, iskry i łuk spawania');
  await ev('window.__naprawa.act("1")');
  await ev('window.__naprawa.act("m")');
  await ev('window.__naprawa.runFrames(60 * 3, 60)');
  await shot('03-ruch', 'Statek w ruchu i skręcie — drony przyklejone do komórek');
  await ev('window.__naprawa.act("m")');
  await ev('window.__naprawa.act("f")');
  await ev('window.__naprawa.runFrames(60 * 3, 60)');
  await shot('04-ostrzal', 'Ostrzał dronów — zestrzelone wybuchają (pule broni)');
  await ev('window.__naprawa.act("f")');
  await ev('window.__naprawa.act("u")');
  await ev('(async () => { for (let k = 0; k < 120 && window.__naprawa.rig.launched; k++) await window.__naprawa.runFrames(60, 60); return true; })()', 600000);
  await ev('window.__naprawa.act("1")');
  await shot('05-po-naprawie', 'Po naprawie: łaty — szary podkład ze spawami');
  await ev('window.__naprawa.act("p")');
  await shot('06-farba', 'A/B: łaty farbą sprite’a');
  await ev('window.__naprawa.act("p")');
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
