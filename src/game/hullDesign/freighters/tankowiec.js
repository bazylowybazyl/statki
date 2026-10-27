// src/game/hullDesign/freighters/tankowiec.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// TANKOWIEC — przewoźnik gazu: „paciorki na sznurku”. Cztery wielkie kule ładunku na osi, każda w ośmiokątnej kołysce
// (burta wybrzuszona przy kuli) z fosą wokół kuli (płyty zdjęte — rury i kable obiegają kulę), między kołyskami
// przewężenia kilu z dyszami SIDE; wzdłuż osi biegnie jeden rów — kręgosłup od rufy po dziób. Rufa: wąska nadbudówka
// z mostkiem, zbiornikiem paliwa i parą gondol; śródokręcie: kolektor (maszynownia z rdzeniem) między 2. a 3. kulą;
// dziób — klin 45°.

import {
  freighter, blk, frameBlk, cutBlk, engine, reactor, bridge, fuelTank, side, spheres, vent, grate, hatch, label, stripe, TO_BOW
} from './freighterKit.js';

const G = 2;                     // siatka klocków [j.]
const BEAD_HX = 56;              // pół-długość kołyski kuli
const BEAD_Y = 58;               // burta kołyski (od osi)
const BEAD_C = 20;               // faza rogów kołyski
const AXIS = 6;                  // pół-szerokość rowu wzdłuż osi
const BEADS = [-152, -24, 128, 256];   // środki kul
const SPH = 46;                  // pół-bok modułu kuli
const MOAT = 50;                 // fosa wokół kuli (pół-bok wycięcia płyt)
const MOAT_C = 12;               // faza rogów fosy

function make() {
  const shapes = [
    // kręgosłup: rów wzdłuż osi od rufy po dziób (korytarz sieci)
    frameBlk(-298, -AXIS, 316, AXIS),
    // rufa: płyta z fazą rufowego rogu, nadbudówka mostka, rów poprzeczny przed pierwszą kulą
    blk('rect', -306, -44, -216, -AXIS, 1, { c: [16, 0, 0, 0] }),
    blk('rect', -296, -30, -228, -AXIS, 2, { c: [10, 0, 0, 0] }),
    frameBlk(-216, -38, -208, -AXIS),
    // przewężenia kilu między kulami
    blk('rect', -96, -22, -80, -AXIS),
    blk('rect', 184, -22, 200, -AXIS),
    // śródokręcie: kolektor (maszynownia z rdzeniem)
    frameBlk(32, -30, 72, 30),
    // dziób: klin 45°
    blk('trap', 312, -34, 344, -AXIS, 1, { b: 28 }),
    blk('rect', 316, -AXIS, 344, AXIS, 1, { c: [0, 6, 6, 0] })
  ];
  // kołyski kul: ośmiokąt (połówka burty y < 0, faza na zewnętrznych rogach)
  for (const x of BEADS) shapes.push(blk('rect', x - BEAD_HX, -BEAD_Y, x + BEAD_HX, -AXIS, 1, { c: [BEAD_C, BEAD_C, 0, 0] }));
  // fosa wokół kuli: płyty zdjęte (rama zostaje) — kula leży w ciemnej studni, rury i kable obiegają ją fosą
  for (const x of BEADS) shapes.push(cutBlk('rect', x - MOAT, -MOAT, x + MOAT, -AXIS, 1, { c: [MOAT_C, MOAT_C, 0, 0] }));

  const modules = [
    engine(-300, -26, 12, 8, 1),
    reactor(52, 14),
    bridge(-262),
    fuelTank(-226, -30, 10, 6, TO_BOW),
    side(-270, -43, 4, 3), side(-88, -21, 3, 2.5),
    ...BEADS.map((x) => spheres(x, 0, SPH, SPH, 1)),
    grate(52, -24, 12, 3),
    hatch(-288, -38, 4, 3), hatch(324, -18, 4, 3)
  ];
  const decals = [
    label('HELIOS GAZ', -250, -37, 24, 5),     // między dyszą SIDE (x ≤ −267) a zbiornikiem paliwa (x ≥ −236)
    stripe(188, -21, 196, -7, 3), stripe(-92, -21, -84, -7, 3)
  ];
  return freighter('Tankowiec gazowy', 71, 0.38, { grid: G, shapes, modules, decals });
}

export default { key: 'tankowiec', label: 'Cywil · Tankowiec', cls: [3, 3], make };
