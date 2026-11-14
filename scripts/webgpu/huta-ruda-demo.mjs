// Zrzuty dema „stanowisko rudy” huty (headless Chrome z GPU przez CDP, własny Vite na porcie 5457).
//
//   node scripts/webgpu/huta-ruda-demo.mjs [--out .tmp/huta/ruda/zrzuty] [--ruda 0,3] [--rozmiar 1600x900]
//        [--tylko start,ssawa,lot,odbior,kopiec,pusta,krater,rudy,panel] [--widok 3 --czas 38]  [--kod "wyrażenie JS przed zrzutem"]
//        [--query worker=0] (dopisek do adresu strony, np. symulacja na wątku strony) [--raport nazwa.json]
//
// Domyślnie: seria chwil z kryteriów odbioru SPEC (.tmp/huta/ruda/SPEC.md) dla każdej rudy z `--ruda`:
//   start  t = 0      cztery widoki (1: z góry, kadr obrócony — statek z lewej, piec z prawej; 2: ładownia; 3: kopiec;
//                     4: wylot) + zbliżenia z góry: zasiek, ładownia; kopiec z boku (kąt stoku)
//   ssawa  t ≈ 3 s    dzwon zagłębia się w ładunek; t ≈ 6 s — LEJ: widok 2, dzwon z boku nisko i z dwóch przeciwnych
//                     stron (ziarna wchodzą pod krawędź, nie przez ścianę), z góry w zbliżeniu i w widoku 1;
//                     t ≈ 9,3 s — lej do dna (dzwon domiata pole)
//   lot    t ≈ 12 s   cztery widoki; okna rury: pirs z góry (kadr z uwag użytkownika) i z ukosa, okno wysięgnika
//                     z góry i z ukosa, kanał zrzutowy z ukosa; lądowanie z góry
//   odbior t ≈ 21 s   krater nad zasuwami, ziarna na taśmie, wlot do pieca z góry (kadr z uwag użytkownika), z ukosa i nisko
//   kopiec t ≈ 40 s   cztery widoki, kopiec z boku, zasiek z góry
//   pusta  t ≈ 55 s   resztki (ziarna jadą po dnie do dzwonu); chwila opróżnienia — ładownia pusta do blach; t = 70 s — widok 1
//   krater t ≈ 88 s   statek odpłynął, piec bierze wsad: krater nad zasuwami bez strugi, osypujące się zbocza
//   rudy              pozostałe rudy na jednej stronie (przełączenie = nowy worker): t = 13 s, widoki 1, 3, 4 — barwa i kopiec
//   panel             strona z pętlą na żywo (worker w czasie rzeczywistym, panel) — klatki, ms kroku, GPU
// `--widok N --czas T` — jeden zrzut widoku N (1–4) w chwili T dla każdej rudy.
// Strona kroczy tylko przez API (`__ruda.simulate`, `renderFrames`) — bez czekania na rAF. Raport: raport.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
if (W > 1600 || H > 900) throw new Error('kadr najwyżej 1600 × 900');
const out = resolve(repo, args.out || '.tmp/huta/ruda/zrzuty');
mkdirSync(out, { recursive: true });
const ores = String(args.ruda === undefined ? '0,3' : args.ruda).split(',').map(Number).filter((n) => n >= 0 && n <= 4);
const only = args.tylko ? String(args.tylko).split(',') : null;
const want = (k) => !only || only.includes(k);
const ORE_ID = ['zelazo', 'miedz', 'glin', 'tytan', 'weglista'];

const { server, base } = await startVite(Number(args.port || 5457));
// takt: true — headless w takcie monitora, bez --disable-frame-rate-limit (praca przy komputerze użytkownika)
const chrome = await startChrome({ width: W, height: H, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { rozmiar: [W, H], rudy: {}, zrzuty: {} };

async function open(query) {
  await cdp.send('Page.navigate', { url: `${base}/dema/huta-ruda.html?${query}` });
  const ok = await waitFor(cdp, 'window.__ruda && (window.__ruda.ready || window.__ruda.errors.length > 0)', 240000);
  if (!ok) throw new Error('demo nie wstało');
  const errs = await ev('window.__ruda.errors');
  if (errs.length) throw new Error(`błąd strony: ${errs[0]}`);
  // sprite i mapy powierzchni statku (proxy ruchu) wczytują się w tle — czas ściany, nie klatki
  if (query.includes('shot=1')) for (let k = 0; k < 10; k++) { await ev('window.__ruda.renderFrames(2)'); await sleep(450); }
}

async function shot(name, frames = 3) {
  if (args.kod) await ev(String(args.kod));
  await ev(`window.__ruda.renderFrames(${frames})`);
  const file = `${name}.png`;
  await screenshotPng(cdp, join(out, file));
  const s = await ev('window.__ruda.stats()');
  report.zrzuty[file] = {
    czas: +s.time.toFixed(2), statek: s.ship, tony: Object.fromEntries(Object.entries(s.tons).map(([k, v]) => [k, +v.toFixed(1)])), bilans: s.balance,
    ruchome: s.sim.moving, ssane: s.grains.suction, rysunki: s.calls, trojkaty: s.triangles, syncPoStarcie: s.pipelines.syncAfterReady, lod: s.image?.lodFar ? 'daleko' : 'blisko', bledy: s.errors.length
  };
  console.log(file, `t=${s.time.toFixed(1)}s`, s.ship, JSON.stringify(report.zrzuty[file].tony), 'ruchome', s.sim.moving, 'ssane', s.grains.suction, 'rys.', s.calls, 'sync po starcie', s.pipelines.syncAfterReady);
  return s;
}
// kamera z góry (kadr obrócony jak widok 1): środek (x, z) stanowiska, zoom [px / j.]
const top = (x, z, zoom) => ev(`window.__ruda.camera(${x}, ${z}, ${zoom})`);
const view = (i) => ev(`window.__ruda.view(${i})`);
// kamera z ukosa: az — skąd patrzy (od +x ku +z), el — nad poziomem, odległość, cel (x, y, z); follow — za dzwonem
const cine = (az, el, dist, x, y, z, follow = false) => ev(`window.__ruda.cine(${az}, ${el}, ${dist}, ${x}, ${y}, ${z}, ${follow})`);
const bell = () => ev('(() => { const s = window.__ruda.stats(); return [s.trolleyX, s.gantryZ]; })()');
let simT = 0;
async function advanceTo(t) {
  if (t <= simT) return null;
  const r = await ev(`window.__ruda.simulate(${t - simT})`);
  simT = t;
  return r;
}
// kopiec z boku (kamera w zasieku, nisko): kąt stoku na tle muru
const pileSide = () => cine(0.42, 0.07, 660, 50, -75, 10546);
// cztery widoki dema w bieżącej chwili
async function fourViews(prefix) {
  for (const v of [1, 2, 3, 4]) { await view(v); await shot(`${prefix}-w${v}`); }
}

try {
  for (const ore of ores) {
    const id = ORE_ID[ore];
    await open(`shot=1&ruda=${ore}${args.query ? `&${args.query}` : ''}`);
    simT = 0;
    const R = report.rudy[id] = { kroki: [] };
    const note = (r) => { if (r) R.kroki.push({ do: simT, kroki: r.steps, msKroku: +r.stepMs.toFixed(3), msMaks: +r.stepMax.toFixed(2), msRazem: Math.round(r.ms) }); };

    if (args.widok && args.czas !== undefined) {
      note(await advanceTo(Number(args.czas)));
      await view(Number(args.widok));
      await shot(`${id}-widok${args.widok}-t${args.czas}`);
      continue;
    }
    if (want('start')) {
      await fourViews(`${id}-00`);
      await top(0, 10525, 0.86);
      await shot(`${id}-00-zasiek-gora`);
      await top(0, 12659, 2.2);
      await shot(`${id}-00-ladownia-gora`);
      await pileSide();
      await shot(`${id}-00-kopiec-bok`);
    }
    if (want('ssawa')) {
      note(await advanceTo(3.0));
      await view(2);
      await shot(`${id}-03-w2`);
      note(await advanceTo(6.0));
      await view(2);
      await shot(`${id}-06-w2`);
      // dzwon z boku (znad ładunku, od rufy), z bliska i z przeciwnej strony: ziarna wchodzą pod krawędź, nie przez
      // ścianę dzwonu i węża (ładownia jest głęboka — kamery stoją nad lukiem)
      await cine(Math.PI / 2, 0.42, 150, 'undefined', 108, 'undefined', true);
      await shot(`${id}-06-dzwon-bok`);
      await cine(2.45, 0.85, 120, 'undefined', 104, 'undefined', true);
      await shot(`${id}-06-dzwon-blisko`);
      await cine(2.45 + Math.PI, 0.9, 150, 'undefined', 104, 'undefined', true);
      await shot(`${id}-06-dzwon-przeciwnie`);
      let b = await bell();
      await top(b[0], b[1], 2.2);
      await shot(`${id}-06-dzwon-gora`);
      await view(1);
      await shot(`${id}-06-w1`);
      note(await advanceTo(9.3));
      await view(2);
      await shot(`${id}-09-w2`);
      await cine(2.2, 0.9, 210, 'undefined', 100, 'undefined', true);
      await shot(`${id}-09-lej-z-wysoka`);
      b = await bell();
      await top(b[0], b[1], 2.6);
      await shot(`${id}-09-lej-gora`);
    }
    if (want('lot')) {
      note(await advanceTo(12));
      await fourViews(`${id}-12`);
      // okna rury: kadr z uwag użytkownika (pirs z góry), to samo z ukosa; okno wysięgnika; kanał zrzutowy
      await top(480, 11590, 4.6);
      await shot(`${id}-12-okno-rury-gora`);
      await cine(0.5, 0.5, 240, 480, 190, 11590);
      await shot(`${id}-12-okno-rury-ukos`);
      const b = await bell();
      await top(300, b[1], 4.2);
      await shot(`${id}-12-okno-wysiegnika-gora`);
      await cine(1.9, 0.38, 230, 300, 446, b[1]);
      await shot(`${id}-12-okno-wysiegnika-ukos`);
      await cine(2.6, 0.4, 420, 330, 250, 10960);
      await shot(`${id}-12-kanal-ukos`);
      await top(330, 11060, 1.9);
      await shot(`${id}-12-kanal-gora`);
      await top(100, 10640, 1.3);
      await shot(`${id}-12-ladowanie-gora`);
    }
    if (want('odbior')) {
      note(await advanceTo(21));
      await cine(1.25, 0.62, 520, 60, -110, 10546);
      await shot(`${id}-21-krater`);
      await cine(2.2, 0.5, 560, -520, -40, 10420);
      await shot(`${id}-21-tasma`);
      await top(-560, 9965, 2.8);
      await shot(`${id}-21-wlot-pieca-gora`);
      await cine(1.25, 0.42, 330, -560, 290, 9950);
      await shot(`${id}-21-wlot-pieca-ukos`);
      await cine(1.25, 0.16, 300, -560, 290, 9950);
      await shot(`${id}-21-wlot-pieca-nisko`);
      await top(0, 10525, 0.86);
      await shot(`${id}-21-zasiek-gora`);
    }
    if (want('kopiec')) {
      note(await advanceTo(40));
      await fourViews(`${id}-40`);
      await pileSide();
      await shot(`${id}-40-kopiec-bok`);
      await top(0, 10525, 0.86);
      await shot(`${id}-40-zasiek-gora`);
      await top(0, 12659, 2.2);
      await shot(`${id}-40-ladownia-gora`);
    }
    if (want('pusta')) {
      // resztki: dzwon stoi, ziarna jadą do niego po dnie
      note(await advanceTo(54.5));
      await view(2);
      await shot(`${id}-54-resztki-w2`);
      await top(0, 12659, 2.2);
      await shot(`${id}-54-resztki-gora`);
      for (let k = 0; k < 60; k++) {
        const q = await ev('(() => { const s = window.__ruda.stats(); return s.grains.hold + s.grains.suction; })()');
        if (q === 0) break;
        note(await advanceTo(simT + 0.5));
      }
      await top(0, 12659, 2.2);
      const s = await shot(`${id}-61-ladownia-pusta-gora`);
      await cine(2.45, 0.7, 420, 0, 100, 12660);
      await shot(`${id}-61-ladownia-pusta-ukos`);
      R.rozladunek = { czas: +s.unloadTime.toFixed(1), ladownia: s.grains.hold + s.grains.suction, bilans: s.balance };
      note(await advanceTo(Math.max(72, simT)));
      await view(1);
      await shot(`${id}-72-w1`);
    }
    if (want('krater')) {
      note(await advanceTo(88));
      await cine(1.25, 0.72, 430, 60, -100, 10546);
      await shot(`${id}-88-krater`);
      await top(60, 10546, 1.6);
      await shot(`${id}-88-krater-gora`);
      await view(3);
      await shot(`${id}-88-w3`);
    }
    const s = await ev('window.__ruda.stats()');
    R.koniec = { czas: +s.time.toFixed(1), bilans: s.balance, tony: s.tons, pipeline: s.pipelines, obraz: s.image, pyl: s.dust, initMs: Math.round(s.sim.initMs), msMigawki: +s.sim.snapMs.toFixed(3), msWpisu: +s.sim.applyMs.toFixed(3), zgubioneMigawki: s.sim.lost };

    if (want('rudy') && ore === ores[ores.length - 1]) {
      // pozostałe rudy na tej samej stronie: przełączenie rudy = nowe stanowisko w nowym workerze
      for (const i of [1, 2, 4].filter((q) => !ores.includes(q))) {
        await ev(`window.__ruda.ore(${i})`);
        for (let k = 0; k < 3; k++) { await ev('window.__ruda.renderFrames(2)'); await sleep(200); }
        simT = 0;
        await advanceTo(13);
        for (const v of [1, 3, 4]) { await view(v); await shot(`rudy-${ORE_ID[i]}-13-w${v}`); }
      }
    }
  }

  if (want('panel') && !(args.widok && args.czas !== undefined)) {
    // Jak u użytkownika: pętla rAF, worker w czasie rzeczywistym, panel. Krótko: ~12 s.
    await open(`ruda=${ores[0] ?? 0}`);
    await sleep(5000);
    await screenshotPng(cdp, join(out, 'panel-widok1.png'));
    const a = await ev('window.__ruda.stats()');
    await view(4);
    await sleep(2500);
    await screenshotPng(cdp, join(out, 'panel-widok4.png'));
    const b = await ev('window.__ruda.stats()');
    await view(2);
    await sleep(2500);
    await screenshotPng(cdp, join(out, 'panel-widok2.png'));
    const c = await ev('window.__ruda.stats()');
    await view(3);
    await sleep(2000);
    await screenshotPng(cdp, join(out, 'panel-widok3.png'));
    const d = await ev('window.__ruda.stats()');
    const pick = (s) => ({
      czas: +s.time.toFixed(1), rysunki: s.calls, trojkaty: s.triangles, msKroku: +s.sim.stepMs.toFixed(3), msKrokuSzczyt: +s.sim.stepMax.toFixed(2),
      msMigawki: +s.sim.snapMs.toFixed(3), msWpisu: +s.sim.applyMs.toFixed(3), kolejka: s.sim.queue, zgubione: s.sim.lost, gpuMs: +(+s.gpuMs).toFixed(2), syncPrzyStarcie: s.pipelines.syncList, syncPoStarcie: s.pipelines.syncAfterReady, syncPoStarcieLista: s.pipelines.syncAfterReadyList, ruchome: s.sim.moving, bilans: s.balance, worker: s.worker, naZywo: s.live
    });
    const fps = await ev('window.__ruda.state.fps');
    report.naZywo = { widok1: pick(a), widok4: pick(b), widok2: pick(c), widok3: pick(d), klatkiNaSekunde: Math.round(fps), bledyStrony: await ev('window.__ruda.errors') };
    console.log('na żywo:', JSON.stringify(report.naZywo));
  }
  report.bledy = logs.errors();
  report.logi = logs.all().filter((l) => !l.startsWith('[log:')).slice(-30);
  console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 8).join('\n'));
} catch (err) {
  report.wyjatek = String(err && err.stack ? err.stack : err);
  report.bledy = logs.errors();
  console.error(report.wyjatek);
  console.error(report.bledy.slice(0, 12).join('\n'));
} finally {
  writeFileSync(join(out, args.raport || 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
process.exit(report.bledy?.length || report.wyjatek ? 1 : 0);
