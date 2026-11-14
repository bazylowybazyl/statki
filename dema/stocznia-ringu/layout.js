// Port przy ringu z DROGĄ w środku i STOCZNIĄ (koncept, demo `dema/stocznia-ringu.html`) — GEOMETRIA jednego kompleksu
// portu Ziemi. Czysta matematyka (bez three i DOM): z tych samych liczb powstają bryły obrazu (scene.js), kolizje lotu
// i test `tests/stoczniaRingu.test.mjs`.
//
// Układ (decyzje użytkownika 2026-11-12 po obejrzeniu v1): wszystko dociśnięte do ringu i do siebie, bez szpar —
//   ściana ringu | rząd doków przy ringu | DROGA (nad kręgosłupem z rurami) | rząd zewnętrzny | przestrzeń.
// Do doków wjeżdża się z drogi (od strony ringu), nie z przestrzeni. Hala K-7 przebudowana na WJAZD: brama w rzędzie
// zewnętrznym z dwoma pasami i wyspą. Okręty wojskowe stoją w ogromnym SUCHYM DOKU FLOTY (basen z wylotem na drogę).
// Końce drogi są otwarte (wyloty). Pasy MEGA zostają przy licu zewnętrznym (megafrachtowiec nie skręci w drogę).
//
// STOCZNIA (lewy koniec kompleksu) — miejsce budowy i refitu, większe i dalej w przestrzeń niż doki:
//   hala stoczni przy drodze (od strony drogi doki REFITU), z jej lica zewnętrznego wychodzi WACHLARZ LINII BUDOWY —
//   proste pochylnie promieniowo w przestrzeń (S, M, L, nosiciel, capital; capital sięga ~9 tys. j. od hali).
//   Technologia: linia taktowa. Na każdej linii kilka stanowisk; kadłub powstaje na stanowisku przy hali pod
//   drukarką-bramownicą (szkielet), potem co takt przesuwa się o stanowisko dalej (poszycie, wyposażenie), a z końca
//   linii gotowy okręt odlatuje w przestrzeń. Między liniami alejki do przelotu (od strony przestrzeni).
//
// Układ lokalny (x, z) = przesunięcie w płaszczyźnie gry: x w prawo (styczna w osi wjazdu), z na zewnątrz ringu
// (w dół ekranu). Środek ringu leży w (0, −R0). Współrzędne łuku: s — długość łuku na promieniu R0 (krawędź ścian
// ringu), v — odległość promieniowa od R0 (v < 0 = ring, v > 0 = port i przestrzeń). Długości wzdłuż łuku rosną
// z promieniem (× (R0 + v) / R0) — budowle rozchylają się wachlarzem.
import { BERTH_CLASSES } from '../../src/data/portDocks.js';
import { YARD_TRI, buildYardTri } from './yardTri.js';

export { YARD_TRI };

export const YARD_RING = Object.freeze({
  rim: 43752,            // krawędź ścian ringu Ziemi (createHaloRingLayout().radii.rim)
  bandDepth: 1500,       // widoczny pas ściany ringu (zastępczy)
  innerT: 1000,          // rząd przy ringu (wnęki S / M / L)
  roadW: 2600,           // droga: dwa pasy po 1300; Atlas (1800 × 806, przekątna 1972) obraca się w miejscu
  outerT: 2700,          // rząd zewnętrzny (doki capital 2300 w głąb)
  sMin: -26000,          // lewy koniec kompleksu (koniec stoczni)
  sMax: 17500,           // prawy koniec kompleksu
  yardS: -9500,          // granica: stocznia | doki cywilne
  gateHalf: 1500,        // wjazd: otwór 3000 — dwa pasy po 1350 i wyspa 300
  island: Object.freeze({ half: 150, v0: 500, v1: 2300 }),       // wyspa wjazdu (v od lica drogi rzędu zewnętrznego)
  basin: Object.freeze({ s0: 1500, s1: 12500, side: 1000, front: 700, lane: 2300, slip: 2300, back: 300, mouthHalf: 1300 }),
  yard: Object.freeze({ headT: 2500, margin: 300, gap: 1400 }),  // hala stoczni; odstęp linii przy hali (alejka)
  megaOff: 650,          // oś pasa MEGA od lica zewnętrznego
  fingerW: 220,
  fingerD: 700,
  extent: 36000,         // pół długości pasa ringu i kręgosłupa w demie (łuk)
  maxPiece: 900          // najdłuższy kawałek łuku jako jeden wielokąt (strzałka ~2 j.)
});

/** Doki: szerokość wylotu i głębokość wycięcia (pole klasy + luz). `carrier` — stanowisko nosiciela floty. */
export const YARD_PITS = Object.freeze({
  s: Object.freeze({ w: 270, d: 300 }),
  m: Object.freeze({ w: 450, d: 520 }),
  l: Object.freeze({ w: 580, d: 840 }),
  carrier: Object.freeze({ w: 720, d: 1400 }),
  capital: Object.freeze({ w: 1250, d: 2300 })
});
/** Pola stanowisk (długość × szerokość). */
export const YARD_BERTH = Object.freeze({
  ...BERTH_CLASSES,
  carrier: Object.freeze({ id: 'carrier', rank: 2.5, length: 1150, width: 460, label: 'NOS' })
});

/**
 * Linie budowy stoczni (od lewej): szerokość pochylni, podziałka stanowisk, liczba stanowisk (ostatnie = odbiór
 * gotowego okrętu), takt [s] i kadłuby budowane na zmianę (id z TRAFFIC_HULLS).
 */
export const YARD_LINES = Object.freeze([
  Object.freeze({ cls: 's', width: 340, pitch: 330, stations: 6, takt: 18, hulls: ['terran_frigate', 'inter_station_shuttle', 'terran_frigate', 'police_cutter'] }),
  Object.freeze({ cls: 'm', width: 480, pitch: 520, stations: 6, takt: 24, hulls: ['terran_destroyer', 'container_ship'] }),
  Object.freeze({ cls: 'l', width: 660, pitch: 900, stations: 6, takt: 32, hulls: ['terran_battleship', 'long_haul_freighter'] }),
  Object.freeze({ cls: 'capital', width: 1500, pitch: 2300, stations: 4, takt: 56, hulls: ['heavy_freighter'] }),
  Object.freeze({ cls: 'carrier', width: 950, pitch: 1500, stations: 5, takt: 44, hulls: ['terran_carrier'] }),
  Object.freeze({ cls: 'capital', width: 1500, pitch: 2300, stations: 4, takt: 60, hulls: ['heavy_freighter'] }),
  Object.freeze({ cls: 'l', width: 660, pitch: 900, stations: 6, takt: 34, hulls: ['tanker', 'terran_battleship'] }),
  Object.freeze({ cls: 'm', width: 480, pitch: 520, stations: 6, takt: 26, hulls: ['heavy_harvester', 'terran_destroyer'] }),
  Object.freeze({ cls: 's', width: 340, pitch: 330, stations: 6, takt: 20, hulls: ['belter', 'terran_frigate', 'crew_shuttle'] })
]);

/**
 * Wariant Jowisza (decyzja użytkownika 2026-11-12: linia taktowa zostaje dla Jowisza jako prosta „fabryka” —
 * krótsze taśmy i wolniejsze schodzenie z taśmy): mniej stanowisk na linii, takt × 2,5.
 */
export const YARD_LINES_JUPITER = Object.freeze(YARD_LINES.map((d) => Object.freeze({
  ...d, stations: d.cls === 'capital' || d.cls === 'carrier' ? 3 : 4, takt: Math.round(d.takt * 2.5)
})));

const Y = YARD_RING;
export const YARD_R0 = Y.rim;
const R0 = YARD_R0;
const scale = (v) => (R0 + v) / R0;

/** Kąt łuku dla s (rad), punkt (s, v) → [x, z], kursy: styczny (+s) i promieniowy (+v). */
export const yardPhi = (s) => s / R0;
export function yardPoint(s, v, out = [0, 0]) {
  const p = s / R0;
  const r = R0 + v;
  out[0] = r * Math.sin(p);
  out[1] = r * Math.cos(p) - R0;
  return out;
}
export const yardTangent = (s) => -s / R0;
export const yardRadial = (s) => Math.PI / 2 - s / R0;
/** Punkt lokalny (x, z) → { s, v }. */
export function yardToArc(x, z, out = {}) {
  const zz = z + R0;
  out.s = Math.atan2(x, zz) * R0;
  out.v = Math.hypot(x, zz) - R0;
  return out;
}

function sector(s0, s1, v0, v1) {
  return [yardPoint(s0, v0), yardPoint(s1, v0), yardPoint(s1, v1), yardPoint(s0, v1)];
}

// Rodzaje doków w rzędach: 'drydock' — suchy dok capital otwarty z góry, 'hangar' — dok capital pod dachem z polem
// siłowym, 'slip' — stanowisko capital w suchym doku floty, 'refit' — dok refitu capital w hali stoczni; reszta = klasa.
const pitClass = (k) => (k === 'drydock' || k === 'hangar' || k === 'slip' || k === 'refit' ? 'capital' : k);
const LETTER = { s: 'S', m: 'M', l: 'L', carrier: 'N', drydock: 'D', hangar: 'H', slip: 'C', refit: 'R' };

const INNER_UNIT = ['m', 's', 's', 'm', 'l'];
const INNER_RIGHT = [...INNER_UNIT, ...INNER_UNIT, ...INNER_UNIT, ...INNER_UNIT, ...INNER_UNIT];
const INNER_LEFT = ['l', 'm', 's', 's', 'm', 'l', 'm', 's', 's', 'm', 'l', 'm', 's'];
const OUTER_LEFT = ['l', 'l', 'drydock', 'l', 'l', 'hangar', 'l', 'l'];
const OUTER_RIGHT = ['l', 'drydock', 'l', 'l'];
const BASIN_BACK = ['carrier', 'carrier', 'slip', 'slip', 'slip', 'carrier', 'carrier'];
const BASIN_FLANK = ['s', 'm', 's', 's', 'm', 's', 's'];
// hala stoczni od strony drogi: doki refitu (capital, L, M); rząd przy ringu w stoczni: dostawy i refit małych
const YARD_HEAD = ['m', 'l', 'l', 'refit', 'l', 'm', 'm', 'l', 'refit', 'l', 'l', 'm', 'm', 'l', 'refit', 'l', 'm'];
const YARD_INNER = ['l', 'm', 'm', 'l', 's', 's', 'l', 'm', 'm', 'l', 's', 's', 'l', 'm'];
// wariant ziemski: hala przecięta skrzyżowaniem z ulicą stoczni
const YARD_HEAD_LEFT = ['m', 'l', 'refit', 'l', 'l', 'refit', 'm'];
const YARD_HEAD_RIGHT = ['m', 'l', 'refit', 'l', 'm', 'l', 'm'];

/**
 * Układ kompleksu. `yard`: 'earth' — stocznia „ość” (trzon odstający od hali i ramiona na boki, żurawie i drony),
 * 'jupiter' — fabryka taśmowa (wachlarz krótkich linii taktowych z drukarką-bramownicą).
 */
export function buildYardRingLayout({ yard: yardKind = 'earth' } = {}) {
  const solids = [];      // { id, tag, zone, points: [[x, z] × n] } — wypukłe, kolizje i korpusy
  const pieces = [];      // kawałki korpusów: { zone, bar, orient, s0, s1, v0, v1, pit, face }
  const pits = [];        // doki: { id, kind, cls, zone, orient, s0, s1, v0, v1, sc, vc, open, berth }
  const berths = [];      // { id, cls, kind, zone, navy, yard, x, z, heading, length, width, s, v }
  const megaLanes = [];
  const fingers = [];
  const counters = {};

  const vI0 = 0;
  const vI1 = Y.innerT;
  const vO0 = vI1 + Y.roadW;
  const vO1 = vO0 + Y.outerT;
  const Bz = Y.basin;
  const vFront1 = vO0 + Bz.front;            // lico basenu belki przy drodze
  const vLane1 = vFront1 + Bz.lane;          // koniec placu manewrowego = wyloty stanowisk przy ścianie tylnej
  const vBack0 = vLane1 + Bz.slip;
  const vBack1 = vBack0 + Bz.back;
  const bIn0 = Bz.s0 + Bz.side;              // wnętrze basenu wzdłuż łuku
  const bIn1 = Bz.s1 - Bz.side;
  const mouthC = (bIn0 + bIn1) / 2;
  const mouth0 = mouthC - Bz.mouthHalf;
  const mouth1 = mouthC + Bz.mouthHalf;
  const vHead1 = vO0 + Y.yard.headT;         // lico zewnętrzne hali stoczni — początek linii budowy

  const addSolid = (id, tag, zone, points) => solids.push({ id, tag, zone, points });
  function nextId(zone, kind) {
    const k = `${zone}:${LETTER[kind]}`;
    counters[k] = (counters[k] || 0) + 1;
    return `${zone}-${LETTER[kind]}${counters[k]}`;
  }
  function addBerth(pit, cls, kind, zone, s, v, heading, flags) {
    const C = YARD_BERTH[cls];
    const [x, z] = yardPoint(s, v);
    const berth = { id: pit.id, cls, kind, zone, navy: !!flags.navy, yard: !!flags.yard, s, v, x, z, heading, length: C.length, width: C.width };
    pit.berth = berth;
    berths.push(berth);
  }

  /**
   * Belka wzdłuż łuku (s od a do b, v od v0 do v1) z dokami wyciętymi od jednej krawędzi: `open` = +1 dok otwarty
   * ku +v, −1 ku −v. Szerokości doków liczone na węższym końcu wycięcia (pole mieści się na całej głębokości).
   */
  function arcBar({ zone, bar, a, b, v0, v1, row, open, navy = false, yard = false }) {
    const defs = row.map((kind) => {
      const cls = pitClass(kind);
      const P = YARD_PITS[cls];
      return { kind, cls, P, ws: P.w / scale(open > 0 ? v1 - P.d : v0) };
    });
    let wsum = 0;
    for (const d of defs) wsum += d.ws;
    const wall = (b - a - wsum) / (defs.length + 1);
    const cuts = [];
    let cur = a + wall;
    for (const d of defs) {
      const pv0 = open > 0 ? v1 - d.P.d : v0;
      const pv1 = open > 0 ? v1 : v0 + d.P.d;
      const sc = cur + d.ws / 2;
      const pit = {
        id: nextId(zone, d.kind), kind: d.kind, cls: d.cls, zone, bar, orient: 'arc', navy, yard,
        s0: cur, s1: cur + d.ws, v0: pv0, v1: pv1, sc, vc: (pv0 + pv1) / 2, w: d.P.w, open
      };
      // dziób przy ścianie tylnej doku, rufa w wylocie
      const C = YARD_BERTH[d.cls];
      const noseGap = d.cls === 'capital' || d.cls === 'carrier' ? 110 : 80;
      const bv = open > 0 ? pv0 + noseGap + C.length / 2 : pv1 - noseGap - C.length / 2;
      addBerth(pit, d.cls, d.kind, zone, sc, bv, open > 0 ? yardRadial(sc) + Math.PI : yardRadial(sc), { navy, yard });
      pits.push(pit);
      cuts.push({ a: cur, b: cur + d.ws, pit });
      cur += d.ws + wall;
    }
    const marks = [a, b];
    for (const c of cuts) marks.push(c.a, c.b);
    marks.sort((p, q) => p - q);
    for (let i = 0; i + 1 < marks.length; i++) {
      const p = marks[i];
      const q = marks[i + 1];
      if (q - p < 0.5) continue;
      const cut = cuts.find((c) => c.a <= p + 0.25 && c.b >= q - 0.25) || null;
      const n = Math.max(1, Math.ceil((q - p) / Y.maxPiece));
      for (let k = 0; k < n; k++) {
        const s0 = p + ((q - p) * k) / n;
        const s1 = p + ((q - p) * (k + 1)) / n;
        const pv0 = cut ? (open > 0 ? v0 : cut.pit.v1) : v0;
        const pv1 = cut ? (open > 0 ? cut.pit.v0 : v1) : v1;
        // `face` — krawędź od strony wylotów doków (lico drogi albo basenu): v i kierunek na zewnątrz bryły
        pieces.push({ zone, bar, orient: 'arc', s0, s1, v0: pv0, v1: pv1, pit: cut ? cut.pit : null, face: { v: open > 0 ? v1 : v0, sign: open } });
        addSolid(`${zone} ${bar}`, cut ? 'pit-back' : 'bar', zone, sector(s0, s1, pv0, pv1));
      }
    }
  }

  /**
   * Ściana promieniowa (s od a do b, v od v0 do v1) z dokami wyciętymi od jednej strony: `open` = +1 dok otwarty ku
   * +s, −1 ku −s. `list`: [{ kind, v }] — początek wylotu doku na osi v.
   */
  function radialBar({ zone, bar, a, b, v0, v1, list, open, navy = false }) {
    const cuts = [];
    for (const it of list) {
      const cls = pitClass(it.kind);
      const P = YARD_PITS[cls];
      const pv0 = it.v;
      const pv1 = it.v + P.w;
      const ds = P.d / scale((pv0 + pv1) / 2);
      const ps0 = open > 0 ? b - ds : a;
      const ps1 = open > 0 ? b : a + ds;
      const pit = {
        id: nextId(zone, it.kind), kind: it.kind, cls, zone, bar, orient: 'rad', navy, yard: false,
        s0: ps0, s1: ps1, v0: pv0, v1: pv1, sc: (ps0 + ps1) / 2, vc: (pv0 + pv1) / 2, w: P.w, open
      };
      const C = YARD_BERTH[cls];
      const vc = (pv0 + pv1) / 2;
      const off = (80 + C.length / 2) / scale(vc);
      const bs = open > 0 ? ps0 + off : ps1 - off;
      addBerth(pit, cls, it.kind, zone, bs, vc, open > 0 ? yardTangent(bs) + Math.PI : yardTangent(bs), { navy });
      pits.push(pit);
      cuts.push({ a: pv0, b: pv1, pit });
    }
    const marks = [v0, v1];
    for (const c of cuts) marks.push(c.a, c.b);
    marks.sort((p, q) => p - q);
    for (let i = 0; i + 1 < marks.length; i++) {
      const p = marks[i];
      const q = marks[i + 1];
      if (q - p < 0.5) continue;
      const cut = cuts.find((c) => c.a <= p + 0.25 && c.b >= q - 0.25) || null;
      const ps0 = cut ? (open > 0 ? a : cut.pit.s1) : a;
      const ps1 = cut ? (open > 0 ? cut.pit.s0 : b) : b;
      pieces.push({ zone, bar, orient: 'rad', s0: ps0, s1: ps1, v0: p, v1: q, pit: cut ? cut.pit : null, face: null });
      addSolid(`${zone} ${bar}`, cut ? 'pit-back' : 'bar', zone, sector(ps0, ps1, p, q));
    }
  }

  // --- rząd przy ringu (dociśnięty do ściany): stocznia (dostawy), doki cywilne, ślepa ściana naprzeciw wjazdu
  arcBar({ zone: 'YI', bar: 'inner', a: Y.sMin, b: Y.yardS, v0: vI0, v1: vI1, row: YARD_INNER, open: 1, yard: true });
  arcBar({ zone: 'IL', bar: 'inner', a: Y.yardS, b: -Y.gateHalf, v0: vI0, v1: vI1, row: INNER_LEFT, open: 1 });
  arcBar({ zone: 'IR', bar: 'inner', a: Y.gateHalf, b: Y.sMax, v0: vI0, v1: vI1, row: INNER_RIGHT, open: 1 });
  arcBar({ zone: 'IC', bar: 'junction', a: -Y.gateHalf, b: Y.gateHalf, v0: vI0, v1: vI1, row: [], open: 1 });

  // --- rząd zewnętrzny: hala stoczni, doki cywilne, wjazd w osi, suchy dok floty, dalej blok cywilny
  const yardSc = (Y.sMin + Y.yardS) / 2;
  // szerokość skrzyżowania z ulicą stoczni: na licu zewnętrznym hali równa szerokości ulicy
  const yardJ = YARD_TRI.streetW / 2 / scale(vHead1);
  if (yardKind === 'jupiter') {
    arcBar({ zone: 'YH', bar: 'head', a: Y.sMin, b: Y.yardS, v0: vO0, v1: vHead1, row: YARD_HEAD, open: -1, yard: true });
  } else {
    arcBar({ zone: 'YH', bar: 'head', a: Y.sMin, b: yardSc - yardJ, v0: vO0, v1: vHead1, row: YARD_HEAD_LEFT, open: -1, yard: true });
    arcBar({ zone: 'YH', bar: 'head', a: yardSc + yardJ, b: Y.yardS, v0: vO0, v1: vHead1, row: YARD_HEAD_RIGHT, open: -1, yard: true });
  }
  arcBar({ zone: 'OL', bar: 'outer', a: Y.yardS, b: -Y.gateHalf, v0: vO0, v1: vO1, row: OUTER_LEFT, open: -1 });
  arcBar({ zone: 'OR', bar: 'outer', a: Bz.s1, b: Y.sMax, v0: vO0, v1: vO1, row: OUTER_RIGHT, open: -1 });

  // --- wjazd: wyspa między pasami
  const island = { s0: -Y.island.half, s1: Y.island.half, v0: vO0 + Y.island.v0, v1: vO0 + Y.island.v1 };
  addSolid('WYSPA WJAZDU', 'island', 'GATE', sector(island.s0, island.s1, island.v0, island.v1));
  const gate = {
    s0: -Y.gateHalf, s1: Y.gateHalf, v0: vO0, v1: vO1, island,
    laneIn: { s: (Y.island.half + Y.gateHalf) / 2, half: (Y.gateHalf - Y.island.half) / 2 },     // wlot: prawy pas (ruch prawostronny)
    laneOut: { s: -(Y.island.half + Y.gateHalf) / 2, half: (Y.gateHalf - Y.island.half) / 2 }
  };

  // --- suchy dok floty: belka przy drodze z wylotem, ściany boczne z krążownikami, ściana tylna ze stanowiskami
  arcBar({ zone: 'B', bar: 'front', a: bIn0, b: mouth0, v0: vO0, v1: vFront1, row: BASIN_FLANK, open: 1, navy: true });
  arcBar({ zone: 'B', bar: 'front', a: mouth1, b: bIn1, v0: vO0, v1: vFront1, row: BASIN_FLANK.slice().reverse(), open: 1, navy: true });
  arcBar({ zone: 'B', bar: 'back', a: bIn0, b: bIn1, v0: vLane1, v1: vBack1, row: BASIN_BACK, open: -1, navy: true });
  const lGap = (Bz.lane - 3 * YARD_PITS.l.w) / 4;
  const sideList = [0, 1, 2].map((k) => ({ kind: 'l', v: vFront1 + lGap + k * (YARD_PITS.l.w + lGap) }));
  radialBar({ zone: 'B', bar: 'side', a: Bz.s0, b: bIn0, v0: vO0, v1: vBack1, list: sideList, open: 1, navy: true });
  radialBar({ zone: 'B', bar: 'side', a: bIn1, b: Bz.s1, v0: vO0, v1: vBack1, list: sideList, open: -1, navy: true });
  const basin = {
    s0: Bz.s0, s1: Bz.s1, in0: bIn0, in1: bIn1, mouth0, mouth1, mouthC,
    v0: vO0, front1: vFront1, lane1: vLane1, back0: vBack0, v1: vBack1, laneV: (vFront1 + vLane1) / 2
  };
  // stanowisko domowe Atlasa: środkowe stanowisko capital w osi wylotu
  const slips = pits.filter((p) => p.kind === 'slip');
  const home = slips.reduce((best, p) => (Math.abs(p.sc - mouthC) < Math.abs(best.sc - mouthC) ? p : best), slips[0]);
  home.home = true;
  home.berth.home = true;

  // --- pasy MEGA przy licu zewnętrznym (statek równolegle do lica), palce cumownicze
  const megaAt = (zone, sc, vFace) => {
    const C = YARD_BERTH.mega;
    const megaV = vFace + Y.megaOff;
    const ms = scale(megaV);
    const id = `${zone}-MG${megaLanes.filter((m) => m.zone === zone).length + 1}`;
    const [x, z] = yardPoint(sc, megaV);
    const berth = { id, cls: 'mega', kind: 'mega', zone, navy: false, yard: false, s: sc, v: megaV, x, z, heading: yardTangent(sc), length: C.length, width: C.width };
    berths.push(berth);
    megaLanes.push({ id, zone, sc, v: megaV, vFace, length: C.length, width: C.width, sHalf: C.length / 2 / ms, berth });
    for (const side of [-1, 1]) {
      const fs = sc + side * (C.length / 2 + 250) / ms;
      const hw = Y.fingerW / 2 / ms;
      const f = { id: `${id}-P${side > 0 ? 2 : 1}`, zone, sc: fs, s0: fs - hw, s1: fs + hw, v0: vFace - 30, v1: vFace + Y.fingerD };
      fingers.push(f);
      addSolid(f.id, 'finger', zone, sector(f.s0, f.s1, f.v0, f.v1));
    }
  };
  megaAt('OL', -7500, vO1);
  megaAt('OL', -3600, vO1);
  megaAt('OR', (Bz.s1 + Y.sMax) / 2, vO1);
  megaAt('B', mouthC, vBack1);

  // --- stocznia, wariant Jowisza: linie budowy — proste pochylnie promieniowo od lica hali w przestrzeń (wachlarz)
  const LINE_DEFS = yardKind === 'jupiter' ? YARD_LINES_JUPITER : [];
  const kHead = scale(vHead1);
  const span = (Y.yardS - Y.sMin - 2 * Y.yard.margin) * kHead;         // długość lica hali na jej promieniu
  let wsum = 0;
  for (const d of LINE_DEFS) wsum += d.width;
  const gapPhys = LINE_DEFS.length > 1 ? (span - wsum) / (LINE_DEFS.length - 1) : 0;
  const lines = [];
  let cur = 0;
  LINE_DEFS.forEach((d, i) => {
    const sc = Y.sMin + Y.yard.margin + (cur + d.width / 2) / kHead;
    cur += d.width + gapPhys;
    const phi = sc / R0;
    const rx = Math.sin(phi);          // promień (na zewnątrz)
    const rz = Math.cos(phi);
    const tx = Math.cos(phi);          // styczna (+s)
    const tz = -Math.sin(phi);
    const O = yardPoint(sc, vHead1 - 30);
    const len = d.pitch * d.stations + 30;
    const hw = d.width / 2;
    const at = (along, across) => [O[0] + rx * along + tx * across, O[1] + rz * along + tz * across];
    const line = {
      id: `ST-${i + 1}`, index: i, cls: d.cls, sc, phi, v0: vHead1, len: d.pitch * d.stations, width: d.width, pitch: d.pitch,
      stations: d.stations, takt: d.takt, hulls: d.hulls, heading: yardRadial(sc), O, rx, rz, tx, tz, at,
      // środek stanowiska k (0 = przy hali): odległość od lica hali wzdłuż osi linii
      stationAt: (k) => 30 + d.pitch * (k + 0.5)
    };
    lines.push(line);
    addSolid(`LINIA ${line.id}`, 'line', 'YL', [at(0, -hw), at(len, -hw), at(len, hw), at(0, hw)]);
  });
  // --- stocznia, wariant Ziemi: ulica z kratownicą od drogi ringu, obwodnica wokół trójkątnego suchego doku,
  // budowle zamykające od zewnątrz (yardTri.js)
  let tri = null;
  if (yardKind !== 'jupiter') {
    const phi = yardSc / R0;
    const rx = Math.sin(phi);          // oś ulicy (w przestrzeń)
    const rz = Math.cos(phi);
    const tx = Math.cos(phi);          // w poprzek (+s)
    const tz = -Math.sin(phi);
    const O = yardPoint(yardSc, vHead1 - 30);
    const at = (along, across) => [O[0] + rx * along + tx * across, O[1] + rz * along + tz * across];
    const aRoad = -(vHead1 - 30 - (vI1 + vO0) / 2);
    // oś drogi ringu od skrzyżowania ku portowi (+s): tędy kadłuby jadą kratownicą do doków
    const roadPts = [];
    for (let d = 300; d <= 9000; d += 150) roadPts.push(yardPoint(yardSc + d, (vI1 + vO0) / 2));
    const roadPoint = (d, off) => yardPoint(yardSc + d, (vI1 + vO0) / 2 + off);
    tri = buildYardTri({ at, PITS: YARD_PITS, BERTH: YARD_BERTH, addSolid, berths, aRoad, roadPts, roadPoint });
    tri.sc = yardSc;
    tri.phi = phi;
    tri.rx = rx;
    tri.rz = rz;
    tri.tx = tx;
    tri.tz = tz;
    tri.O = O;
    tri.aRoad = aRoad;
    tri.junctionHalf = yardJ;
    // punkt lokalny (x, z) → (wzdłuż ulicy od lica hali, w poprzek)
    tri.toLocal = (x, z, out = {}) => {
      const dx = x - O[0];
      const dz = z - O[1];
      out.along = dx * rx + dz * rz;
      out.across = dx * tx + dz * tz;
      return out;
    };
  }

  const yard = {
    kind: yardKind === 'jupiter' ? 'jupiter' : 'earth',
    s0: Y.sMin, s1: Y.yardS, v0: vO0, v1: vHead1, lines, gap: gapPhys, tri, sc: yardSc,
    tipV: vHead1 + (tri ? tri.far : Math.max(...lines.map((l) => l.len)))
  };

  // --- ściana ringu (pas zastępczy): kolizja po łuku
  const bandN = Math.ceil((2 * Y.extent) / Y.maxPiece);
  const band = [];
  for (let k = 0; k < bandN; k++) {
    const s0 = -Y.extent + ((2 * Y.extent) * k) / bandN;
    const s1 = -Y.extent + ((2 * Y.extent) * (k + 1)) / bandN;
    const seg = { s0, s1, v0: -Y.bandDepth, v1: 0 };
    band.push(seg);
    addSolid('ŚCIANA RINGU', 'ring', 'RING', sector(s0, s1, seg.v0, seg.v1));
  }

  const civil = berths.filter((b) => !b.navy && !b.yard);
  return {
    R0, solids, pieces, pits, berths, megaLanes, fingers, band, gate, basin, home, yard,
    sMin: Y.sMin, sMax: Y.sMax,
    v: { inner0: vI0, inner1: vI1, outer0: vO0, outer1: vO1, road: (vI1 + vO0) / 2 },
    counts: {
      civil: countBerths(civil), navy: countBerths(berths.filter((b) => b.navy)), yard: countBerths(berths.filter((b) => b.yard)),
      build: tri ? tri.slips.length : lines.reduce((n, l) => n + l.stations, 0)
    }
  };
}

function countBerths(list) {
  const out = { s: 0, m: 0, l: 0, carrier: 0, capital: 0, mega: 0 };
  for (const b of list) out[b.cls]++;
  return out;
}

/** Dzisiejszy kompleks portu Ziemi: hala K-7 (wojsko) i dwie zatoki (cywilne). */
export const YARD_TODAY = Object.freeze({
  civil: Object.freeze({ s: 8, m: 8, l: 8, carrier: 0, capital: 0, mega: 4 }),
  navy: Object.freeze({ s: 12, m: 8, l: 4, carrier: 0, capital: 4, mega: 0 })
});

// ---------------------------------------------------------------------------
// Narzędzia płaskie

/** Punkt w wypukłym wielokącie (dowolny kierunek obiegu). */
export function pointInConvex(points, x, z) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

const LOCAL = {};
/** Gdzie jest punkt (opis miejsca do HUD-u i czynnik „w porcie” modelu lotu). */
export function yardLocate(layout, x, z, out = {}) {
  const a = yardToArc(x, z, out);
  const { s, v } = a;
  const V = layout.v;
  const B = layout.basin;
  const Yd = layout.yard;
  out.place = 'space';
  out.pit = null;
  out.inside = 0;
  if (v < 0) { out.place = 'ring'; return out; }
  if (Yd.tri) {
    // stocznia Ziemi: ulica od hali i obwodnica wokół trójkątnego doku (sięga daleko poza łuk kompleksu)
    const Tr = Yd.tri;
    const q = Tr.toLocal(x, z, LOCAL);
    if (q.along > -40 && q.along < Tr.far + 400 && Math.abs(q.across) < Tr.halfWidth + 400) {
      for (const p of Tr.pits) {
        if (pointInConvex(p.poly, x, z)) { out.place = 'yardpit'; out.pit = p; out.inside = 1; return out; }
      }
      const d = Tr.dist(q.along, q.across);
      const stem = Math.abs(q.across) <= Tr.hwS && q.along < Tr.apexA - Tr.Din;
      if (stem || (d >= Tr.Din - 60 && d <= Tr.Dout + 60)) { out.place = 'yardstreet'; out.inside = 0.35; return out; }
      if (d < Tr.Dwall + 200 || q.along < Tr.stemEnd) { out.place = 'yard'; out.inside = 0.5; return out; }
    }
  }
  if (s < layout.sMin - 400 || s > layout.sMax + 400) return out;
  for (const p of layout.pits) {
    if (s >= p.s0 && s <= p.s1 && v >= p.v0 - (p.orient === 'arc' ? 60 : 0) && v <= p.v1 + (p.orient === 'arc' ? 60 : 0)) {
      out.place = p.kind === 'hangar' ? 'hangar' : p.kind === 'drydock' ? 'drydock' : p.kind === 'refit' ? 'refit' : p.navy ? 'navy' : p.yard ? 'yardpit' : 'pit';
      out.pit = p;
      out.inside = 1;
      return out;
    }
  }
  if (v >= V.inner1 && v <= V.outer0) { out.place = s < Yd.s1 ? 'yardroad' : 'road'; out.inside = 0.35; return out; }
  if (s >= layout.gate.s0 && s <= layout.gate.s1 && v > V.outer0 && v < V.outer1 + 900) { out.place = 'gate'; out.inside = 0.6; return out; }
  if (s >= B.in0 && s <= B.in1 && v > V.outer0 && v < B.back0) { out.place = 'basin'; out.inside = 0.7; return out; }
  if (!Yd.tri && s >= Yd.s0 - 300 && s <= Yd.s1 + 300 && v > Yd.v1 && v < Yd.tipV + 600) { out.place = 'yard'; out.inside = 0.5; return out; }
  if (v > V.outer1 && v < V.outer1 + 1500 && s > Yd.s1 && (s < layout.gate.s0 || s > B.s1)) { out.place = 'mega'; out.inside = 0.25; }
  return out;
}

export const YARD_PLACE_LABEL = Object.freeze({
  space: 'PRZESTRZEŃ', ring: 'RING', road: 'DROGA', yardroad: 'DROGA · STOCZNIA', gate: 'WJAZD K-7', basin: 'SUCHY DOK FLOTY',
  navy: 'SUCHY DOK FLOTY · STANOWISKO', pit: 'DOK', drydock: 'SUCHY DOK', hangar: 'HANGAR', mega: 'PAS MEGA',
  yard: 'STOCZNIA', yardstreet: 'STOCZNIA · ULICA', refit: 'STOCZNIA · DOK REFITU', yardpit: 'STOCZNIA · DOK'
});
