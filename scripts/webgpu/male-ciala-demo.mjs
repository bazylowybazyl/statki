// Zrzuty dema planet (dema/planety-webgpu.html) dla MAŁYCH CIAŁ (src/data/smallBodies.js): każde ciało na globie
// (pora 35° — dzień z terminatorem, miejsce 0 przed kamerą) i nocą (pora 150°), plus mapa dnia płasko.
//
//   node scripts/webgpu/male-ciala-demo.mjs [--out .tmp/ciala/demo] [--ciala ceres,westa]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/ciala/demo');
const BODIES = String(args.ciala || 'ceres,westa,pallas,hygiea,psyche,pluton,charon').split(',');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5402));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: [] };
const settle = () => new Promise((r) => setTimeout(r, 1800));
try {
  for (const id of BODIES) {
    for (const [tag, pora] of [['dzien', 35], ['noc', 150]]) {
      await cdp.send('Page.navigate', { url: `${base}/dema/planety-webgpu.html?test=1&cialo=${id}&miejsce=0&pora=${pora}&odl=2.6` });
      if (!await waitFor(cdp, '!!(window.__planety && window.__planety.ready())', 240000, 400)) throw new Error(`demo nie wstało: ${id}`);
      await settle();
      await screenshotPng(cdp, join(out, `${id}-${tag}.png`));
      report.zrzuty.push(`${id}-${tag}`);
    }
    await cdp.send('Page.navigate', { url: `${base}/dema/planety-webgpu.html?test=1&cialo=${id}&widok=mapa` });
    await waitFor(cdp, '!!(window.__planety && window.__planety.ready())', 240000, 400);
    await settle();
    await screenshotPng(cdp, join(out, `${id}-mapa.png`));
    console.log('zrzuty', id);
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
console.log('wynik →', out, JSON.stringify(report));
process.exit(report.blad ? 1 : 0);
