// Zrzuty dema MIASTA 3D na drednocie (dema/miasto-3d.html; opis docs/OPIS-miasto-3d.md). Jedna przeglądarka headless
// (w takcie monitora — bez setek klatek na sekundę), Vite z tego katalogu.
//
//   node scripts/webgpu/miasto-3d-zrzuty.mjs [--out .tmp/kreator/miasto-3d] [--tylko id1,id2] [--w 1600 --h 900]
//        [--katalog 0] [--pomiar 0]
//
// Wynik: PNG kadrów + raport.json (czasy generatora i wypieku, bryły, światła, pamięć, ms GPU na klatkę w każdym kadrze,
// pipeline'y synchroniczne — ma być 0, błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, String(args.out || '.tmp/kreator/miasto-3d'));
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const SW = Number(args.w || 1600), SH = Number(args.h || 900);
mkdirSync(out, { recursive: true });

/** Kadry: widok (nazwa z dema albo obiekt), parametry miasta, słońce, światła. */
const KADRY = [
  { id: 'a1-drednot-caly', view: 'caly', opis: 'drednot cały z góry (kamera gry), miasto A' },
  { id: 'a2-drednot-caly-bez-miasta', view: 'caly', city: false, opis: 'ten sam kadr bez miasta (A/B)' },
  { id: 'b1-row-3600', view: 'row', opis: 'rów, kadr 3 600 j. z góry' },
  { id: 'b2-zblizenie-1200', view: 'blisko', opis: 'zbliżenie 1 200 j. z góry' },
  { id: 'b3-zblizenie-1200-bez-swiatel', view: 'blisko', lights: false, opis: 'zbliżenie 1 200 j., światła zgaszone' },
  { id: 'b4-dziob-1200', view: { x: 1300, y: -60, zoom: SW / 1200 }, opis: 'zwężenie ku dziobowi, 1 200 j.' },
  { id: 'c1-ukos', view: 'ukos', opis: 'z ukosa jak kadr odniesienia (nisko z boku-rufy, wzdłuż grzbietu)' },
  { id: 'c2-ukos-bez-swiatel', view: 'ukos', lights: false, opis: 'z ukosa, bez świateł' },
  { id: 'c3-nisko', view: 'nisko', opis: 'nisko wzdłuż grzbietu' },
  { id: 'c4-od-dziobu', view: 'rufa', opis: 'z ukosa od dziobu' },
  { id: 'd-B-ukos', view: 'ukos', city: { variant: 'B' }, opis: 'kompozycja B (tarasy), z ukosa' },
  { id: 'd-C-ukos', view: 'ukos', city: { variant: 'C' }, opis: 'kompozycja C (skupiska wież), z ukosa' },
  { id: 'd-B-row', view: 'row', city: { variant: 'B' }, opis: 'kompozycja B, rów 3 600 j.' },
  { id: 'd-C-row', view: 'row', city: { variant: 'C' }, opis: 'kompozycja C, rów 3 600 j.' }
].filter((k) => !only || only.has(k.id) || only.has(k.id.split('-')[0]));

const vite = await startVite(5441);
const chrome = await startChrome({ width: SW, height: SH, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const raport = { kadry: {}, bledy: [] };
try {
  await cdp.send('Page.navigate', { url: `${vite.base}/dema/miasto-3d.html?test=1&clean=1` });
  if (!await waitFor(cdp, '!!(window.__miasto && (window.__miasto.ready || window.__miasto.error))', 300000, 500)) throw new Error('demo nie wstało');
  const err = await ev('window.__miasto.error || null');
  if (err) throw new Error(`demo: ${err}`);
  raport.start = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
  console.log('start', JSON.stringify(raport.start.startup), JSON.stringify(raport.start.gen));
  let cityKey = 'A';
  for (const k of KADRY) {
    const want = { variant: 'A', ...(typeof k.city === 'object' ? k.city : {}) };
    const key = JSON.stringify(want);
    if (key !== cityKey) {
      await ev(`window.__miasto.setCity(${key})`);
      cityKey = key;
    }
    await ev(`window.__miasto.toggleCity(${k.city === false ? 'false' : 'true'})`);
    await ev(`window.__miasto.toggleLights(${k.lights === false ? 'false' : 'true'})`);
    await ev(`window.__miasto.setView(${JSON.stringify(k.view)})`);
    await ev('window.__miasto.runFrames(12)');
    const st = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
    const file = join(out, `${k.id}.png`);
    await screenshotPng(cdp, file);
    raport.kadry[k.id] = { opis: k.opis, gpuMs: st.gpuMs, syncPipes: st.syncPipes, gen: st.gen, city: st.city };
    console.log('zrzut', k.id, 'GPU', st.gpuMs?.toFixed?.(2), 'sync', st.syncPipes);
  }
  raport.koniec = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
} catch (e) {
  console.error(e);
  raport.blad = String(e?.stack || e);
} finally {
  raport.bledy = logs.errors().slice(0, 60);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(raport, null, 2));
  await chrome.close();
  await vite.server.close();
}
