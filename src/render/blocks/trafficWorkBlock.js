// src/render/blocks/trafficWorkBlock.js — blok migawki: praca statków ruchu v2 w bańce (E24).
//
// Gra (`src/game/trafficSalvage.js`: `fillTrafficWorkFrame`) składa ramkę pracy w chwili klatki renderu: górnik przy
// polu (rodzaj MINE — drony i lasery platformy w `MiningView` pasa), złomiarz tnie wrak (CUT — palniki, iskry,
// odłamki) albo holuje (TOW — wiązka przy linie; samą linę rysuje kanwa 2D z `TowSystem`). Worker renderu (i tryb
// `off` na stronie) rysuje z niej obraz (`src/3d/trafficWork3D.js`). Rodzaje = `TRAFFIC_WORK_KIND`.
//
// Rejestracja (strona gry): `packer.addBlock(createTrafficWorkBlock())`, w klatce `frame.trafficWork = ramka`.
// Strona renderu: `applyTrafficWorkBlock(view.blocks.trafficWork, ramka)` (ramka z `createTrafficWorkFrame`).
// Czysty moduł (bez three, DOM i `window`).

export const TRAFFIC_WORK_BLOCK = Object.freeze({
  HEAD: 2,                         // [rekordów, słowa użyte]
  ITEM: Object.freeze({ KIND: 0, ID: 1, X: 2, Y: 3, ANG: 4, LEN: 5, TX: 6, TY: 7, TR: 8, K: 9, FLAGS: 10, STRIDE: 11 }),
  /** Bańka: górnicy i złomiarze w pracy — kilkanaście naraz; zapas. */
  CAP: 64,
  /** Złomiarz wraca z wrakiem na linie (przelot powrotny). */
  FLAG_HAUL: 1
});

const B = TRAFFIC_WORK_BLOCK;
const I = B.ITEM;

function makeRecord() {
  return { kind: 0, id: 0, x: 0, y: 0, angle: 0, prevX: NaN, prevY: NaN, prevAngle: NaN, length: 0, tx: 0, ty: 0, tr: 0, k: 0, haul: false };
}

/** Ramka pracy (strona gry i renderu — ten sam kształt): `{ list, count }`. */
export function createTrafficWorkFrame(cap = B.CAP) {
  const list = [];
  for (let i = 0; i < cap; i++) list.push(makeRecord());
  return { list, count: 0 };
}

export function trafficWorkBlockSize() {
  return B.HEAD + B.CAP * I.STRIDE;
}

/** Ramka → blok (Float64). */
export function packTrafficWorkBlock(F, frame) {
  const n = Math.min(frame?.count | 0, B.CAP);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    const r = frame.list[i];
    F[o + I.KIND] = r.kind; F[o + I.ID] = r.id; F[o + I.X] = r.x; F[o + I.Y] = r.y; F[o + I.ANG] = r.angle;
    F[o + I.LEN] = r.length; F[o + I.TX] = r.tx; F[o + I.TY] = r.ty; F[o + I.TR] = r.tr; F[o + I.K] = r.k;
    F[o + I.FLAGS] = r.haul ? B.FLAG_HAUL : 0;
  }
  F[0] = n;
  F[1] = o;
  return n;
}

/** Blok do `packer.addBlock` (faza begin). Brak ramki (`frame.trafficWork` null) — pusty blok. */
export function createTrafficWorkBlock() {
  return {
    name: 'trafficWork', f64: trafficWorkBlockSize(), phase: 'begin',
    pack(blk, frame) {
      const F = blk.f64;
      if (!frame.trafficWork) { F[0] = 0; F[1] = B.HEAD; return; }
      packTrafficWorkBlock(F, frame.trafficWork);
    }
  };
}

/** Blok → ramka `out` (z `createTrafficWorkFrame`). Zwraca `out`. */
export function applyTrafficWorkBlock(blk, out) {
  const F = blk && blk.f64;
  if (!F) { out.count = 0; return out; }
  const n = Math.min(F[0] | 0, B.CAP, out.list.length);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    const r = out.list[i];
    r.kind = F[o + I.KIND]; r.id = F[o + I.ID]; r.x = F[o + I.X]; r.y = F[o + I.Y]; r.angle = F[o + I.ANG];
    r.length = F[o + I.LEN]; r.tx = F[o + I.TX]; r.ty = F[o + I.TY]; r.tr = F[o + I.TR]; r.k = F[o + I.K];
    r.haul = (F[o + I.FLAGS] & B.FLAG_HAUL) !== 0;
  }
  out.count = n;
  return out;
}
