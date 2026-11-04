// Zrzuty dema wyglądu KONTAKTU czujników (dema/kontakty-czujnikow.html) w headless Chrome z GPU (CDP), klatki
// z zegarem ręcznym (?test=1 → __kontakty.runFrames): porównanie 2 × 2, każda propozycja na planszy rozmiarów
// i w scenie „jak w grze”, dzisiejszy znacznik, daleki zoom (CIC), seria klatek (morfowanie), czas GPU propozycji,
// pipeline'y synchroniczne, błędy konsoli. Headless Chrome — nie uruchamiać, gdy użytkownik gra.
//
//   node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--rozmiar 1600x900]
//     [--tylko porownanie,echo,oblok,wir,roj,ruch,dzis] (część zrzutów — szybkie strojenie)
//     [--film 1] (klatki porównania co 0,1 s w skali 0,5 → <out>/film/NNN.png — do złożenia animacji)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/kontakty/demo');
mkdirSync(out, { recursive: true });
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const want = (k) => !only || only.has(k);

const { server, base } = await startVite(Number(args.port || 5433));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {}, gpu: {} };

async function shot(name, opis, frames = 3) {
  await ev(`window.__kontakty.runFrames(${frames}, 60)`);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev('window.__kontakty.stats()')) };
  console.log('zrzut', name.padEnd(28), JSON.stringify(report.zrzuty[name]));
}

// Czas GPU: mediana Core3D.gpuFrameMs z kolejnych próbek (zegar GPU próbkuje co kilka klatek).
async function gpuMedian(label, frames = 240) {
  const samples = await ev(`(async () => {
    const out = [];
    for (let i = 0; i < ${frames}; i++) {
      await window.__kontakty.runFrames(1, 60);
      const g = Number(window.Core3D.gpuFrameMs) || 0;
      if (g > 0 && (out.length === 0 || out[out.length - 1] !== g)) out.push(g);
    }
    return out;
  })()`);
  const s = samples.slice().sort((a, b) => a - b);
  report.gpu[label] = { mediana: s.length ? +s[s.length >> 1].toFixed(3) : null, probki: s.length };
  console.log('gpu', label.padEnd(24), JSON.stringify(report.gpu[label]));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kontakty-czujnikow.html?test=1` });
  if (!await waitFor(cdp, '!!(window.__kontakty && (window.__kontakty.ready || window.__kontakty.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kontakty.error || null');
  if (err) throw new Error(`demo: ${err}`);
  const run = (n) => ev(`window.__kontakty.runFrames(${n}, 60)`);
  const set = (o) => ev(`window.__kontakty.set(${JSON.stringify(o)})`);

  // porównanie 2 × 2 (rozbieg — kontakty wchodzą i płaty się rozchodzą)
  if (want('porownanie')) {
    await set({ variant: 'porownanie', clean: true });
    await run(300);
    await shot('00-porownanie', 'Cztery propozycje naraz: rozmiary, flota pięciu, para');
    await set({ clean: false });
    await shot('01-porownanie-panele', 'Porównanie z panelem i opisem');
    await set({ clean: true });
  }
  if (args.film) {
    // 48 klatek co 0,1 s czasu dema (6 klatek po 1/60 s) w skali 0,5 — morfowanie, wędrówka miejsca, para
    await set({ variant: 'porownanie', clean: true });
    await run(120);
    const dir = join(out, 'film');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 48; i++) {
      await run(6);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } });
      writeFileSync(join(dir, `${String(i).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
    }
    console.log('film: 48 klatek →', dir);
  }

  const styles = ['echo', 'oblok', 'wir', 'roj'];
  let k = 1;
  for (const st of styles) {
    if (!want(st)) { k++; continue; }
    await set({ variant: st, scene: 'plansza', clean: true });
    await run(240);
    await shot(`1${k}-${st}-plansza`, `${st}: plansza — rozmiary, niepewność, flota ×6, para`);
    await gpuMedian(`${st} plansza`);
    await set({ scene: 'gra' });
    await run(180);
    await shot(`2${k}-${st}-gra`, `${st}: jak w grze — Atlas, wzrok 18 km, kontakty dalej (niepewność z odległości)`);
    k++;
  }
  // morfowanie: trzy klatki ECHO i ROJU co 1,5 s (para w ruchu)
  for (const st of want('ruch') ? ['echo', 'roj'] : []) {
    await set({ variant: st, scene: 'plansza', clean: true });
    await run(120);
    for (let i = 0; i < 3; i++) {
      await shot(`3${st === 'echo' ? 1 : 2}-${st}-ruch-${i}`, `${st}: klatka ${i} (co 1,5 s)`, 90);
    }
  }
  if (want('dzis')) {
    await set({ variant: 'dzis', scene: 'plansza', clean: true });
    await run(60);
    await shot('40-dzis-plansza', 'Dzisiejszy znacznik prototypu na tej samej planszy');
    await set({ variant: 'echo', truth: true });
    await shot('41-echo-prawda', 'ECHO z prawdziwymi miejscami (krzyżyki) — niepewność widoczna');
    await set({ truth: false });
    await set({ variant: 'dzis', clean: false });
    await gpuMedian('bez kontaktów (dziś)');
  }
  report.koniec = await ev('window.__kontakty.stats()');
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('pipeline\'y sync:', report.koniec?.syncPipes, (report.koniec?.syncNames || []).join(' | '));
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
