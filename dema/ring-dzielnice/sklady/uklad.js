// DZIELNICA „SKŁADY” — UKŁAD (czysta matematyka, bez three): węzeł logistyczny ringu Ziemi, gdzie towar zmienia
// środek transportu (statek z zewnątrz ↔ magazyn ↔ ciężarówka albo pociąg po ringu). Kontrakt: dema/ring-dzielnice/README.md.
//
// Od lewej (s rośnie w prawo; v — od ściany ringu w przestrzeń):
//   • FARMA ZBIORNIKÓW (s −8 500 … −2 600): przy drodze przepompownia z dokami L dla tankowców ringu, za nią basen
//     (dno y = 18) z obwałowaniami i zbiornikami pięciu płynów importu od olbrzymów, od przestrzeni NABRZEŻE TANKOWCÓW
//     (doki L otwarte w przestrzeń); rurociągi biegną przez wierzch przepompowni do kratownicy drogi;
//   • TERMINAL KONTENEROWY (s −2 600 … +4 400): przy drodze magazyn przeładunkowy z dokami L, za nim plac kontenerowy
//     (trzy bloki stosów pod suwnicami bramowymi), od przestrzeni nabrzeże z dokami L i pasem MEGA (suwnice nabrzeżowe);
//   • WYSOKIE SKŁADY (s +4 400 … +8 500): magazyny wysokiego składowania z rampami ciężarówek od drogi i dokami L
//     eksportu od przestrzeni;
//   • RZĄD PRZY RINGU: doki kurierów (S / M / L), PUNKT NADAŃ gracza (rampa z czterema zatokami) i stacja towarowa
//     (przystanek kolei po stronie ringu).
import { RING_V, createDistrict, ringScale } from '../kit/uklad.js';

const V = RING_V;

/** Wymiary dzielnicy (s — długość łuku na R0, v — od krawędzi ścian ringu). */
export const SK = Object.freeze({
  sHalf: 8500,
  farm: Object.freeze({ a: -8500, b: -2600, road1: 5000, basin1: 9200, quay1: 10200 }),
  ct: Object.freeze({
    a: -2600, b: 4400, road1: 5000, yard1: 9400, quay1: 10500,
    lB: -200,                 // nabrzeże: doki L od a do lB, dalej blok z pasem MEGA
    megaS: 2100,
    // bloki stosów kontenerów (v), suwnica bramowa obejmuje blok z szynami ±70 j. poza nim
    blocks: Object.freeze([[5200, 6200], [6600, 7600], [8000, 9000]]),
    stackA: -2350, stackB: 4150
  }),
  hs: Object.freeze({ a: 4400, b: 8500, v1: 7600, quay1: 8600 }),
  inner: Object.freeze({ pnA: -3600, pnB: -1000, stB: 2600 }),
  // pięć płynów farmy (kolumny basenu od lewej): id towaru, napis, rodzaj zbiornika
  fluids: Object.freeze([
    Object.freeze({ id: 'polymer', label: 'POLIMER', kind: 'cyl', mat: 'orange' }),
    Object.freeze({ id: 'nitrogen', label: 'AZOT', kind: 'sphere', mat: 'teal' }),
    Object.freeze({ id: 'fusion_fuel', label: 'PALIWO FUZYJNE', kind: 'sphere', mat: 'yellow' }),
    Object.freeze({ id: 'oxygen', label: 'TLEN', kind: 'sphere', mat: 'pale' }),
    Object.freeze({ id: 'coolant', label: 'CHŁODZIWO', kind: 'cyl', mat: 'teal' })
  ]),
  // obwałowania (dwa rzędy basenu, v)
  bundRows: Object.freeze([[5250, 6950], [7350, 9000]]),
  pipeV: 7150                 // korytarz rurociągów między rzędami obwałowań
});

/** Odcinki rzędu bez doków (ściany między wylotami) dla strefy: [[s0, s1], …] — do zatok, rur, nadproży. */
export function wallsOf(pits, zone, a, b) {
  const cuts = pits.filter((p) => p.zone === zone).sort((p, q) => p.s0 - q.s0);
  const out = [];
  let cur = a;
  for (const p of cuts) {
    if (p.s0 > cur + 1) out.push([cur, p.s0]);
    cur = Math.max(cur, p.s1);
  }
  if (b > cur + 1) out.push([cur, b]);
  return out;
}

export function buildSkladyLayout() {
  const D = createDistrict({ id: 'sklady', sHalf: SK.sHalf });
  const F = SK.farm;
  const C = SK.ct;
  const Hs = SK.hs;
  const I = SK.inner;

  // --- rząd przy ringu: doki kurierów, punkt nadań, stacja towarowa, doki kurierów
  D.arcBar({ zone: 'IA', bar: 'inner', a: -SK.sHalf, b: I.pnA, v0: V.inner0, v1: V.inner1, row: ['m', 's', 'm', 'l', 's', 'm'], open: 1, tags: { role: 'courier' } });
  D.block({ zone: 'PN', bar: 'inner', a: I.pnA, b: I.pnB, v0: V.inner0, v1: V.inner1, face: 1 });
  D.block({ zone: 'IB', bar: 'inner', a: I.pnB, b: I.stB, v0: V.inner0, v1: V.inner1, face: 1 });
  D.arcBar({ zone: 'IC', bar: 'inner', a: I.stB, b: SK.sHalf, v0: V.inner0, v1: V.inner1, row: ['m', 's', 'l', 'm', 's', 'm'], open: 1, tags: { role: 'courier' } });

  // --- farma zbiorników
  D.arcBar({ zone: 'TR', bar: 'outer', a: F.a, b: F.b, v0: V.outer0, v1: F.road1, row: ['l', 'l', 'l'], open: -1, tags: { role: 'tank-road' } });
  D.block({ zone: 'TB', bar: 'basin', a: F.a, b: F.b, v0: F.road1, v1: F.basin1, face: 0 });
  D.arcBar({ zone: 'TQ', bar: 'quay', a: F.a, b: F.b, v0: F.basin1, v1: F.quay1, row: ['l', 'l', 'l', 'l', 'l'], open: 1, tags: { role: 'tanker-quay' } });

  // --- terminal kontenerowy
  D.arcBar({ zone: 'CR', bar: 'outer', a: C.a, b: C.b, v0: V.outer0, v1: C.road1, row: ['l', 'l', 'l', 'l'], open: -1, tags: { role: 'freight-road' } });
  D.block({ zone: 'CY', bar: 'yard', a: C.a, b: C.b, v0: C.road1, v1: C.yard1, face: 0 });
  D.arcBar({ zone: 'CL', bar: 'quay', a: C.a, b: C.lB, v0: C.yard1, v1: C.quay1, row: ['l', 'l', 'l'], open: 1, tags: { role: 'import-quay' } });
  D.block({ zone: 'CQ', bar: 'quay', a: C.lB, b: C.b, v0: C.yard1, v1: C.quay1, face: 1 });
  D.megaAt('CQ', C.megaS, C.quay1, { role: 'mega' });

  // --- wysokie składy
  D.block({ zone: 'HB', bar: 'outer', a: Hs.a, b: Hs.b, v0: V.outer0, v1: Hs.v1, face: -1 });
  D.arcBar({ zone: 'HQ', bar: 'quay', a: Hs.a, b: Hs.b, v0: Hs.v1, v1: Hs.quay1, row: ['l', 'l', 'l', 'l'], open: 1, tags: { role: 'export' } });

  // --- zatoki ciężarówek (pobocze): rząd zewnętrzny (side +1) w ścianach między dokami, rząd przy ringu (side −1)
  const bayFits = (w, sw, len) => (w[1] - w[0]) * sw >= len + 120;
  const swOut = ringScale(V.outer0);
  const swIn = ringScale(V.inner1);
  const outerBays = [];
  // farma: odbiór płynów cysternami (po jednej zatoce na ścianę przepompowni)
  const farmGoods = [['fusion_fuel', 'PALIWO'], ['coolant', 'CHŁODZIWO'], ['oxygen', 'TLEN'], ['nitrogen', 'AZOT'], ['polymer', 'POLIMER']];
  wallsOf(D.pits, 'TR', F.a, F.b).forEach((w) => {
    if (!bayFits(w, swOut, 340)) return;
    outerBays.push({ w, list: farmGoods.splice(0, (w[1] - w[0]) * swOut > 1100 ? 2 : 1) });
  });
  // terminal: import do fabryk ringu (odbiór) i eksport z huty i elektroniki (dostawa)
  const ctGoods = [['nickel_superalloy', 'NADSTOP', 'out'], ['carbon_composite', 'KOMPOZYT', 'out'], ['pt_catalyst', 'KATALIZATOR', 'out'],
    ['fuel_rods', 'PRĘTY PALIWOWE', 'out'], ['chips', 'UKŁADY', 'in'], ['copper_wire', 'PRZEWÓD', 'in'], ['titan_alloy', 'STOP TYTANU', 'in']];
  wallsOf(D.pits, 'CR', C.a, C.b).forEach((w) => {
    if (!bayFits(w, swOut, 340)) return;
    outerBays.push({ w, list: ctGoods.splice(0, (w[1] - w[0]) * swOut > 1100 ? 2 : 1) });
  });
  for (const { w, list } of outerBays) {
    const n = list.length;
    list.forEach(([goods, label, dir], k) => {
      const s = w[0] + ((w[1] - w[0]) * (k + 0.5)) / n;
      D.truckBay({ s, side: 1, goods, dir: dir || 'out', label });
    });
  }
  // wysokie składy: rampy ciężarówek z fabryk ringu (dostawa do eksportu)
  const hsGoods = [['hull_plate', 'PŁYTY KADŁUBA'], ['avionics', 'AWIONIKA'], ['optic_lens', 'OPTYKA'], ['superconductor', 'TAŚMA NADPRZEW.'],
    ['drive_heavy', 'NAPĘDY'], ['weapon_mount', 'UZBROJENIE']];
  hsGoods.forEach(([goods, label], k) => {
    const s = Hs.a + 450 + k * ((Hs.b - Hs.a - 800) / (hsGoods.length - 1));
    D.truckBay({ s, side: 1, goods, dir: 'in', label });
  });
  // rząd przy ringu: punkt nadań (cztery rampy gracza) i stacja towarowa
  const pn = [];
  [[-3150, 'out', 'hull_plate', 'DO GRACZA'], [-2650, 'out', 'chips', 'DO GRACZA'], [-1950, 'in', 'fusion_fuel', 'OD GRACZA'], [-1450, 'in', 'steel', 'OD GRACZA']].forEach(([s, dir, goods, label]) => {
    const bay = D.truckBay({ s, side: -1, goods, dir, label });
    bay.player = true;
    pn.push(bay);
  });
  D.truckBay({ s: -550, side: -1, goods: 'carbon_composite', dir: 'out', label: 'KOMPOZYT' });
  D.truckBay({ s: 2150, side: -1, goods: 'pt_catalyst', dir: 'out', label: 'KATALIZATOR' });
  for (const [zone, a, b] of [['IA', -SK.sHalf, I.pnA], ['IC', I.stB, SK.sHalf]]) {
    const ws = wallsOf(D.pits, zone, a, b).filter((w) => bayFits(w, swIn, 340) && w[0] > a + 200 && w[1] < b - 10);
    const pick = ws.length ? ws[Math.floor(ws.length / 2)] : null;
    if (pick) D.truckBay({ s: (pick[0] + pick[1]) / 2, side: -1, goods: zone === 'IA' ? 'fuel_rods' : 'avionics', dir: zone === 'IA' ? 'out' : 'in', label: zone === 'IA' ? 'PRĘTY' : 'AWIONIKA' });
  }

  // --- TERMINAL KOLEI: cztery przystanki (najwięcej w ringu)
  D.railStop({ s: -5600, side: 1, len: 900, goods: 'fusion_fuel', dir: 'out', label: 'PALIWO FUZYJNE' });
  D.railStop({ s: 1100, side: 1, len: 900, goods: 'steel', dir: 'in', label: 'STAL NA EKSPORT' });
  D.railStop({ s: 800, side: -1, len: 900, goods: 'nickel_superalloy', dir: 'out', label: 'IMPORT DO FABRYK' });
  D.railStop({ s: 6500, side: 1, len: 900, goods: 'hull_plate', dir: 'in', label: 'PŁYTY KADŁUBA' });

  // nadproża nad drogą nie stają w wylotach doków (słupy na licach rzędów)
  const lintelSkip = [];
  for (const p of D.pits) {
    if (p.orient !== 'arc') continue;
    const atRoad = (p.open > 0 && Math.abs(p.v1 - V.inner1) < 1) || (p.open < 0 && Math.abs(p.v0 - V.outer0) < 1);
    if (atRoad) lintelSkip.push([p.s0 - 160, p.s1 + 160]);
  }

  return D.finish({
    sk: SK,
    lintelSkip,
    playerBays: pn,
    placeLabels: { district: 'SKŁADY' }
  });
}
