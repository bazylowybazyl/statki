// Zrzuty dema kontenerów i dronów (Z5): node dema/kontenery-shots.js [katalog] [nazwa…]
// Vite + headless Chrome przez CDP (rdzen-cdp.js). Zrzuty nie idą do repo —
// katalog domyślnie w %TEMP%. Ocena wyglądu należy do użytkownika.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, navigateAndWait, startChrome, startVite } from './rdzen-cdp.js';

const outDir = process.argv[2] || join(tmpdir(), 'kontenery-shots');
const only = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

// Każdy zrzut: skrypt ustawiający scenę (API window.__cargo), potem kilka klatek.
// T = 20 s: większość statków zatoki w środku rozładunku albo załadunku.
const SHOTS = [
  { name: '01-kontenerowiec-rozladunek', js: '__cargo.view(1); __cargo.setTime(20);' },
  { name: '02-grzebien-zatoki', js: '__cargo.view(2); __cargo.setTime(20);' },
  { name: '03-pas-mega', js: '__cargo.view(3); __cargo.setTime(20);' },
  { name: '04-plac-i-drony', js: '__cargo.view(4); __cargo.setTime(176);' },
  { name: '05-prom-i-ciezki', js: '__cargo.view(5); __cargo.setTime(20);' },
  { name: '06-kino', js: '__cargo.view(6); __cargo.setTime(20);' },
  { name: '07-maska-starego-sprite', js: '__cargo.view(1); __cargo.setTime(20); __cargo.setDeckMode("painted");', after: '__cargo.setDeckMode("empty");' },
  { name: '08-zblizenie-zaladunku', js: '__cargo.center("Z02-M02", 3.2, -20, 0); __cargo.setTime(27);' },
  { name: '09-noc', js: '__cargo.view(2); __cargo.setTime(20); __cargo.setSun(160, 49);', after: '__cargo.setSun(-25, 49);' },
  { name: '10-ciezki-zbiorniki', js: '__cargo.center("Z02-MG2", 0.5, 0, 0); __cargo.setTime(8);' },
  { name: '11-galeria', js: '__cargo.view(7); __cargo.setTime(20);' }
];

const { server, base } = await startVite();
const chrome = await startChrome({ width: 1600, height: 900 });
const report = [];
try {
  const ok = await navigateAndWait(chrome.cdp, `${base}/dema/kontenery.html?shot=1&quality=high`, 'window.__cargo && window.__cargo.ready === true', 240000);
  if (!ok) throw new Error('demo nie wstało (timeout)');
  for (const s of SHOTS) {
    if (only.length && !only.some((o) => s.name.includes(o))) continue;
    await evaluate(chrome.cdp, `${s.js} __cargo.renderFrames(6); true`);
    const { data } = await chrome.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${s.name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const stats = await evaluate(chrome.cdp, 'JSON.stringify({ s: __cargo.stats, npcs: __cargo.npcs() })');
    report.push({ shot: s.name, file, ...JSON.parse(stats) });
    if (s.after) await evaluate(chrome.cdp, `${s.after} true`);
  }
  // Paralaksa: rzut persp (pass BG, pokład portu) vs przeliczenie w passie ortho.
  const pc = await evaluate(chrome.cdp, `(() => { __cargo.center('Z02-L01', 2.2, 0, 0); __cargo.renderFrames(1);
    const out = [];
    for (const [dx, dy] of [[300, 150], [-320, 170], [310, -160], [-280, -150]]) for (const z of [-114.5, -60, 0]) out.push({ dx, dy, z, ...__cargo.parallaxCheck(dx, dy, z) });
    return JSON.stringify(out); })()`);
  let worst = 0;
  for (const p of JSON.parse(pc)) worst = Math.max(worst, Math.hypot(p.persp[0] - p.ortho[0], p.persp[1] - p.ortho[1]));
  report.push({ parallaxWorstPx: worst });
  console.log(`paralaksa: największa różnica persp/ortho ${worst.toFixed(3)} px`);
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ report, logs: chrome.logs }, null, 2));
  await chrome.close();
  await server.close();
}
for (const r of report) {
  if (!r.s) continue;
  const c = r.s.containers;
  console.log(`${r.shot}: draw ${r.s.calls}, kontenery ${c.deck}/${c.loose}/${c.yard}, cienie ${c.hullShadows}/${c.deckShadows}, drony ${r.s.drones.drones}, błędy ${r.s.errors.length}`);
}
console.log('zrzuty:', outDir);
