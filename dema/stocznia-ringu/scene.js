// Port przy ringu z drogą w środku (koncept v2) — BRYŁY jako dane instancji zestawu budowli portowych (PortRecorder,
// portBuildingScene.js): te same materiały, lampy i efekty co doki portów i hale K-7. Bez three (czyste dane).
//
// Geometria z `layout.js` (kolizje = te same wielokąty co korpusy). Wysokości jak w K-7: y nad pokładem, płaszczyzna
// gry y = 116 (z świata 0), nad nią ×0,42. Zestawy: bg — pod statkami (korpusy, dna doków, kręgosłup z rurami pod
// drogą), fg — nad statkami (wieże, bramownice nad drogą, nadproża wjazdu i wylotu suchego doku), roof — dach hangaru
// (osobna budowla na hangar: zanika, gdy gracz jest w środku — jak dach hali K-7).
import { PB_FX, PB_MAT, PB_MAX_LAMPS, PortRecorder, pbHash1, pbLabel, pbPlate } from '../../src/3d/portBuildings/portBuildingScene.js';
import { k7HeightToZ } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { YARD_R0, YARD_RING, yardPhi, yardPoint } from './layout.js';

const M = PB_MAT;
const R0 = YARD_R0;
const Y = YARD_RING;
const scale = (v) => (R0 + v) / R0;

/** Wysokości (K-7) części portu. */
export const YARD_H = Object.freeze({
  keel: -170,        // spód korpusów
  floor: 18,         // dno doku, wjazdu i suchego doku floty (pod kadłubem: kadłub 48…116)
  mark: 24,
  lane: 30,
  gear: 84,
  wallLight: 92,     // listwy świetlne na ścianach drogi (wysokość kadłuba)
  deck: 250,         // wierzch rzędów (z ≈ +56 — ściany doków wyższe niż kadłub)
  roof: 262,         // dach hangaru
  over: 400,         // spód bramownic i nadproży nad korytarzem lotu (z ≈ +119)
  spineTop: -330,
  spineBottom: -560
});
const H = YARD_H;

/** Kanały statusu budowli (uChan): najwyżej tyle lamp stanu z kanałem na budowlę. */
export const YARD_STATUS_CHANNELS = 16;

export function tools(f, plates, labels) {
  const P = (s, v) => yardPoint(s, v, [0, 0]);
  const T = {
    P,
    /** Prostopadłościan: `ls` wzdłuż łuku, `lv` promieniowo (wymiary w jednostkach świata). */
    box(s, v, y, ls, h, lv, mat, rot = 0) {
      const [x, z] = P(s, v);
      f.box(x, y, z, ls, h, lv, mat, yardPhi(s) + rot);
    },
    /** Odcinek między dwoma punktami łuku (prostopadłościan o szerokości `wid`). */
    seg(s0, v0, s1, v1, y, h, wid, mat) {
      const a = P(s0, v0);
      const b = P(s1, v1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) return;
      f.box((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, len, h, wid, mat, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
    },
    /** Pas wzdłuż łuku na stałym v (kawałki co `step`). */
    run(s0, s1, v, y, h, wid, mat, step = 320, fill = 1.03) {
      const span = Math.abs(s1 - s0);
      if (span < 1) return;
      const n = Math.max(1, Math.ceil(span / step));
      const len = (span / n) * scale(v) * fill;
      for (let k = 0; k < n; k++) T.box(s0 + ((s1 - s0) * (k + 0.5)) / n, v, y, len, h, wid, mat);
    },
    cyl(s, v, y, r, h, mat) {
      const [x, z] = P(s, v);
      f.cyl(x, y, z, r, h, mat);
    },
    /** Rura pozioma między dwoma punktami łuku. */
    pipe(s0, v0, s1, v1, y, r, mat) {
      const a = P(s0, v0);
      const b = P(s1, v1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) return;
      f.cyl((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, r, len, mat, [0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), Math.PI / 2]);
    },
    pipeRun(s0, s1, v, y, r, mat, step = 420) {
      const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
      for (let k = 0; k < n; k++) T.pipe(s0 + ((s1 - s0) * k) / n, v, s0 + ((s1 - s0) * (k + 1)) / n, v, y, r, mat);
    },
    beam(a, b, w, mat) {
      const p = P(a[0], a[1]);
      const q = P(b[0], b[1]);
      f.beam([p[0], a[2], p[1]], [q[0], b[2], q[1]], w, mat);
    },
    lamp(s, v, y, size, mat, gain = 1.2, mode = PB_FX.steady, phase = 0, param = 0) {
      f.fx(gain, mode, phase, param);
      T.box(s, v, y, size, size * 0.5, size, mat);
      f.nofx();
    },
    /** Płyta — wycinek pierścienia (s0…s1 × v0…v1), dzielona na kawałki łuku. */
    sec(s0, s1, v0, v1, bottom, height, mat, set = 'bg') {
      const a = Math.min(s0, s1);
      const b = Math.max(s0, s1);
      const n = Math.max(1, Math.ceil((b - a) / Y.maxPiece));
      for (let k = 0; k < n; k++) {
        const p = a + ((b - a) * k) / n;
        const q = a + ((b - a) * (k + 1)) / n;
        pbPlate(plates, [P(p, v0), P(q, v0), P(q, v1), P(p, v1)], bottom, height, mat, set);
      }
    },
    /** Pasy ostrzegawcze wzdłuż łuku. */
    hazardRun(s0, s1, v, y, wid) {
      const span = Math.abs(s1 - s0) * scale(v);
      const n = Math.max(2, Math.round(span / (wid * 0.9)));
      for (let i = 0; i < n; i++) T.box(s0 + ((s1 - s0) * (i + 0.5)) / n, v, y, (span / n) * 0.52, 1.6, wid, i % 2 ? M.black : M.yellow, 0.5);
    },
    /** Pasy ostrzegawcze wzdłuż promienia. */
    hazardRad(s, v0, v1, y, wid) {
      const span = Math.abs(v1 - v0);
      const n = Math.max(2, Math.round(span / (wid * 0.9)));
      for (let i = 0; i < n; i++) T.box(s, v0 + ((v1 - v0) * (i + 0.5)) / n, y, wid, 1.6, (span / n) * 0.52, i % 2 ? M.black : M.yellow, 0.5);
    },
    /** Strzałka z dwóch odcinków (szewron): wierzchołek w (s, v), ramiona w stronę przeciwną do (ds, dv). */
    chevron(s, v, y, size, wid, mat, ds, dv) {
      const k = size / scale(v);
      // kierunek jednostkowy (ds, dv) i prostopadły do niego
      T.seg(s, v, s - ds * k * 0.7 + dv * k * 0.7, v - dv * size * 0.7 - ds * size * 0.7, y, 2.2, wid, mat);
      T.seg(s, v, s - ds * k * 0.7 - dv * k * 0.7, v - dv * size * 0.7 + ds * size * 0.7, y, 2.2, wid, mat);
    },
    label(text, s, v, width, depth, color, small = '', y = H.deck + 9, set = 'bg', rot = 0) {
      const [x, z] = P(s, v);
      pbLabel(labels, text, x, z, width, depth, color, small, yardPhi(s) + rot, y, set);
    }
  };
  return T;
}

export const sceneOf = (f, plates, labels, lamps, extra = {}) => ({ sets: f.sets, plates, labels, lamps, groups: [], rig: extra, instances: f.count() });
export function pushLamp(lamps, s, v, y, kind = 1) {
  if (lamps.length >= PB_MAX_LAMPS) return;
  const [x, z] = yardPoint(s, v, [0, 0]);
  lamps.push([x, k7HeightToZ(y), z, kind]);
}
export function newScene() {
  const f = new PortRecorder();
  const plates = [];
  const labels = [];
  const lamps = [];
  return { f, plates, labels, lamps, T: tools(f, plates, labels) };
}

// ---------------------------------------------------------------------------
// Korpusy i doki (wspólne dla rzędów i suchego doku floty)

export const TOP_MATS = [M.steel, M.steel, M.rail, M.steel, M.pale, M.steel];

/** Nadbudówki i osprzęt na wierzchu kawałka belki (ziarno z położenia — stałe między przebudowami). */
export function greebles(T, f, piece) {
  const a = piece.s0;
  const b = piece.s1;
  const sw = scale(piece.v0);
  const w = (b - a) * sw;
  const vd = piece.v1 - piece.v0;
  if (w < 150 || vd < 260) return;
  const seed = Math.round(a * 0.37 + piece.v0 * 1.31);
  const h1 = pbHash1(seed + 1.7);
  const h2 = pbHash1(seed + 5.3);
  const h3 = pbHash1(seed + 9.1);
  const sc = (a + b) / 2;
  const vc = (piece.v0 + piece.v1) / 2;
  const base = H.deck + 6;
  const S = (d) => d / sw;              // długość świata → przesunięcie w s
  if (vd > 900) {
    // szeroki pas za dokiem: blok maszynowni, pole radiatorów albo zbiorniki
    const kind = Math.floor(h1 * 4);
    const bv = piece.v0 + vd * (0.25 + 0.3 * h2);
    if (kind === 0) {
      const bh = 40 + 70 * h3;
      T.box(sc, bv, base + bh / 2, w * 0.62, bh, vd * 0.28, M.steel);
      T.box(sc, bv, base + bh + 4, w * 0.5, 8, vd * 0.2, h2 > 0.5 ? M.pale : M.rail);
      T.box(sc, bv - vd * 0.15, base + bh * 0.55, w * 0.3, 14, 10, M.glass);
    } else if (kind === 1) {
      const fins = Math.max(4, Math.floor((w * 0.7) / 46));
      for (let k = 0; k < fins; k++) T.box(a + S(w * 0.15 + ((w * 0.7) * (k + 0.5)) / fins), bv, base + 26, 8, 52, vd * 0.28, M.copper);
      T.pipe(a + S(w * 0.12), bv, b - S(w * 0.12), bv, base + 8, 12, M.steel);
    } else if (kind === 2) {
      for (const o of [-1, 1]) {
        T.pipe(sc + S(o * w * 0.2), bv - vd * 0.13, sc + S(o * w * 0.2), bv + vd * 0.13, base + 34, 30, o > 0 || h3 < 0.75 ? M.pale : M.orange);
        T.box(sc + S(o * w * 0.2), bv, base + 8, 74, 16, 60, M.dark);
      }
    } else {
      T.box(sc, bv, base + 14, w * 0.7, 28, vd * 0.2, M.rail);
      for (let k = 0; k < 5; k++) T.box(a + S(w * (0.2 + 0.15 * k)), bv, base + 32, 22, 8, vd * 0.16, M.steel);
    }
  } else if (w > 200 && vd > 400) {
    // wąski kawałek (ząb albo pas za małym dokiem): skrzynka i kratka
    T.box(sc, vc + vd * 0.2 * (h1 - 0.5), base + 12, Math.min(w * 0.5, 160), 24, Math.min(vd * 0.3, 240), h2 > 0.5 ? M.steel : M.rail);
    if (h3 > 0.55) T.box(sc, vc - vd * 0.28, base + 5, Math.min(w * 0.6, 150), 10, 60, M.rail);
  }
}

/**
 * Korpusy kawałków stref: blok (przecina płaszczyznę gry), wierzch z paneli, nadbudówki; na licu od strony wylotów
 * doków (droga albo plac suchego doku) krawężnik, listwa świetlna na wysokości kadłuba i pas stali.
 */
export function bodies(T, f, layout, zones, { strip = M.cyan, greeble = true } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.deck - H.keel, M.dark);
    const k = Math.floor(pbHash1(Math.round(p.s0 * 0.61 + p.v0 * 0.17) + 2.2) * TOP_MATS.length);
    const top = p.pit ? TOP_MATS[k] : (k === 4 ? M.pale : M.steel);
    const d = 9 / scale(p.v0);
    T.sec(p.s0 + d, p.s1 - d, p.v0 + 9, p.v1 - 9, H.deck, 6, top);
    if (greeble && p.orient === 'arc') greebles(T, f, p);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      T.run(p.s0, p.s1, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
      f.fx(1.1, PB_FX.steady);
      T.run(p.s0 + 8, p.s1 - 8, v + sign * 3, H.wallLight, 5, 6, strip, 500, 1.0);
      f.nofx();
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
    }
  }
}

/** Światła biegnące na koronie lica (kierunek ruchu po tej stronie drogi: dir = +1 ku +s). */
export function chaseRow(T, a, b, v, dir, mat, step = 300) {
  const n = Math.max(4, Math.round(((b - a) * scale(v)) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / (n + 1);
    T.lamp(a + ((b - a) * i) / n, v, H.deck + 18, 13, mat, 1.15, PB_FX.chase, dir > 0 ? (t * 12) % 1 : ((1 - t) * 12) % 1, 0.6);
  }
}

/**
 * Dok wycięty w belce wzdłuż łuku (wylot ku ±v): dno, znaczniki pola, rękaw i kleszcze, krawężniki, lampa stanu;
 * doki duże (capital, nosiciel) — listwy na ścianach, półki, łoża stępkowe, światła naprowadzania, reflektory;
 * hangar — pole siłowe w wylocie i lampy pod dachem (dach: buildHangarRoofScene).
 */
export function pitDetail(T, f, pit, { occupied = false, statusCh = -1, lamps = null, navy = false } = {}) {
  const a = pit.s0;
  const b = pit.s1;
  const sc = pit.sc;
  const big = pit.cls === 'capital' || pit.cls === 'carrier';
  const back = pit.open > 0 ? pit.v0 : pit.v1;          // ściana tylna
  const mouth = pit.open > 0 ? pit.v1 : pit.v0;         // wylot
  const inward = pit.open > 0 ? 1 : -1;                 // od ściany tylnej ku wylotowi (znak v)
  const depth = Math.abs(pit.v1 - pit.v0);
  const sw = scale(pit.vc);
  const S = (d) => d / sw;
  const wWorld = (b - a) * sw;
  const line = navy ? M.paint : M.paintCold;
  T.sec(a, b, pit.v0, pit.v1, H.keel, H.floor - H.keel, M.floor);
  T.hazardRun(a + S(14), b - S(14), mouth - inward * 26, H.floor + 3, big ? 44 : 26);
  const B = pit.berth;
  const half = B.width / 2;
  const nose = B.v - inward * (B.length / 2);
  const stern = B.v + inward * (B.length / 2);
  for (const side of [-1, 1]) T.box(sc + S(side * half), (nose + stern) / 2, H.mark, 9, 2, B.length * 0.94, line);
  T.box(sc, nose - inward * 6, H.mark, B.width + 30, 2, 14, M.yellow);
  const gw = Math.min(120, B.width * 0.4);
  T.box(sc, (back + nose) / 2, H.gear, gw, 22, Math.abs(nose - back) + 20, M.dark);
  T.box(sc, back + inward * 16, 70, Math.min(B.width * 0.7, 320), 80, 30, M.steel);
  T.box(sc, back + inward * 16, 112, Math.min(B.width * 0.66, 300), 4, 26, M.yellow);
  for (const side of [-1, 1]) T.box((side < 0 ? a : b) + S(side * 9), pit.vc, H.deck + 9, 16, 16, depth, M.rail);
  T.run(a, b, back - inward * 9, H.deck + 9, 16, 16, M.rail, 400);
  if (statusCh >= 0) {
    f.fx(1.45, PB_FX.status, 0, statusCh);
    T.box(sc, back - inward * 34, H.deck + 22, big ? 70 : 34, 12, big ? 26 : 18, M.status);
    f.nofx();
  } else {
    T.lamp(sc, back - inward * 30, H.deck + 20, big ? 40 : 22, occupied ? M.red : M.green, 1.25);
  }
  if (!big) {
    for (const side of [-1, 1]) T.lamp((side < 0 ? a : b) + S(side * 10), mouth + inward * 8, H.deck + 20, 16, M.warm, 1.1);
    return;
  }
  // --- dok duży: listwy na ścianach bocznych (wysokość kadłuba) i półki serwisowe
  for (const side of [-1, 1]) {
    const sw0 = (side < 0 ? a : b) - S(side * 4);
    f.fx(1.05, PB_FX.steady);
    T.box(sw0, pit.vc, H.wallLight, 6, 5, depth - 160, navy ? M.white : M.warm);
    f.nofx();
    T.box(sw0 - S(side * 34), pit.vc, 40, 64, 14, depth - 120, M.steel);
    const posts = pit.cls === 'capital' ? 6 : 4;
    for (let k = 0; k < posts; k++) {
      const v = back + inward * (220 + k * ((depth - 440) / (posts - 1)));
      T.box(sw0 - S(side * 34), v, 58, 40, 22, 60, k % 2 ? M.yellow : M.pale);
      T.cyl(sw0 - S(side * 14), v + 40, 68, 5, 100, M.rail);
    }
  }
  for (let v = nose + inward * 140; inward > 0 ? v < stern - 100 : v > stern + 100; v += inward * 190) {
    T.box(sc, v, H.floor + 14, B.width * 0.5, 26, 54, M.dark);
    for (const side of [-1, 1]) T.box(sc + S(side * B.width * 0.36), v, H.floor + 9, 60, 16, 40, M.steel);
  }
  for (let k = 0; k < 9; k++) {
    const v = mouth - inward * (60 + k * ((depth - 200) / 8));
    T.lamp(sc, v, H.lane, 16, M.green, 1.1, PB_FX.chase, k / 9, 0.9);
  }
  if (lamps) pushLamp(lamps, sc, pit.vc, 330, pit.kind === 'hangar' ? 2 : 1);
  if (pit.kind !== 'hangar') {
    // dok otwarty: reflektory na koronie ścian bocznych
    const n = pit.cls === 'capital' ? 5 : 3;
    for (const side of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const v = back + inward * (260 + k * ((depth - 520) / (n - 1)));
        const sx = (side < 0 ? a : b) + S(side * 22);
        T.box(sx, v, H.deck + 26, 30, 40, 44, M.dark);
        T.lamp(sx - S(side * 12), v, H.deck + 44, 20, M.white, 1.3);
      }
    }
    return;
  }
  // --- hangar: pole siłowe w wylocie, lampy pod dachem
  f.fx(1.5, PB_FX.steady);
  T.box(sc, mouth - inward * 8, 82, wWorld - 36, 78, 8, M.cyan);
  T.box(sc, mouth - inward * 8, H.deck - 8, wWorld - 20, 10, 14, M.cyan);
  f.nofx();
  for (const side of [-1, 1]) {
    const sx = (side < 0 ? a : b) - S(side * 12);
    T.box(sx, mouth - inward * 8, 110, 22, 300, 30, M.steel);
    f.fx(1.3, PB_FX.steady);
    T.box(sx - S(side * 12), mouth - inward * 8, 110, 5, 240, 8, M.cyan);
    f.nofx();
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) T.lamp((side < 0 ? a : b) - S(side * 60), back + inward * (240 + k * ((depth - 480) / 4)), H.lane + 6, 22, M.warm, 1.2);
  }
}

/** Dok w ścianie promieniowej (wylot ku ±s) — krążowniki w ścianach bocznych suchego doku floty. */
export function pitDetailRad(T, f, pit, { occupied = false } = {}) {
  const sw = scale(pit.vc);
  const S = (d) => d / sw;
  const back = pit.open > 0 ? pit.s0 : pit.s1;
  const mouth = pit.open > 0 ? pit.s1 : pit.s0;
  const inward = pit.open > 0 ? 1 : -1;                 // od ściany tylnej ku wylotowi (znak s)
  const depthW = (pit.s1 - pit.s0) * sw;
  const wid = pit.v1 - pit.v0;
  T.sec(pit.s0, pit.s1, pit.v0, pit.v1, H.keel, H.floor - H.keel, M.floor);
  T.hazardRad(mouth - S(inward * 26), pit.v0 + 14, pit.v1 - 14, H.floor + 3, 26);
  const B = pit.berth;
  for (const side of [-1, 1]) T.box(B.s, pit.vc + side * B.width / 2, H.mark, B.length * 0.94, 2, 9, M.paint);
  const nose = B.s - S(inward * B.length / 2);
  T.box(nose - S(inward * 6), pit.vc, H.mark, 14, 2, B.width + 30, M.yellow);
  T.box((back + nose) / 2, pit.vc, H.gear, Math.abs(nose - back) * sw + 20, 22, Math.min(120, B.width * 0.4), M.dark);
  T.box(back + S(inward * 16), pit.vc, 70, 30, 80, Math.min(B.width * 0.7, 320), M.steel);
  T.box(back + S(inward * 16), pit.vc, 112, 26, 4, Math.min(B.width * 0.66, 300), M.yellow);
  for (const side of [-1, 1]) T.box(pit.sc, (side < 0 ? pit.v0 : pit.v1) + side * 9, H.deck + 9, depthW, 16, 16, M.rail);
  T.box(back - S(inward * 9), pit.vc, H.deck + 9, 16, 16, wid, M.rail);
  T.lamp(back - S(inward * 30), pit.vc, H.deck + 20, 26, occupied ? M.red : M.green, 1.25);
  for (const side of [-1, 1]) T.lamp(mouth + S(inward * 8), (side < 0 ? pit.v0 : pit.v1) + side * 10, H.deck + 20, 16, M.white, 1.15);
}

/** Wieża-iglica (FG): schodkowy trzon z pasem okien, maszt, kogut przeszkodowy. */
export function spire(T, f, s, v, size, seed) {
  f.set = 'fg';
  const y0 = H.deck;
  const S = (d) => d / scale(v);
  T.box(s, v, y0 + 40, size * 1.5, 80, size * 1.5, M.steel);
  T.box(s, v, y0 + 84, size * 1.4, 10, size * 1.4, M.rail);
  for (const [ds, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) T.box(s + S(ds * size * 0.62), v + dv * size * 0.62, y0 + 120, size * (ds ? 0.2 : 0.5), 70, size * (ds ? 0.5 : 0.2), M.dark);
  T.box(s, v, y0 + 135, size, 110, size, M.steel);
  T.box(s, v, y0 + 196, size * 1.08, 14, size * 1.08, M.pale);
  T.box(s, v, y0 + 300, size * 0.7, 200, size * 0.7, M.dark);
  T.box(s, v, y0 + 250, size * 0.74, 30, size * 0.74, M.glass);
  T.box(s, v, y0 + 404, size * 0.76, 10, size * 0.76, M.pale);
  T.box(s, v, y0 + 500, size * 0.42, 190, size * 0.42, M.steel);
  T.box(s, v, y0 + 470, size * 0.46, 26, size * 0.46, M.glass);
  T.cyl(s, v, y0 + 690, 9, 200, M.rail);
  T.lamp(s, v, y0 + 796, 18, M.red, 1.8, PB_FX.blink, pbHash1(seed + 0.3), 0.5);
  for (const [ds, dv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) T.lamp(s + S(ds * size * 0.5), v + dv * size * 0.5, y0 + 204, 14, M.white, 1.25);
  f.set = 'bg';
}

/** Blok sterowni (FG): cokół, korpus z pasem okien, nadbudówka, anteny. `ls` wzdłuż łuku, `lv` promieniowo. */
export function controlBlock(T, f, s, v, ls, lv, seed) {
  f.set = 'fg';
  const y0 = H.deck;
  const S = (d) => d / scale(v);
  T.box(s, v, y0 + 30, ls * 1.16, 60, lv * 1.2, M.steel);
  T.box(s, v, y0 + 64, ls * 1.1, 8, lv * 1.14, M.rail);
  T.box(s, v, y0 + 100, ls, 80, lv, M.steel);
  T.box(s, v, y0 + 104, ls + 8, 26, lv + 8, M.glass);
  T.box(s, v, y0 + 146, ls * 0.94, 12, lv * 0.94, M.pale);
  for (const ds of [-1, 1]) {
    T.box(s + S(ds * ls * 0.36), v + lv * 0.1, y0 + 172, ls * 0.16, 40, lv * 0.6, M.steel);
    T.box(s + S(ds * ls * 0.36), v + lv * 0.1, y0 + 196, ls * 0.13, 8, lv * 0.5, M.rail);
  }
  T.box(s, v - lv * 0.2, y0 + 190, ls * 0.5, 80, lv * 0.3, M.steel);
  T.box(s, v - lv * 0.2, y0 + 200, ls * 0.52, 18, lv * 0.32, M.glass);
  T.box(s, v - lv * 0.2, y0 + 234, ls * 0.46, 8, lv * 0.26, M.pale);
  T.cyl(s - S(ls * 0.3), v + lv * 0.3, y0 + 172, 46, 12, M.pale);
  T.cyl(s - S(ls * 0.3), v + lv * 0.3, y0 + 162, 8, 30, M.rail);
  T.cyl(s + S(ls * 0.3), v + lv * 0.34, y0 + 240, 7, 180, M.rail);
  T.lamp(s + S(ls * 0.3), v + lv * 0.34, y0 + 336, 16, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.6), 0.5);
  for (const dv of [-1, 1]) for (const ds of [-1, 1]) T.lamp(s + S(ds * ls * 0.48), v + dv * lv * 0.48, y0 + 154, 14, M.white, 1.2);
  f.set = 'bg';
}

/**
 * Nadproże nad korytarzem lotu (FG): belka od (s0, v0) do (s1, v1) na słupach stojących na budowlach, listwy
 * sygnałowe od spodu po bokach. `signs`: [{ t0, t1, mat }] — odcinki belki (0…1) ze świecącą listwą.
 */
export function lintel(T, f, s0, v0, s1, v1, wid, signs = [], seed = 0) {
  f.set = 'fg';
  const y = H.over;
  T.seg(s0, v0, s1, v1, y + 45, 90, wid, M.steel);
  T.seg(s0, v0, s1, v1, y + 94, 8, wid * 0.8, M.rail);
  T.seg(s0, v0, s1, v1, y + 104, 10, wid * 0.3, M.pale);
  for (const [s, v] of [[s0, v0], [s1, v1]]) T.box(s, v, (H.deck + y) / 2, wid * 1.15, y - H.deck, wid * 1.15, M.steel);
  for (const g of signs) {
    const a = [s0 + (s1 - s0) * g.t0, v0 + (v1 - v0) * g.t0];
    const b = [s0 + (s1 - s0) * g.t1, v0 + (v1 - v0) * g.t1];
    f.fx(g.gain || 1.0, g.mode ?? PB_FX.steady, g.phase || 0, g.param || 0);
    T.seg(a[0], a[1], b[0], b[1], y + 112, 6, Math.min(26, wid * 0.2), g.mat);
    f.nofx();
  }
  T.lamp((s0 + s1) / 2, (v0 + v1) / 2, y + 126, 20, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.9), 0.5);
  f.set = 'bg';
}

/** Pasy MEGA strefy przy licu zewnętrznym: światła, lampa stanu, rękawy, napis; palce cumownicze. */
export function megaDetail(T, f, layout, zone, style, alloc) {
  let mi = 0;
  for (const lane of layout.megaLanes) {
    if (lane.zone !== zone) continue;
    const vf = lane.vFace;
    const sch = alloc(lane.berth.id);
    for (let i = 0; i < 9; i++) T.lamp(lane.sc - lane.sHalf + (2 * lane.sHalf * i) / 8, vf - 40, H.deck + 18, 16, M.warm, 1.15, PB_FX.chase, i / 9, 0.7);
    if (sch >= 0) {
      f.fx(1.45, PB_FX.status, 0, sch);
      T.box(lane.sc, vf - 60, H.deck + 22, 90, 12, 26, M.status);
      f.nofx();
    }
    for (const o of [-0.6, 0.6]) {
      T.box(lane.sc + o * lane.sHalf, vf + 80, H.gear, 90, 22, 190, M.dark);
      T.box(lane.sc + o * lane.sHalf, vf + 20, 100, 200, 60, 30, M.steel);
    }
    T.label('MG-' + (++mi), lane.sc, vf - 110, 380, 110, style.labels.capital, 'PAS MEGA');
  }
  for (const fg of layout.fingers) {
    if (fg.zone !== zone) continue;
    T.sec(fg.s0, fg.s1, fg.v0, fg.v1, H.keel + 40, H.deck - 60 - (H.keel + 40), M.dark);
    T.sec(fg.s0 + 10, fg.s1 - 10, fg.v0 + 10, fg.v1 - 10, H.deck - 60, 5, M.yellow);
    T.lamp(fg.sc, fg.v1 - 30, H.deck - 40, 24, M.red, 1.6, PB_FX.blink, pbHash1(fg.sc), 0.5);
    T.box(fg.sc, fg.v1 - 120, H.deck - 46, 110, 18, 60, M.steel);
  }
}

// ---------------------------------------------------------------------------
// Rząd przy ringu

/** Rząd doków dociśnięty do ściany ringu (strefy IL, IR) i ślepa ściana naprzeciw wjazdu (IC) z kierunkowskazami. */
export function buildInnerRowScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  bodies(T, f, layout, ['IL', 'IR', 'IC']);
  for (const pit of layout.pits) {
    if (pit.zone !== 'IL' && pit.zone !== 'IR') continue;
    pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });
  }
  // światła biegnące: po stronie ringu ruch jedzie ku −s (ruch prawostronny)
  chaseRow(T, Y.yardS, layout.sMax, V.inner1 - 34, -1, M.green);
  // ślepa ściana naprzeciw wjazdu: świecące szewrony w lewo i w prawo na wysokości kadłuba, pasy na koronie
  const g = layout.gate;
  for (const dir of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const s = dir * (260 + k * 230);
      f.fx(1.35, PB_FX.chase, k / 5, 0.9);
      T.seg(s, V.inner1 + 4, s + dir * 70, V.inner1 + 4, 84, 60, 8, M.cyan);
      T.seg(s + dir * 35, V.inner1 + 5, s + dir * 70, V.inner1 + 5, 124, 20, 8, M.cyan);
      T.seg(s + dir * 35, V.inner1 + 5, s + dir * 70, V.inner1 + 5, 44, 20, 8, M.cyan);
      f.nofx();
    }
  }
  T.hazardRun(g.s0 + 40, g.s1 - 40, V.inner1 - 60, H.deck + 8, 70);
  T.label('← DOKI · STOCZNIA', -700, V.inner1 - 300, 900, 150, style.labels.gate, 'DOKI CYWILNE · REFIT · LINIE BUDOWY');
  T.label('SUCHY DOK FLOTY →', 700, V.inner1 - 300, 900, 150, style.labels.gate, 'FLOTA TERRA NOVY');
  // rurociągi na koronie przy ścianie ringu i napisy sekcji
  for (const [a, b] of [[Y.yardS, g.s0], [g.s1, layout.sMax]]) {
    T.pipeRun(a + 60, b - 60, V.inner0 + 60, H.deck + 16, 12, M.copper);
    T.pipeRun(a + 60, b - 60, V.inner0 + 96, H.deck + 13, 7, M.hose);
  }
  for (let k = 0; k < 8; k++) pushLamp(lamps, Y.yardS + (k + 0.5) * ((layout.sMax - Y.yardS) / 8), V.inner1 + 250, 330, 1);
  return sceneOf(f, plates, labels, lamps);
}

// ---------------------------------------------------------------------------
// Rząd zewnętrzny: bloki doków cywilnych

/** Blok doków cywilnych rzędu zewnętrznego (`zone`: 'OL' albo 'OR'): doki L, suche doki, hangary, pasy MEGA. */
export function buildOuterRowScene(layout, zone, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const status = [];
  let ch = 0;
  bodies(T, f, layout, [zone]);
  const zp = layout.pieces.filter((p) => p.zone === zone);
  const a = Math.min(...zp.map((p) => p.s0));
  const b = Math.max(...zp.map((p) => p.s1));
  const pits = layout.pits.filter((p) => p.zone === zone);
  for (const pit of pits) {
    let sch = -1;
    if (pit.cls === 'capital' && ch < YARD_STATUS_CHANNELS) { sch = ch++; status.push({ ch: sch, berthId: pit.berth.id }); }
    pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id), statusCh: sch, lamps: pit.cls === 'capital' ? lamps : null });
    if (pit.kind === 'drydock') T.label(pit.id.split('-').pop(), pit.sc, pit.v1 + 150, 420, 120, style.labels.capital, 'SUCHY DOK');
  }
  // po stronie rzędu zewnętrznego ruch jedzie ku +s
  chaseRow(T, a, b, V.outer0 + 34, 1, M.warm);
  // lico zewnętrzne: krawężnik, świetlne szczeliny, rurociąg na koronie
  T.run(a, b, V.outer1 - 9, H.deck + 9, 16, 16, M.rail, 500);
  const so = scale(V.outer1);
  f.fx(1.3, PB_FX.steady);
  for (let s = a + 260 / so; s < b - 420 / so; s += 560 / so) T.run(s, s + 380 / so, V.outer1 + 3, 70, 30, 6, M.cyan, 400, 1.0);
  f.nofx();
  for (let s = a + 120 / so; s < b - 100 / so; s += 560 / so) T.box(s, V.outer1 + 10, 70, 60, 300, 26, M.steel);
  T.pipeRun(a + 60, b - 60, V.outer1 - 170, H.deck + 16, 12, M.copper);
  megaDetail(T, f, layout, zone, style, (berthId) => {
    if (ch >= YARD_STATUS_CHANNELS) return -1;
    status.push({ ch, berthId });
    return ch++;
  });
  // wieże: sterownie i iglice za parami doków L (szeroki pas wierzchu), napisy bloku
  const ls = pits.filter((p) => p.cls === 'l');
  const pairs = [];
  for (let i = 0; i + 1 < ls.length; i++) {
    if (ls[i + 1].s0 - ls[i].s1 < 600 && pits.indexOf(ls[i + 1]) === pits.indexOf(ls[i]) + 1) { pairs.push((ls[i].sc + ls[i + 1].sc) / 2); i++; }
  }
  pairs.forEach((s, i) => {
    if (i % 2 === 0) controlBlock(T, f, s, V.outer0 + 1420, 980, 760, 23 + s);
    else spire(T, f, s, V.outer0 + 1420, 520, 11 + s);
    T.label('DOKI CYWILNE', s, V.outer1 - 330, 980, 170, style.labels.berthLead, 'TERRA NOVA · PORT ZIEMIA');
  });
  // koniec drogi: pasy na czole bloku
  if (zone === 'OR') T.hazardRad(b - 34 / scale(V.outer0), V.outer0 + 30, V.outer1 - 30, H.deck + 8, 46);
  return sceneOf(f, plates, labels, lamps, { status });
}

/** Dach hangaru (osobna budowla — własny zanik): płyta, żebra, rdzeń wentylacji, napis. */
export function buildHangarRoofScene(layout, pit, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const sw = scale(pit.vc);
  const S = (d) => d / sw;
  const depth = pit.v1 - pit.v0;
  const wW = (pit.s1 - pit.s0) * sw;
  const m = 46;
  f.set = 'roof';
  T.sec(pit.s0 - S(m), pit.s1 + S(m), pit.v0 - (pit.open > 0 ? m : 0), pit.v1 + (pit.open > 0 ? 0 : m), H.deck + 2, H.roof - H.deck, M.steel, 'roof');
  for (let v = pit.v0 + 150; v < pit.v1 - 80; v += 300) T.box(pit.sc, v, H.roof + 18, wW + 60, 26, 34, M.pale);
  T.box(pit.sc, pit.vc, H.roof + 44, 150, 34, depth * 0.72, M.steel);
  for (let k = 0; k < 6; k++) T.box(pit.sc, pit.v0 + depth * (0.2 + k * 0.12), H.roof + 66, 120, 10, 24, M.rail);
  for (const side of [-1, 1]) {
    T.box(pit.sc + S(side * (wW / 2 + 14)), pit.vc, H.roof + 12, 30, 20, depth, M.yellow);
    for (let k = 0; k < 4; k++) T.box(pit.sc + S(side * wW * 0.27), pit.v0 + depth * (0.2 + k * 0.2), H.roof + 10, 220, 10, 190, k % 2 ? M.pale : M.rail);
  }
  T.label(pit.id.split('-').pop(), pit.sc, pit.vc + depth * 0.36 * (pit.open > 0 ? 1 : -1), 520, 150, style.labels.capital, 'HANGAR', H.roof + 4, 'roof');
  return sceneOf(f, plates, labels, lamps);
}

// ---------------------------------------------------------------------------
// Wjazd K-7

/**
 * Wjazd (przebudowana hala K-7): próg z pasami WJAZD / WYJAZD, wyspa ze sterownią, wieże po bokach, nadproża nad
 * oboma końcami gardzieli, pola siłowe pasów, światła podejścia w przestrzeni.
 */
export function buildGateScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const g = layout.gate;
  const isl = g.island;
  const apron = 700;                       // próg wysunięty przed lico zewnętrzne
  const so = scale(V.outer1);
  // próg: dno gardzieli i wysunięta płyta
  T.sec(g.s0, g.s1, V.outer0, V.outer1 + apron, H.keel, H.floor - H.keel, M.floor);
  T.hazardRun(g.s0 + 30, g.s1 - 30, V.outer1 + apron - 40, H.floor + 3, 60);
  T.hazardRun(g.s0 + 30, g.s1 - 30, V.outer0 + 36, H.floor + 3, 50);
  // pasy: linie krawędzi, szewrony kierunku, linie stopu, napisy
  for (const [lane, inward, mat, name] of [[g.laneIn, true, M.green, 'WJAZD'], [g.laneOut, false, M.warm, 'WYJAZD']]) {
    for (const side of [-1, 1]) T.box(lane.s + side * (lane.half - 70), (V.outer0 + V.outer1 + apron) / 2, H.mark, 10, 2, V.outer1 + apron - V.outer0 - 120, M.paintCold);
    for (let k = 0; k < 6; k++) {
      const v = V.outer0 + 420 + k * 420;
      T.chevron(lane.s, v + (inward ? -90 : 90), H.mark + 1, 240, 34, M.paint, 0, inward ? -1 : 1);
      f.fx(1.2, PB_FX.chase, inward ? k / 6 : 1 - k / 6, 0.9);
      for (const side of [-1, 1]) T.box(lane.s + side * (lane.half - 40), v, H.lane, 16, 8, 16, mat);
      f.nofx();
    }
    T.box(lane.s, inward ? V.outer0 + 150 : V.outer1 + apron - 150, H.mark, 2 * lane.half - 180, 2, 22, M.yellow);
    T.label(name, lane.s, V.outer1 + 360, 760, 190, style.labels.gate, '', H.mark + 2);
    // pole siłowe pasa na licu zewnętrznym
    f.fx(1.5, PB_FX.steady);
    T.box(lane.s, V.outer1 - 10, 82, (2 * lane.half - 60) * so, 78, 8, M.cyan);
    f.nofx();
    pushLamp(lamps, lane.s, V.outer0 + 700, 340, inward ? 2 : 1);
    pushLamp(lamps, lane.s, V.outer1 - 500, 340, inward ? 2 : 1);
  }
  // wyspa: korpus, pasy, sterownia (FG) i światła sygnałowe na obu końcach
  T.sec(isl.s0, isl.s1, isl.v0, isl.v1, H.keel, H.deck - H.keel, M.dark);
  T.sec(isl.s0 + 10, isl.s1 - 10, isl.v0 + 10, isl.v1 - 10, H.deck, 6, M.steel);
  T.hazardRad(0, isl.v0 + 20, isl.v0 + 200, H.deck + 8, 200);
  T.hazardRad(0, isl.v1 - 200, isl.v1 - 20, H.deck + 8, 200);
  for (const side of [-1, 1]) {
    f.fx(1.1, PB_FX.steady);
    T.box(side * (isl.s1 + 3), (isl.v0 + isl.v1) / 2, H.wallLight, 6, 5, isl.v1 - isl.v0 - 80, side > 0 ? M.green : M.warm);
    f.nofx();
  }
  f.set = 'fg';
  const yb = H.deck;
  T.box(0, (isl.v0 + isl.v1) / 2, yb + 60, 220, 120, 760, M.steel);
  T.box(0, (isl.v0 + isl.v1) / 2, yb + 96, 232, 26, 772, M.glass);
  T.box(0, (isl.v0 + isl.v1) / 2, yb + 126, 200, 12, 720, M.pale);
  T.cyl(0, (isl.v0 + isl.v1) / 2, yb + 220, 8, 180, M.rail);
  T.lamp(0, (isl.v0 + isl.v1) / 2, yb + 316, 18, M.red, 1.8, PB_FX.blink, 0.1, 0.5);
  for (const v of [isl.v0 + 110, isl.v1 - 110]) {
    T.cyl(0, v, yb + 70, 16, 140, M.steel);
    T.lamp(isl.s1 * 0.6, v, yb + 150, 26, M.green, 1.8, PB_FX.blink, 0, 0.7);
    T.lamp(isl.s0 * 0.6, v, yb + 150, 26, M.warm, 1.8, PB_FX.blink, 0.5, 0.7);
  }
  f.set = 'bg';
  // wieże wjazdu na czołach sąsiednich budowli i nadproża nad gardzielą (od strony przestrzeni i od strony drogi)
  const jl = g.s0 - 190 / so;
  const jr = g.s1 + 190 / so;
  spire(T, f, jl, V.outer1 - 330, 250, 51);
  spire(T, f, jr, V.outer1 - 330, 250, 52);
  const signs = [
    { t0: 0.62, t1: 0.88, mat: M.green, gain: 1.15 },
    { t0: 0.12, t1: 0.38, mat: M.warm, gain: 1.15 }
  ];
  lintel(T, f, jl, V.outer1 - 720, jr, V.outer1 - 720, 150, signs, 61);
  lintel(T, f, g.s0 - 120 / scale(V.outer0), V.outer0 + 220, g.s1 + 120 / scale(V.outer0), V.outer0 + 220, 120, signs, 62);
  T.label('K-7', 0, V.outer1 - 720, 520, 130, style.labels.berthLead, '', H.over + 112, 'fg');
  // światła podejścia w przestrzeni (pod płaszczyzną lotu): osie krawędzi pasów, biegną zgodnie z ruchem
  for (let k = 1; k <= 8; k++) {
    const v = V.outer1 + apron + k * 420;
    const t = k / 9;
    T.cyl(g.laneIn.s + g.laneIn.half - 60, v, H.lane - 20, 14, 50, M.dark);
    T.lamp(g.laneIn.s + g.laneIn.half - 60, v, H.lane + 12, 22, M.green, 1.5, PB_FX.chase, 1 - t, 0.8);
    T.cyl(g.laneOut.s - g.laneOut.half + 60, v, H.lane - 20, 14, 50, M.dark);
    T.lamp(g.laneOut.s - g.laneOut.half + 60, v, H.lane + 12, 22, M.warm, 1.5, PB_FX.chase, t, 0.8);
    T.cyl(0, v, H.lane - 20, 12, 50, M.dark);
    T.lamp(0, v, H.lane + 12, 18, M.white, 1.3, PB_FX.blink, t, 0.5);
  }
  return sceneOf(f, plates, labels, lamps);
}

// ---------------------------------------------------------------------------
// Suchy dok floty

/**
 * Suchy dok floty (wojsko): basen otwarty z góry z wylotem na drogę. Przy ścianie tylnej stanowiska capital (w osi
 * wylotu — domowe Atlasa) i nosicieli, w ścianach bocznych krążowniki, w belce przy drodze niszczyciele i fregaty.
 * `rig.status`: [{ ch, berthId }] — lampy stanu stanowisk capital i nosicieli.
 */
export function buildBasinScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const B = layout.basin;
  const status = [];
  let ch = 0;
  bodies(T, f, layout, ['B'], { strip: M.white });
  // dno placu manewrowego i wylotu
  T.sec(B.in0, B.in1, B.front1, B.lane1, H.keel, H.floor - H.keel, M.floor);
  T.sec(B.mouth0, B.mouth1, B.v0, B.front1, H.keel, H.floor - H.keel, M.floor);
  // malowanie placu: oś, krawędzie, oś wylotu, okrąg obrotu przed stanowiskiem domowym
  const sl = scale(B.laneV);
  for (let s = B.in0 + 300; s < B.in1 - 300; s += 520) T.box(s, B.laneV, H.mark, 260, 2, 12, M.paint);
  T.run(B.in0 + 60, B.in1 - 60, B.front1 + 90, H.mark, 2, 10, M.paintCold, 500);
  T.run(B.in0 + 60, B.in1 - 60, B.lane1 - 90, H.mark, 2, 10, M.paintCold, 500);
  for (let v = B.v0 + 120; v < B.lane1 - 200; v += 300) T.box(B.mouthC, v, H.mark, 12, 2, 150, M.yellow);
  const home = layout.home;
  for (let k = 0; k < 28; k++) {
    const a0 = (k / 28) * Math.PI * 2;
    const a1 = ((k + 0.6) / 28) * Math.PI * 2;
    const r = 1020;
    T.seg(home.sc + (Math.cos(a0) * r) / sl, B.laneV + Math.sin(a0) * r, home.sc + (Math.cos(a1) * r) / sl, B.laneV + Math.sin(a1) * r, H.mark, 2, 12, M.paintCold);
  }
  T.label('SUCHY DOK FLOTY', B.mouthC - 2600, B.laneV + 420, 1700, 300, style.labels.hub, 'TERRA NOVA · 1 FLOTA', H.mark + 2);
  T.label('SUCHY DOK FLOTY', B.mouthC + 2600, B.laneV + 420, 1700, 300, style.labels.hub, 'TERRA NOVA · 1 FLOTA', H.mark + 2);
  // doki i stanowiska
  for (const pit of layout.pits) {
    if (pit.zone !== 'B') continue;
    const occ = occupied.has(pit.berth.id);
    if (pit.orient === 'rad') { pitDetailRad(T, f, pit, { occupied: occ }); continue; }
    let sch = -1;
    const big = pit.cls === 'capital' || pit.cls === 'carrier';
    if (big && ch < YARD_STATUS_CHANNELS) { sch = ch++; status.push({ ch: sch, berthId: pit.berth.id }); }
    pitDetail(T, f, pit, { occupied: occ, statusCh: sch, lamps: pit.cls === 'capital' ? lamps : null, navy: true });
    if (big) T.label(pit.id.split('-').pop(), pit.sc, pit.v0 - 150, pit.cls === 'capital' ? 360 : 260, pit.cls === 'capital' ? 110 : 84, pit.home ? style.labels.berthLead : style.labels.capital, pit.home ? 'ATLAS' : (pit.cls === 'carrier' ? 'NOSICIEL' : 'CAPITAL'), H.mark + 2);
  }
  // stanowisko domowe: rama świetlna na dnie i na koronie ściany tylnej
  f.fx(1.3, PB_FX.steady);
  for (const side of [-1, 1]) T.box(home.sc + (side * (home.berth.width / 2 + 60)) / scale(home.vc), home.vc, H.lane - 2, 8, 6, home.v1 - home.v0 - 240, M.cyan);
  T.box(home.sc, home.v1 + 60, H.deck + 22, 420, 10, 16, M.cyan);
  f.nofx();
  T.label('ATLAS', home.sc, home.v1 + 170, 420, 110, style.labels.berthLead, 'STANOWISKO DOMOWE');
  // wylot na drogę: pole siłowe, pasy, nadproże z białymi listwami (FG), słupy sygnałowe
  const sm = scale(B.v0);
  f.fx(1.5, PB_FX.steady);
  T.box(B.mouthC, B.v0 + 8, 82, (B.mouth1 - B.mouth0) * sm - 40, 78, 8, M.cyan);
  f.nofx();
  T.hazardRun(B.mouth0 + 20, B.mouth1 - 20, B.v0 + 60, H.floor + 3, 60);
  for (const [s, side] of [[B.mouth0, -1], [B.mouth1, 1]]) {
    T.hazardRad(s + (side * 40) / sm, B.v0 + 30, B.front1 - 30, H.deck + 8, 60);
    T.box(s - (side * 9) / sm, (B.v0 + B.front1) / 2, H.deck + 9, 16, 16, B.front1 - B.v0, M.rail);
    f.fx(1.1, PB_FX.steady);
    T.box(s - (side * 3) / sm, (B.v0 + B.front1) / 2, H.wallLight, 6, 5, B.front1 - B.v0 - 60, M.white);
    f.nofx();
  }
  lintel(T, f, B.mouth0 - 74 / sm, B.v0 + 350, B.mouth1 + 74 / sm, B.v0 + 350, 110,
    [{ t0: 0.3, t1: 0.7, mat: M.white, gain: 1.0 }], 71);
  T.label('FLOTA', B.mouthC, B.v0 + 350, 620, 120, style.labels.berthLead, '', H.over + 112, 'fg');
  // ściany boczne: wieża dowodzenia floty i sterownia (FG) za strefą doków krążowników; reflektory na koronie
  const wl = (B.s0 + B.in0) / 2;
  const wr = (B.in1 + B.s1) / 2;
  spire(T, f, wr, (B.lane1 + B.v1) / 2 + 200, 560, 81);
  controlBlock(T, f, wl, (B.lane1 + B.v1) / 2 + 200, 760, 1500, 82);
  for (const s of [wl, wr]) {
    for (let v = B.lane1 + 200; v < B.v1 - 200; v += 520) T.lamp(s, v, H.deck + 22, 18, M.white, 1.2);
  }
  // lico drogi: krawężnik i listwa na belce przy drodze i czołach ścian bocznych
  for (const [a, b] of [[B.s0, B.mouth0], [B.mouth1, B.s1]]) {
    T.run(a, b, V.outer0 + 9, H.deck + 9, 16, 16, M.rail, 500);
    f.fx(1.1, PB_FX.steady);
    T.run(a + 8, b - 8, V.outer0 - 3, H.wallLight, 5, 6, M.cyan, 500, 1.0);
    f.nofx();
    T.run(a + 4, b - 4, V.outer0 - 2, 40, 30, 5, M.steel, 500, 1.0);
  }
  // czoła zębów między stanowiskami: maszty reflektorów
  const backPits = layout.pits.filter((p) => p.zone === 'B' && p.bar === 'back').sort((p, q) => p.s0 - q.s0);
  for (let i = 0; i + 1 < backPits.length; i++) {
    const s = (backPits[i].s1 + backPits[i + 1].s0) / 2;
    T.box(s, B.lane1 + 70, H.deck + 40, 60, 80, 60, M.steel);
    T.lamp(s, B.lane1 + 40, H.deck + 88, 26, M.white, 1.5);
    T.hazardRun(backPits[i].s1 + 20, backPits[i + 1].s0 - 20, B.lane1 + 30, H.deck + 8, 40);
  }
  // ściana tylna: krawężnik, świetlne szczeliny na licu zewnętrznym, rurociąg
  T.run(B.s0, B.s1, B.v1 - 9, H.deck + 9, 16, 16, M.rail, 500);
  const so = scale(B.v1);
  f.fx(1.3, PB_FX.steady);
  for (let s = B.s0 + 300 / so; s < B.s1 - 460 / so; s += 620 / so) T.run(s, s + 400 / so, B.v1 + 3, 70, 30, 6, M.cyan, 400, 1.0);
  f.nofx();
  for (const [s, side] of [[B.s0, -1], [B.s1, 1]]) {
    f.fx(1.3, PB_FX.steady);
    for (let v = layout.v.outer1 + 400; v < B.v1 - 300; v += 620) T.box(s + (side * 3) / scale(v), v, 70, 6, 30, 380, M.cyan);
    f.nofx();
    T.box(s - (side * 9) / scale(B.v1), (layout.v.outer1 + B.v1) / 2, H.deck + 9, 16, 16, B.v1 - layout.v.outer1, M.rail);
  }
  megaDetail(T, f, layout, 'B', style, (berthId) => {
    if (ch >= YARD_STATUS_CHANNELS) return -1;
    status.push({ ch, berthId });
    return ch++;
  });
  // światła biegnące na licu drogi (ruch ku +s po stronie rzędu zewnętrznego) i oświetlenie placu
  chaseRow(T, B.s0, B.s1, V.outer0 + 34, 1, M.warm);
  for (const s of [B.in0 + 1500, B.mouthC - 1500, B.mouthC + 1500, B.in1 - 1500]) pushLamp(lamps, s, B.laneV, 360, 2);
  pushLamp(lamps, B.mouthC, B.laneV, 380, 2);
  return sceneOf(f, plates, labels, lamps, { status });
}

// ---------------------------------------------------------------------------
// Droga i kręgosłup

/**
 * Droga: kręgosłup z rurami pod płaszczyzną lotu (ciągnie się dalej po łuku ringu), światła osi i pasów na
 * kręgosłupie, bramownice nad drogą (FG), bramy wylotów na końcach kompleksu.
 */
export function buildRoadScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const vc = V.road;
  const E = Y.extent;
  const yt = H.spineTop;
  const yb = H.spineBottom;
  const ym = (yt + yb) / 2;
  const step = 460;
  const n = Math.ceil((2 * E) / step);
  // kratownica: pasy górne i dolne, poprzeczki, krzyżulce
  for (const side of [-1, 1]) {
    T.run(-E, E, vc + side * 190, yt, 46, 46, M.steel, step);
    T.run(-E, E, vc + side * 110, yb, 40, 40, M.dark, step);
  }
  for (let k = 0; k <= n; k++) {
    const s = -E + ((2 * E) * k) / n;
    T.box(s, vc, yt, 30, 30, 380, M.steel);
    T.box(s, vc, yb, 26, 26, 220, M.dark);
    for (const side of [-1, 1]) T.beam([s, vc + side * 190, yt], [s, vc + side * 110, yb], 22, M.dark);
    if (k < n) {
      const s2 = -E + ((2 * E) * (k + 1)) / n;
      for (const side of [-1, 1]) T.beam([s, vc + side * 190, yt], [s2, vc + side * 110, yb], 16, M.rail);
      T.beam(k % 2 ? [s, vc - 190, yt] : [s, vc + 190, yt], k % 2 ? [s2, vc + 190, yt] : [s2, vc - 190, yt], 14, M.rail);
    }
  }
  // rurociągi i zbiorniki w kratownicy
  T.pipeRun(-E, E, vc + 60, ym + 40, 26, M.copper, step);
  T.pipeRun(-E, E, vc - 60, ym + 10, 18, M.hose, step);
  T.pipeRun(-E, E, vc + 130, ym + 70, 12, M.pale, step);
  for (let s = -E + 900; s < E - 600; s += 2300) {
    T.pipe(s - 260, vc - 20, s + 260, vc - 20, ym - 30, 62, M.pale);
    T.box(s - 300, vc - 20, ym - 30, 30, 150, 150, M.dark);
    T.box(s + 300, vc - 20, ym - 30, 30, 150, 150, M.dark);
  }
  // światła drogi na kręgosłupie: oś (białe kreski) i dwa pasy (biegną zgodnie z ruchem: przy ringu ku −s)
  const sA = layout.sMin;
  const sB = layout.sMax;
  const m = Math.round((sB - sA) / 240);
  for (let i = 0; i <= m; i++) {
    const s = sA + ((sB - sA) * i) / m;
    if (i % 2 === 0) { f.fx(0.95, PB_FX.steady); T.box(s, vc, yt + 28, 90, 6, 10, M.white); f.nofx(); }
    const t = (i / m) * 30;
    T.lamp(s, vc + 650, yt + 30, 14, M.warm, 1.15, PB_FX.chase, 1 - (t % 1), 0.7);
    T.lamp(s, vc - 650, yt + 30, 14, M.green, 1.15, PB_FX.chase, t % 1, 0.7);
  }
  // bramownice nad drogą (FG): belka na słupach stojących na koronach rzędów, zielona listwa nad pasem „swoim”
  const B = layout.basin;
  const g = layout.gate;
  let gi = 0;
  for (let s = sA + 1500; s <= sB - 1500; s += 3100) {
    if (Math.abs(s) < g.s1 + 900) continue;
    if (s > B.mouth0 - 700 && s < B.mouth1 + 700) continue;
    if (layout.yard.tri && Math.abs(s - layout.yard.sc) < layout.yard.tri.junctionHalf + 400) continue;
    lintel(T, f, s, V.inner1 - 120, s, V.outer0 + 120, 90, [
      { t0: 0.2, t1: 0.4, mat: M.green, gain: 1.0 },
      { t0: 0.6, t1: 0.8, mat: M.warm, gain: 1.0 }
    ], 90 + gi++);
  }
  // wyloty na końcach kompleksu: brama, pasy, napis; dalej tylko kręgosłup
  for (const dir of [-1, 1]) {
    const end = dir > 0 ? sB : sA;
    const s = end - dir * 160;
    lintel(T, f, s, V.inner1 - 140, s, V.outer0 + 140, 160, [
      { t0: 0.25, t1: 0.75, mat: dir > 0 ? M.warm : M.green, gain: 1.15, mode: PB_FX.blink, param: 0.5 }
    ], 110 + dir);
    T.label('WYLOT', s, vc, 520, 120, style.labels.gate, '', H.over + 112, 'fg', Math.PI / 2);
    for (let k = 1; k <= 5; k++) {
      const so = end + dir * k * 520;
      for (const side of [-1, 1]) {
        T.cyl(so, vc + side * 1200, H.lane - 20, 14, 50, M.dark);
        T.lamp(so, vc + side * 1200, H.lane + 12, 22, side * dir > 0 ? M.warm : M.green, 1.5, PB_FX.chase, k / 6, 0.8);
      }
    }
  }
  // poza kompleksem: wysięgniki i maszty na kręgosłupie (kolce sylwetki ringu) — pod płaszczyzną lotu
  for (const dir of [-1, 1]) {
    for (let d = 3300; ; d += 2100) {
      const sc = (dir > 0 ? sB : sA) + dir * d;
      if (Math.abs(sc) > E - 300) break;
      const h = pbHash1(sc * 0.013 + 4.4);
      const reach = 700 + 1300 * h;
      T.box(sc, vc + 190 + reach / 2, yt - 6, 54, 40, reach, M.steel);
      T.beam([sc, vc + 190, yb], [sc, vc + 190 + reach * 0.8, yt - 20], 18, M.rail);
      T.box(sc, vc + 190 + reach, yt + 10, 150, 70, 150, M.dark);
      T.lamp(sc, vc + 190 + reach, yt + 52, 22, M.white, 1.5, PB_FX.blink, h, 0.35);
      T.box(sc + 260, vc + 300, yt + 16, 240, 60, 160, h > 0.7 ? M.orange : M.steel);
      T.cyl(sc - 300, vc, yt + 40, 34, 100, M.pale);
    }
  }
  return sceneOf(f, plates, labels, lamps);
}

// ---------------------------------------------------------------------------
// Stocznia

/**
 * Hala stoczni przy drodze (od strony drogi doki REFITU: capital, L, M) i rząd dostaw przy ringu.
 * `rig.status`: [{ ch, berthId }] — lampy stanu doków refitu capital.
 */
export function buildYardScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const Yd = layout.yard;
  const status = [];
  let ch = 0;
  bodies(T, f, layout, ['YH', 'YI'], { strip: M.warm });
  const lPits = [];
  for (const pit of layout.pits) {
    if (pit.zone !== 'YH' && pit.zone !== 'YI') continue;
    let sch = -1;
    if (pit.kind === 'refit' && ch < YARD_STATUS_CHANNELS) { sch = ch++; status.push({ ch: sch, berthId: pit.berth.id }); }
    pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id), statusCh: sch, lamps: pit.kind === 'refit' ? lamps : null });
    if (pit.zone === 'YH' && pit.cls === 'l') lPits.push(pit);
    if (pit.kind !== 'refit') continue;
    // dok refitu: zasobniki części i stojaki dronów po obu stronach wylotu, napis na koronie za dokiem
    const sw = scale(pit.vc);
    for (const side of [-1, 1]) {
      const sx = (side < 0 ? pit.s0 : pit.s1) + (side * 170) / sw;
      T.box(sx, pit.v0 + 520, H.deck + 26, 150, 40, 560, M.orange);
      for (let k = 0; k < 5; k++) T.box(sx, pit.v0 + 300 + k * 110, H.deck + 52, 110, 10, 60, k % 2 ? M.yellow : M.dark);
      T.lamp(sx, pit.v0 + 860, H.deck + 56, 18, M.warm, 1.3, PB_FX.blink, side > 0 ? 0 : 0.5, 0.8);
    }
    T.label(pit.id.split('-').pop(), pit.sc, pit.v1 + 100, 360, 96, style.labels.capital, 'REFIT');
  }
  // wariant ziemski: hala przecięta skrzyżowaniem z ulicą stoczni — dwie połowy
  const J = Yd.tri ? Yd.tri.junctionHalf : 0;
  const spans = Yd.tri ? [[Yd.s0, Yd.sc - J], [Yd.sc + J, Yd.s1]] : [[Yd.s0, Yd.s1]];
  const so = scale(Yd.v1);
  // światła biegnące na licach drogi (ruch prawostronny)
  chaseRow(T, Yd.s0, Yd.s1, V.inner1 - 34, -1, M.green);
  for (const [a, b] of spans) {
    chaseRow(T, a, b, V.outer0 + 34, 1, M.warm);
    // lico zewnętrzne hali: krawężnik i świetlne szczeliny
    T.run(a, b, Yd.v1 - 9, H.deck + 9, 16, 16, M.rail, 500);
    f.fx(1.3, PB_FX.steady);
    for (let s = a + 260 / so; s < b - 420 / so; s += 560 / so) T.run(s, s + 380 / so, Yd.v1 + 3, 70, 30, 6, M.cyan, 400, 1.0);
    f.nofx();
    // rurociągi na koronie
    T.pipeRun(a + 60, b - 60, Yd.v1 - 250, H.deck + 16, 14, M.copper);
    T.pipeRun(a + 60, b - 60, Yd.v1 - 290, H.deck + 13, 9, M.hose);
  }
  // czoło hali na końcu drogi i rurociąg na rzędzie przy ringu
  T.hazardRad(Yd.s0 + 34 / scale(V.outer0), V.outer0 + 30, Yd.v1 - 30, H.deck + 8, 46);
  T.pipeRun(Yd.s0 + 60, Yd.s1 - 60, V.inner0 + 60, H.deck + 16, 12, M.copper);
  if (Yd.tri) {
    // skrzyżowanie: pasy ostrzegawcze na narożach hali i światła na rzędzie przy ringu naprzeciw wlotu
    for (const e of [-1, 1]) T.hazardRad(Yd.sc + e * (J + 34 / scale(V.outer0)), V.outer0 + 30, Yd.v1 - 30, H.deck + 8, 46);
    for (let k = -3; k <= 3; k++) T.lamp(Yd.sc + (k * 260) / scale(V.inner1), V.inner1 - 76, H.deck + 22, 20, M.cyan, 1.35, PB_FX.chase, (k + 3) / 7, 0.9);
  }
  // sterownie i iglice na szerokich pasach za dokami L hali
  lPits.forEach((pit, i) => {
    if (i % 2 === 0) controlBlock(T, f, pit.sc, pit.v1 + 760, 420, 900, 130 + i);
    else spire(T, f, pit.sc, pit.v1 + 760, 350, 140 + i);
  });
  // napisy
  for (const t of Yd.tri ? [0.2, 0.8] : [0.17, 0.5, 0.83]) {
    T.label('STOCZNIA', Yd.s0 + (Yd.s1 - Yd.s0) * t, Yd.v1 - 110, 1500, 150, style.labels.hub, 'TERRA NOVA · BUDOWA I REFIT');
    T.label('DOSTAWY STOCZNI', Yd.s0 + (Yd.s1 - Yd.s0) * t, V.inner0 + 86, 900, 110, style.labels.clear);
  }
  for (let k = 0; k < 5; k++) pushLamp(lamps, Yd.s0 + (k + 0.5) * ((Yd.s1 - Yd.s0) / 5), V.road, 340, 1);
  return sceneOf(f, plates, labels, lamps, { status });
}

/**
 * Linie budowy stoczni: pochylnie promieniowo od lica hali w przestrzeń — łoże, burty z szynami, poprzeczki łoża,
 * linie stanowisk, głowica zasilania przy hali (FG), słupy końca linii ze światłami, światła odlotu za końcem.
 * Nad każdym stanowiskiem roboczym BRAMOWNICA-DRUKARKA (FG, grupa ruchoma): jedzie wzdłuż kadłuba za czołem budowy.
 * `rig.gantries`: [{ group, line, station }] — macierz grupy = przesunięcie wzdłuż osi linii (gospodarz co klatkę).
 */
export function buildYardLinesScene(layout, style) {
  const { f, plates, labels, lamps } = newScene();
  const gantries = [];
  let group = 0;
  for (const L of layout.yard.lines) {
    const rot = L.phi;                       // obrót brył: x lokalne = styczna (w poprzek linii), z lokalne = promień
    const hw = L.width / 2;
    const len = L.len;
    const big = L.cls === 'capital' || L.cls === 'carrier';
    const box = (along, across, y, sizeAcross, h, sizeAlong, mat) => {
      const p = L.at(along, across);
      f.box(p[0], y, p[1], sizeAcross, h, sizeAlong, mat, rot);
    };
    const lamp = (along, across, y, size, mat, gain = 1.2, mode = PB_FX.steady, phase = 0, param = 0) => {
      f.fx(gain, mode, phase, param);
      box(along, across, y, size, size * 0.5, size, mat);
      f.nofx();
    };
    const pipe = (a0, a1, across, y, r, mat) => {
      const p = L.at((a0 + a1) / 2, across);
      f.cyl(p[0], y, p[1], r, a1 - a0, mat, [0, Math.atan2(-L.rz, L.rx), Math.PI / 2]);
    };
    // łoże i burty z szynami bramownic
    // łoże jasne (stal): ciemny szkielet i podkład kadłuba w budowie odcinają się od niego
    pbPlate(plates, [L.at(0, -hw), L.at(len, -hw), L.at(len, hw), L.at(0, hw)], H.keel, H.floor - H.keel, M.steel);
    for (const side of [-1, 1]) {
      box(len / 2, side * (hw - 22), (H.keel + 150) / 2, 44, 150 - H.keel, len, M.dark);
      box(len / 2, side * (hw - 22), 154, 30, 8, len, M.rail);
      f.fx(1.05, PB_FX.steady);
      box(len / 2, side * (hw - 47), 70, 5, 5, len - 80, M.warm);
      f.nofx();
      pipe(60, len - 60, side * (hw + 12), 60, big ? 16 : 9, M.copper);
      // żebra burt i światła biegnące ku końcowi linii
      for (let a = L.pitch / 2; a < len; a += L.pitch / 2) box(a, side * (hw + 4), 40, 26, 300, 40, M.steel);
      const n = Math.max(3, Math.round(len / (big ? 620 : 420)));
      for (let i = 0; i <= n; i++) lamp((len * i) / n, side * (hw - 22), 164, 12, M.warm, 1.15, PB_FX.chase, i / (n + 1), 0.7);
    }
    // stanowiska: linie na łożu, poprzeczki łoża pod kadłubem, lampy stanowisk na burcie
    for (let k = 0; k < L.stations; k++) {
      const a0 = 30 + L.pitch * k;
      box(a0 + 8, 0, H.mark, L.width - 110, 2, 14, M.yellow);
      for (const t of [0.25, 0.5, 0.75]) box(a0 + L.pitch * t, 0, H.floor + 10, L.width - 120, 14, Math.max(18, L.pitch * 0.03), M.steel);
      lamp(a0 + L.pitch * 0.5, -(hw - 22), 172, big ? 26 : 16, k === L.stations - 1 ? M.green : M.white, 1.3);
    }
    // głowica zasilania przy hali (FG): belka nad korzeniem linii, słupy, listwa, napis linii
    f.set = 'fg';
    box(60, 0, H.over + 36, L.width + 150, 72, 130, M.steel);
    box(60, 0, H.over + 78, L.width + 90, 10, 90, M.pale);
    for (const side of [-1, 1]) box(60, side * (hw + 40), (150 + H.over) / 2, 70, H.over - 150, 130, M.steel);
    f.fx(1.1, PB_FX.steady);
    box(60, 0, H.over + 86, Math.min(L.width * 0.5, 500), 6, 18, M.cyan);
    f.nofx();
    const root = L.at(60, 0);
    pbLabel(labels, L.id, root[0], root[1], Math.min(L.width * 0.8, 520), big ? 110 : 70, style.labels.berthLead, '', L.phi, H.over + 92, 'fg');
    // koniec linii: słupy ze światłami (zielone — odbiór gotowego okrętu)
    for (const side of [-1, 1]) {
      box(len - 30, side * (hw - 22), 150 + 60, 40, 120, 40, M.steel);
      lamp(len - 30, side * (hw - 22), 150 + 126, big ? 26 : 18, side > 0 ? M.green : M.red, 1.8, PB_FX.blink, 0.3 * L.index, 0.6);
    }
    f.set = 'bg';
    // światła odlotu za końcem linii (pod płaszczyzną lotu): biegną w przestrzeń
    for (let k = 1; k <= 5; k++) {
      for (const side of [-1, 1]) lamp(len + k * Math.max(300, L.pitch * 0.4), side * hw, H.lane + 12, big ? 22 : 14, M.green, 1.4, PB_FX.chase, k / 6, 0.9);
    }
    // bramownice-drukarki: jedna na stanowisko robocze
    for (let k = 0; k < L.stations - 1; k++) {
      group++;
      f.group = group;
      f.set = 'fg';
      const a0 = L.stationAt(k);
      const first = k === 0;
      for (const side of [-1, 1]) box(a0, side * (hw + 4), (158 + H.over) / 2, 40, H.over - 158, big ? 110 : 60, M.yellow);
      box(a0, 0, H.over + 24, L.width + 60, 48, big ? 120 : 64, M.steel);
      box(a0, 0, H.over + 52, L.width + 30, 8, big ? 80 : 40, first ? M.orange : M.pale);
      box(a0, 0, H.over - 28, Math.min(L.width * 0.5, 320), 56, big ? 90 : 46, M.dark);
      // linia pracy na kadłubie pod bramownicą (tuż nad kadłubem w budowie): przy hali druk szkieletu — cyjan
      f.set = 'bg';
      f.fx(first ? 1.5 : 1.15, PB_FX.steady);
      box(a0, 0, 114, L.width - 130, 3, big ? 14 : 8, first ? M.cyan : M.warm);
      f.nofx();
      f.set = 'fg';
      lamp(a0, -L.width * 0.26, H.over - 4, big ? 20 : 12, M.white, 1.5, PB_FX.blink, pbHash1(group * 3.1), 7);
      lamp(a0, L.width * 0.26, H.over - 4, big ? 20 : 12, M.white, 1.5, PB_FX.blink, pbHash1(group * 5.3), 9);
      lamp(a0, 0, H.over + 62, big ? 18 : 12, first ? M.cyan : M.warm, 1.5, PB_FX.blink, pbHash1(group), 0.8);
      f.group = 0;
      f.set = 'bg';
      gantries.push({ group, line: L.index, station: k });
    }
    if (big) pushLamp(lamps, L.sc, L.v0 + len * 0.3, 340, 2);
  }
  return sceneOf(f, plates, labels, lamps, { gantries, groups: group });
}

// ---------------------------------------------------------------------------
// Otoczenie: ściana ringu (bryła zastępcza)

/** Pas ściany ringu (zastępczy — w grze prawdziwy ring): korpus, panele, zabudowa korony, światła. */
export function buildBandScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const top = H.deck + 60;
  for (const b of layout.band) {
    T.sec(b.s0, b.s1, b.v0, b.v1, -420, top + 420, M.dark);
    const k = Math.floor(pbHash1(b.s0 * 0.07 + 3.3) * 4);
    T.sec(b.s0 + 8, b.s1 - 8, b.v0 + 10, b.v1 - 130, top, 6, k === 0 ? M.rail : M.steel);
    T.sec(b.s0, b.s1, b.v1 - 120, b.v1, top, 14, M.steel);
    const sc = (b.s0 + b.s1) / 2;
    const w = b.s1 - b.s0;
    const h1 = pbHash1(b.s0 * 0.031 + 1.1);
    const h2 = pbHash1(b.s0 * 0.031 + 7.7);
    // zabudowa korony ściany: bloki z oknami
    const nb = 1 + Math.floor(h1 * 3);
    for (let i = 0; i < nb; i++) {
      const hh = 40 + 150 * pbHash1(b.s0 * 0.011 + i * 3.1);
      const s = b.s0 + w * (0.2 + 0.3 * i);
      const v = b.v0 + 260 + 700 * pbHash1(b.s0 * 0.017 + i * 5.3);
      const bw = 200 + 120 * h2;
      T.box(s, v, top + 6 + hh / 2, bw, hh, 260, i % 2 ? M.steel : M.rail);
      T.box(s, v, top + 8 + hh, bw * 0.86, 6, 220, M.pale);
      f.fx(0.95, PB_FX.steady);
      T.box(s, v + 131, top + 6 + hh * 0.6, bw * 0.8, 9, 4, i % 2 ? M.warm : M.white);
      T.box(s, v - 131, top + 6 + hh * 0.6, bw * 0.8, 9, 4, M.warm);
      f.nofx();
    }
    // tor kolei przy krawędzi (światła) i krawężnik
    T.box(sc, b.v1 - 260, top + 9, w * 1.02, 6, 26, M.rail);
    for (const t of [0.25, 0.75]) T.lamp(b.s0 + w * t, b.v1 - 260, top + 15, 14, M.white, 1.05);
    T.run(b.s0, b.s1, b.v1 - 9, top + 22, 16, 16, M.rail, 500);
    if (h2 > 0.6) T.lamp(sc, b.v1 - 60, top + 28, 18, M.red, 1.6, PB_FX.blink, h1, 0.4);
    // poza kompleksem lico ściany jest odsłonięte: listwa i żebra
    if (sc < layout.sMin || sc > layout.sMax) {
      f.fx(1.05, PB_FX.steady);
      T.run(b.s0 + 20, b.s1 - 20, b.v1 + 3, H.wallLight, 5, 6, M.warm, 500, 1.0);
      f.nofx();
      T.box(b.s0, b.v1 + 12, 60, 60, 420, 26, M.steel);
    }
  }
  void style;
  return sceneOf(f, plates, labels, lamps);
}
