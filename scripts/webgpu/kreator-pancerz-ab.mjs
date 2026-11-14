// A/B CIĄGŁEGO PANCERZA (pole projektu `shell`, src/game/hullDesign/hullDesignShell.js) z prawdziwego kompozytora (demo
// kreatora w headless Chrome, jedna przeglądarka, kadry po kolei): drednot STARY (plik sprzed skorupy — z historii
// gita, płyty z klocków) i NOWY (skorupa z rowem osi), trzy rytmy skorupy, Colossus i Bellator (skorupa wyłączona —
// mają wyglądać jak dotąd). Pomiary: czas pełnej budowy (S.timing.total — worker + kompozytor + odczyt + ciało),
// etapy workera, pipeline'y synchroniczne w klatkach (ma być 0), błędy konsoli.
//
//   node scripts/webgpu/kreator-pancerz-ab.mjs [--out .tmp/kreator/pancerz-prototyp] [--tylko stary,nowy,rytmy,male]
//        [--stary <commit z plikiem drednota przed skorupą, domyślnie 4b1478ca>]
//
// Wynik: <out>/<kadr>.png (stary nad nowym, pasek), <out>/<kadr>-<projekt>.png, <out>/raport.json.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';
import { readPng, writePng } from './png.mjs';
import { hullDesignPreset } from '../../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField } from '../../src/game/hullDesign/hullDesignGeometry.js';

const args = parseArgs();
const SW = 1600, SH = 900;
const out = resolve(repo, args.out || '.tmp/kreator/pancerz-prototyp');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
mkdirSync(out, { recursive: true });

// stary drednot: plik z historii z importami przepiętymi na moduły repo (zestaw klocków i schemat)
async function oldDreadnought(rev) {
  const src = execFileSync('git', ['show', `${rev}:src/game/hullDesign/warships/dreadnought.js`], { cwd: repo, encoding: 'utf8' });
  const url = (p) => pathToFileURL(join(repo, p)).href;
  const code = src.replace("'../freighters/freighterKit.js'", `'${url('src/game/hullDesign/freighters/freighterKit.js')}'`)
    .replace("'../hullDesignSchema.js'", `'${url('src/game/hullDesign/hullDesignSchema.js')}'`);
  const file = join(out, 'drednot-stary.mjs');
  writeFileSync(file, code);
  const mod = await import(pathToFileURL(file).href);
  // jak hullDesignPreset: plik + sloty presetu nie są potrzebne (systemy stoją w pliku)
  return mod.default.make();
}
const OLD = await oldDreadnought(args.stary || '4b1478ca');
// rytm od nowa (jak shellSetRhythm w demie): preset ma pola rytmu A po normalizacji — samo `rhythm` by ich nie zmieniło
const withRhythm = (rh) => { const d = hullDesignPreset('dreadnought'); d.shell = { rhythm: rh }; d.name += ` — rytm ${rh}`; return d; };
const DESIGNS = {
  stary: { key: 'dreadnought', set: 'stary', make: () => structuredClone(OLD) },
  nowy: { key: 'dreadnought', set: 'nowy', make: () => hullDesignPreset('dreadnought') },
  pasy: { key: 'dreadnought', set: 'rytmy', make: () => withRhythm('pasy') },
  zebra: { key: 'dreadnought', set: 'rytmy', make: () => withRhythm('zebra') },
  colossus: { key: 'colossus', set: 'male', make: () => hullDesignPreset('colossus') },
  bellator: { key: 'bellator', set: 'male', make: () => hullDesignPreset('bellator') }
};
const boxes = new Map();
const imageOf = (k) => { if (!boxes.has(k)) boxes.set(k, buildHullField(DESIGNS[k].make(), { pipes: false, board: false }).image); return boxes.get(k); };
const whole = (k) => () => { const im = imageOf(k); return { x: im.cx, y: im.cy, zoom: Math.min(SW * 0.92 / im.w, SH * 0.92 / im.h) }; };
const CAM = {
  caly: whole('nowy'),
  dziob: () => ({ x: 2850, y: -380, zoom: SW / 2400 }),
  skrzydlo: () => ({ x: -1320, y: -1300, zoom: SW / 1900 }),
  rufa: () => ({ x: -2780, y: -940, zoom: SH / 2000 }),
  row: () => ({ x: -700, y: -260, zoom: SW / 2600 })
};
const DREAD_FRAMES = [['a1-caly', CAM.caly], ['b1-dziob', CAM.dziob], ['b2-skrzydlo', CAM.skrzydlo], ['b3-rufa', CAM.rufa], ['c1-row', CAM.row]];
const FRAMES = {
  stary: DREAD_FRAMES, nowy: DREAD_FRAMES,
  pasy: [['d-caly', CAM.caly], ['d-dziob', CAM.dziob]], zebra: [['d-caly', CAM.caly], ['d-dziob', CAM.dziob]],
  colossus: [['e1-colossus', whole('colossus')]], bellator: [['e2-bellator', whole('bellator')]]
};
const keys = Object.keys(DESIGNS).filter((k) => !only || only.has(k) || only.has(DESIGNS[k].set));

const { server, base } = await startVite(Number(args.port || 5448));
const chrome = await startChrome({ width: SW, height: SH, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { zrzuty: {}, budowy: {}, bledy: [] };
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat&clean=1` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await ev('document.body.classList.add("clean")');
  for (const k of keys) {
    const D = DESIGNS[k];
    await ev(`window.__kreator.load(${JSON.stringify(D.make())}, ${JSON.stringify(D.key)})`);
    await ev('window.__kreator.built()');
    await ev('window.__kreator.setAb(false); window.__kreator.setNetGraph(false)');
    const info = await ev(`(() => {
      const S = window.__kreator.S, t = S.timing || {};
      return { total: Math.round(t.total || 0), worker: t.worker ? JSON.parse(JSON.stringify(t.worker)) : null,
        kompozytor: Math.round(t.kompozytor || 0), shell: S.design.shell, img: S.bake ? [S.bake.width, S.bake.height] : null,
        siec: S.netCheck ? { wolne: S.netCheck.freeEnds, poza: S.netCheck.outside, ukryte: (S.netCheck.fuelHidden || []).length } : null };
    })()`);
    report.budowy[k] = info;
    console.log('budowa', k.padEnd(10), info.total, 'ms', JSON.stringify(info.worker), 'sieć', JSON.stringify(info.siec));
    for (const [name, cam] of FRAMES[k]) {
      const c = cam();
      await ev(`window.__kreator.setCamera(${c.x}, ${c.y}, ${c.zoom})`);
      await ev('window.__kreator.runFrames(4, 60)');
      for (let q = 0; q < 40 && !(await ev('window.__kreator.stats().surfaceReady')); q++) await ev('window.__kreator.runFrames(4, 60)');
      await ev('window.__kreator.runFrames(3, 60)');
      const file = join(out, `${name}-${k}.png`);
      await screenshotPng(cdp, file);
      const st = await ev('window.__kreator.stats()');
      report.zrzuty[`${name}-${k}`] = { plik: file, sync: st.syncPipes, syncNames: st.syncNames };
      console.log('zrzut', `${name}-${k}`.padEnd(26), 'sync', st.syncPipes);
    }
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 40);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(e);
} finally {
  await chrome.close();
  await server.close();
}

// zestawienia: stary nad nowym; rytmy A / B / C jeden pod drugim
function stack(files) {
  const ims = files.filter((f) => existsSync(f)).map(readPng);
  if (ims.length < 2) return null;
  const G = 6, W = ims[0].width, H = ims.reduce((s, im) => s + im.height, 0) + G * (ims.length - 1);
  const data = new Uint8Array(W * H * 4);
  let y = 0;
  ims.forEach((im, i) => {
    data.set(im.data, W * y * 4);
    y += im.height;
    if (i + 1 < ims.length) { for (let q = W * y * 4; q < W * (y + G) * 4; q += 4) { data[q] = 200; data[q + 1] = 160; data[q + 2] = 40; data[q + 3] = 255; } y += G; }
  });
  return { width: W, height: H, data };
}
for (const [name] of DREAD_FRAMES) {
  const im = stack([join(out, `${name}-stary.png`), join(out, `${name}-nowy.png`)]);
  if (im) writePng(join(out, `${name}.png`), im);
}
for (const [name, src] of [['d0-rytmy-caly', 'a1-caly'], ['d0-rytmy-dziob', 'b1-dziob']]) {
  const tail = name.endsWith('caly') ? 'd-caly' : 'd-dziob';
  const im = stack([join(out, `${src}-nowy.png`), join(out, `${tail}-pasy.png`), join(out, `${tail}-zebra.png`)]);
  if (im) writePng(join(out, `${name}.png`), im);
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
const sync = Object.values(report.zrzuty).reduce((m, z) => Math.max(m, z.sync || 0), 0);
console.log('pipeline’y synchroniczne w klatkach (maks.):', sync);
console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
