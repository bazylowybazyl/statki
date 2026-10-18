// src/render/blocks/pirateBaseBlock.js — blok migawki: klatka bazy piratów misji 1 (docs/PLAN-render-worker.md § 3.2,
// RW-11c; stan bazy po stronie gry — RW-24).
//
// Obraz bazy (src/3d/pirateBaseGame.js: updatePirateBase3D(dt, stan)) dostaje co klatkę stan z gry
// (`storyBaseFrameState` w index.html): mgła wojny (`hidden`), śmierć habitatu, alarm, hangary dronów, zajęte
// stanowiska (bity), zasilanie budowli, słońce, pora dnia; `dt` gry (0 w pauzie i scenach fabuły). Blok niesie to
// w Float64 — `applyPirateBaseBlock` odtwarza obiekt o tym samym kształcie (pole nieobecne — `daylight`, słońce —
// zostaje nieobecne, jak w obiekcie gry). Rejestracja (strona gry): `packer.addBlock(createPirateBaseBlock())`, w fazie
// begin `frame.pirateBase = storyBaseFrameState()`, `frame.pirateBaseDt`. Czysty moduł (bez three, DOM i `window`).

export const PIRATE_BASE_BLOCK = Object.freeze({
  // HAS: stan obecny; FLAGS: bity hidden 1, habitatDead 2, alarm 4; BAYS 0/1; SUN_OK / DAY_OK: pole obecne
  // TECH, DRUM_Q (4 liczby) — światła wnętrza głowy wieży i ćwiartek bębna (dekompresja, 2026-10-19)
  HEAD: Object.freeze({ HAS: 0, DT: 1, FLAGS: 2, BAYS: 3, HABITAT: 4, DISC: 5, FUEL: 6, WAREHOUSE: 7, SUN_OK: 8,
    SUN_X: 9, SUN_Y: 10, DAY_OK: 11, DAYLIGHT: 12, BERTHS: 13, TECH: 14, DRUM_Q: 15, STRIDE: 20 }),
  BERTH_WORDS: 64,                 // 26 stanowisk na słowo (bity dokładne w mantysie)
  BITS: 26
});

const H = PIRATE_BASE_BLOCK.HEAD, BITS = PIRATE_BASE_BLOCK.BITS;

/** Blok do `packer.addBlock` (faza begin). */
export function createPirateBaseBlock() {
  return {
    name: 'pirateBase', f64: H.STRIDE + PIRATE_BASE_BLOCK.BERTH_WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      const F = blk.f64;
      const s = frame.pirateBase || null;
      F[H.HAS] = s ? 1 : 0;
      if (!s) return;
      const berths = Array.isArray(s.berths) ? s.berths : null;
      const n = berths ? berths.length : 0;
      const words = Math.ceil(n / BITS);
      if (H.STRIDE + words > F.length) packer.resizeBlock('pirateBase', { f64: H.STRIDE + words * 2 });
      F[H.DT] = frame.pirateBaseDt;
      F[H.FLAGS] = (s.hidden ? 1 : 0) + (s.habitatDead ? 2 : 0) + (s.alarm ? 4 : 0);
      F[H.BAYS] = s.bays ? 1 : 0;
      F[H.HABITAT] = s.habitat; F[H.DISC] = s.disc; F[H.FUEL] = s.fuel; F[H.WAREHOUSE] = s.warehouse;
      F[H.TECH] = s.tech ?? s.habitat;
      for (let q = 0; q < 4; q++) F[H.DRUM_Q + q] = s.drumQ ? (s.drumQ[q] ?? s.habitat) : s.habitat;
      const sun = s.sun || null;
      F[H.SUN_OK] = sun ? 1 : 0;
      F[H.SUN_X] = sun ? sun.x : 0; F[H.SUN_Y] = sun ? sun.y : 0;
      F[H.DAY_OK] = s.daylight === undefined ? 0 : 1;
      F[H.DAYLIGHT] = s.daylight === undefined ? 0 : s.daylight;
      F[H.BERTHS] = n;
      for (let w = 0; w < words; w++) {
        let v = 0;
        for (let b = 0, i = w * BITS; b < BITS && i < n; b++, i++) if (berths[i]) v += 2 ** b;
        F[H.STRIDE + w] = v;
      }
    }
  };
}

/** Stan klatki bazy po stronie renderu (obiekt do ponownego użycia). */
export function createPirateBaseMirror() {
  return { present: false, dt: 0, state: { hidden: false, habitatDead: false, alarm: false, bays: 0, berths: [], habitat: 1, disc: 1, fuel: 1, warehouse: 1,
    tech: 1, drumQ: [1, 1, 1, 1], sun: null } };
}

/** Strona renderu: stan z bloku strony → `mirror.state` (dla updatePirateBase3D(mirror.dt, mirror.state)). */
export function applyPirateBaseBlock(blk, mirror) {
  const F = blk.f64;
  mirror.present = F[H.HAS] === 1;
  if (!mirror.present) return mirror;
  const s = mirror.state;
  mirror.dt = F[H.DT];
  const fl = F[H.FLAGS];
  s.hidden = (fl & 1) !== 0; s.habitatDead = (fl & 2) !== 0; s.alarm = (fl & 4) !== 0;
  s.bays = F[H.BAYS];
  s.habitat = F[H.HABITAT]; s.disc = F[H.DISC]; s.fuel = F[H.FUEL]; s.warehouse = F[H.WAREHOUSE];
  s.tech = F[H.TECH];
  for (let q = 0; q < 4; q++) s.drumQ[q] = F[H.DRUM_Q + q];
  if (F[H.SUN_OK] === 1) {
    if (!s.sun) s.sun = { x: 0, y: 0 };
    s.sun.x = F[H.SUN_X]; s.sun.y = F[H.SUN_Y];
  } else s.sun = null;
  if (F[H.DAY_OK] === 1) s.daylight = F[H.DAYLIGHT];
  else if ('daylight' in s) delete s.daylight;
  const n = F[H.BERTHS] | 0;
  if (s.berths.length !== n) s.berths = new Array(n).fill(0);
  for (let i = 0; i < n; i++) s.berths[i] = Math.floor(F[H.STRIDE + ((i / BITS) | 0)] / 2 ** (i % BITS)) % 2;
  return mirror;
}
