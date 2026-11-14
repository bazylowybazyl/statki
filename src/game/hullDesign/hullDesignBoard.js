// src/game/hullDesign/hullDesignBoard.js
//
// KREATOR KADŁUBÓW — UKŁAD MASZYNOWNI „JAK PŁYTKA DRUKOWANA” (PROTOTYP DO MAKIETY, czysty: bez three i DOM; niewpięty —
// kompozytor rysuje dziś maszynownię po staremu). Propozycja: docs/PROPOZYCJA-kreator-plytka.md, makieta:
// scripts/kreator-plytka-makieta.mjs, test: tests/hullDesignBoard.test.mjs.
//
// Wejście: pole kadłuba po etapie GEOMETRII i SIECI (`buildHullField` / budowa w hullDesignBuild.js: `levels`, `grid`,
// `expanded.modules`, `pipeNet`). Odsłonięta maszynownia = rama (poziom 0 < 0) bez płyt (poziom 1 ≥ 0), bez modułów,
// kanałów serwisowych i wiązek sieci. Wynik — lista elementów układu + dwa pola na siatce PÓŁ-kadłuba (y ≤ 0; burta
// y > 0 to lustro z konstrukcji, także gdy projekt nie ma lustra — układ jest ozdobą, nie systemem):
//   D  — odległość od ściany rowu [jd] w metryce ośmiokątnej (fazowanie 1 / √2) — ściany to płyty, sylwetka, moduły
//        i WIĄZKI SIECI, więc szyny (izolinie D) biegną równolegle do brzegów rowu, obwodzą moduły i towarzyszą rurom,
//        a ich rogi są pod 45°;
//   T  — grubość lokalna [jd] (średnica największego koła wpisanego, które obejmuje komórkę) — miara „ile miejsca”:
//        z niej liczba szyn przy ścianie i klasa wielkości elementów (duże w głębi i na osi, drobne przy brzegach);
// elementy: KRĘGOSŁUP (podłużne kapsuły na osi, symetryczne), KWARTAŁY w klasach wielkości na siatce wyrównanej do osi
// i do początku układu (drzewo czwórkowe: 96 → 48 → 24 → 12 → 6 jd), ŚCIEŻKI od elementów do najbliższej szyny
// (start pod 90° z boku elementu, skręt o 45° tylko gdy prosto nie zbliża do ściany, koniec przelotką na szynie).
// Wszystko deterministyczne: hasz z ziarna projektu i całkowitych numerów komórek — to samo pole = ten sam układ.
//
// Rozmiary w jd (jednostkach detalu, `design.detail` j./jd) — drednot (1,5 j./jd, rów setek jd) i Bellator (0,37 j./jd,
// rowy ~12 jd) dostają tę samą zasadę, a wąski rów schodzi sam do najmniejszej klasy (6–12 jd: skrzynki, walce, kraty
// jak dzisiejsza maszynownia) bez szyn przy ścianach.

import { pipeModuleSdf } from './hullDesignPipes.js';
import { serviceChannel, serviceChannelSdf } from './hullDesignSystems.js';

/**
 * Warianty ZASADY układu (pole projektu `board.variant`; różnią się zasadą, nie barwą). Wymiary w jd.
 * Szyny: izolinie D = r_k = ringR0 + k · ringPitch tam, gdzie T ≥ ringT · r_k + ringRoom (A: pas szyn przy ścianie
 * ≤ 1/5 grubości — szeroki rów dostaje szeroki pas zagnieżdżonych obrysów, wąski żaden). Dzielnice (districtJd): rodzaj
 * i ton elementów klas 24–6 jd wybiera dzielnica, nie komórka; mergeMax — ile sąsiednich komórek łączy się wzdłuż osi
 * okrętu w jedną dłuższą bryłę.
 */
export const HD_BOARD_VARIANTS = Object.freeze({
  // A — HIERARCHIA: kręgosłup na osi (tylko szeroki rów), duże kwartały w głębi i przy rdzeniach, pas do 6 szyn przy
  // ścianach i wokół modułów (szerokość z grubości rowu), ścieżki pod 90°
  A: Object.freeze({
    label: 'A · hierarchia (kręgosłup + kwartały)',
    rings: 6, ringR0: 3, ringPitch: 4, ringW: 1.4, ringRoom: 10, ringT: 5,
    sizes: Object.freeze([96, 48, 24, 12, 6]), wantK: 0.42, axisBoost: 1.2, coreBoost: 1.0, coreReach: 90,
    spine: true, spineLevels: Object.freeze([0, 1, 2]), spineH: 0.62, spineLen: 2, spineMinT: 150, bigMinT: 120,
    gap: 3.0, mergeMax: 3, districtJd: 160, stubs: Object.freeze([4, 2, 2, 1, 0]), stubP: 0.75, diagFirst: false, traceW: 1.3
  }),
  // B — MAGISTRALE: rów wypełniony zagnieżdżonymi obrysami (szyny co 5 jd aż do środka), elementy drobne między
  // szynami, bez kręgosłupa — struktura z samych równoległych do brzegu linii
  B: Object.freeze({
    label: 'B · magistrale (zagnieżdżone obrysy)',
    rings: 12, ringR0: 3, ringPitch: 5, ringW: 1.4, ringRoom: 9, ringT: 2,
    sizes: Object.freeze([24, 12, 6]), wantK: 0.5, axisBoost: 0, coreBoost: 0.4, coreReach: 60,
    spine: false, spineLevels: Object.freeze([]), spineH: 0.6, spineLen: 2, spineMinT: 0,
    gap: 3.0, mergeMax: 2, districtJd: 120, stubs: Object.freeze([2, 1, 0]), stubP: 0.6, diagFirst: true, traceW: 1.3
  }),
  // C — PŁASKA SIATKA: jednolita gęstość (trzy bliskie klasy wszędzie, bez wzmocnienia osi i rdzeni), jedna szyna,
  // ścieżki zaczynają się skosem — kontrprzykład dla A: porządek z samej siatki, bez hierarchii
  C: Object.freeze({
    label: 'C · płaska siatka (bez hierarchii)',
    rings: 1, ringR0: 3, ringPitch: 4, ringW: 1.4, ringRoom: 10, ringT: 2,
    sizes: Object.freeze([32, 16, 8]), wantK: 0.3, axisBoost: 0, coreBoost: 0, coreReach: 60,
    spine: false, spineLevels: Object.freeze([]), spineH: 0.6, spineLen: 2, spineMinT: 0,
    gap: 3.2, mergeMax: 1, districtJd: 96, stubs: Object.freeze([3, 3, 2]), stubP: 0.95, diagFirst: true, traceW: 1.3
  })
});

/**
 * Strojenie wspólne. Szerokości ścieżek i szyn ≥ 1,3 jd: kompozytor daje ~1,5 teksela/jd na KAŻDYM okręcie (drednot
 * 1,02 teksela/j. × 1,5 j./jd, Colossus 1,64 × 0,91, Bellator 4,06 × 0,37), więc 1,3 jd ≈ 2 teksele — cieńsza linia
 * migotałaby z daleka.
 */
export const HD_BOARD_TUNE = Object.freeze({
  cellJd: 1.5,        // komórka siatki układu [jd] (pole kadłuba ma ~1,43 jd — ta sama gęstość co raster sieci)
  runClearJd: 0.4,    // wiązka sieci = ściana: oś ± (pół-szerokość + luz)
  traceRJd: 3,        // zasięg pola odległości ścieżek [jd]
  stubMaxJd: 90,      // najdłuższa ścieżka [jd]
  maxElems: 65534,    // numer elementu 16-bitowy w rastrze (R + 256 · G, 0 — brak) — jak osprzęt sieci
  texW: 512           // szerokość tabeli elementów (2 teksele RGBA32F na element)
});

/**
 * KLASA WYSOKOŚCI elementu (tabela elementów, kanał dla zabudowy — temat 3 „miasto”): 0 — płaski detal, 1 — moduł,
 * 2 — blok kwartału, 3 — kapsuła kręgosłupa. Dziś tylko wysokość reliefu w kompozytorze.
 */
export const HD_BOARD_HEIGHT_CLASSES = Object.freeze({ flat: 0, module: 1, block: 2, spine: 3 });

/** Rodzaje elementów (kod w rastrze / tabeli elementów). */
export const HD_BOARD_KINDS = Object.freeze({ pod: 1, block: 2, module: 3, chip: 4, box: 5, cyl: 6, grate: 7, twin: 8, pad: 9, via: 10 });

const SQ2 = Math.SQRT2;

/** Hasz całkowity → [0, 1). */
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Odległość fazowana 1 / √2 w miejscu (0 — ściana, BIG — do policzenia); wiersz 0 to oś okrętu (nie ściana: komórka
 * za osią to lustro), poza resztą siatki — ściana w pół komórki.
 */
function chamfer(D, w, h, s1, s2) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = D[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, D[k - 1] + s1); else v = Math.min(v, s1 * 0.5);
      if (j > 0) {
        v = Math.min(v, D[k - w] + s1);
        if (i > 0) v = Math.min(v, D[k - w - 1] + s2);
        if (i + 1 < w) v = Math.min(v, D[k - w + 1] + s2);
      }
      D[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = D[k];
      if (v === 0) continue;
      if (i + 1 < w) v = Math.min(v, D[k + 1] + s1); else v = Math.min(v, s1 * 0.5);
      if (j + 1 < h) {
        v = Math.min(v, D[k + w] + s1);
        if (i + 1 < w) v = Math.min(v, D[k + w + 1] + s2);
        if (i > 0) v = Math.min(v, D[k + w - 1] + s2);
      } else v = Math.min(v, s1 * 0.5);
      D[k] = v;
    }
  }
  // drugi przebieg w przód (zakola przy osi — przebieg wstecz mógł poprawić komórki wyżej)
  for (let j = 1; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (D[k] === 0) continue;
      let v = Math.min(D[k], D[k - w] + s1);
      if (i > 0) v = Math.min(v, D[k - 1] + s1, D[k - w - 1] + s2);
      if (i + 1 < w) v = Math.min(v, D[k - w + 1] + s2);
      D[k] = v;
    }
  }
}

/**
 * Układ maszynowni z pola kadłuba. `opts`: { variant: 'A' | 'B' | 'C' | obiekt, seed } (seed domyślnie z projektu).
 * Zwraca { variant, detail, grid: { x0, cell, w, h } (wiersz j: y = −(j + 0,5) · cell), dom (Uint8: 1 — odsłonięta
 * maszynownia), D, T [jd] (Float32), id (Int32: element pod komórką, −1), tr (Float32: odległość od ścieżki [jd]),
 * elems [{ x, y, hw, hh [j.], L, kind, axis, seed, ch [j.] }], traces [{ pts [[x, y]…] [j.], w [jd], via }],
 * rings [{ r, t } — izolinia D = r [jd] tam, gdzie T ≥ t], stats }. Burta y > 0 — przez |y| (`hullBoardSample`).
 */
export function buildHullBoard(field, opts = {}) {
  const V = typeof opts.variant === 'object' && opts.variant ? opts.variant : HD_BOARD_VARIANTS[opts.variant || 'A'];
  const TN = HD_BOARD_TUNE;
  const design = field.expanded.design;
  const Du = design.detail || 1;
  const seed = ((opts.seed ?? ((design.seed || 0) * 7919 + (design.pipeNet?.seed || 0))) | 0) + 0x5bd1;
  const c = TN.cellJd * Du;                                  // komórka [j.]
  const b = field.bounds;
  const x0 = Math.floor((b.minX - c) / c) * c;
  const w = Math.ceil((b.maxX + c - x0) / c);
  const h = Math.ceil((Math.max(-b.minY, b.maxY) + c) / c);
  const n = w * h;
  const cx = (i) => x0 + (i + 0.5) * c;
  const cy = (j) => -(j + 0.5) * c;
  const stats = {};
  let t = performance.now();
  const lap = (k) => { const q = performance.now(); stats[k] = Math.round((q - t) * 10) / 10; t = q; };

  // ── DZIEDZINA: rama bez płyt; przeszkody — moduły, kanały serwisowe, wiązki sieci ───────────────────────────────
  const dom = new Uint8Array(n);
  const { grid } = field;
  const L0 = field.levels[0], L1 = field.levels[1];
  const sampleLv = (arr, x, y) => {
    const fx = (x - grid.x0) * grid.res - 0.5, fy = (y - grid.y0) * grid.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= grid.w || j + 1 >= grid.h) return field.band;
    const tx = fx - i, ty = fy - j, o = j * grid.w + i;
    return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + grid.w] * (1 - tx) + arr[o + grid.w + 1] * tx) * ty;
  };
  const edgeIn = 0.6 * Du;                                   // pół jd od sylwetki i od ściany płyty
  // projekt bez lustra: maszynownia odsłonięta po OBU burtach (część wspólna) — reszta zostaje dzisiejszymi komórkami
  const both = design.mirror === false;
  for (let j = 0; j < h; j++) {
    const y = cy(j);
    for (let i = 0; i < w; i++) {
      const x = cx(i);
      if (sampleLv(L0, x, y) < -edgeIn && sampleLv(L1, x, y) > edgeIn
        && (!both || (sampleLv(L0, x, -y) < -edgeIn && sampleLv(L1, x, -y) > edgeIn))) dom[j * w + i] = 1;
    }
  }
  const stampOut = (bx0, by0, bx1, by1, sdf) => {
    const i0 = Math.max(0, Math.floor((bx0 - x0) / c)), i1 = Math.min(w - 1, Math.ceil((bx1 - x0) / c));
    const j0 = Math.max(0, Math.floor(-by1 / c) - 1), j1 = Math.min(h - 1, Math.ceil(-by0 / c));
    for (let j = j0; j <= j1; j++) {
      const y = cy(j);
      for (let i = i0; i <= i1; i++) if (dom[j * w + i] && sdf(cx(i), y) < 0) dom[j * w + i] = 0;
    }
  };
  const modules = field.expanded.modules;
  const chanEng = new Set((field.pipeNet?.channels || []).map((k) => modules[k]));
  const pad = 0.8 * Du;
  for (const m of modules) {
    if (m.y > 0 && modules.some((o) => o !== m && o.type === m.type && Math.abs(o.x - m.x) < 1e-6 && Math.abs(o.y + m.y) < 1e-6)) continue;
    const R = m.r ? m.r * 1.3 : Math.hypot((m.w || 4) + (m.rim || 0), (m.h || 4) + (m.rim || 0));
    const mm = m.y > 0 ? { ...m, y: -m.y, rot: -(m.rot || 0) } : m;
    stampOut(mm.x - R - pad, mm.y - R - pad, mm.x + R + pad, mm.y + R + pad, (x, y) => pipeModuleSdf(mm, x, y) - pad);
    const ch = m.type === 'engine' ? (chanEng.has(m) ? serviceChannel(mm, Du, true) : null)
      : ((m.type === 'thruster_side' || m.type === 'fuel_tank') ? serviceChannel(mm, Du) : null);
    if (ch) {
      const Rc = Math.hypot(ch.w, ch.h) + pad;
      stampOut(ch.x - Rc, ch.y - Rc, ch.x + Rc, ch.y + Rc, (x, y) => serviceChannelSdf(ch, x, y) - pad);
    }
  }
  // wiązki sieci: odcinki łamanych (obie burty — po |y| — dają ten sam wynik przy lustrze sieci)
  const segs = [];
  for (const run of field.pipeNet?.runs || []) {
    const hw = (run.halfW || 1) + TN.runClearJd * Du;
    for (const pl of run.polys || []) {
      for (let k = 0; k + 1 < pl.length; k++) {
        let [ax, ay] = pl[k], [bx, by] = pl[k + 1];
        if (ay > hw && by > hw) { ay = -ay; by = -by; }
        else if (ay > 0 || by > 0) { if (ay + by > 0) { ay = -ay; by = -by; } }
        segs.push([ax, ay, bx, by, hw]);
      }
    }
  }
  for (const [ax, ay, bx, by, hw] of segs) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-9;
    stampOut(Math.min(ax, bx) - hw, Math.min(ay, by) - hw, Math.max(ax, bx) + hw, Math.max(ay, by) + hw, (x, y) => {
      const tt = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
      return Math.hypot(x - ax - vx * tt, y - ay - vy * tt) - hw;
    });
  }
  lap('dziedzina');

  // ── D: odległość od ściany rowu [jd], fazowanie 1 / √2 (izolinie ośmiokątne); oś okrętu nie jest ścianą ─────────
  const D = new Float32Array(n);
  const BIG = 1e9, s1 = TN.cellJd, s2 = TN.cellJd * SQ2;
  for (let k = 0; k < n; k++) D[k] = dom[k] ? BIG : 0;
  chamfer(D, w, h, s1, s2);
  lap('odleglosc');

  // ── T: grubość lokalna — największe koło wpisane obejmujące komórkę (propagacja (wartość, zasięg)) ───────────────
  const Vb = new Float32Array(n), Rr = new Float32Array(n);
  for (let k = 0; k < n; k++) { Vb[k] = D[k]; Rr[k] = D[k]; }
  const relax = (k, q, wgt) => {
    const r = Rr[q] - wgt;
    if (r < 0) return;
    if (Vb[q] > Vb[k] || (Vb[q] === Vb[k] && r > Rr[k])) { Vb[k] = Vb[q]; Rr[k] = r; }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!dom[k]) continue;
        if (i > 0) relax(k, k - 1, s1);
        if (j > 0) { relax(k, k - w, s1); if (i > 0) relax(k, k - w - 1, s2); if (i + 1 < w) relax(k, k - w + 1, s2); }
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        if (!dom[k]) continue;
        if (i + 1 < w) relax(k, k + 1, s1);
        if (j + 1 < h) { relax(k, k + w, s1); if (i + 1 < w) relax(k, k + w + 1, s2); if (i > 0) relax(k, k + w - 1, s2); }
      }
    }
  }
  // średnica + wygładzenie (okno 2 · rad + 1 komórek, tylko po dziedzinie) — progi szyn i klas bez szarpania wzdłuż ściany
  const T = new Float32Array(n);
  {
    const rad = 3, tmp = new Float32Array(n), cnt = new Float32Array(n);
    for (let j = 0; j < h; j++) {
      let s = 0, m = 0;
      const row = j * w;
      for (let i = -rad; i < w + rad; i++) {
        const a = i + rad, z = i - rad - 1;
        if (a < w && dom[row + a]) { s += Vb[row + a]; m++; }
        if (z >= 0 && z < w && dom[row + z]) { s -= Vb[row + z]; m--; }
        if (i >= 0 && i < w) { tmp[row + i] = s; cnt[row + i] = m; }
      }
    }
    for (let i = 0; i < w; i++) {
      let s = 0, m = 0;
      for (let j = -rad; j < h + rad; j++) {
        const a = j + rad, z = j - rad - 1;
        if (a < h) { s += tmp[a * w + i]; m += cnt[a * w + i]; }
        if (z >= 0 && z < h) { s -= tmp[z * w + i]; m -= cnt[z * w + i]; }
        if (j >= 0 && j < h) { const k = j * w + i; T[k] = dom[k] && m > 0 ? 2 * s / m : 0; }
      }
    }
  }
  lap('grubosc');

  // ── SZYNY: izolinie D = r_k tam, gdzie T ≥ 2 r_k + ringRoom (wąski rów — mniej szyn, w końcu żadna) ───────────────
  const rings = [];
  for (let k = 0; k < V.rings; k++) {
    const r = V.ringR0 + k * V.ringPitch;
    rings.push({ r, t: (V.ringT || 2) * r + V.ringRoom });
  }
  const zoneD = (Tv) => {
    let kk = -1;
    for (let k = 0; k < rings.length; k++) if (Tv >= rings[k].t) kk = k;
    return kk < 0 ? V.gap * 0.5 : rings[kk].r + V.ringW * 0.5 + V.gap * 0.5;
  };

  // maska „wolno stawiać” (D ≥ strefa szyn) i sumy prefiksowe złych komórek — test pudła w O(1)
  const bad = new Int32Array((w + 1) * (h + 1));
  for (let j = 0; j < h; j++) {
    let row = 0;
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!(dom[k] && D[k] >= zoneD(T[k]))) row++;
      bad[(j + 1) * (w + 1) + i + 1] = bad[j * (w + 1) + i + 1] + row;
    }
  }
  const occ = new Uint8Array(n);
  const id = new Int32Array(n).fill(-1);
  const ci = (x) => Math.floor((x - x0) / c);
  const rj = (y) => Math.floor(-y / c);
  /** Pudło [x0, x1] × [ya, yb] (yb ≤ 0) w komórkach (włącznie). */
  const cellsOf = (ax, bx, ya, yb) => [Math.max(0, ci(ax + c * 0.01)), Math.min(w - 1, ci(bx - c * 0.01)), Math.max(0, rj(yb - c * 0.01)), Math.min(h - 1, rj(ya + c * 0.01))];
  const fits = (ax, bx, ya, yb) => {
    const [i0, i1, j0, j1] = cellsOf(ax, bx, ya, yb);
    if (i1 < i0 || j1 < j0) return false;
    if (ci(ax) < 0 || ci(bx) >= w || rj(ya) >= h) return false;
    const W1 = w + 1;
    const s = bad[(j1 + 1) * W1 + i1 + 1] - bad[j0 * W1 + i1 + 1] - bad[(j1 + 1) * W1 + i0] + bad[j0 * W1 + i0];
    return s === 0;
  };
  const free = (ax, bx, ya, yb) => {
    const [i0, i1, j0, j1] = cellsOf(ax, bx, ya, yb);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (occ[j * w + i]) return false;
    return true;
  };
  const mark = (ax, bx, ya, yb, v, eid = -1) => {
    const [i0, i1, j0, j1] = cellsOf(ax, bx, ya, yb);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { occ[j * w + i] = v; if (eid >= 0) id[j * w + i] = eid; }
  };
  const Tat = (x, y) => { const i = ci(x), j = rj(y); return i >= 0 && j >= 0 && i < w && j < h ? T[j * w + i] : 0; };
  const Dat = (x, y) => { const i = ci(x), j = rj(y); return i >= 0 && j >= 0 && i < w && j < h ? D[j * w + i] : 0; };
  const Daxis = (x) => Dat(x, -c * 0.5);
  const cores = modules.filter((m) => m.type === 'reactor' || ((m.type === 'grav_proj' || m.type === 'shield_gen') && (m.r || 0) >= 30))
    .map((m) => [m.x, -Math.abs(m.y)]);
  /** Pożądany rozmiar elementu [jd] w punkcie: grubość × k, więcej na osi i przy rdzeniach. */
  const want = (x, y) => {
    let k = V.wantK * Tat(x, y);
    const da = Math.max(1, Daxis(x));
    k *= 1 + V.axisBoost * Math.max(0, 1 - (-y / Du) / (da * 1.2));
    if (V.coreBoost > 0 && cores.length) {
      let dm = Infinity;
      for (const [mx, my] of cores) dm = Math.min(dm, Math.hypot(x - mx, y - my) / Du);
      k *= 1 + V.coreBoost * Math.exp(-dm / V.coreReach);
    }
    return k;
  };
  const elems = [];
  const KIND = HD_BOARD_KINDS;
  const HC = HD_BOARD_HEIGHT_CLASSES;
  // DZIELNICE: rodzaj (0 — chipy, 1 — zbiorniki, 2 — skrzynie, 3 — kraty i wentylatory) i ton z hasza dzielnicy
  const dSz = (V.districtJd || 160) * Du;
  const district = (x, y) => {
    const dI = Math.floor(x / dSz), dJ = Math.floor(-y / (dSz * 0.6));
    return { type: Math.floor(hash3(dI, dJ, seed + 99) * 4), tone: hash3(dI, dJ, seed + 101), merge: Math.floor(hash3(dI, dJ, seed + 103) * ((V.mergeMax || 0) + 1)) };
  };
  const add = (e, ax, bx, ya, yb) => {
    if (elems.length >= TN.maxElems) return false;
    const eid = elems.length;
    elems.push(e);
    mark(ax - V.gap * Du * 0.5, bx + V.gap * Du * 0.5, ya - V.gap * Du * 0.5, Math.min(0, yb + V.gap * Du * 0.5), 1);
    mark(ax - c * 0.5, bx + c * 0.5, ya - c * 0.5, Math.min(0, yb + c * 0.5), 1, eid);
    return true;
  };
  const g = V.gap * Du * 0.5;
  const minX = b.minX, maxX = b.maxX, minY = Math.min(b.minY, -b.maxY);

  // ── KRĘGOSŁUP: podłużne kapsuły na osi (symetryczne), najpierw największe ─────────────────────────────────────────
  if (V.spine) {
    for (const L of V.spineLevels) {
      const s = V.sizes[L] * Du, len = s * V.spineLen, hh = s * V.spineH * 0.5;
      for (let i = Math.floor(maxX / s); i * s + len > minX; i--) {
        const ax = i * s + g, bx = i * s + len - g;
        if (!fits(ax, bx, -hh - g, 0) || !free(ax, bx, -hh, 0)) continue;
        if (want((ax + bx) / 2, -hh * 0.5) < V.sizes[L] * 0.8) continue;
        if (Tat((ax + bx) / 2, -c * 0.5) < (V.spineMinT || 0)) continue;   // wąski rów (Bellator): bez kapsuł
        add({ x: (ax + bx) / 2, y: 0, hw: (bx - ax) / 2, hh, L, kind: KIND.pod, axis: true, seed: hash3(i, 7, seed), ch: hh * 0.9,
          hc: HC.spine, tone: 0.5 + hash3(i, 9, seed) * 0.2, dist: 0 }, ax, bx, -hh, 0);
      }
    }
  }

  // ── KWARTAŁY: drzewo czwórkowe, od największej klasy; klasa wolno tylko tam, gdzie „chce” jej grubość ───────────
  const nL = V.sizes.length;
  // najmniejsza klasa — dodatkowo na siatkach przesuniętych o pół komórki (wąskie i skośne rowy: drobny detal, nie pustka)
  const passes = [];
  for (let L = 0; L < nL; L++) passes.push([L, 0, 0]);
  passes.push([nL - 1, 0.5, 0], [nL - 1, 0, 0.5], [nL - 1, 0.5, 0.5]);
  for (const [L, ox, oy] of passes) {
    const sJd = V.sizes[L], s = sJd * Du, last = L === nL - 1;
    const iA = Math.floor(minX / s) - 1, iB = Math.ceil(maxX / s), jB = Math.ceil(-minY / s);
    for (let jj = 0; jj < jB; jj++) {
      for (let ii = iA; ii < iB; ii++) {
        const yb = -(jj + oy) * s, ya = yb - s;
        let ax = (ii + ox) * s, bx = ax + s;
        if (!fits(ax + g, bx - g, ya + g, yb - g) || !free(ax + g, bx - g, ya + g, yb - g)) continue;
        const wv = want((ax + bx) / 2, (ya + yb) / 2);
        if (!last && wv < sJd) continue;
        // klasy ≥ 48 jd tylko w szerokim rowie (wąski rów małego okrętu: drobny detal, bez obramowanych bloków)
        if (sJd >= 36 && Tat((ax + bx) / 2, (ya + yb) / 2) < (V.bigMinT || 0)) continue;
        const dc = district((ax + bx) / 2, (ya + yb) / 2);
        // łączenie sąsiadów wzdłuż osi okrętu w dłuższą bryłę (ile — dzielnica), gdy wolne i pasują
        if (!ox && !oy) {
          const extra = Math.min(dc.merge, Math.floor(hash3(ii, jj, seed + L * 131) * (dc.merge + 1.5)));
          for (let q = 0; q < extra; q++) {
            if (!(fits(bx + g, bx + s - g, ya + g, yb - g) && free(bx + g, bx + s - g, ya + g, yb - g) && (last || want(bx + s / 2, (ya + yb) / 2) >= sJd))) break;
            bx += s;
          }
        }
        const r = hash3(ii * 2 + (ox ? 1 : 0), jj * 2 + (oy ? 1 : 0), seed + L * 977 + 5);
        const long = (bx - ax) > s * 1.5;
        let kind;
        if (sJd >= 72) kind = KIND.block;
        else if (sJd >= 36) kind = (dc.type === 1 || dc.type === 3) ? (r < 0.75 ? KIND.module : KIND.block) : (r < 0.75 ? KIND.block : KIND.module);
        else {
          // dzielnica wybiera rodzinę; komórka — tylko odmianę w niej (rzadko obcy rodzaj)
          const fam = [
            [KIND.chip, KIND.chip, KIND.module, KIND.pad],     // chipy
            [KIND.cyl, KIND.cyl, KIND.twin, KIND.box],         // zbiorniki
            [KIND.box, KIND.box, KIND.module, KIND.twin],      // skrzynie
            [KIND.grate, KIND.grate, KIND.module, KIND.box]    // kraty i wentylatory
          ][dc.type];
          kind = r < 0.85 ? fam[Math.floor(r / 0.85 * (long ? 2 : 3))] : fam[3];
          if (sJd < 8 && kind !== KIND.cyl && kind !== KIND.box) kind = r < 0.6 ? KIND.pad : KIND.box;
          if (kind === KIND.module && sJd < 16) kind = KIND.box;
        }
        const hc = sJd >= 72 ? HC.block : (sJd >= 36 ? HC.module : HC.flat);
        const ex0 = ax + g, ex1 = bx - g, ey0 = ya + g, ey1 = yb - g;
        add({ x: (ex0 + ex1) / 2, y: (ey0 + ey1) / 2, hw: (ex1 - ex0) / 2, hh: (ey1 - ey0) / 2, L: Math.round(Math.log2(96 / sJd)), kind, axis: false,
          seed: hash3(ii * 2 + (ox ? 1 : 0), jj * 2 + (oy ? 1 : 0), seed + 31 * L), ch: Math.min(ex1 - ex0, ey1 - ey0) * (sJd >= 36 ? 0.18 : 0.1),
          hc, tone: Math.min(1, Math.max(0, dc.tone + (r - 0.5) * 0.12)), dist: dc.type }, ex0, ex1, ey0, ey1);
      }
    }
  }
  lap('elementy');

  // ── ŚCIEŻKI: z boku elementu ku najbliższej szynie (90°, skręt 45° gdy prosto nie zbliża), przelotka na końcu ─────
  const traces = [];
  const DIRS = [[1, 0], [SQ2 / 2, SQ2 / 2], [0, 1], [-SQ2 / 2, SQ2 / 2], [-1, 0], [-SQ2 / 2, -SQ2 / 2], [0, -1], [SQ2 / 2, -SQ2 / 2]];
  const idAt = (x, y) => { const i = ci(x), j = rj(y); return i >= 0 && j >= 0 && i < w && j < h ? id[j * w + i] : -2; };
  const domAt = (x, y) => { const i = ci(x), j = rj(y); return i >= 0 && j >= 0 && i < w && j < h ? dom[j * w + i] : 0; };
  const sizeIdx = (e) => Math.max(0, Math.min(V.stubs.length - 1, V.sizes.findIndex((sz) => Math.abs(sz * Du - Math.max(e.hw, e.hh) * 2) < sz * Du * 0.75)));
  const stepL = c;
  for (let ei = 0; ei < elems.length; ei++) {
    const e = elems[ei];
    let nS = e.kind === KIND.pod ? 2 : V.stubs[sizeIdx(e)] || 0;
    if (!nS || hash3(ei, 3, seed) > V.stubP) continue;
    // bok ku ścianie: najmniejsze D tuż za bokiem
    const off = g + c;
    const sides = [[1, 0, e.x + e.hw + off, e.y], [-1, 0, e.x - e.hw - off, e.y], [0, -1, e.x, e.y - e.hh - off]];
    if (!e.axis) sides.push([0, 1, e.x, Math.min(-c * 0.5, e.y + e.hh + off)]);
    let best = null;
    for (const sd of sides) { const dv = Dat(sd[2], sd[3]); if (domAt(sd[2], sd[3]) && (!best || dv < best.dv)) best = { sd, dv }; }
    if (!best) continue;
    const [nx, ny] = best.sd;
    const along = nx !== 0 ? e.hh : e.hw;
    for (let s = 0; s < nS; s++) {
      const f = (s + 1) / (nS + 1) - 0.5 + (hash3(ei, s, seed + 17) - 0.5) * 0.25 / nS;
      let px = nx !== 0 ? e.x + nx * e.hw : e.x + f * 2 * along;
      let py = nx !== 0 ? e.y + f * 2 * along : (e.axis && ny < 0 ? -e.hh : e.y + ny * e.hh);
      if (py > -c * 0.25) continue;
      let dir = DIRS.findIndex(([a, bb]) => Math.abs(a - nx) < 1e-6 && Math.abs(bb - ny) < 1e-6);
      const pts = [[px, py]];
      let turns = 0, len = 0, via = false;
      const target = (() => { const Tv = Tat(px, py); let r = V.gap * 0.5; for (const rg of rings) if (Tv >= rg.t) r = rg.r; return r; })();
      let curD = Dat(px + nx * off, py + ny * off);
      const diag = V.diagFirst && hash3(ei, s, seed + 23) < 0.6;
      while (len < TN.stubMaxJd * Du) {
        let [dx, dy] = DIRS[dir];
        // po wyjściu z odstępu elementu: skręt 45° gdy prosto nie zbliża do ściany (albo od razu w C / B)
        if (len >= off && turns < 3) {
          const dS = Dat(px + dx * stepL * 2, py + dy * stepL * 2);
          const tryTurn = (diag && turns === 0) || dS >= curD - 0.25 * stepL / Du;
          if (tryTurn) {
            const a = (dir + 1) & 7, bD = (dir + 7) & 7;
            const da = Dat(px + DIRS[a][0] * stepL * 2, py + DIRS[a][1] * stepL * 2), db = Dat(px + DIRS[bD][0] * stepL * 2, py + DIRS[bD][1] * stepL * 2);
            const nd = da < db ? a : bD, dn = Math.min(da, db);
            if (dn < Math.min(dS, curD) - 0.1) { pts.push([px, py]); dir = nd; turns++; [dx, dy] = DIRS[dir]; }
          }
        }
        let qx = px + dx * stepL, qy = py + dy * stepL;
        if (qy > -c * 0.25 || !domAt(qx, qy)) { via = true; break; }
        let q = idAt(qx, qy);
        if (len > off * 0.5 && q >= 0 && q !== ei) {
          // przed nami cudzy element: skręt 90° w ulicę (ku niższemu D), dalej jej środkiem; brak wyjścia — przelotka
          if (turns >= 4) { via = true; break; }
          const a = (dir + 2) & 7, bD = (dir + 6) & 7;
          const okA = idAt(px + DIRS[a][0] * stepL, py + DIRS[a][1] * stepL) < 0 && domAt(px + DIRS[a][0] * stepL, py + DIRS[a][1] * stepL);
          const okB = idAt(px + DIRS[bD][0] * stepL, py + DIRS[bD][1] * stepL) < 0 && domAt(px + DIRS[bD][0] * stepL, py + DIRS[bD][1] * stepL);
          if (!okA && !okB) { via = true; break; }
          const da = okA ? Dat(px + DIRS[a][0] * stepL * 3, py + DIRS[a][1] * stepL * 3) : Infinity;
          const db = okB ? Dat(px + DIRS[bD][0] * stepL * 3, py + DIRS[bD][1] * stepL * 3) : Infinity;
          pts.push([px, py]); dir = da <= db ? a : bD; turns++;
          [dx, dy] = DIRS[dir];
          qx = px + dx * stepL; qy = py + dy * stepL;
          if (qy > -c * 0.25) { via = true; break; }
          q = idAt(qx, qy);
          if (q >= 0 && q !== ei) { via = true; break; }
        }
        px = qx; py = qy; len += stepL;
        curD = Dat(px, py);
        if (len > off && curD <= target + 0.01) { via = true; break; }
      }
      pts.push([px, py]);
      if (len > off * 0.8) traces.push({ pts, w: V.traceW, via, e: ei });
    }
  }
  // pole odległości ścieżek [jd] (raster na siatce układu — jak przesunięcie od osi biegu w rastrze sieci)
  const tr = new Float32Array(n).fill(TN.traceRJd);
  const R = TN.traceRJd * Du;
  for (const tc of traces) {
    for (let k = 0; k + 1 < tc.pts.length; k++) {
      const [ax, ay] = tc.pts[k], [bx, by] = tc.pts[k + 1];
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-9;
      const i0 = Math.max(0, ci(Math.min(ax, bx) - R)), i1 = Math.min(w - 1, ci(Math.max(ax, bx) + R));
      const j0 = Math.max(0, rj(Math.max(ay, by) + R)), j1 = Math.min(h - 1, rj(Math.min(ay, by) - R));
      for (let j = j0; j <= j1; j++) {
        const y = cy(j);
        for (let i = i0; i <= i1; i++) {
          const x = cx(i);
          const tt = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
          const d = Math.hypot(x - ax - vx * tt, y - ay - vy * tt) / Du;
          const o = j * w + i;
          if (d < tr[o]) tr[o] = d;
        }
      }
    }
  }
  // przelotki na końcach ścieżek (element bez zajmowania miejsca — rysuje się tylko na wolnej komórce)
  for (const tc of traces) {
    if (!tc.via) continue;
    const [px, py] = tc.pts[tc.pts.length - 1];
    const r = 1.1 * Du, eid = elems.length;
    if (eid >= TN.maxElems) break;
    elems.push({ x: px, y: Math.min(py, -r), hw: r, hh: r, L: 9, kind: KIND.via, axis: false, seed: 0, ch: r * 0.6, hc: HC.flat, tone: 0.5, dist: 0 });
    const [i0, i1, j0, j1] = cellsOf(px - r - c * 0.5, px + r + c * 0.5, py - r - c * 0.5, Math.min(0, py + r + c * 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (id[j * w + i] < 0) id[j * w + i] = eid;
  }
  lap('sciezki');
  // ULICE: odległość od ścian i elementów [jd] — izolinia E = gap / 2 to ścieżka środkiem każdej ulicy między elementami
  // i obwódka wokół elementu w otwartym polu (zagnieżdżony obrys jak we wzorze)
  const E = new Float32Array(n);
  for (let k = 0; k < n; k++) E[k] = dom[k] ? BIG : 0;
  for (const e of elems) {
    if (e.kind === KIND.via) continue;
    const [i0, i1, j0, j1] = cellsOf(e.x - e.hw, e.x + e.hw, e.y - e.hh, Math.min(0, e.y + e.hh));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) E[j * w + i] = 0;
  }
  chamfer(E, w, h, s1, s2);
  lap('ulice');
  let domN = 0;
  for (let k = 0; k < n; k++) domN += dom[k];
  const byKind = {};
  for (const e of elems) { const nm = Object.keys(KIND).find((k) => KIND[k] === e.kind); byKind[nm] = (byKind[nm] || 0) + (e.axis ? 1 : 2); }
  stats.elems = elems.reduce((a, e) => a + (e.axis ? 1 : 2), 0);
  stats.byKind = byKind;
  stats.traces = traces.length * 2;
  stats.cells = n;
  stats.domArea = Math.round(domN * c * c * 2);
  return { variant: V, detail: Du, grid: { x0, cell: c, w, h }, dom, D, T, E, id, tr, elems, traces, rings, stats };
}

/**
 * Próbka układu w punkcie (x, y) [j.] (burta y > 0 — lustro): dom, D i tr dwuliniowo [jd], T i id najbliższe.
 * `out` — obiekt wielokrotnego użytku.
 */
export function hullBoardSample(board, x, y, out = {}) {
  const { x0, cell: c, w, h } = board.grid;
  const ya = -Math.abs(y);
  const fx = (x - x0) / c - 0.5, fy = -ya / c - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  out.dom = 0; out.D = 0; out.T = 0; out.E = 0; out.id = -1; out.tr = 99; out.y = ya;
  const inb = (ii, jj) => ii >= 0 && jj >= 0 && ii < w && jj < h;
  const ni = Math.round(fx), nj = Math.round(fy);
  const nI = Math.max(0, Math.min(w - 1, ni)), nJ = Math.max(0, Math.min(h - 1, nj));
  const kn = nJ * w + nI;
  out.T = board.T[kn]; out.id = board.id[kn];
  const tx = fx - i, ty = fy - j;
  let dSum = 0, rSum = 0, mSum = 0, eSum = 0;
  for (let q = 0; q < 4; q++) {
    const ii = i + (q & 1), jj = Math.max(0, j + (q >> 1));
    const wq = ((q & 1) ? tx : 1 - tx) * ((q >> 1) ? ty : 1 - ty);
    if (!inb(ii, jj)) { rSum += wq * 3; continue; }
    const k = jj * w + ii;
    dSum += wq * board.D[k]; rSum += wq * board.tr[k]; mSum += wq * board.dom[k]; eSum += wq * Math.min(64, board.E[k]);
  }
  out.D = dSum; out.tr = rSum; out.dom = mSum; out.E = eSum;
  return out;
}

/**
 * Stałe rysunku dla kompozytora (uniformy): szyny r_k = r0 + k · pitch (k < count) tam, gdzie T ≥ ringT · r_k + room;
 * szerokości [jd]: szyny, ścieżki, ulica (gap).
 */
export function hullBoardParams(board) {
  const V = board.variant;
  return { r0: V.ringR0, pitch: V.ringPitch, count: V.rings, ringT: V.ringT || 2, room: V.ringRoom, ringW: V.ringW, traceW: V.traceW, gap: V.gap };
}

/**
 * PAKIET TEKSTUR układu dla kompozytora (siatka pół-kadłuba, wiersz 0 = oś; kompozytor próbkuje w (x, −|y|)):
 *   a — RGBA8, filtr liniowy: R = D / 63,75 jd, G = E / 15,94 jd, B = odległość od ścieżki / 3,98 jd, A = T / 255 jd;
 *   b — RGBA8, bez filtra (textureLoad): R + 256 · G = numer elementu + 1 (0 — brak), B = 255 w dziedzinie układu;
 *   e — RGBA32F, szerokość HD_BOARD_TUNE.texW, 2 teksele na element: (x, y, pół-szer., pół-wys.) [j.],
 *       (rodzaj + 16 · klasa wysokości, klasa wielkości, ton 0–1, faza narożnika [j.]).
 * Zwraca { on, w, h, x0, cell, a, b, e, eW, eH, n, params } — ta sama funkcja w workerze i w kompozytorze (bez pakietu),
 * więc obie ścieżki dają te same bity.
 */
export function packHullBoardTextures(board) {
  if (!board) return { on: false, w: 1, h: 1, x0: 0, cell: 1, a: new Uint8Array(4), b: new Uint8Array(4), e: new Float32Array(4), eW: 1, eH: 1, n: 0, params: null };
  const { w, h, x0, cell } = board.grid;
  const n = w * h;
  const a = new Uint8Array(n * 4), b = new Uint8Array(n * 4);
  const q = (v, k) => { const x = Math.round(v * k); return x < 0 ? 0 : (x > 255 ? 255 : x); };
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    a[o] = q(board.D[k], 4);
    a[o + 1] = q(board.E[k], 16);
    a[o + 2] = q(board.tr[k], 64);
    a[o + 3] = q(board.T[k], 1);
    const id = board.id[k] + 1;
    b[o] = id & 255; b[o + 1] = (id >> 8) & 255; b[o + 2] = board.dom[k] ? 255 : 0; b[o + 3] = 255;
  }
  const ne = board.elems.length;
  const eW = HD_BOARD_TUNE.texW, eH = Math.max(1, Math.ceil(ne * 2 / eW));
  const e = new Float32Array(eW * eH * 4);
  board.elems.forEach((el, i) => {
    const o = i * 8;
    e[o] = el.x; e[o + 1] = el.y; e[o + 2] = el.hw; e[o + 3] = el.hh;
    e[o + 4] = el.kind + 16 * (el.hc || 0); e[o + 5] = el.L; e[o + 6] = el.tone ?? 0.5; e[o + 7] = el.ch || 0;
  });
  return { on: true, w, h, x0, cell, a, b, e, eW, eH, n: ne, params: hullBoardParams(board) };
}
