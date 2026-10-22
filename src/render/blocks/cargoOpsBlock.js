// src/render/blocks/cargoOpsBlock.js — blok migawki: przeładunek w portach (E12 — ładownie, rój dronów, taśmociągi).
//
// Gra pakuje to, co jest rozgrywką albo jej odczytem: pola zatok w kadrze (plac: stoły i taśmy — infrastruktura
// portu), statki ruchu przy stanowiskach z kontraktem przeładunku E6 (`actors.cargo`: tryb LOAD / UNLOAD, postój,
// surowiec, wypełnienie ładowni) i zegarem postoju w chwili klatki, oraz ładunek gracza (luk Atlasa przy postoju
// i handlu). Worker renderu (i tryb `off` na stronie) liczy z tego cały obraz: plan przeładunku
// (src/game/swarm/berthTransfer.js), ładownie, kontenery, drony i taśmy (src/3d/cargo/portCargo3D.js). Kadłub —
// indeks w `PORT_CARGO_HULLS`, surowiec — indeks w `RESOURCE_KEYS` (te same tabele po obu stronach).
// Czysty moduł (bez three, DOM i `window`).
import { CARGO_BAY_HULL_ORDER } from '../../data/cargoBays.js';
import { RESOURCE_KEYS } from '../../data/resources.js';

/** Kadłuby z ładownią w stałej kolejności (indeks w bloku). */
export const PORT_CARGO_HULLS = CARGO_BAY_HULL_ORDER;
const HULL_INDEX = new Map(PORT_CARGO_HULLS.map((id, i) => [id, i]));
const RES_INDEX = new Map(RESOURCE_KEYS.map((id, i) => [id, i]));

export const BERTH_SIZE_CODES = Object.freeze(['S', 'M', 'L', 'MEGA', 'CAPITAL']);
const SIZE_INDEX = new Map(BERTH_SIZE_CODES.map((id, i) => [id, i]));

export const CARGO_OPS_BLOCK = Object.freeze({
  HEAD: 4,                        // [pola, przeładunki, gracz, słowa użyte]
  YARD: Object.freeze({ X: 0, Y: 1, ANGLE: 2, SIZE: 3, PAD_L: 4, PAD_B: 5, PORTAL: 6, HALF_BEAM: 7, SEED: 8, FLAGS: 9, STRIDE: 10 }),
  OP: Object.freeze({
    SEED: 0, YARD: 1, HULL: 2, SX: 3, SY: 4, SA: 5, MODE: 6, FILL: 7, RES: 8, DWELL: 9, MOVE: 10, DOCK_TIME: 11,
    HALF_BEAM: 12, FLAGS: 13, STRIDE: 16
  }),
  PLAYER: Object.freeze({ X: 0, Y: 1, ANGLE: 2, DOOR: 3, FILL: 4, FLAGS: 5, HULL: 6, RES: 7, STRIDE: 16 }),
  YARD_CAP: 96,
  OP_CAP: 48,
  /** Gracz: do 4 surowców (indeks, udział) od RES. */
  PLAYER_RES: 4,
  MODE_LOAD: 1,
  MODE_UNLOAD: 2,
  /** Gracz: fregata zwiadu w luku (miejsce zajęte). */
  PLAYER_FRIGATE: 1
});

const B = CARGO_OPS_BLOCK;
const Y = B.YARD;
const O = B.OP;
const PL = B.PLAYER;

export function cargoOpsBlockSize() {
  return B.HEAD + B.YARD_CAP * Y.STRIDE + B.OP_CAP * O.STRIDE + PL.STRIDE;
}

/**
 * Ramka przeładunku (strona gry) → blok. frame: { yards: [{ x, y, angle, size, padLength, padBeam, portalGap,
 * halfBeam, seed }], yardCount, ops: [{ seed, yard, hull, x, y, angle, mode, fill, resourceId, dwell, move,
 * dockTime, halfBeam }], opCount, player: { x, y, angle, door, fill, hull, frigate, res: [[id, udział]…] } | null }.
 */
export function packCargoOpsBlock(F, frame) {
  let o = B.HEAD;
  const ny = Math.min(frame?.yardCount | 0, B.YARD_CAP);
  for (let i = 0; i < ny; i++, o += Y.STRIDE) {
    const r = frame.yards[i];
    F[o + Y.X] = r.x; F[o + Y.Y] = r.y; F[o + Y.ANGLE] = r.angle;
    F[o + Y.SIZE] = SIZE_INDEX.get(r.size) ?? 1;
    F[o + Y.PAD_L] = r.padLength; F[o + Y.PAD_B] = r.padBeam; F[o + Y.PORTAL] = r.portalGap || 0;
    F[o + Y.HALF_BEAM] = r.halfBeam || 0; F[o + Y.SEED] = r.seed || 0; F[o + Y.FLAGS] = 0;
  }
  let nOp = 0;
  const nOps = Math.min(frame?.opCount | 0, B.OP_CAP);
  for (let i = 0; i < nOps; i++) {
    const r = frame.ops[i];
    const hull = HULL_INDEX.get(r.hull);
    if (hull === undefined) continue;
    F[o + O.SEED] = r.seed; F[o + O.YARD] = r.yard; F[o + O.HULL] = hull;
    F[o + O.SX] = r.x; F[o + O.SY] = r.y; F[o + O.SA] = r.angle;
    F[o + O.MODE] = r.mode === 'load' ? B.MODE_LOAD : r.mode === 'unload' ? B.MODE_UNLOAD : 0;
    F[o + O.FILL] = r.fill; F[o + O.RES] = RES_INDEX.get(r.resourceId) ?? -1;
    F[o + O.DWELL] = r.dwell; F[o + O.MOVE] = r.move || 0; F[o + O.DOCK_TIME] = r.dockTime;
    F[o + O.HALF_BEAM] = r.halfBeam || 0; F[o + O.FLAGS] = 0; F[o + 14] = 0; F[o + 15] = 0;
    o += O.STRIDE;
    nOp++;
  }
  const p = frame?.player;
  let np = 0;
  if (p && HULL_INDEX.has(p.hull)) {
    F[o + PL.X] = p.x; F[o + PL.Y] = p.y; F[o + PL.ANGLE] = p.angle; F[o + PL.DOOR] = p.door;
    F[o + PL.FILL] = p.fill; F[o + PL.FLAGS] = p.frigate ? B.PLAYER_FRIGATE : 0; F[o + PL.HULL] = HULL_INDEX.get(p.hull);
    for (let k = 0; k < B.PLAYER_RES; k++) {
      const e = p.res && p.res[k];
      F[o + PL.RES + k * 2] = e ? (RES_INDEX.get(e[0]) ?? -1) : -1;
      F[o + PL.RES + k * 2 + 1] = e ? e[1] : 0;
    }
    o += PL.STRIDE;
    np = 1;
  }
  F[0] = ny; F[1] = nOp; F[2] = np; F[3] = o;
  return nOp;
}

/** Blok do `packer.addBlock` (faza begin — przed kadłubami, jak blok `traffic`). */
export function createCargoOpsBlock() {
  return {
    name: 'cargoOps', f64: cargoOpsBlockSize(), phase: 'begin',
    pack(blk, frame) {
      const c = frame.cargoOps;
      if (!c) { blk.f64[0] = 0; blk.f64[1] = 0; blk.f64[2] = 0; blk.f64[3] = B.HEAD; return; }
      packCargoOpsBlock(blk.f64, c);
    }
  };
}

function rec(list, i, make) {
  let r = list[i];
  if (!r) { r = make(); list[i] = r; }
  return r;
}

/**
 * Strona renderu: blok → ramka (ten sam kształt co ramka strony; obiekty wielokrotnego użytku w `out`).
 * Zwraca `out` ({ yards, yardCount, ops, opCount, player }).
 */
export function applyCargoOpsBlock(blk, out) {
  const F = blk && blk.f64;
  out.yardCount = 0; out.opCount = 0; out.player = null;
  if (!out.yards) out.yards = [];
  if (!out.ops) out.ops = [];
  if (!F) return out;
  const ny = Math.min(F[0] | 0, B.YARD_CAP);
  const nOp = Math.min(F[1] | 0, B.OP_CAP);
  let o = B.HEAD;
  for (let i = 0; i < ny; i++, o += Y.STRIDE) {
    const r = rec(out.yards, i, () => ({ x: 0, y: 0, angle: 0, size: 'M', padLength: 0, padBeam: 0, portalGap: 0, halfBeam: 0, seed: 0 }));
    r.x = F[o + Y.X]; r.y = F[o + Y.Y]; r.angle = F[o + Y.ANGLE];
    r.size = BERTH_SIZE_CODES[F[o + Y.SIZE] | 0] || 'M';
    r.padLength = F[o + Y.PAD_L]; r.padBeam = F[o + Y.PAD_B]; r.portalGap = F[o + Y.PORTAL];
    r.halfBeam = F[o + Y.HALF_BEAM]; r.seed = F[o + Y.SEED];
  }
  out.yardCount = ny;
  for (let i = 0; i < nOp; i++, o += O.STRIDE) {
    const r = rec(out.ops, i, () => ({ seed: 0, yard: -1, hull: '', x: 0, y: 0, angle: 0, mode: null, fill: 0, resourceId: null, dwell: 0, move: 0, dockTime: 0, halfBeam: 0 }));
    r.seed = F[o + O.SEED]; r.yard = F[o + O.YARD]; r.hull = PORT_CARGO_HULLS[F[o + O.HULL] | 0] || '';
    r.x = F[o + O.SX]; r.y = F[o + O.SY]; r.angle = F[o + O.SA];
    const m = F[o + O.MODE];
    r.mode = m === B.MODE_LOAD ? 'load' : m === B.MODE_UNLOAD ? 'unload' : null;
    r.fill = F[o + O.FILL];
    const ri = F[o + O.RES] | 0;
    r.resourceId = ri >= 0 ? RESOURCE_KEYS[ri] || null : null;
    r.dwell = F[o + O.DWELL]; r.move = F[o + O.MOVE]; r.dockTime = F[o + O.DOCK_TIME]; r.halfBeam = F[o + O.HALF_BEAM];
  }
  out.opCount = nOp;
  if ((F[2] | 0) > 0) {
    const p = out._player || (out._player = { x: 0, y: 0, angle: 0, door: 0, fill: 0, hull: '', frigate: false, res: [] });
    p.x = F[o + PL.X]; p.y = F[o + PL.Y]; p.angle = F[o + PL.ANGLE]; p.door = F[o + PL.DOOR]; p.fill = F[o + PL.FILL];
    p.frigate = !!((F[o + PL.FLAGS] | 0) & B.PLAYER_FRIGATE);
    p.hull = PORT_CARGO_HULLS[F[o + PL.HULL] | 0] || '';
    // Pary [surowiec, udział] wielokrotnego użytku (bez alokacji w klatce).
    if (!p._pairs) p._pairs = Array.from({ length: B.PLAYER_RES }, () => ['', 0]);
    p.res.length = 0;
    for (let k = 0; k < B.PLAYER_RES; k++) {
      const ri = F[o + PL.RES + k * 2] | 0;
      if (ri < 0 || !RESOURCE_KEYS[ri]) continue;
      const pair = p._pairs[k];
      pair[0] = RESOURCE_KEYS[ri];
      pair[1] = F[o + PL.RES + k * 2 + 1];
      p.res.push(pair);
    }
    out.player = p;
  }
  return out;
}
