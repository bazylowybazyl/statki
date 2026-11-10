// src/game/hullDesign/workships/paszcza.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// PASZCZA (cywilna klasa IV): „zjada” cały wrak. Sylwetka: WIELORYB — szeroka głowa na dziobie (dwie szczęki `maw`
// zamknięte na osi, policzki z siłownikami), za nią węższy tułów z KOMORĄ wzdłuż osi pod rozsuwanymi wrotami grzbietu
// (ładownia v 0: wnętrze 272 × 156 j. — mieści cały kadłub niszczyciela Hasta, 243 × 137 j.), żebra komory na pasach
// burt, wnęka rdzenia, nadbudówka z mostkiem i zwężona rufa z trzema gondolami. Wrak wchodzi PASZCZĄ (nie od góry).
// Korytarz sieci: rowy poprzeczne T1–T4 (za pawężą, przed wnęką rdzenia, za nią, między tułowiem a głową) i rowy
// wzdłużne między pasami burt a pokładem / grzbietem komory.

import {
  workship, blk, frameBlk, engine, reactor, bridge, fuelTank, side, hold, maw, grate, hatch, castle,
  workLabel, workStripe, TO_AXIS
} from './workKit.js';

const STERN = -380, NECK = -130, HEAD = 150, BOW = 380;
const H_STERN = 100, H_BODY = 116, H_HEAD = 132;      // pół-szerokości: rufa, tułów, głowa
const ROOF = -86;                                       // krawędź grzbietu komory (rów do pasa burty: −94)
const CH_X = 10, CH_W = 136, CH_H = 78;                 // komora: środek i pół-wymiary
const RIBS = [-110, -44, 22, 88];                       // żebra komory na pasach burt (początek x, szer. 24)

function make() {
  const shapes = [
    // ── RAMA ──
    frameBlk(STERN, -H_STERN, NECK, H_STERN, { c: [20, 0, 0, 20] }),
    frameBlk(NECK, -H_BODY, HEAD, H_BODY),
    frameBlk(HEAD, -H_HEAD, BOW, H_HEAD, { c: [16, 44, 44, 16] }),

    // ── RUFA: pawęż, rów T1, pokład z nadbudówką (mostek IV), pasy burt ──
    blk('rect', STERN, -H_STERN, -352, H_STERN, 1, { c: [14, 0, 0, 14] }),
    blk('rect', -344, -64, -188, 64, 1, { c: [8, 8, 8, 8] }),
    blk('rect', -332, -48, -200, 48, 2, { c: [10, 10, 10, 10] }),
    blk('rect', -344, -H_STERN, -188, -72),
    // ── WNĘKA RDZENIA: płyty przy burtach, środek otwarty ──
    blk('rect', -180, -H_STERN, -138, -34),
    // ── TUŁÓW: grzbiet komory na osi, pasy burt z żebrami ──
    blk('rect', NECK, ROOF, HEAD - 8, -ROOF, 1, { c: [6, 6, 6, 6] }),
    blk('rect', NECK, -H_BODY, HEAD - 8, -94),
    // ── GŁOWA: pokład szczęk, policzki z siłownikami ──
    blk('rect', HEAD, -H_HEAD, BOW, H_HEAD, 1, { c: [16, 44, 44, 16] }),
    blk('rect', 166, -H_HEAD, 222, -102, 2, { c: [8, 0, 0, 0] })
  ];
  for (const x of RIBS) shapes.push(blk('rect', x, -H_BODY, x + 24, -98, 2));

  const modules = [
    // systemy
    engine(-364, -62, 30, 20, 2), engine(-364, 0, 30, 24, 2),
    reactor(-159, 20),
    bridge(-266),
    fuelTank(-159, -70, 12, 22, TO_AXIS),
    side(-300, -H_STERN + 1, 7, 4), side(-60, -H_BODY + 1, 7, 4), side(250, -H_HEAD + 1, 7, 4),
    // komora na cały wrak pod wrotami grzbietu i paszcza na dziobie
    hold(CH_X, 0, CH_W, CH_H, 0),
    maw(296, 0, 70, 90),
    // detale: hydraulika szczęk, kratki maszynowni, klapy serwisowe
    grate(194, -117, 22, 8), grate(-266, -86, 24, 6), grate(-366, -31, 8, 5),
    hatch(-166, -90, 8, 5), hatch(120, -105, 8, 5)
  ];
  const castles = [
    castle(-222, -86, 12, 8, { tiers: 1, taper: 0.3 })
  ];
  const decals = [
    workLabel('LEWIATAN', -32, -105, 70, 11),
    workStripe(HEAD - 4, -112, HEAD - 4, -92, 5),
    workStripe(-352, -96, -352, -70, 4)
  ];
  return workship('Paszcza', 87, 0.45, { grid: 2, shapes, modules, castles, decals });
}

export default { key: 'paszcza', label: 'Roboczy · Paszcza', cls: [4, 4], make };
