// src/render/blocks/warBackdropBlock.js — blok migawki: BITWA W GŁĘBI sceny „Wojna” (2026-10-19) — stan klatki dla
// obrazu (src/3d/warBackdrop/warBackdrop3D.js). Gra (src/game/warScene.js, blok sceny w index.html) decyduje, czy
// scena trwa, gdzie jest (środek, oś stron), jaki ma czas, gdzie leży planeta w głębi i kiedy grają sceny bohaterów;
// obraz z tych liczb buduje tłum (własna symulacja z ziarna sceny) i bohaterów (`planWarHero` — ta sama funkcja
// w grze i w renderze). Tu tylko UKŁAD BLOKU (wspólny) i blok do `packer.addBlock` (tryb worker); tryb off / inline —
// render dostaje obiekt gry wprost (ten sam kształt: createWarBackdropFrame).
// Czysty moduł (bez three, DOM i `window`).

/** Najwięcej scen bohaterów w jednej scenie. */
export const WB_HERO_MAX = 6;

/** Mapy planety w głębi (indeks w bloku). */
export const WB_PLANET_MAPS = Object.freeze(['venus', 'mercury', 'earth', 'mars']);

const HEAD = Object.freeze({
  HAS: 0, ID: 1, T: 2, CX: 3, CY: 4, AXIS: 5, SEED: 6, DENSITY: 7, PREWARM: 8, FADE: 9,
  P_ON: 10, P_MAPS: 11, P_R: 12, P_Z: 13, P_DX: 14, P_DY: 15, P_SPIN: 16, SUN_X: 17, SUN_Y: 18, HERO_N: 19, STRIDE: 20
});
const HERO = Object.freeze({ KIND: 0, T0: 1, X: 2, Y: 3, Z: 4, HEADING: 5, SEED: 6, STRIDE: 7 });
export const WAR_BACKDROP_BLOCK = Object.freeze({ HEAD, HERO });

/**
 * Stan klatki bitwy w głębi (gra pisze, render czyta) — obiekt do ponownego użycia. t — czas sceny [s] (czas gry),
 * cx, cy — środek sceny (świat gry), axis — kąt osi stron (Terra Nova po stronie −oś), prewarm — rozbieg tłumu [s],
 * fade — krycie całości (wygaszanie końca sceny), planet — planeta w głębi (dx, dy względem środka, z — środek kuli),
 * sunX / sunY — Słońce (świat gry), heroes — sceny bohaterów (src/render/warBackdropPlan.js: planWarHero).
 */
export function createWarBackdropFrame() {
  const heroes = [];
  for (let i = 0; i < WB_HERO_MAX; i++) heroes.push({ kind: 0, t0: 0, x: 0, y: 0, z: 0, heading: 0, seed: 1 });
  return {
    has: false, id: 0, t: 0, cx: 0, cy: 0, axis: 0, seed: 1, density: 1, prewarm: 20, fade: 1,
    planet: { on: 1, maps: 0, r: 0, z: 0, dx: 0, dy: 0, spin: 0 },
    sunX: 0, sunY: 0, heroN: 0, heroes
  };
}

/** Blok do `packer.addBlock` (faza begin): `frame.warBackdrop` = stan klatki gry (createWarBackdropFrame). */
export function createWarBackdropBlock() {
  return {
    name: 'warBackdrop', f64: HEAD.STRIDE + WB_HERO_MAX * HERO.STRIDE, phase: 'begin',
    pack(blk, frame) {
      const F = blk.f64;
      const s = frame.warBackdrop || null;
      F[HEAD.HAS] = s && s.has ? 1 : 0;
      if (!s || !s.has) return;
      F[HEAD.ID] = s.id; F[HEAD.T] = s.t; F[HEAD.CX] = s.cx; F[HEAD.CY] = s.cy; F[HEAD.AXIS] = s.axis;
      F[HEAD.SEED] = s.seed; F[HEAD.DENSITY] = s.density; F[HEAD.PREWARM] = s.prewarm; F[HEAD.FADE] = s.fade;
      const p = s.planet;
      F[HEAD.P_ON] = p.on; F[HEAD.P_MAPS] = p.maps; F[HEAD.P_R] = p.r; F[HEAD.P_Z] = p.z; F[HEAD.P_DX] = p.dx;
      F[HEAD.P_DY] = p.dy; F[HEAD.P_SPIN] = p.spin; F[HEAD.SUN_X] = s.sunX; F[HEAD.SUN_Y] = s.sunY;
      const n = Math.min(WB_HERO_MAX, s.heroN | 0);
      F[HEAD.HERO_N] = n;
      for (let i = 0; i < n; i++) {
        const h = s.heroes[i];
        const o = HEAD.STRIDE + i * HERO.STRIDE;
        F[o + HERO.KIND] = h.kind; F[o + HERO.T0] = h.t0; F[o + HERO.X] = h.x; F[o + HERO.Y] = h.y;
        F[o + HERO.Z] = h.z; F[o + HERO.HEADING] = h.heading; F[o + HERO.SEED] = h.seed;
      }
    }
  };
}

/** Strona renderu: blok strony → `mirror` (kształt createWarBackdropFrame). */
export function applyWarBackdropBlock(blk, mirror) {
  const F = blk.f64;
  mirror.has = F[HEAD.HAS] === 1;
  if (!mirror.has) return mirror;
  mirror.id = F[HEAD.ID]; mirror.t = F[HEAD.T]; mirror.cx = F[HEAD.CX]; mirror.cy = F[HEAD.CY]; mirror.axis = F[HEAD.AXIS];
  mirror.seed = F[HEAD.SEED]; mirror.density = F[HEAD.DENSITY]; mirror.prewarm = F[HEAD.PREWARM]; mirror.fade = F[HEAD.FADE];
  const p = mirror.planet;
  p.on = F[HEAD.P_ON]; p.maps = F[HEAD.P_MAPS]; p.r = F[HEAD.P_R]; p.z = F[HEAD.P_Z]; p.dx = F[HEAD.P_DX];
  p.dy = F[HEAD.P_DY]; p.spin = F[HEAD.P_SPIN];
  mirror.sunX = F[HEAD.SUN_X]; mirror.sunY = F[HEAD.SUN_Y];
  const n = Math.min(WB_HERO_MAX, F[HEAD.HERO_N] | 0);
  mirror.heroN = n;
  for (let i = 0; i < n; i++) {
    const h = mirror.heroes[i];
    const o = HEAD.STRIDE + i * HERO.STRIDE;
    h.kind = F[o + HERO.KIND]; h.t0 = F[o + HERO.T0]; h.x = F[o + HERO.X]; h.y = F[o + HERO.Y];
    h.z = F[o + HERO.Z]; h.heading = F[o + HERO.HEADING]; h.seed = F[o + HERO.SEED];
  }
  return mirror;
}
