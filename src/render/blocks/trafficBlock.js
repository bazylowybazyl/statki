// src/render/blocks/trafficBlock.js — blok migawki: statki ruchu v2 w bańce (E6, docs/PLAN-ekonomia-rynki.md § 3.5).
//
// Lot liczy worker ruchu, gra ekstrapoluje pozy do chwili klatki renderu (`src/game/trafficBubble.js`) i pakuje je tu;
// worker renderu rysuje z nich proxy kadłubów (`ShipProxyBatch3D`, src/3d/shipProxyBatch3D.js) i dysze MAIN (widoki
// encji do `updateHexShips3D`). Kadłub = indeks w `TRAFFIC_HULL_IDS` (ta sama tabela po obu stronach — bez napisów
// w stronie). Poza jest już w czasie klatki, więc worker rysuje z alpha = 1.
//
// Rejestracja (strona gry): `packer.addBlock(createTrafficBlock())`, w klatce `frame.traffic = { list, count }`
// (rekordy renderu: courseId, hullId, x, y, angle, vx, vy, speed, throttle, mode). Strona renderu:
// `applyTrafficBlock(view.blocks.traffic, out)` → tablica rekordów dla `ShipProxyBatch3D.update`.
// Czysty moduł (bez three, DOM i `window`).
import { TRAFFIC_HULLS } from '../../data/trafficHulls.js';

/** Kadłuby proxy w stałej kolejności (indeks w bloku). */
export const TRAFFIC_HULL_IDS = Object.freeze(Object.keys(TRAFFIC_HULLS));
const HULL_INDEX = new Map(TRAFFIC_HULL_IDS.map((id, index) => [id, index]));

export const TRAFFIC_BLOCK = Object.freeze({
  HEAD: 2,                         // [liczba statków, słowa użyte]
  SHIP: Object.freeze({ ID: 0, HULL: 1, X: 2, Y: 3, ANGLE: 4, VX: 5, VY: 6, SPEED: 7, THROTTLE: 8, FLAGS: 9, STRIDE: 10 }),
  /** Bańka ruchu trzyma najwyżej 400 encji (`FLIGHT_DEFAULTS.maxActors`). */
  CAP: 512,
  FLAG_WARP: 1
});

const S = TRAFFIC_BLOCK.SHIP;

/** Rekordy renderu → blok (`f64`). Zwraca liczbę spakowanych. */
export function packTrafficBlock(F, list, count) {
  const n = Math.min(count | 0, TRAFFIC_BLOCK.CAP);
  let o = TRAFFIC_BLOCK.HEAD;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = list[i];
    const hull = HULL_INDEX.get(r.hullId);
    if (hull === undefined) continue;
    F[o + S.ID] = r.courseId;
    F[o + S.HULL] = hull;
    F[o + S.X] = r.x;
    F[o + S.Y] = r.y;
    F[o + S.ANGLE] = r.angle;
    F[o + S.VX] = r.vx;
    F[o + S.VY] = r.vy;
    F[o + S.SPEED] = r.speed;
    F[o + S.THROTTLE] = r.throttle;
    F[o + S.FLAGS] = r.mode === 'warp' ? TRAFFIC_BLOCK.FLAG_WARP : 0;
    o += S.STRIDE;
    k++;
  }
  F[0] = k;
  F[1] = o;
  return k;
}

/** Blok do `packer.addBlock` (faza begin — przed kadłubami). */
export function createTrafficBlock() {
  return {
    name: 'traffic', f64: TRAFFIC_BLOCK.HEAD + TRAFFIC_BLOCK.CAP * S.STRIDE, phase: 'begin',
    pack(blk, frame) {
      const t = frame.traffic;
      if (!t || !t.list) { blk.f64[0] = 0; blk.f64[1] = TRAFFIC_BLOCK.HEAD; return; }
      packTrafficBlock(blk.f64, t.list, t.count);
    }
  };
}

/**
 * Strona renderu: rekordy z bloku do `out` (tablica obiektów trzymana przez wołającego — rekordy wielokrotnego
 * użytku, kształt jak encja bańki dla `ShipProxyBatch3D.pushActor`). Zwraca `out`.
 */
export function applyTrafficBlock(blk, out) {
  const F = blk && blk.f64;
  const n = F ? Math.min(F[0] | 0, TRAFFIC_BLOCK.CAP) : 0;
  let o = TRAFFIC_BLOCK.HEAD;
  for (let i = 0; i < n; i++, o += S.STRIDE) {
    let r = out[i];
    if (!r) {
      r = { courseId: 0, hullId: '', x: 0, y: 0, angle: 0, prevX: NaN, prevY: NaN, prevAngle: NaN,
        vx: 0, vy: 0, speed: 0, throttle: 0, mode: null };
      out[i] = r;
    }
    r.courseId = F[o + S.ID];
    r.hullId = TRAFFIC_HULL_IDS[F[o + S.HULL]] || '';
    r.x = F[o + S.X];
    r.y = F[o + S.Y];
    r.angle = F[o + S.ANGLE];
    r.vx = F[o + S.VX];
    r.vy = F[o + S.VY];
    r.speed = F[o + S.SPEED];
    r.throttle = F[o + S.THROTTLE];
    r.mode = (F[o + S.FLAGS] & TRAFFIC_BLOCK.FLAG_WARP) ? 'warp' : null;
  }
  out.length = n;
  return out;
}
