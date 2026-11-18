// Zrzuty planszy standardu ładunku (`dema/standard-ladunku.html`) — headless Chrome przez CDP, własny Vite 5461.
//
//   node scripts/webgpu/standard-ladunku-demo.mjs [--out .tmp/standard-ladunku] [--calosc 3200x1060] [--strefa 1600x900]
//        [--tylko calosc,ladunek,zestawy,statki,huta,atlas] [--panel 1]
//
// Kadr „całość” jest szeroki (plansza ma proporcje ok. 3 : 1), strefy — 16 : 9. `--panel 1` — dodatkowy kadr strony
// tak, jak ją widzi użytkownik (z paskiem widoków). Raport: raport.json (statystyki strony, błędy konsoli — ma być 0).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/standard-ladunku');
mkdirSync(out, { recursive: true });
const wh = (s, d) => String(s || d).split('x').map(Number);
const [WA, HA] = wh(args.calosc, '3200x1056');
const [WZ, HZ] = wh(args.strefa, '1600x900');
const only = args.tylko ? String(args.tylko).split(',') : null;

const { server, base } = await startVite(Number(args.port || 5461));
const chrome = await startChrome({ width: WA, height: HA, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const report = { zrzuty: {} };

async function open(w, h, query) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${base}/dema/standard-ladunku.html${query}` });
  const ok = await waitFor(cdp, 'window.__standard && (window.__standard.ready || window.__standard.errors.length > 0)', 60000);
  if (!ok) throw new Error('plansza nie wstała');
  const errs = await evaluate(cdp, 'window.__standard.errors');
  if (errs.length) throw new Error(`błąd strony: ${errs[0]}`);
}

try {
  await open(WA, HA, '?shot=1');
  const views = await evaluate(cdp, 'window.__standard.views()');
  const rects = await evaluate(cdp, 'window.__standard.rects()');
  for (let i = 0; i < views.length; i++) {
    const id = views[i];
    if (only && !only.includes(id)) continue;
    if (i > 0) {
      // kadr strefy w jej proporcjach (bez sąsiadów w tle): szerokość z --strefa, wysokość z proporcji pola
      const hz = Math.max(560, Math.min(1400, Math.round((WZ - 36) * rects[i].h / rects[i].w) + 36 + 64));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WZ, height: args.strefa ? HZ : hz, deviceScaleFactor: 1, mobile: false });
      await evaluate(cdp, 'new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))');
    }
    await evaluate(cdp, `window.__standard.view(${i})`);
    const file = `${String(i).padStart(2, '0')}-${id}.png`;
    await screenshotPng(cdp, join(out, file));
    const s = await evaluate(cdp, 'window.__standard.stats()');
    report.zrzuty[file] = { kadr: s.size, pxNaJ: s.ppu, podpisy: `${s.labelsDrawn}/${s.labels}`, wymiary: `${s.dimsDrawn}/${s.dims}`, obrazy: s.images, bledy: s.errors.length };
    report.kadluby = s.hulls;
    console.log(file, `${s.size[0]}×${s.size[1]}`, `${s.ppu} px/j.`, 'podpisy', `${s.labelsDrawn}/${s.labels}`, 'wymiary', `${s.dimsDrawn}/${s.dims}`);
  }
  if (args.panel) {
    await open(WZ, HZ, '');
    await screenshotPng(cdp, join(out, 'panel.png'));
  }
  report.bledy = logs.errors();
  console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 8).join('\n'));
} catch (err) {
  report.wyjatek = String(err && err.stack ? err.stack : err);
  report.bledy = logs.errors();
  console.error(report.wyjatek);
  console.error(report.bledy.slice(0, 12).join('\n'));
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
process.exit(report.bledy?.length || report.wyjatek ? 1 : 0);
