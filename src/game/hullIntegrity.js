// src/game/hullIntegrity.js
//
// SUFIT PUNKTÓW KADŁUBA Z KONSTRUKCJI — kadłub na belkach (hullBodies.js) ma tyle punktów, ile wytrzyma jego
// konstrukcja: sufit = maks. HP × (żywe węzły / startowe)^wykładnik. Pilnuje go enforceNpcHexIntegrityBalance
// w index.html (co 3. podkrok fizyki — ściąga punkty ponad sufit), a ODROST węzłów (HullBodies.regrowCell /
// restoreHull) podnosi sufit, więc punkty rosną razem z nim (hak HullBodies.onRegrow). Jedno źródło wykładników
// dla obu stron. Bez DOM i bez three.

export const HULL_INTEGRITY = Object.freeze({
  // Gracz (i P2): hull.val ≤ hull.max × udział^2,35 — utrata konstrukcji boli bardziej niż utrata punktów.
  playerExponent: 2.35,
  // NPC: hp ≤ maxHp × udział^2,2.
  npcExponent: 2.2,
  // NPC ze zmiażdżonym kadłubem (udział konstrukcji poniżej progu) ginie — sufit nigdy nie schodzi do zera.
  npcCrushDeathRatio: 0.2
});

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Punkty encji w skali sufitu: gracz / P2 — `hull.val / hull.max`, NPC — `hp / maxHp`; null — encja bez punktów. */
function hullPoints(entity) {
  if (entity?.hull && Number(entity.hull.max) > 0) return { player: true, max: Number(entity.hull.max) };
  if (entity && (Number.isFinite(Number(entity.maxHp)) || Number.isFinite(Number(entity.hp)))) {
    return { player: false, max: Math.max(1, Number(entity.maxHp) || Number(entity.hp) || 1) };
  }
  return null;
}

/** Wykładnik sufitu encji (gracz i P2 — mają `hull`, reszta — NPC). */
export function hullIntegrityExponent(entity) {
  return entity?.hull ? HULL_INTEGRITY.playerExponent : HULL_INTEGRITY.npcExponent;
}

/** Sufit jako ułamek maks. HP przy udziale żywych węzłów `ratio`. */
export function hullIntegrityCapFrac(ratio, exponent) {
  return Math.pow(clamp01(Number(ratio) || 0), exponent);
}

/**
 * Odrost konstrukcji (udział żywych węzłów ratioBefore → ratioAfter): punkty kadłuba rosną o RÓŻNICĘ SUFITÓW
 * (maks. HP × (po^k − przed^k)), najwyżej do maks. HP. Okręt, który miał punkty pod sufitem (trafienia bez utraty
 * węzłów), zostaje pod nim o tyle samo; zniszczony (zero punktów, wrak, martwy) nie ożywa. Zwraca przyrost punktów.
 * Gracz i P2: `hull.val`, NPC: `hp`. `worth` — ile wart jest odrośnięty węzeł (łata polowa roju dronów: patchHpMul)
 * — przyrost × worth.
 */
export function raiseHullHpForRegrowth(entity, ratioBefore, ratioAfter, worth = 1) {
  if (!entity || entity.dead || entity.destroyed || entity.isWreck) return 0;
  const pts = hullPoints(entity);
  if (!pts) return 0;
  const k = hullIntegrityExponent(entity);
  const w = Number.isFinite(worth) ? clamp01(worth) : 1;
  const gain = pts.max * (hullIntegrityCapFrac(ratioAfter, k) - hullIntegrityCapFrac(ratioBefore, k)) * w;
  if (!(gain > 0)) return 0;
  if (pts.player) {
    const val = Number(entity.hull.val) || 0;
    if (!(val > 0)) return 0;
    const next = Math.min(pts.max, val + gain);
    entity.hull.val = next;
    return next - val;
  }
  const hp = Number(entity.hp) || 0;
  if (!(hp > 0)) return 0;
  const next = Math.min(pts.max, hp + gain);
  entity.hp = next;
  return next - hp;
}
