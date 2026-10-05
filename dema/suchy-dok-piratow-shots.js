// Zrzuty dema suchego doku piratów: node dema/suchy-dok-piratow-shots.js [katalog] [nazwa…]
// Vite + headless Chrome przez CDP (rdzen-cdp.js). Zrzuty nie idą do repo — katalog domyślnie w %TEMP%.
// Ocena wyglądu należy do użytkownika.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, navigateAndWait, startChrome, startVite } from './rdzen-cdp.js';

const outDir = process.argv[2] || join(tmpdir(), 'suchy-dok-shots');
const only = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

const L = '__dock.layout';
const SHOTS = [
  { name: '01-caly-dok', js: '__dock.view(1); __dock.simulate(2);' },
  { name: '02-parking', js: '__dock.view(2); __dock.simulate(2);' },
  { name: '03-brama-reflektory', js: '__dock.view(3); __dock.simulate(2);' },
  { name: '04-hala-otwarta', js: '__dock.view(4); __dock.simulate(3);' },
  { name: '05-alarm-wylot', js: '__dock.view(5); __dock.simulate(7);' },
  { name: '06-kino-parking', js: '__dock.view(6); __dock.simulate(2);' },
  { name: '07-kino-brama-g01', js: '__dock.view(7); __dock.simulate(2);' },
  { name: '08-kino-brama-gw', js: `__dock.calm(); __dock.cine(${L}.parking.x0 + 250, ${L}.parking.laneZ, -20, 2900, Math.PI * 0.82, 0.42); __dock.simulate(1);` },
  { name: '09-zblizenie-okrety', js: `__dock.calm(); __dock.hub(-500, ${L}.parking.laneZ - 120, 0.55); __dock.simulate(1);` },
  // taran i zniszczenie na końcu — wybuchy reaktora żyją kilkanaście sekund i zasłoniłyby kolejne kadry
  { name: '10-taran-brama', js: '__dock.view(8); __dock.simulate(3.3);' },
  { name: '11-taran-rzad', js: '__dock.view(8); __dock.simulate(6.5);' },
  { name: '12-zniszczenie', js: '__dock.view(9); __dock.simulate(6);' },
  { name: '13-zniszczenie-koniec', js: '__dock.view(9); __dock.simulate(16);' }
];

const { server, base } = await startVite();
const chrome = await startChrome({ width: 1600, height: 900 });
const report = [];
try {
  const ok = await navigateAndWait(chrome.cdp, `${base}/dema/suchy-dok-piratow.html?shot=1`, 'window.__dock && window.__dock.ready === true', 240000);
  if (!ok) throw new Error('demo nie wstało (timeout)');
  for (const s of SHOTS) {
    if (only.length && !only.some((o) => s.name.includes(o))) continue;
    await evaluate(chrome.cdp, `${s.js} __dock.renderFrames(6); true`);
    await new Promise((r) => setTimeout(r, 300));
    await evaluate(chrome.cdp, '__dock.renderFrames(3); true');
    const { data } = await chrome.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${s.name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const stats = await evaluate(chrome.cdp, 'JSON.stringify(__dock.stats())');
    report.push({ shot: s.name, file, ...JSON.parse(stats) });
  }
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ report, logs: chrome.logs }, null, 2));
  await chrome.close();
  await server.close();
}
for (const r of report) {
  console.log(`${r.shot}: draw ${r.calls}, tri ${Math.round((r.triangles || 0) / 1000)}k, proxy ${r.proxies?.drawn}, odpadłe ${r.broken?.length}, okręty ${r.parkedAlive}, dach ${r.roofFade?.toFixed?.(2)}, błędy ${r.errors.length}`);
}
console.log('zrzuty:', outDir);
