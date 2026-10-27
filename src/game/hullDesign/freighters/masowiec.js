// src/game/hullDesign/freighters/masowiec.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// MASOWIEC (klasa IV cywilna): przewoźnik rudy i sypkich. Sylwetka: szeroki, prostokątny kadłub z zaokrąglonym dziobem
// (elipsa ramy + półelipsa pokładu dziobowego), rząd 7 dużych pokryw ładowni (klapy) na osi, między nimi rowy maszynowni
// w poprzek, wzdłuż burt pasy pokładu z podstawami żurawi, nadbudówka z mostkiem na rufie, za nią rufa z trzema gondolami.

import {
  freighter, blk, frameBlk, blkAt, engine, reactor, bridge, fuelTank, side, hold, grate, hatch, castle, label, stripe, TO_BOW
} from './freighterKit.js';

const HALF = 110;                 // pół-szerokość kadłuba [j.]
const SIDE_IN = -86;              // wewnętrzna krawędź pasa burty
const DECK = -78;                 // krawędź płyt ładowni / pokładu (rów wzdłużny między nimi)
const HOLD_X0 = -200, HOLD_L = 64, HOLD_GAP = 8, HOLDS = 7;
const holdX = (i) => HOLD_X0 + i * (HOLD_L + HOLD_GAP);

function make() {
  const shapes = [
    // RAMA: prostokątny kadłub i zaokrąglony dziób (elipsa stycznie do burt)
    frameBlk(-400, -HALF, 300, HALF, { c: [12, 0, 0, 12] }),
    blkAt('arc', 300, 0, 240, 2 * HALF, 0, 0, { arc: 360 }),
    // rufa: płyta pawęży (gondole na krawędzi), rów w poprzek za nadbudówką
    blk('rect', -400, -HALF, -372, HALF, 1, { c: [12, 0, 0, 12] }),
    // pas burty (podstawy żurawi) — od rufy do pokładu dziobowego
    blk('rect', -380, -HALF, 330, SIDE_IN),
    // nadbudówka (mostek IV) i pokład przy niej
    blk('rect', -364, -58, -262, 58, 2, { c: [10, 10, 10, 10] }),
    blk('rect', -364, DECK, -262, -62),
    blk('rect', -296, -HALF, -278, -90, 2, { c: [4, 4, 0, 0] }),    // skrzydło mostka nad pasem burty
    // wnęka rdzenia: płyty po bokach, środek otwarty (rama)
    blk('rect', -254, DECK, -208, -30, 1, { c: [0, 0, 0, 0] }),
    // pokład dziobowy (forecastle): półelipsa ku dziobowi
    blkAt('arc', 362, 0, 2 * HALF, 116, 2, 2, { arc: 180 })
  ];
  // pokrywy ładowni: płyty-zrębnice na osi, rowy w poprzek między nimi
  for (let i = 0; i < HOLDS; i++) shapes.push(blk('rect', holdX(i), DECK, holdX(i) + HOLD_L, -DECK, 1, { c: [4, 4, 4, 4] }));

  const modules = [
    // systemy
    engine(-394, -62, 26, 16, 2), engine(-394, 0, 26, 20, 2),
    reactor(-231, 20),
    bridge(-313),
    fuelTank(-338, -98, 22, 8, TO_BOW),
    side(-258, -107, 7, 3), side(250, -107, 7, 3),
    // ładownie z klapami
    ...Array.from({ length: HOLDS }, (_, i) => hold(holdX(i) + HOLD_L / 2, 0, 28, 66, 1)),
    // detale: kratki wentylacji przy żurawiach, klapy serwisowe
    grate(-230, -50, 10, 5), hatch(-386, -90, 5, 3),
    // pokład dziobowy: wciągarki kotwiczne i klapa bosmańska
    grate(340, -52, 9, 12), hatch(380, -24, 6, 4)
  ];
  // podstawy żurawi na pasach burt między ładowniami
  const castles = [1, 3, 5].map((i) => castle(holdX(i) - HOLD_GAP / 2, -98, 13, 10, { tiers: 2, taper: 0.35 }));
  castles.push(castle(-386, 0, 8, 16, { tiers: 1, taper: 0.3 }));   // komin / wieża wentylacji rufy
  castles.push(castle(332, 0, 10, 14, { tiers: 2, taper: 0.4 }));    // maszt dziobowy na osi

  const decals = [
    label('CERES ORE', 84, -98, 70, 10),
    stripe(-398, -108, -398, -80, 4),
    ...Array.from({ length: HOLDS }, (_, i) => label(String(i + 1), holdX(i) + HOLD_L / 2, -72, 6, 7, { mirror: false }))
  ];

  return freighter('Masowiec', 71, 0.47, { grid: 2, shapes, modules, castles, decals, cargoLoad: 1 });
}

export default { key: 'masowiec', label: 'Cywil · Masowiec', cls: [4, 4], make };
