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
// advance(s) — czas budowli i roju (drony w różnych fazach), simulate(s) — ruch dema.
const SHOTS = [
  { name: '01-galeria', js: '__port.setStyle("earth"); __port.view(1); __port.advance(20);' },
  { name: '02-pochylnie-roj', js: '__port.view(2); __port.advance(14);' },
  { name: '03-pochylnia-zblizenie', js: '__port.hub("yard", -1240, 2750, 0.72); __port.advance(9);' },
  { name: '04-etapy-budowy', js: '__port.view(3); __port.advance(12);' },
  { name: '05-piasta-postoj-refit', js: '__port.view(4); __port.advance(24);' },
  { name: '06-refit-atlasa', js: '__port.hub("yard", 0, 8700, 0.3); __port.advance(30);' },
  { name: '07-taśma-zlacze', js: '__port.hub("yard", 0, 700, 0.55); __port.advance(6);' },
  { name: '08-zejscie-na-plac', js: '__port.view(1); __port.simulate(150); __port.hub("yard", 400, 5400, 0.13); __port.advance(4);' },
  { name: '09-stocznie-frakcji', js: '__port.view(7); __port.advance(10);' },
  { name: '10-hangar-kolejka', js: '__port.view(5); __port.setPeak(true); __port.simulate(60);' },
  { name: '11-hangar-bebny', js: '__port.view(6);' },
  { name: '12-reda-ziemi', js: '__port.view(8);' },
  { name: '13-kino', js: '__port.view(9); __port.cine(-0.75, 0.6, 7800); __port.advance(10);' },
  { name: '14-mars-galeria', js: '__port.setStyle("mars"); __port.view(1); __port.advance(20);' },
  { name: '15-mars-piasta', js: '__port.view(4); __port.advance(20);' },
  { name: '16-jowisz-piasta', js: '__port.setStyle("jupiter"); __port.view(4); __port.advance(20);', after: '__port.setStyle("earth");' }
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
  console.log(`${r.shot}: draw ${r.calls}, tri ${Math.round((r.triangles || 0) / 1000)}k, proxy ${r.proxies?.drawn}, drony ${r.cargo?.drones}/${r.swarm?.drones} (w pracy ${r.swarm?.active}), boje ${r.buoys?.drawn}, błędy ${r.errors.length}`);
}
console.log('zrzuty:', outDir);
