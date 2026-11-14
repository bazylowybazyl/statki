// Zrzuty MIASTA 3D w generatorze kadłubów (dema/kreator-kadluba-webgpu.html; opis docs/OPIS-miasto-3d.md): drednot
// z polem `city` w kamerze płaskiej i w perspektywie z góry, zbliżenia, panel „Miasto 3D” w Stoczni i w Warsztacie,
// preset bez miasta (Colossus). Jedna przeglądarka headless w takcie monitora, Vite z tego katalogu.
//
//   node scripts/webgpu/miasto-3d-kreator.mjs [--out .tmp/kreator/miasto-3d-v3/generator] [--w 1600 --h 900]
//
// raport.json: czasy (budowa, miasto z workera), bryły i światła, pipeline'y synchroniczne (ma być 0), błędy konsoli.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, String(args.out || '.tmp/kreator/miasto-3d-v3/generator'));
const SW = Number(args.w || 1600), SH = Number(args.h || 900);
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
  for (const persp of [false, true]) {
    await ev(`window.__kreator.setPersp(${persp})`);
    for (const [id, x, y, z, opis] of views) {
      await ev(`window.__kreator.setCamera(${x}, ${y}, ${z})`);
      await shot(`${id}-${persp ? 'perspektywa' : 'plaska'}`, `${opis}, kamera ${persp ? 'perspektywa z góry' : 'płaska (ortho)'}`);
    }
  }
  // panele z sekcją „Miasto 3D”: Warsztat i Stocznia (zakładka Kształty)
  await ev('document.body.classList.remove("clean")');
  await ev(`window.__kreator.setCamera(-450, -60, ${SW / 3600})`);
  await shot('p1-warsztat-panel', 'Warsztat z sekcją „Miasto 3D”, kamera perspektywa');
  await ev('window.__kreator.setUi("stocznia")');
  await ev('window.__kreator.stocznia?.cat?.("ksztalty")');
  await shot('p2-stocznia-panel', 'Stocznia, zakładka Kształty: opcje pancerza i miasta, kamera perspektywa');
  // preset bez miasta
  await ev('window.__kreator.setUi("warsztat")');
  await ev('document.body.classList.add("clean")');
  await ev('window.__kreator.preset("colossus")');
  await ev('window.__kreator.built()');
  await ev('window.__kreator.cityIdle(30000)');
  await ev(`window.__kreator.setCamera(0, 0, ${SW * 0.9 / 2600})`);
  await shot('g5-colossus-bez-miasta-perspektywa', 'Colossus (preset bez miasta), kamera perspektywa');
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
