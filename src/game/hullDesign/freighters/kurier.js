// src/game/hullDesign/freighters/kurier.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// KURIER (klasa II, frachtowiec ekspresowy): smukła strzała — długi ostry nos z mostkiem, wąski grzbiet z zasobnikami
// i żądłem rufy między gondolami, skrzydła delta ze skosem 45° niosące zasobniki schodkami wzdłuż krawędzi natarcia,
// dwie duże gondole MAIN w zatokach za skrzydłami. Korytarz sieci: rowy wzdłuż grzbietu (y ±12…±20), rów poprzeczny
// rdzenia, rów przed nosem (mostek), rów wzdłuż skrzydła między rzędami zasobników i zatoki gondol na rufie.

import {
  freighter, blk, blkAt, frameBlk, engine, reactor, bridge, fuelTank, side, pods, vent, hatch, label, stripe, TO_BOW
} from './freighterKit.js';

// krawędź natarcia skrzydła (45°): x przodu skrzydła przy |y| = 20
const LE = 6;
const le = (y) => LE - (-y - 20);

function make() {
  const d = freighter('Kurier', 211, 0.16, {
    grid: 1,
    shapes: [
      // ── RAMA: rowy sieci ──
      frameBlk(-120, -20, 50, -12),                       // rów wzdłuż grzbietu (lustro: druga burta)
      frameBlk(-58, -12, -40, 12),                        // rów poprzeczny rdzenia
      frameBlk(44, -12, 50, 12),                          // rów przed nosem (mostek)
      frameBlk(-120, -64, -104, -20),                     // zatoka gondoli MAIN
      frameBlk(-104, -44, -40, -38),                      // rów wzdłuż skrzydła (między rzędami zasobników)
      // ── GRZBIET ──
      blk('rect', -132, -12, -58, 12, 1, { c: [8, 0, 0, 8] }),   // grzbiet rufowy z żądłem między gondolami (zbiornik)
      blk('rect', -40, -12, 44, 12),                      // grzbiet dziobowy (zasobniki)
      // ── SKRZYDŁO DELTA (krawędź natarcia 45°) ──
      blk('trap', -104, -38, LE, -20, 1, { b: 18 }),      // skrzydło wewnętrzne
      blk('trap', -40, -44, le(-38), -38, 1, { b: 6 }),   // skrzydło: płyta przed rowem
      blk('trap', -104, -64, le(-44), -44, 1, { b: 20 }), // skrzydło zewnętrzne
      blk('rect', -132, -64, -104, -56, 2, { c: [2, 0, 0, 6] }), // lotka: koniec skrzydła wysunięty za zatokę
      blk('rect', -6, -26, 50, -20),                      // pas burty przed skrzydłem
      // ── NOS (klin obrócony o 90°) ──
      blkAt('trap', 95, 0, 52, 90, 2, 1, { a: 24, b: 24 })
    ],
    decals: [
      stripe(le(-62) - 2, -62, le(-46) - 2, -46, 1.6),
      stripe(52, -23, 120, -5, 1.6),
      stripe(le(-36) - 2, -36, le(-22) - 2, -22, 1.6),
      label('KURIER', 10, -23, 24, 3.6)
    ]
  });
  d.modules.push(
    reactor(-49, 8),
    bridge(74),
    fuelTank(-95, 0, 22, 8, TO_BOW),
    engine(-122, -41, 16, 12, 2),
    side(-112, -64, 4, 2.5),
    side(34, -26, 4, 2.5),
    vent(-124, 0, 2.5, 5), vent(37, 0, 3, 7), hatch(108, 0, 4, 2.5),
    // ładunek: zasobniki na grzbiecie i schodkami (45°) wzdłuż skrzydła
    pods(-4.5, 0, 33.5, 8.5),
    pods(le(-37.5) - 2 - 33.5, -29, 33.5, 8.5),
    pods(le(-62) - 2 - 33.2, -53.5, 33.2, 8.5)
  );
  return d;
}

export default { key: 'kurier', label: 'Cywil · Kurier', cls: [2, 2], make };
