// DWORZEC PROMÓW — bryły budowli „Postój i przejścia z ringu” (dane PortRecorder).
//
// Ludzie mieszkają w ringu (habitat), więc pasażerowie dworca przychodzą Z WNĘTRZA RINGU. Rząd przy ringu pokazuje tę
// drogę: w ścianie ringu ŚLUZA HABITATU (portal z lampami), za nią HALA DOJŚCIA (szklana nawa do lica drogi), przy
// licu WINDY NA PERON kolei pasażerskiej (peron na kratownicy pod drogą rysuje gospodarz), a nad drogą przeszklona
// KŁADKA PASAŻERSKA do pirsu dworca (zestaw FG, spód na wysokości bramownic — statki przelatują pod nią; podpory
// stoją na rzędach po obu stronach drogi). Między przejściami POSTÓJ PROMÓW czekających na kurs, na końcach zaplecze
// zaopatrzenia. Składy kolei pasażerskiej to grupy ruchome tej budowli.
import { PB_FX, PB_MAT, YARD_H, newScene, pitDetail, pushLamp, sceneOf } from '../kit/sceny.js';
import { RING_V, ringScale, yardPoint } from '../kit/uklad.js';
import { GAIN, annex, bodiesSteel, faceWindows, gallery, hash } from './bryly.js';
import { DW } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;
const V = RING_V;

/** Przejście z ringu: śluza w ścianie ringu, hala dojścia, hale boczne, windy na peron. */
function gate(T, f, g, style, deck) {
  const s = g.s;
  const sw = ringScale(450);
  const S = (d) => d / sw;
  // --- śluza habitatu: portal przy ścianie ringu (wyższy od korony ściany), brama ze szkła i światła
  for (const side of [-1, 1]) T.box(s + S(side * 262), 50, deck + 190, 76, 380, 100, M.steel);
  T.box(s, 50, deck + 350, 600, 60, 104, M.steel);
  T.box(s, 50, deck + 384, 560, 8, 84, M.rail);
  T.box(s, 22, deck + 160, 448, 320, 14, M.glass);
  f.fx(GAIN.warm + 0.2, PB_FX.steady);
  T.box(s, 31, deck + 312, 452, 12, 8, M.warm);
  for (const side of [-1, 1]) T.box(s + S(side * 224), 31, deck + 160, 9, 300, 8, M.warm);
  f.nofx();
  f.fx(GAIN.cold + 0.35, PB_FX.steady);
  T.box(s, 96, deck + 388, 520, 6, 8, M.cyan);
  T.box(s, 4, deck + 388, 520, 6, 8, M.cyan);
  f.nofx();
  for (const side of [-1, 1]) T.lamp(s + S(side * 262), 50, deck + 388, 16, M.red, 1.5, PB_FX.blink, hash(s + side), 0.5);
  T.label('ŚLUZA HABITATU', s, 50, 500, 70, style.labels.gate, 'PRZEJŚCIE Z RINGU NA DWORZEC', deck + 390, 'fg');

  // --- hala dojścia: szklana nawa od śluzy do lica drogi; posadzka z pasami światła i światłami biegnącymi ku drodze
  gallery(f, yardPoint(s, 104), yardPoint(s, 850), 400, deck, { eave: 150, ridge: 410, bay: 124, profile: 'arch', open: 3, green: false, seed: 400 + g.side });
  f.fx(GAIN.warm * 0.9, PB_FX.steady);
  for (const side of [-1, 1]) T.box(s + S(side * 110), 477, deck + 5, 26, 5, 720, M.warm);
  f.nofx();
  for (let k = 0; k < 10; k++) T.lamp(s, 150 + k * 72, deck + 8, 16, M.white, 0.85, PB_FX.chase, k / 10, 0.9);
  // szczyt hali od drogi: portal z okapem na słupach
  T.box(s, 872, deck + 110, 430, 220, 30, M.steel);
  T.box(s, 884, deck + 100, 300, 170, 10, M.glass);
  f.fx(GAIN.warm + 0.1, PB_FX.steady);
  T.box(s, 890, deck + 200, 330, 12, 8, M.warm);
  f.nofx();

  // --- hale boczne (kontrola, kasy, poczekalnie): korpus z pasem okien i świetlikami
  for (const side of [-1, 1]) annex(T, f, s + S(side * 325), 470, 200, 640, 170, 410 + g.side * 3 + side, deck);

  // --- windy na peron kolei (nad szybami wind gospodarza przy licu): trzon ze szkłem, żółty dach, lampa
  for (const side of [-1, 1]) {
    const ls = s + (side * 270) / ringScale(V.inner1);
    T.box(ls, 928, deck + 80, 130, 160, 96, M.steel);
    T.box(ls, 928, deck + 86, 138, 90, 70, M.glass);
    T.box(ls, 928, deck + 164, 140, 8, 104, M.yellow);
    f.fx(GAIN.cold + 0.3, PB_FX.steady);
    T.box(ls, 978, deck + 40, 110, 8, 6, M.cyan);
    f.nofx();
    T.lamp(ls, 928, deck + 172, 14, M.green, 1.0, PB_FX.blink, side > 0 ? 0.5 : 0, 0.7);
  }
}

/**
 * Kładka pasażerska nad drogą (FG): dźwigar, przeszklony tunel, żebra, pasy ciepłego światła po bokach, światła
 * biegnące ku dworcowi, od spodu listwy pasów ruchu jak na bramownicach; podpory na rzędach po obu stronach drogi.
 */
function bridge(T, f, g, deck) {
  const B = g.bridge;
  const s = B.s;
  const y = H.over;
  const w = B.half * 2;
  const vm = (B.v0 + B.v1) / 2;
  const len = B.v1 - B.v0;
  T.box(s, vm, y + 24, w, 48, len, M.steel);
  T.box(s, vm, y + 92, w - 44, 88, len - 30, M.glass);
  T.box(s, vm, y + 140, 14, 8, len - 30, M.rail);
  f.fx(GAIN.warm + 0.05, PB_FX.steady);
  T.box(s, vm, y + 54, w + 8, 10, len - 60, M.warm);
  f.nofx();
  const n = Math.round(len / 165);
  for (let i = 0; i <= n; i++) T.box(s, B.v0 + (len * i) / n, y + 88, w + 16, 130, 14, M.rail);
  const m = 14;
  for (let k = 0; k < m; k++) T.lamp(s, B.v0 + 110 + ((len - 220) * k) / (m - 1), y + 148, 16, M.white, 0.85, PB_FX.chase, k / m, 0.8);
  // listwy na krawędziach nad pasami ruchu (pas przy ringu ku −s zielony, pas od przestrzeni ku +s bursztynowy)
  f.fx(1.0, PB_FX.steady);
  T.box(s, V.road - V.laneOff, y + 62, w + 14, 8, 420, M.green);
  T.box(s, V.road + V.laneOff, y + 62, w + 14, 8, 420, M.warm);
  f.nofx();
  T.lamp(s, vm, y + 156, 20, M.red, 1.7, PB_FX.blink, hash(s), 0.5);
  // podpory: trzony na rzędach (od pokładu do dźwigara) z pasem szkła — klatki schodów i wind
  for (const v of [B.v0 + 50, B.v1 - 50]) {
    T.box(s, v, (deck + y) / 2, w + 36, y - deck, 104, M.steel);
    T.box(s, v, (deck + y) / 2 + 10, w + 42, (y - deck) * 0.5, 70, M.glass);
  }
}

/** Liczba składów kolei pasażerskiej (grupy ruchome 1…n budowli). */
export const TRAINS = 4;
export const TRAIN_CARS = 5;
const CAR = Object.freeze({ len: 150, gap: 14, wid: 104, h: 56 });

/** Skład pasażerski nagrany w s = 0 na torze `v` (grupa ruchoma — jedzie obrotem wokół środka ringu). */
function train(f, group, v, dir) {
  f.group = group;
  const yC = H.spineTop + 30 + CAR.h / 2;
  const total = TRAIN_CARS * CAR.len + (TRAIN_CARS - 1) * CAR.gap;
  for (let i = 0; i < TRAIN_CARS; i++) {
    const x = -total / 2 + CAR.len / 2 + i * (CAR.len + CAR.gap);
    f.box(x, yC, v, CAR.len, CAR.h, CAR.wid, M.pale, 0);
    f.box(x, yC + CAR.h / 2 + 3, v, CAR.len - 16, 6, CAR.wid * 0.56, M.rail, 0);
    f.fx(GAIN.warm + 0.15, PB_FX.steady);
    f.box(x, yC + 6, v, CAR.len - 26, 16, CAR.wid + 5, M.warm, 0);
    f.box(x - CAR.len * 0.25, yC + CAR.h / 2 + 7, v, 22, 4, 22, M.warm, 0);
    f.box(x + CAR.len * 0.25, yC + CAR.h / 2 + 7, v, 22, 4, 22, M.warm, 0);
    f.nofx();
    f.box(x, yC - 12, v, CAR.len - 8, 8, CAR.wid + 6, M.teal, 0);
    if (i < TRAIN_CARS - 1) f.box(x + CAR.len / 2 + CAR.gap / 2, yC, v, CAR.gap + 4, CAR.h * 0.8, CAR.wid * 0.7, M.dark, 0);
  }
  // czoło i koniec składu: reflektor i światło końca
  const head = (dir * total) / 2;
  f.fx(1.1, PB_FX.steady);
  f.box(head + dir * 3, yC - 4, v, 6, 14, 60, M.white, 0);
  f.nofx();
  f.fx(0.9, PB_FX.steady);
  f.box(-head - dir * 3, yC - 4, v, 6, 12, 60, M.red, 0);
  f.nofx();
  f.group = 0;
}

export function buildRingRowScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const status = [];
  bodiesSteel(T, f, layout, ['PR', 'PP'], { strip: M.cyan });
  // postój promów: wnęki z lampami stanu
  for (const pit of layout.pits) {
    if (pit.zone !== 'PP') continue;
    const ch = status.length;
    status.push({ ch, berthId: pit.berth.id });
    pitDetail(T, f, pit, { statusCh: ch });
  }
  // okna w licu od drogi: przejścia i zaplecze
  for (const g of layout.gates) faceWindows(T, f, g.s0 + 30, g.s1 - 30, V.inner1, 1, g.s * 0.017 + 9, [150, 205]);
  for (const [a, b] of [[-DW.sHalf + 30, -DW.gateS - DW.gateHalf - 30], [DW.gateS + DW.gateHalf + 30, DW.sHalf - 30]]) faceWindows(T, f, a, b, V.inner1, 1, a * 0.019, [150, 205]);

  f.set = 'fg';
  const deck = H.deck + 6;

  // --- postój: obsługa promów za wnękami, budki na zębach między wnękami
  const pp = layout.pits.filter((p) => p.zone === 'PP');
  for (const pit of pp) {
    const w = (pit.s1 - pit.s0) * ringScale(pit.v0 / 2);
    if (pit.cls === 'm') annex(T, f, pit.sc, pit.v0 / 2, w * 0.9, pit.v0 * 0.7, 150, pit.sc * 0.01 + 5, deck);
    if (pit.cls === 's') {
      // dyspozytornia: niski blok ze szklanym pasem i masztem
      T.box(pit.sc, 330, deck + 60, w * 0.84, 120, 520, M.steel);
      T.box(pit.sc, 330, deck + 80, w * 0.84 + 8, 30, 528, M.glass);
      T.box(pit.sc, 330, deck + 124, w * 0.8, 8, 500, M.rail);
      f.fx(GAIN.cold + 0.2, PB_FX.steady);
      T.box(pit.sc, 596, deck + 50, w * 0.8, 6, 5, M.cyan);
      f.nofx();
      T.cyl(pit.sc, 160, deck + 190, 5, 130, M.rail);
      T.lamp(pit.sc, 160, deck + 258, 12, M.red, 1.5, PB_FX.blink, hash(pit.sc), 0.5);
    }
  }
  const mid = pp[Math.floor(pp.length / 2)];
  T.label('POSTÓJ PROMÓW', mid.sc, mid.v0 / 2, 380, 70, style.labels.terminal, 'PROMY CZEKAJĄCE NA KURS', deck + 172, 'fg');
  for (let i = 0; i + 1 < pp.length; i++) {
    const sc = (pp[i].s1 + pp[i + 1].s0) / 2;
    const back = Math.max(pp[i].v0, pp[i + 1].v0);
    T.box(sc, (back + 960) / 2, deck + 20, 76, 40, Math.max(60, 960 - back - 80), M.steel);
    f.fx(GAIN.warm, PB_FX.steady);
    T.box(sc, (back + 960) / 2, deck + 20, 80, 10, Math.max(50, 960 - back - 110), M.warm);
    f.nofx();
  }

  // --- przejścia z ringu i kładki nad drogą
  for (const g of layout.gates) {
    gate(T, f, g, style, deck);
    bridge(T, f, g, deck);
  }

  // --- zaplecze na końcach rzędu: magazyn zaopatrzenia, zbiorniki tlenu, radiatory
  for (const side of [-1, 1]) {
    const sc = side * (DW.gateS + DW.gateHalf + DW.sHalf) / 2;
    const sw = ringScale(500);
    annex(T, f, sc, 620, 500, 520, 210, 440 + side, deck);
    for (const dv of [150, 300]) {
      T.box(sc, dv, deck + 10, 520, 20, 110, M.rail);
      T.pipe(sc - 230 / sw, dv, sc + 230 / sw, dv, deck + 70, 52, M.steel);
      for (const ds of [-140, 140]) T.box(sc + ds / sw, dv, deck + 70, 16, 110, 110, M.yellow);
    }
    T.pipe(sc - 270 / sw, 110, sc - 270 / sw, 420, deck + 26, 10, M.copper);
    T.label(side < 0 ? 'ZAOPATRZENIE' : 'ZAOPATRZENIE', sc, 905, 300, 50, style.labels.clear, 'TLEN · POLIMER', deck + 4, 'fg');
  }
  f.set = 'bg';

  // --- kolej pasażerska: składy na torach po obu stronach osi kratownicy (ruch prawostronny)
  const trains = [];
  for (let i = 0; i < TRAINS; i++) {
    const dir = i % 2 ? -1 : 1;
    const v = V.road + dir * 100;
    train(f, i + 1, v, dir);
    trains.push({ group: i + 1, dir, v, phase: Math.floor(i / 2) * 0.5 + (dir < 0 ? 0.23 : 0) });
  }

  pushLamp(lamps, 0, 500, 420, 2);
  pushLamp(lamps, -1250, 500, 420, 2);
  pushLamp(lamps, 1250, 500, 420, 2);
  for (const g of layout.gates) {
    pushLamp(lamps, g.s, 480, 560, 1);
    pushLamp(lamps, g.s, V.road, 700, 1);
  }
  pushLamp(lamps, 0, V.road, 500, 2);
  return sceneOf(f, plates, labels, lamps, { status, trains });
}
