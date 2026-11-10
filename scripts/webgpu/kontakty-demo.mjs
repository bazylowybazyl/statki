// Zrzuty dema wyglądu KONTAKTU czujników (dema/kontakty-czujnikow.html) w headless Chrome z GPU (CDP), klatki
// z zegarem ręcznym (?test=1 → __kontakty.runFrames): porównanie 2 × 2, każda propozycja na planszy rozmiarów
// i w scenie „jak w grze”, dzisiejszy znacznik, daleki zoom (CIC), seria klatek (morfowanie), czas GPU propozycji,
// pipeline'y synchroniczne, błędy konsoli. Headless Chrome — nie uruchamiać, gdy użytkownik gra.
//
//   node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--rozmiar 1600x900]
//     [--tylko porownanie,echo,oblok,wir,roj,iksy,ruch,dzis,namiar,namiar-szybko,granica] (część zrzutów — szybkie strojenie)
//     [--film-iksy 1] (klatki 60 kl/s obłoku X-ów na planszy, 6 s, skala 0,75 → <out>/film-iksy/)
//     [--film 1] (klatki porównania kontaktów co 0,1 s w skali 0,5 → <out>/film/NNN.png — do animacji)
//     [--film-namiar 1|misja|uklad|przelot|zblizenie] (klatki 60 kl/s czujki: <out>/film-<scena>/ — pełna pętla sceny
//        w skali 0,75; <out>/film-zblizenie/ — struna przy Atlasie w misji 1, piksel w piksel; czas: kilka minut)
//     [--film-granica 1|tafla|zblizenie|objawienie] (granica wykrycia, scena GRANICA 29 s, 60 kl/s: pełna pętla tafli
//        w skali 0,75 → <out>/film-granica-tafla/; zbliżenie — kadr 15 km przy Atlasie, 7,5–16 s; objawienie i utrata —
//        kamera na patrolu, kadr 20 km; piksel w piksel)
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
// scena GRANICA w kadrze 15 km: okręt w kadrze (kamera jedzie za nim z przesunięciem 8 km w stronę patrolu)
const GRANICA_BLISKO = { kadrKm: 15, off: [-6500, 2200] };
const GRANICA_CLIP = { x: 300, y: 230, width: 820, height: 440, scale: 1 };
// objawienie: kamera stoi na patrolu (kadr 20 km)
const GRANICA_PATROL = { kadrKm: 20, camFix: [0, 300] };
const PATROL_CLIP = { x: 480, y: 230, width: 640, height: 440, scale: 1 };

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

  const styles = ['echo', 'oblok', 'wir', 'roj', 'iksy'];
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
  // NAMIAR (tryb W) — CZUJKA na PPM: chwile scen MISJA 1, UKŁAD, PRZELOT; struna i błona osobno; wachlarz z 2. rundy
  if (want('namiar') || want('namiar-szybko')) {
    const quick = !want('namiar');
    const SHOTS = {
      misja: [[1.8, 'lewo-pusto'], [5.0, 'patrol'], [7.6, 'baza-wykryli'], [9.9, 'odjazd']],
      uklad: [[2.5, 'start'], [8.0, 'planeta-blisko'], [12.0, 'stacja']],
      przelot: [[4.0, 'daleko'], [8.3, 'wykryli'], [13.5, 'cicha'], [19.0, 'ciag']]
    };
    let k = 1;
    for (const [scene, list] of Object.entries(SHOTS)) {
      if (quick && scene === 'przelot') continue;
      await set({ mode: 'namiar', variant: 'czujka', scene, time: 0, clean: true, labels: true });
      let now = 0;
      for (const [tm, name] of list) {
        await run(Math.round((tm - now) * 60));
        now = tm;
        await shot(`8${k}-czujka-${scene}-${name}`, `Czujka, ${scene}, t = ${tm} s: ${name}`, 1);
      }
      if (!quick && scene === 'misja') {
        await set({ time: 0 });
        await run(Math.round(7.0 * 60));
        await gpuMedian('czujka misja');
      }
      k++;
    }
    for (const [st, scene, tm] of [['struna', 'misja', 7.6], ['blona', 'uklad', 8.0], ['wachlarz', 'misja', 7.6]]) {
      await set({ mode: 'namiar', variant: st, scene, time: 0, clean: true });
      await run(Math.round(tm * 60));
      await shot(`9${k}-${st}-${scene}`, `${st} osobno, ${scene}, t = ${tm} s`, 1);
      k++;
    }
    await set({ mode: 'kontakty' });
  }
  // GRANICA WYKRYCIA (czwarta runda): wybrana TAFLA — dwa poziomy (szara KONTAKTU, czerwona WZROKU) i objawienie kontaktu;
  // przybój i podświetlenie (odrzucone) — po jednym ujęciu do porównania
  if (want('granica')) {
    const SHOTS = [[5.0, 'kontakt-xy'], [7.9, 'objawienie'], [8.75, 'szara-przejscie'], [9.3, 'szara-obieg'],
      [12.0, 'maja-kontakt'], [13.95, 'cisza-szara-cofa'], [14.8, 'wzrok-przejscie'], [18.5, 'w-ich-wzroku'],
      [21.6, 'szara-wraca'], [22.2, 'wyjscie-ze-wzroku'], [24.8, 'wyjscie-z-kontaktu'], [27.2, 'utrata-wzroku']];
    await set({ mode: 'namiar', variant: 'tafla', scene: 'granica', time: 0, clean: true, labels: true });
    let now = 0;
    for (let i = 0; i < SHOTS.length; i++) {
      const [tm, name] = SHOTS[i];
      await run(Math.round((tm - now) * 60));
      now = tm;
      await shot(`6${String(i).padStart(2, '0')}-tafla-${name}`, `tafla, granica, t = ${tm} s: ${name}`, 1);
    }
    await set({ time: 0 });
    await run(Math.round(12 * 60));
    await gpuMedian('tafla, mają kontakt', 120);
    await set({ time: 0 });
    await run(Math.round(18 * 60));
    await gpuMedian('tafla, w ich wzroku', 120);
    let k = 0;
    for (const [tm, name, opts] of [[8.7, 'blisko-szara-przejscie', GRANICA_BLISKO], [14.75, 'blisko-wzrok-przejscie', GRANICA_BLISKO],
      [7.85, 'objawienie-patrol', GRANICA_PATROL], [26.95, 'utrata-patrol', GRANICA_PATROL]]) {
      await set({ mode: 'namiar', variant: 'tafla', scene: 'granica', time: 0, clean: true, labels: true });
      await set(opts);
      await run(Math.round(tm * 60));
      await shot(`7${k}-tafla-${name}`, `tafla, t = ${tm} s: ${name}`, 1);
      k++;
    }
    await set({ kadrKm: 0, camFix: null });
    for (const [st, tm] of [['przyboj', 12.0], ['swiatlo', 18.5]]) {
      await set({ mode: 'namiar', variant: st, scene: 'granica', time: 0, clean: true, labels: true });
      await run(Math.round(tm * 60));
      await shot(`8${k}-${st}-odrzucony`, `${st} (odrzucony), t = ${tm} s`, 1);
      k++;
    }
    await set({ mode: 'kontakty' });
  }
  if (args['film-granica']) {
    const fg = String(args['film-granica']);
    const film = async (dir, frames, clip) => {
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < frames; i++) {
        await run(1);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
        writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
      }
    };
    if (fg === '1' || fg === 'tafla') {
      await set({ mode: 'namiar', variant: 'tafla', scene: 'granica', time: 0, clean: true, labels: true });
      await film(join(out, 'film-granica-tafla'), 29 * 60, { x: 0, y: 0, width: W, height: H, scale: 0.75 });
      console.log('film granica tafla');
    }
    if (fg === '1' || fg === 'zblizenie') {
      // kadłub w kadrze 15 km: szara granica przechodzi przez Atlasa („?”), cisza ją cofa, wejście w ich wzrok („!”)
      await set({ mode: 'namiar', variant: 'tafla', scene: 'granica', time: 0, clean: true, labels: true });
      await set(GRANICA_BLISKO);
      await run(Math.round(7.5 * 60));
      await film(join(out, 'film-granica-zblizenie-tafla'), Math.round(8.5 * 60), GRANICA_CLIP);
      console.log('film granica zbliżenie');
    }
    if (fg === '1' || fg === 'objawienie') {
      // patrol w kadrze 20 km (kamera na patrolu): obłok X-ów zwija się w kadłuby (7,6 s), kadłuby rozsypują się (26,6 s)
      for (const [t0, len, name] of [[6.9, 2.1, 'objawienie'], [25.9, 2.1, 'utrata']]) {
        await set({ mode: 'namiar', variant: 'tafla', scene: 'granica', time: 0, clean: true, labels: true });
        await set(GRANICA_PATROL);
        await run(Math.round(t0 * 60));
        await film(join(out, `film-granica-${name}`), Math.round(len * 60), PATROL_CLIP);
        console.log('film granica', name);
      }
    }
    await set({ kadrKm: 0, camFix: null });
    await set({ mode: 'kontakty' });
  }
  if (args['film-iksy']) {
    await set({ mode: 'kontakty', variant: 'iksy', scene: 'plansza', clean: true, labels: true });
    await run(120);
    const dir = join(out, 'film-iksy');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 360; i++) {
      await run(1);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 0.75 } });
      writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
    }
    console.log('film iksy');
  }
  if (args['film-namiar']) {
    const fn = String(args['film-namiar']);
    const PER = { misja: 13, uklad: 16, przelot: 27 };
    for (const scene of ['misja', 'uklad', 'przelot']) {
      if (fn !== '1' && fn !== scene) continue;
      await set({ mode: 'namiar', variant: 'czujka', scene, time: 0, clean: true, labels: true });
      const dir = join(out, `film-${scene}`);
      mkdirSync(dir, { recursive: true });
      const clip = { x: 0, y: 0, width: W, height: H, scale: 0.75 };
      for (let i = 0; i < PER[scene] * 60; i++) {
        await run(1);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
        writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
      }
      console.log('film', scene);
    }
    if (fn === '1' || fn === 'zblizenie') {
      // struna przy Atlasie w misji 1 (4–9,6 s: patrol, baza), piksel w piksel
      await set({ mode: 'namiar', variant: 'czujka', scene: 'misja', time: 0, clean: true, labels: true });
      await run(4 * 60);
      const dz = join(out, 'film-zblizenie');
      mkdirSync(dz, { recursive: true });
      const clipZ = { x: 180, y: 310, width: 700, height: 420, scale: 1 };
      for (let i = 0; i < Math.round(5.6 * 60); i++) {
        await run(1);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: clipZ });
        writeFileSync(join(dz, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
      }
      console.log('film zbliżenie');
    }
    await set({ mode: 'kontakty' });
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
