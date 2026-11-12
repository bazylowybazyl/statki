// src/game/hullDesign/freighters/kontenerowiec.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// KONTENEROWIEC (klasa III): otwarty pokład kontenerowy. Długi wąski kręgosłup (odkryta rama = korytarz sieci wzdłuż osi)
// niesie cztery sekcje stelaży kontenerów rozdzielone poprzecznymi ramami-bramownicami, które wystają poza pokład;
// wieża mostka ze skrzydłami na rufie (jak w prawdziwych kontenerowcach), za nią wnęka rdzenia i gondole; tępy dziób
// z krótkim kasztelem.

import {
  freighter, blk, frameBlk, engine, reactor, bridge, fuelTank, side, rack, vent, hatch, label, stripe, castle, TO_AXIS
} from './freighterKit.js';

// sekcje ładunku: [x0, x1] pokładu sekcji (między bramownicami)
const BAYS = [[-136, -64], [-54, 18], [28, 100], [110, 182]];
const RIBS = [[-64, -54], [18, 28], [100, 110], [182, 192]];
const DECK_Y = -66;   // burta pokładu ładunkowego
const RIB_Y = -78;    // bramownica wystaje poza pokład
const SPINE = 7;      // pół-szerokość kręgosłupa (odkryta rama)

function make() {
  const shapes = [
    // ── RAMA (poziom 0 — rowy sieci) ──
    frameBlk(-252, -40, -136, 40),                                   // maszynownia rufy: wnęka rdzenia, rowy wokół wieży
    frameBlk(-212, -52, -200, -40),                                  // rów do dyszy SIDE rufy
    frameBlk(-136, -SPINE, 236, SPINE),                              // kręgosłup (korytarz wzdłuż osi)
    frameBlk(192, -56, 202, -SPINE),                                 // rów do dyszy SIDE dziobu
    // ── RUFA ──
    blk('rect', -252, -16, -238, 16, 1, { c: [4, 0, 0, 4] }),        // pawęż między gondolami
    blk('rect', -252, -52, -212, -32, 1, { c: [12, 0, 0, 0] }),      // burta rufy (ukośny róg pawęży)
    blk('rect', -200, -52, -144, -32, 1),                            // burta pod wieżą
    blk('rect', -206, -24, -144, 24, 2, { c: [6, 4, 4, 6] }),        // wieża mostka
    blk('rect', -186, -80, -168, -52, 2, { c: [4, 4, 0, 0] }),       // skrzydło mostka (na całą szerokość)
    // ── DZIÓB ──
    blk('rect', 202, -56, 246, 56, 1, { c: [0, 20, 20, 0] })         // dziób (tępy)
  ];
  for (const [x0, x1] of BAYS) shapes.push(blk('rect', x0, DECK_Y, x1, -SPINE, 1, { c: [3, 3, 0, 0] }));
  for (const [x0, x1] of RIBS) shapes.push(blk('rect', x0, RIB_Y, x1, -SPINE, 2, { c: [5, 5, 0, 0] }));

  const modules = [
    reactor(-222, 14),
    bridge(-173),        // rama gniazda poza obudową reaktora (1,2 r + 0,8 D od środka rdzenia — jak test mostków TN)
    engine(-250, -26, 14, 9, 2),
    fuelTank(-222, -28, 8, 6, TO_AXIS),
    side(-206, -49, 4, 3),
    side(197, -53, 4, 3)
  ];
  for (const [x0, x1] of BAYS) modules.push(rack((x0 + x1) / 2, (DECK_Y - SPINE) / 2, (x1 - x0) / 2 - 1, (-SPINE - DECK_Y) / 2 - 2));
  modules.push(hatch(212, -40, 5, 3));

  const decals = [
    label('ORBITA LINES', -172, -42, 46, 6)
  ];
  for (const [x0, x1] of RIBS) decals.push(stripe(x0 + 2, RIB_Y + 4, x1 - 2, RIB_Y + 4, 2));   // znaki na końcach bramownic
  const castles = [castle(226, 0, 14, 38, { level: 2, tiers: 2, high: 'in', split: 0.5, taper: 0.45, vent: 'grid' })];  // kasztel dziobowy
  return freighter('Kontenerowiec', 71, 0.3, { grid: 1, shapes, modules, decals, castles });
}

export default { key: 'kontenerowiec', label: 'Cywil · Kontenerowiec', cls: [3, 3], make };
