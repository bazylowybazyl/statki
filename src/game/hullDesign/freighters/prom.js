// src/game/hullDesign/freighters/prom.js — preset frachtowca (zestaw: ./freighterKit.js, rejestr: ./index.js).
//
// PROM (klasa I cywilna): mały prom stacja–stacja dla załóg i drobnych ładunków. Sylwetka: krótki, szeroki „autobus”
// z sześciokątnym nosem i przeszkloną sterówką przy dziobie, pokłady pasażerskie z oknami wzdłuż obu burt, ładownia
// z klapą na środku, z rufy na krótkich wspornikach dwie wysunięte gondole silników.
import {
  freighter, blk, frameBlk, engine, reactor, bridge, fuelTank, side, hold, port, label, stripe, TO_AXIS
} from './freighterKit.js';

function make() {
  const d = freighter('Prom', 71, 0.055, {
    grid: 0.5, style: 'rounded', windows: 0.85,
    shapes: [
      // rama: kadłub, wsporniki, gondole (rowy maszynowni = odstępy między płytami)
      frameBlk(-38, -18, 48, 18, { c: [3, 10, 10, 3] }),
      frameBlk(-24, -22.5, -20, -17.5),                               // wspornik gondoli (rów rur i kabli)
      frameBlk(-46, -32, -14, -22, { c: [2, 5, 5, 2] }),              // gondola
      // rufa: płyta reaktora na osi, płyty zbiorników przy burtach
      blk('rect', -38, -5, -23, 5),
      blk('rect', -38, -18, -23, -7, 1, { c: [3, 0, 0, 0] }),
      // śródokręcie: ładownia na osi, pokłady pasażerskie z oknami przy burtach
      blk('rect', -21, -10, 14, 10),
      blk('rect', -21, -18, 14, -12, 2),
      // dziób: nos sześciokątny i przeszklona sterówka
      blk('rect', 16, -18, 48, 18, 1, { c: [0, 10, 10, 0] }),
      blk('rect', 18, -11, 46, 11, 2, { c: [0, 6, 6, 0] }),
      // gondola: płyta zewnętrzna, wewnętrzna i nos; rów od wspornika do dyszy pośrodku
      blk('rect', -46, -32, -20, -28, 1, { c: [2, 0, 0, 0] }),
      blk('rect', -42, -26, -24, -22, 1, { c: [0, 0, 0, 1.5] }),
      blk('rect', -20, -32, -14, -22, 1, { c: [0, 4, 4, 0] })         // nos gondoli
    ],
    modules: [
      reactor(-30, 5),
      bridge(31),
      fuelTank(-30.5, -12.5, 3, 2, TO_AXIS),
      engine(-42, -27, 4, 3, 1),
      side(19.5, -17, 1.5, 1),
      hold(-3.5, 0, 17, 9.5, 1),
      port(-14, -15, 1.4), port(7, -15, 1.4)              // śluzy pasażerskie w pokładach burt
    ],
    decals: [
      label('PROM 07', 30, -14.5, 12, 2.2),
      stripe(-37, -30, -21, -30, 1.2)                     // bursztynowy pas na gondoli
    ]
  });
  return d;
}

export default { key: 'prom', label: 'Cywil · Prom', cls: [1, 1], make };
