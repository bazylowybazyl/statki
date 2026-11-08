// src/render/blocks/escapePodBlock.js — blok migawki: kapsuły ratunkowe (E22, reguła `kapsuly-ratunkowe`).
//
// Gra (src/game/escapePods.js: `fillEscapePodRenderFrame`) składa ramkę obrazu kapsuł: pozy w chwili klatki renderu,
// tylko kapsuły poza kadłubem, widoczne (mgła wojny, maskowanie) i poza kropkami soczewki skoku; silnik (płomień) i ciąg.
// Worker renderu (i tryb `off` na stronie) rysuje z niej kadłubki, lampy i płomienie (src/3d/escapePods/escapePods3D.js).
//
// Rejestracja (strona gry): `packer.addBlock(createEscapePodBlock())`, w klatce `frame.pods = ramka`. Strona renderu:
// `applyEscapePodBlock(view.blocks.pods, ramka)` (ramka z `createEscapePodFrame`). Czysty moduł (bez three, DOM, `window`).

export const POD_BLOCK = Object.freeze({
  HEAD: 2,                         // [kapsuł, słowa użyte]
  ITEM: Object.freeze({ X: 0, Y: 1, ANG: 2, THRUST: 3, AGE: 4, SEED: 5, UID: 6, FLAGS: 7, STRIDE: 8 }),
  CAP: 192,
  /** Flagi kapsuły: silnik pracuje (płomień). */
  ENGINE: 1
});

const B = POD_BLOCK;
const I = B.ITEM;

/** Ramka obrazu kapsuł (strona gry i renderu — ten sam kształt). */
export function createEscapePodFrame(cap = B.CAP) {
  const n = Math.max(1, cap | 0);
  return {
    cap: n,
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    ang: new Float32Array(n),
    thrust: new Float32Array(n),
    age: new Float32Array(n),
    seed: new Int32Array(n),
    uid: new Int32Array(n),
    flags: new Uint8Array(n)
  };
}

export function escapePodBlockSize() {
  return B.HEAD + B.CAP * I.STRIDE;
}

/** Ramka → blok (Float64). */
export function packEscapePodBlock(F, frame) {
  const n = Math.min(frame?.count | 0, B.CAP);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    F[o + I.X] = frame.x[i]; F[o + I.Y] = frame.y[i]; F[o + I.ANG] = frame.ang[i];
    F[o + I.THRUST] = frame.thrust[i]; F[o + I.AGE] = frame.age[i]; F[o + I.SEED] = frame.seed[i];
    F[o + I.UID] = frame.uid[i]; F[o + I.FLAGS] = frame.flags[i];
  }
  F[0] = n;
  F[1] = o;
}

/** Blok do `packer.addBlock` (faza begin). Brak ramki (`frame.pods` null) — pusty blok. */
export function createEscapePodBlock() {
  return {
    name: 'pods', f64: escapePodBlockSize(), phase: 'begin',
    pack(blk, frame) {
      const F = blk.f64;
      if (!frame.pods) { F[0] = 0; F[1] = B.HEAD; return; }
      packEscapePodBlock(F, frame.pods);
    }
  };
}

/** Blok → ramka `out` (z `createEscapePodFrame`). Zwraca `out`. */
export function applyEscapePodBlock(blk, out) {
  const F = blk && blk.f64;
  out.count = 0;
  if (!F) return out;
  const n = Math.min(F[0] | 0, B.CAP, out.cap);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    out.x[i] = F[o + I.X]; out.y[i] = F[o + I.Y]; out.ang[i] = F[o + I.ANG];
    out.thrust[i] = F[o + I.THRUST]; out.age[i] = F[o + I.AGE]; out.seed[i] = F[o + I.SEED];
    out.uid[i] = F[o + I.UID]; out.flags[i] = F[o + I.FLAGS];
  }
  out.count = n;
  return out;
}
