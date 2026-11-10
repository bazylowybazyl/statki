// src/game/hullDesign/workships/mlyn.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// MŁYN (cywilna klasa III): miele złom — daje surowiec „złom”, nie stal. Sylwetka: LEJ — dziób rozszerza się skosami
// w szeroki wlot z gardzielą młyna (trzy walce tnące w poprzek), po bokach wlotu obudowy napędu walców; za gardzielą
// na osi dwa KOSZE na zmielony złom (otwarte od góry), na pasach burt złącza przeładunku (tu staje rafineria burta
// w burtę); dalej wnęka rdzenia, nadbudówka z mostkiem i rufa z dwiema gondolami.
// Korytarz sieci: rowy poprzeczne (za pawężą, po obu stronach wnęki rdzenia, między koszami, za gardzielą) i rów
// wzdłużny między pasem burty a pokładem koszy.

import {
  workship, blk, frameBlk, engine, reactor, bridge, fuelTank, side, bin, mill, coupling, grate, hatch, castle,
  workLabel, workStripe, TO_AXIS
} from './workKit.js';

const HALF = 70, FLARE = 110;                    // pół-szerokość kadłuba i wlotu
const STERN = -210, THROAT = 108, BOW = 210;     // rufa, początek leja, warga wlotu
const DECK = -54;                                // krawędź pokładu koszy (rów do pasa burty: −62)
const BINS = [-28, 60], BIN_W = 40, BIN_H = 46;  // środki koszy i pół-wymiary

function make() {
  const shapes = [
    // ── RAMA: kadłub i skrzydła leja (skos 45° od burty do wargi) ──
    frameBlk(STERN, -HALF, BOW, HALF, { c: [12, 0, 0, 12] }),
    frameBlk(THROAT, -FLARE, BOW, -HALF, { shape: 'trap', a: FLARE - HALF, b: 0 }),

    // ── RUFA: pawęż, pokład z nadbudówką (mostek III), pasy burt ──
    blk('rect', STERN, -HALF, -186, HALF, 1, { c: [12, 0, 0, 12] }),
    blk('rect', -180, -50, -112, 50, 1, { c: [6, 6, 6, 6] }),
    blk('rect', -174, -38, -118, 38, 2, { c: [8, 8, 8, 8] }),
    blk('rect', -180, -HALF, -112, -58),
    // ── WNĘKA RDZENIA ──
    blk('rect', -104, -HALF, -78, -26),
    // ── KOSZE: pokłady na osi (rów w poprzek między nimi), pas burty ze złączami ──
    blk('rect', -70, DECK, 14, -DECK, 1, { c: [4, 4, 4, 4] }),
    blk('rect', 20, DECK, 104, -DECK, 1, { c: [4, 4, 4, 4] }),
    blk('rect', -70, -HALF, 104, -62),
    // ── LEJ: pokład gardzieli, skrzydła (obudowy napędu walców — nadbudówka) ──
    blk('rect', 110, -HALF, BOW, HALF),
    blk('trap', 110, -FLARE, BOW, -HALF, 1, { a: FLARE - HALF, b: 0 }),
    blk('rect', 154, -FLARE + 4, 198, -76, 2, { c: [6, 0, 0, 0] })
  ];
  const modules = [
    // systemy
    engine(-198, -36, 20, 16, 2),
    reactor(-91, 14),
    bridge(-146),
    fuelTank(-91, -48, 8, 12, TO_AXIS),
    side(-150, -HALF + 1, 5, 3), side(70, -HALF + 1, 5, 3),
    // gardziel młyna i kosze na zmielony złom
    mill(166, 0, 32, 58, 3),
    ...BINS.map((x) => bin(x, 0, BIN_W, BIN_H)),
    // złącza przeładunku na pasach burt (obie burty — lustro)
    coupling(-30, -63, 5), coupling(40, -63, 5),
    // detale
    grate(176, -91, 16, 6), grate(-146, -64, 14, 3), hatch(-196, 0, 4, 8), hatch(120, -62, 5, 4)
  ];
  const castles = [
    castle(-164, -44, 6, 4, { tiers: 1, taper: 0.3 })
  ];
  const decals = [
    workLabel('MIELCZ 2', -146, -44, 30, 6),
    workStripe(206, -100, 206, -66, 4),
    workStripe(106, -50, 106, 50, 3, { mirror: false })
  ];
  return workship('Młyn', 91, 0.25, { grid: 2, shapes, modules, castles, decals, cargoLoad: 0.9 });
}

export default { key: 'mlyn', label: 'Roboczy · Młyn', cls: [3, 3], make };
