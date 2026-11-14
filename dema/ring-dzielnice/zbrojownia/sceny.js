// DZIELNICA „Zbrojownia i skład amunicji” — BRYŁY (dane PortRecorder, bez three). Trzy budowle:
//   1. hale zbrojowni i plac gotowych wież (suwnica placu = grupa ruchoma),
//   2. strzelnica i stanowiska prób (wieże obracają się — grupy 1…8; błyski luf i trafień — kanały „show”),
//   3. skład amunicji: ekspedycja, doki uzbrajania (lampy stanu i postępu), pole bunkrów, hangar myśliwców, nabrzeże.
// Wierzchy ze stali i szyn, podłogi jasne, listwy krótkie; nic nie wisi nad drogą ani nad wylotami doków.
import { RING_V, ringScale, yardPoint } from '../kit/uklad.js';
import {
  PB_FX, PB_MAT, PB_MAX_GROUPS, YARD_H, megaDetail, newScene, pbHash1, pitDetail, pushLamp, sceneOf, spire
} from '../kit/sceny.js';
import { ZB, bunkerGrid } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;
const V = RING_V;

/** Kanały budowli strzelnicy. */
export const RANGE_CH = Object.freeze({ muzzle: 0, hit: 1, fire: 2 });
/** Kanały budowli składu: dok i → stan 2i (0 ładowanie, 1 wolny / gotowy), postęp 2i + 1 (0…1). */
export const AMMO_CH = Object.freeze({ status: (i) => 2 * i, progress: (i) => 2 * i + 1, guard: 12 });

const goodsName = {
  ammo_kinetic: 'AMUNICJA KIN.', flak_shell: 'POCISKI FLAK', missile_round: 'RAKIETY', torpedo_round: 'TORPEDY'
};

// ---------------------------------------------------------------------------
// Elementy wspólne

/** Układ z wybranymi kawałkami korpusów (`bodies` czyta tylko `pieces`) — strefa ZI należy do dwóch budowli. */
const piecesOf = (layout, keep) => ({ pieces: layout.pieces.filter(keep) });

/**
 * Korpusy kawałków (jak `bodies` zestawu, ale wierzchy tylko ze stali i szyn — bez beżowych płyt): blok przez
 * płaszczyznę lotu, wierzch, na licu od strony wylotów krawężnik, krótka listwa świetlna i pas stali.
 */
function korpusy(T, f, layout, zones, { strip = M.white } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.deck - H.keel, M.dark);
    // wierzch bez odstępów między kawałkami (szczeliny czytały się jak czarne linie)
    T.sec(p.s0, p.s1, p.v0, p.v1, H.deck, 6, M.steel);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      T.run(p.s0, p.s1, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
      // listwa świetlna w krótkich odcinkach (nie ciągła)
      const sw = ringScale(v);
      const n = Math.max(1, Math.round(((p.s1 - p.s0) * sw) / 420));
      f.fx(0.9, PB_FX.steady);
      for (let k = 0; k < n; k++) {
        const c = p.s0 + ((p.s1 - p.s0) * (k + 0.5)) / n;
        T.box(c, v + sign * 3, H.wallLight, 150, 5, 6, strip);
      }
      f.nofx();
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
    }
  }
}

/** Hala z dachem ze stali: świetliki (szkło) w krótkich odcinkach, żebra z szyn, wywietrzniki, napis na dachu. */
function hall(T, f, a, b, v0, v1, roofH, text, small, color, seed) {
  const sw = ringScale(v0);
  const d = 30 / sw;
  T.sec(a + d, b - d, v0 + 30, v1 - 30, H.deck, roofH, M.steel);
  const top = H.deck + roofH;
  const span = (b - a) * sw;
  const nSeg = Math.max(2, Math.round(span / 700));
  // żebra dachu z szyn co 300 j.; świetliki (szkło) tylko w co drugim polu, krótkie
  let row = 0;
  for (let v = v0 + 170; v < v1 - 140; v += 300, row++) {
    T.run(a + d, b - d, v + 40, top + 10, 18, 14, M.rail, 500, 1.0);
    if (row % 3 !== 1) continue;
    for (let k = 0; k < nSeg; k++) {
      const s0 = a + d + ((b - a - 2 * d) * (k + 0.3)) / nSeg;
      const s1 = a + d + ((b - a - 2 * d) * (k + 0.7)) / nSeg;
      T.run(s0, s1, v, top + 6, 10, 40, M.glass, 400, 1.0);
    }
  }
  // obrzeże dachu
  T.run(a + d, b - d, v0 + 36, top + 8, 14, 16, M.rail, 500);
  T.run(a + d, b - d, v1 - 36, top + 8, 14, 16, M.rail, 500);
  // wywietrzniki i maszt
  const n = Math.max(2, Math.round(span / 900));
  for (let k = 0; k < n; k++) {
    const s = a + ((b - a) * (k + 0.5)) / n;
    T.cyl(s, v1 - 110, top + 22, 26, 34, M.rail);
  }
  if (text) T.label(text, (a + b) / 2, (v0 + v1) / 2, Math.min(span * 0.62, 1900), Math.min((v1 - v0) * 0.32, 300), color, small, top + 16);
  void seed;
}

/** Blok dowodzenia (FG): cokół, korpus z pasem okien, nadbudówka, maszt z kogutem — stal, szyny i szkło. */
function command(T, f, s, v, ls, lv, seed) {
  f.set = 'fg';
  const y0 = H.deck;
  const S = (d) => d / ringScale(v);
  T.box(s, v, y0 + 30, ls * 1.14, 60, lv * 1.12, M.steel);
  T.box(s, v, y0 + 64, ls * 1.08, 8, lv * 1.06, M.rail);
  T.box(s, v, y0 + 104, ls, 80, lv, M.steel);
  T.box(s, v, y0 + 108, ls + 8, 24, lv + 8, M.glass);
  T.box(s, v, y0 + 148, ls * 0.94, 8, lv * 0.94, M.rail);
  T.box(s, v - lv * 0.2, y0 + 190, ls * 0.56, 80, lv * 0.3, M.steel);
  T.box(s, v - lv * 0.2, y0 + 200, ls * 0.6, 18, lv * 0.32, M.glass);
  T.box(s, v - lv * 0.2, y0 + 234, ls * 0.5, 8, lv * 0.26, M.rail);
  T.cyl(s + S(ls * 0.25), v + lv * 0.3, y0 + 240, 7, 180, M.rail);
  T.lamp(s + S(ls * 0.25), v + lv * 0.3, y0 + 336, 16, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.6), 0.5);
  for (const dv of [-1, 1]) for (const ds of [-1, 1]) T.lamp(s + S(ds * ls * 0.48), v + dv * lv * 0.48, y0 + 156, 14, M.white, 1.2);
  f.set = 'bg';
}

/** Posterunek straży: wieżyczka z pasem okien, reflektor, kogut. */
function post(T, f, s, v, seed, fg = false) {
  if (fg) f.set = 'fg';
  T.box(s, v, H.deck + 50, 110, 100, 110, M.steel);
  T.box(s, v, H.deck + 84, 120, 24, 120, M.glass);
  T.box(s, v, H.deck + 104, 130, 10, 130, M.rail);
  T.cyl(s, v, H.deck + 130, 6, 50, M.rail);
  T.lamp(s, v, H.deck + 158, 16, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.4), 0.5);
  T.lamp(s, v + 70, H.deck + 112, 14, M.white, 1.3);
  if (fg) f.set = 'bg';
}

/** Ramka ostrzegawcza wokół prostokąta (s0…s1 × v0…v1): pasy żółto-czarne na wierzchu. */
function hazardFrame(T, s0, s1, v0, v1, y, wid) {
  const sw = ringScale((v0 + v1) / 2);
  T.hazardRun(s0, s1, v0, y, wid);
  T.hazardRun(s0, s1, v1, y, wid);
  T.hazardRad(s0 + wid / 2 / sw, v0 + wid, v1 - wid, y, wid);
  T.hazardRad(s1 - wid / 2 / sw, v0 + wid, v1 - wid, y, wid);
}

/**
 * Wieża uzbrojenia w (s, v), lufa ku +v (w przestrzeń), wysokość podstawy `y0`, skala `k`. `flash` = { ch, bit } —
 * błysk u wylotu (tryb show z kanału); zwraca odległość wylotu od osi (v).
 */
export function turret(T, f, s, v, kind, k, y0 = H.deck, flash = null) {
  const S = (d) => d / ringScale(v);
  const at = (ds, dv) => [s + S(ds * k), v + dv * k];
  const B = (ds, dv, y, ls, h, lv, mat) => { const [ps, pv] = at(ds, dv); T.box(ps, pv, y0 + y * k, ls * k, h * k, lv * k, mat); };
  T.cyl(s, v, y0 + 10 * k, 96 * k, 20 * k, M.steel);
  T.cyl(s, v, y0 + 22 * k, 82 * k, 6 * k, M.rail);
  let muzzle = 300;
  let my = 56;
  if (kind === 'kin') {
    B(0, -10, 50, 170, 56, 200, M.steel);
    B(0, -30, 80, 140, 6, 120, M.rail);
    B(0, 60, 64, 110, 22, 50, M.steel);
    for (const o of [-1, 1]) { B(o * 36, 220, 58, 18, 18, 260, M.rail); B(o * 36, 352, 58, 28, 22, 26, M.steel); }
    muzzle = 372; my = 58;
  } else if (kind === 'rail') {
    B(0, -20, 46, 150, 50, 180, M.steel);
    B(0, -70, 76, 110, 10, 60, M.copper);
    for (const o of [-1, 1]) B(o * 17, 270, 52, 10, 16, 400, M.rail);
    f.fx(1.2, PB_FX.steady);
    for (let i = 0; i < 4; i++) B(0, 130 + i * 85, 54, 50, 12, 12, M.cyan);
    f.nofx();
    muzzle = 476; my = 52;
  } else if (kind === 'laser') {
    T.cyl(s, v, y0 + 56 * k, 78 * k, 56 * k, M.steel);
    B(0, 92, 64, 64, 40, 100, M.steel);
    B(0, 146, 68, 96, 46, 16, M.glass);
    f.fx(1.1, PB_FX.steady);
    B(0, 156, 68, 54, 24, 6, M.cyan);
    f.nofx();
    for (const o of [-1, 0, 1]) B(o * 34, -100, 60, 10, 54, 80, M.copper);
    muzzle = 170; my = 68;
  } else if (kind === 'plasma') {
    B(0, -10, 54, 180, 64, 190, M.steel);
    B(0, 216, 60, 52, 40, 250, M.rail);
    for (let i = 0; i < 3; i++) B(0, 130 + i * 60, 62, 74, 48, 16, M.teal);
    B(0, 346, 60, 66, 46, 20, M.steel);
    muzzle = 364; my = 60;
  } else if (kind === 'launcher') {
    B(0, 0, 60, 210, 84, 170, M.steel);
    B(0, 0, 104, 196, 4, 156, M.rail);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) B(-60 + i * 60, -50 + j * 50, 108, 34, 4, 34, M.dark);
    B(0, 92, 60, 190, 60, 14, M.yellow);
    muzzle = 110; my = 70;
  } else if (kind === 'torpedo') {
    B(0, -60, 50, 190, 60, 120, M.steel);
    for (const o of [-1, 1]) { B(o * 52, 90, 62, 72, 64, 300, M.steel); B(o * 52, 90, 96, 56, 6, 280, M.rail); B(o * 52, 244, 62, 76, 66, 12, M.orange); }
    muzzle = 260; my = 62;
  } else if (kind === 'pd') {
    T.cyl(s, v, y0 + 50 * k, 60 * k, 50 * k, M.steel);
    B(0, -60, 84, 70, 24, 50, M.rail);
    for (const o of [-1.5, -0.5, 0.5, 1.5]) B(o * 11, 120, 54, 8, 10, 170, M.rail);
    B(0, 60, 54, 60, 26, 30, M.steel);
    muzzle = 208; my = 54;
  } else {
    // flak: cztery lufy
    B(0, -10, 54, 160, 66, 170, M.steel);
    B(0, -10, 90, 130, 6, 120, M.rail);
    for (const o of [-1.5, -0.5, 0.5, 1.5]) B(o * 24, 180, 60, 14, 16, 200, M.rail);
    B(0, 86, 60, 130, 30, 24, M.steel);
    muzzle = 282; my = 60;
  }
  if (flash) {
    f.fx(2.4, PB_FX.show, flash.bit, flash.ch);
    B(0, muzzle + 34, my, 70, 22, 70, M.white);
    f.fx(1.6, PB_FX.show, flash.bit, flash.ch);
    B(0, muzzle + 40, my - 4, 140, 8, 150, M.warm);
    f.nofx();
  }
  return muzzle;
}

/** Wieża pod plandeką (gotowa do wysyłki). */
function coveredTurret(T, s, v, k, mat) {
  T.box(s, v, H.deck + 34 * k, 220 * k, 68 * k, 260 * k, mat);
  T.box(s, v, H.deck + 70 * k, 200 * k, 6 * k, 36 * k, M.rail);
}

// ---------------------------------------------------------------------------
// 1. Hale zbrojowni i plac gotowych wież

export function buildArmoryScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const A = ZB.armory;
  const G = ZB.guard;
  const Y = ZB.yard;
  korpusy(T, f, piecesOf(layout, (p) => p.zone !== 'ZI' || p.bar !== 'ekspedycja'), ['ZI', 'ZO', 'ZP', 'ZW']);
  // pasy przy ringu: dwie hale (lufy i zamki | emitery i plazma), przerwa z suwnicą dachową
  const mid = (A.a + A.b) / 2;
  hall(T, f, A.a, mid - 80, 0, V.inner1, 150, 'LUFY I ZAMKI', 'DZIAŁA KINETYCZNE · SZYNOWE', style.labels.berthLead, 1);
  hall(T, f, mid + 80, A.b, 0, V.inner1, 150, 'EMITERY I PLAZMA', 'LASERY · DZIAŁA PLAZMOWE', style.labels.berthLead, 2);
  T.run(mid - 70, mid + 70, 500, H.deck + 40, 80, 600, M.steel, 200, 1.0);
  T.run(mid - 60, mid + 60, 500, H.deck + 84, 8, 520, M.rail, 200, 1.0);
  // rząd zewnętrzny: hala montażu wież i hala wyrzutni, między nimi tor wewnętrzny
  const split = -3150;
  hall(T, f, A.a, split - 90, V.outer0, V.outer1, 190, 'MONTAŻ WIEŻ', 'KINETYCZNE · SZYNOWE · OBRONA PUNKTOWA · FLAK', style.labels.berthLead, 3);
  hall(T, f, split + 90, A.b, V.outer0, V.outer1, 190, 'WYRZUTNIE', 'RAKIETY · TORPEDY · PRÓBY ZESPOŁÓW', style.labels.berthLead, 4);
  for (const o of [-40, 40]) T.box(split + o / ringScale(4950), 4950, H.deck + 10, 14, 10, V.outer1 - V.outer0 - 120, M.rail);
  T.lamp(split, V.outer0 + 140, H.deck + 24, 18, M.warm, 1.1, PB_FX.blink, 0.2, 0.7);
  // pas straży (rząd zewnętrzny): dowództwo zbrojowni (FG)
  command(T, f, (G.a + G.b) / 2, 5000, 330, 1400, 41);
  post(T, f, (G.a + G.b) / 2, V.outer0 + 220, 42);
  post(T, f, (G.a + G.b) / 2, V.inner1 - 230, 43);
  T.label('STRAŻ', (G.a + G.b) / 2, 520, 400, 90, style.labels.capital, 'ZBROJOWNIA · SKŁAD', H.deck + 12);
  // wał między placem a bunkrami: ściana wybuchowa, iglica straży, pasy ostrzegawcze
  const sw = ringScale(8500);
  const d = 40 / sw;
  T.sec(G.a + d, G.b - d, Y.v0 + 60, ZB.bunkers.v1 - 60, H.deck, 110, M.steel);
  T.sec(G.a + 2 * d, G.b - 2 * d, Y.v0 + 100, ZB.bunkers.v1 - 100, H.deck + 110, 8, M.rail);
  T.hazardRad(G.a + 10 / sw, Y.v0 + 80, ZB.bunkers.v1 - 80, H.deck + 8, 30);
  T.hazardRad(G.b - 10 / sw, Y.v0 + 80, ZB.bunkers.v1 - 80, H.deck + 8, 30);
  spire(T, f, (G.a + G.b) / 2, 8600, 250, 44);
  for (let v = Y.v0 + 400; v < ZB.bunkers.v1 - 200; v += 900) T.lamp((G.a + G.b) / 2, v, H.deck + 124, 16, M.red, 1.5, PB_FX.blink, (v / 900) % 1, 0.5);

  // plac gotowych wież: tory suwnicy, rzędy wież (część pod plandeką), alejki, napis
  const s0 = A.a + 260 / ringScale(Y.storeV0);
  const s1 = A.b - 260 / ringScale(Y.storeV0);
  T.run(s0, s1, Y.storeV0 - 60, H.deck + 10, 14, 24, M.rail, 400);
  T.run(s0, s1, Y.storeV1 + 60, H.deck + 10, 14, 24, M.rail, 400);
  const KINDS = ['kin', 'rail', 'pd', 'flak', 'plasma', 'laser', 'launcher', 'torpedo'];
  const CLOTH = [M.teal, M.orange, M.teal, M.yellow];
  const rows = [6820, 7360, 7900, 8440];
  rows.forEach((v, ri) => {
    const sv = ringScale(v);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const s = s0 + 120 / sv + ((s1 - s0 - 240 / sv) * (i + 0.5)) / n;
      T.box(s, v, H.deck + 8, 250, 12, 280, M.rail);
      const h = pbHash1(i * 3.7 + ri * 11.3);
      if (h < 0.35) coveredTurret(T, s, v, 0.72, CLOTH[(i + ri) % CLOTH.length]);
      else turret(T, f, s, v, KINDS[(i + 2 * ri) % KINDS.length], 0.62, H.deck + 14);
    }
    // alejka między rzędami
    if (ri < rows.length - 1) for (let s = s0 + 300 / sv; s < s1; s += 520 / sv) T.box(s, v + 270, H.deck + 7, 200, 2, 10, M.paint);
  });
  T.label('PLAC GOTOWYCH WIEŻ', (A.a + A.b) / 2, Y.v0 + 95, 1500, 150, style.labels.berthLead, 'WYSYŁKA DO STOCZNI I SUCHEGO DOKU FLOTY');
  pushLamp(lamps, -4600, 7600, 520, 1);
  pushLamp(lamps, -1700, 7600, 520, 1);
  pushLamp(lamps, -4600, 2300 - 1200, 460, 1);
  pushLamp(lamps, -1700, 2300 + 1500, 460, 1);

  // suwnica placu (grupa 1): dwie nogi na torach, belka w poprzek placu, wózek z chwytakiem — nagrana w s = gantryS0
  const gs = -3300;
  f.group = 1;
  const gv0 = Y.storeV0 - 60;
  const gv1 = Y.storeV1 + 60;
  for (const v of [gv0, gv1]) {
    T.box(gs, v, H.deck + 26, 120, 30, 60, M.yellow);
    T.box(gs, v, H.deck + 170, 40, 300, 40, M.yellow);
    T.lamp(gs, v, H.deck + 334, 14, M.red, 1.5, PB_FX.blink, v > 8000 ? 0.5 : 0, 0.6);
  }
  T.box(gs, (gv0 + gv1) / 2, H.deck + 316, 70, 40, gv1 - gv0 + 60, M.yellow);
  T.box(gs, (gv0 + gv1) / 2, H.deck + 340, 46, 8, gv1 - gv0, M.rail);
  T.box(gs, 7630, H.deck + 300, 110, 50, 120, M.steel);
  T.box(gs, 7630, H.deck + 226, 16, 120, 16, M.rail);
  T.box(gs, 7630, H.deck + 156, 120, 20, 120, M.orange);
  f.group = 0;
  return sceneOf(f, plates, labels, lamps, { gantry: { group: 1, s0: gs } });
}

// ---------------------------------------------------------------------------
// 2. Strzelnica i stanowiska prób

export function buildRangeScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const A = ZB.armory;
  const R = ZB.range;
  const Y = ZB.yard;
  korpusy(T, f, layout, ['ZR'], { strip: M.red });
  const armS = R.armW / ringScale((R.v0 + R.v1) / 2);
  const in0 = A.a + armS;
  const in1 = A.b - armS;
  // dno strzelnicy (pod płaszczyzną lotu, jasne), znaczniki odległości co 500 j., tory ognia stanowisk
  T.sec(in0, in1, R.v0, R.v1, H.keel, H.floor - H.keel, M.steel);
  for (let v = R.v0 + 500; v < R.v1; v += 500) T.run(in0 + 20, in1 - 20, v, H.mark, 2, (v - R.v0) % 1000 ? 8 : 16, M.rail, 600);
  for (const st of ZB.stands) T.box(st.s, (R.v0 + R.v1) / 2, H.mark, 12, 2, R.v1 - R.v0 - 120, M.paint);
  T.label('STRZELNICA PRÓBNA', (in0 + in1) / 2, R.v0 + 1750, 2600, 300, style.labels.capital, 'STREFA OGNIA · ZAKAZ PRZELOTU', H.mark + 2);
  // ramiona: kogut co 600 j., pas ostrzegawczy na koronie
  for (const [a, b] of [[A.a, in0], [in1, A.b]]) {
    const s = (a + b) / 2;
    T.hazardRad(s, R.v0 + 60, R.v1 - 60, H.deck + 8, 60);
    for (let v = R.v0 + 300; v < R.v1; v += 600) T.lamp(s, v, H.deck + 24, 18, M.red, 1.5, PB_FX.alarm, (v / 600) % 1, RANGE_CH.fire);
  }
  // kulochwyt: tarcze na koronie (trafienie = błysk z kanału), reflektory
  ZB.targets.forEach((ts, i) => {
    const v = R.v1 + 175;
    T.box(ts, v, H.deck + 10, 300, 8, 250, M.rail);
    T.box(ts, v, H.deck + 16, 200, 4, 170, M.steel);
    T.box(ts, v, H.deck + 20, 110, 4, 90, M.yellow);
    T.box(ts, v, H.deck + 24, 40, 4, 34, M.red);
    f.fx(2.4, PB_FX.show, 2 ** i, RANGE_CH.hit);
    T.box(ts, v, H.deck + 36, 150, 8, 150, M.white);
    f.fx(1.5, PB_FX.show, 2 ** i, RANGE_CH.hit);
    T.box(ts, v - 10, H.deck + 30, 300, 6, 260, M.warm);
    f.nofx();
    T.lamp(ts, R.v1 + 330, H.deck + 26, 14, M.white, 1.2);
  });
  // stanowiska prób na krawędzi placu: płyta, ramka ostrzegawcza, osłona tylna, napis; wieża = grupa ruchoma
  const stands = [];
  ZB.stands.forEach((st, i) => {
    const s = st.s;
    const v = Y.standV;
    const sv = ringScale(v);
    T.box(s, v, H.deck + 4, 440, 8, 520, M.rail);
    T.box(s, v, H.deck + 8, 380, 4, 440, M.steel);
    hazardFrame(T, s - 230 / sv, s + 230 / sv, v - 270, v + 280, H.deck + 9, 26);
    T.box(s, v - 300, H.deck + 60, 380, 120, 30, M.steel);
    T.box(s, v - 300, H.deck + 122, 360, 6, 24, M.rail);
    for (const o of [-1, 1]) T.lamp(s + (o * 200) / sv, v - 290, H.deck + 132, 14, M.red, 1.5, PB_FX.alarm, o > 0 ? 0.5 : 0, RANGE_CH.fire);
    T.label(st.label, s, v - 390, 440, 80, style.labels.berthLead, `PRÓBY ${i + 1}`, H.deck + 12);
    f.group = i + 1;
    const muzzle = turret(T, f, s, v, st.kind, 1.15, H.deck + 10, { ch: RANGE_CH.muzzle, bit: 2 ** i });
    f.group = 0;
    const [px, pz] = yardPoint(s, v);
    stands.push({ group: i + 1, s, v, px, pz, kind: st.kind, muzzle });
  });
  // sterownia prób (FG) na końcu placu i przejście krawędzią
  command(T, f, A.b - 300 / ringScale(Y.standV), Y.standV - 80, 330, 520, 51);
  T.run(A.a + 150 / ringScale(Y.v1), A.b - 650 / ringScale(Y.v1), Y.v1 - 90, H.deck + 10, 10, 40, M.rail, 500);
  for (const st of ZB.stands) pushLamp(lamps, st.s, Y.standV + 300, 420, 1);
  if (stands.length + 1 > PB_MAX_GROUPS) throw new Error('za dużo grup strzelnicy');
  return sceneOf(f, plates, labels, lamps, { stands });
}

// ---------------------------------------------------------------------------
// 3. Skład amunicji

export function buildAmmoScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const MZ = ZB.ammo;
  const BK = ZB.bunkers;
  korpusy(T, f, piecesOf(layout, (p) => p.bar === 'ekspedycja'), ['ZI']);
  hall(T, f, MZ.a, MZ.b, 0, V.inner1, 140, 'EKSPEDYCJA AMUNICJI', 'DO SUCHEGO DOKU FLOTY · ZAŁADUNEK CIĘŻARÓWEK', style.labels.capital, 5);
  korpusy(T, f, layout, ['ZU', 'ZB']);

  // --- doki uzbrajania: dno, stanowisko, lampa stanu (kanał), lampy postępu na koronie, żurawiki, napis
  const docks = [];
  const NAME = { s: 'FREGATA', m: 'NISZCZYCIEL', l: 'PANCERNIK' };
  layout.pits.filter((p) => p.zone === 'ZU').sort((p, q) => p.s0 - q.s0).forEach((pit, i) => {
    const chS = AMMO_CH.status(i);
    const chP = AMMO_CH.progress(i);
    pitDetail(T, f, pit, { statusCh: chS, navy: true });
    const sw = ringScale(pit.v1);
    const S = (d) => d / sw;
    // lampy postępu ładowania na koronach ścian bocznych
    for (const [edge, side] of [[pit.s0, -1], [pit.s1, 1]]) {
      for (let k = 0; k < 5; k++) {
        const v = pit.v1 - 60 - ((pit.v1 - pit.v0 - 140) * k) / 4;
        f.fx(1.3, PB_FX.fill, (k + 0.5) / 5, chP);
        T.box(edge + S(side * 26), v, H.deck + 18, 18, 8, 26, M.warm);
        f.nofx();
      }
    }
    // żurawiki amunicyjne na koronie ściany tylnej (wysięgnik nad tylną częścią doku, nie nad wylotem)
    for (const o of [-1, 1]) {
      const s = pit.sc + S(o * Math.min(140, (pit.w / 2) * 0.55));
      T.box(s, pit.v1 + 50, H.deck + 40, 40, 80, 40, M.yellow);
      T.box(s, pit.v1 - 40, H.deck + 84, 22, 14, 200, M.yellow);
      T.box(s, pit.v1 - 120, H.deck + 50, 30, 50, 30, M.orange);
    }
    // palety amunicji przy ścianie tylnej
    for (let k = 0; k < 4; k++) T.box(pit.sc + S((k - 1.5) * 70), pit.v1 + 150, H.deck + 18, 50, 24, 60, k % 2 ? M.orange : M.teal);
    T.label(pit.id.split('-').pop(), pit.sc, pit.v1 + 280, pit.cls === 'l' ? 420 : 300, 90, style.labels.capital, `UZBRAJANIE · ${NAME[pit.cls]}`, H.deck + 12);
    // galeria podajnika amunicji: od ściany tylnej doku do kolektora przy polu bunkrów
    const gv0 = pit.v1 + 340;
    const gv1 = BK.v0 + 180;
    T.box(pit.sc, (gv0 + gv1) / 2, H.deck + 24, 70, 44, gv1 - gv0, M.steel);
    T.box(pit.sc, (gv0 + gv1) / 2, H.deck + 48, 40, 6, gv1 - gv0 - 20, M.rail);
    const n = Math.max(3, Math.round((gv1 - gv0) / 260));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      T.lamp(pit.sc, gv1 - (gv1 - gv0) * t, H.deck + 54, 12, M.warm, 1.0, PB_FX.chase, t, 0.5);
    }
    // magazyn podręczny na drodze podajnika (amunicja na jedno uzbrojenie)
    const mv = pit.v1 + 980;
    T.box(pit.sc, mv, H.deck + 32, 300, 64, 280, M.steel);
    T.box(pit.sc, mv + 10, H.deck + 68, 260, 8, 230, M.rail);
    T.box(pit.sc, mv - 146, H.deck + 28, 140, 50, 12, M.yellow);
    T.hazardRun(pit.sc - S(100), pit.sc + S(100), mv - 175, H.deck + 8, 26);
    T.lamp(pit.sc + S(110), mv + 100, H.deck + 80, 12, M.red, 1.5, PB_FX.blink, pbHash1(i * 4.7), 0.5);
    docks.push({ index: i, berthId: pit.berth.id, cls: pit.cls, chS, chP });
  });
  // lico doków od drogi: światła biegnące (ruch ku +s po stronie rzędu zewnętrznego)
  // kolektor podajników wzdłuż pola bunkrów
  T.run(MZ.a + 1500, MZ.b - 100, BK.v0 + 180, H.deck + 24, 44, 80, M.steel, 400);
  T.run(MZ.a + 1500, MZ.b - 100, BK.v0 + 180, H.deck + 48, 6, 46, M.rail, 400);

  // --- pole bunkrów: bunkry z drzwiami ku podajnikowi, wały między kolumnami i rzędami, koguty, numery
  const list = bunkerGrid();
  list.forEach((b, i) => {
    const sv = ringScale(b.v);
    const S = (d) => d / sv;
    T.box(b.s, b.v, H.deck + 36, 420, 72, 480, M.steel);
    T.box(b.s, b.v + 10, H.deck + 76, 370, 8, 420, M.rail);
    for (const o of [-1, 1]) T.cyl(b.s + S(o * 110), b.v + 120, H.deck + 92, 18, 26, M.rail);
    T.box(b.s, b.v - 246, H.deck + 30, 190, 56, 14, M.yellow);
    T.hazardRun(b.s - S(120), b.s + S(120), b.v - 290, H.deck + 8, 34);
    T.lamp(b.s + S(150), b.v + 180, H.deck + 90, 14, M.red, 1.5, PB_FX.blink, pbHash1(i * 2.3), 0.5);
    T.label(`B-${String(i + 1).padStart(2, '0')}`, b.s, b.v - 40, 260, 80, style.labels.capital, goodsName[b.goods], H.deck + 84);
  });
  // wały: ściany wybuchowe między kolumnami (promieniowo) i między rzędami (wzdłuż łuku)
  const cols = [...new Set(list.filter((b) => b.col >= 0).map((b) => b.s))].sort((p, q) => p - q);
  for (let c = 0; c + 1 < cols.length; c++) {
    const s = (cols[c] + cols[c + 1]) / 2;
    T.box(s, 8310, H.deck + 60, 40, 120, 3700, M.steel);
    T.box(s, 8310, H.deck + 122, 26, 6, 3680, M.rail);
  }
  for (const v of [7340, 8220, 9100]) {
    for (let c = 0; c < cols.length; c++) T.box(cols[c], v, H.deck + 46, 360, 92, 36, M.steel);
  }
  hazardFrame(T, BK.hangarB + 40, MZ.b - 40, BK.v0 + 300, 9950, H.deck + 7, 40);
  T.label('SKŁAD AMUNICJI', (BK.hangarB + MZ.b) / 2, 10170, 1800, 190, style.labels.capital, 'MATERIAŁY WYBUCHOWE · STREFA ZAMKNIĘTA', H.deck + 10);
  post(T, f, 5800, 9540, 61);
  post(T, f, BK.hangarB + 120, 10420, 62);

  // --- hangar myśliwców z importu (wylot w przestrzeń): pole siłowe i lampy z pitDetail, myśliwce przy ścianach
  for (const pit of layout.pits.filter((p) => p.zone === 'ZB' && p.kind === 'hangar')) {
    pitDetail(T, f, pit, { lamps });
    const sw = ringScale(pit.vc);
    const S = (d) => d / sw;
    for (const side of [-1, 1]) {
      const sx = (side < 0 ? pit.s0 : pit.s1) - S(side * 160);
      for (let k = 0; k < 6; k++) {
        const v = pit.v0 + 380 + k * 300;
        T.box(sx, v, 30, 46, 14, 120, M.steel);
        T.box(sx, v + 10, 32, 130, 6, 46, M.rail);
        T.box(sx, v - 30, 40, 24, 8, 30, M.glass);
      }
    }
    T.label('HANGAR MYŚLIWCÓW', pit.sc, 8180, 900, 150, style.labels.berthLead, 'IMPORT · WENUS · SATURN', H.deck + 12);
  }

  // --- nabrzeże amunicyjne (pas MEGA): światła, palce, posterunki na palcach, żurawie wyładunkowe (FG, na wieżach)
  megaDetail(T, f, layout, 'ZB', style, () => -1);
  const lane = layout.megaLanes[0];
  T.hazardRun(lane.sc - lane.sHalf - 200 / ringScale(BK.v1), lane.sc + lane.sHalf + 200 / ringScale(BK.v1), BK.v1 - 30, H.deck + 8, 40);
  for (const fg of layout.fingers) post(T, f, fg.sc, BK.v1 - 120, fg.sc, true);
  f.set = 'fg';
  for (const o of [-0.45, 0.45]) {
    const s = lane.sc + o * lane.sHalf;
    T.box(s, BK.v1 - 140, H.deck + 170, 70, 340, 70, M.yellow);
    T.box(s, BK.v1 + 300, H.over + 140, 50, 30, 900, M.yellow);
    T.box(s, BK.v1 + 300, H.over + 160, 30, 8, 860, M.rail);
    T.box(s, BK.v1 - 300, H.over + 130, 80, 50, 120, M.steel);
    T.lamp(s, BK.v1 + 740, H.over + 160, 14, M.red, 1.6, PB_FX.blink, o > 0 ? 0.5 : 0, 0.6);
  }
  f.set = 'bg';
  T.label('NABRZEŻE AMUNICYJNE', lane.sc, BK.v1 - 250, 1400, 150, style.labels.capital, 'STREFA STRZEŻONA · IMPORT AMUNICJI', H.deck + 10);
  // koguty wzdłuż lica od przestrzeni
  for (let s = BK.hangarB + 300; s < MZ.b - 100; s += 650) T.lamp(s, BK.v1 - 20, H.deck + 22, 16, M.red, 1.4, PB_FX.blink, (s / 650) % 1, 0.5);

  // --- wieże obrony punktowej strzegące składu (grupy 1…4, obrót w czasie)
  const guards = [];
  [[BK.hangarB + 120, 9000], [5880, 10450], [BK.hangarB + 120, 6900], [2700, 10450]].forEach(([s, v], i) => {
    T.box(s, v, H.deck + 8, 220, 16, 220, M.rail);
    f.group = i + 1;
    turret(T, f, s, v, 'pd', 0.8, H.deck + 16);
    f.group = 0;
    const [px, pz] = yardPoint(s, v);
    guards.push({ group: i + 1, s, v, px, pz });
  });

  // --- ekspedycja przy ringu: rampy na licu (wjazd z zatok), pas straży
  for (const bay of layout.truckBays) if (bay.side < 0 && bay.s > MZ.a) T.box(bay.s, V.inner1 - 60, H.deck + 12, 260, 20, 90, M.rail);
  pushLamp(lamps, 1600, 4300, 420, 1);
  pushLamp(lamps, 4600, 4300, 420, 1);
  pushLamp(lamps, 3900, 8300, 480, 1);
  pushLamp(lamps, lane.sc, BK.v1 + 300, 520, 2);
  return sceneOf(f, plates, labels, lamps, { docks, guards });
}
