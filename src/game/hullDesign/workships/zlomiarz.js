// src/game/hullDesign/workships/zlomiarz.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// ZŁOMIARZ (cywilna klasa III): tnie i ładuje sam. Sylwetka: WIDŁY — dziób rozcięty na dwa ramiona, między nimi otwarta
// zatoka robocza (tam stoi usztywniony wrak; odcinana sekcja = 0,3 długości kadłuba mieści się w zatoce). Na ramionach
// cztery obrotnice wysięgników z laserami tnącymi (nasada i koniec każdego ramienia), za nasadą wideł KOSZ na
// śródokręciu — ładownia otwarta od góry — z dwiema obrotnicami dźwigów na pasach burt; dalej wnęka rdzenia, nadbudówka
// z mostkiem i rufa z dwiema gondolami.
// Korytarz sieci: rowy poprzeczne T1–T4 (za pawężą, przed nadbudówką, przed wnęką rdzenia, przed nasadą wideł), rów
// wzdłużny L między pasem burty a pokładem i rów ramienia między belką nasady a płytami ramion.

import {
  workship, blk, frameBlk, engine, reactor, bridge, fuelTank, side, bin, boom, crane, grate, hatch, castle,
  workLabel, workStripe, TO_AXIS
} from './workKit.js';

const HALF = 84;                  // pół-szerokość kadłuba [j.]
const STERN = -200, ROOT = 76, BOW = 200;   // rufa, nasada wideł (koniec kadłuba pełnego), końce ramion
const ARM_IN = -36;               // wewnętrzna krawędź ramienia (zatoka robocza: |y| < 36)
const SIDE_IN = -70, DECK = -62;  // pas burty [−HALF, SIDE_IN], rów L, pokład od DECK
const BIN_X = -6, BIN_W = 46, BIN_H = 36;   // kosz: środek i pół-wymiary

function make() {
  const shapes = [
    // ── RAMA ──
    frameBlk(STERN, -HALF, ROOT, HALF, { c: [12, 0, 0, 12] }),                     // kadłub pełny
    frameBlk(ROOT, -HALF, BOW, ARM_IN, { c: [0, 30, 8, 0] }),                      // ramię wideł (lustro — drugie)

    // ── RUFA: pawęż z gondolami, rów T1 ──
    blk('rect', STERN, -HALF, -176, HALF, 1, { c: [12, 0, 0, 12] }),
    // ── NADBUDÓWKA: pokład z mostkiem (III), pasy burt ──
    blk('rect', -170, DECK, -102, -DECK, 1, { c: [6, 6, 6, 6] }),
    blk('rect', -164, -42, -108, 42, 2, { c: [8, 8, 8, 8] }),
    blk('rect', -170, -HALF, -102, SIDE_IN),
    // ── WNĘKA RDZENIA: płyty przy burtach, środek otwarty (rama), rowy T2 / T3 po obu stronach ──
    blk('rect', -94, -HALF, -62, -30),
    // ── ŚRÓDOKRĘCIE: pokład kosza na osi, pasy burt z dźwigami ──
    blk('rect', -54, -46, 42, 46, 1, { c: [4, 4, 4, 4] }),
    blk('rect', -54, -HALF, 42, -54),
    // ── NASADA WIDEŁ: belka na osi (emitery wiązek trzymających wrak), płyty ramion ──
    blk('rect', 50, -28, ROOT, 28, 2, { c: [0, 6, 6, 0] }),
    blk('rect', 50, -HALF, 132, ARM_IN),
    blk('rect', 132, -HALF, BOW, ARM_IN, 1, { c: [0, 30, 8, 0] })
  ];
  const modules = [
    // systemy
    engine(-190, -44, 22, 18, 2),
    reactor(-78, 14),
    bridge(-136),
    fuelTank(-78, -56, 9, 13, TO_AXIS),
    side(-150, -HALF + 1, 5, 3), side(110, -HALF + 1, 5, 3),
    // ładownia otwarta od góry i dźwigi przy niej
    bin(BIN_X, 0, BIN_W, BIN_H),
    crane(BIN_X, -69, 12),
    // wysięgniki z laserami na ramionach wideł: nasada i koniec
    boom(92, -60, 11), boom(164, -58, 10),
    // detale: kratki maszynowni, klapy serwisowe, kratka chłodzenia belki nasady
    grate(-136, -77, 14, 4), grate(-190, 0, 5, 12), hatch(-30, -77, 6, 4), hatch(20, -77, 6, 4),
    grate(63, 0, 6, 14)
  ];
  const castles = [
    castle(-152, -52, 9, 6, { tiers: 1, taper: 0.3 }),      // maszt łączności przy nadbudówce
    castle(128, -74, 12, 5, { tiers: 1, taper: 0.3 })        // szafa zasilania laserów na ramieniu
  ];
  const decals = [
    workLabel('KRUK 04', -136, -52, 34, 7),
    workStripe(52, -34, 52, 34, 4, { mirror: false }),      // pas ostrzegawczy przed zatoką roboczą
    workStripe(190, -78, 190, -44, 3)
  ];
  return workship('Złomiarz', 83, 0.24, { grid: 2, shapes, modules, castles, decals });
}

export default { key: 'zlomiarz', label: 'Roboczy · Złomiarz', cls: [3, 3], make };
