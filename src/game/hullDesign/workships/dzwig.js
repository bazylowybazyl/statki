// src/game/hullDesign/workships/dzwig.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// DŹWIG (cywilna klasa IV): podnosi i przekłada całe sekcje. Sylwetka: PLATFORMA — szeroki ośmiokątny ponton
// z czterema łapami w narożach (gniazda DAMPERÓW: wysuwane podpory, które usztywniają statek przy pracy), na
// śródokręciu jedna OGROMNA obrotnica dźwigu (gniazdo główne L), za nią mały kosz — ładownia otwarta od góry —
// i przeciwwagi przy burtach; na dziobie wnęka rdzenia i nadbudówka z mostkiem, na rufie wąski blok z dwiema gondolami.
// Korytarz sieci: rów okrężny wokół podstawy obrotnicy, rowy poprzeczne przed nią i za nią, rów osi do rufy.

import {
  workship, blk, frameBlk, engine, reactor, bridge, fuelTank, side, bin, crane, damper, grate, hatch, castle,
  workLabel, workStripe, TO_AXIS
} from './workKit.js';

const HX = 220, HY = 152, CH = 40;              // ponton: pół-długość, pół-szerokość, faza narożników
const PAD_X = [148, 252], PAD_Y = [-196, -112]; // łapa dziobowa burty y < 0 (rufowa — odbita w x)
const RING = 80;                                // promień obrotnicy dźwigu

function make() {
  const pad = (sx) => (sx > 0 ? [PAD_X[0], PAD_X[1]] : [-PAD_X[1], -PAD_X[0]]);
  const shapes = [
    // ── RAMA: ponton, łapy narożne, blok rufowy, nos ──
    frameBlk(-HX, -HY, HX, HY, { c: [CH, CH, CH, CH] }),
    ...[1, -1].map((sx) => frameBlk(pad(sx)[0], PAD_Y[0], pad(sx)[1], PAD_Y[1], { c: [12, 12, 12, 12] })),
    frameBlk(-284, -64, -HX, 64, { c: [12, 0, 0, 12] }),
    frameBlk(HX, -52, 268, 52, { c: [0, 24, 24, 0] }),

    // ── RUFA: blok gondol, pokład kosza, przeciwwagi ──
    blk('rect', -284, -64, -228, 64, 1, { c: [12, 0, 0, 12] }),
    blk('rect', -212, -56, -100, 56, 1, { c: [16, 4, 4, 16] }),
    blk('rect', -196, -HY + 44, -108, -68, 2, { c: [20, 0, 0, 0] }),
    // ── ŚRÓDOKRĘCIE: płyta podstawy obrotnicy (ośmiokąt), pasy burt ──
    blk('rect', -88, -92, 88, 92, 1, { c: [28, 28, 28, 28] }),
    blk('rect', -96, -HY, 96, -104),
    // ── DZIÓB: płyty przy wnęce rdzenia, pokład z nadbudówką (mostek IV), nos ──
    blk('rect', 100, -HY + 44, 136, -32, 1, { c: [0, 16, 0, 0] }),
    blk('rect', 144, -72, 268, 72, 1, { c: [4, 24, 24, 4] }),
    blk('rect', 152, -56, 244, 56, 2, { c: [8, 16, 16, 8] }),
    // ── ŁAPY: płyty narożne z gniazdami damperów ──
    ...[1, -1].map((sx) => blk('rect', pad(sx)[0], PAD_Y[0], pad(sx)[1], PAD_Y[1], 2, { c: [12, 12, 12, 12] }))
  ];
  const modules = [
    // systemy
    engine(-264, -36, 24, 20, 2),
    reactor(118, 20),
    bridge(198),
    fuelTank(118, -60, 12, 18, TO_AXIS),
    side(0, -HY + 1, 8, 4),
    // ogromna obrotnica dźwigu, cztery dampery w narożach, mały kosz
    crane(0, 0, RING, 'L'),
    damper(204, -156, 28, 28), damper(-204, -156, 28, 28),
    bin(-156, 0, 42, 44),
    // detale
    grate(-152, -90, 30, 8), grate(-262, 0, 6, 10), hatch(60, -128, 10, 6), hatch(-60, -128, 10, 6)
  ];
  const castles = [
    castle(0, -128, 22, 12, { tiers: 2, taper: 0.35 })        // maszynownia obrotu dźwigu przy burcie
  ];
  const decals = [
    workLabel('ATLANT 1', 198, -63, 44, 8),
    workStripe(-98, -98, -98, 98, 4, { mirror: false }),
    workStripe(98, -98, 98, 98, 4, { mirror: false })
  ];
  return workship('Dźwig', 99, 0.32, { grid: 4, shapes, modules, castles, decals });
}

export default { key: 'dzwig', label: 'Roboczy · Dźwig', cls: [4, 4], make };
