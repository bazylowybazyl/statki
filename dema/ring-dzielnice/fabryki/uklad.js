// DZIELNICA „FABRYKI PODZESPOŁÓW PRZY STOCZNI” — UKŁAD (czysta matematyka, bez three i DOM).
//
// Odcinek ringu Ziemi 14 000 j. łuku tuż przy stoczni (stocznia leży za prawym końcem, s > +7 000). Dzielnica robi
// wszystko, co stocznia montuje w kadłub — role ekonomii „Stocznia” bez pochylni i „Zakłady systemowe”. Od lewej:
//   Z-1 WALCOWNIA I PRASOWNIA (s −7 000 … −3 000): płyty kadłuba, podstawy uzbrojenia; plac płyt pod suwnicami;
//   Z-2 NAPĘDY (s −3 000 … +1 800): silniki manewrowe, napędy przelotowe, hipercruise, warp; MOLO HAMOWNI wystaje
//       w przestrzeń (v 7 600 … 11 400), cztery stanowiska prób z dyszami ku przestrzeni, suwnica wozi silniki;
//   Z-3 REAKTORY I EMITERY TARCZ (s +1 800 … +5 000): osłonięte komory, stanowisko prób emitera, skład importu
//       z pasem MEGA od strony przestrzeni (nadstop, kompozyt, katalizator, chłodziwo, pręty paliwowe);
//   Z-4 AWIONIKA I PODTRZYMYWANIE ŻYCIA (s +5 000 … +7 000).
// Rząd przy ringu: składy wsadu z dokami S / M. Każdy zakład ma od drogi pas z dokami dostaw (L / M).
// Transport po ringu: zatoki ciężarówek (side +1 — odbiór ku stoczni, ruch ku +s; side −1 — dostawy),
// przystanki kolei (stal do walcowni, taśma nadprzewodząca do reaktorów; odbiór napędów warp i rdzeni reaktorów).
import { RING_V, YARD_R0, createDistrict, ringScale, yardPoint, yardRadial, yardTangent } from '../kit/uklad.js';

export const FAB_SHALF = 7000;

/** Zakłady rzędu zewnętrznego: zakres łuku, pas doków od drogi (v do `belt`), korpus za pasem (v do `deep`). */
export const FAB_PLANTS = Object.freeze([
  Object.freeze({ key: 'A', no: 1, name: 'WALCOWNIA I PRASOWNIA', small: 'PŁYTY KADŁUBA · PODSTAWY UZBROJENIA', a: -7000, b: -3000, belt: 4700, deep: 8000, docks: ['l', 'l'], role: 'walcownia' }),
  Object.freeze({ key: 'B', no: 2, name: 'NAPĘDY', small: 'MANEWROWE · PRZELOTOWE · HIPERCRUISE · WARP', a: -3000, b: 1800, belt: 4800, deep: 7600, docks: ['l', 'm', 'l'], role: 'napedy' }),
  Object.freeze({ key: 'C', no: 3, name: 'REAKTORY I EMITERY TARCZ', small: 'RDZENIE REAKTORÓW · EMITERY TARCZ', a: 1800, b: 5000, belt: 4600, deep: 7400, docks: ['m', 'l'], role: 'reaktory' }),
  Object.freeze({ key: 'D', no: 4, name: 'AWIONIKA', small: 'AWIONIKA · PODTRZYMYWANIE ŻYCIA', a: 5000, b: 7000, belt: 4400, deep: 6600, docks: ['m', 's'], role: 'awionika' })
]);

/** Molo hamowni (zakład B): wycinek łuku, oś promieniowa w s = `sc`. */
export const FAB_PIER = Object.freeze({ s0: -2200, s1: 1000, sc: -600, v0: 7600, v1: 11400 });

/**
 * Stanowiska prób hamowni: `c` — przesunięcie w poprzek osi mola [j.], dysza w licu mola (v1) skierowana w przestrzeń.
 * `flame` — największa długość płomienia [j.], `w` — szerokość płomienia przy dyszy, `nozzles` — liczba dysz.
 */
export const FAB_STANDS = Object.freeze([
  Object.freeze({ id: 'H-1', c: -1275, goods: 'thruster', name: 'MANEWROWE', len: 220, r: 46, nozzles: 2, flame: 900, w: 90, color: 'warm', work: 14, rest: 22 }),
  Object.freeze({ id: 'H-2', c: -425, goods: 'drive_light', name: 'PRZELOTOWY LEKKI', len: 300, r: 66, nozzles: 1, flame: 1500, w: 150, color: 'cyan', work: 20, rest: 26 }),
  Object.freeze({ id: 'H-3', c: 425, goods: 'drive_heavy', name: 'PRZELOTOWY CIĘŻKI', len: 420, r: 92, nozzles: 1, flame: 2250, w: 230, color: 'cyan', work: 26, rest: 30 }),
  Object.freeze({ id: 'H-4', c: 1275, goods: 'hypercruise_mk2', name: 'HIPERCRUISE', len: 380, r: 86, nozzles: 1, flame: 2150, w: 210, color: 'white', work: 22, rest: 34 })
]);

/** Rama prosta przy łuku: początek `yardPoint(s, v)`, oś `t` — styczna (ku +s), `n` — promień (ku +v). */
export function arcFrame(s, v) {
  const o = yardPoint(s, v);
  const ht = yardTangent(s);
  const hr = yardRadial(s);
  const t = [Math.cos(ht), Math.sin(ht)];
  const n = [Math.cos(hr), Math.sin(hr)];
  return { o, t, n, s, v, at: (a, c) => [o[0] + t[0] * a + n[0] * c, o[1] + t[1] * a + n[1] * c] };
}

/** Rama mola hamowni: `a` — od lica zakładu wzdłuż osi mola (ku przestrzeni), `c` — w poprzek (ku +s). */
export function pierFrame() {
  const F = arcFrame(FAB_PIER.sc, FAB_PIER.v0);
  // oś wzdłuż promienia: a ↦ n, c ↦ t
  return { o: F.o, d: F.n, n: F.t, at: (a, c) => [F.o[0] + F.n[0] * a + F.t[0] * c, F.o[1] + F.n[1] * a + F.t[1] * c], heading: yardRadial(FAB_PIER.sc) };
}

/**
 * Place odkładcze pod suwnicami bramowymi: rama prosta (oś jazdy suwnicy `along`, rozpiętość w poprzek `span`),
 * `a0…a1` — zakres jazdy, `slots` — miejsca odkładania (a, c). Na łuku: oś jazdy = styczna w środku placu
 * (strzałka łuku na 3 000 j. ~26 j. — mieści się w zapasie).
 */
function yardOnArc(id, label, s0, s1, v0, v1, gantries, extra = {}) {
  const sc = (s0 + s1) / 2;
  const vc = (v0 + v1) / 2;
  const F = arcFrame(sc, vc);
  const half = ((s1 - s0) / 2) * ringScale(v0);
  return { id, label, kind: 'arc', s0, s1, v0, v1, sc, vc, frame: F, axis: F.t, cross: F.n, half, a0: -half + 160, a1: half - 160, span: v1 - v0 - 120, gantries, ...extra };
}

const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Miejsca odkładania na placu (a, c, rodzaj towaru): siatka z ziarna. Pas przy krawędzi c = −span/2 (od strony hali)
 * zostaje wolny — tam suwnica odbiera z hali i oddaje do wysyłki (`yard.handoff`).
 */
function yardSlots(yard) {
  const out = [];
  if (yard.kind === 'pier') {
    for (let a = 520; a <= 2300; a += 340) {
      for (let c = -1200; c <= 1200; c += 600) {
        const h = hash1(a * 0.013 + c * 0.0071 + 4.2);
        const kind = h < 0.22 ? 'thruster' : h < 0.42 ? 'drive_light' : h < 0.62 ? 'drive_heavy' : h < 0.8 ? 'hypercruise_mk2' : 'warp_mk2';
        out.push({ a, c, kind });
      }
    }
    return out;
  }
  const da = yard.id === 'D' ? 260 : 340;
  const dc = yard.id === 'D' ? 200 : 260;
  const c0 = -yard.span / 2 + 300;
  const c1 = yard.span / 2 - 110;
  const n = Math.max(1, Math.floor((yard.a1 - yard.a0 - 160) / da));
  const m = Math.max(1, Math.floor((c1 - c0) / dc) + 1);
  for (let i = 0; i < n; i++) {
    const a = yard.a0 + 80 + ((yard.a1 - yard.a0 - 160) * (i + 0.5)) / n;
    for (let j = 0; j < m; j++) {
      const c = m > 1 ? c0 + ((c1 - c0) * j) / (m - 1) : (c0 + c1) / 2;
      const h = hash1(a * 0.017 + c * 0.0093 + yard.id.charCodeAt(0));
      if (h < 0.12) continue;           // puste miejsce — plac nie jest pełny
      let kind = yard.goods[0];
      if (yard.id === 'A') kind = i >= n - 2 ? 'weapon_mount' : 'hull_plate';
      else if (yard.id === 'D') kind = h < 0.55 ? 'avionics' : 'life_support';
      out.push({ a, c, kind });
    }
  }
  return out;
}

export function buildFabrykiLayout() {
  const D = createDistrict({ id: 'fabryki', sHalf: FAB_SHALF });
  const V = RING_V;

  // --- rząd przy ringu: składy wsadu z dokami S / M (wnęki otwarte na drogę); przerwy na zatoki i windy kolei
  const inner = [
    { a: -7000, b: -4700 },
    { a: -4700, b: -1550, row: ['m', 's', 'm', 's'], role: 'wsad-walcowni' },
    { a: -1550, b: -1050 },
    { a: -1050, b: 2450, row: ['m', 'm', 's', 'm'], role: 'wsad-napedow' },
    { a: 2450, b: 4150 },
    { a: 4150, b: 5750, row: ['m', 's', 'm'], role: 'wsad-systemow' },
    { a: 5750, b: 7000 }
  ];
  for (const g of inner) {
    if (g.row) D.arcBar({ zone: 'I', bar: 'inner', a: g.a, b: g.b, v0: V.inner0, v1: V.inner1, row: g.row, open: 1, tags: { role: g.role } });
    else D.block({ zone: 'I', bar: 'inner', a: g.a, b: g.b, v0: V.inner0, v1: V.inner1, face: 1 });
  }

  // --- rząd zewnętrzny: zakłady (pas doków od drogi + korpus hal i placów)
  for (const P of FAB_PLANTS) {
    D.arcBar({ zone: P.key, bar: 'pas dostaw', a: P.a, b: P.b, v0: V.outer0, v1: P.belt, row: P.docks, open: -1, tags: { role: P.role } });
    D.block({ zone: P.key + 'H', bar: 'hale', a: P.a, b: P.b, v0: P.belt, v1: P.deep, face: 0 });
  }
  // molo hamowni (zakład B) i pas MEGA importu (zakład C)
  D.block({ zone: 'BP', bar: 'molo hamowni', a: FAB_PIER.s0, b: FAB_PIER.s1, v0: FAB_PIER.v0, v1: FAB_PIER.v1, face: 0 });
  const plantC = FAB_PLANTS[2];
  const mega = D.megaAt('CH', 3400, plantC.deep, { role: 'import' });

  // --- transport po ringu: zatoki ciężarówek (pobocze) i przystanki kolei (kratownica)
  // odbiór ku stoczni (side +1: ruch ku +s, stocznia za prawym końcem dzielnicy)
  D.truckBay({ s: -5000, side: 1, goods: 'hull_plate', dir: 'out', label: 'PŁYTY KADŁUBA' });
  D.truckBay({ s: -3500, side: 1, goods: 'weapon_mount', dir: 'out', label: 'PODSTAWY UZBR.' });
  D.truckBay({ s: 0, side: 1, goods: 'thruster', dir: 'out', label: 'SILNIKI MAN.' });
  D.truckBay({ s: 1400, side: 1, goods: 'drive_light', dir: 'out', label: 'NAPĘDY LEKKIE' });
  D.truckBay({ s: 2200, side: 1, goods: 'shield_generator', dir: 'out', label: 'EMITERY TARCZ' });
  D.truckBay({ s: 6083, side: 1, goods: 'avionics', dir: 'out', label: 'AWIONIKA' });
  D.truckBay({ s: 6778, side: 1, goods: 'life_support', dir: 'out', label: 'PODTRZ. ŻYCIA' });
  // dostawy z huty, elektroniki i składów (side −1, lico rzędu przy ringu)
  D.truckBay({ s: -6600, side: -1, goods: 'aluminum', dir: 'in', label: 'STOP GLINU' });
  D.truckBay({ s: -6100, side: -1, goods: 'titan_alloy', dir: 'in', label: 'STOP TYTANU' });
  D.truckBay({ s: -1300, side: -1, goods: 'copper_wire', dir: 'in', label: 'PRZEWÓD MIEDZ.' });
  D.truckBay({ s: 2700, side: -1, goods: 'ceramic_armor', dir: 'in', label: 'CERAMIKA' });
  D.truckBay({ s: 6000, side: -1, goods: 'chips', dir: 'in', label: 'UKŁADY' });
  D.truckBay({ s: 6550, side: -1, goods: 'optic_lens', dir: 'in', label: 'SOCZEWKI' });
  // kolej: stal (wsad walcowni) i taśma nadprzewodząca z elektroniki; odbiór dużych modułów do stoczni
  D.railStop({ s: -5200, side: -1, goods: 'steel', dir: 'in', label: 'STAL — WSAD WALCOWNI' });
  D.railStop({ s: 3600, side: -1, goods: 'superconductor', dir: 'in', label: 'TAŚMA NADPRZEW.' });
  D.railStop({ s: -1222, side: 1, goods: 'warp_mk2', dir: 'out', label: 'NAPĘDY WARP · CIĘŻKIE' });
  D.railStop({ s: 4625, side: 1, goods: 'reactor_core', dir: 'out', label: 'RDZENIE REAKTORÓW' });

  // --- place odkładcze pod suwnicami
  const yards = [
    yardOnArc('A', 'PLAC PŁYT', -6850, -3150, 6750, 7900, 2, { goods: ['hull_plate', 'weapon_mount'] }),
    yardOnArc('C', 'PLAC RDZENI', 1950, 2980, 6450, 7300, 1, { goods: ['reactor_core'] }),
    yardOnArc('D', 'PLAC SYSTEMÓW', 5150, 6850, 5650, 6450, 1, { goods: ['avionics', 'life_support'] })
  ];
  const P = pierFrame();
  const pierYard = {
    id: 'B', label: 'PLAC NAPĘDÓW', kind: 'pier', frame: P, axis: P.d, cross: P.n, a0: 300, a1: 3480, span: 3400, gantries: 1,
    goods: ['thruster', 'drive_light', 'drive_heavy', 'hypercruise_mk2', 'warp_mk2']
  };
  yards.push(pierYard);
  for (const y of yards) {
    y.slots = yardSlots(y);
    // punkt przekazania (odbiór z hali / wysyłka): przy krawędzi placu od strony hali
    y.handoff = y.kind === 'pier' ? { a: 360, c: 0 } : { c: -y.span / 2 + 140 };
  }
  const stands = FAB_STANDS.map((S, i) => {
    // lico mola to łuk: oś stanowiska (prosta) przecina go w a = √((R0 + v1)² − c²) − (R0 + v0)
    const edge = Math.sqrt((YARD_R0 + FAB_PIER.v1) ** 2 - S.c * S.c) - (YARD_R0 + FAB_PIER.v0);
    const nozzle = P.at(edge, S.c);
    const tip = P.at(edge + S.flame, S.c);
    return { ...S, index: i, edge, nozzle, tip, heading: P.heading, a: edge - 40 - S.len / 2 };
  });

  // dok z ruchem: ostatni dok L zakładu napędów (statek dostaw wpływa i wypływa — proxy, nie stoi na stałe)
  const visitPit = D.pits.filter((p) => p.zone === 'B' && p.cls === 'l').pop();

  return D.finish({
    plants: FAB_PLANTS,
    pier: FAB_PIER,
    stands,
    yards,
    mega,
    visitBerth: visitPit.berth.id,
    placeLabels: { district: 'FABRYKI PODZESPOŁÓW' }
  });
}
