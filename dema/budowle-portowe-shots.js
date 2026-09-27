// Zrzuty dema budowli portowych (Z7): node dema/budowle-portowe-shots.js [katalog] [nazwa…]
// Vite + headless Chrome przez CDP (rdzen-cdp.js). Zrzuty nie idą do repo —
// katalog domyślnie w %TEMP%. Ocena wyglądu należy do użytkownika.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, navigateAndWait, startChrome, startVite } from './rdzen-cdp.js';

const outDir = process.argv[2] || join(tmpdir(), 'budowle-portowe-shots');
const only = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

// Każdy zrzut: skrypt ustawiający scenę (API window.__port), potem kilka klatek.
// T = 34 s: Atlas w suchym doku, remont trwa (pętla doku 72 s).
const SHOTS = [
  { name: '01-galeria', js: '__port.setStyle("earth"); __port.view(1); __port.setTime(34);' },
  { name: '02-pochylnie', js: '__port.view(2); __port.setTime(34);' },
  { name: '03-etapy-budowy', js: '__port.view(3);' },
  { name: '04-suchy-dok-remont', js: '__port.view(4); __port.setTime(34); __port.setRoof("auto");' },
  { name: '05-suchy-dok-dach', js: '__port.view(4); __port.setTime(34); __port.setRoof("closed");', after: '__port.setRoof("auto");' },
  { name: '06-hangar-kolejka', js: '__port.view(5); __port.setPeak(true); __port.simulate(60);' },
  { name: '07-hangar-bebny', js: '__port.view(6);' },
  { name: '08-style-ringow', js: '__port.view(7);' },
  { name: '09-reda-ziemi', js: '__port.view(8);' },
  { name: '10-kino', js: '__port.view(9); __port.cine(-0.75, 0.6, 7800);' },
  { name: '11-mars-galeria', js: '__port.setStyle("mars"); __port.view(1); __port.setTime(34);' },
  { name: '12-mars-pochylnie', js: '__port.view(2);' },
  { name: '13-jowisz-galeria', js: '__port.setStyle("jupiter"); __port.view(1); __port.setTime(34);' },
  { name: '14-jowisz-hangar', js: '__port.view(6);', after: '__port.setStyle("earth");' }
];

const { server, base } = await startVite();
const chrome = await startChrome({ width: 1600, height: 900 });
const report = [];
try {
  const ok = await navigateAndWait(chrome.cdp, `${base}/dema/budowle-portowe.html?shot=1`, 'window.__port && window.__port.ready === true', 240000);
  if (!ok) throw new Error('demo nie wstało (timeout)');
  // shadery w trybie światła ringu (PB_LIGHT_HALO) — kompilacja bez rysowania ringu
  const halo = JSON.parse(await evaluate(chrome.cdp, 'JSON.stringify(__port.checkHaloShaders())'));
  report.push({ haloShaders: halo });
  console.log(`shadery ringu: ${halo.ok ? 'OK' : 'BŁĘDY'} (${halo.programs.length} materiałów)${halo.ok ? '' : '\n' + halo.newErrors.join('\n')}`);
  for (const s of SHOTS) {
    if (only.length && !only.some((o) => s.name.includes(o))) continue;
    await evaluate(chrome.cdp, `${s.js} __port.renderFrames(8); true`);
    // sprite'y ładują się asynchronicznie — kilka klatek po chwili
    await new Promise((r) => setTimeout(r, 300));
    await evaluate(chrome.cdp, '__port.renderFrames(4); true');
    const { data } = await chrome.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${s.name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const stats = await evaluate(chrome.cdp, 'JSON.stringify(__port.stats())');
    report.push({ shot: s.name, file, ...JSON.parse(stats) });
    if (s.after) await evaluate(chrome.cdp, `${s.after} true`);
  }
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ report, logs: chrome.logs }, null, 2));
  await chrome.close();
  await server.close();
}
for (const r of report.filter((v) => v.shot)) {
  console.log(`${r.shot}: draw ${r.calls}, tri ${Math.round((r.triangles || 0) / 1000)}k, proxy ${r.proxies?.drawn}, boje ${r.buoys?.drawn}, kolejka ${r.queue}, błędy ${r.errors.length}`);
}
console.log('zrzuty:', outDir);
