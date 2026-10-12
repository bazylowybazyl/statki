// Zrzuty dema komet (dema/komety-webgpu.html) w headless Chrome z GPU (CDP), klatki z zegarem ręcznym
// (?test=1 → __komety.runFrames): cała kometa, koma, jądro z bliska, najdalszy zoom gry, inne komety, aktywność
// przy rosnącej odległości od Słońca, pipeline'y synchroniczne, błędy konsoli.
//
//   node scripts/webgpu/komety-demo.mjs [--out .tmp/komety/demo] [--rozmiar 1600x900] [--tylko halley,hale-bopp]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/komety/demo');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5421));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };

async function shot(name, opis, frames = 3) {
  await ev(`window.__komety.runFrames(${frames}, 60)`);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev('window.__komety.stats()')) };
  delete report.zrzuty[name].jadra;
  console.log('zrzut', name.padEnd(26), JSON.stringify(report.zrzuty[name]));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/komety-webgpu.html?test=1` });
  if (!await waitFor(cdp, '!!(window.__komety && (window.__komety.ready || window.__komety.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__komety.error || null');
  if (err) throw new Error(`demo: ${err}`);
  report.jadra = await ev('window.__komety.stats().jadra');
  // trochę czasu, żeby dżety i włókna się rozwinęły
  await ev('window.__komety.runFrames(90, 60)');
  const want = (id) => !only || only.has(id);
  if (want('halley')) {
    await ev('window.__komety.select("halley")');
    await shot('00-halley-calosc', 'Kometa Halleya przy ~0,95 AU: cała (warkocz jonowy i pyłowy)');
    await ev('window.__komety.setView("coma")');
    await shot('01-halley-koma', 'Głowa: koma, dżety, nasada warkoczy');
    await ev('window.__komety.setView("nuc")');
    await shot('02-halley-jadro', 'Jądro z bliska: regolit, cień własny, dżety ze strony dziennej, ziarna');
    await ev('window.__komety.act(" ")');
    await ev('window.__komety.setView("far")');
    await shot('03-halley-najdalej', 'Najdalszy zoom gry (0,035)');
    await ev('window.__komety.act(" ")');
    for (const r of [2.0, 3.0, 4.2]) {
      await ev(`window.__komety.setR(${r})`);
      await ev('window.__komety.setView("all")');
      await shot(`04-halley-r${String(r).replace('.', '_')}`, `Halley przy ${r} AU — aktywność gaśnie`);
    }
    await ev('window.__komety.setR(0.95)');
  }
  if (want('hale-bopp')) {
    await ev('window.__komety.select("hale-bopp")');
    await shot('10-halebopp-calosc', 'Hale–Bopp przy ~1,24 AU: wielka kometa');
    await ev('window.__komety.setView("coma")');
    await shot('11-halebopp-koma', 'Hale–Bopp: koma i dżety');
    await ev('window.__komety.setView("nuc")');
    await shot('12-halebopp-jadro', 'Hale–Bopp: jądro 16 km');
  }
  if (want('67p')) {
    await ev('window.__komety.select("67p")');
    await shot('20-67p-calosc', '67P przy ~1,35 AU');
    await ev('window.__komety.setView("nuc")');
    await ev('window.__komety.act("o")');
    await shot('21-67p-jadro-obrys', '67P: dwa płaty, obrys kolizji');
    await ev('window.__komety.act("o")');
  }
  if (want('tempel-1')) {
    await ev('window.__komety.select("tempel-1")');
    await shot('30-tempel-jadro', 'Tempel 1 przy ~4,6 AU — uśpiona, samo jądro');
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
