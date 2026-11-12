// src/game/hullDesign/freighters/katamaran.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// KATAMARAN (cywilna klasa V — Transportowiec): ciężki dwukadłubowy transportowiec w kształcie litery H. Dwa długie
// kadłuby (burty) z gondolami silników w poszerzonych rufach wystających za pokład, między nimi pokład ładunkowy
// przecięty poprzecznymi belkami (jasne pasy przez cały okręt: rufowa ze zbiornikami paliwa, środkowa z wnęką rdzenia,
// dziobowa z piastą mostka), a przed pokładem OTWARTA zatoka między dwoma dziobami-szpicami. Rama nie ma otworu:
// przestrzeń między kadłubami jest otwarta od dziobu i od rufy.
// Korytarz sieci: rów wzdłuż każdego kadłuba (G), rowy poprzeczne przy belkach (T1–T4) i rów osi między połówkami
// pokładu (oś ± AX) — łączą rdzeń, zbiorniki, gondole, mostek i stelaże.

import {
  freighter, blk, frameBlk, engine, reactor, bridge, fuelTank, side, rack, pods, vent, hatch, castle, label, stripe, TO_BOW
} from './freighterKit.js';

// Kadłub (burta y < 0): zewnętrzna płyta [HO, GO], rów G [GO, GI], wewnętrzna płyta [GI, HI]; pokład [HI, −AX].
const HO = -230, GO = -196, GI = -184, HI = -150, AX = 6;
const STERN = -540, BOW = 560, NOSE = 480;   // dziób: skos 45° od burty (NOSE) do szpicu przy zatoce (BOW)
const NAC = -246, NAC_X = -462;              // gondola rufowa: poszerzenie burty do NAC na [STERN, NAC_X]
// Belki pokładu [x0, x1] i rowy poprzeczne (rów T po dziobowej stronie belki rufowej i środkowej, po rufowej — dziobowej).
const B_AFT = [-400, -350], B_MID = [-74, 14], B_FWD = [202, 260];

function make() {
  const shapes = [
    // ── RAMA (poziom 0 — maszynownia, rowy) ──
    frameBlk(STERN, HO, NOSE, HI, { c: [16, 0, 0, 0] }),               // kadłub
    frameBlk(NOSE, HO, BOW, HI, { shape: 'trap', b: BOW - NOSE }),     // kadłub: dziób ścięty od burty pod 45°
    frameBlk(STERN, NAC, NAC_X, HI, { c: [16, 16, 0, 0] }),            // gondola rufowa (poszerzenie burty)
    frameBlk(B_AFT[0], HI, B_FWD[1], -HI),                             // pokład ładunkowy między kadłubami (na osi)
    frameBlk(B_FWD[0], -48, 344, 48, { c: [0, 24, 24, 0] }),           // piasta mostka wysunięta w zatokę dziobu
    frameBlk(-452, -32, B_AFT[0], 32),                                 // mocowanie gondoli osi za pokładem

    // ── KADŁUB: płyta zewnętrzna (jasne pasy belek, szwy co sekcję, rów do dysz SIDE dziobu) ──
    blk('rect', STERN, NAC, NAC_X, GO, 2, { c: [16, 16, 0, 0] }),      // gondola rufowa (maszynownia, kasztel)
    blk('rect', NAC_X, HO, -436, GO),
    blk('rect', -424, HO, B_AFT[0], GO),                               // (rów −436…−424: dysza SIDE rufy)
    blk('rect', B_AFT[0], HO, B_AFT[1], GO, 2),                        // pas belki rufowej
    blk('rect', B_AFT[1], HO, B_MID[0], GO),
    blk('rect', B_MID[0], HO, B_MID[1], GO, 2),                        // pas belki środkowej
    blk('rect', B_MID[1], HO, B_FWD[0], GO),
    blk('rect', B_FWD[0], HO, B_FWD[1], GO, 2),                        // pas belki dziobowej
    blk('rect', B_FWD[1], HO, 414, GO),
    blk('trap', 426, HO, NOSE + (GO - HO), GO, 1, { b: GO - HO }),     // dziób kadłuba (skos)

    // ── KADŁUB: płyta wewnętrzna (przerwy = rowy poprzeczne T1–T4) ──
    blk('rect', STERN, GI, B_AFT[0], HI),
    blk('rect', B_AFT[0], GI, B_AFT[1], HI, 2),
    blk('rect', B_AFT[1] + 12, GI, B_MID[0] - 12, HI),
    blk('rect', B_MID[0], GI, B_MID[1], HI, 2),
    blk('rect', B_MID[1] + 12, GI, B_FWD[0] - 12, HI),
    blk('rect', B_FWD[0], GI, B_FWD[1], HI, 2),
    blk('trap', B_FWD[1], GI, BOW, HI, 1, { b: HI - GI }),             // płyta wewnętrzna do szpicu

    // ── POKŁAD: belki (nadbudówka) i zatoki ładunkowe ──
    blk('rect', B_AFT[0], HI, B_AFT[1], -AX, 2),                       // belka rufowa (zbiorniki paliwa)
    blk('rect', B_AFT[1] + 12, HI, B_MID[0] - 12, -AX),                // zatoka A (stelaż kontenerów)
    blk('rect', B_MID[0], HI, B_MID[1], -34, 2),                       // belka środkowa (wnęka rdzenia przy osi)
    blk('rect', B_MID[1] + 12, HI, B_FWD[0] - 12, -AX),                // zatoka B (zasobniki)
    blk('rect', B_FWD[0], HI, B_FWD[1], -AX, 2),                       // belka dziobowa
    blk('rect', B_FWD[0], -48, 344, 48, 2, { c: [0, 24, 24, 0] })      // piasta mostka
  ];
  const modules = [
    reactor(-30, 24),
    bridge(262),
    fuelTank(-375, -80, 20, 34, TO_BOW),
    engine(-508, -202, 34, 36, 3),
    engine(-430, 0, 24, 26, 2),
    side(-430, HO + 1, 6, 4), side(420, HO + 1, 6, 4),
    rack(-212, (HI - AX) / 2, 122, 68),
    pods(108, (HI - AX) / 2, 78, 68, 2),
    vent(-212, -213, 24, 8), vent(-430, -168, 10, 6),
    hatch(-30, -92, 16, 10)
  ];
  const castles = [
    castle(-500, -222, 28, 14, { level: 3, tiers: 1, taper: 0.4 }),     // nadbudówka maszynowni rufy
    castle(337, -213, 44, 9, { tiers: 2, taper: 0.4 })                    // kabina obsługi szpicu (dźwigi zatoki)
  ];
  const decals = [
    label('HELIOS FREIGHT', 108, -213, 150, 16),
    stripe(470, -229, 470, -197, 6)
  ];
  return freighter('Transportowiec Katamaran', 71, 0.66, { grid: 2, shapes, modules, castles, decals });
}

export default { key: 'katamaran', label: 'Cywil · Katamaran', cls: [5, 5], make };
