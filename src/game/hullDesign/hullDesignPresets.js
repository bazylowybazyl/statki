// src/game/hullDesign/hullDesignPresets.js
//
// KREATOR KADŁUBÓW — gotowe projekty (punkt wyjścia do edycji w stoczni). Wymiary w j. świata (blok 60 j.; Atlas
// w grze ma 1800 j. długości, Bellator 624), lustro dopisuje drugą burtę. Wszystkie presety składają się wyłącznie
// z elementów edytora gracza (isPlayerBuildable, src/game/hullDesign/hullDesignBuildable.js): klocki palety, bloki
// 60 j., kasztele, gotowe części, moduły, naklejki.
//
// FLOTA TERRA NOVY (Custos, Hasta, Bellator, Citadella, Colossus) — złożona z KLOCKÓW (src/game/hullDesign/
// hullDesignBlocks.js) według podkładu sprite'ów (scripts/kreator-tn-ab.mjs: siatka j. świata, IoU alfy ≥ 0,9), styl
// TN, nie kopia 1:1; gondole, pierścienie, wieże, hangary, kratki, kasztele, napisy i orły ręcznie — w j. świata gry,
// w skali sprite'ów (getHullRenderSize).

import { normalizeHullDesign } from './hullDesignSchema.js';
import { applySystemSlots } from './hullDesignSystemSlots.js';

/** Bloki prostokąta bx0..bx1 × by0..by1 (włącznie) na poziomie `level`. */
function fill(out, bx0, bx1, by0, by1, level) {
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) out.push([bx, by, level]);
}

function orbis() {
  const b = [];
  fill(b, -8, 4, -2, -1, 0);
  fill(b, 5, 7, -1, -1, 0);
  fill(b, -6, -4, -1, -1, 1);
  fill(b, 3, 4, -1, -1, 1);
  return {
    name: 'Krążownik Orbis', style: 'rounded', mirror: true, palette: 'terra', seed: 11,
    blocks: b,
    shapes: [
      { kind: 'block', shape: 'arc', arc: 360, x: 0, y: 0, w: 356, h: 356, level: 0 },
      { kind: 'block', shape: 'arc', arc: 360, x: 0, y: 0, w: 264, h: 264, ri: 0.75, level: 1 },
      { kind: 'block', shape: 'arc', arc: 360, x: 0, y: 0, w: 80, h: 80, level: 2 }
    ],
    modules: [
      { type: 'turret_l', x: 405, y: 0 },
      { type: 'turret_m', x: 0, y: -150 },
      { type: 'turret_s', x: -300, y: -92 },
      { type: 'turret_s', x: 120, y: -96 },
      { type: 'bridge', x: 225, y: 0, w: 30, h: 24 },
      { type: 'engine', x: -505, y: -62, w: 48, h: 24 },
      { type: 'reactor', x: -400, y: 0, r: 24 },
      { type: 'hatch', x: -150, y: -78, w: 24, h: 14 }
    ],
    decals: [
      { kind: 'contour', level: 0, inset: 8, w: 4, color: '#3a63a8', xMin: -470, xMax: 470 },
      { kind: 'contour', level: 1, inset: 5, w: 3, color: '#3a63a8' },
      { kind: 'emblem', id: 'star', x: 330, y: -72, rot: 0, w: 46, h: 46, color: '#3a63a8' },
      { kind: 'text', text: 'ORBIS', x: -235, y: -92, rot: 0, w: 82, h: 15, color: '#30383f' },
      { kind: 'stripe', x0: 455, y0: -40, x1: 395, y1: -112, w: 9, color: '#3a63a8' }
    ]
  };
}

function atlasLike() {
  const b = [];
  fill(b, -15, 9, -5, -1, 0);
  fill(b, 10, 11, -4, -1, 0);
  fill(b, 12, 12, -3, -1, 0);
  fill(b, 13, 13, -2, -1, 0);
  fill(b, 14, 14, -1, -1, 0);
  fill(b, -12, 6, -2, -1, 1);
  fill(b, -9, -4, -3, -3, 1);
  fill(b, -8, -6, -1, -1, 2);
  const hatches = [-600, -300, 0, 300].map((x) => ({ type: 'hatch', x, y: -215, w: 58, h: 30 }));
  return {
    name: 'Atlas II', style: 'chamfer', mirror: true, palette: 'atlas', seed: 23,
    blocks: b,
    shapes: [
      { kind: 'block', shape: 'arc', arc: 360, x: 200, y: -300, w: 124, h: 124, level: 0 },
      { kind: 'block', shape: 'rect', op: 'cut', x: -906, y: 0, w: 80, h: 68, level: 0 }
    ],
    modules: [
      ...hatches,
      { type: 'turret_l', x: 200, y: -300 },
      { type: 'turret_l', x: 520, y: -150 },
      { type: 'turret_m', x: -150, y: -205 },
      { type: 'turret_m', x: -700, y: -240 },
      { type: 'turret_s', x: 700, y: -70 },
      { type: 'turret_s', x: -840, y: -262 },
      { type: 'turret_m', x: 420, y: 0 },
      { type: 'bridge', x: -420, y: 0, w: 52, h: 28 },
      { type: 'engine', x: -955, y: -82, w: 58, h: 40 },
      { type: 'engine', x: -955, y: -210, w: 58, h: 40 },
      { type: 'reactor', x: -640, y: 0, r: 34 }
    ],
    decals: [
      { kind: 'contour', level: 1, inset: 6, w: 5, color: '#d06a22' },
      { kind: 'stripe', x0: -880, y0: -150, x1: 520, y1: -150, w: 7, color: '#d06a22', opacity: 0.85 },
      { kind: 'stripe', x0: 560, y0: -150, x1: 760, y1: -40, w: 7, color: '#d06a22', opacity: 0.85 },
      { kind: 'emblem', id: 'chevron', x: 640, y: -125, rot: -Math.PI / 2, w: 54, h: 46, color: '#d06a22' },
      { kind: 'text', text: 'ATLAS II', x: -150, y: -262, rot: 0, w: 104, h: 17, color: '#d9dcdf' }
    ]
  };
}

function destroyer() {
  const b = [];
  fill(b, -4, 3, -1, -1, 0);
  return {
    name: 'Niszczyciel Hasta-D', style: 'chamfer', mirror: true, palette: 'terra', seed: 5,
    paint: { hull: '#9aa3ab', upper: '#c4c9ce' },
    blocks: b,
    shapes: [
      { kind: 'block', shape: 'rect', x: 214, y: 0, w: 80, h: 80, rot: Math.PI / 4, level: 0 },
      { kind: 'block', shape: 'arc', arc: 360, x: -40, y: -60, w: 56, h: 56, level: 0 },
      { kind: 'block', shape: 'rect', x: -30, y: 0, w: 184, h: 64, c: [10, 10, 10, 10], level: 1 }
    ],
    modules: [
      { type: 'turret_m', x: 150, y: 0 },
      { type: 'turret_m', x: -175, y: 0 },
      { type: 'turret_s', x: -40, y: -62 },
      { type: 'bridge', x: 10, y: 0, w: 24, h: 19 },
      { type: 'engine', x: -262, y: 0, w: 38, h: 33 },
      { type: 'reactor', x: -82, y: 0, r: 16 }
    ],
    decals: [
      { kind: 'stripe', x0: 228, y0: -46, x1: 200, y1: 46, w: 9, color: '#3a63a8', mirror: false },
      { kind: 'stripe', x0: 210, y0: -46, x1: 182, y1: 46, w: 4, color: '#3a63a8', mirror: false },
      { kind: 'text', text: 'D-14', x: 92, y: -42, rot: 0, w: 42, h: 11, color: '#2b3238' },
      { kind: 'contour', level: 0, inset: 5, w: 2.5, color: '#3a63a8' }
    ]
  };
}

function pirate() {
  const b = [];
  fill(b, -6, 5, -2, 1, 0);
  fill(b, 6, 8, -1, 0, 0);
  fill(b, -3, 1, 2, 3, 0);
  fill(b, -5, -1, -1, 0, 1);
  fill(b, -4, -2, -2, -2, 1);
  return {
    name: 'Szakal (piraci)', style: 'sharp', mirror: false, palette: 'pirate', seed: 31,
    blocks: b,
    shapes: [
      { kind: 'block', shape: 'arc', arc: 360, x: 0, y: 300, w: 144, h: 144, level: 0 },
      { kind: 'block', shape: 'arc', arc: 360, x: 0, y: 300, w: 92, h: 92, ri: 0.65, level: 1 },
      { kind: 'block', shape: 'arc', arc: 360, op: 'cut', x: 330, y: -128, w: 104, h: 104, level: 0 },
      { kind: 'block', shape: 'rect', op: 'cut', x: -300, y: 132, w: 88, h: 44, level: 0 }
    ],
    modules: [
      { type: 'turret_l', x: 0, y: 300 },
      { type: 'turret_m', x: 200, y: -72 },
      { type: 'turret_m', x: 200, y: 72 },
      { type: 'turret_s', x: 430, y: 0 },
      { type: 'turret_s', x: -330, y: -96 },
      { type: 'bridge', x: -165, y: -32, w: 30, h: 22 },
      { type: 'engine', x: -392, y: -62, w: 40, h: 26 },
      { type: 'engine', x: -392, y: 62, w: 40, h: 26 },
      { type: 'engine', x: -200, y: 196, w: 38, h: 22 },
      { type: 'reactor', x: -270, y: 0, r: 24 },
      { type: 'hatch', x: -60, y: 180, w: 30, h: 18 }
    ],
    decals: [
      { kind: 'stripe', x0: 520, y0: -54, x1: 465, y1: 54, w: 12, color: '#d3a02e' },
      { kind: 'stripe', x0: 492, y0: -54, x1: 437, y1: 54, w: 12, color: '#151312' },
      { kind: 'emblem', id: 'claw', x: 70, y: 0, rot: 0.2, w: 76, h: 76, color: '#b8342a' },
      { kind: 'text', text: 'SZAKAL', x: -50, y: -98, rot: 0, w: 92, h: 17, color: '#d3a02e' }
    ]
  };
}

function empty() {
  const b = [];
  fill(b, -4, 4, -1, -1, 0);
  return { name: 'Nowy kadłub', style: 'chamfer', mirror: true, palette: 'civil', blocks: b, shapes: [], modules: [], decals: [] };
}

// ── Terra Nova ────────────────────────────────────────────────────────────────────────────────────────────
const TN_TEXT = '#3b3a37';
const TN_EMBLEM = '#34332f';
const text = (x, y, w, h, rot = 0, extra = {}) => ({ kind: 'text', text: 'TERRA NOVA', x, y, w, h, rot, color: TN_TEXT, opacity: 0.88, weight: 500, ...extra });
const eagle = (x, y, w, h, extra = {}) => ({ kind: 'emblem', id: 'eagle', x, y, w, h, rot: 0, color: TN_EMBLEM, opacity: 0.9, ...extra });
const engine = (x, y, w, h, v = 0) => ({ type: 'engine', x, y, w, h, n: 1, v });
const mount = (x, y, r, type = 'turret_m') => ({ type, x, y, r, v: 0 });
const well = (x, y, r) => ({ type: 'well', x, y, r });
const vent = (x, y, w, h, rot = 0, v = 1) => ({ type: 'vent', x, y, w, h, rot, v });
const grid = (x, y, w, h, rot = 0) => vent(x, y, w, h, rot, 2);
const port = (x, y, r) => ({ type: 'well', x, y, r, v: 1 });
const portO = (x, y, r) => ({ type: 'well', x, y, r, v: 2 });   // iluminator w ośmiokątnej ramie (Colossus)
const hatch = (x, y, w, h, rot = 0) => ({ type: 'hatch', x, y, w, h, rot, v: 1 });
/** Kasztel na płytach pancerza (clip 1) — domyślnie bez szczegółów automatu (stawiane ręcznie wg sprite'a). */
const castle = (x, y, w, h, o = {}) => ({ x, y, w, h, tiers: 2, high: 'out', taper: 0.4, vent: 'none', port: false, hatches: 0, clip: 1, ...o });

// KLOCKI floty TN (src/game/hullDesign/hullDesignBlocks.js): połowa okrętu (y ≤ 0, lustro dopisuje drugą burtę; klocek
// na osi — symetryczny), wymiary z podkładu sprite'a (scripts/kreator-tn-ab.mjs: siatka j. świata, IoU alfy). Szwy płyt
// wąskie (TN_SEAM jd — styk klocków), ROWY maszynowni to odstęp między płytami nad klockami ramy (poziom 0) — korytarze
// sieci rur i kabli jak w sprite'ach.
const TN_SEAM = 4;
/** Klocek z pudła [x0, x1] × [y0, y1] (obrót 0). */
const blk = (shape, x0, y0, x1, y1, level = 1, o = {}) => ({ kind: 'block', shape, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level, gap: TN_SEAM, ...o });
/** Klocek ramy (maszynownia, rowy) z pudła. */
const frameBlk = (x0, y0, x1, y1, o = {}) => ({ kind: 'block', shape: 'rect', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level: 0, ...o });
/** Klocek ze środka, wymiarów (układ klocka) i obrotu w krokach 45°. */
const blkAt = (shape, x, y, w, h, rot45, level = 1, o = {}) => ({ kind: 'block', shape, x, y, w, h, rot: rot45 * Math.PI / 4, level, gap: TN_SEAM, ...o });
/**
 * Okręt TN z klocków: wspólne nastawy wyglądu (jak sprite'y); `grid` — siatka klocków [j.] (domyślnie z detalu; duże
 * okręty — drobniejsza niż z detalu, żeby sekcje sprite'a wypadły na siatce).
 */
function tnShip(name, seed, detail, o = {}) {
  return {
    v: 2, name, style: 'chamfer', mirror: true, palette: 'terra', seed, detail, grid: o.grid, windows: 0, bevel: 1.9, round: 1,
    panels: o.panels ?? 1, pipeNet: { density: o.pipes ?? 1, seed: o.pipeSeed ?? 0 },
    blocks: [], shapes: o.shapes || [], modules: o.modules || [], decals: o.decals || [], castles: o.castles || [], parts: []
  };
}

function custos() {
  // sprite: rufa-nadbudówka (ukośny róg), pionowy rów rur za nią i ukośny do korytarza wzdłuż grzbietu, pas burty
  // z szyną, płyta dziobu z napisem (ukośna lewa krawędź), klin, maszynownia między klinami
  const d = tnShip('Fregata Custos (Terra Nova)', 41, 0.0894, {
    panels: 0.55,                                      // sprite: mniej szwów paneli niż u lotniskowca
    castles: [castle(-55, -24, 5, 4, { level: 3, clip: 2, tiers: 1, taper: 0.5 })],
    shapes: [
      frameBlk(-48, -28, -27, 28, { c: [0, 6.5, 6.5, 0] }),         // rama: rowy za rufą i pod sekcją pierścienia
      frameBlk(-27, -21.5, 22.5, 21.5),                             // rama: korytarz wzdłuż grzbietu
      frameBlk(8.5, -7, 64, 7),                                     // maszynownia między klinami dziobu i rów pod płytą dziobu
      frameBlk(-75, -7.5, -47, 7.5),                                // mocowanie gondoli i rów od gondol wzdłuż rufy
      blk('rect', -67, -5, -47, 5),                                 // rufa przy osi (zbiornik; rów od gondol obok)
      blk('trap', -67, -17, -47, -7.5, 2, { a: 6 }),                // rufa: ukośny róg
      blk('rect', -62, -21, -47, -17, 2),                           // rufa: pas pod szczytem
      blk('rect', -61, -28, -47, -21, 2, { c: [1.5, 0, 0, 0] }),    // szczyt rufy (kasztel)
      blk('rect', -43, -28, -27, -14, 1, { c: [0, 6.5, 0, 3] }),    // sekcja pierścienia
      blk('trap', -29, -26.5, -24, -21.5, 1, { a: 2.5 }),           // płetwa wieżyczki
      blk('rect', -43, -9, -25, 9),                                 // grzbiet za mostkiem (rów za rufą schodzi do osi)
      blk('rect', -27, -21.5, -4, -12.5),                           // pas burty
      blk('trap', -4, -21.5, 13.5, -12.5, 1, { b: -8.5 }),          // pas burty przy dziobie (skos wzdłuż płyty dziobu)
      blk('rect', -36, -24, -1, -21.5, 1, { c: [1, 1, 0, 0] }),     // szyna na burcie
      blk('rect', -1, -22.5, 20, -21.5, 1, { c: [0, 0.5, 0, 0] }),  // szyna przy dziobie
      blk('rect', -15, -8, -5, 8),                                  // grzbiet z kratą (przed wnęką reaktora)
      blk('rect', -5, -5, 8.5, 5),                                  // grzbiet z gniazdem (korytarz schodzi do rowu dziobu)
      blk('rect', 8.5, -5, 34, 5),                                  // grzbiet dziobu
      blk('trap', 8.5, -24, 35.5, -6.5, 2, { a: 16.5 }),            // płyta dziobu z napisem
      blkAt('trap', 55.5, -15.25, 17.5, 40, 2, 2, { a: 14 })        // klin dziobu (trapez obrócony o 90°)
    ]
  });
  d.modules.push(
    engine(-71, -9.4, 4.6, 3.4),
    port(-33.5, -16, 5.8),
    vent(-11.3, 0, 4.3, 3.6),
    hatch(14, -18, 3.4, 2.3), hatch(-13, -17.5, 5, 2.2), hatch(6, -17, 3.6, 2.6),
    mount(6, 0, 3.2),
    { type: 'bridge', x: -42, y: 0, v: 2 },              // gniazdo mostka I (obrys modelu 3D gry)
    { type: 'reactor', x: -20, y: 0, r: 5, v: 1 }
  );
  d.decals.push(text(27, -8.5, 15.5, 2.1), eagle(29.5, -13.6, 7.8, 6.4));
  return d;
}
function hasta() {
  // sprite: wieża rufowa (ukośna lewa krawędź, szczyt pod kasztel), rampa w dół do sekcji pierścienia, maszynownia
  // z rurami za wieżą i pionowy rów do korytarza wzdłuż grzbietu, pas burty z szyną, płyta dziobu z napisem, klin,
  // maszynownia między klinami; wnęka rdzenia w grzbiecie
  const d = tnShip('Niszczyciel Hasta (Terra Nova)', 43, 0.1445, {
    panels: 0.55,
    castles: [castle(-86, -60, 16, 12, { level: 3, clip: 2, tiers: 1, taper: 0.5, taperIn: 0.05 })],
    shapes: [
      frameBlk(-113, -45, -60, -14, { shape: 'trap', a: 13 }),       // maszynownia za wieżą (rury od gondol)
      frameBlk(-101, -56, -95, -43),                                // mocowanie górnej gondoli
      frameBlk(-60.5, -31, 21, 31),                                 // rów pionowy, korytarz grzbietu, wnęka rdzenia
      frameBlk(-61, -35.5, -54.5, -30.5),                           // szczyt rowu pionowego
      frameBlk(21, -10, 105, 10),                                   // rów pod płytą dziobu i maszynownia między klinami
      blk('trap', -100, -68.5, -60.5, -44.5, 2, { a: 7 }),          // wieża rufowa (kasztel na szczycie)
      blk('rect', -88, -44.5, -60.5, -31),                          // wieża: dolna płyta
      blk('trap', -91.5, -31, -60.5, -16, 1, { a: 3 }),             // rufa: pas nad rowem do rufy
      blk('rect', -120, -14, -92, 14, 1, { c: [2, 0, 0, 2] }),      // rufa przy osi (zbiornik)
      blk('rect', -92, -14, -60.5, 14),                             // rufa przy osi (mostek)
      blk('tri', -60.5, -68.5, -33.5, -35),                         // rampa wieży
      blk('rect', -55, -35, -30, -16, 1, { c: [0, 4, 0, 0] }),      // sekcja pierścienia
      blk('rect', -29, -31, -5, -18.5),                             // pas burty
      blk('trap', -5, -31, 28.5, -18.5, 1, { b: -12 }),             // pas burty przy dziobie (skos wzdłuż płyty dziobu)
      blk('rect', -17.5, -35, 10, -31, 1, { c: [1, 1, 0, 0] }),     // szyna na burcie
      blk('rect', -60.5, -12.5, -38, 12.5),                         // grzbiet za wnęką rdzenia
      blk('rect', -22, -12.5, 0, 12.5),                             // grzbiet z kratą
      blk('rect', 0, -8, 21, 8),                                    // grzbiet z gniazdem
      blk('rect', 21, -8, 60, 8),                                   // grzbiet pod płytą dziobu
      blk('trap', 21, -35, 61.5, -9.5, 2, { a: 24.5 }),             // płyta dziobu z napisem
      blkAt('trap', 92, -22.25, 25.5, 61, 2, 2, { a: 23 })          // klin dziobu (trapez obrócony o 90°)
    ]
  });
  d.modules.push(
    engine(-108, -49.5, 8.2, 7.4), engine(-109, -28, 6.2, 5.6),
    port(-40, -25.2, 9.4),
    vent(-6, 0, 10, 3.6),
    vent(68.5, -23, 2.2, 12), hatch(-85.5, -39.5, 5, 1.6), hatch(27, -27, 3.5, 1.7), hatch(-26, -13, 3.8, 1.3),
    mount(14, 0, 4.8), mount(-58, 0, 5.4),
    { type: 'bridge', x: -64, y: 0, v: 2 },              // gniazdo mostka II (rów przy zbiorniku zostaje dla rury)
    { type: 'reactor', x: -30, y: 0, r: 8, v: 1 }
  );
  d.decals.push(text(50, -11.8, 22, 3.1), eagle(53, -20.4, 11, 9.5), eagle(-83.6, -51.7, 8, 9));
  return d;
}
function bellator() {
  // sprite (wzór czystego stylu): wieża rufowa z orłem, rampa w dół do sekcji pierścienia, maszynownia z rurami za wieżą,
  // sponson z napisem nad pasem burty (połączony z kadłubem tylko rampą — prześwit z rurami zostaje pusty), kanał
  // maszynowni wzdłuż osi aż do dziobu, płyta dziobu z napisem, blok dziobu i klin
  const d = tnShip('Pancernik Bellator (Terra Nova)', 47, 0.3661, {
    grid: 1,
    panels: 0.4,                                       // sprite: duże gładkie płyty z kilkoma długimi szwami
    castles: [castle(-194, -152, 42, 13, { level: 3, clip: 2, tiers: 1, taper: 0.3 })],  // szczyt wieży rufowej
    shapes: [
      frameBlk(-273, -106, -150, -34, { shape: 'trap', a: 31 }),    // maszynownia za wieżą (rury od gondol)
      frameBlk(-248, -130, -234, -100),                             // mocowanie górnej gondoli
      frameBlk(-272, -76, -258, -48),                               // mocowanie dolnej gondoli
      frameBlk(-151, -84, -50, 84),                                 // rów pionowy, rowy przy pierścieniu, grzbiet za rdzeniem
      frameBlk(-50, -39, 49, 39),                                   // korytarz wzdłuż pasa burty, kanał osi
      frameBlk(49, -81, 104, -18),                                  // pod skosem płyty dziobu (styk z pasem burty)
      frameBlk(-92, -100, -66, -84),                                // pod płetwą na końcu rampy
      frameBlk(-124, -140, -104, -132),                             // pod wysuniętym rogiem sponsonu
      frameBlk(49, -20, 240, 20),                                   // kanał osi pod dziobem
      blk('trap', -234, -162, -150, -135, 2, { a: 8 }),             // wieża: szczyt (kasztel)
      blk('trap', -242, -134, -150, -105, 2, { a: 8 }),             // wieża: płyta z orłem
      blk('rect', -215, -104, -150, -80),                           // wieża: dolna płyta
      blk('trap', -222, -77, -150, -36, 1, { a: 14 }),              // rufa: płyta nad rufą (pod nią rów do mostka)
      blk('rect', -290, -33, -222, 33, 1, { c: [6, 0, 0, 6] }),     // rufa: skrzynia
      blk('rect', -222, -33, -150, 33),                             // rufa przy osi (mostek, zbiornik)
      blk('tri', -150, -162, -72, -84),                             // rampa wieży
      blk('trap', -110, -188, 74, -98, 2, { a: 10, b: 40 }),        // sponson z napisem
      blk('tri', -124, -188, -100, -138, 2, { a: 24 }),             // sponson: wysunięty róg (góra)
      blkAt('tri', -114.5, -118, 19, 40, 4, 2, { a: 5 }),           // sponson: wysunięty róg (dół, trójkąt obrócony o 180°)
      blk('rect', -90, -98, -66, -84, 1, { c: [6, 0, 0, 0] }),      // płetwa na końcu rampy
      blk('rect', -135, -80, -75, -40, 1, { c: [0, 5, 0, 0] }),     // sekcja pierścienia
      blk('rect', -72, -77, -10, -39),                              // pas burty
      blk('trap', -10, -77, 66, -39, 1, { b: -32 }),                // pas burty przy dziobie (skos wzdłuż płyty dziobu)
      blk('rect', -50, -84, 80, -77, 1, { c: [2, 2, 0, 0] }),       // szyna z rurami na burcie
      blk('rect', -145, -33, -82, 33),                              // grzbiet za kanałem osi (gniazdo rufowe)
      blk('rect', -78, -33, -10, -18),                              // płyta przy kanale osi (przed nią rów do kanału)
      blk('rect', -10, -33, 49, -18),                               // płyta przy kanale osi (dziób)
      blk('trap', 49, -81, 140, -20, 2, { a: 55 }),                 // płyta dziobu z napisem
      blk('trap', 104, -151, 140, -81, 2, { a: 7 }),                // blok dziobu
      blkAt('trap', 222.5, -85.5, 131, 165, 2, 2, { a: 61 })        // klin dziobu (trapez obrócony o 90°)
    ]
  });
  d.modules.push(
    engine(-261, -117, 17, 16.5), engine(-287, -62, 19, 17.5),
    port(-100.5, -64, 20),
    vent(-164, -151, 3.2, 11), vent(126, -145, 4, 4),
    hatch(-28, -111, 15, 4), hatch(-202, -96, 9, 7), hatch(57, -65, 7, 3),
    mount(-132, 0, 12), mount(-40, 0, 9), mount(40, 0, 9),
    { type: 'bridge', x: -217, y: 0, v: 2 },             // gniazdo mostka IV: między gniazdem PD rufy a zbiornikiem
    { type: 'reactor', x: -80, y: 0, r: 18, v: 1 }
  );
  d.decals.push(
    text(-32, -152, 56, 8), text(110, -28, 54, 7.5),
    eagle(-31.5, -166.5, 20, 16), eagle(-203, -119, 20, 22), eagle(116, -46.5, 20, 16),
    { kind: 'stripe', x0: 154.5, y0: -150, x1: 154.5, y1: 150, w: 7, color: '#2f2e2b', opacity: 0.85, mirror: false }
  );
  return d;
}
function citadella() {
  // sprite: rufa z kasztelów nad maszynownią z rurami, szyja z rurami, pokład górny z orłami i kratkami, rampa w dół
  // do pokładu dolnego, rząd hangarów nad ramą (wrota rysuje moduł), grzbiet z wnęką rdzenia i korytarzem, dziób:
  // blok z orłem, długa skośna płyta z napisem, płyty przy osi i maszynownia z walcami wzdłuż osi
  const d = tnShip('Lotniskowiec Citadella (Terra Nova)', 53, 0.6304, {
    grid: 1,
    shapes: [
      frameBlk(-470, -172, -256, 172),                              // rufa: maszynownia między kasztelami, szyja z rurami
      frameBlk(-292, -188, -268, -172),                             // szyja: rury nad kasztelami
      frameBlk(-482, -105, -465, -30),                              // mocowanie środkowej gondoli
      frameBlk(-256, -140, 245, 140),                               // hangary, wnęka zbiornika, korytarz, wnęka rdzenia
      frameBlk(245, -100, 470, 100),                                // dziób: maszynownia pod skośną płytą i przy osi
      blk('rect', -256, -180, -125, -140),                          // pokład górny z orłem
      blk('trap', -256, -202, -125, -179, 1, { a: 56 }),            // pokład górny: skos rufowego rogu
      blk('rect', -125, -193, 20, -140),                            // pokład górny z napisem
      blk('rect', 20, -193, 167, -140),                             // pokład górny przy dziobie
      blk('trap', -256, -140, -185, -92, 1, { b: 48 }),             // płyta nad wnęką zbiornika (skos wzdłuż rampy)
      blk('rect', -256, -92, -238, -55),                            // kolumna przy szyi
      blk('trap', -145, -140, -120, -55, 1, { a: -85, b: 85 }),     // rampa w dół do pokładu dolnego
      blk('rect', -200, -55, -125, -40),                            // pokład dolny (rufa)
      blk('rect', -120, -55, 20, -40),                              // pokład dolny pod hangarami (rowy w poprzek do korytarza)
      blk('rect', 25, -55, 245, -40),                               // pokład dolny przy dziobie
      blk('rect', -206, -34, -125, 34),                             // grzbiet przed wnęką rdzenia
      blk('rect', -125, -34, 0, 34),                                // grzbiet
      blk('rect', 0, -34, 125, 34),                                 // grzbiet
      blk('rect', 125, -34, 245, 34),                               // grzbiet przy dziobie
      frameBlk(167, -156, 215, -140),                               // rów pod blokiem dziobu (rura dyszy SIDE do korytarza)
      blk('rect', 167, -198, 215, -156, 2),                         // blok dziobu z orłem
      blkAt('trap', 297.5, -150.5, 95, 165, 2, 2, { a: 85, b: -68 }), // skośna płyta dziobu z napisem (trapez obrócony o 90°)
      blkAt('trap', 430, -76.5, 73, 100, 2, 2, { a: 51 }),          // skośna płyta dziobu: koniec (trapez obrócony o 90°)
      blk('rect', 245, -34, 300, 34),                               // dziób przy osi
      blk('rect', 320, -34, 470, -15),                              // dziób: płyta nad maszynownią osi
      blk('rect', 470, -28, 515, 28, 1, { c: [0, 14, 14, 0] })      // czoło dziobu
    ],
    // KASZTELE rufowe — lite bryły (bez clip), wymiary z siatki sprite'a: kolumna z pionowym napisem i jej górny blok
    // z kratkami, wysoki kasztel z górną półką z kratą (split), centralny trapez na osi z półkami i iluminatorami
    castles: [
      castle(-436.5, -122.5, 21.5, 56.5, { tiers: 1, taperB: 0.18, taperF: 0, taperIn: 0.14, clip: undefined }),
      castle(-406.5, -152.5, 20.5, 26.5, { tiers: 1, taperF: 0.1, taperB: 0, taperIn: 0.05, clip: undefined }),
      castle(-341, -168, 50, 50, { taperB: 0.65, taperF: 0.28, taperIn: 0.05, split: 0.42, clip: undefined }),  // nad rowem z rurami
      castle(-366.5, 0, 104.5, 109, { taperB: 0.57, taperF: 0.23, split: 0.5, clip: undefined })
    ]
  });
  d.modules.push(
    vent(-87.5, -164.7, 21, 5.4), vent(79.8, -164.7, 19.005, 5.4), vent(147.6, -185.4, 12.915, 3.84),
    engine(-504, 0, 34, 28), engine(-491, -134, 26, 21), engine(-502, -85, 23, 22),
    ...[-112, -38, 39, 115, 190].map((x) => ({ type: 'hangar', x, y: -90, w: 34, h: 35, doors: 1 })),
    port(-132, 0, 12), port(121, 0, 12), port(237, 0, 12),
    mount(-362, -30, 11), mount(330, 0, 10),
    vent(264, -114, 12, 9.5), vent(277, -35, 15, 11),
    // kratki-radiatory kaszteli i pasa nad wrotami
    vent(-342, -196, 14, 20), vent(-349.5, -80, 5.5, 24.5), vent(-419.5, -150, 2.5, 15), vent(-398, -146.5, 3.2, 16.5),
    vent(-346, -120, 12, 9), vent(-438.5, -32, 4.5, 8),
    vent(-265.5, -37, 11.5, 4), vent(-232, 0, 15, 10.5), vent(-30, -35, 11, 6.5),
    vent(-88, -164, 21, 6.5), vent(24, -164, 13, 6), vent(78, -164, 20, 6.5), vent(133, -164, 14, 6),
    hatch(-319, -150, 11, 8), hatch(300, -150, 7, 4),
    // dziób: pionowa kratka klina i klapa przy jego czole
    vent(410, -64, 5, 23), hatch(454, -48, 5, 2.5),
    // gniazdo mostka V na środku rufowego kasztelu (cytadela sprite'a: kopuły i mechanizm — tam stoi strefa gry)
    { type: 'bridge', x: -339, y: 0, v: 2 },
    { type: 'reactor', x: -230, y: 0, r: 24, v: 1 }
  );
  d.decals.push(
    text(-5, -150, 62, 9), text(343, -92, 59, 8.2), text(-439, -124, 57, 10, -Math.PI / 2),
    eagle(208, -158, 28, 22), eagle(-170, -155, 28, 22)
  );
  // rdzeń dziobu (sprite: maszynownia z walcami wzdłuż osi między klinami) — grube rury stalowe w rowie
  d.pipes = [{ pts: [[352, -9], [468, -9]], n: 2, r: 2.4, mat: 'steel', over: false }];
  return d;
}
function colossus() {
  // sprite: płyty-szewrony rozdzielone ukośnymi rowami maszynowni (od lewej góry w prawy dół), ośmiokątne gniazda
  // na osobnych płytach, rufa z kasztelami na płytach, dziób — klin z gniazdem i pas pod nim, maszynownia na osi
  const d = tnShip('Superkapitał Colossus (Terra Nova)', 59, 0.9061, {
    grid: 1,
    shapes: [
      // rama: maszynownia rufy i rowów, mocowania gondol, dziób (trapez obrócony o 90° pod skosem klina)
      frameBlk(-710, -214, -618, 214, { c: [7, 0, 0, 7] }),
      frameBlk(-756, -80, -700, 80),
      frameBlk(-683, -240, -623, -192),                               // rów od górnej gondoli
      frameBlk(-618, -148, -300, 148),
      frameBlk(-400, -234, -300, -146),                               // pod ukośnym pasem i płytą z ośmiokątem
      frameBlk(-107, -304, 29, -228),                                 // pod górną płytą (szew z wielką płytą)
      frameBlk(29, -240, 64, -228),
      frameBlk(300, -178, 340, -150),                                 // pod płytą z gniazdem L
      frameBlk(334, -160, 400, -140),                                 // pod gniazdem przed klinem
      frameBlk(640, -70, 680, -38),                                   // pod końcem klina
      frameBlk(-300, -230, 312, 230),
      { kind: 'block', shape: 'trap', x: 482.5, y: 0, w: 320, h: 341, rot: Math.PI / 2, level: 0, a: 60, b: 60 },
      frameBlk(535, -40, 680, 40),
      // rufa (kasztele na płytach)
      blk('rect', -623, -303, -400, -148, 1, { c: [25, 0, 0, 0] }),   // pod kasztelami z kratą i orłem
      blk('rect', -701, -192, -618, -63, 1, { c: [40, 0, 0, 0] }),    // kolumna z napisem (kasztel z ośmiokątem)
      blk('rect', -647, -221, -623, -192),                            // pod górną gondolą
      blk('rect', -723, -33, -660, 33),                               // rufa przy osi
      blk('rect', -660, -49, -594, 49, 1, { c: [8, 0, 0, 8] }),        // rufa przy osi (mostek)
      blk('rect', -587, -141, -345, -52, 1, { c: [41, 0, 0, 0] }),     // pod kasztelem środkowym
      blk('rect', -587, -48, -386, 48),                               // pod kasztelem na osi
      blk('rect', -333, -51, -279, 51, 1, { c: [10, 10, 10, 10] }),    // platforma rdzenia
      // góra kadłuba
      blk('tri', -400, -303, -368, -272),                             // skos za rufą
      blk('rect', -400, -272, -324, -232),
      blk('rect', -400, -214, -350, -147, 1, { c: [10, 0, 0, 10] }),   // płyta z ośmiokątem
      blk('rect', -324, -314, -278, -256, 1, { c: [12, 0, 0, 0] }),    // gniazdo
      blk('rect', -276, -306, -105, -196, 1, { c: [0, 0, 0, 24] }),    // wielka płyta z gniazdem L
      blk('trap', -103, -306, 64, -240, 1, { b: 35 }),                // górna płyta do skosu
      blk('rect', -45, -238, 34, -134, 1, { c: [12, 12, 12, 12] }),    // płyta z ośmiokątem
      blk('rect', 97, -268, 150, -212, 1, { c: [6, 6, 6, 6] }),        // gniazdo
      blk('rect', 152, -248, 241, -212, 1, { c: [0, 18, 0, 0] }),
      blk('trap', 243, -230, 334, -176, 1, { b: 22 }),                // płyta z gniazdem L i skosem
      blk('rect', 353, -192, 391, -150, 1, { c: [6, 6, 6, 6] }),       // gniazdo
      blk('rect', 334, -176, 353, -150),
      // szewrony między ukośnymi rowami
      blk('trap', -305, -232, -250, -142, 1, { a: -90, b: 90 }),      // ukośny pas za wielką płytą (równoległobok)
      blk('rect', -324, -256, -278, -230),                            // pod gniazdem
      blk('rect', -250, -184, -165, -142, 1, { c: [8, 8, 8, 8] }),
      blk('trap', -160, -194, -45, -134, 1, { a: 30, b: 40 }),        // szewron (skosy wzdłuż rowów)
      blk('rect', -340, -137, -262, -112),
      blk('rect', -305, -110, -182, -56, 1, { c: [10, 0, 10, 0] }),    // płyta z ośmiokątem
      blk('rect', -110, -130, -3, -60, 1, { c: [24, 36, 0, 0] }),      // szewron (róg ścięty wzdłuż rowu)
      blk('rect', -225, -52, -3, 52),                                 // grzbiet z napisem
      blk('rect', 5, -126, 62, -92, 1, { c: [0, 20, 0, 0] }),         // (rów poprzeczny przy x 0 — łączy rowy obu połówek kadłuba)
      blk('rect', 64, -132, 152, -90, 1, { c: [8, 8, 8, 8] }),         // płyta z gniazdem L
      blk('trap', 100, -204, 226, -147, 1, { a: -57 }),               // pas ukośny pod gniazdami (rowy nad nim i za nim)
      blk('rect', 234, -165, 340, -134),
      blk('trap', 5, -90, 195, -52, 1, { b: 38 }),                    // szewron (skos wzdłuż rowu)
      blk('rect', 200, -92, 266, -50, 1, { c: [10, 10, 10, 10] }),     // płyta z ośmiokątem
      blk('trap', 270, -76, 392, -38, 1, { b: 37 }),
      blk('rect', 5, -48, 125, 48),                                   // grzbiet
      blk('rect', 128, -48, 197, 48),                                 // grzbiet z kratą
      blk('rect', 200, -46, 300, 46, 1, { c: [12, 12, 12, 12] }),      // grzbiet z ośmiokątem
      blk('rect', 300, -36, 395, 36),
      // dziób
      blk('tri', 391, -192, 408, -176),                               // skos przed gniazdem
      blk('rect', 391, -176, 482, -112, 1, { c: [0, 0, 12, 0] }),      // płyta z gniazdem (prosta burta pod dyszę SIDE)
      blkAt('trap', 611.5, -139, 74, 259, 2, 1, { a: 108, b: -62 }),  // klin (trapez obrócony o 90°)
      blk('trap', 400, -105, 700, -40, 1, { b: 270 }),                // pas pod klinem
      blk('rect', 405, -30, 535, 30),                                 // dziób przy osi (gniazdo, krata; rowy nad nim i przed nim)
      blk('rect', 671, -65, 768, 65, 1, { c: [0, 27, 27, 0] })         // czoło
    ],
    // KASZTELE rufowe (sprite: górny blok z kratą i orłem, blok z pionowym napisem, blok z ośmiokątem, środek)
    castles: [
      castle(-496, -264, 111, 40, { taperF: 0.9, taperB: 0.15 }),
      castle(-520, -186, 90, 38, { taper: 0.3 }),
      castle(-660, -122, 45, 48, { tiers: 1, taper: 0.35, taperB: 0.1 }),
      castle(-450, -95, 105, 45, { taper: 0.4 }),
      castle(-430, 0, 120, 48, { taper: 0.4 })
    ]
  });
  d.modules.push(
    vent(160.9, 0, 36.225, 13.44), vent(467, 0, 31.395, 16.8, Math.PI / 2), vent(592, -99.8, 22.575, 10.08),
    vent(160.9, -231.4, 17.64, 10.08, Math.PI / 2), vent(282.2, -226.7, 6.825, 3.36),
    grid(-585, -269, 15, 21), vent(-502, -231, 46, 6), vent(-560, -178, 14, 14), vent(-643, -130, 9, 21),
    grid(-551, -14, 10, 13), grid(-498, -14, 11, 13), grid(-386, -14, 10, 13),
    // silniki: kanciaste bloki z kratą
    engine(-726, -176, 26, 24, 1), engine(-735, -99, 28, 23, 1), engine(-653, -248, 32, 21, 1), engine(-745, 0, 20, 18, 1),
    // ośmiokątne obudowy wież i okrągłe porty
    mount(-195, -249, 31, 'turret_l'), mount(-300, -283, 20), mount(124, -239.5, 22), mount(280.5, -200.5, 25, 'turret_l'),
    mount(375.6, -166, 20), mount(546, -108, 20), mount(110, -110, 25, 'turret_l'), mount(507, 0, 22),
    portO(-375, -178.5, 24), portO(-468, -105.4, 24), portO(-216.6, -86, 24), portO(451, -147, 22), portO(231.7, -71, 22),
    portO(227, 0, 24), portO(702, 0, 20), portO(-14, -176, 28),
    { type: 'bridge', x: -150, y: 0, v: 2 },             // gniazdo mostka VI na centralnej nadbudówce
    { type: 'reactor', x: -330, y: 0, r: 30, v: 1 }
  );
  d.decals.push(
    text(-37, 0, 58, 8), text(-680, -110, 68, 12, -Math.PI / 2), text(-597, -142, 52, 10, Math.PI / 2),
    eagle(-492, -256.6, 35, 30), eagle(-443, 0, 44, 38), eagle(405, 0, 30, 28)
  );
  return d;
}

/**
 * FREGATA Z KLOCKÓW (TN): kadłub wyłącznie z klocków palety (src/game/hullDesign/hullDesignBlocks.js) na siatce 0,5 j.,
 * połowa okrętu — lustro dopisuje drugą burtę. Płyty pancerza mają rowy maszynowni od sąsiadów same (szczelina klocka),
 * rdzeń dziobu między klinami to klocek ramy (maszynownia). Wzór: układ Custosa (rufa-nadbudówka, grzbiet, burty,
 * kliny dziobu), nie kopia sprite'a.
 */
function blocksFrigate() {
  // klocek z pudła [x0, x1] × [y0, y1] (pełne wymiary na siatce)
  const blk = (shape, x0, y0, x1, y1, level, o = {}) => ({ kind: 'block', shape, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0, level, ...o });
  return {
    v: 2, name: 'Fregata z klocków (TN)', style: 'chamfer', mirror: true, palette: 'terra', seed: 71, detail: 0.09, grid: 0.5,
    windows: 0, bevel: 1.9, round: 1, panels: 0.55,
    pipeNet: { density: 1 },
    blocks: [],
    shapes: [
      blk('rect', -66, -28, -46, 28, 2, { c: [6, 0, 0, 6] }),     // rufa: nadbudówka na osi, ścięte rogi rufowe
      blk('trap', -66, -34, -50, -28, 1, { a: 0, b: 6 }),         // skrzydło rufy
      blk('rect', -46, -8, -14, 8, 1),                            // grzbiet rufowy (na osi)
      blk('rect', -14, -8, 26, 8, 1),                             // grzbiet dziobowy
      blk('rect', -46, -24, -10, -8, 1, { c: [4, 0, 0, 0] }),     // burta rufowa
      blk('rect', -10, -24, 26, -8, 1),                           // burta dziobowa
      blk('trap', 26, -24, 76, -4, 1, { a: 0, b: 40 }),           // klin dziobu
      blk('rect', 26, -4, 68, 4, 0),                              // rdzeń dziobu: maszynownia między klinami
      blk('trap', -42, -22, -22, -12, 2, { a: 4, b: 4 }),         // nadbudówka burty z iluminatorem
      blk('rect', -45, -5, -35, 5, 2)                             // wieża mostka
    ],
    modules: [
      { type: 'engine', x: -69, y: -12, w: 4.6, h: 3.4, n: 1, v: 0 },
      { type: 'bridge', x: -40, y: 0, w: 4, h: 3.2 },
      { type: 'reactor', x: -22, y: 0, r: 4.5, v: 1 },
      { type: 'turret_m', x: 8, y: 0, r: 3.2, v: 0 },
      { type: 'turret_s', x: 10, y: -16, r: 2.6, v: 0 },
      { type: 'well', x: -32, y: -17, r: 3.2, v: 1 },
      { type: 'vent', x: -56, y: -15, w: 1.2, h: 3.2, rot: 0, v: 1 },
      { type: 'vent', x: -4, y: 0, w: 4.3, h: 1.6, rot: 0, v: 1 },
      { type: 'hatch', x: -28, y: -10.5, w: 3.4, h: 1.2, rot: 0, v: 1 },
      { type: 'hatch', x: 18, y: -20, w: 3, h: 1.6, rot: 0, v: 1 }
    ],
    decals: [
      { kind: 'text', text: 'TERRA NOVA', x: 50, y: -8.5, w: 15.5, h: 2.1, rot: 0, color: TN_TEXT, opacity: 0.88, weight: 500 },
      { kind: 'emblem', id: 'eagle', x: 44, y: -14, w: 6.4, h: 5.2, rot: 0, color: TN_EMBLEM, opacity: 0.9 }
    ]
  };
}

/** Okręt złożony z gotowych części (src/game/hullDesign/hullDesignParts.js) na ramie z bloków — punkt wyjścia. */
function tnParts() {
  const b = [];
  fill(b, -5, 3, -2, -1, 0);
  fill(b, -4, 2, -2, -2, 1);
  fill(b, -4, -2, -1, -1, 1);
  fill(b, 1, 2, -1, -1, 1);
  return {
    v: 2, name: 'Fregata z części (TN)', style: 'chamfer', mirror: true, palette: 'terra', seed: 61, detail: 0.42, windows: 0, bevel: 1.9, round: 1,
    pipeNet: { density: 1 },
    blocks: b,
    shapes: [],
    modules: [
      { type: 'reactor', x: -60, y: 0, r: 16, v: 1 },
      { type: 'turret_m', x: 60, y: -95, r: 11, v: 0 }
    ],
    parts: [
      { id: 'tn_engines', x: -318, y: 0, s: 0.95 },
      { id: 'tn_bridge', x: -200, y: 0, s: 0.9 },
      { id: 'tn_spine', x: -20, y: 0, s: 0.7 },
      { id: 'tn_sponson', x: -60, y: -112, s: 0.9 },
      { id: 'tn_turret_block', x: 120, y: -60, s: 0.8 },
      { id: 'tn_port', x: -150, y: -80, s: 0.8 },
      { id: 'tn_bow', x: 186, y: 0, s: 1.0 }
    ],
    decals: [
      { kind: 'text', text: 'TERRA NOVA', x: 0, y: -84, w: 46, h: 7, rot: 0, color: TN_TEXT, opacity: 0.88, weight: 500 },
      { kind: 'emblem', id: 'eagle', x: -100, y: -95, w: 16, h: 13, rot: 0, color: TN_EMBLEM, opacity: 0.9 }
    ]
  };
}

/** Krążownik złożony WYŁĄCZNIE z gotowych części (bez bloków): rufa, dwie sekcje, mostek schodkowy, dziób klinowy. */
function tnParts2() {
  return {
    v: 2, name: 'Krążownik z części (TN)', style: 'chamfer', mirror: true, palette: 'terra', seed: 67, detail: 0.6, windows: 0, bevel: 1.9, round: 1,
    pipeNet: { density: 1 },
    blocks: [],
    shapes: [],
    modules: [{ type: 'turret_l', x: 60, y: 0, r: 16, v: 0 }, { type: 'turret_m', x: -40, y: -40, r: 11, v: 0 }],
    parts: [
      { id: 'tn_stern', x: -420, y: 0, s: 1 },
      { id: 'tn_mid', x: -230, y: 0, s: 1 },
      { id: 'tn_mid', x: 10, y: 0, s: 1 },
      { id: 'tn_bridge_tall', x: -250, y: 0, s: 1 },
      { id: 'tn_sponson', x: -40, y: -74, s: 1 },
      { id: 'tn_turret_block', x: 60, y: 0, s: 0.95 },
      { id: 'tn_bow_blade', x: 130, y: 0, s: 1.2 }
    ],
    decals: [
      { kind: 'text', text: 'TERRA NOVA', x: 150, y: -36, w: 52, h: 8, rot: 0, color: TN_TEXT, opacity: 0.88, weight: 500 },
      { kind: 'emblem', id: 'eagle', x: -120, y: -48, w: 22, h: 17, rot: 0, color: TN_EMBLEM, opacity: 0.9 }
    ]
  };
}

export const HD_PRESETS = Object.freeze({
  custos: { label: 'TN · fregata Custos', make: custos },
  hasta: { label: 'TN · niszczyciel Hasta', make: hasta },
  bellator: { label: 'TN · pancernik Bellator', make: bellator },
  citadella: { label: 'TN · lotniskowiec Citadella', make: citadella },
  colossus: { label: 'TN · superkapitał Colossus', make: colossus },
  klocki: { label: 'Fregata z klocków (TN)', make: blocksFrigate },
  tnparts: { label: 'Fregata z gotowych części (TN)', make: tnParts },
  tnparts2: { label: 'Krążownik z gotowych części (TN)', make: tnParts2 },
  orbis: { label: 'Krążownik Orbis (koło w środku)', make: orbis },
  atlas2: { label: 'Atlas II (w stylu Atlasa)', make: atlasLike },
  destroyer: { label: 'Niszczyciel Hasta-D', make: destroyer },
  pirate: { label: 'Szakal — asymetryczny pirat', make: pirate },
  empty: { label: 'Pusty (od zera)', make: empty }
});
export const HD_PRESET_KEYS = Object.freeze(Object.keys(HD_PRESETS));

/** Świeża kopia gotowego projektu (znormalizowana) ze slotami systemów (hullDesignSystemSlots.js). */
export function hullDesignPreset(key) {
  const k = HD_PRESETS[key] ? key : 'orbis';
  return normalizeHullDesign(applySystemSlots(k, HD_PRESETS[k].make()));
}
