// src/render/blocks/trafficWorkBlock.js — blok migawki: praca statków ruchu v2 w bańce (E24).
//
// Gra (`src/game/trafficSalvage.js`: `fillTrafficWorkFrame`) składa ramkę pracy w chwili klatki renderu: górnik przy
// polu (rodzaj MINE — drony i lasery platformy w `MiningView` pasa), złomiarz tnie wrak (CUT — palniki, iskry,
// odłamki) albo holuje (TOW — wiązka przy linie; samą linę rysuje kanwa 2D z `TowSystem`). Worker renderu (i tryb
// `off` na stronie) rysuje z niej obraz (`src/3d/trafficWork3D.js`). Rodzaje = `TRAFFIC_WORK_KIND`.
// Cięcie jako proces (reguła `zlomowanie`): rekord CUT z flagą SCRAP niesie pole `aux` — pozy osprzętu złomiarza
// w UKŁADZIE STATKU (`TRAFFIC_WORK_AUX`): wysięgniki, palniki, wiązki trzymające wrak, paszcza.
//
// Rejestracja (strona gry): `packer.addBlock(createTrafficWorkBlock())`, w klatce `frame.trafficWork = ramka`.
// Strona renderu: `applyTrafficWorkBlock(view.blocks.trafficWork, ramka)` (ramka z `createTrafficWorkFrame`).
// Czysty moduł (bez three, DOM i `window`).

/** Pole `aux` rekordu pracy z flagą SCRAP (układ statku: x — dziób, y — prawa burta; j.). */
export const TRAFFIC_WORK_AUX = Object.freeze({
  /** Wysięgnik i (0, 1): od `ARM + i · ARM_STRIDE` — głowica x, y, palnik 0–1, podstawa x, y. */
  ARM: 0, ARM_STRIDE: 5, HX: 0, HY: 1, TORCH: 2, MX: 3, MY: 4,
  /** Długość członu wysięgnika (dwa równe człony). */
  SEG: 10,
  /** Wiązki trzymające: cel na wraku (2 × x, y), siła 0–1, emitery na dziobie (2 × x, y). */
  G0X: 11, G0Y: 12, G1X: 13, G1Y: 14, GRIP: 15, E0X: 16, E0Y: 17, E1X: 18, E1Y: 19,
  /** Paszcza: punkt x, y i praca 0–1. */
  MAW_X: 20, MAW_Y: 21, MAW: 22,
  COUNT: 24
});

export const TRAFFIC_WORK_BLOCK = Object.freeze({
  HEAD: 2,                         // [rekordów, słowa użyte]
  ITEM: Object.freeze({
    KIND: 0, ID: 1, X: 2, Y: 3, ANG: 4, LEN: 5, TX: 6, TY: 7, TR: 8, K: 9, FLAGS: 10, AUX: 11,
    STRIDE: 11 + TRAFFIC_WORK_AUX.COUNT
  }),
  /** Bańka: górnicy i złomiarze w pracy — kilkanaście naraz; zapas. */
  CAP: 64,
  /** Złomiarz wraca z wrakiem na linie (przelot powrotny). */
  FLAG_HAUL: 1,
  /** Cięcie jako proces: pole `aux` rekordu jest ważne. */
  FLAG_SCRAP: 2
});

const B = TRAFFIC_WORK_BLOCK;
const I = B.ITEM;
const AUX_N = TRAFFIC_WORK_AUX.COUNT;

/** Rekord pracy (strona gry i renderu — ten sam kształt). */
export function makeTrafficWorkRecord() {
  return {
    kind: 0, id: 0, x: 0, y: 0, angle: 0, prevX: NaN, prevY: NaN, prevAngle: NaN, length: 0, tx: 0, ty: 0, tr: 0, k: 0,
    haul: false, scrap: false, aux: new Float32Array(AUX_N)
  };
}

/** Ramka pracy (strona gry i renderu — ten sam kształt): `{ list, count }`. */
export function createTrafficWorkFrame(cap = B.CAP) {
  const list = [];
  for (let i = 0; i < cap; i++) list.push(makeTrafficWorkRecord());
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
    const scrap = r.scrap === true && !!r.aux;
    F[o + I.FLAGS] = (r.haul ? B.FLAG_HAUL : 0) | (scrap ? B.FLAG_SCRAP : 0);
    if (scrap) for (let k = 0; k < AUX_N; k++) F[o + I.AUX + k] = r.aux[k];
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
    const flags = F[o + I.FLAGS] | 0;
    r.haul = (flags & B.FLAG_HAUL) !== 0;
    r.scrap = (flags & B.FLAG_SCRAP) !== 0;
    if (r.scrap) for (let k = 0; k < AUX_N; k++) r.aux[k] = F[o + I.AUX + k];
  }
  out.count = n;
  return out;
}
