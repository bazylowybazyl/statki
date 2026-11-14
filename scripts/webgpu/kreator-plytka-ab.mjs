// A/B UKŁADU MASZYNOWNI „jak płytka drukowana” z prawdziwego kompozytora (demo kreatora w headless Chrome, jedna
// przeglądarka): ten sam projekt z `board.variant = 'off'` („dziś” — komórki maszynowni z hasza) i z układem
// („prototyp”, wariant A; drednot także bez świecenia i ze słabym), te same kadry co makieta
// (scripts/kreator-plytka-makieta.mjs). Pomiary: czas pełnej budowy (S.timing.total — worker + kompozytor + odczyt +
// ciało; budowy „na zimno”: kolejność tak, żeby pamięć etapów workera nie oddała wyniku), etap UKŁAD w workerze,
// pamięć tekstur układu, pipeline'y synchroniczne w klatkach (ma być 0), błędy konsoli.
//
//   node scripts/webgpu/kreator-plytka-ab.mjs [--out .tmp/kreator/plytka-prototyp] [--tylko dreadnought,colossus]
//        [--warianty A,B]
//
// Wynik: <out>/<kadr>-dzis.png, <out>/<kadr>-prototyp.png (drednot: także -bez-swiecenia), <out>/raport.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';
import { hullDesignPreset } from '../../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField } from '../../src/game/hullDesign/hullDesignGeometry.js';

/** Pudło obrazu projektu (jak `field.image` kompozytora) — sama geometria. */
const boxes = new Map();
const hullDesignBounds = (d) => { const k = d.name; if (!boxes.has(k)) boxes.set(k, buildHullField(d, { pipes: false }).image); return boxes.get(k); };

const args = parseArgs();
const SW = 1600, SH = 900;
const out = resolve(repo, args.out || '.tmp/kreator/plytka-prototyp');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const extraVariants = String(args.warianty || 'B').split(',').filter((v) => v && v !== 'A');
mkdirSync(out, { recursive: true });

/** Drednot z otwartym rowem osi (wariant makiety — plik drednota bez zmian). */
function openTrench(d0) {
  const d = structuredClone(d0);
  d.shapes = d.shapes.filter((s) => !(s.kind === 'block' && (s.level ?? 1) >= 1 && s.y === 0 && s.x > -2700 && s.x < 2460));
  d.name += ' — otwarty rów (makieta)';
  return d;
}
const DESIGNS = {
  dreadnought: { key: 'dreadnought', make: () => hullDesignPreset('dreadnought') },
  rowOtwarty: { key: 'dreadnought', make: () => openTrench(hullDesignPreset('dreadnought')) },
  colossus: { key: 'colossus', make: () => hullDesignPreset('colossus') },
  citadella: { key: 'citadella', make: () => hullDesignPreset('citadella') },
  bellator: { key: 'bellator', make: () => hullDesignPreset('bellator') }
};
const whole = (k) => { const im = hullDesignBounds(DESIGNS[k].make()); return { x: im.cx, y: im.cy, zoom: Math.min(SW * 0.92 / im.w, SH * 0.92 / im.h) }; };
const FRAMES = {
  dreadnought: [['a1-drednot-caly', () => whole('dreadnought')], ['a2-drednot-rufa', () => ({ x: -1500, y: -350, zoom: SW / 2600 })]],
  rowOtwarty: [['b1-row-caly', () => whole('rowOtwarty')], ['b4-row-3600', () => ({ x: -400, y: -330, zoom: SW / 3600 })],
    ['b2-row-1200', () => ({ x: 650, y: -150, zoom: SW / 1200 })], ['b3-row-rdzen', () => ({ x: -1150, y: -230, zoom: SW / 1200 })]],
  colossus: [['c1-colossus', () => whole('colossus')], ['c4-colossus-rufa', () => ({ x: -330, y: 0, zoom: SW / 700 })]],
  citadella: [['c2-citadella', () => whole('citadella')]],
  bellator: [['c3-bellator', () => whole('bellator')], ['c5-bellator-dziob', () => ({ x: 130, y: 0, zoom: SW / 380 })]]
};
// kolejka: najpierw „dziś”, potem prototypy — przy kilku okrętach pamięć etapów workera (LRU 2) jest już wypchnięta,
// więc obie strony A/B budują się na zimno; potem stany świecenia i warianty (sam układ / kompozytor z pamięci)
const keys = Object.keys(DESIGNS).filter((k) => !only || only.has(k) || (k === 'rowOtwarty' && only.has('dreadnought')));
const jobs = [
  ...keys.map((k) => ({ k, tag: 'dzis', board: { variant: 'off' } })),
  ...keys.map((k) => ({ k, tag: 'prototyp', board: null })),
  ...keys.filter((k) => k === 'dreadnought' || k === 'rowOtwarty').map((k) => ({ k, tag: 'bez-swiecenia', board: { variant: 'A', glow: 0 } })),
  ...keys.filter((k) => k === 'rowOtwarty' || k === 'colossus').flatMap((k) => extraVariants.map((v) => ({ k, tag: `wariant-${v}`, board: { variant: v }, frames: [FRAMES[k][1] || FRAMES[k][0]] })))
];

const { server, base } = await startVite(Number(args.port || 5438));
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
  for (const job of jobs) {
    const D = DESIGNS[job.k];
    const d = D.make();
    if (job.board) d.board = { ...(d.board || {}), ...job.board };
    await ev(`window.__kreator.load(${JSON.stringify(d)}, ${JSON.stringify(D.key)})`);
    await ev('window.__kreator.built()');
    await ev('window.__kreator.setAb(false); window.__kreator.setNetGraph(false)');
    const info = await ev(`(() => {
      const S = window.__kreator.S, t = S.timing || {}, pb = S.field?.packed?.board;
      return {
        total: Math.round(t.total || 0), worker: t.worker ? JSON.parse(JSON.stringify(t.worker)) : null, kompozytor: Math.round(t.kompozytor || 0),
        board: S.design.board, img: S.bake ? [S.bake.width, S.bake.height] : null,
        ukladMB: pb && pb.a ? Math.round((pb.a.byteLength + pb.b.byteLength + pb.e.byteLength) / 1048576 * 10) / 10 : 0,
        uklad: pb ? { w: pb.w, h: pb.h, elementy: pb.n } : null,
        siec: S.netCheck ? [S.netCheck.freeEnds, S.netCheck.outside] : null
      };
    })()`);
    report.budowy[`${job.k}-${job.tag}`] = info;
    console.log('budowa', `${job.k}-${job.tag}`.padEnd(28), info.total, 'ms', JSON.stringify(info.worker), 'układ', info.ukladMB, 'MB');
    for (const [name, cam] of job.frames || FRAMES[job.k]) {
      const c = cam();
      await ev(`window.__kreator.setCamera(${c.x}, ${c.y}, ${c.zoom})`);
      await ev('window.__kreator.runFrames(4, 60)');
      for (let q = 0; q < 40 && !(await ev('window.__kreator.stats().surfaceReady')); q++) await ev('window.__kreator.runFrames(4, 60)');
      await ev('window.__kreator.runFrames(3, 60)');
      const file = join(out, `${name}-${job.tag}.png`);
      await screenshotPng(cdp, file);
      const st = await ev('window.__kreator.stats()');
      report.zrzuty[`${name}-${job.tag}`] = { plik: file, sync: st.syncPipes, syncNames: st.syncNames };
      console.log('zrzut', `${name}-${job.tag}`.padEnd(34), 'sync', st.syncPipes);
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
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
const sync = Object.values(report.zrzuty).reduce((m, z) => Math.max(m, z.sync || 0), 0);
console.log('pipeline’y synchroniczne w klatkach (maks.):', sync);
console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
