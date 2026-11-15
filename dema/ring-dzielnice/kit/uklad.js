// DZIELNICE RINGU — zestaw wspólny, UKŁAD (czysta matematyka, bez three i DOM).
//
// Dzielnica to odcinek ringu Ziemi z tym samym przekrojem co port (dema/stocznia-ringu): ściana ringu | rząd przy
// ringu | DROGA 2 600 j. nad kratownicą | rząd zewnętrzny — i tym, co dzielnica dostawi dalej w przestrzeń. Geometria
// w układzie łuku: s — długość wzdłuż ringu na promieniu R0 (środek dzielnicy s = 0), v — odległość promieniowa od
// krawędzi ścian ringu. Bryły to wypukłe wielokąty w układzie lokalnym (x, z) — te same służą kolizjom, korpusom
// i testom. Jedna budowniczka `createDistrict` na dzielnicę; wynik `finish()` czyta gospodarz dema i test.
//
// TRANSPORT PO RINGU (decyzja użytkownika 2026-11-13): między budynkami jeżdżą CIĘŻARÓWKI (poboczem drogi) i POCIĄGI
// (kratownicą pod drogą), a budynki eksportowo-importowe mogą mieć POŁĄCZENIE Z ZEWNĄTRZ (doki od strony przestrzeni).
// Dzielnica tylko DEKLARUJE swoje punkty: `truckBay` (zatoka przy licu rzędu), `railStop` (przystanek na kratownicy),
// doki i pasy MEGA od strony przestrzeni. Rysuje je i (później) obsługuje ruchem zestaw wspólny.
import {
  YARD_BERTH, YARD_PITS, YARD_R0, YARD_RING, pointInConvex, yardPhi, yardPoint, yardRadial, yardTangent, yardToArc
} from '../../stocznia-ringu/layout.js';

export { YARD_BERTH, YARD_PITS, YARD_R0, pointInConvex, yardPhi, yardPoint, yardRadial, yardTangent, yardToArc };

const R0 = YARD_R0;
const Y = YARD_RING;

/** Przekrój ringu (v): rząd przy ringu, droga, rząd zewnętrzny; pasy ruchu statków ±650 od osi, pobocze ciężarówek. */
export const RING_V = Object.freeze({
  inner0: 0,
  inner1: Y.innerT,
  road: Y.innerT + Y.roadW / 2,
  outer0: Y.innerT + Y.roadW,
  outer1: Y.innerT + Y.roadW + Y.outerT,
  roadW: Y.roadW,
  laneOff: 650,          // oś pasa statków od osi drogi
  shoulderOff: 1190      // oś pobocza (ciężarówki) od osi drogi — między pasem statków a licem rzędu
});

/** Długość wzdłuż łuku na promieniu R0 + v rośnie ×ringScale(v). */
export const ringScale = (v) => (R0 + v) / R0;

/** Wycinek pierścienia jako czworokąt (wypukły przy odcinku ≤ ~900 j. łuku). */
export function sector(s0, s1, v0, v1) {
  return [yardPoint(s0, v0), yardPoint(s1, v0), yardPoint(s1, v1), yardPoint(s0, v1)];
}

// Rodzaje doków w rzędach: klasa pola (s, m, l, carrier, capital) albo 'drydock' — suchy dok capital otwarty z góry,
// 'hangar' — dok capital pod dachem z polem siłowym (dach dorabia gospodarz).
const pitClass = (k) => (k === 'drydock' || k === 'hangar' ? 'capital' : k);
const LETTER = { s: 'S', m: 'M', l: 'L', carrier: 'N', capital: 'C', drydock: 'D', hangar: 'H' };

/**
 * Budowniczka dzielnicy. `id` — nazwa katalogu dzielnicy, `sHalf` — pół długości dzielnicy wzdłuż łuku (dzielnica
 * zajmuje s od −sHalf do +sHalf; najwyżej 9 000), `extent` — jak daleko rysować ścianę ringu i kratownicę poza nią.
 */
export function createDistrict({ id, sHalf, extent = sHalf + 7000 }) {
  if (!(sHalf > 0 && sHalf <= 9000)) throw new Error(`dzielnica ${id}: sHalf ${sHalf} poza zakresem (0, 9000]`);
  const solids = [];      // { id, tag, zone, points: [[x, z] × n] } — wypukłe; kolizje i korpusy
  const pieces = [];      // kawałki korpusów belek: { zone, bar, orient, s0, s1, v0, v1, pit, face }
  const pits = [];        // doki: { id, kind, cls, zone, orient, s0, s1, v0, v1, sc, vc, w, open, berth, …tags }
  const berths = [];      // { id, cls, kind, zone, x, z, s, v, heading, length, width, …tags }
  const megaLanes = [];
  const fingers = [];
  const truckBays = [];
  const railStops = [];
  const openings = [];
  const counters = {};
  const V = RING_V;

  const addSolid = (name, tag, zone, points) => { solids.push({ id: name, tag, zone, points }); };
  function nextId(zone, kind) {
    const k = `${zone}:${LETTER[kind]}`;
    counters[k] = (counters[k] || 0) + 1;
    return `${zone}-${LETTER[kind]}${counters[k]}`;
  }
  function addBerth(pit, cls, kind, zone, s, v, heading, tags) {
    const C = YARD_BERTH[cls];
    const [x, z] = yardPoint(s, v);
    const berth = { navy: false, yard: false, ...tags, id: pit.id, cls, kind, zone, s, v, x, z, heading, length: C.length, width: C.width };
    pit.berth = berth;
    berths.push(berth);
  }

  /**
   * Belka wzdłuż łuku (s od a do b, v od v0 do v1) z dokami wyciętymi od jednej krawędzi: `open` = +1 dok otwarty
   * ku +v, −1 ku −v. `row` — rodzaje doków od a do b (pusta lista = pełny blok). Szerokości doków liczone na węższym
   * końcu wycięcia. `tags` — pola dopisywane do doków i stanowisk (np. { role: 'ruda' }). Lico od strony wylotów
   * (`face`) dostaje w bryłach krawężnik i listwę świetlną; `face: null` — bez lica (ściana wewnątrz bryły).
   */
  function arcBar({ zone, bar, a, b, v0, v1, row = [], open = -1, tags = {}, face = true }) {
    const defs = row.map((kind) => {
      const cls = pitClass(kind);
      const P = YARD_PITS[cls];
      if (!P) throw new Error(`dzielnica ${id}: nieznany rodzaj doku „${kind}”`);
      if (P.d > v1 - v0 - 60) throw new Error(`dzielnica ${id}: dok ${kind} (głębokość ${P.d}) nie mieści się w belce ${zone} ${bar} (${v1 - v0})`);
      return { kind, cls, P, ws: P.w / ringScale(open > 0 ? v1 - P.d : v0) };
    });
    let wsum = 0;
    for (const d of defs) wsum += d.ws;
    const wall = (b - a - wsum) / (defs.length + 1);
    if (defs.length && wall < 40) throw new Error(`dzielnica ${id}: doki nie mieszczą się w belce ${zone} ${bar} (ściana ${wall.toFixed(0)} j.)`);
    const cuts = [];
    let cur = a + wall;
    for (const d of defs) {
      const pv0 = open > 0 ? v1 - d.P.d : v0;
      const pv1 = open > 0 ? v1 : v0 + d.P.d;
      const sc = cur + d.ws / 2;
      const pit = {
        navy: false, yard: false, ...tags,
        id: nextId(zone, d.kind), kind: d.kind, cls: d.cls, zone, bar, orient: 'arc',
        s0: cur, s1: cur + d.ws, v0: pv0, v1: pv1, sc, vc: (pv0 + pv1) / 2, w: d.P.w, open
      };
      // dziób przy ścianie tylnej doku, rufa w wylocie
      const C = YARD_BERTH[d.cls];
      const noseGap = d.cls === 'capital' || d.cls === 'carrier' ? 110 : 80;
      const bv = open > 0 ? pv0 + noseGap + C.length / 2 : pv1 - noseGap - C.length / 2;
      addBerth(pit, d.cls, d.kind, zone, sc, bv, open > 0 ? yardRadial(sc) + Math.PI : yardRadial(sc), tags);
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
        pieces.push({ zone, bar, orient: 'arc', s0, s1, v0: pv0, v1: pv1, pit: cut ? cut.pit : null, face: face ? { v: open > 0 ? v1 : v0, sign: open } : null });
        addSolid(`${zone} ${bar}`, cut ? 'pit-back' : 'bar', zone, sector(s0, s1, pv0, pv1));
      }
    }
  }

  /** Pełny blok (bez doków): wycinek s od a do b, v od v0 do v1. `face`: +1 / −1 — lico z krawężnikiem po stronie +v / −v, 0 — bez. */
  function block({ zone, bar, a, b, v0, v1, face = 0 }) {
    const n = Math.max(1, Math.ceil((b - a) / Y.maxPiece));
    for (let k = 0; k < n; k++) {
      const s0 = a + ((b - a) * k) / n;
      const s1 = a + ((b - a) * (k + 1)) / n;
      pieces.push({ zone, bar, orient: 'arc', s0, s1, v0, v1, pit: null, face: face ? { v: face > 0 ? v1 : v0, sign: face } : null });
      addSolid(`${zone} ${bar}`, 'bar', zone, sector(s0, s1, v0, v1));
    }
  }

  /**
   * Ściana promieniowa (s od a do b, v od v0 do v1) z dokami wyciętymi od jednej strony: `open` = +1 dok otwarty ku
   * +s, −1 ku −s. `list`: [{ kind, v }] — początek wylotu doku na osi v.
   */
  function radialBar({ zone, bar, a, b, v0, v1, list = [], open = 1, tags = {} }) {
    const cuts = [];
    for (const it of list) {
      const cls = pitClass(it.kind);
      const P = YARD_PITS[cls];
      const pv0 = it.v;
      const pv1 = it.v + P.w;
      const ds = P.d / ringScale((pv0 + pv1) / 2);
      const ps0 = open > 0 ? b - ds : a;
      const ps1 = open > 0 ? b : a + ds;
      const pit = {
        navy: false, yard: false, ...tags,
        id: nextId(zone, it.kind), kind: it.kind, cls, zone, bar, orient: 'rad',
        s0: ps0, s1: ps1, v0: pv0, v1: pv1, sc: (ps0 + ps1) / 2, vc: (pv0 + pv1) / 2, w: P.w, open
      };
      const C = YARD_BERTH[cls];
      const vc = (pv0 + pv1) / 2;
      const off = (80 + C.length / 2) / ringScale(vc);
      const bs = open > 0 ? ps0 + off : ps1 - off;
      addBerth(pit, cls, it.kind, zone, bs, vc, open > 0 ? yardTangent(bs) + Math.PI : yardTangent(bs), tags);
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

  /**
   * Pas MEGA przy licu zewnętrznym (POŁĄCZENIE Z ZEWNĄTRZ dla masowców i megafrachtowców): statek stoi równolegle
   * do lica `vFace` w odległości megaOff, po bokach palce cumownicze. `tags` — np. { role: 'ruda' }.
   */
  function megaAt(zone, sc, vFace, tags = {}) {
    const C = YARD_BERTH.mega;
    const megaV = vFace + Y.megaOff;
    const ms = ringScale(megaV);
    const mid = `${zone}-MG${megaLanes.filter((m) => m.zone === zone).length + 1}`;
    const [x, z] = yardPoint(sc, megaV);
    const berth = { navy: false, yard: false, ...tags, id: mid, cls: 'mega', kind: 'mega', zone, s: sc, v: megaV, x, z, heading: yardTangent(sc), length: C.length, width: C.width };
    berths.push(berth);
    const lane = { ...tags, id: mid, zone, sc, v: megaV, vFace, length: C.length, width: C.width, sHalf: C.length / 2 / ms, berth };
    megaLanes.push(lane);
    for (const side of [-1, 1]) {
      const fs = sc + side * (C.length / 2 + 250) / ms;
      const hw = Y.fingerW / 2 / ms;
      const f = { id: `${mid}-P${side > 0 ? 2 : 1}`, zone, sc: fs, s0: fs - hw, s1: fs + hw, v0: vFace - 30, v1: vFace + Y.fingerD };
      fingers.push(f);
      addSolid(f.id, 'finger', zone, sector(f.s0, f.s1, f.v0, f.v1));
    }
    return lane;
  }

  /**
   * Zatoka ciężarówek na poboczu drogi przy licu rzędu: `side` = +1 lico rzędu zewnętrznego, −1 lico rzędu przy
   * ringu; `s` — środek, `len` — długość zatoki wzdłuż łuku [j.], `goods` — id towaru z ekonomii (src/data/resources.js)
   * albo opis, `dir` — 'in' (dostawa do budynku) / 'out' (odbiór z budynku). Zatoka nie zmienia brył — to miejsce
   * postoju na poboczu z osprzętem na licu; nie może leżeć w wylocie doku (sprawdza test wspólny).
   */
  function truckBay({ s, side = 1, len = 340, goods = '', dir = 'out', label = '' }) {
    const bay = { id: `${id}-T${truckBays.length + 1}`, s, side, len, goods, dir, label, v: V.road + side * V.shoulderOff, vFace: side > 0 ? V.outer0 : V.inner1 };
    const [x, z] = yardPoint(s, bay.v);
    bay.x = x;
    bay.z = z;
    // ruch prawostronny: po stronie przestrzeni (side +1) jedzie się ku +s, po stronie ringu ku −s
    bay.heading = side > 0 ? yardTangent(s) : yardTangent(s) + Math.PI;
    truckBays.push(bay);
    return bay;
  }

  /**
   * Przystanek kolei na kratownicy pod drogą: `s` — środek, `len` — długość peronu, `side` — po której stronie
   * kratownicy stoi peron z windą do budynku (+1 rząd zewnętrzny, −1 rząd przy ringu), `goods`, `dir` jak w zatoce.
   */
  function railStop({ s, side = 1, len = 900, goods = '', dir = 'out', label = '' }) {
    const stop = { id: `${id}-K${railStops.length + 1}`, s, side, len, goods, dir, label };
    railStops.push(stop);
    return stop;
  }

  /** Otwór w rzędzie zewnętrznym (wlot ulicy, wylot placu) — test „bez szpar” go pomija. */
  function opening(s0, s1, label = '') { openings.push({ s0, s1, label }); }

  /** Zamyka budowę: dokłada ścianę ringu i zwraca układ dzielnicy (pola dodatkowe z `extra`). */
  function finish(extra = {}) {
    const bandN = Math.ceil((2 * extent) / Y.maxPiece);
    const band = [];
    for (let k = 0; k < bandN; k++) {
      const s0 = -extent + ((2 * extent) * k) / bandN;
      const s1 = -extent + ((2 * extent) * (k + 1)) / bandN;
      const seg = { s0, s1, v0: -Y.bandDepth, v1: 0 };
      band.push(seg);
      addSolid('ŚCIANA RINGU', 'ring', 'RING', sector(s0, s1, seg.v0, seg.v1));
    }
    const count = { s: 0, m: 0, l: 0, carrier: 0, capital: 0, mega: 0 };
    for (const b of berths) count[b.cls]++;
    return {
      id, R0, solids, pieces, pits, berths, megaLanes, fingers, band, truckBays, railStops, openings,
      sMin: -sHalf, sMax: sHalf, extent,
      v: { inner0: V.inner0, inner1: V.inner1, outer0: V.outer0, outer1: V.outer1, road: V.road },
      counts: count,
      ...extra
    };
  }

  return { id, sHalf, extent, V, solids, pieces, pits, berths, megaLanes, fingers, truckBays, railStops, addSolid, sector, arcBar, block, radialBar, megaAt, truckBay, railStop, opening, finish };
}

/**
 * Macierz grupy ruchomej budowli: PRZESUW PO ŁUKU o `ds` (długość na promieniu R0) — obrót wokół środka ringu, więc
 * suwnica albo wózek jadący wzdłuż rzędu trzyma się łuku na każdej odległości. `elements` — tablica 16 liczb macierzy
 * (three: `matrix.elements`, układ kolumnowy); `dv` — dodatkowy przesuw promieniowy dla punktu, który stał w (s0, ·).
 */
export function arcShiftElements(elements, ds, s0 = 0, dv = 0) {
  const th = ds / R0;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const e = elements;
  e[0] = c; e[1] = 0; e[2] = -s; e[3] = 0;
  e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
  e[8] = s; e[9] = 0; e[10] = c; e[11] = 0;
  // obrót wokół środka ringu (0, −R0): p' = R·(p − c) + c
  const cz = -R0;
  const ph = (s0 + ds) / R0;
  e[12] = -(s * cz) + Math.sin(ph) * dv;
  e[13] = 0;
  e[14] = cz - c * cz + Math.cos(ph) * dv;
  e[15] = 1;
  return elements;
}

/** Gdzie jest punkt (opis miejsca do HUD-u i czynnik „w porcie” modelu lotu). `layout.locate` dzielnicy ma pierwszeństwo. */
const LOCAL = {};
export function districtLocate(layout, x, z, out = {}) {
  const a = yardToArc(x, z, LOCAL);
  out.s = a.s;
  out.v = a.v;
  out.place = 'space';
  out.pit = null;
  out.inside = 0;
  if (a.v < 0) { out.place = 'ring'; return out; }
  if (typeof layout.locate === 'function' && layout.locate(x, z, a, out)) return out;
  for (const p of layout.pits) {
    const m = p.orient === 'arc' ? 60 : 0;
    if (a.s >= p.s0 && a.s <= p.s1 && a.v >= p.v0 - m && a.v <= p.v1 + m) {
      out.place = p.kind === 'hangar' ? 'hangar' : p.kind === 'drydock' ? 'drydock' : 'pit';
      out.pit = p;
      out.inside = 1;
      return out;
    }
  }
  const V = layout.v;
  if (a.v >= V.inner1 && a.v <= V.outer0) { out.place = 'road'; out.inside = 0.35; return out; }
  if (a.s > layout.sMin - 400 && a.s < layout.sMax + 400 && a.v > V.outer0 && a.v < V.outer1 + 1500) { out.place = 'district'; out.inside = 0.3; }
  return out;
}
