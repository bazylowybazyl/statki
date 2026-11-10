// src/game/hullDesign/workships/rampowiec.js — preset statku roboczego (zestaw: ./workKit.js, rejestr: ./index.js).
//
// FRACHTOWIEC Z RAMPĄ (cywilna klasa VI): wywozi całe wraki. Sylwetka: SAMOLOT TRANSPORTOWY — szeroki kadłub-tunel
// z zaokrąglonym nosem (półelipsa) i mostkiem nad nosem, na rufie RAMPA na osi (klapa opada ku rufie), a gondole
// silników wyniesione na wysięgnikach poza burty, żeby nie zasłaniały rampy. Ładownia-TUNEL pod wrotami grzbietu
// (v 0: wnętrze 640 × 392 j.) mieści cały wrak pancernika Bellator (612 × 377 j.) albo kilka mniejszych; wraki
// wpychają holowniki albo drony RAMPĄ (nie od góry). Żebra tunelu na pasach burt.
// Korytarz sieci: rowy wzdłużne między pasami burt a grzbietem tunelu (od gondol po nos), rowy poprzeczne przed
// rampą i za tunelem, wnęka rdzenia przed tunelem.

import {
  workship, blk, blkAt, frameBlk, engine, reactor, bridge, fuelTank, side, hold, ramp, grate, hatch, castle,
  workLabel, workStripe, TO_AXIS
} from './workKit.js';

const HALF = 248;                               // pół-szerokość kadłuba
const STERN = -528, NOSE = 400, NOSE_L = 264;   // rufa, początek nosa, długość osi elipsy nosa (2 × 132)
const ROOF = -212;                              // krawędź grzbietu tunelu (rów do pasa burty: −224)
const TUN_X = -60, TUN_W = 320, TUN_H = 196;    // tunel: środek i pół-wymiary
const POD_Y0 = -312, POD_X1 = -360;             // wysięgnik gondoli: zewnętrzna krawędź, dziobowy koniec
const RIBS = [-340, -220, -100, 20, 140];       // żebra tunelu (początek x, szer. 40)

function make() {
  const shapes = [
    // ── RAMA: kadłub, nos (elipsa styczna do burt), wysięgniki gondol ──
    frameBlk(STERN, -HALF, NOSE, HALF, { c: [24, 0, 0, 24] }),
    blkAt('arc', NOSE, 0, NOSE_L, 2 * HALF, 0, 0, { arc: 360 }),
    frameBlk(-568, POD_Y0, POD_X1, -HALF + 12, { c: [16, 24, 0, 0] }),

    // ── RUFA: próg rampy (pas w poprzek), rów przed tunelem ──
    blk('rect', STERN, -HALF, -392, -160, 1, { c: [24, 0, 0, 0] }),
    blk('rect', STERN, -152, -392, 152),
    // ── TUNEL: grzbiet na osi, pasy burt z żebrami ──
    blk('rect', -384, ROOF, 268, -ROOF, 1, { c: [8, 8, 8, 8] }),
    blk('rect', -384, -HALF, 268, -224),
    // ── WNĘKA RDZENIA i NOS: płyty przy burtach, pokład nosa, nadbudówka mostka (VI) ──
    blk('rect', 280, -HALF, 336, -44),
    blkAt('arc', NOSE + NOSE_L / 4, 0, 2 * HALF, NOSE_L / 2, 2, 1, { arc: 180 }),
    blk('rect', 344, -HALF, NOSE, HALF),
    blk('rect', 352, -96, 500, 96, 2, { c: [12, 40, 40, 12] }),
    // ── GONDOLE: płyta wysięgnika i kaptur gondoli ──
    blk('rect', -568, POD_Y0, POD_X1, -HALF - 4, 1, { c: [16, 24, 0, 0] }),
    blk('rect', -520, POD_Y0 + 8, -400, -HALF - 12, 2, { c: [8, 16, 0, 0] })
  ];
  for (const x of RIBS) shapes.push(blk('rect', x, -HALF, x + 40, -228, 2));

  const modules = [
    // systemy
    engine(-544, -282, 36, 22, 2),
    reactor(308, 30),
    bridge(426),
    fuelTank(308, -92, 20, 32, TO_AXIS),
    side(-452, -HALF + 1, 12, 7), side(-40, -HALF + 1, 12, 7), side(304, -HALF + 1, 12, 7),
    // ładownia-tunel i rampa rufowa
    hold(TUN_X, 0, TUN_W, TUN_H, 0),
    ramp(-460, 0, 62, 144),
    // detale
    grate(-460, -200, 40, 12), grate(308, -180, 16, 30),
    hatch(372, -150, 12, 8), grate(514, 0, 8, 26)
  ];
  const castles = [
    castle(-460, -226, 40, 12, { tiers: 1, taper: 0.3 }),       // maszynownia siłowników rampy
    castle(308, -224, 18, 14, { tiers: 2, taper: 0.4 })
  ];
  const decals = [
    workLabel('TRAGARZ', -40, -236, 150, 16),
    workStripe(-396, -206, -396, 206, 6, { mirror: false }),    // pas ostrzegawczy progu rampy
    workStripe(276, -206, 276, 206, 6, { mirror: false })
  ];
  return workship('Frachtowiec z rampą', 97, 0.63, { grid: 4, shapes, modules, castles, decals });
}

export default { key: 'rampowiec', label: 'Roboczy · Frachtowiec z rampą', cls: [6, 6], make };
