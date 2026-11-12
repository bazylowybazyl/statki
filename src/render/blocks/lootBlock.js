// src/render/blocks/lootBlock.js — blok migawki: kontenery-łup (K2, docs/PROPOZYCJA-kontenery-lup.md § 3.3).
//
// Gra (src/game/lootContainers.js: `fillLootRenderFrame`) składa ramkę obrazu paczek: pozy w chwili klatki renderu,
// tylko paczki widoczne (mgła wojny) i poza kropkami soczewki skoku, wiązka (flaga) i poza statku gracza (źródło
// wiązki). Worker renderu (i tryb `off` na stronie) rysuje z niej kontenery, lampki i wiązkę
// (src/3d/cargo/lootContainers3D.js). Surowiec — indeks w `RESOURCE_KEYS` (ta sama tabela po obu stronach).
//
// Rejestracja (strona gry): `packer.addBlock(createLootBlock())`, w klatce `frame.loot = ramka`. Strona renderu:
// `applyLootBlock(view.blocks.loot, ramka)` (ramka z `createLootFrame`). Czysty moduł (bez three, DOM i `window`).

export const LOOT_BLOCK = Object.freeze({
  HEAD: 5,                         // [paczek, statek x, statek y, jest statek, słowa użyte]
  ITEM: Object.freeze({ X: 0, Y: 1, ANG: 2, RES: 3, SEED: 4, UNIT: 5, MASS: 6, AGE: 7, FLAGS: 8, UID: 9, STRIDE: 10 }),
  CAP: 256,
  /** Flagi paczki: w wiązce, końcówka życia (lampka mruga szybciej). */
  TRACTOR: 1,
  FADE: 2
});

const B = LOOT_BLOCK;
const I = B.ITEM;

/** Ramka obrazu paczek (strona gry i renderu — ten sam kształt). */
export function createLootFrame(cap = B.CAP) {
  const n = Math.max(1, cap | 0);
  return {
    cap: n,
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    ang: new Float32Array(n),
    res: new Int16Array(n),
    seed: new Int32Array(n),
    unit: new Int16Array(n),
    mass: new Float32Array(n),
    age: new Float32Array(n),
    flags: new Uint8Array(n),
    uid: new Int32Array(n),
    hasShip: false,
    shipX: 0,
    shipY: 0
  };
}

export function lootBlockSize() {
  return B.HEAD + B.CAP * I.STRIDE;
}

/** Ramka → blok (Float64). */
export function packLootBlock(F, frame) {
  const n = Math.min(frame?.count | 0, B.CAP);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    F[o + I.X] = frame.x[i]; F[o + I.Y] = frame.y[i]; F[o + I.ANG] = frame.ang[i];
    F[o + I.RES] = frame.res[i]; F[o + I.SEED] = frame.seed[i]; F[o + I.UNIT] = frame.unit[i];
    F[o + I.MASS] = frame.mass[i]; F[o + I.AGE] = frame.age[i]; F[o + I.FLAGS] = frame.flags[i];
    F[o + I.UID] = frame.uid[i];
  }
  F[0] = n;
  F[1] = frame && frame.hasShip ? frame.shipX : 0;
  F[2] = frame && frame.hasShip ? frame.shipY : 0;
  F[3] = frame && frame.hasShip ? 1 : 0;
  F[4] = o;
}

/** Blok do `packer.addBlock` (faza begin). Brak ramki (`frame.loot` null) — pusty blok. */
export function createLootBlock() {
  return {
    name: 'loot', f64: lootBlockSize(), phase: 'begin',
    pack(blk, frame) {
      const F = blk.f64;
      if (!frame.loot) { F[0] = 0; F[1] = 0; F[2] = 0; F[3] = 0; F[4] = B.HEAD; return; }
      packLootBlock(F, frame.loot);
    }
  };
}

/** Blok → ramka `out` (z `createLootFrame`). Zwraca `out`. */
export function applyLootBlock(blk, out) {
  const F = blk && blk.f64;
  out.count = 0;
  out.hasShip = false;
  if (!F) return out;
  const n = Math.min(F[0] | 0, B.CAP, out.cap);
  let o = B.HEAD;
  for (let i = 0; i < n; i++, o += I.STRIDE) {
    out.x[i] = F[o + I.X]; out.y[i] = F[o + I.Y]; out.ang[i] = F[o + I.ANG];
    out.res[i] = F[o + I.RES]; out.seed[i] = F[o + I.SEED]; out.unit[i] = F[o + I.UNIT];
    out.mass[i] = F[o + I.MASS]; out.age[i] = F[o + I.AGE]; out.flags[i] = F[o + I.FLAGS];
    out.uid[i] = F[o + I.UID];
  }
  out.count = n;
  out.hasShip = F[3] > 0.5;
  out.shipX = F[1];
  out.shipY = F[2];
  return out;
}
