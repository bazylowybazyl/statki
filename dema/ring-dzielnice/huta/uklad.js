// HUTA — układ dzielnicy ringu Ziemi, wersja „widoczny proces” (czysta matematyka; kontrakt: dema/ring-dzielnice/README.md).
//
// Decyzje użytkownika (2026-11-13): cały proces ma być widoczny i fizyczny — od surowca po gotowy wyrób. Ruda przychodzi
// od strony kosmosu w postaci sypkiej: statek staje dziobem do nabrzeża, „odkurzacz” na pirsie wysysa ładownię i wyrzuca
// rudę do zasieku, gdzie rośnie kopiec. Każdy metal ma swój kolor i swój zsyp. Z zasieku ruda jedzie przenośnikiem do
// pieca, piec topi, kadź wiezie ciekły metal do odlewni, kęsisko idzie przez klatki walcownicze, zwijarka robi krąg.
// Wyroby zabierają ciężarówki, które wjeżdżają do huty z drogi przy ringu. Wzór wyglądu: dwa obrazy użytkownika
// (.tmp/huta/wzor/) — ośmiokątne piece z żarem, tor kadzi, hala walcowni z trzema klatkami, kręgi, suwnice bramowe.
//
// Ekonomia (rola „Huta”, src/data/resources.js): ruda żelaza 3 → stal 2 · ruda miedzi 3 → przewód 2 · ruda glinu 3 →
// glin 2 · ruda tytanu 4 + glin 1 → stop tytanu 2 · ruda glinu 2 + ruda węglista 1 → ceramika pancerna 1.
//
// Układ: rzędy przy drodze zostają (przekrój ringu), w rzędzie zewnętrznym dwie BRAMY ciężarówek (wjazd, wyjazd).
// Za rzędem ZAKŁAD w układzie prostym (x — wzdłuż ringu, z — w przestrzeń; pz = z − 6 300):
//   pz    0…1 200  PLAC WYROBÓW: pas ciężarówek, regały kręgów, suwnice bramowe
//   pz 1 200…3 700  CZĘŚĆ GORĄCA: hala walcowni (odlewnia, piec grzewczy, trzy klatki, zwijarka), pętla kadzi, cztery piece,
//                   piec tunelowy ceramiki
//   pz 3 700…4 750  ZASIEKI: pięć zasieków z kopcami (jeden na rudę)
//   pz 4 750…5 150  NABRZEŻE; dalej pięć pirsów z odkurzaczami i stanowiska statków dziobem do nabrzeża
// Pięć TORÓW (x = −3 760 … 3 760 co 1 880): statek → odkurzacz → kopiec → przenośnik → piec → wspólna walcownia → plac.
import { RING_V, createDistrict, ringScale, yardPoint } from '../kit/uklad.js';
import { makePath } from './sciezki.js';

const R0 = 43752;
const Z0 = RING_V.outer1;       // 6 300: tylne lico rzędu zewnętrznego na osi dzielnicy

export const PLANT = Object.freeze({
  z0: Z0,
  top: -240,                    // podstawa zakładu wchodzi pod rząd (łuk rzędu odchodzi od prostej o ~220 j. na skrzydłach)
  halfW: 4700,
  yard: Object.freeze([0, 1200]),
  hot: Object.freeze([1200, 3700]),
  bunk: Object.freeze([3700, 4750]),
  quay: Object.freeze([4750, 5150]),
  depth: 5150,
  gateX: 4250,                  // oś ulicy bramy w zakładzie (±)
  gateW: 340,
  laneZ: 300,                   // pas ciężarówek na placu (pz)
  bayZ: 430                     // zatoki załadunku przy regałach (pz)
});

/** Barwy liniowe [r, g, b] rudy i metalu każdego toru (inny metal = inny kolor). */
export const LANES = Object.freeze([
  Object.freeze({ id: 'stal', name: 'STAL', ore: 'iron_ore', oreName: 'RUDA ŻELAZA', out: 'steel', product: 'coil',
    oreColor: [0.3, 0.085, 0.04], metal: [0.46, 0.5, 0.56], need: 90 }),
  Object.freeze({ id: 'miedz', name: 'MIEDŹ', ore: 'copper_ore', oreName: 'RUDA MIEDZI', out: 'copper_wire', product: 'coil',
    oreColor: [0.05, 0.22, 0.155], metal: [0.85, 0.34, 0.12], need: 90 }),
  Object.freeze({ id: 'glin', name: 'GLIN', ore: 'aluminum_ore', oreName: 'RUDA GLINU', out: 'aluminum', product: 'coil',
    oreColor: [0.42, 0.25, 0.075], metal: [0.92, 0.94, 0.96], need: 90 }),
  Object.freeze({ id: 'tytan', name: 'TYTAN', ore: 'titanium_ore', oreName: 'RUDA TYTANU', out: 'titan_alloy', product: 'pack',
    oreColor: [0.125, 0.085, 0.225], metal: [0.56, 0.5, 0.74], need: 120, ingots: 30 }),
  Object.freeze({ id: 'ceramika', name: 'CERAMIKA', ore: 'carbon_ore', oreName: 'RUDA WĘGLISTA', out: 'ceramic_armor', product: 'plate',
    oreColor: [0.028, 0.028, 0.032], metal: [1.0, 0.94, 0.8], need: 3, needAlu: 6 })
]);
export const LANE_PITCH = 1880;
export const laneX = (i) => (i - 2) * LANE_PITCH;

/** Ładownia ciężkiego frachtowca (sprite 1774 px = 1 800 j.): 8 kolumn × 3 rzędy pól, w osi statku (+ = dziób). */
export const SHIP_HOLD = Object.freeze({ cols: 8, rows: 3, x0: 211, pitchX: 85, pitchY: 115, length: 1800 });

const P = (x, pz, y) => (y === undefined ? [x, Z0 + pz] : [x, Z0 + pz, y]);
const rectPts = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Wolne odcinki lica rzędu (między wylotami doków) — środki miejsc na zatokę ciężarówek długości `len`. */
function freeSpots(pits, face, a, b, len, margin = 110) {
  const cuts = pits.filter((p) => p.orient === 'arc' && Math.abs((p.open > 0 ? p.v1 : p.v0) - face) < 1 && p.s1 > a && p.s0 < b).map((p) => [p.s0, p.s1]).sort((p, q) => p[0] - q[0]);
  const need = (len + 2 * margin) / ringScale(face);
  const out = [];
  let cur = a;
  for (const [c0, c1] of cuts.concat([[b, b]])) {
    if (c0 - cur >= need) out.push((cur + c0) / 2);
    cur = Math.max(cur, c1);
  }
  return out;
}

export function buildHutaLayout() {
  const V = RING_V;
  const S = 8200;
  const D = createDistrict({ id: 'huta', sHalf: S });
  const PL = PLANT;

  // --- bramy ciężarówek: ulica promieniowa przez rząd zewnętrzny, w zakładzie prosto do pasa placu
  const gateS = R0 * Math.asin(PL.gateX / (R0 + Z0));           // łuk s osi ulicy (na v = 6 300 ulica ma x = ±gateX)
  const gateHalf = PL.gateW / 2 / ringScale(V.outer0);
  D.opening(-gateS - gateHalf, -gateS + gateHalf, 'brama wjazdowa');
  D.opening(gateS - gateHalf, gateS + gateHalf, 'brama wyjazdowa');

  // --- rząd przy ringu: wnęki dla małych statków (biura, obsługa)
  D.arcBar({ zone: 'HI', bar: 'inner', a: -S, b: S, v0: V.inner0, v1: V.inner1, open: 1,
    row: ['m', 's', 's', 'l', 'm', 's', 'm', 'l', 's', 's', 'm', 'l', 'm', 's'] });
  // --- rząd zewnętrzny: hale wysyłki statkami (większe partie), przecięty dwiema bramami
  D.arcBar({ zone: 'HL', bar: 'outer', a: -S, b: -gateS - gateHalf, v0: V.outer0, v1: V.outer1, open: -1, row: ['l', 'm', 'l', 'm'], tags: { role: 'wyroby' } });
  D.arcBar({ zone: 'HS', bar: 'outer', a: -gateS + gateHalf, b: gateS - gateHalf, v0: V.outer0, v1: V.outer1, open: -1, row: ['l', 'l', 'drydock', 'l', 'l'], tags: { role: 'wyroby' } });
  D.arcBar({ zone: 'HR', bar: 'outer', a: gateS + gateHalf, b: S, v0: V.outer0, v1: V.outer1, open: -1, row: ['m', 'l', 'm', 'l'], tags: { role: 'wyroby' } });

  // --- zakład: jedna bryła kolizji (statki tam nie latają), pirsy osobno
  D.addSolid('HUTA zakład', 'bar', 'HZ', rectPts(-PL.halfW, Z0 + PL.top, PL.halfW, Z0 + PL.depth));

  // --- pięć torów rudy
  const lanes = LANES.map((def, i) => {
    const x = laneX(i);
    const berthZ = Z0 + PL.depth + 1080;                         // środek statku: dziób 180 j. od nabrzeża
    const pier = { x0: x + 410, x1: x + 550, z0: Z0 + PL.depth, z1: Z0 + PL.depth + 2000 };
    D.addSolid(`HUTA pirs ${i + 1}`, 'finger', 'HZ', rectPts(pier.x0, pier.z0, pier.x1, pier.z1));
    const berth = { navy: false, yard: false, role: 'ruda', id: `HZ-R${i + 1}`, cls: 'capital', kind: 'ore', zone: 'HZ', x, z: berthZ, s: 0, v: 0, heading: -Math.PI / 2, length: 2000, width: 720, lane: i };
    D.berths.push(berth);
    // pola ładowni w świecie: kolumna c (0 = od dziobu, bliżej nabrzeża), rząd r (−1, 0, 1)
    const cells = [];
    for (let c = 0; c < SHIP_HOLD.cols; c++) {
      for (let r = 0; r < SHIP_HOLD.rows; r++) {
        // wężykiem: ssawa nie wraca przez całą szerokość
        const rr = c % 2 ? SHIP_HOLD.rows - 1 - r : r;
        cells.push({ c, r: rr, x: x + (rr - 1) * SHIP_HOLD.pitchY, z: berthZ - (SHIP_HOLD.x0 - SHIP_HOLD.pitchX * (c + 0.5)) });
      }
    }
    const lane = {
      index: i, ...def, x,
      bunker: { x0: x - 850, x1: x + 850, z0: Z0 + 3760, z1: Z0 + 4690, floor: -60, wall: 150 },
      mound: { x: x + 60, z: Z0 + 4250 },
      spout: { x: x + 330, z: Z0 + 4610, y: 300 },
      blower: { x: x + 480, z: Z0 + 4950 },
      pier, berth, cells,
      gantry: { x: x + 480, park: Z0 + PL.depth + 230, z0: cells[0].z, z1: cells[cells.length - 1].z }
    };
    if (i < 4) {
      lane.furnace = { x, z: Z0 + 3050, r: 410, pool: 285 };
      lane.tap = { x, z: Z0 + 2420 };                            // postój kadzi pod rynną spustową
      lane.runner = [[x, Z0 + 2640], [x, Z0 + 2500]];
      // przenośnik zasypowy: spod kopca, w górę galerią, nad koronę pieca
      lane.feed = makePath([P(x - 560, 4000, 20), P(x - 560, 3610, 300), P(x - 250, 3270, 350), P(x - 150, 3170, 350)]);
    } else {
      // ceramika: mieszalnia i prasa, piec tunelowy ku placowi
      lane.kiln = { x, mixer: { x, z: Z0 + 3500 }, z0: Z0 + 3300, z1: Z0 + 1560, width: 260 };
      lane.feed = makePath([P(x - 560, 4000, 20), P(x - 560, 3640, 240), P(x - 60, 3540, 260)]);
    }
    return lane;
  });
  // przenośnik rudy glinu do mieszalni ceramiki (korytarzem między piecami a zasiekami) i wlewków glinu do pieca tytanu
  const cross = makePath([P(laneX(2) + 620, 4000, 20), P(laneX(2) + 620, 3640, 110), P(laneX(4) - 380, 3640, 110), P(laneX(4) - 380, 3520, 240), P(laneX(4) - 60, 3520, 260)], { radius: 60 });
  const ingots = { x: laneX(2) + 640, z: Z0 + 3050 };          // stos wlewków glinu przy piecu glinu
  const ingotFeed = makePath([P(ingots.x + 80, 3050, 60), P(laneX(3) - 760, 3050, 60), P(laneX(3) - 360, 3050, 350), P(laneX(3) - 240, 3050, 350)]);

  // --- pętla kadzi: tor zamknięty, jazda w jedną stronę (pełne kadzie ku zachodowi dolnym torem, puste wracają górnym)
  const loop = makePath([P(-4420, 2160), P(2550, 2160), P(2550, 2420), P(-4420, 2420)], { closed: true, radius: 130 });
  const caster = { x: -4150, z: Z0 + 2160, tundish: P(-4150, 2010), exit: P(-3950, 1650) };
  const loopD = {
    cast: loop.nearest(caster.x, caster.z),
    taps: lanes.slice(0, 4).map((l) => loop.nearest(l.tap.x, l.tap.z))
  };
  loopD.park = loop.nearest(1500, Z0 + 2160);                  // postój pustych kadzi: tor powrotny, przed nawrotem ku piecom

  // --- linia walcownicza: u — droga czoła kęsiska od wyjścia z odlewni, ku +x na pz = 1 650
  const line = {
    x0: -3950, z: Z0 + 1650,
    reheat: [350, 850],
    stands: [1450, 2450, 3450],
    coiler: 5150, stacker: 5400, end: 5550,
    lens: [300, 465, 721, 1117], ths: [40, 24.8, 15.4, 9.5], width: 110
  };
  const hall = { x0: -4450, x1: 1800, z0: Z0 + 1330, z1: Z0 + 1970 };

  // --- plac wyrobów: samotoki od zwijarki do regałów, regały (kolejność zapełniania: od najdalszego miejsca), suwnice
  const convZ = Z0 + 1090;
  const rackRows = [555, 690, 825, 960].map((pz) => Z0 + pz);
  const mkRack = (laneIdx, xNear, xFar, pitch = 150) => {
    const dir = xFar > xNear ? 1 : -1;
    const cols = Math.floor(Math.abs(xFar - xNear) / pitch);
    const slots = [];
    for (let c = cols - 1; c >= 0; c--) for (const z of rackRows) slots.push({ x: xNear + dir * pitch * (c + 0.5), z });
    const x0 = Math.min(xNear, xFar);
    const x1 = Math.max(xNear, xFar);
    // postój naczepy: środek regału, ale z zapasem na zjazd i wyjazd przed zakrętami bram
    const stopX = Math.max(-PL.gateX + 760, Math.min(PL.gateX - 760, (x0 + x1) / 2));
    return { lane: laneIdx, x0, x1, slots, stop: { x: stopX, z: Z0 + PL.bayZ } };
  };
  const racks = [
    mkRack(0, -2700, -4050),      // stal — najdalej na zachód
    mkRack(1, -1450, -2500),      // miedź
    mkRack(2, -150, -1250),       // glin — najbliżej zwijarki
    mkRack(3, 1750, 3000),        // tytan — pakiety blach, na wschód
    mkRack(4, 3250, 4050)         // ceramika — płyty z pieca tunelowego
  ];
  const xCoil = line.x0 + line.coiler;                          // 1 200
  const xStack = line.x0 + line.stacker;                        // 1 450
  const yardLines = {
    // wejście na samotok placu: z hali na pz 1 090, dalej wzdłuż regałów
    west: { entry: [[xCoil, line.z], [xCoil, convZ]], z: convZ, dir: -1 },
    east: { entry: [[xStack, line.z], [xStack + 150, line.z], [xStack + 150, convZ]], z: convZ, dir: 1 },
    kiln: { entry: [[laneX(4), Z0 + 1560], [laneX(4), convZ]], z: convZ, dir: 0 }
  };
  const cranes = [
    { id: 'S1', x0: -4300, x1: -100, home: -2300, z0: Z0 + 150, z1: Z0 + 1150, racks: [0, 1, 2] },
    { id: 'S2', x0: 1550, x1: 4350, home: 2700, z0: Z0 + 150, z1: Z0 + 1150, racks: [3, 4] }
  ];

  // --- trasa ciężarówek: pobocze drogi → brama wjazdowa → pas placu → brama wyjazdowa → pobocze (ruch prawostronny, ku +s)
  // Każdy regał ma ZATOKĘ załadunku obok pasa (pz 430): ciężarówka zjeżdża z pasa, staje pod suwnicą, wraca na pas —
  // jadący dalej jej nie czekają. `main` — trasa bez zatok (miara postępu do odstępów), `routes[r]` — trasa do regału r.
  const vSh = V.road + V.shoulderOff;
  const laneZ = Z0 + PL.laneZ;
  const bayZ = Z0 + PL.bayZ;
  const head = [];
  for (let s = -S + 500; s < -gateS - 400; s += 400) head.push(yardPoint(s, vSh));
  head.push(yardPoint(-gateS - 150, vSh), yardPoint(-gateS, vSh + 260), yardPoint(-gateS, V.outer1 - 60), [-PL.gateX, laneZ]);
  const tail = [[PL.gateX, laneZ], yardPoint(gateS, V.outer1 - 60), yardPoint(gateS, vSh + 260), yardPoint(gateS + 150, vSh)];
  for (let s = gateS + 400; s <= S - 500; s += 400) tail.push(yardPoint(s, vSh));
  const main = makePath([...head, ...tail], { radius: 190 });
  const routes = racks.map((r) => makePath([...head, [r.stop.x - 520, laneZ], [r.stop.x - 270, bayZ], [r.stop.x + 270, bayZ], [r.stop.x + 520, laneZ], ...tail], { radius: 190 }));
  const truck = {
    main, routes, laneZ, bayZ,
    yard0: main.nearest(...yardPoint(-gateS, vSh + 260)),        // od tego miejsca jazda wolna (ulica i plac)
    yard1: main.nearest(...yardPoint(gateS, vSh + 260)),
    stops: racks.map((r, i) => routes[i].nearest(r.stop.x, bayZ))   // środek naczepy pod suwnicą
  };

  // --- transport po ringu w deklaracjach zestawu: postoje przed bramą i za bramą, przystanki kolei
  const outerSpots = freeSpots(D.pits, V.outer0, -S + 150, S - 150, 300, 70);
  const pick = (list, s) => list.reduce((best, q) => (Math.abs(q - s) < Math.abs(best - s) ? q : best), list[0]);
  D.truckBay({ s: pick(outerSpots.filter((q) => q < -gateS - 300), -gateS - 900), side: 1, len: 300, goods: 'steel', dir: 'out', label: 'POSTÓJ · WJAZD' });
  D.truckBay({ s: pick(outerSpots.filter((q) => q > gateS + 300), gateS + 900), side: 1, len: 300, goods: 'steel', dir: 'out', label: 'POSTÓJ · WYJAZD' });
  D.railStop({ s: -1500, side: 1, len: 1100, goods: 'steel', dir: 'out', label: 'STAL' });
  D.railStop({ s: 1500, side: 1, len: 1100, goods: 'copper_wire', dir: 'out', label: 'PRZEWÓD' });

  const zone = (pz) => (pz < PL.yard[1] ? 'plac' : pz < PL.hot[1] ? 'goraca' : pz < PL.bunk[1] ? 'zasieki' : 'nabrzeze');
  return D.finish({
    huta: { Z0, plant: PL, gateS, gateHalf, lanes, cross, ingots, ingotFeed, loop, loopD, caster, line, hall, convZ, racks, yardLines, cranes, truck, xCoil, xStack },
    placeLabels: { district: 'HUTA', plac: 'HUTA · PLAC WYROBÓW', goraca: 'HUTA · PIECE I WALCOWNIA', zasieki: 'HUTA · ZASIEKI RUDY', nabrzeze: 'HUTA · NABRZEŻE RUDY' },
    /** Opis miejsca: strefy zakładu i nabrzeże z pirsami. */
    locate(x, z, arc, out) {
      const pz = z - Z0;
      if (Math.abs(x) > PL.halfW || pz < PL.top || pz > PL.depth + 2100) return false;
      out.place = zone(pz);
      out.inside = pz > PL.depth ? 0.5 : 0.4;
      return true;
    }
  });
}
