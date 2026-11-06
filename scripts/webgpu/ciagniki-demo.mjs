// Zrzuty dema ciągników kosmicznych (headless Chrome z GPU przez CDP, własny Vite).
//
//   node scripts/webgpu/ciagniki-demo.mjs [--out .tmp/ciagniki/zrzuty] [--tylko start,galeria,...] [--rozmiar 1600x900] [--goly 1]
//
// Etapy: start (domyślny widok, 1 s i 8 s), zoomy (0,1 / 0,3 / 1 / 3,2), luki (ciasne łuki), skala, daleko, galeria, kontener
// (A/B: naczepa = kontener 1 × 1), panel (prawdziwy rAF z panelem). Raport: raport.json (statystyki partii, błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/ciagniki/zrzuty');
mkdirSync(out, { recursive: true });
const only = args.tylko ? String(args.tylko).split(',') : null;
const want = (k) => !only || only.includes(k);

const { server, base } = await startVite(Number(args.port || 5451));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };
let nr = 0;

async function shot(name, frames = 2) {
  await ev(`window.__ciagniki.frames(${frames})`);
  const file = `${String(nr++).padStart(2, '0')}-${name}.png`;
  await screenshotPng(cdp, join(out, file));
  report.zrzuty[file] = await ev('window.__ciagniki.stats()');
  console.log(file, JSON.stringify(report.zrzuty[file].trucks), 'rys.', report.zrzuty[file].render?.calls, 'zgięcie°', (report.zrzuty[file].bendMax * 57.3).toFixed(1));
}

try {
  const url = `${base}/dema/ciagniki.html?shot=1${args.goly ? '&goly=1' : ''}`;
  await cdp.send('Page.navigate', { url });
  const ok = await waitFor(cdp, 'window.__ciagniki && (window.__ciagniki.ready || window.__ciagniki.errors.length > 0)', 180000);
  if (!ok) throw new Error('demo nie wstało');
  // Pierwsza klatka proxy i tekstury: kilka klatek, dopóki obrazy czekają.
  for (let k = 0; k < 60; k++) {
    await ev('window.__ciagniki.frames(2)');
    if (!(await ev('window.__ciagniki.stats().waiting'))) break;
  }
  if (want('start')) {
    await ev('window.__ciagniki.view(1)');
    await shot('start', 60);
    await shot('start-po-8s', 420);
  }
  if (want('zoomy')) {
    await ev('window.__ciagniki.view(1)');
    await ev('window.__ciagniki.frames(300)');
    for (const z of [0.1, 0.3, 1, 3.2]) {
      await ev(`window.__ciagniki.zoom(${z})`);
      await ev('window.__ciagniki.frames(30)');
      await shot(`zoom-${z}`, 2);
    }
  }
  if (want('luki')) {
    await ev('window.__ciagniki.view(2)');
    await shot('luki', 240);
    await shot('luki-b', 300);
    await shot('luki-c', 300);
  }
  if (want('skala')) {
    await ev('window.__ciagniki.view(3)');
    // Proxy ruchu: obrazy i mapy powierzchni wczytują się w tle (czas ściany, nie klatki).
    for (let k = 0; k < 24; k++) {
      await ev('window.__ciagniki.frames(2)');
      await sleep(500);
    }
    await shot('skala', 120);
  }
  if (want('daleko')) {
    await ev('window.__ciagniki.view(4)');
    await shot('daleko-0.1', 120);
    await ev('window.__ciagniki.zoom(0.035)');
    await shot('daleko-0.035', 20);
    await ev('window.__ciagniki.zoom(0.3)');
    await shot('daleko-0.3', 20);
  }
  if (want('galeria')) {
    await ev('window.__ciagniki.view(5)');
    await shot('galeria', 30);
    await ev('window.__ciagniki.zoom(1.4)');
    await shot('galeria-1.4', 10);
  }
  if (want('kontener')) {
    await ev('window.__ciagniki.scale("container")');
    await ev('window.__ciagniki.view(1)');
    await ev('window.__ciagniki.frames(300)');
    for (const z of [0.1, 0.3, 1]) {
      await ev(`window.__ciagniki.zoom(${z})`);
      await shot(`kontener-zoom-${z}`, 20);
    }
    await ev('window.__ciagniki.scale("module")');
  }
  if (want('panel') && !args.goly) {
    // Jak u użytkownika: rAF, panel widoczny, zoom z przycisku, kamera za zestawem.
    await cdp.send('Page.navigate', { url: `${base}/dema/ciagniki.html` });
    await waitFor(cdp, 'window.__ciagniki && window.__ciagniki.ready', 180000);
    await sleep(3500);
    await screenshotPng(cdp, join(out, `${String(nr++).padStart(2, '0')}-panel.png`));
    report.panel = await ev('window.__ciagniki.stats()');
    console.log('panel', JSON.stringify(report.panel.trucks));
  }
  report.bledy = logs.errors();
  report.logi = logs.all().filter((l) => !l.startsWith('[log:')).slice(-40);
  console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 6).join('\n'));
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
process.exit(report.bledy?.length ? 1 : 0);
