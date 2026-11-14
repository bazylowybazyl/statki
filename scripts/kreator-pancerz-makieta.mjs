// MAKIETA „ciągłego pancerza” (temat 2 generatora kadłubów; propozycja: docs/PROPOZYCJA-kreator-pancerz.md).
//
// Warianty projektu budowane w skrypcie (pliki presetów bez zmian) z prototypu `src/game/hullDesign/hullDesignShell.js`:
// skorupa = jedna płyta 'poly' poziomu 1 z sylwetki ramy minus otwarcia, rytm = rowki projektu (`grooves`), `panels` 0.
// Obraz z PRAWDZIWEGO kompozytora (demo kreatora w headless Chrome, jedna przeglądarka, kadry po kolei) — bez nakładki
// CPU: wszystko, co makieta pokazuje, dzisiejszy kompozytor rysuje z dzisiejszego formatu projektu.
//
//   node scripts/kreator-pancerz-makieta.mjs [--out .tmp/kreator/pancerz-makieta] [--tylko a,b,c,d,e] [--odswiez]
//        [--bez-gpu] [--pomiar]
//
// --odswiez — zrzuty od nowa (domyślnie z pamięci w <out>/zrzuty/), --bez-gpu — podgląd CPU (poziomy pola + rowki),
// --pomiar — czasy narzędzia (CPU, minimum z 7), liczby rowków i kontrola sieci → <out>/pomiar.json.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './webgpu/png.mjs';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField, hullFrameIntegrity, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { applyHullShell, axisTrench, buildHullShell } from '../src/game/hullDesign/hullDesignShell.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const out = resolve(repo, String(opt.out || '.tmp/kreator/pancerz-makieta'));
const only = opt.tylko ? new Set(String(opt.tylko).split(',')) : null;
mkdirSync(join(out, 'zrzuty'), { recursive: true });
const SW = 1600, SH = 900;

// ── OTWARCIA DREDNOTA (klocki-wycięcia poziomu 1 — tak gracz je kładzie) ─────────────────────────────────────────
const cutRect = (x0, y0, x1, y1, c = 0) => ({ kind: 'block', shape: 'rect', op: 'cut', level: 1, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, ...(c ? { c: [c, c, c, c] } : {}) });
/** Wnęki dysz SIDE na skośnej burcie rufy (dziś — rowy poprzeczne między płytami) i wnęka silników ze zbiornikami. */
const DREAD_NICHES = [
  cutRect(-2136, -1604, -2064, -1384, 16), cutRect(-2996, -1800, -2932, -1592, 16),
  cutRect(-2440, -1088, -2152, -420, 24)
];
/** Rów osi jak we wzorze: szpic za emiterem, najszerszy przy rdzeniach, zwęża się ku kolcowi rufy. */
const DREAD_TRENCH = axisTrench([[-2896, 0], [-2696, 120], [-2200, 296], [-1500, 440], [-200, 416], [704, 296], [1600, 144], [2600, 0]]);
/** Nadbudówki zostają tylko na osi i na skrzydle (pas wewnętrzny ostrza „schodkowy” to część łaty). */
const dreadKeep = (b) => b.y === 0 || b.x < -900;

const RHYTHM_DREAD = {}; // rytmy z HD_SHELL_RHYTHMS (wymiary w jd — detal drednota 1,5 j./jd)
/** Mniejsze okręty: ten sam rytm w mniejszej skali jd (obwódka ~1,5% długości jak we wzorze). */
const SMALL = { rim: 26, inset: { lo: 38, hi: 130, step: 230, cut: 10, axis: 10, ch: 12, minW: 24 }, bandStep: 22 };

const shellOf = (key, rhythm, openings, extra = {}) => buildHullShell(hullDesignPreset(key), { rhythm, openings, ...extra });
const DESIGNS = {
  dzis: () => hullDesignPreset('dreadnought'),
  ciagly: () => applyHullShell(hullDesignPreset('dreadnought'), shellOf('dreadnought', 'wzor', DREAD_NICHES, RHYTHM_DREAD), { keepUpper: dreadKeep }),
  rowWzor: () => applyHullShell(hullDesignPreset('dreadnought'), shellOf('dreadnought', 'wzor', [...DREAD_TRENCH, ...DREAD_NICHES]), { keepUpper: dreadKeep }),
  rowPasy: () => applyHullShell(hullDesignPreset('dreadnought'), shellOf('dreadnought', 'pasy', [...DREAD_TRENCH, ...DREAD_NICHES]), { keepUpper: dreadKeep }),
  rowZebra: () => applyHullShell(hullDesignPreset('dreadnought'), shellOf('dreadnought', 'zebra', [...DREAD_TRENCH, ...DREAD_NICHES]), { keepUpper: dreadKeep }),
  colossusDzis: () => hullDesignPreset('colossus'),
  colossusCiagly: () => applyHullShell(hullDesignPreset('colossus'), shellOf('colossus', 'wzor', [], SMALL)),
  bellatorDzis: () => hullDesignPreset('bellator'),
  bellatorCiagly: () => applyHullShell(hullDesignPreset('bellator'), shellOf('bellator', 'wzor', [], SMALL))
};
const PRESET_KEY = (k) => (k.startsWith('colossus') ? 'colossus' : k.startsWith('bellator') ? 'bellator' : 'dreadnought');
const designCache = {};
const designOf = (k) => (designCache[k] ||= DESIGNS[k]());
const fields = {};
const fieldOf = (k) => (fields[k] ||= buildHullField(designOf(k)));

// ── POMIAR ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (opt.pomiar) {
  const res = {};
  const cases = {
    'drednot wzor': ['dreadnought', 'wzor', DREAD_NICHES, {}], 'drednot wzor + rów': ['dreadnought', 'wzor', [...DREAD_TRENCH, ...DREAD_NICHES], {}],
    'drednot pasy + rów': ['dreadnought', 'pasy', [...DREAD_TRENCH, ...DREAD_NICHES], {}], 'drednot zebra + rów': ['dreadnought', 'zebra', [...DREAD_TRENCH, ...DREAD_NICHES], {}],
    'colossus wzor': ['colossus', 'wzor', [], SMALL], 'bellator wzor': ['bellator', 'wzor', [], SMALL]
  };
  const vk = { 'drednot wzor': 'ciagly', 'drednot wzor + rów': 'rowWzor', 'drednot pasy + rów': 'rowPasy', 'drednot zebra + rów': 'rowZebra', 'colossus wzor': 'colossusCiagly', 'bellator wzor': 'bellatorCiagly' };
  for (const [name, [key, rh, op, ex]] of Object.entries(cases)) {
    const d = hullDesignPreset(key);
    let best = Infinity, sh = null;
    for (let r = 0; r < 7; r++) {
      const c0 = process.cpuUsage();
      sh = buildHullShell(d, { rhythm: rh, openings: op, ...ex });
      const c1 = process.cpuUsage(c0);
      best = Math.min(best, (c1.user + c1.system) / 1000);
    }
    const f = fieldOf(vk[name]);
    const chk = pipeNetworkCheck(f.pipeNet, f);
    const integ = hullFrameIntegrity(f);
    const f0 = buildHullField(d);
    const chk0 = pipeNetworkCheck(f0.pipeNet, f0);
    res[name] = {
      cpuMinMs: Math.round(best), ...sh.stats, siatka: `${sh.grid.w}×${sh.grid.h} (${sh.grid.c.toFixed(2)} j.)`,
      plyta: sh.plate.map((p) => `${p.outer.length} pkt, otworów ${p.holes.length}`),
      siec: { wolneKonce: chk.freeEnds, pozaObrysem: chk.outside, bezPradu: chk.unpowered.length, bezPaliwa: chk.unfueled.length, ukrytePrzylacza: chk.fuelHidden.length, biegi: chk.runs },
      siecDzis: { biegi: chk0.runs, ukrytePrzylacza: chk0.fuelHidden.length },
      ramaKawalki: integ.pieces?.length ?? null
    };
    console.log(name.padEnd(22), `${Math.round(best)} ms CPU`, JSON.stringify(res[name]));
  }
  writeFileSync(join(out, 'pomiar.json'), JSON.stringify(res, null, 2));
  process.exit(0);
}

// ── KADRY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fitZoom = (k, m = 0.92) => { const im = fieldOf(k).image; return Math.min(SW * m / im.w, SH * m / im.h); };
const whole = (k) => () => { const im = fieldOf(k).image; return { x: im.cx, y: im.cy, zoom: fitZoom(k) }; };
const CAM = {
  dziob: () => ({ x: 2850, y: -380, zoom: SW / 2400 }),
  skrzydlo: () => ({ x: -1320, y: -1300, zoom: SW / 1900 }),
  rufa: () => ({ x: -2780, y: -940, zoom: SH / 2000 }),
  row: () => ({ x: -700, y: -260, zoom: SW / 2600 })
};
// pary: [kadr, projekt góra (dziś), projekt dół]; pojedyncze: [kadr, projekt]
const KADRY = [
  { id: 'a1-drednot-caly', set: 'a', pair: ['dzis', 'ciagly'], cam: whole('dzis'), opis: 'drednot cały: góra dziś (płyty z klocków), dół ciągły pancerz „obwódka i wpusty” (bez rowu osi)' },
  { id: 'b1-dziob', set: 'b', pair: ['dzis', 'ciagly'], cam: CAM.dziob, opis: 'zbliżenie dziobu (2 400 j.): góra dziś, dół ciągły pancerz' },
  { id: 'b2-skrzydlo', set: 'b', pair: ['dzis', 'ciagly'], cam: CAM.skrzydlo, opis: 'zbliżenie skrzydła z kolanem (1 900 j.)' },
  { id: 'b3-rufa', set: 'b', pair: ['dzis', 'ciagly'], cam: CAM.rufa, opis: 'zbliżenie rufy (2 000 j. w pionie): wnęka silników i wnęki dysz SIDE jako otwarcia' },
  { id: 'c1-row-caly', set: 'c', one: 'rowWzor', cam: whole('dzis'), opis: 'ciągły pancerz z rowem osi jak we wzorze (otwarcie = klocki-wycięcia)' },
  { id: 'c2-row-zblizenie', set: 'c', one: 'rowWzor', cam: CAM.row, opis: 'rów osi, zbliżenie 2 600 j.: obwódka obchodzi rów, kręgosłup nadbudówek w rowie' },
  { id: 'c3-row-dziob', set: 'c', one: 'rowWzor', cam: CAM.dziob, opis: 'szpic rowu przy dziobie' },
  ...['rowWzor', 'rowPasy', 'rowZebra'].flatMap((v, n) => [
    { id: `d${n + 1}-${['wzor', 'pasy', 'zebra'][n]}-caly`, set: 'd', one: v, cam: whole('dzis'), opis: `wariant rytmu ${['A „obwódka i wpusty”', 'B „pasy wzdłuż burt”', 'C „pasy i żebra”'][n]}: cały` },
    { id: `d${n + 1}-${['wzor', 'pasy', 'zebra'][n]}-dziob`, set: 'd', one: v, cam: CAM.dziob, opis: `wariant ${'ABC'[n]}: dziób` }
  ]),
  { id: 'e1-colossus', set: 'e', pair: ['colossusDzis', 'colossusCiagly'], cam: whole('colossusDzis'), opis: 'Colossus: góra dziś, dół ciągły pancerz (obwódka i wpusty, skala małego okrętu)' },
  { id: 'e2-bellator', set: 'e', pair: ['bellatorDzis', 'bellatorCiagly'], cam: whole('bellatorDzis'), opis: 'Bellator: góra dziś, dół ciągły pancerz' }
].filter((k) => !only || only.has(k.set) || only.has(k.id));

const shotsOf = (k) => (k.pair ? k.pair : [k.one]);
const shotFile = (design, cam) => join(out, 'zrzuty', `${design}_${cam.x.toFixed(0)}_${cam.y.toFixed(0)}_${cam.zoom.toFixed(4)}.png`);

// ── ZRZUTY (kompozytor w demie) ───────────────────────────────────────────────────────────────────────────────────
const need = [];
for (const k of KADRY) for (const d of shotsOf(k)) { const c = k.cam(); if (opt.odswiez || !existsSync(shotFile(d, c))) need.push({ design: d, cam: c }); }
if (need.length && !opt['bez-gpu']) {
  const { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng } = await import('./webgpu/wspolne.mjs');
  const vite = await startVite(5447);
  const chrome = await startChrome({ width: SW, height: SH, takt: true });
  await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  try {
    await cdp.send('Page.navigate', { url: `${vite.base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat&clean=1` });
    if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
    const err = await ev('window.__kreator.error || null');
    if (err) throw new Error(`demo: ${err}`);
    await ev('document.body.classList.add("clean")');
    let loaded = null;
    for (const s of need.sort((a, b) => a.design.localeCompare(b.design))) {
      if (loaded !== s.design) {
        await ev(`window.__kreator.load(${JSON.stringify(designOf(s.design))}, ${JSON.stringify(PRESET_KEY(s.design))})`);
        await ev('window.__kreator.built()');
        await ev('window.__kreator.setAb(false)');
        loaded = s.design;
        console.log('projekt', s.design, await ev('JSON.stringify(window.__kreator.S.field.image)'));
      }
      const c = s.cam;
      await ev(`window.__kreator.setCamera(${c.x}, ${c.y}, ${c.zoom})`);
      await ev('window.__kreator.runFrames(4, 60)');
      for (let q = 0; q < 40 && !(await ev('window.__kreator.stats().surfaceReady')); q++) await ev('window.__kreator.runFrames(4, 60)');
      await ev('window.__kreator.runFrames(3, 60)');
      await screenshotPng(cdp, shotFile(s.design, c));
      console.log('zrzut', s.design, JSON.stringify(c));
    }
  } finally {
    await chrome.close();
    await vite.server.close();
  }
}

// ── PODGLĄD CPU (--bez-gpu): poziomy pola i rowki ──────────────────────────────────────────────────────────────────
function cpuShot(design, cam) {
  const f = fieldOf(design);
  const data = new Uint8Array(SW * SH * 4);
  const LV = [[43, 46, 49], [150, 154, 158], [184, 188, 192], [220, 222, 224]];
  const gr = f.expanded.grooves;
  for (let py = 0; py < SH; py++) {
    for (let px = 0; px < SW; px++) {
      const x = cam.x + (px + 0.5 - SW / 2) / cam.zoom, y = cam.y + (py + 0.5 - SH / 2) / cam.zoom;
      let col = [8, 10, 14];
      for (let lv = 3; lv >= 0; lv--) if (sampleHullField(f, lv, x, y) < 0) { col = LV[lv]; break; }
      const o = (py * SW + px) * 4;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
    }
  }
  // rowki: odcinki rysowane po pikselach
  for (const g of gr) {
    for (let s = 0; s + 1 < g.pts.length; s++) {
      const [ax, ay] = g.pts[s], [bx, by] = g.pts[s + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * cam.zoom) + 1;
      for (let t = 0; t <= n; t++) {
        const x = ax + (bx - ax) * t / n, y = ay + (by - ay) * t / n;
        const px = Math.round((x - cam.x) * cam.zoom + SW / 2 - 0.5), py = Math.round((y - cam.y) * cam.zoom + SH / 2 - 0.5);
        if (px < 0 || py < 0 || px >= SW || py >= SH) continue;
        const o = (py * SW + px) * 4;
        data[o] = 40; data[o + 1] = 60; data[o + 2] = 70;
      }
    }
  }
  return { width: SW, height: SH, data };
}

/** Obrazy jeden pod drugim z paskiem 6 px. */
function stack(list) {
  const G = 6, W = list[0].width;
  const Hh = list.reduce((s, im) => s + im.height, 0) + G * (list.length - 1);
  const data = new Uint8Array(W * Hh * 4);
  let y = 0;
  list.forEach((im, i) => {
    data.set(im.data, W * y * 4);
    y += im.height;
    if (i + 1 < list.length) {
      for (let q = W * y * 4; q < W * (y + G) * 4; q += 4) { data[q] = 200; data[q + 1] = 160; data[q + 2] = 40; data[q + 3] = 255; }
      y += G;
    }
  });
  return { width: W, height: Hh, data };
}

const imgOf = (design, cam) => {
  const sf = shotFile(design, cam);
  return existsSync(sf) && !opt['bez-gpu'] ? readPng(sf) : cpuShot(design, cam);
};
const raport = [];
for (const k of KADRY) {
  const c = k.cam();
  const ims = shotsOf(k).map((d) => imgOf(d, c));
  const file = join(out, `${k.id}.png`);
  writePng(file, ims.length > 1 ? stack(ims) : ims[0]);
  raport.push({ kadr: k.id, plik: file, opis: k.opis, projekty: shotsOf(k), kamera: c, zrodlo: opt['bez-gpu'] ? 'podgląd CPU' : 'kompozytor' });
  console.log(k.id.padEnd(22), file);
}
// arkusze wariantów rytmu (d): trzy warianty jeden pod drugim — cały okręt i dziób
if (!only || only.has('d')) {
  for (const [name, cam] of [['d0-warianty-caly', whole('dzis')], ['d0-warianty-dziob', CAM.dziob]]) {
    const c = cam();
    const file = join(out, `${name}.png`);
    writePng(file, stack(['rowWzor', 'rowPasy', 'rowZebra'].map((d) => imgOf(d, c))));
    raport.push({ kadr: name, plik: file, opis: `warianty A / B / C od góry (${name.endsWith('caly') ? 'cały okręt' : 'dziób'})`, projekty: ['rowWzor', 'rowPasy', 'rowZebra'], kamera: c });
  }
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(raport, null, 2));
