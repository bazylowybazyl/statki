// Zrzuty MIASTA 3D w generatorze kadłubów (dema/kreator-kadluba-webgpu.html; opis docs/OPIS-miasto-3d.md): drednot
// z polem `city` w kamerze płaskiej i w perspektywie z góry, zbliżenia, panel „Miasto 3D” w Stoczni i w Warsztacie,
// preset bez miasta (Colossus). Jedna przeglądarka headless w takcie monitora, Vite z tego katalogu.
//
//   node scripts/webgpu/miasto-3d-kreator.mjs [--out .tmp/kreator/miasto-3d-v3/generator] [--w 1600 --h 900]
//        [--kamery plaska,perspektywa,gra] [--pochylenie 6] [--pochylenieZoom 0]
//
// --kamery — kamery widoku kreatora po kolei (domyślnie płaska i perspektywa); „gra” — widok gry z pochyleniem miasta
// (przesada --pochylenie, z oddaleniem albo stała — docs/OPIS-miasto-3d.md § 10); panele w ostatniej kamerze z listy.
//
// raport.json: czasy (budowa, miasto z workera), bryły i światła, pipeline'y synchroniczne (ma być 0), błędy konsoli.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, String(args.out || '.tmp/kreator/miasto-3d-v3/generator'));
const SW = Number(args.w || 1600), SH = Number(args.h || 900);
const KAMERY = String(args.kamery || 'plaska,perspektywa').split(',').filter((k) => ['plaska', 'perspektywa', 'gra'].includes(k));
const LEAN = { gain: args.pochylenie != null ? Number(args.pochylenie) : 6, byZoom: String(args.pochylenieZoom ?? '1') !== '0' };
mkdirSync(out, { recursive: true });

const vite = await startVite(5447);
const chrome = await startChrome({ width: SW, height: SH, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const raport = { kadry: {} };
const shot = async (id, opis) => {
  await ev('window.__kreator.runFrames(16, 60)');
  for (let q = 0; q < 30 && !(await ev('window.__kreator.stats().surfaceReady')); q++) await ev('window.__kreator.runFrames(4, 60)');
  await ev('window.__kreator.runFrames(6, 60)');
  await screenshotPng(cdp, join(out, `${id}.png`));
  const st = await ev('JSON.stringify({ s: window.__kreator.stats(), c: window.__kreator.city, gpu: window.Core3D.gpuFrameMs })').then(JSON.parse);
  raport.kadry[id] = { opis, syncPipes: st.s.syncPipes, syncNames: st.s.syncNames, city: st.c, gpuMs: st.gpu };
  console.log('zrzut', id, 'sync', st.s.syncPipes, 'miasto', st.c?.stats?.boxes ?? 0, 'GPU', st.gpu?.toFixed?.(2));
};
try {
  await cdp.send('Page.navigate', { url: `${vite.base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat&preset=dreadnought&kamera=plaska` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 300000, 500)) throw new Error('kreator nie wstał');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`kreator: ${err}`);
  await ev('window.__kreator.built()');
  const t0 = Date.now();
  await ev('window.__kreator.cityIdle(90000)');
  raport.miastoMs = Date.now() - t0;
  raport.start = await ev('JSON.stringify(window.__kreator.city)').then(JSON.parse);
  console.log('miasto', JSON.stringify(raport.start.gen));
  await ev('document.body.classList.add("clean")');
  const views = [
    ['g1-drednot-caly', -150, 0, Math.min(SW * 0.9 / 8000, SH * 0.9 / 3816), 'drednot cały'],
    ['g2-srodek-3600', -450, -60, SW / 3600, 'odsłonięty środek 3 600 j.'],
    ['g3-zblizenie-1200', 60, -170, SW / 1200, 'zbliżenie 1 200 j.'],
    ['g4-mostek-klin-1200', -1500, -150, SW / 1200, 'mostek główny, klin, rdzenie 1 200 j.']
  ];
  await ev(`window.__kreator.setLean(${LEAN.gain}, ${LEAN.byZoom})`);
  const camOpis = { plaska: 'płaska (ortho)', perspektywa: 'perspektywa z góry', gra: `widok gry, pochylenie ${LEAN.gain}× ${LEAN.byZoom ? 'z oddaleniem' : 'stałe'}` };
  const camId = { plaska: 'plaska', perspektywa: 'perspektywa', gra: `gra-${LEAN.gain}x-${LEAN.byZoom ? 'zoom' : 'stala'}` };
  for (const cam of KAMERY) {
    await ev(`window.__kreator.setCamMode(${JSON.stringify(cam)})`);
    for (const [id, x, y, z, opis] of views) {
      await ev(`window.__kreator.setCamera(${x}, ${y}, ${z})`);
      await shot(`${id}-${camId[cam]}`, `${opis}, kamera ${camOpis[cam]}`);
    }
  }
  // panele z sekcją „Miasto 3D”: Warsztat i Stocznia (zakładka Kształty)
  await ev('document.body.classList.remove("clean")');
  await ev(`window.__kreator.setCamera(-450, -60, ${SW / 3600})`);
  // przełącznik kamery i suwak pochylenia: obecne, przełączają tryb, panel przewinięty do nich
  raport.przyciski = await ev(`JSON.stringify((() => {
    const ids = ['btn-cam-flat', 'btn-cam-game', 'btn-cam-persp', 'inp-lean', 'btn-lean-zoom'];
    const r = { warsztat: Object.fromEntries(ids.map((id) => [id, !!document.getElementById(id)])) };
    document.getElementById('btn-cam-game')?.click();
    r.poKliku = window.__kreator.view?.camMode ?? null;
    window.__kreator.setCamMode(${JSON.stringify(KAMERY[KAMERY.length - 1])});
    document.getElementById('btn-cam-game')?.scrollIntoView({ block: 'center' });
    return r;
  })())`).then(JSON.parse);
  console.log('przyciski', JSON.stringify(raport.przyciski));
  await shot('p1-warsztat-panel', `Warsztat z sekcją „Miasto 3D”, kamera ${camOpis[KAMERY[KAMERY.length - 1]]}`);
  await ev('window.__kreator.setUi("stocznia")');
  await ev('window.__kreator.stocznia?.cat?.("ksztalty")');
  raport.przyciskiStocznia = await ev(`JSON.stringify((() => {
    const q = (s) => !!document.querySelector(s);
    const r = { plaska: q('[data-cam="plaska"]'), gra: q('[data-cam="gra"]'), perspektywa: q('[data-cam="perspektywa"]'), zoom: q('[data-leanzoom]'), suwak: q('[data-k="view:lean"]'),
      etykieta: document.querySelector('[data-v="view:lean"]')?.textContent ?? null, swiecenie: document.querySelector('[data-v="board:glow"]')?.textContent ?? null };
    document.querySelector('[data-cam="gra"]')?.scrollIntoView({ block: 'center' });
    return r;
  })())`).then(JSON.parse);
  console.log('stocznia', JSON.stringify(raport.przyciskiStocznia));
  await shot('p2-stocznia-panel', `Stocznia, zakładka Kształty: opcje pancerza, miasta i kamery, kamera ${camOpis[KAMERY[KAMERY.length - 1]]}`);
  // preset bez miasta
  await ev('window.__kreator.setUi("warsztat")');
  await ev('document.body.classList.add("clean")');
  await ev('window.__kreator.preset("colossus")');
  await ev('window.__kreator.built()');
  await ev('window.__kreator.cityIdle(30000)');
  await ev(`window.__kreator.setCamera(0, 0, ${SW * 0.9 / 2600})`);
  await shot(`g5-colossus-bez-miasta-${camId[KAMERY[KAMERY.length - 1]]}`, `Colossus (preset bez miasta), kamera ${camOpis[KAMERY[KAMERY.length - 1]]}`);
  raport.koniec = await ev('JSON.stringify({ s: window.__kreator.stats(), c: window.__kreator.city })').then(JSON.parse);
} catch (e) {
  console.error(e);
  raport.blad = String(e?.stack || e);
} finally {
  raport.bledy = logs.errors().slice(0, 40);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(raport, null, 2));
  await chrome.close();
  await vite.server.close();
}
