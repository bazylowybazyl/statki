// MAKIETA „podstawy jak płytka drukowana” (temat 1 generatora kadłubów; propozycja: docs/PROPOZYCJA-kreator-plytka.md).
//
// Zrzuty prawdziwego kompozytora („dziś”, demo kreatora w headless Chrome — jedna przeglądarka) i ten sam kadr z układem
// maszynowni z generatora `src/game/hullDesign/hullDesignBoard.js` nałożonym na odsłoniętą maszynownię („makieta”):
// płyty, moduły, gniazda i trasy sieci zostają z kompozytora, rów dostaje raster CPU układu z prostym cieniowaniem
// wysokości (struktura, nie materiał). Raster liczy się w gęstości kompozytora (`hullComposerTexPerUnit` — drednot
// 1,02 teksela/j.), w zbliżeniach powiększony — makieta nie pokazuje detalu, którego kompozytor nie da.
//
//   node scripts/kreator-plytka-makieta.mjs [--out .tmp/kreator/plytka-makieta] [--tylko a,b,c,d,e] [--odswiez]
//        [--bez-gpu] [--pomiar]
//
// --odswiez — zrzuty „dziś” od nowa (domyślnie z pamięci w <out>/dzis/), --bez-gpu — bez przeglądarki: podkład z podglądu
// CPU (poziomy płyt), --pomiar — tylko czasy generatora (minimum z 7 przebiegów) i liczby elementów → <out>/pomiar.json.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './webgpu/png.mjs';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { buildHullBoard, hullBoardSample, HD_BOARD_KINDS as K, HD_BOARD_VARIANTS } from '../src/game/hullDesign/hullDesignBoard.js';
import { hullComposerTexPerUnit } from '../src/3d/hullDesign/hullComposer.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const out = resolve(repo, String(opt.out || '.tmp/kreator/plytka-makieta'));
const only = opt.tylko ? new Set(String(opt.tylko).split(',')) : null;
mkdirSync(join(out, 'dzis'), { recursive: true });
const SW = 1600, SH = 900;

// ── PROJEKTY ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Drednot z OTWARTYM ROWEM osi (jak wzór): zdjęte płyty grzbietu dziobu, pokładu-klina, grzbietu rufowego i wieży
 *  mostka — tylko w makiecie, plik drednota bez zmian. Moduły (rdzenie, projektory, mostek, generatory) stoją w rowie. */
function openTrench(d0) {
  const d = structuredClone(d0);
  d.shapes = d.shapes.filter((s) => !(s.kind === 'block' && (s.level ?? 1) >= 1 && s.y === 0 && s.x > -2700 && s.x < 2460));
  d.name += ' — otwarty rów (makieta)';
  return d;
}
const DESIGNS = {
  dreadnought: () => hullDesignPreset('dreadnought'),
  rowOtwarty: () => openTrench(hullDesignPreset('dreadnought')),
  colossus: () => hullDesignPreset('colossus'),
  citadella: () => hullDesignPreset('citadella'),
  bellator: () => hullDesignPreset('bellator')
};
const fields = {};
const fieldOf = (k) => (fields[k] ||= buildHullField(DESIGNS[k]()));
const boards = {};
const boardOf = (k, v) => (boards[`${k}|${v}`] ||= buildHullBoard(fieldOf(k), { variant: v }));

// ── POMIAR ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (opt.pomiar) {
  const res = {};
  for (const k of ['dreadnought', 'rowOtwarty', 'colossus', 'citadella', 'bellator']) {
    const f = fieldOf(k);
    const chk = pipeNetworkCheck(f.pipeNet, f);
    res[k] = { siec: { wolneKonce: chk.freeEnds, pozaObrysem: chk.outside, biegi: f.pipeNet.runs.length } };
    for (const v of Object.keys(HD_BOARD_VARIANTS)) {
      let best = Infinity, bd = null;
      const cpu0 = process.cpuUsage();
      for (let r = 0; r < 7; r++) {
        const c0 = process.cpuUsage();
        bd = buildHullBoard(f, { variant: v });
        const c1 = process.cpuUsage(c0);
        best = Math.min(best, (c1.user + c1.system) / 1000);
      }
      void cpu0;
      const s = bd.stats;
      res[k][v] = {
        cpuMinMs: Math.round(best), elementy: s.elems, sciezki: s.traces, rodzaje: s.byKind, komorek: s.cells,
        siatka: `${bd.grid.w}×${bd.grid.h}`, pamiecKB: Math.round(bd.grid.w * bd.grid.h * (1 + 4 + 4 + 4 + 4) / 1024),
        rastrPolaKB: Math.round(f.grid.w * f.grid.h * 8 / 1024), rowJ2: s.domArea
      };
      console.log(k.padEnd(12), v, `${Math.round(best)} ms CPU`, JSON.stringify(res[k][v]));
    }
  }
  writeFileSync(join(out, 'pomiar.json'), JSON.stringify(res, null, 2));
  process.exit(0);
}

// ── KADRY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fitZoom = (k, m = 0.92) => { const im = fieldOf(k).image; return Math.min(SW * m / im.w, SH * m / im.h); };
const whole = (k) => { const im = fieldOf(k).image; return { x: im.cx, y: im.cy, zoom: fitZoom(k) }; };
const KADRY = [
  // a) drednot, dzisiejszy układ płyt
  { id: 'a1-drednot-caly', set: 'a', design: 'dreadnought', cam: () => whole('dreadnought'), variant: 'A', opis: 'drednot cały, dzisiejsze płyty' },
  { id: 'a2-drednot-rufa', set: 'a', design: 'dreadnought', cam: () => ({ x: -1500, y: -350, zoom: SW / 2600 }), variant: 'A', opis: 'drednot, śródokręcie i rufa (2 600 j.)' },
  // b) otwarty rów
  { id: 'b1-row-caly', set: 'b', design: 'rowOtwarty', cam: () => whole('rowOtwarty'), variant: 'A', opis: 'drednot z otwartym rowem osi, cały' },
  { id: 'b2-row-1200', set: 'b', design: 'rowOtwarty', cam: () => ({ x: 650, y: -150, zoom: SW / 1200 }), variant: 'A', opis: 'zbliżenie rowu, kadr 1 200 j.' },
  { id: 'b3-row-rdzen', set: 'b', design: 'rowOtwarty', cam: () => ({ x: -1150, y: -230, zoom: SW / 1200 }), variant: 'A', opis: 'zbliżenie przy rdzeniu (1 200 j.)' },
  { id: 'b4-row-polowa', set: 'b', design: 'rowOtwarty', cam: () => ({ x: -400, y: -330, zoom: SW / 3600 }), variant: 'A', opis: 'rów od ostrza do rufy (3 600 j.)' },
  // c) małe okręty
  { id: 'c1-colossus', set: 'c', design: 'colossus', cam: () => whole('colossus'), variant: 'A', opis: 'Colossus cały' },
  { id: 'c2-citadella', set: 'c', design: 'citadella', cam: () => whole('citadella'), variant: 'A', opis: 'Citadella cała' },
  { id: 'c3-bellator', set: 'c', design: 'bellator', cam: () => whole('bellator'), variant: 'A', opis: 'Bellator cały' },
  { id: 'c4-colossus-rufa', set: 'c', design: 'colossus', cam: () => ({ x: -330, y: 0, zoom: SW / 700 }), variant: 'A', opis: 'Colossus, rufa i rdzeń (700 j.)' },
  // d) warianty zasady (A w b2 / c1)
  ...['B', 'C'].flatMap((v) => [
    { id: `d-${v}-row-1200`, set: 'd', design: 'rowOtwarty', cam: () => ({ x: 650, y: -150, zoom: SW / 1200 }), variant: v, opis: `wariant ${v}: zbliżenie rowu 1 200 j.` },
    { id: `d-${v}-row-polowa`, set: 'd', design: 'rowOtwarty', cam: () => ({ x: -400, y: -330, zoom: SW / 3600 }), variant: v, opis: `wariant ${v}: rów 3 600 j.` },
    { id: `d-${v}-colossus`, set: 'd', design: 'colossus', cam: () => whole('colossus'), variant: v, opis: `wariant ${v}: Colossus` },
    { id: `d-${v}-colossus-rufa`, set: 'd', design: 'colossus', cam: () => ({ x: -330, y: 0, zoom: SW / 700 }), variant: v, opis: `wariant ${v}: Colossus, rufa` }
  ]),
  // e) świecące ścieżki — tylko ilustracja do decyzji o kanale emisji
  { id: 'e1-swiecace-row', set: 'e', design: 'rowOtwarty', cam: () => ({ x: 650, y: -150, zoom: SW / 1200 }), variant: 'A', glow: true, opis: 'wariant A ze świecącymi ścieżkami (emisja)' },
  { id: 'e2-swiecace-polowa', set: 'e', design: 'rowOtwarty', cam: () => ({ x: -400, y: -330, zoom: SW / 3600 }), variant: 'A', glow: true, opis: 'jw., rów 3 600 j.' }
].filter((k) => !only || only.has(k.set) || only.has(k.id));

// ── ZRZUTY „DZIŚ” (kompozytor w demie) ────────────────────────────────────────────────────────────────────────────
const shotFile = (k) => join(out, 'dzis', `${k.design}_${k.cam().x.toFixed(0)}_${k.cam().y.toFixed(0)}_${k.cam().zoom.toFixed(4)}.png`);
const need = KADRY.filter((k) => opt.odswiez || !existsSync(shotFile(k)));
if (need.length && !opt['bez-gpu']) {
  const { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng } = await import('./webgpu/wspolne.mjs');
  const vite = await startVite(5437);
  const chrome = await startChrome({ width: SW, height: SH, takt: true });
  await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  try {
    await cdp.send('Page.navigate', { url: `${vite.base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat&clean=1` });
    if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
    const err = await ev('window.__kreator.error || null');
    if (err) throw new Error(`demo: ${err}`);
    await ev('document.body.classList.add("clean")');
    let loaded = null;
    for (const k of need.sort((a, b) => a.design.localeCompare(b.design))) {
      if (loaded !== k.design) {
        const d = DESIGNS[k.design]();
        const key = k.design === 'rowOtwarty' ? 'dreadnought' : k.design;
        await ev(`window.__kreator.load(${JSON.stringify(d)}, ${JSON.stringify(key)})`);
        await ev('window.__kreator.built()');
        await ev('window.__kreator.setAb(false)');
        loaded = k.design;
        const im = await ev('JSON.stringify(window.__kreator.S.field.image)');
        console.log('projekt', k.design, im, 'CPU', JSON.stringify(fieldOf(k.design).image));
      }
      const c = k.cam();
      await ev(`window.__kreator.setCamera(${c.x}, ${c.y}, ${c.zoom})`);
      await ev('window.__kreator.runFrames(4, 60)');
      for (let q = 0; q < 40 && !(await ev('window.__kreator.stats().surfaceReady')); q++) await ev('window.__kreator.runFrames(4, 60)');
      await ev('window.__kreator.runFrames(3, 60)');
      await screenshotPng(cdp, shotFile(k));
      console.log('zrzut', k.id);
    }
  } finally {
    await chrome.close();
    await vite.server.close();
  }
}

// ── RASTER UKŁADU (CPU) — to samo, co kompozytor miałby liczyć w passie map ───────────────────────────────────────
const COL = {
  floor: [27, 25, 24], bus: [94, 82, 64], trace: [80, 71, 57], via: [138, 126, 102],
  pod: [128, 130, 134], block: [104, 106, 111], blockChip: [64, 66, 70], module: [92, 95, 99], slat: [62, 64, 68],
  chip: [38, 39, 42], pin: [150, 140, 118], box: [112, 106, 98], cyl: [126, 118, 106], grate: [74, 74, 76], twin: [100, 101, 106], pad: [130, 118, 96]
};
const GLOW = [40, 170, 255];
const fract = (v) => v - Math.floor(v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function hashF(a, b) { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }
function sdCham(x, y, hw, hh, ch) {
  const ax = Math.abs(x), ay = Math.abs(y);
  const qx = ax - hw, qy = ay - hh;
  const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  const cut = (ax + ay - (hw + hh - ch)) * Math.SQRT1_2;
  return Math.max(box, cut);
}

/** Wysokość [jd], barwa, emisja i pokrycie w punkcie świata. */
function boardPoint(board, x, y, glow, o) {
  const S = hullBoardSample(board, x, y, o.s || (o.s = {}));
  o.a = sat((S.dom - 0.3) / 0.4) * sat((S.D - 0.45) / 0.5);
  o.h = 0; o.c = COL.floor; o.e = 0;
  if (o.a <= 0) return o;
  const Du = board.detail, V = board.variant;
  // podłoga: drobna kratka 6 jd (płyta podłogi rowu)
  const gx = fract(x / (6 * Du)), gy = fract(S.y / (6 * Du));
  if (Math.min(gx, 1 - gx, gy, 1 - gy) < 0.04) o.h = -0.15;
  for (const r of board.rings) {
    if (S.T < r.t) break;
    if (Math.abs(S.D - r.r) < V.ringW * 0.5) { o.h = 0.45; o.c = COL.bus; o.e = 1; }
  }
  // ulice: izolinia E = gap / 2 (środek ulicy między elementami, obwódka elementu w otwartym polu)
  if (Math.abs(S.E - V.gap * 0.5) < Math.min(V.traceW * 0.5, V.gap * 0.5 - 0.6) && S.D > V.gap * 0.5) { o.h = 0.3; o.c = COL.trace; o.e = 0.6; }
  if (S.tr < V.traceW * 0.5) { o.h = 0.35; o.c = COL.trace; o.e = 0.8; }
  if (S.id >= 0) {
    const e = board.elems[S.id];
    const lx = x - e.x, ly = S.y - e.y;
    const sd = sdCham(lx, ly, e.hw, e.hh, e.ch);
    if (sd < 0) {
      const u = lx / Du, v = ly / Du, sdj = sd / Du, hw = e.hw / Du, hh = e.hh / Du;
      const bev = sat(-sdj / 0.7);
      let h = 0, c = COL.box;
      o.e = 0;
      switch (e.kind) {
        case K.pod: {
          h = 3.4; c = COL.pod;
          if (Math.abs(fract(u / 3) - 0.5) < 0.1 && sdj < -3) h -= 0.5;
          if (sdj > -2.6 && sdj < -1.8) h -= 0.7;
          if (Math.abs(v) < hh * 0.22 && sdj < -3) h += 0.7;
          break;
        }
        case K.block: {
          h = 2.6; c = COL.block;
          if (sdj > -3.2 && sdj < -2.4) h -= 0.7;
          if (sdj < -4.5) {
            const cu = (u + hw) / 8, cv = (v + hh) / 6;
            if (Math.abs(fract(cu) - 0.5) < 0.32 && Math.abs(fract(cv) - 0.5) < 0.27 && hashF(Math.floor(cu) + e.seed * 1e6, Math.floor(cv)) > 0.25) { h += 0.7; c = COL.blockChip; }
          }
          break;
        }
        case K.module: {
          h = 2.0; c = COL.module;
          if (sdj > -2.4 && sdj < -1.8) h -= 0.6;
          if (sdj < -3) {
            const along = hw >= hh ? u : v;
            if (Math.abs(fract(along / 1.6) - 0.5) < 0.2) { h -= 0.4; c = COL.slat; }
          }
          break;
        }
        case K.chip: {
          const longX = hw >= hh;
          const bw = longX ? hw - 0.4 : hw - 1.3, bh = longX ? hh - 1.3 : hh - 0.4;
          if (Math.abs(u) < bw && Math.abs(v) < bh) { h = 1.3; c = COL.chip; if (Math.hypot(u + bw - 1.2, v + bh - 1.2) < 0.5) h = 1.0; }
          else if (Math.abs(fract((longX ? u : v) / 1.5) - 0.5) < 0.22) { h = 0.5; c = COL.pin; }
          else { h = 0; c = COL.floor; }
          break;
        }
        case K.cyl: {
          const longX = hw >= hh;
          const t = (longX ? v : u) / (longX ? hh : hw);
          h = Math.sqrt(Math.max(0, 1 - t * t)) * Math.min(3, (longX ? hh : hw) * 0.8) + 0.3; c = COL.cyl;
          if (Math.abs(fract((longX ? u : v) / 1.8) - 0.5) > 0.38) h -= 0.3;
          break;
        }
        case K.grate: {
          c = COL.grate;
          h = sdj > -1 ? 1.0 : (Math.abs(fract((hw >= hh ? u : v) / 1.6) - 0.5) < 0.25 ? 0.8 : 0.15);
          break;
        }
        case K.twin: {
          const longX = hw >= hh;
          const a = longX ? u : v;
          h = Math.abs(a) < 0.5 ? 0 : 1.4; c = COL.twin;
          break;
        }
        case K.via: {
          const rr = Math.hypot(u, v);
          if (rr > hw) { h = o.h; c = o.c; break; }
          h = rr < hw * 0.42 ? 0.1 : 0.55; c = COL.via;
          break;
        }
        case K.pad: {
          h = 0.6; c = COL.pad;
          if (Math.hypot(u, v) < Math.min(hw, hh) * 0.35) h = 0.25;
          break;
        }
        default: { // box
          h = 1.2; c = COL.box;
          if (sdj > -1.4 && sdj < -1.0) h -= 0.3;
        }
      }
      o.h = h * (0.35 + 0.65 * bev); o.c = c;
    }
  }
  if (!glow) o.e = 0;
  return o;
}

/** Podkład bez GPU: poziomy pola (rama / płyty / nadbudówka / mostek). */
function cpuBase(f, cam) {
  const data = new Uint8Array(SW * SH * 4);
  const LV = [[43, 46, 49], [150, 154, 158], [184, 188, 192], [220, 222, 224]];
  for (let py = 0; py < SH; py++) {
    for (let px = 0; px < SW; px++) {
      const x = cam.x + (px + 0.5 - SW / 2) / cam.zoom, y = cam.y + (py + 0.5 - SH / 2) / cam.zoom;
      let col = [8, 10, 14];
      for (let lv = 3; lv >= 0; lv--) if (sampleHullField(f, lv, x, y) < 0) { col = LV[lv]; break; }
      const o = (py * SW + px) * 4;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
    }
  }
  return { width: SW, height: SH, data };
}

/** Nakłada układ na kadr: raster w gęstości kompozytora (zbliżenie — powiększony), cieniowanie wysokości. */
function overlay(base, k) {
  const f = fieldOf(k.design), board = boardOf(k.design, k.variant), cam = k.cam();
  const tpu = hullComposerTexPerUnit(f.image.w, f.image.h);
  // gęstość rastra: piksel ekranu (z nadpróbkowaniem 2× w widokach całości), ale nie gęściej niż kompozytor
  const r = cam.zoom >= tpu ? tpu : Math.min(tpu, cam.zoom * 2);
  const wx0 = cam.x - SW / 2 / cam.zoom, wy0 = cam.y - SH / 2 / cam.zoom;
  const RW = Math.ceil(SW / cam.zoom * r) + 2, RH = Math.ceil(SH / cam.zoom * r) + 2;
  const H = new Float32Array(RW * RH), A = new Float32Array(RW * RH), E = new Float32Array(RW * RH), C = new Uint8Array(RW * RH * 3);
  const o = {};
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      const x = wx0 + (i - 0.5) / r, y = wy0 + (j - 0.5) / r;
      boardPoint(board, x, y, !!k.glow, o);
      const q = j * RW + i;
      H[q] = o.h; A[q] = o.a; E[q] = o.e; C[q * 3] = o.c[0]; C[q * 3 + 1] = o.c[1]; C[q * 3 + 2] = o.c[2];
    }
  }
  // cieniowanie: normalna z wysokości [jd] (teksel = 1 / (r · detal) jd), światło z lewej-góry jak malowane światło TN
  const texJd = 1 / (r * board.detail);
  const Lx = -0.55, Ly = -0.65, Lz = 0.52, Ln = Math.hypot(Lx, Ly, Lz);
  const shade = new Float32Array(RW * RH * 3);
  for (let j = 1; j < RH - 1; j++) {
    for (let i = 1; i < RW - 1; i++) {
      const q = j * RW + i;
      if (A[q] <= 0) continue;
      const sx = (H[q + 1] - H[q - 1]) / (2 * texJd), sy = (H[q + RW] - H[q - RW]) / (2 * texJd);
      const nl = Math.hypot(sx, sy, 1);
      const lam = (-sx * Lx - sy * Ly + Lz) / (nl * Ln) / (Lz / Ln);
      // wnęka: niżej niż sąsiedzi — ciemniej
      const avg = (H[q + 1] + H[q - 1] + H[q + RW] + H[q - RW]) * 0.25;
      const cav = Math.max(0.55, 1 + Math.min(0, H[q] - avg) * 0.6);
      const k2 = Math.max(0.15, Math.min(1.5, 0.3 + 0.7 * lam)) * cav * (0.92 + 0.05 * H[q]);
      for (let ch = 0; ch < 3; ch++) shade[q * 3 + ch] = C[q * 3 + ch] * k2 + E[q] * GLOW[ch] * 1.1;
    }
  }
  const img = { width: SW, height: SH, data: new Uint8Array(base.data) };
  for (let py = 0; py < SH; py++) {
    for (let px = 0; px < SW; px++) {
      const x = cam.x + (px + 0.5 - SW / 2) / cam.zoom, y = cam.y + (py + 0.5 - SH / 2) / cam.zoom;
      const fx = (x - wx0) * r + 0.5 - 0.5, fy = (y - wy0) * r + 0.5 - 0.5;
      const i = Math.floor(fx), j = Math.floor(fy);
      if (i < 1 || j < 1 || i + 1 >= RW - 1 || j + 1 >= RH - 1) continue;
      const tx = fx - i, ty = fy - j;
      let a = 0; const cc = [0, 0, 0];
      for (let qq = 0; qq < 4; qq++) {
        const q = (j + (qq >> 1)) * RW + i + (qq & 1);
        const wq = ((qq & 1) ? tx : 1 - tx) * ((qq >> 1) ? ty : 1 - ty);
        a += wq * A[q];
        for (let ch = 0; ch < 3; ch++) cc[ch] += wq * A[q] * shade[q * 3 + ch];
      }
      if (a <= 0.001) continue;
      const po = (py * SW + px) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[po + ch] = Math.max(0, Math.min(255, Math.round(img.data[po + ch] * (1 - a) + cc[ch])));
    }
  }
  return img;
}

/** Dwa obrazy jeden nad drugim (dziś / makieta) z paskiem 6 px. */
function stack(a, b) {
  const G = 6, W = a.width, Hh = a.height + G + b.height;
  const data = new Uint8Array(W * Hh * 4);
  data.set(a.data, 0);
  for (let i = a.width * a.height * 4; i < a.width * (a.height + G) * 4; i += 4) { data[i] = 200; data[i + 1] = 160; data[i + 2] = 40; data[i + 3] = 255; }
  data.set(b.data, W * (a.height + G) * 4);
  return { width: W, height: Hh, data };
}

const raport = [];
for (const k of KADRY) {
  const t0 = performance.now();
  const sf = shotFile(k);
  const base = existsSync(sf) && !opt['bez-gpu'] ? readPng(sf) : cpuBase(fieldOf(k.design), k.cam());
  const mk = overlay(base, k);
  const file = join(out, `${k.id}.png`);
  writePng(file, k.set === 'a' || k.set === 'c' ? stack(base, mk) : mk);
  if (k.set === 'b' || k.set === 'e') writePng(join(out, `${k.id}-dzis.png`), base);
  const st = boardOf(k.design, k.variant).stats;
  raport.push({ kadr: k.id, plik: file, opis: k.opis, wariant: k.variant, elementy: st.elems, sciezki: st.traces, ms: Math.round(performance.now() - t0) });
  console.log(k.id.padEnd(22), file, `${Math.round(performance.now() - t0)} ms`);
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(raport, null, 2));
