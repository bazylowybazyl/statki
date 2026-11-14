// Stocznia Ziemi „zamknięta” (yardTri.js) — BRYŁY jako dane instancji zestawu budowli portowych (PortRecorder), jak
// scene.js. Dwie budowle:
//   • buildYardTriScene — trójkątny suchy dok (korpus, węzły w narożach i w środku, szprychy), pochylnie na bokach
//     (łoża, pomosty, pokłady warsztatów za krótkimi pochylniami), ŻURAWIE na pomostach (FG, grupy ruchome), budowle
//     zamykające ulicę od zewnątrz z dokami dostaw (te same bryły co kolizje);
//   • buildYardStreetScene — ULICA: kratownica z rurami pod płaszczyzną lotu (jak pod drogą przy ringu) od drogi ringu
//     do doku i dookoła niego, światła osi i pasów, odnogi do pochylni, bramownice (FG), WÓZKI na kratownicy (pula
//     grup ruchomych — gospodarz stawia wózek pod kadłubem, który wyjeżdża z pochylni i jedzie do doków).
// Bez taśm: surowce przywożą statki ulicą. Bez three (czyste dane); punkty w układzie lokalnym kompleksu (x, z).
import { PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbHash1, pbLabel, pbPlate } from '../../src/3d/portBuildings/portBuildingScene.js';
import { k7HeightToZ } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { YARD_H } from './scene.js';
import { YARD_TRI, pathSampler } from './yardTri.js';

const M = PB_MAT;
const H = YARD_H;
const TAU = Math.PI * 2;
const TOP_MATS = [M.steel, M.steel, M.rail, M.steel, M.steel, M.rail];
const CRATES = [M.orange, M.teal, M.pale, M.yellow, M.steel, M.orange, M.pale];

/** Liczba wózków na kratownicy (grupy ruchome budowli ulicy). */
export const YARD_TRI_SLEDS = 28;

const rotOf = (dx, dz) => Math.atan2(-dz, dx);
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a, b) => { const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
function centroid(pts) {
  let x = 0;
  let z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}
/** Wielokąt wypukły zmniejszony ku środkowi (wierzch korpusu z odsadzką ~d). */
function inset(pts, d) {
  const c = centroid(pts);
  return pts.map((p) => {
    const dx = c[0] - p[0];
    const dz = c[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    const k = Math.min(0.45, (d * 1.45) / l);
    return [p[0] + dx * k, p[1] + dz * k];
  });
}

/** Narzędzia w układzie lokalnym kompleksu: bryły wzdłuż dowolnego kierunku (dx, dz). */
export function xz(f, plates, labels) {
  const Q = {
    /** Prostopadłościan: środek p, `len` wzdłuż (dx, dz), `wid` w poprzek; `extra` — dodatkowy obrót. */
    box(p, y, len, h, wid, mat, dx = 1, dz = 0, extra = 0) { f.box(p[0], y, p[1], len, h, wid, mat, rotOf(dx, dz) + extra); },
    seg(a, b, y, h, wid, mat, fill = 1) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      f.box((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, len * fill, h, wid, mat, rotOf(dx, dz));
    },
    pipe(a, b, y, r, mat) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      f.cyl((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, r, len, mat, [0, rotOf(dx, dz), Math.PI / 2]);
    },
    beam(a, ya, b, yb, w, mat) { f.beam([a[0], ya, a[1]], [b[0], yb, b[1]], w, mat); },
    cyl(p, y, r, h, mat) { f.cyl(p[0], y, p[1], r, h, mat); },
    lamp(p, y, size, mat, gain = 1.2, mode = PB_FX.steady, phase = 0, param = 0) {
      f.fx(gain, mode, phase, param);
      f.box(p[0], y, p[1], size, size * 0.5, size, mat, 0);
      f.nofx();
    },
    plate(pts, bottom, height, mat, set = 'bg') { pbPlate(plates, pts, bottom, height, mat, set); },
    /** Napis wzdłuż (dx, dz); odwracany tak, żeby czytał się od lewej do prawej ekranu (x lokalne = w prawo). */
    label(text, p, width, depth, color, small = '', y = H.deck + 9, set = 'bg', dx = 1, dz = 0) {
      if (dx < 0) { dx = -dx; dz = -dz; }
      pbLabel(labels, text, p[0], p[1], width, depth, color, small, rotOf(dx, dz), y, set);
    }
  };
  return Q;
}

function newScene() {
  const f = new PortRecorder();
  const plates = [];
  const labels = [];
  const lamps = [];
  return { f, plates, labels, lamps, Q: xz(f, plates, labels) };
}
const sceneOf = (f, plates, labels, lamps, rig = {}) => ({ sets: f.sets, plates, labels, lamps, groups: [], rig, instances: f.count() });
function pushLamp(lamps, p, y, kind = 1) {
  if (lamps.length >= PB_MAX_LAMPS) return;
  lamps.push([p[0], k7HeightToZ(y), p[1], kind]);
}

/** Lico budowli od strony ulicy (e0 → e1, `inw` — w głąb budowli): krawężnik na koronie, listwa świetlna, pas stali. */
export function faceTrim(Q, f, e0, e1, inw, strip) {
  const len = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
  if (len < 30) return;
  const d = unit(e0, e1);
  const m = mix(e0, e1, 0.5);
  Q.box(add(m, inw, 9), H.deck + 9, len * 1.01, 16, 16, M.rail, d[0], d[1]);
  f.fx(1.1, PB_FX.steady);
  Q.box(add(m, inw, -3), H.wallLight, Math.max(10, len - 16), 5, 6, strip, d[0], d[1]);
  f.nofx();
  Q.box(add(m, inw, -2), 40, Math.max(10, len - 8), 30, 5, M.steel, d[0], d[1]);
}

/** Lico zewnętrzne (od przestrzeni): krawężnik i świetlne szczeliny. */
export function outerTrim(Q, f, o0, o1, out, seed) {
  const len = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
  if (len < 120) return;
  const d = unit(o0, o1);
  const m = mix(o0, o1, 0.5);
  Q.box(add(m, out, -9), H.deck + 9, len * 1.01, 16, 16, M.rail, d[0], d[1]);
  f.fx(1.25, PB_FX.steady);
  Q.box(add(m, out, 3), 70, len * 0.58, 30, 6, M.cyan, d[0], d[1]);
  f.nofx();
  if (pbHash1(seed + 3.3) > 0.72) Q.lamp(add(m, out, -40), H.deck + 26, 20, M.red, 1.6, PB_FX.blink, pbHash1(seed + 1.1), 0.5);
}

/** Dok dostaw wycięty w budowli prostej (ramka `pit.frame`: środek wylotu, u — wzdłuż ulicy, w — w głąb). */
export function pitDetailXZ(Q, f, pit, { occupied = false } = {}) {
  const F = pit.frame;
  const u = [F.ux, F.uz];
  const w = [F.wx, F.wz];
  const at = (du, dw) => [F.ox + u[0] * du + w[0] * dw, F.oz + u[1] * du + w[1] * dw];
  const hw = pit.w / 2;
  const big = pit.cls === 'l';
  Q.plate(pit.poly, H.keel, H.floor - H.keel, M.floor);
  const n = Math.max(2, Math.round((pit.w - 28) / 23));
  for (let i = 0; i < n; i++) Q.box(at(-hw + 14 + ((pit.w - 28) * (i + 0.5)) / n, 26), H.floor + 3, ((pit.w - 28) / n) * 0.52, 1.6, 26, i % 2 ? M.black : M.yellow, u[0], u[1], 0.5);
  const B = pit.berth;
  const bc = pit.d - 80 - B.length / 2;
  const nose = bc + B.length / 2;
  for (const side of [-1, 1]) Q.box(at(side * B.width / 2, bc), H.mark, B.length * 0.94, 2, 9, M.paintCold, w[0], w[1]);
  Q.box(at(0, nose + 6), H.mark, B.width + 30, 2, 14, M.yellow, u[0], u[1]);
  Q.box(at(0, (pit.d + nose) / 2), H.gear, Math.abs(pit.d - nose) + 20, 22, Math.min(120, B.width * 0.4), M.dark, w[0], w[1]);
  Q.box(at(0, pit.d - 16), 70, Math.min(B.width * 0.7, 320), 80, 30, M.steel, u[0], u[1]);
  Q.box(at(0, pit.d - 16), 112, Math.min(B.width * 0.66, 300), 4, 26, M.yellow, u[0], u[1]);
  for (const side of [-1, 1]) Q.box(at(side * (hw + 9), pit.d / 2), H.deck + 9, pit.d, 16, 16, M.rail, w[0], w[1]);
  Q.box(at(0, pit.d + 9), H.deck + 9, pit.w, 16, 16, M.rail, u[0], u[1]);
  Q.lamp(at(0, pit.d + 30), H.deck + 20, big ? 28 : 22, occupied ? M.red : M.green, 1.25);
  for (const side of [-1, 1]) Q.lamp(at(side * (hw + 10), -8), H.deck + 20, 16, M.warm, 1.1);
  // zasobniki ładunku przy doku (dostawy surowców)
  for (const side of [-1, 1]) {
    const k = pbHash1(F.ox * 0.013 + F.oz * 0.007 + side);
    Q.box(at(side * (hw + 70), pit.d * 0.45), H.deck + 6 + 18, Math.min(pit.d * 0.5, 260), 36, 70, CRATES[Math.floor(k * CRATES.length)], w[0], w[1]);
  }
}

/** Nadbudówki na wierzchu kawałka budowli (ziarno z położenia). */
export function greebleXZ(Q, poly, seed) {
  const c = centroid(poly);
  const dA = unit(poly[0], poly[1]);
  const la = Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
  const lb = Math.hypot(poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]);
  if (la < 220 || lb < 260) return;
  const h1 = pbHash1(seed + 1.7);
  const h2 = pbHash1(seed + 5.3);
  const h3 = pbHash1(seed + 9.1);
  const base = H.deck + 6;
  const kind = Math.floor(h1 * 5);
  if (kind === 0) {
    const bh = 40 + 70 * h3;
    Q.box(c, base + bh / 2, la * 0.6, bh, lb * 0.3, M.steel, dA[0], dA[1]);
    Q.box(c, base + bh + 4, la * 0.5, 8, lb * 0.22, h2 > 0.5 ? M.rail : M.steel, dA[0], dA[1]);
    Q.box(add(c, [-dA[1], dA[0]], lb * 0.15), base + bh * 0.55, la * 0.3, 14, 10, M.glass, dA[0], dA[1]);
  } else if (kind === 1) {
    const fins = Math.max(4, Math.floor((la * 0.7) / 46));
    for (let k = 0; k < fins; k++) Q.box(add(c, dA, -la * 0.35 + ((la * 0.7) * (k + 0.5)) / fins), base + 26, 8, 52, lb * 0.28, M.copper, dA[0], dA[1]);
  } else if (kind === 2) {
    for (const o of [-1, 1]) {
      const p = add(c, dA, o * la * 0.2);
      const q = [-dA[1], dA[0]];
      Q.pipe(add(p, q, -lb * 0.13), add(p, q, lb * 0.13), base + 34, 30, o > 0 || h3 < 0.75 ? M.pale : M.orange);
      Q.box(p, base + 8, 74, 16, 60, M.dark, dA[0], dA[1]);
    }
  } else if (kind === 3) {
    Q.box(c, base + 14, la * 0.7, 28, lb * 0.2, M.rail, dA[0], dA[1]);
    for (let k = 0; k < 5; k++) Q.box(add(c, dA, la * (-0.3 + 0.15 * k)), base + 32, 22, 8, lb * 0.16, M.steel, dA[0], dA[1]);
  }
}

/** Wieża-iglica (FG) na budowli: schodkowy trzon z pasami okien, maszt, kogut. */
export function spireXZ(Q, f, p, size, seed) {
  f.set = 'fg';
  const y0 = H.deck;
  Q.box(p, y0 + 40, size * 1.5, 80, size * 1.5, M.steel);
  Q.box(p, y0 + 84, size * 1.4, 10, size * 1.4, M.rail);
  Q.box(p, y0 + 135, size, 110, size, M.steel);
  Q.box(p, y0 + 196, size * 1.08, 14, size * 1.08, M.rail);
  Q.box(p, y0 + 300, size * 0.7, 200, size * 0.7, M.dark);
  Q.box(p, y0 + 250, size * 0.74, 30, size * 0.74, M.glass);
  Q.box(p, y0 + 404, size * 0.76, 10, size * 0.76, M.rail);
  Q.box(p, y0 + 500, size * 0.42, 190, size * 0.42, M.steel);
  Q.box(p, y0 + 470, size * 0.46, 26, size * 0.46, M.glass);
  Q.cyl(p, y0 + 690, 9, 200, M.rail);
  Q.lamp(p, y0 + 796, 18, M.red, 1.8, PB_FX.blink, pbHash1(seed + 0.3), 0.5);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) Q.lamp([p[0] + dx * size * 0.5, p[1] + dz * size * 0.5], y0 + 204, 14, M.white, 1.25);
  f.set = 'bg';
}

/** Nadproże / wysięgnik nad ulicą (FG): belka a → b, słupy (1 — przy a, 2 — przy b, 3 — oba), listwy sygnałowe. */
export function lintelXZ(Q, f, a, b, wid, signs = [], seed = 0, posts = 3) {
  f.set = 'fg';
  const y = H.over;
  const d = unit(a, b);
  Q.seg(a, b, y + 45, 90, wid, M.steel);
  Q.seg(a, b, y + 94, 8, wid * 0.8, M.rail);
  Q.seg(a, b, y + 104, 10, wid * 0.3, M.steel);
  if (posts & 1) Q.box(a, (H.deck + y) / 2, wid * 1.15, y - H.deck, wid * 1.15, M.steel, d[0], d[1]);
  if (posts & 2) Q.box(b, (H.deck + y) / 2, wid * 1.15, y - H.deck, wid * 1.15, M.steel, d[0], d[1]);
  for (const g of signs) {
    f.fx(g.gain || 1.0, g.mode ?? PB_FX.steady, g.phase || 0, g.param || 0);
    Q.seg(mix(a, b, g.t0), mix(a, b, g.t1), y + 112, 6, Math.min(26, wid * 0.2), g.mat);
    f.nofx();
  }
  Q.lamp(mix(a, b, 0.5), y + 126, 20, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.9), 0.5);
  f.set = 'bg';
}

// ---------------------------------------------------------------------------
// Suchy dok, pochylnie, żurawie, budowle zamykające

/**
 * `rig.cranes`: [{ group, index }] — macierz grupy = obrót wokół osi wieży (gospodarz co klatkę);
 * `rig.slipStatus`: [{ ch, index }] — lampa stanu pochylni (kanał: 0 — budowa, 1 — gotowy do wyjazdu).
 */
export function buildYardTriScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, Q } = newScene();
  const Tr = layout.yard.tri;
  const T = YARD_TRI;
  const X = (a, c) => Tr.at(a, c);
  const D = (na, nc) => [Tr.rx * na + Tr.tx * nc, Tr.rz * na + Tr.tz * nc];
  const C = X(Tr.ca, 0);
  const VX = Tr.verts.map((v) => X(v[0], v[1]));
  const cranes = [];
  const slipStatus = [];
  let group = 0;

  // --- korpus doku: trójkąt, sektory wierzchu między szprychami, pasy paneli
  Q.plate(VX, H.keel, H.deck - H.keel, M.dark);
  for (let i = 0; i < 3; i++) {
    const a = VX[i];
    const b = VX[(i + 1) % 3];
    Q.plate(inset([C, a, b], 16), H.deck, 6, M.steel);
    for (const [f0, f1, mat] of [[0.36, 0.5, M.rail], [0.56, 0.7, M.steel], [0.76, 0.88, M.rail]]) {
      Q.plate(inset([mix(C, a, f0), mix(C, a, f1), mix(C, b, f1), mix(C, b, f0)], 34), H.deck + 6, 4, mat);
    }
  }
  // szprychy: środek → naroża (żebro z rurami i światłami) i środek → środki boków
  for (let i = 0; i < 3; i++) {
    const v = VX[i];
    const d = unit(C, v);
    const n = [-d[1], d[0]];
    Q.seg(C, v, H.deck + 20, 28, 130, M.rail);
    Q.seg(C, v, H.deck + 38, 8, 56, M.steel);
    Q.pipe(add(C, n, 104), add(v, n, 104), H.deck + 18, 16, M.copper);
    Q.pipe(add(C, n, -104), add(v, n, -104), H.deck + 15, 10, M.hose);
    for (let k = 0; k < 9; k++) Q.lamp(mix(C, v, 0.34 + 0.055 * k), H.deck + 46, 14, M.cyan, 1.2, PB_FX.chase, k / 9, 0.8);
    const m = mix(v, VX[(i + 1) % 3], 0.5);
    Q.seg(C, m, H.deck + 13, 14, 70, M.dark);
    Q.seg(C, m, H.deck + 22, 4, 26, M.rail);
  }
  // węzły: naroża i środek — cokół, wieża (FG), światła obwodu
  for (const hb of Tr.hubs) {
    const p = X(hb.a, hb.c);
    const ring = (r) => Array.from({ length: 12 }, (_, k) => X(hb.a + Math.cos((k / 12) * TAU) * r, hb.c + Math.sin((k / 12) * TAU) * r));
    const big = hb.corner < 0;
    const k = big ? 1.35 : 1;
    const top = H.deck + 30;
    Q.plate(ring(hb.r), H.keel, top - H.keel, M.dark);
    Q.plate(ring(hb.r - 40), top, 6, M.steel);
    Q.plate(ring(hb.r * 0.62), top + 6, 8, M.rail);
    for (let j = 0; j < 12; j++) {
      const ang = ((j + 0.5) / 12) * TAU;
      Q.lamp(X(hb.a + Math.cos(ang) * (hb.r - 22), hb.c + Math.sin(ang) * (hb.r - 22)), top + 14, 14, big ? M.cyan : M.warm, 1.15, PB_FX.chase, j / 12, 0.8);
    }
    f.set = 'fg';
    Q.cyl(p, top + 6 + 60 * k, 330 * k, 120 * k, M.steel);
    Q.cyl(p, top + 6 + 126 * k, 300 * k, 12 * k, M.rail);
    Q.cyl(p, top + 6 + 170 * k, 240 * k, 76 * k, M.glass);
    Q.cyl(p, top + 6 + 216 * k, 262 * k, 16 * k, M.steel);
    Q.cyl(p, top + 6 + 300 * k, 120 * k, 150 * k, M.dark);
    Q.cyl(p, top + 6 + 300 * k, 126 * k, 22 * k, M.glass);
    Q.cyl(p, top + 6 + 470 * k, 9 * k, 200 * k, M.rail);
    Q.lamp(p, top + 6 + 574 * k, 20, M.red, 1.8, PB_FX.blink, pbHash1(hb.a * 0.01 + hb.c * 0.02 + 0.3), 0.5);
    for (let j = 0; j < 6; j++) {
      const ang = (j / 6) * TAU;
      Q.lamp([p[0] + Math.cos(ang) * 300 * k, p[1] + Math.sin(ang) * 300 * k], top + 6 + 134 * k, 14, M.white, 1.25);
    }
    f.set = 'bg';
  }
  pushLamp(lamps, C, 340, 1);

  // --- boki: pas pochylni (łoże z jasnej stali), próg przy ulicy, pokład warsztatów, pomosty
  const sideOf = {};
  for (const sd of Tr.sides) {
    sideOf[sd.key] = sd;
    const pt = (u, d) => X(sd.P[0] + sd.t[0] * u + sd.n[0] * d, sd.P[1] + sd.t[1] * u + sd.n[1] * d);
    const t = D(sd.t[0], sd.t[1]);
    const n = D(sd.n[0], sd.n[1]);
    const span = sd.u1 - sd.u0;
    Q.plate([pt(sd.u0, sd.back), pt(sd.u1, sd.back), pt(sd.u1, T.slipD), pt(sd.u0, T.slipD)], H.keel, H.floor - H.keel, M.steel);
    Q.plate([pt(sd.u0, T.slipD), pt(sd.u1, T.slipD), pt(sd.u1, Tr.Din), pt(sd.u0, Tr.Din)], H.keel, H.floor - 8 - H.keel, M.dark);
    Q.box(pt((sd.u0 + sd.u1) / 2, T.slipD + 6), H.floor + 2, span, 2, 12, M.yellow, t[0], t[1]);
    if (sd.back > 0) {
      // pokład warsztatów za krótkimi pochylniami: korpus do wysokości doku, hale, składy części, lądowiska dronów
      const cuts = Math.max(1, Math.ceil(span / 900));
      for (let k = 0; k < cuts; k++) {
        const a = sd.u0 + (span * k) / cuts;
        const b = sd.u0 + (span * (k + 1)) / cuts;
        const poly = [pt(a, 0), pt(b, 0), pt(b, sd.back), pt(a, sd.back)];
        Q.plate(poly, H.keel, H.deck - H.keel, M.dark);
        Q.plate(inset(poly, 10), H.deck, 6, TOP_MATS[(k + sd.key.charCodeAt(0)) % TOP_MATS.length]);
        if (sd.back > 700) greebleXZ(Q, [pt(a, 60), pt(b, 60), pt(b, sd.back - 320), pt(a, sd.back - 320)], sd.key.charCodeAt(0) * 3.1 + k * 7.7);
      }
      // krawędź pokładu nad pochylniami: krawężnik, listwa świetlna
      Q.box(pt((sd.u0 + sd.u1) / 2, sd.back - 9), H.deck + 9, span, 16, 16, M.rail, t[0], t[1]);
      f.fx(0.9, PB_FX.steady);
      Q.box(pt((sd.u0 + sd.u1) / 2, sd.back + 3), H.wallLight, span - 60, 5, 6, M.warm, t[0], t[1]);
      f.nofx();
      Q.pipe(pt(sd.u0 + 40, sd.back - 120), pt(sd.u1 - 40, sd.back - 120), H.deck + 16, 14, M.copper);
      Q.pipe(pt(sd.u0 + 40, sd.back - 160), pt(sd.u1 - 40, sd.back - 160), H.deck + 13, 9, M.hose);
    }
    for (const fg of sd.fingers) {
      const hw = T.fingerW / 2;
      const top = H.deck - 60;
      const d0 = fg.d0;
      const d1 = fg.d0 + fg.len;
      Q.plate([pt(fg.u - hw, d0), pt(fg.u + hw, d0), pt(fg.u + hw, d1), pt(fg.u - hw, d1)], H.floor, top - H.floor, M.dark);
      Q.box(pt(fg.u, (d0 + d1) / 2), top + 4, fg.len - 16, 8, T.fingerW - 30, M.steel, n[0], n[1]);
      for (const side of [-1, 1]) {
        f.fx(0.85, PB_FX.steady);
        Q.box(pt(fg.u + side * (hw + 3), (d0 + d1) / 2), H.wallLight, Math.max(40, fg.len - 120), 5, 6, M.warm, n[0], n[1]);
        f.nofx();
      }
      Q.lamp(pt(fg.u, d1 - 30), top + 14, 20, M.red, 1.5, PB_FX.blink, pbHash1(fg.u * 0.013 + sd.key.charCodeAt(0)), 0.6);
    }
    for (const t3 of [0.3, 0.7]) pushLamp(lamps, pt(sd.u0 + span * t3, (sd.back + T.slipD) / 2), 340, 2);
    Q.label('STOCZNIA ZIEMI', add(C, n, 1480), 2200, 290, style.labels.hub, 'TERRA NOVA · SUCHY DOK', H.deck + 12, 'bg', t[0], t[1]);
  }

  // --- pochylnie: łoże, tory wózka, lampa stanu, numer, żuraw ze składem części
  for (const s of Tr.slips) {
    const sd = sideOf[s.side];
    const pt = (u, d) => X(sd.P[0] + sd.t[0] * u + sd.n[0] * d, sd.P[1] + sd.t[1] * u + sd.n[1] * d);
    const t = D(sd.t[0], sd.t[1]);
    const def = s.def;
    const dS = sd.back + 110;                 // rufa kadłuba
    const dE = dS + def.len;                  // dziób
    for (const k of [0.12, 0.31, 0.5, 0.69, 0.88]) Q.box(pt(s.uc, dS + def.len * k), H.floor + 7, def.w * 0.78, 8, Math.max(10, def.len * 0.012), M.rail, t[0], t[1]);
    for (const side of [-1, 1]) {
      const u = s.uc + side * def.w * 0.2;
      Q.seg(pt(u, sd.back + 30), pt(u, Tr.Din), H.floor + 3, 5, Math.max(14, def.w * 0.03), M.dark);
      for (let k = 0; k < 3; k++) Q.lamp(pt(u, T.slipD + 34 + k * 44), H.floor + 8, Math.max(10, def.w * 0.022), M.green, 1.15, PB_FX.chase, 1 - k / 3, 0.9);
    }
    Q.box(pt(s.uc, Math.min(dE + 40, T.slipD - 20)), H.mark, def.w * 0.9, 2, 14, M.yellow, t[0], t[1]);
    // lampa stanu na koronie za rufą (pokład warsztatów albo wierzch doku)
    const ch = slipStatus.length;
    f.fx(1.45, PB_FX.status, 0, ch);
    Q.box(pt(s.uc, sd.back - 36), H.deck + 22, Math.min(90, def.w * 0.16), 12, 22, M.status, t[0], t[1]);
    f.nofx();
    slipStatus.push({ ch, index: s.index });
    Q.label(s.id, pt(s.uc, sd.back - 150), Math.min(def.w * 0.62, 400), 110, style.labels.berthLead, '', H.deck + 12, 'bg', t[0], t[1]);

    // żuraw na pomoście: wieża, wysięgnik nad kadłub (obrót o 90° nad skład części), przeciwwaga, hak
    const c = s.crane;
    const k = c.cls === 'capital' ? 1.5 : c.cls === 'carrier' ? 1.3 : c.cls === 'l' ? 1.1 : 0.75;
    const onFinger = c.pickD > sd.back;
    const storeY = onFinger ? H.deck - 60 : H.deck;
    const pick = [c.pickX, c.pickZ];
    const hd = [c.hx, c.hz];
    const cw = Math.min(84 * k, onFinger ? T.fingerW - 20 : 140);
    Q.box(pick, storeY + 6 + 16 * k, cw, 32 * k, cw, CRATES[c.index % CRATES.length], hd[0], hd[1]);
    Q.box(add(pick, [-hd[1], hd[0]], cw * 0.9 * c.pickSign), storeY + 6 + 9 * k, cw * 0.7, 18 * k, cw * 0.6, M.dark, hd[0], hd[1]);
    group++;
    f.group = group;
    f.set = 'fg';
    const base = H.deck - 60;
    const top = H.deck + 230 * k;
    const p = [c.px, c.pz];
    const at = (d) => add(p, hd, d);
    Q.box(p, (base + top) / 2, 70 * k, top - base, 70 * k, M.yellow, hd[0], hd[1]);
    Q.box(p, top + 10 * k, 96 * k, 20 * k, 96 * k, M.dark, hd[0], hd[1]);
    Q.box(at(-30 * k), top + 34 * k, 50 * k, 30 * k, 60 * k, M.glass, hd[0], hd[1]);
    Q.box(at(c.reach * 0.5), top + 30 * k, c.reach, 26 * k, 36 * k, M.yellow, hd[0], hd[1]);
    Q.box(at(c.reach * 0.5), top + 46 * k, c.reach * 0.96, 8 * k, 14 * k, M.rail, hd[0], hd[1]);
    Q.box(at(-c.reach * 0.22), top + 30 * k, c.reach * 0.34, 22 * k, 40 * k, M.yellow, hd[0], hd[1]);
    Q.box(at(-c.reach * 0.36), top + 22 * k, 60 * k, 44 * k, 70 * k, M.dark, hd[0], hd[1]);
    const tip = at(c.reach - 10);
    Q.box(tip, (150 + top + 20 * k) / 2, 5 * k, top + 20 * k - 150, 5 * k, M.rail, hd[0], hd[1]);
    Q.box(tip, 150, 60 * k, 34 * k, 60 * k, c.index % 2 ? M.orange : M.pale, hd[0], hd[1]);
    Q.lamp(tip, top + 52 * k, 12 * k + 4, M.white, 1.4, PB_FX.blink, pbHash1(c.index * 1.9), 2.5);
    Q.lamp(p, top + 64 * k, 10 * k + 4, M.red, 1.6, PB_FX.blink, pbHash1(c.index * 3.1), 0.6);
    f.group = 0;
    f.set = 'bg';
    cranes.push({ group, index: s.index });
  }

  // --- budowle zamykające ulicę od zewnątrz: korpusy (te same wielokąty co kolizje), lica, doki dostaw
  for (const p of Tr.pieces) {
    const inw = [p.ix, p.iz];
    const seed = Math.round(p.e0[0] * 0.61 + p.e0[1] * 0.17);
    Q.plate(p.poly, H.keel, H.deck - H.keel, M.dark);
    Q.plate(inset(p.poly, 9), H.deck, 6, TOP_MATS[Math.floor(pbHash1(seed + 2.2) * TOP_MATS.length)]);
    if (!p.pit) faceTrim(Q, f, p.e0, p.e1, inw, M.warm);
    outerTrim(Q, f, add(p.e0, inw, p.thick), add(p.e1, inw, p.thick), inw, seed);
    if (!p.pit) greebleXZ(Q, [add(p.e0, inw, 120), add(p.e1, inw, 120), add(p.e1, inw, p.thick - 160), add(p.e0, inw, p.thick - 160)], seed);
    else if (p.thick - p.w0 > 300) greebleXZ(Q, [add(p.e0, inw, p.w0 + 40), add(p.e1, inw, p.w0 + 40), add(p.e1, inw, p.thick - 60), add(p.e0, inw, p.thick - 60)], seed + 4);
  }
  for (const pit of Tr.pits) pitDetailXZ(Q, f, pit, { occupied: occupied.has(pit.berth.id) });
  Tr.arcs.forEach((a, i) => {
    const inw = unit(mix(a.e0, a.e1, 0.5), mix(a.o0, a.o1, 0.5));
    Q.plate(a.poly, H.keel, H.deck - H.keel, M.dark);
    Q.plate(inset(a.poly, 9), H.deck, 6, TOP_MATS[i % TOP_MATS.length]);
    faceTrim(Q, f, a.e0, a.e1, inw, M.warm);
    outerTrim(Q, f, a.o0, a.o1, inw, i * 5.1);
    if (i % 3 === 1) greebleXZ(Q, [add(a.e0, inw, 160), add(a.e1, inw, 160), add(a.e1, inw, T.rowT - 200), add(a.e0, inw, T.rowT - 200)], i * 2.3 + 0.7);
  });
  for (const w of Tr.wedges) {
    Q.plate(w.poly, H.keel, H.deck - H.keel, M.dark);
    Q.plate(inset(w.poly, 9), H.deck, 6, M.steel);
    faceTrim(Q, f, w.e0, w.e1, D(0, w.sgn), M.warm);
  }
  // wieże na budowlach zamykających: w osi każdego naroża obwodnicy i przy wlocie ulicy
  const Rm = (Tr.Dout + Tr.Dwall) / 2;
  for (const [vi, ang] of [[1, Math.PI / 3], [2, -Math.PI / 3]]) {
    const v = Tr.verts[vi];
    spireXZ(Q, f, X(v[0] + Math.cos(ang) * Rm, v[1] + Math.sin(ang) * Rm), 330, 200 + vi);
  }
  for (const sgn of [-1, 1]) spireXZ(Q, f, X(Tr.stemBar - 200, sgn * (Tr.hwS + T.rowT * 0.55)), 260, 210 + sgn);
  // napisy na budowlach: doki dostaw przy bokach obwodnicy
  for (const sd of Tr.sides) {
    const t = D(sd.t[0], sd.t[1]);
    const mid = X((sd.P[0] + sd.Q[0]) / 2 + sd.n[0] * (Tr.Dout + 1040), (sd.P[1] + sd.Q[1]) / 2 + sd.n[1] * (Tr.Dout + 1040));
    Q.label('DOSTAWY STOCZNI', mid, 540, 100, style.labels.clear, '', H.deck + 9, 'bg', t[0], t[1]);
  }
  if (group + 1 > PB_MAX_GROUPS) throw new Error(`stocznia Ziemi: ${group} grup > ${PB_MAX_GROUPS - 1}`);
  return sceneOf(f, plates, labels, lamps, { cranes, slipStatus, groups: group });
}

// ---------------------------------------------------------------------------
// Ulica: kratownica, światła, odnogi do pochylni, bramownice, wózki

/** Stacje kratownicy wzdłuż łamanej (układ kompleksu): punkt, styczna, normalna. */
export function stations(pts, step, closed) {
  const path = pathSampler(closed ? pts.concat([pts[0]]) : pts);
  const n = Math.max(2, Math.round(path.len / step));
  const out = [];
  const o = {};
  const m = closed ? n : n + 1;
  for (let k = 0; k < m; k++) {
    path.at((path.len * k) / n, o);
    const t = [Math.cos(o.h), Math.sin(o.h)];
    out.push({ p: [o.x, o.z], t, n: [-t[1], t[0]], d: (path.len * k) / n });
  }
  return { list: out, len: path.len, path };
}

/** Kratownica jak pod drogą przy ringu: pasy górne i dolne, poprzeczki, krzyżulce, rurociągi, zbiorniki. */
export function truss(Q, st, closed) {
  const yt = H.spineTop;
  const yb = H.spineBottom;
  const ym = (yt + yb) / 2;
  const m = st.length;
  const lim = closed ? m : m - 1;
  for (let k = 0; k < m; k++) {
    const a = st[k];
    Q.box(a.p, yt, 380, 30, 30, M.steel, a.n[0], a.n[1]);
    Q.box(a.p, yb, 220, 26, 26, M.dark, a.n[0], a.n[1]);
    for (const side of [-1, 1]) Q.beam(add(a.p, a.n, side * 190), yt, add(a.p, a.n, side * 110), yb, 22, M.dark);
    if (k >= lim) continue;
    const b = st[(k + 1) % m];
    for (const side of [-1, 1]) {
      Q.seg(add(a.p, a.n, side * 190), add(b.p, b.n, side * 190), yt, 46, 46, M.steel, 1.03);
      Q.seg(add(a.p, a.n, side * 110), add(b.p, b.n, side * 110), yb, 40, 40, M.dark, 1.03);
      Q.beam(add(a.p, a.n, side * 190), yt, add(b.p, b.n, side * 110), yb, 16, M.rail);
    }
    Q.beam(add(a.p, a.n, k % 2 ? -190 : 190), yt, add(b.p, b.n, k % 2 ? 190 : -190), yt, 14, M.rail);
    Q.pipe(add(a.p, a.n, 60), add(b.p, b.n, 60), ym + 40, 26, M.copper);
    Q.pipe(add(a.p, a.n, -60), add(b.p, b.n, -60), ym + 10, 18, M.hose);
    Q.pipe(add(a.p, a.n, 130), add(b.p, b.n, 130), ym + 70, 12, M.pale);
    if (k % 5 === 2) {
      const c = add(mix(a.p, b.p, 0.5), a.n, -20);
      Q.pipe(add(c, a.t, -200), add(c, a.t, 200), ym - 30, 62, M.pale);
      for (const e of [-1, 1]) Q.box(add(c, a.t, e * 230), ym - 30, 30, 150, 150, M.dark, a.t[0], a.t[1]);
    }
  }
}

/**
 * `rig.sleds`: [group…] — wózki na kratownicy. Wózek to bryła jednostkowa w początku układu (długość wzdłuż +x,
 * szerokość wzdłuż z); gospodarz ustawia macierz grupy: przesunięcie · obrót · skala (długość, 1, szerokość kadłuba)
 * albo chowa grupę (elements[15] = 0).
 */
export function buildYardStreetScene(layout, style, { sleds = YARD_TRI_SLEDS } = {}) {
  const { f, plates, labels, lamps, Q } = newScene();
  const Tr = layout.yard.tri;
  const T = YARD_TRI;
  const X = (a, c) => Tr.at(a, c);
  const D = (na, nc) => [Tr.rx * na + Tr.tx * nc, Tr.rz * na + Tr.tz * nc];
  const yt = H.spineTop;
  const C = X(Tr.ca, 0);

  // --- kratownica: odcinek od drogi ringu do skrzyżowania i obwodnica dookoła doku
  const stemPts = [];
  const n0 = Math.max(2, Math.round((Tr.junction[0] - Tr.aRoad) / 460));
  for (let k = 0; k <= n0; k++) stemPts.push(X(Tr.aRoad + ((Tr.junction[0] - Tr.aRoad) * k) / n0, 0));
  const stem = stations(stemPts, 460, false);
  const loop = stations(Tr.loop.slice(0, -1).map((p) => X(p[0], p[1])), 460, true);
  truss(Q, stem.list, false);
  truss(Q, loop.list, true);
  // węzły kratownicy: przy drodze ringu i na skrzyżowaniu z obwodnicą
  for (const p of [X(Tr.aRoad, 0), X(Tr.junction[0], 0)]) {
    Q.cyl(p, yt + 22, 330, 64, M.steel);
    Q.cyl(p, yt + 58, 270, 10, M.rail);
    for (let j = 0; j < 8; j++) Q.lamp([p[0] + Math.cos((j / 8) * TAU) * 290, p[1] + Math.sin((j / 8) * TAU) * 290], yt + 66, 16, M.cyan, 1.3, PB_FX.chase, j / 8, 0.8);
  }

  // --- światła ulicy na kratownicy: oś (białe kreski) i dwa pasy. Ruch prawostronny: odcinkiem od hali w głąb
  // stoczni po stronie −c (zielone), z powrotem po stronie +c (bursztynowe); na obwodnicy pas zewnętrzny biegnie
  // B → A → C (bursztynowe), wewnętrzny C → A → B (zielone).
  const lights = (S, outerOf, incGreen) => {
    const m = Math.max(2, Math.round(S.len / 240));
    const o = {};
    for (let i = 0; i < m + (S.closed ? 0 : 1); i++) {
      const d = (S.len * i) / m;
      S.path.at(d, o);
      const t = [Math.cos(o.h), Math.sin(o.h)];
      const p = [o.x, o.z];
      if (i % 2 === 0) { f.fx(0.95, PB_FX.steady); Q.box(p, yt + 28, 90, 6, 10, M.white, t[0], t[1]); f.nofx(); }
      const out = outerOf(p, t);
      const ph = ((i / m) * (S.len / 2400)) % 1;
      // pas, którym jedzie się zgodnie z rosnącym parametrem: faza 1 − ph (jak na drodze przy ringu)
      Q.lamp(add(p, out, incGreen ? -650 : 650), yt + 30, 14, M.green, 1.15, PB_FX.chase, 1 - ph, 0.7);
      Q.lamp(add(p, out, incGreen ? 650 : -650), yt + 30, 14, M.warm, 1.15, PB_FX.chase, ph, 0.7);
    }
  };
  stem.closed = false;
  loop.closed = true;
  // odcinek od hali: parametr rośnie w głąb stoczni; „na zewnątrz” = +c → zielony pas po stronie −c
  lights(stem, () => D(0, 1), true);
  // obwodnica: parametr rośnie od skrzyżowania przez bok C; „na zewnątrz” = od środka doku → zielony pas wewnętrzny
  lights(loop, (p, t) => { const n = [-t[1], t[0]]; return (p[0] - C[0]) * n[0] + (p[1] - C[1]) * n[1] > 0 ? n : [-n[0], -n[1]]; }, true);

  // --- odnogi kratownicy do pochylni: tory wózka od końca pochylni do osi ulicy
  const sideOf = Object.fromEntries(Tr.sides.map((sd) => [sd.key, sd]));
  for (const s of Tr.slips) {
    const sd = sideOf[s.side];
    const pt = (u, d) => X(sd.P[0] + sd.t[0] * u + sd.n[0] * d, sd.P[1] + sd.t[1] * u + sd.n[1] * d);
    const t = D(sd.t[0], sd.t[1]);
    const w = s.def.w;
    for (const side of [-1, 1]) {
      const u = s.uc + side * w * 0.2;
      Q.seg(pt(u, T.slipD - 30), pt(u, Tr.Dc - 150), yt, 34, 34, M.steel);
      Q.beam(pt(u, T.slipD + 120), yt, pt(u, T.slipD + 420), H.spineBottom, 16, M.rail);
    }
    for (const dd of [T.slipD + 160, (T.slipD + Tr.Dc) / 2, Tr.Dc - 320]) Q.box(pt(s.uc, dd), yt - 16, w * 0.5, 24, 24, M.dark, t[0], t[1]);
    for (let k = 0; k < 4; k++) Q.lamp(pt(s.uc, T.slipD + 260 + k * ((Tr.Dc - T.slipD - 520) / 3)), yt + 22, 16, M.cyan, 1.25, PB_FX.chase, 1 - k / 4, 0.9);
  }

  // --- bramownice (FG): portal wlotu przy hali, dwie nad odcinkiem od hali, wysięgniki z budowli nad pasem zewnętrznym
  const hw = Tr.hwS;
  const signs = [
    { t0: 0.18, t1: 0.4, mat: M.green, gain: 1.0 },
    { t0: 0.6, t1: 0.82, mat: M.warm, gain: 1.0 }
  ];
  lintelXZ(Q, f, X(90, -hw - 150), X(90, hw + 150), 170, [{ t0: 0.2, t1: 0.8, mat: M.cyan, gain: 1.15 }], 300);
  Q.label('STOCZNIA', X(90, 0), 900, 150, style.labels.gate, 'WJAZD Z DROGI', H.over + 112, 'fg', ...D(0, 1));
  for (const [i, a] of [Tr.stemBar * 0.42, Tr.stemBar * 0.84].entries()) lintelXZ(Q, f, X(a, -hw - 120), X(a, hw + 120), 90, signs, 310 + i);
  for (const sd of Tr.sides) {
    for (const [i, tt] of [0.2, 0.5, 0.8].entries()) {
      const u = sd.len * tt;
      const pt = (d) => X(sd.P[0] + sd.t[0] * u + sd.n[0] * d, sd.P[1] + sd.t[1] * u + sd.n[1] * d);
      lintelXZ(Q, f, pt(Tr.Dout + 130), pt(Tr.Dc + 60), 80, [{ t0: 0.3, t1: 0.86, mat: M.warm, gain: 1.0 }], 320 + sd.key.charCodeAt(0) + i, 1);
    }
    pushLamp(lamps, X((sd.P[0] + sd.Q[0]) / 2 + sd.n[0] * Tr.Dc, (sd.P[1] + sd.Q[1]) / 2 + sd.n[1] * Tr.Dc), 340, 1);
  }
  pushLamp(lamps, X(Tr.junction[0], 0), 340, 1);
  pushLamp(lamps, X(Tr.stemBar * 0.5, 0), 340, 1);

  // --- wózki na kratownicy: rama pod kadłubem (żółte belki przy burtach, poprzeczki łoża), słupy i płozy na pasach
  const list = [];
  for (let i = 0; i < sleds; i++) {
    const g = i + 1;
    f.group = g;
    for (const side of [-1, 1]) {
      f.box(0, 26, side * 0.5, 1, 26, 0.05, M.yellow, 0);
      f.box(0, yt + 62, side * 0.17, 0.92, 54, 0.08, M.steel, 0);
      for (const x of [-0.42, 0, 0.42]) f.box(x, (yt + 90 + 14) / 2, side * 0.3, 0.022, 14 - (yt + 90), 0.05, M.rail, 0);
    }
    for (const x of [-0.5, 0.5]) f.box(x, 22, 0, 0.014, 18, 1.05, M.yellow, 0);
    for (const x of [-0.3, 0, 0.3]) f.box(x, 14, 0, 0.03, 12, 0.92, M.dark, 0);
    f.box(0, yt + 98, 0, 0.96, 18, 0.66, M.dark, 0);
    for (const x of [-0.5, 0.5]) {
      for (const side of [-1, 1]) {
        f.fx(1.6, PB_FX.blink, x > 0 ? 0 : 0.5, 1.4);
        f.box(x, 44, side * 0.5, 0.02, 10, 0.06, M.warm, 0);
        f.nofx();
      }
    }
    f.group = 0;
    list.push(g);
  }
  if (sleds + 1 > PB_MAX_GROUPS) throw new Error(`stocznia Ziemi, ulica: ${sleds} wózków > ${PB_MAX_GROUPS - 1}`);
  return sceneOf(f, plates, labels, lamps, { sleds: list, groups: sleds });
}
