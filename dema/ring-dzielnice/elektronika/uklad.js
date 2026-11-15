// Dzielnica ringu „Zakłady elektroniki” — UKŁAD (czysta matematyka, bez three i DOM; czyta go wtyczka i test).
//
// Trzy zakłady wzdłuż drogi (od −s): FABRYKA UKŁADÓW (ruda krzemu + ruda niklu → układy), ZAKŁAD OPTYKI (surowy
// kryształ → soczewki) i ZAKŁAD TAŚMY NADPRZEWODZĄCEJ (ziemie rzadkie + przewód miedziany + nadstop niklu → taśma).
// Za zakładami w przestrzeń: port krzemu (doki od strony przestrzeni), kopuła prób z kolimatorem, stacja zasilania
// i trzy pola radiatorów. Rząd przy ringu: magazyny wyrobów z ekspedycją kurierską i pawilony laboratoriów.
// Wszystko bez szpar: pokłady zakładów przylegają do siebie, do wnętrza wchodzi się z drogi.
import { RING_V, createDistrict } from '../kit/uklad.js';

const V = RING_V;

/** Wymiary dzielnicy (j.): podział łuku na zakłady, głębokości pokładów, pola radiatorów, punkty transportu. */
export const EL = Object.freeze({
  sHalf: 7200,
  vFront: 4700,                 // koniec pasa frontowego rzędu zewnętrznego (doki od drogi, przyjęcia, ekspedycje)
  keep: 280,                    // pas przy licu drogi wolny od budynków (zatoki, windy kolei, wieże łączników)
  fab: Object.freeze({ s0: -7200, s1: -2400, vBack: 7400, vPort: 8600, portS1: -5000 }),
  opt: Object.freeze({ s0: -2400, s1: 2200, vBack: 7600 }),
  krio: Object.freeze({ s0: 2200, s1: 7200, vBack: 8200 }),
  dome: Object.freeze({ s: -700, v: 8200, s0: -1350, s1: -50, v1: 8850, r: 470 }),
  tunnel: Object.freeze({ s0: -810, s1: -590, v1: 12900 }),
  power: Object.freeze({ s0: 700, s1: 2200, v1: 9400 }),
  // łączniki nad drogą (FG): zakład ↔ magazyn wyrobów w rzędzie przy ringu
  bridges: Object.freeze([
    Object.freeze({ id: 'chips', s: -3420 }),
    Object.freeze({ id: 'optic_lens', s: 1250 }),
    Object.freeze({ id: 'superconductor', s: 4980 })
  ]),
  // pola radiatorów: trzon promieniowy i pary paneli po bokach
  radiators: Object.freeze([
    Object.freeze({ zone: 'RADW', name: 'UKŁADY', sc: -3700, v0: 8600, v1: 13700, trunkHalf: 100, n: 6, pv0: 9050, pitch: 770, depth: 560, span: 950 }),
    Object.freeze({ zone: 'RADC', name: 'ZASILANIE', sc: 1500, v0: 9400, v1: 12700, trunkHalf: 100, n: 4, pv0: 9750, pitch: 720, depth: 520, span: 760 }),
    Object.freeze({ zone: 'RADE', name: 'KRIOGENIKA', sc: 5000, v0: 8200, v1: 13300, trunkHalf: 100, n: 6, pv0: 8650, pitch: 760, depth: 540, span: 900 })
  ])
});

/** Towary dzielnicy (id z src/data/resources.js): wsad i wyrób każdej linii. */
export const EL_LINES = Object.freeze([
  Object.freeze({ id: 'chips', name: 'układy scalone', short: 'UKŁADY', in: Object.freeze({ silicon_ore: 6, nickel_ore: 1 }), out: 2, takt: 46 }),
  Object.freeze({ id: 'optic_lens', name: 'optyka', short: 'OPTYKA', in: Object.freeze({ raw_crystal: 3 }), out: 1, takt: 64 }),
  Object.freeze({ id: 'superconductor', name: 'taśma nadprzewodząca', short: 'TAŚMA', in: Object.freeze({ rare_earth_ore: 1, copper_wire: 1, nickel_superalloy: 1 }), out: 2, takt: 38 })
]);

export function buildElektronikaLayout() {
  const D = createDistrict({ id: 'elektronika', sHalf: EL.sHalf });
  const { fab, opt, krio } = EL;

  // --- RZĄD PRZY RINGU (v 0…1 000, doki otwarte na drogę): ekspedycja kurierska, magazyny wyrobów, laboratoria
  const inner = (a, b, row, role) => (row
    ? D.arcBar({ zone: 'EI', bar: 'inner', a, b, v0: V.inner0, v1: V.inner1, row, open: 1, tags: { role } })
    : D.block({ zone: 'EI', bar: 'inner', a, b, v0: V.inner0, v1: V.inner1, face: 1 }));
  inner(-7200, -5400, ['s', 'm', 's', 'm'], 'kurier');
  inner(-5400, -3000, null);                                  // MAGAZYN UKŁADÓW
  inner(-3000, -600, ['m', 'l', 'm', 's'], 'lab');
  inner(-600, 1600, null);                                    // MAGAZYN OPTYKI i dyspozytornia
  inner(1600, 3600, ['s', 'm', 'm', 's'], 'kurier');
  inner(3600, 5800, null);                                    // MAGAZYN TAŚMY
  inner(5800, 7200, ['m', 'l'], 'lab');

  // --- RZĄD ZEWNĘTRZNY, pas frontowy (v 3 600…4 700): doki dostaw od drogi i bloki przyjęć / ekspedycji
  const front = (zone, a, b, row, role) => (row
    ? D.arcBar({ zone, bar: 'front', a, b, v0: V.outer0, v1: EL.vFront, row, open: -1, tags: { role } })
    : D.block({ zone, bar: 'front', a, b, v0: V.outer0, v1: EL.vFront, face: -1 }));
  front('FAB', -7200, -5900, null);                           // przyjęcie wsadu z kolei
  front('FAB', -5900, -4300, ['l', 'm'], 'wsad-fab');
  front('FAB', -4300, -2400, null);                           // śluza ekspedycji układów
  front('OPT', -2400, -1500, null);                           // przyjęcie kryształu
  front('OPT', -1500, -100, ['l', 'm'], 'wsad-opt');
  front('OPT', -100, 2200, null);                             // ekspedycja optyki
  front('KRIO', 2200, 3300, null);                            // przyjęcie miedzi
  front('KRIO', 3300, 4900, ['m', 'l'], 'wsad-krio');
  front('KRIO', 4900, 7200, null);                            // przyjęcie z kolei i ekspedycja taśmy

  // --- POKŁADY ZAKŁADÓW za pasem frontowym
  D.block({ zone: 'FAB', bar: 'hale', a: fab.s0, b: fab.s1, v0: EL.vFront, v1: fab.vBack });
  // port krzemu: doki L od strony PRZESTRZENI (połączenie z zewnątrz — ruda krzemu luzem)
  D.arcBar({ zone: 'FAB', bar: 'port', a: fab.s0, b: fab.portS1, v0: fab.vBack, v1: fab.vPort, row: ['l', 'l'], open: 1, tags: { role: 'krzem-import' } });
  D.block({ zone: 'FAB', bar: 'wieze', a: fab.portS1, b: fab.s1, v0: fab.vBack, v1: fab.vPort });
  D.block({ zone: 'OPT', bar: 'hale', a: opt.s0, b: opt.s1, v0: EL.vFront, v1: opt.vBack });
  D.block({ zone: 'OPT', bar: 'kopula', a: EL.dome.s0, b: EL.dome.s1, v0: opt.vBack, v1: EL.dome.v1 });
  D.block({ zone: 'OPT', bar: 'tunel', a: EL.tunnel.s0, b: EL.tunnel.s1, v0: EL.dome.v1, v1: EL.tunnel.v1 });
  D.block({ zone: 'ENE', bar: 'stacja', a: EL.power.s0, b: EL.power.s1, v0: opt.vBack, v1: EL.power.v1 });
  D.block({ zone: 'KRIO', bar: 'hale', a: krio.s0, b: krio.s1, v0: EL.vFront, v1: krio.vBack });

  // --- POLA RADIATORÓW: trzon i panele (bryły w płaszczyźnie lotu — kolidują)
  const radiators = EL.radiators.map((R) => {
    D.block({ zone: R.zone, bar: 'trzon', a: R.sc - R.trunkHalf, b: R.sc + R.trunkHalf, v0: R.v0, v1: R.v1 });
    const panels = [];
    for (let i = 0; i < R.n; i++) {
      const v0 = R.pv0 + i * R.pitch;
      for (const side of [-1, 1]) {
        const a = side < 0 ? R.sc - R.trunkHalf - R.span : R.sc + R.trunkHalf;
        const p = { index: i, side, a, b: a + R.span, v0, v1: v0 + R.depth };
        D.block({ zone: R.zone, bar: 'panel', a: p.a, b: p.b, v0: p.v0, v1: p.v1 });
        panels.push(p);
      }
    }
    return { ...R, panels };
  });

  // --- TRANSPORT PO RINGU
  // ciężarówki, strona zakładów (lico rzędu zewnętrznego, ruch ku +s)
  D.truckBay({ s: -3950, side: 1, goods: 'nickel_ore', dir: 'in', label: 'RUDA NIKLU' });
  D.truckBay({ s: -2900, side: 1, goods: 'chips', dir: 'out', label: 'UKŁADY' });
  D.truckBay({ s: -1950, side: 1, goods: 'raw_crystal', dir: 'in', label: 'KRYSZTAŁ' });
  D.truckBay({ s: 1800, side: 1, goods: 'optic_lens', dir: 'out', label: 'SOCZEWKI' });
  D.truckBay({ s: 2750, side: 1, goods: 'copper_wire', dir: 'in', label: 'PRZEWÓD CU' });
  D.truckBay({ s: 6300, side: 1, goods: 'nickel_superalloy', dir: 'in', label: 'NADSTOP' });
  D.truckBay({ s: 6850, side: 1, goods: 'superconductor', dir: 'out', label: 'TAŚMA' });
  // ciężarówki, strona magazynów (lico rzędu przy ringu, ruch ku −s): wyroby na eksport i do sąsiednich dzielnic
  D.truckBay({ s: -3900, side: -1, goods: 'chips', dir: 'out', label: 'UKŁADY' });
  D.truckBay({ s: -200, side: -1, goods: 'optic_lens', dir: 'out', label: 'SOCZEWKI' });
  D.truckBay({ s: 5300, side: -1, goods: 'superconductor', dir: 'out', label: 'TAŚMA' });
  // kolej: wsad masowy do zakładów (strona zewnętrzna), wyroby z magazynów (strona ringu)
  D.railStop({ s: -6550, side: 1, goods: 'silicon_ore', dir: 'in', label: 'RUDA KRZEMU' });
  D.railStop({ s: 500, side: 1, goods: 'raw_crystal', dir: 'in', label: 'KRYSZTAŁ' });
  D.railStop({ s: 5500, side: 1, goods: 'rare_earth_ore', dir: 'in', label: 'ZIEMIE RZADKIE' });
  D.railStop({ s: -4750, side: -1, goods: 'chips', dir: 'out', label: 'UKŁADY' });
  D.railStop({ s: 4300, side: -1, goods: 'superconductor', dir: 'out', label: 'TAŚMA' });

  return D.finish({
    el: EL,
    lines: EL_LINES,
    radiators,
    bridges: EL.bridges,
    placeLabels: { district: 'ZAKŁADY ELEKTRONIKI' }
  });
}
