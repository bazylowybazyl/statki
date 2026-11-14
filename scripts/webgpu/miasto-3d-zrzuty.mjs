// Zrzuty dema MIASTA 3D na drednocie (dema/miasto-3d.html; opis docs/OPIS-miasto-3d.md). Jedna przeglądarka headless
// (w takcie monitora — bez setek klatek na sekundę), Vite z tego katalogu.
//
//   node scripts/webgpu/miasto-3d-zrzuty.mjs [--out .tmp/kreator/miasto-3d-v2] [--tylko id1,id2] [--w 1600 --h 900]
//        [--katalog 0|1|tylko] [--pomiar 0]
//
// --katalog 1 (domyślnie) — także arkusz KATALOGU WIEŻOWCÓW (?katalog=1: z góry, z ukosa i nisko; arkusz z góry + ukos
// w jednym PNG), --katalog tylko — sam katalog, --katalog 0 — bez.
// Wynik: PNG kadrów + raport.json (czasy generatora i wypieku, bryły, światła, pamięć, ms GPU na klatkę w każdym kadrze,
// pipeline'y synchroniczne — ma być 0, błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, parseArgs, repo } from './wspolne.mjs';
import { readPng, writePng } from './png.mjs';

const args = parseArgs();
const out = resolve(repo, String(args.out || '.tmp/kreator/miasto-3d-v2'));
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const SW = Number(args.w || 1600), SH = Number(args.h || 900);
mkdirSync(out, { recursive: true });

/** Kadry: widok (nazwa z dema albo obiekt), parametry miasta, słońce, światła. */
const KADRY = [
  { id: 'a1-drednot-caly', view: 'caly', opis: 'drednot cały z góry (kamera gry), miasto A, światła z góry — punkty' },
  { id: 'a2-drednot-caly-bez-miasta', view: 'caly', city: false, opis: 'ten sam kadr bez miasta (A/B)' },
  { id: 'a3-drednot-caly-poswiata', view: 'caly', glow: true, opis: 'drednot cały z góry, światła z góry — poświata' },
  { id: 'b1-pas-3600', view: 'row', opis: 'odsłonięty środek, kadr 3 600 j. z góry — punkty' },
  { id: 'b1g-pas-3600-poswiata', view: 'row', glow: true, opis: 'odsłonięty środek 3 600 j. — poświata' },
  { id: 'b2-zblizenie-1200', view: 'blisko', opis: 'zbliżenie 1 200 j. z góry — punkty' },
  { id: 'b2g-zblizenie-1200-poswiata', view: 'blisko', glow: true, opis: 'zbliżenie 1 200 j. z góry — poświata' },
  { id: 'b3-zblizenie-1200-bez-swiatel', view: 'blisko', lights: false, opis: 'zbliżenie 1 200 j., światła zgaszone' },
  { id: 'b4-klin-mostek-1200', view: { x: -1500, y: -150, zoom: SW / 1200 }, opis: 'klin pokładu, rdzenie i wieża mostka, 1 200 j. — punkty' },
  { id: 'b4g-klin-mostek-1200-poswiata', view: { x: -1500, y: -150, zoom: SW / 1200 }, glow: true, opis: 'klin, rdzenie, mostek 1 200 j. — poświata' },
  { id: 'b5-dziob-1200', view: { x: 1250, y: -60, zoom: SW / 1200 }, opis: 'grzbiety dziobowe, 1 200 j.' },
  { id: 'c1-ukos', view: 'ukos', opis: 'z ukosa jak kadr odniesienia (nisko z boku-rufy, wzdłuż środka)' },
  { id: 'c2-ukos-bez-swiatel', view: 'ukos', lights: false, opis: 'z ukosa, bez świateł' },
  { id: 'c3-nisko', view: 'nisko', opis: 'nisko wzdłuż środka' },
  { id: 'c4-od-dziobu', view: 'rufa', opis: 'z ukosa od dziobu (klin i mostek z przodu)' },
  { id: 'd-B-ukos', view: 'ukos', city: { variant: 'B' }, opis: 'kompozycja B (tarasy), z ukosa' },
  { id: 'd-C-ukos', view: 'ukos', city: { variant: 'C' }, opis: 'kompozycja C (skupiska wież), z ukosa' }
].filter((k) => !only || only.has(k.id) || only.has(k.id.split('-')[0])).filter(() => String(args.katalog) !== 'tylko');
const KATALOG = String(args.katalog ?? '1') !== '0' && (!only || only.has('katalog'));

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
    await ev(`window.__miasto.setTopGlow(${k.glow ? 'true' : 'false'})`);
    await ev(`window.__miasto.setView(${JSON.stringify(k.view)})`);
    await ev('window.__miasto.runFrames(12)');
    const st = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
    const file = join(out, `${k.id}.png`);
    await screenshotPng(cdp, file);
    raport.kadry[k.id] = { opis: k.opis, gpuMs: st.gpuMs, syncPipes: st.syncPipes, gen: st.gen, city: st.city };
    console.log('zrzut', k.id, 'GPU', st.gpuMs?.toFixed?.(2), 'sync', st.syncPipes);
  }
  raport.koniec = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
  if (String(args.pomiar ?? '1') !== '0' && KADRY.length) {
    // koszt GPU miasta: ten sam kadr z miastem i bez (średnia z 6 odczytów zegara GPU Core3D, po 10 klatek)
    await ev('window.__miasto.setCity({"variant":"A"})');
    await ev('window.__miasto.toggleLights(true)');
    await ev('window.__miasto.setTopGlow(false)');
    raport.pomiar = {};
    for (const view of ['caly', 'row', 'blisko', 'ukos']) {
      const r = {};
      for (const on of [true, false]) {
        await ev(`window.__miasto.toggleCity(${on})`);
        await ev(`window.__miasto.setView(${JSON.stringify(view)})`);
        await ev('window.__miasto.runFrames(20)');
        let sum = 0, n = 0;
        for (let q = 0; q < 6; q++) {
          await ev('window.__miasto.runFrames(10)');
          const g = await ev('window.Core3D.gpuFrameMs || 0');
          if (g > 0) { sum += g; n++; }
        }
        r[on ? 'zMiastem' : 'bezMiasta'] = n ? Math.round(sum / n * 1000) / 1000 : null;
      }
      r.miasto = r.zMiastem != null && r.bezMiasta != null ? Math.round((r.zMiastem - r.bezMiasta) * 1000) / 1000 : null;
      raport.pomiar[view] = r;
      console.log('pomiar GPU', view, JSON.stringify(r));
    }
    await ev('window.__miasto.toggleCity(true)');
  }
  if (KATALOG) {
    // katalog wieżowców: nowa strona w trybie ?katalog=1
    await cdp.send('Page.navigate', { url: `${vite.base}/dema/miasto-3d.html?test=1&clean=1&katalog=1` });
    if (!await waitFor(cdp, '!!(window.__miasto && (window.__miasto.ready || window.__miasto.error))', 300000, 500)) throw new Error('katalog nie wstał');
    await ev('window.__miasto.showLabels(true)');
    const files = [];
    for (const [id, view] of [['k1-katalog-z-gory', 'caly'], ['k2-katalog-z-ukosa', 'ukos'], ['k3-katalog-nisko', 'nisko']]) {
      await ev(`window.__miasto.setView(${JSON.stringify(view)})`);
      await ev('window.__miasto.runFrames(12)');
      const file = join(out, `${id}.png`);
      await screenshotPng(cdp, file);
      files.push(file);
      const st = await ev('JSON.stringify(window.__miasto.stats())').then(JSON.parse);
      raport.kadry[id] = { opis: `katalog wieżowców (${view})`, gpuMs: st.gpuMs, syncPipes: st.syncPipes, city: st.city };
      console.log('zrzut', id, 'sync', st.syncPipes);
    }
    // arkusz: z góry | z ukosa (połowa rozdzielczości każdy)
    const a = readPng(files[0]), b = readPng(files[1]);
    const half = (img) => {
      const w = img.width >> 1, h = img.height >> 1, d = new Uint8Array(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 4; c++) {
        const s0 = ((2 * j) * img.width + 2 * i) * 4 + c, s1 = s0 + 4, s2 = s0 + img.width * 4, s3 = s2 + 4;
        d[(j * w + i) * 4 + c] = (img.data[s0] + img.data[s1] + img.data[s2] + img.data[s3]) >> 2;
      }
      return { width: w, height: h, data: d };
    };
    const ha = half(a), hb = half(b);
    const sheet = { width: ha.width + hb.width, height: Math.max(ha.height, hb.height), data: null };
    sheet.data = new Uint8Array(sheet.width * sheet.height * 4);
    for (const [img, ox] of [[ha, 0], [hb, ha.width]]) {
      for (let j = 0; j < img.height; j++) sheet.data.set(img.data.subarray(j * img.width * 4, (j + 1) * img.width * 4), (j * sheet.width + ox) * 4);
    }
    writePng(join(out, 'k0-katalog-arkusz.png'), sheet);
  }
} catch (e) {
  console.error(e);
  raport.blad = String(e?.stack || e);
} finally {
  raport.bledy = logs.errors().slice(0, 60);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(raport, null, 2));
  await chrome.close();
  await vite.server.close();
}
