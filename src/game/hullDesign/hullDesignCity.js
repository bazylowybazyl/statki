// src/game/hullDesign/hullDesignCity.js
//
// KREATOR KADŁUBÓW — MASYW MIASTA na otwartym rowie osi okrętu (temat 3; czysty: bez three i DOM; niewpięty). Opis,
// parametry i koszty: docs/OPIS-miasto-3d.md. Budynki: hullDesignTowers.js, obraz: src/3d/hullCity3D/. Test:
// tests/hullDesignCity.test.mjs.
//
// ZASADA (wzór charakteru: zwarty ciemny masyw piętrzących się płyt na jasnym pancerzu — długi grzbiet z tarasami, nie
// osobne domy przy ulicach): rów osi to dziedzina płytki (`buildHullBoard`: rama bez płyt, bez modułów, kanałów
// serwisowych i WIĄZEK SIECI). Na siatce PÓŁ-kadłuba (y ≤ 0, lustro z konstrukcji) liczymy:
//   Dw — odległość od ściany rowu (płyty, sylwetka), Do — odległość od przeszkód w rowie (wiązki, moduły, kanały),
//   place (rdzenie, mostki, projektory, generatory — koło / obrys + luz) i sufit wysokości (stożki ostrzału gniazd broni,
//   rampa przy mostku), szerokość rowu w przekroju Wc(x) = max Dw (wygładzona) → wysokość przekroju Hs(x) (zwężanie ku
//   dziobowi, mały rów = bez miasta) i położenie względne r = Dw / Wc (0 — ściana, 1 — oś).
// MASYW to ZIGGURAT PŁYT: poziom k = komórki z r ≥ t_k, wyciągnięte do wysokości h_k · Hs — wielkie cokoły (poziom 0
// przerywają tylko ALEJE) zlewają budynki w pasma, wyższe poziomy przerywają też ULICE (kaniony). Poziomy rozkłada na
// prostokąty zachłannie (największy prostokąt w masce, póki duży), prostokąt przy osi = jedna płyta w lustrze. Na
// TARASACH (poziom k bez poziomu k + 1) i na szczycie stoją BUDYNKI z generatora wieżowców (klin schodzący ku ścianie,
// płyta-blok, hala; na szczycie płyty, wieże z uskokami, bliźniaki), co `domPitch` wzdłuż osi DOMINANTA (iglica albo
// wieża ponad grzbiet), przy placach rdzeni — wyższy pierścień. Wszystko z ziarna, w lustrze; sufit ostrzału obcina.
//
// Wynik (`buildHullCity`): { ok, reason, variant, boxes: Float32Array (HD_CITY_BOX_STRIDE na bryłę), nBoxes,
// lights: Float32Array (HD_CITY_LIGHT_STRIDE na światło), nLights, height: { x0, y0, cell, w, h, data } (mapa wysokości
// całego miasta, obie burty — do cieni), bounds, plazas, buildings (opis budynków do testów), stats }.
// Układ okrętu (x — dziób, y jak w projekcie). Bryła: [x, y, z0, z1, hw, hh, ch, bat, mat, tone, hasz 0–1, flagi
// (1 — poziom masywu, 2 — dominanta, 4 — budynek tarasu)]. Światło: [x, y, z, rozmiar, nx, ny, nz, kod = rodzaj + 4 · barwa
// + 16 · round(jasność · 63)].

import { pipeModuleSdf } from './hullDesignPipes.js';
import { hullDesignMountOf, isBridgeSocket } from './hullDesignSchema.js';
import { buildTower, mirrorTower, pointInBox, towerHash, HD_TOWER_MAT } from './hullDesignTowers.js';

export const HD_CITY_BOX_STRIDE = 12;
export const HD_CITY_LIGHT_STRIDE = 8;
export const HD_CITY_FLAGS = Object.freeze({ level: 1, dominant: 2, terrace: 4 });

/**
 * Warianty KOMPOZYCJI (różnią się zasadą, nie barwą). Poziomy: { r — próg położenia względnego, h — wierzch poziomu
 * (ułamek Hs), cut — 'avenue' (przerywają tylko aleje) | 'street' (aleje i ulice) }. top — wysokość budynków szczytu
 * (ułamek Hs), terrace — budynki tarasu (ułamek kroku poziomu), dom — dominanty, fam — rodziny (wagi).
 */
export const HD_CITY_VARIANTS = Object.freeze({
  // A — GRZBIET: trzy wielkie poziomy, gęsty szczyt płyt i wież, dominanty co ~620 j.
  A: Object.freeze({
    label: 'A · grzbiet z dominantami',
    levels: Object.freeze([{ r: 0, h: 0.16, cut: 'avenue' }, { r: 0.38, h: 0.28, cut: 'street' }, { r: 0.64, h: 0.44, cut: 'street' }]),
    levelBat: Object.freeze([0.55, 0.32, 0.28]),
    top: [0.7, 1.0], terrace: [0.2, 0.62], terraceP: 0.82, topP: 0.97, dom: { pitch: 620, k: [1.5, 1.9] },
    famTop: { slab: 5, stepped: 3, twin: 2, hall: 1 }, famTerrace: { slab: 5, wedge: 2, hall: 1 }, plot: [22, 60]
  }),
  // B — TARASY: pięć niższych poziomów — długie płyty ze szczelinami jak schody, mało wież (najbliżej „pokładu z płyt”)
  B: Object.freeze({
    label: 'B · tarasy (długie płyty)',
    levels: Object.freeze([
      { r: 0, h: 0.08, cut: 'avenue' }, { r: 0.24, h: 0.19, cut: 'avenue' }, { r: 0.44, h: 0.31, cut: 'street' },
      { r: 0.63, h: 0.45, cut: 'street' }, { r: 0.8, h: 0.6, cut: 'street' }
    ]),
    levelBat: Object.freeze([0.5, 0.4, 0.35, 0.3, 0.3]),
    top: [0.72, 0.98], terrace: [0.2, 0.6], terraceP: 0.5, topP: 0.85, dom: { pitch: 900, k: [1.25, 1.45] },
    famTop: { slab: 5, stepped: 2, hall: 2, twin: 1 }, famTerrace: { wedge: 3, slab: 3, hall: 2 }, plot: [36, 90]
  }),
  // C — SKUPISKA WIEŻ: niski cokół, mało poziomów, gęsty las wież na szczycie i tarasach, dominanty co ~380 j.
  C: Object.freeze({
    label: 'C · skupiska wież',
    levels: Object.freeze([{ r: 0, h: 0.12, cut: 'avenue' }, { r: 0.42, h: 0.2, cut: 'street' }]),
    levelBat: Object.freeze([0.5, 0.3]),
    top: [0.55, 1.1], terrace: [0.5, 1.4], terraceP: 0.85, topP: 0.95, dom: { pitch: 380, k: [1.4, 2.0] },
    famTop: { stepped: 4, twin: 3, spire: 2, slab: 2 }, famTerrace: { stepped: 3, slab: 3, twin: 1, wedge: 1 }, plot: [22, 52]
  })
});

/** Strojenie wspólne (j. świata; drednot: 1 j. ≈ 1 m). */
export const HD_CITY_TUNE = Object.freeze({
  cellK: 2.6,           // komórka siatki miasta = cellK · detal [j.] (drednot 3,9 j.)
  hMax: 190,            // wysokość przekroju przy pełnej szerokości rowu
  wMin: 70,             // pół-szerokość rowu, poniżej której nie ma miasta
  wRef: 460,            // pół-szerokość dająca pełną wysokość
  taperExp: 0.85,
  wSmooth: 80,          // wygładzenie szerokości wzdłuż osi
  axisWin: 150,         // oś rowu otwarta w oknie ± [j.] (moduł na osi z placem nie przerywa grzbietu)
  minRidge: 900,        // najkrótszy grzbiet [j.] (z oknem) — krótszy otwarty odcinek osi to plac, nie miasto
  wallClear: 9,         // od ściany rowu (płyty, sylwetka)
  obsClear: 6,          // od przeszkód w rowie (wiązki sieci, moduły, kanały)
  superRing: 12,        // płyta poziomu 1 do tylu j. od nadbudówki (L2 < 0) to jeszcze nadbudówka
  superClear: 12,       // od nadbudówek stojących w rowie (klin pokładu, grzbiety, wieża mostka) — ulica wokół nich
  plazaPad: Object.freeze({ reactor: 48, bridge: 34, grav_proj: 30, shield_gen: 30, other: 22 }),
  ringReach: 80, ringK: 1.3,    // pierścień wyższej zabudowy wokół placów rdzeni
  bridgeTop: 34, bridgeSlope: 0.3,   // mostek zwieńczeniem: zabudowa schodzi ku niemu tarasami (34 j. + 0,3 · odległość)
  fireSlope: 0.36, fireClear: 12, turretTop: Object.freeze({ S: 7, M: 10, L: 15, Capital: 24 }),
  avenue: [440, 700], avenueW: 26, street: [100, 200], streetW: 7,
  plotGap: 1.2,         // szczelina między budynkami jednej działki — rząd budynków to ciągła ściana, nie osobne domy
  terraceInset: 4, edgeInset: 3,
  minSide: 12,          // najkrótszy bok prostokąta poziomu / działki [j.]
  minLevelH: 5,
  levelBat: 0.3,        // pochylenie frontu poziomu (ułamek wysokości poziomu) — skos widoczny z góry
  maxLights: 64000,
  hmCell: 2             // komórka mapy wysokości [j.]
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SQ2 = Math.SQRT2;

function rng(seed) {
  let s = (seed | 0) ^ 0x2545f491;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.weighted = (w) => {
    const keys = Object.keys(w);
    let sum = 0;
    for (const k of keys) sum += w[k];
    let x = next() * sum;
    for (const k of keys) { x -= w[k]; if (x <= 0) return k; }
    return keys[keys.length - 1];
  };
  return next;
}

/** Odległość fazowana (1, √2) w miejscu; wiersz 0 = oś (sąsiad za osią to on sam), poza siatką — ściana. */
function chamfer(D, w, h, c) {
  const c2 = c * SQ2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = D[k];
      if (v === 0) continue;
      v = Math.min(v, i > 0 ? D[k - 1] + c : c * 0.5);
      if (j > 0) {
        v = Math.min(v, D[k - w] + c);
        if (i > 0) v = Math.min(v, D[k - w - 1] + c2);
        if (i + 1 < w) v = Math.min(v, D[k - w + 1] + c2);
      }
      D[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = D[k];
      if (v === 0) continue;
      v = Math.min(v, i + 1 < w ? D[k + 1] + c : c * 0.5);
      if (j + 1 < h) {
        v = Math.min(v, D[k + w] + c);
        if (i + 1 < w) v = Math.min(v, D[k + w + 1] + c2);
        if (i > 0) v = Math.min(v, D[k + w - 1] + c2);
      } else v = Math.min(v, c * 0.5);
      D[k] = v;
    }
  }
  for (let j = 1; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (D[k] === 0) continue;
      let v = Math.min(D[k], D[k - w] + c);
      if (i > 0) v = Math.min(v, D[k - 1] + c, D[k - w - 1] + c2);
      if (i + 1 < w) v = Math.min(v, D[k - w + 1] + c2);
      D[k] = v;
    }
  }
}

/**
 * Największy prostokąt maski w oknie [i0, i1] × [j0, j1] o bokach ≥ minS komórek (histogram wierszy). Zwraca
 * { a, i0, i1, j0, j1 } albo null.
 */
function largestRect(M, w, i0, i1, j0, j1, minS, hist, stI, stH) {
  let best = null;
  const n = i1 - i0 + 1;
  hist.fill(0, 0, n + 1);
  for (let j = j0; j <= j1; j++) {
    const row = j * w;
    for (let q = 0; q < n; q++) hist[q] = M[row + i0 + q] ? hist[q] + 1 : 0;
    hist[n] = 0;
    let sp = 0;
    for (let q = 0; q <= n; q++) {
      const hq = hist[q];
      let start = q;
      while (sp > 0 && stH[sp - 1] >= hq) {
        sp--;
        const hh = stH[sp], s0 = stI[sp];
        const wd = q - s0;
        if (hh >= minS && wd >= minS) {
          const a = hh * wd;
          if (!best || a > best.a) best = { a, i0: i0 + s0, i1: i0 + q - 1, j0: j - hh + 1, j1: j };
        }
        start = s0;
      }
      if (hq > 0) { stI[sp] = start; stH[sp] = hq; sp++; }
    }
  }
  return best;
}

/** Odcinki wzdłuż osi między cięciami: lista [x0, x1] [j.] dla zbioru cięć { x, w }. */
function segmentsBetween(xMin, xMax, cuts) {
  const out = [];
  let a = xMin;
  for (const c of cuts) {
    const b = c.x - c.w / 2;
    if (b - a > 1) out.push([a, b]);
    a = c.x + c.w / 2;
  }
  if (xMax - a > 1) out.push([a, xMax]);
  return out;
}

/**
 * Miasto z pola kadłuba (`buildHullField` / budowa kreatora: levels, grid, band, expanded) i układu płytki
 * (`buildHullBoard`). `opts`: { variant: 'A' | 'B' | 'C' | obiekt, seed, density (0–1,5, domyślnie 1), height
 * (mnożnik wysokości, 1), lights (gęstość świateł, 1; 0 — bez świateł) }.
 */
export function buildHullCity(field, board, opts = {}) {
  const t0 = performance.now();
  const stats = {};
  let tl = t0;
  const lap = (k) => { const q = performance.now(); stats[k] = Math.round((q - tl) * 10) / 10; tl = q; };
  const V = typeof opts.variant === 'object' && opts.variant ? opts.variant : HD_CITY_VARIANTS[opts.variant || 'A'] || HD_CITY_VARIANTS.A;
  const T = HD_CITY_TUNE;
  const design = field?.expanded?.design;
  const empty = (reason) => ({
    ok: false, reason, variant: V, boxes: new Float32Array(0), nBoxes: 0, lights: new Float32Array(0), nLights: 0,
    height: null, bounds: null, plazas: [], buildings: [], stats
  });
  if (!design || !board || !board.dom) return empty('brak układu płytki');
  const seed = ((opts.seed ?? (design.seed || 0) * 131) | 0) + 0x1c17;
  const density = clamp(opts.density ?? 1, 0, 1.5);
  const hK = clamp(opts.height ?? 1, 0.2, 2.5);
  const lightK = clamp(opts.lights ?? 1, 0, 3);
  const Du = design.detail || 1;
  const cg = clamp(T.cellK * Du, 2, 6);
  const modules = field.expanded.modules || [];

  // ── ZASIĘG: pudło szerokiej części dziedziny płytki (rów osi; wąskie rowy między płytami nie wchodzą) ────────────
  const bg = board.grid;
  let bx0 = Infinity, bx1 = -Infinity, byMax = 0;
  const wideJd = T.wMin * 0.5 / Du;
  for (let j = 0; j < bg.h; j++) {
    for (let i = 0; i < bg.w; i++) {
      const k = j * bg.w + i;
      if (!board.dom[k] || board.T[k] < 2 * wideJd) continue;
      const x = bg.x0 + (i + 0.5) * bg.cell;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      byMax = Math.max(byMax, (j + 1) * bg.cell);
    }
  }
  if (!(bx1 > bx0)) return empty('rów za wąski na miasto');
  const pad = 2 * cg;
  const gx0 = Math.floor((bx0 - pad) / cg) * cg;
  const gw = Math.ceil((bx1 + pad - gx0) / cg);
  const gh = Math.ceil((byMax + pad) / cg);
  const n = gw * gh;
  const cx = (i) => gx0 + (i + 0.5) * cg;
  const cy = (j) => -(j + 0.5) * cg;

  // ── MASKI: rów (rama bez płyt), dziedzina płytki, przeszkody ───────────────────────────────────────────────────
  const { grid } = field;
  const L0 = field.levels[0], L1 = field.levels[1];
  const sampleLv = (arr, x, y) => {
    const fx = (x - grid.x0) * grid.res - 0.5, fy = (y - grid.y0) * grid.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= grid.w || j + 1 >= grid.h) return field.band;
    const tx = fx - i, ty = fy - j, o = j * grid.w + i;
    return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + grid.w] * (1 - tx) + arr[o + grid.w + 1] * tx) * ty;
  };
  // ROW = rama bez pancerza (L1 odkryte) RAZEM z nadbudówkami stojącymi w nim (L2 < 0: klin pokładu, grzbiety, wieża
  // mostka — przy skorupie z obrysu wycięcia poziomu 1 otwierają rów, a nadbudówki w nim zostają): szerokość rowu liczy
  // się do ściany pancerza, nadbudówki są w nim przeszkodami (osobna odległość `Ds` — ulica wokół nich)
  const L2 = field.levels[2] || null;
  const trench = new Uint8Array(n), dom = new Uint8Array(n), sup = new Uint8Array(n);
  const edgeIn = 0.6 * Du;
  for (let j = 0; j < gh; j++) {
    const y = cy(j);
    const bj = Math.floor(-y / bg.cell);
    for (let i = 0; i < gw; i++) {
      const x = cx(i);
      const k = j * gw + i;
      if (sampleLv(L0, x, y) < -edgeIn) {
        // nadbudówka = jej płyta poziomu 1 (L2 jest wcięte względem L1 o fazę bloku — pierścień przy obrysie należy do
        // nadbudówki, nie do pancerza)
        if (sampleLv(L1, x, y) > edgeIn) trench[k] = 1;
        else if (L2 && sampleLv(L2, x, y) < T.superRing) { trench[k] = 1; sup[k] = 1; }
      }
      const bi = Math.floor((x - bg.x0) / bg.cell);
      if (bi >= 0 && bi < bg.w && bj >= 0 && bj < bg.h && board.dom[bj * bg.w + bi]) dom[k] = 1;
    }
  }
  const BIG = 1e9;
  const Dw = new Float32Array(n);
  for (let k = 0; k < n; k++) Dw[k] = trench[k] ? BIG : 0;
  chamfer(Dw, gw, gh, cg);
  // ROW OSI: komórki rowu połączone z osią przez przejścia szersze niż wMin (wąskie rowy między płytami odpadają)
  const main = new Uint8Array(n);
  {
    const st = [];
    for (let i = 0; i < gw; i++) if (Dw[i] >= T.wMin * 0.5) { main[i] = 1; st.push(i); }
    while (st.length) {
      const k = st.pop();
      const i = k % gw, j = (k - i) / gw;
      const nb = [i > 0 ? k - 1 : -1, i + 1 < gw ? k + 1 : -1, j > 0 ? k - gw : -1, j + 1 < gh ? k + gw : -1];
      for (const q of nb) if (q >= 0 && !main[q] && Dw[q] >= T.wMin * 0.35) { main[q] = 1; st.push(q); }
    }
    // dolewka: pas przy ścianach rowu osi (Dw < próg) — komórki rowu sąsiadujące z rowem osi w zasięgu wMin
    const near = new Float32Array(n);
    for (let k = 0; k < n; k++) near[k] = main[k] ? 0 : 1e9;
    chamfer(near, gw, gh, cg);
    for (let k = 0; k < n; k++) if (trench[k] && near[k] <= T.wMin * 0.4) main[k] = 1;
  }
  for (let k = 0; k < n; k++) if (!main[k]) { trench[k] = trench[k] ? 2 : 0; }
  const Do = new Float32Array(n);
  for (let k = 0; k < n; k++) Do[k] = trench[k] && !dom[k] && Dw[k] > 3 ? 0 : BIG;
  chamfer(Do, gw, gh, cg);
  const Ds = new Float32Array(n);
  for (let k = 0; k < n; k++) Ds[k] = sup[k] ? 0 : BIG;
  chamfer(Ds, gw, gh, cg);
  lap('maski');

  // ── PLACE i SUFIT (moduły w rowie, gniazda broni ze stożkiem ostrzału, mostki) ──────────────────────────────────
  const excl = new Uint8Array(n);
  const cap = new Float32Array(n).fill(T.hMax * hK * 2.2);
  const plazas = [];
  const ringOf = new Float32Array(n);    // 0..1 — pierścień wokół placu rdzenia
  const stampBox = (x0, y0, x1, y1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 - gx0) / cg)), i1 = Math.min(gw - 1, Math.ceil((x1 - gx0) / cg));
    const j0 = Math.max(0, Math.floor(-y1 / cg) - 1), j1 = Math.min(gh - 1, Math.ceil(-y0 / cg) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * gw + i, cx(i), cy(j));
  };
  const DECOR = new Set(['vent', 'grate', 'port', 'hatch']);
  for (const m of modules) {
    if (DECOR.has(m.type)) continue;
    const mount = hullDesignMountOf(m);
    const ext = Math.max(m.r || 0, m.w || 0, m.h || 0) * 1.6 + 40;
    // moduł w lustrze: oba (projekt rozwinięty — jest i ten z y > 0); liczymy tylko na pół-kadłubie (|y|)
    const my = -Math.abs(m.y);
    const mm = { ...m, y: my };
    if (mount && mount.slot !== 'hangar') {
      // gniazdo broni: wykluczenie + stożek ostrzału (sufit rośnie z odległością od brzegu wieży)
      const top = T.turretTop[mount.size] ?? 12;
      const r = (m.r || 10) * 1.22;
      const reach = (T.hMax * hK * 2.2 - top) / T.fireSlope + r + T.fireClear;
      stampBox(m.x - reach, my - reach, m.x + reach, my + reach, (k, x, y) => {
        // odległość od najbliższego punktu komórki (prostokąt sięga pół komórki poza środki komórek)
        const d = Math.max(0, Math.hypot(x - m.x, y - my) - cg * 0.75);
        if (d < r + T.fireClear * 0.5) excl[k] = 1;
        const c = top + Math.max(0, d - r - T.fireClear) * T.fireSlope;
        if (c < cap[k]) cap[k] = c;
      });
      continue;
    }
    const kind = m.type === 'reactor' ? 'reactor' : isBridgeSocket(m) || m.type === 'bridge' ? 'bridge' : m.type;
    const padM = T.plazaPad[kind] ?? T.plazaPad.other;
    // moduł daleko od rowu nic nie zmienia (skraca pętle)
    const near = (() => {
      const i = Math.round((m.x - gx0) / cg - 0.5), j = Math.round(-my / cg - 0.5);
      return i > -ext / cg && i < gw + ext / cg && j < gh + ext / cg;
    })();
    if (!near) continue;
    let any = false;
    const reachB = kind === 'bridge' ? (T.hMax * hK * 2.2 - T.bridgeTop) / T.bridgeSlope : kind === 'reactor' ? T.ringReach : 0;
    const R = ext + padM + reachB;
    stampBox(m.x - R, my - R, m.x + R, my + R, (k, x, y) => {
      if (!trench[k] && kind !== 'bridge') return;
      const sd = pipeModuleSdf(mm, x, y) - cg * 0.75;
      if (sd < padM) { excl[k] = 1; any = true; }
      if (kind === 'bridge') {
        const c = T.bridgeTop + Math.max(0, sd - padM) * T.bridgeSlope;
        if (c < cap[k]) cap[k] = c;
      } else if (kind === 'reactor' && sd >= padM && sd < padM + T.ringReach) {
        ringOf[k] = Math.max(ringOf[k], 1 - (sd - padM) / T.ringReach);
      }
    });
    if (any) plazas.push({ x: m.x, y: m.y, kind, r: (m.r || Math.max(m.w || 0, m.h || 0)) + padM });
  }
  lap('place');

  // ── ZABUDOWYWALNE, SZEROKOŚĆ PRZEKROJU, WYSOKOŚĆ ───────────────────────────────────────────────────────────────
  const B = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (trench[k] === 1 && !sup[k] && dom[k] && !excl[k] && Dw[k] >= T.wallClear && Do[k] >= T.obsClear && Ds[k] >= T.superClear
      && cap[k] >= T.minLevelH + 2) B[k] = 1;
  }
  const Wraw = new Float32Array(gw);
  for (let i = 0; i < gw; i++) {
    let m = 0;
    for (let j = 0; j < gh; j++) { const k = j * gw + i; if (B[k] && Dw[k] > m) m = Dw[k]; }
    Wraw[i] = m;
  }
  // wygładzenie: maksimum w oknie (szerokość nie spada w zakolach wiązki), potem średnia
  const sw = Math.max(1, Math.round(T.wSmooth / cg));
  const Wmx = new Float32Array(gw), Wc = new Float32Array(gw);
  for (let i = 0; i < gw; i++) {
    let m = 0;
    for (let q = Math.max(0, i - sw); q <= Math.min(gw - 1, i + sw); q++) m = Math.max(m, Wraw[q]);
    Wmx[i] = m;
  }
  for (let i = 0; i < gw; i++) {
    let s = 0, c = 0;
    for (let q = Math.max(0, i - sw); q <= Math.min(gw - 1, i + sw); q++) { s += Wmx[q]; c++; }
    Wc[i] = Wraw[i] > 0 ? s / c : 0;
  }
  // GRZBIET WZDŁUŻ OSI: miasto tylko w przekrojach, w których oś rowu jest otwarta i szeroka (okno ±axisWin — moduł na
  // osi z placem nie przerywa grzbietu); boczne rowy przy zamkniętej osi zostają bez zabudowy
  const axisRaw = new Uint8Array(gw);
  for (let i = 0; i < gw; i++) axisRaw[i] = trench[i] === 1 && Dw[i] >= T.wMin * 0.8 ? 1 : 0;
  const aw = Math.round(T.axisWin / cg);
  const axisOpen = new Uint8Array(gw);
  for (let i = 0; i < gw; i++) {
    let open = 0;
    for (let q = Math.max(0, i - aw); q <= Math.min(gw - 1, i + aw) && !open; q++) open = axisRaw[q];
    axisOpen[i] = open;
  }
  // grzbiet ma długość: krótsze odcinki otwartej osi (plac między płytami) — bez miasta
  for (let i = 0; i < gw;) {
    if (!axisOpen[i]) { i++; continue; }
    let j = i;
    while (j < gw && axisOpen[j]) j++;
    if ((j - i) * cg < T.minRidge) axisOpen.fill(0, i, j);
    i = j;
  }
  const Hs = new Float32Array(gw);
  let anyCol = false;
  for (let i = 0; i < gw; i++) {
    if (Wc[i] < T.wMin || !axisOpen[i]) continue;
    Hs[i] = T.hMax * hK * Math.pow(clamp((Wc[i] - T.wMin) / (T.wRef - T.wMin), 0, 1), T.taperExp);
    if (Hs[i] > 0) anyCol = true;
  }
  if (!anyCol) return empty('rów za wąski na miasto');
  // zasięg miasta wzdłuż osi
  let ix0 = gw, ix1 = -1;
  for (let i = 0; i < gw; i++) if (Hs[i] > 0) { ix0 = Math.min(ix0, i); ix1 = Math.max(ix1, i); }
  const R = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (B[k] && Hs[i] > 0) R[k] = clamp(Dw[k] / Math.max(1, Wc[i]), 0, 1);
  }
  lap('profil');

  // ── CIĘCIA: aleje (przerywają wszystkie poziomy) i ulice (poziomy ≥ 1 i działki) ────────────────────────────────
  const rnd = rng(seed);
  const xMin = cx(ix0) - cg / 2, xMax = cx(ix1) + cg / 2;
  const avenues = [], streets = [];
  {
    let x = xMax - rnd.range(T.avenue[0], T.avenue[1]) * 0.6;
    while (x > xMin + T.avenue[0] * 0.4) {
      avenues.push({ x, w: T.avenueW, kind: 2 });
      x -= rnd.range(T.avenue[0], T.avenue[1]);
    }
    avenues.sort((a, b) => a.x - b.x);
    let s = xMax - rnd.range(T.street[0], T.street[1]) * 0.5;
    while (s > xMin) {
      if (!avenues.some((a) => Math.abs(a.x - s) < T.street[0] * 0.5)) streets.push({ x: s, w: T.streetW, kind: 1 });
      s -= rnd.range(T.street[0], T.street[1]);
    }
    streets.sort((a, b) => a.x - b.x);
  }
  const cutsAll = [...avenues, ...streets].sort((a, b) => a.x - b.x);
  const cutMask = (cuts) => {
    const c = new Uint8Array(gw);
    for (const q of cuts) {
      const i0 = Math.floor((q.x - q.w / 2 - gx0) / cg), i1 = Math.floor((q.x + q.w / 2 - gx0) / cg);
      for (let i = Math.max(0, i0); i <= Math.min(gw - 1, i1); i++) c[i] = 1;
    }
    return c;
  };
  const cutAve = cutMask(avenues), cutAll = cutMask(cutsAll);
  // wysokość przekroju odcinka między alejami (jedna na odcinek — poziomy w odcinku mają wspólne wysokości)
  const segAve = segmentsBetween(xMin, xMax, avenues);
  const segHs = segAve.map(([a, b]) => {
    let s = 0, c = 0;
    for (let i = Math.max(ix0, Math.floor((a - gx0) / cg)); i <= Math.min(ix1, Math.floor((b - gx0) / cg)); i++) if (Hs[i] > 0) { s += Hs[i]; c++; }
    return c ? Math.round(s / c / 2) * 2 : 0;
  });
  const segOfX = (x) => { for (let s = 0; s < segAve.length; s++) if (x >= segAve[s][0] - 0.5 && x <= segAve[s][1] + 0.5) return s; return -1; };
  lap('ciecia');

  // ── POZIOMY ZIGGURATU ──────────────────────────────────────────────────────────────────────────────────────────
  const levels = V.levels;
  const NL = levels.length;
  const minS = Math.max(2, Math.round(T.minSide / cg));
  const hist = new Int32Array(gw + 2), stI = new Int32Array(gw + 2), stH = new Int32Array(gw + 2);
  const cover = [];                       // maska pokrycia prostokątami poziomu k (do tarasów)
  const levelRects = [];
  const buildings = [];                   // { spec, tower, mirrored, flags }
  const topOf = (si, k) => (k < 0 ? 0 : Math.max(T.minLevelH * (k + 1), Math.round(segHs[si] * levels[k].h * 2) / 2));
  for (let lv = 0; lv < NL; lv++) {
    const L = levels[lv];
    const cuts = L.cut === 'avenue' ? cutAve : cutAll;
    const M = new Uint8Array(n);
    for (let j = 0; j < gh; j++) for (let i = ix0; i <= ix1; i++) {
      const k = j * gw + i;
      if (!B[k] || cuts[i] || R[k] < L.r) continue;
      if (lv > 0 && !cover[lv - 1][k]) continue;
      const si = segOfX(cx(i));
      if (si < 0 || !segHs[si]) continue;
      if (cap[k] < topOf(si, lv) - 0.5 && cap[k] < topOf(si, lv - 1) + T.minLevelH) continue;
      M[k] = 1;
    }
    // poziomy wyżej: odsunięcie od brzegu poziomu niżej (taras ≥ terraceInset) — erozja pokrycia
    if (lv > 0) {
      const er = Math.max(1, Math.round(T.terraceInset / cg));
      const prev = cover[lv - 1];
      for (let j = 0; j < gh; j++) for (let i = ix0; i <= ix1; i++) {
        const k = j * gw + i;
        if (!M[k]) continue;
        for (let dj = -er; dj <= er && M[k]; dj++) for (let di = -er; di <= er; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0) continue;                      // za osią — lustro (pokryte)
          if (jj >= gh || ii < 0 || ii >= gw || !prev[jj * gw + ii]) { M[k] = 0; break; }
        }
      }
    }
    const C = new Uint8Array(n);
    const work = M.slice();
    const segs = segmentsBetween(xMin, xMax, L.cut === 'avenue' ? avenues : cutsAll);
    for (const [a, b] of segs) {
      const i0 = Math.max(ix0, Math.ceil((a - gx0) / cg - 0.5)), i1 = Math.min(ix1, Math.floor((b - gx0) / cg - 0.5));
      if (i1 - i0 + 1 < minS) continue;
      for (let it = 0; it < 24; it++) {
        const r = largestRect(work, gw, i0, i1, 0, gh - 1, minS, hist, stI, stH);
        if (!r || r.a < minS * minS * 2) break;
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) { work[j * gw + i] = 0; C[j * gw + i] = 1; }
        const x0 = gx0 + r.i0 * cg, x1 = gx0 + (r.i1 + 1) * cg;
        const y1 = -r.j0 * cg, y0 = -(r.j1 + 1) * cg;
        const si = segOfX((x0 + x1) / 2);
        const zb = topOf(si, lv - 1);
        let zt = topOf(si, lv);
        // sufit (ostrzał, mostek): najniższy w prostokącie
        let cmin = Infinity;
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) cmin = Math.min(cmin, cap[j * gw + i]);
        zt = Math.min(zt, cmin);
        if (zt - zb < T.minLevelH) {
          for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) C[j * gw + i] = 0;
          continue;
        }
        levelRects.push({ lv, x0, x1, y0, y1, zb, zt, axis: r.j0 === 0, si });
      }
    }
    cover.push(C);
  }
  lap('poziomy');

  // płyty poziomów → budynki rodziny 'plate'
  const addBuilding = (spec, flags) => {
    const t = buildTower({ ...spec, lights: lightK * (spec.lights ?? 1) });
    if (!t.boxes.length) return;
    buildings.push({ spec, flags, tower: t });
    if (!spec.sym) buildings.push({ spec: { ...spec, y: -spec.y }, flags, tower: mirrorTower(t), mirror: true });
  };
  for (const r of levelRects) {
    const hw = (r.x1 - r.x0) / 2;
    const batK = V.levelBat?.[r.lv] ?? T.levelBat;
    if (r.axis) {
      addBuilding({ x: (r.x0 + r.x1) / 2, y: 0, hw, hh: -r.y0, z0: r.zb, H: r.zt - r.zb, family: 'plate', batK, sym: true, axis: 'x', zMax: r.zt, seed: (seed + Math.round(r.x0) * 7 + r.lv * 131) | 0 }, HD_CITY_FLAGS.level);
    } else {
      addBuilding({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, hw, hh: (r.y1 - r.y0) / 2, z0: r.zb, H: r.zt - r.zb, family: 'plate', batK, axis: 'x', zMax: r.zt, seed: (seed + Math.round(r.x0) * 7 + Math.round(r.y0) * 3 + r.lv * 131) | 0 }, HD_CITY_FLAGS.level);
    }
  }

  // ── DZIAŁKI: tarasy (poziom bez poziomu wyżej) i szczyt ────────────────────────────────────────────────────────
  const domPitch = V.dom.pitch;
  const domPhase = rnd.range(0, domPitch);
  const plots = [];
  const ei = Math.max(1, Math.round(T.edgeInset / cg));
  const ti = Math.max(1, Math.round((T.terraceInset + 2) / cg));
  for (let lv = 0; lv < NL; lv++) {
    const C = cover[lv], U = lv + 1 < NL ? cover[lv + 1] : null;
    const P = new Uint8Array(n);
    for (let j = 0; j < gh; j++) for (let i = ix0; i <= ix1; i++) {
      const k = j * gw + i;
      if (!C[k] || cutAll[i]) continue;
      let ok = true;
      // od brzegu poziomu (ei) i od ściany poziomu wyżej (ti)
      for (let dj = -Math.max(ei, ti); dj <= Math.max(ei, ti) && ok; dj++) for (let di = -Math.max(ei, ti); di <= Math.max(ei, ti); di++) {
        const jj = j + dj < 0 ? -(j + dj) - 1 : j + dj, ii = i + di;
        const inner = Math.abs(dj) <= ei && Math.abs(di) <= ei;
        if (jj >= gh || ii < 0 || ii >= gw) { ok = false; break; }
        const kk = jj * gw + ii;
        if (inner && !C[kk]) { ok = false; break; }
        if (U && U[kk]) { ok = false; break; }
      }
      if (ok) P[k] = 1;
    }
    const segs = segmentsBetween(xMin, xMax, cutsAll);
    for (const [a, b] of segs) {
      const i0 = Math.max(ix0, Math.ceil((a - gx0) / cg - 0.5)), i1 = Math.min(ix1, Math.floor((b - gx0) / cg - 0.5));
      if (i1 - i0 + 1 < minS) continue;
      for (let it = 0; it < 40; it++) {
        const r = largestRect(P, gw, i0, i1, 0, gh - 1, minS, hist, stI, stH);
        if (!r || r.a < minS * minS) break;
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) P[j * gw + i] = 0;
        plots.push({ lv, top: !U, x0: gx0 + r.i0 * cg, x1: gx0 + (r.i1 + 1) * cg, y0: -(r.j1 + 1) * cg, y1: -r.j0 * cg, axis: r.j0 === 0 });
      }
    }
  }
  // zabudowa z najwyższą wartością sufitu w prostokącie
  const capIn = (x0, x1, y0, y1) => {
    let c = Infinity;
    const i0 = Math.max(0, Math.floor((x0 - gx0) / cg)), i1 = Math.min(gw - 1, Math.floor((x1 - gx0) / cg - 1e-6));
    const j0 = Math.max(0, Math.floor(-y1 / cg)), j1 = Math.min(gh - 1, Math.floor(-y0 / cg - 1e-6));
    let ring = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { c = Math.min(c, cap[j * gw + i]); ring = Math.max(ring, ringOf[j * gw + i]); }
    return { c, ring };
  };
  const domPicked = new Set();
  for (const p of plots) {
    // działki dłuższe niż plot[1] dzielone wzdłuż osi okrętu na kilka (szczelina plotGap)
    const len = p.x1 - p.x0;
    const want = rnd.range(V.plot[0], V.plot[1]);
    const nP = Math.max(1, Math.round(len / want));
    const step = len / nP;
    for (let q = 0; q < nP; q++) {
      const ax0 = p.x0 + q * step + (q > 0 ? T.plotGap / 2 : 0), ax1 = p.x0 + (q + 1) * step - (q < nP - 1 ? T.plotGap / 2 : 0);
      if (ax1 - ax0 < T.minSide) continue;
      const pr = towerHash(seed, Math.round(ax0 * 4), Math.round(p.y0 * 4) + p.lv * 7);
      if (pr > (p.top ? V.topP : V.terraceP) * density) continue;
      const xm = (ax0 + ax1) / 2;
      const si = segOfX(xm);
      if (si < 0) continue;
      const z0 = topOf(si, p.lv);
      const { c: capC, ring } = capIn(ax0, ax1, p.y0, p.y1);
      const hs = segHs[si];
      let H, fam, flags = HD_CITY_FLAGS.terrace;
      const pr2 = rng((seed ^ Math.round(xm * 13)) + Math.round(p.y0 * 7) + p.lv * 977);
      if (p.top) {
        H = hs * pr2.range(V.top[0], V.top[1]) - z0;
        fam = pr2.weighted(V.famTop);
        // dominanta: działka szczytu przy osi najbliżej punktu rytmu
        const rhythm = Math.round((xm - domPhase) / domPitch);
        const rx = domPhase + rhythm * domPitch;
        if (p.axis && Math.abs(xm - rx) < domPitch * 0.3 && !domPicked.has(rhythm)) {
          domPicked.add(rhythm);
          H = hs * pr2.range(V.dom.k[0], V.dom.k[1]) - z0;
          fam = pr2.weighted({ spire: 3, stepped: 3, twin: 2 });
          flags |= HD_CITY_FLAGS.dominant;
        }
      } else {
        const zNext = topOf(si, p.lv + 1);
        H = (zNext - z0) * pr2.range(V.terrace[0], V.terrace[1]);
        fam = pr2.weighted(V.famTerrace);
      }
      if (ring > 0) H *= 1 + (T.ringK - 1) * ring;
      H = Math.min(H, capC - z0);
      if (H < 6) continue;
      const hw = (ax1 - ax0) / 2;
      const zMax = Number.isFinite(capC) ? capC : undefined;
      if (p.axis) {
        addBuilding({ x: xm, y: 0, hw, hh: -p.y0, z0, H, family: fam, sym: true, zMax, seed: (seed * 31 + Math.round(xm * 3) + p.lv) | 0, face: [1, 0] }, flags);
      } else {
        addBuilding({ x: xm, y: (p.y0 + p.y1) / 2, hw, hh: (p.y1 - p.y0) / 2, z0, H, family: fam, zMax, seed: (seed * 31 + Math.round(xm * 3) + Math.round(p.y0) + p.lv) | 0, face: [0, -1] }, flags);
      }
    }
  }
  lap('dzialki');

  // ── ZBIÓRKA i MAPA WYSOKOŚCI (wspólne z katalogiem budynków — packHullCity) ───────────────────────────────────
  const pk = packHullCity(buildings, { maxLights: T.maxLights, hmCell: T.hmCell });
  const { boxes, lights, height } = pk;
  const nb = pk.nBoxes, top = pk.top;
  lap('mapa');
  stats.ms = Math.round((performance.now() - t0) * 10) / 10;
  stats.boxes = nb; stats.lights = pk.nLights; stats.buildings = buildings.length; stats.levelRects = levelRects.length;
  stats.plots = plots.length; stats.dominants = domPicked.size; stats.top = Math.round(top);
  stats.grid = `${gw}×${gh} (${cg.toFixed(2)} j.)`;
  return {
    ok: nb > 0, reason: nb > 0 ? '' : 'brak działek', variant: V, boxes, nBoxes: nb, lights, nLights: pk.nLights, height,
    bounds: pk.bounds,
    plazas, buildings: buildings.map((b) => ({ ...b.spec, family: b.tower.family, flags: b.flags, mirror: !!b.mirror, top: b.tower.top })),
    avenues, streets, stats,
    ...(opts.debug ? { debug: { gx0, cg, gw, gh, Wc, Hs, axisOpen, Wraw, Dw, trench, sup, axisRaw } } : {})
  };
}

/**
 * Pakowanie budynków ({ tower: wynik buildTower, flags }) do tablic obrazu: bryły (HD_CITY_BOX_STRIDE), światła
 * (HD_CITY_LIGHT_STRIDE; bez zasłoniętych przez cudze bryły, ponad `maxLights` — przerzedzone haszem miejsca) i mapa
 * wysokości (komórka `hmCell`; pochylone ściany jako rampy). Wspólne dla masywu i katalogu budynków (demo).
 */
export function packHullCity(buildings, opts = {}) {
  let nb = 0, nl = 0;
  for (const b of buildings) { nb += b.tower.boxes.length; nl += b.tower.lights.length; }
  const boxes = new Float32Array(nb * HD_CITY_BOX_STRIDE);
  const allBoxes = [];
  let o = 0;
  for (const bd of buildings) {
    for (const b of bd.tower.boxes) {
      allBoxes.push(b);
      boxes[o] = b.x; boxes[o + 1] = b.y; boxes[o + 2] = b.z0; boxes[o + 3] = b.z1;
      boxes[o + 4] = b.hw; boxes[o + 5] = b.hh; boxes[o + 6] = b.ch; boxes[o + 7] = b.bat;
      boxes[o + 8] = b.mat; boxes[o + 9] = b.tone;
      boxes[o + 10] = towerHash(Math.round(b.x * 4), Math.round(Math.abs(b.y) * 4), Math.round(b.z0 * 4));
      boxes[o + 11] = (bd.flags | 0);
      o += HD_CITY_BOX_STRIDE;
    }
  }
  // kubełki brył (zasłonięcie świateł przez cudze bryły)
  const BK = 32;
  const buckets = new Map();
  const bkey = (i, j) => i * 65536 + (j + 32768);
  allBoxes.forEach((b, idx) => {
    for (let i = Math.floor((b.x - b.hw) / BK); i <= Math.floor((b.x + b.hw) / BK); i++) {
      for (let j = Math.floor((b.y - b.hh) / BK); j <= Math.floor((b.y + b.hh) / BK); j++) {
        const kk = bkey(i, j);
        let arr = buckets.get(kk);
        if (!arr) buckets.set(kk, (arr = []));
        arr.push(idx);
      }
    }
  });
  const maxL = opts.maxLights ?? HD_CITY_TUNE.maxLights;
  const keep = nl > maxL ? maxL / nl : 1;
  const lightsArr = [];
  for (const bd of buildings) {
    for (const l of bd.tower.lights) {
      if (keep < 1 && towerHash(Math.round(l.x * 8), Math.round(Math.abs(l.y) * 8), Math.round(l.z * 8)) >= keep) continue;
      const arr = buckets.get(bkey(Math.floor(l.x / BK), Math.floor(l.y / BK)));
      let hid = false;
      if (arr) for (const idx of arr) if (pointInBox(allBoxes[idx], l.x, l.y, l.z, 0.05)) { hid = true; break; }
      if (!hid) lightsArr.push(l);
    }
  }
  const lights = new Float32Array(lightsArr.length * HD_CITY_LIGHT_STRIDE);
  o = 0;
  for (const l of lightsArr) {
    lights[o] = l.x; lights[o + 1] = l.y; lights[o + 2] = l.z; lights[o + 3] = l.s;
    lights[o + 4] = l.nx; lights[o + 5] = l.ny; lights[o + 6] = l.nz;
    lights[o + 7] = l.k + 4 * l.c + 16 * Math.round(clamp(l.i, 0, 1) * 63);
    o += HD_CITY_LIGHT_STRIDE;
  }

  // mapa wysokości
  let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity, top = 0;
  for (const b of allBoxes) {
    mx0 = Math.min(mx0, b.x - b.hw); mx1 = Math.max(mx1, b.x + b.hw);
    my0 = Math.min(my0, b.y - b.hh); my1 = Math.max(my1, b.y + b.hh); top = Math.max(top, b.z1);
  }
  let height = null;
  if (allBoxes.length) {
    const hc = opts.hmCell ?? HD_CITY_TUNE.hmCell;
    const hx0 = Math.floor((mx0 - 4) / hc) * hc, hy0 = Math.floor((my0 - 4) / hc) * hc;
    const hw = Math.ceil((mx1 + 4 - hx0) / hc), hh = Math.ceil((my1 + 4 - hy0) / hc);
    const data = new Float32Array(hw * hh);
    for (const b of allBoxes) {
      const H = b.z1 - b.z0;
      const i0 = Math.max(0, Math.floor((b.x - b.hw - hx0) / hc)), i1 = Math.min(hw - 1, Math.floor((b.x + b.hw - hx0) / hc));
      const j0 = Math.max(0, Math.floor((b.y - b.hh - hy0) / hc)), j1 = Math.min(hh - 1, Math.floor((b.y + b.hh - hy0) / hc));
      for (let j = j0; j <= j1; j++) {
        const y = hy0 + (j + 0.5) * hc;
        const ay = Math.abs(y - b.y);
        for (let i = i0; i <= i1; i++) {
          const x = hx0 + (i + 0.5) * hc;
          const ax = Math.abs(x - b.x);
          const sd = Math.max(ax - b.hw, ay - b.hh, b.ch > 0 ? (ax + ay - (b.hw + b.hh - b.ch)) / SQ2 : -1e9);
          if (sd > 0) continue;
          const zz = b.bat > 0.05 ? Math.min(b.z1, b.z0 + (-sd) * H / b.bat) : b.z1;
          const k = j * hw + i;
          if (zz > data[k]) data[k] = zz;
        }
      }
    }
    height = { x0: hx0, y0: hy0, cell: hc, w: hw, h: hh, data, top };
  }
  return {
    boxes, nBoxes: nb, lights, nLights: lightsArr.length, height, top,
    bounds: allBoxes.length ? { x0: mx0, x1: mx1, y0: my0, y1: my1, top } : null
  };
}

/** Wysokość miasta w punkcie (mapa wysokości; poza mapą 0). */
export function hullCityHeightAt(city, x, y) {
  const m = city?.height;
  if (!m) return 0;
  const i = Math.floor((x - m.x0) / m.cell), j = Math.floor((y - m.y0) / m.cell);
  if (i < 0 || j < 0 || i >= m.w || j >= m.h) return 0;
  return m.data[j * m.w + i];
}
