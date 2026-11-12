// src/game/hullDesign/freighters/megafrachtowiec.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// MEGAFRACHTOWIEC (klasa VI cywilna): segmentowy „pociąg” na jednym kręgosłupie — rów maszynowni wzdłuż osi łączy
// blok silników na rufie, pięć szerokich wagonów ładunkowych rozdzielonych wąskimi szyjkami (zasobniki 3 × 3 na końcach,
// 2 × 2 obok, ośmiokątny wagon z kulami zbiorników w środku) i wieżę mostka VI na dziobie.

import {
  freighter, blk, blkAt, frameBlk, engine, reactor, bridge, fuelTank, side, pods, spheres, castle, label, stripe, TO_AXIS
} from './freighterKit.js';

const SPINE = 24;          // pół-szerokość rowu kręgosłupa
const NECK = 56;           // pół-szerokość szyjki
const SEC = 168;           // pół-szerokość wagonu ładunkowego

function make() {
  const shapes = [];
  const modules = [];
  const decals = [];
  const castles = [];
  // ── RUFA: blok silników ──────────────────────────────────────────────────────────────────────────────────────
  shapes.push(frameBlk(-1200, -216, -960, 216, { c: [16, 40, 40, 16] }));
  shapes.push(blk('rect', -1120, -216, -960, -136, 1, { c: [0, 40, 0, 0] }));     // płyta burty bloku (kasztel)
  shapes.push(blk('rect', -1120, -120, -1048, -24));                              // płyta zbiornika
  shapes.push(blk('rect', -1032, -120, -960, -56));                               // płyta przed zbiornikiem
  shapes.push(blk('rect', -1032, -40, -968, 40, 1, { c: [8, 8, 8, 8] }));         // platforma rdzenia (na osi)
  modules.push(engine(-1180, 0, 36, 26, 1));
  for (const y of [-60, -116, -172]) modules.push(engine(-1180, y, 32, 22, 1));
  modules.push(reactor(-1000, 30));
  modules.push(fuelTank(-1084, -64, 24, 30, TO_AXIS));
  modules.push(side(-1144, -205, 13, 9));
  castles.push(castle(-1032, -176, 56, 24, { tiers: 2, taper: 0.35 }));
  // ── SZYJKI i WAGONY ŁADUNKOWE ────────────────────────────────────────────────────────────────────────────────
  const neck = (x0, x1, num) => {
    shapes.push(frameBlk(x0, -NECK, x1, NECK));
    shapes.push(blk('rect', x0, -NECK, x1, -SPINE));
    if (num) decals.push(label(num, (x0 + x1) / 2, -40, 28, 14));
  };
  const wagon = (x0, x1, n) => {
    shapes.push(frameBlk(x0, -SEC, x1, SEC, { c: [32, 32, 32, 32] }));
    shapes.push(blk('rect', x0, -SEC, x1, -SPINE, 1, { c: [32, 32, 0, 0] }));
    modules.push(pods((x0 + x1) / 2, -92, 136, 60, n));
  };
  neck(-960, -880, '01');
  wagon(-880, -560, 3);
  neck(-560, -496, '02');
  wagon(-496, -176, 2);
  neck(-176, -112, '03');
  // wagon zbiornikowy: szerszy ośmiokąt z kulami
  shapes.push(frameBlk(-112, -200, 208, 200, { c: [64, 64, 64, 64] }));
  shapes.push(blk('rect', -112, -200, 208, -SPINE, 1, { c: [64, 64, 0, 0] }));
  modules.push(spheres(48, -106, 116, 70, 2));
  neck(208, 272, '04');
  wagon(272, 592, 2);
  neck(592, 656, '05');
  wagon(656, 976, 3);
  neck(976, 1032);
  // ── DZIÓB: wieża mostka ──────────────────────────────────────────────────────────────────────────────────────
  shapes.push(frameBlk(1032, -152, 1240, 152, { c: [32, 0, 0, 32] }));
  shapes.push(blk('rect', 1032, -152, 1240, -80, 1, { c: [32, 0, 0, 0] }));     // barki dziobu (kasztel)
  shapes.push(blk('rect', 1048, -64, 1224, 64, 2, { c: [16, 16, 16, 16] }));      // wieża mostka (nadbudówka)
  shapes.push(blkAt('trap', 1280, 0, 304, 80, 2, 1, { a: 80, b: 80 }));          // nos (skosy 45°)
  modules.push(bridge(1136));
  modules.push(side(1080, -141, 13, 9));
  castles.push(castle(1168, -116, 56, 22, { tiers: 2, taper: 0.35 }));
  decals.push(label('ORBITAL BULK', 1260, 0, 120, 16, { rot: -Math.PI / 2 }));
  decals.push(stripe(1104, -88, 1232, -88, 4));
  return freighter('Megafrachtowiec', 2731, 1.45, { grid: 8, shapes, modules, castles, decals });
}

export default { key: 'megafrachtowiec', label: 'Cywil · Megafrachtowiec', cls: [6, 6], make };
