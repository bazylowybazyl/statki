// src/game/hullDesign/workships/rafineria.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// RAFINERIA (cywilna klasa IV): staje burta w burtę z młynem i przerabia zmielony złom. Sylwetka: GRZEBIEŃ — wąski
// kręgosłup z odkrytym pomostem rur (rama bez płyt: tędy biegnie sieć), z którego na obie burty wychodzą trzy pomosty
// zbiorników (walce, na środkowym — piece: kule w rzędach) rozdzielone wcięciami; końce pomostów tworzą prostą linię
// burty ze ZŁĄCZAMI PRZEŁADUNKU po obu burtach. Na rufie szeroki blok z kominami pieców, mostkiem i trzema gondolami.
// Korytarz sieci: kręgosłup na całej długości (rowy po obu stronach płyt osi) i rów poprzeczny przed blokiem rufowym.

import {
  workship, blk, frameBlk, engine, reactor, bridge, fuelTank, side, tanks, spheres, coupling, grate, hatch, castle,
  workLabel, workStripe
} from './workKit.js';

const TO_STERN = 0;                             // króciec zbiornika paliwa ku rufie (rdzeń za zbiornikiem)

const SPINE = 44, HALF = 130, H_AFT = 110;      // pół-szerokości: kręgosłup, pomosty zbiorników, blok rufowy
const STERN = -300, AFT = -176, BOW = 300;
const DECKS = [[-146, -46], [-16, 84], [114, 214]];   // pomosty zbiorników [x0, x1]
const T_Y = -84, T_H = 30;                       // zbiorniki: środek i pół-wysokość modułu

function make() {
  const shapes = [
    // ── RAMA: kręgosłup, pomosty, blok rufowy ──
    frameBlk(STERN, -SPINE, BOW, SPINE, { c: [0, 20, 20, 0] }),
    frameBlk(STERN, -H_AFT, AFT, H_AFT, { c: [16, 0, 0, 16] }),
    ...DECKS.map(([x0, x1]) => frameBlk(x0, -HALF, x1, -SPINE + 4, { c: [8, 8, 0, 0] })),

    // ── BLOK RUFOWY: pawęż, pokład z nadbudówką (mostek IV), pasy burt z kominami pieców ──
    blk('rect', STERN, -H_AFT, -276, H_AFT, 1, { c: [16, 0, 0, 16] }),
    blk('rect', -268, -60, -184, 60, 1, { c: [8, 8, 8, 8] }),
    blk('rect', -262, -46, -190, 46, 2, { c: [10, 10, 10, 10] }),
    blk('rect', -268, -H_AFT, -184, -68),
    // ── KRĘGOSŁUP: wąskie płyty osi między wnękami (rowy rur po obu stronach), dziób ──
    blk('rect', -118, -16, -30, 16, 1, { c: [4, 4, 4, 4] }),
    blk('rect', -4, -16, 98, 16, 1, { c: [4, 4, 4, 4] }),
    blk('rect', 126, -16, 226, 16, 1, { c: [4, 4, 4, 4] }),
    blk('rect', 240, -SPINE, BOW, SPINE, 1, { c: [0, 20, 20, 0] }),
    blk('rect', 250, -26, 286, 26, 2, { c: [0, 10, 10, 0] }),
    // ── POMOSTY ZBIORNIKÓW: płyta pod zbiornikami i belka końcowa ze złączem (nadbudówka) ──
    ...DECKS.map(([x0, x1]) => blk('rect', x0, -HALF, x1, -52, 1, { c: [8, 8, 0, 0] })),
    ...DECKS.map(([x0, x1]) => blk('rect', x0 + 30, -HALF, x1 - 30, -118, 2))
  ];
  const mid = (i) => (DECKS[i][0] + DECKS[i][1]) / 2;
  const modules = [
    // systemy
    engine(-286, -70, 28, 20, 2), engine(-286, 0, 28, 22, 2),
    reactor(-150, 20),
    bridge(-226),
    fuelTank(-88, -34, 8, 9, TO_STERN),
    side(-230, -H_AFT + 1, 7, 4), side(mid(2), -HALF + 1, 7, 4),
    // zbiorniki (walce) na pomoście rufowym i dziobowym, piece (kule) na środkowym
    tanks(mid(0), T_Y, 42, T_H, 3),
    spheres(mid(1), T_Y, 42, T_H, 2),
    tanks(mid(2), T_Y, 42, T_H, 3),
    // złącza przeładunku na końcach pomostów (obie burty — lustro)
    coupling(mid(0), -124, 5), coupling(mid(1), -124, 5),
    // detale: kratki pieców, klapy
    grate(-226, -89, 26, 8), grate(268, 0, 8, 14), hatch(-74, 0, 10, 6), hatch(47, 0, 10, 6), hatch(176, 0, 10, 6)
  ];
  const castles = [
    castle(-202, -90, 10, 10, { tiers: 2, taper: 0.4, vent: 'slats' }),     // komin pieca
    castle(-250, -90, 10, 10, { tiers: 2, taper: 0.4, vent: 'slats' })
  ];
  const decals = [
    workLabel('HUTA 9', 176, -124, 26, 6),
    workStripe(-276, -104, -276, -72, 4)
  ];
  return workship('Rafineria', 95, 0.36, { grid: 2, shapes, modules, castles, decals });
}

export default { key: 'rafineria', label: 'Roboczy · Rafineria', cls: [4, 4], make };
