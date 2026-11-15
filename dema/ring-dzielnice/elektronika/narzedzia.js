// Dzielnica „Zakłady elektroniki” — narzędzia brył (dane PortRecorder, bez three).
//
// RAMKA PROSTA (`frameAt`): budynki zakładów są prostokątne, a pokłady to wycinki pierścienia. Ramka ma początek
// w punkcie łuku (sc, vc), oś u wzdłuż stycznej (+s) i oś w wzdłuż promienia (+v), obie w jednostkach świata —
// budynek do ~2 600 j. odchodzi od łuku o kilkanaście j., więc stoi na pokładzie z zapasem. `frameKit` daje
// na ramce krótkie nazwy: blk (prostopadłościan od spodu y0), cyl, cone, pipe, lit (bryła świecąca), lamp, label.
import { YARD_R0, ringScale, yardPoint } from '../kit/uklad.js';
import { PB_FX, PB_MAT, YARD_H, pbHash1, xzTools } from '../kit/sceny.js';

const M = PB_MAT;
const H = YARD_H;
const R0 = YARD_R0;

/** Spód tego, co stoi na pokładzie rzędu (wierzch płyty pokładu). */
export const DECK = H.deck + 6;

export function frameAt(sc, vc) {
  const p = sc / R0;
  const t = [Math.cos(p), -Math.sin(p)];
  const r = [Math.sin(p), Math.cos(p)];
  const o = yardPoint(sc, vc, [0, 0]);
  return { sc, vc, t, r, o, at: (u, w) => [o[0] + t[0] * u + r[0] * w, o[1] + t[1] * u + r[1] * w] };
}

export function frameKit(f, plates, labels, F, footprints = null) {
  const Q = xzTools(f, plates, labels);
  const [tx, tz] = F.t;
  const K = {
    F, Q, f,
    P: F.at,
    /** Prostopadłościan: środek (u, w), spód y0, wysokość h, `lu` wzdłuż stycznej, `lw` wzdłuż promienia. */
    blk(u, w, y0, h, lu, lw, mat) { Q.box(F.at(u, w), y0 + h / 2, lu, h, lw, mat, tx, tz); },
    lit(u, w, y0, h, lu, lw, mat, gain = 1, mode = PB_FX.steady, phase = 0, param = 0) {
      f.fx(gain, mode, phase, param);
      K.blk(u, w, y0, h, lu, lw, mat);
      f.nofx();
    },
    /** Prostopadłościan obrócony w planie: `len` wzdłuż kierunku o kącie `ang` (0 = +u, π/2 = +w). */
    rot(u, w, y0, h, len, wid, mat, ang) {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      Q.box(F.at(u, w), y0 + h / 2, len, h, wid, mat, tx * c + F.r[0] * s, tz * c + F.r[1] * s);
    },
    cyl(u, w, y0, h, r, mat) { Q.cyl(F.at(u, w), y0 + h / 2, r, h, mat); },
    litCyl(u, w, y0, h, r, mat, gain = 1, mode = PB_FX.steady, phase = 0, param = 0) {
      f.fx(gain, mode, phase, param);
      K.cyl(u, w, y0, h, r, mat);
      f.nofx();
    },
    cone(u, w, y0, h, r, mat) { const p = F.at(u, w); f.cone(p[0], y0 + h / 2, p[1], r, h, mat); },
    /** Rura pozioma (oś na wysokości y). */
    pipe(u0, w0, u1, w1, y, r, mat) { Q.pipe(F.at(u0, w0), F.at(u1, w1), y, r, mat); },
    beam(a, b, wid, mat) { Q.beam(F.at(a[0], a[1]), a[2], F.at(b[0], b[1]), b[2], wid, mat); },
    lamp(u, w, y, size, mat, gain = 1.2, mode = PB_FX.steady, phase = 0, param = 0) { Q.lamp(F.at(u, w), y, size, mat, gain, mode, phase, param); },
    label(text, u, w, width, depth, color, small = '', y = H.deck + 9, set = 'bg') { Q.label(text, F.at(u, w), width, depth, color, small, y, set, tx, tz); },
    /** Zgłoszenie obrysu budynku (test: obrys leży na bryłach układu). */
    claim(name, u0, u1, w0, w1) {
      if (footprints) footprints.push({ name, points: [F.at(u0, w0), F.at(u1, w0), F.at(u1, w1), F.at(u0, w1)] });
    }
  };
  return K;
}

/**
 * Korpusy kawałków stref (jak `bodies` zestawu, ale w wersji „czystej”): ciemna burta, wierzch z płyt stali
 * (bez jasnych płyt i bez losowych nadbudówek; w świetle lamp stal z płyt jest ciemniejsza od gładkiej „szyny”,
 * z której są dachy głównych hal i płyty placów); na licu od strony wylotów krawężnik, pas stali i KRÓTKIE
 * listwy świetlne (co ~380 j., wzmocnienie 1,0).
 */
export function korpusy(T, f, layout, zones, { strip = M.cyan, top = null } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.deck - H.keel, M.dark);
    const k = pbHash1(Math.round(p.s0 * 0.61 + p.v0 * 0.17) + 2.2);
    const d = 9 / ringScale(p.v0);
    T.sec(p.s0 + d, p.s1 - d, p.v0 + 9, p.v1 - 9, H.deck, 6, top ? top(p, k) : M.steel);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      const sw = ringScale(v);
      T.run(p.s0, p.s1, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
      const n = Math.max(1, Math.round(((p.s1 - p.s0) * sw) / 380));
      f.fx(1.0, PB_FX.steady);
      for (let i = 0; i < n; i++) T.box(p.s0 + ((p.s1 - p.s0) * (i + 0.5)) / n, v + sign * 3, H.wallLight, 96, 5, 6, strip);
      f.nofx();
    }
  }
}

/**
 * Hala „czysta”: cokół z szyn, korpus ze stali, pas okien, wąski pas barwy zakładu pod attyką, attyka.
 * Zwraca { top } — wysokość dachu (wierzch korpusu), na której stawia się urządzenia.
 */
export function hala(K, { u0, u1, w0, w1, h = 150, band = true, accent = M.paintCold, wall = M.steel, name = '' }) {
  const trim = wall === M.rail ? M.steel : M.rail;
  const uc = (u0 + u1) / 2;
  const wc = (w0 + w1) / 2;
  const lu = u1 - u0;
  const lw = w1 - w0;
  K.blk(uc, wc, DECK, 12, lu + 26, lw + 26, trim);
  K.blk(uc, wc, DECK + 12, h - 12, lu, lw, wall);
  if (band) K.blk(uc, wc, DECK + h * 0.5, 16, lu + 7, lw + 7, M.glass);
  K.blk(uc, wc, DECK + h - 24, 6, lu + 9, lw + 9, accent);
  for (const s of [-1, 1]) {
    K.blk(uc, wc + s * (lw / 2 - 7), DECK + h, 9, lu, 14, trim);
    K.blk(uc + s * (lu / 2 - 7), wc, DECK + h, 9, 14, lw - 28, trim);
  }
  if (name) K.claim(name, u0 - 13, u1 + 13, w0 - 13, w1 + 13);
  return { top: DECK + h, uc, wc, lu, lw, u0, u1, w0, w1 };
}

/** Wentylatory dachowe (filtry hali czystej): siatka nu × nw w prostokącie; `skip(i, j)` pomija pole. */
export function wentylatory(K, top, u0, u1, w0, w1, nu, nw, r = 58, skip = null) {
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nw; j++) {
      if (skip && skip(i, j)) continue;
      const u = u0 + ((u1 - u0) * (i + 0.5)) / nu;
      const w = w0 + ((w1 - w0) * (j + 0.5)) / nw;
      K.cyl(u, w, top, 6, r * 1.22, M.steel);
      K.cyl(u, w, top + 6, 12, r, M.steel);
      K.cyl(u, w, top + 18, 4, r * 0.74, M.dark);
      K.cyl(u, w, top + 18, 8, r * 0.26, M.paintCold);
    }
  }
}

/** Świetliki kalenicowe: żebra wzdłuż promienia w podanych u, każde z pasem szkła i krótkimi listwami światła. */
export function swietliki(K, top, us, w0, w1, { glow = M.cyan, gain = 0.9, dashes = 2 } = {}) {
  const wc = (w0 + w1) / 2;
  const lw = w1 - w0;
  for (const u of us) {
    K.blk(u, wc, top, 14, 44, lw, M.steel);
    K.blk(u, wc, top + 14, 4, 20, lw - 30, M.glass);
    for (let k = 0; k < dashes; k++) K.lit(u + 27, w0 + (lw * (k + 0.5)) / dashes, top, 4, 8, 96, glow, gain);
  }
}

/** Zbiornik stojący na jasnej podstawie: płaszcz, opaski, stożkowa głowica, króciec. Zwraca wysokość wierzchu. */
export function zbiornik(K, u, w, r, h, { body = M.steel, cap = M.paintCold, bands = 2, pad = true } = {}) {
  if (pad) K.blk(u, w, DECK, 8, r * 2.5, r * 2.5, M.rail);
  const y = DECK + 8;
  K.cyl(u, w, y, h, r, body);
  for (let k = 0; k < bands; k++) K.cyl(u, w, y + (h * (k + 1)) / (bands + 1) - 5, 10, r + 6, M.rail);
  K.cone(u, w, y + h, r * 0.5, r, cap);
  K.cyl(u, w, y + h, r * 0.5 + 14, r * 0.17, M.rail);
  return y + h + r * 0.5 + 14;
}

/** Zbiornik leżący na siodłach (oś wzdłuż u albo w): płaszcz, kołnierze, dennice w barwie zakładu. */
export function zbiornikLezacy(K, u, w, len, r, alongU, { body = M.rail, cap = M.paintCold } = {}) {
  const cy = DECK + 16 + r;
  const hl = len / 2;
  const seg = (a, b, rr, mat) => (alongU ? K.pipe(u + a, w, u + b, w, cy, rr, mat) : K.pipe(u, w + a, u, w + b, cy, rr, mat));
  seg(-hl, hl, r, body);
  seg(-hl - 10, -hl, r * 0.82, cap);
  seg(hl, hl + 10, r * 0.82, cap);
  for (const t of [-0.6, 0, 0.6]) seg(hl * t - 6, hl * t + 6, r + 6, M.steel);
  for (const t of [-0.55, 0.55]) {
    if (alongU) K.blk(u + hl * t, w, DECK, 22, 46, r * 2.1, M.steel);
    else K.blk(u, w + hl * t, DECK, 22, r * 2.1, 46, M.steel);
  }
}

/** Kolumna technologiczna (FG): cokół, trzon z opaskami, głowica w barwie zakładu, komin i kogut, rura opadowa. */
export function kolumna(K, u, w, { r = 105, h = 430, seed = 0, cap = M.paintCold } = {}) {
  const f = K.f;
  f.set = 'fg';
  K.cyl(u, w, DECK, 50, r * 1.5, M.rail);
  K.cyl(u, w, DECK + 50, h, r, M.steel);
  for (let k = 1; k <= 4; k++) K.cyl(u, w, DECK + 50 + (h * k) / 5 - 5, 10, r + 9, M.rail);
  K.cyl(u, w, DECK + 50 + h * 0.74, 8, r * 1.5, M.steel);
  K.cyl(u, w, DECK + 50 + h, 18, r * 1.12, cap);
  K.cyl(u, w, DECK + 68 + h, 60, r * 0.42, M.steel);
  K.cyl(u, w, DECK + 128 + h, 90, 8, M.rail);
  K.lamp(u, w, DECK + 222 + h, 16, M.red, 1.6, PB_FX.blink, pbHash1(seed + 0.3), 0.5);
  K.cyl(u + r + 18, w, DECK, h * 0.92, 14, M.copper);
  K.blk(u + r + 18, w, DECK + h * 0.92, 10, 60, 40, M.rail);
  for (const [du, dw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) K.lamp(u + du * r * 1.2, w + dw * r * 1.2, DECK + 58, 12, M.white, 1.1);
  f.set = 'bg';
}

/**
 * Pole radiatorów (narzędzia po łuku): trzon z kolektorami i pary paneli. Panel = płyta w płaszczyźnie lotu,
 * miedziane żebra wzdłuż łuku i pasy żaru (`fill`: kanał `ch` = obciążenie cieplne 0…1 — przy większym obciążeniu
 * żar sięga dalej od trzonu, więc pole pulsuje w takt pracy linii).
 */
export function radiator(T, f, R, { ch, color = '#99a6a2' }) {
  const sc = R.sc;
  const hw = R.trunkHalf;
  const top = 206;
  T.sec(sc - hw, sc + hw, R.v0, R.v1, 30, top - 36, M.dark);
  T.sec(sc - hw + 8, sc + hw - 8, R.v0 + 9, R.v1 - 9, top - 6, 6, M.steel);
  const sm = ringScale((R.v0 + R.v1) / 2);
  for (const side of [-1, 1]) {
    T.pipe(sc + (side * 74) / sm, R.v0 - 20, sc + (side * 74) / sm, R.v1 - 40, top + 22, 20, M.copper);
    T.pipe(sc + (side * 40) / sm, R.v0 - 20, sc + (side * 40) / sm, R.v1 - 40, top + 12, 9, M.steel);
  }
  for (let v = R.v0 + 200; v < R.v1 - 120; v += 420) T.box(sc, v, top + 18, 200, 36, 30, M.rail);
  // głowica trzonu: zawory i kogut przeszkodowy
  T.box(sc, R.v1 - 70, top + 26, 170, 52, 110, M.steel);
  T.box(sc, R.v1 - 70, top + 54, 120, 8, 70, M.rail);
  T.lamp(sc, R.v1 - 30, top + 76, 22, M.red, 1.6, PB_FX.blink, pbHash1(sc * 0.01), 0.5);
  T.label('RADIATORY', sc, R.v0 + 470, 620, 88, color, R.name, top + 2, 'bg', Math.PI / 2);

  const ptop = 176;
  for (const p of R.panels) {
    const root = p.side < 0 ? p.b : p.a;
    const tip = p.side < 0 ? p.a : p.b;
    const dir = p.side;
    const vc = (p.v0 + p.v1) / 2;
    const sw = ringScale(vc);
    T.sec(p.a, p.b, p.v0, p.v1, 70, ptop - 76, M.dark);
    T.sec(p.a + 7, p.b - 7, p.v0 + 8, p.v1 - 8, ptop - 6, 6, M.steel);
    // kolektor przy trzonie, listwa czołowa na końcu, żebra
    T.pipe(root + (dir * 30) / sw, p.v0 + 26, root + (dir * 30) / sw, p.v1 - 26, ptop + 12, 13, M.copper);
    T.box(tip - (dir * 22) / sw, vc, ptop + 6, 22, 12, R.depth - 30, M.rail);
    for (let k = 0; k < 7; k++) {
      const v = p.v0 + (R.depth * (k + 0.5)) / 7;
      T.run(root + (dir * 60) / sw, tip - (dir * 46) / sw, v, ptop + 5, 10, 11, M.rail, 340, 1.0);
    }
    // pasy żaru między żebrami: 3 linie × 4 odcinki, próg rośnie od trzonu ku końcowi panelu
    for (const k of [1, 3, 5]) {
      const v = p.v0 + (R.depth * k) / 7;
      for (let j = 0; j < 4; j++) {
        const s0 = root + dir * (R.span * (j + 0.14)) / 4;
        const s1 = root + dir * (R.span * (j + 0.86)) / 4;
        f.fx(0.85, PB_FX.fill, Math.min(0.96, 0.16 + 0.19 * j + 0.025 * p.index + 0.03 * (k % 3)), ch);
        T.box((s0 + s1) / 2, v, ptop + 2, Math.abs(s1 - s0) * sw, 5, 16, M.warm);
        f.nofx();
      }
    }
    if (p.index === R.n - 1 || p.index === 0) T.lamp(tip - (dir * 26) / sw, p.v1 - 30, ptop + 26, 16, M.red, 1.5, PB_FX.blink, pbHash1(tip * 0.013), 0.5);
  }
}

/**
 * Łącznik nad drogą (FG): zamknięty rękaw między zakładem a magazynem wyrobów. Stoi na dwóch wieżach windowych
 * (na pokładach rzędów — nic nie wisi bez podpory), spód rękawa y ≥ 400. `statusCh` — lampa stanu linii.
 */
export function lacznik(T, f, s, v0, v1, { statusCh = -1, strip = M.cyan, seed = 0 } = {}) {
  f.set = 'fg';
  const y = H.over;
  for (const v of [v0, v1]) {
    T.box(s, v, (H.deck + y + 112) / 2, 150, y + 112 - H.deck, 150, M.steel);
    T.box(s, v, y + 40, 156, 22, 156, M.glass);
    T.box(s, v, y + 112, 166, 12, 166, M.rail);
    T.lamp(s, v, y + 132, 16, M.red, 1.5, PB_FX.blink, pbHash1(seed + v * 0.01), 0.5);
  }
  T.seg(s, v0 + 75, s, v1 - 75, y + 50, 84, 96, M.steel);
  T.seg(s, v0 + 150, s, v1 - 150, y + 56, 22, 103, M.glass);
  T.seg(s, v0 + 75, s, v1 - 75, y + 96, 8, 70, M.rail);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const v = v0 + ((v1 - v0) * (k + 0.5)) / n;
    T.box(s, v, y + 48, 108, 92, 14, M.rail);
    f.fx(0.9, PB_FX.steady);
    T.box(s, v + 60, y + 5, 10, 5, 110, strip);
    T.box(s, v - 60, y + 105, 8, 4, 96, strip);
    f.nofx();
  }
  if (statusCh >= 0) {
    for (const v of [v0 + 110, v1 - 110]) {
      f.fx(1.4, PB_FX.status, 0, statusCh);
      T.box(s, v, y + 104, 60, 10, 26, M.status);
      f.nofx();
    }
  }
  f.set = 'bg';
}

/** Maszty oświetleniowe wzdłuż łuku (małe białe lampy na słupach — wyznaczają ulice serwisowe między halami). */
export function maszty(T, s0, s1, v, { step = 560, h = 210, mat = M.white } = {}) {
  const n = Math.max(1, Math.round((Math.abs(s1 - s0) * ringScale(v)) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    T.cyl(s, v, DECK + h / 2, 5, h, M.steel);
    T.box(s, v, DECK + h + 3, 46, 6, 12, M.steel);
    T.lamp(s, v, DECK + h + 10, 13, mat, 1.1);
  }
}

/** Oś ulicy serwisowej na pokładzie: przerywana linia w barwie zakładu. */
export function osUlicy(T, s0, s1, v, mat = M.paintCold) {
  T.run(s0, s1, v, DECK + 1, 2, 7, mat, 300, 0.42);
}

/** Wieża procesowa (FG) o przekroju kwadratu: cokół, trzon z pasem barwy, pas okien, głowica, kogut. */
export function wiezaProcesowa(K, u, w, { side = 170, h = 520, seed = 0, accent = M.paintCold, wall = M.steel } = {}) {
  const f = K.f;
  f.set = 'fg';
  K.blk(u, w, DECK, 16, side + 44, side + 44, M.steel);
  K.blk(u, w, DECK + 16, h, side, side, wall);
  K.blk(u, w, DECK + 16 + h * 0.46, 12, side + 8, side + 8, accent);
  K.blk(u, w, DECK + 16 + h * 0.8, 22, side + 7, side + 7, M.glass);
  K.blk(u, w, DECK + 16 + h, 12, side + 18, side + 18, M.steel);
  K.cyl(u, w, DECK + 28 + h, 46, side * 0.16, M.steel);
  K.lamp(u, w, DECK + 82 + h, 15, M.red, 1.5, PB_FX.blink, pbHash1(seed + 0.7), 0.5);
  f.set = 'bg';
}
