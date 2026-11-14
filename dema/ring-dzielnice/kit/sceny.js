// DZIELNICE RINGU — zestaw wspólny, BRYŁY (dane instancji zestawu budowli portowych, bez three).
//
// Narzędzia i gotowe elementy z dema portu (dema/stocznia-ringu/scene.js, sceneTri.js) pod jedną nazwą oraz to, co
// każda dzielnica ma takie samo: droga z kratownicą, zatoki ciężarówek, przystanki kolei. Dzielnica buduje tylko
// SWOJE budowle; ścianę ringu i drogę dokłada gospodarz dema.
//
// Dwa zestawy narzędzi:
//   • po łuku (s, v): `arcTools(f, plates, labels)` → T.box / seg / run / cyl / pipe / pipeRun / beam / lamp / sec /
//     hazardRun / hazardRad / chevron / label — bryły rzędów wzdłuż ringu;
//   • w układzie lokalnym (x, z) z kierunkiem: `xzTools(f, plates, labels)` → Q.box / seg / pipe / beam / cyl / lamp /
//     plate / label — bryły proste, odstające od ringu pod dowolnym kątem.
// Wysokości jak w K-7 (y nad pokładem): płaszczyzna lotu y = 116, kadłub 48…116; `YARD_H` — poziomy portu.
import { PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbHash1, pbLabel, pbPlate } from '../../../src/3d/portBuildings/portBuildingScene.js';
import { k7HeightToZ } from '../../../src/3d/haloRing/haloPortK7Layout.js';
import {
  TOP_MATS, YARD_H, YARD_STATUS_CHANNELS, bodies, buildBandScene, buildHangarRoofScene, chaseRow, controlBlock, greebles, lintel,
  megaDetail, newScene, pitDetail, pitDetailRad, pushLamp, sceneOf, spire, tools
} from '../../stocznia-ringu/scene.js';
import { faceTrim, greebleXZ, lintelXZ, outerTrim, pitDetailXZ, spireXZ, stations, truss, xz } from '../../stocznia-ringu/sceneTri.js';
import { RING_V, ringScale } from './uklad.js';

export {
  PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbHash1, pbLabel, pbPlate, k7HeightToZ,
  TOP_MATS, YARD_H, YARD_STATUS_CHANNELS, bodies, buildBandScene, buildHangarRoofScene, chaseRow, controlBlock, greebles, lintel,
  megaDetail, newScene, pitDetail, pitDetailRad, pushLamp, sceneOf, spire,
  faceTrim, greebleXZ, lintelXZ, outerTrim, pitDetailXZ, spireXZ, stations, truss
};
export const arcTools = tools;
export const xzTools = xz;

const M = PB_MAT;
const H = YARD_H;

/**
 * Zatoka ciężarówek na poboczu drogi przy licu rzędu (rysowana w budowli drogi): półka pod zestawem, pasy na
 * krawędzi, światła naprowadzania (zielone — dostawa, bursztynowe — odbiór), dwa wysięgniki przeładunkowe (FG), napis.
 */
export function truckBayDetail(T, f, bay, style) {
  const sw = ringScale(bay.vFace);
  const half = bay.len / 2 / sw;
  const out = -bay.side;                       // od lica ku osi drogi (znak v)
  const a = bay.s - half;
  const b = bay.s + half;
  T.run(a, b, bay.vFace + out * 55, 16, 10, 110, M.dark, 400, 1.0);
  T.run(a, b, bay.vFace + out * 108, 22, 3, 8, M.yellow, 400, 1.0);
  T.run(a, b, bay.vFace + out * 4, 70, 26, 6, M.rail, 400, 1.0);
  const lampMat = bay.dir === 'in' ? M.green : M.warm;
  for (let k = 0; k < 6; k++) T.lamp(a + ((b - a) * (k + 0.5)) / 6, bay.vFace + out * 104, 30, 12, lampMat, 1.2, PB_FX.chase, bay.side > 0 ? 1 - k / 6 : k / 6, 0.8);
  f.set = 'fg';
  for (const t of [0.25, 0.75]) {
    const s = a + (b - a) * t;
    T.box(s, bay.vFace - out * 40, H.deck + 45, 34, 90, 34, M.steel);
    T.seg(s, bay.vFace - out * 40, s, bay.vFace + out * 120, H.deck + 84, 12, 20, M.yellow);
    T.lamp(s, bay.vFace + out * 116, H.deck + 74, 12, M.white, 1.3);
  }
  f.set = 'bg';
  if (bay.label) T.label(bay.label, bay.s, bay.vFace - out * 120, Math.min(bay.len * 0.9, 420), 70, style.labels.clear, bay.dir === 'in' ? 'DOSTAWA' : 'ODBIÓR');
}

/**
 * Przystanek kolei na kratownicy pod drogą (rysowany w budowli drogi): peron na poziomie kratownicy od jej burty do
 * lica rzędu, światła krawędzi, skrzynie, dwie windy towarowe do budynku przy licu, napis na peronie.
 */
export function railStopDetail(T, f, stop, style) {
  const V = RING_V;
  const yt = H.spineTop;
  const side = stop.side;
  const sw = ringScale(V.road);
  const half = stop.len / 2 / sw;
  const a = stop.s - half;
  const b = stop.s + half;
  const v0 = V.road + side * 215;              // krawędź peronu przy kratownicy
  const v1 = V.road + side * (V.roadW / 2 - 12);
  const vm = (v0 + v1) / 2;
  T.run(a, b, vm, yt - 14, 28, Math.abs(v1 - v0), M.dark, 460, 1.0);
  T.run(a, b, vm, yt + 2, 4, Math.abs(v1 - v0) - 60, M.steel, 460, 1.0);
  T.run(a, b, v0 + side * 8, yt + 8, 8, 12, M.yellow, 460, 1.0);
  const n = Math.max(4, Math.round(stop.len / 150));
  for (let k = 0; k <= n; k++) T.lamp(a + ((b - a) * k) / n, v0 + side * 30, yt + 12, 14, M.cyan, 1.25, PB_FX.chase, k / (n + 1), 0.8);
  // ładunek na peronie i windy do budynku
  const CR = [M.orange, M.teal, M.pale, M.yellow, M.steel];
  const m = Math.max(3, Math.round(stop.len / 130));
  for (let k = 0; k < m; k++) {
    const s = a + ((b - a) * (k + 0.5)) / m;
    const h = pbHash1(stop.s * 0.01 + k * 1.7);
    if (h < 0.3) continue;
    T.box(s, vm + side * (h - 0.5) * 300, yt + 26, 70 + 40 * h, 40, 60, CR[Math.floor(h * 97) % CR.length]);
  }
  for (const t of [0.2, 0.8]) {
    const s = a + (b - a) * t;
    T.box(s, v1 - side * 70, (yt + 30) / 2, 150, 30 - yt, 130, M.steel);
    T.box(s, v1 - side * 70, 34, 120, 6, 100, M.yellow);
    T.lamp(s, v1 - side * 150, yt + 30, 16, stop.dir === 'in' ? M.green : M.warm, 1.4, PB_FX.blink, t, 0.8);
  }
  for (let k = 0; k <= 3; k++) T.beam([a + ((b - a) * k) / 3, v0 + side * 60, yt - 28], [a + ((b - a) * k) / 3, V.road + side * 110, H.spineBottom], 18, M.rail);
  if (stop.label) T.label(stop.label, stop.s, vm, Math.min(stop.len * 0.8, 700), 110, style.labels.clear, stop.dir === 'in' ? 'KOLEJ · DOSTAWA' : 'KOLEJ · ODBIÓR', yt + 6);
}

/**
 * Droga dzielnicy: kratownica z rurami pod płaszczyzną lotu na całej długości `layout.extent` (ciągnie się dalej po
 * ringu), światła osi i pasów, bramownice nad drogą (FG) co ~3 100 j. w obrębie dzielnicy (pomija `layout.openings`
 * i `lintelSkip`: [[s0, s1], …]), zatoki ciężarówek i przystanki kolei z `layout`.
 */
export function buildDistrictRoadScene(layout, style, { lintelSkip = [] } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const V = layout.v;
  const vc = V.road;
  // zakres kratownicy: cały łuk złożenia (`roadMin`…`roadMax`) albo ±extent pojedynczej dzielnicy
  const A = layout.roadMin ?? -layout.extent;
  const B = layout.roadMax ?? layout.extent;
  const yt = H.spineTop;
  const yb = H.spineBottom;
  const ym = (yt + yb) / 2;
  const step = 460;
  const n = Math.ceil((B - A) / step);
  for (const side of [-1, 1]) {
    T.run(A, B, vc + side * 190, yt, 46, 46, M.steel, step);
    T.run(A, B, vc + side * 110, yb, 40, 40, M.dark, step);
  }
  for (let k = 0; k <= n; k++) {
    const s = A + ((B - A) * k) / n;
    T.box(s, vc, yt, 30, 30, 380, M.steel);
    T.box(s, vc, yb, 26, 26, 220, M.dark);
    for (const side of [-1, 1]) T.beam([s, vc + side * 190, yt], [s, vc + side * 110, yb], 22, M.dark);
    if (k < n) {
      const s2 = A + ((B - A) * (k + 1)) / n;
      for (const side of [-1, 1]) T.beam([s, vc + side * 190, yt], [s2, vc + side * 110, yb], 16, M.rail);
      T.beam(k % 2 ? [s, vc - 190, yt] : [s, vc + 190, yt], k % 2 ? [s2, vc + 190, yt] : [s2, vc - 190, yt], 14, M.rail);
    }
  }
  T.pipeRun(A, B, vc + 60, ym + 40, 26, M.copper, step);
  T.pipeRun(A, B, vc - 60, ym + 10, 18, M.hose, step);
  T.pipeRun(A, B, vc + 130, ym + 70, 12, M.pale, step);
  for (let s = A + 900; s < B - 600; s += 2300) {
    T.pipe(s - 260, vc - 20, s + 260, vc - 20, ym - 30, 62, M.pale);
    T.box(s - 300, vc - 20, ym - 30, 30, 150, 150, M.dark);
    T.box(s + 300, vc - 20, ym - 30, 30, 150, 150, M.dark);
  }
  // światła drogi: oś (białe kreski) i dwa pasy (ruch prawostronny: przy ringu ku −s zielone, od przestrzeni ku +s bursztynowe)
  const m = Math.round((B - A) / 240);
  for (let i = 0; i <= m; i++) {
    const s = A + ((B - A) * i) / m;
    if (i % 2 === 0) { f.fx(0.95, PB_FX.steady); T.box(s, vc, yt + 28, 90, 6, 10, M.white); f.nofx(); }
    const t = (i / m) * ((B - A) / 1450);
    T.lamp(s, vc + RING_V.laneOff, yt + 30, 14, M.warm, 1.15, PB_FX.chase, 1 - (t % 1), 0.7);
    T.lamp(s, vc - RING_V.laneOff, yt + 30, 14, M.green, 1.15, PB_FX.chase, t % 1, 0.7);
  }
  // bramownice nad drogą (FG)
  const skip = lintelSkip.concat((layout.openings || []).map((o) => [o.s0 - 500, o.s1 + 500]));
  let gi = 0;
  for (let s = layout.sMin + 1300; s <= layout.sMax - 1300; s += 3100) {
    if (skip.some(([a, b]) => s > a && s < b)) continue;
    lintel(T, f, s, V.inner1 - 120, s, V.outer0 + 120, 90, [
      { t0: 0.2, t1: 0.4, mat: M.green, gain: 1.0 },
      { t0: 0.6, t1: 0.8, mat: M.warm, gain: 1.0 }
    ], 90 + gi++);
  }
  for (const bay of layout.truckBays || []) truckBayDetail(T, f, bay, style);
  for (const stop of layout.railStops || []) railStopDetail(T, f, stop, style);
  return sceneOf(f, plates, labels, lamps);
}
