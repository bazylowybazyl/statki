// DZIELNICA „FABRYKI” — BRYŁY (dane instancji zestawu budowli portowych, bez three).
//
// Trzy budowle: (1) walcownia i prasownia z placem płyt + rząd przy ringu (składy wsadu), (2) zakład napędów z molem
// hamowni (stanowiska prób, płomienie, suwnica), (3) reaktory i emitery tarcz z pasem MEGA importu + awionika.
// Wierzchy brył stalowe i z szyn (bez jasnych płyt), place odkładcze z jasną podłogą, listwy krótkie.
// Grupy ruchome (gospodarz ustawia macierze co klatkę — index.js): suwnice (brama, wózek, ładunek), płomienie
// hamowni (bryła jednostkowa wzdłuż +x: macierz = przesunięcie do dyszy · obrót · skala długości i szerokości).
// Kanały stanu: doki (rig.status — gospodarz), stanowiska prób, próby pola warp, reaktora i emitera.
import {
  PB_FX, PB_MAT, PB_MAX_GROUPS, YARD_H, greebles, megaDetail, newScene, pbHash1, pitDetail, pushLamp, sceneOf,
  spire, controlBlock, xzTools
} from '../kit/sceny.js';
import { RING_V, ringScale, yardPhi, yardPoint } from '../kit/uklad.js';
import { k7HeightToZ } from '../kit/sceny.js';

const M = PB_MAT;
const H = YARD_H;
const ROOF = H.deck + 110;          // dach hal podniesionych nad wierzch rzędu
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];

/** Licznik grup ruchomych i kanałów jednej budowli. */
function rigOf(name) {
  let g = 0;
  let ch = 0;
  const rig = { status: [], gantries: [], flames: [], chans: {} };
  return {
    rig,
    group() {
      g++;
      if (g >= PB_MAX_GROUPS) throw new Error(`${name}: za dużo grup ruchomych (${g})`);
      return g;
    },
    chan(key) {
      if (ch >= 16) throw new Error(`${name}: za dużo kanałów stanu`);
      if (key) rig.chans[key] = ch;
      return ch++;
    },
    get groups() { return g; }
  };
}

/** Korpusy kawałków stref: blok, wierzch ze stali albo szyn, nadbudówki (opcjonalnie), lico od drogi z listwą. */
function slabs(T, f, layout, zones, { greeble = true, strip = M.warm } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.deck - H.keel, M.dark);
    const top = pbHash1(Math.round(p.s0 * 0.61 + p.v0 * 0.17) + 2.2) < 0.7 ? M.steel : M.rail;
    const d = 9 / ringScale(p.v0);
    T.sec(p.s0 + d, p.s1 - d, p.v0 + 9, p.v1 - 9, H.deck, 6, top);
    if (greeble && p.orient === 'arc') greebles(T, f, p);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      T.run(p.s0, p.s1, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
      // listwa krótka (nie na całej długości): odcinki po 60% kawałka
      const m = (p.s0 + p.s1) / 2;
      const h = (p.s1 - p.s0) * 0.3;
      f.fx(0.9, PB_FX.steady);
      T.box(m, v + sign * 3, H.wallLight, Math.max(10, h * 2 * ringScale(v)), 5, 6, strip);
      f.nofx();
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
    }
  }
}

/** Dok z lampą stanu na kanale (gospodarz zapala ją wg zajętości) i numerem na pokładzie za ścianą tylną. */
function docks(T, f, R, layout, zones, style) {
  for (const pit of layout.pits) {
    if (!zones.includes(pit.zone)) continue;
    const ch = R.chan();
    R.rig.status.push({ ch, berthId: pit.berth.id });
    pitDetail(T, f, pit, { statusCh: ch });
    const back = pit.open > 0 ? pit.v0 : pit.v1;
    const lv = pit.open > 0 ? back - 80 : back + 66;
    T.label(pit.id, pit.sc, lv, Math.min(pit.w * 0.8, 300), 70, style.labels.berthLead, '', H.deck + 9);
  }
}

/** Hala podniesiona: korpus nad wierzchem rzędu, dach ze stali z szedami (pasy szkła), krawężnik z szyn. */
function hall(T, f, s0, s1, v0, v1, { top = ROOF, teeth = 300, roofMat = M.steel, rib = M.rail, glass = true } = {}) {
  T.sec(s0, s1, v0, v1, H.deck, top - H.deck, M.steel);
  const d = 14 / ringScale(v0);
  T.sec(s0 + d, s1 - d, v0 + 14, v1 - 14, top, 5, roofMat);
  T.run(s0, s1, v0 + 8, top + 8, 12, 14, rib, 600);
  T.run(s0, s1, v1 - 8, top + 8, 12, 14, rib, 600);
  for (const s of [s0, s1]) T.box(s + (s === s0 ? d : -d) * 0.6, (v0 + v1) / 2, top + 8, 14, 12, v1 - v0, rib);
  const span = (s1 - s0) * ringScale(v0);
  const n = Math.max(2, Math.round(span / teeth));
  for (let k = 1; k < n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    T.box(s, (v0 + v1) / 2, top + 16, 26, 22, v1 - v0 - 90, rib);
    if (glass) T.box(s + 18 / ringScale(v0), (v0 + v1) / 2, top + 12, 14, 12, v1 - v0 - 120, M.glass);
  }
}

/** Komin / wentylator na dachu. */
function stack(T, s, v, y, r, h) {
  T.cyl(s, v, y + h / 2, r, h, M.steel);
  T.cyl(s, v, y + h + 6, r + 6, 12, M.rail);
}

/** Rurociąg wzdłuż łuku na wsporniku (na wierzchu brył). */
function pipeline(T, s0, s1, v, y = H.deck + 34) {
  T.pipeRun(s0, s1, v, y, 18, M.copper, 520);
  T.pipeRun(s0, s1, v + 46, y - 6, 12, M.steel, 520);
  const n = Math.max(2, Math.round(((s1 - s0) * ringScale(v)) / 700));
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    T.box(s, v + 22, (H.deck + y) / 2 + 2, 26, y - H.deck, 110, M.rail);
  }
}

// ---------------------------------------------------------------------------
// Towary na placach (narzędzia xz: punkt, kierunek osi `dir`)

/** Silnik leżący na kołysce: oś wzdłuż `dir` (dysza ku +dir), `y0` — wierzch podłoża. */
export function engineModel(Q, f, p, dir, kind, y0 = H.deck + 8) {
  const K = ENGINES[kind] || ENGINES.drive_light;
  const r = K.r;
  const yE = y0 + r + 14;
  const back = add(p, dir, -K.len / 2);
  const nozA = add(p, dir, K.len / 2 - K.noz);
  Q.pipe(back, nozA, yE, r, K.body);
  Q.pipe(add(back, dir, -10), add(back, dir, 16), yE, r * 0.84, M.rail);
  for (let i = 0; i < K.rings; i++) {
    const c = add(back, dir, (K.len - K.noz) * (0.25 + (0.5 * i) / Math.max(1, K.rings - 1)));
    Q.pipe(add(c, dir, -K.ringW / 2), add(c, dir, K.ringW / 2), yE, r + K.ringR, K.ringMat);
  }
  const nc = add(p, dir, K.len / 2 - K.noz / 2);
  f.cone(nc[0], yE, nc[1], r * 0.92, K.noz, M.rail, [-dir[0], 0, -dir[1]]);
  for (const k of [-0.28, 0.22]) Q.box(add(p, dir, K.len * k), y0 + (r + 14) / 2, 34, r + 14, r * 2 + 24, M.yellow, dir[0], dir[1]);
  return yE;
}
const ENGINES = {
  thruster: { len: 220, r: 46, noz: 60, rings: 1, ringW: 20, ringR: 6, ringMat: M.copper, body: M.steel },
  drive_light: { len: 300, r: 66, noz: 80, rings: 2, ringW: 22, ringR: 8, ringMat: M.copper, body: M.steel },
  drive_heavy: { len: 420, r: 92, noz: 110, rings: 2, ringW: 30, ringR: 10, ringMat: M.orange, body: M.steel },
  hypercruise_mk2: { len: 380, r: 86, noz: 90, rings: 4, ringW: 22, ringR: 12, ringMat: M.copper, body: M.steel },
  warp_mk2: { len: 520, r: 118, noz: 70, rings: 3, ringW: 40, ringR: 26, ringMat: M.teal, body: M.steel }
};
export const FAB_ENGINES = ENGINES;

/** Towar na placu (rodzaj z ekonomii). `dir` — oś placu (jazda suwnicy), `x` — w poprzek. */
function goodsModel(Q, f, slot, p, dir, x, seed) {
  const y0 = H.deck + 8;
  const h = pbHash1(seed);
  switch (slot.kind) {
    case 'hull_plate': {
      // stos płyt: warstwy na przekładkach, opaski
      const n = 3 + Math.floor(h * 4);
      Q.box(p, y0 + 4, 290, 8, 190, M.rail, dir[0], dir[1]);
      Q.box(p, y0 + 8 + n * 7, 280, n * 14, 180, h < 0.45 ? M.orange : h < 0.8 ? M.teal : M.steel, dir[0], dir[1]);
      for (const k of [-0.3, 0.3]) Q.box(add(p, dir, 280 * k), y0 + 10 + n * 7, 12, n * 14 + 4, 184, M.yellow, dir[0], dir[1]);
      return;
    }
    case 'weapon_mount': {
      Q.box(p, y0 + 6, 170, 12, 170, M.rail, dir[0], dir[1]);
      Q.cyl(p, y0 + 30, 70, 36, M.steel);
      Q.cyl(p, y0 + 52, 48, 10, h < 0.5 ? M.orange : M.yellow);
      Q.box(add(p, x, 30), y0 + 40, 60, 20, 40, M.steel, dir[0], dir[1]);
      return;
    }
    case 'reactor_core': {
      Q.box(p, y0 + 6, 210, 12, 210, M.rail, dir[0], dir[1]);
      Q.cyl(p, y0 + 90, 80, 160, M.steel);
      Q.cyl(p, y0 + 70, 84, 20, M.yellow);
      Q.cyl(p, y0 + 176, 60, 14, M.teal);
      for (const k of [-1, 1]) Q.box(add(p, x, k * 92), y0 + 40, 30, 70, 24, M.orange, dir[0], dir[1]);
      return;
    }
    case 'avionics': {
      // skrzynie z awioniką na palecie
      Q.box(p, y0 + 5, 170, 10, 130, M.rail, dir[0], dir[1]);
      for (const [da, dx] of [[-40, -30], [40, -30], [0, 34]]) Q.box(add(add(p, dir, da), x, dx), y0 + 34, 70, 48, 54, h < 0.5 ? M.teal : M.orange, dir[0], dir[1]);
      return;
    }
    case 'life_support': {
      Q.box(p, y0 + 5, 170, 10, 140, M.rail, dir[0], dir[1]);
      Q.box(p, y0 + 46, 150, 72, 110, M.steel, dir[0], dir[1]);
      for (const k of [-1, 1]) Q.cyl(add(p, dir, k * 46), y0 + 96, 20, 30, k > 0 ? M.teal : M.steel);
      Q.box(add(p, x, -58), y0 + 50, 90, 16, 6, M.green, dir[0], dir[1]);
      return;
    }
    default: {
      // silnik na placu napędów: leży w poprzek osi placu (dysza ku +x)
      engineModel(Q, f, p, x, slot.kind, y0);
      Q.box(p, y0 - 2, (ENGINES[slot.kind]?.len || 300) + 60, 6, (ENGINES[slot.kind]?.r || 70) * 2 + 60, M.floor, x[0], x[1]);
    }
  }
}

/**
 * Plac odkładczy pod suwnicą bramową: jasna podłoga, tory jazdy, towary, suwnice (grupy ruchome: brama, wózek,
 * ładunek). Wynik: rekordy suwnic w `R.rig.gantries`.
 */
function yardScene(T, Q, f, R, yard, style, { gantryH = 330, labelAt = null } = {}) {
  const ax = yard.axis;
  const cx = yard.cross;
  const at = yard.frame.at;
  const hs = yard.span / 2;
  const y0 = H.deck;
  const pier = yard.kind === 'pier';
  // plac na łuku: miejsca po łuku (a — długość na promieniu środka placu), suwnice jeżdżą obrotem wokół środka ringu
  const k = pier ? 1 : ringScale(yard.vc);
  const arcAt = (a, c) => yardPoint(yard.sc + a / k, yard.vc + c);
  const arcDir = (a) => { const p = yardPhi(yard.sc + a / k); return [Math.cos(p), -Math.sin(p)]; };
  // podłoga (jasna, pod ciemnymi towarami), tory suwnic i pasy ostrzegawcze przy torach
  if (pier) {
    Q.plate([at(250, -hs + 40), at(2760, -hs + 40), at(2760, hs - 40), at(250, hs - 40)], y0, 4, M.floor);
    for (const side of [-1, 1]) {
      Q.seg(at(yard.a0 - 140, side * hs), at(3720, side * hs), y0 + 10, 12, 30, M.rail);
      Q.seg(at(yard.a0 - 140, side * (hs - 28)), at(3720, side * (hs - 28)), y0 + 7, 4, 10, M.yellow);
      for (const a of [yard.a0 - 140, 3720]) Q.box(at(a, side * hs), y0 + 22, 30, 36, 50, M.orange, ax[0], ax[1]);
    }
  } else {
    const sA = yard.sc + (yard.a0 - 100) / k;
    const sB = yard.sc + (yard.a1 + 100) / k;
    T.sec(sA, sB, yard.vc - hs + 40, yard.vc + hs - 40, y0, 4, M.floor);
    const rA = yard.sc + (yard.a0 - 140) / k;
    const rB = yard.sc + (yard.a1 + 140) / k;
    for (const side of [-1, 1]) {
      T.run(rA, rB, yard.vc + side * hs, y0 + 10, 12, 30, M.rail, 420);
      T.run(rA, rB, yard.vc + side * (hs - 28), y0 + 7, 4, 10, M.yellow, 420);
      for (const s of [rA, rB]) T.box(s, yard.vc + side * hs, y0 + 22, 30, 36, 50, M.orange);
    }
  }
  // towary
  for (const sl of yard.slots) {
    const p = pier ? at(sl.a, sl.c) : arcAt(sl.a, sl.c);
    const dir = pier ? ax : arcDir(sl.a);
    goodsModel(Q, f, sl, p, dir, pier ? cx : [-dir[1], dir[0]], sl.a * 0.013 + sl.c * 0.031);
  }
  // pole przekazania (odbiór z hali / wysyłka)
  if (pier) Q.box(at(yard.handoff.a, 0), y0 + 6, 300, 6, 600, M.yellow, ax[0], ax[1]);
  else {
    T.run(yard.sc + yard.a0 / k, yard.sc + yard.a1 / k, yard.vc + yard.handoff.c - 70, y0 + 6, 3, 10, M.yellow, 420);
    T.run(yard.sc + yard.a0 / k, yard.sc + yard.a1 / k, yard.vc + yard.handoff.c + 70, y0 + 6, 3, 10, M.yellow, 420);
  }
  if (labelAt) Q.label(yard.label, labelAt.p, labelAt.w, 110, style.labels.clear, labelAt.small || '', y0 + 9, 'bg', labelAt.dir[0], labelAt.dir[1]);

  // suwnice: brama (nogi na torach, dźwigar w poprzek), wózek z liną i zblocze, ładunek
  const big = yard.kind === 'pier';
  const gh = gantryH;
  for (let gi = 0; gi < yard.gantries; gi++) {
    const gG = R.group();
    f.group = gG;
    f.set = 'fg';
    const leg = big ? 70 : 46;
    for (const side of [-1, 1]) {
      for (const a of [-1, 1]) Q.box(at(a * (big ? 120 : 80), side * hs), y0 + gh / 2 + 10, leg, gh, leg, M.yellow, ax[0], ax[1]);
      Q.box(at(0, side * hs), y0 + 30, big ? 330 : 230, 30, 60, M.steel, ax[0], ax[1]);
      Q.beam(at(-(big ? 120 : 80), side * hs), y0 + 40, at(big ? 120 : 80, side * hs), y0 + gh - 20, 14, M.yellow);
    }
    for (const a of [-1, 1]) Q.seg(at(a * (big ? 70 : 46), -hs - 30), at(a * (big ? 70 : 46), hs + 30), y0 + gh + 18, big ? 50 : 36, big ? 40 : 30, M.yellow);
    Q.seg(at(0, -hs + 40), at(0, hs - 40), y0 + gh + 46, 6, big ? 60 : 40, M.rail);
    Q.box(at(0, hs - 60), y0 + gh - 24, big ? 110 : 80, 50, 90, M.glass, ax[0], ax[1]);
    Q.box(at(0, hs - 60), y0 + gh + 8, big ? 120 : 90, 14, 100, M.steel, ax[0], ax[1]);
    Q.lamp(at(0, -hs), y0 + gh + 52, 16, M.red, 1.6, PB_FX.blink, pbHash1(gG * 1.7), 0.5);
    const gT = R.group();
    f.group = gT;
    const hookY = big ? y0 + 300 : y0 + 220;
    Q.box(at(0, 0), y0 + gh + 50, big ? 150 : 110, 36, big ? 130 : 100, M.dark, ax[0], ax[1]);
    Q.box(at(0, 0), y0 + gh + 72, big ? 110 : 80, 8, big ? 90 : 70, M.orange, ax[0], ax[1]);
    for (const k of [-1, 1]) Q.box(at(k * 18, 0), (hookY + y0 + gh + 30) / 2, 5, y0 + gh + 30 - hookY, 5, M.rail, ax[0], ax[1]);
    Q.box(at(0, 0), hookY, 60, 26, 70, M.yellow, ax[0], ax[1]);
    Q.lamp(at(0, 0), y0 + gh + 80, 10, M.white, 1.3, PB_FX.blink, 0.3, 1.2);
    const gL = R.group();
    f.group = gL;
    if (big) engineModel(Q, f, at(0, 0), ax, 'drive_heavy', hookY - 230);
    else if (yard.id === 'A') {
      Q.box(at(0, 0), hookY - 50, 220, 60, 140, M.steel, ax[0], ax[1]);
      for (const k of [-0.3, 0.3]) Q.box(at(220 * k, 0), hookY - 50, 10, 64, 144, M.yellow, ax[0], ax[1]);
    } else if (yard.id === 'C') {
      Q.cyl(at(0, 0), hookY - 100, 80, 160, M.steel);
      Q.cyl(at(0, 0), hookY - 110, 84, 20, M.yellow);
    } else {
      Q.box(at(0, 0), hookY - 50, 150, 70, 110, M.teal, ax[0], ax[1]);
    }
    f.group = 0;
    f.set = 'bg';
    R.rig.gantries.push({ yard: yard.id, index: gi, gG, gT, gL, arc: !pier, sc: yard.sc ?? 0, vc: yard.vc ?? 0, k });
  }
}

/**
 * Płomień jednostkowy (grupa ruchoma): od dyszy (x = 0) do x = 1 wzdłuż +x, szerokość jednostkowa w z.
 * Wysokość osi `yN`, wysokość płomienia `hN` (wysokości K-7 nie skalują się z macierzą grupy).
 */
function flameUnit(f, yN, hN, color) {
  const outer = color === 'warm' ? M.warm : M.cyan;
  const core = color === 'warm' ? M.white : M.white;
  const n = 12;
  for (let k = 0; k < n; k++) {
    const x = (k + 0.5) / n;
    const t = k / (n - 1);
    // płaszcz: szeroki przy dyszy, zwęża się i gaśnie ku końcowi
    f.fx(0.95 - 0.75 * t, PB_FX.steady);
    f.box(x, yN, 0, 1.04 / n, hN * (1 - 0.7 * t), 1 - 0.78 * t, outer, 0);
    f.nofx();
    if (k < 7) {
      f.fx(1.5 - 0.17 * k, PB_FX.chase, k / 7, 2.6);
      f.box(x * 0.85, yN, 0, 0.85 / n, hN * 0.4 * (1 - 0.12 * k), 0.3 * (1 - 0.12 * k), core, 0);
      f.nofx();
    }
  }
  // tarcze uderzeniowe („diamenty”) i jasny wylot
  for (const x of [0.09, 0.2, 0.31]) {
    f.fx(1.4, PB_FX.chase, x, 5.0);
    f.box(x, yN, 0, 0.018, hN * 0.5, 0.36, core, 0);
    f.nofx();
  }
  f.fx(1.7, PB_FX.steady);
  f.box(0.01, yN, 0, 0.02, hN * 0.7, 0.62, core, 0);
  f.nofx();
}

// ---------------------------------------------------------------------------
// Budowla 1: walcownia i prasownia (zakład A) + rząd przy ringu (składy wsadu)

export function buildRollingScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const Q = xzTools(f, plates, labels);
  const R = rigOf('walcownia');
  const V = RING_V;
  const P = layout.plants[0];
  slabs(T, f, layout, ['I', 'A'], { greeble: true });
  slabs(T, f, layout, ['AH'], { greeble: false });
  docks(T, f, R, layout, ['I', 'A'], style);

  // rząd przy ringu: napisy składów, nadbudówki magazynów (dachy ze stali), żurawiki przy dokach
  T.label('SKŁADY WSADU', -5850, 470, 1100, 150, style.labels.logistics, 'STOP GLINU · STOP TYTANU · STAL', H.deck + 9);
  T.label('WSAD NAPĘDÓW', 3300, 470, 1000, 140, style.labels.logistics, 'MIEDŹ · CERAMIKA · TAŚMA', H.deck + 9);
  T.label('WSAD SYSTEMÓW', 6380, 470, 900, 140, style.labels.logistics, 'UKŁADY · SOCZEWKI', H.deck + 9);
  T.label('SKŁAD', -1300, 470, 360, 110, style.labels.logistics, 'MIEDŹ', H.deck + 9);
  // bloki magazynów na pasie bez doków
  for (const [a, b] of [[-6950, -4750], [2500, 4100], [5800, 6950]]) hall(T, f, a, b, 120, 640, { top: H.deck + 70, teeth: 420, glass: false });

  // --- zakład A: hala walcowni (długa, wzdłuż łuku) i prasownia
  const hv0 = P.belt + 110;
  const hv1 = 6620;
  hall(T, f, -6900, -4380, hv0, hv1, { teeth: 280 });
  hall(T, f, -4330, -3080, hv0, hv1, { top: ROOF + 50, teeth: 360, roofMat: M.rail, rib: M.steel });
  // linia walcowania pod szczeliną w dachu: rozgrzana taśma (światła biegnące ku prasowni)
  const sv = (hv0 + hv1) / 2 + 160;
  T.box(-5640, sv, ROOF + 8, 2400 * ringScale(sv) * 0.98, 4, 120, M.rail);
  for (let i = 0; i < 18; i++) {
    const s = -6800 + (2300 * (i + 0.5)) / 18;
    T.lamp(s, sv, ROOF + 12, 70, M.warm, 1.0, PB_FX.chase, 1 - i / 18, 0.45);
  }
  T.box(-5640, sv - 90, ROOF + 14, 2400, 10, 16, M.rail);
  T.box(-5640, sv + 90, ROOF + 14, 2400, 10, 16, M.rail);
  // walce (klatki walcownicze) na dachu jako obudowy napędów
  for (let i = 0; i < 4; i++) {
    const s = -6500 + i * 520;
    T.box(s, sv - 230, ROOF + 40, 160, 60, 150, M.steel);
    T.box(s, sv - 230, ROOF + 76, 120, 12, 110, M.rail);
    T.pipe(s, sv - 160, s, sv - 40, ROOF + 30, 16, M.copper);
  }
  // prasownia: głowice pras
  for (let i = 0; i < 3; i++) {
    const s = -4100 + i * 400;
    T.box(s, sv - 40, ROOF + 110, 220, 80, 260, M.steel);
    T.box(s, sv - 40, ROOF + 156, 180, 14, 220, M.rail);
    T.box(s, sv - 40, ROOF + 100, 230, 12, 270, M.yellow);
  }
  stack(T, -6700, hv0 + 230, ROOF, 40, 140);
  stack(T, -6450, hv0 + 230, ROOF, 32, 110);
  stack(T, -3300, hv1 - 220, ROOF + 50, 44, 160);
  T.label('Z-1  WALCOWNIA', -5650, hv0 + 300, 1600, 230, style.labels.hub, P.small, ROOF + 30);
  T.label('PRASOWNIA', -3700, hv1 - 500, 900, 170, style.labels.capital, 'PŁYTY · PODSTAWY UZBROJENIA', ROOF + 80);
  // plac płyt pod suwnicami
  const yard = layout.yards.find((y) => y.id === 'A');
  yardScene(T, Q, f, R, yard, style);
  T.label('PLAC PŁYT', yard.sc, yard.v1 + 40, 900, 90, style.labels.clear, 'ODBIÓR DO STOCZNI', H.deck + 9);
  // rurociąg (chłodziwo, para) wzdłuż zakładu
  pipeline(T, -6950, -3020, 4590);
  // wieża sterowni zakładu (FG)
  spire(T, f, -6880, 8000 - 120, 170, 11);

  pushLamp(lamps, -5900, 7300, 380, 1);
  pushLamp(lamps, -4100, 7300, 380, 1);
  pushLamp(lamps, -5000, V.inner1 - 300, 340, 1);
  pushLamp(lamps, -2000, V.inner1 - 300, 340, 1);
  pushLamp(lamps, 3300, V.inner1 - 300, 340, 1);
  return sceneOf(f, plates, labels, lamps, { ...R.rig, groups: R.groups });
}

// ---------------------------------------------------------------------------
// Budowla 2: zakład napędów (B) i molo hamowni

export function buildDrivesScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const Q = xzTools(f, plates, labels);
  const R = rigOf('napędy');
  const P = layout.plants[1];
  const pier = layout.pier;
  slabs(T, f, layout, ['B'], { greeble: true });
  slabs(T, f, layout, ['BH', 'BP'], { greeble: false });
  docks(T, f, R, layout, ['B'], style);

  // hala montażu napędów
  const hv0 = P.belt + 110;
  const hv1 = 6950;
  hall(T, f, -2920, -400, hv0, hv1, { teeth: 300 });
  hall(T, f, -350, 1720, hv0, hv1, { top: ROOF + 40, teeth: 380, roofMat: M.rail, rib: M.steel });
  T.label('Z-2  NAPĘDY', -1650, hv0 + 360, 1700, 240, style.labels.hub, P.small, ROOF + 30);
  T.label('MONTAŻ WARP · HIPERCRUISE', 680, hv0 + 360, 1300, 150, style.labels.capital, 'MK I – III', ROOF + 70);
  stack(T, -2700, hv1 - 200, ROOF, 36, 120);
  stack(T, 1500, hv0 + 200, ROOF + 40, 40, 140);
  // próba pola warp: cewka na końcu hali (pierścień uzwojeń, poświata na kanale — tryb „start”)
  const wc = R.chan('warp');
  const ws = 1150;
  const wv = 7280;
  T.cyl(ws, wv, H.deck + 40, 300, 70, M.steel);
  T.cyl(ws, wv, H.deck + 80, 240, 12, M.rail);
  T.cyl(ws, wv, H.deck + 120, 90, 120, M.steel);
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const ds = (Math.cos(ang) * 250) / ringScale(wv);
    const dv = Math.sin(ang) * 250;
    T.box(ws + ds, wv + dv, H.deck + 120, 46, 70, 40, k % 2 ? M.copper : M.teal, ang);
    f.fx(1.5, PB_FX.launch, k / 16, wc);
    T.box(ws + ds * 1.12, wv + dv * 1.12, H.deck + 130, 22, 14, 22, M.cyan, ang);
    f.nofx();
  }
  f.fx(1.8, PB_FX.launch, 0, wc);
  T.cyl(ws, wv, H.deck + 186, 50, 12, M.cyan);
  f.nofx();
  T.label('PRÓBA POLA WARP', ws, wv - 380, 560, 80, style.labels.clear, '', H.deck + 9);
  controlBlock(T, f, -2600, 7280, 360, 360, 21);
  // rurociąg wzdłuż zakładu
  pipeline(T, -2980, 1780, 4590);

  // --- molo hamowni
  const F = layout.yards.find((y) => y.id === 'B');
  const at = F.frame.at;
  const d = F.axis;
  const n = F.cross;
  const L = pier.v1 - pier.v0;
  // krawężniki boków mola i pasy ostrzegawcze na licu stanowisk
  T.run(pier.s0 + 0.2, pier.s1 - 0.2, pier.v1 - 9, H.deck + 9, 16, 16, M.rail, 500);
  T.hazardRun(pier.s0 + 40 / ringScale(pier.v1), pier.s1 - 40 / ringScale(pier.v1), pier.v1 - 40, H.deck + 8, 36);
  for (const s of [pier.s0, pier.s1]) T.box(s + (s === pier.s0 ? 1 : -1) * 9 / ringScale(pier.v0), (pier.v0 + pier.v1) / 2, H.deck + 9, 16, 16, L, M.rail);
  for (const s of [pier.s0, pier.s1]) {
    for (let k = 0; k < 6; k++) {
      const v = pier.v0 + 300 + k * ((L - 600) / 5);
      T.lamp(s + (s === pier.s0 ? 1 : -1) * 30 / ringScale(v), v, H.deck + 22, 16, M.red, 1.2, PB_FX.blink, k / 6, 0.5);
    }
  }
  yardScene(T, Q, f, R, F, style, { gantryH: 470 });
  Q.label('PLAC NAPĘDÓW', at(140, -1150), 900, 110, style.labels.clear, 'Z HALI MONTAŻU', H.deck + 9, 'bg', n[0], n[1]);
  // kolektor chłodziwa w poprzek mola przed stanowiskami
  Q.pipe(at(3200, -1620), at(3200, 1620), H.deck + 30, 24, M.copper);
  Q.pipe(at(3250, -1620), at(3250, 1620), H.deck + 20, 14, M.steel);
  Q.label('HAMOWNIA', at(2720, 0), 1500, 200, style.labels.capital, 'STANOWISKA PRÓB SILNIKÓW · DYSZE W PRZESTRZEŃ', H.deck + 9, 'bg', n[0], n[1]);

  // stanowiska prób: płyta, rama oporowa, silnik, dysze w licu, lampa stanu, kogut ostrzegawczy, płomienie
  const yN = H.deck + 8 + 0;            // wysokość podłoża stanowiska
  for (const S of layout.stands) {
    const sch = R.chan(`stand${S.index}`);
    const ach = R.chan(`fire${S.index}`);
    const halfW = S.r * 2 + 120;
    const a0 = 3290;
    const a1 = S.edge - 20;
    Q.plate([at(a0, S.c - halfW), at(a1, S.c - halfW), at(a1, S.c + halfW), at(a0, S.c + halfW)], H.deck, 8, M.floor);
    // rama oporowa za silnikiem i słupy po bokach
    const ae = S.a;
    const back = ae - S.len / 2 - 50;
    Q.box(at(back, S.c), H.deck + 90, 60, 170, halfW * 1.6, M.orange, d[0], d[1]);
    Q.box(at(back - 70, S.c), H.deck + 60, 80, 110, halfW * 1.2, M.steel, d[0], d[1]);
    for (const k of [-1, 1]) {
      Q.box(at(ae, S.c + k * (S.r + 70)), H.deck + 110, S.len * 0.9, 24, 26, M.yellow, d[0], d[1]);
      Q.box(at(ae - S.len * 0.3, S.c + k * (S.r + 70)), H.deck + 70, 40, 130, 40, M.steel, d[0], d[1]);
      Q.box(at(ae + S.len * 0.3, S.c + k * (S.r + 70)), H.deck + 70, 40, 130, 40, M.steel, d[0], d[1]);
      Q.pipe(at(3215, S.c + k * 40), at(back - 100, S.c + k * 40), H.deck + 26, 10, M.copper);
    }
    // silnik(i) na stanowisku: dysza w licu mola
    const nz = S.nozzles;
    for (let j = 0; j < nz; j++) {
      const off = nz > 1 ? (j - (nz - 1) / 2) * (S.r * 2 + 30) : 0;
      engineModel(Q, f, at(ae, S.c + off), d, S.goods === 'hypercruise_mk2' ? 'hypercruise_mk2' : S.goods, yN);
    }
    // lampa stanu (czerwona — próba, zielona — wolne) i kogut ostrzegawczy na słupie
    f.fx(1.45, PB_FX.status, 0, sch);
    Q.box(at(back - 130, S.c), H.deck + 24, 60, 12, 26, M.status, n[0], n[1]);
    f.nofx();
    Q.box(at(back - 20, S.c + halfW * 0.85), H.deck + 140, 30, 280, 30, M.steel, d[0], d[1]);
    Q.lamp(at(back - 20, S.c + halfW * 0.85), H.deck + 290, 26, M.warm, 2.0, PB_FX.alarm, S.index * 0.25, ach);
    Q.label(`${S.id}  ${S.name}`, at(3060, S.c), Math.min(700, halfW * 2), 80, style.labels.berthLead, '', H.deck + 9, 'bg', n[0], n[1]);
    // płomienie: grupa na dyszę (bryła jednostkowa w początku układu)
    const yE = yN + (FAB_ENGINES[S.goods]?.r || S.r) + 14;
    for (let j = 0; j < nz; j++) {
      const off = nz > 1 ? (j - (nz - 1) / 2) * (S.r * 2 + 30) : 0;
      const g = R.group();
      f.group = g;
      f.set = 'fg';
      flameUnit(f, yE, S.r * 1.6, S.color);
      f.group = 0;
      f.set = 'bg';
      R.rig.flames.push({ stand: S.index, group: g, at: at(S.edge + 4, S.c + off), heading: F.frame.heading });
    }
  }
  pushLamp(lamps, -1600, 6000, 380, 1);
  pushLamp(lamps, 400, 6000, 380, 1);
  pushLamp(lamps, pier.sc, pier.v0 + 1300, 420, 1);
  pushLamp(lamps, pier.sc, pier.v1 - 300, 420, 1);
  return sceneOf(f, plates, labels, lamps, { ...R.rig, groups: R.groups });
}

// ---------------------------------------------------------------------------
// Budowla 3: reaktory i emitery tarcz (C) z pasem MEGA importu, awionika i podtrzymywanie życia (D)

export function buildSystemsScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const Q = xzTools(f, plates, labels);
  const R = rigOf('systemy');
  const PC = layout.plants[2];
  const PD = layout.plants[3];
  slabs(T, f, layout, ['C', 'D'], { greeble: true });
  slabs(T, f, layout, ['CH', 'DH'], { greeble: false });
  docks(T, f, R, layout, ['C', 'D'], style);
  megaDetail(T, f, layout, 'CH', style, (berthId) => {
    const ch = R.chan();
    R.rig.status.push({ ch, berthId });
    return ch;
  });

  // --- reaktory: trzy osłonięte komory (grube ściany, pasy ostrzegawcze, kopuła, wyrzutnie)
  const rc = R.chan('reactor');
  const cv0 = PC.belt + 150;
  const cv1 = 6280;
  const cells = [[1900, 2340], [2400, 2840], [2900, 3340]];
  cells.forEach(([a, b], i) => {
    T.sec(a, b, cv0, cv1, H.deck, ROOF + 30 - H.deck, M.steel);
    const d = 30 / ringScale(cv0);
    T.sec(a + d, b - d, cv0 + 30, cv1 - 30, ROOF + 30, 5, M.rail);
    T.hazardRun(a + d, b - d, cv0 + 40, ROOF + 38, 30);
    T.hazardRun(a + d, b - d, cv1 - 40, ROOF + 38, 30);
    const sm = (a + b) / 2;
    T.cyl(sm, (cv0 + cv1) / 2 + 120, ROOF + 60, 150, 50, M.steel);
    T.cyl(sm, (cv0 + cv1) / 2 + 120, ROOF + 92, 110, 16, M.rail);
    if (i === 1) {
      // komora prób: szczelina z poświatą rdzenia (kanał „reaktor”)
      f.fx(1.3, PB_FX.fill, 0.5, rc);
      T.cyl(sm, (cv0 + cv1) / 2 + 120, ROOF + 104, 60, 8, M.warm);
      f.nofx();
    }
    stack(T, sm, cv1 - 180, ROOF + 30, 34, 120);
    T.label(`R-${i + 1}`, sm, cv0 + 130, 300, 110, style.labels.capital, i === 1 ? 'PRÓBA RDZENIA' : 'KOMORA', ROOF + 39);
  });
  T.label('Z-3  REAKTORY', 2620, cv0 + 480, 1350, 190, style.labels.hub, 'OSŁONIĘTE KOMORY MONTAŻU', ROOF + 40);
  // emitery tarcz: hala z szedami
  hall(T, f, 3420, 4930, cv0, 5900, { teeth: 280 });
  T.label('EMITERY TARCZ', 4170, 5250, 1200, 190, style.labels.hub, 'TAŚMA · STOP GLINU · POLIMER · UKŁADY', ROOF + 30);
  // stanowisko prób emitera: maszt z czaszą, krąg pola (kanał „emiter”)
  const ec = R.chan('shield');
  const es = 4520;
  const ev = 6660;
  T.cyl(es, ev, H.deck + 20, 170, 30, M.steel);
  T.cyl(es, ev, H.deck + 110, 40, 160, M.steel);
  T.cyl(es, ev, H.deck + 200, 120, 18, M.rail);
  T.cyl(es, ev, H.deck + 214, 70, 12, M.teal);
  for (let k = 0; k < 20; k++) {
    const ang = (k / 20) * Math.PI * 2;
    const ds = (Math.cos(ang) * 360) / ringScale(ev);
    const dv = Math.sin(ang) * 360;
    T.box(es + ds, ev + dv, H.deck + 20, 40, 30, 30, M.rail, ang);
    f.fx(1.4, PB_FX.launch, k / 20, ec);
    T.box(es + ds, ev + dv, H.deck + 60, 70, 10, 20, M.cyan, ang + Math.PI / 2);
    f.nofx();
  }
  f.fx(1.8, PB_FX.launch, 0.5, ec);
  T.cyl(es, ev, H.deck + 228, 40, 8, M.cyan);
  f.nofx();
  T.label('PRÓBA EMITERA T-1', es, ev - 480, 640, 80, style.labels.clear, '', H.deck + 9);
  // skład importu przy pasie MEGA: zbiorniki chłodziwa i kontenery z pasa
  const ms = layout.mega.sc;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const s = 3200 + i * 250;
      const v = 6430 + j * 320;
      T.cyl(s, v, H.deck + 70, 120, 140, j ? M.teal : M.steel);
      T.cyl(s, v, H.deck + 146, 90, 12, M.rail);
    }
  }
  T.pipe(3080, 6590, 3800, 6590, H.deck + 40, 16, M.copper);
  const CR = [M.orange, M.teal, M.steel, M.yellow];
  for (let k = 0; k < 10; k++) {
    const s = 3170 + (k % 5) * 125;
    const v = 7020 + Math.floor(k / 5) * 170;
    T.box(s, v, H.deck + 30, 90, 50, 130, CR[k % 4]);
  }
  T.label('SKŁAD IMPORTU', ms, 7335, 1000, 70, style.labels.logistics, 'NADSTOP · KOMPOZYT · KATALIZATOR · CHŁODZIWO · PRĘTY', H.deck + 9);
  // plac rdzeni (odbiór koleją)
  const yc = layout.yards.find((y) => y.id === 'C');
  yardScene(T, Q, f, R, yc, style);
  T.label('PLAC RDZENI', yc.sc, yc.v1 + 40, 800, 80, style.labels.clear, 'KOLEJ DO STOCZNI', H.deck + 9);
  pipeline(T, 1820, 4980, 4560);

  // --- awionika i podtrzymywanie życia
  const dv0 = PD.belt + 110;
  hall(T, f, 5080, 6920, dv0, 5520, { top: ROOF - 20, teeth: 240, roofMat: M.rail, rib: M.steel });
  T.label('Z-4  AWIONIKA', 6000, dv0 + 280, 1300, 190, style.labels.hub, 'UKŁADY · PRZEWODY · SOCZEWKI', ROOF + 10);
  T.label('PODTRZYMYWANIE ŻYCIA', 6000, 5300, 1300, 120, style.labels.capital, 'POLIMER · TLEN · AZOT', ROOF + 10);
  // zbiorniki gazów (tlen, azot) przy placu
  for (let i = 0; i < 6; i++) T.cyl(5120 + i * 300, 6530, H.deck + 40, 46, 70, i % 2 ? M.teal : M.steel);
  const yd = layout.yards.find((y) => y.id === 'D');
  yardScene(T, Q, f, R, yd, style, { gantryH: 280 });
  pipeline(T, 5020, 6980, 4560 - 160);
  spire(T, f, 6890, 6420, 150, 31);

  pushLamp(lamps, 2600, 6900, 380, 1);
  pushLamp(lamps, 4300, 6700, 380, 1);
  pushLamp(lamps, 6000, 6050, 380, 1);
  pushLamp(lamps, ms, 7700, 360, 1);
  return sceneOf(f, plates, labels, lamps, { ...R.rig, groups: R.groups });
}

export { k7HeightToZ, yardPoint };
