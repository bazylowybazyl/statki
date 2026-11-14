// DWORZEC PROMÓW — UKŁAD (czysta matematyka, bez three i DOM).
//
// Odcinek ringu 7 000 j. łuku (s od −3 500 do +3 500) — tyle, ile zajmuje sam dworzec. Ludzie mieszkają W RINGU
// (habitat), więc poza ringiem nie ma zabudowy mieszkalnej (decyzja użytkownika 2026-11-13): pasażerowie przychodzą
// z wnętrza ringu PRZEJŚCIAMI w rzędzie przy ringu i kładkami nad drogą idą do hali odlotów.
// Przekrój jak w całym ringu: ściana ringu | rząd przy ringu | droga 2 600 j. | rząd zewnętrzny:
//   • strona przestrzeni: DWORZEC — podkowa wokół PLACU DWORCOWEGO (otwór 3 500 j. w rzędzie zewnętrznym):
//     dwa pirsy ze stanowiskami S i M otwartymi na plac, w głębi hala odlotów ze stanowiskami M i L (promy stają
//     dziobem do hali), za halą apsyda z wieżą kontroli ruchu, po bokach skrzydła (biuro kontraktów, odprawa);
//   • strona ringu: POSTÓJ PROMÓW czekających na kurs (wnęki S / M / L otwarte na drogę), po jego bokach dwa
//     PRZEJŚCIA Z RINGU (śluza w ścianie ringu, hala dojścia, windy na peron kolei, kładka nad drogą do pirsu),
//     na końcach zaplecze zaopatrzenia.
// Kolej pasażerska staje przy obu przejściach (towar `workforce`), zaopatrzenie (tlen, polimer) w czterech zatokach.
import { RING_V, YARD_PITS, createDistrict, ringScale, yardPoint, yardRadial, yardTangent, yardToArc } from '../kit/uklad.js';

const V = RING_V;

/** Wymiary dzielnicy (s — łuk na R0, v — promień od krawędzi ścian ringu). */
export const DW = Object.freeze({
  sHalf: 3500,               // dworzec zajmuje cały odcinek: skrzydła sięgają ±3 500
  termHalf: 3500,
  courtHalf: 1750,           // plac dworcowy: otwór ±1 750 w rzędzie zewnętrznym
  courtV1: 6000,             // ściana tylna placu (wyloty stanowisk hali)
  wingS: 2650,               // pirsy: 1 750…2 650
  backV1: 8500,              // lico zewnętrzne dworca
  hall: Object.freeze({ half: 1650, v0: 7300, v1: 8320, eave: 250, top: 780 }),
  apse: Object.freeze({ half0: 1000, half1: 640, v0: 8480, v1: 9420 }),
  tower: Object.freeze({ s: 0, v: 9000 }),
  // rząd przy ringu: postój promów ±1 990, przejścia z ringu 1 990…2 890 (oś 2 440 = oś galerii pirsu), zaplecze do 3 500
  parkHalf: 1990,
  gateS: 2440,
  gateHalf: 450,
  // kładka pasażerska nad drogą (zestaw FG, spód na wysokości bramownic): od rzędu przy ringu do pirsu
  bridge: Object.freeze({ v0: V.inner1 - 130, v1: V.outer0 + 130, half: 110 })
});

/** Promy na stanowiskach wg klasy pola. */
export const FERRY_HULL = Object.freeze({ s: 'crew_shuttle', m: 'crew_liner', l: 'colony_liner' });

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function buildDworzecLayout() {
  const D = createDistrict({ id: 'dworzec', sHalf: DW.sHalf });
  const g0 = DW.gateS - DW.gateHalf;
  const g1 = DW.gateS + DW.gateHalf;

  // --- rząd przy ringu: zaplecze | przejście z ringu | postój promów | przejście z ringu | zaplecze
  D.block({ zone: 'PR', bar: 'zaplecze zachód', a: -DW.sHalf, b: -g1, v0: V.inner0, v1: V.inner1, face: 1 });
  D.block({ zone: 'PR', bar: 'przejście zachód', a: -g1, b: -g0, v0: V.inner0, v1: V.inner1, face: 1 });
  D.arcBar({ zone: 'PP', bar: 'postój', a: -DW.parkHalf, b: DW.parkHalf, v0: V.inner0, v1: V.inner1, row: ['m', 's', 'l', 'm', 'l', 's', 'm'], open: 1, tags: { role: 'postoj' } });
  D.block({ zone: 'PR', bar: 'przejście wschód', a: g0, b: g1, v0: V.inner0, v1: V.inner1, face: 1 });
  D.block({ zone: 'PR', bar: 'zaplecze wschód', a: g1, b: DW.sHalf, v0: V.inner0, v1: V.inner1, face: 1 });

  // --- dworzec: skrzydła, pirsy ze stanowiskami na plac, naroża, hala ze stanowiskami w ścianie tylnej placu
  const pier = [{ kind: 'm', v: 3780 }, { kind: 'm', v: 4400 }, { kind: 's', v: 5030 }, { kind: 's', v: 5450 }];
  D.block({ zone: 'DW', bar: 'skrzydło zachód', a: -DW.termHalf, b: -DW.wingS, v0: V.outer0, v1: DW.backV1, face: -1 });
  D.radialBar({ zone: 'DW', bar: 'pirs zachód', a: -DW.wingS, b: -DW.courtHalf, v0: V.outer0, v1: DW.courtV1, list: pier, open: 1, tags: { role: 'dworzec', wing: 'W' } });
  D.block({ zone: 'DW', bar: 'naroże zachód', a: -DW.wingS, b: -DW.courtHalf, v0: DW.courtV1, v1: DW.backV1 });
  D.arcBar({ zone: 'DW', bar: 'hala', a: -DW.courtHalf, b: DW.courtHalf, v0: DW.courtV1, v1: DW.backV1, row: ['m', 'l', 'l', 'l', 'm'], open: -1, tags: { role: 'dworzec', wing: 'H' } });
  D.block({ zone: 'DW', bar: 'naroże wschód', a: DW.courtHalf, b: DW.wingS, v0: DW.courtV1, v1: DW.backV1 });
  D.radialBar({ zone: 'DW', bar: 'pirs wschód', a: DW.courtHalf, b: DW.wingS, v0: V.outer0, v1: DW.courtV1, list: pier, open: -1, tags: { role: 'dworzec', wing: 'E' } });
  D.block({ zone: 'DW', bar: 'skrzydło wschód', a: DW.wingS, b: DW.termHalf, v0: V.outer0, v1: DW.backV1, face: -1 });
  const A = DW.apse;
  const apse = [yardPoint(-A.half0, A.v0), yardPoint(A.half0, A.v0), yardPoint(A.half1, A.v1), yardPoint(-A.half1, A.v1)];
  D.addSolid('DW apsyda', 'bar', 'DW', apse);
  D.opening(-DW.courtHalf, DW.courtHalf, 'plac dworcowy');

  // --- transport po ringu: kolej pasażerska staje przy przejściach z ringu, zaopatrzenie dworca (tlen, polimer)
  D.railStop({ s: -DW.gateS, side: -1, goods: 'workforce', dir: 'in', label: 'DWORZEC ZACHÓD' });
  D.railStop({ s: DW.gateS, side: -1, goods: 'workforce', dir: 'in', label: 'DWORZEC WSCHÓD' });
  D.truckBay({ s: -3290, side: 1, goods: 'oxygen', dir: 'in', label: 'TLEN' });
  D.truckBay({ s: 3290, side: 1, goods: 'polymer', dir: 'in', label: 'POLIMER' });
  D.truckBay({ s: -3195, side: -1, goods: 'polymer', dir: 'in', label: 'POLIMER' });
  D.truckBay({ s: 3195, side: -1, goods: 'oxygen', dir: 'in', label: 'TLEN' });

  const court = { s0: -DW.courtHalf, s1: DW.courtHalf, v0: V.outer0, v1: DW.courtV1 };
  // przejścia z ringu: oś, pas rzędu przy ringu i kładka nad drogą (nad korytarzem lotu — bez kolizji)
  const gates = [-1, 1].map((side) => ({
    id: side < 0 ? 'zachód' : 'wschód', side, s: side * DW.gateS, s0: side * DW.gateS - DW.gateHalf, s1: side * DW.gateS + DW.gateHalf,
    bridge: { s: side * DW.gateS, v0: DW.bridge.v0, v1: DW.bridge.v1, half: DW.bridge.half }
  }));
  const layout = D.finish({
    court, apse, gates,
    // gospodarz nie stawia bramownic nad drogą w obrębie dworca: zamiast nich są dwie kładki pasażerskie
    lintelSkip: [[-DW.sHalf, DW.sHalf]],
    placeLabels: { court: 'PLAC DWORCOWY' },
    /** Opis miejsca: plac dworcowy (wolna przestrzeń między pirsami) ma własną nazwę. */
    locate(x, z, a, out) {
      if (a.s > court.s0 && a.s < court.s1 && a.v > court.v0 && a.v < court.v1) {
        for (const p of layout.pits) {
          if (p.zone !== 'DW') continue;
          if (a.s >= p.s0 && a.s <= p.s1 && a.v >= p.v0 && a.v <= p.v1) return false;
        }
        out.place = 'court';
        out.inside = 0.5;
        return true;
      }
      return false;
    }
  });
  layout.terminalBerths = layout.berths.filter((b) => b.role === 'dworzec');
  layout.parkBerths = layout.berths.filter((b) => b.role === 'postoj');
  return layout;
}

/**
 * Kto stoi na stanowisku przy starcie: postój przy ringu — promy czekające na kurs (część pól pusta), stanowiska
 * dworca — puste (promy przylatują i odlatują w symulacji, `ruch.js`).
 */
const PARK_EMPTY = new Set(['PP-S1', 'PP-L2']);
export function parkedHull(berth) {
  if (berth.role === 'postoj') return PARK_EMPTY.has(berth.id) ? null : FERRY_HULL[berth.cls];
  return null;
}

// ---------------------------------------------------------------------------
// Trasy promów (układ lokalny x, z). Ruch prawostronny: pas od strony przestrzeni (v = oś + 650) ku +s, pas przy
// ringu (oś − 650) ku −s. Przylot z zachodu = pas od przestrzeni i skręt w prawo na plac; przylot ze wschodu = pas
// przy ringu i skręt w lewo przez drogę. Odlot na wschód = w prawo na pas od przestrzeni; na zachód = w lewo.

const LANE_OUT = V.road + V.laneOff;     // ku +s
const LANE_IN = V.road - V.laneOff;      // ku −s
/** Skąd prom wjeżdża na plac / którędy wyjeżdża (s bramki na progu placu). */
export const GATES = Object.freeze({ inW: -1180, inE: 520, outE: 1180, outW: -520 });
const SPAWN = DW.sHalf + 1900;           // gdzie prom pojawia się i znika na drodze (poza dzielnicą, z zanikaniem)

/** Wygładzenie łamanej (Chaikin, końce zostają): krzywa styczna do odcinków w ich środkach. */
function chaikin(pts, rounds = 3) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i + 2 < p.length) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Próbnik łamanej po długości: `at(d, out)` → out.x, out.z, out.h (kurs). */
export function pathSampler(points) {
  const n = points.length;
  const acc = new Float64Array(n);
  for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const len = acc[n - 1];
  function at(d, out) {
    const dd = Math.max(0, Math.min(len, d));
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid] <= dd) lo = mid; else hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    const t = (dd - acc[lo]) / Math.max(1e-6, acc[hi] - acc[lo]);
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    // kurs z odcinka ±40 j. wokół punktu (bez schodków na łączeniach)
    const i0 = Math.max(0, lo - 1);
    const i1 = Math.min(n - 1, hi + 1);
    out.h = Math.atan2(points[i1][1] - points[i0][1], points[i1][0] - points[i0][0]);
    return out;
  }
  return { points, len, at };
}

function lanePoints(s0, s1, v, step = 380) {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(yardPoint(s0 + ((s1 - s0) * i) / n, v));
  return pts;
}

/** Oś stanowiska: punkt wylotu, kierunek na zewnątrz doku (ku placowi), kurs promu w doku. */
export function berthAxis(layout, berth) {
  const pit = layout.pits.find((p) => p.berth === berth);
  const sw = ringScale(berth.v);
  if (pit.orient === 'arc') {
    const mouthV = pit.open > 0 ? pit.v1 : pit.v0;
    const dir = pit.open > 0 ? 1 : -1;                     // znak v od ściany tylnej ku wylotowi
    return { pit, point: (k) => yardPoint(berth.s, mouthV + dir * k), mouth: Math.abs(mouthV - berth.v) };
  }
  const mouthS = pit.open > 0 ? pit.s1 : pit.s0;
  const dir = pit.open > 0 ? 1 : -1;
  return { pit, point: (k) => yardPoint(mouthS + (dir * k) / sw, berth.v), mouth: Math.abs(mouthS - berth.s) * sw };
}

/** Jak daleko przed wylotem prom obraca się w miejscu po wycofaniu (wg klasy). */
const PIVOT = Object.freeze({ s: 230, m: 330, l: 440 });

/**
 * Trasy stanowiska dworca: `inW` / `inE` — przylot (z drogi do środka pola), `back` — wycofanie rufą do punktu obrotu,
 * `outE` / `outW` — odlot od punktu obrotu na drogę. Każda trasa: próbnik + `gate` (długość, przy której prom jest
 * na progu placu).
 */
export function berthRoutes(layout, berth) {
  const ax = berthAxis(layout, berth);
  const wing = berth.wing;
  const end = [berth.x, berth.z];
  const pivotK = PIVOT[berth.cls];
  const pivot = ax.point(pivotK);
  const far = ax.point(wing === 'H' ? 1150 : 780);          // punkt wejścia na oś stanowiska
  const near = ax.point(pivotK + 120);
  const mouth = ax.point(40);
  const threshold = V.outer0 - 60;
  const mk = (pts, gateIndex) => {
    const smooth = chaikin(pts, 3);
    const sampler = pathSampler(smooth);
    // długość do progu placu: najbliższy punkt wygładzonej trasy do punktu bramki
    const g = pts[gateIndex];
    let best = 0;
    let bd = Infinity;
    let acc = 0;
    for (let i = 0; i < smooth.length; i++) {
      if (i) acc += Math.hypot(smooth[i][0] - smooth[i - 1][0], smooth[i][1] - smooth[i - 1][1]);
      const d = Math.hypot(smooth[i][0] - g[0], smooth[i][1] - g[1]);
      if (d < bd) { bd = d; best = acc; }
    }
    sampler.gate = best;
    return sampler;
  };
  const routes = { berth, pivot, pivotK, heading: berth.heading };
  // przylot z zachodu: pas od przestrzeni → bramka → oś stanowiska
  {
    const lane = lanePoints(-SPAWN, GATES.inW - 760, LANE_OUT);
    const gate = yardPoint(GATES.inW, threshold);
    routes.inW = mk([...lane, gate, far, near, mouth, end], lane.length);
  }
  // przylot ze wschodu: pas przy ringu → w lewo przez drogę → bramka → oś stanowiska
  {
    const lane = lanePoints(SPAWN, GATES.inE + 1500, LANE_IN);
    const gate = yardPoint(GATES.inE, threshold);
    routes.inE = mk([...lane, yardPoint(GATES.inE + 700, V.road), gate, far, near, mouth, end], lane.length + 1);
  }
  // wycofanie: od środka pola do punktu obrotu (prosto, rufą naprzód)
  routes.back = pathSampler([end, pivot]);
  // odlot na wschód: punkt obrotu → bramka → pas od przestrzeni
  {
    const gate = yardPoint(GATES.outE, threshold);
    const lane = lanePoints(GATES.outE + 760, SPAWN, LANE_OUT);
    routes.outE = mk([pivot, gate, ...lane], 1);
  }
  // odlot na zachód: punkt obrotu → bramka → w lewo przez drogę → pas przy ringu
  {
    const gate = yardPoint(GATES.outW, threshold);
    const lane = lanePoints(GATES.outW - 1500, -SPAWN, LANE_IN);
    routes.outW = mk([pivot, gate, yardPoint(GATES.outW - 700, V.road), ...lane], 1);
  }
  // skąd przylatuje i dokąd odlatuje: pirsy — z przeciwnej strony (łagodny łuk zamiast nawrotu), hala — na zmianę
  const k = hash(berth.s * 0.011 + berth.v * 0.003 + 1.3);
  routes.arrive = wing === 'W' ? ['inE'] : wing === 'E' ? ['inW'] : (k < 0.5 ? ['inW', 'inE'] : ['inE', 'inW']);
  routes.depart = wing === 'W' ? ['outE'] : wing === 'E' ? ['outW'] : (k < 0.5 ? ['outE', 'outW'] : ['outW', 'outE']);
  routes.used = [...routes.arrive, ...routes.depart];
  return routes;
}

export { V as DW_V, LANE_IN, LANE_OUT, SPAWN, YARD_PITS, hash as dwHash, ringScale, yardPoint, yardRadial, yardTangent, yardToArc };
